// Full clients list (the portal's private copy of the clients sheet) — PORTAL ONLY (returns internal
// columns: phone, e-mail, Telegram chat id, opiekun, kadrowy, język). Requires a
// Supabase JWT with app_metadata.portal === true. Used by the registry page.

import { loadKlienciRows } from "../_shared/klienci.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  // section access: admins and accounts without a portal_sections list have every section
  const secs = u?.app_metadata?.portal_sections;
  const kadry = u?.app_metadata?.portal_admin === true || !Array.isArray(secs) || secs.includes("kadry");
  return u?.app_metadata?.portal === true && kadry;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (!(await requirePortal(req))) return json({ error: "Brak dostępu (portal)." }, 403, origin);

  try {
    return json({ clients: await loadKlienciRows() }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Nie udało się odczytać bazy klientów." }, 502, origin);
  }
});
