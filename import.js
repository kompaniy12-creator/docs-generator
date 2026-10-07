/* Bulk import of a firm's existing staff from an Excel / CSV export (wFirma:
   Kadry → Pracownicy → "Eksport danych pracowników" → Eksport do Excela).
   The file is parsed in the browser. Each person becomes a row in
   zatrudnienie_zgloszenia with status "zatrudniony" (so it shows in the registry
   but not in the inbox of new submissions) and a profile in portal_workers. */
(function () {
  'use strict';
  var SUPABASE_URL = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co';
  var KLIENCI_FN = SUPABASE_URL + '/functions/v1/klienci-list';
  var TABLE = 'zatrudnienie_zgloszenia';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function show(el, msg, type) { el.textContent = msg; el.className = 'status ' + (type || ''); }

  // Portal field -> label + header patterns (matched on lower-cased, accent-free headers).
  // Order matters: the first unused column that matches wins.
  var FIELDS = [
    { k: 'p_nazwisko', label: 'Nazwisko', re: /^nazwisko$/ },
    { k: 'p_imiona', label: 'Imię / imiona', re: /^imie$|^imiona$|pierwsze imie/ },
    { k: '_fullname', label: 'Imię i nazwisko (jedna kolumna)', re: /imie i nazwisko|nazwisko i imi|^pracownik$|^nazwa$/ },
    { k: 'p_pesel', label: 'PESEL', re: /pesel/ },
    { k: 'p_dataur', label: 'Data urodzenia', date: true, re: /data ur|urodzen/ },
    { k: 'p_miejsceur', label: 'Miejsce urodzenia', re: /miejsce ur/ },
    { k: 'p_obywatelstwo', label: 'Obywatelstwo', re: /obywatel/ },
    { k: 'p_dowod', label: 'Seria i nr dokumentu', re: /numer dowodu|paszport|dokument.*(numer|nr|seria)|seria/ },
    { k: '_dowod2', label: 'Nr innego dokumentu (paszport)', re: /numer identyfikacyjny/ },
    { k: 'p_nip', label: 'NIP pracownika', re: /^nip/ },
    { k: 'p_telefon', label: 'Telefon', re: /telefon|tel\.|komork/ },
    { k: 'p_email', label: 'E-mail', re: /e-?mail/ },
    { k: 'a_ulica', label: 'Ulica', re: /ulica/ },
    { k: 'a_nrdom', label: 'Nr domu', re: /nr domu|numer domu|nr budynku|numer budynku/ },
    { k: 'a_nrmiesz', label: 'Nr mieszkania', re: /nr lokalu|numer lokalu|mieszkan/ },
    { k: 'a_kod', label: 'Kod pocztowy', re: /kod poczt|^kod$/ },
    { k: 'a_miejscowosc', label: 'Miejscowość', re: /miejscowosc|^miasto$/ },
    { k: 'a_gmina', label: 'Gmina', re: /gmina/ },
    { k: 'a_powiat', label: 'Powiat', re: /powiat/ },
    { k: 'a_wojewodztwo', label: 'Województwo', re: /wojew/ },
    { k: 'p_konto', label: 'Numer konta', re: /konto|rachun|iban/ },
    { k: 'p_us', label: 'Urząd skarbowy', re: /urzad skarb|^us$/ },
    { k: 'p_nfz', label: 'Oddział NFZ', re: /nfz/ },
    { k: 'u_stanowisko', label: 'Stanowisko', re: /stanowisk|rodzaj pracy/ },
    { k: '_typ', label: 'Rodzaj umowy', re: /rodzaj umowy|typ umowy|^umowa$|forma zatrud/ },
    { k: 'u_od', label: 'Zatrudniony od', date: true, re: /zatrudn.* od$|data zatrud|data rozpocz|^od$/ },
    { k: 'u_do', label: 'Umowa do', date: true, re: /zatrudn.* do$|data zakoncz|data zwoln|^do$/ },
    { k: 'u_stawka', label: 'Wynagrodzenie', re: /^wynagrodzenie$|stawka|pensja|brutto/ },
    { k: 'u_wymiar', label: 'Etat', re: /^etat$|wymiar/ },
    { k: 'p_karta_do', label: 'Karta pobytu ważna do', date: true, re: /karta pobytu/ },
    { k: 'p_paszport_do', label: 'Paszport ważny do', date: true, re: /paszport.*(wazn|do)/ },
    { k: 'p_zezwolenie_do', label: 'Zezwolenie / wiza do', date: true, re: /zezwolen|wiza|oswiadczen/ },
    { k: 'p_badania_do', label: 'Badania lekarskie do', date: true, re: /badani|lekarsk/ },
  ];

  var headers = [], rows = [], mapping = {};

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/\s+/g, ' ').trim();
  }
  // Excel serial, dd.mm.yyyy, dd-mm-yyyy, yyyy-mm-dd, Date -> ISO yyyy-mm-dd ('' when not a date)
  function toIso(v) {
    if (v == null || v === '') return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v === 'number' && v > 3000 && v < 80000) {
      var d = new Date(Math.round((v - 25569) * 86400000));
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    var s = String(v).trim(), m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    if ((m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/))) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
    return '';
  }
  function cell(v) { return v instanceof Date ? toIso(v) : String(v == null ? '' : v).trim(); }

  // ---------------- step 1: firm ----------------
  async function loadFirms() {
    try {
      var s = await window.sb.auth.getSession();
      var token = s.data.session ? s.data.session.access_token : '';
      var res = await fetch(KLIENCI_FN, { headers: { apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token } });
      var data = await res.json();
      (data.clients || []).forEach(function (f) {
        var o = document.createElement('option');
        o.value = digits(f.nip); o.textContent = f.nazwa + (f.nip ? ' · NIP ' + f.nip : '');
        o.dataset.nazwa = f.nazwa; o.dataset.miasto = f.miasto || '';
        $('firma').appendChild(o);
      });
    } catch (e) { /* manual entry still works */ }
  }
  $('firma').addEventListener('change', function () {
    var o = this.selectedOptions[0];
    if (!o || !o.value) return;
    $('nip').value = o.value; $('nazwa').value = o.dataset.nazwa || '';
  });

  // ---------------- step 2: file ----------------
  var drop = $('drop'), file = $('file');
  drop.addEventListener('click', function () { file.click(); });
  ['dragenter', 'dragover'].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('drag'); }); });
  ['dragleave', 'drop'].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('drag'); }); });
  drop.addEventListener('drop', function (ev) { if (ev.dataTransfer.files[0]) read(ev.dataTransfer.files[0]); });
  file.addEventListener('change', function () { if (file.files[0]) read(file.files[0]); file.value = ''; });

  // file -> { headers, rows } (the header row is the first one with at least 3 filled cells)
  async function parse(f) {
    var wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
    var data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
    var h = data.findIndex(function (r) { return r.filter(function (c) { return String(c).trim() !== ''; }).length >= 3; });
    if (h < 0) throw new Error('Nie znaleziono wiersza z nagłówkami kolumn.');
    return {
      headers: data[h].map(function (c, i) { return String(c).trim() || ('Kolumna ' + (i + 1)); }),
      rows: data.slice(h + 1).filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); }),
    };
  }
  async function read(f) {
    try {
      var parsed = await parse(f);
      headers = parsed.headers; rows = parsed.rows;
      if (!rows.length) throw new Error('Plik nie zawiera wierszy z danymi.');
      autoMap();
      renderMap();
      show($('fileInfo'), 'Wczytano „' + f.name + '”: ' + rows.length + ' wierszy, ' + headers.length + ' kolumn.', 'info');
      $('stepMap').hidden = false; $('stepGo').hidden = false;
      show($('result'), '', '');
    } catch (e) {
      show($('fileInfo'), 'Nie udało się odczytać pliku: ' + (e.message || e), 'error');
      $('stepMap').hidden = true; $('stepGo').hidden = true;
    }
  }

  // ---------------- step 3: mapping ----------------
  function autoMap() {
    mapping = {};
    var used = {};
    var nh = headers.map(norm);
    FIELDS.forEach(function (f) {
      for (var i = 0; i < nh.length; i++) {
        if (!used[i] && f.re.test(nh[i])) { mapping[f.k] = i; used[i] = true; break; }
      }
    });
    // a combined "imię i nazwisko" column is only needed when there is no surname column
    if (mapping.p_nazwisko != null) delete mapping._fullname;
  }
  function renderMap() {
    var opts = '<option value="">— brak —</option>' + headers.map(function (h, i) { return '<option value="' + i + '">' + esc(h) + '</option>'; }).join('');
    $('map').innerHTML = FIELDS.map(function (f) {
      return '<div class="f' + (f.k === 'p_nazwisko' ? ' req' : '') + '" data-k="' + f.k + '"><label>' + esc(f.label) + '</label><select>' + opts + '</select></div>';
    }).join('');
    $('map').querySelectorAll('.f').forEach(function (el) {
      var k = el.getAttribute('data-k'), sel = el.querySelector('select');
      sel.value = mapping[k] != null ? String(mapping[k]) : '';
      el.classList.toggle('on', sel.value !== '');
      sel.addEventListener('change', function () {
        if (sel.value === '') delete mapping[k]; else mapping[k] = Number(sel.value);
        el.classList.toggle('on', sel.value !== '');
        renderPreview();
      });
    });
    renderPreview();
  }

  // one spreadsheet row -> portal payload fields (only mapped, non-empty ones)
  function toPerson(r) {
    var p = {};
    FIELDS.forEach(function (f) {
      var i = mapping[f.k];
      if (i == null) return;
      var v = f.date ? toIso(r[i]) : cell(r[i]);
      if (v !== '') p[f.k] = v;
    });
    if (p._fullname) p._name = norm(p._fullname);
    if (p._fullname && !p.p_nazwisko) {
      // wFirma lists "Nazwisko Imię"; a comma separates them unambiguously
      var parts = p._fullname.indexOf(',') !== -1 ? p._fullname.split(',') : p._fullname.split(/\s+/);
      p.p_nazwisko = (parts.shift() || '').trim();
      p.p_imiona = parts.join(' ').trim();
    }
    delete p._fullname;
    if (p._dowod2 && !p.p_dowod) p.p_dowod = p._dowod2;
    delete p._dowod2;
    if (p._typ) p.u_umowa = p._typ;
    if (p._typ) { p.u_typ = /zlec/.test(norm(p._typ)) ? 'zlecenie' : /prac/.test(norm(p._typ)) ? 'praca' : ''; if (!p.u_typ) delete p.u_typ; }
    delete p._typ;
    if (p.p_pesel) p.p_pesel = digits(p.p_pesel).padStart(11, '0').slice(-11);
    if (p.a_kod && /^\d{5}$/.test(digits(p.a_kod))) p.a_kod = digits(p.a_kod).replace(/^(\d{2})(\d{3})$/, '$1-$2');
    return p;
  }
  function people() {
    return rows.map(toPerson).filter(function (p) { return p.p_nazwisko; });
  }
  function renderPreview() {
    var list = people().slice(0, 6);
    var cols = FIELDS.filter(function (f) { return f.k[0] !== '_' && list.some(function (p) { return p[f.k]; }); });
    if (!list.length) { $('preview').innerHTML = '<tr><td>Wybierz kolumnę z nazwiskiem, aby zobaczyć podgląd.</td></tr>'; return; }
    $('preview').innerHTML = '<thead><tr>' + cols.map(function (f) { return '<th>' + esc(f.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      list.map(function (p) { return '<tr>' + cols.map(function (f) { return '<td>' + esc(p[f.k] || '') + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody>';
  }

  // ---------------- step 4: import ----------------
  function keyOf(p) {
    if (p.p_pesel && digits(p.p_pesel).length === 11) return 'pesel:' + digits(p.p_pesel);
    return 'name:' + norm((p.p_nazwisko || '') + ' ' + (p.p_imiona || '')) + '|' + (p.p_dataur || '');
  }
  // Writes the people of one firm; existing[] is the portal's current content (kept
  // up to date across a batch). Returns { added, updated }.
  async function fetchExisting() {
    var all = [], from = 0, page = 1000;
    for (;;) { // PostgREST returns at most 1000 rows per request
      var ex = await window.sb.from(TABLE).select('id,payload').order('created_at', { ascending: true }).range(from, from + page - 1);
      if (ex.error) throw ex.error;
      all = all.concat(ex.data || []);
      if (!ex.data || ex.data.length < page) break;
      from += page;
    }
    return all;
  }
  async function importPeople(list, nip, nazwa, all, onStep, byName) {
    var existing = {}, names = {};
    all.forEach(function (r) {
      var p = r.payload || {};
      var same = nip ? digits(p.z_nip) === nip : norm(p.z_nazwa) === norm(nazwa);
      if (same) { existing[keyOf(p)] = r; names[norm((p.p_nazwisko || '') + ' ' + (p.p_imiona || ''))] = r; }
    });
    var added = 0, updated = 0, seen = {}, fresh = [];
    var stamp = { source: 'import', at: new Date().toISOString() };
    for (var i = 0; i < list.length; i++) {
      var p = list[i], nameKey = p._name || norm((p.p_nazwisko || '') + ' ' + (p.p_imiona || ''));
      delete p._name;
      var k = byName ? 'name:' + nameKey : keyOf(p);
      if (seen[k]) continue; // the same person twice in the file
      seen[k] = true;
      if (onStep) onStep(i + 1, list.length);
      var old = byName ? names[nameKey] : existing[k];
      if (old) {
        var merged = Object.assign({}, old.payload), changed = false;
        Object.keys(p).forEach(function (f) { if (merged[f] == null || merged[f] === '') { merged[f] = p[f]; changed = true; } });
        if (changed) {
          if (!old.id) { // added earlier in this batch: look its id up
            var f0 = await window.sb.from(TABLE).select('id').eq('worker_name', ((merged.p_imiona || '') + ' ' + merged.p_nazwisko).trim()).eq('payload->>z_nip', nip).limit(1);
            if (f0.error || !f0.data || !f0.data.length) continue;
            old.id = f0.data[0].id;
          }
          var u = await window.sb.from(TABLE).update({ payload: merged }).eq('id', old.id);
          if (u.error) throw u.error;
          old.payload = merged; updated++;
        }
        continue;
      }
      var payload = Object.assign({ z_nazwa: nazwa, z_nip: nip, m_same: true, _import: stamp }, p);
      var ins = await window.sb.from(TABLE).insert({
        status: 'zatrudniony',
        worker_name: ((p.p_imiona || '') + ' ' + p.p_nazwisko).trim(),
        payload: payload, doc_paths: [],
      });
      if (ins.error) throw ins.error;
      var row = { id: null, payload: payload };
      all.push(row); names[nameKey] = row;
      added++; fresh.push(p);
    }
    // reusable profiles for the document generator ("Pracownik z bazy")
    for (var j = 0; j < fresh.length; j++) {
      var q = fresh[j];
      try {
        await window.Workers.save({
          nazwisko: q.p_nazwisko, imiona: q.p_imiona || '', pesel: q.p_pesel || '',
          data: {
            p: { nazwisko: q.p_nazwisko, imiona: q.p_imiona || '', pesel: q.p_pesel || '', dataur: q.p_dataur || '',
              miejsceur: q.p_miejsceur || '', dowod: q.p_dowod || '', nip: q.p_nip || '', telefon: q.p_telefon || '',
              konto: q.p_konto || '', us: q.p_us || '', nfz: q.p_nfz || '', obywatelstwo: q.p_obywatelstwo || '' },
            adres: { ulica: q.a_ulica || '', nrdom: q.a_nrdom || '', nrmiesz: q.a_nrmiesz || '', kod: q.a_kod || '',
              miejscowosc: q.a_miejscowosc || '', gmina: q.a_gmina || '', powiat: q.a_powiat || '', woj: q.a_wojewodztwo || '' },
            meld: null,
          },
        });
      } catch (e) { /* the registry row exists; the profile can be created later from the generator */ }
    }
    return { added: added, updated: updated, people: Object.keys(seen).length };
  }

  $('go').addEventListener('click', async function () {
    var res = $('result'), btn = this;
    var nip = digits($('nip').value), nazwa = $('nazwa').value.trim();
    if (!nazwa) return show(res, 'Podaj nazwę firmy (krok 1).', 'error');
    if (nip && nip.length !== 10) return show(res, 'NIP firmy musi mieć 10 cyfr.', 'error');
    var list = people();
    if (!list.length) return show(res, 'Brak osób do importu — dopasuj kolumnę z nazwiskiem.', 'error');
    btn.disabled = true;
    try {
      var r = await importPeople(list, nip, nazwa, await fetchExisting(), function (n, all) { show(res, 'Importuję… ' + n + ' / ' + all, 'info'); });
      var skipped = rows.length - r.people;
      show(res, 'Gotowe: dodano ' + r.added + ', uzupełniono ' + r.updated + (skipped > 0 ? ', pominięto ' + skipped + ' (bez nazwiska lub powtórzone)' : '') +
        '. Pracownicy są w Rejestrze przy firmie „' + nazwa + '”.', 'success');
    } catch (e) {
      show(res, 'Błąd importu: ' + (e.message || e) + ' — część osób mogła zostać już dodana; ponowny import ich nie zdubluje.', 'error');
    } finally { btn.disabled = false; }
  });

  // ---------------- batch: many firms at once ----------------
  // Files named  wfirma_<NIP>_<nazwa firmy>.xls(x)  carry their firm in the name, so a
  // whole set of exports can be imported in one go (columns are matched automatically).
  var bfile = $('bfile'), bres = $('bresult');
  $('bdrop').addEventListener('click', function () { bfile.click(); });
  bfile.addEventListener('change', async function () {
    var files = Array.prototype.slice.call(bfile.files); bfile.value = '';
    if (!files.length) return;
    var isUmowy = function (f) { return /__umowy/i.test(f.name) ? 1 : 0; };
    files.sort(function (a, b) { return isUmowy(a) - isUmowy(b) || a.name.localeCompare(b.name); });
    var names = {};
    Array.prototype.forEach.call($('firma').options, function (o) { if (o.value) names[o.value] = o.dataset.nazwa; });
    var all, out = [], tot = { added: 0, updated: 0, firms: 0 };
    try { all = await fetchExisting(); } catch (e) { return show(bres, 'Błąd: ' + (e.message || e), 'error'); }
    for (var i = 0; i < files.length; i++) {
      var f = files[i], m = f.name.match(/^wfirma_(\d{10})_(.*?)(__umowy)?(?: ?\(\d+\))?\.(xlsx?|csv)$/i);
      show(bres, 'Firma ' + (i + 1) + ' / ' + files.length + ': ' + f.name, 'info');
      if (!m) { out.push(f.name + ' — pominięto (nazwa pliku bez NIP)'); continue; }
      try {
        var parsed = await parse(f);
        headers = parsed.headers; rows = parsed.rows; autoMap();
        var list = people();
        if (!list.length) { out.push(f.name + ' — brak pracowników'); continue; }
        var nazwa = names[m[1]] || m[2].replace(/_/g, ' ');
        var r = await importPeople(list, m[1], nazwa, all, null, !!m[3]);
        tot.added += r.added; tot.updated += r.updated; if (!m[3]) tot.firms++;
        out.push(nazwa + (m[3] ? ' (umowy)' : '') + ' — dodano ' + r.added + ', uzupełniono ' + r.updated);
      } catch (e) { out.push(f.name + ' — BŁĄD: ' + (e.message || e)); }
    }
    headers = []; rows = []; mapping = {};
    show(bres, 'Gotowe: ' + tot.firms + ' firm, dodano ' + tot.added + ' osób, uzupełniono ' + tot.updated + '.', 'success');
    $('blog').textContent = out.join('\n');
  });

  loadFirms();
})();
