// deno test --allow-read supabase/functions/umowy/
// The tests with real templates read the private, git-ignored folder umowy-wzory/ and are skipped without it.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { b64, crc32, czytajZip, generuj, otworz, piszZip, placeholdery, sprawdzSzablon, tekstCzesci, tresc, type Wpis, wypelnij, zB64 } from "./docx.ts";
import { adresSiedziby, type Formularz, numerZNazwy, okresTekst, porownajPlaceholdery, type Pozycja, prognoza, reprezentacja, RODZAJE, roznice, SAD_SZABLONU, stanMigracji, stanowiskoBiernik, ustalSad, wartosci, nipOk, nazwaPliku } from "./logic.ts";

const enc = new TextEncoder(), dec = new TextDecoder();
const surowy = (nazwa: string, s: string | Uint8Array): Wpis => { const d = typeof s === "string" ? enc.encode(s) : s; return { nazwa, metoda: 0, crc: crc32(d), csize: d.length, usize: d.length, dane: d, czas: 0, data: 0x21 }; };
const RPR = '<w:rPr><w:rFonts w:ascii="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="21"/></w:rPr>';
const bieg = (txt: string, rpr = "") => `<w:r>${rpr}<w:t xml:space="preserve">${txt}</w:t></w:r>`;
const akapit = (...b: string[]) => `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${b.join("")}</w:p>`;
const DOK = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const szkielet = (xml: string) => xml.replace(/(<w:t(?:\s[^>]*)?>)[^<]*(<\/w:t>)/g, "$1$2");
async function docx(body: string, dodatkowe: Wpis[] = []): Promise<Uint8Array> {
  return await piszZip([surowy("[Content_Types].xml", "<Types/>"), surowy("_rels/.rels", "<Relationships/>"), surowy("word/document.xml", DOK(body)), ...dodatkowe], {});
}

Deno.test("zip: zapis i odczyt, treść i sumy kontrolne zachowane, podmieniony plik spakowany na nowo", async () => {
  const z = await piszZip([surowy("a.txt", "zażółć"), surowy("word/document.xml", "<x/>")], { "word/document.xml": enc.encode("<y>" + "ab".repeat(500) + "</y>") });
  const w = czytajZip(z);
  assertEquals(w.map((e) => e.nazwa), ["a.txt", "word/document.xml"]);
  assertEquals(dec.decode(await tresc(w[0])), "zażółć");
  assertEquals(w[1].metoda, 8);
  assert(w[1].csize < w[1].usize);
  assertEquals(dec.decode(await tresc(w[1])).length, 1007);
  assertEquals(dec.decode(zB64(b64(enc.encode("ąę")))), "ąę");
});
Deno.test("zip: nie-archiwum, ścieżka z .. i uszkodzona suma są odrzucane", async () => {
  assertThrows(() => czytajZip(enc.encode("%PDF-1.7 to nie jest docx, ale ma ponad 22 bajty")));
  const zly = await piszZip([surowy("../x.xml", "a")], {});
  assertThrows(() => czytajZip(zly), Error, "Niedozwolona nazwa");
  const z = await piszZip([surowy("a.txt", "abcdef")], {});
  z[30 + 5 + 2] ^= 0xff; // a byte of the stored content
  let blad = "";
  try { await tresc(czytajZip(z)[0]); } catch (e) { blad = (e as Error).message; }
  assert(blad.includes("Uszkodzony"));
});

