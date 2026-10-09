/* Podpisy elektroniczne — the office's view of signing packages.
   Everything goes through the `podpisy` edge function (contract at the top of
   supabase/functions/podpisy/index.ts); the browser writes nothing to the tables itself.
   A package = one worker's documents, each a separate PDF: issued → employer signs → kadry
   verify → worker signs → kadry verify → filed in Akta osobowe. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/podpisy';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pl(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function plt(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  var PST = { szkic: 'p-grey', u_pracodawcy: 'p-navy', u_pracownika: 'p-navy', weryfikacja: 'p-amber', gotowy: 'p-ok', zakonczony: 'p-ok', anulowany: 'p-grey' };
  var KROK = { nie_dotyczy: ['nie dotyczy', 'p-grey'], oczekuje: ['czeka', 'p-grey'], wgrany: ['do weryfikacji', 'p-amber'], zweryfikowany: ['zweryfikowany', 'p-ok'], odrzucony: ['odrzucony', 'p-red'] };
  var METODA = { kwalifikowany: 'podpis kwalifikowany', zaufany: 'podpis zaufany', odreczny: 'odręczny (skan)' };
  // "prefiks" says only that the issued bytes are inside the upload — not that nothing was added
  function wiaz(k) {
    if (k.wiazanie === 'prefiks') return 'zawiera wydany plik (dopisano ' + (k.rewizje == null ? '?' : k.rewizje) + ' ' + (k.rewizje === 1 ? 'rewizję' : 'rewizji') + ' — treść mogła zostać zmieniona dopiskiem)';
    return k.wiazanie === 'wzrokowa' ? 'do weryfikacji wzrokowej' : k.wiazanie === 'pominiete' ? 'bez powiązania z wydanym plikiem' : '';
  }
  var MAX_MB = 24;
  var AKCJA = { utworzenie: 'utworzono pakiet', dokument_dodany: 'dodano dokument', dokument_usuniety: 'usunięto dokument', wydanie: 'wydano pracodawcy', link_utworzony: 'nowy link dla pracownika', link_uniewazniony: 'unieważniono link',
    otwarcie: 'otwarto link', pobranie: 'pobrano plik', wgranie: 'wgrano plik', weryfikacja: 'zweryfikowano podpis', odrzucenie: 'odrzucono podpis', odbior: 'potwierdzono odbiór', do_akt: 'przeniesiono do akt', zakonczenie: 'zamknięto pakiet', anulowanie: 'anulowano pakiet' };

  var rows = [], reguly = null, workers = [], tab = 'wer', q = '', open = {};
  // SHA-256 of the files this officer has downloaded in this session: a signature is confirmed
  // for the file that was actually looked at, not for whatever is stored by then
  var widziane = {};

  async function token() { var s = await window.sb.auth.getSession(); return s && s.data && s.data.session ? s.data.session.access_token : ''; }
  async function call(body, file) {
    var init = { method: 'POST', headers: { apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() } };
    if (file) {
      var fd = new FormData();
      Object.keys(body).forEach(function (k) { if (body[k] != null) fd.append(k, String(body[k])); });
      fd.append('plik', file, file.name || 'plik');
      init.body = fd;
    } else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var res = await fetch(FN, init), out = await res.json().catch(function () { return {}; });
    if (!res.ok || out.error) throw new Error(out.error || 'Błąd ' + res.status);
    return out;
  }
  function pak(id) { return rows.filter(function (p) { return p.id === id; })[0]; }
  function dok(id) { for (var i = 0; i < rows.length; i++) for (var j = 0; j < rows[i].dokumenty.length; j++) if (rows[i].dokumenty[j].id === id) return { p: rows[i], d: rows[i].dokumenty[j] }; return null; }

  // ---------------- list ----------------
  var TABS = [
    ['wer', 'Do weryfikacji', function (p) { return p.status === 'weryfikacja'; }],
    ['got', 'Do zamknięcia', function (p) { return p.status === 'gotowy'; }],
    ['pd', 'U pracodawcy', function (p) { return p.status === 'u_pracodawcy'; }],
    ['pr', 'U pracownika', function (p) { return p.status === 'u_pracownika'; }],
    ['szk', 'Szkice', function (p) { return p.status === 'szkic'; }],
    ['zak', 'Zakończone', function (p) { return p.status === 'zakonczony'; }],
    ['anu', 'Anulowane', function (p) { return p.status === 'anulowany'; }],
    ['all', 'Wszystkie', function () { return true; }],
  ];
  function match(p) { return !q || [p.worker_name, p.firma, p.nip, p.dokumenty.map(function (d) { return d.tytul; }).join(' ')].join(' ').toLowerCase().indexOf(q) !== -1; }
  function pill(text, cls, title) { return '<span class="pill ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>'; }
  function stepPill(who, k) {
    if (k.status === 'nie_dotyczy') return '';
    var st = KROK[k.status] || [k.status, 'p-grey'];
    return pill(who + ': ' + (k.status === 'oczekuje' ? 'czeka na podpis' : (METODA[k.metoda] || '') + ' — ' + st[0]), st[1],
      [k.at && 'wgrano ' + plt(k.at) + (k.wgral ? ' (' + k.wgral + ')' : ''), k.zweryfikowano_at && (k.status === 'odrzucony' ? 'odrzucono ' : 'zweryfikowano ') + plt(k.zweryfikowano_at) + (k.zweryfikowal ? ' — ' + k.zweryfikowal : '')].filter(Boolean).join('; '));
  }
  // per-document trail: issued → employer → worker → akta
  function steps(d, p) {
    var out = [pill(p.status === 'szkic' ? 'przygotowany' : 'wydany', p.status === 'szkic' ? 'p-grey' : 'p-ok', p.wydano_at ? 'wydano ' + plt(p.wydano_at) : '')];
    var a = stepPill('pracodawca', d.pracodawca), b = stepPill('pracownik', d.pracownik);
    if (a) out.push(a);
    if (b) out.push(b);
    if (d.podpisuje === 'potwierdzenie') out.push(pill(d.odbior_at ? 'odbiór potwierdzony ' + plt(d.odbior_at) : 'pracownik: czeka na potwierdzenie odbioru', d.odbior_at ? 'p-ok' : 'p-grey'));
    out.push(pill(d.status === 'w_aktach' ? 'w aktach osobowych' : 'akta', d.status === 'w_aktach' ? 'p-ok' : 'p-grey'));
    return '<div class="steps">' + out.join('<i>→</i>') + '</div>';
  }
  function stepInfo(who, x, k) {
    if (k.status === 'nie_dotyczy' || k.status === 'oczekuje') return '';
    return '<small>' + who + ': ' + [METODA[k.metoda], esc(wiaz(k)) + (k.baza === 'pracodawca' ? ' — na pliku podpisanym przez pracodawcę' : ''), k.wgral && k.wgral.indexOf(x === 'pd' ? 'pracodawca:' : 'pracownik:') !== 0 && 'wgrał(a): ' + esc(k.wgral), k.ostrzezenie && 'ostrzeżenie ' + esc(k.ostrzezenie.wersja) + ' potwierdzone ' + plt(k.ostrzezenie.at),
      k.raport && k.raport.podpisujacy && 'wg weryfikatora podpisał(a): ' + esc(k.raport.podpisujacy), 'SHA-256 ' + esc((k.sha256 || '').slice(0, 16)) + '…'].filter(Boolean).join(' · ') + '</small>' +
      (k.ten_sam ? '<small>' + pill('ten sam pracownik biura wgrał i zweryfikował plik', 'p-amber', 'Brak zasady dwóch par oczu — odnotowano w dzienniku i w aktach') + '</small>' : '') +
      (k.odrzucenie ? '<small style="color:#b91c1c">Odrzucono: ' + esc(k.odrzucenie) + '</small>' : '');
  }
  function docRow(d, p) {
    var live = ['u_pracodawcy', 'u_pracownika', 'weryfikacja', 'gotowy'].indexOf(p.status) !== -1 && d.status !== 'w_aktach';
    var acts = ['<button type="button" class="mini" data-a="plik" data-k="wydany">Wydany plik</button>'];
    [['pracodawca', 'pracodawcy'], ['pracownik', 'pracownika']].forEach(function (s) {
      var k = d[s[0]];
      if (k.sha256) acts.push('<button type="button" class="mini" data-a="plik" data-k="' + s[0] + '">Plik ' + s[1] + '</button>');
      if (live && k.status === 'wgrany') {
        acts.push('<button type="button" class="mini ok" data-a="ok" data-s="' + s[0] + '">Zweryfikowano</button>');
        acts.push('<button type="button" class="mini del" data-a="odrzuc" data-s="' + s[0] + '">Odrzuć</button>');
      } else if (live && k.status === 'zweryfikowany' && !(s[0] === 'pracodawca' && ['wgrany', 'zweryfikowany'].indexOf(d.pracownik.status) !== -1)) {
        acts.push('<button type="button" class="mini del" data-a="odrzuc" data-s="' + s[0] + '">Cofnij weryfikację ' + s[1] + '</button>');
      }
    });
    if (live && (['oczekuje', 'odrzucony'].indexOf(d.pracodawca.status) !== -1 || (['oczekuje', 'odrzucony'].indexOf(d.pracownik.status) !== -1 && ['zweryfikowany', 'nie_dotyczy'].indexOf(d.pracodawca.status) !== -1))) {
      acts.push('<button type="button" class="mini" data-a="wgraj" title="Plik, który biuro otrzymało poza portalem">Wgraj otrzymany plik</button>');
    }
    if (p.status === 'szkic') acts.push('<button type="button" class="mini del" data-a="usun">Usuń</button>');
    var need = d.status.indexOf('weryfikacja') === 0, elektr = need && (d.status === 'weryfikacja_pracodawcy' ? d.pracodawca : d.pracownik).metoda !== 'odreczny';
    return '<div class="doc" data-id="' + esc(d.id) + '"><div class="n"><b>' + esc(d.tytul) + '</b>' +
      '<small>' + esc(d.rodzaj_nazwa) + ' · podpisuje: ' + esc(d.podpisuje_nazwa) + (d.czesc ? ' · akta część ' + esc(d.czesc) : '') + '</small>' +
      steps(d, p) + stepInfo('Pracodawca', 'pd', d.pracodawca) + stepInfo('Pracownik', 'pr', d.pracownik) + '</div>' +
      '<div class="acts">' + pill(d.status_nazwa, need ? 'p-amber' : d.status === 'gotowy' || d.status === 'w_aktach' ? 'p-ok' : 'p-grey') +
      (elektr ? '<a class="mini" href="https://podpis.gov.pl" target="_blank" rel="noopener noreferrer">podpis.gov.pl ↗</a>' : '') + acts.join('') + '</div></div>';
  }
  function pakRow(p) {
    var a = [];
    if (p.status === 'szkic') a.push('<button type="button" class="mini" data-p="dodaj">＋ Dodaj dokument</button>', '<button type="button" class="mini ok" data-p="wydaj">Wydaj pracodawcy</button>');
    if (['u_pracodawcy', 'u_pracownika', 'weryfikacja', 'gotowy', 'zakonczony'].indexOf(p.status) !== -1) a.push('<button type="button" class="mini" data-p="link">' + (p.link ? 'Nowy link dla pracownika' : 'Kopiuj link dla pracownika') + '</button>');
    if (p.link) a.push('<button type="button" class="mini" data-p="unlink">Unieważnij link</button>');
    if (p.status === 'gotowy') a.push('<button type="button" class="mini ok" data-p="zakoncz">Zamknij i przenieś do akt</button>');
    a.push('<button type="button" class="mini" data-p="log">Dziennik</button>');
    if (['zakonczony', 'anulowany'].indexOf(p.status) === -1) a.push('<button type="button" class="mini del" data-p="anuluj">Anuluj pakiet</button>');
    var link = p.link ? (p.link.aktywny ? 'link pracownika ważny do ' + pl(p.link.wazny_do) : 'link pracownika wygasł ' + pl(p.link.wazny_do)) : 'bez linku dla pracownika';
    return '<div class="firm' + (open[p.id] ? ' open' : '') + '" data-pak="' + esc(p.id) + '"><div class="fhead"><div><strong>' + esc(p.worker_name) + '</strong> <small>' + esc(p.firma || '—') + ' · NIP ' + esc(p.nip) +
      ' · ' + (p.typ === 'praca' ? 'umowa o pracę' : 'umowa zlecenia') + ' · ' + p.dokumenty.length + ' dok. · ' + pl(p.created_at) + '</small></div>' +
      '<div class="pills">' + (p.cudzoziemiec ? pill('cudzoziemiec', 'p-navy', 'Umowa wymaga formy pisemnej — art. 5 ust. 1 ustawy o powierzaniu pracy cudzoziemcom') : '') + (p.bez_pesel ? pill('bez PESEL', 'p-grey', 'Domyślna droga pracownika: podpis odręczny + skan') : '') +
      pill(p.status_nazwa, PST[p.status] || 'p-grey') + '<span>›</span></div></div><div class="fbody">' +
      '<div class="hint" style="margin:0 0 6px">' + esc(link) + (p.zgloszenie_id ? '' : ' · bez zgłoszenia — w aktach trafi do „do sprawdzenia”') + (p.anulowano_powod ? ' · anulowano: ' + esc(p.anulowano_powod) : '') + (p.uwagi ? ' · ' + esc(p.uwagi) : '') + '</div>' +
      (p.dokumenty.length ? p.dokumenty.map(function (d) { return docRow(d, p); }).join('') : '<div class="empty" style="padding:12px">Pakiet nie ma jeszcze dokumentów.</div>') +
      '<div class="pact">' + a.join('') + '</div></div></div>';
  }
  function render() {
    $('tabs').innerHTML = TABS.map(function (t) {
      return '<button type="button" data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '<b>' + rows.filter(t[2]).length + '</b></button>';
    }).join('');
    var f = TABS.filter(function (t) { return t[0] === tab; })[0][2];
    var l = rows.filter(f).filter(match);
    $('list').innerHTML = l.length ? l.map(pakRow).join('') : '<div class="empty">' + (rows.length ? 'Brak pakietów w tym widoku.' : 'Nie ma jeszcze żadnych pakietów. Utwórz pakiet z „Kompletu dokumentów” (przycisk „Wyślij do podpisu elektronicznego”) albo z gotowych plików PDF.') + '</div>';
  }
  async function reload(keepTab) {
    try {
      rows = (await call({ action: 'lista' })).pakiety || [];
      if (!keepTab) { var first = TABS.filter(function (t) { return t[0] !== 'all' && rows.some(t[2]); })[0]; tab = first ? first[0] : 'all'; }
      var h = location.hash.slice(1);
      if (h && pak(h)) { open[h] = true; tab = 'all'; q = ''; history.replaceState(null, '', location.pathname); }
      render();
    } catch (e) { $('list').innerHTML = '<div class="empty">Błąd: ' + esc(e.message || e) + '</div>'; }
  }
  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-t]'); if (!b) return; tab = b.getAttribute('data-t'); render(); });
  $('q').addEventListener('input', function () { q = this.value.toLowerCase().trim(); render(); });
  $('btnReload').addEventListener('click', function () { reload(true); });

  // ---------------- modal ----------------
  function sheet(html, wide) { $('sheet').className = 'sheet' + (wide ? ' wide' : ''); $('sheet').innerHTML = html; $('modal').hidden = false; }
  function close() { $('modal').hidden = true; $('sheet').innerHTML = ''; }
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal') || e.target.closest('[data-close]')) close(); });
  function buttons(go, cls) { return '<div class="err" id="mErr"></div><div class="row"><button type="button" data-close>Zamknij</button>' + (go ? '<button type="button" class="go" id="mGo"' + (cls ? ' style="' + cls + '"' : '') + '>' + go + '</button>' : '') + '</div>'; }
  async function run(btn, fn) {
    btn.disabled = true; $('mErr').textContent = '';
    try { await fn(); } catch (e) { $('mErr').textContent = e.message || String(e); btn.disabled = false; return false; }
    return true;
  }
  function copyBtn(target) { return '<button type="button" class="mini" data-copy="' + target + '">Kopiuj</button>'; }
  $('sheet').addEventListener('click', async function (e) {
    var c = e.target.closest('[data-copy]'); if (!c) return;
    var el = $(c.getAttribute('data-copy'));
    try { await navigator.clipboard.writeText(el.value); } catch (err) { el.select(); document.execCommand('copy'); }
    c.textContent = 'Skopiowano ✓';
  });

  // ---------------- document actions ----------------
  $('list').addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-a]');
    if (b) {
      var x = dok(b.closest('[data-id]').getAttribute('data-id')), a = b.getAttribute('data-a');
      if (!x) return;
      if (a === 'plik') {
        b.disabled = true;
        try { var f = await call({ action: 'plik', dokument: x.d.id, ktory: b.getAttribute('data-k') }); widziane[x.d.id + ':' + b.getAttribute('data-k')] = f.sha256; var l = document.createElement('a'); l.href = f.url; l.download = f.nazwa; l.rel = 'noopener'; document.body.appendChild(l); l.click(); l.remove(); }
        catch (err) { alert('Nie udało się pobrać pliku: ' + (err.message || err)); }
        b.disabled = false;
      } else if (a === 'ok') openVerify(x, b.getAttribute('data-s'));
      else if (a === 'odrzuc') openReject(x, b.getAttribute('data-s'));
      else if (a === 'wgraj') openUpload(x);
      else if (a === 'usun') {
        if (!confirm('Usunąć dokument „' + x.d.tytul + '” ze szkicu pakietu?')) return;
        try { await call({ action: 'dokument_usun', dokument: x.d.id }); await reload(true); } catch (err) { alert('Błąd: ' + (err.message || err)); }
      }
      return;
    }
    var pb = e.target.closest('button[data-p]');
    if (pb) {
      var p = pak(pb.closest('[data-pak]').getAttribute('data-pak')), act = pb.getAttribute('data-p');
      if (!p) return;
      if (act === 'link') openLink(p); else if (act === 'log') openLog(p); else if (act === 'anuluj') openCancel(p); else if (act === 'dodaj') openAdd(p);
      else if (act === 'unlink') { if (confirm('Unieważnić link pracownika? Przestanie działać od razu.')) { try { await call({ action: 'link_uniewaznij', id: p.id }); await reload(true); } catch (err) { alert('Błąd: ' + (err.message || err)); } } }
      else if (act === 'wydaj') { if (confirm('Wydać pakiet pracodawcy? Po wydaniu nie można już dodawać ani usuwać dokumentów.')) { try { await call({ action: 'wydaj', id: p.id }); open[p.id] = true; tab = 'all'; await reload(true); } catch (err) { alert('Błąd: ' + (err.message || err)); } } }
      else if (act === 'zakoncz') openClose(p);
      return;
    }
    var head = e.target.closest('.fhead');
    if (head) { var k = head.parentElement.getAttribute('data-pak'); open[k] = !open[k]; head.parentElement.classList.toggle('open'); }
  });

  function who(s) { return s === 'pracodawca' ? 'pracodawcy' : 'pracownika'; }
  function openVerify(x, s) {
    var k = x.d[s], el = k.metoda !== 'odreczny', seen = widziane[x.d.id + ':' + s];
    var head = '<h3>Potwierdź podpis ' + who(s) + '</h3><div class="hint">' + esc(x.d.tytul) + ' · ' + esc(x.p.worker_name) + ' · zadeklarowano: <b>' + esc(METODA[k.metoda] || '') + '</b></div>';
    // the decision is about one concrete file: the one downloaded here
    if (!seen || seen !== k.sha256) {
      sheet(head + '<div class="hint">' + (seen ? '<b>Plik został zmieniony po tym, jak go pobrano.</b> ' : '') + 'Najpierw pobierz plik ' + who(s) + ' („Plik ' + who(s) + '”) i sprawdź go — potwierdzenie dotyczy dokładnie tego pliku, który został pobrany (SHA-256 ' + esc((k.sha256 || '').slice(0, 16)) + '…).</div>' + buttons(''));
      return;
    }
    var boxes = el ? (k.baza === 'pracodawca' ? ['tresc', 'waznosc', 'pracodawca'] : ['tresc', 'waznosc']) : ['tresc'];
    var T = reguly.potwierdzenia_weryfikacji, K = reguly.stwierdzono;
    sheet(head +
      (el ? '<div class="hint">Wgraj pobrany plik na <a href="https://podpis.gov.pl" target="_blank" rel="noopener noreferrer">podpis.gov.pl</a> i odczytaj raport. Portal stwierdził tylko: ' + esc(wiaz(k)) + '. <b>Otwórz też sam plik i porównaj treść z wydanym dokumentem</b> — dopisana rewizja może zmienić to, co widać na stronie, a podpis pozostanie ważny.</div>' +
        (k.ostrzezenie ? '<div class="hint" style="color:#92400e">Podpis zaufany przy dokumencie wymagającym formy pisemnej — podpisujący potwierdził ostrzeżenie ' + esc(k.ostrzezenie.wersja) + ' (' + plt(k.ostrzezenie.at) + ').</div>' : '')
        : '<div class="hint">Skan podpisu odręcznego nie jest powiązany z wydanym plikiem. Otwórz wydany dokument i skan obok siebie: ta sama treść, wszystkie strony, podpis we właściwym miejscu.</div>') +
      '<label for="mKind">Rodzaj podpisu według weryfikatora (wymagane)</label><select id="mKind"><option value="">— wybierz —</option>' + Object.keys(K).map(function (id) { return '<option value="' + esc(id) + '">' + esc(K[id]) + '</option>'; }).join('') + '</select>' +
      '<div class="hint" id="mDiff" style="color:#b91c1c;margin-top:8px" hidden></div>' +
      '<div id="mBoxes">' + boxes.map(function (b) { return '<label class="chk"><input type="checkbox" data-box="' + b + '" /><span>' + esc(T[b]) + '</span></label>'; }).join('') + '</div>' +
      (el ? '<label for="mWho">Kto podpisał według weryfikatora (opcjonalnie)</label><input type="text" id="mWho" maxlength="200" placeholder="imię i nazwisko z raportu weryfikacji" />' : '') +
      '<label for="mNote">Uwagi do weryfikacji (opcjonalnie)</label><input type="text" id="mNote" maxlength="500" />' + buttons('Zweryfikowano'));
    var go = $('mGo');
    go.disabled = true;
    function sync() {
      var kind = $('mKind').value, diff = kind && kind !== k.metoda;
      $('mDiff').hidden = !diff; $('mBoxes').hidden = !!diff;
      if (diff) $('mDiff').textContent = 'Zadeklarowano: ' + METODA[k.metoda] + ', a weryfikator pokazuje: ' + K[kind] + '. Takiego pliku nie można zatwierdzić — strona musi wgrać go ponownie, wybierając właściwy rodzaj podpisu (z ostrzeżeniem tam, gdzie jest wymagane).';
      go.textContent = diff ? 'Odrzuć — inny rodzaj podpisu' : 'Zweryfikowano';
      go.style.cssText = diff ? 'background:#b91c1c;border-color:#b91c1c' : '';
      var ticks = Array.prototype.every.call($('mBoxes').querySelectorAll('[data-box]'), function (c) { return c.checked; });
      go.disabled = !kind || (!diff && !ticks);
    }
    $('mKind').addEventListener('change', sync); $('mBoxes').addEventListener('change', sync);
    go.addEventListener('click', async function () {
      var kind = $('mKind').value, diff = kind !== k.metoda, pot = {};
      boxes.forEach(function (b) { pot[b] = true; });
      var body = diff
        ? { action: 'weryfikuj', dokument: x.d.id, strona: s, ok: false, powod: reguly.powod_rodzaj, sha256: seen, stwierdzono: kind }
        : { action: 'weryfikuj', dokument: x.d.id, strona: s, ok: true, sha256: seen, stwierdzono: kind, potwierdzenia: pot, raport: { zrodlo: el ? 'podpis.gov.pl' : 'weryfikacja wzrokowa', podpisujacy: $('mWho') ? $('mWho').value : '', uwagi: $('mNote').value } };
      if (await run(this, function () { return call(body); })) { close(); reload(true); }
      else { delete widziane[x.d.id + ':' + s]; reload(true); }
    });
  }
  function openReject(x, s) {
    sheet('<h3>Odrzuć podpis ' + who(s) + '</h3><div class="hint">' + esc(x.d.tytul) + ' · ' + esc(x.p.worker_name) + '. Krok tej strony zostanie otwarty ponownie — strona zobaczy powód i wgra poprawiony plik.</div>' +
      '<label for="mWhy">Powód (zobaczy go ' + (s === 'pracodawca' ? 'pracodawca' : 'pracownik') + ')</label><textarea id="mWhy" maxlength="500" placeholder="np. podpis jest nieważny — certyfikat wygasł; brak drugiej strony skanu"></textarea>' + buttons('Odrzuć', 'background:#b91c1c;border-color:#b91c1c'));
    $('mGo').addEventListener('click', async function () {
      if (await run(this, function () { return call({ action: 'weryfikuj', dokument: x.d.id, strona: s, ok: false, powod: $('mWhy').value, sha256: widziane[x.d.id + ':' + s] || null }); })) { close(); reload(true); }
    });
  }
  function openUpload(x) {
    var d = x.d, sides = [];
    if (['oczekuje', 'odrzucony'].indexOf(d.pracodawca.status) !== -1) sides.push('pracodawca');
    else if (['oczekuje', 'odrzucony'].indexOf(d.pracownik.status) !== -1) sides.push('pracownik');
    var s = sides[0], met = d.reguly[s].metody.filter(function (m) { return !m.ostrzezenie; });
    sheet('<h3>Wgraj plik otrzymany poza portalem</h3><div class="hint">' + esc(d.tytul) + ' · podpis ' + who(s) + '. Plik przejdzie te same kontrole co wgrany przez stronę, a potem czeka na weryfikację.</div>' +
      '<div class="hint">' + esc(d.reguly[s].podstawa) + ' Pliku podpisanego podpisem zaufanym, który wymaga potwierdzenia ostrzeżenia, biuro nie wgrywa — robi to sam podpisujący.</div>' +
      '<label for="mMet">Sposób podpisania</label><select id="mMet">' + met.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.nazwa) + '</option>'; }).join('') + '</select>' +
      '<label for="mFile">Plik (PDF, JPG, PNG do ' + MAX_MB + ' MB)</label><input type="file" id="mFile" accept="application/pdf,image/jpeg,image/png" />' +
      '<label class="chk"><input type="checkbox" id="mSkip" /><span>Program do podpisu zapisał plik na nowo (nie jest dalszym ciągiem wydanego pliku) — porównałam/em treść z wydanym dokumentem i przyjmuję plik bez powiązania. Zostanie to odnotowane w dzienniku.</span></label>' + buttons('Wgraj'));
    $('mGo').addEventListener('click', async function () {
      var f = $('mFile').files[0];
      if (!f) { $('mErr').textContent = 'Wybierz plik.'; return; }
      if (await run(this, function () { return call({ action: 'wgraj', dokument: d.id, strona: s, metoda: $('mMet').value, pomin_wiazanie: $('mSkip').checked ? 'true' : null }, f); })) { close(); reload(true); }
    });
  }

  // ---------------- package actions ----------------
  function openLink(p) {
    sheet('<h3>Link dla pracownika</h3><div class="hint">' + esc(p.worker_name) + ' · ' + esc(p.firma || '') + '</div>' +
      '<div class="hint">Portal przechowuje tylko skrót linku, dlatego wcześniejszego linku nie da się pokazać ponownie. ' + (p.link ? '<b>Utworzenie nowego linku unieważni poprzedni</b> (ważny do ' + pl(p.link.wazny_do) + ').' : 'Link otwiera stronę z dokumentami tego pracownika — bez logowania.') + ' Portal niczego nie wysyła: skopiuj link i przekaż go pracownikowi sam(a). Po zamknięciu pakietu link wygasa sam po 14 dniach.</div>' +
      '<label for="mDays">Ważność linku</label><select id="mDays"><option value="3">3 dni</option><option value="7" selected>7 dni</option><option value="14">14 dni</option><option value="30">30 dni</option></select>' +
      '<div id="mOut"></div>' + buttons(p.link ? 'Utwórz nowy link' : 'Utwórz link'));
    $('mGo').addEventListener('click', async function () {
      var out;
      if (!await run(this, async function () { out = await call({ action: 'link', id: p.id, dni: Number($('mDays').value) }); })) return;
      this.hidden = true;
      $('mOut').innerHTML = '<label for="mUrl">Link (ważny do ' + pl(out.wazny_do) + ')</label><div class="copy"><input type="text" id="mUrl" readonly />' + copyBtn('mUrl') + '</div>' +
        '<label for="mMsg">Gotowa wiadomość do wklejenia</label><div class="copy"><textarea id="mMsg" readonly style="min-height:190px"></textarea>' + copyBtn('mMsg') + '</div>';
      $('mUrl').value = out.url; $('mMsg').value = out.wiadomosc;
      reload(true);
    });
  }
  function openCancel(p) {
    sheet('<h3>Anuluj pakiet</h3><div class="hint">' + esc(p.worker_name) + ' · ' + esc(p.firma || '') + '. Link pracownika przestanie działać, pracodawca nie pobierze już plików. Pliki i dziennik pozostają w portalu.</div>' +
      '<label for="mWhy">Powód</label><textarea id="mWhy" maxlength="500"></textarea>' + buttons('Anuluj pakiet', 'background:#b91c1c;border-color:#b91c1c'));
    $('mGo').addEventListener('click', async function () {
      if (await run(this, function () { return call({ action: 'anuluj', id: p.id, powod: $('mWhy').value }); })) { close(); reload(true); }
    });
  }
  function openClose(p) {
    sheet('<h3>Zamknij i przenieś do akt</h3><div class="hint">' + esc(p.worker_name) + ' · ' + esc(p.firma || '') + ' · ' + p.dokumenty.length + ' dok.</div>' +
      '<div class="hint">Podpisane pliki trafią do <b>Akt osobowych</b> (' + (p.typ === 'praca' ? 'część B, kwestionariusz kandydata — część A' : 'część Z — dokumenty zleceniobiorcy') + ')' +
      (p.zgloszenie_id ? ', przypisane do pracownika.' : '. Pakiet nie ma zgłoszenia pracownika, więc dokumenty trafią do „Do sprawdzenia” — przypisz je w Aktach.') + ' Obie strony nadal będą mogły pobrać podpisane dokumenty.</div>' + buttons('Zamknij pakiet'));
    $('mGo').addEventListener('click', async function () {
      if (await run(this, function () { return call({ action: 'zakoncz', id: p.id }); })) { close(); reload(true); }
    });
  }
  async function openLog(p) {
    sheet('<h3>Dziennik pakietu</h3><div class="hint">' + esc(p.worker_name) + ' · ' + esc(p.firma || '') + '</div><div id="mLog" class="empty">Ładowanie…</div>' + buttons(''), true);
    try {
      var out = await call({ action: 'pakiet', id: p.id }), names = {};
      out.pakiet.dokumenty.forEach(function (d) { names[d.id] = d.tytul; });
      var ROLE = { biuro: 'biuro', pracodawca: 'pracodawca', pracownik: 'pracownik', system: 'system' };
      $('mLog').className = 'tablewrap';
      $('mLog').innerHTML = '<table class="log"><thead><tr><th>Kiedy</th><th>Kto</th><th>Co</th><th>Dokument</th><th>Szczegóły</th><th>IP</th><th>SHA-256</th></tr></thead><tbody>' + out.log.map(function (l) {
        var i = l.info || {}, det = [i.strona && 'podpis ' + who(i.strona), METODA[i.metoda] || i.metoda, i.wiazanie && wiaz(i), i.stwierdzono && 'weryfikator: ' + i.stwierdzono, i.raport && i.raport.stwierdzono && 'weryfikator: ' + i.raport.stwierdzono, i.raport && i.raport.potwierdzenia && 'potwierdzono: ' + Object.keys(i.raport.potwierdzenia).join(', '), i.ten_sam && 'ten sam pracownik biura wgrał i weryfikował', i.poprzedni_usuniety && 'poprzedni plik usunięto', i.ktory && 'plik: ' + i.ktory, i.powod && 'powód: ' + i.powod, i.kod && 'odmowa: ' + i.kod, i.ostrzezenie && 'ostrzeżenie ' + i.ostrzezenie.wersja + ' potwierdzone', i.wazny_do && 'do ' + pl(i.wazny_do)].filter(Boolean).join(' · ');
        return '<tr><td style="white-space:nowrap">' + plt(l.at) + '</td><td>' + esc(ROLE[l.strona] || l.strona) + (l.kto && l.kto !== 'link' ? '<br><small>' + esc(l.kto) + '</small>' : '') + '</td><td>' + esc(AKCJA[l.akcja] || l.akcja) + (l.wynik !== 'ok' ? ' ' + pill(l.wynik, 'p-red') : '') + '</td><td>' + esc(names[l.dokument_id] || '') + '</td><td>' + esc(det) + '</td><td class="mono">' + esc(l.ip || '') + '</td><td class="mono">' + esc((l.sha256 || '').slice(0, 16)) + (l.sha256 ? '…' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    } catch (e) { $('mLog').textContent = 'Błąd: ' + (e.message || e); }
  }
  function kindOptions(sel) { return Object.keys(reguly.rodzaje).map(function (k) { return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(reguly.rodzaje[k]) + '</option>'; }).join(''); }
  function openAdd(p) {
    sheet('<h3>Dodaj dokument do pakietu</h3><div class="hint">' + esc(p.worker_name) + ' · ' + esc(p.firma || '') + '. Jeden plik PDF = jeden dokument do podpisu.</div>' +
      '<label for="mKind">Rodzaj dokumentu</label><select id="mKind">' + kindOptions('umowa_praca') + '</select><div class="hint" id="mRule" style="margin-top:6px"></div>' +
      '<label for="mTitle">Tytuł</label><input type="text" id="mTitle" maxlength="200" />' +
      '<div class="two"><div><label for="mSign">Kto podpisuje</label><select id="mSign"></select></div><div><label for="mPart">Część akt</label><select id="mPart">' + ['A', 'B', 'C', 'D', 'E', 'Z'].map(function (c) { return '<option' + (c === (p.typ === 'zlecenie' ? 'Z' : 'B') ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div></div>' +
      '<label for="mFile">Plik PDF (do ' + MAX_MB + ' MB)</label><input type="file" id="mFile" accept="application/pdf" />' + buttons('Dodaj dokument'));
    function sync() {
      var k = $('mKind').value, m = reguly.macierz.filter(function (r) { return r.rodzaj === k && r.cudzoziemiec === p.cudzoziemiec; })[0];
      $('mRule').textContent = m ? m.podstawa : '';
      // who signs: the server's default for this kind; where the kind leaves no choice (receipt only, employer only) only that one
      var def = (m && m.podpisuje_domyslnie) || (k === 'informacja_warunki' ? 'potwierdzenie' : ['umowa_praca', 'aneks_praca', 'umowa_zlecenie', 'aneks_zlecenie', 'tlumaczenie', 'rozwiazanie', 'odpowiedzialnosc'].indexOf(k) !== -1 || (k === 'zwiazki_info' && p.cudzoziemiec) ? 'obie' : 'pracownik');
      var wym = m && m.podpisuje_wymuszone !== undefined ? m.podpisuje_wymuszone : (k === 'informacja_warunki' ? 'potwierdzenie' : null);
      $('mSign').innerHTML = Object.keys(reguly.podpisuje).filter(function (x) { return wym ? x === wym : x !== 'potwierdzenie'; }).map(function (x) { return '<option value="' + esc(x) + '"' + (x === def ? ' selected' : '') + '>' + esc(reguly.podpisuje[x]) + '</option>'; }).join('');
      if (!$('mTitle').value || $('mTitle').dataset.auto === '1') { $('mTitle').value = reguly.rodzaje[k]; $('mTitle').dataset.auto = '1'; }
    }
    $('mKind').addEventListener('change', sync); $('mTitle').addEventListener('input', function () { this.dataset.auto = ''; });
    sync();
    $('mGo').addEventListener('click', async function () {
      var f = $('mFile').files[0];
      if (!f) { $('mErr').textContent = 'Wybierz plik PDF.'; return; }
      if (await run(this, function () { return call({ action: 'dokument_dodaj', pakiet: p.id, rodzaj: $('mKind').value, tytul: $('mTitle').value, podpisuje: $('mSign').value, czesc: $('mPart').value }, f); })) { close(); open[p.id] = true; reload(true); }
    });
  }
  // a package made by hand: for papers the komplet generator does not make (aneks, wypowiedzenie…)
  $('btnNew').addEventListener('click', function () {
    var picked = null;
    sheet('<h3>Nowy pakiet z plików PDF</h3><div class="hint">Dla dokumentów spoza „Kompletu dokumentów” (aneks, wypowiedzenie, porozumienie, umowa o odpowiedzialności materialnej…). Najpierw powstaje szkic — dodasz do niego pliki PDF i wydasz pracodawcy.</div>' +
      '<label for="mQ">Pracownik (ze zgłoszeń / rejestru)</label><input type="search" id="mQ" placeholder="Wpisz nazwisko albo firmę…" /><div class="cands" id="mCands"></div>' +
      '<div class="two"><div><label for="mTyp">Rodzaj umowy</label><select id="mTyp"><option value="praca">umowa o pracę</option><option value="zlecenie">umowa zlecenia</option></select></div>' +
      '<div><label for="mCudz">Cudzoziemiec?</label><select id="mCudz"><option value="">— wybierz —</option><option value="nie">nie — obywatel polski</option><option value="tak">tak — cudzoziemiec</option></select></div></div>' +
      '<div class="hint" style="margin-top:8px">Od tego zależy, czym wolno podpisać umowę: u cudzoziemca wymagana jest forma pisemna (art. 5 ust. 1 ustawy o powierzaniu pracy cudzoziemcom).</div>' + buttons('Utwórz szkic'));
    function draw() {
      var term = $('mQ').value.toLowerCase().trim();
      var l = term ? workers.filter(function (w) { return (w.worker_name + ' ' + w.firma).toLowerCase().indexOf(term) !== -1; }).slice(0, 30) : [];
      $('mCands').innerHTML = l.length ? l.map(function (w) { return '<button type="button" class="cand' + (picked && picked.id === w.id ? ' on' : '') + '" data-w="' + esc(w.id) + '"><b>' + esc(w.worker_name) + '</b> <small>' + esc(w.firma) + (w.status === 'archiwum' ? ' · archiwum' : '') + '</small></button>'; }).join('')
        : '<div class="empty" style="padding:14px">' + (term ? 'Brak takiej osoby w rejestrze.' : 'Wpisz nazwisko, aby wyszukać pracownika.') + '</div>';
    }
    $('mQ').addEventListener('input', function () { picked = null; draw(); });
    $('mCands').addEventListener('click', function (e) { var b = e.target.closest('[data-w]'); if (!b) return; picked = workers.filter(function (w) { return w.id === b.getAttribute('data-w'); })[0]; $('mQ').value = picked.worker_name; if (picked.typ) $('mTyp').value = picked.typ; draw(); });
    draw();
    $('mGo').addEventListener('click', async function () {
      if (!picked) { $('mErr').textContent = 'Wybierz pracownika z listy.'; return; }
      if (!$('mCudz').value) { $('mErr').textContent = 'Zaznacz, czy pracownik jest cudzoziemcem.'; return; }
      var out;
      if (await run(this, async function () { out = await call({ action: 'utworz', zgloszenie_id: picked.id, typ: $('mTyp').value, cudzoziemiec: $('mCudz').value === 'tak' }); })) { close(); open[out.pakiet.id] = true; tab = 'szk'; reload(true); }
    });
  });

  function drawMatrix() {
    var names = function (l) { return l.length ? l.map(function (m) { return esc(METODA[m.id] || m.id) + (m.ostrzezenie ? ' ⚠ z ostrzeżeniem' : ''); }).join(', ') : 'bez podpisu — potwierdzenie odbioru'; };
    $('matrix').innerHTML = '<thead><tr><th>Dokument</th><th>Obywatel polski</th><th>Cudzoziemiec</th></tr></thead><tbody>' + Object.keys(reguly.rodzaje).map(function (k) {
      var a = reguly.macierz.filter(function (r) { return r.rodzaj === k && !r.cudzoziemiec; })[0], b = reguly.macierz.filter(function (r) { return r.rodzaj === k && r.cudzoziemiec; })[0];
      var extra = a.pracownik_po_kwalifikowanym.length > a.pracownik.length ? '<br><small>pracownik także podpisem zaufanym, jeżeli pracodawca podpisał kwalifikowanym (art. 29 § 2 KP)</small>' : '';
      return '<tr><td><b>' + esc(reguly.rodzaje[k]) + '</b></td><td>' + names(a.pracodawca) + extra + '</td><td>' + names(b.pracodawca) + '</td></tr>';
    }).join('') + '</tbody>';
  }

  async function load() {
    if (!window.sb) return;
    try { reguly = await call({ action: 'reguly' }); drawMatrix(); } catch (e) { /* the list will show the error */ }
    await reload(false);
    // workers for a hand-made package (as in akta.js)
    for (var from = 0; ; from += 1000) {
      var w = await window.sb.from('zatrudnienie_zgloszenia').select('id,worker_name,status,nip:payload->>z_nip,firma:payload->>z_nazwa,typ:payload->>u_typ').range(from, from + 999);
      if (w.error || !w.data) break;
      workers = workers.concat(w.data.map(function (x) { return { id: x.id, worker_name: x.worker_name || '', status: x.status, firma: x.firma || '', typ: x.typ === 'praca' ? 'praca' : x.typ === 'zlecenie' ? 'zlecenie' : '' }; }));
      if (w.data.length < 1000) break;
    }
  }
  load();
})();
