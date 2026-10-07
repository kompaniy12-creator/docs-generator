/* global PDFLib, fontkit */
const { PDFDocument, rgb } = PDFLib;

// ---------------- Date formatters ----------------
const _monthsPL = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
function isoToPLLong(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(s => parseInt(s, 10));
  return `${d} ${_monthsPL[m - 1]} ${y} r.`;
}
function isoToPLDots(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// ---------------- UI defaults ----------------
const today = new Date();
document.getElementById('d_data').valueAsDate = today;

// toggle meldunek fields
const mSame = document.getElementById('m_same');
const meldunekFields = document.getElementById('meldunekFields');
mSame.addEventListener('change', () => { meldunekFields.hidden = mSame.checked; });

// toggle rodzina fieldset
const docRodzina = document.getElementById('doc_rodzina');
const rodzinaFields = document.getElementById('rodzinaFields');
docRodzina.addEventListener('change', () => { rodzinaFields.hidden = !docRodzina.checked; });

// Documents per contract type, in the order of the office checklists
// ("UZ — lista" and "Akta osobowe część B"); extras not on the lists come last.
const DOC_ORDER = {
  zlecenie: ['kwest', 'wybor', 'umowa', 'gotowka', 'rodo', 'zus', 'wykonawca', 'pit2', 'rodzina', 'ppkInfo', 'ppkRez'],
  praca: ['kwest', 'rodo', 'bhp', 'rowne', 'umowa', 'zakres', 'warunki', 'przepisy', 'pit2', 'ppkInfo', 'ppkRez',
    'zusPrac', 'zgodaPit', 'rodzic', 'gotowka', 'rodzina', 'zakladki'],
};
const DOC_FIELD = {
  umowa: 'doc_umowa', kwest: 'doc_kwest', wybor: 'doc_wybor', gotowka: 'doc_gotowka', rodo: 'doc_rodo', zus: 'doc_zus',
  wykonawca: 'doc_wykonawca', pit2: 'doc_pit2', rodzina: 'doc_rodzina', ppkInfo: 'doc_ppk_info', ppkRez: 'doc_ppk_rez',
  bhp: 'doc_bhp', rowne: 'doc_rowne', zakres: 'doc_zakres', warunki: 'doc_warunki', przepisy: 'doc_przepisy',
  zusPrac: 'doc_zus_prac', zgodaPit: 'doc_zgoda_pit', rodzic: 'doc_rodzic', zakladki: 'doc_zakladki',
};
// contract type -> which documents are offered
const uTyp = document.getElementById('u_typ');
function applyTyp() {
  const typ = uTyp.value === 'praca' ? 'praca' : 'zlecenie';
  document.querySelectorAll('[data-typ]').forEach((el) => { el.hidden = el.getAttribute('data-typ') !== typ; });
  // document checklist: only this type's documents, in checklist order
  const list = document.getElementById('docChecks');
  list.querySelectorAll('label.check').forEach((l) => { l.hidden = true; });
  DOC_ORDER[typ].forEach((k) => {
    const l = list.querySelector('[name="' + DOC_FIELD[k] + '"]').closest('label');
    l.hidden = false; list.appendChild(l);
  });
  const jedn = document.getElementById('u_jedn');
  if (!jedn.dataset.touched) jedn.value = typ === 'praca' ? 'mies' : 'godz';
  document.querySelectorAll('[data-typ-text]').forEach((el) => { el.textContent = el.getAttribute('data-' + typ); });
}
uTyp.addEventListener('change', applyTyp);
document.getElementById('u_jedn').addEventListener('change', (e) => { e.target.dataset.touched = '1'; });
applyTyp();

// ---------------- Contract template of the client firm ----------------
// A firm (by NIP) may have its own contract template per contract type, stored in
// umowa_szablony; without one the standard contract (UMOWA_STANDARD) is used.
const umowaTpl = { custom: '', key: '' };
const tplStatus = document.getElementById('tplStatus');
const tplBox = document.getElementById('tplBox');
const tplText = document.getElementById('tplText');
const zNip = document.getElementById('z_nip');
function tplNip() { return zNip.value.replace(/\D/g, ''); }
function tplTyp() { return uTyp.value === 'praca' ? 'praca' : 'zlecenie'; }
function tplShow(msg) { tplStatus.textContent = msg; }
// the submit handler awaits .pending, so an auto-generated packet never races the lookup
function loadUmowaTpl() { umowaTpl.pending = fetchUmowaTpl(); return umowaTpl.pending; }
async function fetchUmowaTpl() {
  const nip = tplNip(), typ = tplTyp(), key = nip + '|' + typ;
  umowaTpl.key = key; umowaTpl.custom = '';
  if (nip.length !== 10) { tplShow('Wzór umowy: standardowy TD (podaj NIP firmy, aby użyć wzoru klienta).'); tplText.value = ''; return; }
  if (!window.sb) return;
  const r = await window.sb.from('umowa_szablony').select('tresc,updated_at').eq('nip', nip).eq('typ', typ).maybeSingle();
  if (umowaTpl.key !== key) return; // NIP / type changed while loading
  if (r.error) { tplShow('Nie udało się sprawdzić wzoru klienta: ' + r.error.message); return; }
  if (r.data) {
    umowaTpl.custom = r.data.tresc; tplText.value = r.data.tresc;
    tplShow('Wzór umowy: wzór klienta (NIP ' + nip + '), zapisany ' + new Date(r.data.updated_at).toLocaleDateString('pl-PL') + '.');
  } else { tplText.value = ''; tplShow('Wzór umowy: standardowy TD — ta firma nie ma własnego wzoru.'); }
}
zNip.addEventListener('change', loadUmowaTpl);
uTyp.addEventListener('change', loadUmowaTpl);
document.getElementById('tplToggle').addEventListener('click', () => { tplBox.hidden = !tplBox.hidden; });
document.getElementById('tplStd').addEventListener('click', () => {
  if (tplText.value.trim() && !confirm('Zastąpić treść w edytorze wzorem standardowym?')) return;
  tplText.value = UMOWA_STANDARD[tplTyp()];
});
document.getElementById('tplFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    if (/\.docx$/i.test(f.name)) {
      if (!window.mammoth) throw new Error('Nie załadowano obsługi DOCX.');
      tplText.value = (await window.mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value.replace(/\n{3,}/g, '\n\n').trim();
    } else tplText.value = (await f.text()).trim();
    tplShow('Wczytano treść z pliku — wstaw pola {{…}} w miejscach danych i zapisz wzór.');
  } catch (err) { tplShow('Nie udało się wczytać pliku: ' + (err.message || err)); }
});
document.getElementById('tplFields').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const ins = '{{' + b.textContent + '}}', a = tplText.selectionStart, z = tplText.selectionEnd;
  tplText.value = tplText.value.slice(0, a) + ins + tplText.value.slice(z);
  tplText.focus(); tplText.selectionStart = tplText.selectionEnd = a + ins.length;
});
document.getElementById('tplSave').addEventListener('click', async () => {
  const nip = tplNip(), tresc = tplText.value.trim();
  if (nip.length !== 10) return tplShow('Podaj 10-cyfrowy NIP firmy, aby zapisać jej wzór.');
  if (!tresc) return tplShow('Wzór jest pusty.');
  const u = await window.sb.auth.getUser();
  const r = await window.sb.from('umowa_szablony').upsert({
    nip, typ: tplTyp(), tresc, updated_at: new Date().toISOString(),
    updated_by: u && u.data && u.data.user ? u.data.user.id : null,
  });
  if (r.error) return tplShow('Błąd zapisu: ' + r.error.message);
  await loadUmowaTpl();
});
document.getElementById('tplDel').addEventListener('click', async () => {
  const nip = tplNip();
  if (nip.length !== 10 || !umowaTpl.custom) return tplShow('Ta firma nie ma zapisanego wzoru.');
  if (!confirm('Usunąć wzór klienta (NIP ' + nip + ') i wrócić do wzoru standardowego?')) return;
  const r = await window.sb.from('umowa_szablony').delete().eq('nip', nip).eq('typ', tplTyp());
  if (r.error) return tplShow('Błąd: ' + r.error.message);
  await loadUmowaTpl();
});
loadUmowaTpl();

// bilingual variant: on by default for non-Polish citizenship (until the user decides otherwise)
const tOn = document.getElementById('t_on');
const pObyw = document.getElementById('p_obywatelstwo');
let tOnTouched = false;
tOn.addEventListener('change', () => { tOnTouched = true; });
function syncTlumaczenie() {
  if (tOnTouched) return;
  const o = pObyw.value.trim().toLowerCase();
  tOn.checked = !!o && !/^pol/.test(o);
}
pObyw.addEventListener('input', syncTlumaczenie);

// ---------------- Worker directory (own Supabase) ----------------
function setVal(name, val) {
  const el = document.querySelector('[name="' + name + '"]');
  if (el && val != null) el.value = val;
}
function fillWorker(d) {
  const p = d.p || {}, a = d.adres || {}, m = d.meld;
  setVal('p_nazwisko', p.nazwisko); setVal('p_imiona', p.imiona); setVal('p_dataur', p.dataur);
  setVal('p_miejsceur', p.miejsceur); setVal('p_pesel', p.pesel); setVal('p_dowod', p.dowod);
  setVal('p_nip', p.nip); setVal('p_telefon', p.telefon); setVal('p_konto', p.konto);
  setVal('p_us', p.us); setVal('p_nfz', p.nfz); setVal('p_obywatelstwo', p.obywatelstwo); syncTlumaczenie();
  setVal('a_ulica', a.ulica); setVal('a_nrdom', a.nrdom); setVal('a_nrmiesz', a.nrmiesz);
  setVal('a_kod', a.kod); setVal('a_miejscowosc', a.miejscowosc); setVal('a_gmina', a.gmina);
  setVal('a_powiat', a.powiat); setVal('a_wojewodztwo', a.woj);
  if (m) {
    mSame.checked = false; meldunekFields.hidden = false;
    setVal('m_ulica', m.ulica); setVal('m_nrdom', m.nrdom); setVal('m_nrmiesz', m.nrmiesz);
    setVal('m_kod', m.kod); setVal('m_miejscowosc', m.miejscowosc); setVal('m_gmina', m.gmina);
    setVal('m_powiat', m.powiat); setVal('m_wojewodztwo', m.woj);
  } else { mSame.checked = true; meldunekFields.hidden = true; }
}
async function loadWorkers() {
  if (!window.Workers) return;
  const sel = document.getElementById('workerPicker');
  try {
    const ws = await window.Workers.list();
    sel.innerHTML = '<option value="">— nowy pracownik —</option>';
    ws.forEach((w) => {
      const o = document.createElement('option');
      o.value = w.id;
      o.textContent = ((w.nazwisko || '') + ' ' + (w.imiona || '')).trim() + (w.pesel ? ' · ' + w.pesel : '');
      sel.appendChild(o);
    });
  } catch (e) { console.warn('loadWorkers', e); }
}
(function initWorkers() {
  const sel = document.getElementById('workerPicker');
  const refresh = document.getElementById('workerRefresh');
  if (!sel) return;
  sel.addEventListener('change', async (e) => {
    if (!e.target.value) return;
    try { const w = await window.Workers.get(e.target.value); fillWorker(w.data || {}); }
    catch (err) { console.warn(err); }
  });
  if (refresh) refresh.addEventListener('click', loadWorkers);
  loadWorkers();
})();

// ---------------- Import from a zatrudnienie task (AI-kadry) ----------------
// The portal task list stores the submission payload in sessionStorage and opens
// this generator with ?from=zgloszenie. Field names already match (p_/a_/m_/r_/z_).
(function importFromZgloszenie() {
  try {
    // localStorage (shared across tabs) — the portal opens this page in a new tab.
    const raw = localStorage.getItem('tdcg_zlecenie_import');
    if (!raw) return;
    localStorage.removeItem('tdcg_zlecenie_import');
    // prevent autosave.restore() (runs after this script) from overwriting the import
    try { localStorage.removeItem('tdcg_autosave_umowa-zlecenie'); } catch (e2) { /* ignore */ }
    const d = JSON.parse(raw);
    Object.keys(d).forEach((k) => {
      const v = d[k];
      if (typeof v === 'string' && v !== '') setVal(k, v);
    });
    // meldunek toggle (intake stores m_same as a boolean)
    if (d.m_same === false) { mSame.checked = false; meldunekFields.hidden = false; }
    else { mSame.checked = true; meldunekFields.hidden = true; }
    // family-member toggle
    if (d.r_has === true || d.r_imienazwisko) { docRodzina.checked = true; rodzinaFields.hidden = false; }
    if (d.u_jedn) document.getElementById('u_jedn').dataset.touched = '1';
    if (d.u_godziny_zmienne === true) document.getElementById('u_godziny_zmienne').checked = true;
    if (d.u_minimalna === true) document.getElementById('u_minimalna').checked = true;
    if (d.u_bezterminowo === true) {
      document.getElementById('u_bezterminowo').checked = true;
      if (d.u_typ === 'praca') setVal('u_rodzaj', 'nieokreslony');
    }
    applyTyp();
    syncTlumaczenie();
    loadUmowaTpl();
    // cash payout chosen on intake -> include the "wypłata w gotówce" request
    if (d.p_gotowka === true) {
      const dg = document.querySelector('[name="doc_gotowka"]');
      if (dg) dg.checked = true;
    }
    // signing place (required, not collected on intake) — default to employer/worker city
    const dm = document.querySelector('[name="d_miejscowosc"]');
    if (dm && !dm.value) setVal('d_miejscowosc', d.z_miasto || d.a_miejscowosc || '');
    // visual confirmation
    const h1 = document.querySelector('h1');
    if (h1) {
      const note = document.createElement('div');
      note.textContent = '✓ Dane wczytane ze zgłoszenia — generuję komplet dokumentów…';
      note.style.cssText = 'margin:10px auto 0;max-width:640px;padding:10px 14px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:8px;font-size:13.5px;text-align:center';
      h1.parentNode.insertBefore(note, h1.nextSibling);
    }
    // auto-generate the packet from the submitted data (the form submit handler is
    // attached later in this file, so defer until it — and the fonts — are ready)
    setTimeout(function () {
      const btn = document.getElementById('submitBtn');
      if (btn) btn.click();
    }, 400);
  } catch (e) { console.warn('import zgloszenie', e); }
})();

