// Asystenci AI — pure rules (no network, no database): the test-mode gate, settings, masking,
// limits, cost, uploaded files, the shape of an answer and its validation.

import { CENA_NIEZNANA, CENY, DOMYSLNE, GRANICE, MAX_PLIK, MAX_PLIKI_RAZEM, MAX_PLIKOW, MODELE } from "./modele.ts";

// deno-lint-ignore no-explicit-any
export type Any = any;

// ---------------------------------------------------------------- dates (Europe/Warsaw, plain YYYY-MM-DD)
export const dzisWarszawa = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(d);
export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
export const plusDni = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const dniMiedzy = (od: string, doDnia: string) => Math.round((Date.parse(doDnia + "T00:00:00Z") - Date.parse(od + "T00:00:00Z")) / 86400000);
export const okOkres = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const okresPlus = (o: string, n: number) => { const d = new Date(Date.UTC(+o.slice(0, 4), +o.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
export const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
export const okNip = (v: unknown): v is string => typeof v === "string" && /^\d{10}$/.test(v);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const okUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// ---------------------------------------------------------------- settings and the gate
export type Ustawienia = {
  testerzy: string[];            // e-mails of administrators allowed to run assistants
  wylaczone: string[];           // ids of assistants switched off
  limity: { dziennie_osoba: number; dziennie_razem: number; koszt_dzien_usd: number };
  retencja_dni: number;
  ru_auto: boolean;              // render staff answers in Russian right after a run
  modele: Record<string, string>; // per-assistant model override (only ids from MODELE)
};
const mail = (s: unknown) => String(s ?? "").trim().toLowerCase();
const okMail = (s: string) => /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]{2,}$/.test(s) && s.length <= 200;
const wGranicach = (v: unknown, [min, max]: readonly [number, number], dom: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dom;
};

// what is stored -> what the code uses; anything malformed falls back to the safe default
export function normalizujUstawienia(raw: Any): Ustawienia {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const l = r.limity && typeof r.limity === "object" ? r.limity : {};
  const modele: Record<string, string> = {};
  if (r.modele && typeof r.modele === "object") for (const [k, v] of Object.entries(r.modele)) if (/^[a-z_]{2,40}$/.test(k) && (MODELE as readonly string[]).includes(String(v))) modele[k] = String(v);
  return {
    testerzy: [...new Set<string>((Array.isArray(r.testerzy) ? r.testerzy : []).map(mail).filter(okMail))].slice(0, 20),
    wylaczone: [...new Set((Array.isArray(r.wylaczone) ? r.wylaczone : []).map(String).filter((s: string) => /^[a-z_]{2,40}$/.test(s)))].slice(0, 50) as string[],
    limity: {
      dziennie_osoba: Math.round(wGranicach(l.dziennie_osoba, GRANICE.dziennie_osoba, DOMYSLNE.dziennie_osoba)),
      dziennie_razem: Math.round(wGranicach(l.dziennie_razem, GRANICE.dziennie_razem, DOMYSLNE.dziennie_razem)),
      koszt_dzien_usd: wGranicach(l.koszt_dzien_usd, GRANICE.koszt_dzien_usd, DOMYSLNE.koszt_dzien_usd),
    },
    retencja_dni: Math.round(wGranicach(r.retencja_dni, GRANICE.retencja_dni, DOMYSLNE.retencja_dni)),
    ru_auto: r.ru_auto === true,
    modele,
  };
}

export type Ja = { email: string; portal: boolean; admin: boolean };
export type Odmowa = { status: number; error: string; kod: string };

// TEST MODE: a portal administrator who is on the testers list — nobody else, for every action.
// There is no cron path and no client path: a request without a portal user's token is anonymous.
export function bramka(ja: Ja | null, ust: Ustawienia): Odmowa | null {
  if (!ja || !ja.email) return { status: 401, error: "Zaloguj się do portalu.", kod: "anon" };
  if (!ja.portal) return { status: 403, error: "Brak dostępu do portalu.", kod: "nie_portal" };
  if (!ja.admin) return { status: 403, error: "Asystenci AI działają w trybie testowym — tylko dla administratora.", kod: "nie_admin" };
  if (!ust.testerzy.includes(mail(ja.email))) return { status: 403, error: "Tego konta nie ma na liście testerów asystentów AI.", kod: "nie_tester" };
  return null;
}

// What the administrator sent from the settings form -> the settings to store, or what is wrong.
// The person saving must stay on the list: nobody locks the test mode from the inside by accident.
export function walidujUstawienia(wej: Any, ja: Ja, znaneAsystenty: string[]): { ust?: Ustawienia; bledy: string[] } {
  const bledy: string[] = [];
  const w = wej && typeof wej === "object" ? wej : {};
  const surowi = (Array.isArray(w.testerzy) ? w.testerzy : []).map(mail).filter(Boolean);
  for (const t of surowi) if (!okMail(t)) bledy.push(`Niepoprawny adres testera: ${String(t).slice(0, 60)}`);
  if (surowi.length > 20) bledy.push("Najwyżej 20 testerów.");
  if (!surowi.includes(mail(ja.email))) bledy.push("Twoje konto musi pozostać na liście testerów.");
  const l = w.limity && typeof w.limity === "object" ? w.limity : {};
  for (const k of ["dziennie_osoba", "dziennie_razem", "koszt_dzien_usd"] as const) {
    const n = Number(l[k]), [min, max] = GRANICE[k];
    if (!Number.isFinite(n) || n < min || n > max) bledy.push(`Limit „${k}”: liczba od ${min} do ${max}.`);
  }
  const ret = Number(w.retencja_dni), [rmin, rmax] = GRANICE.retencja_dni;
  if (!Number.isInteger(ret) || ret < rmin || ret > rmax) bledy.push(`Retencja: od ${rmin} do ${rmax} dni.`);
  for (const id of Array.isArray(w.wylaczone) ? w.wylaczone : []) if (!znaneAsystenty.includes(String(id))) bledy.push(`Nieznany asystent: ${String(id).slice(0, 40)}`);
  if (w.modele && typeof w.modele === "object") {
    for (const [k, v] of Object.entries(w.modele)) {
      if (!znaneAsystenty.includes(k)) bledy.push(`Nieznany asystent: ${k.slice(0, 40)}`);
      else if (!(MODELE as readonly string[]).includes(String(v))) bledy.push(`Model spoza listy: ${String(v).slice(0, 60)}`);
    }
  }
  if (bledy.length) return { bledy };
  return { ust: normalizujUstawienia(w), bledy };
}

// ---------------------------------------------------------------- limits
export type Dzis = { moje: number; razem: number; koszt_usd: number };
export function sprawdzLimity(ust: Ustawienia, d: Dzis): Odmowa | null {
  if (d.koszt_usd >= ust.limity.koszt_dzien_usd) return { status: 429, error: `Dzienny limit kosztu asystentów został osiągnięty (${ust.limity.koszt_dzien_usd.toFixed(2)} USD). Zmień limit w ustawieniach albo wróć jutro.`, kod: "limit_koszt" };
  if (d.razem >= ust.limity.dziennie_razem) return { status: 429, error: `Dzienny limit uruchomień (wszyscy: ${ust.limity.dziennie_razem}) został osiągnięty.`, kod: "limit_razem" };
  if (d.moje >= ust.limity.dziennie_osoba) return { status: 429, error: `Twój dzienny limit uruchomień (${ust.limity.dziennie_osoba}) został osiągnięty.`, kod: "limit_osoba" };
  return null;
}

// ---------------------------------------------------------------- cost
export type Zuzycie = { we: number; wy: number; cache_r: number; cache_w: number };
export const ZERO: Zuzycie = { we: 0, wy: 0, cache_r: 0, cache_w: 0 };
// usage of one API response (input_tokens excludes cached tokens)
export function zuzycieZ(usage: Any): Zuzycie {
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
  return { we: n(usage?.input_tokens), wy: n(usage?.output_tokens), cache_r: n(usage?.cache_read_input_tokens), cache_w: n(usage?.cache_creation_input_tokens) };
}
export const dodaj = (a: Zuzycie, b: Zuzycie): Zuzycie => ({ we: a.we + b.we, wy: a.wy + b.wy, cache_r: a.cache_r + b.cache_r, cache_w: a.cache_w + b.cache_w });
export const tokenyRazem = (z: Zuzycie) => z.we + z.wy + z.cache_r + z.cache_w;
export function kosztUsd(model: string, z: Zuzycie): number {
  const c = CENY[model] ?? CENA_NIEZNANA;
  return Math.round(((z.we * c.we + z.wy * c.wy + z.cache_r * c.cache_r + z.cache_w * c.cache_w) / 1e6) * 1e6) / 1e6;
}

// ---------------------------------------------------------------- masking
// Identifiers the model does not need never leave the function: bank accounts, card numbers, PESEL-like
// numbers, identity / residence document numbers, phone numbers. (The same approach as in Poczta, plus phones.)
const NIE_DOKUMENT = "FV|FA|FS|FK|FZ|WZ|PZ|KP|KW|NR|PIT|CIT|VAT|ZUS|KRS|NIP|RCA|DRA|ZUA|ZZA|RSA|IWA|PCC|PPK|PFR|JPK|UPO|UE|PL|NO|ID|DU|MP|ART";
export function maskuj(text: unknown): string {
  return String(text ?? "")
    .replace(/\b(?:[A-Z]{2}\s?)?\d{2}(?:[ -]?\d{4}){6}\b/g, "[NR RACHUNKU]")
    .replace(/(?<!\d)(?:\d{4}[ -]){3}\d{4}(?!\d)/g, "[NR KARTY]")
    .replace(/(?<![\d.,])\d{11}(?![\d])/g, "[PESEL]")
    .replace(/(?<![\d\w])\+\d{1,3}[ -]?(?:\(?\d{2,3}\)?[ -]?)?\d{3}[ -]?\d{2,3}[ -]?\d{2,4}(?!\d)/g, "[TELEFON]")
    .replace(/(?<![\d-])\d{3}[ -]\d{3}[ -]\d{3}(?![\d-])/g, "[TELEFON]")
    .replace(/(?<![\d.,-])\d{9}(?![\d-]|[.,]\d)/g, "[TELEFON]")
    .replace(new RegExp(`\\b(?!(?:${NIE_DOKUMENT})\\s?\\d)[A-Z]{2,3}\\s?\\d{6,7}\\b`, "g"), "[NR DOKUMENTU]");
}
// keys whose values are never sent to the model, whatever they hold
// (exact raw column / payload names, with the one-letter prefixes of the employment form: p_pesel, r_pesel …)
const KLUCZ_TAJNY = /^(?:[a-z]_)?(pesel|dowod|nr_?dok\w*|konto|iban|nr_?rachunku|telefon|phone|haslo\w*|password|token\w*|secret\w*|sol|salt|\w*_hash|\w*_?path|chat_id|chat|telegram_chat|tg_user_id|username|ip|ua|odbior_ip|link_hash|adres_zamieszkania)$/i;
export function maskujGleboko<T>(v: T, glebia = 0): T {
  if (glebia > 8) return "[…]" as unknown as T;
  if (typeof v === "string") return maskuj(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => maskujGleboko(x, glebia + 1)) as unknown as T;
  if (v && typeof v === "object") {
    const o: Any = {};
    for (const [k, x] of Object.entries(v as Any)) if (!KLUCZ_TAJNY.test(k)) o[k] = maskujGleboko(x, glebia + 1);
    return o;
  }
  return v;
}
// an e-mail address as the model sees it: enough to tell "whose", not enough to write to
export function maskujMail(s: unknown): string {
  const m = String(s ?? "").trim();
  const at = m.indexOf("@");
  return at < 1 ? "" : m[0] + "***" + m.slice(at);
}

// Text that came from outside (an e-mail, a scan, what a client typed, a register) is DATA. It is wrapped
// so the model can tell where it begins and ends; the wrapper's own closing tag cannot be forged from inside.
export function niezaufane(zrodlo: string, tekst: unknown, max = 20000): string {
  const t = maskuj(String(tekst ?? "")).replace(/<\/?\s*dane_niezaufane[^>]*>/gi, "[znacznik usunięty]").slice(0, max);
  return `<dane_niezaufane zrodlo="${zrodlo.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 60)}">\n${t}\n</dane_niezaufane>`;
}

// ---------------------------------------------------------------- tax micro-account (computed, never sent to the model)
// LK + 10100071 + 222 + 2 + NIP + 00 — the structure published by the Ministry of Finance; the same
// arithmetic as mikrorachunek() in ksiegowosc.js and in the `klient` function.
export function mikrorachunek(nip: string): string {
  if (!/^\d{10}$/.test(nip ?? "")) return "";
  const body = "101000712222" + nip + "00";
  let r = 0;
  for (const c of body + "252100") r = (r * 10 + Number(c)) % 97;
  const nr = String(98 - r).padStart(2, "0") + body;
  return "PL" + nr.slice(0, 2) + " " + nr.slice(2).replace(/(.{4})(?=.)/g, "$1 ");
}
// The model writes the placeholder; the server puts the number in afterwards — and only for the NIP the
// run is allowed to see (`dozwolone`): any other NIP inside a placeholder stays unresolved.
export const ZNACZNIK_MIKRO = (nip: string) => `{{MIKRORACHUNEK:${nip}}}`;
export function wstawMikrorachunki<T>(v: T, dozwolone: (nip: string) => boolean): T {
  if (typeof v === "string") return v.replace(/\{\{MIKRORACHUNEK:(\d{10})\}\}/g, (_m, nip) => (dozwolone(nip) ? mikrorachunek(nip) || "[brak numeru]" : "[brak numeru]")) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => wstawMikrorachunki(x, dozwolone)) as unknown as T;
  if (v && typeof v === "object") { const o: Any = {}; for (const [k, x] of Object.entries(v as Any)) o[k] = wstawMikrorachunki(x, dozwolone); return o; }
  return v;
}

// ---------------------------------------------------------------- uploaded files
export type Plik = { nazwa: string; mime: "application/pdf" | "image/jpeg" | "image/png"; data: string; rozmiar: number };
const b64len = (s: string) => Math.floor((s.length * 3) / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
function poczatek(b64: string): Uint8Array {
  try { return Uint8Array.from(atob(b64.slice(0, 24)), (c) => c.charCodeAt(0)); } catch { return new Uint8Array(); }
}
// the real type by the first bytes — the declared type and the extension are not trusted
export function typPliku(b64: string): Plik["mime"] | null {
  const b = poczatek(b64);
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  return null;
}
export function sprawdzPliki(wej: unknown, max = MAX_PLIKOW): { pliki: Plik[]; blad?: string } {
  if (wej == null) return { pliki: [] };
  if (!Array.isArray(wej)) return { pliki: [], blad: "Nieprawidłowa lista plików." };
  if (wej.length > max) return { pliki: [], blad: `Za dużo plików (najwyżej ${max}).` };
  const pliki: Plik[] = [];
  let razem = 0;
  for (const f of wej) {
    const data = typeof f?.data === "string" ? f.data.replace(/^data:[^,]*,/, "") : "";
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.slice(0, 4096)) || data.length % 4 !== 0) return { pliki: [], blad: "Plik nie jest poprawnie zakodowany." };
    const rozmiar = b64len(data);
    if (rozmiar > MAX_PLIK) return { pliki: [], blad: "Plik jest większy niż 10 MB." };
    razem += rozmiar;
    if (razem > MAX_PLIKI_RAZEM) return { pliki: [], blad: "Pliki razem są za duże (najwyżej 14 MB na jedno uruchomienie)." };
    const mime = typPliku(data);
    if (!mime) return { pliki: [], blad: "Dozwolone są tylko pliki PDF, JPG i PNG (sprawdzane po zawartości pliku)." };
    const nazwa = String(f?.nazwa ?? "plik").replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 120) || "plik";
    pliki.push({ nazwa, mime, data, rozmiar });
  }
  return { pliki };
}

