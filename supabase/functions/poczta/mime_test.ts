// deno test -A supabase/functions/poczta/
// Outgoing mail: the message built here is parsed back with the same parser that reads incoming mail.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import PostalMime from "npm:postal-mime@2.4.4";
import { adres, adresy, adresyZNaglowka, budujMime, cytat, nazwaAdres, nazwaPlikuWych, oczyscWychodzacy, slowo, sprawdzZalacznik, tekstZHtml, tematOdp, type Wiadomosc } from "./mime.ts";

const te = new TextEncoder(), td = new TextDecoder();
const PDF = te.encode("%PDF-1.4\n" + "x".repeat(3000)), PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const W = (o: Partial<Wiadomosc> = {}): Wiadomosc => ({
  od: { nazwa: "TD Consulting Group — Kadry", adres: "kadry@td-group.pl" }, do: ["zaneta@firma-alfa.example"], dw: [], udw: [], temat: "Zażółć gęślą jaźń — Привет, мир",
  tekst: "Dzień dobry,\nzałączam umowę.", html: "<p>Dzień dobry,<br><b>załączam</b> umowę.</p>", zalaczniki: [], messageId: "<11111111-2222-4333-8444-555555555555@td-group.pl>", data: new Date("2026-10-09T08:15:00Z"), ...o,
});

Deno.test("addresses: strict; anything that could carry a second header or address is refused", () => {
  for (const ok of ["jan.testowy@firma-alfa.example", "A.B+c@x-y.example", "o'brien@x.example"]) assertEquals(adres(ok), ok.toLowerCase());
  for (const bad of ["", "jan", "jan@", "@x.example", "jan@localhost", "jan@x..example", "jan..t@x.example", "jan @x.example", "jan@x.example\r\nBcc: zly@zly.example", "jan@x.example,zly@zly.example", "Jan <jan@x.example>", "jan@x.example>",
    '"jan"@x.example', "jan@x.example\n", "jan@[127.0.0.1]", "jan@-x.example", "żaneta@x.example", "jan@x.example\u0000", "a".repeat(65) + "@x.example", null, 5, {}]) assertEquals(adres(bad), null, JSON.stringify(bad));
  assertEquals(adresy(["jan@x.example", " JAN@x.example ", "anna@x.example"], 20), { ok: ["jan@x.example", "anna@x.example"], zle: [] });
  assertEquals(adresy("jan@x.example; anna@x.example,ktos@x.example", 20).ok.length, 3);
  assertEquals(adresy(["jan@x.example\r\nBcc: zly@zly.example", "ok@x.example"], 20), { ok: ["ok@x.example"], zle: ["jan@x.example Bcc: zly@zly.example"] });
  assert(adresy(Array.from({ length: 25 }, (_, i) => `a${i}@x.example`), 20).zle.length === 1);
  assertEquals(adresyZNaglowka('"Kowalski, Jan" <jan@x.example>, =?UTF-8?B?xbs=?= <ANNA@x.example>; brak; jan@x.example'), ["jan@x.example", "anna@x.example"]);
});

