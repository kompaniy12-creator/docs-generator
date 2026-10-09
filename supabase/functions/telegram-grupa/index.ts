// Telegram: a client's group created from the portal — the supergroup with topics, the office's
// instructions posted and pinned in them, the portal's bot made an administrator, the invitation link.
// PORTAL ADMINISTRATORS ONLY (JWT with app_metadata.portal and portal_admin). Deployed with
// --no-verify-jwt: the caller is checked here. Every action is a POST with { action, ... }.
//
// The Bot API cannot create groups, so the work is done as the office's technical Telegram account
// over MTProto (GramJS). Secrets: TG_ADMIN_SESSION (a string session made by tools/tg-sesja.ts — a
// session of its own, for the portal only), TG_API_ID, TG_API_HASH. Without them every action that
// needs Telegram answers `nie_skonfigurowano`; the preview and the template work regardless.
// The session never leaves this process: it is not returned, not logged, and Telegram's refusals
// reach the browser as their codes only.
//
//   stan            { sprawdz? }                    -> { skonfigurowano, konto, sprawdzono_at, limit, dzis }
//                                                    sprawdz: true connects and asks Telegram who we are
//   podglad         { klient_id, zmiany? }          -> the whole plan with the client's data filled in,
//                                                    warnings and what blocks the creation. No Telegram.
//   utworz          { klient_id, zmiany?, potwierdzam: true, id?, wymus? }
//                                                    creates the group; refuses when the client has a
//                                                    group or an unfinished creation (unless wymus)
//   dokoncz         { id }                          continues an interrupted creation from its log row
//   postep          { id }                          -> steps done so far (the page polls it during a run)
//   rachunek_zus    { klient_id, rachunek_zus }     saves the client's individual ZUS account
//   szablon                                         -> { szablon, domyslny, zmienne, warunki }
//   szablon_zapisz  { szablon }
//   lista           { klient_id? }                  -> log rows, newest first
//
// zmiany: { tytul?, rachunek_zus?, warianty?: { "<topic>/<group>": key | "" },
//           wiadomosci?: { "<topic>/<message>": { wlacz?, html?, przypnij? } }, osoby?: { ksiegowa?, kadrowa? } }
// The portal is the master of the client's chat id: after a creation it is written to the client's
// data with klienci_zapisz() (the same transaction and history as a manual edit in Baza klientów).

import { TelegramClient } from "npm:telegram@2.26.22";
import { StringSession } from "npm:telegram@2.26.22/sessions/index.js";
import { type Kroki, Odmowa, postep, Przerwa, type Tg, zbudujGrupe } from "./core.ts";
import { type Dane, DOMYSLNY, grupuj, mikrorachunek, normalizujSzablon, type Osoba, rachunekZus, type Szablon, WARUNKI, zbudujPlan, ZMIENNE, type Zmiany } from "./szablony.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TG_SESJA = Deno.env.get("TG_ADMIN_SESSION") ?? "";
const TG_API_ID = Number(Deno.env.get("TG_API_ID") ?? 0);
const TG_API_HASH = Deno.env.get("TG_API_HASH") ?? "";
const TG_WSS = (Deno.env.get("TG_WSS") ?? "1") !== "0"; // WebSocket on 443 by default; "0" = plain TCP
const USTAWIENIA = "telegram_grupa";        // key in portal_ustawienia: the template
const KONTO = "telegram_grupa_konto";       // key in portal_ustawienia: { username, sprawdzono_at } — who the session is
const BLOKADA_MS = 4 * 60000;               // a run holds its row this long at most
const BUDZET_MS = 110000;

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
async function czytaj(path: string): Promise<Any[]> {
  const r = await db(path);
  if (!r.ok) throw new Error(path.split("?")[0] + ": " + r.status);
  return await r.json();
}
type Ja = { email: string; admin: boolean };
async function portal(req: Request): Promise<Ja | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (m.portal !== true || !u.email) return null;
  return { email: String(u.email).toLowerCase(), admin: m.portal_admin === true };
}
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const okId = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && (/^\d{10}$/.test(v) || /^nazwa:.+/.test(v));
const skonfigurowano = () => TG_SESJA.length > 100 && TG_API_ID > 0 && /^[0-9a-f]{32}$/i.test(TG_API_HASH);
const NIE_PODLACZONE = "Konto Telegram biura nie jest jeszcze podłączone — administrator musi wykonać jednorazowe logowanie.";

