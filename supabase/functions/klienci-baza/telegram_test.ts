// deno test supabase/functions/klienci-baza/telegram_test.ts
// The Telegram audit against canned Bot API answers. Fictional groups and bots only.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { Limit, type Metoda, METODY, pogorszenie, powtorzoneCzaty, sprawdzCzat, trescZadania, tytulPasuje, wymaganeBoty } from "./telegram.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const BOT = "111111111", INNY = { nazwa: "Bot księgowy", user_id: "222222222" };
const CHAT = "-1001234567890";
const ok = (result: Any) => ({ ok: true, result });
const err = (error_code: number, description: string, parameters?: Any) => ({ ok: false, error_code, description, parameters });
// a group as the Bot API would describe it; `x` overrides single answers
function grupa(x: Record<string, Any> = {}) {
  const wolane: Array<[Metoda, Record<string, string>]> = [];
  const tg = (m: Metoda, p: Record<string, string> = {}) => {
    wolane.push([m, p]);
    assert((METODY as readonly string[]).includes(m), "metoda spoza listy: " + m);
    if (m === "getChat") return Promise.resolve(x.getChat ?? ok({ id: Number(CHAT), title: "Przykładowa Alfa — biuro", type: "supergroup", permissions: { can_send_messages: true } }));
    if (m === "getChatMember") return Promise.resolve(p.user_id === BOT ? (x.bot ?? ok({ status: "member", user: { id: Number(BOT), is_bot: true } })) : (x.inny ?? ok({ status: "left" })));
    if (m === "getChatMemberCount") return Promise.resolve(x.count ?? ok(7));
    if (m === "getChatAdministrators") return Promise.resolve(x.admini ?? ok([{ status: "creator", user: { id: 1, is_bot: false, first_name: "Osoba" } }]));
    return Promise.resolve(err(400, "nieznane"));
  };
  return { tg, wolane };
}

Deno.test("bot jest członkiem i może pisać -> ok; tytuł, typ, liczba członków", async () => {
  const g = grupa();
  const w = await sprawdzCzat(g.tg, CHAT, BOT, []);
  assertEquals([w.status, w.tytul, w.typ, w.czlonkow, w.bot_status, w.blad], ["ok", "Przykładowa Alfa — biuro", "supergroup", 7, "member", null]);
  assertEquals(g.wolane.map((c) => c[0]), ["getChat", "getChatMember", "getChatMemberCount", "getChatAdministrators"]);
  assert(g.wolane.every((c) => c[1].chat_id === CHAT));
});
Deno.test("bot jest administratorem; inne boty wśród administratorów są wypisane", async () => {
  const g = grupa({ bot: ok({ status: "administrator" }), admini: ok([{ status: "administrator", user: { id: Number(BOT), is_bot: true, username: "portal_bot" } }, { status: "administrator", user: { id: 222222222, is_bot: true, username: "ksiegowy_bot", first_name: "Bot księgowy" } }, { status: "creator", user: { id: 5, is_bot: false } }]) });
  const w = await sprawdzCzat(g.tg, CHAT, BOT, [INNY]);
  assertEquals([w.status, w.bot_status, w.brak_botow], ["ok", "administrator", []]);
  assertEquals(w.boty, [{ id: "222222222", username: "ksiegowy_bot", nazwa: "Bot księgowy" }]); // our own bot is not listed
  assertEquals(g.wolane.filter((c) => c[0] === "getChatMember").length, 1); // the other bot was seen among the administrators — no extra call
});
Deno.test("wymagany bot: obecny jako zwykły członek; nieobecny -> brak_bota", async () => {
  assertEquals((await sprawdzCzat(grupa({ inny: ok({ status: "member" }) }).tg, CHAT, BOT, [INNY])).status, "ok");
  const w = await sprawdzCzat(grupa().tg, CHAT, BOT, [INNY]);
  assertEquals([w.status, w.brak_botow], ["brak_bota", ["Bot księgowy"]]);
  assert(w.blad!.includes("nie jest administratorem")); // our bot is a plain member: the answer may be incomplete
  const adm = await sprawdzCzat(grupa({ bot: ok({ status: "administrator" }) }).tg, CHAT, BOT, [INNY]);
  assertEquals(adm.status, "brak_bota"); assert(!adm.blad!.includes("nie jest administratorem"));
  assertEquals((await sprawdzCzat(grupa({ inny: err(400, "Bad Request: user not found") }).tg, CHAT, BOT, [INNY])).status, "brak_bota");
  assertEquals((await sprawdzCzat(grupa({ inny: ok({ status: "kicked" }) }).tg, CHAT, BOT, [INNY])).status, "brak_bota");
});
Deno.test("bot opuścił grupę / został usunięty -> bot_usuniety", async () => {
  assertEquals((await sprawdzCzat(grupa({ bot: ok({ status: "left" }) }).tg, CHAT, BOT, [])).status, "bot_usuniety");
  const k = await sprawdzCzat(grupa({ bot: ok({ status: "kicked" }) }).tg, CHAT, BOT, []);
  assertEquals(k.status, "bot_usuniety"); assert(k.blad!.includes("usunięty"));
  const g = grupa({ getChat: err(403, "Forbidden: bot was kicked from the supergroup chat") });
  assertEquals((await sprawdzCzat(g.tg, CHAT, BOT, [])).status, "bot_usuniety"); assertEquals(g.wolane.length, 1);
  assertEquals((await sprawdzCzat(grupa({ getChat: err(403, "Forbidden: bot is not a member of the supergroup chat") }).tg, CHAT, BOT, [])).status, "bot_usuniety");
});
Deno.test("bot ograniczony albo grupa bez prawa pisania -> bot_bez_praw", async () => {
  assertEquals((await sprawdzCzat(grupa({ bot: ok({ status: "restricted", can_send_messages: false }) }).tg, CHAT, BOT, [])).status, "bot_bez_praw");
  assertEquals((await sprawdzCzat(grupa({ bot: ok({ status: "restricted", can_send_messages: true }) }).tg, CHAT, BOT, [])).status, "ok");
  // members may not write in this group and the bot is a plain member
  const zamk = ok({ title: "Przykładowa", type: "supergroup", permissions: { can_send_messages: false } });
  assertEquals((await sprawdzCzat(grupa({ getChat: zamk }).tg, CHAT, BOT, [])).status, "bot_bez_praw");
  assertEquals((await sprawdzCzat(grupa({ getChat: zamk, bot: ok({ status: "administrator" }) }).tg, CHAT, BOT, [])).status, "ok");
});
Deno.test("czat nie istnieje; grupa przeniesiona — nowe id tylko jako podpowiedź", async () => {
  const b = await sprawdzCzat(grupa({ getChat: err(400, "Bad Request: chat not found") }).tg, CHAT, BOT, []);
  assertEquals([b.status, b.nowe_id], ["brak_czatu", null]);
  const p = await sprawdzCzat(grupa({ getChat: err(400, "Bad Request: group chat was upgraded to a supergroup chat", { migrate_to_chat_id: -1009876543210 }) }).tg, "-123456789", BOT, []);
  assertEquals([p.status, p.nowe_id, p.chat_id], ["przeniesiona", "-1009876543210", "-123456789"]);
  assertEquals((await sprawdzCzat(grupa({ getChat: err(500, "Internal Server Error") }).tg, CHAT, BOT, [])).status, "blad");
});
Deno.test("limit zapytań (429) przerywa — z czasem podanym przez Telegram", async () => {
  const e = await assertRejects(() => sprawdzCzat(grupa({ getChat: err(429, "Too Many Requests: retry after 17", { retry_after: 17 }) }).tg, CHAT, BOT, []), Limit);
  assertEquals(e.sekund, 17);
  await assertRejects(() => sprawdzCzat(grupa({ count: err(429, "Too Many Requests") }).tg, CHAT, BOT, []), Limit);
});
Deno.test("brak id, id dodatnie, zły format, czat prywatny — bez zapytań albo z jednym", async () => {
  const g = grupa();
  assertEquals((await sprawdzCzat(g.tg, "", BOT, [])).status, "brak_grupy");
  assertEquals((await sprawdzCzat(g.tg, "123456789", BOT, [])).status, "zly_id");
  assertEquals((await sprawdzCzat(g.tg, "@grupa", BOT, [])).status, "zly_id");
  assertEquals((await sprawdzCzat(g.tg, "-12", BOT, [])).status, "zly_id");
  assertEquals(g.wolane.length, 0);
  assertEquals((await sprawdzCzat(grupa({ getChat: ok({ type: "private", first_name: "Osoba" }) }).tg, CHAT, BOT, [])).status, "zly_id");
});

