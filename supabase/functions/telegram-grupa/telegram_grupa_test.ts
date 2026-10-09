// deno test supabase/functions/telegram-grupa/telegram_grupa_test.ts
// No network: Telegram is a fake that records the requests and answers like the real API does.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type Kroki, Odmowa, postep, Przerwa, zbudujGrupe } from "./core.ts";
import { cechyKlienta, type Dane, DOMYSLNY, grupuj, mikrorachunek, normalizujSzablon, nrbOk, podstaw, rachunekZus, warunekPasuje, zbudujPlan } from "./szablony.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

// fictional client: NIP with a valid check digit that belongs to nobody, ZUS account built from it
const NIP = "1111111111";
const zusZ = (nip: string) => { const b = "60000002026" + "001" + nip; let r = 0; for (const c of b + "252100") r = (r * 10 + Number(c)) % 97; return String(98 - r).padStart(2, "0") + b; };
const ZUS = zusZ(NIP);
const dane = (zm: Partial<Dane["klient"]> = {}, osoby = true): Dane => ({
  klient: { id: NIP, nip: NIP, nazwa: "Przykładowa Firma Testowa", forma: "JDG", opodatkowanie: "Ryczałt", miasto: "Warszawa", opiekun: "Testowa A.", kadrowy: "Przykładowa B.", jezyk: "Russian", rachunek_zus: ZUS, ...zm },
  ksiegowa: osoby ? { imie_nazwisko: "Anna Testowa", telegram_username: "anna_testowa", email: "a@przyklad.pl" } : null,
  kadrowa: osoby ? { imie_nazwisko: "Beata Przykładowa", telegram_username: "beata_przyk", email: "b@przyklad.pl" } : null,
  stawka: "31,40",
});

Deno.test("accounts: micro-account from NIP and the ZUS account check", () => {
  const m = mikrorachunek(NIP);
  assertEquals(m.length, 26);
  assert(nrbOk(m));
  assertEquals(m.slice(2, 14), "101000712222");
  assertEquals(m.slice(14, 24), NIP);
  assertEquals(mikrorachunek("1234567890"), ""); // wrong check digit
  assertEquals(rachunekZus(grupuj(ZUS), NIP), { nrb: ZUS });
  assertEquals(rachunekZus("PL" + ZUS, NIP).nrb, ZUS);
  assert(rachunekZus(ZUS.slice(0, 25) + (ZUS[25] === "0" ? "1" : "0"), NIP).blad);
  assert(rachunekZus("123", NIP).blad);
  assert(rachunekZus(zusZ("2222222222"), NIP).uwaga); // another payer's account
  assertEquals(rachunekZus("", NIP), { nrb: "" });
});

Deno.test("conditions and placeholders", () => {
  assertEquals(cechyKlienta({ forma: "spółka z o.o.", opodatkowanie: "pełna księgowość" }).podatek, "cit");
  assertEquals(cechyKlienta({ forma: "JDG", opodatkowanie: "Skala podatkowa" }).podatek, "skala");
  assertEquals(cechyKlienta({ forma: "JDG", opodatkowanie: "Podatek liniowy" }).podatek, "liniowy");
  assertEquals(cechyKlienta({ forma: "JDG", opodatkowanie: null }).podatek, "inne");
  assertEquals(cechyKlienta({ forma: "spółka komandytowo-akcyjna" }).podatek, "inne");
  const c = cechyKlienta({ forma: "JDG", opodatkowanie: "Ryczałt", jezyk: "Ukrainian", opiekun: "x" });
  assert(warunekPasuje("", c) && warunekPasuje("podatek=ryczalt", c) && warunekPasuje("jezyk=pl|uk", c) && warunekPasuje("podatek=ryczalt;zakres=ksiegowosc", c));
  assert(!warunekPasuje("podatek=cit", c) && !warunekPasuje("zakres=kadry", c) && !warunekPasuje("cos=1", c));
  const p = podstaw("A {{firma}} {{#ma}}tak {{x}}{{/ma}}{{#nie}}nie{{/nie}} {{brak}}", { firma: "X & <Y>", x: "1" }, { ma: true });
  assertEquals(p, { tekst: "A X &amp; &lt;Y&gt; tak 1 {{brak}}", braki: ["brak"] });
});

