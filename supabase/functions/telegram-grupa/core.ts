// telegram-grupa — the Telegram work itself: builds one client's group from a plan, as the office's
// technical account, through an ALREADY CONNECTED GramJS client. No top-level side effects, no
// secrets, no database: the caller connects, passes `zapiszKrok` to persist every finished step, and
// disconnects. The same function runs in the edge function and in a local Deno script.
//
//   const w = await zbudujGrupe(tg, plan, async (kroki, opis) => { … store kroki … }, { kroki: stored });
//
// Order: the supergroup with topics → topics → messages (pinned silently where the plan says so) →
// invitation link → bots (invited and made administrators) → office staff by @name.
// Resumable: `kroki` holds what is done (channel, topic ids, message ids …); pass it back and the run
// continues where it stopped. Topics and messages carry random ids derived from `ziarno`, so a step
// that reached Telegram but was not recorded is not repeated. A FLOOD_WAIT of up to 20 s is waited
// out; a longer one, or a run over its time budget, ends with Przerwa — the state is saved, try later.

import { Api } from "npm:telegram@2.26.22";
import { HTMLParser } from "npm:telegram@2.26.22/extensions/html.js";
import { returnBigInt } from "npm:telegram@2.26.22/Helpers.js";
import type { Plan } from "./szablony.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

// the part of a GramJS client this module uses
export type Tg = { invoke: (zapytanie: Any) => Promise<Any> };
export type Kroki = {
  ziarno?: string;                                   // seed of the random ids (the log row's id)
  proba_at?: string;                                 // CreateChannel was about to be sent at this time
  kanal?: { id: string; hash: string; przejety?: boolean };
  tematy?: Record<string, number>;                   // topic key -> topic id (General is 1)
  wiadomosci?: Record<string, { id: number; przypieta?: boolean }>;
  prawa?: boolean;                                  // member permissions set like in the existing client groups
  link?: string;
  boty?: Record<string, string>;                     // username -> "admin" | "dodany" | "blad: CODE"
  osoby?: Record<string, string>;                    // username -> "dodana" | "pominieta: CODE"
  ostrzezenia?: string[];
  koniec?: boolean;                                  // group, topics, messages and link are done
};
export type ZapiszKrok = (kroki: Kroki, opis: string) => Promise<void>;
export type Opcje = {
  kroki?: Kroki; ziarno?: string;
  budzetMs?: number;                                 // the whole run must fit in this (default 110 s)
  pauza?: (ms: number) => Promise<void>;             // tests pass a no-op
  teraz?: () => number;
};
export type Wynik = { kroki: Kroki; chat_id: string; link: string; ostrzezenia: string[]; braki: string[] };

// Telegram asked to wait (or the time budget ran out): everything done so far is saved
export class Przerwa extends Error { constructor(public sekund: number, public powod: "flood" | "budzet") { super(powod === "flood" ? "Telegram: limit zapytań" : "Limit czasu jednego uruchomienia"); } }
// a refusal by Telegram, by its code (CHAT_TITLE_EMPTY …) — never the raw error text
export class Odmowa extends Error { constructor(public kod: string, public krok: string) { super(kod); } }

const MAX_CZEKANIE = 20;
// rights the office's bot has in the existing groups: topics, deleting, pinning, inviting — nothing more
const PRAWA_BOTA = { deleteMessages: true, inviteUsers: true, pinMessages: true, manageTopics: true };
const POMIN: Record<string, string> = {
  USER_PRIVACY_RESTRICTED: "ustawienia prywatności tej osoby nie pozwalają dodawać jej do grup", USER_NOT_MUTUAL_CONTACT: "konto biura nie ma tej osoby we wzajemnych kontaktach",
  USER_CHANNELS_TOO_MUCH: "ta osoba jest już w zbyt wielu grupach", USERNAME_NOT_OCCUPIED: "nie ma takiej nazwy w Telegramie", USERNAME_INVALID: "nieprawidłowa nazwa w Telegramie",
  USER_KICKED: "ta osoba została wcześniej usunięta z grupy", USER_BANNED_IN_CHANNEL: "konto ma ograniczenia w Telegramie", USER_ID_INVALID: "Telegram nie rozpoznał tej osoby",
  INPUT_USER_DEACTIVATED: "konto tej osoby jest usunięte", PEER_FLOOD: "Telegram chwilowo ogranicza zapraszanie z konta biura", USER_BOT: "to konto jest botem", BRAK_W_GRUPIE: "Telegram nie dodał tej osoby (prywatność)",
};

