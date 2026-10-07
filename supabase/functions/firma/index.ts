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

import { firmaConfigured, getFirma } from "../_shared/firma.ts";

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
  return u?.app_metadata?.portal === true;
}
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405, origin);
  if (!(await requirePortal(req))) return json({ error: "Brak dostępu (portal)." }, 403, origin);
  if (!firmaConfigured()) return json({ error: "Brak konfiguracji REJESTR_IO_KEY." }, 500, origin);

  const url = new URL(req.url);
  const nip = (url.searchParams.get("nip") ?? "").replace(/\D/g, "");
  if (nip.length !== 10) return json({ error: "Nieprawidłowy NIP (10 cyfr)." }, 400, origin);
  try {
    return json(await getFirma(nip, !!url.searchParams.get("fresh")), 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Nie udało się pobrać danych z rejestr.io (" + String((e as Error)?.message ?? e).slice(0, 120) + ")." }, 502, origin);
  }
});
