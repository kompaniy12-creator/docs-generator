// deno test supabase/functions/klient/portal_test.ts
// Every new action: happy path, another firm's ids (IDOR -> 403 for a foreign NIP, 404 for a foreign
// id), scope of service, limits. All data is fictional (memstore.ts).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { biuroAkcja, jezykOf, klientAkcja, MAX_PLIK, mikrorachunek, okSciezka, rodzajPliku, sprawdzPlik, type Plik, type Staff, zakresOf } from "./portal.ts";
import { ID, KONTO_A, KONTO_B, memStore, NIP_A, NIP_B, NIP_C } from "./memstore.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const NOW = Date.parse("2026-10-09T10:00:00Z");
function env() { let t = NOW; const m = memStore(() => t); return { d: { store: m.store, now: () => t }, db: m.db, tick: (ms: number) => { t += ms; } }; }
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"), PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const plik = (nazwa: string, typ: string, bytes: Uint8Array): Plik => ({ nazwa, typ, bytes });
const admin: Staff = { email: "admin@biuro.test", admin: true, sekcje: null };
const kadrowa: Staff = { email: "kadrowa@biuro.test", admin: false, sekcje: ["kadry"] };
const ksiegowa: Staff = { email: "ksiegowa@biuro.test", admin: false, sekcje: ["onboarding"] };
const bezSekcji: Staff = { email: "nowy@biuro.test", admin: false, sekcje: [] };
async function A(e: ReturnType<typeof env>, body: Any, k = KONTO_A, pliki: Plik[] = []) { const o = await klientAkcja(e.d, k, body, pliki); assert(o, "akcja nieznana"); return o; }

Deno.test("pomocnicze: język, zakres, mikrorachunek, rozpoznanie pliku", () => {
  assertEquals([jezykOf("Ukrainian"), jezykOf("Russian"), jezykOf("Polish"), jezykOf(""), jezykOf("UA")], ["uk", "ru", "pl", "pl", "uk"]);
  assertEquals(zakresOf({ dane: null, baza: { opiekun: " ", kadrowy: "X" } }), { kadry: true, ksiegowosc: false });
  assertEquals(zakresOf({ dane: { opiekun: "Y", kadrowy: "" }, baza: null }), { kadry: false, ksiegowosc: true });
  assertEquals(mikrorachunek(NIP_A).length, 26);
  assertEquals([rodzajPliku(PDF), rodzajPliku(PNG), rodzajPliku(JPG), rodzajPliku(new TextEncoder().encode("<html>"))], ["pdf", "png", "jpeg", ""]);
  assertEquals(sprawdzPlik(plik("a.pdf", "application/pdf", PDF)).ok, true);
  assertEquals((sprawdzPlik(plik("a.pdf", "application/pdf", PNG)) as Any).kod, "niezgodny");
  assertEquals((sprawdzPlik(plik("a.exe", "application/x-msdownload", PDF)) as Any).kod, "typ");
  assertEquals((sprawdzPlik(plik("a.html", "", new TextEncoder().encode("<script>"))) as Any).kod, "typ");
  assertEquals((sprawdzPlik(plik("a.pdf", "", new Uint8Array(0))) as Any).kod, "pusty");
  const duzy = new Uint8Array(MAX_PLIK + 1); duzy.set(PDF);
  assertEquals((sprawdzPlik(plik("a.pdf", "", duzy)) as Any).kod, "rozmiar");
});

Deno.test("nieznana akcja -> null (index.ts idzie dalej do starych akcji)", async () => {
  const e = env();
  assertEquals(await klientAkcja(e.d, KONTO_A, { action: "me" }), null);
  assertEquals(await klientAkcja(e.d, KONTO_A, { action: "dane", nip: NIP_A }), null);
});

Deno.test("każda akcja: cudzy NIP -> 403, bez śladu danych", async () => {
  const e = env();
  for (const action of ["start", "pracownicy", "pracownik", "pracownik_pokaz", "dokumenty", "pobierz", "ksiegi", "zgloszenia", "zgloszenie_nowe", "firma"]) {
    for (const nip of [NIP_B, "", "123", `${NIP_A}0`, null]) {
      const o = await A(e, { action, nip, id: ID.wB1, zrodlo: "komplet", pole: "pesel", kategoria: "kadry", temat: "abc", tresc: "abc" });
      assertEquals(o.status, 403, `${action} ${nip}`);
      assert(!JSON.stringify(o.body).includes("Cudzy"));
    }
  }
  assertEquals(e.db.zgloszenia.length, 1);
  assertEquals(e.db.log.length, 0);
});

