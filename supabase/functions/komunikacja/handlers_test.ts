// deno test --allow-env --allow-net supabase/functions/komunikacja/handlers_test.ts
// The handlers of `komunikacja` and `tg-bot` run locally: Deno.serve is captured and every outgoing request
// (auth, database, Telegram Bot API, SMSAPI) is answered by an in-memory stand-in; the mail server and the
// pause between messages are replaced too. Nothing leaves the machine: no Telegram message, no SMS, no
// e-mail, and no call to the real bot. Fictional firms, people, chats and numbers only.
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
type Any = any;
const TOK_SUB = "111111:SUB-token-ktorego-nie-wolno-pokazac", TOK_GR = "222222:GRUPA-token-ktorego-nie-wolno-pokazac";
const SEKRETY = [TOK_SUB, TOK_GR, "sekret-linkow-0123456789abcdef0123456789abcdef", "sekret-webhooka-0123456789abcdef", "cron-key-for-tests-0123456789", "smsapi-token-sekretny", "haslo-smtp-sekretne"];
Deno.env.set("SUPABASE_URL", "http://db.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("KLIENT_BOT_TOKEN", TOK_SUB);
Deno.env.set("TELEGRAM_BOT_TOKEN", TOK_GR);
Deno.env.set("KOMUNIKACJA_SECRET", SEKRETY[2]);
Deno.env.set("TG_WEBHOOK_SECRET", SEKRETY[3]);
Deno.env.set("CRON_KEY", SEKRETY[4]);
Deno.env.set("SMSAPI_TOKEN", SEKRETY[5]);
Deno.env.set("SMTP_PASS", SEKRETY[6]);

function nip(base: string): string { const w = [6, 5, 7, 2, 3, 4, 5, 6, 7]; return base + (w.reduce((a, x, i) => a + x * Number(base[i]), 0) % 11); }
const NIPY = Array.from({ length: 40 }, (_x, i) => nip("9990" + String(10000 + i * 11))).filter((n) => n.length === 10).slice(0, 26);
const USERS: Record<string, Any> = {
  admin: { email: "admin@example.test", app_metadata: { portal: true, portal_admin: true } },
  admin2: { email: "admin2@example.test", app_metadata: { portal: true, portal_admin: true } },
  kadry: { email: "kadry@example.test", app_metadata: { portal: true, portal_sections: ["kadry"] } },
  ksieg: { email: "ksieg@example.test", app_metadata: { portal: true, portal_sections: ["onboarding"] } },
  spolka: { email: "spolka@example.test", app_metadata: { portal: true, portal_sections: ["rejestracja"] } },
  obcy: { email: "obcy@example.test", app_metadata: {} },
};
let drugiAdmin = true;
const T: Record<string, Any[]> = {};
let LIM: Record<string, number> = {}, SMSLIM: Record<string, number> = {};
let TERAZ = new Date("2026-10-09T10:00:00Z"); // 12:00 in Warsaw: inside the default sending hours
const tgm = { wywolania: [] as { token: string; metoda: string; body: Any }[], odp: null as null | ((token: string, metoda: string, body: Any) => Response | null), webhook: { url: "" } as Any, nr: 500 };
const smsy: Record<string, string>[] = [], maile: Any[] = [], pauzy: number[] = [], wyjscia: string[] = [];
const J = (b: unknown, s = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...h } });
const SMS_UST = { wlaczone: false, nadawca: "Tw.Ksiegowa", limit_dzienny: 100, limit_na_numer_dziennie: 3, godziny: { od: "00:00", do: "23:59" }, automaty: { terminy: false }, normalizuj: true, zagranica: false, raporty: false };
const JEZ = ["Russian", "Ukrainian", "Polish", ""];

function reset(ilu = 8) {
  for (const k of Object.keys(T)) delete T[k];
  T.portal_klienci = NIPY.slice(0, ilu).map((n, i) => ({ id: n, nip: n, dane: {
    nazwa: `Przykładowa Firma ${i + 1} sp. z o.o.`, nip: n, forma: "spółka z o.o.", adres: "ul. Przykładowa 1, 00-000 Warszawa", opodatkowanie: "CIT", telefon: i === 2 ? "22 123 45 67" : "6001002" + String(10 + i),
    email: i === 3 ? "" : `firma${i + 1}@example.test`, kontakt: "Osoba Testowa " + (i + 1), miasto: "Warszawa", opiekun: "Testowa A.", kadrowy: "", telegram: i === 4 ? "" : "-10010000000" + String(10 + i), jezyk: JEZ[i % 4], poz: i,
  } }));
  T.klienci_baza = T.portal_klienci.map((k) => ({ id: k.id, nip: k.nip, nazwa: k.dane.nazwa, status: "obslugiwany" }));
  T.klienci_obsluga = T.klienci_baza.map((k) => ({ ...k, obslugiwany: true, zakres_ksiegowosc: true, zakres_kadry: false }));
  T.portal_ustawienia = [{ key: "sms", value: SMS_UST, updated_at: TERAZ.toISOString() }];
  T.portal_pracownicy = [{ email: "kadry@example.test", telefon: "600 900 900" }];
  for (const t of ["klient_komunikacja", "klient_zaproszenia_tg", "klient_subskrypcje", "klient_zgody", "tg_updates", "rozsylki", "rozsylka_odbiorcy", "rozsylka_segmenty", "rozsylka_szablony", "sms_wiadomosci"]) T[t] = [];
  LIM = {}; SMSLIM = {}; TERAZ = new Date("2026-10-09T10:00:00Z"); drugiAdmin = true;
  tgm.wywolania = []; tgm.odp = null; tgm.webhook = { url: "" }; smsy.length = 0; maile.length = 0; pauzy.length = 0;
}

