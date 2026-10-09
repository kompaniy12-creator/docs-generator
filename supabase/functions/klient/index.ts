// Client profile (employer's view of its own firm).
//
// Public endpoint with its own sessions — client accounts are NOT Supabase auth users, so a
// client can never reach any table directly; every answer is built here and filtered by the
// NIP numbers attached to the account.
//
// Client:
//   POST { action: "login", email }        one-time link by e-mail (same answer whether or not
//                                          the account exists)
//   POST { action: "verify", token }       link -> session (30 days); the first time the client
//                                          must set a password before anything else is shown
//   POST { action: "haslo_ustaw", haslo, stare? }   set / change the password
//   POST { action: "login_haslo", email, haslo }    sign in with the password
//   POST { action: "ksiegowosc", nip }     accountant, payment accounts, deadlines, invoices
//   POST { action: "me" }                  x-klient-token: account + firms
//   POST { action: "dane", nip }           workers, submissions in progress, onboarding steps
//   POST { action: "dokument", id }        short-lived link to the packet sent for signing
//   POST { action: "logout" }
// Office (portal JWT, administrator):
//   POST { action: "konta" }               list of client accounts
//   POST { action: "konto_zapisz", email, nip[], nazwa?, aktywny? }
//   POST { action: "konto_usun", id }
//   POST { action: "zaproszenie", id, wyslij }   wyslij=true: e-mail with the link;
//                                                wyslij=false: returns the link to copy
// Stage 2 (start screen, workers, documents, accounting, requests, firm data; office actions
// biuro_*) lives in portal.ts — the contract is described there. Files come only with
// zgloszenie_nowe, as multipart/form-data (fields + up to 3 x `plik`).

import nodemailer from "npm:nodemailer@6.9.14";
import { BIURO_AKCJE, biuroAkcja, klientAkcja, MAX_BODY, MAX_PLIKOW, okSciezka, type Plik, type Staff } from "./portal.ts";
import { store } from "./store.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "mail.td-group.pl";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "kadry@td-group.pl";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? "";
const APP = "https://docgenerator.td-group.pl/klient/";
const LINK_MIN = 20, SESSION_DAYS = 30, LINKS_PER_15MIN = 3;

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-klient-token",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const MIN_HASLO = 10, MAX_BLEDNE = 5, BLOKADA_MIN = 15, PBKDF2_ITER = 150000;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
async function pbkdf2(haslo: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(haslo), "PBKDF2", false, ["deriveBits"]);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, key, 256)));
}
// New hashes: "v2$<rounds>$<hash>" with PBKDF2_NOWE rounds. A hash without the prefix was made with
// PBKDF2_ITER rounds; it is still verified and replaced by a new one at the next successful sign-in.
const PBKDF2_NOWE = 600000;
async function hashHaslo(haslo: string, salt: Uint8Array): Promise<string> { return `v2$${PBKDF2_NOWE}$${await pbkdf2(haslo, salt, PBKDF2_NOWE)}`; }
const stareHaslo = (zapis: string) => !zapis.startsWith("v2$");
// the same amount of work whatever is stored (an old hash is topped up to the new number of rounds)
async function sprawdzHaslo(haslo: string, salt: Uint8Array, zapis: string): Promise<boolean> {
  const m = /^v2\$(\d{5,8})\$(.+)$/.exec(zapis);
  const iter = m ? Number(m[1]) : PBKDF2_ITER;
  const ok = sameText(await pbkdf2(haslo, salt, iter), m ? m[2] : zapis);
  if (iter < PBKDF2_NOWE) await pbkdf2(haslo, salt, PBKDF2_NOWE - iter);
  return ok;
}
const SOL_PUSTA = new Uint8Array(16);
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
function wTle(p: Promise<unknown>) { try { EdgeRuntime!.waitUntil(p); } catch { p.catch(() => undefined); } }
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function newSession(k: { id: string }, zLinku: boolean): Promise<string> {
  const sess = newToken();
  await db("klient_sesje", { method: "POST", body: JSON.stringify({ token_hash: await sha256(sess), konto_id: k.id, rodzaj: "sesja", z_linku: zLinku, expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() }) });
  await db(`klient_konta?id=eq.${k.id}`, { method: "PATCH", body: JSON.stringify({ last_login: new Date().toISOString(), bledne: 0, blokada_do: null }) });
  return sess;
}
const okMail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
async function log(konto: { id?: string; email?: string } | null, akcja: string, info?: unknown) {
  await db("klient_log", { method: "POST", body: JSON.stringify({ konto_id: konto?.id ?? null, email: konto?.email ?? null, akcja, info: info ?? null }) }).catch(() => undefined);
}

