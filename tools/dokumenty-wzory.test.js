// Test katalogu pojedynczych dokumentów kadrowych (dokumenty-wzory.js).
// Uruchomienie: node tools/dokumenty-wzory.test.js   (bez zależności; kod wyjścia 1 przy błędzie)
// Dane w teście są fikcyjne: „Jan Testowy”, „Przykładowa Firma Testowa Sp. z o.o.”, NIP 0000000000.
'use strict';
const fs = require('fs');
const path = require('path');
const K = require(path.join(__dirname, '..', 'dokumenty-wzory.js'));

let failed = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failed++; console.error('  BŁĄD: ' + msg); } }

const TYPY_ZRODLA = ['urzedowy', 'ustawowy', 'biuro', 'link'];
const KATEGORIE = ['pisemna', 'dokumentowa', 'bez_podpisu'];
const PODPISUJE = ['obie', 'pracodawca', 'pracownik', 'potwierdzenie'];
const METODY = ['odreczny', 'kwalifikowany', 'zaufany'];
const RODZAJE_PODPISY = ['umowa_praca', 'aneks_praca', 'umowa_zlecenie', 'aneks_zlecenie', 'tlumaczenie', 'zwiazki_info', 'rozwiazanie',
  'ppk_rezygnacja', 'odpowiedzialnosc', 'pit2', 'kwestionariusz', 'oswiadczenie', 'zgoda_rodo', 'informacja_warunki', 'inny',
  'zakaz_konkurencji', 'kara_porzadkowa', 'zgoda_potracenie', 'swiadectwo_pracy', 'skierowanie_badania', 'upowaznienie_rodo', 'oswiadczenie_cudz_tresc',
  'ppk_wniosek', 'wypowiedzenie_zlecenia', 'informacja_monitoring', 'informacja_dokumentacja', 'informacja_dok_pobytowy'];
const TYPY_POL = ['tekst', 'dlugi', 'data', 'kwota', 'liczba', 'wybor', 'pesel', 'nip', 'regon', 'iban', 'email'];
const TYPY_BLOKOW = Object.keys(K.BLOKI);
const KLUCZE = ['id', 'nazwa', 'grupa', 'dla', 'zrodlo', 'podstawa', 'forma', 'pola', 'tresc', 'uwagi', 'dwujezyczny', 'do_zatwierdzenia', 'zweryfikowano'];
const ELI = /^(DU|MP)\/\d{4}\/\d+$/;

