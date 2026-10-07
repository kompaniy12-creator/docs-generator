/* Company lookup by NIP through the `firma` edge function (rejestr.io / KRS):
   registry data plus the people entitled to sign for the company and the rule of
   representation. Portal pages only — the function requires a portal session. */
(function () {
  'use strict';
  var FN = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/firma';
  async function lookup(nip, fresh) {
    var n = String(nip || '').replace(/\D/g, '');
    if (n.length !== 10) throw new Error('NIP musi mieć 10 cyfr.');
    var s = await window.sb.auth.getSession();
    var token = s && s.data && s.data.session ? s.data.session.access_token : '';
    var res = await fetch(FN + '?nip=' + n + (fresh ? '&fresh=1' : ''), { headers: { apikey: window.sb.supabaseKey || '', Authorization: 'Bearer ' + token } });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || ('Błąd ' + res.status));
    return out;
  }
  // "Jan Kowalski — Prezes Zarządu"
  function label(o) { return o.imie_nazwisko + (o.funkcja ? ' — ' + o.funkcja : ''); }
  window.Firma = { lookup: lookup, label: label };
})();
