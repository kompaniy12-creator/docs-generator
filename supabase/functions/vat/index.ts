// VAT checks for the Księgowość module (page narzedzia-ksiegowe.html): the Polish register of VAT
// payers ("biała lista", art. 96b ustawy o VAT) and the EU VIES register. Both upstream services are
// public and need no key; the portal calls them from here so that every check is validated and
// logged on our side, and because VIES sends no CORS headers at all.
//
// POST JSON, portal JWT with the Księgowość section ("onboarding"):
//   { action: "wl_search", by: "nip" | "regon" | "konto", value, date }
//     -> { podmioty: [{ nazwa, nip, status, regon, krs, adresRejestracyjny, adresDzialalnosci, dataRejestracji,
//          odmowaData, odmowaPodstawa, wykreslenieData, wykresleniePodstawa, przywrocenieData, przywroceniePodstawa,
//          konta: [..], wirtualne }], requestId, requestDateTime, date }
//   { action: "wl_check", nip, konto, date }
//     -> { przypisany: "TAK" | "NIE", nip, konto, date, requestId, requestDateTime }
//   { action: "vies", kraj, numer, wlasny? }
//     -> { wazny, kraj, numer, nazwa, adres, dataZapytania, identyfikator, zWlasnym }
//   errors -> { error (Polish, for the user), kod? (upstream code) } with 400 (input) / 502 (upstream)
//
// Every question that reached a register — answered or failed — is entered in public.vat_sprawdzenia (service
// role; staff can only read it). The answer then carries { zapisano: true, wpis: <row id> }; when the entry
// could not be written the check still succeeds, with zapisano: false. Our own input rejections are not entered.
//
// Upstream: https://wl-api.mf.gov.pl (API Rejestr WL 1.6.0; daily limits: 100 "search" and 5000 "check"
// requests, after which MF may block access until 0:00) and
// https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number.
// Account numbers are never written to the console log in full (the register keeps them: they are the evidence).

import { type Rodzaj, wierszRejestru, type Wpis } from "./rejestr.ts";
import { czytajDate, czytajKonto, czytajKraj, czytajNip, czytajNumerVat, czytajRegon, czytajWlasny, maska } from "./walidacja.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WL = "https://wl-api.mf.gov.pl/api";
const VIES = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const TIMEOUT_MS = 12000;

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
}
async function portalKsiegowosc(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  const ksiegowosc = m.portal_admin === true || !Array.isArray(m.portal_sections) || m.portal_sections.includes("onboarding");
  return m.portal === true && ksiegowosc ? String(u.email ?? "") : null;
}

class Blad extends Error {
  zap?: Record<string, unknown>; // the validated question — set once a register was actually asked
  constructor(message: string, public status = 502, public kod = "") { super(message); }
}
const zPytaniem = (e: unknown, zap: Record<string, unknown>) => { if (e instanceof Blad) e.zap = zap; return e; };
function log(o: Record<string, unknown>) { console.log(JSON.stringify({ fn: "vat", ...o })); }
const tekst = (v: unknown, max = 300) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

// one upstream call: time limit, body read as text and parsed leniently (a firewall page is not JSON)
async function wywolaj(url: string, init: RequestInit, kto: string): Promise<{ status: number; body: any }> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  } catch (e) {
    const czas = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    throw new Blad(czas ? `${kto} nie odpowiedział w ciągu ${TIMEOUT_MS / 1000} s. Spróbuj ponownie za chwilę.` : `Nie udało się połączyć z serwerem: ${kto}. Spróbuj ponownie za chwilę.`, 502, czas ? "TIMEOUT" : "NETWORK");
  }
  const t = await r.text();
  let body: any = null;
  try { body = JSON.parse(t); } catch { /* not JSON */ }
  return { status: r.status, body };
}

