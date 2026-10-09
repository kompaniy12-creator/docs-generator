// SMS notifications to clients (provider: SMSAPI.pl). Page sms.html.
// PORTAL ONLY for every action (JWT with app_metadata.portal === true); POST { action, ... }:
//
//   status      any portal user who may send (sections Kadry or Księgowość, or an administrator)
//     -> { skonfigurowane, tryb, ja, ustawienia, dzis, w_godzinach, szablony, limity }
//        + for an administrator: saldo (points on the SMSAPI account) and nadawcy (its sender names)
//     Without the secret SMSAPI_TOKEN: { skonfigurowane: false, ... } — the page says what is missing.
//   klienci     who may send -> clients with a phone on file (the number masked for people outside Kadry)
//   podglad     { nip? | telefon?, tresc }  -> the text as it will go, its length, encoding, parts, the number
//   wyslij      { nip? | telefon?, tresc, cel?, ref?, test?, mimo_ciszy? }
//     A client is addressed by NIP and the number is read from the clients base on the server — a number
//     sent together with a NIP is refused. An explicit number: administrators only (otherwise the portal
//     would be a free gateway to any phone; clients are reached through the base, where a number has
//     an owner). Everything else — guards, log, provider — is wyslij.ts.
//   historia    { q?, status?, cel?, od?, do?, strona? } -> rows the caller may see (RLS of sms_wiadomosci)
//   ustawienia  administrator: { ustawienia } -> saved after validation
//
// DELIVERY REPORTS (no portal session; OFF unless settings.raporty): SMSAPI calls
// GET/POST …/sms?MsgId=…&status=…&idx=…&to=… for a message sent with notify_url. Neither smsapi.pl/docs nor
// the provider's OpenAPI description offers a request that asks for the status of a message, so there is
// nothing to poll: without reports a message stays "wyslany" (accepted by the provider).
// The provider does not sign these calls, so a report is accepted only when it names a message by BOTH
// the provider's id and the random `idx` this function generated for that one message (never shown in
// the portal) — and all it can do is move that row forward: wyslany -> dostarczony / blad.

import { loadKlienciRows } from "../_shared/klienci.ts";
import { analiza, czytajUst, dzienPL, maska, nadawcaOk, MAX_CZESCI, MAX_CZESCI_ADMIN, MAX_TRESC, numer, pierwszyNumer, poczatekDnia, przygotuj, sprawdzUst, statusDoreczenia, SZABLONY, wGodzinach } from "./logic.ts";
import { smsapi, smsSkonfigurowane, ustawieniaSms, wyslijSms } from "./wyslij.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STRONA = 50;

// deno-lint-ignore no-explicit-any
type Any = any;

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
type Ja = { email: string; admin: boolean; kadry: boolean; moze: boolean; token: string };
async function portal(req: Request): Promise<Ja | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (m.portal !== true || !u.email) return null;
  const admin = m.portal_admin === true, wszystko = admin || !Array.isArray(m.portal_sections);
  const kadry = wszystko || m.portal_sections.includes("kadry");
  return { email: String(u.email).toLowerCase(), admin, kadry, moze: kadry || m.portal_sections.includes("onboarding"), token };
}
const enc = encodeURIComponent;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ---------------------------------------------------------------- delivery reports
async function raport(p: URLSearchParams): Promise<Response> {
  const tak = new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
  // reports are taken only while the administrator has them switched on; nothing is read or written otherwise
  if (!(await ustawieniaSms()).raporty) return tak;
  const lista = (k: string) => (p.get(k) ?? "").slice(0, 400).split(",").slice(0, 5);
  const ids = lista("MsgId"), st = lista("status"), idx = lista("idx"), done = lista("donedate");
  for (let i = 0; i < ids.length; i++) {
    // anything that is not shaped like our own message is dropped before the database is asked
    if (!/^[A-Za-z0-9]{6,32}$/.test(ids[i]) || !/^[0-9a-f]{32}$/.test(idx[i] ?? "") || !/^\d{3}$/.test(st[i] ?? "")) continue;
    const s = statusDoreczenia(st[i]);
    if (!s.nazwa) continue;
    const pola: Any = { provider_status: s.nazwa };
    if (s.status) pola.status = s.status;
    if (s.status === "dostarczony") pola.dostarczono_at = /^\d{9,11}$/.test(done[i] ?? "") ? new Date(Number(done[i]) * 1000).toISOString() : new Date().toISOString();
    if (s.status === "blad") pola.provider_blad = "raport doręczenia: " + s.nazwa;
    const r = await db(`sms_wiadomosci?provider_id=eq.${ids[i]}&idx=eq.${idx[i]}&test=is.false&status=eq.wyslany`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(pola) });
    if (!r.ok) console.error("sms raport", r.status);
  }
  return tak; // always the same answer: the caller learns nothing about what matched
}