// ---------------------------------------------------------------- settings
async function ustawienie(klucz: string): Promise<Any> {
  return (await czytaj(`portal_ustawienia?key=eq.${klucz}&select=value`))[0]?.value ?? null;
}
async function zapiszUstawienie(klucz: string, value: Any) {
  const r = await db("portal_ustawienia", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: klucz, value, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error("zapis ustawień: " + r.status);
}
const szablon = async (): Promise<Szablon> => normalizujSzablon(await ustawienie(USTAWIENIA)).szablon;
// groups created in the last 24 hours: a row counts once the creation was sent to Telegram, and also
// while its run holds it (so requests arriving together cannot all slip under the cap)
async function dzis(): Promise<number> {
  const teraz = Date.now(), od = new Date(teraz - 86400000).toISOString();
  return (await czytaj(`telegram_grupy?select=kroki,status,porzucono,zajete_do&created_at=gte.${enc(od)}`))
    .filter((g) => g.kroki?.proba_at || g.kroki?.kanal || (g.status === "w_toku" && !g.porzucono && g.zajete_do && Date.parse(g.zajete_do) > teraz)).length;
}

// ---------------------------------------------------------------- Telegram: the only place that connects
class Sesja extends Error {}
async function polacz(): Promise<{ tg: Any; konto: string }> {
  let tg: Any;
  try {
    tg = new TelegramClient(new StringSession(TG_SESJA), TG_API_ID, TG_API_HASH, { connectionRetries: 2, requestRetries: 1, floodSleepThreshold: 0, autoReconnect: false, useWSS: TG_WSS, deviceModel: "TD Portal", systemVersion: "Supabase Edge", appVersion: "telegram-grupa" });
    tg.setLogLevel("none");
  } catch { throw new Sesja("Zapisana sesja Telegram jest nieprawidłowa — administrator musi zalogować konto biura ponownie."); }
  try {
    await Promise.race([tg.connect(), new Promise((_ok, zle) => setTimeout(() => zle(new Error("timeout")), 20000))]);
    const ja = await tg.getMe();
    if (!ja || ja.bot) throw new Sesja("Sesja Telegram nie należy do konta użytkownika.");
    const konto = String(ja.username ?? "");
    await zapiszUstawienie(KONTO, { username: konto, sprawdzono_at: new Date().toISOString() }).catch(() => {});
    return { tg, konto };
  } catch (e) {
    await rozlacz(tg);
    if (e instanceof Sesja) throw e;
    const kod = String((e as Any)?.errorMessage ?? "");
    if (/AUTH_KEY|SESSION_(REVOKED|EXPIRED)|USER_DEACTIVATED/.test(kod)) throw new Sesja("Sesja konta Telegram biura wygasła albo została zakończona — administrator musi zalogować konto ponownie.");
    throw new Sesja("Nie udało się połączyć z Telegramem — spróbuj ponownie za chwilę.");
  }
}
async function rozlacz(tg: Any) { try { await tg?.destroy(); } catch { /* already closed */ } }

// a refusal in words; the code itself stays visible for the administrator
function opisOdmowy(e: Odmowa): string {
  const znane: Record<string, string> = {
    CHANNELS_TOO_MUCH: "konto biura jest już w zbyt wielu grupach i kanałach", CHANNELS_ADMIN_PUBLIC_TOO_MUCH: "konto biura ma za dużo publicznych grup", CHAT_TITLE_EMPTY: "pusta nazwa grupy",
    CHAT_ADMIN_REQUIRED: "konto biura nie jest administratorem tej grupy", CHANNEL_PRIVATE: "konto biura nie ma już dostępu do tej grupy", CHANNEL_INVALID: "Telegram nie zna tej grupy",
    KILKA_GRUP_O_TEJ_NAZWIE: "konto biura ma kilka nowych grup o tej samej nazwie — usuń zbędną w Telegramie i spróbuj ponownie", BLAD_POLACZENIA: "przerwane połączenie z Telegramem", TIMEOUT: "Telegram nie odpowiedział na czas",
    MESSAGE_TOO_LONG: "wiadomość jest za długa", ENTITY_BOUNDS_INVALID: "błąd formatowania wiadomości (znaczniki HTML)", TOPIC_TITLE_EMPTY: "pusta nazwa tematu", USER_RESTRICTED: "konto biura ma ograniczenia w Telegramie (spam) i nie może tworzyć grup",
    AUTH_KEY_UNREGISTERED: "sesja konta biura wygasła — potrzebne ponowne logowanie", SESSION_REVOKED: "sesja konta biura została zakończona — potrzebne ponowne logowanie",
  };
  return "Krok „" + e.krok + "”: " + (znane[e.kod] ?? "Telegram odmówił") + " (" + e.kod + ").";
}

// ---------------------------------------------------------------- one client: data, state
const aliasNorm = (a: unknown) => String(a ?? "").toLowerCase().replace(/[\s .]+/g, "");
async function daneKlienta(id: string) {
  const [kb, pk, prac, stawki, grupy] = await Promise.all([
    czytaj(`klienci_baza?id=eq.${enc(id)}&select=id,nip,nazwa,forma,opodatkowanie,miasto,opiekun,kadrowy,status,rachunek_zus`),
    czytaj(`portal_klienci?id=eq.${enc(id)}&select=dane`),
    czytaj("portal_pracownicy?select=email,imie_nazwisko,aliasy,aktywny,telegram_username"),
    czytaj("portal_stawki?select=valid_from,min_hourly&order=valid_from.desc"),
    czytaj(`telegram_grupy?klient=eq.${enc(id)}&select=id,tytul,status,blad,kroki,plan,porzucono,created_at,chat_id,link,ostrzezenia&order=created_at.desc&limit=10`),
  ]);
  const k = kb[0];
  if (!k) return null;
  const dane = pk[0]?.dane ?? null;
  // The person named in the client's data, not today's stand-in: the welcome message stays in the group
  // for good. Short names are compared as in portal_alias_norm() (case, spaces and dots do not matter).
  const osoba = (skrot: unknown): Osoba => {
    const a = aliasNorm(skrot);
    if (!a) return null;
    const p = prac.find((x) => x.aktywny !== false && (Array.isArray(x.aliasy) ? x.aliasy : []).some((y: unknown) => aliasNorm(y) === a));
    return p ? { imie_nazwisko: String(p.imie_nazwisko ?? ""), telegram_username: p.telegram_username ?? null, email: String(p.email) } : null;
  };
  const dzien = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
  const st = stawki.find((s) => String(s.valid_from) <= dzien);
  const d: Dane = {
    klient: { id: k.id, nip: k.nip, nazwa: k.nazwa, forma: k.forma, opodatkowanie: k.opodatkowanie, miasto: k.miasto, opiekun: k.opiekun, kadrowy: k.kadrowy, jezyk: String(dane?.jezyk ?? ""), rachunek_zus: k.rachunek_zus },
    ksiegowa: osoba(k.opiekun), kadrowa: osoba(k.kadrowy),
    stawka: st ? Number(st.min_hourly).toFixed(2).replace(".", ",") : "",
  };
  const czat = String(dane?.telegram ?? "").trim();
  // unfinished: something was (or may have been) sent to Telegram and the run did not reach its end
  const niedokonczona = grupy.find((g) => g.status !== "gotowa" && !g.porzucono && (g.kroki?.proba_at || g.kroki?.kanal)) ?? null;
  return { k, dane, d, czat, grupy, niedokonczona };
}
const wierszDlaStrony = (g: Any) => g ? { id: g.id, tytul: g.tytul, status: g.status, blad: g.blad, created_at: g.created_at, link: g.kroki?.link ?? g.link ?? null, chat_id: g.chat_id, ostrzezenia: g.ostrzezenia ?? [], postep: postep(g.plan, g.kroki) } : null;

// the group's chat id goes to the client's data the same way a manual edit does (history included)
async function zapiszCzatKlienta(klient: string, chat: string, kto: string): Promise<string | null> {
  try {
    const dane = (await czytaj(`portal_klienci?id=eq.${enc(klient)}&select=dane`))[0]?.dane;
    if (!dane) return "Klienta nie ma już na liście klientów — id czatu " + chat + " wpisz ręcznie.";
    const bylo = String(dane.telegram ?? "").trim();
    if (bylo === chat) return null;
    const r = await db("rpc/klienci_zapisz", { method: "POST", body: JSON.stringify({ p_id: klient, p_nowe_id: klient, p_dane: { ...dane, telegram: chat }, p_kto: kto, p_zmiany: [{ pole: "grupa Telegram (id czatu)", bylo: bylo || "—", jest: chat }] }) });
    if (!r.ok) { console.error("telegram-grupa zapis czatu", r.status); await r.body?.cancel(); return "Nie udało się zapisać id czatu w danych klienta — wpisz je ręcznie: " + chat + "."; }
    await r.body?.cancel();
    return null;
  } catch { return "Nie udało się zapisać id czatu w danych klienta — wpisz je ręcznie: " + chat + "."; }
}

// ---------------------------------------------------------------- a run (new or continued)
async function wykonaj(row: Any, ja: Ja): Promise<Any> {
  let ostatnie: Kroki = row.kroki ?? {}, tg: Any = null;
  const patch = async (zmiana: Any) => {
    for (let i = 0; i < 2; i++) {
      const r = await db(`telegram_grupy?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...zmiana, updated_at: new Date().toISOString() }) });
      await r.body?.cancel();
      if (r.ok) return;
    }
    throw new Error("zapis stanu");
  };
  const czat = (k: Kroki) => (k.kanal ? "-100" + k.kanal.id : null);
  const koniec = async (status: string, blad: string | null, extra: Any = {}) => {
    const uwagi = [...(ostatnie.ostrzezenia ?? [])];
    // the group is usable from the moment its link exists: the client's data get the chat id even when a later step failed
    if (ostatnie.koniec && czat(ostatnie)) { const u = await zapiszCzatKlienta(row.klient, czat(ostatnie)!, ja.email); if (u) uwagi.push(u); }
    await patch({ status, blad, kroki: ostatnie, chat_id: czat(ostatnie), link: ostatnie.link ?? null, ostrzezenia: uwagi, zajete_do: null, ...extra }).catch(() => {});
    console.log("telegram-grupa", row.id, status, blad ? "(" + blad.slice(0, 80) + ")" : "");
    return { ok: status === "gotowa", id: row.id, status, tytul: row.tytul, link: ostatnie.link ?? null, chat_id: czat(ostatnie), ostrzezenia: uwagi, postep: postep(row.plan, ostatnie), error: blad ?? undefined, porzucono: extra.porzucono === true || undefined };
  };
  try {
    tg = (await polacz()).tg;
    const w = await zbudujGrupe(tg as Tg, row.plan, async (k) => { ostatnie = k; await patch({ kroki: k, chat_id: czat(k) }); }, { kroki: row.kroki, ziarno: row.id, budzetMs: BUDZET_MS });
    ostatnie = w.kroki;
    return await koniec(w.braki.length ? "blad" : "gotowa", w.braki.length ? w.braki.join(" ") : null);
  } catch (e) {
    if (e instanceof Przerwa) {
      const s = Math.max(5, Math.ceil(e.sekund));
      return { ...(await koniec("w_toku", e.powod === "flood" ? "Telegram poprosił o przerwę — dokończ za " + s + " s." : "Nie wszystko zmieściło się w jednym uruchomieniu — kliknij „Dokończ”.")), czekaj: e.powod === "flood" ? s : 0 };
    }
    const msg = e instanceof Odmowa ? opisOdmowy(e) : e instanceof Sesja ? e.message : "Błąd podczas tworzenia grupy — spróbuj dokończyć.";
    if (!(e instanceof Odmowa) && !(e instanceof Sesja)) console.error("telegram-grupa wykonaj", String((e as Error)?.name ?? "błąd"));
    // nothing reached Telegram: the row is closed and does not stand in the way of a new attempt
    return await koniec("blad", msg, { porzucono: !(ostatnie.proba_at || ostatnie.kanal) });
  } finally { await rozlacz(tg); }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const ja = await portal(req);
  if (!ja) return json({ error: "Brak dostępu (portal)." }, 403, origin);
  if (!ja.admin) return json({ error: "Tę czynność może wykonać tylko administrator portalu." }, 403, origin);
  let body: Any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }
  const action = String(body?.action ?? "");

  try {
    if (action === "stan") {
      const sz = await szablon();
      let konto = await ustawienie(KONTO), blad: string | undefined;
      if (body.sprawdz === true && skonfigurowano()) {
        try { const p = await polacz(); await rozlacz(p.tg); konto = { username: p.konto, sprawdzono_at: new Date().toISOString() }; }
        catch (e) { blad = e instanceof Sesja ? e.message : "Nie udało się połączyć z Telegramem."; }
      }
      return json({ skonfigurowano: skonfigurowano(), konto: skonfigurowano() ? konto?.username ?? null : null, sprawdzono_at: skonfigurowano() ? konto?.sprawdzono_at ?? null : null, blad, limit: sz.limit_dzienny, dzis: await dzis() }, 200, origin);
    }

    if (action === "szablon") {
      const zapisany = await ustawienie(USTAWIENIA);
      return json({ szablon: normalizujSzablon(zapisany).szablon, wlasny: !!zapisany, domyslny: DOMYSLNY, zmienne: ZMIENNE, warunki: WARUNKI }, 200, origin);
    }
    if (action === "szablon_zapisz") {
      const { szablon: sz, bledy } = normalizujSzablon(body.szablon);
      if (!body.szablon || bledy.length) return json({ error: bledy.join(" ") || "Brak szablonu.", bledy }, 400, origin);
      await zapiszUstawienie(USTAWIENIA, { ...sz, zapisal: ja.email, zapisano_at: new Date().toISOString() });
      console.log("telegram-grupa szablon_zapisz", "tematów:", sz.tematy.length);
      return json({ ok: true, szablon: sz }, 200, origin);
    }

    if (action === "lista") {
      if (body.klient_id != null && !okId(body.klient_id)) return json({ error: "Nieprawidłowy identyfikator klienta." }, 400, origin);
      const rows = await czytaj("telegram_grupy?select=id,klient,nip,tytul,chat_id,link,status,blad,porzucono,ostrzezenia,utworzyl,created_at,updated_at&order=created_at.desc&limit=100" + (body.klient_id ? `&klient=eq.${enc(body.klient_id)}` : ""));
      return json({ grupy: rows }, 200, origin);
    }
    if (action === "postep") {
      if (!UUID.test(body.id ?? "")) return json({ error: "Nieprawidłowy identyfikator." }, 400, origin);
      const g = (await czytaj(`telegram_grupy?id=eq.${body.id}&select=id,tytul,status,blad,kroki,plan,created_at,chat_id,link,ostrzezenia`))[0];
      return json(g ? wierszDlaStrony(g) : { brak: true }, 200, origin);
    }

    if (action === "dokoncz") {
      if (!UUID.test(body.id ?? "")) return json({ error: "Nieprawidłowy identyfikator." }, 400, origin);
      if (!skonfigurowano()) return json({ error: NIE_PODLACZONE, nie_skonfigurowano: true }, 503, origin);
      const g = (await czytaj(`telegram_grupy?id=eq.${body.id}&select=*`))[0];
      if (!g) return json({ error: "Nie ma takiego wpisu." }, 404, origin);
      if (g.status === "gotowa") return json({ ...wierszDlaStrony(g), ok: true }, 200, origin);
      if (g.porzucono) return json({ error: "Ta próba została porzucona — utwórz grupę od nowa." }, 409, origin);
      // one run at a time per row: the lock is a single conditional update
      const teraz = new Date().toISOString();
      const lock = await db(`telegram_grupy?id=eq.${g.id}&status=neq.gotowa&porzucono=is.false&or=(zajete_do.is.null,zajete_do.lt.${enc(teraz)})`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ zajete_do: new Date(Date.now() + BLOKADA_MS).toISOString(), status: "w_toku", blad: null }) });
      const zajety = lock.ok ? (await lock.json())[0] : null;
      if (!zajety) return json({ error: "To tworzenie właśnie trwa — poczekaj chwilę." }, 409, origin);
      return json(await wykonaj(zajety, ja), 200, origin);
    }

    // everything below is about one client
    if (!["podglad", "utworz", "rachunek_zus"].includes(action)) return json({ error: "Nieznana akcja." }, 400, origin);
    if (!okId(body.klient_id)) return json({ error: "Nieprawidłowy identyfikator klienta." }, 400, origin);
    const s = await daneKlienta(body.klient_id);
    if (!s) return json({ error: "Nie ma takiego klienta." }, 404, origin);
    const zm: Zmiany = body.zmiany && typeof body.zmiany === "object" ? body.zmiany : {};

    if (action === "rachunek_zus") {
      const z = rachunekZus(body.rachunek_zus, s.k.nip);
      if (z.blad) return json({ error: z.blad }, 400, origin);
      const r = await db(`klienci_baza?id=eq.${enc(s.k.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ rachunek_zus: z.nrb || null }) });
      await r.body?.cancel();
      if (!r.ok) return json({ error: "Nie udało się zapisać rachunku." }, 500, origin);
      return json({ ok: true, rachunek_zus: z.nrb, uwaga: z.uwaga }, 200, origin);
    }

    const sz = await szablon();
    const { plan, podglad } = zbudujPlan(sz, s.d, zm);
    if (s.k.status === "zakonczony") podglad.blokady.push("Obsługa tego klienta jest zakończona.");
    const maGrupe = s.czat ? { chat_id: s.czat } : null;

    if (action === "podglad") {
      const mikro = mikrorachunek(s.k.nip);
      return json({
        klient: { id: s.k.id, nazwa: s.k.nazwa, nip: s.k.nip, rachunek_zus: s.k.rachunek_zus ? grupuj(s.k.rachunek_zus) : "", mikrorachunek: mikro ? grupuj(mikro) : "" },
        podglad, ma_grupe: maGrupe, niedokonczona: wierszDlaStrony(s.niedokonczona), ostatnia: wierszDlaStrony(s.grupy.find((g) => g.status === "gotowa")),
        skonfigurowano: skonfigurowano(), limit: sz.limit_dzienny, dzis: await dzis(),
      }, 200, origin);
    }

    // ---- utworz
    if (body.potwierdzam !== true) return json({ error: "Utworzenie grupy wymaga potwierdzenia." }, 400, origin);
    if (!skonfigurowano()) return json({ error: NIE_PODLACZONE, nie_skonfigurowano: true }, 503, origin);
    const id = body.id == null ? crypto.randomUUID() : String(body.id).toLowerCase();
    if (!UUID.test(id)) return json({ error: "Nieprawidłowy identyfikator." }, 400, origin);
    const wymus = body.wymus === true;
    if (s.niedokonczona && !wymus) return json({ error: "Dla tego klienta jest niedokończone tworzenie grupy — dokończ je zamiast zaczynać nowe.", niedokonczona: wierszDlaStrony(s.niedokonczona) }, 409, origin);
    if (maGrupe && !wymus) return json({ error: "Ten klient ma już wpisaną grupę Telegram (id " + maGrupe.chat_id + ").", ma_grupe: maGrupe }, 409, origin);
    if (podglad.blokady.length) return json({ error: podglad.blokady.join(" "), blokady: podglad.blokady }, 400, origin);
    if (await dzis() >= sz.limit_dzienny) return json({ error: "Dzienny limit nowych grup (" + sz.limit_dzienny + " na dobę) jest wyczerpany — dokończ jutro albo zwiększ limit w szablonie." }, 429, origin);
    // the account typed in the window is kept with the client
    if (zm.rachunek_zus !== undefined) {
      const z = rachunekZus(zm.rachunek_zus, s.k.nip);
      if (!z.blad && (z.nrb || null) !== (s.k.rachunek_zus ?? null)) { const r = await db(`klienci_baza?id=eq.${enc(s.k.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ rachunek_zus: z.nrb || null }) }); await r.body?.cancel(); }
    }
    // a forced new start gives up the earlier attempts (they are never continued afterwards) — but not one
    // whose run is going on right now: that one keeps its row and the insert below is refused
    if (wymus) { const r = await db(`telegram_grupy?klient=eq.${enc(s.k.id)}&status=neq.gotowa&porzucono=is.false&or=(zajete_do.is.null,zajete_do.lt.${enc(new Date().toISOString())})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ porzucono: true, status: "blad", updated_at: new Date().toISOString() }) }); await r.body?.cancel(); }
    const ins = await db("telegram_grupy", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ id, klient: s.k.id, nip: s.k.nip, tytul: plan.tytul, status: "w_toku", plan, kroki: { ziarno: id }, utworzyl: ja.email, zajete_do: new Date(Date.now() + BLOKADA_MS).toISOString() }) });
    if (!ins.ok) {
      const t = await ins.text();
      if (t.includes("23505")) return json({ error: "Tworzenie grupy dla tego klienta właśnie trwa." }, 409, origin);
      console.error("telegram-grupa utworz wpis", ins.status);
      return json({ error: "Nie udało się zapisać wpisu — grupa nie została utworzona." }, 500, origin);
    }
    const row = (await ins.json())[0];
    // the cap once more, now that this run is counted: of several requests sent together none goes over it
    if (await dzis() > sz.limit_dzienny) {
      const r = await db(`telegram_grupy?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ porzucono: true, status: "blad", blad: "Dzienny limit nowych grup.", zajete_do: null, updated_at: new Date().toISOString() }) });
      await r.body?.cancel();
      return json({ error: "Dzienny limit nowych grup (" + sz.limit_dzienny + " na dobę) jest wyczerpany — dokończ jutro albo zwiększ limit w szablonie." }, 429, origin);
    }
    return json(await wykonaj(row, ja), 200, origin);
  } catch (e) {
    console.error("telegram-grupa", action, String((e as Error)?.message ?? e).slice(0, 120));
    return json({ error: "Błąd serwera — spróbuj ponownie." }, 500, origin);
  }
});
