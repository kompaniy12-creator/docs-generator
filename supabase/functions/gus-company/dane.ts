// A firm's register data by NIP for the lookups in forms: checksum first, our own cache, caps, and never
// the provider's own words to the caller. Used by gus-company, klient-by-nip and umowy.
// The sources are those of _shared/jdg.ts: CEIDG (official), GUS / REGON through DataPort, and — without any
// key, basic data only — MF's register of VAT payers.

import { BladJdg, doZapisu, type Jdg, pobierzJdg, zrodlaJdg } from "../_shared/jdg.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CACHE_DNI = 30;        // a firm found is asked again after this many days
const CACHE_BRAK_DNI = 2;    // "no such firm" is remembered shorter
const CACHE_MF_DNI = 7;      // MF's basic record; once CEIDG / GUS is connected it is replaced after a day
const MF_KLUCZ = "mf-search"; // MF allows 100 "search" requests a day: the counter shared with the clients base
const MF_DZIENNIE = 80;       // ... of which single lookups take at most this many (the bulk refresh stops at 60)
export const MAX_GUS_DZIEN = 300;     // requests to the provider a day, everybody together
export const MAX_GUS_IP_DZIEN = 20;   // ... and from one address

// deno-lint-ignore no-explicit-any
type Any = any;
export type Gus = { nazwa: string; regon: string; adres: string };
export type WynikGus = { stan: "ok"; dane: Gus } | { stan: "brak" } | { stan: "limit" } | { stan: "niedostepne" };
// the whole normalised record (owner, dates, PKD, where it came from); brak.powod says which sources did not know the NIP
export type WynikJdg = { stan: "ok"; dane: Omit<Jdg, "proby">; pobrano: string; z_pamieci: boolean } | { stan: "brak"; powod: string } | { stan: "limit" } | { stan: "niedostepne" };

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
  out.ulica = out.ulica.replace(/\s*\/\s*/g, "/").replace(/\s{2,}/g, " ").replace(/[\s,]+$/, "").trim();
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

// One firm by NIP, whole record. `ip`: the caller's key for the per-address cap (null = a caller already limited
// elsewhere). `swieze`: ask the sources even when the cache holds an answer.
export async function jdgFirma(nip: string, ip: string | null, swieze = false): Promise<WynikJdg> {
  if (!nipOk(nip)) return { stan: "brak", powod: "nieprawidłowy NIP" };
  const zr = zrodlaJdg();
  try {
    const c = await db(`portal_gus_cache?nip=eq.${nip}&select=znaleziono,dane,fetched_at`);
    const row = c.ok ? (await c.json())[0] : null;
    const wiek = row ? Date.now() - Date.parse(row.fetched_at) : Infinity;
    const mf = row?.dane?.zrodlo === "mf";
    const waznosc = (mf ? (zr.ceidg || zr.gus ? 1 : CACHE_MF_DNI) : row?.znaleziono ? CACHE_DNI : CACHE_BRAK_DNI) * 86400000;
    if (row && !swieze && wiek < waznosc) {
      if (!row.znaleziono) return { stan: "brak", powod: tekst(row.dane?.powod, 120) || "brak w rejestrze REGON" };
      // rows written before the sources were joined hold { nazwa, regon, adres } only
      return { stan: "ok", dane: { ...PUSTY, ...row.dane, nip, zrodlo: row.dane?.zrodlo ?? "gus", znaleziono: true }, pobrano: row.fetched_at, z_pamieci: true };
    }
  } catch (_e) { /* no cache: ask the sources within the caps */ }
  if (ip && !(await limit("gus-ip:" + ip, MAX_GUS_IP_DZIEN))) return { stan: "limit" };
  if (!(await limit("gus", MAX_GUS_DZIEN))) return { stan: "limit" };
  let j: Jdg;
  try { j = await pobierzJdg(nip, { mfWolno: () => limit(MF_KLUCZ, MF_DZIENNIE) }); }
  catch (e) {
    // an inactive key, a limit on the provider's side, an outage: which source and how goes to the log, never to the caller
    const b = e instanceof BladJdg ? e : null;
    console.error("gus:", b ? b.proby.map((x) => x.zrodlo + " " + x.wynik.slice(0, 80)).join("; ") : "błąd");
    return { stan: b?.limit ? "limit" : "niedostepne" };
  }
  const teraz = new Date().toISOString();
  const zapisz = (znaleziono: boolean, dane: Any) => db("portal_gus_cache", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ nip, znaleziono, dane, fetched_at: teraz }) }).then((r) => r.body?.cancel()).catch(() => {});
  if (!j.znaleziono) { await zapisz(false, { zrodlo: j.zrodlo, powod: j.powod ?? "" }); return { stan: "brak", powod: j.powod ?? "" }; }
  const dane = doZapisu(j);
  await zapisz(true, dane);
  return { stan: "ok", dane, pobrano: teraz, z_pamieci: false };
}
const PUSTY = { nazwa: null, imie: null, nazwisko: null, regon: null, forma: null, adres: null, adres_doreczen: null, data_rozpoczecia: null, status: null, data_zawieszenia: null, data_wznowienia: null,
  data_zakonczenia: null, data_wykreslenia: null, pkd_glowne: null, pkd: [], status_vat: null, vat_od: null, vat_wykreslenie: null, vat_przywrocenie: null, podstawowe: false };

// The same, cut down to what a form's employer section fills in.
export async function gusFirma(nip: string, ip: string | null): Promise<WynikGus & { zrodlo?: string; powod?: string }> {
  const w = await jdgFirma(nip, ip);
  if (w.stan === "brak") return { stan: "brak", powod: w.powod };
  if (w.stan !== "ok") return w;
  return { stan: "ok", zrodlo: w.dane.zrodlo, dane: { nazwa: tekst(w.dane.nazwa, 300), regon: tekst(w.dane.regon, 14), adres: tekst(w.dane.adres, 300) } };
}