// ---------------- wFirma: load company (zleceniodawca) ----------------
(function initWFirma() {
  const btn = document.getElementById('wfBtn');
  const pick = document.getElementById('wfPick');
  const sel = document.getElementById('wfCompanies');
  const status = document.getElementById('wfStatus');
  if (!btn || !window.WFirma) return;
  const setStatus = (m) => { status.textContent = m || ''; };

  btn.addEventListener('click', async () => {
    setStatus('Łączenie z wFirma...');
    btn.disabled = true;
    try {
      const data = await window.WFirma.companies();
      const list = (data && data.companies) || [];
      if (!list.length) { setStatus('Nie znaleziono firm w wFirma.'); return; }
      sel.innerHTML = '<option value="">— wybierz —</option>';
      list.forEach((c) => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name + (c.nip ? ' · NIP ' + c.nip : '');
        sel.appendChild(o);
      });
      pick.style.display = 'block';
      setStatus('Wybierz firmę z listy.');
    } catch (e) {
      if (e.status === 503) setStatus('Integracja wFirma będzie aktywna po dodaniu klucza appKey.');
      else setStatus('Błąd: ' + (e.message || e));
    } finally {
      btn.disabled = false;
    }
  });

  if (sel) sel.addEventListener('change', async () => {
    if (!sel.value) return;
    setStatus('Pobieranie danych firmy...');
    try {
      const data = await window.WFirma.company(sel.value);
      const c = data && data.company;
      if (!c) { setStatus('Brak danych firmy.'); return; }
      setVal('z_nazwa', c.name);
      setVal('z_miasto', c.city);
      setVal('z_ulica', c.street);
      if (c.nip) { setVal('z_nip', String(c.nip).replace(/\D/g, '')); loadUmowaTpl(); }
      setStatus('Dane Zleceniodawcy wczytane z wFirma.');
    } catch (e) {
      setStatus('Błąd: ' + (e.message || e));
    }
  });
})();

// ---------------- Font cache ----------------
let fontRegular = null, fontBold = null;
async function loadFonts() {
  if (fontRegular && fontBold) return;
  [fontRegular, fontBold] = await Promise.all([
    fetch('fonts/Roboto-Regular.ttf').then(r => r.arrayBuffer()),
    fetch('fonts/Roboto-Bold.ttf').then(r => r.arrayBuffer()),
  ]);
}

// ---------------- Data collection ----------------
function collectData() {
  const fd = new FormData(document.getElementById('form'));
  const get = (n) => (fd.get(n) || '').toString().trim();
  const chk = (n) => fd.get(n) != null;

  const sameMeld = chk('m_same');
  const typ = get('u_typ') === 'praca' ? 'praca' : 'zlecenie';
  return {
    typ,
    tlumaczenie: { on: chk('t_on'), jezyk: get('t_jezyk') },
    umowa: {
      stanowisko: get('u_stanowisko'), miejsce: get('u_miejsce'), od: get('u_od'), do: get('u_do'),
      rodzaj: get('u_rodzaj'), wymiar: get('u_wymiar'), stawka: get('u_stawka'), jedn: get('u_jedn'),
      wyplata: get('u_wyplata'), numer: get('u_numer'), bezterminowo: chk('u_bezterminowo'), minimalna: chk('u_minimalna'), godziny: get('u_godziny'), godzinyZmienne: chk('u_godziny_zmienne'),
    },
    umowaTpl: umowaTpl.custom || '',
    z: {
      nazwa: get('z_nazwa'),
      miasto: get('z_miasto'),
      ulica: get('z_ulica'),
      iodAdres: get('z_iod_adres'),
      iodEmail: get('z_iod_email'),
      nip: get('z_nip'), regon: get('z_regon'), krs: get('z_krs'), reprezentant: get('z_reprezentant'),
    },
    p: {
      nazwisko: get('p_nazwisko'),
      imiona: get('p_imiona'),
      dataur: get('p_dataur'),
      miejsceur: get('p_miejsceur'),
      obywatelstwo: get('p_obywatelstwo'),
      pesel: get('p_pesel'),
      dowod: get('p_dowod'),
      nip: get('p_nip'),
      telefon: get('p_telefon'),
      konto: get('p_konto'),
      us: get('p_us'),
      nfz: get('p_nfz'),
    },
    adres: {
      ulica: get('a_ulica'), nrdom: get('a_nrdom'), nrmiesz: get('a_nrmiesz'),
      kod: get('a_kod'), miejscowosc: get('a_miejscowosc'),
      gmina: get('a_gmina'), powiat: get('a_powiat'), woj: get('a_wojewodztwo'),
    },
    meld: sameMeld ? null : {
      ulica: get('m_ulica'), nrdom: get('m_nrdom'), nrmiesz: get('m_nrmiesz'),
      kod: get('m_kod'), miejscowosc: get('m_miejscowosc'),
      gmina: get('m_gmina'), powiat: get('m_powiat'), woj: get('m_wojewodztwo'),
    },
    sign: { miejscowosc: get('d_miejscowosc'), data: get('d_data') },
    docs: Object.keys(DOC_FIELD).reduce((o, k) => { o[k] = chk(DOC_FIELD[k]); return o; }, {}),
    rodzina: {
      od: get('r_od'), imienazwisko: get('r_imienazwisko'),
      pesel: get('r_pesel'), dataur: get('r_dataur'), adres: get('r_adres'),
    },
  };
}

function fullName(p) { return `${p.imiona} ${p.nazwisko}`.trim(); }
function addrOneLine(a) {
  if (!a) return '';
  let s = a.ulica || '';
  if (a.nrdom) s += ' ' + a.nrdom;
  if (a.nrmiesz) s += '/' + a.nrmiesz;
  const cityPart = [a.kod, a.miejscowosc].filter(Boolean).join(' ');
  if (cityPart) s += (s ? ', ' : '') + cityPart;
  return s.trim();
}
function meldOrZam(d) { return addrOneLine(d.meld || d.adres); }

// ============================================================
//                    PDF LAYOUT ENGINE
// ============================================================
// Every text helper renders into C.cols: one full-width Polish column, or — in the
// bilingual variant — Polish on the left and the translation opposite it on the
// right. Rows of both columns advance together, so a paragraph and its translation
// always start on the same line.
const A4 = [595.28, 841.89];
const MARGIN = 56;
const SIZE = 10.5;
const LH = 15;
const GUTTER = 18;

// A "face" measures and draws text with one PDF font...
function plainFace(font) {
  return {
    widthOfTextAtSize: (t, s) => font.widthOfTextAtSize(t, s),
    draw: (page, t, o) => page.drawText(t, Object.assign({ font }, o)),
  };
}
// ...or with a script font (Georgian, Armenian) falling back to Roboto for the
// characters it lacks — Latin names, digits and Polish abbreviations inside a translation.
function mixedFace(main, fallback) {
  const has = new Set(main.getCharacterSet());
  const runs = (t) => {
    const out = [];
    for (const ch of String(t)) {
      const f = has.has(ch.codePointAt(0)) ? main : fallback;
      const last = out[out.length - 1];
      if (last && last.font === f) last.text += ch; else out.push({ font: f, text: ch });
    }
    return out;
  };
  return {
    widthOfTextAtSize: (t, s) => runs(t).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, s), 0),
    draw: (page, t, o) => {
      let x = o.x;
      for (const r of runs(t)) {
        page.drawText(r.text, Object.assign({}, o, { x, font: r.font }));
        x += r.font.widthOfTextAtSize(r.text, o.size);
      }
    },
  };
}

// f: { pl, plBold, tr, trBold } faces; tr: Polish string -> translation (or null = Polish only)
function makeCtx(doc, f, tr) {
  const bi = !!tr;
  const margin = bi ? 36 : MARGIN;
  const innerW = A4[0] - margin * 2;
  const colW = bi ? (innerW - GUTTER) / 2 : innerW;
  const cols = [{ x: margin, w: colW, font: f.pl, bold: f.plBold, t: (s) => s }];
  if (bi) cols.push({ x: margin + colW + GUTTER, w: colW, font: f.tr, bold: f.trBold, t: tr });
  return { doc, cols, bi, k: bi ? 0.88 : 1, font: f.pl, page: null, W: A4[0], H: A4[1], margin, innerW, y: 0 };
}
function newPage(C, plain) {
  C.page = C.doc.addPage(A4);
  C.y = C.H - C.margin;
  if (C.bi && !plain) { // hairline between the original and the translation
    const x = C.cols[1].x - GUTTER / 2;
    C.page.drawLine({ start: { x, y: C.margin - 12 }, end: { x, y: C.H - C.margin + 12 }, thickness: 0.4, color: rgb(0.82, 0.82, 0.82) });
  }
}
function ensure(C, h) { if (C.y - h < C.margin) newPage(C); }

// Text is a string, or [template, ...values]: only the template is translated, the
// values ({0}, {1}… — names, addresses, dates) are inserted unchanged in both columns.
function txt(col, text, raw) {
  if (Array.isArray(text)) return fillArgs(col, col.t(text[0]), text.slice(1));
  return raw ? String(text == null ? '' : text) : col.t(text);
}
// a value may itself be a translatable phrase: { tr: 'od dnia {0} do dnia {1}', args: [...] }
function fillArgs(col, s, args) {
  return s.replace(/\{(\d+)\}/g, (m, i) => {
    const a = args[i];
    if (a == null) return '';
    return a.tr ? fillArgs(col, col.t(a.tr), a.args || []) : a;
  });
}
// second-column translation of a short caption ('' when not bilingual)
function trOf(C, text) { return C.bi ? C.cols[1].t(text) : ''; }

function wrapLines(text, font, size, maxWidth) {
  const out = [];
  if (text == null) return out;
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line); line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

// draw the per-column line arrays row by row, keeping the columns aligned
function drawRows(C, blocks, lh, drawLine) {
  const n = Math.max.apply(null, blocks.map(b => b.lines.length));
  for (let i = 0; i < n; i++) {
    ensure(C, lh);
    blocks.forEach(b => { if (i < b.lines.length) drawLine(b, b.lines[i], i); });
    C.y -= lh;
  }
}

