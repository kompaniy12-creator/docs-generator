/* qr-svg.js — a QR code drawn as SVG in the page itself: the text (an invitation link) never leaves
   the browser, no QR service is called. Byte mode, error correction level M, versions 1–10 (up to 213
   bytes — a t.me link takes about 70). ISO/IEC 18004.
     window.QrSvg.svg(text, { size: 220 })  -> '<svg …>' or '' when the text is too long
     window.QrSvg.matrix(text)              -> array of rows of 0/1 (dark = 1), or null */
(function (root) {
  'use strict';
  // level M: [error-correction codewords per block, blocks in group 1, data codewords per block, blocks in group 2 (one codeword longer)]
  var WERSJE = [null, [10, 1, 16, 0], [16, 1, 28, 0], [26, 1, 44, 0], [18, 2, 32, 0], [24, 2, 43, 0], [16, 4, 27, 0], [18, 4, 31, 0], [22, 2, 38, 2], [22, 3, 36, 2], [26, 4, 43, 1]];
  var WYROWNANIE = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1
  var EXP = [], LOG = [];
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255]; })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function generator(n) { var g = [1]; for (var i = 0; i < n; i++) { var w = []; for (var j = 0; j <= g.length; j++) w[j] = (j < g.length ? mul(g[j], EXP[i]) : 0) ^ (j > 0 ? g[j - 1] : 0); g = w; } return g.reverse(); }
  function korekcja(dane, n) {
    var g = generator(n), r = [];
    for (var i = 0; i < n; i++) r.push(0);
    for (var k = 0; k < dane.length; k++) { var f = dane[k] ^ r.shift(); r.push(0); for (var j = 0; j < n; j++) r[j] ^= mul(g[j + 1], f); }
    return r;
  }
  function utf8(s) { var b = []; var e = unescape(encodeURIComponent(String(s))); for (var i = 0; i < e.length; i++) b.push(e.charCodeAt(i)); return b; }

  function kodowe(bajty) {
    var v = 0, poj = 0;
    for (var i = 1; i <= 10; i++) { var w = WERSJE[i]; poj = w[1] * w[2] + w[3] * (w[2] + 1); if (bajty.length <= poj - (i < 10 ? 2 : 3)) { v = i; break; } }
    if (!v) return null;
    var bity = [], dodaj = function (x, n) { for (var k = n - 1; k >= 0; k--) bity.push((x >> k) & 1); };
    dodaj(4, 4); dodaj(bajty.length, v < 10 ? 8 : 16);
    bajty.forEach(function (b) { dodaj(b, 8); });
    for (var t = 0; t < 4 && bity.length < poj * 8; t++) bity.push(0);
    while (bity.length % 8) bity.push(0);
    var dane = [];
    for (var p = 0; p < bity.length; p += 8) { var x = 0; for (var q = 0; q < 8; q++) x = (x << 1) | bity[p + q]; dane.push(x); }
    for (var pad = 0; dane.length < poj; pad++) dane.push(pad % 2 ? 0x11 : 0xec);
    // blocks, then interleaved: data column by column, then error correction column by column
    var W = WERSJE[v], bloki = [], ec = [], poz = 0;
    for (var bl = 0; bl < W[1] + W[3]; bl++) { var dl = W[2] + (bl >= W[1] ? 1 : 0), blok = dane.slice(poz, poz + dl); poz += dl; bloki.push(blok); ec.push(korekcja(blok, W[0])); }
    var out = [];
    for (var c = 0; c <= W[2]; c++) bloki.forEach(function (b) { if (c < b.length) out.push(b[c]); });
    for (var c2 = 0; c2 < W[0]; c2++) ec.forEach(function (e) { out.push(e[c2]); });
    return { v: v, slowa: out };
  }

  // x: the data bits (bitow of them); the result is razem bits long: data followed by the BCH remainder
  function bch(x, gen, bitow, razem) { var r = x << (razem - bitow); for (var i = bitow - 1; i >= 0; i--) if ((r >> (i + razem - bitow)) & 1) r ^= gen << i; return (x << (razem - bitow)) | r; }
  var MASKI = [
    function (r, c) { return (r + c) % 2 === 0; }, function (r) { return r % 2 === 0; }, function (r, c) { return c % 3 === 0; }, function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; }, function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; }, function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; },
  ];

  function szkielet(v) {
    var n = 17 + 4 * v, m = [], zaj = [], i, j;
    for (i = 0; i < n; i++) { m.push([]); zaj.push([]); for (j = 0; j < n; j++) { m[i].push(0); zaj[i].push(false); } }
    var ustaw = function (r, c, x) { if (r >= 0 && r < n && c >= 0 && c < n) { m[r][c] = x ? 1 : 0; zaj[r][c] = true; } };
    var znacznik = function (r0, c0) { for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) ustaw(r0 + r, c0 + c, r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4))); };
    znacznik(0, 0); znacznik(0, n - 7); znacznik(n - 7, 0);
    var a = WYROWNANIE[v];
    a.forEach(function (r0) { a.forEach(function (c0) { if (zaj[r0][c0]) return; for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++) ustaw(r0 + r, c0 + c, Math.max(Math.abs(r), Math.abs(c)) !== 1); }); });
    for (i = 8; i < n - 8; i++) { if (!zaj[6][i]) ustaw(6, i, i % 2 === 0); if (!zaj[i][6]) ustaw(i, 6, i % 2 === 0); }
    ustaw(n - 8, 8, 1); // the dark module
    // format areas are reserved now and written with each mask
    for (i = 0; i < 9; i++) { if (!zaj[8][i]) ustaw(8, i, 0); if (!zaj[i][8]) ustaw(i, 8, 0); }
    for (i = 0; i < 8; i++) { ustaw(8, n - 1 - i, 0); if (!zaj[n - 1 - i][8]) ustaw(n - 1 - i, 8, 0); }
    if (v >= 7) { var w = bch(v, 0x1f25, 6, 18); for (i = 0; i < 18; i++) { var b = (w >> i) & 1; ustaw(Math.floor(i / 3), n - 11 + i % 3, b); ustaw(n - 11 + i % 3, Math.floor(i / 3), b); } }
    return { n: n, m: m, zaj: zaj };
  }
  function format(m, n, maska) {
    var f = bch(maska, 0x537, 5, 15) ^ 0x5412; // level M = 00, then the mask number
    for (var i = 0; i < 15; i++) {
      var b = (f >> i) & 1;
      // first copy: around the top-left finder; second copy: split between the other two
      if (i < 6) m[i][8] = b; else if (i < 8) m[i + 1][8] = b; else m[8][14 - i + (i < 9 ? 1 : 0)] = b;
      if (i < 8) m[8][n - 1 - i] = b; else m[n - 15 + i][8] = b;
    }
  }
  function kara(m, n) {
    var k = 0, r, c, ciemne = 0;
    for (r = 0; r < n; r++) {
      for (var os = 0; os < 2; os++) {
        var bieg = 1, hist = 0;
        for (c = 0; c < n; c++) {
          var x = os ? m[c][r] : m[r][c];
          if (c > 0) { var p = os ? m[c - 1][r] : m[r][c - 1]; if (x === p) { bieg++; if (bieg === 5) k += 3; else if (bieg > 5) k++; } else bieg = 1; }
          hist = ((hist << 1) | x) & 0x7ff;
          if (c >= 10 && (hist === 0x5d || hist === 0x5d0)) k += 40; // 1011101 with four light modules on one side
        }
      }
      for (c = 0; c < n; c++) { if (m[r][c]) ciemne++; if (r < n - 1 && c < n - 1 && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) k += 3; }
    }
    return k + Math.floor(Math.abs(ciemne * 20 - n * n * 10) / (n * n)) * 10;
  }
  function matrix(text) {
    var k = kodowe(utf8(text));
    if (!k) return null;
    var s = szkielet(k.v), n = s.n, bity = [];
    k.slowa.forEach(function (x) { for (var b = 7; b >= 0; b--) bity.push((x >> b) & 1); });
    // data: two columns at a time from the right, zig-zag upwards and downwards, skipping the timing column
    var pola = [], gora = true;
    for (var c = n - 1; c > 0; c -= 2) {
      if (c === 6) c--;
      for (var i = 0; i < n; i++) { var r = gora ? n - 1 - i : i; for (var d = 0; d < 2; d++) if (!s.zaj[r][c - d]) pola.push([r, c - d]); }
      gora = !gora;
    }
    var najlepsza = null, najmniej = Infinity;
    for (var maska = 0; maska < 8; maska++) {
      var m = s.m.map(function (w) { return w.slice(); });
      pola.forEach(function (p, idx) { m[p[0]][p[1]] = (bity[idx] || 0) ^ (MASKI[maska](p[0], p[1]) ? 1 : 0); });
      format(m, n, maska);
      var ka = kara(m, n);
      if (ka < najmniej) { najmniej = ka; najlepsza = m; }
    }
    return najlepsza;
  }
  function svg(text, o) {
    var m = matrix(text);
    if (!m) return '';
    var n = m.length, q = 4, w = n + 2 * q, size = (o && o.size) || 220, d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + w + '" width="' + size + '" height="' + size + '" shape-rendering="crispEdges" role="img" aria-label="Kod QR z linkiem">' +
      '<rect width="' + w + '" height="' + w + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  var api = { svg: svg, matrix: matrix };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QrSvg = api;
})(typeof window !== 'undefined' ? window : this);
