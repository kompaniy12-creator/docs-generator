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
  var users = [];
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
      users = out.users || [];
      render(users);
      histLoad();
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
          (self || u.admin ? '' : '<button class="btn-soft" data-act="upr">Uprawnienia szczegółowe</button>') +
        '</div>' +
        // the switch-off list: how many functions are off, or that the stored list is broken (= everything closed)
        (u.admin ? '' : u.wylaczone_blad ? '<div class="secs"><span class="pill p-red">lista wyłączonych funkcji jest uszkodzona — konto ma wszystko zablokowane; otwórz „Uprawnienia szczegółowe” i zapisz</span></div>'
          : (u.wylaczone || []).length ? '<div class="secs"><span class="pill p-amber">wyłączone funkcje: ' + u.wylaczone.length + '</span></div>' : '') +
        (u.admin ? '<div class="secs"><span>Sekcje: wszystkie (administrator) · Administrator — bez ograniczeń</span></div>'
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
        b.addEventListener('click', function () { if (b.getAttribute('data-act') === 'upr') uprOpen(u); else act(u, b.getAttribute('data-act'), b); });
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

  // ---------------- Uprawnienia szczegółowe ----------------
  // The tree of uprawnienia.js for one person: ticked = switched on. A module that is one section of the portal
  // writes portal_sections, everything else goes to the switch-off list (portal_wylaczone). One save.
  var U = window.Uprawnienia || null;
  var upr = null; // { u, sekcje: string[] | null (= all), wyl: string[], szablon: string | null }
  var PILL = { serwer: 'p-ok', serwer_czesc: 'p-ok', strona: 'p-navy', strona_oczekuje: 'p-amber', oczekuje: 'p-grey', admin: 'p-grey' };
  var el = function (id) { return document.getElementById(id); };
  function sekNazwa(s) { var x = SECTIONS.filter(function (y) { return y[0] === s; })[0]; return x ? x[1] : s; }
  function maSek(s) { return !upr.sekcje || upr.sekcje.indexOf(s) !== -1; }
  function setSek(s, on) {
    var all = SECTIONS.map(function (x) { return x[0]; });
    upr.sekcje = all.filter(function (x) { return x === s ? on : maSek(x); });
    upr.szablon = null;
  }
  function uprMeta() { return { portal: true, portal_sections: upr.sekcje, portal_wylaczone: upr.wyl }; }
  // 'off' = the key or an ancestor is on the list, 'czesc' = something under it is, 'on' = nothing
  function stan(k) {
    if (U.naLiscie(upr.wyl, k)) return 'off';
    return upr.wyl.some(function (x) { return x.indexOf(k + '.') === 0; }) ? 'czesc' : 'on';
  }
  function przelacz(k, on) {
    upr.wyl = upr.wyl.filter(function (x) { return x !== k && x.indexOf(k + '.') !== 0; });
    if (!on) upr.wyl.push(k);
    upr.wyl = U.normalizuj(upr.wyl).lista || [];
    upr.szablon = null;
  }
  function brakSekcji(n) {
    var potrzebne = n.sekcjeWsz || (Array.isArray(n.sekcja) ? n.sekcja : n.sekcja ? [n.sekcja] : []);
    return potrzebne.map(sekNazwa).join(n.sekcjeWsz ? ' i ' : ' lub ');
  }
  function pasuje(n, q) {
    if (!q) return true;
    if (U.etykieta(n.klucz).toLowerCase().indexOf(q) !== -1) return true;
    return n.dzieci.some(function (d) { return pasuje(d, q); });
  }
  function wiersz(n, glebia, q) {
    if (!pasuje(n, q)) return '';
    var sekcja = U.maSekcje(uprMeta(), n.klucz), rodzicOff = n.rodzic && U.naLiscie(upr.wyl, n.rodzic);
    var st = stan(n.klucz), pill = '', uwaga = '', dis = false, checked = st !== 'off';
    var attr = 'data-upr="' + esc(n.klucz) + '"';
    if (n.tylkoAdmin) { dis = true; checked = false; pill = '<span class="pill p-grey">tylko administrator</span>'; }
    else if (n.modulSekcja) {
      // a module that is one section: the box is the section itself
      attr = 'data-sek="' + esc(n.modulSekcja) + '"'; checked = maSek(n.modulSekcja);
      pill = '<span class="pill p-navy">sekcja portalu</span>';
      if (checked && st === 'off') uwaga = 'Sekcja jest włączona, ale cały moduł jest na liście wyłączonych funkcji.';
    } else if (!sekcja) { dis = true; checked = false; pill = '<span class="pill p-grey">brak sekcji: ' + esc(brakSekcji(n)) + '</span>'; }
    else {
      if (rodzicOff) { dis = true; uwaga = 'Wyłączone razem z: ' + U.KLUCZE[n.rodzic].nazwa + '.'; }
      if (U.STATUSY[n.status]) pill = '<span class="pill ' + (PILL[n.status] || 'p-grey') + '">' + esc(U.STATUSY[n.status]) + '</span>';
      // a partial block says what exactly is blocked and what stays reachable
      if (!uwaga && n.status === 'serwer_czesc' && n.powod) uwaga = n.powod;
    }
    return '<div class="upr-w d' + glebia + (dis ? ' off' : '') + '"><label><input type="checkbox" ' + attr + (checked ? ' checked' : '') + (dis ? ' disabled' : '') +
        (st === 'czesc' && checked && !dis ? ' data-czesc="1"' : '') + ' /><span>' + esc(n.nazwa) + '</span></label>' + pill +
        (uwaga ? '<small>' + esc(uwaga) + '</small>' : '') + '</div>' +
      n.dzieci.map(function (d) { return wiersz(d, Math.min(glebia + 1, 2), q); }).join('');
  }
  function uprSuma() {
    var m = uprMeta(), linie = [];
    SECTIONS.forEach(function (s) { if (!maSek(s[0])) linie.push('otworzyć modułu „' + s[1] + '” (brak sekcji)'); });
    upr.wyl.forEach(function (k) {
      var n = U.KLUCZE[k];
      if (!n) return;
      var bezSekcji = !U.maSekcje(m, k), dodatek = bezSekcji ? ' — i tak niedostępne bez sekcji' : n.dzieci.length ? ' — razem ze wszystkim, co pod spodem' : '';
      // a single function whose block is still being prepared: say so next to it
      if (!bezSekcji && n.status === 'oczekuje') dodatek += ' (jeszcze nie blokuje — w przygotowaniu)';
      linie.push('używać: ' + U.etykieta(k) + dodatek);
    });
    el('uprSuma').innerHTML = '<strong>Ta osoba nie może:</strong>' + (linie.length
      ? '<ul>' + linie.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>'
      : ' <span>— brak ograniczeń: ma wszystkie sekcje i żadna funkcja nie jest wyłączona.</span>') +
      (upr.u.wylaczone_blad ? '<p class="hint">Zapisana lista tego konta jest uszkodzona, dlatego konto ma dziś wszystko zablokowane. Zapisanie tego formularza ją naprawi.</p>' : '');
  }
  function uprRender() {
    var q = el('uprSzukaj').value.trim().toLowerCase();
    el('uprTitle').textContent = 'Uprawnienia szczegółowe — ' + upr.u.email;
    el('uprSekcje').innerHTML = '<span>Sekcje:</span>' + SECTIONS.map(function (s) {
      return '<label><input type="checkbox" data-sek="' + s[0] + '"' + (maSek(s[0]) ? ' checked' : '') + ' /> ' + s[1] + '</label>';
    }).join('');
    var html = U.DRZEWO.map(function (n) { return wiersz(n, 0, q); }).join('');
    el('uprDrzewo').innerHTML = html || '<div class="empty">Nic nie pasuje do „' + esc(q) + '”.</div>';
    Array.prototype.forEach.call(el('uprDrzewo').querySelectorAll('[data-czesc]'), function (c) { c.indeterminate = true; });
    uprSuma();
  }
  function uprOpen(u) {
    if (!U) return show('Nie udało się wczytać katalogu uprawnień (uprawnienia.js) — odśwież stronę.', 'error');
    upr = { u: u, sekcje: u.sections ? u.sections.slice() : null, wyl: (U.normalizuj((u.wylaczone || []).filter(U.znany)).lista || []).slice(), szablon: null };
    el('uprSzukaj').value = '';
    el('uprSzablon').innerHTML = '<option value="">— wybierz, aby ustawić —</option>' + U.SZABLONY.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.nazwa) + '</option>'; }).join('');
    el('uprKopia').innerHTML = '<option value="">— wybierz osobę —</option>' + users.filter(function (x) { return !x.admin && x.id !== u.id; })
      .map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.email) + '</option>'; }).join('');
    el('uprLegenda').textContent = 'Oznaczenia: „blokada na serwerze” — funkcja odmawia tej osobie także poza stronami portalu; „częściowa” — serwer odmawia, ale część tych danych jest dostępna inną drogą (opis pod pozycją); ' +
      '„ukrycie strony” — strona znika z menu i nie otwiera się; nie ma osobnej blokady serwera, bo strona nie ma własnych danych albo dzieli je z innymi stronami. Przyciski wyłączonych funkcji znikają też ze stron tej osoby.';
    el('uprBox').hidden = false;
    uprRender();
    el('uprBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function uprClose() { upr = null; el('uprBox').hidden = true; }
  if (el('uprBox')) {
    el('uprSzukaj').addEventListener('input', function () { if (upr) uprRender(); });
    el('uprBox').addEventListener('change', function (ev) {
      var t = ev.target;
      if (!upr || !t || !t.getAttribute) return;
      if (t.getAttribute('data-sek')) { setSek(t.getAttribute('data-sek'), t.checked); return uprRender(); }
      if (t.getAttribute('data-upr')) { przelacz(t.getAttribute('data-upr'), t.checked); return uprRender(); }
      if (t.id === 'uprSzablon' && t.value) {
        var s = U.SZABLONY.filter(function (x) { return x.id === t.value; })[0];
        if (s) { upr.sekcje = s.sekcje.slice(); upr.wyl = s.wylaczone.slice(); upr.szablon = s.id; uprRender(); show('Ustawiono szablon „' + s.nazwa + '” — ' + s.opis + ' Sprawdź i zapisz.', 'success'); }
      }
      if (t.id === 'uprKopia' && t.value) {
        var z = users.filter(function (x) { return x.id === t.value; })[0];
        if (z) { upr.sekcje = z.sections ? z.sections.slice() : null; upr.wyl = U.normalizuj((z.wylaczone || []).filter(U.znany)).lista || []; upr.szablon = null; uprRender(); show('Skopiowano uprawnienia z: ' + z.email + '. Sprawdź i zapisz.', 'success'); }
        t.value = '';
      }
    });
    el('uprAnuluj').addEventListener('click', uprClose);
    el('uprWszystko').addEventListener('click', function () { if (!upr) return; upr.wyl = []; upr.szablon = null; uprRender(); });
    el('uprZapisz').addEventListener('click', async function () {
      if (!upr) return;
      var u = upr.u, btn = this;
      var sekBylo = JSON.stringify(u.sections || null), sekJest = JSON.stringify(upr.sekcje || null);
      var body = { action: 'uprawnienia', id: u.id, wylaczone: upr.wyl };
      if (sekBylo !== sekJest) body.sections = upr.sekcje;
      if (upr.szablon) body.szablon = upr.szablon;
      if (!confirm('Zapisać uprawnienia: ' + u.email + '?\nWyłączone funkcje: ' + upr.wyl.length + '. Ta osoba zostanie wylogowana.')) return;
      btn.disabled = true;
      try {
        var out = await call(body);
        show(out.bez_zmian ? 'Bez zmian: ' + u.email + '.' : 'Zapisano uprawnienia: ' + u.email + ' — wyłączone funkcje: ' + (out.wylaczone || []).length + '. Ta osoba została wylogowana.', 'success');
        uprClose();
        await load();
      } catch (e) { show('Błąd: ' + e.message, 'error'); }
      finally { btn.disabled = false; }
    });
  }

  // ---------------- history of access changes ----------------
  var histAll = false;
  function histOpis(z) {
    z = z || {};
    var c = [], nazwy = function (l) { return (Array.isArray(l) ? l : []).map(function (k) { return U ? U.etykieta(k) : k; }).join('; '); };
    if (z.portal === true) c.push('nadano dostęp do portalu' + (z.konto ? ' (konto ' + z.konto + ')' : ''));
    if (z.portal === false) c.push('odebrano dostęp do portalu');
    if ('administrator' in z) c.push(z.administrator ? 'nadano uprawnienia administratora' : 'odebrano uprawnienia administratora');
    if ('sekcje' in z) c.push('sekcje: ' + (Array.isArray(z.sekcje) ? (z.sekcje.map(sekNazwa).join(', ') || 'brak') : 'wszystkie'));
    if ((z.wylaczone_dodano || []).length) c.push('wyłączono: ' + nazwy(z.wylaczone_dodano));
    if ((z.wylaczone_usunieto || []).length) c.push('włączono z powrotem: ' + nazwy(z.wylaczone_usunieto));
    if (z.szablon) c.push('szablon: ' + z.szablon);
    if (z.naprawiono_liste) c.push('naprawiono uszkodzoną listę');
    return c.join(' · ') || 'zmiana dostępu';
  }
  function histRender(rows) {
    var box = el('histList');
    if (!box) return;
    if (!rows.length) { box.innerHTML = '<div class="empty">Brak zapisanych zmian.</div>'; return; }
    var widok = histAll ? rows : rows.slice(0, 20);
    box.innerHTML = widok.map(function (r) {
      return '<div class="user"><div class="who"><strong>' + esc(r.email) + '</strong><small>' + esc(fmt(r.at)) + ' · zmienił(a): ' + esc(r.kto || '—') + '</small></div>' +
        '<div class="secs"><span>' + esc(histOpis(r.zmiany)) + '</span></div></div>';
    }).join('') + (rows.length > widok.length ? '<div style="margin-top:10px"><button type="button" class="btn-soft" id="histWiecej">Pokaż wszystkie (' + rows.length + ')</button></div>' : '');
    var w = el('histWiecej');
    if (w) w.addEventListener('click', function () { histAll = true; histRender(rows); });
  }
  async function histLoad() {
    if (!el('histList')) return;
    try { histRender((await call({ action: 'historia_dostepu' })).historia || []); }
    catch (e) { el('histList').innerHTML = '<div class="empty">Nie udało się wczytać historii: ' + esc(e.message) + '</div>'; }
  }

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
