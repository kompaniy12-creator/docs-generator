// deno test supabase/functions/sms/logic_test.ts
// Fictional numbers only (ranges that are not assigned to anybody are not guaranteed — nothing here is sent).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { analiza, bezPolskich, czytajOdpowiedz, czytajUst, DOMYSLNE, inicjaly, maska, numer, pierwszyNumer, poczatekDnia, przygotuj, sprawdzUst, statusDoreczenia, SZABLONY, wGodzinach, wypelnij } from "./logic.ts";

const e164 = (s: string, z = false) => { const n = numer(s, z); return n.ok ? n.e164 : "BŁĄD"; };

Deno.test("numer: Polish mobile formats", () => {
  for (const s of ["600100200", "600 100 200", "600-100-200", "+48600100200", "+48 600 100 200", "0048600100200", "0048 600-100-200", "48600100200", "(+48) 600 100 200", "0600100200", "600.100.200"]) {
    assertEquals(e164(s), "+48600100200", s);
  }
  for (const p of ["45", "50", "51", "53", "57", "60", "66", "69", "72", "73", "78", "79", "88"]) assertEquals(e164(p + "0100200"), "+48" + p + "0100200");
});
Deno.test("numer: landlines, premium, short and broken numbers are refused", () => {
  for (const s of ["221234567", "22 123 45 67", "+48 61 600 68 28", "123456789", "326543210"]) assert(!numer(s).ok, s);
  for (const s of ["700123456", "701 234 567", "800123456", "801 234 567", "+48 708 123 456", "804123456"]) {
    const n = numer(s); assert(!n.ok && /70x i 80x/.test(n.error), s);
  }
  for (const s of ["", "112", "7250", "19115", "60010020", "6001002001", "600100200x", "sześćset", "600100200;drop", "+48 600 100 20", "++48600100200"]) assert(!numer(s).ok, JSON.stringify(s));
  assert(!numer(null).ok); assert(!numer(undefined).ok); assert(!numer(600100200.5).ok);
});
Deno.test("numer: foreign numbers only when clearly mobile and allowed", () => {
  assert(!numer("+380501234567").ok); // allowed pattern, but foreign sending is off
  assertEquals(e164("+380501234567", true), "+380501234567");
  assertEquals(e164("00380 67 123 45 67", true), "+380671234567");
  assertEquals(e164("+49 151 23456789", true), "+4915123456789");
  assertEquals(e164("+49 0151 23456789", true), "+4915123456789");
  assertEquals(e164("+420 601 123 456", true), "+420601123456");
  for (const s of ["+380441234567", "+49 30 1234567", "+1 202 555 0100", "+44 7700 900123", "+7 912 345 67 89", "+420 222 123 456", "0019005550100"]) assert(!numer(s, true).ok, s);
});
Deno.test("pierwszyNumer: a sheet cell with several numbers or notes", () => {
  const p = (c: string) => { const n = pierwszyNumer(c); return n.ok ? n.e164 : "BŁĄD"; };
  assertEquals(p("600 100 200"), "+48600100200");
  assertEquals(p("22 123 45 67, 600 100 200"), "+48600100200");
  assertEquals(p("tel. 600-100-200 (Jan)"), "+48600100200");
  assertEquals(p("61 600 00 00; kom. +48 501 100 200"), "+48501100200");
  assertEquals(p("600100200 / 601100200"), "+48600100200");
  assertEquals(p("22 123 45 67"), "BŁĄD");
  assertEquals(p(""), "BŁĄD");
  assertEquals(maska("+48600100200"), "+48****** 200");
});

