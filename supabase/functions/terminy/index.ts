// Automatic control of document and contract deadlines.
//
// Scheduled (pg_cron, header x-cron-key):
//   POST { action: "run", dry? } once a day: Telegram summary for the HR team and, when
//                                switched on, reminders to the employers (one e-mail per firm)
//   POST { action: "watchdog" }  later the same day: repeats the run if it did not finish,
//                                checks mail / Telegram / clients sheet / rates, alerts on trouble
//   POST { action: "sms", dry? } during working hours: an SMS to the firm's phone for the reminders that
//                                already went by e-mail (see "Reminders by SMS" below). OFF by default.
// Portal, Kadry section (JWT):
//   POST { action: "preview" }            what is due for every firm today + settings + health
//   POST { action: "send_firm", nip }     send that firm's due reminders now
//   POST { action: "settings", klient }   admin only — "off" | "auto"
//
// A reminder for a worker / document / date goes out once per threshold (60, 30, 14, 7 days,
// expiry); portal_powiadomienia is both the log and the dedupe key. Items that expired more
// than a week ago are never sent to a client — they are stale data for the HR team to clear.
// Telegram messages carry no personal data of workers, only counts and firm names.

import nodemailer from "npm:nodemailer@6.9.14";
import { type Klient, loadKlienci } from "../_shared/klienci.ts";
import { inicjaly, wypelnij } from "../sms/logic.ts";
import { smsSkonfigurowane, ustawieniaSms, wyslijSms } from "../sms/wyslij.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TG = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CRON_KEY = Deno.env.get("CRON_KEY") ?? "";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "mail.td-group.pl";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "kadry@td-group.pl";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? "";
const MAIL_FROM = `TD Consulting Group — Kadry <${SMTP_USER}>`;
const PORTAL = "https://docgenerator.td-group.pl";
const TABLE = "zatrudnienie_zgloszenia";
const STALE_DAYS = 7;   // expired longer ago than this: not sent to the client
const MAX_FIRMS = 60;   // safety cap of e-mails per run

type Doc = { k: string; label: string; progi: number[]; grupa: "pobyt" | "paszport" | "badania" | "umowa" };
const DOCS: Doc[] = [
  { k: "p_karta_do", label: "karta pobytu", progi: [60, 30, 14, 7, 0], grupa: "pobyt" },
  { k: "p_zezwolenie_do", label: "zezwolenie na pracę / wiza / oświadczenie", progi: [60, 30, 14, 7, 0], grupa: "pobyt" },
  { k: "p_paszport_do", label: "paszport", progi: [60, 30, 0], grupa: "paszport" },
  { k: "p_badania_do", label: "badania lekarskie (orzeczenie)", progi: [30, 14, 7, 0], grupa: "badania" },
  { k: "u_do", label: "umowa", progi: [30, 14, 7, 0], grupa: "umowa" },
];
const CO_ZROBIC: Record<Doc["grupa"], string> = {
  pobyt: "Dokument pobytowy lub zezwolenie: pracownik powinien złożyć wniosek o nowy dokument przed upływem ważności obecnego. " +
    "Pracodawca przechowuje kopię ważnego dokumentu uprawniającego do pobytu przez cały okres wykonywania pracy " +
    "(art. 4 ustawy z 20 marca 2025 r. o warunkach dopuszczalności powierzania pracy cudzoziemcom), a powierzenie pracy " +
    "cudzoziemcowi bez podstawy pobytu lub wymaganego zezwolenia jest nielegalne (art. 2 pkt 2 i art. 84 tej ustawy). " +
    "Prosimy o przesłanie skanu nowego dokumentu albo potwierdzenia złożenia wniosku.",
  paszport: "Paszport: prosimy o przesłanie skanu nowego paszportu po jego wymianie.",
  badania: "Badania lekarskie: pracownika nie wolno dopuścić do pracy bez aktualnego orzeczenia lekarskiego " +
    "(art. 229 § 4 Kodeksu pracy). Prosimy o skierowanie pracownika na badania okresowe i przesłanie nowego orzeczenia.",
  umowa: "Umowa: prosimy o informację, czy umowa będzie przedłużona (przygotujemy dokumenty), czy współpraca się kończy.",
};

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
async function portalUser(req: Request): Promise<{ email: string; admin: boolean } | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  const kadry = m.portal_admin === true || !Array.isArray(m.portal_sections) || m.portal_sections.includes("kadry");
  return m.portal === true && kadry ? { email: u.email ?? "", admin: m.portal_admin === true } : null;
}
function isCron(req: Request) {
  const k = req.headers.get("x-cron-key") ?? "";
  if (!CRON_KEY || k.length !== CRON_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < k.length; i++) diff |= k.charCodeAt(i) ^ CRON_KEY.charCodeAt(i);
  return diff === 0;
}

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const days = (iso: string, from: string) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
const pl = (iso: string) => iso.split("-").reverse().join(".");
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