Deno.test("start: co wymaga uwagi, zakres, kontakt biura, poprzednie logowanie", async () => {
  const e = env();
  const o = (await A(e, { action: "start", nip: NIP_A })).body;
  assertEquals(o.zakres, { kadry: true, ksiegowosc: true });
  assertEquals(o.jezyk, "uk");
  assertEquals(o.liczby, { pracownicy: 4, w_trakcie: 2, w_weryfikacji: 1, do_podpisu: 1, zgloszenia_otwarte: 0 });
  // zezwolenie 5 dni po terminie, karta za 12 dni, paszport za 25 dni; umowa za 60 i 150 dni — nie
  assertEquals(o.terminy_pracownikow.map((x: Any) => [x.imie_nazwisko, x.co, x.dni]), [["Dmytro Przykładowy", "zezwolenie", -5], ["Oksana Testowa", "karta_pobytu", 12], ["Dmytro Przykładowy", "paszport", 25]]);
  assertEquals(o.od_klienta, [{ co: "Podpisać i odesłać UPL-1", sprawa: "Pełnomocnictwo UPL-1", termin: "2026-10-13" }]);
  assertEquals(o.kontakt.opiekun, "Przykładowa K."); assertEquals(o.kontakt.kadrowy, "Testowa A.");
  assertEquals(Object.keys(o.kontakt.biuro).sort(), ["email_kadry", "email_ksiegowosc", "nazwa", "telefon"]);
  assertEquals(o.poprzednie_logowanie, "2026-10-06T10:00:00.000Z");
  assertEquals(o.podatki, { forma: "sp. z o.o.", opodatkowanie: "CIT, VAT miesięcznie" });
  const s = JSON.stringify(o);
  assert(!s.includes("Cudzy") && !s.includes("99999999990") && !s.includes("@biuro.test") && !s.includes("PODRZUCONY"));
});

Deno.test("zakres: sama księgowość nie widzi kadr, same kadry nie widzą księgowości", async () => {
  const e = env();
  const c = (await A(e, { action: "start", nip: NIP_C })).body;
  assertEquals(c.zakres, { kadry: false, ksiegowosc: true });
  assertEquals([c.kontakt.kadrowy, c.liczby.pracownicy, c.liczby.do_podpisu, c.terminy_pracownikow.length], [null, 0, 0, 0]);
  for (const action of ["pracownicy", "pracownik", "pracownik_pokaz"]) {
    const o = await A(e, { action, nip: NIP_C, id: ID.wA1, pole: "pesel" });
    assertEquals([o.status, o.body.zakres], [403, true]);
  }
  assertEquals((await A(e, { action: "ksiegi", nip: NIP_C })).status, 200);
  const b = (await A(e, { action: "start", nip: NIP_B }, KONTO_B)).body;
  assertEquals([b.zakres, b.kontakt.opiekun, b.podatki, b.od_klienta], [{ kadry: true, ksiegowosc: false }, null, null, []]);
  const k = await A(e, { action: "ksiegi", nip: NIP_B }, KONTO_B);
  assertEquals([k.status, k.body.zakres], [403, true]);
});

Deno.test("pracownicy: statusy, terminy; bez PESEL i numerów dokumentów", async () => {
  const e = env();
  const o = await A(e, { action: "pracownicy", nip: NIP_A });
  assertEquals(o.status, 200);
  assertEquals(o.body.pracownicy.map((p: Any) => p.status).sort(), ["w_trakcie", "w_trakcie", "zakonczony", "zatrudniony", "zatrudniony", "zatrudniony", "zatrudniony"]);
  assertEquals(o.body.w_weryfikacji, 1);
  const ok = o.body.pracownicy.find((p: Any) => p.id === ID.wA1);
  assertEquals(ok.terminy.karta_pobytu, { data: "2026-10-21", bezterminowo: false });
  assertEquals(o.body.pracownicy.find((p: Any) => p.id === ID.wA4).etap, "dokumenty wysłane do podpisu");
  const s = JSON.stringify(o.body);
  assert(!s.includes("99999999990") && !s.includes("TEST123456") && !s.includes("0000 0000") && !s.includes("Cudzy") && !s.includes("payload"));
});

Deno.test("pracownik: karta z zakrytymi danymi i dokumentami; IDOR -> 404", async () => {
  const e = env();
  const o = await A(e, { action: "pracownik", nip: NIP_A, id: ID.wA1 });
  assertEquals(o.status, 200);
  assertEquals(o.body.pracownik.ma, { pesel: true, dokument: true, konto: true });
  assertEquals(o.body.pracownik.adres, "Testowa 1/2, 00-000 Przykładowo");
  assertEquals(o.body.dokumenty.komplet.id, ID.wA1);
  assertEquals(o.body.dokumenty.podpisy.map((x: Any) => [x.id, x.podpisany]), [[ID.dokA1, false], [ID.dokA2, true]]);
  // only the scan the office shared — the disciplinary one is not flagged
  assertEquals(o.body.dokumenty.akta.map((x: Any) => x.id), [ID.aktaA]);
  const s = JSON.stringify(o.body);
  assert(!s.includes("99999999990") && !s.includes("TEST123456") && !s.includes("0000 0000 0000") && !s.includes("path") && !s.includes("umowa-zlecenie/"));
  assertEquals((await A(e, { action: "pracownik", nip: NIP_A, id: ID.wA3 })).body.pracownik.ma.pesel, false);
  // another firm's worker, a made-up id, something that is not an id
  for (const id of [ID.wB1, "11111111-0000-4000-8000-999999999999", "x' or 1=1", null, { a: 1 }]) {
    const z = await A(e, { action: "pracownik", nip: NIP_A, id });
    assertEquals(z.status, 404);
    assert(!JSON.stringify(z.body).includes("Cudzy"));
  }
});

