// Komunikacja z klientami — everything that touches the database, Telegram, SMS or the mail server.
// Used by the `komunikacja` function (portal) and by `tg-bot` (the bot's webhook).
//
// TOKENS. The subscription bot (private chats) is KLIENT_BOT_TOKEN when that secret exists, otherwise
// TELEGRAM_BOT_TOKEN. Posting to clients' GROUPS always uses TELEGRAM_BOT_TOKEN — the bot that is already
// a member of those groups. A token is read here and goes nowhere but the request address: never to a
// log, an answer or the database; a network error is never printed (its text may quote the address).

import nodemailer from "npm:nodemailer@6.9.14";
import { firstMail, loadKlienciRows } from "../_shared/klienci.ts";
import { pierwszyNumer, wGodzinach } from "../sms/logic.ts";
import { ustawieniaSms, wyslijSms } from "../sms/wyslij.ts";
import {
  BOT_RE, czyGrupa, czytajTg, czytajUst, type Dane, ileWPrzebiegu, jezykKlienta, kiedyPonowic, klawiatura, type KlientR, linkBota, losowaSol, MAX_TG, sha256hex,
  type Sub, tgHtml, tokenZSoli, type Tresc, type Ust, wariantMail, wariantSms, wariantTg, wstaw, type Zgody,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TOKEN_GRUPA = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TOKEN_SUB = Deno.env.get("KLIENT_BOT_TOKEN") || TOKEN_GRUPA;
const SEKRET = Deno.env.get("KOMUNIKACJA_SECRET") ?? "";
export const WEBHOOK_SECRET = Deno.env.get("TG_WEBHOOK_SECRET") ?? "";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "mail.td-group.pl";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "kadry@td-group.pl";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? "";
export const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/tg-bot`;
export const UPDATES = ["message", "my_chat_member", "callback_query"];

// deno-lint-ignore no-explicit-any
type Any = any;
export const enc = encodeURIComponent;
export const konfiguracja = () => ({
  bot: !!TOKEN_SUB, osobny_bot: !!Deno.env.get("KLIENT_BOT_TOKEN") && TOKEN_SUB !== TOKEN_GRUPA, bot_grup: !!TOKEN_GRUPA,
  sekret_linkow: SEKRET.length >= 32, sekret_webhooka: WEBHOOK_SECRET.length >= 24, poczta: !!SMTP_PASS, poczta_od: SMTP_USER,
});

export function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
export async function czytaj<T = Any>(path: string): Promise<T[]> {
  const r = await db(path);
  if (!r.ok) throw new Error("baza " + r.status + " " + path.split("?")[0]);
  return await r.json();
}
export async function rpc<T = Any>(fn: string, args: unknown): Promise<T> {
  const r = await db("rpc/" + fn, { method: "POST", body: JSON.stringify(args) });
  if (!r.ok) throw new Error("rpc " + fn + " " + r.status);
  return await r.json();
}
export async function zmien(path: string, pola: unknown): Promise<boolean> {
  const r = await db(path, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(pola) });
  if (!r.ok) console.error("komunikacja zapis", path.split("?")[0], r.status);
  return r.ok;
}

// what the tests replace: the pause between messages, the clock and the mail server
export const zal = {
  spij: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  teraz: () => new Date(),
  poczta: async (m: { to: string; subject: string; text: string }): Promise<string> => {
    const tr = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: SMTP_USER, pass: SMTP_PASS } });
    const w = await tr.sendMail({ from: `TD Consulting Group <${SMTP_USER}>`, ...m });
    return String(w?.messageId ?? "");
  },
};

// ---------------------------------------------------------------- Telegram
// Only these methods can leave this module. setWebhook / deleteWebhook are reachable from one place:
// the administrator's explicit action in index.ts.
const METODY = ["getMe", "getWebhookInfo", "sendMessage", "answerCallbackQuery", "setWebhook", "deleteWebhook"];
export async function tg(ktory: "sub" | "grupa", metoda: string, body?: unknown): Promise<{ http: number; dane: Any; siec?: boolean }> {
  const t = ktory === "sub" ? TOKEN_SUB : TOKEN_GRUPA;
  if (!t || !METODY.includes(metoda)) return { http: 0, dane: { description: t ? "metoda niedozwolona" : "brak tokenu bota" } };
  try {
    const r = await fetch(`https://api.telegram.org/bot${t}/${metoda}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(15000) });
    return { http: r.status, dane: await r.json().catch(() => null) };
  } catch (_e) {
    return { http: 0, dane: null, siec: true }; // the request may or may not have reached Telegram
  }
}
let nazwaBota = "";
export async function botUsername(): Promise<string> {
  if (nazwaBota) return nazwaBota;
  const w = await tg("sub", "getMe");
  const u = String(w.dane?.result?.username ?? "");
  if (w.dane?.ok && BOT_RE.test(u)) nazwaBota = u;
  return nazwaBota;
}

