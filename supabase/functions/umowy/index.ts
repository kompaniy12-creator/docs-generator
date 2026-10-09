// Umowy z klientami — generator: the office's contracts with its clients for accounting services (new prepaid
// contracts, old-style contracts, annexes moving a client to prepayment). PORTAL ADMINISTRATORS ONLY —
// contracts carry fees. Every action is a POST with { action, ... }.
//
//   start                                    -> templates, numbering, price list, courts, register, clients with the state of their contract
//   firma    { klient } | { nip } | { krs }  -> data for the form: clients base + register (rejestr.io through _shared/firma.ts).
//            A sole trader (JDG): `gus` = { regon, nazwa, adres, wlasciciel, status, zrodlo: "ceidg" | "gus" | "mf", podstawowe,
//            sprawdzono_at, skad } from CEIDG / GUS / MF's VAT register (_shared/jdg.ts), null when no source knew the NIP.
//            A snapshot the clients module already keeps is reused (odswiez: true asks the register again — paid,
//            within the daily caps). Sole traders are not in KRS: their register data come through _shared/jdg.ts.
//   szukaj   { q }                           -> firms in KRS by name / NIP / KRS (paid search, capped per person a day)
//   podglad  { formularz }                   -> the document filled as a DRAFT: text, what is missing, the forecast; no number is taken
//   generuj  { formularz }                   -> FINAL: takes the number (one transaction with the register row), fills the DOCX,
//                                               stores it; refuses when anything is missing or a placeholder would remain
//   pdf_zapisz { id, pdf }                   -> the PDF copy rendered by the page goes to the contracts module (klienci-umowy +
//                                               a row of klienci_umowy "do sprawdzenia": it does not count as a contract until signed)
//   podpisany  { id, pdf }                   -> the signed copy: replaces the PDF there and files the contract as confirmed
//   status   { id, status, uwagi }           -> wygenerowana <-> wyslana, or anulowana (the number stays used)
//   pobierz  { id, co: docx | pdf }          -> the stored file
//   szablon_wgraj { rodzaj, plik, potwierdz? } / szablon_pobierz { id } / szablon_potwierdz { id }
//   numeracja_ustaw { rodzina, rok, ostatni } / cennik_zapisz { id?, pola } / sad_zapisz { nazwa, kod?, powiat? } / migracja_oznacz { klient, stan, uwagi? }
//
// The registry court: the register answer kept by the portal has no court; logic.ts/ustalSad says how it is proposed.

import { firmaConfigured, getFirma, searchFirmy } from "../_shared/firma.ts";
import { NAZWA_ZRODLA, zrodlaJdg, type ZrodloJdg } from "../_shared/jdg.ts";
import { jdgFirma, nipOk } from "../gus-company/dane.ts";
import { b64, generuj, otworz, sha256, sprawdzSzablon, type Szablon, zB64 } from "./docx.ts";
import {
  adresSiedziby, cyfry, czyRodzaj, dzisPl, type Formularz, isDate, nazwaPliku, numerZNazwy, type Osoba, porownajPlaceholdery, type Pozycja, reprezentacja, type Reprezentacja,
  RODZAJE, type Rodzaj, roznice, type Sad, stanMigracji, stanowiskoBiernik, t, ustalSad, wartosci,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const B_WZORY = "umowy-wzory", B_DOCX = "umowy-wygenerowane", B_UMOWY = "klienci-umowy";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_SZABLON = 6 * 1024 * 1024, MAX_PDF = 15 * 1024 * 1024;
const DNI_MIGAWKI = 30;          // a register snapshot younger than this is used without asking again
const MAX_REJESTR_DZIEN = 300;   // paid register requests a day, everybody together (the counter of klienci-baza)
const MAX_FIRM_OSOBA = 30;       // firms read from the register (not from our base) by one person a day, here
const MAX_SZUKAN_OSOBA = 60;     // paid searches by one person a day, here

// deno-lint-ignore no-explicit-any
type Any = any;
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const okId = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && (/^\d{10}$/.test(v) || /^nazwa:.+/.test(v));

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
async function all(path: string): Promise<Any[]> {
  const out: Any[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const r = await db(path, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error(path.split("?")[0] + ": " + r.status);
    const part = await r.json();
    out.push(...part);
    if (part.length < 1000) break;
  }
  return out;
}
async function jeden(path: string): Promise<Any | null> {
  const r = await db(path + (path.includes("limit=") ? "" : "&limit=1"));
  if (!r.ok) throw new Error(path.split("?")[0] + ": " + r.status);
  return (await r.json())[0] ?? null;
}
async function rpc(fn: string, body: unknown): Promise<{ ok: boolean; dane: Any; blad: string }> {
  const r = await db("rpc/" + fn, { method: "POST", body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, dane: j, blad: r.ok ? "" : String(j?.message ?? r.status) };
}
const plik = (bucket: string, path: string) => `${SUPABASE_URL}/storage/v1/object/${bucket}/${path.split("/").map(enc).join("/")}`;
const AUTH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
async function pobierz(bucket: string, path: string): Promise<Uint8Array | null> {
  const r = await fetch(plik(bucket, path), { headers: AUTH });
  if (!r.ok) { await r.body?.cancel(); return null; }
  return new Uint8Array(await r.arrayBuffer());
}
async function zapisz(bucket: string, path: string, dane: Uint8Array, mime: string): Promise<boolean> {
  const r = await fetch(plik(bucket, path), { method: "POST", headers: { ...AUTH, "Content-Type": mime, "x-upsert": "false" }, body: dane as BodyInit });
  await r.body?.cancel();
  return r.ok;
}
async function usun(bucket: string, path: string): Promise<boolean> {
  const r = await fetch(plik(bucket, path), { method: "DELETE", headers: AUTH });
  await r.body?.cancel();
  return r.ok || r.status === 404 || r.status === 400;
}
async function zdarzenie(kto: string, dokument: string | null, co: string, szczegoly: unknown = null) {
  try { const r = await db("umowy_zdarzenia", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ kto, dokument, zdarzenie: co, szczegoly }) }); await r.body?.cancel(); } catch (_e) { /* the log never blocks the work */ }
}
async function limit(klucz: string, max: number): Promise<boolean> {
  const r = await rpc("klienci_limit", { p_klucz: klucz, p_max: max, p_ile: 1 });
  return r.ok && r.dane === true; // no counter, no paid call
}

type Ja = { email: string };
// the caller must hold a portal session of an administrator
async function admin(req: Request): Promise<Ja | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) { await r.body?.cancel(); return null; }
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (m.portal !== true || m.portal_admin !== true || !u.email) return null;
  return { email: String(u.email) };
}