Deno.test("pracownik_pokaz: wartość + wpis w klient_log; IDOR -> 404 bez wpisu; limit na godzinę", async () => {
  const e = env();
  const o = await A(e, { action: "pracownik_pokaz", nip: NIP_A, id: ID.wA1, pole: "pesel" });
  assertEquals([o.status, o.body.wartosc], [200, "99999999990"]);
  assertEquals(e.db.log.at(-1), { at: "2026-10-09T10:00:00.000Z", konto_id: KONTO_A.id, email: KONTO_A.email, akcja: "odkrycie", info: { nip: NIP_A, pracownik: ID.wA1, pole: "pesel" } });
  assertEquals((await A(e, { action: "pracownik_pokaz", nip: NIP_A, id: ID.wA1, pole: "dokument" })).body.wartosc, "TEST123456");
  assertEquals((await A(e, { action: "pracownik_pokaz", nip: NIP_A, id: ID.wA1, pole: "p_pesel" })).status, 400);
  assertEquals((await A(e, { action: "pracownik_pokaz", nip: NIP_A, id: ID.wA1, pole: "__proto__" })).status, 400);
  const n = e.db.log.length;
  assertEquals((await A(e, { action: "pracownik_pokaz", nip: NIP_A, id: ID.wB1, pole: "pesel" })).status, 404);
  assertEquals(e.db.log.length, n);
  for (let i = 0; i < 38; i++) assertEquals((await A(e, { action: "pracownik_pokaz", nip: NIP_A, id: ID.wA2, pole: "konto" })).status, 200);
  assertEquals((await A(e, { action: "pracownik_pokaz", nip: NIP_A, id: ID.wA2, pole: "konto" })).status, 429);
  e.tick(3600001);
  assertEquals((await A(e, { action: "pracownik_pokaz", nip: NIP_A, id: ID.wA2, pole: "konto" })).status, 200);
});

Deno.test("dokumenty: tylko udostępnione i tylko swoje; bez ścieżek i kwot", async () => {
  const e = env();
  const o = (await A(e, { action: "dokumenty", nip: NIP_A })).body;
  // the newest version of the generated set; pełnomocnictwo is never listed
  assertEquals(o.firmowe.map((x: Any) => x.id), [ID.histA]);
  assertEquals(o.umowy.map((x: Any) => x.id), [ID.umowaA]);
  assertEquals(o.akta.map((x: Any) => x.id), [ID.aktaA]);
  assertEquals(o.komplety.map((x: Any) => [x.id, x.do_podpisu]).sort(), [[ID.wA1, false], [ID.wA4, true]]);
  const s = JSON.stringify(o);
  assert(!s.includes("TAJNE") && !s.includes("path") && !s.includes(".pdf\",\"pdf_path") && !s.includes("Cudzy") && !s.includes("a1.pdf"));
  // nothing is shared by default
  e.db.flagi.akta.clear(); e.db.flagi.umowa.clear();
  const p = (await A(e, { action: "dokumenty", nip: NIP_A })).body;
  assertEquals([p.umowy.length, p.akta.length], [0, 0]);
});

Deno.test("pobierz: link tylko po sprawdzeniu NIP; każde pobranie w klient_log; IDOR -> 404", async () => {
  const e = env();
  const ok: [string, string, number?][] = [["komplet", ID.wA1], ["historia", ID.histA], ["akta", ID.aktaA], ["umowa", ID.umowaA]];
  for (const [zrodlo, id] of ok) {
    const o = await A(e, { action: "pobierz", nip: NIP_A, zrodlo, id });
    assertEquals(o.status, 200, zrodlo);
    assert(o.body.url.startsWith("https://storage.test/sign/") && o.body.url.includes("exp=120") && o.body.url.includes("download="));
    assertEquals(Object.keys(o.body).sort(), ["nazwa", "url"]);
    assertEquals([e.db.log.at(-1).akcja, e.db.log.at(-1).info.zrodlo, e.db.log.at(-1).info.id], ["pobranie", zrodlo, id]);
  }
  const n = e.db.log.length;
  const zle: [string, unknown, number?][] = [
    ["komplet", ID.wB1], ["komplet", ID.wA2 /* no packet */], ["historia", ID.histB], ["historia", ID.histApeln /* type not allowed */],
    ["akta", ID.aktaB], ["akta", ID.aktaAukryty /* not shared */], ["umowa", ID.umowaB], ["umowa", ID.umowaAukryta], ["zgloszenie", ID.zglB, 1],
    ["komplet", "../../etc"], ["nieznane", ID.wA1], ["akta", ID.wA1], ["umowa", null], ["zgloszenie", ID.zglB, 99],
  ];
  for (const [zrodlo, id, nn] of zle) {
    const o = await A(e, { action: "pobierz", nip: NIP_A, zrodlo, id, n: nn });
    assertEquals(o.status, 404, `${zrodlo} ${id}`);
    assertEquals(o.body.url, undefined);
  }
  assertEquals(e.db.log.length, n);
  // a document stops being available the moment the office takes the flag off
  e.db.flagi.akta.delete(ID.aktaA);
  assertEquals((await A(e, { action: "pobierz", nip: NIP_A, zrodlo: "akta", id: ID.aktaA })).status, 404);
  // HR documents are outside the scope of an accounting-only client even with the right NIP on the row
  e.db.akta.push({ id: "22222222-0000-4000-8000-000000000301", nip: NIP_C, status: "przypisany", path: "x/y.pdf", nazwa: "y.pdf" }); e.db.flagi.akta.add("22222222-0000-4000-8000-000000000301");
  assertEquals((await A(e, { action: "pobierz", nip: NIP_C, zrodlo: "akta", id: "22222222-0000-4000-8000-000000000301" })).status, 404);
});

