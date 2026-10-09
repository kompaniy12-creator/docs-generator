// The subscription bot's update receiver (Telegram webhook). No portal session here: the only caller is
// Telegram, and it proves itself with the header X-Telegram-Bot-Api-Secret-Token = secret TG_WEBHOOK_SECRET
// (given to Telegram once, by the administrator's action `webhook_ustaw` of the komunikacja function).
// Without that secret configured the function refuses everything.
//
// Handles only message / my_chat_member / callback_query, and only in PRIVATE chats: anything that
// happens in a group is ignored without a word — the bot never answers in groups.
//   /start <token>   ties this Telegram user to the client the invitation belongs to; the answer names the
//                    client, so a wrong link is noticed. Without a valid token: one neutral sentence, the
//                    same for a missing, wrong, expired, revoked or used-up token — nothing about any client.
//   /stop            switches the notifications off
//   /pl /ru /uk, /jezyk pl|ru|uk   the language of messages; /jezyk alone lists the commands (and shows buttons)
//   /privacy         what is stored                         /help and anything else: short help
//   my_chat_member   "kicked" = the user blocked the bot -> the subscription is marked blocked
// MESSAGES ARE ENOUGH. The updates may arrive forwarded by another application that Telegram sends only
// `message` updates to: every function a subscriber needs has a text command; callback_query (the language
// buttons) and my_chat_member are handled when they come but nothing depends on them — a blocked bot is
// also noticed from the 403 at the next delivery. The body is exactly what Telegram would send; the
// forwarder is not trusted to have filtered anything (chat type, sender and update_id are checked here).
// An update is processed once (update_id), every user is rate-limited, nothing a user typed is ever
// repeated back, and the answer is always 200 so that Telegram does not retry.

import { czytaj, db, enc, klienci, rpc, tg, ustawienia, WEBHOOK_SECRET, zmien } from "../komunikacja/core.ts";
import { BOT, BOT_PRACOWNIK_LINK_KLIENTA, BOT_PRACOWNIK_OK, BOT_WYBOR_JEZYKA, type Jezyk, jezykTg, sha256hex, staleRowne, TOKEN_RE, wBocie } from "../komunikacja/logic.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const ok = () => new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
const idOk = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

const napisz = (chat: number, text: string, extra: Any = {}) => tg("sub", "sendMessage", { chat_id: chat, text, link_preview_options: { is_disabled: true }, ...extra });
async function mojeSuby(user: number): Promise<Any[]> {
  return await czytaj(`klient_subskrypcje?select=id,klient,pracownik,jezyk,aktywna,blocked_at&tg_user_id=eq.${user}&order=subscribed_at.desc`);
}
const jezykOsoby = (suby: Any[], from: Any): Jezyk => (suby.find((s) => s.aktywna && s.klient) ?? suby.find((s) => s.klient))?.jezyk ?? jezykTg(from?.language_code);

async function start(from: Any, arg: string) {
  const user = from.id as number, suby = await mojeSuby(user), j = jezykOsoby(suby, from);
  if (!TOKEN_RE.test(arg)) {
    await napisz(user, suby.some((s) => s.aktywna) ? BOT[j].pomoc : BOT[j].link);
    return;
  }
  // guessing tokens is pointless (192 bits) — and after a few tries in an hour the bot stops answering at all
  if (!(await rpc<boolean>("tg_limit", { p_klucz: "start:" + user, p_max: 6, p_okno_s: 3600 }))) return;
  const s = (v: unknown, n: number) => typeof v === "string" ? v.slice(0, n) : null;
  const w = await rpc<Any>("tg_subskrybuj", {
    p_hash: await sha256hex(arg), p_user: user, p_imie: s(from.first_name, 100), p_nazwisko: s(from.last_name, 100), p_username: s(from.username, 64),
    p_lang: s(from.language_code, 16), p_jezyk: jezykTg(from.language_code),
  });
  if (w?.wynik === "pracownik") { await napisz(user, BOT_PRACOWNIK_LINK_KLIENTA); return; }
  if ((w?.wynik === "ok" || w?.wynik === "juz") && w.pracownik) { await napisz(user, BOT_PRACOWNIK_OK); return; }
  if (w?.wynik === "ok" || w?.wynik === "juz") {
    let jezyk: Jezyk = w.jezyk === "ru" || w.jezyk === "uk" ? w.jezyk : "pl";
    if (w.wynik === "ok") {
      // the client's language of communication (clients base) wins over the phone's interface language
      const k = (await klienci().catch(() => [])).find((x) => x.id === w.klient);
      if (k?.jezyk && k.jezyk !== jezyk) { jezyk = k.jezyk; await zmien(`klient_subskrypcje?klient=eq.${enc(w.klient)}&tg_user_id=eq.${user}`, { jezyk }); }
    }
    await napisz(user, wBocie(BOT[jezyk][w.wynik], String(w.nazwa ?? "")));
    return;
  }
  await napisz(user, BOT[j].link); // zly / wygasl / cofniety / limit: one answer for all
}

