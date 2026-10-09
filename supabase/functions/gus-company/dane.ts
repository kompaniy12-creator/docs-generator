// GUS (REGON) through DataPort for the public lookups: checksum first, our own cache, caps, and never
// the provider's own words to the caller. Used by gus-company and klient-by-nip.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DATAPORT_KEY = Deno.env.get("DATAPORT_API_KEY") ?? "";
const DP_BASE = "https://dataport.pl/api/v1/company/";
const CACHE_DNI = 30;        // a firm found is asked again after this many days
const CACHE_BRAK_DNI = 2;    // "no such firm" is remembered shorter
export const MAX_GUS_DZIEN = 300;     // requests to the provider a day, everybody together
export const MAX_GUS_IP_DZIEN = 20;   // ... and from one address

// deno-lint-ignore no-explicit-any
type Any = any;
export type Gus = { nazwa: string; regon: string; adres: string };
export type WynikGus = { stan: "ok"; dane: Gus } | { stan: "brak" } | { stan: "limit" } | { stan: "niedostepne" };

export function nipOk(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const s = w.reduce((a, x, i) => a + x * Number(nip[i]), 0) % 11;
  return s !== 10 && s === Number(nip[9]);
}
// "ul. Przykładowa 1 /2 00-000 Warszawa" -> { ulica, kod, miasto }
export function parseAdres(adres: string) {
  const out = { ulica: "", kod: "", miasto: "" };
  if (!adres) return out;
  const m = adres.match(/(\d{2}-\d{3})/);
  if (m && m.index != null) {
    out.kod = m[1];
    out.ulica = adres.slice(0, m.index).trim();
    out.miasto = adres.slice(m.index + m[1].length).trim();
  } else out.ulica = adres.trim();
  out.ulica = out.ulica.replace(/\s*\/\s*/g, "/").replace(/\s{2,}/g, " ").trim();
  return out;
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
// the caller's address as a short hash: enough to count, nothing to identify a person by
export async function ipKlucz(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "nieznany";
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("td-portal|" + ip)));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// atomic daily counter (the same one the clients base uses); a broken counter refuses rather than lets through
export async function limit(klucz: string, max: number): Promise<boolean> {
  try {
    const r = await db("rpc/klienci_limit", { method: "POST", body: JSON.stringify({ p_klucz: klucz.slice(0, 80), p_max: max, p_ile: 1 }) });
    return r.ok && (await r.json()) === true;
  } catch (_e) { return false; }
}
const tekst = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

// One firm from REGON. `ip`: the caller's key for the per-address cap (null = a caller already limited elsewhere).
export async function gusFirma(nip: string, ip: string | null): Promise<WynikGus> {
  if (!nipOk(nip)) return { stan: "brak" };
  try {
    const c = await db(`portal_gus_cache?nip=eq.${nip}&select=znaleziono,dane,fetched_at`);
    const row = c.ok ? (await c.json())[0] : null;
    if (row && Date.now() - Date.parse(row.fetched_at) < (row.znaleziono ? CACHE_DNI : CACHE_BRAK_DNI) * 86400000) {
      return row.znaleziono ? { stan: "ok", dane: { nazwa: tekst(row.dane?.nazwa, 300), regon: tekst(row.dane?.regon, 14), adres: tekst(row.dane?.adres, 300) } } : { stan: "brak" };
    }
  } catch (_e) { /* no cache: ask the provider within the caps */ }
  if (!DATAPORT_KEY) return { stan: "niedostepne" };
  if (ip && !(await limit("gus-ip:" + ip, MAX_GUS_IP_DZIEN))) return { stan: "limit" };
  if (!(await limit("gus", MAX_GUS_DZIEN))) return { stan: "limit" };
  let res: Response, d: Any;
  try {
    res = await fetch(DP_BASE + nip, { headers: { "X-API-Key": DATAPORT_KEY, Accept: "application/json" } });
    d = await res.json().catch(() => ({}));
  } catch (_e) { console.error("gus: brak połączenia z dostawcą"); return { stan: "niedostepne" }; }
  const msg = String(d?.message ?? d?.error ?? "");
  const zapisz = (znaleziono: boolean, dane: Any) => db("portal_gus_cache", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ nip, znaleziono, dane, fetched_at: new Date().toISOString() }) }).then((r) => r.body?.cancel()).catch(() => {});
  if (res.status === 404 || (d?.success === false && /nie znaleziono|nie odnaleziono|nie istnieje|brak podmiotu|not found/i.test(msg))) { await zapisz(false, {}); return { stan: "brak" }; }
  if (!res.ok || d?.success === false || !(d?.nazwa || d?.regon)) {
    // an inactive key, a limit on the provider's side, an outage: the status goes to the log, never to the caller
    console.error("gus: dostawca odmówił, HTTP", res.status);
    return { stan: "niedostepne" };
  }
  const dane: Gus = { nazwa: tekst(d.nazwa, 300), regon: tekst(d.regon, 14), adres: tekst(d.adres, 300) };
  await zapisz(true, dane);
  return { stan: "ok", dane };
}
