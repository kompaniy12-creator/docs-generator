// deno test --allow-env supabase/functions/gus-company/jdg_test.ts
// _shared/jdg.ts (mapping of CEIDG / GUS / MF answers and the chain of sources) and the lookups' cache in
// dane.ts, with a stand-in for fetch: nothing leaves the machine. Fictional people and firms only.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
type Any = any;
Deno.env.set("SUPABASE_URL", "http://db.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.delete("CEIDG_TOKEN"); Deno.env.delete("DATAPORT_API_KEY");

const { adresCeidg, BladJdg, doZapisu, dzisPl, mapujCeidg, mapujGus, mapujMf, pobierzJdg, wybierzWpis } = await import("../_shared/jdg.ts");
const { gusFirma, jdgFirma, parseAdres } = await import("./dane.ts");

function nip(base: string): string {
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  return base + (w.reduce((a, x, i) => a + x * Number(base[i]), 0) % 11);
}
const N = nip("999000013"), TOKEN = "tajny-token-testowy", KLUCZ = "tajny-klucz-testowy";
const J = (b: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

// CEIDG: GET /firma?nip= as in "Dokumentacja dla integratorów API v3" v1.4 (schema FirmaCeidg), with fictional data
const WPIS = {
  id: "00000000-0000-0000-0000-000000000001", nazwa: "Usługi Przykładowe Jan Przykładowy",
  adresDzialalnosci: { ulica: "ul. Przykładowa", budynek: "1", lokal: "2", miasto: "Warszawa", wojewodztwo: "MAZOWIECKIE", powiat: "Warszawa", gmina: "Warszawa", kraj: "PL", kod: "00-000", terc: "0000000", simc: "0000000", ulic: "00000" },
  adresKorespondencyjny: { ulica: "ul. Wzorcowa", budynek: "5", miasto: "Warszawa", kraj: "PL", kod: "00-001" },
  wlasciciel: { imie: "Jan", nazwisko: "Przykładowy", nip: N, regon: "999000013" },
  obywatelstwa: [{ symbol: "PL", kraj: "Polska" }],
  pkd: [{ kod: "6920Z", nazwa: "Działalność rachunkowo-księgowa; doradztwo podatkowe" }, { kod: "7022Z", nazwa: "Pozostałe doradztwo w zakresie prowadzenia działalności gospodarczej i zarządzania" }],
  pkdGlowny: { kod: "6920Z", nazwa: "Działalność rachunkowo-księgowa; doradztwo podatkowe" },
  dataRozpoczecia: "2020-02-03", dataZawieszenia: "2026-01-01", status: "ZAWIESZONY", numerStatusu: 3,
  telefon: "600000000", email: "jan@example.test", www: "www.example.test", wspolnoscMajatkowa: 1, link: "https://dane.biznes.gov.pl/api/ceidg/v3/firma/00000000-0000-0000-0000-000000000001",
};
const MF_OK = { result: { subject: { name: "JAN PRZYKŁADOWY", nip: N, statusVat: "Czynny", regon: "999000013", pesel: "00000000000", krs: null, residenceAddress: null, workingAddress: "PRZYKŁADOWA 1/2, 00-000 WARSZAWA",
  representatives: [], authorizedClerks: [], partners: [], registrationLegalDate: "2020-02-03", removalDate: null, accountNumbers: ["00999900000000000000000000"], hasVirtualAccounts: false }, requestId: "t-1", requestDateTime: "09-10-2026 10:00:00" } };
const GUS_OK = { success: true, nazwa: "USŁUGI PRZYKŁADOWE JAN PRZYKŁADOWY", regon: "999000013", nip: N, adres: "ul. Przykładowa 1 /2 00-000 Warszawa", data_rozpoczecia: "2020-02-03", pkd_glowne: { kod: "6920Z", nazwa: "Działalność rachunkowo-księgowa" } };

Deno.test("mapujCeidg: firma, właściciel, adresy, PKD, daty i stan — bez telefonu, e-maila i obywatelstwa", () => {
  const j = mapujCeidg({ firma: [WPIS] }, N);
  assertEquals([j.znaleziono, j.zrodlo, j.nazwa, j.imie, j.nazwisko, j.regon, j.forma], [true, "ceidg", "Usługi Przykładowe Jan Przykładowy", "Jan", "Przykładowy", "999000013", "jednoosobowa działalność gospodarcza"]);
  assertEquals([j.adres, j.adres_doreczen], ["ul. Przykładowa 1/2, 00-000 Warszawa", "ul. Wzorcowa 5, 00-001 Warszawa"]);
  assertEquals([j.data_rozpoczecia, j.status, j.data_zawieszenia, j.data_wznowienia, j.data_zakonczenia, j.data_wykreslenia], ["2020-02-03", "zawieszona", "2026-01-01", null, null, null]);
  assertEquals([j.pkd_glowne, j.pkd.length, j.pkd[1].kod, j.podstawowe], ["6920Z Działalność rachunkowo-księgowa; doradztwo podatkowe", 2, "7022Z", false]);
  assert(!/600000000|example\.test|obywatelstw|wspolnosc|Polska/.test(JSON.stringify(j)));
  // the same address for service is not repeated; a missing place of business falls back to it
  assertEquals(mapujCeidg({ firma: [{ ...WPIS, adresKorespondencyjny: WPIS.adresDzialalnosci }] }, N).adres_doreczen, null);
  const bez = mapujCeidg({ firma: [{ ...WPIS, adresDzialalnosci: undefined }] }, N);
  assertEquals([bez.adres, bez.adres_doreczen], ["ul. Wzorcowa 5, 00-001 Warszawa", null]);
  assertEquals(adresCeidg({ budynek: "12", miasto: "Przykładowo", kod: "00-002" }), "Przykładowo 12, 00-002 Przykładowo");
  assertEquals(mapujCeidg({ firma: [] }, N).znaleziono, false); assertEquals(mapujCeidg(null, N).znaleziono, false);
  assertEquals(mapujCeidg({ firma: [{ ...WPIS, status: "WYKRESLONY", dataWykreslenia: "2026-03-01" }] }, N).status, "wykreślona");
});

Deno.test("wybierzWpis: kilka wpisów pod jednym NIP — żyjący przed wykreślonym, potem najnowszy", () => {
  const stary = { ...WPIS, id: "a", status: "WYKRESLONY", dataRozpoczecia: "2010-01-01" }, nowy = { ...WPIS, id: "b", status: "AKTYWNY", dataRozpoczecia: "2024-05-06" };
  assertEquals(wybierzWpis([stary, nowy]).id, "b"); assertEquals(wybierzWpis([nowy, stary]).id, "b");
  assertEquals(wybierzWpis([stary, { ...stary, id: "c", dataRozpoczecia: "2015-01-01" }]).id, "c");
  assertEquals(wybierzWpis([]), null);
});

Deno.test("mapujMf: tylko dane podstawowe; PESEL, rachunki i osoby nie są przepisywane; brak w wykazie to osobny wynik", () => {
  const j = mapujMf(MF_OK.result.subject, N);
  assertEquals([j.znaleziono, j.zrodlo, j.podstawowe, j.nazwa, j.regon, j.adres, j.status, j.status_vat, j.vat_od, j.data_rozpoczecia, j.imie], [true, "mf", true, "JAN PRZYKŁADOWY", "999000013", "PRZYKŁADOWA 1/2, 00-000 WARSZAWA", null, "Czynny", "2020-02-03", null, null]);
  assert(!/pesel|00000000000|0099990000/i.test(JSON.stringify(j)));
  const brak = mapujMf(null, N);
  assertEquals([brak.znaleziono, brak.zrodlo, brak.powod], [false, "mf", "brak w wykazie VAT"]);
  // an organisation: the seat is the only address
  assertEquals(mapujMf({ name: "PRZYKŁADOWA ALFA SP. Z O.O.", nip: N, residenceAddress: "WZORCOWA 3, 00-003 WARSZAWA", workingAddress: null }, N).adres, "WZORCOWA 3, 00-003 WARSZAWA");
});

Deno.test("mapujGus: jak dotychczas — nazwa, REGON, adres, stan z dat", () => {
  const j = mapujGus(GUS_OK, N);
  assertEquals([j.znaleziono, j.zrodlo, j.nazwa, j.regon, j.adres, j.status, j.data_rozpoczecia, j.pkd_glowne], [true, "gus", "USŁUGI PRZYKŁADOWE JAN PRZYKŁADOWY", "999000013", "ul. Przykładowa 1/2 00-000 Warszawa", "aktywna", "2020-02-03", "6920Z Działalność rachunkowo-księgowa"]);
  assertEquals(mapujGus({ ...GUS_OK, data_zawieszenia: "2026-01-01" }, N).status, "zawieszona");
  assertEquals(mapujGus({ ...GUS_OK, data_zawieszenia: "2026-01-01", data_wznowienia: "2026-06-01" }, N).status, "aktywna");
  assertEquals(mapujGus({ ...GUS_OK, data_zakonczenia: "2026-02-01" }, N).status, "wykreślona");
  assertEquals(mapujGus({ success: false }, N).znaleziono, false);
});

// a stand-in for the three sources
type Odp = () => Response | Promise<Response>;
function zrodla(o: { ceidg?: Odp; gus?: Odp; mf?: Odp }) {
  const calls: string[] = [];
  const f = ((u: Any, init: Any = {}) => {
    const url = String(u), h = new Headers(init.headers ?? {});
    assert(init.signal instanceof AbortSignal, "zapytanie bez limitu czasu");
    if (url.startsWith("https://dane.biznes.gov.pl/api/ceidg/v3/firma?nip=" + N)) { calls.push("ceidg"); assertEquals(h.get("Authorization"), "Bearer " + TOKEN); return Promise.resolve(o.ceidg!()); }
    if (url === "https://dataport.pl/api/v1/company/" + N) { calls.push("gus"); assertEquals(h.get("X-API-Key"), KLUCZ); return Promise.resolve(o.gus!()); }
    if (url === "https://wl-api.mf.gov.pl/api/search/nip/" + N + "?date=2026-10-09") { calls.push("mf"); assertEquals(h.get("Authorization"), null); assertEquals(h.get("X-API-Key"), null); return Promise.resolve(o.mf!()); }
    throw new Error("nieoczekiwane zapytanie: " + url);
  }) as typeof fetch;
  return { f, calls };
}
const O = (f: typeof fetch, x: Any = {}) => ({ fetch: f, ceidgToken: TOKEN, dataportKey: KLUCZ, dzis: "2026-10-09", ...x });

Deno.test("łańcuch: pierwsze źródło, które zna firmę, wygrywa — kolejne nie są pytane", async () => {
  const { f, calls } = zrodla({ ceidg: () => J({ firma: [WPIS] }) });
  const j = await pobierzJdg(N, O(f));
  assertEquals([j.zrodlo, j.znaleziono, j.proby], ["ceidg", true, [{ zrodlo: "ceidg", wynik: "ok" }]]); assertEquals(calls, ["ceidg"]);
  // without keys only MF is asked
  const m = zrodla({ mf: () => J(MF_OK) });
  const k = await pobierzJdg(N, O(m.f, { ceidgToken: "", dataportKey: "" }));
  assertEquals([k.zrodlo, k.podstawowe], ["mf", true]); assertEquals(m.calls, ["mf"]);
});

Deno.test("łańcuch: błąd źródła przechodzi do następnego i jest wypisany w próbach; sekrety nie trafiają do tekstów", async () => {
  const { f, calls } = zrodla({ ceidg: () => J({ message: "Unauthorized " + TOKEN, http_status_code: 401 }, 401), gus: () => J({ success: false, message: "Klucz API jest nieaktywny" }), mf: () => J(MF_OK) });
  const j = await pobierzJdg(N, O(f));
  assertEquals(calls, ["ceidg", "gus", "mf"]);
  assertEquals([j.zrodlo, j.znaleziono, j.podstawowe], ["mf", true, true]);
  assertEquals(j.proby.map((p) => p.zrodlo + ":" + p.wynik.split(" ")[0]), ["ceidg:błąd:", "gus:błąd:", "mf:ok"]);
  assert(j.proby[0].wynik.includes("401")); assert(j.proby[1].wynik.includes("nieaktywny"));
  assert(!JSON.stringify(j).includes(TOKEN) && !JSON.stringify(j).includes(KLUCZ));
  assertEquals("proby" in doZapisu(j), false);
});

Deno.test("łańcuch: wszystkie źródła zawiodły -> błąd dostawcy, nigdy „nie znaleziono”", async () => {
  const brakSieci: Odp = () => Promise.reject(new TypeError("error sending request for url (https://dane.biznes.gov.pl/…?token=" + TOKEN + ")"));
  const czas: Odp = () => Promise.reject(new DOMException("The operation timed out", "TimeoutError"));
  const { f, calls } = zrodla({ ceidg: brakSieci, gus: czas, mf: () => new Response("<html>blokada</html>", { status: 403 }) });
  const e = await assertRejects(() => pobierzJdg(N, O(f)), BladJdg);
  assertEquals(calls, ["ceidg", "gus", "mf"]); assertEquals(e.limit, false);
  assertEquals(e.message, "CEIDG: brak połączenia; GUS (DataPort): brak odpowiedzi w ciągu 8 s; Wykaz VAT (MF): HTTP 403");
  assert(!e.message.includes(TOKEN) && !JSON.stringify(e.proby).includes(TOKEN));
  // unknown shapes are errors too
  for (const zle of [() => J({}), () => J({ firma: "x" }), () => J({ result: {} })]) {
    const z = zrodla({ ceidg: zle, gus: () => J({}), mf: zle });
    await assertRejects(() => pobierzJdg(N, O(z.f)), BladJdg);
  }
  await assertRejects(() => pobierzJdg("123", O(f)), BladJdg);
  await assertRejects(() => pobierzJdg(N, O(f, { ceidgToken: "", dataportKey: "", bezMf: true })), BladJdg, "brak skonfigurowanego źródła");
});

Deno.test("łańcuch: „nie ma” — CEIDG 204 pyta dalej; sam MF = „brak w wykazie VAT”; REGON nie zna = koniec", async () => {
  const a = zrodla({ ceidg: () => J(null, 204), gus: () => J({ success: false, message: "Błąd serwera" }, 500), mf: () => J(MF_OK) });
  assertEquals((await pobierzJdg(N, O(a.f))).zrodlo, "mf"); assertEquals(a.calls, ["ceidg", "gus", "mf"]);
  const b = zrodla({ mf: () => J({ result: { subject: null, requestId: "t-2" } }) });
  const jb = await pobierzJdg(N, O(b.f, { ceidgToken: "", dataportKey: "" }));
  assertEquals([jb.znaleziono, jb.zrodlo, jb.powod, jb.podstawowe], [false, "mf", "brak w wykazie VAT", true]);
  const c = zrodla({ ceidg: () => J({ firma: [] }), mf: () => J({ result: { subject: null } }) });
  const jc = await pobierzJdg(N, O(c.f, { dataportKey: "" }));
  assertEquals([jc.znaleziono, jc.zrodlo, jc.powod], [false, "ceidg", "brak w CEIDG i w wykazie VAT"]);
  const d = zrodla({ gus: () => J({ success: false, message: "Nie znaleziono podmiotu" }, 404) });
  const jd = await pobierzJdg(N, O(d.f, { ceidgToken: "" }));
  assertEquals([jd.znaleziono, jd.zrodlo, jd.powod], [false, "gus", "brak w rejestrze REGON"]); assertEquals(d.calls, ["gus"]);
  // CEIDG does not know it and nobody else answers: still "not in CEIDG", with the failures listed
  const e = zrodla({ ceidg: () => J(null, 204), gus: () => J({}, 503), mf: () => J({}, 503) });
  const je = await pobierzJdg(N, O(e.f));
  assertEquals([je.znaleziono, je.powod, je.proby.length], [false, "brak w CEIDG", 3]);
});

Deno.test("łańcuch: dzienny udział w limicie MF — bez zapytania, „dokończ jutro”; bezMf nie pyta MF wcale", async () => {
  const a = zrodla({ gus: () => J({ success: false, message: "Klucz API jest nieaktywny" }) });
  let pytano = 0;
  const e = await assertRejects(() => pobierzJdg(N, O(a.f, { ceidgToken: "", mfWolno: () => { pytano++; return Promise.resolve(false); } })), BladJdg);
  assertEquals([e.limit, pytano], [true, 1]); assertEquals(a.calls, ["gus"]); assert(e.message.includes("dzienny limit"));
  const b = zrodla({});
  const e2 = await assertRejects(() => pobierzJdg(N, O(b.f, { ceidgToken: "", dataportKey: "", mfWolno: () => Promise.resolve(false) })), BladJdg, "dokończ jutro");
  assertEquals(e2.limit, true); assertEquals(b.calls, []);
  const c = zrodla({ ceidg: () => J({}, 500) });
  await assertRejects(() => pobierzJdg(N, O(c.f, { dataportKey: "", bezMf: true })), BladJdg, "CEIDG: HTTP 500"); assertEquals(c.calls, ["ceidg"]);
  // MF's own 429
  const d = zrodla({ mf: () => J({ code: "WL-195", message: "limit" }, 429) });
  await assertRejects(() => pobierzJdg(N, O(d.f, { ceidgToken: "", dataportKey: "" })), BladJdg, "limit zapytań MF");
});

Deno.test("dzisPl i parseAdres (adres z przecinkiem przed kodem)", () => {
  assertEquals(dzisPl(new Date("2026-10-09T22:30:00Z")), "2026-10-10"); assertEquals(dzisPl(new Date("2026-10-09T10:00:00Z")), "2026-10-09");
  assertEquals(parseAdres("PRZYKŁADOWA 1/2, 00-000 WARSZAWA"), { ulica: "PRZYKŁADOWA 1/2", kod: "00-000", miasto: "WARSZAWA" });
  assertEquals(parseAdres("ul. Przykładowa 1 /2 00-000 Warszawa"), { ulica: "ul. Przykładowa 1/2", kod: "00-000", miasto: "Warszawa" });
});

// ---------------------------------------------------------------- dane.ts: cache and caps around the chain
Deno.test("jdgFirma / gusFirma: pamięć odpowiedzi, limity, MF po odmowie GUS, stary wiersz pamięci", async () => {
  const cache: Record<string, Any> = {}, limity: Record<string, number> = {};
  let mf = 0, gus = 0;
  const orig = globalThis.fetch;
  Deno.env.set("DATAPORT_API_KEY", KLUCZ);
  globalThis.fetch = ((u: Any, init: Any = {}) => {
    const url = String(u);
    if (url.startsWith("http://db.test/rest/v1/portal_gus_cache?nip=eq.")) { const r = cache[url.split("eq.")[1].slice(0, 10)]; return Promise.resolve(J(r ? [r] : [])); }
    if (url === "http://db.test/rest/v1/portal_gus_cache") { const b = JSON.parse(init.body); cache[b.nip] = b; return Promise.resolve(new Response(null, { status: 201 })); }
    if (url === "http://db.test/rest/v1/rpc/klienci_limit") { const b = JSON.parse(init.body), n = (limity[b.p_klucz] ?? 0) + 1; if (n > b.p_max) return Promise.resolve(J(false)); limity[b.p_klucz] = n; return Promise.resolve(J(true)); }
    if (url.startsWith("https://dataport.pl/")) { gus++; return Promise.resolve(J({ success: false, message: "Klucz API jest nieaktywny" })); }
    if (url.startsWith("https://wl-api.mf.gov.pl/")) { mf++; return Promise.resolve(J(MF_OK)); }
    throw new Error("nieoczekiwane zapytanie: " + url);
  }) as typeof fetch;
  try {
    const w = await gusFirma(N, "ip1");
    assertEquals(w.stan, "ok"); assertEquals(w.stan === "ok" && [w.dane.nazwa, w.dane.regon, w.dane.adres, w.zrodlo], ["JAN PRZYKŁADOWY", "999000013", "PRZYKŁADOWA 1/2, 00-000 WARSZAWA", "mf"]);
    assertEquals([gus, mf, limity["mf-search"], limity["gus-ip:ip1"]], [1, 1, 1, 1]);
    assert(!/pesel|0099990000|proby/i.test(JSON.stringify(cache))); assertEquals(cache[N].dane.zrodlo, "mf");
    // a fuller source is configured: MF's record is good for a day, then the sources are asked again
    await jdgFirma(N, null); assertEquals([gus, mf], [1, 1]);
    cache[N].fetched_at = new Date(Date.now() - 2 * 86400000).toISOString();
    const drugi = await jdgFirma(N, null); assertEquals([gus, mf, drugi.stan === "ok" && drugi.z_pamieci], [2, 2, false]);
    // MF's share of the day used up, GUS refusing: "limit", nothing is cached as missing
    limity["mf-search"] = 80; cache[N].fetched_at = new Date(Date.now() - 2 * 86400000).toISOString();
    assertEquals((await jdgFirma(N, null)).stan, "limit"); assertEquals(mf, 2); assertEquals(cache[N].znaleziono, true);
    // a row written before the sources were joined: { nazwa, regon, adres } only
    const N2 = nip("999000024");
    cache[N2] = { nip: N2, znaleziono: true, dane: { nazwa: "HANDEL PRZYKŁADOWY EWA TESTOWA", regon: "999000024", adres: "ul. Wzorcowa 2 00-001 Warszawa" }, fetched_at: new Date().toISOString() };
    const stary = await jdgFirma(N2, null);
    assertEquals(stary.stan === "ok" && [stary.dane.zrodlo, stary.dane.nazwa, stary.dane.imie, stary.z_pamieci], ["gus", "HANDEL PRZYKŁADOWY EWA TESTOWA", null, true]);
    assertEquals((await gusFirma("1234567890", null)).stan, "brak");
  } finally { globalThis.fetch = orig; Deno.env.delete("DATAPORT_API_KEY"); }
});
