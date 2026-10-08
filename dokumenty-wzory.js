/* Kadry — katalog pojedynczych dokumentów kadrowych (treść + specyfikacja pól).
 *
 * Moduł danych bez zależności: window.KadryWzory (w przeglądarce) i module.exports (node).
 * Nie rysuje PDF — oddaje ustrukturyzowane bloki tekstu, które generator strony zamienia na
 * PDF tym samym silnikiem co komplet (umowa-zlecenie.js). Opis typów bloków: KadryWzory.BLOKI.
 *
 * Źródła treści (zasada biura: żadnych kopii wzorów wydawnictw komercyjnych):
 *   urzedowy — wzór z załącznika do rozporządzenia albo pomocniczy wzór MRPiPS (gov.pl),
 *   ustawowy — tekst własny, zbudowany wyłącznie z elementów wymaganych przepisem,
 *   biuro    — dokument już istnieje w generatorze kompletu (umowa-zlecenie.js; pojedynczo buduje go
 *              window.KompletDokumenty.zbuduj z komplet-dokumenty.js) — tylko odsyłacz,
 *   link     — urzędowy formularz składany na oryginalnym druku lub elektronicznie — tylko odsyłacz.
 *
 * Stan prawny: 2026-10-09. Każdy przepis w polu `podstawa` został tego dnia przeczytany
 * w tekście jednolitym z rejestru ELI (api.sejm.gov.pl); identyfikator ELI aktu jest w AKTY.
 * Każdy dokument `ustawowy` / `urzedowy` ma do_zatwierdzenia: true — kadrowa zatwierdza
 * brzmienie przed pierwszym użyciem. Dane przykładowe są fikcyjne.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KadryWzory = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var STAN_PRAWNY = '2026-10-09';

  // ---------------- akty prawne (tekst jednolity przeczytany w dniu STAN_PRAWNY) ----------------
  // eli    — tekst, który czytano (najnowszy tekst jednolity albo akt pierwotny, gdy t.j. nie ma)
  // bazowy — akt pierwotny w rejestrze ELI (to jego śledzi prawo-monitor)
  // zmiany — akty zmieniające ogłoszone po tekście jednolitym, sprawdzone pod kątem użytych przepisów
  var AKTY = {
    KP: { skrot: 'Kodeks pracy', tytul: 'Ustawa z dnia 26 czerwca 1974 r. – Kodeks pracy', eli: 'DU/2026/1245', bazowy: 'DU/1974/141', zmiany: [] },
    KC: { skrot: 'Kodeks cywilny', tytul: 'Ustawa z dnia 23 kwietnia 1964 r. – Kodeks cywilny', eli: 'DU/2026/795', bazowy: 'DU/1964/93', zmiany: [] },
    KPA: { skrot: 'Kodeks postępowania administracyjnego', tytul: 'Ustawa z dnia 14 czerwca 1960 r. – Kodeks postępowania administracyjnego', eli: 'DU/2025/1691', bazowy: 'DU/1960/168', zmiany: [] },
    CUDZ: { skrot: 'ustawa o powierzaniu pracy cudzoziemcom', tytul: 'Ustawa z dnia 20 marca 2025 r. o warunkach dopuszczalności powierzania pracy cudzoziemcom na terytorium Rzeczypospolitej Polskiej', eli: 'DU/2025/621', bazowy: 'DU/2025/621', zmiany: ['DU/2025/1794', 'DU/2026/203', 'DU/2026/473', 'DU/2026/734'] },
    UOC: { skrot: 'ustawa o cudzoziemcach', tytul: 'Ustawa z dnia 12 grudnia 2013 r. o cudzoziemcach', eli: 'DU/2025/1079', bazowy: 'DU/2013/1650', zmiany: ['DU/2025/1794', 'DU/2026/203'] },
    MIN: { skrot: 'ustawa o minimalnym wynagrodzeniu za pracę', tytul: 'Ustawa z dnia 10 października 2002 r. o minimalnym wynagrodzeniu za pracę', eli: 'DU/2024/1773', bazowy: 'DU/2002/1679', zmiany: [] },
    PPK: { skrot: 'ustawa o PPK', tytul: 'Ustawa z dnia 4 października 2018 r. o pracowniczych planach kapitałowych', eli: 'DU/2026/192', bazowy: 'DU/2018/2215', zmiany: ['DU/2026/989'] },
    SUS: { skrot: 'ustawa o systemie ubezpieczeń społecznych', tytul: 'Ustawa z dnia 13 października 1998 r. o systemie ubezpieczeń społecznych', eli: 'DU/2026/199', bazowy: 'DU/1998/887', zmiany: ['DU/2026/252', 'DU/2026/426', 'DU/2026/473', 'DU/2026/734'] },
    ZZ: { skrot: 'ustawa o związkach zawodowych', tytul: 'Ustawa z dnia 23 maja 1991 r. o związkach zawodowych', eli: 'DU/2026/549', bazowy: 'DU/1991/234', zmiany: [] },
    OS: { skrot: 'ustawa o opłacie skarbowej', tytul: 'Ustawa z dnia 16 listopada 2006 r. o opłacie skarbowej', eli: 'DU/2025/1154', bazowy: 'DU/2006/1635', zmiany: ['DU/2025/1795', 'DU/2025/1847', 'DU/2026/846', 'DU/2026/875', 'DU/2026/912', 'DU/2026/1206'] },
    R_SWIAD: { skrot: 'rozporządzenie w sprawie świadectwa pracy', tytul: 'Rozporządzenie Ministra Rodziny, Pracy i Polityki Społecznej z dnia 30 grudnia 2016 r. w sprawie świadectwa pracy', eli: 'DU/2024/1016', bazowy: 'DU/2016/2292', zmiany: [] },
    R_DOK: { skrot: 'rozporządzenie w sprawie dokumentacji pracowniczej', tytul: 'Rozporządzenie Ministra Rodziny, Pracy i Polityki Społecznej z dnia 10 grudnia 2018 r. w sprawie dokumentacji pracowniczej', eli: 'DU/2026/474', bazowy: 'DU/2018/2369', zmiany: [] },
    R_BAD: { skrot: 'rozporządzenie w sprawie badań lekarskich pracowników', tytul: 'Rozporządzenie Ministra Zdrowia i Opieki Społecznej z dnia 30 maja 1996 r. w sprawie przeprowadzania badań lekarskich pracowników, zakresu profilaktycznej opieki zdrowotnej nad pracownikami oraz orzeczeń lekarskich wydawanych do celów przewidzianych w Kodeksie pracy', eli: 'DU/2023/607', bazowy: 'DU/1996/332', zmiany: ['DU/2026/456', 'DU/2026/726'] },
    R_BHP: { skrot: 'rozporządzenie w sprawie szkolenia w dziedzinie bhp', tytul: 'Rozporządzenie Ministra Gospodarki i Pracy z dnia 27 lipca 2004 r. w sprawie szkolenia w dziedzinie bezpieczeństwa i higieny pracy', eli: 'DU/2024/1327', bazowy: 'DU/2004/1860', zmiany: ['DU/2025/1640'] },
    R_RODZ: { skrot: 'rozporządzenie w sprawie wniosków dotyczących uprawnień związanych z rodzicielstwem', tytul: 'Rozporządzenie Ministra Rodziny, Pracy i Polityki Społecznej z dnia 11 marca 2025 r. w sprawie wniosków dotyczących uprawnień pracowników związanych z rodzicielstwem oraz dokumentów dołączanych do takich wniosków', eli: 'DU/2025/322', bazowy: 'DU/2025/322', zmiany: [] },
    R_NIEOB: { skrot: 'rozporządzenie w sprawie usprawiedliwiania nieobecności w pracy', tytul: 'Rozporządzenie Ministra Pracy i Polityki Socjalnej z dnia 15 maja 1996 r. w sprawie sposobu usprawiedliwiania nieobecności w pracy oraz udzielania pracownikom zwolnień od pracy', eli: 'DU/2014/1632', bazowy: 'DU/1996/281', zmiany: [] },
    R_PODR: { skrot: 'rozporządzenie w sprawie należności z tytułu podróży służbowej', tytul: 'Rozporządzenie Ministra Pracy i Polityki Społecznej z dnia 29 stycznia 2013 r. w sprawie należności przysługujących pracownikowi zatrudnionemu w państwowej lub samorządowej jednostce sfery budżetowej z tytułu podróży służbowej', eli: 'DU/2023/2190', bazowy: 'DU/2013/167', zmiany: [] },
    ZWOL: { skrot: 'ustawa o zwolnieniach z przyczyn niedotyczących pracowników', tytul: 'Ustawa z dnia 13 marca 2003 r. o szczególnych zasadach rozwiązywania z pracownikami stosunków pracy z przyczyn niedotyczących pracowników', eli: 'DU/2026/1195', bazowy: 'DU/2003/844', zmiany: [] },
    R_PPK: { skrot: 'rozporządzenie w sprawie deklaracji o rezygnacji z wpłat do PPK', tytul: 'Rozporządzenie Ministra Finansów z dnia 12 czerwca 2019 r. w sprawie deklaracji o rezygnacji z dokonywania wpłat do pracowniczych planów kapitałowych', eli: 'DU/2023/2148', bazowy: 'DU/2019/1102', zmiany: [] },
    // RODO jest aktem UE — nie ma go w rejestrze ELI Sejmu; tekst polski czytano w serwisie Urzędu Publikacji UE
    RODO: { skrot: 'RODO', tytul: 'Rozporządzenie Parlamentu Europejskiego i Rady (UE) 2016/679 z dnia 27 kwietnia 2016 r. (ogólne rozporządzenie o ochronie danych)', eli: 'EU/2016/679', bazowy: 'EU/2016/679', url: 'http://publications.europa.eu/resource/celex/32016R0679', zmiany: [] },
  };

  var GRUPY = [
    'Nawiązanie zatrudnienia', 'W trakcie zatrudnienia', 'Urlopy i zwolnienia od pracy', 'Zakończenie zatrudnienia',
    'Zlecenie i dzieło', 'Cudzoziemcy', 'Wynagrodzenia i podatki', 'BHP i badania', 'RODO', 'Pełnomocnictwa i inne',
  ];

  // Oficjalne źródła wzorów (adresy otwarte w dniu STAN_PRAWNY)
  var URL = {
    MRPIPS_WZORY: 'https://www.gov.pl/web/rodzina/bip-pomocnicze-wzory-dokumentow-zwiazanych-z-ubieganiem-sie-o-zatrudnienie-nawiazaniem-zmiana-oraz-ustaniem-stosunku-pracy',
    PIT_FORMULARZE: 'https://www.podatki.gov.pl/pit/formularze-do-druku-pit/',
    UPL: 'https://www.podatki.gov.pl/pozostale/pelnomocnictwa/formularze-pelnomocnictwa',
    ZUS_PEL: 'https://www.zus.pl/wzory-formularzy/pelnomocnictwo/pel-pelnomocnictwo',
    ZUS_FORMULARZE: 'https://www.zus.pl/wzory-formularzy/firmy/dokumenty-zgloszeniowe-i-rozliczeniowe',
    PRACA_GOV: 'https://www.praca.gov.pl/',
    MOJEPPK: 'https://www.mojeppk.pl/dla-pracownika.html',
  };

  // ---------------- forma i podpisy ----------------
  // Trzy kategorie z modułu podpisów elektronicznych (supabase/functions/podpisy/checks.ts):
  //   pisemna      — przepis wymaga formy pisemnej: podpis własnoręczny (art. 78 § 1 KC) albo
  //                  kwalifikowany podpis elektroniczny (art. 78¹ KC); podpis zaufany NIE daje tej formy
  //   dokumentowa  — wystarcza „postać papierowa lub elektroniczna” / forma dokumentowa (art. 77² KC):
  //                  każdy z trzech podpisów, a także e-mail lub system kadrowy pozwalający ustalić osobę
  //   bez_podpisu  — informacja przekazywana pracownikowi; podpisu nie trzeba, zachowuje się dowód przekazania
  var METODY = { pisemna: ['odreczny', 'kwalifikowany'], dokumentowa: ['odreczny', 'kwalifikowany', 'zaufany'], bez_podpisu: [] };
  function forma(kategoria, podpisuje, podstawa, extra) {
    var f = { kategoria: kategoria, podpisuje: podpisuje, metody: METODY[kategoria].slice(), podstawa: podstawa, rodzaj_podpisy: 'oswiadczenie' };
    for (var k in (extra || {})) f[k] = extra[k];
    return f;
  }

  function art(a, akt) { return { art: a, akt: AKTY[akt].skrot, eli: AKTY[akt].eli, zweryfikowano: STAN_PRAWNY }; }

  // ---------------- pola ----------------
  // typ: tekst | dlugi | data | kwota | liczba | wybor | pesel | nip | regon | iban | email
  // rejestr: skąd wstępnie wypełnić z payload zgłoszenia (zatrudnienie_zgloszenia):
  //   'klucz' | { lacz: ['k1','k2'], sep: ' ' } | { adres: 'a' } (a_ulica a_nrdom/a_nrmiesz, a_kod a_miejscowosc)
  // gdy_puste: tekst wstawiany, gdy pole nieobowiązkowe zostało puste (domyślnie wykropkowana linia)
  function pole(id, typ, etykieta, extra) {
    var p = { id: id, typ: typ, etykieta: etykieta, wymagane: true };
    for (var k in (extra || {})) p[k] = extra[k];
    return p;
  }
  var WSPOLNE = {
    z_nazwa: ['tekst', 'Pracodawca — nazwa (firma)', { rejestr: 'z_nazwa' }],
    z_siedziba: ['tekst', 'Pracodawca — adres siedziby', { rejestr: { lacz: ['z_ulica', 'z_miasto'], sep: ', ' } }],
    z_nip: ['nip', 'Pracodawca — NIP', { rejestr: 'z_nip', walidacja: 'nip' }],
    z_regon: ['regon', 'Pracodawca — REGON', { rejestr: 'z_regon', walidacja: 'regon', wymagane: false }],
    z_reprezentant: ['tekst', 'Osoba podpisująca w imieniu pracodawcy (imię, nazwisko, funkcja)', { rejestr: 'z_reprezentant' }],
    p_imie_nazwisko: ['tekst', 'Imię (imiona) i nazwisko', { rejestr: { lacz: ['p_imiona', 'p_nazwisko'], sep: ' ' } }],
    p_pesel: ['pesel', 'PESEL', { rejestr: 'p_pesel', walidacja: 'pesel', wymagane: false, gdy_puste: 'brak' }],
    p_dataur: ['data', 'Data urodzenia', { rejestr: 'p_dataur' }],
    p_dokument: ['tekst', 'Rodzaj, seria i numer dokumentu tożsamości', { rejestr: 'p_dowod', wymagane: false }],
    p_obywatelstwo: ['tekst', 'Obywatelstwo', { rejestr: 'p_obywatelstwo' }],
    p_adres: ['tekst', 'Adres zamieszkania', { rejestr: { adres: 'a' } }],
    p_stanowisko: ['tekst', 'Stanowisko / rodzaj pracy', { rejestr: 'u_stanowisko' }],
    umowa_data: ['data', 'Data zawarcia umowy', { rejestr: 'd_data' }],
    d_miejscowosc: ['tekst', 'Miejscowość', { rejestr: 'd_miejscowosc' }],
    d_data: ['data', 'Data dokumentu', { domyslnie: 'dzis' }],
  };
  function W(id, extra) { var w = WSPOLNE[id]; var e = {}; var k; for (k in w[2]) e[k] = w[2][k]; for (k in (extra || {})) e[k] = extra[k]; return pole(id, w[0], w[1], e); }
  function PRACODAWCA() { return [W('z_nazwa'), W('z_siedziba'), W('z_nip'), W('z_reprezentant')]; }
  function MD() { return [W('d_miejscowosc'), W('d_data')]; }
  function opcje(lista) { return lista.map(function (o) { return typeof o === 'string' ? { v: o, etykieta: o } : { v: o[0], etykieta: o[1], tekst: o[2] }; }); }
  function wybor(id, etykieta, lista, extra) { var e = { opcje: opcje(lista) }; for (var k in (extra || {})) e[k] = extra[k]; return pole(id, 'wybor', etykieta, e); }

  // ---------------- bloki treści ----------------
  var BLOKI = {
    naglowek: 'lewo: [linie] (oznaczenie nadawcy), prawo: "miejscowość, data" — dwie kolumny u góry strony',
    tytul: 'tekst — tytuł dokumentu, wyśrodkowany, pogrubiony',
    podtytul: 'tekst — linia pod tytułem, wyśrodkowana',
    adresat: 'linie: [..] — blok adresata po prawej stronie',
    paragraf: 'nr ("§ 1"), tytul? — wyśrodkowany numer jednostki redakcyjnej umowy',
    p: 'tekst, styl? (bold | maly | srodek) — akapit',
    lista: 'typ (num | lit | punkt), pozycje: [tekst | { tekst, gdy }]',
    pola: 'wiersze: [[etykieta, wartość]] — zestawienie „etykieta: wartość”',
    tabela: 'kolumny: [..], wiersze?: [[..]], puste_wiersze?: n — tabela; puste wiersze do wypełnienia ręcznie',
    podpisy: 'lewy?, prawy? — podpisy z opisem pod linią; null = brak podpisu po tej stronie',
    pouczenie: 'tytul, akapity: [..] — wyodrębnione pouczenie (treść wymagana przepisem — nie skracać)',
    przypis: 'tekst — drobny druk pod dokumentem',
    // każdy blok może mieć `gdy` — warunek widoczności:
    //   { pole, rowne } | { pole, w: [..] } | { pole, niepuste: true } | { pole, puste: true } | { nie: warunek } | { lub: [..] } | [warunki] (wszystkie)
    // {{id}} w tekście = wartość pola; dla pola typu wybor wstawiany jest `tekst` opcji (a gdy go brak — etykieta)
  };
  function nagl(lewo, prawo) { return { t: 'naglowek', lewo: lewo, prawo: prawo === undefined ? '{{d_miejscowosc}}, dnia {{d_data}}' : prawo }; }
  function tyt(tekst) { return { t: 'tytul', tekst: tekst }; }
  function pod(tekst, gdy) { var b = { t: 'podtytul', tekst: tekst }; if (gdy) b.gdy = gdy; return b; }
  function adr(linie) { return { t: 'adresat', linie: linie }; }
  function par(nr, tytul) { var b = { t: 'paragraf', nr: nr }; if (tytul) b.tytul = tytul; return b; }
  function p(tekst, gdy, styl) { var b = { t: 'p', tekst: tekst }; if (gdy) b.gdy = gdy; if (styl) b.styl = styl; return b; }
  function li(pozycje, typ, gdy) { var b = { t: 'lista', typ: typ || 'num', pozycje: pozycje }; if (gdy) b.gdy = gdy; return b; }
  function kv(wiersze, gdy) { var b = { t: 'pola', wiersze: wiersze }; if (gdy) b.gdy = gdy; return b; }
  function tab(kolumny, wiersze, puste) { var b = { t: 'tabela', kolumny: kolumny }; if (wiersze) b.wiersze = wiersze; if (puste) b.puste_wiersze = puste; return b; }
  function sig(lewy, prawy, gdy) { var b = { t: 'podpisy', lewy: lewy, prawy: prawy }; if (gdy) b.gdy = gdy; return b; }
  function pou(tytul, akapity, gdy) { var b = { t: 'pouczenie', tytul: tytul, akapity: akapity }; if (gdy) b.gdy = gdy; return b; }
  function prz(tekst, gdy) { var b = { t: 'przypis', tekst: tekst }; if (gdy) b.gdy = gdy; return b; }

  var NAGL_PRACODAWCA = function () { return nagl(['{{z_nazwa}}', '{{z_siedziba}}', 'NIP: {{z_nip}}']); };
  var NAGL_PRACOWNIK = function () { return nagl(['{{p_imie_nazwisko}}', '{{p_stanowisko}}']); };
  var ADR_PRACODAWCA = function () { return adr(['{{z_nazwa}}', '{{z_siedziba}}']); };
  var ADR_PRACOWNIK = function () { return adr(['Pan/Pani', '{{p_imie_nazwisko}}']); };
  var POD_PRACODAWCY = 'podpis pracodawcy lub osoby reprezentującej pracodawcę albo osoby upoważnionej do składania oświadczeń w imieniu pracodawcy';
  var POD_PRAC_IMIE = '{{z_reprezentant}} — ' + POD_PRACODAWCY;
  var POD_ODBIOR = 'potwierdzenie odbioru przez pracownika — data i podpis';
  var POD_PRACOWNIKA = 'data i podpis pracownika';

  // tłumaczenie dla cudzoziemca — trzy poziomy
  var DJ = {
    wymagany: function (podstawa, uwaga) { return { poziom: 'wymagany', podstawa: podstawa, uwaga: uwaga }; },
    zalecany: function (uwaga) { return { poziom: 'zalecany', podstawa: null, uwaga: uwaga }; },
    nie: function (uwaga) { return { poziom: 'nie', podstawa: null, uwaga: uwaga || 'Dokument wewnętrzny lub składany do urzędu po polsku.' }; },
  };
  var DJ_ZAL = 'Przepis nie wymaga tłumaczenia, ale pracownik, który nie zna polskiego, powinien rozumieć, co podpisuje lub otrzymuje — wersja dwujęzyczna ogranicza ryzyko sporu o skuteczność oświadczenia.';

  var WZORY = [];
  function dodaj(d) {
    d.zweryfikowano = STAN_PRAWNY;
    if (d.zrodlo.typ === 'ustawowy' || d.zrodlo.typ === 'urzedowy') d.do_zatwierdzenia = true;
    else d.do_zatwierdzenia = false;
    d.pola = d.pola || []; d.tresc = d.tresc || []; d.uwagi = d.uwagi || []; d.podstawa = d.podstawa || [];
    WZORY.push(d);
  }
  // dokument już obecny w generatorze kompletu — tylko odsyłacz
  function biuro(id, nazwa, grupa, dla, kompletId, typ, podstawa, uwagi, f, dj, opis) {
    dodaj({
      id: id, nazwa: nazwa, grupa: grupa, dla: dla,
      zrodlo: { typ: 'biuro', generator: kompletId ? 'komplet-dokumenty.js' : null, wywolanie: kompletId ? 'KompletDokumenty.zbuduj(dane, "' + kompletId + '", tr)' : null, komplet_id: kompletId, komplet_typ: typ,
        opis: opis || 'Dokument jest już w generatorze kompletu (umowa-zlecenie.js, pojedynczo przez KompletDokumenty) — użyć istniejącej funkcji, nie redagować ponownie.' },
      podstawa: podstawa, forma: f, uwagi: uwagi, dwujezyczny: dj,
    });
  }
  // urzędowy formularz — tylko odsyłacz i sposób złożenia
  function link(id, nazwa, grupa, dla, url, jak, podstawa, uwagi, f) {
    dodaj({
      id: id, nazwa: nazwa, grupa: grupa, dla: dla,
      zrodlo: { typ: 'link', url: url, jak_zlozyc: jak },
      podstawa: podstawa || [], forma: f || forma('pisemna', 'pracodawca', 'Formularz urzędowy — podpis zgodnie z pouczeniem na formularzu.', { rodzaj_podpisy: 'inny' }),
      uwagi: uwagi || [], dwujezyczny: DJ.nie('Formularz urzędowy w języku polskim.'),
    });
  }

  // =====================================================================================
  //  1. NAWIĄZANIE ZATRUDNIENIA
  // =====================================================================================
  var G1 = 'Nawiązanie zatrudnienia';
  var F_KP_PAPIER_ELEKTR = 'Kodeks pracy wymaga tu „postaci papierowej lub elektronicznej” — nie jest to forma pisemna z art. 78 KC.';

  biuro('kwestionariusz-kandydat', 'Kwestionariusz osobowy dla osoby ubiegającej się o zatrudnienie', G1, 'pracownik', 'kwestKand', 'praca',
    [art('art. 22¹ § 1, 2 i 5', 'KP')],
    ['Pomocniczy wzór MRPiPS (gov.pl). Od kandydata wolno żądać tylko danych z art. 22¹ § 1; wykształcenia, kwalifikacji i przebiegu zatrudnienia — tylko gdy są niezbędne do pracy na danym stanowisku.',
      'Nie wolno pytać o wynagrodzenie w obecnym ani w poprzednich stosunkach pracy (art. 22¹ § 1 pkt 6 w obecnym brzmieniu).',
      'Akta osobowe część A.'],
    forma('dokumentowa', 'pracownik', 'Udostępnienie danych następuje w formie oświadczenia osoby, której dane dotyczą (art. 22¹ § 5 KP).', { rodzaj_podpisy: 'kwestionariusz', akta: 'A' }),
    DJ.zalecany(DJ_ZAL));

  biuro('kwestionariusz-pracownik', 'Kwestionariusz osobowy dla pracownika', G1, 'pracownik', 'kwest', 'praca',
    [art('art. 22¹ § 3–5', 'KP')],
    ['Pomocniczy wzór MRPiPS (gov.pl). Numer rachunku płatniczego podaje się, jeżeli pracownik nie złożył wniosku o wypłatę do rąk własnych.', 'Akta osobowe część B.'],
    forma('dokumentowa', 'pracownik', 'Oświadczenie osoby, której dane dotyczą (art. 22¹ § 5 KP).', { rodzaj_podpisy: 'kwestionariusz', akta: 'B' }),
    DJ.zalecany(DJ_ZAL));

  biuro('umowa-o-prace', 'Umowa o pracę (okres próbny / czas określony / czas nieokreślony)', G1, 'pracownik', 'umowa', 'praca',
    [art('art. 25, art. 25¹, art. 29 § 1–2', 'KP'), art('art. 5 ust. 1–3', 'CUDZ')],
    ['Pomocniczy wzór MRPiPS (gov.pl) — w komplecie. Umowa musi być zawarta na piśmie; jeżeli nie została, pracodawca przed dopuszczeniem do pracy potwierdza pracownikowi na piśmie ustalenia co do stron, rodzaju umowy i jej warunków.',
      'Okres próbny: do 3 miesięcy; 1 miesiąc, gdy planowana umowa na czas określony jest krótsza niż 6 miesięcy; 2 miesiące, gdy ma trwać od 6 do mniej niż 12 miesięcy (art. 25 § 2²). W umowie na okres próbny wpisuje się okres planowanej umowy na czas określony (art. 29 § 1 pkt 6 lit. b).',
      'Czas określony: limit 33 miesięcy i 3 umów; wyjątki z art. 25¹ § 4 trzeba opisać w umowie (art. 29 § 1¹), a przy „obiektywnych przyczynach” zawiadomić okręgowego inspektora pracy w 5 dni roboczych (art. 25¹ § 5).',
      'CUDZOZIEMIEC: umowa w formie pisemnej PRZED dopuszczeniem do pracy; jeżeli nie zna polskiego — przed podpisaniem dostaje treść na piśmie w wersji zrozumiałej. Kopię umowy przekazuje się organowi przez praca.gov.pl przed powierzeniem pracy (zezwolenie / oświadczenie).'],
    forma('pisemna', 'obie', 'Umowę o pracę zawiera się na piśmie (art. 29 § 2 KP).', { rodzaj_podpisy: 'umowa_praca', akta: 'B' }),
    DJ.wymagany('art. 5 ust. 2 ustawy o powierzaniu pracy cudzoziemcom', 'Jeżeli cudzoziemiec nie posługuje się językiem polskim — treść umowy na piśmie w wersji dla niego zrozumiałej przed podpisaniem; wersję przechowuje się 2 lata od końca roku ustania umowy. Brak: grzywna 1000–3000 zł (art. 84 ust. 6).'));

  biuro('informacja-warunki-zatrudnienia', 'Informacja o warunkach zatrudnienia (art. 29 § 3 KP)', G1, 'pracownik', 'warunki', 'praca',
    [art('art. 29 § 3–3⁴', 'KP')],
    ['Termin: 7 dni od dopuszczenia do pracy (lit. a–m) oraz 30 dni (informacja o instytucji zabezpieczenia społecznego).',
      'Informacje z lit. a–f, h–k i pkt 2 można przekazać przez wskazanie przepisów (art. 29 § 3¹); lit. g, l, m trzeba opisać wprost.',
      'O każdej zmianie warunków — najpóźniej w dniu, w którym zmiana ma zastosowanie (art. 29 § 3³).',
      'Przy pracy zdalnej uzgodnionej przy zawieraniu umowy informacja obejmuje dodatkowo elementy z art. 67²¹ § 1 — patrz dokument „Praca zdalna — informacja”.'],
    forma('bez_podpisu', 'potwierdzenie', 'Postać papierowa lub elektroniczna; pracodawca zachowuje dowód przekazania (art. 29 § 3⁴ KP).', { rodzaj_podpisy: 'informacja_warunki', akta: 'B' }),
    DJ.zalecany(DJ_ZAL));

  biuro('zakres-czynnosci', 'Zakres czynności pracownika', G1, 'pracownik', 'zakres', 'praca', [],
    ['Dokument zwyczajowy — przepisy nie określają jego treści. Obowiązki wpisuje się ręcznie.', 'Akta osobowe część B.'],
    forma('dokumentowa', 'obie', 'Przepisy nie wymagają szczególnej formy.', { rodzaj_podpisy: 'inny', akta: 'B' }), DJ.zalecany(DJ_ZAL));

  biuro('oswiadczenie-przepisy-zakladowe', 'Oświadczenie pracownika o zapoznaniu się z regulaminem pracy i przepisami zakładowymi', G1, 'pracownik', 'przepisy', 'praca',
    [art('art. 104³ § 2', 'KP')],
    ['Pracodawca zapoznaje pracownika z treścią regulaminu pracy PRZED dopuszczeniem go do pracy.', 'Akta osobowe część B.'],
    forma('dokumentowa', 'pracownik', F_KP_PAPIER_ELEKTR, { akta: 'B' }), DJ.zalecany(DJ_ZAL));

  biuro('informacja-rowne-traktowanie', 'Informacja dotycząca równego traktowania w zatrudnieniu', G1, 'pracownik', 'rowne', 'praca',
    [art('art. 94¹', 'KP')], ['Akta osobowe część B.'],
    forma('dokumentowa', 'pracownik', 'Pracodawca udostępnia pracownikom tekst przepisów (art. 94¹ KP); podpis pracownika jest tylko dowodem zapoznania się.', { akta: 'B' }), DJ.zalecany(DJ_ZAL));

  dodaj({
    id: 'rachunek-platniczy', nazwa: 'Oświadczenie o rachunku płatniczym do wypłaty wynagrodzenia', grupa: 'Wynagrodzenia i podatki', dla: 'oba',
    zrodlo: { typ: 'ustawowy', elementy: 'Wskazanie rachunku płatniczego przez pracownika (art. 86 § 3 KP); dane z art. 22¹ § 3 pkt 5 KP.' },
    podstawa: [art('art. 86 § 3, art. 22¹ § 3 pkt 5', 'KP')],
    forma: forma('dokumentowa', 'pracownik', 'Przepis nie wymaga szczególnej formy wskazania rachunku; oświadczenie w aktach jest dowodem.', { akta: 'B' }),
    pola: MD().concat([W('p_imie_nazwisko'), W('z_nazwa'), W('z_siedziba'),
      pole('rachunek', 'iban', 'Numer rachunku płatniczego', { rejestr: 'p_konto', walidacja: 'iban' }),
      pole('bank', 'tekst', 'Nazwa banku', { wymagane: false }),
      wybor('wlasciciel', 'Posiadacz rachunku', [['wlasny', 'rachunek własny', 'Jestem posiadaczem tego rachunku.'], ['wspolny', 'rachunek wspólny', 'Jestem współposiadaczem tego rachunku.'], ['cudzy', 'rachunek innej osoby', 'Rachunek należy do innej osoby: {{wlasciciel_dane}}. Wyrażam zgodę na przekazywanie mojego wynagrodzenia na ten rachunek.']]),
      pole('wlasciciel_dane', 'tekst', 'Imię i nazwisko posiadacza rachunku (gdy cudzy)', { wymagane: false, wymagane_gdy: { pole: 'wlasciciel', rowne: 'cudzy' } })]),
    tresc: [
      nagl(['{{p_imie_nazwisko}}']), ADR_PRACODAWCA(),
      tyt('OŚWIADCZENIE O RACHUNKU PŁATNICZYM'),
      p('Wskazuję następujący rachunek płatniczy, na który proszę przekazywać moje wynagrodzenie i inne świadczenia pieniężne związane z zatrudnieniem:'),
      kv([['Numer rachunku', '{{rachunek}}'], ['Bank', '{{bank}}']]),
      p('{{wlasciciel}}'),
      p('Zobowiązuję się niezwłocznie poinformować pracodawcę o każdej zmianie rachunku.'),
      sig(null, 'data i czytelny podpis'),
    ],
    uwagi: ['Wypłata na rachunek jest zasadą; wypłata do rąk własnych tylko na wniosek pracownika (osobny dokument „Wniosek o wypłatę wynagrodzenia do rąk własnych”).',
      'Rachunek innej osoby: rozwiązanie dopuszczane w praktyce, ale przepis mówi o rachunku „wskazanym przez pracownika” — kadrowa decyduje, czy biuro je stosuje (cudzoziemiec bez konta).',
      'Przy zleceniu dokument stosuje się odpowiednio — w nagłówku adresatem jest zleceniodawca.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  biuro('wniosek-wyplata-gotowka', 'Wniosek o wypłatę wynagrodzenia do rąk własnych', 'Wynagrodzenia i podatki', 'oba', 'gotowka', 'praca',
    [art('art. 86 § 3', 'KP')], ['Wniosek przechowuje się w dokumentacji w sprawach związanych ze stosunkiem pracy razem z listą płac (§ 6 pkt 3 rozporządzenia w sprawie dokumentacji pracowniczej).'],
    forma('dokumentowa', 'pracownik', 'Wniosek w postaci papierowej lub elektronicznej (art. 86 § 3 KP).'), DJ.zalecany(DJ_ZAL));

  biuro('pit-2', 'PIT-2 — oświadczenia i wnioski podatnika dla płatnika', 'Wynagrodzenia i podatki', 'oba', 'pit2', 'praca', [],
    ['Oficjalny formularz MF PIT-2(9) — w komplecie wypełniany na oryginalnym druku (pit-2-template.pdf). Nie odtwarzać treści. Aktualną wersję sprawdzać na ' + URL.PIT_FORMULARZE + '.'],
    forma('dokumentowa', 'pracownik', 'Formularz MF; składany płatnikowi na piśmie albo w sposób przyjęty u płatnika.', { rodzaj_podpisy: 'pit2', akta: 'B' }), DJ.nie('Formularz urzędowy w języku polskim.'));

  biuro('zgoda-pit-elektronicznie', 'Zgoda na przekazywanie informacji podatkowych (PIT-11) w formie elektronicznej', 'Wynagrodzenia i podatki', 'oba', 'zgodaPit', 'praca', [], [],
    forma('dokumentowa', 'pracownik', 'Przepisy nie wymagają szczególnej formy.'), DJ.zalecany(DJ_ZAL));

  biuro('oswiadczenie-zus-pracownik', 'Oświadczenie pracownika dla celów ubezpieczeń społecznych i zdrowotnego', 'Wynagrodzenia i podatki', 'pracownik', 'zusPrac', 'praca', [],
    ['Zgłoszenie do ubezpieczeń — 7 dni od powstania obowiązku ubezpieczenia.'], forma('dokumentowa', 'pracownik', 'Przepisy nie wymagają szczególnej formy.'), DJ.zalecany(DJ_ZAL));

  biuro('wniosek-czlonkowie-rodziny', 'Wniosek o zgłoszenie członków rodziny do ubezpieczenia zdrowotnego', 'Wynagrodzenia i podatki', 'oba', 'rodzina', 'praca', [], [],
    forma('dokumentowa', 'pracownik', 'Przepisy nie wymagają szczególnej formy.'), DJ.zalecany(DJ_ZAL));

  biuro('oswiadczenie-uprawnienia-rodzicielskie', 'Oświadczenie o korzystaniu z uprawnień rodzicielskich', G1, 'pracownik', 'rodzic', 'praca',
    [art('art. 189¹, art. 188', 'KP')], ['Jeżeli oboje rodzice są zatrudnieni, z uprawnień z art. 148 pkt 3, art. 178 § 2, art. 186⁷ § 1 i art. 188 może korzystać jedno z nich.'],
    forma('dokumentowa', 'pracownik', F_KP_PAPIER_ELEKTR, { akta: 'B' }), DJ.zalecany(DJ_ZAL));

  biuro('ppk-informacja', 'Informacja dotycząca PPK', 'Wynagrodzenia i podatki', 'oba', 'ppkInfo', 'praca', [art('art. 23 ust. 1–2', 'PPK')], [],
    forma('dokumentowa', 'obie', 'Informacja dla osoby zatrudnionej; podpisy są tylko dowodem przekazania.'), DJ.zalecany(DJ_ZAL));

  biuro('ppk-rezygnacja', 'Deklaracja o rezygnacji z dokonywania wpłat do PPK', 'Wynagrodzenia i podatki', 'oba', 'ppkRez', 'praca',
    [art('art. 23 ust. 2–6 i 12', 'PPK'), art('§ 2–3 i załącznik', 'R_PPK')],
    ['Urzędowy wzór z rozporządzenia MF — w komplecie wypełniany na oryginalnym druku (ppk-rezygnacja-template.pdf). Wzór jest obowiązkowy — nie redagować własnego.',
      'Pracodawca informuje instytucję finansową w ciągu 7 dni od złożenia deklaracji. Wpłat nie dokonuje się od miesiąca złożenia deklaracji; pobrane w tym miesiącu podlegają zwrotowi.',
      'Co 4 lata (od 1 kwietnia) wpłaty wznawia się automatycznie — rezygnację trzeba złożyć ponownie.'],
    forma('pisemna', 'pracownik', 'Deklarację składa się w formie pisemnej (art. 23 ust. 2 ustawy o PPK).', { rodzaj_podpisy: 'ppk_rezygnacja' }), DJ.zalecany('Wzór urzędowy jest po polsku; cudzoziemcowi warto przekazać tłumaczenie pouczenia o skutkach rezygnacji.'));

  dodaj({
    id: 'ppk-wniosek-o-wplaty', nazwa: 'Wniosek o dokonywanie wpłat do PPK (po wcześniejszej rezygnacji)', grupa: 'Wynagrodzenia i podatki', dla: 'oba',
    zrodlo: { typ: 'ustawowy', elementy: 'Wniosek uczestnika PPK, który złożył deklarację o rezygnacji, o dokonywanie wpłat (art. 23 ust. 10 ustawy o PPK).' },
    podstawa: [art('art. 23 ust. 10–11', 'PPK')],
    forma: forma('pisemna', 'pracownik', 'Wniosek składa się podmiotowi zatrudniającemu w formie pisemnej (art. 23 ust. 10 ustawy o PPK).', { rodzaj_podpisy: 'ppk_rezygnacja' }),
    pola: MD().concat([W('p_imie_nazwisko'), W('p_pesel'), W('z_nazwa'), W('z_siedziba')]),
    tresc: [
      nagl(['{{p_imie_nazwisko}}', 'PESEL: {{p_pesel}}']), ADR_PRACODAWCA(),
      tyt('WNIOSEK O DOKONYWANIE WPŁAT DO PPK'),
      p('Na podstawie art. 23 ust. 10 ustawy z dnia 4 października 2018 r. o pracowniczych planach kapitałowych, jako uczestnik PPK, który złożył deklarację o rezygnacji z dokonywania wpłat do PPK, wnoszę o dokonywanie wpłat do PPK.'),
      p('Przyjmuję do wiadomości, że wpłat do PPK dokonuje się, począwszy od miesiąca następującego po miesiącu, w którym złożono niniejszy wniosek.'),
      sig(null, 'data i czytelny podpis uczestnika PPK'),
    ],
    uwagi: ['Wniosek nie wymaga zmiany umowy o prowadzenie PPK. Wpłaty — od miesiąca następującego po miesiącu złożenia wniosku (art. 23 ust. 11).',
      'Nie dotyczy uczestnika, który po rezygnacji ukończył 70. rok życia (art. 23 ust. 8).'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  // ---------------- BHP i badania ----------------
  var G_BHP = 'BHP i badania';

  dodaj({
    id: 'skierowanie-badania-lekarskie', nazwa: 'Skierowanie na badania lekarskie (wstępne / okresowe / kontrolne)', grupa: G_BHP, dla: 'pracownik',
    zrodlo: { typ: 'urzedowy', akt: AKTY.R_BAD.tytul, zalacznik: 'załącznik nr 3a — wzór skierowania na badania lekarskie', eli: AKTY.R_BAD.eli,
      uwaga: 'Treść odwzorowuje wzór urzędowy. W przywołaniu Kodeksu pracy podano aktualny tekst jednolity (wzór z 2023 r. wskazuje Dz. U. z 2022 r. poz. 1510). Zmiany rozporządzenia z 2026 r. (poz. 456 i 726) nie zmieniły załącznika nr 3a.' },
    podstawa: [art('art. 229 § 1–1³, 2, 4 i 4a', 'KP'), art('§ 4 ust. 1–3 i załącznik nr 3a', 'R_BAD')],
    forma: forma('pisemna', 'pracodawca', 'Skierowanie wydaje pracodawca według wzoru urzędowego z podpisem pracodawcy, w dwóch egzemplarzach (§ 4 ust. 1a rozporządzenia).', { rodzaj_podpisy: 'inny', akta: 'B' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('z_regon'),
      wybor('rodzaj_badania', 'Rodzaj badania', [['wstepne', 'wstępne'], ['okresowe', 'okresowe'], ['kontrolne', 'kontrolne']]),
      W('p_imie_nazwisko'),
      W('p_pesel', { gdy_puste: 'nie nadano' }),
      pole('p_dokument_brak_pesel', 'tekst', 'Gdy brak PESEL: seria, numer i nazwa dokumentu tożsamości, a u osoby przyjmowanej do pracy — data urodzenia', { wymagane: false, rejestr: 'p_dowod', wymagane_gdy: { pole: 'p_pesel', puste: true } }),
      W('p_adres', { etykieta: 'Adres zamieszkania (miejscowość, ulica, nr domu, nr lokalu)' }),
      wybor('status', 'Osoba kierowana', [['zatrudniony', 'pracownik już zatrudniony', 'zatrudnionego/zatrudnioną'], ['podejmujacy', 'osoba przyjmowana do pracy', 'podejmującego/podejmującą pracę']]),
      W('p_stanowisko', { etykieta: 'Stanowisko lub stanowiska pracy' }),
      pole('opis_stanowiska', 'dlugi', 'Określenie stanowiska: rodzaj pracy, podstawowe czynności, sposób i czas ich wykonywania'),
      pole('cz_fizyczne', 'dlugi', 'I. Czynniki fizyczne (nazwa i wielkość narażenia)', { wymagane: false, gdy_puste: 'nie występują' }),
      pole('cz_pyly', 'dlugi', 'II. Pyły', { wymagane: false, gdy_puste: 'nie występują' }),
      pole('cz_chemiczne', 'dlugi', 'III. Czynniki chemiczne', { wymagane: false, gdy_puste: 'nie występują' }),
      pole('cz_biologiczne', 'dlugi', 'IV. Czynniki biologiczne', { wymagane: false, gdy_puste: 'nie występują' }),
      pole('cz_inne', 'dlugi', 'V. Inne czynniki, w tym niebezpieczne', { wymagane: false, gdy_puste: 'nie występują' }),
      pole('liczba_czynnikow', 'liczba', 'Łączna liczba czynników wskazanych w skierowaniu', { walidacja: 'liczba>=0' })]),
    tresc: [
      nagl(['{{z_nazwa}}', '{{z_siedziba}}', 'REGON: {{z_regon}}', '(oznaczenie pracodawcy)']),
      tyt('SKIEROWANIE NA BADANIA LEKARSKIE'), pod('({{rodzaj_badania}})'),
      p('Działając na podstawie art. 229 § 4a ustawy z dnia 26 czerwca 1974 r. – Kodeks pracy (Dz. U. z 2026 r. poz. 1245), kieruję na badania lekarskie:'),
      kv([['Pana/Panią', '{{p_imie_nazwisko}}'], ['nr PESEL', '{{p_pesel}}']]),
      p('Dokument potwierdzający tożsamość / data urodzenia (gdy nie nadano numeru PESEL): {{p_dokument_brak_pesel}}', { pole: 'p_pesel', puste: true }),
      kv([['zamieszkałego/zamieszkałą', '{{p_adres}}']]),
      p('{{status}} na stanowisku lub stanowiskach pracy: {{p_stanowisko}}'),
      p('Określenie stanowiska/stanowisk pracy (rodzaj pracy, podstawowe czynności, sposób i czas ich wykonywania): {{opis_stanowiska}}'),
      p('Opis warunków pracy uwzględniający informacje o występowaniu na stanowisku lub stanowiskach pracy czynników niebezpiecznych, szkodliwych dla zdrowia lub czynników uciążliwych i innych wynikających ze sposobu wykonywania pracy, z podaniem wielkości narażenia oraz aktualnych wyników badań i pomiarów czynników szkodliwych dla zdrowia, wykonanych na tym stanowisku/stanowiskach – należy wpisać nazwę czynnika/czynników i wielkość/wielkości narażenia:'),
      kv([['I. Czynniki fizyczne', '{{cz_fizyczne}}'], ['II. Pyły', '{{cz_pyly}}'], ['III. Czynniki chemiczne', '{{cz_chemiczne}}'], ['IV. Czynniki biologiczne', '{{cz_biologiczne}}'], ['V. Inne czynniki, w tym niebezpieczne', '{{cz_inne}}']]),
      p('Łączna liczba czynników niebezpiecznych, szkodliwych dla zdrowia lub czynników uciążliwych i innych wynikających ze sposobu wykonywania pracy wskazanych w skierowaniu: {{liczba_czynnikow}}'),
      sig(null, 'podpis pracodawcy'),
      prz('Skierowanie wydaje się w dwóch egzemplarzach, z których jeden otrzymuje osoba kierowana na badania. Opis warunków pracy uwzględnia w szczególności przepisy wydane na podstawie art. 222 § 3, art. 222¹ § 3, art. 227 § 2 i art. 228 § 3 Kodeksu pracy, art. 25 pkt 1 ustawy – Prawo atomowe oraz załącznik nr 1 do rozporządzenia Ministra Zdrowia i Opieki Społecznej z dnia 30 maja 1996 r. w sprawie przeprowadzania badań lekarskich pracowników (Dz. U. z 2023 r. poz. 607, z późn. zm.).'),
    ],
    uwagi: ['Bez aktualnego orzeczenia o braku przeciwwskazań nie wolno dopuścić pracownika do pracy (art. 229 § 4 KP). Skierowanie wydaje się PRZED rozpoczęciem pracy.',
      'Czynniki i wielkości narażenia muszą odpowiadać rzeczywistym warunkom stanowiska (ocena ryzyka, pomiary) — to opisuje pracodawca/służba BHP, nie biuro „z głowy”. Biuro wpisuje dane dostarczone przez klienta.',
      'Badania kontrolne: po niezdolności do pracy z powodu choroby trwającej dłużej niż 30 dni (art. 229 § 2).',
      'Bez badań wstępnych: ponowne przyjęcie u tego samego pracodawcy na to samo stanowisko w ciągu 30 dni albo aktualne orzeczenie od poprzedniego pracodawcy na takie same warunki (art. 229 § 1¹–1³) — wtedy pracodawca przechowuje orzeczenie i skierowanie, na podstawie którego je wydano.',
      'Pracodawca przechowuje skierowanie i orzeczenie (art. 229 § 7). Akta osobowe część B.',
      'Zleceniobiorca: Kodeks pracy nie przewiduje skierowania na tym wzorze — badania zleceniobiorców wynikają z obowiązków BHP zleceniodawcy i ustaleń umowy; nie używać tego wzoru automatycznie.'],
    dwujezyczny: DJ.nie('Wzór urzędowy dla lekarza medycyny pracy — po polsku. Cudzoziemcowi warto ustnie wyjaśnić, gdzie i po co idzie.'),
  });

  dodaj({
    id: 'karta-szkolenia-wstepnego-bhp', nazwa: 'Karta szkolenia wstępnego w dziedzinie BHP', grupa: G_BHP, dla: 'pracownik',
    zrodlo: { typ: 'urzedowy', akt: AKTY.R_BHP.tytul, zalacznik: 'załącznik nr 2 — wzór karty szkolenia wstępnego', eli: AKTY.R_BHP.eli,
      uwaga: 'Treść odwzorowuje wzór urzędowy. Nowelizacja z 24.11.2025 r. (Dz. U. poz. 1640, w życie 12.12.2025 r.) dopuściła potwierdzenie odbycia instruktażu w postaci elektronicznej — wtedy w miejscu podpisu pracodawca robi adnotację i dołącza dokument elektroniczny lub jego odwzorowanie.' },
    podstawa: [art('art. 237³ § 1–2 i 3, art. 237⁴ § 3', 'KP'), art('§ 8–12 i załącznik nr 2 (z uwzględnieniem zmiany Dz. U. z 2025 r. poz. 1640)', 'R_BHP')],
    forma: forma('dokumentowa', 'obie', 'Odbycie instruktażu pracownik oraz kierownik komórki organizacyjnej potwierdzają w postaci papierowej (podpis na karcie) lub elektronicznej (§ 12 ust. 1–1c rozporządzenia).', { rodzaj_podpisy: 'inny', akta: 'B' }),
    pola: [W('z_nazwa'), W('z_siedziba'), W('p_imie_nazwisko', { etykieta: 'Imię i nazwisko osoby odbywającej szkolenie' }),
      pole('komorka', 'tekst', 'Nazwa komórki organizacyjnej', { wymagane: false }),
      pole('ogolny_data', 'data', 'Instruktaż ogólny — data', { wymagane: false }),
      pole('ogolny_prowadzacy', 'tekst', 'Instruktaż ogólny — imię i nazwisko przeprowadzającego', { wymagane: false }),
      W('p_stanowisko', { etykieta: 'Instruktaż stanowiskowy — stanowisko pracy' }),
      pole('stan_data', 'tekst', 'Instruktaż stanowiskowy — dzień/dni', { wymagane: false, podpowiedz: 'np. 9–10 października 2026 r.' }),
      pole('stan_prowadzacy', 'tekst', 'Instruktaż stanowiskowy — imię i nazwisko przeprowadzającego', { wymagane: false })],
    tresc: [
      nagl(['{{z_nazwa}}', '{{z_siedziba}}', '(oznaczenie pracodawcy)'], ''),
      tyt('KARTA SZKOLENIA WSTĘPNEGO'), pod('W DZIEDZINIE BEZPIECZEŃSTWA I HIGIENY PRACY'),
      kv([['1. Imię i nazwisko osoby odbywającej szkolenie', '{{p_imie_nazwisko}}'], ['2. Nazwa komórki organizacyjnej', '{{komorka}}']]),
      p('3. Instruktaż ogólny', null, 'bold'),
      p('Instruktaż ogólny przeprowadził w dniu {{ogolny_data}} {{ogolny_prowadzacy}} (imię i nazwisko przeprowadzającego instruktaż).'),
      sig(null, 'podpis osoby, której udzielono instruktażu*'),
      p('4. Instruktaż stanowiskowy', null, 'bold'),
      p('1) Instruktaż stanowiskowy na stanowisku pracy {{p_stanowisko}} przeprowadził w dniu/dniach {{stan_data}} {{stan_prowadzacy}} (imię i nazwisko przeprowadzającego instruktaż).'),
      p('Po przeprowadzeniu sprawdzianu wiedzy i umiejętności z zakresu wykonywania pracy zgodnie z przepisami i zasadami bezpieczeństwa i higieny pracy Pan(i) {{p_imie_nazwisko}} został(a) dopuszczony(-na) do wykonywania pracy na stanowisku {{p_stanowisko}}.'),
      sig('podpis osoby, której udzielono instruktażu*', 'data i podpis kierownika komórki organizacyjnej'),
      p('2)** Instruktaż stanowiskowy na stanowisku pracy ........................................ przeprowadził w dniu/dniach ........................ r. ........................................ (imię i nazwisko przeprowadzającego instruktaż).'),
      p('Po przeprowadzeniu sprawdzianu wiedzy i umiejętności z zakresu wykonywania pracy zgodnie z przepisami i zasadami bezpieczeństwa i higieny pracy Pan(i) ........................................ został(a) dopuszczony(-na) do wykonywania pracy na stanowisku ........................................'),
      sig('podpis osoby, której udzielono instruktażu*', 'data i podpis kierownika komórki organizacyjnej'),
      prz('* Podpis stanowi potwierdzenie odbycia instruktażu i zapoznania się z przepisami oraz zasadami bezpieczeństwa i higieny pracy dotyczącymi wykonywanych prac.'),
      prz('** Wypełnić w przypadkach, o których mowa w § 11 ust. 1 pkt 2 i ust. 2 i 3 rozporządzenia Ministra Gospodarki i Pracy z dnia 27 lipca 2004 r. w sprawie szkolenia w dziedzinie bezpieczeństwa i higieny pracy (Dz. U. z 2024 r. poz. 1327, z późn. zm.).'),
    ],
    uwagi: ['Szkolenie wstępne — PRZED dopuszczeniem do pracy, w czasie pracy i na koszt pracodawcy (art. 237³ § 2–3 KP). Biuro przygotowuje kartę; instruktaż przeprowadza osoba uprawniona u pracodawcy (§ 10 ust. 2 i § 11 ust. 5 rozporządzenia).',
      'Instruktaż stanowiskowy jest obowiązkowy na stanowiskach robotniczych i innych z narażeniem na czynniki szkodliwe, uciążliwe lub niebezpieczne; kończy się sprawdzianem wiedzy i umiejętności.',
      'Kartę (z ewentualnymi dokumentami elektronicznymi) przechowuje się w aktach osobowych — część B.',
      'Cudzoziemiec nieznający polskiego: szkolenie musi być dla niego zrozumiałe — samo podpisanie polskiej karty nie dowodzi przeszkolenia. Przepis nie nakazuje tłumaczenia karty, ale wymaga „dostatecznej znajomości przepisów oraz zasad BHP” (art. 237³ § 1).'],
    dwujezyczny: DJ.zalecany('Karta jest wzorem urzędowym po polsku; zalecane jest dołączenie tłumaczenia i przeprowadzenie instruktażu w języku zrozumiałym dla pracownika.'),
  });

  biuro('oswiadczenie-bhp', 'Oświadczenie pracownika o zapoznaniu się z przepisami BHP i ryzykiem zawodowym', G_BHP, 'pracownik', 'bhp', 'praca',
    [art('art. 237⁴ § 1 i 3', 'KP')], ['Pracownik potwierdza w postaci papierowej lub elektronicznej zapoznanie się z przepisami oraz zasadami BHP.', 'Akta osobowe część B.'],
    forma('dokumentowa', 'pracownik', 'Postać papierowa lub elektroniczna (art. 237⁴ § 3 KP).', { akta: 'B' }), DJ.zalecany(DJ_ZAL));

  // ---------------- RODO ----------------
  biuro('klauzula-rodo', 'Klauzula informacyjna RODO', 'RODO', 'oba', 'rodo', 'praca',
    [art('art. 13 ust. 1–2', 'RODO'), art('art. 4 ust. 6–7', 'CUDZ')],
    ['Informację podaje się PRZY pozyskiwaniu danych — najpóźniej z kwestionariuszem. U cudzoziemca okres przechowywania danych i kopii dokumentów: czas pracy + 2 lata od końca roku ustania umowy, chyba że przepisy przewidują dłuższy.'],
    forma('dokumentowa', 'pracownik', 'Obowiązek informacyjny (art. 13 RODO) nie wymaga podpisu; podpis jest tylko potwierdzeniem zapoznania się.', { rodzaj_podpisy: 'zgoda_rodo' }), DJ.zalecany('RODO wymaga informacji „w zwięzłej, przejrzystej, zrozumiałej i łatwo dostępnej formie” — osobie nieznającej polskiego należy ją przetłumaczyć.'));

  dodaj({
    id: 'upowaznienie-rodo', nazwa: 'Upoważnienie do przetwarzania danych osobowych z oświadczeniem o poufności', grupa: 'RODO', dla: 'oba',
    zrodlo: { typ: 'ustawowy', elementy: 'Przetwarzanie wyłącznie na polecenie administratora (art. 29 RODO); pisemne upoważnienie i obowiązek zachowania tajemnicy przy danych z art. 9 ust. 1 RODO (art. 22¹b § 3 KP).' },
    podstawa: [art('art. 29', 'RODO'), art('art. 22¹b § 3', 'KP')],
    forma: forma('pisemna', 'obie', 'Do przetwarzania danych szczególnych kategorii mogą być dopuszczone wyłącznie osoby posiadające pisemne upoważnienie (art. 22¹b § 3 KP); dla pozostałych danych forma dokumentowa wystarcza, ale biuro stosuje jedną — pisemną.', { akta: 'B' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('p_stanowisko'),
      pole('zakres', 'dlugi', 'Zakres danych / zbiory, do których osoba ma dostęp', { podpowiedz: 'np. dane pracowników i zleceniobiorców w zakresie prowadzenia akt osobowych i list płac' }),
      wybor('szczegolne', 'Czy upoważnienie obejmuje dane szczególnych kategorii (zdrowie, przynależność związkowa itd.)', [['nie', 'nie'], ['tak', 'tak']]),
      wybor('okres', 'Okres obowiązywania', [['zatrudnienie', 'na czas trwania zatrudnienia', 'na czas trwania zatrudnienia u administratora'], ['data', 'do wskazanego dnia', 'do dnia {{okres_do}}'], ['odwolanie', 'do odwołania', 'do odwołania']]),
      pole('okres_do', 'data', 'Upoważnienie ważne do dnia', { wymagane: false, wymagane_gdy: { pole: 'okres', rowne: 'data' } })]),
    tresc: [
      NAGL_PRACODAWCA(),
      tyt('UPOWAŻNIENIE DO PRZETWARZANIA DANYCH OSOBOWYCH'),
      p('Działając w imieniu administratora danych — {{z_nazwa}} z siedzibą: {{z_siedziba}} — na podstawie art. 29 rozporządzenia Parlamentu Europejskiego i Rady (UE) 2016/679 z dnia 27 kwietnia 2016 r. (RODO) upoważniam:'),
      kv([['Pana/Panią', '{{p_imie_nazwisko}}'], ['stanowisko', '{{p_stanowisko}}']]),
      p('do przetwarzania danych osobowych w zakresie: {{zakres}} — wyłącznie w celu wykonywania obowiązków służbowych i wyłącznie na polecenie administratora.'),
      p('Upoważnienie obejmuje także dane osobowe szczególnych kategorii, o których mowa w art. 9 ust. 1 RODO, w zakresie niezbędnym do wykonywania wskazanych obowiązków (art. 22¹b § 3 Kodeksu pracy).', { pole: 'szczegolne', rowne: 'tak' }),
      p('Upoważnienie jest ważne {{okres}}. Wygasa z chwilą ustania zatrudnienia lub odwołania, zależnie od tego, co nastąpi wcześniej.'),
      sig(null, '{{z_reprezentant}} — podpis administratora lub osoby działającej w jego imieniu'),
      tyt('OŚWIADCZENIE OSOBY UPOWAŻNIONEJ'),
      li(['Zapoznałem(-am) się z zasadami ochrony danych osobowych obowiązującymi u administratora i zobowiązuję się ich przestrzegać.',
        'Będę przetwarzać dane osobowe wyłącznie w zakresie i celu określonych w upoważnieniu oraz wyłącznie na polecenie administratora.',
        'Zobowiązuję się zachować w tajemnicy dane osobowe, do których mam dostęp, oraz sposoby ich zabezpieczenia — także po ustaniu zatrudnienia.']),
      sig(null, 'data i podpis osoby upoważnionej'),
    ],
    uwagi: ['Upoważnienie wydaje administrator (pracodawca-klient) swoim pracownikom. Biuro rachunkowe działa wobec klienta jako podmiot przetwarzający na podstawie umowy powierzenia (art. 28 RODO) — to inny dokument, poza tym katalogiem.',
      'Warto prowadzić ewidencję wydanych upoważnień (zasada rozliczalności).'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  // ---------------- umowy dodatkowe ----------------
  dodaj({
    id: 'zakaz-konkurencji-w-trakcie', nazwa: 'Umowa o zakazie konkurencji w czasie trwania stosunku pracy', grupa: G1, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Odrębna umowa określająca zakres zakazu (art. 101¹ § 1 KP), forma pisemna pod rygorem nieważności (art. 101³ KP), odpowiedzialność na zasadach działu piątego rozdziału I (art. 101¹ § 2 KP).' },
    podstawa: [art('art. 26¹, art. 101¹, art. 101³, art. 101⁴', 'KP')],
    forma: forma('pisemna', 'obie', 'Umowa wymaga formy pisemnej pod rygorem nieważności (art. 101³ KP).', { rygor: 'niewaznosc', rodzaj_podpisy: 'inny', akta: 'B' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('p_adres'), W('p_stanowisko'), W('umowa_data', { etykieta: 'Data zawarcia umowy o pracę' }),
      pole('dzialalnosc', 'dlugi', 'Zakres działalności uznawanej za konkurencyjną (przedmiot, rodzaj usług/produktów)', { podpowiedz: 'opisać konkretnie — zakaz „wszelkiej działalności” jest nieskuteczny' }),
      pole('obszar', 'tekst', 'Obszar terytorialny zakazu', { domyslnie: 'terytorium Rzeczypospolitej Polskiej' })]),
    tresc: [
      tyt('UMOWA O ZAKAZIE KONKURENCJI'), pod('w czasie trwania stosunku pracy'),
      p('zawarta w dniu {{d_data}} w miejscowości {{d_miejscowosc}} między:'),
      p('{{z_nazwa}} z siedzibą: {{z_siedziba}}, NIP {{z_nip}}, reprezentowaną przez: {{z_reprezentant}}, zwaną dalej „Pracodawcą”,'),
      p('a Panem/Panią {{p_imie_nazwisko}}, zamieszkałym(-ą): {{p_adres}}, zatrudnionym(-ą) na stanowisku {{p_stanowisko}} na podstawie umowy o pracę z dnia {{umowa_data}}, zwanym(-ą) dalej „Pracownikiem”.'),
      par('§ 1'),
      p('1. W czasie trwania stosunku pracy Pracownik nie może prowadzić działalności konkurencyjnej wobec Pracodawcy ani świadczyć pracy w ramach stosunku pracy lub na innej podstawie na rzecz podmiotu prowadzącego taką działalność.'),
      p('2. Za działalność konkurencyjną strony uznają: {{dzialalnosc}}.'),
      p('3. Zakaz obowiązuje na obszarze: {{obszar}}.'),
      par('§ 2'),
      p('Zakaz, o którym mowa w § 1, obowiązuje przez cały okres trwania stosunku pracy łączącego strony, niezależnie od zmiany stanowiska lub rodzaju umowy o pracę.'),
      par('§ 3'),
      p('Pracownik zobowiązuje się niezwłocznie poinformować Pracodawcę o każdej okoliczności mogącej stanowić naruszenie zakazu konkurencji, w szczególności o zamiarze podjęcia dodatkowej działalności w zakresie określonym w § 1 ust. 2.'),
      par('§ 4'),
      p('Pracodawca, który poniósł szkodę wskutek naruszenia przez Pracownika zakazu konkurencji, może dochodzić od Pracownika wyrównania tej szkody na zasadach określonych w przepisach rozdziału I działu piątego Kodeksu pracy (art. 101¹ § 2 Kodeksu pracy).'),
      par('§ 5'),
      p('1. Zmiana umowy wymaga formy pisemnej pod rygorem nieważności.'),
      p('2. W sprawach nieuregulowanych stosuje się przepisy Kodeksu pracy.'),
      p('3. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.'),
      sig('Pracownik', 'Pracodawca'),
    ],
    uwagi: ['Zakaz w czasie zatrudnienia nie wymaga odszkodowania dla pracownika. Odpowiedzialność pracownika jest ograniczona zasadami odpowiedzialności materialnej — w umowie celowo nie ma kary umownej.',
      'Zakres zakazu musi być konkretny i związany z rzeczywistą działalnością pracodawcy.',
      'Pracodawca nie może zakazać pracownikowi jednoczesnego zatrudnienia u innego pracodawcy lub na innej podstawie — wyjątkiem jest właśnie umowa o zakazie konkurencji (art. 26¹ KP). Zakaz może więc dotyczyć tylko działalności konkurencyjnej.'],
    dwujezyczny: DJ.zalecany('Umowa nakłada na pracownika obowiązki — cudzoziemcowi nieznającemu polskiego należy przedstawić tłumaczenie przed podpisaniem (ostrożnościowo jak przy umowie, art. 5 ust. 2 ustawy o powierzaniu pracy cudzoziemcom).'),
  });

  dodaj({
    id: 'zakaz-konkurencji-po-ustaniu', nazwa: 'Umowa o zakazie konkurencji po ustaniu stosunku pracy', grupa: G1, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Pracownik mający dostęp do szczególnie ważnych informacji; okres obowiązywania zakazu i wysokość odszkodowania (art. 101² § 1 KP); odszkodowanie nie niższe niż 25% wynagrodzenia (art. 101² § 3); ustanie zakazu (art. 101² § 2); forma pisemna pod rygorem nieważności (art. 101³).' },
    podstawa: [art('art. 101² § 1–3, art. 101³', 'KP')],
    forma: forma('pisemna', 'obie', 'Umowa wymaga formy pisemnej pod rygorem nieważności (art. 101³ KP).', { rygor: 'niewaznosc', rodzaj_podpisy: 'inny', akta: 'B' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('p_adres'), W('p_stanowisko'),
      pole('informacje', 'dlugi', 'Szczególnie ważne informacje, do których pracownik ma dostęp'),
      pole('dzialalnosc', 'dlugi', 'Zakres działalności uznawanej za konkurencyjną'),
      pole('obszar', 'tekst', 'Obszar terytorialny zakazu', { domyslnie: 'terytorium Rzeczypospolitej Polskiej' }),
      pole('okres_miesiecy', 'liczba', 'Okres obowiązywania zakazu po ustaniu stosunku pracy (miesiące)', { walidacja: 'liczba>=1' }),
      pole('procent', 'liczba', 'Odszkodowanie — % wynagrodzenia otrzymanego przed ustaniem stosunku pracy (min. 25)', { domyslnie: '25', walidacja: 'liczba>=25' }),
      wybor('platnosc', 'Sposób wypłaty odszkodowania', [['raty', 'w miesięcznych ratach', 'w równych miesięcznych ratach, płatnych do 10. dnia każdego miesiąca następującego po miesiącu, za który rata przysługuje'], ['jednorazowo', 'jednorazowo', 'jednorazowo, w terminie 14 dni od dnia ustania stosunku pracy']])]),
    tresc: [
      tyt('UMOWA O ZAKAZIE KONKURENCJI'), pod('po ustaniu stosunku pracy'),
      p('zawarta w dniu {{d_data}} w miejscowości {{d_miejscowosc}} między:'),
      p('{{z_nazwa}} z siedzibą: {{z_siedziba}}, NIP {{z_nip}}, reprezentowaną przez: {{z_reprezentant}}, zwaną dalej „Pracodawcą”,'),
      p('a Panem/Panią {{p_imie_nazwisko}}, zamieszkałym(-ą): {{p_adres}}, zatrudnionym(-ą) na stanowisku {{p_stanowisko}}, zwanym(-ą) dalej „Pracownikiem”.'),
      par('§ 1'),
      p('Strony zgodnie stwierdzają, że Pracownik w związku z wykonywaną pracą ma dostęp do szczególnie ważnych informacji, których ujawnienie mogłoby narazić Pracodawcę na szkodę, w szczególności: {{informacje}}.'),
      par('§ 2'),
      p('1. Po ustaniu stosunku pracy Pracownik nie może prowadzić działalności konkurencyjnej wobec Pracodawcy ani świadczyć pracy w ramach stosunku pracy lub na innej podstawie na rzecz podmiotu prowadzącego taką działalność.'),
      p('2. Za działalność konkurencyjną strony uznają: {{dzialalnosc}}.'),
      p('3. Zakaz obowiązuje na obszarze: {{obszar}}.'),
      par('§ 3'),
      p('Zakaz konkurencji obowiązuje przez okres {{okres_miesiecy}} miesięcy, licząc od dnia ustania stosunku pracy.'),
      par('§ 4'),
      p('1. Z tytułu powstrzymywania się od działalności konkurencyjnej Pracodawca wypłaci Pracownikowi odszkodowanie w wysokości {{procent}}% wynagrodzenia otrzymanego przez Pracownika przed ustaniem stosunku pracy przez okres odpowiadający okresowi obowiązywania zakazu konkurencji.'),
      p('2. Odszkodowanie będzie wypłacane {{platnosc}}.'),
      par('§ 5'),
      p('Zakaz konkurencji przestaje obowiązywać przed upływem terminu określonego w § 3 w razie ustania przyczyn uzasadniających taki zakaz lub niewywiązywania się Pracodawcy z obowiązku wypłaty odszkodowania (art. 101² § 2 Kodeksu pracy).'),
      par('§ 6'),
      p('1. Zmiana umowy wymaga formy pisemnej pod rygorem nieważności.'),
      p('2. W sprawach nieuregulowanych stosuje się przepisy Kodeksu pracy. W razie sporu o odszkodowaniu orzeka sąd pracy.'),
      p('3. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.'),
      sig('Pracownik', 'Pracodawca'),
    ],
    uwagi: ['Umowa tylko z pracownikiem mającym dostęp do szczególnie ważnych informacji; bez okresu i odszkodowania nie spełnia wymagań art. 101² § 1.',
      'Odszkodowanie poniżej 25% jest niezgodne z art. 101² § 3. To koszt pracodawcy — klient musi świadomie zdecydować o zawarciu umowy.',
      'Nie dotyczy zleceniobiorców (dla nich zakaz konkurencji to klauzula cywilnoprawna — poza katalogiem).'],
    dwujezyczny: DJ.zalecany('Jak przy umowie o zakazie konkurencji w trakcie zatrudnienia — tłumaczenie przed podpisaniem.'),
  });

  dodaj({
    id: 'odpowiedzialnosc-materialna', nazwa: 'Umowa o odpowiedzialności materialnej za mienie powierzone (indywidualna)', grupa: G1, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Powierzenie mienia z obowiązkiem zwrotu albo do wyliczenia się i odpowiedzialność w pełnej wysokości (art. 124 § 1–2 KP); przesłanki uwolnienia się od odpowiedzialności (art. 124 § 3 KP).' },
    podstawa: [art('art. 124, art. 127', 'KP')],
    forma: forma('pisemna', 'obie', 'Dla odpowiedzialności indywidualnej Kodeks pracy nie zastrzega formy pisemnej (wymaga jej dla współodpowiedzialności — art. 125 § 1), ale prawidłowe powierzenie mienia trzeba umieć udowodnić — biuro stosuje formę pisemną, tak jak moduł podpisów.', { rodzaj_podpisy: 'odpowiedzialnosc', akta: 'B' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('p_adres'), W('p_stanowisko'),
      pole('mienie', 'dlugi', 'Powierzone mienie (rodzaj, ilość, numery, wartość) albo odesłanie do protokołu', { podpowiedz: 'np. elektronarzędzia według protokołu przekazania z dnia …' }),
      pole('miejsce', 'tekst', 'Miejsce przechowywania / używania mienia'),
      pole('zabezpieczenie', 'dlugi', 'Warunki zabezpieczenia mienia zapewnione przez pracodawcę', { podpowiedz: 'np. zamykana szafka narzędziowa, do której klucz ma wyłącznie pracownik' })]),
    tresc: [
      tyt('UMOWA O ODPOWIEDZIALNOŚCI MATERIALNEJ'), pod('za mienie powierzone'),
      p('zawarta w dniu {{d_data}} w miejscowości {{d_miejscowosc}} między:'),
      p('{{z_nazwa}} z siedzibą: {{z_siedziba}}, NIP {{z_nip}}, reprezentowaną przez: {{z_reprezentant}}, zwaną dalej „Pracodawcą”,'),
      p('a Panem/Panią {{p_imie_nazwisko}}, zamieszkałym(-ą): {{p_adres}}, zatrudnionym(-ą) na stanowisku {{p_stanowisko}}, zwanym(-ą) dalej „Pracownikiem”.'),
      par('§ 1'),
      p('1. Pracodawca powierza Pracownikowi z obowiązkiem zwrotu albo do wyliczenia się następujące mienie: {{mienie}}.'),
      p('2. Powierzenie mienia następuje na podstawie protokołu przekazania (inwentaryzacji zdawczo-odbiorczej) podpisanego przez obie strony. Protokół stanowi załącznik do umowy.'),
      p('3. Mienie jest przechowywane lub używane w: {{miejsce}}.'),
      par('§ 2'),
      p('Pracownik przyjmuje odpowiedzialność materialną za powierzone mienie i odpowiada w pełnej wysokości za szkodę powstałą w tym mieniu (art. 124 § 1 i 2 Kodeksu pracy).'),
      par('§ 3'),
      p('Pracownik może się uwolnić od odpowiedzialności, jeżeli wykaże, że szkoda powstała z przyczyn od niego niezależnych, a w szczególności wskutek niezapewnienia przez Pracodawcę warunków umożliwiających zabezpieczenie powierzonego mienia (art. 124 § 3 Kodeksu pracy).'),
      par('§ 4'),
      p('1. Pracodawca zapewnia Pracownikowi następujące warunki umożliwiające zabezpieczenie powierzonego mienia: {{zabezpieczenie}}.'),
      p('2. Pracownik zobowiązuje się dbać o powierzone mienie, używać go zgodnie z przeznaczeniem i niezwłocznie zawiadamiać Pracodawcę o okolicznościach zagrażających mieniu oraz o stwierdzonych brakach lub uszkodzeniach.'),
      par('§ 5'),
      p('1. Rozliczenie z powierzonego mienia następuje na podstawie inwentaryzacji przeprowadzonej z udziałem Pracownika lub osoby przez niego wskazanej — okresowo oraz przy ustaniu stosunku pracy, zmianie stanowiska lub dłuższej nieobecności Pracownika.'),
      p('2. Zwrot mienia potwierdza protokół zdawczo-odbiorczy.'),
      par('§ 6'),
      p('1. Zmiana umowy wymaga formy pisemnej.'),
      p('2. W sprawach nieuregulowanych stosuje się przepisy Kodeksu pracy.'),
      p('3. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.'),
      sig('Pracownik', 'Pracodawca'),
    ],
    uwagi: ['Sama umowa nie wystarcza: mienie trzeba prawidłowo POWIERZYĆ (protokół ilościowo-wartościowy podpisany przez pracownika) i zapewnić warunki jego zabezpieczenia — inaczej pracownik uwolni się od odpowiedzialności.',
      'Współodpowiedzialność kilku pracowników (art. 125 KP) wymaga odrębnej umowy na piśmie pod rygorem nieważności i stosowania rozporządzenia Rady Ministrów wydanego na podstawie art. 126 — nie ma jej w katalogu (patrz pominięte).',
      'Jeżeli pracownik jest na stanowisku związanym z odpowiedzialnością materialną, w umowie o pracę można wydłużyć okres wypowiedzenia (art. 36 § 5 KP).',
      'Do protokołu użyć dokumentu „Protokół zdawczo-odbiorczy powierzonego mienia”.'],
    dwujezyczny: DJ.zalecany('Umowa nakłada na pracownika pełną odpowiedzialność — cudzoziemcowi nieznającemu polskiego należy przedstawić tłumaczenie przed podpisaniem.'),
  });

  dodaj({
    id: 'protokol-zdawczo-odbiorczy', nazwa: 'Protokół zdawczo-odbiorczy powierzonego mienia', grupa: 'Zakończenie zatrudnienia', dla: 'oba',
    zrodlo: { typ: 'ustawowy', elementy: 'Dowód powierzenia mienia z obowiązkiem zwrotu albo do wyliczenia się oraz dowód jego zwrotu (art. 124 § 1–2 KP). Przepisy nie określają treści protokołu.' },
    podstawa: [art('art. 124 § 1–2', 'KP')],
    forma: forma('dokumentowa', 'obie', 'Przepisy nie wymagają szczególnej formy; protokół podpisują obie strony dla celów dowodowych.', { akta: 'B' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('z_nip'), W('p_imie_nazwisko'), W('p_stanowisko'),
      wybor('kierunek', 'Rodzaj protokołu', [['wydanie', 'wydanie mienia pracownikowi', 'Pracodawca wydaje, a pracownik przyjmuje z obowiązkiem zwrotu albo do wyliczenia się następujące mienie:'], ['zwrot', 'zwrot mienia pracodawcy', 'Pracownik zwraca, a pracodawca przyjmuje następujące mienie powierzone pracownikowi:']]),
      pole('przekazujacy_pracodawca', 'tekst', 'Osoba działająca w imieniu pracodawcy', { rejestr: 'z_reprezentant' }),
      pole('uwagi_stan', 'dlugi', 'Uwagi co do stanu mienia, braków, uszkodzeń', { wymagane: false, gdy_puste: 'brak uwag' })]),
    tresc: [
      NAGL_PRACODAWCA(),
      tyt('PROTOKÓŁ ZDAWCZO-ODBIORCZY'), pod('powierzonego mienia'),
      kv([['Pracownik', '{{p_imie_nazwisko}}, {{p_stanowisko}}'], ['W imieniu pracodawcy', '{{przekazujacy_pracodawca}}']]),
      p('{{kierunek}}'),
      tab(['Lp.', 'Nazwa / opis', 'Nr seryjny lub inwentarzowy', 'Ilość', 'Wartość (zł)', 'Stan'], null, 8),
      p('Uwagi: {{uwagi_stan}}'),
      p('Protokół sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.'),
      sig('podpis pracownika', 'podpis osoby działającej w imieniu pracodawcy'),
    ],
    uwagi: ['Wydanie świadectwa pracy nie może być uzależnione od rozliczenia się pracownika z pracodawcą (art. 97 § 1³ KP).',
      'Za niezwrócone mienie nie wolno potrącać z wynagrodzenia bez pisemnej zgody pracownika (art. 91 § 1 KP).'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  // ---------------- praca zdalna ----------------
  dodaj({
    id: 'praca-zdalna-porozumienie', nazwa: 'Porozumienie o wykonywaniu pracy zdalnej (z pracownikiem)', grupa: 'W trakcie zatrudnienia', dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Uzgodnienie pracy zdalnej w trakcie zatrudnienia (art. 67¹⁹ § 1 pkt 2 KP); zasady określane w porozumieniu z pracownikiem, gdy nie ma porozumienia ze związkami ani regulaminu (art. 67²⁰ § 5 zd. 2 KP) — w zakresie wskazanym w art. 67²⁰ § 6; obowiązki pracodawcy co do narzędzi i kosztów (art. 67²⁴); informacja z art. 67²¹; kontrola (art. 67²⁸); przywrócenie poprzednich warunków (art. 67²²).' },
    podstawa: [art('art. 67¹⁸–67²², art. 67²⁴, art. 67²⁶–67²⁸, art. 67³¹', 'KP')],
    forma: forma('dokumentowa', 'obie', 'Uzgodnienie pracy zdalnej w trakcie zatrudnienia nie wymaga formy pisemnej — art. 29 § 4 KP nie stosuje się (art. 67¹⁹ § 2 KP). Porozumienie zawiera się dla celów dowodowych; wystarcza postać papierowa lub elektroniczna.', { rodzaj_podpisy: 'aneks_praca', akta: 'B' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('p_stanowisko'),
      wybor('wymiar', 'Zakres pracy zdalnej', [['calkowicie', 'całkowicie', 'całkowicie'], ['czesciowo', 'częściowo (hybrydowo)', 'częściowo — w wymiarze: {{wymiar_opis}}']]),
      pole('wymiar_opis', 'tekst', 'Wymiar / dni pracy zdalnej (gdy częściowo)', { wymagane: false, wymagane_gdy: { pole: 'wymiar', rowne: 'czesciowo' }, podpowiedz: 'np. 2 dni w tygodniu, ustalane z przełożonym' }),
      pole('od_dnia', 'data', 'Praca zdalna od dnia'),
      pole('miejsce', 'tekst', 'Miejsce wykonywania pracy zdalnej wskazane przez pracownika', { rejestr: { adres: 'a' } }),
      pole('jednostka', 'tekst', 'Jednostka organizacyjna pracodawcy, w której strukturze jest stanowisko pracownika'),
      pole('osoba_kontakt', 'tekst', 'Osoba odpowiedzialna za współpracę z pracownikiem i upoważniona do kontroli w miejscu pracy zdalnej'),
      wybor('narzedzia', 'Materiały i narzędzia pracy', [['pracodawca', 'zapewnia pracodawca', 'Pracodawca zapewnia Pracownikowi materiały i narzędzia pracy, w tym urządzenia techniczne, niezbędne do wykonywania pracy zdalnej, oraz ich instalację, serwis i konserwację.'], ['pracownik', 'pracownik używa własnych (ekwiwalent)', 'Strony ustalają, że Pracownik wykorzystuje własne materiały i narzędzia pracy, w tym urządzenia techniczne, spełniające wymagania określone w rozdziale IV działu dziesiątego Kodeksu pracy. Z tego tytułu Pracownikowi przysługuje ekwiwalent pieniężny (art. 67²⁴ § 2–3 Kodeksu pracy).']]),
      wybor('koszty', 'Rozliczenie kosztów (energia, telekomunikacja, ekwiwalent)', [['ryczalt', 'ryczałt miesięczny', 'Obowiązek pokrycia kosztów energii elektrycznej i usług telekomunikacyjnych niezbędnych do wykonywania pracy zdalnej oraz wypłaty ekwiwalentu zastępuje się ryczałtem w wysokości {{kwota}} zł miesięcznie, odpowiadającym przewidywanym kosztom ponoszonym przez Pracownika (art. 67²⁴ § 4 Kodeksu pracy).'], ['zwrot', 'zwrot kosztów / ekwiwalent według wyliczenia', 'Pracodawca pokrywa koszty energii elektrycznej i usług telekomunikacyjnych niezbędnych do wykonywania pracy zdalnej oraz wypłaca należny ekwiwalent w łącznej wysokości {{kwota}} zł miesięcznie, ustalonej z uwzględnieniem norm zużycia i cen rynkowych (art. 67²⁴ § 5 Kodeksu pracy).']]),
      pole('kwota', 'kwota', 'Kwota miesięczna (zł)'),
      pole('kontakt', 'dlugi', 'Zasady porozumiewania się i potwierdzania obecności na stanowisku pracy', { podpowiedz: 'np. e-mail służbowy i telefon; rozpoczęcie i zakończenie pracy potwierdzane wiadomością e-mail do przełożonego' })]),
    tresc: [
      tyt('POROZUMIENIE O WYKONYWANIU PRACY ZDALNEJ'),
      p('zawarte w dniu {{d_data}} w miejscowości {{d_miejscowosc}} między:'),
      p('{{z_nazwa}} z siedzibą: {{z_siedziba}}, NIP {{z_nip}}, reprezentowaną przez: {{z_reprezentant}}, zwaną dalej „Pracodawcą”,'),
      p('a Panem/Panią {{p_imie_nazwisko}}, zatrudnionym(-ą) na stanowisku {{p_stanowisko}}, zwanym(-ą) dalej „Pracownikiem”.'),
      par('§ 1', 'Uzgodnienie pracy zdalnej'),
      p('1. Strony uzgadniają, że od dnia {{od_dnia}} Pracownik wykonuje pracę zdalnie {{wymiar}}, na podstawie art. 67¹⁹ § 1 pkt 2 Kodeksu pracy.'),
      p('2. Miejscem wykonywania pracy zdalnej, wskazanym przez Pracownika i uzgodnionym z Pracodawcą, jest: {{miejsce}}. Zmiana miejsca wymaga każdorazowego uzgodnienia z Pracodawcą.'),
      p('3. Ponieważ u Pracodawcy nie zawarto porozumienia ze związkami zawodowymi ani nie wydano regulaminu pracy zdalnej, zasady wykonywania pracy zdalnej określa niniejsze porozumienie (art. 67²⁰ § 5 Kodeksu pracy).'),
      par('§ 2', 'Informacje organizacyjne'),
      p('1. Stanowisko pracy Pracownika znajduje się w strukturze jednostki organizacyjnej: {{jednostka}}.'),
      p('2. Osobą odpowiedzialną za współpracę z Pracownikiem oraz upoważnioną do przeprowadzania kontroli w miejscu wykonywania pracy zdalnej jest: {{osoba_kontakt}}.'),
      p('3. Zasady porozumiewania się stron, w tym sposób potwierdzania obecności na stanowisku pracy: {{kontakt}}.'),
      par('§ 3', 'Narzędzia pracy i koszty'),
      p('1. {{narzedzia}}'),
      p('2. {{koszty}}'),
      p('3. Pracodawca zapewnia Pracownikowi szkolenia i pomoc techniczną niezbędne do wykonywania pracy zdalnej.'),
      p('4. Pracownik odpowiada za powierzone narzędzia pracy zgodnie z przepisami o odpowiedzialności materialnej; instalację, inwentaryzację, konserwację, aktualizację oprogramowania i serwis powierzonych narzędzi zapewnia Pracodawca, a Pracownik udostępnia je w tym celu w uzgodnionym terminie.'),
      par('§ 4', 'BHP i ochrona informacji'),
      p('1. Przed dopuszczeniem do pracy zdalnej Pracownik składa oświadczenia, o których mowa w art. 67³¹ § 6 i 7 Kodeksu pracy, oraz potwierdza zapoznanie się z procedurami ochrony danych osobowych (art. 67²⁶ § 2 Kodeksu pracy).'),
      p('2. Pracownik organizuje stanowisko pracy zdalnej, uwzględniając wymagania ergonomii, i przestrzega zasad bezpiecznego i higienicznego wykonywania pracy zdalnej przekazanych przez Pracodawcę.'),
      par('§ 5', 'Kontrola'),
      p('1. Pracodawca ma prawo przeprowadzać kontrolę wykonywania pracy zdalnej, kontrolę w zakresie bezpieczeństwa i higieny pracy oraz kontrolę przestrzegania wymogów w zakresie bezpieczeństwa i ochrony informacji, w tym procedur ochrony danych osobowych.'),
      p('2. Kontrolę przeprowadza się w porozumieniu z Pracownikiem, w miejscu wykonywania pracy zdalnej, w godzinach pracy Pracownika, po uprzednim uzgodnieniu terminu. Czynności kontrolne nie mogą naruszać prywatności Pracownika i innych osób ani utrudniać korzystania z pomieszczeń domowych zgodnie z ich przeznaczeniem.'),
      par('§ 6', 'Zaprzestanie pracy zdalnej'),
      p('Każda ze stron może wystąpić z wiążącym wnioskiem, złożonym w postaci papierowej lub elektronicznej, o zaprzestanie wykonywania pracy zdalnej i przywrócenie poprzednich warunków wykonywania pracy. Strony ustalają termin przywrócenia poprzednich warunków, nie dłuższy niż 30 dni od dnia otrzymania wniosku; w razie braku porozumienia przywrócenie następuje w dniu następującym po upływie 30 dni od dnia otrzymania wniosku (art. 67²² § 1 Kodeksu pracy).'),
      par('§ 7'),
      p('1. Pozostałe warunki umowy o pracę nie ulegają zmianie.'),
      p('2. W sprawach nieuregulowanych stosuje się przepisy Kodeksu pracy.'),
      p('3. Porozumienie sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.'),
      sig('Pracownik', 'Pracodawca'),
    ],
    uwagi: ['Stosować TYLKO wtedy, gdy u pracodawcy nie ma porozumienia ze związkami ani regulaminu pracy zdalnej. Jeżeli regulamin jest — wystarcza uzgodnienie/wniosek pracownika, a zasady wynikają z regulaminu.',
      'Narzędzia, energia i telekomunikacja to obowiązek pracodawcy (art. 67²⁴ § 1); ryczałt/ekwiwalent musi odpowiadać realnym kosztom. Kwoty nie są przychodem pracownika (art. 67²⁵).',
      'Przed dopuszczeniem: ocena ryzyka + informacja BHP dla pracy zdalnej (art. 67³¹ § 5) i oświadczenia pracownika — dokument „Praca zdalna — oświadczenia pracownika”.',
      'Praca zdalna jest niedopuszczalna przy pracach z art. 67³¹ § 4 (szczególnie niebezpieczne, z czynnikami chemicznymi stwarzającymi zagrożenie, powodujące intensywne brudzenie itd.) — przy stanowiskach produkcyjnych/budowlanych z reguły nie wchodzi w grę.',
      'Informacja o porozumieniu ZBIOROWYM podlega wpisowi do Krajowej Ewidencji Układów Zbiorowych Pracy (art. 67²⁰ § 8, nowy przepis); nie dotyczy to porozumienia z pojedynczym pracownikiem.',
      'Wnioski pracowników z art. 67¹⁹ § 6–7 (ciąża, dziecko do 4 lat, opieka nad osobą z niepełnosprawnością) pracodawca musi uwzględnić albo w 7 dni roboczych podać przyczynę odmowy.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'praca-zdalna-oswiadczenia', nazwa: 'Praca zdalna — oświadczenia pracownika (BHP, warunki, ochrona danych)', grupa: 'W trakcie zatrudnienia', dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Potwierdzenie zapoznania się z oceną ryzyka zawodowego i informacją BHP oraz zobowiązanie do ich przestrzegania (art. 67³¹ § 6 KP); potwierdzenie zapewnienia bezpiecznych i higienicznych warunków na stanowisku pracy zdalnej (art. 67³¹ § 7 KP); potwierdzenie zapoznania się z procedurami ochrony danych osobowych (art. 67²⁶ § 2 KP); przy pracy zdalnej na polecenie — oświadczenie o warunkach lokalowych i technicznych (art. 67¹⁹ § 3 KP).' },
    podstawa: [art('art. 67¹⁹ § 3, art. 67²⁶ § 2, art. 67³¹ § 5–8', 'KP')],
    forma: forma('dokumentowa', 'pracownik', 'Oświadczenia w postaci papierowej lub elektronicznej (art. 67²⁶ § 2, art. 67³¹ § 6 i 7 KP).', { akta: 'B' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('p_imie_nazwisko'), W('p_stanowisko'),
      pole('miejsce', 'tekst', 'Miejsce wykonywania pracy zdalnej', { rejestr: { adres: 'a' } }),
      wybor('tryb', 'Tryb pracy zdalnej', [['uzgodnienie', 'uzgodniona z pracodawcą / okazjonalna'], ['polecenie', 'na polecenie pracodawcy (art. 67¹⁹ § 3)']])]),
    tresc: [
      NAGL_PRACOWNIK(), ADR_PRACODAWCA(),
      tyt('OŚWIADCZENIA PRACOWNIKA WYKONUJĄCEGO PRACĘ ZDALNĄ'),
      p('W związku z wykonywaniem pracy zdalnej w miejscu: {{miejsce}} oświadczam, że:'),
      li([
        { tekst: 'posiadam warunki lokalowe i techniczne do wykonywania pracy zdalnej (art. 67¹⁹ § 3 Kodeksu pracy); o zmianie tych warunków uniemożliwiającej wykonywanie pracy zdalnej niezwłocznie poinformuję pracodawcę;', gdy: { pole: 'tryb', rowne: 'polecenie' } },
        'zapoznałem(-am) się z przygotowaną przez pracodawcę oceną ryzyka zawodowego oraz informacją zawierającą zasady bezpiecznego i higienicznego wykonywania pracy zdalnej i zobowiązuję się do ich przestrzegania (art. 67³¹ § 6 Kodeksu pracy);',
        'na stanowisku pracy zdalnej w miejscu wskazanym przeze mnie i uzgodnionym z pracodawcą są zapewnione bezpieczne i higieniczne warunki tej pracy (art. 67³¹ § 7 Kodeksu pracy);',
        'zapoznałem(-am) się z określonymi przez pracodawcę procedurami ochrony danych osobowych na potrzeby wykonywania pracy zdalnej i zobowiązuję się do ich przestrzegania (art. 67²⁶ § 2 Kodeksu pracy).',
      ]),
      sig(null, 'data i podpis pracownika'),
    ],
    uwagi: ['Oświadczenie z art. 67³¹ § 7 jest WARUNKIEM dopuszczenia do pracy zdalnej — także okazjonalnej (art. 67³³ § 2 nie wyłącza art. 67³¹ § 5–7 ani art. 67²⁶).',
      'Pracodawca musi wcześniej realnie przekazać ocenę ryzyka, informację BHP i procedury ochrony danych — inaczej oświadczenie jest puste.',
      'Przy pracy zdalnej na polecenie oświadczenie o warunkach lokalowych składa się bezpośrednio przed wydaniem polecenia.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'praca-zdalna-okazjonalna', nazwa: 'Wniosek o okazjonalną pracę zdalną (do 24 dni w roku)', grupa: 'W trakcie zatrudnienia', dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Wniosek pracownika w postaci papierowej lub elektronicznej; limit 24 dni w roku kalendarzowym (art. 67³³ § 1 KP).' },
    podstawa: [art('art. 67³³, art. 67³¹ § 6–7', 'KP')],
    forma: forma('dokumentowa', 'pracownik', 'Wniosek w postaci papierowej lub elektronicznej (art. 67³³ § 1 KP).', { akta: 'B' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('p_imie_nazwisko'), W('p_stanowisko'),
      pole('termin', 'tekst', 'Dzień lub dni pracy zdalnej', { podpowiedz: 'np. 12 października 2026 r. albo 12–13 października 2026 r.' }),
      pole('liczba_dni', 'liczba', 'Liczba dni objętych wnioskiem', { walidacja: 'liczba>=1' }),
      pole('miejsce', 'tekst', 'Miejsce wykonywania pracy zdalnej', { rejestr: { adres: 'a' } })]),
    tresc: [
      NAGL_PRACOWNIK(), ADR_PRACODAWCA(),
      tyt('WNIOSEK O OKAZJONALNĄ PRACĘ ZDALNĄ'),
      p('Na podstawie art. 67³³ § 1 Kodeksu pracy wnoszę o umożliwienie mi wykonywania pracy zdalnej okazjonalnie w terminie: {{termin}} (liczba dni: {{liczba_dni}}), w miejscu: {{miejsce}}.'),
      p('Oświadczam, że zapoznałem(-am) się z oceną ryzyka zawodowego oraz informacją zawierającą zasady bezpiecznego i higienicznego wykonywania pracy zdalnej i zobowiązuję się do ich przestrzegania, a na stanowisku pracy zdalnej w wyżej wskazanym miejscu są zapewnione bezpieczne i higieniczne warunki tej pracy (art. 67³¹ § 6 i 7 Kodeksu pracy).'),
      sig(null, 'data i podpis pracownika'),
      p('Decyzja pracodawcy: wyrażam zgodę / nie wyrażam zgody*', null, 'bold'),
      sig(null, 'data i podpis pracodawcy'),
      prz('* niepotrzebne skreślić'),
    ],
    uwagi: ['Limit 24 dni w roku kalendarzowym; liczbę dni wykazuje się w świadectwie pracy (ust. 6 pkt 10 wzoru). Portal powinien sumować dni z wniosków danego pracownika.',
      'Wniosek nie wiąże pracodawcy. Przy pracy okazjonalnej pracodawca nie ma obowiązku zapewnienia narzędzi ani zwrotu kosztów (art. 67³³ § 2 wyłącza art. 67¹⁹–67²⁴).'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'informacja-monitoring', nazwa: 'Informacja o monitoringu (cele, zakres, sposób zastosowania)', grupa: G1, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Informacja o celach, zakresie i sposobie zastosowania monitoringu przekazywana pracownikowi przed dopuszczeniem do pracy (art. 22² § 6 i 8 KP); odpowiednio dla monitoringu poczty elektronicznej i innych form (art. 22³ § 3–4 KP).' },
    podstawa: [art('art. 22² § 1–10, art. 22³', 'KP')],
    forma: forma('bez_podpisu', 'potwierdzenie', 'Pracodawca przekazuje informację w postaci papierowej lub elektronicznej (art. 22² § 8 KP w brzmieniu od 27.01.2026 r.); podpis pracownika jest tylko potwierdzeniem otrzymania.', { akta: 'B' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('z_nip'), W('p_imie_nazwisko'),
      wybor('rodzaj', 'Rodzaj monitoringu', [['wizyjny', 'monitoring wizyjny (rejestracja obrazu)', 'szczególny nadzór nad terenem zakładu pracy lub terenem wokół zakładu pracy w postaci środków technicznych umożliwiających rejestrację obrazu (monitoring wizyjny) — na podstawie art. 22² Kodeksu pracy'], ['poczta', 'monitoring służbowej poczty elektronicznej', 'kontrola służbowej poczty elektronicznej pracownika (monitoring poczty elektronicznej) — na podstawie art. 22³ § 1 Kodeksu pracy'], ['inny', 'inna forma monitoringu (np. lokalizacja pojazdów)', 'inna forma monitoringu: {{inny_opis}} — na podstawie art. 22³ § 4 Kodeksu pracy']]),
      pole('inny_opis', 'tekst', 'Opis innej formy monitoringu', { wymagane: false, wymagane_gdy: { pole: 'rodzaj', rowne: 'inny' } }),
      pole('cel', 'dlugi', 'Cel monitoringu', { podpowiedz: 'tylko cele ustawowe, np. zapewnienie bezpieczeństwa pracowników i ochrona mienia' }),
      pole('zakres', 'dlugi', 'Zakres monitoringu (obszar, pomieszczenia, urządzenia)'),
      pole('sposob', 'dlugi', 'Sposób zastosowania (urządzenia, czas rejestracji, kto ma dostęp)'),
      pole('przechowywanie', 'tekst', 'Okres przechowywania nagrań / danych', { podpowiedz: 'dla nagrań obrazu nie dłużej niż 3 miesiące od dnia nagrania' }),
      pole('zrodlo_ustalen', 'tekst', 'Dokument, w którym ustalono zasady monitoringu', { podpowiedz: 'regulamin pracy / obwieszczenie z dnia …' })]),
    tresc: [
      NAGL_PRACODAWCA(), ADR_PRACOWNIK(),
      tyt('INFORMACJA O MONITORINGU'),
      p('Na podstawie art. 22² § 8 Kodeksu pracy informuję, że u pracodawcy stosowany jest: {{rodzaj}}.'),
      kv([['Cel monitoringu', '{{cel}}'], ['Zakres monitoringu', '{{zakres}}'], ['Sposób zastosowania', '{{sposob}}'], ['Okres przechowywania', '{{przechowywanie}}'], ['Zasady ustalono w', '{{zrodlo_ustalen}}']]),
      p('Monitoring wizyjny nie obejmuje pomieszczeń udostępnianych zakładowej organizacji związkowej ani — co do zasady — pomieszczeń sanitarnych, szatni, stołówek oraz palarni. Nagrania obrazu są przetwarzane wyłącznie do celów, dla których zostały zebrane, i przechowywane przez okres nieprzekraczający 3 miesięcy od dnia nagrania, chyba że stanowią lub mogą stanowić dowód w postępowaniu prowadzonym na podstawie prawa. Pomieszczenia i teren monitorowany są oznaczone w sposób widoczny i czytelny.', { pole: 'rodzaj', rowne: 'wizyjny' }),
      p('Monitoring poczty elektronicznej nie narusza tajemnicy korespondencji oraz innych dóbr osobistych pracownika.', { pole: 'rodzaj', rowne: 'poczta' }),
      p('Informacje o przetwarzaniu danych osobowych, w tym o prawach osoby, której dane dotyczą, zawiera klauzula informacyjna pracodawcy (art. 13 RODO).'),
      sig(POD_ODBIOR, POD_PRACODAWCY),
    ],
    uwagi: ['Informację przekazuje się PRZED dopuszczeniem pracownika do pracy. O wprowadzeniu nowego monitoringu informuje się załogę nie później niż 2 tygodnie przed uruchomieniem (art. 22² § 7).',
      'Cele, zakres i sposób muszą być wcześniej ustalone w układzie zbiorowym, regulaminie pracy albo obwieszczeniu (art. 22² § 6) — sama informacja dla pracownika ich nie zastąpi.',
      'Monitoring wizyjny jest dopuszczalny tylko dla celów z art. 22² § 1 (bezpieczeństwo pracowników, ochrona mienia, kontrola produkcji, tajemnica); monitoring poczty — dla organizacji pracy i właściwego użytkowania narzędzi (art. 22³ § 1).',
      'ZMIANA 2026: art. 22² § 8 po nowelizacji z 4.12.2025 r. (Dz. U. z 2026 r. poz. 25, w życie 27.01.2026 r.) mówi o postaci papierowej lub elektronicznej.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  // =====================================================================================
  //  2. W TRAKCIE ZATRUDNIENIA
  // =====================================================================================
  var G2 = 'W trakcie zatrudnienia';
  var OKRESY_WYP = [
    ['3dni', '3 dni robocze (okres próbny do 2 tygodni)', 'trzydniowego (3 dni robocze)'],
    ['1tydz', '1 tydzień (okres próbny dłuższy niż 2 tygodnie)', 'jednotygodniowego'],
    ['2tyg', '2 tygodnie (okres próbny 3 miesiące albo zatrudnienie krótsze niż 6 miesięcy)', 'dwutygodniowego'],
    ['1mies', '1 miesiąc (zatrudnienie co najmniej 6 miesięcy)', 'jednomiesięcznego'],
    ['3mies', '3 miesiące (zatrudnienie co najmniej 3 lata)', 'trzymiesięcznego'],
  ];
  var RODZAJ_UMOWY_PRACA = [['probny', 'na okres próbny'], ['okreslony', 'na czas określony'], ['nieokreslony', 'na czas nieokreślony']];
  var UW_OKRES_WYP = 'Okres wypowiedzenia: art. 34 (okres próbny) i art. 36 § 1 KP (czas określony i nieokreślony — zależnie od okresu zatrudnienia u danego pracodawcy). Okres liczony w tygodniach kończy się w sobotę, a w miesiącach — w ostatnim dniu miesiąca (art. 30 § 2¹ KP).';
  var UW_SAD = 'Pole „sąd pracy”: wpisać sąd rejonowy – sąd pracy właściwy dla sprawy (zasad właściwości z Kodeksu postępowania cywilnego dziś nie czytano — kadrowa potwierdza sąd dla danego pracodawcy i zapisuje go w danych klienta).';
  var POLA_SAD = function () {
    return [pole('sad', 'tekst', 'Sąd Rejonowy – Sąd Pracy w (siedziba sądu)', { podpowiedz: 'np. Warszawie' }),
      pole('komisja', 'tekst', 'Komisja pojednawcza — siedziba (tylko gdy u pracodawcy ją powołano)', { wymagane: false })];
  };

  dodaj({
    id: 'aneks-do-umowy-o-prace', nazwa: 'Porozumienie zmieniające warunki umowy o pracę (aneks)', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Zmiana warunków umowy o pracę za zgodą obu stron w formie pisemnej (art. 29 § 4 KP).' },
    podstawa: [art('art. 29 § 1, 3³ i 4', 'KP'), art('art. 5 ust. 1–2, art. 5a ust. 5', 'CUDZ')],
    forma: forma('pisemna', 'obie', 'Zmiana warunków umowy o pracę wymaga formy pisemnej (art. 29 § 4 KP).', { rodzaj_podpisy: 'aneks_praca', akta: 'B' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('umowa_data', { etykieta: 'Data zawarcia umowy o pracę' }),
      pole('numer', 'tekst', 'Numer aneksu', { wymagane: false, gdy_puste: '1' }),
      pole('od_dnia', 'data', 'Zmiana obowiązuje od dnia'),
      pole('zmiany', 'dlugi', 'Zmieniane warunki — nowe brzmienie', { podpowiedz: 'np. „wynagrodzenie zasadnicze: 5 200,00 zł brutto miesięcznie”; „wymiar czasu pracy: pełny etat”; „rodzaj pracy: operator wózka widłowego”' })]),
    tresc: [
      tyt('POROZUMIENIE ZMIENIAJĄCE'), pod('aneks nr {{numer}} do umowy o pracę z dnia {{umowa_data}}'),
      p('zawarte w dniu {{d_data}} w miejscowości {{d_miejscowosc}} między:'),
      p('{{z_nazwa}} z siedzibą: {{z_siedziba}}, NIP {{z_nip}}, reprezentowaną przez: {{z_reprezentant}}, zwaną dalej „Pracodawcą”,'),
      p('a Panem/Panią {{p_imie_nazwisko}}, zwanym(-ą) dalej „Pracownikiem”.'),
      par('§ 1'),
      p('Strony zgodnie postanawiają, że z dniem {{od_dnia}} następujące warunki umowy o pracę z dnia {{umowa_data}} otrzymują brzmienie:'),
      p('{{zmiany}}'),
      par('§ 2'),
      p('Pozostałe warunki umowy o pracę nie ulegają zmianie.'),
      par('§ 3'),
      p('Porozumienie sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.'),
      sig('data i podpis pracownika', POD_PRACODAWCY),
    ],
    uwagi: ['Aneks wymaga zgody pracownika. Bez zgody — tylko wypowiedzenie zmieniające (art. 42 KP).',
      'Po zmianie warunków trzeba zaktualizować informację o warunkach zatrudnienia — najpóźniej w dniu, w którym zmiana ma zastosowanie (art. 29 § 3³).',
      'Przedłużenie umowy na czas określony aneksem liczy się jako nowa umowa do limitu 3 umów / 33 miesięcy (art. 25¹ § 2).',
      'CUDZOZIEMIEC: zmiana stanowiska, rodzaju umowy, wymiaru czasu pracy lub wynagrodzenia może wymagać nowego zezwolenia / oświadczenia. Przy ochronie czasowej — ponowne powiadomienie PUP w 7 dni przy zmianie rodzaju umowy, stanowiska, zmniejszeniu wymiaru lub obniżeniu stawki (art. 5a ust. 5).'],
    dwujezyczny: DJ.wymagany('art. 5 ust. 2 ustawy o powierzaniu pracy cudzoziemcom', 'Aneks zmienia umowę zawartą z cudzoziemcem — jeżeli nie posługuje się on językiem polskim, treść zmiany przedstawia się mu na piśmie w wersji zrozumiałej przed podpisaniem (ostrożnościowo: tak jak umowę).'),
  });

  dodaj({
    id: 'wypowiedzenie-zmieniajace', nazwa: 'Wypowiedzenie warunków umowy o pracę (wypowiedzenie zmieniające)', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'urzedowy', akt: 'Pomocniczy wzór MRPiPS „Wypowiedzenie warunków umowy o pracę”', url: URL.MRPIPS_WZORY, eli: AKTY.KP.eli,
      uwaga: 'Układ i sformułowania według pomocniczego wzoru MRPiPS. Wzór ministerstwa opisuje przyczynę jako wymaganą tylko przy umowie na czas nieokreślony — tutaj dostosowano do obecnego art. 30 § 4 KP (także umowa na czas określony).' },
    podstawa: [art('art. 42 § 1–3, art. 30 § 3–5, art. 36, art. 38, art. 41, art. 43, art. 264 § 1', 'KP')],
    forma: forma('pisemna', 'pracodawca', 'Wypowiedzenie warunków uważa się za dokonane, jeżeli pracownikowi zaproponowano na piśmie nowe warunki (art. 42 § 2 KP); oświadczenie o wypowiedzeniu składa się na piśmie (art. 30 § 3 KP).', { rodzaj_podpisy: 'rozwiazanie', akta: 'B' }),
    pola: MD().concat(PRACODAWCA()).concat([W('z_regon'), W('p_imie_nazwisko'), W('umowa_data'),
      wybor('rodzaj_umowy', 'Rodzaj umowy', RODZAJ_UMOWY_PRACA),
      pole('czesc', 'dlugi', 'Postanowienia umowy podlegające wypowiedzeniu', { podpowiedz: 'np. wysokości wynagrodzenia zasadniczego' }),
      wybor('okres_wyp', 'Okres wypowiedzenia', OKRESY_WYP),
      pole('koniec_wyp', 'data', 'Okres wypowiedzenia upłynie w dniu'),
      pole('przyczyna', 'dlugi', 'Przyczyna wypowiedzenia dotychczasowych warunków', { wymagane: false, wymagane_gdy: { pole: 'rodzaj_umowy', w: ['okreslony', 'nieokreslony'] } }),
      pole('nowe_od', 'data', 'Nowe warunki od dnia'),
      pole('nowe_warunki', 'dlugi', 'Proponowane nowe warunki umowy o pracę'),
      pole('polowa', 'data', 'Termin na odmowę — połowa okresu wypowiedzenia upływa w dniu')]).concat(POLA_SAD()),
    tresc: [
      nagl(['{{z_nazwa}}', '{{z_siedziba}}', 'NIP: {{z_nip}}, REGON: {{z_regon}}']),
      tyt('WYPOWIEDZENIE WARUNKÓW UMOWY O PRACĘ'), ADR_PRACOWNIK(),
      p('Wypowiadam Panu/Pani umowę o pracę zawartą w dniu {{umowa_data}} w części dotyczącej: {{czesc}}, z zachowaniem {{okres_wyp}} okresu wypowiedzenia, który upłynie w dniu {{koniec_wyp}}.'),
      p('Przyczyną wypowiedzenia dotychczasowych warunków umowy o pracę jest: {{przyczyna}}', { pole: 'rodzaj_umowy', w: ['okreslony', 'nieokreslony'] }),
      p('Po upływie okresu wypowiedzenia, tj. od dnia {{nowe_od}}, proponuję następujące, nowe warunki umowy o pracę: {{nowe_warunki}}'),
      p('Pozostałe warunki umowy o pracę nie ulegają zmianie.'),
      pou('POUCZENIE', [
        'Jeżeli Pan/Pani przed upływem połowy okresu wypowiedzenia, tj. do dnia {{polowa}}, nie złoży oświadczenia o odmowie przyjęcia nowych warunków umowy o pracę, będzie to równoznaczne z wyrażeniem zgody na proponowaną zmianę warunków umowy.',
        'W razie odmowy przyjęcia przez Pana/Panią zaproponowanych warunków umowy o pracę, umowa rozwiąże się z upływem okresu wypowiedzenia, tj. z dniem {{koniec_wyp}}.',
        'Jednocześnie informuję, iż w terminie 21 dni od dnia doręczenia niniejszego pisma przysługuje Panu/Pani prawo wniesienia odwołania do Sądu Rejonowego – Sądu Pracy w {{sad}}.',
        { tekst: 'Przed upływem tego terminu może Pan/Pani złożyć wniosek o wszczęcie postępowania pojednawczego przed Komisją Pojednawczą: {{komisja}}.', gdy: { pole: 'komisja', niepuste: true } },
      ]),
      sig(POD_ODBIOR, POD_PRAC_IMIE),
    ],
    uwagi: ['Pouczenie o skutkach braku odmowy jest OBOWIĄZKOWE (art. 42 § 3 KP). Bez niego pracownik może odmówić aż do końca okresu wypowiedzenia.',
      'Stosuje się odpowiednio wszystkie przepisy o wypowiedzeniu umowy: przyczyna (umowy na czas określony i nieokreślony), konsultacja ze związkiem (art. 38), zakaz wypowiadania w czasie urlopu i usprawiedliwionej nieobecności (art. 41), ochrona przedemerytalna z wyjątkami z art. 43.',
      UW_OKRES_WYP, UW_SAD,
      'Wypowiedzenie nie jest potrzebne przy powierzeniu innej pracy do 3 miesięcy w roku, bez obniżenia wynagrodzenia i zgodnie z kwalifikacjami (art. 42 § 4).',
      'CUDZOZIEMIEC: nowe warunki mogą wymagać nowego zezwolenia / oświadczenia albo ponownego powiadomienia PUP (art. 5a ust. 5 ustawy o powierzaniu pracy cudzoziemcom).'],
    dwujezyczny: DJ.zalecany('Pismo wywołuje skutki przez milczenie pracownika — cudzoziemcowi nieznającemu polskiego należy doręczyć je z tłumaczeniem; nowe warunki umowy powinien otrzymać w wersji zrozumiałej (art. 5 ust. 2 ustawy o powierzaniu pracy cudzoziemcom — ostrożnościowo).'),
  });

  dodaj({
    id: 'wniosek-zmiana-rodzaju-umowy', nazwa: 'Wniosek pracownika o zmianę rodzaju umowy lub bardziej przewidywalne warunki pracy', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Wniosek pracownika zatrudnionego co najmniej 6 miesięcy, raz w roku kalendarzowym, w postaci papierowej lub elektronicznej (art. 29³ § 1 KP).' },
    podstawa: [art('art. 29³', 'KP'), art('art. 281 § 1 pkt 2b', 'KP')],
    forma: forma('dokumentowa', 'pracownik', 'Wniosek w postaci papierowej lub elektronicznej (art. 29³ § 1 KP).', { akta: 'B' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('p_imie_nazwisko'), W('p_stanowisko'),
      wybor('przedmiot', 'Czego dotyczy wniosek', [['nieokreslony', 'zmiana rodzaju umowy na czas nieokreślony', 'zmianę rodzaju umowy o pracę na umowę o pracę na czas nieokreślony'], ['warunki', 'bardziej przewidywalne i bezpieczne warunki pracy', 'bardziej przewidywalne i bezpieczne warunki pracy, polegające na: {{opis}}']]),
      pole('opis', 'dlugi', 'Opis wnioskowanych warunków (np. pełny wymiar czasu pracy, zmiana rodzaju pracy)', { wymagane: false, wymagane_gdy: { pole: 'przedmiot', rowne: 'warunki' } }),
      pole('uzasadnienie', 'dlugi', 'Uzasadnienie (nieobowiązkowe)', { wymagane: false, gdy_puste: '—' })]),
    tresc: [
      NAGL_PRACOWNIK(), ADR_PRACODAWCA(),
      tyt('WNIOSEK'),
      p('Na podstawie art. 29³ § 1 Kodeksu pracy wnoszę o {{przedmiot}}.'),
      p('Uzasadnienie: {{uzasadnienie}}'),
      sig(null, POD_PRACOWNIKA),
    ],
    uwagi: ['Pracodawca odpowiada w postaci papierowej lub elektronicznej w ciągu 1 miesiąca od otrzymania wniosku; przy odmowie podaje przyczynę (art. 29³ § 3). Brak odpowiedzi w terminie jest wykroczeniem (art. 281 § 1 pkt 2b KP).',
      'Wniosek nie przysługuje pracownikowi na okresie próbnym; do 6 miesięcy wlicza się zatrudnienie u poprzedniego pracodawcy przy przejściu zakładu pracy.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wniosek-indywidualny-rozklad', nazwa: 'Wniosek o indywidualny rozkład czasu pracy', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Wniosek pracownika w postaci papierowej lub elektronicznej o ustalenie indywidualnego rozkładu czasu pracy w ramach systemu, którym jest objęty (art. 142 KP).' },
    podstawa: [art('art. 142', 'KP'), art('§ 6 pkt 1 lit. b', 'R_DOK')],
    forma: forma('dokumentowa', 'pracownik', 'Wniosek w postaci papierowej lub elektronicznej (art. 142 KP w brzmieniu od 27.01.2026 r.).', { akta: 'dokumentacja czasu pracy' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('p_imie_nazwisko'), W('p_stanowisko'),
      pole('od_dnia', 'data', 'Od dnia'), pole('do_dnia', 'data', 'Do dnia (puste = do odwołania)', { wymagane: false, gdy_puste: 'odwołania' }),
      pole('rozklad', 'dlugi', 'Proponowany rozkład czasu pracy (dni i godziny)', { podpowiedz: 'np. poniedziałek–piątek w godz. 7:00–15:00' })]),
    tresc: [
      NAGL_PRACOWNIK(), ADR_PRACODAWCA(),
      tyt('WNIOSEK O USTALENIE INDYWIDUALNEGO ROZKŁADU CZASU PRACY'),
      p('Na podstawie art. 142 Kodeksu pracy wnoszę o ustalenie dla mnie, w ramach systemu czasu pracy, którym jestem objęty(-a), indywidualnego rozkładu czasu pracy w okresie od {{od_dnia}} do {{do_dnia}}:'),
      p('{{rozklad}}'),
      sig(null, POD_PRACOWNIKA),
      p('Decyzja pracodawcy: wyrażam zgodę / nie wyrażam zgody*', null, 'bold'),
      sig(null, 'data i podpis pracodawcy'),
      prz('* niepotrzebne skreślić'),
    ],
    uwagi: ['Wniosek przechowuje się w dokumentacji czasu pracy (§ 6 pkt 1 lit. b rozporządzenia w sprawie dokumentacji pracowniczej).',
      'Pracodawca „może” ustalić rozkład — wniosek nie jest wiążący. Wnioski wiążące (rodzice dziecka z niepełnosprawnością itd.) reguluje art. 142¹ KP — nie objęte tym wzorem.',
      'ZMIANA 2026: od 27.01.2026 r. wniosek można złożyć w postaci elektronicznej (wcześniej forma pisemna).'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'polecenie-pracy-nadliczbowej', nazwa: 'Polecenie pracy w godzinach nadliczbowych', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Dopuszczalność pracy nadliczbowej: akcja ratownicza / usunięcie awarii albo szczególne potrzeby pracodawcy (art. 151 § 1 KP); rekompensata dodatkiem lub czasem wolnym (art. 151¹–151² KP). Przepisy nie określają formy polecenia.' },
    podstawa: [art('art. 151 § 1–4, art. 151¹ § 1, art. 151² § 1–3, art. 178', 'KP'), art('§ 6 pkt 1 lit. c', 'R_DOK')],
    forma: forma('dokumentowa', 'pracodawca', 'Przepisy nie wymagają formy pisemnej polecenia; dokument jest dowodem do ewidencji czasu pracy (§ 6 pkt 1 lit. c rozporządzenia w sprawie dokumentacji pracowniczej).', { akta: 'dokumentacja czasu pracy' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('p_stanowisko'),
      pole('dzien', 'data', 'Dzień pracy nadliczbowej'), pole('godziny', 'tekst', 'Godziny (od–do)', { podpowiedz: 'np. 15:00–18:00' }),
      pole('liczba_godzin', 'liczba', 'Liczba godzin nadliczbowych', { walidacja: 'liczba>=1' }),
      wybor('podstawa_nadg', 'Podstawa', [['potrzeby', 'szczególne potrzeby pracodawcy', 'szczególnymi potrzebami pracodawcy (art. 151 § 1 pkt 2 Kodeksu pracy)'], ['akcja', 'akcja ratownicza / usunięcie awarii', 'koniecznością prowadzenia akcji ratowniczej w celu ochrony życia lub zdrowia ludzkiego, ochrony mienia lub środowiska albo usunięcia awarii (art. 151 § 1 pkt 1 Kodeksu pracy)']]),
      pole('opis', 'dlugi', 'Na czym polega potrzeba'),
      wybor('rekompensata', 'Rekompensata', [['dodatek', 'wynagrodzenie z dodatkiem', 'Za pracę w godzinach nadliczbowych przysługuje normalne wynagrodzenie oraz dodatek określony w art. 151¹ § 1 Kodeksu pracy.'], ['wolne', 'czas wolny (bez wniosku pracownika)', 'W zamian za czas przepracowany w godzinach nadliczbowych zostanie udzielony czas wolny od pracy w wymiarze o połowę wyższym niż liczba przepracowanych godzin nadliczbowych, najpóźniej do końca okresu rozliczeniowego (art. 151² § 2 Kodeksu pracy).']])]),
    tresc: [
      NAGL_PRACODAWCA(), adr(['Pan/Pani', '{{p_imie_nazwisko}}', '{{p_stanowisko}}']),
      tyt('POLECENIE PRACY W GODZINACH NADLICZBOWYCH'),
      p('W związku ze {{podstawa_nadg}}, polegającymi na: {{opis}}, polecam Panu/Pani wykonywanie pracy w godzinach nadliczbowych w dniu {{dzien}} w godzinach {{godziny}} (liczba godzin: {{liczba_godzin}}).', { pole: 'podstawa_nadg', rowne: 'potrzeby' }),
      p('W związku z {{podstawa_nadg}}, polegającą na: {{opis}}, polecam Panu/Pani wykonywanie pracy w godzinach nadliczbowych w dniu {{dzien}} w godzinach {{godziny}} (liczba godzin: {{liczba_godzin}}).', { pole: 'podstawa_nadg', rowne: 'akcja' }),
      p('{{rekompensata}}'),
      sig(POD_ODBIOR, POD_PRAC_IMIE),
    ],
    uwagi: ['Limit 150 godzin nadliczbowych w roku z tytułu szczególnych potrzeb pracodawcy, chyba że regulamin / układ / umowa ustala inny (art. 151 § 3–4).',
      'ZAKAZ: pracownica w ciąży — nigdy; pracownik wychowujący dziecko do 8 lat — tylko za jego zgodą (art. 178). Szczególnych potrzeb pracodawcy nie stosuje się na stanowiskach z przekroczeniem NDS/NDN (art. 151 § 2).',
      'Praca nadliczbowa nie może naruszać odpoczynku dobowego i tygodniowego. Czas wolny na wniosek pracownika — w tym samym wymiarze (art. 151² § 1).',
      'Dokument dotyczy wyłącznie pracowników; zleceniobiorca nie ma norm czasu pracy.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'kara-porzadkowa', nazwa: 'Zawiadomienie o zastosowaniu kary porządkowej', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Zawiadomienie na piśmie wskazujące rodzaj naruszenia obowiązków pracowniczych, datę naruszenia oraz informację o prawie zgłoszenia sprzeciwu i terminie jego wniesienia (art. 110 KP).' },
    podstawa: [art('art. 108–113', 'KP')],
    forma: forma('pisemna', 'pracodawca', 'O zastosowanej karze pracodawca zawiadamia pracownika na piśmie (art. 110 KP).', { rodzaj_podpisy: 'inny', akta: 'D' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('p_stanowisko'),
      wybor('kara', 'Rodzaj kary', [['upomnienie', 'kara upomnienia', 'karę upomnienia'], ['nagana', 'kara nagany', 'karę nagany'], ['pieniezna', 'kara pieniężna (tylko za naruszenia z art. 108 § 2)', 'karę pieniężną w wysokości {{kwota}} zł']]),
      pole('kwota', 'kwota', 'Kwota kary pieniężnej (zł)', { wymagane: false, wymagane_gdy: { pole: 'kara', rowne: 'pieniezna' } }),
      pole('naruszenie', 'dlugi', 'Rodzaj naruszenia obowiązków pracowniczych (konkretnie)', { podpowiedz: 'np. opuszczenie pracy bez usprawiedliwienia w dniu …' }),
      pole('data_naruszenia', 'data', 'Data dopuszczenia się naruszenia'),
      pole('data_wiadomosci', 'data', 'Data powzięcia wiadomości o naruszeniu przez pracodawcę'),
      pole('data_wysluchania', 'data', 'Data wysłuchania pracownika'),
      wybor('zwiazek', 'Czy pracownika reprezentuje zakładowa organizacja związkowa', [['nie', 'nie'], ['tak', 'tak']])]),
    tresc: [
      NAGL_PRACODAWCA(), adr(['Pan/Pani', '{{p_imie_nazwisko}}', '{{p_stanowisko}}']),
      tyt('ZAWIADOMIENIE O ZASTOSOWANIU KARY PORZĄDKOWEJ'),
      p('Na podstawie art. 108 § 1 Kodeksu pracy stosuję wobec Pana/Pani {{kara}}.', { pole: 'kara', w: ['upomnienie', 'nagana'] }),
      p('Na podstawie art. 108 § 2 Kodeksu pracy stosuję wobec Pana/Pani {{kara}}.', { pole: 'kara', rowne: 'pieniezna' }),
      kv([['Rodzaj naruszenia obowiązków pracowniczych', '{{naruszenie}}'], ['Data dopuszczenia się naruszenia', '{{data_naruszenia}}']]),
      p('Kara została zastosowana po uprzednim wysłuchaniu Pana/Pani w dniu {{data_wysluchania}}. O naruszeniu pracodawca powziął wiadomość w dniu {{data_wiadomosci}}.'),
      pou('POUCZENIE', [
        'Jeżeli zastosowanie kary nastąpiło z naruszeniem przepisów prawa, może Pan/Pani w ciągu 7 dni od dnia zawiadomienia o ukaraniu wnieść sprzeciw do pracodawcy (art. 112 § 1 Kodeksu pracy).',
        { tekst: 'O uwzględnieniu lub odrzuceniu sprzeciwu decyduje pracodawca.', gdy: { pole: 'zwiazek', rowne: 'nie' } },
        { tekst: 'O uwzględnieniu lub odrzuceniu sprzeciwu decyduje pracodawca po rozpatrzeniu stanowiska reprezentującej Pana/Panią zakładowej organizacji związkowej.', gdy: { pole: 'zwiazek', rowne: 'tak' } },
        'Nieodrzucenie sprzeciwu w ciągu 14 dni od dnia jego wniesienia jest równoznaczne z uwzględnieniem sprzeciwu.',
        'W razie odrzucenia sprzeciwu może Pan/Pani w ciągu 14 dni od dnia zawiadomienia o odrzuceniu sprzeciwu wystąpić do sądu pracy o uchylenie zastosowanej kary (art. 112 § 2 Kodeksu pracy).',
        'Karę uważa się za niebyłą, a odpis zawiadomienia o ukaraniu usuwa się z akt osobowych po roku nienagannej pracy (art. 113 § 1 Kodeksu pracy).',
      ]),
      sig(POD_ODBIOR, POD_PRAC_IMIE),
    ],
    uwagi: ['TERMINY (art. 109): kara nie może być zastosowana po upływie 2 tygodni od powzięcia wiadomości o naruszeniu i po upływie 3 miesięcy od dopuszczenia się naruszenia. Przed ukaraniem trzeba pracownika WYSŁUCHAĆ; nieobecność pracownika zawiesza bieg terminu 2 tygodni.',
      'Kary tylko trzy: upomnienie, nagana, kara pieniężna. Stosowanie innych kar (np. potrącenie premii „za karę” nazwane karą, odebranie dnia wolnego) jest wykroczeniem (art. 281 § 1 pkt 4 KP).',
      'Kara pieniężna WYŁĄCZNIE za: nieprzestrzeganie przepisów BHP lub przeciwpożarowych, opuszczenie pracy bez usprawiedliwienia, stawienie się w stanie nietrzeźwości / po użyciu alkoholu lub podobnie działającego środka, spożywanie alkoholu lub zażywanie takiego środka w czasie pracy (art. 108 § 2). Limit: jednodniowe wynagrodzenie za jedno przekroczenie i za każdy dzień nieobecności; łącznie nie więcej niż 1/10 wynagrodzenia do wypłaty po potrąceniach z art. 87 § 1 pkt 1–3 (art. 108 § 3). Wpływy — na poprawę warunków BHP.',
      'Odpis zawiadomienia składa się do akt osobowych — część D.',
      'Kary porządkowe dotyczą tylko pracowników — nigdy zleceniobiorców.'],
    dwujezyczny: DJ.zalecany('Od doręczenia biegnie 7-dniowy termin na sprzeciw — cudzoziemcowi nieznającemu polskiego doręczyć z tłumaczeniem, inaczej pouczenie jest dla niego niezrozumiałe.'),
  });

  dodaj({
    id: 'sprzeciw-od-kary', nazwa: 'Sprzeciw pracownika od kary porządkowej', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Sprzeciw wnoszony w ciągu 7 dni od zawiadomienia o ukaraniu, gdy zastosowanie kary nastąpiło z naruszeniem przepisów prawa (art. 112 § 1 KP).' },
    podstawa: [art('art. 112', 'KP')],
    forma: forma('dokumentowa', 'pracownik', 'Przepis nie określa formy sprzeciwu; dla zachowania terminu potrzebny jest dowód wniesienia.', { akta: 'D' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('p_imie_nazwisko'), W('p_stanowisko'),
      pole('kara_opis', 'tekst', 'Zastosowana kara', { podpowiedz: 'np. kary nagany' }),
      pole('data_zawiadomienia', 'data', 'Data zawiadomienia o ukaraniu'),
      pole('uzasadnienie', 'dlugi', 'Na czym polega naruszenie przepisów przy zastosowaniu kary')]),
    tresc: [
      NAGL_PRACOWNIK(), ADR_PRACODAWCA(),
      tyt('SPRZECIW OD ZASTOSOWANEJ KARY PORZĄDKOWEJ'),
      p('Na podstawie art. 112 § 1 Kodeksu pracy wnoszę sprzeciw od {{kara_opis}}, o której zastosowaniu zostałem(-am) zawiadomiony(-a) w dniu {{data_zawiadomienia}}, i wnoszę o jej uchylenie.'),
      p('Uzasadnienie: {{uzasadnienie}}'),
      sig(null, POD_PRACOWNIKA),
    ],
    uwagi: ['Pracodawca: nieodrzucenie sprzeciwu w ciągu 14 dni od jego wniesienia = uwzględnienie (art. 112 § 1). Termin trzeba wpisać do kalendarza kadr w dniu wpływu.',
      'Po uwzględnieniu sprzeciwu wobec kary pieniężnej pracodawca zwraca równowartość kary (art. 112 § 3).'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wezwanie-usprawiedliwienie-nieobecnosci', nazwa: 'Wezwanie do usprawiedliwienia nieobecności w pracy', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Obowiązek pracownika zawiadomienia o przyczynie i przewidywanym okresie nieobecności najpóźniej w drugim dniu nieobecności oraz przedstawienia dowodów (§ 2–3 rozporządzenia). Treści wezwania przepisy nie określają.' },
    podstawa: [art('§ 1–3', 'R_NIEOB'), art('art. 108 § 1–2, art. 52 § 1 pkt 1 i § 2', 'KP')],
    forma: forma('dokumentowa', 'pracodawca', 'Przepisy nie wymagają szczególnej formy; ważny jest dowód doręczenia.', { akta: 'B' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('p_adres'),
      pole('okres_nieobecnosci', 'tekst', 'Dzień / dni nieobecności', { podpowiedz: 'np. od 5 października 2026 r.' }),
      pole('termin_dni', 'liczba', 'Termin na odpowiedź (dni od otrzymania pisma)', { domyslnie: '3', walidacja: 'liczba>=1' }),
      pole('kontakt', 'tekst', 'Sposób kontaktu z pracodawcą (telefon, e-mail)')]),
    tresc: [
      NAGL_PRACODAWCA(), adr(['Pan/Pani', '{{p_imie_nazwisko}}', '{{p_adres}}']),
      tyt('WEZWANIE DO USPRAWIEDLIWIENIA NIEOBECNOŚCI W PRACY'),
      p('Stwierdzam, że {{okres_nieobecnosci}} nie stawił(a) się Pan/Pani do pracy i nie zawiadomił(a) pracodawcy o przyczynie nieobecności ani o przewidywanym okresie jej trwania.'),
      p('Wzywam Pana/Panią do podania przyczyny nieobecności i przedstawienia dowodów ją usprawiedliwiających oraz do stawienia się do pracy — w terminie {{termin_dni}} dni od dnia otrzymania niniejszego pisma. Kontakt: {{kontakt}}.'),
      p('Przypominam, że pracownik jest obowiązany niezwłocznie zawiadomić pracodawcę o przyczynie swojej nieobecności i przewidywanym okresie jej trwania, nie później jednak niż w drugim dniu nieobecności w pracy (§ 2 ust. 2 rozporządzenia Ministra Pracy i Polityki Socjalnej z dnia 15 maja 1996 r. w sprawie sposobu usprawiedliwiania nieobecności w pracy oraz udzielania pracownikom zwolnień od pracy).'),
      p('Nieusprawiedliwiona nieobecność w pracy stanowi naruszenie obowiązków pracowniczych i może skutkować zastosowaniem kary porządkowej (art. 108 Kodeksu pracy), a w razie ciężkiego naruszenia podstawowych obowiązków pracowniczych — rozwiązaniem umowy o pracę bez wypowiedzenia (art. 52 § 1 pkt 1 Kodeksu pracy).'),
      sig(null, POD_PRAC_IMIE),
    ],
    uwagi: ['Wysłać listem poleconym za potwierdzeniem odbioru na adres zamieszkania oraz dodatkowo e-mailem / komunikatorem — od daty uzyskania wiadomości biegnie 1 miesiąc na ewentualne rozwiązanie umowy z art. 52 (art. 52 § 2).',
      'CUDZOZIEMIEC: jeżeli nieobecność oznacza przerwanie lub zakończenie pracy, sprawdzić obowiązki powiadomienia organu (zezwolenie: art. 19 — przerwa ponad 2 miesiące, zakończenie wcześniej niż 2 miesiące przed końcem zezwolenia; oświadczenie: art. 70 ust. 2 ustawy o powierzaniu pracy cudzoziemcom).'],
    dwujezyczny: DJ.zalecany('Pismo z rygorami — cudzoziemcowi nieznającemu polskiego doręczyć z tłumaczeniem.'),
  });

  dodaj({
    id: 'zaswiadczenie-o-zatrudnieniu', nazwa: 'Zaświadczenie o zatrudnieniu i wynagrodzeniu', grupa: G2, dla: 'oba',
    zrodlo: { typ: 'ustawowy', elementy: 'BRAK przepisu określającego treść — dokument zwyczajowy wystawiany na wniosek osoby zatrudnionej. Zakres ograniczono do danych, którymi pracodawca dysponuje na podstawie art. 22¹ KP i dokumentacji płacowej; bez danych nadmiarowych (zasada minimalizacji).' },
    podstawa: [art('art. 22¹ § 1 i 3 (zakres danych pracodawcy)', 'KP')],
    forma: forma('dokumentowa', 'pracodawca', 'Przepisy nie określają formy; odbiorcy (bank, urząd) zwykle oczekują podpisu osoby upoważnionej.', { rodzaj_podpisy: 'inny' }),
    pola: MD().concat(PRACODAWCA()).concat([W('z_regon'), W('p_imie_nazwisko'), W('p_pesel'), W('p_stanowisko'),
      wybor('podstawa_zatr', 'Podstawa zatrudnienia', [['probny', 'umowa o pracę na okres próbny', 'umowy o pracę na okres próbny do dnia {{do_dnia}}'], ['okreslony', 'umowa o pracę na czas określony', 'umowy o pracę na czas określony do dnia {{do_dnia}}'], ['nieokreslony', 'umowa o pracę na czas nieokreślony', 'umowy o pracę na czas nieokreślony'], ['zlecenie', 'umowa zlecenia', 'umowy zlecenia zawartej na okres do dnia {{do_dnia}}']]),
      pole('od_dnia', 'data', 'Zatrudniony(-a) od dnia', { rejestr: 'u_od' }),
      pole('do_dnia', 'data', 'Umowa do dnia', { wymagane: false, rejestr: 'u_do', wymagane_gdy: { pole: 'podstawa_zatr', w: ['probny', 'okreslony', 'zlecenie'] } }),
      pole('wymiar', 'tekst', 'Wymiar czasu pracy / liczba godzin', { rejestr: 'u_wymiar', wymagane: false, gdy_puste: '—' }),
      pole('okres_sredniej', 'liczba', 'Średnia z ostatnich miesięcy (liczba)', { domyslnie: '3' }),
      pole('brutto', 'kwota', 'Średnie miesięczne wynagrodzenie brutto (zł)'),
      pole('netto', 'kwota', 'Średnie miesięczne wynagrodzenie netto (zł)'),
      wybor('wypowiedzenie', 'Okres wypowiedzenia', [['nie', 'nie jest w okresie wypowiedzenia', 'nie znajduje się w okresie wypowiedzenia umowy'], ['tak', 'jest w okresie wypowiedzenia', 'znajduje się w okresie wypowiedzenia umowy']]),
      wybor('zajecia', 'Zajęcia wynagrodzenia', [['nie', 'brak zajęć', 'nie jest obciążone z tytułu wyroków sądowych lub innych tytułów'], ['tak', 'są zajęcia', 'jest obciążone z tytułu wyroków sądowych lub innych tytułów kwotą {{zajecia_kwota}} zł miesięcznie']]),
      pole('zajecia_kwota', 'kwota', 'Kwota obciążeń miesięcznie (zł)', { wymagane: false, wymagane_gdy: { pole: 'zajecia', rowne: 'tak' } }),
      pole('cel', 'tekst', 'Cel / komu ma być przedłożone', { podpowiedz: 'np. w banku; w urzędzie wojewódzkim' })]),
    tresc: [
      nagl(['{{z_nazwa}}', '{{z_siedziba}}', 'NIP: {{z_nip}}, REGON: {{z_regon}}']),
      tyt('ZAŚWIADCZENIE O ZATRUDNIENIU I WYNAGRODZENIU'),
      p('Zaświadcza się, że Pan/Pani {{p_imie_nazwisko}}, PESEL: {{p_pesel}}, jest zatrudniony(-a) u pracodawcy: {{z_nazwa}}, od dnia {{od_dnia}} na podstawie {{podstawa_zatr}}, na stanowisku: {{p_stanowisko}}, w wymiarze: {{wymiar}}.'),
      p('Średnie miesięczne wynagrodzenie z ostatnich {{okres_sredniej}} miesięcy wynosi: {{brutto}} zł brutto, tj. {{netto}} zł netto.'),
      p('Wymieniona osoba {{wypowiedzenie}}. Wynagrodzenie {{zajecia}}.'),
      p('Zaświadczenie wydaje się na wniosek osoby zainteresowanej w celu przedłożenia: {{cel}}.'),
      sig(null, '{{z_reprezentant}} — podpis osoby upoważnionej i pieczęć pracodawcy'),
    ],
    uwagi: ['Wystawiać WYŁĄCZNIE na wniosek osoby, której dotyczy, i jej wydawać — nie wysyłać bezpośrednio do banku ani innego podmiotu bez podstawy prawnej.',
      'Jeżeli bank lub urząd wymaga własnego druku — wypełnić ich druk, nie ten wzór.',
      'Kwoty muszą wynikać z list płac; biuro nie potwierdza danych, których nie ma w dokumentacji klienta.',
      'Treść nie wynika z przepisu — wzór do zatwierdzenia przez kadrową (pola „okres wypowiedzenia” i „zajęcia” są zwyczajowo wymagane przez banki; można je usunąć).'],
    dwujezyczny: DJ.nie('Dokument przedkładany polskim instytucjom — po polsku.'),
  });

  dodaj({
    id: 'polecenie-wyjazdu-sluzbowego', nazwa: 'Polecenie wyjazdu służbowego (delegacja)', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Zadanie służbowe wykonywane na polecenie pracodawcy poza miejscowością siedziby pracodawcy lub poza stałym miejscem pracy (art. 77⁵ § 1 KP); termin i miejsce podróży określa pracodawca (§ 2 rozporządzenia w sprawie należności z tytułu podróży służbowej — tekst jednolity Dz. U. z 2023 r. poz. 2190).' },
    podstawa: [art('art. 77⁵, art. 178', 'KP'), art('§ 2', 'R_PODR')],
    forma: forma('dokumentowa', 'pracodawca', 'Przepisy nie określają formy polecenia; dokument jest podstawą rozliczenia należności.', { rodzaj_podpisy: 'inny' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('p_stanowisko'),
      pole('numer', 'tekst', 'Numer polecenia', { wymagane: false, gdy_puste: '—' }),
      pole('cel_miejsce', 'tekst', 'Miejscowość docelowa (kraj, jeśli zagranica)'),
      pole('od_dnia', 'data', 'Od dnia'), pole('do_dnia', 'data', 'Do dnia'),
      pole('cel', 'dlugi', 'Cel podróży (zadanie służbowe)'),
      pole('transport', 'tekst', 'Środek transportu', { podpowiedz: 'np. samochód służbowy; pociąg 2 klasy' }),
      pole('zaliczka', 'kwota', 'Zaliczka (zł)', { wymagane: false, gdy_puste: '0,00' })]),
    tresc: [
      NAGL_PRACODAWCA(),
      tyt('POLECENIE WYJAZDU SŁUŻBOWEGO'), pod('nr {{numer}}'),
      p('Polecam Panu/Pani {{p_imie_nazwisko}}, zatrudnionemu(-ej) na stanowisku {{p_stanowisko}}, odbycie podróży służbowej:'),
      kv([['do', '{{cel_miejsce}}'], ['w terminie', 'od {{od_dnia}} do {{do_dnia}}'], ['w celu', '{{cel}}'], ['środek transportu', '{{transport}}'], ['zaliczka', '{{zaliczka}} zł']]),
      sig(POD_ODBIOR, POD_PRAC_IMIE),
    ],
    uwagi: ['Należności (diety, przejazdy, noclegi) — według regulaminu wynagradzania lub umowy o pracę, a gdy ich nie ma — według rozporządzenia dla sfery budżetowej; dieta nie może być niższa niż dieta krajowa z tego rozporządzenia (art. 77⁵ § 3–5). Rozliczenie kosztów — w module płacowym, nie w tym dokumencie.',
      'Bez zgody nie wolno delegować poza stałe miejsce pracy pracownicy w ciąży ani pracownika wychowującego dziecko do 8 lat (art. 178).',
      'CUDZOZIEMIEC: wyjazd za granicę wymaga sprawdzenia dokumentu pobytowego i prawa do pracy w państwie docelowym; praca w innym miejscu w Polsce niż wskazane w zezwoleniu może wymagać jego zmiany — sprawdzić przed wystawieniem.',
      'Zleceniobiorca nie odbywa podróży służbowej w rozumieniu art. 77⁵ KP — zwrot kosztów wynika z umowy.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'zgoda-na-potracenie', nazwa: 'Zgoda pracownika na potrącenie z wynagrodzenia', grupa: 'Wynagrodzenia i podatki', dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Zgoda pracownika wyrażona na piśmie na potrącanie należności innych niż wymienione w art. 87 § 1 i 7 KP (art. 91 § 1 KP); kwota wolna od potrąceń (art. 91 § 2 KP).' },
    podstawa: [art('art. 84, art. 87 § 1, art. 87¹, art. 91', 'KP'), art('art. 59 ust. 1–4', 'CUDZ')],
    forma: forma('pisemna', 'pracownik', 'Zgoda musi być wyrażona na piśmie (art. 91 § 1 KP).', { rodzaj_podpisy: 'inny', akta: 'B' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('p_imie_nazwisko'), W('p_stanowisko'),
      pole('tytul', 'dlugi', 'Tytuł należności (konkretnie)', { podpowiedz: 'np. opłata za zakwaterowanie w lokalu przy ul. Przykładowej 1 za październik 2026 r.' }),
      pole('kwota', 'kwota', 'Kwota (zł)'),
      wybor('tryb', 'Sposób potrącenia', [['jednorazowo', 'jednorazowo', 'jednorazowo, z wynagrodzenia za {{okres}}'], ['miesiecznie', 'co miesiąc', 'co miesiąc, z wynagrodzenia za okres: {{okres}}']]),
      pole('okres', 'tekst', 'Miesiąc / okres, którego dotyczy potrącenie', { podpowiedz: 'np. październik 2026 r. albo od października do grudnia 2026 r.' })]),
    tresc: [
      NAGL_PRACOWNIK(), ADR_PRACODAWCA(),
      tyt('ZGODA NA POTRĄCENIE Z WYNAGRODZENIA'),
      p('Na podstawie art. 91 § 1 Kodeksu pracy wyrażam zgodę na potrącenie z mojego wynagrodzenia za pracę należności z tytułu: {{tytul}}, w kwocie {{kwota}} zł — {{tryb}}.'),
      p('Przyjmuję do wiadomości, że potrącenie następuje z zachowaniem kwoty wolnej od potrąceń określonej w art. 91 § 2 Kodeksu pracy oraz że zgodę mogę cofnąć w odniesieniu do potrąceń jeszcze niedokonanych.'),
      sig(null, POD_PRACOWNIKA),
    ],
    uwagi: ['Zgoda musi dotyczyć KONKRETNEJ, istniejącej należności i kwoty — zgoda blankietowa „na wszelkie przyszłe należności” jest nieskuteczna (ugruntowane orzecznictwo; kadrowa potwierdza praktykę biura).',
      'Kwota wolna: przy należnościach na rzecz pracodawcy — minimalne wynagrodzenie po odliczeniu składek, zaliczki na podatek i wpłat do PPK (art. 87¹ § 1 pkt 1 KP), proporcjonalnie przy niepełnym etacie; przy innych należnościach — 80% tej kwoty (art. 91 § 2). Moduł płacowy musi to policzyć.',
      'ZAKAZ — ZAKWATEROWANIE PRZY PRACY SEZONOWEJ: jeżeli cudzoziemiec wjechał na podstawie wizy do pracy sezonowej (albo w ruchu bezwizowym w związku z wnioskiem o zezwolenie na pracę sezonową), czynsz najmu kwatery NIE MOŻE być potrącany z wynagrodzenia, a postanowienia o automatycznym potrącaniu są nieważne (art. 59 ust. 2 ustawy o powierzaniu pracy cudzoziemcom). W takim przypadku tego wzoru nie wolno użyć do czynszu.',
      'Zdanie o cofnięciu zgody jest propozycją redakcyjną — do decyzji kadrowej.',
      'Nie dotyczy zleceniobiorców (potrącenia z wynagrodzenia zleceniobiorcy podlegają Kodeksowi cywilnemu).'],
    dwujezyczny: DJ.zalecany('Zgoda zmniejsza wypłatę — cudzoziemcowi nieznającemu polskiego należy ją przetłumaczyć, inaczej łatwo podważyć jej świadome wyrażenie.'),
  });

  dodaj({
    id: 'ewidencja-czasu-pracy', nazwa: 'Ewidencja czasu pracy — karta miesięczna', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Informacje wymagane w ewidencji czasu pracy: liczba przepracowanych godzin oraz godzina rozpoczęcia i zakończenia pracy; godziny w porze nocnej; godziny nadliczbowe; dni wolne z oznaczeniem tytułu; dyżury (godziny, miejsce); zwolnienia od pracy (rodzaj, wymiar); inne usprawiedliwione nieobecności (rodzaj, wymiar); nieobecności nieusprawiedliwione (§ 6 pkt 1 lit. a rozporządzenia).' },
    podstawa: [art('art. 149', 'KP'), art('§ 6 pkt 1 lit. a', 'R_DOK')],
    forma: forma('bez_podpisu', 'pracodawca', 'Ewidencję prowadzi pracodawca w postaci papierowej lub elektronicznej; podpis pracownika nie jest wymagany.', { rodzaj_podpisy: 'inny', akta: 'dokumentacja czasu pracy' }),
    pola: [W('z_nazwa'), W('p_imie_nazwisko'), W('p_stanowisko'),
      pole('miesiac', 'tekst', 'Miesiąc i rok', { podpowiedz: 'np. październik 2026' }),
      pole('wymiar', 'tekst', 'Wymiar czasu pracy', { rejestr: 'u_wymiar', wymagane: false, gdy_puste: '—' }),
      pole('system', 'tekst', 'System i okres rozliczeniowy', { wymagane: false, gdy_puste: '—' })],
    tresc: [
      nagl(['{{z_nazwa}}'], ''),
      tyt('EWIDENCJA CZASU PRACY'), pod('{{miesiac}}'),
      kv([['Pracownik', '{{p_imie_nazwisko}}'], ['Stanowisko', '{{p_stanowisko}}'], ['Wymiar czasu pracy', '{{wymiar}}'], ['System czasu pracy / okres rozliczeniowy', '{{system}}']]),
      tab(['Dzień', 'Godz. rozpoczęcia', 'Godz. zakończenia', 'Liczba godzin przepracowanych', 'W porze nocnej', 'Nadliczbowe', 'Dyżur (od–do, miejsce)', 'Dzień wolny — tytuł', 'Zwolnienie od pracy — rodzaj i wymiar', 'Inna usprawiedliwiona nieobecność — rodzaj i wymiar', 'Nieobecność nieusprawiedliwiona — wymiar'], null, 31),
      prz('Dni wolne oznacza się tytułem ich udzielenia, np.: W5 — dzień wolny z tytułu przeciętnie pięciodniowego tygodnia pracy, WN — niedziela, WŚ — święto, WNN — dzień wolny za pracę w niedzielę lub święto. Oznaczenia ustala pracodawca.'),
    ],
    uwagi: ['Ewidencję prowadzi się oddzielnie dla każdego pracownika i udostępnia mu na żądanie (art. 149 § 1). Przechowuje się ją jak dokumentację pracowniczą.',
      'Godzin pracy nie ewidencjonuje się u pracowników w zadaniowym czasie pracy, zarządzających zakładem oraz otrzymujących ryczałt za nadgodziny lub pracę nocną (art. 149 § 2) — pozostałe rubryki nadal obowiązują.',
      'Dla młodocianych dochodzi rubryka czasu pracy przy pracach wzbronionych dozwolonych w celu przygotowania zawodowego — wzór jej nie zawiera.',
      'Dla zleceniobiorców nie prowadzi się ewidencji czasu pracy, tylko potwierdzenie liczby godzin (dokument „Zlecenie — informacja o liczbie godzin”).'],
    dwujezyczny: DJ.nie('Dokument pracodawcy.'),
  });

  dodaj({
    id: 'lista-obecnosci', nazwa: 'Lista obecności — karta indywidualna', grupa: G2, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Przyjęty u pracodawcy sposób potwierdzania przez pracowników przybycia i obecności w pracy (art. 104¹ § 1 pkt 9 KP; przy braku regulaminu — informacja z art. 29 § 3 pkt 1 lit. m KP). Przepisy nie określają wzoru.' },
    podstawa: [art('art. 104¹ § 1 pkt 9, art. 29 § 3 pkt 1 lit. m', 'KP')],
    forma: forma('dokumentowa', 'pracownik', 'Sposób potwierdzania obecności ustala pracodawca; podpis na liście jest jednym z dopuszczalnych sposobów.', { rodzaj_podpisy: 'inny', akta: 'dokumentacja czasu pracy' }),
    pola: [W('z_nazwa'), W('p_imie_nazwisko'), W('p_stanowisko'), pole('miesiac', 'tekst', 'Miesiąc i rok', { podpowiedz: 'np. październik 2026' })],
    tresc: [
      nagl(['{{z_nazwa}}'], ''),
      tyt('LISTA OBECNOŚCI'), pod('{{miesiac}}'),
      kv([['Pracownik', '{{p_imie_nazwisko}}'], ['Stanowisko', '{{p_stanowisko}}']]),
      tab(['Dzień', 'Godzina przybycia', 'Podpis pracownika', 'Godzina wyjścia', 'Podpis pracownika'], null, 31),
    ],
    uwagi: ['Karta INDYWIDUALNA — na liście zbiorczej nie wolno wpisywać przyczyn nieobecności (choroba, urlop opiekuńczy itd.) widocznych dla innych pracowników (RODO — zasada minimalizacji i poufności).',
      'Lista obecności nie zastępuje ewidencji czasu pracy.'],
    dwujezyczny: DJ.nie('Dokument organizacyjny.'),
  });

  // =====================================================================================
  //  3. URLOPY I ZWOLNIENIA OD PRACY
  // =====================================================================================
  var G3 = 'Urlopy i zwolnienia od pracy';
  var DECYZJA = [p('Decyzja pracodawcy: wyrażam zgodę / nie wyrażam zgody*', null, 'bold'), sig(null, 'data i podpis pracodawcy'), prz('* niepotrzebne skreślić')];
  var POLA_WNIOSEK = function () { return MD().concat([W('z_nazwa'), W('z_siedziba'), W('p_imie_nazwisko'), W('p_stanowisko')]); };
  var POLA_OKRES = function () { return [pole('od_dnia', 'data', 'Od dnia'), pole('do_dnia', 'data', 'Do dnia')]; };
  var WYMIAR_ROCZNY = function (dni, godz) {
    return [wybor('pierwszy', 'Czy to pierwszy wniosek w tym roku kalendarzowym', [['tak', 'tak — wybieram sposób wykorzystania'], ['nie', 'nie']]),
      wybor('sposob', 'Sposób wykorzystania w tym roku', [['dni', dni + ' dni', 'w wymiarze dni (' + dni + ' dni)'], ['godziny', godz + ' godzin', 'w wymiarze godzinowym (' + godz + ' godzin)']]),
      pole('rok', 'tekst', 'Rok kalendarzowy', { podpowiedz: 'np. 2026' })];
  };

  dodaj({
    id: 'wniosek-urlop-wypoczynkowy', nazwa: 'Wniosek o urlop wypoczynkowy', grupa: G3, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Urlopy udziela się zgodnie z planem urlopów albo po porozumieniu z pracownikiem (art. 163 § 1–1¹ KP). Przepisy nie określają treści wniosku.' },
    podstawa: [art('art. 163, art. 168', 'KP'), art('§ 6 pkt 2', 'R_DOK')],
    forma: forma('dokumentowa', 'pracownik', 'Przepisy nie określają formy wniosku; dokumenty związane z ubieganiem się o urlop wypoczynkowy przechowuje się w dokumentacji pracowniczej (§ 6 pkt 2 rozporządzenia).', { akta: 'dokumentacja urlopowa' }),
    pola: POLA_WNIOSEK().concat(POLA_OKRES()).concat([pole('liczba_dni', 'liczba', 'Liczba dni roboczych urlopu', { walidacja: 'liczba>=1' }),
      wybor('rok_urlopu', 'Urlop', [['biezacy', 'bieżący', 'bieżącego'], ['zalegly', 'zaległy', 'zaległego']])]),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('WNIOSEK O URLOP WYPOCZYNKOWY'),
      p('Proszę o udzielenie mi urlopu wypoczynkowego {{rok_urlopu}} w okresie od {{od_dnia}} do {{do_dnia}}, tj. {{liczba_dni}} dni roboczych.'),
      sig(null, POD_PRACOWNIKA)].concat(DECYZJA),
    uwagi: ['Urlop niewykorzystany w terminie trzeba udzielić najpóźniej do 30 września następnego roku (art. 168).',
      'Wymiar urlopu rozlicza się w godzinach — moduł powinien przeliczać dni na godziny według dobowej normy pracownika.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wniosek-urlop-na-zadanie', nazwa: 'Żądanie udzielenia urlopu (urlop na żądanie)', grupa: G3, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Żądanie udzielenia nie więcej niż 4 dni urlopu w roku kalendarzowym w terminie wskazanym przez pracownika, zgłoszone najpóźniej w dniu rozpoczęcia urlopu (art. 167² KP).' },
    podstawa: [art('art. 167², art. 167³', 'KP')],
    forma: forma('dokumentowa', 'pracownik', 'Przepis nie określa formy żądania (może być zgłoszone także ustnie lub telefonicznie, w sposób przyjęty u pracodawcy); dokument jest potwierdzeniem.', { akta: 'dokumentacja urlopowa' }),
    pola: POLA_WNIOSEK().concat([pole('termin', 'tekst', 'Dzień / dni urlopu', { podpowiedz: 'np. 12 października 2026 r.' }), pole('liczba_dni', 'liczba', 'Liczba dni', { walidacja: 'liczba>=1' })]),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('ŻĄDANIE UDZIELENIA URLOPU'),
      p('Na podstawie art. 167² Kodeksu pracy zgłaszam żądanie udzielenia mi urlopu wypoczynkowego w terminie: {{termin}} (liczba dni: {{liczba_dni}}).'),
      sig(null, POD_PRACOWNIKA)],
    uwagi: ['Żądanie zgłasza się najpóźniej w dniu rozpoczęcia urlopu. Limit 4 dni w roku kalendarzowym łącznie u wszystkich pracodawców (art. 167³) — poprzedni pracodawca wykazuje wykorzystane dni w świadectwie pracy.',
      'To część urlopu wypoczynkowego, a nie dodatkowy urlop.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wniosek-urlop-bezplatny', nazwa: 'Wniosek o urlop bezpłatny', grupa: G3, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Wniosek pracownika złożony w postaci papierowej lub elektronicznej (art. 174 § 1 KP).' },
    podstawa: [art('art. 174', 'KP')],
    forma: forma('dokumentowa', 'pracownik', 'Wniosek w postaci papierowej lub elektronicznej (art. 174 § 1 KP w brzmieniu od 27.01.2026 r.).', { akta: 'B' }),
    pola: POLA_WNIOSEK().concat(POLA_OKRES()).concat([pole('uzasadnienie', 'dlugi', 'Uzasadnienie (nieobowiązkowe)', { wymagane: false, gdy_puste: '—' })]),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('WNIOSEK O URLOP BEZPŁATNY'),
      p('Na podstawie art. 174 § 1 Kodeksu pracy wnoszę o udzielenie mi urlopu bezpłatnego w okresie od {{od_dnia}} do {{do_dnia}}.'),
      p('Uzasadnienie: {{uzasadnienie}}'),
      p('Przyjmuję do wiadomości, że okresu urlopu bezpłatnego nie wlicza się do okresu pracy, od którego zależą uprawnienia pracownicze.'),
      sig(null, POD_PRACOWNIKA)].concat(DECYZJA),
    uwagi: ['Urlopu bezpłatnego nie wolno udzielić bez wniosku pracownika. Przy urlopie dłuższym niż 3 miesiące strony mogą przewidzieć odwołanie z ważnych przyczyn (art. 174 § 3).',
      'Okres i podstawę prawną urlopu bezpłatnego wykazuje się w świadectwie pracy (ust. 6 pkt 4 wzoru).',
      'CUDZOZIEMIEC: długi urlop bezpłatny to przerwa w pracy — przy zezwoleniu na pracę przerwa ponad 2 miesiące wymaga powiadomienia organu w 7 dni (art. 19 pkt 2 i art. 20 ustawy o powierzaniu pracy cudzoziemcom).',
      'ZMIANA 2026: od 27.01.2026 r. wniosek można złożyć elektronicznie.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wniosek-zwolnienie-opieka-nad-dzieckiem', nazwa: 'Wniosek o zwolnienie od pracy na opiekę nad dzieckiem do 14 lat (art. 188 KP)', grupa: G3, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Zwolnienie 16 godzin albo 2 dni w roku kalendarzowym dla pracownika wychowującego dziecko do 14 lat; sposób wykorzystania wybiera pracownik w pierwszym wniosku w danym roku (art. 188 § 1–2 KP); korzysta jedno z rodziców (art. 189¹ KP).' },
    podstawa: [art('art. 188, art. 189¹', 'KP'), art('§ 6 pkt 1 lit. b', 'R_DOK')],
    forma: forma('dokumentowa', 'pracownik', 'Wniosek w postaci papierowej lub elektronicznej (art. 188 § 2 KP).', { akta: 'dokumentacja czasu pracy' }),
    pola: POLA_WNIOSEK().concat([pole('termin', 'tekst', 'Dzień / godziny zwolnienia', { podpowiedz: 'np. 12 października 2026 r. albo 12 października 2026 r. w godz. 8:00–12:00' }),
      pole('dziecko', 'tekst', 'Imię i nazwisko dziecka'), pole('dziecko_ur', 'data', 'Data urodzenia dziecka')]).concat(WYMIAR_ROCZNY(2, 16)),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('WNIOSEK O ZWOLNIENIE OD PRACY'), pod('z tytułu wychowywania dziecka w wieku do 14 lat'),
      p('Na podstawie art. 188 § 1 Kodeksu pracy wnoszę o udzielenie mi zwolnienia od pracy z zachowaniem prawa do wynagrodzenia w terminie: {{termin}}, w związku z wychowywaniem dziecka: {{dziecko}}, ur. {{dziecko_ur}}.'),
      p('Oświadczam, że w roku kalendarzowym {{rok}} będę korzystać ze zwolnienia {{sposob}} (art. 188 § 2 Kodeksu pracy).', { pole: 'pierwszy', rowne: 'tak' }),
      p('Oświadczam, że drugi rodzic / opiekun dziecka nie korzysta w roku {{rok}} ze zwolnienia od pracy przewidzianego w art. 188 Kodeksu pracy (art. 189¹ Kodeksu pracy).'),
      sig(null, POD_PRACOWNIKA)],
    uwagi: ['Wymiar jest wspólny na wszystkie dzieci i na rok; przy niepełnym etacie wymiar godzinowy ustala się proporcjonalnie, z zaokrągleniem w górę do pełnej godziny (art. 188 § 3).',
      'Wykorzystane zwolnienie wykazuje się w świadectwie pracy (ust. 6 pkt 9 wzoru). Wniosek — do dokumentacji czasu pracy.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wniosek-urlop-opiekunczy', nazwa: 'Wniosek o urlop opiekuńczy (art. 173¹ KP)', grupa: G3, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Treść wniosku określona w art. 173¹ § 5 KP: imię i nazwisko osoby wymagającej opieki lub wsparcia, przyczyna konieczności zapewnienia osobistej opieki lub wsparcia, a ponadto stopień pokrewieństwa (członek rodziny) albo adres zamieszkania tej osoby (osoba niebędąca członkiem rodziny).' },
    podstawa: [art('art. 173¹–173³', 'KP'), art('§ 6 pkt 1 lit. b', 'R_DOK')],
    forma: forma('dokumentowa', 'pracownik', 'Wniosek w postaci papierowej lub elektronicznej (art. 173¹ § 4 KP).', { akta: 'dokumentacja czasu pracy' }),
    pola: POLA_WNIOSEK().concat([pole('termin', 'tekst', 'Dzień / dni urlopu', { podpowiedz: 'np. 12–13 października 2026 r.' }), pole('liczba_dni', 'liczba', 'Liczba dni', { walidacja: 'liczba>=1' }),
      pole('osoba', 'tekst', 'Imię i nazwisko osoby wymagającej opieki lub wsparcia'),
      wybor('relacja', 'Kim jest ta osoba', [['syn', 'syn', 'członkiem mojej rodziny — stopień pokrewieństwa: syn'], ['corka', 'córka', 'członkiem mojej rodziny — stopień pokrewieństwa: córka'], ['matka', 'matka', 'członkiem mojej rodziny — stopień pokrewieństwa: matka'], ['ojciec', 'ojciec', 'członkiem mojej rodziny — stopień pokrewieństwa: ojciec'], ['malzonek', 'małżonek', 'członkiem mojej rodziny — małżonkiem'], ['domownik', 'osoba zamieszkująca w tym samym gospodarstwie domowym', 'osobą zamieszkującą ze mną w tym samym gospodarstwie domowym, adres zamieszkania: {{osoba_adres}}']]),
      pole('osoba_adres', 'tekst', 'Adres zamieszkania osoby (gdy nie jest członkiem rodziny)', { wymagane: false, wymagane_gdy: { pole: 'relacja', rowne: 'domownik' } }),
      pole('przyczyna', 'dlugi', 'Przyczyna konieczności zapewnienia osobistej opieki lub wsparcia', { podpowiedz: 'ogólnie, bez dokumentacji medycznej — np. konieczność opieki po zabiegu operacyjnym' })]),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('WNIOSEK O URLOP OPIEKUŃCZY'),
      p('Na podstawie art. 173¹ Kodeksu pracy wnoszę o udzielenie mi urlopu opiekuńczego w terminie: {{termin}} (liczba dni: {{liczba_dni}}).'),
      kv([['Osoba wymagająca opieki lub wsparcia', '{{osoba}}'], ['Osoba ta jest', '{{relacja}}'], ['Przyczyna konieczności zapewnienia osobistej opieki lub wsparcia z poważnych względów medycznych', '{{przyczyna}}']]),
      sig(null, POD_PRACOWNIKA)],
    uwagi: ['Wymiar: 5 dni w roku kalendarzowym, w dni będące dla pracownika dniami pracy. Wniosek — nie później niż 1 dzień przed rozpoczęciem urlopu (art. 173¹ § 4).',
      'Członek rodziny to wyłącznie: syn, córka, matka, ojciec, małżonek (art. 173¹ § 2). Inne osoby — tylko gdy mieszkają w tym samym gospodarstwie domowym.',
      'Pracodawca nie może żądać zaświadczeń lekarskich — przepis wymaga jedynie wskazania przyczyny. Wniosek zawiera dane o zdrowiu osoby trzeciej: dostęp tylko dla osób upoważnionych.',
      'Urlop wykazuje się w świadectwie pracy (ust. 6 pkt 3 wzoru). Naruszenie przepisów o urlopie opiekuńczym jest wykroczeniem (art. 281 § 1 pkt 5b KP).'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wniosek-zwolnienie-sila-wyzsza', nazwa: 'Wniosek o zwolnienie od pracy z powodu działania siły wyższej (art. 148¹ KP)', grupa: G3, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Zwolnienie 2 dni albo 16 godzin w roku kalendarzowym z powodu działania siły wyższej w pilnych sprawach rodzinnych spowodowanych chorobą lub wypadkiem, jeżeli jest niezbędna natychmiastowa obecność pracownika; sposób wykorzystania wybiera pracownik w pierwszym wniosku w roku (art. 148¹ § 1–3 KP).' },
    podstawa: [art('art. 148¹', 'KP'), art('§ 6 pkt 1 lit. b', 'R_DOK')],
    forma: forma('dokumentowa', 'pracownik', 'Przepis nie określa formy wniosku — może być zgłoszony w każdy sposób, najpóźniej w dniu korzystania ze zwolnienia (art. 148¹ § 3 KP); dokument jest potwierdzeniem do dokumentacji czasu pracy.', { akta: 'dokumentacja czasu pracy' }),
    pola: POLA_WNIOSEK().concat([pole('termin', 'tekst', 'Dzień / godziny zwolnienia', { podpowiedz: 'np. 12 października 2026 r. albo 12 października 2026 r. w godz. 10:00–14:00' })]).concat(WYMIAR_ROCZNY(2, 16)),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('WNIOSEK O ZWOLNIENIE OD PRACY'), pod('z powodu działania siły wyższej'),
      p('Na podstawie art. 148¹ § 1 Kodeksu pracy wnoszę o udzielenie mi zwolnienia od pracy w terminie: {{termin}}, z powodu działania siły wyższej w pilnej sprawie rodzinnej spowodowanej chorobą lub wypadkiem, wymagającej mojej natychmiastowej obecności.'),
      p('Oświadczam, że w roku kalendarzowym {{rok}} będę korzystać ze zwolnienia {{sposob}} (art. 148¹ § 2 Kodeksu pracy).', { pole: 'pierwszy', rowne: 'tak' }),
      sig(null, POD_PRACOWNIKA)],
    uwagi: ['Pracodawca MA OBOWIĄZEK udzielić zwolnienia na wniosek zgłoszony najpóźniej w dniu korzystania z niego. Za czas zwolnienia przysługuje połowa wynagrodzenia (art. 148¹ § 1).',
      'Nie wolno żądać opisu choroby ani dokumentów — wniosek celowo nie zawiera szczegółów zdarzenia.',
      'Wykorzystane zwolnienie wykazuje się w świadectwie pracy (ust. 6 pkt 1 wzoru).'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wniosek-urlop-rodzicielski', nazwa: 'Wniosek o urlop rodzicielski lub jego część', grupa: G3, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Treść wniosku z § 15 ust. 1 rozporządzenia: imię i nazwisko pracownika; okres dotychczas wykorzystanego urlopu rodzicielskiego lub zasiłku macierzyńskiego za okres odpowiadający temu urlopowi oraz liczba wykorzystanych części urlopu lub liczba wniosków o zasiłek; okres, na który ma być udzielony urlop. Załączniki z § 15 ust. 2.' },
    podstawa: [art('art. 182¹d', 'KP'), art('§ 15, § 21–23', 'R_RODZ')],
    forma: forma('dokumentowa', 'pracownik', 'Wniosek w postaci papierowej lub elektronicznej (art. 182¹d § 1 KP).', { akta: 'B' }),
    pola: POLA_WNIOSEK().concat(POLA_OKRES()).concat([pole('dziecko', 'tekst', 'Imię i nazwisko dziecka (dzieci)'), pole('dziecko_ur', 'tekst', 'Data urodzenia dziecka (dzieci)'),
      pole('wykorzystany', 'tekst', 'Okres dotychczas wykorzystanego urlopu rodzicielskiego / zasiłku macierzyńskiego za taki okres', { wymagane: false, gdy_puste: 'nie korzystałem(-am)' }),
      pole('liczba_czesci', 'tekst', 'Liczba wykorzystanych części urlopu / wniosków o zasiłek', { wymagane: false, gdy_puste: '0' }),
      wybor('drugi_rodzic', 'Drugi rodzic w okresie objętym wnioskiem', [['nie', 'nie zamierza korzystać', 'drugi z rodziców dziecka nie zamierza korzystać z urlopu rodzicielskiego ani z zasiłku macierzyńskiego za okres odpowiadający okresowi urlopu rodzicielskiego przez okres wskazany we wniosku'], ['tak', 'zamierza korzystać', 'drugi z rodziców dziecka zamierza korzystać z urlopu rodzicielskiego albo z zasiłku macierzyńskiego za okres odpowiadający okresowi urlopu rodzicielskiego w okresie: {{drugi_okres}}']]),
      pole('drugi_okres', 'tekst', 'Okres korzystania przez drugiego rodzica', { wymagane: false, wymagane_gdy: { pole: 'drugi_rodzic', rowne: 'tak' } })]),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('WNIOSEK O UDZIELENIE URLOPU RODZICIELSKIEGO'),
      p('Na podstawie art. 182¹d § 1 Kodeksu pracy wnoszę o udzielenie mi urlopu rodzicielskiego (jego części) w okresie od {{od_dnia}} do {{do_dnia}}, na dziecko: {{dziecko}}, ur. {{dziecko_ur}}.'),
      kv([['Okres dotychczas wykorzystanego urlopu rodzicielskiego lub zasiłku macierzyńskiego za okres odpowiadający okresowi urlopu rodzicielskiego', '{{wykorzystany}}'], ['Liczba wykorzystanych części urlopu rodzicielskiego lub liczba wniosków o zasiłek macierzyński za okres odpowiadający części urlopu', '{{liczba_czesci}}']]),
      p('Oświadczam, że {{drugi_rodzic}}.'),
      p('Załączniki:', null, 'bold'),
      li(['odpis skrócony aktu urodzenia dziecka (dzieci) lub zagraniczny dokument potwierdzający urodzenie dziecka wydany przez uprawniony organ dokonujący rejestracji urodzenia w danym kraju, albo kopie tych dokumentów — chyba że dokument jest już w aktach osobowych;',
        'kopia zaświadczenia, o którym mowa w art. 4 ust. 3 ustawy o wsparciu kobiet w ciąży i rodzin „Za życiem” — tylko gdy wniosek dotyczy urlopu w wymiarze z art. 182¹a § 2 Kodeksu pracy.']),
      sig(null, POD_PRACOWNIKA)],
    uwagi: ['Termin: nie krócej niż 21 dni przed rozpoczęciem urlopu; pracodawca jest obowiązany uwzględnić wniosek (art. 182¹d § 1).',
      'ZAGRANICZNY AKT URODZENIA dołącza się z tłumaczeniem na język polski, chyba że został wydany w UE, EFTA/EOG, Szwajcarii albo w państwie–stronie umowy o zabezpieczeniu społecznym z Polską w języku urzędowym tego państwa (§ 21 rozporządzenia). Dla Ukrainy i Białorusi trzeba sprawdzić, czy obowiązuje taka umowa — rozporządzenie nie wymaga tłumaczenia przysięgłego wprost.',
      'Dokumentów już znajdujących się w aktach osobowych nie dołącza się (§ 22). Pracodawca może żądać okazania oryginału dla potwierdzenia kopii (§ 23).',
      'ZMIANA 2025: obowiązuje nowe rozporządzenie z 11.03.2025 r. (Dz. U. poz. 322, od 19.03.2025 r.); rozporządzenie z 8.05.2023 r. (poz. 937) jest uchylone. Wnioski w sytuacjach szczególnych (§ 2–14, 16, 18, 20) nie są objęte katalogiem.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wniosek-urlop-ojcowski', nazwa: 'Wniosek o urlop ojcowski lub jego część', grupa: G3, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Treść wniosku z § 17 ust. 1 rozporządzenia: imię i nazwisko pracownika; okres, na który ma być udzielony urlop albo jego część. Załączniki z § 17 ust. 2, w tym oświadczenie, czy pracownik korzystał z urlopu ojcowskiego albo jego części.' },
    podstawa: [art('art. 182³', 'KP'), art('§ 17, § 21–23', 'R_RODZ')],
    forma: forma('dokumentowa', 'pracownik', 'Wniosek w postaci papierowej lub elektronicznej (art. 182³ § 2 KP).', { akta: 'B' }),
    pola: POLA_WNIOSEK().concat(POLA_OKRES()).concat([pole('dziecko', 'tekst', 'Imię i nazwisko dziecka'), pole('dziecko_ur', 'data', 'Data urodzenia dziecka'),
      wybor('korzystal', 'Czy pracownik korzystał już z urlopu ojcowskiego na to dziecko', [['nie', 'nie korzystał', 'nie korzystałem z urlopu ojcowskiego ani z jego części na to dziecko'], ['tak', 'korzystał z części', 'korzystałem z części urlopu ojcowskiego na to dziecko w okresie: {{korzystal_okres}}']]),
      pole('korzystal_okres', 'tekst', 'Okres wykorzystanej części', { wymagane: false, wymagane_gdy: { pole: 'korzystal', rowne: 'tak' } })]),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('WNIOSEK O UDZIELENIE URLOPU OJCOWSKIEGO'),
      p('Na podstawie art. 182³ § 2 Kodeksu pracy wnoszę o udzielenie mi urlopu ojcowskiego (jego części) w okresie od {{od_dnia}} do {{do_dnia}}, w celu sprawowania opieki nad dzieckiem: {{dziecko}}, ur. {{dziecko_ur}}.'),
      p('Oświadczam, że {{korzystal}}.'),
      p('Załączniki:', null, 'bold'),
      li(['odpis skrócony aktu urodzenia dziecka lub zagraniczny dokument potwierdzający urodzenie dziecka wydany przez uprawniony organ dokonujący rejestracji urodzenia w danym kraju, albo kopie tych dokumentów — chyba że dokument jest już w aktach osobowych;',
        'kopia prawomocnego postanowienia sądu o przysposobieniu dziecka — tylko gdy wniosek dotyczy dziecka przysposobionego.']),
      sig(null, POD_PRACOWNIKA)],
    uwagi: ['Wymiar: do 2 tygodni, jednorazowo albo w 2 częściach nie krótszych niż tydzień; do ukończenia przez dziecko 12. miesiąca życia (art. 182³ § 1–1¹). Wniosek — nie krócej niż 7 dni przed urlopem; pracodawca musi go uwzględnić.',
      'Zagraniczny akt urodzenia — zasady tłumaczenia jak przy urlopie rodzicielskim (§ 21 rozporządzenia).',
      'Wykorzystany urlop wykazuje się w świadectwie pracy, jeżeli ze względu na wiek dziecka pracownik mógłby z niego korzystać u kolejnego pracodawcy.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wniosek-urlop-wychowawczy', nazwa: 'Wniosek o urlop wychowawczy lub jego część', grupa: G3, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Treść wniosku z § 19 ust. 1 rozporządzenia: imię i nazwisko pracownika; imię i nazwisko dziecka; okres, na który ma być udzielony urlop; okres urlopu dotychczas wykorzystanego na dane dziecko; liczba części urlopu, z których dotychczas skorzystano. Załączniki z § 19 ust. 2.' },
    podstawa: [art('art. 186 § 1–10', 'KP'), art('§ 19, § 22–23', 'R_RODZ')],
    forma: forma('dokumentowa', 'pracownik', 'Wniosek w postaci papierowej lub elektronicznej (art. 186 § 7 KP).', { akta: 'B' }),
    pola: POLA_WNIOSEK().concat(POLA_OKRES()).concat([pole('dziecko', 'tekst', 'Imię i nazwisko dziecka'),
      pole('wykorzystany', 'tekst', 'Okres urlopu wychowawczego dotychczas wykorzystanego na to dziecko', { wymagane: false, gdy_puste: 'nie korzystałem(-am)' }),
      pole('liczba_czesci', 'tekst', 'Liczba części urlopu, z których dotychczas skorzystano na to dziecko', { wymagane: false, gdy_puste: '0' }),
      wybor('drugi_rodzic', 'Drugi rodzic / opiekun w okresie objętym wnioskiem', [['nie', 'nie zamierza korzystać', 'drugi rodzic / opiekun dziecka nie zamierza korzystać z urlopu wychowawczego przez okres wskazany we wniosku'], ['tak', 'zamierza korzystać', 'drugi rodzic / opiekun dziecka zamierza korzystać z urlopu wychowawczego w okresie: {{drugi_okres}}'], ['brak', 'oświadczenie nie jest wymagane (władza rodzicielska / opieka ograniczona lub odebrana)', 'oświadczenie o zamiarze korzystania z urlopu przez drugiego rodzica / opiekuna nie jest wymagane — załączam kopię prawomocnego orzeczenia sądu']]),
      pole('drugi_okres', 'tekst', 'Okres korzystania przez drugiego rodzica / opiekuna', { wymagane: false, wymagane_gdy: { pole: 'drugi_rodzic', rowne: 'tak' } })]),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('WNIOSEK O UDZIELENIE URLOPU WYCHOWAWCZEGO'),
      p('Na podstawie art. 186 § 7 Kodeksu pracy wnoszę o udzielenie mi urlopu wychowawczego (jego części) w okresie od {{od_dnia}} do {{do_dnia}}, na dziecko: {{dziecko}}.'),
      kv([['Okres urlopu wychowawczego dotychczas wykorzystanego na to dziecko', '{{wykorzystany}}'], ['Liczba części urlopu wychowawczego, z których dotychczas skorzystano na to dziecko', '{{liczba_czesci}}']]),
      p('Oświadczam, że {{drugi_rodzic}}.'),
      sig(null, POD_PRACOWNIKA)],
    uwagi: ['Warunek: co najmniej 6 miesięcy zatrudnienia (wlicza się poprzednie okresy). Wymiar do 36 miesięcy, nie dłużej niż do końca roku, w którym dziecko kończy 6 lat; najwyżej 5 części (art. 186 § 1–2 i 8).',
      'Wniosek — nie krócej niż 21 dni przed urlopem; złożony później: urlop najpóźniej po 21 dniach od złożenia (art. 186 § 7–7¹). Pracownik może wycofać wniosek najpóźniej 7 dni przed urlopem.',
      'Dodatkowe załączniki (orzeczenie o niepełnosprawności dziecka, dokumenty przy urlopie 36 miesięcy dla jednego rodzica) — § 19 ust. 2 pkt 3–4 rozporządzenia; dołączyć ręcznie.',
      'CUDZOZIEMIEC: urlop wychowawczy to długa przerwa w pracy — sprawdzić skutki dla zezwolenia na pracę / pobytu.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  // =====================================================================================
  //  4. ZAKOŃCZENIE ZATRUDNIENIA
  // =====================================================================================
  var G4 = 'Zakończenie zatrudnienia';
  var UW_CUDZ_KONIEC = 'CUDZOZIEMIEC: po zakończeniu pracy sprawdzić powiadomienia przez praca.gov.pl — zezwolenie na pracę: zakończenie wcześniej niż 2 miesiące przed upływem ważności zezwolenia, w ciągu 7 dni (art. 19 pkt 3 i art. 20); oświadczenie: zakończenie pracy przed dniem wskazanym w oświadczeniu (art. 70 ust. 2 ustawy o powierzaniu pracy cudzoziemcom).';
  var UW_ZWIAZEK = 'Związek zawodowy: o zamiarze wypowiedzenia umowy na czas określony lub nieokreślony zawiadamia się (papierowo lub elektronicznie) reprezentującą pracownika zakładową organizację związkową, podając przyczynę; organizacja ma 5 dni na zastrzeżenia (art. 38 KP). Najpierw trzeba zapytać organizację, czy pracownik korzysta z jej obrony — brak odpowiedzi w 5 dni zwalnia z konsultacji (art. 30 ust. 3 ustawy o związkach zawodowych).';

  dodaj({
    id: 'wypowiedzenie-umowy-o-prace-pracodawca', nazwa: 'Rozwiązanie umowy o pracę za wypowiedzeniem — przez pracodawcę', grupa: G4, dla: 'pracownik',
    zrodlo: { typ: 'urzedowy', akt: 'Pomocnicze wzory MRPiPS „Rozwiązanie umowy o pracę za wypowiedzeniem” oraz „Rozwiązanie umowy o pracę z zastosowaniem skróconego okresu wypowiedzenia”', url: URL.MRPIPS_WZORY, eli: AKTY.KP.eli,
      uwaga: 'Układ i sformułowania według pomocniczych wzorów MRPiPS. Wzór ministerstwa (wersja z 2020 r.) opisuje przyczynę jako wymaganą tylko przy umowie na czas nieokreślony — tutaj dostosowano do obecnego art. 30 § 4 KP: przyczynę podaje się także przy umowie na czas określony.' },
    podstawa: [art('art. 30 § 1 pkt 2, § 2–5, art. 32, art. 34, art. 36, art. 36¹, art. 37–39, art. 41, art. 242 § 2, art. 264 § 1', 'KP'), art('art. 30 ust. 3', 'ZZ'), art('art. 1, art. 8, art. 10', 'ZWOL'), art('art. 36 ust. 11', 'SUS')],
    forma: forma('pisemna', 'pracodawca', 'Oświadczenie o wypowiedzeniu umowy o pracę powinno nastąpić na piśmie (art. 30 § 3 KP).', { rodzaj_podpisy: 'rozwiazanie', akta: 'C' }),
    pola: MD().concat(PRACODAWCA()).concat([W('z_regon'), W('p_imie_nazwisko'), W('umowa_data'),
      wybor('rodzaj_umowy', 'Rodzaj umowy', RODZAJ_UMOWY_PRACA),
      wybor('skrocony', 'Skrócony okres wypowiedzenia (art. 36¹ KP)', [['nie', 'nie'], ['tak', 'tak — upadłość, likwidacja lub inne przyczyny niedotyczące pracownika']]),
      wybor('okres_wyp', 'Okres wypowiedzenia', OKRESY_WYP),
      pole('okres_skrocony', 'tekst', 'Długość zastosowanego skróconego okresu wypowiedzenia', { wymagane: false, wymagane_gdy: { pole: 'skrocony', rowne: 'tak' }, podpowiedz: 'np. 1 miesiąc (nie krócej niż 1 miesiąc)' }),
      pole('koniec_wyp', 'data', 'Okres wypowiedzenia upłynie w dniu'),
      pole('przyczyna', 'dlugi', 'Przyczyna wypowiedzenia (konkretna i prawdziwa)', { wymagane: false, wymagane_gdy: { pole: 'rodzaj_umowy', w: ['okreslony', 'nieokreslony'] } })]).concat(POLA_SAD()),
    tresc: [
      nagl(['{{z_nazwa}}', '{{z_siedziba}}', 'NIP: {{z_nip}}, REGON: {{z_regon}}']),
      tyt('ROZWIĄZANIE UMOWY O PRACĘ ZA WYPOWIEDZENIEM'), pod('z zastosowaniem skróconego okresu wypowiedzenia', { pole: 'skrocony', rowne: 'tak' }),
      ADR_PRACOWNIK(),
      p('Rozwiązuję z Panem/Panią umowę o pracę {{rodzaj_umowy}} zawartą w dniu {{umowa_data}} z zachowaniem {{okres_wyp}} okresu wypowiedzenia, który upłynie w dniu {{koniec_wyp}}.', { pole: 'skrocony', rowne: 'nie' }),
      p('Rozwiązuję z Panem/Panią umowę o pracę {{rodzaj_umowy}} zawartą w dniu {{umowa_data}} z zastosowaniem skróconego okresu wypowiedzenia, który wynosi {{okres_skrocony}} (art. 36¹ § 1 Kodeksu pracy) i upłynie w dniu {{koniec_wyp}}.', { pole: 'skrocony', rowne: 'tak' }),
      p('Za pozostałą część okresu wypowiedzenia przysługuje Panu/Pani odszkodowanie w wysokości wynagrodzenia za ten okres.', { pole: 'skrocony', rowne: 'tak' }),
      p('Przyczyną wypowiedzenia umowy o pracę jest: {{przyczyna}}', { pole: 'rodzaj_umowy', w: ['okreslony', 'nieokreslony'] }),
      pou('POUCZENIE', [
        'Jednocześnie informuję, iż w terminie 21 dni od dnia doręczenia niniejszego pisma przysługuje Panu/Pani prawo wniesienia odwołania do Sądu Rejonowego – Sądu Pracy w {{sad}}.',
        { tekst: 'Przed upływem tego terminu może Pan/Pani złożyć wniosek o wszczęcie postępowania pojednawczego przed Komisją Pojednawczą: {{komisja}}.', gdy: { pole: 'komisja', niepuste: true } },
      ]),
      sig(POD_ODBIOR, POD_PRAC_IMIE),
    ],
    uwagi: ['OBOWIĄZKOWE: forma pisemna (art. 30 § 3), przyczyna przy umowie na czas określony i nieokreślony (art. 30 § 4), pouczenie o odwołaniu do sądu pracy (art. 30 § 5). Termin odwołania: 21 dni od doręczenia (art. 264 § 1).',
      'Przyczyna musi być konkretna, prawdziwa i zrozumiała dla pracownika — „utrata zaufania” czy „reorganizacja” bez opisu faktów nie wystarcza. Przy okresie próbnym przyczyny się nie podaje.',
      UW_OKRES_WYP,
      'Skrócenie (art. 36¹): tylko okres 3-miesięczny, najwyżej do 1 miesiąca, przy upadłości, likwidacji lub innych przyczynach niedotyczących pracowników; okres odszkodowania wykazuje się w świadectwie pracy (ust. 5 wzoru).',
      'ZAKAZY: nie wolno wypowiedzieć umowy w czasie urlopu ani innej usprawiedliwionej nieobecności, jeżeli nie upłynął okres uprawniający do rozwiązania bez wypowiedzenia (art. 41); pracownikowi, któremu brakuje nie więcej niż 4 lata do wieku emerytalnego (art. 39). Inne ochrony (ciąża, urlopy rodzicielskie, działacze związkowi) — sprawdzić odrębnie; tych przepisów dziś nie czytano.',
      UW_ZWIAZEK,
      'Pracodawca zatrudniający co najmniej 20 pracowników, wypowiadający umowę wyłącznie z przyczyn niedotyczących pracownika: odprawa 1-, 2- albo 3-miesięcznego wynagrodzenia (zatrudnienie krótsze niż 2 lata / od 2 do 8 lat / ponad 8 lat), nie więcej niż 15-krotność minimalnego wynagrodzenia (art. 8 i art. 10 ust. 1 ustawy z 13.03.2003 r.). Procedury zwolnień grupowych (art. 1–6) wzór nie obsługuje.',
      'W okresie wypowiedzenia co najmniej dwutygodniowego pracownikowi przysługuje zwolnienie na poszukiwanie pracy: 2 dni robocze (wypowiedzenie 2-tygodniowe i 1-miesięczne) albo 3 dni (3-miesięczne) — art. 37.',
      UW_SAD, 'Doręczenie: osobiście za potwierdzeniem odbioru albo listem poleconym za potwierdzeniem odbioru. Odmowa podpisania odbioru nie wstrzymuje skutków — sporządzić notatkę z datą i świadkiem.',
      'W dniu ustania stosunku pracy: świadectwo pracy + informacja o przechowywaniu dokumentacji (art. 94⁶), wyrejestrowanie z ZUS w 7 dni (art. 36 ust. 11 ustawy o systemie ubezpieczeń społecznych).', UW_CUDZ_KONIEC],
    dwujezyczny: DJ.zalecany('Przepis nie wymaga tłumaczenia wypowiedzenia, ale od doręczenia biegnie 21 dni na odwołanie — cudzoziemcowi nieznającemu polskiego należy doręczyć pismo z tłumaczeniem.'),
  });

  dodaj({
    id: 'rozwiazanie-bez-wypowiedzenia-pracodawca', nazwa: 'Rozwiązanie umowy o pracę bez wypowiedzenia — przez pracodawcę (art. 52 / art. 53 KP)', grupa: G4, dla: 'pracownik',
    zrodlo: { typ: 'urzedowy', akt: 'Pomocniczy wzór MRPiPS „Rozwiązanie umowy o pracę bez wypowiedzenia”', url: URL.MRPIPS_WZORY, eli: AKTY.KP.eli, uwaga: 'Układ i sformułowania według pomocniczego wzoru MRPiPS.' },
    podstawa: [art('art. 30 § 1 pkt 3, § 3–5, art. 52, art. 53, art. 264 § 2', 'KP'), art('art. 30 ust. 3', 'ZZ')],
    forma: forma('pisemna', 'pracodawca', 'Oświadczenie o rozwiązaniu umowy o pracę bez wypowiedzenia powinno nastąpić na piśmie (art. 30 § 3 KP).', { rodzaj_podpisy: 'rozwiazanie', akta: 'C' }),
    pola: MD().concat(PRACODAWCA()).concat([W('z_regon'), W('p_imie_nazwisko'), W('umowa_data'),
      pole('data_rozwiazania', 'data', 'Umowa rozwiązuje się z dniem'),
      wybor('podstawa_prawna', 'Podstawa prawna', [
        ['52-1-1', 'art. 52 § 1 pkt 1 — ciężkie naruszenie podstawowych obowiązków pracowniczych', 'art. 52 § 1 pkt 1 Kodeksu pracy — ciężkie naruszenie przez pracownika podstawowych obowiązków pracowniczych'],
        ['52-1-2', 'art. 52 § 1 pkt 2 — przestępstwo uniemożliwiające dalsze zatrudnianie', 'art. 52 § 1 pkt 2 Kodeksu pracy — popełnienie przez pracownika w czasie trwania umowy o pracę przestępstwa, które uniemożliwia dalsze zatrudnianie go na zajmowanym stanowisku'],
        ['52-1-3', 'art. 52 § 1 pkt 3 — zawiniona utrata uprawnień', 'art. 52 § 1 pkt 3 Kodeksu pracy — zawiniona przez pracownika utrata uprawnień koniecznych do wykonywania pracy na zajmowanym stanowisku'],
        ['53-1-1a', 'art. 53 § 1 pkt 1 lit. a — choroba ponad 3 miesiące (zatrudnienie krótsze niż 6 miesięcy)', 'art. 53 § 1 pkt 1 lit. a Kodeksu pracy — niezdolność pracownika do pracy wskutek choroby trwająca dłużej niż 3 miesiące'],
        ['53-1-1b', 'art. 53 § 1 pkt 1 lit. b — choroba ponad okres wynagrodzenia, zasiłku i 3 miesięcy świadczenia rehabilitacyjnego', 'art. 53 § 1 pkt 1 lit. b Kodeksu pracy — niezdolność pracownika do pracy wskutek choroby trwająca dłużej niż łączny okres pobierania z tego tytułu wynagrodzenia i zasiłku oraz pobierania świadczenia rehabilitacyjnego przez pierwsze 3 miesiące'],
        ['53-1-2', 'art. 53 § 1 pkt 2 — inna usprawiedliwiona nieobecność ponad 1 miesiąc', 'art. 53 § 1 pkt 2 Kodeksu pracy — usprawiedliwiona nieobecność pracownika w pracy z innych przyczyn niż choroba, trwająca dłużej niż 1 miesiąc']]),
      pole('przyczyna', 'dlugi', 'Przyczyna — opis faktów (co, kiedy)')]).concat(POLA_SAD()),
    tresc: [
      nagl(['{{z_nazwa}}', '{{z_siedziba}}', 'NIP: {{z_nip}}, REGON: {{z_regon}}']),
      tyt('ROZWIĄZANIE UMOWY O PRACĘ BEZ WYPOWIEDZENIA'), ADR_PRACOWNIK(),
      p('Z dniem {{data_rozwiazania}} rozwiązuję z Panem/Panią bez zachowania okresu wypowiedzenia umowę o pracę zawartą w dniu {{umowa_data}} z powodu: {{przyczyna}}'),
      p('Podstawa prawna rozwiązania umowy: {{podstawa_prawna}}.'),
      pou('POUCZENIE', [
        'Jednocześnie informuję, iż w terminie 21 dni od dnia doręczenia niniejszego pisma przysługuje Panu/Pani prawo wniesienia żądania przywrócenia do pracy lub odszkodowania do Sądu Rejonowego – Sądu Pracy w {{sad}}.',
        { tekst: 'Przed upływem tego terminu może Pan/Pani złożyć wniosek o wszczęcie postępowania pojednawczego przed Komisją Pojednawczą: {{komisja}}.', gdy: { pole: 'komisja', niepuste: true } },
      ]),
      sig(POD_ODBIOR, POD_PRAC_IMIE),
    ],
    uwagi: ['TERMIN (art. 52 § 2): rozwiązanie z winy pracownika nie może nastąpić po upływie 1 miesiąca od uzyskania przez pracodawcę wiadomości o okoliczności uzasadniającej rozwiązanie. Datę uzyskania wiadomości zapisać w notatce.',
      'Związek zawodowy: decyzję podejmuje się po zasięgnięciu opinii reprezentującej pracownika zakładowej organizacji związkowej; organizacja ma 3 dni (art. 52 § 3; przy art. 53 — odpowiednio, art. 53 § 4).',
      'Art. 53: nie wolno rozwiązać umowy po stawieniu się pracownika do pracy w związku z ustaniem przyczyny nieobecności (§ 3) ani w czasie opieki nad dzieckiem w okresie pobierania zasiłku lub odosobnienia z powodu choroby zakaźnej w okresie pobierania wynagrodzenia i zasiłku (§ 2).',
      'Przyczyna musi być opisana konkretnie (fakty i daty) — sąd bada wyłącznie przyczynę wskazaną w piśmie. To tryb nadzwyczajny: przed użyciem art. 52 kadrowa konsultuje sprawę z prawnikiem klienta.',
      'W świadectwie pracy wskazuje się tryb i podstawę (art. 52 albo art. 53). Rażące naruszenie przepisów przy rozwiązaniu bez wypowiedzenia jest wykroczeniem (art. 281 § 1 pkt 3 KP).',
      UW_SAD, UW_CUDZ_KONIEC],
    dwujezyczny: DJ.zalecany('Od doręczenia biegnie 21 dni na żądanie przywrócenia do pracy lub odszkodowania — cudzoziemcowi nieznającemu polskiego doręczyć z tłumaczeniem.'),
  });

  dodaj({
    id: 'wypowiedzenie-umowy-o-prace-pracownik', nazwa: 'Wypowiedzenie umowy o pracę przez pracownika', grupa: G4, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Oświadczenie pracownika o wypowiedzeniu umowy na piśmie (art. 30 § 1 pkt 2 i § 3 KP) z zachowaniem okresu wypowiedzenia (art. 34, art. 36 KP). Przyczyny nie podaje się.' },
    podstawa: [art('art. 30 § 1 pkt 2, § 2¹ i § 3, art. 32, art. 34, art. 36, art. 300', 'KP'), art('art. 73 § 1', 'KC')],
    forma: forma('pisemna', 'pracownik', 'Oświadczenie o wypowiedzeniu powinno nastąpić na piśmie (art. 30 § 3 KP).', { rodzaj_podpisy: 'rozwiazanie', akta: 'C' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('p_imie_nazwisko'), W('p_stanowisko'), W('umowa_data'),
      wybor('okres_wyp', 'Okres wypowiedzenia', OKRESY_WYP), pole('koniec_wyp', 'data', 'Okres wypowiedzenia upłynie w dniu')]),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('WYPOWIEDZENIE UMOWY O PRACĘ'),
      p('Wypowiadam umowę o pracę zawartą w dniu {{umowa_data}} z pracodawcą: {{z_nazwa}}, z zachowaniem {{okres_wyp}} okresu wypowiedzenia, który upłynie w dniu {{koniec_wyp}}.'),
      sig('potwierdzenie przyjęcia przez pracodawcę — data i podpis', 'podpis pracownika')],
    uwagi: [UW_OKRES_WYP, 'Strony mogą po wypowiedzeniu ustalić wcześniejszy termin rozwiązania umowy — nie zmienia to trybu rozwiązania (art. 36 § 6).',
      'Art. 30 § 3 KP nie zastrzega formy pisemnej pod rygorem nieważności (por. art. 73 § 1 KC w zw. z art. 300 KP) — wypowiedzenia złożonego e-mailem lub SMS-em pracodawca nie powinien ignorować; ustalić datę końca umowy i potwierdzić ją pracownikowi.', UW_CUDZ_KONIEC],
    dwujezyczny: DJ.zalecany('Jeżeli biuro przygotowuje to pismo dla cudzoziemca, powinien on rozumieć jego skutek — wersja dwujęzyczna.'),
  });

  dodaj({
    id: 'porozumienie-stron-praca', nazwa: 'Porozumienie stron o rozwiązaniu umowy o pracę', grupa: G4, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Rozwiązanie umowy o pracę na mocy porozumienia stron (art. 30 § 1 pkt 1 KP). Kodeks pracy nie określa treści ani formy porozumienia.' },
    podstawa: [art('art. 30 § 1 pkt 1, art. 84', 'KP')],
    forma: forma('dokumentowa', 'obie', 'Art. 30 § 3 KP wymaga formy pisemnej dla wypowiedzenia i rozwiązania bez wypowiedzenia, nie dla porozumienia stron — ale dla pewności dowodowej biuro stosuje formę pisemną (moduł podpisów traktuje rodzaj „rozwiazanie” jak formę pisemną).', { metody: ['odreczny', 'kwalifikowany'], rodzaj_podpisy: 'rozwiazanie', akta: 'C' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'), W('umowa_data'), pole('data_rozwiazania', 'data', 'Umowa rozwiązuje się z dniem'),
      wybor('inicjatywa', 'Z czyjej inicjatywy', [['brak', 'nie wskazywać', ''], ['pracownik', 'pracownika', ' — z inicjatywy Pracownika'], ['pracodawca', 'pracodawcy', ' — z inicjatywy Pracodawcy']]),
      wybor('urlop', 'Urlop wypoczynkowy', [['wykorzystany', 'wykorzystany w naturze', 'Pracownik wykorzysta przysługujący mu urlop wypoczynkowy do dnia rozwiązania umowy.'], ['ekwiwalent', 'ekwiwalent pieniężny', 'Za niewykorzystany urlop wypoczynkowy Pracodawca wypłaci Pracownikowi ekwiwalent pieniężny.']])]),
    tresc: [
      tyt('POROZUMIENIE STRON'), pod('o rozwiązaniu umowy o pracę'),
      p('zawarte w dniu {{d_data}} w miejscowości {{d_miejscowosc}} między:'),
      p('{{z_nazwa}} z siedzibą: {{z_siedziba}}, NIP {{z_nip}}, reprezentowaną przez: {{z_reprezentant}}, zwaną dalej „Pracodawcą”,'),
      p('a Panem/Panią {{p_imie_nazwisko}}, zwanym(-ą) dalej „Pracownikiem”.'),
      par('§ 1'),
      p('Strony zgodnie postanawiają, że umowa o pracę zawarta w dniu {{umowa_data}} ulega rozwiązaniu z dniem {{data_rozwiazania}} na mocy porozumienia stron (art. 30 § 1 pkt 1 Kodeksu pracy){{inicjatywa}}.'),
      par('§ 2'),
      p('{{urlop}}'),
      par('§ 3'),
      p('Porozumienie sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.'),
      sig('data i podpis pracownika', POD_PRACODAWCY),
    ],
    uwagi: ['Porozumienie wymaga rzeczywistej zgody obu stron; można je zawrzeć w każdym czasie, także w okresie ochronnym.',
      'Jeżeli rozwiązanie następuje z przyczyn niedotyczących pracownika, w świadectwie pracy wskazuje się art. 1 albo art. 10 ustawy z 13.03.2003 r. (objaśnienie 4 do wzoru świadectwa) — wzór tego nie obsługuje; uzupełnić ręcznie.',
      'W porozumieniu celowo nie ma klauzuli „zrzeczenia się wszelkich roszczeń” — pracownik nie może zrzec się prawa do wynagrodzenia (art. 84 KP); o dodatkowych postanowieniach decyduje kadrowa.', UW_CUDZ_KONIEC],
    dwujezyczny: DJ.zalecany('Porozumienie kończy zatrudnienie — cudzoziemiec nieznający polskiego powinien otrzymać tłumaczenie przed podpisaniem.'),
  });

  dodaj({
    id: 'rozwiazanie-bez-wypowiedzenia-pracownik', nazwa: 'Rozwiązanie umowy o pracę bez wypowiedzenia przez pracownika (art. 55 KP)', grupa: G4, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Oświadczenie pracownika na piśmie z podaniem przyczyny uzasadniającej rozwiązanie umowy (art. 55 § 2 KP); przesłanki: orzeczenie lekarskie (§ 1) albo ciężkie naruszenie podstawowych obowiązków przez pracodawcę (§ 1¹).' },
    podstawa: [art('art. 55, art. 52 § 2, art. 61¹', 'KP')],
    forma: forma('pisemna', 'pracownik', 'Oświadczenie powinno nastąpić na piśmie, z podaniem przyczyny (art. 55 § 2 KP).', { rodzaj_podpisy: 'rozwiazanie', akta: 'C' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('p_imie_nazwisko'), W('p_stanowisko'), W('umowa_data'),
      wybor('podstawa_prawna', 'Podstawa', [['1', 'art. 55 § 1 — orzeczenie lekarskie, brak przeniesienia do innej pracy', 'art. 55 § 1 Kodeksu pracy — wydano orzeczenie lekarskie stwierdzające szkodliwy wpływ wykonywanej pracy na moje zdrowie, a pracodawca nie przeniósł mnie w terminie wskazanym w orzeczeniu do innej pracy, odpowiedniej ze względu na stan zdrowia i kwalifikacje zawodowe'], ['1-1', 'art. 55 § 1¹ — ciężkie naruszenie podstawowych obowiązków przez pracodawcę', 'art. 55 § 1¹ Kodeksu pracy — pracodawca dopuścił się ciężkiego naruszenia podstawowych obowiązków wobec pracownika']]),
      pole('przyczyna', 'dlugi', 'Przyczyna — opis faktów', { podpowiedz: 'np. niewypłacenie wynagrodzenia za wrzesień 2026 r. w terminie' })]),
    tresc: [NAGL_PRACOWNIK(), ADR_PRACODAWCA(), tyt('ROZWIĄZANIE UMOWY O PRACĘ BEZ WYPOWIEDZENIA'),
      p('Rozwiązuję umowę o pracę zawartą w dniu {{umowa_data}} bez zachowania okresu wypowiedzenia na podstawie: {{podstawa_prawna}}.'),
      p('Przyczyna uzasadniająca rozwiązanie umowy: {{przyczyna}}'),
      sig('potwierdzenie przyjęcia przez pracodawcę — data i podpis', 'podpis pracownika')],
    uwagi: ['Termin: 1 miesiąc od uzyskania przez pracownika wiadomości o okoliczności uzasadniającej rozwiązanie (art. 55 § 2 w zw. z art. 52 § 2).',
      'Przy § 1¹ pracownikowi przysługuje odszkodowanie w wysokości wynagrodzenia za okres wypowiedzenia (przy umowie na czas określony — nie więcej niż za okres wypowiedzenia). Nieuzasadnione rozwiązanie rodzi roszczenie odszkodowawcze pracodawcy (art. 61¹).',
      'Dokument przygotowuje się wyjątkowo — biuro obsługuje pracodawców; wzór służy głównie do rozpoznania pisma, które wpłynęło od pracownika.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  var NIE_DOT = { wymagane: false, gdy_puste: 'nie dotyczy' };
  dodaj({
    id: 'swiadectwo-pracy', nazwa: 'Świadectwo pracy', grupa: G4, dla: 'pracownik',
    zrodlo: { typ: 'urzedowy', akt: AKTY.R_SWIAD.tytul, zalacznik: 'załącznik — pomocniczy wzór świadectwa pracy', eli: AKTY.R_SWIAD.eli, uwaga: 'Treść i numeracja ustępów odwzorowują wzór urzędowy; pouczenie przytoczono dosłownie.' },
    podstawa: [art('art. 97 § 1–3, art. 99', 'KP'), art('§ 2 ust. 1–3, § 3, § 7 i załącznik', 'R_SWIAD')],
    forma: forma('pisemna', 'pracodawca', 'Świadectwo pracy podpisuje pracodawca lub osoba go reprezentująca albo upoważniona (wzór urzędowy); wydaje się je w dniu ustania stosunku pracy.', { rodzaj_podpisy: 'inny', akta: 'C' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba'), W('z_nip'), W('z_regon'), W('p_imie_nazwisko'), W('p_dataur'),
      pole('okresy', 'dlugi', 'Ust. 1 — okres(y) zatrudnienia i wymiar czasu pracy', { podpowiedz: 'np. od 1 marca 2025 r. do 30 września 2026 r. w wymiarze pełnego etatu' }),
      pole('tymczasowa', 'dlugi', 'Ust. 2 — praca tymczasowa (pracodawca użytkownik, okresy)', NIE_DOT),
      pole('rodzaj_pracy', 'dlugi', 'Ust. 3 — rodzaj wykonywanej pracy lub zajmowane stanowiska, lub pełnione funkcje', { rejestr: 'u_stanowisko' }),
      wybor('ustanie', 'Ust. 4 — stosunek pracy ustał w wyniku', [
        ['porozumienie', 'rozwiązania na mocy porozumienia stron', 'a) rozwiązania: na mocy porozumienia stron — art. 30 § 1 pkt 1 Kodeksu pracy'],
        ['wyp_pracodawca', 'rozwiązania za wypowiedzeniem przez pracodawcę', 'a) rozwiązania: za wypowiedzeniem dokonanym przez pracodawcę — art. 30 § 1 pkt 2 Kodeksu pracy'],
        ['wyp_pracownik', 'rozwiązania za wypowiedzeniem przez pracownika', 'a) rozwiązania: za wypowiedzeniem dokonanym przez pracownika — art. 30 § 1 pkt 2 Kodeksu pracy'],
        ['bez_52', 'rozwiązania bez wypowiedzenia przez pracodawcę — art. 52', 'a) rozwiązania: bez wypowiedzenia przez pracodawcę — art. 30 § 1 pkt 3 w związku z art. 52 Kodeksu pracy'],
        ['bez_53', 'rozwiązania bez wypowiedzenia przez pracodawcę — art. 53', 'a) rozwiązania: bez wypowiedzenia przez pracodawcę — art. 30 § 1 pkt 3 w związku z art. 53 Kodeksu pracy'],
        ['bez_55', 'rozwiązania bez wypowiedzenia przez pracownika — art. 55', 'a) rozwiązania: bez wypowiedzenia przez pracownika — art. 30 § 1 pkt 3 w związku z art. 55 Kodeksu pracy'],
        ['uplyw', 'rozwiązania z upływem czasu, na który umowa była zawarta', 'a) rozwiązania: z upływem czasu, na który umowa była zawarta — art. 30 § 1 pkt 4 Kodeksu pracy'],
        ['inne', 'inny tryb / wygaśnięcie — opis ręczny', '{{ustanie_opis}}']]),
      pole('ustanie_opis', 'dlugi', 'Ust. 4 — opis innego trybu rozwiązania albo podstawy wygaśnięcia', { wymagane: false, wymagane_gdy: { pole: 'ustanie', rowne: 'inne' }, podpowiedz: 'wpisać według wzoru: „a) rozwiązania: … (tryb i podstawa prawna)” albo „b) wygaśnięcia: … (podstawa prawna)”' }),
      pole('skrocenie', 'tekst', 'Ust. 5 — okres, o który skrócono okres wypowiedzenia (art. 36¹ § 1)', NIE_DOT),
      pole('u6_1', 'tekst', 'Ust. 6 pkt 1 — zwolnienie z art. 148¹ § 1 wykorzystane w roku ustania (dni lub godziny)', NIE_DOT),
      pole('u6_2', 'tekst', 'Ust. 6 pkt 2 — urlop wypoczynkowy wykorzystany w roku ustania (dni i godziny, także ekwiwalent)', { podpowiedz: 'np. 15 dni (120 godzin)' }),
      pole('u6_2a', 'tekst', 'Ust. 6 pkt 2 — w tym urlop na żądanie (art. 167²)', { wymagane: false, gdy_puste: '0 dni' }),
      pole('u6_3', 'tekst', 'Ust. 6 pkt 3 — urlop opiekuńczy wykorzystany w roku ustania (dni)', NIE_DOT),
      pole('u6_4', 'tekst', 'Ust. 6 pkt 4 — urlop bezpłatny (okres i podstawa prawna)', NIE_DOT),
      pole('u6_5', 'tekst', 'Ust. 6 pkt 5 — urlop ojcowski (wymiar, liczba części; imię i nazwisko dziecka)', NIE_DOT),
      pole('u6_6', 'tekst', 'Ust. 6 pkt 6 — urlop rodzicielski (wymiar, liczba części; dziecko)', NIE_DOT),
      pole('u6_7', 'tekst', 'Ust. 6 pkt 7 — urlop wychowawczy (podstawa prawna, wymiar, okresy, liczba części; dziecko)', NIE_DOT),
      pole('u6_8', 'tekst', 'Ust. 6 pkt 8 — okres(y) ochrony z art. 186⁸ § 1 pkt 2', NIE_DOT),
      pole('u6_9', 'tekst', 'Ust. 6 pkt 9 — zwolnienie z art. 188 wykorzystane w roku ustania (dni lub godziny)', NIE_DOT),
      pole('u6_10', 'tekst', 'Ust. 6 pkt 10 — okazjonalna praca zdalna z art. 67³³ § 1 w roku ustania (dni)', NIE_DOT),
      pole('u6_11', 'tekst', 'Ust. 6 pkt 11 — liczba dni niezdolności do pracy z wynagrodzeniem z art. 92 w roku ustania', { wymagane: false, gdy_puste: '0' }),
      pole('u6_12', 'tekst', 'Ust. 6 pkt 12 — dni bez prawa do wynagrodzenia w 2003 r. (art. 92 § 1¹ w ówczesnym brzmieniu)', NIE_DOT),
      pole('u6_13', 'tekst', 'Ust. 6 pkt 13 — okres służby wojskowej', NIE_DOT),
      pole('u6_14', 'tekst', 'Ust. 6 pkt 14 — praca w szczególnych warunkach lub w szczególnym charakterze (okresy, rodzaj, stanowiska)', NIE_DOT),
      pole('u6_15', 'tekst', 'Ust. 6 pkt 15 — dodatkowy urlop albo inne uprawnienia lub świadczenia', NIE_DOT),
      pole('u6_16', 'tekst', 'Ust. 6 pkt 16 — okresy nieskładkowe', NIE_DOT),
      pole('zajecie_komornik', 'tekst', 'Ust. 7 — zajęcie wynagrodzenia: oznaczenie komornika i numer sprawy egzekucyjnej', NIE_DOT),
      pole('zajecie_kwoty', 'tekst', 'Ust. 7 — wysokość potrąconych kwot', NIE_DOT),
      pole('uzupelniajace', 'dlugi', 'Ust. 8 — informacje uzupełniające', { wymagane: false, gdy_puste: 'brak' })]),
    tresc: [
      nagl(['{{z_nazwa}}', '{{z_siedziba}}', '(pracodawca oraz jego siedziba lub miejsce zamieszkania)', 'NIP: {{z_nip}}, REGON: {{z_regon}}']),
      tyt('ŚWIADECTWO PRACY'),
      p('1. Stwierdza się, że {{p_imie_nazwisko}}, urodzony(-a) {{p_dataur}}, był(a) zatrudniony(-a) u pracodawcy: {{z_nazwa}}, w okresie: {{okresy}}.'),
      p('2. W okresie zatrudnienia pracownik wykonywał pracę tymczasową na rzecz: {{tymczasowa}}.'),
      p('3. W okresie zatrudnienia pracownik wykonywał pracę: {{rodzaj_pracy}}.'),
      p('4. Stosunek pracy ustał w wyniku: {{ustanie}}.'),
      p('5. Został zastosowany skrócony okres wypowiedzenia umowy o pracę na podstawie art. 36¹ § 1 Kodeksu pracy: {{skrocenie}}.'),
      p('6. W okresie zatrudnienia pracownik:'),
      li([
        'wykorzystał zwolnienie od pracy przewidziane w art. 148¹ § 1 Kodeksu pracy: {{u6_1}}',
        'wykorzystał urlop wypoczynkowy w wymiarze: {{u6_2}}, w tym na podstawie art. 167² Kodeksu pracy: {{u6_2a}}',
        'wykorzystał urlop opiekuńczy w wymiarze: {{u6_3}}',
        'korzystał z urlopu bezpłatnego: {{u6_4}}',
        'wykorzystał urlop ojcowski: {{u6_5}}',
        'wykorzystał urlop rodzicielski: {{u6_6}}',
        'wykorzystał urlop wychowawczy: {{u6_7}}',
        'korzystał z ochrony stosunku pracy, o której mowa w art. 186⁸ § 1 pkt 2 Kodeksu pracy, w okresie (okresach): {{u6_8}}',
        'wykorzystał zwolnienie od pracy przewidziane w art. 188 Kodeksu pracy: {{u6_9}}',
        'wykonywał pracę zdalną przewidzianą w art. 67³³ § 1 Kodeksu pracy: {{u6_10}}',
        'był niezdolny do pracy przez okres {{u6_11}} dni (liczba dni, za które pracownik otrzymał wynagrodzenie, zgodnie z art. 92 Kodeksu pracy, w roku kalendarzowym, w którym ustał stosunek pracy)',
        'dni, za które pracownik nie zachował prawa do wynagrodzenia, przypadające w okresie od dnia 1 stycznia 2003 r. do dnia 31 grudnia 2003 r.: {{u6_12}}',
        'odbył służbę wojskową w okresie: {{u6_13}}',
        'wykonywał pracę w szczególnych warunkach lub w szczególnym charakterze: {{u6_14}}',
        'wykorzystał dodatkowy urlop albo inne uprawnienia lub świadczenia przewidziane przepisami prawa pracy: {{u6_15}}',
        'okresy nieskładkowe, przypadające w okresie zatrudnienia wskazanym w ust. 1, uwzględniane przy ustalaniu prawa do emerytury lub renty: {{u6_16}}',
      ]),
      p('7. Informacja o zajęciu wynagrodzenia: {{zajecie_komornik}} (oznaczenie komornika i numer sprawy egzekucyjnej); wysokość potrąconych kwot: {{zajecie_kwoty}}.'),
      p('8. Informacje uzupełniające: {{uzupelniajace}}.'),
      sig(null, POD_PRACODAWCY),
      pou('POUCZENIE', [
        'Pracownik może w ciągu 14 dni od otrzymania świadectwa pracy wystąpić z wnioskiem do pracodawcy o sprostowanie świadectwa pracy. W razie nieuwzględnienia wniosku pracownikowi przysługuje, w ciągu 14 dni od zawiadomienia o odmowie sprostowania świadectwa pracy, prawo wystąpienia z żądaniem jego sprostowania do sądu pracy. W przypadku niezawiadomienia przez pracodawcę o odmowie sprostowania świadectwa pracy, żądanie sprostowania świadectwa pracy wnosi się do sądu pracy.',
        '(podstawa prawna – art. 97 § 2¹ Kodeksu pracy)',
      ]),
    ],
    uwagi: ['TERMIN: w dniu ustania stosunku pracy; gdy to obiektywnie niemożliwe — wysyłka pocztą lub inne doręczenie w ciągu 7 dni (art. 97 § 1). Wydania nie wolno uzależniać od rozliczenia się pracownika (art. 97 § 1³).',
      'Kolejna umowa z tym samym pracownikiem w ciągu 7 dni: świadectwo tylko na jego wniosek, w 7 dni od wniosku (art. 97 § 1¹–1²).',
      'Razem ze świadectwem OBOWIĄZKOWO informacja o przechowywaniu dokumentacji pracowniczej (art. 94⁶) — dokument „Informacja o okresie przechowywania dokumentacji pracowniczej”.',
      'Ust. 6 pkt 2: tylko urlop za rok ustania stosunku pracy, wykorzystany w naturze lub objęty ekwiwalentem — w dniach i godzinach. Pkt 5–6: urlop ojcowski i rodzicielski tylko gdy ze względu na wiek dziecka można z nich korzystać u kolejnego pracodawcy. Pkt 15: tylko to, co wpływa na uprawnienia u kolejnego pracodawcy.',
      'Ust. 8: należności uznane i niewypłacone z braku środków; na żądanie pracownika — wysokość i składniki wynagrodzenia, uzyskane kwalifikacje.',
      'Odszkodowanie za niewydanie w terminie lub wydanie niewłaściwego świadectwa: wynagrodzenie za czas pozostawania bez pracy z tego powodu, nie dłużej niż 6 tygodni (art. 99).',
      'Sprostowanie: pracodawca odpowiada na wniosek w 7 dni; przy uwzględnieniu wydaje nowe świadectwo, a poprzednie usuwa z akt i niszczy (§ 7 ust. 1 i 5 rozporządzenia).',
      'Kopię przechowuje się w aktach osobowych — część C. Zleceniobiorcom świadectwa pracy się nie wydaje.'],
    dwujezyczny: DJ.nie('Dokument urzędowego wzoru dla polskich instytucji (ZUS, urząd pracy, kolejny pracodawca) — po polsku. Cudzoziemcowi warto przetłumaczyć pouczenie o 14-dniowym terminie na sprostowanie.'),
  });

  dodaj({
    id: 'informacja-przechowywanie-dokumentacji', nazwa: 'Informacja o okresie przechowywania dokumentacji pracowniczej (art. 94⁶ KP)', grupa: G4, dla: 'pracownik',
    zrodlo: { typ: 'ustawowy', elementy: 'Treść określona w art. 94⁶ KP: 1) okres przechowywania dokumentacji pracowniczej; 2) możliwość odbioru dokumentacji do końca miesiąca kalendarzowego następującego po upływie okresu przechowywania; 3) zniszczenie dokumentacji w razie jej nieodebrania w tym okresie.' },
    podstawa: [art('art. 94 pkt 9b, art. 94⁵, art. 94⁶', 'KP')],
    forma: forma('bez_podpisu', 'potwierdzenie', 'Informację wydaje się w postaci papierowej lub elektronicznej wraz ze świadectwem pracy (art. 94⁶ KP); podpis pracownika jest tylko potwierdzeniem odbioru.', { rodzaj_podpisy: 'inny', akta: 'C' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'),
      pole('data_ustania', 'data', 'Dzień ustania stosunku pracy'),
      wybor('okres', 'Okres przechowywania', [['10', '10 lat (zasada — art. 94 pkt 9b KP)', '10 lat, licząc od końca roku kalendarzowego, w którym stosunek pracy uległ rozwiązaniu lub wygasł'], ['inny', 'inny okres wynikający z przepisów odrębnych', '{{okres_opis}}']]),
      pole('okres_opis', 'tekst', 'Inny okres przechowywania — opis i podstawa', { wymagane: false, wymagane_gdy: { pole: 'okres', rowne: 'inny' }, podpowiedz: 'np. 50 lat od dnia zakończenia pracy — dla stosunku pracy nawiązanego przed 1 stycznia 1999 r.' }),
      pole('przechowywanie_do', 'data', 'Okres przechowywania upływa w dniu'),
      pole('odbior_do', 'data', 'Odbiór dokumentacji możliwy do dnia (koniec następnego miesiąca)'),
      pole('miejsce_odbioru', 'tekst', 'Gdzie można odebrać dokumentację', { rejestr: { lacz: ['z_ulica', 'z_miasto'], sep: ', ' } })]),
    tresc: [
      NAGL_PRACODAWCA(), ADR_PRACOWNIK(),
      tyt('INFORMACJA'), pod('o okresie przechowywania dokumentacji pracowniczej'),
      p('W związku z ustaniem stosunku pracy z dniem {{data_ustania}}, na podstawie art. 94⁶ Kodeksu pracy informuję o:'),
      li(['okresie przechowywania dokumentacji pracowniczej: Pana/Pani dokumentacja pracownicza będzie przechowywana przez okres {{okres}}, tj. do dnia {{przechowywanie_do}};',
        'możliwości odbioru dokumentacji pracowniczej: dokumentację może Pan/Pani odebrać do końca miesiąca kalendarzowego następującego po upływie okresu jej przechowywania, tj. do dnia {{odbior_do}}, w: {{miejsce_odbioru}};',
        'zniszczeniu dokumentacji pracowniczej: w przypadku nieodebrania dokumentacji pracowniczej w powyższym okresie zostanie ona zniszczona.']),
      p('W przypadku ponownego nawiązania stosunku pracy z tym samym pracodawcą w okresie przechowywania dokumentacji okres ten liczy się od końca roku kalendarzowego, w którym kończący się najpóźniej stosunek pracy rozwiązał się lub wygasł (art. 94⁵ § 2 Kodeksu pracy).'),
      sig(POD_ODBIOR, POD_PRAC_IMIE),
    ],
    uwagi: ['Wydaje się ZAWSZE razem ze świadectwem pracy. Brak informacji to naruszenie obowiązków pracodawcy w zakresie dokumentacji pracowniczej.',
      'Okres 10 lat to zasada z art. 94 pkt 9b. Dłuższe okresy (np. 50 lat dla dawnych stosunków pracy) wynikają z przepisów odrębnych, których dziś nie czytano — przy pracownikach zatrudnionych przed 2019 r. kadrowa ustala okres indywidualnie i wybiera opcję „inny okres”.',
      'Daty: dla ustania w 2026 r. okres 10 lat upływa 31 grudnia 2036 r., a odbiór jest możliwy do 31 stycznia 2037 r. — portal może je wyliczać.',
      'CUDZOZIEMIEC: kopie dokumentów pobytowych i dane osobowe — 2 lata od końca roku ustania umowy, chyba że odrębne przepisy przewidują dłuższy okres (art. 4 ust. 4 i 6 ustawy o powierzaniu pracy cudzoziemcom); przy umowie o pracę obowiązuje dłuższy okres dokumentacji pracowniczej.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  // =====================================================================================
  //  5. ZLECENIE I DZIEŁO
  // =====================================================================================
  var G5 = 'Zlecenie i dzieło';

  biuro('umowa-zlecenia', 'Umowa zlecenia', G5, 'zleceniobiorca', 'umowa', 'zlecenie',
    [art('art. 734–751', 'KC'), art('art. 8a–8c', 'MIN'), art('art. 5 ust. 1–3', 'CUDZ')],
    ['Wzór klienta, a gdy go nie ma — standardowy wzór biura (z wFirmy). W umowie trzeba określić sposób potwierdzania liczby godzin (art. 8b ust. 1) i wynagrodzenie nie niższe niż minimalna stawka godzinowa (art. 8a ust. 1); wypłata co najmniej raz w miesiącu przy umowach dłuższych niż miesiąc (art. 8a ust. 6).',
      'CUDZOZIEMIEC: forma pisemna przed dopuszczeniem do pracy, wersja zrozumiała, kopia umowy przez praca.gov.pl przed powierzeniem pracy.',
      'UWAGA 2026: ustawa z 11.03.2026 r. o zmianie ustawy o PIP (Dz. U. poz. 473, od 8.07.2026 r.) dała inspektorowi pracy kompetencję stwierdzenia decyzją istnienia stosunku pracy — umowa zlecenia wykonywana w warunkach stosunku pracy to realne ryzyko klienta.'],
    forma('dokumentowa', 'obie', 'Kodeks cywilny nie zastrzega formy dla zlecenia; ustawa o minimalnym wynagrodzeniu zakłada formę pisemną, elektroniczną lub dokumentową (art. 8b ust. 3). Dla cudzoziemca — forma pisemna (art. 5 ust. 1 ustawy o powierzaniu pracy cudzoziemcom).', { rodzaj_podpisy: 'umowa_zlecenie', cudzoziemiec: 'pisemna' }),
    DJ.wymagany('art. 5 ust. 2 ustawy o powierzaniu pracy cudzoziemcom', 'Jak przy umowie o pracę — treść na piśmie w wersji zrozumiałej przed podpisaniem.'));

  biuro('oswiadczenie-wybor-umowy', 'Oświadczenie o wyborze umowy zlecenia + informacja o różnicach', G5, 'zleceniobiorca', 'wybor', 'zlecenie', [], ['Dokument biura; nie wyłącza oceny charakteru umowy przez PIP ani sąd.'],
    forma('dokumentowa', 'pracownik', 'Przepisy nie wymagają szczególnej formy.'), DJ.zalecany(DJ_ZAL));

  biuro('oswiadczenie-zleceniobiorcy-zus', 'Oświadczenie zleceniobiorcy dla celów podatkowych i ZUS', G5, 'zleceniobiorca', 'zus', 'zlecenie', [],
    ['Status studenta do 26 lat, inne tytuły do ubezpieczeń, emerytura/renta — od tego zależy zakres składek. Zleceniobiorca zobowiązuje się informować o zmianach.'],
    forma('dokumentowa', 'pracownik', 'Przepisy nie wymagają szczególnej formy.'), DJ.zalecany(DJ_ZAL));

  biuro('oswiadczenie-wykonawcy-podatki', 'Oświadczenie wykonawcy dla celów podatkowych', G5, 'zleceniobiorca', 'wykonawca', 'zlecenie', [], [],
    forma('dokumentowa', 'pracownik', 'Przepisy nie wymagają szczególnej formy.'), DJ.zalecany(DJ_ZAL));

  dodaj({
    id: 'zlecenie-informacja-o-godzinach', nazwa: 'Zlecenie — informacja o liczbie godzin wykonania zlecenia (miesięczna)', grupa: G5, dla: 'zleceniobiorca',
    zrodlo: { typ: 'ustawowy', elementy: 'Informacja o liczbie godzin wykonania zlecenia lub świadczenia usług przedkładana w formie pisemnej, elektronicznej lub dokumentowej w terminie poprzedzającym termin wypłaty wynagrodzenia (art. 8b ust. 2 ustawy), albo dokument potwierdzający liczbę godzin w sposób określony w umowie (art. 8b ust. 1).' },
    podstawa: [art('art. 8a ust. 1–2 i 6, art. 8b, art. 8c, art. 8d, art. 8e', 'MIN')],
    forma: forma('dokumentowa', 'obie', 'Forma pisemna, elektroniczna lub dokumentowa (art. 8b ust. 2 ustawy o minimalnym wynagrodzeniu za pracę).', { rodzaj_podpisy: 'oswiadczenie' }),
    pola: [W('z_nazwa', { etykieta: 'Zleceniodawca — nazwa' }), W('p_imie_nazwisko', { etykieta: 'Zleceniobiorca — imię i nazwisko' }), W('umowa_data', { etykieta: 'Data zawarcia umowy zlecenia' }),
      pole('miesiac', 'tekst', 'Miesiąc i rok', { podpowiedz: 'np. październik 2026' }),
      pole('suma_godzin', 'liczba', 'Łączna liczba godzin w miesiącu', { wymagane: false, gdy_puste: '..........' }),
      W('d_data', { etykieta: 'Data złożenia informacji' })],
    tresc: [
      tyt('INFORMACJA O LICZBIE GODZIN WYKONANIA ZLECENIA'), pod('za {{miesiac}}'),
      kv([['Zleceniobiorca', '{{p_imie_nazwisko}}'], ['Zleceniodawca', '{{z_nazwa}}'], ['Umowa zlecenia z dnia', '{{umowa_data}}']]),
      p('Na podstawie art. 8b ustawy z dnia 10 października 2002 r. o minimalnym wynagrodzeniu za pracę informuję, że w wyżej wskazanym miesiącu wykonywałem(-am) zlecenie w następującym wymiarze:'),
      tab(['Dzień miesiąca', 'Liczba godzin', 'Uwagi'], null, 31),
      p('Łączna liczba godzin wykonania zlecenia: {{suma_godzin}}'),
      sig('data ({{d_data}}) i podpis zleceniobiorcy', 'potwierdzenie liczby godzin — data i podpis zleceniodawcy'),
    ],
    uwagi: ['Informację składa się PRZED terminem wypłaty wynagrodzenia. Zleceniodawca przechowuje dokumenty potwierdzające liczbę godzin przez 3 lata od dnia, w którym wynagrodzenie stało się wymagalne (art. 8c).',
      'Wynagrodzenie za każdą godzinę nie może być niższe od minimalnej stawki godzinowej; wypłata poniżej stawki: grzywna 1000–30 000 zł (art. 8e). Stawkę portal pobiera z rejestru ELI (moduł stawek).',
      'Nie dotyczy umów z art. 8d (m.in. gdy o miejscu i czasie decyduje zleceniobiorca i przysługuje mu wyłącznie wynagrodzenie prowizyjne).',
      'Rachunek do umowy zlecenia (naliczenie składek i zaliczki) nie jest częścią tego dokumentu — patrz pominięte.'],
    dwujezyczny: DJ.zalecany(DJ_ZAL),
  });

  dodaj({
    id: 'wypowiedzenie-umowy-zlecenia', nazwa: 'Wypowiedzenie umowy zlecenia', grupa: G5, dla: 'zleceniobiorca',
    zrodlo: { typ: 'ustawowy', elementy: 'Każda ze stron może wypowiedzieć zlecenie w każdym czasie (art. 746 § 1–2 KC); nie można zrzec się z góry wypowiedzenia z ważnych powodów (art. 746 § 3 KC); wypowiedzenie umowy zawartej w formie pisemnej, dokumentowej albo elektronicznej wymaga formy dokumentowej, chyba że umowa zastrzega inną (art. 77 § 2 KC).' },
    podstawa: [art('art. 746, art. 750, art. 77 § 2', 'KC'), art('art. 36 ust. 11', 'SUS')],
    forma: forma('dokumentowa', 'pracodawca', 'Forma dokumentowa, chyba że umowa zastrzega inną — sprawdzić postanowienia umowy (art. 77 § 2 KC).', { rodzaj_podpisy: 'rozwiazanie' }),
    pola: MD().concat([W('z_nazwa', { etykieta: 'Zleceniodawca — nazwa' }), W('z_siedziba', { etykieta: 'Zleceniodawca — adres siedziby' }), W('p_imie_nazwisko', { etykieta: 'Zleceniobiorca — imię i nazwisko' }), W('p_adres', { etykieta: 'Zleceniobiorca — adres' }), W('umowa_data', { etykieta: 'Data zawarcia umowy zlecenia' }),
      wybor('strona', 'Kto wypowiada', [['zleceniodawca', 'zleceniodawca'], ['zleceniobiorca', 'zleceniobiorca']]),
      wybor('tryb', 'Termin', [['natychmiast', 'ze skutkiem natychmiastowym', 'ze skutkiem natychmiastowym'], ['okres', 'z zachowaniem okresu wypowiedzenia z umowy', 'z zachowaniem przewidzianego w umowie okresu wypowiedzenia, tj. ze skutkiem na dzień {{data_konca}}']]),
      pole('data_konca', 'data', 'Umowa rozwiązuje się z dniem', { wymagane: false, wymagane_gdy: { pole: 'tryb', rowne: 'okres' } }),
      pole('powod', 'dlugi', 'Ważny powód wypowiedzenia (nieobowiązkowo)', { wymagane: false })]),
    tresc: [
      nagl(['{{z_nazwa}}', '{{z_siedziba}}']),
      adr(['Pan/Pani', '{{p_imie_nazwisko}}', '{{p_adres}}']),
      tyt('WYPOWIEDZENIE UMOWY ZLECENIA'),
      p('Działając w imieniu zleceniodawcy — {{z_nazwa}} — na podstawie art. 746 § 1 Kodeksu cywilnego wypowiadam zawartą z Panem/Panią umowę zlecenia z dnia {{umowa_data}} — {{tryb}}.', { pole: 'strona', rowne: 'zleceniodawca' }),
      p('Ja, {{p_imie_nazwisko}}, na podstawie art. 746 § 2 Kodeksu cywilnego wypowiadam umowę zlecenia z dnia {{umowa_data}} zawartą ze zleceniodawcą: {{z_nazwa}} — {{tryb}}.', { pole: 'strona', rowne: 'zleceniobiorca' }),
      p('Powodem wypowiedzenia jest: {{powod}}', { pole: 'powod', niepuste: true }),
      p('Wynagrodzenie odpowiadające czynnościom wykonanym do dnia rozwiązania umowy zostanie rozliczone na zasadach określonych w umowie, na podstawie potwierdzonej liczby godzin wykonania zlecenia.', { pole: 'strona', rowne: 'zleceniodawca' }),
      sig('potwierdzenie odbioru — data i podpis', 'podpis wypowiadającego'),
    ],
    uwagi: ['Najpierw przeczytać umowę: okres wypowiedzenia i forma wypowiedzenia z umowy mają pierwszeństwo. Standardowy wzór biura — sprawdzić właściwy paragraf.',
      'Zleceniodawca wypowiadający odpłatne zlecenie płaci część wynagrodzenia za dotychczasowe czynności i zwraca wydatki; wypowiedzenie bez ważnego powodu rodzi obowiązek naprawienia szkody (art. 746 § 1). Podanie powodu nie jest obowiązkowe, ale ma znaczenie dla odpowiedzialności.',
      'Wyrejestrowanie z ZUS — 7 dni od wygaśnięcia tytułu do ubezpieczeń (art. 36 ust. 11 ustawy o systemie ubezpieczeń społecznych).', UW_CUDZ_KONIEC,
      'Do zlecenia nie stosuje się pouczeń ani terminów z Kodeksu pracy.'],
    dwujezyczny: DJ.zalecany('Cudzoziemiec nieznający polskiego powinien rozumieć, że umowa się kończy i od kiedy — wersja dwujęzyczna.'),
  });

  dodaj({
    id: 'umowa-o-dzielo', nazwa: 'Umowa o dzieło', grupa: G5, dla: 'zleceniobiorca',
    zrodlo: { typ: 'ustawowy', elementy: 'Zobowiązanie do wykonania oznaczonego dzieła i do zapłaty wynagrodzenia (art. 627 KC); wynagrodzenie ryczałtowe (art. 632 KC); wady dzieła (art. 636, 638 KC); wynagrodzenie przy oddaniu dzieła (art. 642 KC); odbiór (art. 643 KC); odstąpienie zamawiającego (art. 635, 644 KC).' },
    podstawa: [art('art. 627–646', 'KC'), art('art. 36 ust. 17', 'SUS'), art('art. 5 ust. 1–3', 'CUDZ')],
    forma: forma('dokumentowa', 'obie', 'Kodeks cywilny nie zastrzega formy dla umowy o dzieło. Dla cudzoziemca umowa musi być zawarta w formie pisemnej przed dopuszczeniem do pracy (art. 5 ust. 1 ustawy o powierzaniu pracy cudzoziemcom).', { rodzaj_podpisy: 'inny', cudzoziemiec: 'pisemna' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko', { etykieta: 'Przyjmujący zamówienie — imię i nazwisko' }), W('p_adres'), W('p_pesel'), W('p_dokument'),
      pole('dzielo', 'dlugi', 'Oznaczenie dzieła (konkretny, sprawdzalny rezultat)', { podpowiedz: 'np. wykonanie i montaż drewnianej zabudowy tarasu o wymiarach 3 × 4 m według załączonego rysunku' }),
      pole('termin_rozp', 'data', 'Rozpoczęcie wykonywania dzieła'), pole('termin_wyk', 'data', 'Termin wykonania i wydania dzieła'),
      wybor('materialy', 'Materiały i narzędzia', [['zamawiajacy', 'dostarcza zamawiający', 'Materiały niezbędne do wykonania dzieła dostarcza Zamawiający. Przyjmujący zamówienie używa ich w sposób odpowiedni, składa rachunek z ich zużycia i zwraca niezużytą część.'], ['wykonawca', 'własne przyjmującego zamówienie', 'Dzieło zostanie wykonane z materiałów i przy użyciu narzędzi Przyjmującego zamówienie; ich koszt jest objęty wynagrodzeniem.']]),
      pole('wynagrodzenie', 'kwota', 'Wynagrodzenie ryczałtowe brutto (zł)'),
      pole('termin_platnosci', 'liczba', 'Termin zapłaty (dni od odbioru dzieła)', { domyslnie: '14' }),
      pole('rachunek', 'iban', 'Rachunek bankowy przyjmującego zamówienie', { rejestr: 'p_konto', walidacja: 'iban', wymagane: false })]),
    tresc: [
      tyt('UMOWA O DZIEŁO'),
      p('zawarta w dniu {{d_data}} w miejscowości {{d_miejscowosc}} między:'),
      p('{{z_nazwa}} z siedzibą: {{z_siedziba}}, NIP {{z_nip}}, reprezentowaną przez: {{z_reprezentant}}, zwaną dalej „Zamawiającym”,'),
      p('a Panem/Panią {{p_imie_nazwisko}}, zamieszkałym(-ą): {{p_adres}}, PESEL: {{p_pesel}}, dokument tożsamości: {{p_dokument}}, zwanym(-ą) dalej „Przyjmującym zamówienie”.'),
      par('§ 1', 'Przedmiot umowy'),
      p('1. Zamawiający zamawia, a Przyjmujący zamówienie zobowiązuje się wykonać dzieło: {{dzielo}}.'),
      p('2. Przyjmujący zamówienie wykonuje dzieło samodzielnie, bez kierownictwa Zamawiającego, sam organizuje sposób, miejsce i czas jego wykonania i odpowiada za osiągnięcie umówionego rezultatu.'),
      par('§ 2', 'Terminy'),
      p('Przyjmujący zamówienie rozpocznie wykonywanie dzieła w dniu {{termin_rozp}} i wyda ukończone dzieło Zamawiającemu do dnia {{termin_wyk}}.'),
      par('§ 3', 'Materiały'),
      p('{{materialy}}'),
      par('§ 4', 'Odbiór dzieła'),
      p('1. Zamawiający odbierze dzieło wykonane zgodnie z umową. Odbiór strony potwierdzają protokołem.'),
      p('2. Jeżeli dzieło ma wady, Zamawiający może żądać ich usunięcia, wyznaczając odpowiedni termin; do odpowiedzialności za wady dzieła stosuje się art. 636–638 Kodeksu cywilnego.'),
      par('§ 5', 'Wynagrodzenie'),
      p('1. Za wykonanie dzieła Zamawiający zapłaci Przyjmującemu zamówienie wynagrodzenie ryczałtowe w wysokości {{wynagrodzenie}} zł brutto.'),
      p('2. Wynagrodzenie jest płatne w terminie {{termin_platnosci}} dni od dnia odbioru dzieła, na podstawie rachunku wystawionego przez Przyjmującego zamówienie, przelewem na rachunek: {{rachunek}}.'),
      p('3. Zamawiający potrąci z wynagrodzenia należności publicznoprawne, do których pobrania jest zobowiązany jako płatnik.'),
      par('§ 6', 'Odstąpienie od umowy'),
      p('1. Jeżeli Przyjmujący zamówienie opóźnia się z rozpoczęciem lub wykończeniem dzieła tak dalece, że nie jest prawdopodobne, żeby zdołał je ukończyć w czasie umówionym, Zamawiający może bez wyznaczenia terminu dodatkowego od umowy odstąpić jeszcze przed upływem terminu do wykonania dzieła (art. 635 Kodeksu cywilnego).'),
      p('2. Dopóki dzieło nie zostało ukończone, Zamawiający może w każdej chwili od umowy odstąpić, płacąc umówione wynagrodzenie; może jednak odliczyć to, co Przyjmujący zamówienie oszczędził z powodu niewykonania dzieła (art. 644 Kodeksu cywilnego).'),
      par('§ 7', 'Postanowienia końcowe'),
      p('1. Zmiana umowy wymaga formy pisemnej.'),
      p('2. W sprawach nieuregulowanych stosuje się przepisy Kodeksu cywilnego o umowie o dzieło.'),
      p('3. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.'),
      sig('Przyjmujący zamówienie', 'Zamawiający'),
    ],
    uwagi: ['UMOWA O DZIEŁO TO UMOWA REZULTATU. Praca powtarzalna, pod kierownictwem, w wyznaczonym miejscu i czasie (sprzątanie, produkcja taśmowa, magazyn, opieka) NIE jest dziełem — ZUS przekwalifikuje ją na zlecenie z zaległymi składkami, a PIP może stwierdzić stosunek pracy. Przy pracownikach-cudzoziemcach biuro powinno stosować ten wzór wyjątkowo.',
      'ZUS RUD: płatnik informuje ZUS o zawarciu każdej umowy o dzieło z osobą, z którą nie pozostaje w stosunku pracy, w terminie 7 dni od zawarcia (art. 36 ust. 17 ustawy o systemie ubezpieczeń społecznych) — formularz RUD, patrz pozycja „ZUS RUD”.',
      'Jeżeli dzieło jest utworem — potrzebne postanowienia o prawach autorskich; wzór ich nie zawiera (patrz pytania otwarte).',
      'CUDZOZIEMIEC: umowa w formie pisemnej przed dopuszczeniem do pracy, wersja zrozumiała; zezwolenie / oświadczenie musi obejmować ten rodzaj umowy. Przy ochronie czasowej dane o umowie o dzieło trafiają do urzędu pracy (art. 5a ust. 9).',
      'Do umowy o dzieło nie stosuje się minimalnej stawki godzinowej (art. 8a dotyczy umów z art. 734 i 750 KC).'],
    dwujezyczny: DJ.wymagany('art. 5 ust. 2 ustawy o powierzaniu pracy cudzoziemcom', 'Jak każda umowa, na podstawie której cudzoziemiec wykonuje pracę.'),
  });

  // =====================================================================================
  //  6. CUDZOZIEMCY
  // =====================================================================================
  var G6 = 'Cudzoziemcy';
  var RODZAJ_UMOWY_CUDZ = [['praca', 'umowa o pracę', 'umowy o pracę'], ['zlecenie', 'umowa zlecenia', 'umowy zlecenia'], ['dzielo', 'umowa o dzieło', 'umowy o dzieło']];
  var POLA_CUDZ = function () { return [W('p_imie_nazwisko'), W('p_obywatelstwo'), W('p_dokument', { etykieta: 'Dokument podróży — rodzaj, seria i numer', wymagane: true })]; };

  biuro('informacja-zwiazki-zawodowe', 'Informacja o prawie wstępowania do związków zawodowych', G6, 'oba', 'zwiazki', 'praca',
    [art('art. 5 ust. 4', 'CUDZ')],
    ['OBOWIĄZKOWA dla każdego cudzoziemca na umowie o pracę i umowie cywilnoprawnej — w formie pisemnej, w języku dla niego zrozumiałym. Przechowywać jak wersję zrozumiałą umowy (art. 5 ust. 4 zd. 2).'],
    forma('pisemna', 'obie', 'Informację przekazuje się w formie pisemnej (art. 5 ust. 4 ustawy o powierzaniu pracy cudzoziemcom).', { rodzaj_podpisy: 'zwiazki_info' }),
    DJ.wymagany('art. 5 ust. 4 ustawy o powierzaniu pracy cudzoziemcom', 'W języku zrozumiałym dla cudzoziemca.'));

  dodaj({
    id: 'cudzoziemiec-oswiadczenie-zrozumiala-tresc', nazwa: 'Oświadczenie cudzoziemca o otrzymaniu treści umowy w wersji zrozumiałej', grupa: G6, dla: 'oba',
    zrodlo: { typ: 'ustawowy', elementy: 'Dowód wykonania obowiązków z art. 5 ust. 2 (przedstawienie przed podpisaniem treści umowy na piśmie w wersji zrozumiałej) i art. 5 ust. 4 (informacja o prawie wstępowania do związków zawodowych w języku zrozumiałym). Ustawa nie wymaga oświadczenia cudzoziemca — to dowód dla pracodawcy.' },
    podstawa: [art('art. 5 ust. 1–4, art. 4 ust. 6, art. 84 ust. 6', 'CUDZ')],
    forma: forma('pisemna', 'pracownik', 'Oświadczenie dowodowe; ponieważ dotyczy obowiązków wykonywanych „na piśmie”, biuro stosuje podpis własnoręczny albo kwalifikowany.', { rodzaj_podpisy: 'oswiadczenie', akta: 'B' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba')]).concat(POLA_CUDZ()).concat([
      wybor('rodzaj_umowy', 'Rodzaj umowy', RODZAJ_UMOWY_CUDZ), W('umowa_data'),
      pole('jezyk', 'tekst', 'Język wersji zrozumiałej (w dopełniaczu)', { podpowiedz: 'np. ukraińskim, rosyjskim, angielskim' }),
      wybor('sposob', 'Jak przedstawiono treść', [['dwujezyczna', 'umowa dwujęzyczna (tłumaczenie obok tekstu polskiego)', 'w postaci dwujęzycznego egzemplarza umowy, w którym obok tekstu polskiego znajduje się tłumaczenie'], ['osobne', 'osobne pisemne tłumaczenie', 'w postaci odrębnego pisemnego tłumaczenia umowy']])]),
    tresc: [
      nagl(['{{p_imie_nazwisko}}', 'obywatelstwo: {{p_obywatelstwo}}', 'dokument: {{p_dokument}}']), ADR_PRACODAWCA(),
      tyt('OŚWIADCZENIE'),
      li(['Oświadczam, że przed podpisaniem {{rodzaj_umowy}} z dnia {{umowa_data}}, zawieranej z podmiotem powierzającym mi pracę: {{z_nazwa}}, przedstawiono mi jej treść na piśmie w wersji dla mnie zrozumiałej — w języku {{jezyk}}, {{sposob}}.',
        'Zapoznałem(-am) się z tą treścią, rozumiem ją i otrzymałem(-am) jej egzemplarz.',
        'Zostałem(-am) poinformowany(-a) w formie pisemnej, w języku dla mnie zrozumiałym, o prawie wstępowania do związków zawodowych.']),
      sig(null, 'data i czytelny podpis cudzoziemca'),
    ],
    uwagi: ['Podpisać PRZED podpisaniem umowy albo razem z nią, przed dopuszczeniem do pracy. Samo oświadczenie nie zastąpi wersji zrozumiałej — tę trzeba realnie przekazać i przechowywać przez okres pracy i 2 lata od końca roku ustania umowy (art. 5 ust. 2 w zw. z art. 4 ust. 6).',
      'Brak przedstawienia wersji zrozumiałej: grzywna 1000–3000 zł (art. 84 ust. 6). Brak umowy pisemnej = nielegalne powierzenie pracy (art. 2 pkt 2 lit. f), grzywna 3000–50 000 zł (art. 84 ust. 1).',
      'Jeżeli umowa jest sporządzona w języku obcym — potrzebne tłumaczenie przysięgłe na polski (art. 5 ust. 3).',
      'Ten dokument sam MUSI być dwujęzyczny — inaczej nie ma wartości dowodowej.'],
    dwujezyczny: DJ.wymagany('art. 5 ust. 2 i 4 ustawy o powierzaniu pracy cudzoziemcom', 'Oświadczenie dotyczy zrozumienia treści — musi być sporządzone po polsku i w języku cudzoziemca.'),
  });

  dodaj({
    id: 'cudzoziemiec-zobowiazanie-dokument-pobytowy', nazwa: 'Oświadczenie i zobowiązanie cudzoziemca dotyczące dokumentu pobytowego', grupa: G6, dla: 'oba',
    zrodlo: { typ: 'ustawowy', elementy: 'Przedstawienie przed rozpoczęciem pracy ważnego dokumentu uprawniającego do pobytu (art. 4 ust. 2); prawo pracodawcy do żądania dokumentu w okresie pracy (art. 4 ust. 3); przechowywanie kopii (art. 4 ust. 4); okres przetwarzania danych (art. 4 ust. 6). Ustawa nie przewiduje „zobowiązania” — dokument porządkuje współpracę i daje dowód staranności (art. 85 pkt 1).' },
    podstawa: [art('art. 4 ust. 1–7, art. 85', 'CUDZ')],
    forma: forma('dokumentowa', 'pracownik', 'Przepisy nie wymagają szczególnej formy.', { akta: 'B' }),
    pola: MD().concat([W('z_nazwa'), W('z_siedziba')]).concat(POLA_CUDZ()).concat([
      pole('dok_pobyt', 'tekst', 'Dokument uprawniający do pobytu — rodzaj i numer', { rejestr: 'p_doc_typ', podpowiedz: 'np. karta pobytu nr …; wiza krajowa nr …; zaświadczenie / PESEL UKR' }),
      pole('dok_wazny_do', 'data', 'Dokument ważny do dnia', { rejestr: 'p_karta_do' }),
      pole('kontakt', 'tekst', 'Komu i jak zgłaszać zmiany (osoba, telefon, e-mail)')]),
    tresc: [
      nagl(['{{p_imie_nazwisko}}', 'obywatelstwo: {{p_obywatelstwo}}', 'dokument podróży: {{p_dokument}}']), ADR_PRACODAWCA(),
      tyt('OŚWIADCZENIE I ZOBOWIĄZANIE'), pod('dotyczące dokumentu uprawniającego do pobytu w Rzeczypospolitej Polskiej'),
      li(['Oświadczam, że przed rozpoczęciem pracy przedstawiłem(-am) ważny dokument uprawniający do pobytu na terytorium Rzeczypospolitej Polskiej: {{dok_pobyt}}, ważny do dnia {{dok_wazny_do}}.',
        'Przyjmuję do wiadomości, że podmiot powierzający mi pracę przechowuje kopię tego dokumentu przez cały okres wykonywania przeze mnie pracy oraz przez 2 lata, licząc od końca roku kalendarzowego, w którym umowa uległa rozwiązaniu lub wygasła, chyba że odrębne przepisy przewidują dłuższy okres przechowywania dokumentacji dotyczącej zatrudnienia.',
        'Zobowiązuję się przedstawić aktualny dokument uprawniający do pobytu na każde żądanie podmiotu powierzającego mi pracę w okresie wykonywania pracy.',
        'Zobowiązuję się niezwłocznie poinformować podmiot powierzający mi pracę o: złożeniu wniosku o udzielenie zezwolenia na pobyt, otrzymaniu decyzji w tej sprawie, wydaniu nowego dokumentu, a także o utracie, unieważnieniu lub upływie ważności dokumentu uprawniającego do pobytu. Zgłoszenia przekazuję: {{kontakt}}.']),
      sig(null, 'data i czytelny podpis cudzoziemca'),
    ],
    uwagi: ['Pracodawca MUSI zażądać ważnego dokumentu pobytowego przed rozpoczęciem pracy i przechowywać jego kopię (art. 4 ust. 2 i 4) — to warunek uniknięcia kary za powierzenie pracy osobie bez prawa pobytu (art. 85 pkt 1).',
      'Nie dotyczy cudzoziemców z art. 3 ust. 1 pkt 1–5 (m.in. członkowie rodzin obywateli UE i obywateli polskich, obywatele Szwajcarii) — art. 4 ust. 5.',
      'Daty ważności wpisać do rejestru portalu (p_karta_do / p_paszport_do / p_zezwolenie_do) — przypomnienia 60, 30, 14 i 7 dni wcześniej.'],
    dwujezyczny: DJ.zalecany('Dokument zawiera zobowiązania cudzoziemca — bez tłumaczenia jest bezwartościowy. Zalecana wersja dwujęzyczna w każdym przypadku.'),
  });

  dodaj({
    id: 'cudzoziemiec-informacja-wygasajacy-dokument', nazwa: 'Informacja dla cudzoziemca o zbliżającym się końcu ważności dokumentu pobytowego', grupa: G6, dla: 'oba',
    zrodlo: { typ: 'ustawowy', elementy: 'Prawo pracodawcy do żądania przedstawienia dokumentu pobytowego w okresie pracy (art. 4 ust. 3 ustawy o powierzaniu pracy cudzoziemcom); termin złożenia wniosku o pobyt czasowy — nie później niż w ostatnim dniu legalnego pobytu (art. 105 ust. 1 ustawy o cudzoziemcach); wniosek w postaci elektronicznej przez MOS (art. 106c ust. 1 ustawy o cudzoziemcach w brzmieniu od 27.04.2026 r.); legalność pobytu po złożeniu wniosku w terminie (art. 108 ust. 1 pkt 2).' },
    podstawa: [art('art. 4 ust. 3–4, art. 2 pkt 2 lit. a–b, art. 84 ust. 1', 'CUDZ'), art('art. 105 ust. 1, art. 106c ust. 1 i 5, art. 108 ust. 1 (w brzmieniu ustawy z 21.11.2025 r., Dz. U. poz. 1794)', 'UOC')],
    forma: forma('bez_podpisu', 'potwierdzenie', 'Pismo informacyjne; ważny jest dowód przekazania.', { rodzaj_podpisy: 'inny', akta: 'B' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'),
      pole('dok_pobyt', 'tekst', 'Dokument — rodzaj i numer', { rejestr: 'p_doc_typ' }),
      pole('dok_wazny_do', 'data', 'Ważny do dnia', { rejestr: 'p_karta_do' }),
      pole('termin_odpowiedzi', 'data', 'Prosimy o informację do dnia'),
      pole('kontakt', 'tekst', 'Kontakt (osoba, telefon, e-mail)')]),
    tresc: [
      NAGL_PRACODAWCA(), ADR_PRACOWNIK(),
      tyt('INFORMACJA'), pod('o zbliżającym się końcu ważności dokumentu pobytowego'),
      p('Informujemy, że okazany przez Pana/Panią dokument uprawniający do pobytu w Rzeczypospolitej Polskiej — {{dok_pobyt}} — traci ważność w dniu {{dok_wazny_do}}.'),
      p('Przypominamy, że:'),
      li(['wniosek o udzielenie zezwolenia na pobyt czasowy składa się nie później niż w ostatnim dniu legalnego pobytu w Polsce;',
        'wniosek składa się w postaci elektronicznej, za pośrednictwem systemu MOS; wniosek złożony w inny sposób pozostawia się bez rozpoznania;',
        'jeżeli termin został zachowany, a wniosek nie zawiera braków formalnych lub braki uzupełniono w terminie, pobyt uważa się za legalny od dnia złożenia wniosku do dnia, w którym decyzja stanie się ostateczna;',
        'bez ważnego dokumentu uprawniającego do pobytu i pracy nie możemy nadal powierzać Panu/Pani pracy.'], 'punkt'),
      p('Prosimy o przekazanie do dnia {{termin_odpowiedzi}} informacji o podjętych krokach oraz — niezwłocznie po uzyskaniu — nowego dokumentu albo potwierdzenia złożenia wniosku. Kontakt: {{kontakt}}.'),
      sig(POD_ODBIOR, POD_PRAC_IMIE),
    ],
    uwagi: ['Wysyłać z wyprzedzeniem (portal przypomina 60/30/14/7 dni przed terminem). Pismo nie zastępuje sprawdzenia, czy po złożeniu wniosku cudzoziemiec nadal ma prawo do PRACY — zależy to od podstawy pobytu i rodzaju wniosku (m.in. art. 3 ust. 1 pkt 18, art. 3 ust. 2 pkt 6, art. 21 ustawy o powierzaniu pracy cudzoziemcom).',
      'ZMIANA 2026: od 27.04.2026 r. wnioski o pobyt czasowy składa się wyłącznie elektronicznie przez MOS; załącznik pracodawcy do wniosku wypełnia i podpisuje pracodawca w MOS (kwalifikowanym podpisem elektronicznym, podpisem osobistym lub zaufanym) po otrzymaniu odnośnika e-mail (art. 106c ust. 3, art. 106d ust. 4 ustawy o cudzoziemcach).',
      'Dla osób z ochroną czasową (obywatele Ukrainy ze statusem UKR) terminy wynikają z przepisów szczególnych — tego wzoru nie stosować bez sprawdzenia aktualnego stanu (ustawa z 23.01.2026 r., Dz. U. poz. 203).',
      'Zdanie o „ostatnim dniu legalnego pobytu” dotyczy pobytu czasowego; dla pobytu stałego i rezydenta UE obowiązują odrębne przepisy (art. 202, 218a ustawy o cudzoziemcach — nie czytano dziś).'],
    dwujezyczny: DJ.zalecany('Pismo ma skłonić cudzoziemca do działania w terminie — bez tłumaczenia nie spełni celu. Zalecana wersja dwujęzyczna w każdym przypadku.'),
  });

  dodaj({
    id: 'cudzoziemiec-wezwanie-dokument-pobytowy', nazwa: 'Wezwanie cudzoziemca do przedstawienia dokumentu uprawniającego do pobytu', grupa: G6, dla: 'oba',
    zrodlo: { typ: 'ustawowy', elementy: 'Żądanie przedstawienia dokumentu uprawniającego do pobytu w okresie wykonywania pracy (art. 4 ust. 3); definicja nielegalnego powierzenia pracy (art. 2 pkt 2 lit. a–b) i sankcja (art. 84 ust. 1).' },
    podstawa: [art('art. 4 ust. 3–4, art. 2 pkt 2 lit. a–b, art. 84 ust. 1–2', 'CUDZ')],
    forma: forma('dokumentowa', 'pracodawca', 'Przepisy nie wymagają szczególnej formy; ważny jest dowód doręczenia.', { rodzaj_podpisy: 'inny', akta: 'B' }),
    pola: MD().concat(PRACODAWCA()).concat([W('p_imie_nazwisko'),
      pole('dok_pobyt', 'tekst', 'Dotychczasowy dokument — rodzaj i numer', { rejestr: 'p_doc_typ' }),
      pole('dok_wazny_do', 'data', 'Ważny do dnia', { rejestr: 'p_karta_do' }),
      pole('termin', 'data', 'Termin przedstawienia dokumentu'),
      pole('kontakt', 'tekst', 'Gdzie / komu przedstawić dokument')]),
    tresc: [
      NAGL_PRACODAWCA(), ADR_PRACOWNIK(),
      tyt('WEZWANIE'), pod('do przedstawienia dokumentu uprawniającego do pobytu'),
      p('Na podstawie art. 4 ust. 3 ustawy z dnia 20 marca 2025 r. o warunkach dopuszczalności powierzania pracy cudzoziemcom na terytorium Rzeczypospolitej Polskiej wzywam Pana/Panią do przedstawienia — najpóźniej do dnia {{termin}} — aktualnego dokumentu uprawniającego do pobytu na terytorium Rzeczypospolitej Polskiej albo potwierdzenia złożenia w terminie wniosku o udzielenie zezwolenia na pobyt.'),
      p('Dotychczas przedstawiony dokument — {{dok_pobyt}} — jest ważny do dnia {{dok_wazny_do}}.'),
      p('Dokument należy przedstawić: {{kontakt}}.'),
      p('Informuję, że powierzenie pracy cudzoziemcowi, który nielegalnie przebywa na terytorium Rzeczypospolitej Polskiej lub którego podstawa pobytu nie uprawnia do wykonywania pracy, jest nielegalnym powierzeniem pracy. W razie nieprzedstawienia dokumentu w wyznaczonym terminie nie będę mógł/mogła nadal powierzać Panu/Pani pracy.'),
      sig(POD_ODBIOR, POD_PRAC_IMIE),
    ],
    uwagi: ['Stosować, gdy informacja o wygasającym dokumencie nie przyniosła skutku albo dokument już stracił ważność.',
      'Skutki dla umowy (odsunięcie od pracy, rozwiązanie umowy) zależą od rodzaju umowy i sytuacji pobytowej — decyzję podejmuje klient po konsultacji; wzór celowo ich nie przesądza.',
      'Kary: nielegalne powierzenie pracy — grzywna 3000–50 000 zł, nie mniej niż 3000 zł za jednego cudzoziemca (art. 84 ust. 1 i 13); nielegalne wykonywanie pracy przez cudzoziemca — grzywna nie niższa niż 1000 zł (art. 84 ust. 2).'],
    dwujezyczny: DJ.zalecany('Wezwanie z terminem i skutkami — bez tłumaczenia cudzoziemiec nieznający polskiego może go nie zrozumieć. Zalecana wersja dwujęzyczna w każdym przypadku.'),
  });

  dodaj({
    id: 'pelnomocnictwo-kpa-cudzoziemiec', nazwa: 'Pełnomocnictwo cudzoziemca do reprezentowania w postępowaniu administracyjnym (pobyt / praca)', grupa: G6, dla: 'oba',
    zrodlo: { typ: 'ustawowy', elementy: 'Strona może działać przez pełnomocnika, chyba że charakter czynności wymaga jej osobistego działania (art. 32 KPA); pełnomocnikiem może być osoba fizyczna mająca zdolność do czynności prawnych (art. 33 § 1 KPA); pełnomocnictwo na piśmie (art. 33 § 2 KPA); oryginał lub urzędowo poświadczony odpis do akt (art. 33 § 3 KPA).' },
    podstawa: [art('art. 32, art. 33 § 1–3', 'KPA'), art('załącznik, część IV (17 zł od każdego stosunku pełnomocnictwa) i zwolnienia w kolumnie 4', 'OS'), art('art. 105–106d (w brzmieniu ustawy z 21.11.2025 r., Dz. U. poz. 1794)', 'UOC')],
    forma: forma('pisemna', 'pracownik', 'Pełnomocnictwo powinno być udzielone na piśmie lub zgłoszone do protokołu (art. 33 § 2 KPA).', { rodzaj_podpisy: 'inny' }),
    pola: MD().concat(POLA_CUDZ()).concat([W('p_dataur'), W('p_adres', { etykieta: 'Adres zamieszkania w Polsce' }),
      pole('pelnomocnik', 'tekst', 'Pełnomocnik — imię i nazwisko (osoba fizyczna)'),
      pole('pelnomocnik_dok', 'tekst', 'Pełnomocnik — PESEL albo rodzaj i numer dokumentu tożsamości'),
      pole('pelnomocnik_adres', 'tekst', 'Pełnomocnik — adres do doręczeń'),
      pole('organ', 'tekst', 'Organ', { podpowiedz: 'np. Wojewodą Mazowieckim' }),
      pole('sprawa', 'dlugi', 'Sprawa, której dotyczy pełnomocnictwo', { podpowiedz: 'np. udzielenia zezwolenia na pobyt czasowy i pracę' }),
      wybor('zakres', 'Zakres', [['pelny', 'wszystkie czynności w postępowaniu', 'do reprezentowania mnie we wszystkich czynnościach tego postępowania, w szczególności do: składania pism, wyjaśnień i dokumentów, wglądu w akta sprawy, sporządzania z nich notatek, kopii i odpisów, odbioru korespondencji i decyzji oraz wnoszenia środków zaskarżenia'], ['ograniczony', 'wgląd w akta i odbiór korespondencji', 'do wglądu w akta sprawy, sporządzania z nich notatek, kopii i odpisów oraz do odbioru korespondencji i decyzji']])]),
    tresc: [
      nagl(['{{p_imie_nazwisko}}', 'ur. {{p_dataur}}, obywatelstwo: {{p_obywatelstwo}}', 'dokument podróży: {{p_dokument}}', '{{p_adres}}']),
      tyt('PEŁNOMOCNICTWO'),
      p('Ja, niżej podpisany(-a) {{p_imie_nazwisko}}, na podstawie art. 32 i art. 33 Kodeksu postępowania administracyjnego udzielam pełnomocnictwa:'),
      kv([['Panu/Pani', '{{pelnomocnik}}'], ['PESEL / dokument tożsamości', '{{pelnomocnik_dok}}'], ['adres do doręczeń', '{{pelnomocnik_adres}}']]),
      p('{{zakres}} — w postępowaniu przed {{organ}} w sprawie: {{sprawa}}.'),
      p('Pełnomocnictwo nie obejmuje czynności, które ze względu na swój charakter wymagają mojego osobistego działania.'),
      sig(null, 'data i czytelny podpis mocodawcy'),
    ],
    uwagi: ['PEŁNOMOCNIKIEM MOŻE BYĆ TYLKO OSOBA FIZYCZNA (art. 33 § 1 KPA) — wpisuje się konkretnego pracownika biura, nie „TD Consulting Group”.',
      'OGRANICZENIE OD 27.04.2026 r.: wniosek o zezwolenie na pobyt czasowy cudzoziemiec składa sam, elektronicznie przez MOS, i sam go podpisuje (kwalifikowanym podpisem elektronicznym lub podpisem zaufanym — art. 106d ust. 3 ustawy o cudzoziemcach); złożenie wniosku przez pełnomocnika ustawa przewiduje tylko dla małoletnich i ubezwłasnowolnionych (art. 105 ust. 2). Pełnomocnictwo przydaje się do dalszych czynności: wgląd w akta, uzupełnianie dokumentów, odbiór korespondencji — do potwierdzenia w praktyce danego urzędu wojewódzkiego (patrz pytania otwarte).',
      'OPŁATA SKARBOWA: 17 zł od każdego stosunku pełnomocnictwa, płatna na rachunek urzędu miasta/gminy właściwego dla siedziby organu; dowód zapłaty dołącza się do akt. Zwolnione m.in. pełnomocnictwo dla małżonka, wstępnego, zstępnego lub rodzeństwa (część IV załącznika do ustawy o opłacie skarbowej; nowelizacje po t.j. z 2025 r. nie zmieniły części IV).',
      'Do akt składa się oryginał lub urzędowo poświadczony odpis (art. 33 § 3 KPA).',
      'Zezwolenia na pracę i oświadczenia składa PRACODAWCA przez praca.gov.pl — to inne pełnomocnictwo (pracodawca → biuro), poza tym wzorem.',
      'RODO: pełnomocnik uzyskuje dostęp do danych cudzoziemca — biuro powinno mieć klauzulę informacyjną także wobec cudzoziemca jako swojego mocodawcy.'],
    dwujezyczny: DJ.zalecany('Cudzoziemiec musi rozumieć, komu i do czego daje umocowanie — wersja dwujęzyczna; do urzędu składa się wersję polską.'),
  });

  link('cudzoziemiec-powiadomienia-praca-gov', 'Powiadomienia i kopia umowy w praca.gov.pl (zezwolenie, oświadczenie, ochrona czasowa)', G6, 'oba', URL.PRACA_GOV,
    'Wyłącznie elektronicznie przez system praca.gov.pl (konto pracodawcy lub pełnomocnika) — nie ma wersji papierowej. Przy awarii systemu: najpóźniej pierwszego dnia roboczego po usunięciu nieprawidłowości.',
    [art('art. 5a, art. 17 ust. 1 pkt 2, art. 18–20, art. 68 ust. 1 pkt 2, art. 70, art. 84 ust. 6–7 i 10', 'CUDZ')],
    ['LISTA KONTROLNA (każdy punkt = osobna czynność w systemie):',
      '1) KOPIA UMOWY w języku polskim — PRZED powierzeniem pracy: zezwolenie na pracę (art. 17 ust. 1 pkt 2) i oświadczenie o powierzeniu pracy (art. 68 ust. 1 pkt 2). Brak: grzywna 1000–3000 zł.',
      '2) OŚWIADCZENIE — podjęcie pracy: 7 dni od rozpoczęcia pracy; niepodjęcie: 14 dni od dnia rozpoczęcia wskazanego w ewidencji (art. 70 ust. 1). Brak: grzywna 500–5000 zł.',
      '3) OŚWIADCZENIE — cudzoziemiec nie podejmie pracy albo zakończył ją przed dniem wskazanym w oświadczeniu (art. 70 ust. 2); wpis ulega unieważnieniu.',
      '4) ZEZWOLENIE — w 7 dni: niepodjęcie pracy w ciągu 2 miesięcy od początkowej daty ważności; przerwa w pracy ponad 2 miesiące; zakończenie pracy wcześniej niż 2 miesiące przed końcem ważności (art. 19–20). Brak: grzywna nie niższa niż 500 zł.',
      '5) ZEZWOLENIE — w 7 dni: zmiana siedziby, nazwy lub formy prawnej, przejście zakładu pracy, zmiana nazwy stanowiska bez zmiany zakresu obowiązków (art. 18).',
      '6) OCHRONA CZASOWA (m.in. obywatele Ukrainy) — powiadomienie PUP o powierzeniu pracy w 7 dni od rozpoczęcia pracy (art. 5a ust. 1); ponownie w 7 dni przy zmianie rodzaju umowy, stanowiska, zmniejszeniu wymiaru lub obniżeniu stawki (art. 5a ust. 5). Brak: grzywna 1000–3000 zł.',
      'ZMIANA 2026: art. 5a dodano ustawą z 23.01.2026 r. (Dz. U. poz. 203). Ustawa z 15.05.2026 r. (Dz. U. poz. 734, od 20.06.2026 r.) zmieniła art. 17 ust. 1 pkt 2 i art. 68 ust. 1 pkt 2: umowę albo jej kopię przekazuje się przez jeden z dwóch systemów teleinformatycznych z art. 26 ust. 1 pkt 7 ustawy o rynku pracy (nowelizacja związana z systemem eUmowy; funkcje mają być udostępniane stopniowo).']);

  biuro('zalacznik-nr-1-pobyt', 'Załącznik nr 1 do wniosku o zezwolenie na pobyt czasowy (wypełnia pracodawca)', G6, 'oba', null, null, [],
    ['Portal ma osobną stronę zalacznik-pobyt.html (urzędowy formularz). UWAGA: od 27.04.2026 r. załączniki do wniosku wypełnia się elektronicznie w MOS — sprawdzić, czy papierowy załącznik jest jeszcze potrzebny (patrz pytania otwarte).'],
    forma('pisemna', 'pracodawca', 'Formularz urzędowy.', { rodzaj_podpisy: 'inny' }), DJ.nie('Formularz urzędowy po polsku.'), 'Istniejąca strona portalu: zalacznik-pobyt.html / zalacznik-pobyt.js.');

  // =====================================================================================
  //  7. PEŁNOMOCNICTWA I FORMULARZE URZĘDOWE (tylko odsyłacze)
  // =====================================================================================
  var G7 = 'Pełnomocnictwa i inne';

  link('zus-pel', 'ZUS PEL — pełnomocnictwo do reprezentowania płatnika przed ZUS', G7, 'oba', URL.ZUS_PEL,
    'Urzędowy formularz ZUS. Złożyć elektronicznie na profilu płatnika w PUE/eZUS albo papierowo w placówce ZUS; podpisuje mocodawca (płatnik). Dostęp do profilu płatnika na PUE wymaga wskazania zakresu w formularzu.', [],
    ['Nie odtwarzać formularza w portalu. Na tej samej stronie ZUS są: PEL-Z (załącznik), PEL-O (odwołanie), PEL-K (kontrola).', 'Opłata skarbowa i jej zwolnienia — sprawdzić przy składaniu (nie analizowano dziś dla postępowań przed ZUS).']);

  link('upl-1', 'UPL-1 — pełnomocnictwo do podpisywania deklaracji składanych elektronicznie', G7, 'oba', URL.UPL,
    'Urzędowy formularz MF. Złożyć elektronicznie (e-Urząd Skarbowy) albo papierowo w urzędzie skarbowym mocodawcy; odwołanie — OPL-1.', [],
    ['Nie odtwarzać formularza w portalu. Pełnomocnictwo do podpisywania deklaracji składanych elektronicznie jest zwolnione z opłaty skarbowej (część IV załącznika do ustawy o opłacie skarbowej, kolumna 4 pkt 5).',
      'Portal ma stronę pelnomocnictwo.html — to INNY dokument: uchwała o ustanowieniu pełnomocnika spółki, nie UPL-1.']);

  link('zus-rud', 'ZUS RUD — zgłoszenie umowy o dzieło', G5, 'zleceniobiorca', URL.ZUS_FORMULARZE,
    'Urzędowy formularz ZUS składany przez płatnika elektronicznie (PUE/eZUS) w terminie 7 dni od zawarcia umowy o dzieło.',
    [art('art. 36 ust. 17', 'SUS')], ['Dotyczy umów o dzieło z osobami, z którymi płatnik nie pozostaje w stosunku pracy.']);

  link('pit-2-formularz', 'PIT-2 — aktualny formularz na stronie Ministerstwa Finansów', 'Wynagrodzenia i podatki', 'oba', URL.PIT_FORMULARZE,
    'Formularz PIT-2(9) do pobrania ze strony MF (sekcja PIT-2). Pracownik składa go płatnikowi; nie wysyła się go do urzędu skarbowego.', [],
    ['W komplecie portal wypełnia oryginalny druk (pit-2-template.pdf). Po zmianie wersji formularza trzeba podmienić szablon.']);

  link('ppk-formularze', 'PPK — pozostałe wnioski uczestnika (wypłata, zwrot, transfer, zmiana wpłat)', 'Wynagrodzenia i podatki', 'oba', URL.MOJEPPK,
    'Wnioski składa się w instytucji finansowej prowadzącej PPK (często przez jej serwis internetowy) albo — deklaracje dotyczące wysokości wpłat — pracodawcy, na drukach tej instytucji.', [art('art. 23', 'PPK')],
    ['Urzędowy wzór ma tylko deklaracja o rezygnacji (jest w komplecie). Pozostałe druki są drukami instytucji finansowych — nie odtwarzać.']);

  // =====================================================================================
  //  POMINIĘTE — z powodem (nie trafiają do generatora)
  // =====================================================================================
  var POMINIETE = [
    { id: 'rachunek-do-umowy-zlecenia', nazwa: 'Rachunek do umowy zlecenia / o dzieło', powod: 'To dokument rozliczeniowy: wymaga naliczenia składek ZUS, kosztów uzyskania i zaliczki na podatek według danych płacowych — należy do modułu płacowego (wynagrodzenie.html), nie do katalogu treści. Przepisów podatkowych o rachunkach dziś nie czytano.' },
    { id: 'umowa-o-wspolodpowiedzialnosci-materialnej', nazwa: 'Umowa o współodpowiedzialności materialnej', powod: 'Wymaga stosowania rozporządzenia Rady Ministrów wydanego na podstawie art. 126 KP (zasady łącznego powierzania mienia, inwentaryzacje, udziały) — rozporządzenia dziś nie czytano; błędna umowa jest nieważna (art. 125 § 1 KP).' },
    { id: 'wnioski-macierzynskie-szczegolne', nazwa: 'Wnioski dotyczące urlopu macierzyńskiego i sytuacji szczególnych (§ 2–14, 16, 18, 20 rozporządzenia)', powod: 'Kilkanaście rzadkich wariantów (rezygnacja z części urlopu, przejęcie przez ojca, hospitalizacja, zgon, porzucenie dziecka, łączenie urlopu z pracą, obniżenie wymiaru czasu pracy), każdy z własną listą obowiązkowych oświadczeń i załączników. Do zrobienia osobno, po decyzji właściciela.' },
    { id: 'regulamin-pracy-zdalnej', nazwa: 'Regulamin pracy zdalnej / porozumienie ze związkami', powod: 'Akt wewnątrzzakładowy wymagający konsultacji z przedstawicielami pracowników i dopasowania do firmy (art. 67²⁰ § 1–4 KP) — nie jest pojedynczym dokumentem pracownika.' },
    { id: 'polecenie-pracy-zdalnej', nazwa: 'Polecenie wykonywania pracy zdalnej (art. 67¹⁹ § 3 KP)', powod: 'Dopuszczalne tylko w stanie nadzwyczajnym, zagrożenia epidemicznego, epidemii lub przy sile wyższej uniemożliwiającej zapewnienie BHP — sytuacja wyjątkowa; wzór przygotować, gdy wystąpi.' },
    { id: 'zgoda-rodo-dodatkowe-dane', nazwa: 'Zgoda na przetwarzanie dodatkowych danych osobowych (art. 22¹a–22¹b KP)', powod: 'Zgoda musi być konkretna dla celu i zakresu danych (np. wizerunek, prywatny telefon) i nie może być warunkiem zatrudnienia; wzór ogólny byłby wadliwy. Komplet zawiera klauzulę informacyjną; zgody szczegółowe przygotować po ustaleniu, o jakie dane chodzi.' },
    { id: 'oswiadczenie-ocena-ryzyka', nazwa: 'Osobne oświadczenie o zapoznaniu się z oceną ryzyka zawodowego', powod: 'Jest już częścią dokumentu kompletu „Oświadczenie BHP” (bhp) — nie dublować.' },
    { id: 'wniosek-czas-wolny-za-nadgodziny', nazwa: 'Wniosek o czas wolny za nadgodziny (art. 151² § 1 KP)', powod: 'Prosty wniosek — do dodania razem z modułem ewidencji czasu pracy, który policzy wymiar.' },
    { id: 'umowa-uzyczenia-najmu-kwatery', nazwa: 'Umowa najmu / użyczenia kwatery dla cudzoziemca (praca sezonowa)', powod: 'Wymagana odrębna pisemna umowa z tłumaczeniem i zakazem potrącania czynszu z wynagrodzenia (art. 59 ustawy o powierzaniu pracy cudzoziemcom) — to umowa najmu, wymaga analizy przepisów o najmie; do decyzji właściciela.' },
    { id: 'zawiadomienie-pip-umowa-terminowa', nazwa: 'Zawiadomienie okręgowego inspektora pracy o umowie na czas określony z przyczyn obiektywnych (art. 25¹ § 5 KP)', powod: 'Składane do PIP w formie pisemnej lub elektronicznej w 5 dni roboczych; PIP udostępnia własny formularz — sprawdzić aktualny druk na pip.gov.pl przed dodaniem odsyłacza.' },
  ];

  // =====================================================================================
  //  SILNIK: warunki, podstawianie pól, render do bloków i do zwykłego tekstu
  // =====================================================================================
  var KROPKI = '........................................';
  var MIESIACE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

  function pusty(v) { return v === undefined || v === null || String(v).trim() === ''; }
  function get(id) { for (var i = 0; i < WZORY.length; i++) if (WZORY[i].id === id) return WZORY[i]; return null; }
  function poleDok(doc, id) { for (var i = 0; i < doc.pola.length; i++) if (doc.pola[i].id === id) return doc.pola[i]; return null; }

  function dataPL(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (!m) return String(iso);
    return parseInt(m[3], 10) + ' ' + MIESIACE[parseInt(m[2], 10) - 1] + ' ' + m[1] + ' r.';
  }
  function kwotaPL(v) {
    var n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    if (!isFinite(n)) return String(v);
    var s = n.toFixed(2).split('.');
    return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + s[1];
  }

  // warunek widoczności bloku / pozycji
  function spelnia(gdy, dane) {
    if (!gdy) return true;
    if (Array.isArray(gdy)) return gdy.every(function (g) { return spelnia(g, dane); });
    if (gdy.nie) return !spelnia(gdy.nie, dane);
    if (gdy.lub) return gdy.lub.some(function (g) { return spelnia(g, dane); });
    var v = dane[gdy.pole];
    if (gdy.niepuste) return !pusty(v);
    if (gdy.puste) return pusty(v);
    if ('rowne' in gdy) return String(v === undefined ? '' : v) === String(gdy.rowne);
    if (gdy.w) return gdy.w.indexOf(v) !== -1;
    return true;
  }

  // wartość pola w postaci do wstawienia w tekst
  function wartosc(doc, id, dane, glebia) {
    var pl = poleDok(doc, id), v = dane[id];
    if (!pl) return '{{' + id + '}}';
    if (pusty(v)) return pl.gdy_puste !== undefined ? pl.gdy_puste : KROPKI;
    if (pl.typ === 'data') return dataPL(v);
    if (pl.typ === 'kwota') return kwotaPL(v);
    if (pl.typ === 'wybor') {
      for (var i = 0; i < pl.opcje.length; i++) {
        if (pl.opcje[i].v === v) {
          var t = pl.opcje[i].tekst !== undefined ? pl.opcje[i].tekst : pl.opcje[i].etykieta;
          return (glebia || 0) < 3 ? podstaw(doc, t, dane, (glebia || 0) + 1) : t;
        }
      }
      return KROPKI;
    }
    return String(v);
  }
  function podstaw(doc, tekst, dane, glebia) {
    // data kończy się na „r.” — nie dublować kropki, gdy pole stoi na końcu zdania
    return String(tekst).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (_, id) { return wartosc(doc, id, dane, glebia); }).replace(/ r\.\.(?!\.)/g, ' r.');
  }

  // wszystkie {{pola}} użyte w treści dokumentu (także w tekstach opcji wyboru)
  function placeholdery(doc) {
    var out = {};
    function skan(x) {
      if (typeof x === 'string') { x.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (_, id) { out[id] = true; return ''; }); return; }
      if (Array.isArray(x)) { x.forEach(skan); return; }
      if (x && typeof x === 'object') Object.keys(x).forEach(function (k) { if (k !== 'gdy' && k !== 't') skan(x[k]); });
    }
    skan(doc.tresc);
    doc.pola.forEach(function (pl) { if (pl.opcje) pl.opcje.forEach(function (o) { if (o.tekst) skan(o.tekst); }); });
    return Object.keys(out);
  }
  // pola przywołane w warunkach
  function polaWarunkow(doc) {
    var out = {};
    function g(w) { if (!w) return; if (Array.isArray(w)) return w.forEach(g); if (w.nie) return g(w.nie); if (w.lub) return w.lub.forEach(g); if (w.pole) out[w.pole] = true; }
    function skan(x) { if (Array.isArray(x)) return x.forEach(skan); if (x && typeof x === 'object') { if (x.gdy) g(x.gdy); Object.keys(x).forEach(function (k) { if (k !== 'gdy') skan(x[k]); }); } }
    skan(doc.tresc);
    doc.pola.forEach(function (pl) { g(pl.wymagane_gdy); });
    return Object.keys(out);
  }

  // dane domyślne: wartości `domyslnie` ('dzis' = dzisiejsza data)
  function domyslne(doc, dzis) {
    var d = {};
    doc.pola.forEach(function (pl) {
      if (pl.domyslnie === undefined) return;
      d[pl.id] = pl.domyslnie === 'dzis' ? (dzis || new Date().toISOString().slice(0, 10)) : pl.domyslnie;
    });
    return d;
  }

  // wstępne wypełnienie z payload zgłoszenia w rejestrze (zatrudnienie_zgloszenia.payload)
  function zRejestru(doc, payload) {
    var d = {}; payload = payload || {};
    doc.pola.forEach(function (pl) {
      var r = pl.rejestr, v = '';
      if (!r) return;
      if (typeof r === 'string') v = payload[r];
      else if (r.lacz) v = r.lacz.map(function (k) { return payload[k]; }).filter(function (x) { return !pusty(x); }).join(r.sep || ' ');
      else if (r.adres) {
        var a = r.adres, ul = [payload[a + '_ulica'], payload[a + '_nrdom']].filter(function (x) { return !pusty(x); }).join(' ');
        if (!pusty(payload[a + '_nrmiesz'])) ul += '/' + payload[a + '_nrmiesz'];
        var m = [payload[a + '_kod'], payload[a + '_miejscowosc']].filter(function (x) { return !pusty(x); }).join(' ');
        v = [ul, m].filter(function (x) { return !pusty(x); }).join(', ');
      }
      if (!pusty(v)) d[pl.id] = String(v).trim();
    });
    return d;
  }

  // ---------------- walidacja ----------------
  function okPesel(s) {
    if (!/^\d{11}$/.test(s)) return false;
    var w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3], sum = 0;
    for (var i = 0; i < 10; i++) sum += w[i] * parseInt(s[i], 10);
    return (10 - (sum % 10)) % 10 === parseInt(s[10], 10);
  }
  function okNip(s) {
    s = String(s).replace(/[\s-]/g, '');
    if (!/^\d{10}$/.test(s)) return false;
    var w = [6, 5, 7, 2, 3, 4, 5, 6, 7], sum = 0;
    for (var i = 0; i < 9; i++) sum += w[i] * parseInt(s[i], 10);
    return sum % 11 === parseInt(s[9], 10);
  }
  function okRegon(s) { return /^(\d{9}|\d{14})$/.test(String(s).replace(/[\s-]/g, '')); }
  function okIban(s) { s = String(s).replace(/\s/g, '').replace(/^PL/i, ''); return /^\d{26}$/.test(s); }
  function waliduj(doc, dane) {
    var bledy = [];
    doc.pola.forEach(function (pl) {
      var v = dane[pl.id], wym = pl.wymagane || (pl.wymagane_gdy && spelnia(pl.wymagane_gdy, dane));
      if (pusty(v)) { if (wym) bledy.push({ pole: pl.id, blad: 'Pole wymagane: ' + pl.etykieta }); return; }
      v = String(v);
      if (pl.typ === 'data' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) bledy.push({ pole: pl.id, blad: 'Data w formacie RRRR-MM-DD: ' + pl.etykieta });
      if (pl.typ === 'wybor' && !pl.opcje.some(function (o) { return o.v === v; })) bledy.push({ pole: pl.id, blad: 'Niedozwolona wartość: ' + pl.etykieta });
      if ((pl.typ === 'kwota' || pl.typ === 'liczba') && !isFinite(Number(v.replace(/\s/g, '').replace(',', '.')))) bledy.push({ pole: pl.id, blad: 'Wymagana liczba: ' + pl.etykieta });
      var wal = pl.walidacja || '';
      if (wal === 'pesel' && !okPesel(v)) bledy.push({ pole: pl.id, blad: 'Nieprawidłowy PESEL' });
      if (wal === 'nip' && !okNip(v)) bledy.push({ pole: pl.id, blad: 'Nieprawidłowy NIP' });
      if (wal === 'regon' && !okRegon(v)) bledy.push({ pole: pl.id, blad: 'Nieprawidłowy REGON' });
      if (wal === 'iban' && !okIban(v)) bledy.push({ pole: pl.id, blad: 'Numer rachunku musi mieć 26 cyfr' });
      var m = /^liczba>=(\d+)$/.exec(wal);
      if (m && !(Number(v.replace(',', '.')) >= Number(m[1]))) bledy.push({ pole: pl.id, blad: pl.etykieta + ' — wartość nie mniejsza niż ' + m[1] });
    });
    return bledy;
  }

  // ---------------- render ----------------
  // Zwraca bloki z podstawionymi wartościami (bez bloków i pozycji ukrytych warunkiem) oraz zwykły tekst.
  function render(id, dane) {
    var doc = typeof id === 'string' ? get(id) : id;
    if (!doc) throw new Error('Nieznany dokument: ' + id);
    dane = dane || {};
    var s = function (t) { return podstaw(doc, t, dane, 0); };
    var poz = function (lista) {
      return (lista || []).filter(function (x) { return typeof x === 'string' || spelnia(x.gdy, dane); }).map(function (x) { return s(typeof x === 'string' ? x : x.tekst); });
    };
    var bloki = [];
    doc.tresc.forEach(function (b) {
      if (!spelnia(b.gdy, dane)) return;
      var o = { t: b.t };
      if (b.styl) o.styl = b.styl;
      if (b.t === 'naglowek') { o.lewo = b.lewo.map(s); o.prawo = s(b.prawo); }
      else if (b.t === 'tytul' || b.t === 'podtytul' || b.t === 'p' || b.t === 'przypis') o.tekst = s(b.tekst);
      else if (b.t === 'adresat') o.linie = b.linie.map(s);
      else if (b.t === 'paragraf') { o.nr = b.nr; if (b.tytul) o.tytul = s(b.tytul); }
      else if (b.t === 'lista') { o.typ = b.typ; o.pozycje = poz(b.pozycje); }
      else if (b.t === 'pola') o.wiersze = b.wiersze.map(function (w) { return [s(w[0]), s(w[1])]; });
      else if (b.t === 'tabela') { o.kolumny = b.kolumny.map(s); o.wiersze = (b.wiersze || []).map(function (w) { return w.map(s); }); o.puste_wiersze = b.puste_wiersze || 0; }
      else if (b.t === 'podpisy') { o.lewy = b.lewy ? s(b.lewy) : null; o.prawy = b.prawy ? s(b.prawy) : null; }
      else if (b.t === 'pouczenie') { o.tytul = s(b.tytul); o.akapity = poz(b.akapity); }
      bloki.push(o);
    });
    return { id: doc.id, nazwa: doc.nazwa, bloki: bloki, tekst: naTekst(bloki), bledy: waliduj(doc, dane) };
  }

  var LIT = 'abcdefghijklmnoprstuwz';
  function naTekst(bloki) {
    var L = [];
    bloki.forEach(function (b) {
      if (b.t === 'naglowek') { b.lewo.forEach(function (x) { L.push(x); }); if (b.prawo) L.push(b.prawo); L.push(''); }
      else if (b.t === 'tytul') { L.push(''); L.push(b.tekst); }
      else if (b.t === 'podtytul') L.push(b.tekst);
      else if (b.t === 'adresat') { L.push(''); b.linie.forEach(function (x) { L.push(x); }); L.push(''); }
      else if (b.t === 'paragraf') { L.push(''); L.push(b.nr + (b.tytul ? ' ' + b.tytul : '')); }
      else if (b.t === 'p') L.push(b.tekst);
      else if (b.t === 'przypis') L.push(b.tekst);
      else if (b.t === 'lista') b.pozycje.forEach(function (x, i) { L.push((b.typ === 'punkt' ? '–' : b.typ === 'lit' ? LIT[i] + ')' : (i + 1) + ')') + ' ' + x); });
      else if (b.t === 'pola') b.wiersze.forEach(function (w) { L.push(w[0] + ': ' + w[1]); });
      else if (b.t === 'tabela') {
        L.push(b.kolumny.join(' | '));
        b.wiersze.forEach(function (w) { L.push(w.join(' | ')); });
        if (b.puste_wiersze) L.push('(' + b.puste_wiersze + ' wierszy do wypełnienia)');
      }
      else if (b.t === 'podpisy') { L.push(''); if (b.lewy) L.push(KROPKI + ' (' + b.lewy + ')'); if (b.prawy) L.push(KROPKI + ' (' + b.prawy + ')'); }
      else if (b.t === 'pouczenie') { L.push(''); L.push(b.tytul); b.akapity.forEach(function (x) { L.push(x); }); }
    });
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------------- dane przykładowe (fikcyjne) ----------------
  var PRZYKLAD_STALE = {
    z_nazwa: 'Przykładowa Firma Testowa Sp. z o.o.', z_siedziba: 'ul. Przykładowa 1/2, 00-000 Warszawa', z_nip: '0000000000', z_regon: '000000000',
    z_reprezentant: 'Anna Przykładowa — Prezes Zarządu', p_imie_nazwisko: 'Jan Testowy', p_pesel: '', p_dataur: '1990-01-01', p_dokument: 'paszport AA0000000',
    p_obywatelstwo: 'ukraińskie', p_adres: 'ul. Testowa 3/4, 00-000 Warszawa', p_stanowisko: 'pracownik magazynu', d_miejscowosc: 'Warszawa', d_data: '2026-10-09', umowa_data: '2026-01-02',
  };
  function przyklad(doc, wybory) {
    var d = {}; wybory = wybory || {};
    doc.pola.forEach(function (pl) {
      if (PRZYKLAD_STALE[pl.id] !== undefined && pl.id !== 'p_pesel') { d[pl.id] = PRZYKLAD_STALE[pl.id]; return; }
      if (pl.typ === 'wybor') d[pl.id] = wybory[pl.id] !== undefined ? wybory[pl.id] : pl.opcje[0].v;
      else if (pl.typ === 'data') d[pl.id] = '2026-10-09';
      else if (pl.typ === 'kwota') d[pl.id] = '1234.5';
      else if (pl.typ === 'liczba') d[pl.id] = pl.domyslnie || (/liczba>=25/.test(pl.walidacja || '') ? '25' : '3');
      else if (pl.typ === 'iban') d[pl.id] = '00 0000 0000 0000 0000 0000 0000';
      else if (pl.typ === 'pesel') d[pl.id] = '';
      else if (pl.typ === 'nip') d[pl.id] = '0000000000';
      else if (pl.typ === 'regon') d[pl.id] = '000000000';
      else if (pl.typ === 'email') d[pl.id] = 'jan.testowy@example.com';
      else d[pl.id] = 'przykład (' + pl.etykieta.split(' — ')[0].split(' (')[0].toLowerCase() + ')';
    });
    return d;
  }

  // ---------------- zestawienia ----------------
  function lista(filtr) {
    return WZORY.filter(function (d) {
      if (!filtr) return true;
      if (filtr.grupa && d.grupa !== filtr.grupa) return false;
      if (filtr.zrodlo && d.zrodlo.typ !== filtr.zrodlo) return false;
      if (filtr.dla && d.dla !== filtr.dla && d.dla !== 'oba') return false;
      return true;
    });
  }
  // dokumenty, które generator pojedynczych dokumentów rysuje sam (mają treść)
  function generowane() { return WZORY.filter(function (d) { return d.tresc.length > 0; }); }
  // forma wymagana dla danej osoby (cudzoziemiec może mieć ostrzejszą)
  function formaDla(doc, cudzoziemiec) {
    var f = doc.forma;
    if (cudzoziemiec && f.cudzoziemiec && f.cudzoziemiec !== f.kategoria) {
      var c = {}; for (var k in f) c[k] = f[k];
      c.kategoria = f.cudzoziemiec; c.metody = METODY[f.cudzoziemiec].slice();
      return c;
    }
    return f;
  }

  return {
    wersja: '1.0.0', stan_prawny: STAN_PRAWNY,
    AKTY: AKTY, GRUPY: GRUPY, URL: URL, BLOKI: BLOKI, METODY_FORMY: METODY,
    wzory: WZORY, pominiete: POMINIETE,
    get: get, lista: lista, generowane: generowane, formaDla: formaDla,
    placeholdery: placeholdery, polaWarunkow: polaWarunkow,
    domyslne: domyslne, zRejestru: zRejestru, przyklad: przyklad,
    waliduj: waliduj, spelnia: spelnia, render: render, naTekst: naTekst,
    dataPL: dataPL, kwotaPL: kwotaPL,
  };
});
