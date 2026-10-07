/* Public client-facing worker intake form.
   Uploads documents -> AI extraction (edge function) -> prefilled fields ->
   client completes & validates -> stored as an employment request in Supabase. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co';
  // anon (publishable) key — public by design; lets the call pass the functions gateway.
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnh3a3hwenFxanRtZ3F3b3p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQxODksImV4cCI6MjA4ODgzMDE4OX0.sUFX90FKNuxM7u8ftOlDKdf1iD4gsfq2T3S0FDzRdC0';
  var EXTRACT_FN = SUPABASE_URL + '/functions/v1/extract-worker';
  var KLIENT_FN = SUPABASE_URL + '/functions/v1/klient-by-nip';
  var BUCKET = 'zatrudnienie-dokumenty';
  var TABLE = 'zatrudnienie_zgloszenia';

  var form = document.getElementById('form');
  var $ = function (id) { return document.getElementById(id); };

  // ---------------- Documents (categorised, required validation) ----------------
  var DOC_CATS = [
    { key: 'tozsamosc', label: 'Paszport', hint: 'paszport (strona ze zdjęciem) / dowód osobisty', required: true, ai: true },
    { key: 'pobyt', label: 'Dokumenty legalizujące pobyt', hint: 'decyzja / karta pobytu / wiza', required: false, ai: true },
    { key: 'praca', label: 'Dokumenty legalizujące pracę', hint: 'powiadomienie / zezwolenie na pracę / oświadczenie o powierzeniu pracy', required: false, ai: true },
    { key: 'student', label: 'Dla studenta — zaświadczenie / legitymacja', hint: 'jeżeli posiada', required: false, typ: 'zlecenie' },
    { key: 'bhp', label: 'Szkolenie wstępne BHP', hint: 'karta szkolenia wstępnego BHP', required: false },
    { key: 'badania', label: 'Skierowanie i orzeczenie lekarskie', hint: 'skierowanie na badanie + orzeczenie lekarskie', required: false },
    { key: 'swiadectwa', label: 'Świadectwa pracy', hint: 'z poprzednich miejsc pracy', required: false, typ: 'praca' },
    { key: 'dyplomy', label: 'Dyplomy i dokumenty kwalifikacji', hint: 'jeżeli posiada', required: false, typ: 'praca' },
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
        '<span class="doc-cat-label">' + c.label + (c.required ? ' <span class="req">*</span>' : '') +
          ' <span class="doc-check">✓ dodano</span></span>' +
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
    DOC_CATS.forEach(function (c) { if (catActive(c)) docFiles[c.key].forEach(function (r) { out.push({ cat: c.key, label: c.label, file: r.file }); }); });
    return out;
  }
  // a category tied to one contract type counts only while that type is chosen
  function catActive(c) { return !c.typ || c.typ === $('u_typ').value; }
  // Required categories with no file. Marks slots and returns the missing list.
  function missingRequiredDocs() {
    var miss = [];
    DOC_CATS.forEach(function (c) {
      if (c.required && docFiles[c.key].length === 0) { catEls[c.key].classList.add('missing'); miss.push(c); }
    });
    return miss;
  }

  // ---------------- GUS company lookup by NIP ----------------
  var gusBtn = $('gusBtn');
  var gusStatus = $('gusStatus');
  var emailHint = ''; // masked address of this client from our base, if any
  function setGus(msg, type) { gusStatus.textContent = msg; gusStatus.className = 'ai-status ' + (type || ''); }
  gusBtn.addEventListener('click', async function () {
    var nip = ($('z_nip').value || '').replace(/[^0-9]/g, '');
    if (nip.length !== 10) { setGus('Wpisz poprawny NIP (10 cyfr).', 'error'); return; }
    gusBtn.disabled = true; setGus('⏳ Szukam firmy w bazie klientów…', 'loading');
    try {
      var res = await fetch(KLIENT_FN + '?nip=' + nip, {
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
      });
      var out = await res.json();
      if (!res.ok) throw new Error(out.error || ('HTTP ' + res.status));
      if (!out.found) {
        setGus('Firma o NIP ' + nip + ' nie jest naszym klientem. Skontaktuj się z biurem.', 'error');
        return;
      }
      if (out.nazwa) $('z_nazwa').value = out.nazwa;
      if (out.miasto) $('z_miasto').value = out.miasto;
      if (out.ulica) $('z_ulica').value = out.ulica;
      if (out.nip) $('z_nip').value = out.nip;
      $('z_regon').value = out.regon || '';
      $('z_kod').value = out.kod || '';
      // we may already hold the firm's address: then the field is optional
      emailHint = out.email_hint || '';
      $('z_email_req').style.display = emailHint ? 'none' : '';
      $('z_email_hint').textContent = emailHint
        ? 'Mamy już w bazie adres ' + emailHint + ' — zostaw pole puste, aby wysłać dokumenty na ten adres, albo wpisz inny.'
        : '';
      clearErr($('z_email'));
      clearErr($('z_nip'));
      setGus('✅ Wczytano: ' + (out.nazwa || ''), 'success');
    } catch (err) {
      setGus('Nie udało się pobrać danych: ' + (err.message || err), 'error');
    } finally {
      gusBtn.disabled = false;
    }
  });

  // Optional: prefill the employer from the invite link (?firma=&nip=&miasto=&ulica=).
  (function prefillEmployer() {
    try {
      var p = new URLSearchParams(location.search);
      var map = { firma: 'z_nazwa', nip: 'z_nip', miasto: 'z_miasto', ulica: 'z_ulica' };
      Object.keys(map).forEach(function (k) {
        var v = p.get(k);
        if (v) { var el = $(map[k]); if (el) el.value = v; }
      });
    } catch (e) { /* ignore */ }
  })();

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Phone photos are 3–8 MB each; the reader accepts ~6.5 MB in total. Photos are
  // therefore scaled down for reading only (the originals are what gets stored).
  var AI_MAX_SIDE = 2200, AI_MAX_BYTES = 6.5 * 1024 * 1024;
  function forAi(file) {
    if (!/^image\//.test(file.type) || file.type === 'image/gif') {
      return fileToBase64(file).then(function (data) { return { mime: file.type || 'application/pdf', data: data }; });
    }
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
      var asIs = function () {
        URL.revokeObjectURL(url);
        // a format neither this browser nor the reader can open (e.g. HEIC on a PC): leave it out
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(null);
        fileToBase64(file).then(function (data) { resolve({ mime: file.type, data: data }); });
      };
      img.onload = function () {
        var k = Math.min(1, AI_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        if (k === 1 && file.size < 1024 * 1024) return asIs();
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
      };
      img.onerror = asIs; // e.g. HEIC the browser cannot decode — send unchanged
      img.src = url;
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
        files: (await Promise.all(src.map(forAi))).filter(Boolean),
      };
      if (!payload.files.length) {
        setAi('Tego formatu zdjęcia nie da się odczytać automatycznie. Dodaj plik JPG, PNG lub PDF — albo wpisz dane ręcznie.', 'error');
        return;
      }
      var bytes = payload.files.reduce(function (n, f) { return n + f.data.length * 0.75; }, 0);
      if (bytes > AI_MAX_BYTES) {
        setAi('Pliki są za duże do automatycznego odczytu (łącznie ponad 6 MB). Dodaj mniejsze pliki PDF albo zdjęcia — lub wpisz dane ręcznie. Zgłoszenie można wysłać mimo to.', 'error');
        return;
      }
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
    'a_ulica', 'a_nrdom', 'a_nrmiesz', 'a_kod', 'a_miejscowosc', 'a_gmina', 'a_powiat', 'a_wojewodztwo',
    'p_karta_do', 'p_paszport_do', 'p_zezwolenie_do', 'p_badania_do'];

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
  // ---------------- Contract terms: fields per contract type + legal minimums ----------------
  // Statutory minimums in force on the contract start date (today if not given yet);
  // stawki.js keeps them current from the official register of acts.
  var MIN_WAGE = 4806, MIN_HOURLY = 31.4;
  function syncStawki() {
    var st = window.Stawki.at($('u_od').value);
    MIN_WAGE = st.wage; MIN_HOURLY = st.hourly;
    var txt = { od: st.from.slice(5) === '01-01' ? 'w ' + st.year + ' r.' : 'od ' + st.from.split('-').reverse().join('.') + ' r.',
      wage: window.Stawki.zl(st.wage), half: window.Stawki.zl(st.wage / 2) };
    form.querySelectorAll('[data-st]').forEach(function (el) { el.textContent = txt[el.getAttribute('data-st')]; });
  }
  var ETAT = { 'pełny etat': 1, '3/4 etatu': 0.75, '1/2 etatu': 0.5, '1/4 etatu': 0.25 };
  function num(id) { return parseFloat(($(id).value || '').replace(/\s/g, '').replace(',', '.')); }
  function monthsBetween(a, b) { // whole months from date a to date b (b inclusive)
    var d1 = new Date(a), d2 = new Date(b);
    d2.setDate(d2.getDate() + 1);
    var m = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
    return d2.getDate() > d1.getDate() ? m + 1 : m;
  }
  // umowa o pracę: monthly salary + wymiar etatu; umowa zlecenie: rate + hours
  function applyTyp() {
    var typ = $('u_typ').value, bezt = $('u_bezterminowo').checked;
    form.classList.toggle('no-typ', !typ);
    $('typHint').style.display = typ ? 'none' : '';
    form.querySelectorAll('[data-zlecenie]').forEach(function (el) { if (typ) el.textContent = el.getAttribute('data-' + typ); });
    DOC_CATS.forEach(function (c) { catEls[c.key].style.display = catActive(c) ? '' : 'none'; });
    form.querySelectorAll('[data-typ]').forEach(function (box) {
      var on = box.getAttribute('data-typ') === typ && !(box.id === 'u_rodzaj_box' && bezt);
      box.hidden = !on;
      box.querySelectorAll('input, select').forEach(function (el) { el.disabled = !on; });
    });
    $('u_stawka_label').textContent = typ === 'praca' ? 'Wynagrodzenie miesięczne (zł brutto)' : 'Wynagrodzenie (zł brutto)';
    $('u_stawka').placeholder = typ === 'praca' ? 'np. 4806' : 'np. 31,40';
    // statutory minimum instead of an amount: the contract then refers to the act
    var min = $('u_minimalna').checked;
    $('u_stawka').disabled = min;
    if (min) {
      $('u_stawka').value = ''; clearErr($('u_stawka'));
      if (typ === 'zlecenie') $('u_jedn').value = 'godz';
    }
    if (typ === 'zlecenie') $('u_jedn').disabled = min;
    $('u_do').disabled = bezt;
    if (bezt) { $('u_do').value = ''; clearErr($('u_do')); }
    updatePay();
  }
  function monthlyPay() {
    if ($('u_minimalna').checked) {
      if ($('u_typ').value === 'praca') return MIN_WAGE * (ETAT[$('u_wymiar').value] || 1);
      var hm = num('u_godziny');
      return hm > 0 ? MIN_HOURLY * hm : NaN;
    }
    var st = num('u_stawka');
    if (!(st > 0)) return NaN;
    if ($('u_typ').value === 'praca' || $('u_jedn').value === 'mies') return st;
    var h = num('u_godziny');
    return h > 0 ? st * h : NaN;
  }
  // -> message when the pay is below the statutory minimum for this contract type
  function payProblem() {
    if ($('u_minimalna').checked) return '';
    var st = num('u_stawka');
    if (!(st > 0)) return '';
    if ($('u_typ').value === 'praca') {
      var min = Math.round(MIN_WAGE * (ETAT[$('u_wymiar').value] || 1) * 100) / 100;
      return st < min ? 'Wynagrodzenie nie może być niższe niż minimalne: ' + min + ' zł brutto (' + $('u_wymiar').value + ').' : '';
    }
    if ($('u_typ').value === 'zlecenie' && $('u_jedn').value === 'godz' && st < MIN_HOURLY) {
      return 'Stawka jest niższa niż minimalna stawka godzinowa (' + MIN_HOURLY.toFixed(2).replace('.', ',') + ' zł brutto).';
    }
    return '';
  }
  function updatePay() {
    syncStawki();
    var hint = $('u_stawka_hint');
    hint.textContent = payProblem();
    if (!hint.textContent) clearErr($('u_stawka')); // e.g. the wymiar changed, the amount is fine now
    hint.style.color = '#b91c1c';
    var out = $('u_800_calc'), karta = $('u_karta_calc'), mies = monthlyPay(), prog = MIN_WAGE / 2;
    // green when the threshold is met, red when it is not
    function verdict(el, ok, text) {
      el.textContent = text;
      el.style.cssText = text ? 'display:block;margin-top:6px;padding:6px 10px;border-radius:6px;font-weight:600;' +
        (ok ? 'background:#dcfce7;color:#166534;border:1px solid #86efac' : 'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5') : '';
    }
    if (isNaN(mies)) { verdict(out, true, ''); verdict(karta, true, ''); return; }
    var kwota = 'ok. ' + Math.round(mies) + ' zł miesięcznie';
    verdict(out, mies >= prog, mies >= prog ? '✓ Przy podanych danych: ' + kwota + ' — próg jest spełniony.'
      : '✗ Przy podanych danych: ' + kwota + ' — poniżej progu ' + prog + ' zł.');
    verdict(karta, mies >= MIN_WAGE, mies >= MIN_WAGE ? '✓ Przy podanych danych: ' + kwota + ' — warunek jest spełniony.'
      : '✗ Przy podanych danych: ' + kwota + ' — za mało do karty pobytu (min. ' + MIN_WAGE + ' zł).');
  }
  ['u_godziny', 'u_stawka', 'u_jedn', 'u_wymiar'].forEach(function (id) {
    $(id).addEventListener('input', updatePay); $(id).addEventListener('change', updatePay);
  });
  $('u_typ').addEventListener('change', applyTyp);
  $('u_bezterminowo').addEventListener('change', applyTyp);
  $('u_minimalna').addEventListener('change', applyTyp);
  $('u_godziny_zmienne').addEventListener('change', function () { clearErr($('u_godziny')); });
  ['u_od', 'u_rodzaj'].forEach(function (id) { $(id).addEventListener('change', function () { clearErr($('u_do')); }); });
  $('u_od').addEventListener('change', updatePay);
  window.Stawki.ready.then(updatePay);
  applyTyp();

  $('p_gotowka').addEventListener('change', function () {
    var konto = $('p_konto');
    konto.disabled = this.checked;
    $('kontoBox').style.display = this.checked ? 'none' : '';
    if (this.checked) { konto.value = ''; clearErr(konto); }
  });

  // Polish phone number: 9 digits (not starting with 0), optionally prefixed +48 / 0048 / 48
  function telDigits(v) {
    var d = (v || '').replace(/[\s().-]/g, '').replace(/^(\+48|0048)/, '');
    if (/^48\d{9}$/.test(d)) d = d.slice(2);
    return /^[1-9]\d{8}$/.test(d) ? d : '';
  }
  $('p_telefon').addEventListener('blur', function () {
    var d = telDigits(this.value);
    if (d) { this.value = '+48 ' + d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6); clearErr(this); }
  });

  // further family members (the first one uses the fixed r_* fields above)
  var MAX_RODZINA = 8;
  function addRodzina() {
    var wrap = $('rodzinaExtra');
    if (wrap.children.length >= MAX_RODZINA - 1) return;
    var el = document.createElement('div');
    el.className = 'rodzina-next';
    el.innerHTML =
      '<div class="rodzina-next-head"><span>Kolejny członek rodziny</span><button type="button">Usuń</button></div>' +
      '<div class="row"><div class="field"><label>Imię i nazwisko</label><input type="text" data-r="imienazwisko" /></div>' +
        '<div class="field"><label>PESEL</label><input type="text" inputmode="numeric" maxlength="11" data-r="pesel" /><span class="err"></span></div></div>' +
      '<div class="row"><div class="field"><label>Data urodzenia</label><input type="date" data-r="dataur" /></div>' +
        '<div class="field"><label>Pokrewieństwo</label><input type="text" data-r="pokrew" placeholder="np. dziecko / małżonek" /></div></div>' +
      '<div class="field"><label>Adres zamieszkania</label><input type="text" data-r="adres" /></div>';
    el.querySelector('button').addEventListener('click', function () { el.remove(); $('rodzinaAdd').style.display = ''; });
    wrap.appendChild(el);
    if (wrap.children.length >= MAX_RODZINA - 1) $('rodzinaAdd').style.display = 'none';
  }
  $('rodzinaAdd').addEventListener('click', addRodzina);
  function extraRodzina() {
    return Array.prototype.map.call($('rodzinaExtra').children, function (el) {
      var m = {};
      el.querySelectorAll('[data-r]').forEach(function (i) { m[i.getAttribute('data-r')] = i.value.trim(); });
      return m;
    }).filter(function (m) { return m.imienazwisko || m.pesel || m.dataur; });
  }
  $('p_nopesel').addEventListener('change', function () {
    var pesel = $('p_pesel');
    pesel.disabled = this.checked;
    if (this.checked) { pesel.value = ''; clearErr(pesel); }
  });

  // ---------------- NFZ + urząd skarbowy from the residence postcode ----------------
  // Fills only empty fields or ones we filled ourselves, never what the user typed.
  function autoSet(el, val) {
    if (!val || (el.value && el.dataset.auto !== el.value)) return;
    el.value = val; el.dataset.auto = val;
    clearErr(el);
  }
  var urzedySeq = 0;
  async function fillUrzedy() {
    var kod = $('a_kod');
    var digits = kod.value.replace(/\D/g, '');
    if (digits.length !== 5 || !window.Urzedy) return;
    if (/^\d{5}$/.test(kod.value.trim())) kod.value = digits.slice(0, 2) + '-' + digits.slice(2);
    var seq = ++urzedySeq;
    var res = await window.Urzedy.lookup(digits, $('a_miejscowosc').value, $('a_ulica').value);
    if (seq !== urzedySeq || !res) return;
    autoSet($('a_wojewodztwo'), res.wojewodztwo);
    autoSet($('a_powiat'), res.powiat);
    autoSet($('a_gmina'), res.gmina);
    autoSet($('p_nfz'), res.nfz);
    var list = $('p_us_list'), hint = $('p_us_hint'), us = $('p_us');
    list.innerHTML = '';
    res.us.forEach(function (n) { var o = document.createElement('option'); o.value = n; list.appendChild(o); });
    var one = res.us.length === 1 || res.guess;
    if (one) autoSet(us, res.us[0]);
    else if (us.dataset.auto === us.value) { us.value = ''; us.dataset.auto = ''; }
    hint.style.display = res.us.length < 2 ? 'none' : 'block';
    hint.textContent = res.us.length < 2 ? '' : (res.guess
      ? 'Dobrano według kodu pocztowego — w tej części miasta działają dwa urzędy, sprawdź (drugi jest na liście).'
      : 'W tym mieście granice urzędów skarbowych biegną ulicami — wybierz właściwy z listy.');
  }
  $('a_kod').addEventListener('input', fillUrzedy);
  $('a_miejscowosc').addEventListener('change', fillUrzedy);
  $('a_ulica').addEventListener('change', fillUrzedy);

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

    // contract terms
    var typ = $('u_typ').value, uOd = $('u_od'), uDo = $('u_do'), bezt = $('u_bezterminowo').checked;
    if (typ && !bezt && !uDo.value) { setErr(uDo, 'Podaj datę zakończenia albo zaznacz „bezterminowo”'); problems.push(uDo); }
    if (uOd.value && uDo.value) {
      if (uDo.value < uOd.value) { setErr(uDo, 'Data zakończenia jest wcześniejsza niż data rozpoczęcia'); problems.push(uDo); }
      else if (typ === 'praca') {
        var mies = monthsBetween(uOd.value, uDo.value);
        if ($('u_rodzaj').value === 'probny' && mies > 3) { setErr(uDo, 'Okres próbny nie może przekraczać 3 miesięcy'); problems.push(uDo); }
        if ($('u_rodzaj').value === 'okreslony' && mies > 33) { setErr(uDo, 'Umowa na czas określony nie może przekraczać 33 miesięcy'); problems.push(uDo); }
      }
    }
    var stawka = $('u_stawka');
    if (stawka.value && !(num('u_stawka') > 0)) { setErr(stawka, 'Podaj kwotę, np. 4806 lub 31,40'); problems.push(stawka); }
    else if (typ === 'praca' && payProblem()) { setErr(stawka, payProblem()); problems.push(stawka); }
    var godz = $('u_godziny');
    if (typ === 'zlecenie') {
      if (godz.value && !/^\d{1,3}$/.test(godz.value.trim())) { setErr(godz, 'Podaj liczbę godzin (np. 160)'); problems.push(godz); }
      else if (!godz.value.trim() && !$('u_godziny_zmienne').checked) {
        setErr(godz, 'Podaj liczbę godzin albo zaznacz, że jest zmienna'); problems.push(godz);
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

    var znip = $('z_nip');
    if (znip.value && !nipValid(znip.value)) { setErr(znip, 'Nieprawidłowy NIP'); problems.push(znip); }

    var tel = $('p_telefon');
    if (tel.value && !telDigits(tel.value)) { setErr(tel, 'Podaj polski numer: 9 cyfr, np. +48 500 600 700'); problems.push(tel); }

    var zemail = $('z_email');
    if (zemail.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(zemail.value)) { setErr(zemail, 'Nieprawidłowy e-mail'); problems.push(zemail); }
    else if (!zemail.value && !emailHint) { setErr(zemail, 'Podaj e-mail firmy — na ten adres wyślemy dokumenty do podpisu'); problems.push(zemail); }

    var email = $('p_email');
    if (email.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value)) { setErr(email, 'Nieprawidłowy e-mail'); problems.push(email); }

    var rPesel = $('r_pesel');
    if ($('r_has').checked && rPesel.value && !peselValid(rPesel.value)) { setErr(rPesel, 'Nieprawidłowy PESEL'); problems.push(rPesel); }
    if ($('r_has').checked) $('rodzinaExtra').querySelectorAll('[data-r="pesel"]').forEach(function (i) {
      var bad = i.value && !peselValid(i.value), e = i.parentNode.querySelector('.err');
      i.classList.toggle('invalid', !!bad);
      e.textContent = bad ? 'Nieprawidłowy PESEL' : ''; e.classList.toggle('show', !!bad);
      if (bad) problems.push(i);
    });

    return problems;
  }

  // ---------------- Submit ----------------
  var submitBtn = $('submitBtn');
  var statusEl = $('status');
  function showStatus(msg, type) { statusEl.textContent = msg; statusEl.className = 'status ' + type; }

  function collect() {
    var fd = new FormData(form), data = {};
    fd.forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v; });
    ['p_nopesel', 'm_same', 'r_has', 'p_gotowka', 'u_godziny_zmienne', 'u_bezterminowo', 'u_minimalna'].forEach(function (k) { data[k] = $(k).checked; });
    data.r_dodatkowi = data.r_has ? extraRodzina() : [];
    var td = telDigits(data.p_telefon); // same format whether or not the field was left with a blur
    if (td) data.p_telefon = '+48 ' + td.slice(0, 3) + ' ' + td.slice(3, 6) + ' ' + td.slice(6);
    // fields hidden for the chosen contract type are disabled and absent above
    if (data.u_minimalna && data.u_typ === 'zlecenie') data.u_jedn = 'godz';
    if (data.u_typ === 'praca') { data.u_jedn = 'mies'; if (data.u_bezterminowo) data.u_rodzaj = 'nieokreslony'; }
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
      // our own id, so the HR team can be notified about exactly this submission
      var zid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : null;
      var ins = await window.sb.from(TABLE).insert({
        id: zid || undefined,
        status: 'nowe',
        worker_name: (data.p_imiona + ' ' + data.p_nazwisko).trim(),
        payload: data,
        doc_paths: docPaths,
      });
      if (ins.error) throw ins.error;
      // Telegram notice to the HR team (best effort — never blocks the confirmation)
      if (zid) {
        try {
          fetch(SUPABASE_URL + '/functions/v1/powiadom', {
            method: 'POST', keepalive: true,
            headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON },
            body: JSON.stringify({ action: 'nowe', id: zid }),
          }).catch(function () {});
        } catch (e) { /* ignore */ }
      }

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
