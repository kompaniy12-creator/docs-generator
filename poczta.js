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
  var mb = { box: '', folders: [], folder: '', page: 1, total: 0, rows: [], msg: null, loaded: false, images: false, plain: false, tall: false, sel: {}, uidnext: 0, all: false, allInfo: '', exp: {}, tok: 0 };
  // The first page of each folder is kept for this browser tab (sessionStorage — gone when the tab closes), keyed by the
  // folder's UIDVALIDITY and next UID: a folder opens at once and the server is asked only for what changed.
  var env = {}, pre = {};
  try { env = JSON.parse(sessionStorage.getItem('tdcg_poczta_env') || '{}') || {}; } catch (e) { env = {}; }
  function envSave() { try { var k = Object.keys(env); while (k.length > 12) delete env[k.shift()]; sessionStorage.setItem('tdcg_poczta_env', JSON.stringify(env)); } catch (e) {} }
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
      var name = (FOLD[f.typ] ? FOLD[f.typ].split(' ')[0] + ' ' : '') + (f.etykieta || f.nazwa);
      return '<div class="frow' + (f.id === mb.folder ? ' on' : '') + (f.wybieralny ? '' : ' off') + '"' + (f.wybieralny ? ' role="button" tabindex="0" data-f="' + esc(f.id) + '"' : '') + ' style="margin-left:' + (f.typ ? 0 : Math.min(4, f.poziom) * 12) + 'px" title="' + esc(f.sciezka) + (f.portal ? ' — tego folderu używa portal' : '') + '">' +
        '<span>' + esc(name) + (f.portal && f.duplikat ? ' <span class="sub">· portal</span>' : '') + '</span>' + (f.wybieralny ? '<span class="sub">' + (f.nieprzeczytane ? '<b>' + f.nieprzeczytane + '</b> / ' : '') + (f.wiadomosci == null ? '' : f.wiadomosci) + '</span>' : '') + '</div>';
    }).join('') : '<div class="sub">Brak folderów.</div>';
    var f = curFolder(), acts = '<button type="button" class="mini" data-fa="nowy">＋ Nowy folder</button>';
    if (f.wlasny) acts += '<button type="button" class="mini" data-fa="nazwa">✎ Zmień nazwę</button><button type="button" class="mini" data-fa="usun">Usuń folder</button>';
    if (admin && f.portal && (f.typ === 'trash' || f.typ === 'junk')) acts += '<button type="button" class="mini" data-fa="oproznij">' + (f.typ === 'trash' ? 'Opróżnij kosz' : 'Opróżnij spam') + '</button>';
    $('mbFAct').innerHTML = acts;
  }
  // folders of people: create, rename, delete (system folders are refused by the server); emptying is the administrator's
  $('mbFAct').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-fa]'); if (!b) return;
    var co = b.getAttribute('data-fa'), f = curFolder(), body = null, nazwa;
    if (co === 'nowy') {
      nazwa = prompt('Nazwa nowego folderu:'); if (!nazwa || !nazwa.trim()) return;
      body = { action: 'folder_utworz', nazwa: nazwa.trim() };
      if (f.wlasny && confirm('Utworzyć „' + nazwa.trim() + '” jako podfolder w „' + f.nazwa + '”?\n\nOK — podfolder, Anuluj — folder główny.')) body.rodzic = f.id;
    } else if (co === 'nazwa') {
      nazwa = prompt('Nowa nazwa folderu „' + f.nazwa + '”:', f.nazwa); if (!nazwa || !nazwa.trim() || nazwa.trim() === f.nazwa) return;
      body = { action: 'folder_zmien', folder: f.id, nazwa: nazwa.trim() };
    } else if (co === 'usun') {
      if (!confirm('Usunąć folder „' + f.nazwa + '”?')) return;
      body = { action: 'folder_usun', folder: f.id };
    } else if (co === 'oproznij') body = { action: 'oproznij', typ: f.typ };
    if (!body) return;
    body.skrzynka = mb.box; b.disabled = true;
    try {
      var out = await call('poczta', body);
      if (out.potwierdz != null) {
        // an explicit confirmation naming the count; emptying asks for the number itself
        if (co === 'oproznij') { if (prompt(out.pytanie + '\n\nAby potwierdzić, wpisz liczbę wiadomości (' + out.potwierdz + '):') !== String(out.potwierdz)) { b.disabled = false; return; } }
        else if (!confirm(out.pytanie + '\n\nKontynuować?')) { b.disabled = false; return; }
        body.potwierdzenie = out.potwierdz;
        out = await call('poczta', body);
      }
      if (out.error) alert(out.error);
      else if (out.potwierdz != null) alert('Liczba wiadomości zmieniła się w międzyczasie — spróbuj ponownie.');
      else {
        if (co === 'oproznij') alert('Usunięto na stałe: ' + out.usunieto + (out.zostalo ? '. Zostało: ' + out.zostalo + ' — uruchom ponownie.' : '.'));
        delete env[mb.box + '|' + f.id];
        if (co === 'usun' || co === 'nazwa') { mb.folder = ''; await loadFolders(mb.box, true); var go = co === 'nazwa' ? out.folder : (folderBy('inbox') || {}).id; if (go) openFolder(go, true); }
        else { await loadFolders(mb.box, true); if (co === 'oproznij') openFolder(mb.folder, true); }
      }
    } catch (err) { alert(err.message); }
    b.disabled = false;
  });
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
  function moveOptions(label) { return '<option value="">' + (label || 'Przenieś do…') + '</option>' + mb.folders.filter(function (f) { return f.wybieralny && f.id !== mb.folder; }).map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.sciezka) + '</option>'; }).join(''); }
  function renderBulk() {
    var n = selected().length;
    $('mbBulk').hidden = !n;
    if (n) $('mbBulk').innerHTML = '<b>Zaznaczone: ' + n + '</b> <button type="button" class="mini" data-b="przeczytane">Przeczytane</button><button type="button" class="mini" data-b="nieprzeczytane">Nieprzeczytane</button><button type="button" class="mini" data-b="flaga">⚑ Flaga</button><button type="button" class="mini" data-b="archiwum">Archiwum</button><button type="button" class="mini" data-b="spam">Spam</button><button type="button" class="mini" data-b="kosz">🗑 Kosz</button><select data-bmove style="width:auto">' + moveOptions() + '</select><select data-bcopy style="width:auto">' + moveOptions('Kopiuj do…') + '</select><button type="button" class="mini" data-b="none">Odznacz</button>';
  }
  // conversations: messages of the loaded page that belong to one thread stand together, under the newest of them
  function groups() {
    if (mb.all || !pref('rozmowy', true)) return mb.rows.map(function (r) { return [r]; });
    var by = {}, out = [];
    mb.rows.forEach(function (r) { if (!r.watek) return out.push([r]); if (by[r.watek]) by[r.watek].push(r); else { by[r.watek] = [r]; out.push(by[r.watek]); } });
    return out;
  }
  function rowHtml(r, g, sub, sent) {
    var kto = sent ? 'Do: ' + (r.do || []).join(', ') : (r.od_nazwa || r.od_adres || '(nieznany nadawca)'), n = g.length, head = !sub && n > 1;
    if (head && !sent) { var names = []; g.forEach(function (x) { var nm = x.od_nazwa || x.od_adres; if (nm && names.indexOf(nm) < 0) names.push(nm); }); kto = names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : ''); }
    var unread = head ? g.some(function (x) { return !x.przeczytana; }) : !r.przeczytana, any = function (k) { return head ? g.some(function (x) { return x[k]; }) : r[k]; };
    return '<div class="row' + (unread ? ' new' : '') + (sub ? ' subrow' : '') + '" role="button" tabindex="0"' + (mb.all ? '' : ' draggable="true"') + ' data-u="' + r.uid + '"' + (r.folder ? ' data-uf="' + esc(r.folder) + '"' : '') + '><span class="who">' +
      (mb.all ? '' : '<input type="checkbox" data-sel="' + r.uid + '"' + (mb.sel[r.uid] ? ' checked' : '') + ' aria-label="Zaznacz wiadomość" /> ') +
      (head ? '<button type="button" class="mini conv" data-exp="' + esc(r.watek) + '" aria-expanded="' + (mb.exp[r.watek] ? 'true' : 'false') + '" title="Rozmowa: ' + n + ' wiadomości — pokaż / ukryj">' + (mb.exp[r.watek] ? '▾ ' : '▸ ') + n + '</button>' : '') + esc(kto) + '</span><span class="d">' +
      (r.folder_nazwa ? '<span class="pill p-grey">' + esc(r.folder_nazwa) + '</span> ' : '') + (r.przypisany ? '<span class="pill p-navy">' + esc(who(r.przypisany)) + '</span> ' : '') + (any('oflagowana') ? '⚑ ' : '') + (any('zalaczniki') ? '📎 ' : '') + (any('odpowiedziano') ? '↩ ' : '') + esc(when(r.data)) + '</span>' +
      '<span class="subj">' + esc(r.temat || '(bez tematu)') + '</span></div>';
  }
  function renderRows(info) {
    var f = curFolder();
    $('mbTitle').textContent = mb.all ? 'Wyniki ze wszystkich folderów' : (f.sciezka || '');
    var sent = !mb.all && (f.typ === 'sent' || f.typ === 'drafts');
    $('mbRows').innerHTML = mb.rows.length ? groups().map(function (g) {
      return rowHtml(g[0], g, false, sent) + (g.length > 1 && mb.exp[g[0].watek] ? g.slice(1).map(function (r) { return rowHtml(r, g, true, sent); }).join('') : '');
    }).join('') : '<div class="empty">Brak wiadomości w tym widoku.</div>';
    var pages = Math.max(1, Math.ceil(mb.total / 30));
    $('mbInfo').textContent = mb.all ? 'Znaleziono: ' + mb.rows.length + '. ' + mb.allInfo : 'Strona ' + mb.page + ' z ' + pages + ' · wiadomości: ' + mb.total + (info && info.przeszukano != null ? ' (z załącznikami wśród ' + info.przeszukano + ' najnowszych pasujących)' : '');
    $('mbPrev').disabled = mb.all || mb.page <= 1; $('mbNext').disabled = mb.all || mb.page >= pages;
    renderBulk();
  }
  async function openFolder(id, quiet, silent) {
    if (id !== mb.folder || mb.all) { mb.page = 1; mb.sel = {}; mb.exp = {}; }
    mb.folder = id; mb.all = false; renderFolders();
    var tok = ++mb.tok, plain = mb.page === 1 && !hasFilters(), key = mb.box + '|' + id, c = plain ? env[key] : null, shown = false;
    if (!silent) { mb.msg = null; $('mbMsg').hidden = true; $('mbList').hidden = false; if (!quiet) ekran('lista'); $('mbRows').innerHTML = '<div class="empty">Ładowanie…</div>'; }
    try {
      if (c && c.rows && c.rows.length) {
        // at once from what this tab already knows; then only the difference is asked for
        if (!silent) { mb.rows = c.rows; mb.total = c.total; renderRows(); shown = true; }
        var d = await call('poczta', { action: 'odswiez_imap', skrzynka: mb.box, folder: id, uidvalidity: c.uv, po_uid: c.uidnext - 1, uids: c.rows.map(function (r) { return r.uid; }) });
        if (tok !== mb.tok) return;
        if (!d.error && !d.pelne) {
          var fl = {}; (d.flagi || []).forEach(function (x) { fl[x.uid] = x; });
          var rows = (d.nowe || []).concat(c.rows.filter(function (r) { return fl[r.uid]; }).map(function (r) { r.przeczytana = fl[r.uid].przeczytana; r.odpowiedziano = fl[r.uid].odpowiedziano; r.oflagowana = fl[r.uid].oflagowana; return r; }));
          if (rows.length >= Math.min(30, d.razem)) {
            rows = rows.slice(0, 30); env[key] = { uv: d.uidvalidity, uidnext: d.uidnext, rows: rows, total: d.razem }; envSave();
            mb.rows = rows; mb.total = d.razem; renderRows(); return;
          }
        }
      }
      var body = filters(); body.action = 'lista_imap'; body.skrzynka = mb.box; body.folder = id; body.strona = mb.page;
      var out = await call('poczta', body);
      if (tok !== mb.tok) return;
      if (out.error) throw new Error(out.error);
      mb.rows = out.wiadomosci; mb.total = out.razem;
      if (plain && out.uidnext) { delete env[key]; env[key] = { uv: out.uidvalidity, uidnext: out.uidnext, rows: out.wiadomosci, total: out.razem }; envSave(); }
      renderRows(out);
    } catch (e) { if (tok === mb.tok && !silent && !shown) { mbErr($('mbRows'), e); $('mbInfo').textContent = ''; } }
  }
  // every folder of the mailbox, one after another (the server stops at its time budget and says what it skipped)
  async function searchAll() {
    var body = filters(); delete body.zalaczniki; body.action = 'szukaj_wszedzie'; body.skrzynka = mb.box;
    var tok = ++mb.tok;
    mb.sel = {}; mb.msg = null; $('mbMsg').hidden = true; $('mbList').hidden = false; ekran('lista'); $('mbRows').innerHTML = '<div class="empty">Przeszukuję wszystkie foldery…</div>'; $('mbInfo').textContent = '';
    try {
      var out = await call('poczta', body);
      if (tok !== mb.tok) return;
      if (out.error) throw new Error(out.error);
      mb.all = true; mb.rows = out.wiadomosci; mb.total = out.wiadomosci.length; mb.page = 1;
      mb.allInfo = 'Przeszukano folderów: ' + out.przeszukane + ' z ' + out.foldery + ' (do ' + out.na_folder + ' najnowszych trafień z każdego).' + (out.pominiete.length ? ' Nie zdążono przeszukać: ' + out.pominiete.join(', ') + ' — zawęź zapytanie albo przeszukaj te foldery osobno.' : '');
      renderRows();
    } catch (e) { if (tok === mb.tok) { mbErr($('mbRows'), e); $('mbInfo').textContent = ''; } }
  }
  // changes in the mailbox (flags, moves); the list and counters follow
  async function akcja(co, uids, cel) {
    if (!uids.length) return false;
    try {
      var out = await call('poczta', { action: 'akcja_imap', skrzynka: mb.box, folder: mb.folder, uids: uids, co: co, cel: cel });
      if (out.error) { alert(out.error); return false; }
      var moved = !/^(przeczytane|nieprzeczytane|flaga|bez_flagi|kopiuj)$/.test(co);
      if (window.PortalShell && window.PortalShell.refreshMail && (moved || /przeczytane/.test(co))) window.PortalShell.refreshMail();
      if (co === 'kopiuj') { loadFolders(mb.box, true); return true; }
      if (mb.all) { if (moved) mb.rows = mb.rows.filter(function (r) { return r.folder !== mb.folder || uids.indexOf(r.uid) < 0; }); else mb.rows.forEach(function (r) { if (r.folder === mb.folder && uids.indexOf(r.uid) >= 0) { if (/przeczytane/.test(co)) r.przeczytana = co === 'przeczytane'; if (/flag/.test(co)) r.oflagowana = co === 'flaga'; } }); renderRows(); loadFolders(mb.box, true); return true; }
      mb.rows.forEach(function (r) { if (uids.indexOf(r.uid) < 0) return; if (co === 'przeczytane') r.przeczytana = true; if (co === 'nieprzeczytane') r.przeczytana = false; if (co === 'flaga') r.oflagowana = true; if (co === 'bez_flagi') r.oflagowana = false; });
      if (moved) { uids.forEach(function (u) { delete mb.sel[u]; }); await openFolder(mb.folder, true, true); loadFolders(mb.box, true); } else { renderRows(); if (/przeczytane/.test(co)) loadFolders(mb.box, true); }
      return true;
    } catch (e) { alert(e.message); return false; }
  }
  $('mbBulk').addEventListener('click', function (e) { var b = e.target.closest('[data-b]'); if (!b) return; var co = b.getAttribute('data-b'); if (co === 'none') { mb.sel = {}; return renderRows(); } if (co === 'kosz' && !confirm('Przenieść zaznaczone wiadomości do Kosza?')) return; akcja(co, selected()); });
  $('mbBulk').addEventListener('change', function (e) { var s = e.target.closest('[data-bmove]'), c = e.target.closest('[data-bcopy]'); if (s && s.value) akcja('przenies', selected(), s.value); if (c && c.value) akcja('kopiuj', selected(), c.value).then(function (ok) { if (ok) { mb.sel = {}; renderRows(); } }); });
  // drag a message (or the selected ones) onto a folder: move; with Ctrl / Alt: copy
  $('mbRows').addEventListener('dragstart', function (e) {
    var r = e.target.closest && e.target.closest('.row[data-u]'); if (!r || mb.all) return;
    var u = Number(r.getAttribute('data-u')), sel = selected(), uids = sel.indexOf(u) >= 0 ? sel : [u];
    e.dataTransfer.setData('text/x-poczta', JSON.stringify(uids)); e.dataTransfer.effectAllowed = 'copyMove'; r.classList.add('drag');
  });
  $('mbRows').addEventListener('dragend', function (e) { var r = e.target.closest && e.target.closest('.row'); if (r) r.classList.remove('drag'); document.querySelectorAll('.frow.drop').forEach(function (x) { x.classList.remove('drop'); }); });
  ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
    $('mbTree').addEventListener(ev, function (e) {
      var f = e.target.closest('[data-f]');
      if (!f || [].indexOf.call(e.dataTransfer.types || [], 'text/x-poczta') < 0 || f.getAttribute('data-f') === mb.folder) return;
      if (ev === 'dragleave') return f.classList.remove('drop');
      e.preventDefault(); e.dataTransfer.dropEffect = e.ctrlKey || e.altKey ? 'copy' : 'move';
      if (ev === 'dragover') return f.classList.add('drop');
      f.classList.remove('drop');
      var uids = []; try { uids = JSON.parse(e.dataTransfer.getData('text/x-poczta')) || []; } catch (er) {}
      if (uids.length) akcja(e.ctrlKey || e.altKey ? 'kopiuj' : 'przenies', uids, f.getAttribute('data-f'));
    });
  });

  // ----- reading
  function frame(srcdoc) {
    // the mail's HTML never enters this page: it lives in a frame that can run no script and has no access to the portal
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('title', 'Treść wiadomości');
    f.className = 'paper';
    f.srcdoc = srcdoc;
    // the frame cannot report its own height (no scripts, no access): it fills the window, scrolls inside, and the
    // reader may drag its lower edge — the chosen height is remembered in this browser
    var w = document.createElement('div'), h = pref('wysokosc', 0);
    w.className = 'paperwrap' + (mb.tall ? ' tall' : '');
    if (h > 200 && !mb.tall) w.style.height = h + 'px';
    w.appendChild(f);
    w.addEventListener('mouseup', function () { if (!mb.tall && w.style.height) setPref('wysokosc', parseInt(w.style.height, 10) || 0); });
    return w;
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
        (m.typ_folderu !== 'trash' ? '<button type="button" class="mini" data-m="trash">🗑 Kosz</button>' : '') + '<select data-mmove style="width:auto">' + moveOptions() + '</select><select data-mcopy style="width:auto">' + moveOptions('Kopiuj do…') + '</select></div>' +
      (m.szkic && m.szkic.zaplanowana ? '<div class="warnbox">🕒 Ta wiadomość jest zaplanowana do wysłania ' + esc(when(m.szkic.zaplanowana.kiedy)) + ' (' + esc(who(m.szkic.zaplanowana.kto)) + '). <button type="button" class="mini" data-m="unplan">Anuluj wysyłkę</button></div>' : '') +
      '<div class="mhead"><h2>' + esc(m.temat || '(bez tematu)') + '</h2>' +
        '<p><b>Od:</b> ' + esc(m.od_nazwa || '') + ' &lt;' + esc(m.od_adres || 'nieznany') + '&gt;' + (m.od_adres && !m.szkic ? ' <a href="#" data-m="addc" class="sub">＋ do kontaktów</a>' : '') + '</p>' +
        '<p><b>Do:</b> ' + esc((m.do || []).join(', ')) + '</p><p class="sub">' + esc(when(m.data)) + ' · ' + kb(m.rozmiar) + (m.odpowiedziano ? ' · ↩ odpowiedziano' : '') + (m.przekazano ? ' · przekazano' : '') + '</p>' +
        (Object.keys(kto).length ? '<p class="sub">W portalu: ' + Object.keys(kto).map(function (k) { return esc(KTO[kto[k].akcja] || kto[k].akcja) + ' ' + esc(who(kto[k].kto)) + ' (' + esc(when(kto[k].at)) + ')'; }).join(' · ') + '</p>' : '') + '</div>' +
      (m.zalaczniki.length ? '<div class="atts">' + m.zalaczniki.map(function (z) {
        return z.za_duzy ? '<span class="pill p-grey" title="Ponad 20 MB — otwórz w programie pocztowym">' + attIco(z.nazwa) + ' ' + esc(z.nazwa) + ' (' + kb(z.rozmiar) + ', za duży)</span>'
          : '<button type="button" class="mini" data-part="' + esc(z.part) + '" data-name="' + esc(z.nazwa) + '" title="Pobierz">' + attIco(z.nazwa) + ' ' + esc(z.nazwa) + ' (' + kb(z.rozmiar) + ')</button>' +
            (/\.(png|jpe?g|gif|webp|pdf)$/i.test(z.nazwa) ? '<button type="button" class="mini" data-prev="' + esc(z.part) + '" data-name="' + esc(z.nazwa) + '" title="Podgląd" aria-label="Podgląd: ' + esc(z.nazwa) + '">👁</button>' : '');
      }).join('') + (m.zalaczniki.filter(function (z) { return !z.za_duzy; }).length > 1 ? '<button type="button" class="mini" data-m="zip">⬇ Pobierz wszystkie (ZIP)</button>' : '') + '</div>' : '') +
      '<div class="acts" style="margin:0 0 8px">' + (m.srcdoc && m.tekst ? '<button type="button" class="mini" data-m="view">' + (mb.plain ? 'Widok sformatowany' : 'Tylko tekst') + '</button>' : '') +
        (html ? '<button type="button" class="mini" data-m="tall">' + (mb.tall ? 'Zwiń' : 'Rozwiń') + '</button>' : '') +
        (html && m.zdalne && !mb.images ? '<button type="button" class="mini" data-m="img">Pokaż obrazy z internetu (' + m.zdalne + ')</button><button type="button" class="mini" data-m="imgalways">Zawsze od tego nadawcy</button>' : '') +
        (html && m.zdalne && always ? '<button type="button" class="mini" data-m="imgnever">Nie pokazuj automatycznie od tego nadawcy</button>' : '') +
        '<button type="button" class="mini" data-m="print">🖨 Drukuj</button><button type="button" class="mini" data-m="eml">⬇ Pobierz .eml</button><button type="button" class="mini" data-m="src">Pokaż źródło</button></div>' +
      '<div id="mbWatek"></div><div id="mbBody"></div>' +
      (a && a.zadanie && /^(nowe|w_toku)$/.test(a.zadanie.status) ? '<div class="cm" style="margin-top:12px;white-space:normal"><b>Zajmuje się: ' + esc(who(a.zadanie.assignee)) + '</b> <span class="sub">— notatki wewnętrzne (nie są wysyłane, widoczne w zadaniu)</span>' +
          (a.zadanie.notatki || []).map(function (n) { return '<p style="margin:6px 0 0"><small>' + esc(who(n.by)) + ' · ' + esc(when(n.at)) + '</small><br>' + esc(n.text) + '</p>'; }).join('') +
          '<div class="acts"><input type="text" maxlength="1000" placeholder="Notatka wewnętrzna…" data-note style="flex:1;min-width:180px" /><button type="button" class="mini" data-m="note">Dodaj notatkę</button></div></div>' : '') +
      '<div class="acts" style="margin-top:12px">' +
        (!(a && a.zadanie && /^(nowe|w_toku)$/.test(a.zadanie.status)) && !m.szkic ? '<button type="button" class="mini ok" data-m="take">✋ Zajmuję się tym</button>' : '') +
        (a && a.zadanie ? '<a href="zadania.html?w=wszystkie">Zadanie: ' + esc(a.zadanie.tytul) + ' →</a>' : '') +
        (a ? '<button type="button" class="mini" data-m="triage">Pokaż w „Do decyzji”</button>' : '<button type="button" class="mini" data-m="analiza">Utwórz zadanie z tej wiadomości</button>') +
        '<span class="sub" data-mmsg></span></div>';
    renderThread();
    var body = $('mbBody');
    if (html) body.appendChild(frame(mb.images ? m.srcdoc.replace('img-src data:;', 'img-src data: https:;').replace(/ data-zdalne="/g, ' src="') : m.srcdoc));
    else if (m.tekst) body.appendChild(plainView(m.tekst));
    else { var t = document.createElement('div'); t.className = 'cm mtext'; t.textContent = '(wiadomość bez treści)'; body.appendChild(t); }
  }
  async function fetchMsg(folder, uid, ahead) {
    var out = await call('poczta', { action: 'wiadomosc_imap', skrzynka: mb.box, folder: folder, uid: uid, wstepnie: ahead || undefined });
    if (out.error) throw new Error(out.error);
    return out;
  }
  // the next message of the list is fetched while this one is being read (logged as fetched ahead; its real opening
  // is reported when the person opens it)
  function prefetch(uid) {
    if (!pref('wstepnie', true) || mb.all) return;
    var i = mb.rows.map(function (r) { return r.uid; }).indexOf(uid), n = mb.rows[i + 1], folder = mb.folder, box = mb.box;
    if (i < 0 || !n || pre[box + '|' + folder + '|' + n.uid]) return;
    setTimeout(function () {
      var k = box + '|' + folder + '|' + n.uid;
      if (!mb.msg || mb.msg.uid !== uid || mb.box !== box || mb.folder !== folder || document.hidden || cmp || pre[k]) return;
      Object.keys(pre).forEach(function (x) { if (Date.now() - pre[x].at > 300000) delete pre[x]; });
      pre[k] = { at: Date.now(), p: fetchMsg(folder, n.uid, true).catch(function () { delete pre[k]; return null; }) };
    }, 1500);
  }
  async function openMsg(uid, folder) {
    var el = $('mbMsg');
    if (folder && folder !== mb.folder) { mb.folder = folder; mb.sel = {}; renderFolders(); }
    $('mbList').hidden = true; el.hidden = false; ekran('wiadomosc');
    el.innerHTML = '<div class="empty">Ładowanie…</div>';
    bytesOf = {};
    try {
      var k = mb.box + '|' + mb.folder + '|' + uid, hit = pre[k], out = null, f0 = mb.folder;
      if (hit && Date.now() - hit.at < 300000) {
        out = await hit.p; delete pre[k];
        if (out) call('poczta', { action: 'otwarto_imap', skrzynka: mb.box, folder: f0, uid: uid }).then(function (o) { if (o.error) throw new Error(o.error); })
          .catch(function (e) { if (mb.msg === out) { mb.msg = null; el.innerHTML = '<div class="acts" style="margin:0 0 10px"><button type="button" class="mini" data-m="back">← Lista</button></div><div class="empty">' + esc(e.message) + '</div>'; } });
      }
      if (!out) out = await fetchMsg(mb.folder, uid);
      mb.msg = out; mb.plain = false; mb.tall = false;
      mb.images = pref('obrazy', []).indexOf(out.od_adres) >= 0; // remote pictures only on request, or for senders this person chose
      renderMsg();
      // a shared mailbox worked from the portal: opening marks the message read (a personal setting, on by default)
      if (!out.przeczytana && pref('czytaj', true) && out.typ_folderu !== 'drafts') akcja('przeczytane', [uid]).then(function (ok) { if (ok && mb.msg && mb.msg.uid === uid) mb.msg.przeczytana = true; });
      var back = el.querySelector('[data-m="back"]'); if (back) back.focus();
      loadThread(uid); prefetch(uid);
    } catch (e) { el.innerHTML = '<div class="acts" style="margin:0 0 10px"><button type="button" class="mini" data-m="back">← Lista</button></div><div class="empty">' + esc(e.message) + '</div>'; }
  }
  // other messages of the same conversation (this folder and the portal's Sent folder)
  async function loadThread(uid) {
    try {
      var out = await call('poczta', { action: 'watek_imap', skrzynka: mb.box, folder: mb.folder, uid: uid });
      if (!mb.msg || mb.msg.uid !== uid) return;
      mb.msg.watek = out.watek || []; renderThread();
    } catch (e) {}
  }
  function renderThread() {
    var el = $('mbWatek'), w = mb.msg && mb.msg.watek; if (!el || !w || !w.length) return;
    el.innerHTML = '<details class="fold" style="margin:0 0 10px"' + (w.length <= 6 ? ' open' : '') + '><summary>Rozmowa: ' + w.length + ' wiadomości</summary>' + w.map(function (x) {
      return '<div class="frow' + (x.ta ? ' on' : '') + '"' + (x.ta ? '' : ' role="button" tabindex="0" data-wf="' + esc(x.folder) + '" data-wu="' + x.uid + '"') + '><span>' + (x.wyslana ? '↗ ' : '↘ ') + esc(x.wyslana ? 'biuro' : (x.od_nazwa || x.od_adres)) + ' — ' + esc(x.temat || '') + '</span><span class="sub">' + esc(when(x.data)) + '</span></div>';
    }).join('') + '</details>';
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
  function threadGo(e) {
    var r = e.target.closest('[data-wu]'); if (!r || (e.type === 'keydown' && e.key !== 'Enter')) return;
    var f = r.getAttribute('data-wf'), u = Number(r.getAttribute('data-wu'));
    if (f !== mb.folder) { mb.folder = f; mb.page = 1; mb.sel = {}; renderFolders(); openFolder(f, true, true); }
    openMsg(u);
  }
  $('mbMsg').addEventListener('click', threadGo); $('mbMsg').addEventListener('keydown', threadGo);
  $('mbMsg').addEventListener('change', async function (e) { var s = e.target.closest('[data-mmove]'), c = e.target.closest('[data-mcopy]'); if (s && s.value && mb.msg) { if (await akcja('przenies', [mb.msg.uid], s.value)) backToList(); } if (c && c.value && mb.msg) { var cel = c.value; c.value = ''; if (await akcja('kopiuj', [mb.msg.uid], cel)) { var mm = $('mbMsg').querySelector('[data-mmsg]'); if (mm) mm.textContent = 'Skopiowano.'; } } });
  // ---- message tools: files, preview, print, source
  var bytesOf = {};
  async function partBytes(part) { if (!bytesOf[part]) bytesOf[part] = await callFile({ action: 'zalacznik_imap', skrzynka: mb.box, folder: mb.folder, uid: mb.msg.uid, part: part }); return bytesOf[part]; }
  // always saved as a file of an inert type — never opened as a page
  function saveBlob(blob, name) { var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name || 'plik'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 30000); }
  function fname(s, def) { return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 80) || def; }
  // what a file really is — by its first bytes, never by what the message says; only these kinds are ever shown
  function sniff(b) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
    return '';
  }
  async function preview(part, name) {
    var buf = await partBytes(part), type = sniff(new Uint8Array(buf.slice(0, 16)));
    if (!type) throw new Error('Podgląd jest dostępny tylko dla obrazów (PNG, JPG, GIF, WebP) i plików PDF — ten plik pobierz.');
    var url = URL.createObjectURL(new Blob([buf], { type: type }));
    dlg(name, (type === 'application/pdf' ? '<iframe class="prev" src="' + url + '" title="Podgląd pliku PDF"></iframe>' : '<img class="prev" src="' + url + '" alt="" />') +
      '<div class="acts"><button type="button" class="mini" data-dl>⬇ Pobierz plik</button><span class="sub">Podgląd pobranego pliku. Jeśli PDF się nie wyświetla (np. w telefonie) — pobierz go.</span></div>', function () { URL.revokeObjectURL(url); });
    $('dlg_b').querySelector('[data-dl]').addEventListener('click', function () { saveBlob(new Blob([buf], { type: 'application/octet-stream' }), name); });
  }
  var CRC = null;
  function crc32(b) { if (!CRC) { CRC = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } } var crc = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) crc = CRC[(crc ^ b[i]) & 255] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0; }
  // a plain ZIP (files stored as they are) built in the browser from the downloaded attachments
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0, d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.bytes), len = f.bytes.length, h = new DataView(new ArrayBuffer(30)), c = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, len, true); h.setUint32(22, len, true); h.setUint16(26, name.length, true);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, len, true); c.setUint32(24, len, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      parts.push(h.buffer, name, f.bytes); central.push(c.buffer, name); off += 30 + name.length + len;
    });
    var csize = central.reduce(function (s, x) { return s + x.byteLength; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(central, [e.buffer]), { type: 'application/zip' });
  }
  async function downloadAll(msg) {
    var m = mb.msg, list = m.zalaczniki.filter(function (z) { return !z.za_duzy; }), files = [], used = {};
    for (var i = 0; i < list.length; i++) {
      if (msg) msg.textContent = 'Pobieram ' + (i + 1) + ' z ' + list.length + '…';
      var buf = await partBytes(list[i].part), name = fname(list[i].nazwa, 'zalacznik-' + (i + 1)), base = name, n = 1;
      if (mb.msg !== m) return;
      while (used[name.toLowerCase()]) { n++; name = base.replace(/(\.[^.]*)?$/, ' (' + n + ')$1'); }
      used[name.toLowerCase()] = true; files.push({ name: name, bytes: new Uint8Array(buf) });
    }
    saveBlob(zipStore(files), fname(m.temat, 'zalaczniki') + ' — załączniki.zip');
    if (msg) msg.textContent = 'Pobrano ' + files.length + ' plików w jednym archiwum ZIP.';
  }
  // A clean printable page: the same cleaned message under the same Content-Security-Policy, with its headers on top.
  // Only for printing the frame is same-origin (the page must call the frame's own print()) — it still has no
  // allow-scripts, so nothing of the mail can run; it is removed afterwards.
  function printMsg() {
    var m = mb.msg, line = function (k, v) { return v ? '<div><b>' + k + ':</b> ' + esc(v) + '</div>' : ''; };
    var head = '<div style="font:13px/1.5 Arial,Helvetica,sans-serif;color:#111;border-bottom:1px solid #999;margin:0 0 14px;padding:0 0 10px"><div style="font-size:17px;font-weight:bold;margin:0 0 6px">' + esc(m.temat || '(bez tematu)') + '</div>' +
      line('Od', (m.od_nazwa ? m.od_nazwa + ' ' : '') + '<' + (m.od_adres || 'nieznany') + '>') + line('Do', (m.do || []).join(', ')) + line('Data', when(m.data)) + line('Załączniki', m.zalaczniki.map(function (z) { return z.nazwa; }).join(', ')) + '</div>';
    var doc = m.srcdoc && !mb.plain ? (mb.images ? m.srcdoc.replace('img-src data:;', 'img-src data: https:;').replace(/ data-zdalne="/g, ' src="') : m.srcdoc).replace('<body>', '<body>' + head)
      : '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"></head><body style="margin:14px">' + head + '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 Arial,Helvetica,sans-serif;margin:0">' + esc(m.tekst || '') + '</pre></body></html>';
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin allow-modals'); f.setAttribute('aria-hidden', 'true'); f.setAttribute('tabindex', '-1');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0';
    f.onload = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { alert('Nie udało się otworzyć drukowania: ' + e.message); } setTimeout(function () { f.remove(); }, 60000); };
    f.srcdoc = doc; document.body.appendChild(f);
  }
  $('mbMsg').addEventListener('click', async function (e) {
    var part = e.target.closest('[data-part]'), pv = e.target.closest('[data-prev]'), b = e.target.closest('[data-m]'), msg = $('mbMsg').querySelector('[data-mmsg]');
    if (part || pv) {
      var el = part || pv; el.disabled = true;
      try {
        if (pv) await preview(pv.getAttribute('data-prev'), pv.getAttribute('data-name') || 'załącznik');
        else saveBlob(new Blob([await partBytes(part.getAttribute('data-part'))], { type: 'application/octet-stream' }), part.getAttribute('data-name') || 'zalacznik');
      } catch (err) { if (msg) msg.textContent = err.message; }
      el.disabled = false;
      return;
    }
    if (!b) return;
    var act = b.getAttribute('data-m'), m = mb.msg;
    if (act === 'back') return backToList();
    if (act === 'print') return printMsg();
    if (act === 'addc') { e.preventDefault(); return openContacts({ adres: m.od_adres, nazwa: m.od_nazwa }); }
    if (act === 'zip' || act === 'eml' || act === 'src' || act === 'unplan') {
      b.disabled = true;
      try {
        if (act === 'zip') await downloadAll(msg);
        else if (act === 'eml') saveBlob(new Blob([await callFile({ action: 'eml_imap', skrzynka: mb.box, folder: mb.folder, uid: m.uid })], { type: 'application/octet-stream' }), fname(m.temat, 'wiadomosc') + '.eml');
        else if (act === 'src') {
          var zr = await call('poczta', { action: 'zrodlo_imap', skrzynka: mb.box, folder: mb.folder, uid: m.uid });
          if (zr.error) throw new Error(zr.error);
          dlg('Źródło wiadomości', '<p class="sub" style="margin:0 0 8px">Nagłówki i surowa treść jako zwykły tekst' + (zr.obciete ? ' — pokazano początek (' + kb(zr.zrodlo.length) + ' z ' + kb(zr.rozmiar) + '); całość: „Pobierz .eml”' : '') + '.</p><pre class="src cm" id="dlg_src"></pre>');
          $('dlg_src').textContent = zr.zrodlo;
        } else {
          var un = await call('poczta', { action: 'zaplanowane_anuluj', skrzynka: mb.box, id: m.szkic.zaplanowana.id });
          if (un.error) throw new Error(un.error);
          return openMsg(m.uid);
        }
      } catch (err) { if (msg) msg.textContent = err.message; }
      b.disabled = false;
      return;
    }
    if (act === 'view') { mb.plain = !mb.plain; return renderMsg(); }
    if (act === 'tall') { mb.tall = !mb.tall; return renderMsg(); }
    if (act === 'img') { mb.images = true; return renderMsg(); }
    if (act === 'imgalways' || act === 'imgnever') { var l = pref('obrazy', []).filter(function (x) { return x !== m.od_adres; }); if (act === 'imgalways' && m.od_adres) l.push(m.od_adres); setPref('obrazy', l.slice(-300)); mb.images = act === 'imgalways'; return renderMsg(); }
    if (act === 'reply' || act === 'replyall' || act === 'forward') return compose(act);
    if (act === 'edit') {
      if (m.szkic.zaplanowana && !confirm('Ta wiadomość jest zaplanowana na ' + when(m.szkic.zaplanowana.kiedy) + '. Zapisanie zmian wstrzyma wysyłkę — po edycji zaplanuj ją ponownie. Edytować?')) return;
      return compose('draft');
    }
    if (/^(read|unread|flag|unflag|archive|spam|trash)$/.test(act)) return msgAct(act);
    if (act === 'triage') return toTriage(m.analiza.id);
    if (act === 'take' || act === 'note') {
      var note = $('mbMsg').querySelector('[data-note]');
      b.disabled = true;
      try {
        var o2 = await call('poczta', act === 'take' ? { action: 'biore_imap', skrzynka: mb.box, folder: mb.folder, uid: m.uid } : { action: 'notatka_imap', skrzynka: mb.box, folder: mb.folder, uid: m.uid, tekst: note ? note.value : '' });
        if (o2.error) { msg.textContent = o2.error; b.disabled = false; return; }
        if (window.PortalShell && window.PortalShell.refreshTasks) window.PortalShell.refreshTasks();
        return openMsg(m.uid);
      } catch (err) { msg.textContent = err.message; b.disabled = false; }
      return;
    }
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
  // the editor is a white sheet on every theme: the colours a person can choose are declared for it explicitly
  (function () {
    var css = PALETA.map(function (c) { var m = /^#(..)(..)(..)$/.exec(c), rgb = 'rgb(' + [1, 2, 3].map(function (i) { return parseInt(m[i], 16); }).join(', ') + ')'; return ':is(#c_ed,#mg_ed) :is(font[color="' + c + '" i],[style*="color: ' + rgb + '"],[style*="color:' + c + '" i]){color:' + c + '!important}'; }).join('\n');
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  })();
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
      if (t === 'IMG') { var cid = n.getAttribute('data-cid') || (/^cid:(.+)$/.exec(n.getAttribute('src') || '') || [])[1]; if (cid && /^[A-Za-z0-9._-]{1,60}$/.test(cid)) out += '<img src="cid:' + cid + '" alt="">'; return; }
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
    var sum = cmp.files.reduce(function (s, f) { return s + (f.size || 0); }, 0);
    $('c_atts').innerHTML = cmp.files.filter(function (f) { return !f.cid; }).map(function (f) { return '<span class="pill p-grey">' + attIco(f.nazwa) + ' ' + esc(f.nazwa) + ' (' + kb(f.size) + ') <a href="#" data-rmf="' + esc(f.id) + '" aria-label="Usuń załącznik" style="text-decoration:none">×</a></span>'; }).join(' ') +
      (cmp.orig.length ? ' ' + cmp.orig.map(function (z, i) { return '<label class="chk" style="display:inline-flex"><input type="checkbox" data-orig="' + i + '"' + (z.on ? ' checked' : '') + ' /> ' + attIco(z.nazwa) + ' ' + esc(z.nazwa) + '</label>'; }).join(' ') : '') +
      (sum ? ' <span class="sub">razem ' + kb(sum) + ' / 20 MB</span>' : '');
  }
  function b64of(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  async function addFiles(list, inline) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i], sum = cmp.files.reduce(function (s, x) { return s + (x.size || 0); }, 0);
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
    cmp = { box: mb.box || skrzynka, do: [], dw: [], udw: [], files: [], orig: [], mode: mode, odp: null, szkic_id: uuid(), szkic_uid: 0, dirty: false, sending: false, klucz: uuid(), sigs: null, tpls: [] };
    if (mode === 'reply' || mode === 'replyall') { cmp.do = (o.do || []).slice(); if (mode === 'replyall') cmp.dw = (o.dw || []).slice(); cmp.odp = { folder: mb.folder, uid: m.uid, tryb: 'reply' }; }
    if (mode === 'forward') { cmp.odp = { folder: mb.folder, uid: m.uid, tryb: 'forward' }; cmp.orig = m.zalaczniki.filter(function (z) { return !z.za_duzy; }).map(function (z) { return { part: z.part, nazwa: z.nazwa, on: true }; }); }
    if (mode === 'draft') {
      // a draft continues where it was left, on any device: recipients, files and the answered message come from the draft itself
      var sz = m.szkic;
      cmp.do = (sz.do || m.do || []).slice(); cmp.dw = (sz.dw || []).slice(); cmp.udw = (sz.udw || []).slice(); cmp.szkic_id = sz.id; cmp.szkic_uid = m.uid;
      cmp.files = (sz.pliki || []).map(function (p) { return { id: uuid().slice(0, 8), nazwa: p.nazwa, size: p.rozmiar, cid: p.cid || undefined, part: p.part }; });
      if (sz.odp) cmp.odp = { folder: sz.odp.folder, uid: sz.odp.uid, tryb: sz.odp.tryb };
    }
    $('c_from').innerHTML = skrzynki.map(function (s) { return '<option value="' + esc(s.klucz) + '"' + (s.klucz === cmp.box ? ' selected' : '') + '>' + esc(s.adres) + '</option>'; }).join('');
    $('c_from').disabled = !!cmp.odp || mode === 'draft';
    $('c_when_row').hidden = true; $('c_when').value = '';
    $('c_tpl').innerHTML = '<option value="">Szablon…</option>'; $('c_sig').innerHTML = '<option value="">Podpis…</option>';
    $('c_temat').value = mode === 'forward' ? (o.fwd || '') : mode === 'draft' ? (m.temat || '') : cmp.odp ? (o.re || '') : '';
    $('c_title').textContent = { reply: 'Odpowiedź', replyall: 'Odpowiedź do wszystkich', forward: 'Przekazanie wiadomości', draft: 'Szkic' }[mode] || 'Nowa wiadomość';
    $('c_cytat_row').hidden = !cmp.odp; $('c_cytat').checked = true;
    $('c_potw').checked = false; $('c_pilna').checked = false;
    ['do', 'dw', 'udw'].forEach(function (k) { $('c_' + k).value = ''; });
    $('c_ed').innerHTML = mode === 'draft' ? cleanHtml(m.szkic.html) : '<p><br></p>';
    renderChips(); renderAtts(); cMsg(''); $('c_send').disabled = false; $('c_undo').hidden = true;
    $('compose').hidden = false; document.body.style.overflow = 'hidden';
    (cmp.do.length ? $('c_ed') : $('c_do')).focus();
    var c0 = cmp;
    if (mode === 'draft') {
      // pictures placed in the text live in the draft: shown from their downloaded bytes
      [].forEach.call($('c_ed').querySelectorAll('img'), function (img) {
        var cid = (/^cid:(.+)$/.exec(img.getAttribute('src') || '') || [])[1], f = cmp.files.filter(function (x) { return x.cid && x.cid === cid; })[0];
        img.removeAttribute('src'); if (!f) return img.remove();
        img.setAttribute('data-cid', cid); img.style.maxWidth = '100%';
        callFile({ action: 'zalacznik_imap', skrzynka: c0.box, folder: mb.folder, uid: c0.szkic_uid, part: f.part }).then(function (buf) { var t = sniff(new Uint8Array(buf.slice(0, 16))); if (/^image\//.test(t) && cmp === c0) img.src = URL.createObjectURL(new Blob([buf], { type: t })); }).catch(function () {});
      });
    }
    await loadSigs(c0, mode !== 'draft');
    if (cmp === c0) cmp.dirty = false;
    // the draft is kept in the mailbox's Drafts folder (visible from any mail program); attachments are not part of it
    cmp.timer = setInterval(function () { if (cmp && cmp.dirty && !cmp.sending && !cmp.saving) saveDraft(true); }, 20000);
  }
  function payload() {
    ['do', 'dw', 'udw'].forEach(function (k) { if ($('c_' + k).value.trim()) { addAddr(k, $('c_' + k).value); $('c_' + k).value = ''; } });
    return { skrzynka: cmp.box, do: cmp.do, dw: cmp.dw, udw: cmp.udw, temat: $('c_temat').value.trim(), html: serialize($('c_ed')) };
  }
  // The draft is one message in the mailbox's Drafts folder, files included. A file travels from this browser once:
  // on the next save the server takes it from the previous copy of the draft ("zachowaj").
  async function saveDraft(auto) {
    if (!cmp) return false;
    var c = cmp, p = payload(), ok = false; p.action = 'szkic_zapisz'; p.szkic_id = c.szkic_id; p.poprzedni_uid = c.szkic_uid || undefined;
    var kept = c.files.filter(function (f) { return f.part && c.szkic_uid; }), fresh = c.files.filter(function (f) { return !(f.part && c.szkic_uid) && f.b64; });
    p.zachowaj = kept.map(function (f) { return f.part; }); p.zalaczniki = fresh.map(function (f) { return { nazwa: f.nazwa, b64: f.b64, cid: f.cid }; });
    if (c.odp) p.odp = { folder: c.odp.folder, uid: c.odp.uid, tryb: c.odp.tryb };
    c.saving = true; c.dirty = false;
    try {
      var out = await call('poczta', p); if (out.error) throw new Error(out.error);
      c.szkic_uid = out.uid || 0;
      // where each file sits in the new copy
      var order = kept.concat(fresh), plain = order.filter(function (f) { return !f.cid; }), got = (out.pliki || []).filter(function (x) { return !x.cid; });
      order.forEach(function (f) { f.part = null; });
      order.filter(function (f) { return f.cid; }).forEach(function (f) { var h = (out.pliki || []).filter(function (x) { return x.cid === f.cid; })[0]; if (h) f.part = h.part; });
      if (got.length === plain.length) plain.forEach(function (f, i) { f.part = got[i].part; });
      if (cmp === c) cMsg('Szkic zapisany w folderze Robocze ' + new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) + (order.length ? ' (z załącznikami: ' + order.length + ').' : '.') + (out.wysylka_anulowana ? ' Zaplanowana wysyłka tej wiadomości została wstrzymana — zaplanuj ją ponownie.' : ''));
      ok = true;
    } catch (e) { c.dirty = true; if (cmp === c && !auto) cMsg('Nie udało się zapisać szkicu: ' + e.message); }
    c.saving = false;
    return ok;
  }
  // ----- signatures and templates in the compose window
  function setSig(html) {
    var ed = $('c_ed'), old = ed.querySelector('[data-podpis]');
    if (html == null) { if (old) old.remove(); return; }
    if (!old) { old = document.createElement('div'); old.setAttribute('data-podpis', '1'); ed.appendChild(document.createElement('br')); ed.appendChild(old); }
    old.innerHTML = cleanHtml(html);
  }
  async function loadSigs(c, insert) {
    try {
      var r = await Promise.all([call('poczta', { action: 'podpisy', skrzynka: c.box }), call('poczta', { action: 'szablony', skrzynka: c.box })]);
      if (cmp !== c) return;
      c.sigs = r[0]; c.tpls = r[1].szablony || [];
      var def = (c.sigs.lista || []).filter(function (x) { return x.domyslna; })[0];
      $('c_sig').innerHTML = '<option value="">Podpis…</option>' + (c.sigs.lista || []).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.nazwa) + (x.domyslna ? ' (domyślny)' : '') + '</option>'; }).join('') +
        '<option value="_wzor">Wzór z mojego profilu</option><option value="_brak">Bez podpisu</option><option value="_manage">Zarządzaj podpisami…</option>';
      $('c_tpl').innerHTML = '<option value="">Szablon…</option>' + c.tpls.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.nazwa) + '</option>'; }).join('') + '<option value="_manage">Zarządzaj szablonami…</option>';
      if (insert) setSig(def ? def.html : (c.sigs.dawny || c.sigs.wzor));
      $('c_stopka').textContent = c.sigs.stopka ? 'Na końcu zostanie dodana stopka skrzynki: ' + c.sigs.stopka.slice(0, 160) + (c.sigs.stopka.length > 160 ? '…' : '') : '';
    } catch (e) {}
  }
  $('c_sig').addEventListener('change', function () {
    var v = this.value; this.value = ''; if (!cmp || !v || !cmp.sigs) return;
    if (v === '_manage') return openManager();
    var s = (cmp.sigs.lista || []).filter(function (x) { return x.id === v; })[0];
    setSig(v === '_brak' ? null : v === '_wzor' ? cmp.sigs.wzor : s ? s.html : null); cmp.dirty = true;
  });
  // {klient} and {imie} of a template are filled from the first recipient (clients base, saved contacts); what cannot be
  // established stays visible in braces for the person to fill in
  async function applyTpl(t) {
    var c = cmp, adr = c.do[0] || '', dane = { klient: '', imie: '' };
    if (/\{(klient|imie)\}/.test(t.html + (t.temat || '')) && adr) { try { dane = await call('poczta', { action: 'kto_to', skrzynka: c.box, adres: adr }); } catch (e) {} }
    if (cmp !== c) return;
    if (!dane.imie && c.odp && mb.msg && /^[A-ZŻŹĆĄŚĘŁÓŃ][a-zżźćńółęąś]+$/.test((mb.msg.od_nazwa || '').split(' ')[0])) dane.imie = mb.msg.od_nazwa.split(' ')[0];
    var fill = function (s, e) { return s.replace(/\{klient\}/g, dane.klient ? e(dane.klient) : '{klient}').replace(/\{imie\}/g, dane.imie ? e(dane.imie) : '{imie}'); };
    var d = document.createElement('div'), ed = $('c_ed'), first = ed.firstChild;
    d.innerHTML = cleanHtml(fill(t.html, esc));
    if (first && first.nodeName === 'P' && !first.textContent.trim()) ed.removeChild(first);
    while (d.lastChild) ed.insertBefore(d.lastChild, ed.firstChild);
    if (!$('c_temat').value.trim() && t.temat) $('c_temat').value = fill(t.temat, function (x) { return x; });
    c.dirty = true;
    cMsg(/\{(klient|imie)\}/.test(plainOf(ed) + $('c_temat').value) ? 'Uzupełnij pola {klient} / {imie} — nie udało się ich ustalić z adresata' + (adr ? '.' : ' (najpierw wpisz adresata, potem wstaw szablon).') : 'Wstawiono szablon „' + t.nazwa + '”.');
  }
  $('c_tpl').addEventListener('change', function () {
    var v = this.value; this.value = ''; if (!cmp || !v) return;
    if (v === '_manage') return openManager();
    var t = cmp.tpls.filter(function (x) { return x.id === v; })[0]; if (t) applyTpl(t);
  });
  $('c_savetpl').addEventListener('click', async function () {
    if (!cmp) return;
    var copy = $('c_ed').cloneNode(true), sig = copy.querySelector('[data-podpis]'); if (sig) sig.remove();
    var html = serialize(copy), nazwa = (prompt('Nazwa szablonu (pola {klient} i {imie} w treści wypełnią się z adresata):') || '').trim();
    if (!nazwa) return;
    var old = cmp.tpls.filter(function (x) { return x.nazwa.toLowerCase() === nazwa.toLowerCase(); })[0];
    if (old && !confirm('Szablon „' + old.nazwa + '” już istnieje. Zastąpić go?')) return;
    try { var out = await call('poczta', { action: 'szablon_zapisz', skrzynka: cmp.box, id: old ? old.id : undefined, nazwa: nazwa, temat: $('c_temat').value.trim(), html: html }); if (out.error) return cMsg(out.error); cMsg('Szablon zapisany — widzą go wszyscy pracujący na tej skrzynce.'); loadSigs(cmp, false); }
    catch (e) { cMsg(e.message); }
  });
  $('c_book').addEventListener('click', function () { openContacts(); });
  // ----- "Wyślij później": the message waits as a draft in the mailbox; the server sends it at the chosen time
  $('c_later').addEventListener('click', function () {
    var row = $('c_when_row'); row.hidden = !row.hidden;
    if (!row.hidden && !$('c_when').value) { var d = new Date(Date.now() + 86400000), p = function (n) { return ('0' + n).slice(-2); }; $('c_when').value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T08:00'; }
    if (!row.hidden) $('c_when').focus();
  });
  $('c_plan').addEventListener('click', async function () {
    if (!cmp || cmp.sending) return;
    var c = cmp, p = payload(), text = plainOf($('c_ed')), kiedy = ($('c_when').value || '').slice(0, 16);
    if (!p.do.length && !p.dw.length && !p.udw.length) return cMsg('Podaj odbiorcę.');
    if (!p.temat) return cMsg('Podaj temat wiadomości.');
    if (!text && !c.files.length && !(c.odp && c.odp.tryb === 'forward')) return cMsg('Wiadomość jest pusta.');
    if (!kiedy) return cMsg('Podaj datę i godzinę wysyłki.');
    if (/\{(klient|imie)\}/.test(text + p.temat) && !confirm('W wiadomości zostały niewypełnione pola {klient} / {imie}. Zaplanować mimo to?')) return;
    c.sending = true; $('c_send').disabled = true; this.disabled = true; cMsg('Zapisuję wiadomość w folderze Robocze…');
    var done = function (t) { c.sending = false; $('c_send').disabled = false; $('c_plan').disabled = false; if (cmp === c) cMsg(t); };
    try {
      if (!(await saveDraft(false)) || !c.szkic_uid) return done($('c_msg').textContent || 'Nie udało się zapisać szkicu.');
      var body = { action: 'zaplanuj', skrzynka: c.box, szkic_id: c.szkic_id, klucz: c.klucz, kiedy: kiedy, potwierdzenie: $('c_potw').checked, pilna: $('c_pilna').checked, cytat: $('c_cytat').checked };
      if (c.odp) body.odp = { folder: c.odp.folder, uid: c.odp.uid, tryb: c.odp.tryb, czesci: c.orig.filter(function (z) { return z.on; }).map(function (z) { return z.part; }) };
      var out = await call('poczta', body);
      if (out.potwierdz) { if (!confirm(out.pytanie + '\n\n' + out.potwierdz.join('\n') + '\n\nZaplanować mimo to?')) return done('Nie zaplanowano — wiadomość została w folderze Robocze.'); body.potwierdzone = true; out = await call('poczta', body); }
      if (out.error) return done(out.error);
      c.sending = false; $('c_plan').disabled = false; closeCompose();
      alert('Wiadomość zostanie wysłana ' + when(out.kiedy) + '. Do tego czasu czeka w folderze Robocze; listę i anulowanie znajdziesz pod „🕒 Zaplanowane”.');
      if (mb.loaded) { loadFolders(mb.box, true); if (mb.msg) openMsg(mb.msg.uid); else if (mb.folder && !mb.all) openFolder(mb.folder, true, true); }
    } catch (e) { done(e.message); }
  });
  async function reallySend(confirmed) {
    var c = cmp; if (!c) return;
    var p = payload(); p.action = 'wyslij'; p.klucz = c.klucz; p.potwierdzone = !!confirmed; p.potwierdzenie = $('c_potw').checked; p.pilna = $('c_pilna').checked;
    p.zalaczniki = c.files.filter(function (f) { return f.b64; }).map(function (f) { return { nazwa: f.nazwa, b64: f.b64, cid: f.cid }; });
    p.szkic_pliki = c.files.filter(function (f) { return !f.b64 && f.part; }).map(function (f) { return f.part; });
    if (c.odp) { p.odp = { folder: c.odp.folder, uid: c.odp.uid, tryb: c.odp.tryb, czesci: c.orig.filter(function (z) { return z.on; }).map(function (z) { return z.part; }) }; p.cytat = $('c_cytat').checked; }
    if (c.szkic_uid) { p.szkic_id = c.szkic_id; p.szkic_uid = c.szkic_uid; }
    if (c.files.some(function (f) { return !f.b64 && !f.part; })) { c.sending = false; $('c_send').disabled = false; return cMsg('Jednego z załączników nie udało się odczytać ze szkicu — usuń go i dodaj ponownie.'); }
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
    if (/\{(klient|imie)\}/.test(text + p.temat) && !confirm('W wiadomości zostały niewypełnione pola {klient} / {imie}. Wysłać mimo to?')) return;
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
  $('c_from').addEventListener('change', function () { if (cmp) { cmp.box = this.value; loadSigs(cmp, true); } });

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
      var ex = e.target.closest('[data-exp]');
      if (ex) { if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); var w = ex.getAttribute('data-exp'); mb.exp[w] = !mb.exp[w]; renderRows(); var again = document.querySelector('[data-exp="' + w.replace(/[^0-9a-f]/g, '') + '"]'); if (again) again.focus(); } return; }
      var r = e.target.closest(sel); if (!r) return;
      if (e.type === 'click' || e.key === 'Enter') { e.preventDefault(); return fn(r.getAttribute(attr), r); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { var n = e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling; while (n && !n.matches(sel)) n = e.key === 'ArrowDown' ? n.nextElementSibling : n.previousElementSibling; if (n) { e.preventDefault(); n.focus(); } }
      if (e.key === 'x' && attr === 'data-u') { var u = r.getAttribute('data-u'); mb.sel[u] = !mb.sel[u]; var cb = r.querySelector('[data-sel]'); if (cb) cb.checked = !!mb.sel[u]; renderBulk(); }
    };
  }
  var onFolder = rowKeys('[data-f]', 'data-f', function (id) { openFolder(id); }), onRow = rowKeys('[data-u]', 'data-u', function (u, r) { openMsg(Number(u), r.getAttribute('data-uf') || undefined); });
  $('mbTree').addEventListener('click', onFolder); $('mbTree').addEventListener('keydown', onFolder);
  $('mbRows').addEventListener('click', onRow); $('mbRows').addEventListener('keydown', onRow);
  $('mbRows').addEventListener('change', function (e) { var c = e.target.closest('[data-sel]'); if (c) { mb.sel[c.getAttribute('data-sel')] = c.checked; renderBulk(); } });
  $('mbBox').addEventListener('change', function () { loadFolders(this.value); });
  $('mbToFolders').addEventListener('click', function () { ekran('foldery'); });
  function search() { mb.page = 1; mb.sel = {}; if ($('mbAll').checked) return searchAll(); if (mb.folder) openFolder(mb.folder); }
  $('mbGo').addEventListener('click', search);
  $('mbQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
  $('mbClear').addEventListener('click', function () { $('mbQ').value = ''; $('mbOd').value = ''; $('mbDo').value = ''; ['mbNew', 'mbAtt', 'mbStar', 'mbBody2', 'mbAll'].forEach(function (i) { $(i).checked = false; }); search(); });
  $('mbConv').checked = pref('rozmowy', true);
  $('mbConv').addEventListener('change', function () { setPref('rozmowy', this.checked); mb.exp = {}; renderRows(); });
  $('mbAhead').checked = pref('wstepnie', true);
  $('mbAhead').addEventListener('change', function () { setPref('wstepnie', this.checked); });
  $('mbPrev').addEventListener('click', function () { if (mb.page > 1) { mb.page--; openFolder(mb.folder); } });
  $('mbNext').addEventListener('click', function () { mb.page++; openFolder(mb.folder); });
  $('mbRead').checked = pref('czytaj', true);
  $('mbRead').addEventListener('change', function () { setPref('czytaj', this.checked); });
  $('mbHelp').addEventListener('click', function () { $('mbKeys').hidden = !$('mbKeys').hidden; });
  document.addEventListener('keydown', function (e) {
    if ($('vSkrzynka').hidden || cmp || !$('dlg').hidden || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable) return;
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
      if (changed && !mb.msg && !mb.all && mb.page === 1 && !hasFilters() && !selected().length) openFolder(mb.folder, true, true);
    } catch (e) {}
  }, 60000);
  // ---------------- dialogs: contacts, signatures and templates, scheduled messages, preview, source ----------------
  var dlgClose = null, dlgReturn = null;
  function dlg(title, html, onClose) {
    if (!$('dlg').hidden) closeDlg();
    dlgReturn = document.activeElement; dlgClose = onClose || null;
    $('dlg_t').textContent = title; $('dlg_b').innerHTML = html; $('dlg').hidden = false; document.body.style.overflow = 'hidden'; $('dlg_x').focus();
  }
  function closeDlg() {
    if ($('dlg').hidden) return;
    $('dlg').hidden = true; $('dlg_b').innerHTML = ''; if (!cmp) document.body.style.overflow = '';
    var f = dlgClose; dlgClose = null; if (f) f();
    if (dlgReturn && dlgReturn.focus && document.contains(dlgReturn)) dlgReturn.focus();
  }
  $('dlg_x').addEventListener('click', closeDlg);
  $('dlg').addEventListener('mousedown', function (e) { if (e.target === $('dlg')) closeDlg(); });
  $('dlg').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); return closeDlg(); }
    if (e.key !== 'Tab') return;
    var f = [].filter.call($('dlg').querySelectorAll('button,[href],input,select,textarea,[contenteditable],[tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  function dMsg(t) { var m = $('dlg_b').querySelector('[data-dmsg]'); if (m) m.textContent = t || ''; }
  // text pasted into a small editor of a dialog goes through the same allow-list as in the compose window
  function miniPaste(e) { var cd = e.clipboardData; if (!cd) return; e.preventDefault(); var h = cd.getData('text/html'), t = cd.getData('text/plain'); document.execCommand('insertHTML', false, h ? cleanHtml(h) : esc(t).replace(/\n/g, '<br>')); }

  // ----- the address book of the mailbox
  var kb2 = { q: '', edit: null };
  async function openContacts(seed) {
    var box = cmp ? cmp.box : (mb.box || skrzynka), adres = (skrzynki.filter(function (s) { return s.klucz === box; })[0] || {}).adres || box;
    kb2 = { q: '', edit: null, box: box };
    dlg('Kontakty — ' + adres, '<p class="sub" style="margin:0 0 10px">Wspólna książka adresowa tej skrzynki. Zapisany adres nie wymaga potwierdzenia przy pierwszej wiadomości i podpowiada się w polu „Do”.</p>' +
      '<div class="kgrid"><div><label for="k_adres">Adres e-mail</label><input type="text" id="k_adres" maxlength="254" autocomplete="off" /></div><div><label for="k_nazwa">Imię i nazwisko</label><input type="text" id="k_nazwa" maxlength="120" /></div>' +
      '<div><label for="k_firma">Firma</label><input type="text" id="k_firma" maxlength="160" /></div><div><label for="k_not">Notatka</label><input type="text" id="k_not" maxlength="300" /></div><button type="button" class="mini ok" id="k_save">Zapisz kontakt</button></div>' +
      '<div class="acts" style="margin:0 0 10px"><input type="text" id="k_q" maxlength="60" placeholder="Szukaj: nazwisko, firma, adres…" style="flex:1;min-width:180px" aria-label="Szukaj w kontaktach" /><span class="sub" data-dmsg role="status"></span></div><div id="k_list"><div class="empty">Ładowanie…</div></div>');
    if (seed) { $('k_adres').value = seed.adres || ''; $('k_nazwa').value = seed.nazwa || ''; }
    var t = null;
    $('k_q').addEventListener('input', function () { clearTimeout(t); var v = this.value.trim(); t = setTimeout(function () { kb2.q = v; loadContacts(); }, 250); });
    $('k_save').addEventListener('click', async function () {
      try {
        var out = await call('poczta', { action: 'kontakt_zapisz', skrzynka: kb2.box, id: kb2.edit || undefined, adres: $('k_adres').value, nazwa: $('k_nazwa').value, firma: $('k_firma').value, notatka: $('k_not').value });
        if (out.error) return dMsg(out.error);
        kb2.edit = null; ['k_adres', 'k_nazwa', 'k_firma', 'k_not'].forEach(function (i) { $(i).value = ''; }); $('k_save').textContent = 'Zapisz kontakt'; dMsg('Zapisano.'); loadContacts();
      } catch (e) { dMsg(e.message); }
    });
    $('k_list').addEventListener('click', async function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      var act = b.getAttribute('data-k'), row = b.closest('[data-kid]'), d = row ? JSON.parse(row.getAttribute('data-kd')) : {};
      if (act === 'pisz') { closeDlg(); if (cmp) { addAddr('do', d.adres); } else { await compose('new'); if (cmp) addAddr('do', d.adres); } return; }
      if (act === 'edytuj') { kb2.edit = d.id; $('k_adres').value = d.adres; $('k_nazwa').value = d.nazwa || ''; $('k_firma').value = d.firma || ''; $('k_not').value = d.notatka || ''; $('k_save').textContent = 'Zapisz zmiany'; return $('k_nazwa').focus(); }
      if (act === 'dodaj') { $('k_adres').value = d.adres; $('k_nazwa').value = d.nazwa || ''; $('k_firma').value = d.firma || ''; kb2.edit = null; return $('k_save').click(); }
      if (act === 'usun') { if (!confirm('Usunąć kontakt ' + d.adres + '?')) return; try { var out = await call('poczta', { action: 'kontakt_usun', skrzynka: kb2.box, id: d.id }); if (out.error) return dMsg(out.error); loadContacts(); } catch (er) { dMsg(er.message); } }
    });
    loadContacts();
  }
  async function loadContacts() {
    var el = $('k_list'); if (!el) return;
    try {
      var out = await call('poczta', { action: 'kontakty', skrzynka: kb2.box, q: kb2.q, zrodla: true });
      if (!$('k_list')) return;
      if (out.error) throw new Error(out.error);
      var row = function (k, saved) {
        return '<div class="krow" data-kid="' + esc(k.id || '') + '" data-kd="' + esc(JSON.stringify(k)) + '"><span><b>' + esc(k.nazwa || k.adres) + '</b>' + (k.firma ? ' · ' + esc(k.firma) : '') + '<br><span class="sub">' + esc(k.adres) + (k.notatka ? ' · ' + esc(k.notatka) : '') + (k.zrodlo ? ' · ' + esc(k.zrodlo) : '') + '</span></span>' +
          '<span class="acts" style="margin:0"><button type="button" class="mini" data-k="pisz">' + (cmp ? 'Dodaj do „Do”' : '✏️ Napisz') + '</button>' + (saved ? '<button type="button" class="mini" data-k="edytuj">Edytuj</button><button type="button" class="mini" data-k="usun">Usuń</button>' : '<button type="button" class="mini" data-k="dodaj">＋ Zapisz</button>') + '</span></div>';
      };
      el.innerHTML = (out.kontakty.length ? out.kontakty.map(function (k) { return row(k, true); }).join('') : '<div class="empty">' + (kb2.q ? 'Brak zapisanych kontaktów pasujących do „' + esc(kb2.q) + '”.' : 'Nie ma jeszcze zapisanych kontaktów.') + '</div>') +
        (out.propozycje.length ? '<h3 style="margin:14px 0 4px">Podpowiedzi — z bazy klientów i korespondencji</h3>' + out.propozycje.map(function (k) { return row(k, false); }).join('') : '') +
        '<p class="sub" style="margin:10px 0 0">Zapisanych kontaktów: ' + out.razem + '.</p>';
    } catch (e) { mbErr(el, e); }
  }
  $('mbContacts').addEventListener('click', function () { openContacts(); });

  // ----- my signatures and the templates of the mailbox
  var mg = { box: '', sigs: null, tpls: [], edit: null };
  async function openManager() {
    mg = { box: cmp ? cmp.box : (mb.box || skrzynka), sigs: null, tpls: [], edit: null };
    var adres = (skrzynki.filter(function (s) { return s.klucz === mg.box; })[0] || {}).adres || mg.box;
    dlg('Podpisy i szablony — ' + adres, '<div id="mg_list"><div class="empty">Ładowanie…</div></div>' +
      '<div id="mg_edit" hidden><h3 id="mg_h" style="margin:14px 0 8px"></h3><div class="set" style="grid-template-columns:1fr 1.6fr"><div><label for="mg_nazwa">Nazwa</label><input type="text" id="mg_nazwa" maxlength="80" /></div><div id="mg_temat_w"><label for="mg_temat">Temat (opcjonalnie)</label><input type="text" id="mg_temat" maxlength="250" /></div></div>' +
      '<div class="editor small" id="mg_ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Treść"></div>' +
      '<p class="sub" id="mg_hint" style="margin:6px 0 0"></p>' +
      '<div class="acts"><label class="chk" id="mg_def_w"><input type="checkbox" id="mg_def" /> domyślny dla tej skrzynki</label><button type="button" class="mini ok" id="mg_save">Zapisz</button><button type="button" class="mini" id="mg_cancel">Anuluj</button></div></div>' +
      '<p class="sub" data-dmsg role="status" style="margin:8px 0 0"></p>', function () { if (cmp) loadSigs(cmp, false); });
    $('mg_ed').addEventListener('paste', miniPaste);
    $('mg_cancel').addEventListener('click', function () { $('mg_edit').hidden = true; mg.edit = null; });
    $('mg_save').addEventListener('click', async function () {
      var e = mg.edit; if (!e) return;
      try {
        var out = await call('poczta', e.typ === 'podpis' ? { action: 'podpis_zapisz', skrzynka: mg.box, id: e.id || undefined, nazwa: $('mg_nazwa').value, html: serialize($('mg_ed')), domyslna: $('mg_def').checked }
          : { action: 'szablon_zapisz', skrzynka: mg.box, id: e.id || undefined, nazwa: $('mg_nazwa').value, temat: $('mg_temat').value, html: serialize($('mg_ed')) });
        if (out.error) return dMsg(out.error);
        $('mg_edit').hidden = true; mg.edit = null; dMsg('Zapisano.'); loadManager();
      } catch (er) { dMsg(er.message); }
    });
    $('mg_list').addEventListener('click', async function (ev) {
      var b = ev.target.closest('[data-g]'); if (!b) return;
      var act = b.getAttribute('data-g'), typ = b.getAttribute('data-t'), id = b.getAttribute('data-id') || null;
      var item = (typ === 'podpis' ? mg.sigs.lista : mg.tpls).filter(function (x) { return x.id === id; })[0];
      if (act === 'usun') {
        if (!confirm('Usunąć ' + (typ === 'podpis' ? 'podpis' : 'szablon') + ' „' + item.nazwa + '”?')) return;
        try { var out = await call('poczta', { action: typ === 'podpis' ? 'podpis_usun' : 'szablon_usun', skrzynka: mg.box, id: id }); if (out.error) return dMsg(out.error); loadManager(); } catch (er) { dMsg(er.message); }
        return;
      }
      mg.edit = { typ: typ, id: id };
      $('mg_edit').hidden = false; $('mg_temat_w').hidden = typ === 'podpis'; $('mg_def_w').hidden = typ !== 'podpis';
      $('mg_h').textContent = (id ? 'Edycja: ' : 'Nowy ') + (typ === 'podpis' ? 'podpis' : 'szablon');
      $('mg_nazwa').value = item ? item.nazwa : ''; $('mg_temat').value = item ? item.temat || '' : ''; $('mg_def').checked = item ? !!item.domyslna : typ === 'podpis' && !mg.sigs.lista.length;
      $('mg_ed').innerHTML = cleanHtml(item ? item.html : typ === 'podpis' ? (mg.sigs.dawny || mg.sigs.wzor) : '<p>Dzień dobry {imie},</p><p><br></p>');
      $('mg_hint').textContent = typ === 'podpis' ? 'Wzór bierze imię i nazwisko, stanowisko i telefon z Twojego profilu pracownika (strona zespołu). Obowiązkową stopkę skrzynki ustawia administrator — dodaje się sama.' : 'Pola {klient} i {imie} wypełnią się przy wstawianiu — z bazy klientów albo kontaktów, według pierwszego adresata. Szablon widzą wszyscy pracujący na tej skrzynce.';
      $('mg_nazwa').focus();
    });
    loadManager();
  }
  async function loadManager() {
    var el = $('mg_list'); if (!el) return;
    try {
      var r = await Promise.all([call('poczta', { action: 'podpisy', skrzynka: mg.box }), call('poczta', { action: 'szablony', skrzynka: mg.box })]);
      if (!$('mg_list')) return;
      mg.sigs = r[0]; mg.tpls = r[1].szablony || [];
      var p = mg.sigs.profil || {}, line = function (typ, x, extra) { return '<div class="krow"><span><b>' + esc(x.nazwa) + '</b>' + extra + '</span><span class="acts" style="margin:0"><button type="button" class="mini" data-g="edytuj" data-t="' + typ + '" data-id="' + esc(x.id) + '">Edytuj</button><button type="button" class="mini" data-g="usun" data-t="' + typ + '" data-id="' + esc(x.id) + '">Usuń</button></span></div>'; };
      el.innerHTML = '<h3 style="margin:0 0 4px">Moje podpisy</h3>' +
        (mg.sigs.lista.length ? mg.sigs.lista.map(function (x) { return line('podpis', x, x.domyslna ? ' <span class="pill p-ok">domyślny dla tej skrzynki</span>' : ''); }).join('') : '<p class="sub" style="margin:0 0 6px">Nie masz jeszcze zapisanego podpisu — do wiadomości wstawiany jest wzór z profilu' + (p.imie ? ' (' + esc(p.imie) + (p.stanowisko ? ', ' + esc(p.stanowisko) : '') + (p.telefon ? ', tel. ' + esc(p.telefon) : '') + ')' : ' (profil pracownika nie ma jeszcze imienia i stanowiska)') + '.</p>') +
        '<div class="acts"><button type="button" class="mini" data-g="nowy" data-t="podpis">＋ Nowy podpis</button></div>' +
        '<h3 style="margin:16px 0 4px">Szablony odpowiedzi tej skrzynki</h3>' +
        (mg.tpls.length ? mg.tpls.map(function (x) { return line('szablon', x, (x.temat ? ' · ' + esc(x.temat) : '') + ' <span class="sub">· ' + esc(who(x.kto)) + ', ' + esc(when(x.kiedy)) + '</span>'); }).join('') : '<p class="sub" style="margin:0 0 6px">Brak szablonów. Szablon można też zapisać z okna pisania („Zapisz treść jako szablon”).</p>') +
        '<div class="acts"><button type="button" class="mini" data-g="nowy" data-t="szablon">＋ Nowy szablon</button></div>';
    } catch (e) { mbErr(el, e); }
  }
  $('mbSigs').addEventListener('click', openManager);

  // ----- scheduled messages of the mailbox
  var STAN = { czeka: 'czeka', wysylanie: 'w trakcie wysyłki — sprawdź folder Wysłane', wyslano: 'wysłano', blad: 'NIE wysłano', anulowano: 'anulowano' };
  async function openQueue() {
    var box = mb.box || skrzynka;
    dlg('Zaplanowane wiadomości — ' + ((skrzynki.filter(function (s) { return s.klucz === box; })[0] || {}).adres || box), '<p class="sub" style="margin:0 0 10px">Wiadomość czeka w folderze Robocze i wychodzi o wybranej porze (serwer sprawdza kolejkę co kilka minut), z tymi samymi limitami i wpisem w dzienniku wysyłek co zwykła wysyłka. Zmiana szkicu wstrzymuje wysyłkę.</p><div id="q_list"><div class="empty">Ładowanie…</div></div><p class="sub" data-dmsg role="status" style="margin:8px 0 0"></p>');
    var load = async function () {
      try {
        var out = await call('poczta', { action: 'zaplanowane', skrzynka: box });
        if (!$('q_list')) return;
        if (out.error) throw new Error(out.error);
        $('q_list').innerHTML = out.zaplanowane.length ? out.zaplanowane.map(function (r) {
          return '<div class="krow"><span><b>' + esc(when(r.kiedy)) + '</b> · ' + esc(r.temat || '(bez tematu)') + '<br><span class="sub">do: ' + esc((r.odbiorcy || []).join(', ')) + ' · zaplanował(a): ' + esc(who(r.kto)) + '</span></span>' +
            '<span class="acts" style="margin:0"><span class="pill ' + ({ czeka: 'p-amber', wyslano: 'p-ok', blad: 'p-red', wysylanie: 'p-red' }[r.stan] || 'p-grey') + '">' + esc(STAN[r.stan] || r.stan) + '</span>' + (r.stan === 'czeka' && (r.moje || admin) ? '<button type="button" class="mini" data-qx="' + esc(r.id) + '">Anuluj wysyłkę</button>' : '') + '</span>' +
            (r.blad && r.stan !== 'wyslano' ? '<span class="sub" style="grid-column:1/-1">' + esc(r.blad) + '</span>' : '') + '</div>';
        }).join('') : '<div class="empty">Brak zaplanowanych wiadomości.</div>';
      } catch (e) { if ($('q_list')) mbErr($('q_list'), e); }
    };
    $('q_list').addEventListener('click', async function (e) {
      var b = e.target.closest('[data-qx]'); if (!b || !confirm('Anulować wysyłkę? Wiadomość zostanie w folderze Robocze.')) return;
      b.disabled = true;
      try { var out = await call('poczta', { action: 'zaplanowane_anuluj', skrzynka: box, id: b.getAttribute('data-qx') }); dMsg(out.error || 'Anulowano.'); } catch (er) { dMsg(er.message); }
      load();
    });
    load();
  }
  $('mbQueue').addEventListener('click', openQueue);

  // ----- new mail: the tab title, an optional desktop notification (asked for by a click), the badge of the top bar
  var seen = {};
  $('mbNotify').checked = pref('powiadomienia', false) && !!window.Notification && Notification.permission === 'granted';
  $('mbNotify').addEventListener('change', function () {
    var box = this;
    if (!box.checked) return setPref('powiadomienia', false);
    if (!window.Notification) { box.checked = false; return alert('Ta przeglądarka nie obsługuje powiadomień na pulpicie.'); }
    Notification.requestPermission().then(function (p) { var ok = p === 'granted'; box.checked = ok; setPref('powiadomienia', ok); if (!ok) alert('Przeglądarka nie zezwoliła na powiadomienia dla portalu — zmień to w ustawieniach witryny (ikona kłódki przy adresie).'); });
  });
  async function mailPoll() {
    if (!skrzynki.length) return;
    try {
      var out = await call('poczta', { action: 'nieprzeczytane' });
      document.title = (out.razem ? '(' + out.razem + ') ' : '') + 'Poczta — TD Consulting Group';
      Object.keys(out.skrzynki || {}).forEach(function (k) {
        var s = out.skrzynki[k];
        // no sender and no subject on the desktop: only that something came
        if (seen[k] != null && s.uidnext > seen[k] && s.nieprzeczytane > 0 && pref('powiadomienia', false) && window.Notification && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
          var n = new Notification('Nowa poczta — ' + s.adres, { body: 'Nieprzeczytane w Odebranych: ' + s.nieprzeczytane, tag: 'tdcg-poczta-' + k });
          n.onclick = function () { window.focus(); n.close(); };
        }
        seen[k] = s.uidnext;
      });
    } catch (e) {}
  }
  setInterval(mailPoll, 120000); setTimeout(mailPoll, 8000);

  function show(v) {
    $('vAnaliza').hidden = v !== 'analiza'; $('vSkrzynka').hidden = v !== 'skrzynka';
    document.querySelectorAll('#views [data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
    if (v === 'skrzynka' && !mb.loaded && skrzynki.length) loadFolders(skrzynka);
  }
  $('views').addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (b) show(b.getAttribute('data-v')); });
  $('logShow').addEventListener('click', async function () {
    this.disabled = true;
    try {
      var out = await call('poczta', { action: 'dziennik' }), CO = { otwarcie: 'otwarcie wiadomości', zalacznik: 'pobranie załącznika', analiza: 'analiza na żądanie', zmiana: 'zmiana', wstepne: 'wczytanie z wyprzedzeniem' };
      $('logRows').innerHTML = out.dziennik.length ? '<table style="width:100%;font-size:13px;border-collapse:collapse"><tr><th align="left">Kiedy</th><th align="left">Kto</th><th align="left">Co</th><th align="left">Skrzynka / folder</th><th align="left">Nr</th></tr>' +
        out.dziennik.map(function (r) { return '<tr><td>' + esc(when(r.at)) + '</td><td>' + esc(who(r.kto)) + '</td><td>' + esc(CO[r.akcja] || r.akcja) + (r.szczegoly ? ': ' + esc(r.szczegoly) : '') + (r.czesc ? ' (' + (r.czesc === '0' ? 'cała wiadomość .eml' : 'część ' + esc(r.czesc)) + ', ' + kb(r.rozmiar) + ')' : '') + '</td><td>' + esc(r.skrzynka) + ' / ' + esc(r.folder || '') + '</td><td>' + esc(r.uid) + '</td></tr>'; }).join('') + '</table>'
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
        '<div class="acts" style="margin:0 0 8px"><b style="font-size:13px">Foldery używane przez portal</b><button type="button" class="mini" data-fload="' + k + '">Wczytaj foldery skrzynki</button><span class="sub">bez wyboru portal używa folderu z najnowszą wiadomością</span></div><div class="set4" data-fsel="' + k + '" style="grid-template-columns:repeat(5,1fr)"></div>' +
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
    u.foldery = u.foldery || {};
    document.querySelectorAll('[data-fol]').forEach(function (x) { var p = x.getAttribute('data-fol').split(':'); u.foldery[p[0]] = u.foldery[p[0]] || {}; u.foldery[p[0]][p[1]] = x.value; });
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
    var fl = e.target.closest('[data-fload]');
    if (fl) {
      var kk = fl.getAttribute('data-fload'), box = document.querySelector('[data-fsel="' + kk + '"]');
      fl.disabled = true; box.innerHTML = '<span class="sub">Ładowanie…</span>';
      try {
        var fo = await call('poczta', { action: 'foldery', skrzynka: kk, szczegoly: true }), cur = (st.ustawienia.foldery || {})[kk] || {};
        var NAZ = { sent: 'Wysłane', drafts: 'Robocze', trash: 'Kosz', junk: 'Spam', archive: 'Archiwum' };
        box.innerHTML = Object.keys(NAZ).map(function (t) {
          var c = fo.foldery.filter(function (f) { return f.typ === t && f.wybieralny; });
          return '<div><label>' + NAZ[t] + '</label><select data-fol="' + kk + ':' + t + '"><option value="">' + (c.length ? 'automatycznie' + (fo.uzywane[t] && !cur[t] ? ' (' + esc((c.filter(function (f) { return f.id === fo.uzywane[t]; })[0] || {}).nazwa || '') + ')' : '') : '— brak takiego folderu —') + '</option>' +
            c.map(function (f) { return '<option value="' + esc(f.id) + '"' + (cur[t] === f.id ? ' selected' : '') + '>' + esc(f.nazwa) + ' · ' + (f.wiadomosci == null ? '?' : f.wiadomosci) + ' wiad.' + (f.ostatnia ? ' · ostatnia ' + esc(new Date(f.ostatnia).toLocaleDateString('pl-PL')) : '') + '</option>'; }).join('') + '</select></div>';
        }).join('');
      } catch (er) { box.innerHTML = '<span class="sub">' + esc(er.message) + '</span>'; }
      fl.disabled = false;
      return;
    }
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
