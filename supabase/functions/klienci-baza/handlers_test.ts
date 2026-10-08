// deno test --allow-env --allow-net supabase/functions/klienci-baza/handlers_test.ts
// The function's handlers run locally: Deno.serve is captured and every outgoing request (auth, database,
// storage, rejestr.io, GUS, the model) is answered by an in-memory stand-in. Nothing leaves the machine.
// Fictional firms and people only.
import { assert, assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
type Any = any;
function nip(base: string): string {
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  return base + (w.reduce((a, x, i) => a + x * Number(base[i]), 0) % 11);
}
const N1 = nip("999000001"), N2 = nip("999000002"), N3 = nip("999000013");
const BIURO = "7831916366";

Deno.env.set("SUPABASE_URL", "http://db.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("ANTHROPIC_API_KEY", "k");
Deno.env.set("REJESTR_IO_KEY", "k");
Deno.env.set("DATAPORT_API_KEY", "k");

const USERS: Record<string, Any> = {
  admin: { email: "admin@example.test", app_metadata: { portal: true, portal_admin: true } },
  kadry: { email: "kadry@example.test", app_metadata: { portal: true, portal_sections: ["kadry"] } },
  ksieg: { email: "ksieg@example.test", app_metadata: { portal: true, portal_sections: ["onboarding"] } },
  obcy: { email: "obcy@example.test", app_metadata: {} },
};
const now = () => new Date().toISOString();
const T: Record<string, Any[]> = {};
const PK: Record<string, string> = { portal_klienci: "id", klienci_baza: "id", portal_firmy_cache: "nip", portal_odpisy_cache: "krs", klienci_rejestr: "id", klienci_umowy: "id", klienci_status_historia: "id" };
const FILES: Record<string, Uint8Array> = {};
const calls = { rio: [] as string[], gus: 0, model: 0 };
let zarzad = [{ imie: "ANNA", nazwisko: "WZORCOWA" }];
let modelOut: Any = {};

function reset() {
  const dane = (nazwa: string, n: string, forma: string, poz: number) => ({ nazwa, nip: n, forma, adres: "ul. Przykładowa 1, 00-000 Warszawa", opodatkowanie: "", telefon: "+48 600 000 000", email: "biuro@example.test", kontakt: "Osoba Testowa", miasto: "Warszawa", opiekun: "Księgowa Testowa", kadrowy: "", telegram: "", jezyk: "pl", poz });
  T.portal_klienci = [
    { id: N1, nip: N1, dane: dane("Przykładowa Alfa sp. z o.o.", N1, "spółka z o.o.", 0), synced_at: now() },
    { id: N2, nip: N2, dane: dane("Przykładowa Beta sp. z o.o.", N2, "spółka z o.o.", 1), synced_at: now() },
    { id: N3, nip: N3, dane: dane("Usługi Testowe Jan Wzorcowy", N3, "JDG", 2), synced_at: now() },
    { id: "nazwa:przykładowa gamma", nip: "", dane: dane("Przykładowa Gamma", "", "JDG", 3), synced_at: now() },
  ];
  T.klienci_baza = []; T.klienci_rejestr = []; T.klienci_umowy = []; T.klienci_status_historia = []; T.portal_firmy_cache = []; T.portal_odpisy_cache = [];
  for (const k of Object.keys(FILES)) delete FILES[k];
  calls.rio = []; calls.gus = 0; calls.model = 0; zarzad = [{ imie: "ANNA", nazwisko: "WZORCOWA" }];
}

function test1(row: Any, col: string, expr: string): boolean {
  const v = col.includes("->>") ? row[col.split("->>")[0]]?.[col.split("->>")[1]] : row[col];
  const neg = expr.startsWith("not."); if (neg) expr = expr.slice(4);
  const [op, ...rest] = expr.split("."); const arg = decodeURIComponent(rest.join("."));
  const r = op === "eq" ? String(v) === arg : op === "is" ? (arg === "null" ? v == null : String(v) === arg) : op === "lt" ? v != null && String(v) < arg : false;
  return neg ? !r : r;
}
function query(path: string): { table: string; rows: Any[]; params: URLSearchParams } {
  const [table, qs = ""] = path.split("?");
  const params = new URLSearchParams(qs);
  let rows = T[table] ?? [];
  for (const [k, v] of params) {
    if (["select", "order", "limit"].includes(k)) continue;
    if (k === "or") { const parts = v.slice(1, -1).split(","); rows = rows.filter((r) => parts.some((p) => { const [c, ...e] = p.split("."); return test1(r, c, e.join(".")); })); }
    else rows = rows.filter((r) => test1(r, k, v));
  }
  const ord = params.get("order");
  if (ord) { const [c, d] = ord.split("."); rows = [...rows].sort((a, b) => String(a[c] ?? "").localeCompare(String(b[c] ?? "")) * (d === "desc" ? -1 : 1)); }
  if (params.get("limit")) rows = rows.slice(0, Number(params.get("limit")));
  return { table, rows, params };
}
const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: Any, init: Any = {}) => {
  const url = String(input instanceof Request ? input.url : input), method = init.method ?? "GET";
  const h = new Headers(init.headers ?? {});
  if (url.startsWith("http://db.test/auth/v1/user")) { const u = USERS[(h.get("Authorization") ?? "").replace("Bearer ", "")]; return u ? J(u) : J({}, 401); }
  if (url.startsWith("http://db.test/rest/v1/rpc/klienci_ustaw_status")) {
    assertEquals(h.get("apikey"), "service");
    const b = JSON.parse(init.body), k = T.klienci_baza.find((x) => x.id === b.p_id);
    if (!k) return J({ message: "nie ma takiego klienta" }, 400);
    Object.assign(k, { status: b.p_status, obsluga_od: b.p_obsluga_od ?? k.obsluga_od ?? null, koniec_od: b.p_status === "zakonczony" ? b.p_koniec_od : null, zmienil: b.p_kto, zmieniono_at: now() });
    T.klienci_status_historia.push({ id: crypto.randomUUID(), created_at: now(), klient: k.id, status: k.status, obsluga_od: k.obsluga_od, koniec_od: k.koniec_od, powod: b.p_powod || null, zmienil: b.p_kto });
    return J(k);
  }
  if (url.startsWith("http://db.test/rest/v1/")) {
    assertEquals(h.get("apikey"), "service");
    const { table, rows, params } = query(url.slice("http://db.test/rest/v1/".length));
    if (method === "GET") { const sel = params.get("select") ?? "*"; return J(sel === "*" || sel.includes(">") ? rows : rows.map((r) => Object.fromEntries(sel.split(",").map((c) => [c, r[c]])))); }
    if (method === "PATCH") { const b = JSON.parse(init.body); for (const r of rows) Object.assign(r, b); return new Response(null, { status: 204 }); }
    if (method === "DELETE") { T[table] = T[table].filter((r) => !rows.includes(r)); return new Response(null, { status: 204 }); }
    if (method === "POST") {
      const b = JSON.parse(init.body), pk = PK[table];
      for (const r of Array.isArray(b) ? b : [b]) {
        if (r[pk] == null) r[pk] = crypto.randomUUID();
        const old = T[table].find((x) => x[pk] === r[pk]);
        if (old) Object.assign(old, r);
        else T[table].push(table === "klienci_baza" ? { status: "obslugiwany", obsluga_od: null, koniec_od: null, rejestr_at: null, rejestr_blad: null, ...r } : r);
      }
      return new Response(null, { status: 201 });
    }
  }
  if (url.startsWith("http://db.test/storage/v1/object/klienci-umowy/")) {
    const f = FILES[decodeURIComponent(url.split("/klienci-umowy/")[1])];
    return f ? new Response(f as Any, { headers: { "content-length": String(f.length) } }) : J({}, 404);
  }
  if (url.startsWith("https://rejestr.io/api/v2/org/")) {
    const p = url.slice("https://rejestr.io/api/v2/org/".length); calls.rio.push(p);
    if (p.includes(N2)) return J({}, 404);
    if (p.endsWith("/krs-rozdzialy/ogolny")) return J({
      organ_reprezentacji: { _obiekty: { a: { nazwa_organu_reprezentacji_podmiotu: { _wartosc: "ZARZĄD" }, sposob_reprezentacji_podmiotu: { _wartosc: "KAŻDY CZŁONEK ZARZĄDU SAMODZIELNIE" },
        dane_osob: { _obiekty: Object.fromEntries(zarzad.map((z, i) => [i, { person: { _wartosc: z }, funkcja_w_organie: { _wartosc: { nazwa: "PREZES ZARZĄDU" } } }])) } } } },
      wysokosc_kapitalu_zakladowego: { _wartosc: { kwota: "5000.00" } },
    });
    return J({ numery: { nip: N1, regon: "999000001", krs: "0000999001" }, nazwy: { pelna: "PRZYKŁADOWA ALFA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" }, adres: { ulica: "ul. Przykładowa", nr_domu: "1", kod: "00-000", miejscowosc: "Warszawa" },
      stan: { forma_prawna: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", czy_wykreslona: false }, krs_wpisy: { pierwszy_data: "2019-03-04" } });
  }
  if (url.startsWith("https://dataport.pl/")) { calls.gus++; return url.endsWith(N3) ? J({ success: true, nazwa: "USŁUGI TESTOWE JAN WZORCOWY", regon: "999000013", nip: N3, adres: "ul. Przykładowa 1 /2 00-000 Warszawa" }) : J({ success: false }, 404); }
  if (url === "https://api.anthropic.com/v1/messages") {
    calls.model++;
    const b = JSON.parse(init.body);
    assertEquals(b.model, "claude-opus-4-8"); assertEquals(b.output_config.format.type, "json_schema"); assertEquals(b.output_config.format.schema.required[0], "analiza");
    return J({ content: [{ type: "text", text: JSON.stringify(modelOut) }] });
  }
  throw new Error("nieoczekiwane zapytanie: " + method + " " + url);
}) as typeof fetch;

let handler: (req: Request) => Promise<Response> = () => { throw new Error("brak"); };
(Deno as Any).serve = (h: Any) => { handler = h; return {} as Any; };
await import("./index.ts");

async function call(kto: string | null, body: Any, method = "POST"): Promise<{ status: number; b: Any }> {
  const r = await handler(new Request("http://fn.test/klienci-baza", { method, headers: { "Content-Type": "application/json", ...(kto ? { Authorization: "Bearer " + kto } : {}) }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }));
  return { status: r.status, b: await r.json().catch(() => null) };
}
const PDF = new TextEncoder().encode("%PDF-1.4 przykładowy plik testowy");
const ODCZYT = (x: Any = {}) => ({ analiza: "Umowa o usługi księgowe.", rodzaj: "ksiegowosc", podtyp: "", obejmuje: ["ksiegowosc", "powierzenie"], klient: { nazwa: "Przykładowa Alfa sp. z o.o.", nip: N1, krs: "0000999001", reprezentanci: [{ imie_nazwisko: "Anna Wzorcowa", funkcja: "prezes zarządu" }] },
  data_zawarcia: "2024-01-15", obowiazuje_od: "2024-02-01", obowiazuje_do: "", bezterminowa: true, okres_wypowiedzenia: "1 miesiąc", zakres: "Prowadzenie ksiąg rachunkowych.", wynagrodzenie: "", podpisy: "obie_strony", stron: 4, pewnosc: "wysoka", uwagi: "", ...x });
function skan(klient: string | null = null, path?: string) {
  const id = crypto.randomUUID(), p = path ?? id + "/umowa_testowa.pdf";
  T.klienci_umowy.push({ id, path: p, nazwa: "umowa testowa.pdf", rozmiar: PDF.length, mime: "application/pdf", status: "nowy", klient, created_at: now(), obejmuje: [], reprezentanci: [] });
  FILES[p] = PDF;
  return id;
}

Deno.test("dostęp: bez tokenu, bez flagi portal, zła metoda, zły JSON, nieznana akcja", async () => {
  reset();
  assertEquals((await call(null, { action: "lista" })).status, 403);
  assertEquals((await call("obcy", { action: "lista" })).status, 403);
  assertEquals((await call("nieznany", { action: "lista" })).status, 403);
  assertEquals((await call("admin", null, "GET")).status, 405);
  assertEquals((await call("admin", "{zle")).status, 400);
  assertEquals((await call("admin", { action: "usun_wszystko" })).status, 400);
  assertEquals(T.klienci_baza.length, 0);
});

Deno.test("lista: synchronizacja z arkusza; pracownik bez uprawnień administratora nie widzi umów, audytu ani historii", async () => {
  reset();
  const a = await call("admin", { action: "lista" });
  assertEquals(a.status, 200); assertEquals(a.b.klienci.length, 4); assertEquals(a.b.ja, { email: "admin@example.test", admin: true, kontakty: true });
  const alfa = a.b.klienci.find((k: Any) => k.id === N1);
  assertEquals(alfa.status, "obslugiwany"); assertEquals(alfa.audyt.wynik, "braki"); assertEquals(alfa.kontakt.email, "biuro@example.test"); assert(Array.isArray(a.b.umowy));
  assert(a.b.klienci.find((k: Any) => k.id === "nazwa:przykładowa gamma").ostrzezenia[0].includes("NIP"));

  const k = await call("ksieg", { action: "lista" });
  assertEquals(k.b.ja, { email: "ksieg@example.test", admin: false, kontakty: false });
  assertEquals(k.b.umowy, undefined);
  for (const x of k.b.klienci) { assertEquals(x.audyt, undefined); assertEquals(x.historia, undefined); assertEquals(x.kontakt, undefined); }
  assertEquals((await call("kadry", { action: "lista" })).b.klienci[0].kontakt.telefon, "+48 600 000 000");
});

Deno.test("czynności administratora są zamknięte dla pozostałych", async () => {
  reset(); await call("admin", { action: "lista" });
  for (const body of [{ action: "status", id: N1, status: "zakonczony", koniec_od: "2026-09-30" }, { action: "rejestr", id: N1 }, { action: "rejestr_wszystkie", dry: false }, { action: "rejestr_wszystkie", dry: true }, { action: "rozpoznaj", id: crypto.randomUUID() }, { action: "braki_csv" }]) {
    for (const kto of ["kadry", "ksieg"]) assertEquals((await call(kto, body)).status, 403, body.action);
  }
  assertEquals(T.klienci_baza.find((k) => k.id === N1).status, "obslugiwany");
  assertEquals(calls.rio.length + calls.gus + calls.model, 0);
});

Deno.test("status: zakończenie wymaga daty; kto zmienił pochodzi z sesji; historia; klient zostaje po zniknięciu z arkusza", async () => {
  reset(); await call("admin", { action: "lista" });
  assertEquals((await call("admin", { action: "status", id: N1, status: "zakonczony" })).status, 400);
  assertEquals((await call("admin", { action: "status", id: N1, status: "zakonczony", koniec_od: "30.09.2026" })).status, 400);
  assertEquals((await call("admin", { action: "status", id: N1, status: "usuniety" })).status, 400);
  assertEquals((await call("admin", { action: "status", id: "x' or 1=1", status: "wstrzymany" })).status, 400);
  assertEquals((await call("admin", { action: "status", id: nip("999000068"), status: "wstrzymany" })).status, 404);
  assertEquals((await call("admin", { action: "status", id: N1, status: "zakonczony", koniec_od: "2026-09-30", obsluga_od: "2026-10-01" })).status, 400);
  const r = await call("admin", { action: "status", id: N1, status: "zakonczony", koniec_od: "2026-09-30", powod: "Klient przeszedł do innego biura.", zmienil: "ktos.inny@example.test" });
  assertEquals(r.status, 200); assertEquals(r.b.klient.zmienil, "admin@example.test"); assertEquals(r.b.klient.koniec_od, "2026-09-30");
  // the client leaves the sheet: the row stays, flagged
  T.portal_klienci = T.portal_klienci.filter((k) => k.id !== N1);
  assertEquals((await call("admin", { action: "sync" })).b.zsynchronizowano, true);
  const l = (await call("admin", { action: "lista" })).b.klienci;
  assertEquals(l.length, 4);
  const alfa = l.find((k: Any) => k.id === N1);
  assertEquals([alfa.w_arkuszu, alfa.status, alfa.koniec_od], [false, "zakonczony", "2026-09-30"]);
  assertEquals(alfa.historia.map((h: Any) => [h.status, h.powod, h.zmienil]), [["zakonczony", "Klient przeszedł do innego biura.", "admin@example.test"]]);
  assertEquals(l.find((k: Any) => k.id === N3).w_arkuszu, true);
  // restoring clears the end date
  assertEquals((await call("admin", { action: "status", id: N1, status: "obslugiwany" })).b.klient.koniec_od, null);
  // a sync never resets the status of a known client
  await call("admin", { action: "status", id: N3, status: "wstrzymany", powod: "Zawieszona działalność." });
  await call("admin", { action: "sync" });
  assertEquals(T.klienci_baza.find((k) => k.id === N3).status, "wstrzymany");
});

Deno.test("rejestr: plan i koszt bez pobierania; pobranie; zmiana zarządu tworzy nową migawkę; spółka nieznana KRS -> GUS", async () => {
  reset(); await call("admin", { action: "lista" });
  const plan = (await call("admin", { action: "rejestr_wszystkie" })).b; // dry is the default
  assertEquals([plan.dry, plan.firm, plan.krs_firm, plan.gus_firm, plan.zapytan_rejestr_io, plan.zapytan_gus, plan.koszt_zl, plan.pominiete.bez_nip], [true, 3, 2, 1, 6, 1, 0.3, 1]);
  assertEquals(calls.rio.length + calls.gus, 0);

  const run = (await call("admin", { action: "rejestr_wszystkie", dry: false })).b;
  assertEquals(run.zrobione.map((z: Any) => [z.id, z.ok, z.zrodlo]), [[N1, true, "krs"], [N2, true, "gus"], [N3, true, "gus"]]);
  assertEquals(run.pozostalo, 0);
  assertEquals(calls.rio.filter((p) => p.includes(N1) || p.startsWith("0000999001")).length, 3); // org + chapter + basic record
  assertEquals(T.klienci_rejestr.length, 3);
  const s = T.klienci_rejestr.find((r) => r.klient === N1);
  assertEquals([s.krs, s.kapital, s.data_rejestracji, s.stan, s.reprezentacja], ["0000999001", 5000, "2019-03-04", "aktywna", "KAŻDY CZŁONEK ZARZĄDU SAMODZIELNIE"]);
  assertEquals(s.zarzad, [{ imie: "ANNA", nazwisko: "WZORCOWA", funkcja: "PREZES ZARZĄDU" }]);
  assertEquals(T.klienci_rejestr.find((r) => r.klient === N2).znaleziono, false);
  assertEquals(T.klienci_rejestr.find((r) => r.klient === N3).nazwa, "USŁUGI TESTOWE JAN WZORCOWY");

  // everything is fresh now: nothing to do, nothing is asked
  const przed = calls.rio.length + calls.gus;
  const drugi = (await call("admin", { action: "rejestr_wszystkie", dry: false })).b;
  assertEquals([drugi.zrobione.length, drugi.pominiete.swieze], [0, 3]); assertEquals(calls.rio.length + calls.gus, przed);

  // one client, on request: throttled within a minute
  assertEquals((await call("admin", { action: "rejestr", id: N1 })).status, 429);
  T.klienci_baza.find((k) => k.id === N1).rejestr_at = "2026-01-01T00:00:00Z";
  zarzad = [{ imie: "PIOTR", nazwisko: "PRZYKŁADOWY" }];
  const jeden = await call("admin", { action: "rejestr", id: N1 });
  assertEquals([jeden.status, jeden.b.ok, jeden.b.zmiany], [200, true, 1]);
  const mig = T.klienci_rejestr.filter((r) => r.klient === N1).sort((a, b) => String(b.fetched_at).localeCompare(a.fetched_at));
  assertEquals(mig.length, 2); assertEquals(mig[0].zmiany[0].pole, "skład organu reprezentacji");
  const alfa = (await call("ksieg", { action: "lista" })).b.klienci.find((k: Any) => k.id === N1);
  assert(alfa.ostrzezenia.some((o: string) => o.includes("skład organu reprezentacji"))); assertEquals(alfa.rej_historia.length, 1); assertEquals(alfa.rej.dane, undefined);
  // unchanged on the next reading: the snapshot is confirmed, not duplicated
  T.klienci_baza.find((k) => k.id === N1).rejestr_at = "2026-01-01T00:00:00Z";
  assertEquals((await call("admin", { action: "rejestr", id: N1 })).b.zmiany, 0);
  assertEquals(T.klienci_rejestr.filter((r) => r.klient === N1).length, 2);
  assertEquals((await call("admin", { action: "rejestr", id: "nazwa:przykładowa gamma" })).b.ok, false);
});

Deno.test("rejestr: awaria rejestr.io zapisuje błąd i nie zapętla płatnych zapytań", async () => {
  reset(); await call("admin", { action: "lista" });
  const orig = globalThis.fetch;
  globalThis.fetch = ((u: Any, i: Any) => String(u).startsWith("https://rejestr.io/") ? Promise.resolve(new Response("x", { status: 500 })) : orig(u, i)) as typeof fetch;
  try {
    const run = (await call("admin", { action: "rejestr_wszystkie", dry: false })).b;
    assertEquals(run.zrobione.filter((z: Any) => !z.ok).length, 2);
    assert(T.klienci_baza.find((k) => k.id === N1).rejestr_blad.includes("500"));
    const drugi = (await call("admin", { action: "rejestr_wszystkie", dry: false })).b;
    assertEquals([drugi.zrobione.length, drugi.pominiete.po_bledzie], [0, 2]);
  } finally { globalThis.fetch = orig; }
});

Deno.test("rozpoznaj: NIP zgodny -> przypisany; niepewny odczyt, sama częściowa nazwa, NIP biura -> do sprawdzenia", async () => {
  reset(); await call("admin", { action: "lista" });
  modelOut = ODCZYT();
  const id = skan();
  assertEquals((await call("admin", { action: "rozpoznaj", id })).b, { ok: true, status: "przypisany" });
  const u = T.klienci_umowy.find((x) => x.id === id);
  assertEquals([u.klient, u.rodzaj, u.obejmuje, u.data_zawarcia, u.bezterminowa, u.kontrahent_nip, u.stron], [N1, "ksiegowosc", ["ksiegowosc", "powierzenie"], "2024-01-15", true, N1, 4]);
  assertEquals(u.ai.kandydaci[0], { id: N1, nazwa: "Przykładowa Alfa sp. z o.o.", nip: N1, wynik: 100, powod: "NIP" });
  const a = (await call("admin", { action: "lista" })).b.klienci.find((k: Any) => k.id === N1).audyt;
  assertEquals([a.ma.umowa, a.ma.powierzenie, a.pozycje.find((p: Any) => p.kod === "umowa").stan], [true, true, "ok"]);

  modelOut = ODCZYT({ pewnosc: "niska" });
  const id2 = skan(); await call("admin", { action: "rozpoznaj", id: id2 });
  assertEquals([T.klienci_umowy.find((x) => x.id === id2).status, T.klienci_umowy.find((x) => x.id === id2).klient], ["do_sprawdzenia", null]);

  modelOut = ODCZYT({ klient: { nazwa: "Jan Wzorcowy", nip: "", krs: "", reprezentanci: [] } });
  const id3 = skan(); await call("admin", { action: "rozpoznaj", id: id3 });
  const u3 = T.klienci_umowy.find((x) => x.id === id3);
  assertEquals([u3.status, u3.klient, u3.ai.kandydaci[0].id], ["do_sprawdzenia", null, N3]);

  // the model put the office's own NIP as the client's: ignored, the name decides
  modelOut = ODCZYT({ klient: { nazwa: "Przykładowa Beta sp. z o.o.", nip: BIURO, krs: "", reprezentanci: [] } });
  const id4 = skan(); await call("admin", { action: "rozpoznaj", id: id4 });
  const u4 = T.klienci_umowy.find((x) => x.id === id4);
  assertEquals([u4.status, u4.klient, u4.kontrahent_nip], ["przypisany", N2, null]);

  // the uploader pointed at a client; the document carries another client's valid NIP -> a person decides
  modelOut = ODCZYT();
  const id5 = skan(N2); await call("admin", { action: "rozpoznaj", id: id5 });
  assertEquals([T.klienci_umowy.find((x) => x.id === id5).status, T.klienci_umowy.find((x) => x.id === id5).klient], ["do_sprawdzenia", N2]);
  // pointed at, nothing readable about the client -> filed where the uploader said
  modelOut = ODCZYT({ klient: { nazwa: "", nip: "", krs: "", reprezentanci: [] }, pewnosc: "srednia" });
  const id6 = skan(N3); await call("admin", { action: "rozpoznaj", id: id6 });
  assertEquals([T.klienci_umowy.find((x) => x.id === id6).status, T.klienci_umowy.find((x) => x.id === id6).klient], ["przypisany", N3]);
});

Deno.test("rozpoznaj: obca ścieżka, za duży plik, nie-PDF, równoległy odczyt, zły identyfikator — bez wywołania modelu", async () => {
  reset(); await call("admin", { action: "lista" }); modelOut = ODCZYT();
  assertEquals((await call("admin", { action: "rozpoznaj", id: "../../etc/passwd" })).status, 400);
  assertEquals((await call("admin", { action: "rozpoznaj", id: crypto.randomUUID() })).status, 404);
  const obca = skan(null, crypto.randomUUID() + "/cudzy.pdf");
  assertEquals((await call("admin", { action: "rozpoznaj", id: obca })).b.error, "Nieprawidłowa ścieżka pliku.");
  const wyzej = skan(); T.klienci_umowy.find((x) => x.id === wyzej).path = wyzej + "/../../akta-osobowe/x.pdf";
  assertEquals((await call("admin", { action: "rozpoznaj", id: wyzej })).b.error, "Nieprawidłowa ścieżka pliku.");
  const duzy = skan(); T.klienci_umowy.find((x) => x.id === duzy).rozmiar = 30 * 1024 * 1024;
  assert((await call("admin", { action: "rozpoznaj", id: duzy })).b.error.includes("za duży"));
  const html = skan(); FILES[T.klienci_umowy.find((x) => x.id === html).path] = new TextEncoder().encode("<html><script>alert(1)</script>");
  assertEquals((await call("admin", { action: "rozpoznaj", id: html })).b.error, "To nie jest plik PDF, JPEG ani PNG.");
  const trwa = skan(); Object.assign(T.klienci_umowy.find((x) => x.id === trwa), { status: "analiza", analiza_at: now() });
  assert((await call("admin", { action: "rozpoznaj", id: trwa })).b.error.includes("właśnie odczytywany"));
  assertEquals(calls.model, 0);
  assertEquals(T.klienci_umowy.filter((x) => x.status === "blad").length, 4);
});

Deno.test("braki_csv: tylko obsługiwani i wstrzymani, pola zabezpieczone", async () => {
  reset(); await call("admin", { action: "lista" });
  T.klienci_baza.find((k) => k.id === N2).nazwa = "=1+1 sp. z o.o.";
  T.portal_klienci.find((k) => k.id === N2).dane.nazwa = "=1+1 sp. z o.o.";
  await call("admin", { action: "status", id: N3, status: "zakonczony", koniec_od: "2026-08-31" });
  const csv = (await call("admin", { action: "braki_csv" })).b.csv as string;
  const linie = csv.trimEnd().split("\r\n");
  assertEquals(linie.length, 4);
  assert(linie.some((l) => l.startsWith('"\'=1+1 sp. z o.o.";')));
  assert(!csv.includes("Jan Wzorcowy"));
});
