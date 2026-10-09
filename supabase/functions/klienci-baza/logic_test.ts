// deno test supabase/functions/klienci-baza/logic_test.ts
// Fictional firms and people only.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  audytKlienta, bezDanychOsobowych, csvBraki, zakres, zakresOpis, csvPole, dopasuj, formaTyp, klientId, nazwaKlucz, nipOk, odcisk, ostrzezeniaRejestru, pewnyKlient,
  planOdswiezenia, roznice, stanFirmy, wyciagGus, wyciagKrs,
} from "./logic.ts";

// a NIP with a correct check digit, made from 9 digits
function nip(base: string): string {
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const s = w.reduce((a, x, i) => a + x * Number(base[i]), 0) % 11;
  if (s === 10) throw new Error("zła baza");
  return base + s;
}
const N1 = nip("999000001"), N2 = nip("999000002"), N3 = nip("999000013");
const ALFA = { id: N1, nip: N1, nazwa: "Przykładowa Alfa sp. z o.o.", krs: "0000999001", rej_nazwa: "PRZYKŁADOWA ALFA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" };
const BETA = { id: N2, nip: N2, nazwa: "Przykładowa Beta sp. z o.o.", krs: "0000999002", rej_nazwa: "PRZYKŁADOWA BETA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" };
const JDG = { id: N3, nip: N3, nazwa: "Usługi Testowe Jan Wzorcowy", krs: null, rej_nazwa: "USŁUGI TESTOWE JAN WZORCOWY" };
const BEZ = { id: "nazwa:przykładowa gamma", nip: "", nazwa: "Przykładowa Gamma", krs: null, rej_nazwa: null };
const KL = [ALFA, BETA, JDG, BEZ];

Deno.test("nipOk, klientId, formaTyp", () => {
  assert(nipOk(N1)); assert(!nipOk("1234567890")); assert(!nipOk("123")); assert(nipOk("7831916366"));
  assertEquals(klientId({ nip: "999-000-00-1" + N1[9], nazwa: "X" }), N1);
  assertEquals(klientId({ nip: "", nazwa: "Przykładowa Gamma" }), "nazwa:przykładowa gamma");
  assertEquals(formaTyp("JDG"), "jdg"); assertEquals(formaTyp("spółka z o.o."), "krs"); assertEquals(formaTyp("Sp. z o.o."), "krs");
  assertEquals(formaTyp("spółka cywilna"), "inne"); assertEquals(formaTyp(""), "inne"); assertEquals(formaTyp("jednoosobowa działalność gospodarcza"), "jdg");
});

Deno.test("nazwaKlucz: forma prawna i interpunkcja nie mają znaczenia", () => {
  assertEquals(nazwaKlucz("PRZYKŁADOWA ALFA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"), nazwaKlucz("Przykładowa „Alfa” Sp. z o.o."));
  assertEquals(nazwaKlucz("Przykładowa Alfa sp. z o.o. w likwidacji"), "przykladowa alfa");
});

