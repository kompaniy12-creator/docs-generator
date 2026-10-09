// telegram-grupa — the template of a client's group and the plan made from it for one client.
// Pure: no I/O, no Telegram. The plan is what core.ts executes and what the page shows as the preview.
//
// Template (portal_ustawienia, key 'telegram_grupa'):
//   { tytul, opis, limit_dzienny, stawka_godzinowa, boty: [{ username, admin }],
//     tematy: [{ klucz, nazwa, ogolny?, wiadomosci: [{ klucz, nazwa, html, przypnij, grupa, warunek }] }] }
// The first topic is always Telegram's built-in "General". Messages of one topic that share `grupa`
// are variants of the same message: one of them is sent — the first whose `warunek` fits the client,
// otherwise the first without a condition. A message outside a group is sent when its condition fits.
//
// Placeholders: {{name}} is replaced by the client's value (HTML-escaped); one that has no value stays
// in the text and blocks the creation until the text is corrected. {{#flag}}…{{/flag}} keeps the
// fragment only when the flag holds (ma_ksiegowa, ma_kadrowa, ma_zus).

import { KADRY_3J, KADRY_RU, PLATNOSCI_CIT, PLATNOSCI_OGOLNE, PLATNOSCI_RYCZALT, PLATNOSCI_SKALA, POWITANIE, WAZNE } from "./teksty.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type Wiadomosc = { klucz: string; nazwa: string; html: string; przypnij: boolean; grupa: string; warunek: string };
export type Temat = { klucz: string; nazwa: string; ogolny: boolean; wiadomosci: Wiadomosc[] };
export type BotSz = { username: string; admin: boolean };
export type Szablon = { tytul: string; opis: string; limit_dzienny: number; stawka_godzinowa: string; boty: BotSz[]; tematy: Temat[] };

// what core.ts executes
export type Plan = {
  tytul: string; opis: string;
  tematy: Array<{ klucz: string; nazwa: string; ogolny: boolean; wiadomosci: Array<{ klucz: string; nazwa: string; html: string; przypnij: boolean }> }>;
  boty: BotSz[];
  osoby: Array<{ username: string; imie: string; rola: string }>;
};

export const MAX_TYTUL = 128, MAX_TEMAT = 128, MAX_TEKST = 4096, MAX_HTML = 8000;
export const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export const DOMYSLNY: Szablon = {
  tytul: "{{FIRMA}} - Księgowość",
  opis: "",
  limit_dzienny: 10,
  stawka_godzinowa: "",
  boty: [{ username: "twojksiegowy_bot", admin: true }],
  tematy: [
    { klucz: "general", nazwa: "General", ogolny: true, wiadomosci: [
      { klucz: "wazne", nazwa: "Ważne informacje (PL / RU / UA)", html: WAZNE, przypnij: true, grupa: "", warunek: "" },
      { klucz: "powitanie", nazwa: "Powitanie i zespół", html: POWITANIE, przypnij: false, grupa: "", warunek: "" },
    ] },
    { klucz: "ksiegowosc", nazwa: "Księgowość", ogolny: false, wiadomosci: [
      { klucz: "platnosci_ryczalt", nazwa: "Instrukcja płatności — ryczałt (PIT-28)", html: PLATNOSCI_RYCZALT, przypnij: true, grupa: "Instrukcja płatności", warunek: "podatek=ryczalt" },
      { klucz: "platnosci_skala", nazwa: "Instrukcja płatności — skala (PIT-36)", html: PLATNOSCI_SKALA, przypnij: true, grupa: "Instrukcja płatności", warunek: "podatek=skala" },
      { klucz: "platnosci_cit", nazwa: "Instrukcja płatności — spółka (CIT)", html: PLATNOSCI_CIT, przypnij: true, grupa: "Instrukcja płatności", warunek: "podatek=cit" },
      { klucz: "platnosci_ogolne", nazwa: "Instrukcja płatności — ogólna (PIT, VAT)", html: PLATNOSCI_OGOLNE, przypnij: true, grupa: "Instrukcja płatności", warunek: "" },
    ] },
    { klucz: "kadry", nazwa: "Kadry", ogolny: false, wiadomosci: [
      { klucz: "zatrudnienie_3j", nazwa: "Instrukcja zatrudnienia — PL / UA / RU", html: KADRY_3J, przypnij: true, grupa: "Instrukcja zatrudnienia", warunek: "jezyk=pl|uk|en" },
      { klucz: "zatrudnienie_ru", nazwa: "Instrukcja zatrudnienia — RU", html: KADRY_RU, przypnij: true, grupa: "Instrukcja zatrudnienia", warunek: "" },
    ] },
  ],
};

