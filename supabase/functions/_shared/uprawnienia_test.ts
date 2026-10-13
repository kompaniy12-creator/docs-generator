// deno test -A supabase/functions/_shared/uprawnienia_test.ts
// The catalogue of Uprawnienia szczegółowe as the edge functions see it: the copy is the portal's file, the rules
// hold, every key a function checks exists, every guarded page has a key. No network, no database.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { etykieta, KLUCZE, kluczAkcji, mozna, normalizuj, odmowa, type Upr, wylaczone, znany } from "./uprawnienia.ts";
import { ASYSTENCI } from "../asystent/definicje.ts";
import { SKRZYNKI } from "../poczta/logic.ts";
import { FUNKCJE_SKRZYNKI } from "../poczta/core.ts";
import { MAGAZYN_KLUCZE, NARZEDZIA } from "../asystent/narzedzia.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const U = (globalThis as Any).Uprawnienia;
const plik = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));

Deno.test("kopia w _shared jest identyczna z /uprawnienia.js portalu", async () => {
  assertEquals(await plik("./uprawnienia.js"), await plik("../../../uprawnienia.js"), "skopiuj ponownie: cp uprawnienia.js supabase/functions/_shared/");
});

Deno.test("wylaczone(): brak listy = nic; lista = lista; cokolwiek innego = błąd (wszystko zamknięte)", () => {
  for (const m of [undefined, null, {}, { portal: true }, { portal_wylaczone: null }, { portal_wylaczone: undefined }]) assertEquals(wylaczone(m), []);
  assertEquals(wylaczone({ portal_wylaczone: [] }), []);
  assertEquals(wylaczone({ portal_wylaczone: ["kadry.akta", 5, "", null, "poczta"] }), ["kadry.akta", "poczta"]);
  for (const zle of ["kadry", 0, 1, true, false, {}, { 0: "kadry" }]) assertEquals(wylaczone({ portal_wylaczone: zle }), "blad", JSON.stringify(zle));
  assertEquals(wylaczone("tekst"), []);
});

Deno.test("mozna(): klucz, przodek, podobny prefiks, potomek, zepsuta lista, administrator", () => {
  const c = (wyl: Upr["wyl"], admin = false): Upr => ({ admin, wyl });
  assert(mozna(c([]), "kadry.kontrola"));
  assert(!mozna(c(["kadry.kontrola"]), "kadry.kontrola"));
  assert(!mozna(c(["kadry.kontrola"]), "kadry.kontrola.przypomnienia"));
  assert(!mozna(c(["kadry"]), "kadry.kontrola.przypomnienia"));
  assert(mozna(c(["kadry.kontrola.przypomnienia"]), "kadry.kontrola"), "wyłączona funkcja nie zamyka strony");
  assert(mozna(c(["kadry.kont"]), "kadry.kontrola"), "prefiks bez kropki nie jest przodkiem");
  assert(mozna(c(["kadry.kontrola2"]), "kadry.kontrola"));
  assert(mozna(c(["poczta", "klienci.sms"]), "kadry.kontrola"));
  assert(!mozna(c("blad"), "kadry.kontrola"));
  assert(!mozna(c("blad"), "cokolwiek"));
  assert(mozna(c("blad", true), "kadry.kontrola"));
  assert(mozna(c(["kadry"], true), "kadry.kontrola"));
  // nothing but a list is ever a permission, and an empty key is never allowed
  assert(!mozna({ admin: false, wyl: undefined as Any }, "kadry.kontrola"));
  assert(!mozna({ admin: false, wyl: null as Any }, "kadry.kontrola"));
  assert(!mozna({ admin: "true" as Any, wyl: "blad" }, "kadry.kontrola"));
  assert(!mozna(c([]), ""));
  assert(!mozna(null as Any, "kadry.kontrola"));
});

Deno.test("kluczAkcji(): tylko własne wpisy tabeli — „constructor” i „__proto__” to zwykłe nieznane akcje", () => {
  const mapa = { wyslij: "klienci.sms.wyslij" };
  assertEquals(kluczAkcji(mapa, "wyslij", "klienci.sms"), "klienci.sms.wyslij");
  for (const a of ["status", "constructor", "__proto__", "toString", "hasOwnProperty", "", undefined, null, 5, {}, ["wyslij"]]) assertEquals(kluczAkcji(mapa, a, "klienci.sms"), "klienci.sms", String(a));
});

Deno.test("odmowa(): treść odmowy z nazwą funkcji, kodem i kluczem", () => {
  assertEquals(odmowa("kadry.kontrola.przypomnienia"), { error: "Ta funkcja jest wyłączona dla Twojego konta: Kadry › Kontrola › Wysyłanie przypomnień do klienta.", kod: "wylaczone", klucz: "kadry.kontrola.przypomnienia" });
  assertEquals(odmowa("asystenci.nieznany").kod, "wylaczone");
  assertEquals(etykieta("poczta.kadry"), "Poczta › Skrzynka Kadry");
});

