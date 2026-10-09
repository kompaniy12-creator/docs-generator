// Baza klientów: the office's lasting register of clients — service status, register data, contracts audit.
// PORTAL ONLY (JWT with app_metadata.portal === true). Every action is a POST with { action, ... }.
//
//   lista                                  any portal user
//     -> { ja, klienci: [{ ...client, rej, rej_historia, ostrzezenia, odpis, kontakt?, audyt?, historia? }], umowy?, cena }
//     The portal is the master of the clients list (table portal_klienci, edited with klient_zapisz below);
//     klienci_baza is kept in step with it (checked at most every 30 minutes; never deletes).
//     A user who is not an administrator gets a fixed set of columns (no "who changed", no upstream error
//     texts); contact data and sole traders' addresses only for the Kadry section (as in klienci-list);
//     contracts, the audit and the status history only for administrators.
//   sync                                   administrator — the same check, at once
//   klient_zapisz      { id?, dane, dry?, potwierdz_nip? }   administrator — adds a client (no id) or changes one.
//     dry: true answers with what would change and saves nothing. Every save is one transaction that also
//     moves the client's id when its NIP (or, without a NIP, its name) changes, and appends who changed what.
//     Changing the NIP of a client that already had one needs potwierdz_nip: other modules keep their rows
//     under the old NIP (the answer says how many). Clients are never deleted — service is ended instead.
//   telegram_sprawdz   { id } | { wszystkie: true, od }   administrator — the Telegram audit, now
//   telegram_ustawienia { boty: [{ nazwa, user_id }] }    administrator — bots required in every group
//   telegram_cron                          x-cron-key — the daily audit, a batch per call; when a run is complete
//                                          and something got worse, ONE task for the administrator (never a
//                                          message to a client's group). Telegram is only ever read.
//   rejestr            { id, fresh? }      administrator — reads the register for one client (paid);
//                                          once a day per client, and within the daily cap of requests
//   rejestr_wszystkie  { dry, dni?, z_zakonczonymi? }   administrator
//     dry: true  -> the plan: how many firms, requests and the estimated cost; nothing is fetched.
//                   `jdg`: which sources for sole traders are configured and MF's share of the day
//     dry: false -> reads at most MAX_NA_RAZ firms of the plan and says how many are left; stops at once
//                   when a provider refuses (inactive key, limit, outage) or the daily cap is reached
//                   (`jutro: true` — MF's share of the day is used up: nothing is broken, go on tomorrow)
//   status             { id, status, koniec_od?, obsluga_od?, powod? }   administrator
//   rozpoznaj          { id, force? }      administrator — reads a contract scan and proposes the client.
//                                          A document already filed or confirmed by a person is read again only
//                                          with force, and then a confirmed one keeps every field: the new
//                                          reading goes to `ai` alone. Daily cap of readings per user.
//   usun_umowe         { id }              administrator — removes the file, then the row, and records who did it
//   braki_csv                              administrator -> { csv }
//
// Register data: KRS firms through _shared/firma.ts (rejestr.io, paid per request) plus rejestr.io's basic
// record kept in full; sole traders are not in KRS — they are read through _shared/jdg.ts: CEIDG (official),
// then GUS (REGON, DataPort), then MF's VAT register (basic data, marked zrodlo "mf" and replaced later).

import { firmaConfigured, getFirma } from "../_shared/firma.ts";
import { BladJdg, doZapisu, pobierzJdg, zrodlaJdg } from "../_shared/jdg.ts";
import {
  audytKlienta, bezDanychOsobowych, CENA_REJESTR_IO, csvBraki, digits, dopasuj, formaTyp, FORMY_LISTA, isDate, JEZYKI_LISTA, klientId, nipOk, odcisk, ostrzezeniaRejestru, POLA_KLIENTA,
  MF_DZIENNIE, MF_DZIENNIE_POJEDYNCZE, MF_KLUCZ, pewnyKlient, planOdswiezenia, roznice, type Wyciag, walidujKlienta, wyciagJdg, wyciagKrs, zakres, zJdg, zmianyKlienta,
} from "./logic.ts";
import { Limit, type Metoda, METODY, pogorszenie, powtorzoneCzaty, PROBLEM, sprawdzCzat, type Status, trescZadania, tytulPasuje, type Wynik, wymaganeBoty } from "./telegram.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const REJESTR_IO_KEY = Deno.env.get("REJESTR_IO_KEY") ?? "";
const BIURO_NIP = Deno.env.get("BIURO_NIP") ?? "7831916366";
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CRON_KEY = Deno.env.get("CRON_KEY") ?? "";
const MODEL = "claude-opus-4-8";
const BUCKET = "klienci-umowy";
const MAX_BYTES = 24 * 1024 * 1024;
const SYNC_MIN = 30;       // klienci_baza is checked against the list at most this often (a save updates it at once)
const TG_ODSTEP_MS = 150;  // pause between Bot API calls: well under Telegram's limits
const TG_NA_RAZ = 40;      // groups checked in one call
const TG_BUDZET_MS = 90000;
const TG_USTAWIENIA = "klienci_telegram"; // key in portal_ustawienia: { boty, przebieg: { start, koniec } }
const MAX_NA_RAZ = 5;      // firms read from the register in one call of rejestr_wszystkie
const DNI_DOMYSLNIE = 30;  // a snapshot younger than this is not read again
const MAX_REJESTR_DZIEN = 300;  // paid register requests a day, everybody together (table klienci_limity)
const MAX_ODCZYT_DZIEN = 150;   // contract readings a day per user

// the provider itself refused (inactive key, limit, outage): asking about the next firm would fail the same way
class Dostawca extends Error {}
async function limit(klucz: string, max: number, ile = 1): Promise<boolean> {
  const r = await db("rpc/klienci_limit", { method: "POST", body: JSON.stringify({ p_klucz: klucz, p_max: max, p_ile: ile }) });
  return r.ok && (await r.json()) === true; // no counter, no paid call
}

// deno-lint-ignore no-explicit-any
type Any = any;

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
type Ja = { email: string; admin: boolean; kadry: boolean };
async function portal(req: Request): Promise<Ja | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (m.portal !== true || !u.email) return null;
  const admin = m.portal_admin === true;
  return { email: String(u.email), admin, kadry: admin || !Array.isArray(m.portal_sections) || m.portal_sections.includes("kadry") };
}
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const okId = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && (/^\d{10}$/.test(v) || /^nazwa:.+/.test(v));
const REJ_KOL = "id,klient,nip,fetched_at,sprawdzono_at,zrodlo,znaleziono,krs,regon,nazwa,forma,data_rejestracji,kapital,adres,organ,reprezentacja,zarzad,wspolnicy,prokurenci,pkd,stan,zmiany,odcisk";