// ---------------------------------------------------------------- what the page shows
async function dzis(ust: { limit_dzienny: number }) {
  const r = await db(`sms_wiadomosci?select=status,test&created_at=gte.${enc(poczatekDnia(new Date()))}&limit=5000`);
  const rows: Any[] = r.ok ? await r.json() : [];
  const ile = (f: (x: Any) => boolean) => rows.filter(f).length;
  return {
    wyslane: ile((x) => !x.test && ["wyslany", "dostarczony"].includes(x.status)), dostarczone: ile((x) => !x.test && x.status === "dostarczony"),
    testowe: ile((x) => x.test && x.status === "test"), bledy: ile((x) => x.status === "blad"), odrzucone: ile((x) => x.status === "odrzucony"), limit: ust.limit_dzienny,
  };
}
async function nadawcy(): Promise<{ lista: { nazwa: string; status: string; domyslna: boolean }[] | null; blad?: string }> {
  const w = await smsapi("/sms/sendernames");
  if (w.http !== 200 || !Array.isArray(w.dane?.collection)) return { lista: null, blad: w.http === 401 || w.dane?.error === "authorization_failed" ? "Token SMSAPI jest nieprawidłowy albo nie ma dostępu do pól nadawcy." : "Nie udało się pobrać nazw nadawcy (HTTP " + w.http + ")." };
  return { lista: w.dane.collection.slice(0, 50).map((s: Any) => ({ nazwa: String(s.sender ?? "").slice(0, 11), status: String(s.status ?? "").slice(0, 20), domyslna: s.is_default === true })).filter((s: Any) => nadawcaOk(s.nazwa)) }; // "2WAY" is never offered
}
async function saldo(): Promise<{ punkty: number | null; platnosc?: string; blad?: string }> {
  const w = await smsapi("/profile");
  if (w.http !== 200 || w.dane?.points == null) return { punkty: null, blad: w.http === 401 || w.dane?.error === "authorization_failed" ? "Token SMSAPI jest nieprawidłowy albo nie ma dostępu do profilu konta." : "Nie udało się pobrać stanu konta (HTTP " + w.http + ")." };
  return { punkty: Number(w.dane.points), platnosc: String(w.dane.payment_type ?? "").slice(0, 20) };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const url = new URL(req.url);
  if (url.searchParams.has("MsgId")) {
    try { return await raport(url.searchParams); } catch (_e) { return new Response("OK", { status: 200 }); }
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const ja = await portal(req);
  if (!ja) return json({ error: "Brak dostępu (portal)." }, 403, origin);
  if (!ja.moze) return json({ error: "SMS-y mogą wysyłać osoby z sekcji Kadry lub Księgowość." }, 403, origin);
  let body: Any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }
  const action = String(body?.action ?? "");
  const tylkoAdmin = () => json({ error: "Tę czynność może wykonać tylko administrator portalu." }, 403, origin);

  try {
    if (action === "status") {
      const ust = await ustawieniaSms(), skonf = smsSkonfigurowane();
      const out: Any = {
        skonfigurowane: skonf, brak: skonf ? [] : ["SMSAPI_TOKEN"], tryb: ust.wlaczone && skonf ? "rzeczywisty" : "test",
        ja: { email: ja.email, admin: ja.admin, numer_reczny: ja.admin, kontakty: ja.kadry },
        ustawienia: { wlaczone: ust.wlaczone, nadawca: ust.nadawca, limit_dzienny: ust.limit_dzienny, limit_na_numer_dziennie: ust.limit_na_numer_dziennie, godziny: ust.godziny, automaty: ust.automaty, normalizuj: ust.normalizuj, zagranica: ust.zagranica, raporty: ust.raporty },
        dzis: await dzis(ust), w_godzinach: wGodzinach(new Date(), ust.godziny), szablony: SZABLONY,
        limity: { czesci: ja.admin ? MAX_CZESCI_ADMIN : MAX_CZESCI, znaki: MAX_TRESC },
      };
      if (ja.admin) {
        out.ustawienia.by = ust.by ?? null; out.ustawienia.updated_at = ust.updated_at ?? null;
        if (skonf) { const [s, n] = await Promise.all([saldo(), nadawcy()]); out.saldo = s; out.nadawcy = n; }
      }
      return json(out, 200, origin);
    }

    if (action === "klienci") {
      const ust = await ustawieniaSms();
      const [rows, zak] = await Promise.all([loadKlienciRows(), db("klienci_baza?select=nip&status=eq.zakonczony")]);
      const koniec = new Set<string>(zak.ok ? (await zak.json()).map((k: Any) => String(k.nip)) : []);
      const seen = new Set<string>();
      const out = [];
      for (const k of rows) {
        if (k.nip.length !== 10 || seen.has(k.nip)) continue;
        seen.add(k.nip);
        const n = pierwszyNumer(k.telefon, ust.zagranica);
        out.push({ nip: k.nip, nazwa: k.nazwa, telefon: n.ok ? (ja.kadry ? n.e164 : maska(n.e164)) : null, brak: n.ok ? null : (k.telefon.trim() ? n.error : "Brak numeru telefonu w bazie klientów."), zakonczony: koniec.has(k.nip) });
      }
      return json({ klienci: out }, 200, origin);
    }

    if (action === "podglad") {
      const ust = await ustawieniaSms();
      if (typeof body.tresc !== "string" || body.tresc.length > MAX_TRESC) return json({ error: "Treść jest za długa (najwyżej " + MAX_TRESC + " znaków)." }, 400, origin);
      const p = przygotuj(body.tresc, body.normalizuj === false && ja.admin ? false : ust.normalizuj), a = analiza(p.tresc);
      let tel: Any = null;
      if (body.nip && body.telefon) return json({ error: "Podaj klienta albo numer — nie oba naraz." }, 400, origin);
      if (body.nip) {
        const nip = String(body.nip).replace(/\D/g, "");
        const k = nip.length === 10 ? (await loadKlienciRows()).find((x) => x.nip === nip) : null;
        if (!k) tel = { ok: false, error: "Nie ma takiego klienta w bazie klientów." };
        else { const n = pierwszyNumer(k.telefon, ust.zagranica); tel = n.ok ? { ok: true, numer: ja.kadry ? n.e164 : maska(n.e164), kraj: n.kraj, odbiorca: k.nazwa } : n; }
      } else if (body.telefon) {
        if (!ja.admin) tel = { ok: false, error: "Na dowolny numer może wysłać tylko administrator — wybierz klienta z bazy." };
        else { const n = numer(body.telefon, ust.zagranica); tel = n.ok ? { ok: true, numer: n.e164, kraj: n.kraj } : n; }
      }
      const max = ja.admin ? MAX_CZESCI_ADMIN : MAX_CZESCI;
      return json({
        tresc: p.tresc, podpis_dodany: p.podpis_dodany, polskie_znaki: p.polskie, polskie_usuniete: p.usuniete, normalizuj: ust.normalizuj,
        znaki: a.znaki, kodowanie: a.kodowanie, czesci: a.czesci, na_czesc: a.na_czesc, do_konca: a.do_konca, inne_znaki: a.inne_znaki,
        max_czesci: max, za_dluga: a.czesci > max, koszt_czesci: a.czesci, telefon: tel,
        w_godzinach: wGodzinach(new Date(), ust.godziny), godziny: ust.godziny, tryb: ust.wlaczone && smsSkonfigurowane() ? "rzeczywisty" : "test",
      }, 200, origin);
    }

    if (action === "wyslij") {
      if (body.nip && body.telefon) return json({ error: "Podaj klienta albo numer — nie oba naraz. Numer klienta jest brany z bazy klientów." }, 400, origin);
      if (!body.nip && !body.telefon) return json({ error: "Wybierz klienta." }, 400, origin);
      if (body.telefon && !ja.admin) return json({ error: "Na dowolny numer może wysłać tylko administrator — wybierz klienta z bazy." }, 403, origin);
      if (!smsSkonfigurowane()) return json({ ok: false, skonfigurowane: false, error: "SMS nie jest jeszcze skonfigurowany (brak tokenu SMSAPI)." }, 200, origin);
      const w = await wyslijSms({
        nip: body.nip ? String(body.nip) : undefined, telefon: body.telefon ? String(body.telefon) : undefined, tresc: body.tresc,
        cel: body.test === true && !body.cel ? "test" : body.cel, ref: body.ref, kto: ja.email, admin: ja.admin, test: body.test === true, mimoCiszy: body.mimo_ciszy === true,
      });
      // the number goes back only to those who may see clients' contact data
      if (w.telefon && !ja.kadry) w.telefon = maska(w.telefon);
      return json(w, 200, origin);
    }

    if (action === "historia") {
      // read with the caller's own token: the row-level policy of sms_wiadomosci decides what is visible
      const f: string[] = [];
      if (["nowy", "test", "wyslany", "dostarczony", "blad", "odrzucony"].includes(body.status)) f.push("status=eq." + body.status);
      if (/^[a-z0-9_]{1,30}$/.test(body.cel ?? "")) f.push("cel=eq." + body.cel);
      if (isDate(body.od)) f.push("created_at=gte." + enc(poczatekDnia(new Date(body.od + "T12:00:00Z"))));
      if (isDate(body.do)) f.push("created_at=lt." + enc(poczatekDnia(new Date(Date.parse(body.do + "T12:00:00Z") + 86400000))));
      const q = String(body.q ?? "").trim().slice(0, 60).replace(/[^\p{L}\p{N} .@+\-]/gu, "");
      if (q) { const w = enc("*" + q + "*"); f.push(`or=(odbiorca_nazwa.ilike.${w},odbiorca_nip.ilike.${w},telefon.ilike.${w},kto.ilike.${w})`); }
      const strona = Math.max(0, Math.min(2000, Math.floor(Number(body.strona) || 0)));
      const kol = "id,created_at,kto,odbiorca_nip,odbiorca_nazwa,telefon,tresc,czesci,kodowanie,nadawca,cel,ref,status,test,provider_status,provider_blad,koszt,dostarczono_at";
      const r = await fetch(`${SUPABASE_URL}/rest/v1/sms_wiadomosci?select=${kol}&order=created_at.desc${f.length ? "&" + f.join("&") : ""}`, {
        headers: { apikey: ANON, Authorization: `Bearer ${ja.token}`, Range: `${strona * STRONA}-${strona * STRONA + STRONA}`, "Range-Unit": "items" },
      });
      if (!r.ok) return json({ error: "Nie udało się wczytać historii." }, 502, origin);
      const rows: Any[] = await r.json();
      const wiersze = rows.slice(0, STRONA);
      if (!ja.kadry) for (const x of wiersze) x.telefon = maska(String(x.telefon ?? ""));
      return json({ wiersze, strona, dalej: rows.length > STRONA, dzien: dzienPL(new Date()) }, 200, origin);
    }

    if (action === "ustawienia") {
      if (!ja.admin) return tylkoAdmin();
      const skonf = smsSkonfigurowane();
      const n = skonf ? await nadawcy() : { lista: null };
      const s = sprawdzUst(body.ustawienia, { skonfigurowane: skonf, nadawcy: n.lista ? n.lista.filter((x) => x.status === "ACTIVE").map((x) => x.nazwa) : null });
      if (!s.ok) return json({ error: s.error }, 400, origin);
      const teraz = new Date().toISOString();
      const r = await db("portal_ustawienia", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "sms", value: { ...s.ust, by: ja.email }, updated_at: teraz }) });
      if (!r.ok) return json({ error: "Nie udało się zapisać ustawień." }, 500, origin);
      console.log("sms ustawienia", ja.email, "włączone:", s.ust.wlaczone, "terminy:", s.ust.automaty.terminy);
      return json({ ok: true, ustawienia: czytajUst({ ...s.ust, by: ja.email, updated_at: teraz }) }, 200, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error("sms", action, String((e as Error)?.message ?? e).slice(0, 200));
    return json({ error: "Błąd serwera — spróbuj ponownie." }, 500, origin);
  }
});
