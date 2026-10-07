/* Portal access management (admins only). All changes go through the portal-admin
   edge function, which checks app_metadata.portal_admin server-side; this page
   holds no privileged key. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/portal-admin';
  var MIN_PASSWORD = 10;

  var statusEl = document.getElementById('status');
  var listEl = document.getElementById('list');
  var ui = document.getElementById('adminUi');
  var me = null;

  function show(msg, type) { statusEl.textContent = msg; statusEl.className = 'status ' + (type || ''); }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(iso) { return iso ? new Date(iso).toLocaleString('pl-PL') : 'nigdy'; }

  async function call(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) { var e = new Error(out.error || ('Błąd ' + res.status)); e.status = res.status; throw e; }
    return out;
  }

  async function load() {
    try {
      var out = await call({ action: 'list' });
      me = out.me;
      ui.hidden = false;
      render(out.users || []);
    } catch (e) {
      ui.hidden = true;
      show(e.status === 403 ? 'Ta strona jest dostępna tylko dla administratora portalu.' : 'Błąd: ' + e.message, 'error');
    }
  }

  function render(users) {
    if (!users.length) { listEl.innerHTML = '<div class="empty">Brak użytkowników.</div>'; return; }
    listEl.innerHTML = '';
    users.forEach(function (u) {
      var self = u.id === me;
      var row = document.createElement('div');
      row.className = 'user';
      row.innerHTML =
        '<div class="who"><strong>' + esc(u.email) + (u.admin ? '<span class="badge">administrator</span>' : '') +
          (self ? '<span class="badge" style="background:#dcfce7;color:#166534">to Ty</span>' : '') + '</strong>' +
          '<small>ostatnie logowanie: ' + esc(fmt(u.last_sign_in_at)) + '</small></div>' +
        '<div class="acts">' +
          '<button class="btn-soft" data-act="password">Zmień hasło</button>' +
          (self ? '' : '<button class="btn-soft" data-act="admin">' + (u.admin ? 'Odbierz admina' : 'Nadaj admina') + '</button>') +
          (self ? '' : '<button class="btn-del" data-act="revoke">Odbierz dostęp</button>') +
        '</div>';
      row.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () { act(u, b.getAttribute('data-act'), b); });
      });
      listEl.appendChild(row);
    });
  }

  async function act(u, action, btn) {
    var body = { action: action, id: u.id };
    if (action === 'revoke' && !confirm('Odebrać dostęp do portalu: ' + u.email + '?')) return;
    if (action === 'admin') {
      body.on = !u.admin;
      if (body.on && !confirm('Nadać uprawnienia administratora: ' + u.email + '? Ta osoba będzie mogła zarządzać dostępem.')) return;
    }
    if (action === 'password') {
      var p = prompt('Nowe hasło dla ' + u.email + ' (min. ' + MIN_PASSWORD + ' znaków):');
      if (p == null) return;
      if (p.length < MIN_PASSWORD) return show('Hasło musi mieć co najmniej ' + MIN_PASSWORD + ' znaków.', 'error');
      body.password = p;
    }
    btn.disabled = true;
    try {
      await call(body);
      show({ revoke: 'Odebrano dostęp: ', admin: 'Zmieniono uprawnienia: ', password: 'Zmieniono hasło: ' }[action] + u.email, 'success');
      await load();
    } catch (e) { show('Błąd: ' + e.message, 'error'); btn.disabled = false; }
  }

  document.getElementById('addForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var email = document.getElementById('email'), password = document.getElementById('password');
    var btn = this.querySelector('button');
    btn.disabled = true;
    try {
      var out = await call({ action: 'add', email: email.value, password: password.value });
      show(out.existed
        ? 'Konto ' + email.value + ' już istniało — nadano dostęp do portalu (hasło bez zmian).'
        : 'Utworzono konto ' + email.value + ' z dostępem do portalu. Przekaż hasło tej osobie.', 'success');
      email.value = ''; password.value = '';
      await load();
    } catch (e) { show('Błąd: ' + e.message, 'error'); }
    finally { btn.disabled = false; }
  });

  load();
})();