Deno.test("plan: variants by taxation and language, people, blockers", () => {
  const { plan, podglad } = zbudujPlan(DOMYSLNY, dane());
  assertEquals(plan.tytul, "PRZYKŁADOWA FIRMA TESTOWA - Księgowość");
  assertEquals(plan.tematy.map((t) => t.nazwa + ":" + t.wiadomosci.map((w) => w.klucz.split("/")[1]).join(",")), ["General:wazne,powitanie", "Księgowość:platnosci_ryczalt", "Kadry:zatrudnienie_ru"]);
  assertEquals(podglad.blokady, []);
  const ks = plan.tematy[1].wiadomosci[0].html;
  assert(ks.includes(grupuj(mikrorachunek(NIP))) && ks.includes(grupuj(ZUS)) && !ks.includes("{{"));
  assert(plan.tematy[2].wiadomosci[0].html.includes("31,40 zł"));
  const pow = plan.tematy[0].wiadomosci[1].html;
  assert(pow.includes("<strong>Anna</strong> - ваш бухгалтер\n@anna_testowa") && pow.includes("<strong>Beata</strong>") && pow.includes("@beata_przyk"));
  assertEquals(plan.osoby.map((o) => o.username), ["anna_testowa", "beata_przyk"]);
  assertEquals(plan.boty, [{ username: "twojksiegowy_bot", admin: true }]);
  // no real account number or person may sit in the default texts
  for (const t of DOMYSLNY.tematy) for (const w of t.wiadomosci) assert(!/\d{2} ?6000 ?0002/.test(w.html) && !/USER|RACHUNEK/.test(w.html), w.klucz);

  // a company: CIT text; a Polish-speaking client: the three-language HR text
  const sp = zbudujPlan(DOMYSLNY, dane({ forma: "spółka z o.o.", opodatkowanie: "pełna księgowość", jezyk: "Polish" })).plan;
  assertEquals([sp.tematy[1].wiadomosci[0].klucz, sp.tematy[2].wiadomosci[0].klucz], ["ksiegowosc/platnosci_cit", "kadry/zatrudnienie_3j"]);
  // chosen by hand, edited, unticked
  const r = zbudujPlan(DOMYSLNY, dane(), { tytul: "Moja nazwa", warianty: { "ksiegowosc/Instrukcja płatności": "platnosci_ogolne", "kadry/Instrukcja zatrudnienia": "" }, wiadomosci: { "general/powitanie": { wlacz: false }, "general/wazne": { html: "<b>Zmienione</b> {{nip}}", przypnij: false } }, osoby: { kadrowa: false } });
  assertEquals(r.plan.tytul, "Moja nazwa");
  assertEquals(r.plan.tematy.map((t) => t.wiadomosci.map((w) => w.klucz + (w.przypnij ? "*" : "")).join(",")), ["general/wazne", "ksiegowosc/platnosci_ogolne*", ""]);
  assertEquals(r.plan.tematy[0].wiadomosci[0].html, "<b>Zmienione</b> " + NIP);
  assertEquals(r.plan.osoby.map((o) => o.rola), ["ksiegowa"]);

  // missing data blocks the creation instead of posting holes
  const b = zbudujPlan(DOMYSLNY, dane({ rachunek_zus: null }, false));
  assert(b.podglad.blokady.some((x) => x.includes("{{rachunek_zus}}")) && b.podglad.blokady.some((x) => x.includes("{{ksiegowa_imie}}")));
  assert(b.podglad.ostrzezenia.some((x) => x.includes("nie jest przypisany do nikogo")));
  // a client without HR: that part of the welcome is dropped, nothing blocks
  const bezKadr = zbudujPlan(DOMYSLNY, { ...dane({ kadrowy: null }), kadrowa: null });
  assertEquals(bezKadr.podglad.blokady, []);
  assert(!bezKadr.plan.tematy[0].wiadomosci[1].html.includes("кадровый специалист"));
  assert(zbudujPlan(DOMYSLNY, dane(), { rachunek_zus: "12" }).podglad.blokady.length > 0);
  assert(zbudujPlan(DOMYSLNY, dane(), { tytul: "x".repeat(200) }).podglad.blokady.some((x) => x.includes("za długa")));
});

