/* Rozsyłki: broadcasts to the office's clients and the subscriptions of the Telegram bot.
   Everything goes through the `komunikacja` edge function: it alone knows the bot's token, the clients'
   contact data and chat ids, builds the message markup from the editor's segments, resolves who gets what
   through which channel, keeps the queue and the log. This page only asks and shows.
   The editor never sends markup: it sends segments { t, b, i, url } read from its own DOM; the preview is
   drawn from what the server returns, through esc().
   rozsylka.html?id=<uuid> opens that broadcast; ?klient=<id> opens Subskrypcje with that client chosen. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/komunikacja';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function kiedy(iso) {
    var d = new Date(iso); if (!iso || isNaN(d)) return '';
    var p = function (n) { return ('0' + n).slice(-2); };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function low(s) { return String(s == null ? '' : s).toLowerCase(); }
  function pill(tekst, klasa) { return '<span class="pill ' + klasa + '">' + esc(tekst) + '</span>'; }
  function opcje(el, lista, wartosc) { el.innerHTML = lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === wartosc ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function wybrane(el) { return Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; }); }
  function zaznacz(el, lista) { Array.prototype.forEach.call(el.options, function (o) { o.selected = (lista || []).indexOf(o.value) !== -1; }); }

  var JEZYKI = ['pl', 'ru', 'uk'], JN = { pl: 'polski', ru: 'rosyjski', uk: 'ukraiński', '': 'nie podano' };
  var STATUS = { szkic: ['szkic', 'p-grey'], do_akceptacji: ['czeka na akceptację', 'p-amber'], zaplanowana: ['zaplanowana', 'p-navy'], w_trakcie: ['w trakcie', 'p-ok'], zakonczona: ['zakończona', 'p-ok'], wstrzymana: ['wstrzymana', 'p-red'], anulowana: ['anulowana', 'p-grey'] };
  var WST = { kolejka: ['w kolejce', 'p-grey'], wysylanie: ['wysyłanie', 'p-navy'], wyslano: ['wysłano', 'p-ok'], blad: ['błąd', 'p-red'], pominieto: ['pominięto', 'p-amber'], niepewny: ['niepewne', 'p-red'] };
  var KANAL = { bot: 'bot', grupa: 'grupa', sms: 'SMS', mail: 'e-mail', brak: 'nieosiągalny' };
  var LINK_SUB = '{link_subskrypcji}';

  var st = null, klienci = [], szablony = [], segmenty = [], tab = 'lista', jez = 'pl';
  var R = null, testOk = false, brudny = false, plan = null, D = { id: null, strona: 0, dalej: false, dane: null }, timer = null;
  var startId = new URLSearchParams(location.search).get('id'), startKlient = new URLSearchParams(location.search).get('klient');

  async function token() { var s = await window.sb.auth.getSession(); return s && s.data && s.data.session ? s.data.session.access_token : ''; }
  async function api(action, body) {
    try {
      var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() }, body: JSON.stringify(Object.assign({ action: action }, body || {})) });
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok && !j.error) j.error = 'Błąd ' + res.status;
      return j;
    } catch (e) { return { error: 'Brak połączenia z serwerem.' }; }
  }
  function pusta() {
    return { id: null, status: 'szkic', tytul: '', typ: 'serwisowa', strategia: 'bot', kanaly: { bot: true, grupa: false, sms: false, mail: false }, odbiorcy: { tryb: 'wszyscy', filtry: {}, wybrani: [], wykluczeni: [] },
      tresc: { wspolna: false, fallback: ['pl', 'ru', 'uk'], tg: { pl: [], ru: [], uk: [] }, przyciski: [], sms: { pl: '', ru: '', uk: '' }, mail: { temat: { pl: '', ru: '', uk: '' }, tresc: { pl: '', ru: '', uk: '' } } } };
  }
  function kopia(x) { return JSON.parse(JSON.stringify(x)); }

  // ---------------- header ----------------
  function rysujKafelki() {
    if (!st) return;
    var t = [], sub = klienci.reduce(function (a, k) { return a + k.sub; }, 0), zSub = klienci.filter(function (k) { return k.sub > 0; }).length, obs = klienci.filter(function (k) { return k.obslugiwany; }).length;
    t.push([st.bot ? '@' + st.bot : 'brak', st.bot ? 'Bot subskrypcji' : 'Bot nie jest skonfigurowany', st.bot ? '' : 'amber']);
    if (st.brak && st.brak.length) t.push(['!', 'Brakuje: ' + st.brak.join(', '), 'red']);
    t.push([sub, 'Aktywni subskrybenci', sub ? 'green' : 'zero']);
    t.push([zSub + ' / ' + obs, 'Klienci z subskrypcją / obsługiwani', zSub ? '' : 'zero']);
    t.push([st.ustawienia.godziny.od + '–' + st.ustawienia.godziny.do, st.w_godzinach ? 'Godziny wysyłki' : 'Godziny wysyłki — teraz poza nimi', st.w_godzinach ? '' : 'amber']);
    t.push([st.ustawienia.prog_akceptacji, 'Akceptacja powyżej tylu odbiorców', '']);
    $('tiles').innerHTML = t.map(function (x) { return '<div class="tile ' + x[2] + '"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('');
  }
  function rysujTaby() {
    var l = [['lista', 'Rozsyłki'], ['edytor', R && R.id ? 'Edycja szkicu' : 'Nowa rozsyłka'], ['postep', 'Postęp i dziennik'], ['subskrypcje', 'Subskrypcje bota']];
    if (st && st.ja.admin) l.push(['bot', 'Bot i ustawienia']);
    $('tabs').innerHTML = l.map(function (x) { return '<button type="button" data-tab="' + x[0] + '"' + (tab === x[0] ? ' class="on"' : '') + '>' + esc(x[1]) + '</button>'; }).join('');
    l.forEach(function (x) { $('t-' + x[0]).hidden = tab !== x[0]; });
    if (!(st && st.ja.admin)) $('t-bot').hidden = true;
  }
  function idz(t) { tab = t; rysujTaby(); clearInterval(timer); if (t === 'lista') lista(); if (t === 'postep' && D.id) { postep(); timer = setInterval(function () { if (D.dane && ['w_trakcie', 'zaplanowana'].indexOf(D.dane.status) !== -1) postep(); }, 15000); } if (t === 'subskrypcje') subskrybenci(); window.scrollTo(0, 0); }

  // ---------------- list ----------------
  async function lista() {
    var tb = $('ltbl').tBodies[0], r = await api('lista');
    if (r.error) { tb.innerHTML = '<tr><td colspan="7" class="empty">' + esc(r.error) + '</td></tr>'; return; }
    if (!r.rozsylki.length) { tb.innerHTML = '<tr><td colspan="7" class="empty">Nie ma jeszcze żadnej rozsyłki.</td></tr>'; return; }
    tb.innerHTML = r.rozsylki.map(function (x) {
      var s = STATUS[x.status] || [x.status, 'p-grey'], w = x.statusy || {}, razem = Object.keys(w).reduce(function (a, k) { return a + w[k]; }, 0);
      var kan = Object.keys(x.kanaly || {}).filter(function (k) { return x.kanaly[k]; }).map(function (k) { return KANAL[k]; }).join(', ');
      return '<tr class="kl" data-rozsylka="' + esc(x.id) + '" data-status="' + esc(x.status) + '"><td>' + esc(kiedy(x.created_at)) + '</td><td><b>' + esc(x.tytul) + '</b>' + (x.powod ? '<small>' + esc(x.powod) + '</small>' : '') + '</td>' +
        '<td>' + pill(x.typ, x.typ === 'marketingowa' ? 'p-amber' : 'p-grey') + '</td><td>' + esc(kan) + '</td>' +
        '<td>' + pill(s[0], s[1]) + (x.zaplanowana_na && x.status === 'zaplanowana' ? '<small>na ' + esc(kiedy(x.zaplanowana_na)) + '</small>' : '') + '</td>' +
        '<td>' + (razem ? esc((w.wyslano || 0) + ' / ' + razem) + ((w.blad || 0) + (w.niepewny || 0) ? ' ' + pill('błędy: ' + ((w.blad || 0) + (w.niepewny || 0)), 'p-red') : '') : '—') + '</td>' +
        '<td>' + esc(x.autor) + (x.akceptowal ? '<small>akceptacja: ' + esc(x.akceptowal) + '</small>' : '') + '</td></tr>';
    }).join('');
  }
  async function otworz(id, status) {
    if (status === 'szkic') {
      var r = await api('pobierz', { id: id });
      if (r.error) { alert(r.error); return; }
      R = r.rozsylka; R.odbiorcy = Object.assign({ tryb: 'wszyscy', filtry: {}, wybrani: [], wykluczeni: [] }, R.odbiorcy || {}); testOk = !!r.aktualny_test; brudny = false; plan = null;
      doFormularza(); idz('edytor');
    } else { D = { id: id, strona: 0, dalej: false, dane: null }; idz('postep'); }
  }

  // ---------------- editor: DOM <-> segments ----------------
  function zEdytora() {
    var out = [];
    var dodaj = function (t, f) {
      if (!t) return;
      var o = out[out.length - 1];
      if (o && !!o.b === !!f.b && !!o.i === !!f.i && (o.url || '') === (f.url || '')) o.t += t; else { var s = { t: t }; if (f.b) s.b = true; if (f.i) s.i = true; if (f.url) s.url = f.url; out.push(s); }
    };
    var nl = function () { var o = out[out.length - 1]; if (o && !/\n$/.test(o.t)) dodaj('\n', {}); };
    (function idzPo(node, f) {
      Array.prototype.forEach.call(node.childNodes, function (n) {
        if (n.nodeType === 3) { dodaj(n.nodeValue.replace(/ /g, ' '), f); return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName, g = { b: f.b, i: f.i, url: f.url };
        if (tag === 'BR') { dodaj('\n', {}); return; }
        if (tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(n.style.fontWeight)) g.b = true;
        if (tag === 'I' || tag === 'EM' || n.style.fontStyle === 'italic') g.i = true;
        if (tag === 'A' && n.getAttribute('href')) g.url = n.getAttribute('href');
        var blok = tag === 'DIV' || tag === 'P' || tag === 'LI';
        if (blok) nl();
        idzPo(n, g);
      });
    })($('ed'), {});
    if (out.length) out[out.length - 1].t = out[out.length - 1].t.replace(/\n+$/, '');
    return out.filter(function (s) { return s.t; });
  }
  function doEdytora(seg) {
    var ed = $('ed'); ed.textContent = '';
    (seg || []).forEach(function (s) {
      var n = document.createTextNode(s.t), el = n;
      if (s.b) { var b = document.createElement('b'); b.appendChild(el); el = b; }
      if (s.i) { var i = document.createElement('i'); i.appendChild(el); el = i; }
      if (s.url) { var a = document.createElement('a'); a.setAttribute('href', s.url); a.appendChild(el); el = a; }
      ed.appendChild(el);
    });
  }
  function tekstSeg(seg) { return (seg || []).map(function (s) { return s.t; }).join(''); }
  var slot = function () { return R.tresc.wspolna ? 'pl' : jez; };

  // ---------------- form <-> R ----------------
  function zFormularza() {
    var j = slot();
    R.tytul = $('eTytul').value.trim(); R.typ = $('eTyp').value; R.strategia = $('eStrategia').value;
    R.tresc.wspolna = $('eWspolna').checked;
    R.tresc.fallback = $('eFallback').value.split(',');
    R.tresc.tg[j] = zEdytora(); R.tresc.sms[j] = $('eSms').value; R.tresc.mail.temat[j] = $('eTemat').value; R.tresc.mail.tresc[j] = $('eMail').value;
    Array.prototype.forEach.call(document.querySelectorAll('[data-prz]'), function (el) {
      var p = R.tresc.przyciski[Number(el.getAttribute('data-prz'))]; if (!p) return;
      if (el.getAttribute('data-co') === 'etykieta') p.etykieta[j] = el.value; else p.url = el.value.trim();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-kanal]'), function (el) { R.kanaly[el.getAttribute('data-kanal')] = el.checked; });
    var tr = document.querySelector('input[name=tryb]:checked'); R.odbiorcy.tryb = tr ? tr.value : 'wszyscy';
    R.odbiorcy.filtry = { status: wybrane($('fStatus')), jezyk: wybrane($('fJezyk')).map(function (x) { return x === '-' ? '' : x; }), forma: wybrane($('fForma')), opodatkowanie: wybrane($('fOpod')), opiekun: wybrane($('fOpiekun')), kadrowy: wybrane($('fKadrowy')), miasto: wybrane($('fMiasto')),
      zakres: $('fZakres').value, sub: $('fSub').value, grupa: $('fGrupa').value, telefon: $('fTelefon').value, email: $('fEmail').value };
    return { tytul: R.tytul, typ: R.typ, strategia: R.strategia, kanaly: R.kanaly, odbiorcy: R.odbiorcy, tresc: R.tresc };
  }
  function kanalyTeraz() {
    var s = $('eStrategia').value, k = R.kanaly;
    return s === 'bot' ? { bot: true } : s === 'bot_sms' ? { bot: true, sms: true } : s === 'bot_mail' ? { bot: true, mail: true } : s === 'bot_grupa' ? { bot: true, grupa: true } : k;
  }
  function doFormularza() {
    var j = slot(), f = R.odbiorcy.filtry || {};
    $('eTytul').value = R.tytul || ''; $('eTyp').value = R.typ; $('eStrategia').value = R.strategia; $('eWspolna').checked = !!R.tresc.wspolna; $('eFallback').value = (R.tresc.fallback || ['pl', 'ru', 'uk']).join(',');
    doEdytora(R.tresc.tg[j]); $('eSms').value = R.tresc.sms[j] || ''; $('eTemat').value = R.tresc.mail.temat[j] || ''; $('eMail').value = R.tresc.mail.tresc[j] || '';
    Array.prototype.forEach.call(document.querySelectorAll('[data-kanal]'), function (el) { el.checked = !!R.kanaly[el.getAttribute('data-kanal')]; });
    Array.prototype.forEach.call(document.querySelectorAll('input[name=tryb]'), function (el) { el.checked = el.value === R.odbiorcy.tryb; });
    zaznacz($('fStatus'), f.status); zaznacz($('fJezyk'), (f.jezyk || []).map(function (x) { return x || '-'; })); zaznacz($('fForma'), f.forma); zaznacz($('fOpod'), f.opodatkowanie); zaznacz($('fOpiekun'), f.opiekun); zaznacz($('fKadrowy'), f.kadrowy); zaznacz($('fMiasto'), f.miasto);
    $('fZakres').value = f.zakres || ''; $('fSub').value = f.sub || ''; $('fGrupa').value = f.grupa || ''; $('fTelefon').value = f.telefon || ''; $('fEmail').value = f.email || '';
    $('ePotw').hidden = true; $('oBox').hidden = true; $('eMsg').innerHTML = '';
    rysujJezyki(); rysujPrzyciski(); rysujKanaly(); rysujKlientow(); stan(); podgladPozniej(); rysujTaby();
  }
  function rysujJezyki() {
    $('eJezyki').innerHTML = JEZYKI.map(function (x) {
      var ma = tekstSeg(R.tresc.tg[x]).trim();
      return '<button type="button" data-jez="' + x + '"' + (slot() === x ? ' class="on"' : '') + (R.tresc.wspolna && x !== 'pl' ? ' disabled' : '') + '>' + esc(JN[x]) + (ma ? '' : ' — pusta') + '</button>';
    }).join('');
  }
  function rysujPrzyciski() {
    var j = slot();
    $('ePrzyciski').innerHTML = R.tresc.przyciski.map(function (p, i) {
      var sub = p.url === LINK_SUB;
      return '<div class="two row"><div><label>Napis (' + esc(JN[j]) + ')</label><input type="text" maxlength="40" data-prz="' + i + '" data-co="etykieta" value="' + esc(p.etykieta[j] || '') + '" /></div>' +
        '<div><label>Adres (https://…)</label>' + (sub ? '<div class="acts" style="min-height:40px">' + pill('indywidualny link subskrypcji klienta', 'p-navy') : '<div class="acts"><input type="url" style="flex:1;min-width:140px" data-prz="' + i + '" data-co="url" value="' + esc(p.url || '') + '" placeholder="https://…" />') +
        '<button type="button" class="mini" data-prz-usun="' + i + '">Usuń</button></div></div></div>';
    }).join('') || '<p class="hint" style="margin:0">Bez przycisków.</p>';
  }
  function rysujKanaly() {
    var k = kanalyTeraz(), wsz = $('eStrategia').value === 'wszystkie', mkt = $('eTyp').value === 'marketingowa';
    $('eKanaly').hidden = !wsz; $('eGrupaInfo').hidden = !k.grupa; $('eSmsBox').hidden = !k.sms; $('eMailBox').hidden = !k.mail; $('pSmsBox').hidden = !k.sms; $('pMailBox').hidden = !k.mail;
    $('eTestTel').hidden = !(k.sms && st && st.ja.admin); $('eCiszaBox').hidden = !(st && st.ja.admin);
    $('eTypInfo').textContent = mkt ? 'Rozsyłka marketingowa trafi tylko do odbiorców z zapisaną zgodą (zakładka Subskrypcje), nigdy do grup, i zawsze wymaga akceptacji administratora.' : '';
    var u = [];
    if (k.grupa && st && !st.ja.admin) u.push('Kanał grupowy może włączyć tylko administrator.');
    if (k.grupa && mkt) u.push('Rozsyłka marketingowa nie może iść do grup.');
    if (k.sms && st) u.push(st.sms.skonfigurowane ? (st.sms.tryb === 'test' ? 'Moduł SMS jest w trybie testowym — SMS-y nie zostaną doręczone.' : 'SMS-y są płatne; obowiązują limity dzienne modułu SMS.') : 'SMS nie jest skonfigurowany.');
    if (k.mail && st && !st.konfiguracja.poczta) u.push('Poczta nie jest skonfigurowana.');
    if (k.mail && st && st.konfiguracja.poczta) u.push('E-maile wychodzą ze skrzynki ' + st.konfiguracja.poczta_od + '.');
    $('eKanalInfo').textContent = u.join(' ');
    $('eFiltry').hidden = R.odbiorcy.tryb !== 'filtry';
  }
  function stan() {
    $('eTest').disabled = !R; $('eDalej').disabled = !(R && R.id && testOk && !brudny);
    $('eDalejInfo').textContent = !R.id ? 'Najpierw zapisz szkic i wyślij test do siebie.' : brudny ? 'Są niezapisane zmiany — zapisz i powtórz test.' : !testOk ? 'Wymagany jest test dla obecnej treści.' : 'Test wykonany dla obecnej treści.';
  }
  function zmiana() { brudny = true; testOk = false; plan = null; $('ePotw').hidden = true; stan(); podgladPozniej(); }

  // ---------------- recipients picker ----------------
  function rysujKlientow() {
    var q = low($('eKlQ').value).trim(), qd = q.replace(/\D/g, ''), o = R.odbiorcy, recz = o.tryb === 'recznie';
    var l = klienci.filter(function (k) { return q ? low(k.nazwa).indexOf(q) !== -1 || (qd && k.nip.indexOf(qd) !== -1) : (o.wybrani.indexOf(k.id) !== -1 || o.wykluczeni.indexOf(k.id) !== -1); }).slice(0, 80);
    $('eKlLista').innerHTML = l.map(function (k) {
      var w = o.wybrani.indexOf(k.id) !== -1, x = o.wykluczeni.indexOf(k.id) !== -1;
      return '<div class="acts" style="padding:4px 0"><button type="button" class="mini' + (w ? ' on' : '') + '" data-dodaj="' + esc(k.id) + '">' + (w ? '✓ dodany' : '+ dodaj') + '</button>' +
        (recz ? '' : '<button type="button" class="mini' + (x ? ' on' : '') + '" data-wyklucz="' + esc(k.id) + '">' + (x ? '✓ wykluczony' : '− wyklucz') + '</button>') +
        '<span>' + esc(k.nazwa) + ' <span class="sub">' + esc(k.nip || 'bez NIP') + ' · ' + esc(JN[k.jezyk]) + '</span></span>' +
        (k.sub ? pill('bot: ' + k.sub, 'p-ok') : '') + (k.grupa ? pill('grupa', 'p-grey') : '') + (k.telefon ? pill('tel.', 'p-grey') : '') + (k.email ? pill('e-mail', 'p-grey') : '') + (k.obslugiwany ? '' : pill('obsługa zakończona', 'p-amber')) + '</div>';
    }).join('') || '<span class="sub">' + (q ? 'Brak pasujących klientów.' : recz ? 'Wyszukaj klienta, aby go dodać.' : 'Wyszukaj klienta, aby dodać go ręcznie albo wykluczyć.') + '</span>';
    $('eWybor').innerHTML = pill('dodani ręcznie: ' + o.wybrani.length, o.wybrani.length ? 'p-navy' : 'p-grey') + (recz ? '' : pill('wykluczeni: ' + o.wykluczeni.length, o.wykluczeni.length ? 'p-amber' : 'p-grey'));
  }
  function przelacz(lista, id) { var i = lista.indexOf(id); if (i === -1) lista.push(id); else lista.splice(i, 1); }
  async function pokazOdbiorcow() {
    var r = await api('odbiorcy', { rozsylka: zFormularza() });
    if (r.error) { $('eMsg').innerHTML = pill('błąd', 'p-red') + ' ' + esc(r.error); return null; }
    plan = r; $('oBox').hidden = false;
    rysujOdbiorcow();
    return r;
  }
  function liczbyHtml(l) {
    return ['bot', 'grupa', 'sms', 'mail'].filter(function (k) { return l[k]; }).map(function (k) { return pill(KANAL[k] + ': ' + l[k], k === 'grupa' ? 'p-amber' : 'p-ok'); }).join('') +
      pill('klienci: ' + l.klienci, 'p-navy') + (l.brak ? pill('nie dotrze do: ' + l.brak, 'p-red') : '');
  }
  function rysujOdbiorcow() {
    if (!plan) return;
    $('oLiczby').innerHTML = liczbyHtml(plan.liczby);
    $('oInfo').textContent = (plan.akceptacja.length ? 'Wymaga akceptacji administratora: ' + plan.akceptacja.join('; ') + '. ' : 'Nie wymaga akceptacji. ') +
      (plan.liczby.sms ? 'Szacunek SMS: ' + plan.sms_czesci + ' części. ' : '') + 'Wysyłka potrwa około ' + plan.minut + ' min.';
    var tylko = $('oTylkoBrak').checked, w = plan.wiersze.filter(function (x) { return !tylko || !x.kanaly.length; });
    $('otbl').tBodies[0].innerHTML = w.map(function (x) {
      return '<tr><td>' + esc(x.nazwa) + '<small>' + esc(x.nip || 'bez NIP') + '</small></td><td>' + (x.kanaly.length ? x.kanaly.map(function (k) { return pill(KANAL[k.kanal] + ' · ' + (k.jezyk || ''), k.kanal === 'grupa' ? 'p-amber' : 'p-ok'); }).join('') : pill('nie dotrze', 'p-red')) + '</td>' +
        '<td>' + esc(x.powod || '') + (x.kanaly.length ? '<small>' + esc(x.kanaly.map(function (k) { return k.adres; }).join(', ')) + '</small>' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="3" class="empty">' + (tylko ? 'Rozsyłka dotrze do wszystkich wybranych klientów.' : 'Nikt nie został wybrany.') + '</td></tr>';
  }

  // ---------------- preview ----------------
  var czeka = null, nr = 0;
  function podgladPozniej() { clearTimeout(czeka); czeka = setTimeout(podglad, 450); }
  async function podglad() {
    if (!R || tab !== 'edytor') return;
    var moj = ++nr, r = await api('podglad', { rozsylka: zFormularza(), klient: $('pKlient').value || undefined });
    if (moj !== nr) return;
    rysujJezyki();
    if (r.error) { $('pInfo').innerHTML = pill(r.error, 'p-red'); return; }
    var p = r.jezyki[jez], t = p.tg;
    $('pInfo').innerHTML = pill('wersja: ' + JN[slot()], 'p-navy') + pill(t.znaki + ' / 3796 znaków', t.znaki > 3796 ? 'p-red' : 'p-grey') + (r.klient ? pill('język klienta: ' + JN[r.klient.jezyk], 'p-grey') : '');
    $('pTg').innerHTML = t.segmenty.map(function (s) { var h = esc(s.t); if (s.b) h = '<b>' + h + '</b>'; if (s.i) h = '<i>' + h + '</i>'; if (s.link) h = '<u>' + h + '</u>'; return h; }).join('') || '— brak treści w tej wersji —';
    $('pPrzyciski').innerHTML = t.przyciski.map(function (b) { return '<span class="mini" title="' + esc(b.url) + '">' + esc(b.text) + ' ↗</span>'; }).join('');
    $('pSms').textContent = p.sms ? p.sms.tresc : '— brak treści SMS —';
    $('pSmsInfo').innerHTML = p.sms ? pill(p.sms.znaki + ' znaków', 'p-grey') + pill(p.sms.czesci + (p.sms.czesci === 1 ? ' SMS' : ' części SMS'), p.sms.czesci > 3 ? 'p-red' : p.sms.czesci > 1 ? 'p-amber' : 'p-ok') + pill(p.sms.kodowanie, p.sms.kodowanie === 'GSM-7' ? 'p-grey' : 'p-amber') : '';
    $('pMail').textContent = p.mail ? 'Temat: ' + p.mail.temat + '\n\n' + p.mail.tresc : '— brak tematu lub treści —';
    $('eLicznik').innerHTML = pill(t.znaki + ' znaków', t.znaki > 3796 ? 'p-red' : 'p-grey');
    $('eSmsLicznik').innerHTML = $('pSmsInfo').innerHTML;
  }

  // ---------------- save / test / submit ----------------
  async function zapisz() {
    var r = await api('zapisz', { id: R.id || undefined, rozsylka: zFormularza() });
    if (r.error) { $('eMsg').innerHTML = pill('nie zapisano', 'p-red') + ' ' + esc(r.error); return false; }
    R.id = r.id; brudny = false; testOk = !!r.aktualny_test;
    $('eMsg').innerHTML = pill('zapisano szkic', 'p-ok');
    stan(); rysujTaby();
    return true;
  }
  async function test() {
    if ((brudny || !R.id) && !(await zapisz())) return;
    $('eMsg').innerHTML = '<span class="sub">Wysyłam test…</span>';
    var r = await api('test', { id: R.id, klient: $('pKlient').value || undefined, telefon: $('eTel').value.trim() || undefined });
    if (r.error) { $('eMsg').innerHTML = pill('test nieudany', 'p-red') + ' ' + esc(r.error); return; }
    var w = r.wyniki, h = [];
    if (w.telegram) h.push('<div>' + pill('Telegram', w.telegram === 'ok' ? 'p-ok' : 'p-red') + ' ' + esc(w.telegram === 'ok' ? 'wysłano do Twojego czatu z botem (wersje: ' + w.telegram_wersje.join(', ') + ')' : w.telegram) + '</div>');
    if (w.sms) h.push('<div>' + pill('SMS', w.sms === 'ok' ? 'p-ok' : 'p-red') + ' ' + esc(w.sms === 'ok' ? 'na numer ' + w.sms_numer + (w.sms_test ? ' — tryb testowy, nic nie doręczono' : '') : w.sms) + '</div>');
    if (w.mail) h.push('<div>' + pill('E-mail', w.mail === 'ok' ? 'p-ok' : 'p-red') + ' ' + esc(w.mail === 'ok' ? 'na ' + w.mail_adres : w.mail) + '</div>');
    $('eMsg').innerHTML = h.join('') + (r.ok ? '<div class="sub">Sprawdź wiadomość u siebie. Po każdej zmianie treści test trzeba powtórzyć.</div>' : '<div class="sub warn">Żaden kanał testu się nie powiódł — nie można przejść dalej.</div>');
    testOk = !!r.ok; stan();
  }
  async function dalej() {
    var p = await pokazOdbiorcow();
    if (!p) return;
    var k = $('eKiedy').value, l = p.liczby, pierwsze = JEZYKI.filter(function (j) { return !R.tresc.wspolna || j === 'pl'; }).map(function (j) { var t = tekstSeg(R.tresc.tg[j]).trim(); return t ? '<div><b>' + esc(JN[j]) + ':</b> ' + esc(t.split('\n').filter(function (x) { return x.trim(); }).slice(0, 3).join(' / ').slice(0, 240)) + (t.length > 240 ? '…' : '') + '</div>' : ''; }).join('');
    $('ePotwTresc').innerHTML = '<p><b>' + esc(R.tytul) + '</b> ' + pill(R.typ, R.typ === 'marketingowa' ? 'p-amber' : 'p-grey') + '</p>' +
      '<div class="licznik">' + liczbyHtml(l) + '</div>' +
      (l.grupa ? '<p class="hint warn row"><b>' + l.grupa + ' wiadomości pójdzie do GRUP — powiadomi wszystkich uczestników każdej grupy.</b></p>' : '') +
      '<div class="row">' + (pierwsze || '<span class="sub">Brak treści Telegram.</span>') + '</div>' +
      '<p class="hint row">' + esc(k ? 'Termin: ' + kiedy(new Date(k).toISOString()) + '. ' : 'Start: od razu. ') + esc(p.akceptacja.length ? 'Po potwierdzeniu rozsyłka czeka na akceptację administratora (' + p.akceptacja.join('; ') + ').' : 'Po potwierdzeniu rozsyłka zostanie wysłana bez dodatkowej akceptacji.') + '</p>';
    $('ePotwTytulBox').hidden = !p.tytul_wymagany; $('ePotwTytul').value = ''; $('ePotwMsg').innerHTML = ''; $('ePotw').hidden = false;
    $('ePotw').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function potwierdz() {
    if (!plan) return;
    $('ePotwTak').disabled = true;
    var k = $('eKiedy').value;
    var r = await api('zglos', { id: R.id, potwierdzenie: { liczby: plan.liczby, tytul: $('ePotwTytul').value }, zaplanowana_na: k ? new Date(k).toISOString() : undefined, mimo_ciszy: $('eCisza').checked || undefined });
    $('ePotwTak').disabled = false;
    if (r.error) { $('ePotwMsg').innerHTML = pill('nie zgłoszono', 'p-red') + ' ' + esc(r.error); if (r.liczby) { plan.liczby = r.liczby; rysujOdbiorcow(); } return; }
    D = { id: R.id, strona: 0, dalej: false, dane: null }; R = pusta(); brudny = false; testOk = false;
    doFormularza(); idz('postep');
  }

  // ---------------- progress and log ----------------
  async function postep() {
    if (!D.id) return;
    var r = await api('pobierz', { id: D.id }), d = await api('dziennik', { id: D.id, strona: D.strona, status: $('dStatus').value || undefined, kanal: $('dKanal').value || undefined });
    if (r.error || d.error) { $('dMsg').innerHTML = pill(r.error || d.error, 'p-red'); return; }
    var x = r.rozsylka, s = STATUS[x.status] || [x.status, 'p-grey'], w = d.statusy || {}, l = d.liczby, razem = l.bot + l.grupa + l.sms + l.mail, moje = st.ja.admin || x.autor === st.ja.email;
    D.dane = x; D.dalej = !!d.dalej; D.liczby = l;
    $('dTytul').textContent = x.tytul;
    $('dOpis').innerHTML = pill(s[0], s[1]) + ' ' + pill(x.typ, x.typ === 'marketingowa' ? 'p-amber' : 'p-grey') + ' <span>autor: ' + esc(x.autor) + (x.akceptowal ? ' · akceptacja: ' + esc(x.akceptowal) + (x.samoakceptacja ? ' (autor — brak innego administratora)' : '') : '') +
      (x.zaplanowana_na ? ' · termin: ' + esc(kiedy(x.zaplanowana_na)) : '') + (x.start_at ? ' · start: ' + esc(kiedy(x.start_at)) : '') + (x.koniec_at ? ' · koniec: ' + esc(kiedy(x.koniec_at)) : '') + '</span>' +
      (x.powod ? '<div class="warn">' + esc(x.powod) + '</div>' : '') + (d.wstrzymana_do && new Date(d.wstrzymana_do) > new Date() ? '<div class="warn">Telegram poprosił o przerwę do ' + esc(kiedy(d.wstrzymana_do)) + '.</div>' : '');
    $('dPasek').style.width = (razem ? Math.round(100 * ((w.wyslano || 0) + (w.blad || 0) + (w.niepewny || 0)) / razem) : 0) + '%';
    $('dLiczby').innerHTML = liczbyHtml(l) + Object.keys(WST).filter(function (k) { return w[k]; }).map(function (k) { return pill(WST[k][0] + ': ' + w[k], WST[k][1]); }).join('');
    var a = [], btn = function (akcja, tekst, kl) { a.push('<button type="button" class="mini ' + (kl || '') + '" data-akcja="' + akcja + '">' + tekst + '</button>'); };
    if (moje && ['do_akceptacji', 'zaplanowana'].indexOf(x.status) !== -1) btn('cofnij', 'Cofnij do szkicu');
    if (moje && ['w_trakcie', 'zaplanowana'].indexOf(x.status) !== -1) btn('wstrzymaj', 'Wstrzymaj');
    if (moje && x.status === 'wstrzymana') btn('wznow', 'Wznów', 'ok');
    if (moje && ['zakonczona', 'anulowana', 'szkic'].indexOf(x.status) === -1) btn('anuluj', 'Anuluj', 'red');
    if (st.ja.admin && w.niepewny) btn('ponow_niepewne', 'Ponów niepewne (' + w.niepewny + ')');
    if (st.ja.admin && ['w_trakcie', 'zaplanowana'].indexOf(x.status) !== -1) btn('kolejka', 'Uruchom przebieg teraz');
    $('dAkcje').innerHTML = a.join('');
    var akc = x.status === 'do_akceptacji' && st.ja.admin;
    $('dAkceptBox').hidden = !akc;
    if (akc) {
      var teksty = JEZYKI.map(function (j) { var t = tekstSeg(x.tresc.tg[j]).trim(); return t ? '<h3>' + esc(JN[j]) + '</h3><pre class="msg">' + esc(t.slice(0, 700)) + (t.length > 700 ? '…' : '') + '</pre>' : ''; }).join('');
      $('dAkceptTresc').innerHTML = '<p class="hint warn"><b>Do akceptacji.</b> Zgłosił(a): ' + esc(x.autor) + ', ' + esc(kiedy(x.zgloszono_at)) + '. ' + (x.test ? 'Test: ' + esc(kiedy(x.test.at)) + '. ' : '') + (l.grupa ? '<b>' + l.grupa + ' wiadomości pójdzie do GRUP klientów.</b>' : '') + '</p>' + teksty;
      $('dAkceptTytul').parentNode.hidden = razem <= st.prog_tytul;
    }
    $('dPrev').disabled = D.strona === 0; $('dNext').disabled = !D.dalej;
    $('dtbl').tBodies[0].innerHTML = d.wiersze.map(function (o) {
      var ws = WST[o.status] || [o.status, 'p-grey'];
      return '<tr><td>' + esc(o.nazwa) + '<small>' + esc(o.nip || '') + '</small></td><td>' + esc(KANAL[o.kanal] || o.kanal) + '<small>' + esc(o.adres || '') + (o.jezyk ? ' · ' + esc(o.jezyk) : '') + '</small></td>' +
        '<td>' + pill(ws[0], ws[1]) + (o.proby > 1 ? '<small>próby: ' + esc(o.proby) + '</small>' : '') + '</td><td>' + esc(o.powod || '') + (o.status === 'kolejka' && new Date(o.nastepna_proba) > new Date() ? '<small>następna próba: ' + esc(kiedy(o.nastepna_proba)) + '</small>' : '') + '</td>' +
        '<td>' + esc(kiedy(o.wyslano_at)) + (o.tg_message_id ? '<small>id ' + esc(o.tg_message_id) + '</small>' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="empty">Brak wierszy.</td></tr>';
  }
  async function akcja(a) {
    if (a === 'anuluj' && !confirm('Anulować rozsyłkę? Wiadomości, które jeszcze nie wyszły, nie zostaną wysłane.')) return;
    if (a === 'ponow_niepewne' && !confirm('Te wiadomości mogły już dotrzeć do odbiorców. Wysłać je ponownie?')) return;
    var r = await api(a, { id: D.id });
    $('dMsg').innerHTML = r.error ? pill('błąd', 'p-red') + ' ' + esc(r.error) : a === 'kolejka' ? pill('przebieg wykonany', 'p-ok') + ' wysłano: ' + esc(r.wyslano) + ', błędy: ' + esc(r.bledy) + ', później: ' + esc(r.pozniej) + (r.cisza ? ' · poza godzinami wysyłki' : '') : pill('zrobione', 'p-ok');
    if (!r.error && a === 'cofnij') { otworz(D.id, 'szkic'); return; }
    postep();
  }
  async function decyzja(tak) {
    var r = tak ? await api('akceptuj', { id: D.id, potwierdzenie: { liczby: D.liczby, tytul: $('dAkceptTytul').value } }) : await api('odrzuc', { id: D.id, powod: $('dPowod').value });
    $('dMsg').innerHTML = r.error ? pill('błąd', 'p-red') + ' ' + esc(r.error) : pill(tak ? 'zaakceptowano' : 'odrzucono — wróciła do szkicu', 'p-ok');
    postep();
  }
  async function pobierzCsv() {
    var r = await api('csv', { id: D.id });
    if (r.error) { $('dMsg').innerHTML = pill(r.error, 'p-red'); return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' })); a.download = r.nazwa; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // ---------------- subscriptions ----------------
  function rysujSubKlientow(zachowaj) {
    var q = low($('sQ').value).trim(), qd = q.replace(/\D/g, '');
    var l = klienci.filter(function (k) { return !q || low(k.nazwa).indexOf(q) !== -1 || (qd && k.nip.indexOf(qd) !== -1); });
    var obecny = zachowaj || $('sKl').value; if (q && l.length === 1) obecny = l[0].id;
    opcje($('sKl'), [['', l.length ? '— wybierz klienta (' + l.length + ') —' : '— brak pasujących —']].concat(l.map(function (k) { return [k.id, k.nazwa + (k.sub ? ' · subskrybenci: ' + k.sub : '')]; })), obecny);
    subKlient();
  }
  function subKlient() {
    var k = klienci.filter(function (x) { return x.id === $('sKl').value; })[0];
    $('sLink').disabled = $('sRotuj').disabled = !k; $('sWynik').innerHTML = '';
    if (!k) { $('sKlient').innerHTML = '<p class="hint">Wybierz klienta.</p>'; subskrybenci(); return; }
    var zg = function (kanal, ma, jest) {
      return '<div class="acts row">' + pill(kanal === 'sms' ? 'SMS' : 'e-mail', 'p-grey') + (jest ? '' : pill('brak ' + (kanal === 'sms' ? 'numeru' : 'adresu') + ' w bazie', 'p-amber')) + pill(ma ? 'zgoda marketingowa zapisana' : 'brak zgody marketingowej', ma ? 'p-ok' : 'p-grey') +
        '<button type="button" class="mini" data-zgoda="' + kanal + '" data-na="' + (ma ? '0' : '1') + '">' + (ma ? 'Zapisz wycofanie' : 'Zapisz zgodę') + '</button></div>';
    };
    $('sKlient').innerHTML = '<p><b>' + esc(k.nazwa) + '</b> <span class="sub">' + esc(k.nip || 'bez NIP') + ' · język: ' + esc(JN[k.jezyk]) + '</span></p>' +
      '<div class="licznik">' + pill('subskrybenci: ' + k.sub, k.sub ? 'p-ok' : 'p-grey') + (k.sub_wyl ? pill('wyłączeni / zablokowani: ' + k.sub_wyl, 'p-amber') : '') + pill(k.grupa ? 'ma grupę Telegram' : 'bez grupy', 'p-grey') + '</div>' +
      zg('sms', k.zgoda_sms, k.telefon) + zg('email', k.zgoda_email, k.email) +
      '<div class="acts row">' + pill(k.grupa_dozwolona ? 'powiadomienia automatyczne: nadal także do grupy' : 'powiadomienia automatyczne: tylko do subskrybentów', k.grupa_dozwolona ? 'p-amber' : 'p-ok') +
      (st.ja.admin ? '<button type="button" class="mini" data-flaga="' + (k.grupa_dozwolona ? '0' : '1') + '">' + (k.grupa_dozwolona ? 'Wyłącz grupę' : 'Zezwól na grupę') + '</button>' : '') + '</div>' +
      '<p class="law">Zgoda na informacje handlowe musi być uprzednia i udokumentowana (art. 398 ust. 1 i art. 400 Prawa komunikacji elektronicznej). Zapisz, skąd pochodzi (np. „umowa § 9”, „e-mail z 2026-10-01”) i z jakiego dnia. Wiadomości o obsłudze — terminy, dokumenty — zgody nie wymagają.</p>';
    subskrybenci();
  }
  function zrodloZgody(zgoda) {
    var z = prompt(zgoda ? 'Skąd pochodzi zgoda? (np. „umowa § 9”, „e-mail klienta z 2026-10-01”)' : 'Jak klient wycofał zgodę? (np. „wiadomość z 2026-10-09”)');
    if (!z || z.trim().length < 3) return null;
    var d = prompt('Data (RRRR-MM-DD)', new Date().toISOString().slice(0, 10));
    return d ? { zrodlo: z.trim(), data: d.trim() } : null;
  }
  async function pokazLink(o) {
    var r = await api(o.moj ? 'zaproszenie_moje' : 'zaproszenie', { klient: o.moj ? undefined : $('sKl').value, rotuj: o.rotuj || undefined });
    if (r.error) { $('sWynik').innerHTML = pill('błąd', 'p-red') + ' ' + esc(r.error); return; }
    var qr = window.QrSvg ? window.QrSvg.svg(r.link, { size: 200 }) : '';
    var kopiuj = function (id, tekst) { return '<button type="button" class="mini" data-kopiuj="' + id + '">' + tekst + '</button>'; };
    $('sWynik').innerHTML = (o.moj ? '<p>' + (r.polaczone ? pill('Twoje konto Telegram jest połączone', 'p-ok') : pill('Twoje konto nie jest jeszcze połączone', 'p-amber')) + ' <span class="sub">Otwórz link na swoim telefonie i naciśnij START — tu będą przychodzić testy rozsyłek.</span></p>' : '') +
      '<div class="acts"><span class="qr">' + qr + '</span><div style="flex:1;min-width:220px"><label>Link</label><pre class="msg" id="kLink" style="margin:0">' + esc(r.link) + '</pre>' +
      '<div class="acts row">' + kopiuj('kLink', 'Kopiuj link') + '<span class="sub">ważny do ' + esc(kiedy(r.wazne_do)) + ' · użyto ' + esc(r.uzycia) + (r.max_uzyc ? ' z ' + esc(r.max_uzyc) : '') + ' razy' + (r.nowe ? ' · nowy link' : '') + '</span></div></div></div>' +
      (r.instrukcja ? JEZYKI.map(function (j) { return '<h3>Instrukcja — ' + esc(JN[j]) + (r.jezyk === j ? ' (język klienta)' : '') + '</h3><pre class="msg" id="kIn' + j + '">' + esc(r.instrukcja[j]) + '</pre><div class="acts row">' + kopiuj('kIn' + j, 'Kopiuj tekst') + '</div>'; }).join('') : '');
  }
  async function subskrybenci() {
    var wsz = $('sWszyscy').checked, kl = $('sKl').value, tb = $('stbl').tBodies[0];
    if (!wsz && !kl) { tb.innerHTML = '<tr><td colspan="7" class="empty">Wybierz klienta albo zaznacz „wszyscy klienci”.</td></tr>'; return; }
    var r = await api('subskrybenci', { klient: wsz ? undefined : kl });
    if (r.error) { tb.innerHTML = '<tr><td colspan="7" class="empty">' + esc(r.error) + '</td></tr>'; return; }
    var nazwy = {}; klienci.forEach(function (k) { nazwy[k.id] = k.nazwa; });
    tb.innerHTML = r.subskrybenci.map(function (s) {
      var stanS = s.blocked_at ? pill('bot zablokowany', 'p-red') : s.aktywna ? pill('aktywna', 'p-ok') : pill('wyłączona' + (s.wylaczyl === 'uzytkownik' ? ' (/stop)' : ''), 'p-grey');
      return '<tr><td>' + esc(nazwy[s.klient] || s.klient) + '</td><td>' + esc([s.imie, s.nazwisko].filter(Boolean).join(' ') || '—') + '<small>' + (s.username ? '@' + esc(s.username) + ' · ' : '') + 'od ' + esc(kiedy(s.subscribed_at)) + '</small></td>' +
        '<td>' + esc(JN[s.jezyk] || s.jezyk) + '</td>' +
        '<td><select data-rola="' + esc(s.id) + '" style="min-width:120px">' + [['', '—'], ['wlasciciel', 'właściciel'], ['ksiegowy', 'księgowy'], ['inna', 'inna osoba']].map(function (o) { return '<option value="' + o[0] + '"' + ((s.rola || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td>' +
        '<td>' + stanS + (s.last_delivery_at ? '<small>ostatnia wiadomość: ' + esc(kiedy(s.last_delivery_at)) + '</small>' : '') + '</td>' +
        '<td>' + (s.zgoda_marketing ? pill('zgoda', 'p-ok') + '<small>' + esc(s.zgoda_zrodlo || '') + '</small>' : pill('brak', 'p-grey')) + '</td>' +
        '<td><span class="acts"><button type="button" class="mini" data-sub-zgoda="' + esc(s.id) + '" data-na="' + (s.zgoda_marketing ? '0' : '1') + '">' + (s.zgoda_marketing ? 'Wycofanie zgody' : 'Zapisz zgodę') + '</button>' +
        (s.aktywna ? '<button type="button" class="mini" data-sub-wylacz="' + esc(s.id) + '">Wyłącz</button>' : '') + '</span></td></tr>';
    }).join('') || '<tr><td colspan="7" class="empty">Brak subskrybentów' + (wsz ? '' : ' tego klienta') + '.</td></tr>';
  }
  async function odswiezKlientow() { var r = await api('klienci'); if (!r.error) klienci = r.klienci.slice().sort(function (a, b) { return a.nazwa.localeCompare(b.nazwa, 'pl'); }); rysujKafelki(); }

  // ---------------- bot and settings (administrator) ----------------
  var bAkcja = null;
  function botHtml(nazwa, b, oczekiwany) {
    if (!b) return '';
    if (!b.ok) return '<div>' + pill(nazwa, 'p-red') + ' ' + esc(b.blad) + '</div>';
    var w = b.webhook;
    return '<div class="row"><b>' + esc(nazwa) + ':</b> @' + esc(b.username) + ' <span class="sub">„' + esc(b.name) + '”, id ' + esc(b.id) + '</span><div class="licznik">' +
      pill(b.can_join_groups ? 'może być dodawany do grup' : 'nie może być dodawany do grup', 'p-grey') + pill(b.can_read_all_group_messages ? 'czyta wszystkie wiadomości w grupach' : 'w grupach widzi tylko komendy', b.can_read_all_group_messages ? 'p-amber' : 'p-grey') +
      pill(!w.ustawiony ? 'webhook: brak' : w.nasz ? 'webhook: portal' : oczekiwany && w.host === oczekiwany ? 'webhook: aplikacja onboardingowa (' + w.host + ') — przekazuje do portalu' : 'webhook: INNY SYSTEM (' + w.host + ')', !w.ustawiony ? 'p-grey' : w.nasz || (oczekiwany && w.host === oczekiwany) ? 'p-ok' : 'p-red') +
      pill('oczekujące aktualizacje: ' + (w.pending_update_count == null ? '?' : w.pending_update_count), w.pending_update_count ? 'p-amber' : 'p-grey') + '</div>' +
      (w.last_error_message ? '<div class="sub warn">Ostatni błąd doręczenia (' + esc(kiedy(w.last_error_date)) + '): ' + esc(w.last_error_message) + '</div>' : '') + '</div>';
  }
  async function sprawdzBota() {
    $('bStatus').innerHTML = '<span class="sub">Pytam Telegram…</span>';
    var r = await api('bot_status');
    if (r.error) { $('bStatus').innerHTML = pill('błąd', 'p-red') + ' ' + esc(r.error); return; }
    var stop = /^(STOP|UWAGA)/.test(r.wniosek), prz = r.tryb && r.tryb.dzialajacy === 'przekazywanie';
    $('bStatus').innerHTML = (prz ? '<div>' + pill('tryb przekazywania — portal nie zmienia webhooka', 'p-navy') + '</div>' : '') + botHtml(r.konfiguracja.osobny_bot ? 'Bot subskrypcji (KLIENT_BOT_TOKEN)' : 'Bot portalu (TELEGRAM_BOT_TOKEN) — ten sam do subskrypcji i grup', r.subskrypcje, prz ? r.tryb.host_przekazujacy : '') + botHtml('Bot wysyłający do grup (TELEGRAM_BOT_TOKEN)', r.grupy) +
      '<p class="row ' + (stop ? 'warn' : '') + '"><b>' + esc(r.wniosek) + '</b></p><p class="sub">Adres odbiornika portalu: ' + esc(r.nasz_webhook) + '</p>';
    var w = r.subskrypcje.ok ? r.subskrypcje.webhook : null;
    $('bUstaw').disabled = !w || stop || w.nasz || prz; $('bUsun').disabled = !w || !w.nasz || prz;
    if (prz) $('bPotwBox').hidden = true;
  }
  async function webhookOpis(a) {
    bAkcja = a;
    var r = await api(a);
    if (r.error) { $('bMsg').innerHTML = pill('błąd', 'p-red') + ' ' + esc(r.error); return; }
    if (r.wylaczone) { $('bPotwBox').hidden = true; $('bMsg').innerHTML = pill('wyłączone', 'p-navy') + ' ' + esc(r.przeszkody.join(' ')); return; }
    $('bOpis').innerHTML = '<p><b>Co zostanie wywołane:</b></p><pre class="msg">' + esc(JSON.stringify(r.opis, null, 2)) + '</pre><p class="hint warn row">' + esc(r.skutek) + '</p>' +
      (r.przeszkody.length ? '<p class="warn"><b>Nie można wykonać:</b> ' + esc(r.przeszkody.join(' ')) + '</p>' : '');
    $('bPotwLabel').textContent = 'Przepisz „' + r.potwierdz + '”, aby wykonać'; $('bPotw').value = ''; $('bWykonaj').disabled = r.przeszkody.length > 0; $('bPotwBox').hidden = false; $('bMsg').innerHTML = '';
  }
  async function webhookWykonaj() {
    var r = await api(bAkcja, { wykonaj: true, potwierdz: $('bPotw').value.trim() });
    $('bMsg').innerHTML = r.error ? pill('błąd', 'p-red') + ' ' + esc(r.error) : r.wykonano ? pill('wykonano', 'p-ok') : pill('nie wykonano', 'p-red') + ' ' + esc(r.blad || (r.przeszkody && r.przeszkody.join(' ')) || 'Przepisz dokładnie podany tekst.');
    if (r.wykonano) { $('bPotwBox').hidden = true; sprawdzBota(); }
  }
  function rysujUstawienia() {
    if (!st || !st.ja.admin) return;
    var u = st.ustawienia;
    $('uProg').value = u.prog_akceptacji; $('uOd').value = u.godziny.od; $('uDo').value = u.godziny.do; $('uStop').value = u.stop_po_bledach; $('uNa').value = u.na_przebieg; $('uOdstep').value = u.odstep_ms;
    $('uDni').value = u.link_dni; $('uMax').value = u.link_max; $('uKoniec').value = u.koniec_grup || ''; $('uPolityka').value = u.polityka_url || ''; $('uTryb').value = u.tryb_bota || 'auto'; $('uHost').value = u.host_przekazujacy || '';
    $('uInfo').textContent = (st.brak.length ? 'Brakuje sekretów: ' + st.brak.join(', ') + '. ' : '') + (u.by ? 'Ostatnia zmiana: ' + u.by + (u.updated_at ? ', ' + kiedy(u.updated_at) : '') + '.' : '');
  }
  async function zapiszUstawienia() {
    var u = { prog_akceptacji: Number($('uProg').value), godziny: { od: $('uOd').value, do: $('uDo').value }, na_przebieg: Number($('uNa').value), odstep_ms: Number($('uOdstep').value), stop_po_bledach: Number($('uStop').value), max_prob: st.ustawienia.max_prob,
      link_dni: Number($('uDni').value), link_max: Number($('uMax').value), koniec_grup: $('uKoniec').value, polityka_url: $('uPolityka').value.trim(), tryb_bota: $('uTryb').value, host_przekazujacy: $('uHost').value.trim().toLowerCase() || 'td-onboarding.vercel.app' };
    var r = await api('ustawienia', { ustawienia: u });
    $('uMsg').textContent = r.error ? r.error : 'Zapisano.'; $('uMsg').className = r.error ? 'sub warn' : 'sub';
    if (!r.error) { st.ustawienia = Object.assign(st.ustawienia, r.ustawienia); rysujKafelki(); $('eData').value = st.ustawienia.koniec_grup || ''; }
  }

  // ---------------- templates and segments ----------------
  async function wczytajSzablony() {
    var r = await api('szablony', { data: $('eData').value || undefined });
    szablony = r.szablony || [];
    opcje($('eSzablon'), [['', '— bez szablonu —']].concat(szablony.map(function (s) { return [s.id, s.nazwa + (s.wbudowany ? ' (wbudowany)' : '')]; })), $('eSzablon').value);
    var s = await api('segmenty'); segmenty = s.segmenty || [];
    opcje($('eSegment'), [['', '— wybierz segment —']].concat(segmenty.map(function (x) { return [x.id, x.nazwa]; })), '');
  }
  async function wstawSzablon(id) {
    await wczytajSzablony();
    var s = szablony.filter(function (x) { return x.id === (id || $('eSzablon').value); })[0];
    if (!s) return;
    if (tekstSeg(zEdytora()).trim() && !confirm('Zastąpić obecną treść szablonem „' + s.nazwa + '”?')) return;
    zFormularza();
    R.tresc = kopia(s.tresc); R.typ = s.typ || R.typ;
    if (!R.tytul) R.tytul = s.nazwa;
    if (s.wbudowany && st.ja.admin) { R.strategia = s.strategia; R.kanaly = kopia(s.kanaly); }
    jez = 'pl'; doFormularza(); zmiana();
  }

  // ---------------- load ----------------
  function unikalne(pole) { var s = {}; klienci.forEach(function (k) { if (k[pole]) s[k[pole]] = 1; }); return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'pl'); }).map(function (x) { return [x, x]; }); }
  async function start() {
    var r = await api('status');
    if (r.error) { $('tiles').innerHTML = '<div class="tile red"><b>!</b><span>' + esc(r.error) + '</span></div>'; return; }
    st = r; R = pusta();
    await odswiezKlientow();
    opcje($('fStatus'), [['obslugiwany', 'obsługiwany'], ['wstrzymany', 'wstrzymany'], ['zakonczony', 'zakończony']]); opcje($('fJezyk'), [['pl', 'polski'], ['ru', 'rosyjski'], ['uk', 'ukraiński'], ['-', 'nie podano']]);
    opcje($('fForma'), unikalne('forma')); opcje($('fOpod'), unikalne('opodatkowanie')); opcje($('fOpiekun'), unikalne('opiekun')); opcje($('fKadrowy'), unikalne('kadrowy')); opcje($('fMiasto'), unikalne('miasto'));
    opcje($('pKlient'), [['', '— pierwszy obsługiwany klient —']].concat(klienci.map(function (k) { return [k.id, k.nazwa + ' · ' + JN[k.jezyk]]; })), '');
    $('eData').value = st.ustawienia.koniec_grup || '';
    rysujTaby(); rysujUstawienia(); doFormularza(); await wczytajSzablony();
    rysujSubKlientow(startKlient && klienci.some(function (k) { return k.id === startKlient; }) ? startKlient : '');
    if (startKlient) idz('subskrypcje');
    else if (startId) { var p = await api('pobierz', { id: startId }); if (!p.error) otworz(startId, p.rozsylka.status); else lista(); }
    else lista();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tab],[data-jez],[data-fmt],[data-pole],[data-prz-usun],[data-dodaj],[data-wyklucz],[data-rozsylka],[data-akcja],[data-kopiuj],[data-zgoda],[data-flaga],[data-sub-zgoda],[data-sub-wylacz]');
    if (!t) return;
    var a = function (n) { return t.getAttribute(n); };
    if (a('data-tab')) { if (tab === 'edytor') zFormularza(); idz(a('data-tab')); if (tab === 'edytor') podgladPozniej(); }
    else if (a('data-jez')) { zFormularza(); jez = a('data-jez'); doFormularza(); }
    else if (a('data-fmt')) {
      $('ed').focus();
      var f = a('data-fmt');
      if (f === 'link') { var u = prompt('Adres linku (https://…). Aby wstawić indywidualny link subskrypcji klienta, wpisz ' + LINK_SUB, 'https://'); if (u && (/^https:\/\/\S+$/.test(u.trim()) || u.trim() === LINK_SUB)) document.execCommand('createLink', false, u.trim()); else if (u) alert('Link musi zaczynać się od https://'); }
      else document.execCommand(f === 'clear' ? 'removeFormat' : f, false, null);
      zmiana();
    }
    else if (a('data-pole')) { $('ed').focus(); document.execCommand('insertText', false, a('data-pole')); zmiana(); }
    else if (a('data-prz-usun')) { zFormularza(); R.tresc.przyciski.splice(Number(a('data-prz-usun')), 1); rysujPrzyciski(); zmiana(); }
    else if (a('data-dodaj')) { przelacz(R.odbiorcy.wybrani, a('data-dodaj')); var i = R.odbiorcy.wykluczeni.indexOf(a('data-dodaj')); if (i !== -1) R.odbiorcy.wykluczeni.splice(i, 1); rysujKlientow(); zmiana(); }
    else if (a('data-wyklucz')) { przelacz(R.odbiorcy.wykluczeni, a('data-wyklucz')); var i2 = R.odbiorcy.wybrani.indexOf(a('data-wyklucz')); if (i2 !== -1) R.odbiorcy.wybrani.splice(i2, 1); rysujKlientow(); zmiana(); }
    else if (a('data-rozsylka')) otworz(a('data-rozsylka'), a('data-status'));
    else if (a('data-akcja')) akcja(a('data-akcja'));
    else if (a('data-kopiuj')) { var el = $(a('data-kopiuj')); if (el && navigator.clipboard) navigator.clipboard.writeText(el.textContent).then(function () { t.textContent = 'Skopiowano'; }); }
    else if (a('data-zgoda')) { var z = zrodloZgody(a('data-na') === '1'); if (z) api('zgoda', { klient: $('sKl').value, kanal: a('data-zgoda'), zgoda: a('data-na') === '1', zrodlo: z.zrodlo, data: z.data }).then(function (r) { if (r.error) alert(r.error); odswiezKlientow().then(subKlient); }); }
    else if (a('data-flaga')) { if (confirm(a('data-flaga') === '1' ? 'Zezwolić, aby automatyczne powiadomienia nadal trafiały także do grupy tego klienta?' : 'Wyłączyć automatyczne powiadomienia w grupie tego klienta?')) api('grupa_flaga', { klient: $('sKl').value, dozwolona: a('data-flaga') === '1' }).then(function (r) { if (r.error) alert(r.error); odswiezKlientow().then(subKlient); }); }
    else if (a('data-sub-zgoda')) { var z2 = zrodloZgody(a('data-na') === '1'); if (z2) api('subskrybent', { id: a('data-sub-zgoda'), zgoda: { zgoda: a('data-na') === '1', zrodlo: z2.zrodlo, data: z2.data } }).then(function (r) { if (r.error) alert(r.error); odswiezKlientow().then(subskrybenci); }); }
    else if (a('data-sub-wylacz')) { if (confirm('Wyłączyć tę subskrypcję? Osoba przestanie dostawać powiadomienia; może zapisać się ponownie linkiem.')) api('subskrybent', { id: a('data-sub-wylacz'), wylacz: true }).then(function (r) { if (r.error) alert(r.error); odswiezKlientow().then(subskrybenci); }); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.getAttribute('data-rola')) api('subskrybent', { id: t.getAttribute('data-rola'), rola: t.value || null }).then(function (r) { if (r.error) alert(r.error); });
    else if (t.closest('#t-edytor') && t.id !== 'pKlient' && t.id !== 'oTylkoBrak' && t.id !== 'eKlQ' && t.id !== 'eSzablon' && t.id !== 'eSegment' && t.id !== 'eData' && t.id !== 'eKiedy' && t.id !== 'eCisza' && t.id !== 'eTel' && t.id !== 'ePotwTytul') {
      if (t.id === 'eWspolna') { zFormularza(); if (R.tresc.wspolna) jez = 'pl'; doFormularza(); }
      else zFormularza();
      rysujKanaly(); rysujKlientow(); zmiana();
    }
  });
  $('t-edytor').addEventListener('input', function (e) { if (['eKlQ', 'eTel', 'ePotwTytul', 'eKiedy'].indexOf(e.target.id) === -1) zmiana(); });
  $('ed').addEventListener('paste', function (e) { e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
  $('ed').addEventListener('drop', function (e) { e.preventDefault(); }); // dragged-in content would bring its own markup
  $('eKlQ').addEventListener('input', rysujKlientow);
  $('pKlient').addEventListener('change', podglad);
  $('oTylkoBrak').addEventListener('change', rysujOdbiorcow);
  $('nowa').addEventListener('click', function () { R = pusta(); jez = 'pl'; brudny = false; testOk = false; doFormularza(); idz('edytor'); });
  $('nowaKoniec').addEventListener('click', function () { R = pusta(); jez = 'pl'; doFormularza(); idz('edytor'); wstawSzablon('wbudowany:koniec_grup'); });
  $('eWstaw').addEventListener('click', function () { wstawSzablon(); });
  $('eData').addEventListener('change', wczytajSzablony);
  $('eZapiszSzablon').addEventListener('click', async function () { var n = prompt('Nazwa szablonu'); if (!n) return; var d = zFormularza(), r = await api('szablon_zapisz', { nazwa: n, typ: d.typ, tresc: d.tresc }); $('eMsg').innerHTML = r.error ? pill(r.error, 'p-red') : pill('zapisano szablon', 'p-ok'); wczytajSzablony(); });
  $('eUsunSzablon').addEventListener('click', async function () { var id = $('eSzablon').value; if (!id || /^wbudowany/.test(id) || !confirm('Usunąć ten szablon?')) return; var r = await api('szablon_usun', { id: id }); if (r.error) alert(r.error); wczytajSzablony(); });
  $('eSegment').addEventListener('change', function () { var s = segmenty.filter(function (x) { return x.id === $('eSegment').value; })[0]; if (!s) return; zFormularza(); R.odbiorcy = Object.assign({ tryb: 'wszyscy', filtry: {}, wybrani: [], wykluczeni: [] }, kopia(s.odbiorcy)); doFormularza(); zmiana(); });
  $('eSegZapisz').addEventListener('click', async function () { var n = prompt('Nazwa segmentu'); if (!n) return; var r = await api('segment_zapisz', { nazwa: n, odbiorcy: zFormularza().odbiorcy }); if (r.error) alert(r.error); wczytajSzablony(); });
  $('eSegUsun').addEventListener('click', async function () { var id = $('eSegment').value; if (!id || !confirm('Usunąć ten segment?')) return; var r = await api('segment_usun', { id: id }); if (r.error) alert(r.error); wczytajSzablony(); });
  $('ePrzDodaj').addEventListener('click', function () { zFormularza(); if (R.tresc.przyciski.length < 3) R.tresc.przyciski.push({ etykieta: { pl: '', ru: '', uk: '' }, url: '' }); rysujPrzyciski(); zmiana(); });
  $('ePrzSub').addEventListener('click', function () { zFormularza(); if (R.tresc.przyciski.length < 3) R.tresc.przyciski.push({ etykieta: { pl: 'Włącz powiadomienia', ru: 'Включить уведомления', uk: 'Увімкнути сповіщення' }, url: LINK_SUB }); rysujPrzyciski(); zmiana(); });
  $('eMailZTg').addEventListener('click', function () { $('eMail').value = tekstSeg(zEdytora()); zmiana(); });
  $('eZapisz').addEventListener('click', zapisz);
  $('eOdbiorcy').addEventListener('click', pokazOdbiorcow);
  $('eTest').addEventListener('click', test);
  $('eDalej').addEventListener('click', dalej);
  $('ePotwTak').addEventListener('click', potwierdz);
  $('ePotwNie').addEventListener('click', function () { $('ePotw').hidden = true; });
  ['dStatus', 'dKanal'].forEach(function (id) { $(id).addEventListener('change', function () { D.strona = 0; postep(); }); });
  $('dPrev').addEventListener('click', function () { if (D.strona > 0) { D.strona--; postep(); } });
  $('dNext').addEventListener('click', function () { if (D.dalej) { D.strona++; postep(); } });
  $('dOdswiez').addEventListener('click', postep);
  $('dCsv').addEventListener('click', pobierzCsv);
  $('dAkceptuj').addEventListener('click', function () { decyzja(true); });
  $('dOdrzuc').addEventListener('click', function () { decyzja(false); });
  $('sQ').addEventListener('input', function () { rysujSubKlientow(); });
  $('sKl').addEventListener('change', subKlient);
  $('sWszyscy').addEventListener('change', subskrybenci);
  $('sLink').addEventListener('click', function () { pokazLink({}); });
  $('sRotuj').addEventListener('click', function () { if (confirm('Unieważnić obecny link tego klienta? Osoby już zapisane zostają; stary link przestanie działać.')) pokazLink({ rotuj: true }); });
  $('sMoj').addEventListener('click', function () { pokazLink({ moj: true }); });
  $('bSprawdz').addEventListener('click', sprawdzBota);
  $('bUstaw').addEventListener('click', function () { webhookOpis('webhook_ustaw'); });
  $('bUsun').addEventListener('click', function () { webhookOpis('webhook_usun'); });
  $('bWykonaj').addEventListener('click', webhookWykonaj);
  $('bAnuluj').addEventListener('click', function () { $('bPotwBox').hidden = true; });
  $('uZapisz').addEventListener('click', zapiszUstawienia);
  window.addEventListener('beforeunload', function (e) { if (brudny && tab === 'edytor') { e.preventDefault(); e.returnValue = ''; } });

  if (window.PortalUser) start(); else document.addEventListener('portal:access', start, { once: true });
})();
