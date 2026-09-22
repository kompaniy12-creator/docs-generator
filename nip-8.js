/* global PDFLib, fontkit */
/* NIP-8 — zgłoszenie identyfikacyjne / aktualizacyjne w zakresie danych uzupełniających.
   Fills the official NIP-8(4) blank (nip-8-template.pdf) by drawing text onto it.
   Company data comes from the clients database (by NIP) or from a KRS extract. */
const { PDFDocument, rgb } = PDFLib;

const TEMPLATE_URL = 'nip-8-template.pdf';
const PAGE_H = 841.68; // A4 height in points (template media box)

const SUPABASE_URL = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co';
// anon (publishable) key — public by design; lets the call pass the functions gateway.
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnh3a3hwenFxanRtZ3F3b3p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQxODksImV4cCI6MjA4ODgzMDE4OX0.sUFX90FKNuxM7u8ftOlDKdf1iD4gsfq2T3S0FDzRdC0';
const KLIENT_FN = SUPABASE_URL + '/functions/v1/klient-by-nip';
const GUS_FN = SUPABASE_URL + '/functions/v1/gus-company';

// Geometry of the official NIP-8(4) blank, measured from nip-8-template.pdf
// (pdf-lib user space: origin bottom-left; y = text baseline).
const T = { // labelled boxes: [page, x, baselineY, maxWidth]
  5: [0, 55.9, 505.7, 508.6],
  6: [0, 55.9, 445.7, 508.6],
  7: [0, 55.9, 421.7, 508.6],
  8: [0, 56.1, 397.7, 235.2],
  9: [0, 300.6, 397.7, 263.9],
  14: [0, 247.1, 284.6, 217.5],
  16: [0, 55.9, 259.8, 160.6],
  18: [0, 315.1, 259.8, 149.5],
  34: [1, 55.4, 675.2, 175.8],
  35: [1, 240.1, 675.2, 144.8],
  36: [1, 393.9, 675.2, 170.6],
  37: [1, 55.4, 652.2, 175.8],
  38: [1, 240.1, 652.2, 206],
  39: [1, 455.1, 652.2, 48.6],
  40: [1, 512.7, 652.2, 51.8],
  41: [1, 55.4, 629.2, 175.8],
  42: [1, 240.1, 629.2, 324.4],
  43: [1, 55.4, 606.1, 509.1],
  46: [1, 240.1, 506.9, 324.4],
  47: [1, 55.4, 465, 175.8],
  48: [1, 240.1, 465, 144.8],
  49: [1, 393.9, 465, 170.6],
  50: [1, 55.4, 441, 175.8],
  51: [1, 240.1, 441, 206],
  52: [1, 455.1, 441, 48.6],
  53: [1, 512.7, 441, 51.8],
  54: [1, 55.4, 417, 175.8],
  55: [1, 240.1, 417, 324.4],
  56: [1, 55.4, 314.4, 111.9],
  57: [1, 176.2, 314.4, 189.3],
  60: [1, 55.4, 247.9, 111.9],
  61: [1, 176.2, 247.9, 189.3],
  94: [3, 73, 503.6, 113.5],
  95: [3, 195.5, 503.6, 163.9],
  96: [3, 368.3, 503.4, 196.2],
  98: [3, 73, 455.6, 113.5],
  99: [3, 195.5, 455.6, 163.9],
  100: [3, 368.3, 455.4, 196.2],
};
const C = { // character combs: [page, baselineY, [[x0, x1, cells], ...]]
  1: [0, 781, [[74.8, 240.5, 10]]],
  45: [1, 502.6, [[59.9, 225.6, 10]]],
  58: [1, 310.9, [[442.7, 494.8, 3]]],
  59: [1, 287, [[142.8, 172.1, 2], [180.9, 229.3, 4], [238.1, 286.6, 4], [295.4, 343.8, 4], [352.6, 401.1, 4], [409.9, 458.3, 4], [467, 518.7, 4]]],
  62: [1, 244.4, [[442.7, 494.8, 3]]],
  63: [1, 221.6, [[99.5, 128.7, 2], [137.4, 186, 4], [194.7, 243.3, 4], [251.9, 300.5, 4], [309.2, 357.8, 4], [366.5, 415, 4], [423.7, 475.4, 4]]],
  93: [3, 524.1, [[238, 274, 2], [275, 310.9, 2], [312, 380.6, 4]]],
  97: [3, 476, [[124.7, 306.6, 11]]],
  101: [3, 427.9, [[124.7, 306.6, 11]]],
};
const K = { // checkbox squares: [page, centreX, centreY]
  p4_identyfikacyjne: [0, 69.8, 533.6],
  p4_aktualizacyjne: [0, 315.7, 533.6],
  p13_tak: [0, 110.9, 289.6],
  p13_nie: [0, 157.6, 289.6],
  p32_tak: [1, 265.2, 728.1],
  p32_nie: [1, 329.3, 728.1],
  p33_prowadzenie: [1, 112.9, 704.1],
  p33_zakonczenie: [1, 334.5, 704.1],
  p44_biuro: [1, 163, 562.7],
  p44_wlasny: [1, 379, 562.7],
  p64_likwidacja: [1, 522.8, 226.9],
  p92_pelnomocnictwo: [3, 296, 609.1],
};

