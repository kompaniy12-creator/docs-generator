// Baza klientów — the rules, free of any I/O so they can be tested (logic_test.ts):
// matching a contract to a client, the register extract and its differences, the contracts audit,
// the plan (and cost) of a register refresh, CSV.

// deno-lint-ignore no-explicit-any
type Any = any;

export const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
export const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/gi, "l").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function nipOk(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const s = w.reduce((a, x, i) => a + x * Number(nip[i]), 0) % 11;
  return s !== 10 && s === Number(nip[9]);
}

// the key of a client: the same as portal_klienci.id
export function klientId(k: { nip?: string; nazwa?: string }): string {
  const nip = digits(k.nip);
  return nip.length === 10 ? nip : "nazwa:" + String(k.nazwa ?? "").toLowerCase();
}

// which register holds the firm, judged by the legal form written in the clients sheet
export function formaTyp(forma: unknown): "krs" | "jdg" | "inne" {
  const f = norm(forma);
  if (!f) return "inne";
  if (/\b(jdg|jednoosobowa|dzialalnosc|osoba fizyczna|ceidg)\b/.test(f)) return "jdg";
  if (/\bspolka cywilna\b|\bs c\b/.test(f)) return "inne"; // a civil partnership is in neither KRS nor (as such) CEIDG
  if (/\b(spolka|sp|z o o|s a|akcyjna|komandytowa|jawna|partnerska|fundacja|stowarzyszenie|spoldzielnia|psa)\b/.test(f)) return "krs";
  return "inne";
}

// a firm's name without its legal form and punctuation, for comparing
const FORMY = /\b(spolka z ograniczona odpowiedzialnoscia|spolka komandytowo akcyjna|spolka komandytowa|spolka jawna|spolka akcyjna|spolka partnerska|prosta spolka akcyjna|spolka cywilna|sp z o o|sp zoo|sp k|sp j|s a|s c|p s a|w likwidacji|w upadlosci|w restrukturyzacji|w organizacji)\b/g;
export function nazwaKlucz(s: unknown): string {
  return norm(s).replace(FORMY, " ").replace(/\b(sp|spolka|z|o)\b/g, " ").replace(/\s+/g, " ").trim();
}
const tokens = (s: string) => s.split(" ").filter((t) => t.length > 1);
// every word of the shorter name appears in the longer one (at least two words)
export function nazwaZawiera(a: string, b: string): boolean {
  const A = tokens(a), B = tokens(b);
  const [kr, dl] = A.length <= B.length ? [A, B] : [B, A];
  return kr.length >= 2 && kr.every((t) => dl.includes(t));
}

// ---------------------------------------------------------------- contract -> client
export type KlientM = { id: string; nip?: string | null; nazwa: string; krs?: string | null; rej_nazwa?: string | null };
export type Kandydat = { id: string; nazwa: string; nip: string; wynik: number; powod: string; numer: boolean; nazwaOk: boolean };

// How well each client fits the counterparty read from a contract. NIP ranks first, then the KRS number,
// then the name; a NIP that was read and belongs to nobody (or to somebody else) blocks a name match.
// `numer`: the NIP or KRS number agrees; `nazwaOk`: the name agrees with the sheet or the register.
export function dopasuj(odczyt: { nazwa?: string; nip?: string; krs?: string }, klienci: KlientM[]): Kandydat[] {
  const nip = digits(odczyt.nip), krs = digits(odczyt.krs).replace(/^0+/, ""), nazwa = nazwaKlucz(odczyt.nazwa);
  const nipWazny = nipOk(nip);
  const out: Kandydat[] = [];
  for (const k of klienci) {
    const kn = digits(k.nip);
    let wynik = 0, powod = "", numer = false;
    const a = nazwaKlucz(k.nazwa), b = nazwaKlucz(k.rej_nazwa);
    const cala = !!nazwa && ((!!a && a === nazwa) || (!!b && b === nazwa));
    const nazwaOk = cala || (!!nazwa && ((!!a && nazwaZawiera(a, nazwa)) || (!!b && nazwaZawiera(b, nazwa))));
    if (nipWazny && kn === nip) { wynik = 100; numer = true; powod = nazwaOk ? "NIP i nazwa" : "NIP (nazwa inna albo nieodczytana)"; }
    else if (krs.length >= 4 && digits(k.krs).replace(/^0+/, "") === krs) { wynik = 90; numer = true; powod = nazwaOk ? "KRS i nazwa" : "KRS (nazwa inna albo nieodczytana)"; }
    else if (nazwaOk) {
      wynik = cala ? 70 : 50; powod = cala ? "nazwa" : "nazwa (częściowo)";
      // the document carries a valid NIP and this client has a different one: the same name is not enough
      if (nipWazny && kn.length === 10 && kn !== nip) { wynik = 40; powod += ", inny NIP"; }
    }
    if (wynik) out.push({ id: k.id, nazwa: k.nazwa, nip: kn, wynik, powod, numer, nazwaOk });
  }
  return out.sort((x, y) => y.wynik - x.wynik || x.nazwa.localeCompare(y.nazwa, "pl"));
}

// Filed automatically only when TWO things read from the scan agree with one client: its NIP or KRS number
// AND its name (a number alone can be misread, or be the number of another party of the document).
// Never on the name alone, never when the reading itself was unsure, never when two clients fit.
// `wskazany`: the client the uploader pointed at — then one agreeing thing is enough, and it must be that client.
export function pewnyKlient(kand: Kandydat[], pewnosc: string, wskazany: string | null = null): string | null {
  if (pewnosc === "niska" || !kand.length) return null;
  if (wskazany) {
    const w = kand.find((k) => k.id === wskazany);
    // somebody else's number in the document overrules the uploader's hint
    if (!w || w.wynik < 50 || kand.some((k) => k.id !== wskazany && k.numer)) return null;
    return wskazany;
  }
  const pelne = kand.filter((k) => k.numer && k.nazwaOk);
  return pelne.length === 1 && kand.filter((k) => k.numer).length === 1 ? pelne[0].id : null;
}

