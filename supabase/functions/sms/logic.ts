// SMS: everything that can be decided without the network — phone numbers, message length and parts,
// quiet hours, settings, templates, the provider's answers. Tested in logic_test.ts.
//
// Lengths follow SMSAPI's documentation (smsapi.pl/docs, "Alfabet 7bit GSM"): 160 characters in one part
// or 153 per part when the text fits the GSM 7-bit alphabet (^ { } [ ] \ ~ | € count double); any other
// character — Polish letters included — makes it 70 in one part or 67 per part. At most 10 parts.

// deno-lint-ignore no-explicit-any
type Any = any;

// ---------------------------------------------------------------- phone numbers
// Mobile prefixes of the Polish numbering plan (first two digits of the 9-digit national number).
const PL_KOM = new Set(["45", "50", "51", "53", "57", "60", "66", "69", "72", "73", "78", "79", "88"]);
// Other countries are accepted only where a mobile number can be told from its digits.
const OBCE: { kod: string; kraj: string; wzor: RegExp }[] = [
  { kod: "380", kraj: "UA", wzor: /^(39|50|63|66|67|68|73|75|77|9[1-9])\d{7}$/ },
  { kod: "49", kraj: "DE", wzor: /^1[567]\d{8,9}$/ },
  { kod: "420", kraj: "CZ", wzor: /^(60[1-8]|7[0-9]{2})\d{6}$/ },
  { kod: "421", kraj: "SK", wzor: /^9\d{8}$/ },
  { kod: "370", kraj: "LT", wzor: /^6\d{7}$/ },
];
export type Numer = { ok: true; e164: string; kraj: string } | { ok: false; error: string };

// One number as a person may have typed it -> E.164. Polish mobiles only, unless `zagranica` is allowed.
export function numer(raw: unknown, zagranica = false): Numer {
  let s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: "Brak numeru telefonu." };
  if (/[a-z]/i.test(s)) return { ok: false, error: "Numer telefonu zawiera litery." };
  s = s.replace(/[\s\-().\/]/g, "");
  const plus = s.startsWith("+");
  if (plus) s = s.slice(1);
  if (!/^\d+$/.test(s)) return { ok: false, error: "Numer telefonu zawiera niedozwolone znaki." };
  let miedzynarodowy = plus;
  if (!plus && s.startsWith("00")) { s = s.slice(2); miedzynarodowy = true; }
  let kraj = "";
  if (miedzynarodowy) {
    if (s.startsWith("48")) { kraj = "PL"; s = s.slice(2); }
  } else if (s.length === 9) kraj = "PL";
  else if (s.length === 11 && s.startsWith("48")) { kraj = "PL"; s = s.slice(2); }
  else if (s.length === 10 && s.startsWith("0")) { kraj = "PL"; s = s.slice(1); } // old trunk prefix 0
  else if (s.length < 9) return { ok: false, error: "Numer jest za krótki — numery skrócone i specjalne nie są obsługiwane." };
  else return { ok: false, error: "Nie rozpoznano numeru — podaj 9 cyfr albo numer z prefiksem kraju (+48…)." };

  if (kraj === "PL") {
    if (s.length !== 9) return { ok: false, error: "Polski numer musi mieć 9 cyfr." };
    if (/^(70|80)/.test(s)) return { ok: false, error: "Numery 70x i 80x (o podwyższonej opłacie i infolinie) nie są obsługiwane." };
    if (!PL_KOM.has(s.slice(0, 2))) return { ok: false, error: "To nie jest numer komórkowy (numer stacjonarny albo specjalny) — SMS nie dotrze." };
    return { ok: true, e164: "+48" + s, kraj };
  }
  for (const o of OBCE) {
    if (!s.startsWith(o.kod)) continue;
    const reszta = s.slice(o.kod.length).replace(/^0/, "");
    if (!o.wzor.test(reszta)) return { ok: false, error: "To nie wygląda na numer komórkowy (" + o.kraj + ")." };
    if (!zagranica) return { ok: false, error: "Wysyłka na numery zagraniczne jest wyłączona w ustawieniach." };
    return { ok: true, e164: "+" + o.kod + reszta, kraj: o.kraj };
  }
  return { ok: false, error: "Numer zagraniczny z nieobsługiwanego kraju." };
}
// A cell of the clients sheet may hold several numbers ("600 100 200, 22 123 45 67"): the first mobile wins.
export function pierwszyNumer(cell: unknown, zagranica = false): Numer {
  const czesci = String(cell ?? "").split(/[,;|\n]|\s\/\s|\bi\b|\blub\b/i).map((x) => x.trim()).filter(Boolean);
  let pierwszy: Numer | null = null;
  for (const c of czesci) {
    // text beside the number ("tel. 600…", "600… (Jan)") is dropped before the check
    const n = numer(c.replace(/\([^)]*[a-ząćęłńóśźż][^)]*\)/gi, " ").replace(/[a-ząćęłńóśźż.:]+/gi, " "), zagranica);
    if (n.ok) return n;
    pierwszy ??= n;
  }
  return pierwszy ?? { ok: false, error: "Brak numeru telefonu w bazie klientów." };
}
// +48600100200 -> +48****** 200 (for people who may send but may not see clients' contact data)
export const maska = (e164: string) => e164.length < 8 ? e164 : e164.slice(0, 3) + "*".repeat(e164.length - 6) + " " + e164.slice(-3);