Deno.test("ksiegi: zamknięcie miesiąca słowami klienta, bez notatek biura; rachunki; faktury tylko świeże", async () => {
  const e = env();
  const o = (await A(e, { action: "ksiegi", nip: NIP_A })).body;
  assertEquals(o.zamkniecia[0], { okres: "2026-09", dokumenty: { stan: "tak", kiedy: "2026-10-03" }, zaksiegowano: { stan: "tak", kiedy: "2026-10-06" }, deklaracje: { stan: "nie", kiedy: null }, zamkniety: { stan: "nie", kiedy: null } });
  assertEquals([o.zamkniecia[1].deklaracje.stan, o.zamkniecia[1].zamkniety.stan], ["nd", "tak"]);
  assertEquals([o.mikrorachunek.length, o.nrs, o.faktury.stan, o.faktury.lista.length], [26, "00000000000000000000000000", "ok", 2]);
  assertEquals(o.faktury.po_terminie, [{ waluta: "PLN", kwota: 1230 }]);
  assertEquals(o.onboarding.od_klienta.length, 1);
  const s = JSON.stringify(o);
  assert(!s.includes("NOTATKA") && !s.includes("@biuro.test") && !s.includes("uwagi"));
  e.db.sync = new Date(NOW - 30 * 3600000).toISOString();
  assertEquals((await A(e, { action: "ksiegi", nip: NIP_A })).body.faktury, { stan: "niedostepne" });
});

Deno.test("firma: dane z bazy klientów i rejestru, konta z dostępem; bez surowej odpowiedzi rejestru", async () => {
  const e = env();
  const o = (await A(e, { action: "firma", nip: NIP_A })).body;
  assertEquals([o.dane.nazwa, o.rejestr.krs, o.rejestr.zarzad[0]], ["Przykładowa Firma Testowa Sp. z o.o.", "0000000000", { imie_nazwisko: "Jan Testowy", funkcja: "Prezes Zarządu" }]);
  assertEquals(o.konta, [{ email: KONTO_A.email, ostatnie_logowanie: "2026-10-09T09:00:00.000Z", ja: true }]);
  assertEquals(o.powiadomienia, { email: KONTO_A.email, telegram: { link: "https://t.me/przykladowy_bot?start=TESTtoken1234567890" } });
  assertEquals(e.db.tg.at(-1), { kid: NIP_A, kto: "klient:" + KONTO_A.email, utworz: true });
  // anything that is not a plain t.me deep link is dropped; so is a failure of the other module
  for (const zly of ["javascript:alert(1)", "https://t.me.evil.test/x?start=aaaaaaaaaa", "http://t.me/bot?start=aaaaaaaaaa", "https://t.me/bot", null]) {
    e.db.tgLink = zly;
    assertEquals((await A(e, { action: "firma", nip: NIP_A })).body.powiadomienia.telegram, null);
  }
  e.d.store.telegramLink = () => Promise.reject(new Error("bot"));
  assertEquals((await A(e, { action: "firma", nip: NIP_A })).status, 200);
  const s = JSON.stringify(o);
  assert(!s.includes("tajne") && !s.includes(KONTO_B.email) && !s.includes("opiekun") && !s.includes("haslo"));
  assertEquals((await A(e, { action: "firma", nip: NIP_C })).body.rejestr, null);
});

