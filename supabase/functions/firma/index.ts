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
  return { admin, sec };
}
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ODPISY_DZIENNIE = 40; // paid KRS extracts fetched per day by the whole office
// how many extracts were fetched from the register today (the cache keeps the fetch time)
async function odpisyDzis(): Promise<number> {
  const od = new Date().toISOString().slice(0, 10);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/portal_odpisy_cache?select=krs&fetched_at=gte.${od}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Prefer: "count=exact", Range: "0-0" } });
  return Number((r.headers.get("content-range") ?? "").split("/")[1]) || 0;
}
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
      return json({ hits: await searchFirmy(q.slice(0, 120)) }, 200, origin);
    }
    //   ?odpis=KRS -> { pdf (base64), pobrano } — the current KRS extract, for PESEL numbers
    //   the extract carries PESEL numbers: only for the sections whose forms need them, and capped per day
    if (odpis) {
      if (!kto.sec("biezaca") && !kto.sec("rejestracja")) return json({ error: "Brak dostępu do odpisu KRS." }, 403, origin);
      if (await odpisyDzis() >= ODPISY_DZIENNIE) return json({ error: "Dzienny limit odpisów KRS został wykorzystany — spróbuj jutro." }, 429, origin);
      return json(await getOdpis(odpis.padStart(10, "0"), fresh), 200, origin);
    }
    //   ?krs=KRS -> the same firm data as by NIP
    if (krs) return json(await getFirma("", fresh, krs.padStart(10, "0")), 200, origin);
    if (nip.length !== 10) return json({ error: "Nieprawidłowy NIP (10 cyfr)." }, 400, origin);
    return json(await getFirma(nip, fresh), 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Nie udało się pobrać danych z rejestr.io (" + String((e as Error)?.message ?? e).slice(0, 120) + ")." }, 502, origin);
  }
});
