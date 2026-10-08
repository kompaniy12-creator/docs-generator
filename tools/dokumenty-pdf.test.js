// Test silnika PDF generatora pojedynczych dokumentów (dokumenty-pdf.js + dokumenty-wzory.js).
// Buduje PDF dla KAŻDEGO dokumentu z treścią na fikcyjnych danych (KadryWzory.przyklad) — po polsku,
// a dokumenty z tłumaczeniem także w wersji dwujęzycznej z atrapą tłumacza (bez sieci).
// Wymaga pdf-lib i @pdf-lib/fontkit (te same wersje co na stronie) poza repozytorium:
//   mkdir /tmp/dokgen && cd /tmp/dokgen && npm i pdf-lib@1.17.1 @pdf-lib/fontkit@1.1.1
//   NODE_PATH=/tmp/dokgen/node_modules node tools/dokumenty-pdf.test.js [katalog-na-pdf]
// Bez katalogu pliki nie są zapisywane. Kod wyjścia 1 przy błędzie.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PDFLib = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const K = require(path.join(ROOT, 'dokumenty-wzory.js'));
const P = require(path.join(ROOT, 'dokumenty-pdf.js'));

const out = process.argv[2] || '';
if (out) fs.mkdirSync(out, { recursive: true });
const fonts = { regular: fs.readFileSync(path.join(ROOT, 'fonts/Roboto-Regular.ttf')), bold: fs.readFileSync(path.join(ROOT, 'fonts/Roboto-Bold.ttf')) };
let failed = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failed++; console.error('  BŁĄD: ' + msg); } }

// fikcyjne dane z polskimi znakami i cyrylicą (nazwisko w dwóch zapisach), długie słowo bez spacji
function dane(doc) {
  const d = K.przyklad(doc);
  if (d.p_imie_nazwisko !== undefined) d.p_imie_nazwisko = 'Олександр Тестовий-Żółćgęślą (Oleksandr Testowyj)';
  if (d.z_nazwa !== undefined) d.z_nazwa = 'Zażółć Gęślą Jaźń Testowa Sp. z o.o.';
  if (d.p_adres !== undefined) d.p_adres = 'вул. Тестова 1, Київ / ul. Testowa 3/4, 00-000 Warszawa';
  doc.pola.forEach((p) => { if (p.typ === 'dlugi') d[p.id] = 'Zażółć gęślą jaźń — opis przykładowy. Щира перевірка кирилиці. Bardzodługiesłowobezspacji_' + 'x'.repeat(140); });
  return d;
}
// atrapa tłumacza: cyrylica + zachowane znaczniki {0}; co piąty napis „gubi” znacznik (ma zostać polski)
function atrapa(napisy) {
  const m = {};
  napisy.forEach((s, i) => { m[s] = i % 5 === 4 ? 'Переклад без позначок' : 'Переклад: ' + s.replace(/[a-ząćęłńóśźż]{4,}/gi, 'слово'); });
  return m;
}

(async () => {
  const docs = K.generowane();
  ok(docs.length === 50, 'dokumentów z treścią: ' + docs.length + ' (oczekiwano 50)');
  for (const doc of docs) {
    const d = dane(doc), r = K.render(doc, d), t = '[' + doc.id + '] ';
    try {
      const bytes = await P.zbuduj({ PDFLib, fontkit, fonts, bloki: r.bloki, tytul: doc.nazwa, stopka: doc.do_zatwierdzenia ? 'wzór do zatwierdzenia' : '' });
      ok(Buffer.from(bytes.slice(0, 5)).toString() === '%PDF-', t + 'to nie jest PDF');
      const n = (await PDFLib.PDFDocument.load(bytes)).getPageCount();
      ok(n >= 1 && n <= 12, t + 'liczba stron: ' + n);
      if (out) fs.writeFileSync(path.join(out, doc.id + '.pdf'), bytes);
    } catch (e) { ok(false, t + 'PDF po polsku: ' + (e.stack || e)); }
    if (doc.dwujezyczny.poziom === 'nie') continue;
    for (const opisowe of [true, false]) {
      try {
        const dj = P.dwujezycznie(K, doc, d, opisowe);
        // do tłumaczenia nie trafiają dane osób
        const wyslane = dj.napisy.join('\n');
        ok(wyslane.indexOf('Тестовий') < 0 && wyslane.indexOf('Testowa 3/4') < 0 && wyslane.indexOf('Gęślą Jaźń Testowa') < 0, t + 'dane osobowe w napisach do tłumaczenia');
        ok(opisowe || wyslane.indexOf('opis przykładowy') < 0, t + 'pole opisowe wysłane mimo wyłączenia');
        ok(wyslane.indexOf('{{') < 0, t + 'niepodstawione {{pole}} w szablonie');
        const mapa = atrapa(dj.napisy);
        if (!opisowe) continue;
        const bytes = await P.zbuduj({ PDFLib, fontkit, fonts, bloki: dj.bloki, pl: dj.pl, tr: dj.tr(mapa), tytul: doc.nazwa });
        ok((await PDFLib.PDFDocument.load(bytes)).getPageCount() >= 1, t + 'PDF dwujęzyczny bez stron');
        if (out) fs.writeFileSync(path.join(out, doc.id + '.dwujezyczny.pdf'), bytes);
      } catch (e) { ok(false, t + 'wersja dwujęzyczna: ' + (e.stack || e)); }
    }
  }
  console.log((failed ? 'BŁĘDY: ' + failed + ' z ' : 'OK — ') + checks + ' sprawdzeń, ' + docs.length + ' dokumentów' + (out ? ', PDF w ' + out : ''));
  process.exit(failed ? 1 : 0);
})();