Deno.test("dopasuj: NIP + nazwa -> pewny; sam NIP albo sama nazwa -> do sprawdzenia", () => {
  const pelny = dopasuj({ nazwa: "Przykładowa Alfa sp. z o.o.", nip: N1 }, KL);
  assertEquals([pelny[0].id, pelny[0].wynik, pelny[0].numer, pelny[0].nazwaOk, pelny[0].powod], [N1, 100, true, true, "NIP i nazwa"]);
  assertEquals(pewnyKlient(pelny, "wysoka"), N1);
  assertEquals(pewnyKlient(pelny, "niska"), null);
  // the NIP is Alfa's, the name is Beta's: a misread digit or another party's number — a person decides
  const k = dopasuj({ nazwa: "Przykładowa Beta sp. z o.o.", nip: N1 }, KL);
  assertEquals([k[0].id, k[0].numer, k[0].nazwaOk], [N1, true, false]);
  assertEquals(k.find((x) => x.id === N2)?.wynik, 40);
  assertEquals(pewnyKlient(k, "wysoka"), null);
  // the NIP alone, nothing else read
  assertEquals(pewnyKlient(dopasuj({ nazwa: "", nip: N1 }, KL), "wysoka"), null);
  // the register name counts as the name too
  assertEquals(pewnyKlient(dopasuj({ nazwa: "PRZYKŁADOWA ALFA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", nip: N1 }, KL), "srednia"), N1);
  // a sole trader: the NIP and the owner's name inside the firm's name
  assertEquals(pewnyKlient(dopasuj({ nazwa: "Jan Wzorcowy", nip: N3 }, KL), "wysoka"), N3);
});
Deno.test("dopasuj: numer KRS, z zerami i bez — też wymaga nazwy", () => {
  const sam = dopasuj({ nazwa: "", nip: "", krs: "999002" }, KL);
  assertEquals([sam[0].id, sam[0].numer, sam[0].nazwaOk], [N2, true, false]); assertEquals(pewnyKlient(sam, "srednia"), null);
  assertEquals(pewnyKlient(dopasuj({ nazwa: "Przykładowa Beta", nip: "", krs: "0000999002" }, KL), "srednia"), N2);
});
Deno.test("dopasuj: sama nazwa nigdy nie przypisuje, nawet jednoznaczna", () => {
  const k = dopasuj({ nazwa: "PRZYKŁADOWA ALFA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", nip: "" }, KL);
  assertEquals(k.map((x) => [x.id, x.wynik]), [[N1, 70]]);
  assertEquals(pewnyKlient(k, "wysoka"), null);
  const cz = dopasuj({ nazwa: "Jan Wzorcowy" }, KL);
  assertEquals([cz[0].id, cz[0].wynik], [N3, 50]); assertEquals(pewnyKlient(cz, "wysoka"), null);
});
Deno.test("dopasuj: nieprawidłowy NIP z odczytu nie jest używany; nikt nie pasuje -> pusto", () => {
  assertEquals(dopasuj({ nazwa: "Zupełnie Inna Firma", nip: "1234567890" }, KL), []);
  assertEquals(pewnyKlient([], "wysoka"), null);
  const obcy = dopasuj({ nazwa: "Przykładowa Alfa sp. z o.o.", nip: nip("999000024") }, KL);
  assertEquals(obcy[0].wynik, 40); assertEquals(pewnyKlient(obcy, "wysoka"), null);
});
Deno.test("pewnyKlient: klient wskazany przez wgrywającego", () => {
  // one agreeing thing is enough, and only for the client pointed at
  assertEquals(pewnyKlient(dopasuj({ nazwa: "Przykładowa Beta sp. z o.o." }, KL), "wysoka", N2), N2);
  assertEquals(pewnyKlient(dopasuj({ nazwa: "", nip: N2 }, KL), "srednia", N2), N2);
  assertEquals(pewnyKlient(dopasuj({ nazwa: "Przykładowa Beta sp. z o.o." }, KL), "niska", N2), null);
  // the document carries another client's number, or fits nobody
  assertEquals(pewnyKlient(dopasuj({ nazwa: "Przykładowa Alfa sp. z o.o.", nip: N1 }, KL), "wysoka", N2), null);
  assertEquals(pewnyKlient(dopasuj({ nazwa: "Przykładowa Beta sp. z o.o.", nip: N1 }, KL), "wysoka", N2), null);
  assertEquals(pewnyKlient(dopasuj({ nazwa: "Zupełnie Inna" }, KL), "wysoka", N2), null);
  assertEquals(pewnyKlient([], "wysoka", N2), null);
});
Deno.test("bezDanychOsobowych: daty urodzenia i PESEL znikają na każdym poziomie", () => {
  const o = bezDanychOsobowych({ nazwa: "X", zarzad: [{ imie: "ANNA", dataUr: "1980-01-01", pesel: "80010112345" }], a: { b: [{ data_urodzenia: "1980-01-01", PESEL: "1", ok: 1 }] }, n: null });
  assertEquals(o, { nazwa: "X", zarzad: [{ imie: "ANNA" }], a: { b: [{ ok: 1 }] }, n: null } as unknown as typeof o);
});

