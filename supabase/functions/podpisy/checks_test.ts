// deno test supabase/functions/podpisy/checks_test.ts
// The rules: which document may be signed how and by whom. No network, no database.
import { assert, assertEquals } from "jsr:@std/assert@1";
import * as C from "./checks.ts";

const ids = (r: C.Regula) => r.metody.map((x) => x.id).sort().join(",");
const PISEMNE_NOWE = ["zakaz_konkurencji", "kara_porzadkowa", "zgoda_potracenie", "swiadectwo_pracy", "skierowanie_badania", "upowaznienie_rodo", "oswiadczenie_cudz_tresc", "ppk_wniosek"];
const ODBIOR = ["informacja_warunki", "informacja_monitoring", "informacja_dokumentacja", "informacja_dok_pobytowy"];
// the kinds published pages and stored rows already use — they must stay
const DAWNE = ["umowa_praca", "aneks_praca", "umowa_zlecenie", "aneks_zlecenie", "tlumaczenie", "zwiazki_info", "rozwiazanie", "ppk_rezygnacja", "odpowiedzialnosc", "pit2", "kwestionariusz", "oswiadczenie", "zgoda_rodo", "informacja_warunki", "inny"];

Deno.test("every kind has a name and a rule for both sides", () => {
  for (const k of [...DAWNE, ...PISEMNE_NOWE, ...ODBIOR, "wypowiedzenie_zlecenia"]) {
    assert(C.RODZAJE[k], k);
    for (const cudz of [false, true]) for (const s of ["pracodawca", "pracownik"] as const) assert(C.regula(k, cudz, s, null).podstawa.length > 20, k);
  }
});

Deno.test("written-form kinds never take podpis zaufany — Polish worker or foreigner, either side, whatever the employer used", () => {
  for (const k of [...PISEMNE_NOWE, "rozwiazanie", "ppk_rezygnacja", "odpowiedzialnosc"]) {
    for (const cudz of [false, true]) for (const s of ["pracodawca", "pracownik"] as const) for (const pd of [null, "kwalifikowany", "zaufany", "odreczny"]) {
      assertEquals(ids(C.regula(k, cudz, s, pd)), "kwalifikowany,odreczny", `${k} ${cudz} ${s} ${pd}`);
      assert(/Podpis zaufany nie jest tu przyjmowany/.test(C.regula(k, cudz, s, pd).podstawa), k);
    }
  }
});

Deno.test("each written-form kind shows its own legal basis", () => {
  const ma = (k: string, re: RegExp) => assert(re.test(C.regula(k, false, "pracownik", null).podstawa), k + ": " + C.regula(k, false, "pracownik", null).podstawa);
  ma("zakaz_konkurencji", /art\. 101³ Kodeksu pracy/);
  ma("kara_porzadkowa", /art\. 110 Kodeksu pracy/);
  ma("zgoda_potracenie", /art\. 91 § 1 Kodeksu pracy/);
  ma("swiadectwo_pracy", /art\. 97 § 1 Kodeksu pracy/);
  ma("skierowanie_badania", /§ 4 ust\. 1a/);
  ma("upowaznienie_rodo", /art\. 22¹b § 3 Kodeksu pracy/);
  ma("oswiadczenie_cudz_tresc", /art\. 5 ust\. 1, 2 i 4/);
  ma("ppk_wniosek", /art\. 23 ust\. 10 /);
  ma("ppk_rezygnacja", /art\. 23 ust\. 2 /);
  ma("rozwiazanie", /art\. 30 § 3 Kodeksu pracy/);
  // the PPK request and the termination of a mandate contract no longer borrow another document's basis
  assert(!/art\. 23 ust\. 2 /.test(C.regula("ppk_wniosek", false, "pracownik", null).podstawa));
  assert(!/art\. 30 § 3/.test(C.regula("wypowiedzenie_zlecenia", false, "pracodawca", null).podstawa));
  assert(/art\. 746 Kodeksu cywilnego/.test(C.regula("wypowiedzenie_zlecenia", false, "pracodawca", null).podstawa));
  assert(/art\. 77 § 2 Kodeksu cywilnego/.test(C.regula("wypowiedzenie_zlecenia", true, "pracownik", null).podstawa));
});

Deno.test("termination of a mandate contract: documentary form — all three methods, no warning", () => {
  for (const cudz of [false, true]) for (const s of ["pracodawca", "pracownik"] as const) {
    const r = C.regula("wypowiedzenie_zlecenia", cudz, s, null);
    assertEquals(ids(r), "kwalifikowany,odreczny,zaufany");
    assert(r.metody.every((x) => !x.ostrzezenie));
  }
});

