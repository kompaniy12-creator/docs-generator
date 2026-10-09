// Asystenci AI — TEST MODE. 14 assistants (9 for staff, 5 for clients — the latter only simulated by
// the owner for a chosen client). PORTAL ONLY, and only for a portal administrator who is listed in
// portal_ustawienia['asystenci'].testerzy. There is no cron path, no client path and no bot path.
// Every action is a POST with { action, ... }:
//
//   lista                               definitions + on/off + today's usage + settings
//   slownik    { co, nip? }             pickers for the page: klienci | pracownicy | wiadomosci | akty
//   uruchom    { asystent, wejscie, pliki?, zachowaj_plik? }  -> 202 { id }  (the run goes on in the background)
//   stan | wynik { id }                 -> { przebieg } — the page polls until status is not "w_toku"
//   historia   { dni?, asystent? }      runs with tokens and estimated cost, and totals per day
//   ocena      { id, ocena: 1|0|-1, komentarz? }
//   tlumacz_ru { id }                   Russian rendering of a finished answer (for the owner)
//   ustawienia { ustawienia }           testers, on/off, daily caps, retention, model per assistant
//   czysc      { id? }                  removes runs older than the retention (or one run) with their files
//   plik       { id, nr? }              a 60-second link to a file kept for review
//
// What an assistant can do is fixed in code: narzedzia.ts has read-only tools only, scoped by the run's
// context; the answer is a draft shown on the page. Nothing is sent, created or changed anywhere.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.

import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";
import { loadKlienciRows } from "../_shared/klienci.ts";
import { type Baza, BUCKET, KLUCZ_USTAWIEN, obsluz } from "./core.ts";
import type { Any, Ja } from "./logic.ts";
import { FALLBACK_BETA, FALLBACK_DLA, MAX_TOKENOW_ODPOWIEDZI, TIMEOUT_WYWOLANIA_MS } from "./modele.ts";
import type { Store } from "./narzedzia.ts";
import { BladModelu, type Model } from "./silnik.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const TABELA = "asystent_przebiegi";
const enc = encodeURIComponent;