// ───────────────────────── biała lista (wl-api.mf.gov.pl) ─────────────────────────
// Codes seen in the API's own answers (2026-10-08): WL-103, WL-111, WL-118, WL-190. For any other code the
// register's own Polish message is passed on as it came.
const WL_BLEDY: Record<string, string> = {
  "WL-103": "Data nie może być datą przyszłą.",
  "WL-111": "Wykaz odrzucił numer rachunku jako nieprawidłowy.",
  "WL-118": "Data sprzed zakresu wykazu — wykaz udostępnia dane na dzień nie wcześniejszy niż w okresie 5 lat poprzedzających rok sprawdzenia (art. 96b ust. 2 ustawy o VAT).",
  "WL-190": "Wykaz odrzucił zapytanie jako niepoprawne.",
};
const MF = "Wykaz podatników VAT (Ministerstwo Finansów)";
async function wl(path: string, date: string) {
  // `path` is assembled by the callers from validated digits only
  const { status, body } = await wywolaj(`${WL}/${path}?date=${date}`, { method: "GET" }, MF);
  if (status === 200 && body?.result) return body.result;
  const kod = tekst(body?.code, 20) ?? "";
  if (status === 429) throw new Blad("Wyczerpany limit zapytań do Wykazu podatników VAT (100 wyszukiwań i 5000 sprawdzeń pary NIP + rachunek dziennie). Dostęp wraca o północy.", 502, kod || "429");
  if (kod) throw new Blad((WL_BLEDY[kod] ?? tekst(body?.message, 200) ?? "Wykaz zwrócił błąd.") + ` [${kod}]`, status === 400 ? 400 : 502, kod);
  if (status === 403) throw new Blad("Serwer Ministerstwa Finansów odrzucił zapytanie (blokada dostępu albo wyczerpany limit dzienny). Spróbuj później albo sprawdź w wyszukiwarce na podatki.gov.pl.", 502, "403");
  throw new Blad(`${MF} nie zwrócił danych (HTTP ${status}). Spróbuj ponownie za chwilę.`, 502, String(status));
}
// only what the page shows; persons from pkt 8–10 (representatives, proxies, partners) and PESEL are left out
function podmiot(s: any) {
  return {
    nazwa: tekst(s?.name), nip: tekst(s?.nip, 10), status: tekst(s?.statusVat, 40), regon: tekst(s?.regon, 14), krs: tekst(s?.krs, 10),
    // API names: workingAddress = registered address (seat of an organisation / home of a natural person),
    // residenceAddress = place of business of a natural person
    adresRejestracyjny: tekst(s?.workingAddress), adresDzialalnosci: tekst(s?.residenceAddress),
    dataRejestracji: tekst(s?.registrationLegalDate, 10),
    odmowaData: tekst(s?.registrationDenialDate, 10), odmowaPodstawa: tekst(s?.registrationDenialBasis),
    wykreslenieData: tekst(s?.removalDate, 10), wykresleniePodstawa: tekst(s?.removalBasis),
    przywrocenieData: tekst(s?.restorationDate, 10), przywroceniePodstawa: tekst(s?.restorationBasis),
    konta: Array.isArray(s?.accountNumbers) ? s.accountNumbers.filter((x: unknown) => typeof x === "string").slice(0, 500).map((x: string) => x.slice(0, 40)) : [],
    wirtualne: s?.hasVirtualAccounts === true,
  };
}

async function wlSearch(b: any, kto: string) {
  const by = b.by;
  const v = by === "nip" ? czytajNip(b.value) : by === "regon" ? czytajRegon(b.value) : by === "konto" ? czytajKonto(b.value) : { blad: "Wybierz: NIP, REGON albo numer rachunku." };
  if (v.blad !== undefined) throw new Blad(v.blad, 400);
  const d = czytajDate(b.date);
  if (d.blad !== undefined) throw new Blad(d.blad, 400);
  const seg = by === "konto" ? "bank-account" : by; // fixed path segment, never taken from the request
  const co = by === "konto" ? maska(v.ok) : v.ok;
  const zap = { by, value: v.ok, date: d.ok };
  try {
    const r = await wl(`search/${seg}/${v.ok}`, d.ok);
    const lista = Array.isArray(r.subjects) ? r.subjects : r.subject ? [r.subject] : [];
    log({ action: "wl_search", kto, by, co, date: d.ok, znaleziono: lista.length, requestId: r.requestId ?? null });
    return { zap, out: { podmioty: lista.slice(0, 30).map(podmiot), requestId: tekst(r.requestId, 60), requestDateTime: tekst(r.requestDateTime, 30), date: d.ok } };
  } catch (e) {
    log({ action: "wl_search", kto, by, co, date: d.ok, blad: (e as Blad).kod || String((e as Error).message).slice(0, 80) });
    throw zPytaniem(e, zap);
  }
}
async function wlCheck(b: any, kto: string) {
  const nip = czytajNip(b.nip);
  if (nip.blad !== undefined) throw new Blad(nip.blad, 400);
  const konto = czytajKonto(b.konto);
  if (konto.blad !== undefined) throw new Blad(konto.blad, 400);
  const d = czytajDate(b.date);
  if (d.blad !== undefined) throw new Blad(d.blad, 400);
  const zap = { nip: nip.ok, konto: konto.ok, date: d.ok };
  try {
    const r = await wl(`check/nip/${nip.ok}/bank-account/${konto.ok}`, d.ok);
    const odp = r.accountAssigned === "TAK" ? "TAK" : r.accountAssigned === "NIE" ? "NIE" : null;
    if (!odp) throw new Blad("Wykaz zwrócił odpowiedź w nieznanym formacie.", 502, "FORMAT");
    log({ action: "wl_check", kto, nip: nip.ok, konto: maska(konto.ok), date: d.ok, wynik: odp, requestId: r.requestId ?? null });
    return { zap, out: { przypisany: odp, nip: nip.ok, konto: konto.ok, date: d.ok, requestId: tekst(r.requestId, 60), requestDateTime: tekst(r.requestDateTime, 30) } };
  } catch (e) {
    log({ action: "wl_check", kto, nip: nip.ok, konto: maska(konto.ok), date: d.ok, blad: (e as Blad).kod || String((e as Error).message).slice(0, 80) });
    throw zPytaniem(e, zap);
  }
}