const formaTyp = (forma: unknown): "krs" | "jdg" | "inne" => {
  const f = String(forma ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9 ]+/g, " ");
  if (/\b(jdg|jednoosobowa|dzialalnosc|osoba fizyczna|ceidg)\b/.test(f)) return "jdg";
  if (/\bspolka cywilna\b|\bs c\b/.test(f) || !f.trim()) return "inne";
  return "krs";
};
const ladnie = (s: unknown) => String(s ?? "").toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
const DOK_KOL = "id,created_at,kto,rodzaj,rodzina,rok,numer,aneks_nr,numer_pelny,umowa_numer,umowa_data,klient,klient_nazwa,klient_nip,data,szablon_wersja,kwota,docx_path,docx_rozmiar,umowa_id,status,status_at,status_kto,uwagi";

// ---------------------------------------------------------------- templates
const pamiec = new Map<string, Szablon>();
async function aktywny(rodzaj: Rodzaj): Promise<{ wiersz: Any; szablon: Szablon } | null> {
  const w = await jeden(`umowy_szablony?rodzaj=eq.${rodzaj}&aktywny=is.true&select=*`);
  if (!w) return null;
  let s = pamiec.get(w.path);
  if (!s) {
    const b = await pobierz(B_WZORY, w.path);
    if (!b || (await sha256(b)) !== w.sha256) throw new Error("Plik szablonu jest niedostępny albo zmieniony — wgraj szablon ponownie.");
    s = await otworz(b);
    pamiec.set(w.path, s);
  }
  return { wiersz: w, szablon: s };
}

// ---------------------------------------------------------------- register data of a firm
// What the form needs out of an answer of getFirma (or of a stored snapshot of it).
function zRejestru(d: Any, skad: string, pobrano: string | null, powiat: string): Any {
  const osoby: Osoba[] = (d?.reprezentacja?.osoby ?? []).map((o: Any) => ({ imie_nazwisko: t(o.imie_nazwisko, 120), funkcja: t(o.funkcja, 120), zrodlo: "rejestr" })).filter((o: Osoba) => o.imie_nazwisko);
  const prok: Osoba[] = (d?.prokurenci ?? []).map((p: Any) => ({ imie_nazwisko: t(p.imie_nazwisko, 120), funkcja: "Prokurent" + (p.rodzaj ? " (" + String(p.rodzaj).toLowerCase() + ")" : ""), zrodlo: "rejestr" })).filter((o: Osoba) => o.imie_nazwisko);
  return {
    nazwa: t(d?.nazwa), adres: adresSiedziby({ ulica: ladnie(d?.ulica), kod: d?.kod, miasto: ladnie(d?.miasto) }), krs: cyfry(d?.krs), nip: cyfry(d?.nip), regon: cyfry(d?.regon),
    kapital: d?.kapital ?? null, forma: t(d?.forma, 120), organ: t(d?.reprezentacja?.organ, 200), sposob: t(d?.reprezentacja?.sposob, 2000), osoby, prokurenci: prok,
    powiat, sad: d?.sad ?? null, sygnatura: d?.sygnatura ?? null, pobrano, wiek_dni: pobrano ? Math.floor((Date.now() - Date.parse(pobrano)) / 86400000) : null, skad, zrodlo: "rejestr.io (KRS)",
  };
}
// The register data the portal ALREADY holds for a firm (a snapshot of the clients module or the firms base): free.
async function zPamieci(nip: string, klient: string | null): Promise<Any | null> {
  if (klient) {
    const s = await jeden(`klienci_rejestr?klient=eq.${enc(klient)}&zrodlo=eq.krs&znaleziono=is.true&select=fetched_at,sprawdzono_at,dane,powiat:surowe->adres->teryt->>powiat&order=fetched_at.desc`);
    if (s?.dane?.found) return zRejestru(s.dane, "migawka z Bazy klientów", s.sprawdzono_at ?? s.fetched_at, t(s.powiat, 8));
  }
  if (/^\d{10}$/.test(nip)) {
    const c = await jeden(`portal_firmy_cache?nip=eq.${nip}&select=data,fetched_at`);
    if (c?.data?.found && c.data.v === 2) {
      const s = await jeden(`klienci_rejestr?nip=eq.${nip}&zrodlo=eq.krs&select=powiat:surowe->adres->teryt->>powiat&order=fetched_at.desc`);
      return zRejestru(c.data, "baza firm portalu", c.fetched_at, t(s?.powiat, 8));
    }
  }
  return null;
}
// What the form of a sole trader's contract takes from a normalised record (_shared/jdg.ts).
function jdgDoFormularza(j: Any, pobrano: string | null, skad: string): Any {
  const zrodlo: ZrodloJdg = j?.zrodlo === "ceidg" || j?.zrodlo === "mf" ? j.zrodlo : "gus";
  return {
    regon: cyfry(j?.regon), nazwa: t(j?.nazwa), adres: t(j?.adres), wlasciciel: ladnie([t(j?.imie, 80), t(j?.nazwisko, 120)].filter(Boolean).join(" ")),
    status: t(j?.status, 80), zrodlo, zrodlo_nazwa: NAZWA_ZRODLA[zrodlo], podstawowe: zrodlo === "mf", sprawdzono_at: pobrano, skad,
  };
}
const LIMIT_OSOBY = "Dzienny limit płatnych zapytań do rejestru dla jednej osoby został wykorzystany — spróbuj jutro albo skorzystaj z danych już zapisanych.";
const LIMIT_DNIA = "Dzienny limit płatnych zapytań do rejestru został wykorzystany — spróbuj jutro.";

