/* Portal task list for employment intake (AI-кадровик, phase 1).
   Lists client submissions, shows extracted/filled worker data, lets the HR
   reviewer download documents and move the request through statuses. */
(function () {
  'use strict';
  var TABLE = 'zatrudnienie_zgloszenia';
  var BUCKET = 'zatrudnienie-dokumenty';

  var listEl = document.getElementById('list');
  var emptyEl = document.getElementById('empty');
  var toastEl = document.getElementById('toast');
  var filter = 'all';
  var rows = [];

  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtDate(iso) { try { return new Date(iso).toLocaleString('pl-PL'); } catch (e) { return iso; } }

  var STATUS_LABEL = { nowe: 'Nowe', sprawdzone: 'Sprawdzone', wyslane: 'Wysłane do podpisu' };

  document.getElementById('filters').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    filter = b.getAttribute('data-f');
    document.querySelectorAll('#filters button').forEach(function (x) { x.classList.toggle('active', x === b); });
    render();
  });

  async function load() {
    if (!window.sb) { listEl.innerHTML = '<div class="empty">Brak połączenia z serwerem.</div>'; return; }
    var res = await window.sb.from(TABLE).select('*').order('created_at', { ascending: false }).limit(300);
    if (res.error) { listEl.innerHTML = '<div class="empty">Błąd: ' + esc(res.error.message) + '</div>'; return; }
    rows = res.data || [];
    render();
  }

  // human-friendly labels for payload keys
  var LABELS = {
    z_nazwa: 'Firma', z_nip: 'NIP', z_miasto: 'Miejscowość', z_ulica: 'Ulica i nr',
    p_imiona: 'Imię', p_nazwisko: 'Nazwisko', p_pesel: 'PESEL', p_dataur: 'Data ur.',
    p_miejsceur: 'Miejsce ur.', p_obywatelstwo: 'Obywatelstwo', p_doc_typ: 'Dokument',
    p_dowod: 'Seria i nr', p_telefon: 'Telefon', p_email: 'E-mail', p_nfz: 'NFZ',
    p_us: 'Urząd skarbowy', p_nip: 'NIP', p_konto: 'Konto',
    a_ulica: 'Ulica', a_nrdom: 'Nr domu', a_nrmiesz: 'Nr mieszk.', a_kod: 'Kod', a_miejscowosc: 'Miejscowość',
    a_gmina: 'Gmina', a_powiat: 'Powiat', a_wojewodztwo: 'Województwo',
  };
  var GROUPS = [
    { title: 'Pracodawca', keys: ['z_nazwa', 'z_nip', 'z_miasto', 'z_ulica'] },
    { title: 'Dane osobowe', keys: ['p_imiona', 'p_nazwisko', 'p_pesel', 'p_dataur', 'p_miejsceur', 'p_obywatelstwo', 'p_doc_typ', 'p_dowod'] },
    { title: 'Adres', keys: ['a_ulica', 'a_nrdom', 'a_nrmiesz', 'a_kod', 'a_miejscowosc', 'a_gmina', 'a_powiat', 'a_wojewodztwo'] },
    { title: 'Do zatrudnienia', keys: ['p_telefon', 'p_email', 'p_nfz', 'p_us', 'p_nip', 'p_konto'] },
  ];

  function detailHTML(r) {
    var p = r.payload || {};
    var html = '';
    GROUPS.forEach(function (g) {
      html += '<div class="sec">' + g.title + '</div><div class="grid">';
      g.keys.forEach(function (k) {
        if (p[k] == null || p[k] === '') return;
        html += '<div><b>' + esc(LABELS[k] || k) + ':</b> ' + esc(p[k]) + '</div>';
      });
      html += '</div>';
    });
    var docs = r.doc_paths || [];
    html += '<div class="sec">Dokumenty (' + docs.length + ')</div><div class="docs" data-docs></div>';
    html += '<div class="actions">';
    html += '<button class="btn-gen" data-act="generuj">🧾 Generuj komplet (umowa zlecenie)</button>';
    if (r.status === 'nowe') html += '<button class="btn-rev" data-act="sprawdzone">✔ Oznacz jako sprawdzone</button>';
    if (r.status !== 'wyslane') html += '<button class="btn-send" data-act="wyslane">📤 Wyślij klientowi do podpisu</button>';
    html += '<button class="btn-del" data-act="delete">Usuń</button>';
    html += '</div>';
    return html;
  }

  function render() {
    var data = rows.filter(function (r) { return filter === 'all' || r.status === filter; });
    emptyEl.style.display = data.length ? 'none' : 'block';
    listEl.innerHTML = '';
    data.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'card';
      var st = r.status || 'nowe';
      var emp = (r.payload && r.payload.z_nazwa) ? r.payload.z_nazwa : '';
      card.innerHTML =
        '<div class="card-head">' +
          '<div class="who"><strong>' + esc(r.worker_name || '(bez nazwy)') + '</strong>' +
            '<small>' + fmtDate(r.created_at) + ' · ' + (r.doc_paths ? r.doc_paths.length : 0) + ' dok.' +
            (emp ? ' · → ' + esc(emp) : '') + '</small></div>' +
          '<span class="badge b-' + st + '">' + esc(STATUS_LABEL[st] || st) + '</span>' +
          '<span class="chev">›</span>' +
        '</div>' +
        '<div class="detail">' + detailHTML(r) + '</div>';

      card.querySelector('.card-head').addEventListener('click', function () {
        card.classList.toggle('open');
        if (card.classList.contains('open')) loadDocs(card, r);
      });
      card.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function (ev) { ev.stopPropagation(); onAction(r, btn.getAttribute('data-act'), card); });
      });
      listEl.appendChild(card);
    });
  }

  async function signedLink(path, text) {
    var s = await window.sb.storage.from(BUCKET).createSignedUrl(path, 300);
    var a = document.createElement('a');
    a.href = s && s.data ? s.data.signedUrl : '#';
    a.target = '_blank'; a.rel = 'noopener';
    a.textContent = text;
    return a;
  }

  async function loadDocs(card, r) {
    var wrap = card.querySelector('[data-docs]');
    if (!wrap || wrap.dataset.loaded) return;
    wrap.dataset.loaded = '1';
    wrap.innerHTML = '';
    var docs = (r.payload && Array.isArray(r.payload.documents)) ? r.payload.documents : null;
    if (docs && docs.length) {
      // group by category label, preserving order
      var order = [], groups = {};
      docs.forEach(function (d) {
        var l = d.label || 'Dokument';
        if (!groups[l]) { groups[l] = []; order.push(l); }
        groups[l].push(d);
      });
      for (var gi = 0; gi < order.length; gi++) {
        var label = order[gi];
        var head = document.createElement('div');
        head.className = 'doc-group-label'; head.textContent = label;
        wrap.appendChild(head);
        for (var j = 0; j < groups[label].length; j++) {
          wrap.appendChild(await signedLink(groups[label][j].path, '📎 ' + (groups[label][j].name || 'plik')));
        }
      }
      return;
    }
    // fallback: flat list (older submissions)
    var paths = r.doc_paths || [];
    if (!paths.length) { wrap.innerHTML = '<small style="color:#999">brak</small>'; return; }
    for (var i = 0; i < paths.length; i++) {
      wrap.appendChild(await signedLink(paths[i], '📎 dokument ' + (i + 1)));
    }
  }

  async function onAction(r, act, card) {
    if (act === 'generuj') {
      // hand the submission off to the umowa-zlecenie generator, prefilled.
      // localStorage (not sessionStorage) so the new tab can read it.
      try { localStorage.setItem('tdcg_zlecenie_import', JSON.stringify(r.payload || {})); } catch (e) {}
      window.open('umowa-zlecenie.html?from=zgloszenie', '_blank', 'noopener');
      return;
    }
    if (act === 'delete') {
      if (!confirm('Usunąć zgłoszenie ' + (r.worker_name || '') + '?')) return;
      if (r.doc_paths && r.doc_paths.length) {
        try { await window.sb.storage.from(BUCKET).remove(r.doc_paths); } catch (e) {}
      }
      var d = await window.sb.from(TABLE).delete().eq('id', r.id);
      if (d.error) return toast('Błąd: ' + d.error.message);
      rows = rows.filter(function (x) { return x.id !== r.id; });
      render(); toast('Usunięto.');
      return;
    }
    // status change: sprawdzone | wyslane
    var patch = { status: act };
    if (act === 'sprawdzone') { patch.reviewed_at = new Date().toISOString(); }
    var u = await window.sb.from(TABLE).update(patch).eq('id', r.id).select().single();
    if (u.error) return toast('Błąd: ' + u.error.message);
    r.status = act; if (u.data) { r.reviewed_at = u.data.reviewed_at; }
    render();
    toast(act === 'wyslane' ? 'Oznaczono jako wysłane do podpisu.' : 'Oznaczono jako sprawdzone.');
  }

  load();
})();
