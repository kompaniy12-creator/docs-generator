/* Statutory minimum wage / minimum hourly rate for a given date.
   Loaded from the `stawki` edge function, which keeps portal_stawki current from
   the official register of acts (see supabase/functions/stawki). The values below
   are only a fallback for when the function cannot be reached. */
(function () {
  'use strict';
  var URL = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/stawki';
  var rows = [
    { valid_from: '2026-01-01', min_wage: 4806, min_hourly: 31.4 },
    { valid_from: '2027-01-01', min_wage: 4950, min_hourly: 32.3 },
  ];
  var ready = fetch(URL).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (d && Array.isArray(d.stawki) && d.stawki.length) rows = d.stawki;
  }).catch(function () { /* keep the fallback */ });

  // rates in force on the given ISO date (default: today)
  function at(iso) {
    var day = /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso : new Date().toISOString().slice(0, 10);
    var cur = rows[0];
    rows.forEach(function (r) { if (r.valid_from <= day) cur = r; });
    return { wage: Number(cur.min_wage), hourly: Number(cur.min_hourly), year: day.slice(0, 4), from: cur.valid_from };
  }
  function zl(n) { // 4806 -> "4 806", 31.4 -> "31,40"
    var s = Number(n) % 1 ? Number(n).toFixed(2).replace('.', ',') : String(Math.round(n));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  window.Stawki = { ready: ready, at: at, zl: zl };
})();
