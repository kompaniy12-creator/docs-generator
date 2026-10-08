/* Pulpit: the administrator's dashboard. One call to the `pulpit` edge function returns the
   aggregated state (staff, tasks, onboarding, clients, automation); this file only draws it. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/pulpit';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function when(iso) { return iso ? new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'jeszcze nie'; }
  function who(e) { return (e || '').split('@')[0]; }
  function tile(n, label, href, cls) { return '<a class="tile ' + (n ? (cls || '') : 'zero') + '" href="' + href + '"><b>' + n + '</b><span>' + label + '</span></a>'; }
  function box(title, link, hint, body) {
    return '<div class="box"><h2><span>' + title + '</span>' + (link ? '<a href="' + link[0] + '">' + link[1] + ' →</a>' : '') + '</h2>' + (hint ? '<p class="hint">' + hint + '</p>' : '') + body + '</div>';
  }
  function bars(list, max, cls) {
    return list.length ? list.map(function (x) {
      return '<div class="line"><span class="n">' + esc(x.nazwa) + '</span><span class="bar ' + (cls || '') + '"><i style="width:' + Math.round(x.ile / max * 100) + '%"></i></span><b>' + x.ile + '</b></div>';
    }).join('') : '<div class="empty">Brak danych.</div>';
  }
  var JOB = { terminy: 'Kontrola terminów i przypomnienia', watchdog: 'Samokontrola (poczta, Telegram, baza)', zadania: 'Zadania i eskalacje', prawo: 'Przepisy i stawki', faktury: 'Faktury z wFirma' };
  var DOC = { 'umowa-zlecenie': 'Komplety kadrowe', 'rejestracja-s24': 'Rejestracja S24', 'e-urzad': 'e-Urząd Skarbowy', 'nip-8': 'NIP-8', 'pelnomocnictwo': 'Uchwała o pełnomocniku', 'wynagrodzenie': 'Uchwała o wynagrodzeniu', 'zalacznik-pobyt': 'Załącznik do pobytu' };

  function render(d) {
    var k = d.kadry, z = d.zadania, o = d.onboarding, c = d.klienci;
    $('tiles').innerHTML =
      tile(k.nowe, 'nowe zgłoszenia do sprawdzenia', 'zatrudnienie.html', 'red') +
      tile(z.po_terminie, 'zadania po terminie', 'zadania.html?w=po', 'red') +
      tile(k.dokumenty_po_terminie, 'dokumenty pracowników po terminie', 'kontrola.html', 'red') +
      tile(o.zadania_po_terminie, 'kroki onboardingu po terminie', 'onboarding.html?p=/deadlines', 'red') +
      tile(k.dokumenty_30 + k.umowy_30, 'terminy w ciągu 30 dni', 'kontrola.html', 'amber') +
      tile(z.otwarte, 'otwarte zadania', 'zadania.html?w=wszystkie', 'amber') +
      tile(k.pracownicy, 'pracowników pod opieką', 'rejestr.html', 'green') +
      tile(c.wszystkie, 'firm w bazie klientów', 'rejestr.html', 'green');

    var max = Math.max.apply(null, k.zgloszenia_30dni.map(function (x) { return x.n; }).concat([1]));
    var sum = k.zgloszenia_30dni.reduce(function (a, x) { return a + x.n; }, 0);
    var cols = '';

    cols += box('Wymaga decyzji', ['zadania.html?w=po', 'zadania'], 'Najstarsze zadania po terminie i sprawy zgłoszone właścicielowi.',
      (z.najstarsze.length ? z.najstarsze.map(function (t) {
        return '<div class="line"><span class="n">' + esc(t.tytul) + '<br><small>odpowiada: ' + esc(who(t.assignee)) + '</small></span><span class="pill p-red">od ' + pl(t.termin) + '</span></div>';
      }).join('') : '<div class="empty">Nic po terminie.</div>') +
      '<div class="line"><span class="n">Zgłoszone właścicielowi (rażące naruszenia)</span><b>' + z.eskalowane + '</b></div>' +
      '<div class="line"><span class="n">Cudzoziemcy bez wpisanego terminu pobytu</span><span class="pill ' + (k.bez_terminow_pobytu ? 'p-amber' : 'p-ok') + '">' + k.bez_terminow_pobytu + ' z ' + k.cudzoziemcy + '</span></div>' +
      (d.prawo.zasady_do_sprawdzenia || d.prawo.zmienione_akty.length ? '<div class="line"><span class="n">Zmienione przepisy do sprawdzenia: ' + esc(d.prawo.zmienione_akty.join(', ') || '—') + '</span><a class="pill p-amber" href="wiedza.html">' + d.prawo.zasady_do_sprawdzenia + ' zasad</a></div>' : ''));

    cols += box('Zespół', ['zadania.html?w=wszystkie', 'zadania'], 'Zadania każdej osoby: otwarte, po terminie i zrobione w ostatnich 7 dniach.',
      z.zespol.length ? z.zespol.map(function (p) {
        return '<div class="line"><span class="n">' + esc(p.email === 'system' ? 'portal' : who(p.email)) + '</span>' +
          '<span class="pill p-grey">otwarte ' + p.otwarte + '</span>' + (p.po_terminie ? '<span class="pill p-red">po terminie ' + p.po_terminie + '</span>' : '') + '<span class="pill p-ok">zrobione ' + p.zrobione7 + '</span></div>';
      }).join('') : '<div class="empty">Nie ma jeszcze zadań.</div>');

    cols += box('Kadry — zgłoszenia z 30 dni', ['kontrola.html', 'kontrola'], 'Razem ' + sum + ' · w toku: ' + k.w_toku + ' · w archiwum: ' + k.archiwum + ' osób.',
      '<div class="spark" title="zgłoszenia dziennie">' + k.zgloszenia_30dni.map(function (x) { return '<i class="' + (x.n ? '' : 'z') + '" style="height:' + Math.max(3, Math.round(x.n / max * 100)) + '%" title="' + pl(x.d) + ': ' + x.n + '"></i>'; }).join('') + '</div>' +
      '<div class="line"><span class="n">Umowy kończące się w 30 dni</span><b>' + k.umowy_30 + '</b></div>' +
      '<div class="line"><span class="n">Umowy po dacie końca</span><b>' + k.umowy_po_terminie + '</b></div>' +
      '<div class="line"><span class="n">Firmy z pracownikami</span><b>' + k.firmy_z_pracownikami + '</b></div>');

    cols += box('Największe firmy', ['rejestr.html', 'rejestr'], 'Według liczby pracowników pod opieką.', bars(k.top_firmy, k.top_firmy.length ? k.top_firmy[0].ile : 1));

    cols += box('Księgowość — onboarding', ['onboarding.html', 'onboarding'], o.firmy + ' firm · średni postęp ' + o.sredni_postep + '% · czekamy na klienta: ' + o.czekamy_na_klienta,
      o.lista.length ? o.lista.map(function (x) {
        return '<div class="line"><a class="n" style="color:inherit;text-decoration:none" href="onboarding.html?p=/clients/' + esc(x.id) + '">' + esc(x.nazwa) + '</a>' +
          (x.po_terminie ? '<span class="pill p-red">' + x.po_terminie + ' po terminie</span>' : '') + '<span class="bar g"><i style="width:' + x.pct + '%"></i></span><b>' + x.pct + '%</b></div>';
      }).join('') : '<div class="empty">Brak firm w onboardingu.</div>');

    cols += box('Klienci', ['dostep.html', 'konta klientów'], 'Opiekunowie i profile klientów.',
      bars(c.opiekunowie, c.opiekunowie.length ? c.opiekunowie[0].ile : 1) +
      '<div class="line"><span class="n">Konta w profilu klienta</span><b>' + c.konta_aktywne + '</b></div>' +
      '<div class="line"><span class="n">— z ustawionym hasłem</span><b>' + c.konta_z_haslem + '</b></div>' +
      '<div class="line"><span class="n">Logowania klientów w 7 dni</span><b>' + c.logowania_7dni + '</b></div>');

    cols += box('Automaty', ['kontrola.html#rem', 'przypomnienia'], 'Ostatni przebieg każdego zadania, które portal wykonuje sam.',
      d.automaty.map(function (a) {
        var p = a.ok === true ? ['działa', 'p-ok'] : a.ok === false ? ['błąd', 'p-red'] : a.ostatnio ? ['w toku', 'p-grey'] : ['nie uruchomione', 'p-grey'];
        return '<div class="line"><span class="n">' + esc(JOB[a.zadanie] || a.zadanie) + '<br><small>' + when(a.ostatnio) + (a.problem ? ' · ' + esc(String(a.problem).slice(0, 90)) : '') + '</small></span><span class="pill ' + p[1] + '">' + p[0] + '</span></div>';
      }).join('') +
      '<div class="line"><span class="n">Przypomnienia do klientów (30 dni)</span><span class="pill p-ok">' + d.powiadomienia_30dni.wyslane + ' wysłane</span>' + (d.powiadomienia_30dni.bledy ? '<span class="pill p-red">' + d.powiadomienia_30dni.bledy + ' błędy</span>' : '') + '</div>' +
      '<div class="line"><span class="n">Faktury — ostatnia synchronizacja z wFirma</span><span class="pill ' + (d.faktury.ostatnia_synchronizacja && Date.now() - Date.parse(d.faktury.ostatnia_synchronizacja) < 26 * 3600000 ? 'p-ok' : 'p-red') + '">' + (d.faktury.ostatnia_synchronizacja ? pl(d.faktury.ostatnia_synchronizacja) : 'brak') + '</span></div>');

    var docs = d.dokumenty_30dni.map(function (x) { return { nazwa: DOC[x.nazwa] || x.nazwa, ile: x.ile }; });
    cols += box('Wygenerowane dokumenty (30 dni)', null, 'Ile dokumentów zespół przygotował w portalu.', bars(docs, docs.length ? docs[0].ile : 1));

    $('cols').innerHTML = cols;
    $('stamp').textContent = 'Stan na ' + new Date(d.na_dzien).toLocaleString('pl-PL') + ' · odśwież stronę, aby zaktualizować';
  }

  async function load() {
    if (!window.sb) return;
    try {
      var sess = await window.sb.auth.getSession();
      var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
      var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: '{}' });
      var out = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
      render(out);
    } catch (e) {
      $('tiles').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }
  load();
})();
