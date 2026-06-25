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
  setVal('p_us', p.us); setVal('p_nfz', p.nfz);
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
    const raw = sessionStorage.getItem('tdcg_zlecenie_import');
    if (!raw) return;
    sessionStorage.removeItem('tdcg_zlecenie_import');
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
    // visual confirmation
    const h1 = document.querySelector('h1');
    if (h1) {
      const note = document.createElement('div');
      note.textContent = '✓ Dane wczytane ze zgłoszenia — sprawdź i wygeneruj komplet.';
      note.style.cssText = 'margin:10px auto 0;max-width:640px;padding:10px 14px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:8px;font-size:13.5px;text-align:center';
      h1.parentNode.insertBefore(note, h1.nextSibling);
    }
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
  return {
    z: {
      nazwa: get('z_nazwa'),
      miasto: get('z_miasto'),
      ulica: get('z_ulica'),
      iodAdres: get('z_iod_adres'),
      iodEmail: get('z_iod_email'),
    },
    p: {
      nazwisko: get('p_nazwisko'),
      imiona: get('p_imiona'),
      dataur: get('p_dataur'),
      miejsceur: get('p_miejsceur'),
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
    docs: {
      kwest: chk('doc_kwest'), zus: chk('doc_zus'), wykonawca: chk('doc_wykonawca'),
      ppkInfo: chk('doc_ppk_info'), wybor: chk('doc_wybor'), rodo: chk('doc_rodo'),
      ppkRez: chk('doc_ppk_rez'), gotowka: chk('doc_gotowka'), rodzina: chk('doc_rodzina'),
    },
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
const A4 = [595.28, 841.89];
const MARGIN = 56;
const SIZE = 10.5;
const LH = 15;

function makeCtx(doc, font, bold) {
  return { doc, font, bold, page: null, W: A4[0], H: A4[1], margin: MARGIN,
    innerW: A4[0] - MARGIN * 2, y: 0 };
}
function newPage(C) {
  C.page = C.doc.addPage(A4);
  C.y = C.H - C.margin;
}
function ensure(C, h) { if (C.y - h < C.margin) newPage(C); }

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

// paragraph at current y (left aligned, optional indent/hanging)
function para(C, text, opt) {
  opt = opt || {};
  const font = opt.bold ? C.bold : C.font;
  const size = opt.size || SIZE;
  const lh = opt.lh || LH;
  const indent = opt.indent || 0;
  const hang = opt.hang || 0; // extra indent for wrapped lines
  const x0 = C.margin + indent;
  const maxW = C.innerW - indent - (opt.rightPad || 0);
  const lines = wrapLines(text, font, size, maxW);
  for (let i = 0; i < lines.length; i++) {
    ensure(C, lh);
    const x = i === 0 ? x0 : x0 + hang;
    C.page.drawText(lines[i], { x, y: C.y, font, size, color: opt.color || rgb(0, 0, 0) });
    C.y -= lh;
  }
  if (opt.after != null) C.y -= opt.after;
}
function gap(C, h) { C.y -= h; }
function center(C, text, opt) {
  opt = opt || {};
  const font = opt.bold ? C.bold : C.font;
  const size = opt.size || SIZE;
  const lh = opt.lh || LH;
  const lines = wrapLines(text, font, size, C.innerW);
  for (const l of lines) {
    ensure(C, lh);
    const w = font.widthOfTextAtSize(l, size);
    C.page.drawText(l, { x: (C.W - w) / 2, y: C.y, font, size, color: opt.color || rgb(0, 0, 0) });
    C.y -= lh;
  }
  if (opt.after != null) C.y -= opt.after;
}
function title(C, text) {
  center(C, text, { bold: true, size: 13.5, lh: 18 });
  gap(C, 8);
}
// "Label: value" — label bold optional
function field(C, label, value, opt) {
  opt = opt || {};
  const lblFont = C.bold, valFont = C.font, size = SIZE;
  ensure(C, LH);
  const lbl = label + ': ';
  const lblW = lblFont.widthOfTextAtSize(lbl, size);
  C.page.drawText(lbl, { x: C.margin, y: C.y, font: lblFont, size });
  // value wrapped after label
  const valX = C.margin + lblW;
  const maxW = C.innerW - lblW;
  const lines = wrapLines(value || '', valFont, size, maxW);
  if (lines.length === 0) lines.push('');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) { C.y -= LH; ensure(C, LH); }
    const x = i === 0 ? valX : C.margin;
    C.page.drawText(lines[i], { x, y: C.y, font: valFont, size });
  }
  C.y -= LH;
  if (opt.after != null) C.y -= opt.after;
}
function checkbox(C, x, yBaseline, checked) {
  const s = 9;
  const yb = yBaseline - 1;
  C.page.drawRectangle({ x, y: yb, width: s, height: s, borderWidth: 0.8, borderColor: rgb(0, 0, 0) });
  if (checked) {
    C.page.drawLine({ start: { x: x + 1.5, y: yb + 1.5 }, end: { x: x + s - 1.5, y: yb + s - 1.5 }, thickness: 1, color: rgb(0, 0, 0) });
    C.page.drawLine({ start: { x: x + 1.5, y: yb + s - 1.5 }, end: { x: x + s - 1.5, y: yb + 1.5 }, thickness: 1, color: rgb(0, 0, 0) });
  }
}
// checkbox + label line
function checkLine(C, label, checked, opt) {
  opt = opt || {};
  const size = opt.size || SIZE, lh = opt.lh || LH;
  ensure(C, lh);
  const x = C.margin + (opt.indent || 0);
  checkbox(C, x, C.y, !!checked);
  const tx = x + 15;
  const lines = wrapLines(label, C.font, size, C.innerW - (x - C.margin) - 15);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) { C.y -= lh; ensure(C, lh); }
    C.page.drawText(lines[i], { x: i === 0 ? tx : tx, y: C.y, font: C.font, size });
  }
  C.y -= lh;
}
// signature underline with caption(s)
function signature(C, caption, opt) {
  opt = opt || {};
  const lineLen = opt.lineLen || 240;
  const align = opt.align || 'left'; // left|right|center
  gap(C, opt.top != null ? opt.top : 28);
  ensure(C, 26);
  let xStart;
  if (align === 'right') xStart = C.W - C.margin - lineLen;
  else if (align === 'center') xStart = (C.W - lineLen) / 2;
  else xStart = C.margin;
  C.page.drawLine({ start: { x: xStart, y: C.y }, end: { x: xStart + lineLen, y: C.y }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2) });
  C.y -= 12;
  const cw = C.font.widthOfTextAtSize(caption, 8.5);
  C.page.drawText(caption, { x: xStart + (lineLen - cw) / 2, y: C.y, font: C.font, size: 8.5, color: rgb(0.45, 0.45, 0.45) });
  C.y -= 12;
}
// top-right place & date block
function placeDate(C, miejscowosc, dataIso) {
  ensure(C, 22);
  const t = `${miejscowosc || '..........................'}, dnia ${isoToPLDots(dataIso) || '..............'} r.`;
  const w = C.font.widthOfTextAtSize(t, SIZE);
  C.page.drawText(t, { x: C.W - C.margin - w, y: C.y, font: C.font, size: SIZE });
  C.y -= 11;
  const sub = '(miejscowość i data)';
  const sw = C.font.widthOfTextAtSize(sub, 8);
  C.page.drawText(sub, { x: C.W - C.margin - w + (w - sw) / 2, y: C.y, font: C.font, size: 8, color: rgb(0.5, 0.5, 0.5) });
  C.y -= 24;
}

