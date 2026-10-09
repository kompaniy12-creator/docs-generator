// Sole traders (JDG) by NIP — one normalised record out of a chain of sources; the first that knows the firm wins:
//   1. CEIDG, the official register (hurtownia danych CEIDG, API v3)      — when the secret CEIDG_TOKEN is set
//   2. GUS / REGON through DataPort.pl                                     — when the secret DATAPORT_API_KEY is set
//   3. Wykaz podatników VAT of the Ministry of Finance ("biała lista")     — no key; BASIC data only, VAT payers only
// A source that fails (no answer in 8 s, rejected key, limit, outage, unknown answer) is noted in `proby`
// and the next one is asked; only when nobody answered is that an error (BladJdg) — never "not found".
// "Not found" is said by a source in so many words: CEIDG 204 / empty list, DataPort 404 or its message,
// MF `subject: null`. MF not knowing a NIP is NOT proof that the firm does not exist (powod says which
// sources did not know it).
//
// Field names of CEIDG follow the official "Dokumentacja dla integratorów API v3 Hurtowni danych" v1.4 and
// its OpenAPI file (schema FirmaCeidg), read 2026-10-09; of MF — API Rejestr WL (schema Entity).
//
// Personal data: a sole trader's record is personal data. Only what the public register shows about the
// business is kept (firm, owner's name, business address, NIP, REGON, PKD, dates, status). PESEL, phone,
// e-mail, citizenship, marital property, bank accounts and persons other than the owner are never copied
// out of an answer; no secret and no raw answer ever lands in an error text or a log.

// deno-lint-ignore no-explicit-any
type Any = any;
export type ZrodloJdg = "ceidg" | "gus" | "mf";
// wynik: "ok" | "brak" | "limit" | "błąd: …"
export type Proba = { zrodlo: ZrodloJdg; wynik: string };
export type Jdg = {
  znaleziono: boolean; zrodlo: ZrodloJdg; powod?: string; nip: string;
  nazwa: string | null; imie: string | null; nazwisko: string | null; regon: string | null; forma: string | null;
  adres: string | null;           // main place of business, one line
  adres_doreczen: string | null;  // address for service, only when it differs
  data_rozpoczecia: string | null;
  status: string | null;          // "aktywna" | "zawieszona" | "wykreślona" | … ; null = the source does not say (MF)
  data_zawieszenia: string | null; data_wznowienia: string | null; data_zakonczenia: string | null; data_wykreslenia: string | null;
  pkd_glowne: string | null; pkd: { kod: string; nazwa: string }[];
  status_vat: string | null; vat_od: string | null; vat_wykreslenie: string | null; vat_przywrocenie: string | null; // MF only
  podstawowe: boolean;            // true: MF alone answered — no PKD, no start date, no suspension
  proby: Proba[];
};
export class BladJdg extends Error {
  // limit: nothing failed — our own daily share of MF requests is used up ("dokończ jutro")
  constructor(message: string, public proby: Proba[], public limit = false) { super(message); }
}
export const NAZWA_ZRODLA: Record<ZrodloJdg, string> = { ceidg: "CEIDG", gus: "GUS (DataPort)", mf: "Wykaz VAT (MF)" };
export const CEIDG_URL = "https://dane.biznes.gov.pl/api/ceidg/v3/firma?nip=";
export const DATAPORT_URL = "https://dataport.pl/api/v1/company/";
export const MF_URL = "https://wl-api.mf.gov.pl/api/search/nip/";
const TIMEOUT_MS = 8000;

const txt = (v: unknown, n = 300) => { const s = String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); return s ? s.slice(0, n) : null; };
const data = (v: unknown) => { const s = String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : null; };
const cyfry = (v: unknown, n: number) => String(v ?? "").replace(/\D/g, "").slice(0, n) || null;
const pusty = (nip: string, zrodlo: ZrodloJdg): Jdg => ({
  znaleziono: false, zrodlo, nip, nazwa: null, imie: null, nazwisko: null, regon: null, forma: null, adres: null, adres_doreczen: null, data_rozpoczecia: null,
  status: null, data_zawieszenia: null, data_wznowienia: null, data_zakonczenia: null, data_wykreslenia: null, pkd_glowne: null, pkd: [],
  status_vat: null, vat_od: null, vat_wykreslenie: null, vat_przywrocenie: null, podstawowe: false, proby: [],
});
// today's date in Poland (MF answers "as of" a day and refuses a future one)
export function dzisPl(teraz: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(teraz);
}
// which fuller sources are configured (MF needs nothing and is always there)
export function zrodlaJdg(): { ceidg: boolean; gus: boolean } {
  return { ceidg: !!Deno.env.get("CEIDG_TOKEN"), gus: !!Deno.env.get("DATAPORT_API_KEY") };
}

