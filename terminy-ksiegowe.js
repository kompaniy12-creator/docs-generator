/* Kalendarz terminów: the month's statutory tax / ZUS / reporting deadlines, grouped by day.
   All rules and the date logic live in ksieg-terminy.js (window.KsiegTerminy); this file only
   draws them. The chosen month is kept in the address (#2026-10) so a link opens the same view. */
(function () {
  'use strict';
  var K = window.KsiegTerminy;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function pl(iso) { var p = iso.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function dzu(eli) { var p = (eli || '').split('/'); return p.length === 3 ? 'Dz.U. ' + p[1] + ' poz. ' + p[2] : eli; }
  function link(eli) { return 'https://eli.gov.pl/eli/' + eli + '/ogl'; }
  var MIES_D = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  var DNI = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

  function dzis() { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function utc(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function zaIle(iso, od) { return Math.round((utc(iso) - utc(od)) / 86400000); } // calendar days
  function dni(n) { return n === 1 ? '1 dzień' : n + ' dni'; }
  function pill(n) {
    if (n < 0) return '<span class="pill p-grey">minął ' + dni(-n) + ' temu</span>';
    if (n === 0) return '<span class="pill p-red">dziś</span>';
    if (n === 1) return '<span class="pill p-red">jutro</span>';
    return '<span class="pill ' + (n <= 3 ? 'p-red' : n <= 7 ? 'p-amber' : 'p-ok') + '">za ' + dni(n) + '</span>';
  }

  var rok, mies, grupa = '';
  function zHasha() {
    var m = /^#(\d{4})-(\d{2})$/.exec(location.hash), t = dzis();
    rok = m && +m[2] >= 1 && +m[2] <= 12 ? +m[1] : +t.slice(0, 4);
    mies = m && +m[2] >= 1 && +m[2] <= 12 ? +m[2] : +t.slice(5, 7);
  }
  function idz(r, m) {
    if (m < 1) { m = 12; r--; } else if (m > 12) { m = 1; r++; }
    rok = r; mies = m;
    try { history.replaceState(null, '', '#' + r + '-' + p2(m)); } catch (e) { location.hash = r + '-' + p2(m); }
    render();
  }

  function render() {
    var t = dzis(), wszystkie = K.dlaMiesiaca(rok, mies), licz = {};
    wszystkie.forEach(function (x) { licz[x.grupa] = (licz[x.grupa] || 0) + 1; });
    if (grupa && !licz[grupa]) grupa = '';
    $('title').textContent = K.MIESIACE[mies - 1] + ' ' + rok;
    $('tabs').innerHTML = '<button type="button" data-g=""' + (grupa ? '' : ' class="on"') + '>Wszystkie<b>' + wszystkie.length + '</b></button>' +
      K.GRUPY.filter(function (g) { return licz[g]; }).map(function (g) {
        return '<button type="button" data-g="' + esc(g) + '"' + (grupa === g ? ' class="on"' : '') + '>' + esc(g) + '<b>' + licz[g] + '</b></button>';
      }).join('');

    var lista = wszystkie.filter(function (x) { return !grupa || x.grupa === grupa; }), dniMap = {}, kolej = [];
    lista.forEach(function (x) { if (!dniMap[x.data]) { dniMap[x.data] = []; kolej.push(x.data); } dniMap[x.data].push(x); });
    var tenMiesiac = t.slice(0, 7) === rok + '-' + p2(mies), znacznik = false;
    function dzisLinia() { znacznik = true; return '<div class="now">Dziś — ' + (+t.slice(8)) + ' ' + MIES_D[+t.slice(5, 7) - 1] + ' ' + t.slice(0, 4) + '</div>'; }
    var html = kolej.map(function (d) {
      var n = zaIle(d, t), przed = '';
      if (tenMiesiac && !znacznik && d >= t) przed = dzisLinia();
      return przed + '<div class="box day' + (n < 0 ? ' past' : n === 0 ? ' today' : '') + '">' +
        '<div class="dhead"><div><strong>' + (+d.slice(8)) + ' ' + MIES_D[+d.slice(5, 7) - 1] + '</strong><small>' + DNI[new Date(utc(d)).getUTCDay()] + '</small></div>' + pill(n) + '</div>' +
        dniMap[d].map(function (x) {
          return '<div class="trm"><div class="n"><b>' + esc(x.nazwa) + '</b><span class="pill p-navy">za: ' + esc(x.dotyczy) + '</span></div>' +
            '<p>' + esc(x.opis) + '</p>' +
            (x.przesunieto ? '<div class="moved">Termin ustawowy ' + pl(x.nominalna) + ' (' + esc(K.czyWolny(x.nominalna)) + ') — przesunięty na najbliższy dzień roboczy.</div>' : '') +
            '<div class="law">Podstawa: ' + esc(x.podstawa) + ' · <a href="' + link(x.eli) + '" target="_blank" rel="noopener">' + esc(dzu(x.eli)) + ' ↗</a></div></div>';
        }).join('') + '</div>';
    }).join('');
    if (tenMiesiac && !znacznik) html += dzisLinia();
    $('list').innerHTML = html || '<div class="empty">Brak terminów w tym miesiącu.</div>';

    // public holidays of the month, so the shifts above can be checked by eye
    var sw = K.swieta(rok), pref = rok + '-' + p2(mies) + '-';
    var wolne = Object.keys(sw).filter(function (d) { return d.indexOf(pref) === 0; }).sort().map(function (d) { return (+d.slice(8)) + ' ' + MIES_D[mies - 1] + ' — ' + sw[d]; });
    $('foot').innerHTML = '<p><b>Przesuwanie terminów.</b> Jeżeli ostatni dzień terminu przypada na sobotę lub dzień ustawowo wolny od pracy, terminem jest następny dzień po dniu lub dniach wolnych (' + esc(K.PRZESUNIECIE.podstawa) + '). Terminów z ustawy o rachunkowości (sporządzenie, zatwierdzenie i złożenie sprawozdania finansowego) kalendarz nie przesuwa.</p>' +
      '<p><b>Dni ustawowo wolne w tym miesiącu</b> (' + esc(K.PRZESUNIECIE.dniWolne) + '): ' + (wolne.length ? esc(wolne.join('; ')) + ' oraz niedziele.' : 'tylko niedziele.') + '</p>' +
      '<p>Terminy roczne pokazano dla roku podatkowego i obrotowego równego kalendarzowemu. Kalendarz pokazuje wszystkie obowiązki — to, które dotyczą danego klienta, zależy od jego formy prawnej, formy opodatkowania i rozliczeń VAT. Stan prawny sprawdzony w tekstach jednolitych ustaw 08.10.2026 r.</p>';
  }

  $('prev').addEventListener('click', function () { idz(rok, mies - 1); });
  $('next').addEventListener('click', function () { idz(rok, mies + 1); });
  $('today').addEventListener('click', function () { var t = dzis(); idz(+t.slice(0, 4), +t.slice(5, 7)); });
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-g]'); if (!b) return;
    grupa = b.getAttribute('data-g'); render();
  });
  window.addEventListener('hashchange', function () { zHasha(); render(); });
  zHasha();
  render();
})();