// ---------------------------------------------------------------- klienci_baza follows the list (portal_klienci)
// the clients as stored: [{ id, dane }]
const listaKlientow = () => all("portal_klienci?select=id,dane&order=id");
async function sync(force: boolean): Promise<{ zsynchronizowano: boolean; blad?: string }> {
  if (!force) {
    const r = await db("klienci_baza?select=arkusz_at&arkusz_at=not.is.null&order=arkusz_at.desc&limit=1");
    const last = r.ok ? (await r.json())[0]?.arkusz_at : null;
    if (last && Date.now() - Date.parse(last) < SYNC_MIN * 60000) return { zsynchronizowano: false };
  }
  try {
    const list = await listaKlientow();
    if (list.length < 3) throw new Error("podejrzanie mało wierszy w bazie klientów"); // never mark everybody as gone on a broken read
    const now = new Date().toISOString(), seen = new Set<string>(), rows: Any[] = [];
    const t = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n) || null;
    for (const { id, dane: k } of list) {
      if (!okId(id) || seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, nip: digits(k.nip) || null, nazwa: t(k.nazwa) ?? digits(k.nip), forma: t(k.forma, 120), opodatkowanie: t(k.opodatkowanie, 200), adres: t(k.adres), miasto: t(k.miasto, 120), opiekun: t(k.opiekun, 120), kadrowy: t(k.kadrowy, 120), w_arkuszu: true, arkusz_at: now, brak_od: null });
    }
    // only the columns sent are overwritten: the service status of a client already known stays as it is
    const up = await db("klienci_baza", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    if (!up.ok) throw new Error("zapis listy: " + up.status);
    // a row that is no longer on the list (removed in the database by hand) is kept and only marked
    for (const k of await all("klienci_baza?select=id&w_arkuszu=is.true")) {
      if (!seen.has(k.id)) await db(`klienci_baza?id=eq.${enc(k.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ w_arkuszu: false, brak_od: now }) });
    }
    return { zsynchronizowano: true };
  } catch (e) {
    console.error("klienci-baza sync", String((e as Error)?.message ?? e));
    return { zsynchronizowano: false, blad: "Nie udało się sprawdzić listy klientów — pokazuję ostatni zapisany stan." };
  }
}

// ---------------------------------------------------------------- editing a client
// how many rows other modules keep under a NIP (they are not moved when a client's NIP changes)
async function inneModuly(nip: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const gdzie: Array<[string, string]> = [["zamknięcia miesiąca", `ksieg_zamkniecia?nip=eq.${nip}`], ["akta osobowe", `akta_dokumenty?nip=eq.${nip}`], ["konto klienta", `klient_konta?nip=eq.${nip}`],
    ["pakiety do podpisu", `podpisy_pakiety?nip=eq.${nip}`], ["sprawdzenia VAT", `vat_sprawdzenia?nip=eq.${nip}`], ["poczta", `poczta_wiadomosci?klient_nip=eq.${nip}`], ["wysłane przypomnienia", `portal_powiadomienia?nip=eq.${nip}`],
    ["szablony umów", `umowa_szablony?nip=eq.${nip}`], ["pracownicy (zgłoszenia)", `zatrudnienie_zgloszenia?payload->>z_nip=eq.${nip}`]];
  await Promise.all(gdzie.map(async ([nazwa, sciezka]) => {
    try {
      const r = await db(sciezka + "&select=*&limit=1", { method: "HEAD", headers: { Prefer: "count=exact" } });
      const n = Number((r.headers.get("content-range") ?? "").split("/")[1]);
      if (r.ok && n > 0) out[nazwa] = n;
    } catch { /* a module that is not there has nothing under the NIP */ }
  }));
  return out;
}

// ---------------------------------------------------------------- Telegram audit (read only)
let tgOstatnie = 0;
// The only door to the Bot API: five read methods, a pause between calls, never the token in a log.
async function tg(metoda: Metoda, params: Record<string, string> = {}): Promise<Any> {
  if (!METODY.includes(metoda)) throw new Error("metoda niedozwolona");
  const czekaj = tgOstatnie + TG_ODSTEP_MS - Date.now();
  if (czekaj > 0) await new Promise((ok) => setTimeout(ok, czekaj));
  tgOstatnie = Date.now();
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${metoda}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(10000) });
    return await r.json().catch(() => ({ ok: false, error_code: r.status, description: "HTTP " + r.status }));
  } catch { return { ok: false, error_code: 0, description: "brak połączenia z Telegramem" }; } // the error text would carry the URL with the token
}
const botId = () => (/^(\d{5,15}):/.exec(TG_TOKEN)?.[1] ?? ""); // a bot's id is the part of its token before the colon
async function tgUstawienia(): Promise<Any> {
  const r = await db(`portal_ustawienia?key=eq.${TG_USTAWIENIA}&select=value`);
  return (r.ok ? (await r.json())[0]?.value : null) ?? {};
}
async function tgZapiszUstawienia(v: Any) {
  await db("portal_ustawienia", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: TG_USTAWIENIA, value: v, updated_at: new Date().toISOString() }) });
}
// stores one result; a status change goes to the history. Trouble reaching Telegram ('blad') does not
// replace what was known about the group — only the time and the error text are noted.
async function tgZapisz(klient: string, w: Wynik, prev: Any | null): Promise<{ bylo: string | null; jest: Status } | null> {
  const now = new Date().toISOString();
  if (w.status === "blad" && prev && prev.status !== "blad" && prev.chat_id === w.chat_id) {
    await db(`klienci_telegram?klient=eq.${enc(klient)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sprawdzono_at: now, blad: w.blad }) });
    return null;
  }
  const zmiana = !prev || prev.status !== w.status;
  const row = { klient, chat_id: w.chat_id, status: w.status, od: zmiana ? now : prev.od, sprawdzono_at: now, tytul: w.tytul, typ: w.typ, czlonkow: w.czlonkow, bot_status: w.bot_status, boty: w.boty, brak_botow: w.brak_botow, nowe_id: w.nowe_id, blad: w.blad, uwagi: w.uwagi };
  const up = await db("klienci_telegram", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
  if (!up.ok) throw new Error("zapis wyniku Telegram: " + up.status);
  if (!zmiana) return null;
  await db("klienci_telegram_historia", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ klient, bylo: prev?.status ?? null, jest: w.status, opis: w.blad }) });
  return { bylo: prev?.status ?? null, jest: w.status };
}
// Checks the clients in service whose result is older than `od` (or all the ids given), a batch per call.
// Resumable: what was checked is stored at once; a rate limit or the cap simply ends the batch.
async function tgPartia(od: string, tylko: string | null): Promise<{ sprawdzono: number; pozostalo: number; limit?: number; blad?: string }> {
  const bot = botId();
  if (!bot) return { sprawdzono: 0, pozostalo: 0, blad: "Brak konfiguracji bota Telegram (TELEGRAM_BOT_TOKEN)." };
  const [baza, pk, wyniki, ust] = await Promise.all([all("klienci_baza?select=id,status"), listaKlientow(), all("klienci_telegram?select=*"), tgUstawienia()]);
  const wSluzbie = new Set(baza.filter((k) => k.status !== "zakonczony").map((k) => k.id));
  const prev = new Map<string, Any>(wyniki.map((w) => [w.klient, w]));
  const wymagane = wymaganeBoty(ust.boty);
  const kolejka = pk.filter((k) => wSluzbie.has(k.id) && (tylko ? k.id === tylko : !prev.has(k.id) || prev.get(k.id).sprawdzono_at < od));
  const start = Date.now();
  let sprawdzono = 0, zApi = 0;
  for (const k of kolejka) {
    const chat = String(k.dane?.telegram ?? "").trim();
    // a client without a chat id costs no request and is not counted against the cap
    if (chat && (zApi >= TG_NA_RAZ || Date.now() - start > TG_BUDZET_MS)) break;
    try {
      const w = await sprawdzCzat(tg, chat, bot, wymagane);
      if (chat) zApi++;
      await tgZapisz(k.id, w, prev.get(k.id) ?? null);
      sprawdzono++;
    } catch (e) {
      if (e instanceof Limit) return { sprawdzono, pozostalo: kolejka.length - sprawdzono, limit: e.sekund };
      throw e;
    }
  }
  return { sprawdzono, pozostalo: kolejka.length - sprawdzono };
}
// the daily run: a batch per call; when the run is complete, one task about what got worse
async function tgCron(): Promise<Any> {
  const ust = await tgUstawienia();
  let p = ust.przebieg ?? null;
  if (p?.koniec && Date.now() - Date.parse(p.koniec) < 20 * 3600000) return { nic: true, ostatni: p.koniec };
  if (!p || p.koniec) { p = { start: new Date().toISOString() }; await tgZapiszUstawienia({ ...ust, przebieg: p }); }
  const r = await tgPartia(p.start, null);
  if (r.blad || r.limit || r.pozostalo > 0) return { ...r, start: p.start };
  // complete: what changed for the worse since the run began (the newest change of each client)
  const hist = await all(`klienci_telegram_historia?select=klient,bylo,jest,created_at&created_at=gte.${enc(p.start)}&order=created_at.desc`);
  const nazwy = new Map<string, string>((await all("klienci_baza?select=id,nazwa,status")).filter((k) => k.status !== "zakonczony").map((k) => [k.id, k.nazwa]));
  const widziani = new Set<string>(), zmiany: Array<{ nazwa: string; bylo: string | null; jest: Status }> = [];
  for (const h of hist) {
    if (widziani.has(h.klient) || !nazwy.has(h.klient)) continue;
    widziani.add(h.klient);
    if (pogorszenie(h.bylo, h.jest)) zmiany.push({ nazwa: nazwy.get(h.klient)!, bylo: h.bylo, jest: h.jest });
  }
  let zadanie = false;
  if (zmiany.length) {
    zmiany.sort((a, b) => a.nazwa.localeCompare(b.nazwa, "pl"));
    const komu = await adminPortalu();
    if (komu) {
      // one task per run, for the administrator; created as a hand-made task of "system" so that the
      // tasks module does not close it as a system task whose reason it does not know
      const t = trescZadania(zmiany);
      const ins = await db("portal_zadania?on_conflict=klucz", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ ...t, created_by: "system", assignee: komu, zrodlo: "reczne", klucz: "tg-audyt:" + p.start.slice(0, 10), termin: new Date().toISOString().slice(0, 10), pilne: false, link: "klienci.html" }) });
      zadanie = ins.ok;
    }
  }
  await tgZapiszUstawienia({ ...(await tgUstawienia()), przebieg: { start: p.start, koniec: new Date().toISOString(), zmian: zmiany.length } });
  return { ...r, start: p.start, zakonczono: true, zmian: zmiany.length, zadanie };
}
// who gets the alert: the first portal administrator
async function adminPortalu(): Promise<string> {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    const j = r.ok ? await r.json() : {};
    const u = (j.users ?? []).filter((x: Any) => x?.app_metadata?.portal === true && x.app_metadata.portal_admin === true && x.email).sort((a: Any, b: Any) => String(a.created_at).localeCompare(String(b.created_at)))[0];
    return u ? String(u.email).toLowerCase() : "";
  } catch { return ""; }
}
function isCron(req: Request) {
  const k = req.headers.get("x-cron-key") ?? "";
  if (!CRON_KEY || k.length !== CRON_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < k.length; i++) diff |= k.charCodeAt(i) ^ CRON_KEY.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- register
const wierszNaWyciag = (r: Any): Wyciag => ({
  znaleziono: r.znaleziono, krs: r.krs, regon: r.regon, nazwa: r.nazwa, forma: r.forma, data_rejestracji: r.data_rejestracji, kapital: r.kapital == null ? null : Number(r.kapital),
  adres: r.adres, organ: r.organ, reprezentacja: r.reprezentacja, zarzad: r.zarzad ?? [], wspolnicy: r.wspolnicy ?? [], prokurenci: r.prokurenci ?? [], pkd: r.pkd, stan: r.stan,
});
// Reads the register for one client and stores the result: a new snapshot when something changed,
// otherwise only the date of the check. `dni`: our own cache of rejestr.io younger than this is reused.
// tryb.masowo: the bulk run (MF's smaller share of the day); tryb.ulepszenie: a recent MF-only snapshot is
// to be replaced from a fuller source — MF itself is not asked, and a refusal leaves the snapshot as it is.
type Tryb = { masowo?: boolean; ulepszenie?: boolean };
type Odswiezone = { ok: boolean; zmiany: number; zrodlo?: string; podstawowe?: boolean; blad?: string; dostawca?: boolean; jutro?: boolean };
async function odswiez(k: Any, fresh: boolean, dni: number, tryb: Tryb = {}): Promise<Odswiezone> {
  const nip = digits(k.nip), now = new Date().toISOString();
  const koniec = async (blad: string | null) => { await db(`klienci_baza?id=eq.${enc(k.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ rejestr_at: now, rejestr_blad: blad }) }); };
  // the attempt is noted, the client is not marked as failed (what is stored about it still holds)
  const proba = async () => { await db(`klienci_baza?id=eq.${enc(k.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ rejestr_at: now }) }); };
  try {
    if (!nipOk(nip)) throw new Error("brak poprawnego NIP");
    let zrodlo: "krs" | "gus" | "ceidg" | "mf" = formaTyp(k.forma) === "krs" ? "krs" : "gus";
    let w: Wyciag, dane: Any, surowe: Any = null, podstawowe = false;
    // counted before asking: up to 3 requests for a KRS firm, 1 for a sole trader
    if (!(await limit("rejestr", MAX_REJESTR_DZIEN, zrodlo === "krs" ? 3 : 1))) return { ok: false, zmiany: 0, dostawca: true, blad: "Dzienny limit zapytań do rejestrów (" + MAX_REJESTR_DZIEN + ") jest wyczerpany — dokończ jutro." };
    const p = await db(`klienci_rejestr?klient=eq.${enc(k.id)}&select=${REJ_KOL}&order=fetched_at.desc&limit=1`);
    const prev = p.ok ? (await p.json())[0] : null;
    if (zrodlo === "krs") {
      if (!firmaConfigured()) throw new Dostawca("rejestr.io: brak konfiguracji");
      let f = await getFirma(nip, false);
      if (f.z_pamieci && (fresh || Date.now() - Date.parse(f.pobrano) > dni * 86400000)) f = await getFirma(nip, true);
      if (f.found === false) zrodlo = "gus"; // the sheet says "spółka", KRS does not know the NIP: look among the sole traders
      else {
        // rejestr.io's own basic record (dates of entries, main activity, struck off or not) — one more paid request
        const r = REJESTR_IO_KEY ? await fetch(`https://rejestr.io/api/v2/org/${digits(f.krs) || "nip" + nip}`, { headers: { Authorization: REJESTR_IO_KEY } }) : null;
        surowe = r?.ok ? await r.json() : null;
        dane = f; w = wyciagKrs(f, surowe);
      }
    }
    if (zrodlo !== "krs") {
      // what CEIDG / GUS once said is never overwritten with MF's basic record: then only they are asked
      const pelnePrev = !!prev && prev.znaleziono === true && (prev.zrodlo === "ceidg" || prev.zrodlo === "gus");
      let j;
      try {
        j = await pobierzJdg(nip, { bezMf: tryb.ulepszenie === true || pelnePrev, mfWolno: () => limit(MF_KLUCZ, tryb.masowo ? MF_DZIENNIE : MF_DZIENNIE_POJEDYNCZE) });
      } catch (e) {
        if (!(e instanceof BladJdg)) throw e;
        const czemu = e.proby.filter((x) => x.wynik.startsWith("błąd")).map((x) => x.zrodlo === "ceidg" ? "CEIDG: " + x.wynik.slice(6) : "GUS (DataPort): " + x.wynik.slice(6)).join("; ").slice(0, 160);
        // MF's share of the day is used up: nothing is wrong with the firm and nothing is broken
        if (e.limit) return { ok: false, zmiany: 0, dostawca: true, jutro: true, blad: "Dzienny limit zapytań do Wykazu VAT (MF) — " + (tryb.masowo ? MF_DZIENNIE : MF_DZIENNIE_POJEDYNCZE) + " — jest wyczerpany; dokończ jutro." + (czemu ? " Pełniejsze źródło nie odpowiedziało (" + czemu + ")." : "") };
        if (tryb.ulepszenie) { await proba(); return { ok: false, zmiany: 0, dostawca: true, blad: "Pełniejsze źródło danych nie odpowiada (" + (czemu || e.message) + ") — zostają dane podstawowe z Wykazu VAT." }; }
        throw new Dostawca(e.message);
      }
      // the fuller source does not know the firm MF knows (not a sole trader after all): the MF record stays
      if (tryb.ulepszenie && !j.znaleziono) { await proba(); return { ok: true, zmiany: 0, zrodlo: "mf", podstawowe: true }; }
      zrodlo = j.zrodlo; podstawowe = j.podstawowe; dane = { ...doZapisu(j), proby: j.proby }; w = wyciagJdg(j); surowe = null;
    }
    // two sources name a firm differently (MF: the person, CEIDG: the firm): only the same source is compared
    const zm = prev && prev.zrodlo === zrodlo ? roznice(wierszNaWyciag(prev), w!) : [];
    // kept without birth dates / PESEL numbers
    const kolumny = { ...w!, nip, zrodlo, odcisk: odcisk(w!), dane: bezDanychOsobowych(dane), surowe: bezDanychOsobowych(surowe), sprawdzono_at: now };
    // the same state as last time (or only fields we did not read before): confirm the existing snapshot
    const zapis = prev && !zm.length && prev.zrodlo === zrodlo
      ? await db(`klienci_rejestr?id=eq.${prev.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(kolumny) })
      : await db("klienci_rejestr", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...kolumny, klient: k.id, fetched_at: now, zmiany: zm }) });
    if (!zapis.ok) throw new Error("zapis danych rejestru: " + zapis.status);
    await koniec(null);
    return { ok: true, zmiany: zm.length, zrodlo, podstawowe: podstawowe || undefined };
  } catch (e) {
    const blad = String((e as Error)?.message ?? e).slice(0, 200);
    // rejestr.io answering 4xx / 5xx (a missing firm is not an error there) is the provider failing too
    const dostawca = e instanceof Dostawca || /rejestr\.io( odpis)? HTTP [45]\d\d/.test(blad);
    console.error("klienci-baza rejestr", dostawca ? "dostawca" : "", blad);
    await koniec(blad);
    return { ok: false, zmiany: 0, blad, dostawca };
  }
}

// ---------------------------------------------------------------- contracts: reading a scan
const RODZAJE = ["ksiegowosc", "kadry", "powierzenie", "aneks", "pelnomocnictwo", "upowaznienie", "wypowiedzenie", "inne"];
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["analiza", "rodzaj", "podtyp", "obejmuje", "klient", "data_zawarcia", "obowiazuje_od", "obowiazuje_do", "bezterminowa", "okres_wypowiedzenia", "zakres", "wynagrodzenie", "podpisy", "stron", "pewnosc", "uwagi"],
  properties: {
    analiza: { type: "string", description: "Krótko: co to za dokument, kto jest stronami i po czym to rozpoznano." },
    rodzaj: { type: "string", enum: RODZAJE },
    podtyp: { type: "string", description: "Dla pełnomocnictwa / upoważnienia: np. UPL-1, UPL-1P, PPS-1, ZUS PEL, KSeF (ZAW-FA), e-Urząd Skarbowy, ogólne. W innych przypadkach pusty." },
    obejmuje: { type: "array", items: { type: "string", enum: ["ksiegowosc", "kadry", "powierzenie"] }, description: "Co faktycznie obejmuje treść dokumentu (umowa może obejmować kilka rzeczy naraz)." },
    klient: {
      type: "object", additionalProperties: false, required: ["nazwa", "nip", "krs", "reprezentanci"],
      properties: {
        nazwa: { type: "string" }, nip: { type: "string" }, krs: { type: "string" },
        reprezentanci: { type: "array", items: { type: "object", additionalProperties: false, required: ["imie_nazwisko", "funkcja"], properties: { imie_nazwisko: { type: "string" }, funkcja: { type: "string" } } } },
      },
    },
    data_zawarcia: { type: "string", description: "RRRR-MM-DD albo pusty" },
    obowiazuje_od: { type: "string", description: "RRRR-MM-DD albo pusty" },
    obowiazuje_do: { type: "string", description: "RRRR-MM-DD albo pusty (pusty także przy umowie na czas nieokreślony)" },
    bezterminowa: { type: "boolean" },
    okres_wypowiedzenia: { type: "string" },
    zakres: { type: "string", description: "Zakres usług w 1–3 zdaniach." },
    wynagrodzenie: { type: "string", description: "Wynagrodzenie dokładnie tak, jak zapisano (kwota, okres), albo pusty." },
    podpisy: { type: "string", enum: ["obie_strony", "tylko_klient", "tylko_biuro", "brak", "nieczytelne"] },
    stron: { type: "integer" },
    pewnosc: { type: "string", enum: ["wysoka", "srednia", "niska"] },
    uwagi: { type: "string", description: "Wątpliwości: nieczytelne fragmenty, brak stron, kilka dokumentów w jednym pliku, brak podpisu. Pusty, gdy brak." },
  },
};
const PROMPT = `To skan dokumentu z teczki klienta biura rachunkowego w Polsce. Biuro (zleceniobiorca / przyjmujący zlecenie / podmiot przetwarzający / pełnomocnik) ma NIP ${BIURO_NIP}. „Klient” to DRUGA strona dokumentu — zleceniodawca, administrator danych albo mocodawca — nigdy biuro.

Ustal:
1) rodzaj dokumentu:
   ksiegowosc — umowa o prowadzenie ksiąg rachunkowych / podatkowych, o świadczenie usług księgowych (także gdy obejmuje również kadry);
   kadry — umowa wyłącznie o obsługę kadrowo-płacową;
   powierzenie — odrębna umowa powierzenia przetwarzania danych osobowych (art. 28 RODO);
   aneks — aneks do umowy; pelnomocnictwo — UPL-1, UPL-1P, PPS-1, ZUS PEL, pełnomocnictwo ogólne lub szczególne;
   upowaznienie — upoważnienie / zgłoszenie uprawnień do e-Urzędu Skarbowego lub KSeF (np. ZAW-FA); wypowiedzenie — wypowiedzenie albo porozumienie o rozwiązaniu umowy; inne — wszystko inne.
2) „obejmuje”: zaznacz ksiegowosc, kadry, powierzenie — zgodnie z treścią. „powierzenie” zaznacz także wtedy, gdy umowa o usługi zawiera postanowienia o powierzeniu przetwarzania danych osobowych (paragraf lub załącznik), a nie tylko ogólną klauzulę informacyjną.
3) klienta: nazwę (firmę) dokładnie jak w dokumencie, NIP, numer KRS oraz osoby, które podpisały lub zostały wskazane jako reprezentujące klienta, z funkcją (np. prezes zarządu, prokurent, właściciel, pełnomocnik).
4) datę zawarcia (dla wypowiedzenia — datę pisma), od kiedy i do kiedy dokument obowiązuje (dla wypowiedzenia „obowiazuje_do” = dzień, w którym umowa się rozwiązuje), czy jest na czas nieokreślony, okres wypowiedzenia, zakres usług, wynagrodzenie, liczbę stron skanu.
5) podpisy: czy widać podpisy obu stron (własnoręczne albo informację o podpisie elektronicznym).