type Konto = {
  id: string; email: string; nip: string[]; nazwa: string | null; aktywny: boolean; last_login?: string | null; created_at?: string;
  haslo_hash?: string | null; haslo_salt?: string | null; bledne?: number; blokada_do?: string | null;
};

async function kontoByEmail(email: string): Promise<Konto | null> {
  const r = await db(`klient_konta?email=eq.${encodeURIComponent(email)}&select=*`);
  return r.ok ? (await r.json())[0] ?? null : null;
}
async function makeLink(k: Konto): Promise<string> {
  const token = newToken();
  await db("klient_sesje", {
    method: "POST",
    body: JSON.stringify({ token_hash: await sha256(token), konto_id: k.id, rodzaj: "link", expires_at: new Date(Date.now() + LINK_MIN * 60000).toISOString() }),
  });
  return `${APP}#t=${token}`;
}
async function sendLink(k: Konto, link: string, invitation: boolean) {
  if (!SMTP_PASS) throw new Error("Poczta nie jest skonfigurowana.");
  const tr = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  const text = `Dzień dobry,

${invitation ? "biuro TD Consulting Group udostępniło Państwu profil klienta — podgląd pracowników, terminów dokumentów i spraw prowadzonych dla Państwa firmy." : "oto link do logowania w profilu klienta TD Consulting Group."}

Aby wejść, proszę otworzyć link (ważny ${LINK_MIN} minut, jednorazowy):
${link}

Przy pierwszym wejściu ustawią Państwo własne hasło — kolejne logowania odbywają się adresem e-mail i tym hasłem na stronie ${APP}

Jeżeli to nie Państwo prosili o logowanie, proszę zignorować tę wiadomość.

Pozdrawiamy
TD Consulting Group`;
  await tr.sendMail({ from: `TD Consulting Group <${SMTP_USER}>`, to: k.email, subject: invitation ? "Profil klienta TD Consulting Group — dostęp" : "Logowanie do profilu klienta TD Consulting Group", text });
}

async function session(req: Request): Promise<(Konto & { zLinku: boolean; swiezy: boolean }) | null> {
  const token = req.headers.get("x-klient-token") ?? "";
  if (token.length < 20) return null;
  const r = await db(`klient_sesje?token_hash=eq.${await sha256(token)}&rodzaj=eq.sesja&select=expires_at,created_at,z_linku,klient_konta(*)`);
  const row = r.ok ? (await r.json())[0] : null;
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  const k: Konto | null = row.klient_konta ?? null;
  // a link session may set a new password for half an hour after it was opened
  return k && k.aktywny ? { ...k, zLinku: row.z_linku === true, swiezy: Date.now() - Date.parse(row.created_at) < 30 * 60000 } : null;
}
async function isAdmin(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.app_metadata?.portal === true && u?.app_metadata?.portal_admin === true ? String(u.email ?? "admin") : null;
}

// a member of staff: portal user with the sections of the portal he may open (null = all of them)
async function staff(req: Request): Promise<Staff | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === ANON) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) { await r.body?.cancel(); return null; }
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (m.portal !== true || !u.email) return null;
  return { email: String(u.email).toLowerCase(), admin: m.portal_admin === true, sekcje: Array.isArray(m.portal_sections) ? m.portal_sections.map(String) : null };
}
const deps = { store, now: () => Date.now() };
// the body of an upload is cut off at the cap while it is being read, whatever Content-Length said
function ograniczony(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let n = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) { n += chunk.length; if (n > max) c.error(new Error("rozmiar")); else c.enqueue(chunk); },
  }));
}

// deno-lint-ignore no-explicit-any
type Any = any;
const UMOWA: Record<string, string> = { praca: "umowa o pracę", zlecenie: "umowa zlecenie" };
const ETAP: Record<string, string> = { nowe: "przyjęte — czeka na sprawdzenie", sprawdzone: "sprawdzone — przygotowujemy dokumenty", wyslane: "dokumenty wysłane do podpisu" };