Deno.test("wypełnianie: placeholder w jednym biegu, rozbity na kilka biegów i w tabeli; reszta XML bez zmian", () => {
  const xml = DOK(
    akapit(bieg("numer {{NUMER}}/SPZOO/2026")) +
    akapit(bieg("{{NAZ", RPR), bieg("WA_SPO"), bieg("LKI}}", RPR), bieg(", NIP {{NUMER_NIP}} i jeszcze {{NUMER_NIP}}.")) +
    `<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="100"/></w:tcPr>${akapit(bieg("{{PROGNOZA_KWOTA}} zł", RPR))}</w:tc></w:tr></w:tbl>` + "<w:p/>" + akapit(bieg("bez zmian { } {x}")),
  );
  const w = wypelnij(xml, { NUMER: "12", NAZWA_SPOLKI: "PRZYKŁADOWA FIRMA TESTOWA SP. Z O.O.", NUMER_NIP: "0000000000", PROGNOZA_KWOTA: "700" });
  assertEquals(tekstCzesci(w.xml).split("\n"), ["numer 12/SPZOO/2026", "PRZYKŁADOWA FIRMA TESTOWA SP. Z O.O., NIP 0000000000 i jeszcze 0000000000.", "700 zł", "bez zmian { } {x}"]);
  assertEquals(szkielet(w.xml), szkielet(xml)); // only the text of <w:t> nodes changed
  assertEquals(w.uzyte, { NUMER: 1, NAZWA_SPOLKI: 1, NUMER_NIP: 2, PROGNOZA_KWOTA: 1 });
  assertEquals(w.nieznane, []);
  assertEquals(placeholdery(w.xml), { lista: [], bledne: [] });
  // the value landed in the first run of the split placeholder, in its formatting
  assert(w.xml.includes(RPR + '<w:t xml:space="preserve">PRZYKŁADOWA FIRMA TESTOWA SP. Z O.O.</w:t>'));
});
Deno.test("wypełnianie: wartości są cytowane — żadnego znacznika, pola ani nowego placeholdera z danych", () => {
  const xml = DOK(akapit(bieg("{{A}} | {{B}} | {{C}}")));
  const w = wypelnij(xml, { A: 'Jan & Syn <w:r><w:fldChar w:fldCharType="begin"/></w:r>', B: "linia1\nlinia2\t\u0007x", C: "{{A}}" });
  assert(!/<w:fldChar/.test(w.xml));
  assert(w.xml.includes("Jan &amp; Syn &lt;w:r&gt;&lt;w:fldChar"));
  assertEquals(tekstCzesci(w.xml), 'Jan & Syn <w:r><w:fldChar w:fldCharType="begin"/></w:r> | linia1 linia2 x | {{A}}');
  assertEquals(szkielet(w.xml), szkielet(xml));
  assertEquals(placeholdery(w.xml).lista, [{ nazwa: "A", ile: 1 }]); // a value that looks like a placeholder is caught by the leftover check, never substituted
});
Deno.test("wypełnianie: różne wartości kolejnych wystąpień, brak wartości zgłoszony, literał tylko we wskazanym akapicie", () => {
  const sad = "SĄD REJONOWY X, I WYDZIAŁ";
  const xml = DOK(akapit(bieg("{{NAZWA}} w rejestrze "), bieg("SĄD REJONOWY X"), bieg(", I WYDZIAŁ przez {{OSOBA}}")) + akapit(bieg("TD w rejestrze " + sad)) + akapit(bieg("kontakt: {{OSOBA}}, {{BRAK}}")));
  const w = wypelnij(xml, { NAZWA: "Firma", OSOBA: ["Jan Testowy", "Anna Testowa"] }, [{ w_akapicie: "{{NAZWA}}", szukaj: sad, na: "SĄD REJONOWY Y, II WYDZIAŁ" }, { w_akapicie: "{{NAZWA}}", szukaj: "nie ma", na: "x" }]);
  assertEquals(tekstCzesci(w.xml).split("\n"), ["Firma w rejestrze SĄD REJONOWY Y, II WYDZIAŁ przez Jan Testowy", "TD w rejestrze " + sad, "kontakt: Anna Testowa, {{BRAK}}"]);
  assertEquals(w.nieznane, ["BRAK"]);
  assertEquals(w.literaly, [true, false]);
});
Deno.test("wypełnianie: wartość z segmentami dzieli bieg, zachowując jego właściwości i przełączając pogrubienie", () => {
  const xml = DOK(akapit(bieg("przez "), bieg("{{IMIE_NAZWISKO}}", RPR), bieg(" - {{STANOWISKO}},")));
  const w = wypelnij(xml, { IMIE_NAZWISKO: [[{ t: "Jan Testowy" }, { t: " - Prezesa Zarządu oraz ", b: false }, { t: "Anna Testowa" }]], STANOWISKO: "Członka Zarządu" });
  assertEquals(tekstCzesci(w.xml), "przez Jan Testowy - Prezesa Zarządu oraz Anna Testowa - Członka Zarządu,");
  const biegi = [...w.xml.matchAll(/<w:r>(<w:rPr>.*?<\/w:rPr>)?<w:t[^>]*>([^<]*)<\/w:t><\/w:r>/g)].map((m) => [/<w:b\/>/.test(m[1] ?? ""), m[2]]);
  assertEquals(biegi, [[false, "przez "], [true, "Jan Testowy"], [false, " - Prezesa Zarządu oraz "], [true, "Anna Testowa"], [false, " - Członka Zarządu,"]]);
  assert(!/[-]/.test(w.xml));
});

