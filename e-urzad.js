/* global PDFLib, fontkit */
const { PDFDocument, rgb } = PDFLib;

const MAX_REPS = 3;

// ---------------- Dynamic reps list ----------------
function makeRepGroup(idx) {
  const w = document.createElement('div');
  w.className = 'subgroup';
  w.innerHTML = `
    ${idx > 1 ? '<button type="button" class="remove-btn" aria-label="Usuń">×</button>' : ''}
    <h3>Osoba ${idx}</h3>
    <div class="row">
      <div class="field">
        <label>Imię</label>
        <input type="text" name="rep_imie_${idx}" ${idx === 1 ? 'required' : ''} />
      </div>
      <div class="field">
        <label>Nazwisko</label>
        <input type="text" name="rep_nazwisko_${idx}" ${idx === 1 ? 'required' : ''} />
      </div>
    </div>
    <div class="field">
      <label>Stanowisko / Funkcja</label>
      <input type="text" name="rep_stanowisko_${idx}" ${idx === 1 ? 'required' : ''} placeholder="np. Prezes Zarządu" value="${idx === 1 ? 'Prezes Zarządu' : ''}" />
    </div>
  `;
  return w;
}

const repsContainer = document.getElementById('reps');
const addRepBtn = document.getElementById('addRep');

function renumberReps() {
  const groups = repsContainer.querySelectorAll('.subgroup');
  groups.forEach((g, i) => {
    const newIdx = i + 1;
    g.querySelector('h3').textContent = 'Osoba ' + newIdx;
    g.querySelectorAll('input').forEach(inp => {
      inp.name = inp.name.replace(/_\d+$/, '_' + newIdx);
    });
  });
  addRepBtn.style.display = groups.length >= MAX_REPS ? 'none' : '';
}

repsContainer.appendChild(makeRepGroup(1));
addRepBtn.addEventListener('click', () => {
  const next = repsContainer.querySelectorAll('.subgroup').length + 1;
  if (next > MAX_REPS) return;
  const g = makeRepGroup(next);
  repsContainer.appendChild(g);
  renumberReps();
  g.querySelector('input').focus();
});
repsContainer.addEventListener('click', (e) => {
  const rm = e.target.closest('.remove-btn');
  if (!rm) return;
  rm.closest('.subgroup').remove();
  renumberReps();
});
renumberReps();

// Toggle access-type visibility based on B.1 / B.2
const accessBlock = document.getElementById('accessTypeBlock');
document.querySelectorAll('input[name="cel"]').forEach(r => {
  r.addEventListener('change', () => {
    const isGrant = document.querySelector('input[name="cel"]:checked').value === 'B.1';
    accessBlock.classList.toggle('active', isGrant);
  });
});

// Auto-uppercase company name
document.getElementById('nazwa').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

// Auto-format postal code as XX-XXX
document.getElementById('kod').addEventListener('input', (e) => {
  let v = e.target.value.replace(/[^0-9]/g, '').slice(0, 5);
  if (v.length > 2) v = v.slice(0, 2) + '-' + v.slice(2);
  e.target.value = v;
});

// Toggle PESEL <-> alternativnyy nomer
const noPeselCheck = document.getElementById('userNoPesel');
const peselInput = document.getElementById('userPesel');
const peselAltWrap = document.getElementById('userPeselAltWrap');
const peselAltInput = document.getElementById('userPeselAlt');
noPeselCheck.addEventListener('change', () => {
  const off = noPeselCheck.checked;
  peselInput.disabled = off;
  peselInput.required = !off;
  if (off) peselInput.value = '';
  peselAltWrap.hidden = !off;
  peselAltInput.required = off;
});

// ---------------- KRS upload integration ----------------
const krsFileInput = document.getElementById('krsFile');
const krsBtn = document.getElementById('krsUploadBtn');
const krsStatus = document.getElementById('krsStatus');