// paragraph at current y (left aligned, optional indent/hanging)
function para(C, text, opt) {
  opt = opt || {};
  const size = (opt.size || SIZE) * C.k;
  const lh = (opt.lh || LH) * C.k;
  const indent = (opt.indent || 0) * C.k;
  const hang = (opt.hang || 0) * C.k; // extra indent for wrapped lines
  const color = opt.color || rgb(0, 0, 0);
  const blocks = C.cols.map(col => {
    const face = opt.bold ? col.bold : col.font;
    return { col, face, lines: wrapLines(txt(col, text, opt.raw), face, size, col.w - indent - hang) };
  });
  drawRows(C, blocks, lh, (b, line, i) => {
    b.face.draw(C.page, line, { x: b.col.x + indent + (i === 0 ? 0 : hang), y: C.y, size, color });
  });
  if (opt.after != null) C.y -= opt.after * C.k;
}
function gap(C, h) { C.y -= h * C.k; }
function center(C, text, opt) {
  opt = opt || {};
  const size = (opt.size || SIZE) * C.k;
  const lh = (opt.lh || LH) * C.k;
  const color = opt.color || rgb(0, 0, 0);
  const blocks = C.cols.map(col => {
    const face = opt.bold ? col.bold : col.font;
    return { col, face, lines: wrapLines(txt(col, text), face, size, col.w) };
  });
  drawRows(C, blocks, lh, (b, line) => {
    const w = b.face.widthOfTextAtSize(line, size);
    b.face.draw(C.page, line, { x: b.col.x + (b.col.w - w) / 2, y: C.y, size, color });
  });
  if (opt.after != null) C.y -= opt.after * C.k;
}
function title(C, text) {
  center(C, text, { bold: true, size: 13.5, lh: 18 });
  gap(C, 8);
}
// "Label: value" — bold (translated) label, then the value flowing after it
function field(C, label, value, opt) {
  opt = opt || {};
  const size = SIZE * C.k, lh = LH * C.k;
  const blocks = C.cols.map(col => {
    const segs = [{ face: col.bold, text: txt(col, label) + ':' }, { face: C.cols[0].font, text: value || '' }];
    const lines = [[]];
    let w = 0;
    segs.forEach(s => String(s.text).split(/\s+/).filter(Boolean).forEach(word => {
      let line = lines[lines.length - 1];
      const sp = line.length ? s.face.widthOfTextAtSize(' ', size) : 0;
      const ww = s.face.widthOfTextAtSize(word, size);
      if (line.length && w + sp + ww > col.w) { line = []; lines.push(line); w = 0; line.push({ face: s.face, text: word, x: 0 }); w = ww; }
      else { line.push({ face: s.face, text: word, x: w + sp }); w += sp + ww; }
    }));
    return { col, lines };
  });
  drawRows(C, blocks, lh, (b, line) => {
    line.forEach(p => p.face.draw(C.page, p.text, { x: b.col.x + p.x, y: C.y, size, color: rgb(0, 0, 0) }));
  });
  if (opt.after != null) C.y -= opt.after * C.k;
}
function checkbox(C, x, yBaseline, checked) {
  const s = 9 * C.k;
  const yb = yBaseline - 1;
  C.page.drawRectangle({ x, y: yb, width: s, height: s, borderWidth: 0.8, borderColor: rgb(0, 0, 0) });
  if (checked) {
    C.page.drawLine({ start: { x: x + 1.5, y: yb + 1.5 }, end: { x: x + s - 1.5, y: yb + s - 1.5 }, thickness: 1, color: rgb(0, 0, 0) });
    C.page.drawLine({ start: { x: x + 1.5, y: yb + s - 1.5 }, end: { x: x + s - 1.5, y: yb + 1.5 }, thickness: 1, color: rgb(0, 0, 0) });
  }
}
// checkbox + label line (the box is drawn once, next to the Polish original)
function checkLine(C, label, checked, opt) {
  opt = opt || {};
  const size = (opt.size || SIZE) * C.k, lh = (opt.lh || LH) * C.k;
  const off = (opt.indent || 0) * C.k, box = 15 * C.k;
  const blocks = C.cols.map(col => ({ col, lines: wrapLines(txt(col, label), col.font, size, col.w - off - box) }));
  drawRows(C, blocks, lh, (b, line, i) => {
    if (i === 0 && b.col === C.cols[0]) checkbox(C, b.col.x + off, C.y, !!checked);
    b.col.font.draw(C.page, line, { x: b.col.x + off + box, y: C.y, size, color: rgb(0, 0, 0) });
  });
}
// centred grey caption under a signature line; the translation goes on a second line
function caption(C, text, x, lineLen, size, y) {
  const grey = rgb(0.45, 0.45, 0.45);
  const pl = C.cols[0].font;
  pl.draw(C.page, text, { x: x + (lineLen - pl.widthOfTextAtSize(text, size)) / 2, y, size, color: grey });
  const tr = trOf(C, text);
  if (!tr) return 0;
  const f = C.cols[1].font;
  f.draw(C.page, tr, { x: x + (lineLen - f.widthOfTextAtSize(tr, size)) / 2, y: y - size - 2, size, color: grey });
  return size + 2;
}
// signature underline with caption(s)
function signature(C, cap, opt) {
  opt = opt || {};
  const lineLen = opt.lineLen || 240;
  const align = opt.align || 'left'; // left|right|center
  gap(C, opt.top != null ? opt.top : 28);
  ensure(C, 36);
  let xStart;
  if (align === 'right') xStart = C.W - C.margin - lineLen;
  else if (align === 'center') xStart = (C.W - lineLen) / 2;
  else xStart = C.margin;
  C.page.drawLine({ start: { x: xStart, y: C.y }, end: { x: xStart + lineLen, y: C.y }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2) });
  C.y -= 12;
  C.y -= caption(C, cap, xStart, lineLen, 8.5, C.y);
  C.y -= 12;
}
// top-right place & date block
function placeDate(C, miejscowosc, dataIso) {
  ensure(C, 34);
  const f = C.cols[0].font;
  const t = `${miejscowosc || '..........................'}, dnia ${isoToPLDots(dataIso) || '..............'} r.`;
  const w = f.widthOfTextAtSize(t, SIZE);
  f.draw(C.page, t, { x: C.W - C.margin - w, y: C.y, size: SIZE, color: rgb(0, 0, 0) });
  C.y -= 11;
  C.y -= caption(C, '(miejscowość i data)', C.W - C.margin - w, w, 8, C.y);
  C.y -= 24;
}
function twoSignatures(C, leftCap, rightCap) {
  gap(C, 36);
  ensure(C, 40);
  const lineLen = 200;
  const xs = [C.margin, C.W - C.margin - lineLen];
  let extra = 0;
  [leftCap, rightCap].forEach((cap, i) => {
    const x = xs[i];
    C.page.drawLine({ start: { x, y: C.y }, end: { x: x + lineLen, y: C.y }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2) });
    extra = Math.max(extra, caption(C, cap, x, lineLen, 8.5, C.y - 12));
  });
  C.y -= 26 + extra;
}

// ============================================================
//                    DOCUMENT RENDERERS
// ============================================================
// Role wording per contract type. Whole sentences are kept per type (not glued
// from words) so each one translates as a unit.
const ROLE = {
  zlecenie: { strona1: 'Podpis Zleceniobiorcy', strona2: 'Podpis Zleceniodawcy lub osoby upoważnionej', podpis: 'podpis zleceniobiorcy', podpisOs: 'data i podpis Zleceniobiorcy', podpisFirma: 'data i podpis Zleceniodawcy' },
  praca: { strona1: 'Pracodawca', strona2: 'Pracownik', podpis: 'podpis pracownika', podpisOs: 'data i podpis Pracownika', podpisFirma: 'data i podpis Pracodawcy' },
};
const DOTS = '..............................';

// 0. UMOWA — the contract itself, rendered from a text template.
// Template syntax (the same for our standard contracts and for a client's own one):
//   "# Tytuł", "## Nagłówek paragrafu", blank line = odstęp, "[podpisy]" = signature lines,
//   "1. …" / "- …" = point with hanging indent, {{nazwa}} = value from the form.
const UMOWA_STANDARD = {
  // wording and structure follow the office's wFirma contract
  zlecenie: `# Umowa zlecenie
## nr {{numer}}
Zawarta w dniu {{data_zawarcia}} w miejscowości {{miejscowosc}} pomiędzy
{{firma}} z siedzibą {{firma_adres}}, NIP {{firma_nip}} REGON {{firma_regon}}, reprezentowaną przez {{reprezentant}}, zwaną dalej Zleceniodawcą, a Panem/Panią
{{imie_nazwisko}}, zamieszkałym/ą {{adres}}, PESEL {{pesel}}, zwanym/ą Zleceniobiorcą.

## §1 - Przedmiot umowy
Zleceniobiorca zobowiązuje się na zlecenie Zleceniodawcy do wykonania następujących czynności: {{stanowisko}}

## §2 - Czas trwania umowy
Umowa niniejsza zostaje zawarta {{okres}}

## §3 - Wynagrodzenie
1. Z tytułu wykonywanych czynności opisanych w §1 niniejszej umowy Zleceniobiorca otrzyma wynagrodzenie w wysokości {{wynagrodzenie}}.
2. Wymieniona kwota zostanie zapłacona {{forma_wyplaty}} Zleceniobiorcy lub osobie upoważnionej przez Zleceniobiorcę w terminie 7 dni po przedłożeniu rachunku do umowy.
3. Zleceniodawca zastrzega sobie prawo dokonania stosownych potrąceń z wynagrodzenia na poczet zaliczki na podatek dochodowy i składek ZUS.
4. Zleceniobiorca oświadcza, że w zakresie wykonywanej umowy zlecenie nie prowadzi działalności gospodarczej w rozumieniu art. 10 ust. 1 pkt 3 ustawy z 26 lipca 1991 r. o podatku dochodowym od osób fizycznych (Dz.U. z 2000 r. nr 14, poz. 176 z późn. zm.).

## §4 - Warunki wykonywania umowy
1. Zleceniobiorca zobowiązuje się wykonywać powierzone czynności z należytą starannością i nie powierzać osobie trzeciej wykonania czynności będących przedmiotem niniejszej umowy bez uprzedniego zezwolenia Zleceniodawcy.
2. Zleceniobiorca nie może bez uprzedniej pisemnej zgody Zleceniodawcy zmienić uzgodnionego sposobu wykonywania zlecenia.
3. Zleceniobiorca zobowiązuje się udzielać Zleceniodawcy potrzebnych informacji o przebiegu wykonywania zlecenia.

## §5 - Odpowiedzialność Zleceniodawcy
Odpowiedzialność wobec osób trzecich za wykonaną przez Zleceniobiorcę umowę zlecenia przechodzi na Zleceniodawcę z dniem wykonania umowy.

## §6 - Inne postanowienia
1. W sprawach nieuregulowanych w niniejszej umowie mają zastosowanie przepisy kodeksu cywilnego.
2. Ewentualne spory mogące wyniknąć z realizacji niniejszej umowy podlegają rozstrzygnięciu przez sąd powszechny miejscowo właściwy dla siedziby Zleceniodawcy.
3. Wszelkie zmiany niniejszej umowy wymagają zachowania formy pisemnej pod rygorem nieważności.
4. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach po jednym dla każdej strony.
[podpisy]

Wyrażam zgodę na przetwarzanie moich danych osobowych dla celów niezbędnych do zawarcia oraz realizacji niniejszej umowy, zgodnie z Rozporządzeniem Parlamentu Europejskiego i Rady (UE) 2016/679 z dnia 27 kwietnia 2016 r. w sprawie ochrony osób fizycznych w związku z przetwarzaniem danych osobowych i w sprawie swobodnego przepływu takich danych oraz uchylenia dyrektywy 95/46/WE (ogólne rozporządzenie o ochronie danych). Przyjmuję do wiadomości, że podanie tych danych jest dobrowolne, ale niezbędne do zawarcia i realizacji umowy.
[podpis]`,
  praca: `# UMOWA O PRACĘ
{{rodzaj_umowy}}
zawarta w dniu {{data_zawarcia}} w miejscowości {{miejscowosc}} pomiędzy:
{{firma}} z siedzibą: {{firma_adres}}, NIP: {{firma_nip}}, reprezentowaną przez: {{reprezentant}}, zwaną dalej „Pracodawcą”,
a
{{imie_nazwisko}}, zamieszkałym/ą: {{adres}}, PESEL: {{pesel}}, dokument tożsamości: {{dokument}}, obywatelstwo: {{obywatelstwo}}, zwanym/ą dalej „Pracownikiem”.

## § 1. Rodzaj umowy
1. Strony zawierają umowę o pracę {{rodzaj_umowy}}, {{okres}}.
2. Dotyczy wyłącznie umowy na okres próbny: po upływie okresu próbnego strony zamierzają zawrzeć umowę o pracę na czas określony krótszy niż 6 miesięcy / na czas określony wynoszący co najmniej 6 miesięcy i krótszy niż 12 miesięcy / na czas określony wynoszący co najmniej 12 miesięcy albo na czas nieokreślony (niepotrzebne skreślić).

## § 2. Warunki zatrudnienia
1. Rodzaj umówionej pracy (stanowisko): {{stanowisko}}.
2. Miejsce wykonywania pracy: {{miejsce_pracy}}.
3. Wymiar czasu pracy: {{wymiar}}.
4. Wynagrodzenie w wysokości {{wynagrodzenie}}, płatne do {{termin_wyplaty}} dnia następnego miesiąca kalendarzowego.
5. Dzień rozpoczęcia pracy: {{data_od}}.
6. Dopuszczalna liczba godzin pracy ponad określony w umowie wymiar czasu pracy, których przekroczenie uprawnia pracownika zatrudnionego w niepełnym wymiarze do dodatku jak za godziny nadliczbowe: ..............................

## § 3. Obowiązki stron
1. Pracownik zobowiązuje się wykonywać pracę sumiennie i starannie, stosować się do poleceń przełożonych dotyczących pracy, przestrzegać czasu pracy, regulaminu pracy oraz przepisów i zasad bezpieczeństwa i higieny pracy.
2. Pracownik zobowiązuje się zachować w tajemnicy informacje, których ujawnienie mogłoby narazić Pracodawcę na szkodę.
3. Pracodawca zobowiązuje się zatrudniać Pracownika za wynagrodzeniem i na warunkach określonych w umowie oraz zapewnić bezpieczne i higieniczne warunki pracy.

## § 4. Postanowienia końcowe
1. Wszelkie zmiany warunków umowy wymagają formy pisemnej.
2. W sprawach nieuregulowanych umową stosuje się przepisy Kodeksu pracy.
3. Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.
4. Pracownik potwierdza otrzymanie jednego egzemplarza umowy przed dopuszczeniem do pracy.
[podpisy]`,
};
const UMOWA_RODZAJ = { probny: 'na okres próbny', okreslony: 'na czas określony', nieokreslony: 'na czas nieokreślony' };
const UMOWA_JEDN = { godz: 'brutto za godzinę', mies: 'brutto miesięcznie' };
// "w wysokości …" when the statutory minimum is agreed instead of an amount (wording as in wFirma)
const UMOWA_MIN = {
  zlecenie: 'minimalnej stawki godzinowej, zgodnie z ustawą z dnia 10 października 2002 r. o minimalnym wynagrodzeniu za pracę (Dz. U. 2002, nr 200, poz. 1679, z późn. zm.), za 1 godzinę',
  praca: 'minimalnego wynagrodzenia za pracę, zgodnie z ustawą z dnia 10 października 2002 r. o minimalnym wynagrodzeniu za pracę (Dz. U. 2002, nr 200, poz. 1679, z późn. zm.), miesięcznie — proporcjonalnie do wymiaru czasu pracy',
};

