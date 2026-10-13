// deno test -A supabase/functions/_shared/uprawnienia_funkcje_test.ts
// Uprawnienia szczegółowe in the functions that have no test harness of their own: wyslij-komplet, akta,
// translate-docs, vat, wfirma, podpisy (office role), firma (paid register), zadania (notify), klienci-list
// (contact fields) and the `uprawnienia` action of portal-admin.
// Deno.serve is captured and every outgoing request (auth server, database) is answered by an in-memory
// stand-in; anything else (a model, a register, a mail server, wFirma) fails the test. Fictional people only.
import { assert, assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
type Any = any;
Deno.env.set("SUPABASE_URL", "http://db.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("ANTHROPIC_API_KEY", "klucz-modelu-testowy");
Deno.env.set("REJESTR_IO_KEY", "klucz-rejestru-testowy");
for (const k of ["WFIRMA_ACCESS_KEY", "WFIRMA_SECRET_KEY", "WFIRMA_APP_KEY", "SMTP_PASS", "TELEGRAM_BOT_TOKEN"]) Deno.env.delete(k);

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USERS: Record<string, Any> = {};
const osoba = (token: string, meta: Any, id = ID(900 + Object.keys(USERS).length)) => { USERS[token] = { id, email: token + "@example.test", created_at: "2026-01-01T00:00:00Z", last_sign_in_at: null, app_metadata: meta }; return USERS[token]; };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const zadania: { metoda: string; sciezka: string; body: Any; auth: string }[] = [];
// what the database answers to a GET of a table (by its name); everything else is an empty list
const TABELE: Record<string, Any[]> = {};
// requests that left for the outside world (the paid register): recorded and refused
const naZewnatrz: string[] = [];
globalThis.fetch = (async (input: Any, init: Any = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url), h = new Headers(init.headers ?? {});
  const metoda = String(init.method ?? "GET").toUpperCase(), auth = (h.get("Authorization") ?? "").replace("Bearer ", "");
  if (url.host !== "db.test") { naZewnatrz.push(url.host + url.pathname); throw new Error("nieoczekiwane żądanie na zewnątrz: " + url.host); }
  const body = typeof init.body === "string" ? JSON.parse(init.body || "null") : null;
  zadania.push({ metoda, sciezka: url.pathname + url.search, body, auth });
  if (url.pathname === "/auth/v1/user") { const u = USERS[auth]; return u ? J(u) : J({}, 401); }
  if (url.pathname.startsWith("/auth/v1/admin/users")) {
    if (auth !== "service") return J({}, 401);
    const id = url.pathname.split("/")[5];
    if (!id) return J({ users: Object.values(USERS) });
    const u = Object.values(USERS).find((x) => x.id === id);
    if (!u) return J({}, 404);
    if (metoda === "PUT") {
      // the auth server merges app_metadata key by key; null removes a key
      for (const [k, v] of Object.entries(body.app_metadata ?? {})) { if (v === null) delete u.app_metadata[k]; else u.app_metadata[k] = v; }
    }
    return J(u);
  }
  if (url.pathname.startsWith("/rest/v1/")) return new Response(metoda === "GET" ? JSON.stringify(TABELE[url.pathname.slice(9)] ?? []) : "[]", { status: metoda === "POST" ? 201 : 200, headers: { "Content-Type": "application/json", "Content-Range": "*/0" } });
  return J({}, 404);
}) as typeof fetch;

const handlery: ((r: Request) => Response | Promise<Response>)[] = [];
(Deno as Any).serve = (h: Any) => { handlery.push(h); return {}; };
async function laduj(sciezka: string) { const n = handlery.length; await import(sciezka); assertEquals(handlery.length, n + 1, sciezka); return handlery[n]; }
const H = {
  komplet: await laduj("../wyslij-komplet/index.ts"), akta: await laduj("../akta/index.ts"), tlumacz: await laduj("../translate-docs/index.ts"),
  vat: await laduj("../vat/index.ts"), wfirma: await laduj("../wfirma/index.ts"), podpisy: await laduj("../podpisy/index.ts"), admin: await laduj("../portal-admin/index.ts"),
  firma: await laduj("../firma/index.ts"), zadania: await laduj("../zadania/index.ts"), klienci: await laduj("../klienci-list/index.ts"),
};
// a GET (firma, klienci-list)
async function pobierz(h: keyof typeof H, kto: string | null, query = ""): Promise<Any> {
  const r = await H[h](new Request("http://f.test/" + h + query, { method: "GET", headers: kto ? { Authorization: "Bearer " + kto } : {} }));
  const t = await r.text();
  let b: Any = {}; try { b = JSON.parse(t); } catch { /* not JSON */ }
  return { http: r.status, ...b };
}
async function wolaj(h: keyof typeof H, kto: string | null, body: Any, naglowki: Record<string, string> = {}): Promise<Any> {
  const r = await H[h](new Request("http://f.test/" + h, { method: "POST", headers: { "Content-Type": "application/json", ...(kto ? { Authorization: "Bearer " + kto } : {}), ...naglowki }, body: JSON.stringify(body) }));
  const t = await r.text();
  let b: Any = {}; try { b = JSON.parse(t); } catch { /* not JSON */ }
  return { http: r.status, ...b };
}
const opts = { sanitizeOps: false, sanitizeResources: false };
const odmowa = (r: Any, klucz: string, opis = "") => assertEquals([r.http, r.kod, r.klucz], [403, "wylaczone", klucz], opis);
const wpuszczony = (r: Any, opis = "") => assert(r.kod !== "wylaczone" && r.http !== 403 && r.http !== 401, opis + " -> " + r.http + " " + JSON.stringify(r).slice(0, 120));

// people: Kadry, Księgowość, an administrator — each with the claim under test
const kadry = (wyl?: unknown, o: Any = {}) => osoba("k", { portal: true, portal_sections: ["kadry"], ...(wyl === undefined ? {} : { portal_wylaczone: wyl }), ...o });
const ksieg = (wyl?: unknown, o: Any = {}) => osoba("k", { portal: true, portal_sections: ["onboarding"], ...(wyl === undefined ? {} : { portal_wylaczone: wyl }), ...o });

// [function, who, benign request, its key, a second request guarded by a narrower key?]
const PRZYPADKI: { h: keyof typeof H; kto: typeof kadry; req: Any; klucz: string; przodkowie: string[] }[] = [
  { h: "komplet", kto: kadry, req: { action: "info", id: ID(1) }, klucz: "kadry.zgloszenia", przodkowie: ["kadry"] },
  { h: "komplet", kto: kadry, req: { action: "send", id: ID(1), mail: true }, klucz: "kadry.zgloszenia.wyslij", przodkowie: ["kadry.zgloszenia", "kadry"] },
  { h: "akta", kto: kadry, req: { action: "rozpoznaj", id: "zly" }, klucz: "kadry.akta.ai", przodkowie: ["kadry.akta", "kadry"] },
  { h: "tlumacz", kto: kadry, req: { target: "xx", strings: [] }, klucz: "kadry.tlumaczenie", przodkowie: ["kadry"] },
  { h: "vat", kto: ksieg, req: { action: "vies" }, klucz: "ksiegowosc.narzedzia.vies", przodkowie: ["ksiegowosc.narzedzia", "ksiegowosc"] },
  { h: "vat", kto: ksieg, req: { action: "wl_search" }, klucz: "ksiegowosc.narzedzia.biala_lista", przodkowie: ["ksiegowosc.narzedzia", "ksiegowosc"] },
  { h: "vat", kto: ksieg, req: { action: "wl_check" }, klucz: "ksiegowosc.narzedzia.biala_lista", przodkowie: ["ksiegowosc.narzedzia"] },
  { h: "wfirma", kto: kadry, req: { action: "ping" }, klucz: "kadry.komplet.wfirma", przodkowie: ["kadry.komplet", "kadry"] },
  { h: "wfirma", kto: kadry, req: { action: "companies" }, klucz: "kadry.komplet.wfirma", przodkowie: ["kadry.komplet"] },
  { h: "podpisy", kto: kadry, req: { action: "lista" }, klucz: "kadry.podpisy", przodkowie: ["kadry"] },
  { h: "podpisy", kto: kadry, req: { action: "pakiet", id: ID(2) }, klucz: "kadry.podpisy", przodkowie: ["kadry"] },
  { h: "podpisy", kto: kadry, req: { action: "utworz" }, klucz: "kadry.podpisy.wyslij", przodkowie: ["kadry.podpisy", "kadry"] },
  { h: "podpisy", kto: kadry, req: { action: "wydaj", id: ID(2) }, klucz: "kadry.podpisy.wyslij", przodkowie: ["kadry.podpisy"] },
  { h: "podpisy", kto: kadry, req: { action: "dokument_dodaj", id: ID(2) }, klucz: "kadry.podpisy.wyslij", przodkowie: ["kadry.podpisy"] },
  { h: "podpisy", kto: kadry, req: { action: "dokument_usun", id: ID(2), dokument: ID(3) }, klucz: "kadry.podpisy.wyslij", przodkowie: ["kadry.podpisy"] },
  // phase 2: the worker's link, the signed files and their verification, cancelling
  { h: "podpisy", kto: kadry, req: { action: "link", id: ID(2) }, klucz: "kadry.podpisy.link", przodkowie: ["kadry.podpisy", "kadry"] },
  { h: "podpisy", kto: kadry, req: { action: "link_uniewaznij", id: ID(2) }, klucz: "kadry.podpisy.link", przodkowie: ["kadry.podpisy"] },
  { h: "podpisy", kto: kadry, req: { action: "wgraj", dokument: ID(3), strona: "pracodawca" }, klucz: "kadry.podpisy.weryfikacja", przodkowie: ["kadry.podpisy", "kadry"] },
  { h: "podpisy", kto: kadry, req: { action: "weryfikuj", dokument: ID(3), strona: "pracownik" }, klucz: "kadry.podpisy.weryfikacja", przodkowie: ["kadry.podpisy"] },
  { h: "podpisy", kto: kadry, req: { action: "zakoncz", id: ID(2) }, klucz: "kadry.podpisy.weryfikacja", przodkowie: ["kadry.podpisy"] },
  { h: "podpisy", kto: kadry, req: { action: "anuluj", id: ID(2) }, klucz: "kadry.podpisy.anuluj", przodkowie: ["kadry.podpisy", "kadry"] },
];

for (const p of PRZYPADKI) {
  Deno.test(`uprawnienia ${p.h} ${p.req.action ?? "tłumaczenie"}: brak listy = jak dotąd; klucz ${p.klucz}, przodek i zepsuta lista -> 403 z kodem; administrator bez ograniczeń`, opts, async () => {
    // no claim, null, an empty list, keys of other pages, a look-alike prefix: let in, and all with the same answer
    p.kto();
    const wzor = await wolaj(p.h, "k", p.req);
    wpuszczony(wzor, "bez listy");
    for (const wyl of [null, [], ["ogolne.zadania", "klienci.sms", p.klucz + "x", p.klucz.slice(0, -1)]]) {
      p.kto(wyl);
      const r = await wolaj(p.h, "k", p.req);
      assertEquals(JSON.stringify(r), JSON.stringify(wzor), "ta sama odpowiedź: " + JSON.stringify(wyl));
    }
    // the key itself, each ancestor, a broken claim
    p.kto([p.klucz]); odmowa(await wolaj(p.h, "k", p.req), p.klucz, "klucz");
    for (const a of p.przodkowie) { p.kto([a]); odmowa(await wolaj(p.h, "k", p.req), p.klucz, "przodek " + a); }
    for (const zle of ["tekst", {}, 1, true]) { p.kto(zle); odmowa(await wolaj(p.h, "k", p.req), p.klucz, "zepsuta " + JSON.stringify(zle)); }
    // a refusal comes before anything is read from the database
    p.kto([p.klucz]); zadania.length = 0;
    await wolaj(p.h, "k", p.req);
    assertEquals(zadania.map((z) => z.sciezka), ["/auth/v1/user"]);
    // an administrator: never restricted
    for (const wyl of [[p.klucz], p.przodkowie, "tekst"]) { p.kto(wyl, { portal_admin: true }); wpuszczony(await wolaj(p.h, "k", p.req), "administrator " + JSON.stringify(wyl)); }
    // the section check stays in front of the list, and without a session nothing changes
    osoba("k", { portal: true, portal_sections: ["rejestracja"], portal_wylaczone: [p.klucz] });
    const bezSekcji = await wolaj(p.h, "k", p.req);
    assertEquals([bezSekcji.http, bezSekcji.kod], [403, undefined]);
    const anonim = await wolaj(p.h, null, p.req);
    assert([401, 403].includes(anonim.http) && anonim.kod === undefined);
  });
}

Deno.test("uprawnienia: wyłączona wysyłka kompletu nie zamyka podglądu zgłoszenia; wyłączony VIES nie zamyka białej listy", opts, async () => {
  kadry(["kadry.zgloszenia.wyslij"]);
  wpuszczony(await wolaj("komplet", "k", { action: "info", id: ID(1) }));
  wpuszczony(await wolaj("komplet", "k", { action: "test_mail" }));
  ksieg(["ksiegowosc.narzedzia.vies"]);
  wpuszczony(await wolaj("vat", "k", { action: "wl_search" }));
  odmowa(await wolaj("vat", "k", { action: "vies" }), "ksiegowosc.narzedzia.vies");
  ksieg(["ksiegowosc.narzedzia.biala_lista"]);
  wpuszczony(await wolaj("vat", "k", { action: "vies" }));
  // an unknown action is still "unknown action", not a refusal that would hint at a hidden function
  assertEquals((await wolaj("vat", "k", { action: "nie_ma" })).http, 400);
  // action names that are properties of every object are unknown actions like any other — for a person without a
  // list exactly as before this feature existed
  for (const lista of [undefined, ["kadry.podpisy.wyslij", "kadry.zgloszenia.wyslij"]]) {
    kadry(lista);
    const wzorP = await wolaj("podpisy", "k", { action: "nie_ma_takiej" }), wzorK = await wolaj("komplet", "k", { action: "nie_ma_takiej", id: ID(1) });
    assert(wzorP.http !== 403 && wzorK.http !== 403);
    for (const a of ["constructor", "__proto__", "toString"]) {
      assertEquals(JSON.stringify(await wolaj("podpisy", "k", { action: a })), JSON.stringify(wzorP), "podpisy " + a);
      assertEquals(JSON.stringify(await wolaj("komplet", "k", { action: a, id: ID(1) })), JSON.stringify(wzorK), "komplet " + a);
    }
  }
});

Deno.test("uprawnienia podpisy: tylko rola biura — link pracownika, sesja pracodawcy i `reguly` nie przechodzą przez listę", opts, async () => {
  kadry(["kadry"]);
  // the worker's link (x-podpis-token): judged as a link, the portal session beside it is not even looked at
  zadania.length = 0;
  const link = await wolaj("podpisy", "k", { action: "podglad" }, { "x-podpis-token": "A".repeat(48) });
  assertEquals([link.http, link.kod], [401, "link"]);
  assert(!zadania.some((z) => z.sciezka === "/auth/v1/user"));
  // the employer's session (x-klient-token): unknown session -> its own answer
  zadania.length = 0;
  const klient = await wolaj("podpisy", "k", { action: "lista" }, { "x-klient-token": "B".repeat(48) });
  assertEquals([klient.http, klient.wyloguj, klient.kod], [401, true, undefined]);
  assert(!zadania.some((z) => z.sciezka === "/auth/v1/user"));
  // the rules are public reading: open to a restricted person and to a stranger alike
  assertEquals((await wolaj("podpisy", "k", { action: "reguly" })).http, 200);
  assertEquals((await wolaj("podpisy", null, { action: "reguly" })).http, 200);
  // each function of the module has its own key: one switched off leaves the others alone
  kadry(["kadry.podpisy.wyslij"]);
  for (const a of ["link", "link_uniewaznij", "anuluj", "zakoncz", "pakiet"]) wpuszczony(await wolaj("podpisy", "k", { action: a, id: ID(2) }), a);
  kadry(["kadry.podpisy.link", "kadry.podpisy.anuluj", "kadry.podpisy.weryfikacja"]);
  for (const a of ["lista", "utworz", "wydaj", "pakiet"]) wpuszczony(await wolaj("podpisy", "k", { action: a, id: ID(2) }), a);
  // looking at a file is reading (the page's key), uploading a signed one is not
  wpuszczony(await wolaj("podpisy", "k", { action: "plik", dokument: ID(3) }), "plik");
  odmowa(await wolaj("podpisy", "k", { action: "wgraj", dokument: ID(3) }), "kadry.podpisy.weryfikacja");
});

// ---------------------------------------------------------------- portal-admin
const szef = () => osoba("szef", { portal: true, portal_admin: true }, ID(1));
const cel = (meta: Any = {}) => osoba("cel", { portal: true, portal_sections: ["kadry"], inna_aplikacja: { rola: "x" }, ...meta }, ID(2));
Deno.test("portal-admin uprawnienia: tylko administrator; walidacja; zapis samego klucza; dziennik; koniec sesji", opts, async () => {
  szef(); const c = cel(); kadry();
  // not an administrator / no session
  assertEquals((await wolaj("admin", "k", { action: "uprawnienia", id: c.id, wylaczone: [] })).http, 403);
  assertEquals((await wolaj("admin", null, { action: "uprawnienia", id: c.id, wylaczone: [] })).http, 403);
  assertEquals((await wolaj("admin", "k", { action: "historia_dostepu" })).http, 403);
  // an administrator restricted by a list is still an administrator here
  osoba("szef", { portal: true, portal_admin: true, portal_wylaczone: ["ogolne"] }, ID(1));
  assertEquals((await wolaj("admin", "szef", { action: "list" })).http, 200);
  szef();
  // unknown keys, administrator-only entries, not a list, too long
  for (const zle of [["nie.ma.takiego"], ["kadry.akta", "ogolne.dostep"], "kadry", { a: 1 }, [7], Array(1500).fill("kadry.akta")]) {
    zadania.length = 0;
    const r = await wolaj("admin", "szef", { action: "uprawnienia", id: c.id, wylaczone: zle });
    assertEquals(r.http, 400, JSON.stringify(zle).slice(0, 40));
    assert(!zadania.some((z) => z.metoda === "PUT"), "nic nie zapisano");
  }
  assertEquals(c.app_metadata.portal_wylaczone, undefined);
  // a valid list: normalised, sorted, written as the ONLY key of the request
  zadania.length = 0;
  const ok = await wolaj("admin", "szef", { action: "uprawnienia", id: c.id, wylaczone: ["poczta.kadry", "kadry.akta.ai", "kadry.akta", "poczta.kadry"], szablon: "kadrowa" });
  assertEquals([ok.http, ok.wylaczone], [200, ["kadry.akta", "poczta.kadry"]]);
  const put = zadania.filter((z) => z.metoda === "PUT");
  assertEquals(put.map((z) => [z.sciezka, z.body, z.auth]), [["/auth/v1/admin/users/" + c.id, { app_metadata: { portal_wylaczone: ["kadry.akta", "poczta.kadry"] } }, "service"]]);
  // nothing else of app_metadata was touched
  assertEquals(c.app_metadata, { portal: true, portal_sections: ["kadry"], inna_aplikacja: { rola: "x" }, portal_wylaczone: ["kadry.akta", "poczta.kadry"] });
  // the audit row and the end of the person's sessions
  const hist = zadania.find((z) => z.sciezka === "/rest/v1/portal_pracownicy_historia" && z.metoda === "POST")!;
  assertEquals(hist.body, { email: "cel@example.test", kto: "szef@example.test", op: "dostep", zmiany: { wylaczone_dodano: ["kadry.akta", "poczta.kadry"], wylaczone_usunieto: [], szablon: "kadrowa" } });
  const sesje = zadania.find((z) => z.sciezka === "/rest/v1/rpc/portal_zakoncz_sesje")!;
  assertEquals(sesje.body, { p_user: c.id });
  assert(zadania.indexOf(put[0]) < zadania.indexOf(hist) && zadania.indexOf(hist) < zadania.indexOf(sesje));
  // the list shows it
  const lista = await wolaj("admin", "szef", { action: "list" });
  const w = lista.users.find((u: Any) => u.id === c.id);
  assertEquals([w.wylaczone, w.wylaczone_blad, w.sections], [["kadry.akta", "poczta.kadry"], false, ["kadry"]]);
  assertEquals(lista.users.find((u: Any) => u.id === ID(1)).wylaczone, []);
  // the same list again: nothing is written, nobody is signed out
  zadania.length = 0;
  const znowu = await wolaj("admin", "szef", { action: "uprawnienia", id: c.id, wylaczone: ["kadry.akta", "poczta.kadry"] });
  assertEquals([znowu.http, znowu.bez_zmian], [200, true]);
  assert(!zadania.some((z) => z.metoda === "PUT" || z.sciezka.includes("portal_zakoncz_sesje")));
  // a change: what was added and what was taken off; sections together with the list in one write
  zadania.length = 0;
  const zm = await wolaj("admin", "szef", { action: "uprawnienia", id: c.id, wylaczone: ["kadry.akta", "klienci.sms"], sections: ["kadry", "onboarding", "wymyslona"] });
  assertEquals(zm.http, 200);
  assertEquals(zadania.filter((z) => z.metoda === "PUT").map((z) => z.body), [{ app_metadata: { portal_wylaczone: ["kadry.akta", "klienci.sms"], portal_sections: ["kadry", "onboarding"] } }]);
  assertEquals(zadania.find((z) => z.sciezka === "/rest/v1/portal_pracownicy_historia")!.body.zmiany, { wylaczone_dodano: ["klienci.sms"], wylaczone_usunieto: ["poczta.kadry"], sekcje: ["kadry", "onboarding"] });
  // an empty list removes the claim altogether (the account is again as an unrestricted one)
  const pusto = await wolaj("admin", "szef", { action: "uprawnienia", id: c.id, wylaczone: [] });
  assertEquals(pusto.http, 200);
  assertEquals(c.app_metadata, { portal: true, portal_sections: ["kadry", "onboarding"], inna_aplikacja: { rola: "x" } });
  // a broken claim is repaired by saving, and the audit says so
  c.app_metadata.portal_wylaczone = "zepsute";
  assertEquals((await wolaj("admin", "szef", { action: "list" })).users.find((u: Any) => u.id === c.id).wylaczone_blad, true);
  zadania.length = 0;
  assertEquals((await wolaj("admin", "szef", { action: "uprawnienia", id: c.id, wylaczone: [] })).http, 200);
  assertEquals(c.app_metadata.portal_wylaczone, undefined);
  assertEquals(zadania.find((z) => z.sciezka === "/rest/v1/portal_pracownicy_historia")!.body.zmiany.naprawiono_liste, true);
});

Deno.test("portal-admin uprawnienia: nie dla administratora, nie dla siebie, nie dla konta spoza portalu; historia_dostepu", opts, async () => {
  const s = szef(); cel();
  const adm2 = osoba("adm2", { portal: true, portal_admin: true }, ID(3));
  const obcy = osoba("obcy", { inna: true }, ID(4));
  for (const [id, http] of [[s.id, 400], [adm2.id, 400], [obcy.id, 404], [ID(77), 404], ["nie-uuid", 404]] as [string, number][]) {
    zadania.length = 0;
    const r = await wolaj("admin", "szef", { action: "uprawnienia", id, wylaczone: ["kadry.akta"] });
    assertEquals(r.http, http, id);
    assert(!zadania.some((z) => z.metoda === "PUT" || z.sciezka.includes("portal_zakoncz_sesje") || z.sciezka.includes("historia")), id);
  }
  assertEquals([s.app_metadata.portal_wylaczone, adm2.app_metadata.portal_wylaczone, obcy.app_metadata.portal_wylaczone], [undefined, undefined, undefined]);
  zadania.length = 0;
  const h = await wolaj("admin", "szef", { action: "historia_dostepu" });
  assertEquals([h.http, h.historia], [200, []]);
  assertEquals(zadania.at(-1)!.sciezka, "/rest/v1/portal_pracownicy_historia?op=eq.dostep&select=at,email,kto,zmiany&order=id.desc&limit=200");
  // the older actions keep their shape: sections alone still writes sections alone
  zadania.length = 0;
  assertEquals((await wolaj("admin", "szef", { action: "sections", id: ID(2), sections: ["kadry"] })).http, 200);
  assertEquals(zadania.filter((z) => z.metoda === "PUT").map((z) => z.body), [{ app_metadata: { portal_sections: ["kadry"] } }]);
});

// ---------------------------------------------------------------- firma: the paid register (wspolne.krs)
const NIP_W_BAZIE = "5250000001", NIP_STARY = "5250000002", NIP_OBCY = "5250000003", KRS_W_BAZIE = "0000123456";
Deno.test("uprawnienia firma: wyłączone „płatne pobieranie z KRS” = tylko to, co już jest w bazie; szukanie i nowe firmy odmawiane; reszta jak dotąd", opts, async () => {
  // the cache as PostgREST would filter it: a current record, an old-version record, nothing for the third firm
  const cache = (nip: string) => nip === NIP_W_BAZIE ? [{ v: "2", found: null, nip, data: { v: 2, nip, nazwa: "Przykładowa Firma Testowa Sp. z o.o." }, fetched_at: "2026-01-01T00:00:00Z" }]
    : nip === NIP_STARY ? [{ v: "1", found: null, nip, data: { v: 1, nip }, fetched_at: "2025-01-01T00:00:00Z" }] : [];
  const stary = globalThis.fetch;
  globalThis.fetch = (async (input: Any, init: Any = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.host === "db.test" && url.pathname === "/rest/v1/portal_firmy_cache" && String(init.method ?? "GET").toUpperCase() === "GET") {
      zadania.push({ metoda: "GET", sciezka: url.pathname + url.search, body: null, auth: "" });
      return J(cache((url.searchParams.get("nip") ?? "").replace("eq.", "")));
    }
    if (url.host === "db.test" && url.pathname === "/rest/v1/portal_odpisy_cache" && String(init.method ?? "GET").toUpperCase() === "GET") {
      const jest = (url.searchParams.get("krs") ?? "") === "eq." + KRS_W_BAZIE;
      return new Response(JSON.stringify(jest ? [{ krs: KRS_W_BAZIE, pdf: "JVBERi0=", fetched_at: "2026-01-01T00:00:00Z" }] : []), { status: 200, headers: { "Content-Type": "application/json", "Content-Range": "0-0/0" } });
    }
    return stary(input, init);
  }) as typeof fetch;
  try {
    const bez = (wyl?: unknown, o: Any = {}) => osoba("k", { portal: true, portal_sections: ["kadry", "biezaca"], ...(wyl === undefined ? {} : { portal_wylaczone: wyl }), ...o });
    // nobody without a session; a person without a list: the cache answers, the register is asked for the rest
    assertEquals((await pobierz("firma", null, "?nip=" + NIP_W_BAZIE)).http, 403);
    for (const wyl of [undefined, null, [], ["wspolne.krsx", "wspolne.historia.usun", "kadry.akta"]]) {
      bez(wyl); naZewnatrz.length = 0;
      const z = await pobierz("firma", "k", "?nip=" + NIP_W_BAZIE);
      assertEquals([z.http, z.z_pamieci, z.nazwa], [200, true, "Przykładowa Firma Testowa Sp. z o.o."], JSON.stringify(wyl));
      assertEquals(naZewnatrz.length, 0);
      assertEquals((await pobierz("firma", "k", "?nip=" + NIP_OBCY)).http, 502, "rejestr zapytany (w teście: nieosiągalny)");
      assertEquals((await pobierz("firma", "k", "?q=przyklad")).http, 502);
      assertEquals((await pobierz("firma", "k", "?odpis=0000999999")).http, 502);
      assert(naZewnatrz.length >= 3 && naZewnatrz.every((x) => x.startsWith("rejestr.io")), naZewnatrz.join());
    }
    // the key, its ancestor, a broken list: what is in our base is served, nothing is ever asked of the register
    for (const wyl of [["wspolne.krs"], ["wspolne"], "tekst", {}]) {
      bez(wyl); naZewnatrz.length = 0;
      const z = await pobierz("firma", "k", "?nip=" + NIP_W_BAZIE);
      assertEquals([z.http, z.z_pamieci], [200, true], "z bazy: " + JSON.stringify(wyl));
      const o = await pobierz("firma", "k", "?odpis=" + KRS_W_BAZIE);
      assertEquals([o.http, o.z_pamieci], [200, true], "odpis z bazy");
      odmowa(await pobierz("firma", "k", "?nip=" + NIP_OBCY), "wspolne.krs", "nowa firma");
      odmowa(await pobierz("firma", "k", "?nip=" + NIP_STARY), "wspolne.krs", "rekord starej wersji = płatne odświeżenie");
      odmowa(await pobierz("firma", "k", "?krs=0000999999"), "wspolne.krs", "po KRS");
      odmowa(await pobierz("firma", "k", "?q=przyklad"), "wspolne.krs", "szukanie");
      odmowa(await pobierz("firma", "k", "?odpis=0000999999"), "wspolne.krs", "nowy odpis");
      odmowa(await pobierz("firma", "k", "?nip=" + NIP_OBCY + "&fresh=1"), "wspolne.krs", "fresh");
      assertEquals(naZewnatrz, [], "rejestr nie został zapytany");
    }
    // a refused search reads nothing at all
    bez(["wspolne.krs"]); zadania.length = 0;
    await pobierz("firma", "k", "?q=przyklad");
    assertEquals(zadania.map((z) => z.sciezka), ["/auth/v1/user"]);
    // an administrator is never restricted
    bez(["wspolne"], { portal_admin: true }); naZewnatrz.length = 0;
    assertEquals((await pobierz("firma", "k", "?nip=" + NIP_OBCY)).http, 502);
    assert(naZewnatrz.length >= 1);
  } finally { globalThis.fetch = stary; }
});

