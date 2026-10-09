/* SMS: short notices to the office's clients through SMSAPI.
   Everything goes through the `sms` edge function: it alone knows the provider's token, reads the
   client's number from the clients base, counts the parts, applies the guards (hours, caps, duplicates)
   and writes the log. This page only asks: status / klienci / podglad / wyslij / historia / ustawienia.
   While sending is switched off in the settings every message goes in the provider's test mode.
   sms.html?nip=<NIP> opens with that client chosen. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/sms';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function kiedy(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var p = function (n) { return ('0' + n).slice(-2); };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function low(s) { return String(s == null ? '' : s).toLowerCase(); }
  function pkt(n) { return Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  var STATUS = { nowy: ['w toku', 'p-grey'], test: ['test — nie doręczono', 'p-navy'], wyslany: ['wysłany', 'p-ok'], dostarczony: ['dostarczony', 'p-ok'], blad: ['błąd', 'p-red'], odrzucony: ['zablokowany', 'p-amber'] };
  var CEL = { reczny: 'ręczny', termin: 'termin', podpis_link: 'podpis', test: 'test' };
  var ODRZ = { duplikat: 'taka sama wiadomość chwilę wcześniej', limit_numer: 'limit na numer', limit_dzienny: 'limit dzienny' };

  var st = null, klienci = [], tab = 'wyslij', pod = null, strona = 0, dalej = false, zajete = false;
  var startNip = (new URLSearchParams(location.search).get('nip') || '').replace(/\D/g, '');

  async function token() { var s = await window.sb.auth.getSession(); return s && s.data && s.data.session ? s.data.session.access_token : ''; }
  async function api(action, body) {
    try {
      var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() }, body: JSON.stringify(Object.assign({ action: action }, body || {})) });
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok && !j.error) j.error = 'Błąd ' + res.status;
      return j;
    } catch (e) { return { error: 'Brak połączenia z serwerem.' }; }
  }
  function opcje(el, lista, wartosc) {
    el.innerHTML = lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === wartosc ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function pill(tekst, klasa) { return '<span class="pill ' + klasa + '">' + esc(tekst) + '</span>'; }

  // ---------------- status ----------------
  function rysujKafelki() {
    if (!st) { $('tiles').innerHTML = ''; return; }
    var u = st.ustawienia, d = st.dzis || {}, t = [];
    if (!st.skonfigurowane) t.push(['nie', 'SMSAPI nie jest podłączone', 'amber']);
    else t.push([st.tryb === 'rzeczywisty' ? 'włączona' : 'tryb testowy', 'Wysyłka', st.tryb === 'rzeczywisty' ? 'green' : 'amber']);
    if (st.saldo) t.push([st.saldo.punkty == null ? '—' : pkt(st.saldo.punkty), st.saldo.punkty == null ? (st.saldo.blad || 'Stan konta') : 'Punkty na koncie SMSAPI', st.saldo.punkty == null ? 'red' : st.saldo.punkty < 5 ? 'amber' : '']);
    t.push([u.nadawca || '—', 'Nadawca', u.nadawca ? '' : 'amber']);
    t.push([(d.wyslane || 0) + ' / ' + (d.limit || u.limit_dzienny), 'Wysłane dziś / limit', d.wyslane ? 'green' : 'zero']);
    t.push([d.testowe || 0, 'Testowe dziś', d.testowe ? '' : 'zero']);
    t.push([(d.bledy || 0) + (d.odrzucone || 0), 'Błędy i blokady dziś', (d.bledy || d.odrzucone) ? 'red' : 'zero']);
    t.push([u.godziny.od + '–' + u.godziny.do, st.w_godzinach ? 'Godziny wysyłki' : 'Godziny wysyłki — teraz poza nimi', st.w_godzinach ? '' : 'amber']);
    $('tiles').innerHTML = t.map(function (x) { return '<div class="tile ' + x[2] + '"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('');
  }
  function rysujTaby() {
    var l = [['wyslij', 'Wyślij SMS'], ['historia', 'Historia']];
    if (st && st.ja.admin) l.push(['ustawienia', 'Ustawienia']);
    $('tabs').innerHTML = l.map(function (x) { return '<button type="button" data-tab="' + x[0] + '"' + (tab === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('');
    ['wyslij', 'historia', 'ustawienia'].forEach(function (x) { $('t-' + x).hidden = tab !== x; });
  }
  function rysujTryb() {
    if (!st) return;
    $('trybHint').innerHTML = !st.skonfigurowane
      ? '<span class="warn">SMSAPI nie jest jeszcze podłączone (brak tokenu) — wysyłka nie działa. Podgląd treści i liczenie części działają.</span>'
      : st.tryb === 'rzeczywisty' ? 'Wysyłka jest włączona: „Wyślij SMS” wysyła prawdziwą wiadomość na telefon klienta.'
        : '<span class="warn">Tryb testowy: wysyłka jest wyłączona w ustawieniach, więc „Wyślij SMS” też niczego nie doręczy — dostawca tylko sprawdzi wiadomość.</span>';
    $('numerBox').hidden = !st.ja.numer_reczny;
    $('podNadawca').textContent = 'Nadawca: ' + (st.ustawienia.nadawca || '—') + ' · ' + (st.ustawienia.normalizuj ? 'polskie znaki są zamieniane na zwykłe litery' : 'polskie znaki zostają');
  }

  // ---------------- recipient ----------------
  function wybrany() { var n = $('kl').value; return klienci.filter(function (k) { return k.nip === n; })[0] || null; }
  function rysujKlientow(zachowaj) {
    var q = low($('klQ').value).trim(), qd = q.replace(/\D/g, '');
    var l = klienci.filter(function (k) { return !q || low(k.nazwa).indexOf(q) !== -1 || (qd && k.nip.indexOf(qd) !== -1); });
    var obecny = zachowaj || $('kl').value;
    if (q && l.length === 1) obecny = l[0].nip;
    opcje($('kl'), [['', l.length ? '— wybierz klienta (' + l.length + ') —' : '— brak pasujących klientów —']].concat(l.map(function (k) {
      return [k.nip, k.nazwa + ' · ' + k.nip + (k.telefon ? '' : ' · brak numeru') + (k.zakonczony ? ' · obsługa zakończona' : '')];
    })), obecny);
    rysujOdbiorce();
  }
  function rysujOdbiorce() {
    var k = wybrany(), h = '';
    if (k) {
      h = k.telefon ? pill('telefon w bazie: ' + k.telefon, 'p-ok') : pill(k.brak || 'brak numeru komórkowego w bazie klientów', 'p-red');
      if (k.zakonczony) h += pill('obsługa tego klienta jest zakończona', 'p-amber');
      if (!k.telefon) h += '<span class="sub">Numer uzupełnia się w <a href="klienci.html">Bazie klientów</a> (dane klienta → Telefon).</span>';
    } else if (st && st.ja.numer_reczny && $('numer').value.trim()) h = pill('numer wpisany ręcznie', 'p-navy');
    $('klInfo').innerHTML = h;
  }

  // ---------------- templates ----------------
  function szablon() { var id = $('szablon').value; return ((st && st.szablony) || []).filter(function (s) { return s.id === id; })[0] || null; }
  function rysujPola() {
    var s = szablon();
    $('pola').innerHTML = !s ? '' : s.pola.filter(function (p) { return p.k !== 'tresc'; }).map(function (p) {
      return '<label for="p_' + esc(p.k) + '">' + esc(p.opis) + '</label><input type="text" id="p_' + esc(p.k) + '" data-pole="' + esc(p.k) + '" maxlength="' + Number(p.max) + '" style="margin-bottom:8px" />';
    }).join('');
  }
  function zSzablonu() {
    var s = szablon(); if (!s) return;
    var t = s.tresc.replace(/\{(\w+)\}/g, function (m, k) {
      if (k === 'tresc') return '';
      var el = document.querySelector('[data-pole="' + k + '"]');
      var v = el ? el.value.trim().replace(/[{}]/g, '') : '';
      return v || '…';
    });
    $('tresc').value = t;
    podgladPozniej();
  }

  // ---------------- preview: the server counts, the page shows ----------------
  var czeka = null, nr = 0;
  function podgladPozniej() { clearTimeout(czeka); czeka = setTimeout(podglad, 300); przyciski(); }
  async function podglad() {
    var tresc = $('tresc').value, k = wybrany(), numer = !k && st && st.ja.numer_reczny ? $('numer').value.trim() : '';
    if (!tresc.trim()) { pod = null; rysujPodglad(); return; }
    var moj = ++nr;
    var r = await api('podglad', { tresc: tresc, nip: k ? k.nip : undefined, telefon: numer || undefined });
    if (moj !== nr) return; // an older answer arriving late
    pod = r.error ? { error: r.error } : r;
    rysujPodglad();
  }
  function rysujPodglad() {
    var l = $('licznik'), u = [];
    if (!pod) { l.innerHTML = ''; $('uwagi').textContent = ''; $('podTresc').textContent = '—'; przyciski(); return; }
    if (pod.error) { l.innerHTML = pill(pod.error, 'p-red'); $('uwagi').textContent = ''; przyciski(); return; }
    l.innerHTML = pill(pod.znaki + ' znaków', 'p-grey') +
      pill(pod.czesci + (pod.czesci === 1 ? ' SMS' : ' części SMS'), pod.za_dluga ? 'p-red' : pod.czesci > 1 ? 'p-amber' : 'p-ok') +
      pill(pod.kodowanie === 'GSM-7' ? 'alfabet podstawowy (160 / 153 na część)' : 'znaki specjalne (70 / 67 na część)', pod.kodowanie === 'GSM-7' ? 'p-grey' : 'p-amber') +
      pill('zostało ' + pod.do_konca + ' do końca części', 'p-grey');
    if (pod.za_dluga) u.push('Wiadomość ma ' + pod.czesci + ' części — dozwolone są najwyżej ' + pod.max_czesci + '. Skróć treść.');
    if (pod.polskie_usuniete) u.push('Polskie znaki zostaną zamienione na zwykłe litery (ą → a) — tak jak w podglądzie obok.');
    else if (pod.polskie_znaki) u.push('Polskie znaki zostają: wiadomość mieści wtedy 70 znaków w jednej części zamiast 160.');
    if (pod.kodowanie === 'UCS-2' && pod.inne_znaki && pod.inne_znaki.length && !(pod.polskie_znaki && !pod.polskie_usuniete)) u.push('Znaki spoza podstawowego alfabetu skracają część do 70 znaków: ' + pod.inne_znaki.join(' '));
    if (pod.podpis_dodany) u.push('Na początku dopisano nazwę biura — odbiorca musi wiedzieć, od kogo jest wiadomość.');
    if (pod.telefon && pod.telefon.ok === false) u.push(pod.telefon.error);
    if (!pod.w_godzinach) u.push('Jest poza godzinami wysyłki (' + pod.godziny.od + '–' + pod.godziny.do + ') — wysłanie teraz będzie wymagało potwierdzenia.');
    $('uwagi').textContent = u.join(' ');
    $('podTresc').textContent = pod.tresc || '—';
    przyciski();
  }
  function przyciski() {
    var k = wybrany(), numer = st && st.ja.numer_reczny ? $('numer').value.trim() : '';
    var gotowe = !!st && st.skonfigurowane && !zajete && !!$('tresc').value.trim() && ((k && k.telefon) || (!k && numer)) && !(pod && (pod.error || pod.za_dluga));
    $('wyslij').disabled = !gotowe; $('test').disabled = !gotowe;
  }

  // ---------------- send ----------------
  async function wyslij(test) {
    var k = wybrany(), numer = !k ? $('numer').value.trim() : '', tresc = $('tresc').value, s = szablon();
    var naPrawde = !test && st.tryb === 'rzeczywisty';
    if (naPrawde) {
      await podglad();
      if (!pod || pod.error || pod.za_dluga) return;
      if (!confirm('Wysłać prawdziwy SMS?\n\nDo: ' + (k ? k.nazwa + ' (' + k.telefon + ')' : numer) + '\nCzęści: ' + pod.czesci + '\n\n' + pod.tresc)) return;
    }
    var body = { tresc: tresc, nip: k ? k.nip : undefined, telefon: k ? undefined : numer, test: test || undefined, cel: test ? 'test' : (s ? s.cel : 'reczny') };
    zajete = true; przyciski();
    $('wynik').innerHTML = '<span class="sub">Wysyłam…</span>';
    var r = await api('wyslij', body);
    if (r.wymaga_potwierdzenia && confirm(r.error + '\n\nWysłać mimo to?')) { body.mimo_ciszy = true; r = await api('wyslij', body); }
    zajete = false;
    if (r.ok) {
      $('wynik').innerHTML = (r.test ? pill('test — nic nie zostało doręczone', 'p-navy') : pill('wysłano', 'p-ok')) +
        ' <span>' + esc(r.odbiorca || '') + ' ' + esc(r.telefon || '') + ' · części: ' + esc(r.czesci) + (r.koszt != null && !r.test ? ' · punkty: ' + esc(pkt(r.koszt)) : '') + '</span>' +
        (r.test ? '<div class="sub">Dostawca przyjął wiadomość w trybie testowym: sprawdził numer, nadawcę i treść, ale niczego nie wysłał i nie pobrał punktów.</div>' : '') +
        ((r.ostrzezenia || []).indexOf('poza_godzinami') !== -1 ? '<div class="sub warn">Wysłano poza ustawionymi godzinami.</div>' : '');
    } else {
      $('wynik').innerHTML = pill(r.kod && ODRZ[r.kod] ? 'zablokowano' : 'nie wysłano', 'p-red') + ' <span>' + esc(r.error || 'Nie udało się wysłać.') + '</span>';
    }
    przyciski();
    odswiezStatus();
  }

  // ---------------- history ----------------
  function filtry() { return { q: $('hQ').value.trim() || undefined, status: $('hStatus').value || undefined, cel: $('hCel').value || undefined, od: $('hOd').value || undefined, do: $('hDo').value || undefined, strona: strona }; }
  async function historia() {
    var tb = $('htbl').tBodies[0];
    $('htbl').tHead.innerHTML = '<tr><th>Kiedy</th><th>Odbiorca</th><th>Treść</th><th>Części</th><th>Status</th><th>Rodzaj</th><th>Kto</th></tr>';
    var r = await api('historia', filtry());
    if (r.error) { tb.innerHTML = '<tr><td colspan="7" class="empty">' + esc(r.error) + '</td></tr>'; return; }
    dalej = !!r.dalej;
    $('hPrev').disabled = strona === 0; $('hNext').disabled = !dalej;
    $('hInfo').textContent = 'Strona ' + (strona + 1) + ' · wiadomości na stronie: ' + r.wiersze.length;
    if (!r.wiersze.length) { tb.innerHTML = '<tr><td colspan="7" class="empty">Brak wiadomości' + (strona || $('hQ').value || $('hStatus').value || $('hCel').value || $('hOd').value || $('hDo').value ? ' dla tych filtrów' : '') + '.</td></tr>'; return; }
    tb.innerHTML = r.wiersze.map(function (w) {
      var s = STATUS[w.status] || [w.status, 'p-grey'];
      var opis = w.status === 'odrzucony' ? (ODRZ[w.provider_blad] || w.provider_blad) : w.status === 'blad' ? w.provider_blad : w.status === 'dostarczony' && w.dostarczono_at ? 'doręczono ' + kiedy(w.dostarczono_at) : '';
      return '<tr><td>' + esc(kiedy(w.created_at)) + '</td>' +
        '<td>' + esc(w.odbiorca_nazwa || '—') + '<small>' + esc(w.telefon) + (w.odbiorca_nip ? ' · NIP ' + esc(w.odbiorca_nip) : '') + '</small></td>' +
        '<td class="t">' + esc(w.tresc) + '</td>' +
        '<td>' + esc(w.czesci) + '<small>' + esc(w.kodowanie) + (w.koszt != null && !w.test ? ' · ' + esc(pkt(w.koszt)) + ' pkt' : '') + '</small></td>' +
        '<td>' + pill(s[0], s[1]) + (opis ? '<small>' + esc(opis) + '</small>' : '') + '</td>' +
        '<td>' + esc(CEL[w.cel] || w.cel) + '</td>' +
        '<td>' + esc(w.kto === 'automat' ? 'automat' : w.kto) + '</td></tr>';
    }).join('');
  }
  var hCzeka = null;
  function historiaPozniej() { clearTimeout(hCzeka); strona = 0; hCzeka = setTimeout(historia, 350); }

  // ---------------- settings (administrator) ----------------
  function rysujUstawienia() {
    if (!st || !st.ja.admin) return;
    var u = st.ustawienia, n = (st.nadawcy && st.nadawcy.lista) || null;
    var lista = n ? n.filter(function (x) { return x.status === 'ACTIVE'; }).map(function (x) { return [x.nazwa, x.nazwa + (x.domyslna ? ' (domyślna na koncie)' : '')]; }) : [];
    if (u.nadawca && !lista.some(function (x) { return x[0] === u.nadawca; })) lista.unshift([u.nadawca, u.nadawca + (n ? ' — nieaktywna na koncie SMSAPI' : '')]);
    opcje($('uNadawca'), lista.length ? lista : [['', '— brak nazw —']], u.nadawca);
    $('uWl').checked = u.wlaczone; $('uTerminy').checked = u.automaty.terminy; $('uNorm').checked = u.normalizuj; $('uZagr').checked = u.zagranica; $('uRap').checked = !!u.raporty;
    $('uLimit').value = u.limit_dzienny; $('uLimitNr').value = u.limit_na_numer_dziennie; $('uOd').value = u.godziny.od; $('uDo').value = u.godziny.do;
    var info = [];
    if (!st.skonfigurowane) info.push('SMSAPI nie jest podłączone: brakuje sekretu ' + (st.brak || []).join(', ') + ' — wysyłki nie da się włączyć.');
    if (st.nadawcy && st.nadawcy.blad) info.push(st.nadawcy.blad);
    if (u.by) info.push('Ostatnia zmiana: ' + u.by + (u.updated_at ? ', ' + kiedy(u.updated_at) : '') + '.');
    $('uInfo').textContent = info.join(' ');
  }
  async function zapiszUstawienia() {
    var u = { wlaczone: $('uWl').checked, nadawca: $('uNadawca').value, limit_dzienny: Number($('uLimit').value), limit_na_numer_dziennie: Number($('uLimitNr').value),
      godziny: { od: $('uOd').value, do: $('uDo').value }, automaty: { terminy: $('uTerminy').checked }, normalizuj: $('uNorm').checked, zagranica: $('uZagr').checked, raporty: $('uRap').checked };
    if (u.wlaczone && !st.ustawienia.wlaczone && !confirm('Włączyć wysyłkę? Od tej chwili „Wyślij SMS” będzie wysyłać prawdziwe wiadomości na telefony klientów.')) return;
    if (u.automaty.terminy && !st.ustawienia.automaty.terminy && !confirm('Włączyć przypomnienia o terminach SMS-em? Klienci, którzy dostają e-mail z przypomnieniem, dostaną także SMS.')) return;
    $('uZapisz').disabled = true; $('uMsg').textContent = 'Zapisuję…';
    var r = await api('ustawienia', { ustawienia: u });
    $('uZapisz').disabled = false;
    $('uMsg').textContent = r.error ? r.error : 'Zapisano.';
    $('uMsg').className = r.error ? 'sub warn' : 'sub';
    if (!r.error) odswiezStatus();
  }

  // ---------------- load ----------------
  async function odswiezStatus() {
    var r = await api('status');
    if (r.error) { $('tiles').innerHTML = '<div class="tile red"><b>!</b><span>' + esc(r.error) + '</span></div>'; return; }
    var pierwszy = !st;
    st = r;
    rysujKafelki(); rysujTaby(); rysujTryb(); rysujUstawienia();
    if (pierwszy) {
      opcje($('szablon'), [['', '— bez szablonu —']].concat(st.szablony.map(function (s) { return [s.id, s.nazwa]; })), '');
      opcje($('hStatus'), [['', 'wszystkie']].concat(Object.keys(STATUS).map(function (k) { return [k, STATUS[k][0]]; })), '');
      opcje($('hCel'), [['', 'wszystkie']].concat(Object.keys(CEL).map(function (k) { return [k, CEL[k]]; })), '');
    }
    przyciski();
  }
  async function start() {
    await odswiezStatus();
    if (!st) return;
    var r = await api('klienci');
    klienci = Array.isArray(r.klienci) ? r.klienci.slice().sort(function (a, b) { return a.nazwa.localeCompare(b.nazwa, 'pl'); }) : [];
    if (r.error) $('klInfo').innerHTML = pill(r.error, 'p-red');
    rysujKlientow(startNip && klienci.some(function (k) { return k.nip === startNip; }) ? startNip : '');
    if (startNip && !wybrany()) $('klInfo').innerHTML = pill('Klienta o NIP ' + startNip + ' nie ma w bazie klientów', 'p-amber');
    przyciski();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab]');
    if (t) { tab = t.getAttribute('data-tab'); rysujTaby(); if (tab === 'historia') { strona = 0; historia(); } }
  });
  $('klQ').addEventListener('input', function () { rysujKlientow(); podgladPozniej(); });
  $('kl').addEventListener('change', function () { if ($('kl').value) $('numer').value = ''; rysujOdbiorce(); podgladPozniej(); });
  $('numer').addEventListener('input', function () { if ($('numer').value.trim()) $('kl').value = ''; rysujOdbiorce(); podgladPozniej(); });
  $('szablon').addEventListener('change', function () { rysujPola(); zSzablonu(); });
  $('pola').addEventListener('input', zSzablonu);
  $('tresc').addEventListener('input', podgladPozniej);
  $('wyslij').addEventListener('click', function () { wyslij(false); });
  $('test').addEventListener('click', function () { wyslij(true); });
  ['hQ', 'hStatus', 'hCel', 'hOd', 'hDo'].forEach(function (id) { $(id).addEventListener('input', historiaPozniej); });
  $('hPrev').addEventListener('click', function () { if (strona > 0) { strona--; historia(); } });
  $('hNext').addEventListener('click', function () { if (dalej) { strona++; historia(); } });
  $('uZapisz').addEventListener('click', zapiszUstawienia);

  if (window.PortalUser) start(); else document.addEventListener('portal:access', start, { once: true });
})();