export function kodBledu(e: Any): string {
  const k = String(e?.errorMessage ?? "");
  if (/^[A-Z][A-Z0-9_]{2,60}$/.test(k)) return k;
  const n = String(e?.name ?? e?.constructor?.name ?? "");
  return /timeout/i.test(n + " " + String(e?.message ?? "").slice(0, 80)) ? "TIMEOUT" : "BLAD_POLACZENIA";
}
function sekundCzekania(e: Any): number {
  if (Number.isFinite(Number(e?.seconds)) && Number(e.seconds) > 0) return Number(e.seconds);
  const m = /(?:FLOOD|SLOWMODE)(?:_PREMIUM)?_WAIT_(\d+)/.exec(String(e?.errorMessage ?? ""));
  return m ? Number(m[1]) : 0;
}
// a stable 64-bit id from the seed and a label (SHA-256), so a repeated step is recognised by Telegram
async function staleId(ziarno: string, etykieta: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ziarno + "\n" + etykieta)));
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(h[i]);
  return returnBigInt(BigInt.asIntN(64, v).toString());
}
const idWiadomosci = (odp: Any): number => {
  if (Number(odp?.id) > 0 && odp?.className === "UpdateShortSentMessage") return Number(odp.id);
  const u = (odp?.updates ?? []) as Any[];
  const nowa = u.find((x) => (x.className === "UpdateNewChannelMessage" || x.className === "UpdateNewMessage") && Number(x.message?.id) > 0);
  return Number(nowa?.message?.id ?? u.find((x) => x.className === "UpdateMessageID")?.id ?? 0);
};

// What is done and what is left, in the order of the run — for the page.
export function postep(plan: Plan, k: Kroki = {}): Array<{ krok: string; stan: "ok" | "czeka" | "uwaga" }> {
  const out: Array<{ krok: string; stan: "ok" | "czeka" | "uwaga" }> = [];
  out.push({ krok: "Grupa „" + plan.tytul + "” z tematami", stan: k.kanal ? "ok" : "czeka" });
  for (const t of plan.tematy) if (!t.ogolny) out.push({ krok: "Temat: " + t.nazwa, stan: k.tematy?.[t.klucz] ? "ok" : "czeka" });
  for (const t of plan.tematy) for (const w of t.wiadomosci) {
    const s = k.wiadomosci?.[w.klucz];
    out.push({ krok: t.nazwa + " — " + w.nazwa + (w.przypnij ? " (przypięta)" : ""), stan: !s ? "czeka" : w.przypnij && !s.przypieta ? "uwaga" : "ok" });
  }
  out.push({ krok: "Link z zaproszeniem", stan: k.link ? "ok" : "czeka" });
  for (const b of plan.boty) { const s = k.boty?.[b.username]; out.push({ krok: "Bot @" + b.username + (b.admin ? " — administrator" : ""), stan: !s ? "czeka" : s.startsWith("blad") ? "uwaga" : "ok" }); }
  for (const o of plan.osoby) { const s = k.osoby?.[o.username]; out.push({ krok: "Zaproszenie: " + o.imie + " (@" + o.username + ")", stan: !s ? "czeka" : s === "dodana" ? "ok" : "uwaga" }); }
  return out;
}