// ---------------------------------------------------------------- zadania: the Telegram push (ogolne.zadania.powiadom)
Deno.test("uprawnienia zadania: wyłączone powiadomienia Telegram odmawiają `notify`; lista zespołu i harmonogram bez zmian", opts, async () => {
  const kto = (wyl?: unknown, o: Any = {}) => osoba("k", { portal: true, portal_sections: ["onboarding"], ...(wyl === undefined ? {} : { portal_wylaczone: wyl }), ...o });
  kto();
  const wzorN = await wolaj("zadania", "k", { action: "notify", id: ID(5), event: "new" }), wzorT = await wolaj("zadania", "k", { action: "team" });
  assertEquals([wzorN.http, wzorN.ok, wzorT.http], [200, false, 200]);
  for (const wyl of [null, [], ["ogolne.zadania.powiadomx", "ogolne.zadania.usun", "poczta"]]) {
    kto(wyl);
    assertEquals(JSON.stringify(await wolaj("zadania", "k", { action: "notify", id: ID(5), event: "new" })), JSON.stringify(wzorN), JSON.stringify(wyl));
  }
  for (const wyl of [["ogolne.zadania.powiadom"], ["ogolne.zadania"], ["ogolne"]]) {
    kto(wyl); zadania.length = 0;
    odmowa(await wolaj("zadania", "k", { action: "notify", id: ID(5), event: "new" }), "ogolne.zadania.powiadom", JSON.stringify(wyl));
    assertEquals(zadania.map((z) => z.sciezka), ["/auth/v1/user"], "nic nie odczytano");
    // the team list feeds the pickers of other pages: it has no key
    assertEquals((await wolaj("zadania", "k", { action: "team" })).http, 200);
  }
  // a list that cannot be read closes every action; an administrator is never restricted
  kto("tekst");
  for (const a of ["notify", "team", "settings", "test"]) assertEquals([(await wolaj("zadania", "k", { action: a, id: ID(5) })).kod], ["wylaczone"], a);
  kto(["ogolne"], { portal_admin: true });
  assertEquals((await wolaj("zadania", "k", { action: "notify", id: ID(5), event: "new" })).http, 200);
  // the scheduler's branch is decided by its own key, before any session is looked at
  kto(["ogolne"]); zadania.length = 0;
  const cron = await wolaj("zadania", "k", { action: "run", dry: true });
  assertEquals([cron.http, cron.kod], [403, undefined]);
  assertEquals(zadania.length, 0);
  assertEquals((await wolaj("zadania", null, { action: "notify", id: ID(5) })).http, 403);
});

