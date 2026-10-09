/* Zespół: staff profiles (administrators only) — who is who, who answers for what, and the access
   to the portal's modules, all in one card. Everything goes through the portal-admin edge function,
   which checks app_metadata.portal_admin server-side; this page holds no privileged key.
   Nothing is written until "Zapisz" is pressed on a card, and the card shows what will change. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/portal-admin';
  var ZADANIA_FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/zadania';
  var MIN_PASSWORD = 10;
  var SECTIONS = [['rejestracja', 'Rejestracja spółki'], ['biezaca', 'Bieżąca działalność'], ['kadry', 'Kadry'], ['legalizacja', 'Legalizacja pobytu'], ['onboarding', 'Księgowość']];
  var DZIALY = [['kadry', 'Kadry'], ['ksiegowosc', 'Księgowość'], ['legalizacja', 'Legalizacja pobytu'], ['spolka', 'Spółki'], ['zarzad', 'Zarząd']];
  // sections a department normally works in — pre-ticked in the card, the administrator may change them
  var PRESET = { kadry: ['kadry'], ksiegowosc: ['onboarding'], legalizacja: ['legalizacja'], spolka: ['rejestracja', 'biezaca'], zarzad: [] };
  var ODP = [
    ['domyslny_kadry', 'Domyślna osoba dla kadr', 'zadania kadrowe dopisane przez portal i nieprzypisana poczta kadr'],
    ['domyslny_ksiegowosc', 'Domyślna osoba dla księgowości', 'nieprzypisana poczta księgowości'],
    ['sms', 'Może wysyłać SMS-y do klientów', ''],
    ['akta', 'Prowadzi akta osobowe', ''],
    ['podpisy_weryfikacja', 'Weryfikuje podpisane dokumenty', ''],
  ];
  var SKRZYNKI = ['kadry@td-group.pl', 'ksiegowosc@td-group.pl'];
  var POLA = { imie_nazwisko: 'imię i nazwisko', aliasy: 'skróty', stanowisko: 'stanowisko', telefon: 'telefon', telegram_chat: 'Telegram', telegram_username: 'Telegram (@nazwa)', dzialy: 'działy',
    skrzynki: 'skrzynki', odpowiada: 'odpowiedzialność', aktywny: 'aktywność', nieobecny_od: 'nieobecność od', nieobecny_do: 'nieobecność do', zastepca: 'zastępca', notatki: 'notatki' };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function fmt(iso) { return iso ? new Date(iso).toLocaleString('pl-PL') : 'nigdy'; }
  function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date()); }
  // the same comparison as portal_alias_norm() in the database: no case, spaces or dots
  function norm(a) { return String(a || '').toLowerCase().replace(/[\s .]+/g, ''); }
  function label(list, key) { var f = list.filter(function (x) { return x[0] === key; })[0]; return f ? f[1] : key; }
  function show(msg, type) { $('status').textContent = msg || ''; $('status').className = 'status ' + (msg ? type || 'success' : ''); }

  var D = null, people = [], me = '';
  var f = { q: '', dzial: '', widok: 'wszyscy' };
  var K = null; // the open card

  async function post(url, body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) { var e = new Error(out.error || ('Błąd ' + res.status)); e.status = res.status; throw e; }
    return out;
  }
  function call(body) { return post(FN, body); }

  // ---------------- data ----------------
  function nazwa(x) { return (x.p && x.p.imie_nazwisko) || x.email; }
  function byEmail(email) { return people.filter(function (x) { return x.email === email; })[0] || null; }
  function nieobecny(p) {
    if (!p || (!p.nieobecny_od && !p.nieobecny_do)) return false;
    var d = today();
    return (!p.nieobecny_od || p.nieobecny_od <= d) && (!p.nieobecny_do || d <= p.nieobecny_do);
  }
  function sekcje(u) { return !u ? [] : (u.admin || !u.sections) ? SECTIONS.map(function (s) { return s[0]; }) : u.sections; }
  function wlasciciel(alias, bezEmail) {
    var n = norm(alias);
    return people.filter(function (x) { return x.p && x.email !== bezEmail && x.p.aliasy.some(function (a) { return norm(a) === n; }); })[0] || null;
  }
  function klienci(aliasy) {
    var out = { opiekun: 0, kadrowy: 0 }, ns = aliasy.map(norm);
    (D.skroty || []).forEach(function (s) { if (ns.indexOf(norm(s.nazwa)) !== -1) { out.opiekun += s.opiekun; out.kadrowy += s.kadrowy; } });
    return out;
  }
  function build() {
    var users = {}, seen = {};
    D.users.forEach(function (u) { users[u.email.toLowerCase()] = u; });
    people = D.profiles.map(function (p) { seen[p.email] = 1; return { email: p.email, p: p, u: users[p.email] || null, konto: p.konto }; });
    D.users.forEach(function (u) { var e = u.email.toLowerCase(); if (!seen[e]) people.push({ email: e, p: null, u: u, konto: 'portal' }); });
    people.sort(function (a, b) { return nazwa(a).localeCompare(nazwa(b), 'pl'); });
  }

  // what does not add up — hints only, nothing here changes data
  function issues() {
    var out = [], akt = people.filter(function (x) { return x.p && x.p.aktywny; });
    function add(lvl, html, email, nowy) { out.push({ lvl: lvl, html: html, email: email || '', nowy: nowy || null }); }
    (D.skroty || []).forEach(function (s) {
      var w = wlasciciel(s.nazwa), ile = [s.opiekun ? s.opiekun + ' jako opiekun' : '', s.kadrowy ? s.kadrowy + ' jako kadrowy' : ''].filter(Boolean).join(', ');
      if (!w) add('uwaga', 'Skrót <b>„' + esc(s.nazwa) + '”</b> z bazy klientów nie ma właściciela — klienci: ' + ile + '.', '', { aliasy: [s.nazwa], dzialy: [s.opiekun >= s.kadrowy ? 'ksiegowosc' : 'kadry'] });
      else if (!w.p.aktywny) add('uwaga', 'Skrót <b>„' + esc(s.nazwa) + '”</b> (klienci: ' + ile + ') należy do nieaktywnej osoby: ' + esc(nazwa(w)) + '.', w.email);
    });
    akt.forEach(function (x) {
      var p = x.p, o = p.odpowiada || {};
      if (p.skrzynki.length && !p.telegram_chat) add('uwaga', '<b>' + esc(nazwa(x)) + '</b> obsługuje skrzynkę ' + esc(p.skrzynki.join(', ')) + ', ale nie ma czatu Telegram — o nowych zadaniach dowie się tylko w portalu.', x.email);
      if ((o.domyslny_kadry || o.domyslny_ksiegowosc) && x.konto !== 'portal') add('uwaga', '<b>' + esc(nazwa(x)) + '</b> — osoba domyślna bez dostępu do portalu; zadania nie będą do niej kierowane.', x.email);
      if (nieobecny(p)) {
        var z = p.zastepca ? byEmail(p.zastepca) : null;
        if (!z || !z.p) add('uwaga', '<b>' + esc(nazwa(x)) + '</b> ma dziś nieobecność i nie ma zastępcy — zadania nadal trafiają do tej osoby.', x.email);
        else if (!z.p.aktywny || nieobecny(z.p)) add('uwaga', 'Zastępca osoby <b>' + esc(nazwa(x)) + '</b> (' + esc(nazwa(z)) + ') ' + (z.p.aktywny ? 'też ma dziś nieobecność' : 'ma nieaktywny profil') + '.', x.email);
      }
      if (x.konto !== 'portal') add('info', '<b>' + esc(nazwa(x)) + '</b> ma profil, ale ' + (x.konto === 'inne' ? 'konto pod tym adresem nie ma dostępu do portalu.' : 'nie ma jeszcze konta w portalu.'), x.email);
      if (D.klienci) p.aliasy.forEach(function (a) {
        if (!(D.skroty || []).some(function (s) { return norm(s.nazwa) === norm(a); })) add('info', 'Skrót <b>„' + esc(a) + '”</b> (' + esc(nazwa(x)) + ') nie występuje u żadnego obsługiwanego klienta.', x.email);
      });
      if (!p.telegram_chat && D.zadania && D.zadania.telegram[x.email]) add('info', '<b>' + esc(nazwa(x)) + '</b>: czat Telegram jest zapisany tylko w ustawieniach Zadań — otwórz kartę i zapisz, aby go przenieść.', x.email);
    });
    people.forEach(function (x) {
      if (x.p && !x.p.aktywny && x.konto === 'portal') add('uwaga', '<b>' + esc(nazwa(x)) + '</b> ma nieaktywny profil, a nadal ma dostęp do portalu.', x.email);
      if (!x.p) add('info', 'Użytkownik portalu <b>' + esc(x.email) + '</b> nie ma profilu.', x.email);
      if (!x.p || !x.u || x.u.admin || !x.p.aktywny) return;
      if (!x.u.sections) { add('info', '<b>' + esc(nazwa(x)) + '</b> ma dostęp do wszystkich modułów (konto bez listy sekcji).', x.email); return; }
      var chce = [], ma = x.u.sections;
      x.p.dzialy.forEach(function (d) { PRESET[d].forEach(function (s) { if (chce.indexOf(s) === -1) chce.push(s); }); });
      var brak = chce.filter(function (s) { return ma.indexOf(s) === -1; }), nad = ma.filter(function (s) { return chce.indexOf(s) === -1; });
      if (brak.length) add('uwaga', '<b>' + esc(nazwa(x)) + '</b>: dział wskazuje na moduł, do którego nie ma dostępu — ' + brak.map(function (s) { return esc(label(SECTIONS, s)); }).join(', ') + '.', x.email);
      if (nad.length && x.p.dzialy.length && x.p.dzialy.indexOf('zarzad') === -1) add('info', '<b>' + esc(nazwa(x)) + '</b>: dostęp do modułu spoza działów tej osoby — ' + nad.map(function (s) { return esc(label(SECTIONS, s)); }).join(', ') + '.', x.email);
    });
    [['domyslny_kadry', 'kadr'], ['domyslny_ksiegowosc', 'księgowości']].forEach(function (k) {
      var kto = akt.filter(function (x) { return (x.p.odpowiada || {})[k[0]] === true; });
      if (kto.length > 1) add('uwaga', 'Kilka osób jest oznaczonych jako domyślna dla ' + k[1] + ': ' + kto.map(function (x) { return esc(nazwa(x)); }).join(', ') + ' — portal wybierze pierwszą według adresu e-mail.', kto[0].email);
      if (!kto.length) add('info', 'Nikt nie jest osobą domyślną dla ' + k[1] + (k[0] === 'domyslny_kadry' ? ' — zadania z systemu trafiają do: ' + esc((D.zadania && D.zadania.kadry) || 'pierwszego administratora') + '.' : '.'));
    });
    return out.sort(function (a, b) { return (a.lvl === 'uwaga' ? 0 : 1) - (b.lvl === 'uwaga' ? 0 : 1); });
  }

  // ---------------- list ----------------
  var WIDOKI = {
    wszyscy: function () { return true; },
    portal: function (x) { return x.konto === 'portal'; },
    bezkonta: function (x) { return x.p && x.konto !== 'portal'; },
    bezprofilu: function (x) { return !x.p; },
    nieobecni: function (x) { return x.p && x.p.aktywny && nieobecny(x.p); },
  };
  function pills(x) {
    var out = [];
    if (x.p && !x.p.aktywny) out.push('<span class="pill p-red">profil nieaktywny</span>');
    if (x.konto === 'portal') out.push('<span class="pill p-ok">ma konto</span>');
    else out.push(x.konto === 'inne' ? '<span class="pill p-amber">konto bez dostępu do portalu</span>' : '<span class="pill p-grey">bez konta</span>');
    if (x.u && x.u.admin) out.push('<span class="pill p-navy">administrator</span>');
    if (!x.p) out.push('<span class="pill p-amber">bez profilu</span>');
    if (x.p && x.p.aktywny && nieobecny(x.p)) out.push('<span class="pill p-amber">nieobecność' + (x.p.nieobecny_do ? ' do ' + pl(x.p.nieobecny_do) : '') + '</span>');
    if (x.u && x.u.id === me) out.push('<span class="pill p-ok">to Ty</span>');
    return out.join('');
  }
  function render() {
    var is = issues(), uw = is.filter(function (i) { return i.lvl === 'uwaga'; }).length;
    var n = function (k) { return people.filter(WIDOKI[k]).length; };
    var tiles = [['wszyscy', 'Wszyscy', ''], ['portal', 'Z dostępem do portalu', 'green'], ['bezkonta', 'Profil bez konta', 'amber'], ['bezprofilu', 'Konto bez profilu', 'amber'], ['nieobecni', 'Nieobecni dziś', 'amber']];
    $('tiles').innerHTML = tiles.map(function (t) {
      var c = n(t[0]);
      return '<button type="button" class="tile ' + (c ? t[2] : 'zero') + (f.widok === t[0] ? ' on' : '') + '" data-w="' + t[0] + '"><b>' + c + '</b><span>' + t[1] + '</span></button>';
    }).join('') + '<button type="button" class="tile ' + (uw ? 'red' : 'zero') + '" data-w="spojnosc"><b>' + uw + '</b><span>Do wyjaśnienia</span></button>';

    $('fDzial').innerHTML = '<option value="">Wszystkie działy</option>' + DZIALY.map(function (d) { return '<option value="' + d[0] + '"' + (f.dzial === d[0] ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('') +
      '<option value="-"' + (f.dzial === '-' ? ' selected' : '') + '>Bez działu</option>';
    var q = f.q.trim().toLowerCase();
    var list = people.filter(WIDOKI[f.widok] || WIDOKI.wszyscy).filter(function (x) {
      var dz = x.p ? x.p.dzialy : [];
      if (f.dzial && (f.dzial === '-' ? dz.length : dz.indexOf(f.dzial) === -1)) return false;
      return !q || [nazwa(x), x.email, x.p ? x.p.aliasy.join(' ') : '', x.p ? x.p.stanowisko : ''].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    $('count').textContent = list.length + ' z ' + people.length + ' osób';
    $('tbl').classList.toggle('pusta', !list.length);
    $('tbl').querySelector('thead').innerHTML = list.length ? '<tr><th>Osoba</th><th class="c-stan">Stanowisko</th><th>Działy</th><th class="c-skr">Skróty w bazie klientów</th><th>Moduły portalu</th><th>Status</th></tr>' : '';
    $('tbl').querySelector('tbody').innerHTML = list.length ? list.map(function (x) {
      var p = x.p, z = p && p.zastepca && nieobecny(p) ? byEmail(p.zastepca) : null;
      return '<tr class="kl" data-email="' + esc(x.email) + '" tabindex="0">' +
        '<td class="kn"><b>' + esc(nazwa(x)) + '</b>' + (p && p.imie_nazwisko ? '<small>' + esc(x.email) + '</small>' : '') + (z ? '<small>zastępuje: ' + esc(nazwa(z)) + '</small>' : '') + '</td>' +
        '<td class="c-stan">' + esc(p && p.stanowisko || '—') + '</td>' +
        '<td>' + (p && p.dzialy.length ? p.dzialy.map(function (d) { return '<span class="pill p-navy">' + esc(label(DZIALY, d)) + '</span>'; }).join('') : '—') + '</td>' +
        '<td class="c-skr">' + esc(p && p.aliasy.length ? p.aliasy.join(', ') : '—') + '</td>' +
        '<td>' + (x.konto !== 'portal' ? '—' : x.u.admin || !x.u.sections ? 'wszystkie' : x.u.sections.length ? x.u.sections.map(function (s) { return esc(label(SECTIONS, s)); }).join(', ') : 'żaden') + '</td>' +
        '<td>' + pills(x) + '</td></tr>';
    }).join('') : '<tr><td class="empty">' + (people.length ? 'Nikt nie pasuje do filtrów.' : 'Nie ma jeszcze żadnej osoby — zacznij od „Dodaj osobę”.') + '</td></tr>';

    $('issues').innerHTML = is.length ? is.map(function (i, idx) {
      return '<div class="doc"><div class="n"><span class="pill ' + (i.lvl === 'uwaga' ? 'p-amber' : 'p-grey') + '">' + (i.lvl === 'uwaga' ? 'uwaga' : 'informacja') + '</span> ' + i.html + '</div>' +
        '<div class="acts">' + (i.nowy ? '<button type="button" class="mini" data-nowy="' + idx + '">Utwórz profil</button>' : i.email ? '<button type="button" class="mini" data-open="' + esc(i.email) + '">Otwórz kartę</button>' : '') + '</div></div>';
    }).join('') : '<div class="empty">Wszystko się zgadza.</div>';
    render.issues = is;
  }

  // ---------------- card ----------------
  function pusty(email) {
    return { email: email || '', imie_nazwisko: '', aliasy: [], stanowisko: '', telefon: '', telegram_chat: '', telegram_username: '', dzialy: [], skrzynki: [], odpowiada: {}, aktywny: true, nieobecny_od: '', nieobecny_do: '', zastepca: '', notatki: '' };
  }
  // one comparable shape for the stored profile and for the form
  function ksztalt(p) {
    var o = {}, odp = p.odpowiada || {};
    ODP.forEach(function (k) { if (odp[k[0]] === true) o[k[0]] = true; });
    if ((odp.uwagi || '').trim()) o.uwagi = odp.uwagi.trim();
    return {
      email: p.email, imie_nazwisko: (p.imie_nazwisko || '').trim(), aliasy: (p.aliasy || []).slice().sort(), stanowisko: (p.stanowisko || '').trim(), telefon: (p.telefon || '').trim(),
      telegram_chat: (p.telegram_chat || '').trim(), telegram_username: tgNazwa(p.telegram_username), dzialy: (p.dzialy || []).slice().sort(), skrzynki: (p.skrzynki || []).slice().sort(), odpowiada: o, aktywny: p.aktywny !== false,
      nieobecny_od: p.nieobecny_od || '', nieobecny_do: p.nieobecny_do || '', zastepca: p.zastepca || '', notatki: (p.notatki || '').trim(),
    };
  }
  // "@nazwa", "t.me/nazwa" or "nazwa" -> "nazwa"
  function tgNazwa(v) { return String(v || '').trim().replace(/^(https?:\/\/)?t\.me\//i, '').replace(/^@/, ''); }
  function checks(attr, items, on, extra) {
    return items.map(function (i) {
      return '<label><input type="checkbox" ' + attr + '="' + esc(i[0]) + '"' + (on.indexOf(i[0]) !== -1 ? ' checked' : '') + (i[3] ? ' disabled' : '') + ' /> ' + esc(i[1]) + (i[2] ? ' <small>' + esc(i[2]) + '</small>' : '') + '</label>';
    }).join('') + (extra || '');
  }

  function openCard(x, wzor) {
    var nowy = !x, p = x && x.p, u = x ? x.u : null, konto = x ? x.konto : 'brak';
    var base = ksztalt(p || pusty(x ? x.email : ''));
    var start = JSON.parse(JSON.stringify(base));
    if (wzor) { start.aliasy = wzor.aliasy || []; start.dzialy = wzor.dzialy || []; }
    // a chat kept in the Zadania settings is offered, and saved only with the card
    var stary = !base.telegram_chat && x && D.zadania ? D.zadania.telegram[x.email] || '' : '';
    if (stary) start.telegram_chat = stary;
    K = { nowy: nowy, x: x, p: p, u: u, konto: konto, base: base, self: !!(u && u.id === me) };

    var skroty = (D.skroty || []).map(function (s) {
      var w = wlasciciel(s.nazwa, base.email);
      return [s.nazwa, s.nazwa, 'opiekun: ' + s.opiekun + ' · kadrowy: ' + s.kadrowy + (w ? ' — ma: ' + nazwa(w) : ''), !!w];
    });
    start.aliasy.forEach(function (a) { if (!skroty.some(function (s) { return norm(s[0]) === norm(a); })) skroty.push([a, a, 'nie występuje w bazie klientów', false]); });
    var inne = people.filter(function (y) { return y.p && y.p.aktywny && y.email !== base.email; });
    var skrz = SKRZYNKI.slice();
    people.forEach(function (y) { if (y.p) y.p.skrzynki.forEach(function (s) { if (skrz.indexOf(s) === -1) skrz.push(s); }); });
    var sek = u ? sekcje(u.admin ? { sections: u.sections } : u) : [];

    var dostep;
    if (konto === 'portal') {
      dostep = '<div class="hint" style="margin:0 0 6px"><span class="pill p-ok">ma dostęp do portalu</span> ostatnie logowanie: ' + esc(fmt(u.last_sign_in_at)) + (K.self ? ' · <b>to Twoje konto</b>' : '') + '</div>' +
        '<div class="checks"><label><input type="checkbox" id="kAdmin"' + (u.admin ? ' checked' : '') + (K.self ? ' disabled' : '') + ' /> Administrator <small>wszystkie moduły, zarządza zespołem i dostępem' + (K.self ? ' — własnych uprawnień nie można zmienić' : '') + '</small></label></div>' +
        '<label>Moduły portalu</label><div class="checks" id="kSek">' + checks('data-sec', SECTIONS, sek) + '</div><div class="hint" id="kSekHint"></div>' +
        '<div class="acts" style="margin-top:10px"><button type="button" class="mini" data-act="password">Zmień hasło</button>' + (K.self ? '' : '<button type="button" class="mini del" data-act="revoke">Odbierz dostęp do portalu</button>') +
        '<span class="sub">te dwie czynności działają od razu</span></div>';
    } else {
      dostep = '<div class="hint" style="margin:0 0 6px">' + (konto === 'inne' ? '<span class="pill p-amber">konto bez dostępu do portalu</span> ten adres ma już konto w innej naszej aplikacji — dostanie tylko dostęp do portalu, hasło się nie zmieni.' : '<span class="pill p-grey">bez konta</span> profil może istnieć bez konta; dostęp nadasz teraz albo później.') + '</div>' +
        '<div class="checks"><label><input type="checkbox" id="kGrant" /> Nadaj dostęp do portalu</label></div>' +
        '<div id="kGrantBox" hidden><label>Moduły portalu</label><div class="checks" id="kSek">' + checks('data-sec', SECTIONS, []) + '</div>' +
        (konto === 'brak' ? '<label for="kPass">Hasło startowe (min. ' + MIN_PASSWORD + ' znaków)</label><input type="password" id="kPass" minlength="' + MIN_PASSWORD + '" autocomplete="new-password" /><div class="hint">Przekaż je tej osobie osobiście — portal go nigdzie nie wysyła.</div>' : '') +
        '<div class="hint">Uprawnienia administratora można nadać w tej karcie po utworzeniu dostępu.</div></div>';
    }

    $('kartaBody').innerHTML =
      '<div class="head"><div><h3>' + esc(nowy ? 'Nowa osoba' : nazwa(x)) + '</h3><div class="sub">' + (nowy ? 'Profil można założyć, zanim powstanie konto w portalu.' : esc(x.email) + (p ? '' : ' · ten użytkownik nie ma jeszcze profilu')) + '</div></div><button type="button" class="x" id="kX" aria-label="Zamknij">×</button></div>' +
      '<h4>Dane</h4>' +
      '<div class="two"><div><label for="kImie">Imię i nazwisko</label><input type="text" id="kImie" maxlength="120" value="' + esc(start.imie_nazwisko) + '" placeholder="np. Anna Testowa" /></div>' +
        '<div><label for="kEmail">E-mail do logowania w portalu</label><input type="email" id="kEmail" maxlength="200" value="' + esc(start.email) + '"' + (nowy ? '' : ' disabled') + ' placeholder="np. osoba@przyklad.pl" autocomplete="off" /></div></div>' +
      '<div class="two"><div><label for="kStan">Stanowisko</label><input type="text" id="kStan" maxlength="120" value="' + esc(start.stanowisko) + '" /></div>' +
        '<div><label for="kTel">Telefon służbowy</label><input type="tel" id="kTel" maxlength="30" value="' + esc(start.telefon) + '" placeholder="+48 …" /></div></div>' +
      '<label>Działy</label><div class="checks" id="kDzialy">' + checks('data-dzial', DZIALY, start.dzialy) + '</div>' +
      '<div class="checks" style="margin-top:10px"><label><input type="checkbox" id="kAkt"' + (start.aktywny ? ' checked' : '') + ' /> Pracuje w biurze <small>odznacz, gdy osoba odeszła — profil zostaje, ale nic do niej nie trafia</small></label></div>' +

      '<h4>Skróty w bazie klientów</h4>' +
      '<div class="hint" style="margin:0">Zaznacz, pod jakim skrótem ta osoba jest wpisana przy klientach (kolumny Opiekun i Kadrowy). Po skrócie portal rozpoznaje, czyj to klient.</div>' +
      '<div class="checks col" id="kAliasy">' + (skroty.length ? checks('data-alias', skroty, start.aliasy) : '<span class="sub">Baza klientów nie zawiera jeszcze skrótów.</span>') + '</div>' +
      '<label for="kAliasInne">Inny skrót (kilka — po przecinku)</label><input type="text" id="kAliasInne" maxlength="200" placeholder="np. Testowa A." />' +

      '<h4>Skrzynki i odpowiedzialność</h4>' +
      '<label>Skrzynki biura, które obsługuje</label><div class="checks" id="kSkrz">' + checks('data-skrz', skrz.map(function (s) { return [s, s]; }), start.skrzynki) + '</div>' +
      '<label for="kSkrzInne">Inna skrzynka (kilka — po przecinku)</label><input type="text" id="kSkrzInne" maxlength="300" placeholder="np. biuro@td-group.pl" />' +
      '<label>Odpowiada za</label><div class="checks col" id="kOdp">' + checks('data-odp', ODP, Object.keys(start.odpowiada)) + '</div>' +
      '<label for="kUwagi">Zakres obowiązków — uwagi</label><input type="text" id="kUwagi" maxlength="500" value="' + esc(start.odpowiada.uwagi || '') + '" placeholder="np. klienci na ryczałcie, JPK" />' +

      '<h4>Telegram</h4>' +
      '<div class="inl"><input type="text" id="kTg" inputmode="numeric" maxlength="21" value="' + esc(start.telegram_chat) + '" placeholder="ID czatu Telegram (same cyfry)" /><button type="button" class="mini" id="kTgTest">Wyślij test</button></div>' +
      '<div class="hint">Na ten czat bot <b>@twojksiegowy_bot</b> wysyła zadania i przypomnienia. Osoba musi najpierw napisać do bota (Start); swoje ID sprawdzi np. w bocie @userinfobot.' + (stary ? ' <b>Wpisano ID zapisane dotąd w ustawieniach Zadań — zapisz kartę, aby je przenieść.</b>' : '') + '</div>' +
      '<div class="hint" id="kTgMsg"></div>' +
      '<label for="kTgUser">Telegram (@nazwa)</label><input type="text" id="kTgUser" maxlength="40" value="' + esc(start.telegram_username ? '@' + start.telegram_username : '') + '" placeholder="np. @anna_testowa" autocomplete="off" />' +
      '<div class="hint">Publiczna nazwa tej osoby w Telegramie. Portal wpisuje ją w powitaniu nowej grupy klienta i po niej dodaje opiekuna do grupy (Baza klientów → Utwórz grupę Telegram). Widzi ją tylko administrator.</div>' +

      '<h4>Nieobecność i zastępstwo</h4>' +
      '<div class="three"><div><label for="kOd">Nieobecność od</label><input type="date" id="kOd" value="' + esc(start.nieobecny_od) + '" /></div>' +
        '<div><label for="kDo">do (włącznie)</label><input type="date" id="kDo" value="' + esc(start.nieobecny_do) + '" /></div>' +
        '<div><label for="kZast">Zastępca</label><select id="kZast"><option value="">— brak —</option>' + inne.map(function (y) { return '<option value="' + esc(y.email) + '"' + (y.email === start.zastepca ? ' selected' : '') + '>' + esc(nazwa(y)) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="hint">W dniach nieobecności zadania i poczta tej osoby trafiają do zastępcy. Zastępca musi mieć własny profil.</div>' +

      '<h4>Dostęp do portalu</h4>' + dostep +

      '<h4>Notatki (widzi tylko administrator)</h4>' +
      '<textarea id="kNot" maxlength="2000">' + esc(start.notatki) + '</textarea>' +

      '<h4>Co ta osoba będzie otrzymywać</h4><ul class="chk" id="kSum"></ul>' +
      '<div class="hint">Zadania korzystają z tych danych po wdrożeniu zmiany w funkcji zadań; poczta i SMS-y — po podłączeniu tych modułów.</div>' +
      (p || u ? '<details class="hist" id="kHist"><summary>Historia zmian profilu i dostępu</summary><div class="sub">Ładowanie…</div></details>' : '') +

      '<div class="foot"><div class="note" id="kDiff"></div>' +
      '<div class="err" id="kErr"></div>' +
      '<div class="row">' + (p ? '<button type="button" id="kDel" style="flex:0 0 auto;color:#b91c1c">Usuń profil</button>' : '') + '<button type="button" id="kCancel">Anuluj</button><button type="button" class="go" id="kSave">Zapisz</button></div></div>';
    $('karta').hidden = false;
    $('kartaBody').scrollTop = 0;
    if (wzor) preset(start.dzialy);
    K.start = stan();
    refresh();
    if (nowy) $('kEmail').focus();
  }

  function ticked(attr) { return Array.prototype.filter.call($('kartaBody').querySelectorAll('[' + attr + ']'), function (c) { return c.checked; }).map(function (c) { return c.getAttribute(attr); }); }
  function split(v) { return String(v || '').split(/[,;]+/).map(function (s) { return s.trim(); }).filter(Boolean); }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }
  function form() {
    var odp = {};
    ticked('data-odp').forEach(function (k) { odp[k] = true; });
    if ($('kUwagi').value.trim()) odp.uwagi = $('kUwagi').value.trim();
    return ksztalt({
      email: $('kEmail').value.trim().toLowerCase(), imie_nazwisko: $('kImie').value, aliasy: uniq(ticked('data-alias').concat(split($('kAliasInne').value))), stanowisko: $('kStan').value,
      telefon: $('kTel').value, telegram_chat: $('kTg').value, telegram_username: $('kTgUser').value, dzialy: ticked('data-dzial'), skrzynki: uniq(ticked('data-skrz').concat(split($('kSkrzInne').value).map(function (s) { return s.toLowerCase(); }))),
      odpowiada: odp, aktywny: $('kAkt').checked, nieobecny_od: $('kOd').value, nieobecny_do: $('kDo').value, zastepca: $('kZast').value, notatki: $('kNot').value,
    });
  }
  // a ticked department pre-ticks its usual modules; the administrator may untick them before saving
  function preset(dzialy) {
    var box = $('kSek'); if (!box || ($('kAdmin') && $('kAdmin').checked)) return;
    dzialy.forEach(function (d) { (PRESET[d] || []).forEach(function (s) { var c = box.querySelector('[data-sec="' + s + '"]'); if (c) c.checked = true; }); });
  }
  // what pressing "Zapisz" will do: changed profile fields, access changes in words, calls to make
  function diff() {
    var fo = form(), prof = [], acc = [], ops = [], u = K.u;
    Object.keys(POLA).forEach(function (k) { if (JSON.stringify(fo[k]) !== JSON.stringify(K.base[k])) prof.push(POLA[k]); });
    var sek = ticked('data-sec'), nazwy = function (l) { return l.map(function (s) { return label(SECTIONS, s); }); };
    if (K.konto === 'portal') {
      var adm = $('kAdmin').checked;
      if (!adm) {
        var bylo = u.sections || SECTIONS.map(function (s) { return s[0]; });
        var plus = sek.filter(function (s) { return bylo.indexOf(s) === -1; }), minus = bylo.filter(function (s) { return sek.indexOf(s) === -1; });
        if (plus.length || minus.length) {
          acc.push('dostęp: ' + nazwy(plus).map(function (s) { return '+' + s; }).concat(nazwy(minus).map(function (s) { return '−' + s; })).join(', '));
          ops.push({ action: 'sections', id: u.id, sections: sek });
        }
      }
      if (adm !== u.admin) { acc.push('administrator: ' + (adm ? 'nadanie uprawnień' : 'odebranie uprawnień')); ops.push({ action: 'admin', id: u.id, on: adm }); }
    } else if ($('kGrant').checked) {
      acc.push('dostęp: ' + (K.konto === 'inne' ? 'istniejące konto dostanie dostęp do portalu' : 'nowe konto w portalu') + ' — ' + (sek.length ? nazwy(sek).map(function (s) { return '+' + s; }).join(', ') : 'bez żadnego modułu'));
      ops.push({ action: 'add', email: fo.email, password: $('kPass') ? $('kPass').value : '', sections: sek });
    }
    return { form: fo, prof: prof, acc: acc, ops: ops, zapis: K.nowy || !K.p || prof.length > 0 };
  }
  function refresh() {
    var d = diff(), fo = d.form, adm = $('kAdmin') && $('kAdmin').checked;
    if ($('kGrantBox')) $('kGrantBox').hidden = !$('kGrant').checked;
    if ($('kSek')) {
      Array.prototype.forEach.call($('kSek').querySelectorAll('input'), function (c) { c.disabled = !!adm; });
      if ($('kSekHint')) $('kSekHint').textContent = adm ? 'Administrator ma dostęp do wszystkich modułów — lista zacznie obowiązywać, gdy odbierzesz uprawnienia administratora.' : 'Zmiana modułów zaczyna działać po ponownym zalogowaniu tej osoby (najpóźniej po godzinie).';
    }
    var czesci = [];
    if (K.nowy || !K.p) czesci.push('<b>profil:</b> nowy');
    else if (d.prof.length) czesci.push('<b>profil:</b> ' + esc(d.prof.join(', ')));
    d.acc.forEach(function (a) { var i = a.indexOf(':'); czesci.push('<b>' + esc(a.slice(0, i + 1)) + '</b>' + esc(a.slice(i + 1))); });
    $('kDiff').innerHTML = czesci.length ? 'Po zapisaniu zmieni się — ' + czesci.join(' · ') : 'Brak zmian do zapisania.';
    $('kSave').disabled = !czesci.length;

    // the card's own summary: what follows from the form as it is now
    var kl = klienci(fo.aliasy), o = fo.odpowiada, li = [];
    var s = function (cls, znak, html) { li.push('<li class="s-' + cls + '"><i>' + znak + '</i><span>' + html + '</span></li>'); };
    if (!fo.aktywny) s('brak', '!', 'Osoba nieaktywna — nie dostaje zadań, poczty ani powiadomień.');
    if (fo.aliasy.length) s(kl.opiekun + kl.kadrowy ? 'ok' : 'info', kl.opiekun + kl.kadrowy ? '✓' : 'i', 'Klienci według skrótów (' + esc(fo.aliasy.join(', ')) + '): <b>' + kl.opiekun + '</b> jako opiekun księgowy, <b>' + kl.kadrowy + '</b> jako kadrowy.');
    else s('info', 'i', 'Bez skrótu — portal nie przypisze tej osobie żadnego klienta.');
    if (fo.skrzynki.length) s('ok', '✓', 'Zadania z wiadomości skrzynek: ' + esc(fo.skrzynki.join(', ')) + (kl.opiekun + kl.kadrowy ? ' — dotyczące klientów tej osoby' : '') + '.');
    if (o.domyslny_kadry) s('ok', '✓', 'Zadania kadrowe dopisywane przez portal (terminy ZUS, dokumenty pobytowe, nowe zgłoszenia) i nieprzypisana poczta kadr.');
    if (o.domyslny_ksiegowosc) s('ok', '✓', 'Nieprzypisana poczta księgowości.');
    s(o.sms ? 'ok' : 'info', o.sms ? '✓' : '–', o.sms ? 'Może wysyłać SMS-y do klientów.' : 'Nie wysyła SMS-ów do klientów.');
    if (o.akta) s('ok', '✓', 'Prowadzi akta osobowe.');
    if (o.podpisy_weryfikacja) s('ok', '✓', 'Weryfikuje podpisane dokumenty kadrowe.');
    s(fo.telegram_chat ? 'ok' : 'uwaga', fo.telegram_chat ? '✓' : '!', fo.telegram_chat ? 'Powiadomienia i przypomnienia w Telegramie.' : 'Bez czatu Telegram — zadania zobaczy tylko w portalu.');
    var moduly = K.konto === 'portal' ? (adm ? 'wszystkie moduły (administrator)' : ticked('data-sec').map(function (x) { return label(SECTIONS, x); }).join(', ') || 'żaden moduł')
      : $('kGrant').checked ? (ticked('data-sec').map(function (x) { return label(SECTIONS, x); }).join(', ') || 'żaden moduł') : '';
    s(moduly ? 'ok' : 'uwaga', moduly ? '✓' : '!', moduly ? 'Portal: ' + esc(moduly) + '.' : 'Bez dostępu do portalu — zadania nie mogą być kierowane do tej osoby.');
    if (fo.nieobecny_od || fo.nieobecny_do) {
      var z = fo.zastepca ? byEmail(fo.zastepca) : null;
      s(z ? 'info' : 'uwaga', z ? 'i' : '!', 'Nieobecność ' + (fo.nieobecny_od ? 'od ' + pl(fo.nieobecny_od) : '') + (fo.nieobecny_do ? ' do ' + pl(fo.nieobecny_do) : ' do odwołania') + ' — ' + (z ? 'w tym czasie zastępuje: ' + esc(nazwa(z)) + '.' : 'bez zastępcy, zadania nadal trafiają do tej osoby.'));
    }
    $('kSum').innerHTML = li.join('');
    var zapisany = K.p && K.p.telegram_chat && K.p.telegram_chat === fo.telegram_chat;
    $('kTgTest').disabled = !zapisany;
    $('kTgTest').title = zapisany ? '' : 'Najpierw zapisz kartę z ID czatu.';
  }

  // everything the administrator can change in the card, to tell an untouched card from an edited one
  function stan() { return JSON.stringify([form(), ticked('data-sec'), !!($('kAdmin') && $('kAdmin').checked), !!($('kGrant') && $('kGrant').checked)]); }
  function closeCard(force) {
    if (!K) return;
    if (!force && stan() !== K.start && !confirm('Zamknąć kartę bez zapisywania zmian?')) return;
    K = null; $('karta').hidden = true; $('kartaBody').innerHTML = '';
  }
  function fail(msg) { $('kErr').textContent = msg || ''; }

  async function save() {
    var d = diff(), fo = d.form;
    fail('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fo.email)) return fail('Wpisz poprawny adres e-mail.');
    if (K.nowy && byEmail(fo.email)) return fail('Ta osoba jest już na liście — otwórz jej kartę.');
    if (fo.telegram_chat && !/^-?\d{4,20}$/.test(fo.telegram_chat)) return fail('ID czatu Telegram to same cyfry (grupa — z minusem na początku).');
    if (fo.telegram_username && !/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(fo.telegram_username)) return fail('Nazwa w Telegramie: 4–32 znaki — litery, cyfry i podkreślenie, zaczyna się od litery (np. @anna_testowa).');
    if (fo.nieobecny_od && fo.nieobecny_do && fo.nieobecny_od > fo.nieobecny_do) return fail('Nieobecność: data „od” jest późniejsza niż „do”.');
    var add = d.ops.filter(function (o) { return o.action === 'add'; })[0];
    if (add && K.konto === 'brak' && add.password.length < MIN_PASSWORD) return fail('Hasło startowe musi mieć co najmniej ' + MIN_PASSWORD + ' znaków.');
    var nadaje = d.ops.some(function (o) { return o.action === 'admin' && o.on; });
    if (d.acc.length && !confirm('Zapisać zmiany dostępu: ' + fo.email + '?\n\n' + d.acc.join('\n') + (nadaje ? '\n\nAdministrator może zarządzać zespołem i dostępem wszystkich osób.' : ''))) return;

    $('kSave').disabled = true; $('kCancel').disabled = true;
    var zrobione = [];
    try {
      if (d.zapis) { await call({ action: 'profile_save', nowy: !K.p, profile: fo }); zrobione.push('profil'); }
      for (var i = 0; i < d.ops.length; i++) {
        var out = await call(d.ops[i]);
        zrobione.push(d.ops[i].action === 'add' ? (out.existed ? 'dostęp (konto już istniało, hasło bez zmian)' : 'nowe konto — przekaż hasło tej osobie') : d.acc[i] || 'dostęp');
      }
      closeCard(true);
      show('Zapisano: ' + (fo.imie_nazwisko || fo.email) + ' — ' + zrobione.join('; ') + '.', 'success');
      await load();
    } catch (e) {
      // part of it may already be stored: show the fresh state and say what is missing
      var msg = (zrobione.length ? 'Zapisano: ' + zrobione.join('; ') + '. Nie udało się dokończyć: ' : 'Błąd: ') + e.message;
      if (zrobione.length) { await load(); var x = byEmail(fo.email); if (x) openCard(x); }
      if (K) { fail(msg); $('kCancel').disabled = false; refresh(); } else show(msg, 'error');
    }
  }

  // the account actions the "Dostęp do portalu" page has — they act at once
  async function account(action, btn) {
    var u = K.u, body = { action: action, id: u.id };
    if (action === 'revoke' && !confirm('Odebrać dostęp do portalu: ' + u.email + '? Profil zostanie.')) return;
    if (action === 'password') {
      var p = prompt('Nowe hasło dla ' + u.email + ' (min. ' + MIN_PASSWORD + ' znaków):');
      if (p == null) return;
      if (p.length < MIN_PASSWORD) return fail('Hasło musi mieć co najmniej ' + MIN_PASSWORD + ' znaków.');
      body.password = p;
    }
    btn.disabled = true; fail('');
    try {
      await call(body);
      var email = K.x.email;
      closeCard(true);
      show((action === 'revoke' ? 'Odebrano dostęp: ' : 'Zmieniono hasło: ') + u.email, 'success');
      await load();
      if (action === 'password' && byEmail(email)) openCard(byEmail(email));
    } catch (e) { fail('Błąd: ' + e.message); btn.disabled = false; }
  }

  function opis(h) {
    var z = h.zmiany || {};
    if (h.op === 'dostep') {
      var c = [];
      if (z.portal === true) c.push(z.konto === 'nowe' ? 'utworzono konto z dostępem' : 'nadano dostęp do portalu');
      if (z.portal === false) c.push('odebrano dostęp do portalu');
      if (Array.isArray(z.sekcje)) c.push('moduły: ' + (z.sekcje.map(function (s) { return label(SECTIONS, s); }).join(', ') || 'żaden'));
      if (typeof z.administrator === 'boolean') c.push(z.administrator ? 'nadano uprawnienia administratora' : 'odebrano uprawnienia administratora');
      return 'dostęp — ' + c.join('; ');
    }
    if (h.op === 'dodano') return 'utworzono profil';
    if (h.op === 'usunieto') return 'usunięto profil';
    return 'zmieniono: ' + Object.keys(z).map(function (k) { return POLA[k] || k; }).join(', ');
  }

  $('karta').addEventListener('change', function (e) {
    if (!K) return;
    if (e.target.matches('[data-dzial]') && e.target.checked) preset([e.target.getAttribute('data-dzial')]);
    if (e.target.id === 'kGrant' && e.target.checked && !ticked('data-sec').length) preset(ticked('data-dzial'));
    refresh();
  });
  $('karta').addEventListener('input', function () { if (K) refresh(); });
  $('karta').addEventListener('toggle', async function (e) {
    if (!K || e.target.id !== 'kHist' || !e.target.open || e.target.dataset.done) return;
    e.target.dataset.done = '1';
    try {
      var h = (await call({ action: 'profile_history', email: K.x.email })).historia || [];
      e.target.innerHTML = '<summary>Historia zmian profilu i dostępu</summary>' + (h.length ? h.map(function (r) {
        return '<div>' + esc(fmt(r.at)) + ' · ' + esc(r.kto || '—') + ' · ' + esc(opis(r)) + '</div>';
      }).join('') : '<div class="sub">Brak zapisanych zmian.</div>');
    } catch (err) { e.target.innerHTML = '<summary>Historia zmian profilu i dostępu</summary><div class="sub">' + esc(err.message) + '</div>'; }
  }, true);
  $('karta').addEventListener('click', async function (e) {
    if (!K) return;
    if (e.target === $('karta') || e.target.id === 'kX' || e.target.id === 'kCancel') return closeCard(false);
    if (e.target.id === 'kSave') return save();
    var act = e.target.closest('[data-act]');
    if (act) return account(act.getAttribute('data-act'), act);
    if (e.target.id === 'kDel') {
      if (!confirm('Usunąć profil: ' + nazwa(K.x) + '?\n\nKonto i dostęp do portalu zostają bez zmian — usuwane są tylko dane profilu.')) return;
      try { await call({ action: 'profile_delete', email: K.x.email }); var n = nazwa(K.x); closeCard(true); show('Usunięto profil: ' + n + '.', 'success'); await load(); }
      catch (err) { fail('Błąd: ' + err.message); }
      return;
    }
    if (e.target.id === 'kTgTest') {
      if (!confirm('Wysłać wiadomość testową w Telegramie do: ' + nazwa(K.x) + '?')) return;
      e.target.disabled = true; $('kTgMsg').textContent = 'Wysyłam…';
      try { var out = await post(ZADANIA_FN, { action: 'test', email: K.x.email }); $('kTgMsg').textContent = out.error || 'Wiadomość testowa wysłana — sprawdź Telegram.'; }
      catch (err) { $('kTgMsg').textContent = err.message; }
      e.target.disabled = false;
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && K) closeCard(false); });

  $('tiles').addEventListener('click', function (e) {
    var b = e.target.closest('[data-w]'); if (!b) return;
    if (b.getAttribute('data-w') === 'spojnosc') return $('spojnosc').scrollIntoView({ behavior: 'smooth' });
    f.widok = b.getAttribute('data-w'); render();
  });
  $('fQ').addEventListener('input', function () { f.q = this.value; render(); });
  $('fDzial').addEventListener('change', function () { f.dzial = this.value; render(); });
  $('addBtn').addEventListener('click', function () { openCard(null); });
  $('tbl').addEventListener('click', function (e) { var r = e.target.closest('tr.kl'); if (r) openCard(byEmail(r.getAttribute('data-email'))); });
  $('tbl').addEventListener('keydown', function (e) { var r = e.target.closest('tr.kl'); if (r && e.key === 'Enter') openCard(byEmail(r.getAttribute('data-email'))); });
  $('issues').addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]'), n = e.target.closest('[data-nowy]');
    if (o) openCard(byEmail(o.getAttribute('data-open')));
    if (n) openCard(null, render.issues[+n.getAttribute('data-nowy')].nowy);
  });

  async function load() {
    try {
      D = await call({ action: 'team' });
      me = D.me;
      build();
      $('adminUi').hidden = false;
      $('warn').innerHTML = (D.tabela ? '' : '<div class="warnbox">Tabela profili nie istnieje jeszcze w bazie (migracja portal_pracownicy) — widać tylko konta portalu, profili nie da się zapisać.</div>') +
        (D.klienci ? '' : '<div class="warnbox">Nie udało się odczytać bazy klientów — podpowiedzi skrótów są niedostępne.</div>');
      render();
    } catch (e) {
      $('adminUi').hidden = true;
      show(e.status === 403 ? 'Ta strona jest dostępna tylko dla administratora portalu.' : 'Błąd: ' + e.message, 'error');
    }
  }
  if (window.sb) load();
})();
