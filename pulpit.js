/* Pulpit: the administrator's dashboard, arranged by the user.
   One call to the `pulpit` edge function returns the aggregated state; this file draws it
   from two registries — TILES (numbers) and WIDGETS (panels) — in the layout the user chose:
   which ones are shown, in what order, how wide, how many rows, how often it refreshes.
   The layout is personal and kept in this browser (localStorage). */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/pulpit';
  var KEY = 'tdcg_pulpit';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function when(iso) { return iso ? new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'jeszcze nie'; }
  function who(e) { return e === 'system' ? 'portal' : (e || '').split('@')[0]; }
  function sum(l, f) { return l.reduce(function (a, x) { return a + f(x); }, 0); }
  function bars(list, cls) {
    var max = Math.max.apply(null, list.map(function (x) { return x.ile; }).concat([1]));
    return list.length ? list.map(function (x) {
      return '<div class="line"><span class="n">' + esc(x.nazwa) + '</span><span class="bar ' + (cls || '') + '"><i style="width:' + Math.round(x.ile / max * 100) + '%"></i></span><b>' + x.ile + '</b></div>';
    }).join('') : '<div class="empty">Brak danych.</div>';
  }
  function line(n, v) { return '<div class="line"><span class="n">' + n + '</span>' + v + '</div>'; }
  var JOB = { terminy: 'Kontrola terminów i przypomnienia', watchdog: 'Samokontrola (poczta, Telegram, baza)', zadania: 'Zadania i eskalacje', prawo: 'Przepisy i stawki', faktury: 'Faktury z wFirma' };
  var DOC = { 'umowa-zlecenie': 'Komplety kadrowe', 'rejestracja-s24': 'Rejestracja S24', 'e-urzad': 'e-Urząd Skarbowy', 'nip-8': 'NIP-8', 'pelnomocnictwo': 'Uchwała o pełnomocniku', 'wynagrodzenie': 'Uchwała o wynagrodzeniu', 'zalacznik-pobyt': 'Załącznik do pobytu' };
  function docCount(d, type) { var x = d.dokumenty_30dni.filter(function (y) { return y.nazwa === type; })[0]; return x ? x.ile : 0; }

  // ---------------- numbers ----------------
  // m: module, c: colour when the number is not zero, v: value, h: where a click leads
  var TILES = {
    k_nowe: { m: 'Kadry', t: 'nowe zgłoszenia do sprawdzenia', c: 'red', h: 'zatrudnienie.html', v: function (d) { return d.kadry.nowe; } },
    k_wtoku: { m: 'Kadry', t: 'zgłoszenia w toku', c: 'amber', h: 'zatrudnienie.html', v: function (d) { return d.kadry.w_toku; } },
    k_zgl30: { m: 'Kadry', t: 'zgłoszeń w 30 dni', c: 'green', h: 'zatrudnienie.html', v: function (d) { return sum(d.kadry.zgloszenia_30dni, function (x) { return x.n; }); } },
    k_prac: { m: 'Kadry', t: 'pracowników pod opieką', c: 'green', h: 'rejestr.html', v: function (d) { return d.kadry.pracownicy; } },
    k_arch: { m: 'Kadry', t: 'osób w archiwum', c: '', h: 'rejestr.html', v: function (d) { return d.kadry.archiwum; } },
    k_cudz: { m: 'Kadry', t: 'cudzoziemców', c: '', h: 'rejestr.html', v: function (d) { return d.kadry.cudzoziemcy; } },
    k_bezterm: { m: 'Kadry', t: 'cudzoziemców bez terminu pobytu', c: 'amber', h: 'kontrola.html', v: function (d) { return d.kadry.bez_terminow_pobytu; } },
    k_dokpo: { m: 'Kadry', t: 'dokumenty pracowników po terminie', c: 'red', h: 'kontrola.html', v: function (d) { return d.kadry.dokumenty_po_terminie; } },
    k_dok30: { m: 'Kadry', t: 'dokumenty kończące się w 30 dni', c: 'amber', h: 'kontrola.html', v: function (d) { return d.kadry.dokumenty_30; } },
    k_um30: { m: 'Kadry', t: 'umowy kończące się w 30 dni', c: 'amber', h: 'kontrola.html', v: function (d) { return d.kadry.umowy_30; } },
    k_umpo: { m: 'Kadry', t: 'umowy po dacie końca', c: 'red', h: 'kontrola.html', v: function (d) { return d.kadry.umowy_po_terminie; } },
    k_term30: { m: 'Kadry', t: 'terminy w ciągu 30 dni (razem)', c: 'amber', h: 'kontrola.html', v: function (d) { return d.kadry.dokumenty_30 + d.kadry.umowy_30; } },
    k_firmy: { m: 'Kadry', t: 'firm z pracownikami', c: '', h: 'rejestr.html', v: function (d) { return d.kadry.firmy_z_pracownikami; } },
    z_otw: { m: 'Zadania', t: 'otwarte zadania', c: 'amber', h: 'zadania.html?w=wszystkie', v: function (d) { return d.zadania.otwarte; } },
    z_po: { m: 'Zadania', t: 'zadania po terminie', c: 'red', h: 'zadania.html?w=po', v: function (d) { return d.zadania.po_terminie; } },
    z_pilne: { m: 'Zadania', t: 'zadania pilne', c: 'amber', h: 'zadania.html?w=wszystkie', v: function (d) { return d.zadania.pilne; } },
    z_esk: { m: 'Zadania', t: 'zgłoszone właścicielowi', c: 'red', h: 'zadania.html?w=po', v: function (d) { return d.zadania.eskalowane; } },
    z_sys: { m: 'Zadania', t: 'zadania dopisane przez portal', c: '', h: 'zadania.html?w=wszystkie', v: function (d) { return d.zadania.z_systemu; } },
    z_done: { m: 'Zadania', t: 'zadań zrobionych w 7 dni', c: 'green', h: 'zadania.html?w=zrobione', v: function (d) { return d.zadania.zrobione7; } },
    o_firmy: { m: 'Księgowość', t: 'firm w onboardingu', c: '', h: 'onboarding.html', v: function (d) { return d.onboarding.firmy; } },
    o_postep: { m: 'Księgowość', t: 'średni postęp onboardingu', c: 'green', h: 'onboarding.html', v: function (d) { return d.onboarding.sredni_postep; }, f: function (n) { return n + '%'; } },
    o_po: { m: 'Księgowość', t: 'kroki onboardingu po terminie', c: 'red', h: 'onboarding.html?p=/deadlines', v: function (d) { return d.onboarding.zadania_po_terminie; } },
    o_czek: { m: 'Księgowość', t: 'kroków czeka na klienta', c: 'amber', h: 'onboarding.html?p=/deadlines', v: function (d) { return d.onboarding.czekamy_na_klienta; } },
    c_firmy: { m: 'Klienci', t: 'firm w bazie klientów', c: 'green', h: 'klienci.html', v: function (d) { return d.klienci.wszystkie; } },
    c_konta: { m: 'Klienci', t: 'kont w profilu klienta', c: '', h: 'dostep.html', v: function (d) { return d.klienci.konta_aktywne; } },
    c_log: { m: 'Klienci', t: 'logowań klientów w 7 dni', c: 'green', h: 'dostep.html', v: function (d) { return d.klienci.logowania_7dni; } },
    // modules added later: the function may be older than the page, so a missing branch reads as zero
    c_obsl: { m: 'Klienci', t: 'klientów obsługiwanych', c: 'green', h: 'klienci.html?k=obs', v: function (d) { return d.klienci.obslugiwani || 0; } },
    c_bezu: { m: 'Klienci', t: 'klientów bez umowy w bazie', c: 'red', h: 'klienci.html?k=bezU', v: function (d) { return d.klienci.bez_umowy || 0; } },
    c_bezp: { m: 'Klienci', t: 'klientów bez umowy powierzenia', c: 'red', h: 'klienci.html?k=bezP', v: function (d) { return d.klienci.bez_powierzenia || 0; } },
    c_tg: { m: 'Klienci', t: 'grup Telegram z problemem', c: 'amber', h: 'klienci.html?k=tg', v: function (d) { return d.klienci.telegram_problemy || 0; } },
    c_umspr: { m: 'Klienci', t: 'umów klientów do sprawdzenia', c: 'amber', h: 'klienci.html?k=spr', v: function (d) { return d.klienci.umowy_do_sprawdzenia || 0; } },
    pd_wer: { m: 'Kadry', t: 'podpisów czeka na weryfikację', c: 'amber', h: 'podpisy.html', v: function (d) { return (d.podpisy || {}).do_weryfikacji || 0; } },
    m_prop: { m: 'Poczta', t: 'wiadomości czeka na decyzję', c: 'amber', h: 'poczta.html', v: function (d) { return (d.poczta || {}).propozycje || 0; } },
    s_dzis: { m: 'SMS', t: 'SMS-ów wysłanych dziś', c: 'green', h: 'sms.html', v: function (d) { return (d.sms || {}).dzis || 0; } },
    t_bezprof: { m: 'Zespół', t: 'kont bez profilu pracownika', c: 'amber', h: 'zespol.html', v: function (d) { return (d.zespol || {}).bez_profilu || 0; } },
    d_all: { m: 'Dokumenty', t: 'dokumentów wygenerowanych w 30 dni', c: 'green', h: 'historia.html?s=spolka', v: function (d) { return sum(d.dokumenty_30dni, function (x) { return x.ile; }); } },
    d_kadry: { m: 'Dokumenty', t: 'kompletów kadrowych w 30 dni', c: 'green', h: 'historia.html?s=kadry', v: function (d) { return docCount(d, 'umowa-zlecenie'); } },
    d_leg: { m: 'Legalizacja pobytu', t: 'załączników do pobytu w 30 dni', c: 'green', h: 'historia.html?s=legalizacja', v: function (d) { return docCount(d, 'zalacznik-pobyt'); } },
    d_rej: { m: 'Spółka', t: 'pakietów rejestracji S24 w 30 dni', c: 'green', h: 'historia.html?s=spolka', v: function (d) { return docCount(d, 'rejestracja-s24'); } },
    a_bledy: { m: 'Automaty', t: 'automatów z błędem', c: 'red', h: 'kontrola.html#rem', v: function (d) { return d.automaty.filter(function (a) { return a.ok === false; }).length; } },
    a_przyp: { m: 'Automaty', t: 'przypomnień do klientów w 30 dni', c: 'green', h: 'kontrola.html#rem', v: function (d) { return d.powiadomienia_30dni.wyslane; } },
    p_zasady: { m: 'Przepisy', t: 'zasad do sprawdzenia po zmianie prawa', c: 'amber', h: 'wiedza.html', v: function (d) { return d.prawo.zasady_do_sprawdzenia; } },
  };

  // ---------------- panels ----------------
  // r(d, n): body for n rows; link: [href, label]
  var WIDGETS = {
    decyzje: { m: 'Zadania', t: 'Wymaga decyzji', link: ['zadania.html?w=po', 'zadania'], hint: 'Najstarsze zadania po terminie i sprawy zgłoszone właścicielowi.', r: function (d, n) {
      var z = d.zadania, k = d.kadry;
      return (z.najstarsze.length ? z.najstarsze.slice(0, n).map(function (t) { return line(esc(t.tytul) + '<br><small>odpowiada: ' + esc(who(t.assignee)) + '</small>', '<span class="pill p-red">od ' + pl(t.termin) + '</span>'); }).join('') : '<div class="empty">Nic po terminie.</div>') +
        line('Zgłoszone właścicielowi (rażące naruszenia)', '<b>' + z.eskalowane + '</b>') +
        line('Cudzoziemcy bez wpisanego terminu pobytu', '<span class="pill ' + (k.bez_terminow_pobytu ? 'p-amber' : 'p-ok') + '">' + k.bez_terminow_pobytu + ' z ' + k.cudzoziemcy + '</span>');
    } },
    zespol: { m: 'Zadania', t: 'Zespół', link: ['zadania.html?w=wszystkie', 'zadania'], hint: 'Otwarte, po terminie i zrobione w ostatnich 7 dniach.', r: function (d, n) {
      return d.zadania.zespol.length ? d.zadania.zespol.slice(0, n).map(function (p) {
        return line(esc(who(p.email)), '<span class="pill p-grey">otwarte ' + p.otwarte + '</span>' + (p.po_terminie ? '<span class="pill p-red">po terminie ' + p.po_terminie + '</span>' : '') + '<span class="pill p-ok">zrobione ' + p.zrobione7 + '</span>');
      }).join('') : '<div class="empty">Nie ma jeszcze zadań.</div>';
    } },
    pilne: { m: 'Zadania', t: 'Zadania pilne', link: ['zadania.html?w=wszystkie', 'zadania'], hint: 'Otwarte zadania oznaczone jako pilne.', r: function (d, n) {
      return d.zadania.pilne_lista.length ? d.zadania.pilne_lista.slice(0, n).map(function (t) { return line(esc(t.tytul) + '<br><small>' + esc(who(t.assignee)) + '</small>', t.termin ? '<span class="pill p-amber">' + pl(t.termin) + '</span>' : ''); }).join('') : '<div class="empty">Brak pilnych zadań.</div>';
    } },
    zgloszenia: { m: 'Kadry', t: 'Zgłoszenia z 30 dni', link: ['zatrudnienie.html', 'zgłoszenia'], hint: 'Ile osób klienci zgłosili do zatrudnienia, dzień po dniu.', r: function (d) {
      var k = d.kadry, max = Math.max.apply(null, k.zgloszenia_30dni.map(function (x) { return x.n; }).concat([1]));
      return '<div class="spark">' + k.zgloszenia_30dni.map(function (x) { return '<i class="' + (x.n ? '' : 'z') + '" style="height:' + Math.max(3, Math.round(x.n / max * 100)) + '%" title="' + pl(x.d) + ': ' + x.n + '"></i>'; }).join('') + '</div>' +
        line('Razem w 30 dni', '<b>' + sum(k.zgloszenia_30dni, function (x) { return x.n; }) + '</b>') + line('W toku', '<b>' + k.w_toku + '</b>') + line('Do sprawdzenia', '<b>' + k.nowe + '</b>');
    } },
    terminy: { m: 'Kadry', t: 'Najbliższe terminy pracowników', link: ['kontrola.html', 'kontrola'], hint: 'Dokumenty i umowy: ostatnie 30 dni po terminie i najbliższe 90 dni.', r: function (d, n) {
      var l = d.kadry.terminy_najblizsze;
      return l.length ? l.slice(0, n).map(function (t) {
        return line(esc(t.kto) + '<br><small>' + esc(t.firma) + ' · ' + esc(t.co) + '</small>', '<span class="pill ' + (t.dni < 0 ? 'p-red' : t.dni <= 30 ? 'p-amber' : 'p-grey') + '">' + pl(t.data) + (t.dni < 0 ? ' · po terminie' : ' · za ' + t.dni + ' dni') + '</span>');
      }).join('') : '<div class="empty">Brak terminów w najbliższych 90 dniach.</div>';
    } },
    firmy: { m: 'Kadry', t: 'Największe firmy', link: ['rejestr.html', 'rejestr'], hint: 'Według liczby pracowników pod opieką.', r: function (d, n) { return bars(d.kadry.top_firmy.slice(0, n)); } },
    kadry_stan: { m: 'Kadry', t: 'Kadry — stan', link: ['kontrola.html', 'kontrola'], hint: 'Najważniejsze liczby modułu kadrowego.', r: function (d) {
      var k = d.kadry;
      return line('Pracownicy pod opieką', '<b>' + k.pracownicy + '</b>') + line('Cudzoziemcy', '<b>' + k.cudzoziemcy + '</b>') + line('Bez wpisanego terminu pobytu', '<b>' + k.bez_terminow_pobytu + '</b>') +
        line('Dokumenty po terminie', '<b>' + k.dokumenty_po_terminie + '</b>') + line('Umowy kończące się w 30 dni', '<b>' + k.umowy_30 + '</b>') + line('Umowy po dacie końca', '<b>' + k.umowy_po_terminie + '</b>') + line('W archiwum', '<b>' + k.archiwum + '</b>');
    } },
    onboarding: { m: 'Księgowość', t: 'Onboarding klientów', link: ['onboarding.html', 'onboarding'], hint: 'Postęp każdej firmy; najpierw te z krokami po terminie.', r: function (d, n) {
      var o = d.onboarding;
      return '<p class="hint" style="margin-top:-6px">' + o.firmy + ' firm · średni postęp ' + o.sredni_postep + '% · czekamy na klienta: ' + o.czekamy_na_klienta + '</p>' + (o.lista.length ? o.lista.slice(0, n).map(function (x) {
        return '<div class="line"><a class="n" href="onboarding.html?p=/clients/' + esc(x.id) + '">' + esc(x.nazwa) + '</a>' + (x.po_terminie ? '<span class="pill p-red">' + x.po_terminie + ' po terminie</span>' : '') + '<span class="bar g"><i style="width:' + x.pct + '%"></i></span><b>' + x.pct + '%</b></div>';
      }).join('') : '<div class="empty">Brak firm w onboardingu.</div>');
    } },
    opiekunowie: { m: 'Klienci', t: 'Klienci według opiekuna', link: ['klienci.html', 'baza klientów'], hint: 'Ile firm prowadzi każdy opiekun.', r: function (d, n) { return bars(d.klienci.opiekunowie.slice(0, n)); } },
    formy: { m: 'Klienci', t: 'Formy prawne klientów', link: ['klienci.html', 'baza klientów'], hint: 'Struktura bazy klientów.', r: function (d, n) { return bars(d.klienci.formy.slice(0, n)); } },
    klienci_stan: { m: 'Klienci', t: 'Baza klientów — stan', link: ['klienci.html', 'baza klientów'], hint: 'Obsługa, umowy w bazie i grupy Telegram klientów.', r: function (d) {
      var c = d.klienci, n = function (v, zly) { return '<span class="pill ' + (v ? zly : 'p-ok') + '">' + (v || 0) + '</span>'; };
      if (c.obslugiwani == null) return '<div class="empty">Brak danych.</div>';
      return line('Obsługiwani', '<b>' + c.obslugiwani + '</b>') + line('Wstrzymani', '<b>' + c.wstrzymani + '</b>') + line('Obsługa zakończona', '<b>' + c.zakonczeni + '</b>') +
        line('<a href="klienci.html?k=bezU">Bez umowy w bazie</a>', n(c.bez_umowy, 'p-red')) + line('<a href="klienci.html?k=bezP">Bez umowy powierzenia</a>', n(c.bez_powierzenia, 'p-red')) +
        line('<a href="klienci.html?k=tg">Grupy Telegram z problemem</a>', n(c.telegram_problemy, 'p-amber')) + line('<a href="klienci.html?k=spr">Dokumenty do sprawdzenia</a>', n(c.umowy_do_sprawdzenia, 'p-amber')) +
        line('<a href="klienci.html?k=nikt">Bez opiekuna i kadrowej</a>', n(c.bez_opieki, 'p-amber'));
    } },
    nowe_moduly: { m: 'Ogólne', t: 'Podpisy, poczta, SMS, zespół', link: null, hint: 'Co czeka na człowieka w nowszych modułach.', r: function (d) {
      var p = d.podpisy || {}, m = d.poczta || {}, s = d.sms || {}, z = d.zespol || {}, n = function (v) { return '<span class="pill ' + (v ? 'p-amber' : 'p-ok') + '">' + (v || 0) + '</span>'; };
      return line('<a href="podpisy.html">Podpisy do weryfikacji</a>', n(p.do_weryfikacji)) + line('<a href="podpisy.html">Otwarte pakiety podpisów</a>', '<b>' + (p.pakiety_otwarte || 0) + '</b>') +
        line('<a href="poczta.html">Poczta — czeka na decyzję</a>', n(m.propozycje)) +
        line('<a href="sms.html">SMS dziś' + (s.wlaczone ? '' : ' (tryb testowy)') + '</a>', (s.dzis_test ? '<span class="pill p-grey">próbne ' + s.dzis_test + '</span>' : '') + '<b>' + (s.dzis || 0) + '</b>') +
        line('<a href="sms.html">SMS — błędy w 7 dni</a>', '<span class="pill ' + (s.bledy_7dni ? 'p-red' : 'p-ok') + '">' + (s.bledy_7dni || 0) + '</span>') +
        line('<a href="zespol.html">Konta bez profilu pracownika</a>', n(z.bez_profilu)) + line('<a href="zespol.html">Profile bez czatu Telegram</a>', n(z.bez_telegrama));
    } },
    konta: { m: 'Klienci', t: 'Profil klienta', link: ['dostep.html', 'konta klientów'], hint: 'Konta klientów i ich aktywność.', r: function (d) {
      var c = d.klienci;
      return line('Aktywne konta', '<b>' + c.konta_aktywne + '</b>') + line('Z ustawionym hasłem', '<b>' + c.konta_z_haslem + '</b>') + line('Logowania w 7 dni', '<b>' + c.logowania_7dni + '</b>') + line('Firm w bazie klientów', '<b>' + c.wszystkie + '</b>');
    } },
    automaty: { m: 'Automaty', t: 'Automaty', link: ['kontrola.html#rem', 'przypomnienia'], hint: 'Ostatni przebieg każdego zadania, które portal wykonuje sam.', r: function (d) {
      return d.automaty.map(function (a) {
        var p = a.ok === true ? ['działa', 'p-ok'] : a.ok === false ? ['błąd', 'p-red'] : a.ostatnio ? ['w toku', 'p-grey'] : ['nie uruchomione', 'p-grey'];
        return line(esc(JOB[a.zadanie] || a.zadanie) + '<br><small>' + when(a.ostatnio) + (a.problem ? ' · ' + esc(String(a.problem).slice(0, 90)) : '') + '</small>', '<span class="pill ' + p[1] + '">' + p[0] + '</span>');
      }).join('') +
        line('Przypomnienia do klientów (30 dni)', '<span class="pill p-ok">' + d.powiadomienia_30dni.wyslane + ' wysłane</span>' + (d.powiadomienia_30dni.bledy ? '<span class="pill p-red">' + d.powiadomienia_30dni.bledy + ' błędy</span>' : '')) +
        line('Faktury — ostatnia synchronizacja', '<span class="pill ' + (d.faktury.ostatnia_synchronizacja && Date.now() - Date.parse(d.faktury.ostatnia_synchronizacja) < 26 * 3600000 ? 'p-ok' : 'p-red') + '">' + (d.faktury.ostatnia_synchronizacja ? pl(d.faktury.ostatnia_synchronizacja) : 'brak') + '</span>');
    } },
    dokumenty: { m: 'Dokumenty', t: 'Wygenerowane dokumenty (30 dni)', link: null, hint: 'Ile dokumentów zespół przygotował w portalu.', r: function (d, n) { return bars(d.dokumenty_30dni.slice(0, n).map(function (x) { return { nazwa: DOC[x.nazwa] || x.nazwa, ile: x.ile }; })); } },
    aktywnosc: { m: 'Ogólne', t: 'Ostatnia aktywność', link: null, hint: 'Co działo się w portalu w ostatnich 14 dniach, we wszystkich modułach.', r: function (d, n) {
      return d.aktywnosc.length ? d.aktywnosc.slice(0, n).map(function (a) { return line(esc(a.tekst) + '<br><small>' + when(a.at) + '</small>', '<span class="pill p-grey">' + esc(a.modul) + '</span>'); }).join('') : '<div class="empty">Brak aktywności.</div>';
    } },
    prawo: { m: 'Przepisy', t: 'Przepisy', link: ['wiedza.html', 'baza wiedzy'], hint: 'Czy zmieniły się ustawy, na których opiera się portal.', r: function (d) {
      var p = d.prawo;
      return line('Obserwowane akty prawne', '<b>' + p.akty + '</b>') + line('Zasady do sprawdzenia', '<span class="pill ' + (p.zasady_do_sprawdzenia ? 'p-amber' : 'p-ok') + '">' + p.zasady_do_sprawdzenia + '</span>') +
        (p.zmienione_akty.length ? p.zmienione_akty.map(function (a) { return line(esc(a), '<span class="pill p-red">zmiana</span>'); }).join('') : '<div class="empty">Bez zmian w obserwowanych ustawach.</div>');
    } },
  };

  var DEFAULT = {
    tiles: ['k_nowe', 'z_po', 'k_dokpo', 'o_po', 'k_term30', 'z_otw', 'k_prac', 'c_firmy', 'm_prop', 'pd_wer'],
    widgets: [['decyzje', 1, 6], ['zespol', 1, 6], ['terminy', 1, 6], ['zgloszenia', 1, 6], ['onboarding', 1, 8], ['klienci_stan', 1, 8], ['nowe_moduly', 1, 8], ['opiekunowie', 1, 6], ['automaty', 1, 6], ['aktywnosc', 1, 8]],
    refresh: 0, dense: false,
  };
  function load() {
    var s; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    s = s && Array.isArray(s.tiles) && Array.isArray(s.widgets) ? s : JSON.parse(JSON.stringify(DEFAULT));
    s.tiles = s.tiles.filter(function (id) { return TILES[id]; });
    s.widgets = s.widgets.filter(function (w) { return WIDGETS[w[0]]; });
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }
  var cfg = load(), data = null, edit = false, timer = null;

  // ---------------- drawing ----------------
  function draw() {
    document.body.classList.toggle('pd-edit', edit);
    document.body.classList.toggle('pd-dense', !!cfg.dense);
    $('pdEdit').textContent = edit ? '✓ Gotowe' : '⚙ Dostosuj pulpit';
    if (!data) return;
    $('tiles').innerHTML = cfg.tiles.map(function (id) {
      var t = TILES[id], n = t.v(data), txt = t.f ? t.f(n) : n;
      return '<a class="tile ' + (n ? t.c : 'zero') + '" href="' + (edit ? '#' : t.h) + '" data-tile="' + id + '" draggable="' + edit + '"><b>' + txt + '</b><span>' + esc(t.t) + '</span>' +
        (edit ? '<em class="pd-mod">' + esc(t.m) + '</em><button type="button" class="pd-x" data-rm-tile="' + id + '" title="Ukryj">×</button>' : '') + '</a>';
    }).join('') || (edit ? '' : '<div class="empty">Brak kafelków — dodaj je w „Dostosuj pulpit”.</div>');
    $('cols').innerHTML = cfg.widgets.map(function (w) {
      var id = w[0], W = WIDGETS[id], span = w[1] || 1, rows = w[2] || 6;
      return '<div class="box span' + span + '" data-widget="' + id + '" draggable="' + edit + '">' +
        '<h2><span>' + esc(W.t) + '</span>' + (edit
          ? '<span class="pd-ctl"><button type="button" data-w="left" title="Przesuń wcześniej">←</button><button type="button" data-w="right" title="Przesuń dalej">→</button>' +
            '<button type="button" data-w="span" title="Szerokość">' + ['wąski', 'szeroki', 'pełny'][span === 4 ? 2 : span - 1] + '</button>' +
            '<select data-w="rows" title="Liczba wierszy">' + [3, 5, 6, 8, 12, 20].map(function (n) { return '<option' + (n === rows ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>' +
            '<button type="button" data-w="rm" title="Ukryj">×</button></span>'
          : (W.link ? '<a href="' + W.link[0] + '">' + W.link[1] + ' →</a>' : '')) + '</h2>' +
        (W.hint ? '<p class="hint">' + W.hint + '</p>' : '') + W.r(data, rows) + '</div>';
    }).join('');
    $('stamp').textContent = 'Stan na ' + new Date(data.na_dzien).toLocaleString('pl-PL') + (cfg.refresh ? ' · odświeża się co ' + cfg.refresh + ' min' : ' · odśwież stronę, aby zaktualizować');
    if (edit) drawLibrary();
    $('pdLib').hidden = !edit;
  }
  function drawLibrary() {
    var group = function (reg, used, attr) {
      var by = {};
      Object.keys(reg).forEach(function (id) { if (used.indexOf(id) === -1) (by[reg[id].m] = by[reg[id].m] || []).push(id); });
      var mods = Object.keys(by).sort();
      return mods.length ? mods.map(function (m) {
        return '<div class="pd-g"><b>' + esc(m) + '</b>' + by[m].map(function (id) { return '<button type="button" class="pd-add" ' + attr + '="' + id + '">+ ' + esc(reg[id].t) + '</button>'; }).join('') + '</div>';
      }).join('') : '<div class="empty">Wszystko jest już na pulpicie.</div>';
    };
    $('pdLib').innerHTML =
      '<h2>Ustawienia pulpitu</h2><p class="hint">Przeciągaj kafelki i panele, aby zmienić kolejność. Każdy panel ma własną szerokość i liczbę wierszy. Układ zapisuje się w tej przeglądarce.</p>' +
      '<div class="pd-opts"><label>Odświeżanie <select id="pdRefresh">' + [[0, 'ręcznie'], [1, 'co 1 min'], [5, 'co 5 min'], [15, 'co 15 min']].map(function (o) { return '<option value="' + o[0] + '"' + (cfg.refresh === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label><input type="checkbox" id="pdDense"' + (cfg.dense ? ' checked' : '') + ' /> widok kompaktowy</label>' +
      '<button type="button" class="pd-btn" id="pdAll">Pokaż wszystko</button><button type="button" class="pd-btn" id="pdReset">Przywróć układ domyślny</button></div>' +
      '<h3>Kafelki z liczbami — do dodania</h3>' + group(TILES, cfg.tiles, 'data-add-tile') +
      '<h3>Panele — do dodania</h3>' + group(WIDGETS, cfg.widgets.map(function (w) { return w[0]; }), 'data-add-widget');
  }

  // ---------------- arranging ----------------
  function idx(id) { for (var i = 0; i < cfg.widgets.length; i++) if (cfg.widgets[i][0] === id) return i; return -1; }
  function move(arr, from, to) { if (to < 0 || to >= arr.length || from === to) return; arr.splice(to, 0, arr.splice(from, 1)[0]); }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('#pdEdit')) { edit = !edit; return draw(); }
    if (!edit) return;
    var a;
    if ((a = t.closest('[data-rm-tile]'))) { e.preventDefault(); cfg.tiles = cfg.tiles.filter(function (x) { return x !== a.getAttribute('data-rm-tile'); }); }
    else if ((a = t.closest('[data-add-tile]'))) cfg.tiles.push(a.getAttribute('data-add-tile'));
    else if ((a = t.closest('[data-add-widget]'))) cfg.widgets.push([a.getAttribute('data-add-widget'), 1, 6]);
    else if (t.closest('#pdReset')) { if (!confirm('Przywrócić domyślny układ pulpitu?')) return; cfg = JSON.parse(JSON.stringify(DEFAULT)); schedule(); }
    else if (t.closest('#pdAll')) { cfg.tiles = Object.keys(TILES); var have = cfg.widgets.map(function (w) { return w[0]; }); Object.keys(WIDGETS).forEach(function (id) { if (have.indexOf(id) === -1) cfg.widgets.push([id, 1, 6]); }); }
    else if ((a = t.closest('[data-w]')) && a.tagName === 'BUTTON') {
      var i = idx(a.closest('[data-widget]').getAttribute('data-widget')), act = a.getAttribute('data-w');
      if (act === 'left') move(cfg.widgets, i, i - 1);
      if (act === 'right') move(cfg.widgets, i, i + 1);
      if (act === 'span') cfg.widgets[i][1] = cfg.widgets[i][1] === 1 ? 2 : cfg.widgets[i][1] === 2 ? 4 : 1;
      if (act === 'rm') cfg.widgets.splice(i, 1);
    }
    else if (t.closest('a.tile')) { e.preventDefault(); return; }
    else return;
    save(); draw();
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.getAttribute('data-w') === 'rows') { cfg.widgets[idx(t.closest('[data-widget]').getAttribute('data-widget'))][2] = Number(t.value); }
    else if (t.id === 'pdRefresh') { cfg.refresh = Number(t.value); schedule(); }
    else if (t.id === 'pdDense') cfg.dense = t.checked;
    else return;
    save(); draw();
  });
  // drag and drop: tiles among tiles, panels among panels
  var drag = null;
  document.addEventListener('dragstart', function (e) {
    var el = e.target.closest && e.target.closest('[data-tile],[data-widget]');
    if (!edit || !el) return;
    drag = el.hasAttribute('data-tile') ? ['tile', el.getAttribute('data-tile')] : ['widget', el.getAttribute('data-widget')];
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', drag[1]); } catch (err) {}
    el.classList.add('pd-drag');
  });
  document.addEventListener('dragover', function (e) {
    if (!drag) return;
    var el = e.target.closest && e.target.closest(drag[0] === 'tile' ? '[data-tile]' : '[data-widget]');
    if (el) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  });
  document.addEventListener('drop', function (e) {
    if (!drag) return;
    var el = e.target.closest && e.target.closest(drag[0] === 'tile' ? '[data-tile]' : '[data-widget]');
    if (!el) return;
    e.preventDefault();
    if (drag[0] === 'tile') { move(cfg.tiles, cfg.tiles.indexOf(drag[1]), cfg.tiles.indexOf(el.getAttribute('data-tile'))); }
    else move(cfg.widgets, idx(drag[1]), idx(el.getAttribute('data-widget')));
    drag = null; save(); draw();
  });
  document.addEventListener('dragend', function () { drag = null; var d = document.querySelector('.pd-drag'); if (d) d.classList.remove('pd-drag'); });

  // ---------------- data ----------------
  async function fetchData() {
    if (!window.sb) return;
    try {
      var sess = await window.sb.auth.getSession();
      var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
      var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: '{}' });
      var out = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
      data = out;
      if (!edit) draw(); // never redraw under the user's hands while arranging
    } catch (e) {
      if (!data) $('tiles').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }
  function schedule() {
    if (timer) clearInterval(timer);
    timer = cfg.refresh ? setInterval(function () { if (!document.hidden) fetchData(); }, cfg.refresh * 60000) : null;
  }
  draw(); schedule(); fetchData();
})();