function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
// read-only helper of the tools: a GET, at most `max` rows
async function czytaj(path: string, max = 1000): Promise<Any[]> {
  const out: Any[] = [];
  for (let from = 0; from < max; from += 1000) {
    const r = await db(path, { headers: { Range: `${from}-${Math.min(from + 999, max - 1)}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error(path.split("?")[0] + ": " + r.status);
    const part = await r.json();
    out.push(...part);
    if (part.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------- who is calling
// The portal's user by the Supabase session token — nothing else is recognised (no x-cron-key, no client session).
async function ja(req: Request): Promise<Ja | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === ANON || token === SERVICE) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (!u?.email) return null;
  return { email: String(u.email), portal: m.portal === true, admin: m.portal_admin === true };
}

// ---------------------------------------------------------------- what the tools read (GET only)
let klienciCache: { at: number; rows: Awaited<ReturnType<typeof loadKlienciRows>> } | null = null;
const store: Store = {
  async klienci() {
    if (!klienciCache || Date.now() - klienciCache.at > 60_000) klienciCache = { at: Date.now(), rows: await loadKlienciRows() };
    return klienciCache.rows;
  },
  obsluga: () => czytaj("klienci_obsluga?select=id,nip,status,obsluga_od,koniec_od,obslugiwany"),
  pracownicy: (nip) => czytaj(`zatrudnienie_zgloszenia?select=id,worker_name,status,created_at,payload&status=neq.archiwum${nip ? `&payload->>z_nip=eq.${enc(nip)}` : ""}&order=created_at.asc`, 5000),
  async pracownik(id) { return (await czytaj(`zatrudnienie_zgloszenia?select=id,worker_name,status,created_at,payload&id=eq.${enc(id)}`, 1))[0] ?? null; },
  zamkniecia: (okres) => czytaj(`ksieg_zamkniecia?select=nip,okres,kroki,uwagi&okres=eq.${enc(okres)}`, 3000),
  wiedza: () => czytaj("portal_wiedza?select=id,dzial,temat,tresc,podstawa,eli,zweryfikowano,do_sprawdzenia&order=dzial.asc,kolejnosc.asc"),
  prawo: () => czytaj("portal_prawo_akty?select=eli,tytul,skrot,change_date,zmiany,tekst_jednolity,checked_at,zmiana_wykryta&order=skrot.asc"),
  zadania: () => czytaj("portal_zadania?select=id,assignee,tytul,termin,pilne,status,zrodlo,created_at&status=in.(nowe,w_toku)&order=termin.asc.nullslast", 2000),
  poczta: () => czytaj("poczta_wiadomosci?select=id,created_at,data,skrzynka,od_nazwa,od_adres,temat,kategoria,pilnosc,wymaga,klient_nip,klient_nazwa,status&order=data.desc.nullslast&limit=60", 60),
  async pocztaJedna(id) { return (await czytaj(`poczta_wiadomosci?select=id,data,skrzynka,od_nazwa,od_adres,temat,fragment,zalaczniki,ai,kategoria,pilnosc,wymaga,klient_nip,klient_nazwa,klient_jak,status&id=eq.${enc(id)}`, 1))[0] ?? null; },
  pakiety: (nip) => czytaj(`podpisy_pakiety?select=id,created_at,nip,firma,worker_name,typ,status,wydano_at,link_expires${nip ? `&nip=eq.${enc(nip)}` : ""}&order=created_at.desc`, 300),
  dokumentyPakietow: (ids) => (ids.length ? czytaj(`podpisy_dokumenty?select=pakiet_id,status&pakiet_id=in.(${ids.map(enc).join(",")})`, 3000) : Promise.resolve([])),
  zgloszenia: (nip) => czytaj(`klient_zgloszenia?select=created_at,nip,firma,kategoria,rodzaj,temat,status,odpowiedz,assignee${nip ? `&nip=eq.${enc(nip)}` : ""}&order=created_at.desc`, 300),
  akta: (nip) => czytaj(`akta_dokumenty?select=nip,worker_id,worker_name,czesc,rodzaj,data_dok,status,sprawdzil${nip ? `&nip=eq.${enc(nip)}` : ""}`, 5000),
  umowy: (klient) => czytaj(`klienci_umowy?select=id,klient,status,rodzaj,podtyp,obejmuje,data_zawarcia,kontrahent,kontrahent_nip,reprezentanci,obowiazuje_od,obowiazuje_do,bezterminowa,podpisy,sprawdzil${klient ? `&klient=eq.${enc(klient)}` : ""}`, 3000),
  rejestr: (klient) => czytaj(`klienci_rejestr?select=klient,nip,fetched_at,sprawdzono_at,zrodlo,znaleziono,krs,regon,nazwa,forma,data_rejestracji,reprezentacja,zarzad,wspolnicy,prokurenci,stan&klient=eq.${enc(klient)}&order=fetched_at.desc&limit=3`, 3),
  telegram: () => czytaj("klienci_telegram?select=klient,status,sprawdzono_at"),
  sms: (od) => czytaj(`sms_wiadomosci?select=created_at,status,test,cel&created_at=gte.${enc(od)}`, 5000),
  rozsylki: (od) => czytaj(`rozsylki?select=created_at,status,typ,liczba&created_at=gte.${enc(od)}`, 1000),
  zespol: () => czytaj("portal_pracownicy_publiczne?select=email,imie_nazwisko,aliasy,stanowisko,dzialy,aktywny,nieobecny_od,nieobecny_do,zastepca,nieobecny_dzis"),
  stawki: () => czytaj("portal_stawki?select=valid_from,min_wage,min_hourly,source&order=valid_from.asc"),
  automat: (od) => czytaj(`portal_zadania_log?select=zadanie,dzien,ok&dzien=gte.${enc(od)}`, 3000),
  powiadomienia: (od) => czytaj(`portal_powiadomienia?select=rodzaj,kanal,status,created_at&created_at=gte.${enc(od)}`, 5000),
  konta: () => czytaj("klient_konta?select=nip,aktywny,last_login"),
  async aktEli(eli) {
    try {
      const r = await fetch(`https://api.sejm.gov.pl/eli/acts/${eli}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
};

// ---------------------------------------------------------------- the runs table and kept files
const baza: Baza = {
  async ustawienia() {
    const r = await db(`portal_ustawienia?key=eq.${KLUCZ_USTAWIEN}&select=value`);
    if (!r.ok) throw new Error("ustawienia: " + r.status);
    return (await r.json())[0]?.value ?? {};
  },
  async zapiszUstawienia(u) {
    const r = await db("portal_ustawienia", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: KLUCZ_USTAWIEN, value: u, updated_at: new Date().toISOString() }) });
    if (!r.ok) throw new Error("ustawienia zapis: " + r.status);
  },
  async limit(klucz, max) {
    try {
      const r = await db("rpc/klienci_limit", { method: "POST", body: JSON.stringify({ p_klucz: klucz, p_max: max, p_ile: 1 }) });
      return r.ok && (await r.json()) === true;
    } catch { return false; }
  },
  async nowy(row) {
    const r = await db(TABELA, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!r.ok) throw new Error("przebieg: " + r.status);
    return (await r.json())[0].id;
  },
  async zmien(id, patch) {
    const r = await db(`${TABELA}?id=eq.${enc(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error("przebieg zapis: " + r.status);
  },
  async jeden(id) { return (await czytaj(`${TABELA}?select=*&id=eq.${enc(id)}`, 1))[0] ?? null; },
  ostatnie: (od) => czytaj(`${TABELA}?select=id,created_at,kto,asystent,tryb,model,status,tokeny_we,tokeny_wy,tokeny_cache_r,tokeny_cache_w,koszt_usd,czas_ms,iteracje,ocena,blad,kontekst&created_at=gte.${enc(od + "T00:00:00+02:00")}&order=created_at.desc`, 2000),
  async usunStarsze(granica) {
    const r = await db(`${TABELA}?created_at=lt.${enc(granica)}&select=id,pliki`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    if (!r.ok) throw new Error("czyszczenie: " + r.status);
    const rows: Any[] = await r.json();
    return { usunieto: rows.length, pliki: rows.flatMap((x) => (Array.isArray(x.pliki) ? x.pliki : [])) };
  },
  async usun(id) {
    const r = await db(`${TABELA}?id=eq.${enc(id)}&select=pliki`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    if (!r.ok) throw new Error("usuwanie: " + r.status);
    return ((await r.json()) as Any[]).flatMap((x) => (Array.isArray(x.pliki) ? x.pliki : []));
  },
  async plikZapisz(path, bajty, mime) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": mime, "x-upsert": "false" }, body: bajty });
    return r.ok;
  },
  async plikiUsun(paths) {
    if (!paths.length) return;
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths.slice(0, 500) }) }).catch(() => {});
  },
  async plikUrl(path) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 60 }) });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
  },
};

// ---------------------------------------------------------------- the model (official SDK)
const klientApi = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY, maxRetries: 1, timeout: TIMEOUT_WYWOLANIA_MS }) : null;
const model: Model = {
  async wywolaj(z) {
    if (!klientApi) throw new BladModelu("Brak konfiguracji dostępu do modelu.");
    const fallback = FALLBACK_DLA.includes(z.model);
    try {
      return await klientApi.beta.messages.create({
        model: z.model,
        max_tokens: MAX_TOKENOW_ODPOWIEDZI,
        // a request the main model declines is re-run by the provider on its recommended model
        ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
        thinking: { type: "adaptive" },
        output_config: { effort: z.effort, format: { type: "json_schema", schema: z.schemat } },
        cache_control: { type: "ephemeral" }, // the system prompt + tools, then the growing conversation of the loop
        system: z.system,
        ...(z.tools.length ? { tools: z.tools } : {}),
        messages: z.messages,
      });
    } catch (e) {
      // the provider's message may quote the request — only its kind is logged and shown
      if (e instanceof Anthropic.RateLimitError) { console.error("asystent: model 429"); throw new BladModelu("Dostawca modelu chwilowo ogranicza liczbę zapytań — spróbuj za chwilę."); }
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) { console.error("asystent: model auth"); throw new BladModelu("Klucz dostępu do modelu został odrzucony."); }
      if (e instanceof Anthropic.BadRequestError) { console.error("asystent: model 400", String(e.message).slice(0, 300)); throw new BladModelu("Dostawca modelu odrzucił zapytanie (błąd formatu)."); }
      if (e instanceof Anthropic.APIConnectionTimeoutError) { console.error("asystent: model timeout"); throw new BladModelu("Model nie odpowiedział w wyznaczonym czasie."); }
      if (e instanceof Anthropic.APIError) { console.error("asystent: model", e.status); throw new BladModelu("Model jest chwilowo niedostępny."); }
      throw e;
    }
  },
};

Deno.serve((req) => obsluz(req, {
  ja, baza, store, model, modelGotowy: !!klientApi,
  teraz: () => new Date(),
  // the run continues after the 202 answer; the page polls `stan`
  wTle: (p) => { const er = (globalThis as Any).EdgeRuntime; if (er?.waitUntil) er.waitUntil(p); },
}));
