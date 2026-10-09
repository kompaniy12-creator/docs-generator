/* Client profile. The employer signs in (e-mail + password, the first time by a one-time link) and
   sees its own firm: what needs attention, workers, documents, accounting, requests to the office,
   the firm's data. All data comes from the `klient` edge function (documents for electronic signing —
   from `podpisy`); the session token lives in localStorage. Nothing is decided here: what a client
   may see is filtered by the function, this file only shows it.
   Texts: T('polski tekst') — Polish is the source, klient/i18n.js holds the Russian and Ukrainian
   wording; legal terms and names of documents stay Polish. */
(function () {
  'use strict';
  // the profile is never shown inside somebody else's page
  if (window.top !== window.self) { document.documentElement.style.display = 'none'; try { window.top.location = window.self.location; } catch (e) {} return; }
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/klient';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnh3a3hwenFxanRtZ3F3b3p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQxODksImV4cCI6MjA4ODgzMDE4OX0.sUFX90FKNuxM7u8ftOlDKdf1iD4gsfq2T3S0FDzRdC0';
  var KEY = 'tdcg_klient_sesja', LKEY = 'tdcg_klient_jezyk';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function daysLeft(iso) { var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(iso + 'T00:00:00') - t) / 86400000); }
  function plt(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function rozmiar(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + ' MB'; }

  // ---------------- language ----------------
  var lang = 'pl', langChosen = false;
  try { var sl = localStorage.getItem(LKEY); if (sl === 'pl' || sl === 'ru' || sl === 'uk') { lang = sl; langChosen = true; } } catch (e) {}
  if (!langChosen) { var nl = (navigator.language || '').toLowerCase(); lang = /^uk/.test(nl) ? 'uk' : /^ru/.test(nl) ? 'ru' : 'pl'; }
  function T(s, v) {
    var d = lang !== 'pl' && window.KLIENT_I18N && window.KLIENT_I18N[lang], out = (d && d[s]) || s;
    return v ? out.replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? '' : v[k]; }) : out;
  }
  // static texts of index.html: the Polish original is kept in data-t / data-tp
  function applyStatic() {
    document.documentElement.lang = lang;
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) { el.textContent = T(el.getAttribute('data-t')); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tp]'), function (el) { el.setAttribute('placeholder', T(el.getAttribute('data-tp'))); });
    $('langSel').value = lang;
  }
  function setLang(l, chosen) {
    lang = l;
    if (chosen) { langChosen = true; try { localStorage.setItem(LKEY, l); } catch (e) {} }
    applyStatic(); renderNav(); if (S) show(view);
  }

  var token = '', firms = [], nip = '', S = null, view = 'start', cache = {}, card = null, podglad = '', staffJwt = '';
  try { token = localStorage.getItem(KEY) || ''; } catch (e) {}

  async function call(body, files) {
    var init = { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'x-klient-token': token } };
    if (podglad) {
      // the office's preview: a read-only action as the client would see it, under the administrator's own portal session
      if (['me', 'logout'].indexOf(body.action) !== -1) return body.action === 'me' ? { firmy: firms } : {};
      init.headers = { apikey: ANON, Authorization: 'Bearer ' + staffJwt, 'Content-Type': 'application/json' };
      init.body = JSON.stringify({ action: 'biuro_podglad', nip: podglad, akcja: body });
    } else if (files) {
      var fd = new FormData();
      Object.keys(body).forEach(function (k) { if (body[k] != null) fd.append(k, String(body[k])); });
      files.forEach(function (f) { fd.append('plik', f, f.name || 'plik'); });
      init.body = fd;
    } else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var res;
    try { res = await fetch(FN, init); } catch (e) { throw new Error(T('Brak połączenia z serwerem. Prosimy sprawdzić internet i spróbować ponownie.')); }
    var out = await res.json().catch(function () { return {}; });
    if (out.wyloguj) { signOut(true); var g = new Error(out.error); g.gate = true; throw g; }
    if (out.ustaw_haslo && body.action !== 'verify') { clearP(); $('app').hidden = true; $('login').hidden = true; $('setpass').hidden = false; throw new Error(out.error); }
    if (!res.ok) { var er = new Error(T(out.error || '') || (res.status === 413 ? T('Plik jest za duży — najwyżej 15 MB.') : T('Błąd') + ' ' + res.status)); er.status = res.status; er.kod = out.kod; er.zakres = out.zakres; throw er; }
    return out;
  }
  function signOut(silent) {
    try { localStorage.removeItem(KEY); } catch (e) {}
    token = ''; S = null; cache = {}; card = null; firms = [];
    clearP();
    // nothing of the previous session stays on the page
    Array.prototype.forEach.call(document.querySelectorAll('#app [data-clear]'), function (el) { el.innerHTML = ''; });
    $('nav').innerHTML = ''; $('firmName').textContent = ''; $('firmSel').innerHTML = '';
    $('app').hidden = true; $('setpass').hidden = true; $('login').hidden = false;
    if (silent) msg(T('Sesja wygasła — prosimy zalogować się ponownie.'), 'err');
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
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg(T('Wpisz najpierw swój adres e-mail.'), 'err'); $('email').focus(); return; }
    this.disabled = true; msg('');
    try {
      await call({ action: 'login', email: email });
      msg(T('Jeśli ten adres jest zarejestrowany w biurze, za chwilę przyjdzie na niego wiadomość z linkiem. Link jest ważny 20 minut.'), 'ok');
    } catch (err) { msg(err.message, 'err'); }
    this.disabled = false;
  });
  // first sign-in (or forgotten password): the client chooses the password
  $('setForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if ($('h1').value !== $('h2').value) return setMsg(T('Hasła nie są takie same.'), 'err');
    $('setGo').disabled = true; setMsg('');
    try {
      var body = { action: 'haslo_ustaw', haslo: $('h1').value };
      if ($('h0').value) body.stare = $('h0').value;
      var out = await call(body);
      $('h0').value = ''; $('h1').value = ''; $('h2').value = '';
      $('setpass').hidden = true; $('h0wrap').hidden = true;
      start(out);
    } catch (err) { setMsg(err.message, 'err'); }
    $('setGo').disabled = false;
  });
  function changePass() {
    $('app').hidden = true; $('setpass').hidden = false; $('h0wrap').hidden = false;
    setMsg(T('Jeżeli zmiana się nie powiedzie, wyloguj się i wejdź linkiem z e-maila („nie pamiętasz hasła”) — wtedy ustawisz nowe hasło.'), 'ok');
  }
  $('setBack').addEventListener('click', function () { if (S) { $('setpass').hidden = true; $('app').hidden = false; } else signOut(false); });
  $('out').addEventListener('click', async function () { if (podglad) { window.close(); return; } try { await call({ action: 'logout' }); } catch (e) {} signOut(false); msg(''); });
  $('langSel').addEventListener('change', function () { setLang(this.value, true); });
  $('langLogin').addEventListener('change', function () { setLang(this.value, true); });

  // ---------------- small building blocks (the standard rows, pills and buttons) ----------------
  function row(title, small, right, attrs) {
    return '<div class="row"' + (attrs || '') + '><div class="who"><strong>' + title + '</strong>' + (small ? '<small>' + small + '</small>' : '') + '</div>' + (right ? '<div class="pills">' + right + '</div>' : '') + '</div>';
  }
  function pillHtml(cls, text) { return '<span class="pill ' + cls + '">' + esc(text) + '</span>'; }
  function btn(attr, label, cls) { return '<button type="button" class="' + (cls || 'mini') + '" ' + attr + '>' + esc(label) + '</button>'; }
  function empty(text) { return '<div class="empty">' + esc(text) + '</div>'; }
  function fail(el, err, again) { if (err && err.gate) return; el.innerHTML = '<div class="msg err">' + esc(err.message || err) + '</div>' + (again ? '<div class="pacts">' + btn('data-again="' + again + '"', T('Spróbuj ponownie')) + '</div>' : ''); }
  var TERM = { karta_pobytu: 'karta pobytu', zezwolenie: 'zezwolenie / wiza', paszport: 'paszport', badania: 'badania lekarskie', umowa: 'umowa' };
  var TERM_ORDER = ['karta_pobytu', 'zezwolenie', 'paszport', 'badania', 'umowa'];
  // expired or within 7 days — red; within 30 — amber; later — green
  function termCls(d) { return d <= 7 ? 'p-red' : d <= 30 ? 'p-amber' : 'p-ok'; }
  function termTxt(d) { return d < 0 ? T('po terminie') : d === 0 ? T('dziś') : d <= 60 ? T('za {n} dni', { n: d }) : ''; }
  function termPill(key, t) {
    if (!t || (!t.data && !t.bezterminowo)) return '';
    if (t.bezterminowo) return pillHtml('p-grey', T(TERM[key]) + ': ' + T('bezterminowo'));
    var d = daysLeft(t.data), x = termTxt(d);
    return pillHtml(termCls(d), T(TERM[key]) + ': ' + pl(t.data) + (x ? ' — ' + x : ''));
  }
  function urgency(w) { var min = 99999; TERM_ORDER.forEach(function (k) { var t = w.terminy[k]; if (t && t.data && !t.bezterminowo) min = Math.min(min, daysLeft(t.data)); }); return min; }
  var W_ST = { zatrudniony: ['zatrudniony', 'p-ok'], w_trakcie: ['w trakcie', 'p-amber'], zakonczony: ['zakończony', 'p-grey'] };
  var Z_ST = { przyjete: ['przyjęte', 'p-grey'], w_toku: ['w toku', 'p-amber'], zalatwione: ['załatwione', 'p-ok'] };
  var KAT = { kadry: 'kadry i płace', ksiegowosc: 'księgowość', inne: 'inna sprawa' };
  async function copy(b) { try { await navigator.clipboard.writeText(b.getAttribute('data-copy')); var o = b.textContent; b.textContent = T('Skopiowano') + ' ✓'; setTimeout(function () { b.textContent = o; }, 1500); } catch (e) {} }
  async function pobierz(b, zrodlo, id, n) {
    if (podglad) return alert(T('W podglądzie biura pliki nie są pobierane.'));
    b.disabled = true;
    try {
      var out = await call({ action: 'pobierz', nip: nip, zrodlo: zrodlo, id: id, n: n });
      var a = document.createElement('a'); a.href = out.url; a.download = out.nazwa || ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { if (!err.gate) alert(T('Nie udało się pobrać pliku:') + ' ' + err.message); }
    b.disabled = false;
  }

  // ---------------- navigation ----------------
  var VIEWS = [['start', 'Start'], ['pracownicy', 'Pracownicy'], ['dokumenty', 'Dokumenty'], ['ksiegowosc', 'Księgowość'], ['zgloszenia', 'Kontakt z biurem'], ['firma', 'Dane firmy'], ['pomoc', 'Pomoc']];
  function allowed(v) { return !S || (v === 'pracownicy' ? S.zakres.kadry : v === 'ksiegowosc' ? S.zakres.ksiegowosc : true); }
  function renderNav() {
    $('nav').innerHTML = VIEWS.filter(function (v) { return allowed(v[0]); }).map(function (v) {
      var n = v[0] === 'dokumenty' && S && S.liczby.do_podpisu ? ' (' + S.liczby.do_podpisu + ')' : '';
      return '<button type="button" class="mini' + (v[0] === view ? ' on' : '') + '" data-view="' + v[0] + '"' + (v[0] === view ? ' aria-current="page"' : '') + '>' + esc(T(v[1]) + n) + '</button>';
    }).join('');
  }
  var LOADERS = {};
  function show(v, keepScroll) {
    if (!allowed(v)) v = 'start';
    view = v;
    VIEWS.forEach(function (x) { $('v-' + x[0]).hidden = x[0] !== v; });
    renderNav();
    var on = $('nav').querySelector('.on');
    if (on) $('nav').scrollLeft = Math.max(0, on.offsetLeft - $('nav').offsetLeft - 40);
    // the page heading: a greeting on the start screen, the name of the section elsewhere
    $('hello').textContent = v === 'start' ? T('Dzień dobry') : T(VIEWS.filter(function (x) { return x[0] === v; })[0][1]);
    $('lead').textContent = S ? S.firma.nazwa + (v === 'start' && S.poprzednie_logowanie ? ' · ' + T('poprzednie logowanie:') + ' ' + plt(S.poprzednie_logowanie) : '') : '';
    if (!keepScroll) window.scrollTo(0, 0);
    (LOADERS[v] || function () {})();
  }
  $('nav').addEventListener('click', function (e) { var b = e.target.closest('[data-view]'); if (b) { card = null; show(b.getAttribute('data-view')); } });

  // ---------------- start ----------------
  function kalendarz(ile) {
    if (!S || !S.podatki || !window.KsiegTerminy) return [];
    var d = new Date(), dzis = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2), out = [];
    // a firm with workers pays wages and contributions; the rest is read from the form of the firm and of its taxation
    var k = { forma: S.podatki.forma, opodatkowanie: S.podatki.opodatkowanie, cechy: S.liczby.pracownicy ? { platnik: true, 'platnik-zus': true } : {} };
    for (var i = 0; i < 2; i++) {
      var m = new Date(d.getFullYear(), d.getMonth() + i, 1);
      window.KsiegTerminy.dlaKlienta(k, m.getFullYear(), m.getMonth() + 1).forEach(function (t) {
        // rare obligations the client's data does not decide are left to the caretaker
        if (t.niepewne && /wht|pit8ar|pfron|vat-ue/.test(t.id)) return;
        out.push(t);
      });
    }
    return ile ? out.filter(function (t) { return t.data >= dzis; }).slice(0, ile) : out;
  }
  function terminRow(t) {
    var p = t.data.split('-'), d = daysLeft(t.data);
    return row(esc(t.nazwa), esc(T('za okres:') + ' ' + t.dotyczy + (t.przesunieto ? ' · ' + T('termin przesunięty z dnia wolnego') : '')),
      pillHtml(d < 0 ? 'p-grey' : d <= 3 ? 'p-red' : d <= 10 ? 'p-amber' : 'p-ok', p[2] + '.' + p[1] + '.' + p[0]) + (t.niepewne ? pillHtml('p-grey', T('jeśli dotyczy')) : ''));
  }
  function renderStart() {
    var L = S.liczby, tp = S.terminy_pracownikow, late = tp.filter(function (t) { return t.dni < 0; }).length;
    var tiles = '';
    if (S.zakres.kadry) {
      tiles += '<div class="tile" data-view="pracownicy"><b>' + L.pracownicy + '</b><span>' + esc(T('pracowników')) + '</span></div>' +
        '<div class="tile ' + (L.do_podpisu ? 'amber' : '') + '" data-view="dokumenty"><b>' + L.do_podpisu + '</b><span>' + esc(T('dokumentów do podpisania')) + '</span></div>' +
        '<div class="tile ' + (late ? 'red' : tp.length ? 'amber' : '') + '" data-view="pracownicy"><b>' + tp.length + '</b><span>' + esc(T('terminów w ciągu 30 dni lub po terminie')) + '</span></div>';
    }
    tiles += '<div class="tile" data-view="zgloszenia"><b>' + L.zgloszenia_otwarte + '</b><span>' + esc(T('zgłoszeń w toku')) + '</span></div>';
    $('tiles').innerHTML = tiles;

    var h = '';
    if (L.do_podpisu) h += row(esc(T('Dokumenty czekają na podpis firmy')), esc(T('Do podpisania: {n}', { n: L.do_podpisu })), btn('data-view="dokumenty"', T('Przejdź do dokumentów')));
    tp.forEach(function (t) {
      h += row(esc(t.imie_nazwisko), esc(T(TERM[t.co]) + ' — ' + T('ważne do') + ' ' + pl(t.data)), pillHtml(termCls(t.dni), termTxt(t.dni)) + btn('data-card="' + esc(t.id) + '"', T('Karta')));
    });
    S.od_klienta.forEach(function (t) {
      h += row(esc(t.co), esc(t.sprawa), (t.termin ? pillHtml(daysLeft(t.termin) < 0 ? 'p-red' : 'p-amber', T('do') + ' ' + pl(t.termin)) : '') + btn('data-req="odp"', T('Odpowiedz biuru')));
    });
    if (L.w_weryfikacji) h += row(esc(T('Zgłoszenia przyjęte — w trakcie weryfikacji przez biuro')), esc(T('Dane osoby pojawią się w profilu, gdy biuro sprawdzi zgłoszenie. Liczba zgłoszeń: {n}', { n: L.w_weryfikacji })));
    if (L.w_trakcie) h += row(esc(T('Zgłoszenia nowych pracowników w przygotowaniu')), esc(T('Osób: {n}', { n: L.w_trakcie })), btn('data-view="pracownicy"', T('Zobacz')));
    $('uwaga').innerHTML = h || empty(T('Wszystko w porządku — nic nie wymaga teraz Państwa działania.'));

    var kal = kalendarz(6);
    $('boxKal').hidden = !S.zakres.ksiegowosc;
    $('kal').innerHTML = kal.length ? kal.map(terminRow).join('') + '<div class="pacts">' + btn('data-view="ksiegowosc"', T('Cały kalendarz i rachunki do wpłat')) + '</div>' : empty(T('Brak terminów w najbliższych tygodniach.'));

    $('szybkie').innerHTML = (S.zakres.kadry ? '<a class="btn green" href="' + esc(hireUrl()) + '" target="_blank" rel="noopener">+ ' + esc(T('Zatrudnij nowego pracownika')) + '</a>' : '') +
      (S.zakres.ksiegowosc ? btn('data-req="dok"', T('Prześlij dokumenty księgowe'), 'btn') : '') + btn('data-req="nowe"', T('Napisz do biura'), 'btn');

    var k = S.kontakt, b = k.biuro;
    $('kontakt').innerHTML =
      (k.opiekun ? row(esc(k.opiekun), esc(T('opiekun księgowy Państwa firmy')), '<a class="mini" href="mailto:' + esc(b.email_ksiegowosc) + '">' + esc(b.email_ksiegowosc) + '</a>') : '') +
      (k.kadrowy ? row(esc(k.kadrowy), esc(T('kadry i płace Państwa firmy')), '<a class="mini" href="mailto:' + esc(b.email_kadry) + '">' + esc(b.email_kadry) + '</a>') : '') +
      row(esc(b.nazwa), esc(T('telefon biura')), '<a class="mini" href="tel:+48' + esc(b.telefon.replace(/\D/g, '')) + '">' + esc(b.telefon) + '</a>' + btn('data-req="nowe"', T('Napisz do biura')));
  }
  function hireUrl() { var f = firms.filter(function (x) { return x.nip === nip; })[0] || { nazwa: '' }; return '../formularz-pracownika.html?' + new URLSearchParams({ nip: nip, firma: f.nazwa }); }
  LOADERS.start = renderStart;

  // ---------------- workers ----------------
  var wq = '', wst = '', wterm = false;
  function renderWorkers() {
    var box = $('workers'), all = cache.pracownicy;
    $('hire').href = hireUrl();
    if (card) return renderCard();
    $('wList').hidden = false; $('wCard').hidden = true;
    if (!all) { box.innerHTML = empty(T('Ładowanie…')); return; }
    var list = all.filter(function (w) {
      return (!wq || w.imie_nazwisko.toLowerCase().indexOf(wq) !== -1 || (w.stanowisko || '').toLowerCase().indexOf(wq) !== -1) && (!wst || w.status === wst) && (!wterm || (w.status === 'zatrudniony' && urgency(w) <= 30));
    }).sort(function (a, b) { return (a.status === 'zakonczony') - (b.status === 'zakonczony') || urgency(a) - urgency(b) || a.imie_nazwisko.localeCompare(b.imie_nazwisko, 'pl'); });
    $('wCount').textContent = T('Pokazano {a} z {b}', { a: list.length, b: all.length }) + (cache.weryf ? ' · ' + T('Zgłoszenia przyjęte — w trakcie weryfikacji przez biuro') + ': ' + cache.weryf : '');
    box.innerHTML = list.length ? list.map(function (w) {
      var st = W_ST[w.status], pills = w.status === 'zatrudniony' ? TERM_ORDER.map(function (k) { return termPill(k, w.terminy[k]); }).join('') : '';
      return row(esc(w.imie_nazwisko), [w.stanowisko, T(w.umowa), w.od && T('od') + ' ' + pl(w.od), w.status === 'w_trakcie' && w.etap && T(w.etap)].filter(Boolean).map(esc).join(' · '),
        pillHtml(st[1], T(st[0])) + pills + btn('data-card="' + esc(w.id) + '"', T('Karta')));
    }).join('') : empty(all.length ? T('Brak wyników — prosimy zmienić wyszukiwanie albo filtry.') : T('Biuro nie prowadzi jeszcze pracowników tej firmy. Pierwszą osobę można zgłosić przyciskiem powyżej.'));
  }
  LOADERS.pracownicy = function () {
    renderWorkers();
    if (cache.pracownicy) return;
    var forNip = nip;
    call({ action: 'pracownicy', nip: nip }).then(function (o) { if (nip !== forNip) return; cache.pracownicy = o.pracownicy; cache.weryf = o.w_weryfikacji || 0; if (view === 'pracownicy') renderWorkers(); })
      .catch(function (e) { fail($('workers'), e, 'pracownicy'); });
  };
  $('wq').addEventListener('input', function () { wq = this.value.toLowerCase().trim(); renderWorkers(); });
  $('wst').addEventListener('change', function () { wst = this.value; renderWorkers(); });
  $('wterm').addEventListener('change', function () { wterm = this.checked; renderWorkers(); });

  function field(label, value) { return value ? '<div class="row"><div class="who"><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong></div></div>' : ''; }
  var MASK = { pesel: 'PESEL', dokument: 'Numer dokumentu tożsamości', konto: 'Numer rachunku do wypłaty' };
  function renderCard() {
    $('wList').hidden = true; $('wCard').hidden = false;
    var el = $('cardBody');
    if (card.err) { el.innerHTML = '<div class="msg err">' + esc(card.err) + '</div>'; return; }
    if (!card.data) { el.innerHTML = empty(T('Ładowanie…')); return; }
    var p = card.data.pracownik, d = card.data.dokumenty, u = p.umowa_szczegoly, st = W_ST[p.status];
    var h = '<h2>' + esc(p.imie_nazwisko) + ' ' + pillHtml(st[1], T(st[0])) + '</h2><p class="hint">' + esc([p.stanowisko, T(p.umowa)].filter(Boolean).join(' · ')) + '</p>';
    h += '<div class="pstep">' + esc(T('Dane pracownika')) + '</div>' +
      field(T('data urodzenia'), pl(p.data_urodzenia)) + field(T('obywatelstwo'), p.obywatelstwo) + field(T('adres zamieszkania'), p.adres) + field(T('telefon'), p.telefon) + field(T('e-mail'), p.email);
    ['pesel', 'dokument', 'konto'].forEach(function (k) {
      if (!p.ma[k]) return;
      var shown = card.shown[k];
      h += '<div class="row"><div class="who"><small>' + esc(T(MASK[k]) + (k === 'dokument' && p.dokument_typ ? ' (' + p.dokument_typ + ')' : '')) + '</small><strong>' + (shown != null ? '<span class="acc">' + esc(shown) + '</span>' : '•••• •••• ••••') + '</strong></div><div class="pills">' +
        (shown != null ? btn('data-hide="' + k + '"', T('Ukryj')) : podglad ? '' : btn('data-reveal="' + k + '"', T('Pokaż'))) + '</div></div>';
    });
    h += '<p class="hint" style="margin-top:8px">' + esc(T('Numery są zakryte. Każde odsłonięcie jest zapisywane w dzienniku — kto, kiedy i czyje dane.')) + '</p>';
    h += '<div class="pstep">' + esc(T('Umowa')) + '</div>' + field(T('rodzaj umowy'), T(u.rodzaj)) + field(T('stanowisko / zakres'), u.stanowisko) +
      field(T('okres'), [u.od && T('od') + ' ' + pl(u.od), u.bezterminowo ? T('na czas nieokreślony') : u.do && T('do') + ' ' + pl(u.do)].filter(Boolean).join(' ')) +
      field(T('wymiar czasu pracy'), u.wymiar) + field(T('wynagrodzenie'), u.minimalna ? T('minimalne wynagrodzenie') : u.stawka ? u.stawka + ' zł' + (u.jednostka ? ' / ' + u.jednostka : '') : '') +
      field(T('liczba godzin'), u.godziny) + field(T('miejsce pracy'), u.miejsce);
    var pills = TERM_ORDER.map(function (k) { return termPill(k, p.terminy[k]); }).join('');
    h += '<div class="pstep">' + esc(T('Terminy ważności')) + '</div><div class="pills" style="justify-content:flex-start">' + (pills || pillHtml('p-grey', T('brak terminów w systemie'))) + '</div>';

    h += '<div class="pstep">' + esc(T('Dokumenty pracownika')) + '</div>';
    var docs = '';
    if (d.komplet) docs += row(esc(T('Komplet dokumentów do umowy')), esc(T('przygotowany przez biuro (PDF)')), btn('data-get="komplet:' + esc(d.komplet.id) + '"', T('Pobierz')));
    d.podpisy.forEach(function (x) { docs += row(esc(x.tytul), esc(T('podpisywanie przez internet')), pillHtml(x.podpisany ? 'p-ok' : 'p-amber', x.podpisany ? T('podpisany') : T('w trakcie podpisywania')) + btn('data-view="dokumenty"', T('Otwórz'))); });
    d.akta.forEach(function (x) { docs += row(esc(x.rodzaj || T('dokument z akt osobowych')), esc([x.czesc && T('akta osobowe, część') + ' ' + x.czesc, pl(x.data)].filter(Boolean).join(' · ')), btn('data-get="akta:' + esc(x.id) + '"', T('Pobierz'))); });
    h += docs || empty(T('Biuro nie udostępniło jeszcze dokumentów tego pracownika. Jeżeli potrzebują Państwo któregoś — prosimy napisać do biura.'));

    h += '<div class="pstep">' + esc(T('Zgłoś zmianę do biura')) + '</div><div class="pacts">' +
      btn('data-zm="Zakończenie współpracy"', T('Zakończenie współpracy')) + btn('data-zm="Przedłużenie umowy"', T('Przedłużenie umowy')) +
      btn('data-zm="Zmiana warunków umowy"', T('Zmiana warunków umowy')) + btn('data-zm="Nowy dokument pracownika"', T('Nowy dokument pracownika')) + '</div>';
    el.innerHTML = h;
  }
  function openCard(id) {
    card = { id: id, data: null, shown: {} };
    show('pracownicy');
    var c = card;
    call({ action: 'pracownik', nip: nip, id: id }).then(function (o) { if (card !== c) return; c.data = o; renderCard(); })
      .catch(function (e) { if (card !== c || e.gate) return; c.err = e.message; renderCard(); });
  }
  $('cardBack').addEventListener('click', function () { card = null; renderWorkers(); });
  $('cardBody').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b || !card) return;
    var k = b.getAttribute('data-reveal');
    if (k) {
      b.disabled = true;
      try { var o = await call({ action: 'pracownik_pokaz', nip: nip, id: card.id, pole: k }); card.shown[k] = o.wartosc; renderCard(); }
      catch (err) { if (!err.gate) { alert(err.message); b.disabled = false; } }
      return;
    }
    if (b.hasAttribute('data-hide')) { delete card.shown[b.getAttribute('data-hide')]; return renderCard(); }
    if (b.hasAttribute('data-zm')) return openRequest({ kategoria: 'kadry', rodzaj: 'zmiana_pracownika', worker: { id: card.id, name: card.data.pracownik.imie_nazwisko }, temat: T(b.getAttribute('data-zm')) + ' — ' + card.data.pracownik.imie_nazwisko });
  });

  // ---------------- documents ----------------
  var UM = { ksiegowosc: 'umowa o prowadzenie księgowości', kadry: 'umowa o obsługę kadrowo-płacową', powierzenie: 'umowa powierzenia przetwarzania danych', aneks: 'aneks', pelnomocnictwo: 'pełnomocnictwo', upowaznienie: 'upoważnienie', wypowiedzenie: 'wypowiedzenie', inne: 'dokument' };
  function renderDocs() {
    var d = cache.dokumenty;
    // signed through the internet: taken from the signing module's own list
    var signed = [];
    (pak || []).forEach(function (p) { p.dokumenty.forEach(function (x) { if (gotowy(x) && x.finalne && x.finalne.length) signed.push({ p: p, d: x }); }); });
    $('boxSigned').hidden = !signed.length;
    $('signed').innerHTML = signed.map(function (s) { return row(esc(s.d.tytul), esc(s.p.worker_name), pillHtml('p-ok', T('podpisany')) + btn('data-fin="' + esc(s.d.id) + ':' + esc(s.d.finalne[s.d.finalne.length - 1]) + '"', T('Pobierz'))); }).join('');
    if (!d) { $('docsRest').innerHTML = '<div class="box">' + empty(T('Ładowanie…')) + '</div>'; return; }
    var h = '';
    if (d.komplety.length) h += '<div class="box"><h2>' + esc(T('Komplety dokumentów do wydruku')) + '</h2><p class="hint">' + esc(T('Dokumenty przygotowane przez biuro w jednym pliku. Komplet oznaczony „do podpisu” prosimy wydrukować, podpisać (pracownik i osoba reprezentująca firmę) i odesłać skan do biura.')) + '</p>' +
      d.komplety.map(function (x) { return row(esc(x.pracownik), esc(x.nazwa), (x.do_podpisu ? pillHtml('p-amber', T('do podpisu')) : '') + btn('data-get="komplet:' + esc(x.id) + '"', T('Pobierz') + ' (PDF)')); }).join('') + '</div>';
    h += '<div class="box"><h2>' + esc(T('Umowy z biurem')) + '</h2><p class="hint">' + esc(T('Umowy, aneksy i pełnomocnictwa zawarte z TD Consulting Group, które biuro udostępniło w profilu.')) + '</p>' +
      (d.umowy.length ? d.umowy.map(function (x) {
        return row(esc(T(UM[x.rodzaj] || UM.inne) + (x.podtyp ? ' — ' + x.podtyp : '')), esc([x.data_zawarcia && T('zawarta') + ' ' + pl(x.data_zawarcia), x.bezterminowa ? T('na czas nieokreślony') : x.obowiazuje_do && T('obowiązuje do') + ' ' + pl(x.obowiazuje_do)].filter(Boolean).join(' · ')), btn('data-get="umowa:' + esc(x.id) + '"', T('Pobierz')));
      }).join('') : empty(T('Biuro nie udostępniło tu jeszcze żadnej umowy. Kopię umowy można zamówić przyciskiem „Napisz do biura”.'))) + '</div>';
    h += '<div class="box"><h2>' + esc(T('Dokumenty przygotowane dla firmy')) + '</h2><p class="hint">' + esc(T('Dokumenty wygenerowane przez biuro dla Państwa firmy — zawsze najnowsza wersja.')) + '</p>' +
      (d.firmowe.length ? d.firmowe.map(function (x) { return row(esc(x.rodzaj), esc([x.dotyczy, pl(x.data)].filter(Boolean).join(' · ')), btn('data-get="historia:' + esc(x.id) + '"', T('Pobierz'))); }).join('') : empty(T('Nie ma jeszcze dokumentów przygotowanych dla firmy.'))) + '</div>';
    if (S.zakres.kadry) h += '<div class="box"><h2>' + esc(T('Dokumenty z akt osobowych')) + '</h2><p class="hint">' + esc(T('Skany z akt osobowych pracowników, które biuro udostępniło pracodawcy.')) + '</p>' +
      (d.akta.length ? d.akta.map(function (x) { return row(esc(x.pracownik), esc([x.rodzaj, x.czesc && T('część') + ' ' + x.czesc, pl(x.data)].filter(Boolean).join(' · ')), btn('data-get="akta:' + esc(x.id) + '"', T('Pobierz'))); }).join('') : empty(T('Biuro nie udostępniło jeszcze skanów z akt osobowych.'))) + '</div>';
    $('docsRest').innerHTML = h;
  }
  LOADERS.dokumenty = function () {
    renderDocs();
    if (cache.dokumenty) return;
    var forNip = nip;
    call({ action: 'dokumenty', nip: nip }).then(function (o) { if (nip !== forNip) return; cache.dokumenty = o; if (view === 'dokumenty') renderDocs(); })
      .catch(function (e) { fail($('docsRest'), e, 'dokumenty'); });
  };

  // ---------------- accounting ----------------
  function nrb(a) { var d = String(a || '').replace(/\D/g, ''); return d.length === 26 ? d.slice(0, 2) + ' ' + d.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ') : a; }
  function money(list) { return list.length ? list.map(function (m) { return m.kwota.toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' ' + esc(m.waluta); }).join(' + ') : '0,00 PLN'; }
  var INV = { paid: ['opłacona', 'p-ok'], issued: ['do zapłaty', 'p-amber'], overdue: ['po terminie', 'p-red'] };
  var MIES = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
  function okres(o) { return T(MIES[+o.slice(5, 7) - 1]) + ' ' + o.slice(0, 4); }
  function etap(label, k) { return k.stan === 'nd' ? '' : pillHtml(k.stan === 'tak' ? 'p-ok' : 'p-grey', (k.stan === 'tak' ? '✓ ' : '') + T(label)); }
  function renderAcc() {
    var a = cache.ksiegi, el = $('accBody');
    if (!a) { el.innerHTML = '<div class="box">' + empty(T('Ładowanie…')) + '</div>'; return; }
    var h = '<div class="box"><h2>' + esc(T('Zamknięcie miesiąca')) + '</h2><p class="hint">' + esc(T('Na jakim etapie są księgi firmy za ostatnie miesiące.') + (a.opiekun ? ' ' + T('Opiekun księgowy:') + ' ' + a.opiekun.replace(/\.+$/, '') + '.' : '')) + '</p>' +
      (a.zamkniecia.length ? a.zamkniecia.map(function (z) {
        return row(esc(okres(z.okres)), z.zamkniety.stan === 'tak' && z.zamkniety.kiedy ? esc(T('zamknięto') + ' ' + pl(z.zamkniety.kiedy)) : '',
          z.zamkniety.stan === 'tak' ? pillHtml('p-ok', '✓ ' + T('miesiąc zamknięty')) : etap('dokumenty otrzymane', z.dokumenty) + etap('zaksięgowano', z.zaksiegowano) + etap('deklaracje wysłane', z.deklaracje));
      }).join('') : empty(T('Biuro nie rozpoczęło jeszcze zamknięcia żadnego miesiąca w portalu.'))) +
      '<div class="pacts">' + btn('data-req="dok"', T('Prześlij dokumenty księgowe'), 'btn') + '</div></div>';
    var o = a.onboarding;
    if (o) {
      var pct = o.wszystkie ? Math.round(o.gotowe / o.wszystkie * 100) : 0;
      h += '<div class="box"><h2>' + esc(T('Obsługa księgowa — uruchomienie')) + '</h2><p class="hint">' + esc(T('Wykonano {a} z {b} kroków', { a: o.gotowe, b: o.wszystkie })) + ' (' + pct + '%)</p><div class="progress"><i style="width:' + pct + '%"></i></div>' +
        (o.od_klienta.length ? o.od_klienta.map(function (t) { return row(esc(t.co), esc(t.sprawa), t.termin ? pillHtml(daysLeft(t.termin) < 0 ? 'p-red' : 'p-grey', T('do') + ' ' + pl(t.termin)) : ''); }).join('') : empty(T('Na ten moment niczego od Państwa nie potrzebujemy.'))) + '</div>';
    }
    var kal = kalendarz(0);
    h += '<div class="box"><h2>' + esc(T('Kalendarz terminów — ten i następny miesiąc')) + '</h2><p class="hint">' + esc(T('Ustawowe terminy podatków, składek i deklaracji dla Państwa firmy. Gdy termin wypada w sobotę albo dzień wolny, mija w następnym dniu roboczym. Terminy z dopiskiem „jeśli dotyczy” zależą od sytuacji firmy — potwierdzi je opiekun.')) + '</p>' +
      (kal.length ? kal.map(terminRow).join('') : empty(T('Brak terminów.'))) + '</div>';
    h += '<div class="box"><h2>' + esc(T('Rachunki do wpłat')) + '</h2>' +
      row(esc(T('Mikrorachunek podatkowy')), esc(T('CIT, PIT, VAT — jeden rachunek dla wszystkich wpłat do urzędu skarbowego')) + '<div class="acc">' + esc(nrb(a.mikrorachunek)) + '</div>', btn('data-copy="' + esc(nrb(a.mikrorachunek)) + '"', T('Kopiuj'))) +
      row(esc(T('Rachunek składkowy ZUS (NRS)')), esc(T('wszystkie składki ZUS')) + (a.nrs ? '<div class="acc">' + esc(nrb(a.nrs)) + '</div>' : '<div class="sub">' + esc(T('Numer nadaje ZUS — biuro uzupełni go po rejestracji płatnika.')) + '</div>'), a.nrs ? btn('data-copy="' + esc(nrb(a.nrs)) + '"', T('Kopiuj')) : '') + '</div>';
    var f = a.faktury;
    h += '<div class="box"><h2>' + esc(T('Rozliczenia z biurem — faktury')) + '</h2>';
    if (f.stan !== 'ok') h += empty(T('Lista faktur będzie tu widoczna po połączeniu profilu z systemem księgowym biura. W sprawie rozliczeń prosimy o kontakt z opiekunem.'));
    else h += '<p class="hint">' + esc(T('Do zapłaty:')) + ' <b>' + money(f.do_zaplaty) + '</b>' + (f.po_terminie.length ? ' · ' + esc(T('w tym po terminie:')) + ' <b>' + money(f.po_terminie) + '</b>' : '') + ' <span class="sub">· ' + esc(T('stan na')) + ' ' + plt(f.na_dzien) + '</span></p>' +
      (f.lista.length ? '<div class="tablewrap"><table class="inv"><thead><tr><th>' + [T('Numer'), T('Wystawiona'), T('Termin'), T('Kwota'), T('Status')].map(esc).join('</th><th>') + '</th></tr></thead><tbody>' +
        f.lista.map(function (x) { var st = INV[x.status] || [x.status, 'p-grey']; return '<tr><td>' + esc(x.invoice_number) + '</td><td>' + pl(x.issue_date) + '</td><td>' + pl(x.due_date) + '</td><td>' + Number(x.amount).toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' ' + esc(x.currency) + '</td><td>' + pillHtml(st[1], T(st[0])) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : empty(T('Brak faktur z ostatnich dwóch lat.')));
    el.innerHTML = h + '</div>';
  }
  LOADERS.ksiegowosc = function () {
    renderAcc();
    if (cache.ksiegi) return;
    var forNip = nip;
    call({ action: 'ksiegi', nip: nip }).then(function (o) { if (nip !== forNip) return; cache.ksiegi = o; if (view === 'ksiegowosc') renderAcc(); })
      .catch(function (e) { fail($('accBody'), e, 'ksiegowosc'); });
  };

  // ---------------- requests to the office ----------------
  var MAXF = 3, MAXB = 15 * 1024 * 1024, req = { worker: null, rodzaj: 'pytanie', files: [] };
  function openRequest(pre) {
    pre = pre || {};
    req = { worker: pre.worker || null, rodzaj: pre.rodzaj || 'pytanie', files: [] };
    card = null;
    show('zgloszenia');
    $('zKat').value = pre.kategoria || (S.zakres.kadry ? 'kadry' : S.zakres.ksiegowosc ? 'ksiegowosc' : 'inne');
    $('zTemat').value = pre.temat || ''; $('zTresc').value = '';
    $('zMsg').innerHTML = '';
    renderReqForm();
    $('zForm').scrollIntoView({ block: 'start' });
    (pre.temat ? $('zTresc') : $('zTemat')).focus();
  }
  function renderReqForm() {
    $('zWorker').hidden = !req.worker;
    $('zWorker').innerHTML = req.worker ? pillHtml('p-grey', T('dotyczy pracownika:') + ' ' + req.worker.name) + btn('data-zw', T('Usuń powiązanie')) : '';
    $('zFiles').innerHTML = req.files.map(function (f, i) { return '<span class="pill p-grey">' + esc(f.name + ' (' + rozmiar(f.size) + ')') + '</span>' + btn('data-zf="' + i + '"', '✕'); }).join(' ') || '<span class="sub">' + esc(T('nie wybrano plików')) + '</span>';
    $('zSend').disabled = !!podglad;
  }
  async function fileProblem(f) {
    if (!f.size) return T('Plik „{n}” jest pusty.', { n: f.name });
    if (f.size > MAXB) return T('Plik „{n}” jest za duży — najwyżej 15 MB.', { n: f.name });
    var b = new Uint8Array(await f.slice(0, 8).arrayBuffer());
    var ok = (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47);
    return ok ? '' : T('Plik „{n}”: dozwolone są tylko pliki PDF, JPG i PNG.', { n: f.name });
  }
  $('zPick').addEventListener('click', function () { $('zFile').click(); });
  $('zFile').addEventListener('change', async function () {
    var note = '';
    for (var i = 0; i < this.files.length; i++) {
      if (req.files.length >= MAXF) { note = T('Do jednego zgłoszenia można dodać najwyżej {n} pliki. Większą liczbę dokumentów prosimy wysłać w kolejnym zgłoszeniu albo w jednym pliku PDF.', { n: MAXF }); break; }
      var p = await fileProblem(this.files[i]);
      if (p) note = p; else req.files.push(this.files[i]);
    }
    this.value = '';
    $('zMsg').innerHTML = note ? '<div class="msg err">' + esc(note) + '</div>' : '';
    renderReqForm();
  });
  $('zForm').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-zf')) { req.files.splice(+b.getAttribute('data-zf'), 1); renderReqForm(); }
    if (b.hasAttribute('data-zw')) { req.worker = null; req.rodzaj = 'pytanie'; renderReqForm(); }
  });
  $('zForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var temat = $('zTemat').value.trim(), tresc = $('zTresc').value.trim();
    if (temat.length < 3 || tresc.length < 3) { $('zMsg').innerHTML = '<div class="msg err">' + esc(T('Prosimy wpisać temat i treść zgłoszenia.')) + '</div>'; return; }
    var b = $('zSend'), old = b.textContent; b.disabled = true; b.textContent = T('Wysyłam…');
    try {
      var body = { action: 'zgloszenie_nowe', nip: nip, kategoria: $('zKat').value, rodzaj: req.rodzaj, temat: temat, tresc: tresc, worker_id: req.worker ? req.worker.id : null };
      await call(body, req.files.length ? req.files : null);
      req = { worker: null, rodzaj: 'pytanie', files: [] };
      $('zTemat').value = ''; $('zTresc').value = '';
      $('zMsg').innerHTML = '<div class="msg ok">' + esc(T('Zgłoszenie zostało wysłane do biura. Status i odpowiedź pojawią się poniżej.')) + '</div>';
      delete cache.zgloszenia; S.liczby.zgloszenia_otwarte++;
      renderReqForm(); loadReq();
    } catch (err) { if (!err.gate) $('zMsg').innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; }
    b.disabled = !!podglad; b.textContent = old;
  });
  function renderReq() {
    var z = cache.zgloszenia, el = $('zList');
    if (!z) { el.innerHTML = empty(T('Ładowanie…')); return; }
    el.innerHTML = z.length ? z.map(function (x) {
      var st = Z_ST[x.status] || [x.status, 'p-grey'];
      return '<div class="row pdok"><div class="who"><strong>' + esc(x.temat) + '</strong><small>' + esc([plt(x.utworzono), T(KAT[x.kategoria] || x.kategoria), x.pracownik, x.autor].filter(Boolean).join(' · ')) + '</small></div>' +
        '<div class="pills">' + pillHtml(st[1], T(st[0])) + '</div><div class="pbody"><p class="hint" style="white-space:pre-wrap">' + esc(x.tresc) + '</p>' +
        (x.zalaczniki.length ? '<div class="pacts">' + x.zalaczniki.map(function (a) { return btn('data-get="zgloszenie:' + esc(x.id) + ':' + a.n + '"', a.nazwa + ' (' + rozmiar(a.rozmiar) + ')'); }).join('') + '</div>' : '') +
        (x.odpowiedz ? '<div class="msg ok"><b>' + esc(T('Odpowiedź biura')) + (x.odpowiedz_at ? ' · ' + esc(plt(x.odpowiedz_at)) : '') + '</b><br>' + esc(x.odpowiedz) + '</div>' : '') + '</div></div>';
    }).join('') : empty(T('Nie ma jeszcze zgłoszeń. Pytanie, dokument albo zmianę można wysłać formularzem powyżej — trafi od razu do właściwej osoby w biurze.'));
  }
  function loadReq() {
    renderReq();
    if (cache.zgloszenia) return;
    var forNip = nip;
    call({ action: 'zgloszenia', nip: nip }).then(function (o) { if (nip !== forNip) return; cache.zgloszenia = o.zgloszenia; if (view === 'zgloszenia') renderReq(); })
      .catch(function (e) { fail($('zList'), e, 'zgloszenia'); });
  }
  LOADERS.zgloszenia = function () { renderReqForm(); loadReq(); };

  // ---------------- the firm's data ----------------
  function renderFirm() {
    var f = cache.firma, el = $('firmBody');
    if (!f) { el.innerHTML = '<div class="box">' + empty(T('Ładowanie…')) + '</div>'; return; }
    var d = f.dane, r = f.rejestr;
    var h = '<div class="box"><h2>' + esc(T('Dane firmy w biurze')) + '</h2><p class="hint">' + esc(T('Tak Państwa firma jest zapisana w bazie biura. Zmianę danych prosimy zgłosić — wprowadzi ją biuro.')) + '</p>' +
      field(T('nazwa'), d.nazwa) + field('NIP', d.nip) + field(T('forma prawna'), d.forma) + field(T('forma opodatkowania'), d.opodatkowanie) + field(T('adres'), [d.adres, d.miasto].filter(Boolean).join(', ')) +
      field(T('telefon kontaktowy'), d.telefon) + field(T('e-mail kontaktowy'), d.email) + field(T('osoba kontaktowa'), d.kontakt) +
      '<div class="pacts">' + btn('data-req="dane"', T('Zgłoś zmianę danych'), 'btn') + '</div></div>';
    if (r) h += '<div class="box"><h2>' + esc(T('Dane z rejestru')) + '</h2><p class="hint">' + esc(T('Jawne dane z rejestru przedsiębiorców') + (r.sprawdzono ? ' · ' + T('sprawdzono') + ' ' + pl(r.sprawdzono) : '')) + '</p>' +
      field('KRS', r.krs) + field('REGON', r.regon) + field(T('nazwa w rejestrze'), r.nazwa) + field(T('forma prawna'), r.forma) + field(T('adres siedziby'), r.adres) + field(T('data rejestracji'), pl(r.data_rejestracji)) +
      field(T('stan'), r.stan) + field(T('sposób reprezentacji'), r.reprezentacja) +
      r.zarzad.map(function (o) { return row(esc(o.imie_nazwisko), esc(o.funkcja || T('zarząd'))); }).join('') + '</div>';
    h += '<div class="box"><h2>' + esc(T('Kto ma dostęp do profilu')) + '</h2><p class="hint">' + esc(T('Konta, które widzą dane tej firmy. Nowe konto albo odebranie dostępu — przez biuro.')) + '</p>' +
      (f.konta.length ? f.konta.map(function (k) { return row(esc(k.email), esc(k.ostatnie_logowanie ? T('ostatnie logowanie:') + ' ' + plt(k.ostatnie_logowanie) : T('jeszcze się nie logowano')), k.ja ? pillHtml('p-ok', T('to Państwa konto')) : ''); }).join('') : empty(T('Brak kont.'))) +
      '<div class="pacts">' + btn('data-req="konto"', T('Poproś o konto dla kolejnej osoby')) + '</div></div>';
    h += '<div class="box"><h2>' + esc(T('Powiadomienia i hasło')) + '</h2>' +
      row(esc(f.powiadomienia.email), esc(T('na ten adres wysyłamy link do logowania; ważne wiadomości biuro wysyła na adres kontaktowy firmy')), pillHtml('p-ok', 'e-mail')) +
      (d.telefon ? row(esc(d.telefon), esc(T('pilne przypomnienia biuro może wysłać SMS-em na telefon kontaktowy firmy')), pillHtml('p-grey', 'SMS')) : '') +
      (f.powiadomienia.telegram && /^https:\/\/t\.me\//.test(f.powiadomienia.telegram.link || '') ? row(esc(T('Powiadomienia w Telegramie')), esc(T('przypomnienia o terminach i dokumentach w prywatnej rozmowie z botem biura')), '<a class="mini" target="_blank" rel="noopener noreferrer" href="' + esc(f.powiadomienia.telegram.link) + '">' + esc(T('Włącz powiadomienia w Telegramie')) + '</a>') : '') +
      '<div class="pacts">' + (podglad ? '' : btn('data-chpass', T('Zmień hasło'))) + '</div></div>';
    el.innerHTML = h;
  }
  LOADERS.firma = function () {
    renderFirm();
    if (cache.firma) return;
    var forNip = nip;
    call({ action: 'firma', nip: nip }).then(function (o) { if (nip !== forNip) return; cache.firma = o; if (view === 'firma') renderFirm(); })
      .catch(function (e) { fail($('firmBody'), e, 'firma'); });
  };

  // ---------------- help ----------------
  var HELP = [
    ['Jak podpisać dokument przez internet', ['Otworzyć zakładkę „Dokumenty” — dokumenty czekające na podpis są na górze.', 'Pobrać dokument (PDF) i niczego w nim nie zmieniać.', 'Podpisać: podpisem kwalifikowanym w swoim programie, podpisem zaufanym na podpis.gov.pl albo odręcznie na wydruku.', 'Wgrać podpisany plik (albo skan podpisanego wydruku) przy tym samym dokumencie.', 'Biuro sprawdza każdy podpis — status dokumentu zmieni się na „podpisany”.']],
    ['Jak zgłosić nowego pracownika', ['Na ekranie „Start” albo „Pracownicy” nacisnąć „Zatrudnij nowego pracownika”.', 'Formularz ma już wpisane dane firmy — dodać zdjęcia dokumentów pracownika i warunki umowy.', 'Biuro sprawdzi dane i przygotuje dokumenty; postęp widać na liście pracowników ze statusem „w trakcie”.', 'Gotowe dokumenty pojawią się w zakładce „Dokumenty”.']],
    ['Jak przesłać dokumenty księgowe', ['Nacisnąć „Prześlij dokumenty księgowe” (ekran „Start” albo „Księgowość”).', 'Dodać pliki PDF, JPG albo PNG — do 3 plików po 15 MB w jednym zgłoszeniu; wiele faktur najlepiej zeskanować do jednego pliku PDF.', 'Wysłać — zgłoszenie trafia do opiekuna księgowego, a jego status widać w „Kontakt z biurem”.']],
    ['Jak zgłosić zmianę dotyczącą pracownika', ['W zakładce „Pracownicy” otworzyć kartę pracownika.', 'Na dole karty wybrać rodzaj zmiany: zakończenie współpracy, przedłużenie umowy, zmiana warunków albo nowy dokument.', 'Opisać zmianę (np. datę) i wysłać — biuro przygotuje potrzebne dokumenty.']],
    ['Bezpieczeństwo konta', ['Hasła nie podajemy nikomu — pracownik biura nigdy o nie nie prosi.', 'Na cudzym urządzeniu po zakończeniu pracy prosimy nacisnąć „Wyloguj”.', 'Gdy ktoś z firmy nie powinien już mieć dostępu — prosimy od razu napisać do biura.']],
  ];
  LOADERS.pomoc = function () {
    $('helpBody').innerHTML = HELP.map(function (x) {
      return '<div class="box"><h2>' + esc(T(x[0])) + '</h2><ol class="how">' + x[1].map(function (s) { return '<li>' + esc(T(s)) + '</li>'; }).join('') + '</ol></div>';
    }).join('') + '<div class="box"><h2>' + esc(T('Nie ma tu odpowiedzi?')) + '</h2><div class="pacts">' + btn('data-req="nowe"', T('Napisz do biura'), 'btn') +
      (S ? '<a class="mini" href="tel:+48' + esc(S.kontakt.biuro.telefon.replace(/\D/g, '')) + '">' + esc(T('Zadzwoń:') + ' ' + S.kontakt.biuro.telefon) + '</a>' : '') + '</div></div>';
  };

  // ---------------- one firm ----------------
  async function loadFirm() {
    var f = firms.filter(function (x) { return x.nip === nip; })[0] || firms[0];
    nip = f.nip; S = null; cache = {}; card = null;
    $('firmName').textContent = f.nazwa;
    clearP();
    $('appMsg').innerHTML = '<div class="box">' + empty(T('Ładowanie…')) + '</div>';
    $('views').hidden = true; $('nav').hidden = true; $('hello').textContent = ''; $('lead').textContent = '';
    var forNip = nip;
    try { var s = await call({ action: 'start', nip: nip }); if (nip !== forNip) return; S = s; }
    catch (e) { if (!e.gate) $('appMsg').innerHTML = '<div class="box"><div class="msg err">' + esc(e.message) + '</div><div class="pacts">' + btn('data-again="firm"', T('Spróbuj ponownie')) + '</div></div>'; return; }
    // the language the office recorded for the client, unless the person chose one here
    if (!langChosen && S.jezyk !== lang) { lang = S.jezyk; applyStatic(); }
    $('appMsg').innerHTML = ''; $('views').hidden = false; $('nav').hidden = false;
    if (podglad) { f.nazwa = S.firma.nazwa; $('firmName').textContent = f.nazwa; }
    show(view || 'start');
    // only now: `start` has just passed the session and password checks
    if (S.zakres.kadry && !podglad) { renderP(); loadP().then(function () { if (S && view === 'dokumenty') renderDocs(); }); }
  }
  function start(profile) {
    firms = profile.firmy || [];
    $('login').hidden = true; $('setpass').hidden = true; $('app').hidden = false;
    var sel = $('firmSel');
    sel.hidden = firms.length < 2; $('firmName').hidden = firms.length > 1;
    sel.innerHTML = firms.map(function (f) { return '<option value="' + esc(f.nip) + '">' + esc(f.nazwa) + '</option>'; }).join('');
    $('views').hidden = true;
    if (!firms.length) { $('nav').hidden = true; $('appMsg').innerHTML = '<div class="box">' + empty(T('Do konta nie przypisano jeszcze żadnej firmy. Prosimy o kontakt z biurem.')) + '</div>'; return; }
    view = 'start';
    loadFirm();
  }
  $('firmSel').addEventListener('change', function () { nip = this.value; view = 'start'; loadFirm(); });
  var REQ = {
    nowe: {}, odp: { kategoria: 'ksiegowosc', temat: 'Odpowiedź na prośbę biura' }, dok: { kategoria: 'ksiegowosc', rodzaj: 'dokumenty_ksiegowe', temat: 'Dokumenty księgowe' },
    dane: { kategoria: 'inne', rodzaj: 'dane_firmy', temat: 'Zmiana danych firmy' }, konto: { kategoria: 'inne', temat: 'Dostęp do profilu dla kolejnej osoby' },
  };
  $('app').addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy],[data-get],[data-card],[data-req],[data-again],[data-chpass],[data-fin],.tile[data-view],.box [data-view]');
    if (!b) return;
    if (b.hasAttribute('data-copy')) return copy(b);
    if (b.hasAttribute('data-get')) { var g = b.getAttribute('data-get').split(':'); return pobierz(b, g[0], g[1], g[2] ? +g[2] : undefined); }
    if (b.hasAttribute('data-card')) return openCard(b.getAttribute('data-card'));
    if (b.hasAttribute('data-req')) { var r = REQ[b.getAttribute('data-req')] || {}; return openRequest({ kategoria: r.kategoria, rodzaj: r.rodzaj, temat: r.temat ? T(r.temat) : '' }); }
    if (b.hasAttribute('data-chpass')) return changePass();
    if (b.hasAttribute('data-again')) { var a = b.getAttribute('data-again'); return a === 'firm' ? loadFirm() : show(a, true); }
    if (b.hasAttribute('data-fin')) {
      var f = b.getAttribute('data-fin').split(':');
      b.disabled = true;
      return callP({ action: 'plik', dokument: f[0], ktory: f[1] }).then(function (o) { var a2 = document.createElement('a'); a2.href = o.url; a2.download = o.nazwa || ''; a2.rel = 'noopener'; document.body.appendChild(a2); a2.click(); a2.remove(); })
        .catch(function (err) { if (!err.gate) alert(T('Nie udało się pobrać pliku:') + ' ' + err.message); }).then(function () { b.disabled = false; });
    }
    if (b.hasAttribute('data-view')) { card = null; return show(b.getAttribute('data-view')); }
  });

  // ---------------- documents to sign (function `podpisy`) ----------------
  // The signing happens outside the profile: the employer downloads the PDF, signs it (qualified
  // signature, podpis zaufany or by hand on a printout) and sends the result back; the office
  // verifies every signature. Which ways are allowed for a document — and the warning a way may
  // carry — always comes from the function, never from this file. Loaded only from loadFirm(),
  // i.e. after the session passed the password gate of the `klient` function.
  var FNP = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/podpisy';
  // the employer's limit in checks.ts (MAX_BYTES): what the personnel-file bucket takes
  var MAX_MB = 24, MAXP = MAX_MB * 1024 * 1024, ZA_DUZY = 'Plik jest za duży — najwyżej ' + MAX_MB + ' MB.';
  var pak = null, pErr = '', pOpen = {}, pForm = {}, pWybor = {}, pMsg = {}, pOstrz = {}, pJak = false, pStare = false;
  function clearP() {
    pak = null; pErr = ''; pOpen = {}; pForm = {}; pWybor = {}; pMsg = {}; pOstrz = {}; pJak = false; pStare = false;
    $('boxPodpisy').hidden = true; $('podpisy').innerHTML = ''; $('podpisyJak').innerHTML = ''; $('podpisyIle').hidden = true;
  }
  async function callP(body, file) {
    var init = { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'x-klient-token': token } };
    if (file) {
      var fd = new FormData();
      Object.keys(body).forEach(function (k) { if (body[k] != null) fd.append(k, String(body[k])); });
      fd.append('plik', file, file.name || 'plik');
      init.body = fd;
    } else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var res;
    try { res = await fetch(FNP, init); } catch (e) { throw new Error('Brak połączenia z serwerem. Prosimy sprawdzić internet i spróbować ponownie.'); }
    var out = await res.json().catch(function () { return {}; });
    // the same two gates as in call(): a dead session and an account without a password
    if (out.wyloguj || out.ustaw_haslo) {
      if (out.wyloguj) signOut(true); else { clearP(); $('app').hidden = true; $('login').hidden = true; $('setpass').hidden = false; }
      var g = new Error(out.error); g.gate = true; throw g;
    }
    if (!res.ok || out.error) {
      var err = new Error(out.error || (res.status === 413 ? ZA_DUZY : 'Serwer nie odpowiedział poprawnie (błąd ' + res.status + '). Prosimy spróbować ponownie za chwilę.'));
      err.kod = out.kod || (res.status === 413 ? 'rozmiar' : res.status === 429 ? 'limit' : ''); err.status = res.status; err.out = out;
      throw err;
    }
    return out;
  }
  async function loadP() {
    var forNip = nip;
    try {
      var out = await callP({ action: 'lista', nip: forNip });
      if (!token || nip !== forNip) return;
      pak = out.pakiety || []; pErr = '';
    } catch (e) {
      if (e.gate || !token || nip !== forNip) return;
      pErr = e.message;
    }
    renderP();
  }

  // what to do next, added to the server's own text for each refusal of an upload
  var CO_DALEJ = {
    pusty: 'Prosimy wybrać plik jeszcze raz — ten ma 0 bajtów (np. niedokończony skan albo pobieranie).',
    rozmiar: 'Prosimy zmniejszyć plik: skan w rozdzielczości 150–200 dpi albo w odcieniach szarości zwykle wystarcza.',
    typ: 'Prosimy wgrać plik PDF, a przy podpisie odręcznym — PDF, JPG albo PNG.',
    niezgodny: 'Prosimy nie zmieniać rozszerzenia pliku ręcznie — wgrać plik w takiej postaci, w jakiej zapisał go skaner, telefon albo program do podpisu.',
    pdf: 'Jeżeli dokument podpisano odręcznie — prosimy wybrać sposób „podpis odręczny”. Jeżeli elektronicznie — wgrać plik PDF zapisany przez program do podpisu.',
    bez_podpisu: 'W programie do podpisu prosimy wybrać podpis wewnątrz pliku PDF (PAdES), a na podpis.gov.pl pobrać plik po podpisaniu — i wgrać właśnie ten plik.',
    nie_nasz: 'Prosimy pobrać dokument jeszcze raz przyciskiem „Pobierz dokument do podpisu”, podpisać ten plik bez otwierania go w edytorze i wgrać wynik.',
    niepodpisany: 'Prosimy wgrać skan albo zdjęcie podpisanego wydruku, a nie plik pobrany z profilu.',
    metoda_niedozwolona: 'Lista została odświeżona — prosimy wybrać jeden ze sposobów widocznych przy dokumencie.',
    ostrzezenie: 'Prosimy przeczytać ostrzeżenie, zaznaczyć potwierdzenie pod nim i wysłać plik ponownie.',
    ostrzezenie_osobiscie: 'Taki plik pracownik wysyła sam, przez swój link od biura. Za pracownika można wgrać tylko skan dokumentu podpisanego odręcznie.',
    kolejnosc: 'Prosimy najpierw wysłać dokument z podpisem firmy i poczekać, aż biuro go zweryfikuje.',
    krok: 'Lista została odświeżona — ten krok jest już zakończony albo nie dotyczy tego dokumentu.',
    zamkniety: 'Pakiet został zamknięty albo anulowany. W razie wątpliwości prosimy o kontakt z biurem.',
    limit: 'Jeżeli sprawa jest pilna, prosimy o kontakt z biurem.',
    metoda: 'Prosimy wybrać sposób podpisania i wysłać plik ponownie.',
    plik: 'Prosimy wybrać plik i wysłać go ponownie.',
    zapis: 'To błąd po stronie serwera — prosimy spróbować ponownie za chwilę.',
  };
  function blad(err) { var d = CO_DALEJ[err.kod]; return err.message + (d ? ' ' + d : ''); }
  var OSOBNY = 'Podpisy w osobnych plikach (XAdES, ASiC — pliki .xades, .xml, .sig, .asic) nie są w tej wersji przyjmowane. Prosimy podpisać sam plik PDF: podpis musi być wewnątrz pliku (PAdES).';
  // the same checks the server makes on the bytes, done before anything is sent
  async function sprawdz(file, metoda) {
    var ext = (/\.([A-Za-z0-9]+)$/.exec(file.name || '') || ['', ''])[1].toLowerCase();
    if (/^(xades|xml|sig|sign|asic|asice|asics|p7s|p7m)$/.test(ext)) return OSOBNY;
    if (!file.size) return 'Plik jest pusty. ' + CO_DALEJ.pusty;
    if (file.size > MAXP) return ZA_DUZY + ' ' + CO_DALEJ.rozmiar;
    var b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    var kind = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d ? 'pdf' : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpeg' : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? 'png' : '';
    var t = (file.type || '').toLowerCase(), decl = !t || t === 'application/octet-stream' ? '' : t === 'application/pdf' ? 'pdf' : /^image\/p?jpe?g$/.test(t) ? 'jpeg' : t === 'image/png' ? 'png' : 'other';
    if (!kind || decl === 'other') return 'Dozwolone są tylko pliki PDF, JPG i PNG. ' + OSOBNY;
    if (decl && decl !== kind) return 'Zawartość pliku nie odpowiada jego typowi. ' + CO_DALEJ.niezgodny;
    if (metoda !== 'odreczny' && kind !== 'pdf') return 'Plik podpisany elektronicznie musi być plikiem PDF z podpisem w środku (PAdES). ' + CO_DALEJ.pdf;
    return '';
  }

  // the three ways in plain words; which of them a document accepts is shown at the document
  var JAK = [
    ['Kwalifikowany podpis elektroniczny', 'Płatny podpis z certyfikatem (karta, token albo aplikacja w telefonie) — w programie dostawcy podpisu.',
      ['Pobrać dokument (plik PDF) z profilu i niczego w nim nie zmieniać.', 'Podpisać go w swoim programie do podpisu — jako podpis wewnątrz pliku PDF (format PAdES), a nie osobny plik .xades / .xml / .sig.', 'Wgrać tutaj plik PDF zapisany przez program.']],
    ['Podpis zaufany', 'Bezpłatny, przez internet — potrzebny jest profil zaufany osoby, która podpisuje za firmę.',
      ['Pobrać dokument (plik PDF) z profilu i niczego w nim nie zmieniać.', 'Wejść na https://podpis.gov.pl, wybrać podpisanie dokumentu elektronicznie, wskazać pobrany plik PDF i podpisać go podpisem zaufanym.', 'Pobrać podpisany plik z podpis.gov.pl.', 'Wgrać ten podpisany plik tutaj.']],
    ['Odręcznie — wydruk i skan', 'Bez żadnych kont i programów.',
      ['Pobrać dokument i wydrukować wszystkie strony.', 'Podpisać długopisem w miejscu na podpis.', 'Zeskanować albo wyraźnie sfotografować podpisany dokument: wszystkie strony w jednym pliku PDF (pojedynczą stronę można wgrać jako zdjęcie JPG albo PNG).', 'Wgrać ten plik tutaj.']],
  ];
  function jakHtml() {
    var h = '<div class="pacts" style="margin:0 0 10px"><button type="button" class="mini" data-jak>' + (pJak ? 'Ukryj instrukcję' : 'Jak podpisać?') + '</button></div>';
    if (!pJak) return h;
    return h + JAK.map(function (j) {
      return '<div class="pstep">' + esc(j[0]) + '</div><p class="hint" style="margin:0">' + esc(j[1]) + '</p><ol class="how">' + j[2].map(function (s) {
        return '<li>' + esc(s).replace('https://podpis.gov.pl', '<a href="https://podpis.gov.pl" target="_blank" rel="noopener noreferrer">podpis.gov.pl</a>') + '</li>';
      }).join('') + '</ol>';
    }).join('') +
      '<p class="hint">Nie każdy dokument można podpisać każdym sposobem — sposoby dopuszczalne dla danego dokumentu są widoczne przy nim.</p>' +
      '<p class="hint">Przyjmujemy tylko pliki PDF, JPG i PNG do ' + MAX_MB + ' MB. Podpisy w osobnych plikach (XAdES, ASiC — pliki .xades, .xml, .sig, .asic) nie są w tej wersji przyjmowane: podpis musi być wewnątrz pliku PDF (PAdES). ' +
      'Podpis elektroniczny składa się na dokładnie tym pliku, który został pobrany z profilu — bez „drukowania do PDF” i bez zapisywania „jako”; inaczej portal odpowie: „To nie jest plik, który wydaliśmy”. Każdy podpis sprawdza pracownik biura.</p>';
  }

  var PAK_ST = { u_pracodawcy: ['do podpisania', 'p-amber'], u_pracownika: ['czeka na pracownika', 'p-grey'], weryfikacja: ['biuro sprawdza podpisy', 'p-grey'], gotowy: ['podpisane', 'p-ok'], zakonczony: ['zakończony', 'p-ok'], anulowany: ['anulowany', 'p-grey'] };
  function zamkniety(p) { return p.status === 'zakonczony' || p.status === 'anulowany'; }
  function gotowy(d) { return d.status === 'gotowy' || d.status === 'w_aktach'; }
  function doPodpisu(p) { return zamkniety(p) ? 0 : p.dokumenty.filter(function (d) { return d.zadanie === 'podpisz'; }).length; }
  function odreczny(d) { return d.reguly.pracownik.metody.filter(function (x) { return x.id === 'odreczny' && !x.ostrzezenie; })[0]; }
  // may the employer bring the worker's hand-signed scan now? (its own step is done, the worker's is open)
  function zaPracownika(d, p) {
    if (zamkniety(p) || gotowy(d) || d.status === 'anulowany' || d.zadanie !== 'nic' || !odreczny(d)) return false;
    if (['zweryfikowany', 'nie_dotyczy'].indexOf(d.pracodawca.status) === -1) return false;
    var s = d.pracownik.status;
    return s === 'oczekuje' || s === 'odrzucony' || (s === 'wgrany' && d.pracownik.wgral === 'pracodawca');
  }
  function dl(ktory, label) { return '<button type="button" class="mini" data-dl="' + ktory + '">' + esc(label) + '</button>'; }
  function fold(key, label) { return '<div class="pacts"><button type="button" class="mini" data-fold="' + esc(key) + '">' + esc(pForm[key] ? 'Zwiń' : label) + '</button></div>'; }

  // the upload form of one side; strona "pracownik" = the scan of the worker's handwritten signature
  function formP(d, strona) {
    var wlasny = strona === 'pracodawca', key = d.id + ':' + strona;
    var ms = wlasny ? d.reguly.pracodawca.metody : [odreczny(d)];
    var sel = wlasny ? (pWybor[d.id] || (ms.length === 1 ? ms[0].id : '')) : 'odreczny';
    var cur = ms.filter(function (x) { return x.id === sel; })[0] || null;
    var h = '<div data-form="' + esc(key) + '" data-strona="' + strona + '" data-metoda="' + esc(cur ? cur.id : '') + '">';
    if (wlasny) {
      h += '<div class="pstep">1. Pobierz dokument</div>' +
        '<p class="hint">Podpis elektroniczny składa się na dokładnie tym pliku — bez drukowania do PDF i zapisywania „jako”. Do podpisu odręcznego prosimy wydrukować wszystkie strony.</p>' +
        '<div class="pacts">' + dl('do_podpisu', 'Pobierz dokument do podpisu (PDF)') + '</div>' +
        '<div class="pstep">2. Wybierz sposób podpisania</div><p class="hint">' + esc(d.reguly.pracodawca.podstawa) + '</p>' +
        ms.map(function (x) {
          return '<label class="opt"><input type="radio" name="pm_' + esc(d.id) + '" value="' + esc(x.id) + '"' + (cur && x.id === cur.id ? ' checked' : '') + ' /><span>' + esc(x.nazwa) +
            (x.ostrzezenie ? ' — <b>niezalecany, z ostrzeżeniem</b>' : '') + '</span></label>';
        }).join('');
      if (!cur) return h + '</div>';
      if (cur.uwaga) h += '<div class="msg ok">' + esc(cur.uwaga) + '</div>';
      // the server's text word for word (a newer version from a 409 answer wins); never pre-ticked
      var o = cur.ostrzezenie ? pOstrz[d.id + ':' + cur.id] || cur.ostrzezenie : null;
      if (o) {
        h += '<div class="msg warn" data-wersja="' + esc(o.wersja) + '"><b>Ostrzeżenie (' + esc(o.wersja) + ')</b>' + esc(o.tekst) + '</div>' +
          '<label class="chk"><input type="checkbox" data-ack /><span>' + esc(o.potwierdzenie) + '</span></label>';
      }
    }
    var odr = cur.id === 'odreczny';
    h += '<div class="pstep">' + (wlasny ? '3. ' : '') + (odr ? 'Wyślij skan albo zdjęcie podpisanego dokumentu' : 'Wyślij podpisany plik PDF') + '</div>' +
      '<p class="hint">' + (odr ? 'Wszystkie strony w jednym pliku PDF (pojedynczą stronę można wgrać jako zdjęcie JPG albo PNG), wyraźnie, bez obciętych brzegów. Najwyżej ' + MAX_MB + ' MB.'
        : 'Dokładnie ten plik, który zapisał program do podpisu albo podpis.gov.pl — tylko PDF z podpisem w środku (PAdES), najwyżej ' + MAX_MB + ' MB. Osobnych plików podpisu (.xades, .xml, .sig, .asic) nie przyjmujemy.') + '</p>' +
      '<div class="pacts"><button type="button" class="mini" data-pick>Wybierz plik…</button><span class="sub" data-fname>nie wybrano pliku</span></div>' +
      '<input type="file" data-file hidden accept="' + (odr ? 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png' : 'application/pdf,.pdf') + '" />' +
      '<div class="pacts"><button type="button" class="btn" data-send disabled>Wyślij do weryfikacji</button></div><div data-up></div>';
    return h + '</div>';
  }

  function dokP(d, p) {
    var pd = d.pracodawca, pr = d.pracownik, z = d.zadanie, fin = gotowy(d), nieaktywny = d.status === 'anulowany' || p.status === 'anulowany';
    var pdOk = pd.status === 'zweryfikowany' || pd.status === 'nie_dotyczy';
    var st = nieaktywny ? ['anulowany', 'p-grey'] : fin ? [d.podpisuje === 'potwierdzenie' ? 'odbiór potwierdzony' : 'podpisany', 'p-ok'] : pd.status === 'odrzucony' ? ['do poprawy', 'p-red'] : z === 'podpisz' ? ['do podpisania', 'p-amber'] :
      z === 'czeka_na_weryfikacje' ? ['biuro sprawdza podpis', 'p-grey'] : !pdOk ? [d.status_nazwa, 'p-grey'] : pr.status === 'odrzucony' ? ['podpis pracownika do poprawy', 'p-red'] :
      pr.status === 'wgrany' ? ['biuro sprawdza podpis pracownika', 'p-grey'] : d.podpisuje === 'potwierdzenie' ? ['pracownik potwierdza odbiór', 'p-grey'] : ['czeka na pracownika', 'p-grey'];
    var h = '<div class="row pdok" data-id="' + esc(d.id) + '"><div class="who"><strong>' + esc(d.tytul) + '</strong><small>' + [d.rodzaj_nazwa, d.podpisuje_nazwa && (d.podpisuje === 'potwierdzenie' ? '' : 'podpisuje: ') + d.podpisuje_nazwa].filter(Boolean).map(esc).join(' · ') + '</small></div>' +
      '<div class="pills"><span class="pill ' + st[1] + '">' + esc(st[0]) + '</span></div><div class="pbody">';
    var ma = function (k) { return d.pliki.indexOf(k) !== -1; };

    if (nieaktywny) h += '<p class="hint">Dokument został anulowany przez biuro — niczego nie trzeba z nim robić.</p>';
    else if (fin) {
      h += '<p class="hint">' + (d.podpisuje === 'potwierdzenie' ? 'Pracownik potwierdził odbiór dokumentu' + (d.odbior_at ? ' ' + plt(d.odbior_at) : '') + '.' : 'Dokument jest podpisany i sprawdzony przez biuro.') + ' Mogą Państwo pobrać swój egzemplarz.</p><div class="pacts">' +
        d.finalne.map(function (k) { return dl(k, k === 'wydany' ? 'Pobierz dokument' : k === 'pracodawca' ? 'Pobierz egzemplarz z podpisem firmy' : pr.baza === 'pracodawca' ? 'Pobierz podpisany dokument (oba podpisy)' : 'Pobierz egzemplarz z podpisem pracownika'); }).join('') + '</div>';
    } else if (z === 'podpisz' || z === 'czeka_na_weryfikacje') {
      // the firm's own signature
      if (pd.status === 'odrzucony') h += '<div class="msg err">Biuro nie przyjęło poprzedniego pliku. Powód: ' + esc(pd.odrzucenie || 'nie podano') + ' Prosimy podpisać dokument jeszcze raz i wysłać nowy plik.</div>';
      if (z === 'czeka_na_weryfikacje') {
        h += '<div class="msg ok">Plik wysłany ' + esc(plt(pd.at)) + (pd.metoda_nazwa ? ' (' + esc(pd.metoda_nazwa) + ')' : '') + ' — czeka na weryfikację przez biuro. Nic więcej nie trzeba robić.</div>' +
          '<div class="pacts">' + (ma('pracodawca') ? dl('pracodawca', 'Pobierz wysłany plik') : '') + '</div>' +
          fold(d.id + ':pracodawca', 'Wyślij inny plik') + (pForm[d.id + ':pracodawca'] ? formP(d, 'pracodawca') : '');
      } else h += formP(d, 'pracodawca');
    } else if (!pdOk) h += '<p class="hint">' + esc(d.status_nazwa) + '</p>';
    else if (d.podpisuje === 'potwierdzenie') {
      h += '<p class="hint">Tego dokumentu się nie podpisuje — pracownik potwierdza jego odbiór na swojej stronie, do której link dostaje od biura.</p><div class="pacts">' + (ma('wydany') ? dl('wydany', 'Pobierz dokument') : '') + '</div>';
    } else {
      // the worker's turn
      var key = d.id + ':pracownik', moze = zaPracownika(d, p);
      if (pr.status === 'odrzucony') h += '<div class="msg err">Biuro nie przyjęło pliku z podpisem pracownika. Powód: ' + esc(pr.odrzucenie || 'nie podano') + ' Potrzebny jest nowy plik z podpisem pracownika.</div>';
      else if (pr.status === 'wgrany') h += '<div class="msg ok">Plik z podpisem pracownika wysłany ' + esc(plt(pr.at)) + ' — czeka na weryfikację przez biuro.</div>';
      else h += '<p class="hint">' + (pd.status === 'zweryfikowany' ? 'Podpis firmy został zweryfikowany. ' : '') + 'Teraz podpisuje pracownik — sam, przez link, który dostaje od biura, albo odręcznie na wydruku.</p>';
      h += '<div class="pacts">' + (ma('wydany') ? dl('wydany', 'Pobierz dokument') : '') + (ma('pracodawca') ? dl('pracodawca', 'Pobierz egzemplarz z podpisem firmy') : '') + (ma('pracownik') ? dl('pracownik', 'Pobierz plik z podpisem pracownika') : '') + '</div>';
      if (moze) {
        h += (pr.status === 'wgrany' ? '' : '<p class="hint" style="margin-top:10px">' + (p.bez_pesel ? 'Pracownik nie ma numeru PESEL, więc nie użyje podpisu zaufanego — najprościej: ' : 'Jeżeli pracownik podpisuje odręcznie: ') +
          'wydrukować dokument, dać pracownikowi do podpisania i wgrać tutaj skan albo zdjęcie podpisanego dokumentu.</p>') +
          fold(key, pr.status === 'wgrany' ? 'Wyślij inny skan' : 'Wgraj skan z odręcznym podpisem pracownika') + (pForm[key] ? formP(d, 'pracownik') : '');
      }
    }
    var m = pMsg[d.id];
    return h + '<div data-note>' + (m ? '<div class="msg ' + m[0] + '">' + esc(m[1]) + '</div>' : '') + '</div></div></div>';
  }
  function pakP(p) {
    var n = p.dokumenty.length, todo = doPodpisu(p);
    var uwaga = todo || (!zamkniety(p) && p.dokumenty.some(function (d) { return d.pracodawca.status === 'odrzucony' || d.pracownik.status === 'odrzucony' || zaPracownika(d, p); }));
    var open = pOpen[p.id] != null ? pOpen[p.id] : !!uwaga;
    var st = todo ? [todo + ' do podpisania', 'p-amber'] : PAK_ST[p.status] || [p.status_nazwa, 'p-grey'];
    var opis = [p.typ === 'praca' ? 'umowa o pracę' : p.typ === 'zlecenie' ? 'umowa zlecenia' : '', n + (n === 1 ? ' dokument' : ' dok.'), p.wydano_at && 'przekazano ' + plt(p.wydano_at).slice(0, 10),
      p.zakonczono_at && 'zakończono ' + plt(p.zakonczono_at).slice(0, 10), p.anulowano_at && 'anulowano ' + plt(p.anulowano_at).slice(0, 10)].filter(Boolean).join(' · ');
    return '<div class="row" data-pak="' + esc(p.id) + '"><div class="who"><strong>' + esc(p.worker_name) + '</strong><small>' + esc(opis) + '</small></div>' +
      '<div class="pills"><span class="pill ' + st[1] + '">' + esc(st[0]) + '</span><button type="button" class="mini" data-toggle="' + (open ? 0 : 1) + '">' + (open ? 'Zwiń' : 'Pokaż dokumenty') + '</button></div></div>' +
      (open ? '<div class="pdocs">' + (n ? p.dokumenty.map(function (d) { return dokP(d, p); }).join('') : '<div class="empty">Pakiet nie zawiera dokumentów.</div>') + '</div>' : '');
  }
  function renderP() {
    var ile = $('podpisyIle');
    $('boxPodpisy').hidden = false;
    $('podpisyJak').innerHTML = pak && pak.length ? jakHtml() : '';
    if (!pak || pErr) {
      ile.hidden = true;
      $('podpisyJak').innerHTML = '';
      $('podpisy').innerHTML = pErr ? '<div class="msg err">Nie udało się wczytać dokumentów do podpisu: ' + esc(pErr) + '</div><div class="pacts"><button type="button" class="mini" data-retry>Spróbuj ponownie</button></div>' : '<div class="empty">Ładowanie…</div>';
      return;
    }
    var todo = pak.reduce(function (s, p) { return s + doPodpisu(p); }, 0);
    ile.hidden = !todo; ile.textContent = todo ? todo + ' do podpisania' : '';
    var akt = pak.filter(function (p) { return !zamkniety(p); }), stare = pak.filter(zamkniety);
    $('podpisy').innerHTML = (akt.length ? akt.map(pakP).join('') : '<div class="empty">Nie ma teraz dokumentów czekających na podpis.' + (stare.length ? '' : ' Gdy biuro przygotuje dokumenty do podpisania przez internet, pojawią się tutaj.') + '</div>') +
      (stare.length ? '<div class="pacts" style="margin:10px 0 0"><button type="button" class="mini" data-stare>' + (pStare ? 'Ukryj zakończone' : 'Pokaż zakończone i anulowane (' + stare.length + ')') + '</button></div>' + (pStare ? stare.map(pakP).join('') : '') : '');
  }
  function dokById(id) {
    for (var i = 0; pak && i < pak.length; i++) for (var j = 0; j < pak[i].dokumenty.length; j++) if (pak[i].dokumenty[j].id === id) return pak[i].dokumenty[j];
    return null;
  }
  function note(el, cls, text) { if (el) el.innerHTML = text ? '<div class="msg ' + cls + '">' + esc(text) + '</div>' : ''; }
  // "Wyślij" works only with a file chosen and — when the way carries a warning — the box ticked by hand
  function gotowe(form) {
    var f = form.querySelector('[data-file]'), ack = form.querySelector('[data-ack]');
    form.querySelector('[data-send]').disabled = !(f.files && f.files.length) || !!(ack && !ack.checked);
  }
  $('boxPodpisy').addEventListener('change', function (e) {
    var t = e.target, row = t.closest('[data-id]'), form = t.closest('[data-form]');
    if (!row) return;
    if (t.type === 'radio') { pWybor[row.getAttribute('data-id')] = t.value; delete pMsg[row.getAttribute('data-id')]; renderP(); return; }
    if (!form) return;
    if (t.hasAttribute('data-file')) {
      var f = t.files && t.files[0];
      form.querySelector('[data-fname]').textContent = f ? f.name + ' (' + (f.size < 1048576 ? Math.max(1, Math.round(f.size / 1024)) + ' KB' : (f.size / 1048576).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + ' MB') + ')' : 'nie wybrano pliku';
      note(form.querySelector('[data-up]'), '', '');
    }
    gotowe(form);
  });
  $('boxPodpisy').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-jak')) { pJak = !pJak; $('podpisyJak').innerHTML = jakHtml(); return; }
    if (b.hasAttribute('data-stare')) { pStare = !pStare; return renderP(); }
    if (b.hasAttribute('data-retry')) { pErr = ''; renderP(); return loadP(); }
    if (b.hasAttribute('data-toggle')) { var pid = b.closest('[data-pak]').getAttribute('data-pak'); pOpen[pid] = b.getAttribute('data-toggle') === '1'; return renderP(); }
    if (b.hasAttribute('data-fold')) { var k = b.getAttribute('data-fold'); pForm[k] = !pForm[k]; return renderP(); }
    var row = b.closest('[data-id]'); if (!row) return;
    var id = row.getAttribute('data-id'), d = dokById(id), form = b.closest('[data-form]');
    if (b.hasAttribute('data-pick')) return form.querySelector('[data-file]').click();
    if (b.hasAttribute('data-dl')) {
      b.disabled = true;
      try {
        var f = await callP({ action: 'plik', dokument: id, ktory: b.getAttribute('data-dl') });
        var a = document.createElement('a'); a.href = f.url; a.download = f.nazwa || ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
        note(row.querySelector('[data-note]'), '', '');
      } catch (err) { if (!err.gate) note(row.querySelector('[data-note]'), 'err', 'Nie udało się pobrać pliku: ' + err.message); }
      b.disabled = false;
      return;
    }
    if (b.hasAttribute('data-send') && d && form) {
      var strona = form.getAttribute('data-strona'), metoda = form.getAttribute('data-metoda'), key = form.getAttribute('data-form');
      var file = form.querySelector('[data-file]').files[0], ack = form.querySelector('[data-ack]'), warn = form.querySelector('.msg.warn'), up = form.querySelector('[data-up]');
      if (!file || (warn && !(ack && ack.checked))) return;
      var old = b.textContent; b.disabled = true; b.textContent = 'Sprawdzam plik…'; delete pMsg[id];
      try {
        var zle = await sprawdz(file, metoda);
        if (zle) { note(up, 'err', zle); b.textContent = old; b.disabled = false; return; }
        b.textContent = 'Wysyłam…';
        var out = await callP({ action: 'wgraj', dokument: id, strona: strona, metoda: metoda, potwierdzam: warn ? 'true' : null, ostrzezenie_wersja: warn ? warn.getAttribute('data-wersja') : null }, file);
        pForm[key] = false; delete pWybor[id];
        pMsg[id] = ['ok', out.wiazanie === 'wzrokowa' ? 'Plik został wysłany. Biuro porówna go z dokumentem i potwierdzi przyjęcie.' : 'Podpisany plik został wysłany i rozpoznany jako dokument wydany przez portal. Biuro sprawdzi ważność podpisu.'];
        return loadP();
      } catch (err) {
        if (err.gate) return;
        var kod = err.kod || '';
        // the warning changed or was not accepted: show the server's text again, the box empty
        if (kod === 'ostrzezenie' && err.out && err.out.ostrzezenie) { pOstrz[id + ':' + metoda] = err.out.ostrzezenie; pMsg[id] = ['err', blad(err)]; return renderP(); }
        // the document moved on (or is gone) while the page was open: show what is true now
        if (['metoda_niedozwolona', 'krok', 'zamkniety', 'kolejnosc'].indexOf(kod) !== -1 || err.status === 404) { if (kod === 'metoda_niedozwolona') delete pWybor[id]; pMsg[id] = ['err', blad(err)]; return loadP(); }
        // anything about the file itself: stay on the form, the chosen way and the tick are kept
        note(up, 'err', blad(err)); b.textContent = old; gotowe(form);
      }
    }
  });

  // ---------------- boot ----------------
  (async function () {
    applyStatic();
    // the office's preview (administrators): ?podglad=<NIP>, opened from the portal in the same browser
    var pm = location.search.match(/[?&]podglad=(\d{10})(?:&|$)/);
    if (pm) {
      try { staffJwt = (JSON.parse(localStorage.getItem('sb-dpfxwkxpzqqjtmgqwozw-auth-token') || '{}') || {}).access_token || ''; } catch (e) {}
      $('login').hidden = false;
      if (!staffJwt) return msg(T('Podgląd profilu klienta jest dostępny po zalogowaniu do portalu biura w tej przeglądarce.'), 'err');
      podglad = pm[1]; token = '';
      $('podgladBar').hidden = false; $('out').textContent = T('Zamknij podgląd');
      return start({ firmy: [{ nip: podglad, nazwa: 'NIP ' + podglad }] });
    }
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
    try { start(await call({ action: 'me' })); } catch (e) { if (!e.gate && $('login').hidden && $('setpass').hidden) { $('login').hidden = false; msg(e.message, 'err'); } }
  })();
})();
