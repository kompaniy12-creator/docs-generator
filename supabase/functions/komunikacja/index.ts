// Komunikacja z klientami: subskrypcje bota Telegram i rozsyłki. Page rozsylka.html.
// PORTAL ONLY (JWT with app_metadata.portal === true; sections Kadry or Księgowość, or an administrator),
// except `kolejka`, which the scheduler calls with the header x-cron-key. POST { action, ... }:
//
//   status                                 who I am, what is configured, settings, the bot's name
//   bot_status            ADMIN, read-only getMe + getWebhookInfo of the subscription bot (and of the bot that
//                                          posts to groups, when it is a different one) + what it means
//   webhook_ustaw         ADMIN            without { wykonaj: true, potwierdz: "USTAW @<bot>" } only describes the
//   webhook_usun          ADMIN            call; with them calls setWebhook / deleteWebhook. Refuses to touch a
//                                          bot whose webhook belongs to another system.
//   ustawienia            ADMIN            { ustawienia }
//   klienci                                clients with what each of them can be reached by (no contact data)
//   zaproszenie { klient, rotuj? }         the client's link + a ready instruction in pl/ru/uk
//   zaproszenie_moje                       my own link — to receive test messages
//   subskrybenci { klient? }               subscribers (without Telegram ids)
//   subskrybent { id, rola? | wylacz? | zgoda? }   label / switch off / record a marketing consent
//   zgoda { klient, kanal: sms|email, zgoda, zrodlo, data }    marketing consent of a client for SMS / e-mail
//   grupa_flaga { klient, dozwolona }  ADMIN   may automatic notices still go to this client's group
//   szablony | szablon_zapisz | szablon_usun      segmenty | segment_zapisz | segment_usun
//   lista | pobierz { id } | zapisz { id?, rozsylka }           drafts
//   podglad { rozsylka, klient }           the message as this client would get it, per language
//   odbiorcy { rozsylka }                  who gets it through which channel, who is skipped and why
//   test { id, klient?, telefon? }         to the author only: his own bot chat, phone, e-mail
//   zglos { id, potwierdzenie, zaplanowana_na?, mimo_ciszy? }   freeze the list; -> do_akceptacji or zaplanowana
//   akceptuj { id, potwierdzenie } ADMIN | odrzuc { id, powod } ADMIN | cofnij { id }
//   wstrzymaj | wznow | anuluj { id }      ponow_niepewne { id } ADMIN
//   dziennik { id, strona?, status?, kanal? } | csv { id }
//   kolejka                                x-cron-key or ADMIN: one run of the queue
//
// Nothing is sent before: a test message for exactly this content, a confirmation that repeats the numbers
// per channel (and the title typed for more than 20 recipients) and — above the threshold, for groups and
// for marketing — the approval of an administrator other than the author.

import { maska as maskaSms } from "../sms/logic.ts";
import { smsSkonfigurowane, ustawieniaSms, wyslijSms } from "../sms/wyslij.ts";
import {
  botUsername, czytaj, daneKlienta, db, enc, klienci, kolejka, konfiguracja, rpc, SUB_KOL, subskrypcje, tg, UPDATES, ustawienia, WEBHOOK_SECRET, WEBHOOK_URL, wiadomoscTg,
  wyslijTg, zal, zaproszenie, zgody, zmien,
} from "./core.ts";
import {
  akceptacja, csv, czyscOdbiorcow, czyscTresc, escHtml, instrukcja, type Ja, JEZYKI, type Jezyk, kanalyStrategii, klawiatura, type KlientR, maska, odcisk, type Plan, potwierdzenie, powodyAkceptacji,
  PROG_TYTUL, rozwiaz, smsInfo, sprawdzUst, staleRowne, STRATEGIE, szablonKoniecGrup, tekst, wariantMail, wariantSms, wstaw, wybierz,
} from "./logic.ts";
import { wGodzinach } from "../sms/logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_KEY = Deno.env.get("CRON_KEY") ?? "";

// deno-lint-ignore no-explicit-any
type Any = any;
function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
type Osoba = Ja & { moze: boolean };
async function portal(req: Request): Promise<Osoba | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (m.portal !== true || !u.email) return null;
  const admin = m.portal_admin === true, wszystko = admin || !Array.isArray(m.portal_sections);
  return { email: String(u.email).toLowerCase(), admin, moze: wszystko || m.portal_sections.includes("kadry") || m.portal_sections.includes("onboarding") };
}
// administrators other than this person (for the four-eyes rule)
async function inniAdmini(email: string): Promise<number> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  if (!r.ok) return 1; // when the list cannot be read, assume there is somebody else: no self-approval
  const d = await r.json();
  return (d.users ?? d ?? []).filter((u: Any) => u?.app_metadata?.portal === true && u.app_metadata.portal_admin === true && String(u.email ?? "").toLowerCase() !== email).length;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const okKlient = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && (/^\d{10}$/.test(v) || /^nazwa:.+/.test(v));
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const KOL = "id,created_at,updated_at,autor,tytul,typ,status,tresc,kanaly,strategia,odbiorcy,tresc_hash,test,liczba,zgloszono_at,akceptowal,akceptowano_at,samoakceptacja,zaplanowana_na,mimo_ciszy,start_at,koniec_at,wstrzymana_do,bledy_z_rzedu,powod";