Deno.test("normalizuj(): tylko znane klucze, bez powtórek, potomek znika przy przodku, sortowanie, limit; funkcje administratora nie wchodzą na listę", () => {
  assertEquals(normalizuj(null), { ok: true, lista: [] });
  assertEquals(normalizuj([]), { ok: true, lista: [] });
  assertEquals(normalizuj(["poczta.kadry", "kadry.akta.ai", "kadry.akta", "poczta.kadry", "kadry.akta.usun"]), { ok: true, lista: ["kadry.akta", "poczta.kadry"] });
  for (const zle of [["nie.ma"], ["kadry.akta", "KADRY"], [5], [null], [""], ["kadry.akta "], ["ogolne.pulpit"], ["klienci.umowy"], ["ogolne.dostep"], ["__proto__"], ["constructor"], ["toString"]]) assertEquals(normalizuj(zle).ok, false, JSON.stringify(zle));
  for (const zle of ["kadry", {}, 5, true]) assertEquals(normalizuj(zle).ok, false);
  assertEquals(normalizuj(Array(2000).fill("kadry")).ok, false);
  // every non-admin key at once collapses to the modules and stays far below the cap
  const wszystko = normalizuj(KLUCZE.filter(znany));
  assert(wszystko.ok && wszystko.lista.length <= 12 && JSON.stringify(wszystko.lista).length < U.MAX_BAJTOW);
  // the leaves alone (no ancestors) must fit too — otherwise an administrator could not untick everything by hand
  const liscie = normalizuj(U.LISTA.filter((n: Any) => !n.dzieci.length && !n.tylkoAdmin).map((n: Any) => n.klucz));
  assert(liscie.ok && liscie.lista.length <= U.MAX_KLUCZY, "liście mieszczą się w limicie");
});

Deno.test("katalog: klucze są poprawne, każdy ma rodzica, szablony są znormalizowane, status odpowiada fazie", () => {
  assert(KLUCZE.length >= 95);
  for (const k of KLUCZE) assert(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,2}$/.test(k), k);
  assertEquals(new Set(KLUCZE).size, KLUCZE.length);
  for (const n of U.LISTA) {
    if (n.rodzic) assert(U.KLUCZE[n.rodzic], n.klucz);
    assert(Object.keys(U.STATUSY).includes(n.status), n.klucz);
    // "blokada na serwerze" is shown only where a function or the database refuses TODAY
    const zywySerwer = n.egz.some((x: Any) => x.typ !== "G" && x.faza <= U.FAZA);
    assertEquals(n.status === "serwer" || n.status === "serwer_czesc", zywySerwer && !n.tylkoAdmin, n.klucz);
    if (n.status === "strona" || n.status === "strona_oczekuje") assert(n.strona, n.klucz + ": ukrycie strony wymaga strony");
  }
  for (const s of U.SZABLONY) {
    assertEquals(normalizuj(s.wylaczone), { ok: true, lista: s.wylaczone }, s.id);
    assert(/^[a-z0-9_]{1,40}$/.test(s.id) && s.sekcje.every((x: string) => U.SEKCJE.some((y: string[]) => y[0] === x)), s.id);
  }
});

// the keys the functions check — every string literal that looks like a key, in the files that check the list
const PLIKI = ["terminy/index.ts", "wyslij-komplet/index.ts", "sms/index.ts", "komunikacja/index.ts", "poczta/core.ts", "asystent/core.ts", "akta/index.ts", "translate-docs/index.ts", "vat/index.ts",
  "wfirma/index.ts", "klienci-baza/index.ts", "klient/portal.ts", "podpisy/core.ts", "firma/index.ts", "zadania/index.ts", "klienci-list/index.ts"];
