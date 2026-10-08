/* Portal shell: the same navigation on every protected page.
   Loaded by auth-guard.js once access is confirmed (needs window.PortalAccess and
   window.PortalUser). Desktop: fixed sidebar, content uses the full width.
   Phone: top bar + slide-in menu + bottom bar with the most used pages.
   Pages keep their own markup; the shell only hides their "back" link and logo
   and widens <main>. */
(function () {
  'use strict';
  if (document.getElementById('psSide')) return;
  var acc = window.PortalAccess || { has: function () { return true; } };
  var user = window.PortalUser || {};
  var page = window.PortalPage || location.pathname.split('/').pop() || 'index.html';
  var FORM_URL = location.origin + location.pathname.replace(/[^/]*$/, '') + 'formularz-pracownika.html';

  // sec = section required (see auth-guard.js); wide = list pages that use the whole width
  var NAV = [
    { label: 'Kadry', sec: 'kadry', items: [
      { href: 'kontrola.html', ico: '🚦', text: 'Kontrola', short: 'Kontrola', wide: true },
      { href: 'zatrudnienie.html', ico: '📥', text: 'Zgłoszenia pracowników', short: 'Zgłoszenia', badge: true, wide: true },
      { href: 'umowa-zlecenie.html', ico: '🧾', text: 'Komplet dokumentów', short: 'Komplet' },
      { href: 'rejestr.html', ico: '🏢', text: 'Rejestr i terminy', short: 'Rejestr', wide: true },
      { href: 'import.html', ico: '📤', text: 'Import pracowników', short: 'Import', wide: true },
      { href: 'wiedza.html', ico: '⚖️', text: 'Baza wiedzy — przepisy', short: 'Przepisy', wide: true },
      { href: 'historia.html?s=kadry', ico: '🕘', text: 'Historia dokumentów', short: 'Historia', wide: true },
    ] },
    { label: 'Spółka', items: [
      { href: 'index.html#rejestracja', ico: '📋', text: 'Rejestracja spółki', short: 'Rejestracja', sec: 'rejestracja' },
      { href: 'index.html#biezaca', ico: '💼', text: 'Bieżąca działalność', short: 'Bieżąca', sec: 'biezaca',
        pages: ['wynagrodzenie.html', 'e-urzad.html', 'pelnomocnictwo.html', 'nip-8.html'] },
      { href: 'historia.html?s=spolka', ico: '🕘', text: 'Historia dokumentów', short: 'Historia', wide: true },
    ] },
    { label: 'Legalizacja pobytu', sec: 'biezaca', items: [
      { href: 'zalacznik-pobyt.html', ico: '🛂', text: 'Załącznik nr 1 do wniosku o pobyt', short: 'Załącznik' },
      { href: 'historia.html?s=legalizacja', ico: '🕘', text: 'Historia dokumentów', short: 'Historia', wide: true },
    ] },
    { label: 'Księgowość', sec: 'onboarding', items: [
      { href: 'onboarding.html', ico: '🚀', text: 'Onboarding klientów', short: 'Onboarding', wide: true },
      { href: 'onboarding.html?p=/deadlines', ico: '⏰', text: 'Terminy klientów', short: 'Terminy', wide: true },
    ] },
    { label: 'Ogólne', items: [
      { href: 'zadania.html', ico: '✅', text: 'Zadania', short: 'Zadania', wide: true, tasks: true },
      { href: 'dostep.html', ico: '🔑', text: 'Dostęp do portalu', short: 'Dostęp', admin: true, wide: true },
      { href: 'index.html#konsultacja', ico: '💬', text: 'Konsultacja', short: 'Pomoc' },
    ] },
  ];
  NAV[1].items[0].pages = ['rejestracja.html'];

  // someone limited to Kadry has nothing on the start page's default panel — open their inbox
  if (page === 'index.html' && !location.hash && acc.has('kadry') && !acc.has('rejestracja')) {
    location.replace('kontrola.html');
    return;
  }

  var items = [];
  NAV.forEach(function (g) {
    g.items = g.items.filter(function (it) {
      var sec = it.sec || g.sec;
      return (!sec || acc.has(sec)) && (!it.admin || user.admin);
    });
    g.items.forEach(function (it) { items.push(it); });
  });

  function isActive(it) {
    var parts = it.href.split('#');
    if (it.pages && it.pages.indexOf(page) !== -1) return true;
    var q = parts[0].split('?');
    if (q[0] !== page) return false;
    if (q[1]) return location.search.replace('?', '') === q[1];
    if (page !== 'index.html') return !location.search || !items.some(function (o) { return o !== it && o.href.split('#')[0] === page + location.search; });
    // on the start page the open panel decides (no hash = the default panel)
    var open = document.querySelector('.panel.active');
    return (location.hash.replace('#', '') || (open ? open.getAttribute('data-panel') : '')) === (parts[1] || '');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------------- styles ----------------
  var css = document.createElement('style');
  css.textContent = [
    ':root{--ps-w:256px;--ps-navy:#1B3F7F;--ps-tint:#EEF3F9}',
    'body.ps{padding-left:var(--ps-w);background:#f6f8fb}',
    '#psSide{position:fixed;left:0;top:0;bottom:0;width:var(--ps-w);z-index:900;background:var(--ps-tint);border-right:1px solid #e1e7f0;display:flex;flex-direction:column;padding:18px 14px;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '#psSide .ps-brand{display:block;text-align:center;padding:4px 8px 14px}',
    '#psSide .ps-brand img{height:56px;width:auto}',
    '.ps-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8a97ab;margin:14px 10px 6px}',
    '.ps-item{display:flex;align-items:center;gap:11px;padding:10px 12px;margin-bottom:3px;border-radius:9px;font-size:14px;font-weight:500;color:#3a4759;text-decoration:none;line-height:1.3}',
    '.ps-item:hover{background:rgba(27,63,127,.07);color:var(--ps-navy)}',
    '.ps-item.on{background:var(--ps-navy);color:#fff;font-weight:600}',
    '.ps-ico{width:26px;height:26px;flex:0 0 26px;display:flex;align-items:center;justify-content:center;font-size:16px;border-radius:7px;background:#fff}',
    '.ps-item.on .ps-ico{background:rgba(255,255,255,.18)}',
    '.ps-badge{margin-left:auto;min-width:22px;padding:1px 7px;border-radius:999px;background:#dc2626;color:#fff;font-size:11.5px;font-weight:700;text-align:center}',
    '.ps-foot{margin-top:auto;padding-top:14px}',
    'button.ps-copy{width:100%;border:none;background:none;font-family:inherit;cursor:pointer;text-align:left}',
    '.ps-user{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:#5a6577}',
    '.ps-user span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ps-out{border:none;background:var(--ps-navy);color:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:12px;font-weight:600;cursor:pointer}',
    '.ps-rodo{display:block;margin-top:8px;font-size:11.5px;color:#8a97ab;text-decoration:none}',
    // pages inside the shell: no own back link / logo, left-aligned heading, wider content
    'body.ps main>.back,body.ps main>.brand{display:none}',
    'body.ps main{max-width:1120px;margin:0 auto;padding-top:32px}',
    'body.ps.ps-wide main{max-width:1560px;margin:0;padding-left:36px;padding-right:36px}',
    'body.ps main>h1,body.ps main>.lead{text-align:left;margin-left:0;margin-right:0;max-width:none}',
    'body.ps.ps-wide .filters,body.ps.ps-wide .tabs{justify-content:flex-start}',
    'body.ps.ps-wide .search{margin-left:0}',
    // index.html brings its own sidebar layout — the shell replaces it
    'body.ps .layout{display:block}',
    'body.ps .layout>.sidebar{display:none}',
    'body.ps .layout>main.content{max-width:1560px;margin:0;padding:36px 36px 96px}',
    'body.ps .add-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;background:#fff;border:1.5px solid var(--ps-navy);color:var(--ps-navy);border-radius:8px;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}',
    'body.ps .add-btn:hover{background:var(--ps-tint)}',
    '#authBar{display:none!important}',
    '#psTop,#psTabs,#psDim{display:none}',
    '@media (max-width:900px){',
    ' body.ps{padding-left:0;padding-top:54px;padding-bottom:64px}',
    ' #psTop{display:flex;position:fixed;left:0;right:0;top:0;height:54px;z-index:910;align-items:center;gap:10px;padding:0 12px;background:#fff;border-bottom:1px solid #e1e7f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    ' #psTop button{width:42px;height:42px;border:none;background:var(--ps-tint);border-radius:10px;font-size:20px;color:var(--ps-navy);cursor:pointer}',
    ' #psTop strong{flex:1;font-size:15.5px;color:var(--ps-navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    ' #psTop img{height:34px}',
    ' #psSide{transform:translateX(-102%);transition:transform .22s ease;width:min(86vw,300px);z-index:930;box-shadow:0 0 40px rgba(0,0,0,.25)}',
    ' body.ps-open #psSide{transform:none}',
    ' body.ps-open #psDim{display:block;position:fixed;inset:0;z-index:920;background:rgba(15,23,42,.45)}',
    ' .ps-item{padding:13px 12px;font-size:15px}',
    ' #psTabs{display:flex;position:fixed;left:0;right:0;bottom:0;height:60px;z-index:905;background:#fff;border-top:1px solid #e1e7f0;padding-bottom:env(safe-area-inset-bottom);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    ' #psTabs a,#psTabs button{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:none;background:none;font:inherit;font-size:11px;font-weight:600;color:#6b7a90;text-decoration:none;cursor:pointer;position:relative}',
    ' #psTabs .i{font-size:20px;line-height:1}',
    ' #psTabs .on{color:var(--ps-navy)}',
    ' #psTabs .ps-badge{position:absolute;top:5px;left:calc(50% + 6px);margin:0}',
    ' body.ps main,body.ps.ps-wide main,body.ps .layout>main.content{padding:18px 14px 40px}',
    ' body.ps .toast{bottom:76px}',
    ' body.ps input,body.ps select,body.ps textarea{font-size:16px}', // no zoom-on-focus on iOS
    '}',
  ].join('\n');
  document.head.appendChild(css);

  // ---------------- markup ----------------
  function link(it, cls) {
    return '<a class="' + cls + '" href="' + it.href + '" data-href="' + it.href + '">' +
      (cls === 'ps-item' ? '<span class="ps-ico">' + it.ico + '</span>' + esc(it.text) : '<span class="i">' + it.ico + '</span>' + esc(it.short)) +
      (it.badge ? '<span class="ps-badge" data-badge hidden></span>' : '') + (it.tasks ? '<span class="ps-badge" data-tbadge hidden></span>' : '') + '</a>';
  }
  var side = document.createElement('nav');
  side.id = 'psSide';
  side.innerHTML = '<a class="ps-brand" href="index.html"><img src="logo.png" alt="TD Consulting Group" /></a>' +
    NAV.filter(function (g) { return g.items.length; }).map(function (g) {
      return '<div class="ps-label">' + g.label + '</div>' + g.items.map(function (it) { return link(it, 'ps-item'); }).join('') +
        (g.sec === 'kadry' ? '<button type="button" class="ps-item ps-copy" id="psCopy"><span class="ps-ico">🔗</span><span data-copy-text>Kopiuj link do formularza dla klienta</span></button>' : '');
    }).join('') +
    '<div class="ps-foot">' +
      '<div class="ps-user"><span title="' + esc(user.email) + '">' + esc(user.email || 'zalogowano') + '</span><button type="button" class="ps-out" id="psOut">Wyloguj</button></div>' +
      '<a class="ps-rodo" href="rodo.html" target="_blank" rel="noopener">Informacja RODO</a>' +
    '</div>';

  var top = document.createElement('div');
  top.id = 'psTop';
  top.innerHTML = '<button type="button" id="psMenu" aria-label="Menu">☰</button><strong id="psTitle"></strong><img src="logo.png" alt="" />';

  var dim = document.createElement('div');
  dim.id = 'psDim';

  var tabs = document.createElement('div');
  tabs.id = 'psTabs';
  tabs.innerHTML = items.slice(0, 3).map(function (it) { return link(it, 'ps-tab'); }).join('') +
    '<button type="button" id="psMore"><span class="i">☰</span>Menu</button>';

  function mount() {
    document.body.classList.add('ps');
    document.body.appendChild(side);
    document.body.appendChild(top);
    document.body.appendChild(dim);
    document.body.appendChild(tabs);
    refresh();
    loadBadge();
    loadTasks();
  }

  function refresh() {
    var current = null;
    items.forEach(function (it) { if (!current && isActive(it)) current = it; });
    document.querySelectorAll('#psSide [data-href], #psTabs [data-href]').forEach(function (a) {
      a.classList.toggle('on', !!current && a.getAttribute('data-href') === current.href);
    });
    document.body.classList.toggle('ps-wide', !!(current && current.wide));
    document.getElementById('psTitle').textContent = current ? current.text : 'Portal dokumentów';
    document.body.classList.remove('ps-open');
  }

  function toggleMenu() { document.body.classList.toggle('ps-open'); }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('#psMenu') || t.closest('#psMore')) return toggleMenu();
    if (t.closest('#psDim') || t.closest('#psSide a')) return document.body.classList.remove('ps-open');
    if (t.closest('#psOut')) {
      t.closest('#psOut').disabled = true;
      return window.sb.auth.signOut().then(function () { location.replace('login.html'); });
    }
    var copy = t.closest('#psCopy');
    if (copy) {
      var lbl = copy.querySelector('[data-copy-text]');
      var done = function () { lbl.textContent = '✓ Skopiowano — wyślij klientowi'; setTimeout(function () { lbl.textContent = 'Kopiuj link do formularza dla klienta'; }, 2200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(FORM_URL).then(done, function () { prompt('Link do formularza:', FORM_URL); });
      else prompt('Link do formularza:', FORM_URL);
    }
  });
  window.addEventListener('hashchange', refresh);

  // number of new submissions waiting for the HR team
  function loadBadge() {
    if (!acc.has('kadry') || !window.sb) return;
    window.sb.from('zatrudnienie_zgloszenia').select('id', { count: 'exact', head: true }).eq('status', 'nowe').then(function (r) {
      var n = r && !r.error ? r.count : 0;
      document.querySelectorAll('[data-badge]').forEach(function (b) { b.hidden = !n; b.textContent = n; });
    });
  }
  // my open tasks
  function loadTasks() {
    if (!window.sb || !user.email) return;
    window.sb.from('portal_zadania').select('id', { count: 'exact', head: true }).eq('assignee', String(user.email).toLowerCase()).in('status', ['nowe', 'w_toku']).then(function (r) {
      var n = r && !r.error ? r.count : 0;
      document.querySelectorAll('[data-tbadge]').forEach(function (b) { b.hidden = !n; b.textContent = n; });
    });
  }
  window.PortalShell = { refreshBadge: loadBadge, refreshTasks: loadTasks };

  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