Deno.test("zgloszenie_nowe: zapis, załączniki, zadanie dla właściwej osoby, dziennik", async () => {
  const e = env();
  const o = await A(e, { action: "zgloszenie_nowe", nip: NIP_A, kategoria: "kadry", rodzaj: "zmiana_pracownika", worker_id: ID.wA1, temat: "Zakończenie współpracy", tresc: "Ostatni dzień pracy: 31.10.2026." }, KONTO_A,
    [plik("wypowiedzenie skan.pdf", "application/pdf", PDF), plik("../../zdjecie<1>.png", "image/png", PNG)]);
  assertEquals([o.status, o.body.status], [200, "przyjete"]);
  const z = e.db.zgloszenia.find((x) => x.id === o.body.id);
  assertEquals([z.nip, z.email, z.kategoria, z.worker_name, z.zalaczniki.length, z.assignee], [NIP_A, KONTO_A.email, "kadry", "Oksana Testowa", 2, "kadrowa@biuro.test"]);
  // the stored name is the server's own; the client's file name is only a label
  assertEquals(z.zalaczniki.map((a: Any) => [a.path, a.mime, a.nazwa]), [[`${z.id}/1.pdf`, "application/pdf", "wypowiedzenie skan.pdf"], [`${z.id}/2.png`, "image/png", ".._.._zdjecie_1_.png"]]);
  assert(e.db.pliki.has(`klient-zgloszenia/${z.id}/1.pdf`) && e.db.pliki.has(`klient-zgloszenia/${z.id}/2.png`));
  const t = e.db.zadania[0];
  assertEquals([t.created_by, t.assignee, t.zrodlo, t.klucz, t.link, t.id], ["system", "kadrowa@biuro.test", "reczne", `klient:${z.id}`, `klienci.html?zgloszenie=${z.id}`, z.zadanie_id]);
  assert(/^[a-z0-9-]+\.html/.test(t.link) && t.opis.includes("Ostatni dzień pracy") && t.opis.includes("Oksana Testowa") && t.opis.includes(NIP_A) && t.opis.includes("wypowiedzenie skan.pdf") && t.opis.length <= 4000 && t.tytul.length <= 300);
  assertEquals([e.db.log.at(-1).akcja, e.db.log.at(-1).info.zalaczniki], ["zgloszenie", 2]);
  // the client's list: status and attachments, never the path, the task or who handles it
  const l = (await A(e, { action: "zgloszenia", nip: NIP_A })).body;
  assertEquals(l.zgloszenia.length, 1);
  assertEquals(Object.keys(l.zgloszenia[0]).sort(), ["autor", "id", "kategoria", "odpowiedz", "odpowiedz_at", "pracownik", "rodzaj", "status", "temat", "tresc", "utworzono", "zalaczniki"]);
  assertEquals(l.zgloszenia[0].zalaczniki, [{ n: 1, nazwa: "wypowiedzenie skan.pdf", rozmiar: PDF.length }, { n: 2, nazwa: ".._.._zdjecie_1_.png", rozmiar: PNG.length }]);
  assert(!JSON.stringify(l).includes("cudz") && !JSON.stringify(l).includes("@biuro.test"));
  // own attachment downloads, with a trace
  const d = await A(e, { action: "pobierz", nip: NIP_A, zrodlo: "zgloszenie", id: z.id, n: 2 });
  assertEquals(d.status, 200); assert(d.body.url.includes(`klient-zgloszenia/${z.id}/2.png`));
  // the status follows the task until the office sets it by hand
  t.status = "w_toku"; assertEquals((await A(e, { action: "zgloszenia", nip: NIP_A })).body.zgloszenia[0].status, "w_toku");
  t.status = "zrobione"; assertEquals((await A(e, { action: "zgloszenia", nip: NIP_A })).body.zgloszenia[0].status, "zalatwione");
  assertEquals((await A(e, { action: "start", nip: NIP_A })).body.liczby.zgloszenia_otwarte, 0);
});

Deno.test("zgloszenie_nowe: walidacja, cudzy pracownik -> 404, złe pliki, limity", async () => {
  const e = env();
  const base = { action: "zgloszenie_nowe", nip: NIP_A, kategoria: "inne", temat: "Pytanie", tresc: "Treść pytania" };
  for (const [zmiana, status] of [[{ kategoria: "x" }, 400], [{ rodzaj: "x" }, 400], [{ temat: " a " }, 400], [{ tresc: "" }, 400], [{ worker_id: ID.wB1 }, 404], [{ worker_id: "abc" }, 404]] as [Any, number][]) {
    assertEquals((await A(e, { ...base, ...zmiana })).status, status, JSON.stringify(zmiana));
  }
  const zlePliki: [Plik[], number, string][] = [
    [[plik("a.pdf", "application/pdf", new TextEncoder().encode("<html><script>alert(1)</script>"))], 400, "typ"],
    [[plik("a.svg", "image/svg+xml", new TextEncoder().encode("<svg onload=alert(1)>"))], 400, "typ"],
    [[plik("a.png", "image/png", PDF)], 400, "niezgodny"],
    [[plik("a.pdf", "", new Uint8Array(0))], 400, "pusty"],
    [[plik("a", "", PDF), plik("b", "", PDF), plik("c", "", PDF), plik("d", "", PDF)], 400, "liczba"],
  ];
  for (const [pl, status, kod] of zlePliki) { const o = await A(e, base, KONTO_A, pl); assertEquals([o.status, o.body.kod], [status, kod]); }
  const duzy = new Uint8Array(MAX_PLIK + 1); duzy.set(PDF);
  assertEquals((await A(e, base, KONTO_A, [plik("a.pdf", "application/pdf", duzy)])).status, 413);
  assertEquals([e.db.zgloszenia.length, e.db.pliki.size, e.db.zadania.length], [1, 0, 0]);
  // a failed upload leaves neither a request nor a half-stored file
  e.db.uploadOk = false;
  assertEquals((await A(e, base, KONTO_A, [plik("a.pdf", "", PDF)])).status, 502);
  assertEquals([e.db.zgloszenia.length, e.db.pliki.size], [1, 0]);
  e.db.uploadOk = true;
  // nobody to assign to: the request is kept, there is simply no task
  e.db.assignee = null;
  const bez = await A(e, base);
  assertEquals([bez.status, e.db.zadania.length, e.db.zgloszenia.at(-1).zadanie_id], [200, 0, null]);
  e.db.assignee = "kadrowa@biuro.test";
  // 3 per 10 minutes, 10 per day — per account
  assertEquals((await A(e, base)).status, 200); assertEquals((await A(e, base)).status, 200);
  assertEquals((await A(e, base)).body.kod, "limit");
  for (let i = 0; i < 7; i++) { e.tick(601000); assertEquals((await A(e, base)).status, 200, "nr " + i); }
  e.tick(601000);
  assertEquals((await A(e, base)).status, 429);
  // another account is not affected, and never sees these requests
  assertEquals((await A(e, { ...base, nip: NIP_B }, KONTO_B)).status, 200);
  assertEquals((await A(e, { action: "zgloszenia", nip: NIP_B }, KONTO_B)).body.zgloszenia.length, 2);
  e.tick(86400000);
  assertEquals((await A(e, base)).status, 200);
});