// What an employer may see about its own people: names, contract terms and document validity.
// No PESEL, no document numbers, no addresses, no scans. Only submissions the office has checked:
// the NIP of a new one is typed by whoever fills in the public form (see WIDOCZNE in portal.ts).
async function firmData(nip: string) {
  const r = await db(`zatrudnienie_zgloszenia?select=id,worker_name,status,created_at,payload&payload->>z_nip=eq.${nip}&status=in.(sprawdzone,wyslane,zatrudniony)&order=created_at.desc`, { headers: { Range: "0-999", "Range-Unit": "items" } });
  if (!r.ok) throw new Error("dane " + r.status);
  const rows: Any[] = await r.json();
  const pracownicy = [], zgloszenia = [];
  for (const w of rows) {
    const p = w.payload ?? {};
    const term = (k: string, bt: string) => ({ data: isDate(p[k]) ? p[k] : null, bezterminowo: p[bt] === true });
    if (w.status === "zatrudniony") {
      pracownicy.push({
        id: w.id, imie_nazwisko: w.worker_name ?? "", stanowisko: p.u_stanowisko ?? "", umowa: UMOWA[p.u_typ] ?? p.u_umowa ?? "",
        od: isDate(p.u_od) ? p.u_od : null, obywatelstwo: p.p_obywatelstwo ?? "",
        terminy: {
          umowa: term("u_do", "u_bezterminowo"), karta_pobytu: term("p_karta_do", "p_karta_bezterm"), zezwolenie: term("p_zezwolenie_do", "p_zezwolenie_bezterm"),
          paszport: term("p_paszport_do", "p_paszport_bezterm"), badania: term("p_badania_do", "p_badania_bezterm"),
        },
      });
    } else {
      zgloszenia.push({
        id: w.id, imie_nazwisko: w.worker_name ?? "", umowa: UMOWA[p.u_typ] ?? "", od: isDate(p.u_od) ? p.u_od : null,
        wyslane: w.created_at, status: w.status, etap: ETAP[w.status] ?? w.status, komplet: w.status === "wyslane" && !!p.komplet?.path,
      });
    }
  }
  // onboarding of the firm itself (accounting): progress and what we are waiting for from the client
  let onboarding = null;
  const o = await db(`onboarding_clients?select=data&data->>nip=eq.${nip}&limit=1`);
  const oc = o.ok ? (await o.json())[0]?.data : null;
  if (oc && !oc.archived) {
    const tasks: Any[] = (oc.tasks ?? []).filter((t: Any) => t.status !== "na");
    const done = tasks.filter((t) => t.status === "done").length;
    onboarding = {
      gotowe: done, wszystkie: tasks.length,
      od_klienta: tasks.filter((t) => t.clientAction && t.status !== "done").map((t) => ({ co: t.clientAction, sprawa: t.title, termin: t.dueDate ?? null, czekamy: t.status === "waiting_client" })),
    };
  }
  return { pracownicy, zgloszenia, onboarding };
}
function mod97(num: string) { let r = 0; for (const c of num) r = (r * 10 + Number(c)) % 97; return r; }
// tax micro-account: LK + 10100071 + 222 + 2 + NIP + 00 (structure published by the Ministry of Finance)
function mikrorachunek(nip: string) { const body = `101000712222${nip}00`; return String(98 - mod97(body + "252100")).padStart(2, "0") + body; }
const FAKTURY_SWIEZE_H = 26; // invoices are shown only when the last sync with wFirma is this fresh

