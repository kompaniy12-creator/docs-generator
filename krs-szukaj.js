/* Company search instead of uploading a KRS extract.
   Replaces the "Wczytaj dane z wypisu KRS" box on every generator: type a NIP, a KRS
   number or a part of the name, pick the company, and the page's own applyKRSData()
   gets the same data it used to get from a parsed PDF — name, numbers, address, board,
   shareholders. Data comes from rejestr.io through the `firma` function (portal session);
   a company is read from the register once and then served from our own base.
   Pages that need PESEL numbers set window.KRS_PESEL = true: the official current
   extract is then fetched as well and the numbers are read from it. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/firma';
  var box = document.querySelector('.krs-upload');
  if (!box) return;
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var css = document.createElement('style');
  css.textContent =
    '.krs-find{border:1.5px solid var(--brand-navy,#1B3F7F);border-radius:12px;padding:16px 18px;background:linear-gradient(135deg,#fff,#EEF3F9)}' +
    '.krs-find strong{display:block;font-size:14.5px;color:var(--brand-navy,#1B3F7F);margin-bottom:2px}' +
    '.krs-find small{display:block;font-size:12px;color:#666;line-height:1.45;margin-bottom:10px}' +
    '.krs-find .row{display:flex;gap:8px}' +
    '.krs-find input{flex:1;min-width:0;padding:11px 12px;border:1px solid #d4dbe6;border-radius:9px;font:inherit;font-size:15px;background:#fff}' +
    '.krs-find button.go{padding:11px 18px;border:none;border-radius:9px;background:var(--brand-navy,#1B3F7F);color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}' +
    '.krs-find button.go:disabled{background:#999;cursor:wait}' +
    '.krs-hits{margin-top:10px;display:flex;flex-direction:column;gap:6px}' +
    '.krs-hit{display:flex;justify-content:space-between;gap:12px;align-items:center;text-align:left;padding:10px 12px;border:1px solid #d4dbe6;border-radius:9px;background:#fff;font:inherit;font-size:13.5px;cursor:pointer}' +
    '.krs-hit:hover{border-color:var(--brand-navy,#1B3F7F)}' +
    '.krs-hit b{display:block;font-size:14px;color:#111}.krs-hit span{color:#667;font-size:12.5px}.krs-hit em{font-style:normal;color:#b91c1c;font-weight:600}' +
    '.krs-again{margin-top:8px;background:none;border:none;color:var(--brand-navy,#1B3F7F);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;padding:0}';
  document.head.appendChild(css);

  // the old upload button stays in the DOM (page scripts hold references to it), just hidden
  var oldBtn = document.getElementById('krsUploadBtn');
  if (oldBtn) oldBtn.style.display = 'none';
  var statusEl = document.getElementById('krsStatus');
  var ui = document.createElement('div');
  ui.className = 'krs-find';
  ui.innerHTML = '<strong>Znajdź spółkę w KRS</strong>' +
    '<small>Wpisz NIP, numer KRS albo nazwę — dane spółki, zarządu i wspólników wypełnią się same' + (window.KRS_PESEL ? ', razem z numerami PESEL' : '') + '.</small>' +
    '<div class="row"><input type="search" id="krsQ" placeholder="NIP, KRS albo nazwa spółki" autocomplete="off" /><button type="button" class="go" id="krsGo">Szukaj</button></div>' +
    '<div class="krs-hits" id="krsHits"></div>';
  box.insertBefore(ui, statusEl || null);
  var q = ui.querySelector('#krsQ'), go = ui.querySelector('#krsGo'), hitsEl = ui.querySelector('#krsHits');
  var last = null; // the company loaded last, for "refresh"

  function status(msg, type) {
    if (!statusEl) return;
    statusEl.textContent = msg; statusEl.className = 'krs-status ' + (type || '');
  }
  async function call(params) {
    var s = await window.sb.auth.getSession();
    var token = s && s.data && s.data.session ? s.data.session.access_token : '';
    var res = await fetch(FN + '?' + new URLSearchParams(params), { headers: { apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token } });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
    return out;
  }
  function cap(s) { return window.KRSParser ? window.KRSParser.capitalize(s) : s; }

  // firm data from the function -> the shape applyKRSData() expects
  function toKRSData(f) {
    var city = (f.adres && f.adres.miejscowosc) || f.miasto || '';
    return {
      krs: f.krs || '', nip: f.nip || '', regon: f.regon || '', firma: f.nazwa || '',
      city: city ? cap(city) : null,
      seat: city && window.KRSParser ? window.KRSParser.toLocative(city) : (city || null),
      adres: f.adres || { ulica: '', nrDomu: '', nrLokalu: '', kodPocztowy: f.kod || '', miejscowosc: city },
      wspolnicy: (f.wspolnicy || []).map(function (w) { return { nazwisko: w.nazwisko, imie: w.imie, udzialy: w.udzialy, dataUr: w.dataUr }; }),
      zarzad: (f.zarzad || []).map(function (z) { return { nazwisko: z.nazwisko, imie: z.imie, funkcja: z.funkcja, dataUr: z.dataUr }; }),
      reprezentacja: f.reprezentacja || null, kapital: f.kapital,
    };
  }
  var key = function (p) { return ((p.imie || '').split(/\s+/)[0] + ' ' + (p.nazwisko || '')).toUpperCase().trim(); };
  // PESEL numbers are only in the official extract: read them from its PDF and attach by name
  async function addPesel(data, fresh) {
    if (!window.KRS_PESEL || !data.krs || !window.KRSParser) return 0;
    var o = await call(fresh ? { odpis: data.krs, fresh: 1 } : { odpis: data.krs });
    var bin = atob(o.pdf), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var parsed = await window.KRSParser.parseFile(new Blob([bytes], { type: 'application/pdf' }));
    var map = {};
    (parsed.zarzad || []).concat(parsed.wspolnicy || []).forEach(function (p) { if (p.pesel) map[key(p)] = p.pesel; });
    var n = 0;
    data.zarzad.concat(data.wspolnicy).forEach(function (p) { if (map[key(p)]) { p.pesel = map[key(p)]; n++; } });
    return n;
  }

  async function load(hit, fresh) {
    hitsEl.innerHTML = '';
    go.disabled = true;
    status('⏳ Pobieram dane spółki…', 'loading');
    try {
      var params = hit.nip ? { nip: hit.nip } : { krs: hit.krs };
      if (fresh) params.fresh = 1;
      var f = await call(params);
      if (!f.found) { status('Nie znaleziono tej spółki w KRS (jednoosobowej działalności nie ma w KRS).', 'error'); return; }
      var data = toKRSData(f), pesel = 0, peselErr = '';
      try { pesel = await addPesel(data, fresh); } catch (e) { peselErr = ' Numerów PESEL nie udało się odczytać (' + e.message + ') — wpisz je ręcznie.'; }
      if (typeof window.applyKRSData !== 'function') throw new Error('Strona nie obsługuje automatycznego wypełniania.');
      window.applyKRSData(data);
      last = hit;
      status('✅ Wczytano: ' + (data.firma || 'spółka') + ' · zarząd: ' + data.zarzad.length + ' · wspólnicy: ' + data.wspolnicy.length +
        (window.KRS_PESEL ? ' · PESEL: ' + pesel : '') + '. Dane z rejestr.io' + (f.z_pamieci ? ' (z naszej bazy, pobrane ' + new Date(f.pobrano).toLocaleDateString('pl-PL') + ')' : '') + '.' + peselErr, 'success');
      if (f.z_pamieci) {
        var again = document.createElement('button');
        again.type = 'button'; again.className = 'krs-again'; again.textContent = 'Pobierz aktualne dane z rejestru ↻';
        again.addEventListener('click', function () { load(hit, true); });
        hitsEl.appendChild(again);
      }
    } catch (e) {
      status('Nie udało się pobrać danych: ' + (e.message || e), 'error');
    } finally { go.disabled = false; }
  }

  async function search() {
    var text = q.value.trim();
    if (text.length < 3) { status('Wpisz NIP, KRS albo co najmniej 3 litery nazwy.', 'error'); return; }
    var digits = text.replace(/[\s-]/g, '');
    if (/^\d{10}$/.test(digits) && digits.indexOf('000') !== 0) return load({ nip: digits });
    go.disabled = true; hitsEl.innerHTML = ''; status('⏳ Szukam w KRS…', 'loading');
    try {
      var out = await call({ q: text });
      var hits = out.hits || [];
      if (!hits.length) { status('Nic nie znaleziono. Sprawdź pisownię albo wpisz NIP.', 'error'); return; }
      if (hits.length === 1) return load(hits[0]);
      status('Wybierz spółkę:', 'loading');
      hits.forEach(function (h) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'krs-hit';
        b.innerHTML = '<div><b>' + esc(h.nazwa) + '</b><span>' + [h.miasto, h.nip && 'NIP ' + h.nip, h.krs && 'KRS ' + h.krs].filter(Boolean).map(esc).join(' · ') + (h.wykreslona ? ' · <em>wykreślona</em>' : '') + '</span></div><span>wybierz →</span>';
        b.addEventListener('click', function () { load(h); });
        hitsEl.appendChild(b);
      });
    } catch (e) {
      status('Wyszukiwanie nie powiodło się: ' + (e.message || e), 'error');
    } finally { go.disabled = false; }
  }
  go.addEventListener('click', search);
  q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
})();
