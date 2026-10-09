// Baza klientów — the Telegram audit: does every client in service have its group with the office,
// and are the office's bots in it. READ ONLY: the only Bot API methods ever called are the five in
// METODY below — nothing is posted, no setting of a chat is changed, no chat is left.
//
// Free of I/O of its own (the caller passes `tg`), so it is tested with canned Bot API answers.

// deno-lint-ignore no-explicit-any
type Any = any;

export const METODY = ["getMe", "getChat", "getChatMember", "getChatMemberCount", "getChatAdministrators"] as const;
export type Metoda = typeof METODY[number];
// the Bot API answer as it comes: { ok, result } or { ok: false, error_code, description, parameters }
export type Tg = (metoda: Metoda, params?: Record<string, string>) => Promise<Any>;

export type Bot = { nazwa: string; user_id: string };
export type Status = "ok" | "brak_grupy" | "zly_id" | "brak_czatu" | "bot_usuniety" | "przeniesiona" | "bot_bez_praw" | "brak_bota" | "blad";
export type Wynik = {
  status: Status; chat_id: string | null; tytul: string | null; typ: string | null; czlonkow: number | null;
  bot_status: string | null;            // our bot in the chat: creator | administrator | member | restricted | left | kicked
  boty: Array<{ id: string; username: string; nazwa: string }>;   // bots among the chat's administrators
  brak_botow: string[];                 // required bots that are not in the chat
  nowe_id: string | null;               // the chat became a supergroup: its new id (a suggestion, never written by itself)
  blad: string | null;
  uwagi: string[];
};
// Telegram asked us to slow down: the run stops and is resumed later
export class Limit extends Error { constructor(public sekund: number) { super("Telegram: limit zapytań"); } }

export const PROBLEM: Record<Status, string> = {
  ok: "w porządku", brak_grupy: "brak grupy", zly_id: "nieprawidłowe id czatu", brak_czatu: "grupa nie istnieje albo bot nigdy w niej nie był",
  bot_usuniety: "bot portalu usunięty z grupy", przeniesiona: "grupa przeniesiona (nowe id)", bot_bez_praw: "bot portalu nie może pisać", brak_bota: "brakuje wymaganego bota", blad: "błąd sprawdzenia",
};
const pusty = (chat_id: string | null): Wynik => ({ status: "ok", chat_id, tytul: null, typ: null, czlonkow: null, bot_status: null, boty: [], brak_botow: [], nowe_id: null, blad: null, uwagi: [] });
const jest = (s: unknown) => ["creator", "administrator", "member", "restricted"].includes(String(s));

// one Bot API call; a 429 becomes Limit, every other refusal comes back for the caller to read
async function pytaj(tg: Tg, metoda: Metoda, params: Record<string, string>): Promise<Any> {
  const r = await tg(metoda, params);
  if (r?.ok === false && (r.error_code === 429 || r.parameters?.retry_after)) throw new Limit(Math.min(3600, Number(r.parameters?.retry_after) || 30));
  return r ?? { ok: false, description: "brak odpowiedzi" };
}
// what a refusal means for the chat as a whole
function odmowa(r: Any, w: Wynik): Wynik {
  const opis = String(r?.description ?? "").slice(0, 200), kod = Number(r?.error_code) || 0;
  const nowe = r?.parameters?.migrate_to_chat_id;
  if (nowe != null) return { ...w, status: "przeniesiona", nowe_id: String(nowe), blad: "Grupa została zamieniona w supergrupę — ma nowe id czatu." };
  if (/chat not found/i.test(opis)) return { ...w, status: "brak_czatu", blad: "Telegram nie zna takiego czatu: grupa nie istnieje, id jest błędne albo bot portalu nigdy w niej nie był." };
  if (kod === 403 || /bot was kicked|bot is not a member|bot was blocked|not enough rights/i.test(opis)) return { ...w, status: "bot_usuniety", blad: "Bot portalu nie ma dostępu do grupy (usunięty albo nigdy nie dodany)." };
  if (/group chat was upgraded|deactivated/i.test(opis)) return { ...w, status: "brak_czatu", blad: "Grupa została zamknięta albo zamieniona w supergrupę (Telegram nie podał nowego id)." };
  return { ...w, status: "blad", blad: "Telegram: " + (opis || "błąd " + kod) };
}