Deno.test("szablon: kontrola pliku — makra, pola Word, zewnętrzne powiązania, pola tekstowe i zepsute placeholdery", async () => {
  const ok = await docx(akapit(bieg("{{NUMER}} {{DATA}}")) + akapit(bieg("{{DATA}}")));
  assertEquals((await sprawdzSzablon(ok)).lista, [{ nazwa: "NUMER", ile: 1 }, { nazwa: "DATA", ile: 2 }]);
  const blad = async (b: Uint8Array) => { try { await sprawdzSzablon(b); return ""; } catch (e) { return (e as Error).message; } };
  assert((await blad(await docx(akapit(bieg("x")), [surowy("word/vbaProject.bin", "x")]))).includes("makro"));
  assert((await blad(await docx(akapit('<w:r><w:instrText xml:space="preserve"> INCLUDETEXT "http://x" </w:instrText></w:r>')))).includes("pole Word"));
  assert(!(await blad(await docx(akapit('<w:r><w:instrText xml:space="preserve">PAGE</w:instrText></w:r>')))));
  assert((await blad(await docx(akapit(bieg("x")), [surowy("word/_rels/settings.xml.rels", '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://zle.example/t.dotm" TargetMode="External"/></Relationships>')]))).includes("zewnętrznego"));
  assert((await blad(await docx("<w:p><w:r><w:txbxContent/></w:r></w:p>"))).includes("pole tekstowe"));
  assert((await blad(enc.encode("to nie jest archiwum, tylko zwykły tekst…"))).includes("DOCX"));
  assertEquals((await sprawdzSzablon(await docx(akapit(bieg("{{NUMER} i {DATA}"))))).bledne.length, 1);
  assertEquals(porownajPlaceholdery("aneks_jdg", [{ nazwa: "NUMER_ANEKSU" }, { nazwa: "NIP" }, { nazwa: "PESEL" }]).nadmiarowe, ["PESEL"]);
  assert(porownajPlaceholdery("aneks_jdg", [{ nazwa: "NIP" }]).brakuje.includes("DATA_UMOWY"));
});

// ---------------------------------------------------------------- price list and forecast
const C = (rodzina: string, kod: string | null, cena: number | null, prog: number | null = null, nazwa = kod ?? "x"): Pozycja => ({ rodzina, kod, nazwa: prog !== null ? (prog === 0 ? "Brak dokumentów" : "Do " + prog + " zapisów") : nazwa, prog, cena, jednostka: kod === "uop" || kod === "uz" ? "pracownik" : null });
const CENNIK: Pozycja[] = [
  C("SPZOO", "zapisy", 350, 0), C("SPZOO", "zapisy", 450, 10), C("SPZOO", "zapisy", 600, 20), C("SPZOO", "zapisy", 700, 30), C("SPZOO", "zapisy", 900, 50), C("SPZOO", "zapis_kolejny", 11),
  C("SPZOO", "vat_jpk", 100), C("SPZOO", "srodek_trwaly", 50), C("SPZOO", "uop", 80), C("SPZOO", "uz", 50), C("SPZOO", "roznice_kursowe", 15), C("SPZOO", null, null, null, "indywidualnie"),
  C("JDG", "zapisy", 250, 5), C("JDG", "zapisy", 300, 10), C("JDG", "zapisy", 450, 20), C("JDG", "zapisy", 550, 30), C("JDG", "zapisy", 750, 50), C("JDG", "zapis_kolejny", 11),
  C("JDG", "vat_jpk", 100), C("JDG", "srodek_trwaly", 100), C("JDG", "uop", 80), C("JDG", "uz", 50),
];
const P = (o: Partial<Parameters<typeof prognoza>[2]>) => ({ zapisy: 0, vat: false, uop: 0, uz: 0, kadry: "w_stawce" as const, ...o });