// ---------------------------------------------------------------- text, encoding, parts
const GSM = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà");
const GSM_EXT = new Set("^{}\\[~]|€");
const PL: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z", Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z" };
const TYPO: Record<string, string> = { "„": '"', "”": '"', "“": '"', "«": '"', "»": '"', "‚": "'", "’": "'", "‘": "'", "–": "-", "—": "-", "−": "-", "…": "...", " ": " ", " ": " ", " ": " ", "№": "nr" };
export const maPolskie = (s: string) => /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(s);
// Polish letters and typographic marks replaced by plain ones — what the provider's `normalize` does for
// Polish, done here so that the text counted is the text sent.
export const bezPolskich = (s: string) => [...s].map((c) => PL[c] ?? TYPO[c] ?? c).join("");
export const porzadkuj = (s: unknown) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export type Analiza = { znaki: number; kodowanie: "GSM-7" | "UCS-2"; czesci: number; na_czesc: number; do_konca: number; inne_znaki: string[]; za_dluga: boolean };
export function analiza(tekst: string): Analiza {
  const inne = new Set<string>();
  let gsm = 0;
  for (const c of tekst) {
    if (GSM.has(c)) gsm += 1;
    else if (GSM_EXT.has(c)) gsm += 2;
    else inne.add(c);
  }
  const ucs = inne.size > 0;
  const znaki = ucs ? tekst.length : gsm; // UCS-2: UTF-16 units (an emoji is two)
  const [jedna, wiele] = ucs ? [70, 67] : [160, 153];
  const czesci = znaki === 0 ? 0 : znaki <= jedna ? 1 : Math.ceil(znaki / wiele);
  const pojemnosc = czesci <= 1 ? jedna : czesci * wiele;
  return { znaki, kodowanie: ucs ? "UCS-2" : "GSM-7", czesci, na_czesc: czesci <= 1 ? jedna : wiele, do_konca: pojemnosc - znaki, inne_znaki: [...inne].slice(0, 20), za_dluga: czesci > 10 };
}

export const NADAWCA_TRESCI = "TD Consulting Group";
export const MAX_TRESC = 1000;
export const MAX_CZESCI = 3, MAX_CZESCI_ADMIN = 6;
// The text as it will be sent: tidied, signed with the office's name, Polish letters replaced when asked.
export function przygotuj(tresc: unknown, normalizuj: boolean): { tresc: string; podpis_dodany: boolean; polskie: boolean; usuniete: boolean } {
  let t = porzadkuj(tresc);
  const podpis = !!t && !/td\s*consulting/i.test(t);
  if (podpis) t = NADAWCA_TRESCI + ": " + t;
  const polskie = maPolskie(t);
  const po = normalizuj ? bezPolskich(t) : t;
  return { tresc: po, podpis_dodany: podpis, polskie, usuniete: normalizuj && po !== t };
}

// ---------------------------------------------------------------- quiet hours (Europe/Warsaw)
export const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
export const dzienPL = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(d);
export const wGodzinach = (d: Date, g: { od: string; do: string }) => { const t = hhmm(d); return t >= g.od && t < g.do; };
// The instant at which the given Warsaw day starts, as ISO (for "today" filters).
export function poczatekDnia(d: Date): string {
  const dzien = dzienPL(d);
  for (const off of ["+02:00", "+01:00"]) {
    const t = new Date(`${dzien}T00:00:00${off}`);
    if (dzienPL(t) === dzien && hhmm(t) === "00:00") return t.toISOString();
  }
  return new Date(`${dzien}T00:00:00+01:00`).toISOString();
}