Zasady: niczego nie zgaduj. Jeśli czegoś nie widać — zostaw puste. NIP przepisz tylko wtedy, gdy jest czytelny w całości (10 cyfr). Nie wpisuj NIP biura jako NIP klienta. Gdy plik zawiera kilka różnych dokumentów albo nie da się ustalić klienta, napisz to w „uwagi” i ustaw pewność „niska”.`;
const TOO_BIG = "Plik jest za duży do automatycznego odczytu (ponad 24 MB) — zeskanuj w niższej rozdzielczości albo podziel na części.";

async function rozpoznaj(id: string, ja: Ja, force: boolean, origin: string | null): Promise<Response> {
  // a document a person has confirmed keeps its status and notes whatever happens to the new reading
  let potwierdzony = false, poprzedni = "blad";
  const fail = async (msg: string) => {
    await db(`klienci_umowy?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(potwierdzony ? { status: poprzedni } : { status: "blad", uwagi: msg }) });
    return json({ error: msg }, 200, origin);
  };
  try {
    const r = await db(`klienci_umowy?id=eq.${id}&select=*`);
    const row = r.ok ? (await r.json())[0] : null;
    if (!row) return json({ error: "Nie znaleziono dokumentu." }, 404, origin);
    if ((row.sprawdzil || row.status === "przypisany") && !force) return json({ error: "Ten dokument jest już przypisany. Ponowny odczyt trzeba wyraźnie potwierdzić." }, 409, origin);
    if (row.status === "analiza" && Date.now() - Date.parse(row.analiza_at ?? "") < 120000) return json({ error: "Ten dokument jest właśnie odczytywany." }, 200, origin);
    // the path comes from a row the browser inserted: accept only "<row id>/<plain file name>" inside our bucket
    if (typeof row.path !== "string" || !/^[0-9a-f-]{36}\/[A-Za-z0-9_.\-]+$/i.test(row.path) || row.path.includes("..") || !row.path.startsWith(row.id + "/")) return row.sprawdzil ? json({ error: "Nieprawidłowa ścieżka pliku." }, 200, origin) : await fail("Nieprawidłowa ścieżka pliku.");
    if (Number(row.rozmiar) > MAX_BYTES) return row.sprawdzil ? json({ error: TOO_BIG }, 200, origin) : await fail(TOO_BIG);
    if (!(await limit("odczyt:" + ja.email.toLowerCase(), MAX_ODCZYT_DZIEN))) return json({ error: "Dzienny limit odczytów (" + MAX_ODCZYT_DZIEN + ") jest wyczerpany — pozostałe dokumenty przypisz ręcznie albo odczytaj jutro." }, 429, origin);
    // one reading at a time per document (each one is a paid request): the lock is taken by a single
    // conditional update, so two requests arriving together cannot both get it
    const stara = new Date(Date.now() - 120000).toISOString();
    const lock = await db(`klienci_umowy?id=eq.${id}&or=(status.neq.analiza,analiza_at.is.null,analiza_at.lt.${enc(stara)})`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "analiza", analiza_at: new Date().toISOString() }) });
    if (!lock.ok || !(await lock.json()).length) return json({ error: "Ten dokument jest właśnie odczytywany." }, 200, origin);
    potwierdzony = !!row.sprawdzil; poprzedni = row.status;

    const f = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${row.path.split("/").map(enc).join("/")}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    if (!f.ok) return await fail("Nie udało się odczytać pliku z magazynu.");
    if (Number(f.headers.get("content-length") ?? 0) > MAX_BYTES) return await fail(TOO_BIG);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.length > MAX_BYTES) return await fail(TOO_BIG);
    // the type is decided by the file's own first bytes, not by what the browser declared
    const pdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!pdf && !png && !jpg) return await fail("To nie jest plik PDF, JPEG ani PNG.");
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const block = pdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: btoa(bin) } }
      : { type: "image", source: { type: "base64", media_type: png ? "image/png" : "image/jpeg", data: btoa(bin) } };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }], output_config: { format: { type: "json_schema", schema: SCHEMA } } }),
    });
    if (!res.ok) { console.error("model", res.status); return await fail("Odczyt nie powiódł się (" + res.status + ") — spróbuj ponownie albo przypisz ręcznie."); }
    const out = await res.json();
    const text = (out.content ?? []).find((b: Any) => b.type === "text")?.text;
    let a: Any;
    try { a = JSON.parse(text); } catch { return await fail("Odczyt zwrócił nieczytelną odpowiedź — spróbuj ponownie albo przypisz ręcznie."); }
    const kl = a.klient ?? {};
    if (digits(kl.nip) === BIURO_NIP) kl.nip = ""; // the office itself is never the client

    const [klienci, rej] = await Promise.all([all("klienci_baza?select=id,nip,nazwa&order=id"), all("klienci_rejestr?select=klient,krs,nazwa,fetched_at&order=fetched_at.desc")]);
    const ostatni = new Map<string, Any>();
    for (const x of rej) if (!ostatni.has(x.klient)) ostatni.set(x.klient, x);
    const kand = dopasuj(kl, klienci.map((k) => ({ ...k, krs: ostatni.get(k.id)?.krs, rej_nazwa: ostatni.get(k.id)?.nazwa }))).slice(0, 6);
    // the uploader may have said whose contract this is (a client set on a row the machine has never read)
    const wskazany = !row.ai && okId(row.klient) && klienci.some((k) => k.id === row.klient) ? row.klient : null;
    const nipDok = digits(kl.nip);
    const pewny = pewnyKlient(dopasuj(kl, klienci.map((k) => ({ ...k, krs: ostatni.get(k.id)?.krs, rej_nazwa: ostatni.get(k.id)?.nazwa }))), a.pewnosc, wskazany);
    const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n) || null;
    const odczyt: Any = {
      status: pewny ? "przypisany" : "do_sprawdzenia", klient: pewny ?? wskazany,
      rodzaj: RODZAJE.includes(a.rodzaj) ? a.rodzaj : "inne", podtyp: s(a.podtyp, 80),
      obejmuje: [...new Set((Array.isArray(a.obejmuje) ? a.obejmuje : []).filter((x: Any) => ["ksiegowosc", "kadry", "powierzenie"].includes(x)))],
      data_zawarcia: isDate(a.data_zawarcia) ? a.data_zawarcia : null, kontrahent: s(kl.nazwa, 300), kontrahent_nip: nipDok.length === 10 ? nipDok : null, kontrahent_krs: digits(kl.krs).slice(0, 10) || null,
      reprezentanci: (Array.isArray(kl.reprezentanci) ? kl.reprezentanci : []).slice(0, 10).map((p: Any) => ({ imie_nazwisko: String(p.imie_nazwisko ?? "").slice(0, 120), funkcja: String(p.funkcja ?? "").slice(0, 120) })).filter((p: Any) => p.imie_nazwisko),
      obowiazuje_od: isDate(a.obowiazuje_od) ? a.obowiazuje_od : null, obowiazuje_do: isDate(a.obowiazuje_do) ? a.obowiazuje_do : null, bezterminowa: a.bezterminowa === true,
      wypowiedzenie: s(a.okres_wypowiedzenia, 300), zakres: s(a.zakres, 1000), wynagrodzenie: s(a.wynagrodzenie, 300),
      podpisy: ["obie_strony", "tylko_klient", "tylko_biuro", "brak", "nieczytelne"].includes(a.podpisy) ? a.podpisy : null, stron: Number(a.stron) > 0 ? Math.min(Number(a.stron), 5000) : null,
      uwagi: s(a.uwagi, 600),
    };
    const ai: Any = { pewnosc: a.pewnosc, analiza: String(a.analiza ?? "").slice(0, 600), klient: { nazwa: s(kl.nazwa, 300), nip: nipDok || null, krs: digits(kl.krs) || null }, kandydaci: kand, kiedy: new Date().toISOString(), kto: ja.email };
    // confirmed by a person: nothing they set is touched — the new reading is kept beside it, in `ai`
    const { status: _s, klient: _k, ...pola } = odczyt;
    const patch: Any = potwierdzony ? { status: poprzedni, ai: { ...ai, odczyt: pola } } : { ...odczyt, ai, sprawdzil: null, sprawdzono_at: null };
    const up = await db(`klienci_umowy?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    if (!up.ok) return await fail("Nie udało się zapisać odczytu (" + up.status + ").");
    return json({ ok: true, status: patch.status, tylko_odczyt: potwierdzony || undefined }, 200, origin);
  } catch (e) {
    console.error("klienci-baza rozpoznaj", String((e as Error)?.message ?? e).slice(0, 200));
    return await fail("Błąd podczas odczytu — spróbuj ponownie.");
  }
}

// ---------------------------------------------------------------- everything the page shows
async function lista(ja: Ja) {
  const s = await sync(false);
  const [klienci, rej, jdgDane, odpisy, pk, tgWyniki] = await Promise.all([
    all("klienci_baza?select=*&order=nazwa"),
    all(`klienci_rejestr?select=${REJ_KOL}&order=fetched_at.desc`),
    all("klienci_rejestr?zrodlo=neq.krs&select=id,dane"), // sole traders: the normalised record (no raw answers are kept for them)
    all("portal_odpisy_cache?select=krs,fetched_at"),
    listaKlientow(),
    all("klienci_telegram?select=*"),
  ]);
  const dane = new Map<string, Any>(pk.map((x) => [x.id, x.dane ?? {}]));
  const jdgBy = new Map<string, Any>(jdgDane.map((x) => [x.id, x.dane ?? {}]));
  // what the page shows of a sole trader beyond the common columns; the address for service — as the address itself
  const jdgOpis = (r: Any) => {
    const j = jdgBy.get(r.id);
    if (!zJdg(r.zrodlo) || !j) return undefined;
    return { wlasciciel: [j.imie, j.nazwisko].filter(Boolean).join(" ") || null, adres_doreczen: ja.kadry ? j.adres_doreczen ?? null : null, data_zawieszenia: j.data_zawieszenia ?? null, data_wznowienia: j.data_wznowienia ?? null,
      data_zakonczenia: j.data_zakonczenia ?? null, data_wykreslenia: j.data_wykreslenia ?? null, pkd: Array.isArray(j.pkd) ? j.pkd.slice(0, 200) : [], status_vat: j.status_vat ?? null, vat_od: j.vat_od ?? null,
      vat_wykreslenie: j.vat_wykreslenie ?? null, podstawowe: j.podstawowe === true || r.zrodlo === "mf", powod: j.powod ?? null };
  };
  const tgBy = new Map<string, Any>(tgWyniki.map((w) => [w.klient, w]));
  const powt = powtorzoneCzaty(klienci.filter((k) => k.status !== "zakonczony").map((k) => ({ nazwa: k.nazwa, telegram: dane.get(k.id)?.telegram })));
  const rejBy = new Map<string, Any[]>();
  for (const r of rej) { const l = rejBy.get(r.klient) ?? []; l.push(r); rejBy.set(r.klient, l); }
  const odpis = new Map<string, string>(odpisy.map((o) => [String(o.krs), String(o.fetched_at)]));
  let umowy: Any[] = [], historia: Any[] = [], zmiany: Any[] = [], ust: Any = {}, aliasy: string[] = [];
  if (ja.admin) {
    [umowy, historia, zmiany, ust] = await Promise.all([all("klienci_umowy?select=*&order=created_at.desc"), all("klienci_status_historia?select=*&order=created_at.desc"), all("klienci_zmiany?select=*&order=created_at.desc"), tgUstawienia()]);
    // short names of the staff (module Zespół), when that table is there and filled
    try { aliasy = (await all("portal_pracownicy?select=aliasy,aktywny")).filter((p) => p.aktywny !== false).flatMap((p) => Array.isArray(p.aliasy) ? p.aliasy : []).map((a) => String(a).trim()).filter(Boolean); } catch { /* no such table yet */ }
  }
  const dzis = new Date().toISOString().slice(0, 10), teraz = Date.now();
  const out = klienci.map((k) => {
    const rs = rejBy.get(k.id) ?? [], r = rs[0] ?? null;
    const jdg = formaTyp(k.forma) !== "krs";
    // not an administrator: a fixed set of columns — no "who changed it", no upstream error texts
    const baza: Any = ja.admin ? k : { id: k.id, nip: k.nip, nazwa: k.nazwa, forma: k.forma, opodatkowanie: k.opodatkowanie, adres: k.adres, miasto: k.miasto, opiekun: k.opiekun, kadrowy: k.kadrowy,
      w_arkuszu: k.w_arkuszu, brak_od: k.brak_od, status: k.status, obsluga_od: k.obsluga_od, koniec_od: k.koniec_od };
    // a sole trader's address is often a home address: Kadry and administrators only (as the contact data)
    if (jdg && !ja.kadry) baza.adres = null;
    const zk = zakres(k);
    const o: Any = {
      // scope of service, from the caretakers in the sheet: does the office do this client's accounting / HR
      ...baza, ksiegowosc: zk.ksiegowosc, kadry: zk.kadry, rej: r ? { ...r, odcisk: undefined, adres: (zJdg(r.zrodlo) || jdg) && !ja.kadry ? null : r.adres, jdg: jdgOpis(r) } : null,
      rej_historia: rs.slice(1, 12).map((x) => ({ fetched_at: x.fetched_at, sprawdzono_at: x.sprawdzono_at, zmiany: x.zmiany, nazwa: x.nazwa })),
      ostrzezenia: ostrzezeniaRejestru(k, r, teraz, ja.admin),
      odpis: r?.krs && odpis.has(String(r.krs).padStart(10, "0")) ? odpis.get(String(r.krs).padStart(10, "0")) : null,
    };
    const d = dane.get(k.id) ?? {};
    if (ja.kadry) o.kontakt = { telefon: d.telefon ?? "", email: d.email ?? "", kontakt: d.kontakt ?? "", jezyk: d.jezyk ?? "", telegram: d.telegram ?? "" };
    // Telegram: everybody sees the status; the group's title, id and bots — administrators only
    if (k.status !== "zakonczony") {
      const chat = String(d.telegram ?? "").trim(), w = tgBy.get(k.id);
      const aktualny = w && String(w.chat_id ?? "") === chat ? w : null; // a result for another chat id says nothing about this one
      const status = aktualny ? aktualny.status : chat ? null : "brak_grupy";
      o.tg = { status, opis: status ? PROBLEM[status as Status] : "nie sprawdzono" };
      if (ja.admin) {
        const uwagi: string[] = [...(aktualny?.uwagi ?? [])];
        if (chat && powt.has(chat)) uwagi.push("To samo id czatu mają: " + powt.get(chat)!.join(", ") + ".");
        if (aktualny?.tytul && !tytulPasuje(aktualny.tytul, k.nazwa)) uwagi.push("Nazwa grupy nie przypomina nazwy klienta — sprawdź, czy to właściwa grupa.");
        Object.assign(o.tg, aktualny ? { od: aktualny.od, sprawdzono_at: aktualny.sprawdzono_at, tytul: aktualny.tytul, typ: aktualny.typ, czlonkow: aktualny.czlonkow, bot_status: aktualny.bot_status, boty: aktualny.boty, brak_botow: aktualny.brak_botow, nowe_id: aktualny.nowe_id, blad: aktualny.blad } : {}, { chat_id: chat, uwagi });
      }
    }
    if (ja.admin) {
      o.audyt = audytKlienta(k, rs, umowy.filter((u) => u.klient === k.id && u.status === "przypisany"), dzis);
      o.historia = historia.filter((h) => h.klient === k.id);
      o.zmiany = zmiany.filter((h) => h.klient === k.id).slice(0, 30);
      o.dane = Object.fromEntries(POLA_KLIENTA.map(([p]) => [p, String(d[p] ?? "")])); // the row as stored, for the edit form
    }
    return o;
  });
  let admin: Any;
  if (ja.admin) {
    const uniq = (pole: string) => [...new Set(klienci.map((k) => String(k[pole] ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pl"));
    // bots seen among the administrators of the groups, with the number of groups: candidates for "required"
    const widziane = new Map<string, Any>();
    for (const w of tgWyniki) for (const b of Array.isArray(w.boty) ? w.boty : []) { const x = widziane.get(b.id) ?? { ...b, grup: 0 }; x.grup++; widziane.set(b.id, x); }
    admin = {
      podpowiedzi: { opiekun: aliasy.length ? [...new Set(aliasy)].sort((a, b) => a.localeCompare(b, "pl")) : uniq("opiekun"), kadrowy: aliasy.length ? [...new Set(aliasy)].sort((a, b) => a.localeCompare(b, "pl")) : uniq("kadrowy"), opodatkowanie: uniq("opodatkowanie"), formy: FORMY_LISTA, jezyki: JEZYKI_LISTA, z_zespolu: aliasy.length > 0 },
      jdg: zrodlaJdg(), // which fuller sources for sole traders are connected (MF needs no key)
      telegram: { skonfigurowany: !!botId(), bot_id: botId(), boty: wymaganeBoty(ust.boty), widziane: [...widziane.values()].sort((a, b) => b.grup - a.grup).slice(0, 30), przebieg: ust.przebieg ?? null },
    };
  }
  return { ja: { email: ja.email, admin: ja.admin, kontakty: ja.kadry }, klienci: out, umowy: ja.admin ? umowy : undefined, admin, cena: CENA_REJESTR_IO, dni: DNI_DOMYSLNIE, sync: s };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  let body: Any, zly = false;
  try { body = await req.json(); } catch { zly = true; }
  // the scheduler: its own key instead of a portal session, and one action only
  if (isCron(req)) {
    if (body?.action !== "telegram_cron") return json({ error: "Nieznana akcja." }, 400, origin);
    try { return json(await tgCron(), 200, origin); }
    catch (e) { console.error("klienci-baza telegram_cron", String((e as Error)?.message ?? e).slice(0, 200)); return json({ error: "Błąd kontroli Telegram." }, 500, origin); }
  }
  const ja = await portal(req);
  if (!ja) return json({ error: "Brak dostępu (portal)." }, 403, origin);
  if (zly) return json({ error: "Nieprawidłowy JSON." }, 400, origin);
  const action = String(body?.action ?? "");
  const tylkoAdmin = () => json({ error: "Tę czynność może wykonać tylko administrator portalu." }, 403, origin);

  try {
    if (action === "lista") return json(await lista(ja), 200, origin);
    if (action === "sync") { if (!ja.admin) return tylkoAdmin(); return json(await sync(true), 200, origin); }

    if (action === "rejestr") {
      if (!ja.admin) return tylkoAdmin();
      if (!okId(body.id)) return json({ error: "Nieprawidłowy identyfikator klienta." }, 400, origin);
      const k = (await all(`klienci_baza?id=eq.${enc(body.id)}&select=*`))[0];
      if (!k) return json({ error: "Nie ma takiego klienta." }, 404, origin);
      // every reading is paid: once a day per client; after a failed attempt — again after 10 minutes
      const wiek = k.rejestr_at ? Date.now() - Date.parse(k.rejestr_at) : Infinity;
      if (wiek < (k.rejestr_blad ? 600000 : 86400000)) return json({ error: k.rejestr_blad ? "Poprzednia próba nie powiodła się przed chwilą — spróbuj za kilka minut." : "Dane tego klienta były już dziś pobierane z rejestru — ponowne pobranie będzie możliwe jutro." }, 429, origin);
      // fresh: false takes what our own base of firms already holds, whatever its age (no paid request for the KRS chapter)
      return json(await odswiez(k, body.fresh !== false, body.fresh === false ? 36500 : 0), 200, origin);
    }

    if (action === "rejestr_wszystkie") {
      if (!ja.admin) return tylkoAdmin();
      const dni = Math.max(1, Math.min(365, Math.round(Number(body.dni) || DNI_DOMYSLNIE)));
      const [klienci, rej, cache] = await Promise.all([all("klienci_baza?select=*&order=nazwa"), all("klienci_rejestr?select=klient,sprawdzono_at,zrodlo&order=sprawdzono_at.desc"), all("portal_firmy_cache?select=nip,fetched_at")]);
      const ost = new Map<string, Any>();
      for (const r of rej) if (!ost.has(r.klient)) ost.set(r.klient, r);
      const zr = zrodlaJdg();
      const plan = planOdswiezenia(klienci.map((k) => ({ ...k, rej_at: ost.get(k.id)?.sprawdzono_at ?? null, rej_zrodlo: ost.get(k.id)?.zrodlo ?? null })), Object.fromEntries(cache.map((c) => [c.nip, c.fetched_at])), dni, Date.now(), body.z_zakonczonymi === true, zr.ceidg || zr.gus);
      // MF's share of the day already used (the counter's day is the database's)
      let mfDzis = 0;
      try { mfDzis = Number((await all(`klienci_limity?dzien=eq.${new Date().toISOString().slice(0, 10)}&klucz=eq.${MF_KLUCZ}&select=n`))[0]?.n) || 0; } catch { /* unknown: the counter itself still guards every request */ }
      const nowych = plan.gus_firm - plan.ulepszen;
      const podsumowanie = { firm: plan.pozycje.length, krs_firm: plan.krs_firm, gus_firm: plan.gus_firm, zapytan_rejestr_io: plan.zapytan_rejestr_io, zapytan_gus: plan.zapytan_gus, koszt_zl: plan.koszt_zl, cena: CENA_REJESTR_IO, pominiete: plan.pominiete, dni, na_raz: MAX_NA_RAZ,
        // sole traders: the sources connected; with MF alone — how many a day and for how many days
        jdg: { ...zr, tylko_mf: !zr.ceidg && !zr.gus, ulepszen: plan.ulepszen, mf_limit: MF_DZIENNIE, mf_zostalo_dzis: Math.max(0, MF_DZIENNIE - mfDzis), mf_dni: Math.ceil(nowych / MF_DZIENNIE) } };
      if (body.dry !== false) return json({ dry: true, ...podsumowanie }, 200, origin);
      const byId = new Map(klienci.map((k) => [k.id, k]));
      const zrobione: Any[] = [];
      let przerwano = "", jutro = false;
      for (const p of plan.pozycje.slice(0, MAX_NA_RAZ)) {
        const w = await odswiez(byId.get(p.id), false, dni, { masowo: true, ulepszenie: p.ulepszenie === true });
        zrobione.push({ id: p.id, nazwa: p.nazwa, ...w });
        // the provider refused: the next firms would only repeat the error (and, with rejestr.io, the bill)
        if (w.dostawca) { przerwano = w.blad ?? "błąd dostawcy danych"; jutro = w.jutro === true; break; }
      }
      return json({ dry: false, zrobione, przerwano: przerwano || undefined, jutro: jutro || undefined, pozostalo: Math.max(0, plan.pozycje.length - zrobione.filter((z) => z.ok).length), ...podsumowanie }, 200, origin);
    }

    if (action === "status") {
      if (!ja.admin) return tylkoAdmin();
      if (!okId(body.id)) return json({ error: "Nieprawidłowy identyfikator klienta." }, 400, origin);
      if (!["obslugiwany", "wstrzymany", "zakonczony"].includes(body.status)) return json({ error: "Nieznany status." }, 400, origin);
      const data = (v: unknown) => (v == null || v === "" ? null : isDate(v) && v >= "1990-01-01" && v <= "2100-12-31" ? v : undefined);
      const koniec = data(body.koniec_od), od = data(body.obsluga_od);
      if (koniec === undefined || od === undefined) return json({ error: "Nieprawidłowa data." }, 400, origin);
      if (body.status === "zakonczony" && !koniec) return json({ error: "Podaj dzień, od którego obsługa jest zakończona." }, 400, origin);
      if (body.status === "zakonczony" && od && koniec! < od) return json({ error: "Koniec obsługi nie może być wcześniejszy niż jej początek." }, 400, origin);
      const r = await db("rpc/klienci_ustaw_status", { method: "POST", body: JSON.stringify({ p_id: body.id, p_status: body.status, p_obsluga_od: od, p_koniec_od: koniec, p_powod: String(body.powod ?? "").trim().slice(0, 1000), p_kto: ja.email }) });
      if (!r.ok) { const t = await r.text(); return json({ error: t.includes("nie ma takiego klienta") ? "Nie ma takiego klienta." : "Nie udało się zapisać statusu." }, t.includes("nie ma takiego") ? 404 : 500, origin); }
      return json({ ok: true, klient: await r.json() }, 200, origin);
    }

    if (action === "rozpoznaj") {
      if (!ja.admin) return tylkoAdmin();
      if (!ANTHROPIC_KEY) return json({ error: "Brak konfiguracji odczytu dokumentów." }, 500, origin);
      if (!UUID.test(body.id ?? "")) return json({ error: "Nieprawidłowy identyfikator dokumentu." }, 400, origin);
      return await rozpoznaj(body.id, ja, body.force === true, origin);
    }

    if (action === "usun_umowe") {
      if (!ja.admin) return tylkoAdmin();
      if (!UUID.test(body.id ?? "")) return json({ error: "Nieprawidłowy identyfikator dokumentu." }, 400, origin);
      const row = (await all(`klienci_umowy?id=eq.${body.id}&select=*`))[0];
      if (!row) return json({ error: "Nie znaleziono dokumentu." }, 404, origin);
      const okPath = typeof row.path === "string" && /^[0-9a-f-]{36}\/[A-Za-z0-9_.\-]+$/i.test(row.path) && !row.path.includes("..") && row.path.startsWith(row.id + "/");
      let sha: string | null = null;
      if (okPath) {
        const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${row.path.split("/").map(enc).join("/")}`, auth = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
        const f = await fetch(url, { headers: auth });
        if (f.ok) {
          const h = new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()));
          sha = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
          // the file first: if it cannot be removed, nothing changes and the row still points at it
          const d = await fetch(url, { method: "DELETE", headers: auth });
          if (!d.ok && d.status !== 404) { await d.body?.cancel(); return json({ error: "Nie udało się usunąć pliku — dokument pozostał w bazie." }, 502, origin); }
          await d.body?.cancel();
        } else { await f.body?.cancel(); if (f.status !== 404 && f.status !== 400) return json({ error: "Nie udało się odczytać pliku — dokument pozostał w bazie." }, 502, origin); }
      }
      const log = await db("klienci_umowy_usuniete", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ usunal: ja.email, umowa_id: row.id, klient: row.klient, nazwa: row.nazwa, path: row.path, rozmiar: row.rozmiar, sha256: sha, rodzaj: row.rodzaj, data_zawarcia: row.data_zawarcia, uploaded_by: row.uploaded_by, wgrano_at: row.created_at }) });
      const del = await db(`klienci_umowy?id=eq.${row.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      console.log("klienci-baza usun_umowe", row.id, "plik:", sha ? "usunięty" : "brak", "wpis:", log.ok, "wiersz:", del.ok);
      if (!del.ok) return json({ error: "Plik usunięto, ale nie udało się usunąć wpisu — spróbuj ponownie." }, 500, origin);
      return json({ ok: true, zapisano_w_rejestrze: log.ok }, 200, origin);
    }

    if (action === "braki_csv") {
      if (!ja.admin) return tylkoAdmin();
      const l = await lista(ja);
      return json({ csv: csvBraki(l.klienci.filter((k: Any) => k.status !== "zakonczony").map((k: Any) => ({ k, a: k.audyt, tg: k.tg?.opis ?? "" }))) }, 200, origin);
    }

    if (action === "klient_zapisz") {
      if (!ja.admin) return tylkoAdmin();
      const id = body.id == null || body.id === "" ? null : body.id;
      if (id !== null && !okId(id)) return json({ error: "Nieprawidłowy identyfikator klienta." }, 400, origin);
      const { dane, bledy } = walidujKlienta(body.dane);
      if (bledy.length) return json({ error: bledy.join(" "), bledy }, 400, origin);
      const noweId = klientId(dane);
      if (!okId(noweId)) return json({ error: "Nieprawidłowa nazwa klienta." }, 400, origin);
      let stare: Any = null;
      if (id !== null) {
        stare = (await all(`portal_klienci?id=eq.${enc(id)}&select=dane`))[0]?.dane;
        if (!stare) return json({ error: "Nie ma takiego klienta." }, 404, origin);
      }
      const zm = zmianyKlienta(stare ?? {}, dane), zmianaId = id !== null && noweId !== id;
      if (noweId !== id && (await all(`portal_klienci?id=eq.${enc(noweId)}&select=id`)).length) return json({ error: dane.nip ? "Klient z tym NIP już jest w bazie." : "Klient o tej nazwie (bez NIP) już jest w bazie." }, 409, origin);
      // a client that already had a NIP gets another: other modules keep their rows under the old one
      const zmianaNip = zmianaId && /^\d{10}$/.test(id!);
      const inne = zmianaNip ? await inneModuly(id!) : {};
      if (body.dry === true) return json({ ok: true, dry: true, zmiany: zm, id: noweId, zmiana_id: zmianaId, zmiana_nip: zmianaNip, inne_moduly: inne }, 200, origin);
      if (id !== null && !zm.length) return json({ ok: true, id, bez_zmian: true }, 200, origin);
      if (zmianaNip && body.potwierdz_nip !== true) return json({ error: "Zmiana NIP klienta wymaga potwierdzenia.", wymaga_potwierdzenia: true, inne_moduly: inne }, 409, origin);
      const r = await db("rpc/klienci_zapisz", { method: "POST", body: JSON.stringify({ p_id: id, p_nowe_id: noweId, p_dane: dane, p_kto: ja.email, p_zmiany: zm }) });
      if (!r.ok) {
        const t = await r.text();
        if (t.includes("klient_istnieje")) return json({ error: "Taki klient już jest w bazie." }, 409, origin);
        console.error("klienci-baza klient_zapisz", r.status);
        return json({ error: "Nie udało się zapisać klienta." }, 500, origin);
      }
      console.log("klienci-baza klient_zapisz", id === null ? "dodanie" : zmianaId ? "zmiana_id" : "edycja", "pól:", zm.length);
      return json({ ok: true, id: noweId, zmiany: zm, zmiana_id: zmianaId }, 200, origin);
    }

    if (action === "telegram_sprawdz") {
      if (!ja.admin) return tylkoAdmin();
      if (body.wszystkie === true) {
        // `od`: when the page began this round — everything checked since then is left alone
        const od = typeof body.od === "string" && !isNaN(Date.parse(body.od)) && Date.parse(body.od) <= Date.now() + 60000 && Date.now() - Date.parse(body.od) < 3 * 3600000 ? new Date(Date.parse(body.od)).toISOString() : null;
        if (!od) return json({ error: "Nieprawidłowy początek sprawdzania." }, 400, origin);
        return json(await tgPartia(od, null), 200, origin);
      }
      if (!okId(body.id)) return json({ error: "Nieprawidłowy identyfikator klienta." }, 400, origin);
      return json(await tgPartia(new Date().toISOString(), body.id), 200, origin);
    }
    if (action === "telegram_ustawienia") {
      if (!ja.admin) return tylkoAdmin();
      if (!Array.isArray(body.boty) || body.boty.length > 10) return json({ error: "Nieprawidłowa lista botów." }, 400, origin);
      const boty = wymaganeBoty(body.boty);
      if (boty.length !== body.boty.length) return json({ error: "Każdy bot potrzebuje nazwy i liczbowego id (5–15 cyfr), bez powtórzeń." }, 400, origin);
      await tgZapiszUstawienia({ ...(await tgUstawienia()), boty });
      return json({ ok: true, boty }, 200, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error("klienci-baza", action, String((e as Error)?.message ?? e).slice(0, 200));
    return json({ error: "Błąd serwera — spróbuj ponownie." }, 500, origin);
  }
});