// ---------------------------------------------------------------- settings, clients, subscribers, consents
export async function ustawienia(): Promise<Ust> {
  const w = (await czytaj("portal_ustawienia?key=eq.komunikacja&select=value,updated_at"))[0];
  return czytajUst(w ? { ...w.value, updated_at: w.updated_at } : null);
}
// The clients base (shared loader) joined with the service status and scope (view klienci_obsluga).
export async function klienci(): Promise<KlientR[]> {
  const [rows, obs, sms] = await Promise.all([loadKlienciRows(), czytaj("klienci_obsluga?select=id,nip,nazwa,status,obslugiwany,zakres_ksiegowosc,zakres_kadry&limit=5000"), ustawieniaSms().catch(() => null)]);
  const poNip = new Map<string, Any>(), poNazwie = new Map<string, Any>();
  for (const o of obs) { if (o.nip) poNip.set(String(o.nip), o); poNazwie.set(String(o.nazwa ?? "").trim().toLowerCase(), o); }
  const out: KlientR[] = [], seen = new Set<string>();
  for (const k of rows) {
    const o = (k.nip.length === 10 ? poNip.get(k.nip) : null) ?? poNazwie.get(k.nazwa.trim().toLowerCase());
    const id = o?.id ?? (k.nip.length === 10 ? k.nip : "nazwa:" + k.nazwa.trim().toLowerCase());
    if (!k.nazwa.trim() || seen.has(id)) continue;
    seen.add(id);
    const tel = pierwszyNumer(k.telefon, sms?.zagranica ?? false);
    out.push({
      id, nip: k.nip.length === 10 ? k.nip : "", nazwa: k.nazwa.trim(), forma: k.forma.trim(), opodatkowanie: k.opodatkowanie.trim(), miasto: k.miasto.trim(), opiekun: k.opiekun.trim(), kadrowy: k.kadrowy.trim(),
      kontakt: k.kontakt.trim(), jezyk: jezykKlienta(k.jezyk), status: o?.status ?? "obslugiwany", obslugiwany: o ? o.obslugiwany === true : true,
      zakres_ksiegowosc: o ? o.zakres_ksiegowosc === true : !!k.opiekun.trim(), zakres_kadry: o ? o.zakres_kadry === true : !!k.kadrowy.trim(),
      grupa: czyGrupa(k.telegram.trim()) ? k.telegram.trim() : "", telefon: tel.ok ? tel.e164 : "", email: firstMail(k.email),
    });
  }
  return out;
}
export const SUB_KOL = "id,klient,nip,pracownik,chat_id,imie,nazwisko,username,language_code,jezyk,rola,subscribed_at,aktywna,blocked_at,unsubscribed_at,wylaczyl,last_delivery_at,zgoda_marketing,zgoda_at,zgoda_zrodlo,zgoda_kto";
export async function subskrypcje(): Promise<{ wszystkie: Any[]; poKliencie: Map<string, Sub[]> }> {
  const wszystkie = await czytaj(`klient_subskrypcje?select=${SUB_KOL}&order=subscribed_at.desc&limit=10000`);
  const poKliencie = new Map<string, Sub[]>();
  for (const s of wszystkie) {
    if (!s.klient) continue;
    const l = poKliencie.get(s.klient) ?? [];
    l.push({ id: s.id, klient: s.klient, chat_id: String(s.chat_id), jezyk: s.jezyk, aktywna: s.aktywna === true, blocked_at: s.blocked_at, zgoda_marketing: s.zgoda_marketing === true });
    poKliencie.set(s.klient, l);
  }
  return { wszystkie, poKliencie };
}
// the newest entry per client and channel decides (the register is append-only)
export async function zgody(): Promise<Zgody> {
  const rows = await czytaj("klient_zgody?select=klient,kanal,zgoda,created_at&kanal=in.(sms,email)&order=created_at.asc&limit=20000");
  const out: Zgody = new Map();
  for (const z of rows) { const w = out.get(z.klient) ?? { sms: false, email: false }; w[z.kanal as "sms" | "email"] = z.zgoda === true; out.set(z.klient, w); }
  return out;
}