// shown in the template editor
export const ZMIENNE: Array<[string, string]> = [
  ["firma", "nazwa klienta"], ["FIRMA", "nazwa klienta wielkimi literami"], ["nip", "NIP"],
  ["mikrorachunek", "mikrorachunek podatkowy (wyliczany z NIP)"], ["rachunek_zus", "indywidualny rachunek ZUS (NRS) klienta"],
  ["ksiegowa_imie", "imię księgowej / księgowego klienta"], ["ksiegowa_tg", "jej / jego nazwa w Telegramie (bez @)"],
  ["kadrowa_imie", "imię kadrowej / kadrowego klienta"], ["kadrowa_tg", "jej / jego nazwa w Telegramie (bez @)"],
  ["stawka_godzinowa", "aktualna minimalna stawka godzinowa (z tabeli stawek portalu)"],
  ["opodatkowanie", "forma opodatkowania z danych klienta"], ["forma", "forma prawna"], ["miasto", "miasto"],
  ["#ma_ksiegowa", "fragment {{#ma_ksiegowa}}…{{/ma_ksiegowa}} zostaje tylko, gdy klient ma opiekuna księgowego"],
  ["#ma_kadrowa", "fragment zostaje tylko, gdy klient ma kadrową / kadrowego"],
  ["#ma_zus", "fragment zostaje tylko, gdy wpisano rachunek ZUS klienta"],
];
export const WARUNKI: Array<[string, string]> = [
  ["", "zawsze (wariant domyślny)"], ["podatek=ryczalt", "opodatkowanie: ryczałt"], ["podatek=skala", "opodatkowanie: skala podatkowa"], ["podatek=liniowy", "opodatkowanie: podatek liniowy"],
  ["podatek=cit", "spółka kapitałowa (CIT)"], ["jezyk=pl|uk|en", "język klienta: polski, ukraiński albo angielski"], ["jezyk=ru", "język klienta: rosyjski"], ["jezyk=pl", "język klienta: polski"], ["jezyk=uk", "język klienta: ukraiński"],
  ["zakres=ksiegowosc", "biuro prowadzi księgowość klienta"], ["zakres=kadry", "biuro prowadzi kadry klienta"],
];

// ---------------------------------------------------------------- accounts
const cyfry = (v: unknown) => String(v ?? "").replace(/\D/g, "");
function mod97(num: string) { let r = 0; for (let i = 0; i < num.length; i++) r = (r * 10 + Number(num[i])) % 97; return r; }
export function nipOk(v: unknown): boolean {
  const n = cyfry(v);
  if (n.length !== 10) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(n[i]) * w[i];
  return s % 11 === Number(n[9]);
}
// PL account number (NRB): 26 digits, check digits by ISO 13616 (mod 97-10, "PL" = 2521)
export const nrbOk = (nrb: string) => /^\d{26}$/.test(nrb) && mod97(nrb.slice(2) + "2521" + nrb.slice(0, 2)) === 1;
export const grupuj = (nrb: string) => nrb.slice(0, 2) + " " + nrb.slice(2).replace(/(\d{4})(?=\d)/g, "$1 ");
// Tax micro-account from the NIP: LK + 10100071 + 222 + 2 + NIP + 00 (structure published by the Ministry of
// Finance) — the same algorithm as ksiegowosc.js, narzedzia-ksiegowe.js and the `klient` function.
export function mikrorachunek(nip: unknown): string {
  const n = cyfry(nip);
  if (!nipOk(n)) return "";
  const bban = "101000712222" + n + "00";
  return String(98 - mod97(bban + "252100")).padStart(2, "0") + bban;
}
const ZUS_STALA = "60000002026"; // the constant part of every NRS (zus.pl)
// The client's individual ZUS account as typed -> 26 digits, or what is wrong with it.
export function rachunekZus(wej: unknown, nip: unknown): { nrb: string; blad?: string; uwaga?: string } {
  const t = String(wej ?? "").replace(/[\s\u00a0-]/g, "").replace(/^PL/i, "");
  if (!t) return { nrb: "" };
  if (!/^\d+$/.test(t)) return { nrb: "", blad: "Rachunek ZUS może zawierać tylko cyfry (ewentualnie „PL” na początku)." };
  if (t.length !== 26) return { nrb: "", blad: "Rachunek ZUS ma 26 cyfr — wpisano " + t.length + "." };
  if (!nrbOk(t)) return { nrb: "", blad: "Rachunek ZUS ma błędną liczbę kontrolną — sprawdź numer." };
  if (t.slice(2, 13) !== ZUS_STALA) return { nrb: t, uwaga: "Ten numer nie wygląda na indywidualny rachunek składkowy ZUS (brak stałej części 6000 0002 026) — sprawdź, czy to nie zwykły rachunek." };
  const n = cyfry(nip);
  if (n.length === 10 && t.slice(16) !== n) return { nrb: t, uwaga: "Ostatnie 10 cyfr rachunku ZUS to nie NIP tego klienta — sprawdź, czy to rachunek właściwego płatnika." };
  return { nrb: t };
}