// ---------------------------------------------------------------- settings (portal_ustawienia, key "sms")
export type Ust = {
  wlaczone: boolean; nadawca: string; limit_dzienny: number; limit_na_numer_dziennie: number;
  godziny: { od: string; do: string }; automaty: { terminy: boolean }; normalizuj: boolean; zagranica: boolean; raporty: boolean;
  by?: string; updated_at?: string;
};
// "Tw.Ksiegowa": the sender name the office verified at the provider for notifications
export const DOMYSLNE: Ust = { wlaczone: false, nadawca: "Tw.Ksiegowa", limit_dzienny: 100, limit_na_numer_dziennie: 3, godziny: { od: "08:00", do: "20:00" }, automaty: { terminy: false }, normalizuj: true, zagranica: false, raporty: false };
const GODZ = /^([01]\d|2[0-3]):[0-5]\d$/;
const OK_NADAWCA = /^[A-Za-z0-9 .\-]{1,11}$/; // SMSAPI: at most 11 characters, a-z A-Z 0-9 - . space
// "2way" is not a name but the provider's switch to two-way messages: never a sender of notifications
export const nadawcaOk = (s: unknown): s is string => typeof s === "string" && OK_NADAWCA.test(s) && !/^2way$/i.test(s.trim());
// What is stored may be anything (older shape, hand-edited): read it into a complete, safe object.
export function czytajUst(v: Any): Ust {
  const u = v && typeof v === "object" ? v : {};
  const n = (x: Any, min: number, max: number, def: number) => Number.isInteger(x) && x >= min && x <= max ? x : def;
  const g = u.godziny && GODZ.test(u.godziny.od ?? "") && GODZ.test(u.godziny.do ?? "") && u.godziny.od < u.godziny.do ? { od: u.godziny.od, do: u.godziny.do } : { ...DOMYSLNE.godziny };
  return {
    wlaczone: u.wlaczone === true, nadawca: nadawcaOk(u.nadawca) ? u.nadawca : u.nadawca === "" ? "" : DOMYSLNE.nadawca,
    limit_dzienny: n(u.limit_dzienny, 1, 2000, DOMYSLNE.limit_dzienny), limit_na_numer_dziennie: n(u.limit_na_numer_dziennie, 1, 20, DOMYSLNE.limit_na_numer_dziennie),
    godziny: g, automaty: { terminy: u.automaty?.terminy === true }, normalizuj: u.normalizuj !== false, zagranica: u.zagranica === true, raporty: u.raporty === true,
    by: typeof u.by === "string" ? u.by : undefined, updated_at: typeof u.updated_at === "string" ? u.updated_at : undefined,
  };
}
// What an administrator sent: every field checked; `nadawcy` — sender names active at the provider
// (null when they could not be read: then real sending cannot be switched on).
export function sprawdzUst(v: Any, o: { skonfigurowane: boolean; nadawcy: string[] | null }): { ok: true; ust: Ust } | { ok: false; error: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "Nieprawidłowe ustawienia." };
  const bool = (x: Any) => x === true || x === false;
  if (![v.wlaczone, v.normalizuj, v.zagranica, v.raporty ?? false, v.automaty?.terminy].every(bool)) return { ok: false, error: "Nieprawidłowa wartość przełącznika." };
  const nadawca = String(v.nadawca ?? "").trim();
  if (/^2way$/i.test(nadawca)) return { ok: false, error: "„2WAY” służy do wiadomości dwukierunkowych — nie może być nadawcą powiadomień." };
  if (nadawca && !OK_NADAWCA.test(nadawca)) return { ok: false, error: "Nazwa nadawcy: najwyżej 11 znaków — litery bez polskich znaków, cyfry, spacja, kropka, myślnik." };
  if (nadawca && o.nadawcy && !o.nadawcy.includes(nadawca)) return { ok: false, error: "Tej nazwy nadawcy nie ma wśród aktywnych pól nadawcy na koncie SMSAPI." };
  if (!Number.isInteger(v.limit_dzienny) || v.limit_dzienny < 1 || v.limit_dzienny > 2000) return { ok: false, error: "Limit dzienny: liczba od 1 do 2000." };
  if (!Number.isInteger(v.limit_na_numer_dziennie) || v.limit_na_numer_dziennie < 1 || v.limit_na_numer_dziennie > 20) return { ok: false, error: "Limit na jeden numer: liczba od 1 do 20." };
  if (v.limit_na_numer_dziennie > v.limit_dzienny) return { ok: false, error: "Limit na jeden numer nie może być większy niż limit dzienny." };
  const od = String(v.godziny?.od ?? ""), d = String(v.godziny?.do ?? "");
  if (!GODZ.test(od) || !GODZ.test(d) || od >= d) return { ok: false, error: "Godziny wysyłki: podaj początek i koniec (GG:MM), koniec po początku." };
  if (od < "06:00" || d > "22:00") return { ok: false, error: "Godziny wysyłki muszą mieścić się między 06:00 a 22:00." };
  if (v.wlaczone) {
    if (!o.skonfigurowane) return { ok: false, error: "Najpierw trzeba zapisać token SMSAPI (sekret SMSAPI_TOKEN) — bez niego wysyłki nie da się włączyć." };
    if (!nadawca) return { ok: false, error: "Wybierz nazwę nadawcy, zanim włączysz wysyłkę." };
    if (!o.nadawcy) return { ok: false, error: "Nie udało się sprawdzić nazw nadawcy na koncie SMSAPI — spróbuj ponownie." };
  }
  if (v.automaty.terminy && !v.wlaczone) return { ok: false, error: "Przypomnienia o terminach SMS-em wymagają włączonej wysyłki." };
  return { ok: true, ust: { wlaczone: v.wlaczone, nadawca, limit_dzienny: v.limit_dzienny, limit_na_numer_dziennie: v.limit_na_numer_dziennie, godziny: { od, do: d }, automaty: { terminy: v.automaty.terminy }, normalizuj: v.normalizuj, zagranica: v.zagranica, raporty: v.raporty === true } };
}