// A draft as sent by the page -> what is stored. Nothing here is trusted: every text goes through the
// builder's cleaning, every link through urlOk.
function czyscRozsylke(b: Any, ja: Osoba): { ok: true; r: Any } | { ok: false; error: string } {
  const tytul = String(b?.tytul ?? "").replace(/\s+/g, " ").trim();
  if (tytul.length < 3 || tytul.length > 200) return { ok: false, error: "Podaj tytuł rozsyłki (3–200 znaków) — jest tylko dla biura." };
  const typ = b?.typ === "marketingowa" ? "marketingowa" : "serwisowa";
  const strategia = STRATEGIE.includes(b?.strategia) ? b.strategia : "bot";
  const kanaly = kanalyStrategii(strategia, b?.kanaly);
  if (!Object.values(kanaly).some(Boolean)) return { ok: false, error: "Wybierz co najmniej jeden kanał." };
  if (kanaly.grupa && !ja.admin) return { ok: false, error: "Wysyłkę do grup klientów może przygotować tylko administrator." };
  if (kanaly.grupa && typ === "marketingowa") return { ok: false, error: "Rozsyłka marketingowa nie może iść do grup klientów." };
  const t = czyscTresc(b?.tresc);
  if (!t.ok) return t;
  return { ok: true, r: { tytul, typ, strategia, kanaly, tresc: t.tresc, odbiorcy: czyscOdbiorcow(b?.odbiorcy) } };
}
async function plan(r: Any): Promise<{ plan: Plan; kl: KlientR[] }> {
  const [kl, s, z] = await Promise.all([klienci(), subskrypcje(), zgody()]);
  return { plan: rozwiaz(wybierz(kl, s.poKliencie, r.odbiorcy), s.poKliencie, z, r), kl };
}
async function rozsylka(id: unknown): Promise<Any | null> {
  return UUID.test(String(id ?? "")) ? (await czytaj(`rozsylki?select=${KOL}&id=eq.${id}`))[0] ?? null : null;
}
async function liczbyZBazy(id: string): Promise<{ liczby: Plan["liczby"]; statusy: Record<string, number> }> {
  const rows = await czytaj(`rozsylka_odbiorcy?select=kanal,status,klient&rozsylka=eq.${id}&limit=20000`);
  const liczby = { bot: 0, grupa: 0, sms: 0, mail: 0, brak: 0, klienci: 0 }, statusy: Record<string, number> = {}, kl = new Set<string>();
  for (const x of rows) { liczby[x.kanal as "bot"]++; statusy[x.status] = (statusy[x.status] ?? 0) + 1; if (x.kanal !== "brak") kl.add(x.klient); }
  liczby.klienci = kl.size;
  return { liczby, statusy };
}