Deno.test("biuro: zgłoszenia według sekcji, status i odpowiedź, załącznik", async () => {
  const e = env();
  const n = await A(e, { action: "zgloszenie_nowe", nip: NIP_A, kategoria: "ksiegowosc", rodzaj: "dokumenty_ksiegowe", temat: "Faktury za wrzesień", tresc: "W załączniku." }, KONTO_A, [plik("faktury.pdf", "", PDF)]);
  const id = n.body.id;
  const lista = async (s: Staff) => (await biuroAkcja(e.d, s, { action: "biuro_zgloszenia" }));
  assertEquals((await lista(admin)).body.zgloszenia.length, 2);
  assertEquals((await lista(ksiegowa)).body.zgloszenia.map((z: Any) => z.id), [id]);
  assertEquals((await lista(kadrowa)).body.zgloszenia.map((z: Any) => z.id), [ID.zglB]);
  assertEquals((await lista(bezSekcji)).status, 403);
  assert(!JSON.stringify((await lista(admin)).body).includes("path"));
  // a request outside the caller's sections does not exist for the caller
  assertEquals((await biuroAkcja(e.d, kadrowa, { action: "biuro_zgloszenie", id, status: "w_toku" })).status, 404);
  assertEquals((await biuroAkcja(e.d, kadrowa, { action: "biuro_zalacznik", id, n: 1 })).status, 404);
  assertEquals((await biuroAkcja(e.d, ksiegowa, { action: "biuro_zgloszenie", id, status: "zle" })).status, 400);
  assertEquals((await biuroAkcja(e.d, ksiegowa, { action: "biuro_zgloszenie", id })).status, 400);
  assertEquals((await biuroAkcja(e.d, ksiegowa, { action: "biuro_zgloszenie", id: "x" })).status, 404);
  assertEquals((await biuroAkcja(e.d, ksiegowa, { action: "biuro_zgloszenie", id, status: "zalatwione", odpowiedz: "Zaksięgowano, dziękujemy." })).status, 200);
  const k = (await A(e, { action: "zgloszenia", nip: NIP_A })).body.zgloszenia[0];
  assertEquals([k.status, k.odpowiedz, k.odpowiedz_at], ["zalatwione", "Zaksięgowano, dziękujemy.", "2026-10-09T10:00:00.000Z"]);
  assert(!JSON.stringify(k).includes("ksiegowa@"));
  const f = await biuroAkcja(e.d, ksiegowa, { action: "biuro_zalacznik", id, n: 1 });
  assertEquals(f.status, 200); assert(f.body.url.includes(`${id}/1.pdf`));
  assertEquals((await biuroAkcja(e.d, ksiegowa, { action: "biuro_zalacznik", id, n: 2 })).status, 404);
  assertEquals(e.db.log.filter((l) => l.akcja.startsWith("biuro_")).map((l) => [l.akcja, l.info.by]), [["biuro_zgloszenie", "ksiegowa@biuro.test"], ["biuro_pobranie", "ksiegowa@biuro.test"]]);
});

Deno.test("biuro: udostępnianie dokumentów klientowi — akta: kadry, umowy: administrator", async () => {
  const e = env();
  const u = (s: Staff, zrodlo: string, id: unknown, on: boolean) => biuroAkcja(e.d, s, { action: "biuro_udostepnij", zrodlo, id, udostepnij: on });
  assertEquals((await u(ksiegowa, "akta", ID.aktaAukryty, true)).status, 403);
  assertEquals((await u(kadrowa, "umowa", ID.umowaAukryta, true)).status, 403);
  assertEquals((await u(kadrowa, "inne", ID.aktaAukryty, true)).status, 400);
  assertEquals((await u(kadrowa, "akta", "22222222-0000-4000-8000-999999999999", true)).status, 404);
  assertEquals((await u(kadrowa, "akta", ID.umowaA, true)).status, 404);
  assertEquals((await u(kadrowa, "akta", ID.aktaAukryty, true)).body, { ok: true, udostepniony: true });
  assertEquals((await A(e, { action: "pobierz", nip: NIP_A, zrodlo: "akta", id: ID.aktaAukryty })).status, 200);
  // anything but `true` takes the flag off
  assertEquals((await u(kadrowa, "akta", ID.aktaAukryty, "tak" as Any)).body.udostepniony, false);
  assertEquals((await A(e, { action: "pobierz", nip: NIP_A, zrodlo: "akta", id: ID.aktaAukryty })).status, 404);
  assertEquals((await u(admin, "umowa", ID.umowaAukryta, true)).status, 200);
  assertEquals((await A(e, { action: "dokumenty", nip: NIP_A })).body.umowy.length, 2);
  const lista = await biuroAkcja(e.d, kadrowa, { action: "biuro_udostepnione", zrodlo: "akta", ids: [ID.aktaA, ID.aktaAukryty, "śmieci", 5] });
  assertEquals(lista.body, { udostepnione: [ID.aktaA] });
  assertEquals((await biuroAkcja(e.d, kadrowa, { action: "biuro_udostepnione", zrodlo: "umowa", ids: [ID.umowaA] })).status, 403);
  assertEquals(e.db.log.filter((l) => l.akcja === "biuro_udostepnienie").length, 3);
});

