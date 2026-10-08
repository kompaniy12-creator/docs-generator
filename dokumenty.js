/* Kadry — generator pojedynczych dokumentów (dokumenty.html).
   Katalog i treść: window.KadryWzory (dokumenty-wzory.js); PDF: window.KadryPdf (dokumenty-pdf.js).
   Dokumenty „z kompletu” nie są tu budowane drugi raz — odsyłamy do „Kompletu dokumentów”,
   formularze urzędowe tylko linkujemy. Pracownicy: zatrudnienie_zgloszenia, firmy: klienci-list.
   Wygenerowany PDF trafia do historii modułu (history.js, doc_type „kadry-dokument”). */
(function () {
  'use strict';
  var K = window.KadryWzory, P = window.KadryPdf;
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/';
  var TR_CHUNK_CHARS = 2400, TR_PARALLEL = 4;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pusty(v) { return v === undefined || v === null || String(v).trim() === ''; }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  // dzisiejsza data lokalna (toISOString dałby po północy wczorajszą datę UTC)
  function dzienPL(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pl-PL'); }
  function dzis() { var d = new Date(), p = function (n) { return n < 10 ? '0' + n : '' + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

  // Dokumenty katalogu, których ten generator nie oferuje (treść zostaje w dokumenty-wzory.js):
  var UKRYTE = {
    'pelnomocnictwo-kpa-cudzoziemiec': 'moduł „Legalizacja pobytu” — pełnomocnictwo w sprawach pobytowych nie należy do Kadr',
    'umowa-o-dzielo': 'wstrzymane decyzją właściciela',
  };
  var WZORY = K.wzory.filter(function (d) { return !UKRYTE[d.id]; });
  function wzor(id) { return WZORY.filter(function (d) { return d.id === id; })[0] || null; }

  var ZRODLO = { urzedowy: ['wzór urzędowy', 'p-navy'], ustawowy: ['tekst własny wg ustawy', 'p-grey'], biuro: ['z kompletu', 'p-ok'], link: ['formularz urzędowy — link', 'p-grey'] };
  var FORMA = { pisemna: 'forma pisemna', dokumentowa: 'forma dokumentowa', bez_podpisu: 'bez podpisu' };
  var KTO = { obie: 'pracodawca i pracownik', pracodawca: 'pracodawca', pracownik: 'pracownik', potwierdzenie: 'nikt — pracownik potwierdza odbiór' };
  var METODA = { odreczny: 'podpis własnoręczny', kwalifikowany: 'kwalifikowany podpis elektroniczny', zaufany: 'podpis zaufany' };
  var DLA = { pracownik: 'pracownik (umowa o pracę)', zleceniobiorca: 'zleceniobiorca', oba: 'pracownik i zleceniobiorca' };
  var ART5 = 'art. 5 ust. 2 ustawy o powierzaniu pracy cudzoziemcom';

  // ---------------- zatwierdzenia wzorów ----------------
  // portal_ustawienia, klucz kadry_wzory: { id: { by, at, wersja } }. Zatwierdzenie jest ważne tylko dla
  // tej wersji treści, którą kadrowa widziała: wersja = skrót treści wzoru; zmiana tekstu je unieważnia.
  // Dopóki w bazie nie ma wiersza z tym kluczem i uprawnień (RLS), strona tylko oznacza wzory.
  var zatw = { gotowe: false, mapa: {} };
  function skrot(str) { // cyrb53 — znacznik wersji treści, nie zabezpieczenie
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
  var wersje = {};
  function wersja(doc) {
    if (!wersje[doc.id]) wersje[doc.id] = skrot(JSON.stringify([doc.nazwa, doc.tresc, doc.pola.map(function (p) { return [p.id, p.typ, p.opcje || null, p.gdy_puste === undefined ? null : p.gdy_puste]; })]));
    return wersje[doc.id];
  }
  function zatwierdzenie(doc) { var z = zatw.mapa[doc.id]; return z && z.wersja === wersja(doc) ? z : null; }
  function nieaktualne(doc) { var z = zatw.mapa[doc.id]; return z && z.wersja !== wersja(doc) ? z : null; }
  function doZatwierdzenia(doc) { return doc.do_zatwierdzenia && !zatwierdzenie(doc); }
  async function wczytajZatwierdzenia() {
    try {
      var r = await window.sb.from('portal_ustawienia').select('value').eq('key', 'kadry_wzory').maybeSingle();
      zatw.gotowe = !r.error && !!r.data;
      zatw.mapa = (r.data && r.data.value && typeof r.data.value === 'object') ? r.data.value : {};
    } catch (e) { zatw.gotowe = false; zatw.mapa = {}; }
  }
  async function zapiszZatwierdzenie(doc, on) {
    await wczytajZatwierdzenia(); // świeży stan, żeby nie nadpisać zatwierdzeń innej osoby
    if (!zatw.gotowe) throw new Error('Baza nie przyjmuje jeszcze zatwierdzeń (brak wiersza „kadry_wzory” albo uprawnień).');
    var mapa = Object.assign({}, zatw.mapa);
    if (on) mapa[doc.id] = { by: (window.PortalUser && window.PortalUser.email) || '', at: new Date().toISOString(), wersja: wersja(doc), katalog: K.wersja };
    else delete mapa[doc.id];
    var r = await window.sb.from('portal_ustawienia').update({ value: mapa, updated_at: new Date().toISOString() }).eq('key', 'kadry_wzory').select('key');
    if (r.error) throw new Error(r.error.message);
    if (!r.data || !r.data.length) throw new Error('Baza odrzuciła zapis — brak uprawnienia do zatwierdzania wzorów.');
    zatw.mapa = mapa;
  }

  // ---------------- podpis elektroniczny: co wolno wysłać ----------------
  // Serwer podpisów (supabase/functions/podpisy/checks.ts, regula()) wymusza formę pisemną tylko dla
  // tych rodzajów; dokument „pisemny” z innym rodzajem przyjąłby z podpisem zaufanym — takich nie wysyłamy.
  var RODZAJE_PISEMNE = ['rozwiazanie', 'ppk_rezygnacja', 'odpowiedzialnosc', 'umowa_praca', 'aneks_praca'];
  // rodzaj z katalogu jest wystarczająco ostry, ale serwer pokazałby podpisującemu podstawę prawną innego dokumentu
  var EPODPIS_INNA_PODSTAWA = {
    'ppk-wniosek-o-wplaty': 'serwer zna tylko rodzaj „Rezygnacja z PPK” i pokazałby podpisującemu podstawę rezygnacji (art. 23 ust. 2), a to wniosek o wpłaty (art. 23 ust. 10)',
    'wypowiedzenie-umowy-zlecenia': 'serwer zna tylko rodzaj „Wypowiedzenie / rozwiązanie umowy o pracę” i pokazałby art. 30 § 3 Kodeksu pracy, który zlecenia nie dotyczy',
  };
  function epodpis(doc, cudz) {
    var f = K.formaDla(doc, cudz);
    if (f.kategoria === 'bez_podpisu' || f.podpisuje === 'potwierdzenie') return { ok: false, powod: 'Tego dokumentu się nie podpisuje — przekaż go pracownikowi i zachowaj dowód przekazania.' };
    if (doc.tresc.some(function (b) { return b.t === 'tabela' && b.puste_wiersze; })) return { ok: false, powod: 'Dokument z tabelą wypełnianą ręcznie — drukuje się go i podpisuje na papierze.' };
    if (f.kategoria === 'pisemna' && RODZAJE_PISEMNE.indexOf(f.rodzaj_podpisy) < 0) return { ok: false, przygotowanie: true, powod: 'Podpis elektroniczny dla tego dokumentu: w przygotowaniu. Wymaga formy pisemnej (podpis własnoręczny albo kwalifikowany), a moduł podpisów nie zna jeszcze tego rodzaju dokumentu i przyjąłby podpis zaufany.' };
    if (EPODPIS_INNA_PODSTAWA[doc.id]) return { ok: false, przygotowanie: true, powod: 'Podpis elektroniczny dla tego dokumentu: w przygotowaniu (' + EPODPIS_INNA_PODSTAWA[doc.id] + ').' };
    return { ok: true, rodzaj: f.rodzaj_podpisy, podpisuje: f.podpisuje, czesc: /^[A-E]$/.test(f.akta || '') ? f.akta : null };
  }

  // ---------------- dane: pracownicy i firmy ----------------
  var workers = [], firms = [], zaladowano = false;
  async function token() { var s = await window.sb.auth.getSession(); return s && s.data && s.data.session ? s.data.session.access_token : ''; }
  async function wczytajRejestr() {
    try {
      for (var from = 0; ; from += 1000) { // PostgREST oddaje najwyżej 1000 wierszy na żądanie
        var w = await window.sb.from('zatrudnienie_zgloszenia').select('id,worker_name,status,created_at,payload').order('created_at', { ascending: false }).range(from, from + 999);
        if (w.error || !w.data) break;
        workers = workers.concat(w.data);
        if (w.data.length < 1000) break;
      }
    } catch (e) { /* rejestr niedostępny — zostaje wpisywanie ręczne */ }
    var byNip = {};
    workers.forEach(function (w) {
      var p = w.payload || {}, nip = digits(p.z_nip);
      if (!nip || byNip[nip]) return;
      byNip[nip] = { nip: nip, nazwa: p.z_nazwa || ('NIP ' + nip), payload: p };
    });
    try {
      var res = await fetch(FN + 'klienci-list', { headers: { apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() } });
      var k = await res.json();
      (k.clients || []).forEach(function (c) { var nip = digits(c.nip); if (nip && !byNip[nip]) byNip[nip] = { nip: nip, nazwa: c.nazwa || ('NIP ' + nip), payload: null }; });
    } catch (e) { /* bez listy klientów zostają firmy z rejestru */ }
    firms = Object.keys(byNip).map(function (n) { return byNip[n]; }).sort(function (a, b) { return a.nazwa.localeCompare(b.nazwa, 'pl'); });
    zaladowano = true;
  }
  function nazwaPrac(w) { var p = w.payload || {}; return w.worker_name || [p.p_imiona, p.p_nazwisko].filter(Boolean).join(' ') || '—'; }
  function obcy(ob) { ob = String(ob || '').trim().toLowerCase(); return !!ob && !/^pol(ska|skie|ski|ak|ka)?$/.test(ob) && ob !== 'pl'; }

  // ---------------- katalog ----------------
  var filtr = { q: '', dla: '', grupa: '', zrodlo: '' };
  function rodzajZrodla(d) { return d.zrodlo.typ === 'biuro' ? 'biuro' : d.zrodlo.typ === 'link' ? 'link' : 'gen'; }
  function pasuje(d) {
    if (filtr.zrodlo && rodzajZrodla(d) !== filtr.zrodlo) return false;
    if (filtr.dla && d.dla !== filtr.dla && d.dla !== 'oba') return false;
    if (filtr.grupa && d.grupa !== filtr.grupa) return false;
    if (!filtr.q) return true;
    var hay = [d.nazwa, d.grupa, d.podstawa.map(function (p) { return p.art + ' ' + p.akt; }).join(' '), d.uwagi.join(' ')].join(' ').toLowerCase();
    return filtr.q.toLowerCase().split(/\s+/).filter(Boolean).every(function (t) { return hay.indexOf(t) !== -1; });
  }
  function pigulki(d, cudz) {
    var z = ZRODLO[d.zrodlo.typ], f = K.formaDla(d, cudz), out = ['<span class="pill ' + z[1] + '">' + z[0] + '</span>'];
    if (d.zrodlo.typ !== 'link') {
      out.push('<span class="pill ' + (f.kategoria === 'pisemna' ? 'p-navy' : 'p-grey') + '">' + FORMA[f.kategoria] + (d.forma.cudzoziemiec && !cudz && d.forma.cudzoziemiec !== d.forma.kategoria ? ' (cudzoziemiec: ' + d.forma.cudzoziemiec + ')' : '') + '</span>');
      if (d.dwujezyczny.poziom === 'wymagany') out.push('<span class="pill p-amber">dwujęzyczny wymagany</span>');
      else if (d.dwujezyczny.poziom === 'zalecany') out.push('<span class="pill p-grey">dwujęzyczny zalecany</span>');
    }
    if (d.do_zatwierdzenia) out.push(zatwierdzenie(d) ? '<span class="pill p-ok">wzór zatwierdzony</span>' : '<span class="pill p-amber">do zatwierdzenia</span>');
    return out.join('');
  }
  function rysujKatalog() {
    var licz = { '': WZORY.length, gen: 0, biuro: 0, link: 0 };
    WZORY.forEach(function (d) { licz[rodzajZrodla(d)]++; });
    $('tiles').innerHTML = [['', 'Wszystkie dokumenty'], ['gen', 'Do wygenerowania tutaj'], ['biuro', 'Z kompletu dokumentów'], ['link', 'Formularze urzędowe']].map(function (t) {
      return '<button type="button" class="tile' + (filtr.zrodlo === t[0] ? ' on' : '') + '" data-z="' + t[0] + '"><b>' + licz[t[0]] + '</b><span>' + t[1] + '</span></button>';
    }).join('');
    var lista = WZORY.filter(pasuje), html = '';
    K.GRUPY.forEach(function (g) {
      var ds = lista.filter(function (d) { return d.grupa === g; });
      if (!ds.length) return;
      html += '<div class="box"><h2>' + esc(g) + '</h2><p class="hint">' + ds.length + ' ' + (ds.length === 1 ? 'dokument' : 'dok.') + '</p>' + ds.map(function (d) {
        var pod = d.podstawa.slice(0, 2).map(function (p) { return p.art + ' — ' + p.akt; }).join('; ');
        return '<div class="doc" data-id="' + d.id + '"><div class="n"><b>' + esc(d.nazwa) + '</b><small>' + esc(DLA[d.dla]) + (pod ? ' · ' + esc(pod) : '') + '</small><div class="tags">' + pigulki(d, false) + '</div></div>' +
          '<div class="acts"><a class="mini" href="#' + d.id + '">' + (d.zrodlo.typ === 'biuro' ? 'Gdzie wygenerować' : d.zrodlo.typ === 'link' ? 'Źródło i sposób złożenia' : 'Otwórz') + '</a></div></div>';
      }).join('') + '</div>';
    });
    $('groups').innerHTML = html || '<div class="empty">Nie znaleziono dokumentu. Zmień wyszukiwane słowa albo filtry.</div>';
  }

  // ---------------- widok dokumentu ----------------
  var cur = null;        // { doc, dane, proba }
  var osoba = { worker: null, firma: '', cudz: false, cudzRecznie: false }; // wybór zostaje przy przechodzeniu między dokumentami
  var dj = { on: false, reka: false, jezyk: '', opisowe: true };
  var busy = false;

  function obywatelstwo() { return (osoba.worker && osoba.worker.payload && osoba.worker.payload.p_obywatelstwo) || (cur && cur.dane.p_obywatelstwo) || ''; }
  function ustawCudz() { if (!osoba.cudzRecznie) osoba.cudz = obcy(obywatelstwo()); }
  function domyslneDj() { if (!dj.reka) dj.on = osoba.cudz && cur.doc.dwujezyczny.poziom === 'wymagany'; }

  function zRejestru(doc, payload) {
    var d = K.zRejestru(doc, payload);
    // miejscowość podpisania nie jest zbierana w zgłoszeniu — jak w komplecie: miasto pracodawcy albo pracownika
    if (pusty(d.d_miejscowosc) && doc.pola.some(function (p) { return p.id === 'd_miejscowosc'; })) {
      var m = String(payload.z_miasto || '').replace(/^\d{2}-\d{3}\s*/, '').trim() || payload.a_miejscowosc || '';
      if (m) d.d_miejscowosc = m;
    }
    return d;
  }
  function otworz(doc) {
    cur = { doc: doc, dane: K.domyslne(doc, dzis()), proba: false };
    if (osoba.worker) Object.assign(cur.dane, zRejestru(doc, osoba.worker.payload || {}));
    else if (osoba.firma) Object.assign(cur.dane, daneFirmy(doc, osoba.firma));
    ustawCudz(); dj.reka = false; domyslneDj();
    rysujDokument();
  }
  function daneFirmy(doc, nip) {
    var f = firms.filter(function (x) { return x.nip === nip; })[0];
    if (!f) return {};
    var src = f.payload ? Object.keys(f.payload).reduce(function (o, k) { if (/^z_/.test(k)) o[k] = f.payload[k]; return o; }, {}) : { z_nazwa: f.nazwa, z_nip: f.nip };
    return zRejestru(doc, src);
  }

  function polaWidoczne() { return cur.doc.pola.filter(function (p) { return !p.gdy || K.spelnia(p.gdy, cur.dane); }); }
  function wymagane(p) { return p.wymagane || (p.wymagane_gdy && K.spelnia(p.wymagane_gdy, cur.dane)); }
  function kontrolka(p) {
    var v = cur.dane[p.id] == null ? '' : String(cur.dane[p.id]), id = 'f_' + p.id, ph = p.podpowiedz ? ' placeholder="' + esc(p.podpowiedz) + '"' : '';
    if (p.typ === 'wybor') return '<select id="' + id + '" data-p="' + p.id + '"><option value="">— wybierz —</option>' + p.opcje.map(function (o) { return '<option value="' + esc(o.v) + '"' + (o.v === v ? ' selected' : '') + '>' + esc(o.etykieta) + '</option>'; }).join('') + '</select>';
    if (p.typ === 'dlugi') return '<textarea id="' + id + '" data-p="' + p.id + '" maxlength="4000"' + ph + '>' + esc(v) + '</textarea>';
    if (p.typ === 'data') return '<input type="date" id="' + id + '" data-p="' + p.id + '" value="' + esc(v) + '" />';
    var mode = p.typ === 'kwota' ? ' inputmode="decimal"' : (p.typ === 'liczba' || p.typ === 'pesel' || p.typ === 'nip' || p.typ === 'regon' || p.typ === 'iban') ? ' inputmode="numeric"' : '';
    return '<input type="' + (p.typ === 'email' ? 'email' : 'text') + '" id="' + id + '" data-p="' + p.id + '" value="' + esc(v) + '" maxlength="400" autocomplete="off"' + mode + ph + ' />';
  }
  function formularz() {
    return '<div class="grid">' + cur.doc.pola.map(function (p) {
      return '<div class="f' + (p.typ === 'dlugi' ? ' wide' : '') + '" data-f="' + p.id + '"><label for="f_' + p.id + '">' + esc(p.etykieta) + ' <span data-gw></span></label>' + kontrolka(p) + '<span data-err></span></div>';
    }).join('') + '</div>';
  }
  // stan pól: widoczność, gwiazdka pola wymaganego, błąd (po pierwszej próbie albo dla pola już wypełnionego)
  function odswiezPola() {
    var bledy = {}, wid = {};
    K.waliduj(cur.doc, cur.dane).forEach(function (b) { if (!bledy[b.pole]) bledy[b.pole] = b.blad; });
    polaWidoczne().forEach(function (p) { wid[p.id] = true; });
    cur.doc.pola.forEach(function (p) {
      var box = document.querySelector('[data-f="' + p.id + '"]'), inp = $('f_' + p.id);
      if (!box) return;
      box.hidden = !wid[p.id];
      box.querySelector('[data-gw]').textContent = wymagane(p) ? '*' : '';
      var pokaz = bledy[p.id] && wid[p.id] && (cur.proba || !pusty(cur.dane[p.id]));
      inp.classList.toggle('bad', !!pokaz);
      box.querySelector('[data-err]').innerHTML = pokaz ? '<span class="pill p-red">' + esc(bledy[p.id].replace(/^Pole wymagane: .*/, 'Pole wymagane')) + '</span>' : '';
    });
    return Object.keys(bledy).filter(function (id) { return wid[id]; }).length;
  }

  function podglad(bloki) {
    var LIT = 'abcdefghijklmnoprstuwz';
    return bloki.map(function (b) {
      if (b.t === 'naglowek') return '<div class="hd"><div>' + b.lewo.filter(function (x) { return !pusty(x); }).map(function (x, i) { return i ? esc(x) : '<b>' + esc(x) + '</b>'; }).join('<br>') + '</div><div>' + esc(b.prawo || '') + '</div></div>';
      if (b.t === 'tytul') return '<p class="t">' + esc(b.tekst) + '</p>';
      if (b.t === 'podtytul') return '<p class="c">' + esc(b.tekst) + '</p>';
      if (b.t === 'adresat') return '<p class="r">' + b.linie.map(esc).join('<br>') + '</p>';
      if (b.t === 'paragraf') return '<p class="c"><b>' + esc(b.nr) + (b.tytul ? '<br>' + esc(b.tytul) : '') + '</b></p>';
      if (b.t === 'p') return '<p' + (b.styl === 'srodek' ? ' class="c"' : b.styl === 'maly' ? ' class="s"' : '') + '>' + (b.styl === 'bold' ? '<b>' + esc(b.tekst) + '</b>' : esc(b.tekst).replace(/\n/g, '<br>')) + '</p>';
      if (b.t === 'przypis') return '<p class="s">' + esc(b.tekst) + '</p>';
      if (b.t === 'lista') return b.typ === 'punkt' ? '<ul>' + b.pozycje.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'
        : '<p>' + b.pozycje.map(function (x, i) { return (b.typ === 'lit' ? LIT[i] : i + 1) + ') ' + esc(x); }).join('<br>') + '</p>';
      if (b.t === 'pola') return '<p>' + b.wiersze.map(function (w) { return '<b>' + esc(w[0]) + ':</b> ' + esc(w[1]); }).join('<br>') + '</p>';
      if (b.t === 'tabela') return '<table><tr>' + b.kolumny.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr>' + b.wiersze.map(function (w) { return '<tr>' + w.map(function (x) { return '<td>' + esc(x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>' +
        (b.puste_wiersze ? '<p class="s">+ ' + b.puste_wiersze + ' pustych wierszy do wypełnienia ręcznie' + (P.poziomo([b]) ? ' (strona pozioma)' : '') + '</p>' : '');
      if (b.t === 'podpisy') return '<div class="sg">' + (b.lewy ? '<div>' + esc(b.lewy) + '</div>' : '<span></span>') + (b.prawy ? '<div>' + esc(b.prawy) + '</div>' : '') + '</div>';
      if (b.t === 'pouczenie') return '<div class="po"><b>' + esc(b.tytul) + '</b>' + b.akapity.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '</div>';
      return '';
    }).join('');
  }
  var tPodglad = null;
  function odswiezPodglad() {
    clearTimeout(tPodglad);
    tPodglad = setTimeout(function () { var el = $('prev'); if (el && cur) el.innerHTML = podglad(K.render(cur.doc, cur.dane).bloki); }, 120);
  }

  function banerZatwierdzenia(doc) {
    if (!doc.do_zatwierdzenia) return '';
    var z = zatwierdzenie(doc), st = nieaktualne(doc);
    if (z) return '<div class="box"><span class="pill p-ok">wzór zatwierdzony</span> <span class="hint">' + esc(z.by || '—') + ', ' + esc(dzienPL(z.at)) + ' — zatwierdzenie dotyczy obecnej treści wzoru.</span> <button type="button" class="mini" data-a="cofnij">Cofnij zatwierdzenie</button></div>';
    return '<div class="warnbox"><b>Wzór własny biura — wymaga zatwierdzenia przez kadrową przed pierwszym użyciem.</b> ' +
      (st ? 'Treść wzoru zmieniła się po zatwierdzeniu (' + esc(st.by || '—') + ', ' + esc(dzienPL(st.at)) + ') — przeczytaj ją ponownie. ' : '') +
      'Do czasu zatwierdzenia każdy PDF ma w stopce dopisek „wzór do zatwierdzenia”.' +
      (zatw.gotowe ? '<br><button type="button" class="mini ok" data-a="zatwierdz">Zatwierdź wzór</button><span id="zMsg"></span>'
        : '<br>Zatwierdzanie w portalu nie jest jeszcze włączone (baza nie przyjmuje zapisu zatwierdzeń) — dopisek zostaje na każdym PDF.') + '</div>';
  }

  function opisFormy(doc) {
    var f = K.formaDla(doc, osoba.cudz), e = epodpis(doc, osoba.cudz);
    return '<h3>Forma i podpisy</h3><ul class="list"><li><b>' + FORMA[f.kategoria] + '</b> — podpisuje: ' + KTO[f.podpisuje] + (f.metody.length ? '; dopuszczalne: ' + f.metody.map(function (m) { return METODA[m]; }).join(', ') : '') + '.</li><li>' + esc(f.podstawa) + '</li>' +
      (f.rygor ? '<li>' + esc(f.rygor) + '</li>' : '') + (f.akta ? '<li>Akta: ' + esc(/^[A-E]$/.test(f.akta) ? 'część ' + f.akta + ' akt osobowych' : f.akta) + '.</li>' : '') +
      (doc.tresc.length && !e.ok ? '<li>' + esc(e.powod) + '</li>' : '') + '</ul>';
  }
  function opisPodstawy(doc) {
    var h = '';
    if (doc.podstawa.length) h += '<h3>Podstawa prawna</h3><ul class="list">' + doc.podstawa.map(function (p) { return '<li>' + esc(p.art) + ' — ' + esc(p.akt) + ' <small>(' + esc(String(p.eli).replace(/^DU\/(\d+)\/(\d+)$/, 'Dz. U. $1 poz. $2')) + ')</small></li>'; }).join('') + '</ul>';
    if (doc.zrodlo.akt || doc.zrodlo.uwaga) h += '<h3>Źródło wzoru</h3><p class="hint">' + esc([doc.zrodlo.akt, doc.zrodlo.uwaga].filter(Boolean).join(' — ')) + (doc.zrodlo.url && doc.zrodlo.typ !== 'link' ? ' <a href="' + esc(doc.zrodlo.url) + '" target="_blank" rel="noopener">Otwórz źródło</a>' : '') + '</p>';
    return h + '<p class="hint" style="margin-top:10px">Stan prawny katalogu: ' + esc(K.stan_prawny) + '.</p>';
  }
  function uwagi(doc) { return doc.uwagi.length ? '<div class="box"><h2>Uwagi praktyczne</h2><ul class="list">' + doc.uwagi.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul></div>' : ''; }

  function ktoHtml() {
    var w = osoba.worker;
    return '<h2>Firma i pracownik</h2><p class="hint">Wybierz z rejestru — dane wypełnią się same — albo zostaw puste i wpisz ręcznie.</p>' +
      '<div class="grid"><div><label for="selFirma">Firma</label><select id="selFirma"><option value="">— wszystkie / wpisz ręcznie —</option>' + firms.map(function (f) { return '<option value="' + f.nip + '"' + (osoba.firma === f.nip ? ' selected' : '') + '>' + esc(f.nazwa) + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="qPrac">Pracownik</label><input type="search" id="qPrac" placeholder="' + (zaladowano ? 'Wpisz nazwisko…' : 'Wczytuję rejestr…') + '" value="' + esc(w ? nazwaPrac(w) : '') + '" autocomplete="off" /></div></div>' +
      '<div id="cands"></div>' +
      (w ? '<div class="btns" style="margin-top:10px"><span class="pill p-navy">z rejestru: ' + esc(nazwaPrac(w)) + '</span><button type="button" class="mini" data-a="bezPrac">Wpisz ręcznie</button></div>' : '') +
      '<label class="chk"><input type="checkbox" id="cudz"' + (osoba.cudz ? ' checked' : '') + ' /><span>Pracownik jest cudzoziemcem<small>Ustawiane według obywatelstwa z rejestru; decyduje o wymaganej formie i o wersji dwujęzycznej.</small></span></label>';
  }
  function rysujKandydatow() {
    var el = $('cands'), q = ($('qPrac').value || '').trim().toLowerCase();
    if (!el) return;
    if (osoba.worker && q === nazwaPrac(osoba.worker).toLowerCase()) { el.innerHTML = ''; return; }
    if (!q && !osoba.firma) { el.innerHTML = ''; return; }
    var list = workers.filter(function (w) {
      var p = w.payload || {};
      if (osoba.firma && digits(p.z_nip) !== osoba.firma) return false;
      return !q || (nazwaPrac(w) + ' ' + (p.z_nazwa || '')).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 30);
    el.innerHTML = list.length ? '<div class="cands">' + list.map(function (w) { return '<button type="button" class="cand" data-w="' + esc(w.id) + '">' + esc(nazwaPrac(w)) + ' <small>· ' + esc((w.payload || {}).z_nazwa || '') + ((w.payload || {}).p_obywatelstwo ? ' · ' + esc(w.payload.p_obywatelstwo) : '') + '</small></button>'; }).join('') + '</div>'
      : (zaladowano ? '<p class="hint" style="margin:8px 0 0">Brak takiej osoby w rejestrze — wpisz dane ręcznie.</p>' : '');
  }

  function djHtml(doc) {
    var d = doc.dwujezyczny;
    if (d.poziom === 'nie') return '<h2>Wersja dwujęzyczna</h2><p class="hint">Ten dokument powstaje tylko po polsku. ' + esc(d.uwaga) + '</p>';
    var h = '<h2>Wersja dwujęzyczna</h2>';
    if (d.poziom === 'wymagany' && osoba.cudz) {
      h += '<div class="warnbox">Pracownik jest cudzoziemcem: ten dokument trzeba sporządzić także w wersji dla niego zrozumiałej (' + ART5 + ') — dlatego wersja dwujęzyczna jest domyślnie włączona.' +
        (dj.on ? '' : ' <b>Wyłączono ją — dokument tylko po polsku nie spełnia tego wymogu; dołącz tłumaczenie.</b>') + '</div>';
    } else h += '<p class="hint">' + esc(d.uwaga) + (d.poziom === 'wymagany' ? ' Dla cudzoziemca wersja dwujęzyczna jest wymagana (' + ART5 + ').' : '') + '</p>';
    h += '<label class="chk"><input type="checkbox" id="djOn"' + (dj.on ? ' checked' : '') + ' /><span>Wersja dwujęzyczna — tłumaczenie obok polskiego oryginału<small>Tłumaczenie przygotowuje AI tak jak w komplecie; pierwszy dokument w danym języku trwa dłużej, kolejne korzystają z zapamiętanych fragmentów.</small></span></label>';
    if (dj.on) h += '<div class="grid" style="margin-top:10px"><div><label for="djJezyk">Język tłumaczenia</label><input type="text" id="djJezyk" value="' + esc(dj.jezyk) + '" placeholder="' + esc(obywatelstwo() ? 'puste = wg obywatelstwa: ' + obywatelstwo() : 'np. ukraiński, rosyjski') + '" /></div></div>' +
      '<label class="chk"><input type="checkbox" id="djOpis"' + (dj.opisowe ? ' checked' : '') + ' /><span>Tłumacz także pola opisowe (przyczyna, zakres, opis)<small>Imiona, nazwiska, adresy, numery i daty nigdy nie są wysyłane do tłumaczenia. Treść pól opisowych — tak, gdy to pole jest zaznaczone; nie wpisuj w nich danych osób trzecich.</small></span></label>';
    return h;
  }

  function rysujDokument() {
    var doc = cur.doc, typ = doc.zrodlo.typ, h = '';
    h += '<div class="btns" style="margin:0 0 12px"><a class="mini" href="#">← Katalog dokumentów</a></div>';
    h += '<div class="box"><h2>' + esc(doc.nazwa) + '</h2><p class="hint">' + esc(doc.grupa) + ' · dla: ' + esc(DLA[doc.dla]) + '</p><div class="tags">' + pigulki(doc, osoba.cudz) + '</div></div>';
    if (typ === 'link') {
      h += '<div class="box"><h2>Formularz urzędowy</h2><p class="hint">Tego dokumentu portal nie generuje — składa się go na oryginalnym druku albo elektronicznie.</p>' +
        '<p style="font-size:14px;margin:0 0 10px">' + esc(doc.zrodlo.jak_zlozyc || '') + '</p><a class="mini go big" href="' + esc(doc.zrodlo.url) + '" target="_blank" rel="noopener">Otwórz oficjalne źródło</a>' +
        '<p class="hint" style="margin:8px 0 0;overflow-wrap:anywhere">' + esc(doc.zrodlo.url) + '</p></div>' + uwagi(doc) + (doc.podstawa.length ? '<div class="box">' + opisPodstawy(doc) + '</div>' : '');
    } else if (typ === 'biuro') {
      var kt = doc.zrodlo.komplet_typ === 'zlecenie' ? 'umowa zlecenia' : 'umowa o pracę', strona = doc.zrodlo.komplet_id ? 'umowa-zlecenie.html' : 'zalacznik-pobyt.html';
      h += '<div class="box"><h2>Ten dokument jest w ' + (doc.zrodlo.komplet_id ? '„Komplecie dokumentów”' : 'module „Legalizacja pobytu”') + '</h2>' +
        (doc.zrodlo.komplet_id ? '<p style="font-size:14px;margin:0 0 10px">Ma tam gotową, sprawdzoną treść — tutaj nie jest budowany drugi raz. Po otwarciu kompletu: wybierz rodzaj umowy „' + kt + '”, wczytaj pracownika, w sekcji „Dokumenty do wygenerowania” zostaw zaznaczony tylko dokument „' + esc(doc.nazwa) + '” i kliknij „Generuj”.</p>'
          : '<p style="font-size:14px;margin:0 0 10px">' + esc(doc.zrodlo.opis || '') + '</p>') +
        '<a class="mini go big" href="' + strona + '" target="_blank" rel="noopener">Otwórz ' + (doc.zrodlo.komplet_id ? '„Komplet dokumentów”' : 'stronę dokumentu') + '</a></div>' +
        uwagi(doc) + '<div class="box">' + opisFormy(doc) + opisPodstawy(doc) + '</div>';
    } else {
      var e = epodpis(doc, osoba.cudz);
      h += banerZatwierdzenia(doc);
      h += '<div class="cols"><div>' +
        '<div class="box" id="kto">' + ktoHtml() + '</div>' +
        '<div class="box"><h2>Dane dokumentu</h2><p class="hint">Pola z gwiazdką są wymagane. Pole nieobowiązkowe zostawione puste da w dokumencie kropki do uzupełnienia ręcznie albo „nie dotyczy”.</p>' + formularz() + '</div>' +
        '<div class="box" id="djBox">' + djHtml(doc) + '</div>' +
        '<div class="box"><h2>Gotowy dokument</h2><div id="stat"></div><div class="btns" style="margin-top:6px">' +
        '<button type="button" class="mini go big" data-a="generuj">Generuj PDF</button>' +
        '<button type="button" class="mini big" data-a="przyklad" title="Fikcyjne dane do wypróbowania wzoru">Wypełnij przykładem</button>' +
        '<button type="button" class="mini big" data-a="wyczysc">Wyczyść</button>' +
        (e.ok ? '<button type="button" class="mini big" data-a="podpis">✍️ Wyślij do podpisu elektronicznego</button>' : '') + '</div>' +
        (e.ok ? '' : '<p class="hint" style="margin:10px 0 0">' + esc(e.powod) + '</p>') + '</div>' +
        '</div><div>' +
        '<div class="box"><h2>Podgląd treści</h2><p class="hint">Tekst zmienia się razem z formularzem. Układ strony (marginesy, podział na strony) zobaczysz w PDF.</p><div class="prev" id="prev"></div></div>' +
        uwagi(doc) + '<div class="box"><h2>Forma i podstawa prawna</h2>' + opisFormy(doc) + opisPodstawy(doc) + '</div>' +
        '</div></div>';
    }
    $('doc').innerHTML = h;
    if (doc.tresc.length) { odswiezPola(); odswiezPodglad(); rysujKandydatow(); }
  }
  function stat(html, cls) { var el = $('stat'); if (el) el.innerHTML = html ? '<div class="' + (cls || 'hint') + '">' + html + '</div>' : ''; }
  function ustawWartosci() { cur.doc.pola.forEach(function (p) { var el = $('f_' + p.id); if (el) el.value = cur.dane[p.id] == null ? '' : cur.dane[p.id]; }); }
  function poZmianieOsoby() {
    ustawCudz(); domyslneDj();
    rysujDokument();
  }

  // ---------------- czcionki, tłumaczenie, PDF ----------------
  var czcionki = null, pisma = {};
  var PISMA = { georgian: ['fonts/NotoSansGeorgian-Regular.ttf', 'fonts/NotoSansGeorgian-Bold.ttf'], armenian: ['fonts/NotoSansArmenian-Regular.ttf', 'fonts/NotoSansArmenian-Bold.ttf'] };
  function plik(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('Brak czcionki: ' + u); return r.arrayBuffer(); }); }
  async function wczytajCzcionki(pismo) {
    if (!czcionki) { var a = await Promise.all([plik('fonts/Roboto-Regular.ttf'), plik('fonts/Roboto-Bold.ttf')]); czcionki = { regular: a[0], bold: a[1] }; }
    if (PISMA[pismo] && !pisma[pismo]) pisma[pismo] = await Promise.all(PISMA[pismo].map(plik));
    return { regular: czcionki.regular, bold: czcionki.bold, script: pisma[pismo] || null };
  }
  // ten sam mechanizm i ta sama pamięć podręczna co w komplecie (umowa-zlecenie.js, getTranslations)
  function kluczTr(target) { return 'tdcg_tr_v1_' + target.trim().toLowerCase(); }
  async function tlumaczenia(target, napisy, postep) {
    var cache = { map: {} };
    try { cache = JSON.parse(localStorage.getItem(kluczTr(target))) || cache; } catch (e) { /* brak */ }
    if (!cache.map) cache.map = {};
    var brak = napisy.filter(function (s) { return !cache.map[s]; });
    if (!brak.length) return cache;
    var tok = await token();
    if (!tok) throw new Error('Sesja wygasła — zaloguj się ponownie.');
    var chunks = [], c = [], len = 0;
    brak.forEach(function (s) { if (c.length && (len + s.length > TR_CHUNK_CHARS || c.length >= 40)) { chunks.push(c); c = []; len = 0; } c.push(s); len += s.length; });
    if (c.length) chunks.push(c);
    var done = 0, next = 0;
    async function worker() {
      while (next < chunks.length) {
        var chunk = chunks[next++];
        var res = await fetch(FN + 'translate-docs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ target: target, strings: chunk }) });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(body.error || ('Błąd tłumaczenia (' + res.status + ')'));
        chunk.forEach(function (s, i) { if (body.translations && body.translations[i]) cache.map[s] = body.translations[i]; });
        cache.script = body.script; cache.language = body.language; cache.fallback = !!body.fallback;
        try { localStorage.setItem(kluczTr(target), JSON.stringify(cache)); } catch (e) { /* limit pamięci */ }
        if (postep) postep(++done, chunks.length);
      }
    }
    var ws = []; for (var i = 0; i < Math.min(TR_PARALLEL, chunks.length); i++) ws.push(worker());
    await Promise.all(ws);
    return cache;
  }

  var CYR = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ё: 'e', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ы: 'y', э: 'e', ю: 'iu', я: 'ia', ь: '', ъ: '' };
  function ascii(s) {
    return String(s || '').replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, function (c) { return 'acelnoszzACELNOSZZ'['ąćęłńóśźżĄĆĘŁŃÓŚŹŻ'.indexOf(c)]; })
      .replace(/[Ѐ-ӿ]/g, function (c) { var l = c.toLowerCase(), t = CYR[l]; if (t === undefined) return ''; return l === c ? t : t.charAt(0).toUpperCase() + t.slice(1); })
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '');
  }
  function nazwisko() {
    var p = osoba.worker && osoba.worker.payload;
    if (p && p.p_nazwisko) return p.p_nazwisko;
    var w = String(cur.dane.p_imie_nazwisko || '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/);
    return w[w.length - 1] || '';
  }
  function nazwaPliku() { return [cur.doc.id, ascii(nazwisko()) || 'dokument', cur.dane.d_data || dzis()].join('_') + '.pdf'; }

  // buduje PDF bieżącego dokumentu; zwraca { bytes, uwaga, dwujezyczny }
  async function zbudujPdf(postep) {
    var doc = cur.doc, stopka = doZatwierdzenia(doc) ? 'wzór do zatwierdzenia' : '';
    var opts = { PDFLib: window.PDFLib, fontkit: window.fontkit, tytul: doc.nazwa, temat: 'Stan prawny ' + K.stan_prawny, stopka: stopka }, uwaga = '';
    if (dj.on && doc.dwujezyczny.poziom !== 'nie') {
      var target = (dj.jezyk || obywatelstwo() || '').trim();
      if (!target) throw new Error('Podaj język tłumaczenia albo obywatelstwo pracownika.');
      var sz = P.dwujezycznie(K, doc, cur.dane, dj.opisowe);
      var tr = await tlumaczenia(target, sz.napisy, postep);
      opts.fonts = await wczytajCzcionki(tr.script);
      opts.bloki = sz.bloki; opts.pl = sz.pl; opts.tr = sz.tr(tr.map);
      var braki = sz.braki(tr.map).length;
      uwaga = ' Tłumaczenie: ' + (tr.language || target) + (tr.fallback ? ' (język obywatelstwa nie jest obsługiwany w PDF — użyto angielskiego)' : '') + '.' +
        (braki ? ' Uwaga: ' + braki + ' fragment(ów) zostało bez tłumaczenia — sprawdź PDF.' : '');
    } else {
      opts.fonts = await wczytajCzcionki(null);
      opts.bloki = K.render(doc, cur.dane).bloki;
    }
    return { bytes: await P.zbuduj(opts), uwaga: uwaga, dwujezyczny: !!opts.tr };
  }

  async function generuj(mimoBrakow) {
    if (busy) return;
    cur.proba = true;
    var ile = odswiezPola();
    if (ile && !mimoBrakow) {
      stat('<span class="pill p-red">Do poprawienia: ' + ile + '</span> Uzupełnij albo popraw zaznaczone pola. Jeżeli dokument ma zostać wypełniony ręcznie na wydruku: <button type="button" class="mini" data-a="mimo">Generuj z pustymi polami</button>');
      var bad = document.querySelector('#doc .bad'); if (bad) bad.focus();
      return;
    }
    busy = true; var btn = document.querySelector('[data-a="generuj"]'); if (btn) btn.disabled = true;
    try {
      stat('Generowanie…');
      var out = await zbudujPdf(function (n, all) { stat('Tłumaczenie… ' + n + '/' + all); });
      var filename = nazwaPliku();
      var res = await window.DocHistory.download({
        docType: 'kadry-dokument', title: cur.doc.nazwa + (out.dwujezyczny ? ' (dwujęzyczny)' : ''), subject: [cur.dane.p_imie_nazwisko, cur.dane.z_nazwa].filter(Boolean).join(' — '), filename: filename,
        payload: { wzor: cur.doc.id, wersja: wersja(cur.doc), katalog: K.wersja, zatwierdzony: !doZatwierdzenia(cur.doc), dwujezyczny: out.dwujezyczny, zgloszenie_id: osoba.worker ? osoba.worker.id : null, dane: cur.dane },
        bytes: out.bytes,
      });
      stat('<span class="pill p-ok">Gotowe</span> ' + esc(filename) + (res && res.saved ? ' — pobrany i zapisany w historii.' : ' — pobrany. (Nie udało się zapisać w historii — sprawdź połączenie.)') + esc(out.uwaga) +
        (doZatwierdzenia(cur.doc) ? ' PDF ma w stopce dopisek „wzór do zatwierdzenia”.' : ''));
    } catch (e) {
      console.error(e);
      stat('<span class="pill p-red">Błąd</span> ' + esc(e.message || e));
    } finally { busy = false; if (btn) btn.disabled = false; }
  }

  // ---------------- podpis elektroniczny ----------------
  async function podpisy(body, file) {
    var init = { method: 'POST', headers: { apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() } };
    if (file) {
      var fd = new FormData();
      Object.keys(body).forEach(function (k) { if (body[k] != null) fd.append(k, String(body[k])); });
      fd.append('plik', new Blob([file], { type: 'application/pdf' }), 'dokument.pdf');
      init.body = fd;
    } else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var res = await fetch(FN + 'podpisy', init), out = await res.json().catch(function () { return {}; });
    if (!res.ok || out.error) throw new Error(out.error || 'Błąd ' + res.status);
    return out;
  }
  function sgSay(html) { $('sgRes').innerHTML = html; }
  function otworzPodpis() {
    cur.proba = true;
    if (odswiezPola()) { stat('<span class="pill p-red">Do poprawienia</span> Do podpisu można wysłać tylko kompletny dokument — uzupełnij zaznaczone pola.'); return; }
    var e = epodpis(cur.doc, osoba.cudz), p = osoba.worker && osoba.worker.payload;
    $('sgKto').innerHTML = '<b>' + esc(cur.dane.p_imie_nazwisko || '—') + '</b> · ' + esc(cur.dane.z_nazwa || '—') + ' · NIP ' + esc(digits(cur.dane.z_nip) || '—') +
      (osoba.worker ? '' : '<br>Pracownik nie został wybrany z rejestru — po podpisaniu dokument trafi do akt „do sprawdzenia” i trzeba go będzie przypisać ręcznie.');
    $('sgCudz').checked = osoba.cudz;
    $('sgTypBox').hidden = cur.doc.dla !== 'oba';
    $('sgTyp').value = cur.doc.dla === 'zleceniobiorca' ? 'zlecenie' : cur.doc.dla === 'pracownik' ? 'praca' : (p && p.u_typ === 'praca' ? 'praca' : p ? 'zlecenie' : 'praca');
    $('sgOpis').innerHTML = 'Do podpisu trafi jeden plik PDF: <b>' + esc(cur.doc.nazwa) + '</b>' + (dj.on && cur.doc.dwujezyczny.poziom !== 'nie' ? ' (wersja dwujęzyczna)' : '') + '. Podpisuje: ' + KTO[e.podpisuje] + '.' +
      (doZatwierdzenia(cur.doc) ? '<div class="warnbox" style="margin:8px 0 0">Wzór nie jest jeszcze zatwierdzony przez kadrową — PDF ma w stopce dopisek „wzór do zatwierdzenia”.</div>' : '');
    sgSay(''); $('sgGo').disabled = false; $('sgGo').hidden = false; $('sgCancel').textContent = 'Anuluj';
    $('sign').hidden = false;
  }
  async function wyslijPodpis() {
    if (busy || $('sign').hidden || !cur || odswiezPola()) return; // tylko z otwartego okna i tylko kompletny dokument
    busy = true; $('sgGo').disabled = true;
    var pid = null;
    try {
      var cudz = $('sgCudz').checked, e = epodpis(cur.doc, cudz);
      if (!e.ok) throw new Error(e.powod);
      var nip = digits(cur.dane.z_nip), w = osoba.worker;
      if (nip.length !== 10) throw new Error('Uzupełnij NIP pracodawcy (10 cyfr).');
      sgSay('Przygotowuję dokument…');
      var out = await zbudujPdf(function (n, all) { sgSay('Tłumaczenie… ' + n + '/' + all); });
      var zeZgloszenia = w && digits((w.payload || {}).z_nip) === nip;
      var made = await podpisy(zeZgloszenia
        ? { action: 'utworz', zgloszenie_id: w.id, nip: nip, typ: $('sgTyp').value, cudzoziemiec: cudz }
        : { action: 'utworz', nip: nip, firma: cur.dane.z_nazwa || '', worker_name: cur.dane.p_imie_nazwisko || '', typ: $('sgTyp').value, cudzoziemiec: cudz, bez_pesel: pusty(cur.dane.p_pesel) && !(w && (w.payload || {}).p_pesel) });
      pid = made.pakiet.id;
      sgSay('Wysyłam dokument…');
      await podpisy({ action: 'dokument_dodaj', pakiet: pid, rodzaj: e.rodzaj, tytul: cur.doc.nazwa, podpisuje: e.podpisuje, czesc: e.czesc }, out.bytes);
      await podpisy({ action: 'wydaj', id: pid });
      sgSay('✓ Pakiet został wydany pracodawcy. <a href="podpisy.html#' + esc(pid) + '">Otwórz w „Podpisach elektronicznych”</a> — tam skopiujesz link dla pracownika.');
      $('sgGo').hidden = true; $('sgCancel').textContent = 'Zamknij';
    } catch (err) {
      // niedokończony pakiet zostaje szkicem: pracodawca go nie widzi, można go anulować w podpisy.html
      sgSay('<span class="pill p-red">Błąd</span> ' + esc(err.message || err) + (pid ? ' Niedokończony pakiet pozostał szkicem — anuluj go w „Podpisach elektronicznych”.' : ''));
      $('sgGo').disabled = false;
    } finally { busy = false; }
  }

  // ---------------- zdarzenia ----------------
  function trasa() {
    var id = decodeURIComponent(location.hash.replace(/^#/, '')), doc = id ? wzor(id) : null;
    $('cat').hidden = !!doc; $('doc').hidden = !doc;
    if (doc) { otworz(doc); window.scrollTo(0, 0); } else { cur = null; rysujKatalog(); }
  }
  window.addEventListener('hashchange', trasa);
  $('q').addEventListener('input', function () { filtr.q = this.value.trim(); rysujKatalog(); });
  $('fDla').addEventListener('change', function () { filtr.dla = this.value; rysujKatalog(); });
  $('fGrupa').addEventListener('change', function () { filtr.grupa = this.value; rysujKatalog(); });
  $('tiles').addEventListener('click', function (e) { var b = e.target.closest('[data-z]'); if (!b) return; filtr.zrodlo = b.getAttribute('data-z'); rysujKatalog(); });
  $('groups').addEventListener('click', function (e) { var d = e.target.closest('.doc'); if (d && !e.target.closest('a')) location.hash = d.getAttribute('data-id'); });

  var docEl = $('doc');
  docEl.addEventListener('input', function (e) {
    var t = e.target, id = t.getAttribute('data-p');
    if (id) { cur.dane[id] = t.value; odswiezPola(); odswiezPodglad(); return; }
    if (t.id === 'qPrac') rysujKandydatow();
    if (t.id === 'djJezyk') dj.jezyk = t.value;
  });
  docEl.addEventListener('change', function (e) {
    var t = e.target, id = t.getAttribute('data-p');
    if (id === 'p_obywatelstwo' && !osoba.worker) { var bylo = osoba.cudz; ustawCudz(); if (bylo !== osoba.cudz) { domyslneDj(); poZmianieOsoby(); } return; }
    if (t.id === 'selFirma') {
      osoba.firma = t.value;
      if (osoba.worker && digits((osoba.worker.payload || {}).z_nip) !== osoba.firma) osoba.worker = null;
      if (osoba.firma && !osoba.worker) Object.assign(cur.dane, daneFirmy(cur.doc, osoba.firma));
      poZmianieOsoby();
    } else if (t.id === 'cudz') { osoba.cudz = t.checked; osoba.cudzRecznie = true; dj.reka = false; poZmianieOsoby(); }
    else if (t.id === 'djOn') { dj.on = t.checked; dj.reka = true; $('djBox').innerHTML = djHtml(cur.doc); }
    else if (t.id === 'djOpis') dj.opisowe = t.checked;
  });
  docEl.addEventListener('click', async function (e) {
    var c = e.target.closest('[data-w]');
    if (c) {
      osoba.worker = workers.filter(function (w) { return String(w.id) === c.getAttribute('data-w'); })[0] || null;
      if (osoba.worker) { osoba.firma = digits((osoba.worker.payload || {}).z_nip) || osoba.firma; osoba.cudzRecznie = false; Object.assign(cur.dane, zRejestru(cur.doc, osoba.worker.payload || {})); }
      poZmianieOsoby();
      return;
    }
    var b = e.target.closest('[data-a]'), a = b && b.getAttribute('data-a');
    if (!a) return;
    if (a === 'generuj') generuj(false);
    else if (a === 'mimo') generuj(true);
    else if (a === 'przyklad') { osoba.worker = null; osoba.firma = ''; osoba.cudzRecznie = false; cur.dane = K.przyklad(cur.doc); cur.proba = false; poZmianieOsoby(); stat('Wstawiono fikcyjne dane przykładowe — służą tylko do wypróbowania wzoru.'); }
    else if (a === 'wyczysc') { osoba.worker = null; osoba.firma = ''; osoba.cudzRecznie = false; cur.dane = K.domyslne(cur.doc, dzis()); cur.proba = false; poZmianieOsoby(); }
    else if (a === 'bezPrac') { osoba.worker = null; poZmianieOsoby(); }
    else if (a === 'podpis') otworzPodpis();
    else if (a === 'zatwierdz' || a === 'cofnij') {
      if (a === 'zatwierdz' && !confirm('Zatwierdzasz brzmienie wzoru „' + cur.doc.nazwa + '”. Przeczytaj podgląd treści (najlepiej z danymi przykładowymi) — po zatwierdzeniu dopisek „wzór do zatwierdzenia” zniknie z PDF. Kontynuować?')) return;
      b.disabled = true;
      try { await zapiszZatwierdzenie(cur.doc, a === 'zatwierdz'); rysujDokument(); }
      catch (err) { b.disabled = false; var m = $('zMsg'); if (m) m.innerHTML = ' <span class="pill p-red">' + esc(err.message || err) + '</span>'; else alert(err.message || err); }
    }
  });
  $('sgCancel').addEventListener('click', function () { if (!busy) $('sign').hidden = true; });
  $('sign').addEventListener('click', function (e) { if (e.target === $('sign') && !busy) $('sign').hidden = true; });
  $('sgGo').addEventListener('click', wyslijPodpis);

  // ---------------- start ----------------
  $('fGrupa').innerHTML = '<option value="">wszystkie grupy</option>' + K.GRUPY.map(function (g) { return '<option>' + esc(g) + '</option>'; }).join('');
  trasa();
  if (window.sb) {
    wczytajZatwierdzenia().then(function () { if (cur) rysujDokument(); else rysujKatalog(); });
    wczytajRejestr().then(function () {
      if (!cur || !cur.doc.tresc.length) return;
      var k = $('kto'); if (k) { k.innerHTML = ktoHtml(); rysujKandydatow(); }
    });
  }
  // do testów i dla innych modułów (np. podpisy): które dokumenty wolno wysłać do podpisu elektronicznego
  window.KadryDokumenty = { epodpis: epodpis, wersja: wersja, ukryte: UKRYTE };
})();
