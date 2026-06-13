/* Autosave: zachowuje dane formularza w localStorage i przywraca je po odświeżeniu strony.
   Konfiguracja per strona przez window.AUTOSAVE = { key, form, lists }:
     key   – unikalny klucz pamięci (string)
     form  – selektor formularza (domyślnie '#form')
     lists – tablica [containerSelector, addButtonSelector] dla list dynamicznych
   Skrypt należy dołączyć PO głównym skrypcie strony (gdy istnieją już początkowe pola). */
(function () {
  const cfg = window.AUTOSAVE;
  if (!cfg || !cfg.key) return;

  const form = document.querySelector(cfg.form || '#form');
  if (!form) return;

  const STORAGE_KEY = 'tdcg_autosave_' + cfg.key;
  const lists = cfg.lists || [];
  let restoring = false;
  let saveTimer = null;

  function snapshot() {
    const fields = [];
    const fd = new FormData(form);
    for (const [name, value] of fd.entries()) {
      if (typeof value === 'string') fields.push([name, value]);
    }
    const listCounts = {};
    lists.forEach(([containerSel, addBtnSel]) => {
      const c = document.querySelector(containerSel);
      if (c) listCounts[addBtnSel] = c.querySelectorAll('.subgroup').length;
    });
    return { v: 1, fields, lists: listCounts };
  }

  function save() {
    if (restoring) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
    } catch (e) { /* quota / brak dostępu — ignorujemy */ }
  }

  function scheduleSave() {
    if (restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  }

  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyField(name, value) {
    const els = form.querySelectorAll(`[name="${CSS.escape(name)}"]`);
    if (!els.length) return;
    if (els.length > 1) {
      // grupa radio
      els.forEach(el => { el.checked = (el.value === value); });
      els.forEach(el => { if (el.checked) fire(el); });
      return;
    }
    const el = els[0];
    if (el.type === 'checkbox') {
      el.checked = true;
    } else if (el.type === 'radio') {
      el.checked = (el.value === value);
    } else if (el.type === 'file') {
      return; // plików nie da się przywrócić
    } else {
      el.value = value;
    }
    fire(el);
  }

  function restore() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) { data = null; }
    if (!data || !Array.isArray(data.fields)) return;

    restoring = true;

    // 1) odtwórz właściwą liczbę grup dynamicznych
    lists.forEach(([containerSel, addBtnSel]) => {
      const container = document.querySelector(containerSel);
      const btn = document.querySelector(addBtnSel);
      const target = (data.lists && data.lists[addBtnSel]) || 0;
      if (!container || !btn) return;
      let guard = 50;
      while (container.querySelectorAll('.subgroup').length < target && guard-- > 0) {
        const before = container.querySelectorAll('.subgroup').length;
        btn.click();
        if (container.querySelectorAll('.subgroup').length === before) break; // np. osiągnięto limit
      }
    });

    // 2) ustaw wartości pól
    data.fields.forEach(([name, value]) => applyField(name, value));

    restoring = false;
  }

  function clearForm() {
    if (!confirm('Wyczyścić formularz? Wprowadzone dane zostaną usunięte.')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  function addClearButton() {
    const submit = form.querySelector('[type="submit"]');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'clearFormBtn';
    btn.textContent = 'Wyczyść formularz';
    btn.style.cssText = 'display:block;width:100%;margin-top:10px;padding:12px;' +
      'background:#fff;color:#991b1b;border:1px solid #fecaca;border-radius:10px;' +
      'font-size:15px;font-weight:600;cursor:pointer';
    btn.addEventListener('click', clearForm);
    if (submit && submit.parentNode) {
      submit.parentNode.insertBefore(btn, submit.nextSibling);
    } else {
      form.appendChild(btn);
    }
  }

  // Przywróć, a następnie zacznij nasłuchiwać zmian
  restore();
  addClearButton();
  form.addEventListener('input', scheduleSave);
  form.addEventListener('change', scheduleSave);
  window.addEventListener('beforeunload', save);
})();