// ============================================================
//                    DOCUMENT RENDERERS
// ============================================================

// 1. KWESTIONARIUSZ OSOBOWY
function docKwestionariusz(C, d) {
  newPage(C);
  title(C, 'KWESTIONARIUSZ OSOBOWY');
  center(C, '(prosimy o uważne przeczytanie i wypełnienie drukowanymi literami lub elektronicznie)', { size: 9, lh: 12, color: rgb(0.4, 0.4, 0.4) });
  gap(C, 12);
  para(C, 'DANE OSOBOWE:', { bold: true, after: 6 });
  field(C, 'Nazwisko i imiona', `${d.p.nazwisko} ${d.p.imiona}`.trim());
  field(C, 'Data urodzenia', isoToPLDots(d.p.dataur));
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
    'Nie jestem/Jestem* emerytem lub rencistą — nr decyzji ZUS i data jego przyznania ........................................',
    'Nie posiadam/Posiadam* orzeczenie o lekkim/umiarkowanym/znacznym* stopniu niepełnosprawności wydane na okres od .................. do ...................',
    'Nie jestem/Jestem* uczniem lub studentem.',
    'Nie jestem/Jestem* zarejestrowana/ny jako osoba bezrobotna.',
    'Nie jestem/Jestem* objęta/ty ubezpieczeniem społecznym z innego tytułu. Zgodnie z powyższym oświadczeniem z tytułu wykonywania tej umowy:',
    'Nie chcę/chcę*, aby moje przychody zostały objęte zwolnieniem z PIT**.',
    'Posiadam/Nie posiadam* certyfikat rezydencji podatkowej wydany na okres od .................. do ...................',
    'Limit kosztów autorskich zastosowanych w bieżącym roku przekracza/nie przekracza* ograniczenia rocznego***. Dotychczas zastosowano ........................................',
  ];
  for (let i = 0; i < pts.length; i++) {
    para(C, `${i + 1}.  ${pts[i]}`, { hang: 18, after: 2 });
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
  para(C, d.z.nazwa, { size: 9.5, color: rgb(0.35, 0.35, 0.35), after: 6 });
  title(C, 'Oświadczenie wykonawcy dla celów podatkowych');
  identityBlock(C, d, true);
  para(C, 'Jako Wykonawca oświadczam, że:', { after: 6 });
  para(C, '1.  Posiadam/Nie posiadam* certyfikat rezydencji podatkowej wydany na okres od .................. do ...................', { hang: 18, after: 4 });
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
  twoSignatures(C, 'data i podpis Zleceniobiorcy', 'data i podpis Zleceniodawcy');
}
function twoSignatures(C, leftCap, rightCap) {
  gap(C, 36);
  ensure(C, 28);
  const lineLen = 200;
  const cols = [C.margin, C.W - C.margin - lineLen];
  [leftCap, rightCap].forEach((cap, i) => {
    const x = cols[i];
    C.page.drawLine({ start: { x, y: C.y }, end: { x: x + lineLen, y: C.y }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2) });
    const cw = C.font.widthOfTextAtSize(cap, 8.5);
    C.page.drawText(cap, { x: x + (lineLen - cw) / 2, y: C.y - 12, font: C.font, size: 8.5, color: rgb(0.45, 0.45, 0.45) });
  });
  C.y -= 26;
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
  para(C, 'Uprzejmie wnoszę o wypłatę należnego mi wynagrodzenia w formie gotówkowej — do rąk własnych, bezpośrednio w kasie Zleceniodawcy.', { after: 6 });
  para(C, 'Prośba obejmuje wszystkie kolejne wypłaty wynikające z ww. umowy, chyba że w przyszłości złożę odmienną dyspozycję.');
  signature(C, 'podpis Zleceniobiorcy', { align: 'right', top: 50 });
}

