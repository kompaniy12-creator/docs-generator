/* Asystenci AI — tryb testowy (administrators on the testers list only).
   Everything goes through the `asystent` edge function, which checks the caller on every action; this
   page holds no privileged key. An assistant only PREPARES: the page shows drafts with "Kopiuj" and, where
   an assistant proposes a task, a button that creates it for the signed-in administrator through the
   ordinary tasks table (the same insert as zadania.html). Nothing is sent to anybody from here. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/asystent';
  var STAN = { dziala: ['działa', 'p-ok'], ograniczenia: ['działa z ograniczeniami', 'p-amber'], dopracowanie: ['wymaga dopracowania', 'p-red'] };
  var STATUS = { w_toku: ['w toku', 'p-navy'], gotowe: ['gotowe', 'p-ok'], blad: ['błąd', 'p-red'], odmowa: ['odmowa modelu', 'p-red'], limit: ['przerwane limitem', 'p-amber'], przerwany: ['przerwane', 'p-amber'] };
  var KANAL = { email: 'E-mail', sms: 'SMS', telegram: 'Telegram / bot', zgloszenie: 'Zgłoszenie do biura (propozycja — nie wysłane)', notatka: 'Notatka' };
  var ZRODLO = { dane_portalu: 'dane portalu', baza_wiedzy: 'baza wiedzy', terminy: 'silnik terminów', plik: 'załączony plik', wiadomosc: 'wiadomość', wejscie: 'wpisane dane' };
  var LISTA = { ok: ['ok', 'p-ok'], brak: ['brak', 'p-red'], nieznane: ['nieznane', 'p-amber'] };
  var MAX_PLIK = 10 * 1024 * 1024;

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function show(msg, type) { $('status').textContent = msg || ''; $('status').className = 'status ' + (msg ? type || 'success' : ''); }
  function fmt(iso) { return iso ? new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; }
  function usd(n) { n = Number(n) || 0; return '$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(3)); }
  function tok(r) { return (r.tokeny_we || 0) + (r.tokeny_wy || 0) + (r.tokeny_cache_r || 0) + (r.tokeny_cache_w || 0); }
  function liczba(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function pill(p) { return '<span class="pill ' + p[1] + '">' + esc(p[0]) + '</span>'; }

  var D = null, me = '', klienci = null, otwarty = null, biezacy = null, timer = null;

  async function post(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) { var e = new Error(out.error || ('Błąd ' + res.status)); e.status = res.status; throw e; }
    return out;
  }
  function def(id) { return D.asystenci.filter(function (a) { return a.id === id; })[0] || null; }

  // ---------------- page ----------------
  function renderTop() {
    var u = D.ustawienia, d = D.dzis;
    $('banner').innerHTML = '<b>Tryb testowy.</b> Każde uruchomienie wysyła dane (zamaskowane: bez PESEL, numerów dokumentów, rachunków i telefonów) oraz wgrane pliki do dostawcy modelu: <b>' + esc(D.dostawca) + '</b>. ' +
      'To przekazanie danych <b>nie jest jeszcze opisane w klauzuli informacyjnej ani w umowach powierzenia</b> — dlatego asystenci działają tylko dla testerów. ' +
      'To, co dostał model, i jego odpowiedź są zapisywane w dzienniku do Twojej oceny przez <b>' + esc(u.retencja_dni) + ' dni</b>; wgrane pliki — tylko gdy zaznaczysz „zachowaj do oceny”.';
    var t = [
      [d.moje + ' / ' + u.limity.dziennie_osoba, 'Twoje uruchomienia dziś', d.moje ? '' : 'zero'],
      [d.razem + ' / ' + u.limity.dziennie_razem, 'Wszystkie uruchomienia dziś', d.razem ? '' : 'zero'],
      [usd(d.koszt_usd), 'Szacowany koszt dziś (limit ' + usd(u.limity.koszt_dzien_usd) + ')', d.koszt_usd >= u.limity.koszt_dzien_usd * 0.8 ? 'amber' : d.koszt_usd ? '' : 'zero'],
      [D.asystenci.filter(function (a) { return a.wlaczony; }).length + ' / ' + D.asystenci.length, 'Asystenci włączeni', ''],
    ];
    $('tiles').innerHTML = t.map(function (x) { return '<div class="tile ' + x[2] + '"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('');
    if (!D.model_gotowy) show('Funkcja nie ma klucza dostępu do modelu (ANTHROPIC_API_KEY) — asystentów nie da się uruchomić.', 'error');
  }
  function karta(a) {
    return '<div class="doc' + (otwarty === a.id ? ' on' : '') + '" data-id="' + esc(a.id) + '"><div class="n"><strong>' + a.nr + '. ' + esc(a.nazwa) + '</strong>' +
      '<small>' + esc(a.opis) + '</small><small><b>Czyta:</b> ' + esc(a.czyta) + '</small>' +
      pill(STAN[a.stan] || STAN.dziala) + '<span class="pill p-grey">' + esc(a.model) + '</span>' + (a.wlaczony ? '' : '<span class="pill p-red">wyłączony</span>') +
      (a.stan_powod ? '<small>' + esc(a.stan_powod) + '</small>' : '') + '</div>' +
      '<div class="acts"><label><input type="checkbox" data-toggle="' + esc(a.id) + '"' + (a.wlaczony ? ' checked' : '') + ' /> włączony</label>' +
      '<button class="mini ok" type="button" data-open="' + esc(a.id) + '"' + (a.wlaczony ? '' : ' disabled') + '>Otwórz</button></div></div>';
  }
  function renderLists() {
    $('listStaff').innerHTML = D.asystenci.filter(function (a) { return a.odbiorca === 'staff'; }).map(karta).join('');
    $('listKlient').innerHTML = D.asystenci.filter(function (a) { return a.odbiorca === 'klient'; }).map(karta).join('');
  }
  function renderSettings() {
    var u = D.ustawienia;
    $('sTesters').value = u.testerzy.join('\n');
    $('sOsoba').value = u.limity.dziennie_osoba; $('sRazem').value = u.limity.dziennie_razem; $('sKoszt').value = u.limity.koszt_dzien_usd; $('sRet').value = u.retencja_dni;
    $('sRu').checked = !!u.ru_auto;
    $('sModels').innerHTML = D.asystenci.map(function (a) {
      return '<div><label for="m_' + esc(a.id) + '">' + a.nr + '. ' + esc(a.nazwa) + '</label><select id="m_' + esc(a.id) + '" data-model="' + esc(a.id) + '">' + D.modele.map(function (m) {
        return '<option value="' + esc(m.id) + '"' + (m.id === a.model ? ' selected' : '') + '>' + esc(m.id) + (m.id === a.model_domyslny ? ' (domyślny)' : '') + '</option>';
      }).join('') + '</select></div>';
    }).join('');
    $('sModelHint').textContent = 'Domyślny wybór jest w kodzie; tu można go zmienić na czas testów. Cennik (USD za 1 mln tokenów, wejście / wyjście): ' + D.modele.map(function (m) { return m.id + ' — ' + m.cena.we + ' / ' + m.cena.wy; }).join('; ') + '.';
    $('hHint').textContent = 'Tokeny i koszt są szacowane z cennika dostawcy zapisanego w kodzie; rozliczeniem jest faktura dostawcy. Dziennik przechowuje uruchomienia ' + u.retencja_dni + ' dni.';
  }
  function zbierzUstawienia() {
    var modele = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-model]'), function (s) { var a = def(s.getAttribute('data-model')); if (a && s.value !== a.model_domyslny) modele[a.id] = s.value; });
    return {
      testerzy: $('sTesters').value.split(/[\s,;]+/).filter(Boolean),
      wylaczone: D.asystenci.filter(function (a) { return !a.wlaczony; }).map(function (a) { return a.id; }),
      limity: { dziennie_osoba: Number($('sOsoba').value), dziennie_razem: Number($('sRazem').value), koszt_dzien_usd: Number($('sKoszt').value) },
      retencja_dni: Number($('sRet').value), ru_auto: $('sRu').checked, modele: modele,
    };
  }
  async function zapiszUstawienia(msgEl) {
    try {
      await post({ action: 'ustawienia', ustawienia: zbierzUstawienia() });
      if (msgEl) msgEl.textContent = 'Zapisano.';
      await load(true);
    } catch (e) { if (msgEl) msgEl.textContent = e.message; else show(e.message, 'error'); await load(true); }
  }

  // ---------------- the run panel ----------------
  async function slownik(co, nip) { return post({ action: 'slownik', co: co, nip: nip }); }
  function opcje(list, pusty) { return (pusty === null ? '' : '<option value="">' + esc(pusty || '— wybierz —') + '</option>') + list.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join(''); }
  function poprzedniMiesiac() { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }

  async function otworz(id) {
    var a = def(id); if (!a) return;
    otwarty = id; biezacy = null; clearTimeout(timer);
    renderLists();
    $('panel').hidden = false;
    $('pTitle').textContent = a.nr + '. ' + a.nazwa + (a.odbiorca === 'klient' ? ' — symulacja klienta' : '');
    $('pDesc').textContent = a.opis;
    $('pNote').innerHTML = a.stan !== 'dziala' ? '<div class="warnbox"><b>' + esc(STAN[a.stan][0]) + ':</b> ' + esc(a.stan_powod) + '</div>' : '';
    $('pRun').innerHTML = ''; $('pMsg').textContent = '';
    var html = '';
    a.pola.forEach(function (p) {
      var fid = 'f_' + p.id, lab = '<label for="' + fid + '">' + esc(p.etykieta) + (p.wymagane ? ' *' : '') + '</label>';
      if (p.typ === 'klient') html += lab + '<select id="' + fid + '"><option value="">wczytywanie…</option></select>';
      else if (p.typ === 'pracownik') html += lab + '<select id="' + fid + '"><option value="">— najpierw wybierz klienta —</option></select>';
      else if (p.typ === 'wiadomosc' || p.typ === 'akt' || p.typ === 'opiekun') html += lab + '<select id="' + fid + '"><option value="">wczytywanie…</option></select>';
      else if (p.typ === 'okres') html += lab + '<input type="month" id="' + fid + '" value="' + poprzedniMiesiac() + '" />';
      else if (p.typ === 'wybor') html += lab + '<select id="' + fid + '">' + opcje(p.opcje, null) + '</select>';
      else if (p.typ === 'tekst') html += lab + '<textarea id="' + fid + '" maxlength="' + (p.max || 4000) + '" placeholder="' + esc(p.podpowiedz || '') + '"></textarea>';
      else if (p.typ === 'pliki') html += lab + '<input type="file" id="' + fid + '" accept="application/pdf,image/jpeg,image/png"' + ((p.max || 1) > 1 ? ' multiple' : '') + ' />' +
        '<div class="checks"><label><input type="checkbox" id="f_zachowaj" /> zachowaj plik do oceny (inaczej plik trafia do modelu tylko na czas tego uruchomienia i nie jest zapisywany)</label></div>' +
        '<p class="hint" style="margin-top:6px">PDF, JPG albo PNG, do 10 MB' + ((p.max || 1) > 1 ? ', najwyżej ' + p.max + ' plików' : '') + '. Do testów używaj dokumentów fikcyjnych.</p>';
    });
    $('pForm').innerHTML = html || '<p class="hint">Ten asystent nie potrzebuje danych wejściowych.</p>';
    $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      if (a.pola.some(function (p) { return p.typ === 'klient' || p.typ === 'opiekun'; })) {
        if (!klienci) klienci = (await slownik('klienci')).klienci.sort(function (x, y) { return x.nazwa.localeCompare(y.nazwa, 'pl'); });
        if ($('f_nip')) {
          $('f_nip').innerHTML = opcje(klienci.map(function (k) { return [k.nip, k.nazwa + ' — ' + k.nip + (a.odbiorca === 'klient' ? ' (' + k.jezyk + ')' : '')]; }), '— wybierz klienta —');
          $('f_nip').addEventListener('change', function () { wczytajPracownikow(); });
        }
        if ($('f_opiekun')) {
          var op = {}; klienci.forEach(function (k) { if (k.opiekun) op[k.opiekun] = 1; });
          $('f_opiekun').innerHTML = opcje(Object.keys(op).sort().map(function (o) { return [o, o]; }), 'wszyscy opiekunowie');
        }
      }
      if ($('f_wiadomosc_id')) $('f_wiadomosc_id').innerHTML = opcje((await slownik('wiadomosci')).wiadomosci.map(function (m) { return [m.id, m.data.replace('T', ' ') + ' · ' + m.od + ' · ' + m.temat]; }), '— bez wiadomości z listy —');
      if ($('f_eli')) $('f_eli').innerHTML = opcje((await slownik('akty')).akty.map(function (p) { return [p.eli, p.skrot + ' (' + p.eli + ', zmiana ' + (p.zmiana || '—') + ')']; }), '— wybierz akt —');
    } catch (e) { $('pMsg').textContent = e.message; }
  }
  async function wczytajPracownikow() {
    var s = $('f_worker_id'); if (!s) return;
    var nip = $('f_nip') ? $('f_nip').value : '';
    if (!nip) { s.innerHTML = '<option value="">— najpierw wybierz klienta —</option>'; return; }
    s.innerHTML = '<option value="">wczytywanie…</option>';
    try {
      var l = (await slownik('pracownicy', nip)).pracownicy;
      s.innerHTML = l.length ? opcje(l.map(function (w) { return [w.id, w.nazwa + (w.status !== 'zatrudniony' ? ' (' + w.status + ')' : '')]; }), '— wybierz pracownika —') : '<option value="">brak pracowników tej firmy w rejestrze</option>';
    } catch (e) { s.innerHTML = '<option value="">' + esc(e.message) + '</option>'; }
  }
  function plikB64(f) {
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok({ nazwa: f.name, data: String(r.result).replace(/^data:[^,]*,/, '') }); };
      r.onerror = function () { no(new Error('Nie udało się odczytać pliku ' + f.name)); };
      r.readAsDataURL(f);
    });
  }
  async function uruchom() {
    var a = def(otwarty); if (!a) return;
    var wej = {}, pliki = [];
    try {
      for (var i = 0; i < a.pola.length; i++) {
        var p = a.pola[i], el = $('f_' + p.id);
        if (!el) continue;
        if (p.typ === 'pliki') {
          var fs = Array.prototype.slice.call(el.files || []);
          if (fs.length > (p.max || 1)) throw new Error('Za dużo plików (najwyżej ' + (p.max || 1) + ').');
          for (var j = 0; j < fs.length; j++) { if (fs[j].size > MAX_PLIK) throw new Error('Plik ' + fs[j].name + ' jest większy niż 10 MB.'); pliki.push(await plikB64(fs[j])); }
        } else wej[p.id] = el.value;
      }
    } catch (e) { $('pMsg').textContent = e.message; return; }
    $('pGo').disabled = true; $('pMsg').textContent = 'Uruchamiam…'; $('pRun').innerHTML = '';
    try {
      var r = await post({ action: 'uruchom', asystent: a.id, wejscie: wej, pliki: pliki, zachowaj_plik: !!($('f_zachowaj') && $('f_zachowaj').checked) });
      $('pMsg').textContent = '';
      sledz(r.id);
    } catch (e) { $('pGo').disabled = false; $('pMsg').textContent = e.message; }
  }
  // the run goes on in the background on the server — the page asks for its state until it ends
  function sledz(id) {
    clearTimeout(timer);
    var tick = async function () {
      try {
        var p = (await post({ action: 'stan', id: id })).przebieg;
        if (otwarty !== p.asystent) return;
        biezacy = p; renderPrzebieg(p);
        if (p.status === 'w_toku') { timer = setTimeout(tick, 2000); return; }
      } catch (e) { $('pRun').innerHTML = '<div class="res err"><p>' + esc(e.message) + '</p></div>'; }
      $('pGo').disabled = false;
      load(true); historia();
    };
    tick();
  }

  function blok(tytul, tresc) { return '<h3>' + esc(tytul) + '</h3><div class="res"><p>' + esc(tresc) + '</p></div>'; }
  function renderPrzebieg(p) {
    var a = def(p.asystent) || { ksztalt: { sekcje: [] }, odbiorca: p.tryb === 'klient' ? 'klient' : 'staff' }, w = p.wynik, h = '';
    h += '<h3>Wynik</h3><div class="acts">' + pill(STATUS[p.status] || [p.status, 'p-grey']) + '<span class="pill p-grey">' + esc(p.model) + '</span>';
    if (p.status !== 'w_toku') h += '<span class="sub">' + liczba(tok(p)) + ' tokenów (wejście ' + liczba((p.tokeny_we || 0) + (p.tokeny_cache_r || 0) + (p.tokeny_cache_w || 0)) + ', wyjście ' + liczba(p.tokeny_wy || 0) + ') · ' + usd(p.koszt_usd) + ' · ' + ((p.czas_ms || 0) / 1000).toFixed(1) + ' s · rund modelu: ' + (p.iteracje || 0) + '</span>';
    h += '</div>';
    if (p.status === 'w_toku') h += '<ol class="steps">' + (p.kroki || []).map(function (k) { return '<li>' + esc(k.co) + '</li>'; }).join('') + '<li><i>trwa…</i></li></ol>';
    if (p.blad) h += '<div class="res err"><p>' + esc(p.blad) + '</p></div>';
    (p.uwagi || []).forEach(function (u) { h += '<div class="warnbox">' + esc(u) + '</div>'; });
    if (w) {
      if (w.wymaga_czlowieka) h += '<div class="warnbox"><b>Wymaga człowieka:</b> asystent uznał, że sprawę musi rozstrzygnąć pracownik biura.</div>';
      h += '<div class="res"><span class="sub">' + (a.odbiorca === 'klient' ? 'Odpowiedź dla klienta' : 'Podsumowanie') + '</span><p>' + esc(w.odpowiedz) + '</p></div>' +
        '<div class="acts"><button class="mini" type="button" data-copy="odp">Kopiuj</button></div>';
      (a.ksztalt.sekcje || []).forEach(function (s) {
        var x = (w.sekcje || []).filter(function (y) { return y.klucz === s.klucz; })[0];
        if (x) h += blok(s.tytul, x.tresc);
      });
      if (w.lista_kontrolna && w.lista_kontrolna.length) {
        h += '<h3>Lista kontrolna</h3><ul class="chk">' + w.lista_kontrolna.map(function (x) {
          return '<li>' + pill(LISTA[x.wynik] || LISTA.nieznane) + '<div>' + esc(x.punkt) + (x.uzasadnienie ? '<small>' + esc(x.uzasadnienie) + '</small>' : '') + (x.zrodlo ? '<small>źródło: ' + esc(x.zrodlo) + '</small>' : '') + '</div></li>';
        }).join('') + '</ul>';
      }
      (w.szkice || []).forEach(function (s, i) {
        h += '<h3>Szkic: ' + esc(KANAL[s.kanal] || s.kanal) + ' (' + esc(s.jezyk) + ')' + (s.adresat ? ' — do: ' + esc(s.adresat) : '') + '</h3>' +
          (s.temat ? '<p class="hint">Temat: ' + esc(s.temat) + '</p>' : '') +
          '<textarea class="draft" readonly id="szkic_' + i + '">' + esc(s.tresc) + '</textarea>' +
          '<div class="acts" style="margin-top:6px"><button class="mini" type="button" data-copy="szkic_' + i + '">Kopiuj</button><span class="sub">Szkic — nikt go nie wysłał.</span></div>';
      });
      if (w.proponowane_zadanie) {
        var z = w.proponowane_zadanie;
        h += '<h3>Proponowane zadanie</h3><div class="res"><p><b>' + esc(z.tytul) + '</b>' + (z.pilne ? ' (pilne)' : '') + (z.termin ? ' — termin ' + esc(z.termin) : '') + (z.opis ? '\n' + esc(z.opis) : '') + '</p></div>' +
          '<div class="acts"><button class="mini ok" type="button" id="zadGo">Utwórz to zadanie dla mnie</button><span class="sub" id="zadMsg">Zadanie nie istnieje, dopóki tego nie klikniesz.</span></div>';
      }
      if (w.nie_znaleziono && w.nie_znaleziono.length) h += blok('Czego asystent nie znalazł / nie wie', w.nie_znaleziono.map(function (x) { return '– ' + x; }).join('\n'));
      h += '<h3>Źródła</h3>' + (w.zrodla.length ? '<ul class="chk">' + w.zrodla.map(function (x) { return '<li><span class="pill p-navy">' + esc(ZRODLO[x.rodzaj] || x.rodzaj) + '</span><div>' + esc(x.id || '') + (x.opis ? '<small>' + esc(x.opis) + '</small>' : '') + '</div></li>'; }).join('') + '</ul>' : '<p class="hint">Asystent nie wskazał żadnego potwierdzonego źródła — traktuj odpowiedź ostrożnie.</p>');
      if (a.odbiorca === 'staff') h += '<div class="acts" style="margin-top:10px"><button class="mini" type="button" id="ruGo">' + (p.tlumaczenie_ru ? 'Pokaż po rosyjsku' : 'Przygotuj wersję po rosyjsku') + '</button><span class="sub" id="ruMsg"></span></div><div id="ruOut"></div>';
    }
    if (p.pliki && p.pliki.length) h += '<div class="acts" style="margin-top:10px">' + p.pliki.map(function (_x, i) { return '<button class="mini" type="button" data-plik="' + i + '">Otwórz zachowany plik ' + (i + 1) + '</button>'; }).join('') + '</div>';
    if (p.zapis) {
      h += '<details><summary>Co dostał model (zapis do oceny)</summary><p class="hint">Dokładnie ta treść — po zamaskowaniu — została wysłana do dostawcy modelu. Instrukcja systemowa asystenta jest stała i znajduje się w kodzie funkcji.</p><pre>' + esc(p.zapis.wiadomosc) + '</pre>' +
        (p.zapis.narzedzia || []).map(function (n) { return '<p class="sub">' + (n.faza === 'wstep' ? 'Odczyt wstępny' : 'Narzędzie wywołane przez model') + ': <b>' + esc(n.nazwa) + '</b> ' + esc(JSON.stringify(n.argumenty)) + (n.blad ? ' — odmowa / błąd' : '') + '</p><pre>' + esc(n.wynik) + '</pre>'; }).join('') + '</details>';
    }
    if (p.status !== 'w_toku') {
      h += '<h3>Twoja ocena</h3><div class="acts"><button class="mini' + (p.ocena === 1 ? ' ok' : '') + '" type="button" data-ocena="1">Dobra odpowiedź</button><button class="mini' + (p.ocena === -1 ? ' del' : '') + '" type="button" data-ocena="-1">Zła odpowiedź</button></div>' +
        '<label for="ocKom">Komentarz (co poprawić)</label><textarea id="ocKom" maxlength="2000">' + esc(p.ocena_komentarz || '') + '</textarea>' +
        '<div class="acts" style="margin-top:6px"><button class="mini" type="button" id="ocGo">Zapisz ocenę</button><span class="sub" id="ocMsg">' + (p.ocena_at ? 'Oceniono ' + esc(fmt(p.ocena_at)) : '') + '</span></div>';
    }
    $('pRun').innerHTML = h;
    if (p.tlumaczenie_ru && a.odbiorca === 'staff' && D.ustawienia.ru_auto) renderRu(p.tlumaczenie_ru, a);
  }
  function renderRu(t, a) {
    var h = '<h3>По-русски (перевод для владельца)</h3><div class="res"><p>' + esc(t.odpowiedz) + '</p></div>';
    (t.sekcje || []).forEach(function (s) { var d = (a.ksztalt.sekcje || []).filter(function (x) { return x.klucz === s.klucz; })[0]; h += '<div class="res"><span class="sub">' + esc(d ? d.tytul : s.klucz) + '</span><p>' + esc(s.tresc) + '</p></div>'; });
    if ((t.lista_kontrolna || []).length) h += '<div class="res"><p>' + esc(t.lista_kontrolna.map(function (x) { return '– ' + x.punkt + (x.uzasadnienie ? ': ' + x.uzasadnienie : ''); }).join('\n')) + '</p></div>';
    if ((t.nie_znaleziono || []).length) h += '<div class="res"><span class="sub">Не найдено</span><p>' + esc(t.nie_znaleziono.map(function (x) { return '– ' + x; }).join('\n')) + '</p></div>';
    $('ruOut').innerHTML = h;
  }
  async function kopiuj(tekst, btn) {
    try { await navigator.clipboard.writeText(tekst); btn.textContent = 'Skopiowano'; } catch (_e) { btn.textContent = 'Zaznacz i skopiuj ręcznie'; }
    setTimeout(function () { btn.textContent = 'Kopiuj'; }, 1800);
  }
  var ocena = 0;
  $('pRun').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b || !biezacy) return;
    var p = biezacy, a = def(p.asystent);
    if (b.hasAttribute('data-copy')) { var k = b.getAttribute('data-copy'); kopiuj(k === 'odp' ? p.wynik.odpowiedz : $(k).value, b); return; }
    if (b.hasAttribute('data-ocena')) {
      ocena = Number(b.getAttribute('data-ocena'));
      Array.prototype.forEach.call($('pRun').querySelectorAll('[data-ocena]'), function (x) { x.className = 'mini' + (x === b ? (ocena === 1 ? ' ok' : ' del') : ''); });
      return;
    }
    if (b.id === 'ocGo') {
      b.disabled = true;
      try { await post({ action: 'ocena', id: p.id, ocena: ocena || p.ocena || 0, komentarz: $('ocKom').value }); $('ocMsg').textContent = 'Zapisano ocenę.'; p.ocena = ocena || p.ocena; historia(); } catch (err) { $('ocMsg').textContent = err.message; }
      b.disabled = false; return;
    }
    if (b.id === 'ruGo') {
      b.disabled = true; $('ruMsg').textContent = p.tlumaczenie_ru ? '' : 'Tłumaczę…';
      try { if (!p.tlumaczenie_ru) p.tlumaczenie_ru = (await post({ action: 'tlumacz_ru', id: p.id })).tlumaczenie_ru; $('ruMsg').textContent = ''; renderRu(p.tlumaczenie_ru, a); } catch (err) { $('ruMsg').textContent = err.message; }
      b.disabled = false; return;
    }
    if (b.id === 'zadGo') {
      // the ordinary tasks table, the administrator's own session, assigned to the administrator
      var z = p.wynik.proponowane_zadanie;
      b.disabled = true;
      var ins = await window.sb.from('portal_zadania').insert({ created_by: me, assignee: me, tytul: z.tytul, opis: (z.opis ? z.opis + '\n\n' : '') + 'Propozycja asystenta AI „' + (a ? a.nazwa : p.asystent) + '” (tryb testowy).', termin: z.termin || null, pilne: !!z.pilne }).select('id').single();
      if (ins.error) { $('zadMsg').textContent = 'Błąd: ' + ins.error.message; b.disabled = false; return; }
      $('zadMsg').innerHTML = 'Utworzono — zobacz w <a href="zadania.html">Zadaniach</a>.';
      if (window.PortalShell && window.PortalShell.refreshTasks) window.PortalShell.refreshTasks();
      return;
    }
    if (b.hasAttribute('data-plik')) {
      try { var u = await post({ action: 'plik', id: p.id, nr: Number(b.getAttribute('data-plik')) }); window.open(u.url, '_blank', 'noopener'); } catch (err) { show(err.message, 'error'); }
    }
  });

  // ---------------- history ----------------
  async function historia() {
    try {
      var h = await post({ action: 'historia', dni: 30 });
      $('hDays').innerHTML = h.dni.length ? '<p class="sub">' + h.dni.slice(0, 7).map(function (d) { return esc(d.dzien.slice(5).split('-').reverse().join('.')) + ': <b>' + d.przebiegow + '</b> uruch., ' + liczba(d.tokeny) + ' tok., ' + usd(d.koszt_usd); }).join(' &nbsp;·&nbsp; ') + '</p>' : '';
      $('hBody').innerHTML = h.przebiegi.length ? h.przebiegi.map(function (r) {
        var a = def(r.asystent), k = r.kontekst || {};
        var kon = [k.nip ? 'NIP ' + k.nip : '', k.okres || '', k.eli || '', k.wariant || '', (k.pliki || []).length ? 'pliki: ' + k.pliki.length : ''].filter(Boolean).join(', ');
        return '<tr><td>' + esc(fmt(r.created_at)) + '</td><td>' + esc(a ? a.nr + '. ' + a.nazwa : r.asystent) + (r.tryb === 'klient' ? '<br><span class="sub">symulacja klienta</span>' : '') + '</td><td>' + esc(kon || '—') + '</td><td>' + pill(STATUS[r.status] || [r.status, 'p-grey']) + '</td><td>' + esc(r.model) + '</td>' +
          '<td class="num">' + liczba(tok(r)) + '</td><td class="num">' + usd(r.koszt_usd) + '</td><td class="num">' + (r.czas_ms ? (r.czas_ms / 1000).toFixed(1) + ' s' : '—') + '</td><td>' + (r.ocena === 1 ? '<span class="pill p-ok">dobra</span>' : r.ocena === -1 ? '<span class="pill p-red">zła</span>' : '<span class="sub">—</span>') + '</td>' +
          '<td><span class="acts"><button class="mini" type="button" data-show="' + esc(r.id) + '" data-as="' + esc(r.asystent) + '">Pokaż</button><button class="mini del" type="button" data-del="' + esc(r.id) + '">Usuń</button></span></td></tr>';
      }).join('') : '<tr><td colspan="10" class="empty">Nie było jeszcze żadnego uruchomienia.</td></tr>';
    } catch (e) { $('hBody').innerHTML = '<tr><td colspan="10" class="empty">' + esc(e.message) + '</td></tr>'; }
  }
  $('hBody').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-show')) { await otworz(b.getAttribute('data-as')); sledz(b.getAttribute('data-show')); return; }
    if (b.hasAttribute('data-del')) {
      if (!window.confirm('Usunąć to uruchomienie z dziennika (razem z zachowanym plikiem)?')) return;
      try { await post({ action: 'czysc', id: b.getAttribute('data-del') }); historia(); load(true); } catch (err) { show(err.message, 'error'); }
    }
  });

  // ---------------- events ----------------
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]');
    if (o) otworz(o.getAttribute('data-open'));
  });
  document.addEventListener('change', function (e) {
    var t = e.target.closest('[data-toggle]'); if (!t) return;
    var a = def(t.getAttribute('data-toggle')); if (!a) return;
    a.wlaczony = t.checked;
    zapiszUstawienia(null);
  });
  $('pClose').addEventListener('click', function () { otwarty = null; biezacy = null; clearTimeout(timer); $('panel').hidden = true; renderLists(); });
  $('pGo').addEventListener('click', uruchom);
  $('hReload').addEventListener('click', historia);
  $('sSave').addEventListener('click', function () { $('sMsg').textContent = 'Zapisuję…'; zapiszUstawienia($('sMsg')); });
  $('sPurge').addEventListener('click', async function () {
    if (!window.confirm('Usunąć z dziennika uruchomienia starsze niż ' + D.ustawienia.retencja_dni + ' dni?')) return;
    try { var r = await post({ action: 'czysc' }); $('sMsg').textContent = 'Usunięto: ' + r.usunieto + '.'; historia(); } catch (e) { $('sMsg').textContent = e.message; }
  });

  async function load(cicho) {
    try {
      D = await post({ action: 'lista' });
      me = D.ja.email;
      $('ui').hidden = false;
      renderTop(); renderLists();
      if (!cicho) { renderSettings(); historia(); if (D.w_toku && D.w_toku.length) show('Jedno uruchomienie jeszcze trwa — znajdziesz je w historii.', 'success'); }
      else renderSettings();
    } catch (e) {
      $('ui').hidden = true;
      show(e.status === 403 || e.status === 401 ? e.message + ' Ta strona jest dostępna tylko dla administratora z listy testerów.' : 'Nie udało się wczytać asystentów: ' + e.message, 'error');
    }
  }
  function start() {
    // the menu does not know this page yet: administrators only, everybody else goes back to the start page
    if (!window.PortalUser || !window.PortalUser.admin) { location.replace('index.html?brak=1'); return; }
    load(false);
  }
  if (window.PortalUser) start(); else document.addEventListener('portal:access', start, { once: true });
})();