// ---------------------------------------------------------------- languages
export type Jezyk = "pl" | "ru" | "uk" | "en";
export const JEZYK_NAZWA: Record<Jezyk, string> = { pl: "polski", ru: "rosyjski", uk: "ukraiński", en: "angielski" };
// the clients base keeps the language as an English word; nothing set = Polish
export function jezykKlienta(v: unknown): Jezyk {
  const s = String(v ?? "").trim().toLowerCase();
  if (/^(ru|rus|росс|рус)/.test(s)) return "ru";
  if (/^(uk|ua|укр)/.test(s)) return "uk";
  if (/^(en|ang)/.test(s)) return "en";
  return "pl";
}

// ---------------------------------------------------------------- the answer: schema and validation
export type Sekcja = { klucz: string; tytul: string };
export type Ksztalt = {
  sekcje: Sekcja[];                 // named parts of the answer the page shows in order
  lista: boolean;                   // a checklist with pass / fail / unknown
  szkice: string[];                 // channels of ready-to-copy drafts ([] = none)
  zadanie: boolean;                 // may PROPOSE a task (the owner creates it with one click)
};
export const KANALY = ["email", "sms", "telegram", "zgloszenie", "notatka"] as const;
export const WYNIKI_LISTY = ["ok", "brak", "nieznane"] as const;
export const RODZAJE_ZRODEL = ["dane_portalu", "baza_wiedzy", "terminy", "plik", "wiadomosc", "wejscie"] as const;

