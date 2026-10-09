// deno test supabase/functions/komunikacja/logic_test.ts
// The rules of the module, without network or database. Fictional firms, people and addresses only.
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  akceptacja, BOT, csv, csvPole, czyscOdbiorcow, czyscPrzyciski, czyscSegmenty, czyscTresc, czytajTg, czytajUst, DOMYSLNE, escHtml, ileWPrzebiegu, instrukcja, jezykKlienta, jezykTg, JEZYKI,
  kanalyStrategii, kiedyPonowic, klawiatura, type KlientR, LINK_SUB, linkBota, losowaSol, maska, odcisk, potwierdzenie, powodyAkceptacji, rozwiaz, sha256hex, sprawdzUst, staleRowne, type Sub,
  szablonKoniecGrup, tekst, tgHtml, TOKEN_RE, tokenZSoli, type Tresc, urlOk, wariantTg, wBocie, wstaw, wybierz, type Zgody,
} from "./logic.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const SEKRET = "sekret-do-testow-0123456789abcdef0123456789";
const tresc = (v: Any = {}): Tresc => { const t = czyscTresc(v); if (!t.ok) throw new Error(t.error); return t.tresc; };

Deno.test("języki: baza klientów i Telegram", () => {
  assertEquals(["Russian", "ukrainian", " Polish ", "", "rosyjski", "UA", "English"].map(jezykKlienta), ["ru", "uk", "pl", "", "ru", "uk", ""]);
  assertEquals(["ru", "uk-UA", "pl", "en", undefined, "be"].map(jezykTg), ["ru", "uk", "pl", "pl", "pl", "ru"]);
});

Deno.test("token zaproszenia: 192 bity, alfabet parametru start, zależy od sekretu i soli", async () => {
  const sol = losowaSol(), t = await tokenZSoli(SEKRET, sol);
  assert(TOKEN_RE.test(t) && t.length <= 64);
  assertEquals(t, await tokenZSoli(SEKRET, sol));                       // the same link can be shown again
  assertNotEquals(t, await tokenZSoli(SEKRET, losowaSol()));
  assertNotEquals(t, await tokenZSoli(SEKRET + "x", sol));              // the table alone (salt + hash) does not give the token
  assertEquals((await sha256hex(t)).length, 64);
  let blad = false; try { await tokenZSoli("krotki", sol); } catch { blad = true; }
  assert(blad);
  assertEquals(linkBota("TdPowiadomienia_bot", t), "https://t.me/TdPowiadomienia_bot?start=" + t);
  assertEquals(linkBota("zła nazwa", t), "");
  assertEquals(linkBota("TdPowiadomienia_bot", "za-krotki"), "");
});

Deno.test("porównanie sekretu: równe tylko identyczne, puste nigdy", () => {
  assert(staleRowne("abc123", "abc123"));
  for (const [a, b] of [["abc123", "abc124"], ["abc", "abcd"], ["", ""], ["", "x"], ["x", ""], ["abcd", "abc"]]) assert(!staleRowne(a, b), a + "|" + b);
});

Deno.test("adres w wiadomości i w przycisku: tylko zwykłe https", () => {
  for (const ok of ["https://td-group.pl/klient", "https://t.me/Bot_bot?start=abc", "https://example.test/a?b=1&c=2#x"]) assert(urlOk(ok), ok);
  for (const zly of ["http://td-group.pl", "javascript:alert(1)", "tg://resolve?domain=x", "https://user:haslo@example.test", "https://example.test:8443/x", "https://127.0.0.1/x", "https://localhost/x",
    "https://xn--80ak6aa92e.com", "https://example.test/a b", "https://example.test/\"><b>", "HTTPS://", "data:text/html,x", "//example.test", "", null, 5, "https://example.test/" + "a".repeat(600), "https://exa\u0000mple.test"]) assertEquals(urlOk(zly), null, String(zly));
});

