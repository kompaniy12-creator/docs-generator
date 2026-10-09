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

  // ---------------- mailbox browser (read-only) ----------------
  var mb = { box: '', folders: [], folder: '', page: 1, total: 0, rows: [], msg: null, loaded: false, images: false, html: false };
  var FOLD = { inbox: '📥 Odebrane', sent: '📤 Wysłane', drafts: '📝 Robocze', trash: '🗑 Kosz', junk: '🚫 Spam', archive: '🗄 Archiwum' };
  function ekran(e) { $('mb').setAttribute('data-ekran', e); }
  function mbErr(el, e) { el.innerHTML = '<div class="empty">' + esc(e && e.message ? e.message : e) + '</div>'; }
  async function callFile(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(BASE + 'poczta', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    if ((res.headers.get('content-type') || '').indexOf('application/json') >= 0) { var j = await res.json().catch(function () { return {}; }); throw new Error(j.error || ('Błąd ' + res.status)); }
    if (!res.ok) throw new Error('Błąd ' + res.status);
    return await res.arrayBuffer();
  }
  function renderFolders() {
    $('mbBox').innerHTML = skrzynki.map(function (s) { return '<option value="' + esc(s.klucz) + '"' + (s.klucz === mb.box ? ' selected' : '') + '>' + esc(s.adres) + '</option>'; }).join('');
    $('mbTree').innerHTML = mb.folders.length ? mb.folders.map(function (f) {
      var name = f.poziom === 0 && FOLD[f.typ] && f.typ === 'inbox' ? FOLD.inbox : (FOLD[f.typ] ? FOLD[f.typ].split(' ')[0] + ' ' : '') + f.nazwa;
      return '<div class="frow' + (f.id === mb.folder ? ' on' : '') + (f.wybieralny ? '' : ' off') + '"' + (f.wybieralny ? ' role="button" tabindex="0" data-f="' + esc(f.id) + '"' : '') + ' style="margin-left:' + Math.min(4, f.poziom) * 12 + 'px" title="' + esc(f.sciezka) + '">' +
        '<span>' + esc(name) + '</span>' + (f.wybieralny ? '<span class="sub">' + (f.nieprzeczytane ? '<b>' + f.nieprzeczytane + '</b> / ' : '') + (f.wiadomosci == null ? '' : f.wiadomosci) + '</span>' : '') + '</div>';
    }).join('') : '<div class="sub">Brak folderów.</div>';
  }
  async function loadFolders(box) {
    mb.box = box || mb.box || skrzynka; mb.folders = []; mb.folder = ''; mb.rows = []; mb.msg = null;
    $('mbTree').innerHTML = '<div class="sub">Ładowanie…</div>'; $('mbRows').innerHTML = ''; $('mbMsg').hidden = true; $('mbList').hidden = false;
    try {
      var out = await call('poczta', { action: 'foldery', skrzynka: mb.box });
      if (out.error) throw new Error(out.error);
      mb.folders = out.foldery; mb.loaded = true;
      renderFolders();
      var inbox = mb.folders.filter(function (f) { return f.typ === 'inbox'; })[0];
      if (inbox) await openFolder(inbox.id, true);
    } catch (e) { renderFolders(); mbErr($('mbTree'), e); }
  }
  function filters() { return { szukaj: $('mbQ').value.trim() || undefined, od: $('mbOd').value || undefined, do: $('mbDo').value || undefined, nieprzeczytane: $('mbNew').checked || undefined, zalaczniki: $('mbAtt').checked || undefined }; }
  function renderRows(info) {
    var f = mb.folders.filter(function (x) { return x.id === mb.folder; })[0] || {};
    $('mbTitle').textContent = f.sciezka || '';
    var sent = f.typ === 'sent' || f.typ === 'drafts';
    $('mbRows').innerHTML = mb.rows.length ? mb.rows.map(function (r) {
      var kto = sent ? 'Do: ' + (r.do || []).join(', ') : (r.od_nazwa || r.od_adres || '(nieznany nadawca)');
      return '<div class="row' + (r.przeczytana ? '' : ' new') + '" role="button" tabindex="0" data-u="' + r.uid + '"><span class="who">' + esc(kto) + '</span><span class="d">' + (r.zalaczniki ? '📎 ' : '') + (r.odpowiedziano ? '↩ ' : '') + (r.oflagowana ? '⚑ ' : '') + esc(when(r.data)) + '</span>' +
        '<span class="subj">' + esc(r.temat || '(bez tematu)') + '</span></div>';
    }).join('') : '<div class="empty">Brak wiadomości w tym widoku.</div>';
    var pages = Math.max(1, Math.ceil(mb.total / 30));
    $('mbInfo').textContent = 'Strona ' + mb.page + ' z ' + pages + ' · wiadomości: ' + mb.total + (info && info.przeszukano != null ? ' (z załącznikami wśród ' + info.przeszukano + ' najnowszych pasujących)' : '');
    $('mbPrev').disabled = mb.page <= 1; $('mbNext').disabled = mb.page >= pages;
  }
  async function openFolder(id, quiet) {
    if (id !== mb.folder) mb.page = 1;
    mb.folder = id; mb.msg = null; renderFolders();
    $('mbMsg').hidden = true; $('mbList').hidden = false; if (!quiet) ekran('lista');
    $('mbRows').innerHTML = '<div class="empty">Ładowanie…</div>';
    try {
      var body = filters(); body.action = 'lista_imap'; body.skrzynka = mb.box; body.folder = id; body.strona = mb.page;
      var out = await call('poczta', body);
      if (out.error) throw new Error(out.error);
      mb.rows = out.wiadomosci; mb.total = out.razem;
      renderRows(out);
    } catch (e) { mbErr($('mbRows'), e); $('mbInfo').textContent = ''; }
  }
  function frame(srcdoc) {
    // the mail's HTML never enters this page: it lives in a frame that can run no script and has no access to the portal
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('title', 'Treść wiadomości');
    f.className = 'paper';
    f.srcdoc = srcdoc;
    return f;
  }
  function renderMsg() {
    var m = mb.msg, a = m.analiza, el = $('mbMsg');
    el.innerHTML = '<div class="acts" style="margin:0 0 10px"><button type="button" class="mini" data-m="back">← Lista</button>' +
        (m.srcdoc ? '<button type="button" class="mini" data-m="view">' + (mb.html ? 'Widok tekstowy' : 'Widok HTML') + '</button>' : '') +
        (m.srcdoc && mb.html && m.zdalne && !mb.images ? '<button type="button" class="mini" data-m="img">Pokaż obrazy z internetu (' + m.zdalne + ')</button>' : '') + '</div>' +
      '<div class="mhead"><h2>' + esc(m.temat || '(bez tematu)') + '</h2>' +
        '<p><b>Od:</b> ' + esc(m.od_nazwa || '') + ' &lt;' + esc(m.od_adres || 'nieznany') + '&gt;</p>' +
        '<p><b>Do:</b> ' + esc((m.do || []).join(', ')) + '</p><p class="sub">' + esc(when(m.data)) + ' · ' + kb(m.rozmiar) + (m.przeczytana ? '' : ' · w skrzynce nadal jako nieprzeczytana') + '</p></div>' +
      (m.zalaczniki.length ? '<div class="atts">' + m.zalaczniki.map(function (z) {
        return z.za_duzy ? '<span class="pill p-grey" title="Ponad 20 MB — otwórz w programie pocztowym">📎 ' + esc(z.nazwa) + ' (' + kb(z.rozmiar) + ', za duży)</span>'
          : '<button type="button" class="mini" data-part="' + esc(z.part) + '" data-name="' + esc(z.nazwa) + '">📎 ' + esc(z.nazwa) + ' (' + kb(z.rozmiar) + ')</button>';
      }).join('') + '</div><p class="sub" style="margin:-4px 0 10px">Załącznik zapisuje się na dysku — nie otwieraj plików, których się nie spodziewasz.</p>' : '') +
      '<div id="mbBody"></div>' +
      '<div class="acts" style="margin-top:12px">' +
        (a && a.zadanie ? '<a href="zadania.html?w=wszystkie">Zadanie: ' + esc(a.zadanie.tytul) + ' →</a>' : '') +
        (a ? '<button type="button" class="mini" data-m="triage">Pokaż w „Do decyzji”</button>' : '<button type="button" class="mini ok" data-m="analiza">Utwórz zadanie z tej wiadomości</button>') +
        '<span class="sub" data-mmsg>' + (a ? '' : 'Automat opisze wiadomość (płatne zapytanie) i przygotuje propozycję zadania do zatwierdzenia.') + '</span></div>';
    var body = $('mbBody');
    if (mb.html && m.srcdoc) body.appendChild(frame(mb.images ? m.srcdoc.replace('img-src data:;', 'img-src data: https:;').replace(/ data-zdalne="/g, ' src="') : m.srcdoc));
    else { var t = document.createElement('div'); t.className = 'cm mtext'; t.textContent = m.tekst || '(wiadomość bez treści tekstowej' + (m.srcdoc ? ' — użyj widoku HTML)' : ')'); body.appendChild(t); }
  }
  async function openMsg(uid) {
    var el = $('mbMsg');
    $('mbList').hidden = true; el.hidden = false; ekran('wiadomosc');
    el.innerHTML = '<div class="empty">Ładowanie…</div>';
    try {
      var out = await call('poczta', { action: 'wiadomosc_imap', skrzynka: mb.box, folder: mb.folder, uid: uid });
      if (out.error) throw new Error(out.error);
      mb.msg = out; mb.images = false; mb.html = false; // plain text first; HTML and remote pictures only on request
      renderMsg();
      var back = el.querySelector('[data-m="back"]'); if (back) back.focus();
    } catch (e) { el.innerHTML = '<div class="acts" style="margin:0 0 10px"><button type="button" class="mini" data-m="back">← Lista</button></div><div class="empty">' + esc(e.message) + '</div>'; }
  }
  function backToList() { $('mbMsg').hidden = true; $('mbList').hidden = false; ekran('lista'); var r = mb.msg && document.querySelector('.row[data-u="' + mb.msg.uid + '"]'); if (r) r.focus(); mb.msg = null; }
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
    var act = b.getAttribute('data-m');
    if (act === 'back') return backToList();
    if (act === 'view') { mb.html = !mb.html; return renderMsg(); }
    if (act === 'img') { mb.images = true; return renderMsg(); }
    if (act === 'triage') return toTriage(mb.msg.analiza.id);
    if (act === 'analiza') {
      b.disabled = true; msg.textContent = 'Analizuję wiadomość…';
      try {
        var out = await call('poczta', { action: 'analizuj_imap', skrzynka: mb.box, folder: mb.folder, uid: mb.msg.uid });
        if (out.error && !out.wiersz) { msg.textContent = out.error; b.disabled = false; return; }
        toTriage(out.wiersz);
      } catch (err) { msg.textContent = err.message; b.disabled = false; }
    }
  });
  function toTriage(id) { want = id; open = {}; load._tried = false; show('analiza'); load(mb.box); }
  function rowKeys(sel, attr, fn) {
    return function (e) {
      var r = e.target.closest(sel); if (!r) return;
      if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); return fn(r.getAttribute(attr)); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { var n = e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling; while (n && !n.matches(sel)) n = e.key === 'ArrowDown' ? n.nextElementSibling : n.previousElementSibling; if (n) { e.preventDefault(); n.focus(); } }
    };
  }
  var onFolder = rowKeys('[data-f]', 'data-f', function (id) { openFolder(id); }), onRow = rowKeys('[data-u]', 'data-u', function (u) { openMsg(Number(u)); });
  $('mbTree').addEventListener('click', onFolder); $('mbTree').addEventListener('keydown', onFolder);
  $('mbRows').addEventListener('click', onRow); $('mbRows').addEventListener('keydown', onRow);
  $('mbBox').addEventListener('change', function () { loadFolders(this.value); });
  $('mbToFolders').addEventListener('click', function () { ekran('foldery'); });
  $('mbGo').addEventListener('click', function () { mb.page = 1; if (mb.folder) openFolder(mb.folder); });
  $('mbQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') { mb.page = 1; if (mb.folder) openFolder(mb.folder); } });
  $('mbClear').addEventListener('click', function () { $('mbQ').value = ''; $('mbOd').value = ''; $('mbDo').value = ''; $('mbNew').checked = false; $('mbAtt').checked = false; mb.page = 1; if (mb.folder) openFolder(mb.folder); });
  $('mbPrev').addEventListener('click', function () { if (mb.page > 1) { mb.page--; openFolder(mb.folder); } });
  $('mbNext').addEventListener('click', function () { mb.page++; openFolder(mb.folder); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('vSkrzynka').hidden && mb.msg) backToList(); });
  function show(v) {
    $('vAnaliza').hidden = v !== 'analiza'; $('vSkrzynka').hidden = v !== 'skrzynka';
    document.querySelectorAll('#views [data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
    if (v === 'skrzynka' && !mb.loaded && skrzynki.length) loadFolders(skrzynka);
  }
  $('views').addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (b) show(b.getAttribute('data-v')); });
  $('logShow').addEventListener('click', async function () {
    this.disabled = true;
    try {
      var out = await call('poczta', { action: 'dziennik' }), CO = { otwarcie: 'otwarcie wiadomości', zalacznik: 'pobranie załącznika', analiza: 'analiza na żądanie' };
      $('logRows').innerHTML = out.dziennik.length ? '<table style="width:100%;font-size:13px;border-collapse:collapse"><tr><th align="left">Kiedy</th><th align="left">Kto</th><th align="left">Co</th><th align="left">Skrzynka / folder</th><th align="left">Nr</th></tr>' +
        out.dziennik.map(function (r) { return '<tr><td>' + esc(when(r.at)) + '</td><td>' + esc(who(r.kto)) + '</td><td>' + esc(CO[r.akcja] || r.akcja) + (r.czesc ? ' (część ' + esc(r.czesc) + ', ' + kb(r.rozmiar) + ')' : '') + '</td><td>' + esc(r.skrzynka) + ' / ' + esc(r.folder || '') + '</td><td>' + esc(r.uid) + '</td></tr>'; }).join('') + '</table>'
        : '<p class="sub">Brak wpisów.</p>';
    } catch (e) { $('logRows').innerHTML = '<p class="sub">' + esc(e.message) + '</p>'; }
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