Deno.test("biuro_podglad: tylko administrator, tylko odczyt, bez odsłaniania i plików", async () => {
  const e = env();
  const p = (s: Staff, akcja: Any, nip = NIP_A) => biuroAkcja(e.d, s, { action: "biuro_podglad", nip, akcja });
  assertEquals((await p(kadrowa, { action: "start" })).status, 403);
  const st = await p(admin, { action: "start", nip: NIP_B /* ignored: the outer NIP decides */ });
  assertEquals([st.status, st.body.firma.nip, st.body.poprzednie_logowanie], [200, NIP_A, null]);
  assertEquals(e.db.log.at(-1), { at: "2026-10-09T10:00:00.000Z", konto_id: null, email: null, akcja: "podglad_biura", info: { by: "admin@biuro.test", nip: NIP_A } });
  assertEquals((await p(admin, { action: "pracownik", id: ID.wA1 })).status, 200);
  assertEquals((await p(admin, { action: "pracownik", id: ID.wB1 })).status, 404);
  for (const akcja of [{ action: "pracownik_pokaz", id: ID.wA1, pole: "pesel" }, { action: "pobierz", zrodlo: "komplet", id: ID.wA1 }, { action: "zgloszenie_nowe", kategoria: "inne", temat: "abc", tresc: "abc" }, { action: "me" }, {}]) {
    assertEquals((await p(admin, akcja)).status, 400, JSON.stringify(akcja));
  }
  assertEquals((await p(admin, { action: "start" }, "123")).status, 400);
  assertEquals(e.db.zgloszenia.length, 1);
  assertEquals((await biuroAkcja(e.d, admin, { action: "biuro_cos" })).status, 400);
});

Deno.test("zgłoszenie niesprawdzone przez biuro (status nowe): tylko licznik — bez nazwiska, karty, odsłaniania i plików", async () => {
  // twice: with the store filtering by status, and with a store that "forgot" to — the handlers refuse on their own
  for (const surowe of [false, true]) {
    const e = env(); e.db.surowe = surowe;
    const st = (await A(e, { action: "start", nip: NIP_A })).body;
    assertEquals([st.liczby.w_weryfikacji, st.liczby.w_trakcie, st.liczby.pracownicy], [1, 2, 4]);
    const lista = (await A(e, { action: "pracownicy", nip: NIP_A })).body;
    assertEquals([lista.w_weryfikacji, lista.pracownicy.some((p: Any) => p.id === ID.wAnowe)], [1, false]);
    const dok = (await A(e, { action: "dokumenty", nip: NIP_A })).body;
    for (const o of [st, lista, dok]) { const s = JSON.stringify(o); assert(!s.includes("PODRZUCONY") && !s.includes("Niezweryfikowany") && !s.includes("88888888880") && !s.includes(ID.wAnowe), "surowe=" + surowe); }
    assertEquals((await A(e, { action: "pracownik", nip: NIP_A, id: ID.wAnowe })).status, 404);
    for (const pole of ["pesel", "dokument", "konto"]) assertEquals((await A(e, { action: "pracownik_pokaz", nip: NIP_A, id: ID.wAnowe, pole })).status, 404);
    assertEquals((await A(e, { action: "pobierz", nip: NIP_A, zrodlo: "komplet", id: ID.wAnowe })).status, 404);
    assertEquals((await A(e, { action: "zgloszenie_nowe", nip: NIP_A, kategoria: "kadry", temat: "Zmiana", tresc: "Treść", worker_id: ID.wAnowe })).status, 404);
    assertEquals([e.db.log.length, e.db.zgloszenia.length], [0, 1]);
    // the moment the office has checked it, it is an ordinary worker "in progress"
    e.db.workers.find((w) => w.id === ID.wAnowe)!.status = "sprawdzone";
    assertEquals((await A(e, { action: "pracownik", nip: NIP_A, id: ID.wAnowe })).status, 200);
    assertEquals((await A(e, { action: "start", nip: NIP_A })).body.liczby.w_weryfikacji, 0);
  }
  // a new submission under ANOTHER firm's NIP is not that firm's either
  const e = env(); e.db.workers.push({ id: "11111111-0000-4000-8000-000000000201", worker_name: "Realna Osoba", status: "nowe", created_at: "2026-10-09T00:00:00Z", payload: { z_nip: NIP_B, p_pesel: "77777777770" } });
  assertEquals((await A(e, { action: "pracownik_pokaz", nip: NIP_B, id: "11111111-0000-4000-8000-000000000201", pole: "pesel" }, KONTO_B)).status, 404);
  assert(!JSON.stringify((await A(e, { action: "pracownicy", nip: NIP_B }, KONTO_B)).body).includes("Realna"));
});