Deno.test("prognoza: przykład właściciela — księga do 20 zapisów 600 zł + VAT/JPK 100 zł = 700 zł netto", () => {
  const p = prognoza(CENNIK, "SPZOO", P({ zapisy: 20, vat: true }));
  assertEquals(p.linie.map((l) => [l.kod, l.wartosc]), [["zapisy", 600], ["vat_jpk", 100]]);
  assertEquals([p.suma, p.kwota, p.bledy.length], [700, 700, 0]);
  assertEquals(p.teksty, { PROGNOZA_ZAPISY: "do 20", PROGNOZA_UOP: "0", PROGNOZA_UZ: "0", PROGNOZA_VAT: "tak", PROGNOZA_INNE: "brak", PROGNOZA_KWOTA: "700" });
});
Deno.test("prognoza: progi — 0, granice, między progami, ponad najwyższy próg; JDG ma własne ceny", () => {
  const kw = (r: "SPZOO" | "JDG", n: number) => prognoza(CENNIK, r, P({ zapisy: n })).kwota;
  assertEquals([0, 1, 10, 11, 20, 21, 30, 31, 50, 51, 65].map((n) => kw("SPZOO", n)), [350, 450, 450, 600, 600, 700, 700, 900, 900, 911, 1065]);
  assertEquals([0, 5, 6, 10, 20, 50, 60].map((n) => kw("JDG", n)), [250, 250, 300, 300, 450, 750, 860]);
  assertEquals(prognoza(CENNIK, "JDG", P({ zapisy: 10, vat: true })).kwota, 400); // the filled JDG contract of October 2026
  assertEquals(prognoza(CENNIK, "SPZOO", P({ zapisy: 65 })).teksty.PROGNOZA_ZAPISY, "65");
  assertEquals(prognoza(CENNIK, "SPZOO", P({ zapisy: 0 })).teksty.PROGNOZA_ZAPISY, "0 (brak dokumentów)");
  assertEquals(prognoza(CENNIK, "JDG", P({ zapisy: 0 })).teksty.PROGNOZA_ZAPISY, "do 5");
});
Deno.test("prognoza: kadry w stawce albo odrębną fakturą, środki trwałe, pozycje ręczne", () => {
  const w = prognoza(CENNIK, "SPZOO", P({ zapisy: 30, vat: true, uop: 2, uz: 3, srodki_trwale: 2, roznice_kursowe: 4, inne: [{ nazwa: "Raport miesięczny", kwota: 120.4 }] }));
  assertEquals(w.suma, 700 + 100 + 160 + 150 + 100 + 60 + 120.4);
  assertEquals(w.kwota, 1390); // full złoty
  assertEquals(w.teksty.PROGNOZA_KWOTA, "1 390");
  assertEquals(w.teksty.PROGNOZA_INNE, "ewidencja środków trwałych: 2 szt.; różnice kursowe: 4 dok.; Raport miesięczny");
  assertEquals([w.teksty.PROGNOZA_UOP, w.teksty.PROGNOZA_UZ], ["2", "3"]);
  const o = prognoza(CENNIK, "SPZOO", P({ zapisy: 30, vat: true, uop: 2, uz: 3, kadry: "odrebnie" }));
  assertEquals([o.kwota, o.odrebnie], [800, 310]);
  assertEquals(o.linie.filter((l) => !l.w_stawce).map((l) => l.kod), ["uop", "uz"]);
  assert(o.ostrzezenia[0].includes("NIE wchodzą do Stawki Miesięcznej"));
  assertEquals(o.teksty.PROGNOZA_UOP, "2"); // the annex still states the head count
});
Deno.test("prognoza: ceny tylko z cennika — brak pozycji to błąd, nie zgadywanie; nieaktywna pozycja się nie liczy", () => {
  const bez = CENNIK.filter((p) => p.kod !== "vat_jpk");
  const p = prognoza(bez, "SPZOO", P({ zapisy: 10, vat: true }));
  assertEquals(p.kwota, 450);
  assert(p.bledy[0].includes("brakuje pozycji"));
  assert(prognoza([], "JDG", P({ zapisy: 5 })).bledy[0].includes("nie ma progów"));
  assert(prognoza(CENNIK.map((x) => x.kod === "uop" ? { ...x, aktywna: false } : x), "SPZOO", P({ zapisy: 10, uop: 1 })).bledy.length === 1);
  assert(prognoza(CENNIK, "SPZOO", P({ zapisy: 10, inne: [{ nazwa: "", kwota: 50 }] })).bledy.length === 1);
  // SPZOO JDG rows never mix
  assertEquals(prognoza(CENNIK, "JDG", P({ zapisy: 10, srodki_trwale: 1 })).kwota, 400);
});

