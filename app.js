/* global PDFLib, fontkit, JSZip */
const { PDFDocument, rgb } = PDFLib;

// ---------------- Dynamic person groups ----------------
const MAX_PERSONS = 4;

function makePersonGroup(prefix, idx, kind) {
  const wrapper = document.createElement('div');
  wrapper.className = 'subgroup';
  wrapper.dataset.idx = idx;
  wrapper.dataset.prefix = prefix;
  const title = kind === 'wsp' ? 'Wspólnik' : 'Członek zarządu';
  const removeBtn = idx > 1
    ? `<button type="button" class="remove-btn" aria-label="Usuń">×</button>`
    : '';
  wrapper.innerHTML = `
    ${removeBtn}
    <h3>${title} ${idx}</h3>
    <div class="row">
      <div class="field">
        <label>Imię${kind === 'wsp' ? ' / nazwa (osoba prawna)' : ''}</label>
        <input type="text" name="${prefix}_imie_${idx}" required />
      </div>
      <div class="field">
        <label>Nazwisko${kind === 'wsp' ? ' / nr rejestru' : ''}</label>
        <input type="text" name="${prefix}_nazwisko_${idx}" required />
      </div>
    </div>
    <div class="field">
      <label>Adres do doręczeń</label>
      <input type="text" name="${prefix}_adres_${idx}" required />
    </div>
  `;
  return wrapper;
}

function setupDynamicList(containerId, addBtnId, prefix, kind) {
  const container = document.getElementById(containerId);
  const addBtn = document.getElementById(addBtnId);

  const renumber = () => {
    const groups = container.querySelectorAll('.subgroup');
    groups.forEach((g, i) => {
      const newIdx = i + 1;
      g.dataset.idx = newIdx;
      g.querySelector('h3').textContent =
        (kind === 'wsp' ? 'Wspólnik ' : 'Członek zarządu ') + newIdx;
      // update input names to keep collectData() working
      g.querySelectorAll('input').forEach(inp => {
        inp.name = inp.name.replace(/_\d+$/, '_' + newIdx);
      });
    });
    addBtn.style.display = groups.length >= MAX_PERSONS ? 'none' : '';
  };

  const addGroup = () => {
    const next = container.querySelectorAll('.subgroup').length + 1;
    if (next > MAX_PERSONS) return;
    const g = makePersonGroup(prefix, next, kind);
    container.appendChild(g);
    renumber();
    g.querySelector('input').focus();
  };

  container.appendChild(makePersonGroup(prefix, 1, kind));
  addBtn.addEventListener('click', addGroup);
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-btn');
    if (!btn) return;
    btn.closest('.subgroup').remove();
    renumber();
  });
  renumber();
}

setupDynamicList('wspolnicy', 'addWspolnik', 'w', 'wsp');
setupDynamicList('zarzad', 'addZarzad', 'z', 'zar');

// Default today's date
document.getElementById('date').valueAsDate = new Date();

// ---------------- Font cache ----------------
let fontRegularBytes = null;
let fontBoldBytes = null;
async function loadFonts() {
  if (fontRegularBytes && fontBoldBytes) return;
  const [r, b] = await Promise.all([
    fetch('fonts/Roboto-Regular.ttf').then(r => {
      if (!r.ok) throw new Error('Nie można wczytać czcionki Regular');
      return r.arrayBuffer();
    }),
    fetch('fonts/Roboto-Bold.ttf').then(r => {
      if (!r.ok) throw new Error('Nie można wczytać czcionki Bold');
      return r.arrayBuffer();
    }),
  ]);
  fontRegularBytes = r;
  fontBoldBytes = b;
}

