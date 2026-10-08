/* Onboarding klientów: the td-onboarding application shown inside the portal.
   The portal user is signed in there automatically: the page posts the user's portal
   session token to the app's /api/sso (a form post into the frame, so the token is never
   part of a URL); the app checks it with Supabase and opens its own session.
   onboarding.html?p=/clients/<id> opens a given screen of the app.
   The app follows the portal theme: the page sends it the theme's colours (plain values only,
   never the background picture) when the frame loads and whenever the theme changes. */
(function () {
  'use strict';
  var APP = 'https://td-onboarding.vercel.app';
  var $ = function (id) { return document.getElementById(id); };
  var submitted = false; // the sign-in form went into the frame: what loads there next is the app

  function target() {
    var p = new URLSearchParams(location.search).get('p') || '/';
    return /^\/(?!\/)[\w\-./?=&%]*$/.test(p) && p.indexOf('/api/') !== 0 ? p : '/';
  }
  async function open() {
    if (!window.sb) return;
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    if (!token) { $('onbState').textContent = 'Brak sesji — zaloguj się ponownie.'; return; }
    var f = $('onbSso');
    f.action = APP + '/api/sso';
    f.elements.token.value = token;
    f.elements.next.value = target();
    $('onbOpen').href = APP + target();
    submitted = true;
    f.submit();
    f.elements.token.value = '';
    $('onbState').textContent = '';
  }

  // ---- look: what portal-theme.js has set on <html>, as plain values
  function look() {
    var root = document.documentElement, cs = getComputedStyle(root);
    var v = function (n) { return cs.getPropertyValue(n).trim(); };
    var has = function (c) { return root.classList.contains(c); };
    if (!has('pt')) return { type: 'td-portal-theme', themed: false };
    return { type: 'td-portal-theme', themed: true, dark: has('pt-dark'), clear: has('pt-clear'),
      accent: v('--pt-accent'), accentD: v('--pt-accent-d'), tint: v('--pt-tint'),
      glass: v('--pt-glass'), line: v('--pt-line'), card: v('--pt-card'), blur: parseFloat(v('--pt-blur')) || 0 };
  }
  var ready = false, sent = '', queued = false;
  // only to the app's origin; the app checks the sender and every value on its side
  function sendLook(force) {
    var w = $('onbFrame').contentWindow, msg = look(), key = JSON.stringify(msg);
    if (!ready || !w || (!force && key === sent)) return;
    sent = key;
    w.postMessage(msg, APP);
  }
  function lookChanged() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; sendLook(false); });
  }
  // the picker changes classes and variables of <html>; another tab changes the saved choice
  new MutationObserver(lookChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  window.addEventListener('storage', function (e) {
    if (e.key !== 'tdcg_wyglad' && e.key !== 'tdcg_wyglad_tlo') return;
    if (window.PortalTheme) window.PortalTheme.apply();
    lookChanged();
  });
  // the app asks for the theme as soon as its page starts, before it is fully loaded
  window.addEventListener('message', function (e) {
    if (e.origin !== APP || e.source !== $('onbFrame').contentWindow) return;
    if (!e.data || e.data.type !== 'td-portal-theme?') return;
    ready = true;
    sendLook(true);
  });

  $('onbFrame').addEventListener('load', function () {
    $('onbState').textContent = '';
    if (submitted) { ready = true; sendLook(true); }
  });
  open();
})();
