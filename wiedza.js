/* Knowledge base: legal rules (portal_wiedza) and the acts watched in the ELI
   register (portal_prawo_akty). Read-only for the team; an admin confirms a rule
   after re-reading it against a changed act (prawo-monitor function). */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/prawo-monitor';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function dzu(eli) { var p = (eli || '').split('/'); return p.length === 3 ? 'Dz.U. ' + p[1] + ' poz. ' + p[2] : eli; }
  function link(eli) { return 'https://eli.gov.pl/eli/' + eli + '/ogl'; }
  var rules = [], acts = [], q = '';

  function render() {
    var admin = !!(window.PortalUser && window.PortalUser.admin);
    var list = rules.filter(function (r) { return !q || (r.temat + ' ' + r.tresc + ' ' + r.podstawa + ' ' + r.dzial).toLowerCase().indexOf(q) !== -1; });
    var html = '', dzial = '';
    list.forEach(function (r) {
      if (r.dzial !== dzial) { dzial = r.dzial; html += '<h2>' + esc(dzial) + '</h2>'; }
      html += '<div class="rule' + (r.do_sprawdzenia ? ' check' : '') + '"><h3>' + esc(r.temat) + '</h3><p>' + esc(r.tresc) + '</p><div class="meta">' +
        '<span><b>Podstawa:</b> ' + esc(r.podstawa) + '</span>' +
        (r.eli ? '<a href="' + link(r.eli) + '" target="_blank" rel="noopener">' + esc(dzu(r.eli)) + ' ↗</a>' : '') +
        (r.do_sprawdzenia
          ? '<span class="pill p-amber">ustawa zmieniona — do sprawdzenia</span>' + (admin ? '<button type="button" class="mini" data-ok="' + esc(r.id) + '">Sprawdzone, aktualne</button>' : '')
          : '<span class="pill p-ok">sprawdzono ' + pl(r.zweryfikowano) + '</span>') +
        '</div></div>';
    });
    $('rules').innerHTML = html || '<div class="empty">Brak zasad.</div>';
    $('acts').innerHTML = '<thead><tr><th>Akt</th><th>Publikacja</th><th>Tekst jednolity</th><th>Ostatnie sprawdzenie</th><th>Stan</th></tr></thead><tbody>' +
      acts.map(function (a) {
        return '<tr><td>' + esc(a.skrot) + '</td><td><a href="' + link(a.eli) + '" target="_blank" rel="noopener">' + esc(dzu(a.eli)) + '</a></td>' +
          '<td>' + (a.tekst_jednolity ? esc(dzu(a.tekst_jednolity)) : '—') + '</td><td>' + (a.checked_at ? new Date(a.checked_at).toLocaleString('pl-PL') : '—') + '</td>' +
          '<td>' + (a.zmiana_wykryta ? '<span class="pill p-red">zmiana ' + pl(a.zmiana_wykryta) + '</span>' + (admin ? ' <button type="button" class="mini" data-akt="' + esc(a.eli) + '">OK</button>' : '') : '<span class="pill p-ok">bez zmian</span>') + '</td></tr>';
      }).join('') + '</tbody>';
  }
  async function call(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
  }
  document.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-ok],[data-akt]'); if (!b) return;
    b.disabled = true;
    try {
      if (b.hasAttribute('data-ok')) await call({ action: 'potwierdz', id: b.getAttribute('data-ok') });
      else await call({ action: 'potwierdz_akt', eli: b.getAttribute('data-akt') });
      load();
    } catch (err) { alert(err.message); b.disabled = false; }
  });
  $('q').addEventListener('input', function (e) { q = e.target.value.toLowerCase().trim(); render(); });

  async function load() {
    if (!window.sb) return;
    var r = await window.sb.from('portal_wiedza').select('*').order('kolejnosc');
    var a = await window.sb.from('portal_prawo_akty').select('*').order('skrot');
    if (r.error) { $('rules').innerHTML = '<div class="empty">Błąd: ' + esc(r.error.message) + '</div>'; return; }
    rules = r.data || []; acts = a.data || [];
    render();
  }
  document.addEventListener('portal:access', render);
  load();
})();