// ---------------------------------------------------------------- invitations
// The current link of a client (or of a member of staff). The token is recomputed from the stored salt and
// the secret, so the same link can be shown again and put into every message without being kept anywhere.
export async function zaproszenie(o: { klient?: string; pracownik?: string; kto: string; rotuj?: boolean; utworz?: boolean }): Promise<{ link: string; wazne_do: string; uzycia: number; max_uzyc: number | null; nowe: boolean } | null> {
  if (SEKRET.length < 32) return null;
  const bot = await botUsername();
  if (!bot) return null;
  const f = o.klient ? "klient=eq." + enc(o.klient) : "pracownik=eq." + enc(o.pracownik!);
  const teraz = zal.teraz();
  let z = (await czytaj(`klient_zaproszenia_tg?select=id,sol,expires_at,uzycia,max_uzyc&${f}&revoked_at=is.null&expires_at=gt.${enc(teraz.toISOString())}&order=created_at.desc&limit=1`))[0];
  const pelne = z && z.max_uzyc != null && z.uzycia >= z.max_uzyc;
  let nowe = false;
  if (z && (o.rotuj || pelne)) {
    await zmien(`klient_zaproszenia_tg?${f}&revoked_at=is.null`, { revoked_at: teraz.toISOString(), revoked_by: o.kto });
    z = null;
  }
  if (!z) {
    if (o.utworz === false) return null;
    const ust = await ustawienia(), sol = losowaSol(), token = await tokenZSoli(SEKRET, sol);
    const r = await db("klient_zaproszenia_tg", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ klient: o.klient ?? null, pracownik: o.pracownik ?? null, token_hash: await sha256hex(token), sol, created_by: o.kto, expires_at: new Date(teraz.getTime() + ust.link_dni * 86400000).toISOString(), max_uzyc: o.pracownik ? 5 : ust.link_max }),
    });
    if (!r.ok) throw new Error("zaproszenie " + r.status);
    z = (await r.json())[0]; nowe = true;
  }
  return { link: linkBota(bot, await tokenZSoli(SEKRET, z.sol)), wazne_do: z.expires_at, uzycia: z.uzycia, max_uzyc: z.max_uzyc, nowe };
}

// ---------------------------------------------------------------- one message
export type Rozsylka = { id: string; tytul: string; typ: "serwisowa" | "marketingowa"; status: string; tresc: Tresc; autor: string; bledy_z_rzedu: number; mimo_ciszy: boolean };
export type Wiersz = { id: string; rozsylka: string; klient: string; nazwa: string; kanal: string; adres: string; subskrypcja: string | null; jezyk: string | null; proby: number };
export type Skutek =
  | { s: "wyslano"; message_id?: number | null; ref?: string | null; powod?: string | null }
  | { s: "blad" | "pominieto" | "niepewny"; powod: string; liczy?: boolean; zablokowany?: boolean }
  | { s: "pozniej"; kiedy: Date; powod: string; limit?: boolean; liczy?: boolean }
  | { s: "stop"; powod: string };

