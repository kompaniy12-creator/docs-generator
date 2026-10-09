// Komunikacja z klientami — the rules, without the network or the database (tested in logic_test.ts):
// invitation tokens, the safe message builder, placeholders, who receives what through which channel,
// the consent gate for marketing, approval rules, the provider's answers, retry times, CSV, bot texts
// and the built-in templates.

import { analiza, przygotuj } from "../sms/logic.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
export type Jezyk = "pl" | "ru" | "uk";
export const JEZYKI: Jezyk[] = ["pl", "ru", "uk"];
export const NAZWA_JEZYKA: Record<Jezyk, string> = { pl: "polski", ru: "rosyjski", uk: "ukraiński" };

// "Język komunikacji" of the clients base (free text: Russian / Ukrainian / Polish, also in Polish or Cyrillic)
export function jezykKlienta(v: unknown): Jezyk | "" {
  const s = String(v ?? "").trim().toLowerCase();
  if (/^(ru|rus|russian|rosyjski|рус)/.test(s)) return "ru";
  if (/^(uk|ua|ukr|ukrainian|ukrai[nń]ski|укр)/.test(s)) return "uk";
  if (/^(pl|pol|polish|polski|пол)/.test(s)) return "pl";
  return "";
}
// Telegram's language_code (IETF tag) -> a language the bot speaks
export function jezykTg(code: unknown): Jezyk {
  const s = String(code ?? "").toLowerCase().slice(0, 2);
  return s === "ru" || s === "be" ? "ru" : s === "uk" ? "uk" : "pl";
}

// ---------------------------------------------------------------- tokens
const te = new TextEncoder();
export function b64url(b: Uint8Array): string {
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function sha256hex(s: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(s)))); }
export const losowaSol = () => hex(crypto.getRandomValues(new Uint8Array(24)));
// Telegram's start parameter: up to 64 characters of [A-Za-z0-9_-]. 32 characters of base64url = 192 bits.
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export async function tokenZSoli(sekret: string, sol: string): Promise<string> {
  if (sekret.length < 32) throw new Error("KOMUNIKACJA_SECRET za krótki");
  const k = await crypto.subtle.importKey("raw", te.encode(sekret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, te.encode("zaproszenie-tg:" + sol)))).slice(0, 32);
}
// comparison whose time does not depend on where the strings differ
export function staleRowne(a: string, b: string): boolean {
  const x = te.encode(a), y = te.encode(b);
  let r = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) r |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return r === 0 && x.length > 0;
}
export const BOT_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
export const linkBota = (username: string, token: string) => BOT_RE.test(username) && TOKEN_RE.test(token) ? `https://t.me/${username}?start=${token}` : "";

// ---------------------------------------------------------------- the safe message builder
// A message is a list of segments produced by the page's editor — never markup typed by a person. The
// function builds Telegram's HTML itself and escapes every character that comes from a user or a client.
export type Seg = { t: string; b?: boolean; i?: boolean; url?: string };
export const LINK_SUB = "{link_subskrypcji}";
export const POLA = ["firma", "kontakt", "opiekun", "link_subskrypcji"] as const;
export type Dane = Partial<Record<(typeof POLA)[number], string>>;
export const MAX_TG = 4096, MAX_SEG = 300, MAX_PRZYCISKI = 3, MAX_ETYKIETA = 40, MAX_SMS = 600, MAX_MAIL = 20000, MAX_TEMAT = 150;

export const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// control characters (except the line break) never reach a message
// deno-lint-ignore no-control-regex
const czysc = (s: unknown) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "");

// A link a person may put into a message or a button: https only, a real host, no user:password@, no spaces.
export function urlOk(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const s = u.trim();
  // deno-lint-ignore no-control-regex
  if (!s || s.length > 500 || /[\s\u0000-\u001F\u007F<>"'`\\]/.test(s) || !/^https:\/\//i.test(s)) return null;
  let p: URL;
  try { p = new URL(s); } catch { return null; }
  if (p.protocol !== "https:" || p.username || p.password || (p.port && p.port !== "443")) return null;
  const h = p.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) || h.startsWith("xn--") || h.includes(".xn--") || /^[0-9.]+$/.test(h)) return null; // no IP, no punycode look-alikes
  return p.href;
}
export function czyscSegmenty(v: unknown): { ok: true; seg: Seg[] } | { ok: false; error: string } {
  if (v == null) return { ok: true, seg: [] };
  if (!Array.isArray(v) || v.length > MAX_SEG) return { ok: false, error: "Nieprawidłowa treść wiadomości." };
  const out: Seg[] = [];
  let n = 0;
  for (const x of v) {
    if (!x || typeof x !== "object" || typeof (x as Any).t !== "string") return { ok: false, error: "Nieprawidłowa treść wiadomości." };
    const t = czysc((x as Any).t);
    if (!t) continue;
    n += t.length;
    const s: Seg = { t };
    if ((x as Any).b === true) s.b = true;
    if ((x as Any).i === true) s.i = true;
    if ((x as Any).url != null && (x as Any).url !== "") {
      const u = (x as Any).url === LINK_SUB ? LINK_SUB : urlOk((x as Any).url);
      if (!u) return { ok: false, error: "Link w treści musi zaczynać się od https:// i prowadzić do zwykłego adresu: " + String((x as Any).url).slice(0, 80) };
      s.url = u;
    }
    out.push(s);
  }
  if (n > 6000) return { ok: false, error: "Treść jest za długa." };
  return { ok: true, seg: out };
}
// {firma} {kontakt} {opiekun} {link_subskrypcji} — one pass: a value that itself looks like a placeholder is not expanded
export function wstaw(t: string, d: Dane): string {
  return t.replace(/\{(firma|kontakt|opiekun|link_subskrypcji)\}/g, (_m, k: (typeof POLA)[number]) => czysc(d[k] ?? "").replace(/\n/g, " ").slice(0, 300));
}
const adres = (s: Seg, d: Dane) => s.url === LINK_SUB ? urlOk(d.link_subskrypcji ?? "") : s.url ? urlOk(s.url) : null;
export function tgHtml(seg: Seg[], d: Dane): string {
  return seg.map((s) => {
    let h = escHtml(wstaw(s.t, d));
    if (!h) return "";
    if (s.b) h = "<b>" + h + "</b>";
    if (s.i) h = "<i>" + h + "</i>";
    const u = adres(s, d);
    return u ? '<a href="' + escHtml(u) + '">' + h + "</a>" : h;
  }).join("");
}
// what the recipient sees (links collapsed to their text) — for counters, previews and e-mail drafts
export function tekst(seg: Seg[], d: Dane, zLinkami = false): string {
  return seg.map((s) => {
    const t = wstaw(s.t, d), u = zLinkami ? adres(s, d) : null;
    return u && u !== t.trim() ? `${t} (${u})` : t;
  }).join("");
}
// Telegram counts UTF-16 code units of the text after the markup is parsed
export const dlugoscTg = (seg: Seg[], d: Dane) => tekst(seg, d).length;