// {{placeholder}} -> value. { tr } values are Polish phrases translated in the second column.
function umowaValues(d) {
  const u = d.umowa, od = isoToPLDots(u.od), dd = isoToPLDots(u.do);
  const bezterm = u.bezterminowo || (d.typ === 'praca' && u.rodzaj === 'nieokreslony');
  return {
    firma: d.z.nazwa, firma_adres: [d.z.ulica, d.z.miasto].filter(Boolean).join(', '),
    firma_nip: d.z.nip, firma_regon: d.z.regon, firma_krs: d.z.krs, reprezentant: d.z.reprezentant,
    imie_nazwisko: fullName(d.p), pesel: d.p.pesel, data_urodzenia: isoToPLDots(d.p.dataur),
    obywatelstwo: d.p.obywatelstwo, dokument: d.p.dowod, adres: addrOneLine(d.adres), konto: d.p.konto,
    stanowisko: u.stanowisko && { tr: u.stanowisko }, miejsce_pracy: u.miejsce,
    wymiar: u.wymiar && { tr: u.wymiar }, stawka: u.stawka, jednostka: { tr: UMOWA_JEDN[u.jedn] || UMOWA_JEDN.godz },
    wynagrodzenie: u.minimalna ? { tr: UMOWA_MIN[d.typ] }
      : { tr: '{0} zł {1}', args: [u.stawka || DOTS, { tr: UMOWA_JEDN[u.jedn] || UMOWA_JEDN.godz }] },
    termin_wyplaty: u.wyplata, numer: u.numer,
    forma_wyplaty: { tr: d.docs.gotowka ? 'gotówką' : 'przelewem na rachunek bankowy' },
    godziny: u.godzinyZmienne ? { tr: 'zmienna liczba godzin — według comiesięcznej ewidencji' }
      : (u.godziny ? { tr: '{0} godzin miesięcznie', args: [u.godziny] } : ''), data_zawarcia: isoToPLDots(d.sign.data), miejscowosc: d.sign.miejscowosc,
    data_od: od, data_do: dd,
    rodzaj_umowy: { tr: bezterm ? UMOWA_RODZAJ.nieokreslony : (UMOWA_RODZAJ[u.rodzaj] || UMOWA_RODZAJ.okreslony) },
    okres: bezterm ? { tr: d.typ === 'praca' ? 'od dnia {0}' : 'na czas nieokreślony od dnia {0}', args: [od || DOTS] }
      : { tr: d.typ === 'praca' ? 'na okres od dnia {0} do dnia {1}' : 'na czas od dnia {0} do dnia {1}', args: [od || DOTS, dd || DOTS] },
  };
}
function docUmowa(C, d) {
  newPage(C);
  const vals = umowaValues(d);
  const tpl = d.umowaTpl || UMOWA_STANDARD[d.typ];
  tpl.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) { gap(C, 5); return; }
    if (/^\[podpisy\]$/i.test(line)) { twoSignatures(C, ROLE[d.typ].strona1, ROLE[d.typ].strona2); return; }
    if (/^\[podpis\]$/i.test(line)) { signature(C, ROLE[d.typ].podpis, { align: 'left', top: 24, lineLen: 200 }); return; }
    let m, kind = 'p', body = line;
    if ((m = line.match(/^##\s+(.*)$/))) { kind = 'h'; body = m[1]; }
    else if ((m = line.match(/^#\s+(.*)$/))) { kind = 't'; body = m[1]; }
    const args = [];
    const t = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (x, k) => {
      const v = vals[k.toLowerCase()];
      args.push(v == null || v === '' ? DOTS : v);
      return '{' + (args.length - 1) + '}';
    });
    const text = args.length ? [t].concat(args) : t;
    if (kind === 't') title(C, text);
    else if (kind === 'h') { gap(C, 4); center(C, text, { bold: true, after: 4 }); }
    else para(C, text, { hang: /^(\d+[.)]|[-–•])\s/.test(body) ? 14 : 0, after: 3 });
  });
}

// 1. KWESTIONARIUSZ OSOBOWY
function docKwestionariusz(C, d) {
  newPage(C);
  title(C, 'KWESTIONARIUSZ OSOBOWY');
  center(C, '(prosimy o uważne przeczytanie i wypełnienie drukowanymi literami lub elektronicznie)', { size: 9, lh: 12, color: rgb(0.4, 0.4, 0.4) });
  gap(C, 12);
  para(C, 'DANE OSOBOWE:', { bold: true, after: 6 });
  field(C, 'Nazwisko i imiona', `${d.p.nazwisko} ${d.p.imiona}`.trim());
  field(C, 'Data urodzenia', isoToPLDots(d.p.dataur));
  field(C, 'Obywatelstwo', d.p.obywatelstwo);
  field(C, 'Numer ewidencyjny PESEL', d.p.pesel);
  field(C, 'Seria i numer dowodu osobistego / paszportu', d.p.dowod);
  field(C, 'Telefon kontaktowy', d.p.telefon, { after: 8 });

  para(C, 'Adres zamieszkania / do korespondencji:', { bold: true, after: 4 });
  field(C, 'Ulica, nr domu / nr mieszkania', addrStreet(d.adres));
  field(C, 'Kod pocztowy, miejscowość', [d.adres.kod, d.adres.miejscowosc].filter(Boolean).join(' '));
  field(C, 'Gmina', d.adres.gmina);
  field(C, 'Powiat', d.adres.powiat);
  field(C, 'Województwo', d.adres.woj, { after: 8 });

  if (d.meld) {
    para(C, 'Adres zameldowania (ujęty na rocznej deklaracji PIT):', { bold: true, after: 4 });
    field(C, 'Ulica, nr domu / nr mieszkania', addrStreet(d.meld));
    field(C, 'Kod pocztowy, miejscowość', [d.meld.kod, d.meld.miejscowosc].filter(Boolean).join(' '));
    field(C, 'Gmina', d.meld.gmina);
    field(C, 'Powiat', d.meld.powiat);
    field(C, 'Województwo', d.meld.woj, { after: 8 });
  }

  para(C, 'Dane właściwego Urzędu Skarbowego:', { bold: true, after: 4 });
  field(C, 'Nazwa', d.p.us, { after: 8 });
  field(C, 'Należę do Narodowego Funduszu Zdrowia (Oddział)', d.p.nfz);

  signature(C, 'Czytelny podpis', { align: 'right', top: 40 });
}
function addrStreet(a) {
  let s = a.ulica || '';
  if (a.nrdom) s += ' ' + a.nrdom;
  if (a.nrmiesz) s += '/' + a.nrmiesz;
  return s.trim();
}

// shared identity block for tax/ZUS oświadczenia
function identityBlock(C, d, withNip) {
  field(C, 'Imię i nazwisko', fullName(d.p));
  field(C, 'Data i miejsce urodzenia', [isoToPLDots(d.p.dataur), d.p.miejsceur].filter(Boolean).join(', '));
  field(C, 'PESEL', d.p.pesel);
  if (withNip) field(C, 'NIP', d.p.nip);
  field(C, 'Numer paszportu lub dowodu osobistego', d.p.dowod);
  field(C, 'Adres zameldowania', meldOrZam(d));
  field(C, 'Adres zamieszkania na cele podatkowe', addrOneLine(d.adres));
  field(C, 'Numer konta bankowego', d.p.konto);
  field(C, 'Urząd Skarbowy', d.p.us);
  field(C, 'Oddział NFZ', d.p.nfz, { after: 10 });
}

const RODO_CONSENT = 'Wyrażam zgodę na przetwarzanie moich danych osobowych dla potrzeb niezbędnych do zawarcia i realizacji umowy cywilnoprawnej zgodnie z Rozporządzeniem Parlamentu Europejskiego i Rady (UE) 2016/679 z dnia 27 kwietnia 2016 r. w sprawie ochrony osób fizycznych w związku z przetwarzaniem danych osobowych i w sprawie swobodnego przepływu takich danych oraz uchylenia dyrektywy 95/46/WE (ogólne rozporządzenie o ochronie danych).';
const PT_NIEPELNOSPR = 'Nie posiadam/Posiadam* orzeczenie o lekkim/umiarkowanym/znacznym* stopniu niepełnosprawności wydane na okres od .................. do ...................';
const PT_EMERYT = 'Nie jestem/Jestem* emerytem lub rencistą — nr decyzji ZUS i data jego przyznania ........................................';
const PT_STUDENT = 'Nie jestem/Jestem* uczniem lub studentem.';
const PT_REZYDENCJA = 'Posiadam/Nie posiadam* certyfikat rezydencji podatkowej wydany na okres od .................. do ...................';
const NOTE_SKRESLIC = '* niepotrzebne skreślić';

// 2. OŚWIADCZENIE ZLECENIOBIORCY (cele podatkowe i ZUS) — 5c
function docOswiadczenieZus(C, d) {
  newPage(C);
  title(C, 'Oświadczenie zleceniobiorcy dla celów podatkowych i ubezpieczenia ZUS');
  identityBlock(C, d, false);
  para(C, 'Jako Zleceniobiorca oświadczam, że:', { after: 6 });

  const pts = [
    'Nie jestem/Jestem* jednocześnie zatrudniona/ny na podstawie umowy o pracę lub równorzędnej, a moje wynagrodzenie ze stosunku pracy w kwocie brutto wynosi:',
    'Nie jestem/Jestem* jednocześnie już ubezpieczona/ny (ubezpieczenie emerytalne i rentowe) jako osoba wykonująca pracę nakładczą; umowę zlecenia lub agencyjną, wynagrodzenie z tej umowy przekracza/nie przekracza* minimalnego wynagrodzenia za pracę.',
    'Nie jestem/Jestem* już ubezpieczona/ny (ubezpieczenie emerytalne i rentowe) z innych tytułów niż w pkt 1 i 2 (np. działalność gospodarcza, KRUS) ................................ (podać tytuł).',
    PT_EMERYT,
    PT_NIEPELNOSPR,
    PT_STUDENT,
    'Nie jestem/Jestem* zarejestrowana/ny jako osoba bezrobotna.',
    'Nie jestem/Jestem* objęta/ty ubezpieczeniem społecznym z innego tytułu. Zgodnie z powyższym oświadczeniem z tytułu wykonywania tej umowy:',
    'Nie chcę/chcę*, aby moje przychody zostały objęte zwolnieniem z PIT**.',
    PT_REZYDENCJA,
    'Limit kosztów autorskich zastosowanych w bieżącym roku przekracza/nie przekracza* ograniczenia rocznego***. Dotychczas zastosowano ........................................',
  ];
  for (let i = 0; i < pts.length; i++) {
    para(C, ['{0}.  ' + pts[i], i + 1], { hang: 18, after: 2 });
    if (i === 0) {
      checkLine(C, 'co najmniej minimalne wynagrodzenie,', false, { indent: 18 });
      checkLine(C, 'mniej niż minimalne wynagrodzenie.', false, { indent: 18 });
      para(C, 'W czasie wykonywania umowy zlecenie, której dotyczy oświadczenie nie przebywam/przebywam* na urlopie bezpłatnym/wychowawczym/macierzyńskim przyznanym w okresie od ................ do ................ .', { indent: 18, after: 4 });
    }
    if (i === 7) {
      checkLine(C, 'chcę / nie chcę* być objęta/y dobrowolnym ubezpieczeniem chorobowym,', false, { indent: 18 });
      checkLine(C, 'chcę / nie chcę* być objęta/y dobrowolnym ubezpieczeniem emerytalnym i rentowym.', false, { indent: 18 });
    }
  }
  gap(C, 6);
  signature(C, 'podpis zleceniobiorcy', { align: 'right', top: 18 });

  para(C, 'Oświadczam, iż wszystkie informacje są zgodne ze stanem faktycznym i prawnym, a odpowiedzialność karna za podanie informacji niezgodnych z prawdą lub ich zatajenie jest mi znana. Zobowiązuję się do poinformowania w formie pisemnej Zleceniodawcy niezwłocznie, nie później jednak niż w ciągu 3 dni o wszelkich zmianach dotyczących treści niniejszego oświadczenia oraz przejmuję odpowiedzialność z tytułu niedotrzymania powyższego zobowiązania.', { size: 9.5, lh: 13, after: 2 });
  signature(C, 'podpis zleceniobiorcy', { align: 'right', top: 10 });

  para(C, RODO_CONSENT, { size: 9.5, lh: 13, after: 2 });
  signature(C, 'podpis zleceniobiorcy', { align: 'right', top: 10 });

  gap(C, 10);
  para(C, '* niepotrzebne skreślić    ** dotyczy osób do 26. roku życia    *** dotyczy umów z przeniesieniem praw autorskich', { size: 8, lh: 11, color: rgb(0.4, 0.4, 0.4) });
}

// 3. OŚWIADCZENIE WYKONAWCY (cele podatkowe) — 5b
function docOswiadczenieWykonawcy(C, d) {
  newPage(C);
  para(C, d.z.nazwa, { raw: true, size: 9.5, color: rgb(0.35, 0.35, 0.35), after: 6 });
  title(C, 'Oświadczenie wykonawcy dla celów podatkowych');
  identityBlock(C, d, true);
  para(C, 'Jako Wykonawca oświadczam, że:', { after: 6 });
  para(C, ['{0}.  ' + PT_REZYDENCJA, 1], { hang: 18, after: 4 });
  para(C, '2.  Limit kosztów autorskich zastosowanych w bieżącym roku przekracza/nie przekracza* ograniczenia rocznego***. Dotychczas zastosowano ........................................', { hang: 18, after: 2 });
  signature(C, 'podpis wykonawcy', { align: 'right', top: 18 });

  para(C, 'Stwierdzam, że powyższe dane podałem/am zgodnie ze stanem faktycznym. Odpowiedzialność karna za podanie danych niezgodnych z prawdą jest mi znana. Jednocześnie zobowiązuję się do powiadomienia płatnika o wszelkich zmianach w stosunku do stanu faktycznego wynikającego z oświadczenia.', { size: 9.5, lh: 13, after: 2 });
  signature(C, 'podpis wykonawcy', { align: 'right', top: 10 });

  para(C, RODO_CONSENT, { size: 9.5, lh: 13, after: 2 });
  signature(C, 'podpis wykonawcy', { align: 'right', top: 10 });

  gap(C, 10);
  para(C, '* niepotrzebne skreślić    ** dotyczy osób prowadzących własną działalność gospodarczą    *** dotyczy umów z przeniesieniem praw autorskich', { size: 8, lh: 11, color: rgb(0.4, 0.4, 0.4) });
}

// 4. INFORMACJA DOTYCZĄCA PPK — 1
function docInformacjaPpk(C, d) {
  newPage(C);
  field(C, 'Imię i nazwisko składającego oświadczenie', fullName(d.p));
  gap(C, 8);
  title(C, 'Informacja dotycząca PPK');
  para(C, 'Pracownicze Plany Kapitałowe to dobrowolny program długoterminowego oszczędzania, tworzony i współfinansowany przez pracowników / zleceniobiorców, pracodawców i państwo. Prywatne i imienne rachunki PPK będą zasilane wpłatami pracownika / zleceniobiorcy i podmiotu zatrudniającego oraz wpłatą powitalną i dopłatami rocznymi od państwa. Wpłaty pracownika / zleceniobiorcy oraz podmiotu zatrudniającego będą naliczane procentowo od wysokości wynagrodzenia pracownika / zleceniobiorcy. Pracownik / zleceniobiorca może w każdej chwili zarówno zrezygnować z oszczędzania w tym programie, jak i do niego wrócić.', { after: 6 });
  para(C, 'Ponadto informujemy, że:', { after: 4 });
  para(C, '§ osoba zatrudniona, która jest uczestnikiem PPK, powinna — w terminie 7 dni od dnia zawarcia w jej imieniu i na jej rzecz umowy o prowadzenie PPK — złożyć podmiotowi zatrudniającemu oświadczenie o zawartych w jej imieniu umowach o prowadzenie PPK. Oświadczenie powinno zawierać oznaczenie instytucji finansowych, z którymi zawarto te umowy,', { hang: 12, after: 4 });
  para(C, '§ osoba zatrudniona, która ukończyła 55 lat i nie ukończyła jeszcze 70 lat, aby zostać uczestnikiem PPK, powinna złożyć podmiotowi zatrudniającemu wniosek o zawarcie — w jej imieniu i na jej rzecz — umowy o prowadzenie PPK,', { hang: 12, after: 4 });
  para(C, '§ uczestnik PPK, poza obowiązkową wpłatą podstawową, może zadeklarować wpłatę dodatkową do PPK w wysokości do 2 % jego wynagrodzenia,', { hang: 12, after: 4 });
  para(C, '§ uczestnik PPK, którego wynagrodzenie osiągane z różnych źródeł w danym miesiącu nie przekracza kwoty odpowiadającej 1,2-krotności minimalnego wynagrodzenia, może złożyć podmiotowi zatrudniającemu deklarację o obniżeniu wpłaty podstawowej do PPK. Obniżona wpłata podstawowa może wynosić mniej niż 2 %, ale nie mniej niż 0,5 % jego wynagrodzenia.', { hang: 12, after: 6 });
  twoSignatures(C, ROLE[d.typ].podpisOs, ROLE[d.typ].podpisFirma);
}

// 5. DEKLARACJA O REZYGNACJI Z WPŁAT DO PPK — 4
function docRezygnacjaPpk(C, d) {
  newPage(C);
  title(C, 'Deklaracja o rezygnacji z dokonywania wpłat do Pracowniczych Planów Kapitałowych (PPK)');
  para(C, 'Deklarację należy wypełnić wielkimi literami. Deklarację składa się podmiotowi zatrudniającemu.*', { size: 9, color: rgb(0.4, 0.4, 0.4), after: 10 });

  para(C, '1.  Dane dotyczące uczestnika PPK', { bold: true, after: 4 });
  field(C, 'Imię (imiona)', d.p.imiona);
  field(C, 'Nazwisko', d.p.nazwisko);
  field(C, 'Seria i numer dowodu osobistego lub numer paszportu albo innego dokumentu potwierdzającego tożsamość', d.p.dowod, { after: 8 });

  para(C, '2.  Nazwa podmiotu zatrudniającego', { bold: true, after: 4 });
  field(C, 'Podmiot zatrudniający', d.z.nazwa, { after: 8 });

  para(C, '3.  Oświadczenie uczestnika PPK', { bold: true, after: 4 });
  para(C, 'Oświadczam, że rezygnuję z dokonywania wpłat do PPK oraz posiadam wiedzę o konsekwencjach złożenia niniejszej deklaracji, w tym:', { after: 4 });
  para(C, '1)  nieotrzymania wpłaty powitalnej w wysokości 250 zł, należnej uczestnikom PPK (dotyczy uczestnika PPK, który nie nabył uprawnienia do wpłaty powitalnej przed złożeniem deklaracji);', { hang: 18, after: 3 });
  para(C, '2)  nieotrzymania dopłat rocznych do PPK w wysokości 240 zł, należnych uczestnikom PPK po spełnieniu warunków określonych w art. 32 ustawy z dnia 4 października 2018 r. o pracowniczych planach kapitałowych (Dz. U. z 2018 r., poz. 2215, z późn. zm.);', { hang: 18, after: 3 });
  para(C, '3)  nieotrzymania wpłat podstawowych finansowanych przez podmiot zatrudniający w wysokości 1,5 % wynagrodzenia.', { hang: 18, after: 6 });
  twoSignatures(C, 'data i podpis uczestnika PPK', 'data złożenia deklaracji podmiotowi zatrudniającemu');
  gap(C, 8);
  para(C, '* Podmiot zatrudniający, o którym mowa w art. 3 ustawy z dnia 26 czerwca 1974 r. — Kodeks pracy, oznacza odpowiednio pracodawcę, nakładcę, rolnicze spółdzielnie produkcyjne lub spółdzielnie kółek rolniczych, zleceniodawcę albo podmiot, w którym działa rada nadzorcza — w stosunku do osób zatrudnionych, o których mowa w art. 2 ust. 1 pkt 18 ustawy z dnia 4 października 2018 r. o pracowniczych planach kapitałowych.', { size: 8, lh: 11, color: rgb(0.4, 0.4, 0.4) });
}

// 6. WNIOSEK O WYPŁATĘ W GOTÓWCE — 3
function docGotowka(C, d) {
  newPage(C);
  placeDate(C, d.sign.miejscowosc, d.sign.data);
  field(C, 'Imię i nazwisko składającego wniosek', fullName(d.p));
  gap(C, 16);
  title(C, 'Wniosek');
  para(C, d.typ === 'praca'
    ? 'Uprzejmie wnoszę o wypłatę należnego mi wynagrodzenia w formie gotówkowej — do rąk własnych, bezpośrednio w kasie Pracodawcy.'
    : 'Uprzejmie wnoszę o wypłatę należnego mi wynagrodzenia w formie gotówkowej — do rąk własnych, bezpośrednio w kasie Zleceniodawcy.', { after: 6 });
  para(C, 'Prośba obejmuje wszystkie kolejne wypłaty wynikające z ww. umowy, chyba że w przyszłości złożę odmienną dyspozycję.');
  signature(C, ROLE[d.typ].podpis, { align: 'right', top: 50 });
}

// 7. WNIOSEK O ZGŁOSZENIE CZŁONKÓW RODZINY — 5a
function docCzlonkowieRodziny(C, d) {
  newPage(C);
  placeDate(C, d.sign.miejscowosc, d.sign.data);
  field(C, 'Imię i nazwisko', fullName(d.p));
  field(C, 'PESEL', d.p.pesel);
  field(C, 'Adres zamieszkania', addrOneLine(d.adres), { after: 10 });
  title(C, 'Wniosek o zgłoszenie członków rodziny do ubezpieczenia zdrowotnego');
  para(C, ['Zwracam się z prośbą o zgłoszenie do ubezpieczenia zdrowotnego członka rodziny od dnia: {0} .', isoToPLDots(d.rodzina.od) || DOTS], { after: 6 });
  para(C, 'Dane członka rodziny zgłaszanego do ubezpieczenia zdrowotnego:', { after: 4 });
  field(C, 'Imię i nazwisko członka rodziny', d.rodzina.imienazwisko);
  field(C, 'PESEL', d.rodzina.pesel);
  field(C, 'Data urodzenia', isoToPLDots(d.rodzina.dataur));
  field(C, 'Adres zamieszkania', d.rodzina.adres, { after: 8 });

  para(C, 'Stopień pokrewieństwa*:', { after: 3 });
  checkLine(C, 'współmałżonek', false);
  checkLine(C, 'dziecko własne, przysposobione lub dziecko współmałżonka', false);
  checkLine(C, 'inny (jaki?): ............................................................', false);
  gap(C, 4);
  para(C, 'Czy członek rodziny pozostaje we wspólnym gospodarstwie z osobą ubezpieczoną?*', { after: 3 });
  checkLine(C, 'TAK', false); checkLine(C, 'NIE', false);
  gap(C, 4);
  para(C, 'Czy członek rodziny pozostaje na wyłącznym utrzymaniu?*', { after: 3 });
  checkLine(C, 'TAK', false); checkLine(C, 'NIE', false);
  gap(C, 4);
  para(C, 'Kod stopnia niepełnosprawności członka rodziny*:', { after: 3 });
  checkLine(C, 'nie dotyczy', false);
  checkLine(C, 'lekki, umiarkowany, znaczny (jaki?): ............................................', false);
  checkLine(C, 'niepełnosprawność stwierdzona przed 16 rokiem życia', false);
  gap(C, 8);
  para(C, 'Oświadczam, że dane zawarte w formularzu są zgodne ze stanem prawnym i faktycznym. Jestem świadom(a) odpowiedzialności karnej za podanie nieprawdy lub zatajenie prawdy. Jednocześnie zobowiązuję się do niezwłocznego powiadomienia pracodawcy w przypadku zmiany danych podanych w powyższym kwestionariuszu.', { size: 9.5, lh: 13 });
  signature(C, ROLE[d.typ].podpis, { align: 'right', top: 16 });
  gap(C, 8);
  para(C, '* właściwą odpowiedź zaznaczyć znakiem „X”.', { size: 8, lh: 11, color: rgb(0.4, 0.4, 0.4) });
}

// 8. KLAUZULA INFORMACYJNA RODO — 5d
function docRodo(C, d) {
  const praca = d.typ === 'praca';
  newPage(C);
  title(C, praca
    ? 'Klauzula informacyjna dotycząca przetwarzania danych osobowych dla pracownika'
    : 'Klauzula informacyjna dotycząca przetwarzania danych osobowych dla wykonawcy umowy cywilnoprawnej');
  para(C, ['1.  Zgodnie z art. 13 ust. 1 rozporządzenia Parlamentu Europejskiego i Rady (UE) 2016/679 z 27 kwietnia 2016 r. (RODO) informujemy, że administratorem Pani/Pana danych osobowych jest: {0} z siedzibą w {1} przy {2}.',
    d.z.nazwa || DOTS, d.z.miasto || '..............', d.z.ulica || DOTS], { hang: 18, after: 4 });
  para(C, '2.  Na podstawie obowiązujących przepisów wyznaczyliśmy Inspektora Ochrony Danych, z którym można kontaktować się:', { hang: 18, after: 2 });
  para(C, ['–  listownie na adres: {0}', d.z.iodAdres || DOTS + DOTS], { indent: 18, after: 2 });
  para(C, ['–  przez e-mail: {0}', d.z.iodEmail || DOTS + DOTS], { indent: 18, after: 4 });
  if (praca) {
    para(C, '3.  Dane osobowe pozyskane w związku z zatrudnieniem będą przetwarzane w celach: związanych z nawiązaniem i realizacją stosunku pracy; wypełnienia obowiązków pracodawcy wynikających z przepisów prawa pracy, ubezpieczeń społecznych i prawa podatkowego; dochodzenia ewentualnych roszczeń i obrony przed nimi.', { hang: 18, after: 4 });
    para(C, '4.  Podstawą prawną przetwarzania Pani/Pana danych jest: art. 22¹ Kodeksu pracy oraz konieczność wypełnienia obowiązku prawnego ciążącego na administratorze (art. 6 ust. 1 lit. c RODO); niezbędność do wykonania umowy o pracę (art. 6 ust. 1 lit. b RODO); prawnie uzasadniony interes administratora (art. 6 ust. 1 lit. f RODO); zgoda — w zakresie danych podanych dobrowolnie (art. 6 ust. 1 lit. a RODO).', { hang: 18, after: 4 });
  } else {
    para(C, '3.  Dane osobowe pozyskane w związku z zawarciem z Panią/Panem umowy będą przetwarzane w celach: związanych z realizacją podpisanej umowy; dochodzeniem ewentualnych roszczeń i odszkodowań; udzielania odpowiedzi na pisma, wnioski i skargi; udzielania odpowiedzi w toczących się postępowaniach.', { hang: 18, after: 4 });
    para(C, '4.  Podstawą prawną przetwarzania Pani/Pana danych jest: niezbędność do wykonania umowy lub podjęcia działań przed jej zawarciem (art. 6 ust. 1 lit. b RODO); konieczność wypełnienia obowiązku prawnego ciążącego na administratorze (art. 6 ust. 1 lit. c RODO); niezbędność do celów wynikających z prawnie uzasadnionych interesów administratora (art. 6 ust. 1 lit. f RODO).', { hang: 18, after: 4 });
  }
  para(C, '5.  Pozyskane dane osobowe mogą być przekazywane: organom lub podmiotom publicznym uprawnionym do uzyskania danych na podstawie przepisów prawa (np. sądom, organom ścigania, instytucjom państwowym); podmiotom przetwarzającym je na nasze zlecenie.', { hang: 18, after: 4 });
  para(C, praca
    ? '6.  Dane osobowe będą przechowywane przez okres zatrudnienia, a następnie przez okres przechowywania dokumentacji pracowniczej wymagany przepisami prawa (co do zasady 10 lat od końca roku kalendarzowego, w którym stosunek pracy ustał).'
    : '6.  Okres przetwarzania danych jest uzależniony od celu i obliczany w oparciu o: czas obowiązywania umowy; przepisy prawa obligujące do przetwarzania danych przez określony czas; okres niezbędny do obrony naszych interesów.', { hang: 18, after: 4 });
  para(C, '7.  Ma Pani/Pan prawo do: dostępu do swoich danych; sprostowania danych nieprawidłowych oraz uzupełnienia niekompletnych; usunięcia danych; ograniczenia przetwarzania; wniesienia sprzeciwu wobec przetwarzania; przenoszenia danych; wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych.', { hang: 18, after: 4 });
  para(C, '8.  W zakresie, w jakim dane są przetwarzane na podstawie zgody — ma Pani/Pan prawo wycofania zgody w dowolnym momencie. Wycofanie zgody nie wpływa na zgodność z prawem przetwarzania dokonanego przed jej wycofaniem. Zgodę można wycofać przez wysłanie oświadczenia na adres korespondencyjny bądź adres e-mail administratora.', { hang: 18, after: 6 });
  signature(C, ROLE[d.typ].podpis, { align: 'right', top: 16 });
}

// 9. OŚWIADCZENIE O WYBORZE UMOWY ZLECENIA — 6
function docWyborUmowy(C, d) {
  newPage(C);
  title(C, 'Oświadczenie');
  para(C, 'Ja, niżej podpisany/a', { after: 2 });
  para(C, fullName(d.p), { raw: true, bold: true, after: 2 });
  para(C, ['zamieszkały/a {0},', addrOneLine(d.adres)], { after: 6 });
  para(C, 'oświadczam, że dobrowolnie i świadomie wybrałem/am formę współpracy na podstawie umowy zlecenia. Forma ta jest zgodna z moimi oczekiwaniami oraz potrzebami wynikającymi z mojego obecnego trybu życia i innych zobowiązań.', { after: 6 });
  para(C, 'W szczególności potwierdzam, że:', { after: 4 });
  para(C, '1.  Chcę świadczyć usługi w elastycznym i lojalnym harmonogramie, który pozwala mi na łączenie wykonywanych zleceń z innymi interesami oraz obowiązkami życiowymi.', { hang: 18, after: 3 });
  para(C, '2.  Forma umowy zlecenia zapewnia mi swobodę organizowania czasu pracy i nie oczekuję, aby świadczenie usług odbywało się w sposób charakterystyczny dla stosunku pracy.', { hang: 18, after: 3 });
  para(C, '3.  Zostałem/am poinformowany/a o różnicach między umową zlecenia a umową o pracę oraz o przysługujących mi prawach.', { hang: 18, after: 3 });
  para(C, '4.  Potwierdzam, że mój wybór nie wynika z przymusu ani nacisku, a współpraca na podstawie umowy zlecenia jest zgodna z moją wolą.', { hang: 18, after: 6 });
  para(C, 'Oświadczam, że powyższe informacje są prawdziwe i składam je dobrowolnie.', { after: 6 });
  // place & date line bottom-left
  ensure(C, 20);
  para(C, `${d.sign.miejscowosc || '..............'}, dnia ${isoToPLDots(d.sign.data) || '..............'} r.`, { raw: true, after: 0 });
  signature(C, 'Podpis zleceniobiorcy', { align: 'right', top: 14 });
  docInformacjaRoznice(C, d);
}
// 9b. INFORMACJA — różnice między umową o pracę a umową zlecenia (druga strona oświadczenia)
function docInformacjaRoznice(C, d) {
  newPage(C);
  title(C, 'INFORMACJA');
  center(C, 'Różnice między umową o pracę a umową zlecenia', { bold: true, after: 8 });
  para(C, 'Umowa o pracę i umowa zlecenia to dwie odrębne formy zatrudnienia, oparte na różnych przepisach i dające różny zakres praw. Umowa o pracę jest regulowana Kodeksem pracy, natomiast umowa zlecenia – Kodeksem cywilnym (art. 734 i 750). O rzeczywistym charakterze zatrudnienia decyduje faktyczny sposób wykonywania pracy, a nie nazwa nadana umowie przez strony (art. 22 § 1 i § 1¹ Kodeksu pracy).', { after: 8 });
  para(C, 'Umowa o pracę', { bold: true, after: 3 });
  para(C, 'Praca na podstawie umowy o pracę jest wykonywana osobiście, odpłatnie i pod kierownictwem pracodawcy – w wyznaczonym miejscu i czasie, według jego poleceń. W zamian pracownik korzysta z pełnej ochrony przewidzianej w Kodeksie pracy. Przysługuje mu wynagrodzenie nie niższe niż minimalne, które w 2026 roku wynosi 4 806 zł brutto miesięcznie przy pełnym etacie. Obowiązują go normy czasu pracy (8 godzin na dobę i przeciętnie 40 godzin tygodniowo), a za pracę w godzinach nadliczbowych należy się dodatek. Pracownik ma prawo do płatnego urlopu wypoczynkowego w wymiarze 20 lub 26 dni w roku, jest objęty obowiązkowym ubezpieczeniem chorobowym (zasiłek chorobowy i macierzyński), a rozwiązanie umowy wymaga zachowania okresu wypowiedzenia i – przy umowie na czas nieokreślony – uzasadnienia. Szczególną ochroną objęte są m.in. kobiety w ciąży oraz osoby w wieku przedemerytalnym. Okres zatrudnienia wlicza się do stażu pracy i do emerytury, a po zakończeniu pracy pracownik otrzymuje świadectwo pracy.', { after: 8 });
  para(C, 'Umowa zlecenia', { bold: true, after: 3 });
  para(C, 'Umowa zlecenia opiera się na samodzielnym wykonywaniu określonych czynności – zleceniobiorca co do zasady sam organizuje swoją pracę i nie podlega kierownictwu w takim zakresie jak pracownik etatowy. Za każdą godzinę wykonywania zlecenia przysługuje wynagrodzenie nie niższe niż minimalna stawka godzinowa, która w 2026 roku wynosi 31,40 zł brutto (prawa do niej nie można się zrzec). Przy tej formie zatrudnienia nie obowiązują ustawowe normy czasu pracy ani dodatek za nadgodziny, a urlop wypoczynkowy nie przysługuje z mocy prawa. Ubezpieczenie chorobowe jest dobrowolne – zasiłek chorobowy przysługuje tylko wtedy, gdy zleceniobiorca zgłosi się do tego ubezpieczenia. Umowę zlecenia można wypowiedzieć w każdym czasie (art. 746 Kodeksu cywilnego), nie obowiązują tu okresy ani szczególna ochrona przed rozwiązaniem. Okres pracy na zleceniu nie wlicza się do stażu pracowniczego, a po jego zakończeniu wystawiany jest rachunek lub zaświadczenie, a nie świadectwo pracy.', { after: 8 });
  para(C, 'Oświadczam, że zapoznałam/zapoznałem się z powyższą informacją i została ona dla mnie zrozumiała.');
  twoSignatures(C, 'Miejscowość i data', 'Czytelny podpis');
}

// ---------------- Umowa o pracę ----------------

// P1. OŚWIADCZENIE PRACOWNIKA DLA CELÓW PODATKOWYCH (odpowiednik PIT-2)
function docPit2(C, d) {
  newPage(C);
  title(C, 'Oświadczenie dla celów obliczania miesięcznych zaliczek na podatek dochodowy (PIT-2)');
  identityBlock(C, d, true);
  para(C, 'Oświadczam, że (właściwe zaznaczyć znakiem „X”):', { after: 6 });
  const tn = () => { checkLine(C, 'TAK', false, { indent: 18 }); checkLine(C, 'NIE', false, { indent: 18 }); gap(C, 3); };
  para(C, '1.  Wnoszę o pomniejszanie miesięcznych zaliczek na podatek o kwotę stanowiącą:', { hang: 18, after: 2 });
  checkLine(C, '1/12 kwoty zmniejszającej podatek (jeden płatnik),', false, { indent: 18 });
  checkLine(C, '1/24 kwoty zmniejszającej podatek (dwóch płatników),', false, { indent: 18 });
  checkLine(C, '1/36 kwoty zmniejszającej podatek (trzech płatników),', false, { indent: 18 });
  checkLine(C, 'nie wnoszę o pomniejszanie zaliczek.', false, { indent: 18 });
  gap(C, 3);
  if (d.typ === 'praca') {
    para(C, '2.  Wnoszę o stosowanie podwyższonych kosztów uzyskania przychodów, ponieważ moje miejsce stałego lub czasowego zamieszkania jest położone poza miejscowością, w której znajduje się zakład pracy, i nie uzyskuję dodatku za rozłąkę:', { hang: 18, after: 2 });
    tn();
  }
  para(C, '3.  Wnoszę o niestosowanie zwolnienia z podatku dla osób do ukończenia 26. roku życia (tzw. ulga dla młodych):', { hang: 18, after: 2 });
  tn();
  para(C, '4.  Spełniam warunki do stosowania zwolnienia z podatku (ulga na powrót, ulga dla rodzin 4+, ulga dla pracujących seniorów) i wnoszę o jego stosowanie:', { hang: 18, after: 2 });
  checkLine(C, 'TAK — rodzaj ulgi i okres: ............................................', false, { indent: 18 });
  checkLine(C, 'NIE', false, { indent: 18 });
  gap(C, 3);
  para(C, '5.  Zamierzam opodatkować dochody wspólnie z małżonkiem albo jako osoba samotnie wychowująca dziecko i wnoszę o pobieranie zaliczek według stawki 12 %:', { hang: 18, after: 2 });
  tn();
  para(C, '6.  Moim miejscem zamieszkania dla celów podatkowych (rezydencja podatkowa) jest:', { hang: 18, after: 2 });
  checkLine(C, 'Polska,', false, { indent: 18 });
  checkLine(C, 'inne państwo (jakie?): ............................................', false, { indent: 18 });
  gap(C, 6);
  para(C, 'Oświadczam, że powyższe dane są zgodne ze stanem faktycznym. Zobowiązuję się niezwłocznie poinformować płatnika o każdej zmianie okoliczności mających wpływ na obliczanie zaliczek na podatek.', { size: 9.5, lh: 13, after: 2 });
  placeLine(C, d);
  signature(C, ROLE[d.typ].podpis, { align: 'right', top: 14 });
}
// "Miejscowość, dnia …" line on the left (data only — the same in both columns)
function placeLine(C, d) {
  ensure(C, 20);
  para(C, `${d.sign.miejscowosc || '..............'}, dnia ${isoToPLDots(d.sign.data) || '..............'} r.`, { raw: true, after: 0 });
}

// P2. OŚWIADCZENIE PRACOWNIKA DLA CELÓW ZUS
function docZusPracownik(C, d) {
  newPage(C);
  title(C, 'Oświadczenie pracownika dla celów ubezpieczeń społecznych i ubezpieczenia zdrowotnego');
  identityBlock(C, d, false);
  para(C, 'Jako Pracownik oświadczam, że:', { after: 6 });
  const pts = [
    'Nie jestem/Jestem* jednocześnie zatrudniona/ny u innego pracodawcy na podstawie umowy o pracę.',
    'Nie wykonuję/Wykonuję* umowę zlecenia lub inną umowę o świadczenie usług na rzecz innego podmiotu.',
    'Nie prowadzę/Prowadzę* pozarolniczą działalność gospodarczą.',
    PT_EMERYT,
    PT_NIEPELNOSPR,
    PT_STUDENT,
    PT_REZYDENCJA,
  ];
  pts.forEach((p, i) => para(C, ['{0}.  ' + p, i + 1], { hang: 18, after: 3 }));
  gap(C, 6);
  para(C, 'Oświadczam, że wszystkie informacje są zgodne ze stanem faktycznym i prawnym. Zobowiązuję się niezwłocznie, nie później niż w ciągu 3 dni, poinformować Pracodawcę w formie pisemnej o wszelkich zmianach dotyczących treści niniejszego oświadczenia.', { size: 9.5, lh: 13, after: 2 });
  placeLine(C, d);
  signature(C, 'podpis pracownika', { align: 'right', top: 14 });
  gap(C, 10);
  para(C, NOTE_SKRESLIC, { size: 8, lh: 11, color: rgb(0.4, 0.4, 0.4) });
}

// P3. INFORMACJA O WARUNKACH ZATRUDNIENIA (art. 29 § 3 KP)
function docWarunki(C, d) {
  newPage(C);
  placeDate(C, d.sign.miejscowosc, d.sign.data);
  field(C, 'Pracodawca', d.z.nazwa);
  field(C, 'Pracownik', fullName(d.p), { after: 8 });
  title(C, 'Informacja o warunkach zatrudnienia');
  para(C, 'Działając na podstawie art. 29 § 3 Kodeksu pracy, informuję, że:', { after: 6 });
  const pts = [
    'Obowiązuje Panią/Pana dobowa norma czasu pracy wynosząca 8 godzin i tygodniowa norma czasu pracy wynosząca przeciętnie 40 godzin w przeciętnie pięciodniowym tygodniu pracy, w przyjętym okresie rozliczeniowym: ..............................',
    'Dobowy wymiar czasu pracy wynosi 8 godzin, a tygodniowy — przeciętnie 40 godzin (przy pełnym wymiarze czasu pracy; przy niepełnym wymiarze — proporcjonalnie).',
    'Przysługują Pani/Panu przerwy w pracy: przerwa trwająca co najmniej 15 minut, wliczana do czasu pracy, jeżeli dobowy wymiar czasu pracy wynosi co najmniej 6 godzin; druga przerwa trwająca co najmniej 15 minut — przy dobowym wymiarze dłuższym niż 9 godzin; trzecia — przy dobowym wymiarze dłuższym niż 16 godzin.',
    'Przysługuje Pani/Panu prawo do nieprzerwanego odpoczynku: dobowego — co najmniej 11 godzin, tygodniowego — co najmniej 35 godzin.',
    'Praca w godzinach nadliczbowych jest dopuszczalna w razie konieczności prowadzenia akcji ratowniczej lub szczególnych potrzeb pracodawcy. Za pracę w godzinach nadliczbowych przysługuje, oprócz normalnego wynagrodzenia, dodatek w wysokości 100 % albo 50 % wynagrodzenia lub czas wolny od pracy — na zasadach określonych w Kodeksie pracy.',
    'Praca zmianowa: nie dotyczy / dotyczy* — zasady przechodzenia ze zmiany na zmianę: ..............................',
    'Miejsca wykonywania pracy i zasady przemieszczania się między nimi (w przypadku kilku miejsc pracy): ..............................',
    'Poza składnikami określonymi w umowie o pracę przysługują Pani/Panu inne składniki wynagrodzenia oraz świadczenia pieniężne lub rzeczowe: ..............................',
    'Wymiar przysługującego Pani/Panu płatnego urlopu wypoczynkowego wynosi 20 dni w roku kalendarzowym — przy zatrudnieniu krótszym niż 10 lat, albo 26 dni — przy zatrudnieniu co najmniej 10 lat (przy niepełnym wymiarze czasu pracy — proporcjonalnie).',
    'Rozwiązanie stosunku pracy następuje: na mocy porozumienia stron; za wypowiedzeniem; bez wypowiedzenia; z upływem czasu, na który umowa była zawarta. Oświadczenie o wypowiedzeniu lub rozwiązaniu umowy bez wypowiedzenia wymaga formy pisemnej.',
    'Okres wypowiedzenia umowy na okres próbny wynosi: 3 dni robocze — jeżeli okres próbny nie przekracza 2 tygodni; 1 tydzień — jeżeli jest dłuższy niż 2 tygodnie; 2 tygodnie — jeżeli wynosi 3 miesiące. Okres wypowiedzenia umowy na czas określony i na czas nieokreślony wynosi: 2 tygodnie — przy zatrudnieniu krótszym niż 6 miesięcy; 1 miesiąc — przy zatrudnieniu co najmniej 6 miesięcy; 3 miesiące — przy zatrudnieniu co najmniej 3 lata.',
    'Prawo do szkoleń zapewnianych przez pracodawcę (ogólne zasady polityki szkoleniowej): ..............................',
    'Układ zbiorowy pracy lub inne porozumienie zbiorowe, którym jest Pani/Pan objęta/y: nie dotyczy / dotyczy*: ..............................',
    'Wynagrodzenie za pracę wypłacane jest raz w miesiącu, z dołu, do .......... dnia następnego miesiąca kalendarzowego — przelewem na wskazany rachunek płatniczy albo, na wniosek pracownika, do rąk własnych.',
    'Pora nocna obejmuje czas od godz. .......... do godz. .......... . Przybycie i obecność w pracy potwierdza się przez: .............................. . Nieobecność w pracy należy usprawiedliwić niezwłocznie, nie później niż w drugim dniu nieobecności.',
    'Składki na ubezpieczenia społeczne związane ze stosunkiem pracy odprowadzane są do Zakładu Ubezpieczeń Społecznych (ZUS).',
  ];
  pts.forEach((p, i) => para(C, ['{0}.  ' + p, i + 1], { hang: 18, after: 3 }));
  twoSignatures(C, 'data i podpis Pracodawcy', 'data i podpis Pracownika (potwierdzenie otrzymania)');
  gap(C, 8);
  para(C, NOTE_SKRESLIC, { size: 8, lh: 11, color: rgb(0.4, 0.4, 0.4) });
}

// P4. OŚWIADCZENIE BHP (akta osobowe cz. B)
function docBhp(C, d) {
  newPage(C);
  field(C, 'Imię i nazwisko', fullName(d.p));
  field(C, 'Pracodawca', d.z.nazwa, { after: 10 });
  title(C, 'Oświadczenie pracownika o zapoznaniu się z przepisami BHP i ryzykiem zawodowym');
  para(C, 'Oświadczam, że przed dopuszczeniem do pracy:', { after: 6 });
  const pts = [
    'odbyłam/em szkolenie wstępne w dziedzinie bezpieczeństwa i higieny pracy (instruktaż ogólny i stanowiskowy);',
    'zapoznałam/em się z przepisami oraz zasadami bezpieczeństwa i higieny pracy oraz przepisami przeciwpożarowymi obowiązującymi na moim stanowisku pracy i zobowiązuję się do ich przestrzegania;',
    'zostałam/em poinformowana/y o ryzyku zawodowym, które wiąże się z wykonywaną pracą, oraz o zasadach ochrony przed zagrożeniami;',
    'otrzymałam/em informację o pracownikach wyznaczonych do udzielania pierwszej pomocy oraz do wykonywania działań w zakresie zwalczania pożarów i ewakuacji pracowników.',
  ];
  pts.forEach((p, i) => para(C, ['{0})  ' + p, i + 1], { hang: 18, after: 4 }));
  gap(C, 6);
  placeLine(C, d);
  signature(C, 'podpis pracownika', { align: 'right', top: 14 });
}

// P5. INFORMACJA DOT. RÓWNEGO TRAKTOWANIA (art. 94¹ KP)
function docRowne(C, d) {
  newPage(C);
  field(C, 'Imię i nazwisko', fullName(d.p));
  field(C, 'Pracodawca', d.z.nazwa, { after: 10 });
  title(C, 'Informacja dotycząca równego traktowania w zatrudnieniu');
  para(C, 'Zgodnie z art. 94¹ Kodeksu pracy pracodawca udostępnia pracownikom tekst przepisów dotyczących równego traktowania w zatrudnieniu. Poniżej przedstawiamy ich najważniejszą treść (rozdział IIa działu pierwszego Kodeksu pracy).', { after: 6 });
  const pts = [
    'Pracownicy mają równe prawa z tytułu jednakowego wypełniania takich samych obowiązków; dotyczy to w szczególności równego traktowania mężczyzn i kobiet w zatrudnieniu.',
    'Jakakolwiek dyskryminacja w zatrudnieniu, bezpośrednia lub pośrednia, w szczególności ze względu na płeć, wiek, niepełnosprawność, rasę, religię, narodowość, przekonania polityczne, przynależność związkową, pochodzenie etniczne, wyznanie, orientację seksualną, zatrudnienie na czas określony lub nieokreślony, zatrudnienie w pełnym lub w niepełnym wymiarze czasu pracy — jest niedopuszczalna.',
    'Pracownicy powinni być równo traktowani w zakresie nawiązania i rozwiązania stosunku pracy, warunków zatrudnienia, awansowania oraz dostępu do szkolenia w celu podnoszenia kwalifikacji zawodowych.',
    'Dyskryminowanie bezpośrednie istnieje wtedy, gdy pracownik z jednej lub z kilku wymienionych przyczyn był, jest lub mógłby być traktowany w porównywalnej sytuacji mniej korzystnie niż inni pracownicy. Dyskryminowanie pośrednie istnieje wtedy, gdy na skutek pozornie neutralnego postanowienia, zastosowanego kryterium lub podjętego działania występują lub mogłyby wystąpić niekorzystne dysproporcje albo szczególnie niekorzystna sytuacja wobec wszystkich lub znacznej liczby pracowników należących do grupy wyróżnionej ze względu na jedną lub kilka wymienionych przyczyn.',
    'Przejawem dyskryminowania jest także: zachęcanie innej osoby do naruszenia zasady równego traktowania lub nakazanie jej naruszenia tej zasady; molestowanie — niepożądane zachowanie, którego celem lub skutkiem jest naruszenie godności pracownika i stworzenie wobec niego zastraszającej, wrogiej, poniżającej, upokarzającej lub uwłaczającej atmosfery; molestowanie seksualne — każde niepożądane zachowanie o charakterze seksualnym lub odnoszące się do płci pracownika.',
    'Pracownicy mają prawo do jednakowego wynagrodzenia za jednakową pracę lub za pracę o jednakowej wartości.',
    'Osoba, wobec której pracodawca naruszył zasadę równego traktowania w zatrudnieniu, ma prawo do odszkodowania w wysokości nie niższej niż minimalne wynagrodzenie za pracę.',
    'Skorzystanie przez pracownika z uprawnień przysługujących z tytułu naruszenia zasady równego traktowania w zatrudnieniu nie może być podstawą niekorzystnego traktowania pracownika ani powodować wobec niego jakichkolwiek negatywnych konsekwencji.',
  ];
  pts.forEach((p, i) => para(C, ['{0}.  ' + p, i + 1], { hang: 18, after: 3 }));
  gap(C, 6);
  para(C, 'Oświadczam, że zapoznałam/em się z powyższą informacją.', { after: 4 });
  placeLine(C, d);
  signature(C, 'podpis pracownika', { align: 'right', top: 14 });
}

// P6. ZAKRES CZYNNOŚCI
function docZakres(C, d) {
  newPage(C);
  placeDate(C, d.sign.miejscowosc, d.sign.data);
  field(C, 'Pracodawca', d.z.nazwa);
  field(C, 'Pracownik', fullName(d.p));
  para(C, ['Stanowisko: {0}', d.umowa.stanowisko ? { tr: d.umowa.stanowisko } : DOTS], { bold: true, after: 8 });
  title(C, 'Zakres czynności pracownika');
  para(C, 'Do podstawowych obowiązków pracownika na zajmowanym stanowisku należy:', { after: 6 });
  for (let i = 1; i <= 8; i++) para(C, `${i}.  ..........................................................................................`, { raw: true, after: 5 });
  gap(C, 4);
  para(C, 'Pracownik podlega bezpośrednio: ..............................', { after: 6 });
  para(C, 'Pracownik jest obowiązany wykonywać pracę sumiennie i starannie oraz stosować się do poleceń przełożonych, które dotyczą pracy, jeżeli nie są one sprzeczne z przepisami prawa lub umową o pracę (art. 100 § 1 Kodeksu pracy).', { after: 6 });
  para(C, 'Przyjmuję powyższy zakres czynności do wiadomości i stosowania.');
  twoSignatures(C, 'data i podpis Pracodawcy', 'data i podpis Pracownika');
}

// P7. OŚWIADCZENIE O ZAPOZNANIU SIĘ Z PRZEPISAMI ZAKŁADOWYMI
function docPrzepisy(C, d) {
  newPage(C);
  field(C, 'Imię i nazwisko', fullName(d.p));
  field(C, 'Pracodawca', d.z.nazwa, { after: 10 });
  title(C, 'Oświadczenie pracownika o zapoznaniu się z przepisami zakładowymi');
  para(C, 'Oświadczam, że przed dopuszczeniem do pracy:', { after: 6 });
  const pts = [
    'zapoznałam/em się z treścią regulaminu pracy oraz regulaminu wynagradzania obowiązujących u pracodawcy (jeżeli zostały wprowadzone) i zobowiązuję się do ich przestrzegania;',
    'otrzymałam/em informację o warunkach zatrudnienia, o której mowa w art. 29 § 3 Kodeksu pracy;',
    'zostałam/em poinformowana/y o obowiązku zachowania w tajemnicy informacji, których ujawnienie mogłoby narazić pracodawcę na szkodę;',
    'zostałam/em poinformowana/y o celach, zakresie i sposobie zastosowania monitoringu u pracodawcy (jeżeli został wprowadzony);',
    'zostałam/em poinformowana/y o wprowadzeniu kontroli trzeźwości lub kontroli na obecność środków działających podobnie do alkoholu oraz o sposobie jej przeprowadzania (jeżeli została wprowadzona);',
    'zapoznałam/em się z obowiązującymi u pracodawcy zasadami przeciwdziałania mobbingowi i dyskryminacji;',
    'zostałam/em poinformowana/y o zasadach odpowiedzialności materialnej za powierzone mienie oraz o zasadach przydziału odzieży roboczej i środków ochrony indywidualnej.',
  ];
  pts.forEach((p, i) => para(C, ['{0})  ' + p, i + 1], { hang: 18, after: 4 }));
  gap(C, 6);
  placeLine(C, d);
  signature(C, 'podpis pracownika', { align: 'right', top: 14 });
}

// P8. ZGODA NA PIT W FORMIE ELEKTRONICZNEJ (lista A)
function docZgodaPit(C, d) {
  newPage(C);
  placeDate(C, d.sign.miejscowosc, d.sign.data);
  field(C, 'Imię i nazwisko', fullName(d.p));
  field(C, 'Pracodawca', d.z.nazwa, { after: 12 });
  title(C, 'Zgoda na przekazywanie informacji podatkowych w formie elektronicznej');
  para(C, 'Wyrażam zgodę na przekazywanie mi przez pracodawcę imiennych informacji podatkowych (w szczególności PIT-11) w formie elektronicznej, na adres e-mail: ............................................................', { after: 6 });
  para(C, 'Zobowiązuję się niezwłocznie poinformować pracodawcę o zmianie adresu e-mail. Zgoda może zostać wycofana w każdym czasie.');
  signature(C, 'podpis pracownika', { align: 'right', top: 40 });
}

// P9. OŚWIADCZENIE O UPRAWNIENIACH RODZICIELSKICH (art. 148³, 178 § 2, 188 KP)
function docRodzic(C, d) {
  newPage(C);
  placeDate(C, d.sign.miejscowosc, d.sign.data);
  field(C, 'Imię i nazwisko', fullName(d.p));
  field(C, 'Pracodawca', d.z.nazwa, { after: 12 });
  title(C, 'Oświadczenie o korzystaniu z uprawnień rodzicielskich');
  para(C, 'Właściwą odpowiedź zaznaczyć znakiem „X”.', { size: 9, color: rgb(0.4, 0.4, 0.4), after: 6 });
  checkLine(C, 'Nie dotyczy — nie jestem rodzicem ani opiekunem dziecka w wieku do 14 lat.', false);
  gap(C, 6);
  para(C, '1.  Jako rodzic lub opiekun dziecka w wieku do 14 lat oświadczam, że ze zwolnienia od pracy w wymiarze 16 godzin albo 2 dni w roku kalendarzowym, z zachowaniem prawa do wynagrodzenia (art. 188 Kodeksu pracy):', { hang: 18, after: 2 });
  checkLine(C, 'zamierzam korzystać,', false, { indent: 18 });
  checkLine(C, 'nie zamierzam korzystać.', false, { indent: 18 });
  gap(C, 6);
  para(C, '2.  Jako rodzic lub opiekun dziecka do ukończenia przez nie 8. roku życia (art. 178 § 2 Kodeksu pracy) wyrażam zgodę / nie wyrażam zgody* na:', { hang: 18, after: 2 });
  ['pracę w godzinach nadliczbowych,', 'pracę w porze nocnej,', 'pracę w systemie przerywanego czasu pracy,', 'delegowanie poza stałe miejsce pracy.']
    .forEach((t) => para(C, ['–  ' + t + '  {0}', '.....................'], { indent: 18, after: 2 }));
  gap(C, 8);
  signature(C, 'podpis pracownika', { align: 'right', top: 30 });
  gap(C, 8);
  para(C, NOTE_SKRESLIC, { size: 8, lh: 11, color: rgb(0.4, 0.4, 0.4) });
}

// P10. ZAKŁADKI DO AKT OSOBOWYCH — części A–E (wewnętrzne, tylko po polsku)
const AKTA = {
  A: ['Kwestionariusz osobowy', 'Paszport', 'Dokumenty leg. pobyt', 'Skierowanie na badanie', 'BHP', 'Orzeczenie lekarskie'],
  B: ['Kwestionariusz osobowy', 'RODO', 'BHP', 'Oświadczenie BHP', 'Informacja dot. równego traktowania', 'Umowa o pracę',
    'Zakres czynności', 'Informacja o warunkach zatrudnienia', 'Oświadczenie pracownika o przepisach zakładowych', 'PIT-2',
    'Informacja PPK', 'Rezygnacja PPK', 'ZUA', 'Powiadomienie o powierzeniu pracy'],
  C: [], D: [], E: [],
};
function docZakladki(C, d) {
  const f = C.cols[0].font, b = C.cols[0].bold, black = rgb(0, 0, 0);
  const x0 = MARGIN, w = A4[0] - MARGIN * 2, numW = 70, rowH = 24, rows = 16;
  Object.keys(AKTA).forEach((cz) => {
    newPage(C, true);
    let y = A4[1] - MARGIN - 10;
    const mid = (t, font, size) => { font.draw(C.page, t, { x: (A4[0] - font.widthOfTextAtSize(t, size)) / 2, y, size, color: black }); };
    mid('Akta osobowe', b, 20); y -= 28;
    mid('część ' + cz, b, 16); y -= 34;
    f.draw(C.page, 'Imię i nazwisko: ' + fullName(d.p), { x: x0, y, size: 12, color: black }); y -= 24;
    const top = y;
    for (let i = 0; i <= rows + 1; i++) C.page.drawLine({ start: { x: x0, y: top - i * rowH }, end: { x: x0 + w, y: top - i * rowH }, thickness: 0.6, color: black });
    [x0, x0 + numW, x0 + w].forEach((x) => C.page.drawLine({ start: { x, y: top }, end: { x, y: top - (rows + 1) * rowH }, thickness: 0.6, color: black }));
    b.draw(C.page, 'Liczba kolejna', { x: x0 + 5, y: top - 16, size: 9, color: black });
    b.draw(C.page, 'Określenie dokumentu', { x: x0 + numW + 8, y: top - 16, size: 10, color: black });
    AKTA[cz].forEach((name, i) => {
      const ry = top - (i + 1) * rowH - 16;
      f.draw(C.page, String(i + 1), { x: x0 + 28, y: ry, size: 10.5, color: black });
      f.draw(C.page, name, { x: x0 + numW + 8, y: ry, size: 10.5, color: black });
    });
  });
}

// ============================================================
//                    BUILD COMBINED PDF
// ============================================================
// tr: null (Polish only) or { map: {polish: translation}, script } for the bilingual variant
async function generateKomplet(d, tr) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const now = new Date();
  doc.setTitle(KOMPLET_TITLE[d.typ]);
  doc.setAuthor('TD Consulting Group');
  doc.setProducer('TD Consulting Group — Portal dokumentów');
  doc.setCreator('TD Consulting Group — Portal dokumentów');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  const font = await doc.embedFont(fontRegular);
  const bold = await doc.embedFont(fontBold);
  const faces = { pl: plainFace(font), plBold: plainFace(bold) };
  if (tr) {
    const sf = scriptFonts[tr.script];
    faces.tr = sf ? mixedFace(await doc.embedFont(sf[0]), font) : faces.pl;
    faces.trBold = sf ? mixedFace(await doc.embedFont(sf[1]), bold) : faces.plBold;
  }
  renderDocs(makeCtx(doc, faces, tr ? ((s) => tr.map[s] || s) : null), d);
  return await doc.save();
}
function renderDocs(C, d) {
  const fn = {
    umowa: docUmowa, kwest: docKwestionariusz, wybor: docWyborUmowy, gotowka: docGotowka, rodo: docRodo,
    zus: docOswiadczenieZus, wykonawca: docOswiadczenieWykonawcy, pit2: docPit2, rodzina: docCzlonkowieRodziny,
    ppkInfo: docInformacjaPpk, ppkRez: docRezygnacjaPpk, bhp: docBhp, rowne: docRowne, zakres: docZakres,
    warunki: docWarunki, przepisy: docPrzepisy, zusPrac: docZusPracownik, zgodaPit: docZgodaPit, rodzic: docRodzic,
    zakladki: docZakladki,
  };
  DOC_ORDER[d.typ].forEach((k) => { if (d.docs[k]) fn[k](C, d); });
}
const KOMPLET_TITLE = { zlecenie: 'Umowa zlecenie — komplet dokumentów', praca: 'Umowa o pracę — komplet dokumentów' };