// ---------------- Drawing helpers ----------------
function widthOf(text, font, size) { return font.widthOfTextAtSize(text, size); }

// Single-line text in a labelled box; shrinks the size to fit the box width.
function drawText(page, text, box, font, size) {
  if (!text) return;
  let s = size || 9;
  const maxWidth = box[3] - 2;
  while (s > 5 && widthOf(text, font, s) > maxWidth) s -= 0.25;
  page.drawText(text, { x: box[1], y: box[2], size: s, font, color: rgb(0, 0, 0) });
}

// One character per printed cell of a comb ("└────┴────┘" runs on the blank).
function combCentres(comb) {
  const out = [];
  comb[2].forEach(function (g) {
    const w = (g[1] - g[0]) / g[2];
    for (let i = 0; i < g[2]; i++) out.push(g[0] + w * (i + 0.5));
  });
  return out;
}
function drawComb(page, text, comb, font, size) {
  if (!text) return;
  const centres = combCentres(comb);
  const s = size || 9;
  for (let i = 0; i < text.length && i < centres.length; i++) {
    const ch = text[i];
    page.drawText(ch, {
      x: centres[i] - widthOf(ch, font, s) / 2, y: comb[1], size: s, font, color: rgb(0, 0, 0),
    });
  }
}

// "X" centred in a ❑ square of the blank.
function drawCheck(page, mark, bold) {
  const s = 9.5;
  const w = widthOf('X', bold, s);
  page.drawText('X', { x: mark[1] - w / 2, y: mark[2] - 4.5, size: s, font: bold, color: rgb(0, 0, 0) });
}

// ---------------- Value formatting ----------------
// The blank must be filled in capital letters ("WYPEŁNIAĆ ... DUŻYMI, DRUKOWANYMI LITERAMI").
function up(s) { return (s || '').toString().trim().toUpperCase(); }
function digits(s) { return (s || '').toString().replace(/[^0-9]/g, ''); }
// IBAN: strip spaces and the optional "PL" prefix, keep the 26 digits.
function ibanDigits(s) {
  return (s || '').toString().replace(/\s/g, '').replace(/^PL/i, '').replace(/[^0-9]/g, '');
}
function isoToCells(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  return p[2] + p[1] + p[0]; // ddmmrrrr, as printed on the blank
}