Deno.test("template: stored shape is tidied, nonsense refused", () => {
  assertEquals(normalizujSzablon(null), { szablon: DOMYSLNY, bledy: [] });
  assertEquals(normalizujSzablon(structuredClone(DOMYSLNY)), { szablon: DOMYSLNY, bledy: [] });
  const n = normalizujSzablon({ tytul: " {{firma}} ", limit_dzienny: 999, stawka_godzinowa: "31.4", boty: [{ username: "@moj_bot" }, { username: "zły bot" }], tematy: [{ nazwa: "cokolwiek", wiadomosci: [{ html: " <b>a</b> " }] }, { nazwa: "Nowy temat", wiadomosci: [{ nazwa: "X", html: "" }, { nazwa: "Y", html: "y", warunek: "drop table" }] }] });
  assertEquals(n.szablon.tematy.map((t) => [t.klucz, t.nazwa, t.ogolny, t.wiadomosci.length]), [["general", "General", true, 1], ["nowy_temat", "Nowy temat", false, 1]]);
  assertEquals([n.szablon.limit_dzienny, n.szablon.stawka_godzinowa, n.szablon.boty], [10, "31,4", [{ username: "moj_bot", admin: true }]]);
  assertEquals(n.bledy.length, 3);
});

// ---------------------------------------------------------------- the fake Telegram
function falszywy(opcje: { blad?: (z: Any, n: number) => Any; chats?: Any[] } = {}) {
  const log: Any[] = [];
  let msg = 10;
  const tg = {
    invoke: (z: Any) => {
      log.push(z);
      z.getBytes(); // every request must serialise as GramJS would send it
      const b = opcje.blad?.(z, log.length);
      if (b) return Promise.reject(b);
      switch (z.className) {
        case "channels.CreateChannel": return Promise.resolve({ chats: [{ className: "Channel", id: 5550001, accessHash: "777", forum: true }] });
        case "messages.GetDialogs": return Promise.resolve({ chats: opcje.chats ?? [] });
        case "channels.GetForumTopics": return Promise.resolve({ topics: [{ className: "ForumTopic", title: "Księgowość", id: 2 }] });
        case "channels.CreateForumTopic": { const id = ++msg; return Promise.resolve({ updates: [{ className: "UpdateNewChannelMessage", message: { id, action: { className: "MessageActionTopicCreate" } } }] }); }
        case "messages.SendMessage": { const id = ++msg; return Promise.resolve({ updates: [{ className: "UpdateMessageID", id }, { className: "UpdateNewChannelMessage", message: { id } }] }); }
        case "messages.UpdatePinnedMessage": return Promise.resolve({ updates: [] });
        case "messages.EditChatDefaultBannedRights": return Promise.resolve({ updates: [] });
        case "messages.ExportChatInvite": return Promise.resolve({ link: "https://t.me/+PrzykladowyLinkTestowy" });
        case "contacts.ResolveUsername": return Promise.resolve({ users: [{ className: "User", id: 900 + log.length, accessHash: "1", bot: /bot$/.test(z.username) }] });
        case "channels.InviteToChannel": return Promise.resolve({ updates: {}, missingInvitees: [] });
        case "channels.EditAdmin": return Promise.resolve({ updates: [] });
      }
      return Promise.reject(Object.assign(new Error("nieznane"), { errorMessage: "METHOD_INVALID" }));
    },
  };
  return { tg, log, nazwy: () => log.map((z) => z.className.split(".")[1]) };
}
const bezPauzy = { pauza: () => Promise.resolve(), ziarno: "00000000-0000-4000-8000-000000000001" };
const PLAN = zbudujPlan(DOMYSLNY, dane()).plan;