Deno.test("analiza: GSM-7 parts", () => {
  assertEquals(analiza("").czesci, 0);
  const a = (n: number) => analiza("a".repeat(n));
  assertEquals([a(1).czesci, a(160).czesci, a(161).czesci, a(306).czesci, a(307).czesci, a(459).czesci, a(460).czesci], [1, 1, 2, 2, 3, 3, 4]);
  assertEquals(a(160).kodowanie, "GSM-7");
  assertEquals(a(160).do_konca, 0);
  assertEquals(a(161).do_konca, 306 - 161);
  assertEquals(a(1530).czesci, 10); assert(!a(1530).za_dluga); assert(a(1531).za_dluga);
  // characters of the basic alphabet that look special
  assertEquals(analiza("@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà\n").kodowanie, "GSM-7");
});
Deno.test("analiza: extended characters count double", () => {
  assertEquals(analiza("€").znaki, 2);
  assertEquals(analiza("[]{}^~|\\€").znaki, 18);
  assertEquals(analiza("a".repeat(158) + "€").czesci, 1);
  assertEquals(analiza("a".repeat(159) + "€").czesci, 2);
  assertEquals(analiza("a".repeat(159) + "€").kodowanie, "GSM-7");
});
Deno.test("analiza: UCS-2 parts", () => {
  const a = (n: number) => analiza("ą".repeat(n));
  assertEquals([a(1).czesci, a(70).czesci, a(71).czesci, a(134).czesci, a(135).czesci, a(201).czesci, a(202).czesci], [1, 1, 2, 2, 3, 3, 4]);
  assertEquals(a(1).kodowanie, "UCS-2");
  assertEquals(analiza("a".repeat(69) + "ż").czesci, 1);
  assertEquals(analiza("a".repeat(70) + "ż").czesci, 2);
  assertEquals(analiza("Привіт").kodowanie, "UCS-2");
  assertEquals(analiza("ok 👍").znaki, 5); // an emoji is two UTF-16 units
  assertEquals(analiza("zażółć").inne_znaki.sort(), ["ć", "ó", "ż", "ł"].sort());
  assertEquals(a(670).czesci, 10); assert(a(671).za_dluga);
});
Deno.test("bezPolskich / przygotuj", () => {
  assertEquals(bezPolskich("Zażółć gęślą jaźń — „ŁÓDŹ”… 5 zł"), 'Zazolc gesla jazn - "LODZ"... 5 zl');
  assertEquals(analiza(bezPolskich("Zażółć gęślą jaźń — „ŁÓDŹ”…")).kodowanie, "GSM-7");
  const p = przygotuj("  Dzień dobry,\r\n\r\n\r\n\r\nprosimy   o kontakt.  ", true);
  assertEquals(p.tresc, "TD Consulting Group: Dzien dobry,\n\nprosimy o kontakt.");
  assert(p.podpis_dodany && p.polskie && p.usuniete);
  const q = przygotuj("TD Consulting Group: umowa czeka", true);
  assert(!q.podpis_dodany && !q.polskie && !q.usuniete);
  assertEquals(przygotuj("Żółw", false).tresc, "TD Consulting Group: Żółw");
  assertEquals(przygotuj("", true).tresc, "");
  // Cyrillic stays as it is and is counted as UCS-2
  assertEquals(analiza(przygotuj("Добрий день", true).tresc).kodowanie, "UCS-2");
});

Deno.test("quiet hours follow Warsaw time, summer and winter", () => {
  const g = { od: "08:00", do: "20:00" };
  assert(!wGodzinach(new Date("2026-10-09T05:10:00Z"), g)); // 07:10 — the morning cron run
  assert(wGodzinach(new Date("2026-10-09T06:00:00Z"), g));  // 08:00
  assert(wGodzinach(new Date("2026-10-09T17:59:00Z"), g));  // 19:59
  assert(!wGodzinach(new Date("2026-10-09T18:00:00Z"), g)); // 20:00
  assert(!wGodzinach(new Date("2026-12-09T06:30:00Z"), g)); // 07:30 in winter
  assert(wGodzinach(new Date("2026-12-09T07:00:00Z"), g));  // 08:00 in winter
  assert(!wGodzinach(new Date("2026-12-09T23:30:00Z"), g));
  assertEquals(poczatekDnia(new Date("2026-10-09T10:00:00Z")), "2026-10-08T22:00:00.000Z");
  assertEquals(poczatekDnia(new Date("2026-12-09T10:00:00Z")), "2026-12-08T23:00:00.000Z");
  assertEquals(poczatekDnia(new Date("2026-10-08T22:30:00Z")), "2026-10-08T22:00:00.000Z"); // already the 9th in Warsaw
});

