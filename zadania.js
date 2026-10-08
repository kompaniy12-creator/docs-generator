/* Zadania: tasks of the team. Rows live in portal_zadania (RLS: portal users);
   the zadania edge function lists the team, sends Telegram pushes and keeps settings. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/zadania';
  var T = 'portal_zadania';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function daysLeft(iso) { var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(iso + 'T00:00:00') - t) / 86400000); }
  function who(email) { return email === 'system' ? 'portal' : (email || '').split('@')[0]; }

  var me = '', admin = false, team = [], rows = [], open = {};
  var tab = new URLSearchParams(location.search).get('w') || 'moje';
  var TABS = [
    ['moje', 'Moje', function (z) { return live(z) && z.assignee === me; }],
    ['zlecone', 'Zlecone przeze mnie', function (z) { return live(z) && z.created_by === me && z.assignee !== me; }],
    ['wszystkie', 'Wszystkie', live],
    ['po', 'Po terminie', function (z) { return live(z) && z.termin && daysLeft(z.termin) < 0; }],
    ['zrobione', 'Zrobione', function (z) { return z.status === 'zrobione'; }],
  ];
  function live(z) { return z.status === 'nowe' || z.status === 'w_toku'; }

  async function call(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
    return out;
  }
  function push(id, event) { call({ action: 'notify', id: id, event: event }).catch(function () {}); }

  function duePill(z) {
    if (z.status === 'zrobione') return '<span class="pill p-ok">zrobione ' + pl(z.done_at) + '</span>';
    if (!z.termin) return z.pilne ? '<span class="pill p-amber">pilne</span>' : '<span class="pill p-grey">bez terminu</span>';
    var d = daysLeft(z.termin);
    var txt = d < 0 ? 'po terminie ' + (-d) + ' dni' : d === 0 ? 'dziś' : d === 1 ? 'jutro' : pl(z.termin);
    return '<span class="pill ' + (d < 0 ? 'p-red' : d <= 1 ? 'p-amber' : 'p-grey') + '">' + txt + '</span>' + (z.pilne ? ' <span class="pill p-amber">pilne</span>' : '');
  }
  function render() {
    $('tabs').innerHTML = TABS.map(function (t) {
      var n = rows.filter(t[2]).length;
      return '<button type="button" data-t="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + (t[0] !== 'zrobione' ? '<b>' + n + '</b>' : '') + '</button>';
    }).join('');
    var f = (TABS.filter(function (t) { return t[0] === tab; })[0] || TABS[0])[2];
    var list = rows.filter(f).sort(function (a, b) {
      if (tab === 'zrobione') return (b.done_at || '').localeCompare(a.done_at || '');
      return (a.termin || '9999').localeCompare(b.termin || '9999') || (b.pilne - a.pilne);
    }).slice(0, 200);
    if (!list.length) { $('list').innerHTML = '<div class="empty">' + (tab === 'moje' ? 'Nie masz otwartych zadań.' : 'Brak zadań w tym widoku.') + '</div>'; return; }
    $('list').innerHTML = list.map(function (z) {
      var late = live(z) && z.termin && daysLeft(z.termin) < 0;
      var mine = z.created_by === me || admin;
      return '<div class="task' + (z.status === 'zrobione' ? ' done' : late ? ' late' : z.pilne ? ' urgent' : '') + (open[z.id] ? ' open' : '') + '" data-id="' + z.id + '">' +
        '<div class="thead"><div class="ttl"><strong>' + esc(z.tytul) + '</strong><small>dla: <b>' + esc(who(z.assignee)) + '</b> · od: ' + esc(who(z.created_by)) +
          (z.zrodlo === 'system' ? ' · <span class="pill p-navy">z systemu</span>' : '') + (z.status === 'w_toku' ? ' · <span class="pill p-navy">w toku</span>' : '') +
          (z.eskalacja ? ' · <span class="pill p-red">zgłoszone właścicielowi</span>' : '') + ((z.komentarze || []).length ? ' · 💬 ' + z.komentarze.length : '') + '</small></div>' +
          '<div>' + duePill(z) + '</div>' +
          '<div class="acts">' + (live(z)
            ? (z.status === 'nowe' ? '<button type="button" class="mini" data-set="w_toku">W toku</button>' : '') + '<button type="button" class="mini ok" data-set="zrobione">✔ Zrobione</button>'
            : '<button type="button" class="mini" data-set="nowe">Przywróć</button>') + '</div></div>' +
        '<div class="tbody">' + (z.opis ? '<p>' + esc(z.opis) + '</p>' : '') +
          (z.link ? '<p><a href="' + esc(z.link) + '">Otwórz w portalu →</a></p>' : '') +
          (z.komentarze || []).map(function (c) { return '<div class="cm"><small>' + esc(who(c.by)) + ' · ' + new Date(c.at).toLocaleString('pl-PL') + '</small><br>' + esc(c.text) + '</div>'; }).join('') +
          '<div class="cmadd"><input type="text" maxlength="1000" placeholder="Komentarz…" data-cm /><button type="button" class="mini" data-cmgo>Dodaj</button>' +
          (mine && z.zrodlo !== 'system' ? '<button type="button" class="mini del" data-del>Usuń</button>' : '') + '</div></div></div>';
    }).join('');
  }

  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-t]'); if (!b) return; tab = b.getAttribute('data-t'); render(); });
  $('list').addEventListener('click', async function (e) {
    var card = e.target.closest('.task'); if (!card) return;
    var id = card.getAttribute('data-id'), z = rows.filter(function (r) { return r.id === id; })[0];
    var set = e.target.closest('[data-set]');
    if (set) {
      set.disabled = true;
      var st = set.getAttribute('data-set');
      var u = await window.sb.from(T).update({ status: st }).eq('id', id).select().single();
      if (u.error) { alert('Błąd: ' + u.error.message); set.disabled = false; return; }
      Object.assign(z, u.data);
      if (st === 'zrobione') push(id, 'done');
      render(); badge();
      return;
    }
    if (e.target.closest('[data-del]')) {
      if (!confirm('Usunąć zadanie „' + z.tytul + '”?')) return;
      var d = await window.sb.from(T).delete().eq('id', id);
      if (d.error) return alert('Błąd: ' + d.error.message);
      rows = rows.filter(function (r) { return r.id !== id; }); render(); badge();
      return;
    }
    if (e.target.closest('[data-cmgo]')) {
      var inp = card.querySelector('[data-cm]'), text = inp.value.trim();
      if (!text) return;
      var cur = await window.sb.from(T).select('komentarze').eq('id', id).single();
      var list = ((cur.data && cur.data.komentarze) || []).concat([{ at: new Date().toISOString(), by: me, text: text }]);
      var c = await window.sb.from(T).update({ komentarze: list }).eq('id', id);
      if (c.error) return alert('Błąd: ' + c.error.message);
      z.komentarze = list; push(id, 'comment'); render();
      return;
    }
    if (e.target.closest('.thead') && !e.target.closest('button')) { open[id] = !open[id]; card.classList.toggle('open'); }
  });

  $('add').addEventListener('submit', async function (e) {
    e.preventDefault();
    var title = $('nTitle').value.trim(); if (!title) return;
    $('nGo').disabled = true; $('nMsg').textContent = '';
    var ins = await window.sb.from(T).insert({
      created_by: me, assignee: $('nWho').value, tytul: title, opis: $('nDesc').value.trim() || null,
      termin: $('nDue').value || null, pilne: $('nUrgent').checked,
    }).select().single();
    $('nGo').disabled = false;
    if (ins.error) { $('nMsg').textContent = 'Błąd: ' + ins.error.message; return; }
    rows.unshift(ins.data);
    var to = team.filter(function (t) { return t.email === ins.data.assignee; })[0];
    $('nMsg').textContent = ins.data.assignee === me ? 'Dodano.' : (to && to.telegram ? 'Dodano — powiadomienie wysłane w Telegramie.' : 'Dodano. Ta osoba nie ma jeszcze podpiętego Telegrama — zobaczy zadanie w portalu.');
    if (ins.data.assignee !== me) push(ins.data.id, 'new');
    $('nTitle').value = ''; $('nDesc').value = ''; $('nDue').value = ''; $('nUrgent').checked = false;
    tab = ins.data.assignee === me ? 'moje' : 'zlecone'; render(); badge();
  });

  function badge() { if (window.PortalShell && window.PortalShell.refreshTasks) window.PortalShell.refreshTasks(); }

  // ---------------- settings (admin) ----------------
  function renderSettings(s) {
    $('settings').hidden = false;
    $('setUsers').innerHTML = team.map(function (u) {
      return '<div class="set"><div>' + esc(u.email) + (u.admin ? ' <span class="pill p-navy">admin</span>' : '') + '</div>' +
        '<input type="text" inputmode="numeric" placeholder="ID czatu Telegram" data-tg="' + esc(u.email) + '" value="' + esc(s.telegram[u.email] || '') + '" />' +
        '<button type="button" class="mini" data-test="' + esc(u.email) + '">Test</button></div>';
    }).join('');
    $('setSzef').value = s.szef || '';
    $('setKadry').innerHTML = '<option value="">— pierwszy administrator —</option>' + team.map(function (u) { return '<option' + (u.email === s.kadry ? ' selected' : '') + '>' + esc(u.email) + '</option>'; }).join('');
  }
  async function saveSettings() {
    var tg = {};
    document.querySelectorAll('[data-tg]').forEach(function (i) { if (i.value.trim()) tg[i.getAttribute('data-tg')] = i.value.trim(); });
    var out = await call({ action: 'settings', telegram: tg, szef: $('setSzef').value.trim(), kadry: $('setKadry').value });
    team.forEach(function (u) { u.telegram = !!out.settings.telegram[u.email]; });
    return out;
  }
  $('setSave').addEventListener('click', async function () {
    this.disabled = true; $('setMsg').textContent = '';
    try { await saveSettings(); $('setMsg').textContent = 'Zapisano.'; warn(); } catch (e) { $('setMsg').textContent = e.message; }
    this.disabled = false;
  });
  $('settings').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-test]'); if (!b) return;
    b.disabled = true; $('setMsg').textContent = '';
    try {
      await saveSettings();
      var out = await call({ action: 'test', email: b.getAttribute('data-test') });
      $('setMsg').textContent = out.error || 'Wiadomość testowa wysłana.';
    } catch (err) { $('setMsg').textContent = err.message; }
    b.disabled = false;
  });
  function warn() {
    var mine = team.filter(function (t) { return t.email === me; })[0];
    $('warn').innerHTML = mine && !mine.telegram
      ? '<div class="warnbox">Twoje konto nie ma jeszcze podpiętego Telegrama — przypomnienia zobaczysz tylko w portalu.' + (admin ? ' Uzupełnij ID czatu w ustawieniach na dole strony.' : ' Poproś administratora o podpięcie.') + '</div>' : '';
  }

  async function load() {
    if (!window.sb) return;
    try {
      var t = await call({ action: 'team' });
      me = t.me; admin = t.admin; team = t.team;
      $('nWho').innerHTML = team.map(function (u) { return '<option value="' + esc(u.email) + '"' + (u.email === me ? ' selected' : '') + '>' + esc(who(u.email)) + (u.email === me ? ' (ja)' : '') + '</option>'; }).join('');
      warn();
      if (admin && t.settings) renderSettings(t.settings);
      if (location.hash === '#settings' && !$('settings').hidden) setTimeout(function () { $('settings').scrollIntoView({ behavior: 'smooth' }); }, 300);
    } catch (e) { $('list').innerHTML = '<div class="empty">Błąd: ' + esc(e.message) + '</div>'; return; }
    var r = await window.sb.from(T).select('*').order('created_at', { ascending: false }).limit(1000);
    if (r.error) { $('list').innerHTML = '<div class="empty">Błąd: ' + esc(r.error.message) + '</div>'; return; }
    rows = r.data || [];
    if (tab === 'moje' && !rows.some(TABS[0][2]) && rows.some(live)) tab = 'wszystkie';
    render();
  }
  load();
})();