Deno.test("każdy klucz sprawdzany w funkcjach istnieje w katalogu i jest tam oznaczony jako blokada funkcji — i odwrotnie", async () => {
  const uzyte = new Set<string>();
  for (const p of PLIKI) {
    const src = await plik("../" + p);
    assert(src.includes("_shared/uprawnienia.ts"), p + ": brak importu");
    for (const m of src.matchAll(/"((?:kadry|spolka|legalizacja|wspolne|ksiegowosc|klienci|poczta|ogolne|asystenci)(?:\.[a-z0-9_]+){0,2})"/g)) {
      // section names ("kadry") and mailbox names share the spelling of two modules: only dotted literals and the
      // literals used as keys count
      if (m[1].endsWith(".html")) continue; // a link to a page, not a key
      if (m[1].includes(".") || new RegExp(`(mozna|mozeKlucz|odmowa\\w*)\\([^)]*"${m[1]}"`).test(src)) uzyte.add(m[1]);
    }
  }
  // the mail builds its keys from the mailbox: poczta.<skrzynka> and poczta.<skrzynka>.<funkcja>
  assertEquals([...FUNKCJE_SKRZYNKI].sort(), ["porzadki", "wyslij", "zalaczniki"]);
  for (const s of Object.keys(SKRZYNKI)) { uzyte.add("poczta." + s); for (const f of FUNKCJE_SKRZYNKI) uzyte.add("poczta." + s + "." + f); }
  // the assistants a member of staff can be given (the rest are for administrators, who are never restricted)
  for (const a of ASYSTENCI) if (!(a.dostep as Any).admin) uzyte.add("asystenci." + a.id);
  assert(uzyte.size >= 50, "znaleziono " + uzyte.size);
  const zywaF = (n: Any) => n.egz.some((x: Any) => x.typ === "F" && x.faza <= U.FAZA);
  for (const k of uzyte) {
    assert(znany(k), "brak w katalogu: " + k);
    assert(zywaF(U.KLUCZE[k]), "katalog nie oznacza " + k + " jako blokady funkcji (F)");
  }
  // and the other way round: what the catalogue calls a function block is checked by some function
  for (const n of U.LISTA) if (n.egz.some((x: Any) => x.typ === "F")) assert(uzyte.has(n.klucz), "katalog obiecuje blokadę funkcji, której nikt nie sprawdza: " + n.klucz);
  // nothing in the catalogue waits for a later phase any more
  assertEquals(U.FAZA, 3);
  for (const n of U.LISTA) assert(n.egz.every((x: Any) => x.faza <= U.FAZA) && !["oczekuje", "strona_oczekuje"].includes(n.status), n.klucz);
});

// what the migration portal_uprawnienia_rls.sql puts into the policies — every key there is a catalogue key marked R,
// and every key the catalogue marks R is in the migration
Deno.test("każdy klucz w politykach RLS (migracja fazy 3) jest w katalogu oznaczony jako blokada bazy — i odwrotnie", async () => {
  const sql = (await plik("../../migrations/portal_uprawnienia_rls.sql")).split("-- ============================== end of the rollback block")[1];
  assert(sql && sql.includes("begin;") && sql.trimEnd().endsWith("commit;"));
  const wSql = new Set([...sql.matchAll(/public\.portal_moze\('([a-z0-9_.]+)'\)/g)].map((m) => m[1]));
  assert(wSql.size >= 20, "znaleziono " + wSql.size);
  const zR = (n: Any) => n.egz.some((x: Any) => x.typ === "R");
  for (const k of wSql) { assert(znany(k), "brak w katalogu: " + k); assert(zR(U.KLUCZE[k]), "katalog nie oznacza " + k + " jako blokady bazy (R)"); }
  for (const n of U.LISTA) if (zR(n)) assert(wSql.has(n.klucz), "katalog obiecuje blokadę bazy, której nie ma w migracji: " + n.klucz);
  // the rollback file restores the old definitions and never mentions the list
  const wstecz = (await plik("../../migrations/portal_uprawnienia_rls_rollback.sql")).split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  assert(!wstecz.includes("portal_moze(") && wstecz.includes("create policy akta_all_kadry") && wstecz.includes("create policy us_all_portal") && wstecz.includes("create policy ksieg_zamkniecia_all"));
});

// the assistants: every tool and every Store method is classified, with keys of the catalogue
Deno.test("asystenci: każde narzędzie i każda metoda magazynu ma klucze z katalogu (albo jest tylko dla administratora / wspólna)", () => {
  const sprawdz = (kl: unknown, co: string) => {
    assert(kl === null || Array.isArray(kl), co + ": brak klasyfikacji");
    for (const k of (kl ?? []) as string[]) assert(znany(k), co + ": brak w katalogu " + k);
  };
  for (const n of NARZEDZIA) sprawdz(n.klucz, "narzędzie " + n.name);
  for (const [m, kl] of Object.entries(MAGAZYN_KLUCZE)) sprawdz(kl, "magazyn " + m);
  // a tool for administrators only has no page keys, and the other way round
  for (const n of NARZEDZIA) assertEquals(Array.isArray(n.klucz) && n.klucz.length === 0, (n.dostep as Any).admin === true, n.name);
});

Deno.test("każda strona chroniona przez auth-guard.js ma klucz w katalogu; strona startowa nie ma żadnego", async () => {
  const guard = await plik("../../../auth-guard.js");
  const blok = /var PAGE_SECTION = \{([\s\S]*?)\n  \};/.exec(guard);
  assert(blok, "PAGE_SECTION");
  const strony = [...blok![1].matchAll(/'([a-z0-9-]+\.html)'\s*:/g)].map((m) => m[1]);
  assert(strony.length >= 25);
  for (const s of strony) assert(U.kluczeStrony(s, "").length > 0, "brak klucza strony " + s);
  for (const s of ["klienci.html", "zadania.html", "asystenci.html", "historia.html"]) assert(U.kluczeStrony(s, "").length > 0, s);
  assertEquals(U.kluczeStrony("index.html", ""), []);
  assertEquals(U.kluczeStrony("", ""), []);
  // every page of the catalogue exists in the portal
  for (const s of U.STRONY) assert((await Deno.stat(new URL("../../../" + s.plik, import.meta.url))).isFile, s.plik);
});