// ---------------------------------------------------------------- court, representation, form
Deno.test("sąd rejestrowy: z rejestru, po sygnaturze, propozycja według powiatu, w pozostałych przypadkach — do wpisania", () => {
  const sady = [{ nazwa: SAD_SZABLONU, kod: "PO.VIII", powiaty: ["3064"] }];
  assertEquals(ustalSad({ sad: "Sąd Rejonowy w Przykładowie, I Wydział" }, sady), { nazwa: "SĄD REJONOWY W PRZYKŁADOWIE, I WYDZIAŁ", zrodlo: "rejestr", pewne: true, opis: "Sąd rejestrowy z danych rejestru." });
  const s = ustalSad({ sygnatura: "PO.VIII NS-REJ.KRS/1234/26/1" }, sady);
  assertEquals([s.nazwa, s.zrodlo, s.pewne], [SAD_SZABLONU, "sygnatura", true]);
  const p = ustalSad({ powiat: "3064" }, sady);
  assertEquals([p.nazwa, p.zrodlo, p.pewne], [SAD_SZABLONU, "siedziba", false]);
  assertEquals(ustalSad({ powiat: "1465" }, sady).zrodlo, "brak");
  assertEquals(ustalSad({ sygnatura: "WA.XII NS-REJ.KRS/1/26" }, sady).zrodlo, "brak");
  assertEquals(ustalSad({}, []).nazwa, "");
});
Deno.test("reprezentacja: samodzielna, łączna, zależna od liczby członków zarządu, niejednoznaczna", () => {
  const jan = { imie_nazwisko: "Jan Testowy", funkcja: "Prezes Zarządu" }, anna = { imie_nazwisko: "Anna Testowa", funkcja: "Członek Zarządu" };
  assertEquals(reprezentacja("Do składania oświadczeń w imieniu spółki jest upoważniony każdy z członków zarządu samodzielnie.", [jan, anna]).tryb, "samodzielna");
  const l = reprezentacja("Do składania oświadczeń woli wymagane jest współdziałanie dwóch członków zarządu albo jednego członka zarządu łącznie z prokurentem.", [jan, anna]);
  assertEquals([l.tryb, l.min], ["laczna", 2]);
  const mieszana = "W przypadku zarządu jednoosobowego spółkę reprezentuje członek zarządu samodzielnie, a w przypadku zarządu wieloosobowego dwóch członków zarządu działających łącznie.";
  assertEquals(reprezentacja(mieszana, [jan]).tryb, "samodzielna");
  assertEquals(reprezentacja(mieszana, [jan, anna]).tryb, "laczna");
  assertEquals(reprezentacja("Prezes zarządu samodzielnie, pozostali członkowie zarządu łącznie.", [jan, anna]).tryb, "nieustalona");
  assertEquals(reprezentacja("", [jan]).tryb, "nieustalona");
});
Deno.test("drobne: stanowisko w bierniku, adres siedziby, okres, NIP, numer z nazwy pliku, nazwa pliku", () => {
  assertEquals(["PREZES ZARZĄDU", "Członek Zarządu", "wiceprezes zarządu", "PROKURENT SAMOISTNY", "Dyrektor Finansowy", ""].map(stanowiskoBiernik), ["Prezesa Zarządu", "Członka Zarządu", "Wiceprezesa Zarządu", "Prokurenta", "Dyrektor Finansowy", ""]);
  assertEquals(adresSiedziby({ ulica: "Przykładowa 1/2", kod: "00-000", miasto: "Warszawa" }), "ul. Przykładowa 1/2, 00-000 Warszawa");
  assertEquals(adresSiedziby({ ulica: "al. Testowa 5", kod: "00-000", miasto: "Warszawa" }), "al. Testowa 5, 00-000 Warszawa");
  assertEquals(adresSiedziby({ ulica: "Przykładowo 12", kod: "00-001", miasto: "Przykładowo" }), "Przykładowo 12, 00-001 Przykładowo");
  assertEquals(okresTekst(2026, 10), "październik 2026 r. (obsługa dokumentów za wrzesień 2026 r.)");
  assertEquals(okresTekst(2027, 1), "styczeń 2027 r. (obsługa dokumentów za grudzień 2026 r.)");
  assertEquals([nipOk("0000000000"), nipOk("1234567890"), nipOk("123")], [true, false, false]);
  assertEquals([numerZNazwy("Umowa 8-SPZOO-2026 Przykładowa.pdf"), numerZNazwy("36/JDG/2026"), numerZNazwy("skan.pdf")], ["8/SPZOO/2026", "36/JDG/2026", ""]);
  assertEquals(nazwaPliku("12/SPZOO/2026", "Przykładowa Firma Testowa Sp. z o.o.", "docx"), "12-SPZOO-2026_Przykladowa_Firma_Testowa_Sp_z_o_o.docx");
  assert(/^[A-Za-z0-9_.-]+$/.test(nazwaPliku("Aneks nr 1 do umowy 5/JDG/2026", "Żółć & <Synowie>", "pdf")));
});