Deno.test("settings: defaults and reading of stored values", () => {
  const d = czytajUst(null);
  assertEquals(d, { ...DOMYSLNE, by: undefined, updated_at: undefined });
  assert(!d.wlaczone && !d.automaty.terminy && !d.raporty && d.nadawca === "Tw.Ksiegowa");
  const z = czytajUst({ wlaczone: "true", nadawca: "2WAY", limit_dzienny: 1e9, limit_na_numer_dziennie: 0, godziny: { od: "22:00", do: "06:00" }, automaty: { terminy: 1 }, normalizuj: 0 });
  assert(!z.wlaczone && z.nadawca === "Tw.Ksiegowa" && z.limit_dzienny === 100 && z.limit_na_numer_dziennie === 3 && !z.automaty.terminy && z.godziny.od === "08:00");
  assertEquals(czytajUst({ nadawca: "" }).nadawca, "");
});
Deno.test("settings: validation of what an administrator saves", () => {
  const ok = { wlaczone: true, nadawca: "Tw.Ksiegowa", limit_dzienny: 50, limit_na_numer_dziennie: 2, godziny: { od: "08:00", do: "18:00" }, automaty: { terminy: true }, normalizuj: true, zagranica: false, raporty: false };
  const o: { skonfigurowane: boolean; nadawcy: string[] | null } = { skonfigurowane: true, nadawcy: ["Tw.Ksiegowa"] };
  const s = sprawdzUst(ok, o);
  assert(s.ok && s.ust.wlaczone && s.ust.automaty.terminy);
  const zle = (zm: Record<string, unknown>, oo = o) => { const r = sprawdzUst({ ...ok, ...zm }, oo); assert(!r.ok, JSON.stringify(zm)); return r.error; };
  zle({ wlaczone: "tak" }); zle({ normalizuj: null }); zle({ automaty: {} }); zle({ automaty: { terminy: "x" } });
  zle({ nadawca: "Zażółć" }); zle({ nadawca: "ZaDlugaNazwa12" }); zle({ nadawca: "<script>" }); zle({ nadawca: "Inna" });
  assert(/2WAY/.test(zle({ nadawca: "2WAY" }, { skonfigurowane: true, nadawcy: ["2WAY", "Tw.Ksiegowa"] })));
  zle({ limit_dzienny: 0 }); zle({ limit_dzienny: 2001 }); zle({ limit_dzienny: 10.5 }); zle({ limit_dzienny: "50" });
  zle({ limit_na_numer_dziennie: 0 }); zle({ limit_na_numer_dziennie: 21 }); zle({ limit_na_numer_dziennie: 60, limit_dzienny: 50 });
  zle({ godziny: { od: "18:00", do: "08:00" } }); zle({ godziny: { od: "8:00", do: "18:00" } }); zle({ godziny: { od: "05:00", do: "18:00" } }); zle({ godziny: { od: "08:00", do: "23:00" } }); zle({ godziny: null });
  assert(/token/i.test(zle({}, { skonfigurowane: false, nadawcy: null })));
  zle({ nadawca: "" });                                         // on, but no sender
  zle({}, { skonfigurowane: true, nadawcy: null }); // on, but the names could not be checked
  zle({ wlaczone: false });                                     // reminders by SMS without sending switched on
  assert(sprawdzUst({ ...ok, wlaczone: false, automaty: { terminy: false } }, { skonfigurowane: false, nadawcy: null }).ok);
  for (const v of [null, [], "x", 5]) assert(!sprawdzUst(v, o).ok);
});

Deno.test("templates: signed, short, no link, minimal personal data", () => {
  for (const s of SZABLONY) {
    assert(s.tresc.startsWith("TD Consulting Group"), s.id);
    assert(!/https?:|www\./.test(s.tresc), s.id);
  }
  const t = wypelnij("termin", { dokument: "karta pobytu", inicjaly: inicjaly("Jan Maria Wzorcowy-Testowy"), data: "14.10.2026" })!;
  assert(t.includes("pracownika J.W.") && !t.includes("Wzorcowy"));
  const a = analiza(przygotuj(t, true).tresc);
  assertEquals([a.kodowanie, a.czesci], ["GSM-7", 1]);
  assertEquals(analiza(przygotuj(wypelnij("termin_zbiorczy", { liczba: 12, data: "14.10.2026" })!, true).tresc).czesci, 1);
  assertEquals(analiza(przygotuj(wypelnij("podpis", {})!, true).tresc).czesci, 1);
  assertEquals(wypelnij("ogolny", { tresc: "x{y}" }), "TD Consulting Group: xy");
  assertEquals(wypelnij("nie_ma", {}), null);
  assertEquals([inicjaly("anna wzorcowa"), inicjaly("Ołena"), inicjaly(""), inicjaly("  Żaneta  de  Łęcka ")], ["A.W.", "O.", "", "Ż.Ł."]);
});

Deno.test("provider answers", () => {
  assertEquals(czytajOdpowiedz(200, { count: 1, list: [{ id: "146096", points: 0.16, number: "48600100200", status: "QUEUE", parts: 2, error: null }] }), { ok: true, id: "146096", koszt: 0.16, czesci: 2, status: "QUEUE" });
  assertEquals(czytajOdpowiedz(200, { count: 1, list: [{ id: "", points: "0", status: "QUEUE" }] }), { ok: true, id: null, koszt: 0, czesci: null, status: "QUEUE" });
  const e = czytajOdpowiedz(200, { error: 13, message: "No correct phone numbers", invalid_numbers: [{ number: "48221234567" }] });
  assert(!e.ok && e.kod === 13 && !/48221234567/.test(e.opis));
  const e2 = czytajOdpowiedz(200, { error: 101, message: "secret echoed?" });
  assert(!e2.ok && e2.kod === 101 && !/secret/.test(e2.opis));
  const e3 = czytajOdpowiedz(401, { message: "Authorization failed", error: "authorization_failed" });
  assert(!e3.ok && e3.kod === 101);
  const e4 = czytajOdpowiedz(0, null);
  assert(!e4.ok && e4.kod === null);
  assert(!czytajOdpowiedz(200, { error: 4242 }).ok);
  assertEquals(statusDoreczenia("404"), { status: "dostarczony", nazwa: "DELIVERED" });
  assertEquals(statusDoreczenia(403), { status: null, nazwa: "SENT" });
  assertEquals(statusDoreczenia(405).status, "blad");
  assertEquals(statusDoreczenia("xyz"), { status: null, nazwa: "" });
});