const FIRMA = {
  found: true, nip: N1, regon: "999000001", krs: "0000999001", nazwa: "PRZYKŁADOWA ALFA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", forma: "Spółka Z Ograniczoną Odpowiedzialnością",
  adres: { ulica: "UL. PRZYKŁADOWA", nrDomu: "1", nrLokalu: "2", kodPocztowy: "00-000", miejscowosc: "WARSZAWA" }, kapital: "5000,00",
  reprezentacja: { organ: "ZARZĄD", sposob: "KAŻDY CZŁONEK ZARZĄDU SAMODZIELNIE", osoby: [] },
  zarzad: [{ imie: "ANNA", nazwisko: "WZORCOWA", dataUr: "1980-01-01", funkcja: "PREZES ZARZĄDU" }],
  wspolnicy: [{ imie: "ANNA", nazwisko: "WZORCOWA", dataUr: "1980-01-01", udzialy: 100, udzialyOpis: "100 UDZIAŁÓW" }], prokurenci: [], v: 2,
};
Deno.test("wyciagKrs: kolumny z odpowiedzi getFirma i rekordu podstawowego", () => {
  const w = wyciagKrs(FIRMA, { krs_wpisy: { pierwszy_data: "2019-03-04" }, stan: { czy_wykreslona: false, pkd_przewazajace_dzial: "Działalność rachunkowo-księgowa" } });
  assertEquals(w.adres, "UL. PRZYKŁADOWA 1/2, 00-000 WARSZAWA"); assertEquals(w.kapital, 5000); assertEquals(w.data_rejestracji, "2019-03-04");
  assertEquals(w.zarzad, [{ imie: "ANNA", nazwisko: "WZORCOWA", funkcja: "PREZES ZARZĄDU" }]); // no birth date in the extract
  assertEquals(w.stan, "aktywna"); assertEquals(w.pkd, "Działalność rachunkowo-księgowa");
  assertEquals(wyciagKrs({ found: false }).znaleziono, false);
  assertEquals(stanFirmy("PRZYKŁADOWA ALFA SP. Z O.O. W LIKWIDACJI", null), "w likwidacji");
  assertEquals(stanFirmy("X", { stan: { czy_wykreslona: true } }), "wykreślona");
  assertEquals(stanFirmy("PRZYKŁADOWA SP. Z O.O. W UPADŁOŚCI", null), "w upadłości");
  assertEquals(stanFirmy("X", { stan: { w_zawieszeniu: true, w_likwidacji: false, w_upadlosci: false, czy_wykreslona: false } }), "zawieszona");
});
Deno.test("wyciagGus", () => {
  const w = wyciagGus({ success: true, nazwa: "USŁUGI TESTOWE JAN WZORCOWY", regon: "999000013", adres: "ul. Przykładowa 1 /2 00-000 Warszawa" });
  assertEquals(w.znaleziono, true); assertEquals(w.adres, "ul. Przykładowa 1/2 00-000 Warszawa"); assertEquals(w.stan, "aktywna"); assertEquals(w.zarzad, []);
  assertEquals(wyciagGus({ success: false }).znaleziono, false);
});
Deno.test("roznice: zmiana zarządu, adresu; brak zmian -> ten sam odcisk", () => {
  const a = wyciagKrs(FIRMA), b = wyciagKrs(JSON.parse(JSON.stringify(FIRMA)));
  assertEquals(odcisk(a), odcisk(b)); assertEquals(roznice(a, b), []); assertEquals(roznice(null, a), []);
  const c = wyciagKrs({ ...FIRMA, zarzad: [{ imie: "PIOTR", nazwisko: "PRZYKŁADOWY", funkcja: "PREZES ZARZĄDU" }], adres: { ...FIRMA.adres, nrDomu: "7" } });
  const zm = roznice(a, c);
  assertEquals(zm.map((z) => z.pole), ["adres siedziby", "skład organu reprezentacji"]);
  assertEquals(zm[1], { pole: "skład organu reprezentacji", bylo: "ANNA WZORCOWA — prezes zarządu", jest: "PIOTR PRZYKŁADOWY — prezes zarządu" });
  assert(odcisk(a) !== odcisk(c));
  // a field the register did not return this time is not reported as a change
  assertEquals(roznice(a, { ...a, kapital: null }), []);
  assertEquals(roznice(a, wyciagKrs({ ...FIRMA, nazwa: FIRMA.nazwa + " W LIKWIDACJI" })).map((z) => z.pole), ["nazwa", "stan firmy"]);
});

