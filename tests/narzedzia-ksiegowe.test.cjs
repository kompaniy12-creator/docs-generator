// node --test tests/narzedzia-ksiegowe.test.cjs
// Pure functions of narzedzia-ksiegowe.js used by the register of VAT checks. Fictional data only
// (apart from the office's own NIP).
const test = require('node:test'), assert = require('node:assert/strict');
const N = require('../narzedzia-ksiegowe.js');

const NIP = '7831916366', KONTO = '56101000712222783191636600';
const wiersz = (x) => Object.assign({ id: '00000000-0000-4000-8000-000000000001', created_at: '2026-10-09T08:15:30.000Z', kto: 'ksiegowa@example.test' }, x);
const SZUKANIE = wiersz({ rodzaj: 'wl_search', zapytanie: { by: 'nip', value: NIP, date: '2026-10-09' }, nip: NIP, nazwa: 'PRZYKŁADOWA "ALFA" SP. Z O.O.', wynik: 'Czynny', na_dzien: '2026-10-09',
  request_id: 'abcde-1234567', request_time: '09-10-2026 10:15:30',
  szczegoly: { podmioty: [{ nazwa: 'PRZYKŁADOWA "ALFA" SP. Z O.O.', nip: NIP, status: 'Czynny', konta: [KONTO] }], requestId: 'abcde-1234567', requestDateTime: '09-10-2026 10:15:30', date: '2026-10-09' } });
const PARA = wiersz({ rodzaj: 'wl_check', zapytanie: { nip: NIP, konto: KONTO, date: '2026-10-09' }, nip: NIP, nazwa: null, wynik: 'NIE', na_dzien: '2026-10-09', request_id: 'x-3', request_time: '09-10-2026 10:16:00',
  szczegoly: { przypisany: 'NIE', nip: NIP, konto: KONTO, date: '2026-10-09', requestId: 'x-3', requestDateTime: '09-10-2026 10:16:00' } });
const VIES = wiersz({ rodzaj: 'vies', zapytanie: { kraj: 'DE', numer: '123456789', wlasny: 'PL' + NIP }, nip: 'DE123456789', nazwa: 'BEISPIEL GMBH', wynik: 'ważny', na_dzien: '2026-10-09', request_id: 'WAPIAAAAtest', request_time: '2026-10-09T08:15:30Z',
  szczegoly: { wazny: true, kraj: 'DE', numer: '123456789', nazwa: 'BEISPIEL GMBH', adres: 'MUSTERSTR. 1\n10115 BERLIN', dataZapytania: '2026-10-09T08:15:30Z', identyfikator: 'WAPIAAAAtest', zWlasnym: 'PL' + NIP } });
const BLAD = wiersz({ rodzaj: 'vies', zapytanie: { kraj: 'DE', numer: '123456789', wlasny: null }, nip: 'DE123456789', nazwa: null, wynik: 'błąd MS_UNAVAILABLE', na_dzien: '2026-10-09', request_id: null, request_time: null,
  szczegoly: { error: 'Baza VAT wybranego państwa jest chwilowo niedostępna. [MS_UNAVAILABLE]', kod: 'MS_UNAVAILABLE' } });

