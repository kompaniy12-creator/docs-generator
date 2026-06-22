/* Worker directory (zleceniobiorcy) stored in the portal's own Supabase.
   wFirma's API does not expose HR personal data, so the portal keeps its own
   reusable worker profiles. Requires window.sb. RLS: app_metadata.portal users. */
(function () {
  var TABLE = 'portal_workers';
  function sb() { if (!window.sb) throw new Error('Supabase niezainicjalizowany'); return window.sb; }

  async function list() {
    var r = await sb().from(TABLE).select('id,nazwisko,imiona,pesel,updated_at')
      .order('nazwisko', { ascending: true }).limit(500);
    if (r.error) throw r.error;
    return r.data || [];
  }
  async function get(id) {
    var r = await sb().from(TABLE).select('*').eq('id', id).single();
    if (r.error) throw r.error;
    return r.data;
  }
  async function save(rec) {
    var c = sb();
    var u = await c.auth.getUser();
    var uid = (u && u.data && u.data.user) ? u.data.user.id : null;
    var row = {
      nazwisko: rec.nazwisko || null,
      imiona: rec.imiona || null,
      pesel: rec.pesel || null,
      data: rec.data || {},
      search: ((rec.nazwisko || '') + ' ' + (rec.imiona || '') + ' ' + (rec.pesel || '')).toLowerCase().trim(),
      updated_at: new Date().toISOString(),
    };
    // Update existing profile when PESEL matches, otherwise insert a new one.
    if (rec.pesel) {
      var ex = await c.from(TABLE).select('id').eq('pesel', rec.pesel).limit(1);
      if (!ex.error && ex.data && ex.data.length) {
        var up = await c.from(TABLE).update(row).eq('id', ex.data[0].id).select().single();
        if (up.error) throw up.error;
        return up.data;
      }
    }
    row.created_by = uid;
    var ins = await c.from(TABLE).insert(row).select().single();
    if (ins.error) throw ins.error;
    return ins.data;
  }
  async function remove(id) {
    var r = await sb().from(TABLE).delete().eq('id', id);
    if (r.error) throw r.error;
    return true;
  }

  window.Workers = { list: list, get: get, save: save, remove: remove };
})();