async function jedenBot(k: "sub" | "grupa") {
  const me = await tg(k, "getMe"), wh = await tg(k, "getWebhookInfo");
  if (!me.dane?.ok) return { ok: false, blad: me.siec ? "Brak połączenia z Telegramem." : String(me.dane?.description ?? "Telegram nie odpowiedział.").slice(0, 120) };
  const m = me.dane.result, w = wh.dane?.result ?? {};
  let host: string | null = null;
  try { host = w.url ? new URL(w.url).host : null; } catch { host = "?"; }
  return {
    ok: true, id: m.id, username: m.username, name: m.first_name, can_join_groups: m.can_join_groups === true, can_read_all_group_messages: m.can_read_all_group_messages === true,
    webhook: {
      // only the host of a foreign webhook is shown: its path may carry that system's secret
      ustawiony: !!w.url, nasz: w.url === WEBHOOK_URL, host, pending_update_count: w.pending_update_count ?? null,
      last_error_date: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : null, last_error_message: w.last_error_message ? String(w.last_error_message).slice(0, 200) : null,
      allowed_updates: w.allowed_updates ?? null, max_connections: w.max_connections ?? null,
    },
  };
}
function wniosek(b: Any, osobny: boolean): string {
  if (!b.ok) return "Nie udało się odczytać bota: " + b.blad;
  if (b.webhook.nasz) return "Webhook tego bota wskazuje na portal — subskrypcje działają." + (b.webhook.last_error_message ? " Ostatni błąd doręczenia: " + b.webhook.last_error_message : "");
  if (b.webhook.ustawiony) return `STOP: bot @${b.username} ma webhook innego systemu (${b.webhook.host}). Nie wolno go przejmować — ten system przestałby działać. Potrzebny jest NOWY bot do subskrypcji: właściciel tworzy go w BotFather, a token trafia do sekretu KLIENT_BOT_TOKEN.`;
  return `Bot @${b.username} nie ma webhooka. Jeśli jakiś inny program odpytuje go metodą getUpdates (np. bot „Twój księgowy”), ustawienie webhooka ten program zatrzyma — z zewnątrz nie da się tego sprawdzić. Oczekujące aktualizacje: ${b.webhook.pending_update_count ?? "?"} (gdy ta liczba rośnie po napisaniu do bota i sama nie spada, nikt go nie odpytuje). `
    + (osobny ? "To jest osobny bot (KLIENT_BOT_TOKEN) — można ustawić webhook." : "To jest bot z TELEGRAM_BOT_TOKEN: zanim ustawisz webhook, potwierdź u właściciela, że nic innego go nie używa; w razie wątpliwości załóż osobnego bota (KLIENT_BOT_TOKEN).");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  let body: Any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }
  const action = String(body?.action ?? "");
  const cron = CRON_KEY.length >= 16 && staleRowne(req.headers.get("x-cron-key") ?? "", CRON_KEY);
  if (cron) {
    if (action !== "kolejka") return json({ error: "Nieznana akcja." }, 400, origin);
    try { return json(await kolejka(), 200, origin); } catch (e) { console.error("komunikacja kolejka", String((e as Error)?.message ?? "").slice(0, 150)); return json({ error: "Błąd kolejki." }, 500, origin); }
  }
  const ja = await portal(req);
  if (!ja) return json({ error: "Brak dostępu (portal)." }, 403, origin);
  if (!ja.moze) return json({ error: "Rozsyłki są dostępne dla sekcji Kadry i Księgowość." }, 403, origin);
  const tylkoAdmin = () => json({ error: "Tę czynność może wykonać tylko administrator portalu." }, 403, origin);
  const blad = (error: string, s = 400) => json({ error }, s, origin);
  const teraz = zal.teraz();

  try {
    // ------------------------------------------------------------ configuration
    if (action === "status") {
      const ust = await ustawienia(), k = konfiguracja();
      const brak = [!k.bot && "TELEGRAM_BOT_TOKEN lub KLIENT_BOT_TOKEN", !k.sekret_linkow && "KOMUNIKACJA_SECRET", !k.sekret_webhooka && "TG_WEBHOOK_SECRET"].filter(Boolean);
      const sms = await ustawieniaSms().catch(() => null);
      return json({
        ja: { email: ja.email, admin: ja.admin }, konfiguracja: k, brak, bot: k.bot ? await botUsername() : "", ustawienia: ust, w_godzinach: wGodzinach(teraz, ust.godziny),
        sms: { skonfigurowane: smsSkonfigurowane(), tryb: sms?.wlaczone && smsSkonfigurowane() ? "rzeczywisty" : "test", normalizuj: sms?.normalizuj ?? true }, prog_tytul: PROG_TYTUL,
      }, 200, origin);
    }
    if (action === "bot_status") {
      if (!ja.admin) return tylkoAdmin();
      const k = konfiguracja(), sub: Any = await jedenBot("sub");
      const out: Any = { konfiguracja: k, nasz_webhook: WEBHOOK_URL, subskrypcje: sub, wniosek: wniosek(sub, k.osobny_bot) };
      if (k.osobny_bot) out.grupy = await jedenBot("grupa");
      if (sub.ok) await db("portal_ustawienia", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "komunikacja_bot", value: { id: sub.id, username: sub.username, sprawdzono: teraz.toISOString(), kto: ja.email }, updated_at: teraz.toISOString() }) });
      return json(out, 200, origin);
    }
    if (action === "webhook_ustaw" || action === "webhook_usun") {
      if (!ja.admin) return tylkoAdmin();
      const k = konfiguracja(), b: Any = await jedenBot("sub");
      if (!b.ok) return blad("Nie udało się odczytać bota: " + b.blad, 502);
      const ustaw = action === "webhook_ustaw", haslo = (ustaw ? "USTAW @" : "USUN @") + b.username;
      const opis = ustaw
        ? { metoda: "setWebhook", bot: "@" + b.username, url: WEBHOOK_URL, allowed_updates: UPDATES, secret_token: "wartość sekretu TG_WEBHOOK_SECRET (nie jest pokazywana)", drop_pending_updates: false, max_connections: 4 }
        : { metoda: "deleteWebhook", bot: "@" + b.username, drop_pending_updates: false };
      const przeszkody: string[] = [];
      if (ustaw && !k.sekret_webhooka) przeszkody.push("Brak sekretu TG_WEBHOOK_SECRET (co najmniej 24 znaki).");
      if (ustaw && !k.sekret_linkow) przeszkody.push("Brak sekretu KOMUNIKACJA_SECRET (co najmniej 32 znaki) — linki zaproszeń nie będą działać.");
      if (b.webhook.ustawiony && !b.webhook.nasz) przeszkody.push(`Bot ma webhook innego systemu (${b.webhook.host}) — portal go nie ruszy. Użyj osobnego bota (KLIENT_BOT_TOKEN).`);
      if (!ustaw && !b.webhook.ustawiony) przeszkody.push("Ten bot nie ma webhooka.");
      const skutek = ustaw
        ? "Telegram zacznie przekazywać portalowi wiadomości pisane do tego bota. Każdy inny program, który odpytuje tego bota (getUpdates), przestanie dostawać aktualizacje. Lista ostatnich czatów w Kontrola → Powiadomienia (funkcja powiadom, akcja „chats”) przestanie działać dla tego bota."
        : "Bot przestanie przyjmować /start, /stop i wybór języka; wysyłka wiadomości działa dalej.";
      if (przeszkody.length || body.wykonaj !== true || body.potwierdz !== haslo) return json({ sucho: true, wykonano: false, opis, skutek, przeszkody, potwierdz: haslo, webhook: b.webhook }, 200, origin);
      const w = ustaw
        ? await tg("sub", "setWebhook", { url: WEBHOOK_URL, secret_token: WEBHOOK_SECRET, allowed_updates: UPDATES, drop_pending_updates: false, max_connections: 4 })
        : await tg("sub", "deleteWebhook", { drop_pending_updates: false });
      console.log("komunikacja", action, ja.email, "wynik:", w.dane?.ok === true);
      return json({ sucho: false, wykonano: w.dane?.ok === true, opis, blad: w.dane?.ok ? null : String(w.dane?.description ?? "Telegram nie odpowiedział.").slice(0, 200) }, 200, origin);
    }
    if (action === "ustawienia") {
      if (!ja.admin) return tylkoAdmin();
      const s = sprawdzUst(body.ustawienia);
      if (!s.ok) return blad(s.error);
      const r = await db("portal_ustawienia", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "komunikacja", value: { ...s.ust, by: ja.email }, updated_at: teraz.toISOString() }) });
      if (!r.ok) return blad("Nie udało się zapisać ustawień.", 500);
      return json({ ok: true, ustawienia: { ...s.ust, by: ja.email } }, 200, origin);
    }

    // ------------------------------------------------------------ clients, links, subscribers, consents
    if (action === "klienci") {
      const [kl, s, z, flagi] = await Promise.all([klienci(), subskrypcje(), zgody(), czytaj("klient_komunikacja?select=klient,grupa_dozwolona")]);
      const fl = new Map(flagi.map((f: Any) => [f.klient, f.grupa_dozwolona === true]));
      return json({
        klienci: kl.map((k) => {
          const su = s.poKliencie.get(k.id) ?? [];
          return {
            id: k.id, nip: k.nip, nazwa: k.nazwa, forma: k.forma, opodatkowanie: k.opodatkowanie, miasto: k.miasto, opiekun: k.opiekun, kadrowy: k.kadrowy, jezyk: k.jezyk, status: k.status, obslugiwany: k.obslugiwany,
            zakres_ksiegowosc: k.zakres_ksiegowosc, zakres_kadry: k.zakres_kadry, grupa: !!k.grupa, telefon: !!k.telefon, email: !!k.email,
            sub: su.filter((x) => x.aktywna && !x.blocked_at).length, sub_wyl: su.filter((x) => !x.aktywna || x.blocked_at).length, sub_zgoda: su.filter((x) => x.aktywna && !x.blocked_at && x.zgoda_marketing).length,
            zgoda_sms: z.get(k.id)?.sms === true, zgoda_email: z.get(k.id)?.email === true, grupa_dozwolona: fl.get(k.id) === true,
          };
        }),
      }, 200, origin);
    }
    if (action === "zaproszenie" || action === "zaproszenie_moje") {
      const k = konfiguracja();
      if (!k.bot || !k.sekret_linkow) return blad("Bot nie jest jeszcze skonfigurowany (token bota i sekret KOMUNIKACJA_SECRET).");
      if (action === "zaproszenie_moje") {
        const z = await zaproszenie({ pracownik: ja.email, kto: ja.email, rotuj: body.rotuj === true });
        if (!z) return blad("Nie udało się odczytać nazwy bota z Telegrama.", 502);
        const mam = (await czytaj(`klient_subskrypcje?select=id&pracownik=eq.${enc(ja.email)}&aktywna=is.true&blocked_at=is.null&limit=1`)).length > 0;
        return json({ ...z, polaczone: mam }, 200, origin);
      }
      if (!okKlient(body.klient)) return blad("Wybierz klienta.");
      const kl = (await klienci()).find((x) => x.id === body.klient);
      if (!kl) return blad("Nie ma takiego klienta w bazie klientów.", 404);
      const z = await zaproszenie({ klient: kl.id, kto: ja.email, rotuj: body.rotuj === true });
      if (!z) return blad("Nie udało się odczytać nazwy bota z Telegrama.", 502);
      if (body.rotuj === true) console.log("komunikacja zaproszenie: nowy link", ja.email);
      return json({ ...z, klient: kl.id, nazwa: kl.nazwa, jezyk: kl.jezyk, instrukcja: instrukcja(kl.nazwa, z.link) }, 200, origin);
    }
    if (action === "subskrybenci") {
      const s = await subskrypcje();
      const rows = s.wszystkie.filter((x) => body.klient ? x.klient === body.klient : !!x.klient).map(({ chat_id: _c, tg_user_id: _u, zaproszenie: _z, ...x }) => x); // Telegram ids stay on the server
      return json({ subskrybenci: rows, kolumny: SUB_KOL.split(",").filter((c) => c !== "chat_id") }, 200, origin);
    }
    if (action === "subskrybent") {
      if (!UUID.test(String(body.id ?? ""))) return blad("Nie ma takiej subskrypcji.");
      const s = (await czytaj(`klient_subskrypcje?select=id,klient,aktywna&id=eq.${body.id}`))[0];
      if (!s || !s.klient) return blad("Nie ma takiej subskrypcji.", 404);
      const pola: Any = {};
      if (body.rola !== undefined) { if (![null, "wlasciciel", "ksiegowy", "inna"].includes(body.rola)) return blad("Nieznana rola."); pola.rola = body.rola; }
      if (body.wylacz === true) Object.assign(pola, { aktywna: false, unsubscribed_at: teraz.toISOString(), wylaczyl: ja.email });
      if (body.zgoda !== undefined) {
        const zrodlo = String(body.zgoda?.zrodlo ?? "").trim();
        if (typeof body.zgoda?.zgoda !== "boolean" || zrodlo.length < 3 || zrodlo.length > 300 || !isDate(body.zgoda?.data) || body.zgoda.data > teraz.toISOString().slice(0, 10)) return blad("Zgoda: podaj źródło (np. „umowa § 9”, „e-mail z 2026-10-01”) i datę nie późniejszą niż dziś.");
        const r = await db("klient_zgody", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ klient: s.klient, kanal: "telegram", subskrypcja: s.id, zgoda: body.zgoda.zgoda, zrodlo, data: body.zgoda.data, kto: ja.email }) });
        if (!r.ok) return blad("Nie udało się zapisać zgody.", 500);
        Object.assign(pola, { zgoda_marketing: body.zgoda.zgoda, zgoda_at: teraz.toISOString(), zgoda_zrodlo: zrodlo, zgoda_kto: ja.email });
      }
      if (!Object.keys(pola).length) return blad("Nic do zmiany.");
      if (!(await zmien(`klient_subskrypcje?id=eq.${s.id}`, pola))) return blad("Nie udało się zapisać.", 500);
      return json({ ok: true }, 200, origin);
    }
    if (action === "zgoda") {
      const zrodlo = String(body.zrodlo ?? "").trim();
      if (!okKlient(body.klient) || !["sms", "email"].includes(body.kanal) || typeof body.zgoda !== "boolean") return blad("Podaj klienta, kanał i decyzję.");
      if (zrodlo.length < 3 || zrodlo.length > 300 || !isDate(body.data) || body.data > teraz.toISOString().slice(0, 10)) return blad("Podaj źródło zgody (np. „umowa § 9”) i datę nie późniejszą niż dziś.");
      if (!(await klienci()).some((k) => k.id === body.klient)) return blad("Nie ma takiego klienta w bazie klientów.", 404);
      const r = await db("klient_zgody", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ klient: body.klient, kanal: body.kanal, zgoda: body.zgoda, zrodlo, data: body.data, kto: ja.email }) });
      return r.ok ? json({ ok: true }, 200, origin) : blad("Nie udało się zapisać zgody.", 500);
    }
    if (action === "grupa_flaga") {
      if (!ja.admin) return tylkoAdmin();
      if (!okKlient(body.klient) || typeof body.dozwolona !== "boolean") return blad("Podaj klienta i decyzję.");
      const r = await db("klient_komunikacja", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ klient: body.klient, grupa_dozwolona: body.dozwolona, zmienil: ja.email, zmieniono_at: teraz.toISOString() }) });
      return r.ok ? json({ ok: true }, 200, origin) : blad("Nie udało się zapisać (czy klient jest w bazie klientów?).", 400);
    }

    // ------------------------------------------------------------ templates and segments
    if (action === "szablony") {
      const ust = await ustawienia(), data = isDate(body.data) ? body.data : ust.koniec_grup;
      const wb = szablonKoniecGrup(data);
      return json({ szablony: [{ id: "wbudowany:koniec_grup", wbudowany: true, autor: null, data, ...wb }, ...await czytaj("rozsylka_szablony?select=id,created_at,autor,nazwa,typ,tresc&order=nazwa.asc&limit=200")] }, 200, origin);
    }
    if (action === "szablon_zapisz") {
      const nazwa = String(body.nazwa ?? "").trim(), t = czyscTresc(body.tresc);
      if (!nazwa || nazwa.length > 120) return blad("Podaj nazwę szablonu.");
      if (!t.ok) return blad(t.error);
      const r = await db("rozsylka_szablony", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ autor: ja.email, nazwa, typ: body.typ === "marketingowa" ? "marketingowa" : "serwisowa", tresc: t.tresc }) });
      return r.ok ? json({ ok: true, id: (await r.json())[0]?.id }, 200, origin) : blad("Nie udało się zapisać szablonu.", 500);
    }
    if (action === "segmenty") return json({ segmenty: await czytaj("rozsylka_segmenty?select=id,created_at,autor,nazwa,odbiorcy&order=nazwa.asc&limit=200") }, 200, origin);
    if (action === "segment_zapisz") {
      const nazwa = String(body.nazwa ?? "").trim();
      if (!nazwa || nazwa.length > 120) return blad("Podaj nazwę segmentu.");
      const r = await db("rozsylka_segmenty", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ autor: ja.email, nazwa, odbiorcy: czyscOdbiorcow(body.odbiorcy) }) });
      return r.ok ? json({ ok: true, id: (await r.json())[0]?.id }, 200, origin) : blad("Nie udało się zapisać segmentu.", 500);
    }
    if (action === "szablon_usun" || action === "segment_usun") {
      const tab = action === "szablon_usun" ? "rozsylka_szablony" : "rozsylka_segmenty";
      if (!UUID.test(String(body.id ?? ""))) return blad("Nie ma takiej pozycji.");
      const w = (await czytaj(`${tab}?select=id,autor&id=eq.${body.id}`))[0];
      if (!w) return blad("Nie ma takiej pozycji.", 404);
      if (!ja.admin && w.autor !== ja.email) return blad("Usunąć może autor albo administrator.", 403);
      const r = await db(`${tab}?id=eq.${w.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return r.ok ? json({ ok: true }, 200, origin) : blad("Nie udało się usunąć.", 500);
    }

    // ------------------------------------------------------------ drafts
    if (action === "lista") {
      const rows = await czytaj("rozsylki?select=id,created_at,autor,tytul,typ,status,strategia,kanaly,liczba,zaplanowana_na,start_at,koniec_at,akceptowal,powod&order=created_at.desc&limit=100");
      const ids = rows.map((r: Any) => r.id), st = new Map<string, Record<string, number>>();
      if (ids.length) for (const o of await czytaj(`rozsylka_odbiorcy?select=rozsylka,status&rozsylka=in.(${ids.join(",")})&kanal=neq.brak&limit=50000`)) { const m = st.get(o.rozsylka) ?? {}; m[o.status] = (m[o.status] ?? 0) + 1; st.set(o.rozsylka, m); }
      return json({ rozsylki: rows.map((r: Any) => ({ ...r, statusy: st.get(r.id) ?? {} })) }, 200, origin);
    }
    if (action === "pobierz") {
      const r = await rozsylka(body.id);
      if (!r) return blad("Nie ma takiej rozsyłki.", 404);
      const zamrozona = r.status !== "szkic";
      return json({ rozsylka: r, ...(zamrozona ? await liczbyZBazy(r.id) : {}), aktualny_test: !!r.test && r.test.hash === await odcisk(r) }, 200, origin);
    }
    if (action === "zapisz") {
      const c = czyscRozsylke(body.rozsylka, ja);
      if (!c.ok) return blad(c.error);
      const pola = { ...c.r, tresc_hash: await odcisk(c.r), updated_at: teraz.toISOString() };
      if (body.id) {
        const r = await rozsylka(body.id);
        if (!r) return blad("Nie ma takiej rozsyłki.", 404);
        if (r.status !== "szkic") return blad("Zmieniać można tylko szkic. Cofnij rozsyłkę do szkicu, aby ją poprawić.");
        if (!ja.admin && r.autor !== ja.email) return blad("Szkic może zmienić autor albo administrator.", 403);
        if (!(await zmien(`rozsylki?id=eq.${r.id}&status=eq.szkic`, pola))) return blad("Nie udało się zapisać.", 500);
        return json({ ok: true, id: r.id, aktualny_test: r.test?.hash === pola.tresc_hash }, 200, origin);
      }
      const r = await db("rozsylki", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...pola, autor: ja.email }) });
      if (!r.ok) return blad("Nie udało się zapisać.", 500);
      return json({ ok: true, id: (await r.json())[0]?.id, aktualny_test: false }, 200, origin);
    }
    if (action === "podglad") {
      const c = czyscRozsylke({ tytul: "podgląd", ...body.rozsylka }, { ...ja, admin: true });
      if (!c.ok) return blad(c.error);
      const kl = await klienci(), k = kl.find((x) => x.id === body.klient) ?? kl.find((x) => x.obslugiwany) ?? kl[0];
      const bot = konfiguracja().bot ? await botUsername() : "";
      const link = (k && konfiguracja().sekret_linkow ? (await zaproszenie({ klient: k.id, kto: ja.email, utworz: false }).catch(() => null))?.link : "") || `https://t.me/${bot || "bot"}?start=link-klienta`;
      const d = daneKlienta(k, k?.nazwa ?? "Przykładowa Firma sp. z o.o.", link), t = c.r.tresc, sms = await ustawieniaSms().catch(() => null);
      const jezyki: Any = {};
      for (const j of JEZYKI) {
        const s = t.wspolna ? t.tg.pl : t.tg[j], sm = wariantSms(t, j), ml = wariantMail(t, j);
        jezyki[j] = {
          tg: { segmenty: s.map((x: Any) => ({ t: wstaw(x.t, d), b: x.b === true, i: x.i === true, link: !!x.url })), przyciski: klawiatura(t, j, d).map((w) => w[0]), znaki: tekst(s, d).length },
          sms: sm ? { jezyk: sm.jezyk, ...smsInfo(wstaw(sm.w, d), sms?.normalizuj ?? true) } : null,
          mail: ml ? { jezyk: ml.jezyk, temat: wstaw(ml.w.temat, d), tresc: wstaw(ml.w.tresc, d) } : null,
        };
      }
      return json({ klient: k ? { id: k.id, nazwa: k.nazwa, jezyk: k.jezyk } : null, jezyki }, 200, origin);
    }
    if (action === "odbiorcy") {
      const c = czyscRozsylke({ tytul: "podgląd", ...body.rozsylka }, ja);
      if (!c.ok) return blad(c.error);
      const p = await plan(c.r), po = new Map<string, Any>(), sms = await ustawieniaSms().catch(() => null);
      let czesci = 0;
      for (const d of p.plan.dostawy) {
        const w = po.get(d.klient) ?? { klient: d.klient, nip: d.nip, nazwa: d.nazwa, kanaly: [], powod: null };
        if (d.kanal === "brak") w.powod = d.powod; else w.kanaly.push({ kanal: d.kanal, jezyk: d.jezyk, adres: maska(d.kanal, d.adres) });
        if (d.kanal === "sms") czesci += smsInfo(wstaw(c.r.tresc.sms[d.jezyk as Jezyk] ?? "", { firma: d.nazwa, link_subskrypcji: "https://t.me/" + "x".repeat(20) + "?start=" + "x".repeat(32) }), sms?.normalizuj ?? true).czesci;
        po.set(d.klient, w);
      }
      const ust = await ustawienia(), razem = p.plan.liczby.bot + p.plan.liczby.grupa + p.plan.liczby.sms + p.plan.liczby.mail;
      return json({
        liczby: p.plan.liczby, wiersze: [...po.values()], sms_czesci: czesci, akceptacja: powodyAkceptacji({ liczba: p.plan.liczby.klienci, grupa: p.plan.liczby.grupa, typ: c.r.typ }, ust.prog_akceptacji),
        minut: Math.ceil(razem / Math.max(1, Math.min(ust.na_przebieg, Math.floor(45000 / ust.odstep_ms)))), tytul_wymagany: razem > PROG_TYTUL,
      }, 200, origin);
    }

    // ------------------------------------------------------------ test, submit, approve
    if (action === "test") {
      const r = await rozsylka(body.id);
      if (!r) return blad("Najpierw zapisz szkic.", 404);
      if (r.status !== "szkic") return blad("Test wysyła się ze szkicu.");
      if (!ja.admin && r.autor !== ja.email) return blad("Test wysyła autor rozsyłki.", 403);
      const kl = await klienci(), k = kl.find((x) => x.id === body.klient) ?? wybierz(kl, (await subskrypcje()).poKliencie, r.odbiorcy)[0] ?? kl[0];
      const link = (k ? (await zaproszenie({ klient: k.id, kto: ja.email, utworz: false }).catch(() => null))?.link : "") || `https://t.me/${await botUsername() || "bot"}?start=link-klienta`;
      const d = daneKlienta(k, k?.nazwa ?? "Przykładowa Firma sp. z o.o.", link), ka = kanalyStrategii(r.strategia, r.kanaly), wyniki: Any = {};
      const naglowek = (j: string) => "<i>" + escHtml(`TEST · ${r.tytul} · wersja ${j} · tak zobaczy to: ${d.firma}`) + "</i>\n\n";
      if (ka.bot || ka.grupa) {
        const moj = (await czytaj(`klient_subskrypcje?select=chat_id&pracownik=eq.${enc(ja.email)}&aktywna=is.true&blocked_at=is.null&limit=1`))[0];
        if (!moj) wyniki.telegram = "Twoje konto Telegram nie jest połączone z botem — otwórz swój link (zakładka Subskrypcje → „Mój link testowy”).";
        else {
          const wersje = r.tresc.wspolna ? ["pl"] : JEZYKI.filter((j) => r.tresc.tg[j]?.some((s: Any) => s.t.trim()));
          const bledy: string[] = [];
          for (let i = 0; i < wersje.length; i++) {
            if (i) await zal.spij(1200);
            const m = wiadomoscTg(r.tresc, wersje[i], d, naglowek(wersje[i]));
            const o = m ? await wyslijTg("sub", String(moj.chat_id), m, 0) : { s: "blad", powod: "brak treści" } as const;
            if (o.s !== "wyslano") bledy.push(wersje[i] + ": " + (o as Any).powod);
          }
          wyniki.telegram = !wersje.length ? "Brak treści Telegram." : bledy.length ? bledy.join("; ") : "ok";
          wyniki.telegram_wersje = wersje;
        }
      }
      if (ka.sms) {
        const v = wariantSms(r.tresc, k?.jezyk ?? "");
        let tel = ja.admin && body.telefon ? String(body.telefon) : "";
        if (!tel) { try { tel = String((await czytaj(`portal_pracownicy?select=telefon&email=eq.${enc(ja.email)}`))[0]?.telefon ?? ""); } catch (_e) { tel = ""; } } // the profiles table may not exist yet
        if (!v) wyniki.sms = "Brak treści SMS.";
        else if (!tel) wyniki.sms = "Brak Twojego numeru telefonu w profilu pracownika (Zespół)" + (ja.admin ? " — wpisz numer do testu." : ".");
        else { const o = await wyslijSms({ telefon: tel, nazwa: "TEST rozsyłki", tresc: wstaw(v.w, d), cel: "test", ref: r.id, kto: ja.email, admin: ja.admin, mimoCiszy: true }); wyniki.sms = o.ok ? "ok" : String(o.error ?? "błąd"); if (o.ok) { wyniki.sms_test = o.test; wyniki.sms_numer = maskaSms(o.telefon ?? ""); } }
      }
      if (ka.mail) {
        const v = wariantMail(r.tresc, k?.jezyk ?? "");
        if (!v) wyniki.mail = "Brak tematu lub treści e-maila.";
        else if (!konfiguracja().poczta) wyniki.mail = "Poczta nie jest skonfigurowana (brak SMTP_PASS).";
        else { try { await zal.poczta({ to: ja.email, subject: "[TEST] " + wstaw(v.w.temat, d).slice(0, 190), text: wstaw(v.w.tresc, d) }); wyniki.mail = "ok"; wyniki.mail_adres = ja.email; } catch (_e) { wyniki.mail = "Serwer pocztowy odrzucił wiadomość."; } }
      }
      const udany = [wyniki.telegram, wyniki.sms, wyniki.mail].includes("ok");
      if (udany) await zmien(`rozsylki?id=eq.${r.id}`, { test: { at: teraz.toISOString(), hash: await odcisk(r), kto: ja.email, wyniki } });
      return json({ ok: udany, wyniki, klient: k ? { id: k.id, nazwa: k.nazwa } : null }, 200, origin);
    }
    if (action === "zglos") {
      const r = await rozsylka(body.id);
      if (!r) return blad("Nie ma takiej rozsyłki.", 404);
      if (r.status !== "szkic") return blad("Ta rozsyłka nie jest już szkicem.");
      if (!ja.admin && r.autor !== ja.email) return blad("Rozsyłkę zgłasza jej autor.", 403);
      if (!r.test || r.test.hash !== await odcisk(r)) return blad("Najpierw „Wyślij test do mnie” — test musi dotyczyć obecnej treści (po każdej zmianie trzeba go powtórzyć).");
      const c = czyscRozsylke(r, { ...ja, admin: true }); // the stored draft, checked once more
      if (!c.ok) return blad(c.error);
      const { plan: p } = await plan(c.r);
      const zle = potwierdzenie(r.tytul, p.liczby, body.potwierdzenie);
      if (zle) return json({ error: zle, liczby: p.liczby }, 409, origin);
      let kiedy: string | null = null;
      if (body.zaplanowana_na) {
        const t = Date.parse(String(body.zaplanowana_na));
        if (isNaN(t) || t < teraz.getTime() - 60000 || t > teraz.getTime() + 60 * 86400000) return blad("Termin wysyłki: od teraz do 60 dni naprzód.");
        kiedy = new Date(t).toISOString();
      }
      if (body.mimo_ciszy === true && !ja.admin) return blad("Wysyłkę poza godzinami może zlecić tylko administrator.", 403);
      const ust = await ustawienia(), powody = powodyAkceptacji({ liczba: p.liczby.klienci, grupa: p.liczby.grupa, typ: r.typ }, ust.prog_akceptacji);
      // the list is frozen here: what is confirmed (and approved) is exactly what the queue will send
      await db(`rozsylka_odbiorcy?rozsylka=eq.${r.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      const wiersze = p.dostawy.map((d) => ({ rozsylka: r.id, klient: d.klient, nip: d.nip || null, nazwa: d.nazwa, kanal: d.kanal, adres: d.adres, subskrypcja: d.subskrypcja, jezyk: d.jezyk, status: d.kanal === "brak" ? "pominieto" : "kolejka", powod: d.powod }));
      const ins = await db("rozsylka_odbiorcy", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(wiersze) });
      if (!ins.ok) return blad("Nie udało się zapisać listy odbiorców — nic nie zostało zaplanowane.", 500);
      const status = powody.length ? "do_akceptacji" : "zaplanowana";
      if (!(await zmien(`rozsylki?id=eq.${r.id}&status=eq.szkic`, { status, liczba: p.liczby.klienci, zgloszono_at: teraz.toISOString(), zaplanowana_na: kiedy, mimo_ciszy: body.mimo_ciszy === true, akceptowal: null, akceptowano_at: null, samoakceptacja: false, powod: null }))) return blad("Nie udało się zgłosić.", 500);
      console.log("komunikacja zglos", status, "klienci:", p.liczby.klienci, "kanały:", p.liczby.bot, p.liczby.grupa, p.liczby.sms, p.liczby.mail);
      return json({ ok: true, status, akceptacja: powody, liczby: p.liczby }, 200, origin);
    }
    if (action === "akceptuj" || action === "odrzuc") {
      if (!ja.admin) return tylkoAdmin();
      const r = await rozsylka(body.id);
      if (!r) return blad("Nie ma takiej rozsyłki.", 404);
      if (r.status !== "do_akceptacji") return blad("Ta rozsyłka nie czeka na akceptację.");
      if (action === "odrzuc") {
        const powod = String(body.powod ?? "").trim().slice(0, 500);
        if (powod.length < 3) return blad("Napisz, co trzeba poprawić.");
        await db(`rozsylka_odbiorcy?rozsylka=eq.${r.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        await zmien(`rozsylki?id=eq.${r.id}&status=eq.do_akceptacji`, { status: "szkic", powod: "Odrzucona przez " + ja.email + ": " + powod });
        return json({ ok: true, status: "szkic" }, 200, origin);
      }
      const a = akceptacja(ja, r.autor, await inniAdmini(ja.email));
      if (!a.ok) return blad(a.error, 403);
      if (r.tresc_hash !== await odcisk(r)) return blad("Treść zmieniła się po zgłoszeniu — cofnij rozsyłkę do szkicu.");
      const { liczby } = await liczbyZBazy(r.id), zle = potwierdzenie(r.tytul, liczby, body.potwierdzenie);
      if (zle) return json({ error: zle, liczby }, 409, origin);
      if (!(await zmien(`rozsylki?id=eq.${r.id}&status=eq.do_akceptacji`, { status: "zaplanowana", akceptowal: ja.email, akceptowano_at: teraz.toISOString(), samoakceptacja: a.sam }))) return blad("Nie udało się zapisać akceptacji.", 500);
      console.log("komunikacja akceptacja", ja.email, a.sam ? "(autor, brak innego administratora)" : "");
      return json({ ok: true, status: "zaplanowana", samoakceptacja: a.sam }, 200, origin);
    }
    if (["cofnij", "wstrzymaj", "wznow", "anuluj", "ponow_niepewne"].includes(action)) {
      const r = await rozsylka(body.id);
      if (!r) return blad("Nie ma takiej rozsyłki.", 404);
      if (!ja.admin && (r.autor !== ja.email || action === "ponow_niepewne")) return blad(action === "ponow_niepewne" ? "Ponowić niepewne wysyłki może tylko administrator." : "To może zrobić autor rozsyłki albo administrator.", 403);
      const na = async (z: string[], pola: Any) => z.includes(r.status) && await zmien(`rozsylki?id=eq.${r.id}&status=eq.${r.status}`, pola);
      if (action === "cofnij") {
        if (!["do_akceptacji", "zaplanowana"].includes(r.status)) return blad("Do szkicu można cofnąć tylko rozsyłkę, która jeszcze nie ruszyła.");
        if (!(await na(["do_akceptacji", "zaplanowana"], { status: "szkic", akceptowal: null, akceptowano_at: null, zaplanowana_na: null }))) return blad("Nie udało się cofnąć.", 500);
        await db(`rozsylka_odbiorcy?rozsylka=eq.${r.id}&status=in.(kolejka,pominieto)`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        return json({ ok: true, status: "szkic" }, 200, origin);
      }
      if (action === "wstrzymaj") return await na(["w_trakcie", "zaplanowana"], { status: "wstrzymana", powod: "wstrzymana przez " + ja.email }) ? json({ ok: true, status: "wstrzymana" }, 200, origin) : blad("Wstrzymać można rozsyłkę zaplanowaną albo w trakcie.");
      if (action === "wznow") {
        if (r.status !== "wstrzymana") return blad("Ta rozsyłka nie jest wstrzymana.");
        if (!r.akceptowal && powodyAkceptacji({ liczba: r.liczba ?? 0, grupa: (await liczbyZBazy(r.id)).liczby.grupa, typ: r.typ }, (await ustawienia()).prog_akceptacji).length) return blad("Ta rozsyłka nie ma akceptacji administratora.");
        const status = r.start_at ? "w_trakcie" : "zaplanowana";
        await zmien(`rozsylki?id=eq.${r.id}&status=eq.wstrzymana`, { status, bledy_z_rzedu: 0, wstrzymana_do: null, powod: null });
        return json({ ok: true, status }, 200, origin);
      }
      if (action === "anuluj") {
        if (["zakonczona", "anulowana"].includes(r.status)) return blad("Ta rozsyłka jest już zakończona.");
        await zmien(`rozsylki?id=eq.${r.id}`, { status: "anulowana", koniec_at: teraz.toISOString(), powod: "anulowana przez " + ja.email });
        await zmien(`rozsylka_odbiorcy?rozsylka=eq.${r.id}&status=eq.kolejka`, { status: "pominieto", powod: "rozsyłka anulowana" });
        return json({ ok: true, status: "anulowana" }, 200, origin);
      }
      // 'niepewny' rows may have reached the recipient: sending again is a person's decision, taken here
      if (!["w_trakcie", "wstrzymana", "zakonczona"].includes(r.status)) return blad("Nie ma czego ponawiać.");
      const p = await db(`rozsylka_odbiorcy?rozsylka=eq.${r.id}&status=eq.niepewny`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "kolejka", nastepna_proba: teraz.toISOString(), powod: "ponowione przez " + ja.email }) });
      const ile = p.ok ? (await p.json()).length : 0;
      if (ile && r.status === "zakonczona") await zmien(`rozsylki?id=eq.${r.id}`, { status: "w_trakcie", koniec_at: null });
      return json({ ok: true, ponowione: ile }, 200, origin);
    }

    // ------------------------------------------------------------ log
    if (action === "dziennik" || action === "csv") {
      const r = await rozsylka(body.id);
      if (!r) return blad("Nie ma takiej rozsyłki.", 404);
      const f: string[] = [];
      if (["kolejka", "wysylanie", "wyslano", "blad", "pominieto", "niepewny"].includes(body.status)) f.push("status=eq." + body.status);
      if (["bot", "grupa", "sms", "mail", "brak"].includes(body.kanal)) f.push("kanal=eq." + body.kanal);
      const kol = "id,klient,nip,nazwa,kanal,adres,jezyk,status,powod,proby,nastepna_proba,wyslano_at,tg_message_id";
      if (action === "csv") {
        const rows = await czytaj(`rozsylka_odbiorcy?select=${kol}&rozsylka=eq.${r.id}&order=nazwa.asc,kanal.asc&limit=20000`);
        const K: Record<string, string> = { bot: "bot (czat prywatny)", grupa: "grupa", sms: "SMS", mail: "e-mail", brak: "nieosiągalny" };
        const S: Record<string, string> = { kolejka: "w kolejce", wysylanie: "w trakcie", wyslano: "wysłano", blad: "błąd", pominieto: "pominięto", niepewny: "niepewne" };
        return json({
          nazwa: "rozsylka-" + r.created_at.slice(0, 10) + ".csv",
          csv: csv([["Rozsyłka", r.tytul], ["Typ", r.typ], ["Status", r.status], [], ["Klient", "NIP", "Kanał", "Adres", "Język", "Status", "Powód", "Próby", "Wysłano", "Id wiadomości Telegram"],
            ...rows.map((x: Any) => [x.nazwa, x.nip ?? "", K[x.kanal] ?? x.kanal, maska(x.kanal, x.adres), x.jezyk ?? "", S[x.status] ?? x.status, x.powod ?? "", x.proby, x.wyslano_at ?? "", x.tg_message_id ?? ""])]),
        }, 200, origin);
      }
      const strona = Math.max(0, Math.min(500, Math.floor(Number(body.strona) || 0))), N = 100;
      const res = await db(`rozsylka_odbiorcy?select=${kol}&rozsylka=eq.${r.id}${f.length ? "&" + f.join("&") : ""}&order=nazwa.asc,kanal.asc`, { headers: { Range: `${strona * N}-${strona * N + N}`, "Range-Unit": "items" } });
      if (!res.ok) return blad("Nie udało się wczytać dziennika.", 502);
      const rows: Any[] = await res.json();
      return json({ wiersze: rows.slice(0, N).map((x) => ({ ...x, adres: maska(x.kanal, x.adres) })), strona, dalej: rows.length > N, ...(await liczbyZBazy(r.id)), status: r.status, powod: r.powod, wstrzymana_do: r.wstrzymana_do }, 200, origin);
    }
    if (action === "kolejka") {
      if (!ja.admin) return tylkoAdmin();
      return json(await kolejka({ budzetMs: 25000 }), 200, origin);
    }
    return blad("Nieznana akcja.");
  } catch (e) {
    console.error("komunikacja", action, String((e as Error)?.message ?? "").slice(0, 200));
    return json({ error: "Błąd serwera — spróbuj ponownie." }, 500, origin);
  }
});