export function daneKlienta(k: KlientR | undefined, nazwa: string, link: string): Dane {
  return { firma: k?.nazwa ?? nazwa, kontakt: k?.kontakt ?? "", opiekun: k?.opiekun ?? "", link_subskrypcji: link };
}
// what a Telegram message for this recipient consists of (also used by the preview)
export function wiadomoscTg(t: Tresc, jezyk: Any, d: Dane, naglowek = ""): { text: string; reply_markup?: Any; jezyk: string } | null {
  const w = wariantTg(t, jezyk);
  if (!w) return null;
  const text = naglowek + tgHtml(w.w, d);
  const kl = klawiatura(t, w.jezyk, d);
  return { text, jezyk: w.jezyk, ...(kl.length ? { reply_markup: { inline_keyboard: kl } } : {}) };
}
export async function wyslijTg(ktory: "sub" | "grupa", chat: string, m: { text: string; reply_markup?: Any }, proba: number): Promise<Skutek> {
  if (m.text.replace(/<[^>]+>/g, "").length > MAX_TG) return { s: "blad", powod: "wiadomość jest dłuższa niż " + MAX_TG + " znaków" };
  const body = { chat_id: chat, text: m.text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(m.reply_markup ? { reply_markup: m.reply_markup } : {}) };
  let w = await tg(ktory, "sendMessage", body);
  if (w.siec) return { s: "niepewny", powod: "brak odpowiedzi Telegrama — nie wiadomo, czy wiadomość wyszła", liczy: true };
  let o = czytajTg(w.http, w.dane), dopisek: string | null = null;
  if (o.rodzaj === "migracja") { // the group became a supergroup: one more try with the id Telegram gave
    dopisek = "grupa ma nowy identyfikator " + o.nowy + " — popraw go w bazie klientów";
    await zal.spij(1100);
    w = await tg(ktory, "sendMessage", { ...body, chat_id: o.nowy });
    if (w.siec) return { s: "niepewny", powod: "brak odpowiedzi Telegrama — nie wiadomo, czy wiadomość wyszła", liczy: true };
    o = czytajTg(w.http, w.dane);
  }
  if (o.rodzaj === "ok") return { s: "wyslano", message_id: o.message_id, powod: dopisek };
  if (o.rodzaj === "ponow") return { s: "pozniej", kiedy: kiedyPonowic(zal.teraz(), proba + 1, o.po_s), powod: o.opis, limit: o.limit, liczy: !o.limit };
  if (o.rodzaj === "zablokowany") return { s: "blad", powod: "odbiorca zablokował bota albo usunął konto", zablokowany: true };
  if (o.rodzaj === "auth") return { s: "stop", powod: "Telegram odrzucił token bota" };
  if (o.rodzaj === "brak_czatu") return { s: "blad", powod: "czat niedostępny dla bota: " + o.opis, liczy: true };
  return { s: "blad", powod: (o.rodzaj === "migracja" ? "grupa przeniesiona: " : "") + o.opis, liczy: true };
}
async function linkKlienta(klient: string, kto: string, pamiec: Map<string, string>): Promise<string> {
  if (!pamiec.has(klient)) pamiec.set(klient, (await zaproszenie({ klient, kto }).catch(() => null))?.link ?? "");
  return pamiec.get(klient)!;
}
const potrzebnyLink = (t: Tresc) => JSON.stringify(t).includes("{link_subskrypcji}");

