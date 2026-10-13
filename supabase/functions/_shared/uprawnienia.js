/* Uprawnienia szczegółowe — the ONE catalogue of the portal's pages and functions that an administrator can
   switch off for a member of staff, and the rules for reading the switch-off list.

   Model: app_metadata.portal_wylaczone is a DENY list (string[]) on top of app_metadata.portal_sections.
   A key is `modul.strona[.funkcja]`; it is denied when the list holds the key itself or any dotted ancestor.
   No claim = nothing denied. A claim that is not a list = everything denied (fail closed). An administrator
   (portal_admin) is never restricted. The list can only take away: it never grants a section or an
   administrator-only function.

   This file is loaded by the browser (auth-guard.js for restricted accounts, dostep.html), by node
   (tests/uprawnienia.test.cjs) and — as an IDENTICAL copy in supabase/functions/_shared/uprawnienia.js — by the
   edge functions. After every change: cp uprawnienia.js supabase/functions/_shared/ (a test compares the two).

   The browser side only hides things. What really stops a person is the server; `e` on each entry says, phase
   by phase, where a key is enforced:  G = page guard + menu,  F = edge function,  R = row level security,
   followed by the phase that brings it (1 = live now, 2 and 3 = planned). The admin page shows this honestly. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.Uprawnienia = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var FAZA = 1;          // the phase that is live: enforcement marked with a higher number is not active yet
  var MAX_KLUCZY = 150, MAX_BAJTOW = 4096;
  var SEKCJE = [['rejestracja', 'Rejestracja spółki'], ['biezaca', 'Bieżąca działalność'], ['kadry', 'Kadry'], ['legalizacja', 'Legalizacja pobytu'], ['onboarding', 'Księgowość']];

  // [key, label, { s: section(s) needed — a list means "any of", w: sections needed — all of them,
  //                p: page (with its query when the query picks the screen), a: administrator only (greyed, never
  //                in a deny list), m: the module is one section (ticking it writes portal_sections), e: enforcement,
  //                c: the server block is partial for another reason than a later phase — the page's function refuses,
  //                but data the page shows is also read straight from tables that other pages need }]
  // The order is the order of the menu: the first permitted page of this list is where a person lands.
  var WPISY = [
    ['kadry', 'Kadry', { s: 'kadry', m: 'kadry' }],
    ['kadry.kontrola', 'Kontrola', { p: 'kontrola.html', e: 'G1 F1', c: 1 }],
    ['kadry.kontrola.przypomnienia', 'Wysyłanie przypomnień do klienta', { e: 'F1' }],
    ['kadry.zgloszenia', 'Zgłoszenia pracowników', { p: 'zatrudnienie.html', e: 'G1 F1', c: 1 }],
    ['kadry.zgloszenia.pliki', 'Podgląd załączonych dokumentów', { e: 'R3' }],
    ['kadry.zgloszenia.wyslij', 'Wysyłka kompletu do pracodawcy', { e: 'F1' }],
    ['kadry.zgloszenia.usun', 'Usuwanie zgłoszeń', { e: 'R3' }],
    ['kadry.komplet', 'Komplet dokumentów', { p: 'umowa-zlecenie.html', e: 'G1' }],
    ['kadry.komplet.szablony', 'Własne szablony umów', { e: 'R3' }],
    ['kadry.komplet.wfirma', 'Dane z wFirma', { e: 'F1' }],
    ['kadry.tlumaczenie', 'Tłumaczenie dokumentów (AI)', { e: 'F1' }],
    ['kadry.dokumenty', 'Generator dokumentów', { p: 'dokumenty.html', e: 'G1' }],
    ['kadry.dokumenty.wzory', 'Zatwierdzanie wzorów', { e: 'R3' }],
    ['kadry.rejestr', 'Rejestr i terminy', { p: 'rejestr.html', e: 'G1' }],
    ['kadry.akta', 'Akta osobowe', { p: 'akta.html', e: 'G1 R3' }],
    ['kadry.akta.dodaj', 'Dodawanie dokumentów do akt', { e: 'R3' }],
    ['kadry.akta.edycja', 'Zmiana opisu dokumentów w aktach', { e: 'R3' }],
    ['kadry.akta.usun', 'Usuwanie dokumentów z akt', { e: 'R3' }],
    ['kadry.akta.ai', 'Rozpoznawanie skanu (AI)', { e: 'F1' }],
    ['kadry.podpisy', 'Podpisy elektroniczne', { p: 'podpisy.html', e: 'G1 F1', c: 1 }],
    ['kadry.podpisy.wyslij', 'Tworzenie pakietu i wydanie do podpisu', { e: 'F1' }],
    ['kadry.podpisy.link', 'Link dla pracownika (wydanie i unieważnienie)', { e: 'F2' }],
    ['kadry.podpisy.weryfikacja', 'Wgrywanie i weryfikacja podpisanych plików', { e: 'F2' }],
    ['kadry.podpisy.anuluj', 'Anulowanie pakietu', { e: 'F2' }],
    ['kadry.import', 'Import pracowników', { p: 'import.html', e: 'G1' }],
    ['kadry.wiedza', 'Baza wiedzy — przepisy', { p: 'wiedza.html', e: 'G1' }],
    ['kadry.historia', 'Historia dokumentów (Kadry)', { p: 'historia.html?s=kadry', e: 'G1' }],
    ['kadry.dane', 'Dane pracowników', {}],
    ['kadry.dane.edycja', 'Zmiana danych pracowników (wyłączone = tylko podgląd)', { e: 'R3' }],

    ['spolka', 'Spółka', {}],
    ['spolka.rejestracja', 'Rejestracja spółki', { s: 'rejestracja', p: 'rejestracja.html', e: 'G1' }],
    ['spolka.wynagrodzenie', 'Uchwała o wynagrodzeniu', { s: 'biezaca', p: 'wynagrodzenie.html', e: 'G1' }],
    ['spolka.eurzad', 'e-Urząd Skarbowy', { s: 'biezaca', p: 'e-urzad.html', e: 'G1' }],
    ['spolka.pelnomocnictwo', 'Pełnomocnictwo', { s: 'biezaca', p: 'pelnomocnictwo.html', e: 'G1' }],
    ['spolka.nip8', 'NIP-8', { s: 'biezaca', p: 'nip-8.html', e: 'G1' }],
    ['spolka.historia', 'Historia dokumentów (Spółka)', { p: 'historia.html?s=spolka', e: 'G1' }],

    ['legalizacja', 'Legalizacja pobytu', { s: 'legalizacja', m: 'legalizacja' }],
    ['legalizacja.zalacznik', 'Załącznik nr 1 do wniosku o pobyt', { p: 'zalacznik-pobyt.html', e: 'G1' }],
    ['legalizacja.historia', 'Historia dokumentów (Legalizacja)', { p: 'historia.html?s=legalizacja', e: 'G1' }],

    ['ksiegowosc', 'Księgowość', { s: 'onboarding', m: 'onboarding' }],
    ['ksiegowosc.zamkniecia', 'Klienci i zamknięcia miesiąca', { p: 'ksiegowosc.html', e: 'G1 R3' }],
    ['ksiegowosc.zamkniecia.edycja', 'Odhaczanie kroków zamknięcia', { e: 'R3' }],
    ['ksiegowosc.kalendarz', 'Kalendarz terminów', { p: 'terminy-ksiegowe.html', e: 'G1' }],
    ['ksiegowosc.narzedzia', 'Narzędzia księgowe', { p: 'narzedzia-ksiegowe.html', e: 'G1' }],
    ['ksiegowosc.narzedzia.biala_lista', 'Biała lista VAT', { e: 'F1' }],
    ['ksiegowosc.narzedzia.vies', 'VIES', { e: 'F1' }],
    ['ksiegowosc.narzedzia.rejestr', 'Rejestr sprawdzeń VAT', { e: 'R3' }],
    ['ksiegowosc.onboarding', 'Onboarding klientów', { p: 'onboarding.html', e: 'G1' }],
    ['ksiegowosc.terminy_klientow', 'Terminy klientów', { p: 'onboarding.html?p=/deadlines', e: 'G1' }],

    ['klienci', 'Klienci', {}],
    ['klienci.baza', 'Baza klientów', { p: 'klienci.html', e: 'G1 F1', c: 1 }],
    ['klienci.baza.kontakty', 'Dane kontaktowe klientów', { s: 'kadry', e: 'F1', c: 1 }],
    ['klienci.zgloszenia', 'Zgłoszenia klientów', { s: ['kadry', 'onboarding'], p: 'zgloszenia-klientow.html', e: 'G1 F1', c: 1 }],
    ['klienci.zgloszenia.odpowiedz', 'Odpowiedź, status i notatka', { e: 'F1' }],
    ['klienci.zgloszenia.zalaczniki', 'Pobieranie załączników', { e: 'F1' }],
    ['klienci.zgloszenia.udostepnianie', 'Udostępnianie dokumentów klientowi', { e: 'F1' }],
    ['klienci.sms', 'SMS do klientów', { s: ['kadry', 'onboarding'], p: 'sms.html', e: 'G1 F1', c: 1 }],
    ['klienci.sms.wyslij', 'Wysyłanie SMS', { e: 'F1' }],
    ['klienci.sms.historia', 'Historia SMS', { e: 'F1 R3' }],
    ['klienci.rozsylki', 'Rozsyłki do klientów', { s: ['kadry', 'onboarding'], p: 'rozsylka.html', e: 'G1 F1 R3' }],
    ['klienci.rozsylki.edycja', 'Szkice, szablony i segmenty', { e: 'F2' }],
    ['klienci.rozsylki.wyslij', 'Zgłaszanie do wysyłki, test, wstrzymanie, anulowanie', { e: 'F1' }],
    ['klienci.rozsylki.subskrybenci', 'Zaproszenia, subskrybenci i zgody', { e: 'F2' }],
    ['klienci.rozsylki.dziennik', 'Dziennik wysyłek i eksport', { e: 'F2' }],
    ['klienci.edycja', 'Edycja danych klienta', { a: 1 }],
    ['klienci.rejestr_platny', 'Płatne odświeżenie danych z rejestru', { a: 1 }],
    ['klienci.audyt_umow', 'Audyt umów', { a: 1 }],
    ['klienci.telegram', 'Grupy Telegram klientów', { a: 1 }],
    ['klienci.umowy', 'Umowy z klientami — generator', { a: 1, p: 'umowy.html' }],

    ['poczta', 'Poczta', { s: ['kadry', 'onboarding'], p: 'poczta.html', e: 'G1 F1', c: 1 }],
    ['poczta.kadry', 'Skrzynka Kadry', { s: 'kadry', e: 'F1 R3' }],
    ['poczta.kadry.wyslij', 'Wysyłanie, szkice, wysyłka później', { e: 'F2' }],
    ['poczta.kadry.porzadki', 'Przenoszenie, usuwanie, foldery', { e: 'F2' }],
    ['poczta.kadry.zalaczniki', 'Pobieranie załączników i źródła', { e: 'F2' }],
    ['poczta.ksiegowosc', 'Skrzynka Księgowość', { s: 'onboarding', e: 'F1 R3' }],
    ['poczta.ksiegowosc.wyslij', 'Wysyłanie, szkice, wysyłka później', { e: 'F2' }],
    ['poczta.ksiegowosc.porzadki', 'Przenoszenie, usuwanie, foldery', { e: 'F2' }],
    ['poczta.ksiegowosc.zalaczniki', 'Pobieranie załączników i źródła', { e: 'F2' }],
    ['poczta.zadania', 'Zadania z wiadomości', { e: 'F2' }],
    ['poczta.slowniki', 'Szablony, podpisy i kontakty', { e: 'F2' }],

    ['ogolne', 'Ogólne', {}],
    ['ogolne.zadania', 'Zadania', { p: 'zadania.html', e: 'G1' }],
    ['ogolne.zadania.dodaj', 'Dodawanie zadań', { e: 'R3' }],
    ['ogolne.zadania.usun', 'Usuwanie zadań', { e: 'R3' }],
    ['ogolne.zadania.powiadom', 'Powiadomienia Telegram o zadaniach', { e: 'F2' }],
    ['ogolne.pulpit', 'Pulpit', { a: 1, p: 'pulpit.html' }],
    ['ogolne.zespol', 'Zespół', { a: 1, p: 'zespol.html' }],
    ['ogolne.dostep', 'Dostęp do portalu', { a: 1, p: 'dostep.html' }],
    ['ogolne.ustawienia', 'Ustawienia portalu', { a: 1 }],

    ['asystenci', 'Asystenci AI', { p: 'asystenci.html', e: 'G1 F1' }],
    ['asystenci.sekretarz_poczty', 'Sekretarz poczty', { s: ['kadry', 'onboarding'], e: 'F1' }],
    ['asystenci.asystent_kadrowy', 'Asystent kadrowy', { s: 'kadry', e: 'F1' }],
    ['asystenci.zamkniecie_miesiaca', 'Asystent zamknięcia miesiąca', { s: 'onboarding', e: 'F1' }],
    ['asystenci.kontroler_dokumentow', 'Kontroler dokumentów', { s: 'kadry', e: 'F1' }],
    ['asystenci.prawnik_obserwator', 'Prawnik-obserwator', { e: 'F1' }],
    ['asystenci.asystent_legalizacji', 'Asystent legalizacji', { w: ['legalizacja', 'kadry'], e: 'F1' }],
    ['asystenci.asystent_onboardingu', 'Asystent onboardingu', { s: ['onboarding', 'rejestracja'], e: 'F1' }],
    ['asystenci.zapytaj_portal', 'Zapytaj portal', { e: 'F1' }],

    ['wspolne', 'Wspólne dla modułów', {}],
    ['wspolne.krs', 'Płatne pobieranie danych z KRS (rejestr.io)', { e: 'F2' }],
    ['wspolne.historia', 'Historia dokumentów', {}],
    ['wspolne.historia.usun', 'Usuwanie dokumentów z historii', { e: 'R3' }],
  ];

  var STATUSY = {
    serwer: 'blokada na serwerze',
    serwer_czesc: 'blokada na serwerze — częściowa',
    strona: 'ukrycie strony',
    strona_oczekuje: 'ukrycie strony — blokada serwera w przygotowaniu',
    oczekuje: 'jeszcze nie działa — blokada w przygotowaniu',
    grupa: '',
    admin: 'tylko administrator',
  };

  function rodzic(k) { var i = k.lastIndexOf('.'); return i < 0 ? '' : k.slice(0, i); }

  var KLUCZE = {}, LISTA = [];
  WPISY.forEach(function (w) {
    var o = w[2] || {}, n = { klucz: w[0], nazwa: w[1], rodzic: rodzic(w[0]), strona: o.p || '', tylkoAdmin: !!o.a, modulSekcja: o.m || '', egz: [], dzieci: [], sekcja: o.s || null, sekcjeWsz: o.w || null, czesciowa: !!o.c };
    String(o.e || '').split(' ').filter(Boolean).forEach(function (x) { n.egz.push({ typ: x.charAt(0), faza: +x.slice(1) }); });
    KLUCZE[n.klucz] = n; LISTA.push(n);
  });
  LISTA.forEach(function (n) {
    var r = KLUCZE[n.rodzic];
    if (n.rodzic && !r) throw new Error('uprawnienia: brak rodzica dla ' + n.klucz);
    if (r) {
      r.dzieci.push(n);
      // a section set on a module or a page also covers what is under it
      if (n.sekcja === null && n.sekcjeWsz === null) { n.sekcja = r.sekcja; n.sekcjeWsz = r.sekcjeWsz; }
      if (r.tylkoAdmin) n.tylkoAdmin = true;
    }
    var zywe = n.egz.filter(function (x) { return x.faza <= FAZA; }), pozniej = n.egz.length > zywe.length;
    var serwer = zywe.some(function (x) { return x.typ !== 'G'; }), strona = zywe.some(function (x) { return x.typ === 'G'; });
    n.status = n.tylkoAdmin ? 'admin' : !n.egz.length ? 'grupa' : serwer ? (pozniej || n.czesciowa ? 'serwer_czesc' : 'serwer') : strona ? (pozniej ? 'strona_oczekuje' : 'strona') : 'oczekuje';
  });

  function znany(k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(KLUCZE, k); }
  // "Kadry › Kontrola › Wysyłanie przypomnień do klienta"
  function etykieta(k) {
    var out = [];
    for (var x = k; x && znany(x); x = rodzic(x)) out.unshift(KLUCZE[x].nazwa);
    return out.length ? out.join(' › ') : String(k);
  }

  function jestAdmin(meta) { return !!meta && meta.portal_admin === true; }
  // the switch-off list of an account: [] when there is no claim, 'blad' when the claim is not a list
  function wylaczone(meta) {
    var v = meta ? meta.portal_wylaczone : undefined;
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) return 'blad';
    return v.filter(function (x) { return typeof x === 'string' && x.length > 0; });
  }
  // is `klucz` (or any of its ancestors) on the list
  function naLiscie(lista, klucz) {
    for (var i = 0; i < lista.length; i++) {
      var e = lista[i];
      if (klucz === e || (klucz.length > e.length && klucz.charAt(e.length) === '.' && klucz.slice(0, e.length) === e)) return true;
    }
    return false;
  }
  // the core rule, as the edge functions use it: c = { admin, wyl } with wyl = wylaczone(app_metadata)
  function mozeLista(c, klucz) {
    if (c && c.admin === true) return true;
    if (!c || !Array.isArray(c.wyl) || typeof klucz !== 'string' || !klucz) return false;
    return !naLiscie(c.wyl, klucz);
  }
  // the same from app_metadata. Sections are NOT looked at here — see maSekcje / dostepny.
  function mozna(meta, klucz) { return mozeLista({ admin: jestAdmin(meta), wyl: wylaczone(meta) }, klucz); }
  // is this account restricted at all (a non-administrator with a claim)
  function ograniczony(meta) { return !jestAdmin(meta) && !!meta && meta.portal_wylaczone !== undefined && meta.portal_wylaczone !== null; }

  function maSekcje1(meta, s) { return jestAdmin(meta) || !meta || !Array.isArray(meta.portal_sections) || meta.portal_sections.indexOf(s) !== -1; }
  // does the account have the section(s) the key needs
  function maSekcje(meta, klucz) {
    var n = KLUCZE[klucz];
    if (!n) return true;
    if (n.sekcjeWsz) return n.sekcjeWsz.every(function (s) { return maSekcje1(meta, s); });
    if (!n.sekcja) return true;
    return Array.isArray(n.sekcja) ? n.sekcja.some(function (s) { return maSekcje1(meta, s); }) : maSekcje1(meta, n.sekcja);
  }
  // everything together: administrator-only, section, switch-off list
  function dostepny(meta, klucz) {
    var n = KLUCZE[klucz];
    if (n && n.tylkoAdmin && !jestAdmin(meta)) return false;
    return maSekcje(meta, klucz) && mozna(meta, klucz);
  }

  // Validation of a list before it is stored: only known keys that are not administrator-only, no duplicates,
  // a key is dropped when its ancestor is on the list, sorted, capped.
  function normalizuj(lista) {
    if (lista === null || lista === undefined) return { ok: true, lista: [] };
    if (!Array.isArray(lista)) return { ok: false, blad: 'Lista wyłączonych funkcji musi być tablicą.' };
    if (lista.length > 1000) return { ok: false, blad: 'Lista jest za długa.' };
    var zle = lista.filter(function (k) { return !znany(k) || KLUCZE[k].tylkoAdmin; });
    if (zle.length) return { ok: false, blad: 'Nieznana funkcja: ' + zle.slice(0, 5).map(function (k) { return String(k).slice(0, 60); }).join(', ') + '.' };
    var uniq = lista.filter(function (k, i) { return lista.indexOf(k) === i; });
    var out = uniq.filter(function (k) { return !uniq.some(function (e) { return e !== k && naLiscie([e], k); }); }).sort();
    if (out.length > MAX_KLUCZY || JSON.stringify(out).length > MAX_BAJTOW) return { ok: false, blad: 'Za dużo wyłączonych funkcji (limit ' + MAX_KLUCZY + ').' };
    return { ok: true, lista: out };
  }

  // ---- pages
  var STRONY = LISTA.filter(function (n) { return n.strona; }).map(function (n) {
    var q = n.strona.split('?');
    return { href: n.strona, plik: q[0], query: q[1] || '', klucz: n.klucz };
  });
  function parametr(search, nazwa) {
    var m = new RegExp('[?&]' + nazwa + '=([^&#]*)').exec(String(search || ''));
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  // The keys a page needs (all of them). [] = the page has no key (index.html, pages outside the catalogue).
  function kluczeStrony(plik, search) {
    plik = String(plik || '').split('/').pop() || 'index.html';
    if (plik === 'historia.html') {
      var s = parametr(search, 's');
      // without ?s= the page lists every module's documents: it needs each of the three history keys
      return ['kadry', 'spolka', 'legalizacja'].indexOf(s) !== -1 ? [s + '.historia'] : ['kadry.historia', 'spolka.historia', 'legalizacja.historia'];
    }
    if (plik === 'onboarding.html') return [parametr(search, 'p').indexOf('/deadlines') === 0 ? 'ksiegowosc.terminy_klientow' : 'ksiegowosc.onboarding'];
    for (var i = 0; i < STRONY.length; i++) if (STRONY[i].plik === plik && !STRONY[i].query) return [STRONY[i].klucz];
    return [];
  }
  // may the account open this address (an href as in the menu: "plik.html?query#hash")
  function mozeStrone(meta, href) {
    var bez = String(href || '').split('#')[0], q = bez.split('?');
    var klucze = kluczeStrony(q[0], q[1] ? '?' + q[1] : '');
    return klucze.every(function (k) { return dostepny(meta, k); });
  }
  // Where a person lands: the first page they may open, or '' when there is none. Pages of their own modules
  // (those that need a section) come first, in the order of the menu; then the tasks; then whatever is left.
  function pierwszaStrona(meta) {
    var wolne = STRONY.filter(function (s) { return !KLUCZE[s.klucz].tylkoAdmin && dostepny(meta, s.klucz); });
    var zSekcja = wolne.filter(function (s) { var n = KLUCZE[s.klucz]; return n.sekcja || n.sekcjeWsz; });
    var zadania = wolne.filter(function (s) { return s.klucz === 'ogolne.zadania'; });
    var p = zSekcja[0] || zadania[0] || wolne[0];
    return p ? p.href : '';
  }

  // ---- presets for the admin page: sections + switch-off list
  var SZABLONY = [
    { id: 'kadrowa', nazwa: 'Kadrowa', opis: 'Cały moduł Kadry z pocztą i SMS-ami; bez rozsyłek, bez usuwania i bez zatwierdzania wzorów.',
      sekcje: ['kadry'],
      wylaczone: ['kadry.akta.usun', 'kadry.dokumenty.wzory', 'kadry.komplet.szablony', 'kadry.zgloszenia.usun', 'klienci.rozsylki', 'wspolne.historia.usun'] },
    { id: 'ksiegowa', nazwa: 'Księgowa', opis: 'Cały moduł Księgowość z pocztą i SMS-ami; bez rozsyłek i bez usuwania dokumentów z historii.',
      sekcje: ['onboarding'],
      wylaczone: ['klienci.rozsylki', 'wspolne.historia.usun'] },
    { id: 'kadry_podglad', nazwa: 'Tylko podgląd Kadr', opis: 'Widzi strony Kadr, ale nic nie wysyła, nie zmienia i nie usuwa.',
      sekcje: ['kadry'],
      wylaczone: ['asystenci', 'kadry.akta.ai', 'kadry.akta.dodaj', 'kadry.akta.edycja', 'kadry.akta.usun', 'kadry.dane.edycja', 'kadry.dokumenty.wzory', 'kadry.import',
        'kadry.komplet.szablony', 'kadry.kontrola.przypomnienia', 'kadry.podpisy.anuluj', 'kadry.podpisy.link', 'kadry.podpisy.weryfikacja', 'kadry.podpisy.wyslij', 'kadry.tlumaczenie',
        'kadry.zgloszenia.usun', 'kadry.zgloszenia.wyslij', 'klienci.rozsylki', 'klienci.sms.wyslij', 'klienci.zgloszenia.odpowiedz', 'klienci.zgloszenia.udostepnianie',
        'ogolne.zadania.usun', 'poczta.kadry.porzadki', 'poczta.kadry.wyslij', 'wspolne.historia.usun', 'wspolne.krs'] },
  ];

  return {
    FAZA: FAZA, MAX_KLUCZY: MAX_KLUCZY, MAX_BAJTOW: MAX_BAJTOW, SEKCJE: SEKCJE, STATUSY: STATUSY, SZABLONY: SZABLONY,
    DRZEWO: LISTA.filter(function (n) { return !n.rodzic; }), LISTA: LISTA, KLUCZE: KLUCZE, STRONY: STRONY,
    znany: znany, etykieta: etykieta, rodzic: rodzic,
    wylaczone: wylaczone, naLiscie: naLiscie, mozeLista: mozeLista, mozna: mozna, ograniczony: ograniczony,
    maSekcje: maSekcje, dostepny: dostepny, normalizuj: normalizuj,
    kluczeStrony: kluczeStrony, mozeStrone: mozeStrone, pierwszaStrona: pierwszaStrona,
  };
});