// One client's group. `botId`: our bot's numeric id; `wymagane`: the other bots that must be there.
// Throws Limit when Telegram rate-limits; every other outcome is a Wynik.
export async function sprawdzCzat(tg: Tg, chat: string, botId: string, wymagane: Bot[]): Promise<Wynik> {
  const id = String(chat ?? "").trim();
  if (!id) return { ...pusty(null), status: "brak_grupy" };
  const w = pusty(id);
  if (!/^-\d{5,20}$/.test(id)) return { ...w, status: "zly_id", blad: /^\d+$/.test(id) ? "Id jest dodatnie — to czat prywatny z osobą, a nie grupa (id grupy zaczyna się od minusa)." : "Id czatu ma nieprawidłowy format." };

  const c = await pytaj(tg, "getChat", { chat_id: id });
  if (!c.ok) return odmowa(c, w);
  w.tytul = String(c.result?.title ?? "").slice(0, 200) || null; w.typ = String(c.result?.type ?? "") || null;
  if (w.typ === "private") return { ...w, status: "zly_id", blad: "To czat prywatny, a nie grupa." };
  if (w.typ === "channel") w.uwagi.push("To kanał, a nie grupa.");

  const m = await pytaj(tg, "getChatMember", { chat_id: id, user_id: botId });
  if (!m.ok) return odmowa(m, w);
  w.bot_status = String(m.result?.status ?? "") || null;
  if (!jest(w.bot_status)) return { ...w, status: "bot_usuniety", blad: w.bot_status === "kicked" ? "Bot portalu został usunięty z grupy (zablokowany)." : "Bot portalu nie jest członkiem grupy." };
  const admin = w.bot_status === "administrator" || w.bot_status === "creator";
  // an ordinary member writes only when the group lets its members write; a restricted one — when allowed
  const mozePisac = admin ? true : w.bot_status === "restricted" ? m.result?.can_send_messages === true : c.result?.permissions?.can_send_messages !== false;

  const n = await pytaj(tg, "getChatMemberCount", { chat_id: id });
  if (n.ok && Number.isFinite(Number(n.result))) w.czlonkow = Number(n.result);
  const a = await pytaj(tg, "getChatAdministrators", { chat_id: id });
  if (a.ok && Array.isArray(a.result)) {
    w.boty = a.result.filter((x: Any) => x?.user?.is_bot === true && String(x.user.id) !== botId).slice(0, 20)
      .map((x: Any) => ({ id: String(x.user.id), username: String(x.user.username ?? "").slice(0, 64), nazwa: String(x.user.first_name ?? "").slice(0, 100) }));
  }
  for (const b of wymagane) {
    if (b.user_id === botId || w.boty.some((x) => x.id === b.user_id)) continue;
    // not among the administrators: ask about it directly (reliable when our bot is an administrator)
    const o = await pytaj(tg, "getChatMember", { chat_id: id, user_id: b.user_id });
    if (!(o.ok && jest(o.result?.status))) w.brak_botow.push(b.nazwa);
  }
  if (!mozePisac) return { ...w, status: "bot_bez_praw", blad: "Bot portalu jest w grupie, ale nie może wysyłać wiadomości (ograniczenia grupy albo bota)." };
  if (w.brak_botow.length) {
    return { ...w, status: "brak_bota", blad: "W grupie nie ma: " + w.brak_botow.join(", ") + "." + (admin ? "" : " Bot portalu nie jest administratorem grupy, więc Telegram może nie pokazywać mu wszystkich uczestników — sprawdź w grupie.") };
  }
  return w;
}

// ---------------------------------------------------------------- hints that need no Telegram
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/gi, "l").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const SLOWA = new Set(["sp", "spolka", "zoo", "z", "o", "sa", "sk", "sc", "jdg", "firma", "biuro", "grupa", "group", "poland", "polska", "ksiegowosc", "td", "consulting"]);
// does the group's title carry any distinctive word of the client's name (a hint only)
export function tytulPasuje(tytul: unknown, nazwa: unknown): boolean {
  const t = norm(tytul).split(" "), slowa = norm(nazwa).split(" ").filter((x) => x.length >= 3 && !SLOWA.has(x));
  if (!slowa.length || !t.join("")) return true;
  return slowa.some((x) => t.some((y) => y === x || (x.length >= 5 && (y.startsWith(x.slice(0, 5)) || x.startsWith(y.slice(0, 5)) && y.length >= 5))));
}
// the same chat id entered for more than one client: id -> names
export function powtorzoneCzaty(klienci: Array<{ nazwa: string; telegram?: string | null }>): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const k of klienci) { const id = String(k.telegram ?? "").trim(); if (id) by.set(id, [...(by.get(id) ?? []), k.nazwa]); }
  for (const [id, l] of by) if (l.length < 2) by.delete(id);
  return by;
}

// ---------------------------------------------------------------- what got worse (for the one alert task)
const WAGA: Record<string, number> = { ok: 0, brak_bota: 1, bot_bez_praw: 2, przeniesiona: 2, zly_id: 2, brak_grupy: 2, bot_usuniety: 3, brak_czatu: 3 };
// a status change worth telling the administrator about; 'blad' (Telegram or network trouble) is not one
export function pogorszenie(bylo: string | null, jest: string): boolean {
  if (jest === "blad" || jest === "ok" || bylo === jest) return false;
  if (bylo == null || bylo === "blad") return true; // first time seen with a problem
  return (WAGA[jest] ?? 0) > (WAGA[bylo] ?? 0);
}
export function trescZadania(zmiany: Array<{ nazwa: string; bylo: string | null; jest: Status }>): { tytul: string; opis: string } {
  const linie = zmiany.slice(0, 40).map((z) => "• " + z.nazwa + " — " + PROBLEM[z.jest] + (z.bylo && z.bylo !== "blad" ? " (było: " + (PROBLEM[z.bylo as Status] ?? z.bylo) + ")" : ""));
  return {
    tytul: "Telegram: " + zmiany.length + (zmiany.length === 1 ? " grupa klienta wymaga uwagi" : " grup klientów wymaga uwagi"),
    opis: ("Codzienna kontrola grup Telegram klientów wykryła zmiany na gorsze:\n" + linie.join("\n") + (zmiany.length > 40 ? "\n… i " + (zmiany.length - 40) + " kolejnych" : "") + "\n\nSzczegóły: Baza klientów → filtr „Telegram”.").slice(0, 3900),
  };
}
// required bots as stored in the settings: only well-formed entries, no duplicates
export function wymaganeBoty(v: unknown): Bot[] {
  const out: Bot[] = [];
  for (const b of Array.isArray(v) ? v : []) {
    const id = String(b?.user_id ?? "").trim(), nazwa = String(b?.nazwa ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (/^\d{5,15}$/.test(id) && nazwa && !out.some((x) => x.user_id === id)) out.push({ nazwa, user_id: id });
    if (out.length >= 10) break;
  }
  return out;
}