Deno.test("budowanie wiadomości: wrogi tekst nigdy nie staje się znacznikiem", () => {
  const s = czyscSegmenty([
    { t: "<b>nie pogrubione</b> & <a href=\"https://zlo.test\">klik</a> <script>x</script>" },
    { t: "ważne", b: true, i: true }, { t: " strona", url: "https://td-group.pl/a?x=1&y=2" }, { t: "‮odwrócone\u0007", b: "tak" }, { t: "" },
  ]);
  assert(s.ok);
  const h = tgHtml(s.seg, {});
  assertEquals(h, "&lt;b&gt;nie pogrubione&lt;/b&gt; &amp; &lt;a href=&quot;https://zlo.test&quot;&gt;klik&lt;/a&gt; &lt;script&gt;x&lt;/script&gt;<i><b>ważne</b></i><a href=\"https://td-group.pl/a?x=1&amp;y=2\"> strona</a>odwrócone");
  assert(!czyscSegmenty([{ t: "x", url: "https://td-group.pl/a?y=\"2\"" }]).ok);                // a quote can never reach the href
  // the only tags in the output are the builder's own
  assertEquals([...new Set(h.match(/<\/?[a-z]+/g))].sort(), ["</a", "</b", "</i", "<a", "<b", "<i"]);
  assert(!czyscSegmenty([{ t: "x", url: "javascript:alert(1)" }]).ok);
  assert(!czyscSegmenty([{ t: "x", url: "http://bez-https.test" }]).ok);
  assert(!czyscSegmenty("<b>tekst</b>").ok);
  assert(!czyscSegmenty([{ b: true }]).ok);
  assert(!czyscSegmenty([{ t: "a".repeat(7000) }]).ok);
});

Deno.test("pola {firma} {kontakt} {opiekun} {link_subskrypcji}: wartości są tekstem, nie znacznikami ani polami", () => {
  const d = { firma: "<b>Alfa</b> & \"Syn\" {kontakt}", kontakt: "Jan\nTestowy", opiekun: "", link_subskrypcji: "https://t.me/Bot_bot?start=" + "a".repeat(32) };
  assertEquals(wstaw("Firma {firma}, {kontakt}, [{opiekun}], {nieznane}", d), "Firma <b>Alfa</b> & \"Syn\" {kontakt}, Jan Testowy, [], {nieznane}"); // one pass: {kontakt} inside a value stays
  const s = czyscSegmenty([{ t: "Dla {firma}: " }, { t: "włącz", url: LINK_SUB }, { t: " {link_subskrypcji}" }]);
  assert(s.ok);
  assertEquals(tgHtml(s.seg, d), "Dla &lt;b&gt;Alfa&lt;/b&gt; &amp; &quot;Syn&quot; {kontakt}: <a href=\"" + d.link_subskrypcji + "\">włącz</a> " + d.link_subskrypcji);
  // a link placeholder that resolves to something that is not a plain https address is dropped, the text stays
  assertEquals(tgHtml(s.seg, { ...d, link_subskrypcji: "javascript:alert(1)" }), "Dla &lt;b&gt;Alfa&lt;/b&gt; &amp; &quot;Syn&quot; {kontakt}: włącz javascript:alert(1)");
  assertEquals(tekst(s.seg, { firma: "Alfa", link_subskrypcji: d.link_subskrypcji }, true), "Dla Alfa: włącz (" + d.link_subskrypcji + ") " + d.link_subskrypcji);
  assertEquals(escHtml("a<b>&\"c"), "a&lt;b&gt;&amp;&quot;c");
});

