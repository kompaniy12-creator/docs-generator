/* Frontend helper for the wFirma proxy Edge Function.
   Calls are made via sb.functions.invoke, which automatically attaches the
   logged-in portal user's JWT. The wFirma keys live only server-side. */
(function () {
  async function invoke(payload) {
    if (!window.sb) throw new Error('Supabase niezainicjalizowany');
    const { data, error } = await window.sb.functions.invoke('wfirma', { body: payload });
    if (error) {
      let msg = error.message || 'Błąd połączenia';
      let status;
      try {
        if (error.context) {
          status = error.context.status;
          const b = await error.context.json();
          if (b && b.error) msg = b.error;
        }
      } catch (e) { /* ignore */ }
      const err = new Error(msg);
      err.status = status;
      throw err;
    }
    return data;
  }
  window.WFirma = {
    invoke: invoke,
    ping: function () { return invoke({ action: 'ping' }); },
    companies: function () { return invoke({ action: 'companies' }); },
    company: function (id) { return invoke({ action: 'company', id: String(id) }); },
  };
})();