// ---------------- Page helpers ----------------
const $ = (id) => document.getElementById(id);
const val = (id) => (($(id) && $(id).value) || '').trim();
function setVal(id, v) {
  if (v == null || v === '') return;
  const el = $(id);
  if (!el) return;
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function radioVal(name) {
  const el = document.querySelector('input[name="' + name + '"]:checked');
  return el ? el.value : '';
}
function capitalizeWords(s) {
  return (s || '').toLowerCase().split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
// "TD CONSULTING GROUP SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" -> "... SP. Z O.O."
function shortName(full) {
  return up(full)
    .replace(/SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ/g, 'SP. Z O.O.')
    .replace(/SPÓŁKA AKCYJNA/g, 'S.A.')
    .replace(/SPÓŁKA KOMANDYTOWA/g, 'SP.K.')
    .replace(/SPÓŁKA JAWNA/g, 'SP.J.')
    .replace(/\s{2,}/g, ' ').trim();
}

// ---------------- Company lookup by NIP ----------------
const nipStatus = $('nipStatus');
function setNipStatus(msg, type) {
  nipStatus.textContent = msg;
  nipStatus.className = 'krs-status ' + (type || '');
}

$('nipBtn').addEventListener('click', async () => {
  const nip = digits(val('nip'));
  if (nip.length !== 10) { setNipStatus('Podaj NIP — 10 cyfr.', 'error'); return; }
  const btn = $('nipBtn');
  btn.disabled = true;
  setNipStatus('⏳ Szukam firmy...', 'loading');
  try {
    const headers = { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON };
    let out = await fetch(KLIENT_FN + '?nip=' + nip, { headers }).then(r => r.json());
    let source = 'bazy klientów';
    if (!out || !out.found) {
      // not our client (or not in the sheet) — fall back to the public GUS register
      out = await fetch(GUS_FN + '?nip=' + nip, { headers }).then(r => r.json());
      source = 'GUS';
      if (!out || out.error) throw new Error(out && out.error ? out.error : 'Nie znaleziono firmy.');
    }
    applyCompany(out);
    setNipStatus('✅ Wczytano z ' + source + ': ' + (out.nazwa || '') + '. Uzupełnij KRS i dane uzupełniające.', 'success');
  } catch (err) {
    setNipStatus('Nie udało się pobrać danych: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
  }
});

// Address as returned by the lookups: "ul. Garbary 71/9" + kod + miasto.
function applyCompany(o) {
  if (o.nazwa) {
    setVal('nazwaPelna', up(o.nazwa));
    if (!val('nazwaSkrocona')) setVal('nazwaSkrocona', shortName(o.nazwa));
  }
  if (o.regon) setVal('regon', o.regon);
  if (o.nip) setVal('nip', digits(o.nip));
  const street = (o.ulica || '').replace(/^ul\.\s*/i, '').trim();
  const m = street.match(/^(.*?)[\s,]+(\d+[A-Za-z]?)(?:\s*\/\s*(\S+))?$/);
  seatAddress = {
    ulica: m ? m[1].trim() : street,
    nrDomu: m ? m[2] : '',
    nrLokalu: m && m[3] ? m[3] : '',
    kod: o.kod || '',
    miejscowosc: o.miasto || '',
  };
  fillSeatAddress();
}

// ---------------- KRS extract ----------------
const krsFileInput = $('krsFile');
const krsStatus = $('krsStatus');
let zarzadList = [];      // [{imie, nazwisko, funkcja}]
let seatAddress = null;   // registered-office address, offered for B.4 / B.5.2

function setKrsStatus(msg, type) {
  krsStatus.textContent = msg;
  krsStatus.className = 'krs-status ' + (type || '');
}
$('krsUploadBtn').addEventListener('click', () => krsFileInput.click());

krsFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { setKrsStatus('Plik jest za duży (max 10 MB).', 'error'); return; }
  setKrsStatus('⏳ Analizuję wypis KRS...', 'loading');
  try {
    const d = await window.KRSParser.parseFile(file);
    applyKRSData(d);
    setKrsStatus('✅ Wczytano: ' + (d.firma || 'spółka') + ' · ' + zarzadList.length
      + ' członek/członkowie zarządu. Uzupełnij dane uzupełniające.', 'success');
  } catch (err) {
    console.error(err);
    setKrsStatus('Nie udało się sparsować pliku. Upewnij się, że to oficjalny „Odpis aktualny KRS” w formacie PDF z prs.ms.gov.pl.', 'error');
  } finally {
    krsFileInput.value = '';
  }
});

function applyKRSData(d) {
  if (d.firma) {
    setVal('nazwaPelna', up(d.firma));
    if (!val('nazwaSkrocona')) setVal('nazwaSkrocona', shortName(d.firma));
  }
  if (d.krs) setVal('krs', digits(d.krs));
  if (d.nip) setVal('nip', digits(d.nip));
  if (d.regon) setVal('regon', digits(d.regon));
  if (d.adres) {
    seatAddress = {
      ulica: d.adres.ulica || '',
      nrDomu: d.adres.nrDomu || '',
      nrLokalu: d.adres.nrLokalu || '',
      kod: d.adres.kodPocztowy || '',
      miejscowosc: d.adres.miejscowosc || '',
    };
    fillSeatAddress();
  }
  zarzadList = (d.zarzad || []).map(z => ({
    imie: capitalizeWords(z.imie || ''),
    nazwisko: capitalizeWords(z.nazwisko || ''),
    funkcja: capitalizeWords(z.funkcja || ''),
  }));
  populateSigners();
}

// The registered office is the default place of business — only fills empty fields.
function fillSeatAddress() {
  if (!seatAddress) return;
  if (!val('d_ulica') && !val('d_miejscowosc')) copySeatTo('d_');
}
function copySeatTo(prefix) {
  if (!seatAddress) return false;
  setVal(prefix + 'ulica', seatAddress.ulica);
  setVal(prefix + 'nrDomu', seatAddress.nrDomu);
  setVal(prefix + 'nrLokalu', seatAddress.nrLokalu);
  setVal(prefix + 'kod', seatAddress.kod);
  setVal(prefix + 'miejscowosc', seatAddress.miejscowosc);
  return true;
}

$('copySeatBtn').addEventListener('click', () => {
  if (!copySeatTo('d_')) {
    setKrsStatus('Najpierw wczytaj dane spółki (po NIP albo z odpisu KRS).', 'error');
  }
});
$('copyDzialBtn').addEventListener('click', () => {
  ['kraj', 'wojewodztwo', 'powiat', 'gmina', 'ulica', 'nrDomu', 'nrLokalu', 'kod', 'miejscowosc']
    .forEach(k => { const v = val('d_' + k); if (v) setVal('p_' + k, v); });
});

// Accounting-office block is only relevant for "w biurze rachunkowym".
function toggleBiuro() {
  $('biuroWrap').style.display = radioVal('dokumentacja') === '2' ? 'none' : '';
}
document.querySelectorAll('input[name="dokumentacja"]').forEach(r => r.addEventListener('change', toggleBiuro));
toggleBiuro();

// ---------------- Signatories ----------------
function populateSigners() {
  [['signer1', 's1_'], ['signer2', 's2_']].forEach(([selId, prefix], idx) => {
    const sel = $(selId);
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = 'manual';
    none.textContent = idx === 0 ? '— wpisz ręcznie —' : '— brak / wpisz ręcznie —';
    sel.appendChild(none);
    zarzadList.forEach((z, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = z.imie + ' ' + z.nazwisko + (z.funkcja ? ' — ' + z.funkcja : '');
      sel.appendChild(opt);
    });
    const auto = zarzadList[idx];
    if (auto) { sel.value = String(idx); applySigner(prefix, auto); }
    else sel.value = 'manual';
  });
}
function applySigner(prefix, z) {
  setVal(prefix + 'imie', z.imie);
  setVal(prefix + 'nazwisko', z.nazwisko);
  setVal(prefix + 'funkcja', z.funkcja);
}
[['signer1', 's1_'], ['signer2', 's2_']].forEach(([selId, prefix]) => {
  $(selId).addEventListener('change', (e) => {
    const z = zarzadList[parseInt(e.target.value, 10)];
    if (z) applySigner(prefix, z);
  });
});
populateSigners();

// Today's date by default.
$('data').value = new Date().toISOString().slice(0, 10);

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
function collectData() {
  return {
    cel: radioVal('cel'),
    us: up(val('us')),
    nip: digits(val('nip')),
    nazwaPelna: up(val('nazwaPelna')),
    nazwaSkrocona: up(val('nazwaSkrocona')),
    krs: digits(val('krs')),
    regon: digits(val('regon')),
    zgoda: radioVal('zgoda'),
    telefon: up(val('telefon')),
    faks: up(val('faks')),
    email: val('email'),
    doreczenia: radioVal('doreczenia'),
    powod: radioVal('powod'),
    dzialalnosc: {
      kraj: up(val('d_kraj')), wojewodztwo: up(val('d_wojewodztwo')), powiat: up(val('d_powiat')),
      gmina: up(val('d_gmina')), ulica: up(val('d_ulica')), nrDomu: up(val('d_nrDomu')),
      nrLokalu: up(val('d_nrLokalu')), kod: val('d_kod'), miejscowosc: up(val('d_miejscowosc')),
      opis: up(val('d_opis')),
    },
    dokumentacja: radioVal('dokumentacja'),
    biuro: { nip: digits(val('b_nip')), nazwa: up(val('b_nazwa')) },
    przechowywanie: {
      kraj: up(val('p_kraj')), wojewodztwo: up(val('p_wojewodztwo')), powiat: up(val('p_powiat')),
      gmina: up(val('p_gmina')), ulica: up(val('p_ulica')), nrDomu: up(val('p_nrDomu')),
      nrLokalu: up(val('p_nrLokalu')), kod: val('p_kod'), miejscowosc: up(val('p_miejscowosc')),
    },
    rachunek1: {
      iban: ibanDigits(val('r1_iban')), waluta: up(val('r1_waluta')),
      kraj: up(val('r1_kraj')), swift: up(val('r1_swift')),
    },
    rachunek2: {
      iban: ibanDigits(val('r2_iban')), waluta: up(val('r2_waluta')),
      kraj: up(val('r2_kraj')), swift: up(val('r2_swift')),
      likwidacja: $('r2_likwidacja').checked,
    },
    data: val('data'),
    osoba1: {
      imie: up(val('s1_imie')), nazwisko: up(val('s1_nazwisko')),
      funkcja: up(val('s1_funkcja')), pesel: digits(val('s1_pesel')),
    },
    osoba2: {
      imie: up(val('s2_imie')), nazwisko: up(val('s2_nazwisko')),
      funkcja: up(val('s2_funkcja')), pesel: digits(val('s2_pesel')),
    },
    pelnomocnictwo: $('zalPelnomocnictwo').checked,
  };
}

// ---------------- PDF generation ----------------
async function generate(d) {
  const tplBytes = await fetch(TEMPLATE_URL).then(r => {
    if (!r.ok) throw new Error('Nie udało się wczytać szablonu PDF (' + r.status + ').');
    return r.arrayBuffer();
  });
  const doc = await PDFDocument.load(tplBytes);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontRegular);
  const bold = await doc.embedFont(fontBold);
  const pages = doc.getPages();
  const text = (pos, value, size) => drawText(pages[T[pos][0]], value, T[pos], font, size);
  const comb = (pos, value, size) => drawComb(pages[C[pos][0]], value, C[pos], font, size);
  const check = (name) => drawCheck(pages[K[name][0]], K[name], bold);

  // ---- A. Cel i miejsce złożenia ----
  check(d.cel === '1' ? 'p4_identyfikacyjne' : 'p4_aktualizacyjne');
  text(5, d.us, 8.5);

  // ---- B.1. Dane identyfikacyjne ----
  comb(1, d.nip);
  text(6, d.nazwaPelna);
  text(7, d.nazwaSkrocona);
  text(8, d.krs);
  text(9, d.regon);

  // ---- B.3. Dane kontaktowe ----
  check(d.zgoda === '2' ? 'p13_nie' : 'p13_tak');
  text(14, d.telefon);
  text(16, d.faks);
  text(18, d.email, 8.5);

  // ---- B.4. Adres miejsca prowadzenia działalności ----
  check(d.doreczenia === '1' ? 'p32_tak' : 'p32_nie');
  check(d.powod === '2' ? 'p33_zakonczenie' : 'p33_prowadzenie');
  const a = d.dzialalnosc;
  text(34, a.kraj); text(35, a.wojewodztwo); text(36, a.powiat);
  text(37, a.gmina); text(38, a.ulica); text(39, a.nrDomu); text(40, a.nrLokalu);
  text(41, a.kod); text(42, a.miejscowosc); text(43, a.opis, 8.5);

  // ---- B.5. Dokumentacja rachunkowa ----
  if (d.dokumentacja === '2') {
    check('p44_wlasny');
  } else {
    check('p44_biuro');
    comb(45, d.biuro.nip);
    text(46, d.biuro.nazwa);
  }
  const p = d.przechowywanie;
  text(47, p.kraj); text(48, p.wojewodztwo); text(49, p.powiat);
  text(50, p.gmina); text(51, p.ulica); text(52, p.nrDomu); text(53, p.nrLokalu);
  text(54, p.kod); text(55, p.miejscowosc);

  // ---- C.1. Rachunki bankowe ----
  text(56, d.rachunek1.kraj); text(57, d.rachunek1.swift);
  comb(58, d.rachunek1.waluta); comb(59, d.rachunek1.iban, 8.5);
  text(60, d.rachunek2.kraj); text(61, d.rachunek2.swift);
  comb(62, d.rachunek2.waluta); comb(63, d.rachunek2.iban, 8.5);
  if (d.rachunek2.likwidacja) check('p64_likwidacja');

  // ---- E / F. Załączniki, data i podpisy ----
  if (d.pelnomocnictwo) check('p92_pelnomocnictwo');
  comb(93, isoToCells(d.data));
  text(94, d.osoba1.imie); text(95, d.osoba1.nazwisko);
  text(96, d.osoba1.funkcja, 8); comb(97, d.osoba1.pesel);
  text(98, d.osoba2.imie); text(99, d.osoba2.nazwisko);
  text(100, d.osoba2.funkcja, 8); comb(101, d.osoba2.pesel);

  const now = new Date();
  doc.setTitle('NIP-8 — zgłoszenie w zakresie danych uzupełniających');
  doc.setAuthor('TD Consulting Group');
  doc.setProducer('TD Consulting Group — Portal dokumentów');
  doc.setCreator('TD Consulting Group — Portal dokumentów');
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  return await doc.save();
}