Deno.test("przyciski: napis i adres sprawdzone, najwyżej trzy", () => {
  const p = czyscPrzyciski([{ etykieta: { pl: "Włącz", ru: "Включить", uk: "" }, url: LINK_SUB }, { etykieta: { pl: "Strona <b>" }, url: "https://td-group.pl" }]);
  assert(p.ok);
  const t = tresc({ przyciski: p.p, fallback: ["ru", "pl", "uk"] }), link = "https://t.me/Bot_bot?start=" + "b".repeat(32);
  assertEquals(klawiatura(t, "uk", { link_subskrypcji: link }), [[{ text: "Включить", url: link }], [{ text: "Strona <b>", url: "https://td-group.pl/" }]]); // uk missing -> fallback order; a label is plain text for Telegram
  assertEquals(klawiatura(t, "pl", {}), [[{ text: "Strona <b>", url: "https://td-group.pl/" }]]); // no link for the client -> the button is left out
  assert(!czyscPrzyciski([{ etykieta: { pl: "x" }, url: "http://a.test" }]).ok);
  assert(!czyscPrzyciski([{ etykieta: { pl: "x" }, url: "tg://x" }]).ok);
  assert(!czyscPrzyciski([{ etykieta: {}, url: "https://a.test" }]).ok);
  assert(!czyscPrzyciski(Array(4).fill({ etykieta: { pl: "x" }, url: "https://a.test" })).ok);
});

Deno.test("wariant językowy: własny język, potem kolejność zapasowa, albo jedna treść dla wszystkich", () => {
  const t = tresc({ tg: { pl: [{ t: "PL" }], ru: [{ t: "RU" }] }, fallback: ["ru", "pl"] });
  assertEquals(wariantTg(t, "pl")?.jezyk, "pl");
  assertEquals(wariantTg(t, "uk")?.jezyk, "ru");
  assertEquals(wariantTg(t, "")?.jezyk, "ru");
  assertEquals(wariantTg(tresc({ wspolna: true, tg: { pl: [{ t: "wspólna" }], ru: [{ t: "RU" }] } }), "ru")?.jezyk, "pl");
  assertEquals(wariantTg(tresc({ tg: { pl: [{ t: "   " }] } }), "pl"), null);
  assert(!czyscTresc({ tg: { pl: [{ t: "a".repeat(3900) }] } }).ok);
});

const K = (id: string, o: Partial<KlientR> = {}): KlientR => ({
  id, nip: /^\d{10}$/.test(id) ? id : "", nazwa: "Przykładowa " + id, forma: "spółka z o.o.", opodatkowanie: "CIT", miasto: "Warszawa", opiekun: "Testowa A.", kadrowy: "", kontakt: "Osoba Testowa", jezyk: "pl",
  status: "obslugiwany", obslugiwany: true, zakres_ksiegowosc: true, zakres_kadry: false, grupa: "-10010000000" + id.slice(-2), telefon: "+486001002" + id.slice(-2), email: "biuro" + id.slice(-2) + "@example.test", ...o,
});
const S = (id: string, klient: string, o: Partial<Sub> = {}): Sub => ({ id, klient, chat_id: "7000" + id, jezyk: "pl", aktywna: true, blocked_at: null, zgoda_marketing: false, ...o });
const mapa = (l: Sub[]) => { const m = new Map<string, Sub[]>(); for (const s of l) m.set(s.klient, [...(m.get(s.klient) ?? []), s]); return m; };
const KL = [
  K("9990000011"), K("9990000022", { jezyk: "ru", miasto: "Kraków", opiekun: "Przykładowy B.", kadrowy: "Testowa K.", zakres_kadry: true, grupa: "", telefon: "" }),
  K("9990000033", { jezyk: "uk", email: "", forma: "JDG", opodatkowanie: "ryczałt" }), K("9990000044", { status: "zakonczony", obslugiwany: false }),
  K("nazwa:bez nipu", { jezyk: "", grupa: "-1001000000005", telefon: "", email: "" }), K("9990000066", { status: "wstrzymany" }),
];
const SUBY = mapa([S("1", "9990000011"), S("2", "9990000011", { jezyk: "ru", zgoda_marketing: true }), S("3", "9990000022", { aktywna: false }), S("4", "9990000033", { blocked_at: "2026-10-01T00:00:00Z" }), S("5", "9990000066")]);
const ids = (l: KlientR[]) => l.map((k) => k.id);