Deno.test("run: the whole group in order, every step persisted", async () => {
  const f = falszywy(), zapisy: string[] = [];
  const w = await zbudujGrupe(f.tg, PLAN, (_k, opis) => { zapisy.push(opis); return Promise.resolve(); }, bezPauzy);
  assertEquals(f.nazwy(), ["CreateChannel", "CreateForumTopic", "CreateForumTopic", "SendMessage", "UpdatePinnedMessage", "SendMessage", "SendMessage", "UpdatePinnedMessage", "SendMessage", "UpdatePinnedMessage",
    "EditChatDefaultBannedRights", "ExportChatInvite", "ResolveUsername", "InviteToChannel", "EditAdmin", "ResolveUsername", "InviteToChannel", "EditAdmin", "ResolveUsername", "InviteToChannel", "EditAdmin"]);
  assertEquals([w.chat_id, w.link, w.braki, w.ostrzezenia], ["-1005550001", "https://t.me/+PrzykladowyLinkTestowy", [], []]);
  assertEquals(w.kroki.tematy, { general: 1, ksiegowosc: 11, kadry: 12 });
  assertEquals(w.kroki.boty, { twojksiegowy_bot: "admin" });
  assertEquals(w.kroki.osoby, { anna_testowa: "admin", beata_przyk: "admin" });
  const cr = f.log[0];
  assertEquals([cr.title, cr.megagroup, cr.forum], [PLAN.tytul, true, true]);
  // General: no reply header; a topic: reply to the topic's first message; text parsed from HTML; pin is silent
  const wys = f.log.filter((z) => z.className === "messages.SendMessage");
  assertEquals(wys.map((z) => z.replyTo?.topMsgId ?? null), [null, null, 11, 12]);
  assert(wys[0].message.startsWith("WAŻNE INFORMACJE") && wys[0].entities[0].className === "MessageEntityBold" && wys.every((z) => !/<\/?strong>/.test(z.message)));
  assert(f.log.filter((z) => z.className === "messages.UpdatePinnedMessage").every((z) => z.silent === true));
  const admin = f.log.find((z) => z.className === "channels.EditAdmin").adminRights;
  assertEquals([admin.manageTopics, admin.deleteMessages, admin.pinMessages, admin.inviteUsers, admin.addAdmins ?? false, admin.banUsers ?? false], [true, true, true, true, false, false]);
  assert(zapisy.includes("grupa utworzona") && zapisy.at(-1)!.startsWith("zaproszenie"));
  assert(postep(PLAN, w.kroki).every((p) => p.stan === "ok"));
  assertEquals(postep(PLAN, {}).filter((p) => p.stan === "czeka").length, postep(PLAN, {}).length);
});

Deno.test("run: a failure half-way is continued without a second group or repeated messages", async () => {
  let stan: Kroki = {};
  const f1 = falszywy({ blad: (z, n) => (z.className === "messages.SendMessage" && n >= 6 ? Object.assign(new Error("x"), { errorMessage: "CHAT_WRITE_FORBIDDEN" }) : null) });
  const e = await assertRejects(() => zbudujGrupe(f1.tg, PLAN, (k) => { stan = k; return Promise.resolve(); }, bezPauzy), Odmowa);
  assertEquals(e.kod, "CHAT_WRITE_FORBIDDEN");
  assert(stan.kanal && Object.keys(stan.wiadomosci ?? {}).length === 1 && !stan.koniec);
  const f2 = falszywy();
  const w = await zbudujGrupe(f2.tg, PLAN, (k) => { stan = k; return Promise.resolve(); }, { ...bezPauzy, kroki: stan });
  assert(!f2.nazwy().includes("CreateChannel") && !f2.nazwy().includes("CreateForumTopic"));
  assertEquals(f2.nazwy().filter((n) => n === "SendMessage").length, 3);
  assertEquals(w.chat_id, "-1005550001");
  // the same message always carries the same random id, so Telegram itself refuses a repeat
  const rid = (f: ReturnType<typeof falszywy>, i: number) => String(f.log.filter((z) => z.className === "messages.SendMessage")[i].randomId);
  const f3 = falszywy(); await zbudujGrupe(f3.tg, PLAN, () => Promise.resolve(), bezPauzy);
  const f4 = falszywy(); await zbudujGrupe(f4.tg, PLAN, () => Promise.resolve(), bezPauzy);
  assertEquals(rid(f3, 0), rid(f4, 0));
  assert(rid(f3, 0) !== rid(f3, 1));
});