Deno.test("headers: Polish and Cyrillic are RFC 2047 words; CR/LF can never start a new header", () => {
  assertEquals(slowo("Zwykly temat 123"), "Zwykly temat 123");
  const s = slowo("Zażółć gęślą jaźń — Привет, мир и очень длинная тема письма, которая не помещается в одну строку заголовка");
  assert(s.split("\r\n ").every((w) => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(w) && w.length <= 66), s);
  assertEquals(slowo("Temat\r\nBcc: zly@zly.example\r\n\r\nTresc"), "Temat Bcc: zly@zly.example Tresc");
  assert(!/[\r\n]/.test(slowo("Zażółć\r\nBcc: zly@zly.example")));
  assertEquals(slowo("=?UTF-8?B?podstawiony?="), "=?UTF-8?B?PT9VVEYtOD9CP3BvZHN0YXdpb255Pz0=?="); // a ready-made encoded word is itself encoded
  assertEquals(nazwaAdres("Biuro TD", "kadry@td-group.pl"), "Biuro TD <kadry@td-group.pl>");
  assert(nazwaAdres('Zły" <zly@zly.example>\r\nBcc: x@zly.example', "kadry@td-group.pl").endsWith(" <kadry@td-group.pl>") && !/[\r\n]B|zly@zly\.example>/.test(nazwaAdres('Zły" <zly@zly.example>\r\nBcc: x@zly.example', "kadry@td-group.pl").replace(/\r\n /g, "")));
  assertEquals(nazwaPlikuWych("../../etc/pas\r\nswd‮.pdf"), "_.._etc_pas swd .pdf");
  assertEquals(nazwaPlikuWych(""), "zalacznik");
  assertEquals([tematOdp("reply", "Urlop"), tematOdp("reply", "RE: Urlop"), tematOdp("reply", "Odp: Urlop"), tematOdp("forward", "Urlop"), tematOdp("forward", "Fwd: Urlop"), tematOdp("reply", "a\r\nBcc: x")], ["Re: Urlop", "RE: Urlop", "Odp: Urlop", "Fwd: Urlop", "Fwd: Urlop", "Re: a Bcc: x"]);
});

