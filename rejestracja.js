/* global PDFLib, fontkit, JSZip */
const { PDFDocument, rgb } = PDFLib;

// Transliterate Polish characters to ASCII and strip everything except a-zA-Z
function toAsciiLetters(s) {
  const map = { ą:'a', ć:'c', ę:'e', ł:'l', ń:'n', ó:'o', ś:'s', ź:'z', ż:'z',
    Ą:'A', Ć:'C', Ę:'E', Ł:'L', Ń:'N', Ó:'O', Ś:'S', Ź:'Z', Ż:'Z' };
  return (s || '').split('').map(c => map[c] || c).join('').replace(/[^a-zA-Z]/g, '');
}

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
  const copyFromWsp = kind === 'zar' ? `
    <div class="field">
      <label>Skopiuj dane z wspólnika</label>
      <select class="copy-from-wsp">
        <option value="">— wybierz wspólnika —</option>
      </select>
    </div>
  ` : '';
  const extras = kind === 'zar' ? `
    <div class="row">
      <div class="field">
        <label>Miasto (do oświadczenia ZGODY)</label>
        <input type="text" name="${prefix}_miasto_${idx}" required />
      </div>
      <div class="field">
        <label>PESEL</label>
        <input type="text" name="${prefix}_pesel_${idx}" class="pesel-input" required pattern="[0-9]{11}" title="PESEL musi zawierać 11 cyfr" inputmode="numeric" maxlength="11" />
        <label class="nopesel-check"><input type="checkbox" name="${prefix}_nopesel_${idx}" class="nopesel-toggle" /> Brak numeru PESEL</label>
        <input type="text" name="${prefix}_peselalt_${idx}" class="peselalt-input" maxlength="20" placeholder="Inny numer (np. nr paszportu)" hidden style="margin-top:6px" />
      </div>
    </div>
  ` : '';
  wrapper.innerHTML = `
    ${removeBtn}
    <h3>${title} ${idx}</h3>
    ${copyFromWsp}
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
    ${extras}
  `;
  return wrapper;
}

function refreshCopyFromWspDropdowns() {
  const wspGroups = document.querySelectorAll('#wspolnicy .subgroup');
  const options = [];
  wspGroups.forEach((g, i) => {
    const imie = g.querySelector(`[name^="w_imie_"]`)?.value.trim() || '';
    const nazwisko = g.querySelector(`[name^="w_nazwisko_"]`)?.value.trim() || '';
    const label = `${imie} ${nazwisko}`.trim() || `Wspólnik ${i + 1}`;
    options.push({ idx: i + 1, label });
  });

  document.querySelectorAll('#zarzad .copy-from-wsp').forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = '<option value="">— wybierz wspólnika —</option>' +
      options.map(o => `<option value="${o.idx}">${o.label}</option>`).join('');
    if (options.find(o => String(o.idx) === prev)) sel.value = prev;
  });
}

function handleCopyFromWsp(e) {
  const sel = e.target.closest('.copy-from-wsp');
  if (!sel) return;
  const val = sel.value;
  if (!val) return;
  const wspGroup = document.querySelectorAll('#wspolnicy .subgroup')[Number(val) - 1];
  if (!wspGroup) return;
  const zarGroup = sel.closest('.subgroup');
  const get = (g, prefix) => g.querySelector(`[name^="${prefix}"]`)?.value || '';
  const setVal = (g, prefix, v) => {
    const inp = g.querySelector(`[name^="${prefix}"]`);
    if (inp) { inp.value = v; inp.setCustomValidity(''); }
  };
  setVal(zarGroup, 'z_imie_', get(wspGroup, 'w_imie_'));
  setVal(zarGroup, 'z_nazwisko_', get(wspGroup, 'w_nazwisko_'));
  setVal(zarGroup, 'z_adres_', get(wspGroup, 'w_adres_'));
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
  addBtn.addEventListener('click', () => { addGroup(); refreshCopyFromWspDropdowns(); });
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-btn');
    if (!btn) return;
    btn.closest('.subgroup').remove();
    renumber();
    refreshCopyFromWspDropdowns();
  });
  renumber();
}

setupDynamicList('wspolnicy', 'addWspolnik', 'w', 'wsp');
setupDynamicList('zarzad', 'addZarzad', 'z', 'zar');

// Refresh dropdown labels when wspólnik names change
document.getElementById('wspolnicy').addEventListener('input', (e) => {
  if (e.target.name?.startsWith('w_imie_') || e.target.name?.startsWith('w_nazwisko_')) {
    refreshCopyFromWspDropdowns();
  }
});

// Wire up "copy from wsp" dropdown
document.getElementById('zarzad').addEventListener('change', handleCopyFromWsp);