export type Przycisk = { etykieta: Record<Jezyk, string>; url: string };
export function czyscPrzyciski(v: unknown): { ok: true; p: Przycisk[] } | { ok: false; error: string } {
  if (v == null) return { ok: true, p: [] };
  if (!Array.isArray(v) || v.length > MAX_PRZYCISKI) return { ok: false, error: "Najwyżej " + MAX_PRZYCISKI + " przyciski." };
  const p: Przycisk[] = [];
  for (const x of v) {
    const e = {} as Record<Jezyk, string>;
    for (const j of JEZYKI) e[j] = czysc((x as Any)?.etykieta?.[j]).replace(/\n/g, " ").trim().slice(0, MAX_ETYKIETA);
    if (!JEZYKI.some((j) => e[j])) return { ok: false, error: "Przycisk musi mieć napis." };
    const u = (x as Any)?.url === LINK_SUB ? LINK_SUB : urlOk((x as Any)?.url);
    if (!u) return { ok: false, error: "Adres przycisku musi zaczynać się od https:// (albo być linkiem subskrypcji klienta)." };
    p.push({ etykieta: e, url: u });
  }
  return { ok: true, p };
}

export type Tresc = {
  wspolna: boolean; fallback: Jezyk[];
  tg: Record<Jezyk, Seg[]>; przyciski: Przycisk[];
  sms: Record<Jezyk, string>; mail: { temat: Record<Jezyk, string>; tresc: Record<Jezyk, string> };
};
export function czyscTresc(v: Any): { ok: true; tresc: Tresc } | { ok: false; error: string } {
  const t: Tresc = { wspolna: v?.wspolna === true, fallback: [], tg: { pl: [], ru: [], uk: [] }, przyciski: [], sms: { pl: "", ru: "", uk: "" }, mail: { temat: { pl: "", ru: "", uk: "" }, tresc: { pl: "", ru: "", uk: "" } } };
  for (const j of Array.isArray(v?.fallback) ? v.fallback : []) if (JEZYKI.includes(j) && !t.fallback.includes(j)) t.fallback.push(j);
  for (const j of JEZYKI) if (!t.fallback.includes(j)) t.fallback.push(j);
  for (const j of JEZYKI) {
    const s = czyscSegmenty(v?.tg?.[j]);
    if (!s.ok) return s;
    t.tg[j] = s.seg;
    if (dlugoscTg(s.seg, {}) > MAX_TG - 300) return { ok: false, error: `Treść Telegram (${NAZWA_JEZYKA[j]}) jest za długa — najwyżej ${MAX_TG - 300} znaków.` };
    t.sms[j] = czysc(v?.sms?.[j]).trim();
    if (t.sms[j].length > MAX_SMS) return { ok: false, error: `Treść SMS (${NAZWA_JEZYKA[j]}) jest za długa.` };
    t.mail.temat[j] = czysc(v?.mail?.temat?.[j]).replace(/\n/g, " ").trim();
    t.mail.tresc[j] = czysc(v?.mail?.tresc?.[j]).trim();
    if (t.mail.temat[j].length > MAX_TEMAT || t.mail.tresc[j].length > MAX_MAIL) return { ok: false, error: `E-mail (${NAZWA_JEZYKA[j]}) jest za długi.` };
  }
  const p = czyscPrzyciski(v?.przyciski);
  if (!p.ok) return p;
  t.przyciski = p.p;
  return { ok: true, tresc: t };
}
// The variant a recipient gets: his language, then the fallback order; "one text for all" = the Polish slot.
export function wariant<T>(t: Tresc, daj: (j: Jezyk) => T, pusty: (x: T) => boolean, jezyk: Jezyk | ""): { jezyk: Jezyk; w: T } | null {
  const kolej: Jezyk[] = t.wspolna ? ["pl"] : [...(jezyk ? [jezyk] : []), ...t.fallback];
  for (const j of kolej) { const w = daj(j); if (!pusty(w)) return { jezyk: j, w }; }
  return null;
}
export const wariantTg = (t: Tresc, j: Jezyk | "") => wariant(t, (x) => t.tg[x], (s) => !s.some((y) => y.t.trim()), j);
export const wariantSms = (t: Tresc, j: Jezyk | "") => wariant(t, (x) => t.sms[x], (s) => !s, j);
export const wariantMail = (t: Tresc, j: Jezyk | "") => wariant(t, (x) => ({ temat: t.mail.temat[x], tresc: t.mail.tresc[x] }), (m) => !m.temat || !m.tresc, j);
export function klawiatura(t: Tresc, jezyk: Jezyk, d: Dane): { text: string; url: string }[][] {
  const out: { text: string; url: string }[][] = [];
  for (const p of t.przyciski) {
    const u = p.url === LINK_SUB ? urlOk(d.link_subskrypcji ?? "") : urlOk(p.url);
    const e = t.wspolna ? p.etykieta.pl || p.etykieta.ru || p.etykieta.uk : p.etykieta[jezyk] || t.fallback.map((j) => p.etykieta[j]).find(Boolean) || "";
    if (u && e) out.push([{ text: wstaw(e, d).slice(0, 64), url: u }]);
  }
  return out;
}
export function smsInfo(tekstSms: string, normalizuj: boolean) {
  const p = przygotuj(tekstSms, normalizuj), a = analiza(p.tresc);
  return { tresc: p.tresc, znaki: a.znaki, czesci: a.czesci, kodowanie: a.kodowanie };
}