// everything the server itself knows about the firm of a form: the certainty of the court and the rule of representation
async function kontekstFirmy(f: Formularz, sady: Sad[]): Promise<{ rep: Reprezentacja | null; sadPewny: boolean; rej: Any | null }> {
  if (RODZAJE[f.rodzaj].rodzina !== "SPZOO") return { rep: null, sadPewny: false, rej: null };
  const nip = cyfry(f.firma?.nip);
  const rej = await zPamieci(nip, okId(f.klient) ? f.klient : null);
  if (!rej || rej.nip !== nip) return { rep: null, sadPewny: false, rej: null };
  const s = ustalSad(rej, sady);
  return { rep: reprezentacja(rej.sposob, rej.osoby), sadPewny: s.pewne && s.nazwa === t(f.firma?.sad, 400).toUpperCase(), rej };
}
// only what the document needs is kept from the browser's form
function czystyFormularz(x: Any): Formularz | null {
  if (!x || typeof x !== "object" || !czyRodzaj(x.rodzaj)) return null;
  const o = (v: Any) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const liczba = (v: Any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const p = o(x.prognoza), a = o(x.aneks), k = o(x.kontakt), fi = o(x.firma), ok = o(x.okres), pt = o(x.potwierdzenia);
  return {
    rodzaj: x.rodzaj, klient: okId(x.klient) ? x.klient : null,
    firma: { nazwa: t(fi.nazwa), adres: t(fi.adres), krs: cyfry(fi.krs).slice(0, 10), nip: cyfry(fi.nip).slice(0, 10), regon: cyfry(fi.regon).slice(0, 14), sad: t(fi.sad, 400) },
    podpisujacy: (Array.isArray(x.podpisujacy) ? x.podpisujacy : []).slice(0, 6).map((s: Any) => ({ imie_nazwisko: t(s?.imie_nazwisko, 120), funkcja: t(s?.funkcja, 120), zrodlo: s?.zrodlo === "reczna" ? "reczna" : "rejestr" })),
    wlasciciel: t(x.wlasciciel, 120),
    kontakt: { imie_nazwisko: t(k.imie_nazwisko, 120), email: t(k.email, 200), telefon: t(k.telefon, 40) },
    okres: { rok: Math.floor(liczba(ok.rok)), miesiac: Math.floor(liczba(ok.miesiac)), tekst: t(ok.tekst, 200) },
    prognoza: RODZAJE[x.rodzaj as Rodzaj].prognoza && x.prognoza && typeof x.prognoza === "object" && String(x.prognoza.zapisy ?? "").trim() !== "" ? {
      zapisy: liczba(p.zapisy), vat: p.vat === true, uop: liczba(p.uop), uz: liczba(p.uz), kadry: p.kadry === "odrebnie" ? "odrebnie" : "w_stawce",
      srodki_trwale: liczba(p.srodki_trwale), roznice_kursowe: liczba(p.roznice_kursowe), vat_ue: p.vat_ue === true, zus_dra: liczba(p.zus_dra),
      inne: (Array.isArray(p.inne) ? p.inne : []).slice(0, 12).map((r: Any) => ({ nazwa: t(r?.nazwa, 200), kwota: liczba(r?.kwota) })), tekst_zapisy: t(p.tekst_zapisy, 80), tekst_inne: t(p.tekst_inne, 300),
    } : undefined,
    aneks: { umowa_numer: t(a.umowa_numer, 60), umowa_data: isDate(a.umowa_data) ? a.umowa_data : "", aneks_nr: Number.isInteger(a.aneks_nr) && a.aneks_nr > 0 && a.aneks_nr < 100 ? a.aneks_nr : null },
    potwierdzenia: { reprezentacja: pt.reprezentacja === true, sad: pt.sad === true },
    zrodla: Object.fromEntries(Object.entries(o(x.zrodla)).slice(0, 30).map(([kk, v]) => [t(kk, 40), t(v, 80)])),
  };
}
// the client of a register row as the contracts module describes it
function wierszUmowy(d: Any, f: Formularz | null, plikNazwa: string, rozmiar: number, kto: string, podpisana: boolean): Any {
  const aneks = String(d.rodzaj).startsWith("aneks_");
  const rep = (f?.podpisujacy ?? []).filter((o) => o.imie_nazwisko).map((o) => ({ imie_nazwisko: o.imie_nazwisko, funkcja: o.funkcja }));
  if (!rep.length && f?.wlasciciel) rep.push({ imie_nazwisko: f.wlasciciel, funkcja: "przedsiębiorca" });
  return {
    uploaded_by: kto, nazwa: plikNazwa, rozmiar, mime: "application/pdf", klient: d.klient, rodzaj: aneks ? "aneks" : "ksiegowosc", obejmuje: ["ksiegowosc"], data_zawarcia: d.data,
    kontrahent: d.klient_nazwa, kontrahent_nip: d.klient_nip, kontrahent_krs: f?.firma?.krs || null, reprezentanci: rep, obowiazuje_od: d.data, bezterminowa: aneks ? null : true,
    wynagrodzenie: aneks || String(d.rodzaj).startsWith("nowa_") ? "według Cennika, płatne z góry na podstawie faktury pro forma (przedpłata)" + (d.kwota != null ? "; pierwsza Stawka Miesięczna " + d.kwota + " zł netto" : "") : "według Cennika (załącznik nr 1)",
    podpisy: podpisana ? "obie_strony" : "brak", status: podpisana && d.klient ? "przypisany" : "do_sprawdzenia", sprawdzil: podpisana ? kto : null, sprawdzono_at: podpisana ? new Date().toISOString() : null,
    uwagi: (podpisana ? "Podpisany egzemplarz dokumentu wygenerowanego w portalu: " : "WYGENEROWANA W PORTALU — DO PODPISU (to nie jest jeszcze zawarta umowa): ") + d.numer_pelny + ".",
    ai: { zrodlo: "generator", dokument: d.id, numer: d.numer_pelny },
  };
}
function pdfOk(b: Uint8Array): string {
  if (b.length < 200 || b.length > MAX_PDF) return "Nieprawidłowy rozmiar pliku PDF.";
  if (new TextDecoder("latin1").decode(b.subarray(0, 5)) !== "%PDF-") return "To nie jest plik PDF.";
  if (!new TextDecoder("latin1").decode(b.subarray(Math.max(0, b.length - 2048))).includes("%%EOF")) return "Plik PDF jest niekompletny.";
  return "";
}
async function usunZModuluUmow(id: string, kto: string): Promise<void> {
  const row = await jeden(`klienci_umowy?id=eq.${id}&select=*`);
  if (!row) return;
  const b = await pobierz(B_UMOWY, row.path);
  await usun(B_UMOWY, row.path);
  const log = await db("klienci_umowy_usuniete", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ usunal: kto, umowa_id: row.id, klient: row.klient, nazwa: row.nazwa, path: row.path, rozmiar: row.rozmiar, sha256: b ? await sha256(b) : null, rodzaj: row.rodzaj, data_zawarcia: row.data_zawarcia, uploaded_by: row.uploaded_by, wgrano_at: row.created_at }) });
  await log.body?.cancel();
  const del = await db(`klienci_umowy?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await del.body?.cancel();
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const ja = await admin(req);
  if (!ja) return json({ error: "Generator umów jest dostępny tylko dla administratorów portalu." }, 403, origin);
  let body: Any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowe zapytanie." }, 400, origin); }
  const action = String(body?.action ?? "");
  const zle = (m: string, s = 400) => json({ error: m }, s, origin);
  try {
    // ------------------------------------------------------------ start
    if (action === "start") {
      const [szablony, numeracja, cennik, sady, dokumenty, baza, lista, umowy, migracja] = await Promise.all([
        all("umowy_szablony?select=*&order=rodzaj,wersja.desc"), all("umowy_numeracja?select=*&order=rok.desc,rodzina.desc"), all("umowy_cennik?select=*&order=rodzina.desc,kolejnosc"),
        all("umowy_sady?select=*&order=nazwa"), all(`umowy_dokumenty?select=${DOK_KOL}&order=created_at.desc`),
        all("klienci_baza?select=id,nip,nazwa,forma,adres,miasto,opiekun,kadrowy,status&order=nazwa"), all("portal_klienci?select=id,dane"),
        all("klienci_umowy?select=id,klient,rodzaj,status,sprawdzil,data_zawarcia,nazwa,wynagrodzenie,zakres,uwagi&klient=not.is.null&order=data_zawarcia.desc.nullslast"),
        all("umowy_migracja?select=*"),
      ]);
      const dane = new Map(lista.map((l: Any) => [l.id, l.dane ?? {}]));
      const reczny = new Map(migracja.map((m: Any) => [m.klient, m]));
      const klienci = baza.map((k: Any) => {
        const d: Any = dane.get(k.id) ?? {}, um = umowy.filter((u: Any) => u.klient === k.id), dok = dokumenty.filter((x: Any) => x.klient === k.id), m: Any = reczny.get(k.id);
        const ks = um.find((u: Any) => u.rodzaj === "ksiegowosc" && u.status === "przypisany");
        const wlasna = dok.find((x: Any) => x.numer != null && x.status !== "anulowana");
        return {
          id: k.id, nip: k.nip, nazwa: k.nazwa, forma: k.forma, typ: formaTyp(k.forma), adres: k.adres, miasto: k.miasto, opiekun: k.opiekun, status: k.status,
          email: t(d.email, 200), telefon: t(d.telefon, 40), kontakt: t(d.kontakt, 200), ksiegowosc: !!t(k.opiekun),
          stan: stanMigracji(um, dok, m && m.stan !== "auto" ? m.stan : null), stan_uwagi: m?.uwagi ?? null,
          umowa: ks ? { numer: numerZNazwy(ks.nazwa) || numerZNazwy(ks.uwagi), data: ks.data_zawarcia, potwierdzona: !!ks.sprawdzil } : wlasna ? { numer: wlasna.numer_pelny, data: wlasna.data, potwierdzona: wlasna.status === "podpisana" } : null,
        };
      });
      const rok = +dzisPl().slice(0, 4);
      const nast = (r: string) => (numeracja.find((n: Any) => n.rodzina === r && n.rok === rok)?.ostatni ?? 0) + 1;
      return json({ ja: ja.email, dzis: dzisPl(), rok, szablony, numeracja, nastepne: { SPZOO: nast("SPZOO") + "/SPZOO/" + rok, JDG: nast("JDG") + "/JDG/" + rok }, cennik, sady, dokumenty, klienci,
        rodzaje: RODZAJE, rejestr: { skonfigurowany: firmaConfigured(), dni_migawki: DNI_MIGAWKI } }, 200, origin);
    }

    // ------------------------------------------------------------ data of a firm for the form
    if (action === "firma") {
      const klient = okId(body.klient) ? body.klient : null;
      let nip = cyfry(body.nip), krs = cyfry(body.krs);
      let baza: Any = null, kontakt: Any = {}, typ: "krs" | "jdg" | "inne" = "krs", umowa: Any = null, gus: Any = null;
      if (klient) {
        baza = await jeden(`klienci_baza?id=eq.${enc(klient)}&select=id,nip,nazwa,forma,adres,miasto,opiekun,status`);
        if (!baza) return zle("Nie ma takiego klienta w bazie.", 404);
        const d = (await jeden(`portal_klienci?id=eq.${enc(klient)}&select=dane`))?.dane ?? {};
        kontakt = { email: t(d.email, 200), telefon: t(d.telefon, 40), osoba: t(d.kontakt, 120) };
        typ = formaTyp(baza.forma); nip = cyfry(baza.nip); krs = "";
        const um = await all(`klienci_umowy?klient=eq.${enc(klient)}&rodzaj=eq.ksiegowosc&status=eq.przypisany&select=nazwa,uwagi,data_zawarcia,sprawdzil&order=data_zawarcia.desc.nullslast`);
        const wl = await all(`umowy_dokumenty?klient=eq.${enc(klient)}&numer=not.is.null&status=neq.anulowana&select=numer_pelny,data,status&order=created_at.desc`);
        if (um[0]) umowa = { numer: numerZNazwy(um[0].nazwa) || numerZNazwy(um[0].uwagi), data: um[0].data_zawarcia, potwierdzona: !!um[0].sprawdzil, skad: "Baza klientów — umowy" };
        else if (wl[0]) umowa = { numer: wl[0].numer_pelny, data: wl[0].data, potwierdzona: wl[0].status === "podpisana", skad: "rejestr generatora" };
        if (typ === "jdg") {
          // the sole trader's record the clients base already holds (CEIDG, GUS or — basic data only — MF)
          const m = await jeden(`klienci_rejestr?klient=eq.${enc(klient)}&zrodlo=neq.krs&znaleziono=is.true&select=regon,nazwa,adres,zrodlo,sprawdzono_at,dane&order=fetched_at.desc`);
          if (m) gus = jdgDoFormularza({ ...(m.dane ?? {}), regon: m.regon, nazwa: m.nazwa, adres: m.adres, zrodlo: m.zrodlo }, m.sprawdzono_at, "migawka z Bazy klientów");
        }
      } else if (nip.length !== 10 && !(krs.length >= 1 && krs.length <= 10)) return zle("Podaj klienta z bazy, NIP albo numer KRS.");
      const sady: Sad[] = await all("umowy_sady?select=nazwa,kod,powiaty");
      let rej: Any = null, uwaga = "";
      if (typ !== "jdg") {
        rej = await zPamieci(nip, klient);
        const stary = rej && rej.wiek_dni !== null && rej.wiek_dni > DNI_MIGAWKI;
        if ((!rej || body.odswiez === true) && (nip.length === 10 || krs)) {
          if (!firmaConfigured()) uwaga = "Rejestr (rejestr.io) nie jest skonfigurowany — dane wpisz ręcznie.";
          else if (!(await limit("umowy-firma:" + ja.email, MAX_FIRM_OSOBA))) { if (!rej) return zle(LIMIT_OSOBY, 429); uwaga = LIMIT_OSOBY; }
          else if (!(await limit("rejestr", MAX_REJESTR_DZIEN))) { if (!rej) return zle(LIMIT_DNIA, 429); uwaga = LIMIT_DNIA; }
          else {
            const d = await getFirma(nip.length === 10 ? nip : "", body.odswiez === true, nip.length === 10 ? "" : krs.padStart(10, "0"));
            if (d?.found) rej = zRejestru(d, d.z_pamieci ? "baza firm portalu" : "rejestr.io — nowe zapytanie", d.pobrano, rej?.powiat ?? "");
            else if (!rej) uwaga = "Rejestr nie zna firmy o tym numerze — sprawdź numer albo wpisz dane ręcznie.";
          }
        } else if (stary) uwaga = "Dane z rejestru mają " + rej.wiek_dni + " dni — przed podpisaniem umowy warto je odświeżyć (płatne zapytanie).";
      } else {
        // a sole trader: CEIDG -> GUS -> MF (see _shared/jdg.ts), through the lookups' cache; asked when the base holds
        // nothing, on request, or when only MF's basic record is there and a fuller source has been connected since
        const zr = zrodlaJdg();
        if (nipOk(nip) && (!gus || body.odswiez === true || (gus.podstawowe && (zr.ceidg || zr.gus)))) {
          if (!(await limit("umowy-firma:" + ja.email, MAX_FIRM_OSOBA))) uwaga = LIMIT_OSOBY;
          else {
            const w = await jdgFirma(nip, null, body.odswiez === true);
            if (w.stan === "ok" && !(gus && !gus.podstawowe && w.dane.podstawowe)) gus = jdgDoFormularza(w.dane, w.pobrano, w.z_pamieci ? "baza firm portalu" : "nowe zapytanie");
            else if (w.stan === "brak" && !gus) uwaga = "JDG: nie znaleziono firmy (" + w.powod + ")" + (w.powod === "brak w wykazie VAT" ? " — to nie oznacza, że firma nie istnieje" : "") + ". Dane wpisz ręcznie.";
            else if (w.stan !== "ok" && !gus) uwaga = "JDG: rejestry nie odpowiedziały — dane z bazy klientów. REGON oraz imię i nazwisko przedsiębiorcy sprawdź i uzupełnij ręcznie.";
          }
        }
        if (gus) uwaga = gus.podstawowe
          ? "JDG: dane podstawowe z Wykazu podatników VAT (MF), stan z " + String(gus.sprawdzono_at ?? "").slice(0, 10) + " — wykaz nie rozróżnia firmy i nazwiska ani nie podaje zawieszenia działalności. Imię i nazwisko przedsiębiorcy oraz nazwę firmy sprawdź i uzupełnij ręcznie; pełne dane będą po podłączeniu CEIDG."
          : "JDG: dane z " + gus.zrodlo_nazwa + ", stan z " + String(gus.sprawdzono_at ?? "").slice(0, 10) + (gus.wlasciciel ? "" : " — imię i nazwisko przedsiębiorcy uzupełnij ręcznie") + (gus.status && gus.status !== "aktywna" ? ". UWAGA: stan działalności według rejestru: " + gus.status : "") + ".";
        else if (!uwaga) uwaga = "JDG: brak danych z rejestru — dane z bazy klientów. REGON oraz imię i nazwisko przedsiębiorcy sprawdź i uzupełnij ręcznie.";
      }
      const rep = rej ? reprezentacja(rej.sposob, rej.osoby) : null;
      const sad = typ !== "jdg" ? ustalSad(rej ?? {}, sady) : null;
      return json({
        typ, klient, baza, kontakt, umowa, gus, rej, rep, sad, uwaga,
        roznice: baza && rej ? roznice(baza, rej) : [],
        podpisujacy: (rej?.osoby ?? []).map((o: Osoba) => ({ ...o, stanowisko: stanowiskoBiernik(o.funkcja) })).concat((rej?.prokurenci ?? []).map((o: Osoba) => ({ ...o, stanowisko: "Prokurenta" }))),
      }, 200, origin);
    }
    if (action === "szukaj") {
      const q = t(body.q, 120);
      if (q.length < 3) return zle("Wpisz co najmniej 3 znaki nazwy, NIP albo numer KRS.");
      if (!firmaConfigured()) return zle("Rejestr (rejestr.io) nie jest skonfigurowany.", 503);
      if (!(await limit("umowy-szukaj:" + ja.email, MAX_SZUKAN_OSOBA))) return zle(LIMIT_OSOBY, 429);
      return json({ wyniki: await searchFirmy(q) }, 200, origin);
    }

    // ------------------------------------------------------------ draft and final generation
    if (action === "podglad" || action === "generuj") {
      const f = czystyFormularz(body.formularz);
      if (!f) return zle("Nieprawidłowy formularz — wybierz rodzaj dokumentu.");
      const R = RODZAJE[f.rodzaj];
      if (f.klient && !(await jeden(`klienci_baza?id=eq.${enc(f.klient)}&select=id`))) return zle("Nie ma takiego klienta w bazie.", 404);
      const akt = await aktywny(f.rodzaj);
      if (!akt) return zle("Brak aktywnego szablonu dla tego rodzaju dokumentu — wgraj szablon.", 409);
      const [cennik, sady] = await Promise.all([all("umowy_cennik?select=*&aktywna=is.true&order=kolejnosc") as Promise<Pozycja[]>, all("umowy_sady?select=nazwa,kod,powiaty") as Promise<Sad[]>]);
      const kf = await kontekstFirmy(f, sady);
      const data = dzisPl(), rok = +data.slice(0, 4);
      const final = action === "generuj";
      let wolnyAneks = 1;
      if (R.aneks && f.aneks?.umowa_numer) {
        const a = await jeden(`umowy_dokumenty?rodzina=eq.${R.rodzina}&umowa_numer=eq.${enc(f.aneks.umowa_numer)}&aneks_nr=not.is.null&select=aneks_nr&order=aneks_nr.desc`);
        wolnyAneks = (a?.aneks_nr ?? 0) + 1;
      }
      const numerProjektu = R.aneks ? String(f.aneks?.aneks_nr ?? wolnyAneks) : "PROJEKT";
      const proj = wartosci(f, { numer: numerProjektu, data, rok, cennik, rep: kf.rep, sadPewny: kf.sadPewny });
      if (R.aneks && f.aneks?.aneks_nr && f.aneks.aneks_nr < wolnyAneks) proj.braki.push("numer aneksu " + f.aneks.aneks_nr + " jest już użyty — najbliższy wolny to " + wolnyAneks);
      const g0 = await generuj(akt.szablon, proj.wartosci, proj.literaly);
      const lit = proj.literaly.filter((_l, i) => !g0.literaly[i]).map((l) => "we wzorze nie znaleziono tekstu do podmiany: „" + l.szukaj.slice(0, 60) + "”");
      const pozostale = [...g0.pozostale, ...g0.nieznane.map((n) => "{{" + n + "}}")].filter((v, i, a) => a.indexOf(v) === i);
      const wspolne = {
        braki: [...proj.braki, ...lit], ostrzezenia: proj.ostrzezenia, pozostale, prognoza: proj.prognoza, rep: kf.rep,
        szablon: { id: akt.wiersz.id, wersja: akt.wiersz.wersja, nazwa: akt.wiersz.nazwa, do_sprawdzenia: akt.wiersz.do_sprawdzenia }, data,
      };
      if (!final) {
        return json({ ...wspolne, gotowe: !wspolne.braki.length && !pozostale.length, tekst: g0.tekst, docx: b64(g0.docx), nazwa: nazwaPliku("PROJEKT " + f.rodzaj, proj.klient_nazwa || "bez nazwy", "docx"),
          numer: R.aneks ? "Aneks nr " + numerProjektu + " do umowy " + (f.aneks?.umowa_numer || "…") : "PROJEKT — numer zostanie nadany przy generowaniu" }, 200, origin);
      }
      if (wspolne.braki.length || pozostale.length) return json({ error: "Dokumentu nie można wygenerować — uzupełnij brakujące dane.", ...wspolne }, 422, origin);
      // the number: one transaction with the register row
      const reg = await rpc("umowy_zarejestruj", { p: {
        kto: ja.email, rodzaj: f.rodzaj, rodzina: R.rodzina, rok, data, klient: f.klient ?? "", klient_nazwa: proj.klient_nazwa, klient_nip: proj.klient_nip,
        szablon: akt.wiersz.id, szablon_wersja: akt.wiersz.wersja, szablon_sha256: akt.wiersz.sha256, kwota: proj.prognoza ? String(proj.prognoza.kwota) : "",
        umowa_numer: R.aneks ? f.aneks!.umowa_numer : "", umowa_data: R.aneks ? f.aneks!.umowa_data : "", aneks_nr: R.aneks ? f.aneks!.aneks_nr : null,
        dane: { formularz: f, prognoza: proj.prognoza, ostrzezenia: proj.ostrzezenia, rejestr: kf.rej ? { skad: kf.rej.skad, pobrano: kf.rej.pobrano } : null },
      } });
      if (!reg.ok || !reg.dane?.id) return zle("Nie udało się nadać numeru: " + reg.blad, 409);
      const d = reg.dane;
      const porazka = async (m: string) => {
        const r = await db(`umowy_dokumenty?id=eq.${d.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "anulowana", status_at: new Date().toISOString(), status_kto: ja.email, uwagi: "Błąd generowania: " + m }) });
        await r.body?.cancel();
        await zdarzenie(ja.email, d.id, "blad", { m });
        return json({ error: m + " Numer " + d.numer_pelny + " został zużyty i jest oznaczony w rejestrze jako anulowany.", dokument: d }, 500, origin);
      };
      const ost = wartosci(f, { numer: String(R.aneks ? d.aneks_nr : d.numer), data, rok, cennik, rep: kf.rep, sadPewny: kf.sadPewny });
      const g = await generuj(akt.szablon, ost.wartosci, ost.literaly);
      if (g.pozostale.length || g.nieznane.length) return await porazka("W dokumencie zostały niewypełnione pola.");
      const nazwa = nazwaPliku((R.aneks ? "Aneks " + d.aneks_nr + " do " : "Umowa ") + (R.aneks ? d.umowa_numer : d.numer_pelny), proj.klient_nazwa, "docx");
      const path = d.id + "/" + nazwa;
      if (!(await zapisz(B_DOCX, path, g.docx, DOCX_MIME))) return await porazka("Nie udało się zapisać pliku DOCX.");
      const up = await db(`umowy_dokumenty?id=eq.${d.id}&select=${DOK_KOL}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ docx_path: path, docx_sha256: await sha256(g.docx), docx_rozmiar: g.docx.length }) });
      const wiersz = up.ok ? (await up.json())[0] : d;
      await zdarzenie(ja.email, d.id, "wygenerowano", { numer: d.numer_pelny, szablon: akt.wiersz.wersja });
      // a court the administrator confirmed is remembered for the county of the seat
      if (R.rodzina === "SPZOO" && f.firma.sad && !kf.sadPewny && f.potwierdzenia?.sad) {
        const naz = f.firma.sad.toUpperCase(), s = await jeden(`umowy_sady?nazwa=eq.${enc(naz)}&select=id,powiaty`), pow = kf.rej?.powiat || "";
        const r = s ? (pow && !s.powiaty.includes(pow) ? await db(`umowy_sady?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ powiaty: [...s.powiaty, pow] }) }) : null)
          : await db("umowy_sady", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ nazwa: naz, powiaty: pow ? [pow] : [], dodal: ja.email }) });
        await r?.body?.cancel();
      }
      return json({ ok: true, dokument: wiersz, docx: b64(g.docx), nazwa, ...wspolne, tekst: g.tekst }, 200, origin);
    }

    // ------------------------------------------------------------ files of a registered document
    if (action === "pdf_zapisz" || action === "podpisany") {
      if (!UUID.test(body.id ?? "") || typeof body.pdf !== "string") return zle("Nieprawidłowe zapytanie.");
      const d = await jeden(`umowy_dokumenty?id=eq.${body.id}&select=*`);
      if (!d) return zle("Nie znaleziono dokumentu.", 404);
      if (d.status === "anulowana") return zle("Dokument jest anulowany.", 409);
      let pdf: Uint8Array;
      try { pdf = zB64(body.pdf); } catch { return zle("Nieprawidłowy plik."); }
      const zl = pdfOk(pdf);
      if (zl) return zle(zl);
      const podpisana = action === "podpisany";
      if (!podpisana && d.umowa_id) return zle("Kopia PDF tego dokumentu jest już zapisana.", 409);
      if (!podpisana && (d.status === "podpisana")) return zle("Dokument jest już podpisany.", 409);
      const f = (d.dane?.formularz ?? null) as Formularz | null;
      const stary = d.umowa_id ? await jeden(`klienci_umowy?id=eq.${d.umowa_id}&select=id,path`) : null;
      const uid = stary?.id ?? crypto.randomUUID();
      const nazwa = nazwaPliku((podpisana ? "PODPISANA " : "") + d.numer_pelny, d.klient_nazwa, "pdf");
      const path = uid + "/" + nazwa;
      if (stary?.path === path) return zle("Podpisany egzemplarz jest już zapisany.", 409);
      if (!(await zapisz(B_UMOWY, path, pdf, "application/pdf"))) return zle("Nie udało się zapisać pliku PDF.", 502);
      const w = { ...wierszUmowy(d, f, nazwa, pdf.length, ja.email, podpisana), path, stron: Number.isInteger(body.strony) && body.strony > 0 && body.strony < 500 ? body.strony : null };
      const r = stary ? await db(`klienci_umowy?id=eq.${uid}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(w) })
        : await db("klienci_umowy", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id: uid, ...w }) });
      if (!r.ok) { const m = await r.text(); await usun(B_UMOWY, path); console.log("umowy", action, "klienci_umowy:", r.status, m.slice(0, 200)); return zle("Nie udało się zapisać dokumentu w module umów.", 500); }
      await r.body?.cancel();
      if (stary && stary.path !== path) await usun(B_UMOWY, stary.path); // the unsigned copy gives way to the signed one: one row, one file
      const zm: Any = { umowa_id: uid };
      if (podpisana) Object.assign(zm, { status: "podpisana", status_at: new Date().toISOString(), status_kto: ja.email });
      const up = await db(`umowy_dokumenty?id=eq.${d.id}&select=${DOK_KOL}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(zm) });
      await zdarzenie(ja.email, d.id, podpisana ? "podpisany" : "pdf", { rozmiar: pdf.length });
      return json({ ok: true, dokument: up.ok ? (await up.json())[0] : null }, 200, origin);
    }
    if (action === "pobierz") {
      if (!UUID.test(body.id ?? "")) return zle("Nieprawidłowy identyfikator dokumentu.");
      const d = await jeden(`umowy_dokumenty?id=eq.${body.id}&select=id,docx_path,umowa_id,numer_pelny`);
      if (!d) return zle("Nie znaleziono dokumentu.", 404);
      if (body.co === "pdf") {
        const u = d.umowa_id ? await jeden(`klienci_umowy?id=eq.${d.umowa_id}&select=path,nazwa`) : null;
        const b = u ? await pobierz(B_UMOWY, u.path) : null;
        if (!b) return zle("Ten dokument nie ma zapisanej kopii PDF.", 404);
        return json({ nazwa: u.nazwa, mime: "application/pdf", plik: b64(b) }, 200, origin);
      }
      const b = d.docx_path ? await pobierz(B_DOCX, d.docx_path) : null;
      if (!b) return zle("Plik DOCX tego dokumentu nie jest dostępny.", 404);
      await zdarzenie(ja.email, d.id, "pobrano", { co: "docx" });
      return json({ nazwa: d.docx_path.split("/").pop(), mime: DOCX_MIME, plik: b64(b) }, 200, origin);
    }
    if (action === "status") {
      if (!UUID.test(body.id ?? "")) return zle("Nieprawidłowy identyfikator dokumentu.");
      const na = String(body.status ?? ""), uwagi = t(body.uwagi, 500);
      if (!["wygenerowana", "wyslana", "anulowana"].includes(na)) return zle("Status „podpisana” nadaje wgranie podpisanego egzemplarza.");
      const d = await jeden(`umowy_dokumenty?id=eq.${body.id}&select=id,status,umowa_id,numer_pelny,uwagi`);
      if (!d) return zle("Nie znaleziono dokumentu.", 404);
      if (d.status === "anulowana") return zle("Dokument jest już anulowany — numer pozostaje zużyty.", 409);
      if (d.status === "podpisana") return zle("Podpisanego dokumentu nie zmienia się tutaj — zajrzyj do Bazy klientów (umowy).", 409);
      if (na === "anulowana" && !uwagi) return zle("Podaj powód anulowania.");
      if (na === "anulowana" && d.umowa_id) await usunZModuluUmow(d.umowa_id, ja.email);
      const zm: Any = { status: na, status_at: new Date().toISOString(), status_kto: ja.email };
      if (uwagi) zm.uwagi = uwagi;
      if (na === "anulowana") zm.umowa_id = null;
      const up = await db(`umowy_dokumenty?id=eq.${d.id}&select=${DOK_KOL}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(zm) });
      if (!up.ok) return zle("Nie udało się zmienić statusu.", 500);
      await zdarzenie(ja.email, d.id, "status", { bylo: d.status, jest: na, uwagi });
      return json({ ok: true, dokument: (await up.json())[0] }, 200, origin);
    }

    // ------------------------------------------------------------ templates
    if (action === "szablon_wgraj") {
      if (!czyRodzaj(body.rodzaj) || typeof body.plik !== "string") return zle("Wybierz rodzaj szablonu i plik DOCX.");
      if (body.plik.length > MAX_SZABLON * 1.4) return zle("Plik szablonu jest za duży (limit 6 MB).");
      let b: Uint8Array;
      try { b = zB64(body.plik); } catch { return zle("Nieprawidłowy plik."); }
      if (b.length > MAX_SZABLON) return zle("Plik szablonu jest za duży (limit 6 MB).");
      let spr;
      try { spr = await sprawdzSzablon(b); } catch (e) { return zle((e as Error).message); }
      if (spr.bledne.length) return json({ error: "W szablonie są uszkodzone pola w nawiasach klamrowych — popraw je i wgraj ponownie.", bledne: spr.bledne }, 400, origin);
      const por = porownajPlaceholdery(body.rodzaj, spr.lista);
      const rozne = por.brakuje.length > 0 || por.nadmiarowe.length > 0;
      if (rozne && body.potwierdz !== true) return json({ wymaga_potwierdzenia: true, placeholdery: spr.lista, ...por }, 200, origin);
      const sha = await sha256(b);
      const poprz = await all(`umowy_szablony?rodzaj=eq.${body.rodzaj}&select=id,wersja,sha256,aktywny&order=wersja.desc`);
      if (poprz.find((p: Any) => p.aktywny)?.sha256 === sha) return json({ bez_zmian: true, placeholdery: spr.lista }, 200, origin);
      const wersja = (poprz[0]?.wersja ?? 0) + 1, path = `${body.rodzaj}/v${wersja}-${sha.slice(0, 12)}.docx`;
      if (!(await zapisz(B_WZORY, path, b, DOCX_MIME))) return zle("Nie udało się zapisać pliku szablonu.", 502);
      const akt = poprz.find((p: Any) => p.aktywny);
      if (akt) { const r = await db(`umowy_szablony?id=eq.${akt.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ aktywny: false }) }); await r.body?.cancel(); }
      const ins = await db("umowy_szablony", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
        rodzaj: body.rodzaj, nazwa: t(body.nazwa, 200) || RODZAJE[body.rodzaj as Rodzaj].nazwa, wersja, sha256: sha, path, rozmiar: b.length, placeholdery: spr.lista, aktywny: true,
        do_sprawdzenia: rozne ? "placeholdery inne niż oczekiwane — wgrano po potwierdzeniu" : null, uwagi: t(body.uwagi, 500) || null, uploaded_by: ja.email }) });
      if (!ins.ok) {
        const m = await ins.text(); console.log("umowy szablon_wgraj:", ins.status, m.slice(0, 200));
        await usun(B_WZORY, path);
        if (akt) { const r = await db(`umowy_szablony?id=eq.${akt.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ aktywny: true }) }); await r.body?.cancel(); }
        return zle("Nie udało się zapisać szablonu.", 500);
      }
      const w = (await ins.json())[0];
      await zdarzenie(ja.email, null, "szablon", { rodzaj: body.rodzaj, wersja, sha256: sha, ...por });
      return json({ ok: true, szablon: w, ...por }, 200, origin);
    }
    if (action === "szablon_pobierz" || action === "szablon_potwierdz") {
      if (!UUID.test(body.id ?? "")) return zle("Nieprawidłowy identyfikator szablonu.");
      const w = await jeden(`umowy_szablony?id=eq.${body.id}&select=*`);
      if (!w) return zle("Nie znaleziono szablonu.", 404);
      if (action === "szablon_potwierdz") {
        const r = await db(`umowy_szablony?id=eq.${w.id}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ do_sprawdzenia: null, uwagi: ((w.uwagi ? w.uwagi + " " : "") + "Zatwierdzony przez " + ja.email + " " + dzisPl() + ".").slice(0, 500) }) });
        if (!r.ok) return zle("Nie udało się zatwierdzić szablonu.", 500);
        await zdarzenie(ja.email, null, "szablon", { zatwierdzono: w.id, rodzaj: w.rodzaj, wersja: w.wersja });
        return json({ ok: true, szablon: (await r.json())[0] }, 200, origin);
      }
      const b = await pobierz(B_WZORY, w.path);
      if (!b) return zle("Plik szablonu nie jest dostępny.", 404);
      return json({ nazwa: w.rodzaj + "-v" + w.wersja + ".docx", mime: DOCX_MIME, plik: b64(b) }, 200, origin);
    }

    // ------------------------------------------------------------ settings
    if (action === "numeracja_ustaw") {
      const rok = Number(body.rok), ost = Number(body.ostatni);
      if (!["SPZOO", "JDG"].includes(body.rodzina) || !Number.isInteger(rok) || rok < 2020 || rok > 2100 || !Number.isInteger(ost) || ost < 0 || ost > 100000) return zle("Podaj rodzinę numeracji, rok i ostatni wydany numer.");
      const r = await rpc("umowy_numeracja_ustaw", { p_rodzina: body.rodzina, p_rok: rok, p_ostatni: ost, p_kto: ja.email });
      if (!r.ok) return zle("Nie zmieniono licznika: " + r.blad, 409);
      await zdarzenie(ja.email, null, "numeracja", { rodzina: body.rodzina, rok, ostatni: ost });
      return json({ ok: true, numeracja: r.dane }, 200, origin);
    }
    if (action === "cennik_zapisz") {
      const p = body.pola ?? {}, id = UUID.test(body.id ?? "") ? body.id : null;
      const cena = p.cena === "" || p.cena === null || p.cena === undefined ? null : Number(String(p.cena).replace(",", "."));
      if (cena !== null && (!Number.isFinite(cena) || cena < 0 || cena > 1000000)) return zle("Cena netto musi być liczbą nieujemną.");
      const w: Any = { nazwa: t(p.nazwa, 400), grupa: t(p.grupa, 200), jednostka: t(p.jednostka, 60) || null, cena, cena_opis: t(p.cena_opis, 300) || null, stala: p.stala === true, aktywna: p.aktywna !== false,
        kod: t(p.kod, 40).toLowerCase().replace(/[^a-z_]/g, "") || null, prog: p.prog === "" || p.prog === null || p.prog === undefined ? null : Math.floor(Number(p.prog)), kolejnosc: Math.floor(Number(p.kolejnosc)) || 0, zmienil: ja.email, zmieniono_at: new Date().toISOString() };
      if (!w.nazwa || !w.grupa) return zle("Pozycja cennika wymaga nazwy i grupy.");
      if (cena === null && !w.cena_opis) return zle("Podaj cenę netto albo jej opis (np. „indywidualnie”).");
      if (w.prog !== null && (!Number.isInteger(w.prog) || w.prog < 0)) return zle("Próg liczby zapisów musi być liczbą całkowitą.");
      if (!id) { if (!["SPZOO", "JDG"].includes(p.rodzina)) return zle("Wybierz cennik: spółki albo JDG."); w.rodzina = p.rodzina; }
      const r = id ? await db(`umowy_cennik?id=eq.${id}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(w) })
        : await db("umowy_cennik?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(w) });
      if (!r.ok) { console.log("umowy cennik:", r.status, (await r.text()).slice(0, 200)); return zle("Nie udało się zapisać pozycji cennika.", 500); }
      const wiersz = (await r.json())[0];
      if (!wiersz) return zle("Nie znaleziono pozycji cennika.", 404);
      return json({ ok: true, pozycja: wiersz }, 200, origin);
    }
    if (action === "cennik_historia") {
      return json({ historia: await all("umowy_cennik_historia?select=*&order=at.desc&limit=200") }, 200, origin);
    }
    if (action === "sad_zapisz") {
      const nazwa = t(body.nazwa, 400).toUpperCase(), kod = t(body.kod, 20).toUpperCase() || null, pow = cyfry(body.powiat).slice(0, 4);
      if (nazwa.length < 15 || !/SĄD/.test(nazwa) || !/WYDZIAŁ/.test(nazwa)) return zle("Wpisz pełne oznaczenie sądu rejestrowego z wydziałem, tak jak w odpisie KRS.");
      const s = await jeden(`umowy_sady?nazwa=eq.${enc(nazwa)}&select=id,powiaty,kod`);
      const r = s ? await db(`umowy_sady?id=eq.${s.id}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ kod: kod ?? s.kod, powiaty: pow && !s.powiaty.includes(pow) ? [...s.powiaty, pow] : s.powiaty }) })
        : await db("umowy_sady?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ nazwa, kod, powiaty: pow ? [pow] : [], dodal: ja.email }) });
      if (!r.ok) { await r.body?.cancel(); return zle("Nie udało się zapisać sądu (kod wydziału musi być unikalny).", 409); }
      await zdarzenie(ja.email, null, "sad", { nazwa, kod, powiat: pow });
      return json({ ok: true, sad: (await r.json())[0] }, 200, origin);
    }
    if (action === "migracja_oznacz") {
      if (!okId(body.klient) || !["przedplata", "pomin", "auto"].includes(body.stan)) return zle("Nieprawidłowe zapytanie.");
      if (!(await jeden(`klienci_baza?id=eq.${enc(body.klient)}&select=id`))) return zle("Nie ma takiego klienta w bazie.", 404);
      const r = await db("umowy_migracja", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ klient: body.klient, stan: body.stan, uwagi: t(body.uwagi, 500) || null, zmienil: ja.email, zmieniono_at: new Date().toISOString() }) });
      if (!r.ok) { await r.body?.cancel(); return zle("Nie udało się zapisać.", 500); }
      await r.body?.cancel();
      await zdarzenie(ja.email, null, "migracja", { klient: body.klient, stan: body.stan });
      return json({ ok: true }, 200, origin);
    }
    return zle("Nieznana akcja.");
  } catch (e) {
    console.log("umowy", action, (e as Error).message);
    return json({ error: "Błąd serwera — spróbuj ponownie." }, 500, origin);
  }
});
