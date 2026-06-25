/* global PDFLib, fontkit */
const { PDFDocument, rgb } = PDFLib;

const TEMPLATE_URL = 'zalacznik-pobyt-template.pdf';
const PAGE_H = 841.89; // A4 height in points (template media box)

// ---------------- Polish number-to-words (currency) ----------------
const _ones = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć',
  'dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście',
  'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const _tens = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt',
  'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const _hundreds = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset',
  'siedemset', 'osiemset', 'dziewięćset'];
function under1000(n) {
  if (n === 0) return '';
  const h = Math.floor(n / 100), rest = n % 100, parts = [];
  if (h) parts.push(_hundreds[h]);
  if (rest < 20) { if (rest > 0) parts.push(_ones[rest]); }
  else { parts.push(_tens[Math.floor(rest / 10)]); const u = rest % 10; if (u) parts.push(_ones[u]); }
  return parts.join(' ');
}
function plPlural(n, one, few, many) {
  if (n === 1) return one;
  const last = n % 10, lastTwo = n % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}
function numberToWordsPL(n) {
  if (n === 0) return 'zero';
  const mil = Math.floor(n / 1000000), thou = Math.floor((n % 1000000) / 1000), rest = n % 1000, parts = [];
  if (mil) { parts.push(under1000(mil)); parts.push(plPlural(mil, 'milion', 'miliony', 'milionów')); }
  if (thou) {
    if (thou === 1) parts.push('tysiąc');
    else { parts.push(under1000(thou)); parts.push(plPlural(thou, 'tysiąc', 'tysiące', 'tysięcy')); }
  }
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}
function parseAmount(input) {
  const cleaned = String(input).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  if (isNaN(n) || n < 0) return null;
  const zl = Math.floor(n), gr = Math.round((n - zl) * 100);
  return { zl, gr };
}
function formatAmountZL({ zl, gr }) {
  const zlStr = zl.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${zlStr},${gr.toString().padStart(2, '0')} zł`;
}
function amountInWords({ zl, gr }) {
  return `${numberToWordsPL(zl)} ${plPlural(zl, 'złoty', 'złote', 'złotych')} ${gr.toString().padStart(2, '0')}/100`;
}

// ---------------- KRS integration ----------------
const krsFileInput = document.getElementById('krsFile');
const krsBtn = document.getElementById('krsUploadBtn');
const krsStatus = document.getElementById('krsStatus');
const signerSelect = document.getElementById('signer');
const signerManualWrap = document.getElementById('signerManualWrap');

let zarzadList = []; // [{imie, nazwisko, funkcja}]

function setKrsStatus(msg, type) {
  krsStatus.textContent = msg;
  krsStatus.className = 'krs-status ' + (type || '');
}
krsBtn.addEventListener('click', () => krsFileInput.click());

krsFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { setKrsStatus('Plik jest za duży (max 10 MB).', 'error'); return; }
  setKrsStatus('⏳ Analizuję wypis KRS...', 'loading');
  try {
    const data = await window.KRSParser.parseFile(file);
    applyKRSData(data);
    setKrsStatus(`✅ Wczytano: ${data.firma || 'spółka'} · ${zarzadList.length} członek/członkowie zarządu. Uzupełnij dane o pracy.`, 'success');
  } catch (err) {
    console.error(err);
    setKrsStatus('Nie udało się sparsować pliku. Upewnij się, że to oficjalny „Odpis aktualny KRS" w formacie PDF z prs.ms.gov.pl.', 'error');
  } finally {
    krsFileInput.value = '';
  }
});

function setVal(id, val) {
  if (val == null || val === '') return;
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function buildAddress(adres) {
  if (!adres) return '';
  let s = '';
  if (adres.ulica) s += 'ul. ' + adres.ulica;
  if (adres.nrDomu) s += ' ' + adres.nrDomu;
  if (adres.nrLokalu) s += '/' + adres.nrLokalu;
  const tail = [];
  if (adres.kodPocztowy || adres.miejscowosc) tail.push(`${adres.kodPocztowy || ''} ${adres.miejscowosc || ''}`.trim());
  tail.push('POLSKA');
  return (s ? s + ', ' : '') + tail.join(', ');
}

function applyKRSData(d) {
  if (d.firma) setVal('company', d.firma);
  if (d.krs) setVal('krs', d.krs);
  if (d.nip) setVal('nip', d.nip);
  if (d.regon) setVal('regon', d.regon);
  if (d.adres) {
    setVal('ulica', d.adres.ulica);
    setVal('nrDomu', d.adres.nrDomu);
    setVal('nrLokalu', d.adres.nrLokalu);
    setVal('kod', d.adres.kodPocztowy);
    setVal('miasto', d.adres.miejscowosc);
    setVal('miejscePracy', buildAddress(d.adres));
  }
  zarzadList = (d.zarzad || []).map(z => ({
    imie: (z.imie || '').trim(),
    nazwisko: (z.nazwisko || '').trim(),
    funkcja: (z.funkcja || '').trim(),
  }));
  // Position from first board member's function
  if (zarzadList.length && zarzadList[0].funkcja) {
    setVal('stanowisko', capitalizeWords(zarzadList[0].funkcja));
  }
  populateSigner();
}

function capitalizeWords(s) {
  return s.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function populateSigner() {
  signerSelect.innerHTML = '';
  zarzadList.forEach((z, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    const fn = z.funkcja ? ' — ' + capitalizeWords(z.funkcja) : '';
    opt.textContent = `${capitalizeWords(z.imie)} ${capitalizeWords(z.nazwisko)}${fn}`;
    signerSelect.appendChild(opt);
  });
  const manual = document.createElement('option');
  manual.value = 'manual';
  manual.textContent = '— wpisz ręcznie —';
  signerSelect.appendChild(manual);
  signerSelect.value = zarzadList.length ? '0' : 'manual';
  toggleSignerManual();
}

function toggleSignerManual() {
  signerManualWrap.hidden = signerSelect.value !== 'manual';
}
signerSelect.addEventListener('change', toggleSignerManual);
populateSigner();

// Default dates
const today = new Date();
const isoToday = today.toISOString().slice(0, 10);
document.getElementById('okresOd').value = isoToday;
document.getElementById('dataPodpisu').value = isoToday;
const inThree = new Date(today); inThree.setFullYear(inThree.getFullYear() + 3);
document.getElementById('okresDo').value = inThree.toISOString().slice(0, 10);

// Auto-uppercase company name
document.getElementById('company').addEventListener('input', (e) => {
  const p = e.target.selectionStart;
  e.target.value = e.target.value.toUpperCase();
  e.target.setSelectionRange(p, p);
});

// ---------------- Fonts ----------------
let fontRegular = null, fontBold = null;
async function loadFonts() {
  if (fontRegular && fontBold) return;
  [fontRegular, fontBold] = await Promise.all([
    fetch('fonts/Roboto-Regular.ttf').then(r => r.arrayBuffer()),
    fetch('fonts/Roboto-Bold.ttf').then(r => r.arrayBuffer()),
  ]);
}

// ---------------- Data collection ----------------
function getSigner() {
  if (signerSelect.value === 'manual' || !zarzadList.length) {
    return {
      imie: (document.getElementById('signerImie').value || '').trim(),
      nazwisko: (document.getElementById('signerNazwisko').value || '').trim(),
    };
  }
  const z = zarzadList[parseInt(signerSelect.value, 10)] || zarzadList[0];
  return { imie: capitalizeWords(z.imie), nazwisko: capitalizeWords(z.nazwisko) };
}

function collectData() {
  const v = (id) => (document.getElementById(id).value || '').trim();
  const signer = getSigner();
  return {
    company: v('company').toUpperCase(),
    address: buildAddressFromForm(),
    krs: v('krs'),
    nip: v('nip'),
    regon: v('regon'),
    stanowisko: v('stanowisko'),
    zawod: v('zawod'),
    kodZawodu: v('kodZawodu'),
    wymiar: v('wymiar'),
    miejscePracy: v('miejscePracy'),
    podstawaPracy: v('podstawaPracy'),
    kwota: parseAmount(v('kwota')),
    okresOd: v('okresOd'),
    okresDo: v('okresDo'),
    obowiazki: v('obowiazki'),
    niekaralnosc: document.getElementById('niekaralnosc').checked,
    signer,
    printName: document.getElementById('printName').checked,
    dataPodpisu: v('dataPodpisu'),
  };
}

function buildAddressFromForm() {
  const v = (id) => (document.getElementById(id).value || '').trim();
  return buildAddress({
    ulica: v('ulica'), nrDomu: v('nrDomu'), nrLokalu: v('nrLokalu'),
    kodPocztowy: v('kod'), miejscowosc: v('miasto'),
  });
}

// ---------------- Drawing helpers ----------------
function widthOf(text, font, size) { return font.widthOfTextAtSize(text, size); }

// Single-line text, shrink size to fit maxWidth.
function drawFit(page, text, x, yBaseline, maxWidth, size, font) {
  if (!text) return;
  let s = size;
  while (s > 5 && widthOf(text, font, s) > maxWidth) s -= 0.25;
  page.drawText(text, { x, y: yBaseline, size: s, font, color: rgb(0, 0, 0) });
}

function wrapLines(text, font, size, maxWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (widthOf(test, font, size) > maxWidth && line) { out.push(line); line = w; }
      else line = test;
    }
    if (line) out.push(line);
  }
  return out;
}

// Multi-line text across an array of baseline Y positions (one per available ruled line).
function drawWrapAcross(page, text, x, baselines, maxWidth, size, font) {
  if (!text) return;
  const lines = wrapLines(text, font, size, maxWidth);
  for (let i = 0; i < lines.length && i < baselines.length; i++) {
    page.drawText(lines[i], { x, y: baselines[i], size, font, color: rgb(0, 0, 0) });
  }
}

// Centre one character in a date cell.
function drawCell(page, ch, cx, yBaseline, size, font) {
  const w = widthOf(ch, font, size);
  page.drawText(ch, { x: cx - w / 2, y: yBaseline, size, font, color: rgb(0, 0, 0) });
}
// Place a date (ISO yyyy-mm-dd) one digit per cell, given cell-centre arrays.
function drawDateCells(page, iso, yBaseline, yearXs, monthXs, dayXs, size, font) {
  if (!iso) return;
  const [y, m, d] = iso.split('-');
  for (let i = 0; i < 4 && i < yearXs.length; i++) drawCell(page, y[i], yearXs[i], yBaseline, size, font);
  for (let i = 0; i < 2 && i < monthXs.length; i++) drawCell(page, m[i], monthXs[i], yBaseline, size, font);
  for (let i = 0; i < 2 && i < dayXs.length; i++) drawCell(page, d[i], dayXs[i], yBaseline, size, font);
}
// Date-box cell centres (pt, x) measured from the 6-page continuous template.
const DATE_OD = { y: [152.6, 167.3, 182.1, 196.9], m: [226.8, 241.0], d: [268.8, 284.6] };
const DATE_DO = { y: [366.1, 382.2, 398.4, 414.4], m: [445.1, 460.2], d: [490.5, 505.6] };
const DATE_SIGN = { y: [362.9, 379.7, 396.7, 413.6], m: [447.4, 464.3], d: [497.9, 515.2] };

// Declaration "a" checkbox centres on page 3 (idx 2). x≈75.5pt; pdf-lib y of box centre.
const DECL_BOX_X = 75.5;
const DECL_BOX_Y = [266.6, 233.6, 200.6, 134.6, 117.6, 92.6, 59.6, 26.6];

// ---------------- PDF generation ----------------
async function generate(data) {
  const tplBytes = await fetch(TEMPLATE_URL).then(r => {
    if (!r.ok) throw new Error('Nie udało się wczytać szablonu PDF (' + r.status + ').');
    return r.arrayBuffer();
  });
  const doc = await PDFDocument.load(tplBytes);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontRegular);
  const bold = await doc.embedFont(fontBold);
  const pages = doc.getPages();
  // All coordinates below are pdf-lib user space (origin bottom-left), measured
  // directly from the 6-page continuous template (zalacznik-pobyt-template.pdf).

  // ---- Page 1 (idx 0): I.1 Nazwa, I.2 Adres (both grids at page bottom) ----
  drawFit(pages[0], data.company, 203, 137, 328, 9, font);
  drawFit(pages[0], data.address, 200, 46, 328, 9, font);

  // ---- Page 2 (idx 1): I.3 Podstawa prawna, REGON, III.1 Stanowisko (bottom) ----
  const podstawaPodmiotu = `Krajowy Rejestr Sądowy – Rejestr Przedsiębiorców, nr KRS ${data.krs}`
    + (data.nip ? `; NIP ${data.nip}` : '');
  drawWrapAcross(pages[1], podstawaPodmiotu, 95, [675, 663, 651], 432, 8.5, font);
  if (data.regon) drawFit(pages[1], data.regon, 200, 510, 140, 9, font);
  drawWrapAcross(pages[1], data.stanowisko, 96, [19.8, 7.8], 426, 9, font);

  // ---- Page 3 (idx 2): III.2-8 praca + okres + declaration ----
  const p3 = pages[2];
  const zawodTxt = data.zawod + (data.kodZawodu ? ` (kod ${data.kodZawodu})` : '');
  drawWrapAcross(p3, zawodTxt, 96, [719.8, 707.8], 426, 9, font);
  drawWrapAcross(p3, data.miejscePracy, 96, [671.1, 659.2], 426, 9, font);
  drawWrapAcross(p3, data.podstawaPracy, 96, [590.6, 578.7], 426, 8.5, font);
  drawWrapAcross(p3, data.wymiar, 96, [524.2, 512.2], 426, 9, font);
  // wynagrodzenie
  if (data.kwota) {
    const amount = `${formatAmountZL(data.kwota)} miesięcznie brutto`;
    drawFit(p3, amount, 96, 467.4, 426, 9, font);
    const slownie = `(słownie: ${amountInWords(data.kwota)} miesięcznie brutto)`;
    drawFit(p3, slownie, 300, 458, 225, 8, font);
  }
  drawWrapAcross(p3, data.obowiazki, 96, [416.7, 403.0, 391.0], 430, 8.5, font);
  // okres od / do — both on one line (yyyy / mm / dd, one digit per cell)
  drawDateCells(p3, data.okresOd, 324.5, DATE_OD.y, DATE_OD.m, DATE_OD.d, 9, font);
  drawDateCells(p3, data.okresDo, 321.3, DATE_DO.y, DATE_DO.m, DATE_DO.d, 9, font);
  // declaration X marks (variant "a") — 8 checkboxes, page 3
  if (data.niekaralnosc) {
    for (const c of DECL_BOX_Y) {
      p3.drawText('X', { x: DECL_BOX_X - 3, y: c - 3, size: 9.5, font: bold, color: rgb(0, 0, 0) });
    }
  }

  // ---- Page 5 (idx 4): data i podpis ----
  const p5 = pages[4];
  drawDateCells(p5, data.dataPodpisu, 406.4, DATE_SIGN.y, DATE_SIGN.m, DATE_SIGN.d, 9, font);
  if (data.printName && (data.signer.imie || data.signer.nazwisko)) {
    const name = `${data.signer.imie} ${data.signer.nazwisko}`.trim();
    const w = widthOf(name, font, 9);
    p5.drawText(name, { x: 440 - w / 2, y: 366, size: 9, font, color: rgb(0, 0, 0) });
  }

  // Metadata
  const now = new Date();
  doc.setTitle('Załącznik nr 1 do wniosku o pobyt czasowy');
  doc.setAuthor('TD Consulting Group');
  doc.setProducer('TD Consulting Group — Portal dokumentów');
  doc.setCreator('TD Consulting Group — Portal dokumentów');
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  return await doc.save();
}

// ---------------- Submit ----------------
const form = document.getElementById('form');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('status');
function showStatus(msg, type) { statusEl.textContent = msg; statusEl.className = 'status ' + type; }

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.className = 'status';

  let firstInvalid = null;
  form.querySelectorAll('input[required],textarea[required],select[required]').forEach(inp => {
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

  const data = collectData();
  if (!data.kwota || (data.kwota.zl === 0 && data.kwota.gr === 0)) {
    showStatus('Wprowadź prawidłową kwotę wynagrodzenia.', 'error');
    return;
  }
  if (!data.signer.imie && !data.signer.nazwisko) {
    showStatus('Wskaż osobę podpisującą (z listy KRS lub wpisz ręcznie).', 'error');
    return;
  }

  submitBtn.disabled = true;
  const orig = submitBtn.textContent;
  submitBtn.textContent = 'Generowanie...';
  try {
    await loadFonts();
    const bytes = await generate(data);
    const safe = (data.company.split(' ')[0] || 'spolka').toLowerCase().replace(/[^a-z0-9]/g, '');
    const res = await saveAndDownload({
      docType: 'zalacznik-pobyt',
      title: 'Załącznik nr 1 do wniosku o pobyt czasowy',
      subject: data.company,
      filename: `Zalacznik_nr1_pobyt_${safe || 'spolka'}_${data.dataPodpisu}.pdf`,
      bytes, payload: data,
    });
    showStatus(res.saved
      ? 'Załącznik został wygenerowany, pobrany i zapisany w historii.'
      : 'Załącznik został wygenerowany i pobrany.', 'success');
  } catch (err) {
    console.error(err);
    showStatus('Błąd: ' + (err.message || err), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = orig;
  }
});