async function wyslijWiersz(w: Wiersz, r: Rozsylka, k: KlientR | undefined, linki: Map<string, string>): Promise<Skutek> {
  const mkt = r.typ === "marketingowa";
  // a link for a client that is no longer in the base cannot be made (and is not needed: he gets nothing new)
  const link = potrzebnyLink(r.tresc) && k ? await linkKlienta(k.id, "rozsylka:" + r.autor, linki) : "";
  const d = daneKlienta(k, w.nazwa, link);
  if (w.kanal === "bot") {
    const s = (await czytaj(`klient_subskrypcje?select=id,aktywna,blocked_at,zgoda_marketing,jezyk,chat_id&id=eq.${w.subskrypcja}`))[0];
    if (!s || !s.aktywna || s.blocked_at) return { s: "pominieto", powod: "subskrypcja została wyłączona przed wysyłką" };
    if (mkt && !s.zgoda_marketing) return { s: "pominieto", powod: "zgoda marketingowa została wycofana przed wysyłką" };
    const m = wiadomoscTg(r.tresc, w.jezyk || s.jezyk, d);
    if (!m) return { s: "blad", powod: "brak treści" };
    const o = await wyslijTg("sub", String(s.chat_id), m, w.proby);
    if (o.s === "wyslano") await zmien(`klient_subskrypcje?id=eq.${s.id}`, { last_delivery_at: zal.teraz().toISOString() });
    if (o.s === "blad" && o.zablokowany) await zmien(`klient_subskrypcje?id=eq.${s.id}`, { blocked_at: zal.teraz().toISOString() });
    return o;
  }
  if (w.kanal === "grupa") {
    if (mkt) return { s: "pominieto", powod: "grupa nie może dostać rozsyłki marketingowej" };
    const m = wiadomoscTg(r.tresc, w.jezyk, d);
    return m ? await wyslijTg("grupa", w.adres, m, w.proby) : { s: "blad", powod: "brak treści" };
  }
  if (mkt) { // the consent may have been withdrawn since the list was made
    const z = (await zgody()).get(w.klient);
    if (!(w.kanal === "sms" ? z?.sms : z?.email)) return { s: "pominieto", powod: "zgoda marketingowa została wycofana przed wysyłką" };
  }
  if (w.kanal === "sms") {
    const v = wariantSms(r.tresc, w.jezyk as Any);
    if (!v) return { s: "blad", powod: "brak treści SMS" };
    const o = await wyslijSms({ telefon: w.adres, nazwa: w.nazwa, tresc: wstaw(v.w, d), cel: "rozsylka", ref: r.id, kto: r.autor, mimoCiszy: r.mimo_ciszy });
    if (o.ok) return { s: "wyslano", ref: o.id ?? null, powod: o.test ? "tryb testowy SMS — nic nie zostało doręczone" : null };
    if (o.kod === "cisza") return { s: "pozniej", kiedy: new Date(zal.teraz().getTime() + 30 * 60000), powod: "SMS: poza godzinami wysyłki" };
    if (o.kod === "limit_dzienny" || o.kod === "limit_numer") return { s: "pozniej", kiedy: new Date(zal.teraz().getTime() + 6 * 3600000), powod: "SMS: " + (o.error ?? "limit") };
    if (o.kod === "duplikat") return { s: "pominieto", powod: "SMS: taka sama wiadomość poszła na ten numer chwilę wcześniej" };
    return { s: "blad", powod: "SMS: " + String(o.error ?? o.kod ?? "błąd").slice(0, 200), liczy: o.kod === "dostawca" || o.kod === "baza" || o.kod === "brak_konfiguracji" };
  }
  if (w.kanal === "mail") {
    const v = wariantMail(r.tresc, w.jezyk as Any);
    if (!v) return { s: "blad", powod: "brak treści e-maila" };
    if (!SMTP_PASS) return { s: "blad", powod: "poczta nie jest skonfigurowana (brak SMTP_PASS)", liczy: true };
    try {
      const id = await zal.poczta({ to: w.adres, subject: wstaw(v.w.temat, d).slice(0, 200), text: wstaw(v.w.tresc, d) });
      return { s: "wyslano", ref: id.slice(0, 120) || null };
    } catch (e) {
      const kod = String((e as Any)?.responseCode ?? (e as Any)?.code ?? "").slice(0, 20);
      return { s: "blad", powod: "e-mail: serwer pocztowy odrzucił wiadomość" + (kod ? " (" + kod + ")" : ""), liczy: true };
    }
  }
  return { s: "blad", powod: "nieznany kanał" };
}