const S = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
// JSON Schema for output_config.format (structured outputs: every object closed, every key required)
export function schematWyniku(k: Ksztalt): Record<string, unknown> {
  const p: Record<string, unknown> = { odpowiedz: S };
  if (k.sekcje.length) p.sekcje = { type: "array", items: obj({ klucz: { type: "string", enum: k.sekcje.map((s) => s.klucz) }, tresc: S }) };
  if (k.lista) p.lista_kontrolna = { type: "array", items: obj({ punkt: S, wynik: { type: "string", enum: [...WYNIKI_LISTY] }, uzasadnienie: S, zrodlo: S }) };
  if (k.szkice.length) p.szkice = { type: "array", items: obj({ kanal: { type: "string", enum: k.szkice }, jezyk: { type: "string", enum: ["pl", "ru", "uk", "en"] }, adresat: S, temat: S, tresc: S }) };
  if (k.zadanie) p.proponowane_zadanie = obj({ jest: { type: "boolean" }, tytul: S, opis: S, termin: S, pilne: { type: "boolean" } });
  p.zrodla = { type: "array", items: obj({ rodzaj: { type: "string", enum: [...RODZAJE_ZRODEL] }, id: S, opis: S }) };
  p.nie_znaleziono = { type: "array", items: S };
  p.wymaga_czlowieka = { type: "boolean" };
  return obj(p);
}

