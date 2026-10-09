// Company data + the people who may sign for the company, from rejestr.io (KRS).
// PORTAL ONLY (JWT with app_metadata.portal === true): every lookup is paid from
// the office's rejestr.io account, so it is not exposed to the public form.
//   GET ?nip=1234567890[&fresh=1]
//   -> { found, nip, regon, krs, nazwa, forma, ulica, kod, miasto,
//        reprezentacja: { organ, sposob, osoby: [{ imie_nazwisko, funkcja }] },
//        prokurenci: [{ imie_nazwisko, rodzaj }], zrodlo, pobrano }
// A firm is fetched from rejestr.io once and then always served from our own base
// (portal_firmy_cache); fresh=1 re-reads it from the register (paid) when someone
// asks for it explicitly. The logic lives in ../_shared/firma.ts, which the public
// client form also uses through klient-by-nip. Sole proprietors are not in KRS -> { found: false }.

import { firmaConfigured, getFirma, getOdpis, searchFirmy } from "../_shared/firma.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
async function requirePortal(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (m.portal !== true) return false;
  const admin = m.portal_admin === true;
  const sec = (x: string) => admin || !Array.isArray(m.portal_sections) || m.portal_sections.includes(x);
  return { admin, sec, id: String(u.id ?? "") };
}
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ODPISY_DZIENNIE = 40; // paid KRS extracts fetched per day by the whole office
// how many extracts were fetched from the register today (the cache keeps the fetch time)
async function odpisyDzis(): Promise<number> {
  const od = new Date().toISOString().slice(0, 10);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/portal_odpisy_cache?select=krs&fetched_at=gte.${od}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Prefer: "count=exact", Range: "0-0" } });
  return Number((r.headers.get("content-range") ?? "").split("/")[1]) || 0;
}
// ---- every request to rejestr.io is paid: a daily cap per person for what is not already in our base
const MAX_FIRM_OSOBA = 80;     // firms read from the register (not from the cache) by one person a day
const MAX_SZUKAN_OSOBA = 200;  // searches by one person a day
const rest = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
async function ile(klucz: string): Promise<number> {
  try {
    const r = await rest(`klienci_limity?dzien=eq.${new Date().toISOString().slice(0, 10)}&klucz=eq.${encodeURIComponent(klucz)}&select=n`);
    return r.ok ? Number((await r.json())[0]?.n ?? 0) : 0;
  } catch (_e) { return 0; }
}
async function policz(klucz: string) {
  try { const r = await rest("rpc/klienci_limit", { method: "POST", body: JSON.stringify({ p_klucz: klucz, p_max: 1000000, p_ile: 1 }) }); await r.body?.cancel(); } catch (_e) { /* the counter is best effort */ }
}
async function wBazie(filtr: string, tabela = "portal_firmy_cache", kol = "nip"): Promise<boolean> {
  try { const r = await rest(`${tabela}?${filtr}&select=${kol}&limit=1`); return r.ok && (await r.json()).length > 0; } catch (_e) { return false; }
}
const LIMIT_OSOBY = "Dzienny limit zapytań do rejestru dla jednej osoby został wykorzystany — spróbuj jutro albo poproś administratora.";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405, origin);
  const kto = await requirePortal(req);
  if (!kto) return json({ error: "Brak dostępu (portal)." }, 403, origin);
  if (!firmaConfigured()) return json({ error: "Brak konfiguracji REJESTR_IO_KEY." }, 500, origin);

  const url = new URL(req.url);
  const fresh = !!url.searchParams.get("fresh") && kto.admin; // a paid re-fetch past the cache: administrators only
  const q = (url.searchParams.get("q") ?? "").trim();
  const krs = (url.searchParams.get("krs") ?? "").replace(/\D/g, "");
  const odpis = (url.searchParams.get("odpis") ?? "").replace(/\D/g, "");
  const nip = (url.searchParams.get("nip") ?? "").replace(/\D/g, "");
  try {
    //   ?q=name | NIP | KRS | REGON  -> { hits: [{ krs, nip, nazwa, miasto, forma, wykreslona }] }
    if (q) {
      if (q.length < 3) return json({ error: "Wpisz co najmniej 3 znaki." }, 400, origin);
      if (await ile("firma-q:" + kto.id) >= MAX_SZUKAN_OSOBA) return json({ error: LIMIT_OSOBY }, 429, origin);
      await policz("firma-q:" + kto.id);
      return json({ hits: await searchFirmy(q.slice(0, 120)) }, 200, origin);
    }
    //   ?odpis=KRS -> { pdf (base64), pobrano } — the current KRS extract, for PESEL numbers
    //   the extract carries PESEL numbers: only for the sections whose forms need them, and capped per day
    if (odpis) {
      if (!kto.sec("biezaca") && !kto.sec("rejestracja")) return json({ error: "Brak dostępu do odpisu KRS." }, 403, origin);
      // an extract already in our base costs nothing: the cap is only for what must be fetched
      const wPamieci = !fresh && await wBazie(`krs=eq.${odpis.padStart(10, "0")}`, "portal_odpisy_cache", "krs");
      if (!wPamieci && await odpisyDzis() >= ODPISY_DZIENNIE) return json({ error: "Dzienny limit odpisów KRS został wykorzystany — spróbuj jutro." }, 429, origin);
      return json(await getOdpis(odpis.padStart(10, "0"), fresh), 200, origin);
    }
    //   ?krs=KRS -> the same firm data as by NIP
    if (!krs && nip.length !== 10) return json({ error: "Nieprawidłowy NIP (10 cyfr)." }, 400, origin);
    // over the personal cap only what is already in our base is served
    if (await ile("firma:" + kto.id) >= MAX_FIRM_OSOBA) {
      const mamy = !fresh && await wBazie(krs ? `data->>krs=eq.${krs.padStart(10, "0")}` : `nip=eq.${nip}`);
      if (!mamy) return json({ error: LIMIT_OSOBY }, 429, origin);
    }
    const f = krs ? await getFirma("", fresh, krs.padStart(10, "0")) : await getFirma(nip, fresh);
    if (f?.z_pamieci === false) await policz("firma:" + kto.id);
    return json(f, 200, origin);
  } catch (e) {
    console.error("firma", String((e as Error)?.message ?? e).slice(0, 200));
    return json({ error: "Nie udało się pobrać danych z rejestru — spróbuj ponownie za chwilę." }, 502, origin);
  }
});
