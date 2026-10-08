/* Narzędzia księgowe — calculators for the office's accountants (Księgowość module).
   Pure calculation functions first (also loadable in node: `require('./narzedzia-ksiegowe.js')`),
   DOM code at the bottom, guarded. The calculators send nothing anywhere. The two register checks — biała lista VAT
   and VIES — are the exception: they call the `vat` edge function, which asks the Ministry of Finance / the
   European Commission and logs the check. */
(function (root) {
  'use strict';

  var ZWERYFIKOWANO = '2026-10-08'; // the day the tables below were read from the acts (ELI API, api.sejm.gov.pl)

  // ───────────────────────── verified rate tables (plain data) ─────────────────────────
  // Tax interest, basic rate — art. 56 § 1 Ordynacja podatkowa (t.j. Dz.U. 2026 poz. 622): 200% of the NBP
  // lombard rate + 2%, not lower than 8%. Values: obwieszczenia Ministra Finansów in Monitor Polski (art. 56d).
  // The announcements issued since 2016 do not name the first day; under art. 56c the rate changes "from the day
  // the lombard rate changed" — that day is taken from the Minister of Justice announcement issued for the same
  // NBP decision (table ODSETKI_USTAWOWE below, which does state the day). Reduced = 50% (art. 56a),
  // increased = 150% (art. 56b) — both only since 2016-01-01.
  var ODSETKI_PODATKOWE = [
    { od: '2014-10-09', stawka: 8,    akt: 'M.P. 2014 poz. 905' },  // "poczynając od dnia 9 października 2014 r." — 8,00%
    { od: '2016-01-01', stawka: 8,    akt: 'M.P. 2016 poz. 20' },   // 8% (new formula with the 8% floor)
    { od: '2022-02-09', stawka: 8.5,  akt: 'M.P. 2022 poz. 220' },  // 8,5% / 4,25% / 12,75%
    { od: '2022-03-09', stawka: 10,   akt: 'M.P. 2022 poz. 339' },  // 10% / 5% / 15%
    { od: '2022-04-07', stawka: 12,   akt: 'M.P. 2022 poz. 398' },  // 12% / 6% / 18%
    { od: '2022-05-06', stawka: 13.5, akt: 'M.P. 2022 poz. 468' },  // 13,5% / 6,75% / 20,25%
    { od: '2022-06-09', stawka: 15,   akt: 'M.P. 2022 poz. 607' },  // 15% / 7,5% / 22,5%
    { od: '2022-07-08', stawka: 16,   akt: 'M.P. 2022 poz. 679' },  // 16% / 8% / 24%
    { od: '2022-09-08', stawka: 16.5, akt: 'M.P. 2022 poz. 905' },  // 16,5% / 8,25% / 24,75%
    { od: '2023-09-07', stawka: 15,   akt: 'M.P. 2023 poz. 1017' }, // 15% / 7,5% / 22,5%
    { od: '2023-10-05', stawka: 14.5, akt: 'M.P. 2023 poz. 1101' }, // 14,5% / 7,25% / 21,75%
    { od: '2025-05-08', stawka: 13.5, akt: 'M.P. 2025 poz. 457' },  // 13,5% / 6,75% / 20,25%
    { od: '2025-07-03', stawka: 13,   akt: 'M.P. 2025 poz. 647' },  // 13% / 6,5% / 19,5%
    { od: '2025-09-04', stawka: 12.5, akt: 'M.P. 2025 poz. 950' },  // 12,5% / 6,25% / 18,75%
    { od: '2025-10-09', stawka: 12,   akt: 'M.P. 2025 poz. 1105' }, // 12% / 6% / 18%
    { od: '2025-11-06', stawka: 11.5, akt: 'M.P. 2025 poz. 1208' }, // 11,5% / 5,75% / 17,25%
    { od: '2025-12-04', stawka: 11,   akt: 'M.P. 2025 poz. 1252' }, // 11% / 5,5% / 16,5%
    { od: '2026-03-05', stawka: 10.5, akt: 'M.P. 2026 poz. 269' }   // 10,5% / 5,25% / 15,75%
  ];
  var PODATKOWE_WARIANTY_OD = '2016-01-01'; // 50% / 150% variants exist in this shape since this day (earlier: 75%)

  // Statutory interest for delay — art. 481 § 2 Kodeks cywilny (t.j. Dz.U. 2026 poz. 795): NBP reference rate
  // + 5,5 pp. Values and first days: obwieszczenia Ministra Sprawiedliwości in Monitor Polski (art. 481 § 2[4]).
  var ODSETKI_USTAWOWE = [
    { od: '2016-01-01', stawka: 7,     akt: 'M.P. 2016 poz. 47' },
    { od: '2020-03-18', stawka: 6.5,   akt: 'M.P. 2020 poz. 627' },
    { od: '2020-04-09', stawka: 6,     akt: 'M.P. 2020 poz. 627' },
    { od: '2020-05-29', stawka: 5.6,   akt: 'M.P. 2020 poz. 627' },
    { od: '2021-10-07', stawka: 6,     akt: 'M.P. 2021 poz. 953' },
    { od: '2021-11-04', stawka: 6.75,  akt: 'M.P. 2021 poz. 1097' },
    { od: '2021-12-09', stawka: 7.25,  akt: 'M.P. 2021 poz. 1202' },
    { od: '2022-01-05', stawka: 7.75,  akt: 'M.P. 2022 poz. 109' },
    { od: '2022-02-09', stawka: 8.25,  akt: 'M.P. 2022 poz. 285' },
    { od: '2022-03-09', stawka: 9,     akt: 'M.P. 2022 poz. 375' },
    { od: '2022-04-07', stawka: 10,    akt: 'M.P. 2022 poz. 482' },
    { od: '2022-05-06', stawka: 10.75, akt: 'M.P. 2022 poz. 586' },
    { od: '2022-06-09', stawka: 11.5,  akt: 'M.P. 2022 poz. 673' },
    { od: '2022-07-08', stawka: 12,    akt: 'M.P. 2022 poz. 710' },
    { od: '2022-09-08', stawka: 12.25, akt: 'M.P. 2022 poz. 943' },
    { od: '2023-09-07', stawka: 11.5,  akt: 'M.P. 2023 poz. 1061' },
    { od: '2023-10-05', stawka: 11.25, akt: 'M.P. 2023 poz. 1123' },
    { od: '2025-05-08', stawka: 10.75, akt: 'M.P. 2025 poz. 540' },
    { od: '2025-07-03', stawka: 10.5,  akt: 'M.P. 2025 poz. 685' },
    { od: '2025-09-04', stawka: 10.25, akt: 'M.P. 2025 poz. 1015' },
    { od: '2025-10-09', stawka: 10,    akt: 'M.P. 2025 poz. 1136' },
    { od: '2025-11-06', stawka: 9.75,  akt: 'M.P. 2025 poz. 1192' },
    { od: '2025-12-04', stawka: 9.5,   akt: 'M.P. 2025 poz. 1308' },
    { od: '2026-03-05', stawka: 9.25,  akt: 'M.P. 2026 poz. 367' }
  ];

  // Statutory interest for delay in commercial transactions — art. 4 pkt 3 and art. 11b ustawy o przeciwdziałaniu
  // nadmiernym opóźnieniom w transakcjach handlowych (t.j. Dz.U. 2023 poz. 1790): NBP reference rate of 1 January /
  // 1 July + 10 pp (+ 8 pp when the debtor is a public healthcare entity, since 2020). Announced per half-year by the
  // minister for the economy in Monitor Polski (art. 11c). `stawka` = ordinary debtor, `leczn` = public healthcare entity.
  var ODSETKI_HANDLOWE = [
    { od: '2016-01-01', stawka: 9.5,   leczn: 9.5,   akt: 'M.P. 2016 poz. 43' },
    { od: '2016-07-01', stawka: 9.5,   leczn: 9.5,   akt: 'M.P. 2016 poz. 601' },
    { od: '2017-01-01', stawka: 9.5,   leczn: 9.5,   akt: 'M.P. 2017 poz. 10' },
    { od: '2017-07-01', stawka: 9.5,   leczn: 9.5,   akt: 'M.P. 2017 poz. 686' },
    { od: '2018-01-01', stawka: 9.5,   leczn: 9.5,   akt: 'M.P. 2018 poz. 139' },
    { od: '2018-07-01', stawka: 9.5,   leczn: 9.5,   akt: 'M.P. 2018 poz. 671' },
    { od: '2019-01-01', stawka: 9.5,   leczn: 9.5,   akt: 'M.P. 2019 poz. 42' },
    { od: '2019-07-01', stawka: 9.5,   leczn: 9.5,   akt: 'M.P. 2019 poz. 671' },
    { od: '2020-01-01', stawka: 11.5,  leczn: 9.5,   akt: 'M.P. 2020 poz. 2' },
    { od: '2020-07-01', stawka: 10.1,  leczn: 8.1,   akt: 'M.P. 2020 poz. 610' },
    { od: '2021-01-01', stawka: 10.1,  leczn: 8.1,   akt: 'M.P. 2020 poz. 1212' },
    { od: '2021-07-01', stawka: 10.1,  leczn: 8.1,   akt: 'M.P. 2021 poz. 591' },
    { od: '2022-01-01', stawka: 11.75, leczn: 9.75,  akt: 'M.P. 2022 poz. 8' },
    { od: '2022-07-01', stawka: 16,    leczn: 14,    akt: 'M.P. 2022 poz. 636' },
    { od: '2023-01-01', stawka: 16.75, leczn: 14.75, akt: 'M.P. 2022 poz. 1263' },
    { od: '2023-07-01', stawka: 16.75, leczn: 14.75, akt: 'M.P. 2023 poz. 626' },
    { od: '2024-01-01', stawka: 15.75, leczn: 13.75, akt: 'M.P. 2023 poz. 1465' },
    { od: '2024-07-01', stawka: 15.75, leczn: 13.75, akt: 'M.P. 2024 poz. 546' },
    { od: '2025-01-01', stawka: 15.75, leczn: 13.75, akt: 'M.P. 2024 poz. 1106' },
    { od: '2025-07-01', stawka: 15.25, leczn: 13.25, akt: 'M.P. 2025 poz. 602' },
    { od: '2026-01-01', stawka: 14,    leczn: 12,    akt: 'M.P. 2025 poz. 1257' },
    { od: '2026-07-01', stawka: 13.75, leczn: 11.75, akt: 'M.P. 2026 poz. 642' }
  ];
  var HANDLOWE_DO = '2026-12-31'; // the last announced half-year ends here; later days have no announced rate yet

  // Threshold of art. 54 § 1 pkt 5 O.p.: 3 × the designated postal operator's fee for treating a letter as registered.
  // 8,70 zł is the amount shown by the Ministry of Finance interest calculator linked from podatki.gov.pl (read
  // 2026-10-08); the fee itself is set by Poczta Polska's price list, so the field stays editable in the UI.
  var PROG_ODSETEK_GR = 870;

  var STAWKI_VAT = [23, 8, 5, 0]; // art. 41 ust. 1, 2, 2a in connection with art. 146ef ustawy o VAT; 0% — art. 41 ust. 4 and following

  // ───────────────────────── helpers ─────────────────────────
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cyfry(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

  // "1 234,56" / "1234.56" / "1234" -> grosze (integer) or null
  function grosze(s) {
    var t = String(s == null ? '' : s).replace(/[\s ]|zł/gi, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    var p = t.split('.');
    var gr = Number(p[0]) * 100 + Number(((p[1] || '') + '00').slice(0, 2));
    return Number.isSafeInteger(gr) ? gr : null;
  }
  function zl(gr) {
    var neg = gr < 0, a = Math.abs(Math.round(gr));
    var c = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '−' : '') + c + ',' + String(a % 100).padStart(2, '0') + ' zł';
  }
  function proc(x) { return String(x).replace('.', ',') + '%'; }
  // "12,5" -> basis points (1250) or null; up to 2 decimals, 0 < rate <= 100
  function stawkaBp(s) {
    var t = String(s == null ? '' : s).replace(/[\s%]/g, '').replace(',', '.');
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
    var bp = Math.round(Number(t) * 100);
    return bp > 0 && bp <= 10000 ? bp : null;
  }

  // dates as day numbers (UTC), input 'YYYY-MM-DD'
  function dzien(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]), d = new Date(t);
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return Math.round(t / 86400000);
  }
  function iso(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  function dataPl(n) { var s = iso(n); return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4); }
  function weekend(n) { var w = new Date(n * 86400000).getUTCDay(); return w === 0 || w === 6; }

  // ───────────────────────── identifiers ─────────────────────────
  function nipOk(v) {
    var n = cyfry(v); if (n.length !== 10 || /^(\d)\1{9}$/.test(n)) return false;
    var w = [6, 5, 7, 2, 3, 4, 5, 6, 7], s = 0;
    for (var i = 0; i < 9; i++) s += w[i] * Number(n[i]);
    return s % 11 === Number(n[9]); // remainder 10 never equals a digit -> invalid
  }
  function peselOk(v) {
    var n = cyfry(v); if (n.length !== 11 || /^0{11}$/.test(n)) return false;
    var w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3], s = 0;
    for (var i = 0; i < 10; i++) s += w[i] * Number(n[i]);
    if ((10 - s % 10) % 10 !== Number(n[10])) return false;
    // the date part must be a real day (month carries the century: +20 = 20xx, +40 = 21xx, +60 = 22xx, +80 = 18xx)
    var mm = Number(n.slice(2, 4)), m = mm % 20, wiek = [1900, 2000, 2100, 2200, 1800][Math.floor(mm / 20)];
    return dzien((wiek + Number(n.slice(0, 2))) + '-' + String(m).padStart(2, '0') + '-' + n.slice(4, 6)) !== null;
  }

  // ───────────────────────── accounts (NRB / IBAN PL) ─────────────────────────
  function mod97(num) { var r = 0; for (var i = 0; i < num.length; i++) r = (r * 10 + Number(num[i])) % 97; return r; }
  // check digits for a 24-digit BBAN; "PL" = 2521, then "00" (ISO 13616 / mod 97-10)
  function cyfryKontrolne(bban) { return String(98 - mod97(bban + '252100')).padStart(2, '0'); }
  function nrbOk(nrb) { return /^\d{26}$/.test(nrb) && mod97(nrb.slice(2) + '2521' + nrb.slice(0, 2)) === 1; }
  function grupuj(nrb) { return nrb.slice(0, 2) + ' ' + nrb.slice(2).replace(/(\d{4})(?=\d)/g, '$1 '); }

  var MIKRO_STALA = '10100071222';  // NBP sort code 10100071 + supplementary 222 (podatki.gov.pl, "Z czego składa się mikrorachunek")
  var ZUS_STALA = '60000002026';    // "stały numer ZUS" (zus.pl, ulotka "Jak wypełnić dokument płatniczy")

  // tax micro-account: LK + 10100071 + 222 + Y + identifier + zeros up to 26 digits; Y = 1 for PESEL, 2 for NIP
  function mikrorachunek(typ, ident) {
    var id = cyfry(ident);
    if (typ === 'NIP') { if (!nipOk(id)) throw new Error('Nieprawidłowy NIP — nie zgadza się cyfra kontrolna.'); }
    else if (typ === 'PESEL') { if (!peselOk(id)) throw new Error('Nieprawidłowy PESEL — nie zgadza się cyfra kontrolna albo data urodzenia.'); }
    else throw new Error('Wybierz NIP albo PESEL.');
    var bban = (MIKRO_STALA + (typ === 'PESEL' ? '1' : '2') + id).padEnd(24, '0');
    return cyfryKontrolne(bban) + bban;
  }

  // check of any Polish account; recognises a tax micro-account and a ZUS contribution account (NRS)
  function sprawdzRachunek(wej) {
    var t = String(wej == null ? '' : wej).replace(/[\s -]/g, '').toUpperCase();
    if (!t) return { ok: false, blad: 'Wpisz numer rachunku.' };
    if (/^[A-Z]{2}/.test(t)) {
      if (t.slice(0, 2) !== 'PL') return { ok: false, blad: 'To narzędzie sprawdza tylko polskie rachunki (NRB / IBAN zaczynający się od PL).' };
      t = t.slice(2);
    }
    if (!/^\d+$/.test(t)) return { ok: false, blad: 'Numer rachunku może zawierać tylko cyfry (ewentualnie z „PL” na początku).' };
    if (t.length !== 26) return { ok: false, blad: 'Polski numer rachunku ma 26 cyfr — wpisano ' + t.length + '.' };
    var r = { ok: nrbOk(t), nrb: t, iban: 'PL' + grupuj(t), rodzaj: 'zwykly', uwagi: [] };
    if (!r.ok) {
      r.blad = 'Nieprawidłowa liczba kontrolna (mod 97) — w numerze jest błąd.';
      r.oczekiwane = cyfryKontrolne(t.slice(2)); // what the first two digits would be if the rest were right
    }
    var stala = t.slice(2, 13);
    if (stala === MIKRO_STALA) {
      var y = t[13], rest = t.slice(14);
      r.rodzaj = 'mikrorachunek';
      if (y === '2') { r.identTyp = 'NIP'; r.ident = rest.slice(0, 10); r.identOk = nipOk(r.ident) && rest.slice(10) === '00'; }
      else if (y === '1') { r.identTyp = 'PESEL'; r.ident = rest.slice(0, 11); r.identOk = peselOk(r.ident) && rest.slice(11) === '0'; }
      else { r.identOk = false; r.uwagi.push('Po stałej części 10100071222 powinna stać cyfra 1 (PESEL) albo 2 (NIP) — jest ' + y + '.'); }
      if (r.identTyp && !r.identOk) r.uwagi.push('Wpisany w rachunek ' + r.identTyp + ' ma błędną cyfrę kontrolną albo po nim nie ma samych zer — to nie jest prawidłowy mikrorachunek.');
    } else if (stala === ZUS_STALA) {
      r.rodzaj = 'zus';
      r.uzup = t.slice(13, 16);
      r.identTyp = 'NIP'; r.ident = t.slice(16); r.identOk = nipOk(r.ident);
      if (!r.identOk) r.uwagi.push('Ostatnie 10 cyfr nie jest prawidłowym NIP. Sprawdź numer w wyszukiwarce NRS na zus.pl albo na koncie płatnika w eZUS.');
    }
    return r;
  }

  // ───────────────────────── interest ─────────────────────────
  // splits days d1..d2 (inclusive) by the rate table; `pole` picks the rate column, `mnoznik` scales it (0.5 / 1.5)
  function okresy(tabela, d1, d2, pole, mnoznik) {
    var out = [];
    for (var i = 0; i < tabela.length; i++) {
      var a = dzien(tabela[i].od), b = i + 1 < tabela.length ? dzien(tabela[i + 1].od) - 1 : Infinity;
      var od = Math.max(a, d1), dd = Math.min(b, d2);
      if (od > dd) continue;
      var st = tabela[i][pole || 'stawka'] * (mnoznik || 1);
      var last = out[out.length - 1];
      if (last && last.bp === Math.round(st * 100)) { last.do = dd; last.dni = dd - last.od + 1; last.akt += ', ' + tabela[i].akt; } // same rate re-announced
      else out.push({ od: od, do: dd, dni: dd - od + 1, stawka: st, bp: Math.round(st * 100), akt: tabela[i].akt });
    }
    return out;
  }
  // Kz × L × O / 365 per period, exact (BigInt): returns the numerator over the common denominator 3 650 000
  var MIANOWNIK = 3650000n;
  function licznik(gr, lista) {
    var n = 0n;
    lista.forEach(function (o) {
      var c = BigInt(gr) * BigInt(o.dni) * BigInt(o.bp);
      n += c;
      o.kwota = Number(c * 100n / MIANOWNIK) / 100; // grosze with 2 decimals, for the breakdown only (not rounded)
    });
    return n;
  }
  function zaokr(n, d) { return Number((2n * n + d) / (2n * d)); } // n/d rounded half up

  function wspolne(p) {
    var gr = grosze(p.kwota), t = dzien(p.termin), z = dzien(p.zaplata);
    if (gr === null || gr <= 0) return { blad: 'Wpisz kwotę większą od zera (np. 1 250,00).' };
    if (gr > 1e13) return { blad: 'Kwota jest zbyt duża.' };
    if (t === null) return { blad: 'Wybierz termin płatności.' };
    if (z === null) return { blad: 'Wybierz dzień zapłaty.' };
    return { gr: gr, t: t, z: z, dni: z - t, uwagi: [] };
  }
  function poWeryfikacji(w) {
    if (w.z > dzien(ZWERYFIKOWANO)) w.uwagi.push('Dzień zapłaty przypada po ' + dataPl(dzien(ZWERYFIKOWANO)) + ' — za dni po tej dacie przyjęto ostatnią znaną stawkę; jeżeli stawka się zmieni, wynik będzie inny.');
  }

  /* Tax interest (Ordynacja podatkowa): from the day after the due date (art. 53 § 4) up to and including the day
     of payment (§ 4 ust. 1 of the 2005 regulation, t.j. Dz.U. 2021 poz. 703), Kz × L × O / 365 separately for each
     rate period, the SUM rounded to full złoty (§ 2 ust. 2 of the regulation; art. 63 § 1 O.p.); not charged when
     it would not exceed the threshold of art. 54 § 1 pkt 5.
     p: { kwota, termin, zaplata, rodzaj: 'podst' | 'obniz' | 'podwyz', stawka (optional, own rate in %), prog (zł) } */
  function odsetkiPodatkowe(p) {
    var w = wspolne(p); if (w.blad) return w;
    var prog = p.prog == null || p.prog === '' ? PROG_ODSETEK_GR : grosze(p.prog);
    if (prog === null) return { blad: 'Próg nienaliczania odsetek wpisz jako kwotę, np. 8,70.' };
    var res = { kwotaGr: w.gr, dni: Math.max(0, w.dni), okresy: [], uwagi: w.uwagi, progGr: prog };
    if (w.dni <= 0) { res.odsetkiGr = 0; res.dokladnieGr = 0; res.naliczane = false; res.brakZwloki = true; return res; }
    var d1 = w.t + 1, lista;
    var reczna = p.stawka != null && String(p.stawka).trim() !== '';
    if (reczna) {
      var bp = stawkaBp(p.stawka);
      if (bp === null) return { blad: 'Własną stawkę wpisz w procentach, np. 8 albo 10,5.' };
      lista = [{ od: d1, do: w.z, dni: w.dni, stawka: bp / 100, bp: bp, akt: 'stawka wpisana ręcznie' }];
      res.reczna = true;
    } else {
      var wariant = p.rodzaj === 'obniz' || p.rodzaj === 'podwyz';
      var start = dzien(wariant ? PODATKOWE_WARIANTY_OD : ODSETKI_PODATKOWE[0].od);
      if (d1 < start) return { blad: 'Wbudowana tabela stawek ' + (wariant ? 'obniżonej i podwyższonej' : '') + ' jest zweryfikowana od ' + dataPl(start) + '. Dla wcześniejszych okresów wpisz własną stawkę (jedną dla całego okresu) albo policz okres w częściach.', potrzebnaStawka: true };
      lista = okresy(ODSETKI_PODATKOWE, d1, w.z, 'stawka', p.rodzaj === 'obniz' ? 0.5 : p.rodzaj === 'podwyz' ? 1.5 : 1);
      poWeryfikacji(w);
    }
    var n = licznik(w.gr, lista);
    res.okresy = lista;
    res.dokladnieGr = Number(n * 100n / MIANOWNIK) / 100;         // before rounding, in grosze
    res.odsetkiGr = zaokr(n, MIANOWNIK * 100n) * 100;              // rounded to full złoty
    res.naliczane = res.odsetkiGr > prog;
    if (!res.naliczane && res.odsetkiGr > 0) res.uwagi.push('Odsetki po zaokrągleniu (' + zl(res.odsetkiGr) + ') nie przekraczają progu ' + zl(prog) + ' — nie nalicza się ich (art. 54 § 1 pkt 5 O.p.).');
    if (weekend(w.t)) res.uwagi.push('Wpisany termin płatności to sobota albo niedziela. Termin przypadający na sobotę lub dzień ustawowo wolny od pracy przesuwa się na następny dzień roboczy (art. 12 § 5 O.p.) — wpisz termin już przesunięty.');
    return res;
  }

  /* Civil interest: statutory for delay (art. 481 § 2 KC) or in commercial transactions (art. 7 / art. 8 of the
     2013 act). Counted from the day after the due date up to and including the day of payment, per rate period,
     year = 365 days (court and MF-calculator practice; the acts give an annual rate only), sum rounded to the grosz.
     p: { kwota, termin, zaplata, rodzaj: 'ustawowe' | 'handlowe' | 'handlowe_leczn', stawka (optional own rate) } */
  function odsetkiCywilne(p) {
    var w = wspolne(p); if (w.blad) return w;
    var res = { kwotaGr: w.gr, dni: Math.max(0, w.dni), okresy: [], uwagi: w.uwagi };
    if (w.dni <= 0) { res.odsetkiGr = 0; res.brakZwloki = true; return res; }
    var d1 = w.t + 1, lista;
    var reczna = p.stawka != null && String(p.stawka).trim() !== '';
    if (reczna) {
      var bp = stawkaBp(p.stawka);
      if (bp === null) return { blad: 'Własną stawkę wpisz w procentach, np. 9,25.' };
      lista = [{ od: d1, do: w.z, dni: w.dni, stawka: bp / 100, bp: bp, akt: 'stawka wpisana ręcznie' }];
      res.reczna = true;
    } else {
      var handl = p.rodzaj === 'handlowe' || p.rodzaj === 'handlowe_leczn';
      var tab = handl ? ODSETKI_HANDLOWE : ODSETKI_USTAWOWE, start = dzien(tab[0].od);
      if (d1 < start) return { blad: 'Wbudowana tabela jest zweryfikowana od ' + dataPl(start) + '. Dla wcześniejszych okresów wpisz własną stawkę.', potrzebnaStawka: true };
      if (handl && w.z > dzien(HANDLOWE_DO)) return { blad: 'Stawka odsetek w transakcjach handlowych jest ogłoszona tylko do ' + dataPl(dzien(HANDLOWE_DO)) + '. Dla późniejszych dni wpisz własną stawkę albo policz do tego dnia.', potrzebnaStawka: true };
      lista = okresy(tab, d1, w.z, p.rodzaj === 'handlowe_leczn' ? 'leczn' : 'stawka', 1);
      if (!handl) poWeryfikacji(w);
    }
    var n = licznik(w.gr, lista);
    res.okresy = lista;
    res.odsetkiGr = zaokr(n, MIANOWNIK);
    res.razemGr = w.gr + res.odsetkiGr;
    if (weekend(w.t)) res.uwagi.push('Wpisany termin płatności to sobota albo niedziela. Termin przypadający na sobotę lub dzień ustawowo wolny od pracy upływa następnego dnia roboczego (art. 115 KC) — wpisz termin już przesunięty.');
    return res;
  }

  // ───────────────────────── VAT ─────────────────────────
  // kierunek 'netto' = amount is net; 'brutto' = amount is gross (tax = gross × rate / (100 + rate), art. 106e ust. 7 ustawy o VAT)
  function vat(kwota, stawka, kierunek) {
    var gr = grosze(kwota), s = Number(stawka);
    if (gr === null) return { blad: 'Wpisz kwotę, np. 1 250,00.' };
    if (STAWKI_VAT.indexOf(s) < 0) return { blad: 'Wybierz stawkę VAT.' };
    var podatek = kierunek === 'brutto' ? Math.round(gr * s / (100 + s)) : Math.round(gr * s / 100);
    return kierunek === 'brutto'
      ? { nettoGr: gr - podatek, vatGr: podatek, bruttoGr: gr, stawka: s }
      : { nettoGr: gr, vatGr: podatek, bruttoGr: gr + podatek, stawka: s };
  }

  // ───────────────────────── registers: biała lista VAT, VIES ─────────────────────────
  // VIES member-state codes (check-status of the VIES REST API): 27 EU states — Greece is EL — and XI (Northern Ireland)
  var KRAJE_VIES = [['AT', 'Austria'], ['BE', 'Belgia'], ['BG', 'Bułgaria'], ['HR', 'Chorwacja'], ['CY', 'Cypr'], ['CZ', 'Czechy'], ['DK', 'Dania'],
    ['EE', 'Estonia'], ['FI', 'Finlandia'], ['FR', 'Francja'], ['EL', 'Grecja'], ['ES', 'Hiszpania'], ['NL', 'Holandia'], ['IE', 'Irlandia'],
    ['XI', 'Irlandia Północna'], ['LT', 'Litwa'], ['LU', 'Luksemburg'], ['LV', 'Łotwa'], ['MT', 'Malta'], ['DE', 'Niemcy'], ['PL', 'Polska'],
    ['PT', 'Portugalia'], ['RO', 'Rumunia'], ['SK', 'Słowacja'], ['SI', 'Słowenia'], ['SE', 'Szwecja'], ['HU', 'Węgry'], ['IT', 'Włochy']];

  function regonOk(v) {
    var n = cyfry(v); if (!/^(\d{9}|\d{14})$/.test(n) || /^0+$/.test(n)) return false;
    function suma(w) { var x = 0; for (var i = 0; i < w.length; i++) x += w[i] * Number(n[i]); return x % 11 % 10; }
    if (suma([8, 9, 2, 3, 4, 5, 6, 7]) !== Number(n[8])) return false;
    return n.length === 9 || suma([2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8]) === Number(n[13]);
  }
  // an account from the register: 26 digits, or a mask of virtual accounts with letters in place of digits
  function grupujKonto(k) { var t = String(k == null ? '' : k).replace(/\s/g, ''); return t.slice(0, 2) + ' ' + t.slice(2).replace(/(.{4})(?=.)/g, '$1 '); }
  // the register stamps its answers "DD-MM-RRRR GG:MM:SS" (Polish time)
  function czasWl(s) { var m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}:\d{2}:\d{2})$/.exec(String(s || '')); return m ? m[1] + '.' + m[2] + '.' + m[3] + ' r., godz. ' + m[4] : String(s || ''); }
  // VIES stamps in UTC (ISO); shown in Polish time
  function czasVies(s) {
    var d = new Date(String(s || '')); if (isNaN(d)) return String(s || '');
    var c = {}; new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(d).forEach(function (x) { c[x.type] = x.value; });
    return c.day + '.' + c.month + '.' + c.year + ' r., godz. ' + c.hour + ':' + c.minute + ':' + c.second;
  }
  function dataIso(s) { var n = dzien(s); return n === null ? String(s || '') : dataPl(n); }
  var STATUS_VAT = { 'Czynny': ['Podatnik VAT czynny', 'p-ok'], 'Zwolniony': ['Podatnik VAT zwolniony', 'p-amber'], 'Niezarejestrowany': ['Niezarejestrowany jako podatnik VAT', 'p-red'] };
  function statusVat(s) { return STATUS_VAT[s] || [s ? 'Status: ' + s : 'Brak statusu w wykazie', 'p-grey']; }
  var SZUKANE = { nip: 'NIP', regon: 'REGON', konto: 'rachunek' };

  // One-paragraph confirmations for the file. d = answer of the `vat` function, zap = what was asked.
  function potwierdzenieWl(d, zap) {
    var co = SZUKANE[zap.by] + ' ' + (zap.by === 'konto' ? grupujKonto(zap.value) : zap.value);
    var lista = (d.podmioty || []).map(function (p) {
      return (p.nazwa || 'podmiot bez nazwy') + (p.nip ? ', NIP ' + p.nip : '') + ' — ' + statusVat(p.status)[0];
    });
    return 'Potwierdzenie sprawdzenia w Wykazie podatników VAT (art. 96b ustawy o podatku od towarów i usług). Zapytanie z dnia ' + czasWl(d.requestDateTime)
      + ' o: ' + co + ', według stanu na dzień ' + dataIso(d.date) + ' r. Wynik: '
      + (lista.length ? lista.join('; ') + ' (status według stanu na dzień sprawdzenia).' : 'podmiotu nie ma w wykazie.')
      + ' Identyfikator wyszukiwania: ' + (d.requestId || 'brak') + '.';
  }
  function potwierdzeniePary(d) {
    return 'Potwierdzenie sprawdzenia rachunku w Wykazie podatników VAT (art. 96b ustawy o podatku od towarów i usług). Zapytanie z dnia ' + czasWl(d.requestDateTime)
      + ': czy rachunek ' + grupujKonto(d.konto) + ' jest przypisany w wykazie do podmiotu o NIP ' + d.nip + ' według stanu na dzień ' + dataIso(d.date) + ' r. Odpowiedź wykazu: '
      + (d.przypisany === 'TAK' ? 'TAK — rachunek jest przypisany do tego podmiotu.' : 'NIE — rachunek nie jest przypisany do tego podmiotu jako podatnika VAT czynnego.')
      + ' Identyfikator wyszukiwania: ' + (d.requestId || 'brak') + '.';
  }
  function potwierdzenieVies(d) {
    return 'Potwierdzenie sprawdzenia numeru VAT UE w systemie VIES Komisji Europejskiej. Zapytanie z dnia ' + czasVies(d.dataZapytania) + ' o numer ' + d.kraj + d.numer + '. Wynik: '
      + (d.wazny ? 'numer aktywny (ważny dla transakcji wewnątrzwspólnotowych)' : 'numer nieaktywny (VIES nie potwierdza go jako ważnego)')
      + (d.nazwa ? '; nazwa: ' + d.nazwa.replace(/\s*\n\s*/g, ', ') : '') + (d.adres ? '; adres: ' + d.adres.replace(/\s*\n\s*/g, ', ') : '') + '.'
      + (d.identyfikator ? ' Numer pytającego: ' + d.zWlasnym + '. Numer potwierdzenia (consultation number): ' + d.identyfikator + '.' : ' Bez numeru potwierdzenia — nie podano własnego numeru VAT UE.');
  }
  // what the user typed -> request for the `vat` function, or { blad }. Mirrors the server's checks so that
  // typing mistakes do not use up the Ministry's daily limit.
  function zapytanieWl(p) {
    var d = dzien(p.date);
    if (d === null) return { blad: 'Wybierz dzień, na który sprawdzasz wykaz.' };
    if (p.dzis && p.date > p.dzis) return { blad: 'Data nie może być datą przyszłą.' };
    if (p.tryb === 'para') {
      if (!nipOk(String(p.nip || '').replace(/^\s*PL/i, ''))) return { blad: 'Nieprawidłowy NIP kontrahenta — 10 cyfr z poprawną cyfrą kontrolną.' };
      var r = sprawdzRachunek(p.konto);
      if (!r.ok) return { blad: r.blad };
      return { action: 'wl_check', nip: cyfry(p.nip), konto: r.nrb, date: p.date };
    }
    if (p.by === 'nip') { if (!nipOk(String(p.value || '').replace(/^\s*PL/i, ''))) return { blad: 'Nieprawidłowy NIP — 10 cyfr z poprawną cyfrą kontrolną.' }; return { action: 'wl_search', by: 'nip', value: cyfry(p.value), date: p.date }; }
    if (p.by === 'regon') { if (!regonOk(p.value)) return { blad: 'Nieprawidłowy REGON — 9 albo 14 cyfr z poprawną cyfrą kontrolną.' }; return { action: 'wl_search', by: 'regon', value: cyfry(p.value), date: p.date }; }
    if (p.by === 'konto') { var k = sprawdzRachunek(p.value); if (!k.ok) return { blad: k.blad }; return { action: 'wl_search', by: 'konto', value: k.nrb, date: p.date }; }
    return { blad: 'Wybierz, po czym szukać.' };
  }
  function zapytanieVies(p) {
    var kraj = String(p.kraj || '').toUpperCase();
    if (!KRAJE_VIES.some(function (k) { return k[0] === kraj; })) return { blad: 'Wybierz państwo kontrahenta.' };
    var t = String(p.numer || '').toUpperCase().replace(/[\s .\-]/g, '');
    if ((t.indexOf(kraj) === 0 || (kraj === 'EL' && t.indexOf('GR') === 0)) && !(kraj === 'FR' && t.length === 11)) t = t.slice(2);
    if (!/^[0-9A-Z+*]{2,12}$/.test(t)) return { blad: 'Numer VAT może zawierać tylko litery i cyfry (2–12 znaków po kodzie kraju).' };
    if (kraj === 'PL' && !nipOk(t)) return { blad: 'Polski numer VAT UE to PL + prawidłowy NIP (10 cyfr).' };
    var z = { action: 'vies', kraj: kraj, numer: t }, w = String(p.wlasny || '').toUpperCase().replace(/[\s .\-]/g, '');
    if (w) {
      if (!/^([A-Z]{2})?[0-9A-Z+*]{2,12}$/.test(w)) return { blad: 'Twój numer VAT UE wpisz z kodem kraju, np. PL 1234567890 (sam NIP = Polska).' };
      if ((/^PL/.test(w) || /^\d/.test(w)) && !nipOk(w.replace(/^PL/, ''))) return { blad: 'Twój numer VAT UE: po PL musi stać prawidłowy NIP (10 cyfr).' };
      z.wlasny = w;
    }
    return z;
  }

  var API = {
    KRAJE_VIES: KRAJE_VIES, regonOk: regonOk, grupujKonto: grupujKonto, czasWl: czasWl, czasVies: czasVies, statusVat: statusVat,
    potwierdzenieWl: potwierdzenieWl, potwierdzeniePary: potwierdzeniePary, potwierdzenieVies: potwierdzenieVies, zapytanieWl: zapytanieWl, zapytanieVies: zapytanieVies,
    ZWERYFIKOWANO: ZWERYFIKOWANO, ODSETKI_PODATKOWE: ODSETKI_PODATKOWE, ODSETKI_USTAWOWE: ODSETKI_USTAWOWE, ODSETKI_HANDLOWE: ODSETKI_HANDLOWE,
    HANDLOWE_DO: HANDLOWE_DO, PROG_ODSETEK_GR: PROG_ODSETEK_GR, STAWKI_VAT: STAWKI_VAT,
    esc: esc, grosze: grosze, zl: zl, dzien: dzien, iso: iso, nipOk: nipOk, peselOk: peselOk, mod97: mod97, nrbOk: nrbOk, grupuj: grupuj,
    mikrorachunek: mikrorachunek, sprawdzRachunek: sprawdzRachunek, okresy: okresy, odsetkiPodatkowe: odsetkiPodatkowe, odsetkiCywilne: odsetkiCywilne, vat: vat
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof document === 'undefined') return;
  root.NarzedziaKsiegowe = API;

  // ───────────────────────── page ─────────────────────────
  function $(id) { return document.getElementById(id); }
  function html(id, h) { $(id).innerHTML = h; }
  var WER = dataPl(dzien(ZWERYFIKOWANO));

  function blad(t) { return '<div class="res err">' + esc(t) + '</div>'; }
  function uwagi(l) { return (l || []).map(function (u) { return '<p class="warn">' + esc(u) + '</p>'; }).join(''); }
  function kopiuj(btn, txt) {
    function ok() { var s = btn.textContent; btn.textContent = 'Skopiowano'; btn.classList.add('ok'); setTimeout(function () { btn.textContent = s; btn.classList.remove('ok'); }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function () { stary(); });
    else stary();
    function stary() { // http / old browsers
      var a = document.createElement('textarea'); a.value = txt; a.style.position = 'fixed'; a.style.opacity = '0';
      document.body.appendChild(a); a.select(); try { document.execCommand('copy'); ok(); } catch (e) { /* nothing more to do */ } a.remove();
    }
  }
  // the copy buttons carry the value in data-copy
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-copy]') : null;
    if (b) kopiuj(b, b.getAttribute('data-copy'));
  });

  function tabelaOkresow(lista, zGroszami) {
    return '<div class="scroll"><table class="tbl"><thead><tr><th>Okres</th><th>Dni</th><th>Stawka</th><th>Odsetki</th><th>Źródło stawki</th></tr></thead><tbody>'
      + lista.map(function (o) {
        return '<tr><td>' + esc(dataPl(o.od)) + ' – ' + esc(dataPl(o.do)) + '</td><td>' + esc(o.dni) + '</td><td>' + esc(proc(o.stawka)) + '</td><td>' + esc(zl(Math.round(o.kwota)))
          + '</td><td>' + esc(o.akt) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      + (zGroszami ? '' : '<p class="hint">Kwoty w wierszach są przed zaokrągleniem — zaokrągla się dopiero sumę.</p>');
  }
  function tabelaStawek(tab, kol) {
    return '<div class="scroll"><table class="tbl"><thead><tr><th>Od dnia</th>' + kol.map(function (k) { return '<th>' + esc(k[1]) + '</th>'; }).join('') + '<th>Akt</th></tr></thead><tbody>'
      + tab.slice().reverse().map(function (r) {
        return '<tr><td>' + esc(dataPl(dzien(r.od))) + '</td>' + kol.map(function (k) { return '<td>' + esc(proc(typeof k[0] === 'function' ? k[0](r) : r[k[0]])) + '</td>'; }).join('') + '<td>' + esc(r.akt) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // 1. mikrorachunek
  function rysMikro() {
    var typ = $('mkTyp').value, v = $('mkId').value;
    $('mkIdLab').textContent = typ === 'NIP' ? 'NIP' : 'PESEL';
    $('mkId').placeholder = typ === 'NIP' ? '10 cyfr' : '11 cyfr';
    if (!cyfry(v)) { html('mkOut', ''); return; }
    var potrzeba = typ === 'NIP' ? 10 : 11;
    if (cyfry(v).length < potrzeba) { html('mkOut', '<p class="hint">Wpisano ' + esc(cyfry(v).length) + ' z ' + potrzeba + ' cyfr.</p>'); return; }
    try {
      var nr = mikrorachunek(typ, v);
      html('mkOut', '<div class="res"><div class="lab">Mikrorachunek podatkowy (' + esc(typ) + ' ' + esc(cyfry(v)) + ')</div>'
        + '<div class="big mono">PL ' + esc(grupuj(nr)) + '</div>'
        + '<div class="acts"><button type="button" class="mini" data-copy="' + esc(nr) + '">Kopiuj 26 cyfr</button>'
        + '<button type="button" class="mini" data-copy="PL' + esc(nr) + '">Kopiuj jako IBAN</button>'
        + '<button type="button" class="mini" data-copy="' + esc(grupuj(nr)) + '">Kopiuj ze spacjami</button></div>'
        + '<p class="hint" style="margin:10px 0 0">Mikrorachunek służy tylko do wpłat — m.in. PIT (bez karty podatkowej), CIT i VAT (bez VAT w imporcie); pełną listę należności określa rozporządzenie Ministra Finansów z 22.12.2023 r. Pozostałe podatki wpłaca się na rachunek urzędu skarbowego.</p></div>');
    } catch (e) { html('mkOut', blad(e.message)); }
  }

  // 2. weryfikacja rachunku
  function rysRach() {
    var v = $('rbNr').value;
    if (!v.trim()) { html('rbOut', ''); return; }
    var r = sprawdzRachunek(v);
    if (!r.nrb) { html('rbOut', blad(r.blad)); return; }
    var h = '<div class="res' + (r.ok ? '' : ' err') + '">'
      + '<span class="pill ' + (r.ok ? 'p-ok' : 'p-red') + '">' + (r.ok ? 'Liczba kontrolna poprawna' : 'Błędna liczba kontrolna') + '</span>'
      + '<div class="big mono" style="margin-top:8px">' + esc(r.iban) + '</div>';
    if (!r.ok) h += '<p class="warn">' + esc(r.blad) + ' Dla pozostałych 24 cyfr liczba kontrolna powinna wynosić ' + esc(r.oczekiwane) + ' — ale błąd może być też w dowolnej innej cyfrze.</p>';
    if (r.rodzaj === 'mikrorachunek') {
      h += '<p><span class="pill p-navy">Mikrorachunek podatkowy</span> ' + (r.identTyp ? esc(r.identTyp) + ': <b class="mono">' + esc(r.ident) + '</b> '
        + '<span class="pill ' + (r.identOk ? 'p-ok' : 'p-red') + '">' + (r.identOk ? 'identyfikator poprawny' : 'identyfikator błędny') + '</span>' : '') + '</p>';
    } else if (r.rodzaj === 'zus') {
      h += '<p><span class="pill p-navy">Rachunek składkowy ZUS (NRS)</span> NIP płatnika: <b class="mono">' + esc(r.ident) + '</b> '
        + '<span class="pill ' + (r.identOk ? 'p-ok' : 'p-amber') + '">' + (r.identOk ? 'NIP poprawny' : 'to nie jest poprawny NIP') + '</span>'
        + ' · liczba uzupełniająca: <span class="mono">' + esc(r.uzup) + '</span></p>';
    } else if (r.ok) {
      h += '<p class="hint" style="margin:8px 0 0">Zwykły rachunek bankowy (nie mikrorachunek podatkowy i nie NRS ZUS). Poprawna liczba kontrolna nie potwierdza, że rachunek istnieje ani do kogo należy — rachunek kontrahenta VAT sprawdź w Wykazie podatników VAT (biała lista).</p>';
    }
    h += uwagi(r.uwagi);
    if (r.ok) h += '<div class="acts"><button type="button" class="mini" data-copy="' + esc(r.nrb) + '">Kopiuj 26 cyfr</button></div>';
    html('rbOut', h + '</div>');
  }

  // 3. odsetki podatkowe
  function rysPod() {
    var p = { kwota: $('opKwota').value, termin: $('opTermin').value, zaplata: $('opZaplata').value, rodzaj: $('opRodzaj').value, stawka: $('opStawka').value, prog: $('opProg').value };
    if (!p.kwota.trim() && !p.termin) { html('opOut', ''); return; }
    var r = odsetkiPodatkowe(p);
    if (r.blad) { html('opOut', blad(r.blad)); return; }
    if (r.brakZwloki) { html('opOut', '<div class="res">Zapłata w terminie albo przed terminem — odsetek za zwłokę nie ma.</div>'); return; }
    html('opOut', '<div class="res"><div class="lab">Odsetki za zwłokę ' + (r.naliczane ? 'do zapłaty' : '— nie nalicza się') + '</div>'
      + '<div class="big">' + esc(zl(r.naliczane ? r.odsetkiGr : 0)) + '</div>'
      + '<p style="margin:6px 0 0">Zaległość ' + esc(zl(r.kwotaGr)) + ' · ' + esc(r.dni) + ' dni zwłoki · przed zaokrągleniem ' + esc(zl(Math.round(r.dokladnieGr)))
      + (r.naliczane ? ' · razem z zaległością <b>' + esc(zl(r.kwotaGr + r.odsetkiGr)) + '</b>' : '') + '</p>'
      + (r.naliczane ? '<div class="acts" style="margin-top:8px"><button type="button" class="mini" data-copy="' + esc((r.odsetkiGr / 100).toFixed(2).replace('.', ',')) + '">Kopiuj kwotę odsetek</button></div>' : '')
      + uwagi(r.uwagi) + tabelaOkresow(r.okresy, false) + '</div>');
  }

  // 4. odsetki ustawowe / handlowe
  function rysCyw() {
    var p = { kwota: $('ocKwota').value, termin: $('ocTermin').value, zaplata: $('ocZaplata').value, rodzaj: $('ocRodzaj').value, stawka: $('ocStawka').value };
    var handl = p.rodzaj !== 'ustawowe';
    $('ocPodstawa').innerHTML = handl
      ? 'Podstawa: art. 4 pkt 3, art. 7 ust. 1, art. 8 ust. 1 i art. 11b ustawy z 8.03.2013 r. o przeciwdziałaniu nadmiernym opóźnieniom w transakcjach handlowych (t.j. Dz.U. 2023 poz. 1790): stopa referencyjna NBP z 1 stycznia / 1 lipca + 10 pkt proc. (+ 8 pkt proc., gdy dłużnikiem jest podmiot publiczny będący podmiotem leczniczym). Wierzycielowi przysługuje też rekompensata 40 / 70 / 100 euro (art. 10) — tu nieliczona. Stawki ogłoszone do ' + esc(dataPl(dzien(HANDLOWE_DO))) + '. Stan na ' + esc(WER) + '.'
      : 'Podstawa: art. 481 § 1 i 2 Kodeksu cywilnego (t.j. Dz.U. 2026 poz. 795): stopa referencyjna NBP + 5,5 pkt proc.; stawki z obwieszczeń Ministra Sprawiedliwości. Dotyczy opóźnień, dla których strony nie ustaliły własnej stopy. Stan na ' + esc(WER) + '.';
    if (!p.kwota.trim() && !p.termin) { html('ocOut', ''); return; }
    var r = odsetkiCywilne(p);
    if (r.blad) { html('ocOut', blad(r.blad)); return; }
    if (r.brakZwloki) { html('ocOut', '<div class="res">Zapłata w terminie albo przed terminem — odsetek za opóźnienie nie ma.</div>'); return; }
    html('ocOut', '<div class="res"><div class="lab">' + (handl ? 'Odsetki ustawowe za opóźnienie w transakcjach handlowych' : 'Odsetki ustawowe za opóźnienie') + '</div>'
      + '<div class="big">' + esc(zl(r.odsetkiGr)) + '</div>'
      + '<p style="margin:6px 0 0">Należność ' + esc(zl(r.kwotaGr)) + ' · ' + esc(r.dni) + ' dni opóźnienia · razem <b>' + esc(zl(r.razemGr)) + '</b></p>'
      + '<div class="acts" style="margin-top:8px"><button type="button" class="mini" data-copy="' + esc((r.odsetkiGr / 100).toFixed(2).replace('.', ',')) + '">Kopiuj kwotę odsetek</button></div>'
      + uwagi(r.uwagi) + tabelaOkresow(r.okresy, false) + '</div>');
  }

  // 5. VAT
  function rysVat() {
    var k = $('vtKier').value;
    $('vtKwotaLab').textContent = k === 'brutto' ? 'Kwota brutto' : 'Kwota netto';
    if (!$('vtKwota').value.trim()) { html('vtOut', ''); return; }
    var r = vat($('vtKwota').value, $('vtStawka').value, k);
    if (r.blad) { html('vtOut', blad(r.blad)); return; }
    function wiersz(n, gr, mocny) {
      return '<div class="kv"><span>' + esc(n) + '</span><span class="' + (mocny ? 'big' : '') + '">' + esc(zl(gr)) + '</span><button type="button" class="mini" data-copy="' + esc((gr / 100).toFixed(2).replace('.', ',')) + '">Kopiuj</button></div>';
    }
    html('vtOut', '<div class="res">' + wiersz('Netto', r.nettoGr, k === 'brutto') + wiersz('VAT ' + r.stawka + '%', r.vatGr, false) + wiersz('Brutto', r.bruttoGr, k !== 'brutto') + '</div>');
  }

  // 6–7. registers — the only tools that call the backend (function `vat`)
  var FN_VAT = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/vat';
  var LS_WLASNY = 'nk.vies.wlasny';
  function dzisiaj() { return iso(Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000)); }
  async function zapytaj(body) {
    try {
      var s = await root.sb.auth.getSession();
      var tok = s && s.data && s.data.session ? s.data.session.access_token : '';
      var res = await fetch(FN_VAT, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: root.sb.supabaseKey || '', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
      var out = await res.json().catch(function () { return null; });
      if (out && (out.error || res.ok)) return out;
      return { error: res.status === 404 ? 'Usługa sprawdzania nie jest jeszcze uruchomiona na serwerze portalu.' : 'Serwer portalu nie odpowiedział poprawnie (HTTP ' + res.status + '). Spróbuj ponownie.' };
    } catch (e) { return { error: 'Brak połączenia z serwerem portalu — sprawdzenie nie zostało wykonane.' }; }
  }
  // runs one check: locks the button, shows progress, hands the answer to `rys`
  async function sprawdz(btn, outId, zap, czekaj, rys) {
    if (btn.disabled) return;
    if (zap.blad) { html(outId, blad(zap.blad)); return; }
    btn.disabled = true; html(outId, '<p class="hint" style="margin:12px 0 0">' + esc(czekaj) + '</p>');
    var d = await zapytaj(zap);
    btn.disabled = false;
    html(outId, d.error ? blad(d.error) : rys(d, zap));
  }
  function dowod(etykieta, id, kiedy, potw) {
    return '<div class="lab" style="margin-top:10px">' + esc(etykieta) + '</div><div class="big mono">' + esc(id) + '</div>'
      + '<p style="margin:4px 0 0">' + kiedy + '</p>'
      + '<div class="acts"><button type="button" class="mini" data-copy="' + esc(id) + '">Kopiuj identyfikator</button>'
      + '<button type="button" class="mini" data-copy="' + esc(potw) + '">Kopiuj potwierdzenie</button></div>';
  }
  function wiersz(n, v) { return v ? '<p><span class="lab">' + esc(n) + '</span><br>' + v + '</p>' : ''; }
  function zdarzenie(n, data, podstawa) { return data || podstawa ? wiersz(n, esc(data ? dataIso(data) : '—') + (podstawa ? ' · podstawa: ' + esc(podstawa) : '')) : ''; }
  function rysPodmiot(p) {
    var st = statusVat(p.status);
    var h = '<div class="res"><div class="big">' + esc(p.nazwa || 'Podmiot bez nazwy w wykazie') + '</div>'
      + '<p><span class="pill ' + st[1] + '">' + esc(st[0]) + '</span></p>'
      + '<p>' + [p.nip && 'NIP: <b class="mono">' + esc(p.nip) + '</b>', p.regon && 'REGON: <span class="mono">' + esc(p.regon) + '</span>', p.krs && 'KRS: <span class="mono">' + esc(p.krs) + '</span>'].filter(Boolean).join(' · ') + '</p>'
      + wiersz('Adres rejestracyjny (siedziba; u osoby fizycznej — adres zamieszkania)', p.adresRejestracyjny && esc(p.adresRejestracyjny))
      + wiersz('Adres prowadzenia działalności (osoba fizyczna)', p.adresDzialalnosci && esc(p.adresDzialalnosci))
      + zdarzenie('Rejestracja jako podatnika VAT', p.dataRejestracji, '')
      + zdarzenie('Odmowa rejestracji', p.odmowaData, p.odmowaPodstawa)
      + zdarzenie('Wykreślenie z rejestru', p.wykreslenieData, p.wykresleniePodstawa)
      + zdarzenie('Przywrócenie rejestracji', p.przywrocenieData, p.przywroceniePodstawa);
    if (p.konta && p.konta.length) {
      h += '<div class="lab" style="margin-top:10px">Rachunki w wykazie (' + esc(p.konta.length) + ')</div><div class="scroll"><table class="tbl"><tbody>'
        + p.konta.map(function (k) { return '<tr><td class="mono">' + esc(grupujKonto(k)) + '</td><td><button type="button" class="mini" data-copy="' + esc(k) + '">Kopiuj</button></td></tr>'; }).join('')
        + '</tbody></table></div>';
    } else h += '<p class="warn">W wykazie nie ma żadnego rachunku tego podmiotu.</p>';
    if (p.wirtualne) h += '<p class="hint" style="margin:8px 0 0">Podmiot używa rachunków wirtualnych — wykaz podaje ich maski (wzorce) zamiast pojedynczych numerów. Konkretny rachunek wirtualny sprawdź w trybie „Para NIP + rachunek”.</p>';
    return h + '</div>';
  }
  function rysWl(d, zap) {
    var n = (d.podmioty || []).length, co = SZUKANE[zap.by] + ' ' + (zap.by === 'konto' ? grupujKonto(zap.value) : zap.value);
    return '<div class="res"><span class="pill ' + (n ? 'p-navy' : 'p-red') + '">' + (n ? 'Znaleziono w wykazie: ' + esc(n) : 'Nie ma takiego podmiotu w wykazie') + '</span>'
      + dowod('Identyfikator wyszukiwania — dowód sprawdzenia', d.requestId, 'Zapytanie: ' + esc(czasWl(d.requestDateTime)) + ' · ' + esc(co) + ' · stan na dzień ' + esc(dataIso(d.date)), potwierdzenieWl(d, zap))
      + (d.date !== dzisiaj() ? '<p class="warn">Nazwa, NIP, status i REGON są podawane według stanu na dzień sprawdzenia; rachunki, adresy i daty — według stanu na ' + esc(dataIso(d.date)) + ' (art. 96b ust. 2 ustawy o VAT).</p>' : '')
      + (n ? '' : '<p class="hint" style="margin:8px 0 0">W wykazie są podmioty zarejestrowane jako podatnicy VAT oraz te, którym odmówiono rejestracji albo które wykreślono (przez 5 lat). Brak wyniku nie musi oznaczać błędu — np. przedsiębiorca nigdy nie rejestrował się do VAT.</p>')
      + '</div>' + (d.podmioty || []).map(rysPodmiot).join('');
  }
  function rysPara(d) {
    var tak = d.przypisany === 'TAK';
    return '<div class="res"><span class="pill ' + (tak ? 'p-ok' : 'p-red') + '">' + (tak ? 'TAK — rachunek jest w wykazie przy tym NIP' : 'NIE — rachunku nie ma w wykazie przy tym NIP') + '</span>'
      + '<div class="big mono" style="margin-top:8px">' + esc(grupujKonto(d.konto)) + '</div>'
      + '<p style="margin:4px 0 0">NIP: <b class="mono">' + esc(d.nip) + '</b> · stan na dzień ' + esc(dataIso(d.date)) + '</p>'
      + (tak ? '' : '<p class="warn">Wykaz odpowiada TAK tylko wtedy, gdy rachunek jest przypisany do podmiotu będącego czynnym podatnikiem VAT. NIE pojawi się też, gdy kontrahent jest zwolniony, wykreślony albo nie ma go w wykazie — sprawdź go w trybie „Podmiot”. Przy płatności ponad 15 000 zł na taki rachunek rozważ podzieloną płatność albo zawiadomienie urzędu skarbowego w 7 dni od zlecenia przelewu.</p>')
      + dowod('Identyfikator wyszukiwania — dowód sprawdzenia', d.requestId, 'Zapytanie: ' + esc(czasWl(d.requestDateTime)), potwierdzeniePary(d)) + '</div>';
  }
  function rysVies(d) {
    var h = '<div class="res"><span class="pill ' + (d.wazny ? 'p-ok' : 'p-red') + '">' + (d.wazny ? 'Numer VAT UE aktywny' : 'Numer VAT UE nieaktywny') + '</span>'
      + '<div class="big mono" style="margin-top:8px">' + esc(d.kraj) + ' ' + esc(d.numer) + '</div>'
      + wiersz('Nazwa', d.nazwa && esc(d.nazwa)) + wiersz('Adres', d.adres && esc(d.adres).replace(/\n/g, '<br>'))
      + (d.wazny && !d.nazwa ? '<p class="hint" style="margin:8px 0 0">To państwo nie udostępnia w VIES nazwy ani adresu podatnika.</p>' : '')
      + (d.wazny ? '' : '<p class="warn">VIES nie potwierdza tego numeru jako ważnego dla transakcji wewnątrzwspólnotowych — bez ważnego numeru nabywcy nie ma stawki 0% dla WDT (art. 42 ust. 1 pkt 1 ustawy o VAT). Sprawdź, czy numer i państwo są wpisane poprawnie; kontrahent może wyjaśnić sprawę w swoim urzędzie skarbowym.</p>');
    if (d.identyfikator) h += dowod('Numer potwierdzenia (consultation number) — dowód weryfikacji', d.identyfikator, 'Zapytanie: ' + esc(czasVies(d.dataZapytania)) + ' · pytający: ' + esc(d.zWlasnym), potwierdzenieVies(d));
    else h += '<p style="margin:8px 0 0">Zapytanie: ' + esc(czasVies(d.dataZapytania)) + '</p>'
      + '<p class="warn">' + (d.zWlasnym ? 'VIES nie nadał numeru potwierdzenia, mimo że podano własny numer VAT UE.' : 'Bez numeru potwierdzenia — wpisz własny numer VAT UE i sprawdź ponownie, aby mieć dowód weryfikacji.') + '</p>'
      + '<div class="acts"><button type="button" class="mini" data-copy="' + esc(potwierdzenieVies(d)) + '">Kopiuj potwierdzenie</button></div>';
    return h + '</div>';
  }
  function rysWlPola() {
    var para = $('wlTryb').value === 'para', by = $('wlBy').value;
    $('wlSzukaj').hidden = para; $('wlPara').hidden = !para;
    $('wlValLab').textContent = by === 'nip' ? 'NIP' : by === 'regon' ? 'REGON' : 'Numer rachunku';
    $('wlVal').placeholder = by === 'nip' ? '10 cyfr' : by === 'regon' ? '9 albo 14 cyfr' : '26 cyfr';
    $('wlVal').classList.toggle('mono', by === 'konto');
  }
  function idzWl() {
    var zap = zapytanieWl({ tryb: $('wlTryb').value, by: $('wlBy').value, value: $('wlVal').value, nip: $('wlNip').value, konto: $('wlKonto').value, date: $('wlData').value, dzis: dzisiaj() });
    sprawdz($('wlGo'), 'wlOut', zap, 'Pytam Wykaz podatników VAT…', zap.action === 'wl_check' ? rysPara : rysWl);
  }
  function idzVies() {
    var zap = zapytanieVies({ kraj: $('vsKraj').value, numer: $('vsNumer').value, wlasny: $('vsWlasny').value });
    if (!zap.blad) { try { if (zap.wlasny) localStorage.setItem(LS_WLASNY, zap.wlasny); else localStorage.removeItem(LS_WLASNY); } catch (e) { /* private mode */ } }
    sprawdz($('vsGo'), 'vsOut', zap, 'Pytam system VIES — odpowiedź państwa członkowskiego może potrwać kilkanaście sekund…', rysVies);
  }

  function start() {
    // tabs
    var tabs = $('tabs');
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]'); if (!b) return;
      Array.prototype.forEach.call(tabs.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) { p.hidden = p.id !== 'p-' + b.getAttribute('data-tab'); });
      try { history.replaceState(null, '', '#' + b.getAttribute('data-tab')); } catch (err) { /* file:// */ }
    });
    var h = location.hash.slice(1), pocz = h && tabs.querySelector('button[data-tab="' + h.replace(/[^a-z]/g, '') + '"]');
    if (pocz) pocz.click();

    [['mkTyp', rysMikro], ['mkId', rysMikro], ['rbNr', rysRach],
     ['opKwota', rysPod], ['opTermin', rysPod], ['opZaplata', rysPod], ['opRodzaj', rysPod], ['opStawka', rysPod], ['opProg', rysPod],
     ['ocKwota', rysCyw], ['ocTermin', rysCyw], ['ocZaplata', rysCyw], ['ocRodzaj', rysCyw], ['ocStawka', rysCyw],
     ['vtKwota', rysVat], ['vtStawka', rysVat], ['vtKier', rysVat]].forEach(function (x) {
      $(x[0]).addEventListener('input', x[1]); $(x[0]).addEventListener('change', x[1]);
    });

    // defaults: payment day = today, threshold = verified amount
    var dzis = iso(Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000));
    $('opZaplata').value = dzis; $('ocZaplata').value = dzis;
    $('opProg').value = (PROG_ODSETEK_GR / 100).toFixed(2).replace('.', ',');
    $('vtStawka').innerHTML = STAWKI_VAT.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '%</option>'; }).join('');

    // built-in tables, so the accountant sees exactly what the calculator uses
    html('opTabela', tabelaStawek(ODSETKI_PODATKOWE, [['stawka', 'Podstawowa'], [function (r) { return r.od < PODATKOWE_WARIANTY_OD ? '—' : r.stawka / 2; }, 'Obniżona'], [function (r) { return r.od < PODATKOWE_WARIANTY_OD ? '—' : r.stawka * 1.5; }, 'Podwyższona']]).replace(/—%/g, '—'));
    html('ocTabelaU', tabelaStawek(ODSETKI_USTAWOWE, [['stawka', 'Stawka']]));
    html('ocTabelaH', tabelaStawek(ODSETKI_HANDLOWE, [['stawka', 'Dłużnik zwykły'], ['leczn', 'Publiczny podmiot leczniczy']]));
    Array.prototype.forEach.call(document.querySelectorAll('[data-wer]'), function (el) { el.textContent = WER; });
    $('opOd').textContent = dataPl(dzien(ODSETKI_PODATKOWE[0].od));
    $('opOdWar').textContent = dataPl(dzien(PODATKOWE_WARIANTY_OD));
    rysCyw(); rysVat(); rysMikro();

    // registers: asked only on the button (or Enter) — every question counts against the Ministry's daily limit
    $('wlData').value = dzis; $('wlData').max = dzis;
    $('vsKraj').innerHTML = KRAJE_VIES.map(function (k) { return '<option value="' + esc(k[0]) + '">' + esc(k[1]) + ' (' + esc(k[0]) + ')</option>'; }).join('');
    $('vsKraj').value = 'DE';
    try { $('vsWlasny').value = localStorage.getItem(LS_WLASNY) || ''; } catch (e) { /* private mode */ }
    ['wlTryb', 'wlBy'].forEach(function (id) { $(id).addEventListener('change', function () { rysWlPola(); html('wlOut', ''); }); });
    rysWlPola();
    $('wlGo').addEventListener('click', idzWl); $('vsGo').addEventListener('click', idzVies);
    [['wlVal', idzWl], ['wlNip', idzWl], ['wlKonto', idzWl], ['vsNumer', idzVies], ['vsWlasny', idzVies]].forEach(function (x) {
      $(x[0]).addEventListener('keydown', function (e) { if (e.key === 'Enter') x[1](); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