// ---------------------------------------------------------------- the queue
// One run: starts the broadcasts that are due, takes a small batch of queued rows, sends them one by one
// with a pause in between, writes each result at once (so a run that dies loses at most one row — and
// that row becomes 'niepewny', never a second message), stops a broadcast after too many errors in a row.
export async function kolejka(o: { budzetMs?: number } = {}): Promise<Any> {
  const ust = await ustawienia(), start = zal.teraz(), iso = (d: Date) => d.toISOString();
  const wynik: Any = { uruchomione: 0, pobrane: 0, wyslano: 0, bledy: 0, pominieto: 0, pozniej: 0, niepewne: 0, zakonczone: 0, wstrzymane: [] as string[], cisza: false };
  const due = await db(`rozsylki?status=eq.zaplanowana&or=(zaplanowana_na.is.null,zaplanowana_na.lte.${enc(iso(start))})`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "w_trakcie", start_at: iso(start), bledy_z_rzedu: 0, powod: null }) });
  if (due.ok) wynik.uruchomione = (await due.json()).length;
  wynik.cisza = !wGodzinach(start, ust.godziny);
  const wiersze: Wiersz[] = await rpc("rozsylka_pobierz", { p_limit: ileWPrzebiegu(ust, o.budzetMs ?? 45000), p_cisza: wynik.cisza });
  wynik.pobrane = wiersze.length;
  if (wiersze.length) {
    const kl = new Map((await klienci()).map((k) => [k.id, k])), linki = new Map<string, string>(), stop = new Set<string>();
    let tgCzeka: Date | null = null, pierwsza = true;
    const oddaj = (w: Wiersz, kiedy?: Date) => zmien(`rozsylka_odbiorcy?id=eq.${w.id}`, { status: "kolejka", ...(kiedy ? { nastepna_proba: iso(kiedy) } : {}) });
    for (const w of wiersze) {
      const tele = w.kanal === "bot" || w.kanal === "grupa";
      const r: Rozsylka | undefined = stop.has(w.rozsylka) ? undefined : (await czytaj(`rozsylki?select=id,tytul,typ,status,tresc,autor,bledy_z_rzedu,mimo_ciszy&id=eq.${w.rozsylka}`))[0];
      if (!r || r.status !== "w_trakcie") { await oddaj(w); continue; }       // paused or cancelled meanwhile
      if (tele && tgCzeka) { await oddaj(w, tgCzeka); wynik.pozniej++; continue; }
      if (zal.teraz().getTime() - start.getTime() > (o.budzetMs ?? 45000)) { await oddaj(w); continue; }
      if (!pierwsza) await zal.spij(ust.odstep_ms);
      pierwsza = false;
      let s: Skutek;
      try { s = await wyslijWiersz(w, r, kl.get(w.klient), linki); }
      catch (_e) { s = { s: "niepewny", powod: "błąd w trakcie wysyłania — nie wiadomo, czy wiadomość wyszła", liczy: true }; }
      const teraz = zal.teraz();
      let bledy = r.bledy_z_rzedu;
      if (s.s === "wyslano") {
        await zmien(`rozsylka_odbiorcy?id=eq.${w.id}`, { status: "wyslano", wyslano_at: iso(teraz), tg_message_id: s.message_id ?? null, ref: s.ref ?? null, powod: s.powod ?? null, proby: w.proby + 1 });
        wynik.wyslano++; bledy = 0;
      } else if (s.s === "pozniej") {
        const dosc = w.proby + 1 >= ust.max_prob;
        await zmien(`rozsylka_odbiorcy?id=eq.${w.id}`, dosc ? { status: "blad", powod: "nie udało się po " + (w.proby + 1) + " próbach: " + s.powod, proby: w.proby + 1 } : { status: "kolejka", nastepna_proba: iso(s.kiedy), powod: s.powod, proby: w.proby + 1 });
        if (dosc) wynik.bledy++; else wynik.pozniej++;
        if (s.liczy) bledy++;
        if (s.limit) { tgCzeka = s.kiedy; await zmien("rozsylki?status=eq.w_trakcie", { wstrzymana_do: iso(s.kiedy) }); } // Telegram's limit is the bot's, not the broadcast's
      } else if (s.s === "stop") {
        await oddaj(w);
        await zmien(`rozsylki?id=eq.${r.id}`, { status: "wstrzymana", powod: s.powod });
        stop.add(r.id); wynik.wstrzymane.push(r.id);
        continue;
      } else {
        await zmien(`rozsylka_odbiorcy?id=eq.${w.id}`, { status: s.s, powod: s.powod.slice(0, 400), proby: w.proby + 1 });
        if (s.s === "pominieto") wynik.pominieto++; else if (s.s === "niepewny") wynik.niepewne++; else wynik.bledy++;
        if (s.liczy) bledy++;
      }
      if (bledy !== r.bledy_z_rzedu) {
        const za_duzo = bledy >= ust.stop_po_bledach;
        await zmien(`rozsylki?id=eq.${r.id}`, za_duzo ? { bledy_z_rzedu: bledy, status: "wstrzymana", powod: `zatrzymana automatycznie po ${bledy} błędach z rzędu` } : { bledy_z_rzedu: bledy });
        if (za_duzo) { stop.add(r.id); wynik.wstrzymane.push(r.id); }
      }
    }
  }
  // a running broadcast with nothing left to send is finished
  for (const r of await czytaj("rozsylki?select=id&status=eq.w_trakcie")) {
    const zostalo = await db(`rozsylka_odbiorcy?select=id&rozsylka=eq.${r.id}&status=in.(kolejka,wysylanie)`, { headers: { Prefer: "count=exact", Range: "0-0" } });
    if (zostalo.ok && (Number((zostalo.headers.get("content-range") ?? "/1").split("/")[1]) || 0) === 0) {
      await zmien(`rozsylki?id=eq.${r.id}&status=eq.w_trakcie`, { status: "zakonczona", koniec_at: iso(zal.teraz()) });
      wynik.zakonczone++;
    }
  }
  return wynik;
}
