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
    injectLogoutBar(session.user && session.user.email);
    reveal();
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