// ───────────────────────── VIES (European Commission) ─────────────────────────
// Fault codes of the VIES checkVat service (WSDL: INVALID_INPUT, GLOBAL_MAX_CONCURRENT_REQ, MS_MAX_CONCURRENT_REQ,
// SERVICE_UNAVAILABLE, MS_UNAVAILABLE, TIMEOUT) plus the requester / blocking codes the REST API can return.
const VIES_BLEDY: Record<string, string> = {
  INVALID_INPUT: "VIES odrzucił zapytanie: nieprawidłowy kod kraju albo format numeru VAT.",
  INVALID_REQUESTER_INFO: "VIES odrzucił Twój własny numer VAT UE (nieprawidłowy albo nieaktywny). Popraw go albo sprawdź bez niego — wtedy bez numeru potwierdzenia.",
  GLOBAL_MAX_CONCURRENT_REQ: "System VIES jest w tej chwili przeciążony (za dużo jednoczesnych zapytań w całej UE). Spróbuj ponownie za chwilę.",
  MS_MAX_CONCURRENT_REQ: "Baza VAT wybranego państwa obsługuje w tej chwili zbyt wiele zapytań. Spróbuj ponownie za chwilę.",
  SERVICE_UNAVAILABLE: "Usługa VIES jest chwilowo niedostępna. Spróbuj ponownie później.",
  MS_UNAVAILABLE: "Baza VAT wybranego państwa członkowskiego jest chwilowo niedostępna (przerwa po stronie tego państwa). Spróbuj ponownie później — VIES nie potwierdzi teraz numeru.",
  TIMEOUT: "Baza VAT wybranego państwa nie odpowiedziała na czas. Spróbuj ponownie za chwilę.",
  VAT_BLOCKED: "VIES zablokował zapytania o ten numer VAT. Spróbuj później.",
  IP_BLOCKED: "VIES zablokował zapytania z adresu portalu (zbyt wiele zapytań). Spróbuj później albo sprawdź numer na stronie VIES.",
};
const KE = "System VIES (Komisja Europejska)";
const kreski = (v: unknown, max = 400) => { const t = tekst(v, max); return t && !/^-+$/.test(t) ? t : null; }; // "---" = not disclosed by the member state