// ---------------------------------------------------------------- recipients
export type KlientR = {
  id: string; nip: string; nazwa: string; forma: string; opodatkowanie: string; miasto: string; opiekun: string; kadrowy: string; kontakt: string;
  jezyk: Jezyk | ""; status: string; obslugiwany: boolean; zakres_ksiegowosc: boolean; zakres_kadry: boolean;
  grupa: string; telefon: string; email: string;
};
export type Sub = { id: string; klient: string; chat_id: string; jezyk: Jezyk; aktywna: boolean; blocked_at: string | null; zgoda_marketing: boolean };
export type Filtry = {
  status?: string[]; zakres?: "ksiegowosc" | "kadry" | ""; forma?: string[]; opodatkowanie?: string[]; opiekun?: string[]; kadrowy?: string[];
  jezyk?: string[]; miasto?: string[]; sub?: "tak" | "nie" | ""; grupa?: "tak" | "nie" | ""; telefon?: "tak" | "nie" | ""; email?: "tak" | "nie" | "";
};
export type Odb = { tryb: "wszyscy" | "filtry" | "recznie"; filtry: Filtry; wybrani: string[]; wykluczeni: string[] };
const okId = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && (/^\d{10}$/.test(v) || /^nazwa:.+/.test(v));
const lista = (v: unknown, n = 300) => Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x.length <= 300).map((x) => x as string))].slice(0, n) : [];
const takNie = (v: unknown) => v === "tak" || v === "nie" ? v : "";
export function czyscOdbiorcow(v: Any): Odb {
  const f = v?.filtry ?? {};
  return {
    tryb: v?.tryb === "filtry" || v?.tryb === "recznie" ? v.tryb : "wszyscy",
    filtry: {
      status: lista(f.status, 3).filter((s) => ["obslugiwany", "wstrzymany", "zakonczony"].includes(s)), zakres: f.zakres === "ksiegowosc" || f.zakres === "kadry" ? f.zakres : "",
      forma: lista(f.forma, 50), opodatkowanie: lista(f.opodatkowanie, 50), opiekun: lista(f.opiekun, 50), kadrowy: lista(f.kadrowy, 50),
      jezyk: lista(f.jezyk, 4).filter((j) => ["pl", "ru", "uk", ""].includes(j)), miasto: lista(f.miasto, 100),
      sub: takNie(f.sub), grupa: takNie(f.grupa), telefon: takNie(f.telefon), email: takNie(f.email),
    },
    wybrani: lista(v?.wybrani, 2000).filter(okId), wykluczeni: lista(v?.wykluczeni, 2000).filter(okId),
  };
}
const maAktywna = (subs: Sub[] | undefined) => !!subs?.some((s) => s.aktywna && !s.blocked_at);
export const czyGrupa = (c: string) => /^-\d{5,20}$/.test(c);
const n = (s: string) => s.trim().toLowerCase();
// Who the broadcast is addressed to. A client whose service has ended is never taken by "all" or by a
// filter unless the status filter names 'zakonczony' — picked by hand, he is.
export function wybierz(klienci: KlientR[], subs: Map<string, Sub[]>, o: Odb): KlientR[] {
  const wyb = new Set(o.wybrani), wyk = new Set(o.wykluczeni), f = o.filtry;
  const w = (l: string[] | undefined, v: string) => !l?.length || l.map(n).includes(n(v));
  const b = (t: string | undefined, jest: boolean) => !t || (t === "tak") === jest;
  return klienci.filter((k) => {
    if (wyk.has(k.id)) return false;
    if (wyb.has(k.id)) return true;
    if (o.tryb === "recznie") return false;
    if (o.tryb === "wszyscy") return k.obslugiwany;
    if (f.status?.length ? !f.status.includes(k.status) : !k.obslugiwany) return false;
    if (f.zakres === "ksiegowosc" && !k.zakres_ksiegowosc) return false;
    if (f.zakres === "kadry" && !k.zakres_kadry) return false;
    return w(f.forma, k.forma) && w(f.opodatkowanie, k.opodatkowanie) && w(f.opiekun, k.opiekun) && w(f.kadrowy, k.kadrowy) && w(f.miasto, k.miasto)
      && (!f.jezyk?.length || f.jezyk.includes(k.jezyk))
      && b(f.sub, maAktywna(subs.get(k.id))) && b(f.grupa, czyGrupa(k.grupa)) && b(f.telefon, !!k.telefon) && b(f.email, !!k.email);
  });
}

export type Typ = "serwisowa" | "marketingowa";
export type Strategia = "bot" | "bot_sms" | "bot_mail" | "bot_grupa" | "wszystkie";
export type Kanal = "bot" | "grupa" | "sms" | "mail";
export type Kanaly = Record<Kanal, boolean>;
export const STRATEGIE: Strategia[] = ["bot", "bot_sms", "bot_mail", "bot_grupa", "wszystkie"];
// the channels a strategy uses; only "all selected channels" reads the toggles
export function kanalyStrategii(s: Strategia, k: Any): Kanaly {
  if (s === "bot") return { bot: true, grupa: false, sms: false, mail: false };
  if (s === "bot_sms") return { bot: true, grupa: false, sms: true, mail: false };
  if (s === "bot_mail") return { bot: true, grupa: false, sms: false, mail: true };
  if (s === "bot_grupa") return { bot: true, grupa: true, sms: false, mail: false };
  return { bot: k?.bot === true, grupa: k?.grupa === true, sms: k?.sms === true, mail: k?.mail === true };
}
export type Zgody = Map<string, { sms: boolean; email: boolean }>; // client id -> recorded marketing consent
export type Dostawa = { klient: string; nip: string; nazwa: string; kanal: Kanal | "brak"; adres: string; subskrypcja: string | null; jezyk: Jezyk | null; powod: string | null };
export type Plan = { dostawy: Dostawa[]; liczby: Record<Kanal | "brak" | "klienci", number> };