Deno.test("odbiorcy: wszyscy obsługiwani, filtry, ręczny wybór i wykluczenia", () => {
  assertEquals(ids(wybierz(KL, SUBY, czyscOdbiorcow({ tryb: "wszyscy" }))), ["9990000011", "9990000022", "9990000033", "nazwa:bez nipu", "9990000066"]); // the ended client is out
  assertEquals(ids(wybierz(KL, SUBY, czyscOdbiorcow({ tryb: "wszyscy", wykluczeni: ["9990000022", "nie-id"] }))), ["9990000011", "9990000033", "nazwa:bez nipu", "9990000066"]);
  const f = (filtry: Any, reszta: Any = {}) => ids(wybierz(KL, SUBY, czyscOdbiorcow({ tryb: "filtry", filtry, ...reszta })));
  assertEquals(f({ jezyk: ["ru", "uk"] }), ["9990000022", "9990000033"]);
  assertEquals(f({ jezyk: [""] }), ["nazwa:bez nipu"]);
  assertEquals(f({ zakres: "kadry" }), ["9990000022"]);
  assertEquals(f({ sub: "tak" }), ["9990000011", "9990000066"]);             // switched-off and blocked subscriptions do not count
  assertEquals(f({ sub: "nie", grupa: "tak" }), ["9990000033", "nazwa:bez nipu"]);
  assertEquals(f({ telefon: "nie" }), ["9990000022", "nazwa:bez nipu"]);
  assertEquals(f({ email: "tak", miasto: ["kraków"] }), ["9990000022"]);
  assertEquals(f({ forma: ["JDG"], opodatkowanie: ["Ryczałt"] }), ["9990000033"]);
  assertEquals(f({ opiekun: ["Przykładowy B."] }), ["9990000022"]);
  assertEquals(f({ status: ["zakonczony"] }), ["9990000044"]);                // only when asked for by name
  assertEquals(f({ status: ["wstrzymany"] }), ["9990000066"]);
  assertEquals(f({ jezyk: ["ru"] }, { wybrani: ["9990000044"], wykluczeni: ["9990000022"] }), ["9990000044"]); // hand-picked in, excluded out
  assertEquals(ids(wybierz(KL, SUBY, czyscOdbiorcow({ tryb: "recznie", wybrani: ["9990000033", "9990000011"] }))), ["9990000011", "9990000033"]);
  assertEquals(czyscOdbiorcow({ tryb: "cokolwiek", filtry: { status: ["x"], jezyk: ["de"], sub: "może" } }), { tryb: "wszyscy", filtry: { status: [], zakres: "", forma: [], opodatkowanie: [], opiekun: [], kadrowy: [], jezyk: [], miasto: [], sub: "", grupa: "", telefon: "", email: "" }, wybrani: [], wykluczeni: [] });
});

const T = tresc({ tg: { pl: [{ t: "PL {firma}" }], ru: [{ t: "RU {firma}" }] }, sms: { pl: "SMS pl" }, mail: { temat: { pl: "Temat" }, tresc: { pl: "Treść" } }, fallback: ["pl", "ru", "uk"] });
const plan = (strategia: Any, kanaly: Any = {}, typ: Any = "serwisowa", zgody: Zgody = new Map(), kl = KL.filter((k) => k.obslugiwany), suby = SUBY, t = T) =>
  rozwiaz(kl, suby, zgody, { typ, strategia, kanaly: kanalyStrategii(strategia, kanaly), tresc: t });
const kto = (p: ReturnType<typeof plan>, kanal: string) => p.dostawy.filter((d) => d.kanal === kanal).map((d) => d.klient + (d.jezyk ? ":" + d.jezyk : ""));