// Toggle PESEL <-> alternativnyy nomer per czlonek zarzadu
document.getElementById('zarzad').addEventListener('change', (e) => {
  const cb = e.target.closest('.nopesel-toggle');
  if (!cb) return;
  const field = cb.closest('.field');
  const pesel = field.querySelector('.pesel-input');
  const alt = field.querySelector('.peselalt-input');
  const off = cb.checked;
  pesel.disabled = off;
  pesel.required = !off;
  if (off) pesel.value = '';
  alt.hidden = !off;
  alt.required = off;
});

refreshCopyFromWspDropdowns();

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
      const miasto = get(`${prefix}_miasto_${i}`);
      const pesel = get(`${prefix}_pesel_${i}`);
      const noPesel = !!document.querySelector(`[name="${prefix}_nopesel_${i}"]`)?.checked;
      const peselAlt = get(`${prefix}_peselalt_${i}`);
      out.push({ imie, nazwisko, adres, miasto, pesel, noPesel, peselAlt, empty: !imie && !nazwisko && !adres });
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

async function newPdf(title) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Metadane — dokument finalny, niezawierający pól edytowalnych (gotowy do podpisu)
  const now = new Date();
  doc.setTitle(title || 'Dokument rejestracyjny');
  doc.setAuthor('TD Consulting Group');
  doc.setProducer('TD Consulting Group — Portal dokumentów');
  doc.setCreator('TD Consulting Group — Portal dokumentów');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
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
  const { doc, page, font, bold } = await newPdf('Lista wspolnikow spolki');
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
  const { doc, page, font, bold } = await newPdf('Lista czlonkow zarzadu spolki');
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
  const { doc, page, font, bold } = await newPdf('Oswiadczenie zarzadu spolki');
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