Deno.test("receipt-only kinds: no method at all, the worker only confirms", () => {
  for (const k of ODBIOR) {
    for (const cudz of [false, true]) for (const s of ["pracodawca", "pracownik"] as const) assertEquals(C.regula(k, cudz, s, "kwalifikowany").metody.length, 0, k);
    assertEquals(C.wymuszonePodpisuje(k), "potwierdzenie");
    assertEquals(C.domyslniePodpisuje(k, false), "potwierdzenie");
    assertEquals(C.domyslniePodpisuje(k, true), "potwierdzenie");
    assertEquals(C.kroki("potwierdzenie"), { pd_status: "nie_dotyczy", pr_status: "nie_dotyczy" });
  }
  assert(/art\. 22² § 8 Kodeksu pracy/.test(C.regula("informacja_monitoring", false, "pracownik", null).podstawa));
  assert(/art\. 94⁶ Kodeksu pracy/.test(C.regula("informacja_dokumentacja", false, "pracownik", null).podstawa));
  assert(/art\. 29 § 3 Kodeksu pracy/.test(C.regula("informacja_warunki", false, "pracownik", null).podstawa));
});

Deno.test("employer-only kinds: the worker has no step", () => {
  for (const k of ["swiadectwo_pracy", "skierowanie_badania", "kara_porzadkowa"]) {
    assertEquals(C.wymuszonePodpisuje(k), "pracodawca");
    assertEquals(C.domyslniePodpisuje(k, true), "pracodawca");
    assertEquals(C.kroki(C.domyslniePodpisuje(k, false)), { pd_status: "oczekuje", pr_status: "nie_dotyczy" });
  }
  // a document the employer alone signs is ready once that one signature is verified
  assertEquals(C.statusDok({ status: "u_pracodawcy", podpisuje: "pracodawca", pd_status: "zweryfikowany", pr_status: "nie_dotyczy" }), "gotowy");
});

Deno.test("who signs by default", () => {
  assertEquals(C.domyslniePodpisuje("zakaz_konkurencji", false), "obie");
  assertEquals(C.domyslniePodpisuje("upowaznienie_rodo", false), "obie");
  assertEquals(C.domyslniePodpisuje("zgoda_potracenie", false), "pracownik");
  assertEquals(C.domyslniePodpisuje("oswiadczenie_cudz_tresc", true), "pracownik");
  assertEquals(C.domyslniePodpisuje("ppk_wniosek", false), "pracownik");
  assertEquals(C.domyslniePodpisuje("wypowiedzenie_zlecenia", false), "pracodawca");
  for (const k of ["zakaz_konkurencji", "zgoda_potracenie", "ppk_wniosek", "wypowiedzenie_zlecenia", "inny", "umowa_praca"]) assertEquals(C.wymuszonePodpisuje(k), null);
  // unchanged defaults
  assertEquals(C.domyslniePodpisuje("umowa_praca", false), "obie");
  assertEquals(C.domyslniePodpisuje("zwiazki_info", false), "pracownik");
  assertEquals(C.domyslniePodpisuje("zwiazki_info", true), "obie");
  assertEquals(C.domyslniePodpisuje("pit2", false), "pracownik");
});

Deno.test("rules of the earlier kinds are unchanged", () => {
  // foreigner's contract: podpis zaufany only behind the warning
  const cz = C.regula("umowa_zlecenie", true, "pracownik", null);
  assertEquals(ids(cz), "kwalifikowany,odreczny,zaufany");
  assertEquals(cz.metody.find((x) => x.id === "zaufany")?.ostrzezenie, "PZ-CUDZ-1");
  assert(C.OSTRZEZENIA["PZ-CUDZ-1"] && C.POTWIERDZENIA["PZ-CUDZ-1"]);
  // employment contract: the worker's podpis zaufany only after the employer's qualified signature
  assertEquals(ids(C.regula("umowa_praca", false, "pracownik", null)), "kwalifikowany,odreczny");
  assertEquals(ids(C.regula("umowa_praca", false, "pracownik", "kwalifikowany")), "kwalifikowany,odreczny,zaufany");
  assertEquals(ids(C.regula("umowa_praca", false, "pracodawca", "kwalifikowany")), "kwalifikowany,odreczny");
  // no written form required
  for (const k of ["umowa_zlecenie", "pit2", "kwestionariusz", "oswiadczenie", "zgoda_rodo", "inny"]) assertEquals(ids(C.regula(k, false, "pracownik", null)), "kwalifikowany,odreczny,zaufany", k);
});

Deno.test("macierz: one row per kind and citizenship, old fields kept, new ones added", () => {
  const mx = C.macierz();
  assertEquals(mx.length, Object.keys(C.RODZAJE).length * 2);
  for (const r of mx) {
    for (const f of ["rodzaj", "cudzoziemiec", "pracodawca", "pracownik", "pracownik_po_kwalifikowanym", "podstawa", "podpisuje_domyslnie", "podpisuje_wymuszone"]) assert(f in r, f);
    assert(C.PODPISUJE[r.podpisuje_domyslnie], r.rodzaj);
    assert(r.podpisuje_wymuszone === null || r.podpisuje_wymuszone === r.podpisuje_domyslnie, r.rodzaj);
  }
  assertEquals(mx.filter((r) => r.podpisuje_wymuszone === "potwierdzenie").length, ODBIOR.length * 2);
});

