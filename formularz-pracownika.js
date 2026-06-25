/* Public client-facing worker intake form.
   Uploads documents -> AI extraction (edge function) -> prefilled fields ->
   client completes & validates -> stored as an employment request in Supabase. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co';
  // anon (publishable) key — public by design; lets the call pass the functions gateway.
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnh3a3hwenFxanRtZ3F3b3p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQxODksImV4cCI6MjA4ODgzMDE4OX0.sUFX90FKNuxM7u8ftOlDKdf1iD4gsfq2T3S0FDzRdC0';
  var EXTRACT_FN = SUPABASE_URL + '/functions/v1/extract-worker';
  var BUCKET = 'zatrudnienie-dokumenty';
  var TABLE = 'zatrudnienie_zgloszenia';

  var form = document.getElementById('form');
  var $ = function (id) { return document.getElementById(id); };

  // ---------------- Documents (categorised, required validation) ----------------
  var DOC_CATS = [
    { key: 'tozsamosc', label: 'Dokument tożsamości', hint: 'paszport / dowód osobisty / karta pobytu', required: true, ai: true },
    { key: 'pobyt', label: 'Tytuł pobytowy', hint: 'karta pobytu / wiza / stempel w paszporcie', required: true, ai: true },
    { key: 'praca', label: 'Podstawa legalnej pracy', hint: 'zezwolenie na pracę / oświadczenie o powierzeniu pracy', required: true, ai: true },
    { key: 'konto', label: 'Potwierdzenie nr konta', hint: 'opcjonalnie', required: false },
    { key: 'inne', label: 'Inne załączniki', hint: 'opcjonalnie', required: false },
  ];
  var docFiles = {}; // key -> [{file, url}]
  var catEls = {};
  DOC_CATS.forEach(function (c) { docFiles[c.key] = []; });

  var aiBtn = $('aiBtn');
  var catsWrap = $('docCats');

  DOC_CATS.forEach(function (c) {
    var el = document.createElement('div');
    el.className = 'doc-cat';
    el.dataset.key = c.key;
    el.innerHTML =
      '<div class="doc-cat-head">' +
        '<span class="doc-cat-label">' + c.label + (c.required ? ' <span class="req">*</span>' : '') + '</span>' +
        '<small>' + c.hint + '</small>' +
      '</div>' +
      '<input type="file" accept="image/*,application/pdf" multiple hidden />' +
      '<button type="button" class="doc-add">+ Dodaj plik</button>' +
      '<ul class="files"></ul>';
    var input = el.querySelector('input');
    el.querySelector('.doc-add').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { addFiles(c.key, input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (e) { el.addEventListener(e, function (ev) { ev.preventDefault(); el.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (e) { el.addEventListener(e, function (ev) { ev.preventDefault(); el.classList.remove('drag'); }); });
    el.addEventListener('drop', function (ev) { addFiles(c.key, ev.dataTransfer.files); });
    catsWrap.appendChild(el);
    catEls[c.key] = el;
  });

  function addFiles(catKey, fl) {
    Array.prototype.forEach.call(fl, function (f) {
      if (f.size > 15 * 1024 * 1024) { alert('Plik „' + f.name + '" jest za duży (max 15 MB).'); return; }
      docFiles[catKey].push({ file: f, url: f.type.indexOf('image/') === 0 ? URL.createObjectURL(f) : null });
    });
    renderCat(catKey);
  }

  function renderCat(catKey) {
    var el = catEls[catKey];
    var ul = el.querySelector('.files');
    ul.innerHTML = '';
    docFiles[catKey].forEach(function (rec, i) {
      var li = document.createElement('li');
      var thumb = rec.url
        ? '<img class="thumb" src="' + rec.url + '" alt="" />'
        : '<span class="thumb" style="display:flex;align-items:center;justify-content:center">📄</span>';
      li.innerHTML = thumb + '<span class="nm"></span><button type="button" aria-label="Usuń">×</button>';
      li.querySelector('.nm').textContent = rec.file.name;
      li.querySelector('button').addEventListener('click', function () {
        if (rec.url) URL.revokeObjectURL(rec.url);
        docFiles[catKey].splice(i, 1); renderCat(catKey);
      });
      ul.appendChild(li);
    });
    var has = docFiles[catKey].length > 0;
    el.classList.toggle('filled', has);
    if (has) el.classList.remove('missing');
    aiBtn.disabled = !DOC_CATS.some(function (c) { return c.ai && docFiles[c.key].length; });
  }

  // Files sent to AI extraction (identity-bearing categories, capped).
  function aiSourceFiles() {
    var out = [];
    DOC_CATS.forEach(function (c) { if (c.ai) docFiles[c.key].forEach(function (r) { out.push(r.file); }); });
    return out.slice(0, 6);
  }
  // All uploaded docs flattened, with their category.
  function allDocs() {
    var out = [];
    DOC_CATS.forEach(function (c) { docFiles[c.key].forEach(function (r) { out.push({ cat: c.key, label: c.label, file: r.file }); }); });
    return out;
  }
  // Required categories with no file. Marks slots and returns the missing list.
  function missingRequiredDocs() {
    var miss = [];
    DOC_CATS.forEach(function (c) {
      if (c.required && docFiles[c.key].length === 0) { catEls[c.key].classList.add('missing'); miss.push(c); }
    });
    return miss;
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ---------------- AI extraction ----------------
  var aiStatus = $('aiStatus');
  function setAi(msg, type) { aiStatus.textContent = msg; aiStatus.className = 'ai-status ' + (type || ''); }

  aiBtn.addEventListener('click', async function () {
    var src = aiSourceFiles();
    if (!src.length) return;
    aiBtn.disabled = true;
    setAi('⏳ Odczytuję dane z dokumentów…', 'loading');
    try {
      var payload = {
        docType: $('p_doc_typ').value,
        files: await Promise.all(src.map(async function (f) {
          return { mime: f.type || 'image/jpeg', data: await fileToBase64(f) };
        })),
      };
      var res = await fetch(EXTRACT_FN, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var out = await res.json();
      var n = applyExtracted(out.fields || {});
      var warn = (out.warnings && out.warnings.length) ? ' Uwagi: ' + out.warnings.join('; ') : '';
      setAi('✅ Odczytano ' + n + ' pól. Sprawdź i uzupełnij brakujące dane.' + warn, 'success');
    } catch (err) {
      console.error(err);
      setAi('Nie udało się odczytać dokumentów. Wprowadź dane ręcznie. (' + (err.message || err) + ')', 'error');
    } finally {
      aiBtn.disabled = false;
    }
  });

  // map of extractable field -> input id
  var EXTRACT_FIELDS = ['p_imiona', 'p_nazwisko', 'p_pesel', 'p_dataur', 'p_miejsceur',
    'p_obywatelstwo', 'p_doc_typ', 'p_dowod',
    'a_ulica', 'a_nrdom', 'a_nrmiesz', 'a_kod', 'a_miejscowosc', 'a_gmina', 'a_powiat', 'a_wojewodztwo'];

  function applyExtracted(fields) {
    var count = 0;
    EXTRACT_FIELDS.forEach(function (k) {
      var v = fields[k];
      if (v == null || String(v).trim() === '') return;
      var el = $(k);
      if (!el) return;
      el.value = String(v).trim();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      flagFilled(el);
      count++;
    });
    return count;
  }
  function flagFilled(el) {
    var label = form.querySelector('label[for="' + el.id + '"]');
    if (label && !label.querySelector('.filled-flag')) {
      var s = document.createElement('span');
      s.className = 'filled-flag';
      s.textContent = '✓ z dokumentu';
      label.appendChild(s);
    }
  }

  // ---------------- Conditional blocks ----------------
  $('m_same').addEventListener('change', function () {
    $('meldBlock').hidden = this.checked;
  });
  $('r_has').addEventListener('change', function () {
    $('rodzinaBlock').hidden = !this.checked;
  });
  $('p_nopesel').addEventListener('change', function () {
    var pesel = $('p_pesel');
    pesel.disabled = this.checked;
    if (this.checked) { pesel.value = ''; clearErr(pesel); }
  });

  // ---------------- Validation ----------------
  function peselValid(p) {
    if (!/^\d{11}$/.test(p)) return false;
    var w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3], s = 0;
    for (var i = 0; i < 10; i++) s += parseInt(p[i], 10) * w[i];
    var c = (10 - (s % 10)) % 10;
    return c === parseInt(p[10], 10);
  }
  function peselToDate(p) {
    if (!/^\d{11}$/.test(p)) return null;
    var y = parseInt(p.slice(0, 2), 10), m = parseInt(p.slice(2, 4), 10), d = parseInt(p.slice(4, 6), 10);
    var cent;
    if (m >= 1 && m <= 12) cent = 1900;
    else if (m >= 21 && m <= 32) { cent = 2000; m -= 20; }
    else if (m >= 41 && m <= 52) { cent = 2100; m -= 40; }
    else if (m >= 61 && m <= 72) { cent = 2200; m -= 60; }
    else if (m >= 81 && m <= 92) { cent = 1800; m -= 80; }
    else return null;
    var mm = String(m).padStart(2, '0'), dd = String(d).padStart(2, '0');
    return (cent + y) + '-' + mm + '-' + dd;
  }
  function nipValid(n) {
    if (!/^\d{10}$/.test(n)) return false;
    var w = [6, 5, 7, 2, 3, 4, 5, 6, 7], s = 0;
    for (var i = 0; i < 9; i++) s += parseInt(n[i], 10) * w[i];
    var c = s % 11;
    return c !== 10 && c === parseInt(n[9], 10);
  }
  function kontoDigits(v) { return (v || '').replace(/[^0-9]/g, '').replace(/^48?/, function (m) { return m; }); }

  function setErr(el, msg) {
    el.classList.add('invalid');
    var e = form.querySelector('.err[data-for="' + el.id + '"]');
    if (e) { e.textContent = msg; e.classList.add('show'); }
  }
  function clearErr(el) {
    el.classList.remove('invalid');
    var e = form.querySelector('.err[data-for="' + el.id + '"]');
    if (e) { e.classList.remove('show'); }
  }

  // live clear on input
  form.addEventListener('input', function (ev) {
    if (ev.target.classList && ev.target.classList.contains('invalid')) clearErr(ev.target);
  });

  function validate() {
    var problems = [];
    // required fields (skip disabled / hidden)
    form.querySelectorAll('input[required], select[required]').forEach(function (el) {
      if (el.disabled || el.offsetParent === null) return;
      if (!(el.value || '').trim()) { setErr(el, 'Pole wymagane'); problems.push(el); }
    });

    var noPesel = $('p_nopesel').checked;
    var pesel = $('p_pesel');
    if (!noPesel && pesel.value) {
      if (!peselValid(pesel.value)) { setErr(pesel, 'Nieprawidłowy PESEL (suma kontrolna)'); problems.push(pesel); }
      else {
        var dFromP = peselToDate(pesel.value);
        var dob = $('p_dataur');
        if (dFromP && dob.value && dob.value !== dFromP) {
          setErr(dob, 'Data urodzenia nie zgadza się z PESEL (' + dFromP + ')'); problems.push(dob);
        } else if (dFromP && !dob.value) {
          dob.value = dFromP;
        }
      }
    }

    var kod = $('a_kod');
    if (kod.value && !/^\d{2}-\d{3}$/.test(kod.value)) { setErr(kod, 'Format 00-000'); problems.push(kod); }

    var konto = $('p_konto');
    if (konto.value) {
      var kd = (konto.value || '').replace(/\s/g, '').replace(/^PL/i, '');
      if (!/^\d{26}$/.test(kd)) { setErr(konto, 'Numer konta musi mieć 26 cyfr'); problems.push(konto); }
    }

    var nip = $('p_nip');
    if (nip.value && !nipValid(nip.value)) { setErr(nip, 'Nieprawidłowy NIP'); problems.push(nip); }

    var email = $('p_email');
    if (email.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value)) { setErr(email, 'Nieprawidłowy e-mail'); problems.push(email); }

    var rPesel = $('r_pesel');
    if ($('r_has').checked && rPesel.value && !peselValid(rPesel.value)) { setErr(rPesel, 'Nieprawidłowy PESEL'); problems.push(rPesel); }

    return problems;
  }

  // ---------------- Submit ----------------
  var submitBtn = $('submitBtn');
  var statusEl = $('status');
  function showStatus(msg, type) { statusEl.textContent = msg; statusEl.className = 'status ' + type; }

  function collect() {
    var fd = new FormData(form), data = {};
    fd.forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v; });
    ['p_nopesel', 'm_same', 'r_has'].forEach(function (k) { data[k] = $(k).checked; });
    return data;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    statusEl.className = 'status';

    var missing = missingRequiredDocs();
    if (missing.length) {
      showStatus('Dodaj wymagane dokumenty: ' + missing.map(function (c) { return c.label; }).join(', ') + '.', 'error');
      catEls[missing[0].key].scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    var problems = validate();
    if (problems.length) {
      showStatus('Popraw zaznaczone pola (' + problems.length + ').', 'error');
      problems[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      problems[0].focus({ preventScroll: true });
      return;
    }

    submitBtn.disabled = true;
    var orig = submitBtn.textContent;
    submitBtn.textContent = 'Wysyłanie…';
    try {
      if (!window.sb) throw new Error('Brak połączenia z serwerem.');
      var data = collect();

      // 1) upload documents to a per-submission folder, grouped by category
      var folder = (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
      var allFiles = allDocs();
      var docPaths = [];
      var documents = []; // [{cat, label, path, name}]
      for (var i = 0; i < allFiles.length; i++) {
        var d = allFiles[i];
        var ext = (d.file.name.split('.').pop() || 'jpg').toLowerCase();
        var path = folder + '/' + d.cat + '/' + (i + 1) + '.' + ext;
        var up = await window.sb.storage.from(BUCKET).upload(path, d.file, { contentType: d.file.type || 'application/octet-stream', upsert: false });
        if (up.error) throw up.error;
        docPaths.push(path);
        documents.push({ cat: d.cat, label: d.label, path: path, name: d.file.name });
      }
      data.documents = documents;

      // 2) insert the request row
      var ins = await window.sb.from(TABLE).insert({
        status: 'nowe',
        worker_name: (data.p_imiona + ' ' + data.p_nazwisko).trim(),
        payload: data,
        doc_paths: docPaths,
      });
      if (ins.error) throw ins.error;

      form.style.display = 'none';
      $('done').classList.add('show');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error(err);
      showStatus('Nie udało się wysłać zgłoszenia: ' + (err.message || err), 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = orig;
    }
  });
})();