// ---------------------------------------------------------------- pure mapping (jdg_test.ts)
// CEIDG's address object (schema Adres) -> one line
export function adresCeidg(a: Any): string | null {
  if (!a || typeof a !== "object") return null;
  const nr = [txt(a.budynek, 20), txt(a.lokal, 20)].filter(Boolean).join("/");
  const ulica = txt(a.ulica, 120), miasto = txt(a.miasto, 120);
  // a village without street names: "Przykładowo 12"
  const pierwsza = ulica ? [ulica, nr].filter(Boolean).join(" ") : nr ? [miasto, nr].filter(Boolean).join(" ") : "";
  const druga = [txt(a.kod, 10), miasto].filter(Boolean).join(" ");
  return txt([pierwsza, druga, txt(a.opisNietypowegoMiejsca, 120)].filter(Boolean).join(", "));
}
const STATUS_CEIDG: Record<string, string> = {
  AKTYWNY: "aktywna", ZAWIESZONY: "zawieszona", WYKRESLONY: "wykreślona",
  OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI: "oczekuje na rozpoczęcie działalności", WYLACZNIE_W_FORMIE_SPOLKI: "wyłącznie w formie spółki cywilnej",
};
const KOLEJNOSC = ["AKTYWNY", "ZAWIESZONY", "OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI", "WYLACZNIE_W_FORMIE_SPOLKI", "WYKRESLONY"];
const pkdTekst = (p: Any) => txt([txt(p?.kod, 12), txt(p?.nazwa, 250)].filter(Boolean).join(" "), 300);
// One NIP may have several entries (an old one struck off, a new one active): the living one, then the newest.
export function wybierzWpis(firmy: Any[]): Any | null {
  const l = (Array.isArray(firmy) ? firmy : []).filter((f) => f && typeof f === "object");
  const poz = (f: Any) => { const i = KOLEJNOSC.indexOf(String(f.status)); return i < 0 ? KOLEJNOSC.length : i; };
  return [...l].sort((a, b) => poz(a) - poz(b) || String(b.dataRozpoczecia ?? "").localeCompare(String(a.dataRozpoczecia ?? "")))[0] ?? null;
}
// body of GET /firma?nip= : { firma: [FirmaCeidg] }
export function mapujCeidg(body: Any, nip: string): Jdg {
  const f = wybierzWpis(body?.firma);
  if (!f) return pusty(nip, "ceidg");
  const adres = adresCeidg(f.adresDzialalnosci), kor = adresCeidg(f.adresKorespondencyjny);
  const st = String(f.status ?? "");
  return {
    ...pusty(nip, "ceidg"), znaleziono: true,
    nazwa: txt(f.nazwa), imie: txt(f.wlasciciel?.imie, 80), nazwisko: txt(f.wlasciciel?.nazwisko, 120), regon: cyfry(f.wlasciciel?.regon, 14),
    forma: "jednoosobowa działalność gospodarcza",
    // no place of business entered (allowed since 2018): the address for service is the only one there is
    adres: adres ?? kor, adres_doreczen: adres && kor && kor.toLowerCase() !== adres.toLowerCase() ? kor : null,
    data_rozpoczecia: data(f.dataRozpoczecia), status: STATUS_CEIDG[st] ?? (txt(st, 60)?.toLowerCase() ?? null),
    data_zawieszenia: data(f.dataZawieszenia), data_wznowienia: data(f.dataWznowienia), data_zakonczenia: data(f.dataZakonczenia), data_wykreslenia: data(f.dataWykreslenia),
    pkd_glowne: pkdTekst(f.pkdGlowny),
    pkd: (Array.isArray(f.pkd) ? f.pkd : []).slice(0, 200).map((p: Any) => ({ kod: txt(p?.kod, 12) ?? "", nazwa: txt(p?.nazwa, 250) ?? "" })).filter((p: Any) => p.kod),
  };
}
// DataPort's answer (GUS / REGON). Field names as the office's account returned them; variants read defensively.
export function mapujGus(d: Any, nip: string): Jdg {
  if (!d || d.success === false || !(d.nazwa || d.regon)) return pusty(nip, "gus");
  const pkd = d.pkd_glowne ?? d.pkdGlowne ?? (Array.isArray(d.pkd) ? null : d.pkd) ?? null;
  const koniec = data(d.data_zakonczenia ?? d.dataZakonczeniaDzialalnosci), zaw = data(d.data_zawieszenia ?? d.dataZawieszeniaDzialalnosci), wzn = data(d.data_wznowienia ?? d.dataWznowieniaDzialalnosci);
  return {
    ...pusty(nip, "gus"), znaleziono: true,
    nazwa: txt(d.nazwa), imie: txt(d.imie, 80), nazwisko: txt(d.nazwisko, 120), regon: cyfry(d.regon, 14), forma: txt(d.forma_prawna ?? d.formaPrawna ?? d.typ, 120),
    adres: txt(String(d.adres ?? "").replace(/\s*\/\s*/g, "/")),
    data_rozpoczecia: data(d.data_rozpoczecia ?? d.dataRozpoczeciaDzialalnosci ?? d.data_powstania),
    status: koniec ? "wykreślona" : zaw && !(wzn && wzn > zaw) ? "zawieszona" : "aktywna",
    data_zawieszenia: zaw, data_wznowienia: wzn, data_zakonczenia: koniec,
    pkd_glowne: typeof pkd === "object" && pkd ? pkdTekst(pkd) : txt(pkd, 300),
  };
}
// MF: `result.subject` of GET /api/search/nip/{nip}?date= (schema Entity). Basic data only; the firm's own
// status is not there (statusVat is about VAT), and neither is the day the business began.
export function mapujMf(subject: Any, nip: string): Jdg {
  if (!subject || typeof subject !== "object" || !(subject.name || subject.nip)) return { ...pusty(nip, "mf"), podstawowe: true, powod: "brak w wykazie VAT" };
  return {
    ...pusty(nip, "mf"), znaleziono: true, podstawowe: true,
    nazwa: txt(subject.name), regon: cyfry(subject.regon, 14),
    // workingAddress: the place of business (or home, when there is none); residenceAddress: a seat (organisations)
    adres: txt(subject.workingAddress) ?? txt(subject.residenceAddress),
    status_vat: txt(subject.statusVat, 40), vat_od: data(subject.registrationLegalDate), vat_wykreslenie: data(subject.removalDate), vat_przywrocenie: data(subject.restorationDate),
  };
}
// what is kept of a record (table columns `dane`): everything normalised, without the attempts' texts
export function doZapisu(j: Jdg): Omit<Jdg, "proby"> { const { proby: _p, ...r } = j; return r; }