Deno.test("strategia „tylko bot”: aktywni subskrybenci, reszta z powodem", () => {
  const p = plan("bot");
  assertEquals(kto(p, "bot"), ["9990000011:pl", "9990000011:ru", "9990000066:pl"]);  // each subscriber in his own language
  assertEquals(p.liczby, { bot: 3, grupa: 0, sms: 0, mail: 0, brak: 3, klienci: 2 });
  const powod = (k: string) => p.dostawy.find((d) => d.klient === k && d.kanal === "brak")?.powod;
  assertEquals(powod("9990000022"), "subskrypcja wyłączona albo bot zablokowany");
  assertEquals(powod("9990000033"), "subskrypcja wyłączona albo bot zablokowany");
  assertEquals(powod("nazwa:bez nipu"), "brak subskrypcji bota");
});

Deno.test("strategie zapasowe: bot, a gdy go nie ma — SMS / e-mail / grupa", () => {
  const sms = plan("bot_sms");
  assertEquals(kto(sms, "sms"), ["9990000033:pl"]);                                // no phone for 22 and the one without NIP
  assertEquals(kto(sms, "brak"), ["9990000022", "nazwa:bez nipu"]);
  assert(sms.dostawy.find((d) => d.klient === "9990000022")!.powod!.includes("brak numeru komórkowego"));
  assertEquals(kto(plan("bot_mail"), "mail"), ["9990000022:pl"]);
  const gr = plan("bot_grupa");
  assertEquals(kto(gr, "grupa"), ["9990000033:pl", "nazwa:bez nipu:pl"]);        // uk and no language -> fallback pl
  assertEquals(kto(gr, "bot").length, 3);                                           // a subscribed client's group stays quiet
  assertEquals(gr.liczby.grupa, 2);
});

Deno.test("strategia „wszystkie wybrane kanały” i brak powtórzeń na jeden adres", () => {
  const p = plan("wszystkie", { grupa: true, mail: true });
  assertEquals(p.liczby, { bot: 0, grupa: 4, sms: 0, mail: 3, brak: 0, klienci: 5 });
  assertEquals(kto(p, "grupa"), ["9990000011:pl", "9990000033:pl", "nazwa:bez nipu:pl", "9990000066:pl"]);
  assertEquals(kto(p, "mail"), ["9990000011:pl", "9990000022:pl", "9990000066:pl"]);
  // two clients of one owner share a group and a mailbox: one message per address, the second client says why
  const blizniak = K("9990000077", { grupa: KL[0].grupa, email: KL[0].email.toUpperCase() });
  const dwa = rozwiaz([KL[0], blizniak], SUBY, new Map(), { typ: "serwisowa", strategia: "wszystkie", kanaly: kanalyStrategii("wszystkie", { grupa: true, mail: true }), tresc: T });
  assertEquals(dwa.liczby, { bot: 0, grupa: 1, sms: 0, mail: 1, brak: 1, klienci: 1 });
  assertEquals(dwa.dostawy.find((d) => d.klient === "9990000077")!.powod, "ten sam adres co u klienta: Przykładowa 9990000011");
  assertEquals(plan("wszystkie", {}).liczby.brak, 5);                               // no channel chosen
  assertEquals(kanalyStrategii("bot_sms", { grupa: true, mail: true }), { bot: true, grupa: false, sms: true, mail: false }); // the toggles matter only for "wszystkie"
});

