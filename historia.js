/* Historia dokumentów — list, re-download, delete. Requires history.js (window.DocHistory). */
(function () {
  var listEl = document.getElementById('list');
  var loadingEl = document.getElementById('loading');
  var emptyEl = document.getElementById('empty');
  var errEl = document.getElementById('err');
  var searchEl = document.getElementById('search');
  var refreshEl = document.getElementById('refresh');

  var rows = [];

  function showError(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
  function clearError() { errEl.style.display = 'none'; }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function iconFor(docType) {
    var map = {
      'umowa-zlecenie': '📄', 'rejestracja-s24': '🏢', 'wynagrodzenie': '💰',
      'e-urzad': '🏛️', 'pelnomocnictwo': '🖋️',
    };
    return map[docType] || '🗂️';
  }

  function render() {
    var term = (searchEl.value || '').trim().toLowerCase();
    var filtered = rows.filter(function (r) {
      if (!term) return true;
      return [r.title, r.subject, r.user_email, r.filename].some(function (v) {
        return v && String(v).toLowerCase().indexOf(term) !== -1;
      });
    });

    listEl.innerHTML = '';
    if (filtered.length === 0) {
      emptyEl.style.display = 'block';
      emptyEl.textContent = rows.length === 0
        ? 'Brak zapisanych dokumentów. Wygeneruj pierwszy komplet w module Kadry.'
        : 'Brak wyników dla podanego zapytania.';
      return;
    }
    emptyEl.style.display = 'none';

    filtered.forEach(function (r) {
      var item = document.createElement('div');
      item.className = 'item';
      item.innerHTML =
        '<div class="ico">' + iconFor(r.doc_type) + '</div>' +
        '<div class="meta">' +
          '<div class="t">' + esc(r.title || r.doc_type || 'Dokument') + '</div>' +
          '<div class="s">' + esc(r.subject || '—') + '</div>' +
          '<div class="d">' + fmtDate(r.created_at) + (r.user_email ? ' · ' + esc(r.user_email) : '') + '</div>' +
        '</div>' +
        '<div class="acts">' +
          '<button class="btn dl">Pobierz</button>' +
          '<button class="btn rm">Usuń</button>' +
        '</div>';
      var dlBtn = item.querySelector('.dl');
      var rmBtn = item.querySelector('.rm');
      dlBtn.addEventListener('click', function () { onDownload(r, dlBtn); });
      rmBtn.addEventListener('click', function () { onDelete(r); });
      listEl.appendChild(item);
    });
  }

  async function onDownload(r, btn) {
    clearError();
    var orig = btn.textContent;
    btn.disabled = true; btn.textContent = '...';
    try {
      var url = await window.DocHistory.downloadUrl(r.pdf_path);
      var a = document.createElement('a');
      a.href = url; a.download = r.filename || 'dokument.pdf';
      a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) {
      showError('Nie udało się pobrać pliku: ' + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  async function onDelete(r) {
    if (!confirm('Usunąć ten dokument z historii? Operacji nie można cofnąć.')) return;
    clearError();
    try {
      await window.DocHistory.remove(r);
      rows = rows.filter(function (x) { return x.id !== r.id; });
      render();
    } catch (e) {
      showError('Nie udało się usunąć: ' + (e.message || e));
    }
  }

  async function load() {
    clearError();
    loadingEl.style.display = 'block';
    emptyEl.style.display = 'none';
    listEl.innerHTML = '';
    try {
      rows = await window.DocHistory.list();
      render();
    } catch (e) {
      showError('Nie udało się wczytać historii: ' + (e.message || e));
    } finally {
      loadingEl.style.display = 'none';
    }
  }

  searchEl.addEventListener('input', render);
  refreshEl.addEventListener('click', load);
  load();
})();