export type Wynik = {
  odpowiedz: string;
  sekcje?: { klucz: string; tresc: string }[];
  lista_kontrolna?: { punkt: string; wynik: typeof WYNIKI_LISTY[number]; uzasadnienie: string; zrodlo: string }[];
  szkice?: { kanal: string; jezyk: string; adresat: string; temat: string; tresc: string }[];
  proponowane_zadanie?: { tytul: string; opis: string; termin: string; pilne: boolean } | null;
  zrodla: { rodzaj: string; id: string; opis: string }[];
  nie_znaleziono: string[];
  wymaga_czlowieka: boolean;
};
// what the run really read — sources the answer names must be among these
export type Slad = { narzedzia: Set<string>; wiedza: Set<string>; terminy: boolean; pliki: number; wiadomosc: boolean };
export const nowySlad = (): Slad => ({ narzedzia: new Set(), wiedza: new Set(), terminy: false, pliki: 0, wiadomosc: false });

const txt = (v: unknown, n: number) => (typeof v === "string" ? v : "").replace(/\u0000/g, "").trim().slice(0, n);
const PRZEPIS = /\b(art\.|§|ust\.\s*\d|Dz\.\s?U\.|ustaw[ayę]\b|rozporządzeni|kodeks)/i;

// The model's JSON -> the answer the page shows. Never throws on a wrong shape: what cannot be trusted is
// dropped and named in `uwagi`. Identifiers are masked here as well — an answer never carries them out.
export function walidujWynik(k: Ksztalt, raw: unknown, slad: Slad): { wynik: Wynik | null; uwagi: string[] } {
  const uwagi: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { wynik: null, uwagi: ["Odpowiedź modelu nie ma wymaganego formatu."] };
  const r = raw as Any;
  const odpowiedz = maskuj(txt(r.odpowiedz, 20000));
  if (!odpowiedz) return { wynik: null, uwagi: ["Odpowiedź modelu jest pusta."] };
  const w: Wynik = { odpowiedz, zrodla: [], nie_znaleziono: [], wymaga_czlowieka: r.wymaga_czlowieka === true };

  if (k.sekcje.length) {
    const znane = new Set(k.sekcje.map((s) => s.klucz)), bylo = new Set<string>();
    w.sekcje = [];
    for (const s of Array.isArray(r.sekcje) ? r.sekcje.slice(0, 20) : []) {
      const klucz = txt(s?.klucz, 40), tresc = maskuj(txt(s?.tresc, 12000));
      if (!znane.has(klucz) || bylo.has(klucz) || !tresc) continue;
      bylo.add(klucz);
      w.sekcje.push({ klucz, tresc });
    }
  }
  if (k.lista) {
    w.lista_kontrolna = [];
    for (const p of Array.isArray(r.lista_kontrolna) ? r.lista_kontrolna.slice(0, 40) : []) {
      const punkt = maskuj(txt(p?.punkt, 400));
      if (!punkt) continue;
      const wynik = (WYNIKI_LISTY as readonly string[]).includes(p?.wynik) ? p.wynik : "nieznane";
      w.lista_kontrolna.push({ punkt, wynik, uzasadnienie: maskuj(txt(p?.uzasadnienie, 1200)), zrodlo: maskuj(txt(p?.zrodlo, 300)) });
    }
  }
  if (k.szkice.length) {
    w.szkice = [];
    for (const s of Array.isArray(r.szkice) ? r.szkice.slice(0, 12) : []) {
      const kanal = txt(s?.kanal, 20), tresc = maskuj(txt(s?.tresc, 8000));
      if (!k.szkice.includes(kanal) || !tresc) continue;
      w.szkice.push({ kanal, jezyk: ["pl", "ru", "uk", "en"].includes(s?.jezyk) ? s.jezyk : "pl", adresat: maskuj(txt(s?.adresat, 200)), temat: maskuj(txt(s?.temat, 300)), tresc });
    }
  } else if (Array.isArray(r.szkice) && r.szkice.length) uwagi.push("Pominięto szkice wiadomości — ten asystent ich nie przygotowuje.");
  if (k.zadanie) {
    const z = r.proponowane_zadanie;
    const tytul = maskuj(txt(z?.tytul, 200));
    w.proponowane_zadanie = z && z.jest === true && tytul ? { tytul, opis: maskuj(txt(z?.opis, 2000)), termin: isDate(z?.termin) ? z.termin : "", pilne: z?.pilne === true } : null;
  } else if (r.proponowane_zadanie) uwagi.push("Pominięto propozycję zadania — ten asystent ich nie proponuje.");

  // sources: only what this run really read may be named
  let odrzucone = 0;
  for (const z of Array.isArray(r.zrodla) ? r.zrodla.slice(0, 40) : []) {
    const rodzaj = txt(z?.rodzaj, 20), id = txt(z?.id, 120), opis = maskuj(txt(z?.opis, 400));
    if (!(RODZAJE_ZRODEL as readonly string[]).includes(rodzaj)) { odrzucone++; continue; }
    const ok = rodzaj === "baza_wiedzy" ? slad.wiedza.has(id)
      : rodzaj === "dane_portalu" ? slad.narzedzia.has(id)
      : rodzaj === "terminy" ? slad.terminy
      : rodzaj === "plik" ? slad.pliki > 0
      : rodzaj === "wiadomosc" ? slad.wiadomosc
      : true;
    if (!ok) { odrzucone++; continue; }
    w.zrodla.push({ rodzaj, id: maskuj(id), opis });
  }
  if (odrzucone) uwagi.push(`Usunięto ${odrzucone} źródeł, których ten przebieg nie odczytał (model podał źródło, którego nie widział).`);
  for (const n of Array.isArray(r.nie_znaleziono) ? r.nie_znaleziono.slice(0, 30) : []) { const t = maskuj(txt(n, 600)); if (t) w.nie_znaleziono.push(t); }

  // a legal statement without a knowledge-base rule or the deadline engine behind it gets a visible warning
  const calosc = [w.odpowiedz, ...(w.sekcje ?? []).map((s) => s.tresc), ...(w.szkice ?? []).map((s) => s.tresc), ...(w.lista_kontrolna ?? []).map((p) => p.uzasadnienie)].join("\n");
  if (PRZEPIS.test(calosc) && !w.zrodla.some((z) => z.rodzaj === "baza_wiedzy" || z.rodzaj === "terminy" || z.rodzaj === "plik" || z.rodzaj === "wiadomosc")) {
    uwagi.push("W odpowiedzi są odwołania do przepisów, a wśród źródeł nie ma reguły z bazy wiedzy ani silnika terminów — sprawdź je przed użyciem.");
  }
  if (!w.zrodla.length) uwagi.push("Odpowiedź nie wskazuje żadnego potwierdzonego źródła.");
  return { wynik: w, uwagi };
}