Deno.test("planOdswiezenia: liczba zapytań i koszt", () => {
  const teraz = Date.parse("2026-10-09T10:00:00Z"), dzien = 86400000;
  const kl = [
    { id: N1, nip: N1, nazwa: "A", forma: "spółka z o.o.", status: "obslugiwany", rej_at: null },                                   // 3 requests
    { id: N2, nip: N2, nazwa: "B", forma: "spółka z o.o.", status: "obslugiwany", rej_at: null },                                   // in our cache: 1
    { id: N3, nip: N3, nazwa: "C", forma: "JDG", status: "wstrzymany", rej_at: null },                                              // GUS
    { id: "nazwa:d", nip: "", nazwa: "D", forma: "JDG", status: "obslugiwany", rej_at: null },                                      // no NIP
    { id: nip("999000024"), nip: nip("999000024"), nazwa: "E", forma: "JDG", status: "obslugiwany", rej_at: new Date(teraz - 5 * dzien).toISOString() },  // fresh
    { id: nip("999000035"), nip: nip("999000035"), nazwa: "F", forma: "spółka z o.o.", status: "zakonczony", koniec_od: "2026-01-31", rej_at: null },
    { id: nip("999000046"), nip: nip("999000046"), nazwa: "G", forma: "spółka z o.o.", status: "obslugiwany", rej_at: null, rejestr_blad: "x", rejestr_at: new Date(teraz - 60000).toISOString() },
  ];
  const p = planOdswiezenia(kl, { [N2]: new Date(teraz - dzien).toISOString() }, 30, teraz);
  assertEquals(p.pozycje.map((x) => [x.nazwa, x.zrodlo, x.zapytan]), [["A", "krs", 3], ["B", "krs", 1], ["C", "gus", 1]]);
  assertEquals(p.pominiete, { swieze: 1, bez_nip: 1, zakonczone: 1, po_bledzie: 1 });
  assertEquals([p.zapytan_rejestr_io, p.zapytan_gus, p.koszt_zl], [4, 1, 0.2]);
  assertEquals(planOdswiezenia(kl, {}, 30, teraz, true).pozycje.length, 4);
  assertEquals(planOdswiezenia(kl, {}, 3, teraz).pominiete.swieze, 0);
});

// ---------------------------------------------------------------- audit
const K = { id: N1, nip: N1, nazwa: "Przykładowa Alfa sp. z o.o.", forma: "spółka z o.o.", opiekun: "Księgowa Testowa", kadrowy: "", status: "obslugiwany", w_arkuszu: true };
const REJ = { ...wyciagKrs(FIRMA), zrodlo: "krs", fetched_at: "2026-10-01T08:00:00Z", sprawdzono_at: "2026-10-08T08:00:00Z", zmiany: [] };
const UM = (x: Record<string, unknown>) => ({ status: "przypisany", sprawdzil: "admin@example.test", klient: N1, rodzaj: "ksiegowosc", obejmuje: ["ksiegowosc"], data_zawarcia: "2024-01-15", bezterminowa: true, obowiazuje_do: null, podpisy: "obie_strony",
  kontrahent: "Przykładowa Alfa Sp. z o.o.", kontrahent_nip: N1, kontrahent_krs: "0000999001", reprezentanci: [{ imie_nazwisko: "Anna Wzorcowa", funkcja: "prezes zarządu" }], ...x });
const stan = (a: ReturnType<typeof audytKlienta>, kod: string) => a.pozycje.find((p) => p.kod === kod)?.stan;
const DZIS = "2026-10-09";