// 7. WNIOSEK O ZGŁOSZENIE CZŁONKÓW RODZINY — 5a
function docCzlonkowieRodziny(C, d) {
  newPage(C);
  placeDate(C, d.sign.miejscowosc, d.sign.data);
  field(C, 'Imię i nazwisko', fullName(d.p));
  field(C, 'PESEL', d.p.pesel);
  field(C, 'Adres zamieszkania', addrOneLine(d.adres), { after: 10 });
  title(C, 'Wniosek o zgłoszenie członków rodziny do ubezpieczenia zdrowotnego');
  para(C, `Zwracam się z prośbą o zgłoszenie do ubezpieczenia zdrowotnego członka rodziny od dnia: ${isoToPLDots(d.rodzina.od) || '..............................'} .`, { after: 6 });
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
  signature(C, 'podpis pracownika', { align: 'right', top: 16 });
  gap(C, 8);
  para(C, '* właściwą odpowiedź zaznaczyć znakiem „X”.', { size: 8, lh: 11, color: rgb(0.4, 0.4, 0.4) });
}

// 8. KLAUZULA INFORMACYJNA RODO — 5d
function docRodo(C, d) {
  newPage(C);
  title(C, 'Klauzula informacyjna dotycząca przetwarzania danych osobowych dla wykonawcy umowy cywilnoprawnej');
  para(C, `1.  Zgodnie z art. 13 ust. 1 rozporządzenia Parlamentu Europejskiego i Rady (UE) 2016/679 z 27 kwietnia 2016 r. (RODO) informujemy, że administratorem Pani/Pana danych osobowych jest: ${d.z.nazwa || '..............................'} z siedzibą w ${d.z.miasto || '..............'} przy ${d.z.ulica || '..............................'}.`, { hang: 18, after: 4 });
  para(C, '2.  Na podstawie obowiązujących przepisów wyznaczyliśmy Inspektora Ochrony Danych, z którym można kontaktować się:', { hang: 18, after: 2 });
  para(C, `–  listownie na adres: ${d.z.iodAdres || '............................................................'}`, { indent: 18, after: 2 });
  para(C, `–  przez e-mail: ${d.z.iodEmail || '............................................................'}`, { indent: 18, after: 4 });
  para(C, '3.  Dane osobowe pozyskane w związku z zawarciem z Panią/Panem umowy będą przetwarzane w celach: związanych z realizacją podpisanej umowy; dochodzeniem ewentualnych roszczeń i odszkodowań; udzielania odpowiedzi na pisma, wnioski i skargi; udzielania odpowiedzi w toczących się postępowaniach.', { hang: 18, after: 4 });
  para(C, '4.  Podstawą prawną przetwarzania Pani/Pana danych jest: niezbędność do wykonania umowy lub podjęcia działań przed jej zawarciem (art. 6 ust. 1 lit. b RODO); konieczność wypełnienia obowiązku prawnego ciążącego na administratorze (art. 6 ust. 1 lit. c RODO); niezbędność do celów wynikających z prawnie uzasadnionych interesów administratora (art. 6 ust. 1 lit. f RODO).', { hang: 18, after: 4 });
  para(C, '5.  Pozyskane dane osobowe mogą być przekazywane: organom lub podmiotom publicznym uprawnionym do uzyskania danych na podstawie przepisów prawa (np. sądom, organom ścigania, instytucjom państwowym); podmiotom przetwarzającym je na nasze zlecenie.', { hang: 18, after: 4 });
  para(C, '6.  Okres przetwarzania danych jest uzależniony od celu i obliczany w oparciu o: czas obowiązywania umowy; przepisy prawa obligujące do przetwarzania danych przez określony czas; okres niezbędny do obrony naszych interesów.', { hang: 18, after: 4 });
  para(C, '7.  Ma Pani/Pan prawo do: dostępu do swoich danych; sprostowania danych nieprawidłowych oraz uzupełnienia niekompletnych; usunięcia danych; ograniczenia przetwarzania; wniesienia sprzeciwu wobec przetwarzania; przenoszenia danych; wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych.', { hang: 18, after: 4 });
  para(C, '8.  W zakresie, w jakim dane są przetwarzane na podstawie zgody — ma Pani/Pan prawo wycofania zgody w dowolnym momencie. Wycofanie zgody nie wpływa na zgodność z prawem przetwarzania dokonanego przed jej wycofaniem. Zgodę można wycofać przez wysłanie oświadczenia na adres korespondencyjny bądź adres e-mail administratora.', { hang: 18, after: 6 });
  signature(C, 'podpis zleceniobiorcy', { align: 'right', top: 16 });
}