const SPZOO: Formularz = {
  rodzaj: "nowa_spzoo", firma: { nazwa: "PRZYKŁADOWA FIRMA TESTOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", adres: "ul. Przykładowa 1/2, 00-000 Warszawa", krs: "0000000000", nip: "0000000000", sad: SAD_SZABLONU },
  podpisujacy: [{ imie_nazwisko: "Jan Testowy", funkcja: "Prezesa Zarządu" }], kontakt: { imie_nazwisko: "Anna Testowa", email: "biuro@przykladowa.example", telefon: "+48 000 000 000" },
  okres: { rok: 2026, miesiac: 10 }, prognoza: P({ zapisy: 20, vat: true }),
};
const CTX = { numer: "12", data: "2026-10-09", rok: 2026, cennik: CENNIK, rep: { tryb: "samodzielna" as const, min: 1, opis: "" }, sadPewny: true };
Deno.test("formularz spółki: komplet wartości, osoba kontaktowa osobno od podpisującego, braki i potwierdzenia", () => {
  const w = wartosci(SPZOO, CTX);
  assertEquals(w.braki, []);
  assertEquals(w.wartosci.IMIE_NAZWISKO, ["Jan Testowy", "Anna Testowa"]);
  assertEquals([w.wartosci.NUMER, w.wartosci.DATA, w.wartosci.STANOWISKO, w.wartosci.PROGNOZA_KWOTA, w.wartosci.PIERWSZY_OKRES], ["12", "09.10.2026", "Prezesa Zarządu", "700", "październik 2026 r. (obsługa dokumentów za wrzesień 2026 r.)"]);
  assertEquals(w.literaly, []);
  assertEquals(Object.keys(w.wartosci).sort(), [...RODZAJE.nowa_spzoo.placeholdery].sort());
  // an empty form names everything that is missing
  const pusty = wartosci({ rodzaj: "nowa_spzoo", firma: {} }, { ...CTX, rep: null, sadPewny: false });
  for (const co of ["pełna nazwa spółki", "adres siedziby", "NIP (10 cyfr)", "numer KRS (10 cyfr)", "osoba podpisująca w imieniu spółki", "sąd rejestrowy (z odpisu KRS)", "adres e-mail Zleceniodawcy", "telefon Zleceniodawcy", "pierwszy Okres Rozliczeniowy", "prognoza (Załącznik nr 4)"]) assert(pusty.braki.includes(co), co);
  // a proposed court must be confirmed; another court replaces the one printed in the template; another year likewise
  assert(wartosci(SPZOO, { ...CTX, sadPewny: false }).braki[0].includes("potwierdzenie sądu"));
  const inny = wartosci({ ...SPZOO, firma: { ...SPZOO.firma, sad: "Sąd Rejonowy w Przykładowie, I Wydział Gospodarczy KRS" }, potwierdzenia: { sad: true } }, { ...CTX, sadPewny: false, rok: 2027 });
  assertEquals(inny.braki, []);
  assertEquals(inny.literaly, [{ w_akapicie: "{{NAZWA_SPOLKI}}", szukaj: SAD_SZABLONU, na: "SĄD REJONOWY W PRZYKŁADOWIE, I WYDZIAŁ GOSPODARCZY KRS" }, { w_akapicie: "{{NUMER}}", szukaj: "/SPZOO/2026", na: "/SPZOO/2027" }]);
});
Deno.test("formularz spółki: reprezentacja łączna wymaga wszystkich podpisujących; nieustalona — potwierdzenia", () => {
  const laczna = { tryb: "laczna" as const, min: 2, opis: "" };
  assert(wartosci(SPZOO, { ...CTX, rep: laczna }).braki.some((b) => b.startsWith("reprezentacja łączna")));
  const dwoje = wartosci({ ...SPZOO, podpisujacy: [{ imie_nazwisko: "Jan Testowy", funkcja: "Prezesa Zarządu" }, { imie_nazwisko: "Anna Testowa", funkcja: "Członka Zarządu" }] }, { ...CTX, rep: laczna });
  assertEquals(dwoje.braki, []);
  assertEquals((dwoje.wartosci.IMIE_NAZWISKO as unknown[])[0], [{ t: "Jan Testowy" }, { t: " - Prezesa Zarządu oraz ", b: false }, { t: "Anna Testowa" }]);
  assertEquals(dwoje.wartosci.STANOWISKO, "Członka Zarządu");
  assert(wartosci(SPZOO, { ...CTX, rep: { tryb: "nieustalona", min: 1, opis: "" } }).braki.some((b) => b.startsWith("potwierdzenie sposobu reprezentacji")));
  assertEquals(wartosci({ ...SPZOO, potwierdzenia: { reprezentacja: true } }, { ...CTX, rep: { tryb: "nieustalona", min: 1, opis: "" } }).braki, []);
  assert(wartosci({ ...SPZOO, podpisujacy: [{ imie_nazwisko: "Piotr Testowy", funkcja: "Pełnomocnika", zrodlo: "reczna" }] }, CTX).ostrzezenia[0].includes("wpisana ręcznie"));
});
Deno.test("formularz JDG i aneksy: dane z bazy i wpisane ręcznie, bez KRS, sądu i reprezentacji", () => {
  const jdg: Formularz = { rodzaj: "nowa_jdg", firma: { nazwa: "Usługi Testowe Jan Testowy", adres: "ul. Przykładowa 3, 00-000 Warszawa", nip: "0000000000", regon: "000000000" }, wlasciciel: "Jan Testowy",
    kontakt: { email: "jan@przykladowa.example", telefon: "000000000" }, okres: { rok: 2026, miesiac: 11 }, prognoza: P({ zapisy: 10, vat: true }) };
  const w = wartosci(jdg, { ...CTX, numer: "37", rep: null, sadPewny: false });
  assertEquals(w.braki, []);
  assertEquals([w.wartosci.IMIE_NAZWISKO, w.wartosci.REGON, w.wartosci.PROGNOZA_KWOTA], [["Jan Testowy", "Jan Testowy"], "000000000", "400"]);
  assertEquals(Object.keys(w.wartosci).sort(), [...RODZAJE.nowa_jdg.placeholdery].sort());
  assert(wartosci({ ...jdg, firma: { ...jdg.firma, regon: "12" }, wlasciciel: "" }, CTX).braki.includes("REGON (9 cyfr)"));
  const a = wartosci({ rodzaj: "aneks_jdg", firma: jdg.firma, wlasciciel: "Jan Testowy", aneks: { umowa_numer: "5/JDG/2025", umowa_data: "2025-03-01" } }, { ...CTX, numer: "1" });
  assertEquals(a.braki, []);
  assertEquals([a.wartosci.NUMER_ANEKSU, a.wartosci.NUMER_UMOWY, a.wartosci.DATA_UMOWY, a.wartosci.IMIE_NAZWISKO], ["1", "5/JDG/2025", "01.03.2025", "Jan Testowy"]);
  assertEquals(Object.keys(a.wartosci).sort(), [...RODZAJE.aneks_jdg.placeholdery].sort());
  const as = wartosci({ ...SPZOO, rodzaj: "aneks_spzoo", aneks: { umowa_numer: "", umowa_data: "2027-01-01" } }, CTX);
  assert(as.braki.includes("numer umowy, do której jest aneks") && as.braki.includes("data umowy nie może być późniejsza niż data aneksu"));
  assertEquals(Object.keys(wartosci({ ...SPZOO, rodzaj: "stara_spzoo" }, CTX).wartosci).sort(), [...RODZAJE.stara_spzoo.placeholdery].sort());
  assertEquals(wartosci({ ...SPZOO, rodzaj: "stara_spzoo" }, CTX).wartosci.IMIE_NAZWISKO, "Jan Testowy");
});
Deno.test("baza a rejestr: różnice w nazwie i adresie; stan przejścia na przedpłatę", () => {
  assertEquals(roznice({ nazwa: "Przykładowa Sp. z o.o.", adres: "ul. Przykładowa 1/2", miasto: "Warszawa", nip: "0000000000" }, { nazwa: "PRZYKŁADOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", adres: "PRZYKŁADOWA 1/2, 00-000 WARSZAWA", nip: "0000000000" }), []);
  assertEquals(roznice({ nazwa: "Stara Nazwa Sp. z o.o.", adres: "ul. Dawna 9", miasto: "Kraków" }, { nazwa: "NOWA NAZWA SP. Z O.O.", adres: "PRZYKŁADOWA 1, 00-000 WARSZAWA" }).map((r) => r.pole), ["nazwa", "adres"]);
  const ks = { rodzaj: "ksiegowosc", status: "przypisany" };
  assertEquals(stanMigracji([], [], null), "brak");
  assertEquals(stanMigracji([ks], [], null), "stara");
  assertEquals(stanMigracji([{ ...ks, wynagrodzenie: "płatne z góry na podstawie faktury pro forma" }], [], null), "przedplata");
  assertEquals(stanMigracji([ks], [{ rodzaj: "aneks_spzoo", status: "wygenerowana" }], null), "aneks_wygenerowany");
  assertEquals(stanMigracji([ks], [{ rodzaj: "aneks_spzoo", status: "anulowana" }], null), "stara");
  assertEquals(stanMigracji([ks], [{ rodzaj: "aneks_jdg", status: "podpisana" }], null), "aneks_podpisany");
  assertEquals(stanMigracji([], [{ rodzaj: "nowa_jdg", status: "wyslana" }], null), "nowa_wygenerowana");
  assertEquals(stanMigracji([], [{ rodzaj: "nowa_jdg", status: "podpisana" }], null), "przedplata");
  assertEquals(stanMigracji([ks], [], "pomin"), "pomin");
});

