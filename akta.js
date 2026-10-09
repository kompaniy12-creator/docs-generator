/* Akta osobowe: scans of paper personnel files, filed by firm, worker and part of the file.
   A scan goes to the private bucket akta-osobowe, a row to akta_dokumenty, and the `akta`
   edge function reads it and proposes where it belongs. Sure matches are filed at once;
   the rest wait in "Do sprawdzenia" for a person. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/akta';
  var KL = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/klienci-list';
  var T = 'akta_dokumenty', BUCKET = 'akta-osobowe', MAX = 24 * 1024 * 1024;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pl(iso) { var p = (iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  var PARTS = { A: 'A — ubieganie się o zatrudnienie, badania lekarskie', B: 'B — nawiązanie i przebieg zatrudnienia', C: 'C — ustanie zatrudnienia', D: 'D — kary porządkowe', E: 'E — kontrola trzeźwości', Z: 'Z — dokumenty zleceniobiorcy' };
  var ST = { nowy: ['czeka na odczyt', 'p-grey'], analiza: ['odczytuję…', 'p-navy'], przypisany: ['przypisany', 'p-ok'], do_sprawdzenia: ['do sprawdzenia', 'p-amber'], blad: ['błąd odczytu', 'p-red'] };

  var rows = [], workers = [], tab = 'spr', q = '', open = {}, editing = null, picked = null, me = '';

  async function token() { var s = await window.sb.auth.getSession(); return s && s.data && s.data.session ? s.data.session.access_token : ''; }
  async function recognise(id) {
    var res = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() }, body: JSON.stringify({ action: 'rozpoznaj', id: id }) });
    return res.json().catch(function () { return {}; });
  }
  async function refreshRow(id) {
    var r = await window.sb.from(T).select('*').eq('id', id).single();
    if (r.data) { var i = rows.findIndex(function (x) { return x.id === id; }); if (i >= 0) rows[i] = r.data; else rows.unshift(r.data); }
    render();
  }

  // ---------------- upload ----------------
  var queue = [], running = 0;
  function drawQueue() {
    $('queue').innerHTML = queue.slice(-12).map(function (x) { return '<div class="q"><span>' + esc(x.name) + '</span><span class="pill ' + x.cls + '">' + esc(x.state) + '</span></div>'; }).join('');
  }
  function pump() {
    while (running < 2) {
      var job = queue.filter(function (x) { return x.state === 'w kolejce'; })[0];
      if (!job) return;
      running++; run(job).then(function () { running--; drawQueue(); pump(); });
    }
  }
  async function run(job) {
    var set = function (state, cls) { job.state = state; job.cls = cls || 'p-grey'; drawQueue(); };
    try {
      set('wysyłam…', 'p-navy');
      var id = crypto.randomUUID();
      var safe = job.file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80) || 'skan';
      var path = id + '/' + safe;
      var mime = job.file.type || (/\.pdf$/i.test(job.file.name) ? 'application/pdf' : 'image/jpeg');
      var up = await window.sb.storage.from(BUCKET).upload(path, job.file, { contentType: mime, upsert: false });
      if (up.error) throw new Error(up.error.message);
      var ins = await window.sb.from(T).insert({ id: id, path: path, nazwa: job.file.name.slice(0, 200), rozmiar: job.file.size, mime: mime, uploaded_by: me, nip: job.nip || null, firma: job.firma || null }).select().single();
      if (ins.error) throw new Error(ins.error.message);
      rows.unshift(ins.data); render();
      set('odczytuję…', 'p-navy');
      var out = await recognise(id);
      await refreshRow(id);
      if (out.error) set('błąd odczytu', 'p-red');
      else set(out.status === 'przypisany' ? 'przypisany' : 'do sprawdzenia', out.status === 'przypisany' ? 'p-ok' : 'p-amber');
    } catch (e) { set('błąd: ' + (e.message || e), 'p-red'); }
  }
  function addFiles(list) {
    var sel = $('hintFirm'), nip = sel.value, firma = nip ? sel.options[sel.selectedIndex].textContent : '';
    var skipped = 0;
    Array.prototype.forEach.call(list, function (f) {
      // what the bucket takes: PDF and JPG / PNG / WEBP / GIF (not HEIC — the reader cannot open it)
      if (f.size > MAX || !(/^image\/(jpeg|png|webp|gif)$/.test(f.type) || f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) { skipped++; return; }
      queue.push({ file: f, name: f.name, state: 'w kolejce', cls: 'p-grey', nip: nip, firma: firma });
    });
    $('upMsg').textContent = skipped ? skipped + ' plik(ów) pominięto — przyjmujemy PDF oraz zdjęcia JPG, PNG i WEBP do 24 MB (zdjęcie HEIC z iPhone’a zapisz najpierw jako JPG albo PDF).' : '';
    drawQueue(); pump();
  }
  var drop = $('drop');
  drop.addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });

  // ---------------- lists ----------------
  function match(r) { return !q || [r.worker_name, r.firma, r.rodzaj, r.nazwa, r.nip].join(' ').toLowerCase().indexOf(q) !== -1; }
  function docRow(r, withWho) {
    var st = ST[r.status] || [r.status, 'p-grey'];
    var inside = (r.spis || []).length > 1 ? (r.spis || []).map(function (d) { return 's. ' + esc(d.strony) + ': ' + esc(d.rodzaj) + ' [' + esc(d.czesc) + ']'; }).join(' · ') : '';
    return '<div class="doc" data-id="' + r.id + '"><div class="n"><b>' + esc(r.rodzaj || r.nazwa) + '</b>' +
      (withWho ? '<small>' + esc(r.worker_name || 'osoba nierozpoznana') + (r.firma ? ' · ' + esc(r.firma) : '') + (r.czesc ? ' · część ' + esc(r.czesc) : '') + '</small>' : '') +
      '<small>' + [r.data_dok && 'z dnia ' + pl(r.data_dok), r.strony && r.strony + ' str.', 'plik: ' + esc(r.nazwa), 'wgrano ' + pl(r.created_at)].filter(Boolean).join(' · ') + '</small>' +
      (inside ? '<small>W środku: ' + inside + '</small>' : '') + (r.uwagi ? '<small style="color:#92400e">Uwaga: ' + esc(r.uwagi) + '</small>' : '') + '</div>' +
      '<div class="acts"><span class="pill ' + st[1] + '">' + st[0] + '</span><button type="button" class="mini" data-a="view">Zobacz</button>' +
      '<button type="button" class="mini' + (r.status === 'do_sprawdzenia' || r.status === 'blad' ? ' ok' : '') + '" data-a="edit">' + (r.status === 'przypisany' ? 'Zmień' : 'Przypisz') + '</button>' +
      (r.status === 'blad' || r.status === 'nowy' ? '<button type="button" class="mini" data-a="again">Odczytaj ponownie</button>' : '') +
      '<button type="button" class="mini del" data-a="del">Usuń</button></div></div>';
  }
  function render() {
    var spr = rows.filter(function (r) { return r.status !== 'przypisany'; });
    var ok = rows.filter(function (r) { return r.status === 'przypisany'; });
    $('tabs').innerHTML = [['spr', 'Do sprawdzenia', spr.length], ['firmy', 'Według firm i pracowników', ok.length], ['all', 'Wszystkie', rows.length]].map(function (t) {
      return '<button type="button" data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '<b>' + t[2] + '</b></button>';
    }).join('');
    var el = $('list');
    if (tab === 'spr' || tab === 'all') {
      var l = (tab === 'spr' ? spr : rows).filter(match);
      el.innerHTML = l.length ? '<div class="box">' + l.slice(0, 300).map(function (r) { return docRow(r, true); }).join('') + '</div>'
        : '<div class="empty">' + (tab === 'spr' ? 'Nic nie czeka na sprawdzenie.' : 'Nie ma jeszcze żadnych skanów.') + '</div>';
      return;
    }
    var firms = {};
    ok.filter(match).forEach(function (r) {
      var f = firms[r.nip || r.firma || '—'] = firms[r.nip || r.firma || '—'] || { nazwa: r.firma || '—', nip: r.nip, w: {}, n: 0 };
      var w = f.w[r.worker_id || r.worker_name] = f.w[r.worker_id || r.worker_name] || { nazwa: r.worker_name || '—', d: [] };
      w.d.push(r); f.n++;
    });
    var keys = Object.keys(firms).sort(function (a, b) { return firms[a].nazwa.localeCompare(firms[b].nazwa, 'pl'); });
    el.innerHTML = keys.length ? keys.map(function (k) {
      var f = firms[k], ws = Object.keys(f.w).sort(function (a, b) { return f.w[a].nazwa.localeCompare(f.w[b].nazwa, 'pl'); });
      return '<div class="firm' + (open[k] || q ? ' open' : '') + '" data-firm="' + esc(k) + '"><div class="fhead"><div><strong>' + esc(f.nazwa) + '</strong> <small>' + (f.nip ? 'NIP ' + esc(f.nip) + ' · ' : '') + ws.length + ' os. · ' + f.n + ' dok.</small></div><span>›</span></div><div class="fbody">' +
        ws.map(function (wk) {
          var w = f.w[wk];
          return '<div class="worker"><b>' + esc(w.nazwa) + '</b>' + Object.keys(PARTS).map(function (p) {
            var d = w.d.filter(function (x) { return (x.czesc || 'B') === p; }).sort(function (a, b) { return (a.data_dok || '').localeCompare(b.data_dok || ''); });
            return d.length ? '<div class="part">' + PARTS[p] + ' (' + d.length + ')</div>' + d.map(function (r) { return docRow(r, false); }).join('') : '';
          }).join('') + '</div>';
        }).join('') + '</div></div>';
    }).join('') : '<div class="empty">Nie ma jeszcze przypisanych dokumentów.</div>';
  }
  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-t]'); if (!b) return; tab = b.getAttribute('data-t'); render(); });
  $('q').addEventListener('input', function () { q = this.value.toLowerCase().trim(); render(); });

  $('list').addEventListener('click', async function (e) {
    var head = e.target.closest('.fhead');
    if (head) { var k = head.parentElement.getAttribute('data-firm'); open[k] = !open[k]; head.parentElement.classList.toggle('open'); return; }
    var b = e.target.closest('[data-a]'); if (!b) return;
    var id = b.closest('[data-id]').getAttribute('data-id'), r = rows.filter(function (x) { return x.id === id; })[0], a = b.getAttribute('data-a');
    if (a === 'view') {
      var s = await window.sb.storage.from(BUCKET).createSignedUrl(r.path, 300);
      if (s.error) return alert('Nie udało się otworzyć pliku: ' + s.error.message);
      window.open(s.data.signedUrl, '_blank', 'noopener');
    } else if (a === 'del') {
      if (!confirm('Usunąć skan „' + r.nazwa + '” z portalu? Tej operacji nie można cofnąć.')) return;
      await window.sb.storage.from(BUCKET).remove([r.path]);
      var d = await window.sb.from(T).delete().eq('id', id);
      if (d.error) return alert('Błąd: ' + d.error.message);
      rows = rows.filter(function (x) { return x.id !== id; }); render();
    } else if (a === 'again') {
      b.disabled = true; b.textContent = 'Odczytuję…';
      await recognise(id); await refreshRow(id);
    } else if (a === 'edit') openEdit(r);
  });

  // ---------------- manual assignment ----------------
  function drawCands() {
    var term = $('edQ').value.toLowerCase().trim();
    var ai = ((editing.ai || {}).kandydaci || []).map(function (c) { return c.id; });
    var list = workers.filter(function (w) { return !term ? ai.indexOf(w.id) !== -1 : (w.worker_name + ' ' + w.firma).toLowerCase().indexOf(term) !== -1; })
      .sort(function (a, b) { return (ai.indexOf(b.id) !== -1) - (ai.indexOf(a.id) !== -1) || a.worker_name.localeCompare(b.worker_name, 'pl'); }).slice(0, 40);
    $('edCands').innerHTML = list.length ? list.map(function (w) {
      return '<button type="button" class="cand' + (picked && picked.id === w.id ? ' on' : '') + '" data-w="' + w.id + '"><b>' + esc(w.worker_name) + '</b> <small>' + esc(w.firma) + (w.status === 'archiwum' ? ' · archiwum' : '') + (ai.indexOf(w.id) !== -1 ? ' · podpowiedź' : '') + '</small></button>';
    }).join('') : '<div class="empty" style="padding:14px">' + (term ? 'Brak takiej osoby w rejestrze.' : 'Wpisz nazwisko, aby wyszukać pracownika.') + '</div>';
  }
  function openEdit(r) {
    editing = r; picked = r.worker_id ? workers.filter(function (w) { return w.id === r.worker_id; })[0] || null : null;
    var ai = r.ai || {};
    $('edFile').textContent = 'Plik: ' + r.nazwa;
    $('edAi').textContent = ai.pracownik ? 'Odczytano: ' + [[ai.pracownik.imie, ai.pracownik.nazwisko].filter(Boolean).join(' '), ai.pracodawca && ai.pracodawca.nazwa].filter(Boolean).join(' · ') + (ai.pewnosc ? ' (pewność: ' + ai.pewnosc + ')' : '') : '';
    $('edQ').value = picked ? picked.worker_name : '';
    $('edPart').innerHTML = Object.keys(PARTS).map(function (p) { return '<option value="' + p + '"' + ((r.czesc || 'B') === p ? ' selected' : '') + '>' + PARTS[p] + '</option>'; }).join('');
    $('edDate').value = r.data_dok || ''; $('edKind').value = r.rodzaj || ''; $('edMsg').textContent = '';
    drawCands(); $('edit').hidden = false;
  }
  $('edQ').addEventListener('input', function () { picked = null; drawCands(); });
  $('edCands').addEventListener('click', function (e) { var b = e.target.closest('[data-w]'); if (!b) return; picked = workers.filter(function (w) { return w.id === b.getAttribute('data-w'); })[0]; $('edQ').value = picked.worker_name; drawCands(); });
  $('edCancel').addEventListener('click', function () { $('edit').hidden = true; });
  $('edit').addEventListener('click', function (e) { if (e.target === $('edit')) $('edit').hidden = true; });
  $('edSave').addEventListener('click', async function () {
    if (!picked) { $('edMsg').textContent = 'Wybierz pracownika z listy.'; return; }
    this.disabled = true;
    var u = await window.sb.from(T).update({
      status: 'przypisany', worker_id: picked.id, worker_name: picked.worker_name, nip: picked.nip || null, firma: picked.firma || null,
      czesc: $('edPart').value, data_dok: $('edDate').value || null, rodzaj: $('edKind').value.trim() || null, sprawdzil: me, sprawdzono_at: new Date().toISOString(),
    }).eq('id', editing.id).select().single();
    this.disabled = false;
    if (u.error) { $('edMsg').textContent = 'Błąd: ' + u.error.message; return; }
    Object.assign(editing, u.data); $('edit').hidden = true; render();
  });

  // ---------------- load ----------------
  async function load() {
    if (!window.sb) return;
    me = (window.PortalUser && window.PortalUser.email) || '';
    var r = await window.sb.from(T).select('*').order('created_at', { ascending: false }).limit(2000);
    if (r.error) { $('list').innerHTML = '<div class="empty">Błąd: ' + esc(r.error.message) + '</div>'; return; }
    rows = r.data || [];
    if (!rows.some(function (x) { return x.status !== 'przypisany'; }) && rows.length) tab = 'firmy';
    render();
    // workers for manual assignment (all, also the archive)
    for (var from = 0; ; from += 1000) {
      var w = await window.sb.from('zatrudnienie_zgloszenia').select('id,worker_name,status,nip:payload->>z_nip,firma:payload->>z_nazwa').range(from, from + 999);
      if (w.error || !w.data) break;
      workers = workers.concat(w.data.map(function (x) { return { id: x.id, worker_name: x.worker_name || '', status: x.status, nip: (x.nip || '').replace(/\D/g, ''), firma: x.firma || '' }; }));
      if (w.data.length < 1000) break;
    }
    try {
      var res = await fetch(KL, { headers: { apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + await token() } });
      var k = await res.json();
      $('hintFirm').innerHTML = '<option value="">— rozpoznaj automatycznie —</option>' + (k.clients || []).filter(function (c) { return c.nip; }).sort(function (a, b) { return a.nazwa.localeCompare(b.nazwa, 'pl'); }).map(function (c) { return '<option value="' + esc(c.nip) + '">' + esc(c.nazwa) + '</option>'; }).join('');
    } catch (e) {}
  }
  document.addEventListener('portal:access', function () { me = (window.PortalUser && window.PortalUser.email) || me; });
  load();
})();