// deno-lint-ignore no-explicit-any
type Row = { id: string; worker_name: string | null; status: string; created_at: string; payload: any };
type Item = { worker_id: string; worker: string; nip: string; firma: string; doc: Doc; date: string; d: number; prog: number };

async function loadRows(): Promise<Row[]> {
  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db(`${TABLE}?select=id,worker_name,status,created_at,payload&status=neq.archiwum&order=created_at.asc`, {
      headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" },
    });
    if (!r.ok) throw new Error("baza: " + r.status);
    const part: Row[] = await r.json();
    all.push(...part);
    if (part.length < 1000) break;
  }
  return all;
}
// the tightest threshold already reached, e.g. 20 days left -> 30
function prog(doc: Doc, d: number): number | null {
  if (d < -STALE_DAYS) return null;
  const reached = doc.progi.filter((p) => p >= d);
  return reached.length ? Math.min(...reached) : null;
}
// everything inside a reminder window, for workers who are actually employed
function windowItems(rows: Row[], dzis: string): Item[] {
  const out: Item[] = [];
  for (const w of rows) {
    if (w.status !== "zatrudniony") continue;
    const p = w.payload ?? {};
    for (const doc of DOCS) {
      const v = p[doc.k];
      if (!isDate(v)) continue;
      const d = days(v, dzis), pr = prog(doc, d);
      if (pr === null) continue;
      out.push({ worker_id: w.id, worker: w.worker_name ?? "", nip: digits(p.z_nip), firma: p.z_nazwa ?? "", doc, date: v, d, prog: pr });
    }
  }
  return out;
}
async function sentKeys(): Promise<Set<string>> {
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const keys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const r = await db(`portal_powiadomienia?select=worker_id,doc_key,doc_date,prog&rodzaj=eq.termin_klient&status=eq.ok&created_at=gte.${since}`, {
      headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" },
    });
    if (!r.ok) throw new Error("dziennik: " + r.status);
    const part = await r.json();
    for (const x of part) keys.add(`${x.worker_id}|${x.doc_key}|${x.doc_date}|${x.prog}`);
    if (part.length < 1000) break;
  }
  return keys;
}
const key = (i: Item) => `${i.worker_id}|${i.doc.k}|${i.date}|${i.prog}`;

function termText(d: number) { return d < 0 ? `po terminie ${-d} dni` : d === 0 ? "dzisiaj" : `za ${d} dni`; }
function mailFor(firma: string, items: Item[]) {
  const lines = items.slice().sort((a, b) => a.d - b.d)
    .map((i) => `• ${i.worker} — ${i.doc.label}: do ${pl(i.date)} (${termText(i.d)})`);
  const groups = [...new Set(items.map((i) => i.doc.grupa))];
  const text = `Dzień dobry,

przypominamy o zbliżających się terminach dotyczących osób zatrudnionych w firmie ${firma || "Państwa firmie"}:

${lines.join("\n")}

Co należy zrobić:
${groups.map((g) => "– " + CO_ZROBIC[g]).join("\n")}

Nowe dokumenty i informacje prosimy przesłać w odpowiedzi na tę wiadomość.

Wiadomość została wygenerowana automatycznie na podstawie danych przekazanych do biura. Jeżeli któryś termin jest nieaktualny (np. dokument został już wymieniony), prosimy o krótką informację — poprawimy dane.

Pozdrawiamy
Dział kadr — TD Consulting Group`;
  const pilne = items.some((i) => i.d <= 7);
  return { subject: `${pilne ? "PILNE: " : ""}Kończące się terminy dokumentów pracowników — ${firma || "przypomnienie"}`, text };
}