Deno.test("audyt: brak dokumentów -> braki", () => {
  const a = audytKlienta(K, [REJ], [], DZIS);
  assertEquals(a.wynik, "braki"); assertEquals(stan(a, "umowa"), "brak"); assertEquals(stan(a, "powierzenie"), "brak"); assertEquals(stan(a, "pelnomocnictwo"), "uwaga");
  assertEquals(a.ma, { umowa: false, ksiegowosc: false, kadry: false, powierzenie: false, pelnomocnictwo: false });
});
Deno.test("audyt: komplet -> ok; podpisujący w aktualnym rejestrze to tylko informacja", () => {
  const a = audytKlienta(K, [REJ], [UM({ obejmuje: ["ksiegowosc", "powierzenie"] }), UM({ rodzaj: "pelnomocnictwo", obejmuje: [], podtyp: "UPL-1" })], DZIS);
  assertEquals(a.wynik, "ok"); assertEquals(stan(a, "umowa"), "ok"); assertEquals(stan(a, "powierzenie"), "ok"); assertEquals(stan(a, "strony"), "ok");
  assertEquals(stan(a, "reprezentacja"), "info");
  assertEquals(a.ma, { umowa: true, ksiegowosc: true, kadry: false, powierzenie: true, pelnomocnictwo: true });
});
Deno.test("audyt: odrębna umowa powierzenia; kadrowy bez umowy kadrowej", () => {
  const a = audytKlienta({ ...K, kadrowy: "Kadrowa Testowa" }, [REJ], [UM({}), UM({ rodzaj: "powierzenie", obejmuje: ["powierzenie"] }), UM({ rodzaj: "upowaznienie", obejmuje: [], podtyp: "KSeF" })], DZIS);
  assertEquals(stan(a, "powierzenie"), "ok"); assertEquals(stan(a, "kadry"), "brak"); assertEquals(a.wynik, "braki"); assertEquals(a.ma.umowa, false);
  // a contract for payroll only is a service contract too
  const b = audytKlienta({ ...K, opiekun: "" , kadrowy: "Kadrowa Testowa" }, [REJ], [UM({ rodzaj: "kadry", obejmuje: ["kadry", "powierzenie"] })], DZIS);
  assertEquals(b.ma.kadry, true); assertEquals(stan(b, "umowa"), "ok"); assertEquals(stan(b, "kadry"), undefined);
});
Deno.test("audyt: zakres obsługi z opiekunów — umowa wymagana tylko na to, co biuro faktycznie prowadzi", () => {
  const KS = { ...K, opiekun: "Księgowa Testowa", kadrowy: "" }, KD = { ...K, opiekun: "", kadrowy: "Kadrowa Testowa" }, OBA = { ...K, kadrowy: "Kadrowa Testowa" }, NIKT = { ...K, opiekun: " ", kadrowy: "" };
  const ksieg = UM({ obejmuje: ["ksiegowosc", "powierzenie"] }), kadr = UM({ rodzaj: "kadry", obejmuje: ["kadry", "powierzenie"] });
  assertEquals([zakres(KS), zakres(KD), zakres(OBA), zakres(NIKT)].map(zakresOpis), ["tylko księgowość", "tylko kadry", "księgowość + kadry", "brak opiekunów"]);
  // HR only: an HR contract is enough, nothing is asked about accounting
  let a = audytKlienta(KD, [REJ], [kadr], DZIS);
  assertEquals([a.zakres, a.ma.umowa, stan(a, "umowa"), stan(a, "ksiegowosc"), stan(a, "kadry"), stan(a, "powierzenie")], [{ ksiegowosc: false, kadry: true }, true, "ok", undefined, undefined, "ok"]);
  // HR only, nothing on file: one gap, named after what is done
  a = audytKlienta(KD, [REJ], [], DZIS);
  assertEquals([stan(a, "umowa"), stan(a, "powierzenie"), a.ma.umowa], ["brak", "brak", false]);
  assert(a.pozycje.find((p) => p.kod === "umowa")!.tekst.includes("usług kadrowo-płacowych")); assert(!a.pozycje.find((p) => p.kod === "umowa")!.tekst.includes("księgow"));
  // HR only, but the only contract is for accounting: HR is missing, and the contract disagrees with the sheet
  a = audytKlienta(KD, [REJ], [ksieg], DZIS);
  assertEquals([stan(a, "kadry"), stan(a, "ksiegowosc"), a.ma.umowa, a.wynik], ["brak", "uwaga", false, "braki"]);
  assert(a.pozycje.find((p) => p.kod === "ksiegowosc")!.tekst.includes("Umowa obejmuje księgowość, a klient nie ma opiekuna"));
  // accounting only: an accounting contract is enough; one that also covers HR is pointed out
  a = audytKlienta(KS, [REJ], [ksieg], DZIS);
  assertEquals([a.ma.umowa, stan(a, "kadry"), stan(a, "ksiegowosc")], [true, undefined, undefined]);
  assertEquals(stan(audytKlienta(KS, [REJ], [UM({ obejmuje: ["ksiegowosc", "kadry", "powierzenie"] })], DZIS), "kadry"), "uwaga");
  // both: each needs its contract (one document may cover both)
  a = audytKlienta(OBA, [REJ], [ksieg], DZIS);
  assertEquals([stan(a, "kadry"), a.ma.umowa, a.ma.ksiegowosc], ["brak", false, true]);
  assertEquals(audytKlienta(OBA, [REJ], [ksieg, kadr], DZIS).ma.umowa, true);
  assertEquals(audytKlienta(OBA, [REJ], [UM({ obejmuje: ["ksiegowosc", "kadry", "powierzenie"] })], DZIS).ma, { umowa: true, ksiegowosc: true, kadry: true, powierzenie: true, pelnomocnictwo: false });
  // nobody: a single warning, no contract gaps — whatever is on file
  for (const dok of [[], [ksieg, kadr]]) {
    a = audytKlienta(NIKT, [REJ], dok, DZIS);
    assertEquals([a.wynik, a.pozycje.length, a.pozycje[0].kod, a.pozycje[0].stan, a.zakres], ["uwagi", 1, "zakres", "uwaga", { ksiegowosc: false, kadry: false }]);
    assert(a.pozycje[0].tekst.startsWith("Brak opiekuna i kadrowej — zakres obsługi nieokreślony"));
  }
});
Deno.test("audyt: umowa wygasła albo wypowiedziana -> brak obowiązującej", () => {
  const w = audytKlienta(K, [REJ], [UM({ bezterminowa: false, obowiazuje_do: "2026-06-30" })], DZIS);
  assertEquals(stan(w, "umowa"), "brak"); assertEquals(w.ma.umowa, false);
  const t = audytKlienta(K, [REJ], [UM({}), UM({ rodzaj: "wypowiedzenie", obejmuje: [], data_zawarcia: "2026-08-01" })], DZIS);
  assertEquals(stan(t, "umowa"), "brak");
  // a new contract signed after the notice stands
  const n = audytKlienta(K, [REJ], [UM({}), UM({ rodzaj: "wypowiedzenie", obejmuje: [], data_zawarcia: "2025-08-01" }), UM({ data_zawarcia: "2025-09-01" })], DZIS);
  assertEquals(stan(n, "umowa"), "ok"); assertEquals(stan(n, "waznosc"), "info");
  // ends within 60 days
  assertEquals(stan(audytKlienta(K, [REJ], [UM({ bezterminowa: false, obowiazuje_do: "2026-11-30" })], DZIS), "waznosc"), "uwaga");
  // an annex alone is not a contract
  assertEquals(stan(audytKlienta(K, [REJ], [UM({ rodzaj: "aneks" })], DZIS), "umowa"), "brak");
});
Deno.test("audyt: dokument z odczytu automatycznego, niepotwierdzony przez człowieka, niczego nie zalicza ani nie unieważnia", () => {
  const AUTO = { sprawdzil: null };
  const a = audytKlienta(K, [REJ], [UM({ ...AUTO, obejmuje: ["ksiegowosc", "powierzenie"] }), UM({ ...AUTO, rodzaj: "pelnomocnictwo", obejmuje: [], podtyp: "UPL-1" })], DZIS);
  assertEquals(a.ma, { umowa: false, ksiegowosc: false, kadry: false, powierzenie: false, pelnomocnictwo: false });
  assertEquals([stan(a, "umowa"), stan(a, "powierzenie"), stan(a, "pelnomocnictwo"), a.wynik], ["uwaga", "uwaga", "uwaga", "uwagi"]);
  for (const kod of ["umowa", "powierzenie", "pelnomocnictwo"]) assert(a.pozycje.find((p) => p.kod === kod)!.tekst.includes("odczyt automatyczny — niepotwierdzony"), kod);
  assertEquals(stan(a, "strony"), undefined); // nothing confirmed to compare with the register
  // an unconfirmed notice of termination does not cancel a confirmed contract — it is only pointed out
  const b = audytKlienta(K, [REJ], [UM({ obejmuje: ["ksiegowosc", "powierzenie"] }), UM({ ...AUTO, rodzaj: "wypowiedzenie", obejmuje: [], data_zawarcia: "2026-08-01" })], DZIS);
  assertEquals([stan(b, "umowa"), b.ma.umowa, stan(b, "wypowiedzenie")], ["ok", true, "uwaga"]);
  // once a person confirms the notice, it counts
  assertEquals(stan(audytKlienta(K, [REJ], [UM({}), UM({ rodzaj: "wypowiedzenie", obejmuje: [], data_zawarcia: "2026-08-01" })], DZIS), "umowa"), "brak");
  // a confirmed contract is not shadowed by an unconfirmed duplicate
  assertEquals(stan(audytKlienta(K, [REJ], [UM({}), UM({ ...AUTO })], DZIS), "umowa"), "ok");
});
Deno.test("audyt: strony i reprezentacja wobec rejestru", () => {
  assertEquals(stan(audytKlienta(K, [REJ], [UM({ kontrahent_nip: N2 })], DZIS), "strony"), "brak");
  assertEquals(stan(audytKlienta(K, [REJ], [UM({ kontrahent: "Dawna Nazwa sp. z o.o.", kontrahent_krs: null })], DZIS), "strony"), "uwaga");
  assertEquals(stan(audytKlienta(K, [REJ], [UM({ kontrahent_krs: "0000111222" })], DZIS), "strony"), "uwaga");
  assertEquals(stan(audytKlienta(K, [], [UM({})], DZIS), "strony"), "info");
  // somebody who is not in the register signed
  assertEquals(stan(audytKlienta(K, [REJ], [UM({ reprezentanci: [{ imie_nazwisko: "Piotr Przykładowy", funkcja: "prezes" }] })], DZIS), "reprezentacja"), "uwaga");
  assertEquals(stan(audytKlienta(K, [REJ], [UM({ reprezentanci: [] })], DZIS), "reprezentacja"), "uwaga");
  // joint representation, one signature
  const lacz = { ...REJ, reprezentacja: "DWÓCH CZŁONKÓW ZARZĄDU ŁĄCZNIE", zarzad: [...REJ.zarzad, { imie: "PIOTR", nazwisko: "PRZYKŁADOWY", funkcja: "CZŁONEK ZARZĄDU" }] };
  assertEquals(stan(audytKlienta(K, [lacz], [UM({})], DZIS), "reprezentacja"), "uwaga");
  // signed on a day one of our snapshots covers: the check is conclusive
  assertEquals(stan(audytKlienta(K, [REJ], [UM({ data_zawarcia: "2026-10-05" })], DZIS), "reprezentacja"), "ok");
  // a second given name in the register does not matter
  const dwa = { ...REJ, zarzad: [{ imie: "ANNA MARIA", nazwisko: "WZORCOWA", funkcja: "PREZES ZARZĄDU" }] };
  assertEquals(stan(audytKlienta(K, [dwa], [UM({})], DZIS), "reprezentacja"), "info");
  assertEquals(stan(audytKlienta(K, [REJ], [UM({ podpisy: "tylko_biuro" })], DZIS), "podpisy"), "uwaga");
});
Deno.test("audyt: jednoosobowa działalność — podpisuje przedsiębiorca", () => {
  const k = { id: N3, nip: N3, nazwa: "Usługi Testowe Jan Wzorcowy", forma: "JDG", opiekun: "X", kadrowy: "", status: "obslugiwany" };
  const rej = { ...wyciagGus({ success: true, nazwa: "USŁUGI TESTOWE JAN WZORCOWY", regon: "999000013", adres: "ul. Przykładowa 1, 00-000 Warszawa" }), zrodlo: "gus", fetched_at: "2026-10-01T08:00:00Z", sprawdzono_at: "2026-10-01T08:00:00Z" };
  const u = { ...UM({ kontrahent: "Jan Wzorcowy prowadzący działalność pod firmą Usługi Testowe Jan Wzorcowy", kontrahent_nip: N3, kontrahent_krs: null, reprezentanci: [{ imie_nazwisko: "Jan Wzorcowy", funkcja: "właściciel" }] }), klient: N3 };
  const a = audytKlienta(k, [rej], [u], DZIS);
  assertEquals(stan(a, "strony"), "ok"); assertEquals(stan(a, "reprezentacja"), "ok");
  assertEquals(stan(audytKlienta(k, [rej], [{ ...u, reprezentanci: [{ imie_nazwisko: "Ewa Inna", funkcja: "pełnomocnik" }] }], DZIS), "reprezentacja"), "uwaga");
});

