/* Poczta: mail that reached the office mailboxes, described by the model, waiting for a person's decision.
   Everything is read and written through the poczta edge function (rows: poczta_wiadomosci);
   the push to the assignee of a new task goes through the existing zadania function. */
(function () {
  'use strict';
  var BASE = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function who(email) { return email === 'system' ? 'portal' : (email || '').split('@')[0]; }
  function when(iso) { return iso ? new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' kB'; }

  var KAT = {
    zatrudnienie_nowy_pracownik: 'nowy pracownik', zwolnienie: 'zwolnienie', dokument_pobytowy: 'dokument pobytowy', urlop_absencja: 'urlop / absencja',
    lista_plac_wynagrodzenia: 'płace', faktury_dokumenty_ksiegowe: 'faktury / dokumenty', podatki_zus: 'podatki / ZUS', urzad: 'pismo z urzędu',
    pytanie_klienta: 'pytanie klienta', reklamacja_pilne: 'reklamacja / pilne', spam_newsletter: 'spam / newsletter', automat: 'automat', wlasna: 'z biura', inne: 'inne',
  };
  var TRYB = { wylaczona: 'wyłączona', podglad: 'podgląd — propozycje, zadania tworzy pracownik', auto: 'automatyczny — zadania dla znanych klientów' };
  var me = '', admin = false, skrzynka = '', skrzynki = [], zespol = [], rows = [], zadania = {}, open = {}, st = null;
  var want = new URLSearchParams(location.search).get('w') || '';

  async function call(fn, body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(BASE + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
    return out;
  }
  function hasTask(r) { var z = r.zadanie_id && zadania[r.zadanie_id]; return z || null; }
  function decyzja(r) { return r.status === 'nowa' && r.wymaga !== false; }

  function statePill(r) {
    var z = hasTask(r);
    if (z) return '<span class="pill ' + (z.status === 'zrobione' ? 'p-ok' : 'p-navy') + '">zadanie: ' + (z.status === 'zrobione' ? 'zrobione' : z.status === 'anulowane' ? 'anulowane' : esc(who(z.assignee))) + '</span>';
    if (r.status === 'zadanie') return '<span class="pill p-grey">zadanie usunięte</span>';
    if (r.status === 'bez_dzialania') return '<span class="pill p-grey">bez działania' + (r.sprawdzil ? '' : ' (automat)') + '</span>';
    if (r.status === 'pominieta') return '<span class="pill p-grey">pominięta</span>';
    if (r.status === 'blad') return '<span class="pill p-red">błąd analizy</span>';
    return r.ai ? '<span class="pill p-amber">do decyzji</span>' : '<span class="pill p-grey">bez analizy</span>';
  }
  function visible() {
    var stan = $('fStan').value, kat = $('fKat').value, q = $('fKlient').value.trim().toLowerCase(), nikt = $('fNikt').checked;
    return rows.filter(function (r) {
      if (stan === 'decyzja' ? !decyzja(r) : stan && r.status !== stan) return false;
      if (kat && r.kategoria !== kat) return false;
      if (nikt && r.assignee) return false;
      if (q && [r.klient_nazwa, r.klient_nip, r.od_nazwa, r.od_adres, r.temat].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function card(r) {
    var a = r.ai || {}, p = a.proponowane_zadanie || null, z = hasTask(r), can = !z;
    var att = (r.zalaczniki || []).map(function (x) { return esc(x.nazwa) + ' (' + kb(x.rozmiar) + ')'; }).join(', ');
    var flags = r.flagi || {};
    var people = '<option value="">— wybierz —</option>' + zespol.map(function (e) { return '<option value="' + esc(e) + '"' + (e === r.assignee ? ' selected' : '') + '>' + esc(who(e)) + (e === me ? ' (ja)' : '') + '</option>'; }).join('');
    return '<div class="task' + (r.pilnosc === 'wysoka' && decyzja(r) ? ' urgent' : '') + (decyzja(r) || r.status === 'blad' ? '' : ' done') + (open[r.id] ? ' open' : '') + '" data-id="' + esc(r.id) + '">' +
      '<div class="thead"><div class="ttl"><strong>' + esc(r.temat || '(bez tematu)') + '</strong>' +
        '<small>' + esc(r.od_nazwa || '') + ' &lt;' + esc(r.od_adres || 'nieznany') + '&gt; · ' + esc(when(r.data || r.created_at)) +
          (r.klient_nazwa ? ' · klient: <b>' + esc(r.klient_nazwa) + '</b>' : ' · klient nierozpoznany') + (r.assignee ? ' · dla: <b>' + esc(who(r.assignee)) + '</b>' : ' · bez przypisania') + '</small>' +
        (a.streszczenie ? '<p>' + esc(a.streszczenie) + '</p>' : r.powod ? '<p class="sub">' + esc(r.powod) + '</p>' : '') + '</div>' +
        '<div class="pills">' + (r.kategoria ? '<span class="pill p-navy">' + esc(KAT[r.kategoria] || r.kategoria) + '</span>' : '') +
          (r.pilnosc === 'wysoka' ? '<span class="pill p-red">pilne</span>' : '') + (flags.podejrzany ? '<span class="pill p-red">nadawca niezweryfikowany</span>' : '') +
          ((r.zalaczniki || []).length ? '<span class="pill p-grey">📎 ' + r.zalaczniki.length + '</span>' : '') + statePill(r) + '</div></div>' +
      '<div class="tbody">' +
        (a.pilnosc && a.pilnosc.powod ? '<p><b>Pilność:</b> ' + esc(a.pilnosc.poziom) + ' — ' + esc(a.pilnosc.powod) + '</p>' : '') +
        (a.termin && a.termin.data ? '<p><b>Termin z wiadomości:</b> ' + esc(a.termin.data.split('-').reverse().join('.')) + (a.termin.podstawa ? ' — ' + esc(a.termin.podstawa) : '') + '</p>' : '') +
        ((a.osoby || []).length ? '<p><b>Osoby:</b> ' + esc(a.osoby.join(', ')) + '</p>' : '') +
        (a.klient && (a.klient.nazwa || a.klient.nip) && !r.klient_nazwa ? '<p class="sub">Automat przypuszcza, że chodzi o: ' + esc(a.klient.nazwa) + (a.klient.nip ? ' (NIP ' + esc(a.klient.nip) + ')' : '') + ' — nie potwierdzono w bazie klientów.</p>' : '') +
        (r.klient_jak ? '<p class="sub">Klient rozpoznany po: ' + ({ adres: 'adresie nadawcy', domena: 'domenie nadawcy', nip: 'numerze NIP w treści' }[r.klient_jak] || '') + '. Adres nadawcy można podrobić — przy poleceniach dotyczących pieniędzy lub dostępu potwierdź je u klienta znanym kanałem.</p>' : '') +
        (att ? '<p><b>Załączniki:</b> ' + att + (a.zalaczniki_uwaga ? ' — ' + esc(a.zalaczniki_uwaga) : '') + '</p>' : '') +
        (r.fragment ? '<div class="cm"><small>Początek wiadomości' + (flags.obciete ? ' (duża wiadomość — odczytano część)' : '') + ':</small>\n' + esc(r.fragment) + (r.fragment.length >= 600 ? '…' : '') + '</div>' : '') +
        (r.powod && a.streszczenie ? '<p class="sub">' + esc(r.powod) + '</p>' : '') +
        (z ? '<p><a href="zadania.html?w=wszystkie">Otwórz zadanie →</a> <span class="sub">' + esc(z.tytul) + '</span></p>' : '') +
        (can ? '<div class="prop">' +
            '<div><label>Zadanie</label><input type="text" maxlength="200" data-f="tytul" value="' + esc(p ? p.tytul : '') + '" placeholder="Co trzeba zrobić" /></div>' +
            '<div><label>Dla kogo</label><select data-f="assignee">' + people + '</select></div>' +
            '<div><label>Termin</label><input type="date" data-f="termin" value="' + esc(p && p.termin ? p.termin : '') + '" /></div>' +
            '<label class="chk" style="padding-bottom:10px"><input type="checkbox" data-f="pilne"' + (r.pilnosc === 'wysoka' ? ' checked' : '') + ' /> pilne</label></div>' +
          '<textarea maxlength="1500" data-f="opis" placeholder="Szczegóły (opcjonalnie)">' + esc(p ? p.opis : '') + '</textarea>' : '') +
        '<div class="acts">' + (can ? '<button type="button" class="mini ok" data-act="zadanie">Utwórz zadanie</button>' : '') +
          (can && r.status !== 'bez_dzialania' ? '<button type="button" class="mini" data-act="bez_dzialania">Bez działania</button>' : '') +
          (admin || !r.ai ? '<button type="button" class="mini" data-act="ponow">' + (r.ai ? 'Analizuj ponownie' : 'Analizuj') + '</button>' : '') +
          '<span class="sub" data-msg></span></div>' +
        (r.sprawdzil ? '<p class="sub" style="margin-top:8px">Decyzja: ' + esc(who(r.sprawdzil)) + ', ' + esc(when(r.sprawdzono_at)) + '</p>' : '') +
      '</div></div>';
  }
  function render() {
    $('tabs').innerHTML = skrzynki.map(function (s) {
      return '<button type="button" data-s="' + esc(s.klucz) + '" class="' + (s.klucz === skrzynka ? 'on' : '') + '">' + esc(s.adres) + (s.klucz === skrzynka ? '<b>' + rows.filter(decyzja).length + '</b>' : '') + '</button>';
    }).join('');
    var cur = skrzynki.filter(function (s) { return s.klucz === skrzynka; })[0] || {};
    $('alarm').innerHTML = skrzynki.filter(function (s) { return s.ostrzezenie; }).map(function (s) { return '<div class="warnbox"><b>' + esc(s.adres) + ':</b> ' + esc(s.ostrzezenie) + '</div>'; }).join('') +
      (cur.tryb === 'wylaczona' ? '<div class="warnbox">Skrzynka ' + esc(cur.adres || '') + ' jest wyłączona — nowe wiadomości nie są pobierane.' + (admin ? ' Włącz ją w ustawieniach na dole strony.' : '') + '</div>' : '');
    var list = visible();
    $('list').innerHTML = list.length ? list.map(card).join('') : '<div class="empty">' + (rows.length ? 'Brak wiadomości w tym widoku.' : 'Brak wiadomości.') + '</div>';
  }

  async function load(s) {
    try {
      var out = await call('poczta', { action: 'lista', skrzynka: s || skrzynka || undefined, limit: 300 });
      me = out.me; admin = out.admin; skrzynka = out.skrzynka; skrzynki = out.skrzynki; zespol = out.zespol; rows = out.wiadomosci;
      zadania = {}; (out.zadania || []).forEach(function (z) { zadania[z.id] = z; });
      if ($('fKat').options.length < 2) $('fKat').innerHTML = '<option value="">— każda —</option>' + out.kategorie.concat(['wlasna']).map(function (k) { return '<option value="' + esc(k) + '">' + esc(KAT[k] || k) + '</option>'; }).join('');
      // a link from a task: show that message, in whichever mailbox it is
      if (want) {
        if (rows.some(function (r) { return r.id === want; })) { open[want] = true; $('fStan').value = ''; }
        else { var next = skrzynki.filter(function (x) { return x.klucz !== skrzynka && !x._tried; })[0]; skrzynki.forEach(function (x) { if (x.klucz === skrzynka) x._tried = true; }); if (next && !load._tried) { load._tried = true; return load(next.klucz); } }
      }
      render();
      if (want && open[want]) { var el = document.querySelector('[data-id="' + want.replace(/[^0-9a-f-]/gi, '') + '"]'); if (el) el.scrollIntoView({ block: 'center' }); want = ''; }
    } catch (e) { $('tabs').innerHTML = ''; $('list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }

  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-s]'); if (!b) return; open = {}; load(b.getAttribute('data-s')); });
  ['fStan', 'fKat', 'fNikt'].forEach(function (id) { $(id).addEventListener('change', render); });
  $('fKlient').addEventListener('input', render);
  $('list').addEventListener('click', async function (e) {
    var cardEl = e.target.closest('.task'); if (!cardEl) return;
    var id = cardEl.getAttribute('data-id'), r = rows.filter(function (x) { return x.id === id; })[0];
    var b = e.target.closest('[data-act]');
    if (!b) { if (e.target.closest('.thead')) { open[id] = !open[id]; cardEl.classList.toggle('open'); } return; }
    var act = b.getAttribute('data-act'), msg = cardEl.querySelector('[data-msg]');
    var f = function (n) { var el = cardEl.querySelector('[data-f="' + n + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; };
    if (act === 'ponow' && r.ai && !confirm('Ponowna analiza to kolejne płatne zapytanie. Kontynuować?')) return;
    b.disabled = true; msg.textContent = act === 'ponow' ? 'Analizuję…' : '';
    try {
      var body = { action: act, id: id };
      if (act === 'zadanie') { body.tytul = f('tytul'); body.opis = f('opis'); body.termin = f('termin') || null; body.assignee = f('assignee'); body.pilne = f('pilne'); }
      var out = await call('poczta', body);
      if (out.error) { msg.textContent = out.error; b.disabled = false; return; }
      // the assignee hears about the new task the same way as about any other
      if (act === 'zadanie' && out.powiadom) call('zadania', { action: 'notify', id: out.zadanie_id, event: 'new' }).catch(function () {});
      open[id] = act === 'ponow';
      await load();
      if (act === 'zadanie' && window.PortalShell && window.PortalShell.refreshTasks) window.PortalShell.refreshTasks();
    } catch (err) { msg.textContent = err.message; b.disabled = false; }
  });

  // ---------------- mailbox: reading, writing, changes ----------------
  var mb = { box: '', folders: [], folder: '', page: 1, total: 0, rows: [], msg: null, loaded: false, images: false, plain: false, tall: false, sel: {}, uidnext: 0 };
  var FOLD = { inbox: '📥 Odebrane', sent: '📤 Wysłane', drafts: '📝 Robocze', trash: '🗑 Kosz', junk: '🚫 Spam', archive: '🗄 Archiwum' };
  function pref(k, def) { try { var v = localStorage.getItem('tdcg_poczta_' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function setPref(k, v) { try { localStorage.setItem('tdcg_poczta_' + k, JSON.stringify(v)); } catch (e) {} }
  function ekran(e) { $('mb').setAttribute('data-ekran', e); }
  function mbErr(el, e) { el.innerHTML = '<div class="empty">' + esc(e && e.message ? e.message : e) + '</div>'; }
  function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return Math.floor(Math.random() * 16).toString(16); }); }
  async function callFile(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(BASE + 'poczta', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    if ((res.headers.get('content-type') || '').indexOf('application/json') >= 0) { var j = await res.json().catch(function () { return {}; }); throw new Error(j.error || ('Błąd ' + res.status)); }
    if (!res.ok) throw new Error('Błąd ' + res.status);
    return await res.arrayBuffer();
  }
  function folderBy(typ) { return mb.folders.filter(function (f) { return f.typ === typ && f.wybieralny; })[0] || null; }
  function curFolder() { return mb.folders.filter(function (x) { return x.id === mb.folder; })[0] || {}; }
  function renderFolders() {
    $('mbBox').innerHTML = skrzynki.map(function (s) { return '<option value="' + esc(s.klucz) + '"' + (s.klucz === mb.box ? ' selected' : '') + '>' + esc(s.adres) + '</option>'; }).join('');
    $('mbTree').innerHTML = mb.folders.length ? mb.folders.map(function (f) {
      var name = f.typ === 'inbox' ? FOLD.inbox : (FOLD[f.typ] ? FOLD[f.typ].split(' ')[0] + ' ' : '') + f.nazwa;
      return '<div class="frow' + (f.id === mb.folder ? ' on' : '') + (f.wybieralny ? '' : ' off') + '"' + (f.wybieralny ? ' role="button" tabindex="0" data-f="' + esc(f.id) + '"' : '') + ' style="margin-left:' + Math.min(4, f.poziom) * 12 + 'px" title="' + esc(f.sciezka) + '">' +
        '<span>' + esc(name) + '</span>' + (f.wybieralny ? '<span class="sub">' + (f.nieprzeczytane ? '<b>' + f.nieprzeczytane + '</b> / ' : '') + (f.wiadomosci == null ? '' : f.wiadomosci) + '</span>' : '') + '</div>';
    }).join('') : '<div class="sub">Brak folderów.</div>';
  }
  async function loadFolders(box, keep) {
    mb.box = box || mb.box || skrzynka;
    if (!keep) { mb.folders = []; mb.folder = ''; mb.rows = []; mb.msg = null; mb.sel = {}; $('mbTree').innerHTML = '<div class="sub">Ładowanie…</div>'; $('mbRows').innerHTML = ''; $('mbMsg').hidden = true; $('mbList').hidden = false; }
    try {
      var out = await call('poczta', { action: 'foldery', skrzynka: mb.box });
      if (out.error) throw new Error(out.error);
      mb.folders = out.foldery; mb.loaded = true;
      renderFolders();
      if (!keep) { var inbox = folderBy('inbox'); if (inbox) await openFolder(inbox.id, true); }
    } catch (e) { if (!keep) { renderFolders(); mbErr($('mbTree'), e); } }
  }
  function filters() { return { szukaj: $('mbQ').value.trim() || undefined, w_tresci: $('mbBody2').checked || undefined, od: $('mbOd').value || undefined, do: $('mbDo').value || undefined, nieprzeczytane: $('mbNew').checked || undefined, oflagowane: $('mbStar').checked || undefined, zalaczniki: $('mbAtt').checked || undefined }; }
  function hasFilters() { var f = filters(); return Object.keys(f).some(function (k) { return f[k]; }); }
  function selected() { return Object.keys(mb.sel).filter(function (u) { return mb.sel[u]; }).map(Number); }
  function moveOptions() { return '<option value="">Przenieś do…</option>' + mb.folders.filter(function (f) { return f.wybieralny && f.id !== mb.folder; }).map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.sciezka) + '</option>'; }).join(''); }
  function renderBulk() {
    var n = selected().length;
    $('mbBulk').hidden = !n;
    if (n) $('mbBulk').innerHTML = '<b>Zaznaczone: ' + n + '</b> <button type="button" class="mini" data-b="przeczytane">Przeczytane</button><button type="button" class="mini" data-b="nieprzeczytane">Nieprzeczytane</button><button type="button" class="mini" data-b="flaga">⚑ Flaga</button><button type="button" class="mini" data-b="archiwum">Archiwum</button><button type="button" class="mini" data-b="spam">Spam</button><button type="button" class="mini" data-b="kosz">🗑 Kosz</button><select data-bmove style="width:auto">' + moveOptions() + '</select><button type="button" class="mini" data-b="none">Odznacz</button>';
  }
  function renderRows(info) {
    var f = curFolder();
    $('mbTitle').textContent = f.sciezka || '';
    var sent = f.typ === 'sent' || f.typ === 'drafts';
    $('mbRows').innerHTML = mb.rows.length ? mb.rows.map(function (r) {
      var kto = sent ? 'Do: ' + (r.do || []).join(', ') : (r.od_nazwa || r.od_adres || '(nieznany nadawca)');
      return '<div class="row' + (r.przeczytana ? '' : ' new') + '" role="button" tabindex="0" data-u="' + r.uid + '"><span class="who"><input type="checkbox" data-sel="' + r.uid + '"' + (mb.sel[r.uid] ? ' checked' : '') + ' aria-label="Zaznacz wiadomość" /> ' + esc(kto) + '</span><span class="d">' + (r.oflagowana ? '⚑ ' : '') + (r.zalaczniki ? '📎 ' : '') + (r.odpowiedziano ? '↩ ' : '') + esc(when(r.data)) + '</span>' +
        '<span class="subj">' + esc(r.temat || '(bez tematu)') + '</span></div>';
    }).join('') : '<div class="empty">Brak wiadomości w tym widoku.</div>';
    var pages = Math.max(1, Math.ceil(mb.total / 30));
    $('mbInfo').textContent = 'Strona ' + mb.page + ' z ' + pages + ' · wiadomości: ' + mb.total + (info && info.przeszukano != null ? ' (z załącznikami wśród ' + info.przeszukano + ' najnowszych pasujących)' : '');
    $('mbPrev').disabled = mb.page <= 1; $('mbNext').disabled = mb.page >= pages;
    renderBulk();
  }
  async function openFolder(id, quiet, silent) {
    if (id !== mb.folder) { mb.page = 1; mb.sel = {}; }
    mb.folder = id; renderFolders();
    if (!silent) { mb.msg = null; $('mbMsg').hidden = true; $('mbList').hidden = false; if (!quiet) ekran('lista'); $('mbRows').innerHTML = '<div class="empty">Ładowanie…</div>'; }
    try {
      var body = filters(); body.action = 'lista_imap'; body.skrzynka = mb.box; body.folder = id; body.strona = mb.page;
      var out = await call('poczta', body);
      if (out.error) throw new Error(out.error);
      mb.rows = out.wiadomosci; mb.total = out.razem;
      renderRows(out);
    } catch (e) { if (!silent) { mbErr($('mbRows'), e); $('mbInfo').textContent = ''; } }
  }
  // changes in the mailbox (flags, moves); the list and counters follow
  async function akcja(co, uids, cel) {
    if (!uids.length) return false;
    try {
      var out = await call('poczta', { action: 'akcja_imap', skrzynka: mb.box, folder: mb.folder, uids: uids, co: co, cel: cel });
      if (out.error) { alert(out.error); return false; }
      var moved = !/^(przeczytane|nieprzeczytane|flaga|bez_flagi)$/.test(co);
      mb.rows.forEach(function (r) { if (uids.indexOf(r.uid) < 0) return; if (co === 'przeczytane') r.przeczytana = true; if (co === 'nieprzeczytane') r.przeczytana = false; if (co === 'flaga') r.oflagowana = true; if (co === 'bez_flagi') r.oflagowana = false; });
      if (moved) { uids.forEach(function (u) { delete mb.sel[u]; }); await openFolder(mb.folder, true, true); loadFolders(mb.box, true); } else { renderRows(); if (/przeczytane/.test(co)) loadFolders(mb.box, true); }
      return true;
    } catch (e) { alert(e.message); return false; }
  }
  $('mbBulk').addEventListener('click', function (e) { var b = e.target.closest('[data-b]'); if (!b) return; var co = b.getAttribute('data-b'); if (co === 'none') { mb.sel = {}; return renderRows(); } if (co === 'kosz' && !confirm('Przenieść zaznaczone wiadomości do Kosza?')) return; akcja(co, selected()); });
  $('mbBulk').addEventListener('change', function (e) { var s = e.target.closest('[data-bmove]'); if (s && s.value) akcja('przenies', selected(), s.value); });

  // ----- reading
  function frame(srcdoc) {
    // the mail's HTML never enters this page: it lives in a frame that can run no script and has no access to the portal
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('title', 'Treść wiadomości');
    f.className = 'paper' + (mb.tall ? ' tall' : '');
    f.srcdoc = srcdoc;
    return f;
  }
  // plain text shown properly: links are links, quoted lines fold away, a long signature too — all built from text nodes
  function linkify(parent, text) {
    var re = /(https?:\/\/[^\s<>"')\]]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a'), url = m[0].replace(/[.,;:!?]+$/, '');
      a.textContent = url; a.href = /^https?:/i.test(url) ? url : 'mailto:' + url; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
      parent.appendChild(a); last = m.index + url.length; re.lastIndex = last;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  function plainView(text) {
    var root = document.createElement('div'); root.className = 'cm mtext';
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n'), i = 0;
    function fold(label, body) { var d = document.createElement('details'); d.className = 'fold'; var s = document.createElement('summary'); s.textContent = label; d.appendChild(s); var p = document.createElement('div'); linkify(p, body); d.appendChild(p); root.appendChild(d); }
    var buf = [];
    function flush() { if (buf.length) { var p = document.createElement('div'); linkify(p, buf.join('\n')); root.appendChild(p); buf = []; } }
    while (i < lines.length) {
      if (/^-- ?$/.test(lines[i]) && lines.length - i > 6) { flush(); fold('Podpis (' + (lines.length - i - 1) + ' linii)', lines.slice(i + 1).join('\n')); break; }
      if (/^\s*>/.test(lines[i])) { var q = []; while (i < lines.length && (/^\s*>/.test(lines[i]) || (lines[i].trim() === '' && /^\s*>/.test(lines[i + 1] || '')))) { q.push(lines[i].replace(/^\s*> ?/, '')); i++; } flush(); fold('Cytowana wiadomość (' + q.length + ' linii)', q.join('\n')); continue; }
      buf.push(lines[i]); i++;
    }
    flush();
    return root;
  }
  var ATT = { pdf: '📕', png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼', doc: '📘', docx: '📘', odt: '📘', xls: '📗', xlsx: '📗', csv: '📗', zip: '🗜', '7z': '🗜', eml: '✉️', txt: '📄' };
  function attIco(n) { return ATT[(String(n).split('.').pop() || '').toLowerCase()] || '📎'; }
  var KTO = { otwarcie: 'przeczytał(a)', zalacznik: 'pobrał(a) załącznik', odpowiedz: 'odpowiedział(a)', przekazanie: 'przekazał(a)' };
  function renderMsg() {
    var m = mb.msg, a = m.analiza, el = $('mbMsg'), html = m.srcdoc && !mb.plain;
    var always = pref('obrazy', []).indexOf(m.od_adres) >= 0, kto = {};
    (m.kto || []).forEach(function (k) { var key = who(k.kto) + '|' + k.akcja; if (!kto[key]) kto[key] = k; });
    el.innerHTML = '<div class="acts" style="margin:0 0 10px"><button type="button" class="mini" data-m="back">← Lista</button>' +
        (m.szkic ? '<button type="button" class="mini ok" data-m="edit">Edytuj szkic</button>' : '<button type="button" class="mini ok" data-m="reply">↩ Odpowiedz</button><button type="button" class="mini" data-m="replyall">Odpowiedz wszystkim</button><button type="button" class="mini" data-m="forward">Przekaż</button>') +
        '<button type="button" class="mini" data-m="' + (m.przeczytana ? 'unread' : 'read') + '">' + (m.przeczytana ? 'Nieprzeczytana' : 'Przeczytana') + '</button>' +
        '<button type="button" class="mini" data-m="' + (m.oflagowana ? 'unflag' : 'flag') + '">' + (m.oflagowana ? '⚑ Zdejmij flagę' : '⚑ Flaga') + '</button>' +
        (m.typ_folderu !== 'archive' ? '<button type="button" class="mini" data-m="archive">Archiwum</button>' : '') + (m.typ_folderu !== 'junk' ? '<button type="button" class="mini" data-m="spam">Spam</button>' : '') +
        (m.typ_folderu !== 'trash' ? '<button type="button" class="mini" data-m="trash">🗑 Kosz</button>' : '') + '<select data-mmove style="width:auto">' + moveOptions() + '</select></div>' +
      '<div class="mhead"><h2>' + esc(m.temat || '(bez tematu)') + '</h2>' +
        '<p><b>Od:</b> ' + esc(m.od_nazwa || '') + ' &lt;' + esc(m.od_adres || 'nieznany') + '&gt;</p>' +
        '<p><b>Do:</b> ' + esc((m.do || []).join(', ')) + '</p><p class="sub">' + esc(when(m.data)) + ' · ' + kb(m.rozmiar) + (m.odpowiedziano ? ' · ↩ odpowiedziano' : '') + (m.przekazano ? ' · przekazano' : '') + '</p>' +
        (Object.keys(kto).length ? '<p class="sub">W portalu: ' + Object.keys(kto).map(function (k) { return esc(KTO[kto[k].akcja] || kto[k].akcja) + ' ' + esc(who(kto[k].kto)) + ' (' + esc(when(kto[k].at)) + ')'; }).join(' · ') + '</p>' : '') + '</div>' +
      (m.zalaczniki.length ? '<div class="atts">' + m.zalaczniki.map(function (z) {
        return z.za_duzy ? '<span class="pill p-grey" title="Ponad 20 MB — otwórz w programie pocztowym">' + attIco(z.nazwa) + ' ' + esc(z.nazwa) + ' (' + kb(z.rozmiar) + ', za duży)</span>'
          : '<button type="button" class="mini" data-part="' + esc(z.part) + '" data-name="' + esc(z.nazwa) + '">' + attIco(z.nazwa) + ' ' + esc(z.nazwa) + ' (' + kb(z.rozmiar) + ')</button>';
      }).join('') + '</div>' : '') +
      '<div class="acts" style="margin:0 0 8px">' + (m.srcdoc && m.tekst ? '<button type="button" class="mini" data-m="view">' + (mb.plain ? 'Widok sformatowany' : 'Tylko tekst') + '</button>' : '') +
        (html ? '<button type="button" class="mini" data-m="tall">' + (mb.tall ? 'Zwiń' : 'Rozwiń') + '</button>' : '') +
        (html && m.zdalne && !mb.images ? '<button type="button" class="mini" data-m="img">Pokaż obrazy z internetu (' + m.zdalne + ')</button><button type="button" class="mini" data-m="imgalways">Zawsze od tego nadawcy</button>' : '') +
        (html && m.zdalne && always ? '<button type="button" class="mini" data-m="imgnever">Nie pokazuj automatycznie od tego nadawcy</button>' : '') + '</div>' +
      '<div id="mbBody"></div>' +
      '<div class="acts" style="margin-top:12px">' +
        (a && a.zadanie ? '<a href="zadania.html?w=wszystkie">Zadanie: ' + esc(a.zadanie.tytul) + ' →</a>' : '') +
        (a ? '<button type="button" class="mini" data-m="triage">Pokaż w „Do decyzji”</button>' : '<button type="button" class="mini" data-m="analiza">Utwórz zadanie z tej wiadomości</button>') +
        '<span class="sub" data-mmsg></span></div>';
    var body = $('mbBody');
    if (html) body.appendChild(frame(mb.images ? m.srcdoc.replace('img-src data:;', 'img-src data: https:;').replace(/ data-zdalne="/g, ' src="') : m.srcdoc));
    else if (m.tekst) body.appendChild(plainView(m.tekst));
    else { var t = document.createElement('div'); t.className = 'cm mtext'; t.textContent = '(wiadomość bez treści)'; body.appendChild(t); }
  }
  async function openMsg(uid) {
    var el = $('mbMsg');
    $('mbList').hidden = true; el.hidden = false; ekran('wiadomosc');
    el.innerHTML = '<div class="empty">Ładowanie…</div>';
    try {
      var out = await call('poczta', { action: 'wiadomosc_imap', skrzynka: mb.box, folder: mb.folder, uid: uid });
      if (out.error) throw new Error(out.error);
      mb.msg = out; mb.plain = false; mb.tall = false;
      mb.images = pref('obrazy', []).indexOf(out.od_adres) >= 0; // remote pictures only on request, or for senders this person chose
      renderMsg();
      // a shared mailbox worked from the portal: opening marks the message read (a personal setting, on by default)
      if (!out.przeczytana && pref('czytaj', true) && out.typ_folderu !== 'drafts') akcja('przeczytane', [uid]).then(function (ok) { if (ok && mb.msg && mb.msg.uid === uid) mb.msg.przeczytana = true; });
      var back = el.querySelector('[data-m="back"]'); if (back) back.focus();
    } catch (e) { el.innerHTML = '<div class="acts" style="margin:0 0 10px"><button type="button" class="mini" data-m="back">← Lista</button></div><div class="empty">' + esc(e.message) + '</div>'; }
  }
  function backToList() { $('mbMsg').hidden = true; $('mbList').hidden = false; ekran('lista'); var r = mb.msg && document.querySelector('.row[data-u="' + mb.msg.uid + '"]'); if (r) r.focus(); mb.msg = null; }
  async function msgAct(act) {
    var m = mb.msg; if (!m) return;
    var map = { read: 'przeczytane', unread: 'nieprzeczytane', flag: 'flaga', unflag: 'bez_flagi', archive: 'archiwum', spam: 'spam', trash: 'kosz' };
    if (act === 'trash' && !confirm('Przenieść wiadomość do Kosza?')) return;
    var ok = await akcja(map[act], [m.uid]);
    if (!ok || mb.msg !== m) return;
    if (act === 'read' || act === 'unread') { m.przeczytana = act === 'read'; renderMsg(); }
    else if (act === 'flag' || act === 'unflag') { m.oflagowana = act === 'flag'; renderMsg(); }
    else backToList();
  }
  $('mbMsg').addEventListener('change', async function (e) { var s = e.target.closest('[data-mmove]'); if (s && s.value && mb.msg) { if (await akcja('przenies', [mb.msg.uid], s.value)) backToList(); } });
  $('mbMsg').addEventListener('click', async function (e) {
    var part = e.target.closest('[data-part]'), b = e.target.closest('[data-m]'), msg = $('mbMsg').querySelector('[data-mmsg]');
    if (part) {
      part.disabled = true;
      try {
        var buf = await callFile({ action: 'zalacznik_imap', skrzynka: mb.box, folder: mb.folder, uid: mb.msg.uid, part: part.getAttribute('data-part') });
        // always saved as a file of an inert type — never opened inside the portal
        var url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' })), a = document.createElement('a');
        a.href = url; a.download = part.getAttribute('data-name') || 'zalacznik'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      } catch (err) { if (msg) msg.textContent = err.message; }
      part.disabled = false;
      return;
    }
    if (!b) return;
    var act = b.getAttribute('data-m'), m = mb.msg;
    if (act === 'back') return backToList();
    if (act === 'view') { mb.plain = !mb.plain; return renderMsg(); }
    if (act === 'tall') { mb.tall = !mb.tall; return renderMsg(); }
    if (act === 'img') { mb.images = true; return renderMsg(); }
    if (act === 'imgalways' || act === 'imgnever') { var l = pref('obrazy', []).filter(function (x) { return x !== m.od_adres; }); if (act === 'imgalways' && m.od_adres) l.push(m.od_adres); setPref('obrazy', l.slice(-300)); mb.images = act === 'imgalways'; return renderMsg(); }
    if (act === 'reply' || act === 'replyall' || act === 'forward') return compose(act);
    if (act === 'edit') return compose('draft');
    if (/^(read|unread|flag|unflag|archive|spam|trash)$/.test(act)) return msgAct(act);
    if (act === 'triage') return toTriage(m.analiza.id);
    if (act === 'analiza') {
      b.disabled = true; msg.textContent = 'Analizuję wiadomość (płatne zapytanie)…';
      try {
        var out = await call('poczta', { action: 'analizuj_imap', skrzynka: mb.box, folder: mb.folder, uid: m.uid });
        if (out.error && !out.wiersz) { msg.textContent = out.error; b.disabled = false; return; }
        toTriage(out.wiersz);
      } catch (err) { msg.textContent = err.message; b.disabled = false; }
    }
  });
  function toTriage(id) { want = id; open = {}; load._tried = false; show('analiza'); load(mb.box); }

  // ----- writing
  var TAGS = { P: 1, BR: 1, DIV: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, A: 1, UL: 1, OL: 1, LI: 1, H2: 1, H3: 1, BLOCKQUOTE: 1, SPAN: 1, FONT: 1, IMG: 1, HR: 1 };
  var PALETA = ['#111111', '#1B3F7F', '#1FA84B', '#b91c1c', '#b45309', '#6b7280'];
  var cmp = null; // the open compose window
  function hex(c) { var m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); if (m) c = '#' + [1, 2, 3].map(function (i) { return ('0' + Number(m[i]).toString(16)).slice(-2); }).join(''); c = String(c || '').toLowerCase(); return PALETA.map(function (p) { return p.toLowerCase(); }).indexOf(c) >= 0 ? c : ''; }
  // The HTML that leaves the editor is rebuilt from a short allow-list (the server cleans it once more).
  function serialize(node) {
    var out = '';
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { out += esc(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      var t = n.tagName;
      if (!TAGS[t]) { if (!/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG|MATH|FORM|INPUT|TEXTAREA|SELECT|BUTTON|META|LINK|TITLE|HEAD)$/.test(t)) out += serialize(n); return; }
      if (t === 'BR' || t === 'HR') { out += '<' + t.toLowerCase() + '>'; return; }
      if (t === 'IMG') { var cid = n.getAttribute('data-cid'); if (cid && /^[A-Za-z0-9._-]{1,60}$/.test(cid)) out += '<img src="cid:' + cid + '" alt="">'; return; }
      var tag = { STRONG: 'b', EM: 'i', STRIKE: 's', FONT: 'span', DIV: 'div' }[t] || t.toLowerCase(), attr = '', st = [];
      if (t === 'A') { var h = n.getAttribute('href') || ''; if (/^(https?:\/\/|mailto:)/i.test(h)) attr += ' href="' + esc(h) + '"'; else tag = 'span'; }
      var al = (n.style && n.style.textAlign) || n.getAttribute('align') || ''; if (/^(left|right|center|justify)$/.test(al)) st.push('text-align:' + al);
      var col = hex((n.style && n.style.color) || n.getAttribute('color')); if (col) st.push('color:' + col);
      if (st.length) attr += ' style="' + st.join(';') + '"';
      out += '<' + tag + attr + '>' + serialize(n) + '</' + tag + '>';
    });
    return out;
  }
  // HTML from outside (clipboard, a saved signature, a draft) enters the editor only through the same allow-list:
  // parsed in an inert document, rebuilt by serialize(), remote pictures dropped.
  function cleanHtml(html) { var doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html'); return serialize(doc.body); }
  function plainOf(el) { return (el.innerText || el.textContent || '').replace(/ /g, ' ').trim(); }
  function chips(k) {
    return cmp[k].map(function (a, i) { return '<span class="pill p-navy">' + esc(a) + ' <a href="#" data-rm="' + k + ':' + i + '" aria-label="Usuń adres ' + esc(a) + '" style="text-decoration:none">×</a></span>'; }).join(' ');
  }
  function renderChips() { ['do', 'dw', 'udw'].forEach(function (k) { $('c_' + k + '_chips').innerHTML = chips(k); }); }
  function addAddr(k, raw) {
    var bad = [];
    String(raw || '').split(/[;,\s]+/).forEach(function (a) { a = a.trim().toLowerCase(); if (!a) return; if (/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(a)) { if (cmp[k].indexOf(a) < 0) cmp[k].push(a); } else bad.push(a); });
    renderChips(); cmp.dirty = true;
    return bad;
  }
  function renderAtts() {
    var sum = cmp.files.reduce(function (s, f) { return s + f.size; }, 0);
    $('c_atts').innerHTML = cmp.files.filter(function (f) { return !f.cid; }).map(function (f) { return '<span class="pill p-grey">' + attIco(f.nazwa) + ' ' + esc(f.nazwa) + ' (' + kb(f.size) + ') <a href="#" data-rmf="' + esc(f.id) + '" aria-label="Usuń załącznik" style="text-decoration:none">×</a></span>'; }).join(' ') +
      (cmp.orig.length ? ' ' + cmp.orig.map(function (z, i) { return '<label class="chk" style="display:inline-flex"><input type="checkbox" data-orig="' + i + '"' + (z.on ? ' checked' : '') + ' /> ' + attIco(z.nazwa) + ' ' + esc(z.nazwa) + '</label>'; }).join(' ') : '') +
      (sum ? ' <span class="sub">razem ' + kb(sum) + ' / 20 MB</span>' : '');
  }
  function b64of(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  async function addFiles(list, inline) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i], sum = cmp.files.reduce(function (s, x) { return s + x.size; }, 0);
      if (sum + f.size > 20 * 1024 * 1024) { cMsg('Załączniki przekraczają 20 MB — „' + f.name + '” pominięto.'); continue; }
      if (inline && (!/^image\/(png|jpeg|gif|webp)$/.test(f.type) || f.size > 2 * 1024 * 1024)) { cMsg('Wklejony obraz musi być PNG / JPG / GIF / WebP do 2 MB.'); continue; }
      var buf = await f.arrayBuffer(), item = { id: uuid().slice(0, 8), nazwa: f.name || ('obraz.' + (f.type.split('/')[1] || 'png')), size: f.size, b64: b64of(buf) };
      if (inline) {
        item.cid = 'img' + item.id;
        var img = document.createElement('img'); img.src = URL.createObjectURL(f); img.setAttribute('data-cid', item.cid); img.style.maxWidth = '100%';
        $('c_ed').focus(); var sel = window.getSelection(); if (sel.rangeCount && $('c_ed').contains(sel.anchorNode)) { sel.getRangeAt(0).insertNode(img); sel.collapseToEnd(); } else $('c_ed').appendChild(img);
      }
      cmp.files.push(item); cmp.dirty = true;
    }
    renderAtts();
  }
  function cMsg(t) { $('c_msg').textContent = t || ''; }
  function closeCompose() { if (!cmp) return; clearInterval(cmp.timer); clearTimeout(cmp.undo); cmp = null; $('compose').hidden = true; document.body.style.overflow = ''; if (cmpReturn && cmpReturn.focus) cmpReturn.focus(); }
  var cmpReturn = null;
  async function compose(mode) {
    var m = mb.msg, o = m && m.odp ? m.odp : {};
    cmpReturn = document.activeElement;
    cmp = { box: mb.box || skrzynka, do: [], dw: [], udw: [], files: [], orig: [], mode: mode, odp: null, szkic_id: uuid(), szkic_uid: 0, dirty: false, sending: false, klucz: uuid() };
    if (mode === 'reply' || mode === 'replyall') { cmp.do = (o.do || []).slice(); if (mode === 'replyall') cmp.dw = (o.dw || []).slice(); cmp.odp = { folder: mb.folder, uid: m.uid, tryb: 'reply' }; }
    if (mode === 'forward') { cmp.odp = { folder: mb.folder, uid: m.uid, tryb: 'forward' }; cmp.orig = m.zalaczniki.filter(function (z) { return !z.za_duzy; }).map(function (z) { return { part: z.part, nazwa: z.nazwa, on: true }; }); }
    if (mode === 'draft') { cmp.do = (m.do || []).slice(); cmp.szkic_id = m.szkic.id; cmp.szkic_uid = m.uid; }
    $('c_from').innerHTML = skrzynki.map(function (s) { return '<option value="' + esc(s.klucz) + '"' + (s.klucz === cmp.box ? ' selected' : '') + '>' + esc(s.adres) + '</option>'; }).join('');
    $('c_from').disabled = !!cmp.odp || mode === 'draft';
    $('c_temat').value = mode === 'forward' ? (o.fwd || '') : mode === 'draft' ? (m.temat || '') : cmp.odp ? (o.re || '') : '';
    $('c_title').textContent = { reply: 'Odpowiedź', replyall: 'Odpowiedź do wszystkich', forward: 'Przekazanie wiadomości', draft: 'Szkic' }[mode] || 'Nowa wiadomość';
    $('c_cytat_row').hidden = !cmp.odp; $('c_cytat').checked = true;
    $('c_potw').checked = false; $('c_pilna').checked = false;
    ['do', 'dw', 'udw'].forEach(function (k) { $('c_' + k).value = ''; });
    $('c_ed').innerHTML = mode === 'draft' ? cleanHtml(m.szkic.html) : '<p><br></p>';
    renderChips(); renderAtts(); cMsg(''); $('c_send').disabled = false; $('c_undo').hidden = true;
    $('compose').hidden = false; document.body.style.overflow = 'hidden';
    (cmp.do.length ? $('c_ed') : $('c_do')).focus();
    if (mode !== 'draft') {
      try { var p = await call('poczta', { action: 'podpis', skrzynka: cmp.box }); if (cmp && p.html) { var d = document.createElement('div'); d.setAttribute('data-podpis', '1'); d.innerHTML = cleanHtml(p.html); $('c_ed').appendChild(document.createElement('br')); $('c_ed').appendChild(d); cmp.stopka = p.stopka || ''; $('c_stopka').textContent = p.stopka ? 'Na końcu zostanie dodana stopka skrzynki: ' + p.stopka.slice(0, 160) + (p.stopka.length > 160 ? '…' : '') : ''; } } catch (e) {}
    }
    cmp.dirty = false;
    // the draft is kept in the mailbox's Drafts folder (visible from any mail program); attachments are not part of it
    cmp.timer = setInterval(function () { if (cmp && cmp.dirty && !cmp.sending && !cmp.saving) saveDraft(true); }, 20000);
  }
  function payload() {
    ['do', 'dw', 'udw'].forEach(function (k) { if ($('c_' + k).value.trim()) { addAddr(k, $('c_' + k).value); $('c_' + k).value = ''; } });
    return { skrzynka: cmp.box, do: cmp.do, dw: cmp.dw, udw: cmp.udw, temat: $('c_temat').value.trim(), html: serialize($('c_ed')) };
  }
  async function saveDraft(auto) {
    if (!cmp) return;
    var c = cmp, p = payload(); p.action = 'szkic_zapisz'; p.szkic_id = c.szkic_id; p.poprzedni_uid = c.szkic_uid || undefined;
    c.saving = true; c.dirty = false;
    try { var out = await call('poczta', p); if (out.error) throw new Error(out.error); c.szkic_uid = out.uid || 0; if (cmp === c) cMsg('Szkic zapisany w folderze Robocze ' + new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) + (c.files.length ? ' (bez załączników).' : '.')); }
    catch (e) { c.dirty = true; if (cmp === c && !auto) cMsg('Nie udało się zapisać szkicu: ' + e.message); }
    c.saving = false;
  }
  async function reallySend(confirmed) {
    var c = cmp; if (!c) return;
    var p = payload(); p.action = 'wyslij'; p.klucz = c.klucz; p.potwierdzone = !!confirmed; p.potwierdzenie = $('c_potw').checked; p.pilna = $('c_pilna').checked;
    p.zalaczniki = c.files.map(function (f) { return { nazwa: f.nazwa, b64: f.b64, cid: f.cid }; });
    if (c.odp) { p.odp = { folder: c.odp.folder, uid: c.odp.uid, tryb: c.odp.tryb, czesci: c.orig.filter(function (z) { return z.on; }).map(function (z) { return z.part; }) }; p.cytat = $('c_cytat').checked; }
    if (c.szkic_uid) { p.szkic_id = c.szkic_id; p.szkic_uid = c.szkic_uid; }
    cMsg('Wysyłam…');
    try {
      var out = await call('poczta', p);
      if (out.potwierdz) {
        if (confirm(out.pytanie + '\n\n' + out.potwierdz.join('\n') + '\n\nWysłać mimo to?')) return reallySend(true);
        c.sending = false; $('c_send').disabled = false; return cMsg('Nie wysłano.');
      }
      if (out.error) { c.sending = false; $('c_send').disabled = false; return cMsg(out.error); }
      var task = c.odp && c.odp.tryb === 'reply' && mb.msg && mb.msg.analiza && mb.msg.analiza.zadanie && /^(nowe|w_toku)$/.test(mb.msg.analiza.zadanie.status) ? mb.msg.analiza.zadanie : null;
      closeCompose();
      if ((out.ostrzezenia || []).length) alert(out.ostrzezenia.join('\n'));
      // the answer went out: offer (never decide) to close the task that belongs to this message
      if (task && confirm('Odpowiedź wysłana. Oznaczyć zadanie „' + task.tytul + '” jako zrobione?')) { await window.sb.from('portal_zadania').update({ status: 'zrobione' }).eq('id', task.id); if (window.PortalShell && window.PortalShell.refreshTasks) window.PortalShell.refreshTasks(); }
      if (mb.loaded) { loadFolders(mb.box, true); if (mb.msg) openMsg(mb.msg.uid); else if (mb.folder) openFolder(mb.folder, true, true); }
    } catch (e) { c.sending = false; $('c_send').disabled = false; cMsg(e.message + ' — zanim spróbujesz ponownie, sprawdź folder Wysłane.'); }
  }
  function send() {
    if (!cmp || cmp.sending) return;
    var p = payload(), text = plainOf($('c_ed'));
    if (!p.do.length && !p.dw.length && !p.udw.length) return cMsg('Podaj odbiorcę.');
    if (!p.temat) return cMsg('Podaj temat wiadomości.');
    if (!text && !cmp.files.length && !(cmp.odp && cmp.odp.tryb === 'forward')) return cMsg('Wiadomość jest pusta.');
    if (/za[łl][aą]czni|w za[łl][aą]czeniu|attach/i.test(text) && !cmp.files.length && !cmp.orig.some(function (z) { return z.on; }) && !confirm('W treści jest mowa o załączniku, ale nic nie dołączono. Wysłać bez załącznika?')) return;
    // ten seconds to change one's mind; the key makes a second click harmless
    cmp.sending = true; $('c_send').disabled = true; $('c_undo').hidden = false;
    var left = 10, c = cmp;
    (function tick() { if (cmp !== c || !c.sending) return; if (left <= 0) { $('c_undo').hidden = true; return reallySend(false); } cMsg('Wysyłka za ' + left + ' s…'); left--; c.undo = setTimeout(tick, 1000); })();
  }
  $('c_undo').addEventListener('click', function () { if (!cmp) return; clearTimeout(cmp.undo); cmp.sending = false; $('c_send').disabled = false; this.hidden = true; cMsg('Wysyłka cofnięta.'); });
  $('c_send').addEventListener('click', send);
  $('c_draft').addEventListener('click', function () { saveDraft(false); });
  $('c_close').addEventListener('click', async function () {
    if (!cmp || cmp.sending) return;
    if (cmp.dirty && confirm('Zapisać wiadomość jako szkic?')) await saveDraft(false);
    else if (cmp.szkic_uid && cmp.mode !== 'draft' && !cmp.dirty) { /* an autosaved copy stays in Robocze */ }
    closeCompose();
  });
  $('c_discard').addEventListener('click', async function () {
    if (!cmp || cmp.sending || !confirm('Odrzucić tę wiadomość' + (cmp.szkic_uid ? ' i usunąć jej szkic' : '') + '?')) return;
    var c = cmp; closeCompose();
    if (c.szkic_uid) { try { await call('poczta', { action: 'szkic_usun', skrzynka: c.box, szkic_id: c.szkic_id, uid: c.szkic_uid }); if (mb.loaded) { loadFolders(mb.box, true); if (curFolder().typ === 'drafts') { mb.msg = null; openFolder(mb.folder); } } } catch (e) {} }
  });
  $('c_from').addEventListener('change', function () { if (cmp) cmp.box = this.value; });
  $('c_savesig').addEventListener('click', async function () {
    var sig = $('c_ed').querySelector('[data-podpis]'); if (!cmp || !sig) return cMsg('W treści nie ma bloku podpisu.');
    try { await call('poczta', { action: 'podpis', skrzynka: cmp.box, html: serialize(sig) }); cMsg('Podpis zapisany dla skrzynki ' + cmp.box + '.'); } catch (e) { cMsg(e.message); }
  });
  $('compose').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-rm]'), rf = e.target.closest('[data-rmf]'), cmd = e.target.closest('[data-cmd]');
    if (rm) { e.preventDefault(); var p = rm.getAttribute('data-rm').split(':'); cmp[p[0]].splice(Number(p[1]), 1); cmp.dirty = true; return renderChips(); }
    if (rf) { e.preventDefault(); var id = rf.getAttribute('data-rmf'); cmp.files = cmp.files.filter(function (f) { return f.id !== id; }); return renderAtts(); }
    if (cmd) {
      e.preventDefault(); $('c_ed').focus();
      var c = cmd.getAttribute('data-cmd'), v = cmd.getAttribute('data-val') || null;
      if (c === 'createLink') { v = prompt('Adres strony (https://…) albo e-mail:', 'https://'); if (!v) return; if (!/^(https?:\/\/|mailto:)/i.test(v)) v = /@/.test(v) ? 'mailto:' + v : 'https://' + v; }
      document.execCommand(c, false, v); cmp.dirty = true;
    }
  });
  $('compose').addEventListener('change', function (e) { var o = e.target.closest('[data-orig]'); if (o && cmp) { cmp.orig[Number(o.getAttribute('data-orig'))].on = o.checked; } });
  ['do', 'dw', 'udw'].forEach(function (k) {
    var inp = $('c_' + k), t = null;
    function commit() { if (!cmp) return; var bad = addAddr(k, inp.value); inp.value = bad.join(' '); if (bad.length) cMsg('Nieprawidłowy adres: ' + bad.join(', ')); $('c_sug').hidden = true; }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === ' ' && /@/.test(inp.value))) { e.preventDefault(); commit(); } else if (e.key === 'Backspace' && !inp.value && cmp && cmp[k].length) { cmp[k].pop(); renderChips(); } });
    inp.addEventListener('blur', function () { setTimeout(function () { if (cmp && inp.value.trim()) commit(); }, 200); });
    inp.addEventListener('input', function () {
      clearTimeout(t); var q = inp.value.trim();
      if (q.length < 2) { $('c_sug').hidden = true; return; }
      t = setTimeout(async function () {
        try { var out = await call('poczta', { action: 'podpowiedzi', skrzynka: cmp.box, q: q }); if (!cmp || inp.value.trim() !== q) return;
          $('c_sug').hidden = !out.adresy.length; $('c_sug').setAttribute('data-k', k);
          $('c_sug').innerHTML = out.adresy.map(function (a) { return '<div class="frow" role="button" tabindex="0" data-pick="' + esc(a.adres) + '"><span>' + esc(a.adres) + '</span><span class="sub">' + esc(a.opis) + '</span></div>'; }).join('');
        } catch (e) {}
      }, 250);
    });
  });
  function pick(e) { var p = e.target.closest('[data-pick]'); if (!p || (e.type === 'keydown' && e.key !== 'Enter')) return; var k = $('c_sug').getAttribute('data-k'); addAddr(k, p.getAttribute('data-pick')); $('c_' + k).value = ''; $('c_sug').hidden = true; $('c_' + k).focus(); }
  $('c_sug').addEventListener('mousedown', function (e) { e.preventDefault(); pick(e); }); $('c_sug').addEventListener('keydown', pick);
  $('c_file').addEventListener('change', function () { addFiles(this.files, false); this.value = ''; });
  $('c_ed').addEventListener('input', function () { if (cmp) cmp.dirty = true; });
  $('c_temat').addEventListener('input', function () { if (cmp) cmp.dirty = true; });
  $('c_ed').addEventListener('paste', function (e) {
    var cd = e.clipboardData; if (!cd || !cmp) return;
    var imgs = [].filter.call(cd.files || [], function (f) { return /^image\//.test(f.type); });
    e.preventDefault();
    if (imgs.length) return addFiles(imgs, true);
    // pasted formatting is reduced to the allow-list; pictures from the internet do not come along
    var h = cd.getData('text/html'), t = cd.getData('text/plain');
    document.execCommand('insertHTML', false, h ? cleanHtml(h) : esc(t).replace(/\n/g, '<br>'));
    cmp.dirty = true;
  });
  ['dragover', 'drop'].forEach(function (ev) { $('compose').addEventListener(ev, function (e) { if (!cmp || !e.dataTransfer || [].indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return; e.preventDefault(); if (ev === 'drop') addFiles(e.dataTransfer.files, false); }); });
  // focus stays inside the dialog; Escape asks before closing
  $('compose').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); return $('c_close').click(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); return send(); }
    if (e.key !== 'Tab') return;
    var f = [].filter.call($('compose').querySelectorAll('button,[href],input,select,textarea,[contenteditable],[tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  $('mbNewMsg').addEventListener('click', function () { compose('new'); });

  // ----- list events, keyboard, refresh
  function rowKeys(sel, attr, fn) {
    return function (e) {
      if (e.target.closest('[data-sel]')) return;
      var r = e.target.closest(sel); if (!r) return;
      if (e.type === 'click' || e.key === 'Enter') { e.preventDefault(); return fn(r.getAttribute(attr)); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { var n = e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling; while (n && !n.matches(sel)) n = e.key === 'ArrowDown' ? n.nextElementSibling : n.previousElementSibling; if (n) { e.preventDefault(); n.focus(); } }
      if (e.key === 'x' && attr === 'data-u') { var u = r.getAttribute('data-u'); mb.sel[u] = !mb.sel[u]; var cb = r.querySelector('[data-sel]'); if (cb) cb.checked = !!mb.sel[u]; renderBulk(); }
    };
  }
  var onFolder = rowKeys('[data-f]', 'data-f', function (id) { openFolder(id); }), onRow = rowKeys('[data-u]', 'data-u', function (u) { openMsg(Number(u)); });
  $('mbTree').addEventListener('click', onFolder); $('mbTree').addEventListener('keydown', onFolder);
  $('mbRows').addEventListener('click', onRow); $('mbRows').addEventListener('keydown', onRow);
  $('mbRows').addEventListener('change', function (e) { var c = e.target.closest('[data-sel]'); if (c) { mb.sel[c.getAttribute('data-sel')] = c.checked; renderBulk(); } });
  $('mbBox').addEventListener('change', function () { loadFolders(this.value); });
  $('mbToFolders').addEventListener('click', function () { ekran('foldery'); });
  function search() { mb.page = 1; mb.sel = {}; if (mb.folder) openFolder(mb.folder); }
  $('mbGo').addEventListener('click', search);
  $('mbQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
  $('mbClear').addEventListener('click', function () { $('mbQ').value = ''; $('mbOd').value = ''; $('mbDo').value = ''; ['mbNew', 'mbAtt', 'mbStar', 'mbBody2'].forEach(function (i) { $(i).checked = false; }); search(); });
  $('mbPrev').addEventListener('click', function () { if (mb.page > 1) { mb.page--; openFolder(mb.folder); } });
  $('mbNext').addEventListener('click', function () { mb.page++; openFolder(mb.folder); });
  $('mbRead').checked = pref('czytaj', true);
  $('mbRead').addEventListener('change', function () { setPref('czytaj', this.checked); });
  $('mbHelp').addEventListener('click', function () { $('mbKeys').hidden = !$('mbKeys').hidden; });
  document.addEventListener('keydown', function (e) {
    if ($('vSkrzynka').hidden || cmp || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable) return;
    var k = e.key;
    if (k === '?') { $('mbKeys').hidden = !$('mbKeys').hidden; return; }
    if (k === 'c' || k === 'n') { e.preventDefault(); return compose('new'); }
    if (k === '/') { e.preventDefault(); return $('mbQ').focus(); }
    if (!mb.msg) return;
    if (k === 'Escape') return backToList();
    if (k === 'r') { e.preventDefault(); return compose('reply'); }
    if (k === 'a') { e.preventDefault(); return compose('replyall'); }
    if (k === 'f') { e.preventDefault(); return compose('forward'); }
    if (k === 'u') return msgAct(mb.msg.przeczytana ? 'unread' : 'read');
    if (k === 's') return msgAct(mb.msg.oflagowana ? 'unflag' : 'flag');
    if (k === 'e') return msgAct('archive');
    if (k === 'Delete') return msgAct('trash');
  });
  // while the page is open: counters of the inbox and of the folder on screen once a minute; a new message
  // (the inbox's next UID moved) refreshes the first page of an unfiltered list. The triage list follows too.
  setInterval(async function () {
    if (document.hidden || cmp) return;
    if (!$('vAnaliza').hidden) { if (!Object.keys(open).some(function (k) { return open[k]; }) && !document.activeElement.closest('.task')) load(); return; }
    if (!mb.loaded || !mb.folder) return;
    try {
      var out = await call('poczta', { action: 'liczniki', skrzynka: mb.box, folder: mb.folder });
      var changed = false;
      Object.keys(out.liczniki || {}).forEach(function (id) { var f = mb.folders.filter(function (x) { return x.id === id; })[0], l = out.liczniki[id]; if (f) { if (f.wiadomosci !== l.wiadomosci || f.nieprzeczytane !== l.nieprzeczytane) changed = changed || id === mb.folder; f.wiadomosci = l.wiadomosci; f.nieprzeczytane = l.nieprzeczytane; } });
      renderFolders();
      if (changed && !mb.msg && mb.page === 1 && !hasFilters() && !selected().length) openFolder(mb.folder, true, true);
    } catch (e) {}
  }, 60000);
  function show(v) {
    $('vAnaliza').hidden = v !== 'analiza'; $('vSkrzynka').hidden = v !== 'skrzynka';
    document.querySelectorAll('#views [data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
    if (v === 'skrzynka' && !mb.loaded && skrzynki.length) loadFolders(skrzynka);
  }
  $('views').addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (b) show(b.getAttribute('data-v')); });
  $('logShow').addEventListener('click', async function () {
    this.disabled = true;
    try {
      var out = await call('poczta', { action: 'dziennik' }), CO = { otwarcie: 'otwarcie wiadomości', zalacznik: 'pobranie załącznika', analiza: 'analiza na żądanie', zmiana: 'zmiana' };
      $('logRows').innerHTML = out.dziennik.length ? '<table style="width:100%;font-size:13px;border-collapse:collapse"><tr><th align="left">Kiedy</th><th align="left">Kto</th><th align="left">Co</th><th align="left">Skrzynka / folder</th><th align="left">Nr</th></tr>' +
        out.dziennik.map(function (r) { return '<tr><td>' + esc(when(r.at)) + '</td><td>' + esc(who(r.kto)) + '</td><td>' + esc(CO[r.akcja] || r.akcja) + (r.szczegoly ? ': ' + esc(r.szczegoly) : '') + (r.czesc ? ' (część ' + esc(r.czesc) + ', ' + kb(r.rozmiar) + ')' : '') + '</td><td>' + esc(r.skrzynka) + ' / ' + esc(r.folder || '') + '</td><td>' + esc(r.uid) + '</td></tr>'; }).join('') + '</table>'
        : '<p class="sub">Brak wpisów.</p>';
    } catch (e) { $('logRows').innerHTML = '<p class="sub">' + esc(e.message) + '</p>'; }
    this.disabled = false;
  });
  $('sentShow').addEventListener('click', async function () {
    this.disabled = true;
    try {
      var out = await call('poczta', { action: 'wyslane_log' });
      $('sentRows').innerHTML = out.wyslane.length ? '<table style="width:100%;font-size:13px;border-collapse:collapse"><tr><th align="left">Kiedy</th><th align="left">Kto</th><th align="left">Skrzynka</th><th align="left">Do</th><th align="left">Temat</th><th align="left">Wynik</th></tr>' +
        out.wyslane.map(function (r) { return '<tr><td>' + esc(when(r.at)) + '</td><td>' + esc(who(r.kto)) + '</td><td>' + esc(r.skrzynka) + '</td><td>' + esc([].concat(r.odbiorcy_do, r.odbiorcy_dw, r.odbiorcy_udw).join(', ')) + '</td><td>' + esc(r.temat) + (r.zalaczniki ? ' 📎' + r.zalaczniki : '') + '</td><td>' + esc(r.wynik === 'wyslano' ? 'wysłano' : r.wynik === 'blad' ? 'błąd: ' + (r.blad || '') : 'w toku') + '</td></tr>'; }).join('') + '</table>'
        : '<p class="sub">Brak wpisów.</p>';
    } catch (e) { $('sentRows').innerHTML = '<p class="sub">' + esc(e.message) + '</p>'; }
    this.disabled = false;
  });

  // ---------------- settings (admin) ----------------
  function people(sel, empty) { return '<option value="">' + esc(empty) + '</option>' + zespol.map(function (e) { return '<option value="' + esc(e) + '"' + (e === sel ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join(''); }
  function renderSettings() {
    var u = st.ustawienia;
    $('settings').hidden = false;
    $('setBoxes').innerHTML = Object.keys(st.skrzynki).map(function (k) {
      var s = st.skrzynki[k], d = s.drogi || {}, con = s.polaczenie;
      return '<h3>' + esc(s.adres) + ' ' + (s.skonfigurowana ? '' : '<span class="pill p-red">nie skonfigurowana — brak hasła</span>') + '</h3>' +
        '<div class="set"><div><label>Tryb</label><select data-tryb="' + k + '">' + Object.keys(TRYB).map(function (t) { return '<option value="' + t + '"' + (t === s.tryb ? ' selected' : '') + '>' + esc(TRYB[t]) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Domyślna osoba</label><select data-dom="' + k + '">' + people(s.domyslny, k === 'kadry' && st.zadania_kadry ? '— jak w Zadaniach: ' + st.zadania_kadry.split('@')[0] + ' —' : '— brak —') + '</select></div>' +
        '<div style="display:flex;gap:8px;align-items:end"><div style="width:84px"><label>Ile na start</label><input type="number" min="0" max="20" value="0" data-ile="' + k + '" /></div><button type="button" class="mini" data-pobierz="' + k + '"' + (s.skonfigurowana ? '' : ' disabled') + '>Pobierz teraz (podgląd)</button></div></div>' +
        '<div class="set" style="grid-template-columns:1fr 2fr"><div><label>Nazwa nadawcy (pole „Od”)</label><input type="text" maxlength="80" data-nad="' + k + '" value="' + esc((u.nadawca || {})[k] || '') + '" /></div>' +
        '<div><label>Obowiązkowa stopka każdej wysyłanej wiadomości (np. klauzula poufności / RODO, telefon, adres)</label><textarea maxlength="1500" data-stopka="' + k + '" style="min-height:44px">' + esc((u.stopka || {})[k] || '') + '</textarea></div></div>' +
        '<p class="sub" style="margin:0 0 4px">Ostatnie ' + esc(String(d.godziny || 6)) + ' godz.: przekazane z serwera — <b>' + (d.push || 0) + '</b>, znalezione przy sprawdzaniu awaryjnym — <b>' + (d.poll || 0) + '</b>. ' +
          'Sprawdzanie awaryjne: ' + (s.ostatnie_udane ? esc(when(s.ostatnie_udane)) : 'jeszcze nie działało') + (s.blad ? ' · <b>błąd:</b> ' + esc(s.blad) : '') + '. Dziś analiz: ' + (s.dzis_analiz || 0) + '.' +
          (con ? ' Połączenie: ' + (con.ok ? 'OK, wiadomości w skrzynce: ' + con.wiadomosci : '<b>nieudane</b> — ' + esc(con.error)) + '.' : '') + '</p>' +
        (d.ostrzezenie ? '<div class="warnbox">' + esc(d.ostrzezenie) + '</div>' : '');
    }).join('') + (st.webhook ? '' : '<div class="warnbox">Przekazywanie z serwera poczty nie jest skonfigurowane (brak klucza) — działa tylko sprawdzanie awaryjne.</div>') +
      (st.model ? '' : '<div class="warnbox">Brak klucza usługi analizy — wiadomości będą na liście bez opisu.</div>');
    $('setMap').innerHTML = st.nazwy.length ? st.nazwy.map(function (n) {
      return '<div class="set"><div><b>' + esc(n.nazwa) + '</b> <span class="sub">' + (n.pole === 'kadrowy' ? 'kadry' : 'księgowość') + '</span></div>' +
        '<div class="sub">' + (n.profil ? 'profil: ' + esc(n.profil) : 'brak profilu z tym skrótem') + '</div>' +
        '<select data-map="' + esc(n.nazwa) + '">' + people(n.mapa, '— nie przypisano —') + '</select></div>';
    }).join('') : '<p class="sub">W bazie klientów nie ma jeszcze opiekunów ani kadrowych.</p>';
    $('lNaRaz').value = u.limity.naRaz; $('lDzien').value = u.limity.dziennie; $('lNadawca').value = u.limity.nadawca; $('lAuto').value = u.limity.autoDziennie; $('lKlienci').checked = u.autoTylkoKlienci;
  }
  async function loadSettings(sprawdz) { st = await call('poczta', { action: 'status', sprawdz: !!sprawdz }); renderSettings(); }
  function collect() {
    var u = JSON.parse(JSON.stringify(st.ustawienia));
    document.querySelectorAll('[data-tryb]').forEach(function (s) { u.skrzynki[s.getAttribute('data-tryb')].tryb = s.value; });
    document.querySelectorAll('[data-dom]').forEach(function (s) { u.skrzynki[s.getAttribute('data-dom')].domyslny = s.value; });
    u.nadawca = u.nadawca || {}; u.stopka = u.stopka || {};
    document.querySelectorAll('[data-nad]').forEach(function (i) { u.nadawca[i.getAttribute('data-nad')] = i.value; });
    document.querySelectorAll('[data-stopka]').forEach(function (i) { u.stopka[i.getAttribute('data-stopka')] = i.value; });
    u.mapa = {};
    document.querySelectorAll('[data-map]').forEach(function (s) { if (s.value) u.mapa[s.getAttribute('data-map')] = s.value; });
    u.limity.naRaz = $('lNaRaz').value; u.limity.dziennie = $('lDzien').value; u.limity.nadawca = $('lNadawca').value; u.limity.autoDziennie = $('lAuto').value; u.autoTylkoKlienci = $('lKlienci').checked;
    return u;
  }
  $('setSave').addEventListener('click', async function () {
    var u = collect(), auto = Object.keys(u.skrzynki).filter(function (k) { return u.skrzynki[k].tryb === 'auto' && st.skrzynki[k].tryb !== 'auto'; });
    if (auto.length && !confirm('Tryb automatyczny: portal sam utworzy zadania dla pracowników (z przypomnieniami w Telegramie). Włączyć dla: ' + auto.join(', ') + '?')) return;
    this.disabled = true; $('setMsg').textContent = '';
    try { await call('poczta', { action: 'ustawienia', ustawienia: u }); await loadSettings(); await load(); $('setMsg').textContent = 'Zapisano.'; } catch (e) { $('setMsg').textContent = e.message; }
    this.disabled = false;
  });
  $('setCheck').addEventListener('click', async function () {
    this.disabled = true; $('setMsg').textContent = 'Łączę ze skrzynkami…';
    try { await loadSettings(true); $('setMsg').textContent = 'Sprawdzono.'; } catch (e) { $('setMsg').textContent = e.message; }
    this.disabled = false;
  });
  $('settings').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-pobierz]'); if (!b) return;
    var k = b.getAttribute('data-pobierz'), ile = Number(document.querySelector('[data-ile="' + k + '"]').value) || 0;
    b.disabled = true; $('setMsg').textContent = 'Pobieram…';
    try {
      var out = await call('poczta', { action: 'pobierz', skrzynka: k, ile: ile }), i = out.info || {};
      $('setMsg').textContent = i.error ? 'Błąd: ' + i.error : i.zajete ? 'Sprawdzanie już trwa — spróbuj za chwilę.' : 'Nowych: ' + (i.przyjete || 0) + ', już znanych: ' + (i.duplikaty || 0) + ', przeanalizowanych: ' + (i.analizy || 0) + (i.start ? ' (start od teraz)' : '') + '.';
      await loadSettings(); await load(k);
    } catch (err) { $('setMsg').textContent = err.message; }
    b.disabled = false;
  });

  (async function () {
    if (!window.sb) return;
    await load();
    if (admin) loadSettings().catch(function (e) { $('settings').hidden = false; $('setMsg').textContent = e.message; });
  })();
})();