// ---------------- Submit ----------------
const form = $('form');
const submitBtn = $('submitBtn');
const statusEl = $('status');
function showStatus(msg, type) { statusEl.textContent = msg; statusEl.className = 'status ' + type; }

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.className = 'status';

  let firstInvalid = null;
  form.querySelectorAll('input[required],select[required]').forEach(inp => {
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

  const d = collectData();
  if (d.nip.length !== 10) { showStatus('NIP musi mieć 10 cyfr.', 'error'); return; }
  if (d.krs.length !== 10) { showStatus('Numer KRS musi mieć 10 cyfr.', 'error'); return; }
  for (const [label, r] of [['pierwszy', d.rachunek1], ['drugi', d.rachunek2]]) {
    if (r.iban && r.iban.length !== 26) {
      showStatus('Nieprawidłowy numer rachunku (' + label + ') — polski IBAN to 26 cyfr.', 'error');
      return;
    }
  }
  if (d.dokumentacja === '1' && !d.biuro.nazwa) {
    showStatus('Podaj nazwę biura rachunkowego albo wybierz „we własnym zakresie”.', 'error');
    return;
  }

  submitBtn.disabled = true;
  const orig = submitBtn.textContent;
  submitBtn.textContent = 'Generowanie...';
  try {
    await loadFonts();
    const bytes = await generate(d);
    const safe = (d.nazwaSkrocona.split(' ')[0] || 'spolka').toLowerCase().replace(/[^a-z0-9]/g, '');
    const res = await saveAndDownload({
      docType: 'nip-8',
      title: 'NIP-8 — zgłoszenie w zakresie danych uzupełniających',
      subject: d.nazwaPelna,
      filename: 'NIP-8_' + (safe || 'spolka') + '_' + d.data + '.pdf',
      bytes, payload: d,
    });
    showStatus(res.saved
      ? 'Formularz NIP-8 został wygenerowany, pobrany i zapisany w historii.'
      : 'Formularz NIP-8 został wygenerowany i pobrany.', 'success');
  } catch (err) {
    console.error(err);
    showStatus('Błąd: ' + (err.message || err), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = orig;
  }
});
