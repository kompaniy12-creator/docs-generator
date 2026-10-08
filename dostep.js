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
  var SECTIONS = [['rejestracja', 'Rejestracja spółki'], ['biezaca', 'Bieżąca działalność'], ['kadry', 'Kadry'], ['legalizacja', 'Legalizacja pobytu'], ['onboarding', 'Księgowość']];

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
        '</div>' +
        (u.admin ? '<div class="secs"><span>Sekcje: wszystkie (administrator)</span></div>'
          : '<div class="secs"><span>Sekcje:</span>' + SECTIONS.map(function (s) {
              var on = !u.sections || u.sections.indexOf(s[0]) !== -1;
              return '<label><input type="checkbox" data-sec="' + s[0] + '"' + (on ? ' checked' : '') + ' /> ' + s[1] + '</label>';
            }).join('') + '</div>');
      row.querySelectorAll('[data-sec]').forEach(function (cb) {
        cb.addEventListener('change', async function () {
          var secs = Array.prototype.filter.call(row.querySelectorAll('[data-sec]'), function (x) { return x.checked; })
            .map(function (x) { return x.getAttribute('data-sec'); });
          try {
            await call({ action: 'sections', id: u.id, sections: secs });
            u.sections = secs;
            show('Zapisano sekcje: ' + u.email + ' — ' + (secs.length ? secs.join(', ') : 'brak') + '.', 'success');
          } catch (e) { show('Błąd: ' + e.message, 'error'); cb.checked = !cb.checked; }
        });
      });
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
      var secs = Array.prototype.filter.call(document.querySelectorAll('#addSecs input'), function (x) { return x.checked; })
        .map(function (x) { return x.value; });
      var out = await call({ action: 'add', email: email.value, password: password.value, sections: secs });
      show(out.existed
        ? 'Konto ' + email.value + ' już istniało — nadano dostęp do portalu (hasło bez zmian).'
        : 'Utworzono konto ' + email.value + ' z dostępem do portalu. Przekaż hasło tej osobie.', 'success');
      email.value = ''; password.value = '';
      await load();
    } catch (e) { show('Błąd: ' + e.message, 'error'); }
    finally { btn.disabled = false; }
  });

  // ---------------- Telegram notifications ----------------
  var TG_FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/powiadom';
  var $id = function (id) { return document.getElementById(id); };
  var tgChats = [];
  async function tgCall(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(TG_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
    return out;
  }
  function tgSay(msg) { $id('tgStatus').textContent = msg || ''; }
  function tgRender() {
    $id('tgSaved').innerHTML = tgChats.length
      ? 'Powiadomienia idą na: ' + tgChats.map(function (c) { return '<strong>' + esc(c.name || c.id) + '</strong> (' + esc(c.id) + ')'; }).join(', ')
      : '<span style="color:#b45309">Powiadomienia są wyłączone — nie wskazano czatu.</span>';
  }
  async function tgLoad() {
    try {
      var st = await tgCall({ action: 'status' });
      $id('tgBot').textContent = st.bot ? '@' + st.bot : '(nieznany)';
      tgChats = st.chats || [];
      $id('tgFind').disabled = !st.can_list;
      if (!st.can_list) $id('tgFind').title = 'Ten bot odbiera wiadomości przez webhook — wpisz ID czatu ręcznie.';
      tgRender();
    } catch (e) { tgSay(e.message); }
  }
  $id('tgFind').addEventListener('click', async function () {
    tgSay('Szukam czatów, które ostatnio pisały do bota…');
    try {
      var out = await tgCall({ action: 'chats' });
      if (out.error) return tgSay(out.error);
      var box = $id('tgFound'); box.innerHTML = '';
      (out.chats || []).forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'btn-soft'; b.textContent = c.name + ' (' + c.id + ')';
        b.addEventListener('click', function () { $id('tgChat').value = c.id; $id('tgChat').dataset.name = c.name; });
        box.appendChild(b);
      });
      tgSay((out.chats || []).length ? 'Kliknij czat, a potem „Zapisz czat”.' : 'Brak czatów — napisz najpierw do bota (albo dodaj go do grupy i napisz tam cokolwiek), potem spróbuj ponownie.');
    } catch (e) { tgSay(e.message); }
  });
  async function tgSaveList(list, okMsg) {
    try { var out = await tgCall({ action: 'save', chats: list }); tgChats = out.chats || []; tgRender(); tgSay(okMsg); }
    catch (e) { tgSay(e.message); }
  }
  $id('tgSave').addEventListener('click', function () {
    var id = $id('tgChat').value.trim();
    if (!/^-?\d{4,20}$/.test(id)) return tgSay('Wpisz ID czatu — same cyfry, dla grupy z minusem na początku.');
    tgSaveList([{ id: id, name: $id('tgChat').dataset.name || '' }], 'Zapisano. Wyślij wiadomość testową, aby sprawdzić.');
  });
  $id('tgOff').addEventListener('click', function () {
    if (confirm('Wyłączyć powiadomienia Telegram?')) tgSaveList([], 'Powiadomienia wyłączone.');
  });
  $id('tgTest').addEventListener('click', async function () {
    tgSay('Wysyłam…');
    try {
      var out = await tgCall({ action: 'test' });
      tgSay(out.error ? out.error : out.ok ? '✓ Wiadomość testowa wysłana — sprawdź Telegram.' : 'Nie udało się wysłać — sprawdź, czy bot jest w tym czacie i czy ID jest poprawne.');
    } catch (e) { tgSay(e.message); }
  });
  tgLoad();

  load();
})();