async function generateZgoda(data, member) {
  const { doc, page, font, bold } = await newPdf('Oswiadczenie o zgodzie na powolanie do zarzadu');
  const W = page.getWidth();
  const margin = 60;
  const innerW = W - margin * 2;
  const size = 11;
  const lh = 16;

  // Top-right: "Miasto, DD.MM.YYYY"
  const [d, m, y] = data.date.split('-');
  const dateDots = `${d}.${m}.${y}`;
  const headerLine = `${member.miasto || ''}, ${dateDots}`;
  let cy = page.getHeight() - 60;
  const headerW = font.widthOfTextAtSize(headerLine, size);
  page.drawText(headerLine, { x: W - margin - headerW, y: cy, font, size });
  cy -= lh * 2;

  // Left block: imię nazwisko / adres / PESEL
  const fullName = `${member.imie} ${member.nazwisko}`.trim();
  page.drawText(fullName, { x: margin, y: cy, font, size }); cy -= lh;
  page.drawText(member.adres || '', { x: margin, y: cy, font, size }); cy -= lh;
  const peselLine = member.noPesel
    ? `Nr identyfikacyjny (brak PESEL): ${member.peselAlt || ''}`
    : `PESEL: ${member.pesel || ''}`;
  page.drawText(peselLine, { x: margin, y: cy, font, size }); cy -= lh * 2;

  // Title (3 lines, centered, bold)
  const titleLines = [
    'OŚWIADCZENIE',
    'O WYRAŻENIU ZGODY NA POWOŁANIE DO ZARZĄDU SPÓŁKI',
    'ORAZ WSKAZANIE ADRESU DO DORĘCZEŃ',
  ];
  for (const line of titleLines) {
    const w = bold.widthOfTextAtSize(line, 12);
    page.drawText(line, { x: (W - w) / 2, y: cy, font: bold, size: 12 });
    cy -= lh;
  }
  cy -= lh;

  // Body 1
  const body1 = `Niniejszym wyrażam zgodę na powołanie w skład Zarządu spółki ${data.company} z siedzibą w ${data.seat} i powierzenie mi funkcji Członka Zarządu.`;
  cy = drawWrapped(page, body1, margin, cy, innerW, size, font, lh);
  cy -= lh / 2;

  // Body 2
  const body2 = 'Stosownie do treści przepisu art. 166 § 1 pkt 5 ustawy z dnia 15 września 2000 roku Kodeks spółek handlowych oraz art. 19a ust. 5 ustawy z dnia 20 sierpnia 1997 roku o Krajowym Rejestrze Sądowym niniejszym wskazuję adres do doręczeń:';
  cy = drawWrapped(page, body2, margin, cy, innerW, size, font, lh);
  cy -= lh / 2;

  // Address
  page.drawText(member.adres || '', { x: margin, y: cy, font, size });
  cy -= lh * 1.5;

  // "Ponadto oświadczam, że:"
  page.drawText('Ponadto oświadczam, że:', { x: margin, y: cy, font, size });
  cy -= lh;

  // Bulleted list
  const bullets = [
    'posiadam pełną zdolność do czynności prawnych,',
    'nie zachodzą przesłanki uniemożliwiające powołanie mnie do Zarządu Spółki, o których mowa w przepisie art. 18 ustawy z dnia 15 września 2000 r. Kodeks spółek handlowych, art. 22 pkt 2 ustawy z dnia 16 grudnia 2016 r. o zasadach zarządzania mieniem państwowym i innych powszechnie obowiązujących przepisach prawa.',
  ];
  for (const b of bullets) {
    const bulletIndent = margin + 16;
    page.drawText('•', { x: margin + 4, y: cy, font, size });
    cy = drawWrapped(page, b, bulletIndent, cy, innerW - 16, size, font, lh);
    cy -= 4;
  }
  cy -= lh / 2;

  // Body 3
  const body3 = 'W przypadku zaistnienia ww. okoliczności stanowiących przeszkodę w powołaniu mnie do Zarządu, zobowiązuję się do złożenia skutecznie, najpóźniej przed dniem zaistnienia tych okoliczności (chyba, że nie jest to obiektywnie możliwe – w takim wypadku niezwłocznie po zaistnieniu takiej okoliczności), rezygnacji z kandydowania na stanowisko członka Zarządu.';
  cy = drawWrapped(page, body3, margin, cy, innerW, size, font, lh);
  cy -= lh / 2;

  // Body 4
  const body4 = 'Jeżeli po powołaniu na stanowisko członka Zarządu Spółki pojawią się okoliczności stanowiące przeszkodę w pełnieniu funkcji członka Zarządu, zobowiązuję się do złożenia skutecznie, najpóźniej przed dniem zaistnienia tych okoliczności (chyba, że nie jest to obiektywnie możliwe – w takim wypadku niezwłocznie po zaistnieniu takiej okoliczności), rezygnacji z zajmowanego w Spółce stanowiska członka Zarządu.';
  cy = drawWrapped(page, body4, margin, cy, innerW, size, font, lh);
  cy -= lh * 3;

  // Signature
  const sigName = fullName;
  const sigW = font.widthOfTextAtSize(sigName, size);
  page.drawText(sigName, { x: W - margin - sigW, y: cy, font, size });

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
    const filledZarzad = data.zarzad.filter(z => !z.empty);
    const [wsp, zar, cud, ...zgody] = await Promise.all([
      generateWspolnik(data),
      generateZarzad(data),
      generateCudzoziemiec(data),
      ...filledZarzad.map(m => generateZgoda(data, m)),
    ]);

    const zip = new JSZip();
    zip.file('Lista_wspolnikow.pdf', wsp);
    zip.file('Lista_czlonkow_zarzadu.pdf', zar);
    zip.file('Oswiadczenie_zarzadu.pdf', cud);
    zgody.forEach((bytes, i) => {
      const m = filledZarzad[i];
      const safe = [toAsciiLetters(m.imie), toAsciiLetters(m.nazwisko)].filter(Boolean).join('_');
      const suffix = safe ? `_${safe}` : `_${i + 1}`;
      zip.file(`Oswiadczenie_zgoda_na_powolanie${suffix}.pdf`, bytes);
    });
    const blob = await zip.generateAsync({ type: 'blob' });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Dokumenty_rejestracja_spolki.zip';
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

// ---------------- Lead form (CTA) ----------------
const leadForm = document.getElementById('leadForm');
const leadStatus = document.getElementById('leadStatus');
const leadSubmit = document.getElementById('leadSubmit');

if (leadForm) {
  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    leadStatus.className = 'status';
    if (!leadForm.checkValidity()) {
      leadForm.reportValidity();
      return;
    }
    const origLabel = leadSubmit.textContent;
    leadSubmit.disabled = true;
    leadSubmit.textContent = 'Wysyłanie...';
    try {
      const fd = new FormData(leadForm);
      const res = await fetch(leadForm.action, {
        method: 'POST',
        body: fd,
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        leadStatus.textContent = 'Dziękujemy! Skontaktujemy się z Państwem najszybciej, jak to możliwe.';
        leadStatus.className = 'status success';
        leadForm.reset();
      } else {
        throw new Error('HTTP ' + res.status);
      }
    } catch (err) {
      console.error(err);
      leadStatus.textContent = 'Nie udało się wysłać formularza. Spróbuj ponownie lub napisz na rodo@td-group.pl.';
      leadStatus.className = 'status error';
    } finally {
      leadSubmit.disabled = false;
      leadSubmit.textContent = origLabel;
    }
  });
}