Deno.test("ścieżka pliku z pola JSON nie trafia do Storage bez sprawdzenia", async () => {
  const e = env();
  assertEquals([okSciezka("umowa-zlecenie/2026-10-09/3f2a.pdf"), okSciezka("../akta-osobowe/x/y.pdf"), okSciezka("umowa-zlecenie/../../akta-osobowe/a.pdf"), okSciezka("akta-osobowe/skan.pdf"), okSciezka("a/2026-10-09/b.pdf?x=1"), okSciezka(null), okSciezka({})], [true, false, false, false, false, false, false]);
  assertEquals((await A(e, { action: "pobierz", nip: NIP_A, zrodlo: "komplet", id: ID.wAzla })).status, 404);
  assertEquals((await A(e, { action: "pracownik", nip: NIP_A, id: ID.wAzla })).body.dokumenty.komplet, null);
  assert(!(await A(e, { action: "dokumenty", nip: NIP_A })).body.komplety.some((x: Any) => x.id === ID.wAzla));
  e.db.historia.find((h) => h.id === ID.histA)!.pdf_path = "../klienci-umowy/x/umowa.pdf";
  assertEquals((await A(e, { action: "pobierz", nip: NIP_A, zrodlo: "historia", id: ID.histA })).status, 404);
  assertEquals(e.db.log.length, 0);
});

Deno.test("biuro_podglad: każda akcja zapisu, odsłonięcia i pobrania odmówiona; nic nie zostaje zmienione", async () => {
  const e = env();
  const p = (s: Staff, akcja: Any) => biuroAkcja(e.d, s, { action: "biuro_podglad", nip: NIP_A, akcja });
  // not an administrator: every inner action refused, whatever the sections
  for (const s of [kadrowa, ksiegowa, bezSekcji]) for (const action of ["start", "pracownicy", "pracownik", "dokumenty", "ksiegi", "zgloszenia", "firma"]) assertEquals((await p(s, { action, id: ID.wA1 })).status, 403);
  const przed = JSON.stringify([e.db.zgloszenia, e.db.zadania, [...e.db.pliki.keys()], [...e.db.flagi.akta], [...e.db.flagi.umowa]]);
  const zakazane: Any[] = [];
  for (const pole of ["pesel", "dokument", "konto"]) zakazane.push({ action: "pracownik_pokaz", id: ID.wA1, pole });
  for (const [zrodlo, id] of [["komplet", ID.wA1], ["historia", ID.histA], ["akta", ID.aktaA], ["umowa", ID.umowaA], ["zgloszenie", ID.zglB]]) zakazane.push({ action: "pobierz", zrodlo, id, n: 1 });
  zakazane.push({ action: "zgloszenie_nowe", kategoria: "kadry", temat: "Temat", tresc: "Treść" }, { action: "logout" }, { action: "haslo_ustaw", haslo: "x" }, { action: "biuro_udostepnij", zrodlo: "akta", id: ID.aktaAukryty, udostepnij: true }, { action: "biuro_podglad", nip: NIP_B, akcja: { action: "start" } }, { action: "konto_zapisz" });
  for (const akcja of zakazane) { const o = await p(admin, akcja); assertEquals(o.status, 400, JSON.stringify(akcja)); assert(!JSON.stringify(o.body).includes("99999999990") && !o.body.url); }
  // and even called directly with the preview's pseudo-account the handlers themselves refuse
  const pseudo = { id: "", email: admin.email, nip: [NIP_A], nazwa: "podgląd" };
  assertEquals((await A(e, { action: "pracownik_pokaz", nip: NIP_A, id: ID.wA1, pole: "pesel" }, pseudo)).status, 403);
  assertEquals((await A(e, { action: "pobierz", nip: NIP_A, zrodlo: "komplet", id: ID.wA1 }, pseudo)).status, 403);
  assertEquals((await A(e, { action: "zgloszenie_nowe", nip: NIP_A, kategoria: "kadry", temat: "Temat", tresc: "Treść" }, pseudo)).status, 403);
  assertEquals(JSON.stringify([e.db.zgloszenia, e.db.zadania, [...e.db.pliki.keys()], [...e.db.flagi.akta], [...e.db.flagi.umowa]]), przed);
  // reading works, is logged, the card stays masked, and the Telegram link is only read — never created
  assertEquals((await p(admin, { action: "start" })).status, 200);
  const karta = await p(admin, { action: "pracownik", id: ID.wA1 });
  assert(karta.status === 200 && !JSON.stringify(karta.body).includes("99999999990"));
  assertEquals((await p(admin, { action: "firma" })).status, 200);
  assertEquals(e.db.tg.at(-1), { kid: NIP_A, kto: admin.email, utworz: false });
  assertEquals(e.db.log.map((l) => [l.akcja, l.info.by]), [["podglad_biura", admin.email]]);
});