// ---------------- Translation (bilingual variant) ----------------
// Fonts for scripts Roboto does not cover; loaded only when such a language is used.
const SCRIPT_FONT_FILES = {
  georgian: ['fonts/NotoSansGeorgian-Regular.ttf', 'fonts/NotoSansGeorgian-Bold.ttf'],
  armenian: ['fonts/NotoSansArmenian-Regular.ttf', 'fonts/NotoSansArmenian-Bold.ttf'],
};
const scriptFonts = {};
async function loadScriptFonts(script) {
  const files = SCRIPT_FONT_FILES[script];
  if (!files || scriptFonts[script]) return;
  scriptFonts[script] = await Promise.all(files.map(f => fetch(f).then(r => {
    if (!r.ok) throw new Error('Brak czcionki: ' + f);
    return r.arrayBuffer();
  })));
}

// every translatable string of the selected documents (dry run with a recording "translator")
async function collectStrings(d) {
  const seen = new Set();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const face = plainFace(await doc.embedFont(fontRegular));
  renderDocs(makeCtx(doc, { pl: face, plBold: face, tr: face, trBold: face }, (s) => { seen.add(s); return s; }), d);
  return Array.from(seen).filter(s => /[A-Za-zÀ-ž]/.test(s));
}

const TR_FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/translate-docs';
const TR_CHUNK_CHARS = 2400;
const TR_PARALLEL = 4;
function trCacheKey(target) { return 'tdcg_tr_v1_' + target.trim().toLowerCase(); }

