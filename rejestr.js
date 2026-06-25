/* Registry: all client firms (from the Google Sheet via klienci-list) + all
   workers (zatrudnienie_zgloszenia), grouped by employer NIP. Portal-only. */
(function () {
  'use strict';
  var SUPABASE_URL = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnh3a3hwenFxanRtZ3F3b3p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQxODksImV4cCI6MjA4ODgzMDE4OX0.sUFX90FKNuxM7u8ftOlDKdf1iD4gsfq2T3S0FDzRdC0';
  var KLIENCI_FN = SUPABASE_URL + '/functions/v1/klienci-list';
  var TABLE = 'zatrudnienie_zgloszenia';

  var firms = [], workers = [], byNip = {}, tab = 'firmy', q = '';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function digits(s) { return (s || '').replace(/[^0-9]/g, ''); }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('pl-PL'); } catch (e) { return iso; } }
  var STL = { nowe: 'Nowe', sprawdzone: 'Sprawdzone', wyslane: 'Wysłane' };

  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    tab = b.getAttribute('data-t');
    document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + tab); });
    render();
  });
  $('search').addEventListener('input', function (e) { q = e.target.value.toLowerCase().trim(); render(); });

  async function load() {
    if (!window.sb) return;
    var token = '';
    try { var s = await window.sb.auth.getSession(); token = s.data.session ? s.data.session.access_token : ''; } catch (e) {}
    // firms
    try {
      var res = await fetch(KLIENCI_FN, { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token } });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      firms = data.clients || [];
    } catch (e) {
      $('panel-firmy').innerHTML = '<div class="empty">Nie udało się wczytać firm: ' + esc(e.message || e) + '</div>';
    }
    // workers
    try {
      var w = await window.sb.from(TABLE).select('id,worker_name,status,created_at,payload').order('created_at', { ascending: false }).limit(2000);
      workers = (w.data || []);
    } catch (e) { workers = []; }
    // group workers by employer NIP (fallback: firm name)
    byNip = {};
    workers.forEach(function (wk) {
      var p = wk.payload || {};
      var key = digits(p.z_nip) || ('nazwa:' + (p.z_nazwa || '').toLowerCase().trim());
      (byNip[key] = byNip[key] || []).push(wk);
    });
    render();
  }

  function workersFor(f) {
    return byNip[digits(f.nip)] || byNip['nazwa:' + (f.nazwa || '').toLowerCase().trim()] || [];
  }
  function badge(st) { return '<span class="badge b-' + (st || 'nowe') + '">' + esc(STL[st] || st) + '</span>'; }

  function render() {
    renderFirmy();
    renderPracownicy();
    renderTerminy();
  }

  var EXP = [
    { k: 'p_karta_do', label: 'Karta pobytu' },
    { k: 'p_paszport_do', label: 'Paszport' },
    { k: 'p_zezwolenie_do', label: 'Zezwolenie/wiza' },
    { k: 'p_badania_do', label: 'Badania (medkomisja)' },
  ];
  function daysLeft(iso) { return Math.floor((new Date(iso + 'T00:00:00') - new Date()) / 86400000); }
  function termClass(d) { return d < 0 ? 'term-exp' : d <= 30 ? 'term-soon' : d <= 60 ? 'term-warn' : 'term-ok'; }
  function termText(d) { return d < 0 ? 'po terminie (' + (-d) + ' dni)' : 'za ' + d + ' dni'; }

  function renderTerminy() {
    var el = $('panel-terminy');
    var items = [];
    workers.forEach(function (w) {
      var p = w.payload || {};
      EXP.forEach(function (e) {
        var v = p[e.k];
        if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
          items.push({ name: w.worker_name || '(bez nazwy)', firma: p.z_nazwa || '—', doc: e.label, date: v, d: daysLeft(v) });
        }
      });
    });
    if (q) items = items.filter(function (it) { return (it.name + ' ' + it.firma + ' ' + it.doc).toLowerCase().indexOf(q) !== -1; });
    items.sort(function (a, b) { return a.d - b.d; });
    if (!items.length) { el.innerHTML = '<div class="empty">Brak wczytanych terminów ważności. Pojawią się po przesłaniu dokumentów ze zgłoszenia.</div>'; return; }
    var rows = items.map(function (it) {
      return '<tr><td>' + esc(it.name) + '</td><td>' + esc(it.firma) + '</td><td>' + esc(it.doc) + '</td>' +
        '<td>' + esc(it.date) + '</td>' +
        '<td><span class="term-pill ' + termClass(it.d) + '">' + termText(it.d) + '</span></td></tr>';
    }).join('');
    el.innerHTML = '<table class="flat"><thead><tr><th>Pracownik</th><th>Firma</th><th>Dokument</th><th>Ważny do</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderFirmy() {
    var el = $('panel-firmy');
    var list = firms.filter(function (f) {
      if (!q) return true;
      return (f.nazwa + ' ' + f.nip + ' ' + f.miasto + ' ' + f.opiekun + ' ' + f.kadrowy).toLowerCase().indexOf(q) !== -1
        || workersFor(f).some(function (w) { return (w.worker_name || '').toLowerCase().indexOf(q) !== -1; });
    });
    if (!list.length) { el.innerHTML = '<div class="empty">Brak firm.</div>'; return; }
    el.innerHTML = '';
    list.forEach(function (f) {
      var ws = workersFor(f);
      var card = document.createElement('div');
      card.className = 'firm';
      card.innerHTML =
        '<div class="firm-head">' +
          '<div class="firm-main"><strong>' + esc(f.nazwa) + '</strong>' +
            '<small>NIP ' + esc(f.nip || '—') + (f.miasto ? ' · ' + esc(f.miasto) : '') +
            (f.opiekun ? ' · opiekun: ' + esc(f.opiekun) : '') + '</small></div>' +
          '<span class="pill' + (ws.length ? '' : ' zero') + '">' + ws.length + ' prac.</span>' +
          '<span class="chev">›</span>' +
        '</div>' +
        '<div class="firm-body">' +
          '<div class="kv">' +
            (f.adres ? '<div><b>Adres:</b> ' + esc(f.adres) + '</div>' : '') +
            (f.forma ? '<div><b>Forma:</b> ' + esc(f.forma) + '</div>' : '') +
            (f.opodatkowanie ? '<div><b>Opodatkowanie:</b> ' + esc(f.opodatkowanie) + '</div>' : '') +
            (f.telefon ? '<div><b>Tel:</b> ' + esc(f.telefon) + '</div>' : '') +
            (f.email ? '<div><b>E-mail:</b> ' + esc(f.email) + '</div>' : '') +
            (f.kontakt ? '<div><b>Kontakt:</b> ' + esc(f.kontakt) + '</div>' : '') +
            (f.kadrowy ? '<div><b>Kadrowy:</b> ' + esc(f.kadrowy) + '</div>' : '') +
            (f.jezyk ? '<div><b>Język:</b> ' + esc(f.jezyk) + '</div>' : '') +
            (f.telegram ? '<div><b>Telegram:</b> ' + esc(f.telegram) + '</div>' : '') +
          '</div>' +
          (ws.length
            ? '<ul class="wlist">' + ws.map(function (w) {
                return '<li><span class="nm">' + esc(w.worker_name || '(bez nazwy)') + '</span>' + badge(w.status) +
                  '<a class="tlink" href="zatrudnienie.html">otwórz →</a></li>';
              }).join('') + '</ul>'
            : '<div class="muted" style="font-size:13px">Brak zgłoszonych pracowników.</div>') +
        '</div>';
      card.querySelector('.firm-head').addEventListener('click', function () { card.classList.toggle('open'); });
      el.appendChild(card);
    });
  }

  function firmNameForWorker(w) {
    var p = w.payload || {};
    return p.z_nazwa || '—';
  }

  function renderPracownicy() {
    var el = $('panel-pracownicy');
    var list = workers.filter(function (w) {
      if (!q) return true;
      var p = w.payload || {};
      return ((w.worker_name || '') + ' ' + (p.z_nazwa || '') + ' ' + (p.z_nip || '')).toLowerCase().indexOf(q) !== -1;
    });
    if (!list.length) { el.innerHTML = '<div class="empty">Brak pracowników.</div>'; return; }
    var rows = list.map(function (w) {
      return '<tr><td>' + esc(w.worker_name || '(bez nazwy)') + '</td>' +
        '<td>' + esc(firmNameForWorker(w)) + '</td>' +
        '<td>' + badge(w.status) + '</td>' +
        '<td class="muted">' + fmtDate(w.created_at) + '</td>' +
        '<td><a class="tlink" href="zatrudnienie.html">otwórz →</a></td></tr>';
    }).join('');
    el.innerHTML = '<table class="flat"><thead><tr><th>Pracownik</th><th>Firma</th><th>Status</th><th>Data</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  load();
})();