function transport() {
  return nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: SMTP_USER, pass: SMTP_PASS } });
}
// deno-lint-ignore no-explicit-any
async function tg(method: string, body?: unknown): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  return await r.json().catch(() => ({ ok: false }));
}
async function setting(k: string) {
  const r = await db(`portal_ustawienia?key=eq.${k}&select=value`);
  return r.ok ? (await r.json())[0]?.value ?? null : null;
}
async function tellKadry(text: string): Promise<number> {
  if (!TG) return 0;
  const chats = await setting("telegram_kadry");
  let ok = 0;
  for (const c of Array.isArray(chats) ? chats : []) {
    const r = await tg("sendMessage", { chat_id: c.id, text, disable_web_page_preview: true });
    if (r?.ok) ok++; else console.error("telegram", r?.description);
  }
  return ok;
}

// Sends one firm's due reminders and logs every item. Returns "ok" or the error text.
async function sendFirm(k: Klient, firma: string, nip: string, items: Item[], by: string): Promise<string> {
  const m = mailFor(firma, items);
  let err = "";
  try {
    await transport().sendMail({ from: MAIL_FROM, to: k.email, bcc: SMTP_USER, subject: m.subject, text: m.text });
  } catch (e) {
    err = String((e as Error)?.message ?? e).slice(0, 200);
    console.error("smtp", err);
  }
  const rows = items.map((i) => ({
    rodzaj: "termin_klient", nip, worker_id: i.worker_id, doc_key: i.doc.k, doc_date: i.date, prog: i.prog,
    kanal: "mail", adresat: k.email, status: err ? "blad" : "ok", blad: err || null, wyslal: by,
  }));
  // ignore-duplicates: a parallel run cannot log (and so cannot count) the same reminder twice
  const ins = await db("portal_powiadomienia", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(rows),
  });
  if (!ins.ok) console.error("log", ins.status, await ins.text());
  return err || "ok";
}

type Plan = { nip: string; firma: string; email: string; items: Item[] };
// Baza klientów: a firm whose service ended on or before today gets no reminders (a suspended one still does).
// When the list cannot be read, nobody is skipped.
async function zakonczeni(dzis: string): Promise<Set<string>> {
  const koniec = new Set<string>();
  try {
    const z = await db(`klienci_baza?select=nip&status=eq.zakonczony&koniec_od=lte.${dzis}`);
    if (z.ok) for (const k of await z.json()) if (k.nip) koniec.add(String(k.nip));
  } catch (e) { console.error("klienci_baza", e); }
  return koniec;
}
async function plan(rows: Row[], dzis: string): Promise<{ plans: Plan[]; klienciBlad: string }> {
  const sent = await sentKeys();
  const koniec = await zakonczeni(dzis);
  const due = windowItems(rows, dzis).filter((i) => !sent.has(key(i)) && !koniec.has(i.nip));
  let klienci = new Map<string, Klient>(), klienciBlad = "";
  try { klienci = await loadKlienci(); } catch (e) { klienciBlad = String((e as Error)?.message ?? e); }
  const by = new Map<string, Plan>();
  for (const i of due) {
    const id = i.nip || "nazwa:" + i.firma.toLowerCase();
    let p = by.get(id);
    if (!p) { p = { nip: i.nip, firma: i.firma || klienci.get(i.nip)?.nazwa || "", email: klienci.get(i.nip)?.email ?? "", items: [] }; by.set(id, p); }
    p.items.push(i);
  }
  const plans = [...by.values()].sort((a, b) => Math.min(...a.items.map((i) => i.d)) - Math.min(...b.items.map((i) => i.d)));
  return { plans, klienciBlad };
}