Deno.test("MIME: alternative + related + mixed round-trips through the parser; lines stay short; Bcc only in the kept copy", async () => {
  const w = W({ dw: ["biuro@firma-alfa.example"], udw: ["ukryty@firma-beta.example"], html: '<p>Zobacz <img src="cid:obraz1"> i <a href="https://td-group.pl/x?a=1&amp;b=2">stronę</a></p>' + "<p>" + "bardzo długi akapit ".repeat(200) + "</p>",
    zalaczniki: [{ nazwa: "logo.png", typ: "image/png", bytes: PNG, cid: "obraz1" }, { nazwa: "Umowa zlecenie — Żółć №1.pdf", typ: "application/pdf", bytes: PDF }, { nazwa: "Счёт.pdf", typ: "application/pdf", bytes: PDF }],
    inReplyTo: "<orig@firma-alfa.example>", refs: ["<r0@firma-alfa.example>", "<orig@firma-alfa.example>"], potwierdzenie: true, pilna: true });
  const raw = budujMime(w), text = td.decode(raw);
  assert(text.split("\r\n").every((l) => l.length <= 78), "long line: " + text.split("\r\n").find((l) => l.length > 78));
  assert(!/[^\r]\n/.test(text) && !/\r[^\n]/.test(text)); // CRLF only
  assert(!/^Bcc:/mi.test(text) && !text.includes("ukryty@"));
  assert(/^Bcc: ukryty@firma-beta\.example$/m.test(td.decode(budujMime(w, true))));
  // deno-lint-ignore no-explicit-any
  const m: any = await PostalMime.parse(raw);
  assertEquals([m.from.name, m.from.address, m.to.map((x: { address: string }) => x.address), m.cc[0].address, m.subject, m.messageId, m.inReplyTo, m.references], ["TD Consulting Group — Kadry", "kadry@td-group.pl", ["zaneta@firma-alfa.example"], "biuro@firma-alfa.example", w.temat, w.messageId, "<orig@firma-alfa.example>", "<r0@firma-alfa.example> <orig@firma-alfa.example>"]);
  assertEquals(m.replyTo[0].address, "kadry@td-group.pl");
  assertEquals(m.date, "2026-10-09T08:15:00.000Z");
  assertEquals(m.text.trim(), w.tekst);
  assert(m.html.includes('<img src="cid:obraz1">') && m.html.includes("bardzo długi akapit"));
  assertEquals(m.attachments.map((a: { filename: string; mimeType: string; disposition: string; contentId?: string; content: ArrayBuffer }) => [a.filename, a.mimeType, a.disposition, a.contentId ?? "", a.content.byteLength]),
    [["logo.png", "image/png", "inline", "<obraz1>", PNG.length], ["Umowa zlecenie — Żółć №1.pdf", "application/pdf", "attachment", "", PDF.length], ["Счёт.pdf", "application/pdf", "attachment", "", PDF.length]]);
  const hd = Object.fromEntries(m.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
  assertEquals([hd["disposition-notification-to"], hd["importance"], hd["mime-version"]], ["kadry@td-group.pl", "High", "1.0"]);
  // the simplest message has no needless nesting
  const prosty = td.decode(budujMime(W()));
  assert(/^Content-Type: multipart\/alternative;/m.test(prosty) && !/multipart\/(mixed|related)/.test(prosty));
  // many recipients fold at commas
  const wielu = td.decode(budujMime(W({ do: Array.from({ length: 20 }, (_, i) => `odbiorca-numer-${i}@firma-alfa.example`) })));
  assert(wielu.split("\r\n").every((l) => l.length <= 78));
});

Deno.test("MIME: what must not be built is refused", () => {
  for (const o of [{ do: ["jan@x.example\r\nBcc: zly@zly.example"] }, { dw: ["Jan <jan@x.example>"] }, { udw: [""] }, { od: { nazwa: "x", adres: "kadry@td-group.pl\r\nX: 1" } }, { messageId: "<a@b>\r\nBcc: zly@zly.example" }, { messageId: "bez-nawiasow@td-group.pl" },
    { inReplyTo: "<a@b> <c@d>" }, { refs: ["<ok@x.example>", "zle\r\nX: 1"] }, { szkicId: "x\r\nBcc: a@b.example" }, { zalaczniki: [{ nazwa: "a.svg", typ: "image/svg+xml", bytes: PNG, cid: "c1" }] }, { zalaczniki: [{ nazwa: "a.png", typ: "image/png", bytes: PNG, cid: "c1>\r\nX: 1" }] },
    { zalaczniki: [{ nazwa: "a.pdf", typ: "application/pdf\r\nX-Zly: 1", bytes: PDF }] }] as Partial<Wiadomosc>[]) assertThrows(() => budujMime(W(o)), Error, "mime:", JSON.stringify(o).slice(0, 80));
  // a hostile file name stays inside its parameter
  const t = td.decode(budujMime(W({ zalaczniki: [{ nazwa: 'a".pdf\r\nContent-Type: text/html\r\n\r\n<script>', typ: "application/pdf", bytes: PDF }] })));
  assert(!/^Content-Type: text\/html\r?$/m.test(t.split("--=_portal").pop()!.split("\r\n\r\n")[0]) && !t.includes("<script>"));
  assertEquals(t.split("\r\n").filter((l) => /^Content-Type: text\/html$/.test(l)).length, 0);
});

Deno.test("attachments: the content must match the extension; programs, scripts and pages are refused", () => {
  const ok = (n: string, b: Uint8Array) => { const r = sprawdzZalacznik(n, b); return r.ok ? r.typ : "ODRZUCONY"; };
  assertEquals([ok("umowa.pdf", PDF), ok("skan.PNG", PNG), ok("zdjecie.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), ok("lista.xlsx", new Uint8Array([0x50, 0x4b, 3, 4, 0])), ok("stary.doc", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), ok("dane.csv", te.encode("a;b\n1;2"))],
    ["application/pdf", "image/png", "image/jpeg", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/msword", "text/csv"]);
  const MZ = new Uint8Array([0x4d, 0x5a, 0x90, 0]);
  for (const [n, b] of [["program.exe", MZ], ["faktura.pdf", MZ], ["faktura.pdf.exe", PDF], ["skrypt.js", te.encode("alert(1)")], ["strona.html", te.encode("<script>")], ["obraz.svg", te.encode("<svg onload=x>")], ["makro.docm", new Uint8Array([0x50, 0x4b, 3, 4])],
    ["plik.bat", te.encode("del")], ["skrot.lnk", MZ], ["archiwum.jar", new Uint8Array([0x50, 0x4b, 3, 4])], ["bez_rozszerzenia", PDF], ["notatka.txt", MZ], ["dane.csv", new Uint8Array([0x7f, 0x45, 0x4c, 0x46])], ["skrypt.txt", te.encode("#!/bin/sh\nrm -rf /")],
    ["zdjecie.png", PDF], ["pusty.pdf", new Uint8Array(0)], ["umowa.pdf", te.encode("<html>")]] as [string, Uint8Array][]) assertEquals(ok(n, b), "ODRZUCONY", n);
});

Deno.test("outgoing HTML: only the short allow-list leaves; remote pictures and anything active are dropped", () => {
  const h = oczyscWychodzacy('<p style="color:#b91c1c;text-align:center;position:fixed;background:url(https://zly.example/x)">A <b>B</b> <i>C</i> <u>D</u></p><h2>Nagłówek</h2><ul><li>jeden</li></ul><blockquote>cytat</blockquote>' +
    '<a href="https://td-group.pl/x" onclick="x()" target="_top">link</a><a href="javascript:alert(1)">zły</a><script>alert(1)</script><style>p{color:red}</style><img src="https://zly.example/pixel.gif"><img src="cid:moj1" width="120" onerror="x">' +
    '<img src="cid:obcy"><img src="data:image/png;base64,AAAA"><iframe src="https://zly.example"></iframe><form action="https://zly.example"><input name="x"></form><font color="#1B3F7F">kolor</font><font color="expression(1)">zły kolor</font><table><tr><td>komórka</td></tr></table>', new Set(["moj1"]));
  assert(h.includes('<p style="color:#b91c1c;text-align:center">A <b>B</b> <i>C</i> <u>D</u></p><h2>Nagłówek</h2><ul><li>jeden</li></ul><blockquote>cytat</blockquote><a href="https://td-group.pl/x">link</a><a>zły</a>'), h);
  assert(h.includes('<img src="cid:moj1" alt="" width="120" />') && h.includes('<span style="color:#1B3F7F">kolor</span>') && h.includes("<span>zły kolor</span>") && h.includes("komórka"));
  assert(!/script|style>|iframe|form|input|onclick|onerror|zly\.example|javascript|data:|cid:obcy|target|position|url\(|table/i.test(h), h);
  assertEquals(tekstZHtml('<p>Zobacz <a href="https://td-group.pl/x?a=1&amp;b=2">naszą stronę</a> albo <a href="mailto:kadry@td-group.pl">kadry@td-group.pl</a>.</p><ul><li>jeden</li><li>dwa</li></ul>'), "Zobacz naszą stronę (https://td-group.pl/x?a=1&b=2) albo kadry@td-group.pl.\n• jeden\n• dwa");
});

Deno.test("quoting: a reply gets the attribution line and '>' lines; a forward gets the header block; remote pictures do not travel on", () => {
  const o = { od: "Żaneta Przykładowa <zaneta@firma-alfa.example>", data: "09.10.2026", temat: "Urlop <pilne>", do: "kadry@td-group.pl", html: '<p>Proszę o <b>urlop</b>.</p><img alt="x" data-zdalne="https://sledz.example/p.gif"><img src="data:image/png;base64,AAAA">', tekst: "Proszę o urlop.\nOd poniedziałku." };
  const r = cytat("reply", o);
  assert(r.html.startsWith("<p>W dniu 09.10.2026 Żaneta Przykładowa &lt;zaneta@firma-alfa.example&gt; napisał(a):</p><blockquote") && r.html.includes("<b>urlop</b>") && !r.html.includes("sledz.example") && r.html.includes("data:image/png"));
  assertEquals(r.tekst, "W dniu 09.10.2026 Żaneta Przykładowa <zaneta@firma-alfa.example> napisał(a):\n> Proszę o urlop.\n> Od poniedziałku.");
  const f = cytat("forward", o);
  assert(f.html.includes("---------- Przekazana wiadomość ----------") && f.html.includes("<b>Temat:</b> Urlop &lt;pilne&gt;") && f.tekst.includes("Temat: Urlop <pilne>\nDo: kadry@td-group.pl\n\nProszę o urlop."));
  // a text-only original is escaped, not interpreted
  assert(cytat("reply", { ...o, html: "", tekst: "<script>alert(1)</script>\nlinia 2" }).html.includes("&lt;script&gt;alert(1)&lt;/script&gt;<br>linia 2"));
});