Deno.test("brama zgody: rozsyłka marketingowa tylko do odbiorców z zapisaną zgodą, nigdy do grupy", () => {
  const bez = plan("wszystkie", { bot: true, grupa: true, sms: true, mail: true }, "marketingowa");
  assertEquals(kto(bez, "bot"), ["9990000011:ru"]);                                 // the one subscriber with a consent
  assertEquals([bez.liczby.grupa, bez.liczby.sms, bez.liczby.mail], [0, 0, 0]);
  const p66 = bez.dostawy.find((d) => d.klient === "9990000066")!.powod!;
  for (const x of ["brak zgody marketingowej (Telegram)", "grupa nie może dostać rozsyłki marketingowej", "brak zgody marketingowej (SMS)", "brak zgody marketingowej (e-mail)"]) assert(p66.includes(x), x);
  const zg: Zgody = new Map([["9990000033", { sms: true, email: true }], ["9990000022", { sms: true, email: false }]]);
  const ze = plan("wszystkie", { bot: true, grupa: true, sms: true, mail: true }, "marketingowa", zg);
  assertEquals(kto(ze, "sms"), ["9990000033:pl"]);                                  // 22 has a consent but no phone
  assertEquals(kto(ze, "mail"), []);                                                // 33 has a consent but no address
  assertEquals(ze.liczby.grupa, 0);
  // the same people as a service message: everybody reachable
  assertEquals(plan("wszystkie", { bot: true, sms: true }).liczby.sms, 3);
});

Deno.test("akceptacja: próg, grupy, marketing; cztery oczy", () => {
  assertEquals(powodyAkceptacji({ liczba: 5, grupa: 0, typ: "serwisowa" }, 5), []);
  assertEquals(powodyAkceptacji({ liczba: 6, grupa: 0, typ: "serwisowa" }, 5).length, 1);
  assertEquals(powodyAkceptacji({ liczba: 1, grupa: 1, typ: "serwisowa" }, 5).length, 1);
  assertEquals(powodyAkceptacji({ liczba: 1, grupa: 0, typ: "marketingowa" }, 5).length, 1);
  assertEquals(powodyAkceptacji({ liczba: 1, grupa: 0, typ: "serwisowa" }, 0).length, 1);
  const adm = { email: "Admin@example.test", admin: true };
  assertEquals(akceptacja(adm, "autor@example.test", 0), { ok: true, sam: false });
  assert(!akceptacja(adm, "admin@example.test", 1).ok);                             // another administrator exists: not his own
  assertEquals(akceptacja(adm, "admin@example.test", 0), { ok: true, sam: true });  // the only one: allowed, and recorded
  assert(!akceptacja({ email: "kadry@example.test", admin: false }, "autor@example.test", 0).ok);
});

Deno.test("potwierdzenie: liczby z podglądu muszą się zgadzać, powyżej 20 odbiorców przepisany tytuł", () => {
  const l = (bot: number, grupa = 0) => ({ bot, grupa, sms: 0, mail: 0, brak: 0, klienci: bot + grupa });
  assertEquals(potwierdzenie("Tytuł", l(3), { liczby: l(3) }), null);
  assert(potwierdzenie("Tytuł", l(3), { liczby: l(2) })!.includes("zmieniła się"));
  assert(potwierdzenie("Tytuł", l(3), {})!.includes("zmieniła się"));
  assert(potwierdzenie("Tytuł", l(0), { liczby: l(0) })!.includes("Nikt"));
  assert(potwierdzenie("Koniec rozsyłek", l(1, 20), { liczby: l(1, 20) })!.includes("przepisz"));
  assert(potwierdzenie("Koniec rozsyłek", l(1, 20), { liczby: l(1, 20), tytul: "koniec rozsyłek" })!.includes("przepisz"));
  assertEquals(potwierdzenie("Koniec rozsyłek", l(1, 20), { liczby: l(1, 20), tytul: " Koniec rozsyłek " }), null);
  assertEquals(potwierdzenie("Tytuł", l(20), { liczby: l(20) }), null);
});

Deno.test("odcisk treści: ten sam dla tej samej treści, inny po każdej zmianie", async () => {
  const a = { typ: "serwisowa", tresc: T, strategia: "bot", kanaly: { bot: true } };
  assertEquals(await odcisk(a), await odcisk({ strategia: "bot", kanaly: { bot: true }, tresc: JSON.parse(JSON.stringify(T)), typ: "serwisowa" }));
  assertNotEquals(await odcisk(a), await odcisk({ ...a, typ: "marketingowa" }));
  assertNotEquals(await odcisk(a), await odcisk({ ...a, tresc: tresc({ tg: { pl: [{ t: "PL {firma}." }] } }) }));
});

