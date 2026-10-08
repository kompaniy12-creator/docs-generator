/* Statutory tax / ZUS / reporting deadlines for the Księgowość module.
   Pure data + logic, no dependencies; works in the browser (window.KsiegTerminy) and in node.
   Every rule below was read in the consolidated text of its act (ELI register) on 2026-10-08;
   the same rules are recorded in portal_wiedza (supabase/migrations/portal_wiedza_ksiegowosc.sql).
   `eli` is the id of the original act, as in portal_prawo_akty, so prawo-monitor can watch it.
   Dates are plain 'YYYY-MM-DD' strings; month numbers are 1–12.
   Annual deadlines assume a tax / financial year equal to the calendar year. */
(function (root) {
  'use strict';

  var OP = 'DU/1997/926', VAT = 'DU/2004/535', PIT = 'DU/1991/350', CIT = 'DU/1992/86', RYCZ = 'DU/1998/930',
    RACH = 'DU/1994/591', SUS = 'DU/1998/887', REHAB = 'DU/1997/776', DNI = 'DU/1951/28';

  // why a deadline moves: tax law directly, contributions and PFRON by reference to the same article
  var PRZESUNIECIE = {
    podstawa: 'art. 12 § 5 Ordynacji podatkowej; do składek ZUS — art. 31 ustawy o systemie ubezpieczeń społecznych; do wpłat na PFRON — art. 49 ust. 1 ustawy o rehabilitacji',
    eli: OP,
    dniWolne: 'art. 1 ustawy z 18.01.1951 r. o dniach wolnych od pracy',
    dniWolneEli: DNI
  };

  var GRUPY = ['VAT', 'PIT', 'CIT', 'ZUS', 'Sprawozdania', 'PFRON'];

  /* rytm: 'm'   — every month, for the previous month
           'k'   — January, April, July, October, for the previous quarter
           'k12' — the month after the 1st and 2nd month of a quarter (JPK_V7K records)
           'r'   — once a year in `miesiac`, for the previous year
     dzien: day of the month, or 'ost' for its last day
     przesuwany: false when art. 12 § 5 Ordynacji does not apply (deadlines of ustawa o rachunkowości)
     kto: tags that must all hold for a client (see profil()) */
  var OBOWIAZKI = [
    // ---- VAT ----
    { id: 'jpk-v7m', grupa: 'VAT', nazwa: 'JPK_V7M — deklaracja VAT z ewidencją', rytm: 'm', dzien: 25, kto: ['vat-m'],
      opis: 'Podatnik VAT rozliczający się miesięcznie przesyła jeden dokument elektroniczny: deklarację i ewidencję za poprzedni miesiąc.',
      podstawa: 'art. 99 ust. 1 i 11c oraz art. 109 ust. 3b ustawy o VAT', eli: VAT },
    { id: 'vat-wplata-m', grupa: 'VAT', nazwa: 'VAT — wpłata podatku za miesiąc', rytm: 'm', dzien: 25, kto: ['vat-m'],
      opis: 'Wpłata podatku za okres miesięczny na rachunek urzędu skarbowego (mikrorachunek podatkowy), bez wezwania.',
      podstawa: 'art. 103 ust. 1 ustawy o VAT', eli: VAT },
    { id: 'jpk-v7k-ewid', grupa: 'VAT', nazwa: 'JPK_V7K — ewidencja za miesiąc (bez deklaracji)', rytm: 'k12', dzien: 25, kto: ['vat-k'],
      opis: 'Podatnik rozliczający VAT kwartalnie przesyła samą ewidencję za pierwszy i za drugi miesiąc kwartału.',
      podstawa: 'art. 109 ust. 3c pkt 1 ustawy o VAT', eli: VAT },
    { id: 'jpk-v7k', grupa: 'VAT', nazwa: 'JPK_V7K — deklaracja kwartalna z ewidencją za ostatni miesiąc', rytm: 'k', dzien: 25, kto: ['vat-k'],
      opis: 'Mały podatnik rozliczający się kwartalnie: deklaracja za kwartał łącznie z ewidencją za ostatni miesiąc kwartału.',
      podstawa: 'art. 99 ust. 2 i 3 oraz art. 109 ust. 3c pkt 2 ustawy o VAT', eli: VAT },
    { id: 'vat-wplata-k', grupa: 'VAT', nazwa: 'VAT — wpłata podatku za kwartał', rytm: 'k', dzien: 25, kto: ['vat-k'],
      opis: 'Wpłata podatku za okres kwartalny przez podatników składających deklaracje kwartalne.',
      podstawa: 'art. 103 ust. 2 ustawy o VAT', eli: VAT },
    { id: 'vat-ue', grupa: 'VAT', nazwa: 'VAT-UE — informacja podsumowująca', rytm: 'm', dzien: 25, kto: ['vat-ue'],
      opis: 'Podatnik zarejestrowany jako VAT UE składa informację za miesiąc, w którym powstał obowiązek podatkowy z tytułu WDT, WNT lub usług z art. 28b (albo przemieszczono towary w procedurze call-off stock). Składa się ją tylko za miesiące, w których były takie transakcje.',
      podstawa: 'art. 100 ust. 1 i 3 ustawy o VAT', eli: VAT },

    // ---- PIT: płatnik ----
    { id: 'pit4-wplata', grupa: 'PIT', nazwa: 'PIT-4R — wpłata zaliczek pobranych przez płatnika', rytm: 'm', dzien: 20, kto: ['platnik'],
      opis: 'Zaliczki pobrane od wynagrodzeń pracowników, zleceniobiorców i innych wypłat płatnik przekazuje do urzędu skarbowego za miesiąc, w którym je pobrał.',
      podstawa: 'art. 38 ust. 1 i art. 42 ust. 1 ustawy o PIT', eli: PIT },
    { id: 'pit8ar-wplata', grupa: 'PIT', nazwa: 'PIT-8AR — wpłata zryczałtowanego podatku pobranego przez płatnika', rytm: 'm', dzien: 20, kto: ['platnik-ryczalt'],
      opis: 'Zryczałtowany podatek pobrany m.in. od dywidend, małych umów zlecenia i należności nierezydentów — za miesiąc, w którym go pobrano.',
      podstawa: 'art. 42 ust. 1 ustawy o PIT', eli: PIT },

    // ---- PIT: przedsiębiorca ----
    { id: 'pit-zal-m', grupa: 'PIT', nazwa: 'PIT — zaliczka miesięczna przedsiębiorcy (skala / liniowy)', rytm: 'm', dzien: 20, kto: ['pit-ogolne', 'zal-m'],
      opis: 'Zaliczka od dochodu z działalności gospodarczej opodatkowanej według skali albo podatkiem liniowym. Zaliczkę za grudzień wpłaca się do 20 stycznia następnego roku.',
      podstawa: 'art. 44 ust. 3, 3f i 6 ustawy o PIT', eli: PIT },
    { id: 'pit-zal-k', grupa: 'PIT', nazwa: 'PIT — zaliczka kwartalna przedsiębiorcy (skala / liniowy)', rytm: 'k', dzien: 20, kto: ['pit-ogolne', 'zal-k'],
      opis: 'Zaliczki kwartalne mogą wpłacać mali podatnicy i rozpoczynający działalność. Zaliczkę za ostatni kwartał wpłaca się do 20 stycznia następnego roku.',
      podstawa: 'art. 44 ust. 3g, 3h i 6 ustawy o PIT', eli: PIT },
    { id: 'ryczalt-m', grupa: 'PIT', nazwa: 'Ryczałt od przychodów ewidencjonowanych — wpłata za miesiąc', rytm: 'm', dzien: 20, kto: ['ryczalt', 'zal-m'],
      opis: 'Ryczałt za każdy miesiąc; za grudzień — do 20 stycznia następnego roku podatkowego.',
      podstawa: 'art. 21 ust. 1 ustawy o zryczałtowanym podatku dochodowym', eli: RYCZ },
    { id: 'ryczalt-k', grupa: 'PIT', nazwa: 'Ryczałt od przychodów ewidencjonowanych — wpłata za kwartał', rytm: 'k', dzien: 20, kto: ['ryczalt', 'zal-k'],
      opis: 'Kwartalnie mogą płacić rozpoczynający działalność oraz podatnicy, których przychody w poprzednim roku nie przekroczyły równowartości 200 000 euro. Za ostatni kwartał — do 20 stycznia.',
      podstawa: 'art. 21 ust. 1a i 1b ustawy o zryczałtowanym podatku dochodowym', eli: RYCZ },

    // ---- CIT ----
    { id: 'cit-zal-m', grupa: 'CIT', nazwa: 'CIT — zaliczka miesięczna', rytm: 'm', dzien: 20, kto: ['cit-klasyczny', 'zal-m'],
      opis: 'Zaliczka za poprzedni miesiąc. Zaliczki za ostatni miesiąc roku nie wpłaca się, jeżeli przed 20. dniem pierwszego miesiąca następnego roku podatnik złoży zeznanie i zapłaci podatek.',
      podstawa: 'art. 25 ust. 1 i 1a ustawy o CIT', eli: CIT },
    { id: 'cit-zal-k', grupa: 'CIT', nazwa: 'CIT — zaliczka kwartalna', rytm: 'k', dzien: 20, kto: ['cit-klasyczny', 'zal-k'],
      opis: 'Zaliczki kwartalne mogą wpłacać mali podatnicy oraz rozpoczynający działalność w pierwszym roku podatkowym.',
      podstawa: 'art. 25 ust. 1b i 1c ustawy o CIT', eli: CIT },
    { id: 'cit-wht', grupa: 'CIT', nazwa: 'CIT — podatek u źródła pobrany przez płatnika', rytm: 'm', dzien: 7, kto: ['wht'],
      opis: 'Płatnik, który pobrał zryczałtowany podatek od wypłat (np. dywidendy, odsetki, należności licencyjne, usługi niematerialne nierezydentów), przekazuje go za miesiąc, w którym podatek pobrano.',
      podstawa: 'art. 26 ust. 3 ustawy o CIT', eli: CIT },

    // ---- ZUS ----
    { id: 'zus-5', grupa: 'ZUS', nazwa: 'ZUS — składki i DRA: jednostki budżetowe', rytm: 'm', dzien: 5, kto: ['zus-budzet', 'platnik-zus'],
      opis: 'Jednostki budżetowe i samorządowe zakłady budżetowe: deklaracja rozliczeniowa, raporty imienne i wpłata składek za poprzedni miesiąc.',
      podstawa: 'art. 47 ust. 1 pkt 2 ustawy o systemie ubezpieczeń społecznych', eli: SUS },
    { id: 'zus-15', grupa: 'ZUS', nazwa: 'ZUS — składki i DRA: płatnicy z osobowością prawną', rytm: 'm', dzien: 15, kto: ['zus-prawna', 'platnik-zus'],
      opis: 'Płatnicy posiadający osobowość prawną (np. spółka z o.o., spółka akcyjna, fundacja): deklaracja rozliczeniowa, raporty imienne i wpłata składek za poprzedni miesiąc — jedną wpłatą na numer rachunku składkowego.',
      podstawa: 'art. 47 ust. 1 pkt 3 i ust. 4 ustawy o systemie ubezpieczeń społecznych', eli: SUS },
    { id: 'zus-20', grupa: 'ZUS', nazwa: 'ZUS — składki i DRA: pozostali płatnicy', rytm: 'm', dzien: 20, kto: ['zus-pozostali', 'platnik-zus'],
      opis: 'Pozostali płatnicy, m.in. osoby prowadzące działalność gospodarczą i spółki osobowe: deklaracja rozliczeniowa, raporty imienne i wpłata składek za poprzedni miesiąc. Kto opłaca składki wyłącznie za siebie, przesyła tylko deklarację.',
      podstawa: 'art. 47 ust. 1 pkt 4, ust. 2 i 4 ustawy o systemie ubezpieczeń społecznych', eli: SUS },

    // ---- PFRON ----
    { id: 'pfron', grupa: 'PFRON', nazwa: 'PFRON — wpłata i deklaracja miesięczna', rytm: 'm', dzien: 20, kto: ['pfron'],
      opis: 'Pracodawca zatrudniający co najmniej 25 pracowników w przeliczeniu na pełny wymiar czasu pracy, który nie osiąga 6% wskaźnika zatrudnienia osób niepełnosprawnych — wpłata i deklaracja za poprzedni miesiąc.',
      podstawa: 'art. 21 ust. 1 i art. 49 ust. 2 ustawy o rehabilitacji zawodowej i społecznej oraz zatrudnianiu osób niepełnosprawnych', eli: REHAB },

    // ---- roczne: płatnik ----
    { id: 'pit-4r', grupa: 'PIT', nazwa: 'PIT-4R — roczna deklaracja płatnika', rytm: 'r', miesiac: 1, dzien: 'ost', kto: ['platnik'],
      opis: 'Roczna deklaracja o pobranych zaliczkach na podatek dochodowy — do końca stycznia.',
      podstawa: 'art. 38 ust. 1a ustawy o PIT', eli: PIT },
    { id: 'pit-8ar', grupa: 'PIT', nazwa: 'PIT-8AR — roczna deklaracja o zryczałtowanym podatku', rytm: 'r', miesiac: 1, dzien: 'ost', kto: ['platnik-ryczalt'],
      opis: 'Roczna deklaracja płatnika o pobranym zryczałtowanym podatku dochodowym — do końca stycznia.',
      podstawa: 'art. 42 ust. 1a ustawy o PIT', eli: PIT },
    { id: 'pit-11-us', grupa: 'PIT', nazwa: 'PIT-11 — przesłanie do urzędu skarbowego', rytm: 'r', miesiac: 1, dzien: 'ost', kto: ['platnik'],
      opis: 'Imienne informacje o dochodach i pobranych zaliczkach płatnik przesyła urzędowi skarbowemu do końca stycznia roku następującego po roku podatkowym.',
      podstawa: 'art. 39 ust. 1 i art. 42g ust. 1 pkt 1 ustawy o PIT', eli: PIT },
    { id: 'pit-11-podatnik', grupa: 'PIT', nazwa: 'PIT-11 — przekazanie podatnikowi', rytm: 'r', miesiac: 2, dzien: 'ost', kto: ['platnik'],
      opis: 'Te same informacje płatnik przekazuje podatnikowi (pracownikowi, zleceniobiorcy) do końca lutego.',
      podstawa: 'art. 39 ust. 1 i art. 42g ust. 1 pkt 2 ustawy o PIT', eli: PIT },
    { id: 'ift-1r', grupa: 'PIT', nazwa: 'IFT-1R — informacja o wypłatach dla nierezydentów (osoby fizyczne)', rytm: 'r', miesiac: 2, dzien: 'ost', kto: ['nierezydenci'],
      opis: 'Informację o należnościach wypłaconych osobom fizycznym bez miejsca zamieszkania w Polsce płatnik przesyła podatnikowi i urzędowi skarbowemu właściwemu dla osób zagranicznych do końca lutego.',
      podstawa: 'art. 42 ust. 2 pkt 2 ustawy o PIT', eli: PIT },

    // ---- roczne: zeznania ----
    { id: 'pit-36', grupa: 'PIT', nazwa: 'PIT-36 — zeznanie roczne i dopłata podatku (skala)', rytm: 'r', miesiac: 4, dzien: 30, kto: ['pit-skala'],
      opis: 'Zeznanie składa się od 15 lutego do 30 kwietnia; w tym samym terminie wpłaca się różnicę między podatkiem należnym a sumą zaliczek.',
      podstawa: 'art. 45 ust. 1 i ust. 4 pkt 1 ustawy o PIT', eli: PIT },
    { id: 'pit-36l', grupa: 'PIT', nazwa: 'PIT-36L — zeznanie roczne i dopłata podatku (liniowy)', rytm: 'r', miesiac: 4, dzien: 30, kto: ['pit-liniowy'],
      opis: 'Odrębne zeznanie o dochodzie z działalności opodatkowanej podatkiem liniowym — od 15 lutego do 30 kwietnia, razem z dopłatą podatku.',
      podstawa: 'art. 45 ust. 1a pkt 2 i ust. 4 ustawy o PIT', eli: PIT },
    { id: 'pit-28', grupa: 'PIT', nazwa: 'PIT-28 — zeznanie roczne ryczałtowca', rytm: 'r', miesiac: 4, dzien: 30, kto: ['ryczalt'],
      opis: 'Zeznanie o przychodach, odliczeniach i należnym ryczałcie — od 15 lutego do 30 kwietnia.',
      podstawa: 'art. 21 ust. 2 pkt 2 ustawy o zryczałtowanym podatku dochodowym', eli: RYCZ },
    { id: 'pit-37', grupa: 'PIT', nazwa: 'PIT-37 — zeznanie roczne osób bez działalności', rytm: 'r', miesiac: 4, dzien: 30, kto: ['bez-dzialalnosci'],
      opis: 'Zeznanie osób uzyskujących dochody wyłącznie za pośrednictwem płatników (praca, zlecenia) — od 15 lutego do 30 kwietnia.',
      podstawa: 'art. 45 ust. 1 ustawy o PIT', eli: PIT },
    { id: 'cit-8', grupa: 'CIT', nazwa: 'CIT-8 — zeznanie roczne i dopłata podatku', rytm: 'r', miesiac: 3, dzien: 'ost', kto: ['cit-klasyczny'],
      opis: 'Zeznanie składa się do końca trzeciego miesiąca roku następnego i w tym terminie wpłaca podatek. Data dotyczy roku podatkowego równego kalendarzowemu — przy innym roku podatkowym termin liczy się od jego końca.',
      podstawa: 'art. 27 ust. 1 ustawy o CIT', eli: CIT },
    { id: 'cit-8e', grupa: 'CIT', nazwa: 'CIT-8E — deklaracja roczna (ryczałt od dochodów spółek)', rytm: 'r', miesiac: 3, dzien: 'ost', kto: ['cit-estonski'],
      opis: 'Spółka opodatkowana ryczałtem od dochodów spółek („estoński CIT”) składa deklarację o dochodzie za poprzedni rok do końca trzeciego miesiąca roku podatkowego.',
      podstawa: 'art. 28r ust. 1 ustawy o CIT', eli: CIT },
    { id: 'ift-2r', grupa: 'CIT', nazwa: 'IFT-2R — informacja o wypłatach dla nierezydentów (CIT)', rytm: 'r', miesiac: 3, dzien: 'ost', kto: ['nierezydenci'],
      opis: 'Informację o wypłatach i pobranym podatku płatnik przesyła zagranicznym podatnikom CIT oraz urzędowi skarbowemu do końca trzeciego miesiąca roku następującego po roku podatkowym, w którym dokonano wypłat.',
      podstawa: 'art. 26 ust. 3 pkt 2 i ust. 3a ustawy o CIT', eli: CIT },
    { id: 'cit-st', grupa: 'CIT', nazwa: 'CIT-ST — informacja o zakładach (oddziałach)', rytm: 'r', miesiac: 3, dzien: 31, kto: ['cit', 'zaklady'],
      opis: 'Podatnik posiadający zakłady (oddziały) na obszarze innej jednostki samorządu terytorialnego niż jego siedziba składa do 31 marca wykaz zakładów i liczbę zatrudnionych na umowę o pracę według stanu na 31 grudnia roku poprzedniego.',
      podstawa: 'art. 28 ust. 1 ustawy o CIT', eli: CIT },

    // ---- sprawozdanie finansowe ----
    { id: 'sf-sporzadzenie', grupa: 'Sprawozdania', nazwa: 'Sprawozdanie finansowe — sporządzenie i podpisanie', rytm: 'r', miesiac: 3, dzien: 31, kto: ['ksiegi'], przesuwany: false,
      opis: 'Kierownik jednostki zapewnia sporządzenie rocznego sprawozdania finansowego nie później niż w ciągu 3 miesięcy od dnia bilansowego (31 marca przy roku obrotowym równym kalendarzowemu). To nie jest termin podatkowy — nie przesuwa się go na następny dzień roboczy.',
      podstawa: 'art. 52 ust. 1 i 2 ustawy o rachunkowości', eli: RACH },
    { id: 'sf-kas', grupa: 'Sprawozdania', nazwa: 'Sprawozdanie finansowe — przekazanie Szefowi KAS (osoby fizyczne)', rytm: 'r', miesiac: 4, dzien: 30, kto: ['ksiegi', 'jdg'],
      opis: 'Podatnik PIT prowadzący księgi rachunkowe przekazuje elektronicznie sprawozdanie finansowe Szefowi Krajowej Administracji Skarbowej przed upływem terminu na złożenie zeznania.',
      podstawa: 'art. 45 ust. 5 ustawy o PIT', eli: PIT },
    { id: 'sf-zatwierdzenie', grupa: 'Sprawozdania', nazwa: 'Sprawozdanie finansowe — zatwierdzenie', rytm: 'r', miesiac: 6, dzien: 30, kto: ['ksiegi'], przesuwany: false,
      opis: 'Roczne sprawozdanie finansowe zatwierdza organ zatwierdzający nie później niż 6 miesięcy od dnia bilansowego (30 czerwca przy roku obrotowym równym kalendarzowemu). To nie jest termin podatkowy — nie przesuwa się go na następny dzień roboczy.',
      podstawa: 'art. 53 ust. 1 ustawy o rachunkowości', eli: RACH },
    { id: 'sf-krs', grupa: 'Sprawozdania', nazwa: 'Sprawozdanie finansowe — złożenie w KRS (najpóźniej)', rytm: 'r', miesiac: 7, dzien: 15, kto: ['ksiegi', 'krs'], przesuwany: false,
      opis: 'Sprawozdanie z uchwałą o zatwierdzeniu i podziale zysku składa się w rejestrze sądowym w ciągu 15 dni od dnia zatwierdzenia. Pokazana data to ostatni możliwy dzień — gdy zatwierdzenie nastąpiło 30 czerwca; przy wcześniejszym zatwierdzeniu termin mija wcześniej. Podatnik CIT niewpisany do KRS przekazuje sprawozdanie w tym samym terminie Szefowi KAS (art. 27 ust. 2 ustawy o CIT).',
      podstawa: 'art. 69 ust. 1 ustawy o rachunkowości', eli: RACH }
  ];

  // ---------------- dates ----------------
  var MIES = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
  var KW = ['I', 'II', 'III', 'IV'];
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(r, m, d) { return r + '-' + p2(m) + '-' + p2(d); }
  function utc(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function fromUtc(d) { return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function plus(s, n) { var d = utc(s); d.setUTCDate(d.getUTCDate() + n); return fromUtc(d); }
  function dniMiesiaca(r, m) { return new Date(Date.UTC(r, m, 0)).getUTCDate(); }
  function dzienTygodnia(s) { return utc(s).getUTCDay(); } // 0 = Sunday … 6 = Saturday

  // Easter Sunday (Gregorian calendar, Meeus/Jones/Butcher)
  function wielkanoc(r) {
    var a = r % 19, b = Math.floor(r / 100), c = r % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mies = Math.floor((h + l - 7 * m + 114) / 31), dz = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(r, mies, dz);
  }

  // public holidays of the year: { 'YYYY-MM-DD': name } — art. 1 pkt 1 ustawy o dniach wolnych od pracy
  var cache = {};
  function swieta(r) {
    if (cache[r]) return cache[r];
    var w = wielkanoc(r), s = {};
    s[iso(r, 1, 1)] = 'Nowy Rok';
    s[iso(r, 1, 6)] = 'Święto Trzech Króli';
    s[w] = 'pierwszy dzień Wielkiej Nocy';
    s[plus(w, 1)] = 'drugi dzień Wielkiej Nocy';
    s[iso(r, 5, 1)] = 'Święto Państwowe';
    s[iso(r, 5, 3)] = 'Święto Narodowe Trzeciego Maja';
    s[plus(w, 49)] = 'pierwszy dzień Zielonych Świątek';
    s[plus(w, 60)] = 'Boże Ciało';
    s[iso(r, 8, 15)] = 'Wniebowzięcie Najświętszej Maryi Panny';
    s[iso(r, 11, 1)] = 'Wszystkich Świętych';
    s[iso(r, 11, 11)] = 'Narodowe Święto Niepodległości';
    if (r >= 2025) s[iso(r, 12, 24)] = 'Wigilia Bożego Narodzenia'; // lit. ka, in force since 1.02.2025
    s[iso(r, 12, 25)] = 'pierwszy dzień Bożego Narodzenia';
    s[iso(r, 12, 26)] = 'drugi dzień Bożego Narodzenia';
    return (cache[r] = s);
  }
  // Saturday, Sunday or a public holiday -> its name, otherwise ''
  function czyWolny(s) {
    var dt = dzienTygodnia(s);
    return swieta(+s.slice(0, 4))[s] || (dt === 6 ? 'sobota' : dt === 0 ? 'niedziela' : '');
  }
  function przesunIso(s) { while (czyWolny(s)) s = plus(s, 1); return s; }
  /* art. 12 § 5 Ordynacji podatkowej: a deadline falling on a Saturday or a statutory day off
     moves to the next day after the day(s) off. Takes and returns a Date (local date parts)
     or a 'YYYY-MM-DD' string. */
  function przesun(d) {
    if (typeof d === 'string') return przesunIso(d.slice(0, 10));
    var p = przesunIso(iso(d.getFullYear(), d.getMonth() + 1, d.getDate())).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  // ---------------- occurrences ----------------
  // the deadline of obligation o whose statutory (nominal) date lies in month m of year r, or null
  function wystapienie(o, r, m) {
    var dotyczy, pm = m === 1 ? 12 : m - 1, pr = m === 1 ? r - 1 : r;
    if (o.rytm === 'm') dotyczy = MIES[pm - 1] + ' ' + pr;
    else if (o.rytm === 'k') { if (m % 3 !== 1) return null; dotyczy = KW[(pm / 3) - 1] + ' kwartał ' + pr; }
    else if (o.rytm === 'k12') { if (m % 3 === 1) return null; dotyczy = MIES[pm - 1] + ' ' + pr; }
    else { if (o.miesiac !== m) return null; dotyczy = 'rok ' + (r - 1); }
    var nominalna = iso(r, m, o.dzien === 'ost' ? dniMiesiaca(r, m) : o.dzien);
    var data = o.przesuwany === false ? nominalna : przesunIso(nominalna);
    return { data: data, nominalna: nominalna, przesunieto: data !== nominalna, id: o.id, grupa: o.grupa, nazwa: o.nazwa,
      dotyczy: dotyczy, podstawa: o.podstawa, eli: o.eli, opis: o.opis };
  }
  var NR = {};
  OBOWIAZKI.forEach(function (o, i) { NR[o.id] = i; });
  function zbierz(lista, r, m) {
    var out = [], pm = m === 1 ? 12 : m - 1, pr = m === 1 ? r - 1 : r, pref = r + '-' + p2(m) + '-';
    lista.forEach(function (o) {
      // a deadline of the previous month can land in this one after shifting (e.g. 31 January on a Sunday)
      [wystapienie(o, pr, pm), wystapienie(o, r, m)].forEach(function (w) { if (w && w.data.indexOf(pref) === 0) out.push(w); });
    });
    return out.sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : NR[a.id] - NR[b.id]; });
  }
  // all deadlines falling (after shifting) in the month, sorted by date
  function dlaMiesiaca(rok, miesiac) { return zbierz(OBOWIAZKI, +rok, +miesiac); }

  // ---------------- client profile ----------------
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }
  // what the question behind a tag is — shown when the client's data does not answer it
  var TAGI = {
    'vat-m': 'czy rozlicza VAT miesięcznie', 'vat-k': 'czy rozlicza VAT kwartalnie', 'vat-ue': 'czy jest zarejestrowany jako VAT UE i miał transakcje wewnątrzwspólnotowe',
    'platnik': 'czy wypłaca wynagrodzenia (pracownicy, zleceniobiorcy)', 'platnik-ryczalt': 'czy pobiera zryczałtowany PIT (np. dywidendy, małe zlecenia)',
    'platnik-zus': 'czy jest płatnikiem składek ZUS', 'nierezydenci': 'czy wypłaca należności nierezydentom', 'wht': 'czy pobrał podatek u źródła',
    'pit-ogolne': 'forma opodatkowania PIT', 'pit-skala': 'forma opodatkowania PIT', 'pit-liniowy': 'forma opodatkowania PIT', 'ryczalt': 'forma opodatkowania PIT',
    'zal-m': 'czy wpłaca zaliczki / ryczałt miesięcznie', 'zal-k': 'czy wpłaca zaliczki / ryczałt kwartalnie',
    'cit': 'czy jest podatnikiem CIT', 'cit-klasyczny': 'czy jest podatnikiem CIT na zasadach ogólnych', 'cit-estonski': 'czy stosuje ryczałt od dochodów spółek',
    'zaklady': 'czy ma zakłady (oddziały) w innej gminie', 'zus-budzet': 'forma prawna', 'zus-prawna': 'forma prawna', 'zus-pozostali': 'forma prawna',
    'ksiegi': 'czy prowadzi księgi rachunkowe', 'krs': 'czy jest wpisany do KRS', 'jdg': 'forma prawna',
    'pfron': 'czy zatrudnia co najmniej 25 osób (etaty) bez 6% wskaźnika', 'bez-dzialalnosci': ''
  };
  function i3(a, b) { return a === false || b === false ? false : a === null || b === null ? null : true; } // three-valued AND
  function lub3(a, b) { return a === true || b === true ? true : a === null || b === null ? null : false; } // three-valued OR

  /* Reads the free-text fields `forma` and `opodatkowanie` into tags: true / false / null (the text
     does not decide). klient.cechy = { tag: true|false } overrides what was read. */
  function profil(klient) {
    klient = klient || {};
    var f = norm(klient.forma), o = norm(klient.opodatkowanie), typ = null;
    if (/komandyt/.test(f)) typ = 'kom';
    else if (/z ?o\.? ?o\.?($|[^a-z])|z ograniczona|akcyjn|(^|[^a-z])p?\.?s\.? ?a\.?($|[^a-z])/.test(f)) typ = 'kap';
    else if (/jawn|sp\. ?j|partnersk|cywiln|(^|[^a-z])s\. ?c\.?($|[^a-z])/.test(f)) typ = 'osob';
    else if (/budzet/.test(f)) typ = 'budzet';
    else if (/fundacj|stowarzysz|spoldzieln/.test(f)) typ = 'prawna';
    else if (/jdg|jednoosobow|dzialalnosc gosp|osoba fizyczna|indywidualn/.test(f)) typ = 'jdg';

    // segments that mention VAT describe VAT; the rest describes income tax
    var segV = [], segD = [];
    o.split(/[,;\/+|]| i /).forEach(function (s) { (/vat/.test(s) ? segV : segD).push(s); });
    var v = segV.join(' '), d = segD.join(' ');

    var cit = typ === 'kap' || typ === 'kom' || typ === 'prawna' ? true : typ === 'jdg' || typ === 'osob' ? false : /(^|[^a-z])cit/.test(d) || /estonsk/.test(d) ? true : /ryczalt|liniow|skal|ogoln|karta/.test(d) ? false : null;
    var est = /estonsk/.test(d) || (cit === true && /ryczalt/.test(d));
    // partners of a partnership pay PIT themselves; the firm's record says nothing certain about them
    var pitp = typ === 'jdg' ? true : typ === 'osob' ? null : cit === true ? false : cit === false ? true : null;
    var rycz = /ryczalt/.test(d) && !est, lin = /liniow/.test(d), skala = /skal|ogoln|progresyw/.test(d), znana = rycz || lin || skala || /karta/.test(d);
    function forma(jest) { return pitp === false ? false : znana ? (jest ? pitp : false) : null; }
    var kw = /kwartal/.test(d), mies = /miesiec|miesiac/.test(d);
    var vat = !segV.length ? null : !/bez vat|nie ?vat|zwoln|vat zw|vat: ?nie|vat nie/.test(v);
    var vkw = /kwartal/.test(v), vmies = /miesiec|miesiac/.test(v);
    var ksiegi = typ === 'kap' || typ === 'kom' || typ === 'prawna' || /pelna ksieg|ksiegi rachunk|ksiegi handl/.test(o) ? true : typ === 'jdg' && (rycz || /karta/.test(d)) ? false : null;

    var t = {
      'vat-m': vat === false ? false : vat === null ? null : vkw ? false : vmies ? true : null,
      'vat-k': vat === false ? false : vat === null ? null : vkw ? true : vmies ? false : null,
      'vat-ue': /vat[- ]?ue/.test(v) ? true : null,
      'platnik': null, 'platnik-ryczalt': null, 'nierezydenci': null, 'wht': null, 'zaklady': null, 'pfron': null,
      'platnik-zus': typ === 'jdg' ? true : null,
      'pit-skala': forma(skala), 'pit-liniowy': forma(lin), 'ryczalt': forma(rycz),
      'zal-m': kw ? false : mies ? true : null, 'zal-k': kw ? true : mies ? false : null,
      'cit': cit, 'cit-klasyczny': cit === false ? false : est ? false : cit, 'cit-estonski': cit === false ? false : est ? true : cit === true ? false : null,
      'zus-budzet': typ === 'budzet',
      'zus-prawna': typ === 'kap' || typ === 'prawna' ? true : typ === null ? null : false,
      'zus-pozostali': typ === 'jdg' || typ === 'osob' || typ === 'kom' ? true : typ === null ? null : false,
      'ksiegi': ksiegi,
      'krs': typ === 'kap' || typ === 'kom' || typ === 'prawna' ? true : typ === 'osob' ? !/cywiln|(^|[^a-z])s\. ?c/.test(f) : typ === null ? null : false,
      'jdg': typ === 'jdg' ? true : typ === null ? null : false,
      'bez-dzialalnosci': false
    };
    t['pit-ogolne'] = lub3(t['pit-skala'], t['pit-liniowy']);
    var c = klient.cechy || {};
    Object.keys(c).forEach(function (k) { if (c[k] === true || c[k] === false) t[k] = c[k]; });
    if (c['vat-m'] === true && c['vat-k'] == null) t['vat-k'] = false;
    if (c['vat-k'] === true && c['vat-m'] == null) t['vat-m'] = false;
    if (c['zal-m'] === true && c['zal-k'] == null) t['zal-k'] = false;
    if (c['zal-k'] === true && c['zal-m'] == null) t['zal-m'] = false;
    return t;
  }

  /* Deadlines of the month that plausibly apply to the client. An obligation whose condition the
     client's data does not decide is included with niepewne: true and `powod` naming what is missing. */
  function dlaKlienta(klient, rok, miesiac) {
    var t = profil(klient), stan = {};
    var lista = OBOWIAZKI.filter(function (o) {
      var wynik = true, brak = [];
      o.kto.forEach(function (k) {
        var w = k in t ? t[k] : null;
        wynik = i3(wynik, w);
        if (w === null && TAGI[k] && brak.indexOf(TAGI[k]) < 0) brak.push(TAGI[k]);
      });
      stan[o.id] = brak;
      return wynik !== false;
    });
    return zbierz(lista, +rok, +miesiac).map(function (w) {
      w.niepewne = stan[w.id].length > 0;
      if (w.niepewne) w.powod = 'Do potwierdzenia: ' + stan[w.id].join('; ') + '.';
      return w;
    });
  }

  var api = { OBOWIAZKI: OBOWIAZKI, GRUPY: GRUPY, PRZESUNIECIE: PRZESUNIECIE, MIESIACE: MIES,
    przesun: przesun, swieta: swieta, czyWolny: czyWolny, wielkanoc: wielkanoc,
    dlaMiesiaca: dlaMiesiaca, dlaKlienta: dlaKlienta, profil: profil };
  root.KsiegTerminy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
