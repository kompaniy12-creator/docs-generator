// Umowy — the rules of the generator, free of I/O so they can be tested: which template needs which fields,
// how the values of the placeholders are built from the form, the forecast calculator against the price
// list, the registry court, who must sign according to the rule of representation, and the state of a
// client in the move to prepayment.

import type { Literal, Segment, Wartosc } from "./docx.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type Rodzaj = "nowa_spzoo" | "nowa_jdg" | "stara_spzoo" | "stara_jdg" | "aneks_spzoo" | "aneks_jdg";
export type Rodzina = "SPZOO" | "JDG";
export const SAD_SZABLONU = "SĄD REJONOWY POZNAŃ - NOWE MIASTO I WILDA W POZNANIU, VIII WYDZIAŁ GOSPODARCZY KRAJOWEGO REJESTRU SĄDOWEGO";
export const ROK_SZABLONU = 2026;

const PROGNOZA = ["PROGNOZA_ZAPISY", "PROGNOZA_UOP", "PROGNOZA_UZ", "PROGNOZA_VAT", "PROGNOZA_INNE", "PROGNOZA_KWOTA"];
// what each kind of document is and the placeholders its template must carry
export const RODZAJE: Record<Rodzaj, { rodzina: Rodzina; nazwa: string; aneks: boolean; prognoza: boolean; kontakt: boolean; placeholdery: string[] }> = {
  nowa_spzoo: { rodzina: "SPZOO", nazwa: "Nowa umowa (przedpłata) — spółka w KRS", aneks: false, prognoza: true, kontakt: true,
    placeholdery: ["NUMER", "DATA", "NAZWA_SPOLKI", "ADRES_SIEDZIBY", "NUMER_KRS", "NUMER_NIP", "IMIE_NAZWISKO", "STANOWISKO", "EMAIL", "TELEFON", "PIERWSZY_OKRES", ...PROGNOZA] },
  nowa_jdg: { rodzina: "JDG", nazwa: "Nowa umowa (przedpłata) — JDG", aneks: false, prognoza: true, kontakt: true,
    placeholdery: ["NUMER", "DATA", "IMIE_NAZWISKO", "NAZWA_FIRMY", "ADRES_FIRMY", "NIP", "REGON", "EMAIL", "TELEFON", "PIERWSZY_OKRES", ...PROGNOZA] },
  stara_spzoo: { rodzina: "SPZOO", nazwa: "Umowa w starym wzorze — spółka w KRS", aneks: false, prognoza: false, kontakt: false,
    placeholdery: ["NUMER", "DATA", "NAZWA_SPOLKI", "ADRES_SIEDZIBY", "NUMER_KRS", "NUMER_NIP", "IMIE_NAZWISKO", "STANOWISKO"] },
  stara_jdg: { rodzina: "JDG", nazwa: "Umowa w starym wzorze — JDG", aneks: false, prognoza: false, kontakt: true,
    placeholdery: ["NUMER", "DATA", "IMIE_NAZWISKO", "NAZWA_FIRMY", "ADRES_FIRMY", "NIP", "REGON", "EMAIL", "TELEFON"] },
  aneks_spzoo: { rodzina: "SPZOO", nazwa: "Aneks — przejście na przedpłatę, spółka w KRS", aneks: true, prognoza: false, kontakt: true,
    placeholdery: ["NUMER_ANEKSU", "NUMER_UMOWY", "DATA_UMOWY", "DATA", "NAZWA_SPOLKI", "ADRES_SIEDZIBY", "NUMER_KRS", "NUMER_NIP", "IMIE_NAZWISKO", "STANOWISKO", "EMAIL", "TELEFON"] },
  aneks_jdg: { rodzina: "JDG", nazwa: "Aneks — przejście na przedpłatę, JDG", aneks: true, prognoza: false, kontakt: false,
    placeholdery: ["NUMER_ANEKSU", "NUMER_UMOWY", "DATA_UMOWY", "DATA", "IMIE_NAZWISKO", "NAZWA_FIRMY", "ADRES_FIRMY", "NIP", "REGON"] },
};
export const czyRodzaj = (v: unknown): v is Rodzaj => typeof v === "string" && v in RODZAJE;

