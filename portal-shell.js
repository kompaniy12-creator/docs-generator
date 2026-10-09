/* Portal shell: the same navigation on every protected page.
   Loaded by auth-guard.js once access is confirmed (needs window.PortalAccess and
   window.PortalUser). Desktop: fixed sidebar, content uses the full width.
   Phone: top bar + slide-in menu + bottom bar with the most used pages.
   Pages keep their own markup; the shell only hides their "back" link and logo
   and widens <main>. */
(function () {
  'use strict';
  if (document.getElementById('psSide')) return;
  // themes live in portal-theme.js (auth-guard loads it first; this is the fallback)
  if (!window.PortalTheme) { var th = document.createElement('script'); th.src = 'portal-theme.js'; document.head.appendChild(th); }
  var acc = window.PortalAccess || { has: function () { return true; } };
  var user = window.PortalUser || {};
  var page = window.PortalPage || location.pathname.split('/').pop() || 'index.html';
  var FORM_URL = location.origin + location.pathname.replace(/[^/]*$/, '') + 'formularz-pracownika.html';

  // sec = section required (see auth-guard.js); wide = list pages that use the whole width
  var NAV = [
    { label: 'Kadry', ico: '👥', sec: 'kadry', items: [
      { href: 'kontrola.html', ico: '🚦', text: 'Kontrola', short: 'Kontrola', wide: true },
      { href: 'zatrudnienie.html', ico: '📥', text: 'Zgłoszenia pracowników', short: 'Zgłoszenia', badge: true, wide: true },
      { href: 'umowa-zlecenie.html', ico: '🧾', text: 'Komplet dokumentów', short: 'Komplet' },
      { href: 'dokumenty.html', ico: '📝', text: 'Generator dokumentów', short: 'Dokumenty', wide: true },
      { href: 'rejestr.html', ico: '🏢', text: 'Rejestr i terminy', short: 'Rejestr', wide: true },
      { href: 'akta.html', ico: '🗂️', text: 'Akta osobowe', short: 'Akta', wide: true },
      { href: 'podpisy.html', ico: '✍️', text: 'Podpisy elektroniczne', short: 'Podpisy', wide: true },
      { href: 'import.html', ico: '📤', text: 'Import pracowników', short: 'Import', wide: true },
      { href: 'wiedza.html', ico: '⚖️', text: 'Baza wiedzy — przepisy', short: 'Przepisy', wide: true },
      { href: 'historia.html?s=kadry', ico: '🕘', text: 'Historia dokumentów', short: 'Historia', wide: true },
    ] },
    { label: 'Spółka', ico: '🏢', items: [
      { href: 'index.html#rejestracja', ico: '📋', text: 'Rejestracja spółki', short: 'Rejestracja', sec: 'rejestracja' },
      { href: 'index.html#biezaca', ico: '💼', text: 'Bieżąca działalność', short: 'Bieżąca', sec: 'biezaca',
        pages: ['wynagrodzenie.html', 'e-urzad.html', 'pelnomocnictwo.html', 'nip-8.html'] },
      { href: 'historia.html?s=spolka', ico: '🕘', text: 'Historia dokumentów', short: 'Historia', wide: true },
    ] },
    { label: 'Legalizacja pobytu', ico: '🛂', sec: 'legalizacja', items: [
      { href: 'zalacznik-pobyt.html', ico: '🛂', text: 'Załącznik nr 1 do wniosku o pobyt', short: 'Załącznik' },
      { href: 'historia.html?s=legalizacja', ico: '🕘', text: 'Historia dokumentów', short: 'Historia', wide: true },
    ] },
    { label: 'Księgowość', ico: '📊', sec: 'onboarding', items: [
      { href: 'ksiegowosc.html', ico: '📒', text: 'Klienci i zamknięcia miesiąca', short: 'Zamknięcia', wide: true },
      { href: 'terminy-ksiegowe.html', ico: '📅', text: 'Kalendarz terminów', short: 'Kalendarz', wide: true },
      { href: 'narzedzia-ksiegowe.html', ico: '🧮', text: 'Narzędzia księgowe', short: 'Narzędzia' },
      { href: 'onboarding.html', ico: '🚀', text: 'Onboarding klientów', short: 'Onboarding', wide: true },
      { href: 'onboarding.html?p=/deadlines', ico: '⏰', text: 'Terminy klientów', short: 'Terminy', wide: true },
    ] },
    { label: 'Klienci', ico: '🗃️', items: [
      { href: 'klienci.html', ico: '🗃️', text: 'Baza klientów', short: 'Klienci', wide: true },
      { href: 'sms.html', ico: '💬', text: 'SMS do klientów', short: 'SMS', wide: true },
    ] },
    { label: 'Ogólne', ico: '⚙️', mobile: true, items: [
      { href: 'pulpit.html', ico: '📊', text: 'Pulpit', short: 'Pulpit', admin: true, wide: true },
      { href: 'zadania.html', ico: '✅', text: 'Zadania', short: 'Zadania', wide: true, tasks: true },
      { href: 'poczta.html', ico: '✉️', text: 'Poczta', short: 'Poczta', wide: true, secAny: ['kadry', 'onboarding'] },
      { href: 'zespol.html', ico: '👥', text: 'Zespół', short: 'Zespół', admin: true, wide: true },
      { href: 'dostep.html', ico: '🔑', text: 'Dostęp do portalu', short: 'Dostęp', admin: true, wide: true },
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
      // secAny: a page for more than one module — any of the sections is enough
      if (it.secAny && !it.secAny.some(function (x) { return acc.has(x); })) return false;
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
    // the menu's own scrollbar: thin and see-through, no white track beside the menu
    '#psSide{scrollbar-width:thin;scrollbar-color:rgba(127,140,160,.45) transparent}',
    '#psSide::-webkit-scrollbar{width:8px;background:transparent}',
    '#psSide::-webkit-scrollbar-track{background:transparent}',
    '#psSide::-webkit-scrollbar-thumb{background:rgba(127,140,160,.45);border-radius:8px;border:2px solid transparent;background-clip:padding-box}',
    '#psSide .ps-brand{display:block;text-align:center;padding:4px 8px 14px}',
    // the logo in its own colours on a transparent background (logo-kolor.png)
    '.ps-logo{display:inline-block;width:96px;height:68px;background:url(logo-kolor.png) center/contain no-repeat}',
    '#psTop .ps-logo{width:50px;height:34px;flex:0 0 auto}',
    // a module is a group: its header is a row of its own, and an open group is one framed panel
    '.ps-group{margin:0 0 6px;border-radius:14px;border:1px solid transparent;transition:background .15s,border-color .15s}',
    '.ps-group.open{background:rgba(27,63,127,.05);border-color:rgba(27,63,127,.10);padding:4px 4px 2px}',
    '.ps-label{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;border:none;background:none;font-family:inherit;cursor:pointer;font-size:14px;font-weight:600;color:#3a4759;padding:9px 10px 9px 12px;border-radius:11px;text-align:left}',
    '.ps-gname{display:flex;align-items:center;gap:11px;min-width:0}',
    '.ps-label:hover{background:rgba(27,63,127,.07);color:var(--ps-navy)}',
    '.ps-group.open>.ps-label{color:#7a8699;font-weight:600}',
    '.ps-group.open>.ps-label .ps-ico{background:none}',
    '.ps-chev{font-size:17px;line-height:1;transition:transform .15s;opacity:.7}',
    '.ps-group.open .ps-chev{transform:rotate(90deg)}',
    '.ps-group .ps-items{display:none}',
    '.ps-group.ps-drag{opacity:.85;box-shadow:0 8px 24px rgba(0,0,0,.28);cursor:grabbing;position:relative;z-index:3}',
    '.ps-group.ps-drag .ps-label{cursor:grabbing}',
    'body.ps-dragging{user-select:none;-webkit-user-select:none}',
    '.ps-group.open .ps-items{display:block}',
    '.ps-group.has-on:not(.open){background:rgba(27,63,127,.08)}',
    '.ps-group.has-on:not(.open) .ps-label{color:var(--ps-navy)}',
    '.ps-item{display:flex;align-items:center;gap:11px;padding:10px 12px;margin-bottom:3px;border-radius:9px;font-size:14px;font-weight:500;color:#3a4759;text-decoration:none;line-height:1.3}',
    '.ps-item:hover{background:rgba(27,63,127,.07);color:var(--ps-navy)}',
    '.ps-item.on{background:var(--ps-navy);color:#fff;font-weight:600}',
    '.ps-ico{width:26px;height:26px;flex:0 0 26px;display:flex;align-items:center;justify-content:center;font-size:16px;border-radius:8px;background:rgba(27,63,127,.07);color:inherit}',
    '.ps-top svg,.ps-drop svg,.ps-rodo svg{flex:0 0 auto;vertical-align:-4px}',
    '.ps-drop a{display:flex!important;align-items:center;gap:10px}',
    '#psTabs .i{display:flex;align-items:center;justify-content:center;height:22px}',
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
    'body.ps{padding-top:56px}',
    '#psBar{position:fixed;left:var(--ps-w);right:0;top:0;height:56px;z-index:890;display:flex;align-items:center;gap:16px;padding:0 28px 0 36px;background:#fff;border-bottom:1px solid #e1e7f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '#psBar strong{font-size:15px;color:var(--ps-navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}',
    '#psBar nav{display:flex;align-items:center;gap:6px;flex:0 0 auto}',
    '.ps-top{position:relative;display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:9px;border:none;background:none;font:inherit;font-size:13.5px;font-weight:600;color:#3a4759;text-decoration:none;cursor:pointer;white-space:nowrap}',
    '.ps-top:hover{background:var(--ps-tint);color:var(--ps-navy)}',
    '.ps-top.on{background:var(--ps-navy);color:#fff}',
    '.ps-top .ps-badge{margin-left:2px}',
    '.ps-menu{position:relative}',
    '.ps-drop{position:absolute;right:0;top:calc(100% + 6px);min-width:290px;background:#fff;border:1px solid #e1e7f0;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.14);padding:6px;z-index:5}',
    '.ps-drop[hidden]{display:none}',
    '.ps-drop a{display:block;padding:10px 12px;border-radius:8px;font-size:13.5px;font-weight:500;color:#3a4759;text-decoration:none}',
    '.ps-drop a:hover{background:var(--ps-tint);color:var(--ps-navy)}',
    '.ps-who{font-size:12.5px;color:#7a8699;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:8px}',
    '.ps-m{display:none}',
    '.ps-user.ps-m{display:none}',
    '@media (max-width:1180px){.ps-who{display:none}}',
    '@media (max-width:900px){',
    ' body.ps{padding-left:0;padding-top:54px;padding-bottom:64px}',
    ' #psBar{display:none}',
    ' .ps-group.ps-m{display:block}',
    ' .ps-user.ps-m{display:flex}',
    ' .ps-rodo.ps-m{display:block}',
    ' #psTop{display:flex;position:fixed;left:0;right:0;top:0;height:54px;z-index:910;align-items:center;gap:10px;padding:0 12px;background:#fff;border-bottom:1px solid #e1e7f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    ' #psTop button{width:42px;height:42px;border:none;background:var(--ps-tint);border-radius:10px;font-size:20px;color:var(--ps-navy);cursor:pointer}',
    ' #psTop strong{flex:1;font-size:15.5px;color:var(--ps-navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
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
  // one-colour line icons instead of emoji: they take the colour of the text around them
  var SVG = {
    '🚦': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    '📥': '<path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M12 4v10"/><path d="m8 10 4 4 4-4"/>',
    '🧾': '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 12h6M10 16h6"/>',
    '🏢': '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10"/><path d="M3 21h18"/><path d="M8 7h4M8 11h4M8 15h4"/>',
    '📤': '<path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M12 15V4"/><path d="m8 8 4-4 4 4"/>',
    '⚖️': '<path d="M12 4v16"/><path d="M7 20h10"/><path d="M5 7h14"/><path d="m5 7-3 6a3 3 0 0 0 6 0z"/><path d="m19 7-3 6a3 3 0 0 0 6 0z"/>',
    '🕘': '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>',
    '🔗': '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    '📋': '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6"/>',
    '💼': '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
    '🛂': '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 17h6"/>',
    '🚀': '<path d="M5 19c1-4 3-6 3-6l3 3s-2 2-6 3z"/><path d="M9 13c1-5 5-9 11-9 0 6-4 10-9 11z"/><circle cx="15" cy="9" r="1.5"/>',
    '⏰': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    '✅': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
    '🔑': '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m16 7 3 3"/>',
    '📊': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    '🗂️': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 11h18"/>',
    '📒': '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    '📅': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    '🧮': '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
    '✍️': '<path d="M4 20h16"/><path d="M6 16l1-4 9-9 3 3-9 9z"/><path d="M14 5l3 3"/>',
    '🗃️': '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M10 7.5h4M10 16.5h4"/>',
    '📝': '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    '💬': '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    '✉️': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    '📇': '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
    '⚙️': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    '🎨': '<path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2 0-1.5 1-2 2-2h2a3 3 0 0 0 3-3c0-6-4-11-9-11z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    '👥': '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
    '🔔': '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    '✉️': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    '🛡️': '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/>',
  };
  function ico(e) { return SVG[e] ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SVG[e] + '</svg>' : e; }
  function link(it, cls) {
    return '<a class="' + cls + '" href="' + it.href + '" data-href="' + it.href + '">' +
      (cls === 'ps-item' ? '<span class="ps-ico">' + ico(it.ico) + '</span>' + esc(it.text) : '<span class="i">' + ico(it.ico) + '</span>' + esc(it.short)) +
      (it.badge ? '<span class="ps-badge" data-badge hidden></span>' : '') + (it.tasks ? '<span class="ps-badge" data-tbadge hidden></span>' : '') + '</a>';
  }
  // the user's own order of modules (saved per browser); modules not in the saved list keep their place after it
  var ORDER_KEY = 'tdcg_menu_order';
  function savedOrder() { try { var o = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); return Array.isArray(o) ? o : []; } catch (e) { return []; } }
  (function () {
    var o = savedOrder(), pos = function (g) { var i = o.indexOf(g.label); return g.mobile ? 1e6 : i < 0 ? 1e3 + NAV.indexOf(g) : i; };
    NAV = NAV.slice().sort(function (x, y) { return pos(x) - pos(y); });
  })();
  var side = document.createElement('nav');
  side.id = 'psSide';
  side.innerHTML = '<a class="ps-brand" href="index.html" title="TD Consulting Group"><span class="ps-logo" role="img" aria-label="TD Consulting Group"></span></a>' +
    NAV.filter(function (g) { return g.items.length; }).map(function (g) {
      // every module folds; the one with the current page is open, the rest as the user left them
      return '<div class="ps-group' + (g.mobile ? ' ps-m' : '') + '" data-group="' + esc(g.label) + '">' +
        '<button type="button" class="ps-label" data-fold aria-expanded="false"><span class="ps-gname"><span class="ps-ico">' + ico(g.ico) + '</span>' + esc(g.label) + '</span><span class="ps-chev">›</span></button>' +
        '<div class="ps-items">' + g.items.map(function (it) { return link(it, 'ps-item'); }).join('') +
        (g.sec === 'kadry' ? '<button type="button" class="ps-item ps-copy" id="psCopy"><span class="ps-ico">' + ico('🔗') + '</span><span data-copy-text>Kopiuj link do formularza dla klienta</span></button>' : '') +
        '</div></div>';
    }).join('') +
    '<div class="ps-foot">' +
      '<div class="ps-user ps-m"><span title="' + esc(user.email) + '">' + esc(user.email || 'zalogowano') + '</span><button type="button" class="ps-out" id="psOut">Wyloguj</button></div>' +
      '<a class="ps-rodo ps-m" href="#" data-pt-open>' + ico('🎨') + ' Wygląd portalu</a>' +
      '<a class="ps-rodo" href="rodo.html" target="_blank" rel="noopener">Informacja RODO</a>' +
    '</div>';

  var top = document.createElement('div');
  top.id = 'psTop';
  top.innerHTML = '<button type="button" id="psMenu" aria-label="Menu">☰</button><strong id="psTitle"></strong><span class="ps-logo" aria-hidden="true"></span>';

  // desktop top bar: things used from every module
  var CRM_URL = 'https://kompaniy12-creator.github.io/td-crm/';
  var bar = document.createElement('div');
  bar.id = 'psBar';
  bar.innerHTML =
    '<strong id="psBarTitle"></strong>' +
    '<nav>' +
      (user.admin ? '<a class="ps-top" href="pulpit.html" data-top="pulpit.html">' + ico('📊') + ' Pulpit</a>' : '') +
      '<a class="ps-top" href="' + CRM_URL + '" target="_blank" rel="noopener" title="CRM — leady, sprawy, klienci (otwiera się w nowej karcie)">' + ico('📇') + ' CRM ↗</a>' +
      '<a class="ps-top" href="zadania.html" data-top="zadania.html">' + ico('✅') + ' Zadania<span class="ps-badge" data-tbadge hidden></span></a>' +
      (acc.has('kadry') || acc.has('onboarding') ? '<a class="ps-top" href="poczta.html" data-top="poczta.html">' + ico('✉️') + ' Poczta</a>' : '') +
      (acc.has('kadry') ? '<a class="ps-top" href="zatrudnienie.html" data-top="zatrudnienie.html" title="Nowe zgłoszenia pracowników">' + ico('📥') + '<span class="ps-badge" data-badge hidden></span></a>' : '') +
      (user.admin ? '<a class="ps-top" href="dostep.html" data-top="dostep.html">' + ico('🔑') + ' Dostęp do portalu</a>' : '') +
      '<button type="button" class="ps-top" data-pt-open title="Wygląd — motywy, tło i kolory">' + ico('🎨') + '</button>' +
      '<div class="ps-menu"><button type="button" class="ps-top" id="psGear" aria-haspopup="true" aria-expanded="false" title="Ustawienia">' + ico('⚙️') + ' Ustawienia</button>' +
        '<div class="ps-drop" id="psDrop" hidden>' +
          (user.admin ? '<a href="zespol.html">' + ico('👥') + ' Zespół — profile i odpowiedzialność</a><a href="dostep.html">' + ico('🔑') + ' Użytkownicy i dostęp do modułów</a><a href="zadania.html#settings">' + ico('🔔') + ' Powiadomienia Telegram i eskalacje</a>' : '') +
          (acc.has('kadry') ? '<a href="kontrola.html#rem">' + ico('✉️') + ' Przypomnienia dla klientów</a><a href="wiedza.html">' + ico('⚖️') + ' Baza wiedzy — przepisy</a>' : '') +
          '<a href="#" data-pt-open>' + ico('🎨') + ' Wygląd — motywy, tło i kolory</a>' +
          '<a href="rodo.html" target="_blank" rel="noopener">' + ico('🛡️') + ' Informacja RODO</a>' +
        '</div></div>' +
      '<span class="ps-who" title="' + esc(user.email) + '">' + esc(user.email || '') + '</span>' +
      '<button type="button" class="ps-out" id="psOut2">Wyloguj</button>' +
    '</nav>';

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
    document.body.appendChild(bar);
    document.body.appendChild(dim);
    document.body.appendChild(tabs);
    refresh();
    loadBadge();
    loadTasks();
  }

  var FOLD_KEY = 'tdcg_menu_open';
  function foldState() { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch (e) { return {}; } }
  function applyFold() {
    var st = foldState();
    document.querySelectorAll('#psSide .ps-group').forEach(function (g) {
      var name = g.getAttribute('data-group'), on = !!g.querySelector('.ps-item.on');
      // the module of the current page opens unless the user folded it on this very page
      var isOpen = name in st ? st[name] : on;
      if (on && st[name] === false && !g.dataset.touched) isOpen = true;
      g.classList.toggle('open', isOpen);
      g.classList.toggle('has-on', on);
      g.querySelector('[data-fold]').setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // modules are reordered by pressing a module header and dragging it; a plain click still folds
  var drag = null, dragJust = false;
  document.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.pointerType !== 'mouse') return; // on touch the menu scrolls instead
    var lab = e.target.closest && e.target.closest('#psSide .ps-group:not(.ps-m)>.ps-label');
    if (lab) drag = { g: lab.parentNode, y: e.clientY, on: false, id: e.pointerId };
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on) {
      if (Math.abs(e.clientY - drag.y) < 7) return;
      drag.on = true; drag.g.classList.add('ps-drag'); document.body.classList.add('ps-dragging');
    }
    e.preventDefault();
    var gs = document.querySelectorAll('#psSide .ps-group:not(.ps-m)');
    for (var i = 0; i < gs.length; i++) {
      var o = gs[i]; if (o === drag.g) continue;
      var r = o.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) continue;
      var before = e.clientY < r.top + r.height / 2;
      if (before && o.previousElementSibling !== drag.g) o.parentNode.insertBefore(drag.g, o);
      else if (!before && o.nextElementSibling !== drag.g) o.parentNode.insertBefore(drag.g, o.nextElementSibling);
      break;
    }
  }, { passive: false });
  function dragEnd(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    if (drag.on) {
      drag.g.classList.remove('ps-drag'); document.body.classList.remove('ps-dragging');
      var order = [].map.call(document.querySelectorAll('#psSide .ps-group:not(.ps-m)'), function (x) { return x.getAttribute('data-group'); });
      try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (e3) {}
      dragJust = true; setTimeout(function () { dragJust = false; }, 300);
    }
    drag = null;
  }
  document.addEventListener('pointerup', dragEnd);
  document.addEventListener('pointercancel', dragEnd);
  function refresh() {
    var current = null;
    items.forEach(function (it) { if (!current && isActive(it)) current = it; });
    document.querySelectorAll('#psSide [data-href], #psTabs [data-href]').forEach(function (a) {
      a.classList.toggle('on', !!current && a.getAttribute('data-href') === current.href);
    });
    document.body.classList.toggle('ps-wide', !!(current && current.wide));
    document.getElementById('psTitle').textContent = current ? current.text : 'Portal dokumentów';
    document.getElementById('psBarTitle').textContent = current ? current.text : 'Portal dokumentów';
    document.querySelectorAll('#psBar [data-top]').forEach(function (l) { l.classList.toggle('on', l.getAttribute('data-top') === page); });
    document.body.classList.remove('ps-open');
    applyFold();
  }

  function toggleMenu() { document.body.classList.toggle('ps-open'); }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('#psMenu') || t.closest('#psMore')) return toggleMenu();
    if (dragJust) { dragJust = false; if (t.closest('[data-fold]')) return; }
    var fold = t.closest('[data-fold]');
    if (fold) {
      var grp = fold.closest('.ps-group'), st = foldState();
      st[grp.getAttribute('data-group')] = !grp.classList.contains('open');
      grp.dataset.touched = '1';
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(st)); } catch (e2) {}
      return applyFold();
    }
    if (t.closest('#psDim') || t.closest('#psSide a')) return document.body.classList.remove('ps-open');
    if (t.closest('[data-pt-open]')) {
      e.preventDefault();
      var dd = document.getElementById('psDrop'); if (dd) dd.hidden = true;
      document.body.classList.remove('ps-open');
      return window.PortalTheme ? window.PortalTheme.open() : undefined;
    }
    var drop = document.getElementById('psDrop');
    if (t.closest('#psGear')) {
      drop.hidden = !drop.hidden;
      document.getElementById('psGear').setAttribute('aria-expanded', drop.hidden ? 'false' : 'true');
      return;
    }
    if (drop && !drop.hidden && !t.closest('#psDrop')) drop.hidden = true;
    if (t.closest('#psOut') || t.closest('#psOut2')) {
      (t.closest('#psOut') || t.closest('#psOut2')).disabled = true;
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