// identyfikatory dokumentów istniejących w generatorze kompletu (tylko odczyt pliku)
const src = fs.readFileSync(path.join(__dirname, '..', 'umowa-zlecenie.js'), 'utf8');
const mField = /const DOC_FIELD = \{([\s\S]*?)\};/.exec(src);
const KOMPLET = mField ? Array.from(mField[1].matchAll(/(\w+):\s*'doc_/g)).map((m) => m[1]) : [];
ok(KOMPLET.length > 10, 'nie udało się odczytać DOC_FIELD z umowa-zlecenie.js');

// 1) identyfikatory
const ids = K.wzory.map((d) => d.id);
ok(new Set(ids).size === ids.length, 'identyfikatory dokumentów nie są unikalne: ' + ids.filter((x, i) => ids.indexOf(x) !== i).join(', '));
ok(K.pominiete.every((p) => p.id && p.nazwa && p.powod && ids.indexOf(p.id) === -1), 'lista pominiętych: brak pól albo id koliduje z katalogiem');

const licz = { urzedowy: 0, ustawowy: 0, biuro: 0, link: 0 };
let renderow = 0;

K.wzory.forEach((d) => {
  const t = '[' + d.id + '] ';
  KLUCZE.forEach((k) => ok(d[k] !== undefined, t + 'brak klucza ' + k));
  ok(/^[a-z0-9-]+$/.test(d.id), t + 'id tylko małe litery, cyfry i myślniki');
  ok(K.GRUPY.indexOf(d.grupa) !== -1, t + 'nieznana grupa: ' + d.grupa);
  ok(['pracownik', 'zleceniobiorca', 'oba'].indexOf(d.dla) !== -1, t + 'pole dla: ' + d.dla);
  ok(TYPY_ZRODLA.indexOf(d.zrodlo.typ) !== -1, t + 'typ źródła: ' + d.zrodlo.typ);
  ok(d.zweryfikowano === '2026-10-09', t + 'data weryfikacji');
  licz[d.zrodlo.typ]++;

  // forma
  ok(KATEGORIE.indexOf(d.forma.kategoria) !== -1, t + 'kategoria formy');
  ok(PODPISUJE.indexOf(d.forma.podpisuje) !== -1, t + 'forma.podpisuje');
  ok(Array.isArray(d.forma.metody) && d.forma.metody.every((m) => METODY.indexOf(m) !== -1), t + 'forma.metody');
  ok(d.forma.kategoria !== 'pisemna' || d.forma.metody.indexOf('zaufany') === -1, t + 'forma pisemna nie może dopuszczać podpisu zaufanego');
  ok(d.forma.kategoria !== 'bez_podpisu' || d.forma.metody.length === 0, t + 'bez_podpisu nie ma metod');
  ok(typeof d.forma.podstawa === 'string' && d.forma.podstawa.length > 10, t + 'forma.podstawa');
  ok(RODZAJE_PODPISY.indexOf(d.forma.rodzaj_podpisy) !== -1, t + 'forma.rodzaj_podpisy spoza listy modułu podpisów: ' + d.forma.rodzaj_podpisy);
  ok(!d.forma.cudzoziemiec || KATEGORIE.indexOf(d.forma.cudzoziemiec) !== -1, t + 'forma.cudzoziemiec');

  // dwujęzyczność
  ok(d.dwujezyczny && ['wymagany', 'zalecany', 'nie'].indexOf(d.dwujezyczny.poziom) !== -1, t + 'dwujezyczny.poziom');
  ok(d.dwujezyczny.poziom !== 'wymagany' || !!d.dwujezyczny.podstawa, t + 'dwujezyczny wymagany — brak podstawy');
  ok(typeof d.dwujezyczny.uwaga === 'string' && d.dwujezyczny.uwaga.length > 5, t + 'dwujezyczny.uwaga');

  // podstawa prawna
  d.podstawa.forEach((p) => ok(p.art && p.akt && p.eli && p.zweryfikowano === '2026-10-09', t + 'niepełna pozycja podstawy prawnej'));
  d.podstawa.forEach((p) => ok(Object.keys(K.AKTY).some((k) => K.AKTY[k].eli === p.eli), t + 'ELI spoza tabeli AKTY: ' + p.eli));

  if (d.zrodlo.typ === 'ustawowy' || d.zrodlo.typ === 'urzedowy') {
    ok(d.do_zatwierdzenia === true, t + 'do_zatwierdzenia musi być true');
    ok(d.podstawa.length > 0 && d.podstawa.some((p) => ELI.test(p.eli)), t + 'brak podstawy z identyfikatorem ELI');
    ok(d.tresc.length > 0, t + 'brak treści');
    ok(d.uwagi.length > 0, t + 'brak uwag dla kadrowej');
    if (d.zrodlo.typ === 'ustawowy') ok(typeof d.zrodlo.elementy === 'string' && d.zrodlo.elementy.length > 20, t + 'brak opisu elementów ustawowych');
    if (d.zrodlo.typ === 'urzedowy') ok(!!d.zrodlo.akt && ELI.test(d.zrodlo.eli) && (!!d.zrodlo.zalacznik || /^https:\/\/www\.gov\.pl\//.test(d.zrodlo.url || '')), t + 'źródło urzędowe: akt + załącznik albo adres gov.pl');
  }
  if (d.zrodlo.typ === 'biuro') {
    ok(d.tresc.length === 0, t + 'dokument biura nie powinien mieć własnej treści');
    ok(d.zrodlo.komplet_id === null || KOMPLET.indexOf(d.zrodlo.komplet_id) !== -1, t + 'komplet_id nie istnieje w umowa-zlecenie.js: ' + d.zrodlo.komplet_id);
    ok(d.do_zatwierdzenia === false, t + 'do_zatwierdzenia false dla dokumentu biura');
  }
  if (d.zrodlo.typ === 'link') {
    ok(/^https:\/\//.test(d.zrodlo.url || ''), t + 'brak adresu https');
    ok(typeof d.zrodlo.jak_zlozyc === 'string' && d.zrodlo.jak_zlozyc.length > 20, t + 'brak opisu sposobu złożenia');
    ok(d.tresc.length === 0, t + 'odsyłacz nie ma treści');
  }

  // pola
  const pid = d.pola.map((p) => p.id);
  ok(new Set(pid).size === pid.length, t + 'powtórzone pola: ' + pid.filter((x, i) => pid.indexOf(x) !== i).join(', '));
  d.pola.forEach((p) => {
    ok(TYPY_POL.indexOf(p.typ) !== -1, t + 'typ pola ' + p.id + ': ' + p.typ);
    ok(typeof p.etykieta === 'string' && p.etykieta.length > 1, t + 'etykieta pola ' + p.id);
    ok(typeof p.wymagane === 'boolean', t + 'pole.wymagane ' + p.id);
    if (p.typ === 'wybor') ok(Array.isArray(p.opcje) && p.opcje.length >= 2 && p.opcje.every((o) => o.v !== undefined && o.etykieta), t + 'opcje pola ' + p.id);
    if (p.wymagane_gdy) ok(pid.indexOf(p.wymagane_gdy.pole) !== -1, t + 'wymagane_gdy wskazuje nieistniejące pole w ' + p.id);
  });

  // treść: typy bloków, placeholdery i warunki muszą wskazywać zadeklarowane pola
  d.tresc.forEach((b) => ok(TYPY_BLOKOW.indexOf(b.t) !== -1, t + 'nieznany typ bloku: ' + b.t));
  K.placeholdery(d).forEach((id) => ok(pid.indexOf(id) !== -1, t + 'placeholder {{' + id + '}} nie jest zadeklarowany w pola'));
  K.polaWarunkow(d).forEach((id) => ok(pid.indexOf(id) !== -1, t + 'warunek odwołuje się do niezadeklarowanego pola ' + id));
  if (d.tresc.length) {
    const uzyte = new Set(K.placeholdery(d).concat(K.polaWarunkow(d)));
    pid.forEach((id) => ok(uzyte.has(id), t + 'pole ' + id + ' nie jest użyte w treści ani w warunkach'));
    ok(d.tresc.some((b) => b.t === 'tytul'), t + 'brak tytułu');
    ok(d.tresc.some((b) => b.t === 'podpisy' || (b.t === 'tabela' && b.kolumny.some((k) => /Podpis/.test(k)))) || d.forma.kategoria === 'bez_podpisu', t + 'brak bloku podpisów');
  }

  // render: dane fikcyjne, każda opcja każdego pola wyboru co najmniej raz
  if (!d.tresc.length) return;
  const warianty = [{}];
  d.pola.filter((p) => p.typ === 'wybor').forEach((p) => p.opcje.forEach((o) => { const w = {}; w[p.id] = o.v; warianty.push(w); }));
  warianty.forEach((w) => {
    const dane = K.przyklad(d, w);
    let r;
    try { r = K.render(d.id, dane); } catch (e) { ok(false, t + 'render rzucił wyjątek: ' + e.message); return; }
    renderow++;
    const wn = JSON.stringify(w);
    ok(r.tekst.indexOf('{{') === -1 && r.tekst.indexOf('}}') === -1, t + 'pozostał placeholder w tekście ' + wn);
    ok(r.tekst.indexOf('undefined') === -1 && r.tekst.indexOf('[object') === -1 && r.tekst.indexOf('NaN') === -1, t + 'śmieci w tekście ' + wn);
    ok(JSON.stringify(r.bloki).indexOf('{{') === -1, t + 'pozostał placeholder w blokach ' + wn);
    ok(r.bledy.length === 0, t + 'dane przykładowe nie przechodzą walidacji ' + wn + ': ' + r.bledy.map((b) => b.blad).join('; '));
    ok(r.tekst.indexOf('Jan Testowy') !== -1 || pid.indexOf('p_imie_nazwisko') === -1, t + 'brak danych osoby w tekście ' + wn);
    ok(r.tekst.length > 150, t + 'podejrzanie krótki tekst ' + wn);
    // wypełnione pola obowiązkowe nie mogą dać wykropkowanej luki w akapitach (tabele i wzory urzędowe mają własne kropki)
    r.bloki.filter((b) => b.t === 'p' && b.tekst.indexOf('........') !== -1).forEach((b) => ok(d.zrodlo.typ === 'urzedowy' || /\.{8}/.test(b.tekst) === false, t + 'luka w akapicie mimo pełnych danych: ' + b.tekst.slice(0, 80)));
  });
  // puste dane: render nie może się wysypać, a walidacja ma zgłosić braki
  const pustyRender = K.render(d.id, {});
  ok(pustyRender.tekst.indexOf('{{') === -1, t + 'placeholder przy pustych danych');
  ok(pustyRender.bledy.length > 0, t + 'walidacja nie zgłasza braków przy pustych danych');
  // wstępne wypełnienie z rejestru nie może się wysypać
  const zr = K.zRejestru(d, { z_nazwa: 'Przykładowa Firma Testowa Sp. z o.o.', z_ulica: 'ul. Przykładowa 1/2', z_miasto: '00-000 Warszawa', z_nip: '0000000000', p_imiona: 'Jan', p_nazwisko: 'Testowy', a_ulica: 'ul. Testowa', a_nrdom: '3', a_nrmiesz: '4', a_kod: '00-000', a_miejscowosc: 'Warszawa' });
  if (pid.indexOf('p_imie_nazwisko') !== -1) ok(zr.p_imie_nazwisko === 'Jan Testowy', t + 'zRejestru: imię i nazwisko');
  if (pid.indexOf('z_siedziba') !== -1) ok(zr.z_siedziba === 'ul. Przykładowa 1/2, 00-000 Warszawa', t + 'zRejestru: siedziba');
  if (pid.indexOf('p_adres') !== -1) ok(zr.p_adres === 'ul. Testowa 3/4, 00-000 Warszawa', t + 'zRejestru: adres');
});

// 2) treść obowiązkowa z przepisów — kontrola dosłownych sformułowań
function tekst(id, w) { return K.render(id, K.przyklad(K.get(id), w || {})).tekst; }
const wyp = tekst('wypowiedzenie-umowy-o-prace-pracodawca', { rodzaj_umowy: 'okreslony' });
ok(/w terminie 21 dni od dnia doręczenia niniejszego pisma przysługuje Panu\/Pani prawo wniesienia odwołania do Sądu Rejonowego – Sądu Pracy/.test(wyp), 'wypowiedzenie: pouczenie o odwołaniu (art. 30 § 5, art. 264 § 1 KP)');
ok(/Przyczyną wypowiedzenia umowy o pracę jest/.test(wyp), 'wypowiedzenie: przyczyna przy umowie na czas określony (art. 30 § 4 KP)');
ok(!/Przyczyną wypowiedzenia/.test(tekst('wypowiedzenie-umowy-o-prace-pracodawca', { rodzaj_umowy: 'probny' })), 'wypowiedzenie: przy okresie próbnym bez przyczyny');
ok(/art\. 36¹ § 1/.test(tekst('wypowiedzenie-umowy-o-prace-pracodawca', { skrocony: 'tak' })), 'wypowiedzenie: skrócony okres');
ok(/żądania przywrócenia do pracy lub odszkodowania/.test(tekst('rozwiazanie-bez-wypowiedzenia-pracodawca')), 'rozwiązanie bez wypowiedzenia: pouczenie (art. 264 § 2 KP)');
const zm = tekst('wypowiedzenie-zmieniajace', { rodzaj_umowy: 'nieokreslony' });
ok(/przed upływem połowy okresu wypowiedzenia/.test(zm) && /równoznaczne z wyrażeniem zgody/.test(zm), 'wypowiedzenie zmieniające: pouczenie z art. 42 § 3 KP');
const sw = tekst('swiadectwo-pracy');
ok(sw.indexOf('Pracownik może w ciągu 14 dni od otrzymania świadectwa pracy wystąpić z wnioskiem do pracodawcy o sprostowanie świadectwa pracy. W razie nieuwzględnienia wniosku pracownikowi przysługuje, w ciągu 14 dni od zawiadomienia o odmowie sprostowania świadectwa pracy, prawo wystąpienia z żądaniem jego sprostowania do sądu pracy. W przypadku niezawiadomienia przez pracodawcę o odmowie sprostowania świadectwa pracy, żądanie sprostowania świadectwa pracy wnosi się do sądu pracy.') !== -1, 'świadectwo pracy: pouczenie dosłownie z wzoru urzędowego');
ok(/art\. 97 § 2¹ Kodeksu pracy/.test(sw), 'świadectwo pracy: podstawa pouczenia');
const kara = tekst('kara-porzadkowa', { kara: 'pieniezna' });
ok(/w ciągu 7 dni od dnia zawiadomienia o ukaraniu wnieść sprzeciw/.test(kara) && /14 dni/.test(kara) && /art\. 108 § 2/.test(kara), 'kara porządkowa: pouczenie o sprzeciwie (art. 110, 112 KP)');
const inf = tekst('informacja-przechowywanie-dokumentacji');
ok(/okresie przechowywania/.test(inf) && /możliwości odbioru/.test(inf) && /zniszczeniu dokumentacji pracowniczej/.test(inf), 'informacja z art. 94⁶ KP: trzy elementy');
ok(/w wersji dla mnie zrozumiałej/.test(tekst('cudzoziemiec-oswiadczenie-zrozumiala-tresc')), 'oświadczenie cudzoziemca: art. 5 ust. 2');
ok(K.get('cudzoziemiec-oswiadczenie-zrozumiala-tresc').dwujezyczny.poziom === 'wymagany', 'oświadczenie cudzoziemca musi być dwujęzyczne');
ok(K.formaDla(K.get('umowa-zlecenia'), true).kategoria === 'pisemna' && K.formaDla(K.get('umowa-zlecenia'), false).kategoria === 'dokumentowa', 'umowa zlecenia: forma pisemna dla cudzoziemca');
ok(K.dataPL('2026-10-09') === '9 października 2026 r.' && K.kwotaPL('1234.5') === '1 234,50', 'formatowanie daty i kwoty');

console.log('Dokumenty w katalogu: ' + K.wzory.length + ' (urzędowy: ' + licz.urzedowy + ', ustawowy: ' + licz.ustawowy + ', biuro: ' + licz.biuro + ', link: ' + licz.link + '), pominięte: ' + K.pominiete.length);
console.log('Dokumenty z treścią: ' + K.generowane().length + ', wyrenderowane warianty: ' + renderow + ', sprawdzeń: ' + checks);
if (failed) { console.error('NIEZALICZONE: ' + failed); process.exit(1); }
console.log('OK');