// target: citizenship (Polish adjective, e.g. "ukraińskie") or an explicit language name.
// Returns { map, script, language, fallback }. Translations are cached per target in
// this browser, so only strings not seen before are sent to the model.
async function getTranslations(target, strings, onProgress) {
  let cache = { map: {} };
  try { cache = JSON.parse(localStorage.getItem(trCacheKey(target))) || cache; } catch (e) { /* ignore */ }
  const missing = strings.filter(s => !cache.map[s]);
  if (missing.length) {
    const sess = await window.sb.auth.getSession();
    const token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    if (!token) throw new Error('Sesja wygasła — zaloguj się ponownie.');
    const chunks = [];
    let cur = [], len = 0;
    missing.forEach(s => {
      if (cur.length && len + s.length > TR_CHUNK_CHARS) { chunks.push(cur); cur = []; len = 0; }
      cur.push(s); len += s.length;
    });
    if (cur.length) chunks.push(cur);
    let done = 0, next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++];
        const res = await fetch(TR_FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ target, strings: chunk }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || ('Błąd tłumaczenia (' + res.status + ')'));
        chunk.forEach((s, i) => { if (body.translations[i]) cache.map[s] = body.translations[i]; });
        cache.script = body.script; cache.language = body.language; cache.fallback = !!body.fallback;
        try { localStorage.setItem(trCacheKey(target), JSON.stringify(cache)); } catch (e) { /* quota */ }
        if (onProgress) onProgress(++done, chunks.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(TR_PARALLEL, chunks.length) }, worker));
  }
  return cache;
}