// For every chosen client: the deliveries that will be made, or one row 'brak' saying why there are none.
// MARKETING: only recipients with a recorded consent; never a group (a consent is a person's, and a group is many people).
export function rozwiaz(wybrani: KlientR[], subs: Map<string, Sub[]>, zgody: Zgody, r: { typ: Typ; strategia: Strategia; kanaly: Kanaly; tresc: Tresc }): Plan {
  const mkt = r.typ === "marketingowa", k = kanalyStrategii(r.strategia, r.kanaly), widziane = new Map<string, string>();
  const dostawy: Dostawa[] = [], liczby = { bot: 0, grupa: 0, sms: 0, mail: 0, brak: 0, klienci: 0 };
  for (const c of wybrani) {
    const powody: string[] = [], baza = { klient: c.id, nip: c.nip, nazwa: c.nazwa };
    const moz: Record<Kanal, Dostawa[]> = { bot: [], grupa: [], sms: [], mail: [] };
    if (k.bot) {
      const wszystkie = subs.get(c.id) ?? [], akt = wszystkie.filter((s) => s.aktywna && !s.blocked_at), zgodni = mkt ? akt.filter((s) => s.zgoda_marketing) : akt;
      if (!wszystkie.length) powody.push("brak subskrypcji bota");
      else if (!akt.length) powody.push("subskrypcja wyłączona albo bot zablokowany");
      else if (!zgodni.length) powody.push("brak zgody marketingowej (Telegram)");
      for (const s of zgodni) {
        const w = wariantTg(r.tresc, s.jezyk || c.jezyk);
        if (!w) { powody.push("brak treści Telegram dla języka odbiorcy"); continue; }
        moz.bot.push({ ...baza, kanal: "bot", adres: s.chat_id, subskrypcja: s.id, jezyk: w.jezyk, powod: null });
      }
    }
    if (k.grupa) {
      const w = wariantTg(r.tresc, c.jezyk);
      if (mkt) powody.push("grupa nie może dostać rozsyłki marketingowej");
      else if (!czyGrupa(c.grupa)) powody.push("brak grupy Telegram w bazie klientów");
      else if (!w) powody.push("brak treści Telegram dla języka klienta");
      else moz.grupa.push({ ...baza, kanal: "grupa", adres: c.grupa, subskrypcja: null, jezyk: w.jezyk, powod: null });
    }
    if (k.sms) {
      const w = wariantSms(r.tresc, c.jezyk);
      if (!c.telefon) powody.push("brak numeru komórkowego w bazie klientów");
      else if (mkt && !zgody.get(c.id)?.sms) powody.push("brak zgody marketingowej (SMS)");
      else if (!w) powody.push("brak treści SMS");
      else moz.sms.push({ ...baza, kanal: "sms", adres: c.telefon, subskrypcja: null, jezyk: w.jezyk, powod: null });
    }
    if (k.mail) {
      const w = wariantMail(r.tresc, c.jezyk);
      if (!c.email) powody.push("brak adresu e-mail w bazie klientów");
      else if (mkt && !zgody.get(c.id)?.email) powody.push("brak zgody marketingowej (e-mail)");
      else if (!w) powody.push("brak tematu lub treści e-maila");
      else moz.mail.push({ ...baza, kanal: "mail", adres: c.email.toLowerCase(), subskrypcja: null, jezyk: w.jezyk, powod: null });
    }
    const drugi: Kanal | null = r.strategia === "bot_sms" ? "sms" : r.strategia === "bot_mail" ? "mail" : r.strategia === "bot_grupa" ? "grupa" : null;
    const kandydaci = r.strategia === "wszystkie" ? [...moz.bot, ...moz.grupa, ...moz.sms, ...moz.mail] : moz.bot.length ? moz.bot : drugi ? moz[drugi] : [];
    // nobody gets the same broadcast twice through one channel — also when two clients share a chat, a phone or a mailbox
    const moje = kandydaci.filter((d) => {
      const klucz = d.kanal + "|" + d.adres, bylo = widziane.get(klucz);
      if (bylo) { powody.push("ten sam adres co u klienta: " + bylo); return false; }
      widziane.set(klucz, c.nazwa); return true;
    });
    if (moje.length) { liczby.klienci++; for (const d of moje) { dostawy.push(d); liczby[d.kanal as Kanal]++; } }
    else { liczby.brak++; dostawy.push({ ...baza, kanal: "brak", adres: c.id, subskrypcja: null, jezyk: null, powod: [...new Set(powody)].join("; ") || "żaden kanał nie jest wybrany" }); }
  }
  return { dostawy, liczby };
}