Deno.test("ostrzezeniaRejestru", () => {
  const t = Date.parse("2026-10-09T10:00:00Z");
  assertEquals(ostrzezeniaRejestru(K, REJ, t), []);
  assertEquals(ostrzezeniaRejestru(K, null, t).length, 1);
  assert(ostrzezeniaRejestru({ ...K, w_arkuszu: false }, REJ, t)[0].includes("arkuszu"));
  assertEquals(ostrzezeniaRejestru({ ...K, w_arkuszu: false, status: "zakonczony" }, REJ, t), []);
  assert(ostrzezeniaRejestru(K, { ...REJ, stan: "w likwidacji" }, t)[0].includes("w likwidacji"));
  assert(ostrzezeniaRejestru(K, { ...REJ, zmiany: [{ pole: "skład organu reprezentacji", bylo: "a", jest: "b" }] }, t)[0].includes("skład organu"));
  assertEquals(ostrzezeniaRejestru(K, { ...REJ, fetched_at: "2026-01-01T00:00:00Z", zmiany: [{ pole: "x", bylo: "a", jest: "b" }] }, t), []);
  assert(ostrzezeniaRejestru({ ...K, nazwa: "Zupełnie Inna" }, REJ, t)[0].includes("różni się"));
  assert(ostrzezeniaRejestru({ ...K, nip: "" }, REJ, t)[0].includes("NIP"));
  assert(ostrzezeniaRejestru({ ...K, rejestr_blad: "rejestr.io HTTP 500" }, REJ, t)[0].includes("HTTP 500"));
  assertEquals(ostrzezeniaRejestru({ ...K, rejestr_blad: "rejestr.io HTTP 500" }, REJ, t, false), ["Ostatnie pobranie z rejestru nie powiodło się."]);
});

