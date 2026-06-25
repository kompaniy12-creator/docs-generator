/* Shared document-history helper for the portal.
   Requires window.sb (supabase-config.js). Stores generated PDFs in the
   private 'portal-documents' storage bucket + a row in portal_doc_history.
   Access is restricted by RLS to users with app_metadata.portal = true. */
(function () {
  var BUCKET = 'portal-documents';
  var TABLE = 'portal_doc_history';

  function client() {
    if (!window.sb) throw new Error('Supabase niezainicjalizowany');
    return window.sb;
  }

  async function save(rec) {
    var sb = client();
    var userRes = await sb.auth.getUser();
    var user = userRes && userRes.data ? userRes.data.user : null;

    var datePart = new Date().toISOString().slice(0, 10);
    var rand = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.round(performance.now() * 1000));
    var blob = rec.blob || new Blob([rec.pdfBytes], { type: rec.mime || 'application/pdf' });
    var ext = (rec.filename && rec.filename.indexOf('.') !== -1) ? rec.filename.split('.').pop().toLowerCase() : 'pdf';
    var path = (rec.docType || 'dok') + '/' + datePart + '/' + rand + '.' + ext;

    var up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
    if (up.error) throw up.error;

    var ins = await sb.from(TABLE).insert({
      user_id: user ? user.id : null,
      user_email: user ? user.email : null,
      doc_type: rec.docType || null,
      title: rec.title || null,
      subject: rec.subject || null,
      filename: rec.filename || null,
      pdf_path: path,
      payload: rec.payload || null,
    }).select().single();
    if (ins.error) {
      // best-effort cleanup of the orphaned object
      try { await sb.storage.from(BUCKET).remove([path]); } catch (e) {}
      throw ins.error;
    }
    return ins.data;
  }

  async function list(opts) {
    var sb = client();
    opts = opts || {};
    var q = sb.from(TABLE).select('*').order('created_at', { ascending: false }).limit(opts.limit || 300);
    if (opts.docType) q = q.eq('doc_type', opts.docType);
    var res = await q;
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function downloadUrl(path) {
    var sb = client();
    var res = await sb.storage.from(BUCKET).createSignedUrl(path, 120);
    if (res.error) throw res.error;
    return res.data.signedUrl;
  }

  async function remove(row) {
    var sb = client();
    if (row.pdf_path) {
      try { await sb.storage.from(BUCKET).remove([row.pdf_path]); } catch (e) {}
    }
    var res = await sb.from(TABLE).delete().eq('id', row.id);
    if (res.error) throw res.error;
    return true;
  }

  // Snapshot the current form in autosave's format, so "Edytuj" in Historia can
  // restore it (including dynamic lists) by writing it back to the autosave key.
  function captureFormSnapshot() {
    try {
      var cfg = window.AUTOSAVE;
      if (!cfg || !cfg.key) return null;
      var form = document.querySelector(cfg.form || '#form');
      if (!form) return null;
      var fields = [];
      new FormData(form).forEach(function (v, k) { if (typeof v === 'string') fields.push([k, v]); });
      var lists = {};
      (cfg.lists || []).forEach(function (pair) {
        var c = document.querySelector(pair[0]);
        if (c) lists[pair[1]] = c.querySelectorAll('.subgroup').length;
      });
      return { v: 1, key: cfg.key, fields: fields, lists: lists };
    } catch (e) { return null; }
  }

  // Download a generated document to the user AND save it to history.
  // The single entry point every generator should use so nothing is lost.
  // opts: { docType, title, subject, filename, payload, mime, and either bytes or blob }
  async function download(opts) {
    var mime = opts.mime || 'application/pdf';
    var blob = opts.blob || new Blob([opts.bytes], { type: mime });
    // capture BEFORE the 'tdcg:generated' event clears the form's autosave
    var formSnap = captureFormSnapshot();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = opts.filename || 'dokument';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    // Sygnał dla autosave: dokument wygenerowany — wyczyść zapamiętane dane formularza,
    // aby po powrocie na stronę formularz był pusty.
    try { window.dispatchEvent(new Event('tdcg:generated')); } catch (e) { /* ignore */ }
    var payload = opts.payload;
    if (formSnap) payload = Object.assign({}, opts.payload || {}, { _autosave: formSnap });
    try {
      await save({
        docType: opts.docType, title: opts.title, subject: opts.subject,
        filename: opts.filename, payload: payload, blob: blob,
      });
      return { saved: true };
    } catch (e) {
      console.warn('Zapis do historii nie powiódł się:', e);
      return { saved: false, error: e };
    }
  }

  window.DocHistory = { save: save, list: list, downloadUrl: downloadUrl, remove: remove, download: download };
  // Convenience global so every generator can do: await saveAndDownload({...})
  window.saveAndDownload = download;
})();
