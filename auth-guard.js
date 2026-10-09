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
    'sms.html': ['kadry', 'onboarding'], 'rozsylka.html': ['kadry', 'onboarding'], 'poczta.html': ['kadry', 'onboarding'],
    'pulpit.html': '@admin', 'zespol.html': '@admin', 'dostep.html': '@admin',
  };
  function hasSection(user, section) {
    var m = (user && user.app_metadata) || {};
    if (section === '@admin') return m.portal_admin === true;
    if (Array.isArray(section)) return section.some(function (x) { return hasSection(user, x); });
    if (m.portal_admin === true || !Array.isArray(m.portal_sections)) return true;
    return m.portal_sections.indexOf(section) !== -1;
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
    window.PortalAccess = { has: function (s) { return hasSection(session.user, s); } };
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
    shell.src = 'portal-shell.js?t=' + Math.floor(Date.now() / 3e5);
    shell.onload = function () { show(false); };
    shell.onerror = function () { show(true); };
    // the look (theme, background, accent) first, so the shell appears already themed
    var theme = document.createElement('script');
    theme.src = 'portal-theme.js?t=' + Math.floor(Date.now() / 3e5);
    theme.onload = theme.onerror = function () { document.head.appendChild(shell); };
    document.head.appendChild(theme);
    setTimeout(function () { show(!document.getElementById('psSide')); }, 2500);
  }).catch(function () {
    gotoLogin();
  });

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
