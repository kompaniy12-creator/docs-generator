/* Kadry — silnik PDF generatora pojedynczych dokumentów (dokumenty.html).
 *
 * Rysuje bloki z KadryWzory.render() (dokumenty-wzory.js) tym samym krojem, marginesami i stylem
 * tytułów co komplet (umowa-zlecenie.js): Roboto, A4, margines 56 pt, tekst 10,5 pt / interlinia 15 pt;
 * wersja dwujęzyczna — polski oryginał po lewej, tłumaczenie naprzeciw (margines 36 pt, skala 0,88).
 *
 * window.KadryPdf / module.exports:
 *   zbuduj({ PDFLib, fontkit, fonts: { regular, bold, script?: [regular, bold] },
 *            bloki, pl?, tr?, tytul, temat?, stopka? }) -> Promise<Uint8Array>
 *     bloki  — z KadryWzory.render(); w wersji dwujęzycznej napisy mogą zawierać znaczniki {0}, {1}…
 *     pl(s)  — napis bloku -> tekst polski (domyślnie bez zmian)
 *     tr(s)  — napis bloku -> tłumaczenie; null = dokument tylko po polsku
 *     stopka — drobny napis w stopce każdej strony (np. „wzór do zatwierdzenia”)
 *   poziomo(bloki) -> true, gdy dokument wymaga strony poziomej (tabela od 8 kolumn)
 *
 * Układ: każdy blok zamienia się na wiersze (linia tekstu, wiersz tabeli, podpisy), a dopiero potem
 * wiersze są rozkładane na strony — dzięki temu tytuł nie zostaje sam na dole strony, podpisy nie
 * lądują same na nowej stronie, a nagłówek tabeli powtarza się po przejściu na kolejną stronę.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KadryPdf = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var A4 = [595.28, 841.89];
  var MARGIN = 56, MARGIN_BI = 36, MARGIN_POZIOMO = 30;
  var SIZE = 10.5, LH = 15, GUTTER = 18;
  var STOPKA_H = 16;            // miejsce na stopkę (numer strony, oznaczenie wzoru)
  var LIT = 'abcdefghijklmnoprstuwz';
  // Roboto nie ma indeksów górnych ⁰ ⁵–⁹ (art. 67¹⁹, 186⁸ KP) — wszystkie indeksy rysujemy jako małe cyfry u góry
  var SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

  function poziomo(bloki) { return (bloki || []).some(function (b) { return b.t === 'tabela' && b.kolumny.length >= 8; }); }

  // ---------------- krój: pomiar i rysowanie z zastępstwami ----------------
  // fonts: [główny, zapasowy?] (PDFFont). Znak spoza obu krojów zamieniany jest na „?”.
  function face(fonts) {
    var sets = fonts.map(function (f) { return new Set(f.getCharacterSet()); });
    function runs(t) {
      var out = [], s = String(t == null ? '' : t).replace(/[   \t]/g, ' ').replace(/[​-‍﻿\r]/g, '');
      for (var ch of s) {
        var sup = SUP[ch] !== undefined, c = sup ? SUP[ch] : ch, cp = c.codePointAt(0), fi = -1;
        for (var i = 0; i < fonts.length; i++) if (sets[i].has(cp)) { fi = i; break; }
        if (fi < 0) { c = '?'; fi = 0; }
        var last = out[out.length - 1];
        if (last && last.fi === fi && last.sup === sup) last.text += c; else out.push({ fi: fi, sup: sup, text: c });
      }
      return out;
    }
    function width(t, size) {
      return runs(t).reduce(function (w, r) { return w + fonts[r.fi].widthOfTextAtSize(r.text, r.sup ? size * 0.62 : size); }, 0);
    }
    function draw(page, t, x, y, size, color) {
      runs(t).forEach(function (r) {
        var s = r.sup ? size * 0.62 : size;
        page.drawText(r.text, { x: x, y: r.sup ? y + size * 0.36 : y, size: s, font: fonts[r.fi], color: color });
        x += fonts[r.fi].widthOfTextAtSize(r.text, s);
      });
    }
    return { width: width, draw: draw };
  }

  // zawijanie: po słowach; słowo dłuższe niż wiersz (adres e-mail, numer) dzielone po znakach
  function wrap(text, f, size, maxW) {
    var out = [];
    if (text == null) return out;
    String(text).split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      words.forEach(function (w) {
        var test = line ? line + ' ' + w : w;
        if (f.width(test, size) <= maxW) { line = test; return; }
        if (line) { out.push(line); line = ''; }
        if (f.width(w, size) <= maxW) { line = w; return; }
        var part = '';
        for (var ch of w) {
          if (part && f.width(part + ch, size) > maxW) { out.push(part); part = ch; } else part += ch;
        }
        line = part;
      });
      out.push(line);
    });
    return out;
  }

  async function zbuduj(o) {
    var PDFLib = o.PDFLib, rgb = PDFLib.rgb;
    var doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(o.fontkit);
    var now = new Date();
    doc.setTitle(o.tytul || 'Dokument kadrowy');
    if (o.temat) doc.setSubject(o.temat);
    doc.setAuthor('TD Consulting Group');
    doc.setProducer('TD Consulting Group — Portal dokumentów');
    doc.setCreator('TD Consulting Group — Portal dokumentów');
    doc.setCreationDate(now);
    doc.setModificationDate(now);

    var fr = await doc.embedFont(o.fonts.regular, { subset: true }), fb = await doc.embedFont(o.fonts.bold, { subset: true });
    var plF = face([fr]), plB = face([fb]), trF = plF, trB = plB;
    var bi = typeof o.tr === 'function';
    if (bi && o.fonts.script) {
      trF = face([await doc.embedFont(o.fonts.script[0], { subset: true }), fr]);
      trB = face([await doc.embedFont(o.fonts.script[1], { subset: true }), fb]);
    }
    var PL = o.pl || function (s) { return s; };
    var land = poziomo(o.bloki);
    var W = land ? A4[1] : A4[0], H = land ? A4[0] : A4[1];
    var margin = land ? MARGIN_POZIOMO : bi ? MARGIN_BI : MARGIN;
    var innerW = W - margin * 2, k = bi ? 0.88 : 1;
    var colW = bi ? (innerW - GUTTER) / 2 : innerW;
    var cols = [{ x: margin, w: colW, f: plF, b: plB, t: PL }];
    if (bi) cols.push({ x: margin + colW + GUTTER, w: colW, f: trF, b: trB, t: o.tr });
    var full = [{ x: margin, w: innerW, f: plF, b: plB, t: PL }];   // bloki zawsze na całą szerokość
    var BLACK = rgb(0, 0, 0), GREY = rgb(0.45, 0.45, 0.45), LINE = rgb(0.2, 0.2, 0.2), HAIR = rgb(0.82, 0.82, 0.82);

    // ---------------- wiersze ----------------
    // { before, h, after, draw(page, yTop), keep (trzymaj z następnym), grupa, tab, flex, glowa }
    var rows = [], grupa = 0;
    function push(r) { r.before = r.before || 0; r.after = r.after || 0; rows.push(r); return r; }
    function first(n0) { return rows[n0]; }
    function dzielnik(page, yTop, h) { // cienka linia między oryginałem a tłumaczeniem
      var x = cols[1].x - GUTTER / 2;
      page.drawLine({ start: { x: x, y: yTop + 2 }, end: { x: x, y: yTop - h - 0.5 }, thickness: 0.4, color: HAIR });
    }
    // tekst w kolumnach: wiersz i-ty oryginału stoi naprzeciw wiersza i-tego tłumaczenia
    // opt: bold, size, lh, align (left|center|right), indent, prefix, color, before, after, cc (kolumny), raw
    function tekst(text, opt) {
      opt = opt || {};
      var cc = opt.cc || cols, kk = cc === cols ? k : 1;
      var size = (opt.size || SIZE) * kk, lh = (opt.lh || LH) * kk, indent = (opt.indent || 0) * kk, color = opt.color || BLACK;
      var blocks = cc.map(function (c) {
        var f = opt.bold ? c.b : c.f, pw = opt.prefix ? f.width(opt.prefix + ' ', size) + 2 * kk : 0;
        return { c: c, f: f, pw: pw, lines: wrap(opt.raw ? text : c.t(text), f, size, c.w - indent - pw) };
      });
      var n = Math.max.apply(null, blocks.map(function (b) { return b.lines.length; })), n0 = rows.length;
      for (var i = 0; i < n; i++) (function (i) {
        push({
          h: lh, dwa: cc === cols && bi,
          draw: function (page, yTop) {
            var y = yTop - size;
            blocks.forEach(function (b) {
              if (i >= b.lines.length) return;
              var line = b.lines[i], x = b.c.x + indent + b.pw;
              if (opt.align === 'center') x = b.c.x + (b.c.w - b.f.width(line, size)) / 2;
              else if (opt.align === 'right') x = b.c.x + b.c.w - b.f.width(line, size);
              if (i === 0 && opt.prefix) b.f.draw(page, opt.prefix, b.c.x + indent, y, size, color);
              b.f.draw(page, line, x, y, size, color);
            });
          },
        });
      })(i);
      if (n) { rows[n0].before = (opt.before || 0) * kk; rows[rows.length - 1].after = (opt.after || 0) * kk; }
      // sieroty i wdowy: pierwsze dwie i ostatnie dwie linie akapitu zostają razem
      if (n >= 2) { rows[n0].keep = true; if (n >= 3) rows[rows.length - 2].keep = true; }
      return n0;
    }
    function trzymajZNastepnym(n0) { for (var i = n0; i < rows.length; i++) rows[i].keep = true; }

    // „Etykieta: wartość” — pogrubiona etykieta, wartość płynie za nią
    function pole(label, value, cc, x0, w0) {
      var size = SIZE * (cc === cols ? k : 1), lh = LH * (cc === cols ? k : 1);
      var blocks = cc.map(function (c) {
        var x = x0 != null ? x0 : c.x, w = w0 != null ? w0 : c.w, lines = [[]], cur = 0;
        [{ f: c.b, text: c.t(label) + ':' }, { f: c.f, text: c.t(value) }].forEach(function (s) {
          wrap(s.text, s.f, size, w).join(' ').split(/\s+/).filter(Boolean).forEach(function (word) {
            var line = lines[lines.length - 1], sp = line.length ? s.f.width(' ', size) : 0, ww = s.f.width(word, size);
            if (line.length && cur + sp + ww > w) { lines.push([{ f: s.f, text: word, x: 0 }]); cur = ww; }
            else { line.push({ f: s.f, text: word, x: cur + sp }); cur += sp + ww; }
          });
        });
        return { x: x, lines: lines };
      });
      var n = Math.max.apply(null, blocks.map(function (b) { return b.lines.length; })), n0 = rows.length;
      for (var i = 0; i < n; i++) (function (i) {
        push({ h: lh, dwa: cc === cols && bi, draw: function (page, yTop) {
          blocks.forEach(function (b) { (b.lines[i] || []).forEach(function (p) { p.f.draw(page, p.text, b.x + p.x, yTop - size, size, BLACK); }); });
        } });
      })(i);
      if (n >= 2) rows[n0].keep = true;
      return n0;
    }

    function tabela(b) {
      var n = b.kolumny.length, szeroka = n >= 8, size = szeroka ? 7.2 : 8.8, lh = size + 2.2, pad = szeroka ? 2.5 : 4;
      var wagi = b.kolumny.map(function (kol, i) {
        var s = PL(kol), w = Math.max(5, Math.min(26, s.length));
        if (/^(lp\.?|dzień|dzień miesiąca|ilość)$/i.test(s.trim())) w = szeroka ? 5 : 6;
        return w;
      });
      var suma = wagi.reduce(function (a, c) { return a + c; }, 0), xs = [margin], ws = wagi.map(function (w) { return innerW * w / suma; });
      // kolumna nie węższa niż najdłuższe słowo jej nagłówka; nadwyżkę oddają najszersze kolumny
      var minW = b.kolumny.map(function (kol) { return Math.max.apply(null, (PL(kol) + (bi ? ' ' + o.tr(kol) : '')).split(/\s+/).map(function (s) { return Math.min(plB.width(s, size), innerW / n); })) + pad * 2 + 1; });
      for (var proba = 0; proba < 4; proba++) {
        var brak = 0, zapas = 0;
        ws.forEach(function (w, i) { if (w < minW[i]) { brak += minW[i] - w; ws[i] = minW[i]; } else zapas += w - minW[i]; });
        if (!brak || zapas <= 0) break;
        ws = ws.map(function (w, i) { return w > minW[i] ? w - brak * (w - minW[i]) / zapas : w; });
      }
      ws.forEach(function (w) { xs.push(xs[xs.length - 1] + w); });
      function kratka(page, yTop, h) {
        xs.forEach(function (x) { page.drawLine({ start: { x: x, y: yTop }, end: { x: x, y: yTop - h }, thickness: 0.6, color: BLACK }); });
        page.drawLine({ start: { x: margin, y: yTop }, end: { x: margin + innerW, y: yTop }, thickness: 0.6, color: BLACK });
        page.drawLine({ start: { x: margin, y: yTop - h }, end: { x: margin + innerW, y: yTop - h }, thickness: 0.6, color: BLACK });
      }
      // nagłówek: polski pogrubiony, pod nim tłumaczenie (szare), gdy dokument jest dwujęzyczny
      var head = b.kolumny.map(function (kol, i) {
        var a = wrap(PL(kol), plB, size, ws[i] - pad * 2).map(function (t) { return { t: t, f: plB, c: BLACK }; });
        if (bi) { var t2 = o.tr(kol); if (t2 && t2 !== PL(kol)) a = a.concat(wrap(t2, trF, size, ws[i] - pad * 2).map(function (t) { return { t: t, f: trF, c: GREY }; })); }
        return a;
      });
      var hh = Math.max.apply(null, head.map(function (c) { return c.length; })) * lh + pad * 2;
      var id = ++grupa;
      var glowa = { h: hh, tab: id, draw: function (page, yTop) {
        kratka(page, yTop, hh);
        head.forEach(function (c, i) { c.forEach(function (l, j) { l.f.draw(page, l.t, xs[i] + (ws[i] - l.f.width(l.t, size)) / 2, yTop - pad - size - j * lh + 1, size, l.c); }); });
      } };
      glowa.before = 6; glowa.keep = true;
      push(glowa);
      (b.wiersze || []).forEach(function (w) {
        var cells = w.map(function (c, i) { return wrap(PL(c), plF, size + 0.6, (ws[i] || 40) - pad * 2); });
        var h = Math.max.apply(null, cells.map(function (c) { return c.length; }).concat([1])) * (lh + 0.6) + pad * 2;
        push({ h: h, tab: id, glowa: glowa, draw: function (page, yTop) {
          kratka(page, yTop, h);
          cells.forEach(function (c, i) { c.forEach(function (t, j) { plF.draw(page, t, xs[i] + pad, yTop - pad - size - j * (lh + 0.6), size + 0.6, BLACK); }); });
        } });
      });
      for (var i = 0; i < (b.puste_wiersze || 0); i++) {
        (function () {
          var r = push({ h: szeroka ? 13 : 20, tab: id, glowa: glowa, flex: szeroka ? 10.4 : 14, draw: function (page, yTop) { kratka(page, yTop, r.h); } });
        })();
      }
      rows[rows.length - 1].after = 8;
    }

    function podpisy(b) {
      var lineLen = Math.min(210, (innerW - 40) / 2), size = 8.5, lh = 10.5;
      var sides = [];
      if (b.lewy) sides.push({ x: margin, cap: b.lewy });
      if (b.prawy) sides.push({ x: W - margin - lineLen, cap: b.prawy });
      if (!sides.length) return;
      sides.forEach(function (s) {
        s.lines = wrap(PL(s.cap), plF, size, lineLen).map(function (t) { return { t: t, f: plF }; });
        if (bi) { var t2 = o.tr(s.cap); if (t2 && t2 !== PL(s.cap)) s.lines = s.lines.concat(wrap(t2, trF, size, lineLen).map(function (t) { return { t: t, f: trF }; })); }
      });
      var top = 34, h = top + 4 + Math.max.apply(null, sides.map(function (s) { return s.lines.length; })) * lh + 8;
      // podpis nigdy sam na nowej stronie: trzyma się z trzema poprzednimi wierszami
      for (var i = Math.max(0, rows.length - 3); i < rows.length; i++) rows[i].keep = true;
      push({ h: h, draw: function (page, yTop) {
        var y = yTop - top;
        sides.forEach(function (s) {
          page.drawLine({ start: { x: s.x, y: y }, end: { x: s.x + lineLen, y: y }, thickness: 0.6, color: LINE });
          s.lines.forEach(function (l, j) { l.f.draw(page, l.t, s.x + (lineLen - l.f.width(l.t, size)) / 2, y - 11 - j * lh, size, GREY); });
        });
      } });
    }

    // ---------------- bloki -> wiersze ----------------
    (o.bloki || []).forEach(function (b) {
      var n0, i;
      if (b.t === 'naglowek') {
        var lewo = (b.lewo || []).filter(function (x) { return String(x).trim() !== ''; }), prawo = b.prawo ? PL(b.prawo) : '';
        var pw = prawo ? Math.min(plF.width(prawo, SIZE), innerW * 0.45) : 0, lw = innerW - (pw ? pw + 24 : 0);
        var L = [], R = prawo ? wrap(prawo, plF, SIZE, pw + 0.5) : [];
        lewo.forEach(function (x, j) { wrap(PL(x), j === 0 ? plB : plF, SIZE, lw).forEach(function (t) { L.push({ t: t, f: j === 0 ? plB : plF }); }); });
        n0 = rows.length;
        for (i = 0; i < Math.max(L.length, R.length); i++) (function (i) {
          push({ h: LH, draw: function (page, yTop) {
            if (L[i]) L[i].f.draw(page, L[i].t, margin, yTop - SIZE, SIZE, BLACK);
            if (R[i]) plF.draw(page, R[i], W - margin - plF.width(R[i], SIZE), yTop - SIZE, SIZE, BLACK);
          } });
        })(i);
        if (rows.length > n0) rows[rows.length - 1].after = land ? 6 : 18;
      } else if (b.t === 'tytul') {
        n0 = tekst(b.tekst, { bold: true, size: 13.5, lh: 18, align: 'center', before: land ? 2 : 8, after: land ? 4 : 8 });
        trzymajZNastepnym(n0);
      } else if (b.t === 'podtytul') {
        n0 = tekst(b.tekst, { align: 'center', after: land ? 4 : 8 });
        trzymajZNastepnym(n0);
      } else if (b.t === 'adresat') {
        var ax = margin + innerW * 0.56, aw = innerW * 0.44;
        n0 = rows.length;
        (b.linie || []).filter(function (x) { return String(x).trim() !== ''; }).forEach(function (x, j) {
          wrap(PL(x), j === 0 ? plB : plF, SIZE, aw).forEach(function (t) {
            push({ h: LH, draw: function (page, yTop) { (j === 0 ? plB : plF).draw(page, t, ax, yTop - SIZE, SIZE, BLACK); } });
          });
        });
        if (rows.length > n0) { rows[n0].before = 4; rows[rows.length - 1].after = 16; }
      } else if (b.t === 'paragraf') {
        n0 = tekst(b.nr, { bold: true, align: 'center', before: 9, after: b.tytul ? 0 : 3, raw: true });
        if (b.tytul) tekst(b.tytul, { bold: true, align: 'center', after: 3 });
        trzymajZNastepnym(n0);
      } else if (b.t === 'p') {
        tekst(b.tekst, { bold: b.styl === 'bold', size: b.styl === 'maly' ? 9 : SIZE, lh: b.styl === 'maly' ? 12.5 : LH, align: b.styl === 'srodek' ? 'center' : 'left', after: 5 });
      } else if (b.t === 'lista') {
        (b.pozycje || []).forEach(function (x, j) {
          tekst(x, { prefix: b.typ === 'punkt' ? '–' : b.typ === 'lit' ? (LIT[j] || '?') + ')' : (j + 1) + ')', indent: 10, after: 3 });
        });
        if (rows.length) rows[rows.length - 1].after += 3;
      } else if (b.t === 'pola') {
        if (land) { // strona pozioma: dwa pola w wierszu, żeby tabela zmieściła się na jednej stronie
          for (i = 0; i < b.wiersze.length; i += 2) {
            var half = (innerW - 24) / 2, a0 = rows.length;
            pole(b.wiersze[i][0], b.wiersze[i][1], full, margin, half);
            var a1 = rows.length;
            if (b.wiersze[i + 1]) {
              pole(b.wiersze[i + 1][0], b.wiersze[i + 1][1], full, margin + half + 24, half);
              // prawa połowa rysowana na wysokości lewej: łączymy wiersze parami
              var prawe = rows.splice(a1, rows.length - a1);
              prawe.forEach(function (r, j) {
                if (rows[a0 + j]) { var l = rows[a0 + j], dl = l.draw; l.draw = function (page, y) { dl(page, y); r.draw(page, y); }; } else rows.push(r);
              });
            }
          }
        } else b.wiersze.forEach(function (w) { pole(w[0], w[1], cols); });
        if (rows.length) rows[rows.length - 1].after += 5;
      } else if (b.t === 'tabela') {
        tabela(b);
      } else if (b.t === 'podpisy') {
        podpisy(b);
      } else if (b.t === 'pouczenie') {
        // wyodrębnione pouczenie: cienka linia, tytuł, pełna treść; tytuł nie odrywa się od treści
        var g = ++grupa, s0 = rows.length;
        push({ before: 10, h: 7, draw: function (page, yTop) { page.drawLine({ start: { x: margin, y: yTop - 1 }, end: { x: margin + innerW, y: yTop - 1 }, thickness: 0.5, color: LINE }); }, keep: true });
        n0 = tekst(b.tytul, { bold: true, size: 9.5, lh: 13, after: 2 });
        trzymajZNastepnym(n0);
        (b.akapity || []).forEach(function (x) { tekst(x, { size: 9.5, lh: 13, after: 3 }); });
        for (i = s0; i < rows.length; i++) rows[i].grupa = g;
        rows[rows.length - 1].after += 4;
      } else if (b.t === 'przypis') {
        tekst(b.tekst, { size: 8.5, lh: 11.5, color: rgb(0.3, 0.3, 0.3), before: 6, after: 2 });
      }
    });

    // ---------------- wiersze -> strony ----------------
    var top = H - margin, bottom = margin + STOPKA_H, pojemnosc = top - bottom;
    var pages = [], page = null, y = 0, naGorze = true;
    function nowa() { page = doc.addPage([W, H]); pages.push(page); y = top; naGorze = true; }
    function wys(r, gora) { return (gora ? 0 : r.before) + r.h + r.after; }
    nowa();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], j, sum;
      // pusta tabela do wypełnienia ręcznego: ścieśnij wiersze, jeśli dzięki temu zmieści się na stronie
      if (r.flex && !r.ustalone) {
        var m = i, ost;
        while (m < rows.length && rows[m].tab === r.tab && rows[m].flex) m++;
        ost = m - 1;
        var ile = m - i, reszta = rows[ost].after;
        for (j = m; j < rows.length; j++) reszta += wys(rows[j], false);
        var miejsce = y - bottom, hh = r.h;
        if (ile * r.h + reszta > miejsce) {
          if (ile * r.flex + reszta <= miejsce) hh = (miejsce - reszta) / ile;
          else if (ile * r.flex + rows[ost].after <= miejsce) hh = Math.min(r.h, (miejsce - rows[ost].after) / ile);
          else if (ile * r.flex + rows[ost].after <= pojemnosc - r.glowa.h) hh = r.flex;
        }
        hh = Math.floor(hh * 100) / 100;
        for (j = i; j < m; j++) { rows[j].h = hh; rows[j].ustalone = true; }
      }
      // łańcuch wierszy, które muszą zostać razem
      sum = wys(r, naGorze); j = i;
      while (rows[j].keep && j + 1 < rows.length) { j++; sum += wys(rows[j], false); }
      var lamac = !naGorze && y - sum < bottom && sum <= pojemnosc;
      // pouczenie: jeśli nie mieści się do końca strony, a zmieści się w całości na nowej — zacznij od nowej
      if (!lamac && !naGorze && r.grupa && (i === 0 || rows[i - 1].grupa !== r.grupa)) {
        var gs = 0;
        for (j = i; j < rows.length && rows[j].grupa === r.grupa; j++) gs += wys(rows[j], false);
        if (y - gs < bottom && gs <= pojemnosc * 0.7) lamac = true;
      }
      if (!lamac && !naGorze && y - wys(r, false) < bottom) lamac = true;
      if (lamac) {
        nowa();
        if (r.glowa) { r.glowa.draw(page, y); y -= r.glowa.h; naGorze = false; }
      }
      if (!naGorze) y -= r.before;
      if (r.dwa) dzielnik(page, y, r.h + r.after);
      r.draw(page, y);
      y -= r.h + r.after;
      naGorze = false;
    }

    // ---------------- stopka ----------------
    pages.forEach(function (p, n) {
      var fy = margin - 4;
      if (o.stopka) plF.draw(p, o.stopka, margin, fy, 7.5, GREY);
      if (pages.length > 1) {
        var t = 'Strona ' + (n + 1) + ' z ' + pages.length;
        plF.draw(p, t, W - margin - plF.width(t, 8), fy, 8, GREY);
        if (!o.stopka && o.tytul) plF.draw(p, wrap(o.tytul, plF, 7.5, innerW - 90)[0] || '', margin, fy, 7.5, GREY);
      }
    });
    return await doc.save();
  }

  // ---------------- wersja dwujęzyczna: szablon bez danych osobowych ----------------
  // Do tłumaczenia (funkcja translate-docs, model AI) nie mogą trafić dane osób. Dokument jest więc
  // renderowany drugi raz, ze znacznikami {0}, {1}… w miejscu wartości pól (tak jak w komplecie:
  // tłumaczony jest tylko szablon, a wartości wstawiane są bez zmian w obu kolumnach).
  //   K — KadryWzory, opisowe — true: treść pól opisowych (typ „dlugi”: przyczyna, zakres…) jest
  //   tłumaczona razem ze zdaniem; false: także one zostają po polsku w obu kolumnach.
  // Zwraca { bloki, napisy (do przetłumaczenia), pl(s), tr(mapa) -> funkcja tłumacząca }.
  function dwujezycznie(K, doc, dane, opisowe) {
    var tok = {}, plV = [], trV = [], k;
    for (k in dane) tok[k] = dane[k];
    doc.pola.forEach(function (p) {
      var v = dane[p.id];
      if (v === undefined || v === null || String(v).trim() === '') return; // puste zostaje puste (kropki albo „nie dotyczy” ze wzoru)
      if (p.typ === 'wybor' || (p.typ === 'dlugi' && opisowe)) return;
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
      tok[p.id] = '{' + plV.length + '}';
      plV.push(p.typ === 'data' ? K.dataPL(v) : p.typ === 'kwota' ? K.kwotaPL(v) : String(v));
      trV.push(p.typ === 'data' && m ? m[3] + '.' + m[2] + '.' + m[1] : p.typ === 'kwota' ? K.kwotaPL(v) : String(v));
    });
    var wstaw = function (s, vals) { return String(s).replace(/\{(\d+)\}/g, function (all, i) { return vals[i] !== undefined ? vals[i] : all; }); };
    var pl = function (s) { return wstaw(s, plV).replace(/ r\.\.(?!\.)/g, ' r.'); };
    var znaczniki = function (s) { return (String(s).match(/\{\d+\}/g) || []).sort().join(''); };
    var bloki = K.render(doc, tok).bloki;
    // szablon po wstawieniu wartości musi dać dokładnie ten sam dokument co zwykły render
    var kontrola = JSON.parse(JSON.stringify(bloki), function (key, v) { return typeof v === 'string' && key !== 't' && key !== 'typ' && key !== 'styl' && key !== 'nr' ? pl(v) : v; });
    if (JSON.stringify(kontrola) !== JSON.stringify(K.render(doc, dane).bloki)) throw new Error('Nie udało się przygotować szablonu do tłumaczenia tego dokumentu.');
    var seen = {}, napisy = [];
    var dodaj = function (s) { if (s && !seen[s] && /[A-Za-zÀ-ž]/.test(String(s).replace(/\{\d+\}/g, ''))) { seen[s] = true; napisy.push(s); } };
    bloki.forEach(function (b) {
      // nagłówek, adresat i wiersze tabeli to dane — zostają po polsku na całą szerokość strony
      if (b.t === 'tytul' || b.t === 'podtytul' || b.t === 'p' || b.t === 'przypis') dodaj(b.tekst);
      else if (b.t === 'paragraf') dodaj(b.tytul);
      else if (b.t === 'lista') b.pozycje.forEach(dodaj);
      else if (b.t === 'pola') b.wiersze.forEach(function (w) { dodaj(w[0]); dodaj(w[1]); });
      else if (b.t === 'tabela') b.kolumny.forEach(dodaj);
      else if (b.t === 'podpisy') { dodaj(b.lewy); dodaj(b.prawy); }
      else if (b.t === 'pouczenie') { dodaj(b.tytul); b.akapity.forEach(dodaj); }
    });
    return {
      bloki: bloki, napisy: napisy, pl: pl,
      // tłumaczenie, które zgubiło albo dodało znacznik, jest odrzucane — zostaje polski oryginał
      tr: function (mapa) { return function (s) { var t = mapa[s]; if (!t || znaczniki(t) !== znaczniki(s)) t = s; return wstaw(t, trV); }; },
      braki: function (mapa) { return napisy.filter(function (s) { return !mapa[s] || znaczniki(mapa[s]) !== znaczniki(s); }); },
    };
  }

  return { zbuduj: zbuduj, poziomo: poziomo, wrap: wrap, dwujezycznie: dwujezycznie };
});