// ---------------------------------------------------------------- the sources
type Odp = { jdg: Jdg } | "brak";
type Pobierz = typeof fetch;
async function pytaj(f: Pobierz, url: string, headers: Record<string, string>, ms: number): Promise<{ status: number; body: Any }> {
  let r: Response;
  try { r = await f(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(ms) }); }
  catch (e) {
    // the error's own text may quote the request: only its kind is passed on
    const n = (e as Error)?.name;
    throw new Error(n === "TimeoutError" || n === "AbortError" ? "brak odpowiedzi w ciągu " + Math.round(ms / 1000) + " s" : "brak połączenia");
  }
  const t = await r.text().catch(() => "");
  let body: Any = null;
  try { body = t ? JSON.parse(t) : null; } catch { /* a firewall page is not JSON */ }
  return { status: r.status, body };
}
async function zCeidg(f: Pobierz, nip: string, token: string, ms: number): Promise<Odp> {
  const { status, body } = await pytaj(f, CEIDG_URL + nip, { Authorization: "Bearer " + token }, ms);
  if (status === 204) return "brak";
  if (status === 200 && Array.isArray(body?.firma)) { const j = mapujCeidg(body, nip); return j.znaleziono ? { jdg: j } : "brak"; }
  if (status === 401 || status === 403) throw new Error("token odrzucony (HTTP " + status + ") — sprawdź sekret CEIDG_TOKEN");
  if (status === 429) throw new Error("limit zapytań (HTTP 429)");
  throw new Error(status === 200 ? "odpowiedź w nieznanym formacie" : "HTTP " + status);
}
async function zGus(f: Pobierz, nip: string, klucz: string, ms: number): Promise<Odp> {
  const { status, body: d } = await pytaj(f, DATAPORT_URL + nip, { "X-API-Key": klucz }, ms);
  const msg = String(d?.message ?? d?.error ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, 120);
  // "not found" only when the provider clearly says so; an inactive key, a limit or anything unknown is an error
  if (status === 404 || (d?.success === false && /nie znaleziono|nie odnaleziono|nie istnieje|brak podmiotu|not found/i.test(msg))) return "brak";
  if (status < 200 || status > 299 || d?.success === false || !(d?.nazwa || d?.regon)) throw new Error(msg || "HTTP " + status);
  return { jdg: mapujGus(d, nip) };
}
async function zMf(f: Pobierz, nip: string, dzis: string, ms: number): Promise<Odp> {
  const { status, body } = await pytaj(f, MF_URL + nip + "?date=" + dzis, {}, ms);
  if (status === 200 && body?.result && "subject" in body.result) { const j = mapujMf(body.result.subject, nip); return j.znaleziono ? { jdg: j } : "brak"; }
  if (status === 429) throw new Error("limit zapytań MF wyczerpany do północy (HTTP 429)");
  const kod = txt(body?.code, 20);
  throw new Error(kod ? "błąd " + kod : "HTTP " + status);
}