// 9. OŚWIADCZENIE O WYBORZE UMOWY ZLECENIA — 6
function docWyborUmowy(C, d) {
  newPage(C);
  title(C, 'Oświadczenie');
  para(C, 'Ja, niżej podpisany/a', { after: 2 });
  para(C, fullName(d.p), { bold: true, after: 2 });
  para(C, `zamieszkały/a ${addrOneLine(d.adres)},`, { after: 6 });
  para(C, 'oświadczam, że dobrowolnie i świadomie wybrałem/am formę współpracy na podstawie umowy zlecenia. Forma ta jest zgodna z moimi oczekiwaniami oraz potrzebami wynikającymi z mojego obecnego trybu życia i innych zobowiązań.', { after: 6 });
  para(C, 'W szczególności potwierdzam, że:', { after: 4 });
  para(C, '1.  Chcę świadczyć usługi w elastycznym i lojalnym harmonogramie, który pozwala mi na łączenie wykonywanych zleceń z innymi interesami oraz obowiązkami życiowymi.', { hang: 18, after: 3 });
  para(C, '2.  Forma umowy zlecenia zapewnia mi swobodę organizowania czasu pracy i nie oczekuję, aby świadczenie usług odbywało się w sposób charakterystyczny dla stosunku pracy.', { hang: 18, after: 3 });
  para(C, '3.  Zostałem/am poinformowany/a o różnicach między umową zlecenia a umową o pracę oraz o przysługujących mi prawach.', { hang: 18, after: 3 });
  para(C, '4.  Potwierdzam, że mój wybór nie wynika z przymusu ani nacisku, a współpraca na podstawie umowy zlecenia jest zgodna z moją wolą.', { hang: 18, after: 6 });
  para(C, 'Oświadczam, że powyższe informacje są prawdziwe i składam je dobrowolnie.', { after: 6 });
  // place & date line bottom-left
  ensure(C, 20);
  para(C, `${d.sign.miejscowosc || '..............'}, dnia ${isoToPLDots(d.sign.data) || '..............'} r.`, { after: 0 });
  signature(C, 'Podpis zleceniobiorcy', { align: 'right', top: 14 });
}