test('csvPole: cudzysłowy, średniki, nowe linie', () => {
  assert.equal(N.csvPole('zwykły tekst'), '"zwykły tekst"');
  assert.equal(N.csvPole('a;b'), '"a;b"');
  assert.equal(N.csvPole('SPÓŁKA "ALFA"'), '"SPÓŁKA ""ALFA"""');
  assert.equal(N.csvPole('linia1\nlinia2'), '"linia1\nlinia2"');
  assert.equal(N.csvPole(null), '""'); assert.equal(N.csvPole(undefined), '""'); assert.equal(N.csvPole(0), '"0"');
});
test('csvPole: wartości zaczynające się od = + - @ nie stają się formułą', () => {
  assert.equal(N.csvPole('=HYPERLINK("http://x.test";"kliknij")'), '"\'=HYPERLINK(""http://x.test"";""kliknij"")"');
  assert.equal(N.csvPole('+48 600 000 000'), '"\'+48 600 000 000"');
  assert.equal(N.csvPole('-2+3'), '"\'-2+3"');
  assert.equal(N.csvPole('@SUM(A1)'), '"\'@SUM(A1)"');
  assert.equal(N.csvPole('\t=1+1'), '"\'\t=1+1"'); assert.equal(N.csvPole('\r=1+1'), '"\'\r=1+1"');
  assert.equal(N.csvPole('a=b'), '"a=b"'); // only a leading character is dangerous
});
test('csvRejestr: BOM, średnik, CRLF, stała liczba kolumn', () => {
  const zly = Object.assign({}, SZUKANIE, { nazwa: '=cmd|\' /C calc\'!A0', kto: '@zly@example.test' });
  const csv = N.csvRejestr([SZUKANIE, PARA, VIES, BLAD, zly]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.endsWith('\r\n'));
  // split into records on CRLF outside quotes (the VIES address holds a bare \n inside a quoted field)
  const rek = csv.slice(1).split('\r\n').filter(Boolean);
  assert.equal(rek.length, 6);
  for (const r of rek) assert.equal(r.match(/"(?:[^"]|"")*"/g).length, 12, r.slice(0, 80));
  assert.ok(rek[0].startsWith('"Data i godzina";"Kto";"Rodzaj"'));
  assert.ok(rek[1].includes('"09.10.2026 r., godz. 10:15:30";"ksiegowa@example.test";"Biała lista — podmiot";"7831916366";"PRZYKŁADOWA ""ALFA"" SP. Z O.O.";"NIP 7831916366";"Czynny";"09.10.2026";"abcde-1234567"'));
  assert.ok(rek[2].includes('"NIP 7831916366 + rachunek 56 1010 0071 2222 7831 9163 6600";"NIE"'));
  assert.ok(rek[5].includes('"\'=cmd|\' /C calc\'!A0"') && rek[5].includes('"\'@zly@example.test"'));
  assert.equal(N.csvRejestr([]).slice(1).split('\r\n').filter(Boolean).length, 1);
});
test('potwierdzenieWpisu = ten sam tekst co na zakładkach sprawdzeń', () => {
  assert.equal(N.potwierdzenieWpisu(SZUKANIE), N.potwierdzenieWl(SZUKANIE.szczegoly, SZUKANIE.zapytanie));
  assert.equal(N.potwierdzenieWpisu(PARA), N.potwierdzeniePary(PARA.szczegoly));
  assert.equal(N.potwierdzenieWpisu(VIES), N.potwierdzenieVies(VIES.szczegoly));
  assert.match(N.potwierdzenieWpisu(SZUKANIE), /Identyfikator wyszukiwania: abcde-1234567\.$/);
  const b = N.potwierdzenieWpisu(BLAD);
  assert.match(b, /^Próba sprawdzenia \(VIES\) z dnia 09\.10\.2026 r\., godz\. 10:15:30: DE123456789\. Rejestr nie udzielił odpowiedzi: .*MS_UNAVAILABLE/);
});
test('opisZapytania, wynikPill', () => {
  assert.equal(N.opisZapytania(VIES), 'DE123456789 (pytający PL7831916366)');
  assert.equal(N.opisZapytania(wiersz({ rodzaj: 'wl_search', zapytanie: { by: 'konto', value: KONTO, date: '2026-10-09' } })), 'rachunek 56 1010 0071 2222 7831 9163 6600');
  assert.deepEqual(N.wynikPill('TAK'), ['TAK', 'p-ok']); assert.deepEqual(N.wynikPill('NIE'), ['NIE', 'p-red']);
  assert.deepEqual(N.wynikPill('Czynny'), ['VAT czynny', 'p-ok']); assert.deepEqual(N.wynikPill('Zwolniony'), ['VAT zwolniony', 'p-amber']);
  assert.deepEqual(N.wynikPill('brak w wykazie'), ['brak w wykazie', 'p-red']); assert.deepEqual(N.wynikPill('błąd WL-118'), ['błąd WL-118', 'p-grey']);
  assert.deepEqual(N.wynikPill('2 podmioty: Czynny, Czynny'), ['2 podmioty: Czynny, Czynny', 'p-navy']);
});
test('filtr tekstowy: nic poza literami, cyframi, spacją, kropką i myślnikiem nie trafia do filtra', () => {
  assert.equal(N.filtrTekst('  783-191-63-66 '), '783-191-63-66');
  assert.equal(N.filtrTekst('alfa",nip.eq.1)(%*\\'), 'alfa nip.eq.1');
  assert.equal(N.filtrTekst('Żółć sp. z o.o.'), 'Żółć sp. z o.o.');
  assert.equal(N.filtrOr(''), ''); assert.equal(N.filtrOr('"),('), '');
  assert.equal(N.filtrOr('783-191 63'), 'nazwa.ilike."%783-191 63%",request_id.ilike."%783-191 63%",nip.ilike."%78319163%"');
  assert.ok(!/[()\\]/.test(N.filtrOr('a(b)c\\d')));
});

test('vat: kwota ponad zakres dokładnych groszy jest odrzucana, graniczna liczy się dokładnie', () => {
  assert.deepStrictEqual(N.vat('90071992547409,91', 23, 'netto'), { blad: 'Kwota jest zbyt duża.' });
  assert.deepStrictEqual(N.vat('100000000000,00', 23, 'netto'), { nettoGr: 10000000000000, vatGr: 2300000000000, bruttoGr: 12300000000000, stawka: 23 });
  assert.deepStrictEqual(N.vat('123', 23, 'brutto'), { nettoGr: 10000, vatGr: 2300, bruttoGr: 12300, stawka: 23 });
});

test('odsetki podatkowe: okres sprzed tabeli — komunikat bez podwójnej spacji; wynik zgodny z ręcznym rachunkiem', () => {
  const b = N.odsetkiPodatkowe({ kwota: '1000', termin: '2014-10-07', zaplata: '2026-10-09' });
  assert.ok(b.blad && !/ {2}/.test(b.blad) && b.potrzebnaStawka);
  // 10 000 zł × (43 dni × 11% + 47 dni × 10,5%) / 365 = 264,79 zł -> 265 zł
  const r = N.odsetkiPodatkowe({ kwota: '10 000,00', termin: '2026-01-20', zaplata: '2026-04-20' });
  assert.strictEqual(r.odsetkiGr, 26500); assert.strictEqual(r.dni, 90); assert.strictEqual(r.naliczane, true);
});
