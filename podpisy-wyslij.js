/* Komplet dokumentów → podpis elektroniczny.
   The button "Wyślij do podpisu elektronicznego" takes the documents selected in the komplet
   form one by one (window.KompletDokumenty — the same generator, one PDF per document) and
   hands them to the `podpisy` function: a package for the worker, issued to the employer.
   Nothing is sent to anybody; the office then follows the package in podpisy.html. */
/* global zgloszenieId, anyDocSelected, placaPonizejMinimum */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/podpisy';
  var btn = document.getElementById('podpisBtn'), form = document.getElementById('form');
  if (!btn || !form || !window.KompletDokumenty) return;
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var KTO = { obie: 'pracodawca i pracownik', pracownik: 'pracownik', pracodawca: 'pracodawca', potwierdzenie: 'bez podpisu — potwierdzenie odbioru' };

  // the same sheet as in akta.html
  var css = document.createElement('style');
  css.textContent = '.modal{position:fixed;inset:0;background:rgba(15,25,45,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:950}.modal[hidden]{display:none}' +
    '.sheet{background:#fff;color:#111;border-radius:14px;padding:20px;width:100%;max-width:560px;max-height:92vh;overflow:auto}.sheet h3{margin:0 0 4px;font-size:17px;color:var(--brand-navy)}' +
    '.sheet .hint{color:#7a8699;font-size:12.5px;margin:0 0 10px}.sheet .row{display:flex;gap:10px;margin-top:16px}' +
    '.sheet .row button{flex:1;padding:11px;border-radius:9px;font:inherit;font-weight:600;cursor:pointer;border:1px solid #d4dbe6;background:#fff;color:#111;margin:0;width:auto}' +
    '.sheet .row .go{background:var(--brand-navy);border-color:var(--brand-navy);color:#fff}.sheet .row button:disabled{opacity:.6;cursor:wait}' +
    '.sheet .pd{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid #eef1f6;font-size:13.5px}.sheet .pd small{color:#7a8699;white-space:nowrap}' +
    '.sheet .chk{display:flex;gap:8px;align-items:flex-start;font-size:14px;font-weight:600;color:#111;margin:12px 0 4px}.sheet .chk input{margin-top:3px}' +
    '.sheet .res{font-size:13.5px;margin-top:10px}.sheet .res.err{color:#b91c1c}.sheet .res a{color:var(--brand-navy);font-weight:600}';
  document.head.appendChild(css);
  var modal = document.createElement('div');
  modal.className = 'modal'; modal.hidden = true;
  modal.innerHTML = '<div class="sheet"><h3>Wyślij do podpisu elektronicznego</h3><div class="hint" id="pwKto"></div>' +
    '<label class="chk"><input type="checkbox" id="pwCudz" /><span>Pracownik jest cudzoziemcem<br><small style="font-weight:400;color:#7a8699">Umowa z cudzoziemcem wymaga formy pisemnej (art. 5 ust. 1 ustawy o powierzaniu pracy cudzoziemcom) — od tego zależą dopuszczalne sposoby podpisania.</small></span></label>' +
    '<div class="hint" style="margin-top:10px">Każdy dokument trafia do podpisu jako osobny plik PDF, o tej samej treści co w komplecie:</div><div id="pwDocs"></div>' +
    '<div class="hint" style="margin-top:10px">Pakiet zostanie wydany pracodawcy (profil klienta). Portal niczego nie wysyła e-mailem — link dla pracownika skopiujesz na stronie „Podpisy elektroniczne”.</div>' +
    '<div class="res" id="pwRes"></div><div class="row"><button type="button" id="pwCancel">Anuluj</button><button type="button" class="go" id="pwGo">Utwórz pakiet i wydaj</button></div></div>';
  document.body.appendChild(modal);
  var $ = function (id) { return document.getElementById(id); };
  var data = null, docs = [], busy = false;

  async function token() { var s = await window.sb.auth.getSession(); return s && s.data && s.data.session ? s.data.session.access_token : ''; }
  async function call(body, file) {
    var init = { method: 'POST', headers: { apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() } };
    if (file) {
      var fd = new FormData();
      Object.keys(body).forEach(function (k) { if (body[k] != null) fd.append(k, String(body[k])); });
      fd.append('plik', new Blob([file], { type: 'application/pdf' }), 'dokument.pdf');
      init.body = fd;
    } else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var res = await fetch(FN, init), out = await res.json().catch(function () { return {}; });
    if (!res.ok || out.error) throw new Error(out.error || 'Błąd ' + res.status);
    return out;
  }
  function say(html, err) { $('pwRes').className = 'res' + (err ? ' err' : ''); $('pwRes').innerHTML = html; }

  btn.addEventListener('click', async function () {
    if (!form.checkValidity()) { form.reportValidity(); return; }
    await window.KompletDokumenty.gotowe();
    data = window.KompletDokumenty.dane();
    docs = window.KompletDokumenty.lista(data).filter(function (d) { return !d.wewnetrzny; });
    if (!docs.length) { alert('Zaznacz przynajmniej jeden dokument.'); return; }
    var zaMalo = typeof placaPonizejMinimum === 'function' ? placaPonizejMinimum(data) : '';
    if (zaMalo && !confirm(zaMalo + '\n\nWysłać dokumenty do podpisu mimo to?')) return;
    var nip = (data.z.nip || '').replace(/\D/g, '');
    $('pwKto').innerHTML = '<b>' + esc((data.p.imiona + ' ' + data.p.nazwisko).trim()) + '</b> · ' + esc(data.z.nazwa) + ' · NIP ' + esc(nip || '—') +
      (zgloszenieId ? '' : '<br>Komplet nie pochodzi ze zgłoszenia pracownika — po podpisaniu dokumenty trafią do akt „do sprawdzenia” i trzeba je będzie przypisać ręcznie.');
    var ob = (data.p.obywatelstwo || '').trim().toLowerCase();
    $('pwCudz').checked = !!ob && !/^pol(ska|skie|ak|ka)?$/.test(ob) && ob !== 'pl';
    $('pwDocs').innerHTML = docs.map(function (d) { return '<div class="pd"><span>' + esc(d.title) + '</span><small>' + esc(d.id === 'zwiazki' ? 'pracownik; u cudzoziemca także pracodawca' : KTO[d.podpisuje] || '') + '</small></div>'; }).join('');
    say(''); $('pwGo').disabled = false; $('pwGo').hidden = false; $('pwCancel').textContent = 'Anuluj';
    modal.hidden = false;
  });
  $('pwCancel').addEventListener('click', function () { if (!busy) modal.hidden = true; });
  modal.addEventListener('click', function (e) { if (e.target === modal && !busy) modal.hidden = true; });

  $('pwGo').addEventListener('click', async function () {
    if (busy) return;
    busy = true; this.disabled = true;
    var pid = null;
    try {
      var nip = (data.z.nip || '').replace(/\D/g, '');
      if (nip.length !== 10) throw new Error('Uzupełnij NIP pracodawcy (10 cyfr).');
      say('Przygotowuję…');
      var tr = await window.KompletDokumenty.tlumaczenie(data, function (n, all) { say('Tłumaczenie… ' + n + '/' + all); });
      var cudz = $('pwCudz').checked;
      var made = await call(zgloszenieId
        ? { action: 'utworz', zgloszenie_id: zgloszenieId, nip: nip, typ: data.typ, cudzoziemiec: cudz }
        : { action: 'utworz', nip: nip, firma: data.z.nazwa, worker_name: (data.p.imiona + ' ' + data.p.nazwisko).trim(), typ: data.typ, cudzoziemiec: cudz, bez_pesel: !(data.p.pesel || '').trim() });
      pid = made.pakiet.id;
      for (var i = 0; i < docs.length; i++) {
        say('Dokument ' + (i + 1) + ' z ' + docs.length + ': ' + esc(docs[i].title) + '…');
        var bytes = await docs[i].build(tr);
        await call({ action: 'dokument_dodaj', pakiet: pid, rodzaj: docs[i].kind, tytul: docs[i].title, podpisuje: docs[i].podpisuje, czesc: docs[i].czesc }, bytes);
      }
      await call({ action: 'wydaj', id: pid });
      say('✓ Pakiet (' + docs.length + ' dok.) został wydany pracodawcy. <a href="podpisy.html#' + esc(pid) + '">Otwórz w „Podpisach elektronicznych”</a> — tam skopiujesz link dla pracownika.');
      this.hidden = true; $('pwCancel').textContent = 'Zamknij';
    } catch (e) {
      // a half-built package stays a draft: invisible to the employer, can be cancelled in podpisy.html
      say('Błąd: ' + esc(e.message || e) + (pid ? ' Niedokończony pakiet pozostał szkicem — anuluj go w „Podpisach elektronicznych”.' : ''), true);
      this.disabled = false;
    } finally { busy = false; }
  });
})();