// ---------------------------------------------------------------- the client's features (for conditions)
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/gi, "l").toLowerCase().trim();
export type Cechy = { podatek: string; jezyk: string; ksiegowosc: boolean; kadry: boolean };
export function cechyKlienta(k: { forma?: unknown; opodatkowanie?: unknown; jezyk?: unknown; opiekun?: unknown; kadrowy?: unknown }): Cechy {
  const f = norm(k.forma), o = norm(k.opodatkowanie);
  // capital companies only; every other form gets the general text unless its taxation says more
  const kapitalowa = /z o ?\.? ?o|akcyjna/.test(f) && !/komandytowo/.test(f);
  const podatek = kapitalowa ? "cit" : /ryczalt/.test(o) ? "ryczalt" : /skala/.test(o) ? "skala" : /liniow/.test(o) ? "liniowy" : "inne";
  const jezyk = ({ polish: "pl", ukrainian: "uk", russian: "ru", english: "en" } as Record<string, string>)[norm(k.jezyk)] ?? "brak";
  return { podatek, jezyk, ksiegowosc: !!String(k.opiekun ?? "").trim(), kadry: !!String(k.kadrowy ?? "").trim() };
}
// "podatek=ryczalt", "jezyk=pl|uk"; several conditions joined with ";" must all hold; empty = always
export function warunekPasuje(warunek: string, c: Cechy): boolean {
  for (const cz of String(warunek ?? "").split(";").map((x) => x.trim()).filter(Boolean)) {
    const [pole, wart] = cz.split("=").map((x) => x.trim());
    const lista = (wart ?? "").split("|").map((x) => x.trim());
    if (pole === "podatek") { if (!lista.includes(c.podatek)) return false; }
    else if (pole === "jezyk") { if (!lista.includes(c.jezyk)) return false; }
    else if (pole === "zakres") { if (!lista.some((x) => (x === "ksiegowosc" && c.ksiegowosc) || (x === "kadry" && c.kadry))) return false; }
    else return false; // an unknown condition never fits
  }
  return true;
}

