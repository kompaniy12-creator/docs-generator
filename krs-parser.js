/* global pdfjsLib */
// Parser for "Odpis Aktualny KRS" PDF extracts from prs.ms.gov.pl
// Exposes: window.KRSParser.parseFile(file) -> Promise<KRSData>

(function () {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  async function extractText(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(it => it.str).join(' '));
    }
    return pages.join('\n');
  }

  // Normalize whitespace but keep newlines for section splits
  function norm(t) {
    return t.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  }

  // ---- Locative form for common Polish cities (siedziba: "z siedzibą w X") ----
  const localesMap = {
    'poznań': 'Poznaniu', 'warszawa': 'Warszawie', 'kraków': 'Krakowie',
    'wrocław': 'Wrocławiu', 'łódź': 'Łodzi', 'gdańsk': 'Gdańsku',
    'szczecin': 'Szczecinie', 'bydgoszcz': 'Bydgoszczy', 'lublin': 'Lublinie',
    'katowice': 'Katowicach', 'białystok': 'Białymstoku', 'gdynia': 'Gdyni',
    'częstochowa': 'Częstochowie', 'radom': 'Radomiu', 'sosnowiec': 'Sosnowcu',
    'toruń': 'Toruniu', 'kielce': 'Kielcach', 'gliwice': 'Gliwicach',
    'zabrze': 'Zabrzu', 'bytom': 'Bytomiu', 'olsztyn': 'Olsztynie',
    'rzeszów': 'Rzeszowie', 'tychy': 'Tychach', 'opole': 'Opolu',
    'elbląg': 'Elblągu', 'płock': 'Płocku', 'wałbrzych': 'Wałbrzychu',
    'włocławek': 'Włocławku', 'tarnów': 'Tarnowie', 'chorzów': 'Chorzowie',
    'koszalin': 'Koszalinie', 'kalisz': 'Kaliszu', 'legnica': 'Legnicy',
    'grudziądz': 'Grudziądzu', 'słupsk': 'Słupsku', 'jaworzno': 'Jaworznie',
    'siedlce': 'Siedlcach', 'mysłowice': 'Mysłowicach', 'piła': 'Pile',
    'stargard': 'Stargardzie', 'gniezno': 'Gnieźnie', 'suwałki': 'Suwałkach',
    'pabianice': 'Pabianicach', 'leszno': 'Lesznie', 'głogów': 'Głogowie',
    'ełk': 'Ełku', 'inowrocław': 'Inowrocławiu', 'starachowice': 'Starachowicach',
    'mielec': 'Mielcu', 'pruszków': 'Pruszkowie', 'lubin': 'Lubinie',
    'tczew': 'Tczewie', 'zamość': 'Zamościu', 'chełm': 'Chełmie',
    'luboń': 'Luboniu', 'śrem': 'Śremie', 'piotrków trybunalski': 'Piotrkowie Trybunalskim',
    'ostrów wielkopolski': 'Ostrowie Wielkopolskim',
  };
  function capitalize(s) {
    if (!s) return '';
    return s.trim().split(/\s+/).map(
      w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    ).join(' ');
  }
  function toLocative(city) {
    if (!city) return '';
    const key = city.trim().toLowerCase();
    if (localesMap[key]) return localesMap[key];
    const cap = capitalize(city);
    if (key.endsWith('ń')) return cap.slice(0, -1) + 'niu';
    if (key.endsWith('ów')) return cap.slice(0, -2) + 'owie';
    if (key.endsWith('ec')) return cap.slice(0, -2) + 'cu';
    if (key.endsWith('a')) return cap.slice(0, -1) + 'ie';
    if (key.endsWith('o')) return cap.slice(0, -1) + 'ie';
    return cap + 'u';
  }

  // ---- Field extraction ----
  function findKRS(text) {
    const m = text.match(/Numer\s+KRS:\s*(\d{10})/i);
    return m ? m[1] : null;
  }
  function findNIP(text) {
    const m = text.match(/\bNIP:\s*(\d{10})\b/i);
    return m ? m[1] : null;
  }
  function findREGON(text) {
    const m = text.match(/\bREGON:\s*(\d{9,14})\b/i);
    if (!m) return null;
    // Some KRS extracts have REGON with trailing zeros (e.g. 14 digits). Use as-is.
    return m[1];
  }
  function findFirma(text) {
    // After "Firma, pod którą spółka działa" comes the name, until next field "4."
    const m = text.match(/3\.?\s*Firma,?\s*pod\s+którą\s+spółka\s+działa\s+([^\n]+?)(?:\s+4\.|$)/i);
    return m ? m[1].trim() : null;
  }
  function findSiedzibaCity(text) {
    // "1.Siedziba kraj POLSKA, woj. WIELKOPOLSKIE, powiat POZNAŃSKI, gmina LUBOŃ, miejsc. LUBOŃ"
    // Take the last "miejsc." in the line
    const sieMatch = text.match(/1\.?\s*Siedziba\s+([^\n]+?)(?:\s+2\.|$)/i);
    if (!sieMatch) return null;
    const line = sieMatch[1];
    const miejscMatches = [...line.matchAll(/miejsc\.\s*([A-ZĄĆĘŁŃÓŚŹŻ\- ]+?)(?=,|\s+\d\.|$)/gi)];
    if (miejscMatches.length === 0) return null;
    const last = miejscMatches[miejscMatches.length - 1];
    return last[1].trim();
  }

  function findAdres(text) {
    // "2.Adres ul. FRYDERYKA CHOPINA, nr 9, lok. ---, miejsc. LUBOŃ, kod 62-030, poczta LUBOŃ, kraj POLSKA"
    const m = text.match(/2\.?\s*Adres\s+([^\n]+?)(?:\s+3\.|$)/i);
    if (!m) return null;
    const line = m[1];
    const empty = (v) => !v || /^[-­]+$/.test(v.trim());
    const get = (re) => {
      const x = line.match(re);
      return x ? x[1].trim() : '';
    };
    const ulica = get(/\bul\.\s*([^,]+?)(?=,)/i);
    const nrDomu = get(/\bnr\s+([^,]+?)(?=,)/i);
    const nrLokaluRaw = get(/\blok\.\s*([^,]+?)(?=,)/i);
    const miejsc = get(/\bmiejsc\.\s*([^,]+?)(?=,)/i);
    const kod = get(/\bkod\s+([0-9]{2}-[0-9]{3})/i);
    return {
      ulica: empty(ulica) ? '' : ulica,
      nrDomu: empty(nrDomu) ? '' : nrDomu,
      nrLokalu: empty(nrLokaluRaw) ? '' : nrLokaluRaw,
      kodPocztowy: kod,
      miejscowosc: empty(miejsc) ? '' : miejsc,
    };
  }

  // Parse list of people from a section.
  // For "Rubryka 7 - Dane wspólników" or "Podrubryka 1 Dane osób wchodzących w skład organu"
  function parseEntries(sectionText, type) {
    const entries = [];
    // The label "1.Nazwisko / Nazwa lub firma" appears once per entry.
    // Allow case variations (firma vs Firma)
    const labelRe = /1\.?\s*Nazwisko\s*\/\s*Nazwa\s*lub\s*[Ff]irma\s+([^\n]+?)\s+2\.?\s*Imiona\s+([^\n]+?)\s+3\./g;
    let m;
    while ((m = labelRe.exec(sectionText)) !== null) {
      const nazwisko = m[1].trim();
      const imie = m[2].trim();
      // Stop at next "1.Nazwisko" or end of section
      const afterIdx = labelRe.lastIndex;
      const lookahead = sectionText.slice(afterIdx, afterIdx + 1200);
      const entry = { nazwisko, imie };

      if (type === 'wsp') {
        // Look for udziały count: "5.Posiadane przez wspólnika udziały X UDZIAŁ..."
        const ud = lookahead.match(/5\.?\s*Posiadane\s+przez\s+wspólnika\s+udziały\s+(\d+)\s+UDZIA/i);
        if (ud) entry.udzialy = parseInt(ud[1], 10);
      } else if (type === 'zar') {
        // Look for funkcja: "5.Funkcja w organie reprezentującym FUNKCJA"
        const fn = lookahead.match(/5\.?\s*Funkcja\s+w\s+organie\s+reprezentującym\s+([^\n]+?)(?:\s+6\.|$)/i);
        if (fn) entry.funkcja = fn[1].trim();
      }
      entries.push(entry);
    }
    return entries;
  }

  // Extract text between two markers (search by substring, dash-agnostic)
  function sliceBetween(text, startMarker, endMarker) {
    const s = text.indexOf(startMarker);
    if (s < 0) return null;
    const after = text.slice(s + startMarker.length);
    const e = endMarker ? after.indexOf(endMarker) : -1;
    return e >= 0 ? after.slice(0, e) : after;
  }

  function findWspolnicy(text) {
    // Section "Dane wspólników" until "Rubryka 8"
    const section = sliceBetween(text, 'Dane wspólników', 'Rubryka 8');
    if (!section) return [];
    return parseEntries(section, 'wsp');
  }

  function findZarzad(text) {
    // Get content from "Dział 2" through "Dział 3"
    const dz2 = sliceBetween(text, 'Dział 2', 'Dział 3');
    if (!dz2) return [];
    // Within Dział 2, find "Podrubryka 1" (the list of zarząd members)
    // and stop before "Rubryka 2" (Organ nadzoru)
    const section = sliceBetween(dz2, 'Podrubryka 1', 'Rubryka 2');
    if (!section) return [];
    return parseEntries(section, 'zar');
  }

  async function parseFile(file) {
    const raw = await extractText(file);
    const text = norm(raw);
    const krs = findKRS(text);
    const nip = findNIP(text);
    const regon = findREGON(text);
    const firma = findFirma(text);
    const cityNominative = findSiedzibaCity(text);
    const wspolnicy = findWspolnicy(text);
    const zarzad = findZarzad(text);

    const adres = findAdres(text);
    return {
      krs, nip, regon, firma,
      city: cityNominative ? capitalize(cityNominative) : null, // nominative for top-of-doc
      seat: cityNominative ? toLocative(cityNominative) : null, // locative for "z siedzibą w ..."
      adres,
      wspolnicy, zarzad,
      raw: text, // for debugging
    };
  }

  window.KRSParser = { parseFile, toLocative, capitalize };
})();