function pasuje(row: Any, col: string, expr: string): boolean {
  if (col === "or") return expr.slice(1, -1).split(",").some((c) => { const [k, ...r] = c.split("."); return pasuje(row, k, r.join(".")); });
  const v = row[col];
  const neg = expr.startsWith("not."); if (neg) expr = expr.slice(4);
  const [op, ...rest] = expr.split("."); const arg = rest.join(".");
  const r = op === "eq" ? String(v) === arg : op === "neq" ? String(v) !== arg : op === "is" ? (arg === "null" ? v == null : String(v) === arg)
    : op === "in" ? arg.slice(1, -1).split(",").includes(String(v)) : op === "gte" ? v != null && String(v) >= arg : op === "lte" ? v != null && String(v) <= arg
    : op === "gt" ? v != null && String(v) > arg : op === "lt" ? v != null && String(v) < arg : false;
  return neg ? !r : r;
}
const UNIKAT: Record<string, string[]> = { portal_ustawienia: ["key"], klient_komunikacja: ["klient"], rozsylka_odbiorcy: ["rozsylka", "kanal", "adres"], klient_zaproszenia_tg: ["token_hash"] };
const DOMYSLNE: Record<string, Any> = {
  rozsylki: { status: "szkic", bledy_z_rzedu: 0, mimo_ciszy: false, samoakceptacja: false, test: null, akceptowal: null, start_at: null, wstrzymana_do: null, zaplanowana_na: null, liczba: null, powod: null },
  rozsylka_odbiorcy: { proby: 0, status: "kolejka", tg_message_id: null, wyslano_at: null, pobrano_at: null },
  klient_zaproszenia_tg: { uzycia: 0, revoked_at: null }, klient_subskrypcje: { aktywna: true, blocked_at: null, zgoda_marketing: false, rola: null },
};
// the database functions of komunikacja.sql, restated for the stand-in
const RPC: Record<string, (b: Any) => Any> = {
  tg_update_nowy: (b) => { if (T.tg_updates.some((u) => u.update_id === b.p_id)) return false; T.tg_updates.push({ update_id: b.p_id, at: TERAZ.toISOString() }); return true; },
  tg_limit: (b) => { if ((LIM[b.p_klucz] ?? 0) + 1 > b.p_max) return false; LIM[b.p_klucz] = (LIM[b.p_klucz] ?? 0) + 1; return true; },
  sms_rezerwuj: (b) => { for (let i = 0; i < b.p_klucze.length; i++) if ((SMSLIM[b.p_klucze[i]] ?? 0) + 1 > b.p_maxy[i]) return b.p_klucze[i]; for (const k of b.p_klucze) SMSLIM[k] = (SMSLIM[k] ?? 0) + 1; return null; },
  tg_subskrybuj: (b) => {
    const z = T.klient_zaproszenia_tg.find((x) => x.token_hash === b.p_hash);
    if (!z || !(b.p_user > 0)) return { wynik: "zly" };
    if (z.revoked_at) return { wynik: "cofniety" };
    if (z.expires_at <= TERAZ.toISOString()) return { wynik: "wygasl" };
    const klucz = z.pracownik ? "pracownik" : "klient", S = T.klient_subskrypcje;
    if (!z.pracownik && S.some((s) => s.pracownik && s.tg_user_id === b.p_user && s.aktywna)) return { wynik: "pracownik" };
    const nazwa = z.klient ? T.klienci_baza.find((k) => k.id === z.klient)?.nazwa : undefined;
    let s = S.find((x) => x[klucz] === z[klucz] && x.tg_user_id === b.p_user);
    if (s && s.aktywna && !s.blocked_at) return { wynik: "juz", [klucz]: z[klucz], nazwa, jezyk: s.jezyk };
    if (z.max_uzyc != null && z.uzycia >= z.max_uzyc) return { wynik: "limit" };
    if (z.pracownik) for (const x of S) if (x.pracownik === z.pracownik && x.tg_user_id !== b.p_user) x.aktywna = false;
    const pola = { tg_user_id: b.p_user, chat_id: b.p_user, imie: b.p_imie, nazwisko: b.p_nazwisko, username: b.p_username, language_code: b.p_lang, zaproszenie: z.id, aktywna: true, blocked_at: null, unsubscribed_at: null, subscribed_at: TERAZ.toISOString() };
    if (s) Object.assign(s, pola);
    else { s = { id: crypto.randomUUID(), klient: z.klient ?? null, nip: z.klient ?? null, pracownik: z.pracownik ?? null, jezyk: z.pracownik ? "pl" : b.p_jezyk, zgoda_marketing: false, rola: null, ...pola }; S.push(s); }
    z.uzycia++;
    return { wynik: "ok", [klucz]: z[klucz], nazwa, jezyk: s.jezyk };
  },
  rozsylka_pobierz: (b) => {
    const teraz = TERAZ.toISOString();
    for (const o of T.rozsylka_odbiorcy) if (o.status === "wysylanie" && o.pobrano_at < new Date(TERAZ.getTime() - 600000).toISOString()) { o.status = "niepewny"; o.powod = "przerwane"; }
    const w = T.rozsylka_odbiorcy.filter((o) => {
      const r = T.rozsylki.find((x) => x.id === o.rozsylka);
      return o.status === "kolejka" && o.nastepna_proba <= teraz && r?.status === "w_trakcie" && (!r.wstrzymana_do || r.wstrzymana_do <= teraz) && (!b.p_cisza || r.mimo_ciszy);
    }).sort((a, c) => a.nastepna_proba.localeCompare(c.nastepna_proba) || a.nr - c.nr).slice(0, b.p_limit);
    for (const o of w) { o.status = "wysylanie"; o.pobrano_at = teraz; }
    return w.map((o) => ({ ...o }));
  },
};
let nr = 0;
// deno-lint-ignore require-await
globalThis.fetch = (async (input: Any, init: Any = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const h = new Headers(init.headers ?? {}), auth = h.get("Authorization") ?? "", prefer = h.get("Prefer") ?? "";
  if (url.host === "db.test") {
    if (url.pathname === "/auth/v1/user") { const u = USERS[auth.replace("Bearer ", "")]; return u ? J(u) : J({}, 401); }
    if (url.pathname === "/auth/v1/admin/users") return auth === "Bearer service" ? J({ users: Object.entries(USERS).filter(([k]) => drugiAdmin || k !== "admin2").map(([, u]) => u) }) : J({}, 401);
    if (auth !== "Bearer service") return J({ message: "permission denied" }, 403);
    const sciezka = url.pathname.replace("/rest/v1/", "");
    if (sciezka.startsWith("rpc/")) return J(RPC[sciezka.slice(4)](JSON.parse(init.body)));
    if (!(sciezka in T)) return J({ message: "relation does not exist" }, 404);
    const t = T[sciezka], filtry = [...url.searchParams].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k));
    let wiersze = t.filter((r) => filtry.every(([k, v]) => pasuje(r, k, v)));
    const metoda = init.method ?? "GET";
    if (metoda === "GET") {
      const n = wiersze.length, ord = url.searchParams.get("order") ?? "";
      if (ord.includes("created_at.desc") || ord.includes("subscribed_at.desc")) wiersze = wiersze.slice().reverse();
      if (ord.startsWith("nazwa.asc")) wiersze = wiersze.slice().sort((a, b) => String(a.nazwa).localeCompare(String(b.nazwa), "pl") || String(a.kanal).localeCompare(String(b.kanal)));
      const zakres = h.get("Range"); if (zakres) { const [a, b] = zakres.split("-").map(Number); wiersze = wiersze.slice(a, b + 1); }
      const lim = url.searchParams.get("limit"); if (lim) wiersze = wiersze.slice(0, Number(lim));
      return J(wiersze, 200, prefer.includes("count=exact") ? { "content-range": (n ? "0-0" : "*") + "/" + n } : {});
    }
    if (metoda === "POST") {
      const nowe: Any[] = [];
      for (const b of [JSON.parse(init.body)].flat()) {
        const r = { id: crypto.randomUUID(), created_at: TERAZ.toISOString(), nastepna_proba: TERAZ.toISOString(), nr: ++nr, ...(DOMYSLNE[sciezka] ?? {}), ...b };
        const u = UNIKAT[sciezka], i = u ? t.findIndex((x) => u.every((c) => x[c] === r[c])) : -1;
        if (i >= 0) { if (prefer.includes("merge-duplicates")) { Object.assign(t[i], b); nowe.push(t[i]); continue; } if (prefer.includes("ignore-duplicates")) continue; return J({ code: "23505" }, 409); }
        t.push(r); nowe.push(r);
      }
      return J(nowe, 201);
    }
    if (metoda === "PATCH") { const p = JSON.parse(init.body); for (const r of wiersze) Object.assign(r, p); return J(wiersze.map((r) => ({ ...r }))); }
    if (metoda === "DELETE") { T[sciezka] = t.filter((r) => !wiersze.includes(r)); return J([]); }
    return J({}, 405);
  }
  if (url.host === "api.telegram.org") {
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname)!, token = m[1], metoda = m[2], body = JSON.parse(init.body ?? "{}");
    tgm.wywolania.push({ token, metoda, body });
    const wlasna = tgm.odp?.(token, metoda, body);
    if (wlasna) return wlasna;
    if (metoda === "getMe") return J({ ok: true, result: { id: token === TOK_SUB ? 111111 : 222222, is_bot: true, first_name: token === TOK_SUB ? "TD Powiadomienia" : "TD Portal", username: token === TOK_SUB ? "TdPowiadomienia_bot" : "TdPortal_bot", can_join_groups: token !== TOK_SUB, can_read_all_group_messages: false } });
    if (metoda === "getWebhookInfo") return J({ ok: true, result: { url: "", has_custom_certificate: false, pending_update_count: 0, ...tgm.webhook } });
    if (metoda === "sendMessage") return J({ ok: true, result: { message_id: ++tgm.nr, chat: { id: body.chat_id } } });
    return J({ ok: true, result: true });
  }
  if (url.host === "api.smsapi.pl" || url.host === "api2.smsapi.pl") {
    const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
    if (auth !== "Bearer " + SEKRETY[5]) return J({ error: "authorization_failed" }, 401);
    smsy.push(form);
    return J({ count: 1, list: [{ id: form.test === "1" ? "" : "MSG" + smsy.length, points: 0, number: form.to, status: "QUEUE", error: null, idx: form.idx, parts: 1 }] });
  }
  throw new Error("nieoczekiwane żądanie: " + url.host);
}) as typeof fetch;

for (const k of ["log", "error", "warn"] as const) { const o = console[k]; console[k] = (...a: Any[]) => { wyjscia.push(a.map(String).join(" ")); if (Deno.env.get("POKAZ")) o(...a); }; }
const handlery: ((r: Request) => Promise<Response>)[] = [];
(Deno as Any).serve = (h: Any) => { handlery.push(h); return {}; };
await import("./index.ts");
await import("../tg-bot/index.ts");
const [komH, botH] = handlery;
const { zal } = await import("./core.ts");
const { tokenZSoli, sha256hex, szablonKoniecGrup, LINK_SUB } = await import("./logic.ts");
zal.spij = (ms: number) => { pauzy.push(ms); return Promise.resolve(); };
zal.teraz = () => new Date(TERAZ);
// deno-lint-ignore require-await
zal.poczta = async (m: Any) => { if (String(m.to).startsWith("odrzuc")) throw Object.assign(new Error("550 rejected haslo"), { responseCode: 550 }); maile.push(m); return "<id-" + maile.length + "@example.test>"; };

async function api(kto: string, body: Any, naglowki: Record<string, string> = {}): Promise<Any> {
  const r = await komH(new Request("http://f.test/komunikacja", { method: "POST", headers: { Authorization: "Bearer " + kto, "Content-Type": "application/json", ...naglowki }, body: JSON.stringify(body) }));
  const t = await r.text(); wyjscia.push(t);
  return { http: r.status, ...JSON.parse(t) };
}
let upd = 1000;
async function bot(update: Any, sekret: string | null = SEKRETY[3], metoda = "POST"): Promise<number> {
  const r = await botH(new Request("http://f.test/tg-bot", { method: metoda, headers: { "Content-Type": "application/json", ...(sekret == null ? {} : { "X-Telegram-Bot-Api-Secret-Token": sekret }) }, body: metoda === "POST" ? JSON.stringify({ update_id: ++upd, ...update }) : undefined }));
  wyjscia.push(await r.text());
  return r.status;
}
const od = (id: number, o: Any = {}) => ({ id, is_bot: false, first_name: "Jan", last_name: "Testowy", username: "jan_test" + id, language_code: "pl", ...o });
const msg = (user: number, text: string, o: Any = {}) => ({ message: { message_id: 1, from: od(user, o.from), chat: { id: user, type: "private", ...(o.chat ?? {}) }, text } });
const wyslane = (metoda = "sendMessage") => tgm.wywolania.filter((w) => w.metoda === metoda);
const ostatnia = () => wyslane().at(-1)!;
const opts = { sanitizeOps: false, sanitizeResources: false };
const tokenZ = (link: string) => link.split("start=")[1];
async function link(klient: string, kto = "kadry", o: Any = {}): Promise<string> { const z = await api(kto, { action: "zaproszenie", klient, ...o }); assertEquals(z.http, 200); return z.link; }
const subskrybuj = async (klient: string, user: number, o: Any = {}) => { assertEquals(await bot(msg(user, "/start " + tokenZ(await link(klient)), { from: o })), 200); return T.klient_subskrypcje.find((s) => s.klient === klient && s.tg_user_id === user)!; };

// =============================================================== the bot's webhook
Deno.test("webhook: tylko Telegram ze swoim sekretem; bez sekretu i ze złym — nic się nie dzieje", opts, async () => {
  reset();
  assertEquals(await bot(msg(7001, "/start"), null), 403);
  assertEquals(await bot(msg(7001, "/start"), "zly-sekret"), 403);
  assertEquals(await bot(msg(7001, "/start"), SEKRETY[3] + "x"), 403);
  assertEquals(await bot(msg(7001, "/start"), ""), 403);
  assertEquals(await bot({}, SEKRETY[3], "GET"), 405);
  assertEquals([tgm.wywolania.length, T.tg_updates.length], [0, 0]);
  assertEquals(await bot(msg(7001, "/start")), 200);
  assertEquals(wyslane().length, 1);
  // other kinds of updates are accepted and dropped
  assertEquals(await bot({ edited_message: msg(7001, "/stop").message }), 200);
  assertEquals(await bot({ channel_post: { chat: { id: -100, type: "channel" }, text: "/start" } }), 200);
  assertEquals(wyslane().length, 1);
});