// ---------------------------------------------------------------- settings
export type Ust = {
  prog_akceptacji: number; godziny: { od: string; do: string }; na_przebieg: number; odstep_ms: number; stop_po_bledach: number; max_prob: number;
  link_dni: number; link_max: number; koniec_grup: string; polityka_url: string; by?: string; updated_at?: string;
  // how the bot's updates reach tg-bot: "webhook" = Telegram calls the portal directly; "przekazywanie" = the bot's
  // webhook belongs to another application of the office (the onboarding app), which forwards private-chat
  // updates to tg-bot — the portal then never touches the webhook; "auto" = decided by what getWebhookInfo shows
  tryb_bota: "auto" | "webhook" | "przekazywanie"; host_przekazujacy: string;
};
export const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export type TrybBota = "webhook" | "przekazywanie";
export function trybBota(u: Ust, w: { ustawiony: boolean; nasz: boolean; host: string | null } | null): TrybBota {
  if (u.tryb_bota === "przekazywanie") return "przekazywanie";
  return u.tryb_bota === "auto" && !!w && w.ustawiony && !w.nasz && w.host === u.host_przekazujacy ? "przekazywanie" : "webhook";
}
export const DOMYSLNE: Ust = { prog_akceptacji: 5, godziny: { od: "08:00", do: "20:00" }, na_przebieg: 20, odstep_ms: 1500, stop_po_bledach: 5, max_prob: 4, link_dni: 90, link_max: 30, koniec_grup: "", polityka_url: "", tryb_bota: "auto", host_przekazujacy: "td-onboarding.vercel.app" };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/, DATA = /^\d{4}-\d{2}-\d{2}$/;
const calk = (v: unknown, min: number, max: number, dom: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? v as number : dom;
export function czytajUst(v: Any): Ust {
  const d = DOMYSLNE, g = v?.godziny;
  return {
    prog_akceptacji: calk(v?.prog_akceptacji, 0, 50, d.prog_akceptacji),
    godziny: HHMM.test(g?.od ?? "") && HHMM.test(g?.do ?? "") && g.od < g.do ? { od: g.od, do: g.do } : d.godziny,
    na_przebieg: calk(v?.na_przebieg, 1, 30, d.na_przebieg), odstep_ms: calk(v?.odstep_ms, 1100, 10000, d.odstep_ms),
    stop_po_bledach: calk(v?.stop_po_bledach, 2, 20, d.stop_po_bledach), max_prob: calk(v?.max_prob, 1, 6, d.max_prob),
    link_dni: calk(v?.link_dni, 7, 365, d.link_dni), link_max: calk(v?.link_max, 1, 200, d.link_max),
    koniec_grup: DATA.test(v?.koniec_grup ?? "") ? v.koniec_grup : "", polityka_url: urlOk(v?.polityka_url) ?? "",
    tryb_bota: ["webhook", "przekazywanie"].includes(v?.tryb_bota) ? v.tryb_bota : "auto", host_przekazujacy: typeof v?.host_przekazujacy === "string" && HOST_RE.test(v.host_przekazujacy) && v.host_przekazujacy.length <= 120 ? v.host_przekazujacy : d.host_przekazujacy,
    by: typeof v?.by === "string" ? v.by : undefined, updated_at: typeof v?.updated_at === "string" ? v.updated_at : undefined,
  };
}
export function sprawdzUst(v: Any): { ok: true; ust: Ust } | { ok: false; error: string } {
  const u = czytajUst(v), g = v?.godziny;
  if (!HHMM.test(g?.od ?? "") || !HHMM.test(g?.do ?? "") || g.od >= g.do) return { ok: false, error: "Godziny wysyłki: podaj początek i koniec (koniec później niż początek)." };
  if (g.od < "06:00" || g.do > "22:00") return { ok: false, error: "Godziny wysyłki muszą mieścić się między 06:00 a 22:00." };
  for (const [k, opis] of [["prog_akceptacji", "Próg akceptacji"], ["na_przebieg", "Wiadomości na przebieg"], ["odstep_ms", "Odstęp między wiadomościami"], ["stop_po_bledach", "Zatrzymanie po błędach"], ["link_dni", "Ważność linku"], ["link_max", "Limit użyć linku"]] as const) {
    if (v?.[k] !== u[k]) return { ok: false, error: opis + ": wartość poza dozwolonym zakresem." };
  }
  if (v?.polityka_url && !u.polityka_url) return { ok: false, error: "Adres polityki prywatności musi zaczynać się od https://." };
  if (v?.koniec_grup && !u.koniec_grup) return { ok: false, error: "Data końca rozsyłek w grupach: RRRR-MM-DD." };
  if (v?.tryb_bota != null && v.tryb_bota !== u.tryb_bota) return { ok: false, error: "Tryb bota: auto, webhook albo przekazywanie." };
  if (v?.host_przekazujacy != null && v.host_przekazujacy !== u.host_przekazujacy) return { ok: false, error: "Host aplikacji przekazującej: sama nazwa hosta, np. td-onboarding.vercel.app." };
  delete u.by; delete u.updated_at;
  return { ok: true, ust: u };
}
// At the configured pace one run never comes near Telegram's limits (about 30 messages a second in all,
// one a second per chat, 20 a minute per group): at most na_przebieg messages, at least 1.1 s apart.
export const ileWPrzebiegu = (u: Ust, budzetMs: number) => Math.max(1, Math.min(u.na_przebieg, Math.floor(budzetMs / u.odstep_ms)));

// ---------------------------------------------------------------- approval
export type Ja = { email: string; admin: boolean };
export function powodyAkceptacji(x: { liczba: number; grupa: number; typ: Typ }, prog: number): string[] {
  const p: string[] = [];
  if (x.liczba > prog) p.push(`więcej niż ${prog} odbiorców (${x.liczba})`);
  if (x.grupa > 0) p.push(`wysyłka do grup klientów (${x.grupa}) — powiadomi wszystkich uczestników każdej grupy`);
  if (x.typ === "marketingowa") p.push("rozsyłka marketingowa");
  return p;
}
// Four eyes: an administrator other than the author approves. Only when there is no other administrator
// may the author approve his own broadcast — and that is recorded.
export function akceptacja(ja: Ja, autor: string, inniAdmini: number): { ok: true; sam: boolean } | { ok: false; error: string } {
  if (!ja.admin) return { ok: false, error: "Rozsyłkę akceptuje administrator portalu." };
  if (ja.email.toLowerCase() !== autor.toLowerCase()) return { ok: true, sam: false };
  if (inniAdmini > 0) return { ok: false, error: "Autor nie akceptuje własnej rozsyłki — poproś innego administratora." };
  return { ok: true, sam: true };
}
export const PROG_TYTUL = 20; // above this many recipients the title is typed to confirm
export function potwierdzenie(tytul: string, liczby: Plan["liczby"], p: Any): string | null {
  for (const k of ["bot", "grupa", "sms", "mail"] as const) if (Number(p?.liczby?.[k] ?? -1) !== liczby[k]) return "Lista odbiorców zmieniła się od czasu podglądu — sprawdź ją jeszcze raz.";
  const razem = liczby.bot + liczby.grupa + liczby.sms + liczby.mail;
  if (razem === 0) return "Nikt nie otrzyma tej rozsyłki — zmień odbiorców albo kanały.";
  if (razem > PROG_TYTUL && String(p?.tytul ?? "").trim() !== tytul.trim()) return "Aby potwierdzić wysyłkę do więcej niż " + PROG_TYTUL + " odbiorców, przepisz dokładnie tytuł rozsyłki.";
  return null;
}
// everything that reaches a recipient; a test message is valid for exactly this content
export function odcisk(r: { typ: string; tresc: unknown; strategia: string; kanaly: unknown }): Promise<string> {
  const stale = (v: Any): Any => Array.isArray(v) ? v.map(stale) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stale(v[k])])) : v;
  return sha256hex(JSON.stringify(stale({ typ: r.typ, tresc: r.tresc, strategia: r.strategia, kanaly: r.kanaly })));
}

