/* Baza klientów — a client's Telegram group created from the portal (administrators).
   Two windows of klienci.html, both fed by the `telegram-grupa` edge function:
     #tgg  one client: the plan as it will be posted (title, topics, every message as a preview with an
           "Edytuj" switch), the client's ZUS account, which staff to add — then the creation with its
           steps, and the result: invitation link, QR code. An interrupted creation is continued here.
     #tgs  the template: title pattern, topics, messages per topic (text, pin, variant), bots, daily cap.
   The function does the Telegram work as the office's technical account; this page only shows and asks.
   Nothing here talks to Telegram, and the QR code is drawn in the browser (qr-svg.js).
     window.TgGrupa.otworz(klient, { po })   klient: { id, nazwa, nip }; po(): called after a creation
     window.TgGrupa.szablon()
     window.TgGrupa.zamknij(id)              closes a window unless a creation is running */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/telegram-grupa';
  var NIE_PODLACZONE = 'Konto Telegram biura nie jest jeszcze podłączone — administrator musi wykonać jednorazowe logowanie';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('tgg') || !$('tgs')) return;
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  async function token() { var s = await window.sb.auth.getSession(); return s && s.data && s.data.session ? s.data.session.access_token : ''; }
  async function api(action, body) {
    try {
      var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() }, body: JSON.stringify(Object.assign({ action: action }, body || {})) });
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok && !j.error) j.error = res.status === 404 ? 'Funkcja tworzenia grup nie jest jeszcze wdrożona.' : 'Błąd ' + res.status;
      return j;
    } catch (e) { return { error: 'Brak połączenia z serwerem — spróbuj ponownie.' }; }
  }
  // A message as Telegram will show it. Everything is escaped first; only the few tags Telegram
  // understands are given back, links only to http(s), mailto and tg addresses.
  function podgladHtml(html) {
    return esc(html)
      .replace(/&lt;(\/?)(b|strong|i|em|u|s|del|code|pre)&gt;/gi, '<$1$2>')
      .replace(/&lt;a href=&quot;((?:https?:\/\/|mailto:|tg:\/\/)[^&\s<>]*)&quot;&gt;/gi, function (_m, u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">'; })
      .replace(/&lt;\/a&gt;/gi, '</a>')
      .replace(/\{\{[#\/]?\w+\}\}/g, function (m) { return '<mark>' + m + '</mark>'; });
  }
  function lista(pozycje) { return pozycje.map(function (p) { return '<li class="s-' + p[0] + '"><i>' + { ok: '✓', uwaga: '!', brak: '✕', info: 'i', czeka: '…' }[p[0]] + '</i><span>' + p[1] + '</span></li>'; }).join(''); }

  // ================================================================ one client
  var K = null, nr = 0, zwloka = null, sonda = null;
  function otworz(klient, opcje) {
    if (K && K.trwa) return;
    K = { klient: klient, po: (opcje || {}).po, zm: { warianty: {}, wiadomosci: {}, osoby: {} }, p: null, edycja: {}, tryb: 'form', id: null, trwa: false, wymus: false, czekaj: 0 };
    $('tggKto').textContent = klient.nazwa + (klient.nip ? ' · NIP ' + klient.nip : '');
    $('tggStan').textContent = 'Ładowanie…'; $('tggStan').hidden = false;
    $('tggForm').hidden = true; $('tggPostep').hidden = true; $('tggWynik').hidden = true; $('tggWynik').innerHTML = '';
    $('tggMsg').textContent = ''; $('tggMsg').className = 'err'; $('tggZusMsg').textContent = ''; $('tggTytul').value = ''; $('tggZus').value = '';
    $('tggGo').disabled = true; $('tggGo').textContent = 'Utwórz grupę'; $('tggCancel').disabled = false;
    $('tgg').hidden = false;
    odswiez(true);
  }
  function zamknijKlienta() {
    if (!K || K.trwa) return false;
    clearTimeout(zwloka); clearInterval(sonda);
    K = null; $('tgg').hidden = true;
    return true;
  }
  // the plan with the current changes; a newer request makes an older answer irrelevant
  async function odswiez(pierwszy) {
    if (!K) return;
    var ja = ++nr, k = K;
    var r = await api('podglad', { klient_id: k.klient.id, zmiany: k.zm });
    if (K !== k || ja !== nr) return;
    if (r.error || !r.podglad) { if (pierwszy) { $('tggStan').innerHTML = '<span class="warn">' + esc(r.error || 'Nie udało się przygotować podglądu.') + '</span>'; } else $('tggMsg').textContent = r.error || ''; return; }
    k.p = r;
    if (pierwszy) {
      $('tggTytul').value = r.podglad.tytul; $('tggZus').value = r.klient.rachunek_zus || ''; $('tggMikro').value = r.klient.mikrorachunek || 'brak poprawnego NIP';
      if (r.niedokonczona) { k.tryb = 'przerwa'; k.id = r.niedokonczona.id; }
    }
    rysuj();
  }
  function pozniej() { clearTimeout(zwloka); zwloka = setTimeout(function () { odswiez(false); }, 450); }

  function rysuj() {
    var k = K, p = k.p; if (!p) return;
    var stan = [];
    if (!p.skonfigurowano) stan.push('<span class="warn"><b>' + NIE_PODLACZONE + '.</b></span> Teksty można już przejrzeć i poprawić — grupa powstanie po podłączeniu konta.');
    else stan.push('Grupę założy konto Telegram biura; portal doda bota, opublikuje i przypnie instrukcje w tematach. Osoby po stronie klienta dodasz potem linkiem. W ostatniej dobie utworzono ' + p.dzis + ' z ' + p.limit + ' dozwolonych grup.');
    if (p.ma_grupe && k.tryb === 'form') stan.push('<span class="warn">Ten klient ma już wpisaną grupę (id czatu ' + esc(p.ma_grupe.chat_id) + '). Nowa grupa zastąpi to id w danych klienta.</span> <span class="checks" style="display:inline-flex"><label><input type="checkbox" id="tggWymus"' + (k.wymus ? ' checked' : '') + ' /> mimo to utwórz nową grupę</label></span>');
    $('tggStan').innerHTML = stan.join('<br>');

    if (k.tryb === 'przerwa' && !k.trwa && p.niedokonczona && !$('tggWynik').innerHTML) {
      var n = p.niedokonczona;
      $('tggForm').hidden = true; $('tggPostep').hidden = false;
      rysujKroki(n.postep);
      $('tggMsg').textContent = 'Tworzenie grupy „' + n.tytul + '” z dnia ' + pl(n.created_at) + ' nie zostało dokończone' + (n.blad ? ': ' + n.blad : '.');
      $('tggWynik').hidden = false;
      $('tggWynik').innerHTML = '<p class="hint" style="margin:10px 0 0">„Dokończ” kontynuuje od miejsca przerwania — nie powstanie druga grupa i żadna wiadomość się nie powtórzy.</p>' +
        '<div class="acts"><button type="button" class="mini del" id="tggOdNowa">Porzuć tę próbę i zacznij od nowa…</button></div>';
      $('tggGo').textContent = 'Dokończ'; $('tggGo').disabled = !p.skonfigurowano;
      return;
    }
    if (k.tryb !== 'form') return;
    $('tggForm').hidden = false;
    var pg = p.podglad;
    $('tggOsoby').innerHTML = pg.osoby.length ? pg.osoby.map(function (o) {
      var kto = o.rola === 'ksiegowa' ? 'księgową / księgowego' : 'kadrową / kadrowego';
      return '<label><input type="checkbox" data-os="' + o.rola + '"' + (o.dodaj ? ' checked' : '') + (o.mozna ? '' : ' disabled') + ' /> <span>Dodaj ' + kto + ': <b>' + esc(o.imie_nazwisko || o.skrot) + '</b>' +
        (o.mozna ? ' <small>@' + esc(o.username) + '</small>' : ' <small>' + (o.imie_nazwisko ? 'brak nazwy w Telegramie — uzupełnij w module Zespół' : 'skrót „' + esc(o.skrot) + '” nie ma profilu w module Zespół') + '</small>') + '</span></label>';
    }).join('') : '<span class="sub">Klient nie ma przypisanego opiekuna ani kadrowej.</span>';
    $('tggBoty').innerHTML = pg.boty.length ? 'Boty: ' + pg.boty.map(function (b) { return '<b>@' + esc(b.username) + '</b>' + (b.admin ? ' (administrator)' : ''); }).join(', ') + '.' : 'Szablon nie przewiduje żadnego bota.';
    $('tggUwagi').innerHTML = lista(pg.blokady.map(function (b) { return ['brak', esc(b)]; }).concat(pg.ostrzezenia.map(function (o) { return ['uwaga', esc(o)]; })));
    // while a text is being typed the topics are left alone (the caret would be lost)
    var pisze = document.activeElement && document.activeElement.tagName === 'TEXTAREA' && $('tggTematy').contains(document.activeElement);
    if (!pisze) rysujTematy();
    var mozna = p.skonfigurowano && !pg.blokady.length && (!p.ma_grupe || k.wymus);
    $('tggGo').textContent = 'Utwórz grupę'; $('tggGo').disabled = !mozna;
    if (!$('tggMsg').getAttribute('data-trwale')) $('tggMsg').textContent = !p.skonfigurowano ? NIE_PODLACZONE + '.' : pg.blokady.length ? 'Popraw pozycje zaznaczone na czerwono — wtedy grupę będzie można utworzyć.' : '';
  }
  function rysujTematy() {
    var k = K, pg = k.p.podglad, h = '';
    pg.tematy.forEach(function (t) {
      h += '<h4>Temat: ' + esc(t.nazwa) + (t.ogolny ? ' (ogólny, wbudowany)' : '') + '</h4>';
      var grupy = [];
      t.wiadomosci.forEach(function (w) { if (w.grupa && grupy.indexOf(w.grupa) === -1) grupy.push(w.grupa); });
      grupy.forEach(function (g) {
        var wg = t.wiadomosci.filter(function (w) { return w.grupa === g; }), wybrana = wg.filter(function (w) { return w.wybrana; })[0];
        h += '<label>' + esc(g) + ' — wariant</label><select data-g="' + esc(t.klucz + '/' + g) + '">' + wg.map(function (w) {
          return '<option value="' + esc(w.klucz) + '"' + (w.wybrana ? ' selected' : '') + '>' + esc(w.nazwa) + (w.auto ? ' — według danych klienta' : '') + '</option>';
        }).join('') + '<option value=""' + (wybrana ? '' : ' selected') + '>— nie wysyłaj —</option></select>';
      });
      var pokazane = t.wiadomosci.filter(function (w) { return w.grupa ? w.wybrana : true; });
      if (!pokazane.length) h += '<p class="hint" style="margin:8px 0 0">W tym temacie nie zostanie opublikowana żadna wiadomość.</p>';
      pokazane.forEach(function (w) {
        var ed = !!k.edycja[w.id], zm = k.zm.wiadomosci[w.id] || {};
        h += '<div class="doc" data-m="' + esc(w.id) + '"><div class="n"><b>' + esc(w.nazwa) + '</b>' +
          (w.edytowana ? '<small>treść zmieniona dla tej grupy</small>' : '') + (w.wybrana && w.braki.length ? '<small class="warn">brak danych: ' + esc(w.braki.map(function (b) { return '{{' + b + '}}'; }).join(', ')) + '</small>' : '') + '</div>' +
          '<div class="acts"><span class="checks">' + (w.grupa ? '' : '<label><input type="checkbox" data-wl="1"' + (w.wybrana ? ' checked' : '') + ' /> wyślij</label>') +
          '<label><input type="checkbox" data-pin="1"' + (w.przypnij ? ' checked' : '') + (w.wybrana ? '' : ' disabled') + ' /> przypnij</label></span>' +
          '<button type="button" class="mini" data-e="1">' + (ed ? 'Pokaż podgląd' : 'Edytuj') + '</button>' + (w.edytowana ? '<button type="button" class="mini" data-r="1">Przywróć szablon</button>' : '') + '</div></div>' +
          (ed ? '<textarea class="kod" data-tx="' + esc(w.id) + '" maxlength="8000" spellcheck="false">' + esc(typeof zm.html === 'string' ? zm.html : w.html) + '</textarea><div class="hint" style="margin:4px 0 0">Formatowanie jak w Telegramie: &lt;b&gt;pogrubienie&lt;/b&gt;, &lt;i&gt;kursywa&lt;/i&gt;, &lt;a href="…"&gt;link&lt;/a&gt;. Zmiana dotyczy tylko tej grupy — wzór poprawia się w „Szablon grupy Telegram”.</div>'
            : '<div class="note msg"' + (w.wybrana ? '' : ' style="opacity:.55"') + '>' + podgladHtml(w.html) + '</div>');
      });
    });
    $('tggTematy').innerHTML = h;
  }
  function rysujKroki(kroki) {
    $('tggKroki').innerHTML = lista((kroki || []).map(function (s) { return [s.stan, esc(s.krok)]; }));
  }
  function wiad(id) { return K.zm.wiadomosci[id] || (K.zm.wiadomosci[id] = {}); }

  $('tggTytul').addEventListener('input', function () { if (K) { K.zm.tytul = this.value; pozniej(); } });
  $('tggZus').addEventListener('input', function () { if (K) { K.zm.rachunek_zus = this.value; $('tggZusMsg').textContent = ''; pozniej(); } });
  $('tggZusZapisz').addEventListener('click', async function () {
    if (!K) return;
    this.disabled = true;
    var r = await api('rachunek_zus', { klient_id: K.klient.id, rachunek_zus: $('tggZus').value });
    this.disabled = false;
    $('tggZusMsg').textContent = r.error || (r.rachunek_zus ? 'Zapisano u klienta.' : 'Usunięto rachunek z danych klienta.') + (r.uwaga ? ' ' + r.uwaga : '');
  });
  $('tggStan').addEventListener('change', function (e) { if (K && e.target.id === 'tggWymus') { K.wymus = e.target.checked; rysuj(); } });
  $('tggOsoby').addEventListener('change', function (e) { var r = e.target.getAttribute('data-os'); if (K && r) { K.zm.osoby[r] = e.target.checked; odswiez(false); } });
  $('tggTematy').addEventListener('change', function (e) {
    if (!K) return;
    var el = e.target, m = el.closest('[data-m]');
    if (el.getAttribute('data-g')) { K.zm.warianty[el.getAttribute('data-g')] = el.value; odswiez(false); }
    else if (m && el.getAttribute('data-wl')) { wiad(m.getAttribute('data-m')).wlacz = el.checked; odswiez(false); }
    else if (m && el.getAttribute('data-pin')) { wiad(m.getAttribute('data-m')).przypnij = el.checked; odswiez(false); }
  });
  $('tggTematy').addEventListener('input', function (e) { var id = e.target.getAttribute('data-tx'); if (K && id) { wiad(id).html = e.target.value; pozniej(); } });
  $('tggTematy').addEventListener('click', function (e) {
    if (!K) return;
    var b = e.target.closest('button'), m = b && b.closest('[data-m]'); if (!m) return;
    var id = m.getAttribute('data-m');
    if (b.getAttribute('data-e')) { K.edycja[id] = !K.edycja[id]; rysujTematy(); if (!K.edycja[id]) odswiez(false); }
    else if (b.getAttribute('data-r')) { delete wiad(id).html; K.edycja[id] = false; odswiez(false); }
  });

  // ---- the creation itself: one long call; meanwhile the steps saved so far are read every moment
  async function biegnij(akcja, body) {
    var k = K;
    k.trwa = true; k.tryb = 'bieg';
    $('tggForm').hidden = true; $('tggPostep').hidden = false; $('tggWynik').hidden = true; $('tggWynik').innerHTML = '';
    $('tggMsg').removeAttribute('data-trwale'); $('tggMsg').className = 'hint'; $('tggMsg').textContent = 'Tworzę grupę — to potrwa około pół minuty. Nie zamykaj okna.';
    $('tggGo').disabled = true; $('tggCancel').disabled = true; $('tggGo').textContent = 'Tworzę…';
    if (akcja === 'utworz') rysujKroki([{ stan: 'czeka', krok: 'Grupa „' + $('tggTytul').value + '” z tematami' }]);
    clearInterval(sonda);
    sonda = setInterval(async function () { var s = await api('postep', { id: k.id }); if (K === k && k.trwa && s && s.postep) rysujKroki(s.postep); }, 1500);
    var r = await api(akcja, body);
    clearInterval(sonda);
    if (K !== k) return;
    k.trwa = false; $('tggCancel').disabled = false; $('tggMsg').className = 'err';
    // refused before anything started (or nothing reached Telegram): back to the form with the reason
    if ((!r.id && !r.postep) || r.porzucono) {
      if (r.niedokonczona) { k.tryb = 'przerwa'; k.id = r.niedokonczona.id; $('tggPostep').hidden = true; return odswiez(false); }
      k.tryb = akcja === 'utworz' ? 'form' : 'przerwa';
      $('tggPostep').hidden = akcja === 'utworz';
      $('tggMsg').setAttribute('data-trwale', '1'); $('tggMsg').textContent = r.error || 'Nie udało się utworzyć grupy.';
      if (k.tryb === 'form') rysuj(); else { $('tggGo').textContent = 'Dokończ'; $('tggGo').disabled = false; }
      $('tggMsg').removeAttribute('data-trwale');
      return;
    }
    k.id = r.id || k.id;
    rysujKroki(r.postep);
    var uw = (r.ostrzezenia || []).length ? '<ul class="chk" style="margin-top:10px">' + lista(r.ostrzezenia.map(function (o) { return ['uwaga', esc(o)]; })) + '</ul>' : '';
    var link = r.link ? '<dl class="kv" style="margin-top:10px"><dt>Nazwa grupy</dt><dd>' + esc(r.tytul) + '</dd><dt>Id czatu</dt><dd>' + esc(r.chat_id) + '</dd>' +
      '<dt>Link z zaproszeniem</dt><dd><a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer">' + esc(r.link) + '</a> <button type="button" class="mini" id="tggKopiuj" data-link="' + esc(r.link) + '">Kopiuj</button></dd></dl>' +
      (window.QrSvg ? '<div class="qr">' + window.QrSvg.svg(r.link, { size: 200 }) + '</div>' : '') : '';
    $('tggWynik').hidden = false;
    if (r.ok) {
      k.tryb = 'wynik';
      $('tggMsg').textContent = '';
      $('tggWynik').innerHTML = '<h4>Grupa gotowa</h4>' + link + '<div class="note"><b>Teraz dodaj osoby po stronie klienta</b> — wyślij im link albo pokaż kod QR. Link wymaga zatwierdzenia: każda osoba, która z niego skorzysta, wysyła prośbę o dołączenie, a administrator grupy (konto biura) akceptuje ją w Telegramie. Id czatu zostało zapisane w danych klienta.</div>' + uw;
      $('tggGo').textContent = 'Gotowe'; $('tggGo').disabled = false;
    } else {
      k.tryb = 'przerwa'; k.czekaj = r.czekaj || 0;
      $('tggMsg').textContent = r.error || 'Tworzenie grupy zostało przerwane.';
      $('tggWynik').innerHTML = (link ? '<h4>Grupa istnieje — brakuje ostatnich kroków</h4>' + link : '') + uw + '<p class="hint" style="margin:10px 0 0">To, co oznaczone ✓, zostało już zrobione i nie będzie powtarzane. „Dokończ” wykona resztę.</p>';
      $('tggGo').textContent = 'Dokończ';
      // Telegram asked for a pause: the button wakes up when it has passed
      if (k.czekaj) { $('tggGo').disabled = true; setTimeout(function () { if (K === k && k.tryb === 'przerwa' && !k.trwa) $('tggGo').disabled = false; }, Math.min(k.czekaj, 600) * 1000); }
      else $('tggGo').disabled = false;
    }
    if (r.link && k.po) { try { k.po(r); } catch (e) {} }
  }
  $('tggGo').addEventListener('click', function () {
    if (!K || K.trwa) return;
    if (K.tryb === 'wynik') return void zamknijKlienta();
    if (K.tryb === 'przerwa') return void biegnij('dokoncz', { id: K.id });
    var pg = K.p && K.p.podglad; if (!pg || pg.blokady.length || !K.p.skonfigurowano) return;
    var ile = 0; pg.tematy.forEach(function (t) { ile += t.wiadomosci.filter(function (w) { return w.wybrana; }).length; });
    if (!confirm('Utworzyć w Telegramie grupę „' + pg.tytul + '”?\n\nPowstanie grupa z ' + pg.tematy.length + ' tematami i ' + ile + ' wiadomościami. Tej operacji nie da się cofnąć z portalu.')) return;
    K.id = window.crypto.randomUUID();
    biegnij('utworz', { klient_id: K.klient.id, zmiany: K.zm, potwierdzam: true, id: K.id, wymus: K.wymus });
  });
  $('tggWynik').addEventListener('click', async function (e) {
    if (!K) return;
    if (e.target.id === 'tggKopiuj') {
      var b = e.target;
      try { await navigator.clipboard.writeText(b.getAttribute('data-link')); b.textContent = 'Skopiowano'; } catch (x) { b.textContent = 'Zaznacz link i skopiuj ręcznie'; }
      setTimeout(function () { b.textContent = 'Kopiuj'; }, 2500);
    } else if (e.target.id === 'tggOdNowa') {
      if (!confirm('Porzucić przerwaną próbę i założyć grupę od nowa?\n\nJeśli tamta grupa już istnieje w Telegramie, pozostanie tam — usuń ją ręcznie, żeby klient nie miał dwóch grup.')) return;
      K.tryb = 'form'; K.wymus = true; K.id = null;
      $('tggPostep').hidden = true; $('tggWynik').hidden = true; $('tggWynik').innerHTML = ''; $('tggMsg').textContent = '';
      rysuj();
    }
  });
  $('tggCancel').addEventListener('click', zamknijKlienta);
  $('tggX').addEventListener('click', zamknijKlienta);
  $('tgg').addEventListener('click', function (e) { if (e.target === $('tgg')) zamknijKlienta(); });

  // ================================================================ the template
  var S = null;
  function kopia(o) { return JSON.parse(JSON.stringify(o)); }
  async function otworzSzablon() {
    S = { sz: null, zmieniony: false };
    $('tgsStan').textContent = 'Ładowanie…'; $('tgsForm').hidden = true; $('tgsMsg').textContent = ''; $('tgsSave').disabled = true;
    $('tgs').hidden = false;
    var s = S, w = await Promise.all([api('szablon'), api('stan'), api('lista')]);
    if (S !== s) return;
    if (w[0].error || !w[0].szablon) { $('tgsStan').innerHTML = '<span class="warn">' + esc(w[0].error || 'Nie udało się wczytać szablonu.') + '</span>'; return; }
    s.sz = w[0].szablon; s.domyslny = w[0].domyslny; s.zmienne = w[0].zmienne || []; s.warunki = w[0].warunki || []; s.wlasny = w[0].wlasny; s.grupy = w[2].grupy || [];
    rysujStan(w[1]); rysujSzablon();
    $('tgsForm').hidden = false; $('tgsSave').disabled = false;
  }
  function rysujStan(st) {
    st = st || {};
    $('tgsStan').innerHTML = st.error ? '<span class="warn">' + esc(st.error) + '</span>'
      : !st.skonfigurowano ? '<span class="warn"><b>' + NIE_PODLACZONE + '.</b></span> Właściciel konta uruchamia raz na swoim komputerze <b>deno run -A tools/tg-sesja.ts</b> — powstaje osobna sesja tylko dla portalu. Szablon można przygotować już teraz.'
      : 'Konto Telegram biura: ' + (st.konto ? '<b>@' + esc(st.konto) + '</b>' + (st.sprawdzono_at ? ' (połączenie sprawdzone ' + pl(st.sprawdzono_at) + ')' : '') : 'podłączone, połączenie jeszcze niesprawdzone') + '. ' +
        (st.blad ? '<span class="warn">' + esc(st.blad) + '</span> ' : '') + 'W ostatniej dobie utworzono ' + (st.dzis || 0) + ' z ' + (st.limit || 0) + ' grup. <button type="button" class="mini" id="tgsSprawdz">Sprawdź połączenie</button>';
  }
  function rysujSzablon() {
    var sz = S.sz;
    $('tgsTytul').value = sz.tytul; $('tgsOpis').value = sz.opis || ''; $('tgsLimit').value = sz.limit_dzienny; $('tgsStawka').value = sz.stawka_godzinowa || '';
    $('tgsBoty').innerHTML = sz.boty.length ? sz.boty.map(function (b, i) {
      return '<div class="q"><span style="flex:1"><input type="text" data-s="bot" data-i="' + i + '" maxlength="40" value="' + esc(b.username ? '@' + b.username : '') + '" placeholder="@nazwa_bota" autocomplete="off" /></span>' +
        '<span class="acts"><span class="checks"><label><input type="checkbox" data-s="bot-admin" data-i="' + i + '"' + (b.admin ? ' checked' : '') + ' /> administrator</label></span><button type="button" class="mini del" data-s="bot-usun" data-i="' + i + '">Usuń</button></span></div>';
    }).join('') : '<p class="hint" style="margin:0">Żaden bot nie będzie dodawany.</p>';
    $('tgsZmienne').innerHTML = S.zmienne.map(function (z) { return '<b>{{' + esc(z[0]) + '}}</b> — ' + esc(z[1]); }).join('<br>') +
      '<br>Pole bez wartości zatrzymuje utworzenie grupy, dopóki ktoś nie poprawi treści — puste miejsce nigdy nie trafi do klienta.';
    var grupy = [];
    sz.tematy.forEach(function (t) { t.wiadomosci.forEach(function (w) { if (w.grupa && grupy.indexOf(w.grupa) === -1) grupy.push(w.grupa); }); });
    var h = '<datalist id="tgsGrupy">' + grupy.map(function (g) { return '<option value="' + esc(g) + '"></option>'; }).join('') + '</datalist>';
    sz.tematy.forEach(function (t, ti) {
      h += '<h4>Temat ' + (ti + 1) + (t.ogolny ? ' — ogólny (wbudowany w Telegram, zawsze pierwszy)' : '') + '</h4>' +
        '<div class="q" style="border-top:none;align-items:flex-end"><span style="flex:1"><label style="margin-top:0">Nazwa tematu</label><input type="text" data-s="t-nazwa" data-t="' + ti + '" maxlength="128" value="' + esc(t.nazwa) + '"' + (t.ogolny ? ' disabled' : '') + ' /></span>' +
        (t.ogolny ? '' : '<span class="acts" style="padding-bottom:4px"><button type="button" class="mini" data-s="t-gora" data-t="' + ti + '"' + (ti <= 1 ? ' disabled' : '') + ' aria-label="Przesuń temat wyżej">▲</button><button type="button" class="mini" data-s="t-dol" data-t="' + ti + '"' + (ti === sz.tematy.length - 1 ? ' disabled' : '') + ' aria-label="Przesuń temat niżej">▼</button><button type="button" class="mini del" data-s="t-usun" data-t="' + ti + '">Usuń temat</button></span>') + '</div>';
      t.wiadomosci.forEach(function (w, wi) {
        var a = ' data-t="' + ti + '" data-w="' + wi + '"';
        h += '<details' + (w._o ? ' open' : '') + a + '><summary>' + esc(w.nazwa || 'Wiadomość') + (w.przypnij ? ' <span class="pill p-navy">przypięta</span>' : '') + (w.grupa ? ' <span class="pill p-grey">wariant: ' + esc(w.grupa) + '</span>' : '') + '</summary>' +
          '<div class="two"><div><label>Nazwa (widoczna tylko w portalu)</label><input type="text" data-s="w-nazwa"' + a + ' maxlength="80" value="' + esc(w.nazwa) + '" /></div>' +
          '<div><label>Grupa wariantów (puste = osobna wiadomość)</label><input type="text" data-s="w-grupa"' + a + ' maxlength="60" list="tgsGrupy" value="' + esc(w.grupa || '') + '" /></div></div>' +
          '<div class="two"><div><label>Kiedy wysyłać</label><select data-s="w-warunek"' + a + '>' + S.warunki.concat(S.warunki.some(function (x) { return x[0] === (w.warunek || ''); }) ? [] : [[w.warunek, w.warunek]]).map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === (w.warunek || '') ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></div>' +
          '<div class="checks" style="align-self:end;padding-bottom:10px"><label><input type="checkbox" data-s="w-pin"' + a + (w.przypnij ? ' checked' : '') + ' /> przypnij w temacie (bez powiadomienia)</label></div></div>' +
          '<textarea class="kod" data-s="w-html"' + a + ' maxlength="8000" spellcheck="false">' + esc(w.html) + '</textarea>' +
          '<div class="acts" style="margin:6px 0 10px"><button type="button" class="mini" data-s="w-gora"' + a + (wi === 0 ? ' disabled' : '') + ' aria-label="Przesuń wiadomość wyżej">▲</button><button type="button" class="mini" data-s="w-dol"' + a + (wi === t.wiadomosci.length - 1 ? ' disabled' : '') + ' aria-label="Przesuń wiadomość niżej">▼</button><button type="button" class="mini del" data-s="w-usun"' + a + '>Usuń wiadomość</button></div></details>';
      });
      h += '<div class="acts" style="margin-top:8px"><button type="button" class="mini" data-s="w-dodaj" data-t="' + ti + '">Dodaj wiadomość w temacie „' + esc(t.nazwa) + '”</button></div>';
    });
    $('tgsTematy').innerHTML = h;
    var ST = { w_toku: ['w toku / przerwana', 'p-amber'], gotowa: ['gotowa', 'p-ok'], blad: ['błąd', 'p-red'] };
    $('tgsLista').innerHTML = S.grupy.length ? '<table><thead><tr><th>Kiedy</th><th>Grupa</th><th>Stan</th><th>Kto</th></tr></thead><tbody>' + S.grupy.slice(0, 30).map(function (g) {
      var st = g.porzucono ? ['porzucona', 'p-grey'] : ST[g.status] || [g.status, 'p-grey'];
      return '<tr><td>' + pl(g.created_at) + '</td><td>' + esc(g.tytul) + (g.blad && g.status !== 'gotowa' ? '<small class="warn">' + esc(g.blad) + '</small>' : '') + (g.link ? '<small>' + esc(g.link) + '</small>' : '') + '</td><td><span class="pill ' + st[1] + '">' + st[0] + '</span></td><td>' + esc(g.utworzyl) + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="hint" style="margin:0">Portal nie utworzył jeszcze żadnej grupy.</p>';
  }
  function przesun(l, i, o) { var j = i + o; if (j < 0 || j >= l.length) return; var x = l[i]; l[i] = l[j]; l[j] = x; }
  // typing changes the template in memory only; nothing is redrawn, so the caret stays where it is
  function poleSzablonu(e) {
    if (!S || !S.sz) return;
    var el = e.target, s = el.getAttribute('data-s'), sz = S.sz, ti = +el.getAttribute('data-t'), wi = +el.getAttribute('data-w'), i = +el.getAttribute('data-i');
    if (el.id === 'tgsTytul') sz.tytul = el.value; else if (el.id === 'tgsOpis') sz.opis = el.value; else if (el.id === 'tgsLimit') sz.limit_dzienny = parseInt(el.value, 10) || 0; else if (el.id === 'tgsStawka') sz.stawka_godzinowa = el.value.trim();
    else if (s === 'bot') sz.boty[i].username = el.value.trim().replace(/^@/, ''); else if (s === 'bot-admin') sz.boty[i].admin = el.checked;
    else if (s === 't-nazwa') sz.tematy[ti].nazwa = el.value;
    else if (s === 'w-nazwa') sz.tematy[ti].wiadomosci[wi].nazwa = el.value; else if (s === 'w-grupa') sz.tematy[ti].wiadomosci[wi].grupa = el.value.trim();
    else if (s === 'w-warunek') sz.tematy[ti].wiadomosci[wi].warunek = el.value; else if (s === 'w-pin') sz.tematy[ti].wiadomosci[wi].przypnij = el.checked; else if (s === 'w-html') sz.tematy[ti].wiadomosci[wi].html = el.value;
    else return;
    S.zmieniony = true; $('tgsMsg').textContent = '';
  }
  $('tgsForm').addEventListener('input', poleSzablonu);
  $('tgsForm').addEventListener('change', poleSzablonu);
  // which messages are unfolded survives a redraw
  $('tgsTematy').addEventListener('toggle', function (e) { var d = e.target; if (S && S.sz && d.tagName === 'DETAILS') { var w = (S.sz.tematy[+d.getAttribute('data-t')] || { wiadomosci: [] }).wiadomosci[+d.getAttribute('data-w')]; if (w) w._o = d.open; } }, true);
  $('tgsForm').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-s]'); if (!b || !S || !S.sz) return;
    var s = b.getAttribute('data-s'), sz = S.sz, ti = +b.getAttribute('data-t'), wi = +b.getAttribute('data-w'), i = +b.getAttribute('data-i');
    if (s === 'bot-dodaj') { if (sz.boty.length >= 5) return; sz.boty.push({ username: '', admin: true }); }
    else if (s === 'bot-usun') sz.boty.splice(i, 1);
    else if (s === 'temat-dodaj') { if (sz.tematy.length >= 10) return; sz.tematy.push({ klucz: '', nazwa: 'Nowy temat', ogolny: false, wiadomosci: [] }); }
    else if (s === 't-usun') { if (sz.tematy[ti].wiadomosci.length && !confirm('Usunąć temat „' + sz.tematy[ti].nazwa + '” razem z jego wiadomościami?')) return; sz.tematy.splice(ti, 1); }
    else if (s === 't-gora') { if (ti > 1) przesun(sz.tematy, ti, -1); }
    else if (s === 't-dol') przesun(sz.tematy, ti, 1);
    else if (s === 'w-dodaj') { if (sz.tematy[ti].wiadomosci.length >= 12) return; sz.tematy[ti].wiadomosci.push({ klucz: '', nazwa: 'Nowa wiadomość', html: '', przypnij: false, grupa: '', warunek: '', _o: true }); }
    else if (s === 'w-usun') { if (!confirm('Usunąć wiadomość „' + sz.tematy[ti].wiadomosci[wi].nazwa + '” z szablonu?')) return; sz.tematy[ti].wiadomosci.splice(wi, 1); }
    else if (s === 'w-gora') przesun(sz.tematy[ti].wiadomosci, wi, -1);
    else if (s === 'w-dol') przesun(sz.tematy[ti].wiadomosci, wi, 1);
    else return;
    S.zmieniony = true; rysujSzablon();
  });
  $('tgsStan').addEventListener('click', async function (e) {
    if (e.target.id !== 'tgsSprawdz' || !S) return;
    e.target.disabled = true; e.target.textContent = 'Sprawdzam…';
    var s = S, st = await api('stan', { sprawdz: true });
    if (S === s) rysujStan(st);
  });
  $('tgsDomyslny').addEventListener('click', function () {
    if (!S || !S.domyslny) return;
    if (!confirm('Wczytać do okna szablon domyślny (teksty biura z istniejących grup)? Obecny szablon zostanie zastąpiony dopiero po kliknięciu „Zapisz szablon”.')) return;
    S.sz = kopia(S.domyslny); S.zmieniony = true; rysujSzablon(); $('tgsMsg').textContent = 'Wczytano szablon domyślny — jeszcze nie zapisano.';
  });
  $('tgsSave').addEventListener('click', async function () {
    if (!S || !S.sz) return;
    this.disabled = true;
    var s = S, r = await api('szablon_zapisz', { szablon: s.sz });
    this.disabled = false;
    if (S !== s) return;
    if (r.error) { $('tgsMsg').textContent = r.error; return; }
    // the stored shape comes back tidied (keys, trimmed texts); unfolded messages stay unfolded
    var otwarte = {};
    s.sz.tematy.forEach(function (t, ti) { t.wiadomosci.forEach(function (w, wi) { if (w._o) otwarte[ti + '/' + wi] = 1; }); });
    s.sz = r.szablon; s.zmieniony = false;
    s.sz.tematy.forEach(function (t, ti) { t.wiadomosci.forEach(function (w, wi) { if (otwarte[ti + '/' + wi]) w._o = true; }); });
    rysujSzablon(); $('tgsMsg').textContent = 'Zapisano — obowiązuje dla następnych grup.';
  });
  function zamknijSzablon() {
    if (!S) return true;
    if (S.zmieniony && !confirm('Zamknąć bez zapisywania zmian w szablonie?')) return false;
    S = null; $('tgs').hidden = true;
    return true;
  }
  $('tgsCancel').addEventListener('click', zamknijSzablon);
  $('tgsX').addEventListener('click', zamknijSzablon);
  $('tgs').addEventListener('click', function (e) { if (e.target === $('tgs')) zamknijSzablon(); });

  window.TgGrupa = { otworz: otworz, szablon: otworzSzablon, zamknij: function (id) { return id === 'tgs' ? zamknijSzablon() : zamknijKlienta(); }, podgladHtml: podgladHtml };
})();
