/* Baza klientów: the office's register of clients and the master of the clients list (administrators
   add and edit clients here; every change is recorded) — who is served and since when, what the
   registers (KRS, CEIDG, REGON, MF's VAT register) say about each firm, and the contracts with an audit of what is missing.
   Everything comes from the `klienci-baza` edge function (one `lista` call); the function alone
   changes the service status and reads the registers. Contract scans are handled like the personnel
   files (akta.js): the file goes to the private bucket klienci-umowy, a row to klienci_umowy, the
   function reads it; a match on the number and the name is filed at once, the rest wait in
   "Do sprawdzenia". What the machine filed counts in the audit only after a person confirms it.
   Contracts, the audit and the status history exist only for portal administrators.
   A client's Telegram group is created in the windows of telegram-grupa.js (window.TgGrupa), opened from
   the client's card and from the list; this file only offers the buttons and reloads afterwards. */
(function () {
  'use strict';
  var BASE = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/';
  var FN = BASE + 'klienci-baza', FIRMA = BASE + 'firma';
  var T = 'klienci_umowy', BUCKET = 'klienci-umowy', MAX = 24 * 1024 * 1024, LS = 'tdcg_klienci_filtry';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function zl(n) { return Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'; }
  function dzis() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function low(s) { return String(s == null ? '' : s).toLowerCase(); }

  var STATUS = { obslugiwany: ['obsługiwany', 'p-ok'], wstrzymany: ['wstrzymany', 'p-amber'], zakonczony: ['obsługa zakończona', 'p-grey'] };
  var UST = { nowy: ['czeka na odczyt', 'p-grey'], analiza: ['odczytuję…', 'p-navy'], przypisany: ['przypisany', 'p-ok'], do_sprawdzenia: ['do sprawdzenia', 'p-amber'], blad: ['błąd odczytu', 'p-red'] };
  var RODZAJ = { ksiegowosc: 'Umowa o usługi księgowe', kadry: 'Umowa o obsługę kadrowo-płacową', powierzenie: 'Umowa powierzenia przetwarzania danych (art. 28 RODO)', aneks: 'Aneks',
    pelnomocnictwo: 'Pełnomocnictwo (UPL-1, ZUS PEL, ogólne)', upowaznienie: 'Upoważnienie do e-Urzędu / KSeF', wypowiedzenie: 'Wypowiedzenie / rozwiązanie umowy', inne: 'Inny dokument' };
  var PODPISY = { '': '— nie oceniono —', obie_strony: 'obie strony', tylko_klient: 'tylko klient', tylko_biuro: 'tylko biuro', brak: 'brak podpisów', nieczytelne: 'nie da się ocenić' };
  var OB = { ksiegowosc: 'księgowość', kadry: 'kadry', powierzenie: 'powierzenie danych' };
  var IKONA = { ok: '✓', uwaga: '!', brak: '✕', info: 'i' };

  var klienci = [], umowy = [], ja = { admin: false }, adm = null, cena = 0.05, wczytano = false, blad = '';
  var f = { q: '', status: 'czynni', opiekun: '', forma: '', zakres: '', umowy: '', rejestr: '', telegram: '', sort: 'nazwa', dir: 1, tab: 'klienci', utab: 'spr' };
  try { var z = JSON.parse(localStorage.getItem(LS) || '{}'); Object.keys(f).forEach(function (k) { if (typeof z[k] === typeof f[k]) f[k] = z[k]; }); } catch (e) {}
  function zapamietaj() { try { localStorage.setItem(LS, JSON.stringify(f)); } catch (e) {} }
  var otwarta = null; // id of the client whose card is open

  async function token() { var s = await window.sb.auth.getSession(); return s && s.data && s.data.session ? s.data.session.access_token : ''; }
  async function api(action, body) {
    var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() }, body: JSON.stringify(Object.assign({ action: action }, body || {})) });
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok && !j.error) j.error = 'Błąd ' + res.status;
    return j;
  }
  function klient(id) { return klienci.filter(function (k) { return k.id === id; })[0] || null; }
  function umowyKlienta(id) { return umowy.filter(function (u) { return u.klient === id && u.status === 'przypisany'; }); }
  // filed and confirmed by a person; everything else waits for somebody to look at it
  function gotowy(u) { return u.status === 'przypisany' && !!u.sprawdzil; }

  // ---------------- load ----------------
  var kolejka = null;
  async function wczytaj() {
    var r = await api('lista');
    if (r.error || !Array.isArray(r.klienci)) { blad = r.error || 'Nie udało się wczytać bazy klientów.'; wczytano = true; rysuj(); return; }
    blad = (r.sync && r.sync.blad) || '';
    klienci = r.klienci; umowy = r.umowy || []; ja = r.ja || { admin: false }; adm = r.admin || null; cena = r.cena || cena; wczytano = true;
    rysuj();
  }
  // several things finishing at once (the upload queue) ask for one reload
  function odswiezPozniej() { clearTimeout(kolejka); kolejka = setTimeout(wczytaj, 500); }

  // ---------------- client list ----------------
  function ostrz(k) { return (k.ostrzezenia || []).length; }
  // scope of service, from the caretakers in the clients sheet: 'oba' | 'ks' (accounting only) | 'kd' (HR only) | 'brak'
  function zakres(k) {
    var ks = typeof k.ksiegowosc === 'boolean' ? k.ksiegowosc : !!(k.opiekun || '').trim(), kd = typeof k.kadry === 'boolean' ? k.kadry : !!(k.kadrowy || '').trim();
    return ks && kd ? 'oba' : ks ? 'ks' : kd ? 'kd' : 'brak';
  }
  var ZAKRES = { oba: 'księgowość + kadry', ks: 'tylko księgowość', kd: 'tylko kadry', brak: 'brak opiekunów' };
  // Telegram group of the client: everybody sees the status, administrators the details
  function tgPill(k) {
    if (!k.tg) return '';
    var s = k.tg.status;
    return '<span class="pill ' + (s === 'ok' ? 'p-ok' : s === null ? 'p-grey' : s === 'brak_grupy' || s === 'brak_bota' ? 'p-amber' : 'p-red') + '">' + esc(s === 'ok' ? 'OK' : k.tg.opis) + '</span>';
  }
  function tgProblem(k) { return !!(k.tg && k.tg.status && k.tg.status !== 'ok'); }
  // a group can be created from the portal (administrators) for a client in service that has none
  function mozeGrupe(k) { return !!(ja.admin && window.TgGrupa && k.tg && k.tg.status === 'brak_grupy' && k.w_arkuszu); }
  function nowaGrupa(k) {
    window.TgGrupa.otworz({ id: k.id, nazwa: k.nazwa, nip: k.nip }, { po: async function () {
      // the group exists and its chat id is in the client's data: read it back and let the audit look at it
      await api('telegram_sprawdz', { id: k.id }); await wczytaj();
    } });
  }
  function zakresPill(k) { var z = zakres(k); return '<span class="pill ' + (z === 'brak' ? 'p-amber' : 'p-navy') + '">' + ZAKRES[z] + '</span>'; }
  function pasuje(k) {
    if (f.status === 'czynni' ? k.status === 'zakonczony' : f.status !== 'wszyscy' && k.status !== f.status) return false;
    if (f.opiekun && (k.opiekun || '—') !== f.opiekun) return false;
    if (f.forma && (k.forma || '—') !== f.forma) return false;
    if (f.zakres && zakres(k) !== f.zakres) return false;
    if (f.rejestr === 'ostrz' && !ostrz(k)) return false;
    if (f.rejestr === 'brak' && k.rej) return false;
    if (f.rejestr === 'zmiany' && !(k.rej && (k.rej.zmiany || []).length)) return false;
    if (f.telegram) {
      var ts = k.tg ? k.tg.status : undefined;
      if (ts === undefined) return false; // service ended: its group is not checked
      if (f.telegram === 'problem' ? !(ts && ts !== 'ok') : f.telegram === 'nie' ? ts !== null : ts !== f.telegram) return false;
    }
    if (f.umowy && ja.admin) {
      var a = k.audyt || { ma: {}, wynik: '' };
      if (f.umowy === 'braki' || f.umowy === 'uwagi' || f.umowy === 'ok') { if (a.wynik !== f.umowy) return false; }
      // a client nobody looks after has no defined scope: it is a warning of its own, not a missing contract
      else if (zakres(k) === 'brak') return false;
      else if (f.umowy === 'bez_umowy' && a.ma.umowa) return false;
      else if (f.umowy === 'bez_powierzenia' && a.ma.powierzenie) return false;
      else if (f.umowy === 'bez_pelnomocnictw' && a.ma.pelnomocnictwo) return false;
    }
    if (f.q) {
      var r = k.rej || {};
      var os = (r.zarzad || []).concat(r.wspolnicy || []).map(function (p) { return p.imie + ' ' + p.nazwisko; }).join(' ');
      if (low([k.nazwa, k.nip, k.miasto, k.adres, k.opiekun, k.kadrowy, r.nazwa, r.krs, r.regon, os].join(' ')).indexOf(low(f.q).trim()) === -1) return false;
    }
    return true;
  }
  function statusPill(k) {
    var s = STATUS[k.status] || [k.status, 'p-grey'];
    return '<span class="pill ' + s[1] + '">' + esc(s[0]) + (k.status === 'zakonczony' && k.koniec_od ? ' od ' + pl(k.koniec_od) : '') + '</span>';
  }
  // where a firm's register data came from: KRS, or — for a sole trader — CEIDG, REGON (GUS) or MF's VAT register
  var ZRODLA = { krs: ['KRS', 'KRS (rejestr.io)'], ceidg: ['CEIDG', 'CEIDG'], gus: ['REGON', 'GUS (REGON)'], mf: ['Wykaz VAT', 'Wykaz VAT (MF) — dane podstawowe'] };
  function zrodlo(r, dlugie) { return (ZRODLA[r && r.zrodlo] || ZRODLA.gus)[dlugie ? 1 : 0]; }
  function rejPill(k) {
    var r = k.rej, o = ostrz(k);
    if (!r) return o && k.status !== 'zakonczony' ? '<span class="pill p-amber">ostrzeżenia: ' + o + '</span><small>dane nie pobrane</small>' : '<span class="pill p-grey">nie pobrano</span>';
    return '<span class="pill ' + (o ? 'p-amber' : 'p-ok') + '">' + (o ? 'ostrzeżenia: ' + o : zrodlo(r) + ' — bez uwag') + '</span><small>' + (r.znaleziono ? (r.krs ? 'KRS ' + esc(r.krs) + ' · ' : '') + 'stan na ' + pl(r.sprawdzono_at) : 'nie znaleziono') + '</small>';
  }
  function umPills(k) {
    var a = k.audyt; if (!a) return '';
    if (k.status === 'zakonczony') return '<span class="pill p-grey">dokumentów: ' + umowyKlienta(k.id).length + '</span>';
    var z = zakres(k);
    if (z === 'brak') return '<span class="pill p-amber">zakres nieokreślony</span>';
    // a contract is expected only for what the office does for this client
    var jedna = function (jest, co) { return '<span class="pill ' + (jest ? 'p-ok' : 'p-red') + '">' + (jest ? 'umowa: ' : 'brak umowy: ') + co + '</span>'; };
    return (z !== 'kd' ? jedna(a.ma.ksiegowosc, 'księgowość') : '') + (z !== 'ks' ? jedna(a.ma.kadry, 'kadry') : '') +
      '<span class="pill ' + (a.ma.powierzenie ? 'p-ok' : 'p-red') + '">' + (a.ma.powierzenie ? 'powierzenie' : 'brak powierzenia') + '</span>' +
      (a.ma.pelnomocnictwo ? '<span class="pill p-ok">pełnomocnictwa</span>' : '') +
      (a.wynik === 'uwagi' ? '<span class="pill p-amber">do sprawdzenia</span>' : '');
  }
  function kolumna(k) {
    if (f.sort === 'status') return k.status + low(k.nazwa);
    if (f.sort === 'forma') return low(k.forma) + low(k.nazwa);
    if (f.sort === 'opiekun') return low(k.opiekun) + low(k.nazwa);
    return low(k.nazwa);
  }
  function rysujKafelki() {
    var n = { obs: 0, wstrz: 0, zak: 0, bezU: 0, bezP: 0, ostrz: 0, spr: 0, nikt: 0, tg: 0 };
    klienci.forEach(function (k) {
      if (k.status === 'obslugiwany') n.obs++; else if (k.status === 'wstrzymany') n.wstrz++; else n.zak++;
      if (k.status !== 'zakonczony') { if (ostrz(k)) n.ostrz++; if (tgProblem(k)) n.tg++; if (zakres(k) === 'brak') n.nikt++; else if (k.audyt) { if (!k.audyt.ma.umowa) n.bezU++; if (!k.audyt.ma.powierzenie) n.bezP++; } }
    });
    n.spr = umowy.filter(function (u) { return !gotowy(u); }).length;
    var na = function (st, um, rj, zk, tg) { return f.tab === 'klienci' && f.status === st && f.umowy === um && f.rejestr === rj && f.zakres === (zk || '') && f.telegram === (tg || ''); };
    var t = [
      ['obs', n.obs, 'Obsługiwani', 'green', na('obslugiwany', '', '')], ['wstrz', n.wstrz, 'Wstrzymani', 'amber', na('wstrzymany', '', '')], ['zak', n.zak, 'Obsługa zakończona', '', na('zakonczony', '', '')],
    ];
    if (ja.admin) t.push(['bezU', n.bezU, 'Bez umowy', 'red', na('czynni', 'bez_umowy', '')], ['bezP', n.bezP, 'Bez powierzenia danych', 'red', na('czynni', 'bez_powierzenia', '')]);
    t.push(['ostrz', n.ostrz, 'Ostrzeżenia z rejestru', 'amber', na('czynni', '', 'ostrz')]);
    t.push(['tg', n.tg, 'Telegram — problemy', 'amber', na('czynni', '', '', '', 'problem')]);
    if (n.nikt) t.push(['nikt', n.nikt, 'Bez opiekuna i kadrowej', 'amber', na('czynni', '', '', 'brak')]);
    if (ja.admin) t.push(['spr', n.spr, 'Dokumenty do sprawdzenia', 'amber', f.tab === 'umowy']);
    $('tiles').innerHTML = t.map(function (x) {
      return '<button type="button" class="tile ' + (x[1] ? x[3] : 'zero') + (x[4] ? ' on' : '') + '" data-tile="' + x[0] + '"><b>' + x[1] + '</b><span>' + x[2] + '</span></button>';
    }).join('');
  }
  function opcje(el, lista, wartosc) {
    el.innerHTML = lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === wartosc ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function rysujFiltry() {
    var uniq = function (fn) { var s = {}; klienci.forEach(function (k) { s[fn(k) || '—'] = 1; }); return Object.keys(s).sort(function (a, b) { return (a === '—') - (b === '—') || a.localeCompare(b, 'pl'); }); };
    opcje($('fStatus'), [['czynni', 'obsługiwani i wstrzymani'], ['obslugiwany', 'obsługiwani'], ['wstrzymany', 'wstrzymani'], ['zakonczony', 'obsługa zakończona'], ['wszyscy', 'wszyscy']], f.status);
    opcje($('fOpiekun'), [['', 'wszyscy']].concat(uniq(function (k) { return k.opiekun; }).map(function (o) { return [o, o]; })), f.opiekun);
    opcje($('fForma'), [['', 'wszystkie']].concat(uniq(function (k) { return k.forma; }).map(function (o) { return [o, o]; })), f.forma);
    opcje($('fZakres'), [['', 'wszystkie'], ['oba', 'księgowość + kadry'], ['ks', 'tylko księgowość'], ['kd', 'tylko kadry'], ['brak', 'brak opiekunów']], f.zakres);
    opcje($('fUmowy'), [['', 'wszystkie'], ['braki', 'są braki'], ['uwagi', 'do sprawdzenia'], ['ok', 'w porządku'], ['bez_umowy', 'bez obowiązującej umowy'], ['bez_powierzenia', 'bez powierzenia danych'], ['bez_pelnomocnictw', 'bez pełnomocnictw']], f.umowy);
    opcje($('fRejestr'), [['', 'wszystkie'], ['ostrz', 'z ostrzeżeniami'], ['zmiany', 'zmiana od poprzedniego pobrania'], ['brak', 'dane nie pobrane']], f.rejestr);
    opcje($('fTelegram'), [['', 'wszystkie'], ['problem', 'z problemem'], ['ok', 'w porządku'], ['brak_grupy', 'brak grupy'], ['bot_usuniety', 'bot usunięty z grupy'], ['brak_bota', 'brakuje wymaganego bota'], ['nie', 'nie sprawdzono']], f.telegram);
    $('fUmowyBox').hidden = !ja.admin;
    if ($('fQ').value !== f.q && document.activeElement !== $('fQ')) $('fQ').value = f.q;
    $('tools').innerHTML = ja.admin ? '<button type="button" class="mini ok" id="klNowy">Dodaj klienta</button><button type="button" class="mini" id="rejAll">Pobierz dane z rejestrów…</button><button type="button" class="mini" id="tgOtw">Telegram — kontrola grup…</button>' + (window.TgGrupa ? '<button type="button" class="mini" id="tgSzablon">Szablon grupy Telegram…</button>' : '') : '';
  }
  function rysujListe() {
    var l = klienci.filter(pasuje).sort(function (a, b) { return kolumna(a).localeCompare(kolumna(b), 'pl') * f.dir; });
    var strz = function (c) { return f.sort === c ? (f.dir > 0 ? ' ▲' : ' ▼') : ''; };
    $('tbl').querySelector('thead').innerHTML = '<tr><th data-sort="nazwa">Klient' + strz('nazwa') + '</th><th class="c-forma" data-sort="forma">Forma' + strz('forma') + '</th><th class="c-opiekun" data-sort="opiekun">Opiekun' + strz('opiekun') + '</th><th data-sort="status">Obsługa' + strz('status') + '</th><th>Rejestr</th><th class="c-tg">Telegram</th>' + (ja.admin ? '<th>Umowy</th>' : '') + '</tr>';
    var cols = ja.admin ? 7 : 6;
    $('tbl').querySelector('tbody').innerHTML = !wczytano ? '<tr><td class="empty" colspan="' + cols + '">Ładowanie…</td></tr>'
      : !klienci.length ? '<tr><td class="empty" colspan="' + cols + '">' + esc(blad || 'Brak klientów w bazie.') + '</td></tr>'
      : !l.length ? '<tr><td class="empty" colspan="' + cols + '">Żaden klient nie pasuje do filtrów.</td></tr>'
      : l.map(function (k) {
        return '<tr class="kl" data-k="' + klienci.indexOf(k) + '" tabindex="0"><td class="kn"><b>' + esc(k.nazwa) + '</b><small>' + (k.nip ? 'NIP ' + esc(k.nip) : 'brak NIP') + (k.miasto ? ' · ' + esc(k.miasto) : '') + '</small>' +
          (!k.w_arkuszu ? '<small class="warn">usunięty z listy klientów ' + pl(k.brak_od) + '</small>' : '') + '</td>' +
          '<td class="c-forma">' + esc(k.forma || '—') + '</td><td class="c-opiekun">' + esc(k.opiekun || '—') + (k.kadrowy ? '<small>kadry: ' + esc(k.kadrowy) + '</small>' : '') + '</td>' +
          '<td>' + statusPill(k) + (k.status !== 'zakonczony' ? zakresPill(k) : '') + '</td><td>' + rejPill(k) + '</td><td class="c-tg">' + tgPill(k) + (mozeGrupe(k) ? '<button type="button" class="mini" data-tgn="' + klienci.indexOf(k) + '">Utwórz…</button>' : '') + '</td>' + (ja.admin ? '<td>' + umPills(k) + '</td>' : '') + '</tr>';
      }).join('');
    $('count').textContent = wczytano && klienci.length ? 'Pokazano ' + l.length + ' z ' + klienci.length + ' klientów' + (blad ? ' · ' + blad : '') : '';
  }

  // ---------------- contracts tab ----------------
  function opisUmowy(u) {
    var ob = (u.obejmuje || []).filter(function (o) { return o !== u.rodzaj; }).map(function (o) { return OB[o] || o; });
    return [u.data_zawarcia && 'z dnia ' + pl(u.data_zawarcia), u.bezterminowa ? 'na czas nieokreślony' : u.obowiazuje_do && 'do ' + pl(u.obowiazuje_do), ob.length && 'obejmuje: ' + ob.join(', '), u.stron && u.stron + ' str.'].filter(Boolean).join(' · ');
  }
  function docRow(u, zKlientem) {
    var st = u.status === 'przypisany' && !u.sprawdzil ? ['odczyt automatyczny — niepotwierdzony', 'p-amber'] : UST[u.status] || [u.status, 'p-grey'], k = u.klient ? klient(u.klient) : null;
    var tytul = u.rodzaj ? (RODZAJ[u.rodzaj] || u.rodzaj) + (u.podtyp ? ' — ' + u.podtyp : '') : u.nazwa;
    return '<div class="doc" data-u="' + esc(u.id) + '"><div class="n"><b>' + esc(tytul) + '</b>' +
      (zKlientem ? '<small>' + esc(k ? k.nazwa : u.kontrahent ? 'według dokumentu: ' + u.kontrahent + (u.kontrahent_nip ? ' (NIP ' + u.kontrahent_nip + ')' : '') : 'klient nierozpoznany') + '</small>' : '') +
      '<small>' + esc([opisUmowy(u), 'plik: ' + u.nazwa, 'wgrano ' + pl(u.created_at)].filter(Boolean).join(' · ')) + '</small>' +
      (u.uwagi ? '<small class="warn">Uwaga: ' + esc(u.uwagi) + '</small>' : '') + '</div>' +
      '<div class="acts"><span class="pill ' + st[1] + '">' + st[0] + '</span><button type="button" class="mini" data-a="view">Zobacz</button>' +
      '<button type="button" class="mini' + (gotowy(u) ? '' : ' ok') + '" data-a="edit">' + (gotowy(u) ? 'Zmień' : u.status === 'przypisany' ? 'Sprawdź i potwierdź' : 'Przypisz') + '</button>' +
      (u.status !== 'analiza' ? '<button type="button" class="mini" data-a="again">Odczytaj ponownie</button>' : '') +
      '<button type="button" class="mini del" data-a="del">Usuń</button></div></div>';
  }
  function rysujUmowy() {
    var spr = umowy.filter(function (u) { return !gotowy(u); });
    $('utabs').innerHTML = [['spr', 'Do sprawdzenia', spr.length], ['all', 'Wszystkie dokumenty', umowy.length]].map(function (t) {
      return '<button type="button" data-ut="' + t[0] + '" class="' + (f.utab === t[0] ? 'on' : '') + '">' + t[1] + '<b>' + t[2] + '</b></button>';
    }).join('');
    var l = f.utab === 'spr' ? spr : umowy;
    $('ulist').innerHTML = l.length ? l.slice(0, 400).map(function (u) { return docRow(u, true); }).join('')
      : '<div class="empty">' + (f.utab === 'spr' ? 'Nic nie czeka na sprawdzenie.' : 'Nie ma jeszcze żadnych dokumentów.') + '</div>';
    var h = $('hintKl'), v = h.value;
    h.innerHTML = '<option value="">— rozpoznaj automatycznie —</option>' + klienci.slice().sort(function (a, b) { return a.nazwa.localeCompare(b.nazwa, 'pl'); }).map(function (k) { return '<option value="' + esc(k.id) + '">' + esc(k.nazwa) + (k.nip ? ' (' + esc(k.nip) + ')' : '') + '</option>'; }).join('');
    h.value = v;
  }

  // ---------------- audit tab ----------------
  function znak(b) { return b ? '<span class="pill p-ok">jest</span>' : '<span class="pill p-red">brak</span>'; }
  var ND = '<span class="pill p-grey">nie dotyczy</span>';
  // outside the scope of service a missing contract is not a gap; one that exists there is worth a look
  function wZakresie(w, jest) { return w ? znak(jest) : jest ? '<span class="pill p-amber">jest, poza zakresem</span>' : ND; }
  function rysujAudyt() {
    var czynni = klienci.filter(function (k) { return k.status !== 'zakonczony' && k.audyt; });
    var l = czynni.filter(function (k) { return k.audyt.wynik !== 'ok'; }).sort(function (a, b) { return (a.audyt.wynik === 'braki' ? 0 : 1) - (b.audyt.wynik === 'braki' ? 0 : 1) || a.nazwa.localeCompare(b.nazwa, 'pl'); });
    $('acount').textContent = czynni.length ? 'Z uwagami: ' + l.length + ' z ' + czynni.length + ' klientów · w porządku: ' + (czynni.length - l.length) : '';
    $('atbl').innerHTML = '<thead><tr><th>Klient</th><th>Zakres obsługi</th><th>Umowa: księgowość</th><th>Umowa: kadry</th><th>Powierzenie</th><th>Pełnomocnictwa</th><th>Telegram</th><th>Braki i uwagi</th></tr></thead><tbody>' +
      (l.length ? l.map(function (k) {
        var a = k.audyt, braki = a.pozycje.filter(function (p) { return p.stan === 'brak' || p.stan === 'uwaga'; }), z = zakres(k), nikt = z === 'brak';
        return '<tr class="kl" data-k="' + klienci.indexOf(k) + '" tabindex="0"><td class="kn"><b>' + esc(k.nazwa) + '</b><small>' + (k.nip ? 'NIP ' + esc(k.nip) : 'brak NIP') + (k.opiekun ? ' · ' + esc(k.opiekun) : '') + '</small></td>' +
          '<td>' + zakresPill(k) + '</td><td>' + wZakresie(z !== 'kd' && !nikt, a.ma.ksiegowosc) + '</td><td>' + wZakresie(z !== 'ks' && !nikt, a.ma.kadry) + '</td><td>' + (nikt ? ND : znak(a.ma.powierzenie)) + '</td><td>' + (nikt ? ND : a.ma.pelnomocnictwo ? znak(true) : '<span class="pill p-amber">brak w bazie</span>') + '</td><td>' + tgPill(k) + '</td>' +
          '<td>' + braki.map(function (p) { return '<small' + (p.stan === 'brak' ? ' class="warn"' : '') + '>' + (p.stan === 'brak' ? '✕ ' : '! ') + esc(p.tekst) + '</small>'; }).join('') + '</td></tr>';
      }).join('') : '<tr><td class="empty" colspan="8">' + (czynni.length ? 'Brak uwag — wszyscy obsługiwani klienci mają komplet dokumentów.' : 'Brak klientów.') + '</td></tr>') + '</tbody>';
    var zak = klienci.filter(function (k) { return k.status === 'zakonczony'; }).sort(function (a, b) { return String(b.koniec_od).localeCompare(String(a.koniec_od)); });
    $('ztbl').innerHTML = '<thead><tr><th>Klient</th><th>Koniec obsługi</th><th>Powód</th><th>Dokumenty w bazie</th></tr></thead><tbody>' +
      (zak.length ? zak.map(function (k) {
        var d = umowyKlienta(k.id), h = (k.historia || [])[0];
        return '<tr class="kl" data-k="' + klienci.indexOf(k) + '" tabindex="0"><td class="kn"><b>' + esc(k.nazwa) + '</b><small>' + (k.nip ? 'NIP ' + esc(k.nip) : 'brak NIP') + '</small></td><td>' + pl(k.koniec_od) + '</td><td>' + esc(h && h.powod || '—') + '</td>' +
          '<td>' + d.length + (d.some(function (u) { return u.rodzaj === 'wypowiedzenie'; }) ? '' : '<small>brak wypowiedzenia / porozumienia w bazie</small>') + '</td></tr>';
      }).join('') : '<tr><td class="empty" colspan="4">Nie ma klientów z zakończoną obsługą.</td></tr>') + '</tbody>';
  }

  function rysuj() {
    if (!ja.admin) f.tab = 'klienci'; // the other tabs exist only for administrators (also before the list has loaded)
    rysujKafelki();
    var tabs = [['klienci', 'Klienci', klienci.length]];
    if (ja.admin) tabs.push(['umowy', 'Umowy i pełnomocnictwa', umowy.length], ['audyt', 'Audyt — braki', klienci.filter(function (k) { return k.status !== 'zakonczony' && k.audyt && k.audyt.wynik !== 'ok'; }).length]);
    $('tabs').innerHTML = tabs.map(function (t) { return '<button type="button" data-t="' + t[0] + '" class="' + (f.tab === t[0] ? 'on' : '') + '">' + t[1] + '<b>' + t[2] + '</b></button>'; }).join('');
    ['klienci', 'umowy', 'audyt'].forEach(function (t) { $('t-' + t).hidden = f.tab !== t; });
    rysujFiltry(); rysujListe();
    if (ja.admin) { rysujUmowy(); rysujAudyt(); }
    if (otwarta) rysujKarte();
  }

  // ---------------- client card ----------------
  function dl(pary) {
    var w = pary.filter(function (p) { return p[1] != null && p[1] !== ''; });
    return w.length ? '<dl class="kv">' + w.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : esc(p[1])) + '</dd>'; }).join('') + '</dl>' : '';
  }
  function osoby(tytul, lista, kol) {
    if (!lista || !lista.length) return '';
    return '<table><thead><tr><th>' + tytul + '</th><th>' + kol[0] + '</th></tr></thead><tbody>' + lista.map(function (p) {
      return '<tr><td>' + esc(p.imie_nazwisko || [p.imie, p.nazwisko].filter(Boolean).join(' ')) + '</td><td>' + esc(kol[1](p)) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function zmianyHtml(zm) {
    return '<ul class="chk">' + zm.map(function (z) { return '<li class="s-uwaga"><i>!</i><span><b>' + esc(z.pole) + '</b>: ' + esc(z.bylo) + ' → ' + esc(z.jest) + '</span></li>'; }).join('') + '</ul>';
  }
  function rysujKarte() {
    var k = klient(otwarta);
    if (!k) { $('karta').hidden = true; otwarta = null; return; }
    var r = k.rej, a = k.audyt, h = '';
    h += '<div class="head"><div><h3>' + esc(k.nazwa) + '</h3><div class="acts">' + statusPill(k) + '<span class="sub">' + (k.nip ? 'NIP ' + esc(k.nip) : 'brak NIP') + '</span></div></div><button type="button" class="x" data-c="close" aria-label="Zamknij">×</button></div>';

    h += '<h4>Dane klienta</h4>' + (k.w_arkuszu ? '' : '<p class="hint warn">Ten klient został usunięty z listy klientów (' + pl(k.brak_od) + '). Poniżej ostatnie znane dane.</p>');
    var kt = k.kontakt || {};
    h += dl([['Forma prawna', k.forma], ['Opodatkowanie', k.opodatkowanie], ['Adres', [k.adres, k.miasto].filter(Boolean).join(', ')], ['Opiekun księgowy', k.opiekun], ['Kadrowy', k.kadrowy],
      ['Osoba kontaktowa', kt.kontakt], ['Telefon', kt.telefon], ['E-mail', kt.email], ['Język', kt.jezyk]]) || '<p class="hint">Brak danych.</p>';
    // one click to the SMS page with this client chosen (the number is read there from the base)
    var smsLink = /^\d{10}$/.test(k.nip || '') && k.status !== 'zakonczony' ? '<a class="mini" href="sms.html?nip=' + esc(k.nip) + '">SMS</a>' : '';
    if (!(ja.admin && k.dane && k.w_arkuszu) && smsLink) h += '<div class="acts" style="margin-top:8px">' + smsLink + '</div>';
    if (ja.admin && k.dane && k.w_arkuszu) {
      h += '<div class="acts" style="margin-top:8px"><button type="button" class="mini" data-c="edytuj">Edytuj dane…</button>' + smsLink + '</div>';
      if ((k.zmiany || []).length) h += '<details style="margin-top:8px"><summary class="sub" style="cursor:pointer">Historia zmian danych (' + k.zmiany.length + ')</summary><table><thead><tr><th>Kiedy</th><th>Kto</th><th>Co się zmieniło</th></tr></thead><tbody>' + k.zmiany.map(function (x) {
        return '<tr><td>' + pl(x.created_at) + '</td><td>' + esc(x.kto) + '</td><td>' + (x.akcja === 'dodanie' ? '<b>klient dodany w portalu</b>' : x.akcja === 'zmiana_id' ? '<b>zmiana identyfikatora klienta</b>' : '') +
          (x.zmiany || []).map(function (z) { return '<small><b>' + esc(z.pole) + '</b>: ' + esc(z.bylo) + ' → ' + esc(z.jest) + '</small>'; }).join('') + '</td></tr>';
      }).join('') + '</tbody></table></details>';
    }

    h += '<h4>Obsługa</h4>' + dl([['Status', statusPill(k), true], ['Zakres obsługi', zakresPill(k) + (zakres(k) === 'brak' ? ' <span class="sub">klient nie ma ani opiekuna, ani kadrowej</span>' : ' <span class="sub">według opiekunów w danych klienta</span>'), true], ['Obsługa od', pl(k.obsluga_od)], ['Obsługa zakończona od', pl(k.koniec_od)], ['Ostatnia zmiana', k.zmieniono_at ? pl(k.zmieniono_at) + (k.zmienil ? ' — ' + k.zmienil : '') : '']]);
    if (ja.admin) {
      h += '<div class="acts" style="margin-top:8px">' + (k.status !== 'zakonczony' ? '<button type="button" class="mini del" data-c="st" data-s="zakonczony">Zakończ obsługę…</button>' : '') +
        (k.status === 'obslugiwany' ? '<button type="button" class="mini" data-c="st" data-s="wstrzymany">Wstrzymaj…</button>' : '') +
        (k.status !== 'obslugiwany' ? '<button type="button" class="mini ok" data-c="st" data-s="obslugiwany">Przywróć obsługę…</button>' : '') +
        '<button type="button" class="mini" data-c="st" data-s="' + esc(k.status) + '" data-od="1">Ustaw datę rozpoczęcia…</button></div>';
      if ((k.historia || []).length) h += '<table><thead><tr><th>Kiedy</th><th>Status</th><th>Powód / uwagi</th><th>Kto</th></tr></thead><tbody>' + k.historia.map(function (x) {
        return '<tr><td>' + pl(x.created_at) + '</td><td>' + esc((STATUS[x.status] || [x.status])[0]) + (x.koniec_od ? ' od ' + pl(x.koniec_od) : '') + (x.obsluga_od ? '<small>obsługa od ' + pl(x.obsluga_od) + '</small>' : '') + '</td><td>' + esc(x.powod || '—') + '</td><td>' + esc(x.zmienil) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }

    if (k.tg) {
      var t = k.tg;
      h += '<h4>Telegram — grupa klienta</h4>' + dl([['Stan', tgPill(k) + (t.od && t.status !== 'ok' ? ' <span class="sub">od ' + pl(t.od) + '</span>' : ''), true], ['Nazwa grupy', t.tytul], ['Id czatu', t.chat_id],
        ['Uczestników', t.czlonkow != null ? String(t.czlonkow) : ''], ['Bot portalu w grupie', t.bot_status ? ({ creator: 'założyciel', administrator: 'administrator', member: 'członek', restricted: 'członek z ograniczeniami', left: 'nie ma go w grupie', kicked: 'usunięty' }[t.bot_status] || t.bot_status) : ''],
        ['Inne boty (administratorzy)', (t.boty || []).map(function (b) { return (b.nazwa || '') + (b.username ? ' @' + b.username : ''); }).join(', ')], ['Brakujące boty', (t.brak_botow || []).join(', ')],
        ['Ostatnie sprawdzenie', pl(t.sprawdzono_at)]]);
      if (t.blad) h += '<p class="hint warn" style="margin:6px 0 0">' + esc(t.blad) + '</p>';
      if (t.nowe_id) h += '<p class="hint" style="margin:6px 0 0">Nowe id czatu podane przez Telegram: <b>' + esc(t.nowe_id) + '</b> — wpisz je w danych klienta.' + (ja.admin && k.dane ? ' <button type="button" class="mini" data-c="edytuj" data-tg="' + esc(t.nowe_id) + '">Wpisz nowe id…</button>' : '') + '</p>';
      if ((t.uwagi || []).length) h += '<ul class="chk">' + t.uwagi.map(function (o) { return '<li class="s-info"><i>i</i><span>' + esc(o) + '</span></li>'; }).join('') + '</ul>';
      if (ja.admin) h += '<div class="acts" style="margin-top:8px">' + (mozeGrupe(k) ? '<button type="button" class="mini ok" data-c="tgNowa">Utwórz grupę Telegram…</button>' : '') + '<button type="button" class="mini" data-c="tg">Sprawdź teraz</button><span class="sub" id="tgMsg"></span></div>';
    }

    h += '<h4>Rejestr' + (r ? ' — ' + zrodlo(r, true) : '') + '</h4>';
    if ((k.ostrzezenia || []).length) h += '<ul class="chk">' + k.ostrzezenia.map(function (o) { return '<li class="s-uwaga"><i>!</i><span>' + esc(o) + '</span></li>'; }).join('') + '</ul>';
    if (r && r.znaleziono) {
      var j = r.zrodlo !== 'krs' ? (r.jdg || {}) : null;
      h += dl([['Źródło danych', j ? zrodlo(r, true) : ''], ['Nazwa', r.nazwa], ['Przedsiębiorca', j && j.wlasciciel], ['Forma prawna', r.forma], ['KRS', r.krs], ['REGON', r.regon], [j ? 'Data rozpoczęcia działalności' : 'Data rejestracji', pl(r.data_rejestracji)], ['Kapitał zakładowy', r.kapital != null ? zl(r.kapital) : ''],
        [j ? 'Adres działalności' : 'Adres siedziby', r.adres], ['Adres do doręczeń', j && j.adres_doreczen],
        ['Przeważająca działalność', r.pkd], ['Pozostałe kody PKD', j && (j.pkd || []).map(function (p) { return p.kod; }).filter(function (kod) { return String(r.pkd || '').indexOf(kod) !== 0; }).join(', ')],
        ['Stan', r.stan], ['Zawieszenie działalności', j && pl(j.data_zawieszenia)], ['Wznowienie działalności', j && pl(j.data_wznowienia)], ['Zakończenie działalności', j && pl(j.data_zakonczenia)], ['Wykreślenie z CEIDG', j && pl(j.data_wykreslenia)],
        ['Status VAT', j && j.status_vat ? j.status_vat + (j.vat_od ? ' (od ' + pl(j.vat_od) + ')' : '') + (j.vat_wykreslenie ? ', wykreślenie ' + pl(j.vat_wykreslenie) : '') : ''],
        ['Organ reprezentacji', r.organ], ['Sposób reprezentacji', r.reprezentacja],
        ['Stan na dzień', pl(r.sprawdzono_at) + (r.fetched_at && pl(r.fetched_at) !== pl(r.sprawdzono_at) ? ' (bez zmian od ' + pl(r.fetched_at) + ')' : '')]]);
      h += osoby('Organ reprezentacji', r.zarzad, ['Funkcja', function (p) { return low(p.funkcja); }]);
      h += osoby('Wspólnicy', r.wspolnicy, ['Udziały', function (p) { return p.opis ? low(p.opis) : p.udzialy != null ? String(p.udzialy) : ''; }]);
      h += osoby('Prokurenci', r.prokurenci, ['Rodzaj prokury', function (p) { return low(p.rodzaj); }]);
      if (r.zrodlo === 'mf') h += '<p class="hint warn" style="margin-top:8px">To są dane podstawowe z Wykazu podatników VAT (Ministerstwo Finansów): nazwa, REGON, adres i status VAT. Pełniejsze dane — kody PKD, data rozpoczęcia, zawieszenie i wznowienie działalności, imię i nazwisko przedsiębiorcy — pojawią się po podłączeniu CEIDG; portal sam zastąpi wtedy ten zapis.</p>';
      else if (r.zrodlo !== 'krs') h += '<p class="hint" style="margin-top:8px">Działalność jednoosobowa nie figuruje w KRS — dane pochodzą z ' + (r.zrodlo === 'ceidg' ? 'CEIDG' : 'rejestru REGON (GUS)') + '. Beneficjentów rzeczywistych (CRBR) portal nie pobiera.</p>';
      if ((r.zmiany || []).length) h += '<p class="sub" style="margin:10px 0 2px">Zmiany od poprzedniego pobrania (' + pl(r.fetched_at) + '):</p>' + zmianyHtml(r.zmiany);
      (k.rej_historia || []).filter(function (x) { return (x.zmiany || []).length; }).forEach(function (x) { h += '<p class="sub" style="margin:10px 0 2px">Wcześniej, ' + pl(x.fetched_at) + ':</p>' + zmianyHtml(x.zmiany); });
    } else if (!r && !(k.ostrzezenia || []).some(function (o) { return /nie zostały jeszcze pobrane/.test(o); })) h += '<p class="hint">Dane z rejestru nie zostały jeszcze pobrane.</p>';
    var akcje = '';
    if (ja.admin && k.nip) akcje += '<button type="button" class="mini" data-c="rej">Odśwież z rejestru</button>';
    if (r && r.krs) akcje += k.odpis ? '<button type="button" class="mini" data-c="odpis">Odpis aktualny KRS (PDF) — z bazy, pobrany ' + pl(k.odpis) + '</button>'
      : ja.admin ? '<button type="button" class="mini" data-c="odpis" data-platny="1">Pobierz odpis aktualny KRS (PDF) — płatne</button>' : '';
    if (akcje) h += '<div class="acts" style="margin-top:10px">' + akcje + '<span class="sub" id="kMsg"></span></div>';

    if (ja.admin && a) {
      var d = umowy.filter(function (u) { return u.klient === k.id; });
      h += '<h4>Umowy i pełnomocnictwa' + (k.status === 'zakonczony' ? ' (obsługa zakończona — dokumenty pozostają w bazie)' : ' — audyt') + '</h4>';
      if (k.status !== 'zakonczony') h += '<ul class="chk">' + a.pozycje.map(function (p) { return '<li class="s-' + p.stan + '"><i>' + IKONA[p.stan] + '</i><span>' + esc(p.tekst) + '</span></li>'; }).join('') + '</ul>';
      h += '<div style="margin-top:8px">' + (d.length ? d.map(function (u) { return docRow(u, false); }).join('') : '<p class="hint">Brak dokumentów tego klienta w bazie.</p>') + '</div>';
      h += '<div class="acts" style="margin-top:8px"><button type="button" class="mini" data-c="up">Wgraj dokument tego klienta…</button></div>';
      h += '<p class="hint" style="margin-top:12px">Identyfikację klienta i beneficjenta rzeczywistego (AML) prowadzi się w module <a href="onboarding.html">Onboarding klientów</a> — ten audyt jej nie obejmuje.</p>';
    }
    $('kartaBody').innerHTML = h;
    $('karta').hidden = false;
  }
  function otworz(i) { var k = klienci[i]; if (!k) return; otwarta = k.id; rysujKarte(); $('kartaBody').scrollTop = 0; }

  // the current KRS extract kept by the portal (function `firma`); a new one is paid
  async function odpis(k, b) {
    if (b.getAttribute('data-platny') && !confirm('Pobranie odpisu z KRS przez rejestr.io jest płatne. Pobrać?')) return;
    b.disabled = true;
    try {
      var res = await fetch(FIRMA + '?odpis=' + encodeURIComponent(k.rej.krs), { headers: { apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() } });
      var j = await res.json();
      if (!res.ok || !j.pdf) throw new Error(j.error || 'brak pliku');
      var bin = atob(j.pdf), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    } catch (e) { alert('Nie udało się pobrać odpisu: ' + (e.message || e)); }
    b.disabled = false;
  }
  // the provider's refusal in words: sole traders are read from CEIDG, then REGON (DataPort), then MF's VAT register
  function bladRejestru(t) {
    t = String(t || '');
    return /DataPort|CEIDG/i.test(t) && /nieaktywn|brak konfiguracji|inactive|token odrzucony/i.test(t) && !/dokończ jutro/.test(t)
      ? t + '. To nie jest błąd danych klienta — źródło danych działalności jednoosobowych (CEIDG / GUS) nie przyjęło klucza biura; spółki z KRS pobierają się normalnie.' : t;
  }
  $('kartaBody').addEventListener('click', async function (e) {
    var k = klient(otwarta), b = e.target.closest('[data-c]');
    if (b && k) {
      var c = b.getAttribute('data-c');
      if (c === 'close') { $('karta').hidden = true; otwarta = null; }
      else if (c === 'st') otworzStatus(k, b.getAttribute('data-s'), !!b.getAttribute('data-od'));
      else if (c === 'odpis') odpis(k, b);
      else if (c === 'edytuj') otworzKlienta(k, b.getAttribute('data-tg'));
      else if (c === 'tgNowa') nowaGrupa(k);
      else if (c === 'tg') {
        b.disabled = true; b.textContent = 'Sprawdzam…';
        var w = await api('telegram_sprawdz', { id: k.id });
        await wczytaj();
        var tm = $('tgMsg'); if (tm) tm.textContent = w.error || w.blad || (w.limit ? 'Telegram prosi o przerwę (' + w.limit + ' s) — spróbuj za chwilę.' : 'Sprawdzono.');
      }
      else if (c === 'up') { $('hintKl').value = k.id; plikiDla = k.id; $('file').click(); }
      else if (c === 'rej') {
        if (!confirm('Pobrać aktualne dane z rejestru dla „' + k.nazwa + '”?' + (k.rej && k.rej.zrodlo !== 'krs' ? '' : ' Pobranie z KRS (rejestr.io) jest płatne — ok. ' + zl(3 * cena) + '.'))) return;
        b.disabled = true; b.textContent = 'Pobieram…';
        var r = await api('rejestr', { id: k.id });
        await wczytaj();
        var m = $('kMsg'); if (m) m.textContent = r.error || r.blad ? 'Nie udało się: ' + bladRejestru(r.error || r.blad) : (r.zmiany ? 'Pobrano — są zmiany (' + r.zmiany + ').' : 'Pobrano — bez zmian.') + (r.podstawowe ? ' Źródło: Wykaz VAT (MF) — dane podstawowe.' : '');
      }
      return;
    }
    dokumentKlik(e);
  });
  $('karta').addEventListener('click', function (e) { if (e.target === $('karta')) { $('karta').hidden = true; otwarta = null; } });

  // ---------------- service status ----------------
  var stKlient = null, stStatus = '', stOd = false;
  function otworzStatus(k, status, tylkoOd) {
    stKlient = k; stStatus = status; stOd = tylkoOd;
    $('stTitle').textContent = tylkoOd ? 'Data rozpoczęcia obsługi' : status === 'zakonczony' ? 'Zakończ obsługę klienta' : status === 'wstrzymany' ? 'Wstrzymaj obsługę klienta' : 'Przywróć obsługę klienta';
    $('stWho').textContent = k.nazwa + (status === 'zakonczony' && !tylkoOd ? ' — klient pozostanie w bazie razem z danymi i umowami.' : '');
    $('stDateBox').hidden = !(tylkoOd || status === 'zakonczony');
    $('stDateLab').textContent = tylkoOd ? 'Obsługa od' : 'Obsługa zakończona od dnia';
    $('stDate').value = tylkoOd ? (k.obsluga_od || '') : status === 'zakonczony' ? dzis() : '';
    $('stPowod').value = ''; $('stMsg').textContent = '';
    $('stSave').className = 'go' + (status === 'zakonczony' && !tylkoOd ? ' red' : '');
    $('stat').hidden = false;
  }
  $('stCancel').addEventListener('click', function () { $('stat').hidden = true; });
  $('stat').addEventListener('click', function (e) { if (e.target === $('stat')) $('stat').hidden = true; });
  $('stSave').addEventListener('click', async function () {
    var d = $('stDate').value, body = { id: stKlient.id, status: stStatus, powod: $('stPowod').value.trim() };
    if (stOd) { if (!d) { $('stMsg').textContent = 'Podaj datę.'; return; } body.obsluga_od = d; body.koniec_od = stKlient.koniec_od || null; }
    else if (stStatus === 'zakonczony') { if (!d) { $('stMsg').textContent = 'Podaj dzień, od którego obsługa jest zakończona.'; return; } body.koniec_od = d; }
    this.disabled = true;
    var r = await api('status', body);
    this.disabled = false;
    if (r.error) { $('stMsg').textContent = r.error; return; }
    $('stat').hidden = true; await wczytaj();
  });

  // ---------------- upload ----------------
  var queue = [], running = 0, plikiDla = '';
  function drawQueue() {
    $('queue').innerHTML = queue.slice(-12).map(function (x) { return '<div class="q"><span>' + esc(x.name) + '</span><span class="pill ' + x.cls + '">' + esc(x.state) + '</span></div>'; }).join('');
  }
  function pump() {
    while (running < 2) {
      var job = queue.filter(function (x) { return x.state === 'w kolejce'; })[0];
      if (!job) return;
      running++; job.state = 'wysyłam…'; run(job).then(function () { running--; drawQueue(); odswiezPozniej(); pump(); });
    }
  }
  async function run(job) {
    var set = function (state, cls) { job.state = state; job.cls = cls || 'p-grey'; drawQueue(); };
    try {
      set('wysyłam…', 'p-navy');
      var id = crypto.randomUUID();
      var safe = job.file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80) || 'skan';
      var path = id + '/' + safe;
      var mime = job.file.type || (/\.pdf$/i.test(job.file.name) ? 'application/pdf' : /\.png$/i.test(job.file.name) ? 'image/png' : 'image/jpeg');
      // the row first, then the file: a failed upload takes the row back, so no file is ever left without a row
      var ins = await window.sb.from(T).insert({ id: id, path: path, nazwa: job.file.name.slice(0, 200), rozmiar: job.file.size, mime: mime, klient: job.klient || null });
      if (ins.error) throw new Error(ins.error.message);
      var up = await window.sb.storage.from(BUCKET).upload(path, job.file, { contentType: mime, upsert: false });
      if (up.error) { await api('usun_umowe', { id: id }); throw new Error(up.error.message); }
      set('odczytuję…', 'p-navy');
      var out = await api('rozpoznaj', { id: id });
      if (out.error) set(/limit/i.test(out.error) ? 'dzienny limit odczytów — przypisz ręcznie' : 'błąd odczytu', 'p-red');
      else set(out.status === 'przypisany' ? 'przypisany — do potwierdzenia' : 'do sprawdzenia', 'p-amber');
    } catch (e) { set('błąd: ' + (e.message || e), 'p-red'); }
  }
  function addFiles(list) {
    var kl = plikiDla || $('hintKl').value, skipped = 0;
    plikiDla = '';
    Array.prototype.forEach.call(list, function (file) {
      var ok = file.type === 'application/pdf' || file.type === 'image/jpeg' || file.type === 'image/png' || (!file.type && /\.(pdf|jpe?g|png)$/i.test(file.name));
      if (file.size > MAX || !file.size || !ok) { skipped++; return; }
      queue.push({ file: file, name: file.name, state: 'w kolejce', cls: 'p-grey', klient: kl });
    });
    $('upMsg').textContent = skipped ? skipped + ' plik(ów) pominięto — tylko PDF, JPEG i PNG do 24 MB.' : '';
    if (f.tab !== 'umowy' && queue.length) { f.tab = 'umowy'; zapamietaj(); $('karta').hidden = true; otwarta = null; rysuj(); }
    drawQueue(); pump();
  }
  var drop = $('drop');
  drop.addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });

  // ---------------- one document: view, edit, read again, delete ----------------
  async function dokumentKlik(e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    var id = b.closest('[data-u]').getAttribute('data-u'), u = umowy.filter(function (x) { return x.id === id; })[0], a = b.getAttribute('data-a');
    if (!u) return;
    if (a === 'view') {
      var s = await window.sb.storage.from(BUCKET).createSignedUrl(u.path, 300);
      if (s.error) return alert('Nie udało się otworzyć pliku: ' + s.error.message);
      window.open(s.data.signedUrl, '_blank', 'noopener');
    } else if (a === 'del') {
      if (!confirm('Usunąć dokument „' + u.nazwa + '” z bazy? Tej operacji nie można cofnąć.')) return;
      // through the function: it removes the file, then the row, and records who deleted what
      var d = await api('usun_umowe', { id: id });
      if (d.error) alert(d.error);
      await wczytaj();
    } else if (a === 'again') {
      var force = u.status === 'przypisany' || !!u.sprawdzil;
      if (force && !confirm(u.sprawdzil ? 'Ten dokument został już sprawdzony przez człowieka. Ponowny odczyt niczego w nim nie zmieni — nowy odczyt zostanie tylko zapisany obok, do porównania. Odczytać?'
        : 'Dokument jest już przypisany. Ponowny odczyt zastąpi dane odczytane automatycznie. Odczytać?')) return;
      b.disabled = true; b.textContent = 'Odczytuję…';
      var r = await api('rozpoznaj', { id: id, force: force });
      if (r.error) alert(r.error);
      await wczytaj();
    } else if (a === 'edit') otworzEdycje(u);
  }
  $('ulist').addEventListener('click', dokumentKlik);

  var editing = null, picked = null;
  function drawCands() {
    var term = low($('edQ').value).trim();
    var ai = ((editing.ai || {}).kandydaci || []).map(function (c) { return c.id; });
    var list = klienci.filter(function (k) { return !term || (picked && picked.id === k.id) ? ai.indexOf(k.id) !== -1 || (picked && picked.id === k.id) : low(k.nazwa + ' ' + (k.nip || '') + ' ' + ((k.rej || {}).nazwa || '')).indexOf(term) !== -1; })
      .sort(function (a, b) { return ai.indexOf(a.id) === -1 ? (ai.indexOf(b.id) === -1 ? a.nazwa.localeCompare(b.nazwa, 'pl') : 1) : (ai.indexOf(b.id) === -1 ? -1 : ai.indexOf(a.id) - ai.indexOf(b.id)); }).slice(0, 40);
    $('edCands').innerHTML = list.length ? list.map(function (k) {
      var c = ((editing.ai || {}).kandydaci || []).filter(function (x) { return x.id === k.id; })[0];
      return '<button type="button" class="cand' + (picked && picked.id === k.id ? ' on' : '') + '" data-w="' + klienci.indexOf(k) + '"><b>' + esc(k.nazwa) + '</b> <small>' + (k.nip ? 'NIP ' + esc(k.nip) : 'brak NIP') + (k.status === 'zakonczony' ? ' · obsługa zakończona' : '') + (c ? ' · podpowiedź: ' + esc(c.powod) : '') + '</small></button>';
    }).join('') : '<div class="empty" style="padding:14px">' + (term ? 'Brak takiego klienta w bazie.' : 'Wpisz nazwę albo NIP, aby wyszukać klienta.') + '</div>';
  }
  function otworzEdycje(u) {
    editing = u; picked = u.klient ? klient(u.klient) : null;
    var ai = u.ai || {};
    $('edFile').textContent = 'Plik: ' + u.nazwa;
    $('edAi').hidden = !ai.analiza;
    $('edAi').textContent = ai.analiza ? 'Odczytano: ' + ai.analiza + (ai.pewnosc ? ' (pewność: ' + ai.pewnosc + ')' : '') + (u.sprawdzil ? ' — sprawdził(a): ' + u.sprawdzil : ' — sprawdź dane z dokumentem i zatwierdź.') : '';
    $('edQ').value = picked ? picked.nazwa : '';
    opcje($('edRodzaj'), Object.keys(RODZAJ).map(function (r) { return [r, RODZAJ[r]]; }), u.rodzaj || 'inne');
    opcje($('edPodpisy'), Object.keys(PODPISY).map(function (p) { return [p, PODPISY[p]]; }), u.podpisy || '');
    var ob = u.obejmuje || [];
    $('edObKs').checked = ob.indexOf('ksiegowosc') !== -1; $('edObKd').checked = ob.indexOf('kadry') !== -1; $('edObPw').checked = ob.indexOf('powierzenie') !== -1;
    $('edPodtyp').value = u.podtyp || ''; $('edData').value = u.data_zawarcia || ''; $('edOd').value = u.obowiazuje_od || ''; $('edDo').value = u.obowiazuje_do || '';
    $('edBezt').checked = u.bezterminowa === true; $('edWyp').value = u.wypowiedzenie || ''; $('edKontr').value = u.kontrahent || ''; $('edKNip').value = u.kontrahent_nip || '';
    $('edRepr').value = (u.reprezentanci || []).map(function (p) { return p.imie_nazwisko; }).join(', ');
    $('edZakres').value = u.zakres || ''; $('edWyn').value = u.wynagrodzenie || ''; $('edUwagi').value = u.uwagi || ''; $('edMsg').textContent = '';
    drawCands(); $('edit').hidden = false;
  }
  $('edQ').addEventListener('input', function () { picked = null; drawCands(); });
  $('edCands').addEventListener('click', function (e) { var b = e.target.closest('[data-w]'); if (!b) return; picked = klienci[+b.getAttribute('data-w')]; $('edQ').value = picked.nazwa; drawCands(); });
  $('edCancel').addEventListener('click', function () { $('edit').hidden = true; });
  $('edit').addEventListener('click', function (e) { if (e.target === $('edit')) $('edit').hidden = true; });
  $('edSave').addEventListener('click', async function () {
    if (!picked) { $('edMsg').textContent = 'Wybierz klienta z listy.'; return; }
    var nip = $('edKNip').value.replace(/\D/g, '');
    if (nip && nip.length !== 10) { $('edMsg').textContent = 'NIP ma 10 cyfr.'; return; }
    var stare = (editing.reprezentanci || []), repr = $('edRepr').value.split(',').map(function (s) { return s.trim().slice(0, 120); }).filter(Boolean).slice(0, 10).map(function (n) {
      var byl = stare.filter(function (p) { return p.imie_nazwisko === n; })[0];
      return { imie_nazwisko: n, funkcja: byl ? byl.funkcja : '' };
    });
    var ob = [];
    if ($('edObKs').checked) ob.push('ksiegowosc'); if ($('edObKd').checked) ob.push('kadry'); if ($('edObPw').checked) ob.push('powierzenie');
    this.disabled = true;
    var u = await window.sb.from(T).update({
      status: 'przypisany', klient: picked.id, rodzaj: $('edRodzaj').value, podtyp: $('edPodtyp').value.trim() || null, obejmuje: ob,
      data_zawarcia: $('edData').value || null, obowiazuje_od: $('edOd').value || null, obowiazuje_do: $('edBezt').checked ? null : $('edDo').value || null, bezterminowa: $('edBezt').checked,
      wypowiedzenie: $('edWyp').value.trim() || null, podpisy: $('edPodpisy').value || null, kontrahent: $('edKontr').value.trim() || null, kontrahent_nip: nip || null, reprezentanci: repr,
      zakres: $('edZakres').value.trim() || null, wynagrodzenie: $('edWyn').value.trim() || null, uwagi: $('edUwagi').value.trim() || null,
    }).eq('id', editing.id);
    this.disabled = false;
    if (u.error) { $('edMsg').textContent = 'Błąd: ' + u.error.message; return; }
    $('edit').hidden = true; await wczytaj();
  });

  // ---------------- registers: all clients, with the cost shown first ----------------
  var rjStop = false, rjTrwa = false;
  function rjBody() { return { dni: Math.max(1, Math.min(365, parseInt($('rjDni').value, 10) || 30)), z_zakonczonymi: $('rjZak').checked }; }
  async function rjPlan() {
    $('rjGo').disabled = true; $('rjPlan').textContent = 'Liczę…'; $('rjMsg').textContent = '';
    var p = await api('rejestr_wszystkie', Object.assign({ dry: true }, rjBody()));
    if (p.error) { $('rjPlan').textContent = p.error; return null; }
    var pm = p.pominiete || {}, jd = p.jdg || {};
    // sole traders: which source will answer, and — with MF's VAT register alone — its daily share
    var skad = jd.ceidg ? 'CEIDG (bezpłatnie)' : jd.gus ? 'rejestru REGON (GUS, DataPort — według planu DataPort biura)' : 'Wykazu podatników VAT (MF, bezpłatnie — dane podstawowe)';
    var mfOpis = 'najwyżej ' + jd.mf_limit + ' firm dziennie (dziś zostało ' + jd.mf_zostalo_dzis + ')';
    var jdgOpis = !p.gus_firm ? '' : '<br>Działalności jednoosobowe: ' + p.gus_firm + ' z ' + skad + '. ' + (jd.tylko_mf
      ? 'CEIDG nie jest jeszcze podłączony, więc portal pobierze z Wykazu VAT nazwę, REGON, adres i status VAT — ' + mfOpis + (jd.mf_dni > 1 ? '; całość zajmie ok. ' + jd.mf_dni + ' dni — po wyczerpaniu limitu pobieranie zatrzyma się, dokończ jutro' : '') + '. Po podłączeniu CEIDG te zapisy zostaną zastąpione pełnymi danymi.'
      : 'Gdy to źródło nie odpowie, portal sięgnie po dane podstawowe z Wykazu VAT (MF) — ' + mfOpis + '.' + (jd.ulepszen ? ' W tym ' + jd.ulepszen + ' zapisów z Wykazu VAT do zastąpienia pełnymi danymi.' : ''));
    $('rjPlan').innerHTML = !p.firm ? 'Nie ma nic do pobrania — dane wszystkich klientów są aktualne.' :
      '<b>Do pobrania: ' + p.firm + ' firm</b> — ' + p.krs_firm + ' z KRS (rejestr.io), ' + p.gus_firm + ' działalności jednoosobowych i innych spoza KRS.<br>' +
      'Zapytań do rejestr.io: ' + p.zapytan_rejestr_io + ' × ' + zl(p.cena) + ' = <b>ok. ' + zl(p.koszt_zl) + '</b>.' + jdgOpis;
    $('rjPlan').innerHTML += '<br><span class="sub">Pominięto: ' + [pm.swieze + ' sprawdzonych niedawno', pm.bez_nip + ' bez poprawnego NIP', pm.zakonczone + ' z zakończoną obsługą'].concat(pm.po_bledzie ? [pm.po_bledzie + ' po błędzie w ostatniej godzinie'] : []).join(', ') + '.</span>';
    $('rjGo').disabled = !p.firm; $('rjGo').textContent = p.firm ? 'Pobierz (ok. ' + zl(p.koszt_zl) + ')' : 'Pobierz';
    return p;
  }
  function otworzRejestr() { $('rjProg').hidden = true; $('rej').hidden = false; rjPlan(); }
  $('rjDni').addEventListener('change', function () { if (!rjTrwa) rjPlan(); });
  $('rjZak').addEventListener('change', function () { if (!rjTrwa) rjPlan(); });
  $('rjCancel').addEventListener('click', function () { if (rjTrwa) { rjStop = true; this.disabled = true; this.textContent = 'Zatrzymuję…'; } else $('rej').hidden = true; });
  $('rjGo').addEventListener('click', async function () {
    var p = await rjPlan(); if (!p || !p.firm) return;
    if (!confirm('Pobrać dane ' + p.firm + ' firm? Szacowany koszt rejestr.io: ok. ' + zl(p.koszt_zl) + '.')) return;
    rjTrwa = true; rjStop = false; this.disabled = true; $('rjDni').disabled = $('rjZak').disabled = true; $('rjCancel').textContent = 'Zatrzymaj';
    $('rjProg').hidden = false;
    var razem = p.firm, zrobione = 0, bledy = [], zmiany = 0, przerwano = '', jutro = false;
    // the function reads a few firms per call; the number of calls is bounded by the plan
    for (var i = 0; i < Math.ceil(razem / (p.na_raz || 5)) + 2 && !rjStop; i++) {
      var r = await api('rejestr_wszystkie', Object.assign({ dry: false }, rjBody()));
      if (r.error) { $('rjMsg').textContent = r.error; break; }
      (r.zrobione || []).forEach(function (x) { if (x.ok) zrobione++; if (!x.ok && x.jutro) return; if (!x.ok) bledy.push(x.nazwa + ' — ' + (x.blad || 'błąd')); else if (x.zmiany) zmiany++; });
      $('rjBar').style.width = Math.min(100, Math.round(zrobione / razem * 100)) + '%';
      $('rjTxt').textContent = 'Pobrano ' + zrobione + ' z ' + razem + (bledy.length ? ' · błędy: ' + bledy.length : '');
      // the provider refused (inactive key, limit, outage) or the daily cap was reached: asking on is pointless
      if (r.przerwano) { przerwano = r.przerwano; jutro = r.jutro === true; break; }
      if (!(r.zrobione || []).length || !r.pozostalo) break;
    }
    rjTrwa = false; $('rjDni').disabled = $('rjZak').disabled = false; $('rjCancel').disabled = false; $('rjCancel').textContent = 'Zamknij';
    $('rjTxt').textContent = (jutro ? 'Dzienny limit Wykazu VAT wyczerpany — dokończ jutro. ' : przerwano ? 'Przerwano — dostawca danych odmówił. ' : rjStop ? 'Zatrzymano. ' : 'Gotowe. ') + 'Pobrano ' + zrobione + ' z ' + razem + (zmiany ? ' · zmiany w rejestrze: ' + zmiany : '') + (bledy.length ? ' · błędy: ' + bledy.length : '');
    await wczytaj(); await rjPlan();
    $('rjMsg').textContent = jutro ? przerwano : przerwano ? 'Pobieranie przerwane: ' + bladRejestru(przerwano) : bledy.slice(0, 8).join('; ');
  });
  $('rej').addEventListener('click', function (e) { if (e.target === $('rej') && !rjTrwa) $('rej').hidden = true; });

  // ---------------- a client's data: add, edit (administrators) ----------------
  var KL_POLA = ['nazwa', 'nip', 'forma', 'opodatkowanie', 'adres', 'miasto', 'kontakt', 'telefon', 'email', 'opiekun', 'kadrowy', 'telegram', 'jezyk'];
  var klId = null, klDane = null, klPodglad = null;
  function lista(id, wartosci) { $(id).innerHTML = (wartosci || []).map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join(''); }
  function otworzKlienta(k, noweTg) {
    var p = (adm && adm.podpowiedzi) || {}, d = k ? k.dane || {} : {};
    klId = k ? k.id : null;
    $('klTitle').textContent = k ? 'Edytuj dane klienta' : 'Dodaj klienta';
    $('klSub').textContent = k ? k.nazwa : 'Nowy klient pojawi się w całym portalu: w rejestrze, przy zamknięciach miesiąca, w przypomnieniach.';
    var formy = (p.formy || []).slice(); if (d.forma && formy.indexOf(d.forma) === -1) formy.push(d.forma);
    var jezyki = (p.jezyki || []).slice(); if (d.jezyk && jezyki.indexOf(d.jezyk) === -1) jezyki.push(d.jezyk);
    opcje($('kl_forma'), [['', '— wybierz —']].concat(formy.map(function (x) { return [x, x]; })), d.forma || '');
    opcje($('kl_jezyk'), [['', '— nie podano —']].concat(jezyki.map(function (x) { return [x, { Polish: 'polski', Ukrainian: 'ukraiński', Russian: 'rosyjski', English: 'angielski' }[x] || x]; })), d.jezyk || '');
    lista('klOpiekunowie', p.opiekun); lista('klKadrowi', p.kadrowy); lista('klOpod', p.opodatkowanie);
    KL_POLA.forEach(function (x) { if (x !== 'forma' && x !== 'jezyk') $('kl_' + x).value = d[x] || ''; });
    if (noweTg) $('kl_telegram').value = noweTg;
    $('klZespol').textContent = p.z_zespolu ? 'Podpowiedzi opiekunów pochodzą z modułu „Zespół”.' : 'Opiekuna i kadrową wpisz tak, jak u innych klientów (lista podpowiada istniejące). Puste pole = biuro nie prowadzi tego zakresu.';
    $('klNipHint').textContent = k && /^nazwa:/.test(k.id) ? 'Klient nie ma jeszcze NIP — po wpisaniu jego dokumenty i historia w tej bazie zostaną przepięte na NIP.' : '';
    $('klMsg').textContent = ''; $('kl').hidden = false; $('kl_nazwa').focus();
  }
  function zFormularza() { var d = {}; KL_POLA.forEach(function (x) { d[x] = $('kl_' + x).value.trim(); }); return d; }
  $('klCancel').addEventListener('click', function () { $('kl').hidden = true; });
  $('kl').addEventListener('click', function (e) { if (e.target === $('kl')) $('kl').hidden = true; });
  // first the server says what would change (and what is wrong); the save happens only after the confirmation
  $('klDalej').addEventListener('click', async function () {
    klDane = zFormularza();
    if (klDane.nazwa.length < 2) { $('klMsg').textContent = 'Podaj nazwę klienta.'; return; }
    this.disabled = true;
    var r = await api('klient_zapisz', { id: klId, dane: klDane, dry: true });
    this.disabled = false;
    if (r.error) { $('klMsg').textContent = r.error; return; }
    if (!(r.zmiany || []).length) { $('klMsg').textContent = 'Nie wprowadzono żadnych zmian.'; return; }
    klPodglad = r; $('klMsg').textContent = '';
    $('dfTitle').textContent = klId ? 'Potwierdź zmiany' : 'Potwierdź dodanie klienta';
    $('dfSub').textContent = klDane.nazwa;
    $('dfList').innerHTML = '<table><thead><tr><th>Pole</th><th>Było</th><th>Będzie</th></tr></thead><tbody>' + r.zmiany.map(function (z) { return '<tr><td><b>' + esc(z.pole) + '</b></td><td>' + esc(z.bylo) + '</td><td>' + esc(z.jest) + '</td></tr>'; }).join('') + '</tbody></table>';
    var uw = '', inne = r.inne_moduly || {}, klucze = Object.keys(inne);
    if (r.zmiana_nip) uw += '<p class="hint warn" style="margin:10px 0 0">Zmieniasz NIP klienta, który miał już NIP. Dokumenty, rejestr i historia w Bazie klientów zostaną przepięte na nowy numer. ' +
      (klucze.length ? 'Inne moduły zachowają swoje wpisy pod starym NIP: ' + esc(klucze.map(function (x) { return x + ' (' + inne[x] + ')'; }).join(', ')) + ' — nie zostaną przeniesione.' : 'W innych modułach nie ma wpisów pod starym NIP.') + '</p>';
    else if (r.zmiana_id) uw += '<p class="hint" style="margin:10px 0 0">Zmienia się identyfikator klienta (' + (klDane.nip ? 'dotąd nie miał NIP' : 'klient bez NIP jest rozpoznawany po nazwie') + ') — jego dokumenty, rejestr i historia w Bazie klientów pozostaną przy nim.</p>';
    $('dfUwagi').innerHTML = uw; $('dfMsg').textContent = '';
    $('diff').hidden = false;
  });
  $('dfBack').addEventListener('click', function () { $('diff').hidden = true; });
  $('diff').addEventListener('click', function (e) { if (e.target === $('diff')) $('diff').hidden = true; });
  $('dfSave').addEventListener('click', async function () {
    this.disabled = true;
    var r = await api('klient_zapisz', { id: klId, dane: klDane, potwierdz_nip: !!(klPodglad && klPodglad.zmiana_nip) });
    this.disabled = false;
    if (r.error) { $('dfMsg').textContent = r.error; return; }
    $('diff').hidden = true; $('kl').hidden = true;
    await wczytaj();
    if (r.id && klient(r.id)) { otwarta = r.id; rysujKarte(); }
  });

  // ---------------- Telegram: required bots, checking all groups (read only) ----------------
  var tgTrwa = false, tgStop = false, tgBoty = [];
  function rysujTgBoty() {
    var t = (adm && adm.telegram) || {};
    $('tgBoty').innerHTML = tgBoty.length ? tgBoty.map(function (b, i) { return '<div class="q"><span><b>' + esc(b.nazwa) + '</b> <small class="sub">id ' + esc(b.user_id) + '</small></span><button type="button" class="mini del" data-rm="' + i + '">Usuń</button></div>'; }).join('')
      : '<p class="hint" style="margin:0">Poza botem portalu żaden inny bot nie jest wymagany.</p>';
    var wid = (t.widziane || []).filter(function (b) { return !tgBoty.some(function (x) { return x.user_id === b.id; }); });
    $('tgWidziane').innerHTML = wid.length ? '<p class="sub" style="margin:10px 0 4px">Boty widziane wśród administratorów grup — kliknij, aby dodać do wymaganych:</p>' + wid.map(function (b) {
      return '<button type="button" class="mini" data-add="' + esc(b.id) + '" data-n="' + esc(b.nazwa || b.username || 'bot') + '">' + esc((b.nazwa || 'bot') + (b.username ? ' @' + b.username : '')) + ' · ' + b.grup + ' gr.</button> ';
    }).join('') : '';
  }
  function otworzTelegram() {
    var t = (adm && adm.telegram) || {};
    tgBoty = (t.boty || []).map(function (b) { return { nazwa: b.nazwa, user_id: b.user_id }; });
    var p = t.przebieg;
    $('tgStan').innerHTML = !t.skonfigurowany ? '<span class="warn">Bot portalu nie jest skonfigurowany — kontrola nie działa.</span>'
      : 'Bot portalu: id ' + esc(t.bot_id) + '. ' + (p && p.koniec ? 'Ostatnia codzienna kontrola: ' + pl(p.koniec) + (p.zmian ? ' — zmian na gorsze: ' + p.zmian : ' — bez zmian na gorsze') + '.' : p && p.start ? 'Codzienna kontrola w toku (od ' + pl(p.start) + ').' : 'Codzienna kontrola jeszcze się nie odbyła.');
    $('tgNazwa').value = ''; $('tgId').value = ''; $('tgMsg2').textContent = ''; $('tgProg').hidden = true;
    rysujTgBoty(); $('tg').hidden = false;
  }
  async function zapiszTgBoty() {
    var r = await api('telegram_ustawienia', { boty: tgBoty });
    $('tgMsg2').textContent = r.error || 'Zapisano listę wymaganych botów — obowiązuje od następnego sprawdzenia.';
    if (!r.error && adm && adm.telegram) adm.telegram.boty = tgBoty.slice();
  }
  $('tgBoty').addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (!b) return; tgBoty.splice(+b.getAttribute('data-rm'), 1); rysujTgBoty(); zapiszTgBoty(); });
  $('tgWidziane').addEventListener('click', function (e) { var b = e.target.closest('[data-add]'); if (!b) return; tgBoty.push({ nazwa: b.getAttribute('data-n'), user_id: b.getAttribute('data-add') }); rysujTgBoty(); zapiszTgBoty(); });
  $('tgDodaj').addEventListener('click', function () {
    var n = $('tgNazwa').value.trim(), id = $('tgId').value.replace(/\s/g, '').split(':')[0]; // a pasted token: only the part before the colon is the id
    $('tgId').value = id;
    if (!n || !/^\d{5,15}$/.test(id)) { $('tgMsg2').textContent = 'Podaj nazwę i liczbowe id bota (5–15 cyfr).'; return; }
    if (tgBoty.some(function (b) { return b.user_id === id; })) { $('tgMsg2').textContent = 'Ten bot już jest na liście.'; return; }
    tgBoty.push({ nazwa: n.slice(0, 60), user_id: id }); $('tgNazwa').value = ''; $('tgId').value = ''; rysujTgBoty(); zapiszTgBoty();
  });
  $('tgCancel').addEventListener('click', function () { if (tgTrwa) { tgStop = true; this.disabled = true; this.textContent = 'Zatrzymuję…'; } else $('tg').hidden = true; });
  $('tg').addEventListener('click', function (e) { if (e.target === $('tg') && !tgTrwa) $('tg').hidden = true; });
  $('tgGo').addEventListener('click', async function () {
    tgTrwa = true; tgStop = false; this.disabled = true; $('tgCancel').textContent = 'Zatrzymaj'; $('tgProg').hidden = false; $('tgBar').style.width = '0';
    var od = new Date().toISOString(), zrobione = 0, razem = 0, koniec = '';
    // a batch per call; the round ends when nothing older than its start is left (at most 30 calls)
    for (var i = 0; i < 30 && !tgStop; i++) {
      var r = await api('telegram_sprawdz', { wszystkie: true, od: od });
      if (r.error || r.blad) { koniec = r.error || r.blad; break; }
      zrobione += r.sprawdzono || 0; razem = Math.max(razem, zrobione + (r.pozostalo || 0));
      $('tgBar').style.width = (razem ? Math.round(zrobione / razem * 100) : 100) + '%';
      $('tgTxt').textContent = 'Sprawdzono ' + zrobione + ' z ' + razem;
      if (r.limit) { koniec = 'Telegram poprosił o przerwę (' + r.limit + ' s). Sprawdzono część grup — dokończ za chwilę.'; break; }
      if (!r.pozostalo || !r.sprawdzono) break;
    }
    tgTrwa = false; this.disabled = false; $('tgCancel').disabled = false; $('tgCancel').textContent = 'Zamknij';
    $('tgTxt').textContent = (tgStop ? 'Zatrzymano. ' : koniec ? '' : 'Gotowe. ') + 'Sprawdzono ' + zrobione + (razem ? ' z ' + razem : '') + '.';
    await wczytaj();
    $('tgMsg2').textContent = koniec;
  });

  // ---------------- page events ----------------
  function kafelek(t) {
    if (t === 'spr') { f.tab = 'umowy'; f.utab = 'spr'; }
    else {
      f.tab = 'klienci'; f.umowy = ''; f.rejestr = ''; f.zakres = ''; f.telegram = ''; f.status = 'czynni';
      if (t === 'obs') f.status = 'obslugiwany'; else if (t === 'wstrz') f.status = 'wstrzymany'; else if (t === 'zak') f.status = 'zakonczony';
      else if (t === 'bezU') f.umowy = 'bez_umowy'; else if (t === 'bezP') f.umowy = 'bez_powierzenia'; else if (t === 'ostrz') f.rejestr = 'ostrz'; else if (t === 'nikt') f.zakres = 'brak'; else if (t === 'tg') f.telegram = 'problem';
    }
  }
  $('tiles').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tile]'); if (!b) return;
    kafelek(b.getAttribute('data-tile'));
    zapamietaj(); rysuj();
  });
  // a link from the dashboard opens the list already narrowed: klienci.html?k=bezU
  var naStart = new URLSearchParams(location.search).get('k') || '';
  if (/^(obs|wstrz|zak|bezU|bezP|ostrz|nikt|tg|spr)$/.test(naStart)) kafelek(naStart);
  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-t]'); if (!b) return; f.tab = b.getAttribute('data-t'); zapamietaj(); rysuj(); });
  $('utabs').addEventListener('click', function (e) { var b = e.target.closest('[data-ut]'); if (!b) return; f.utab = b.getAttribute('data-ut'); zapamietaj(); rysujUmowy(); });
  $('fQ').addEventListener('input', function () { f.q = this.value; zapamietaj(); rysujListe(); });
  [['fStatus', 'status'], ['fOpiekun', 'opiekun'], ['fForma', 'forma'], ['fZakres', 'zakres'], ['fUmowy', 'umowy'], ['fRejestr', 'rejestr'], ['fTelegram', 'telegram']].forEach(function (p) {
    $(p[0]).addEventListener('change', function () { f[p[1]] = this.value; zapamietaj(); rysujKafelki(); rysujListe(); });
  });
  $('tools').addEventListener('click', function (e) { if (e.target.id === 'rejAll') otworzRejestr(); else if (e.target.id === 'klNowy') otworzKlienta(null); else if (e.target.id === 'tgOtw') otworzTelegram(); else if (e.target.id === 'tgSzablon') window.TgGrupa.szablon(); });
  function wiersz(e) {
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    var th = e.target.closest('th[data-sort]');
    if (th) { var c = th.getAttribute('data-sort'); if (f.sort === c) f.dir = -f.dir; else { f.sort = c; f.dir = 1; } zapamietaj(); rysujListe(); return; }
    var tn = e.target.closest('[data-tgn]'); if (tn) { var kt = klienci[+tn.getAttribute('data-tgn')]; if (kt && e.type === 'click') nowaGrupa(kt); return; }
    var tr = e.target.closest('tr[data-k]'); if (tr) otworz(+tr.getAttribute('data-k'));
  }
  ['tbl', 'atbl', 'ztbl'].forEach(function (id) { $(id).addEventListener('click', wiersz); $(id).addEventListener('keydown', wiersz); });
  $('csvBtn').addEventListener('click', async function () {
    this.disabled = true;
    var r = await api('braki_csv');
    this.disabled = false;
    if (r.error || typeof r.csv !== 'string') return alert(r.error || 'Nie udało się przygotować pliku.');
    var url = URL.createObjectURL(new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
    a.href = url; a.download = 'klienci-braki-' + dzis() + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var m = ['tgg', 'tgs', 'diff', 'kl', 'tg', 'edit', 'stat', 'rej', 'karta'].filter(function (id) { return $(id) && !$(id).hidden; })[0];
    if (!m || (m === 'rej' && rjTrwa) || (m === 'tg' && tgTrwa)) return;
    if (m === 'tgg' || m === 'tgs') { if (window.TgGrupa) window.TgGrupa.zamknij(m); return; }
    $(m).hidden = true; if (m === 'karta') otwarta = null;
  });

  if (window.sb) { rysuj(); wczytaj(); }
})();