// ---------------------------------------------------------------- Reminders by SMS (optional channel)
// Sent only when all three hold: client reminders are in "auto" mode, the SMS module is switched on and
// its switch "Przypomnienia o terminach SMS-em" is on. The SMS never goes alone: it accompanies a reminder
// that went by e-mail in the last SMS_PO_MAILU days and says only that there is something to read — a
// worker is named by initials, the document by its kind. Dedupe: the same key as the e-mail (worker /
// document / date / threshold) logged under rodzaj "termin_klient_sms" (its own unique index).
// The morning run (05:10 UTC) is outside the hours allowed for SMS, so the SMS go in a separate call
// (action "sms") scheduled in working hours; the SMS path itself refuses automatic sends at night.
const SMS_PO_MAILU = 3;
const SMS_DOK: Record<string, string> = { p_karta_do: "karta pobytu", p_zezwolenie_do: "zezwolenie na pracę", p_paszport_do: "paszport", p_badania_do: "badania lekarskie", u_do: "umowa" };
type SmsPlan = { nip: string; firma: string; items: Item[]; tresc: string };
function smsTresc(items: Item[]): string {
  const pierwsza = items.slice().sort((a, b) => a.d - b.d)[0];
  if (items.length === 1) return wypelnij("termin", { dokument: SMS_DOK[pierwsza.doc.k] ?? "dokument", inicjaly: inicjaly(pierwsza.worker) || "—", data: pl(pierwsza.date) })!;
  return wypelnij("termin_zbiorczy", { liczba: items.length, data: pl(pierwsza.date) })!;
}
async function klucze(rodzaj: string, dni: number): Promise<Set<string>> {
  const since = new Date(Date.now() - dni * 86400000).toISOString();
  const keys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const r = await db(`portal_powiadomienia?select=worker_id,doc_key,doc_date,prog&rodzaj=eq.${rodzaj}&status=eq.ok&created_at=gte.${since}`, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error("dziennik: " + r.status);
    const part = await r.json();
    for (const x of part) keys.add(`${x.worker_id}|${x.doc_key}|${x.doc_date}|${x.prog}`);
    if (part.length < 1000) break;
  }
  return keys;
}
// `dodatkowe`: reminders about to go by e-mail in this very run (used by the dry run to show what would follow)
async function smsPlan(rows: Row[], dzis: string, dodatkowe: Item[] = []): Promise<SmsPlan[]> {
  const [mail, sms, koniec] = await Promise.all([klucze("termin_klient", SMS_PO_MAILU), klucze("termin_klient_sms", 120), zakonczeni(dzis)]);
  for (const i of dodatkowe) mail.add(key(i));
  const by = new Map<string, SmsPlan>();
  for (const i of windowItems(rows, dzis)) {
    if (i.nip.length !== 10 || koniec.has(i.nip) || !mail.has(key(i)) || sms.has(key(i))) continue;
    let p = by.get(i.nip);
    if (!p) { p = { nip: i.nip, firma: i.firma, items: [], tresc: "" }; by.set(i.nip, p); }
    p.items.push(i);
  }
  const plans = [...by.values()];
  for (const p of plans) p.tresc = smsTresc(p.items);
  return plans.sort((a, b) => Math.min(...a.items.map((i) => i.d)) - Math.min(...b.items.map((i) => i.d)));
}
async function smsTryb(): Promise<{ auto: boolean; powod: string }> {
  if ((await setting("terminy"))?.klient !== "auto") return { auto: false, powod: "przypomnienia do klientów nie są w trybie automatycznym" };
  if (!smsSkonfigurowane()) return { auto: false, powod: "SMS nie jest skonfigurowany" };
  const u = await ustawieniaSms();
  if (!u.wlaczone) return { auto: false, powod: "wysyłka SMS jest wyłączona" };
  if (!u.automaty.terminy) return { auto: false, powod: "przypomnienia o terminach SMS-em są wyłączone" };
  return { auto: true, powod: "" };
}
const smsOpis = (plans: SmsPlan[]) => plans.map((p) => ({ nip: p.nip, firma: p.firma, pozycji: p.items.length, tresc: p.tresc }));
// dry: says what would go and to how many firms; sends nothing and leaves no trace
async function runSms(dzis: string, dry = false) {
  const tryb = await smsTryb();
  const plans = await smsPlan(await loadRows(), dzis);
  if (dry || !tryb.auto) return { tryb: tryb.auto ? "auto" : "off", powod: tryb.powod || undefined, firmy: plans.length, plan: dry ? smsOpis(plans) : undefined, wyslane: 0 };
  const id = await logStart("terminy_sms");
  let wyslane = 0, bledy = 0, bezTelefonu = 0, zRzedu = 0, przerwano = "";
  try {
    for (const p of plans.slice(0, MAX_FIRMS)) {
      const w = await wyslijSms({ nip: p.nip, tresc: p.tresc, cel: "termin", ref: p.nip, kto: "automat", automat: true });
      // outside the allowed hours, switched off meanwhile or the daily cap reached: the rest waits for the next call
      if (!w.ok && ["cisza", "wylaczone", "limit_dzienny", "brak_konfiguracji", "baza"].includes(w.kod ?? "")) { przerwano = w.kod!; break; }
      if (!w.ok && w.kod === "numer") { bezTelefonu++; continue; } // no mobile number on file: nothing to log, the e-mail went
      if (w.ok) { wyslane++; zRzedu = 0; } else { bledy++; zRzedu++; }
      const wiersze = p.items.map((i) => ({
        rodzaj: "termin_klient_sms", nip: p.nip, worker_id: i.worker_id, doc_key: i.doc.k, doc_date: i.date, prog: i.prog,
        kanal: "sms", adresat: w.telefon ?? null, status: w.ok ? "ok" : "blad", blad: w.ok ? null : String(w.error ?? w.kod ?? "").slice(0, 200), wyslal: "auto",
      }));
      const ins = await db("portal_powiadomienia", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(wiersze) });
      if (!ins.ok) console.error("log sms", ins.status);
      // the provider refuses one after another (token, points, outage): the next firms would fail the same way
      if (zRzedu >= 3) { przerwano = "dostawca"; break; }
    }
    const info = { tryb: "auto", firmy: plans.length, wyslane, bledy, bezTelefonu, przerwano: przerwano || undefined };
    await logEnd(id, bledy === 0 && !przerwano, info);
    return info;
  } catch (e) {
    await logEnd(id, false, { error: String((e as Error)?.message ?? e).slice(0, 300) });
    throw e;
  }
}

