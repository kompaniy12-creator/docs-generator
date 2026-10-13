/* Auth guard for protected portal pages.
   Include AFTER supabase-config.js, as early as possible in <head>.
   Hides the page until a valid session is confirmed; otherwise redirects to login. */
(function () {
  // Hide content immediately to avoid a flash of the protected page.
  var rootEl = document.documentElement;
  rootEl.style.visibility = 'hidden';

  function reveal() {
    rootEl.style.visibility = '';
  }

  // Speed only, no effect on access: open the connection to the backend and fetch the two shell scripts while the
  // session is being checked. They are still EXECUTED only after the check below, in the same order as before.
  var stamp = Math.floor(Date.now() / 3e5);
  try {
    [['preconnect', 'https://dpfxwkxpzqqjtmgqwozw.supabase.co', ''], ['preload', 'portal-theme.js?t=' + stamp, 'script'], ['preload', 'portal-shell.js?t=' + stamp, 'script']].forEach(function (x) {
      var l = document.createElement('link');
      l.rel = x[0]; l.href = x[1];
      if (x[2]) l.as = x[2]; else l.crossOrigin = 'anonymous';
      document.head.appendChild(l);
    });
  } catch (e) {}

  // Routing hint only: the portal's edge functions run in the region of the database (eu-west-1) instead of the
  // one nearest to the browser, so each of their own calls to the database and the auth server is a short hop
  // (measured: ~85 ms less per call). Same URL, same headers, same body; to switch it off, delete this block.
  try {
    var FN_BASE = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/', nativeFetch = window.fetch;
    if (nativeFetch && !nativeFetch.tdRegion) {
      var regionFetch = function (input, init) {
        if (typeof input === 'string' && input.indexOf(FN_BASE) === 0 && input.indexOf('forceFunctionRegion=') === -1) {
          input += (input.indexOf('?') === -1 ? '?' : '&') + 'forceFunctionRegion=eu-west-1';
        }
        return nativeFetch.call(window, input, init);
      };
      regionFetch.tdRegion = true;
      window.fetch = regionFetch;
    }
  } catch (e) {}

  function gotoLogin(extra) {
    var here = location.pathname.split('/').pop() || 'index.html';
    var ret = encodeURIComponent(here + location.search);
    location.replace('login.html?return=' + ret + (extra ? '&' + extra : ''));
  }

  // The auth project is shared with other apps, so authentication alone is not
  // enough — a user must be explicitly granted portal access via app_metadata.portal
  // (set server-side with the service_role key; cannot be forged from the browser).
  function hasPortalAccess(user) {
    return !!(user && user.app_metadata && user.app_metadata.portal === true);
  }

  // Sections: a user may be limited to some of them via app_metadata.portal_sections
  // (no list = all; admins = all). Data is protected by RLS on the server — this
  // only keeps people out of pages whose data they could not load anyway.
  var PAGE_SECTION = {
    'rejestracja.html': 'rejestracja',
    'wynagrodzenie.html': 'biezaca', 'e-urzad.html': 'biezaca', 'pelnomocnictwo.html': 'biezaca',
    'zalacznik-pobyt.html': 'legalizacja', 'nip-8.html': 'biezaca',
    'umowa-zlecenie.html': 'kadry', 'rejestr.html': 'kadry', 'zatrudnienie.html': 'kadry', 'import.html': 'kadry', 'kontrola.html': 'kadry', 'wiedza.html': 'kadry', 'akta.html': 'kadry', 'dokumenty.html': 'kadry', 'podpisy.html': 'kadry',
    'onboarding.html': 'onboarding', 'ksiegowosc.html': 'onboarding', 'terminy-ksiegowe.html': 'onboarding', 'narzedzia-ksiegowe.html': 'onboarding',
    // a list = any of these sections is enough; '@admin' = administrators only
    'sms.html': ['kadry', 'onboarding'], 'rozsylka.html': ['kadry', 'onboarding'], 'poczta.html': ['kadry', 'onboarding'], 'zgloszenia-klientow.html': ['kadry', 'onboarding'],
    'pulpit.html': '@admin', 'umowy.html': '@admin', 'zespol.html': '@admin', 'dostep.html': '@admin',
  };
  function hasSection(user, section) {
    var m = (user && user.app_metadata) || {};
    if (section === '@admin') return m.portal_admin === true;
    if (Array.isArray(section)) return section.some(function (x) { return hasSection(user, x); });
    if (m.portal_admin === true || !Array.isArray(m.portal_sections)) return true;
    return m.portal_sections.indexOf(section) !== -1;
  }

  // Uprawnienia szczegółowe: an administrator can also switch single pages and functions off for a person
  // (app_metadata.portal_wylaczone, a deny list of catalogue keys — see uprawnienia.js). Accounts without that
  // claim, and administrators, are not restricted and go through exactly as before: the catalogue is not even
  // fetched for them. For a restricted account the catalogue decides which pages open; if it cannot be loaded
  // nothing but the start page opens (fail closed). The real barrier is the server (edge functions).
  function isRestricted(user) {
    var m = (user && user.app_metadata) || {};
    return m.portal_admin !== true && m.portal_wylaczone !== undefined && m.portal_wylaczone !== null;
  }
  function loadCatalogue(cb) {
    if (window.Uprawnienia) { cb(window.Uprawnienia); return; }
    var done = false, fin = function () { if (done) return; done = true; cb(window.Uprawnienia || null); };
    var c = document.createElement('script');
    c.src = 'uprawnienia.js?t=' + stamp;
    c.onload = fin; c.onerror = fin;
    setTimeout(fin, 8000);
    document.head.appendChild(c);
  }

  if (!window.sb) {
    // Config failed to load — fail closed.
    gotoLogin();
    return;
  }

  window.sb.auth.getSession().then(function (res) {
    var session = res && res.data ? res.data.session : null;
    if (!session) { gotoLogin(); return; }
    if (!hasPortalAccess(session.user)) {
      // Authenticated but not authorized for this portal — drop the session.
      window.sb.auth.signOut().then(function () { gotoLogin('denied=1'); });
      return;
    }
    var page = location.pathname.split('/').pop() || 'index.html';
    if (PAGE_SECTION[page] && !hasSection(session.user, PAGE_SECTION[page])) {
      location.replace('index.html?brak=1');
      return;
    }
    if (!isRestricted(session.user)) { enter(session, false, null); return; }
    loadCatalogue(function (U) {
      // the start page is never denied; every other page needs its key (and, without the catalogue, stays closed)
      var wolno = false;
      try { wolno = page === 'index.html' || !!(U && U.mozeStrone(session.user.app_metadata, page + location.search)); } catch (e) { U = null; wolno = page === 'index.html'; }
      if (!wolno) { location.replace('index.html?brak=1'); return; }
      try { enter(session, true, U); } catch (e) { gotoLogin(); }
    });
  }).catch(function () {
    gotoLogin();
  });

  function enter(session, restricted, U) {
    var meta = (session.user && session.user.app_metadata) || {};
    window.PortalAccess = {
      has: function (s) { return hasSection(session.user, s); },
      // moze(key): is this function switched on for the account; mozeStrone(href): may the account open the page
      // (its sections included). An unrestricted account gets true for both — pages keep their own section checks.
      ograniczony: restricted,
      blad: restricted && !U, // the catalogue could not be loaded: everything stays hidden
      moze: function (k) { return !restricted || !!(U && U.mozna(meta, k)); },
      mozeStrone: function (href) { return !restricted || !!(U && U.mozeStrone(meta, href)); },
      // the first page of the menu the account may open ('' = none, or not restricted)
      pierwsza: function () { return restricted && U ? U.pierwszaStrona(meta) : ''; },
    };
    window.PortalUser = {
      email: session.user && session.user.email,
      admin: !!(session.user && session.user.app_metadata && session.user.app_metadata.portal_admin === true),
    };
    document.dispatchEvent(new CustomEvent('portal:access'));
    // Navigation shell (sidebar / mobile menu). The page is revealed once it is in
    // place, so the layout does not jump; without it, fall back to the logout pill.
    var shown = false;
    var show = function (fallback) {
      if (shown) return;
      shown = true;
      if (fallback) injectLogoutBar(window.PortalUser.email);
      reveal();
    };
    var shell = document.createElement('script');
    shell.src = 'portal-shell.js?t=' + stamp;
    shell.onload = function () { show(false); };
    shell.onerror = function () { show(true); };
    // the look (theme, background, accent) first, so the shell appears already themed
    var theme = document.createElement('script');
    theme.src = 'portal-theme.js?t=' + stamp;
    theme.onload = theme.onerror = function () { document.head.appendChild(shell); };
    document.head.appendChild(theme);
    setTimeout(function () { show(!document.getElementById('psSide')); }, 2500);
  }

  // Redirect to login if the user signs out in another tab.
  window.sb.auth.onAuthStateChange(function (event, session) {
    if (!session) gotoLogin();
  });

  function injectLogoutBar(email) {
    function build() {
      if (document.getElementById('authBar')) return;
      var bar = document.createElement('div');
      bar.id = 'authBar';
      bar.style.cssText =
        'position:fixed;top:10px;right:12px;z-index:9999;display:flex;align-items:center;' +
        'gap:10px;padding:6px 10px 6px 12px;background:#fff;border:1px solid #e5e9ef;' +
        'border-radius:999px;box-shadow:0 2px 10px rgba(27,63,127,.10);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
        'font-size:12.5px;color:#555;';
      var who = document.createElement('span');
      who.textContent = email || 'zalogowano';
      who.style.cssText = 'max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Wyloguj';
      btn.style.cssText =
        'border:none;cursor:pointer;font:inherit;font-weight:600;font-size:12.5px;' +
        'color:#fff;background:#1B3F7F;padding:6px 12px;border-radius:999px;';
      btn.addEventListener('click', function () {
        btn.disabled = true; btn.textContent = '...';
        try { Object.keys(localStorage).forEach(function (k) { if (/^tdcg_(autosave_|zlecenie_import$)/.test(k)) localStorage.removeItem(k); }); } catch (e) {}
        try { sessionStorage.removeItem('tdcg_liczniki'); } catch (e) {}
        window.sb.auth.signOut().then(function () { location.replace('login.html'); });
      });
      bar.appendChild(who);
      bar.appendChild(btn);
      document.body.appendChild(bar);
    }
    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build);
  }
})();