Deno.test("status arithmetic", () => {
  assertEquals(C.statusDok({ status: "u_pracodawcy", podpisuje: "potwierdzenie", pd_status: "nie_dotyczy", pr_status: "nie_dotyczy", odbior_at: null }), "u_pracownika");
  assertEquals(C.statusDok({ status: "u_pracodawcy", podpisuje: "potwierdzenie", pd_status: "nie_dotyczy", pr_status: "nie_dotyczy", odbior_at: "2026-10-09T00:00:00Z" }), "gotowy");
  assertEquals(C.statusDok({ status: "x", podpisuje: "obie", pd_status: "wgrany", pr_status: "oczekuje" }), "weryfikacja_pracodawcy");
  assertEquals(C.statusPak({ status: "u_pracodawcy" }, [{ podpisuje: "obie", pd_status: "zweryfikowany", pr_status: "wgrany" }]), "weryfikacja");
  assertEquals(C.statusPak({ status: "szkic" }, []), "szkic");
  assertEquals(C.finalne({ pd_status: "zweryfikowany", pd_path: "a", pr_status: "zweryfikowany", pr_path: "b", pr_baza: "pracodawca" }), ["pracownik"]);
  assertEquals(C.wymaganePotwierdzenia("odreczny", null), ["tresc"]);
  assertEquals(C.wymaganePotwierdzenia("kwalifikowany", "pracodawca"), ["tresc", "waznosc", "pracodawca"]);
});

Deno.test("bytes: type by content, the issued file itself, a signature that closes the file", async () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const base = enc("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n");
  const baza: C.Base = { id: "wydany", rozmiar: base.length, sha256: await C.sha256(base) };
  assertEquals(C.sniff(base), "pdf");
  assertEquals(C.sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assertEquals(C.sniff(enc("ftypheic")), null);
  // the very file we issued
  let v = await C.inspect(base, "application/pdf", "odreczny", [baza]);
  assert(!v.ok && v.kod === "niepodpisany");
  v = await C.inspect(base, "application/pdf", "kwalifikowany", [baza]);
  assert(!v.ok && v.kod === "bez_podpisu");
  // unsupported / mismatching types
  v = await C.inspect(enc("ftypheic...."), "image/heic", "odreczny", [baza]);
  assert(!v.ok && v.kod === "typ");
  v = await C.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), "application/pdf", "odreczny", [baza]);
  assert(!v.ok && v.kod === "niezgodny");
  v = await C.inspect(new Uint8Array(0), "", "odreczny", [baza]);
  assert(!v.ok && v.kod === "pusty");
  // a scan is taken for the eye
  v = await C.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), "image/jpeg", "odreczny", [baza]);
  assert(v.ok && v.wiazanie === "wzrokowa");
  // an electronic signature must be a PDF that continues the issued bytes
  v = await C.inspect(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), "image/jpeg", "zaufany", [baza]);
  assert(!v.ok && v.kod === "pdf");
  const obcy = enc("%PDF-1.7\nother /Type /Sig /ByteRange [0 10 20 5]\n%%EOF\n");
  v = await C.inspect(obcy, "application/pdf", "kwalifikowany", [baza]);
  assert(!v.ok && v.kod === "nie_nasz");
  v = await C.inspect(obcy, "application/pdf", "kwalifikowany", [baza], true);
  assert(v.ok && v.wiazanie === "pominiete");
  // appended revision whose /ByteRange covers the whole upload
  const head = "2 0 obj<</Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 ";
  const mk = (a: number, b: number, c: number) => enc(`${head}${String(a).padStart(6, "0")} ${String(b).padStart(6, "0")} ${String(c).padStart(6, "0")}] /Contents <00>>>endobj\n%%EOF\n`);
  const len = base.length + mk(0, 0, 0).length, a = base.length + 10, b = a + 20;
  const signed = new Uint8Array(len); signed.set(base); signed.set(mk(a, b, len - b), base.length);
  v = await C.inspect(signed, "application/pdf", "kwalifikowany", [baza]);
  assert(v.ok && v.wiazanie === "prefiks" && v.baza === "wydany" && v.rewizje === 1, JSON.stringify(v));
  // ...and one that does not reach the end of the file
  const krotki = new Uint8Array(len); krotki.set(base); krotki.set(mk(a, b, len - b - 3), base.length);
  v = await C.inspect(krotki, "application/pdf", "kwalifikowany", [baza]);
  assert(!v.ok && v.kod === "bez_podpisu" && v.error === C.ERR.niepelny);
  // size caps
  v = await C.inspect(new Uint8Array(C.MAX_LINK + 1), "", "odreczny", [baza], false, C.MAX_LINK);
  assert(!v.ok && v.kod === "rozmiar" && v.error === C.ERR.rozmiar_link);
});

Deno.test("names and ids", async () => {
  assertEquals(C.plainName("Świadectwo pracy — Żółć"), "Swiadectwo_pracy_Zolc");
  assert(!/[\/\\]|\.\./.test(C.plainName("../a/..\\b")));
  assertEquals(await C.uuid5("a:wydany"), await C.uuid5("a:wydany"));
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(await C.uuid5("a:wydany")));
});