function setKrsStatus(msg, type) {
  krsStatus.textContent = msg;
  krsStatus.className = 'krs-status ' + (type || '');
}

krsBtn.addEventListener('click', () => krsFileInput.click());

krsFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    setKrsStatus('Plik jest za duży (max 10 MB).', 'error');
    return;
  }
  setKrsStatus('⏳ Analizuję wypis KRS...', 'loading');
  try {
    const data = await window.KRSParser.parseFile(file);
    applyKRSData(data);
    setKrsStatus(`✅ Wczytano: ${data.firma || 'spółka'} · ${(data.zarzad || []).length} osob(y) z zarządu. Sprawdź dane i uzupełnij brakujące pola.`, 'success');
  } catch (err) {
    console.error(err);
    setKrsStatus('Nie udało się sparsować pliku. Upewnij się, że to oficjalny „Odpis aktualny KRS" w formacie PDF z prs.ms.gov.pl.', 'error');
  } finally {
    krsFileInput.value = '';
  }
});

function applyKRSData(d) {
  const setVal = (sel, val) => {
    if (val == null || val === '') return;
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // Company core fields
  if (d.firma) setVal('#nazwa', d.firma);
  if (d.nip) setVal('#nip', d.nip);

  // Address fields
  if (d.adres) {
    if (d.adres.ulica) setVal('#ulica', d.adres.ulica);
    if (d.adres.nrDomu) setVal('#nrDomu', d.adres.nrDomu);
    if (d.adres.nrLokalu) setVal('#nrLokalu', d.adres.nrLokalu);
    if (d.adres.kodPocztowy) setVal('#kod', d.adres.kodPocztowy);
    if (d.adres.miejscowosc) setVal('#miasto', d.adres.miejscowosc);
  }

  // Reps (osoby reprezentujące) from zarząd — up to MAX_REPS (3)
  const reps = (d.zarzad || []).slice(0, MAX_REPS);
  if (reps.length > 0) {
    repsContainer.innerHTML = '';
    reps.forEach((z, i) => {
      const idx = i + 1;
      const g = makeRepGroup(idx);
      repsContainer.appendChild(g);
      g.querySelector(`[name="rep_imie_${idx}"]`).value = z.imie || '';
      g.querySelector(`[name="rep_nazwisko_${idx}"]`).value = z.nazwisko || '';
      if (z.funkcja) {
        g.querySelector(`[name="rep_stanowisko_${idx}"]`).value = z.funkcja;
      }
    });
    renumberReps();
  }
}

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

  const reps = [];
  for (let i = 1; i <= MAX_REPS; i++) {
    const imie = get(`rep_imie_${i}`);
    const nazwisko = get(`rep_nazwisko_${i}`);
    const stanowisko = get(`rep_stanowisko_${i}`);
    if (imie || nazwisko) {
      reps.push({
        imie: imie.toUpperCase(),
        nazwisko: nazwisko.toUpperCase(),
        stanowisko: stanowisko.toUpperCase(),
      });
    }
  }

  return {
    urzad: get('urzad'),
    cel: get('cel'),
    rodzaj: get('rodzaj'),
    nip: get('nip'),
    telefon: get('telefon'),
    nazwa: get('nazwa').toUpperCase(),
    ulica: get('ulica').toUpperCase(),
    nrDomu: get('nrDomu'),
    nrLokalu: get('nrLokalu'),
    kod: get('kod'),
    miasto: get('miasto').toUpperCase(),
    userImie: get('userImie').toUpperCase(),
    userNazwisko: get('userNazwisko').toUpperCase(),
    userPesel: get('userPesel'),
    userNoPesel: !!fd.get('userNoPesel'),
    userPeselAlt: get('userPeselAlt'),
    reps,
  };
}