// ---------------- Collect form data ----------------
function collectData() {
  const fd = new FormData(document.getElementById('form'));
  const get = (n) => (fd.get(n) || '').toString().trim();

  const collect = (prefix) => {
    const out = [];
    for (let i = 1; i <= MAX_PERSONS; i++) {
      const imie = get(`${prefix}_imie_${i}`).toUpperCase();
      const nazwisko = get(`${prefix}_nazwisko_${i}`).toUpperCase();
      const adres = get(`${prefix}_adres_${i}`);
      out.push({ imie, nazwisko, adres, empty: !imie && !nazwisko && !adres });
    }
    return out;
  };

  const isoDate = get('date');
  const [y, m, d] = isoDate.split('-');
  const date = isoDate ? `${d}-${m}-${y}` : '';

  return {
    company: get('company').toUpperCase(),
    seat: get('seat').toUpperCase(),
    date,
    wspolnicy: collect('w'),
    zarzad: collect('z'),
    foreign: get('foreign'),
    property: get('property'),
  };
}

// ---------------- PDF helpers ----------------
function drawCentered(page, text, y, size, font, color = rgb(0, 0, 0)) {
  if (!text) return;
  const w = font.widthOfTextAtSize(text, size);
  const x = (page.getWidth() - w) / 2;
  page.drawText(text, { x, y, font, size, color });
}

function wrapLines(text, font, size, maxWidth) {
  const lines = [];
  if (!text) return lines;
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    if (words.length === 0) lines.push('');
  }
  return lines;
}

function drawWrapped(page, text, x, y, maxWidth, size, font, lineHeight) {
  const lh = lineHeight || size * 1.35;
  const lines = wrapLines(text, font, size, maxWidth);
  let yy = y;
  for (const line of lines) {
    page.drawText(line, { x, y: yy, font, size });
    yy -= lh;
  }
  return yy;
}

function drawCenteredWrapped(page, text, y, maxWidth, size, font) {
  const lh = size * 1.35;
  const lines = wrapLines(text, font, size, maxWidth);
  let yy = y;
  for (const line of lines) {
    const w = font.widthOfTextAtSize(line, size);
    const x = (page.getWidth() - w) / 2;
    page.drawText(line, { x, y: yy, font, size });
    yy -= lh;
  }
  return yy;
}

async function newPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontRegularBytes);
  const bold = await doc.embedFont(fontBoldBytes);
  const page = doc.addPage([595.28, 841.89]); // A4
  return { doc, page, font, bold };
}

function drawHeader(page, font, bold, data, titleText) {
  const W = page.getWidth();
  const margin = 60;
  const innerW = W - margin * 2;
  let y = page.getHeight() - 60;

  drawCenteredWrapped(page, titleText, y, innerW, 13, bold);
  y -= 28;

  const compLines = wrapLines(data.company, font, 10, innerW);
  for (const l of compLines) {
    const w = font.widthOfTextAtSize(l, 10);
    page.drawText(l, { x: (W - w) / 2, y, font, size: 10 });
    y -= 14;
  }
  y -= 12;

  drawCentered(page, 'z siedzibą w :', y, 11, bold);
  y -= 18;
  const seatLines = wrapLines(data.seat, font, 10, innerW);
  for (const l of seatLines) {
    const w = font.widthOfTextAtSize(l, 10);
    page.drawText(l, { x: (W - w) / 2, y, font, size: 10 });
    y -= 14;
  }
  y -= 12;

  drawCentered(page, 'na dzień', y, 11, bold);
  y -= 18;
  drawCentered(page, data.date, y, 10, font);
  y -= 24;

  return y;
}

function drawSignatures(page, font, bold, data, startY) {
  const margin = 60;
  let y = startY;
  page.drawText('Podpisy wszystkich członków zarządu:', { x: margin, y, font: bold, size: 11 });
  y -= 30;
  const filled = data.zarzad.filter(z => !z.empty);
  for (const z of filled) {
    const name = `${z.imie} ${z.nazwisko}`.trim();
    page.drawText(name, { x: margin, y, font, size: 11 });
    y -= 20;
  }
  return y;
}