// ============================================================
//                    BUILD COMBINED PDF
// ============================================================
async function generateKomplet(d) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const now = new Date();
  doc.setTitle('Umowa zlecenie — komplet dokumentów');
  doc.setAuthor('TD Consulting Group');
  doc.setProducer('TD Consulting Group — Portal dokumentów');
  doc.setCreator('TD Consulting Group — Portal dokumentów');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  const font = await doc.embedFont(fontRegular);
  const bold = await doc.embedFont(fontBold);
  const C = makeCtx(doc, font, bold);

  if (d.docs.kwest) docKwestionariusz(C, d);
  if (d.docs.zus) docOswiadczenieZus(C, d);
  if (d.docs.wykonawca) docOswiadczenieWykonawcy(C, d);
  if (d.docs.wybor) docWyborUmowy(C, d);
  if (d.docs.ppkInfo) docInformacjaPpk(C, d);
  if (d.docs.ppkRez) docRezygnacjaPpk(C, d);
  if (d.docs.gotowka) docGotowka(C, d);
  if (d.docs.rodzina) docCzlonkowieRodziny(C, d);
  if (d.docs.rodo) docRodo(C, d);

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
function showStatus(msg, type) { statusEl.textContent = msg; statusEl.className = 'status ' + type; }

function anyDocSelected(d) {
  return Object.values(d.docs).some(Boolean);
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

  const data = collectData();
  if (!anyDocSelected(data)) { showStatus('Zaznacz przynajmniej jeden dokument do wygenerowania.', 'error'); return; }

  submitBtn.disabled = true;
  const orig = submitBtn.textContent;
  submitBtn.textContent = 'Generowanie...';

  try {
    await loadFonts();
    const bytes = await generateKomplet(data);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const safe = toAsciiLetters(`${data.p.nazwisko}_${data.p.imiona}`).toLowerCase() || 'zleceniobiorca';
    const filename = `Umowa_zlecenie_komplet_${safe}_${data.sign.data || ''}.pdf`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);

    showStatus('Komplet został wygenerowany i pobrany.', 'success');

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
          title: 'Umowa zlecenie — komplet',
          subject: fullName(data.p),
          filename,
          payload: data,
          pdfBytes: bytes,
        });
        showStatus('Komplet wygenerowany, pobrany i zapisany w historii.', 'success');
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