Deno.test("run: a group created but not recorded is found again, not created twice", async () => {
  const proba = new Date().toISOString();
  const f = falszywy({ chats: [{ className: "Channel", megagroup: true, creator: true, title: PLAN.tytul, date: Math.floor(Date.now() / 1000), id: 5550009, accessHash: "9" }],
    blad: (z) => (z.className === "messages.SendMessage" || z.className === "channels.CreateForumTopic" ? Object.assign(new Error("x"), { errorMessage: "RANDOM_ID_DUPLICATE" }) : null) });
  const e = await assertRejects(() => zbudujGrupe(f.tg, PLAN, () => Promise.resolve(), { ...bezPauzy, kroki: { proba_at: proba } }), Odmowa);
  assertEquals(e.kod, "BRAK_ID_TEMATU"); // "Kadry" is in neither the answer nor the topic list of the fake
  assert(!f.nazwy().includes("CreateChannel"));
  // with nothing to adopt, the group is created
  const g = falszywy();
  const w = await zbudujGrupe(g.tg, PLAN, () => Promise.resolve(), { ...bezPauzy, kroki: { proba_at: proba } });
  assertEquals(g.nazwy().slice(0, 2), ["GetDialogs", "CreateChannel"]);
  assertEquals(w.chat_id, "-1005550001");
});

Deno.test("run: flood waits, privacy refusals, a bot that cannot be added", async () => {
  // a short wait is waited out and the request repeated
  const czekania: number[] = [];
  let raz = false;
  const f = falszywy({ blad: (z) => (z.className === "messages.ExportChatInvite" && !raz ? (raz = true, Object.assign(new Error("flood"), { seconds: 7, errorMessage: "FLOOD" })) : null) });
  await zbudujGrupe(f.tg, PLAN, () => Promise.resolve(), { ...bezPauzy, pauza: (ms) => { czekania.push(ms); return Promise.resolve(); } });
  assert(czekania.includes(8000) && czekania.filter((c) => c !== 8000).every((c) => c >= 700 && c < 1000));
  // a long one stops the run with the state saved
  let stan: Kroki = {};
  const g = falszywy({ blad: (z) => (z.className === "channels.CreateForumTopic" ? Object.assign(new Error("flood"), { errorMessage: "FLOOD_WAIT_300" }) : null) });
  const p = await assertRejects(() => zbudujGrupe(g.tg, PLAN, (k) => { stan = k; return Promise.resolve(); }, bezPauzy), Przerwa);
  assertEquals([p.sekund, p.powod, !!stan.kanal], [300, "flood", true]);
  // the time budget
  let t = 0;
  const b = await assertRejects(() => zbudujGrupe(falszywy().tg, PLAN, () => Promise.resolve(), { ...bezPauzy, teraz: () => (t += 30000), budzetMs: 100000 }), Przerwa);
  assertEquals(b.powod, "budzet");
  // a person's privacy is a warning; a missing bot is a gap, and the group itself is finished
  const h = falszywy({ blad: (z) => (z.className === "channels.InviteToChannel" ? Object.assign(new Error("x"), { errorMessage: h.log.at(-2)?.username === "twojksiegowy_bot" ? "CHAT_ADMIN_REQUIRED" : "USER_PRIVACY_RESTRICTED" }) : null) });
  const w = await zbudujGrupe(h.tg, PLAN, () => Promise.resolve(), bezPauzy);
  assertEquals([w.kroki.koniec, w.kroki.boty!.twojksiegowy_bot, w.kroki.osoby!.anna_testowa], [true, "blad: CHAT_ADMIN_REQUIRED", "pominieta: USER_PRIVACY_RESTRICTED"]);
  assertEquals([w.braki.length, w.ostrzezenia.length], [1, 2]);
  assert(w.ostrzezenia[0].includes("prywatności") && !JSON.stringify(w).includes("Error"));
  // the raw error text never travels: only a code
  const s = falszywy({ blad: (z) => (z.className === "channels.CreateChannel" ? new Error("sekret 1BVtsOK-sesja") : null) });
  const o = await assertRejects(() => zbudujGrupe(s.tg, PLAN, () => Promise.resolve(), bezPauzy), Odmowa);
  assertEquals(o.kod, "BLAD_POLACZENIA");
  assert(!o.message.includes("sekret"));
});