async function vies(b: any, kto: string) {
  const kraj = czytajKraj(b.kraj);
  if (kraj.blad !== undefined) throw new Blad(kraj.blad, 400);
  const numer = czytajNumerVat(b.numer, kraj.ok);
  if (numer.blad !== undefined) throw new Blad(numer.blad, 400);
  const req: Record<string, string> = { countryCode: kraj.ok, vatNumber: numer.ok };
  const maWlasny = b.wlasny != null && String(b.wlasny).trim() !== "";
  if (maWlasny) {
    const w = czytajWlasny(b.wlasny);
    if (w.blad !== undefined) throw new Blad(w.blad, 400);
    req.requesterMemberStateCode = w.ok.kraj; req.requesterNumber = w.ok.numer;
  }
  const zap = { kraj: kraj.ok, numer: numer.ok, wlasny: maWlasny ? req.requesterMemberStateCode + req.requesterNumber : null };
  const pytaj = () => wywolaj(VIES, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) }, KE);
  const kodBledu = (x: any) => x?.actionSucceed === false ? (tekst(x?.errorWrappers?.[0]?.error, 40) ?? "UNKNOWN") : "";
  try {
    let { status, body } = await pytaj();
    // "too many concurrent requests" clears within moments — one quiet retry before bothering the user
    if (/MAX_CONCURRENT_REQ$/.test(kodBledu(body))) { await new Promise((r) => setTimeout(r, 1500)); ({ status, body } = await pytaj()); }
    const kod = kodBledu(body);
    if (kod) throw new Blad((VIES_BLEDY[kod] ?? "VIES zwrócił błąd.") + ` [${kod}]`, kod === "INVALID_INPUT" || kod === "INVALID_REQUESTER_INFO" ? 400 : 502, kod);
    if (typeof body?.valid !== "boolean") throw new Blad(`${KE} nie zwrócił danych (HTTP ${status}). Spróbuj ponownie za chwilę.`, 502, String(status));
    const id = tekst(body.requestIdentifier, 60);
    log({ action: "vies", kto, kraj: kraj.ok, numer: numer.ok, wlasny: maWlasny, wazny: body.valid, identyfikator: id });
    return {
      zap,
      out: {
        wazny: body.valid, kraj: kraj.ok, numer: numer.ok, nazwa: kreski(body.name), adres: kreski(body.address),
        dataZapytania: tekst(body.requestDate, 40), identyfikator: id, zWlasnym: zap.wlasny,
      },
    };
  } catch (e) {
    log({ action: "vies", kto, kraj: kraj.ok, numer: numer.ok, wlasny: maWlasny, blad: (e as Blad).kod || String((e as Error).message).slice(0, 80) });
    throw zPytaniem(e, zap);
  }
}

// ───────────────────────── register of checks (public.vat_sprawdzenia) ─────────────────────────
// Returns the new row's id, or null when it could not be written — a check never fails because of the register.
async function zapisz(w: Wpis): Promise<string | null> {
  try {
    if (!SERVICE) throw new Error("brak SUPABASE_SERVICE_ROLE_KEY");
    const r = await fetch(`${SUPABASE_URL}/rest/v1/vat_sprawdzenia?select=id`, {
      method: "POST", signal: AbortSignal.timeout(6000),
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(w),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const id = (await r.json())?.[0]?.id;
    if (typeof id !== "string") throw new Error("brak id w odpowiedzi");
    return id;
  } catch (e) {
    console.error("vat: wpis do rejestru nieudany:", w.rodzaj, w.request_id ?? "-", String((e as Error)?.message ?? e).slice(0, 240));
    return null;
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const kto = await portalKsiegowosc(req);
  if (kto === null) return json({ error: "Brak dostępu (portal, dział Księgowość)." }, 403, origin);

  let b: any = null;
  try { const t = await req.text(); if (t.length <= 2000) b = JSON.parse(t); } catch { /* handled below */ }
  if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "Nieprawidłowe zapytanie." }, 400, origin);
  const rodzaj: Rodzaj | null = b.action === "wl_search" || b.action === "wl_check" || b.action === "vies" ? b.action : null;
  if (!rodzaj) return json({ error: "Nieznana akcja." }, 400, origin);
  try {
    const { zap, out } = await (rodzaj === "wl_search" ? wlSearch(b, kto) : rodzaj === "wl_check" ? wlCheck(b, kto) : vies(b, kto));
    const wpis = await zapisz(wierszRejestru(rodzaj, kto, zap, out, null));
    return json({ ...out, zapisano: wpis !== null, wpis }, 200, origin);
  } catch (e) {
    if (e instanceof Blad) {
      if (!e.zap) return json({ error: e.message, kod: e.kod || undefined }, e.status, origin); // rejected before asking anyone
      const wpis = await zapisz(wierszRejestru(rodzaj, kto, e.zap, null, { message: e.message, kod: e.kod }));
      return json({ error: e.message, kod: e.kod || undefined, zapisano: wpis !== null, wpis }, e.status, origin);
    }
    console.error("vat:", String((e as Error)?.message ?? e).slice(0, 200));
    return json({ error: "Błąd wewnętrzny — sprawdzenie nie zostało wykonane." }, 500, origin);
  }
});