function stats(rows: Row[], dzis: string) {
  let nowe = 0, pobytPo = 0, d7 = 0, d30 = 0, umowy30 = 0, umowyPo = 0, zus = 0;
  for (const w of rows) {
    const p = w.payload ?? {};
    if (w.status === "nowe") nowe++;
    for (const doc of DOCS) {
      const v = p[doc.k];
      if (!isDate(v)) continue;
      const d = days(v, dzis);
      if (doc.grupa === "umowa") { if (d < 0) umowyPo++; else if (d <= 30) umowy30++; }
      else if (d < 0) pobytPo++; else if (d <= 7) d7++; else if (d <= 30) d30++;
    }
    // registration with ZUS is due within 7 days of the start of work
    if (!p._import && !p.k_zus && ["sprawdzone", "wyslane", "zatrudniony"].includes(w.status) && isDate(p.u_od)) {
      const s = days(p.u_od, dzis);
      if (s <= 0 && s >= -30) zus++;
    }
  }
  return { nowe, pobytPo, d7, d30, umowy30, umowyPo, zus };
}

async function health() {
  const problems: string[] = [];
  if (!SMTP_PASS) problems.push("Poczta: brak hasła skrzynki kadry@ (SMTP_PASS).");
  else { try { await transport().verify(); } catch (e) { problems.push("Poczta: logowanie nieudane (" + String((e as Error)?.message ?? e).slice(0, 80) + ")."); } }
  if (!TG) problems.push("Telegram: brak tokenu bota.");
  else { const me = await tg("getMe"); if (!me?.ok) problems.push("Telegram: bot nie odpowiada."); }
  try { const k = await loadKlienci(); if (k.size < 5) problems.push("Baza klientów: podejrzanie mało firm (" + k.size + ")."); }
  catch (e) { problems.push("Baza klientów: " + String((e as Error)?.message ?? e)); }
  const year = Number(today().slice(0, 4));
  const st = await db(`portal_stawki?select=valid_from&valid_from=gte.${year}-01-01&valid_from=lte.${year}-12-31`);
  if (!st.ok || !(await st.json()).length) problems.push(`Stawki: brak płacy minimalnej na rok ${year} w bazie.`);
  return problems;
}