// ---------------------------------------------------------------- placeholders
const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
export function podstaw(tekst: string, wartosci: Record<string, string>, flagi: Record<string, boolean>, html = true): { tekst: string; braki: string[] } {
  const braki = new Set<string>();
  let s = String(tekst ?? "").replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, n, srodek) => (flagi[n] ? srodek : ""));
  s = s.replace(/\{\{[#/]?(\w+)\}\}/g, (m, n) => {
    const v = m[2] === "#" || m[2] === "/" ? "" : wartosci[n];
    if (v) return html ? escHtml(v) : v;
    braki.add(n);
    return m;
  });
  return { tekst: s, braki: [...braki] };
}
// the text Telegram will show: tags out, entities decoded (for the length limit)
export const bezTagow = (html: string) => String(html ?? "").replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// ---------------------------------------------------------------- the template as stored
const linia = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const wiele = (v: unknown, n: number) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "").replace(/[ \t]+$/gm, "").trim().slice(0, n);
const slug = (v: unknown) => norm(v).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
export const login = (v: unknown) => String(v ?? "").trim().replace(/^(https?:\/\/)?t\.me\//i, "").replace(/^@/, "");

// What an administrator saved (or nothing) -> a well-formed template, and what had to be refused.
export function normalizujSzablon(wej: Any): { szablon: Szablon; bledy: string[] } {
  const bledy: string[] = [];
  if (!wej || typeof wej !== "object" || !Array.isArray(wej.tematy)) return { szablon: structuredClone(DOMYSLNY), bledy: wej == null ? [] : ["Szablon ma nieprawidłową budowę."] };
  const tytul = linia(wej.tytul, 200) || DOMYSLNY.tytul;
  const limit = Math.round(Number(wej.limit_dzienny));
  const stawka = linia(wej.stawka_godzinowa, 10).replace(".", ",");
  if (stawka && !/^\d{1,3}(,\d{1,2})?$/.test(stawka)) bledy.push("Stawka godzinowa: wpisz kwotę, np. 31,40 — albo zostaw puste, aby brać ją z tabeli stawek.");
  const boty: BotSz[] = [];
  for (const b of (Array.isArray(wej.boty) ? wej.boty : []).slice(0, 5)) {
    const u = login(b?.username);
    if (!u) continue;
    if (!USERNAME.test(u)) { bledy.push("Nieprawidłowa nazwa bota: " + u.slice(0, 40)); continue; }
    if (!boty.some((x) => x.username.toLowerCase() === u.toLowerCase())) boty.push({ username: u, admin: b?.admin !== false });
  }
  const tematy: Temat[] = [], kluczeT = new Set<string>();
  let razem = 0;
  for (const [i, t] of (wej.tematy as Any[]).slice(0, 10).entries()) {
    const ogolny = i === 0;
    const nazwa = ogolny ? "General" : linia(t?.nazwa, MAX_TEMAT);
    if (!nazwa) { bledy.push("Temat nr " + (i + 1) + " nie ma nazwy."); continue; }
    let klucz = ogolny ? "general" : slug(t?.klucz) || slug(nazwa) || "temat";
    while (kluczeT.has(klucz) || (!ogolny && klucz === "general")) klucz += "_" + (i + 1);
    kluczeT.add(klucz);
    const wiadomosci: Wiadomosc[] = [], kluczeW = new Set<string>();
    for (const [j, w] of (Array.isArray(t?.wiadomosci) ? t.wiadomosci : []).slice(0, 12).entries()) {
      const html = wiele(w?.html, MAX_HTML);
      const nazwaW = linia(w?.nazwa, 80) || "Wiadomość " + (j + 1);
      if (!html) { bledy.push("„" + nazwaW + "” w temacie „" + nazwa + "” nie ma treści."); continue; }
      if (bezTagow(html).length > MAX_TEKST) bledy.push("„" + nazwaW + "” jest za długa — Telegram przyjmuje do " + MAX_TEKST + " znaków.");
      let kw = slug(w?.klucz) || slug(nazwaW) || "w";
      while (kluczeW.has(kw)) kw += "_" + (j + 1);
      kluczeW.add(kw);
      const warunek = linia(w?.warunek, 80);
      if (warunek && !/^(podatek|jezyk|zakres)=[a-z|]+(;(podatek|jezyk|zakres)=[a-z|]+)*$/.test(warunek)) bledy.push("Nieprawidłowy warunek wariantu: " + warunek);
      wiadomosci.push({ klucz: kw, nazwa: nazwaW, html, przypnij: w?.przypnij === true, grupa: linia(w?.grupa, 60), warunek });
      razem++;
    }
    tematy.push({ klucz, nazwa, ogolny, wiadomosci });
  }
  if (!tematy.length || !tematy[0].ogolny) return { szablon: structuredClone(DOMYSLNY), bledy: [...bledy, "Szablon musi zaczynać się od tematu General."] };
  if (razem > 40) bledy.push("Za dużo wiadomości w szablonie (najwyżej 40).");
  return { szablon: { tytul, opis: linia(wej.opis, 255), limit_dzienny: limit >= 1 && limit <= 50 ? limit : DOMYSLNY.limit_dzienny, stawka_godzinowa: /^\d{1,3}(,\d{1,2})?$/.test(stawka) ? stawka : "", boty, tematy }, bledy };
}

// ---------------------------------------------------------------- the plan for one client
export type Osoba = { imie_nazwisko: string; telegram_username: string | null; email: string } | null;
export type Dane = {
  klient: { id: string; nip: string | null; nazwa: string; forma: string | null; opodatkowanie: string | null; miasto: string | null; opiekun: string | null; kadrowy: string | null; jezyk: string; rachunek_zus: string | null };
  ksiegowa: Osoba; kadrowa: Osoba;
  stawka: string;   // "31,40" or "" when the rates table has nothing for today
};
export type Zmiany = {
  tytul?: string; rachunek_zus?: string;
  warianty?: Record<string, string>;                                          // "<topic>/<group>" -> message key, "" = none
  wiadomosci?: Record<string, { wlacz?: boolean; html?: string; przypnij?: boolean }>;   // "<topic>/<message>"
  osoby?: { ksiegowa?: boolean; kadrowa?: boolean };
};
export type PodgladW = { id: string; klucz: string; nazwa: string; grupa: string; wybrana: boolean; auto: boolean; html: string; przypnij: boolean; edytowana: boolean; braki: string[] };
export type Podglad = {
  tytul: string; opis: string;
  tematy: Array<{ klucz: string; nazwa: string; ogolny: boolean; wiadomosci: PodgladW[] }>;
  boty: BotSz[];
  osoby: Array<{ rola: "ksiegowa" | "kadrowa"; skrot: string; imie_nazwisko: string; username: string; dodaj: boolean; mozna: boolean }>;
  wartosci: Record<string, string>;
  ostrzezenia: string[]; blokady: string[];
};

const imie = (o: Osoba) => String(o?.imie_nazwisko ?? "").trim().split(/\s+/)[0] ?? "";
const NAZWY_ZMIENNYCH: Record<string, string> = Object.fromEntries(ZMIENNE);

export function zbudujPlan(sz: Szablon, d: Dane, zm: Zmiany = {}): { plan: Plan; podglad: Podglad } {
  const k = d.klient, ostrzezenia: string[] = [], blokady: string[] = [];
  const zus = rachunekZus(zm.rachunek_zus !== undefined ? zm.rachunek_zus : k.rachunek_zus, k.nip);
  if (zus.blad) blokady.push(zus.blad);
  if (zus.uwaga) ostrzezenia.push(zus.uwaga);
  const mikro = mikrorachunek(k.nip);
  const stawka = sz.stawka_godzinowa || d.stawka;
  const tgK = d.ksiegowa?.telegram_username ?? "", tgD = d.kadrowa?.telegram_username ?? "";
  const wartosci: Record<string, string> = {
    firma: k.nazwa, FIRMA: k.nazwa.toLocaleUpperCase("pl"), nip: k.nip ?? "", mikrorachunek: mikro ? grupuj(mikro) : "", rachunek_zus: zus.nrb ? grupuj(zus.nrb) : "",
    ksiegowa_imie: imie(d.ksiegowa), ksiegowa_tg: tgK, kadrowa_imie: imie(d.kadrowa), kadrowa_tg: tgD, stawka_godzinowa: stawka,
    opodatkowanie: k.opodatkowanie ?? "", forma: k.forma ?? "", miasto: k.miasto ?? "",
  };
  const c = cechyKlienta({ ...k });
  const flagi = { ma_ksiegowa: c.ksiegowosc, ma_kadrowa: c.kadry, ma_zus: !!zus.nrb };

  if (!mikro) ostrzezenia.push("Klient nie ma poprawnego NIP — mikrorachunku podatkowego nie da się wyliczyć.");
  if (!zus.nrb && !zus.blad) ostrzezenia.push("Brak indywidualnego rachunku ZUS klienta — wpisz go powyżej albo usuń ten punkt z instrukcji płatności.");
  if (!stawka) ostrzezenia.push("W tabeli stawek portalu nie ma aktualnej minimalnej stawki godzinowej.");
  for (const [rola, skrot, o, etyk] of [["ksiegowa", k.opiekun, d.ksiegowa, "opiekuna księgowego"], ["kadrowa", k.kadrowy, d.kadrowa, "kadrowej / kadrowego"]] as Array<[string, string | null, Osoba, string]>) {
    if (!String(skrot ?? "").trim()) ostrzezenia.push("Klient nie ma " + etyk + " — ten fragment powitania zostanie pominięty.");
    else if (!o) ostrzezenia.push("Skrót „" + skrot + "” (" + (rola === "ksiegowa" ? "opiekun" : "kadrowy") + ") nie jest przypisany do nikogo w module Zespół.");
    else if (!o.telegram_username) ostrzezenia.push(o.imie_nazwisko + " nie ma wpisanej nazwy w Telegramie (moduł Zespół → Telegram (@nazwa)).");
  }

  const t = podstaw(zm.tytul !== undefined ? linia(zm.tytul, 300) : sz.tytul, wartosci, flagi, false);
  const tytul = t.tekst.replace(/\s+/g, " ").trim();
  if (!tytul) blokady.push("Podaj nazwę grupy.");
  if (t.braki.length) blokady.push("Nazwa grupy zawiera nieuzupełnione pola: " + t.braki.map((b) => "{{" + b + "}}").join(", ") + ".");
  if (tytul.length > MAX_TYTUL) blokady.push("Nazwa grupy jest za długa (" + tytul.length + " znaków, najwyżej " + MAX_TYTUL + ").");

  const plan: Plan = { tytul, opis: podstaw(sz.opis, wartosci, flagi, false).tekst.slice(0, 255), tematy: [], boty: sz.boty, osoby: [] };
  const podglad: Podglad = { tytul, opis: plan.opis, tematy: [], boty: sz.boty, osoby: [], wartosci, ostrzezenia, blokady };

  for (const tm of sz.tematy) {
    // which variant of every group goes out
    const wybor = new Map<string, string>();
    for (const g of new Set(tm.wiadomosci.map((w) => w.grupa).filter(Boolean))) {
      const wGrupie = tm.wiadomosci.filter((w) => w.grupa === g);
      const auto = wGrupie.find((w) => w.warunek && warunekPasuje(w.warunek, c)) ?? wGrupie.find((w) => !w.warunek);
      const reczny = zm.warianty?.[tm.klucz + "/" + g];
      wybor.set(g, reczny !== undefined && (reczny === "" || wGrupie.some((w) => w.klucz === reczny)) ? reczny : auto?.klucz ?? "");
      wybor.set("auto:" + g, auto?.klucz ?? "");
    }
    const pt: Podglad["tematy"][number] = { klucz: tm.klucz, nazwa: tm.nazwa, ogolny: tm.ogolny, wiadomosci: [] };
    const pl: Plan["tematy"][number] = { klucz: tm.klucz, nazwa: tm.nazwa, ogolny: tm.ogolny, wiadomosci: [] };
    for (const w of tm.wiadomosci) {
      const id = tm.klucz + "/" + w.klucz, z = zm.wiadomosci?.[id] ?? {};
      const auto = w.grupa ? wybor.get("auto:" + w.grupa) === w.klucz : warunekPasuje(w.warunek, c);
      const wybrana = w.grupa ? wybor.get(w.grupa) === w.klucz : typeof z.wlacz === "boolean" ? z.wlacz : auto;
      const edytowana = typeof z.html === "string" && wiele(z.html, MAX_HTML) !== "";
      const p = podstaw(edytowana ? wiele(z.html, MAX_HTML) : w.html, wartosci, flagi);
      const przypnij = typeof z.przypnij === "boolean" ? z.przypnij : w.przypnij;
      pt.wiadomosci.push({ id, klucz: w.klucz, nazwa: w.nazwa, grupa: w.grupa, wybrana, auto, html: p.tekst, przypnij, edytowana, braki: p.braki });
      if (!wybrana) continue;
      if (p.braki.length) blokady.push("„" + w.nazwa + "” (" + tm.nazwa + "): brak danych dla " + p.braki.map((b) => NAZWY_ZMIENNYCH[b] ? "{{" + b + "}} — " + NAZWY_ZMIENNYCH[b] : "{{" + b + "}}").join("; ") + ". Uzupełnij dane albo popraw treść.");
      const dl = bezTagow(p.tekst).length;
      if (!dl) blokady.push("„" + w.nazwa + "” (" + tm.nazwa + ") jest pusta.");
      if (dl > MAX_TEKST) blokady.push("„" + w.nazwa + "” (" + tm.nazwa + ") jest za długa (" + dl + " znaków, najwyżej " + MAX_TEKST + ").");
      pl.wiadomosci.push({ klucz: id, nazwa: w.nazwa, html: p.tekst, przypnij });
    }
    podglad.tematy.push(pt); plan.tematy.push(pl);
  }

  for (const [rola, skrot, o] of [["ksiegowa", k.opiekun, d.ksiegowa], ["kadrowa", k.kadrowy, d.kadrowa]] as Array<["ksiegowa" | "kadrowa", string | null, Osoba]>) {
    if (!String(skrot ?? "").trim()) continue;
    const u = o?.telegram_username ?? "", mozna = USERNAME.test(u);
    const dodaj = mozna && zm.osoby?.[rola] !== false;
    podglad.osoby.push({ rola, skrot: String(skrot), imie_nazwisko: o?.imie_nazwisko ?? "", username: u, dodaj, mozna });
    // the same person may be both the accountant and the HR officer of a client
    if (dodaj && !plan.osoby.some((x) => x.username.toLowerCase() === u.toLowerCase())) plan.osoby.push({ username: u, imie: o!.imie_nazwisko, rola });
  }
  return { plan, podglad };
}
