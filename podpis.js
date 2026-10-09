/* Dokumenty do podpisu — the worker's page, opened by a personal link (podpis.html#t=<token>).
   No sign-in: the token in the link is the only key, it goes to the `podpisy` function in the
   x-podpis-token header and never into a URL the server sees. The worker downloads each
   document, signs it outside the portal (by hand on a printout, with podpis zaufany on
   podpis.gov.pl or with a qualified signature) and sends the result back here. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/podpisy';
  var MAX = 15 * 1024 * 1024; // the link's limit; photos are scaled down here before sending
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pl(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function plt(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

  // the token leaves the address bar at once (screenshots, shared screens); a reload still works
  var token = '';
  try {
    var m = /[#&]t=([A-Za-z0-9_-]{40,80})/.exec(location.hash);
    if (m) { token = m[1]; sessionStorage.setItem('tdcg_podpis_t', token); history.replaceState(null, '', location.pathname); }
    else token = sessionStorage.getItem('tdcg_podpis_t') || '';
  } catch (e) { /* private mode: the token stays in memory only */ }

  var pakiet = null, wybor = {}, komunikat = {}, rozwin = {};

  async function call(body, file) {
    var init = { method: 'POST', headers: { 'x-podpis-token': token } };
    if (file) {
      var fd = new FormData();
      Object.keys(body).forEach(function (k) { if (body[k] != null) fd.append(k, String(body[k])); });
      fd.append('plik', file, file.name || 'plik');
      init.body = fd;
    } else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var res, out;
    try { res = await fetch(FN, init); out = await res.json(); } catch (e) { throw new Error('Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.'); }
    if (!res.ok || out.error) { var err = new Error(out.error || 'Błąd ' + res.status); err.kod = out.kod; err.status = res.status; throw err; }
    return out;
  }
  function gate(msg) {
    $('lead').hidden = true; $('how').innerHTML = ''; $('docs').innerHTML = '';
    $('gateMsg').textContent = msg; $('gate').hidden = false; $('end').hidden = true;
  }
  // done on this device: the key is forgotten and nothing of the documents stays on the screen
  function koniec() {
    try { sessionStorage.removeItem('tdcg_podpis_t'); } catch (e) { /* nothing was stored */ }
    token = ''; pakiet = null;
    $('lead').hidden = true; $('how').innerHTML = ''; $('docs').innerHTML = ''; $('end').hidden = true;
    $('gate').querySelector('h2').textContent = 'Zakończono';
    $('gateMsg').textContent = 'Ta strona nie pamięta już Twojego linku. Żeby wrócić do dokumentów, otwórz link jeszcze raz. Jeżeli korzystasz z cudzego telefonu albo komputera — usuń wiadomość z linkiem i zamknij tę kartę.';
    $('gate').hidden = false;
  }

  // ---------------- how to sign: the three ways, in plain words ----------------
  var JAK = {
    odreczny: ['Odręcznie — wydruk i zdjęcie', 'Najprostszy sposób, nie wymaga żadnego konta.',
      ['Pobierz dokument i wydrukuj go (wszystkie strony).', 'Podpisz długopisem w miejscu na podpis.', 'Zrób wyraźne zdjęcie każdej strony telefonem albo zeskanuj dokument.', 'Wyślij tutaj zdjęcia (można kilka naraz) albo jeden plik PDF.']],
    zaufany: ['Podpis zaufany (profil zaufany, mObywatel)', 'Bezpłatny, przez internet. Potrzebny jest numer PESEL i profil zaufany.',
      ['Pobierz dokument (plik PDF) — nie otwieraj go w edytorze i niczego w nim nie zmieniaj.', 'Wejdź na podpis.gov.pl → „Podpisz dokument elektronicznie” → wybierz pobrany plik → „Podpisz podpisem zaufanym”.', 'Pobierz podpisany plik z podpis.gov.pl.', 'Wyślij tutaj ten podpisany plik PDF.']],
    kwalifikowany: ['Kwalifikowany podpis elektroniczny', 'Płatny podpis z certyfikatem (karta, aplikacja w telefonie) — jeżeli taki masz.',
      ['Pobierz dokument (plik PDF) i niczego w nim nie zmieniaj.', 'Podpisz go w swoim programie do podpisu — wybierz podpis wewnątrz pliku PDF (format PAdES), nie osobny plik .xml / .sig.', 'Wyślij tutaj podpisany plik PDF.']],
  };
  function howBox() {
    var bezPesel = pakiet.bez_pesel;
    return '<div class="box"><h2>Jak podpisać dokumenty</h2>' +
      '<p class="hint">Dokumenty podpisujesz poza tą stroną, a tutaj tylko je pobierasz i odsyłasz podpisane. Przy każdym dokumencie widać, jakie sposoby są dla niego dopuszczalne.' +
      (bezPesel ? ' <b>Jeżeli nie masz numeru PESEL ani profilu zaufanego — podpisz dokumenty odręcznie i wyślij zdjęcia.</b>' : '') + '</p>' +
      ['odreczny', 'zaufany', 'kwalifikowany'].map(function (k) {
        return '<h3>' + esc(JAK[k][0]) + '</h3><p class="hint" style="margin:0">' + esc(JAK[k][1]) + '</p><ol class="how">' + JAK[k][2].map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
      }).join('') +
      '<p class="hint" style="margin:12px 0 0">Przyjmujemy pliki PDF, JPG i PNG do 15 MB (zdjęcia zmniejszamy automatycznie). Podpisów w osobnych plikach (XAdES, .xml, .sig, .asic) w tej wersji nie obsługujemy.</p></div>';
  }

  // ---------------- one document ----------------
  var ST = { podpisz: ['do podpisania', 'p-amber'], potwierdz_odbior: ['do potwierdzenia odbioru', 'p-amber'], czeka_na_pracodawce: ['czeka na podpis pracodawcy', 'p-grey'], czeka_na_weryfikacje: ['wysłany — sprawdzamy', 'p-grey'] };
  function metodaDomyslna(d) {
    var ms = d.reguly.pracownik.metody, has = function (id) { return ms.some(function (x) { return x.id === id; }); };
    if (pakiet.bez_pesel && has('odreczny')) return 'odreczny';
    var pz = ms.filter(function (x) { return x.id === 'zaufany' && !x.ostrzezenie; })[0];
    return pz ? 'zaufany' : has('odreczny') ? 'odreczny' : (ms[0] || {}).id;
  }
  function dl(d, ktory, label) { return '<button type="button" class="mini" data-dl="' + ktory + '">' + esc(label) + '</button>'; }
  function docBox(d) {
    var z = d.zadanie, gotowy = d.status === 'gotowy' || d.status === 'w_aktach';
    var st = gotowy ? ['gotowy', 'p-ok'] : d.pracownik.status === 'odrzucony' ? ['do poprawy', 'p-red'] : ST[z] || [d.status_nazwa, 'p-grey'];
    var h = '<div class="box" data-id="' + esc(d.id) + '"><div class="head"><h2>' + esc(d.tytul) + '</h2><span class="pill ' + st[1] + '">' + esc(st[0]) + '</span></div>';
    var msg = komunikat[d.id] ? '<div class="msg ' + komunikat[d.id][0] + '">' + esc(komunikat[d.id][1]) + '</div>' : '';

    if (gotowy) {
      if (d.pracownik.wgral && d.pracownik.wgral !== 'pracownik' && d.pracownik.status === 'zweryfikowany') h += '<p class="hint">Skan z Twoim podpisem wgrał(o) ' + (d.pracownik.wgral === 'pracodawca' ? 'pracodawca' : 'biuro kadrowe') + '. Jeżeli to nie jest Twój podpis — zgłoś to działowi kadr.</p>';
      h += '<p class="hint">' + (d.podpisuje === 'potwierdzenie' ? 'Odbiór potwierdzony ' + plt(d.odbior_at) + '.' : 'Dokument jest podpisany i sprawdzony.') + ' Możesz pobrać swój egzemplarz.</p><div class="acts">' +
        d.finalne.map(function (k) { return dl(d, k, k === 'wydany' ? 'Pobierz dokument' : k === 'pracodawca' ? 'Pobierz egzemplarz podpisany przez pracodawcę' : d.pracownik.baza === 'pracodawca' ? 'Pobierz podpisany dokument' : 'Pobierz egzemplarz z Twoim podpisem'); }).join('') + '</div>';
      return h + msg + '</div>';
    }
    if (z === 'potwierdz_odbior') {
      // the legal basis comes from the server: not every "receipt only" document is the art. 29 § 3 information
      h += '<p class="hint">Tego dokumentu się nie podpisuje — pracodawca przekazuje Ci go do wiadomości. Pobierz go, przeczytaj i potwierdź, że go otrzymałaś/eś.</p>' +
        (d.reguly && d.reguly.pracownik && d.reguly.pracownik.podstawa ? '<p class="hint">' + esc(d.reguly.pracownik.podstawa) + '</p>' : '') +
        '<div class="acts">' + dl(d, 'wydany', 'Pobierz dokument') + '</div>' +
        '<label class="chk"><input type="checkbox" data-odb /><span>Potwierdzam, że otrzymałam/em ten dokument i mogę go zapisać oraz wydrukować.</span></label>' +
        '<button type="button" class="btn green wide" data-odbior disabled>Potwierdzam odbiór</button>';
      return h + msg + '</div>';
    }
    if (z === 'czeka_na_pracodawce') {
      h += '<p class="hint">Ten dokument najpierw podpisuje pracodawca. Gdy to zrobi, wróć na tę stronę tym samym linkiem — pojawi się tu miejsce na Twój podpis. Już teraz możesz przeczytać treść.</p><div class="acts">' + dl(d, 'wydany', 'Pobierz i przeczytaj') + '</div>';
      return h + msg + '</div>';
    }
    if (z !== 'podpisz' && z !== 'czeka_na_weryfikacje') return h + '<p class="hint" style="margin:0">' + esc(d.status_nazwa) + '</p>' + msg + '</div>';

    var ms = d.reguly.pracownik.metody, sel = wybor[d.id] || metodaDomyslna(d), cur = ms.filter(function (x) { return x.id === sel; })[0] || ms[0];
    wybor[d.id] = cur.id;
    // somebody else put a file here in the worker's name: the worker should know
    if (d.pracownik.wgral && d.pracownik.wgral !== 'pracownik' && d.pracownik.status !== 'oczekuje') h += '<div class="msg warn">' + (d.pracownik.wgral === 'pracodawca' ? 'Pracodawca wgrał' : 'Biuro kadrowe wgrało') + ' ' + plt(d.pracownik.at) + ' skan tego dokumentu jako podpisany przez Ciebie. Jeżeli to nie jest Twój podpis — zgłoś to od razu działowi kadr.</div>';
    if (d.pracownik.status === 'odrzucony') h += '<div class="msg err">Poprzedni plik nie został przyjęty: ' + esc(d.pracownik.odrzucenie || '') + '\nPodpisz dokument jeszcze raz i wyślij nowy plik.</div>';
    if (z === 'czeka_na_weryfikacje') h += '<div class="msg ok">Plik wysłany ' + plt(d.pracownik.at) + ' — dział kadr sprawdza podpis. Nic więcej nie musisz robić. Jeżeli wysłałaś/eś zły plik, możesz poniżej wysłać właściwy.</div>';
    // once a file is in, the form folds away
    var zwin = z === 'czeka_na_weryfikacje', pre = h;
    h = '';
    var elektr = d.do_podpisu === 'pracodawca';
    h += '<p class="hint" style="margin-top:8px">' + (d.pracodawca.status === 'zweryfikowany' ? 'Pracodawca już podpisał ten dokument. ' : '') + esc(d.reguly.pracownik.podstawa) + '</p>' +
      '<div class="acts">' + dl(d, 'do_podpisu', elektr ? 'Pobierz dokument do podpisu (z podpisem pracodawcy)' : 'Pobierz dokument do podpisu') +
      (d.pliki.indexOf('pracodawca') !== -1 && !elektr ? dl(d, 'pracodawca', 'Zobacz egzemplarz podpisany przez pracodawcę') : '') + '</div>' +
      '<h3>Wybierz, jak podpisujesz</h3>' + ms.map(function (x) {
        return '<label class="opt"><input type="radio" name="m_' + esc(d.id) + '" value="' + esc(x.id) + '"' + (x.id === cur.id ? ' checked' : '') + ' /><span>' + esc(JAK[x.id][0]) + (x.ostrzezenie ? ' — <b>niezalecany, z ostrzeżeniem</b>' : '') + '<small>' + esc(JAK[x.id][1]) + '</small></span></label>';
      }).join('');
    if (cur.uwaga) h += '<div class="msg ok">' + esc(cur.uwaga) + '</div>';
    if (cur.ostrzezenie) {
      // the server's text, word for word; the upload stays locked until it is accepted
      h += '<div class="msg warn"><b>Ostrzeżenie (' + esc(cur.ostrzezenie.wersja) + ')</b>' + esc(cur.ostrzezenie.tekst) + '</div>' +
        '<label class="chk"><input type="checkbox" data-ack /><span>' + esc(cur.ostrzezenie.potwierdzenie) + '</span></label>';
    }
    h += '<h3>' + (cur.id === 'odreczny' ? 'Wyślij zdjęcia albo skan podpisanego dokumentu' : 'Wyślij podpisany plik PDF') + '</h3>' +
      '<input type="file" data-file ' + (cur.id === 'odreczny' ? 'accept="image/jpeg,image/png,application/pdf" multiple' : 'accept="application/pdf"') + ' />' +
      '<p class="hint" style="margin:6px 0 0">' + (cur.id === 'odreczny' ? 'Wszystkie strony, wyraźnie, bez obciętych brzegów. Kilka zdjęć zostanie połączonych w jeden plik.' : 'Dokładnie ten plik, który zapisał program do podpisu albo podpis.gov.pl — bez drukowania do PDF i bez zmian.') + '</p>' +
      '<button type="button" class="btn wide" data-send' + (cur.ostrzezenie ? ' disabled' : '') + '>Wyślij</button>';
    if (zwin) h = '<details' + (rozwin[d.id] ? ' open' : '') + '><summary class="hint" style="cursor:pointer;margin:10px 0 0">Wyślij inny plik</summary>' + h + '</details>';
    return pre + h + msg + '</div>';
  }
  function render() {
    var n = pakiet.dokumenty.length, todo = pakiet.dokumenty.filter(function (d) { return d.zadanie === 'podpisz' || d.zadanie === 'potwierdz_odbior'; }).length;
    $('lead').hidden = false;
    $('lead').textContent = pakiet.worker_name + ' · ' + (pakiet.firma || 'pracodawca') + ' · ' + n + (n === 1 ? ' dokument' : ' dok.') +
      (pakiet.status === 'zakonczony' ? ' · wszystko podpisane — możesz pobrać swoje egzemplarze' : todo ? ' · do zrobienia: ' + todo : ' · nic do zrobienia w tej chwili') +
      (pakiet.link_wazny_do ? ' · link ważny do ' + pl(pakiet.link_wazny_do) : '');
    $('how').innerHTML = pakiet.dokumenty.some(function (d) { return d.zadanie === 'podpisz' || d.zadanie === 'czeka_na_pracodawce'; }) ? howBox() : '';
    $('docs').innerHTML = pakiet.dokumenty.map(docBox).join('');
    $('end').hidden = false;
  }
  async function load() {
    if (!token) return gate('Otwórz tę stronę linkiem, który otrzymałaś/eś od pracodawcy albo działu kadr. Sam adres strony nie wystarczy.');
    try { pakiet = (await call({ action: 'podglad' })).pakiet; render(); }
    catch (e) { gate(e.message); }
  }
  function doc(id) { return pakiet.dokumenty.filter(function (d) { return d.id === id; })[0]; }

  // Several photos become one PDF. Written here by hand (one JPEG per A4 page, nothing else) so
  // that this public page, which holds the link and personal documents, loads no third-party code.
  function zdjeciaDoPdf(pages) {
    var enc = new TextEncoder(), parts = [], offs = [], len = 0;
    function put(x) { var b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; }
    function obj(n, body) { offs[n] = len; put(n + ' 0 obj\n' + body + '\nendobj\n'); }
    put('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
    var kids = pages.map(function (_, i) { return (3 + i * 3) + ' 0 R'; }).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
    pages.forEach(function (im, i) {
      var n = 3 + i * 3, W = im.w > im.h ? 842 : 595, H = im.w > im.h ? 595 : 842, k = Math.min(W / im.w, H / im.h);
      var w = (im.w * k).toFixed(2), h = (im.h * k).toFixed(2), x = ((W - im.w * k) / 2).toFixed(2), y = ((H - im.h * k) / 2).toFixed(2);
      var draw = 'q ' + w + ' 0 0 ' + h + ' ' + x + ' ' + y + ' cm /Im0 Do Q';
      obj(n, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + (n + 2) + ' 0 R >> >> /Contents ' + (n + 1) + ' 0 R >>');
      obj(n + 1, '<< /Length ' + draw.length + ' >>\nstream\n' + draw + '\nendstream');
      offs[n + 2] = len;
      put((n + 2) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.byteLength + ' >>\nstream\n');
      put(new Uint8Array(im.bytes)); put('\nendstream\nendobj\n');
    });
    var count = 3 + pages.length * 3, xref = len, t = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
    for (var i = 1; i < count; i++) t += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    put(t + 'trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }
  function scaled(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 2200 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? b.arrayBuffer().then(function (buf) { ok({ bytes: buf, w: c.width, h: c.height }); }) : no(new Error('Nie udało się odczytać zdjęcia.')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('Nie udało się odczytać zdjęcia: ' + file.name)); };
      img.src = url;
    });
  }
  async function prepare(files, metoda) {
    var list = Array.prototype.slice.call(files);
    if (!list.length) throw new Error('Wybierz plik.');
    var isPdf = function (f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); }, isImg = function (f) { return f.type === 'image/jpeg' || f.type === 'image/png'; };
    if (list.some(function (f) { return !isPdf(f) && !isImg(f); })) throw new Error('Dozwolone są tylko pliki PDF, JPG i PNG.');
    if (metoda !== 'odreczny' && (list.length !== 1 || !isPdf(list[0]))) throw new Error('Wybierz jeden podpisany plik PDF.');
    if (list.length === 1) {
      // a big single photo is scaled down as well; a PDF goes as it is
      if (isImg(list[0]) && list[0].size > 4 * 1024 * 1024) { var one = await scaled(list[0]); return new File([one.bytes], 'zdjecie.jpg', { type: 'image/jpeg' }); }
      if (list[0].size > MAX) throw new Error('Plik jest za duży — najwyżej 15 MB.');
      return list[0];
    }
    if (list.some(isPdf)) throw new Error('Wybierz albo jeden plik PDF, albo zdjęcia stron (bez PDF).');
    if (list.length > 30) throw new Error('Najwyżej 30 zdjęć naraz.');
    var pages = [];
    for (var i = 0; i < list.length; i++) pages.push(await scaled(list[i]));
    var out = new File([zdjeciaDoPdf(pages)], 'skan.pdf', { type: 'application/pdf' });
    if (out.size > MAX) throw new Error('Zdjęcia są razem za duże — zrób je w niższej rozdzielczości albo wyślij skan PDF.');
    return out;
  }

  $('docs').addEventListener('change', function (e) {
    var box = e.target.closest('[data-id]'); if (!box) return;
    var id = box.getAttribute('data-id');
    if (e.target.type === 'radio') { wybor[id] = e.target.value; rozwin[id] = true; delete komunikat[id]; render(); return; }
    if (e.target.hasAttribute('data-ack')) box.querySelector('[data-send]').disabled = !e.target.checked;
    if (e.target.hasAttribute('data-odb')) box.querySelector('[data-odbior]').disabled = !e.target.checked;
  });
  $('docs').addEventListener('click', async function (e) {
    var b = e.target.closest('button'), box = e.target.closest('[data-id]');
    if (!b || !box) return;
    var id = box.getAttribute('data-id'), d = doc(id);
    var say = function (cls, text) { komunikat[id] = [cls, text]; };
    if (b.hasAttribute('data-dl')) {
      b.disabled = true;
      try {
        var f = await call({ action: 'plik', dokument: id, ktory: b.getAttribute('data-dl') });
        var a = document.createElement('a'); a.href = f.url; a.download = f.nazwa; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      } catch (err) { say('err', err.message); render(); return; }
      b.disabled = false;
      return;
    }
    if (b.hasAttribute('data-odbior')) {
      b.disabled = true;
      try { await call({ action: 'odbior', dokument: id, potwierdzam: true }); say('ok', 'Dziękujemy — odbiór został potwierdzony.'); }
      catch (err) { say('err', err.message); }
      return load();
    }
    if (b.hasAttribute('data-send')) {
      var metoda = wybor[id], cur = d.reguly.pracownik.metody.filter(function (x) { return x.id === metoda; })[0];
      var ack = box.querySelector('[data-ack]'), input = box.querySelector('[data-file]');
      if (cur.ostrzezenie && !(ack && ack.checked)) return;
      var old = b.textContent; b.disabled = true; b.textContent = 'Wysyłam…';
      try {
        var file = await prepare(input.files, metoda);
        var out = await call({ action: 'wgraj', dokument: id, metoda: metoda, potwierdzam: cur.ostrzezenie ? 'true' : null, ostrzezenie_wersja: cur.ostrzezenie ? cur.ostrzezenie.wersja : null }, file);
        rozwin[id] = false; say('ok', out.wiazanie === 'wzrokowa' ? 'Plik został wysłany. Dział kadr porówna go z dokumentem i potwierdzi przyjęcie.' : 'Podpisany plik został wysłany. Dział kadr sprawdzi podpis i treść dokumentu.');
      } catch (err) {
        // stay on the form: the chosen way and the acknowledgement are kept
        b.disabled = false; b.textContent = old;
        var old2 = box.querySelector('.msg.err[data-up]'); if (old2) old2.remove();
        var el = document.createElement('div'); el.className = 'msg err'; el.setAttribute('data-up', ''); el.textContent = err.message; box.appendChild(el);
        return;
      }
      return load();
    }
  });
  $('endBtn').addEventListener('click', koniec);
  load();
})();
