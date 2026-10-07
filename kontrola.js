/* Kontrola: one screen with everything the HR team has to act on.
   Built from zatrudnienie_zgloszenia (new submissions + the registry of workers):
   - new submissions waiting for review,
   - documents (karta pobytu, paszport, zezwolenie / wiza, badania) and contracts
     that have expired or expire within 30 / 60 days,
   - workers with missing key data. */
(function () {
  'use strict';
  var TABLE = 'zatrudnienie_zgloszenia';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pl(iso) { var p = (iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : (iso || ''); }
  // whole calendar days from today (0 = today, 1 = tomorrow)
  function daysLeft(iso) { var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(iso + 'T00:00:00') - t) / 86400000); }
  function isDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || ''); }

  var DOCS = [
    { k: 'p_karta_do', label: 'Karta pobytu' },
    { k: 'p_paszport_do', label: 'Paszport' },
    { k: 'p_zezwolenie_do', label: 'Zezwolenie / wiza' },
    { k: 'p_badania_do', label: 'Badania lekarskie' },
    { k: 'u_do', label: 'Umowa — koniec', contract: true },
  ];
  var rows = [], view = 'nowe', q = '';

  function foreigner(p) { var o = (p.p_obywatelstwo || '').toLowerCase(); return !!o && !/^pol/.test(o); }
  function pill(d) {
    if (d < 0) return '<span class="pill p-red">po terminie ' + (-d) + ' dni</span>';
    if (d === 0) return '<span class="pill p-red">dziś</span>';
    if (d === 1) return '<span class="pill p-red">jutro</span>';
    if (d <= 30) return '<span class="pill p-red">za ' + d + ' dni</span>';
    if (d <= 60) return '<span class="pill p-amber">za ' + d + ' dni</span>';
    return '<span class="pill p-ok">za ' + d + ' dni</span>';
  }

  // every dated item of every worker
  function terms() {
    var out = [];
    rows.forEach(function (w) {
      var p = w.payload || {};
      DOCS.forEach(function (d) {
        var v = p[d.k];
        if (!isDate(v)) return;
        var left = daysLeft(v);
        out.push({ w: w, doc: d.label, date: v, d: left, contract: !!d.contract });
      });
    });
    return out.sort(function (a, b) { return a.d - b.d; });
  }
  function missing() {
    var out = [];
    rows.forEach(function (w) {
      var p = w.payload || {}, miss = [];
      if (!p.p_pesel && !p.p_dowod) miss.push('PESEL / nr dokumentu');
      if (!p.p_dataur) miss.push('data urodzenia');
      if (!p.p_obywatelstwo) miss.push('obywatelstwo');
      if (!p.a_miejscowosc) miss.push('adres');
      if (!p.u_typ && !p.u_umowa) miss.push('rodzaj umowy');
      if (foreigner(p) && !isDate(p.p_karta_do) && !isDate(p.p_zezwolenie_do)) miss.push('termin karty pobytu / zezwolenia');
      if (foreigner(p) && !isDate(p.p_paszport_do)) miss.push('termin paszportu');
      if (miss.length) out.push({ w: w, miss: miss });
    });
    return out.sort(function (a, b) { return b.miss.length - a.miss.length; });
  }

  var VIEWS = {
    nowe: {
      title: 'Nowe zgłoszenia', hint: 'Zgłoszenia od klientów, których nikt jeszcze nie sprawdził.',
      items: function () { return rows.filter(function (w) { return w.status === 'nowe'; }); },
      head: ['Pracownik', 'Firma', 'Umowa', 'Wysłane', ''],
      row: function (w) {
        var p = w.payload || {};
        return [esc(w.worker_name), esc(p.z_nazwa || '—'), esc(p.u_typ === 'praca' ? 'umowa o pracę' : p.u_typ === 'zlecenie' ? 'umowa zlecenie' : '—'),
          new Date(w.created_at).toLocaleString('pl-PL'), '<a class="tl" href="zatrudnienie.html">otwórz →</a>'];
      },
      text: function (w) { return (w.worker_name || '') + ' ' + ((w.payload || {}).z_nazwa || ''); },
    },
  };
  function termView(title, hint, test) {
    return {
      title: title, hint: hint,
      items: function () { return terms().filter(test); },
      head: ['Pracownik', 'Firma', 'Dokument', 'Ważny do', 'Termin', ''],
      row: function (t) { return [esc(t.w.worker_name), esc((t.w.payload || {}).z_nazwa || '—'), esc(t.doc), pl(t.date), pill(t.d), editBtn(t.w)]; },
      text: function (t) { return (t.w.worker_name || '') + ' ' + ((t.w.payload || {}).z_nazwa || '') + ' ' + t.doc; },
    };
  }
  VIEWS.po = termView('Dokumenty po terminie', 'Dokument stracił ważność — pracownik może nie mieć prawa do pobytu lub pracy.', function (t) { return !t.contract && t.d < 0; });
  VIEWS.d30 = termView('Dokumenty: do 30 dni', 'Kończą się w ciągu miesiąca — trzeba działać teraz.', function (t) { return !t.contract && t.d >= 0 && t.d <= 30; });
  VIEWS.d60 = termView('Dokumenty: 31–60 dni', 'Warto już uprzedzić pracownika i pracodawcę.', function (t) { return !t.contract && t.d > 30 && t.d <= 60; });
  VIEWS.umowy = termView('Umowy kończące się do 60 dni', 'Umowa wygasa — przedłużenie albo zakończenie współpracy.', function (t) { return t.contract && t.d >= 0 && t.d <= 60; });
  VIEWS.umowyPo = termView('Umowy po terminie', 'Data końca umowy już minęła, a osoba nadal jest na liście pracowników — przedłuż umowę albo zakończ zatrudnienie (także w wFirma).', function (t) { return t.contract && t.d < 0; });
  VIEWS.braki = {
    title: 'Braki w danych', hint: 'Pracownicy, którym brakuje danych potrzebnych do dokumentów lub do pilnowania terminów.',
    items: missing,
    head: ['Pracownik', 'Firma', 'Brakuje', ''],
    row: function (m) { return [esc(m.w.worker_name), esc((m.w.payload || {}).z_nazwa || '—'), esc(m.miss.join(', ')), editBtn(m.w)]; },
    text: function (m) { return (m.w.worker_name || '') + ' ' + ((m.w.payload || {}).z_nazwa || ''); },
  };
  VIEWS.wszyscy = {
    title: 'Wszyscy pracownicy', hint: 'Pełna lista jest w Rejestrze, z podziałem na firmy.',
    items: function () { return rows; },
    head: ['Pracownik', 'Firma', 'Status', 'Dodany', ''],
    row: function (w) { return [esc(w.worker_name), esc((w.payload || {}).z_nazwa || '—'), esc(w.status), new Date(w.created_at).toLocaleDateString('pl-PL'), editBtn(w)]; },
    text: function (w) { return (w.worker_name || '') + ' ' + ((w.payload || {}).z_nazwa || ''); },
  };
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function editBtn(w) { return '<button type="button" class="mini" data-edit="' + esc(w.id) + '">✎ terminy</button>'; }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // Statutory steps around a new hire, counted from the first day of work:
  //  - written contract before the person starts (for a foreigner: art. 5 of the 2025 act),
  //  - registration with ZUS within 7 days (art. 36 ust. 4 of the social insurance act),
  //  - foreigner: notification of the labour office within 7 days (art. 5a / art. 70 of the 2025 act).
  // Workers imported from wFirma are already running, so they are left out.
  function duties() {
    var out = [];
    rows.forEach(function (w) {
      var p = w.payload || {};
      if (p._import || !isDate(p.u_od)) return;
      var start = daysLeft(p.u_od);
      if (start < -45 || start > 14) return;
      if (w.status !== 'zatrudniony' && start <= 3) {
        out.push({ w: w, what: 'Umowa podpisana przed rozpoczęciem pracy', why: 'komplet nie jest jeszcze oznaczony jako podpisany', date: p.u_od, d: start, link: true });
      }
      if (w.status === 'nowe') return;
      if (!p.k_zus) out.push({ w: w, what: 'Zgłoszenie do ZUS', why: '7 dni od rozpoczęcia pracy', date: addDays(p.u_od, 7), d: start + 7, k: 'k_zus' });
      if (foreigner(p) && !p.k_pup) out.push({ w: w, what: 'Powiadomienie urzędu pracy (praca.gov.pl)', why: 'cudzoziemiec — ochrona czasowa lub oświadczenie: 7 dni od rozpoczęcia pracy; nie dotyczy? zaznacz jako zrobione', date: addDays(p.u_od, 7), d: start + 7, k: 'k_pup' });
    });
    return out.sort(function (a, b) { return a.d - b.d; });
  }
  VIEWS.obow = {
    title: 'Obowiązki po zatrudnieniu', hint: 'Terminy ustawowe liczone od pierwszego dnia pracy. Po wykonaniu kliknij „zrobione” — pozycja zniknie z listy.',
    items: duties,
    head: ['Pracownik', 'Firma', 'Co zrobić', 'Termin', '', ''],
    row: function (t) {
      return [esc(t.w.worker_name), esc((t.w.payload || {}).z_nazwa || '—'),
        '<b>' + esc(t.what) + '</b><br><span class="sub">' + esc(t.why) + '</span>', pl(t.date), pill(t.d),
        t.link ? '<a class="tl" href="zatrudnienie.html">otwórz →</a>' : '<button type="button" class="mini ok" data-done="' + t.k + '" data-id="' + esc(t.w.id) + '">✔ zrobione</button>'];
    },
    text: function (t) { return (t.w.worker_name || '') + ' ' + ((t.w.payload || {}).z_nazwa || '') + ' ' + t.what; },
  };

  var TILES = [
    { v: 'nowe', label: 'nowe zgłoszenia', cls: 'red' },
    { v: 'obow', label: 'obowiązki po zatrudnieniu', cls: 'red' },
    { v: 'po', label: 'dokumenty po terminie', cls: 'red' },
    { v: 'd30', label: 'dokumenty — do 30 dni', cls: 'red' },
    { v: 'd60', label: 'dokumenty — 31–60 dni', cls: 'amber' },
    { v: 'umowyPo', label: 'umowy po terminie', cls: 'red' },
    { v: 'umowy', label: 'umowy kończące się do 60 dni', cls: 'amber' },
    { v: 'braki', label: 'pracownicy z brakami w danych', cls: 'amber' },
    { v: 'wszyscy', label: 'pracowników w rejestrze', cls: 'green' },
  ];

  function render() {
    $('tiles').innerHTML = TILES.map(function (t) {
      var n = VIEWS[t.v].items().length;
      return '<button type="button" class="tile ' + (n ? t.cls : 'zero') + (t.v === view ? ' on' : '') + '" data-v="' + t.v + '"><b>' + n + '</b><span>' + t.label + '</span></button>';
    }).join('');
    var V = VIEWS[view];
    $('listTitle').textContent = V.title;
    $('listHint').textContent = V.hint;
    var items = V.items().filter(function (it) { return !q || V.text(it).toLowerCase().indexOf(q) !== -1; });
    if (!items.length) { $('list').innerHTML = '<tr><td class="empty">Nic do zrobienia w tej kategorii.</td></tr>'; return; }
    var more = items.length > 300 ? items.length - 300 : 0;
    $('list').innerHTML = '<thead><tr>' + V.head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      items.slice(0, 300).map(function (it) { return '<tr>' + V.row(it).map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      (more ? '<tr><td colspan="' + V.head.length + '" class="empty">…i jeszcze ' + more + ' — zawęź wyszukiwaniem.</td></tr>' : '') + '</tbody>';
  }

  $('tiles').addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]'); if (!b) return;
    view = b.getAttribute('data-v'); render();
  });
  // change a few payload fields of one worker without overwriting anything else
  async function patchWorker(id, fields) {
    var cur = await window.sb.from(TABLE).select('payload').eq('id', id).single();
    if (cur.error) throw new Error(cur.error.message);
    var payload = Object.assign({}, cur.data.payload || {}, fields);
    var u = await window.sb.from(TABLE).update({ payload: payload }).eq('id', id);
    if (u.error) throw new Error(u.error.message);
    rows.forEach(function (w) { if (w.id === id) w.payload = payload; });
  }
  var editing = null;
  $('list').addEventListener('click', async function (e) {
    var done = e.target.closest('[data-done]');
    if (done) {
      done.disabled = true;
      var f = {}; f[done.getAttribute('data-done')] = todayIso();
      try { await patchWorker(done.getAttribute('data-id'), f); render(); } catch (err) { alert('Błąd: ' + err.message); done.disabled = false; }
      return;
    }
    var ed = e.target.closest('[data-edit]'); if (!ed) return;
    editing = rows.filter(function (w) { return w.id === ed.getAttribute('data-edit'); })[0];
    if (!editing) return;
    var p = editing.payload || {};
    $('edName').textContent = (editing.worker_name || '') + (p.z_nazwa ? ' — ' + p.z_nazwa : '');
    DOCS.forEach(function (d) { $('ed_' + d.k).value = isDate(p[d.k]) ? p[d.k] : ''; });
    $('edMsg').textContent = '';
    $('edit').hidden = false;
  });
  $('edCancel').addEventListener('click', function () { $('edit').hidden = true; });
  $('edit').addEventListener('click', function (e) { if (e.target === $('edit')) $('edit').hidden = true; });
  $('edSave').addEventListener('click', async function () {
    var f = {}, bad = false;
    DOCS.forEach(function (d) {
      var v = $('ed_' + d.k).value;
      if (v && !isDate(v)) bad = true;
      f[d.k] = v || '';
    });
    if (bad) { $('edMsg').textContent = 'Popraw datę.'; return; }
    if (f.u_do) f.u_bezterminowo = false;
    this.disabled = true;
    try { await patchWorker(editing.id, f); $('edit').hidden = true; render(); loadReminders(); }
    catch (err) { $('edMsg').textContent = 'Błąd: ' + err.message; }
    this.disabled = false;
  });

  // ---------------- Reminders to employers (terminy function) ----------------
  var TERMINY_FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/terminy';
  async function terminy(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(TERMINY_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
    return out;
  }
  var JOB = { terminy: 'kontrola terminów', watchdog: 'samokontrola', prawo: 'przepisy i stawki' };
  async function loadReminders() {
    var box = $('rem');
    var info;
    try { info = await terminy({ action: 'preview' }); }
    catch (e) { box.innerHTML = '<div class="empty">Nie udało się wczytać przypomnień: ' + esc(e.message) + '</div>'; return; }
    var html = '<div class="mode">' +
      '<span class="pill ' + (info.mode === 'auto' ? 'p-ok' : 'p-grey') + '">' + (info.mode === 'auto' ? 'wysyłka automatyczna: włączona' : 'wysyłka automatyczna: wyłączona') + '</span> ' +
      (info.admin ? '<button type="button" class="mini" id="remMode" data-to="' + (info.mode === 'auto' ? 'off' : 'auto') + '">' + (info.mode === 'auto' ? 'Wyłącz' : 'Włącz automat') + '</button>' : '') +
      '<span class="sub"> E-maile wychodzą z ' + esc(info.mail_from) + ' codziennie rano; kopia trafia do tej skrzynki.</span></div>';
    if (!info.mail_configured) html += '<div class="warnbox">Poczta nie jest skonfigurowana — przypomnienia nie zostaną wysłane.</div>';
    if (info.klienciBlad) html += '<div class="warnbox">' + esc(info.klienciBlad) + '</div>';
    if (!info.firmy.length) html += '<div class="empty">Dziś nie ma nic do wysłania klientom.</div>';
    info.firmy.forEach(function (f, i) {
      html += '<div class="remfirm"><div class="remhead"><div><b>' + esc(f.firma || '(bez nazwy)') + '</b> <span class="sub">NIP ' + esc(f.nip || '—') + ' · ' +
        (f.email ? esc(f.email) : '<span class="bad">brak e-maila w bazie klientów</span>') + '</span></div>' +
        (f.email && f.nip ? '<button type="button" class="mini ok" data-send="' + esc(f.nip) + '">Wyślij teraz</button>' : '') + '</div>' +
        '<ul>' + f.items.map(function (it) { return '<li>' + esc(it.worker) + ' — ' + esc(it.doc) + ': ' + pl(it.date) + ' ' + pill(it.d) + '</li>'; }).join('') + '</ul>' +
        '<details><summary>Pokaż treść wiadomości</summary><pre>' + esc(f.subject) + '\n\n' + esc(f.text) + '</pre></details></div>';
    });
    var jobs = (info.zadania || []).map(function (z) {
      return '<span class="pill ' + (z.ok ? 'p-ok' : z.ok === false ? 'p-red' : 'p-grey') + '">' + esc(JOB[z.zadanie] || z.zadanie) + ' · ' + new Date(z.started_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</span>';
    }).join(' ');
    html += '<div class="jobs"><span class="sub">Ostatnie przebiegi automatu:</span> ' + (jobs || '<span class="sub">jeszcze nie było — pierwszy jutro rano</span>') + '</div>';
    box.innerHTML = html;
  }
  $('rem').addEventListener('click', async function (e) {
    var m = e.target.closest('#remMode');
    if (m) {
      var to = m.getAttribute('data-to');
      if (to === 'auto' && !confirm('Włączyć automatyczną wysyłkę przypomnień do klientów?\n\nCodziennie rano każda firma z listy poniżej dostanie e-mail o kończących się dokumentach swoich pracowników. Sprawdź najpierw treść i daty.')) return;
      m.disabled = true;
      try { await terminy({ action: 'settings', klient: to }); } catch (err) { alert(err.message); }
      return loadReminders();
    }
    var b = e.target.closest('[data-send]'); if (!b) return;
    if (!confirm('Wysłać przypomnienie do tej firmy teraz?')) return;
    b.disabled = true; b.textContent = 'Wysyłam…';
    try {
      var out = await terminy({ action: 'send_firm', nip: b.getAttribute('data-send') });
      if (out.error) { alert(out.error); b.disabled = false; b.textContent = 'Wyślij teraz'; return; }
      b.textContent = '✓ wysłano do ' + out.to;
      setTimeout(loadReminders, 1500);
    } catch (err) { alert(err.message); b.disabled = false; b.textContent = 'Wyślij teraz'; }
  });

  $('q').addEventListener('input', function (e) { q = e.target.value.toLowerCase().trim(); render(); });

  async function load() {
    if (!window.sb) return;
    var all = [], from = 0, page = 1000;
    for (;;) { // PostgREST returns at most 1000 rows per request
      var r = await window.sb.from(TABLE).select('id,worker_name,status,created_at,payload').order('created_at', { ascending: false }).range(from, from + page - 1);
      if (r.error) { $('tiles').innerHTML = '<div class="empty">Błąd: ' + esc(r.error.message) + '</div>'; return; }
      all = all.concat(r.data || []);
      if (!r.data || r.data.length < page) break;
      from += page;
    }
    rows = all.filter(function (w) { return w.status !== 'archiwum'; }); // former staff are not monitored
    // open on the most urgent non-empty category
    var first = TILES.filter(function (t) { return VIEWS[t.v].items().length; })[0];
    view = first ? first.v : 'wszyscy';
    render();
    loadReminders();
  }
  load();
})();