export type OpcjeJdg = {
  ceidgToken?: string;      // default: secret CEIDG_TOKEN
  dataportKey?: string;     // default: secret DATAPORT_API_KEY
  fetch?: typeof fetch;     // for tests
  // our own daily share of MF's 100 "search" requests: called right before MF is asked; false = do not ask
  mfWolno?: () => Promise<boolean>;
  bezMf?: boolean;          // only the fuller sources (replacing a basic MF record): MF is not asked at all
  dzis?: string; timeoutMs?: number;
};
// One sole trader by NIP. Returns the record (znaleziono true / false) with `proby`; throws BladJdg when no source answered.
export async function pobierzJdg(nip: string, opts: OpcjeJdg = {}): Promise<Jdg> {
  if (!/^\d{10}$/.test(nip)) throw new BladJdg("nieprawidłowy NIP", []);
  const f = opts.fetch ?? fetch, ms = opts.timeoutMs ?? TIMEOUT_MS;
  const token = opts.ceidgToken ?? Deno.env.get("CEIDG_TOKEN") ?? "", klucz = opts.dataportKey ?? Deno.env.get("DATAPORT_API_KEY") ?? "";
  const proby: Proba[] = [], braki: ZrodloJdg[] = [];
  let limit = false;
  const kolej: Array<[ZrodloJdg, (() => Promise<Odp>) | null]> = [
    ["ceidg", token ? () => zCeidg(f, nip, token, ms) : null],
    ["gus", klucz ? () => zGus(f, nip, klucz, ms) : null],
    ["mf", opts.bezMf ? null : () => zMf(f, nip, opts.dzis ?? dzisPl(), ms)],
  ];
  for (const [zrodlo, pytanie] of kolej) {
    if (!pytanie) continue;
    if (zrodlo === "mf" && opts.mfWolno && !(await opts.mfWolno())) { proby.push({ zrodlo, wynik: "limit" }); limit = true; continue; }
    try {
      const o = await pytanie();
      if (o !== "brak") { proby.push({ zrodlo, wynik: "ok" }); return { ...o.jdg, proby }; }
      proby.push({ zrodlo, wynik: "brak" }); braki.push(zrodlo);
      if (zrodlo === "gus") break; // REGON holds every firm: MF would add nothing
    } catch (e) {
      proby.push({ zrodlo, wynik: "błąd: " + String((e as Error)?.message ?? "nieznany").slice(0, 140) });
    }
  }
  if (braki.length) {
    const gdzie: Record<ZrodloJdg, string> = { ceidg: "CEIDG", gus: "rejestrze REGON", mf: "wykazie VAT" };
    return { ...pusty(nip, braki[0]), podstawowe: braki[0] === "mf", powod: "brak w " + braki.map((z) => gdzie[z]).join(" i w "), proby };
  }
  if (!proby.length) throw new BladJdg("brak skonfigurowanego źródła danych (CEIDG / GUS)", proby);
  const bledy = proby.filter((p) => p.wynik !== "limit");
  // only our own cap stood in the way: nothing is broken
  if (limit && !bledy.length) throw new BladJdg("dzienny limit zapytań do Wykazu VAT (MF) jest wyczerpany — dokończ jutro", proby, true);
  throw new BladJdg(bledy.map((p) => NAZWA_ZRODLA[p.zrodlo] + ": " + p.wynik.replace(/^błąd: /, "")).join("; ") + (limit ? "; Wykaz VAT (MF): dzienny limit wyczerpany" : ""), proby, limit);
}