// ---------------------------------------------------------------- klienci-list: the pickers' list and the contact fields
Deno.test("uprawnienia klienci-list: lista działa także bez „Bazy klientów”; dane kontaktowe tylko dla Kadr z włączonym kluczem; Księgowość dostaje listę bez kontaktów", opts, async () => {
  TABELE.portal_klienci = [
    { dane: { poz: 2, nazwa: "Druga Testowa S.A.", nip: "0000000002", adres: "ul. Testowa 2", forma: "S.A.", opodatkowanie: "CIT", telefon: "+48 600 000 002", email: "druga@example.test", kontakt: "Anna Testowa", miasto: "Kraków", opiekun: "AT", kadrowy: "", telegram: "-100200", jezyk: "ru" } },
    { dane: { poz: 1, nazwa: "Przykładowa Firma Testowa Sp. z o.o.", nip: "0000000001", adres: "ul. Testowa 1", forma: "sp. z o.o.", opodatkowanie: "CIT", telefon: "600000001", email: "biuro@example.test", kontakt: "Jan Testowy", miasto: "Warszawa", opiekun: "JT", kadrowy: "KH", telegram: "-100100", jezyk: "pl" } },
  ];
  try {
    const KONTAKT = ["telefon", "email", "kontakt", "telegram", "jezyk"], RESZTA = ["nazwa", "nip", "adres", "forma", "opodatkowanie", "miasto", "opiekun", "kadrowy"];
    const pelne = (r: Any) => { assertEquals([r.http, r.kontakty, r.clients.length], [200, true, 2]); assertEquals([r.clients[0].nazwa, r.clients[0].telefon, r.clients[0].email, r.clients[0].telegram, r.clients[1].kontakt], ["Przykładowa Firma Testowa Sp. z o.o.", "600000001", "biuro@example.test", "-100100", "Anna Testowa"]); };
    const bezKontaktow = (r: Any, opis: string) => {
      assertEquals([r.http, r.kontakty, r.clients.length], [200, false, 2], opis);
      for (const c of r.clients) { for (const p of KONTAKT) assertEquals(c[p], "", opis + " " + p); for (const p of RESZTA) assert(typeof c[p] === "string", p); }
      assertEquals([r.clients[0].nazwa, r.clients[0].nip, r.clients[0].opiekun, r.clients[0].adres], ["Przykładowa Firma Testowa Sp. z o.o.", "0000000001", "JT", "ul. Testowa 1"], opis);
      assert(!/example\.test|600000001|600 000 002|-100100|Jan Testowy|Anna Testowa/.test(JSON.stringify(r)), opis + ": dane kontaktowe w odpowiedzi");
    };
    // Kadry without a list, with an empty one, with other keys — and with the PAGE "Baza klientów" switched off: all as today
    for (const wyl of [undefined, null, [], ["klienci.baza.kontaktyx", "klienci.sms"]]) { kadry(wyl); pelne(await pobierz("klienci", "k")); }
    osoba("k", { portal: true }); pelne(await pobierz("klienci", "k"));                       // no sections list = every section
    osoba("k", { portal: true, portal_admin: true, portal_wylaczone: ["klienci"] }); pelne(await pobierz("klienci", "k"));
    // the contact key, the page above it and the module: the list stays (the pickers need it), the contacts go
    for (const wyl of [["klienci.baza.kontakty"], ["klienci.baza"], ["klienci"]]) { kadry(wyl); bezKontaktow(await pobierz("klienci", "k"), JSON.stringify(wyl)); }
    // Księgowość alone: served now (it was a 403), never with contact data — whatever its list says
    for (const wyl of [undefined, [], ["klienci.baza.kontakty"]]) { ksieg(wyl); bezKontaktow(await pobierz("klienci", "k"), "księgowość " + JSON.stringify(wyl)); }
    // both sections: contacts come with Kadry
    osoba("k", { portal: true, portal_sections: ["kadry", "onboarding"] }); pelne(await pobierz("klienci", "k"));
    // no section of the two, no portal, no session: as before
    for (const meta of [{ portal: true, portal_sections: ["rejestracja", "biezaca", "legalizacja"] }, { portal: true, portal_sections: [] }, { portal_sections: ["kadry"] }, {}]) {
      osoba("k", meta); zadania.length = 0;
      const r = await pobierz("klienci", "k");
      assertEquals([r.http, r.clients, r.kod], [403, undefined, undefined], JSON.stringify(meta));
      assertEquals(zadania.map((z) => z.sciezka), ["/auth/v1/user"]);
    }
    assertEquals((await pobierz("klienci", null)).http, 403);
    // a list that cannot be read: nothing at all
    for (const zle of ["tekst", {}, 1]) { kadry(zle); zadania.length = 0; const r = await pobierz("klienci", "k"); assertEquals([r.http, r.kod, r.clients], [403, "wylaczone", undefined]); assertEquals(zadania.map((z) => z.sciezka), ["/auth/v1/user"]); }
  } finally { delete TABELE.portal_klienci; }
});
