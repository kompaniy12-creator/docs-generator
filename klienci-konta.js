/* Client accounts for the client profile (administrators only): who may sign in at /klient/
   and for which firms. Goes through the `klient` edge function, which checks the admin flag. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/klient';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('kk')) return;
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(iso) { return iso ? new Date(iso).toLocaleString('pl-PL') : 'jeszcze nie'; }
  function status(t) { $('kkStatus').textContent = t || ''; }
  var konta = [];

  async function call(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
    return out;
  }
  function render() {
    $('kkList').innerHTML = konta.length ? konta.map(function (k) {
      return '<div class="user" data-id="' + esc(k.id) + '" style="padding:12px 0;border-top:1px solid #eef1f6">' +
        '<div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;align-items:flex-start"><div>' +
          '<strong>' + esc(k.email) + '</strong>' + (k.aktywny ? '' : ' <span style="color:#b91c1c;font-weight:600">· wyłączone</span>') +
          '<div class="hint">' + k.firmy.map(function (f) { return esc(f.nazwa) + ' (NIP ' + esc(f.nip) + ')'; }).join(' · ') + '</div>' +
          '<div class="hint">ostatnie logowanie: ' + fmt(k.last_login) + '</div></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
          (k.aktywny ? '<button type="button" class="btn-soft" data-kk="mail">Wyślij zaproszenie e-mailem</button><button type="button" class="btn-soft" data-kk="link">Kopiuj link logowania</button>' : '') +
          '<button type="button" class="btn-soft" data-kk="toggle">' + (k.aktywny ? 'Wyłącz' : 'Włącz') + '</button>' +
          '<button type="button" class="btn-danger" data-kk="del">Usuń</button></div></div></div>';
    }).join('') : '<div class="hint">Nie ma jeszcze kont klientów.</div>';
  }
  async function load() {
    try { konta = (await call({ action: 'konta' })).konta || []; render(); }
    catch (e) { $('kkList').innerHTML = '<div class="hint">' + esc(e.message) + '</div>'; }
  }
  $('kkAdd').addEventListener('submit', async function (e) {
    e.preventDefault(); status('');
    try {
      await call({ action: 'konto_zapisz', email: $('kkEmail').value.trim(), nip: $('kkNip').value });
      $('kkEmail').value = ''; $('kkNip').value = '';
      status('Konto dodane. Wyślij klientowi zaproszenie albo skopiuj link logowania.');
      load();
    } catch (err) { status(err.message); }
  });
  $('kkList').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-kk]'); if (!b) return;
    var id = b.closest('[data-id]').getAttribute('data-id');
    var k = konta.filter(function (x) { return x.id === id; })[0];
    var act = b.getAttribute('data-kk');
    status(''); b.disabled = true;
    try {
      if (act === 'mail') {
        if (!confirm('Wysłać zaproszenie z linkiem logowania na adres ' + k.email + '?')) { b.disabled = false; return; }
        var out = await call({ action: 'zaproszenie', id: id, wyslij: true });
        status(out.error || ('Zaproszenie wysłane na ' + out.wyslano + '.'));
      } else if (act === 'link') {
        var l = await call({ action: 'zaproszenie', id: id, wyslij: false });
        try { await navigator.clipboard.writeText(l.link); status('Link skopiowany — jednorazowy, ważny ' + l.wazny_min + ' minut. Przekaż go tylko tej osobie.'); }
        catch (e2) { prompt('Link logowania (jednorazowy, ' + l.wazny_min + ' min):', l.link); }
      } else if (act === 'toggle') {
        await call({ action: 'konto_zapisz', email: k.email, nip: k.nip, nazwa: k.nazwa, aktywny: !k.aktywny });
        await load();
      } else if (act === 'del') {
        if (!confirm('Usunąć konto klienta ' + k.email + '? Straci dostęp do profilu.')) { b.disabled = false; return; }
        await call({ action: 'konto_usun', id: id });
        await load();
      }
    } catch (err) { status(err.message); }
    b.disabled = false;
  });
  document.addEventListener('portal:access', load);
  if (window.sb) load();
})();
