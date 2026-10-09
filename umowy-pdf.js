/* Umowy — silnik PDF generatora umów (umowy.html): zamienia gotowy plik DOCX umowy na kopię PDF w przeglądarce.
 *
 * Czyta DOCX bez zewnętrznych bibliotek (własny czytnik ZIP + prosty parser XML), układa akapity i tabele
 * tak jak LibreOffice przy eksporcie do PDF (interlinia z metryk kroju, odstęp między akapitami = większy
 * z „po” i „przed”, wcięcia, tabulatory, justowanie ze ściskaniem odstępów, sieroty i wdowy, „razem
 * z następnym”, wiersze tabel dzielone między strony, znak wodny z nagłówka, stopka z numerami stron)
 * i rysuje je pdf-lib krojem Liberation Serif (metrycznie zgodny z Times New Roman).
 *
 * window.UmowyPdf / module.exports:
 *   zbuduj({ PDFLib, fontkit, fonts: { regular, bold, italic, boldItalic }, docx, tytul?, autor? })
 *       -> Promise<{ pdf: Uint8Array, strony: number, ostrzezenia: string[] }>
 *     fonts — pliki TTF (ArrayBuffer/Uint8Array); każdy krój dokumentu rysowany jest jednym z tych czterech
 *     docx  — bajty pliku .docx
 *   rozpakuj(docx) -> Promise<{ [nazwa]: Uint8Array }>   czytnik ZIP (katalog centralny; stored + deflate)
 *   tekst(documentXml) -> string   widoczny tekst treści: akapity rozdzielone "\n", tabulatory jako "\t"
 *
 * Zasada bezpieczeństwa: umowa nie może po cichu stracić treści. Element, którego silnik nie umie wiernie
 * narysować (pole tekstowe, obraz w treści, przypis, zmiana sekcji, scalone komórki…), przerywa pracę
 * błędem „PDF: nieobsługiwany element dokumentu — …”, a po narysowaniu wszystkie znaki faktycznie
 * wysłane do PDF są porównywane akapit po akapicie z tekst(document.xml) — różnica to błąd
 * „PDF: kontrola treści nie powiodła się …”.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UmowyPdf = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var EMU = 12700;              // jednostek EMU w punkcie
  var DEF_TAB = 708;            // domyślny tabulator (twipy), gdy settings.xml go nie podaje
  var SUP = 0.58, SUP_UP = 0.33, SUB_DOWN = 0.08;   // indeks górny/dolny: 58% wysokości pisma
  var EPS = 0.01;
  var SCISK = 0.25, SCISK_OPT = 0.42;   // justowanie: dopuszczalne ściśnięcie odstępu i próg „ściskać czy rozciągać” (skalibrowane na LibreOffice)
  var NIEWIDOCZNE = /[\s­​-‍﻿]/g;   // pomijane w kontroli treści
  var PUNKTOR = { '': '•', '': '▪', '': '–' };   // znaki kroju Symbol → Unicode

  function blad(co) { return new Error('PDF: nieobsługiwany element dokumentu — ' + co); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function tw(v) { return num(v) / 20; }   // twipy → punkty

  // ---------------- ZIP: katalog centralny, wpisy stored i deflate ----------------
  async function rozpakuj(docx) {
    var b = docx instanceof Uint8Array ? docx : new Uint8Array(docx);
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength), i = b.length - 22, out = {}, td = new TextDecoder('utf-8');
    while (i >= 0 && dv.getUint32(i, true) !== 0x06054b50) i--;
    if (i < 0) throw new Error('PDF: plik nie jest dokumentem DOCX (brak katalogu ZIP)');
    var n = dv.getUint16(i + 10, true), p = dv.getUint32(i + 16, true);
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('PDF: uszkodzony katalog ZIP w pliku DOCX');
      var flagi = dv.getUint16(p + 8, true), metoda = dv.getUint16(p + 10, true), rozmiar = dv.getUint32(p + 20, true);
      var nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      var nazwa = td.decode(b.subarray(p + 46, p + 46 + nl));
      if ((flagi & 1) || rozmiar === 0xFFFFFFFF || lo === 0xFFFFFFFF) throw new Error('PDF: nieobsługiwany plik DOCX (szyfrowanie albo ZIP64)');
      var od = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), dane = b.subarray(od, od + rozmiar);
      if (metoda === 0) out[nazwa] = dane.slice();
      else if (metoda === 8) out[nazwa] = new Uint8Array(await new Response(new Blob([dane]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else throw new Error('PDF: nieobsługiwana kompresja ZIP (' + metoda + ') w pliku DOCX');
      p += 46 + nl + el + cl;
    }
    return out;
  }

  // ---------------- XML: drzewo { n: nazwa, a: atrybuty, c: dzieci, t: własny tekst } ----------------
  var ENC = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  function ent(s) {
    return s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, function (m, e) {
      if (e[0] === '#') return String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENC[e] !== undefined ? ENC[e] : m;
    });
  }
  function xml(src) {
    var s = typeof src === 'string' ? src : new TextDecoder('utf-8').decode(src);
    var top = { n: '#', a: {}, c: [], t: '' }, stos = [top], m;
    var re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.\-]+)((?:\s+[\w:.\-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    while ((m = re.exec(s))) {
      var cur = stos[stos.length - 1];
      if (m[3]) {
        if (m[2]) { if (stos.length > 1) stos.pop(); continue; }
        var el = { n: m[3], a: {}, c: [], t: '' };
        if (m[4]) m[4].replace(/([\w:.\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, function (_, k, v1, v2) { el.a[k] = ent(v1 != null ? v1 : v2); return ''; });
        cur.c.push(el);
        if (!m[5]) stos.push(el);
      } else if (m[1] != null) cur.t += m[1];
      else if (m[6] != null) cur.t += ent(m[6]);
    }
    return top;
  }
  function kid(el, n) { if (el) for (var i = 0; i < el.c.length; i++) if (el.c[i].n === n) return el.c[i]; return null; }
  function kids(el, n) { return el ? el.c.filter(function (c) { return c.n === n; }) : []; }
  function val(el) { return el ? el.a['w:val'] : undefined; }
  function wl(el) { var v = val(el); return !!el && !(v === '0' || v === 'false' || v === 'off'); }   // <w:b/> = tak, w:val="0" = nie
  function szukaj(el, n) { for (var i = 0; el && i < el.c.length; i++) { var r = el.c[i].n === n ? el.c[i] : szukaj(el.c[i], n); if (r) return r; } return null; }

  // widoczny tekst treści, akapit po akapicie — niezależnie od silnika układu (wzorzec dla kontroli treści)
  var BEZ_TEKSTU = { 'w:pPr': 1, 'w:rPr': 1, 'w:tblPr': 1, 'w:tcPr': 1, 'w:trPr': 1, 'w:sectPr': 1, 'w:instrText': 1, 'w:delText': 1, 'w:del': 1, 'w:moveFrom': 1 };
  function akapity(drzewo) {
    var out = [];
    (function idz(el, cur) {
      el.c.forEach(function (c) {
        if (c.n === 'w:p') { var p = { s: '' }; out.push(p); idz(c, p); }
        else if (BEZ_TEKSTU[c.n]) return;
        else if (c.n === 'w:t') { if (cur) cur.s += c.t; }
        else if (c.n === 'w:tab') { if (cur) cur.s += '\t'; }
        else if (c.n === 'w:br' || c.n === 'w:cr') { if (cur) cur.s += '\n'; }
        else if (c.n === 'w:noBreakHyphen') { if (cur) cur.s += '-'; }
        else idz(c, cur);
      });
    })(kid(kid(drzewo, 'w:document'), 'w:body') || drzewo, null);
    return out.map(function (p) { return p.s; });
  }
  function tekst(documentXml) { return akapity(xml(documentXml)).join('\n'); }

  // ---------------- właściwości znaków i akapitów ----------------
  var R_ZLE = { 'w:caps': 1, 'w:smallCaps': 1, 'w:dstrike': 1, 'w:vanish': 1, 'w:outline': 1, 'w:shadow': 1, 'w:emboss': 1, 'w:imprint': 1, 'w:specVanish': 1, 'w:webHidden': 1 };
  function wypelnienie(shd) {   // w:shd → kolor tła (hex) albo null
    var f = shd && shd.a['w:fill'];
    if (shd && val(shd) && val(shd) !== 'clear' && val(shd) !== 'nil') throw blad('deseń wypełnienia (w:shd ' + val(shd) + ')');
    return f && /^[0-9a-f]{6}$/i.test(f) && !/^ffffff$/i.test(f) ? f : null;
  }
  function znaki(el, baza, S) {   // w:rPr → { b, i, u, strike, sz, color, va }
    var o = Object.assign({}, baza);
    if (!el) return o;
    var rs = kid(el, 'w:rStyle');
    if (rs && S) Object.assign(o, S.znakowy(val(rs)));
    el.c.forEach(function (c) {
      var v = val(c);
      switch (c.n) {
        case 'w:b': o.b = wl(c); break;
        case 'w:i': o.i = wl(c); break;
        case 'w:strike': o.strike = wl(c); break;
        case 'w:u': o.u = !!v && v !== 'none'; break;
        case 'w:sz': o.sz = num(v) / 2; break;
        case 'w:color': o.color = /^[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : null; break;
        case 'w:vertAlign': o.va = v === 'superscript' ? 1 : v === 'subscript' ? -1 : 0; break;
        case 'w:highlight': if (v && v !== 'none') throw blad('wyróżnienie tekstu kolorem'); break;
        case 'w:spacing': case 'w:position': if (num(v)) throw blad('rozstrzelenie lub przesunięcie znaków (' + c.n + ')'); break;
        case 'w:w': if (v && num(v) !== 100) throw blad('skalowanie szerokości znaków'); break;
        case 'w:shd': if (wypelnienie(c)) throw blad('tło pod tekstem'); break;
        default: if (R_ZLE[c.n] && wl(c)) throw blad('formatowanie znaków ' + c.n);
      }
    });
    return o;
  }
  function ramka(b) {   // krawędź → { w (pt), c (hex) } | 0 (wyraźnie brak) | undefined (nie podano)
    if (!b) return undefined;
    var v = val(b), sz = num(b.a['w:sz']), c = b.a['w:color'] || '';
    if (!v || v === 'nil' || v === 'none' || !sz) return 0;
    return { w: sz / 8, c: /^[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '000000', inna: v !== 'single' ? v : null };
  }
  function bok(n) { n = n.slice(2); return n === 'start' ? 'left' : n === 'end' ? 'right' : n; }
  function akapitowe(el, baza) {   // w:pPr → { jc, left, right, first, before, after, line, rule, keepNext, keepLines, pbb, widow, tabs, numId, ilvl }
    var o = Object.assign({}, baza);
    if (!el) return o;
    el.c.forEach(function (c) {
      var a = c.a, v = val(c);
      switch (c.n) {
        case 'w:jc': o.jc = v === 'both' || v === 'distribute' ? 'both' : v === 'center' ? 'center' : v === 'right' || v === 'end' ? 'right' : 'left'; break;
        case 'w:ind':
          if (a['w:left'] != null || a['w:start'] != null) o.left = tw(a['w:left'] != null ? a['w:left'] : a['w:start']);
          if (a['w:right'] != null || a['w:end'] != null) o.right = tw(a['w:right'] != null ? a['w:right'] : a['w:end']);
          if (a['w:hanging'] != null) o.first = -tw(a['w:hanging']); else if (a['w:firstLine'] != null) o.first = tw(a['w:firstLine']);
          break;
        case 'w:spacing':
          if (a['w:before'] != null) o.before = tw(a['w:before']);
          if (a['w:after'] != null) o.after = tw(a['w:after']);
          if (a['w:line'] != null) o.line = num(a['w:line']);
          if (a['w:lineRule']) o.rule = a['w:lineRule'];
          break;
        case 'w:keepNext': o.keepNext = wl(c); break;
        case 'w:keepLines': o.keepLines = wl(c); break;
        case 'w:pageBreakBefore': o.pbb = wl(c); break;
        case 'w:widowControl': o.widow = wl(c); break;
        case 'w:tabs':
          o.tabs = (o.tabs || []).slice();
          kids(c, 'w:tab').forEach(function (t) {
            var pos = tw(t.a['w:pos']), ld = t.a['w:leader'];
            o.tabs = o.tabs.filter(function (x) { return Math.abs(x - pos) > EPS; });
            if (val(t) === 'clear') return;
            if (!/^(left|start|num)$/.test(val(t)) || (ld && ld !== 'none')) throw blad('tabulator „' + val(t) + '”' + (ld ? ' z wypełnieniem' : ''));
            o.tabs.push(pos);
          });
          break;
        case 'w:numPr': o.numId = val(kid(c, 'w:numId')); o.ilvl = +(val(kid(c, 'w:ilvl')) || 0); break;
        case 'w:pBdr': c.c.forEach(function (b) { if (ramka(b)) throw blad('obramowanie akapitu'); }); break;
        case 'w:shd': if (wypelnienie(c)) throw blad('cieniowanie akapitu'); break;
        case 'w:framePr': throw blad('ramka tekstowa akapitu');
        case 'w:sectPr': throw blad('zmiana sekcji wewnątrz dokumentu');
        case 'w:bidi': case 'w:textDirection': if (c.n === 'w:textDirection' || wl(c)) throw blad('kierunek tekstu ' + c.n); break;
      }
    });
    return o;
  }

  // styles.xml: wartości domyślne, style akapitów (basedOn), znaków i tabel
  function style(drzewo) {
    var st = {}, dom = {}, dR = { sz: 10 }, dP = {}, pam = {}, S;
    var rt = kid(drzewo, 'w:styles'), dd = kid(rt, 'w:docDefaults');
    kids(rt, 'w:style').forEach(function (s) { st[s.a['w:styleId']] = s; if (/^(1|true|on)$/.test(s.a['w:default'] || '')) dom[s.a['w:type']] = s.a['w:styleId']; });
    function lancuch(id) { var out = [], g = 0; while (id && st[id] && g++ < 20) { out.unshift(st[id]); id = val(kid(st[id], 'w:basedOn')); } return out; }
    S = {
      akapit: function (id) {
        id = id && st[id] ? id : dom.paragraph;
        if (pam['p' + id]) return pam['p' + id];
        var p = dP, r = dR;
        lancuch(id).forEach(function (s) { p = akapitowe(kid(s, 'w:pPr'), p); r = znaki(kid(s, 'w:rPr'), r, S); });
        return (pam['p' + id] = { p: p, r: r });
      },
      znakowy: function (id) { var r = {}; lancuch(id).forEach(function (s) { r = znaki(kid(s, 'w:rPr'), r, null); }); return r; },
      tabela: function (id) {
        var o = { ram: {}, mar: { top: 0, left: 5.4, bottom: 0, right: 5.4 } };
        lancuch(id && st[id] ? id : dom.table).forEach(function (s) {
          if (kid(s, 'w:tblStylePr') || (kid(s, 'w:pPr') || { c: [] }).c.length || (kid(s, 'w:rPr') || { c: [] }).c.length) throw blad('styl tabeli z formatowaniem tekstu lub warunkowym („' + s.a['w:styleId'] + '”)');
          var pr = kid(s, 'w:tblPr');
          o.ram = ramki(kid(pr, 'w:tblBorders'), o.ram); o.mar = marginesy(kid(pr, 'w:tblCellMar'), o.mar);
        });
        return o;
      },
    };
    dR = znaki(kid(kid(dd, 'w:rPrDefault'), 'w:rPr'), dR, S);
    dP = akapitowe(kid(kid(dd, 'w:pPrDefault'), 'w:pPr'), dP);
    return S;
  }
  function ramki(el, baza) { var o = Object.assign({}, baza); if (el) el.c.forEach(function (c) { var r = ramka(c); if (r !== undefined) o[bok(c.n)] = r; }); return o; }
  function marginesy(el, baza) { var o = Object.assign({}, baza); if (el) el.c.forEach(function (c) { if (c.a['w:w'] != null) o[bok(c.n)] = tw(c.a['w:w']); }); return o; }

  // numbering.xml: listy numerowane i punktowane (w:numPr)
  function rzymska(n) { var r = '', t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; t.forEach(function (p) { while (n >= p[0]) { r += p[1]; n -= p[0]; } }); return r; }
  function litera(n) { var s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(97 + (n - 1) % 26) + s; return s; }
  function numeracja(drzewo) {
    var abs = {}, nums = {}, licz = {}, widziane = {}, rt = kid(drzewo, 'w:numbering');
    kids(rt, 'w:abstractNum').forEach(function (a) { var l = {}; kids(a, 'w:lvl').forEach(function (v) { l[+v.a['w:ilvl']] = v; }); abs[a.a['w:abstractNumId']] = l; });
    kids(rt, 'w:num').forEach(function (n) { nums[n.a['w:numId']] = n; });
    function poziom(numId, ilvl) {
      var n = nums[numId], aid = val(kid(n, 'w:abstractNumId')), lv = abs[aid] && abs[aid][ilvl];
      var ov = kids(n, 'w:lvlOverride').filter(function (o) { return +o.a['w:ilvl'] === ilvl; })[0], so = kid(ov, 'w:startOverride');
      if (kid(ov, 'w:lvl')) lv = kid(ov, 'w:lvl');
      return lv ? { lv: lv, aid: aid, start: so ? num(val(so)) : null } : null;
    }
    function zapis(fmt, n) {
      switch (fmt || 'decimal') {
        case 'decimal': return String(n);
        case 'lowerLetter': return litera(n);
        case 'upperLetter': return litera(n).toUpperCase();
        case 'lowerRoman': return rzymska(n);
        case 'upperRoman': return rzymska(n).toUpperCase();
        case 'none': case 'bullet': return '';
      }
      throw blad('format numeracji „' + fmt + '”');
    }
    function etykieta(numId, ilvl) {
      var p = poziom(numId, ilvl), c, klucz = numId + '/' + ilvl;
      if (!p) throw blad('numeracja automatyczna (numId ' + numId + ', poziom ' + ilvl + ') bez definicji w numbering.xml');
      c = licz[p.aid] || (licz[p.aid] = []);
      if (p.start != null && !widziane[klucz]) c[ilvl] = p.start - 1;
      widziane[klucz] = 1;
      for (var j = 0; j <= ilvl; j++) if (c[j] == null) { var q = poziom(numId, j); c[j] = (q && kid(q.lv, 'w:start') ? num(val(kid(q.lv, 'w:start'))) : 1) - (j === ilvl ? 1 : 0); }
      c[ilvl]++; c.length = ilvl + 1;
      var wzor = val(kid(p.lv, 'w:lvlText')) || '';
      wzor = wzor.replace(/%(\d)/g, function (_, k) { var q = poziom(numId, k - 1); return zapis(q && val(kid(q.lv, 'w:numFmt')), c[k - 1]); });
      return { s: wzor.replace(/[-]/g, function (ch) { return PUNKTOR[ch] || ch; }), po: val(kid(p.lv, 'w:suff')) || 'tab', rPr: kid(p.lv, 'w:rPr') };
    }
    return { poziom: poziom, etykieta: etykieta };
  }

  // ---------------- model dokumentu: akapity i tabele ----------------
  var INNE = { 'w:drawing': 'obraz w treści dokumentu', 'w:pict': 'obraz lub kształt (w:pict)', 'w:object': 'obiekt osadzony', 'mc:AlternateContent': 'pole tekstowe lub kształt',
    'w:footnoteReference': 'przypis dolny', 'w:endnoteReference': 'przypis końcowy', 'w:sym': 'znak specjalny (w:sym)', 'w:delText': 'śledzenie zmian', 'w:del': 'śledzenie zmian',
    'w:moveFrom': 'śledzenie zmian', 'w:moveTo': 'śledzenie zmian', 'w:sdt': 'kontrolka zawartości (w:sdt)', 'w:fldSimple': 'pole (w:fldSimple) w treści dokumentu' };
  var P_POMIN = /^w:(pPr|bookmarkStart|bookmarkEnd|proofErr|commentRangeStart|commentRangeEnd|permStart|permEnd)$/;
  var R_POMIN = /^w:(rPr|lastRenderedPageBreak|softHyphen|commentReference|annotationRef)$/;

  // D = { S, N, cialo (treść czy nagłówek/stopka), n (licznik akapitów treści), obrazy, rels }
  function akapit(p, D) {
    var pe = kid(p, 'w:pPr'), st = D.S.akapit(val(kid(pe, 'w:pStyle'))), pp = akapitowe(pe, st.p);
    var lv = pp.numId && pp.numId !== '0' ? D.N.poziom(pp.numId, pp.ilvl) : null;
    if (pp.numId && pp.numId !== '0' && !lv) throw blad('numeracja automatyczna (numId ' + pp.numId + ') bez definicji w numbering.xml');
    if (lv) pp = akapitowe(pe, akapitowe(kid(lv.lv, 'w:pPr'), st.p));   // styl < numeracja < akapit
    var A = { k: 'p', pp: pp, items: [], mark: znaki(kid(pe, 'w:rPr'), st.r, D.S), idx: D.cialo ? D.n++ : -1 }, pole = null;
    if (lv) {
      var et = D.N.etykieta(pp.numId, pp.ilvl), er = znaki(et.rPr, A.mark, D.S);
      A.items.push({ t: 'text', s: et.s, r: er, lab: true });
      if (et.po === 'tab') A.items.push({ t: 'tab', r: er }); else if (et.po === 'space') A.items.push({ t: 'text', s: ' ', r: er, lab: true });
    }
    function napis(s, r) {
      s.replace(/[\r\n]+/g, ' ').split('\t').forEach(function (cz, i) { if (i) A.items.push({ t: 'tab', r: r }); if (cz) A.items.push({ t: 'text', s: cz, r: r }); });
    }
    function bieg(r) {
      var rp = znaki(kid(r, 'w:rPr'), st.r, D.S);
      r.c.forEach(function (c) {
        if (R_POMIN.test(c.n)) return;
        switch (c.n) {
          case 'w:t': if (!pole) napis(c.t, rp); break;   // tekst między „separate” a „end” to stary wynik pola
          case 'w:tab': A.items.push({ t: 'tab', r: rp }); break;
          case 'w:noBreakHyphen': napis('-', rp); break;
          case 'w:br': case 'w:cr':
            if (c.a['w:type'] === 'column') throw blad('podział kolumny');
            A.items.push(c.a['w:type'] === 'page' ? { t: 'strona' } : { t: 'br', r: rp });
            break;
          case 'w:fldChar':
            if (D.cialo) throw blad('pole (w:fldChar) w treści dokumentu');
            if (c.a['w:fldCharType'] === 'begin') pole = { s: '', r: rp };
            else if (c.a['w:fldCharType'] === 'end' && pole) {
              var co = pole.s.trim().split(/\s+/)[0].toUpperCase();
              if (co !== 'PAGE' && co !== 'NUMPAGES') throw blad('pole „' + co + '”');
              A.items.push({ t: 'pole', co: co, r: pole.r }); pole = null;
            }
            break;
          case 'w:instrText': if (pole) pole.s += c.t; break;
          case 'w:drawing': if (D.cialo) throw blad(INNE[c.n]); D.obrazy.push(kotwica(c, D)); break;
          default: throw blad(INNE[c.n] || 'element tekstu ' + c.n);
        }
      });
    }
    (function idz(el) {
      el.c.forEach(function (c) {
        if (c.n === 'w:r') bieg(c);
        else if (c.n === 'w:hyperlink' || c.n === 'w:smartTag' || c.n === 'w:ins') idz(c);
        else if (!P_POMIN.test(c.n)) throw blad(INNE[c.n] || 'element akapitu ' + c.n);
      });
    })(p);
    return A;
  }
  // obraz zakotwiczony w nagłówku/stopce (znak wodny): rozmiar i położenie względem strony lub marginesów
  function kotwica(dr, D) {
    var an = kid(dr, 'wp:anchor'), blip = szukaj(an, 'a:blip'), ext = kid(an, 'wp:extent'), rel = blip && D.rels[blip.a['r:embed']];
    if (!an || !ext || !rel) throw blad('obraz w nagłówku lub stopce inny niż zakotwiczony obrazek');
    function poz(el) { var al = kid(el, 'wp:align'), off = kid(el, 'wp:posOffset'); return { rf: el ? el.a.relativeFrom : 'page', al: al ? al.t.trim() : null, off: off ? num(off.t) / EMU : 0 }; }
    return { w: num(ext.a.cx) / EMU, h: num(ext.a.cy) / EMU, H: poz(kid(an, 'wp:positionH')), V: poz(kid(an, 'wp:positionV')), plik: rel.cel };
  }
  function bloki(el, D, wKomorce) {   // dzieci w:body, w:tc, w:hdr, w:ftr
    var out = [];
    el.c.forEach(function (c) {
      if (c.n === 'w:p') out.push(akapit(c, D));
      else if (c.n === 'w:tbl') { if (wKomorce) throw blad('tabela zagnieżdżona w komórce'); out.push(tabela(c, D)); }
      else if (!/^w:(sectPr|tcPr|bookmarkStart|bookmarkEnd)$/.test(c.n)) throw blad(INNE[c.n] || 'element ' + c.n);
    });
    return out;
  }
  function tabela(t, D) {
    var pr = kid(t, 'w:tblPr'), ts = D.S.tabela(val(kid(pr, 'w:tblStyle'))), tb = ramki(kid(pr, 'w:tblBorders'), ts.ram), tm = marginesy(kid(pr, 'w:tblCellMar'), ts.mar);
    var grid = kids(kid(t, 'w:tblGrid'), 'w:gridCol').map(function (g) { return tw(g.a['w:w']); }), ind = kid(pr, 'w:tblInd'), trs = kids(t, 'w:tr');
    if (kid(pr, 'w:tblpPr')) throw blad('tabela pływająca (opływana tekstem)');
    if (num((kid(pr, 'w:tblCellSpacing') || { a: {} }).a['w:w'])) throw blad('odstępy między komórkami tabeli');
    if (!grid.length) throw blad('tabela bez siatki kolumn (w:tblGrid)');
    t.c.forEach(function (c) { if (!/^w:(tblPr|tblGrid|tr|bookmarkStart|bookmarkEnd)$/.test(c.n)) throw blad(INNE[c.n] || 'element tabeli ' + c.n); });
    var T = { k: 't', grid: grid, rows: [], ind: ind && ind.a['w:type'] !== 'pct' ? tw(ind.a['w:w']) : 0, jc: val(kid(pr, 'w:jc')) };
    trs.forEach(function (tr, ri) {
      var trp = kid(tr, 'w:trPr'), hh = kid(trp, 'w:trHeight'), g = 0;
      var row = { cells: [], cant: wl(kid(trp, 'w:cantSplit')), head: wl(kid(trp, 'w:tblHeader')), minH: hh ? tw(val(hh)) : 0 };
      if (num(val(kid(trp, 'w:gridBefore'))) || num(val(kid(trp, 'w:gridAfter')))) throw blad('wiersz tabeli z pominiętymi kolumnami');
      tr.c.forEach(function (tc) {
        if (tc.n !== 'w:tc') { if (!/^w:(trPr|tblPrEx|bookmarkStart|bookmarkEnd)$/.test(tc.n)) throw blad(INNE[tc.n] || 'element wiersza tabeli ' + tc.n); return; }
        var cp = kid(tc, 'w:tcPr'), span = +(val(kid(cp, 'w:gridSpan')) || 1), own = ramki(kid(cp, 'w:tcBorders'), {});
        if (kid(cp, 'w:vMerge') || kid(cp, 'w:hMerge')) throw blad('komórki tabeli scalone w pionie');
        if (kid(cp, 'w:textDirection')) throw blad('obrócony tekst w komórce');
        if (g + span > grid.length) throw blad('tabela o wierszach szerszych niż siatka kolumn');
        function kr(b, zewn, wewn) { return own[b] !== undefined ? own[b] : (zewn ? tb[b] : tb[wewn]); }   // brak własnej krawędzi → krawędź tabeli
        row.cells.push({
          g: g, span: span, m: marginesy(kid(cp, 'w:tcMar'), tm), fill: wypelnienie(kid(cp, 'w:shd')), va: val(kid(cp, 'w:vAlign')),
          b: { top: kr('top', !ri, 'insideH'), bottom: kr('bottom', ri === trs.length - 1, 'insideH'), left: kr('left', !g, 'insideV'), right: kr('right', g + span === grid.length, 'insideV') },
          bloki: bloki(tc, D, true),
        });
        g += span;
      });
      if (!row.cells.length) throw blad('pusty wiersz tabeli');
      T.rows.push(row);
    });
    return T;
  }

  // ---------------- łamanie akapitu na wiersze ----------------
  // wysokość pojedynczej interlinii jak w LibreOffice: (ascent + descent + lineGap) kroju, zaokrąglona w górę do twipa
  function pojedyncza(f, sz) { return Math.ceil(sz * 20 * f.k - 1e-6) / 20; }
  // miejsce podziału wiersza wewnątrz „słowa”: po łączniku, półpauzie lub ukośniku, gdy dalej stoi litera
  function podzial(a, b) { return (a === '-' || a === '/' || a === '‐' || a === '–' || a === '—') && /\p{L}/u.test(b); }

  function format(r) { return r.klucz || (r.klucz = [r.b ? 1 : 0, r.i ? 1 : 0, r.u ? 1 : 0, r.strike ? 1 : 0, r.sz, r.color || '', r.va || 0].join('|')); }

  function lamanie(A, W, L) {
    var pp = A.pp, left = pp.left || 0, limit = W - (pp.right || 0), lines = [], cur, slowo = null, poBr = false;
    var tabs = (pp.tabs || []).slice().sort(function (a, b) { return a - b; });
    function nowa(x) { cur = { segs: [], x: x, end: x, od: 0, ma: false }; }
    function zamknij(zawin) {
      var s = cur.segs, h1 = 0, asc = 0, d, k = 0;
      (s.length ? s : [{ f: L.kroj(A.mark), sz: A.mark.sz }]).forEach(function (g) { h1 = Math.max(h1, pojedyncza(g.f, g.sz)); asc = Math.max(asc, g.f.asc * g.sz); });
      var h = pp.rule === 'exact' ? (pp.line || 240) / 20 : pp.rule === 'atLeast' ? Math.max(h1, (pp.line || 0) / 20) : Math.round(h1 * 20 * (pp.line || 240) / 240) / 20;
      if (pp.jc === 'center' || pp.jc === 'right') { d = (limit - cur.end) * (pp.jc === 'center' ? 0.5 : 1); s.forEach(function (g) { g.x += d; }); }
      else if (pp.jc === 'both' && (zawin || cur.end > limit + EPS)) {   // justowanie: nadwyżka (albo niedobór) rozłożona na odstępy po ostatnim tabulatorze
        var sp = odstepy();
        d = sp.length ? (limit - cur.end) / sp.length : 0;
        s.forEach(function (g) { g.x += k; if (d && sp.indexOf(g) >= 0) { g.w += d; k += d; } });
      }
      lines.push({ segs: s, h: h, fit: Math.min(h, h1), base: asc + (pp.rule === 'exact' || pp.rule === 'atLeast' ? Math.max(0, h - h1) : 0) });
      nowa(left);
    }
    function odstepy() { return cur.segs.filter(function (g, i) { return g.sp && i >= cur.od && g.x < cur.end - 0.001; }); }
    function wstaw(c, sp) { cur.segs.push({ x: cur.x, w: c.w, nw: c.w, s: c.s, o: c.o, r: c.r, f: c.f, size: c.size, sz: c.r.sz, sp: sp }); cur.x += c.w; }
    function poloz(wd) {
      if (cur.ma && cur.x + wd.w > limit + EPS) {
        // „smart justify” (Word 2013+, LibreOffice): w wierszu justowanym bez tabulatora odstępy wolno ścisnąć o ćwierć
        // szerokości (w pełnych twipach), by zmieścić jeszcze jedno słowo — o ile ściśnięcie przypadające na odstęp
        // jest wyraźnie mniejsze niż rozciągnięcie, które powstałoby bez tego słowa
        // (LibreOffice liczy przy tym tylko odstępy ostatniego fragmentu o jednolitym formacie)
        var luz = 0, o = cur.x + wd.w - limit, zapas = limit - cur.end, n = 0, maks = 0, fk = format(wd.parts[0].r);
        if (pp.jc === 'both' && !cur.od && zapas > 0) {
          cur.segs.forEach(function (g) { if (g.sp) n++; });
          for (var q = cur.segs.length - 1; q >= 0 && format(cur.segs[q].r) === fk; q--) if (cur.segs[q].sp) maks += Math.floor(cur.segs[q].nw * 20 * SCISK) / 20;
          if (o <= maks + EPS && (n < 2 || o / n <= SCISK_OPT * zapas / (n - 1))) luz = o;
        }
        if (o - luz > EPS) zamknij(true);
      }
      if (!cur.ma && wd.w > limit - cur.x + EPS && wd.n > 1) {   // słowo dłuższe niż wiersz — dzielone po znakach
        wd.parts.forEach(function (p) { for (var ch of p.src) { var c = L.czesc(ch, p.r, p.lab); poloz({ parts: [c], w: c.w, n: 1 }); } });
        return;
      }
      wd.parts.forEach(function (p) { wstaw(p, false); });
      cur.ma = true; cur.end = cur.x;
    }
    function oddaj() { if (slowo) { var w = slowo; slowo = null; poloz(w); } }
    function kawalek(t, r, lab) {
      if (slowo && podzial(slowo.ost, t[0])) oddaj();
      if (!slowo) slowo = { parts: [], w: 0, n: 0 };
      var c = L.czesc(t, r, lab);
      slowo.parts.push(c); slowo.w += c.w; slowo.n += t.length; slowo.ost = t[t.length - 1];
    }
    function napis(s, r, lab) {
      var re = / +|[^ ]+/g, m;
      while ((m = re.exec(s))) {
        var t = m[0], a = 0;
        if (t[0] === ' ') { oddaj(); wstaw(L.czesc(t, r, lab), true); continue; }   // odstępy na końcu wiersza „wiszą” poza marginesem
        for (var i = 1; i <= t.length; i++) if (i === t.length || podzial(t[i - 1], t[i])) { kawalek(t.slice(a, i), r, lab); a = i; }
      }
    }
    function tab(r) {
      var x = cur.x + EPS, t = null;
      for (var i = 0; i < tabs.length; i++) if (tabs[i] > x) { t = tabs[i]; break; }
      if ((pp.first || 0) < 0 && left > x && (t == null || left < t)) t = left;   // wysunięcie: niejawny tabulator na wcięciu akapitu
      if (t == null) t = (Math.floor(x / L.tab) + 1) * L.tab;
      cur.segs.push({ x: cur.x, w: t - cur.x, nw: -1, s: '', o: '', r: r, f: L.kroj(r), size: r.sz, sz: r.sz, tab: true });
      cur.x = cur.end = t; cur.ma = true; cur.od = cur.segs.length;
    }
    nowa(left + (pp.first || 0));
    A.items.forEach(function (it) {
      if (it.t === 'text') { napis(it.s, it.r, it.lab); poBr = false; }
      else if (it.t === 'pole') { kawalek(String(L.strona[it.co]), it.r, true); poBr = false; }
      else if (it.t === 'tab') { oddaj(); tab(it.r); poBr = false; }
      else { oddaj(); zamknij(false); poBr = it.t === 'br'; if (it.t === 'strona') lines[lines.length - 1].lam = true; }
    });
    oddaj();
    if (cur.segs.length || !lines.length || poBr) zamknij(false);
    return lines;
  }

  // rysuje jeden wiersz tekstu; x = lewa krawędź obszaru akapitu, y = górna krawędź wiersza (od góry strony)
  function linia(pg, ln, x, y, idx, L) {
    var s = ln.segs, i = 0, by = L.PH - y - ln.base;
    while (i < s.length) {
      var a = s[i], txt = a.s, nw = a.nw, j = i + 1;
      // sąsiednie kawałki tego samego formatu, stykające się naturalnie, idą jednym poleceniem
      while (j < s.length && !a.tab && !s[j].tab && s[j].r === a.r && Math.abs(s[j].x - (a.x + nw)) < 0.004) { txt += s[j].s; nw += s[j].nw; j++; }
      var r = a.r, sz = r.sz, kon = s[j - 1].x + s[j - 1].w, kol = L.kolor(r.color || '000000');
      var yy = by + (r.va > 0 ? sz * SUP_UP : r.va < 0 ? -sz * SUB_DOWN : 0);
      if (idx >= 0 && !L.cicho) for (var k = i; k < j; k++) L.zapis[idx] += s[k].o;
      if (txt.trim()) pg.drawText(txt, { x: x + a.x, y: yy, size: a.size, font: a.f.font, color: kol });
      if (r.u) pg.drawLine({ start: { x: x + a.x, y: by - sz * 0.11 }, end: { x: x + kon, y: by - sz * 0.11 }, thickness: sz * 0.05, color: kol });
      if (r.strike) pg.drawLine({ start: { x: x + a.x, y: by + sz * 0.26 }, end: { x: x + kon, y: by + sz * 0.26 }, thickness: sz * 0.05, color: kol });
      i = j;
    }
  }

  // ---------------- jednostki układu: wiersz tekstu albo wiersz tabeli ----------------
  // { h, gap (odstęp przed), keep (trzymaj z następną), przed (zacznij od nowej strony), rysuj(pg, x, y), dziel?(miejsce) }
  function jednostki(bl, W, L) {
    var U = [], po = 0, lam = false;
    bl.forEach(function (b) {
      if (b.k === 't') {
        wiersze(b, W, L).forEach(function (u, i) { if (!i) { u.gap = po; u.przed = lam; } U.push(u); });
        po = 0; lam = false; return;
      }
      var lines = lamanie(b, W, L), pp = b.pp, n = lines.length, wd = pp.widow !== false;
      lines.forEach(function (ln, i) {
        U.push({
          h: ln.h, fit: ln.fit, gap: i ? 0 : Math.max(po, pp.before || 0), wlasny: i ? 0 : pp.before || 0, przed: i ? !!lines[i - 1].lam : (lam || !!pp.pbb),
          // sieroty i wdowy: pierwsze dwa i ostatnie dwa wiersze akapitu zostają razem
          keep: !ln.lam && (i < n - 1 ? !!(pp.keepLines || (wd && (i === 0 || i === n - 2))) : !!pp.keepNext),
          rysuj: function (pg, x, y) { linia(pg, ln, x, y, b.idx, L); },
        });
      });
      po = pp.after || 0; lam = !!lines[n - 1].lam;
    });
    return { U: U, po: po };
  }
  function lepsza(a, b) {   // krawędź wspólna dwóch komórek: szersza, a przy równych — ciemniejsza
    if (!a) return b || null;
    if (!b) return a;
    if (a.w !== b.w) return a.w > b.w ? a : b;
    function jasnosc(c) { return parseInt(c.slice(0, 2), 16) + parseInt(c.slice(2, 4), 16) + parseInt(c.slice(4, 6), 16); }
    return jasnosc(a.c) <= jasnosc(b.c) ? a : b;
  }
  function gr(e) { return e ? e.w : 0; }
  function wiersze(T, W, L) {
    var g = T.grid, xs = [0], out = [];
    g.forEach(function (w) { xs.push(xs[xs.length - 1] + w); });
    var szer = xs[g.length], x0 = T.jc === 'center' ? (W - szer) / 2 : T.jc === 'right' || T.jc === 'end' ? W - szer : T.ind;
    T.rows.forEach(function (row) { row.kol = []; row.cells.forEach(function (c) { for (var i = 0; i < c.span; i++) row.kol[c.g + i] = c; }); });
    function kr(row, i, b) { var c = row && row.kol[i]; return c ? c.b[b] : null; }
    function kreska(pg, e, x1, y1, x2, y2) {
      if (!e) return;
      if (e.inna) L.ostrz('Obramowanie tabeli „' + e.inna + '” narysowano linią ciągłą.');
      var d = y1 === y2 ? e.w / 2 : 0;   // linie poziome wydłużone o pół grubości — pełne narożniki
      pg.drawLine({ start: { x: x1 - d, y: L.PH - y1 }, end: { x: x2 + d, y: L.PH - y2 }, thickness: e.w, color: L.kolor(e.c) });
    }
    function wiersz(row, parts, pocz, kon) {   // parts[i] — jednostki i-tej komórki; pocz/kon — czy to początek/koniec wiersza
      var hs = row.cells.map(function (c, ci) { return parts[ci].reduce(function (s, u, k) { return s + (k || pocz ? u.gap : 0) + u.h; }, 0) + (kon ? c.j.po : 0); });
      // w:trHeight liczone jak w LibreOffice: najmniejsza wysokość zawartości, marginesy komórki i krawędź dochodzą osobno
      var h = Math.max.apply(null, row.cells.map(function (c, ci) { return row.bt + c.m.top + Math.max(hs[ci], pocz && kon ? row.minH : 0) + c.m.bottom; })) + row.bb;
      return {
        h: h, fit: h, gap: 0, keep: false, przed: false, tab: T,
        rysuj: function (pg, x, y, naGorze) {   // naGorze: pierwszy na stronie — górna krawędź własna, bez krawędzi wiersza z poprzedniej strony
          var X = x + x0, i, e;
          row.cells.forEach(function (c) { if (c.fill) pg.drawRectangle({ x: X + c.x, y: L.PH - y - h, width: c.w, height: h, color: L.kolor(c.fill) }); });
          row.cells.forEach(function (c, ci) {
            var wolne = h - row.bb - row.bt - c.m.top - c.m.bottom - hs[ci], yy = y + row.bt + c.m.top + (c.va === 'center' ? wolne / 2 : c.va === 'bottom' ? wolne : 0);
            parts[ci].forEach(function (u, k) { yy += k || pocz ? u.gap : 0; u.rysuj(pg, X + c.x + c.il, yy); yy += u.h; });
          });
          for (i = 0; i < g.length; i++) {
            e = naGorze ? kr(row, i, 'top') : row.gora[i];
            kreska(pg, e, X + xs[i], y + gr(e) / 2, X + xs[i + 1], y + gr(e) / 2);
            kreska(pg, row.dol[i], X + xs[i], y + h + (row.bb ? -1 : 1) * gr(row.dol[i]) / 2, X + xs[i + 1], y + h + (row.bb ? -1 : 1) * gr(row.dol[i]) / 2);
          }
          for (i = 0; i <= g.length; i++) kreska(pg, row.pion[i], X + xs[i], y, X + xs[i], y + h);
        },
        // podział wiersza między strony: każda komórka oddaje tyle wierszy tekstu, ile się mieści
        dziel: row.cant ? null : function (miejsce) {
          var a = [], b = [], ok = true;
          row.cells.forEach(function (c, ci) {
            var us = parts[ci], wolne = miejsce - row.bt - c.m.top - c.m.bottom - row.bb, yy = 0, k = 0;
            while (k < us.length && yy + (k || pocz ? us[k].gap : 0) + us[k].h <= wolne + EPS) { yy += (k || pocz ? us[k].gap : 0) + us[k].h; k++; }
            while (k > 0 && k < us.length && us[k - 1].keep) k--;
            if (us.length && !k) ok = false;
            a.push(us.slice(0, k)); b.push(us.slice(k));
          });
          if (!ok || b.every(function (us) { return !us.length; })) return null;
          return [wiersz(row, a, pocz, false), wiersz(row, b, false, kon)];
        },
      };
    }
    T.rows.forEach(function (row, ri) {
      var prev = T.rows[ri - 1], next = T.rows[ri + 1], i;
      row.gora = []; row.dol = []; row.pion = [];
      for (i = 0; i < g.length; i++) { row.gora[i] = lepsza(kr(row, i, 'top'), kr(prev, i, 'bottom')); row.dol[i] = lepsza(kr(row, i, 'bottom'), kr(next, i, 'top')); }
      for (i = 0; i <= g.length; i++) { var a = row.kol[i - 1], b = row.kol[i]; row.pion[i] = a === b ? null : lepsza(a && a.b.right, b && b.b.left); }
      // jak w LibreOffice: wiersz zawiera swoją górną krawędź, ostatni także dolną; boczne krawędzie zabierają po pół grubości
      row.bt = Math.max.apply(null, row.gora.map(gr)); row.bb = next ? 0 : Math.max.apply(null, row.dol.map(gr));
      row.cells.forEach(function (c) {
        c.x = xs[c.g]; c.w = xs[c.g + c.span] - c.x;
        c.il = c.m.left + gr(row.pion[c.g]) / 2;
        c.j = jednostki(c.bloki, c.w - c.il - c.m.right - gr(row.pion[c.g + c.span]) / 2, L);
      });
      out.push(wiersz(row, row.cells.map(function (c) { return c.j.U; }), true, true));
    });
    T.glowa = []; for (var i = 0; i < T.rows.length && T.rows[i].head; i++) T.glowa.push(out[i]);   // w:tblHeader — wiersze powtarzane na kolejnych stronach
    return out;
  }

  // ---------------- dokument ----------------
  function relacje(bajty) {
    var o = {};
    if (bajty) kids(kid(xml(bajty), 'Relationships'), 'Relationship').forEach(function (r) { o[r.a.Id] = { typ: (r.a.Type || '').split('/').pop(), cel: r.a.Target || '' }; });
    return o;
  }
  function sciezka(cel) {   // cel relacji → nazwa wpisu w archiwum (względem word/)
    if (cel[0] === '/') return cel.slice(1);
    var out = ['word'];
    cel.split('/').forEach(function (p) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }

  async function zbuduj(o) {
    var PDFLib = o.PDFLib, pliki = await rozpakuj(o.docx), ostrzezenia = [];
    function ostrz(s) { if (ostrzezenia.indexOf(s) < 0) ostrzezenia.push(s); }
    if (!pliki['word/document.xml']) throw new Error('PDF: plik DOCX nie zawiera word/document.xml');
    var dx = xml(pliki['word/document.xml']), body = kid(kid(dx, 'w:document'), 'w:body');
    if (!body) throw new Error('PDF: dokument DOCX bez treści (w:body)');
    var rels = relacje(pliki['word/_rels/document.xml.rels']);
    function czesc(typ, domyslna) {
      var id = Object.keys(rels).filter(function (k) { return rels[k].typ === typ; })[0], n = id ? sciezka(rels[id].cel) : domyslna;
      return pliki[n] ? xml(pliki[n]) : { n: '#', a: {}, c: [], t: '' };
    }
    var S = style(czesc('styles', 'word/styles.xml')), N = numeracja(czesc('numbering', 'word/numbering.xml')), ust = kid(czesc('settings', 'word/settings.xml'), 'w:settings');

    // sekcja: jedna na cały dokument (w:sectPr na końcu treści)
    var sp = kid(body, 'w:sectPr'), psz = kid(sp, 'w:pgSz'), pm = kid(sp, 'w:pgMar'), pn = kid(sp, 'w:pgNumType');
    function a(el, n, d) { return el && el.a['w:' + n] != null ? tw(el.a['w:' + n]) : d; }
    var PW = a(psz, 'w', 595.3), PH = a(psz, 'h', 841.9), mT = Math.abs(a(pm, 'top', 72)), mB = Math.abs(a(pm, 'bottom', 72)), mL = a(pm, 'left', 72), mR = a(pm, 'right', 72);
    var hd = a(pm, 'header', 36), fd = a(pm, 'footer', 36), W = PW - mL - mR, nr0 = pn && pn.a['w:start'] != null ? num(pn.a['w:start']) : 1;
    if (num((kid(sp, 'w:cols') || { a: {} }).a['w:num']) > 1) throw blad('układ wielokolumnowy');
    if (wl(kid(sp, 'w:titlePg')) || wl(kid(ust, 'w:evenAndOddHeaders'))) throw blad('osobny nagłówek pierwszej strony albo stron parzystych');
    if (kid(sp, 'w:pgBorders') || kid(sp, 'w:lnNumType')) throw blad('obramowanie strony lub numeracja wierszy');
    if (pn && pn.a['w:fmt'] && pn.a['w:fmt'] !== 'decimal') throw blad('format numeru strony „' + pn.a['w:fmt'] + '”');

    var doc = await PDFLib.PDFDocument.create(), teraz = new Date(), rgb = PDFLib.rgb;
    doc.registerFontkit(o.fontkit);
    doc.setTitle(o.tytul || 'Umowa');
    doc.setAuthor(o.autor || 'TD Consulting Group');
    doc.setProducer('TD Consulting Group — Portal dokumentów');
    doc.setCreator('TD Consulting Group — Portal dokumentów');
    doc.setCreationDate(teraz);
    doc.setModificationDate(teraz);

    // ---------------- kroje: 0 zwykły, 1 pogrubiony, 2 kursywa, 3 pogrubiona kursywa ----------------
    var F = [], nazwy = ['regular', 'bold', 'italic', 'boldItalic'];
    for (var fi = 0; fi < 4; fi++) {
      if (!o.fonts || !o.fonts[nazwy[fi]]) throw new Error('PDF: brak kroju pisma „' + nazwy[fi] + '”');
      var pf = await doc.embedFont(o.fonts[nazwy[fi]], { subset: true });
      var fk = (pf.embedder && pf.embedder.font) || o.fontkit.create(new Uint8Array(o.fonts[nazwy[fi]]));
      F.push({ font: pf, set: new Set(pf.getCharacterSet()), asc: fk.ascent / fk.unitsPerEm, k: (fk.ascent - fk.descent + fk.lineGap) / fk.unitsPerEm, szer: new Map() });
    }
    var kolory = {};
    var L = {
      PH: PH, tab: tw((kid(ust, 'w:defaultTabStop') || { a: {} }).a['w:val'] || DEF_TAB), zapis: [], cicho: false, strona: { PAGE: nr0, NUMPAGES: 1 }, ostrz: ostrz,
      kroj: function (r) { return F[(r.b ? 1 : 0) + (r.i ? 2 : 0)]; },
      kolor: function (hex) { return kolory[hex] || (kolory[hex] = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)); },
      // kawałek tekstu jednego formatu: zamiana znaków spoza kroju na „?”, pomiar szerokości
      czesc: function (src, r, lab) {
        var f = L.kroj(r), s = '', size = r.va ? r.sz * SUP : r.sz, klucz, w;
        for (var ch of src) {
          if (/[­​-‍﻿]/.test(ch)) continue;
          if (f.set.has(ch.codePointAt(0))) s += ch;
          else { s += '?'; ostrz('Brak znaku „' + ch + '” (U+' + ch.codePointAt(0).toString(16).toUpperCase() + ') w kroju pisma — zastąpiono znakiem „?”.'); }
        }
        klucz = size + '|' + s; w = f.szer.get(klucz);
        if (w === undefined) { w = f.font.widthOfTextAtSize(s, size); f.szer.set(klucz, w); }
        return { s: s, o: lab ? '' : src, src: src, r: r, f: f, size: size, w: w, lab: lab };
      },
    };

    // ---------------- treść, nagłówek i stopka ----------------
    var D = { S: S, N: N, cialo: true, n: 0, obrazy: [], rels: rels };
    var tresc = bloki(body, D), wzorzec = akapity(dx).map(function (s) { return s.replace(NIEWIDOCZNE, ''); });
    if (D.n !== wzorzec.length) throw new Error('PDF: kontrola treści nie powiodła się — silnik widzi ' + D.n + ' akapitów, dokument ma ich ' + wzorzec.length);
    for (var zi = 0; zi < D.n; zi++) L.zapis.push('');
    var obrazy = [];
    async function brzeg(znacznik, korzen) {   // w:headerReference / w:footerReference typu „default”
      var ref = kids(sp, znacznik).filter(function (r) { return (r.a['w:type'] || 'default') === 'default'; })[0];
      if (!ref || !rels[ref.a['r:id']]) return [];
      var nazwa = sciezka(rels[ref.a['r:id']].cel), kat = nazwa.replace(/[^/]+$/, ''), plik = nazwa.slice(kat.length);
      if (!pliki[nazwa]) return [];
      var d = { S: S, N: N, cialo: false, n: 0, obrazy: [], rels: relacje(pliki[kat + '_rels/' + plik + '.rels']) };
      var bl = bloki(kid(xml(pliki[nazwa]), korzen) || { c: [] }, d);
      for (var i = 0; i < d.obrazy.length; i++) {
        var ob = d.obrazy[i], bajty = pliki[sciezka(ob.plik)];
        if (!bajty) throw new Error('PDF: brak pliku obrazu ' + ob.plik + ' w dokumencie DOCX');
        if (bajty[0] === 0x89 && bajty[1] === 0x50) ob.img = await doc.embedPng(bajty);
        else if (bajty[0] === 0xFF && bajty[1] === 0xD8) ob.img = await doc.embedJpg(bajty);
        else throw blad('obraz w formacie innym niż PNG/JPEG (' + ob.plik + ')');
        obrazy.push(ob);
      }
      return bl;
    }
    var naglowek = await brzeg('w:headerReference', 'w:hdr'), stopka = await brzeg('w:footerReference', 'w:ftr');
    function wysokosc(bl) { var j = jednostki(bl, W, L); return j.U.reduce(function (s, u) { return s + u.gap + u.h; }, 0); }
    // nagłówek/stopka wyższe niż margines odsuwają treść (jak w Wordzie)
    var gora = Math.max(mT, naglowek.length ? hd + wysokosc(naglowek) : 0), dol = PH - Math.max(mB, stopka.length ? fd + wysokosc(stopka) : 0);
    function os(p, rozm, calosc, m0, m1) {   // położenie obrazu wzdłuż jednej osi
      var od, dl;
      if (p.rf === 'page') { od = 0; dl = calosc; }
      else if (p.rf === 'margin' || p.rf === 'column') { od = m0; dl = calosc - m0 - m1; }
      else throw blad('obraz zakotwiczony względem „' + p.rf + '”');
      if (!p.al) return od + p.off;
      if (p.al === 'center') return od + (dl - rozm) / 2;
      if (p.al === 'left' || p.al === 'top') return od;
      if (p.al === 'right' || p.al === 'bottom') return od + dl - rozm;
      throw blad('wyrównanie obrazu „' + p.al + '”');
    }

    // ---------------- podział na strony ----------------
    var U = jednostki(tresc, W, L).U, strony = [], pg = null, y = 0, naGorze = true, ost = null;
    function nowaStrona() {
      pg = doc.addPage([PW, PH]); strony.push(pg); y = gora; naGorze = true;
      obrazy.forEach(function (ob) { pg.drawImage(ob.img, { x: os(ob.H, ob.w, PW, mL, mR), y: PH - os(ob.V, ob.h, PH, mT, mB) - ob.h, width: ob.w, height: ob.h }); });   // znak wodny pod tekstem
    }
    nowaStrona();
    for (var i = 0; i < U.length; i++) {
      var u = U[i];
      if (u.przed && !naGorze) nowaStrona();
      // na górze strony odstęp po poprzednim akapicie przepada; własny odstęp „przed” zostaje tylko na 1. stronie i po twardym podziale
      var gap = !naGorze ? u.gap : !i || u.przed ? u.wlasny || 0 : 0, trzeba = gap + u.h, j = i;
      while (U[j].keep && U[j + 1] && !U[j + 1].przed) { j++; trzeba += U[j].gap + U[j].h; }
      // ostatni wiersz grupy musi się zmieścić bez dodatku interlinii pod spodem (tak łamie strony LibreOffice)
      if (y + trzeba - (U[j].h - U[j].fit) > dol + EPS) {
        var cz = j === i && u.dziel ? u.dziel(dol - y - gap) : null;
        if (cz) { cz[0].gap = u.gap; cz[0].przed = u.przed; cz[1].przed = true; U.splice(i, 1, cz[0], cz[1]); i--; continue; }
        if (!naGorze) { nowaStrona(); i--; continue; }
        if (y + gap + u.fit > dol + EPS) ostrz('Fragment dokumentu jest wyższy niż strona i wychodzi poza dolny margines (strona ' + strony.length + ').');
      }
      if (naGorze && u.tab && ost && ost.tab === u.tab && u.tab.glowa.length && u.tab.glowa.indexOf(u) < 0) {   // powtórzenie wierszy nagłówkowych tabeli
        L.cicho = true;
        u.tab.glowa.forEach(function (g, gi) { g.rysuj(pg, mL, y, !gi); y += g.h; });
        L.cicho = false; naGorze = false;
      }
      y += gap; u.rysuj(pg, mL, y, naGorze); y += u.h; naGorze = false; ost = u;
    }

    // nagłówek i stopka — po podziale, gdy znana jest liczba stron (pola PAGE / NUMPAGES)
    strony.forEach(function (p, n) {
      L.strona = { PAGE: nr0 + n, NUMPAGES: strony.length };
      [[naglowek, 1], [stopka, 0]].forEach(function (para) {
        if (!para[0].length) return;
        var js = jednostki(para[0], W, L).U, h = js.reduce(function (s, q) { return s + q.gap + q.h; }, 0), yy = para[1] ? hd : PH - fd - h;
        js.forEach(function (q) { yy += q.gap; q.rysuj(p, mL, yy); yy += q.h; });
      });
    });

    // ---------------- kontrola treści: wszystko, co jest w document.xml, musi być narysowane ----------------
    for (var k = 0; k < wzorzec.length; k++) {
      var jest = L.zapis[k].replace(NIEWIDOCZNE, '');
      if (jest !== wzorzec[k]) throw new Error('PDF: kontrola treści nie powiodła się — akapit ' + (k + 1) + ' z ' + wzorzec.length + ': narysowano ' + jest.length + ' z ' + wzorzec[k].length + ' znaków');
    }
    return { pdf: await doc.save(), strony: strony.length, ostrzezenia: ostrzezenia };
  }

  return { zbuduj: zbuduj, rozpakuj: rozpakuj, tekst: tekst };
});