// placeholders of an uploaded template against what the kind needs
export function porownajPlaceholdery(rodzaj: Rodzaj, lista: { nazwa: string }[]): { brakuje: string[]; nadmiarowe: string[] } {
  const ma = new Set(lista.map((l) => l.nazwa)), chce = new Set(RODZAJE[rodzaj].placeholdery);
  return { brakuje: [...chce].filter((n) => !ma.has(n)), nadmiarowe: [...ma].filter((n) => !chce.has(n)) };
}

// ---------------------------------------------------------------- small things
export const cyfry = (v: unknown) => String(v ?? "").replace(/\D/g, "");
export const t = (v: unknown, n = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export function nipOk(v: unknown): boolean {
  const d = cyfry(v);
  if (d.length !== 10) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  return w.reduce((s, x, i) => s + x * +d[i], 0) % 11 === +d[9];
}
export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
export const dataPl = (iso: string) => iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4);
// the calendar day in Poland, whatever the server's clock zone
export function dzisPl(teraz = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(teraz);
  return p.slice(0, 10);
}
const MIES = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
// "październik 2026 r. (obsługa dokumentów za wrzesień 2026 r.)" — a settlement period serves the month before it
export function okresTekst(rok: number, miesiac: number): string {
  const pm = miesiac === 1 ? 12 : miesiac - 1, pr = miesiac === 1 ? rok - 1 : rok;
  return `${MIES[miesiac - 1]} ${rok} r. (obsługa dokumentów za ${MIES[pm - 1]} ${pr} r.)`;
}
// "Prezes Zarządu" -> "Prezesa Zarządu": the contract says "reprezentowaną przez Jana Kowalskiego - Prezesa Zarządu"
export function stanowiskoBiernik(funkcja: unknown): string {
  const f = t(funkcja, 120).toLowerCase();
  if (!f) return "";
  const M: [RegExp, string][] = [[/^wiceprezes zarządu$/, "Wiceprezesa Zarządu"], [/^prezes zarządu$/, "Prezesa Zarządu"], [/^członek zarządu$/, "Członka Zarządu"], [/^prokurent.*$/, "Prokurenta"],
    [/^likwidator$/, "Likwidatora"], [/^wspólnik$/, "Wspólnika"], [/^komplementariusz$/, "Komplementariusza"], [/^pełnomocnik$/, "Pełnomocnika"], [/^wiceprezes$/, "Wiceprezesa"], [/^prezes$/, "Prezesa"]];
  for (const [re, na] of M) if (re.test(f)) return na;
  return f.replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
}
// seat address as the contracts write it: "ul. Przykładowa 1/2, 00-000 Warszawa"
export function adresSiedziby(d: Any): string {
  const ulica = t(d?.ulica), kod = t(d?.kod, 10), miasto = t(d?.miasto, 120);
  const zPrefiksem = /^(ul\.|al\.|aleja|aleje|pl\.|plac|os\.|osiedle|rondo|rynek|skwer|bulwar)\s/i.test(ulica);
  const maUlice = /\p{L}{2,}.*\d/u.test(ulica) && !new RegExp("^" + miasto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+\\d", "i").test(ulica);
  const u = !ulica ? "" : zPrefiksem || !maUlice ? ulica : "ul. " + ulica;
  return [u, [kod, miasto].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------- representation
export type Osoba = { imie_nazwisko: string; funkcja: string; zrodlo?: string };
export type Reprezentacja = { tryb: "samodzielna" | "laczna" | "nieustalona"; min: number; opis: string };
// How many people must sign, read from the rule entered in KRS and the size of the board. When the rule
// cannot be read with certainty the answer is 'nieustalona' and the administrator has to confirm.
export function reprezentacja(sposob: unknown, osoby: Osoba[]): Reprezentacja {
  const s = t(sposob, 2000).toLowerCase();
  const n = osoby.length;
  if (!s) return { tryb: "nieustalona", min: 1, opis: "W danych z rejestru nie ma sposobu reprezentacji — sprawdź w odpisie KRS, kto może podpisać umowę." };
  const sam = /samodzieln|jednoosobowo|każdy (z )?(członk|wspólnik)|każdy członek/.test(s);
  const lacz = /łączn|współdziałani|dwóch|dwaj|dwoje|dwie osoby|wspólnie/.test(s);
  const jedno = /zarząd(u)? jednoosobow|jednoosobowego zarządu|w przypadku zarządu jednoosobowego|zarząd jest jednoosobowy/.test(s);
  if (lacz && jedno) {
    return n <= 1 ? { tryb: "samodzielna", min: 1, opis: "Zarząd jednoosobowy — jedyny członek zarządu reprezentuje spółkę samodzielnie." }
      : { tryb: "laczna", min: 2, opis: "Zarząd wieloosobowy — według wpisu w KRS wymagane jest współdziałanie (reprezentacja łączna): wskaż wszystkie osoby, które podpiszą umowę." };
  }
  if (lacz && !sam) return { tryb: "laczna", min: 2, opis: "Według wpisu w KRS wymagana jest reprezentacja łączna: wskaż wszystkie osoby, które podpiszą umowę." };
  if (sam && !lacz) return { tryb: "samodzielna", min: 1, opis: "Według wpisu w KRS uprawniona osoba reprezentuje spółkę samodzielnie." };
  return { tryb: "nieustalona", min: 1, opis: "Sposób reprezentacji jest złożony — przeczytaj wpis z KRS i wskaż osoby, które razem mogą podpisać umowę." };
}

// ---------------------------------------------------------------- registry court
export type Sad = { nazwa: string; kod?: string | null; powiaty?: string[] };
export type SadWynik = { nazwa: string; zrodlo: "rejestr" | "sygnatura" | "siedziba" | "brak"; pewne: boolean; opis: string };
// The register answer kept by the portal has no court field today; when it gets one (or a file reference),
// it is used. Otherwise the court an administrator confirmed earlier for the same county is PROPOSED and
// must be confirmed against the KRS extract; without any of these the administrator has to enter it.
export function ustalSad(rej: Any, sady: Sad[]): SadWynik {
  const zRej = t(rej?.sad ?? rej?.sad_rejestrowy ?? rej?.oznaczenie_sadu ?? "", 400);
  if (zRej) return { nazwa: zRej.toUpperCase(), zrodlo: "rejestr", pewne: true, opis: "Sąd rejestrowy z danych rejestru." };
  const syg = t(rej?.sygnatura ?? rej?.sygnatura_akt ?? "", 80).toUpperCase().replace(/\s+/g, " ");
  if (syg) {
    const s = sady.find((x) => x.kod && syg.startsWith(x.kod.toUpperCase()));
    if (s) return { nazwa: s.nazwa, zrodlo: "sygnatura", pewne: true, opis: "Sąd ustalony po sygnaturze akt " + syg + "." };
  }
  const powiat = t(rej?.powiat ?? "", 8);
  if (powiat) {
    const s = sady.find((x) => (x.powiaty ?? []).includes(powiat));
    if (s) return { nazwa: s.nazwa, zrodlo: "siedziba", pewne: false, opis: "Propozycja według siedziby (powiat " + powiat + ") — rejestr.io nie podaje sądu; potwierdź z odpisem KRS." };
  }
  return { nazwa: "", zrodlo: "brak", pewne: false, opis: "Rejestr nie podaje sądu rejestrowego — wpisz go z odpisu KRS (zostanie zapamiętany dla tego powiatu)." };
}

// ---------------------------------------------------------------- forecast (Załącznik nr 4)
export type Pozycja = { id?: string; rodzina: string; kod: string | null; nazwa: string; prog: number | null; cena: number | null; cena_opis?: string | null; stala?: boolean; aktywna?: boolean; jednostka?: string | null };
export type PrognozaWe = {
  zapisy: number; vat: boolean; uop: number; uz: number; kadry: "w_stawce" | "odrebnie";
  srodki_trwale?: number; roznice_kursowe?: number; vat_ue?: boolean; zus_dra?: number;
  inne?: { nazwa: string; kwota: number }[];      // typed by the administrator: nothing here comes from the price list
  tekst_zapisy?: string; tekst_inne?: string;     // how the row is worded in the annex, when the administrator overrides it
};
export type Linia = { kod: string; nazwa: string; ilosc: number; cena: number; wartosc: number; w_stawce: boolean; zrodlo: "cennik" | "reczna" };
export type PrognozaWy = { linie: Linia[]; suma: number; kwota: number; odrebnie: number; teksty: Record<string, string>; bledy: string[]; ostrzezenia: string[] };
const int = (v: unknown) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 0; };
export const zlote = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// The first monthly rate, line by line. Every price comes from the price list rows given (never a default);
// an item the list lacks is reported as an error instead of being priced.
export function prognoza(cennik: Pozycja[], rodzina: Rodzina, we: PrognozaWe): PrognozaWy {
  const c = cennik.filter((p) => p.rodzina === rodzina && p.aktywna !== false);
  const jedna = (kod: string) => c.find((p) => p.kod === kod && typeof p.cena === "number") ?? null;
  const linie: Linia[] = [], bledy: string[] = [], ostrzezenia: string[] = [];
  const dodaj = (kod: string, ilosc: number, wStawce = true, opis = "") => {
    const p = jedna(kod);
    if (!p) { bledy.push("W cenniku (" + rodzina + ") brakuje pozycji „" + (opis || kod) + "” — uzupełnij cennik albo dodaj pozycję ręcznie."); return; }
    linie.push({ kod, nazwa: p.nazwa + (p.jednostka && ilosc !== 1 ? " (" + ilosc + " × " + p.cena + " zł)" : ""), ilosc, cena: p.cena!, wartosc: ilosc * p.cena!, w_stawce: wStawce, zrodlo: "cennik" });
  };
  // the books: the band the forecast falls into, and every entry above the highest band
  const n = int(we.zapisy);
  const progi = c.filter((p) => p.kod === "zapisy" && typeof p.cena === "number" && typeof p.prog === "number").sort((a, b) => a.prog! - b.prog!);
  let tekstZapisy = "";
  if (!progi.length) bledy.push("W cenniku (" + rodzina + ") nie ma progów liczby zapisów.");
  else {
    const najw = progi[progi.length - 1];
    const prog = n === 0 ? (progi.find((p) => p.prog === 0) ?? progi.find((p) => p.prog! > 0)!) : (progi.find((p) => p.prog! >= n && p.prog! > 0) ?? najw);
    linie.push({ kod: "zapisy", nazwa: prog.nazwa, ilosc: 1, cena: prog.cena!, wartosc: prog.cena!, w_stawce: true, zrodlo: "cennik" });
    if (n > najw.prog!) dodaj("zapis_kolejny", n - najw.prog!, true, "opłata za każdy kolejny zapis");
    tekstZapisy = n === 0 ? (prog.prog === 0 ? "0 (brak dokumentów)" : "do " + prog.prog) : n > najw.prog! ? String(n) : "do " + prog.prog;
  }
  if (we.vat) dodaj("vat_jpk", 1, true, "deklaracja VAT + JPK");
  const kadryWStawce = we.kadry !== "odrebnie";
  const uop = int(we.uop), uz = int(we.uz);
  if (uop) dodaj("uop", uop, kadryWStawce, "pracownik — umowa o pracę");
  if (uz) dodaj("uz", uz, kadryWStawce, "pracownik — umowa zlecenie");
  const inne: string[] = [];
  const st = int(we.srodki_trwale), rk = int(we.roznice_kursowe), dra = int(we.zus_dra);
  if (st) { dodaj("srodek_trwaly", st, true, "ewidencja środków trwałych"); inne.push("ewidencja środków trwałych: " + st + " szt."); }
  if (rk) { dodaj("roznice_kursowe", rk, true, "różnice kursowe"); inne.push("różnice kursowe: " + rk + " dok."); }
  if (we.vat_ue) { dodaj("vat_ue", 1, true, "informacja VAT UE"); inne.push("informacja VAT UE"); }
  if (dra) { dodaj("zus_dra", dra, true, "ZUS DRA"); inne.push("ZUS DRA: " + dra + " dok."); }
  for (const r of we.inne ?? []) {
    const nazwa = t(r?.nazwa, 200), kw = Number(r?.kwota);
    if (!nazwa && !kw) continue;
    if (!nazwa || !Number.isFinite(kw) || kw < 0) { bledy.push("Pozycja ręczna wymaga nazwy i kwoty netto."); continue; }
    linie.push({ kod: "reczna", nazwa, ilosc: 1, cena: kw, wartosc: kw, w_stawce: true, zrodlo: "reczna" });
    inne.push(nazwa);
  }
  const suma = linie.filter((l) => l.w_stawce).reduce((s, l) => s + l.wartosc, 0);
  const odrebnie = linie.filter((l) => !l.w_stawce).reduce((s, l) => s + l.wartosc, 0);
  if ((uop || uz) && !kadryWStawce) ostrzezenia.push("Usługi kadrowe (" + (uop + uz) + " os., " + zlote(odrebnie) + " zł netto) NIE wchodzą do Stawki Miesięcznej — będą na odrębnej fakturze. Wzór umowy zalicza naliczanie wynagrodzeń do Usług Stałych: uzgodnij to z treścią umowy przed wysłaniem.");
  const kwota = Math.round(suma);
  return {
    linie, suma, kwota, odrebnie, bledy, ostrzezenia,
    teksty: {
      PROGNOZA_ZAPISY: t(we.tekst_zapisy, 80) || tekstZapisy, PROGNOZA_UOP: String(uop), PROGNOZA_UZ: String(uz), PROGNOZA_VAT: we.vat ? "tak" : "nie",
      PROGNOZA_INNE: t(we.tekst_inne, 300) || (inne.length ? inne.join("; ") : "brak"), PROGNOZA_KWOTA: zlote(kwota),
    },
  };
}

// ---------------------------------------------------------------- the form -> values of the placeholders
export type Formularz = {
  rodzaj: Rodzaj; klient?: string | null;
  firma: { nazwa?: string; adres?: string; krs?: string; nip?: string; regon?: string; sad?: string };
  podpisujacy?: Osoba[];                        // SPZOO: everybody who signs for the client, in order
  wlasciciel?: string;                          // JDG: the owner's name
  kontakt?: { imie_nazwisko?: string; email?: string; telefon?: string };
  okres?: { rok?: number; miesiac?: number; tekst?: string };
  prognoza?: PrognozaWe;
  aneks?: { umowa_numer?: string; umowa_data?: string; aneks_nr?: number | null };
  potwierdzenia?: { reprezentacja?: boolean; sad?: boolean; roznice?: boolean };
  zrodla?: Record<string, string>;
};
export type Wartosci = { wartosci: Record<string, Wartosc | Wartosc[]>; literaly: Literal[]; braki: string[]; ostrzezenia: string[]; prognoza: PrognozaWy | null; klient_nazwa: string; klient_nip: string };

// numer: the number to print (or a marker in a preview); data: YYYY-MM-DD; rok: the year of the numbering
export function wartosci(f: Formularz, ctx: { numer: string; data: string; rok: number; cennik: Pozycja[]; rep?: Reprezentacja | null; sadPewny?: boolean }): Wartosci {
  const R = RODZAJE[f.rodzaj], braki: string[] = [], ostrzezenia: string[] = [], w: Record<string, Wartosc | Wartosc[]> = {}, literaly: Literal[] = [];
  const firma = f.firma ?? {}, spzoo = R.rodzina === "SPZOO";
  const wymagane = (v: string, co: string) => { if (!v) braki.push(co); return v; };
  w.DATA = dataPl(ctx.data);
  const nazwa = wymagane(t(firma.nazwa), spzoo ? "pełna nazwa spółki" : "nazwa firmy (działalności)");
  const adres = wymagane(t(firma.adres), spzoo ? "adres siedziby" : "adres firmy");
  const nip = cyfry(firma.nip);
  if (nip.length !== 10) braki.push("NIP (10 cyfr)"); else if (!nipOk(nip)) ostrzezenia.push("NIP ma nieprawidłową cyfrę kontrolną — sprawdź numer.");
  const kontakt = f.kontakt ?? {};
  if (spzoo) {
    const krs = cyfry(firma.krs);
    if (krs.length !== 10) braki.push("numer KRS (10 cyfr)");
    const osoby = (f.podpisujacy ?? []).map((o) => ({ imie_nazwisko: t(o?.imie_nazwisko, 120), funkcja: t(o?.funkcja, 120), zrodlo: o?.zrodlo })).filter((o) => o.imie_nazwisko || o.funkcja);
    if (!osoby.length) braki.push("osoba podpisująca w imieniu spółki");
    for (const o of osoby) { if (!o.imie_nazwisko) braki.push("imię i nazwisko osoby podpisującej"); if (!o.funkcja) braki.push("stanowisko osoby podpisującej (" + (o.imie_nazwisko || "?") + ")"); }
    const rep = ctx.rep ?? null;
    if (rep && osoby.length < rep.min && !f.potwierdzenia?.reprezentacja) braki.push("reprezentacja łączna: wskaż co najmniej " + rep.min + " osoby podpisujące albo potwierdź reprezentację po sprawdzeniu odpisu KRS");
    if ((!rep || rep.tryb === "nieustalona") && !f.potwierdzenia?.reprezentacja) braki.push("potwierdzenie sposobu reprezentacji (sprawdzony w odpisie KRS)");
    if (osoby.some((o) => o.zrodlo === "reczna")) ostrzezenia.push("Osoba podpisująca wpisana ręcznie — nie ma jej wśród uprawnionych według rejestru; upewnij się, że ma umocowanie (np. pełnomocnictwo).");
    // "reprezentowaną przez {{IMIE_NAZWISKO}} - {{STANOWISKO}}": several signatories are listed inside the first placeholder
    let pierwsze: Wartosc = osoby[0]?.imie_nazwisko ?? "";
    if (osoby.length > 1) {
      const seg: Segment[] = [];
      osoby.forEach((o, i) => { seg.push({ t: o.imie_nazwisko }); if (i < osoby.length - 1) seg.push({ t: " - " + o.funkcja + " oraz ", b: false }); });
      pierwsze = seg;
    }
    const kontaktOsoba = t(kontakt.imie_nazwisko, 120) || osoby[0]?.imie_nazwisko || "";
    w.IMIE_NAZWISKO = R.kontakt ? [pierwsze, kontaktOsoba] : pierwsze;
    w.STANOWISKO = osoby[osoby.length - 1]?.funkcja ?? "";
    w.NAZWA_SPOLKI = nazwa; w.ADRES_SIEDZIBY = adres; w.NUMER_KRS = krs; w.NUMER_NIP = nip;
    const sad = t(firma.sad, 400);
    if (!sad) braki.push("sąd rejestrowy (z odpisu KRS)");
    else if (!ctx.sadPewny && !f.potwierdzenia?.sad) braki.push("potwierdzenie sądu rejestrowego (zgodny z odpisem KRS)");
    if (sad && sad.toUpperCase() !== SAD_SZABLONU) literaly.push({ w_akapicie: "{{NAZWA_SPOLKI}}", szukaj: SAD_SZABLONU, na: sad.toUpperCase() });
  } else {
    const wl = wymagane(t(f.wlasciciel, 120), "imię i nazwisko przedsiębiorcy");
    const regon = cyfry(firma.regon);
    if (regon.length !== 9 && regon.length !== 14) braki.push("REGON (9 cyfr)");
    w.IMIE_NAZWISKO = R.kontakt ? [wl, t(kontakt.imie_nazwisko, 120) || wl] : wl;
    w.NAZWA_FIRMY = nazwa; w.ADRES_FIRMY = adres; w.NIP = nip; w.REGON = regon;
  }
  if (R.kontakt) {
    const email = t(kontakt.email, 200), tel = t(kontakt.telefon, 40);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) braki.push("adres e-mail Zleceniodawcy");
    if (cyfry(tel).length < 9) braki.push("telefon Zleceniodawcy");
    w.EMAIL = email; w.TELEFON = tel;
  }
  let prog: PrognozaWy | null = null;
  if (R.aneks) {
    const a = f.aneks ?? {};
    w.NUMER_ANEKSU = ctx.numer;
    w.NUMER_UMOWY = wymagane(t(a.umowa_numer, 60), "numer umowy, do której jest aneks");
    if (!isDate(a.umowa_data)) braki.push("data zawarcia umowy, do której jest aneks"); else { w.DATA_UMOWY = dataPl(a.umowa_data); if (a.umowa_data > ctx.data) braki.push("data umowy nie może być późniejsza niż data aneksu"); }
  } else {
    w.NUMER = ctx.numer;
    if (ctx.rok !== ROK_SZABLONU) literaly.push({ w_akapicie: "{{NUMER}}", szukaj: "/" + R.rodzina + "/" + ROK_SZABLONU, na: "/" + R.rodzina + "/" + ctx.rok });
  }
  if (R.prognoza) {
    const o = f.okres ?? {};
    const tekst = t(o.tekst, 200) || (Number.isInteger(o.rok) && Number.isInteger(o.miesiac) && o.miesiac! >= 1 && o.miesiac! <= 12 && o.rok! >= 2024 && o.rok! <= 2100 ? okresTekst(o.rok!, o.miesiac!) : "");
    w.PIERWSZY_OKRES = wymagane(tekst, "pierwszy Okres Rozliczeniowy");
    if (!f.prognoza) braki.push("prognoza (Załącznik nr 4)");
    else {
      prog = prognoza(ctx.cennik, R.rodzina, f.prognoza);
      braki.push(...prog.bledy); ostrzezenia.push(...prog.ostrzezenia);
      Object.assign(w, prog.teksty);
    }
  }
  return { wartosci: w, literaly, braki: [...new Set(braki)], ostrzezenia, prognoza: prog, klient_nazwa: nazwa, klient_nip: nip };
}

// ---------------------------------------------------------------- base vs register
export function roznice(baza: Any, rej: Any): { pole: string; baza: string; rejestr: string }[] {
  const out: { pole: string; baza: string; rejestr: string }[] = [];
  const norm = (s: unknown) => t(s, 400).toLowerCase().replace(/spółka z ograniczoną odpowiedzialnością/g, "sp z o o").replace(/sp\.? ?z ?o\.? ?o\.?/g, "sp z o o").replace(/\bul\.?\s/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (baza?.nazwa && rej?.nazwa && norm(baza.nazwa) !== norm(rej.nazwa)) out.push({ pole: "nazwa", baza: t(baza.nazwa), rejestr: t(rej.nazwa) });
  const ab = [baza?.adres, baza?.miasto].filter(Boolean).join(", "), ar = t(rej?.adres);
  if (ab && ar) { const A = norm(ab).split(" "), B = new Set(norm(ar).split(" ")); if (A.filter((x) => x.length > 1 && !B.has(x)).length > 0) out.push({ pole: "adres", baza: t(ab), rejestr: ar }); }
  if (cyfry(baza?.nip) && cyfry(rej?.nip) && cyfry(baza.nip) !== cyfry(rej.nip)) out.push({ pole: "NIP", baza: cyfry(baza.nip), rejestr: cyfry(rej.nip) });
  return out;
}

// ---------------------------------------------------------------- move to prepayment
export type StanMigracji = "przedplata" | "aneks_podpisany" | "aneks_wygenerowany" | "nowa_wygenerowana" | "stara" | "brak" | "pomin";
export const STANY_MIGRACJI: Record<StanMigracji, string> = {
  przedplata: "na przedpłacie", aneks_podpisany: "aneks podpisany", aneks_wygenerowany: "aneks wygenerowany — do podpisu", nowa_wygenerowana: "nowa umowa wygenerowana — do podpisu",
  stara: "umowa w starym wzorze", brak: "brak umowy w bazie", pomin: "pominięty",
};
// umowy: the client's confirmed service contracts in the contracts module; dok: its generated documents (not cancelled)
export function stanMigracji(umowy: Any[], dok: Any[], reczny: string | null): StanMigracji {
  if (reczny === "przedplata") return "przedplata";
  if (reczny === "pomin") return "pomin";
  const zywe = dok.filter((d) => d.status !== "anulowana");
  if (zywe.some((d) => String(d.rodzaj).startsWith("nowa_") && d.status === "podpisana")) return "przedplata";
  if (zywe.some((d) => String(d.rodzaj).startsWith("aneks_") && d.status === "podpisana")) return "aneks_podpisany";
  if (zywe.some((d) => String(d.rodzaj).startsWith("aneks_"))) return "aneks_wygenerowany";
  if (zywe.some((d) => String(d.rodzaj).startsWith("nowa_"))) return "nowa_wygenerowana";
  const ksieg = umowy.filter((u) => u.rodzaj === "ksiegowosc" && u.status === "przypisany");
  if (ksieg.some((u) => /pro ?forma|z góry|przedpłat/i.test(String(u.wynagrodzenie ?? "") + " " + String(u.zakres ?? "") + " " + String(u.uwagi ?? "")))) return "przedplata";
  return ksieg.length || zywe.some((d) => String(d.rodzaj).startsWith("stara_")) ? "stara" : "brak";
}
// "8/SPZOO/2026" out of a file name or a note like "Umowa 8-SPZOO-2026 …"
export function numerZNazwy(s: unknown): string {
  const m = /(\d{1,4})\s*[-\/_ ]\s*(SPZOO|JDG)\s*[-\/_ ]\s*(20\d{2})/i.exec(String(s ?? ""));
  return m ? `${+m[1]}/${m[2].toUpperCase()}/${m[3]}` : "";
}
export const nazwaPliku = (numerPelny: string, klient: string, ext: string) =>
  (numerPelny.replace(/[\/\\]/g, "-").replace(/[^A-Za-z0-9-]+/g, "_") + "_" + klient.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L").replace(/[^A-Za-z0-9]+/g, "_")).replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 110) + "." + ext;