// ---------------- PDF helpers ----------------
function wrapLines(text, font, size, maxWidth) {
  const out = [];
  if (!text) return out;
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    if (line) out.push(line);
    if (!words.length) out.push('');
  }
  return out;
}
function drawWrapped(page, text, x, y, maxW, size, font, lh) {
  const lines = wrapLines(text, font, size, maxW);
  let yy = y;
  for (const l of lines) {
    page.drawText(l, { x, y: yy, font, size });
    yy -= lh;
  }
  return yy;
}

// Section header with shaded background
function drawSectionHeader(page, label, text, x, y, w, font, bold) {
  const h = 22;
  page.drawRectangle({
    x, y: y - h, width: w, height: h,
    color: rgb(0.92, 0.94, 0.98),
    borderColor: rgb(0, 0, 0), borderWidth: 0.8,
  });
  page.drawText(`${label}.`, { x: x + 8, y: y - 15, font: bold, size: 10 });
  page.drawText(text, { x: x + 28, y: y - 15, font: bold, size: 10 });
  return y - h;
}

// Sub-header (smaller height)
function drawSubHeader(page, label, text, x, y, w, font, bold) {
  const h = 18;
  page.drawRectangle({
    x, y: y - h, width: w, height: h,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0, 0, 0), borderWidth: 0.8,
  });
  page.drawText(`${label}.`, { x: x + 8, y: y - 13, font: bold, size: 9 });
  page.drawText(text, { x: x + 32, y: y - 13, font: bold, size: 9 });
  return y - h;
}

// Field box with label above and value inside, returns new y
function drawField(page, label, value, x, y, w, font, bold, opts = {}) {
  const fh = opts.height || 28;
  // tiny label at top-left inside box
  page.drawRectangle({
    x, y: y - fh, width: w, height: fh,
    borderColor: rgb(0, 0, 0), borderWidth: 0.6,
  });
  page.drawText(label, { x: x + 4, y: y - 8, font, size: 7, color: rgb(0.35, 0.35, 0.35) });
  // value, large
  if (value) {
    page.drawText(value, { x: x + 6, y: y - fh + 8, font: opts.valueBold ? bold : font, size: opts.valueSize || 11 });
  }
  return y - fh;
}

// Numeric grid (10 boxes for NIP, 11 boxes for PESEL) — fits within width w
function drawDigitGrid(page, label, value, digits, x, y, w, font, bold) {
  const h = 28;
  // outer box
  page.drawRectangle({
    x, y: y - h, width: w, height: h,
    borderColor: rgb(0, 0, 0), borderWidth: 0.6,
  });
  page.drawText(label, { x: x + 4, y: y - 8, font, size: 7, color: rgb(0.35, 0.35, 0.35) });

  // grid: digits boxes on the right, label section on left
  const gridW = Math.min(digits * 14, w - 100);
  const cell = gridW / digits;
  const gridX = x + (w - gridW) - 4;
  const gridY = y - h + 4;
  const gridH = h - 12;
  const cleanValue = (value || '').replace(/[^0-9]/g, '').slice(0, digits);
  for (let i = 0; i < digits; i++) {
    const cx = gridX + i * cell;
    page.drawRectangle({
      x: cx, y: gridY, width: cell, height: gridH,
      borderColor: rgb(0, 0, 0), borderWidth: 0.4,
    });
    if (cleanValue[i]) {
      const ch = cleanValue[i];
      const cw = bold.widthOfTextAtSize(ch, 11);
      page.drawText(ch, { x: cx + (cell - cw) / 2, y: gridY + 3, font: bold, size: 11 });
    }
  }
  return y - h;
}

// Checkbox with label
function drawCheckbox(page, x, y, label, checked, font, bold, size = 9) {
  const boxSz = 9;
  page.drawRectangle({
    x, y: y - boxSz, width: boxSz, height: boxSz,
    borderColor: rgb(0, 0, 0), borderWidth: 0.8,
  });
  if (checked) {
    // Draw a small filled rectangle inside
    page.drawRectangle({
      x: x + 1.6, y: y - boxSz + 1.6,
      width: boxSz - 3.2, height: boxSz - 3.2,
      color: rgb(0, 0, 0),
    });
  }
  page.drawText(label, { x: x + boxSz + 6, y: y - boxSz + 1, font: bold, size });
}