// ---------------- ASCII helper for filename ----------------
function toAsciiLetters(s) {
  const map = { ą:'a', ć:'c', ę:'e', ł:'l', ń:'n', ó:'o', ś:'s', ź:'z', ż:'z',
    Ą:'A', Ć:'C', Ę:'E', Ł:'L', Ń:'N', Ó:'O', Ś:'S', Ź:'Z', Ż:'Z' };
  return (s || '').split('').map(c => map[c] || c).join('').replace(/[^a-zA-Z0-9]/g, '');
}

// ---------------- Submit ----------------
const form = document.getElementById('form');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('status');
function showStatus(msg, type) { statusEl.textContent = msg; statusEl.className = 'status ' + type; }

function anyDocSelected(d) {
  return DOC_ORDER[d.typ].some(k => d.docs[k]);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.className = 'status';

  let firstInvalid = null;
  form.querySelectorAll('input[required]').forEach(inp => {
    const v = (inp.value || '').trim();
    if (!v) { inp.setCustomValidity('To pole jest wymagane.'); if (!firstInvalid) firstInvalid = inp; }
    else inp.setCustomValidity('');
  });
  if (!form.checkValidity()) {
    form.reportValidity();
    if (firstInvalid) firstInvalid.focus();
    showStatus('Uzupełnij wszystkie wymagane pola.', 'error');
    return;
  }

  await umowaTpl.pending;
  const data = collectData();
  if (!anyDocSelected(data)) { showStatus('Zaznacz przynajmniej jeden dokument do wygenerowania.', 'error'); return; }

  submitBtn.disabled = true;
  const orig = submitBtn.textContent;
  submitBtn.textContent = 'Generowanie...';

  try {
    await loadFonts();
    let tr = null, trNote = '';
    if (data.tlumaczenie.on) {
      const target = data.tlumaczenie.jezyk || data.p.obywatelstwo;
      if (!target) throw new Error('Podaj obywatelstwo albo język tłumaczenia.');
      const strings = await collectStrings(data);
      submitBtn.textContent = 'Tłumaczenie…';
      tr = await getTranslations(target, strings, (n, all) => { submitBtn.textContent = `Tłumaczenie… ${n}/${all}`; });
      await loadScriptFonts(tr.script);
      trNote = ` Tłumaczenie: ${tr.language || target}` + (tr.fallback ? ' (język obywatelstwa nie jest obsługiwany w PDF — użyto angielskiego)' : '') + '.';
      submitBtn.textContent = 'Generowanie...';
    }
    const bytes = await generateKomplet(data, tr);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const safe = toAsciiLetters(`${data.p.nazwisko}_${data.p.imiona}`).toLowerCase() || 'zleceniobiorca';
    const filename = `${data.typ === 'praca' ? 'Umowa_o_prace' : 'Umowa_zlecenie'}_komplet_${safe}_${data.sign.data || ''}.pdf`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);

    showStatus('Komplet został wygenerowany i pobrany.' + trNote, 'success');

    // Save / update the worker profile in the portal directory (non-blocking)
    if (window.Workers && window.Workers.save) {
      try {
        await window.Workers.save({
          nazwisko: data.p.nazwisko, imiona: data.p.imiona, pesel: data.p.pesel,
          data: { p: data.p, adres: data.adres, meld: data.meld },
        });
        loadWorkers();
      } catch (err) { console.warn('worker save failed:', err); }
    }

    // Save to history (non-blocking — never fails the generation)
    if (window.DocHistory && window.DocHistory.save) {
      try {
        await window.DocHistory.save({
          docType: 'umowa-zlecenie',
          title: data.typ === 'praca' ? 'Umowa o pracę — komplet' : 'Umowa zlecenie — komplet',
          subject: fullName(data.p),
          filename,
          payload: data,
          pdfBytes: bytes,
        });
        showStatus('Komplet wygenerowany, pobrany i zapisany w historii.' + trNote, 'success');
      } catch (err) {
        console.warn('History save failed:', err);
        showStatus('Komplet pobrany. (Nie udało się zapisać w historii — sprawdź połączenie.)', 'success');
      }
    }
  } catch (err) {
    console.error(err);
    showStatus('Błąd: ' + (err.message || err), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = orig;
  }
});