// ---------------------------------------------------------------- templates
// Short, signed with the office's name, no link and no more personal data than needed: a worker is named
// by initials, the document by its kind, the deadline by its date — never a full name, PESEL or document
// number (an SMS is shown on a locked screen and travels unencrypted). Details go by e-mail.
export type Szablon = { id: string; nazwa: string; cel: string; tresc: string; pola: { k: string; opis: string; max: number }[] };
export const SZABLONY: Szablon[] = [
  { id: "termin", nazwa: "Termin dokumentu pracownika", cel: "termin",
    tresc: "TD Consulting Group: {dokument} pracownika {inicjaly} — ważność do {data}. Szczegóły wysłaliśmy e-mailem. Prosimy o kontakt z działem kadr.",
    pola: [{ k: "dokument", opis: "Rodzaj dokumentu (np. karta pobytu, umowa)", max: 40 }, { k: "inicjaly", opis: "Inicjały pracownika (np. J.K.)", max: 8 }, { k: "data", opis: "Data (DD.MM.RRRR)", max: 10 }] },
  { id: "termin_zbiorczy", nazwa: "Terminy kilku dokumentów / pracowników", cel: "termin",
    tresc: "TD Consulting Group: zbliżają się terminy dokumentów pracowników Państwa firmy (pozycji: {liczba}), najbliższy {data}. Szczegóły wysłaliśmy e-mailem.",
    pola: [{ k: "liczba", opis: "Liczba pozycji", max: 3 }, { k: "data", opis: "Najbliższa data (DD.MM.RRRR)", max: 10 }] },
  { id: "podpis", nazwa: "Dokumenty gotowe do podpisu", cel: "podpis_link",
    tresc: "TD Consulting Group: dokumenty kadrowe czekają na podpis. Link i instrukcję wysłaliśmy e-mailem. W razie pytań prosimy o kontakt z działem kadr.",
    pola: [] },
  { id: "ogolny", nazwa: "Wiadomość ogólna", cel: "reczny", tresc: "TD Consulting Group: {tresc}", pola: [{ k: "tresc", opis: "Treść", max: 400 }] },
];
export function wypelnij(id: string, dane: Record<string, unknown>): string | null {
  const s = SZABLONY.find((x) => x.id === id);
  if (!s) return null;
  return s.tresc.replace(/\{(\w+)\}/g, (_m, k) => {
    const p = s.pola.find((x) => x.k === k);
    return porzadkuj(dane[k]).replace(/[{}]/g, "").slice(0, p?.max ?? 40);
  });
}
// "Jan Maria Kowalski-Nowak" -> "J.K."  (first name + surname; nothing that identifies on its own)
export function inicjaly(nazwa: unknown): string {
  const w = String(nazwa ?? "").trim().split(/\s+/).filter((x) => /\p{L}/u.test(x));
  if (!w.length) return "";
  const lit = (x: string) => ([...x].find((c) => /\p{L}/u.test(c)) ?? "").toUpperCase() + ".";
  return w.length === 1 ? lit(w[0]) : lit(w[0]) + lit(w[w.length - 1]);
}