Deno.test("/start z ważnym linkiem: subskrypcja klienta, potwierdzenie z NAZWĄ klienta w jego języku", opts, async () => {
  reset();
  const l = await link(NIPY[0]);                                          // client 1: Russian
  assert(/^https:\/\/t\.me\/TdPowiadomienia_bot\?start=[A-Za-z0-9_-]{32}$/.test(l));
  assertEquals(await bot(msg(7001, "/start " + tokenZ(l), { from: { language_code: "en" } })), 200);
  const s = T.klient_subskrypcje[0];
  assertEquals([s.klient, s.tg_user_id, s.chat_id, s.imie, s.username, s.language_code, s.jezyk, s.aktywna, T.klient_zaproszenia_tg[0].uzycia], [NIPY[0], 7001, 7001, "Jan", "jan_test7001", "en", "ru", true, 1]);
  const m = ostatnia();
  assertEquals([m.token, m.body.chat_id, m.body.parse_mode], [TOK_SUB, 7001, undefined]);   // the subscription bot, plain text
  assert(m.body.text.includes("Przykładowa Firma 1 sp. z o.o.") && m.body.text.includes("Уведомления бюро") && m.body.text.includes("/stop"));
  // only the hash and the salt are stored — the token is nowhere in the table
  assert(!JSON.stringify(T.klient_zaproszenia_tg).includes(tokenZ(l)));
  assertEquals(T.klient_zaproszenia_tg[0].token_hash, await sha256hex(tokenZ(l)));
  assertEquals(tokenZ(l), await tokenZSoli(SEKRETY[2], T.klient_zaproszenia_tg[0].sol));
});

Deno.test("/start: ten sam link drugi raz, druga osoba, limit użyć", opts, async () => {
  reset();
  const l = await link(NIPY[2]), t = tokenZ(l);                              // client 3: Polish
  await bot(msg(7001, "/start " + t));
  await bot(msg(7001, "/start " + t));                                       // the same person again: nothing counted
  assertEquals([T.klient_subskrypcje.length, T.klient_zaproszenia_tg[0].uzycia], [1, 1]);
  assert(ostatnia().body.text.startsWith("Powiadomienia dla firmy Przykładowa Firma 3 sp. z o.o. są już włączone."));
  await bot(msg(7002, "/start " + t, { from: { language_code: "uk" } }));    // a second person of the same client
  assertEquals([T.klient_subskrypcje.length, T.klient_zaproszenia_tg[0].uzycia, T.klient_subskrypcje[1].jezyk], [2, 2, "pl"]); // the client's language wins
  assertEquals(await link(NIPY[2]), l);                                      // the link shown again is the same link
  T.klient_zaproszenia_tg[0].max_uzyc = 2;
  await bot(msg(7003, "/start " + t));
  assertEquals(T.klient_subskrypcje.length, 2);
  assert(ostatnia().body.text.startsWith("To jest bot powiadomień biura") && !ostatnia().body.text.includes("Przykładowa"));
  // a used-up link is replaced by a new one the next time staff ask for it
  const nowy = await link(NIPY[2]);
  assertNotEquals(nowy, l);
  assert(T.klient_zaproszenia_tg[0].revoked_at);
});

Deno.test("/start: brak, zły, wygasły i cofnięty token — jedna neutralna odpowiedź, żadnych danych klienta", opts, async () => {
  reset();
  const stary = tokenZ(await link(NIPY[0]));
  const nowy = tokenZ((await api("kadry", { action: "zaproszenie", klient: NIPY[0], rotuj: true })).link);   // rotation revokes the old one
  assertNotEquals(stary, nowy);
  const wygasly = tokenZ(await link(NIPY[1]));
  T.klient_zaproszenia_tg.find((z) => z.klient === NIPY[1])!.expires_at = "2026-10-01T00:00:00Z";
  const teksty: string[] = [];
  for (const t of ["", stary, wygasly, "A".repeat(32), "krotki", "x".repeat(70), "<b>" + "y".repeat(29)]) { await bot(msg(7005, ("/start " + t).trim(), { from: { language_code: "ru" } })); teksty.push(ostatnia().body.text); }
  assertEquals(new Set(teksty).size, 1);
  assert(teksty[0].startsWith("Это бот уведомлений бюро") && !teksty[0].includes("Przykładowa"));
  assertEquals(T.klient_subskrypcje.length, 0);
  await bot(msg(7005, "/start " + nowy));
  assertEquals(T.klient_subskrypcje.length, 1);
});

Deno.test("/start: po kilku nietrafionych próbach w godzinie bot milknie", opts, async () => {
  reset();
  for (let i = 0; i < 9; i++) await bot(msg(7006, "/start " + String(i).repeat(32)));
  assertEquals(wyslane().length, 6);
  await bot(msg(7007, "/start " + "z".repeat(32)));                          // another person is not affected
  assertEquals(wyslane().length, 7);
});

Deno.test("grupy: bot nigdy nie odpowiada i nie zapisuje nikogo z czatu grupowego", opts, async () => {
  reset();
  const t = tokenZ(await link(NIPY[0]));
  tgm.wywolania = [];
  for (const typ of ["group", "supergroup", "channel"]) {
    await bot({ message: { message_id: 1, from: od(7001), chat: { id: -1001000000010, type: typ, title: "Firma 1 + biuro" }, text: "/start " + t } });
    await bot({ message: { message_id: 2, from: od(7001), chat: { id: -1001000000010, type: typ }, text: "/stop@TdPowiadomienia_bot" } });
    await bot({ my_chat_member: { chat: { id: -1001000000010, type: typ }, from: od(7001), new_chat_member: { status: "kicked" } } });
    await bot({ callback_query: { id: "cb" + typ, from: od(7001), data: "j:ru", message: { chat: { id: -1001000000010, type: typ } } } });
  }
  await bot({ message: { message_id: 3, from: od(7001), chat: { id: 7999, type: "private" }, text: "/start " + t } });      // "private" but somebody else's chat
  await bot({ message: { message_id: 4, from: od(7001, { is_bot: true }), chat: { id: 7001, type: "private" }, text: "/start " + t } });
  assertEquals(wyslane().length, 0);
  assertEquals(T.klient_subskrypcje.length, 0);
  assertEquals(T.klient_zaproszenia_tg[0].uzycia, 0);
});

Deno.test("/stop, zablokowanie bota, ponowny zapis", opts, async () => {
  reset();
  const s = await subskrybuj(NIPY[2], 7001), s2 = await subskrybuj(NIPY[3], 7001);    // one person, two clients
  await bot(msg(7001, "/stop"));
  assertEquals([s.aktywna, s2.aktywna, s.wylaczyl, !!s.unsubscribed_at], [false, false, "uzytkownik", true]);
  assert(ostatnia().body.text.startsWith("Powiadomienia zostały wyłączone."));
  await bot(msg(7001, "/stop"));
  assertEquals(ostatnia().body.text, "Dla tego konta nie ma włączonych powiadomień.");
  await bot(msg(7001, "/start " + tokenZ(await link(NIPY[2]))));
  assertEquals([s.aktywna, s.unsubscribed_at, T.klient_subskrypcje.length], [true, null, 2]);
  const ile = wyslane().length;
  await bot({ my_chat_member: { chat: { id: 7001, type: "private" }, from: od(7001), new_chat_member: { status: "kicked" } } });
  assert(s.blocked_at);
  assertEquals(wyslane().length, ile);                                       // nothing is sent to somebody who blocked the bot
  await bot({ my_chat_member: { chat: { id: 7001, type: "private" }, from: od(7001), new_chat_member: { status: "member" } } });
  assertEquals(s.blocked_at, null);
});

Deno.test("idempotencja: ta sama aktualizacja (update_id) jest obsługiwana raz", opts, async () => {
  reset();
  const t = tokenZ(await link(NIPY[2])), u = { update_id: 555001, ...msg(7001, "/start " + t) };
  tgm.wywolania = [];
  for (let i = 0; i < 3; i++) assertEquals(await bot(u), 200);
  assertEquals([wyslane().length, T.klient_subskrypcje.length, T.klient_zaproszenia_tg[0].uzycia], [1, 1, 1]);
  const stop = { update_id: 555002, ...msg(7001, "/stop") };
  await bot(stop); await bot(stop);
  assertEquals(wyslane().length, 2);
});

Deno.test("/jezyk i przyciski, pomoc, /privacy; tekst użytkownika nigdy nie wraca w odpowiedzi", opts, async () => {
  reset();
  const s = await subskrybuj(NIPY[2], 7001);
  await bot(msg(7001, "/jezyk"));
  assertEquals(ostatnia().body.reply_markup.inline_keyboard[0].map((b: Any) => b.callback_data), ["j:pl", "j:ru", "j:uk"]);
  await bot({ callback_query: { id: "cb1", from: od(7001), data: "j:uk", message: { chat: { id: 7001, type: "private" } } } });
  assertEquals([s.jezyk, ostatnia().body.text, wyslane("answerCallbackQuery").length], ["uk", "Мова повідомлень: українська.", 1]);
  await bot({ callback_query: { id: "cb2", from: od(7001), data: "j:de'; drop table", message: { chat: { id: 7001, type: "private" } } } });
  assertEquals(s.jezyk, "uk");
  const wrogi = "<b>hej</b> https://zlo.test/kliknij @admin /start " + "q".repeat(32);
  await bot(msg(7001, wrogi));
  assert(ostatnia().body.text.startsWith("Цей бот надсилає сповіщення") && !ostatnia().body.text.includes("zlo.test") && !ostatnia().body.text.includes("hej"));
  await bot({ message: { message_id: 9, from: od(7001), chat: { id: 7001, type: "private" }, photo: [{ file_id: "x" }] } });
  assert(ostatnia().body.text.startsWith("Цей бот"));
  await api("admin", { action: "ustawienia", ustawienia: { prog_akceptacji: 5, godziny: { od: "08:00", do: "20:00" }, na_przebieg: 20, odstep_ms: 1500, stop_po_bledach: 5, max_prob: 4, link_dni: 90, link_max: 30, koniec_grup: "2026-11-01", polityka_url: "https://td-group.pl/rodo" } });
  await bot(msg(7001, "/privacy"));
  assert(ostatnia().body.text.includes("Бот зберігає") && ostatnia().body.text.endsWith("https://td-group.pl/rodo"));
  for (const w of wyslane()) assertEquals(w.body.parse_mode, undefined);
});

Deno.test("pracownik: własny link testowy; link klienta nie zapisuje pracownika jako odbiorcy klienta", opts, async () => {
  reset();
  const m = await api("kadry", { action: "zaproszenie_moje" });
  assertEquals([m.http, m.polaczone], [200, false]);
  await bot(msg(8001, "/start " + tokenZ(m.link)));
  assertEquals([T.klient_subskrypcje[0].pracownik, T.klient_subskrypcje[0].klient], ["kadry@example.test", null]);
  assert(ostatnia().body.text.startsWith("Konto pracownika biura zostało połączone."));
  assertEquals((await api("kadry", { action: "zaproszenie_moje" })).polaczone, true);
  await bot(msg(8001, "/start " + tokenZ(await link(NIPY[0]))));
  assertEquals(T.klient_subskrypcje.length, 1);
  assert(ostatnia().body.text.includes("pracownika biura") && !ostatnia().body.text.includes("Przykładowa"));
  assertEquals((await api("kadry", { action: "subskrybenci" })).subskrybenci.length, 0);   // staff are not in the clients' list
});

