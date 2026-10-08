/* Onboarding klientów: the td-onboarding application shown inside the portal.
   The portal user is signed in there automatically: the page posts the user's portal
   session token to the app's /api/sso (a form post into the frame, so the token is never
   part of a URL); the app checks it with Supabase and opens its own session.
   onboarding.html?p=/clients/<id> opens a given screen of the app.
   The app follows the portal theme: the page sends it the theme's colours, its background and
   the place of the frame in the window when the frame loads and whenever any of them changes. */
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
  // the background as the portal paints it: gradients, a theme picture (absolute address) or the user's
  // own picture — that one is named by a short mark here and sent on its own, only when the app asks
  var URL_RE = /^url\(\s*"?([^")]+)"?\s*\)$/;
  function ownPicture() {
    var m = URL_RE.exec(getComputedStyle(document.documentElement).getPropertyValue('--pt-bg').trim());
    return m && m[1].indexOf('data:') === 0 ? m[1] : '';
  }
  function mark(data) { return data.length + ':' + data.slice(100, 116) + data.slice(-16); }
  function background(v) {
    var m = URL_RE.exec(v);
    if (!m) return { kind: 'css', css: v };
    if (m[1].indexOf('data:') === 0) return { kind: 'own', rev: mark(m[1]) };
    return { kind: 'image', url: new URL(m[1], location.href).href };
  }
  function look() {
    var root = document.documentElement, cs = getComputedStyle(root);
    var v = function (n) { return cs.getPropertyValue(n).trim(); };
    var has = function (c) { return root.classList.contains(c); };
    if (!has('pt')) return { type: 'td-portal-theme', themed: false };
    return { type: 'td-portal-theme', themed: true, dark: has('pt-dark'), clear: has('pt-clear'),
      accent: v('--pt-accent'), accentD: v('--pt-accent-d'), tint: v('--pt-tint'),
      glass: v('--pt-glass'), line: v('--pt-line'), card: v('--pt-card'), blur: parseFloat(v('--pt-blur')) || 0,
      bg: background(v('--pt-bg')) };
  }
  // where the frame sits in the portal window: the app paints the same background inside the frame,
  // lined up with the portal's (body.ps::before — fixed, the whole window), so its blocks can frost it
  function place() {
    var r = $('onbFrame').getBoundingClientRect(), d = document.documentElement;
    return { type: 'td-portal-theme-geo', vw: d.clientWidth, vh: d.clientHeight, x: r.left, y: r.top };
  }
  var ready = false, sent = '', sentPlace = '', queued = false;
  // only to the app's origin; the app checks the sender and every value on its side
  function post(msg) {
    var w = $('onbFrame').contentWindow;
    if (ready && w) w.postMessage(msg, APP);
  }
  function sendLook(force) {
    var geo = place(), geoKey = JSON.stringify(geo);
    if (force || geoKey !== sentPlace) { sentPlace = geoKey; post(geo); }
    var msg = look(), key = JSON.stringify(msg);
    if (force || key !== sent) { sent = key; post(msg); }
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
  // the frame moves or changes size with the window and with the portal menu
  window.addEventListener('resize', lookChanged);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(lookChanged);
    ro.observe($('onbFrame'));
    ro.observe(document.documentElement);
  }
  // the app asks for the theme as soon as its page starts, before it is fully loaded,
  // and for the user's own picture when it does not have it yet
  window.addEventListener('message', function (e) {
    if (e.origin !== APP || e.source !== $('onbFrame').contentWindow || !e.data) return;
    if (e.data.type === 'td-portal-theme?') { ready = true; sendLook(true); }
    if (e.data.type === 'td-portal-theme-bg?') {
      var data = ownPicture();
      if (data) post({ type: 'td-portal-theme-bg', rev: mark(data), data: data });
    }
  });

  $('onbFrame').addEventListener('load', function () {
    $('onbState').textContent = '';
    if (submitted) { ready = true; sendLook(true); }
  });
  open();
})();