Deno.test("odpowiedzi Telegrama", () => {
  assertEquals(czytajTg(200, { ok: true, result: { message_id: 77 } }), { rodzaj: "ok", message_id: 77 });
  assertEquals(czytajTg(429, { ok: false, error_code: 429, description: "Too Many Requests: retry after 17", parameters: { retry_after: 17 } }), { rodzaj: "ponow", po_s: 17, opis: "Too Many Requests: retry after 17", limit: true });
  assertEquals(czytajTg(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }).rodzaj, "zablokowany");
  assertEquals(czytajTg(403, { ok: false, error_code: 403, description: "Forbidden: user is deactivated" }).rodzaj, "zablokowany");
  assertEquals(czytajTg(400, { ok: false, error_code: 400, description: "Bad Request: chat not found" }).rodzaj, "brak_czatu");
  assertEquals(czytajTg(403, { ok: false, error_code: 403, description: "Forbidden: bot is not a member of the supergroup chat" }).rodzaj, "brak_czatu");
  assertEquals(czytajTg(400, { ok: false, error_code: 400, description: "Bad Request: group chat was upgraded to a supergroup chat", parameters: { migrate_to_chat_id: -1002000000001 } }), { rodzaj: "migracja", nowy: "-1002000000001", opis: "Bad Request: group chat was upgraded to a supergroup chat" });
  assertEquals(czytajTg(401, { ok: false, error_code: 401, description: "Unauthorized" }).rodzaj, "auth");
  assertEquals(czytajTg(502, null), { rodzaj: "ponow", po_s: null, opis: "HTTP 502", limit: false });
  assertEquals(czytajTg(400, { ok: false, error_code: 400, description: "Bad Request: can't parse entities" }).rodzaj, "blad");
});

Deno.test("ponowienia i tempo: retry_after z zapasem, potem 1, 5, 15, 60 minut; daleko od limitów Telegrama", () => {
  const t = new Date("2026-10-09T10:00:00Z"), za = (d: Date) => (d.getTime() - t.getTime()) / 1000;
  assertEquals(za(kiedyPonowic(t, 1, 17)), 20);
  assertEquals([1, 2, 3, 4, 9].map((p) => za(kiedyPonowic(t, p, null))), [60, 300, 900, 3600, 3600]);
  assertEquals(ileWPrzebiegu(DOMYSLNE, 45000), 20);
  assertEquals(ileWPrzebiegu({ ...DOMYSLNE, odstep_ms: 5000 }, 45000), 9);
  // whatever is stored, a run sends at most 30 messages at least 1.1 s apart: under 1 message a second
  const dziki = czytajUst({ na_przebieg: 5000, odstep_ms: 1, stop_po_bledach: 0, prog_akceptacji: -3, godziny: { od: "25:00", do: "x" } });
  assertEquals([dziki.na_przebieg, dziki.odstep_ms, dziki.stop_po_bledach, dziki.prog_akceptacji, dziki.godziny], [20, 1500, 5, 5, { od: "08:00", do: "20:00" }]);
  assert(ileWPrzebiegu(czytajUst({ na_przebieg: 30, odstep_ms: 1100 }), 45000) * 1100 >= 30 * 1000);
  assert(sprawdzUst({ ...DOMYSLNE }).ok);
  assert(!sprawdzUst({ ...DOMYSLNE, odstep_ms: 200 }).ok);
  assert(!sprawdzUst({ ...DOMYSLNE, godziny: { od: "05:00", do: "23:00" } }).ok);
  assert(!sprawdzUst({ ...DOMYSLNE, polityka_url: "http://x.test" }).ok);
});

