/* Client profile. The employer signs in with a one-time link sent by e-mail and sees its own
   firm: workers with document deadlines, submissions in progress, packets to sign, onboarding.
   All data comes from the `klient` edge function (documents for electronic signing — from `podpisy`); the session token lives in localStorage. */
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
    if (out.ustaw_haslo && body.action !== 'verify') { clearP(); $('app').hidden = true; $('login').hidden = true; $('setpass').hidden = false; throw new Error(out.error); }
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
    return out;
  }
  function signOut(silent) {
    try { localStorage.removeItem(KEY); } catch (e) {}
    token = '';
    clearP();
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
    clearP();
    data = await call({ action: 'dane', nip: nip });
    render();
    // only now: `dane` has just passed the session and password checks
    renderP(); loadP();
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
  function plt(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
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