// =============================================================== the portal function
Deno.test("dostęp: bez sesji, spoza portalu, sekcja bez rozsyłek, zły klucz harmonogramu", opts, async () => {
  reset();
  for (const kto of ["nikt", "obcy", "spolka"]) assertEquals((await api(kto, { action: "status" })).http, 403);
  assertEquals((await api("nikt", { action: "kolejka" }, { "x-cron-key": "zly-klucz-0123456789" })).http, 403);
  assertEquals((await api("nikt", { action: "bot_status" }, { "x-cron-key": SEKRETY[4] })).http, 400);  // the scheduler's key runs the queue and nothing else
  assertEquals((await api("nikt", { action: "kolejka" }, { "x-cron-key": SEKRETY[4] })).http, 200);
  for (const a of ["bot_status", "webhook_ustaw", "webhook_usun", "ustawienia", "grupa_flaga", "akceptuj", "odrzuc", "kolejka"]) assertEquals((await api("kadry", { action: a })).http, 403, a);
  assertEquals((await api("kadry", { action: "nie_ma" })).http, 400);
  assertEquals((await komH(new Request("http://f.test/komunikacja", { method: "GET" }))).status, 405);
  const s = await api("ksieg", { action: "status" });
  assertEquals([s.http, s.bot, s.brak, s.konfiguracja.osobny_bot, s.ja.admin], [200, "TdPowiadomienia_bot", [], true, false]);
  assertEquals(wyslane().length, 0);
});

Deno.test("bot_status: tylko odczyt (getMe, getWebhookInfo); obcy webhook = STOP, pokazany jest sam host", opts, async () => {
  reset();
  const a = await api("admin", { action: "bot_status" });
  assertEquals([a.subskrypcje.id, a.subskrypcje.username, a.subskrypcje.name, a.subskrypcje.can_join_groups, a.subskrypcje.can_read_all_group_messages], [111111, "TdPowiadomienia_bot", "TD Powiadomienia", false, false]);
  assertEquals([a.subskrypcje.webhook.ustawiony, a.subskrypcje.webhook.pending_update_count, a.grupy.username, a.nasz_webhook], [false, 0, "TdPortal_bot", "http://db.test/functions/v1/tg-bot"]);
  assert(a.wniosek.includes("nie ma webhooka") && a.wniosek.includes("osobny bot"));
  tgm.webhook = { url: "https://inny-system.example.test/hook/tajny-klucz-tamtego-systemu", pending_update_count: 3, last_error_date: 1791000000, last_error_message: "Wrong response from the webhook: 500" };
  const b = await api("admin", { action: "bot_status" });
  assertEquals([b.subskrypcje.webhook.ustawiony, b.subskrypcje.webhook.nasz, b.subskrypcje.webhook.host, b.subskrypcje.webhook.pending_update_count], [true, false, "inny-system.example.test", 3]);
  assert(b.wniosek.startsWith("STOP") && b.wniosek.includes("KLIENT_BOT_TOKEN"));
  assert(!JSON.stringify(b).includes("tajny-klucz-tamtego-systemu"));
  assertEquals([...new Set(tgm.wywolania.map((w) => w.metoda))].sort(), ["getMe", "getWebhookInfo"]);
});

Deno.test("webhook_ustaw / webhook_usun: domyślnie tylko opis; obcego webhooka portal nie rusza; wykonanie wymaga przepisanego hasła", opts, async () => {
  reset();
  const zmiany = () => tgm.wywolania.filter((w) => ["setWebhook", "deleteWebhook"].includes(w.metoda));
  const sucho = await api("admin", { action: "webhook_ustaw" });
  assertEquals([sucho.sucho, sucho.wykonano, sucho.opis.metoda, sucho.opis.url, sucho.potwierdz, sucho.przeszkody], [true, false, "setWebhook", "http://db.test/functions/v1/tg-bot", "USTAW @TdPowiadomienia_bot", []]);
  assertEquals(sucho.opis.allowed_updates, ["message", "my_chat_member", "callback_query"]);
  assertEquals((await api("admin", { action: "webhook_ustaw", wykonaj: true })).wykonano, false);
  assertEquals((await api("admin", { action: "webhook_ustaw", wykonaj: true, potwierdz: "USTAW" })).wykonano, false);
  assertEquals((await api("admin", { action: "webhook_usun", wykonaj: true, potwierdz: "USUN @TdPowiadomienia_bot" })).przeszkody.length, 1);   // nothing to delete
  assertEquals(zmiany().length, 0);
  tgm.webhook = { url: "https://inny-system.example.test/hook" };
  for (const a of ["webhook_ustaw", "webhook_usun"]) {
    const w = await api("admin", { action: a, wykonaj: true, potwierdz: (a === "webhook_ustaw" ? "USTAW" : "USUN") + " @TdPowiadomienia_bot" });
    assertEquals([w.wykonano, w.przeszkody.length], [false, 1], a);
  }
  assertEquals(zmiany().length, 0);
  tgm.webhook = { url: "" };
  const w = await api("admin", { action: "webhook_ustaw", wykonaj: true, potwierdz: "USTAW @TdPowiadomienia_bot" });   // the stand-in Bot API, not Telegram
  assertEquals([w.wykonano, w.sucho], [true, false]);
  assertEquals(zmiany().map((z) => [z.token, z.metoda, z.body.url, z.body.secret_token, z.body.allowed_updates, z.body.drop_pending_updates]), [[TOK_SUB, "setWebhook", "http://db.test/functions/v1/tg-bot", SEKRETY[3], ["message", "my_chat_member", "callback_query"], false]]);
  tgm.webhook = { url: "http://db.test/functions/v1/tg-bot" };
  assertEquals((await api("admin", { action: "webhook_usun", wykonaj: true, potwierdz: "USUN @TdPowiadomienia_bot" })).wykonano, true);
  assertEquals(zmiany().length, 2);
});

const TRESC = { tg: { pl: [{ t: "Dzień dobry, {firma}. " }, { t: "Ważne", b: true }], ru: [{ t: "Здравствуйте, {firma}." }], uk: [{ t: "Добрий день, {firma}." }] }, fallback: ["pl", "ru", "uk"] };
const szkic = (o: Any = {}) => ({ tytul: "Komunikat testowy", typ: "serwisowa", strategia: "bot", kanaly: {}, odbiorcy: { tryb: "wszyscy" }, tresc: TRESC, ...o });
async function zapisz(kto: string, r: Any, id?: string): Promise<string> { const w = await api(kto, { action: "zapisz", id, rozsylka: r }); assertEquals(w.http, 200, w.error); return w.id; }
async function pracownik(kto: string, user: number) { const m = await api(kto, { action: "zaproszenie_moje" }); await bot(msg(user, "/start " + tokenZ(m.link))); }
// the whole path a broadcast must take before the queue may touch it
async function gotowa(kto: string, r: Any, o: Any = {}): Promise<{ id: string; status: string; liczby: Any }> {
  const id = await zapisz(kto, r);
  if (!T.klient_subskrypcje.some((s) => s.pracownik === USERS[kto].email)) await pracownik(kto, kto === "admin" ? 8100 : 8200);
  const t = await api(kto, { action: "test", id });
  assertEquals(t.ok, true, JSON.stringify(t.wyniki));
  const p = await api(kto, { action: "odbiorcy", rozsylka: r });
  const z = await api(kto, { action: "zglos", id, potwierdzenie: { liczby: p.liczby, tytul: r.tytul }, ...o });
  assertEquals(z.http, 200, z.error);
  return { id, status: z.status, liczby: p.liczby };
}
const wiersze = (id: string) => T.rozsylka_odbiorcy.filter((o) => o.rozsylka === id);
const rozs = (id: string) => T.rozsylki.find((r) => r.id === id)!;
const bieg = () => api("nikt", { action: "kolejka" }, { "x-cron-key": SEKRETY[4] });
const doKlientow = () => wyslane().filter((w) => !["8100", "8200"].includes(String(w.body.chat_id)) && !String(w.body.text).startsWith("<i>TEST"));

Deno.test("tryb przekazywania: webhook aplikacji onboardingowej jest oczekiwany, portal go nie rusza; mówi, co działa", opts, async () => {
  reset();
  const zmiany = () => tgm.wywolania.filter((w) => ["setWebhook", "deleteWebhook"].includes(w.metoda));
  const UST = { prog_akceptacji: 5, godziny: { od: "08:00", do: "20:00" }, na_przebieg: 20, odstep_ms: 1500, stop_po_bledach: 5, max_prob: 4, link_dni: 90, link_max: 30, koniec_grup: "", polityka_url: "" };
  // nothing stored ("auto") + the bot's webhook on the forwarder's host = forwarded mode, without anybody clicking anything
  tgm.webhook = { url: "https://td-onboarding.vercel.app/api/telegram/tajna-sciezka", pending_update_count: 0, allowed_updates: ["message"] };
  const a = await api("admin", { action: "bot_status" });
  assertEquals([a.tryb.ustawiony, a.tryb.dzialajacy, a.tryb.webhook_zablokowany, a.subskrypcje.webhook.host, a.odebrane], ["auto", "przekazywanie", true, "td-onboarding.vercel.app", { ile: 0, ostatnia: null }]);
  assert(a.wniosek.startsWith("Tryb przekazywania — tak ma być") && !a.wniosek.includes("STOP") && a.wniosek.includes("/pl /ru /uk"));
  assert(a.wniosek.includes("NIE DZIAŁA") && a.wniosek.includes("przyciski wyboru języka") && a.wniosek.includes("przy najbliższej wysyłce") && a.wniosek.includes("nie odebrał jeszcze żadnej"));
  assert(!JSON.stringify(a).includes("tajna-sciezka"));
  for (const [akcja, haslo] of [["webhook_ustaw", "USTAW"], ["webhook_usun", "USUN"]]) {
    const w = await api("admin", { action: akcja, wykonaj: true, potwierdz: haslo + " @TdPowiadomienia_bot", przejmij: true });
    assertEquals([w.wykonano, w.wylaczone, w.przeszkody.length, w.potwierdz], [false, true, 1, null], akcja);
  }
  // a forwarded update arrives: the verdict says so; a wider update list removes the "does not work" part
  await bot(msg(7001, "/help"));
  tgm.webhook.allowed_updates = ["message", "callback_query", "my_chat_member"];
  const b = await api("admin", { action: "bot_status" });
  assert(b.odebrane.ile === 1 && b.wniosek.includes("przekazywanie działa") && !b.wniosek.includes("NIE DZIAŁA"));
  // the mode stored explicitly: refused also when the bot has no webhook at all — and the mismatch is reported
  assertEquals((await api("admin", { action: "ustawienia", ustawienia: { ...UST, tryb_bota: "przekazywanie", host_przekazujacy: "td-onboarding.vercel.app" } })).http, 200);
  tgm.webhook = { url: "" };
  const c = await api("admin", { action: "bot_status" });
  assert(c.tryb.dzialajacy === "przekazywanie" && c.wniosek.startsWith("UWAGA") && c.wniosek.includes("nie jest ustawiony"));
  assertEquals((await api("admin", { action: "webhook_ustaw", wykonaj: true, potwierdz: "USTAW @TdPowiadomienia_bot" })).wylaczone, true);
  tgm.webhook = { url: "https://inny-system.example.test/hook" };
  assert((await api("admin", { action: "bot_status" })).wniosek.includes("wskazuje na inny-system.example.test zamiast na td-onboarding.vercel.app"));
  // "webhook" chosen explicitly: the forwarder's host is a foreign system again — STOP, and still nothing is called
  assertEquals((await api("admin", { action: "ustawienia", ustawienia: { ...UST, tryb_bota: "webhook" } })).http, 200);
  tgm.webhook = { url: "https://td-onboarding.vercel.app/api/telegram" };
  assert((await api("admin", { action: "bot_status" })).wniosek.startsWith("STOP"));
  assertEquals((await api("admin", { action: "webhook_ustaw", wykonaj: true, potwierdz: "USTAW @TdPowiadomienia_bot" })).wykonano, false);
  assertEquals((await api("admin", { action: "ustawienia", ustawienia: { ...UST, tryb_bota: "cos" } })).http, 400);
  assertEquals((await api("admin", { action: "ustawienia", ustawienia: { ...UST, host_przekazujacy: "https://x.test/sciezka" } })).http, 400);
  assertEquals(zmiany().length, 0);
  assertEquals([...new Set(tgm.wywolania.map((w) => w.metoda))].sort(), ["getMe", "getWebhookInfo", "sendMessage"]);
});