async function logStart(zadanie: string) {
  const r = await db("portal_zadania_log", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ zadanie }) });
  return r.ok ? (await r.json())[0]?.id as number : null;
}
async function logEnd(id: number | null, ok: boolean, info: unknown) {
  if (id == null) return;
  await db(`portal_zadania_log?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ ok, info, finished_at: new Date().toISOString() }) });
}
async function ranToday(zadanie: string, dzis: string) {
  const r = await db(`portal_zadania_log?select=id&zadanie=eq.${zadanie}&dzien=eq.${dzis}&ok=is.true&limit=1`);
  return r.ok && (await r.json()).length > 0;
}

// dry: computes the same numbers but sends nothing and leaves no trace (used for checks)
async function run(dzis: string, dry = false) {
  const id = dry ? null : await logStart("terminy");
  try {
    const rows = await loadRows();
    const s = stats(rows, dzis);
    const mode = (await setting("terminy"))?.klient === "auto" ? "auto" : "off";
    const { plans, klienciBlad } = await plan(rows, dzis);
    let wyslane = 0, bledy = 0;
    const bezMaila = plans.filter((p) => !p.email).length;
    if (!dry && mode === "auto" && SMTP_PASS && !klienciBlad) {
      for (const p of plans.filter((p) => p.email).slice(0, MAX_FIRMS)) {
        const r = await sendFirm({ nazwa: p.firma, email: p.email, chat: "" }, p.firma, p.nip, p.items, "auto");
        if (r === "ok") wyslane++; else bledy++;
      }
    }
    const doWyslania = plans.filter((p) => p.email).length;
    const lines = [
      s.nowe ? `📥 Nowe zgłoszenia do sprawdzenia: ${s.nowe}` : "",
      s.zus ? `🧾 Zgłoszenie do ZUS (7 dni od rozpoczęcia pracy) — do potwierdzenia: ${s.zus}` : "",
      s.pobytPo ? `🔴 Dokumenty po terminie: ${s.pobytPo}` : "",
      s.d7 ? `🔴 Dokumenty kończące się w 7 dni: ${s.d7}` : "",
      s.d30 ? `🟠 Dokumenty kończące się w 30 dni: ${s.d30}` : "",
      s.umowyPo ? `🔴 Umowy po dacie końca: ${s.umowyPo}` : "",
      s.umowy30 ? `🟠 Umowy kończące się w 30 dni: ${s.umowy30}` : "",
      mode === "auto"
        ? (wyslane || bledy ? `✉️ Przypomnienia do klientów: wysłano ${wyslane}${bledy ? `, błędy: ${bledy}` : ""}` : "")
        : (doWyslania ? `✉️ Przypomnienia do klientów czekają na wysłanie: ${doWyslania} firm (Kontrola → Przypomnienia)` : ""),
      bezMaila ? `⚠️ Firmy bez e-maila w bazie klientów: ${bezMaila}` : "",
      klienciBlad ? `⚠️ ${klienciBlad}` : "",
    ].filter(Boolean);
    let digest = 0;
    if (lines.length && !dry) digest = await tellKadry(`🚦 Kadry — ${pl(dzis)}\n${lines.join("\n")}\n\n${PORTAL}/kontrola.html`);
    // dry: also the SMS that would accompany today's e-mails (and those still waiting), without sending
    let sms: unknown;
    if (dry) {
      try { const t = await smsTryb(), sp = await smsPlan(rows, dzis, plans.filter((p) => p.email).flatMap((p) => p.items)); sms = { tryb: t.auto ? "auto" : "off", powod: t.powod || undefined, firmy: sp.length, plan: smsOpis(sp) }; }
      catch (e) { sms = { error: String((e as Error)?.message ?? e).slice(0, 120) }; }
    }
    const info = { ...s, mode, firmy: plans.length, wyslane, bledy, bezMaila, digest, klienciBlad, tekst: dry ? lines : undefined, sms };
    // a failed mail leaves the day "not done", so the watchdog tries those firms again
    await logEnd(id, bledy === 0 && !klienciBlad, info);
    return info;
  } catch (e) {
    await logEnd(id, false, { error: String((e as Error)?.message ?? e).slice(0, 300) });
    throw e;
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }
  const dzis = today();

  try {
    if (body.action === "run" || body.action === "watchdog" || body.action === "sms") {
      if (!isCron(req)) return json({ error: "Brak dostępu." }, 403, origin);
      if (body.action === "sms") {
        if (body.dry === true) return json({ ok: true, dry: true, info: await runSms(dzis, true) }, 200, origin);
        if (await ranToday("terminy_sms", dzis)) return json({ ok: true, skipped: true }, 200, origin);
        return json({ ok: true, info: await runSms(dzis) }, 200, origin);
      }
      if (body.action === "run") {
        if (body.dry === true) return json({ ok: true, dry: true, info: await run(dzis, true), problems: await health() }, 200, origin);
        if (await ranToday("terminy", dzis)) return json({ ok: true, skipped: true }, 200, origin);
        return json({ ok: true, info: await run(dzis) }, 200, origin);
      }
      // watchdog: finish what the morning run did not, then check the moving parts
      const id = await logStart("watchdog");
      const notes: string[] = [];
      if (!(await ranToday("terminy", dzis))) {
        try { const i = await run(dzis); if (i.bledy || i.klienciBlad) notes.push("Poranna kontrola terminów nie zakończyła się w pełni — powtórzono, nadal są błędy wysyłki."); }
        catch (e) { notes.push("Kontrola terminów nie działa: " + String((e as Error)?.message ?? e).slice(0, 120)); }
      }
      const problems = (await health()).concat(notes);
      if (problems.length) await tellKadry(`⚠️ Portal — do sprawdzenia:\n${problems.map((p) => "• " + p).join("\n")}`);
      await logEnd(id, problems.length === 0, { problems });
      return json({ ok: problems.length === 0, problems }, 200, origin);
    }

    const me = await portalUser(req);
    if (!me) return json({ error: "Brak dostępu (portal, sekcja Kadry)." }, 403, origin);

    if (body.action === "settings") {
      if (!me.admin) return json({ error: "Tylko administrator może zmienić to ustawienie." }, 403, origin);
      const klient = body.klient === "auto" ? "auto" : "off";
      await db("portal_ustawienia", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "terminy", value: { klient, by: me.email }, updated_at: new Date().toISOString() }),
      });
      return json({ ok: true, klient }, 200, origin);
    }
    if (body.action === "preview") {
      const { plans, klienciBlad } = await plan(await loadRows(), dzis);
      const last = await db("portal_zadania_log?select=zadanie,dzien,started_at,ok,info&order=id.desc&limit=6");
      return json({
        mode: (await setting("terminy"))?.klient === "auto" ? "auto" : "off",
        admin: me.admin, mail_from: SMTP_USER, mail_configured: !!SMTP_PASS, klienciBlad,
        firmy: plans.map((p) => ({
          nip: p.nip, firma: p.firma, email: p.email,
          items: p.items.map((i) => ({ worker: i.worker, doc: i.doc.label, date: i.date, d: i.d })),
          ...mailFor(p.firma, p.items),
        })),
        zadania: last.ok ? await last.json() : [],
      }, 200, origin);
    }
    if (body.action === "send_firm") {
      const nip = digits(body.nip);
      if (nip.length !== 10) return json({ error: "Brak NIP firmy." }, 400, origin);
      if (!SMTP_PASS) return json({ error: "Poczta nie jest skonfigurowana." }, 400, origin);
      const { plans, klienciBlad } = await plan(await loadRows(), dzis);
      if (klienciBlad) return json({ error: klienciBlad }, 502, origin);
      const p = plans.find((x) => x.nip === nip);
      if (!p) return json({ error: "Dla tej firmy nie ma nic do wysłania (już wysłano albo terminy się zmieniły)." }, 200, origin);
      if (!p.email) return json({ error: "Brak e-maila tej firmy w bazie klientów — uzupełnij go w arkuszu klientów." }, 200, origin);
      const r = await sendFirm({ nazwa: p.firma, email: p.email, chat: "" }, p.firma, p.nip, p.items, me.email);
      return r === "ok" ? json({ ok: true, to: p.email, n: p.items.length }, 200, origin) : json({ error: "Błąd wysyłki: " + r }, 200, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
