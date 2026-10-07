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
    var res = await window.sb.from(TABLE).select('*').not('status', 'in', '(zatrudniony,archiwum)').order('created_at', { ascending: false }).limit(300);
    if (res.error) { listEl.innerHTML = '<div class="empty">Błąd: ' + esc(res.error.message) + '</div>'; return; }
    rows = res.data || [];
    render();
  }

  // human-friendly labels for payload keys
  var LABELS = {
    u_typ: 'Rodzaj umowy', u_stanowisko: 'Stanowisko', u_miejsce: 'Miejsce pracy', u_od: 'Od dnia', u_do: 'Do dnia', u_stawka: 'Wynagrodzenie (zł)', u_godziny: 'Godzin / mies.', u_wymiar: 'Wymiar',
    z_nazwa: 'Firma', z_email: 'E-mail firmy', z_nip: 'NIP', z_miasto: 'Miejscowość', z_ulica: 'Ulica i nr',
    p_imiona: 'Imię', p_nazwisko: 'Nazwisko', p_pesel: 'PESEL', p_dataur: 'Data ur.',
    p_miejsceur: 'Miejsce ur.', p_obywatelstwo: 'Obywatelstwo', p_doc_typ: 'Dokument',
    p_dowod: 'Seria i nr', p_telefon: 'Telefon', p_email: 'E-mail', p_nfz: 'NFZ',
    p_us: 'Urząd skarbowy', p_nip: 'NIP', p_konto: 'Konto',
    a_ulica: 'Ulica', a_nrdom: 'Nr domu', a_nrmiesz: 'Nr mieszk.', a_kod: 'Kod', a_miejscowosc: 'Miejscowość',
    a_gmina: 'Gmina', a_powiat: 'Powiat', a_wojewodztwo: 'Województwo',
  };
  var TYP_LABEL = { zlecenie: 'umowa zlecenie', praca: 'umowa o pracę' };
  var GROUPS = [
    { title: 'Pracodawca', keys: ['u_typ', 'u_stanowisko', 'u_miejsce', 'u_od', 'u_do', 'u_stawka', 'u_wymiar', 'u_godziny', 'z_nazwa', 'z_email', 'z_nip', 'z_miasto', 'z_ulica'] },
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
        html += '<div><b>' + esc(LABELS[k] || k) + ':</b> ' + esc(k === 'u_typ' ? (TYP_LABEL[p[k]] || p[k]) : p[k]) + '</div>';
      });
      html += '</div>';
    });
    if (p.r_has === true) html += '<div class="grid"><div><b>Członkowie rodziny do NFZ:</b> ' + (1 + (Array.isArray(p.r_dodatkowi) ? p.r_dodatkowi.length : 0)) + '</div></div>';
    if (p.u_bezterminowo === true) html += '<div class="grid"><div><b>Okres:</b> bezterminowo (czas nieokreślony)</div></div>';
    if (p.u_minimalna === true) html += '<div class="grid"><div><b>Wynagrodzenie:</b> minimalne ustawowe (' + (p.u_typ === 'praca' ? 'miesięczne' : 'stawka godzinowa') + ')</div></div>';
    if (p.u_stawka) html += '<div class="grid"><div><b>Stawka:</b> ' + (p.u_jedn === 'mies' ? 'miesięczna' : 'godzinowa') + '</div></div>';
    if (p.u_godziny_zmienne === true) html += '<div class="grid"><div><b>Godziny:</b> zmienne — klient przesyła co miesiąc</div></div>';
    if (p.p_gotowka === true) html += '<div class="grid"><div><b>Wynagrodzenie:</b> gotówką (wniosek w komplecie)</div></div>';
    var docs = r.doc_paths || [];
    html += '<div class="sec">Dokumenty (' + docs.length + ')</div><div class="docs" data-docs></div>';
    html += '<div class="actions">';
    html += '<button class="btn-gen" data-act="generuj">🧾 Generuj komplet (' + esc(TYP_LABEL[p.u_typ] || 'umowa zlecenie') + ')</button>';
    if (r.status === 'nowe') html += '<button class="btn-rev" data-act="sprawdzone">✔ Oznacz jako sprawdzone</button>';
    html += '<button class="btn-send" data-act="wyslij">📤 ' + (r.status === 'wyslane' ? 'Wyślij ponownie' : 'Wyślij klientowi do podpisu') + '</button>';
    if (r.status === 'wyslane' || r.status === 'sprawdzone') html += '<button class="btn-rev" data-act="zatrudniony">✅ Podpisane — zatrudniony</button>';
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

  // ---------------- Send the packet to the client for signing ----------------
  var SEND_FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/wyslij-komplet';
  async function sendCall(body) {
    var sess = await window.sb.auth.getSession();
    var token = sess && sess.data && sess.data.session ? sess.data.session.access_token : '';
    var res = await fetch(SEND_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
    return out;
  }
  async function openSend(r, card) {
    var old = card.querySelector('.send-box'); if (old) { old.remove(); return; }
    var box = document.createElement('div');
    box.className = 'send-box';
    box.innerHTML = '<div class="muted">Sprawdzam komplet i dane kontaktowe klienta…</div>';
    card.querySelector('.detail').appendChild(box);
    var info;
    try { info = await sendCall({ action: 'info', id: r.id }); }
    catch (e) { box.innerHTML = '<div class="warn">' + esc(e.message) + '</div>'; return; }
    if (!info.komplet) {
      box.innerHTML = '<h4>Najpierw wygeneruj komplet</h4><div class="muted">Kliknij „Generuj komplet” w tym zgłoszeniu — wygenerowany plik zostanie tu dołączony i będzie można go wysłać.</div>';
      return;
    }
    var email = info.email_zgloszenie || info.email_baza || '';
    var history = (info.wyslano || []).map(function (w) {
      return fmtDate(w.at) + (w.email ? ' — e-mail ' + esc(w.email) : '') + (w.telegram ? ' — Telegram' : '');
    }).join('<br>');
    box.innerHTML =
      '<h4>Wyślij klientowi do podpisu</h4>' +
      '<div class="muted">Plik: ' + esc(info.filename) + ' (wygenerowany ' + esc(fmtDate(info.wygenerowano)) + ')</div>' +
      '<label><input type="checkbox" data-ch="mail"' + (info.mail_configured ? ' checked' : ' disabled') + ' /> E-mail z ' + esc(info.mail_from || 'kadry@td-group.pl') +
        (info.mail_configured ? '' : ' <span class="warn">— poczta nie jest jeszcze skonfigurowana</span>') + '</label>' +
      '<input type="email" data-email value="' + esc(email) + '" placeholder="e-mail klienta" />' +
      '<div class="muted">' + (info.email_zgloszenie ? 'Adres podany w zgłoszeniu.' : info.email_baza ? 'Adres z naszej bazy klientów.' : 'Brak adresu — wpisz go.') + '</div>' +
      '<label><input type="checkbox" data-ch="telegram"' + (info.telegram ? ' checked' : ' disabled') + ' /> Telegram klienta' +
        (info.telegram ? '' : ' <span class="muted">— brak czatu Telegram tego klienta w bazie</span>') + '</label>' +
      (history ? '<div class="muted" style="margin-top:6px">Wysłano wcześniej:<br>' + history + '</div>' : '') +
      '<div class="row-btn"><button class="btn-send" data-go>Wyślij</button><button class="btn-del" data-cancel>Anuluj</button></div>' +
      '<div data-res style="margin-top:8px"></div>';
    box.querySelector('[data-cancel]').addEventListener('click', function () { box.remove(); });
    box.querySelector('[data-go]').addEventListener('click', async function () {
      var btn = this, res = box.querySelector('[data-res]');
      var mail = box.querySelector('[data-ch="mail"]').checked, tg = box.querySelector('[data-ch="telegram"]').checked;
      var to = box.querySelector('[data-email]').value.trim();
      if (!mail && !tg) { res.innerHTML = '<span class="warn">Zaznacz e-mail lub Telegram.</span>'; return; }
      if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { res.innerHTML = '<span class="warn">Wpisz poprawny e-mail klienta.</span>'; return; }
      if (!confirm('Wysłać komplet dokumentów: ' + (r.worker_name || '') + '\n' + (mail ? 'e-mail: ' + to + '\n' : '') + (tg ? 'Telegram klienta\n' : ''))) return;
      btn.disabled = true; res.textContent = 'Wysyłam…';
      try {
        var out = await sendCall({ action: 'send', id: r.id, email: to, mail: mail, telegram: tg });
        var line = function (name, v) { return v === 'skipped' ? '' : name + ': ' + (v === 'ok' ? '✓ wysłano' : v === 'not_configured' ? 'nie skonfigurowano' : esc(v)) + '<br>'; };
        res.innerHTML = line('E-mail', out.mail) + line('Telegram', out.telegram);
        if (out.status === 'wyslane') {
          r.status = 'wyslane';
          toast('Wysłano klientowi do podpisu.');
          if (window.PortalShell) window.PortalShell.refreshBadge();
          setTimeout(function () { render(); }, 1800);
        } else btn.disabled = false;
      } catch (e) { res.innerHTML = '<span class="warn">' + esc(e.message) + '</span>'; btn.disabled = false; }
    });
  }

  async function onAction(r, act, card) {
    if (act === 'generuj') {
      // hand the submission off to the umowa-zlecenie generator, prefilled.
      // localStorage (not sessionStorage) so the new tab can read it.
      try { localStorage.setItem('tdcg_zlecenie_import', JSON.stringify(Object.assign({}, r.payload || {}, { _zid: r.id }))); } catch (e) {}
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
      if (window.PortalShell) window.PortalShell.refreshBadge();
      return;
    }
    if (act === 'wyslij') return openSend(r, card);
    if (act === 'zatrudniony') {
      if (!confirm('Potwierdzasz, że komplet wrócił podpisany?\n\n' + (r.worker_name || '') + ' przejdzie do rejestru pracowników, a portal zacznie pilnować terminów (ZUS, urząd pracy, dokumenty, koniec umowy).')) return;
      var z = await window.sb.from(TABLE).update({ status: 'zatrudniony' }).eq('id', r.id);
      if (z.error) return toast('Błąd: ' + z.error.message);
      rows = rows.filter(function (x) { return x.id !== r.id; });
      render(); toast('Przeniesiono do rejestru. Terminy są w Kontroli.');
      if (window.PortalShell) window.PortalShell.refreshBadge();
      return;
    }
    // status change: sprawdzone
    var patch = { status: act };
    if (act === 'sprawdzone') { patch.reviewed_at = new Date().toISOString(); }
    var u = await window.sb.from(TABLE).update(patch).eq('id', r.id).select().single();
    if (u.error) return toast('Błąd: ' + u.error.message);
    r.status = act; if (u.data) { r.reviewed_at = u.data.reviewed_at; }
    if (window.PortalShell) window.PortalShell.refreshBadge();
    render();
    toast('Oznaczono jako sprawdzone.');
  }

  load();
})();