// ---------------- Table drawing ----------------
function drawTable(page, x, y, colWidths, headerLines, rowsData, font, bold, rowHeight, headerHeight) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const lineHeight = 12;
  const cellPad = 4;

  // Compute required header height from text wrapping
  let maxHeaderLines = 1;
  for (let c = 0; c < headerLines.length; c++) {
    const lines = wrapLines(headerLines[c], bold, 10, colWidths[c] - cellPad * 2);
    if (lines.length > maxHeaderLines) maxHeaderLines = lines.length;
  }
  const requiredHeader = maxHeaderLines * lineHeight + 12;
  if (requiredHeader > headerHeight) headerHeight = requiredHeader;

  // Header background
  page.drawRectangle({ x, y: y - headerHeight, width: totalW, height: headerHeight, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });

  // Header text
  let cx = x;
  for (let c = 0; c < headerLines.length; c++) {
    const lines = wrapLines(headerLines[c], bold, 10, colWidths[c] - cellPad * 2);
    let ty = y - 14;
    for (const line of lines) {
      page.drawText(line, { x: cx + cellPad, y: ty, font: bold, size: 10 });
      ty -= lineHeight;
    }
    cx += colWidths[c];
  }
  // Header column dividers
  cx = x;
  for (let c = 0; c < headerLines.length - 1; c++) {
    cx += colWidths[c];
    page.drawLine({ start: { x: cx, y }, end: { x: cx, y: y - headerHeight }, color: rgb(0, 0, 0), thickness: 0.8 });
  }

  let cy = y - headerHeight;

  // Data rows
  for (let r = 0; r < rowsData.length; r++) {
    page.drawRectangle({ x, y: cy - rowHeight, width: totalW, height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
    // Column dividers
    let dx = x;
    for (let c = 0; c < colWidths.length - 1; c++) {
      dx += colWidths[c];
      page.drawLine({ start: { x: dx, y: cy }, end: { x: dx, y: cy - rowHeight }, color: rgb(0, 0, 0), thickness: 0.8 });
    }

    // Row content
    const row = rowsData[r];
    let rx = x;
    for (let c = 0; c < row.length; c++) {
      const cellText = row[c];
      const isFirstColAndBold = c === 0;
      const cellFont = isFirstColAndBold ? bold : font;
      const lines = wrapLines(cellText, cellFont, 10, colWidths[c] - cellPad * 2);
      let ty = cy - 14;
      for (const line of lines) {
        page.drawText(line, { x: rx + cellPad, y: ty, font: cellFont, size: 10 });
        ty -= lineHeight;
      }
      rx += colWidths[c];
    }
    cy -= rowHeight;
  }

  return cy;
}

// ---------------- PDF generators ----------------
async function generateWspolnik(data) {
  const { doc, page, font, bold } = await newPdf();
  let y = drawHeader(page, font, bold, data, 'Lista wspólników spółki');

  const margin = 60;
  const tableW = page.getWidth() - margin * 2;
  const colWidths = [30, 130, 130, tableW - 290];
  const headers = [
    'L.p.',
    'Imię / nazwa w przypadku osoby prawnej',
    'Nazwisko / nazwa i numer rejestru, w przypadku osoby prawnej',
    'adres do doręczeń/ w przypadku gdy wspólnikiem jest osobą prawną imiona i nazwiska oraz adresy do doręczeń osób fizycznych, które są uprawnione do jej reprezentacji np. członków zarządu',
  ];
  const rows = data.wspolnicy.map((w, i) => [
    `${i + 1}.`,
    w.empty ? '' : w.imie,
    w.empty ? '' : w.nazwisko,
    w.empty ? '' : w.adres,
  ]);

  y = drawTable(page, margin, y, colWidths, headers, rows, font, bold, 70, 60);
  y -= 30;
  drawSignatures(page, font, bold, data, y);

  return await doc.save();
}

async function generateZarzad(data) {
  const { doc, page, font, bold } = await newPdf();
  let y = drawHeader(page, font, bold, data, 'Lista członków zarządu spółki');

  const margin = 60;
  const tableW = page.getWidth() - margin * 2;
  const colWidths = [30, 130, 130, tableW - 290];
  const headers = ['L.p.', 'Imię', 'Nazwisko', 'adres'];
  const rows = data.zarzad.map((z, i) => [
    `${i + 1}.`,
    z.empty ? '' : z.imie,
    z.empty ? '' : z.nazwisko,
    z.empty ? '' : z.adres,
  ]);

  y = drawTable(page, margin, y, colWidths, headers, rows, font, bold, 50, 24);
  y -= 36;
  drawSignatures(page, font, bold, data, y);

  return await doc.save();
}

async function generateCudzoziemiec(data) {
  const { doc, page, font, bold } = await newPdf();
  let y = drawHeader(page, font, bold, data, 'Oświadczenie zarządu spółki:');

  const W = page.getWidth();
  const margin = 60;
  const innerW = W - margin * 2;

  drawCentered(page, 'w sprawie posiadania statusu Cudzoziemca', y, 12, bold);
  y -= 28;
  drawCentered(page, 'Oświadczam/y że', y, 11, font);
  y -= 24;

  // Spółka [TAK/NIE] jest Cudzoziemcem ...
  const part1 = 'Spółka ';
  const part2 = data.foreign || '___';
  const part3 = ' jest Cudzoziemcem w rozumieniu ustawy z dnia 24 marca 1920 r. o nabywaniu nieruchomości przez cudzoziemców.';
  const size = 10;
  const fullText = part1 + part2 + part3;
  const lines = wrapLines(fullText, font, size, innerW);

  let yy = y;
  for (const line of lines) {
    // draw TAK/NIE in bold if present in this line
    if (line.includes(' ' + part2 + ' ') && part2 !== '___') {
      const before = line.split(' ' + part2 + ' ')[0] + ' ';
      const after = ' ' + line.split(' ' + part2 + ' ').slice(1).join(' ' + part2 + ' ');
      const wAll = font.widthOfTextAtSize(line, size);
      let x = (W - wAll) / 2;
      page.drawText(before, { x, y: yy, font, size });
      x += font.widthOfTextAtSize(before, size);
      page.drawText(part2, { x, y: yy, font: bold, size });
      x += bold.widthOfTextAtSize(part2, size);
      page.drawText(after, { x, y: yy, font, size });
    } else {
      const w = font.widthOfTextAtSize(line, size);
      page.drawText(line, { x: (W - w) / 2, y: yy, font, size });
    }
    yy -= size * 1.5;
  }
  y = yy - 14;

  // Property statement
  const propText = data.property === 'TAK'
    ? 'Spółka jest właścicielem nieruchomości na terenie Rzeczypospolitej Polskiej.'
    : 'Spółka nie jest właścicielem nieruchomości na terenie Rzeczypospolitej Polskiej.';
  y = drawWrapped(page, propText, margin, y, innerW, 10, font, 14);
  y -= 40;

  drawSignatures(page, font, bold, data, y);

  return await doc.save();
}

// ---------------- Submit ----------------
const form = document.getElementById('form');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('status');

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.className = 'status';

  // Reject whitespace-only values on required inputs
  let firstInvalid = null;
  form.querySelectorAll('input[required]').forEach(inp => {
    const v = (inp.value || '').trim();
    if (!v) {
      inp.setCustomValidity('To pole jest wymagane.');
      if (!firstInvalid) firstInvalid = inp;
    } else {
      inp.setCustomValidity('');
    }
  });

  if (!form.checkValidity()) {
    form.reportValidity();
    if (firstInvalid) firstInvalid.focus();
    showStatus('Uzupełnij wszystkie wymagane pola.', 'error');
    return;
  }

  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = 'Generowanie...';

  try {
    await loadFonts();
    const data = collectData();
    const [wsp, zar, cud] = await Promise.all([
      generateWspolnik(data),
      generateZarzad(data),
      generateCudzoziemiec(data),
    ]);

    const zip = new JSZip();
    zip.file('Lista wspolnikow.pdf', wsp);
    zip.file('Lista czlonkow zarzadu.pdf', zar);
    zip.file('Oswiadczenie cudzoziemiec.pdf', cud);
    const blob = await zip.generateAsync({ type: 'blob' });

    const safeName = (data.company.split(' ')[0] || 'spolka').toLowerCase().replace(/[^a-z0-9]/g, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dokumenty_${safeName}_${data.date}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);

    showStatus('Dokumenty zostały pobrane.', 'success');
  } catch (err) {
    console.error(err);
    showStatus('Błąd: ' + (err.message || err), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});