Deno.test("same wiadomości wystarczą: język komendami /pl /ru /uk i /jezyk <kod>, /help; blokada wykrywana przy wysyłce", opts, async () => {
  reset();
  const s = await subskrybuj(NIPY[2], 7001), s2 = await subskrybuj(NIPY[3], 7001);
  await bot(msg(7001, "/ru"));
  assertEquals([s.jezyk, s2.jezyk, ostatnia().body.text], ["ru", "ru", "Язык сообщений: русский."]);
  await bot(msg(7001, "/jezyk uk"));
  assertEquals([s.jezyk, ostatnia().body.text], ["uk", "Мова повідомлень: українська."]);
  await bot(msg(7001, "/JEZYK UA")); assertEquals(s.jezyk, "uk");
  await bot(msg(7001, "/pl@TdPowiadomienia_bot")); assertEquals([s.jezyk, ostatnia().body.text], ["pl", "Język wiadomości: polski."]);
  await bot(msg(7001, "/jezyk de"));                                         // unknown code: the list of commands, nothing changed
  assert(ostatnia().body.text.includes("/pl — polski") && ostatnia().body.text.includes("/uk — українська") && s.jezyk === "pl");
  await bot(msg(7001, "/help"));
  assert(ostatnia().body.text.includes("/pl /ru /uk — zmień język") && ostatnia().body.text.includes("/stop"));
  await bot(msg(7009, "/uk", { from: { language_code: "en" } }));              // not a subscriber: answered, nothing stored
  assertEquals([ostatnia().body.text, T.klient_subskrypcje.length], ["Мова повідомлень: українська.", 2]);
  assertEquals(wyslane("answerCallbackQuery").length, 0);                     // no step needed a callback_query
  // no my_chat_member arrives in forwarded mode: the block is learnt from the 403 of the next delivery
  const g = await gotowa("admin", szkic({ odbiorcy: { tryb: "recznie", wybrani: [NIPY[2]] } }));
  tgm.odp = (_t, m, b) => m === "sendMessage" && b.chat_id === "7001" ? J({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, 403) : null;
  await bieg();
  assert(s.blocked_at && wiersze(g.id)[0].powod === "odbiorca zablokował bota albo usunął konto");
});

Deno.test("szkic: tylko bezpieczna treść; grupy może włączyć administrator; marketing nigdy do grup", opts, async () => {
  reset();
  assertEquals((await api("kadry", { action: "zapisz", rozsylka: szkic({ tytul: "x" }) })).http, 400);
  assertEquals((await api("kadry", { action: "zapisz", rozsylka: szkic({ tresc: { tg: { pl: "<b>surowy znacznik</b>" } } }) })).http, 400);
  assertEquals((await api("kadry", { action: "zapisz", rozsylka: szkic({ tresc: { tg: { pl: [{ t: "klik", url: "javascript:alert(1)" }] } } }) })).http, 400);
  assertEquals((await api("kadry", { action: "zapisz", rozsylka: szkic({ tresc: { ...TRESC, przyciski: [{ etykieta: { pl: "x" }, url: "http://bez-https.test" }] } }) })).http, 400);
  const gr = await api("kadry", { action: "zapisz", rozsylka: szkic({ strategia: "wszystkie", kanaly: { grupa: true } }) });
  assertEquals([gr.http, gr.error], [400, "Wysyłkę do grup klientów może przygotować tylko administrator."]);
  assertEquals((await api("kadry", { action: "zapisz", rozsylka: szkic({ strategia: "bot_grupa" }) })).http, 400);
  assertEquals((await api("admin", { action: "zapisz", rozsylka: szkic({ typ: "marketingowa", strategia: "wszystkie", kanaly: { grupa: true } }) })).error, "Rozsyłka marketingowa nie może iść do grup klientów.");
  assertEquals((await api("kadry", { action: "zapisz", rozsylka: szkic({ strategia: "wszystkie", kanaly: {} }) })).http, 400);
  const id = await zapisz("kadry", szkic());
  assertEquals([rozs(id).autor, rozs(id).status, rozs(id).kanaly], ["kadry@example.test", "szkic", { bot: true, grupa: false, sms: false, mail: false }]);
  assertEquals((await api("ksieg", { action: "zapisz", id, rozsylka: szkic({ tytul: "Cudzy szkic" }) })).http, 403);   // not the author
  await zapisz("admin", szkic({ tytul: "Poprawione przez administratora" }), id);
  assertEquals(rozs(id).tytul, "Poprawione przez administratora");
});

Deno.test("podgląd i lista odbiorców: kanał dla każdego klienta, powód pominięcia, pola wypełnione danymi klienta", opts, async () => {
  reset();
  await subskrybuj(NIPY[0], 7001); await subskrybuj(NIPY[1], 7002); await subskrybuj(NIPY[1], 7003);
  const o = await api("kadry", { action: "odbiorcy", rozsylka: szkic({ strategia: "bot_sms", tresc: { ...TRESC, sms: { pl: "Prosimy o kontakt z biurem." } } }) });
  assertEquals(o.liczby, { bot: 3, grupa: 0, sms: 5, mail: 0, brak: 1, klienci: 7 });
  assertEquals(o.wiersze.find((w: Any) => w.klient === NIPY[2]).powod, "brak subskrypcji bota; brak numeru komórkowego w bazie klientów");   // a landline on file
  assertEquals(o.wiersze.find((w: Any) => w.klient === NIPY[1]).kanaly.map((k: Any) => k.kanal + ":" + k.jezyk), ["bot:uk", "bot:uk"]);
  assert(o.wiersze.find((w: Any) => w.klient === NIPY[3]).kanaly[0].adres.includes("*"));         // contact data are masked
  assertEquals([o.akceptacja.length, o.sms_czesci, o.tytul_wymagany], [1, 5, false]);
  assert(!JSON.stringify(o).includes("7001") && !JSON.stringify(o).includes("+4860010021"));
  const p = await api("kadry", { action: "podglad", klient: NIPY[1], rozsylka: szkic({ tresc: { ...TRESC, przyciski: [{ etykieta: { pl: "Włącz", ru: "Включить", uk: "Увімкнути" }, url: LINK_SUB }] } }) });
  assertEquals(p.jezyki.uk.tg.segmenty, [{ t: "Добрий день, Przykładowa Firma 2 sp. z o.o..", b: false, i: false, link: false }]);
  assertEquals(p.jezyki.pl.tg.segmenty[1], { t: "Ważne", b: true, i: false, link: false });
  assert(/^https:\/\/t\.me\/TdPowiadomienia_bot\?start=[A-Za-z0-9_-]{32}$/.test(p.jezyki.ru.tg.przyciski[0].url) && p.jezyki.ru.tg.przyciski[0].text === "Включить");
  const k = await api("ksieg", { action: "klienci" });
  assertEquals(k.klienci.map((x: Any) => x.sub), [1, 2, 0, 0, 0, 0, 0, 0]);
  assertEquals([k.klienci[2].telefon, k.klienci[3].email, k.klienci[4].grupa, k.klienci[0].jezyk, k.klienci[3].jezyk], [false, false, false, "ru", ""]);
});

Deno.test("przed wysyłką: test do autora dla OBECNEJ treści, potem potwierdzenie liczb", opts, async () => {
  reset();
  await subskrybuj(NIPY[0], 7001);
  const r = szkic({ odbiorcy: { tryb: "recznie", wybrani: [NIPY[0]] } }), id = await zapisz("kadry", r);
  const p = await api("kadry", { action: "odbiorcy", rozsylka: r });
  assert((await api("kadry", { action: "zglos", id, potwierdzenie: { liczby: p.liczby } })).error.includes("Wyślij test do mnie"));
  const bez = await api("kadry", { action: "test", id });
  assert(!bez.ok && bez.wyniki.telegram.includes("nie jest połączone"));
  assertEquals(rozs(id).test, null);
  await pracownik("kadry", 8200);
  tgm.wywolania = [];
  const t = await api("kadry", { action: "test", id });
  assertEquals([t.ok, t.wyniki.telegram, t.wyniki.telegram_wersje], [true, "ok", ["pl", "ru", "uk"]]);
  assertEquals(wyslane().map((w) => w.body.chat_id), ["8200", "8200", "8200"]);                    // the author's own chat, nobody else's
  assert(wyslane()[0].body.text.startsWith("<i>TEST · Komunikat testowy · wersja pl · tak zobaczy to: Przykładowa Firma 1 sp. z o.o.</i>\n\nDzień dobry, Przykładowa Firma 1 sp. z o.o.. <b>Ważne</b>"));
  assertEquals((await api("ksieg", { action: "test", id })).http, 403);
  assert((await api("kadry", { action: "zglos", id, potwierdzenie: { liczby: { ...p.liczby, bot: 5 } } })).error.includes("zmieniła się"));
  // the text changes after the test: the test no longer counts
  await zapisz("kadry", { ...r, tresc: { ...TRESC, tg: { ...TRESC.tg, pl: [{ t: "Inna treść." }] } } }, id);
  assert((await api("kadry", { action: "zglos", id, potwierdzenie: { liczby: p.liczby } })).error.includes("Wyślij test do mnie"));
  await api("kadry", { action: "test", id });
  const z = await api("kadry", { action: "zglos", id, potwierdzenie: { liczby: p.liczby } });
  assertEquals([z.status, z.akceptacja, rozs(id).status], ["zaplanowana", [], "zaplanowana"]);  // one recipient, no group: no approval needed
  assertEquals(doKlientow().length, 0);                                                        // nothing has gone to a client yet
  assertEquals((await api("kadry", { action: "zapisz", id, rozsylka: r })).http, 400);        // frozen
});

Deno.test("akceptacja: powyżej progu i dla grup — administrator inny niż autor; powyżej 20 odbiorców przepisany tytuł", opts, async () => {
  reset(26);
  const r = szkic({ tytul: "Koniec rozsyłek w grupach", strategia: "wszystkie", kanaly: { grupa: true } });
  const g = await gotowa("admin", r);
  assertEquals([g.status, g.liczby.grupa, rozs(g.id).liczba], ["do_akceptacji", 25, 25]);
  const pot = { liczby: g.liczby, tytul: r.tytul };
  assertEquals((await api("kadry", { action: "akceptuj", id: g.id, potwierdzenie: pot })).http, 403);
  assert((await api("admin", { action: "akceptuj", id: g.id, potwierdzenie: pot })).error.includes("Autor nie akceptuje"));
  assert((await api("admin2", { action: "akceptuj", id: g.id, potwierdzenie: { liczby: g.liczby } })).error.includes("przepisz"));
  assert((await api("admin2", { action: "akceptuj", id: g.id, potwierdzenie: { liczby: { ...g.liczby, grupa: 24 }, tytul: r.tytul } })).error.includes("zmieniła się"));
  assertEquals((await bieg()).pobrane, 0);                                                    // not approved: the queue takes nothing
  const a = await api("admin2", { action: "akceptuj", id: g.id, potwierdzenie: pot });
  assertEquals([a.status, a.samoakceptacja, rozs(g.id).akceptowal, rozs(g.id).autor], ["zaplanowana", false, "admin2@example.test", "admin@example.test"]);
  // rejected: back to a draft with the reason, the frozen list is dropped
  const g2 = await gotowa("admin", szkic({ tytul: "Druga", strategia: "wszystkie", kanaly: { grupa: true } }));
  assertEquals((await api("admin2", { action: "odrzuc", id: g2.id, powod: "Popraw datę." })).status, "szkic");
  assertEquals([wiersze(g2.id).length, rozs(g2.id).powod], [0, "Odrzucona przez admin2@example.test: Popraw datę."]);
  // the only administrator may approve his own broadcast — and it is recorded
  drugiAdmin = false;
  const g3 = await gotowa("admin", szkic({ tytul: "Trzecia", strategia: "wszystkie", kanaly: { grupa: true }, odbiorcy: { tryb: "recznie", wybrani: [NIPY[0]] } }));
  assertEquals(g3.status, "do_akceptacji");                                                   // one group is enough to need approval
  const a3 = await api("admin", { action: "akceptuj", id: g3.id, potwierdzenie: { liczby: g3.liczby } });
  assertEquals([a3.samoakceptacja, rozs(g3.id).samoakceptacja], [true, true]);
  // a member of staff above the threshold: waits for an administrator
  for (let i = 0; i < 6; i++) await subskrybuj(NIPY[i], 7100 + i);
  const g4 = await gotowa("kadry", szkic({ tytul: "Czwarta" }));
  assertEquals([g4.status, g4.liczby.bot], ["do_akceptacji", 6]);
  assertEquals((await api("kadry", { action: "wznow", id: g4.id })).http, 400);
  assertEquals((await api("kadry", { action: "cofnij", id: g4.id })).status, "szkic");
  assertEquals(wiersze(g4.id).length, 0);
});

Deno.test("kolejka: tempo, małe porcje, wznowienie w kolejnych przebiegach, nikt nie dostaje dwa razy", opts, async () => {
  reset(26);
  const g = await gotowa("admin", szkic({ tytul: "Koniec rozsyłek w grupach", strategia: "wszystkie", kanaly: { grupa: true }, tresc: szablonKoniecGrup("2026-11-01").tresc }));
  await api("admin2", { action: "akceptuj", id: g.id, potwierdzenie: { liczby: g.liczby, tytul: "Koniec rozsyłek w grupach" } });
  tgm.wywolania = []; pauzy.length = 0;
  const b1 = await bieg();
  assertEquals([b1.uruchomione, b1.pobrane, b1.wyslano, rozs(g.id).status], [1, 20, 20, "w_trakcie"]);     // 20 per run, not all 25
  assertEquals(pauzy.filter((p) => p === 1500).length, 19);                                               // a pause before every message but the first
  assertEquals(doKlientow().length, 20);
  const b2 = await bieg();
  assertEquals([b2.pobrane, b2.wyslano, b2.zakonczone, rozs(g.id).status], [5, 5, 1, "zakonczona"]);
  const b3 = await bieg();
  assertEquals([b3.pobrane, b3.wyslano], [0, 0]);
  const czaty = doKlientow().map((w) => w.body.chat_id);
  assertEquals([czaty.length, new Set(czaty).size], [25, 25]);                                            // one message per group, ever
  assert(doKlientow().every((w) => w.token === TOK_GR && w.body.parse_mode === "HTML" && w.body.link_preview_options.is_disabled));
  // each group got its own client's name, language and deep link
  const m = doKlientow().find((w) => w.body.chat_id === "-1001000000010")!;
  assert(m.body.text.includes("Изменение способа отправки уведомлений") && m.body.text.includes("Przykładowa Firma 1 sp. z o.o.") && m.body.text.includes("1 ноября 2026 г."));
  assertEquals(m.body.reply_markup.inline_keyboard[0][0].text, "Включить уведомления");
  const linki = doKlientow().map((w) => w.body.reply_markup.inline_keyboard[0][0].url);
  assertEquals(new Set(linki).size, 25);
  assert(linki.every((l: string) => /^https:\/\/t\.me\/TdPowiadomienia_bot\?start=[A-Za-z0-9_-]{32}$/.test(l)));
  await bot(msg(7300, "/start " + tokenZ(m.body.reply_markup.inline_keyboard[0][0].url)));                 // the button works: the right client
  assertEquals(T.klient_subskrypcje.find((s) => s.tg_user_id === 7300)!.klient, NIPY[0]);
  assertEquals(wiersze(g.id).filter((w) => w.status === "wyslano" && w.tg_message_id > 0).length, 25);
  assertEquals(wiersze(g.id).find((w) => w.kanal === "brak")!.powod, "brak grupy Telegram w bazie klientów");
  // the same list frozen twice cannot hold a recipient twice (unique rozsylka + kanal + adres)
  const przed = wiersze(g.id).length;
  await globalThis.fetch("http://db.test/rest/v1/rozsylka_odbiorcy", { method: "POST", headers: { Authorization: "Bearer service", Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(wiersze(g.id).map(({ id: _i, ...w }) => ({ ...w, status: "kolejka" }))) });
  assertEquals(wiersze(g.id).length, przed);
});

async function botowa(ilu: number, o: Any = {}): Promise<{ id: string }> {
  for (let i = 0; i < ilu; i++) await subskrybuj(NIPY[i], 7400 + i);
  const g = await gotowa("admin", szkic(o));
  if (g.status === "do_akceptacji") assertEquals((await api("admin2", { action: "akceptuj", id: g.id, potwierdzenie: { liczby: g.liczby, tytul: o.tytul ?? "Komunikat testowy" } })).http, 200);
  tgm.wywolania = []; pauzy.length = 0;
  return g;
}

Deno.test("kolejka: 429 z retry_after — czekamy tyle, ile każe Telegram, i wysyłamy dokładnie raz", opts, async () => {
  reset();
  const g = await botowa(4);
  let n = 0;
  tgm.odp = (_t, m) => m === "sendMessage" && ++n === 2 ? J({ ok: false, error_code: 429, description: "Too Many Requests: retry after 40", parameters: { retry_after: 40 } }, 429) : null;
  const b = await bieg();
  assertEquals([b.wyslano, b.pozniej, b.bledy], [1, 3, 0]);                                   // the limited row and the two after it wait
  assertEquals(wyslane().length, 2);                                                          // nothing was tried after the 429
  const limit = wiersze(g.id).find((w) => w.powod?.includes("Too Many Requests"))!;
  assertEquals([limit.status, limit.proby, limit.nastepna_proba, rozs(g.id).wstrzymana_do, rozs(g.id).bledy_z_rzedu], ["kolejka", 1, "2026-10-09T10:00:43.000Z", "2026-10-09T10:00:43.000Z", 0]);
  tgm.odp = null;
  TERAZ = new Date("2026-10-09T10:00:30Z");
  assertEquals((await bieg()).pobrane, 0);                                                    // too early
  TERAZ = new Date("2026-10-09T10:00:50Z");
  const b2 = await bieg();
  assertEquals([b2.wyslano, b2.zakonczone, rozs(g.id).status], [3, 1, "zakonczona"]);
  const czaty = wyslane().filter((w) => w.body.text.startsWith("Dzień") || w.body.text.startsWith("Здрав") || w.body.text.startsWith("Добрий")).map((w) => w.body.chat_id);
  assertEquals(czaty.length, 5);                                                              // 4 delivered + the one refused with 429
  assertEquals(new Set(wiersze(g.id).filter((w) => w.status === "wyslano").map((w) => w.adres)).size, 4);
});

Deno.test("kolejka: 5xx — ponowienie z rosnącym odstępem, po wyczerpaniu prób błąd", opts, async () => {
  reset();
  const g = await botowa(1);
  tgm.odp = (_t, m) => m === "sendMessage" ? J({ ok: false, error_code: 502, description: "Bad Gateway" }, 502) : null;
  const czasy: string[] = [];
  for (let i = 0; i < 4; i++) { await bieg(); czasy.push(wiersze(g.id)[0].status + " " + wiersze(g.id)[0].proby); TERAZ = new Date(TERAZ.getTime() + 2 * 3600000); await api("admin", { action: "wznow", id: g.id }); }
  assertEquals(czasy, ["kolejka 1", "kolejka 2", "kolejka 3", "blad 4"]);
  assert(wiersze(g.id)[0].powod.startsWith("nie udało się po 4 próbach"));
  assertEquals(wyslane().length, 4);
});

Deno.test("kolejka: automatyczne zatrzymanie po serii błędów; wznowienie przez człowieka", opts, async () => {
  reset();
  const g = await botowa(8, { tytul: "Do zatrzymania" });
  tgm.odp = (_t, m) => m === "sendMessage" ? J({ ok: false, error_code: 400, description: "Bad Request: chat not found" }, 400) : null;
  const b = await bieg();
  assertEquals([b.bledy, b.wstrzymane, rozs(g.id).status, rozs(g.id).bledy_z_rzedu], [5, [g.id], "wstrzymana", 5]);
  assertEquals(rozs(g.id).powod, "zatrzymana automatycznie po 5 błędach z rzędu");
  assertEquals(wyslane().length, 5);                                                          // the other three were not tried
  assertEquals(wiersze(g.id).filter((w) => w.status === "kolejka").length, 3);
  assertEquals((await bieg()).pobrane, 0);                                                    // stays stopped
  tgm.odp = null;
  assertEquals((await api("admin", { action: "wznow", id: g.id })).status, "w_trakcie");
  const b2 = await bieg();
  assertEquals([b2.wyslano, rozs(g.id).status, rozs(g.id).bledy_z_rzedu], [3, "zakonczona", 0]);
  // a wrong token stops at once and consumes nothing
  const g2 = await botowa(8, { tytul: "Zły token" });
  tgm.odp = (_t, m) => m === "sendMessage" ? J({ ok: false, error_code: 401, description: "Unauthorized" }, 401) : null;
  await bieg();
  assertEquals([rozs(g2.id).status, rozs(g2.id).powod, wyslane().length, wiersze(g2.id).filter((w) => w.status === "kolejka").length], ["wstrzymana", "Telegram odrzucił token bota", 1, 8]);
});

Deno.test("kolejka: bot zablokowany, wyłączona subskrypcja, przeniesiona grupa, brak odpowiedzi", opts, async () => {
  reset();
  const g = await botowa(4);
  const zabl = T.klient_subskrypcje.find((s) => s.tg_user_id === 7400)!, wyl = T.klient_subskrypcje.find((s) => s.tg_user_id === 7401)!;
  wyl.aktywna = false;                                                                        // /stop after the list was frozen
  tgm.odp = (_t, m, b) => m !== "sendMessage" ? null : b.chat_id === "7400" ? J({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, 403) : b.chat_id === "7402" ? (() => { throw new TypeError("timeout https://api.telegram.org/bot" + TOK_SUB + "/sendMessage"); })() : null;
  const b = await bieg();
  assertEquals([b.wyslano, b.bledy, b.pominieto, b.niepewne], [1, 1, 1, 1]);
  const st = (u: number) => wiersze(g.id).find((w) => w.adres === String(u))!;
  assertEquals([st(7400).status, st(7400).powod, !!zabl.blocked_at], ["blad", "odbiorca zablokował bota albo usunął konto", true]);
  assertEquals([st(7401).status, st(7401).powod], ["pominieto", "subskrypcja została wyłączona przed wysyłką"]);
  assertEquals(st(7402).status, "niepewny");                                                  // maybe delivered: never repeated on its own
  assertEquals(rozs(g.id).bledy_z_rzedu, 0);                                                  // a blocked bot is the recipient's choice, not a failure of ours; then a success reset the count
  tgm.odp = null;
  assertEquals((await bieg()).pobrane, 0);
  assertEquals(rozs(g.id).status, "zakonczona");
  assertEquals((await api("kadry", { action: "ponow_niepewne", id: g.id })).http, 403);
  assertEquals((await api("admin", { action: "ponow_niepewne", id: g.id })).ponowione, 1);    // a person decides to send again
  assertEquals([(await bieg()).wyslano, st(7402).status], [1, "wyslano"]);
  // a row left "in progress" by a run that died is not sent again either
  const g2 = await botowa(4, { tytul: "Przerwana", odbiorcy: { tryb: "recznie", wybrani: [NIPY[3]] } });
  rozs(g2.id).status = "w_trakcie"; Object.assign(wiersze(g2.id)[0], { status: "wysylanie", pobrano_at: "2026-10-09T09:00:00.000Z" });
  await bieg();
  assertEquals([wiersze(g2.id)[0].status, wyslane().length], ["niepewny", 0]);
  // a group that became a supergroup: one more try with the id Telegram gave, and a note for the clients base
  reset();
  const g3 = await gotowa("admin", szkic({ strategia: "wszystkie", kanaly: { grupa: true }, odbiorcy: { tryb: "recznie", wybrani: [NIPY[0]] } }));
  await api("admin2", { action: "akceptuj", id: g3.id, potwierdzenie: { liczby: g3.liczby } });
  tgm.wywolania = [];
  tgm.odp = (_t, m, b) => m === "sendMessage" && b.chat_id === "-1001000000010" ? J({ ok: false, error_code: 400, description: "Bad Request: group chat was upgraded to a supergroup chat", parameters: { migrate_to_chat_id: -1002000000099 } }, 400) : null;
  await bieg();
  assertEquals(wyslane().map((w) => w.body.chat_id), ["-1001000000010", "-1002000000099"]);
  assertEquals([wiersze(g3.id)[0].status, wiersze(g3.id)[0].powod], ["wyslano", "grupa ma nowy identyfikator -1002000000099 — popraw go w bazie klientów"]);
});

Deno.test("kolejka: wstrzymanie, wznowienie, anulowanie, termin i godziny ciszy", opts, async () => {
  reset();
  for (let i = 0; i < 3; i++) await subskrybuj(NIPY[i], 7400 + i);
  const r = szkic(), id = await zapisz("admin", r);
  await pracownik("admin", 8100); await api("admin", { action: "test", id });
  const p = await api("admin", { action: "odbiorcy", rozsylka: r });
  assert((await api("admin", { action: "zglos", id, potwierdzenie: { liczby: p.liczby }, zaplanowana_na: "2026-10-01T08:00:00Z" })).error.includes("Termin"));
  assertEquals((await api("kadry", { action: "zglos", id, potwierdzenie: { liczby: p.liczby }, mimo_ciszy: true })).http, 403);
  assertEquals((await api("admin", { action: "zglos", id, potwierdzenie: { liczby: p.liczby }, zaplanowana_na: "2026-10-09T19:30:00Z" })).status, "zaplanowana");
  tgm.wywolania = [];
  assertEquals([(await bieg()).uruchomione, rozs(id).status], [0, "zaplanowana"]);            // not yet
  TERAZ = new Date("2026-10-09T19:31:00Z");                                                  // 21:31 in Warsaw: outside 08:00–20:00
  const noc = await bieg();
  assertEquals([noc.uruchomione, noc.cisza, noc.pobrane, rozs(id).status, wyslane().length], [1, true, 0, "w_trakcie", 0]);
  assertEquals((await api("admin", { action: "wstrzymaj", id })).status, "wstrzymana");
  TERAZ = new Date("2026-10-10T07:00:00Z");
  assertEquals((await bieg()).pobrane, 0);                                                    // paused
  assertEquals((await api("ksieg", { action: "wznow", id })).http, 403);                      // not the author
  assertEquals((await api("admin", { action: "wznow", id })).status, "w_trakcie");
  assertEquals((await bieg()).wyslano, 3);
  // cancelled before it starts: nobody gets anything, the log says why
  const g = await gotowa("admin", szkic({ tytul: "Do anulowania" }));
  assertEquals((await api("admin", { action: "anuluj", id: g.id })).status, "anulowana");
  const przed = wyslane().length;
  await bieg();
  assertEquals([wyslane().length, wiersze(g.id).filter((w) => w.status === "pominieto" && w.powod === "rozsyłka anulowana").length], [przed, 3]);
  assertEquals((await api("admin", { action: "anuluj", id: g.id })).http, 400);
  // an administrator may send outside the hours on purpose
  TERAZ = new Date("2026-10-10T20:00:00Z");
  const g2 = await gotowa("admin", szkic({ tytul: "Pilne" }), { mimo_ciszy: true });
  tgm.wywolania = [];
  const b = await bieg();
  assertEquals([b.cisza, b.wyslano, rozs(g2.id).status], [true, 3, "zakonczona"]);
});

Deno.test("marketing: akceptacja zawsze; do wysyłki tylko odbiorcy ze zgodą — także gdy zgoda zniknie tuż przed wysyłką", opts, async () => {
  reset();
  const s1 = await subskrybuj(NIPY[0], 7401), s2 = await subskrybuj(NIPY[1], 7402); await subskrybuj(NIPY[2], 7403);
  assertEquals((await api("kadry", { action: "subskrybent", id: s1.id, zgoda: { zgoda: true, zrodlo: "", data: "2026-10-01" } })).http, 400);          // a consent without a source is no record
  assertEquals((await api("kadry", { action: "subskrybent", id: s1.id, zgoda: { zgoda: true, zrodlo: "umowa § 9", data: "2027-01-01" } })).http, 400);
  for (const s of [s1, s2]) assertEquals((await api("kadry", { action: "subskrybent", id: s.id, zgoda: { zgoda: true, zrodlo: "umowa o obsługę § 9", data: "2026-10-01" } })).http, 200);
  assertEquals([s1.zgoda_marketing, s1.zgoda_zrodlo, s1.zgoda_kto, T.klient_zgody.length], [true, "umowa o obsługę § 9", "kadry@example.test", 2]);
  assertEquals((await api("kadry", { action: "zgoda", klient: NIPY[5], kanal: "sms", zgoda: true, zrodlo: "e-mail klienta z 2026-10-02", data: "2026-10-02" })).http, 200);
  assertEquals((await api("kadry", { action: "zgoda", klient: NIPY[6], kanal: "sms", zgoda: true, zrodlo: "formularz", data: "2026-10-02" })).http, 200);
  assertEquals((await api("kadry", { action: "zgoda", klient: NIPY[6], kanal: "sms", zgoda: false, zrodlo: "telefon klienta — wycofanie", data: "2026-10-05" })).http, 200);
  const r = szkic({ tytul: "Oferta", typ: "marketingowa", strategia: "bot_sms", tresc: { ...TRESC, sms: { pl: "Nowa usluga biura — zapytaj opiekuna." } } });
  const o = await api("kadry", { action: "odbiorcy", rozsylka: r });
  assertEquals(o.liczby, { bot: 2, grupa: 0, sms: 1, mail: 0, brak: 5, klienci: 3 });          // 2 subscribers with consent + 1 SMS consent; the withdrawn one is out
  assert(o.akceptacja.includes("rozsyłka marketingowa"));
  assert(o.wiersze.find((w: Any) => w.klient === NIPY[2]).powod.includes("brak zgody marketingowej (Telegram)"));
  assert(o.wiersze.find((w: Any) => w.klient === NIPY[6]).powod.includes("brak zgody marketingowej (SMS)"));
  const g = await gotowa("kadry", r);
  assertEquals(g.status, "do_akceptacji");
  await api("admin", { action: "akceptuj", id: g.id, potwierdzenie: { liczby: g.liczby } });
  await api("kadry", { action: "subskrybent", id: s2.id, zgoda: { zgoda: false, zrodlo: "wiadomość klienta — wycofanie", data: "2026-10-09" } });   // withdrawn after approval
  await api("kadry", { action: "zgoda", klient: NIPY[5], kanal: "sms", zgoda: false, zrodlo: "telefon klienta — wycofanie", data: "2026-10-09" });
  tgm.wywolania = []; smsy.length = 0;
  const b = await bieg();
  assertEquals([b.wyslano, b.pominieto], [1, 2]);
  assertEquals([doKlientow().map((w) => w.body.chat_id), smsy.length], [["7401"], 0]);
  assertEquals(wiersze(g.id).filter((w) => w.powod === "zgoda marketingowa została wycofana przed wysyłką").length, 2);
});

Deno.test("SMS i e-mail: przez strzeżoną wysyłkę SMS (tryb testowy, gdy moduł wyłączony) i skrzynkę biura", opts, async () => {
  reset();
  await subskrybuj(NIPY[0], 7401);
  const tresc = { ...TRESC, sms: { pl: "Prosimy o kontakt, {firma}." }, mail: { temat: { pl: "Informacja dla {firma}" }, tresc: { pl: "Dzień dobry,\nprosimy o kontakt: {link_subskrypcji}" } } };
  const r = szkic({ tytul: "Wielokanałowa", strategia: "wszystkie", kanaly: { bot: true, sms: true, mail: true }, odbiorcy: { tryb: "recznie", wybrani: [NIPY[0], NIPY[2], NIPY[3]] }, tresc });
  const id = await zapisz("kadry", r);
  await pracownik("kadry", 8200);
  tgm.wywolania = [];
  const t = await api("kadry", { action: "test", id, telefon: "+48 111 111 111" });            // a typed number is an administrator's privilege: ignored here
  assertEquals([t.wyniki.telegram, t.wyniki.sms, t.wyniki.sms_test, t.wyniki.mail, t.wyniki.mail_adres], ["ok", "ok", true, "ok", "kadry@example.test"]);
  assertEquals([smsy.length, smsy[0].to, smsy[0].test, maile[0].to, maile[0].subject], [1, "48600900900", "1", "kadry@example.test", "[TEST] Informacja dla Przykładowa Firma 1 sp. z o.o."]);   // the author's own phone and mailbox
  const p = await api("kadry", { action: "odbiorcy", rozsylka: r });
  assertEquals(p.liczby, { bot: 1, grupa: 0, sms: 2, mail: 2, brak: 0, klienci: 3 });
  assertEquals((await api("kadry", { action: "zglos", id, potwierdzenie: { liczby: p.liczby } })).status, "zaplanowana");
  smsy.length = 0; maile.length = 0; tgm.wywolania = [];
  const b = await bieg();
  assertEquals([b.wyslano, b.bledy], [5, 0]);
  assertEquals(smsy.map((s) => [s.to, s.test, s.message]), [["48600100210", "1", "TD Consulting Group: Prosimy o kontakt, Przykladowa Firma 1 sp. z o.o.."], ["48600100213", "1", "TD Consulting Group: Prosimy o kontakt, Przykladowa Firma 4 sp. z o.o.."]]);
  assertEquals(maile.map((m) => [m.to, m.subject]), [["firma1@example.test", "Informacja dla Przykładowa Firma 1 sp. z o.o."], ["firma3@example.test", "Informacja dla Przykładowa Firma 3 sp. z o.o."]]);
  assert(/prosimy o kontakt: https:\/\/t\.me\/TdPowiadomienia_bot\?start=[A-Za-z0-9_-]{32}$/.test(maile[1].text));
  assertEquals(wiersze(id).filter((w) => w.kanal === "sms").map((w) => w.powod), ["tryb testowy SMS — nic nie zostało doręczone", "tryb testowy SMS — nic nie zostało doręczone"]);
  assertEquals(T.sms_wiadomosci.filter((s) => s.cel === "rozsylka" && s.ref === id && s.test === true).length, 2);
  // a mailbox that refuses: an error in the log, without the server's words
  T.portal_klienci[5].dane.email = "odrzuc@example.test";
  const g = await gotowa("kadry", szkic({ tytul: "Sam e-mail", strategia: "wszystkie", kanaly: { mail: true }, odbiorcy: { tryb: "recznie", wybrani: [NIPY[5]] }, tresc }));
  await bieg();
  assertEquals([wiersze(g.id)[0].status, wiersze(g.id)[0].powod], ["blad", "e-mail: serwer pocztowy odrzucił wiadomość (550)"]);
});

Deno.test("dziennik i CSV: zamaskowane adresy, bezpieczne komórki; subskrybenci bez identyfikatorów Telegrama", opts, async () => {
  reset();
  T.portal_klienci[1].dane.nazwa = "=HYPERLINK(\"https://zlo.test\";\"Firma\")"; T.klienci_baza[1].nazwa = T.klienci_obsluga[1].nazwa = T.portal_klienci[1].dane.nazwa;
  const g = await botowa(2);
  await bieg();
  const d = await api("ksieg", { action: "dziennik", id: g.id });
  assertEquals([d.liczby.bot, d.liczby.brak, d.statusy, d.status], [2, 6, { wyslano: 2, pominieto: 6 }, "zakonczona"]);
  assert(d.wiersze.every((w: Any) => !/^\d{4,}$/.test(w.adres)) && d.wiersze.some((w: Any) => w.adres === "czat …400" && w.tg_message_id > 0));
  assertEquals((await api("ksieg", { action: "dziennik", id: g.id, status: "pominieto" })).wiersze.length, 6);
  const c = await api("ksieg", { action: "csv", id: g.id });
  assert(c.csv.startsWith("﻿\"Rozsyłka\";\"Komunikat testowy\"") && c.csv.includes("\"'=HYPERLINK(\"\"https://zlo.test\"\";\"\"Firma\"\")\"") && c.csv.includes("\"brak subskrypcji bota\""));
  assert(!c.csv.includes("7400") && c.nazwa.endsWith(".csv"));
  const s = await api("ksieg", { action: "subskrybenci", klient: NIPY[0] });
  assertEquals([s.subskrybenci.length, s.subskrybenci[0].username, "chat_id" in s.subskrybenci[0], "tg_user_id" in s.subskrybenci[0]], [1, "jan_test7400", false, false]);
  assertEquals((await api("ksieg", { action: "subskrybent", id: s.subskrybenci[0].id, rola: "wlasciciel" })).http, 200);
  assertEquals((await api("ksieg", { action: "subskrybent", id: s.subskrybenci[0].id, wylacz: true })).http, 200);
  assertEquals([T.klient_subskrypcje[0].rola, T.klient_subskrypcje[0].aktywna, T.klient_subskrypcje[0].wylaczyl], ["wlasciciel", false, "ksieg@example.test"]);
  assertEquals((await api("admin", { action: "grupa_flaga", klient: NIPY[0], dozwolona: true })).http, 200);
  assertEquals((await api("ksieg", { action: "klienci" })).klienci[0].grupa_dozwolona, true);
  const l = await api("ksieg", { action: "lista" });
  assertEquals([l.rozsylki[0].statusy, l.rozsylki[0].status], [{ wyslano: 2 }, "zakonczona"]);
  const sz = await api("ksieg", { action: "szablony", data: "2026-11-15" });
  assert(sz.szablony[0].wbudowany && sz.szablony[0].tresc.tg.uk[1].t.includes("15 листопада 2026 р."));
});

Deno.test("cele powiadomień jednego klienta (dla innych funkcji): subskrybenci; bez nich nikt; grupa tylko za zgodą administratora", opts, async () => {
  reset();
  const { celeKlienta, botUrl, zablokowana } = await import("./cele.ts");
  const grupa = "-1001000000010";
  assertEquals(await celeKlienta(NIPY[0], grupa), []);                                        // nobody subscribed, the group not allowed: silence
  assertEquals((await api("admin", { action: "grupa_flaga", klient: NIPY[0], dozwolona: true })).http, 200);
  assertEquals(await celeKlienta(NIPY[0], grupa), [{ chat: grupa, bot: "grupa", subskrypcja: null }]);
  assertEquals(await celeKlienta(NIPY[0], "7001"), []);                                       // what the base holds must be a group id
  const s = await subskrybuj(NIPY[0], 7001); await subskrybuj(NIPY[0], 7002);
  const cele = await celeKlienta(NIPY[0], grupa);
  assertEquals(cele.map((c) => [c.chat, c.bot]), [["7001", "sub"], ["7002", "sub"]]);         // subscribers exist: the group stays quiet even when allowed
  await zablokowana(cele[0]);
  assert(s.blocked_at);
  assertEquals((await celeKlienta(NIPY[0], grupa)).map((c) => c.chat), ["7002"]);
  assertEquals(await celeKlienta("", grupa), []);
  assert(botUrl("sub", "sendDocument").endsWith("/sendDocument") && botUrl("sub", "x") !== botUrl("grupa", "x"));
});

Deno.test("sekrety: żaden token ani hasło nie pojawia się w odpowiedziach, dzienniku ani w bazie", () => {
  const wszystko = wyjscia.join("\n") + JSON.stringify(T);
  for (const s of SEKRETY) assert(!wszystko.includes(s), "wyciekł sekret: " + s.slice(0, 6) + "…");
  assert(wyjscia.length > 100);
  // every Telegram call went to the stand-in and used only the allowed methods
  assertEquals([...new Set(tgm.wywolania.map((w) => w.metoda))].every((m) => ["getMe", "getWebhookInfo", "sendMessage", "answerCallbackQuery", "setWebhook", "deleteWebhook"].includes(m)), true);
});