// ---------------------------------------------------------------- the provider's answers
export type Wynik =
  | { rodzaj: "ok"; message_id: number | null }
  | { rodzaj: "ponow"; po_s: number | null; opis: string; limit: boolean }   // 429 / 5xx: later, the same row
  | { rodzaj: "zablokowany"; opis: string }                                 // the user blocked the bot / deleted the account
  | { rodzaj: "migracja"; nowy: string; opis: string }                      // the group became a supergroup with a new id
  | { rodzaj: "brak_czatu"; opis: string }
  | { rodzaj: "auth"; opis: string }                                        // the token is wrong: stop everything
  | { rodzaj: "blad"; opis: string };
export function czytajTg(http: number, d: Any): Wynik {
  if (http === 200 && d?.ok === true) return { rodzaj: "ok", message_id: Number.isInteger(d.result?.message_id) ? d.result.message_id : null };
  const opis = String(d?.description ?? "HTTP " + http).slice(0, 200), o = opis.toLowerCase();
  const kod = Number(d?.error_code ?? http);
  if (kod === 429) { const s = Number(d?.parameters?.retry_after); return { rodzaj: "ponow", po_s: Number.isFinite(s) && s > 0 ? Math.min(s, 3600) : null, opis, limit: true }; }
  if (kod === 401 || kod === 404 && !d?.description) return { rodzaj: "auth", opis };
  const nowy = d?.parameters?.migrate_to_chat_id;
  if (nowy != null && /^-?\d{5,20}$/.test(String(nowy))) return { rodzaj: "migracja", nowy: String(nowy), opis };
  if (kod === 403 && /blocked by the user|user is deactivated|bot can't initiate conversation/.test(o)) return { rodzaj: "zablokowany", opis };
  if (kod === 403 || (kod === 400 && /chat not found|peer_id_invalid|group chat was deleted|bot was kicked|not a member|have no rights/.test(o))) return { rodzaj: "brak_czatu", opis };
  if (kod >= 500 || http === 0) return { rodzaj: "ponow", po_s: null, opis, limit: false };
  return { rodzaj: "blad", opis };
}
// when a row that must be repeated is due: what the provider asked for (plus a margin), else 1, 5, 15, 60 minutes
export function kiedyPonowic(teraz: Date, proba: number, po_s: number | null): Date {
  const s = po_s != null ? po_s + 3 : [60, 300, 900, 3600][Math.max(0, Math.min(3, proba - 1))];
  return new Date(teraz.getTime() + s * 1000);
}
export const maska = (kanal: string, a: string) => kanal === "mail" ? a.replace(/^(.).*(@.*)$/, "$1***$2") : kanal === "sms" ? a.slice(0, 3) + "*".repeat(Math.max(0, a.length - 6)) + a.slice(-3) : kanal === "brak" ? "" : "czat …" + a.slice(-3);

// ---------------------------------------------------------------- CSV (opened in a spreadsheet)
// A cell that begins with = + - @ (or a tab / line break) would be run as a formula: it gets an apostrophe.
export function csvPole(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export const csv = (wiersze: unknown[][]) => "﻿" + wiersze.map((w) => w.map(csvPole).join(";")).join("\r\n") + "\r\n";

// ---------------------------------------------------------------- bot texts
// Short, plain, no markup: they are sent without parse_mode, so a client's name can never become markup.
export const BOT: Record<Jezyk, Record<string, string>> = {
  pl: {
    ok: "Gotowe. Powiadomienia biura TD Consulting Group są włączone dla firmy:\n{nazwa}\n\nTutaj będą przychodzić przypomnienia o terminach, informacje o dokumentach i ważne komunikaty biura.\nJeśli to nie Państwa firma — proszę wysłać /stop i dać nam znać.\n\n/stop — wyłącz powiadomienia\n/pl /ru /uk — zmień język",
    juz: "Powiadomienia dla firmy {nazwa} są już włączone.\n\n/stop — wyłącz powiadomienia\n/pl /ru /uk — zmień język",
    link: "To jest bot powiadomień biura TD Consulting Group. Aby włączyć powiadomienia, proszę otworzyć link otrzymany od biura. Jeśli link nie działa, proszę poprosić opiekuna o nowy.",
    stop: "Powiadomienia zostały wyłączone. Aby włączyć je ponownie, proszę otworzyć link otrzymany od biura.",
    stop_brak: "Dla tego konta nie ma włączonych powiadomień.",
    jezyk: "Język wiadomości: polski.",
    pomoc: "Ten bot wysyła powiadomienia biura TD Consulting Group. Wiadomości pisane tutaj nie są czytane — z pytaniami prosimy zwracać się do opiekuna lub na czacie grupowym.\n\n/stop — wyłącz powiadomienia\n/pl /ru /uk — zmień język\n/privacy — jakie dane zapisujemy",
    prywatnosc: "Bot zapisuje: identyfikator konta Telegram, imię, nazwisko i nazwę użytkownika podane w Telegramie, język oraz datę zapisu — wyłącznie po to, by doręczać powiadomienia biura. Treść wiadomości pisanych do bota nie jest zapisywana. Administrator danych: TD Consulting Group sp. z o.o. Komenda /stop wyłącza powiadomienia.",
  },
  ru: {
    ok: "Готово. Уведомления бюро TD Consulting Group включены для компании:\n{nazwa}\n\nСюда будут приходить напоминания о сроках, информация о документах и важные сообщения бюро.\nЕсли это не ваша компания — отправьте /stop и сообщите нам.\n\n/stop — отключить уведомления\n/pl /ru /uk — сменить язык",
    juz: "Уведомления для компании {nazwa} уже включены.\n\n/stop — отключить уведомления\n/pl /ru /uk — сменить язык",
    link: "Это бот уведомлений бюро TD Consulting Group. Чтобы включить уведомления, откройте ссылку, которую вы получили от бюро. Если ссылка не работает, попросите у вашего бухгалтера новую.",
    stop: "Уведомления отключены. Чтобы включить их снова, откройте ссылку, которую вы получили от бюро.",
    stop_brak: "Для этого аккаунта уведомления не включены.",
    jezyk: "Язык сообщений: русский.",
    pomoc: "Этот бот отправляет уведомления бюро TD Consulting Group. Сообщения, написанные здесь, никто не читает — с вопросами обращайтесь к вашему бухгалтеру или в групповой чат.\n\n/stop — отключить уведомления\n/pl /ru /uk — сменить язык\n/privacy — какие данные мы храним",
    prywatnosc: "Бот сохраняет: идентификатор аккаунта Telegram, имя, фамилию и имя пользователя, указанные в Telegram, язык и дату подписки — только для того, чтобы доставлять уведомления бюро. Текст сообщений, написанных боту, не сохраняется. Администратор данных: TD Consulting Group sp. z o.o. Команда /stop отключает уведомления.",
  },
  uk: {
    ok: "Готово. Сповіщення бюро TD Consulting Group увімкнено для компанії:\n{nazwa}\n\nСюди надходитимуть нагадування про терміни, інформація про документи та важливі повідомлення бюро.\nЯкщо це не ваша компанія — надішліть /stop і повідомте нам.\n\n/stop — вимкнути сповіщення\n/pl /ru /uk — змінити мову",
    juz: "Сповіщення для компанії {nazwa} вже ввімкнено.\n\n/stop — вимкнути сповіщення\n/pl /ru /uk — змінити мову",
    link: "Це бот сповіщень бюро TD Consulting Group. Щоб увімкнути сповіщення, відкрийте посилання, яке ви отримали від бюро. Якщо посилання не працює, попросіть у вашого бухгалтера нове.",
    stop: "Сповіщення вимкнено. Щоб увімкнути їх знову, відкрийте посилання, яке ви отримали від бюро.",
    stop_brak: "Для цього акаунта сповіщення не ввімкнено.",
    jezyk: "Мова повідомлень: українська.",
    pomoc: "Цей бот надсилає сповіщення бюро TD Consulting Group. Повідомлення, написані тут, ніхто не читає — із запитаннями звертайтеся до вашого бухгалтера або в груповий чат.\n\n/stop — вимкнути сповіщення\n/pl /ru /uk — змінити мову\n/privacy — які дані ми зберігаємо",
    prywatnosc: "Бот зберігає: ідентифікатор акаунта Telegram, ім'я, прізвище та ім'я користувача, вказані в Telegram, мову й дату підписки — лише для того, щоб доставляти сповіщення бюро. Текст повідомлень, написаних боту, не зберігається. Адміністратор даних: TD Consulting Group sp. z o.o. Команда /stop вимикає сповіщення.",
  },
};
// works with plain messages: the buttons are a convenience, the commands are what always arrives
export const BOT_WYBOR_JEZYKA = "Wybierz język / Выберите язык / Оберіть мову:\n/pl — polski\n/ru — русский\n/uk — українська";
export const BOT_PRACOWNIK_OK = "Konto pracownika biura zostało połączone. Tutaj będą przychodzić wiadomości testowe rozsyłek.\n\n/stop — odłącz";
export const BOT_PRACOWNIK_LINK_KLIENTA = "To konto Telegram jest połączone z kontem pracownika biura, dlatego nie zostało zapisane jako odbiorca klienta.";
// the bot's own texts take the client's name as plain text; line breaks and length are tamed here
export const wBocie = (szablon: string, nazwa: string) => szablon.replace("{nazwa}", czysc(nazwa).replace(/\n/g, " ").slice(0, 200));

// The instruction a member of staff copies next to the link (three languages in one text).
export const instrukcja = (nazwa: string, link: string): Record<Jezyk, string> => ({
  pl: `Powiadomienia biura TD Consulting Group dla firmy ${nazwa} przychodzą w prywatnym czacie z naszym botem w Telegramie.\n1. Otwórz link: ${link}\n2. Naciśnij START.\n3. Gotowe — bot potwierdzi zapis.\nRezygnacja w każdej chwili: komenda /stop.`,
  ru: `Уведомления бюро TD Consulting Group для компании ${nazwa} приходят в личный чат с нашим ботом в Telegram.\n1. Откройте ссылку: ${link}\n2. Нажмите «СТАРТ».\n3. Готово — бот подтвердит подписку.\nОтписаться можно в любой момент: команда /stop.`,
  uk: `Сповіщення бюро TD Consulting Group для компанії ${nazwa} надходять у приватний чат із нашим ботом у Telegram.\n1. Відкрийте посилання: ${link}\n2. Натисніть «СТАРТ».\n3. Готово — бот підтвердить підписку.\nВідписатися можна будь-коли: команда /stop.`,
});

// ---------------------------------------------------------------- built-in templates
const dataSlownie = (iso: string, j: Jezyk) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return j === "pl" ? "najbliższego miesiąca" : j === "ru" ? "ближайшего месяца" : "найближчого місяця";
  const M: Record<Jezyk, string[]> = {
    pl: ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"],
    ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
    uk: ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"],
  };
  return `${Number(m[3])} ${M[j][Number(m[2]) - 1]} ${m[1]}${j === "pl" ? " r." : j === "ru" ? " г." : " р."}`;
};
// "Koniec rozsyłek w grupach — zapisz się do bota". `data` (RRRR-MM-DD): from when the office stops posting to groups.
export function szablonKoniecGrup(data: string): { nazwa: string; typ: Typ; strategia: Strategia; kanaly: Kanaly; tresc: Tresc } {
  const d = (j: Jezyk) => dataSlownie(data, j);
  const tg: Record<Jezyk, Seg[]> = {
    pl: [
      { t: "Zmiana sposobu wysyłania powiadomień", b: true },
      { t: `\n\nSzanowni Państwo,\nod ${d("pl")} biuro TD Consulting Group nie wysyła już komunikatów zbiorczych na czatach grupowych. Powiadomienia — terminy, dokumenty, ważne informacje — będą przychodzić w prywatnym czacie z naszym botem, bez powiadomień dla całej grupy.\n\n` },
      { t: "Jak włączyć powiadomienia — 3 kroki:", b: true },
      { t: "\n1. Proszę nacisnąć przycisk „Włącz powiadomienia” pod tą wiadomością.\n2. W oknie bota proszę nacisnąć START.\n3. Gotowe — bot potwierdzi zapis dla firmy {firma}.\n\nTa grupa zostaje: tutaj nadal rozmawiamy i odpowiadamy na pytania.\nZ powiadomień można zrezygnować w każdej chwili — wystarczy wysłać botowi komendę /stop." },
    ],
    ru: [
      { t: "Изменение способа отправки уведомлений", b: true },
      { t: `\n\nУважаемые клиенты!\nС ${d("ru")} бюро TD Consulting Group больше не делает массовых рассылок в групповых чатах. Уведомления — сроки, документы, важная информация — будут приходить в личный чат с нашим ботом, без оповещений для всей группы.\n\n` },
      { t: "Как включить уведомления — 3 шага:", b: true },
      { t: "\n1. Нажмите кнопку «Включить уведомления» под этим сообщением.\n2. В окне бота нажмите «СТАРТ».\n3. Готово — бот подтвердит подписку для компании {firma}.\n\nЭта группа остаётся: здесь мы по-прежнему общаемся и отвечаем на вопросы.\nОтписаться от уведомлений можно в любой момент — достаточно отправить боту команду /stop." },
    ],
    uk: [
      { t: "Зміна способу надсилання сповіщень", b: true },
      { t: `\n\nШановні клієнти!\nЗ ${d("uk")} бюро TD Consulting Group більше не робить масових розсилок у групових чатах. Сповіщення — терміни, документи, важлива інформація — надходитимуть у приватний чат із нашим ботом, без сповіщень для всієї групи.\n\n` },
      { t: "Як увімкнути сповіщення — 3 кроки:", b: true },
      { t: "\n1. Натисніть кнопку «Увімкнути сповіщення» під цим повідомленням.\n2. У вікні бота натисніть «СТАРТ».\n3. Готово — бот підтвердить підписку для компанії {firma}.\n\nЦя група залишається: тут ми, як і раніше, спілкуємося та відповідаємо на запитання.\nВідписатися від сповіщень можна будь-коли — достатньо надіслати боту команду /stop." },
    ],
  };
  const LINK: Record<Jezyk, string> = { pl: "Link do włączenia powiadomień: ", ru: "Ссылка для включения уведомлений: ", uk: "Посилання для ввімкнення сповіщень: " };
  const mail = (j: Jezyk) => tg[j].map((s) => s.t).join("") + "\n\n" + LINK[j] + LINK_SUB;
  return {
    nazwa: "Koniec rozsyłek w grupach — zapisz się do bota", typ: "serwisowa", strategia: "wszystkie", kanaly: { bot: false, grupa: true, sms: false, mail: false },
    tresc: {
      wspolna: false, fallback: ["ru", "pl", "uk"], tg,
      przyciski: [{ etykieta: { pl: "Włącz powiadomienia", ru: "Включить уведомления", uk: "Увімкнути сповіщення" }, url: LINK_SUB }],
      sms: {
        pl: "Od " + d("pl") + " powiadomienia biura przychodza w Telegramie, w prywatnym czacie z botem. Wlacz: " + LINK_SUB,
        ru: "С " + d("ru") + " уведомления бюро приходят в Telegram, в личный чат с ботом. Включить: " + LINK_SUB,
        uk: "З " + d("uk") + " сповіщення бюро надходять у Telegram, у приватний чат із ботом. Увімкнути: " + LINK_SUB,
      },
      mail: {
        temat: { pl: "TD Consulting Group: powiadomienia w Telegramie — nowy sposób", ru: "TD Consulting Group: уведомления в Telegram — новый способ", uk: "TD Consulting Group: сповіщення в Telegram — новий спосіб" },
        tresc: { pl: mail("pl"), ru: mail("ru"), uk: mail("uk") },
      },
    },
  };
}
