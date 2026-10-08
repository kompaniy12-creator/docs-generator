/* Portal look: themes with backgrounds, glass navigation, accent colour, own picture.
   The choice is personal and kept in this browser (localStorage). Applied before the shell
   is mounted, so a page never flashes in the wrong colours. window.PortalTheme.open() shows
   the picker. */
(function () {
  'use strict';
  if (window.PortalTheme) return;
  var KEY = 'tdcg_wyglad', IMG_KEY = 'tdcg_wyglad_tlo';
  // bg: CSS background; dark: light text on the background and glass navigation
  var THEMES = [
    { id: 'klasyczny', name: 'Klasyczny', dark: false, accent: '#1B3F7F', bg: '#f6f8fb' },
    { id: 'aurora', name: 'Aurora', dark: true, accent: '#5b5bf0',
      bg: 'radial-gradient(1100px 700px at 12% 8%,#7c3aed 0%,transparent 60%),radial-gradient(900px 700px at 88% 18%,#2563eb 0%,transparent 62%),radial-gradient(1000px 800px at 70% 96%,#06b6d4 0%,transparent 58%),radial-gradient(900px 700px at 8% 92%,#4f46e5 0%,transparent 60%),#1e1b4b' },
    { id: 'ocean', name: 'Ocean', dark: true, accent: '#0e7490',
      bg: 'radial-gradient(1000px 700px at 85% 5%,#22d3ee 0%,transparent 58%),radial-gradient(1100px 800px at 10% 30%,#0369a1 0%,transparent 62%),radial-gradient(1000px 700px at 60% 100%,#0f766e 0%,transparent 60%),#082f49' },
    { id: 'zachod', name: 'Zachód słońca', dark: true, accent: '#c2410c',
      bg: 'radial-gradient(1000px 700px at 88% 8%,#f59e0b 0%,transparent 55%),radial-gradient(1100px 800px at 20% 20%,#e11d48 0%,transparent 60%),radial-gradient(1100px 800px at 60% 100%,#7c3aed 0%,transparent 62%),#4a044e' },
    { id: 'las', name: 'Las', dark: true, accent: '#15803d',
      bg: 'radial-gradient(1000px 700px at 10% 10%,#16a34a 0%,transparent 58%),radial-gradient(1000px 800px at 90% 30%,#0d9488 0%,transparent 60%),radial-gradient(1000px 700px at 50% 100%,#365314 0%,transparent 62%),#052e16' },
    { id: 'grafit', name: 'Grafit', dark: true, accent: '#334155',
      bg: 'radial-gradient(1100px 700px at 15% 0%,#475569 0%,transparent 60%),radial-gradient(1000px 800px at 90% 90%,#1e3a8a 0%,transparent 62%),#0f172a' },
    { id: 'piasek', name: 'Piasek', dark: false, accent: '#9a3412',
      bg: 'radial-gradient(1000px 700px at 10% 0%,#fde68a 0%,transparent 60%),radial-gradient(1000px 800px at 95% 30%,#fecdd3 0%,transparent 60%),radial-gradient(1000px 700px at 50% 100%,#bae6fd 0%,transparent 62%),#fff7ed' },
    { id: 'mietowy', name: 'Miętowy', dark: false, accent: '#0f766e',
      bg: 'radial-gradient(1000px 700px at 5% 5%,#a7f3d0 0%,transparent 60%),radial-gradient(1000px 800px at 95% 20%,#bfdbfe 0%,transparent 60%),radial-gradient(1000px 700px at 60% 100%,#ddd6fe 0%,transparent 62%),#f0fdfa' },
  ];
  var ACCENTS = ['#1B3F7F', '#2563eb', '#5b5bf0', '#7c3aed', '#c026d3', '#e11d48', '#c2410c', '#b45309', '#15803d', '#0f766e', '#0e7490', '#334155'];

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function img() { try { return localStorage.getItem(IMG_KEY) || ''; } catch (e) { return ''; } }
  function shade(hex, k) { // k < 0 darker
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function (c) { return Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k))); };
    return '#' + [f(r), f(g), f(b)].map(function (c) { return ('0' + c.toString(16)).slice(-2); }).join('');
  }
  function current() {
    var s = read();
    var t = THEMES.filter(function (x) { return x.id === s.theme; })[0] || THEMES[0];
    var own = s.theme === 'wlasne' && img();
    return { id: own ? 'wlasne' : t.id, dark: own ? s.ownDark !== false : t.dark, accent: s.accent || t.accent, bg: own ? null : t.bg, own: own };
  }

  var css = document.createElement('style');
  css.id = 'psThemeCss';
  css.textContent = [
    'html.pt body.ps{background:var(--pt-bg);background-attachment:fixed;background-size:cover;background-position:center}',
    'html.pt body.ps::before{content:"";position:fixed;inset:0;z-index:-1;background:var(--pt-bg);background-size:cover;background-position:center}',
    // accent everywhere: the shell and the pages share these variables
    'html.pt{--ps-navy:var(--pt-accent);--brand-navy:var(--pt-accent);--brand-navy-dark:var(--pt-accent-d);--ps-tint:var(--pt-tint);--brand-tint:var(--pt-tint)}',
    // glass navigation
    'html.pt #psSide{background:var(--pt-glass);backdrop-filter:blur(22px) saturate(1.4);-webkit-backdrop-filter:blur(22px) saturate(1.4);border-right:1px solid var(--pt-line)}',
    'html.pt #psBar,html.pt #psTop,html.pt #psTabs{background:var(--pt-glass);backdrop-filter:blur(22px) saturate(1.4);-webkit-backdrop-filter:blur(22px) saturate(1.4);border-color:var(--pt-line)}',
    'html.pt #psSide .ps-brand img{border-radius:12px;box-shadow:0 4px 14px rgba(0,0,0,.18)}',
    'html.pt .ps-item{border-radius:12px;transition:background .15s,transform .15s}',
    'html.pt .ps-item:hover{transform:translateX(2px)}',
    'html.pt .ps-item.on{box-shadow:0 6px 18px rgba(0,0,0,.18)}',
    'html.pt .ps-ico{border-radius:9px;box-shadow:0 1px 3px rgba(0,0,0,.08)}',
    // content cards: soft, slightly translucent, bigger radius
    'html.pt body.ps main .box,html.pt body.ps main .card,html.pt body.ps main .tile,html.pt body.ps main .firm,html.pt body.ps main .task,html.pt body.ps main .rule,html.pt body.ps main .item,html.pt body.ps main fieldset,html.pt body.ps main .krs-find{border-radius:16px;border-color:rgba(255,255,255,.55);box-shadow:0 10px 30px rgba(15,23,42,.10)}',
    'html.pt body.ps main .box,html.pt body.ps main .tile,html.pt body.ps main .firm,html.pt body.ps main .task,html.pt body.ps main .rule,html.pt body.ps main fieldset{background:rgba(255,255,255,.94)}',
    'html.pt body.ps main table{border-radius:14px}',
    // dark backgrounds: light text for everything that sits directly on the background
    'html.pt-dark #psSide,html.pt-dark #psBar,html.pt-dark #psTop,html.pt-dark #psTabs{color:#fff}',
    'html.pt-dark .ps-item,html.pt-dark .ps-top,html.pt-dark #psTabs a,html.pt-dark #psTabs button{color:rgba(255,255,255,.88)}',
    'html.pt-dark .ps-label{color:rgba(255,255,255,.62)}',
    'html.pt-dark .ps-item:hover,html.pt-dark .ps-top:hover,html.pt-dark .ps-label:hover{background:rgba(255,255,255,.14);color:#fff}',
    'html.pt-dark .ps-item.on,html.pt-dark .ps-top.on{background:rgba(255,255,255,.24);color:#fff}',
    'html.pt-dark .ps-group.has-on:not(.open) .ps-label{color:#fff}',
    'html.pt-dark .ps-ico{background:rgba(255,255,255,.16);box-shadow:none}',
    'html.pt-dark #psBar strong,html.pt-dark #psTop strong,html.pt-dark .ps-who,html.pt-dark .ps-rodo,html.pt-dark .ps-user{color:rgba(255,255,255,.9)}',
    'html.pt-dark .ps-out{background:rgba(255,255,255,.2)}',
    'html.pt-dark #psTop button{background:rgba(255,255,255,.16);color:#fff}',
    'html.pt-dark #psTabs .on{color:#fff}',
    'html.pt-dark body.ps main>h1,html.pt-dark body.ps .content-head h1,html.pt-dark body.ps main>h2{color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.35)}',
    'html.pt-dark body.ps main>.lead,html.pt-dark body.ps .content-head .lead,html.pt-dark body.ps main>.hint,html.pt-dark body.ps main>p{color:rgba(255,255,255,.9);text-shadow:0 1px 8px rgba(0,0,0,.35)}',
    'html.pt-dark body.ps main>.lead a,html.pt-dark body.ps .content-head .lead a{color:#fff}',
    'html.pt-dark body.ps .filters label,html.pt-dark body.ps .fcount,html.pt-dark body.ps main>.empty,html.pt-dark body.ps #empty,html.pt-dark body.ps #loading,html.pt-dark body.ps #rules>h2,html.pt-dark body.ps .nav-label{color:rgba(255,255,255,.88)}',
    'html.pt-dark body.ps .filters select,html.pt-dark body.ps .search,html.pt-dark body.ps .toolbar input{background:rgba(255,255,255,.95)}',
    'html.pt-dark #onbBar{background:rgba(255,255,255,.92)}',
    // picker
    '#ptPanel{position:fixed;right:18px;top:66px;width:340px;max-width:calc(100vw - 24px);max-height:calc(100vh - 90px);overflow:auto;z-index:1000;background:#fff;color:#111;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.28);padding:18px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '#ptPanel[hidden]{display:none}',
    '#ptPanel h3{margin:0 0 2px;font-size:16px;color:#111}',
    '#ptPanel p{margin:0 0 12px;font-size:12.5px;color:#6b7a90}',
    '#ptPanel h4{margin:14px 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#8a97ab}',
    '.pt-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}',
    '.pt-sw{position:relative;aspect-ratio:4/3;border-radius:12px;border:2px solid transparent;cursor:pointer;padding:0;overflow:hidden;background-size:cover;background-position:center;box-shadow:inset 0 0 0 1px rgba(15,23,42,.12)}',
    '.pt-sw.on{border-color:#111;box-shadow:0 0 0 2px #fff inset}',
    '.pt-sw span{position:absolute;left:0;right:0;bottom:0;padding:3px 4px;font-size:10px;font-weight:600;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.55));text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pt-sw.light span{color:#111;background:linear-gradient(transparent,rgba(255,255,255,.8))}',
    '.pt-colors{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.pt-c{width:28px;height:28px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(15,23,42,.18);cursor:pointer;padding:0}',
    '.pt-c.on{box-shadow:0 0 0 2px #111}',
    '.pt-colors input[type=color]{width:34px;height:30px;border:none;background:none;padding:0;cursor:pointer}',
    '.pt-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.pt-btn{border:1px solid #d4dbe6;background:#fff;color:#111;border-radius:10px;padding:8px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}',
    '.pt-btn:hover{border-color:#111}',
    '.pt-check{display:flex;align-items:center;gap:8px;font-size:13px;color:#3a4759;margin-top:10px;cursor:pointer}',
    '.pt-x{position:absolute;right:12px;top:10px;border:none;background:none;font-size:22px;line-height:1;color:#8a97ab;cursor:pointer}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  function apply() {
    var c = current(), root = document.documentElement, st = root.style;
    var themed = c.id !== 'klasyczny' || c.accent.toLowerCase() !== '#1b3f7f';
    root.classList.toggle('pt', themed);
    root.classList.toggle('pt-dark', themed && c.dark);
    if (!themed) { ['--pt-bg', '--pt-accent', '--pt-accent-d', '--pt-tint', '--pt-glass', '--pt-line'].forEach(function (v) { st.removeProperty(v); }); return; }
    st.setProperty('--pt-bg', c.own ? 'url("' + c.own + '")' : c.bg);
    st.setProperty('--pt-accent', c.accent);
    st.setProperty('--pt-accent-d', shade(c.accent, -0.22));
    st.setProperty('--pt-tint', shade(c.accent, 0.9));
    st.setProperty('--pt-glass', c.dark ? 'rgba(15,23,42,.34)' : 'rgba(255,255,255,.66)');
    st.setProperty('--pt-line', c.dark ? 'rgba(255,255,255,.16)' : 'rgba(15,23,42,.08)');
  }

  // own picture: scaled down so it fits in the browser's storage
  function loadImage(file, done) {
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      var k = Math.min(1, 1920 / Math.max(im.width, im.height));
      var cv = document.createElement('canvas');
      cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      var ctx = cv.getContext('2d');
      ctx.drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      // average brightness decides whether the text on it is light or dark
      var d = ctx.getImageData(0, 0, cv.width, cv.height).data, sum = 0, n = 0;
      for (var i = 0; i < d.length; i += 4 * 97) { sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
      var q = 0.82, data = cv.toDataURL('image/jpeg', q);
      while (data.length > 1400000 && q > 0.4) { q -= 0.1; data = cv.toDataURL('image/jpeg', q); }
      done(data, sum / n < 150);
    };
    im.onerror = function () { URL.revokeObjectURL(url); done(null); };
    im.src = url;
  }

  var panel = null;
  function render() {
    var s = read(), c = current();
    panel.innerHTML = '<button type="button" class="pt-x" data-pt="close" aria-label="Zamknij">×</button>' +
      '<h3>Wygląd portalu</h3><p>Ustawienie jest Twoje — zapisuje się w tej przeglądarce.</p>' +
      '<h4>Motyw</h4><div class="pt-grid">' +
      THEMES.map(function (t) { return '<button type="button" class="pt-sw' + (t.dark ? '' : ' light') + (c.id === t.id ? ' on' : '') + '" data-theme="' + t.id + '" style="background:' + t.bg + '"><span>' + t.name + '</span></button>'; }).join('') +
      (img() ? '<button type="button" class="pt-sw' + (c.id === 'wlasne' ? ' on' : '') + '" data-theme="wlasne" style="background-image:url(' + img() + ')"><span>Własne</span></button>' : '') +
      '</div>' +
      '<h4>Własne tło</h4><div class="pt-row"><button type="button" class="pt-btn" data-pt="upload">Wgraj zdjęcie…</button>' +
      (img() ? '<button type="button" class="pt-btn" data-pt="rmimg">Usuń zdjęcie</button>' : '') + '<input type="file" accept="image/*" hidden id="ptFile" /></div>' +
      (c.id === 'wlasne' ? '<label class="pt-check"><input type="checkbox" id="ptDark"' + (c.dark ? ' checked' : '') + ' /> jasny tekst na tle (dla ciemnych zdjęć)</label>' : '') +
      '<h4>Kolor akcentu</h4><div class="pt-colors">' +
      ACCENTS.map(function (a) { return '<button type="button" class="pt-c' + (c.accent.toLowerCase() === a.toLowerCase() ? ' on' : '') + '" data-accent="' + a + '" style="background:' + a + '" title="' + a + '"></button>'; }).join('') +
      '<input type="color" id="ptColor" value="' + c.accent + '" title="Dowolny kolor" /></div>' +
      '<div class="pt-row" style="margin-top:16px"><button type="button" class="pt-btn" data-pt="reset">Przywróć klasyczny wygląd</button></div>';
  }
  function open() {
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'ptPanel';
      document.body.appendChild(panel);
      panel.addEventListener('click', function (e) {
        var s = read(), t = e.target;
        var th = t.closest('[data-theme]'), ac = t.closest('[data-accent]'), act = t.closest('[data-pt]');
        if (th) { s.theme = th.getAttribute('data-theme'); delete s.accent; }
        else if (ac) s.accent = ac.getAttribute('data-accent');
        else if (act) {
          var a = act.getAttribute('data-pt');
          if (a === 'close') { panel.hidden = true; return; }
          if (a === 'upload') { panel.querySelector('#ptFile').click(); return; }
          if (a === 'rmimg') { try { localStorage.removeItem(IMG_KEY); } catch (e2) {} if (s.theme === 'wlasne') s.theme = 'klasyczny'; }
          if (a === 'reset') s = {};
        } else return;
        save(s); apply(); render();
      });
      panel.addEventListener('change', function (e) {
        var s = read();
        if (e.target.id === 'ptColor') { s.accent = e.target.value; save(s); apply(); render(); }
        if (e.target.id === 'ptDark') { s.ownDark = e.target.checked; save(s); apply(); }
        if (e.target.id === 'ptFile' && e.target.files[0]) {
          loadImage(e.target.files[0], function (data, dark) {
            if (!data) return alert('Nie udało się wczytać tego zdjęcia.');
            try { localStorage.setItem(IMG_KEY, data); } catch (err) { return alert('To zdjęcie jest za duże dla pamięci przeglądarki — wybierz mniejsze.'); }
            s.theme = 'wlasne'; s.ownDark = dark; delete s.accent;
            save(s); apply(); render();
          });
        }
      });
      document.addEventListener('click', function (e) {
        if (!panel.hidden && !e.target.closest('#ptPanel') && !e.target.closest('[data-pt-open]')) panel.hidden = true;
      });
    }
    panel.hidden = false;
    render();
  }

  apply();
  window.PortalTheme = { apply: apply, open: open };
})();

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
    { label: 'Legalizacja pobytu', sec: 'legalizacja', items: [
      { href: 'zalacznik-pobyt.html', ico: '🛂', text: 'Załącznik nr 1 do wniosku o pobyt', short: 'Załącznik' },
      { href: 'historia.html?s=legalizacja', ico: '🕘', text: 'Historia dokumentów', short: 'Historia', wide: true },
    ] },
    { label: 'Księgowość', sec: 'onboarding', items: [
      { href: 'onboarding.html', ico: '🚀', text: 'Onboarding klientów', short: 'Onboarding', wide: true },
      { href: 'onboarding.html?p=/deadlines', ico: '⏰', text: 'Terminy klientów', short: 'Terminy', wide: true },
    ] },
    { label: 'Ogólne', mobile: true, items: [
      { href: 'zadania.html', ico: '✅', text: 'Zadania', short: 'Zadania', wide: true, tasks: true },
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
    '.ps-label{display:flex;align-items:center;justify-content:space-between;width:100%;border:none;background:none;font-family:inherit;cursor:pointer;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7a90;margin:6px 0 2px;padding:9px 10px;border-radius:8px;text-align:left}',
    '.ps-label:hover{background:rgba(27,63,127,.07);color:var(--ps-navy)}',
    '.ps-chev{font-size:15px;line-height:1;transition:transform .15s;letter-spacing:0}',
    '.ps-group.open .ps-chev{transform:rotate(90deg)}',
    '.ps-group .ps-items{display:none}',
    '.ps-group.open .ps-items{display:block}',
    '.ps-group.has-on:not(.open) .ps-label{color:var(--ps-navy)}',
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
      // every module folds; the one with the current page is open, the rest as the user left them
      return '<div class="ps-group' + (g.mobile ? ' ps-m' : '') + '" data-group="' + esc(g.label) + '">' +
        '<button type="button" class="ps-label" data-fold aria-expanded="false"><span>' + esc(g.label) + '</span><span class="ps-chev">›</span></button>' +
        '<div class="ps-items">' + g.items.map(function (it) { return link(it, 'ps-item'); }).join('') +
        (g.sec === 'kadry' ? '<button type="button" class="ps-item ps-copy" id="psCopy"><span class="ps-ico">🔗</span><span data-copy-text>Kopiuj link do formularza dla klienta</span></button>' : '') +
        '</div></div>';
    }).join('') +
    '<div class="ps-foot">' +
      '<div class="ps-user ps-m"><span title="' + esc(user.email) + '">' + esc(user.email || 'zalogowano') + '</span><button type="button" class="ps-out" id="psOut">Wyloguj</button></div>' +
      '<a class="ps-rodo ps-m" href="#" data-pt-open>🎨 Wygląd portalu</a>' +
      '<a class="ps-rodo" href="rodo.html" target="_blank" rel="noopener">Informacja RODO</a>' +
    '</div>';

  var top = document.createElement('div');
  top.id = 'psTop';
  top.innerHTML = '<button type="button" id="psMenu" aria-label="Menu">☰</button><strong id="psTitle"></strong><img src="logo.png" alt="" />';

  // desktop top bar: things used from every module
  var CRM_URL = 'https://kompaniy12-creator.github.io/td-crm/';
  var bar = document.createElement('div');
  bar.id = 'psBar';
  bar.innerHTML =
    '<strong id="psBarTitle"></strong>' +
    '<nav>' +
      '<a class="ps-top" href="' + CRM_URL + '" target="_blank" rel="noopener" title="CRM — leady, sprawy, klienci (otwiera się w nowej karcie)">📇 CRM ↗</a>' +
      '<a class="ps-top" href="zadania.html" data-top="zadania.html">✅ Zadania<span class="ps-badge" data-tbadge hidden></span></a>' +
      (acc.has('kadry') ? '<a class="ps-top" href="zatrudnienie.html" data-top="zatrudnienie.html" title="Nowe zgłoszenia pracowników">📥<span class="ps-badge" data-badge hidden></span></a>' : '') +
      (user.admin ? '<a class="ps-top" href="dostep.html" data-top="dostep.html">🔑 Dostęp do portalu</a>' : '') +
      '<button type="button" class="ps-top" data-pt-open title="Wygląd — motywy, tło i kolory">🎨</button>' +
      '<div class="ps-menu"><button type="button" class="ps-top" id="psGear" aria-haspopup="true" aria-expanded="false" title="Ustawienia">⚙️ Ustawienia</button>' +
        '<div class="ps-drop" id="psDrop" hidden>' +
          (user.admin ? '<a href="dostep.html">👥 Użytkownicy i dostęp do modułów</a><a href="zadania.html#settings">🔔 Powiadomienia Telegram i eskalacje</a>' : '') +
          (acc.has('kadry') ? '<a href="kontrola.html#rem">✉️ Przypomnienia dla klientów</a><a href="wiedza.html">⚖️ Baza wiedzy — przepisy</a>' : '') +
          '<a href="#" data-pt-open>🎨 Wygląd — motywy, tło i kolory</a>' +
          '<a href="rodo.html" target="_blank" rel="noopener">🛡️ Informacja RODO</a>' +
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
      return window.PortalTheme.open();
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
