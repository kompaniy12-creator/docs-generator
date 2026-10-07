// Our base of firms: registry data and signatories from rejestr.io (KRS).
// A firm is fetched from the register once (paid per request) and then always
// served from portal_firmy_cache; `fresh` re-reads it on explicit request.
// Used by the `firma` function (portal) and by `klient-by-nip` (public form,
// only for firms that are already our clients).

const KEY = Deno.env.get("REJESTR_IO_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const API = "https://rejestr.io/api/v2";

export const firmaConfigured = () => !!KEY;

function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
function rio(path: string) {
  return fetch(`${API}/${path}`, { headers: { Authorization: KEY } });
}

// "Jan KOWALSKI" style names come in upper case from KRS
function nice(s: string) {
  return (s || "").toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
}
// deno-lint-ignore no-explicit-any
type Any = any;
// a KRS chapter wraps values as { _wartosc, _zakres }; an entry struck off has wpis_wykreslajacy_numer
const val = (o: Any) => (o && typeof o === "object" && "_wartosc" in o ? o._wartosc : o);
// lists in a chapter are objects keyed by an id, not arrays
const arr = (o: Any): Any[] => (Array.isArray(o) ? o : o && typeof o === "object" ? Object.values(o) : []);
const current = (o: Any) => !(o?._zakres?.wpis_wykreslajacy_numer);

function people(list: Any[]): Array<{ imie_nazwisko: string; funkcja: string }> {
  const out: Array<{ imie_nazwisko: string; funkcja: string }> = [];
  for (const os of arr(list)) {
    if (!current(os.person) || !current(os.funkcja_w_organie)) continue;
    const p = val(os.person) ?? {};
    const name = [p.imie, p.nazwisko].filter(Boolean).join(" ") || p.nazwa || "";
    if (!name) continue;
    if (val(os.czy_osoba_wchodzaca_w_sklad_zarzadu_zostala_zawieszona_w_czynnosciach) === "TAK") continue;
    out.push({ imie_nazwisko: nice(name), funkcja: nice(val(os.funkcja_w_organie)?.nazwa ?? "") });
  }
  return out;
}

async function lookup(nip: string) {
  const [orgRes, chRes] = await Promise.all([rio(`org/nip${nip}`), rio(`org/nip${nip}/krs-rozdzialy/ogolny`)]);
  if (orgRes.status === 404) return { found: false, nip };
  if (!orgRes.ok) throw new Error("rejestr.io HTTP " + orgRes.status + " " + (orgRes.headers.get("content-type") ?? "") + " " + (orgRes.headers.get("server") ?? ""));
  const org = await orgRes.json();
  const ch: Any = chRes.ok ? await chRes.json() : {};

  const a = org.adres ?? {};
  const organy: Any[] = arr(ch.organ_reprezentacji?._obiekty).filter((o: Any) => current(o.nazwa_organu_reprezentacji_podmiotu));
  const organ = organy[0] ?? {};
  const prok: Any[] = arr(ch.prokurenci?._obiekty);
  return {
    found: true,
    nip: org.numery?.nip ?? nip,
    regon: org.numery?.regon ?? "",
    krs: org.numery?.krs ?? "",
    nazwa: org.nazwy?.pelna ?? "",
    forma: nice(org.stan?.forma_prawna ?? ""),
    ulica: [a.ulica, [a.nr_domu, a.nr_mieszkania].filter(Boolean).join("/")].filter(Boolean).join(" "),
    kod: a.kod ?? "",
    miasto: a.miejscowosc ?? "",
    reprezentacja: {
      organ: val(organ.nazwa_organu_reprezentacji_podmiotu) ?? "",
      sposob: val(organ.sposob_reprezentacji_podmiotu) ?? "",
      osoby: people(organ.dane_osob?._obiekty),
    },
    prokurenci: prok.filter((p) => current(p.person)).map((p) => {
      const v = val(p.person) ?? {};
      return { imie_nazwisko: nice([v.imie, v.nazwisko].filter(Boolean).join(" ")), rodzaj: nice(val(p.rodzaj_prokury) ?? "") };
    }).filter((p) => p.imie_nazwisko),
    zrodlo: "rejestr.io (KRS)",
  };
}


// deno-lint-ignore no-explicit-any
export async function getFirma(nip: string, fresh = false): Promise<any> {
  if (!fresh) {
    const c = await db(`portal_firmy_cache?nip=eq.${nip}&select=data,fetched_at`);
    const row = c.ok ? (await c.json())[0] : null;
    if (row) return { ...row.data, pobrano: row.fetched_at, z_pamieci: true };
  }
  const data = await lookup(nip);
  const now = new Date().toISOString();
  await db("portal_firmy_cache", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ nip, data, fetched_at: now }),
  });
  return { ...data, pobrano: now, z_pamieci: false };
}
