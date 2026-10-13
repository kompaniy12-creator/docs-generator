// deno test -A supabase/functions/_shared/uprawnienia_funkcje_test.ts
// Uprawnienia szczegółowe in the functions that have no test harness of their own: wyslij-komplet, akta,
// translate-docs, vat, wfirma, podpisy (office role) and the `uprawnienia` action of portal-admin.
// Deno.serve is captured and every outgoing request (auth server, database) is answered by an in-memory
// stand-in; anything else (a model, a register, a mail server, wFirma) fails the test. Fictional people only.
import { assert, assertEquals } from "jsr:@std/assert@1";

// deno-lint-ignore no-explicit-any
type Any = any;
Deno.env.set("SUPABASE_URL", "http://db.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("ANTHROPIC_API_KEY", "klucz-modelu-testowy");
for (const k of ["WFIRMA_ACCESS_KEY", "WFIRMA_SECRET_KEY", "WFIRMA_APP_KEY", "SMTP_PASS", "TELEGRAM_BOT_TOKEN"]) Deno.env.delete(k);

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USERS: Record<string, Any> = {};
const osoba = (token: string, meta: Any, id = ID(900 + Object.keys(USERS).length)) => { USERS[token] = { id, email: token + "@example.test", created_at: "2026-01-01T00:00:00Z", last_sign_in_at: null, app_metadata: meta }; return USERS[token]; };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const zadania: { metoda: string; sciezka: string; body: Any; auth: string }[] = [];
globalThis.fetch = (async (input: Any, init: Any = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url), h = new Headers(init.headers ?? {});
  const metoda = String(init.method ?? "GET").toUpperCase(), auth = (h.get("Authorization") ?? "").replace("Bearer ", "");
  if (url.host !== "db.test") throw new Error("nieoczekiwane żądanie na zewnątrz: " + url.host);
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
  if (url.pathname.startsWith("/rest/v1/")) return new Response(metoda === "GET" ? "[]" : "[]", { status: metoda === "POST" ? 201 : 200, headers: { "Content-Type": "application/json", "Content-Range": "*/0" } });
  return J({}, 404);
}) as typeof fetch;

const handlery: ((r: Request) => Response | Promise<Response>)[] = [];
(Deno as Any).serve = (h: Any) => { handlery.push(h); return {}; };
async function laduj(sciezka: string) { const n = handlery.length; await import(sciezka); assertEquals(handlery.length, n + 1, sciezka); return handlery[n]; }
const H = {
  komplet: await laduj("../wyslij-komplet/index.ts"), akta: await laduj("../akta/index.ts"), tlumacz: await laduj("../translate-docs/index.ts"),
  vat: await laduj("../vat/index.ts"), wfirma: await laduj("../wfirma/index.ts"), podpisy: await laduj("../podpisy/index.ts"), admin: await laduj("../portal-admin/index.ts"),
};
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
  // the actions of later phases are behind the page's key only
  kadry(["kadry.podpisy.wyslij"]);
  for (const a of ["link", "link_uniewaznij", "anuluj", "zakoncz", "pakiet"]) wpuszczony(await wolaj("podpisy", "k", { action: a, id: ID(2) }), a);
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