export async function zbudujGrupe(tg: Tg, plan: Plan, zapiszKrok: ZapiszKrok, opcje: Opcje = {}): Promise<Wynik> {
  const k: Kroki = structuredClone(opcje.kroki ?? {});
  k.tematy ??= {}; k.wiadomosci ??= {}; k.boty ??= {}; k.osoby ??= {}; k.ostrzezenia ??= [];
  k.ziarno ??= opcje.ziarno ?? crypto.randomUUID();
  const teraz = opcje.teraz ?? (() => Date.now());
  const pauza = opcje.pauza ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const start = teraz(), budzet = opcje.budzetMs ?? 110000;
  const uwaga = (t: string) => { if (!k.ostrzezenia!.includes(t)) k.ostrzezenia!.push(t); };
  let wywolan = 0;

  // one request: a pause before it, a short FLOOD_WAIT waited out, anything else as Odmowa with the code
  async function wyslij(krok: string, zapytanie: () => Any): Promise<Any> {
    for (let proba = 0; ; proba++) {
      if (teraz() - start > budzet) throw new Przerwa(0, "budzet");
      if (wywolan++) await pauza(700 + Math.floor(Math.random() * 300));
      try { return await tg.invoke(zapytanie()); }
      catch (e) {
        const s = sekundCzekania(e);
        if (!s) throw new Odmowa(kodBledu(e), krok);
        if (s > MAX_CZEKANIE || proba >= 2 || teraz() - start + s * 1000 > budzet) throw new Przerwa(s, "flood");
        await pauza((s + 1) * 1000);
      }
    }
  }
  const zapisz = (opis: string) => zapiszKrok(structuredClone(k), opis);
  const kanal = () => new Api.InputChannel({ channelId: returnBigInt(k.kanal!.id), accessHash: returnBigInt(k.kanal!.hash) });
  const peer = () => new Api.InputPeerChannel({ channelId: returnBigInt(k.kanal!.id), accessHash: returnBigInt(k.kanal!.hash) });

  // ---- 1. the supergroup
  if (!k.kanal) {
    if (k.proba_at) {
      // an earlier run may have created the group without living to record it: look for it before creating another
      const d = await wyslij("szukanie grupy", () => new Api.messages.GetDialogs({ offsetDate: 0, offsetId: 0, offsetPeer: new Api.InputPeerEmpty(), limit: 40, hash: returnBigInt(0) }));
      const od = Math.floor(Date.parse(k.proba_at) / 1000) - 120, doKiedy = od + 420;   // only a group born around that attempt, never one made by hand later
      const moje = ((d?.chats ?? []) as Any[]).filter((c) => c.className === "Channel" && c.megagroup && c.creator && String(c.title) === plan.tytul && Number(c.date) >= od && Number(c.date) <= doKiedy);
      if (moje.length === 1) {
        k.kanal = { id: String(moje[0].id), hash: String(moje[0].accessHash), przejety: true };
        uwaga("Grupa z przerwanej wcześniej próby została odnaleziona i dokończona — sprawdź w Telegramie, czy żadna wiadomość się nie powtarza.");
        await zapisz("grupa odnaleziona");
      } else if (moje.length > 1) throw new Odmowa("KILKA_GRUP_O_TEJ_NAZWIE", "szukanie grupy");
    }
    if (!k.kanal) {
      k.proba_at = new Date(teraz()).toISOString();
      await zapisz("tworzenie grupy");
      const r = await wyslij("tworzenie grupy", () => new Api.channels.CreateChannel({ title: plan.tytul, about: plan.opis ?? "", megagroup: true, forum: true }));
      const c = ((r?.chats ?? []) as Any[]).find((x) => x.className === "Channel");
      if (!c) throw new Odmowa("BRAK_GRUPY_W_ODPOWIEDZI", "tworzenie grupy");
      k.kanal = { id: String(c.id), hash: String(c.accessHash) };
      await zapisz("grupa utworzona");
      if (c.forum !== true) await wyslij("włączenie tematów", () => new Api.channels.ToggleForum({ channel: kanal(), enabled: true }));
    }
  }

  // ---- 2. topics (General exists by itself, id 1)
  let istniejace: Map<string, number> | null = null;
  const tematyWGrupie = async () => {
    if (!istniejace) {
      const r = await wyslij("lista tematów", () => new Api.channels.GetForumTopics({ channel: kanal(), offsetDate: 0, offsetId: 0, offsetTopic: 0, limit: 50 }));
      istniejace = new Map(((r?.topics ?? []) as Any[]).filter((t) => t.className === "ForumTopic").map((t) => [String(t.title), Number(t.id)]));
    }
    return istniejace;
  };
  for (const t of plan.tematy) {
    if (t.ogolny) { k.tematy[t.klucz] = 1; continue; }
    if (k.tematy[t.klucz]) continue;
    let id = k.kanal.przejety ? (await tematyWGrupie()).get(t.nazwa) ?? 0 : 0;
    if (!id) {
      const rid = await staleId(k.ziarno, "temat:" + t.klucz);
      try {
        const r = await wyslij("temat " + t.nazwa, () => new Api.channels.CreateForumTopic({ channel: kanal(), title: t.nazwa, randomId: rid }));
        const u = ((r?.updates ?? []) as Any[]).find((x) => x.className === "UpdateNewChannelMessage" && x.message?.action?.className === "MessageActionTopicCreate");
        id = Number(u?.message?.id ?? 0) || idWiadomosci(r);
      } catch (e) {
        if (!(e instanceof Odmowa && e.kod === "RANDOM_ID_DUPLICATE")) throw e;
      }
      if (!id) { istniejace = null; id = (await tematyWGrupie()).get(t.nazwa) ?? 0; }
      if (!id) throw new Odmowa("BRAK_ID_TEMATU", "temat " + t.nazwa);
    }
    k.tematy[t.klucz] = id;
    await zapisz("temat " + t.nazwa);
  }

  // ---- 3. messages, each pinned at once when the plan says so (silently: nobody is notified)
  for (const t of plan.tematy) {
    const temat = k.tematy[t.klucz];
    for (const w of t.wiadomosci) {
      if (!k.wiadomosci[w.klucz]) {
        const [tekst, encje] = HTMLParser.parse(w.html);
        const rid = await staleId(k.ziarno, "wiadomosc:" + w.klucz);
        try {
          const r = await wyslij("wiadomość " + w.nazwa, () => new Api.messages.SendMessage({
            peer: peer(), message: tekst, entities: encje, noWebpage: true, randomId: rid,
            replyTo: t.ogolny ? undefined : new Api.InputReplyToMessage({ replyToMsgId: temat, topMsgId: temat }),
          }));
          k.wiadomosci[w.klucz] = { id: idWiadomosci(r) };
        } catch (e) {
          if (!(e instanceof Odmowa && e.kod === "RANDOM_ID_DUPLICATE")) throw e;
          k.wiadomosci[w.klucz] = { id: 0 }; // it went out in the interrupted run; its id is not known
        }
        await zapisz("wiadomość " + w.nazwa);
      }
      const s = k.wiadomosci[w.klucz];
      if (w.przypnij && !s.przypieta) {
        if (!s.id) { uwaga("„" + w.nazwa + "” (" + t.nazwa + ") została wysłana w przerwanej próbie — przypnij ją ręcznie."); s.przypieta = true; }
        else { await wyslij("przypięcie " + w.nazwa, () => new Api.messages.UpdatePinnedMessage({ peer: peer(), id: s.id, silent: true })); s.przypieta = true; }
        await zapisz("przypięcie " + w.nazwa);
      }
    }
  }

  // ---- 3b. member permissions as in the existing client groups: members may invite people, pin and edit group info
  if (!k.prawa) {
    await wyslij("uprawnienia uczestników", () => new Api.messages.EditChatDefaultBannedRights({ peer: peer(), bannedRights: new Api.ChatBannedRights({ untilDate: 0 }) }));
    k.prawa = true;
    await zapisz("uprawnienia uczestników");
  }

  // ---- 4. the invitation link
  if (!k.link) {
    const r = await wyslij("link z zaproszeniem", () => new Api.messages.ExportChatInvite({ peer: peer(), requestNeeded: true, title: "Zaproszenie dla klienta" }));
    k.link = String(r?.link ?? "");
    if (!/^https:\/\/t\.me\//.test(k.link)) throw new Odmowa("BRAK_LINKU", "link z zaproszeniem");
  }
  k.koniec = true;
  await zapisz("link z zaproszeniem");

  // ---- 5. bots, 6. office staff. A person who cannot be added is a warning; a bot that cannot — a gap to finish later.
  const znajdz = async (username: string) => {
    const r = await wyslij("szukanie @" + username, () => new Api.contacts.ResolveUsername({ username }));
    const u = ((r?.users ?? []) as Any[]).find((x) => x.className === "User");
    if (!u) throw new Odmowa("USERNAME_NOT_OCCUPIED", "szukanie @" + username);
    return { wej: new Api.InputUser({ userId: returnBigInt(String(u.id)), accessHash: returnBigInt(String(u.accessHash ?? 0)) }), id: String(u.id), bot: u.bot === true, ja: u.self === true };
  };
  const zapros = async (wej: Any, id: string, kto: string) => {
    try {
      const r = await wyslij("zaproszenie " + kto, () => new Api.channels.InviteToChannel({ channel: kanal(), users: [wej] }));
      if (((r?.missingInvitees ?? []) as Any[]).some((m) => String(m.userId) === id)) throw new Odmowa("BRAK_W_GRUPIE", "zaproszenie " + kto);
    } catch (e) { if (!(e instanceof Odmowa && e.kod === "USER_ALREADY_PARTICIPANT")) throw e; }
  };
  const braki: string[] = [];
  for (const b of plan.boty) {
    const stan = k.boty[b.username];
    if (stan === "admin" || (stan === "dodany" && !b.admin)) continue;
    try {
      const u = await znajdz(b.username);
      if (!u.bot) throw new Odmowa("TO_NIE_BOT", "bot @" + b.username);
      if (stan !== "dodany") { await zapros(u.wej, u.id, "@" + b.username); k.boty[b.username] = "dodany"; await zapisz("bot @" + b.username); }
      if (b.admin) {
        await wyslij("uprawnienia @" + b.username, () => new Api.channels.EditAdmin({ channel: kanal(), userId: u.wej, adminRights: new Api.ChatAdminRights(PRAWA_BOTA), rank: "" }));
        k.boty[b.username] = "admin";
      }
    } catch (e) {
      if (e instanceof Przerwa) throw e;
      const kod = e instanceof Odmowa ? e.kod : kodBledu(e);
      if (k.boty[b.username] !== "dodany") k.boty[b.username] = "blad: " + kod;
      braki.push("Bot @" + b.username + (k.boty[b.username] === "dodany" ? " jest w grupie, ale nie udało się nadać mu uprawnień administratora (" : " nie został dodany (") + (POMIN[kod] ?? kod) + ").");
    }
    await zapisz("bot @" + b.username);
  }
  for (const o of plan.osoby) {
    if (k.osoby[o.username]) continue;
    try {
      const u = await znajdz(o.username);
      if (u.ja) k.osoby[o.username] = "dodana"; // the office account itself is already there
      else { await zapros(u.wej, u.id, o.imie); k.osoby[o.username] = "dodana"; }
    } catch (e) {
      if (e instanceof Przerwa) throw e;
      const kod = e instanceof Odmowa ? e.kod : kodBledu(e);
      k.osoby[o.username] = "pominieta: " + kod;
      uwaga(o.imie + " (@" + o.username + ") — nie udało się dodać do grupy: " + (POMIN[kod] ?? kod) + ". Dodaj tę osobę ręcznie albo wyślij jej link.");
    }
    await zapisz("zaproszenie " + o.imie);
  }
  return { kroki: k, chat_id: "-100" + k.kanal.id, link: k.link, ostrzezenia: k.ostrzezenia, braki };
}