// ---------------------------------------------------------------- the six real templates (private folder; skipped without it)
const WZORY = new URL("../../../umowy-wzory/", import.meta.url);
const PLIKI: Record<string, string> = { nowa_spzoo: "SZABLON_SPZOO_PREPAID_2026.docx", nowa_jdg: "SZABLON_JDG_PREPAID_2026.docx", aneks_spzoo: "SZABLON_ANEKS_SPZOO_PREPAID.docx", aneks_jdg: "SZABLON_ANEKS_JDG_PREPAID.docx",
  stara_spzoo: "_przygotowane/stara_spzoo.docx", stara_jdg: "_przygotowane/stara_jdg.docx" };
const czytaj = async (p: string) => { try { return await Deno.readFile(new URL(p, WZORY)); } catch { return null; } };
for (const [rodzaj, plik] of Object.entries(PLIKI)) {
  Deno.test({ name: "wzór " + rodzaj + ": placeholdery zgodne z oczekiwanymi, po wypełnieniu nic nie zostaje, zmienia się tylko to, co wstawione", ignore: (await czytaj(plik)) === null, fn: async () => {
    const b = (await czytaj(plik))!;
    const spr = await sprawdzSzablon(b);
    assertEquals(spr.bledne, []);
    assertEquals(porownajPlaceholdery(rodzaj as keyof typeof RODZAJE, spr.lista), { brakuje: [], nadmiarowe: [] });
    const R = RODZAJE[rodzaj as keyof typeof RODZAJE];
    const f: Formularz = R.rodzina === "SPZOO"
      ? { ...SPZOO, rodzaj: rodzaj as Formularz["rodzaj"], aneks: { umowa_numer: "3/SPZOO/2025", umowa_data: "2025-02-03" } }
      : { rodzaj: rodzaj as Formularz["rodzaj"], firma: { nazwa: "Usługi Testowe Jan Testowy", adres: "ul. Przykładowa 3, 00-000 Warszawa", nip: "0000000000", regon: "000000000" }, wlasciciel: "Jan Testowy",
        kontakt: { imie_nazwisko: "Jan Testowy", email: "jan@przykladowa.example", telefon: "+48 000 000 000" }, okres: { rok: 2026, miesiac: 10 }, prognoza: P({ zapisy: 10, vat: true }), aneks: { umowa_numer: "5/JDG/2025", umowa_data: "2025-03-01" } };
    const w = wartosci(f, { ...CTX, numer: R.aneks ? "1" : "12" });
    assertEquals(w.braki, []);
    const s = await otworz(b);
    const g = await generuj(s, w.wartosci, w.literaly);
    assertEquals([g.nieznane, g.pozostale], [[], []]);
    // the text is the template's text with exactly the placeholders replaced
    const przed = s.czesci["word/document.xml"], po = dec.decode(await tresc(czytajZip(g.docx).find((e) => e.nazwa === "word/document.xml")!));
    const licznik: Record<string, number> = {};
    const oczekiwany = tekstCzesci(przed).replace(/\{\{([A-Z_]+)\}\}/g, (_m, n: string) => { const v = w.wartosci[n], k = licznik[n] ?? 0; licznik[n] = k + 1; return String(Array.isArray(v) ? v[Math.min(k, v.length - 1)] : v); });
    assertEquals(tekstCzesci(po), oczekiwany);
    assertEquals(szkielet(po), szkielet(przed));
    // every other file of the package is byte-identical
    const a = czytajZip(b), c = czytajZip(g.docx);
    assertEquals(c.map((e) => e.nazwa), a.map((e) => e.nazwa));
    for (let i = 0; i < a.length; i++) if (a[i].nazwa !== "word/document.xml") assertEquals([c[i].crc, c[i].usize], [a[i].crc, a[i].usize], a[i].nazwa);
    for (const e of c) await tresc(e); // every entry inflates and matches its checksum
  } });
}