Deno.test("CSV: komórka nie może stać się formułą", () => {
  assertEquals(csvPole("=HYPERLINK(\"https://zlo.test\";\"klik\")"), "\"'=HYPERLINK(\"\"https://zlo.test\"\";\"\"klik\"\")\"");
  assertEquals(["+48600", "-1001", "@cmd", "  =1+1", "\t=1", "zwykły; tekst", 5, null].map(csvPole), ["\"'+48600\"", "\"'-1001\"", "\"'@cmd\"", "\"'  =1+1\"", "\"'\t=1\"", "\"zwykły; tekst\"", "\"5\"", "\"\""]);
  const c = csv([["Klient", "Powód"], ["=cmd|' /C calc'!A0", "wiersz\ndrugi"]]);
  assert(c.startsWith("﻿\"Klient\";\"Powód\"\r\n\"'=cmd|' /C calc'!A0\";\"wiersz\ndrugi\"\r\n"));
  assertEquals([maska("mail", "biuro@example.test"), maska("sms", "+48600100200"), maska("bot", "700012345"), maska("brak", "9990000011")], ["b***@example.test", "+48******200", "czat …345", ""]);
});

Deno.test("teksty bota: trzy języki, te same klucze, nazwa klienta jako zwykły tekst", () => {
  const klucze = Object.keys(BOT.pl).sort();
  for (const j of JEZYKI) { assertEquals(Object.keys(BOT[j]).sort(), klucze); for (const k of klucze) assert(BOT[j][k].length > 10 && BOT[j][k].length < 900); assert(BOT[j].ok.includes("/stop") && BOT[j].ok.includes("{nazwa}")); }
  assertEquals(wBocie(BOT.pl.juz, "Alfa\n<b>x</b> {nazwa}").split("\n")[0], "Powiadomienia dla firmy Alfa <b>x</b> {nazwa} są już włączone.");
  for (const j of JEZYKI) assert(!BOT[j].link.includes("{nazwa}"));                // the neutral answer names nobody
  const i = instrukcja("Przykładowa Alfa", "https://t.me/Bot_bot?start=x");
  for (const j of JEZYKI) assert(i[j].includes("https://t.me/Bot_bot?start=x") && i[j].includes("/stop") && i[j].includes("Przykładowa Alfa"));
});

Deno.test("szablon „Koniec rozsyłek w grupach”: poprawna treść w trzech językach z przyciskiem klienta", () => {
  const s = szablonKoniecGrup("2026-11-01"), c = czyscTresc(s.tresc);
  assert(c.ok);
  assertEquals(c.tresc, s.tresc);                                                   // already in the stored shape
  assertEquals(s.tresc.przyciski, [{ etykieta: { pl: "Włącz powiadomienia", ru: "Включить уведомления", uk: "Увімкнути сповіщення" }, url: LINK_SUB }]);
  const d = { firma: "Przykładowa Alfa sp. z o.o.", link_subskrypcji: "https://t.me/Bot_bot?start=" + "c".repeat(32) };
  for (const j of JEZYKI) {
    const t = tekst(s.tresc.tg[j], d);
    assert(t.length < 1200 && t.includes(d.firma) && t.includes("/stop") && t.includes("TD Consulting Group"), j);
    assert(t.includes({ pl: "1 listopada 2026 r.", ru: "1 ноября 2026 г.", uk: "1 листопада 2026 р." }[j]), j);
    assertEquals(klawiatura(s.tresc, j, d)[0][0].url, d.link_subskrypcji);
    assert(s.tresc.mail.tresc[j].includes(LINK_SUB) && s.tresc.sms[j].includes(LINK_SUB));
  }
  assertEquals([s.typ, s.strategia, s.kanaly.grupa, s.kanaly.bot], ["serwisowa", "wszystkie", true, false]);
  assert(tekst(szablonKoniecGrup("").tresc.tg.pl, {}).includes("od najbliższego miesiąca"));
});