async function wiadomosc(m: Any) {
  // private chats only; a message "from" somebody else than the chat's owner is not a private message
  if (m?.chat?.type !== "private" || !idOk(m.from?.id) || m.from.is_bot === true || m.from.id !== m.chat.id) return;
  const user = m.from.id as number;
  if (!(await rpc<boolean>("tg_limit", { p_klucz: "u:" + user, p_max: 20, p_okno_s: 60 }))) return;
  const t = typeof m.text === "string" ? m.text.trim().slice(0, 200) : "";
  const c = /^\/([a-z_]{1,20})(?:@[A-Za-z0-9_]{3,40})?(?:\s+(\S{1,80}))?\s*$/i.exec(t);
  const cmd = (c?.[1] ?? "").toLowerCase();
  if (cmd === "start") return await start(m.from, c?.[2] ?? "");
  const suby = await mojeSuby(user), j = jezykOsoby(suby, m.from);
  if (cmd === "stop") {
    const r = await db(`klient_subskrypcje?tg_user_id=eq.${user}&aktywna=is.true`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ aktywna: false, unsubscribed_at: new Date().toISOString(), wylaczyl: "uzytkownik" }) });
    const ile = r.ok ? (await r.json()).length : 0;
    await napisz(user, ile ? BOT[j].stop : BOT[j].stop_brak);
    return;
  }
  const jezykCmd = ["jezyk", "language", "lang", "mova", "yazyk"].includes(cmd);
  const wybrany = ({ pl: "pl", ru: "ru", uk: "uk", ua: "uk" } as Record<string, Jezyk>)[jezykCmd ? (c?.[2] ?? "").toLowerCase() : cmd];
  if (wybrany) {
    await zmien(`klient_subskrypcje?tg_user_id=eq.${user}`, { jezyk: wybrany });
    await napisz(user, BOT[wybrany].jezyk);
    return;
  }
  if (jezykCmd) {
    await napisz(user, BOT_WYBOR_JEZYKA, { reply_markup: { inline_keyboard: [[{ text: "Polski", callback_data: "j:pl" }, { text: "Русский", callback_data: "j:ru" }, { text: "Українська", callback_data: "j:uk" }]] } });
    return;
  }
  if (cmd === "privacy") {
    const u = await ustawienia().catch(() => null);
    await napisz(user, BOT[j].prywatnosc + (u?.polityka_url ? "\n" + u.polityka_url : ""));
    return;
  }
  await napisz(user, suby.some((s) => s.aktywna) ? BOT[j].pomoc : BOT[j].link);
}

async function przycisk(q: Any) {
  const user = q?.from?.id, m = /^j:(pl|ru|uk)$/.exec(typeof q?.data === "string" ? q.data : "");
  if (!idOk(user) || typeof q.id !== "string") return;
  const prywatny = q.message?.chat?.type === "private" && q.message.chat.id === user;
  if (!prywatny || !m || !(await rpc<boolean>("tg_limit", { p_klucz: "u:" + user, p_max: 20, p_okno_s: 60 }))) { await tg("sub", "answerCallbackQuery", { callback_query_id: q.id }); return; }
  const j = m[1] as Jezyk;
  await zmien(`klient_subskrypcje?tg_user_id=eq.${user}`, { jezyk: j });
  await tg("sub", "answerCallbackQuery", { callback_query_id: q.id });
  await napisz(user, BOT[j].jezyk);
}

async function czlonkostwo(c: Any) {
  if (c?.chat?.type !== "private" || !idOk(c.chat.id)) return;
  const st = c.new_chat_member?.status;
  if (st === "kicked") await zmien(`klient_subskrypcje?tg_user_id=eq.${c.chat.id}&blocked_at=is.null`, { blocked_at: new Date().toISOString() });
  else if (st === "member") await zmien(`klient_subskrypcje?tg_user_id=eq.${c.chat.id}&blocked_at=not.is.null`, { blocked_at: null });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (WEBHOOK_SECRET.length < 24) return new Response("not configured", { status: 503 });
  if (!staleRowne(req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", WEBHOOK_SECRET)) return new Response("forbidden", { status: 403 });
  try {
    const raw = await req.text();
    if (raw.length > 100000) return ok();
    const u = JSON.parse(raw);
    if (!Number.isSafeInteger(u?.update_id) || !(u.message || u.my_chat_member || u.callback_query)) return ok();
    if (!(await rpc<boolean>("tg_update_nowy", { p_id: u.update_id }))) return ok(); // seen before
    if (u.message) await wiadomosc(u.message);
    else if (u.callback_query) await przycisk(u.callback_query);
    else await czlonkostwo(u.my_chat_member);
  } catch (e) {
    console.error("tg-bot", String((e as Error)?.message ?? "").slice(0, 120)); // database errors only: tg() never throws
  }
  return ok();
});
