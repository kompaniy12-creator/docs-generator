// Clients list (the portal's private copy of the clients sheet) — PORTAL ONLY. Requires a Supabase JWT with
// app_metadata.portal === true and the section Kadry or Księgowość. It feeds the registry page and the firm
// pickers of rejestr / akta / import / dokumenty / ksiegowosc, so it does NOT depend on the page "Baza klientów"
// (klienci.baza) being switched on for the person.
//   -> { clients: [{ nazwa, nip, adres, forma, opodatkowanie, miasto, opiekun, kadrowy,
//                    telefon, email, kontakt, telegram, jezyk }], kontakty: boolean }
// Contact data (telefon, email, kontakt, telegram, jezyk) are filled only for a person who has the section
// Kadry AND the function "Dane kontaktowe klientów" (klienci.baza.kontakty) — the same rule as the `lista`
// action of klienci-baza. For everybody else the five fields come back empty and `kontakty` is false: an
// account limited to Księgowość gets what its page needs (name, NIP, form, taxation, address, carers) and
// nothing more.

import { type KlientRow, loadKlienciRows } from "../_shared/klienci.ts";
import { mozna, wylaczone, type Wyl } from "../_shared/uprawnienia.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// The portal's own pages may read how long each step took (Server-Timing: durations only, no data);
// the preflight answer is remembered by the browser, so each call is one request instead of two.
const PORTAL_ORIGIN = "https://docgenerator.td-group.pl";
function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
    "Access-Control-Max-Age": "7200", "Access-Control-Expose-Headers": "Server-Timing", ...(origin === PORTAL_ORIGIN ? { "Timing-Allow-Origin": origin } : {}),
  };
}
function stoper() {
  const t0 = performance.now(), kroki: string[] = [];
  return {
    m<T>(nazwa: string, p: Promise<T>): Promise<T> { const s = performance.now(); return p.finally(() => { kroki.push(`${nazwa};dur=${(performance.now() - s).toFixed(1)}`); }); },
    naglowek: () => [...kroki, `total;dur=${(performance.now() - t0).toFixed(1)}`].join(", "),
  };
}
type Stoper = ReturnType<typeof stoper>;
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}

// Uprawnienia szczegółowe: the contact fields of a client and the key that guards them
const KLUCZ_KONTAKTY = "klienci.baza.kontakty";
const KONTAKTOWE: (keyof KlientRow)[] = ["telefon", "email", "kontakt", "telegram", "jezyk"];
type Ja = { admin: boolean; kadry: boolean; ksiegowosc: boolean; wyl: Wyl };
async function requirePortal(req: Request): Promise<Ja | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (m.portal !== true) return null;
  // section access: admins and accounts without a portal_sections list have every section
  const admin = m.portal_admin === true, sec = (x: string) => admin || !Array.isArray(m.portal_sections) || m.portal_sections.includes(x);
  return { admin, kadry: sec("kadry"), ksiegowosc: sec("onboarding"), wyl: wylaczone(m) };
}

Deno.serve(async (req) => {
  const t = stoper();
  const res = await obsluz(req, t);
  res.headers.set("Server-Timing", t.naglowek());
  return res;
});
async function obsluz(req: Request, t: Stoper): Promise<Response> {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const ja = await t.m("auth", requirePortal(req));
  if (!ja || !(ja.kadry || ja.ksiegowosc)) return json({ error: "Brak dostępu (portal)." }, 403, origin);
  // a switch-off list that cannot be read closes everything (as in every other function)
  if (!ja.admin && ja.wyl === "blad") return json({ error: "Uprawnienia tego konta są zapisane nieprawidłowo — zgłoś to administratorowi portalu.", kod: "wylaczone", klucz: "" }, 403, origin);
  const kontakty = ja.kadry && mozna(ja, KLUCZ_KONTAKTY);

  try {
    const rows = await t.m("klienci", loadKlienciRows());
    if (!kontakty) for (const k of rows) for (const p of KONTAKTOWE) k[p] = "";
    return json({ clients: rows, kontakty }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Nie udało się odczytać bazy klientów." }, 502, origin);
  }
}