// Birth dates and PESEL numbers have no place in what we keep from a register answer.
export function bezDanychOsobowych<T>(v: T): T {
  if (Array.isArray(v)) return v.map(bezDanychOsobowych) as unknown as T;
  if (v && typeof v === "object") {
    const o: Any = {};
    for (const [k, x] of Object.entries(v as Any)) if (!/^(dataur|data_?urodzenia|dataurodzenia|pesel|urodzony|data_ur)$/i.test(k)) o[k] = bezDanychOsobowych(x);
    return o;
  }
  return v;
}

// ---------------------------------------------------------------- register extract
export type Wyciag = {
  znaleziono: boolean; krs: string | null; regon: string | null; nazwa: string | null; forma: string | null;
  data_rejestracji: string | null; kapital: number | null; adres: string | null; organ: string | null; reprezentacja: string | null;
  zarzad: Any[]; wspolnicy: Any[]; prokurenci: Any[]; pkd: string | null; stan: string | null;
};
const txt = (v: unknown, n = 400) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
function kwota(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}
// "w likwidacji" and the like are part of the entered name; the basic record may say more
export function stanFirmy(nazwa: unknown, org: Any): string {
  const n = norm(nazwa), s = org?.stan ?? {};
  if (s.czy_wykreslona === true) return "wykreślona";
  if (/\bw upadlosci\b/.test(n) || s.w_upadlosci === true || s.czy_w_upadlosci === true) return "w upadłości";
  if (/\bw likwidacji\b/.test(n) || s.w_likwidacji === true || s.czy_w_likwidacji === true) return "w likwidacji";
  if (/\bw restrukturyzacji\b/.test(n)) return "w restrukturyzacji";
  if (s.w_zawieszeniu === true) return "zawieszona";
  return "aktywna";
}
// from the answer of getFirma (shape v2) and, when we have it, rejestr.io's basic record of the organisation
export function wyciagKrs(f: Any, org: Any = null): Wyciag {
  if (!f || f.found === false) return { znaleziono: false, krs: null, regon: null, nazwa: null, forma: null, data_rejestracji: null, kapital: null, adres: null, organ: null, reprezentacja: null, zarzad: [], wspolnicy: [], prokurenci: [], pkd: null, stan: null };
  const a = f.adres ?? {};
  const ulica = [a.ulica, [a.nrDomu, a.nrLokalu].filter(Boolean).join("/")].filter(Boolean).join(" ") || f.ulica || "";
  const adres = [ulica, [a.kodPocztowy || f.kod, a.miejscowosc || f.miasto].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const dat = org?.krs_wpisy?.pierwszy_data ?? org?.krs_wpisy?.pierwszy?.data ?? org?.stan?.data_rejestracji ?? org?.data_rejestracji ?? null;
  const pkd = org?.stan?.pkd_przewazajace_dzial ?? org?.pkd_przewazajace ?? org?.stan?.pkd ?? null;
  return {
    znaleziono: true, krs: txt(f.krs, 10), regon: txt(f.regon, 14), nazwa: txt(f.nazwa), forma: txt(f.forma, 120),
    data_rejestracji: isDate(String(dat ?? "").slice(0, 10)) ? String(dat).slice(0, 10) : null,
    kapital: kwota(f.kapital), adres: txt(adres), organ: txt(f.reprezentacja?.organ, 200), reprezentacja: txt(f.reprezentacja?.sposob, 1500),
    zarzad: (Array.isArray(f.zarzad) ? f.zarzad : []).slice(0, 40).map((p: Any) => ({ imie: String(p.imie ?? ""), nazwisko: String(p.nazwisko ?? ""), funkcja: String(p.funkcja ?? "") })),
    wspolnicy: (Array.isArray(f.wspolnicy) ? f.wspolnicy : []).slice(0, 60).map((p: Any) => ({ imie: String(p.imie ?? ""), nazwisko: String(p.nazwisko ?? ""), udzialy: p.udzialy ?? null, opis: String(p.udzialyOpis ?? "") })),
    prokurenci: (Array.isArray(f.prokurenci) ? f.prokurenci : []).slice(0, 20).map((p: Any) => ({ imie_nazwisko: String(p.imie_nazwisko ?? ""), rodzaj: String(p.rodzaj ?? "") })),
    pkd: txt(typeof pkd === "object" && pkd ? [pkd.kod ?? pkd.symbol, pkd.nazwa ?? pkd.opis].filter(Boolean).join(" ") : pkd, 300),
    stan: stanFirmy(f.nazwa, org),
  };
}
// from GUS (REGON register, through DataPort): what it gives for a sole trader
export function wyciagGus(d: Any): Wyciag {
  const pusty = wyciagKrs(null);
  if (!d || d.success === false || !(d.nazwa || d.regon)) return pusty;
  const pkd = d.pkd_glowne ?? d.pkd ?? d.pkdGlowne ?? null;
  const dat = String(d.data_rozpoczecia ?? d.dataRozpoczeciaDzialalnosci ?? d.data_powstania ?? "").slice(0, 10);
  const koniec = d.data_zakonczenia ?? d.dataZakonczeniaDzialalnosci ?? null, zaw = d.data_zawieszenia ?? d.dataZawieszeniaDzialalnosci ?? null, wzn = d.data_wznowienia ?? d.dataWznowieniaDzialalnosci ?? null;
  return {
    ...pusty, znaleziono: true, regon: txt(d.regon, 14), nazwa: txt(d.nazwa), forma: txt(d.forma_prawna ?? d.formaPrawna ?? d.typ, 120),
    data_rejestracji: isDate(dat) ? dat : null, adres: txt(String(d.adres ?? "").replace(/\s*\/\s*/g, "/").replace(/\s{2,}/g, " ")),
    pkd: txt(typeof pkd === "object" && pkd ? [pkd.kod, pkd.nazwa].filter(Boolean).join(" ") : pkd, 300),
    stan: koniec ? "wykreślona" : zaw && !(wzn && String(wzn) > String(zaw)) ? "zawieszona" : "aktywna",
  };
}
// from a sole trader's normalised record (_shared/jdg.ts: CEIDG, GUS or — basic data only — MF's VAT register)
export function wyciagJdg(j: Any): Wyciag {
  const pusty = wyciagKrs(null);
  if (!j || j.znaleziono !== true) return pusty;
  return {
    ...pusty, znaleziono: true, regon: txt(j.regon, 14), nazwa: txt(j.nazwa), forma: txt(j.forma, 120),
    data_rejestracji: isDate(j.data_rozpoczecia) ? j.data_rozpoczecia : null, adres: txt(j.adres), pkd: txt(j.pkd_glowne, 300),
    // MF does not say whether the business is active: the state stays unknown rather than "aktywna"
    stan: txt(j.status, 80),
  };
}
// a snapshot of a sole trader (any source but KRS)
export const zJdg = (zrodlo: unknown) => zrodlo != null && zrodlo !== "krs";
// MF's share of the day: MF allows 100 "search" requests a day; the bulk refresh takes at most this many,
// single lookups (forms, contracts) may go a little further, the rest is left to the VAT tool
export const MF_DZIENNIE = 60;
export const MF_DZIENNIE_POJEDYNCZE = 80;
export const MF_KLUCZ = "mf-search";

const osoba = (p: Any) => [p.imie, p.nazwisko].filter(Boolean).join(" ").toUpperCase().trim() || String(p.imie_nazwisko ?? "").toUpperCase().trim();
const POLA: Array<[keyof Wyciag, string]> = [
  ["nazwa", "nazwa"], ["forma", "forma prawna"], ["krs", "numer KRS"], ["regon", "REGON"], ["adres", "adres siedziby"], ["kapital", "kapitał zakładowy"],
  ["organ", "organ reprezentacji"], ["reprezentacja", "sposób reprezentacji"], ["stan", "stan firmy"], ["pkd", "przeważająca działalność (PKD)"],
];
const LISTY: Array<[keyof Wyciag, string, (p: Any) => string]> = [
  ["zarzad", "skład organu reprezentacji", (p) => osoba(p) + (p.funkcja ? " — " + String(p.funkcja).toLowerCase() : "")],
  ["wspolnicy", "wspólnicy", (p) => osoba(p) + (p.udzialy != null ? " — " + p.udzialy + " udz." : "")],
  ["prokurenci", "prokurenci", (p) => osoba(p) + (p.rodzaj ? " — " + String(p.rodzaj).toLowerCase() : "")],
];
// what is compared between two snapshots (dates of reading and raw answers are not)
export function odcisk(w: Wyciag): string {
  const o: Any = { z: w.znaleziono };
  for (const [k] of POLA) o[k] = w[k] ?? null;
  for (const [k, , f] of LISTY) o[k] = (w[k] as Any[]).map(f).sort();
  return JSON.stringify(o);
}
export type Zmiana = { pole: string; bylo: string; jest: string };
export function roznice(prev: Wyciag | null, next: Wyciag): Zmiana[] {
  if (!prev) return [];
  const out: Zmiana[] = [];
  if (prev.znaleziono !== next.znaleziono) return [{ pole: "obecność w rejestrze", bylo: prev.znaleziono ? "jest" : "brak", jest: next.znaleziono ? "jest" : "brak" }];
  for (const [k, et] of POLA) {
    const a = prev[k] == null ? "" : String(prev[k]), b = next[k] == null ? "" : String(next[k]);
    // a field the register did not return this time is not a change
    if (a !== b && b !== "" && (a !== "" || k === "stan")) out.push({ pole: et, bylo: a || "—", jest: b });
  }
  for (const [k, et, f] of LISTY) {
    const a = ((prev[k] ?? []) as Any[]).map(f), b = ((next[k] ?? []) as Any[]).map(f);
    const ubylo = a.filter((x) => !b.includes(x)), przybylo = b.filter((x) => !a.includes(x));
    if (ubylo.length || przybylo.length) out.push({ pole: et, bylo: ubylo.join("; ") || "—", jest: przybylo.join("; ") || "—" });
  }
  return out;
}

// ---------------------------------------------------------------- register refresh: plan and cost
// rejestr.io is paid per request (about 0.05 zł each, per the office's price list — confirm in the account).
export const CENA_REJESTR_IO = 0.05;
// `ulepszenie`: a recent snapshot that holds only MF's basic data, to be replaced from a fuller source
export type PlanPoz = { id: string; nazwa: string; zrodlo: "krs" | "gus"; zapytan: number; ulepszenie?: boolean };
export type Plan = { pozycje: PlanPoz[]; pominiete: { swieze: number; bez_nip: number; zakonczone: number; po_bledzie: number }; krs_firm: number; gus_firm: number; ulepszen: number; zapytan_rejestr_io: number; zapytan_gus: number; koszt_zl: number };
// klienci: rows of klienci_baza with `rej_at` (last confirmed snapshot) and `rej_zrodlo` (where it came from);
// cache: NIP -> when portal_firmy_cache got it; pelne: a fuller source for sole traders (CEIDG / GUS) is configured
export function planOdswiezenia(klienci: Any[], cache: Record<string, string>, dni: number, teraz: number, zZakonczonymi = false, pelne = false): Plan {
  const stare = (iso: string | null | undefined) => !iso || teraz - Date.parse(iso) > dni * 86400000;
  const p: Plan = { pozycje: [], pominiete: { swieze: 0, bez_nip: 0, zakonczone: 0, po_bledzie: 0 }, krs_firm: 0, gus_firm: 0, ulepszen: 0, zapytan_rejestr_io: 0, zapytan_gus: 0, koszt_zl: 0 };
  // KRS firms first: MF's daily share running out among the sole traders must not hold them back
  const jdg: PlanPoz[] = [], ulepszenia: PlanPoz[] = [];
  for (const k of klienci) {
    if (k.status === "zakonczony" && !zZakonczonymi) { p.pominiete.zakonczone++; continue; }
    if (!nipOk(digits(k.nip))) { p.pominiete.bez_nip++; continue; }
    if (!stare(k.rej_at)) {
      // MF's basic record is not "fresh" once CEIDG / GUS can be asked — but not more often than once a day,
      // and after everything else (a fuller source that still refuses ends the run there)
      if (pelne && k.rej_zrodlo === "mf" && formaTyp(k.forma) !== "krs" && teraz - Date.parse(k.rej_at) > 86400000 && !(k.rejestr_at && teraz - Date.parse(k.rejestr_at) < 86400000)) ulepszenia.push({ id: k.id, nazwa: k.nazwa, zrodlo: "gus", zapytan: 1, ulepszenie: true });
      else p.pominiete.swieze++;
      continue;
    }
    // a firm whose reading has just failed is not asked again within the hour (no paid loop on a broken record)
    if (k.rejestr_blad && k.rejestr_at && teraz - Date.parse(k.rejestr_at) < 3600000) { p.pominiete.po_bledzie++; continue; }
    if (formaTyp(k.forma) === "krs") {
      // getFirma: 2 requests (basic record + KRS chapter), none when our cache is recent; + 1 for the basic record kept in full
      const z = (stare(cache[digits(k.nip)]) ? 2 : 0) + 1;
      p.pozycje.push({ id: k.id, nazwa: k.nazwa, zrodlo: "krs", zapytan: z }); p.krs_firm++; p.zapytan_rejestr_io += z;
    } else { jdg.push({ id: k.id, nazwa: k.nazwa, zrodlo: "gus", zapytan: 1 }); p.gus_firm++; p.zapytan_gus++; }
  }
  p.pozycje.push(...jdg);
  for (const u of ulepszenia) { p.pozycje.push(u); p.gus_firm++; p.zapytan_gus++; p.ulepszen++; }
  p.koszt_zl = Math.round(p.zapytan_rejestr_io * CENA_REJESTR_IO * 100) / 100;
  return p;
}

// ---------------------------------------------------------------- warnings from the register (every portal user sees them)
export function ostrzezeniaRejestru(k: Any, rej: Any | null, teraz: number, szczegoly = true): string[] {
  const o: string[] = [];
  if (!k.w_arkuszu && k.status !== "zakonczony") o.push("Klient został usunięty z listy klientów, a obsługa nie jest oznaczona jako zakończona.");
  if (!nipOk(digits(k.nip))) { if (k.status !== "zakonczony") o.push("Brak NIP klienta — nie można sprawdzić rejestru."); return o; }
  if (k.rejestr_blad) o.push("Ostatnie pobranie z rejestru nie powiodło się" + (szczegoly ? ": " + k.rejestr_blad : "."));
  if (!rej) { if (!k.rejestr_blad) o.push("Dane z rejestru nie zostały jeszcze pobrane."); return o; }
  if (!rej.znaleziono) {
    // MF lists VAT payers only: a firm it does not know may well exist
    o.push(rej.zrodlo === "krs" ? "Nie znaleziono firmy w KRS pod tym NIP." : rej.zrodlo === "ceidg" ? "Nie znaleziono firmy w CEIDG pod tym NIP."
      : rej.zrodlo === "mf" ? "Brak w wykazie podatników VAT (MF) — to nie oznacza, że firma nie istnieje; pełne dane po podłączeniu CEIDG." : "Nie znaleziono firmy w rejestrze REGON pod tym NIP.");
    return o;
  }
  if (rej.stan && rej.stan !== "aktywna") o.push("Stan firmy według rejestru: " + rej.stan + ".");
  const a = nazwaKlucz(k.nazwa), b = nazwaKlucz(rej.nazwa);
  if (a && b && a !== b && !nazwaZawiera(a, b)) o.push("Nazwa klienta różni się od nazwy w rejestrze („" + rej.nazwa + "”).");
  if (rej.zrodlo === "krs" && formaTyp(k.forma) === "krs" && !(rej.zarzad ?? []).length) o.push("W rejestrze nie ma nikogo w organie reprezentacji.");
  const zm = Array.isArray(rej.zmiany) ? rej.zmiany : [];
  // a change found by the last reading stays on the list for 60 days
  if (zm.length && teraz - Date.parse(rej.fetched_at) < 60 * 86400000) o.push("Zmiana w rejestrze od poprzedniego pobrania: " + zm.map((z: Any) => z.pole).join(", ") + ".");
  return o;
}

// ---------------------------------------------------------------- contracts audit
export type Poz = { kod: string; stan: "ok" | "uwaga" | "brak" | "info"; tekst: string };
export type Zakres = { ksiegowosc: boolean; kadry: boolean };
export type Audyt = { wynik: "ok" | "uwagi" | "braki"; zakres: Zakres; ma: { umowa: boolean; ksiegowosc: boolean; kadry: boolean; powierzenie: boolean; pelnomocnictwo: boolean }; pozycje: Poz[] };
// What the office does for a client follows from its caretakers: no accounting
// caretaker (opiekun) — no accounting; no HR caretaker (kadrowy) — no HR and payroll.
export function zakres(k: Any): Zakres {
  return { ksiegowosc: String(k?.opiekun ?? "").trim() !== "", kadry: String(k?.kadrowy ?? "").trim() !== "" };
}
export function zakresOpis(z: Zakres): string {
  return z.ksiegowosc && z.kadry ? "księgowość + kadry" : z.ksiegowosc ? "tylko księgowość" : z.kadry ? "tylko kadry" : "brak opiekunów";
}
const pl = (iso: unknown) => { const p = String(iso ?? "").slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : ""; };
const obejmuje = (u: Any, co: string) => u.rodzaj === co || (Array.isArray(u.obejmuje) && u.obejmuje.includes(co));
const wygasla = (u: Any, dzis: string) => u.bezterminowa !== true && isDate(u.obowiazuje_do) && u.obowiazuje_do < dzis;
const osobaKlucz = (s: unknown) => norm(s).split(" ").filter(Boolean).sort().join(" ");
const taSamaOsoba = (a: string, b: string) => { const A = osobaKlucz(a), B = osobaKlucz(b); return !!A && !!B && (A === B || nazwaZawiera(A, B)); };

// umowy: the client's documents with status 'przypisany'; rejestry: its snapshots, newest first; dzis: YYYY-MM-DD.
// Only a document a person has confirmed (`sprawdzil`) can satisfy an item or cancel a contract; what the
// machine read and nobody checked is reported as "odczyt automatyczny — niepotwierdzony" and leaves the item open.
export function audytKlienta(k: Any, rejestry: Any[], wszystkie: Any[], dzis: string): Audyt {
  const poz: Poz[] = [];
  const rej = rejestry[0] ?? null;
  const z = zakres(k);
  // nobody looks after the client: what should be on file cannot be told — one warning instead of a list of gaps
  if (!z.ksiegowosc && !z.kadry) {
    return { wynik: "uwagi", zakres: z, ma: { umowa: false, ksiegowosc: false, kadry: false, powierzenie: false, pelnomocnictwo: false },
      pozycje: [{ kod: "zakres", stan: "uwaga", tekst: "Brak opiekuna i kadrowej — zakres obsługi nieokreślony. Uzupełnij opiekunów w danych klienta albo zakończ obsługę." }] };
  }
  const czego = z.ksiegowosc && z.kadry ? "księgowych i kadrowo-płacowych" : z.ksiegowosc ? "księgowych" : "kadrowo-płacowych";
  const umowy = wszystkie.filter((u) => !!u.sprawdzil), auto = wszystkie.filter((u) => !u.sprawdzil);
  const AUTO = " — odczyt automatyczny — niepotwierdzony; otwórz dokument i zatwierdź.";
  const autoUsl = auto.filter((u) => u.rodzaj !== "wypowiedzenie" && u.rodzaj !== "aneks" && (obejmuje(u, "ksiegowosc") || obejmuje(u, "kadry")));
  const uslugowe = umowy.filter((u) => u.rodzaj !== "wypowiedzenie" && u.rodzaj !== "aneks" && (obejmuje(u, "ksiegowosc") || obejmuje(u, "kadry")));
  const wypow = umowy.filter((u) => u.rodzaj === "wypowiedzenie");
  // a notice of termination filed later than the contract (or undated) puts the contract in doubt
  const wypowiedziana = (u: Any) => wypow.find((w) => !isDate(w.data_zawarcia) || !isDate(u.data_zawarcia) || w.data_zawarcia >= u.data_zawarcia);
  const czynne = uslugowe.filter((u) => !wygasla(u, dzis) && !wypowiedziana(u));
  const opis = (u: Any) => (isDate(u.data_zawarcia) ? "z dnia " + pl(u.data_zawarcia) : "bez odczytanej daty");

  // 1. a service contract at all
  if (!uslugowe.length) poz.push(autoUsl.length
    ? { kod: "umowa", stan: "uwaga", tekst: "Umowa o świadczenie usług " + opis(autoUsl[0]) + AUTO }
    : { kod: "umowa", stan: "brak", tekst: "Brak umowy o świadczenie usług " + czego + " w bazie." });
  else if (!czynne.length) {
    const u = uslugowe[0], w = wypowiedziana(u);
    poz.push({ kod: "umowa", stan: "brak", tekst: wygasla(u, dzis) ? "Umowa " + opis(u) + " wygasła " + pl(u.obowiazuje_do) + " — brak obowiązującej umowy." : "Do umowy " + opis(u) + " jest wypowiedzenie" + (w && isDate(w.data_zawarcia) ? " z dnia " + pl(w.data_zawarcia) : "") + " — brak obowiązującej umowy." });
  } else {
    poz.push({ kod: "umowa", stan: "ok", tekst: "Umowa o świadczenie usług: " + czynne.map(opis).join("; ") + (czynne.every((u) => u.bezterminowa === true) ? " (na czas nieokreślony)" : "") + "." });
    for (const u of uslugowe.filter((x) => !czynne.includes(x))) poz.push({ kod: "waznosc", stan: "info", tekst: "W bazie jest też umowa " + opis(u) + (wygasla(u, dzis) ? ", która wygasła " + pl(u.obowiazuje_do) : ", do której jest wypowiedzenie") + "." });
    for (const u of czynne) if (u.bezterminowa !== true && isDate(u.obowiazuje_do) && Date.parse(u.obowiazuje_do) - Date.parse(dzis) <= 60 * 86400000) poz.push({ kod: "waznosc", stan: "uwaga", tekst: "Umowa " + opis(u) + " obowiązuje tylko do " + pl(u.obowiazuje_do) + "." });
  }
  const maKs = czynne.some((u) => obejmuje(u, "ksiegowosc")), maKd = czynne.some((u) => obejmuje(u, "kadry"));
  // the contracts in force against the scope of service: required only for what the office actually does
  if (czynne.length) {
    if (z.ksiegowosc && !maKs) poz.push({ kod: "ksiegowosc", stan: "brak", tekst: "Brak umowy obejmującej usługi księgowe — klient ma opiekuna księgowego, a żadna obowiązująca umowa ich nie obejmuje." });
    if (z.kadry && !maKd) poz.push({ kod: "kadry", stan: "brak", tekst: "Brak umowy obejmującej obsługę kadrowo-płacową — klient ma kadrową, a żadna obowiązująca umowa jej nie obejmuje." });
    if (!z.ksiegowosc && maKs) poz.push({ kod: "ksiegowosc", stan: "uwaga", tekst: "Umowa obejmuje księgowość, a klient nie ma opiekuna księgowego — uzupełnij opiekuna w danych klienta albo sprawdź zakres umowy." });
    if (!z.kadry && maKd) poz.push({ kod: "kadry", stan: "uwaga", tekst: "Umowa obejmuje kadry i płace, a klient nie ma kadrowej — uzupełnij kadrową w danych klienta albo sprawdź zakres umowy." });
  }

  // 2. entrusting personal data (art. 28 ust. 3 RODO): a separate contract or a clause in the service contract
  const jestPow = (u: Any) => u.rodzaj !== "wypowiedzenie" && obejmuje(u, "powierzenie") && !wygasla(u, dzis);
  const pow = umowy.filter(jestPow), autoPow = auto.filter(jestPow);
  poz.push(pow.length
    ? { kod: "powierzenie", stan: "ok", tekst: "Powierzenie przetwarzania danych osobowych: " + pow.map((u) => (u.rodzaj === "powierzenie" ? "umowa " : "postanowienia w umowie ") + opis(u)).join("; ") + "." }
    : autoPow.length ? { kod: "powierzenie", stan: "uwaga", tekst: "Powierzenie przetwarzania danych osobowych (dokument " + opis(autoPow[0]) + ")" + AUTO }
    : { kod: "powierzenie", stan: "brak", tekst: "Brak umowy powierzenia przetwarzania danych osobowych (art. 28 ust. 3 RODO)." });

  // 3. powers of attorney and authorisations
  const jestPeln = (u: Any) => u.rodzaj === "pelnomocnictwo" || u.rodzaj === "upowaznienie";
  const peln = umowy.filter(jestPeln), autoPeln = auto.filter(jestPeln);
  poz.push(peln.length
    ? { kod: "pelnomocnictwo", stan: "ok", tekst: "Pełnomocnictwa / upoważnienia w bazie: " + peln.map((u) => (u.podtyp || (u.rodzaj === "upowaznienie" ? "upoważnienie" : "pełnomocnictwo")) + (isDate(u.data_zawarcia) ? " (" + pl(u.data_zawarcia) + ")" : "")).join(", ") + "." }
    : autoPeln.length ? { kod: "pelnomocnictwo", stan: "uwaga", tekst: "Pełnomocnictwa / upoważnienia (" + autoPeln.length + ")" + AUTO }
    : { kod: "pelnomocnictwo", stan: "uwaga", tekst: "Brak pełnomocnictw i upoważnień w bazie (UPL-1, ZUS PEL, e-Urząd / KSeF)." });
  // a notice of termination nobody has confirmed cancels nothing — it is only pointed out
  if (auto.some((u) => u.rodzaj === "wypowiedzenie")) poz.push({ kod: "wypowiedzenie", stan: "uwaga", tekst: "W bazie jest wypowiedzenie / rozwiązanie umowy" + AUTO });

  // 4.–6. the newest contract in force against the register
  const u = [...czynne].sort((a, b) => String(b.data_zawarcia ?? "").localeCompare(String(a.data_zawarcia ?? "")))[0];
  if (u) {
    if (u.podpisy && u.podpisy !== "obie_strony") poz.push({ kod: "podpisy", stan: "uwaga", tekst: "Umowa " + opis(u) + ": według odczytu " + ({ tylko_klient: "podpisał tylko klient", tylko_biuro: "podpisało tylko biuro", brak: "brak podpisów", nieczytelne: "podpisów nie da się ocenić" } as Any)[u.podpisy] + "." });
    const nipU = digits(u.kontrahent_nip), nipK = digits(k.nip);
    if (nipOk(nipU) && nipK.length === 10 && nipU !== nipK) poz.push({ kod: "strony", stan: "brak", tekst: "Umowa " + opis(u) + " jest zawarta z podmiotem o innym NIP (" + nipU + ") niż klient." });
    else if (!rej || !rej.znaleziono) poz.push({ kod: "strony", stan: "info", tekst: "Stron umowy nie porównano z rejestrem — brak danych z rejestru." });
    else {
      const a = nazwaKlucz(u.kontrahent), b = nazwaKlucz(rej.nazwa), c = nazwaKlucz(k.nazwa);
      const krsU = digits(u.kontrahent_krs).replace(/^0+/, ""), krsR = digits(rej.krs).replace(/^0+/, "");
      if (krsU && krsR && krsU !== krsR) poz.push({ kod: "strony", stan: "uwaga", tekst: "Numer KRS w umowie (" + u.kontrahent_krs + ") różni się od numeru w rejestrze (" + rej.krs + ")." });
      else if (!a) poz.push({ kod: "strony", stan: "uwaga", tekst: "Nie odczytano nazwy klienta z umowy " + opis(u) + " — do sprawdzenia." });
      else if (a === b || nazwaZawiera(a, b) || (zJdg(rej.zrodlo) && (a === c || nazwaZawiera(a, c)))) poz.push({ kod: "strony", stan: "ok", tekst: "Strona umowy zgodna z rejestrem (" + rej.nazwa + ")." });
      else poz.push({ kod: "strony", stan: "uwaga", tekst: "Nazwa klienta w umowie („" + u.kontrahent + "”) różni się od aktualnej nazwy w rejestrze („" + rej.nazwa + "”) — do sprawdzenia (zmiana firmy, przekształcenie?)." });

      // who signed: the register as it stood on the day of signing, when one of our snapshots covers that day
      const podp: string[] = (Array.isArray(u.reprezentanci) ? u.reprezentanci : []).map((r: Any) => String(r.imie_nazwisko ?? "")).filter(Boolean);
      if (!podp.length) poz.push({ kod: "reprezentacja", stan: "uwaga", tekst: "Nie odczytano, kto podpisał umowę za klienta — do sprawdzenia." });
      else if (zJdg(rej.zrodlo)) {
        const wl = podp.some((p) => nazwaZawiera(osobaKlucz(p), norm(rej.nazwa)) || nazwaZawiera(osobaKlucz(p), norm(k.nazwa)));
        poz.push(wl ? { kod: "reprezentacja", stan: "ok", tekst: "Umowę podpisał przedsiębiorca (" + podp.join(", ") + ")." }
          : { kod: "reprezentacja", stan: "uwaga", tekst: "Umowę podpisał(a) " + podp.join(", ") + " — nazwisko nie występuje w nazwie firmy; sprawdź pełnomocnictwo." });
      } else {
        const zDnia = isDate(u.data_zawarcia) ? rejestry.find((r) => r.znaleziono && String(r.fetched_at).slice(0, 10) <= u.data_zawarcia && String(r.sprawdzono_at).slice(0, 10) >= u.data_zawarcia) : null;
        const r = zDnia ?? rej;
        const uprawnieni: string[] = [...(r.zarzad ?? []).map(osoba), ...(r.prokurenci ?? []).map(osoba)];
        const obcy = podp.filter((p) => !uprawnieni.some((x) => taSamaOsoba(p, x)));
        const lacznie = /łączn|lacznie|dwóch|dwoch|dwaj|dwoje|wspólnie|wspolnie/i.test(String(r.reprezentacja ?? "")) && (r.zarzad ?? []).length > 1;
        const kiedy = zDnia ? "według stanu rejestru na dzień podpisania" : "według aktualnego stanu rejestru (z " + pl(r.sprawdzono_at ?? r.fetched_at) + ")";
        if (obcy.length) poz.push({ kod: "reprezentacja", stan: "uwaga", tekst: "Podpisujący (" + obcy.join(", ") + ") nie figuruje w organie reprezentacji ani wśród prokurentów " + kiedy + " — do sprawdzenia (odpis na dzień podpisania, pełnomocnictwo)." });
        else if (lacznie && podp.length < 2) poz.push({ kod: "reprezentacja", stan: "uwaga", tekst: "Umowę podpisała jedna osoba (" + podp.join(", ") + "), a sposób reprezentacji wskazuje na działanie łączne — do sprawdzenia." });
        else if (zDnia) poz.push({ kod: "reprezentacja", stan: "ok", tekst: "Podpisujący (" + podp.join(", ") + ") uprawniony do reprezentacji " + kiedy + "." });
        else poz.push({ kod: "reprezentacja", stan: "info", tekst: "Podpisujący (" + podp.join(", ") + ") figuruje w rejestrze " + kiedy + "; stanu na dzień podpisania" + (isDate(u.data_zawarcia) ? " (" + pl(u.data_zawarcia) + ")" : "") + " portal nie zna — w razie wątpliwości sprawdź odpis pełny." });
      }
    }
  }
  const wynik = poz.some((p) => p.stan === "brak") ? "braki" : poz.some((p) => p.stan === "uwaga") ? "uwagi" : "ok";
  // `umowa`: everything the office does for the client is covered by a contract in force
  return { wynik, zakres: z, ma: { umowa: (!z.ksiegowosc || maKs) && (!z.kadry || maKd), ksiegowosc: maKs, kadry: maKd, powierzenie: pow.length > 0, pelnomocnictwo: peln.length > 0 }, pozycje: poz };
}

// ---------------------------------------------------------------- CSV (opens in Excel: ';', UTF-8 with BOM added by the page)
export function csvPole(v: unknown): string {
  let s = v == null ? "" : String(v);
  // a cell starting with = + - @ (also after spaces, a tab or a line break) would run as a formula
  if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export const csvWiersz = (pola: unknown[]) => pola.map(csvPole).join(";");
const STATUS: Any = { obslugiwany: "obsługiwany", wstrzymany: "wstrzymany", zakonczony: "zakończony" };
export function csvBraki(wiersze: Array<{ k: Any; a: Audyt; tg?: string }>): string {
  const tak = (b: boolean) => (b ? "tak" : "NIE");
  // outside the scope of service a missing contract is not a gap
  const wZakresie = (w: boolean, b: boolean) => (w ? tak(b) : b ? "tak (poza zakresem)" : "nie dotyczy");
  const out = [csvWiersz(["Klient", "NIP", "Forma", "Opiekun", "Kadrowy", "Zakres obsługi", "Status obsługi", "Wynik audytu", "Umowy na cały zakres", "Umowa — księgowość", "Umowa — kadry", "Powierzenie danych", "Pełnomocnictwa", "Telegram", "Braki", "Uwagi do sprawdzenia"])];
  for (const { k, a, tg } of wiersze) {
    const nikt = !a.zakres.ksiegowosc && !a.zakres.kadry;
    out.push(csvWiersz([k.nazwa, k.nip ?? "", k.forma ?? "", k.opiekun ?? "", k.kadrowy ?? "", zakresOpis(a.zakres), STATUS[k.status] ?? k.status,
      a.wynik === "ok" ? "w porządku" : a.wynik, nikt ? "nie dotyczy" : tak(a.ma.umowa), wZakresie(a.zakres.ksiegowosc, a.ma.ksiegowosc), wZakresie(a.zakres.kadry, a.ma.kadry), nikt ? "nie dotyczy" : tak(a.ma.powierzenie), nikt ? "nie dotyczy" : tak(a.ma.pelnomocnictwo), tg ?? "",
      a.pozycje.filter((p) => p.stan === "brak").map((p) => p.tekst).join(" | "), a.pozycje.filter((p) => p.stan === "uwaga").map((p) => p.tekst).join(" | ")]));
  }
  return out.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- editing a client (the portal is the master of the list)
export const FORMY_LISTA = ["JDG", "spółka z o.o.", "spółka cywilna", "spółka jawna", "spółka partnerska", "spółka komandytowa", "spółka komandytowo-akcyjna", "prosta spółka akcyjna", "spółka akcyjna", "fundacja", "stowarzyszenie", "spółdzielnia", "inna"];
export const JEZYKI_LISTA = ["Polish", "Ukrainian", "Russian", "English"];
export const POLA_KLIENTA: Array<[string, string, number]> = [
  ["nazwa", "nazwa", 200], ["nip", "NIP", 20], ["forma", "forma prawna", 60], ["opodatkowanie", "opodatkowanie", 100], ["adres", "adres", 300], ["miasto", "miasto", 120],
  ["kontakt", "osoba kontaktowa", 200], ["telefon", "telefon", 100], ["email", "e-mail", 400], ["opiekun", "opiekun (księgowość)", 60], ["kadrowy", "kadrowa / kadrowy", 60],
  ["telegram", "grupa Telegram (id czatu)", 30], ["jezyk", "język", 30],
];
// one line of text: no control characters, single spaces
const linia = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const mailOk = (s: string) => /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]{2,}$/.test(s);

// What an administrator typed -> the row to store, or the list of what is wrong with it.
export function walidujKlienta(wej: Any): { dane: Record<string, string>; bledy: string[] } {
  const d: Record<string, string> = {}, bledy: string[] = [];
  for (const [p, , n] of POLA_KLIENTA) d[p] = linia(wej?.[p], n);
  if (d.nazwa.length < 2) bledy.push("Podaj nazwę klienta.");
  if (/^nazwa:/i.test(d.nazwa)) bledy.push("Nazwa nie może zaczynać się od „nazwa:”.");
  d.nip = d.nip.replace(/^PL/i, "").replace(/[\s-]/g, "");
  if (d.nip && !nipOk(d.nip)) bledy.push("NIP jest nieprawidłowy (10 cyfr, zgodna cyfra kontrolna).");
  if (d.forma && !FORMY_LISTA.includes(d.forma)) bledy.push("Wybierz formę prawną z listy.");
  if (d.jezyk && !JEZYKI_LISTA.includes(d.jezyk)) bledy.push("Wybierz język z listy.");
  // several addresses may be given, separated by a comma, a semicolon or a space
  const maile = d.email.split(/[;,\s]+/).filter(Boolean);
  if (maile.length > 6) bledy.push("Najwyżej 6 adresów e-mail.");
  for (const m of maile) if (!mailOk(m)) bledy.push("Nieprawidłowy adres e-mail: " + m.slice(0, 60));
  d.email = maile.join("; ");
  if (d.telefon && !/^[0-9+ ()\/;,.\-]{5,100}$/.test(d.telefon)) bledy.push("Telefon może zawierać tylko cyfry, spacje i znaki + ( ) - / ; ,");
  // a group's chat id is a negative number (supergroups: -100…); the client's private chat would be positive
  if (d.telegram && !/^-?\d{5,20}$/.test(d.telegram)) bledy.push("Id czatu Telegram to liczba (dla grupy ujemna, np. -1001234567890).");
  return { dane: d, bledy };
}
// what changes between the stored row and the new one: [{pole, bylo, jest}] with the fields' Polish names
export function zmianyKlienta(stare: Any, nowe: Record<string, string>): Zmiana[] {
  const out: Zmiana[] = [];
  for (const [p, et] of POLA_KLIENTA) {
    const a = linia(stare?.[p], 1000), b = nowe[p] ?? "";
    if (a !== b) out.push({ pole: et, bylo: a || "—", jest: b || "—" });
  }
  return out;
}
