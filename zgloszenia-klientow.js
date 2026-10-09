/* Zgłoszenia klientów: the office's inbox of what clients send through the client profile, and
   the place where staff decide which documents a client may see there.
   Requests, replies, attachments and the sharing flags go only through the `klient` edge function
   (actions biuro_*; it filters by the caller's sections). The documents to tick are read with the
   signed-in person's own rights (RLS): akta_dokumenty — Kadry, klienci_umowy — administrators,
   portal_doc_history — the section of the document. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/klient';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function plt(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function rozmiar(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + ' MB'; }
  function wiek(iso) {
    var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    var d = Math.round(m / 1440);
    return m < 60 ? m + ' min temu' : m < 1440 ? Math.round(m / 60) + ' godz. temu' : d === 1 ? 'wczoraj' : d + ' dni temu';
  }
  function norm(s) { return String(s == null ? '' : s).toLowerCase(); }

  var me = '', admin = false, sekcje = null, rows = [], open = {}, tab = 'przyjete', msgs = {};
  var idZLinku = new URLSearchParams(location.search).get('id') || '';
  function maSekcje(s) { return admin || sekcje === null || sekcje.indexOf(s) !== -1; }

  async function call(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res;
    try { res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('Brak połączenia z serwerem. Spróbuj ponownie.'); }
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) { var er = new Error(out.error || ('Błąd ' + res.status)); er.status = res.status; throw er; }
    return out;
  }
  function pobierz(url, nazwa) { var a = document.createElement('a'); a.href = url; a.download = nazwa || ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }

  // ---------------- requests ----------------
  var ST = { przyjete: ['nowe', 'p-amber'], w_toku: ['w toku', 'p-navy'], zalatwione: ['załatwione', 'p-ok'] };
  var KAT = { kadry: 'kadry', ksiegowosc: 'księgowość', inne: 'inne' };
  var RODZ = { pytanie: '', zmiana_pracownika: 'zmiana dot. pracownika', dane_firmy: 'zmiana danych firmy', dokumenty_ksiegowe: 'dokumenty księgowe' };
  var ZAD = { nowe: 'nowe', w_toku: 'w toku', zrobione: 'zrobione', anulowane: 'anulowane' };
  var TABS = [['przyjete', 'Nowe'], ['w_toku', 'W toku'], ['zalatwione', 'Załatwione'], ['', 'Wszystkie']];
  // new = nobody at the office has reacted yet: still "przyjęte" and no reply written
  function nowe(z) { return z.status === 'przyjete' && !z.odpowiedz; }
  function pasuje(z) {
    var q = norm($('fq').value).trim(), k = $('fk').value, c = $('fc').value, d = $('fd').value;
    if (k && z.nip !== k) return false;
    if (c && z.kategoria !== c) return false;
    if (d && String(z.utworzono).slice(0, 10) < d) return false;
    return !q || norm([z.temat, z.tresc, z.firma, z.nip, z.pracownik, z.autor, z.odpowiedz, z.notatka_wewnetrzna].join(' ')).indexOf(q) !== -1;
  }
  function renderTabs() {
    var f = rows.filter(pasuje);
    $('tabs').innerHTML = TABS.map(function (t) {
      var n = f.filter(function (z) { return !t[0] || z.status === t[0]; }).length;
      return '<button type="button" data-tab="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '<b>' + n + '</b></button>';
    }).join('');
  }
  function detal(z) {
    var m = msgs[z.id];
    return '<p>' + esc(z.tresc) + '</p>' +
      (z.zalaczniki.length ? '<div class="files">' + z.zalaczniki.map(function (a) { return '<button type="button" class="mini" data-file="' + a.n + '">⬇ ' + esc(a.nazwa) + ' (' + rozmiar(a.rozmiar) + ')</button>'; }).join('') + '</div>' : '<p class="sub">Bez załączników.</p>') +
      '<div class="acts" style="justify-content:flex-start;margin:0 0 12px">' +
        '<a class="mini" href="klienci.html?k=' + encodeURIComponent(z.nip) + '">Klient w Bazie klientów →</a>' +
        (z.worker_id && maSekcje('kadry') ? '<a class="mini" href="rejestr.html?q=' + encodeURIComponent(z.pracownik || '') + '">Pracownik w Rejestrze →</a>' : '') +
        (z.zadanie_id ? '<a class="mini" href="zadania.html?w=wszystkie">Zadanie: ' + esc(ZAD[z.zadanie_status] || 'otwórz') + (z.assignee ? ' · ' + esc(z.assignee.split('@')[0]) : '') + ' →</a>' : '<span class="sub">Bez zadania (nie znaleziono osoby odpowiedzialnej).</span>') +
      '</div>' +
      '<div class="two"><div class="field"><label>Status widoczny dla klienta</label><select data-f="status">' +
        ['przyjete', 'w_toku', 'zalatwione'].map(function (s) { return '<option value="' + s + '"' + (s === z.status ? ' selected' : '') + '>' + (s === 'przyjete' ? 'przyjęte' : ST[s][0]) + '</option>'; }).join('') + '</select>' +
        '<span class="sub">' + (z.status_reczny ? 'ustawiony ręcznie' : 'dopóki nie zostanie zapisany ręcznie — idzie za statusem zadania') + '</span></div>' +
      '<div class="field"><label>Od kogo</label><div>' + esc(z.autor) + '</div><span class="sub">wysłano ' + esc(plt(z.utworzono)) + '</span></div></div>' +
      '<div class="field"><label>Odpowiedź dla klienta (klient zobaczy ją w profilu)</label><textarea data-f="odpowiedz" maxlength="2000" placeholder="Krótka odpowiedź, np. „Dokumenty zaksięgowane, dziękujemy.”">' + esc(z.odpowiedz || '') + '</textarea>' +
        (z.odpowiedz_at ? '<span class="sub">ostatnio zapisana ' + esc(plt(z.odpowiedz_at)) + (z.odpowiedzial ? ' · ' + esc(z.odpowiedzial.split('@')[0]) : '') + '</span>' : '') + '</div>' +
      '<div class="field"><label>Notatka wewnętrzna (klient jej NIE widzi)</label><textarea data-f="notatka" maxlength="4000">' + esc(z.notatka_wewnetrzna || '') + '</textarea></div>' +
      '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button type="button" class="btn" data-save>Zapisz</button><span class="sub" data-msg>' + (m ? esc(m) : '') + '</span></div>';
  }
  function render() {
    renderTabs();
    var list = rows.filter(pasuje).filter(function (z) { return !tab || z.status === tab; });
    $('list').innerHTML = list.length ? list.map(function (z) {
      var st = ST[z.status] || [z.status, 'p-grey'], o = !!open[z.id];
      return '<div class="task' + (nowe(z) ? ' new' : '') + (z.status === 'zalatwione' ? ' done' : '') + (o ? ' open' : '') + '" data-id="' + esc(z.id) + '"><div class="thead" data-toggle>' +
        '<div class="ttl"><strong>' + esc(z.temat) + '</strong><small>' + esc([z.firma, 'NIP ' + z.nip, z.pracownik && 'pracownik: ' + z.pracownik, RODZ[z.rodzaj], z.zalaczniki.length ? 'załączniki: ' + z.zalaczniki.length : ''].filter(Boolean).join(' · ')) + '</small></div>' +
        '<div class="acts"><span class="pill p-grey">' + esc(KAT[z.kategoria] || z.kategoria) + '</span><span class="pill ' + st[1] + '">' + esc(st[0]) + '</span><span class="sub">' + esc(wiek(z.utworzono)) + '</span></div></div>' +
        '<div class="tbody">' + (o ? detal(z) : '') + '</div></div>';
    }).join('') : '<div class="empty">' + (rows.length ? 'Brak zgłoszeń dla tych filtrów.' : 'Nie ma jeszcze zgłoszeń od klientów. Pojawią się tu, gdy klient napisze do biura z profilu klienta.') + '</div>';
  }
  function fillKlienci() {
    var seen = {}, cur = $('fk').value;
    $('fk').innerHTML = '<option value="">wszyscy klienci</option>' + rows.filter(function (z) { if (seen[z.nip]) return false; seen[z.nip] = 1; return true; })
      .sort(function (a, b) { return String(a.firma).localeCompare(String(b.firma), 'pl'); }).map(function (z) { return '<option value="' + esc(z.nip) + '">' + esc(z.firma || z.nip) + '</option>'; }).join('');
    $('fk').value = cur;
  }
  async function load() {
    try {
      var out = await call({ action: 'biuro_zgloszenia' });
      rows = out.zgloszenia || [];
      // a request opened from a task link that is older than the list reaches
      if (idZLinku && !rows.some(function (z) { return z.id === idZLinku; })) {
        try { rows = (await call({ action: 'biuro_zgloszenia', id: idZLinku })).zgloszenia.concat(rows); }
        catch (e) { $('warn').innerHTML = '<div class="warnbox">Zgłoszenie z linku nie istnieje albo należy do działu, do którego nie masz dostępu.</div>'; }
      }
      fillKlienci();
      var z = idZLinku && rows.filter(function (x) { return x.id === idZLinku; })[0];
      if (z) { open[z.id] = true; tab = ''; }
      render();
      if (z) { var el = document.querySelector('.task[data-id="' + z.id + '"]'); if (el) el.scrollIntoView({ block: 'start' }); }
      idZLinku = '';
    } catch (e) { $('list').innerHTML = '<div class="errbox">' + esc(e.status === 403 ? 'Zgłoszenia klientów widzą działy Kadry i Księgowość.' : e.message) + '</div>'; $('tabs').innerHTML = ''; }
  }
  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) { tab = b.getAttribute('data-tab'); render(); } });
  ['fq', 'fk', 'fc', 'fd'].forEach(function (id) { $(id).addEventListener('input', render); });
  $('list').addEventListener('click', async function (e) {
    var card = e.target.closest('.task'); if (!card) return;
    var id = card.getAttribute('data-id'), z = rows.filter(function (x) { return x.id === id; })[0]; if (!z) return;
    if (e.target.closest('[data-toggle]')) { open[id] = !open[id]; delete msgs[id]; return render(); }
    var f = e.target.closest('[data-file]');
    if (f) {
      f.disabled = true;
      // a link that lives two minutes and always downloads — the file is never opened inside the portal
      try { var o = await call({ action: 'biuro_zalacznik', id: id, n: +f.getAttribute('data-file') }); pobierz(o.url, o.nazwa); }
      catch (err) { alert('Nie udało się pobrać załącznika: ' + err.message); }
      f.disabled = false; return;
    }
    var s = e.target.closest('[data-save]');
    if (s) {
      var body = { action: 'biuro_zgloszenie', id: id }, v = function (k) { return card.querySelector('[data-f="' + k + '"]').value; };
      if (v('status') !== z.status) body.status = v('status');
      if (v('odpowiedz').trim() !== (z.odpowiedz || '')) body.odpowiedz = v('odpowiedz').trim();
      if (v('notatka').trim() !== (z.notatka_wewnetrzna || '')) body.notatka = v('notatka').trim();
      var note = card.querySelector('[data-msg]');
      if (Object.keys(body).length === 2) { note.textContent = 'Nic się nie zmieniło.'; return; }
      // a reply with the status left at "przyjęte": the request has clearly been taken up
      if (body.odpowiedz && !body.status && z.status === 'przyjete') body.status = 'w_toku';
      s.disabled = true; note.textContent = 'Zapisuję…';
      try {
        await call(body);
        var fresh = (await call({ action: 'biuro_zgloszenia', id: id })).zgloszenia[0];
        rows = rows.map(function (x) { return x.id === id ? fresh : x; });
        msgs[id] = 'Zapisano ' + new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) + (body.odpowiedz != null ? ' — klient widzi odpowiedź w profilu.' : '.');
        render();
      } catch (err) { note.textContent = 'Nie zapisano: ' + err.message; s.disabled = false; }
    }
  });

  // ---------------- what the client sees ----------------
  var ZRODLA = [], docs = [], shared = {}, ust = null, typyHist = {};
  var CZESC = { A: 'część A', B: 'część B', C: 'część C', D: 'część D', E: 'część E', Z: 'zleceniobiorca' };
  var UM = { ksiegowosc: 'umowa o prowadzenie księgowości', kadry: 'umowa o obsługę kadrowo-płacową', powierzenie: 'umowa powierzenia', aneks: 'aneks', pelnomocnictwo: 'pełnomocnictwo', upowaznienie: 'upoważnienie', wypowiedzenie: 'wypowiedzenie', inne: 'dokument' };
  // one shape for the three sources: { id, tytul, opis, firma, nip, osoba (whose personal data is inside), widzi (what the client gets), uwaga }
  var CZYTAJ = {
    akta: async function () {
      var r = await window.sb.from('akta_dokumenty').select('id,nazwa,nip,firma,worker_id,worker_name,czesc,rodzaj,data_dok,status').eq('status', 'przypisany').order('created_at', { ascending: false }).limit(1000);
      if (r.error) throw r.error;
      return (r.data || []).map(function (a) {
        return { id: a.id, tytul: (a.worker_name || 'bez pracownika') + ' — ' + (a.rodzaj || a.nazwa), opis: [a.firma, a.nip && 'NIP ' + a.nip, CZESC[a.czesc], pl(a.data_dok), a.nazwa].filter(Boolean).join(' · '), firma: a.firma, nip: a.nip, osoba: a.worker_name || '',
          widzi: a.nip ? 'pracodawca (NIP ' + a.nip + '): w „Dokumenty” i w karcie pracownika, jako „' + (a.rodzaj || 'dokument z akt osobowych') + '”' : '', uwaga: a.nip ? (a.czesc === 'D' || a.czesc === 'E' ? 'część ' + a.czesc + ' akt (kary porządkowe / kontrola trzeźwości)' : '') : 'bez NIP — klient go nie zobaczy' };
      });
    },
    umowa: async function () {
      var r = await window.sb.from('klienci_umowy').select('id,nazwa,klient,rodzaj,podtyp,data_zawarcia,kontrahent,status').eq('status', 'przypisany').order('created_at', { ascending: false }).limit(1000);
      if (r.error) throw r.error;
      return (r.data || []).map(function (u) {
        var nip = /^\d{10}$/.test(u.klient || '') ? u.klient : '';
        return { id: u.id, tytul: (u.kontrahent || u.klient || '') + ' — ' + (UM[u.rodzaj] || 'dokument') + (u.podtyp ? ' ' + u.podtyp : ''), opis: [nip && 'NIP ' + nip, u.data_zawarcia && 'zawarta ' + pl(u.data_zawarcia), u.nazwa].filter(Boolean).join(' · '), firma: u.kontrahent, nip: nip, osoba: '',
          widzi: nip ? 'klient (NIP ' + nip + '): w „Dokumenty → Umowy z biurem”, cały plik umowy' : '', uwaga: nip ? 'plik zawiera wynagrodzenie biura i dane osób podpisujących' : 'klient bez NIP — nie ma profilu, nie zobaczy' };
      });
    },
    historia: async function () {
      var typy = Object.keys(typyHist);
      if (!typy.length) return [];
      var r = await window.sb.from('portal_doc_history').select('id,created_at,doc_type,title,subject,filename,nip:payload->>nip,znip:payload->z->>nip').in('doc_type', typy).order('created_at', { ascending: false }).limit(1000);
      if (r.error) throw r.error;
      return (r.data || []).map(function (h) {
        var nip = /^\d{10}$/.test(h.nip || '') ? h.nip : /^\d{10}$/.test(h.znip || '') ? h.znip : '';
        return { id: h.id, tytul: (typyHist[h.doc_type] || h.doc_type) + (h.subject ? ' — ' + h.subject : ''), opis: [nip && 'NIP ' + nip, 'wygenerowano ' + plt(h.created_at), h.filename].filter(Boolean).join(' · '), firma: '', nip: nip, osoba: h.doc_type === 'umowa-zlecenie' ? h.subject || '' : '',
          widzi: nip ? 'klient (NIP ' + nip + '): w „Dokumenty → Dokumenty przygotowane dla firmy”' : '', uwaga: nip ? '' : 'w dokumencie nie ma NIP firmy — klient go nie zobaczy' };
      });
    },
  };
  function zrodlo() { return $('us').value; }
  function renderDocs() {
    var q = norm($('uq').value).trim(), o = $('uo').value, zr = zrodlo();
    var list = docs.filter(function (d) { return (!q || norm([d.tytul, d.opis, d.firma, d.nip, d.osoba].join(' ')).indexOf(q) !== -1) && (o === '' || (o === '1') === !!shared[d.id]); });
    var autom = zr === 'historia' && ust && ust.historia === 'auto';
    $('docs').innerHTML = (autom ? '<div class="warnbox">Ustawienie „Pokazuj automatycznie” jest włączone: klient widzi najnowszą wersję każdego z tych dokumentów swojej firmy niezależnie od zaznaczeń. Zaznaczenia zaczną działać po przełączeniu na „Tylko zaznaczone”.</div>' : '') +
      (list.length ? list.slice(0, 300).map(function (d) {
        return '<label class="doc" data-id="' + esc(d.id) + '"><input type="checkbox" data-share' + (shared[d.id] ? ' checked' : '') + (d.nip ? '' : ' disabled') + ' /><div class="ttl"><strong>' + esc(d.tytul) + '</strong><small>' + esc(d.opis) + '</small>' +
          (d.widzi ? '<small>Zobaczy: ' + esc(d.widzi) + '</small>' : '') + (d.uwaga ? '<small><span class="pill p-amber">' + esc(d.uwaga) + '</span></small>' : '') + '</div>' +
          '<span class="pill ' + (shared[d.id] ? 'p-ok' : 'p-grey') + '">' + (shared[d.id] ? 'udostępniony' : 'nieudostępniony') + '</span></label>';
      }).join('') + (list.length > 300 ? '<p class="sub">Pokazano 300 z ' + list.length + ' — zawęź wyszukiwanie.</p>' : '')
        : '<div class="empty">' + (docs.length ? 'Brak dokumentów dla tych filtrów.' : zr === 'akta' ? 'W Aktach osobowych nie ma jeszcze przypisanych dokumentów.' : zr === 'umowa' ? 'W Bazie klientów nie ma jeszcze przypisanych umów.' : 'Nie ma dokumentów w historii.') + '</div>');
  }
  async function loadDocs() {
    var zr = zrodlo();
    $('docs').innerHTML = '<div class="empty">Ładowanie…</div>'; $('udoMsg').innerHTML = '';
    try {
      var d = await CZYTAJ[zr]();
      var on = {}, ids = d.map(function (x) { return x.id; });
      for (var i = 0; i < ids.length; i += 500) (await call({ action: 'biuro_udostepnione', zrodlo: zr, ids: ids.slice(i, i + 500) })).udostepnione.forEach(function (id) { on[id] = true; });
      if (zrodlo() !== zr) return;
      docs = d; shared = on; renderDocs();
    } catch (e) { $('docs').innerHTML = '<div class="errbox">Nie udało się wczytać dokumentów: ' + esc(e.message || e) + '</div>'; }
  }
  $('docs').addEventListener('change', async function (e) {
    var c = e.target; if (!c.hasAttribute || !c.hasAttribute('data-share')) return;
    var id = c.closest('[data-id]').getAttribute('data-id'), d = docs.filter(function (x) { return x.id === id; })[0], on = c.checked, zr = zrodlo();
    if (!d) return;
    if (on) {
      // sharing is the moment somebody else's data leaves the office: say exactly what, to whom
      var tekst = 'Udostępnić klientowi?\n\n' + d.tytul + '\n' + d.opis + '\n\nZobaczy: ' + d.widzi + '.' +
        (d.osoba ? '\n\nDokument zawiera dane osobowe: ' + d.osoba + '. Udostępniaj tylko dokumenty, które pracodawca ma prawo znać.' : '') + (d.uwaga ? '\n\nUwaga: ' + d.uwaga + '.' : '');
      if (!window.confirm(tekst)) { c.checked = false; return; }
    }
    c.disabled = true;
    try {
      var out = await call({ action: 'biuro_udostepnij', zrodlo: zr, id: id, udostepnij: on });
      if (out.udostepniony) shared[id] = true; else delete shared[id];
      $('udoMsg').innerHTML = '<div class="okbox">' + (out.udostepniony ? 'Udostępniono: ' : 'Cofnięto udostępnienie: ') + esc(d.tytul) + '</div>';
    } catch (err) { $('udoMsg').innerHTML = '<div class="errbox">Nie zapisano: ' + esc(err.message) + '</div>'; }
    renderDocs();
  });
  $('uq').addEventListener('input', renderDocs);
  $('uo').addEventListener('change', renderDocs);
  $('us').addEventListener('change', loadDocs);
  function renderUst() {
    Array.prototype.forEach.call(document.querySelectorAll('input[name=hist]'), function (r) { r.checked = !!ust && r.value === ust.historia; r.disabled = !admin; });
    $('setSave').hidden = !admin;
    if (!admin) $('setMsg').textContent = 'Ustawienie zmienia administrator portalu.';
  }
  $('setSave').addEventListener('click', async function () {
    var r = document.querySelector('input[name=hist]:checked'); if (!r) return;
    if (r.value === ust.historia) { $('setMsg').textContent = 'Nic się nie zmieniło.'; return; }
    if (r.value === 'zaznaczone' && !window.confirm('Po przełączeniu klienci przestaną widzieć dokumenty z historii, dopóki nie zostaną zaznaczone poniżej. Przełączyć?')) { renderUst(); return; }
    this.disabled = true; $('setMsg').textContent = 'Zapisuję…';
    try { ust = (await call({ action: 'biuro_ustawienia', historia: r.value })).ustawienia; $('setMsg').textContent = 'Zapisano.'; renderUst(); if (zrodlo() === 'historia') renderDocs(); }
    catch (e) { $('setMsg').textContent = 'Nie zapisano: ' + e.message; }
    this.disabled = false;
  });
  var udoWczytane = false;
  async function loadUdo() {
    if (udoWczytane) return; udoWczytane = true;
    try { var o = await call({ action: 'biuro_ustawienia' }); ust = o.ustawienia; typyHist = o.typy_historii || {}; }
    catch (e) { $('setMsg').textContent = e.message; }
    renderUst();
    ZRODLA = [];
    if (maSekcje('kadry')) ZRODLA.push(['akta', 'Akta osobowe (skany)']);
    if (admin) ZRODLA.push(['umowa', 'Umowy z biurem']);
    if (maSekcje('kadry') || maSekcje('biezaca')) ZRODLA.push(['historia', 'Dokumenty z historii']);
    $('us').innerHTML = ZRODLA.map(function (z) { return '<option value="' + z[0] + '">' + z[1] + '</option>'; }).join('');
    if (!ZRODLA.length) { $('docs').innerHTML = '<div class="empty">Nie masz dostępu do żadnego źródła dokumentów (Kadry, obsługa bieżąca albo administrator).</div>'; return; }
    loadDocs();
  }
  $('mainTabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-main]'); if (!b) return;
    var m = b.getAttribute('data-main');
    Array.prototype.forEach.call($('mainTabs').children, function (x) { x.className = x === b ? 'on' : ''; });
    $('secZgl').hidden = m !== 'zgl'; $('secUdo').hidden = m !== 'udo';
    if (m === 'udo') loadUdo();
  });

  // ---------------- boot ----------------
  (async function () {
    try {
      var s = await window.sb.auth.getSession(), u = s && s.data && s.data.session ? s.data.session.user : null, md = (u && u.app_metadata) || {};
      me = u ? u.email : ''; admin = md.portal_admin === true; sekcje = Array.isArray(md.portal_sections) ? md.portal_sections : null;
    } catch (e) {}
    load();
  })();
})();