// ---------------------------------------------------------------- the provider's answers
// SMSAPI error codes (smsapi.pl/docs, "Kody błędów") worth explaining to a person.
const BLEDY: Record<number, string> = {
  11: "Wiadomość jest pusta albo za długa.", 12: "Wiadomość ma więcej części, niż dopuszcza limit.",
  13: "Operator odrzucił numer (błędny, stacjonarny albo na czarnej liście).", 14: "Nieprawidłowa nazwa nadawcy — wybierz aktywną nazwę w ustawieniach.",
  33: "Brak poprawnych numerów.", 52: "Za dużo prób wysyłki na ten numer w krótkim czasie.", 53: "Ta wiadomość została już przyjęta do wysyłki.",
  57: "Numer jest na czarnej liście konta SMSAPI.", 59: "Numer jest na liście wypisanych.", 70: "Błędny adres raportów doręczeń.",
  74: "Pora wysyłki nie mieści się w ograniczeniach ustawionych na koncie SMSAPI.", 94: "Wysyłka wiadomości z linkiem jest zablokowana na koncie SMSAPI.",
  96: "Limit wysyłek na koncie SMSAPI został osiągnięty.", 98: "Konto SMSAPI jest ograniczone — skontaktuj się z opiekunem konta.",
  101: "Token SMSAPI jest nieprawidłowy albo wygasł.", 102: "Nieprawidłowe dane logowania do SMSAPI.", 103: "Brak punktów na koncie SMSAPI.",
  105: "Adres serwera nie jest dopuszczony przez filtr IP konta SMSAPI.", 110: "Usługa SMS nie jest dostępna na tym koncie.",
  112: "Wysyłka do tego kraju jest zablokowana na koncie.", 200: "Dostawca nie przyjął wiadomości — spróbuj ponownie.", 201: "Błąd po stronie dostawcy.",
  202: "Dostawca jest przeciążony — spróbuj ponownie.", 401: "Token SMSAPI nie ma uprawnień do tej czynności.", 999: "Błąd po stronie dostawcy.",
};
export type Odp = { ok: true; id: string | null; koszt: number | null; czesci: number | null; status: string | null } | { ok: false; kod: number | null; opis: string };
// The JSON answer of sms.do (format=json). Nothing from it is passed on except the fields read here.
export function czytajOdpowiedz(http: number, d: Any): Odp {
  const m = Array.isArray(d?.list) ? d.list[0] : null;
  if (http >= 200 && http < 300 && m && d.error == null) {
    const liczba = (x: Any) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
    return { ok: true, id: m.id ? String(m.id).slice(0, 40) : null, koszt: liczba(m.points), czesci: liczba(m.parts), status: m.status ? String(m.status).slice(0, 20) : null };
  }
  const kod = Number.isInteger(d?.error) ? d.error as number : /^\d+$/.test(String(d?.error ?? "")) ? Number(d.error) : null;
  if (kod != null) return { ok: false, kod, opis: BLEDY[kod] ?? "Dostawca odrzucił wiadomość (kod " + kod + ")." };
  if (http === 401 || d?.error === "authorization_failed") return { ok: false, kod: 101, opis: BLEDY[101] };
  return { ok: false, kod: null, opis: "Dostawca nie odpowiedział poprawnie (HTTP " + http + ")." };
}
// Delivery reports (smsapi.pl/docs, "Lista statusów doręczenia").
export function statusDoreczenia(kod: unknown): { status: "dostarczony" | "blad" | null; nazwa: string } {
  const k = Number(kod);
  const nazwa = ({ 401: "NOT_FOUND", 402: "EXPIRED", 403: "SENT", 404: "DELIVERED", 405: "UNDELIVERED", 406: "FAILED", 407: "REJECTED", 408: "UNKNOWN", 409: "QUEUE", 410: "ACCEPTED", 411: "RENEWAL", 412: "STOP" } as Record<number, string>)[k] ?? "";
  return { status: k === 404 ? "dostarczony" : [402, 405, 406, 407].includes(k) ? "blad" : null, nazwa };
}

export async function sha(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const losowy = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const DUP_MIN = 10; // the same text to the same number is refused for this many minutes
