/* Client profile. The employer signs in with a one-time link sent by e-mail and sees its own
   firm: workers with document deadlines, submissions in progress, packets to sign, onboarding.
   All data comes from the `klient` edge function; the session token lives in localStorage. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/klient';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnh3a3hwenFxanRtZ3F3b3p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQxODksImV4cCI6MjA4ODgzMDE4OX0.sUFX90FKNuxM7u8ftOlDKdf1iD4gsfq2T3S0FDzRdC0';
  var KEY = 'tdcg_klient_sesja';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function daysLeft(iso) { var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(iso + 'T00:00:00') - t) / 86400000); }

  var token = '', firms = [], nip = '', data = null, q = '';
  try { token = localStorage.getItem(KEY) || ''; } catch (e) {}

  async function call(body) {
    var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: 'Bearer ' + ANON, 'x-klient-token': token }, body: JSON.stringify(body) });
    var out = await res.json().catch(function () { return {}; });
    if (out.wyloguj) { signOut(true); throw new Error(out.error); }
    if (out.ustaw_haslo && body.action !== 'verify') { $('app').hidden = true; $('login').hidden = true; $('setpass').hidden = false; throw new Error(out.error); }
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
    return out;
  }
  function signOut(silent) {
    try { localStorage.removeItem(KEY); } catch (e) {}
    token = '';
    $('app').hidden = true; $('setpass').hidden = true; $('login').hidden = false;
    if (silent) msg('Sesja wygasła — poproś o nowy link.', 'err');
  }
  function msg(text, type) { $('loginMsg').innerHTML = text ? '<div class="msg ' + (type || 'ok') + '">' + esc(text) + '</div>' : ''; }

  // ---------------- sign-in ----------------
  function setMsg(text, type) { $('setMsg').innerHTML = text ? '<div class="msg ' + (type || 'ok') + '">' + esc(text) + '</div>' : ''; }
  function keep(t) { token = t; try { localStorage.setItem(KEY, t); } catch (e) {} }
  $('passForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    $('passGo').disabled = true; msg('');
    try {
      var out = await call({ action: 'login_haslo', email: $('email').value.trim(), haslo: $('haslo').value });
      $('haslo').value = '';
      keep(out.sesja); start(out);
    } catch (err) { msg(err.message, 'err'); }
    $('passGo').disabled = false;
  });
  $('linkGo').addEventListener('click', async function () {
    var email = $('email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg('Wpisz najpierw swój adres e-mail.', 'err'); $('email').focus(); return; }
    this.disabled = true; msg('');
    try {
      await call({ action: 'login', email: email });
      msg('Jeśli ten adres jest zarejestrowany w biurze, za chwilę przyjdzie na niego wiadomość z linkiem. Link jest ważny 20 minut.', 'ok');
    } catch (err) { msg(err.message, 'err'); }
    this.disabled = false;
  });
  // first sign-in (or forgotten password): the client chooses the password
  $('setForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if ($('h1').value !== $('h2').value) return setMsg('Hasła nie są takie same.', 'err');
    $('setGo').disabled = true; setMsg('');
    try {
      var out = await call({ action: 'haslo_ustaw', haslo: $('h1').value });
      $('h1').value = ''; $('h2').value = '';
      $('setpass').hidden = true;
      start(out);
    } catch (err) { setMsg(err.message, 'err'); }
    $('setGo').disabled = false;
  });
  $('chpass').addEventListener('click', function () {
    $('app').hidden = true; $('setpass').hidden = false;
    setMsg('Jeżeli zmiana się nie powiedzie, wyloguj się i wejdź linkiem z e-maila („nie pamiętasz hasła”) — wtedy ustawisz nowe hasło.', 'ok');
  });
  $('out').addEventListener('click', async function () { try { await call({ action: 'logout' }); } catch (e) {} signOut(false); msg(''); });

  // ---------------- data ----------------
  var DOCS = [['karta_pobytu', 'karta pobytu'], ['zezwolenie', 'zezwolenie / wiza'], ['paszport', 'paszport'], ['badania', 'badania lekarskie'], ['umowa', 'umowa']];
  function pill(label, t) {
    if (!t || (!t.data && !t.bezterminowo)) return '';
    if (t.bezterminowo) return '<span class="pill p-grey">' + label + ': bezterminowo</span>';
    var d = daysLeft(t.data);
    var cls = d <= 30 ? 'p-red' : d <= 60 ? 'p-amber' : 'p-ok';
    return '<span class="pill ' + cls + '">' + label + ': ' + pl(t.data) + (d < 0 ? ' — po terminie' : d <= 60 ? ' — za ' + d + ' dni' : '') + '</span>';
  }
  function urgency(w) {
    var min = 99999;
    DOCS.forEach(function (d) { var t = w.terminy[d[0]]; if (t && t.data) min = Math.min(min, daysLeft(t.data)); });
    return min;
  }
  function render() {
    var ws = data.pracownicy.slice().sort(function (a, b) { return urgency(a) - urgency(b); });
    var late = 0, soon = 0;
    ws.forEach(function (w) { var u = urgency(w); if (u < 0) late++; else if (u <= 30) soon++; });
    $('tiles').innerHTML =
      '<div class="tile"><b>' + ws.length + '</b><span>pracowników</span></div>' +
      '<div class="tile ' + (late ? 'red' : '') + '"><b>' + late + '</b><span>z dokumentem lub umową po terminie</span></div>' +
      '<div class="tile ' + (soon ? 'amber' : '') + '"><b>' + soon + '</b><span>z terminem w ciągu 30 dni</span></div>' +
      '<div class="tile"><b>' + data.zgloszenia.length + '</b><span>zgłoszeń w toku</span></div>';

    var sign = data.zgloszenia.filter(function (z) { return z.komplet; });
    $('boxSign').hidden = !sign.length;
    $('sign').innerHTML = sign.map(function (z) {
      return '<div class="row"><div class="who"><strong>' + esc(z.imie_nazwisko) + '</strong><small>' + esc(z.umowa) + (z.od ? ' · od ' + pl(z.od) : '') + '</small></div>' +
        '<button type="button" class="mini" data-doc="' + esc(z.id) + '">Pobierz komplet (PDF)</button></div>';
    }).join('');

    $('boxSub').hidden = !data.zgloszenia.length;
    $('subs').innerHTML = data.zgloszenia.map(function (z) {
      return '<div class="row"><div class="who"><strong>' + esc(z.imie_nazwisko) + '</strong><small>' + esc(z.umowa) + (z.od ? ' · od ' + pl(z.od) : '') + ' · zgłoszono ' + pl(z.wyslane) + '</small></div>' +
        '<div class="pills"><span class="pill ' + (z.status === 'wyslane' ? 'p-amber' : 'p-grey') + '">' + esc(z.etap) + '</span></div></div>';
    }).join('');

    var o = data.onboarding;
    $('boxOnb').hidden = !o;
    if (o) {
      var pct = o.wszystkie ? Math.round(o.gotowe / o.wszystkie * 100) : 0;
      $('onb').innerHTML = '<p class="hint">Wykonano ' + o.gotowe + ' z ' + o.wszystkie + ' kroków (' + pct + '%).</p><div class="progress"><i style="width:' + pct + '%"></i></div>' +
        (o.od_klienta.length
          ? '<p class="hint" style="margin-bottom:4px"><b>Czego potrzebujemy od Państwa:</b></p>' + o.od_klienta.map(function (t) {
              return '<div class="row"><div class="who"><strong>' + esc(t.co) + '</strong><small>' + esc(t.sprawa) + '</small></div><div class="pills">' +
                (t.termin ? '<span class="pill ' + (daysLeft(t.termin) < 0 ? 'p-red' : 'p-grey') + '">do ' + pl(t.termin) + '</span>' : '') + '</div></div>';
            }).join('')
          : '<div class="empty">Na ten moment niczego od Państwa nie potrzebujemy.</div>');
    }

    var list = ws.filter(function (w) { return !q || w.imie_nazwisko.toLowerCase().indexOf(q) !== -1; });
    $('workers').innerHTML = list.length ? list.map(function (w) {
      var pills = DOCS.map(function (d) { return pill(d[1], w.terminy[d[0]]); }).join('');
      return '<div class="row"><div class="who"><strong>' + esc(w.imie_nazwisko) + '</strong><small>' + [w.stanowisko, w.umowa, w.od && 'od ' + pl(w.od)].filter(Boolean).map(esc).join(' · ') + '</small></div>' +
        '<div class="pills">' + (pills || '<span class="pill p-grey">brak terminów w systemie</span>') + '</div></div>';
    }).join('') : '<div class="empty">' + (ws.length ? 'Brak wyników.' : 'Biuro nie prowadzi jeszcze pracowników tej firmy.') + '</div>';
  }
  function nrb(a) { var d = String(a || '').replace(/\D/g, ''); return d.length === 26 ? d.slice(0, 2) + ' ' + d.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ') : a; }
  function money(list) { return list.length ? list.map(function (m) { return m.kwota.toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' ' + m.waluta; }).join(' + ') : '0,00 PLN'; }
  var INV = { paid: ['opłacona', 'p-ok'], issued: ['do zapłaty', 'p-amber'], overdue: ['po terminie', 'p-red'] };
  function renderAcc(a) {
    $('boxAcc').hidden = false;
    $('accWho').textContent = [a.opiekun && 'Opiekun księgowy: ' + a.opiekun, a.kadrowy && 'kadry: ' + a.kadrowy, a.opodatkowanie && 'forma opodatkowania: ' + a.opodatkowanie].filter(Boolean).join(' · ');
    $('accBody').innerHTML =
      '<div class="row"><div class="who"><strong>Mikrorachunek podatkowy</strong><small>CIT, PIT, VAT — jeden rachunek dla wszystkich wpłat do urzędu skarbowego</small><div class="acc">' + esc(nrb(a.mikrorachunek)) + '</div></div>' +
        '<button type="button" class="mini" data-copy="' + esc(nrb(a.mikrorachunek)) + '">Kopiuj</button></div>' +
      '<div class="row"><div class="who"><strong>Rachunek składkowy ZUS (NRS)</strong><small>wszystkie składki ZUS</small>' +
        (a.nrs ? '<div class="acc">' + esc(nrb(a.nrs)) + '</div>' : '<div class="sub">Numer nadaje ZUS — biuro uzupełni go po rejestracji płatnika.</div>') + '</div>' +
        (a.nrs ? '<button type="button" class="mini" data-copy="' + esc(nrb(a.nrs)) + '">Kopiuj</button>' : '') + '</div>' +
      '<div class="row"><div class="who"><strong>Stałe terminy płatności</strong><small>gdy termin wypada w dzień wolny — następny dzień roboczy</small>' +
        a.terminy.map(function (t) { return '<div style="margin-top:6px">' + esc(t.co) + ' — <b>' + esc(t.kiedy) + '</b> <span class="sub">(' + esc(t.podstawa) + ')</span></div>'; }).join('') + '</div></div>';
    var f = a.faktury;
    $('boxInv').hidden = false;
    if (f.stan !== 'ok') { $('inv').innerHTML = '<div class="empty">Lista faktur będzie tu widoczna po połączeniu profilu z systemem księgowym biura. W sprawie rozliczeń prosimy o kontakt z opiekunem.</div>'; return; }
    $('inv').innerHTML = '<p class="hint">Do zapłaty: <b>' + money(f.do_zaplaty) + '</b>' + (f.po_terminie.length ? ' · w tym po terminie: <b style="color:#b91c1c">' + money(f.po_terminie) + '</b>' : '') +
      ' <span class="sub">· stan na ' + new Date(f.na_dzien).toLocaleString('pl-PL') + '</span></p>' +
      (f.lista.length ? '<div class="tablewrap"><table class="inv"><thead><tr><th>Numer</th><th>Wystawiona</th><th>Termin</th><th>Kwota</th><th>Status</th></tr></thead><tbody>' +
        f.lista.map(function (x) { var st = INV[x.status] || [x.status, 'p-grey']; return '<tr><td>' + esc(x.invoice_number) + '</td><td>' + pl(x.issue_date) + '</td><td>' + pl(x.due_date) + '</td><td>' + Number(x.amount).toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' ' + esc(x.currency) + '</td><td><span class="pill ' + st[1] + '">' + st[0] + '</span></td></tr>'; }).join('') +
        '</tbody></table></div>' : '<div class="empty">Brak faktur z ostatnich dwóch lat.</div>');
  }
  async function loadFirm() {
    var f = firms.filter(function (x) { return x.nip === nip; })[0] || firms[0];
    nip = f.nip;
    $('firmName').textContent = f.nazwa;
    $('newWorker').href = '../formularz-pracownika.html?' + new URLSearchParams({ nip: f.nip, firma: f.nazwa });
    $('workers').innerHTML = '<div class="empty">Ładowanie…</div>';
    data = await call({ action: 'dane', nip: nip });
    render();
    $('boxAcc').hidden = true; $('boxInv').hidden = true;
    call({ action: 'ksiegowosc', nip: nip }).then(renderAcc).catch(function () {});
  }
  function start(profile) {
    firms = profile.firmy || [];
    $('login').hidden = true; $('app').hidden = false;
    var sel = $('firmSel');
    sel.hidden = firms.length < 2;
    sel.innerHTML = firms.map(function (f) { return '<option value="' + esc(f.nip) + '">' + esc(f.nazwa) + '</option>'; }).join('');
    if (!firms.length) { $('workers').innerHTML = '<div class="empty">Do konta nie przypisano jeszcze żadnej firmy.</div>'; return; }
    loadFirm().catch(function (e) { $('workers').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  $('firmSel').addEventListener('change', function () { nip = this.value; loadFirm().catch(function () {}); });
  $('q').addEventListener('input', function () { q = this.value.toLowerCase().trim(); if (data) render(); });
  document.addEventListener('click', async function (e) {
    var c = e.target.closest('[data-copy]');
    if (c) { try { await navigator.clipboard.writeText(c.getAttribute('data-copy')); c.textContent = 'Skopiowano ✓'; setTimeout(function () { c.textContent = 'Kopiuj'; }, 1500); } catch (e3) {} return; }
    var b = e.target.closest('[data-doc]'); if (!b) return;
    b.disabled = true; var old = b.textContent; b.textContent = 'Przygotowuję…';
    try {
      var out = await call({ action: 'dokument', id: b.getAttribute('data-doc') });
      window.open(out.url, '_blank', 'noopener');
    } catch (err) { alert(err.message); }
    b.disabled = false; b.textContent = old;
  });

  // ---------------- boot ----------------
  (async function () {
    var m = location.hash.match(/t=([\w-]{20,})/);
    if (m) {
      // the one-time token must not stay in the address bar or in history
      history.replaceState(null, '', location.pathname);
      try {
        var out = await call({ action: 'verify', token: m[1] });
        keep(out.sesja);
        if (out.ustaw_haslo) { $('setpass').hidden = false; return; }
        return start(out);
      } catch (err) { $('login').hidden = false; return msg(err.message, 'err'); }
    }
    if (!token) { $('login').hidden = false; return; }
    try { start(await call({ action: 'me' })); } catch (e) { /* signOut already shown the login */ }
  })();
})();
