/* Onboarding klientów: the td-onboarding application shown inside the portal.
   The portal user is signed in there automatically: the page posts the user's portal
   session token to the app's /api/sso (a form post into the frame, so the token is never
   part of a URL); the app checks it with Supabase and opens its own session.
   onboarding.html?p=/clients/<id> opens a given screen of the app. */
(function () {
  'use strict';
  var APP = 'https://td-onboarding.vercel.app';
  var $ = function (id) { return document.getElementById(id); };

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
    f.submit();
    f.elements.token.value = '';
    $('onbState').textContent = '';
  }
  $('onbFrame').addEventListener('load', function () { $('onbState').textContent = ''; });
  open();
})();
