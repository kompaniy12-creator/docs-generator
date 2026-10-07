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
  function daysLeft(iso) { return Math.floor((new Date(iso + 'T00:00:00') - new Date()) / 86400000); }
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
      head: ['Pracownik', 'Firma', 'Dokument', 'Ważny do', 'Termin'],
      row: function (t) { return [esc(t.w.worker_name), esc((t.w.payload || {}).z_nazwa || '—'), esc(t.doc), pl(t.date), pill(t.d)]; },
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
    head: ['Pracownik', 'Firma', 'Brakuje'],
    row: function (m) { return [esc(m.w.worker_name), esc((m.w.payload || {}).z_nazwa || '—'), esc(m.miss.join(', '))]; },
    text: function (m) { return (m.w.worker_name || '') + ' ' + ((m.w.payload || {}).z_nazwa || ''); },
  };
  VIEWS.wszyscy = {
    title: 'Wszyscy pracownicy', hint: 'Pełna lista jest w Rejestrze, z podziałem na firmy.',
    items: function () { return rows; },
    head: ['Pracownik', 'Firma', 'Status', 'Dodany'],
    row: function (w) { return [esc(w.worker_name), esc((w.payload || {}).z_nazwa || '—'), esc(w.status), new Date(w.created_at).toLocaleDateString('pl-PL')]; },
    text: function (w) { return (w.worker_name || '') + ' ' + ((w.payload || {}).z_nazwa || ''); },
  };
  var TILES = [
    { v: 'nowe', label: 'nowe zgłoszenia', cls: 'red' },
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
    rows = all;
    // open on the most urgent non-empty category
    var first = TILES.filter(function (t) { return VIEWS[t.v].items().length; })[0];
    view = first ? first.v : 'wszyscy';
    render();
  }
  load();
})();