async function accounting(nip: string) {
  const kr = await db(`portal_klienci?nip=eq.${nip}&select=dane`);
  const kl = kr.ok ? (await kr.json())[0]?.dane ?? {} : {};
  const spolka = /sp[oó]łka|z o\.? ?o/i.test(kl.forma ?? "");
  const o = await db(`onboarding_clients?select=data&data->>nip=eq.${nip}&limit=1`);
  const oc = o.ok ? (await o.json())[0]?.data : null;
  // statutory payment days (the next working day when it falls on a day off)
  const terminy = spolka
    ? [
        { co: "Składki ZUS za pracowników i zleceniobiorców", kiedy: "do 15. dnia następnego miesiąca", podstawa: "art. 47 ust. 1 pkt 3 ustawy o systemie ubezpieczeń społecznych" },
        { co: "Zaliczka na CIT", kiedy: "do 20. dnia następnego miesiąca", podstawa: "art. 25 ust. 1a ustawy o CIT" },
        { co: "Zaliczki PIT od wynagrodzeń (PIT-4)", kiedy: "do 20. dnia następnego miesiąca", podstawa: "art. 38 ust. 1 ustawy o PIT" },
        { co: "VAT i JPK_V7", kiedy: "do 25. dnia następnego miesiąca", podstawa: "art. 99 ust. 1 i art. 103 ust. 1 ustawy o VAT" },
      ]
    : [
        { co: "Składki ZUS", kiedy: "do 20. dnia następnego miesiąca", podstawa: "art. 47 ust. 1 pkt 4 ustawy o systemie ubezpieczeń społecznych" },
        { co: "Zaliczka na PIT / ryczałt", kiedy: "do 20. dnia następnego miesiąca", podstawa: "art. 44 ust. 6 ustawy o PIT; art. 21 ust. 1 ustawy o ryczałcie" },
        { co: "VAT i JPK_V7 (podatnicy VAT)", kiedy: "do 25. dnia następnego miesiąca", podstawa: "art. 99 ust. 1 i art. 103 ust. 1 ustawy o VAT" },
      ];
  // invoices issued by the office: only when the data is fresh, never a stale list of "debts"
  const last = await db("invoices?select=synced_at&order=synced_at.desc&limit=1");
  const sync: string | null = last.ok ? (await last.json())[0]?.synced_at ?? null : null;
  let faktury: Any = { stan: "niedostepne" };
  if (sync && Date.now() - Date.parse(sync) < FAKTURY_SWIEZE_H * 3600000) {
    const from = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
    const r = await db(`invoices?select=invoice_number,issue_date,due_date,amount,currency,status,paid_date&contractor_nip=eq.${nip}&issue_date=gte.${from}&status=in.(issued,overdue,paid)&order=issue_date.desc&limit=200`);
    const lista: Any[] = r.ok ? await r.json() : [];
    const open = lista.filter((f) => f.status !== "paid");
    const sum = (l: Any[]) => Object.entries(l.reduce((acc: Record<string, number>, f) => { acc[f.currency] = (acc[f.currency] ?? 0) + Number(f.amount); return acc; }, {})).map(([waluta, kwota]) => ({ waluta, kwota: Math.round((kwota as number) * 100) / 100 }));
    faktury = { stan: "ok", na_dzien: sync, lista, do_zaplaty: sum(open), po_terminie: sum(open.filter((f) => f.status === "overdue")) };
  }
  return {
    opiekun: kl.opiekun || null, kadrowy: kl.kadrowy || null, forma: kl.forma || null, opodatkowanie: kl.opodatkowanie || null,
    mikrorachunek: mikrorachunek(nip), nrs: oc?.nrs ?? null, terminy, faktury,
  };
}
async function firmNames(nips: string[]): Promise<{ nip: string; nazwa: string }[]> {
  const r = await db(`portal_klienci?nip=in.(${nips.join(",")})&select=nip,dane`);
  const list: Any[] = r.ok ? await r.json() : [];
  return nips.map((n) => ({ nip: n, nazwa: list.find((x) => x.nip === n)?.dane?.nazwa ?? `NIP ${n}` }));
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  let body: Any;
  const pliki: Plik[] = [];
  const ct = req.headers.get("content-type") ?? "";
  if (/^multipart\/form-data/i.test(ct)) {
    // files: who is calling is settled from the headers before a single byte of the body is read
    try {
      const k0 = await session(req);
      if (!k0) return json({ error: "Sesja wygasła — zaloguj się ponownie.", wyloguj: true }, 401, origin);
      if (!k0.haslo_hash) return json({ error: "Najpierw ustaw hasło.", ustaw_haslo: true }, 403, origin);
    } catch (e) { console.error(e); return json({ error: "Wewnętrzny błąd serwera." }, 500, origin); }
    const len = Number(req.headers.get("content-length") ?? "");
    const zaDuze = () => json({ kod: "rozmiar", error: `Załączniki są za duże — najwyżej 15 MB każdy, do ${MAX_PLIKOW} plików.` }, 413, origin);
    if (!Number.isFinite(len) || len <= 0 || !req.body) return json({ kod: "dlugosc", error: "Brak długości przesyłanych danych." }, 411, origin);
    if (len > MAX_BODY) return zaDuze();
    try {
      const form = await new Response(ograniczony(req.body, MAX_BODY), { headers: { "content-type": ct } }).formData();
      body = {};
      for (const [key, v] of form.entries()) {
        if (typeof v === "string") body[key] = v;
        else if (key === "plik" && pliki.length <= MAX_PLIKOW) pliki.push({ nazwa: v.name || "plik", typ: v.type || "", bytes: new Uint8Array(await v.arrayBuffer()) });
      }
    } catch (e) { return (e as Error)?.message === "rozmiar" ? zaDuze() : json({ error: "Nieprawidłowe dane formularza." }, 400, origin); }
    if (body.action !== "zgloszenie_nowe") return json({ error: "Nieznana akcja." }, 400, origin);
  } else {
    try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Nieprawidłowy JSON." }, 400, origin);
  }

  try {
    // ---------------- sign-in ----------------
    if (body.action === "login") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!okMail(email)) return json({ error: "Wpisz poprawny adres e-mail." }, 400, origin);
      const k = await kontoByEmail(email);
      if (k?.aktywny) {
        const since = new Date(Date.now() - 15 * 60000).toISOString();
        const c = await db(`klient_sesje?select=token_hash&konto_id=eq.${k.id}&rodzaj=eq.link&created_at=gte.${since}`);
        const recent = c.ok ? (await c.json()).length : 0;
        if (recent < LINKS_PER_15MIN) {
          // sent after the answer: how long the mail server takes must not tell whether the address is known
          wTle((async () => {
            try { await sendLink(k, await makeLink(k), false); await log(k, "link"); }
            catch (e) { console.error("mail", e); await log(k, "link_blad", { e: String((e as Error)?.message ?? e).slice(0, 160) }); }
          })());
        }
      }
      // the same answer for a known and an unknown address
      return json({ ok: true }, 200, origin);
    }
    if (body.action === "verify") {
      const token = String(body.token ?? "");
      if (token.length < 20) return json({ error: "Link jest nieprawidłowy." }, 400, origin);
      const hash = await sha256(token);
      // single use: the link is taken only if it has not been used yet
      const u = await db(`klient_sesje?token_hash=eq.${hash}&rodzaj=eq.link&used_at=is.null&expires_at=gt.${new Date().toISOString()}`, {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ used_at: new Date().toISOString() }),
      });
      const row = u.ok ? (await u.json())[0] : null;
      if (!row) return json({ error: "Link wygasł albo został już użyty. Poproś o nowy." }, 400, origin);
      const kr = await db(`klient_konta?id=eq.${row.konto_id}&select=*`);
      const k: Konto | null = kr.ok ? (await kr.json())[0] : null;
      if (!k?.aktywny) return json({ error: "Konto jest nieaktywne." }, 403, origin);
      const sess = await newSession(k, true);
      await log(k, "logowanie_link");
      return json({ ok: true, sesja: sess, email: k.email, ustaw_haslo: !k.haslo_hash, firmy: k.haslo_hash ? await firmNames(k.nip) : [] }, 200, origin);
    }
    if (body.action === "login_haslo") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const haslo = String(body.haslo ?? "");
      // One answer for everything that is not a successful sign-in — unknown address, wrong password,
      // locked account — and the same work done each time, so neither the text, the status nor the
      // time tells whether an account exists.
      const zle = () => json({ error: "Nieprawidłowy e-mail lub hasło. Po kilku błędnych próbach logowanie hasłem jest wstrzymane na kwadrans — można wtedy wejść linkiem z e-maila." }, 401, origin);
      if (!okMail(email) || !haslo || haslo.length > 200) return zle();
      const k = await kontoByEmail(email);
      if (!k?.aktywny || !k.haslo_hash || !k.haslo_salt) { await sprawdzHaslo(haslo, SOL_PUSTA, "v2$" + PBKDF2_NOWE + "$-"); return zle(); }
      // the attempt is counted in one statement BEFORE the password is checked: parallel requests
      // cannot get more tries than the limit; false = the account is locked now
      const pr = await db("rpc/klient_proba_hasla", { method: "POST", body: JSON.stringify({ p_id: k.id, p_max: MAX_BLEDNE, p_min: BLOKADA_MIN }) });
      const wolno = pr.ok ? (await pr.json()) === true : (console.error("proba_hasla", pr.status), await pr.body?.cancel(), false);
      const dobre = await sprawdzHaslo(haslo, unb64(k.haslo_salt), k.haslo_hash);
      if (!wolno) { await log(k, "logowanie_zablokowane"); return zle(); }
      if (!dobre) { await log(k, "bledne_haslo"); return zle(); }
      if (stareHaslo(k.haslo_hash)) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        await db(`klient_konta?id=eq.${k.id}`, { method: "PATCH", body: JSON.stringify({ haslo_hash: await hashHaslo(haslo, salt), haslo_salt: b64(salt) }) });
      }
      const sess = await newSession(k, false);
      await log(k, "logowanie_haslo");
      return json({ ok: true, sesja: sess, email: k.email, firmy: await firmNames(k.nip) }, 200, origin);
    }

    // ---------------- office: client accounts ----------------
    if (["konta", "konto_zapisz", "konto_usun", "zaproszenie"].includes(body.action)) {
      const admin = await isAdmin(req);
      if (!admin) return json({ error: "Tylko administrator portalu." }, 403, origin);
      if (body.action === "konta") {
        const r = await db("klient_konta?select=id,email,nip,nazwa,aktywny,created_at,last_login&order=created_at.desc");
        const konta: Konto[] = r.ok ? await r.json() : [];
        const names = await firmNames([...new Set(konta.flatMap((k) => k.nip))]);
        return json({ konta: konta.map((k) => ({ ...k, firmy: k.nip.map((n) => names.find((x) => x.nip === n)!) })), mail: !!SMTP_PASS }, 200, origin);
      }
      if (body.action === "konto_zapisz") {
        const email = String(body.email ?? "").trim().toLowerCase();
        const nip = [...new Set((Array.isArray(body.nip) ? body.nip : String(body.nip ?? "").split(/[\s,;]+/)).map(digits).filter((n: string) => n.length === 10))];
        if (!okMail(email)) return json({ error: "Wpisz poprawny adres e-mail klienta." }, 400, origin);
        if (!nip.length) return json({ error: "Podaj co najmniej jeden NIP (10 cyfr)." }, 400, origin);
        // only firms that are our clients
        const known = await db(`portal_klienci?nip=in.(${nip.join(",")})&select=nip`);
        const have = new Set((known.ok ? await known.json() : []).map((x: Any) => x.nip));
        const missing = nip.filter((n) => !have.has(n));
        if (missing.length) return json({ error: "Tych NIP nie ma w bazie klientów: " + missing.join(", ") }, 400, origin);
        const r = await db("klient_konta?on_conflict=email", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({ email, nip, nazwa: String(body.nazwa ?? "").trim().slice(0, 120) || null, aktywny: body.aktywny !== false, created_by: admin }),
        });
        if (!r.ok) return json({ error: "Nie udało się zapisać konta." }, 500, origin);
        const k = (await r.json())[0];
        // a deactivated account loses its sessions at once
        if (!k.aktywny) await db(`klient_sesje?konto_id=eq.${k.id}`, { method: "DELETE" });
        await log(k, "konto_zapis", { by: admin, nip, aktywny: k.aktywny });
        return json({ ok: true, konto: k }, 200, origin);
      }
      const id = String(body.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Brak konta." }, 400, origin);
      const kr = await db(`klient_konta?id=eq.${id}&select=*`);
      const k: Konto | null = kr.ok ? (await kr.json())[0] : null;
      if (!k) return json({ error: "Nie znaleziono konta." }, 404, origin);
      if (body.action === "konto_usun") {
        await db(`klient_konta?id=eq.${id}`, { method: "DELETE" });
        await log(k, "konto_usuniete", { by: admin });
        return json({ ok: true }, 200, origin);
      }
      // zaproszenie
      if (!k.aktywny) return json({ error: "Konto jest nieaktywne." }, 400, origin);
      const link = await makeLink(k);
      if (body.wyslij === true) {
        try { await sendLink(k, link, true); } catch (e) { return json({ error: "Nie udało się wysłać e-maila: " + String((e as Error)?.message ?? e).slice(0, 140) }, 200, origin); }
        await log(k, "zaproszenie", { by: admin });
        return json({ ok: true, wyslano: k.email }, 200, origin);
      }
      await log(k, "link_skopiowany", { by: admin });
      return json({ ok: true, link, wazny_min: LINK_MIN }, 200, origin);
    }

    // ---------------- office: requests of clients, shared documents, preview ----------------
    if (BIURO_AKCJE.includes(body.action)) {
      const s = await staff(req);
      if (!s) return json({ error: "Tylko pracownik biura (portal)." }, 403, origin);
      const o = await biuroAkcja(deps, s, body);
      return json(o.body, o.status, origin);
    }

    // ---------------- client session ----------------
    const k = await session(req);
    if (!k) return json({ error: "Sesja wygasła — zaloguj się ponownie.", wyloguj: true }, 401, origin);
    if (body.action === "logout") {
      await db(`klient_sesje?token_hash=eq.${await sha256(req.headers.get("x-klient-token") ?? "")}`, { method: "DELETE" });
      return json({ ok: true }, 200, origin);
    }
    if (body.action === "haslo_ustaw") {
      const haslo = String(body.haslo ?? "");
      if (haslo.length < MIN_HASLO || haslo.length > 200) return json({ error: `Hasło musi mieć co najmniej ${MIN_HASLO} znaków.` }, 400, origin);
      if (!/[A-Za-zÀ-ž]/.test(haslo) || !/\d/.test(haslo)) return json({ error: "Hasło musi zawierać litery i co najmniej jedną cyfrę." }, 400, origin);
      if (haslo.toLowerCase().includes(k.email.split("@")[0])) return json({ error: "Hasło nie może zawierać adresu e-mail." }, 400, origin);
      // allowed: no password yet, a fresh link session (forgotten password), or the old password given
      const stareOk = k.haslo_hash && k.haslo_salt && body.stare ? await sprawdzHaslo(String(body.stare).slice(0, 200), unb64(k.haslo_salt), k.haslo_hash) : false;
      if (k.haslo_hash && !(k.zLinku && k.swiezy) && !stareOk) return json({ error: "Aby zmienić hasło, podaj obecne hasło albo zaloguj się linkiem z e-maila." }, 403, origin);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      await db(`klient_konta?id=eq.${k.id}`, { method: "PATCH", body: JSON.stringify({ haslo_hash: await hashHaslo(haslo, salt), haslo_salt: b64(salt), haslo_ustawione: new Date().toISOString(), bledne: 0, blokada_do: null }) });
      // every other session of this account ends
      await db(`klient_sesje?konto_id=eq.${k.id}&token_hash=neq.${await sha256(req.headers.get("x-klient-token") ?? "")}`, { method: "DELETE" });
      await log(k, "haslo_ustawione");
      return json({ ok: true, firmy: await firmNames(k.nip) }, 200, origin);
    }
    // nothing is shown until the client has set the password
    if (!k.haslo_hash) return json({ error: "Najpierw ustaw hasło.", ustaw_haslo: true }, 403, origin);
    // stage 2: every action there checks the firm against the account again
    const o2 = await klientAkcja(deps, k, body, pliki);
    if (o2) return json(o2.body, o2.status, origin);
    if (body.action === "me") return json({ email: k.email, nazwa: k.nazwa, firmy: await firmNames(k.nip) }, 200, origin);
    if (body.action === "ksiegowosc") {
      const nip = digits(body.nip);
      if (!k.nip.includes(nip)) return json({ error: "Brak dostępu do tej firmy." }, 403, origin);
      return json(await accounting(nip), 200, origin);
    }
    if (body.action === "dane") {
      const nip = digits(body.nip);
      if (!k.nip.includes(nip)) return json({ error: "Brak dostępu do tej firmy." }, 403, origin);
      return json(await firmData(nip), 200, origin);
    }
    if (body.action === "dokument") {
      const id = String(body.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Brak dokumentu." }, 400, origin);
      const r = await db(`zatrudnienie_zgloszenia?id=eq.${id}&select=status,payload`);
      const row = r.ok ? (await r.json())[0] : null;
      const p = row?.payload ?? {};
      // only the firm's own packet, and only once the office has sent it for signing
      if (!row || !k.nip.includes(digits(p.z_nip)) || row.status !== "wyslane" || !okSciezka(p.komplet?.path)) return json({ error: "Dokument nie jest dostępny." }, 404, origin);
      const s = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/portal-documents/${p.komplet.path}`, {
        method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }),
      });
      const sj = s.ok ? await s.json() : null;
      if (!sj?.signedURL) return json({ error: "Nie udało się przygotować pliku." }, 502, origin);
      await log(k, "pobranie_kompletu", { id });
      return json({ url: `${SUPABASE_URL}/storage/v1${sj.signedURL}`, nazwa: p.komplet.filename ?? "komplet.pdf" }, 200, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
