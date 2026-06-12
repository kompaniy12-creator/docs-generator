/* global PDFLib, fontkit */
const { PDFDocument, rgb } = PDFLib;

const MAX_PEOPLE = 6;

// ---------------- Polish number-to-words (for currency amounts) ----------------
const _ones = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć',
  'dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście',
  'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const _tens = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt',
  'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const _hundreds = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset',
  'siedemset', 'osiemset', 'dziewięćset'];

function under1000(n) {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (h) parts.push(_hundreds[h]);
  if (rest < 20) {
    if (rest > 0) parts.push(_ones[rest]);
  } else {
    parts.push(_tens[Math.floor(rest / 10)]);
    const u = rest % 10;
    if (u) parts.push(_ones[u]);
  }
  return parts.join(' ');
}
function plPlural(n, one, few, many) {
  if (n === 1) return one;
  const last = n % 10;
  const lastTwo = n % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}
function numberToWordsPL(n) {
  if (n === 0) return 'zero';
  const mil = Math.floor(n / 1000000);
  const thou = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;
  const parts = [];
  if (mil) {
    parts.push(under1000(mil));
    parts.push(plPlural(mil, 'milion', 'miliony', 'milionów'));
  }
  if (thou) {
    if (thou === 1) parts.push('tysiąc');
    else {
      parts.push(under1000(thou));
      parts.push(plPlural(thou, 'tysiąc', 'tysiące', 'tysięcy'));
    }
  }
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}
function parseAmount(input) {
  const cleaned = String(input).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  if (isNaN(n) || n < 0) return null;
  const zl = Math.floor(n);
  const gr = Math.round((n - zl) * 100);
  return { zl, gr };
}
function formatAmountZL({ zl, gr }) {
  const zlStr = zl.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${zlStr},${gr.toString().padStart(2, '0')} zł`;
}
function amountInWords({ zl, gr }) {
  return `${numberToWordsPL(zl)} złotych ${gr.toString().padStart(2, '0')}/100`;
}

// ---------------- Polish date formatter ----------------
const _monthsPL = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
function isoToPLLong(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(s => parseInt(s, 10));
  return `${d} ${_monthsPL[m - 1]} ${y}`;
}
function isoToPLDots(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// ---------------- Dynamic person groups ----------------
function makeWspolnikGroup(idx) {
  const w = document.createElement('div');
  w.className = 'subgroup';
  w.innerHTML = `
    ${idx > 1 ? '<button type="button" class="remove-btn" aria-label="Usuń">×</button>' : ''}
    <h3>Wspólnik ${idx}</h3>
    <div class="row three">
      <div class="field">
        <label>Imię</label>
        <input type="text" name="w_imie_${idx}" ${idx === 1 ? 'required' : ''} />
      </div>
      <div class="field">
        <label>Nazwisko</label>
        <input type="text" name="w_nazwisko_${idx}" ${idx === 1 ? 'required' : ''} />
      </div>
      <div class="field">
        <label>Liczba udziałów</label>
        <input type="number" name="w_udzialy_${idx}" min="1" ${idx === 1 ? 'required' : ''} />
      </div>
    </div>
  `;
  return w;
}

function makeZarzadGroup(idx) {
  const w = document.createElement('div');
  w.className = 'subgroup';
  w.innerHTML = `
    ${idx > 1 ? '<button type="button" class="remove-btn" aria-label="Usuń">×</button>' : ''}
    <h3>Członek zarządu ${idx}</h3>
    <div class="row three">
      <div class="field">
        <label>Imię</label>
        <input type="text" name="z_imie_${idx}" ${idx === 1 ? 'required' : ''} />
      </div>
      <div class="field">
        <label>Nazwisko</label>
        <input type="text" name="z_nazwisko_${idx}" ${idx === 1 ? 'required' : ''} />
      </div>
      <div class="field">
        <label>Funkcja</label>
        <input type="text" name="z_funkcja_${idx}" ${idx === 1 ? 'required' : ''} placeholder="Prezes Zarządu" value="${idx === 1 ? 'Prezes Zarządu' : 'Członek Zarządu'}" />
      </div>
    </div>
    <div class="check-row">
      <input type="checkbox" id="z_wynagr_${idx}" name="z_wynagr_${idx}" class="wynagr-toggle" />
      <label for="z_wynagr_${idx}">Włącz wynagrodzenie w uchwale</label>
    </div>
    <div class="salary-fields" data-for="${idx}">
      <div class="row">
        <div class="field">
          <label>Kwota brutto (zł / miesiąc)</label>
          <input type="text" name="z_kwota_${idx}" inputmode="decimal" placeholder="np. 5000 lub 5000,50" />
        </div>
        <div class="field">
          <label>Ze skutkiem od dnia</label>
          <input type="date" name="z_skutek_${idx}" />
        </div>
      </div>
    </div>
  `;
  return w;
}

function setupDynamicList(containerId, addBtnId, factory, prefix) {
  const c = document.getElementById(containerId);
  const btn = document.getElementById(addBtnId);
  const renumber = () => {
    const groups = c.querySelectorAll('.subgroup');
    groups.forEach((g, i) => {
      const newIdx = i + 1;
      g.querySelector('h3').textContent =
        (prefix === 'w' ? 'Wspólnik ' : 'Członek zarządu ') + newIdx;
      g.querySelectorAll('input,textarea,select,label[for],.salary-fields').forEach(el => {
        if (el.name) el.name = el.name.replace(/_\d+$/, '_' + newIdx);
        if (el.id) el.id = el.id.replace(/_\d+$/, '_' + newIdx);
        if (el.htmlFor) el.htmlFor = el.htmlFor.replace(/_\d+$/, '_' + newIdx);
        if (el.dataset && el.dataset.for) el.dataset.for = String(newIdx);
      });
    });
    btn.style.display = groups.length >= MAX_PEOPLE ? 'none' : '';
  };
  const add = () => {
    const next = c.querySelectorAll('.subgroup').length + 1;
    if (next > MAX_PEOPLE) return;
    const g = factory(next);
    c.appendChild(g);
    renumber();
    g.querySelector('input').focus();
  };
  c.appendChild(factory(1));
  btn.addEventListener('click', add);
  c.addEventListener('click', (e) => {
    const rm = e.target.closest('.remove-btn');
    if (!rm) return;
    rm.closest('.subgroup').remove();
    renumber();
  });
  renumber();
}

setupDynamicList('wspolnicy', 'addWspolnik', makeWspolnikGroup, 'w');
setupDynamicList('zarzad', 'addZarzad', makeZarzadGroup, 'z');

// Toggle salary fields visibility
document.getElementById('zarzad').addEventListener('change', (e) => {
  if (!e.target.classList.contains('wynagr-toggle')) return;
  const sub = e.target.closest('.subgroup');
  const fields = sub.querySelector('.salary-fields');
  fields.classList.toggle('active', e.target.checked);
  // Make salary fields required only when active
  fields.querySelectorAll('input').forEach(i => {
    if (e.target.checked) i.setAttribute('required', '');
    else i.removeAttribute('required');
  });
});

// Default dates and uchwała number
const today = new Date();
document.getElementById('resDate').valueAsDate = today;
document.getElementById('resNumber').value = `1/${today.getFullYear()}`;

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
    const wn = data.wspolnicy.length;
    const zn = data.zarzad.length;
    setKrsStatus(`✅ Wczytano: ${data.firma || 'spółka'} · ${wn} wspólnik(ów) · ${zn} członek/członkowie zarządu. Sprawdź dane i wprowadź wynagrodzenia.`, 'success');
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
  if (d.firma) setVal('#company', d.firma);
  if (d.seat) setVal('#seat', d.seat);
  if (d.city) setVal('#city', d.city);
  if (d.krs) setVal('#krs', d.krs);
  if (d.nip) setVal('#nip', d.nip);
  if (d.regon) setVal('#regon', d.regon);

  // Rebuild wspólnicy
  if (d.wspolnicy && d.wspolnicy.length > 0) {
    rebuildList('wspolnicy', 'addWspolnik', makeWspolnikGroup, 'w',
      d.wspolnicy.slice(0, MAX_PEOPLE), (g, w, idx) => {
        g.querySelector(`[name="w_imie_${idx}"]`).value = w.imie;
        g.querySelector(`[name="w_nazwisko_${idx}"]`).value = w.nazwisko;
        if (w.udzialy) g.querySelector(`[name="w_udzialy_${idx}"]`).value = w.udzialy;
      });
  }

  // Rebuild zarząd
  if (d.zarzad && d.zarzad.length > 0) {
    rebuildList('zarzad', 'addZarzad', makeZarzadGroup, 'z',
      d.zarzad.slice(0, MAX_PEOPLE), (g, z, idx) => {
        g.querySelector(`[name="z_imie_${idx}"]`).value = z.imie;
        g.querySelector(`[name="z_nazwisko_${idx}"]`).value = z.nazwisko;
        if (z.funkcja) g.querySelector(`[name="z_funkcja_${idx}"]`).value = z.funkcja;
      });
  }
}

function rebuildList(containerId, addBtnId, factory, prefix, items, fillFn) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  items.forEach((item, i) => {
    const g = factory(i + 1);
    c.appendChild(g);
    if (fillFn) fillFn(g, item, i + 1);
  });
  document.getElementById(addBtnId).style.display =
    items.length >= MAX_PEOPLE ? 'none' : '';
}

// Auto-uppercase company name on the fly
document.getElementById('company').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

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

  const wspolnicy = [];
  for (let i = 1; i <= MAX_PEOPLE; i++) {
    const imie = get(`w_imie_${i}`);
    const nazwisko = get(`w_nazwisko_${i}`);
    const udzialy = parseInt(get(`w_udzialy_${i}`), 10);
    if (imie || nazwisko) {
      wspolnicy.push({
        imie: imie.toUpperCase(),
        nazwisko: nazwisko.toUpperCase(),
        udzialy: isNaN(udzialy) ? 0 : udzialy,
      });
    }
  }

  const zarzad = [];
  for (let i = 1; i <= MAX_PEOPLE; i++) {
    const imie = get(`z_imie_${i}`);
    const nazwisko = get(`z_nazwisko_${i}`);
    const funkcja = get(`z_funkcja_${i}`);
    const wynagr = !!fd.get(`z_wynagr_${i}`);
    if (!imie && !nazwisko) continue;
    const entry = {
      imie: imie.toUpperCase(),
      nazwisko: nazwisko.toUpperCase(),
      funkcja: funkcja,
      hasWynagr: wynagr,
    };
    if (wynagr) {
      const parsed = parseAmount(get(`z_kwota_${i}`));
      entry.kwota = parsed;
      entry.skutek = get(`z_skutek_${i}`);
    }
    zarzad.push(entry);
  }

  return {
    company: get('company').toUpperCase(),
    seat: get('seat'),
    city: get('city'),
    krs: get('krs'),
    nip: get('nip'),
    regon: get('regon'),
    resNumber: get('resNumber'),
    resDate: get('resDate'),
    wspolnicy,
    zarzad,
    payDay: parseInt(get('payDay'), 10),
    payForm: get('payForm'),
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
function drawCentered(page, text, y, size, font) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (page.getWidth() - w) / 2, y, font, size });
}
function drawCenteredWrapped(page, text, y, maxW, size, font, lh) {
  const lines = wrapLines(text, font, size, maxW);
  let yy = y;
  for (const l of lines) {
    const w = font.widthOfTextAtSize(l, size);
    page.drawText(l, { x: (page.getWidth() - w) / 2, y: yy, font, size });
    yy -= lh;
  }
  return yy;
}

// ---------------- PDF generator ----------------
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

async function generateUchwala(data) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Metadane — dokument finalny, gotowy do podpisu (bez pól edytowalnych)
  const now = new Date();
  doc.setTitle('Uchwala o wynagrodzeniu zarzadu');
  doc.setAuthor('TD Consulting Group');
  doc.setProducer('TD Consulting Group — Portal dokumentów');
  doc.setCreator('TD Consulting Group — Portal dokumentów');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  const font = await doc.embedFont(fontRegular);
  const bold = await doc.embedFont(fontBold);

  const page = doc.addPage([595.28, 841.89]); // A4
  const W = page.getWidth();
  const margin = 60;
  const innerW = W - margin * 2;
  const sz = 10;
  const lh = 14;

  // ----- TOP: place + date (right-aligned)
  let y = page.getHeight() - 50;
  const placeDate = `${data.city}, dnia ${isoToPLDots(data.resDate)} r.`;
  const pdW = font.widthOfTextAtSize(placeDate, sz);
  page.drawText(placeDate, { x: W - margin - pdW, y, font, size: sz });
  y -= 11;
  const subLabel = '(miejscowość i data)';
  const slW = font.widthOfTextAtSize(subLabel, 8);
  page.drawText(subLabel, { x: W - margin - slW + (pdW - slW) / 2, y, font, size: 8, color: rgb(0.5, 0.5, 0.5) });
  y -= 36;

  // ----- TITLE (centered, bold)
  drawCentered(page, `UCHWAŁA NR ${data.resNumber}`, y, 13, bold); y -= 18;
  drawCentered(page, 'NADZWYCZAJNEGO ZGROMADZENIA WSPÓLNIKÓW', y, 12, bold); y -= 18;
  y = drawCenteredWrapped(page, `SPÓŁKI ${data.company}`, y, innerW, 12, bold, 16);
  y -= 2;
  drawCentered(page, `Z SIEDZIBĄ W ${data.seat.toUpperCase()}`, y, 12, bold); y -= 20;
  drawCentered(page, 'w sprawie', y, sz, font); y -= 14;
  const wynagrCount = data.zarzad.filter(z => z.hasWynagr).length;
  const titleSubject = wynagrCount > 1
    ? 'USTALENIA WYNAGRODZENIA DLA CZŁONKÓW ZARZĄDU SPÓŁKI'
    : 'USTALENIA WYNAGRODZENIA DLA CZŁONKA ZARZĄDU SPÓŁKI';
  drawCentered(page, titleSubject, y, 11, bold); y -= 26;

  // ----- § 1
  const par1 = `§ 1. W dniu ${isoToPLLong(data.resDate)} r. w siedzibie Spółki w ${data.seat} odbyło się Nadzwyczajne Zgromadzenie Wspólników spółki ${data.company} z siedzibą w ${data.seat}, wpisanej do KRS pod numerem ${data.krs}, NIP ${data.nip}, REGON ${data.regon}.`;
  y = drawWrapped(page, par1, margin, y, innerW, sz, font, lh);
  y -= 8;

  // ----- § 2 — list of wspólnicy with udziały
  page.drawText('§ 2. ', { x: margin, y, font: bold, size: sz });
  const headerText = 'Na posiedzeniu obecni byli następujący wspólnicy Spółki, posiadający łącznie 100% kapitału zakładowego:';
  y = drawWrapped(page, headerText, margin + 18, y, innerW - 18, sz, font, lh);
  y -= 2;
  data.wspolnicy.forEach((w, i) => {
    const letter = LETTERS[i] || '?';
    const isLast = i === data.wspolnicy.length - 1;
    const sep = isLast ? '.' : ',';
    const line = `${letter}) ${w.imie} ${w.nazwisko} – ${w.udzialy} ${plPlural(w.udzialy, 'udział', 'udziały', 'udziałów')}${sep}`;
    y = drawWrapped(page, line, margin + 18, y, innerW - 18, sz, font, lh);
  });
  // Replace last comma with period
  // (we won't render again — keep as-is; minor cosmetic)
  y -= 8;

  // ----- § 3 — uchwały
  page.drawText('§ 3. ', { x: margin, y, font: bold, size: sz });
  y = drawWrapped(page, 'Zgromadzenie Wspólników, działając na podstawie przepisów Kodeksu spółek handlowych, uchwala, co następuje:', margin + 18, y, innerW - 18, sz, font, lh);
  y -= 2;

  let letterIdx = 0;
  // each member with wynagrodzenie gets a sub-item
  data.zarzad.filter(z => z.hasWynagr).forEach(z => {
    const letter = LETTERS[letterIdx++] || '?';
    const honorific = guessHonorific(z.imie);
    const text = `${letter}) Zgromadzenie Wspólników ustala wynagrodzenie dla ${honorific} ${z.imie} ${z.nazwisko} – ${z.funkcja} Spółki – na kwotę ${formatAmountZL(z.kwota)} (słownie: ${amountInWords(z.kwota)}) miesięcznie brutto, ze skutkiem od dnia ${isoToPLLong(z.skutek)} r.`;
    y = drawWrapped(page, text, margin + 18, y, innerW - 18, sz, font, lh);
    y -= 2;
  });
  // General clauses (świadczenia + płatność) — one for all
  const lt2 = LETTERS[letterIdx++] || '?';
  y = drawWrapped(page, `${lt2}) Wynagrodzenie obejmuje wszystkie świadczenia, w tym wynagrodzenie zasadnicze oraz ewentualne świadczenia dodatkowe, jak premie czy nagrody, na podstawie odrębnej umowy z członkiem zarządu.`, margin + 18, y, innerW - 18, sz, font, lh);
  y -= 2;
  const lt3 = LETTERS[letterIdx++] || '?';
  y = drawWrapped(page, `${lt3}) Wynagrodzenie płatne jest do ${data.payDay} dnia każdego miesiąca w formie ${data.payForm}.`, margin + 18, y, innerW - 18, sz, font, lh);
  y -= 8;

  // ----- § 4 — wejście w życie (use earliest skutek date among enabled members; or resDate)
  const earliest = data.zarzad.filter(z => z.hasWynagr).map(z => z.skutek).sort()[0] || data.resDate;
  const par4 = `§ 4. Uchwała wchodzi w życie z dniem jej podjęcia, ze skutkiem finansowym od dnia ${isoToPLLong(earliest)} r.`;
  y = drawWrapped(page, par4, margin, y, innerW, sz, font, lh);
  y -= 8;

  // ----- § 5 — głosowanie
  page.drawText('§ 5. ', { x: margin, y, font: bold, size: sz });
  y = drawWrapped(page, 'Uchwała została podjęta jednogłośnie, przy 100% głosów za jej przyjęciem:', margin + 18, y, innerW - 18, sz, font, lh);
  ['a) głosów za: 100,', 'b) głosów przeciw: 0,', 'c) głosów wstrzymujących się: 0.'].forEach(t => {
    y = drawWrapped(page, t, margin + 18, y, innerW - 18, sz, font, lh);
  });
  y -= 20;

  // ----- Signatures
  page.drawText('Podpisy wspólników:', { x: margin, y, font: bold, size: sz });
  y -= 50;

  // Sign blocks — up to 2 per row
  const blockW = innerW / 2;
  let row = 0;
  for (let i = 0; i < data.wspolnicy.length; i++) {
    const col = i % 2;
    if (col === 0 && i > 0) { row += 1; y -= 60; }
    const xCenter = margin + blockW * col + blockW / 2;
    const lineLen = 200;
    page.drawLine({
      start: { x: xCenter - lineLen / 2, y },
      end: { x: xCenter + lineLen / 2, y },
      thickness: 0.5, color: rgb(0, 0, 0),
    });
    const w = data.wspolnicy[i];
    const name = `${w.imie} ${w.nazwisko}`;
    const nW = font.widthOfTextAtSize(name, sz);
    page.drawText(name, { x: xCenter - nW / 2, y: y - 14, font, size: sz });
    // Always "Wspólnik" — the salary resolution is always signed by shareholders, not the board
    const role = 'Wspólnik';
    const rW = font.widthOfTextAtSize(role, sz);
    page.drawText(role, { x: xCenter - rW / 2, y: y - 28, font, size: sz });
  }

  return await doc.save();
}

function guessHonorific(imie) {
  // Polish: feminine names typically end with 'a'
  if (!imie) return 'Pana';
  const lastCh = imie[imie.length - 1].toLowerCase();
  return lastCh === 'a' ? 'Pani' : 'Pana';
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

  // Custom check: at least one zarząd member with wynagrodzenie
  const anyChecked = form.querySelectorAll('.wynagr-toggle:checked').length > 0;
  if (!anyChecked) {
    showStatus('Zaznacz przynajmniej jednego członka zarządu, dla którego ustalane jest wynagrodzenie.', 'error');
    return;
  }
  // Validate amounts
  const data = collectData();
  for (const z of data.zarzad.filter(z => z.hasWynagr)) {
    if (!z.kwota || (z.kwota.zl === 0 && z.kwota.gr === 0)) {
      showStatus(`Wprowadź prawidłową kwotę wynagrodzenia dla ${z.imie} ${z.nazwisko}.`, 'error');
      return;
    }
    if (!z.skutek) {
      showStatus(`Wybierz datę skutku dla ${z.imie} ${z.nazwisko}.`, 'error');
      return;
    }
  }

  submitBtn.disabled = true;
  const orig = submitBtn.textContent;
  submitBtn.textContent = 'Generowanie...';

  try {
    await loadFonts();
    const bytes = await generateUchwala(data);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safe = data.company.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    a.download = `Uchwala_wynagrodzenie_${safe || 'spolka'}_${data.resDate}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showStatus('Uchwała została wygenerowana i pobrana.', 'success');
  } catch (err) {
    console.error(err);
    showStatus('Błąd: ' + (err.message || err), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = orig;
  }
});