Deno.test("pogorszenie: co trafia do zadania dla administratora", () => {
  assert(pogorszenie("ok", "bot_usuniety")); assert(pogorszenie("ok", "brak_czatu")); assert(pogorszenie("ok", "brak_bota")); assert(pogorszenie("ok", "brak_grupy"));
  assert(pogorszenie(null, "brak_grupy")); // a new client without a group
  assert(pogorszenie("brak_bota", "bot_usuniety"));
  assert(!pogorszenie(null, "ok")); assert(!pogorszenie("bot_usuniety", "ok")); assert(!pogorszenie("bot_usuniety", "brak_bota")); assert(!pogorszenie("brak_grupy", "brak_grupy"));
  assert(!pogorszenie("ok", "blad")); // trouble reaching Telegram is not news about the group
});
Deno.test("trescZadania, tytulPasuje, powtorzoneCzaty, wymaganeBoty", () => {
  const t = trescZadania([{ nazwa: "Przykładowa Alfa sp. z o.o.", bylo: "ok", jest: "bot_usuniety" }, { nazwa: "Przykładowa Beta", bylo: null, jest: "brak_grupy" }]);
  assertEquals(t.tytul, "Telegram: 2 grup klientów wymaga uwagi");
  assert(t.opis.includes("• Przykładowa Alfa sp. z o.o. — bot portalu usunięty z grupy (było: w porządku)")); assert(t.opis.includes("• Przykładowa Beta — brak grupy"));
  assert(trescZadania(Array.from({ length: 300 }, (_, i) => ({ nazwa: "Klient " + i, bylo: null, jest: "brak_grupy" as const }))).opis.length <= 3900);
  assert(tytulPasuje("Przykładowa ALFA / TD biuro", "Przykładowa Alfa sp. z o.o.")); assert(tytulPasuje("Wzorcowy księgowość", "Usługi Testowe Jan Wzorcowy"));
  assert(!tytulPasuje("Zupełnie inna grupa", "Przykładowa Alfa sp. z o.o.")); assert(tytulPasuje("", "Alfa")); assert(tytulPasuje("cokolwiek", "sp. z o.o."));
  assertEquals([...powtorzoneCzaty([{ nazwa: "A", telegram: CHAT }, { nazwa: "B", telegram: CHAT }, { nazwa: "C", telegram: "-100999" }, { nazwa: "D", telegram: "" }])], [[CHAT, ["A", "B"]]]);
  assertEquals(wymaganeBoty([{ nazwa: " Bot  księgowy ", user_id: "222222222" }, { nazwa: "x", user_id: "abc" }, { nazwa: "", user_id: "333333333" }, { nazwa: "dubel", user_id: "222222222" }, null]), [{ nazwa: "Bot księgowy", user_id: "222222222" }]);
  assertEquals(wymaganeBoty("x"), []);
});
