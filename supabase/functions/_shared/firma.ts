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

// persons of a list (board / shareholders) with what the document generators need
function persons(list: Any, extra: (o: Any) => Record<string, unknown>): Any[] {
  const out: Any[] = [];
  for (const os of arr(list)) {
    if (!current(os.person)) continue;
    const p = val(os.person) ?? {};
    if (!p.nazwisko && !p.nazwa) continue;
    out.push({ imie: (p.imie ?? "").toUpperCase(), nazwisko: (p.nazwisko ?? p.nazwa ?? "").toUpperCase(), dataUr: p.data_urodzenia ?? "", ...extra(os) });
  }
  return out;
}

// id: "nip1234567890" or a KRS number
async function lookup(id: string) {
  const nip = id.startsWith("nip") ? id.slice(3) : "";
  const [orgRes, chRes] = await Promise.all([rio(`org/${id}`), rio(`org/${id}/krs-rozdzialy/ogolny`)]);
  if (orgRes.status === 404) return { found: false, nip };
  if (!orgRes.ok) throw new Error("rejestr.io HTTP " + orgRes.status + " " + (orgRes.headers.get("content-type") ?? "") + " " + (orgRes.headers.get("server") ?? ""));
  const org = await orgRes.json();
  const ch: Any = chRes.ok ? await chRes.json() : {};

  const a = org.adres ?? {};
  const ach = val(ch.adres) ?? {};
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
    // the same shape the generators used to get from a parsed KRS extract
    adres: {
      ulica: (ach.ulica ?? a.ulica ?? "").toUpperCase(), nrDomu: String(ach.nr_domu ?? a.nr_domu ?? ""),
      nrLokalu: String(ach.nr_mieszkania ?? a.nr_mieszkania ?? ""), kodPocztowy: ach.kod_pocztowy ?? a.kod ?? "",
      miejscowosc: (ach.miasto ?? a.miejscowosc ?? "").toUpperCase(),
    },
    kapital: val(ch.wysokosc_kapitalu_zakladowego)?.kwota ?? null,
    zarzad: persons(organ.dane_osob?._obiekty, (os) => ({
      funkcja: val(os.funkcja_w_organie)?.nazwa ?? "",
      zawieszony: val(os.czy_osoba_wchodzaca_w_sklad_zarzadu_zostala_zawieszona_w_czynnosciach) === "TAK",
    })).filter((p) => !p.zawieszony),
    wspolnicy: persons(ch.dane_wspolnikow?._obiekty, (os) => ({
      udzialy: val(os.posiadane_przez_wspolnika_udzialy__liczba) ?? null, udzialyOpis: val(os.posiadane_przez_wspolnika_udzialy) ?? "",
    })),
    v: 2,
    zrodlo: "rejestr.io (KRS)",
  };
}

// Search of the whole KRS: by name, or directly by NIP / KRS / REGON.
export async function searchFirmy(q: string): Promise<Any[]> {
  const digits = q.replace(/[\s-]/g, "");
  const params = new URLSearchParams();
  if (/^\d{10}$/.test(digits) && !digits.startsWith("000")) params.set("nip", digits);
  else if (/^\d{9}$|^\d{14}$/.test(digits)) params.set("regon", digits);
  else if (/^\d{1,10}$/.test(digits)) {
    const r = await rio(`org/${digits}`);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error("rejestr.io HTTP " + r.status);
    return [hit(await r.json())];
  } else params.set("nazwa", q.trim());
  const r = await rio(`org?${params}`);
  if (!r.ok) throw new Error("rejestr.io HTTP " + r.status);
  const j = await r.json();
  const list: Any[] = Array.isArray(j) ? j : (j.wyniki ?? j.organizacje ?? j.dane ?? j.items ?? Object.values(j).find((v) => Array.isArray(v)) ?? []);
  return list.filter((o) => o?.numery).slice(0, 20).map(hit);
}
function hit(o: Any) {
  return {
    krs: o.numery?.krs ?? "", nip: o.numery?.nip ?? "", regon: o.numery?.regon ?? "",
    nazwa: o.nazwy?.pelna ?? o.nazwy?.skrocona ?? "", miasto: o.adres?.miejscowosc ?? "",
    forma: nice(o.stan?.forma_prawna ?? ""), wykreslona: o.stan?.czy_wykreslona === true,
  };
}

// The official current KRS extract (PDF) — the only source of PESEL numbers. Kept in our base.
export async function getOdpis(krs: string, fresh = false): Promise<{ pdf: string; pobrano: string; z_pamieci: boolean }> {
  if (!fresh) {
    const c = await db(`portal_odpisy_cache?krs=eq.${krs}&select=pdf,fetched_at`);
    const row = c.ok ? (await c.json())[0] : null;
    if (row) return { pdf: row.pdf, pobrano: row.fetched_at, z_pamieci: true };
  }
  const r = await fetch(`${API}/org/${krs}/krs-odpisy?typ=aktualny`, { headers: { Authorization: KEY, Accept: "application/pdf" } });
  if (!r.ok) throw new Error("rejestr.io odpis HTTP " + r.status);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const pdf = btoa(bin), now = new Date().toISOString();
  await db("portal_odpisy_cache", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ krs, pdf, fetched_at: now }) });
  return { pdf, pobrano: now, z_pamieci: false };
}


// One firm by NIP (or by KRS number when `krs` is given). Fetched from the register once,
// then served from our base; rows saved before the full shape (v2) are re-read once.
// deno-lint-ignore no-explicit-any
export async function getFirma(nip: string, fresh = false, krs = ""): Promise<any> {
  if (!fresh) {
    const c = await db(nip ? `portal_firmy_cache?nip=eq.${nip}&select=data,fetched_at` : `portal_firmy_cache?data->>krs=eq.${krs}&select=data,fetched_at`);
    const row = c.ok ? (await c.json())[0] : null;
    if (row && (row.data?.v === 2 || row.data?.found === false)) return { ...row.data, pobrano: row.fetched_at, z_pamieci: true };
  }
  const data = await lookup(nip ? `nip${nip}` : krs);
  const now = new Date().toISOString();
  const key = String((data as Any).nip || nip || "");
  if (/^\d{10}$/.test(key)) {
    await db("portal_firmy_cache", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ nip: key, data, fetched_at: now }),
    });
  }
  return { ...data, pobrano: now, z_pamieci: false };
}
