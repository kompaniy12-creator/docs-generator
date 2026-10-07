// Company data + the people who may sign for the company, from rejestr.io (KRS).
// PORTAL ONLY (JWT with app_metadata.portal === true): every lookup is paid from
// the office's rejestr.io account, so it is not exposed to the public form.
//   GET ?nip=1234567890[&fresh=1]
//   -> { found, nip, regon, krs, nazwa, forma, ulica, kod, miasto,
//        reprezentacja: { organ, sposob, osoby: [{ imie_nazwisko, funkcja }] },
//        prokurenci: [{ imie_nazwisko, rodzaj }], zrodlo, pobrano }
// Results are cached in portal_firmy_cache for CACHE_DAYS; fresh=1 forces a new
// (paid) request. Sole proprietors are not in KRS -> { found: false }.

const KEY = Deno.env.get("REJESTR_IO_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const API = "https://rejestr.io/api/v2";
const CACHE_DAYS = 30;

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
const current = (o: Any) => !(o?._zakres?.wpis_wykreslajacy_numer);

function people(list: Any[]): Array<{ imie_nazwisko: string; funkcja: string }> {
  const out: Array<{ imie_nazwisko: string; funkcja: string }> = [];
  for (const os of list ?? []) {
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
  if (!orgRes.ok) throw new Error("rejestr.io " + orgRes.status);
  const org = await orgRes.json();
  const ch: Any = chRes.ok ? await chRes.json() : {};

  const a = org.adres ?? {};
  const organy: Any[] = (ch.organ_reprezentacji?._obiekty ?? []).filter((o: Any) => current(o.nazwa_organu_reprezentacji_podmiotu));
  const organ = organy[0] ?? {};
  const prok: Any[] = ch.prokurenci?._obiekty ?? [];
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
      osoby: people(organ.dane_osob?._obiekty ?? []),
    },
    prokurenci: prok.filter((p) => current(p.person)).map((p) => {
      const v = val(p.person) ?? {};
      return { imie_nazwisko: nice([v.imie, v.nazwisko].filter(Boolean).join(" ")), rodzaj: nice(val(p.rodzaj_prokury) ?? "") };
    }).filter((p) => p.imie_nazwisko),
    zrodlo: "rejestr.io (KRS)",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405, origin);
  if (!(await requirePortal(req))) return json({ error: "Brak dostępu (portal)." }, 403, origin);
  if (!KEY) return json({ error: "Brak konfiguracji REJESTR_IO_KEY." }, 500, origin);

  const url = new URL(req.url);
  const nip = (url.searchParams.get("nip") ?? "").replace(/\D/g, "");
  if (nip.length !== 10) return json({ error: "Nieprawidłowy NIP (10 cyfr)." }, 400, origin);

  try {
    if (!url.searchParams.get("fresh")) {
      const c = await db(`portal_firmy_cache?nip=eq.${nip}&select=data,fetched_at`);
      const row = c.ok ? (await c.json())[0] : null;
      if (row && Date.now() - new Date(row.fetched_at).getTime() < CACHE_DAYS * 86400000) {
        return json({ ...row.data, pobrano: row.fetched_at, z_pamieci: true }, 200, origin);
      }
    }
    const data = await lookup(nip);
    const now = new Date().toISOString();
    await db("portal_firmy_cache", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ nip, data, fetched_at: now }),
    });
    return json({ ...data, pobrano: now, z_pamieci: false }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Nie udało się pobrać danych z rejestr.io." }, 502, origin);
  }
});
