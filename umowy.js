/* Umowy z klientami — generator (administrators only). Contracts of the office with its clients for
   accounting services: new prepaid contracts, old-style contracts and annexes moving a client to
   prepayment. Everything comes from the `umowy` edge function: it holds the templates (private), fills
   the DOCX, takes the number at the final generation only and keeps the register. The page collects the
   form — firm data from the register (rejestr.io) or the clients base, every field editable with its
   source shown — shows the draft and what is missing, and renders the PDF copy of the generated DOCX
   (umowy-pdf.js). Nothing is sent to a client from here. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/umowy';
  var PDFLIB = [['https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js', 'PDFLib', 'sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI'],
    ['https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js', 'fontkit', 'sha384-2p6U+1mmqF10USehFeRiyG2ESG9FwIqN+jxULn5w9jjQIihSn9Pt13dVCn/Hawjn']];
  var KROJE = { regular: 'fonts/LiberationSerif-Regular.ttf', bold: 'fonts/LiberationSerif-Bold.ttf', italic: 'fonts/LiberationSerif-Italic.ttf', boldItalic: 'fonts/LiberationSerif-BoldItalic.ttf' };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function zl(n) { return Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' zł'; }
  function low(s) { return String(s == null ? '' : s).toLowerCase(); }
  var MIES = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
  var ST = { wygenerowana: ['wygenerowana — do podpisu', 'p-amber'], wyslana: ['wysłana do podpisu', 'p-navy'], podpisana: ['podpisana', 'p-ok'], anulowana: ['anulowana', 'p-grey'] };
  var MIG = { przedplata: ['na przedpłacie', 'p-ok'], aneks_podpisany: ['aneks podpisany', 'p-ok'], aneks_wygenerowany: ['aneks wygenerowany — do podpisu', 'p-amber'], nowa_wygenerowana: ['nowa umowa — do podpisu', 'p-amber'],
    stara: ['umowa w starym wzorze', 'p-red'], brak: ['brak umowy w bazie', 'p-red'], pomin: ['pominięty', 'p-grey'] };
  var KODY = { '': '— (pozycja informacyjna)', zapisy: 'próg liczby zapisów', zapis_kolejny: 'każdy kolejny zapis', vat_jpk: 'deklaracja VAT + JPK', vat_ue: 'informacja VAT UE', srodek_trwaly: 'środek trwały', roznice_kursowe: 'różnice kursowe', zus_dra: 'ZUS DRA', uop: 'pracownik — umowa o pracę', uz: 'pracownik — umowa zlecenie' };

  var S = null, F = null, P = null, tab = 'nowy', ctab = 'SPZOO', wynik = null, licznik = 0;
  var mf = { q: '', stan: 'do_zrobienia', typ: '' };

  async function token() { var s = await window.sb.auth.getSession(); return s && s.data && s.data.session ? s.data.session.access_token : ''; }
  async function api(action, body) {
    var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() }, body: JSON.stringify(Object.assign({ action: action }, body || {})) });
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok && !j.error) j.error = 'Błąd ' + res.status;
    j._status = res.status;
    return j;
  }
  function zB64(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function b64(b) { var s = ''; for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function zapiszPlik(bytes, nazwa, mime) {
    var a = document.createElement('a'), u = URL.createObjectURL(new Blob([bytes], { type: mime }));
    a.href = u; a.download = nazwa; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function czytaj(file) { return new Promise(function (ok, zle) { var r = new FileReader(); r.onload = function () { ok(new Uint8Array(r.result)); }; r.onerror = zle; r.readAsArrayBuffer(file); }); }

  // ---------------- PDF copy of a generated DOCX (rendered here, in the browser) ----------------
  var krojeP = null;
  function skrypt(src, glob, sri) {
    if (window[glob]) return Promise.resolve();
    return new Promise(function (ok, zle) { var s = document.createElement('script'); s.src = src; if (sri) { s.integrity = sri; s.crossOrigin = 'anonymous'; } s.onload = ok; s.onerror = function () { zle(new Error('Nie udało się wczytać biblioteki PDF.')); }; document.head.appendChild(s); });
  }
  async function zrobPdf(docx, tytul) {
    if (!window.UmowyPdf) throw new Error('Moduł PDF nie jest dostępny.');
    for (var i = 0; i < PDFLIB.length; i++) await skrypt(PDFLIB[i][0], PDFLIB[i][1], PDFLIB[i][2]);
    if (!krojeP) krojeP = Promise.all(Object.keys(KROJE).map(function (k) { return fetch(KROJE[k]).then(function (r) { if (!r.ok) throw new Error('Brak kroju pisma ' + k); return r.arrayBuffer(); }).then(function (b) { return [k, b]; }); })).then(function (l) { var o = {}; l.forEach(function (x) { o[x[0]] = x[1]; }); return o; });
    var fonts = await krojeP.catch(function (e) { krojeP = null; throw e; });
    return await window.UmowyPdf.zbuduj({ PDFLib: window.PDFLib, fontkit: window.fontkit, fonts: fonts, docx: docx, tytul: tytul, autor: 'TD Consulting Group' });
  }

  // ---------------- load ----------------
  async function wczytaj() {
    var r = await api('start');
    if (r.error || !Array.isArray(r.klienci)) { $('formularz').innerHTML = '<div class="box"><div class="empty warn">' + esc(r.error || 'Nie udało się wczytać danych generatora.') + '</div></div>'; return false; }
    S = r; rysujWszystko(); return true;
  }
  function rysujWszystko() { rysujKafle(); rysujZakladki(); rysujRejestr(); rysujMigracje(); rysujCennik(); rysujUstawienia(); }
  function doMigracji() { return S.klienci.filter(function (k) { return k.ksiegowosc && k.status !== 'zakonczony'; }); }
  function rysujKafle() {
    var czeka = S.dokumenty.filter(function (d) { return d.status === 'wygenerowana' || d.status === 'wyslana'; }).length;
    var stare = doMigracji().filter(function (k) { return k.stan === 'stara' || k.stan === 'brak'; }).length;
    $('tiles').innerHTML =
      '<button type="button" class="tile" data-tab="ustawienia"><b>' + esc(S.nastepne.SPZOO) + '</b><span>następny numer — spółki</span></button>' +
      '<button type="button" class="tile" data-tab="ustawienia"><b>' + esc(S.nastepne.JDG) + '</b><span>następny numer — JDG</span></button>' +
      '<button type="button" class="tile' + (czeka ? ' amber' : ' zero') + '" data-tab="rejestr"><b>' + czeka + '</b><span>dokumenty czekają na podpis</span></button>' +
      '<button type="button" class="tile' + (stare ? ' amber' : ' zero') + '" data-tab="migracja"><b>' + stare + '</b><span>klientów do przeniesienia na przedpłatę</span></button>';
  }
  function rysujZakladki() {
    var T = [['nowy', 'Nowy dokument'], ['rejestr', 'Rejestr', S.dokumenty.length], ['migracja', 'Przejście na przedpłatę'], ['cennik', 'Cennik'], ['ustawienia', 'Szablony i numeracja']];
    $('tabs').innerHTML = T.map(function (t) { return '<button type="button" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + (t[2] != null ? '<b>' + t[2] + '</b>' : '') + '</button>'; }).join('');
    T.forEach(function (t) { $('t-' + t[0]).hidden = tab !== t[0]; });
  }
  function naZakladke(t) { tab = t; rysujZakladki(); window.scrollTo(0, 0); }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b && S) naZakladke(b.dataset.tab); });

  // ---------------- 1. the client ----------------
  function kandydaci(q) {
    q = low(q).trim();
    if (q.length < 2) return [];
    var cy = q.replace(/\D/g, '');
    return S.klienci.filter(function (k) { return low(k.nazwa).indexOf(q) >= 0 || (cy.length >= 3 && String(k.nip || '').indexOf(cy) >= 0); }).slice(0, 30);
  }
  $('kq').addEventListener('input', function () {
    if (!S) return;
    var l = kandydaci(this.value), c = $('kc');
    c.hidden = !this.value.trim();
    c.innerHTML = l.length ? l.map(function (k) { return '<button type="button" class="cand" data-klient="' + esc(k.id) + '">' + esc(k.nazwa) + ' <small>' + esc(k.forma || 'forma nieokreślona') + (k.nip ? ' · NIP ' + esc(k.nip) : '') + (k.status === 'zakonczony' ? ' · obsługa zakończona' : '') + '</small></button>'; }).join('') : '<div class="empty">Nie ma takiego klienta w bazie.</div>';
  });
  $('kc').addEventListener('click', function (e) { var b = e.target.closest('[data-klient]'); if (b) wybierzKlienta(b.dataset.klient, null); });
  async function szukajWRejestrze() {
    var q = $('rq').value.trim(), c = $('rc');
    if (q.length < 3) { $('kmsg').textContent = 'Wpisz co najmniej 3 znaki.'; return; }
    $('rgo').disabled = true; $('kmsg').textContent = 'Szukam w rejestrze…';
    var r = await api('szukaj', { q: q });
    $('rgo').disabled = false; $('kmsg').textContent = r.error || '';
    if (r.error) return;
    c.hidden = false;
    c.innerHTML = r.wyniki.length ? r.wyniki.map(function (w) { return '<button type="button" class="cand" data-nip="' + esc(w.nip) + '" data-krs="' + esc(w.krs) + '">' + esc(w.nazwa) + ' <small>' + esc(w.forma) + (w.miasto ? ' · ' + esc(w.miasto) : '') + (w.krs ? ' · KRS ' + esc(w.krs) : '') + (w.nip ? ' · NIP ' + esc(w.nip) : '') + (w.wykreslona ? ' · WYKREŚLONA' : '') + '</small></button>'; }).join('') : '<div class="empty">Rejestr nie zna takiej firmy.</div>';
  }
  $('rgo').addEventListener('click', szukajWRejestrze);
  $('rq').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); szukajWRejestrze(); } });
  $('rc').addEventListener('click', function (e) {
    var b = e.target.closest('.cand'); if (!b) return;
    var wBazie = b.dataset.nip && S.klienci.filter(function (k) { return k.nip === b.dataset.nip; })[0];
    if (wBazie) wybierzKlienta(wBazie.id, null); else wybierzFirme({ nip: b.dataset.nip, krs: b.dataset.krs }, null);
  });
  $('reczna').addEventListener('click', function () { nowyFormularz({ typ: 'inne', klient: null, baza: null, kontakt: {}, rej: null, rep: null, sad: null, roznice: [], podpisujacy: [], uwaga: 'Dane wpisywane ręcznie — bez rejestru i bez bazy klientów.' }, null); });

  function wybierzKlienta(id, rodzaj) { return wybierzFirme({ klient: id }, rodzaj); }
  async function wybierzFirme(kto, rodzaj, odswiez) {
    $('kc').hidden = true; $('rc').hidden = true; $('kmsg').textContent = 'Pobieram dane firmy…';
    var r = await api('firma', Object.assign({ odswiez: odswiez === true }, kto));
    $('kmsg').textContent = r.error || '';
    if (r.error) return;
    r._kto = kto;
    nowyFormularz(r, rodzaj);
  }

  // ---------------- the form ----------------
  function zr(skad) { return skad; }
  function nowyFormularz(r, rodzaj) {
    var jdg = r.typ === 'jdg', rej = r.rej, b = r.baza || {}, dzis = S.dzis;
    var zRej = rej ? 'rejestr.io (KRS), stan z ' + pl(rej.pobrano) : '', zBazy = 'Baza klientów', recz = 'wpisane ręcznie';
    F = {
      dane: r, typ: r.typ, klient: r.klient || null,
      rodzaj: rodzaj || (jdg ? 'nowa_jdg' : 'nowa_spzoo'),
      firma: {}, zrodla: {}, podpisujacy: [], wlasciciel: '', kontakt: {}, potw: { reprezentacja: false, sad: false },
      okres: { rok: +dzis.slice(0, 4), miesiac: +dzis.slice(5, 7) },
      prognoza: { zapisy: '', vat: true, uop: 0, uz: 0, kadry: 'w_stawce', srodki_trwale: 0, roznice_kursowe: 0, vat_ue: false, zus_dra: 0, inne: [] },
      aneks: { umowa_numer: (r.umowa && r.umowa.numer) || '', umowa_data: (r.umowa && r.umowa.data) || '', aneks_nr: '' },
    };
    function ust(pole, wart, skad) { F.firma[pole] = wart || ''; F.zrodla[pole] = wart ? skad : recz; }
    var adresBazy = [b.adres, b.miasto].filter(Boolean).join(', ');
    if (jdg || !rej) {
      ust('nazwa', b.nazwa, zBazy); ust('adres', adresBazy, zBazy); ust('nip', b.nip, zBazy);
      ust('regon', r.gus && r.gus.regon, 'rejestr REGON (GUS), stan z ' + pl(r.gus && r.gus.sprawdzono_at)); ust('krs', '', recz);
    } else {
      ust('nazwa', rej.nazwa || b.nazwa, rej.nazwa ? zRej : zBazy); ust('adres', rej.adres || adresBazy, rej.adres ? zRej : zBazy);
      ust('nip', rej.nip || b.nip, rej.nip ? zRej : zBazy); ust('krs', rej.krs, zRej); ust('regon', rej.regon, zRej);
    }
    F.firma.sad = (r.sad && r.sad.nazwa) || ''; F.zrodla.sad = r.sad ? r.sad.opis : '';
    var ile = r.rep && r.rep.tryb === 'laczna' ? r.rep.min : 1;
    F.podpisujacy = (r.podpisujacy || []).map(function (o, i) { return { imie_nazwisko: o.imie_nazwisko, funkcja: o.stanowisko || o.funkcja, opis: o.funkcja, zrodlo: 'rejestr', on: i < ile }; });
    var k = r.kontakt || {};
    F.kontakt = { imie_nazwisko: k.osoba || '', email: k.email || '', telefon: k.telefon || '' };
    F.zrodla.kontakt = (k.email || k.telefon || k.osoba) ? zBazy : recz;
    P = null; wynik = null;
    rysujFormularz(); podglad();
    $('formularz').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function R() { return S.rodzaje[F.rodzaj]; }
  function szablon(rodzaj) { return S.szablony.filter(function (s) { return s.rodzaj === rodzaj && s.aktywny; })[0] || null; }
  function pole(sciezka, etykieta, wart, typ, extra) {
    var zrodlo = F.zrodla[sciezka.split('.').pop()];
    return '<div><label>' + etykieta + '</label><input type="' + (typ || 'text') + '" data-f="' + sciezka + '" value="' + esc(wart == null ? '' : wart) + '" ' + (extra || '') + ' />' +
      (sciezka.indexOf('firma.') === 0 ? '<div class="sub" data-zr="' + sciezka + '">źródło: ' + esc(zrodlo || 'wpisane ręcznie') + '</div>' : '') + '</div>';
  }
  function rysujFormularz() {
    if (!F) { $('formularz').innerHTML = ''; return; }
    var r = F.dane, Rz = R(), spzoo = Rz.rodzina === 'SPZOO', sz = szablon(F.rodzaj), h = '';
    var opcje = Object.keys(S.rodzaje).filter(function (k) { return F.typ === 'inne' || (F.typ === 'jdg') === (S.rodzaje[k].rodzina === 'JDG'); });
    // ---- 2. document
    h += '<div class="box"><h2>2. Dokument</h2>' +
      '<p class="hint">' + esc(F.firma.nazwa || 'Firma bez nazwy') + (r.baza ? ' — klient z bazy' + (r.baza.status === 'zakonczony' ? ' (obsługa zakończona)' : '') : ' — firma spoza bazy klientów') + '</p>' +
      (r.uwaga ? '<div class="note">' + esc(r.uwaga) + '</div>' : '') +
      '<div class="two"><div><label>Rodzaj dokumentu</label><select data-f="rodzaj">' + opcje.map(function (k) { return '<option value="' + k + '"' + (k === F.rodzaj ? ' selected' : '') + '>' + esc(S.rodzaje[k].nazwa) + '</option>'; }).join('') + '</select></div>' +
      '<div><label>Szablon</label><div style="padding-top:8px">' + (sz ? esc(sz.nazwa) + ' <span class="pill p-grey">wersja ' + sz.wersja + '</span>' + (sz.do_sprawdzenia ? ' <span class="pill p-amber">' + esc(sz.do_sprawdzenia) + '</span>' : '') : '<span class="pill p-red">brak szablonu — wgraj go w zakładce „Szablony i numeracja”</span>') + '</div></div></div>';
    if (Rz.aneks) {
      var u = r.umowa;
      h += '<div class="three"><div><label>Numer umowy, do której jest aneks</label><input type="text" data-f="aneks.umowa_numer" value="' + esc(F.aneks.umowa_numer) + '" placeholder="np. 5/' + Rz.rodzina + '/2025" /></div>' +
        '<div><label>Data zawarcia tej umowy</label><input type="date" data-f="aneks.umowa_data" value="' + esc(F.aneks.umowa_data) + '" /></div>' +
        '<div><label>Numer aneksu (puste = kolejny wolny)</label><input type="number" min="1" max="99" data-f="aneks.aneks_nr" value="' + esc(F.aneks.aneks_nr) + '" /></div></div>' +
        '<div class="sub">' + (u ? 'Podpowiedź z: ' + esc(u.skad || 'Baza klientów') + (u.potwierdzona ? '' : ' — odczyt niepotwierdzony, sprawdź z dokumentem') + (u.numer ? '' : '; numeru umowy nie udało się odczytać — wpisz go z dokumentu') + '.' : 'W bazie nie ma potwierdzonej umowy tego klienta — wpisz numer i datę z podpisanego dokumentu.') + '</div>';
    }
    h += '</div>';
    // ---- 3. data
    h += '<div class="box"><h2>3. Dane ' + (spzoo ? 'spółki' : 'przedsiębiorcy') + '</h2><p class="hint">Każde pole można poprawić; pod polem widać, skąd pochodzi wartość.</p>';
    if (r.roznice && r.roznice.length) h += '<div class="note warn"><b>Baza klientów i rejestr różnią się:</b> ' + r.roznice.map(function (x) { return esc(x.pole) + ' — w bazie „' + esc(x.baza) + '”, w rejestrze „' + esc(x.rejestr) + '”'; }).join('; ') + '. Do umowy wstawiono dane z rejestru.</div>';
    if (spzoo) {
      h += pole('firma.nazwa', 'Pełna nazwa (jak w KRS)', F.firma.nazwa) + pole('firma.adres', 'Adres siedziby', F.firma.adres) +
        '<div class="three">' + pole('firma.krs', 'Numer KRS', F.firma.krs, 'text', 'inputmode="numeric" maxlength="10"') + pole('firma.nip', 'NIP', F.firma.nip, 'text', 'inputmode="numeric" maxlength="10"') +
        '<div><label>Dane z rejestru</label><div class="acts" style="padding-top:4px">' + (r.rej ? '<span class="sub">' + esc(r.rej.skad) + ', ' + pl(r.rej.pobrano) + (r.rej.kapital != null ? ' · kapitał ' + zl(r.rej.kapital) : '') + '</span>' : '<span class="sub">brak danych z rejestru</span>') +
        (r._kto && (F.firma.nip || F.firma.krs) ? ' <button type="button" class="mini" id="odswiez">Odśwież z rejestru (płatne)</button>' : '') + '</div></div></div>';
      var znane = S.sady.map(function (s) { return s.nazwa; }), wLiscie = znane.indexOf(F.firma.sad) >= 0;
      h += '<label>Sąd rejestrowy i wydział</label><select data-f="sadWybor"><option value="">— wpiszę sąd z odpisu KRS —</option>' + znane.map(function (n) { return '<option value="' + esc(n) + '"' + (n === F.firma.sad ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>' +
        '<input type="text" data-f="firma.sad" value="' + esc(F.firma.sad) + '" placeholder="np. SĄD REJONOWY W PRZYKŁADOWIE, I WYDZIAŁ GOSPODARCZY KRAJOWEGO REJESTRU SĄDOWEGO" style="margin-top:6px"' + (wLiscie ? ' hidden' : '') + ' />' +
        '<div class="sub" data-zr="firma.sad">' + esc(F.zrodla.sad || '') + '</div>' +
        (r.sad && r.sad.pewne ? '' : '<div class="checks"><label><input type="checkbox" data-f="potw.sad"' + (F.potw.sad ? ' checked' : '') + ' /> Potwierdzam: sąd rejestrowy i wydział są zgodne z odpisem KRS tej spółki.</label></div>');
      // representation
      h += '<label>Reprezentacja</label>' + (r.rej ? '<div class="note">' + (r.rej.organ ? '<b>' + esc(r.rej.organ) + '.</b> ' : '') + (r.rej.sposob ? '„' + esc(r.rej.sposob) + '”' : 'W danych rejestru brak sposobu reprezentacji.') + (r.rep ? '<br>' + esc(r.rep.opis) : '') + '</div>' : '<div class="note warn">Brak danych z rejestru — wpisz osoby uprawnione do reprezentacji według odpisu KRS.</div>');
      h += '<div id="osoby">' + F.podpisujacy.map(function (o, i) {
        return '<div class="doc"><div class="checks" style="margin:0;flex:1;min-width:200px"><label><input type="checkbox" data-os="' + i + '"' + (o.on ? ' checked' : '') + ' /> <span>' + (o.zrodlo === 'reczna' ? '<input type="text" data-osn="' + i + '" value="' + esc(o.imie_nazwisko) + '" placeholder="imię i nazwisko" />' : '<b>' + esc(o.imie_nazwisko) + '</b> <small class="sub">' + esc(o.opis || '') + ' — z rejestru</small>') + '</span></label></div>' +
          '<div style="flex:1;min-width:180px"><input type="text" data-osf="' + i + '" value="' + esc(o.funkcja) + '" placeholder="stanowisko w bierniku, np. Prezesa Zarządu" /></div>' + (o.zrodlo === 'reczna' ? '<button type="button" class="mini del" data-osx="' + i + '">Usuń</button>' : '') + '</div>';
      }).join('') + '</div><div class="acts" style="margin-top:6px"><button type="button" class="mini" id="osDodaj">+ Dodaj osobę ręcznie (np. pełnomocnik)</button><span class="sub">Stanowisko wpisz w bierniku — umowa brzmi „reprezentowaną przez … - Prezesa Zarządu”.</span></div>';
      if (!r.rep || r.rep.tryb !== 'samodzielna') h += '<div class="checks"><label><input type="checkbox" data-f="potw.reprezentacja"' + (F.potw.reprezentacja ? ' checked' : '') + ' /> Potwierdzam: wskazane osoby mogą razem reprezentować spółkę zgodnie z odpisem KRS (albo pełnomocnictwem).</label></div>';
      if (F.podpisujacy.filter(function (o) { return o.on; }).length > 1) h += '<div class="sub warn">Wzór ma jedno miejsce na podpis Zleceniodawcy — wszystkie wskazane osoby zostaną wymienione w komparycji umowy.</div>';
    } else {
      h += '<div class="two">' + pole('wlasciciel', 'Imię i nazwisko przedsiębiorcy', F.wlasciciel, 'text', 'placeholder="np. Jan Przykładowy"') + pole('firma.nazwa', 'Firma (nazwa działalności)', F.firma.nazwa) + '</div>' + pole('firma.adres', 'Adres firmy', F.firma.adres) +
        '<div class="two">' + pole('firma.nip', 'NIP', F.firma.nip, 'text', 'inputmode="numeric" maxlength="10"') + pole('firma.regon', 'REGON', F.firma.regon, 'text', 'inputmode="numeric" maxlength="14"') + '</div>';
    }
    h += '</div>';
    // ---- 4. contact, first period
    if (Rz.kontakt || Rz.prognoza) {
      h += '<div class="box"><h2>4. Kontakt' + (Rz.prognoza ? ' i pierwszy Okres Rozliczeniowy' : '') + '</h2>';
      if (Rz.kontakt) h += '<p class="hint">Osoba odpowiedzialna za wykonanie umowy po stronie klienta i adres do doręczeń (także faktur pro forma). Źródło: ' + esc(F.zrodla.kontakt) + '.</p><div class="three">' +
        pole('kontakt.imie_nazwisko', 'Osoba do kontaktu' + (spzoo ? ' (puste = pierwsza osoba podpisująca)' : ' (puste = przedsiębiorca)'), F.kontakt.imie_nazwisko) + pole('kontakt.email', 'E-mail', F.kontakt.email, 'email') + pole('kontakt.telefon', 'Telefon', F.kontakt.telefon, 'tel') + '</div>';
      if (Rz.prognoza) {
        var m0 = new Date(+S.dzis.slice(0, 4), +S.dzis.slice(5, 7) - 1, 1), ok = '';
        for (var i = 0; i < 4; i++) { var d = new Date(m0.getFullYear(), m0.getMonth() + i, 1), v = d.getFullYear() + '-' + (d.getMonth() + 1), pm = new Date(d.getFullYear(), d.getMonth() - 1, 1); ok += '<option value="' + v + '"' + (F.okres.rok === d.getFullYear() && F.okres.miesiac === d.getMonth() + 1 ? ' selected' : '') + '>' + MIES[d.getMonth()] + ' ' + d.getFullYear() + ' — obsługa dokumentów za ' + MIES[pm.getMonth()] + ' ' + pm.getFullYear() + '</option>'; }
        h += '<label>Pierwszy Okres Rozliczeniowy</label><select data-f="okresWybor">' + ok + '</select>';
      }
      h += '</div>';
    }
    // ---- 5. forecast
    if (Rz.prognoza) {
      var p = F.prognoza;
      h += '<div class="box"><h2>5. Prognoza — Załącznik nr 4</h2><p class="hint">Z prognozy klienta kalkulator liczy pierwszą Stawkę Miesięczną według Cennika (' + (spzoo ? 'spółki' : 'JDG') + '). Ceny tylko z cennika; czego w nim nie ma, dodaj jako pozycję ręczną.</p>' +
        '<div class="four"><div><label>Miesięczna liczba zapisów</label><input type="number" min="0" max="5000" data-f="prognoza.zapisy" value="' + esc(p.zapisy) + '" placeholder="np. 20" /></div>' +
        '<div><label>Osoby na umowie o pracę</label><input type="number" min="0" max="500" data-f="prognoza.uop" value="' + esc(p.uop) + '" /></div>' +
        '<div><label>Osoby na umowach cywilnoprawnych</label><input type="number" min="0" max="500" data-f="prognoza.uz" value="' + esc(p.uz) + '" /></div>' +
        '<div><label>Środki trwałe w ewidencji</label><input type="number" min="0" max="500" data-f="prognoza.srodki_trwale" value="' + esc(p.srodki_trwale) + '" /></div></div>' +
        '<div class="four"><div><label>Różnice kursowe — dokumentów</label><input type="number" min="0" max="5000" data-f="prognoza.roznice_kursowe" value="' + esc(p.roznice_kursowe) + '" /></div>' +
        (spzoo ? '<div><label>ZUS DRA — dokumentów</label><input type="number" min="0" max="50" data-f="prognoza.zus_dra" value="' + esc(p.zus_dra) + '" /></div>' : '') + '</div>' +
        '<div class="checks"><label><input type="checkbox" data-f="prognoza.vat"' + (p.vat ? ' checked' : '') + ' /> Czynny podatnik VAT (deklaracja VAT + JPK)</label>' + (spzoo ? '<label><input type="checkbox" data-f="prognoza.vat_ue"' + (p.vat_ue ? ' checked' : '') + ' /> Informacja VAT UE co miesiąc</label>' : '') + '</div>' +
        '<label>Usługi kadrowe</label><div class="checks"><label><input type="radio" name="kadry" data-f="prognoza.kadry" value="w_stawce"' + (p.kadry === 'w_stawce' ? ' checked' : '') + ' /> w Stawce Miesięcznej</label><label><input type="radio" name="kadry" data-f="prognoza.kadry" value="odrebnie"' + (p.kadry === 'odrebnie' ? ' checked' : '') + ' /> odrębną fakturą (poza Stawką)</label></div>' +
        '<div class="note warn"><b>Do uzgodnienia przez właściciela:</b> wzór umowy zalicza naliczanie wynagrodzeń do Usług Stałych (' + (spzoo ? '§ 13 ust. 2 lit. c; także § 1 pkt 3 i § 13 ust. 2 lit. e' : '§ 4 ust. 2 lit. c i e') + '), czyli do Stawki Miesięcznej płatnej z góry. Jeżeli kadry mają być fakturowane osobno, treść umowy trzeba z tym uzgodnić — przełącznik zmienia tylko wyliczenie w Załączniku nr 4, nie treść umowy.</div>' +
        '<label>Inne Usługi Stałe — pozycje ręczne (kwota netto miesięcznie)</label><div id="inne">' + p.inne.map(function (x, i) { return '<div class="acts" style="margin-bottom:6px;flex-wrap:nowrap"><input type="text" data-in="' + i + '" value="' + esc(x.nazwa) + '" placeholder="nazwa usługi" /><input type="number" min="0" step="0.01" data-ik="' + i + '" value="' + esc(x.kwota) + '" placeholder="zł netto" style="max-width:130px" /><button type="button" class="mini del" data-ix="' + i + '">Usuń</button></div>'; }).join('') + '</div>' +
        '<button type="button" class="mini" id="inDodaj">+ Dodaj pozycję ręczną</button><div id="prognozaWynik"></div></div>';
    }
    // ---- 6. preview and generation
    h += '<div class="box"><h2>' + (Rz.prognoza ? '6' : Rz.kontakt ? '5' : '4') + '. Podgląd i generowanie</h2><div id="podglad"><div class="empty">Przygotowuję podgląd…</div></div></div>';
    $('formularz').innerHTML = h;
    rysujPodglad();
  }
  function formularz() {
    var Rz = R(), wybrani = F.podpisujacy.filter(function (o) { return o.on; });
    return {
      rodzaj: F.rodzaj, klient: F.klient, firma: F.firma, zrodla: F.zrodla, wlasciciel: F.wlasciciel, kontakt: F.kontakt, okres: F.okres,
      podpisujacy: wybrani.map(function (o) { return { imie_nazwisko: o.imie_nazwisko, funkcja: o.funkcja, zrodlo: o.zrodlo }; }),
      prognoza: Rz.prognoza && F.prognoza.zapisy !== '' ? F.prognoza : null,
      aneks: { umowa_numer: F.aneks.umowa_numer, umowa_data: F.aneks.umowa_data, aneks_nr: F.aneks.aneks_nr === '' ? null : +F.aneks.aneks_nr },
      potwierdzenia: F.potw,
    };
  }
  var zegar = null;
  function zaChwile() { clearTimeout(zegar); zegar = setTimeout(podglad, 600); }
  async function podglad() {
    if (!F) return;
    var moj = ++licznik, r = await api('podglad', { formularz: formularz() });
    if (moj !== licznik || !F) return; // a newer change is already on its way
    P = r; rysujPodglad();
  }
  function rysujPodglad() {
    var el = $('podglad'), pw = $('prognozaWynik');
    if (!el) return;
    if (!P) { el.innerHTML = '<div class="empty">Przygotowuję podgląd…</div>'; return; }
    if (P.error && !P.braki) { el.innerHTML = '<div class="empty warn">' + esc(P.error) + '</div>'; if (pw) pw.innerHTML = ''; return; }
    if (pw) {
      var pr = P.prognoza;
      pw.innerHTML = !pr ? '<div class="note">Wpisz przewidywaną liczbę zapisów, aby policzyć stawkę.</div>' :
        '<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Pozycja</th><th class="num">Ilość</th><th class="num">Cena netto</th><th class="num">Wartość netto</th><th>Źródło</th></tr></thead><tbody>' +
        pr.linie.map(function (l) { return '<tr><td>' + esc(l.nazwa) + (l.w_stawce ? '' : ' <span class="pill p-amber">odrębna faktura</span>') + '</td><td class="num">' + l.ilosc + '</td><td class="num">' + zl(l.cena) + '</td><td class="num">' + zl(l.wartosc) + '</td><td>' + (l.zrodlo === 'cennik' ? 'cennik' : 'pozycja ręczna') + '</td></tr>'; }).join('') +
        '<tr><td colspan="3"><b>Pierwsza Stawka Miesięczna netto (zaokrąglona do pełnych złotych)</b></td><td class="num"><b>' + zl(pr.kwota) + '</b></td><td></td></tr>' +
        (pr.odrebnie ? '<tr><td colspan="3">Poza Stawką — odrębna faktura</td><td class="num">' + zl(pr.odrebnie) + '</td><td></td></tr>' : '') + '</tbody></table></div>' +
        '<div class="sub" style="margin-top:6px">W Załączniku nr 4: zapisy „' + esc(pr.teksty.PROGNOZA_ZAPISY) + '”, umowy o pracę ' + esc(pr.teksty.PROGNOZA_UOP) + ', umowy cywilnoprawne ' + esc(pr.teksty.PROGNOZA_UZ) + ', VAT „' + esc(pr.teksty.PROGNOZA_VAT) + '”, inne „' + esc(pr.teksty.PROGNOZA_INNE) + '”, stawka ' + esc(pr.teksty.PROGNOZA_KWOTA) + ' zł.</div>';
    }
    var li = (P.braki || []).map(function (b) { return '<li class="s-brak"><i>✕</i><span>Brakuje: ' + esc(b) + '</span></li>'; })
      .concat((P.pozostale || []).map(function (b) { return '<li class="s-brak"><i>✕</i><span>Niewypełnione pole szablonu: ' + esc(b) + '</span></li>'; }))
      .concat((P.ostrzezenia || []).map(function (b) { return '<li class="s-uwaga"><i>!</i><span>' + esc(b) + '</span></li>'; }));
    if (P.szablon && P.szablon.do_sprawdzenia) li.push('<li class="s-uwaga"><i>!</i><span>Szablon: ' + esc(P.szablon.do_sprawdzenia) + '.</span></li>');
    if (P.gotowe) li.unshift('<li class="s-ok"><i>✓</i><span>Komplet danych — dokument można wygenerować. Data dokumentu: ' + pl(P.data) + ' (dzień generowania).</span></li>');
    var nr = R().aneks ? P.numer : 'Umowa otrzyma numer ' + S.nastepne[R().rodzina];
    el.innerHTML = '<ul class="chk">' + li.join('') + '</ul>' +
      '<div class="acts" style="margin-top:12px"><button type="button" class="big" id="generuj"' + (P.gotowe ? '' : ' disabled') + '>Generuj dokument</button><span class="sub">' + esc(nr) + ' — numer jest nadawany dopiero teraz i nie wraca do puli.</span></div>' +
      '<div class="acts" style="margin-top:10px"><button type="button" class="mini" id="projDocx">Pobierz projekt DOCX</button><button type="button" class="mini" id="projPdf">Pobierz projekt PDF</button><span class="sub" id="projMsg">Projekt nie ma numeru i nie trafia do rejestru.</span></div>' +
      '<div id="wynik"></div>' +
      '<details style="margin-top:12px"><summary>Treść dokumentu (projekt)</summary><pre class="tekst">' + esc(P.tekst || '') + '</pre></details>';
    rysujWynik();
  }
  function rysujWynik() {
    var el = $('wynik'); if (!el || !wynik) return;
    var d = wynik.dokument;
    el.innerHTML = '<div class="note"><b>Wygenerowano: ' + esc(d.numer_pelny) + '</b> — ' + esc(d.klient_nazwa) + ', data ' + pl(d.data) + '. ' + esc(wynik.pdf || '') +
      '<div class="acts" style="margin-top:8px"><button type="button" class="mini ok" data-pobierz="docx" data-id="' + d.id + '">Pobierz DOCX</button>' + (wynik.pdfOk ? '<button type="button" class="mini ok" data-pobierz="pdf" data-id="' + d.id + '">Pobierz PDF</button>' : '') + '<button type="button" class="mini" data-tab="rejestr">Otwórz rejestr</button></div></div>';
  }

  // form events: one listener, the state is updated by the field's path
  $('formularz').addEventListener('input', function (e) {
    var el = e.target, f = el.dataset.f;
    if (el.dataset.osn != null) { F.podpisujacy[+el.dataset.osn].imie_nazwisko = el.value; return zaChwile(); }
    if (el.dataset.osf != null) { F.podpisujacy[+el.dataset.osf].funkcja = el.value; return zaChwile(); }
    if (el.dataset.in != null) { F.prognoza.inne[+el.dataset.in].nazwa = el.value; return zaChwile(); }
    if (el.dataset.ik != null) { F.prognoza.inne[+el.dataset.ik].kwota = el.value; return zaChwile(); }
    if (!f || el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') return;
    var p = f.split('.'), o = p.length === 2 ? F[p[0]] : F;
    o[p[p.length - 1]] = el.value;
    if (p[0] === 'firma') { F.zrodla[p[1]] = 'wpisane ręcznie'; var z = $('formularz').querySelector('[data-zr="' + f + '"]'); if (z) z.textContent = p[1] === 'sad' ? 'wpisane ręcznie — zostanie zapamiętane dla powiatu siedziby' : 'źródło: wpisane ręcznie'; }
    if (p[0] === 'kontakt') F.zrodla.kontakt = 'wpisane ręcznie';
    zaChwile();
  });
  $('formularz').addEventListener('change', function (e) {
    var el = e.target, f = el.dataset.f;
    if (el.dataset.os != null) { F.podpisujacy[+el.dataset.os].on = el.checked; rysujFormularz(); return podglad(); }
    if (!f) return;
    if (f === 'rodzaj') { F.rodzaj = el.value; P = null; rysujFormularz(); return podglad(); }
    if (f === 'sadWybor') { F.firma.sad = el.value; F.zrodla.sad = el.value ? 'wybrany z listy sądów zapisanych w portalu' : ''; F.potw.sad = false; rysujFormularz(); return podglad(); }
    if (f === 'okresWybor') { var v = el.value.split('-'); F.okres = { rok: +v[0], miesiac: +v[1] }; return podglad(); }
    var p = f.split('.');
    if (el.type === 'checkbox') F[p[0]][p[1]] = el.checked;
    else if (el.type === 'radio') { if (el.checked) F[p[0]][p[1]] = el.value; }
    else return;
    podglad();
  });
  $('formularz').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b || !F) return;
    if (b.id === 'osDodaj') { F.podpisujacy.push({ imie_nazwisko: '', funkcja: '', zrodlo: 'reczna', on: true }); rysujFormularz(); return; }
    if (b.dataset.osx != null) { F.podpisujacy.splice(+b.dataset.osx, 1); rysujFormularz(); return podglad(); }
    if (b.id === 'inDodaj') { F.prognoza.inne.push({ nazwa: '', kwota: '' }); rysujFormularz(); return; }
    if (b.dataset.ix != null) { F.prognoza.inne.splice(+b.dataset.ix, 1); rysujFormularz(); return podglad(); }
    if (b.id === 'odswiez') {
      if (!confirm('Pobrać aktualne dane z rejestru? To płatne zapytanie do rejestr.io. Wpisane ręcznie zmiany w formularzu zostaną zastąpione.')) return;
      return wybierzFirme(F.dane._kto, F.rodzaj, true);
    }
    if (b.id === 'projDocx' && P && P.docx) return zapiszPlik(zB64(P.docx), P.nazwa, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    if (b.id === 'projPdf' && P && P.docx) {
      b.disabled = true; $('projMsg').textContent = 'Tworzę PDF…';
      try { var w = await zrobPdf(zB64(P.docx), 'PROJEKT'); zapiszPlik(w.pdf, P.nazwa.replace(/\.docx$/, '.pdf'), 'application/pdf'); $('projMsg').textContent = 'Projekt PDF: ' + w.strony + ' str.' + (w.ostrzezenia.length ? ' Uwagi: ' + w.ostrzezenia.join('; ') : ''); }
      catch (err) { $('projMsg').textContent = (err && err.message) || 'Nie udało się utworzyć PDF.'; }
      b.disabled = false; return;
    }
    if (b.id === 'generuj') return potwierdzGenerowanie();
  });

  // ---------------- windows ----------------
  function okno(html) { $('oknoBody').innerHTML = html; $('okno').hidden = false; }
  function zamknij() { $('okno').hidden = true; $('oknoBody').innerHTML = ''; }
  $('okno').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-zamknij]')) zamknij(); });
  function potwierdzGenerowanie() {
    var Rz = R(), nr = Rz.aneks ? P.numer : S.nastepne[Rz.rodzina];
    okno('<h3>Wygenerować dokument?</h3><p class="hint">' + esc(Rz.nazwa) + ' dla: <b>' + esc(F.firma.nazwa) + '</b>.</p>' +
      '<div class="note">Zostanie nadany numer <b>' + esc(nr) + '</b> z datą ' + pl(P.data) + '. Numeru nie da się zwolnić — dokument wygenerowany przez pomyłkę anuluje się w rejestrze, a numer pozostaje zużyty.</div>' +
      '<div class="err" id="gMsg"></div><div class="row"><button type="button" data-zamknij>Wróć do formularza</button><button type="button" class="go" id="gTak">Generuj i nadaj numer</button></div>');
    $('gTak').addEventListener('click', generuj);
  }
  async function generuj() {
    var b = $('gTak'); b.disabled = true; $('gMsg').textContent = 'Generuję dokument…';
    var r = await api('generuj', { formularz: formularz() });
    if (r.error || !r.dokument || !r.docx) {
      if (r.braki) { P = Object.assign({}, P, r, { gotowe: false, error: null }); zamknij(); rysujPodglad(); return; }
      $('gMsg').textContent = r.error || 'Nie udało się wygenerować dokumentu.'; b.disabled = false;
      if (r.dokument) wczytaj();
      return;
    }
    var docx = zB64(r.docx);
    wynik = { dokument: r.dokument, pdfOk: false, pdf: 'Tworzę kopię PDF…' };
    zamknij(); rysujWynik();
    zapiszPlik(docx, r.nazwa, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    wynik.pdf = await dolaczPdf(r.dokument, docx);
    wynik.pdfOk = wynik.pdf.indexOf('Kopia PDF') === 0;
    await wczytaj(); rysujWynik();
  }
  // renders the PDF of a stored DOCX and files it in the contracts module
  async function dolaczPdf(d, docx) {
    try {
      var w = await zrobPdf(docx, d.numer_pelny);
      var z = await api('pdf_zapisz', { id: d.id, pdf: b64(w.pdf), strony: w.strony });
      if (z.error) return 'Dokument DOCX jest zapisany, ale kopii PDF nie udało się zapisać: ' + z.error;
      return 'Kopia PDF (' + w.strony + ' str.) zapisana w Bazie klientów — umowy, jako dokument do podpisu.';
    } catch (err) { return 'Dokument DOCX jest zapisany. Kopii PDF nie udało się utworzyć (' + ((err && err.message) || 'błąd') + ') — wiążący jest plik DOCX; PDF można dołączyć później z rejestru.'; }
  }
  async function pobierz(id, co) {
    var r = await api('pobierz', { id: id, co: co });
    if (r.error) { alert(r.error); return null; }
    zapiszPlik(zB64(r.plik), r.nazwa, r.mime); return r;
  }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-pobierz]'); if (b) pobierz(b.dataset.id, b.dataset.pobierz); });

  // ---------------- register ----------------
  function rysujRejestr() {
    var th = '<tr><th>Numer</th><th>Klient</th><th>Rodzaj</th><th>Data</th><th>Wygenerował</th><th>Status</th><th>Pliki i czynności</th></tr>';
    $('rtbl').querySelector('thead').innerHTML = th;
    $('rtbl').querySelector('tbody').innerHTML = S.dokumenty.length ? S.dokumenty.map(function (d) {
      var st = ST[d.status] || [d.status, 'p-grey'], zywy = d.status === 'wygenerowana' || d.status === 'wyslana';
      return '<tr><td><b>' + esc(d.numer_pelny) + '</b></td><td>' + esc(d.klient_nazwa) + '<small>' + (d.klient_nip ? 'NIP ' + esc(d.klient_nip) : '') + (d.klient ? '' : ' · spoza bazy klientów') + '</small></td>' +
        '<td>' + esc((S.rodzaje[d.rodzaj] || {}).nazwa || d.rodzaj) + '<small>szablon w. ' + esc(d.szablon_wersja) + (d.kwota != null ? ' · stawka ' + zl(d.kwota) : '') + '</small></td><td>' + pl(d.data) + '</td><td>' + esc(d.kto) + '<small>' + pl(d.created_at) + '</small></td>' +
        '<td><span class="pill ' + st[1] + '">' + st[0] + '</span>' + (d.uwagi ? '<small>' + esc(d.uwagi) + '</small>' : '') + '</td><td><div class="acts">' +
        (d.docx_path ? '<button type="button" class="mini" data-pobierz="docx" data-id="' + d.id + '">DOCX</button>' : '') +
        (d.umowa_id ? '<button type="button" class="mini" data-pobierz="pdf" data-id="' + d.id + '">PDF</button>' : (zywy && d.docx_path ? '<button type="button" class="mini" data-rpdf="' + d.id + '">Utwórz PDF</button>' : '')) +
        (d.status === 'wygenerowana' ? '<button type="button" class="mini" data-rst="wyslana" data-id="' + d.id + '">Oznacz: wysłana</button>' : '') +
        (d.status === 'wyslana' ? '<button type="button" class="mini" data-rst="wygenerowana" data-id="' + d.id + '">Cofnij: niewysłana</button>' : '') +
        (zywy ? '<button type="button" class="mini ok" data-rpodp="' + d.id + '">Wgraj podpisany egzemplarz</button><button type="button" class="mini del" data-ranul="' + d.id + '">Anuluj</button>' : '') + '</div></td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">Jeszcze nic nie wygenerowano.</td></tr>';
    // numbers issued outside the register
    $('luki').innerHTML = S.numeracja.map(function (n) {
      var wRej = S.dokumenty.filter(function (d) { return d.rodzina === n.rodzina && d.rok === n.rok && d.numer != null; }).map(function (d) { return d.numer; });
      var poza = []; for (var i = 1; i <= n.ostatni; i++) if (wRej.indexOf(i) < 0) poza.push(i);
      var zakresy = [], a = null, p = null; poza.forEach(function (x) { if (a === null) { a = p = x; } else if (x === p + 1) p = x; else { zakresy.push(a === p ? '' + a : a + '–' + p); a = p = x; } }); if (a !== null) zakresy.push(a === p ? '' + a : a + '–' + p);
      return '<div class="sub">' + n.rodzina + '/' + n.rok + ': ostatni wydany numer ' + n.ostatni + (zakresy.length ? '; poza rejestrem portalu (wystawione wcześniej albo ręcznie): ' + zakresy.join(', ') : '') + '.</div>';
    }).join('');
  }
  var doPodpisu = null;
  $('rtbl').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var id = b.dataset.id || b.dataset.rpdf || b.dataset.rpodp || b.dataset.ranul, d = S.dokumenty.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    if (b.dataset.rst) { b.disabled = true; var r = await api('status', { id: id, status: b.dataset.rst }); if (r.error) alert(r.error); return wczytaj(); }
    if (b.dataset.rpdf) {
      b.disabled = true; b.textContent = 'Tworzę PDF…';
      var p = await api('pobierz', { id: id, co: 'docx' });
      if (p.error) { alert(p.error); return wczytaj(); }
      var m = await dolaczPdf(d, zB64(p.plik)); if (m.indexOf('Kopia PDF') !== 0) alert(m);
      return wczytaj();
    }
    if (b.dataset.rpodp) { doPodpisu = d; $('pplik').value = ''; $('pplik').click(); return; }
    if (b.dataset.ranul) {
      okno('<h3>Anulować dokument ' + esc(d.numer_pelny) + '?</h3><p class="hint">Numer pozostanie zużyty i widoczny w rejestrze jako anulowany. Kopia PDF zostanie usunięta z Bazy klientów (umowy).</p>' +
        '<label for="aPowod">Powód anulowania</label><textarea id="aPowod" placeholder="np. błąd w danych klienta"></textarea><div class="err" id="aMsg"></div>' +
        '<div class="row"><button type="button" data-zamknij>Nie anuluj</button><button type="button" class="go red" id="aTak">Anuluj dokument</button></div>');
      $('aTak').addEventListener('click', async function () {
        var pow = $('aPowod').value.trim(); if (!pow) { $('aMsg').textContent = 'Podaj powód anulowania.'; return; }
        this.disabled = true; var r2 = await api('status', { id: id, status: 'anulowana', uwagi: pow });
        if (r2.error) { $('aMsg').textContent = r2.error; this.disabled = false; return; }
        zamknij(); wczytaj();
      });
    }
  });
  $('pplik').addEventListener('change', async function () {
    var f = this.files && this.files[0], d = doPodpisu; if (!f || !d) return;
    if (f.size > 15 * 1024 * 1024) { alert('Plik jest za duży (limit 15 MB).'); return; }
    okno('<h3>Podpisany egzemplarz: ' + esc(d.numer_pelny) + '</h3><p class="hint">Plik „' + esc(f.name) + '” zastąpi kopię do podpisu w Bazie klientów. Dokument zostanie oznaczony jako podpisany przez obie strony i zacznie liczyć się w audycie umów klienta.</p>' +
      '<div class="err" id="pMsg"></div><div class="row"><button type="button" data-zamknij>Anuluj</button><button type="button" class="go" id="pTak">Potwierdzam — obie strony podpisały</button></div>');
    $('pTak').addEventListener('click', async function () {
      this.disabled = true; $('pMsg').textContent = 'Zapisuję…';
      var r = await api('podpisany', { id: d.id, pdf: b64(await czytaj(f)) });
      if (r.error) { $('pMsg').textContent = r.error; this.disabled = false; return; }
      zamknij(); wczytaj();
    });
  });

  // ---------------- move to prepayment ----------------
  function rysujMigracje() {
    var sel = $('mstan');
    if (!sel.options.length) sel.innerHTML = '<option value="do_zrobienia">do zrobienia (stary wzór albo brak umowy)</option><option value="">wszystkie</option>' + Object.keys(MIG).map(function (k) { return '<option value="' + k + '">' + MIG[k][0] + '</option>'; }).join('');
    sel.value = mf.stan;
    var q = low(mf.q).trim(), l = doMigracji().filter(function (k) {
      if (mf.typ && k.typ !== mf.typ) return false;
      if (mf.stan === 'do_zrobienia' ? !(k.stan === 'stara' || k.stan === 'brak') : (mf.stan && k.stan !== mf.stan)) return false;
      return !q || low(k.nazwa).indexOf(q) >= 0 || String(k.nip || '').indexOf(q) >= 0;
    });
    $('mile').textContent = 'Pokazano ' + l.length + ' z ' + doMigracji().length + ' klientów obsługiwanych księgowo.';
    $('mtbl').querySelector('thead').innerHTML = '<tr><th>Klient</th><th>Forma</th><th>Opiekun</th><th>Stan umowy</th><th>Umowa w bazie</th><th>Czynności</th></tr>';
    $('mtbl').querySelector('tbody').innerHTML = l.length ? l.map(function (k) {
      var m = MIG[k.stan] || [k.stan, 'p-grey'], zrob = k.stan === 'stara' || k.stan === 'brak';
      return '<tr><td><b>' + esc(k.nazwa) + '</b><small>' + (k.nip ? 'NIP ' + esc(k.nip) : 'bez NIP') + '</small></td><td>' + esc(k.forma || '—') + '</td><td>' + esc(k.opiekun || '—') + '</td>' +
        '<td><span class="pill ' + m[1] + '">' + m[0] + '</span>' + (k.stan_uwagi ? '<small>' + esc(k.stan_uwagi) + '</small>' : '') + '</td>' +
        '<td>' + (k.umowa ? esc(k.umowa.numer || 'numer nieodczytany') + '<small>z dnia ' + (pl(k.umowa.data) || '—') + (k.umowa.potwierdzona ? '' : ' · niepotwierdzona') + '</small>' : '—') + '</td>' +
        '<td><div class="acts">' + (k.typ === 'inne' ? '<span class="sub">forma bez wzoru umowy</span>' : (zrob || k.stan === 'pomin' ? '<button type="button" class="mini ok" data-maneks="' + esc(k.id) + '">Przygotuj aneks</button><button type="button" class="mini" data-mnowa="' + esc(k.id) + '">Nowa umowa</button>' : '')) +
        (k.stan === 'przedplata' || k.stan === 'pomin' ? (k.stan_uwagi != null || k.stan === 'pomin' ? '<button type="button" class="mini" data-mozn="auto" data-id="' + esc(k.id) + '">Cofnij oznaczenie</button>' : '') : '<button type="button" class="mini" data-mozn="przedplata" data-id="' + esc(k.id) + '">Już na przedpłacie</button><button type="button" class="mini" data-mozn="pomin" data-id="' + esc(k.id) + '">Pomiń</button>') + '</div></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">Brak klientów dla tych filtrów.</td></tr>';
  }
  $('mq').addEventListener('input', function () { mf.q = this.value; rysujMigracje(); });
  $('mstan').addEventListener('change', function () { mf.stan = this.value; rysujMigracje(); });
  $('mtyp').addEventListener('change', function () { mf.typ = this.value; rysujMigracje(); });
  $('mtbl').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var id = b.dataset.maneks || b.dataset.mnowa || b.dataset.id, k = S.klienci.filter(function (x) { return x.id === id; })[0]; if (!k) return;
    if (b.dataset.maneks || b.dataset.mnowa) { naZakladke('nowy'); return wybierzKlienta(id, (b.dataset.maneks ? 'aneks_' : 'nowa_') + (k.typ === 'jdg' ? 'jdg' : 'spzoo')); }
    if (b.dataset.mozn) {
      var uw = b.dataset.mozn === 'auto' ? '' : prompt(b.dataset.mozn === 'przedplata' ? 'Na jakiej podstawie klient jest już na przedpłacie? (np. numer i data umowy)' : 'Dlaczego pominąć tego klienta?', '');
      if (uw === null) return;
      b.disabled = true; var r = await api('migracja_oznacz', { klient: id, stan: b.dataset.mozn, uwagi: uw }); if (r.error) alert(r.error); wczytaj();
    }
  });

  // ---------------- price list ----------------
  function rysujCennik() {
    $('ctabs').innerHTML = [['SPZOO', 'Spółki'], ['JDG', 'JDG']].map(function (t) { return '<button type="button" data-ctab="' + t[0] + '" class="' + (ctab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('');
    var l = S.cennik.filter(function (c) { return c.rodzina === ctab; }), grupa = '';
    $('ctbl').querySelector('thead').innerHTML = '<tr><th>Usługa</th><th class="num">Cena netto</th><th>W kalkulatorze</th><th></th></tr>';
    $('ctbl').querySelector('tbody').innerHTML = l.map(function (c) {
      var g = c.grupa !== grupa ? '<tr><td colspan="4"><b>' + esc(c.grupa) + '</b></td></tr>' : ''; grupa = c.grupa;
      return g + '<tr' + (c.aktywna ? '' : ' style="opacity:.55"') + '><td>' + esc(c.nazwa) + (c.jednostka ? '<small>za: ' + esc(c.jednostka) + '</small>' : '') + '</td><td class="num">' + (c.cena_opis ? esc(c.cena_opis) : zl(c.cena)) + '</td>' +
        '<td>' + (c.kod ? '<span class="pill p-navy">' + esc(KODY[c.kod] || c.kod) + (c.kod === 'zapisy' ? ' ≤ ' + c.prog : '') + '</span>' : '<span class="sub">—</span>') + (c.aktywna ? '' : ' <span class="pill p-grey">nieaktywna</span>') + '</td>' +
        '<td><button type="button" class="mini" data-cedit="' + c.id + '">Zmień</button></td></tr>';
    }).join('');
  }
  $('ctabs').addEventListener('click', function (e) { var b = e.target.closest('[data-ctab]'); if (b) { ctab = b.dataset.ctab; rysujCennik(); } });
  function oknoCennika(c) {
    c = c || { rodzina: ctab, grupa: '', nazwa: '', jednostka: '', cena: '', cena_opis: '', kod: '', prog: '', stala: false, aktywna: true, kolejnosc: 900 };
    okno('<h3>' + (c.id ? 'Pozycja cennika' : 'Nowa pozycja cennika') + ' — ' + (c.rodzina === 'SPZOO' ? 'spółki' : 'JDG') + '</h3>' +
      '<label>Nazwa usługi</label><textarea id="cNazwa">' + esc(c.nazwa) + '</textarea><label>Grupa (nagłówek cennika)</label><input type="text" id="cGrupa" value="' + esc(c.grupa) + '" />' +
      '<div class="two"><div><label>Cena netto (zł)</label><input type="number" id="cCena" min="0" step="0.01" value="' + esc(c.cena == null ? '' : c.cena) + '" /></div><div><label>Opis ceny, gdy nie jest liczbą</label><input type="text" id="cOpis" value="' + esc(c.cena_opis || '') + '" placeholder="np. indywidualnie" /></div></div>' +
      '<div class="two"><div><label>Jednostka</label><input type="text" id="cJedn" value="' + esc(c.jednostka || '') + '" placeholder="np. dokument" /></div><div><label>Rola w kalkulatorze</label><select id="cKod">' + Object.keys(KODY).map(function (k) { return '<option value="' + k + '"' + ((c.kod || '') === k ? ' selected' : '') + '>' + esc(KODY[k]) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="two"><div><label>Próg liczby zapisów (tylko dla progów)</label><input type="number" id="cProg" min="0" value="' + esc(c.prog == null ? '' : c.prog) + '" /></div><div><label>Kolejność na liście</label><input type="number" id="cKol" value="' + esc(c.kolejnosc) + '" /></div></div>' +
      '<div class="checks"><label><input type="checkbox" id="cAkt"' + (c.aktywna ? ' checked' : '') + ' /> pozycja aktywna</label></div><div class="err" id="cMsg"></div>' +
      '<div class="row"><button type="button" data-zamknij>Anuluj</button><button type="button" class="go" id="cTak">Zapisz</button></div>');
    $('cTak').addEventListener('click', async function () {
      this.disabled = true;
      var kod = $('cKod').value, r = await api('cennik_zapisz', { id: c.id || null, pola: { rodzina: c.rodzina, nazwa: $('cNazwa').value, grupa: $('cGrupa').value, cena: $('cCena').value, cena_opis: $('cOpis').value, jednostka: $('cJedn').value, kod: kod, prog: kod === 'zapisy' ? $('cProg').value : '', kolejnosc: $('cKol').value, stala: !!kod, aktywna: $('cAkt').checked } });
      if (r.error) { $('cMsg').textContent = r.error; this.disabled = false; return; }
      zamknij(); await wczytaj(); if (F) podglad();
    });
  }
  $('ctbl').addEventListener('click', function (e) { var b = e.target.closest('[data-cedit]'); if (b) oknoCennika(S.cennik.filter(function (c) { return c.id === b.dataset.cedit; })[0]); });
  $('cdodaj').addEventListener('click', function () { oknoCennika(null); });
  $('chist').addEventListener('click', async function () {
    var r = await api('cennik_historia'), el = $('chistoria');
    if (r.error) { el.innerHTML = '<div class="err">' + esc(r.error) + '</div>'; return; }
    var op = function (x) { return x ? esc(x.nazwa) + ' — ' + (x.cena_opis ? esc(x.cena_opis) : zl(x.cena)) + (x.aktywna === false ? ' (nieaktywna)' : '') : '—'; };
    el.innerHTML = '<h2 style="margin-top:14px">Historia zmian cennika</h2>' + (r.historia.length ? '<div class="tablewrap"><table><thead><tr><th>Kiedy</th><th>Kto</th><th>Zmiana</th><th>Było</th><th>Jest</th></tr></thead><tbody>' + r.historia.map(function (x) { return '<tr><td>' + pl(x.at) + '</td><td>' + esc(x.kto || '—') + '</td><td>' + esc(x.op) + '</td><td>' + op(x.bylo) + '</td><td>' + op(x.jest) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">Brak zmian.</div>');
  });

  // ---------------- templates, numbering, courts ----------------
  var doSzablonu = null;
  function rysujUstawienia() {
    $('stbl').querySelector('thead').innerHTML = '<tr><th>Rodzaj dokumentu</th><th>Wersja</th><th>Pola szablonu</th><th>Wgrano</th><th>Czynności</th></tr>';
    $('stbl').querySelector('tbody').innerHTML = Object.keys(S.rodzaje).map(function (k) {
      var s = szablon(k), stare = S.szablony.filter(function (x) { return x.rodzaj === k && !x.aktywny; });
      return '<tr><td><b>' + esc(S.rodzaje[k].nazwa) + '</b>' + (s ? '<small>' + esc(s.nazwa) + '</small>' + (s.uwagi ? '<small>' + esc(s.uwagi) + '</small>' : '') : '') + (s && s.do_sprawdzenia ? '<span class="pill p-amber">' + esc(s.do_sprawdzenia) + '</span>' : '') + '</td>' +
        '<td>' + (s ? 'w. ' + s.wersja + '<small>' + esc(s.sha256.slice(0, 12)) + '…</small>' : '<span class="pill p-red">brak</span>') + (stare.length ? '<small>wcześniejsze: ' + stare.map(function (x) { return 'w. ' + x.wersja; }).join(', ') + '</small>' : '') + '</td>' +
        '<td style="max-width:340px;overflow-wrap:anywhere">' + (s ? s.placeholdery.map(function (p) { return '{{' + esc(p.nazwa) + '}}' + (p.ile > 1 ? '×' + p.ile : ''); }).join(' ') : '—') + '</td>' +
        '<td>' + (s ? pl(s.uploaded_at) + '<small>' + esc(s.uploaded_by) + '</small>' : '—') + '</td><td><div class="acts">' + (s ? '<button type="button" class="mini" data-spob="' + s.id + '">Pobierz</button>' : '') +
        '<button type="button" class="mini" data-swgraj="' + k + '">Wgraj nową wersję</button>' + (s && s.do_sprawdzenia ? '<button type="button" class="mini ok" data-spotw="' + s.id + '">Zatwierdź wzór</button>' : '') + '</div></td></tr>';
    }).join('');
    $('numeracja').innerHTML = S.numeracja.map(function (n) {
      return '<div class="doc"><div class="n"><b>' + n.rodzina + ' / ' + n.rok + '</b><small>następny numer: ' + (n.ostatni + 1) + '/' + n.rodzina + '/' + n.rok + (n.zmienil ? ' · zmienił ' + esc(n.zmienil) + ' ' + pl(n.zmieniono_at) : '') + '</small></div>' +
        '<div class="acts"><input type="number" min="0" value="' + n.ostatni + '" data-nr="' + n.rodzina + '-' + n.rok + '" style="width:110px" aria-label="Ostatni wydany numer" /><button type="button" class="mini" data-nzap="' + n.rodzina + '-' + n.rok + '">Zapisz ostatni wydany numer</button></div></div>';
    }).join('') + '<div class="err" id="nMsg"></div>';
    $('sady').innerHTML = S.sady.map(function (s) { return '<div class="doc"><div class="n">' + esc(s.nazwa) + '<small>' + (s.kod ? 'sygnatura: ' + esc(s.kod) + ' · ' : '') + (s.powiaty.length ? 'powiaty (TERYT): ' + esc(s.powiaty.join(', ')) : 'bez przypisanego powiatu') + ' · dodał ' + esc(s.dodal) + '</small></div></div>'; }).join('') +
      '<div class="acts" style="margin-top:8px;flex-wrap:nowrap"><input type="text" id="sadNazwa" placeholder="pełne oznaczenie sądu i wydziału, jak w odpisie KRS" /><button type="button" class="mini" id="sadDodaj">Dodaj sąd</button></div><div class="err" id="sadMsg"></div>';
  }
  $('t-ustawienia').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.spob) { var r = await api('szablon_pobierz', { id: b.dataset.spob }); if (r.error) { $('smsg').textContent = r.error; return; } return zapiszPlik(zB64(r.plik), r.nazwa, r.mime); }
    if (b.dataset.swgraj) { doSzablonu = b.dataset.swgraj; $('splik').value = ''; return $('splik').click(); }
    if (b.dataset.spotw) {
      if (!confirm('Zatwierdzić ten wzór jako sprawdzony? Oznaczenie „do sprawdzenia” zniknie.')) return;
      var r2 = await api('szablon_potwierdz', { id: b.dataset.spotw }); if (r2.error) { $('smsg').textContent = r2.error; return; } return wczytaj();
    }
    if (b.dataset.nzap) {
      var k = b.dataset.nzap.split('-'), v = $('numeracja').querySelector('[data-nr="' + b.dataset.nzap + '"]').value;
      if (!confirm('Ustawić ostatni wydany numer ' + k[0] + '/' + k[1] + ' na ' + v + '? Następny dokument dostanie numer ' + (+v + 1) + '.')) return;
      var r3 = await api('numeracja_ustaw', { rodzina: k[0], rok: +k[1], ostatni: +v }); $('nMsg').textContent = r3.error || ''; if (!r3.error) wczytaj(); return;
    }
    if (b.id === 'sadDodaj') { var r4 = await api('sad_zapisz', { nazwa: $('sadNazwa').value }); $('sadMsg').textContent = r4.error || ''; if (!r4.error) wczytaj(); }
  });
  $('splik').addEventListener('change', async function () {
    var f = this.files && this.files[0], rodzaj = doSzablonu; if (!f || !rodzaj) return;
    if (!/\.docx$/i.test(f.name) || f.size > 6 * 1024 * 1024) { $('smsg').textContent = 'Wybierz plik .docx do 6 MB.'; return; }
    $('smsg').textContent = 'Sprawdzam szablon…';
    var plik = b64(await czytaj(f)), r = await api('szablon_wgraj', { rodzaj: rodzaj, plik: plik, nazwa: f.name.replace(/\.docx$/i, '') });
    if (r.error) { $('smsg').textContent = r.error + (r.bledne ? ' ' + r.bledne.join(' | ') : ''); return; }
    $('smsg').textContent = '';
    if (r.bez_zmian) { $('smsg').textContent = 'Ten plik jest już aktywnym szablonem — nic nie zmieniono.'; return; }
    if (r.wymaga_potwierdzenia) {
      okno('<h3>Pola szablonu różnią się od oczekiwanych</h3><p class="hint">' + esc(S.rodzaje[rodzaj].nazwa) + ' — plik „' + esc(f.name) + '”.</p>' +
        (r.brakuje.length ? '<div class="note warn"><b>Brakuje pól:</b> ' + esc(r.brakuje.map(function (x) { return '{{' + x + '}}'; }).join(', ')) + ' — tych danych nie będzie w dokumencie.</div>' : '') +
        (r.nadmiarowe.length ? '<div class="note warn"><b>Nieznane pola:</b> ' + esc(r.nadmiarowe.map(function (x) { return '{{' + x + '}}'; }).join(', ')) + ' — generator ich nie wypełni i odmówi generowania, dopóki są w szablonie.</div>' : '') +
        '<div class="sub" style="margin-top:8px">Znalezione pola: ' + esc(r.placeholdery.map(function (p) { return p.nazwa; }).join(', ')) + '</div><div class="err" id="wMsg"></div>' +
        '<div class="row"><button type="button" data-zamknij>Nie wgrywaj</button><button type="button" class="go red" id="wTak">Wgraj mimo różnic</button></div>');
      $('wTak').addEventListener('click', async function () {
        this.disabled = true; var r2 = await api('szablon_wgraj', { rodzaj: rodzaj, plik: plik, nazwa: f.name.replace(/\.docx$/i, ''), potwierdz: true });
        if (r2.error) { $('wMsg').textContent = r2.error; this.disabled = false; return; }
        zamknij(); wczytaj();
      });
      return;
    }
    wczytaj();
  });

  // ---------------- start ----------------
  wczytaj().then(function (ok) {
    if (!ok) return;
    var m = /^#(aneks|nowa)=(.+)$/.exec(decodeURIComponent(location.hash || ''));
    if (m) { var k = S.klienci.filter(function (x) { return x.id === m[2]; })[0]; if (k) wybierzKlienta(k.id, m[1] + '_' + (k.typ === 'jdg' ? 'jdg' : 'spzoo')); }
  });
})();
