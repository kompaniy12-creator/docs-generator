/* portal-theme.js — Portal look: themes with backgrounds, glass navigation, accent colour, own picture.
   The choice is personal and kept in this browser (localStorage). Applied before the shell
   is mounted, so a page never flashes in the wrong colours. window.PortalTheme.open() shows
   the picker. */
(function () {
  'use strict';
  if (window.PortalTheme) return;
  var KEY = 'tdcg_wyglad', IMG_KEY = 'tdcg_wyglad_tlo';
  // bg: CSS background; dark: light text on the background and glass navigation
  var THEMES = [
    { id: 'klasyczny', sw: '#f6f8fb', name: 'Klasyczny', dark: false, accent: '#1B3F7F', bg: '#f6f8fb' },
    { id: 'aurora', sw: 'linear-gradient(135deg,#7c3aed,#2563eb 55%,#06b6d4)', name: 'Aurora', dark: true, accent: '#5b5bf0',
      bg: 'radial-gradient(1100px 700px at 12% 8%,#7c3aed 0%,transparent 60%),radial-gradient(900px 700px at 88% 18%,#2563eb 0%,transparent 62%),radial-gradient(1000px 800px at 70% 96%,#06b6d4 0%,transparent 58%),radial-gradient(900px 700px at 8% 92%,#4f46e5 0%,transparent 60%),#1e1b4b' },
    // made by the office's owner: night sky over water, clear blocks and menus
    { id: 'kosmos', sw: 'url(/motywy/kosmos.jpg) center/cover', name: 'Kosmos', dark: true, accent: '#2563eb', card: 30, menu: 0,
      bg: 'url("/motywy/kosmos.jpg")' },
    { id: 'noworoczny', sw: 'url(/motywy/swieta.jpg) center/cover', name: 'Noworoczny', dark: true, accent: '#1B3F7F', card: 30, menu: 0,
      bg: 'url("/motywy/swieta.jpg")' },
    { id: 'ocean', sw: 'linear-gradient(135deg,#0369a1,#22d3ee 60%,#0f766e)', name: 'Ocean', dark: true, accent: '#0e7490',
      bg: 'radial-gradient(1000px 700px at 85% 5%,#22d3ee 0%,transparent 58%),radial-gradient(1100px 800px at 10% 30%,#0369a1 0%,transparent 62%),radial-gradient(1000px 700px at 60% 100%,#0f766e 0%,transparent 60%),#082f49' },
    { id: 'zachod', sw: 'linear-gradient(135deg,#e11d48,#f59e0b 55%,#7c3aed)', name: 'Zachód słońca', dark: true, accent: '#c2410c',
      bg: 'radial-gradient(1000px 700px at 88% 8%,#f59e0b 0%,transparent 55%),radial-gradient(1100px 800px at 20% 20%,#e11d48 0%,transparent 60%),radial-gradient(1100px 800px at 60% 100%,#7c3aed 0%,transparent 62%),#4a044e' },
    { id: 'las', sw: 'linear-gradient(135deg,#16a34a,#0d9488 60%,#365314)', name: 'Las', dark: true, accent: '#15803d',
      bg: 'radial-gradient(1000px 700px at 10% 10%,#16a34a 0%,transparent 58%),radial-gradient(1000px 800px at 90% 30%,#0d9488 0%,transparent 60%),radial-gradient(1000px 700px at 50% 100%,#365314 0%,transparent 62%),#052e16' },
    { id: 'grafit', sw: 'linear-gradient(135deg,#475569,#0f172a 60%,#1e3a8a)', name: 'Grafit', dark: true, accent: '#334155',
      bg: 'radial-gradient(1100px 700px at 15% 0%,#475569 0%,transparent 60%),radial-gradient(1000px 800px at 90% 90%,#1e3a8a 0%,transparent 62%),#0f172a' },
    { id: 'piasek', sw: 'linear-gradient(135deg,#fde68a,#fecdd3 55%,#bae6fd)', name: 'Piasek', dark: false, accent: '#9a3412',
      bg: 'radial-gradient(1000px 700px at 10% 0%,#fde68a 0%,transparent 60%),radial-gradient(1000px 800px at 95% 30%,#fecdd3 0%,transparent 60%),radial-gradient(1000px 700px at 50% 100%,#bae6fd 0%,transparent 62%),#fff7ed' },
    { id: 'mietowy', sw: 'linear-gradient(135deg,#a7f3d0,#bfdbfe 55%,#ddd6fe)', name: 'Miętowy', dark: false, accent: '#0f766e',
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
    var dark = own ? s.ownDark !== false : t.dark;
    var pct = function (v, def) { return v === undefined || v === null || isNaN(Number(v)) ? def : Math.max(0, Math.min(100, Number(v))); };
    return { id: own ? 'wlasne' : t.id, dark: dark, accent: s.accent || t.accent, bg: own ? null : t.bg, own: own,
      card: pct(s.card, !own && t.card !== undefined ? t.card : dark ? 80 : 72), menu: pct(s.menu, !own && t.menu !== undefined ? t.menu : dark ? 16 : 45) }; // menus: almost clear, the background shows through
  }

  var css = document.createElement('style');
  css.id = 'psThemeCss';
  css.textContent = [
    'html.pt body.ps{background:var(--pt-bg);background-attachment:fixed;background-size:cover;background-position:center}',
    'html.pt body.ps::before{content:"";position:fixed;inset:0;z-index:-1;background:var(--pt-bg);background-size:cover;background-position:center}',
    // accent everywhere: the shell and the pages share these variables
    'html.pt{--ps-navy:var(--pt-accent);--brand-navy:var(--pt-accent);--brand-navy-dark:var(--pt-accent-d);--ps-tint:var(--pt-tint);--brand-tint:var(--pt-tint)}',
    // glass navigation
    'html.pt #psSide{background:var(--pt-glass);backdrop-filter:blur(var(--pt-blur)) saturate(1.05);-webkit-backdrop-filter:blur(var(--pt-blur)) saturate(1.05);border-right:1px solid var(--pt-line)}',
    'html.pt #psBar,html.pt #psTop,html.pt #psTabs{background:var(--pt-glass);backdrop-filter:blur(var(--pt-blur)) saturate(1.05);-webkit-backdrop-filter:blur(var(--pt-blur)) saturate(1.05);border-color:var(--pt-line)}',
    // on dark menus: the sign in colour, the lettering in white
    'html.pt-dark .ps-logo{background-image:url(/logo-kolor-jasny.png)}',
    'html.pt .ps-item{border-radius:12px;transition:background .15s,transform .15s}',
    'html.pt .ps-item:hover{transform:translateX(2px)}',
    'html.pt .ps-item.on{box-shadow:0 6px 18px rgba(0,0,0,.18)}',
    'html.pt .ps-ico{border-radius:9px}',
    // content cards: soft, slightly translucent, bigger radius
    'html.pt body.ps main .box,html.pt body.ps main .card,html.pt body.ps main .tile,html.pt body.ps main .firm,html.pt body.ps main .task,html.pt body.ps main .rule,html.pt body.ps main .item,html.pt body.ps main fieldset,html.pt body.ps main .krs-find{border-radius:16px;border-color:rgba(255,255,255,.55);box-shadow:0 10px 30px rgba(15,23,42,.10)}',
    // content blocks are frosted glass: the background shows through a little
    'html.pt body.ps main .box,html.pt body.ps main .tile,html.pt body.ps main .firm,html.pt body.ps main .task,html.pt body.ps main .rule,html.pt body.ps main fieldset,html.pt body.ps main .card,html.pt body.ps main .item,html.pt body.ps main .remfirm{background:var(--pt-card);backdrop-filter:blur(20px) saturate(1.1);-webkit-backdrop-filter:blur(20px) saturate(1.1)}',
    'html.pt body.ps main .box .remfirm,html.pt body.ps main .box .task,html.pt body.ps main fieldset fieldset{background:rgba(255,255,255,.5);backdrop-filter:none;-webkit-backdrop-filter:none}',
    // a table standing on its own is a block too; inside a block it stays clear
    'html.pt body.ps main table{background:var(--pt-card);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}',
    'html.pt body.ps main th,html.pt body.ps main td{background:transparent}',
    'html.pt body.ps main .box table,html.pt body.ps main .card table,html.pt body.ps main fieldset table{background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none}',
    // section titles of forms sit on the edge of the block: give them their own solid label
    'html.pt body.ps main legend{background:#fff;color:var(--pt-accent);border-radius:999px;padding:5px 14px;margin-left:-4px;font-weight:700;box-shadow:0 4px 14px rgba(15,23,42,.14)}',
    'html.pt body.ps main fieldset{padding-top:18px}',
    'html.pt body.ps main table{border-radius:14px}',
    // dark backgrounds: light text for everything that sits directly on the background
    'html.pt-dark #psSide,html.pt-dark #psBar,html.pt-dark #psTop,html.pt-dark #psTabs{color:#fff}',
    'html.pt-dark .ps-item,html.pt-dark .ps-top,html.pt-dark #psTabs a,html.pt-dark #psTabs button{color:rgba(255,255,255,.88)}',
    'html.pt-dark .ps-label{color:rgba(255,255,255,.9)}',
    'html.pt-dark #psSide,html.pt-dark #psBar{text-shadow:0 1px 6px rgba(0,0,0,.45)}',
    'html.pt-dark #psSide .ps-badge,html.pt-dark #psBar .ps-badge,html.pt-dark .ps-out{text-shadow:none}',
    'html.pt-dark .ps-group.open{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.14)}',
    'html.pt-dark .ps-group.open>.ps-label{color:rgba(255,255,255,.58)}',
    'html.pt-dark .ps-group.has-on:not(.open){background:rgba(255,255,255,.14)}',
    'html.pt:not(.pt-dark) .ps-group.open{background:rgba(255,255,255,.4);border-color:var(--pt-line)}',
    'html.pt-dark .ps-item:hover,html.pt-dark .ps-top:hover,html.pt-dark .ps-label:hover{background:rgba(255,255,255,.14);color:#fff}',
    'html.pt-dark .ps-item.on,html.pt-dark .ps-top.on{background:rgba(255,255,255,.2);color:#fff}',
    'html.pt-dark .ps-group.has-on:not(.open) .ps-label{color:#fff}',
    'html.pt-dark .ps-ico{background:rgba(255,255,255,.12);box-shadow:none}',
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
    // small texts that stand directly on the background: empty states, footers, stamps, links in the lead
    'html.pt-dark body.ps main .empty,html.pt-dark body.ps main .loading,html.pt-dark body.ps main>.stamp,html.pt-dark body.ps footer,html.pt-dark body.ps footer a,html.pt-dark body.ps main>.lead a,html.pt-dark body.ps .content-head .lead a{color:rgba(255,255,255,.88);text-shadow:0 1px 8px rgba(0,0,0,.35)}',
    'html.pt-dark body.ps main .box .empty,html.pt-dark body.ps main .card .empty,html.pt-dark body.ps main table .empty,html.pt-dark body.ps main fieldset .empty,html.pt-dark body.ps main .firm .empty,html.pt-dark body.ps main .task .empty,html.pt-dark body.ps main .box .loading{color:#7a8699;text-shadow:none}',
    // pages without the portal shell (sign-in, client profile) carry body.pt-page
    'html.pt{--navy:var(--pt-accent);--navy-d:var(--pt-accent-d);--tint:var(--pt-tint)}',
    'html.pt body.pt-page{background:var(--pt-bg);background-attachment:fixed;background-size:cover;background-position:center;min-height:100vh}',
    'html.pt body.pt-page header{background:var(--pt-glass);backdrop-filter:blur(30px) saturate(1.05);-webkit-backdrop-filter:blur(30px) saturate(1.05);border-color:var(--pt-line)}',
    'html.pt body.pt-page .box,html.pt body.pt-page .tile,html.pt body.pt-page .login,html.pt body.pt-page .card{background:var(--pt-card);backdrop-filter:blur(20px) saturate(1.1);-webkit-backdrop-filter:blur(20px) saturate(1.1);border-radius:18px;border-color:rgba(255,255,255,.55);box-shadow:0 14px 40px rgba(15,23,42,.16)}',
    'html.pt body.pt-page header img{border-radius:10px}',
    'html.pt-dark body.pt-page header strong{color:#fff}',
    'html.pt-dark body.pt-page header button{background:rgba(255,255,255,.18);color:#fff}',
    'html.pt-dark body.pt-page main>h1{color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.35)}',
    'html.pt-dark body.pt-page main>.lead,html.pt-dark body.pt-page footer,html.pt-dark body.pt-page footer a{color:rgba(255,255,255,.9);text-shadow:0 1px 8px rgba(0,0,0,.35)}',
    '#ptFab{position:fixed;right:16px;bottom:16px;z-index:999;width:46px;height:46px;border-radius:50%;border:none;background:rgba(255,255,255,.92);box-shadow:0 8px 24px rgba(15,23,42,.22);font-size:21px;cursor:pointer}',
    '#ptFab:hover{transform:scale(1.06)}',
    'body.pt-page #ptPanel{top:auto;bottom:72px}',
    // ---- clear blocks on a dark background: dark glass, light text
    'html.pt-clear body.ps main :is(.box,.tile,.firm,.task,.rule,fieldset,.card,.item,table){border-color:rgba(255,255,255,.2);color:rgba(255,255,255,.92)}',
    'html.pt-clear body.ps main :is(.box,.tile,.firm,.task,.rule,fieldset,.card,.item,table) :is(h2,h3,h4,p,span,small,strong,b,em,td,th,dt,dd,li,label,div,summary,a,pre):not(.pill,.badge,.mini,.btn,.ps-badge,.warnbox,.status,.krs-status,.msg,.krs-hit,.card-ico,.ico,.pill *,.warnbox *,.status *,.krs-status *,.msg *,.krs-hit *,button *,legend *){color:rgba(255,255,255,.92)!important}',
    'html.pt-clear body.ps main :is(.box,.tile,.firm,.task,.rule,fieldset,.card,.item,table) :is(small,.hint,.sub,.d,th,dt){color:rgba(255,255,255,.66)!important}',
    'html.pt-clear body.ps main .tile.red b{color:#fca5a5!important}',
    'html.pt-clear body.ps main .tile.amber b{color:#fcd34d!important}',
    'html.pt-clear body.ps main .tile.green b{color:#86efac!important}',
    'html.pt-clear body.ps main .tile.zero b{color:rgba(255,255,255,.45)!important}',
    'html.pt-clear body.ps main :is(.box,.tile,.firm,.task,.rule,fieldset,.card,.item,table) :is(.cm,pre,.remfirm,.subgroup,.send-box,.pd-g){background:rgba(255,255,255,.08)!important}',
    'html.pt-clear body.ps main :is(th,td,.line,.row){border-color:rgba(255,255,255,.14)!important}',
    // rows that light up on hover keep the light text readable
    'html.pt-clear body.ps main :is(.card-head,.firm-head,.fhead,.docs a,.doc-add,.mini-btn,tr):hover{background:rgba(255,255,255,.1)!important}',
    'html.pt-clear body.ps main .bar{background:rgba(255,255,255,.2)}',
    'html.pt-clear body.ps main .bar i,html.pt-clear body.ps main .spark i{background:rgba(255,255,255,.82)}',
    'html.pt-clear body.ps main .spark i.z{background:rgba(255,255,255,.2)}',
    'html.pt-clear body.ps main .box .remfirm,html.pt-clear body.ps main .box .task,html.pt-clear body.ps main fieldset fieldset{background:rgba(255,255,255,.07)}',
    'html.pt-clear body.pt-page :is(.box,.tile){border-color:rgba(255,255,255,.2);color:rgba(255,255,255,.92)}',
    'html.pt-clear body.pt-page :is(.box,.tile) :is(h2,p,span,small,strong,b,div,a):not(.pill,.mini,.btn,.msg,.msg *,.pill *,button *){color:rgba(255,255,255,.92)!important}',
    'html.pt-clear body.pt-page .tile.red b{color:#fca5a5!important}',
    'html.pt-clear body.pt-page .tile.amber b{color:#fcd34d!important}',
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
    '.pt-range{display:grid;grid-template-columns:1fr 120px 40px;gap:10px;align-items:center;font-size:13px;color:#3a4759;margin:0 0 8px}',
    '.pt-range input{width:100%;accent-color:#111}',
    '.pt-range b{font-size:12.5px;color:#111;text-align:right}',
    '.pt-x{position:absolute;right:12px;top:10px;border:none;background:none;font-size:22px;line-height:1;color:#8a97ab;cursor:pointer}',
  ].join('\n');
  (document.head || document.documentElement).appendChild(css);

  function apply() {
    var c = current(), root = document.documentElement, st = root.style;
    var themed = c.id !== 'klasyczny' || c.accent.toLowerCase() !== '#1b3f7f';
    root.classList.toggle('pt', themed);
    root.classList.toggle('pt-dark', themed && c.dark);
    if (!themed) { root.classList.remove('pt-clear'); ['--pt-bg', '--pt-accent', '--pt-accent-d', '--pt-tint', '--pt-glass', '--pt-line', '--pt-card', '--pt-blur'].forEach(function (v) { st.removeProperty(v); }); return; }
    st.setProperty('--pt-bg', c.own ? 'url("' + c.own + '")' : c.bg);
    st.setProperty('--pt-accent', c.accent);
    st.setProperty('--pt-accent-d', shade(c.accent, -0.22));
    st.setProperty('--pt-tint', shade(c.accent, 0.9));
    st.setProperty('--pt-glass', (c.dark ? 'rgba(17,22,38,' : 'rgba(255,255,255,') + (c.menu / 100) + ')'); // matte; how solid is the user's choice
    // the clearer the menu, the less it blurs what is behind it
    st.setProperty('--pt-blur', Math.round(4 + c.menu * 0.26) + 'px');
    // dark background + clear blocks: white glass with dark text stops being readable, so the
    // blocks turn into dark glass and their text into light (class pt-clear)
    var clear = c.dark && c.card < 56;
    root.classList.toggle('pt-clear', clear);
    st.setProperty('--pt-card', clear ? 'rgba(13,18,34,' + (0.24 + c.card / 100 * 0.5).toFixed(2) + ')' : 'rgba(255,255,255,' + (c.card / 100) + ')');
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
      THEMES.map(function (t) { return '<button type="button" class="pt-sw' + (t.dark ? '' : ' light') + (c.id === t.id ? ' on' : '') + '" data-theme="' + t.id + '" style="background:' + t.sw + '"><span>' + t.name + '</span></button>'; }).join('') +
      (img() ? '<button type="button" class="pt-sw' + (c.id === 'wlasne' ? ' on' : '') + '" data-theme="wlasne" style="background-image:url(' + img() + ')"><span>Własne</span></button>' : '') +
      '</div>' +
      '<h4>Własne tło</h4><div class="pt-row"><button type="button" class="pt-btn" data-pt="upload">Wgraj zdjęcie…</button>' +
      (img() ? '<button type="button" class="pt-btn" data-pt="rmimg">Usuń zdjęcie</button>' : '') + '<input type="file" accept="image/*" hidden id="ptFile" /></div>' +
      (c.id === 'wlasne' ? '<label class="pt-check"><input type="checkbox" id="ptDark"' + (c.dark ? ' checked' : '') + ' /> jasny tekst na tle (dla ciemnych zdjęć)</label>' : '') +
      '<h4>Kolor akcentu</h4><div class="pt-colors">' +
      ACCENTS.map(function (a) { return '<button type="button" class="pt-c' + (c.accent.toLowerCase() === a.toLowerCase() ? ' on' : '') + '" data-accent="' + a + '" style="background:' + a + '" title="' + a + '"></button>'; }).join('') +
      '<input type="color" id="ptColor" value="' + c.accent + '" title="Dowolny kolor" /></div>' +
      (c.id !== 'klasyczny' || c.accent.toLowerCase() !== '#1b3f7f'
        ? '<h4>Przezroczystość</h4>' +
          '<label class="pt-range"><span>Bloki z treścią</span><input type="range" min="30" max="100" step="2" id="ptCard" value="' + c.card + '" /><b id="ptCardV">' + (100 - c.card) + '%</b></label>' +
          '<label class="pt-range"><span>Menu boczne i górne</span><input type="range" min="0" max="100" step="2" id="ptMenu" value="' + c.menu + '" /><b id="ptMenuV">' + (100 - c.menu) + '%</b></label>'
        : '') +
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
        if (th) { s.theme = th.getAttribute('data-theme'); delete s.accent; delete s.card; delete s.menu; }
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
      // sliders act while they are dragged; the panel is not redrawn so the thumb keeps its grip
      panel.addEventListener('input', function (e) {
        var id = e.target.id;
        if (id !== 'ptCard' && id !== 'ptMenu') return;
        var s = read();
        s[id === 'ptCard' ? 'card' : 'menu'] = Number(e.target.value);
        save(s); apply();
        panel.querySelector('#' + id + 'V').textContent = (100 - Number(e.target.value)) + '%';
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
  // sign-in page and client profile: a small button opens the picker
  function fab() {
    if (!document.body.classList.contains('pt-page') || document.getElementById('ptFab')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'ptFab'; b.title = 'Wygląd — motywy, tło i kolory'; b.textContent = '🎨';
    b.setAttribute('data-pt-open', '');
    b.addEventListener('click', open);
    document.body.appendChild(b);
  }
  if (document.body) fab(); else document.addEventListener('DOMContentLoaded', fab);
})();