// ---------------- PDF generator ----------------
async function generateWniosek(data) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontRegular);
  const bold = await doc.embedFont(fontBold);

  const page = doc.addPage([595.28, 841.89]);
  const W = page.getWidth();
  const H = page.getHeight();
  const margin = 40;
  const innerW = W - margin * 2;

  // ----- TITLE
  let y = H - 50;
  const title1 = 'WNIOSEK';
  const t1W = bold.widthOfTextAtSize(title1, 16);
  page.drawText(title1, { x: (W - t1W) / 2, y, font: bold, size: 16 });
  y -= 22;
  const title2 = 'O PRZYZNANIE DOSTĘPU / ODEBRANIE DOSTĘPU DO KONTA ORGANIZACJI W E-URZĘDZIE SKARBOWYM';
  // wrap if too wide
  const t2Lines = wrapLines(title2, bold, 10, innerW);
  for (const l of t2Lines) {
    const lw = bold.widthOfTextAtSize(l, 10);
    page.drawText(l, { x: (W - lw) / 2, y, font: bold, size: 10 });
    y -= 13;
  }
  y -= 4;

  // Subtitle (legal basis)
  const legal = 'Podstawa prawna: art. 35b ust. 2 pkt 2 i ust. 6 ustawy z dnia 16 listopada 2016 r. o Krajowej Administracji Skarbowej.';
  const lLines = wrapLines(legal, font, 8, innerW);
  for (const l of lLines) {
    const lw = font.widthOfTextAtSize(l, 8);
    page.drawText(l, { x: (W - lw) / 2, y, font, size: 8, color: rgb(0.3, 0.3, 0.3) });
    y -= 10;
  }
  y -= 8;

  // ----- A. ORGAN PODATKOWY
  y = drawSectionHeader(page, 'A', 'ORGAN PODATKOWY, DO KTÓREGO JEST ADRESOWANY WNIOSEK', margin, y, innerW, font, bold);
  y = drawField(page, '1. Naczelnik urzędu skarbowego właściwy w sprawach ewidencji i identyfikacji', data.urzad, margin, y, innerW, font, bold, { height: 30, valueSize: 11 });
  y -= 6;

  // ----- B. CEL ZŁOŻENIA WNIOSKU
  y = drawSectionHeader(page, 'B', 'CEL ZŁOŻENIA WNIOSKU', margin, y, innerW, font, bold);
  // checkboxes side by side
  const boxH = 30;
  page.drawRectangle({
    x: margin, y: y - boxH, width: innerW, height: boxH,
    borderColor: rgb(0, 0, 0), borderWidth: 0.6,
  });
  drawCheckbox(page, margin + 12, y - 10, 'B.1  Przyznanie dostępu do konta organizacji', data.cel === 'B.1', font, bold, 9);
  drawCheckbox(page, margin + innerW / 2 + 12, y - 10, 'B.2  Odebranie dostępu do konta organizacji', data.cel === 'B.2', font, bold, 9);
  y -= boxH;
  y -= 6;

  // ----- C.1. DANE IDENTYFIKACYJNE ORGANIZACJI
  y = drawSubHeader(page, 'C.1', 'DANE IDENTYFIKACYJNE ORGANIZACJI I AKTUALNY ADRES SIEDZIBY', margin, y, innerW, font, bold);
  y = drawDigitGrid(page, '2. Identyfikator podatkowy NIP', data.nip, 10, margin, y, innerW, font, bold);
  y = drawField(page, '3. Nazwa pełna', data.nazwa, margin, y, innerW, font, bold, { height: 28, valueSize: 11 });
  // ulica + nr domu + nr lokalu
  const colW1 = innerW * 0.6;
  const colW2 = innerW * 0.2;
  const colW3 = innerW * 0.2;
  let yRow = y;
  drawField(page, '4. Ulica', data.ulica, margin, yRow, colW1, font, bold, { height: 28 });
  drawField(page, '5. Nr domu', data.nrDomu, margin + colW1, yRow, colW2, font, bold, { height: 28 });
  drawField(page, '6. Nr lokalu', data.nrLokalu, margin + colW1 + colW2, yRow, colW3, font, bold, { height: 28 });
  y = yRow - 28;
  // kod + miasto + telefon
  const ckW1 = innerW * 0.22;
  const ckW2 = innerW * 0.48;
  const ckW3 = innerW * 0.30;
  yRow = y;
  drawField(page, '7. Kod pocztowy', data.kod, margin, yRow, ckW1, font, bold, { height: 28 });
  drawField(page, '8. Miejscowość', data.miasto, margin + ckW1, yRow, ckW2, font, bold, { height: 28 });
  drawField(page, '9. Telefon', data.telefon, margin + ckW1 + ckW2, yRow, ckW3, font, bold, { height: 28 });
  y = yRow - 28;
  y -= 6;

  // ----- C.2. RODZAJ DOSTĘPU
  y = drawSubHeader(page, 'C.2', 'RODZAJ PRZYZNAWANEGO DOSTĘPU DO KONTA ORGANIZACJI', margin, y, innerW, font, bold);
  const c2H = 40;
  page.drawRectangle({
    x: margin, y: y - c2H, width: innerW, height: c2H,
    borderColor: rgb(0, 0, 0), borderWidth: 0.6,
  });
  // Apply only if B.1
  const showRodzaj = data.cel === 'B.1';
  drawCheckbox(page, margin + 12, y - 13, 'Podstawowy', showRodzaj && data.rodzaj === 'Podstawowy', font, bold, 9);
  drawCheckbox(page, margin + 12, y - 30, 'Rozszerzony', showRodzaj && data.rodzaj === 'Rozszerzony', font, bold, 9);
  page.drawText('Zaznacz wyłącznie wtedy, gdy zaznaczyłeś pozycję B.1', { x: margin + 200, y: y - 22, font, size: 7.5, color: rgb(0.4, 0.4, 0.4) });
  y -= c2H;
  y -= 6;

  // ----- D. DANE UŻYTKOWNIKA
  y = drawSubHeader(page, 'D', 'DANE UŻYTKOWNIKA, KTÓREMU MA ZOSTAĆ PRZYZNANY / ODEBRANY DOSTĘP', margin, y, innerW, font, bold);
  if (data.userNoPesel) {
    y = drawField(page, '10. PESEL — brak / inny nr identyfikacyjny', data.userPeselAlt, margin, y, innerW, font, bold, { height: 28, valueBold: true });
  } else {
    y = drawDigitGrid(page, '10. PESEL', data.userPesel, 11, margin, y, innerW, font, bold);
  }
  // Nazwisko + Imię side by side
  yRow = y;
  drawField(page, '11. Nazwisko', data.userNazwisko, margin, yRow, innerW / 2, font, bold, { height: 28 });
  drawField(page, '12. Imię', data.userImie, margin + innerW / 2, yRow, innerW / 2, font, bold, { height: 28 });
  y = yRow - 28;
  y -= 6;

  // ----- E. PODPISY
  y = drawSubHeader(page, 'E', 'DANE I PODPISY OSÓB REPREZENTUJĄCYCH ORGANIZACJĘ', margin, y, innerW, font, bold);
  // Disclaimer
  const disclaimer = 'Oświadczam, że znam przepisy Kodeksu karnego skarbowego o odpowiedzialności za podanie danych niezgodnych z rzeczywistością';
  const dLines = wrapLines(disclaimer, font, 8, innerW - 8);
  for (const l of dLines) {
    page.drawText(l, { x: margin + 4, y: y - 8, font, size: 8, color: rgb(0.3, 0.3, 0.3) });
    y -= 10;
  }
  y -= 4;

  // Up to 3 rep entries. Each entry: 2 rows. Row1: Nazwisko + Imię. Row2: Stanowisko + Podpis.
  const slots = [...data.reps, null, null, null].slice(0, 3);
  slots.forEach((rep, i) => {
    const entryH = 56;
    const numCol = 20;
    // Number on left
    page.drawRectangle({
      x: margin, y: y - entryH, width: numCol, height: entryH,
      borderColor: rgb(0, 0, 0), borderWidth: 0.6,
    });
    const num = String(i + 1);
    const nw = bold.widthOfTextAtSize(num, 12);
    page.drawText(num, { x: margin + (numCol - nw) / 2, y: y - entryH / 2 - 4, font: bold, size: 12 });

    // Right area
    const rx = margin + numCol;
    const rw = innerW - numCol;
    // Row 1
    drawField(page, 'Nazwisko', rep ? rep.nazwisko : '', rx, y, rw / 2, font, bold, { height: entryH / 2 });
    drawField(page, 'Imię', rep ? rep.imie : '', rx + rw / 2, y, rw / 2, font, bold, { height: entryH / 2 });
    // Row 2
    drawField(page, 'Stanowisko / Funkcja', rep ? rep.stanowisko : '', rx, y - entryH / 2, rw / 2, font, bold, { height: entryH / 2 });
    drawField(page, 'Podpis', '', rx + rw / 2, y - entryH / 2, rw / 2, font, bold, { height: entryH / 2 });
    y -= entryH;
  });

  y -= 16;

  // Footer (objaśnienia)
  if (y > 60) {
    const obj = 'Objaśnienia';
    const ow = bold.widthOfTextAtSize(obj, 9);
    page.drawText(obj, { x: (W - ow) / 2, y, font: bold, size: 9 });
    y -= 12;
    const o1 = '1) Dostęp podstawowy — użytkownik z dostępem podstawowym może wykonywać wszystkie czynności w e-Urzędzie Skarbowym.';
    const o2 = '2) Dostęp rozszerzony — użytkownik z dostępem rozszerzonym może wykonywać wszystkie czynności w e-Urzędzie Skarbowym oraz dodatkowo nadawać i odbierać dostęp innym użytkownikom do konta organizacji za pośrednictwem e-Urzędu Skarbowego.';
    [o1, o2].forEach(t => {
      y = drawWrapped(page, t, margin, y, innerW, 7.5, font, 9);
      y -= 2;
    });
  }

  return await doc.save();
}

// ---------------- Submit ----------------
const form = document.getElementById('form');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('status');
function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.className = 'status';

  // Trim required inputs
  let firstInvalid = null;
  form.querySelectorAll('input[required]').forEach(inp => {
    const v = (inp.value || '').trim();
    if (!v) {
      inp.setCustomValidity('To pole jest wymagane.');
      if (!firstInvalid) firstInvalid = inp;
    } else inp.setCustomValidity('');
  });

  if (!form.checkValidity()) {
    form.reportValidity();
    if (firstInvalid) firstInvalid.focus();
    showStatus('Uzupełnij wszystkie wymagane pola.', 'error');
    return;
  }

  submitBtn.disabled = true;
  const orig = submitBtn.textContent;
  submitBtn.textContent = 'Generowanie...';

  try {
    await loadFonts();
    const data = collectData();
    const bytes = await generateWniosek(data);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safe = data.userNazwisko.toLowerCase().replace(/[^a-z]/g, '');
    a.download = `Wniosek_eUS_${safe || 'uzytkownik'}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showStatus('Wniosek został wygenerowany i pobrany.', 'success');
  } catch (err) {
    console.error(err);
    showStatus('Błąd: ' + (err.message || err), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = orig;
  }
});
