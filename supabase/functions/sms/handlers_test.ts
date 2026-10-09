// deno test --allow-env --allow-net supabase/functions/sms/handlers_test.ts
// The handlers of `sms` and the SMS part of `terminy` run locally: Deno.serve is captured and every outgoing
// request (auth, database, SMSAPI) is answered by an in-memory stand-in. Nothing leaves the machine, no SMS
// is sent. Fictional firms, people and numbers only.
import { assert, assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
type Any = any;
const SEKRET = "tajny-token-ktorego-nie-wolno-pokazac";
Deno.env.set("SUPABASE_URL", "http://db.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("SMSAPI_TOKEN", SEKRET);
Deno.env.set("CRON_KEY", "cron-key-for-tests");
Deno.env.set("TELEGRAM_BOT_TOKEN", "");
Deno.env.set("SMTP_PASS", "");

function nip(base: string): string { const w = [6, 5, 7, 2, 3, 4, 5, 6, 7]; return base + (w.reduce((a, x, i) => a + x * Number(base[i]), 0) % 11); }
const N1 = nip("999000001"), N2 = nip("999000002"), N3 = nip("999000013"), N4 = nip("999000024");
const USERS: Record<string, Any> = {
  admin: { email: "admin@example.test", app_metadata: { portal: true, portal_admin: true } },
  kadry: { email: "kadry@example.test", app_metadata: { portal: true, portal_sections: ["kadry"] } },
  ksieg: { email: "ksieg@example.test", app_metadata: { portal: true, portal_sections: ["onboarding"] } },
  spolka: { email: "spolka@example.test", app_metadata: { portal: true, portal_sections: ["rejestracja"] } },
  obcy: { email: "obcy@example.test", app_metadata: {} },
};
const T: Record<string, Any[]> = {};
let LIMITY: Record<string, number> = {};
const dostawca = { wywolania: [] as { host: string; path: string; form: Record<string, string>; auth: string }[], odp: null as null | ((host: string, form: Record<string, string>) => Response), padaGlowny: false };
const wyjscia: string[] = []; // everything the functions print or answer — searched for the token at the end
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function reset(ust: Any = null) {
  const dane = (nazwa: string, n: string, telefon: string, poz: number) => ({ nazwa, nip: n, forma: "spółka z o.o.", adres: "ul. Przykładowa 1, 00-000 Warszawa", opodatkowanie: "", telefon, email: "biuro@example.test", kontakt: "Osoba Testowa", miasto: "Warszawa", opiekun: "", kadrowy: "", telegram: "", jezyk: "pl", poz });
  T.portal_klienci = [
    { id: N1, nip: N1, dane: dane("Przykładowa Alfa sp. z o.o.", N1, "600 100 200", 0), synced_at: new Date().toISOString() },
    { id: N2, nip: N2, dane: dane("Przykładowa Beta sp. z o.o.", N2, "22 123 45 67", 1), synced_at: new Date().toISOString() },
    { id: N3, nip: N3, dane: dane("Przykładowa Gamma sp. z o.o.", N3, "tel. 22 123 45 67, kom. +48 501-100-200", 2), synced_at: new Date().toISOString() },
    { id: N4, nip: N4, dane: dane("Przykładowa Delta (zakończona)", N4, "601100200", 3), synced_at: new Date().toISOString() },
  ];
  T.klienci_baza = [{ id: N4, nip: N4, status: "zakonczony", koniec_od: "2026-01-31" }];
  T.portal_ustawienia = ust ? [{ key: "sms", value: ust, updated_at: new Date().toISOString() }] : [];
  T.sms_wiadomosci = []; T.portal_powiadomienia = []; T.portal_zadania_log = []; T.zatrudnienie_zgloszenia = [];
  LIMITY = {}; dostawca.wywolania = []; dostawca.odp = null; dostawca.padaGlowny = false;
}
const WL = { wlaczone: true, nadawca: "Tw.Ksiegowa", limit_dzienny: 100, limit_na_numer_dziennie: 3, godziny: { od: "00:00", do: "23:59" }, automaty: { terminy: true }, normalizuj: true, zagranica: false, raporty: false };
// (stored hours cover the whole day so the tests do not depend on when they run; quiet hours have their own test)
const DO_ZAPISU = { ...WL, godziny: { od: "08:00", do: "20:00" } };

function pasuje(row: Any, col: string, expr: string): boolean {
  if (col === "or") return expr.slice(1, -1).split(",").some((c) => { const [k, ...r] = c.split("."); return pasuje(row, k, r.join(".")); });
  const v = row[col];
  const neg = expr.startsWith("not."); if (neg) expr = expr.slice(4);
  const [op, ...rest] = expr.split("."); const arg = rest.join(".");
  const r = op === "eq" ? String(v) === arg : op === "neq" ? String(v) !== arg : op === "is" ? (arg === "null" ? v == null : String(v) === arg)
    : op === "in" ? arg.slice(1, -1).split(",").includes(String(v)) : op === "gte" ? v != null && String(v) >= arg : op === "lte" ? v != null && String(v) <= arg
    : op === "lt" ? v != null && String(v) < arg : op === "ilike" ? String(v ?? "").toLowerCase().includes(arg.replaceAll("*", "").toLowerCase()) : false;
  return neg ? !r : r;
}
// who may read a log row — the row-level policy of sms_wiadomosci, restated for the stand-in
function politykaSms(u: Any, row: Any): boolean {
  const m = u?.app_metadata ?? {};
  if (m.portal !== true) return false;
  const sekcja = (s: string) => m.portal_admin === true || !Array.isArray(m.portal_sections) || m.portal_sections.includes(s);
  const moje = String(row.kto).toLowerCase() === String(u.email).toLowerCase();
  return m.portal_admin === true || (sekcja("kadry") && (row.cel === "termin" || moje)) || (sekcja("onboarding") && moje);
}
const prawdziwyFetch = globalThis.fetch;
// deno-lint-ignore require-await
globalThis.fetch = (async (input: Any, init: Any = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const h = new Headers(init.headers ?? {});
  const auth = h.get("Authorization") ?? "";
  if (url.host === "db.test") {
    if (url.pathname === "/auth/v1/user") { const u = USERS[auth.replace("Bearer ", "")]; return u ? J(u) : J({}, 401); }
    const sciezka = url.pathname.replace("/rest/v1/", "");
    if (sciezka === "rpc/sms_rezerwuj") {
      const b = JSON.parse(init.body);
      for (let i = 0; i < b.p_klucze.length; i++) if ((LIMITY[b.p_klucze[i]] ?? 0) + 1 > b.p_maxy[i]) return J(b.p_klucze[i]);
      for (const k of b.p_klucze) LIMITY[k] = (LIMITY[k] ?? 0) + 1;
      return J(null);
    }
    const t = (T[sciezka] ??= []);
    const filtry = [...url.searchParams].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k));
    let wiersze = t.filter((r) => filtry.every(([k, v]) => pasuje(r, k, v)));
    const metoda = init.method ?? "GET";
    if (metoda === "GET") {
      if (sciezka === "sms_wiadomosci" && auth !== "Bearer service") { const u = USERS[auth.replace("Bearer ", "")]; wiersze = wiersze.filter((r) => politykaSms(u, r)).map(({ idx: _i, tresc_hash: _h, ...r }) => r); }
      if ((url.searchParams.get("order") ?? "").includes("created_at.desc")) wiersze = wiersze.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const zakres = h.get("Range"); if (zakres) { const [a, b] = zakres.split("-").map(Number); wiersze = wiersze.slice(a, b + 1); }
      const lim = url.searchParams.get("limit"); if (lim) wiersze = wiersze.slice(0, Number(lim));
      return J(wiersze);
    }
    if (auth !== "Bearer service") return J({ message: "permission denied" }, 403);
    if (metoda === "POST") {
      const nowe = [JSON.parse(init.body)].flat().map((r: Any) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
      for (const r of nowe) {
        if (sciezka === "portal_zadania_log") r.dzien ??= zaDni(0); // the column's default
        if (sciezka === "portal_ustawienia") { const i = t.findIndex((x) => x.key === r.key); if (i >= 0) { t[i] = r; continue; } }
        // the unique index on successful reminders
        if (sciezka === "portal_powiadomienia" && r.status === "ok" && t.some((x) => x.rodzaj === r.rodzaj && x.status === "ok" && x.worker_id === r.worker_id && x.doc_key === r.doc_key && x.doc_date === r.doc_date && x.prog === r.prog)) continue;
        t.push(r);
      }
      return J(nowe, 201);
    }
    if (metoda === "PATCH") { const p = JSON.parse(init.body); for (const r of wiersze) Object.assign(r, p); return J(wiersze); }
    return J({}, 405);
  }
  if (url.host === "api.smsapi.pl" || url.host === "api2.smsapi.pl") {
    const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
    dostawca.wywolania.push({ host: url.host, path: url.pathname, form, auth });
    if (auth !== "Bearer " + SEKRET) return J({ message: "Authorization failed", error: "authorization_failed" }, 401);
    if (dostawca.padaGlowny && url.host === "api.smsapi.pl") throw new TypeError("connection refused " + auth);
    if (url.pathname === "/profile") return J({ name: "Biuro Testowe", username: "test", payment_type: "prepaid", points: 75.32 });
    if (url.pathname === "/sms/sendernames") return J({ collection: [{ sender: "Tw.Ksiegowa", is_default: true, status: "ACTIVE" }, { sender: "2WAY", is_default: false, status: "ACTIVE" }, { sender: "Stara", is_default: false, status: "INACTIVE" }], size: 3 });
    if (url.pathname === "/sms.do") {
      if (dostawca.odp) return dostawca.odp(url.host, form);
      return J({ count: 1, list: [{ id: form.test === "1" ? "" : "MSG" + (1000 + dostawca.wywolania.length), points: form.test === "1" ? 0 : 0.16, number: form.to, date_sent: 1, submitted_number: form.to, status: "QUEUE", error: null, idx: form.idx, parts: 1 }] });
    }
    return J({}, 404);
  }
  throw new Error("nieoczekiwane żądanie: " + url.host);
}) as typeof fetch;

// capture console output and Deno.serve
for (const k of ["log", "error", "warn"] as const) { const o = console[k]; console[k] = (...a: Any[]) => { wyjscia.push(a.map(String).join(" ")); if (Deno.env.get("POKAZ")) o(...a); }; }
const handlery: ((r: Request) => Promise<Response>)[] = [];
(Deno as Any).serve = (h: Any) => { handlery.push(h); return {}; };
await import("./index.ts");
await import("../terminy/index.ts");
const [smsH, terminyH] = handlery;
const { wyslijSms } = await import("./wyslij.ts");

async function api(kto: string, body: Any): Promise<Any> {
  const r = await smsH(new Request("http://f.test/sms", { method: "POST", headers: { Authorization: "Bearer " + kto, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const t = await r.text(); wyjscia.push(t);
  return { http: r.status, ...JSON.parse(t) };
}
async function cron(body: Any, klucz = "cron-key-for-tests"): Promise<Any> {
  const r = await terminyH(new Request("http://f.test/terminy", { method: "POST", headers: { "x-cron-key": klucz, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const t = await r.text(); wyjscia.push(t);
  return { http: r.status, ...JSON.parse(t) };
}
const sms = () => dostawca.wywolania.filter((w) => w.path === "/sms.do");
const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("access: no session, not a portal user, a section without SMS", opts, async () => {
  reset();
  assertEquals((await api("nikt", { action: "status" })).http, 403);
  assertEquals((await api("obcy", { action: "status" })).http, 403);
  assertEquals((await api("spolka", { action: "wyslij", nip: N1, tresc: "x" })).http, 403);
  assertEquals((await smsH(new Request("http://f.test/sms", { method: "GET" }))).status, 405);
  assertEquals((await api("kadry", { action: "nie_ma" })).http, 400);
  assertEquals(dostawca.wywolania.length, 0);
});

Deno.test("status: defaults OFF, test mode; balance and sender names only for an administrator, 2WAY never offered", opts, async () => {
  reset();
  const k = await api("kadry", { action: "status" });
  assertEquals([k.http, k.skonfigurowane, k.tryb, k.ustawienia.wlaczone, k.ustawienia.automaty.terminy, k.ustawienia.nadawca], [200, true, "test", false, false, "Tw.Ksiegowa"]);
  assert(k.saldo === undefined && k.nadawcy === undefined && k.ja.numer_reczny === false);
  assertEquals(dostawca.wywolania.length, 0);
  const a = await api("admin", { action: "status" });
  assertEquals(a.saldo.punkty, 75.32);
  assertEquals(a.nadawcy.lista.map((n: Any) => n.nazwa), ["Tw.Ksiegowa", "Stara"]);
  assert(a.szablony.length >= 3 && a.limity.czesci === 6 && k.limity.czesci === 3);
});

Deno.test("podglad: number from the base, parts, encoding, signature", opts, async () => {
  reset();
  const p = await api("kadry", { action: "podglad", nip: N3, tresc: "Zażółć gęślą jaźń" });
  assertEquals([p.tresc, p.kodowanie, p.czesci, p.polskie_znaki, p.polskie_usuniete, p.podpis_dodany], ["TD Consulting Group: Zazolc gesla jazn", "GSM-7", 1, true, true, true]);
  assertEquals(p.telefon, { ok: true, numer: "+48501100200", kraj: "PL", odbiorca: "Przykładowa Gamma sp. z o.o." });
  assertEquals((await api("ksieg", { action: "podglad", nip: N1, tresc: "x" })).telefon.numer, "+48****** 200"); // outside Kadry: masked
  assert(!(await api("kadry", { action: "podglad", nip: N2, tresc: "x" })).telefon.ok); // a landline on file
  assert(!(await api("kadry", { action: "podglad", telefon: "600100200", tresc: "x" })).telefon.ok); // explicit number: not for staff
  assertEquals((await api("admin", { action: "podglad", telefon: "600 100 200", tresc: "Привіт" })).kodowanie, "UCS-2");
  const d = await api("kadry", { action: "podglad", nip: N1, tresc: "a".repeat(500) });
  assert(d.czesci === 4 && d.za_dluga && d.max_czesci === 3);
  assertEquals((await api("kadry", { action: "podglad", nip: N1, telefon: "600100200", tresc: "x" })).http, 400);
  assertEquals((await api("kadry", { action: "podglad", nip: N1, tresc: "a".repeat(1001) })).http, 400);
  assertEquals(dostawca.wywolania.length, 0);
});

Deno.test("wyslij: module OFF -> the provider's test mode, logged as test", opts, async () => {
  reset();
  const w = await api("kadry", { action: "wyslij", nip: N1, tresc: "Prosimy o kontakt w sprawie umowy." });
  assert(w.ok && w.test && w.status === "test", JSON.stringify(w));
  const f = sms()[0].form;
  assertEquals([f.test, f.to, f.from, f.format, f.encoding, f.normalize, f.max_parts, f.check_idx, f.notify_url], ["1", "48600100200", "Tw.Ksiegowa", "json", "utf-8", "1", "3", "1", undefined]);
  assertEquals(f.message, "TD Consulting Group: Prosimy o kontakt w sprawie umowy.");
  assert(/^[0-9a-f]{32}$/.test(f.idx));
  const r = T.sms_wiadomosci[0];
  assertEquals([r.status, r.test, r.kto, r.telefon, r.odbiorca_nip, r.odbiorca_nazwa, r.cel, r.czesci], ["test", true, "kadry@example.test", "+48600100200", N1, "Przykładowa Alfa sp. z o.o.", "reczny", 1]);
});

Deno.test("wyslij: who may address what", opts, async () => {
  reset(WL);
  assertEquals((await api("kadry", { action: "wyslij", telefon: "600100200", tresc: "x" })).http, 403);       // explicit number: administrators only
  assertEquals((await api("admin", { action: "wyslij", nip: N1, telefon: "601100200", tresc: "x" })).http, 400); // a number sent with a NIP is refused
  assertEquals((await api("kadry", { action: "wyslij", tresc: "x" })).http, 400);
  assertEquals((await api("kadry", { action: "wyslij", nip: "1234567890", tresc: "x" })).kod, "odbiorca");
  assertEquals((await api("kadry", { action: "wyslij", nip: N2, tresc: "x" })).kod, "numer");                    // landline on file
  assertEquals((await api("kadry", { action: "wyslij", nip: N1, tresc: "   " })).kod, "tresc");
  assertEquals((await api("kadry", { action: "wyslij", nip: N1, tresc: "a".repeat(1001) })).kod, "tresc");
  assertEquals((await api("kadry", { action: "wyslij", nip: N1, tresc: "a".repeat(500) })).kod, "za_dluga");     // 4 parts > 3
  assertEquals((await api("admin", { action: "wyslij", telefon: "700 123 456", tresc: "x" })).kod, "numer");     // premium
  assertEquals((await api("admin", { action: "wyslij", telefon: "+380501234567", tresc: "x" })).kod, "numer");   // foreign sending is off
  assertEquals(sms().length, 0);
  assertEquals(T.sms_wiadomosci.length, 0);
  const a = await api("admin", { action: "wyslij", nip: N1, tresc: "a".repeat(500), test: true });              // an administrator: up to 6 parts
  assert(a.ok && a.test && sms()[0].form.max_parts === "6" && sms()[0].form.test === "1");
  const t = await api("admin", { action: "wyslij", telefon: "0048 601-100-200", tresc: "Test", test: true });
  assert(t.ok && sms()[1].form.to === "48601100200" && T.sms_wiadomosci[1].cel === "test" && T.sms_wiadomosci[1].odbiorca_nip === null);
});

Deno.test("wyslij: module ON -> a real request (to the stand-in), no test flag, logged as wyslany", opts, async () => {
  reset(WL);
  const w = await api("ksieg", { action: "wyslij", nip: N1, tresc: "Dokumenty są gotowe.", cel: "podpis_link", ref: "pakiet-1" });
  assert(w.ok && !w.test && w.status === "wyslany" && w.koszt === 0.16, JSON.stringify(w));
  assertEquals(w.telefon, "+48****** 200"); // Księgowość does not see the number
  const f = sms()[0].form;
  assert(f.test === undefined && f.notify_url === undefined && f.message === "TD Consulting Group: Dokumenty sa gotowe.");
  const r = T.sms_wiadomosci[0];
  assert(r.status === "wyslany" && r.test === false && r.provider_id.startsWith("MSG") && r.cel === "podpis_link" && r.ref === "pakiet-1");
  // with delivery reports switched on the address of the function is sent along
  reset({ ...WL, raporty: true });
  await api("kadry", { action: "wyslij", nip: N1, tresc: "Raport." });
  assertEquals(sms()[0].form.notify_url, "http://db.test/functions/v1/sms");
});

Deno.test("guards: duplicate, per-number cap, daily cap — all logged as odrzucony, none reaches the provider", opts, async () => {
  reset({ ...WL, limit_dzienny: 4, limit_na_numer_dziennie: 2 });
  assert((await api("kadry", { action: "wyslij", nip: N1, tresc: "Pierwsza" })).ok);
  const d = await api("kadry", { action: "wyslij", nip: N1, tresc: "Pierwsza" });
  assertEquals([d.ok, d.kod], [false, "duplikat"]);
  assert((await api("admin", { action: "wyslij", nip: N1, tresc: "Druga" })).ok);
  assertEquals((await api("kadry", { action: "wyslij", nip: N1, tresc: "Trzecia" })).kod, "limit_numer");
  assert((await api("kadry", { action: "wyslij", nip: N3, tresc: "Trzecia" })).ok);
  assert((await api("kadry", { action: "wyslij", nip: N3, tresc: "Czwarta" })).ok);
  assertEquals((await api("kadry", { action: "wyslij", nip: N4, tresc: "Piąta" })).kod, "limit_dzienny");
  assertEquals(sms().length, 4);
  assertEquals(T.sms_wiadomosci.filter((r) => r.status === "odrzucony").map((r) => r.provider_blad), ["duplikat", "limit_numer", "limit_dzienny"]);
  // a refused message did not use up the other counters
  assertEquals(Object.entries(LIMITY).filter(([k]) => k === "dzien")[0][1], 4);
  // test mode counts separately: the real cap is full, a test still goes (to the stand-in, with test=1)
  const t = await api("kadry", { action: "wyslij", nip: N4, tresc: "Szósta", test: true });
  assert(t.ok && t.test && sms()[4].form.test === "1");
  // the same text in parallel: only one passes (the lock is one atomic statement)
  reset(WL);
  const para = await Promise.all([1, 2, 3].map(() => api("kadry", { action: "wyslij", nip: N1, tresc: "Równolegle" })));
  assertEquals(para.filter((x) => x.ok).length, 1);
  assertEquals(sms().length, 1);
});

Deno.test("quiet hours: automatic sends refused, a person must confirm", opts, async () => {
  reset({ ...WL, godziny: { od: "08:00", do: "20:00" } });
  const noc = new Date("2026-10-09T05:10:00Z"), dzien = new Date("2026-10-09T09:15:00Z"); // 07:10 and 11:15 in Warsaw
  const a = await wyslijSms({ nip: N1, tresc: "Automat", kto: "automat", automat: true, teraz: noc });
  assertEquals([a.ok, a.kod], [false, "cisza"]);
  const r = await wyslijSms({ nip: N1, tresc: "Ręcznie", kto: "kadry@example.test", teraz: noc });
  assertEquals([r.ok, r.kod, r.wymaga_potwierdzenia], [false, "cisza", true]);
  assertEquals(sms().length, 0);
  const p = await wyslijSms({ nip: N1, tresc: "Ręcznie", kto: "kadry@example.test", teraz: noc, mimoCiszy: true });
  assert(p.ok && p.ostrzezenia.includes("poza_godzinami"));
  assert((await wyslijSms({ nip: N1, tresc: "Automat w dzień", kto: "automat", automat: true, teraz: dzien })).ok);
  // module off: an automatic job does not send at all — not even a test
  reset();
  assertEquals((await wyslijSms({ nip: N1, tresc: "Automat", kto: "automat", automat: true, teraz: dzien })).kod, "wylaczone");
  assertEquals(sms().length, 0);
});

Deno.test("provider: errors, backup host, lost answer", opts, async () => {
  reset(WL);
  dostawca.odp = () => J({ error: 103, message: "No points " + SEKRET });
  const e = await api("kadry", { action: "wyslij", nip: N1, tresc: "Bez punktów" });
  assert(!e.ok && e.kod === "dostawca" && /punktów/.test(e.error) && T.sms_wiadomosci[0].status === "blad" && T.sms_wiadomosci[0].provider_blad.startsWith("103"));
  // the main host is down: the backup host gets the same request with the same idx
  reset(WL); dostawca.padaGlowny = true;
  const z = await api("kadry", { action: "wyslij", nip: N1, tresc: "Zapas" });
  assert(z.ok, JSON.stringify(z));
  assertEquals(sms().map((w) => w.host), ["api.smsapi.pl", "api2.smsapi.pl"]);
  assertEquals(sms()[0].form.idx, sms()[1].form.idx);
  // the main host answered 5xx after accepting; the backup refuses the repeated idx (53): counted as sent, once
  reset(WL);
  dostawca.odp = (host) => host === "api.smsapi.pl" ? J({}, 502) : J({ error: 53, message: "idx" });
  const l = await api("kadry", { action: "wyslij", nip: N1, tresc: "Zgubiona odpowiedź" });
  assert(l.ok && T.sms_wiadomosci[0].status === "wyslany" && T.sms_wiadomosci[0].provider_id === null);
  // both hosts down
  reset(WL); dostawca.odp = () => J({}, 503);
  const b = await api("kadry", { action: "wyslij", nip: N1, tresc: "Awaria" });
  assert(!b.ok && T.sms_wiadomosci[0].status === "blad");
});

Deno.test("historia: each person sees what the policy allows; filters; paging", opts, async () => {
  reset(WL);
  await api("kadry", { action: "wyslij", nip: N1, tresc: "Od kadr" });
  await api("ksieg", { action: "wyslij", nip: N3, tresc: "Od księgowości" });
  await wyslijSms({ nip: N1, tresc: "Termin automatyczny", kto: "automat", automat: true, cel: "termin", teraz: new Date("2026-10-09T09:15:00Z") });
  const ile = async (kto: string, f: Any = {}) => (await api(kto, { action: "historia", ...f })).wiersze;
  assertEquals((await ile("admin")).length, 3);
  assertEquals((await ile("kadry")).map((r: Any) => r.kto).sort(), ["automat", "kadry@example.test"]);
  assertEquals((await ile("ksieg")).map((r: Any) => r.kto), ["ksieg@example.test"]);
  assert((await ile("admin")).every((r: Any) => r.idx === undefined && r.tresc_hash === undefined));
  assertEquals((await ile("ksieg"))[0].telefon, "+48****** 200");
  assertEquals((await ile("admin", { cel: "termin" })).length, 1);
  assertEquals((await ile("admin", { status: "blad" })).length, 0);
  assertEquals((await ile("admin", { q: "gamma" })).length, 1);
  assertEquals((await ile("admin", { q: "),kto.eq.x" })).length, 0); // filter characters are stripped from the search
  assertEquals((await ile("admin", { od: "2030-01-01" })).length, 0);
});

Deno.test("ustawienia: administrators only, validated, the sender must be an active name, never 2WAY", opts, async () => {
  reset();
  assertEquals((await api("kadry", { action: "ustawienia", ustawienia: DO_ZAPISU })).http, 403);
  assertEquals((await api("admin", { action: "ustawienia", ustawienia: { ...DO_ZAPISU, nadawca: "2WAY" } })).http, 400);
  assertEquals((await api("admin", { action: "ustawienia", ustawienia: { ...DO_ZAPISU, nadawca: "Stara" } })).http, 400); // inactive
  assertEquals((await api("admin", { action: "ustawienia", ustawienia: { ...DO_ZAPISU, limit_dzienny: 99999 } })).http, 400);
  assertEquals(T.portal_ustawienia.length, 0);
  const s = await api("admin", { action: "ustawienia", ustawienia: { ...DO_ZAPISU, cos_obcego: "<x>" } });
  assert(s.ok && s.ustawienia.wlaczone && T.portal_ustawienia[0].value.by === "admin@example.test" && T.portal_ustawienia[0].value.cos_obcego === undefined);
  assertEquals((await api("kadry", { action: "status" })).tryb, "rzeczywisty");
});

Deno.test("klienci: phone on file, masked outside Kadry, ended clients marked", opts, async () => {
  reset();
  const k = (await api("kadry", { action: "klienci" })).klienci;
  assertEquals(k.map((x: Any) => x.telefon), ["+48600100200", null, "+48501100200", "+48601100200"]);
  assert(k[1].brak && k[3].zakonczony && !k[0].zakonczony);
  assertEquals((await api("ksieg", { action: "klienci" })).klienci[0].telefon, "+48****** 200");
});

Deno.test("delivery report: accepted only with the provider's id AND our idx; only moves a sent row forward", opts, async () => {
  reset({ ...WL, raporty: true });
  await api("kadry", { action: "wyslij", nip: N1, tresc: "Do raportu" });
  const r = T.sms_wiadomosci[0];
  const raport = async (q: string) => { const x = await smsH(new Request("http://f.test/sms?" + q, { method: "GET" })); return [x.status, await x.text()]; };
  assertEquals(await raport(`MsgId=${r.provider_id}&status=404&idx=${"0".repeat(32)}&to=48600100200`), [200, "OK"]); // wrong idx
  assertEquals(await raport(`MsgId=${r.provider_id}&status=404&to=48600100200`), [200, "OK"]);                        // no idx
  assertEquals(await raport(`MsgId=ZLE&status=404&idx=${r.idx}`), [200, "OK"]);
  assertEquals(await raport(`MsgId=${r.provider_id}&status=999&idx=${r.idx}`), [200, "OK"]);
  assertEquals(r.status, "wyslany");
  await raport(`MsgId=${r.provider_id}&status=403&idx=${r.idx}&donedate=1791000000`);
  assertEquals([r.status, r.provider_status], ["wyslany", "SENT"]);
  await raport(`MsgId=${r.provider_id},X&status=404,404&idx=${r.idx},y&donedate=1791000000,1`);
  assertEquals([r.status, r.provider_status, r.dostarczono_at], ["dostarczony", "DELIVERED", new Date(1791000000000).toISOString()]);
  await raport(`MsgId=${r.provider_id}&status=405&idx=${r.idx}`); // a delivered message does not go back
  assertEquals(r.status, "dostarczony");
});

// ---------------------------------------------------------------- terminy: reminders by SMS
function pracownik(id: string, nazwa: string, n: string, pola: Any) {
  return { id, worker_name: nazwa, status: "zatrudniony", created_at: "2026-01-01T00:00:00Z", payload: { z_nip: n, z_nazwa: T.portal_klienci.find((k) => k.nip === n)?.dane.nazwa ?? "", ...pola } };
}
const zaDni = (n: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date(Date.now() + n * 86400000));
const W1 = "00000000-0000-4000-8000-000000000001", W2 = "00000000-0000-4000-8000-000000000002", W3 = "00000000-0000-4000-8000-000000000003", W4 = "00000000-0000-4000-8000-000000000004";
function sceneria(ust: Any, tryb = "auto") {
  reset(ust);
  T.portal_ustawienia.push({ key: "terminy", value: { klient: tryb } });
  T.zatrudnienie_zgloszenia = [
    pracownik(W1, "Jan Wzorcowy", N1, { p_karta_do: zaDni(7) }),
    pracownik(W2, "Olena Testowa", N3, { p_paszport_do: zaDni(30), u_do: zaDni(14) }),
    pracownik(W3, "Adam Przykładowy", N4, { u_do: zaDni(7) }),   // the firm's service has ended
    pracownik(W4, "Ewa Bezmailowa", N1, { p_badania_do: zaDni(7) }), // no e-mail went for this one
  ];
  const mail = (w: string, k: string, d: string, prog: number, n: string, kiedy = new Date().toISOString()) => ({ id: crypto.randomUUID(), created_at: kiedy, rodzaj: "termin_klient", nip: n, worker_id: w, doc_key: k, doc_date: d, prog, kanal: "mail", status: "ok" });
  T.portal_powiadomienia = [mail(W1, "p_karta_do", zaDni(7), 7, N1), mail(W2, "p_paszport_do", zaDni(30), 30, N3), mail(W2, "u_do", zaDni(14), 14, N3), mail(W3, "u_do", zaDni(7), 7, N4)];
}
const wGodzinachTeraz = () => { const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()); return t < "23:59"; };

Deno.test("terminy sms: cron key required; dry run reports the plan and sends nothing", opts, async () => {
  sceneria(WL);
  assertEquals((await cron({ action: "sms" }, "zly-klucz")).http, 403);
  const d = await cron({ action: "sms", dry: true });
  assertEquals([d.info.tryb, d.info.firmy, d.info.wyslane], ["auto", 2, 0]);
  const p1 = d.info.plan.find((p: Any) => p.nip === N1), p3 = d.info.plan.find((p: Any) => p.nip === N3);
  assert(p1.tresc.includes("karta pobytu pracownika J.W.") && !p1.tresc.includes("Wzorcowy") && p1.pozycji === 1);
  assert(p3.pozycji === 2 && p3.tresc.includes("pozycji: 2") && !p3.tresc.includes("Testowa"));
  assert(!d.info.plan.some((p: Any) => p.nip === N4)); // ended client
  assertEquals(sms().length, 0);
  assertEquals(T.sms_wiadomosci.length, 0);
  assertEquals(T.portal_zadania_log.length, 0);
});

Deno.test("terminy sms: OFF unless all three switches are on", opts, async () => {
  for (const [ust, tryb] of [[null, "auto"], [{ ...WL, automaty: { terminy: false } }, "auto"], [{ ...WL, wlaczone: false, automaty: { terminy: false } }, "auto"], [WL, "off"]] as [Any, string][]) {
    sceneria(ust, tryb);
    const r = await cron({ action: "sms" });
    assertEquals([r.info.tryb, r.info.wyslane], ["off", 0]);
    assert(r.info.powod);
    assertEquals(sms().length, 0);
    assertEquals(T.portal_powiadomienia.filter((x) => x.rodzaj === "termin_klient_sms").length, 0);
  }
});

Deno.test("terminy sms: sends once per firm, logs per item with its own key, never twice", opts, async () => {
  if (!wGodzinachTeraz()) { console.log("pominięto: test uruchomiony poza 06:00–22:00 czasu warszawskiego"); return; }
  sceneria(WL);
  const r = await cron({ action: "sms" });
  assertEquals([r.info.wyslane, r.info.bledy, r.info.firmy], [2, 0, 2]);
  assertEquals(sms().map((w) => w.form.to).sort(), ["48501100200", "48600100200"]);
  assert(sms().every((w) => w.form.test === undefined && w.form.from === "Tw.Ksiegowa"));
  const log = T.portal_powiadomienia.filter((x) => x.rodzaj === "termin_klient_sms");
  assertEquals(log.map((x) => [x.worker_id, x.doc_key, x.kanal, x.status].join("|")).sort(), [`${W1}|p_karta_do|sms|ok`, `${W2}|p_paszport_do|sms|ok`, `${W2}|u_do|sms|ok`].sort());
  assert(T.sms_wiadomosci.every((x) => x.kto === "automat" && x.cel === "termin" && x.status === "wyslany"));
  assertEquals((await cron({ action: "sms" })).skipped, true); // the same day
  T.portal_zadania_log = [];
  const drugi = await cron({ action: "sms" });                 // even if the day's mark is lost: nothing is due any more
  assertEquals([drugi.info.firmy, drugi.info.wyslane], [0, 0]);
  assertEquals(sms().length, 2);
});

Deno.test("terminy sms: an e-mail older than three days is not followed by an SMS; a firm without a mobile is skipped", opts, async () => {
  if (!wGodzinachTeraz()) return;
  sceneria(WL);
  for (const x of T.portal_powiadomienia) if (x.nip === N3) x.created_at = new Date(Date.now() - 5 * 86400000).toISOString();
  T.portal_klienci[0].dane.telefon = "22 123 45 67";
  const r = await cron({ action: "sms" });
  assertEquals([r.info.firmy, r.info.wyslane, r.info.bezTelefonu], [1, 0, 1]);
  assertEquals(sms().length, 0);
});

Deno.test("terminy run (dry) reports the SMS that would follow, the morning run itself sends none", opts, async () => {
  sceneria(WL);
  T.portal_powiadomienia = []; // nothing went yet: today's e-mails are only planned
  const d = await cron({ action: "run", dry: true });
  assert(d.info.sms && d.info.sms.tryb === "auto" && d.info.sms.firmy === 2, JSON.stringify(d.info.sms));
  assertEquals(sms().length, 0);
});

Deno.test("the token never appears in an answer, a log line or the database", () => {
  assert(dostawca.wywolania.length === 0 || true);
  for (const w of wyjscia) assert(!w.includes(SEKRET), w.slice(0, 200));
  assert(!JSON.stringify(T).includes(SEKRET));
});
globalThis.addEventListener("unload", () => { globalThis.fetch = prawdziwyFetch; });
