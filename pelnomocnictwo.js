/* global PDFLib, fontkit */
const { PDFDocument, rgb } = PDFLib;

const MAX_PEOPLE = 6;

// ---------------- Polish date formatters ----------------
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

// ---------------- Dynamic signatory groups ----------------
function makePodpisGroup(idx) {
  const w = document.createElement('div');
  w.className = 'subgroup';
  w.innerHTML = `
    ${idx > 1 ? '<button type="button" class="remove-btn" aria-label="Usuń">×</button>' : ''}
    <h3>Osoba podpisująca ${idx}</h3>
    <div class="row three">
      <div class="field">
        <label>Imię</label>
        <input type="text" name="s_imie_${idx}" ${idx === 1 ? 'required' : ''} />
      </div>
      <div class="field">
        <label>Nazwisko</label>
        <input type="text" name="s_nazwisko_${idx}" ${idx === 1 ? 'required' : ''} />
      </div>
      <div class="field">
        <label>Funkcja</label>
        <input type="text" name="s_funkcja_${idx}" ${idx === 1 ? 'required' : ''} placeholder="Wspólnik" value="Wspólnik" />
      </div>
    </div>
  `;
  return w;
}

function setupDynamicList(containerId, addBtnId, factory) {
  const c = document.getElementById(containerId);
  const btn = document.getElementById(addBtnId);
  const renumber = () => {
    const groups = c.querySelectorAll('.subgroup');
    groups.forEach((g, i) => {
      const newIdx = i + 1;
      g.querySelector('h3').textContent = 'Osoba podpisująca ' + newIdx;
      g.querySelectorAll('input,textarea,select,label[for]').forEach(el => {
        if (el.name) el.name = el.name.replace(/_\d+$/, '_' + newIdx);
        if (el.id) el.id = el.id.replace(/_\d+$/, '_' + newIdx);
        if (el.htmlFor) el.htmlFor = el.htmlFor.replace(/_\d+$/, '_' + newIdx);
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

setupDynamicList('podpisujacy', 'addPodpis', makePodpisGroup);

// Default date and uchwała number
const today = new Date();
document.getElementById('resDate').valueAsDate = today;
document.getElementById('resNumber').value = `2/${today.getFullYear()}`;

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
    const wn = (data.wspolnicy || []).length;
    setKrsStatus(`✅ Wczytano: ${data.firma || 'spółka'} · ${wn} wspólnik(ów) do podpisu. Sprawdź dane i wprowadź pełnomocnika.`, 'success');
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

  // Rebuild signatories from wspólnicy — an uchwała of the Zgromadzenie
  // Wspólników is signed by the shareholders, not the management board.
  if (d.wspolnicy && d.wspolnicy.length > 0) {
    rebuildList('podpisujacy', 'addPodpis', makePodpisGroup,
      d.wspolnicy.slice(0, MAX_PEOPLE), (g, w, idx) => {
        g.querySelector(`[name="s_imie_${idx}"]`).value = w.imie;
        g.querySelector(`[name="s_nazwisko_${idx}"]`).value = w.nazwisko;
        g.querySelector(`[name="s_funkcja_${idx}"]`).value = 'Wspólnik';
      });
  }
}

function rebuildList(containerId, addBtnId, factory, items, fillFn) {
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

  const podpisujacy = [];
  for (let i = 1; i <= MAX_PEOPLE; i++) {
    const imie = get(`s_imie_${i}`);
    const nazwisko = get(`s_nazwisko_${i}`);
    const funkcja = get(`s_funkcja_${i}`);
    if (!imie && !nazwisko) continue;
    podpisujacy.push({
      imie: imie.toUpperCase(),
      nazwisko: nazwisko.toUpperCase(),
      funkcja: funkcja,
    });
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
    pImie: get('pImie').toUpperCase(),
    pNazwisko: get('pNazwisko').toUpperCase(),
    pPesel: get('pPesel'),
    pAdres: get('pAdres'),
    podpisujacy,
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
async function generateUchwala(data) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Metadane — dokument finalny, gotowy do podpisu (bez pól edytowalnych)
  const now = new Date();
  doc.setTitle('Uchwala o ustanowieniu pelnomocnika');
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
  const sz = 11;
  const lh = 16;

  // ----- TOP: place + date (right-aligned)
  let y = page.getHeight() - 60;
  const placeDate = `${data.city}, dnia ${isoToPLDots(data.resDate)} r.`;
  const pdW = font.widthOfTextAtSize(placeDate, sz);
  page.drawText(placeDate, { x: W - margin - pdW, y, font, size: sz });
  y -= 12;
  const subLabel = '(miejscowość i data)';
  const slW = font.widthOfTextAtSize(subLabel, 8);
  page.drawText(subLabel, { x: W - margin - slW + (pdW - slW) / 2, y, font, size: 8, color: rgb(0.5, 0.5, 0.5) });
  y -= 44;

  // ----- TITLE (centered, bold)
  drawCentered(page, `Uchwała nr ${data.resNumber} z dnia ${isoToPLDots(data.resDate)} r.`, y, 13, bold);
  y -= 34;

  // ----- § 1
  drawCentered(page, '§ 1', y, sz, bold);
  y -= 18;
  const par1 = `Zgromadzenie wspólników spółki ${data.company} z siedzibą w ${data.seat}, KRS ${data.krs}, NIP ${data.nip}, REGON ${data.regon}, zwanej dalej „Spółką”, działając na podstawie art. 210 § 1¹ Kodeksu spółek handlowych, postanawia ustanowić:`;
  y = drawWrapped(page, par1, margin, y, innerW, sz, font, lh);
  y -= 4;
  const pelnomLine = `1)  ${data.pImie} ${data.pNazwisko}, PESEL: ${data.pPesel}, adres korespondencyjny: ${data.pAdres}`;
  y = drawWrapped(page, pelnomLine, margin, y, innerW, sz, font, lh);
  y -= 4;
  y = drawWrapped(page, 'pełnomocnikiem Spółki uprawnionym do zawierania umów w imieniu Spółki.', margin, y, innerW, sz, font, lh);
  y -= 16;

  // ----- § 2
  drawCentered(page, '§ 2', y, sz, bold);
  y -= 18;
  y = drawWrapped(page, 'Pełnomocnik jest uprawniony do samodzielnego kształtowania treści umów, kierując się interesem Spółki.', margin, y, innerW, sz, font, lh);
  y -= 16;

  // ----- § 3
  drawCentered(page, '§ 3', y, sz, bold);
  y -= 18;
  y = drawWrapped(page, 'Uchwała wchodzi w życie z dniem podjęcia.', margin, y, innerW, sz, font, lh);
  y -= 22;

  // ----- Voting note
  y = drawWrapped(page, 'Uchwała została podjęta jednogłośnie – za uchwałą oddano 100 głosów za, 0 głosów przeciw.', margin, y, innerW, sz, font, lh);
  y -= 36;

  // ----- Signatures
  page.drawText('Podpisy wspólników:', { x: margin, y, font: bold, size: sz });
  y -= 56;

  const blockW = innerW / 2;
  for (let i = 0; i < data.podpisujacy.length; i++) {
    const col = i % 2;
    if (col === 0 && i > 0) { y -= 64; }
    const xCenter = margin + blockW * col + blockW / 2;
    const lineLen = 200;
    page.drawLine({
      start: { x: xCenter - lineLen / 2, y },
      end: { x: xCenter + lineLen / 2, y },
      thickness: 0.5, color: rgb(0, 0, 0),
    });
    const s = data.podpisujacy[i];
    const name = `${s.imie} ${s.nazwisko}`;
    const nW = font.widthOfTextAtSize(name, sz);
    page.drawText(name, { x: xCenter - nW / 2, y: y - 14, font, size: sz });
    if (s.funkcja) {
      const rW = font.widthOfTextAtSize(s.funkcja, sz);
      page.drawText(s.funkcja, { x: xCenter - rW / 2, y: y - 28, font, size: sz });
    }
  }

  return await doc.save();
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
    const bytes = await generateUchwala(data);
    const safe = toAsciiLetters(data.company.split(' ')[0]).toLowerCase();
    const res = await saveAndDownload({
      docType: 'pelnomocnictwo', title: 'Uchwała o ustanowieniu pełnomocnika',
      subject: data.company, filename: `Uchwala_pelnomocnictwo_${safe || 'spolka'}_${data.resDate}.pdf`,
      bytes, payload: data,
    });
    showStatus(res.saved ? 'Uchwała została wygenerowana, pobrana i zapisana w historii.' : 'Uchwała została wygenerowana i pobrana.', 'success');
  } catch (err) {
    console.error(err);
    showStatus('Błąd: ' + (err.message || err), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = orig;
  }
});
