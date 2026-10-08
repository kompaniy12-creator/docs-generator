/* Księgowość: the accountants' working board — every accounting client and the monthly
   closing of its books. Clients come from the office's client base (klienci-list), the
   closing steps live in ksieg_zamkniecia (one row per NIP and period YYYY-MM,
   kroki = { step_id: { at, by } | { nd: true, at, by } }). A tick is saved at once. */
(function () {
  'use strict';
  var KL = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/klienci-list';
  var T = 'ksieg_zamkniecia', LS = 'ksieg.filtry', HIST = 6, ZAL_DZIEN = 25;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // step ids are stored in the database — never rename them
  var KROKI = [
    { id: 'dok', nazwa: 'Dokumenty od klienta otrzymane', krotko: 'Dok.' },
    { id: 'ksiegi', nazwa: 'Zaksięgowano', krotko: 'Księgi' },
    { id: 'wyciagi', nazwa: 'Wyciągi bankowe uzgodnione', krotko: 'Wyciągi' },
    { id: 'place', nazwa: 'Listy płac / ZUS DRA', krotko: 'Płace' },
    { id: 'jpk', nazwa: 'JPK_V7 wysłany', krotko: 'JPK' },
    { id: 'podatki', nazwa: 'Zaliczki PIT/CIT wyliczone', krotko: 'Podatki' },
    { id: 'info', nazwa: 'Klient poinformowany o kwotach', krotko: 'Info' },
    { id: 'zamk', nazwa: 'Miesiąc zamknięty', krotko: 'Zamk.' },
  ];
  var ZAMK = 'zamk';
  var MIES = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
  var STATUS = { nowy: ['nie rozpoczęte', 'p-grey'], wtoku: ['w toku', 'p-amber'], zamk: ['zamknięte', 'p-ok'] };

  // ---------------- periods ----------------
  function dzis() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function okAdd(o, n) { var d = new Date(+o.slice(0, 4), +o.slice(5, 7) - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function okNazwa(o) { return MIES[+o.slice(5, 7) - 1] + ' ' + o.slice(0, 4); }
  function biezacy() { return dzis().slice(0, 7); }
  function zamykany() { return okAdd(biezacy(), -1); }
  // behind = not closed after the 25th of the following month (calendar days)
  function poTerminie(o) { return dzis() > okAdd(o, 1) + '-' + pad(ZAL_DZIEN); }
  function plDT(iso) {
    var d = new Date(iso || '');
    return isNaN(d) ? '' : pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function plD(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }

  // ---------------- tax micro-account ----------------
  function mod97(num) { var r = 0; for (var i = 0; i < num.length; i++) r = (r * 10 + Number(num[i])) % 97; return r; }
  // LK + 10100071 + 222 + 2 + NIP + 00 (structure published by the Ministry of Finance); same as in the `klient` function
  function mikrorachunek(nip) {
    if (!/^\d{10}$/.test(nip || '')) return '';
    var body = '101000712222' + nip + '00';
    var nr = pad(98 - mod97(body + '252100')) + body;
    return 'PL' + nr.slice(0, 2) + ' ' + nr.slice(2).replace(/(.{4})(?=.)/g, '$1 ');
  }

  // ---------------- state ----------------
  var klienci = [], wszyscy = [], okres = zamykany(), me = '', gotowe = false, bladTabeli = '';
  var zam = {};    // what is shown: zam[okres][nip] = row (also optimistic, not yet confirmed)
  var potw = {};   // last state confirmed by the server, to go back to when a save fails
  var wczytane = {}, kolejki = {}, wToku = {}, otwarty = -1;
  var f = { q: '', op: '', typ: '', st: '', sort: 'nazwa' };
  try {
    var zap = JSON.parse(localStorage.getItem(LS) || '{}');
    Object.keys(f).forEach(function (k) { if (typeof zap[k] === 'string') f[k] = zap[k]; });
  } catch (e) {}
  function pamietaj() { try { localStorage.setItem(LS, JSON.stringify(f)); } catch (e) {} }

  var toastT = 0;
  function toast(msg, info) {
    var el = $('toast'); el.textContent = msg; el.className = 'toast' + (info ? ' info' : ''); el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, info ? 2500 : 6000);
  }

  // ---------------- closing state of one client ----------------
  function wiersz(nip, o) { return (zam[o] && zam[o][nip]) || null; }
  // steps of a period; when nothing was saved for it yet, "nie dotyczy" is carried over from the
  // latest earlier period (it becomes a real entry with the first save)
  function kroki(nip, o) {
    var r = wiersz(nip, o);
    if (r) return { k: r.kroki || {}, dz: false };
    return przeniesione(nip, o);
  }
  function przeniesione(nip, o) {
    for (var i = 1; i < HIST; i++) {
      var p = wiersz(nip, okAdd(o, -i));
      if (!p) continue;
      var out = {}, any = false;
      KROKI.forEach(function (s) { var e = (p.kroki || {})[s.id]; if (e && e.nd && s.id !== ZAMK) { out[s.id] = e; any = true; } });
      return { k: out, dz: any };
    }
    return { k: {}, dz: false };
  }
  function stan(nip, o) {
    var kk = kroki(nip, o), k = kk.k, zrob = 0, nd = 0;
    KROKI.forEach(function (s) { var e = k[s.id]; if (!e) return; if (e.nd) nd++; else zrob++; });
    var zamk = !!(k[ZAMK] && !k[ZAMK].nd);
    var r = wiersz(nip, o);
    return { k: k, dz: kk.dz, zrob: zrob, nd: nd, zamk: zamk, status: zamk ? 'zamk' : zrob ? 'wtoku' : 'nowy',
      zal: !zamk && poTerminie(o), ile: zrob + nd, uwagi: (r && r.uwagi) || '', zmiana: (r && r.updated_at) || '' };
  }
  function brakujace(k) { return KROKI.filter(function (s) { return s.id !== ZAMK && !k[s.id]; }); }
  // one change of one step; returns a message when the rules do not allow it
  function zastosuj(k, id, cel) {
    if (id !== ZAMK && k[ZAMK] && !k[ZAMK].nd) return 'Miesiąc jest zamknięty — najpierw cofnij „Miesiąc zamknięty”.';
    if (id === ZAMK && cel === 'nd') return 'Kroku „Miesiąc zamknięty” nie można oznaczyć jako „nie dotyczy”.';
    if (id === ZAMK && cel === 'done') {
      var b = brakujace(k);
      if (b.length) return 'Nie można zamknąć miesiąca. Zostało: ' + b.map(function (s) { return s.nazwa; }).join(', ') + '.';
    }
    if (cel === 'clear') delete k[id];
    else {
      var e = { at: new Date().toISOString(), by: me };
      if (cel === 'nd') e = { nd: true, at: e.at, by: e.by };
      k[id] = e;
    }
    return '';
  }
  function kopia(o) { return JSON.parse(JSON.stringify(o || {})); }
  function ustaw(mapa, o, nip, row) { mapa[o] = mapa[o] || {}; if (row) mapa[o][nip] = row; else delete mapa[o][nip]; }

  // Saves are queued per client and period, each one re-reads the row first, so two people
  // (or two quick clicks) ticking different steps do not overwrite each other.
  function zapisz(nip, o, zmiana) {
    var key = o + '|' + nip;
    // optimistic: show it now
    var teraz = { nip: nip, okres: o, kroki: kopia(kroki(nip, o).k), uwagi: (wiersz(nip, o) || {}).uwagi || null, updated_by: me, updated_at: new Date().toISOString() };
    var blad = zmiana(teraz);
    if (blad) { toast(blad); return Promise.resolve(false); }
    var dziedziczone = kopia(przeniesione(nip, o).k);
    ustaw(zam, o, nip, teraz); wToku[key] = (wToku[key] || 0) + 1; rysuj();
    var job = function () {
      return (async function () {
        var cur = await window.sb.from(T).select('*').eq('nip', nip).eq('okres', o).maybeSingle();
        if (cur.error) throw new Error(cur.error.message);
        if (cur.data) ustaw(potw, o, nip, cur.data);
        var row = { nip: nip, okres: o, kroki: cur.data ? kopia(cur.data.kroki) : dziedziczone, uwagi: cur.data ? cur.data.uwagi : null, updated_by: me, updated_at: new Date().toISOString() };
        var b2 = zmiana(row);
        if (b2) throw new Error(b2 + ' (ktoś zmienił ten wiersz w międzyczasie)');
        var up = await window.sb.from(T).upsert(row, { onConflict: 'nip,okres' }).select().single();
        if (up.error) throw new Error(up.error.message);
        ustaw(potw, o, nip, up.data);
        return up.data;
      })().then(function (data) {
        wToku[key]--;
        if (!wToku[key]) ustaw(zam, o, nip, kopia(data));   // later clicks are still on their way — keep what the user sees
        rysuj(); return true;
      }, function (e) {
        wToku[key]--;
        var p = potw[o] && potw[o][nip];
        ustaw(zam, o, nip, p ? kopia(p) : null);
        rysuj();
        toast('Nie zapisano — cofnięto zmianę. ' + (e && e.message ? e.message : e));
        return false;
      });
    };
    kolejki[key] = (kolejki[key] || Promise.resolve()).then(job);
    return kolejki[key];
  }
  function klik(nip, id, tryb) {
    if (!nip) { toast('Ten klient nie ma NIP w bazie klientów — nie można zapisać zamknięcia.'); return; }
    var e = kroki(nip, okres).k[id];
    var cel = tryb === 'nd' ? (e && e.nd ? 'clear' : 'nd') : tryb === 'done' ? 'done' : tryb === 'clear' ? 'clear' : (e ? 'clear' : 'done');
    zapisz(nip, okres, function (row) { return zastosuj(row.kroki, id, cel); });
  }

  // ---------------- data ----------------
  async function token() { var s = await window.sb.auth.getSession(); return s && s.data && s.data.session ? s.data.session.access_token : ''; }
  async function wczytajKlientow() {
    var res = await fetch(KL, { headers: { apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() } });
    var k = await res.json().catch(function () { return {}; });
    if (!res.ok || !Array.isArray(k.clients)) throw new Error(k.error || ('HTTP ' + res.status));
    var seen = {};
    klienci = k.clients.map(function (c) {
      var o = {};
      ['nazwa', 'nip', 'adres', 'forma', 'opodatkowanie', 'telefon', 'email', 'kontakt', 'miasto', 'opiekun', 'kadrowy', 'telegram', 'jezyk'].forEach(function (p) { o[p] = c[p] == null ? '' : String(c[p]).trim(); });
      o.nip = o.nip.replace(/\D/g, '');
      return o;
    }).filter(function (c) {
      if (!c.nazwa && !c.nip) return false;
      if (c.nip) { if (seen[c.nip]) return false; seen[c.nip] = 1; }
      return true;
    });
    // Baza klientów: a client whose service has ended stays on the board up to the month it ended in.
    // When that table cannot be read, everybody is shown.
    try {
      var ob = await window.sb.from('klienci_obsluga').select('nip,koniec_od').eq('status', 'zakonczony');
      var kon = {};
      (ob.data || []).forEach(function (o) { if (o.nip && o.koniec_od) kon[o.nip] = String(o.koniec_od).slice(0, 7); });
      klienci.forEach(function (c) { c.koniec = kon[c.nip] || ''; });
    } catch (e) {}
    wszyscy = klienci;
    naOkres();
  }
  // the clients of the chosen period: without those whose service ended in an earlier month
  function naOkres() {
    var l = wszyscy.filter(function (c) { return !c.koniec || c.koniec >= okres; });
    if (l.length !== klienci.length) zamknij();
    klienci = l;
    klienci.forEach(function (c, i) { c.i = i; });
  }
  // the chosen period and the five before it (history, carried-over "nie dotyczy")
  async function wczytajOkresy(o) {
    var lista = [];
    for (var i = 0; i < HIST; i++) { var p = okAdd(o, -i); if (!wczytane[p]) lista.push(p); }
    if (!lista.length) return;
    var rows = [];
    for (var from = 0; ; from += 1000) {
      var r = await window.sb.from(T).select('*').in('okres', lista).order('okres').order('nip').range(from, from + 999);
      if (r.error) throw new Error(r.error.message);
      rows = rows.concat(r.data || []);
      if (!r.data || r.data.length < 1000) break;
    }
    lista.forEach(function (p) { wczytane[p] = true; zam[p] = zam[p] || {}; potw[p] = potw[p] || {}; });
    rows.forEach(function (x) {
      // a save made while this was loading is newer than what came back
      if (wToku[x.okres + '|' + x.nip]) return;
      ustaw(zam, x.okres, x.nip, x); ustaw(potw, x.okres, x.nip, kopia(x));
    });
  }
  async function zmienOkres(o) {
    if (o > biezacy()) return;
    okres = o; naOkres(); rysuj();
    try { await wczytajOkresy(o); bladTabeli = ''; } catch (e) { bladTabeli = e.message || String(e); }
    if (okres === o) rysuj();
  }

  // ---------------- drawing ----------------
  function typ(c) { return [c.forma, c.opodatkowanie].filter(Boolean).join(' · '); }
  function widoczni() {
    var q = f.q.trim().toLowerCase(), qd = q.replace(/[\s-]/g, '');
    var l = klienci.filter(function (c) {
      if (f.op && (c.opiekun || '—') !== f.op) return false;
      if (f.typ && (typ(c) || '—') !== f.typ) return false;
      if (q && [c.nazwa, c.nip, c.miasto, c.kontakt, c.opiekun, c.email].join(' ').toLowerCase().indexOf(q) === -1 && !(/^\d+$/.test(qd) && c.nip.indexOf(qd) !== -1)) return false;
      if (f.st) {
        var s = c.s;
        if (f.st === 'zal' ? !s.zal : f.st === 'otw' ? s.zamk : s.status !== f.st) return false;
      }
      return true;
    });
    var nazwa = function (a, b) { return a.nazwa.localeCompare(b.nazwa, 'pl'); };
    var sorty = {
      nazwa: nazwa,
      opiekun: function (a, b) { return (a.opiekun || 'żżż').localeCompare(b.opiekun || 'żżż', 'pl') || nazwa(a, b); },
      malo: function (a, b) { return a.s.ile - b.s.ile || nazwa(a, b); },
      duzo: function (a, b) { return b.s.ile - a.s.ile || nazwa(a, b); },
      zmiana: function (a, b) { return (b.s.zmiana || '').localeCompare(a.s.zmiana || '') || nazwa(a, b); },
    };
    return l.sort(sorty[f.sort] || nazwa);
  }
  function ktoKiedy(s, e, dz) {
    if (!e) return s.nazwa + ' — do zrobienia';
    return s.nazwa + ' — ' + (e.nd ? 'nie dotyczy' : 'zrobione') + (dz ? ' (przeniesione z poprzedniego miesiąca)' : '') + (e.by ? ' · ' + e.by : '') + (e.at ? ' · ' + plDT(e.at) : '');
  }
  function komorka(c, s, st) {
    var e = st.k[s.id], cls = 'st' + (e ? (e.nd ? ' nd' : ' done') : '') + (e && st.dz ? ' inh' : '') + (st.zamk && s.id !== ZAMK ? ' lock' : '');
    if (wToku[okres + '|' + c.nip]) cls += ' busy';
    var moze = !!c.nip && !bladTabeli;
    return '<td class="stc"><button type="button" class="' + cls + '" data-i="' + c.i + '" data-s="' + s.id + '"' + (moze ? '' : ' disabled') +
      ' aria-pressed="' + (e && !e.nd ? 'true' : 'false') + '" aria-label="' + esc(s.nazwa + ' — ' + c.nazwa) + '" title="' + esc(c.nip ? ktoKiedy(s, e, st.dz) : 'Brak NIP w bazie klientów') + '">' +
      (e ? (e.nd ? 'n/d' : '✓') : '') + '</button><small>' + esc(s.krotko) + '</small></td>';
  }
  function pigulka(s) {
    var p = STATUS[s.status];
    return '<span class="pill ' + p[1] + '">' + p[0] + (s.status === 'wtoku' ? ' ' + s.ile + '/' + KROKI.length : '') + '</span>' + (s.zal ? ' <span class="pill p-red">zaległe</span>' : '');
  }
  function rysujOkres() {
    $('pName').textContent = okNazwa(okres);
    $('pNext').disabled = okres >= biezacy();
    $('pNow').className = 'mini' + (okres === zamykany() ? ' on' : '');
    var termin = plD(okAdd(okres, 1) + '-' + pad(ZAL_DZIEN));
    $('pInfo').textContent = okres === biezacy() ? 'Miesiąc jeszcze trwa.' : poTerminie(okres) ? 'Po terminie (' + termin + ') — niezamknięte są zaległe.' : 'Zamknięcie do ' + termin + ', potem niezamknięte są zaległe.';
  }
  function rysujPodsumowanie() {
    var n = { all: klienci.length, zamk: 0, wtoku: 0, nowy: 0, zal: 0 }, ops = {};
    klienci.forEach(function (c) {
      n[c.s.status]++; if (c.s.zal) n.zal++;
      var o = ops[c.opiekun || '—'] = ops[c.opiekun || '—'] || { all: 0, zamk: 0, wtoku: 0, zal: 0 };
      o.all++; if (c.s.zamk) o.zamk++; else if (c.s.status === 'wtoku') o.wtoku++; if (c.s.zal) o.zal++;
    });
    var kaf = [['', 'Klienci razem', n.all, ''], ['zamk', 'Zamknięte', n.zamk, 'green'], ['wtoku', 'W toku', n.wtoku, 'amber'], ['nowy', 'Nie rozpoczęte', n.nowy, ''], ['zal', 'Zaległe', n.zal, 'red']];
    $('tiles').innerHTML = kaf.map(function (t) {
      return '<button type="button" class="tile ' + (t[2] ? t[3] : 'zero') + (f.st === t[0] && t[0] ? ' on' : '') + '" data-st="' + t[0] + '"><b>' + t[2] + '</b><span>' + t[1] + '</span></button>';
    }).join('');
    var names = Object.keys(ops).sort(function (a, b) { return (a === '—') - (b === '—') || a.localeCompare(b, 'pl'); });
    $('ops').innerHTML = names.length ? names.map(function (name) {
      var o = ops[name];
      return '<div class="op' + (f.op === name ? ' on' : '') + '" data-op="' + esc(name) + '" role="button" tabindex="0"><div class="l"><b>' + esc(name === '—' ? 'Bez opiekuna' : name) + '</b>' +
        '<small>' + o.zamk + ' / ' + o.all + ' zamkniętych' + (o.zal ? ' · ' + o.zal + ' zaległych' : '') + '</small></div>' +
        '<div class="bar"><i class="g" style="width:' + (o.zamk / o.all * 100).toFixed(1) + '%"></i><i class="a" style="width:' + (o.wtoku / o.all * 100).toFixed(1) + '%"></i></div></div>';
    }).join('') : '<div class="empty">Brak klientów.</div>';
  }
  function rysujFiltry() {
    var opcje = function (vals, cur, all) {
      if (cur && vals.indexOf(cur) === -1) vals.push(cur);
      return '<option value="">' + all + '</option>' + vals.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v === '—' ? '— brak —' : v) + '</option>'; }).join('');
    };
    var uniq = function (fn) { var s = {}; klienci.forEach(function (c) { s[fn(c) || '—'] = 1; }); return Object.keys(s).sort(function (a, b) { return (a === '—') - (b === '—') || a.localeCompare(b, 'pl'); }); };
    $('fOp').innerHTML = opcje(uniq(function (c) { return c.opiekun; }), f.op, 'Wszyscy');
    $('fTyp').innerHTML = opcje(uniq(typ), f.typ, 'Wszystkie');
    $('fSt').value = f.st; $('fSort').value = f.sort;
    if ($('q').value !== f.q && document.activeElement !== $('q')) $('q').value = f.q;
  }
  function rysujTabele() {
    $('thead').innerHTML = '<tr><th>Klient</th><th>Opiekun</th>' + KROKI.map(function (s) { return '<th class="stc" title="' + esc(s.nazwa) + '">' + esc(s.krotko) + '</th>'; }).join('') + '<th>Status</th></tr>';
    var cols = KROKI.length + 3;
    if (!gotowe) { $('rows').innerHTML = '<tr><td class="empty" colspan="' + cols + '">Ładowanie…</td></tr>'; $('count').textContent = ''; return; }
    var l = widoczni();
    var html = bladTabeli ? '<tr><td colspan="' + cols + '"><span class="pill p-red">Nie udało się wczytać zamknięć</span> <span class="sub">' + esc(bladTabeli) + ' — zaznaczanie jest wyłączone. Odśwież stronę.</span></td></tr>' : '';
    html += l.map(function (c) {
      var s = c.s;
      return '<tr class="' + (s.zal ? 'late' : '') + '"><td class="kn"><a href="#" class="tl" data-det="' + c.i + '">' + esc(c.nazwa || '(bez nazwy)') + '</a>' +
        (s.uwagi ? '<span class="note" title="' + esc(s.uwagi) + '" aria-label="Są uwagi">💬</span>' : '') +
        '<small>' + (c.nip ? 'NIP ' + esc(c.nip) : '<span class="pill p-red">brak NIP</span>') + (typ(c) ? ' · ' + esc(typ(c)) : '') + '</small></td>' +
        '<td class="opc">' + esc(c.opiekun || '—') + '</td>' +
        KROKI.map(function (k) { return komorka(c, k, s); }).join('') +
        '<td class="stat">' + pigulka(s) + '</td></tr>';
    }).join('');
    if (!l.length) html += '<tr><td class="empty" colspan="' + cols + '">' + (klienci.length ? 'Żaden klient nie pasuje do filtrów.' : 'Brak klientów w bazie.') + '</td></tr>';
    $('rows').innerHTML = html;
    $('count').textContent = 'Pokazano ' + l.length + ' z ' + klienci.length + ' klientów · ' + okNazwa(okres);
  }
  function rysuj() {
    klienci.forEach(function (c) { c.s = stan(c.nip, okres); });
    rysujOkres(); rysujPodsumowanie(); rysujFiltry(); rysujTabele();
    if (otwarty >= 0) rysujSzczegolyStan();
  }

  // ---------------- client detail ----------------
  function terminy(c, o) {
    // optional module of the deadline calendar; the page works without it
    var KT = window.KsiegTerminy;
    if (!KT || typeof KT.dlaKlienta !== 'function') return null;
    try {
      var rok = +o.slice(0, 4), m = +o.slice(5, 7);
      var l = KT.dlaKlienta(c, rok, m);
      if (!Array.isArray(l)) return null;
      var wMies = function (x) { return x && typeof x.data === 'string' && x.data.slice(0, 7) === o; };
      // months counted from 0 in the module: ask again
      if (l.length && !l.some(wMies)) { var l2 = KT.dlaKlienta(c, rok, m - 1); if (Array.isArray(l2) && l2.some(wMies)) l = l2; }
      return l.filter(wMies).sort(function (a, b) { return a.data.localeCompare(b.data); });
    } catch (e) { return null; }
  }
  function otworz(i) {
    var c = klienci[i]; if (!c) return;
    otwarty = i;
    $('dName').textContent = c.nazwa || '(bez nazwy)';
    $('dSub').textContent = [c.nip ? 'NIP ' + c.nip : 'brak NIP', typ(c), c.opiekun ? 'opiekun: ' + c.opiekun : 'bez opiekuna'].filter(Boolean).join(' · ');
    var mr = mikrorachunek(c.nip);
    $('dAcct').innerHTML = mr
      ? '<div class="acct"><code id="dMr">' + esc(mr) + '</code><button type="button" class="mini" id="dCopy">Kopiuj</button><span class="sub" id="dCopyMsg"></span></div>' +
        '<p class="hint" style="margin:6px 0 0">Indywidualny rachunek do wpłat PIT, CIT i VAT, wyliczony z NIP. Przed podaniem klientowi można go potwierdzić w generatorze na podatki.gov.pl.</p>'
      : '<p class="hint" style="margin:0">Brak poprawnego NIP (10 cyfr) w bazie klientów — nie można wyliczyć mikrorachunku.</p>';
    var pola = [['Nazwa', c.nazwa], ['NIP', c.nip], ['Forma prawna', c.forma], ['Opodatkowanie', c.opodatkowanie], ['Adres', c.adres], ['Miasto', c.miasto], ['Osoba kontaktowa', c.kontakt],
      ['Telefon', c.telefon], ['E-mail', c.email], ['Opiekun (księgowość)', c.opiekun], ['Kadrowy', c.kadrowy], ['Telegram', c.telegram], ['Język', c.jezyk]];
    $('dData').innerHTML = pola.map(function (p) { return '<dt>' + p[0] + '</dt><dd>' + (p[1] ? esc(p[1]) : '<span class="sub">—</span>') + '</dd>'; }).join('');
    $('dUwMsg').textContent = '';
    rysujSzczegolyStan(true);
    $('det').hidden = false;
    $('dClose').focus();
  }
  // the parts of the detail that change with the period and with every tick
  function rysujSzczegolyStan(odNowa) {
    var c = klienci[otwarty]; if (!c) return;
    var s = stan(c.nip, okres), moze = !!c.nip && !bladTabeli;
    $('dStepsH').textContent = 'Zamknięcie miesiąca — ' + okNazwa(okres);
    $('dSteps').innerHTML = KROKI.map(function (k) {
      var e = s.k[k.id], zablok = !moze || (s.zamk && k.id !== ZAMK);
      var info = e ? (e.nd ? 'nie dotyczy' : 'zrobione') + (s.dz ? ' — przeniesione z poprzedniego miesiąca' : '') + (e.by ? ' · ' + esc(e.by) : '') + (e.at ? ' · ' + plDT(e.at) : '') : 'do zrobienia';
      return '<div class="dstep"><div class="n"><b>' + esc(k.nazwa) + '</b> ' + (e ? '<span class="pill ' + (e.nd ? 'p-grey' : 'p-ok') + '">' + (e.nd ? 'n/d' : '✓') + '</span>' : '') + '<small>' + info + '</small></div>' +
        '<div class="acts" data-s="' + k.id + '">' +
        '<button type="button" class="mini' + (e && !e.nd ? ' ok' : '') + '" data-t="' + (e && !e.nd ? 'clear' : 'done') + '"' + (zablok ? ' disabled' : '') + '>' + (e && !e.nd ? 'Cofnij' : k.id === ZAMK ? 'Zamknij miesiąc' : 'Zrobione') + '</button>' +
        (k.id !== ZAMK ? '<button type="button" class="mini' + (e && e.nd ? ' on' : '') + '" data-t="nd"' + (zablok ? ' disabled' : '') + '>' + (e && e.nd ? 'Jednak dotyczy' : 'Nie dotyczy') + '</button>' : '') +
        '</div></div>';
    }).join('');
    var ta = $('dUwagi');
    if (odNowa || (document.activeElement !== ta && ta.dataset.okres !== okres)) { ta.value = s.uwagi; ta.dataset.okres = okres; ta.dataset.bylo = s.uwagi; }
    ta.disabled = !moze; $('dUwSave').disabled = !moze;
    var h = '';
    for (var i = 0; i < HIST; i++) {
      var o = okAdd(okres, -i);
      var hs = stan(c.nip, o), znany = !!wczytane[o];
      h += '<div data-ok="' + o + '" class="' + (i ? '' : 'cur') + '" title="Pokaż ten miesiąc"><b>' + esc(okNazwa(o)) + '</b>' + (znany ? pigulka(hs) : '<span class="pill p-grey">…</span>') + '</div>';
    }
    $('dHist').innerHTML = h;
    // deadlines fall in the month after the period being closed
    var mt = okAdd(okres, 1), t = terminy(c, mt);
    $('dTermBox').hidden = !t;
    if (t) {
      $('dTermH').textContent = 'Terminy klienta — ' + okNazwa(mt);
      $('dTerm').innerHTML = t.length ? t.map(function (x) {
        return '<div class="term"><b>' + esc(plD(x.data)) + '</b><div>' + esc(x.nazwa) + (x.niepewne ? ' <span class="pill p-amber">do potwierdzenia</span>' : '') + (x.podstawa ? '<small>' + esc(x.podstawa) + '</small>' : '') + '</div></div>';
      }).join('') : '<p class="hint" style="margin:0">Brak terminów w tym miesiącu.</p>';
    }
  }
  function zapiszUwagi() {
    var c = klienci[otwarty], ta = $('dUwagi'); if (!c || !c.nip) return;
    var o = ta.dataset.okres || okres, txt = ta.value.trim().slice(0, 2000);
    if (txt === (ta.dataset.bylo || '')) return;
    $('dUwMsg').textContent = 'Zapisuję…';
    zapisz(c.nip, o, function (row) { row.uwagi = txt || null; return ''; }).then(function (ok) {
      if (ok) ta.dataset.bylo = txt;
      $('dUwMsg').textContent = ok ? 'Zapisano ' + plDT(new Date().toISOString()) : 'Nie zapisano.';
    });
  }
  function zamknij() { if (otwarty < 0) return; zapiszUwagi(); otwarty = -1; $('det').hidden = true; }
  function kopiuj(txt, done) {
    var fallback = function () {
      var t = document.createElement('textarea'); t.value = txt; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      t.remove(); done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { done(true); }, fallback); else fallback();
  }

  // ---------------- events ----------------
  $('pPrev').addEventListener('click', function () { zmienOkres(okAdd(okres, -1)); });
  $('pNext').addEventListener('click', function () { zmienOkres(okAdd(okres, 1)); });
  $('pNow').addEventListener('click', function () { zmienOkres(zamykany()); });
  $('q').addEventListener('input', function () { f.q = this.value; pamietaj(); rysujTabele(); });
  [['fOp', 'op'], ['fTyp', 'typ'], ['fSt', 'st'], ['fSort', 'sort']].forEach(function (p) {
    $(p[0]).addEventListener('change', function () { f[p[1]] = this.value; pamietaj(); rysuj(); });
  });
  $('fClear').addEventListener('click', function () { f = { q: '', op: '', typ: '', st: '', sort: 'nazwa' }; $('q').value = ''; pamietaj(); rysuj(); });
  $('tiles').addEventListener('click', function (e) {
    var t = e.target.closest('[data-st]'); if (!t) return;
    var v = t.getAttribute('data-st'); f.st = f.st === v ? '' : v; pamietaj(); rysuj();
  });
  function opKlik(e) {
    var t = e.target.closest('[data-op]'); if (!t) return;
    if (e.type === 'keydown') { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); }
    var v = t.getAttribute('data-op'); f.op = f.op === v ? '' : v; pamietaj(); rysuj();
  }
  $('ops').addEventListener('click', opKlik);
  $('ops').addEventListener('keydown', opKlik);
  $('rows').addEventListener('click', function (e) {
    var d = e.target.closest('[data-det]');
    if (d) { e.preventDefault(); otworz(+d.getAttribute('data-det')); return; }
    var b = e.target.closest('button.st'); if (!b || b.disabled) return;
    var c = klienci[+b.getAttribute('data-i')]; if (c) klik(c.nip, b.getAttribute('data-s'), 'toggle');
  });
  // right click on a step = "nie dotyczy"
  $('rows').addEventListener('contextmenu', function (e) {
    var b = e.target.closest('button.st'); if (!b || b.disabled) return;
    e.preventDefault();
    var c = klienci[+b.getAttribute('data-i')]; if (c) klik(c.nip, b.getAttribute('data-s'), 'nd');
  });
  $('dSteps').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-t]'); if (!b || b.disabled) return;
    var c = klienci[otwarty]; if (c) klik(c.nip, b.parentNode.getAttribute('data-s'), b.getAttribute('data-t'));
  });
  $('dHist').addEventListener('click', function (e) {
    var d = e.target.closest('[data-ok]'); if (!d) return;
    zapiszUwagi(); zmienOkres(d.getAttribute('data-ok'));
  });
  $('dAcct').addEventListener('click', function (e) {
    if (!e.target.closest('#dCopy')) return;
    kopiuj($('dMr').textContent.replace(/\s/g, ''), function (ok) { $('dCopyMsg').textContent = ok ? 'Skopiowano (bez spacji).' : 'Nie udało się skopiować — zaznacz numer ręcznie.'; });
  });
  $('dUwSave').addEventListener('click', zapiszUwagi);
  $('dUwagi').addEventListener('change', zapiszUwagi);
  $('dClose').addEventListener('click', zamknij);
  $('det').addEventListener('click', function (e) { if (e.target === $('det')) zamknij(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') zamknij(); });

  // ---------------- load ----------------
  async function load() {
    if (!window.sb) return;
    me = (window.PortalUser && window.PortalUser.email) || '';
    rysuj();
    var k = wczytajKlientow().catch(function (e) { return e; });
    try { await wczytajOkresy(okres); } catch (e) { bladTabeli = e.message || String(e); }
    var err = await k;
    gotowe = true;
    if (err instanceof Error) {
      rysuj();
      $('rows').innerHTML = '<tr><td class="empty">Nie udało się wczytać bazy klientów: ' + esc(err.message) + '</td></tr>';
      return;
    }
    rysuj();
  }
  document.addEventListener('portal:access', function () { me = (window.PortalUser && window.PortalUser.email) || me; });
  load();
})();