Deno.test("csvPole: cudzysłowy, średniki, nowe linie, formuły", () => {
  assertEquals(csvPole("zwykły tekst"), '"zwykły tekst"');
  assertEquals(csvPole("a;b"), '"a;b"');
  assertEquals(csvPole('SPÓŁKA "ALFA"'), '"SPÓŁKA ""ALFA"""');
  assertEquals(csvPole("linia1\nlinia2"), '"linia1\nlinia2"');
  assertEquals(csvPole(null), '""'); assertEquals(csvPole(undefined), '""'); assertEquals(csvPole(0), '"0"');
  assertEquals(csvPole('=HYPERLINK("http://x.test";"kliknij")'), '"\'=HYPERLINK(""http://x.test"";""kliknij"")"');
  assertEquals(csvPole("+48 600 000 000"), '"\'+48 600 000 000"');
  assertEquals(csvPole("-2+3"), '"\'-2+3"');
  assertEquals(csvPole("@SUM(A1)"), '"\'@SUM(A1)"');
  assertEquals(csvPole("  =1+1"), '"\'  =1+1"');
  assertEquals(csvPole("\t=1+1"), '"\'\t=1+1"');
  assertEquals(csvPole("\r=1+1"), '"\'\r=1+1"');
  assertEquals(csvPole("Alfa - Beta"), '"Alfa - Beta"');
});
Deno.test("csvBraki: nagłówek, wiersz, groźna nazwa klienta", () => {
  const zly = { ...K, nazwa: '=cmd|"/c calc"!A1' };
  const csv = csvBraki([{ k: K, a: audytKlienta(K, [REJ], [], DZIS) }, { k: zly, a: audytKlienta(zly, [REJ], [UM({ obejmuje: ["ksiegowosc", "powierzenie"] })], DZIS) }]);
  const linie = csv.trimEnd().split("\r\n");
  assertEquals(linie.length, 3);
  assert(linie[0].startsWith('"Klient";"NIP";"Forma"'));
  assert(linie[1].startsWith('"Przykładowa Alfa sp. z o.o.";"' + N1 + '";"spółka z o.o.";"Księgowa Testowa";"";"tylko księgowość";"obsługiwany";"braki";"NIE";"NIE";"nie dotyczy";"NIE";"NIE";"Brak umowy'));
  assert(linie[2].startsWith('"\'=cmd|""/c calc""!A1";'));
  assertEquals(linie[1].split('";"').length, 15);
  const nikt = { ...K, opiekun: "", kadrowy: "" }, kd = { ...K, opiekun: "", kadrowy: "Kadrowa Testowa" };
  const l2 = csvBraki([{ k: nikt, a: audytKlienta(nikt, [REJ], [], DZIS) }, { k: kd, a: audytKlienta(kd, [REJ], [UM({ obejmuje: ["ksiegowosc"] })], DZIS) }]).trimEnd().split("\r\n");
  assert(l2[1].includes('"brak opiekunów";"obsługiwany";"uwagi";"nie dotyczy";"nie dotyczy";"nie dotyczy";"nie dotyczy";"nie dotyczy";"";"Brak opiekuna i kadrowej'));
  assert(l2[2].includes('"tylko kadry";"obsługiwany";"braki";"NIE";"tak (poza zakresem)";"NIE";'));
});
