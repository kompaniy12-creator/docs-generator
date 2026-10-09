/* Registry: all client firms (from the Google Sheet via klienci-list) + all
   workers (zatrudnienie_zgloszenia), grouped by employer NIP. Portal-only. */
(function () {
  'use strict';
  var SUPABASE_URL = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnh3a3hwenFxanRtZ3F3b3p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQxODksImV4cCI6MjA4ODgzMDE4OX0.sUFX90FKNuxM7u8ftOlDKdf1iD4gsfq2T3S0FDzRdC0';
  var KLIENCI_FN = SUPABASE_URL + '/functions/v1/klienci-list';
  var TABLE = 'zatrudnienie_zgloszenia';

  // workers = current people; archive = former staff, kept apart (status 'archiwum')
  var firms = [], workers = [], archive = [], byNip = {}, tab = 'firmy', q = '';
  // employers of registered workers that are not in the client base: shown as well, so that nobody is lost
  var spoza = [];
  function wszystkieFirmy() { return firms.concat(spoza); }
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function digits(s) { return (s || '').replace(/[^0-9]/g, ''); }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('pl-PL'); } catch (e) { return iso; } }
  var STL = { nowe: 'Nowe', sprawdzone: 'Sprawdzone', wyslane: 'Wysłane', zatrudniony: 'Zatrudniony', archiwum: 'Archiwum' };

  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    tab = b.getAttribute('data-t');
    document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + tab); });
    if (hasF) $('firmFilters').hidden = tab !== 'firmy';
    render();
  });
  $('search').addEventListener('input', function (e) { q = e.target.value.toLowerCase().trim(); render(); });
  // firm filters: with / without workers, by account manager (opiekun), sort order — remembered per browser
  var FKEY = 'tdcg_rejestr_filtry';
  var ff = { prac: '', opiekun: '', sort: '', obs: '' };
  try { ff = Object.assign(ff, JSON.parse(localStorage.getItem(FKEY) || '{}')); } catch (e) {}
  var hasF = !!$('fPrac'); // a page cached before the filters existed has no controls
  if (!hasF) ff = { prac: '', opiekun: '', sort: '', obs: '' };
  // service status from Baza klientów (klienci_obsluga): koniec[nip] = the day the service ended
  var koniec = {};
  function zakonczona(f) { var d = koniec[digits(f.nip)]; return d && d <= new Date().toISOString().slice(0, 10) ? d : ''; }
  if (hasF) {
    var lab = document.createElement('label');
    lab.innerHTML = 'Obsługa <select id="fObs"><option value="">wszystkie</option><option value="tak">obsługiwane</option><option value="nie">obsługa zakończona</option></select>';
    $('firmFilters').insertBefore(lab, $('fCount'));
  }
  ['fPrac', 'fOpiekun', 'fSort', 'fObs'].forEach(function (id) {
    if (hasF) $(id).addEventListener('change', function () {
      ff = { prac: $('fPrac').value, opiekun: $('fOpiekun').value, sort: $('fSort').value, obs: $('fObs').value };
      try { localStorage.setItem(FKEY, JSON.stringify(ff)); } catch (e) {}
      renderFirmy();
    });
  });
  function fillOpiekun() {
    if (!hasF) return;
    var names = {};
    firms.forEach(function (f) { names[(f.opiekun || '').trim()] = 1; });
    var list = Object.keys(names).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, 'pl'); });
    $('fOpiekun').innerHTML = '<option value="">wszyscy</option>' +
      list.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') +
      (names[''] ? '<option value="__brak">bez opiekuna</option>' : '');
    if (ff.opiekun && ff.opiekun !== '__brak' && list.indexOf(ff.opiekun) === -1) ff.opiekun = '';
    $('fPrac').value = ff.prac; $('fOpiekun').value = ff.opiekun; $('fSort').value = ff.sort; $('fObs').value = ff.obs || '';
  }

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
      workers = [];
      for (var from = 0; ; from += 1000) { // PostgREST returns at most 1000 rows per request
        var w = await window.sb.from(TABLE).select('id,worker_name,status,created_at,payload').order('created_at', { ascending: false }).range(from, from + 999);
        workers = workers.concat(w.data || []);
        if (!w.data || w.data.length < 1000) break;
      }
    } catch (e) { workers = []; }
    // which firms the office no longer serves; when this cannot be read, every firm shows as served
    try {
      var ob = await window.sb.from('klienci_obsluga').select('nip,koniec_od').eq('status', 'zakonczony');
      (ob.data || []).forEach(function (o) { if (o.nip && o.koniec_od) koniec[o.nip] = String(o.koniec_od).slice(0, 10); });
    } catch (e) {}
    regroup();
    fillOpiekun();
    render();
  }

  function regroup() {
    var all = workers.concat(archive);
    workers = all.filter(function (w) { return w.status !== 'archiwum'; });
    archive = all.filter(function (w) { return w.status === 'archiwum'; });
    // group workers by employer NIP (fallback: firm name)
    byNip = {};
    workers.forEach(function (wk) {
      var p = wk.payload || {};
      var key = digits(p.z_nip) || ('nazwa:' + (p.z_nazwa || '').toLowerCase().trim());
      (byNip[key] = byNip[key] || []).push(wk);
    });
    var maja = {};
    firms.forEach(function (f) { maja[digits(f.nip)] = 1; maja['nazwa:' + (f.nazwa || '').toLowerCase().trim()] = 1; });
    spoza = Object.keys(byNip).filter(function (k) { return !maja[k]; }).map(function (k) {
      var p = byNip[k][0].payload || {};
      return { nazwa: p.z_nazwa || '(pracodawca bez nazwy)', nip: /^\d+$/.test(k) ? k : '', miasto: '', opiekun: '', kadrowy: '', spoza: true, klucz: k };
    }).sort(function (a, b) { return a.nazwa.localeCompare(b.nazwa, 'pl'); });
  }

  // move a person to the archive of former staff, or back
  async function setStatus(id, status) {
    var u = await window.sb.from(TABLE).update({ status: status }).eq('id', id);
    if (u.error) { alert('Błąd: ' + u.error.message); return; }
    workers.concat(archive).forEach(function (w) { if (w.id === id) w.status = status; });
    regroup();
    render();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-move]'); if (!b) return;
    var to = b.getAttribute('data-move');
    if (to === 'archiwum' && !confirm('Przenieść tę osobę do archiwum byłych pracowników?')) return;
    setStatus(b.getAttribute('data-id'), to);
  });

  function workersFor(f) {
    if (f.spoza) return byNip[f.klucz] || [];
    return byNip[digits(f.nip)] || byNip['nazwa:' + (f.nazwa || '').toLowerCase().trim()] || [];
  }
  function badge(st) { return '<span class="badge b-' + (st || 'nowe') + '">' + esc(STL[st] || st) + '</span>'; }

  function render() {
    renderFirmy();
    renderPracownicy();
    renderTerminy();
    renderArchiwum();
  }

  function renderArchiwum() {
    var el = $('panel-archiwum');
    var list = archive.filter(function (w) {
      var p = w.payload || {};
      return !q || ((w.worker_name || '') + ' ' + (p.z_nazwa || '') + ' ' + (p.z_nip || '')).toLowerCase().indexOf(q) !== -1;
    });
    if (!list.length) { el.innerHTML = '<div class="empty">Archiwum jest puste. Byłych pracowników przenosisz tu przyciskiem „Do archiwum” na zakładce Pracownicy.</div>'; return; }
    el.innerHTML = '<table class="flat"><thead><tr><th>Pracownik</th><th>Firma</th><th>Umowa do</th><th></th></tr></thead><tbody>' +
      list.map(function (w) {
        var p = w.payload || {};
        return '<tr><td>' + esc(w.worker_name || '(bez nazwy)') + '</td><td>' + esc(p.z_nazwa || '—') + '</td><td class="muted">' + esc(p.u_do || '—') + '</td>' +
          '<td><button type="button" class="mini" data-move="zatrudniony" data-id="' + esc(w.id) + '">Przywróć</button></td></tr>';
      }).join('') + '</tbody></table>';
  }

  var EXP = [
    { k: 'p_karta_do', label: 'Karta pobytu' },
    { k: 'p_paszport_do', label: 'Paszport' },
    { k: 'p_zezwolenie_do', label: 'Zezwolenie/wiza' },
    { k: 'p_badania_do', label: 'Badania (medkomisja)' },
    { k: 'u_do', label: 'Umowa — koniec' },
  ];
  // whole calendar days from today (0 = today, 1 = tomorrow)
  function daysLeft(iso) { var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(iso + 'T00:00:00') - t) / 86400000); }
  function termClass(d) { return d < 0 ? 'term-exp' : d <= 30 ? 'term-soon' : d <= 60 ? 'term-warn' : 'term-ok'; }
  function termText(d) { return d < 0 ? 'po terminie (' + (-d) + ' dni)' : d === 0 ? 'dziś' : d === 1 ? 'jutro' : 'za ' + d + ' dni'; }

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
    var list = wszystkieFirmy().filter(function (f) {
      if (!q) return true;
      return (f.nazwa + ' ' + f.nip + ' ' + f.miasto + ' ' + f.opiekun + ' ' + f.kadrowy).toLowerCase().indexOf(q) !== -1
        || workersFor(f).some(function (w) { return (w.worker_name || '').toLowerCase().indexOf(q) !== -1; });
    });
    list = list.filter(function (f) {
      var n = workersFor(f).length, op = (f.opiekun || '').trim();
      if (ff.prac === 'tak' && !n) return false;
      if (ff.prac === 'nie' && n) return false;
      if (ff.obs === 'tak' && zakonczona(f)) return false;
      if (ff.obs === 'nie' && !zakonczona(f)) return false;
      if (ff.opiekun === '__brak') return !op;
      return !ff.opiekun || op === ff.opiekun;
    });
    if (ff.sort) {
      list = list.slice().sort(function (a, b) {
        var byName = (a.nazwa || '').localeCompare(b.nazwa || '', 'pl');
        if (ff.sort === 'prac') return workersFor(b).length - workersFor(a).length || byName;
        if (ff.sort === 'opiekun') return (a.opiekun || 'żżż').localeCompare(b.opiekun || 'żżż', 'pl') || byName;
        return byName;
      });
    }
    if (hasF) $('fCount').textContent = list.length + ' z ' + wszystkieFirmy().length + ' firm';
    if (!list.length) { el.innerHTML = '<div class="empty">Brak firm dla tych filtrów.</div>'; return; }
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
          (f.spoza ? '<span class="pill zero" title="Pracodawca z rejestru pracowników, którego nie ma w bazie klientów (inny NIP albo klient usunięty z bazy)">spoza bazy klientów</span>' : '') +
          (zakonczona(f) ? '<span class="pill zero">obsługa zakończona od ' + esc(zakonczona(f).split('-').reverse().join('.')) + '</span>' : '') +
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
                // a submission still in progress opens in the task list; a hired worker is no longer there —
                // the link leads to that worker's deadlines in Kontrola
                return '<li><span class="nm">' + esc(w.worker_name || '(bez nazwy)') + '</span>' + badge(w.status) +
                  (w.status === 'zatrudniony' ? '<a class="tlink" href="kontrola.html#w=' + esc(w.id) + '">terminy →</a>' : '<a class="tlink" href="zatrudnienie.html">otwórz →</a>') + '</li>';
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
        '<td>' + (w.status === 'zatrudniony'
          ? '<button type="button" class="mini" data-move="archiwum" data-id="' + esc(w.id) + '">Do archiwum</button>'
          : '<a class="tlink" href="zatrudnienie.html">otwórz →</a>') + '</td></tr>';
    }).join('');
    el.innerHTML = '<table class="flat"><thead><tr><th>Pracownik</th><th>Firma</th><th>Status</th><th>Data</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  load();
})();
