// deno test -A supabase/functions/poczta/
// The IMAP client against a small fake server (in memory, fictional messages). The fake server records every
// command and keeps \Seen flags the way a real one does, so "read-only" is checked, not assumed.
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { type Conn, guard, Imap, POLA, quote } from "./imap.ts";

const te = new TextEncoder(), td = new TextDecoder();
export type FakeMsg = { uid: number; raw: string; seen: boolean };
export class FakeServer implements Conn {
  log: string[] = [];
  private out: Uint8Array[] = [];
  private pending = "";
  private waiters: (() => void)[] = [];
  selected: "none" | "ro" | "rw" = "none";
  closed = false;
  constructor(public box: FakeMsg[], public uidvalidity = 7, private pass = "haslo \"z\" \\ znakami", private chunk = 7) { this.push("* OK fake IMAP ready\r\n"); }
  private push(s: string | Uint8Array) {
    const b = typeof s === "string" ? te.encode(s) : s;
    for (let i = 0; i < b.length; i += this.chunk) this.out.push(b.slice(i, i + this.chunk)); // tiny chunks: buffering is exercised
    this.waiters.splice(0).forEach((w) => w());
  }
  async read(p: Uint8Array): Promise<number | null> {
    while (!this.out.length) { if (this.closed) return null; await new Promise<void>((r) => this.waiters.push(r)); }
    const c = this.out.shift()!;
    p.set(c);
    return c.length;
  }
  write(p: Uint8Array): Promise<number> {
    this.pending += td.decode(p);
    let i;
    while ((i = this.pending.indexOf("\r\n")) >= 0) { const line = this.pending.slice(0, i); this.pending = this.pending.slice(i + 2); this.handle(line); }
    return Promise.resolve(p.length);
  }
  close() { this.closed = true; this.waiters.splice(0).forEach((w) => w()); }
  private handle(line: string) {
    const [tag, ...rest] = line.split(" ");
    const cmd = rest.join(" ");
    this.log.push(cmd.startsWith("LOGIN") ? "LOGIN ***" : cmd);
    const ok = (t = "OK done") => this.push(`${tag} ${t}\r\n`);
    const sorted = () => this.box.slice().sort((a, b) => a.uid - b.uid);
    let m: RegExpMatchArray | null;
    if ((m = cmd.match(/^LOGIN "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/))) {
      const pass = m[2].replace(/\\(.)/g, "$1");
      return pass === this.pass ? ok("OK [CAPABILITY IMAP4rev1] Logged in") : ok("NO [AUTHENTICATIONFAILED] Authentication failed.");
    }
    if (/^(EXAMINE|SELECT) "INBOX"$/.test(cmd)) {
      this.selected = cmd.startsWith("EXAMINE") ? "ro" : "rw";
      const top = sorted().pop()?.uid ?? 0;
      this.push(`* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n* ${this.box.length} EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY ${this.uidvalidity}] UIDs valid\r\n* OK [UIDNEXT ${top + 1}] Predicted next UID\r\n`);
      return ok(`OK [${this.selected === "ro" ? "READ-ONLY" : "READ-WRITE"}] done`);
    }
    if (cmd === 'LIST "" "*"') { this.push('* LIST (\\HasNoChildren) "." INBOX\r\n'); return ok(); }
    if (/^STATUS "INBOX"/.test(cmd)) {
      const top = sorted().pop()?.uid ?? 0;
      this.push(`* STATUS INBOX (MESSAGES ${this.box.length} UNSEEN ${this.box.filter((x) => !x.seen).length} UIDNEXT ${top + 1} UIDVALIDITY ${this.uidvalidity})\r\n`);
      return ok();
    }
    if ((m = cmd.match(/^UID SEARCH UID (\d+):\*$/))) {
      const from = Number(m[1]), all = sorted();
      const hit = all.filter((x) => x.uid >= from);
      const res = hit.length ? hit : all.slice(-1); // RFC 3501: n:* always includes the last message
      this.push(`* SEARCH${res.map((x) => " " + x.uid).join("")}\r\n`);
      return ok();
    }
    if (cmd === "UID SEARCH UNSEEN") { this.push(`* SEARCH${sorted().filter((x) => !x.seen).map((x) => " " + x.uid).join("")}\r\n`); return ok(); }
    if ((m = cmd.match(/^UID SEARCH HEADER Message-ID "(.*)"$/))) {
      const id = m[1].replace(/\\(.)/g, "$1");
      this.push(`* SEARCH${sorted().filter((x) => x.raw.includes("Message-ID: " + id)).map((x) => " " + x.uid).join("")}\r\n`);
      return ok();
    }
    if ((m = cmd.match(/^FETCH (\d+):(\d+) \(UID\)$/))) {
      sorted().forEach((x, i) => { if (i + 1 >= Number(m![1]) && i + 1 <= Number(m![2])) this.push(`* ${i + 1} FETCH (UID ${x.uid})\r\n`); });
      return ok();
    }
    if ((m = cmd.match(/^UID FETCH (\d+) \((.*)\)$/))) {
      const all = sorted(), idx = all.findIndex((x) => x.uid === Number(m![1]));
      if (idx < 0) return ok("OK nothing");
      const x = all[idx], items = m[2];
      const sec = items.match(/BODY(\.PEEK)?\[([^\]]*)\](?:<0\.(\d+)>)?/);
      let data = te.encode(x.raw);
      if (sec) {
        const end = x.raw.indexOf("\r\n\r\n");
        if (sec[2] === "HEADER") data = te.encode(x.raw.slice(0, end + 4));
        else if (sec[2].startsWith("HEADER.FIELDS")) {
          const want = sec[2].slice(sec[2].indexOf("(") + 1, -1).toLowerCase().split(" ");
          data = te.encode(x.raw.slice(0, end).split(/\r\n(?![ \t])/).filter((h) => want.includes(h.split(":")[0].toLowerCase())).join("\r\n") + "\r\n\r\n");
        }
        if (sec[3]) data = data.slice(0, Number(sec[3]));
        // a real server sets \Seen on BODY[...] without PEEK when the mailbox is open read-write
        if (!sec[1] && this.selected === "rw") x.seen = true;
      }
      this.push(`* ${idx + 1} FETCH (UID ${x.uid} RFC822.SIZE ${te.encode(x.raw).length} INTERNALDATE "09-Oct-2026 10:00:00 +0200" BODY[${sec?.[2] ?? ""}]${sec?.[3] ? "<0>" : ""} {${data.length}}\r\n`);
      this.push(data);
      this.push(` FLAGS (${x.seen ? "\\Seen" : ""}))\r\n`);
      return ok();
    }
    if (cmd === "LOGOUT") { this.push("* BYE bye\r\n"); ok(); return; }
    if (/^(STORE|UID STORE|EXPUNGE|UID EXPUNGE|COPY|UID COPY|MOVE|UID MOVE|DELETE|APPEND|CREATE|RENAME|CLOSE)\b/.test(cmd)) { this.box.length = 0; return ok(); } // destructive: the test would notice
    ok("BAD unknown");
  }
}
export const wiad = (uid: number, id: string, body = "Treść", extra = "") => ({
  uid, seen: false,
  raw: `From: Nadawca ${uid} <n${uid}@firma-alfa.example>\r\nTo: kadry@td-group.pl\r\nSubject: Sprawa ${uid}\r\nDate: Fri, 09 Oct 2026 10:00:00 +0200\r\nMessage-ID: ${id}\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`,
});
const PASS = 'haslo "z" \\ znakami';

Deno.test("guard: only the read-only commands can be sent", () => {
  for (const ok of ['LOGIN "a" "b"', 'EXAMINE "INBOX"', 'STATUS "INBOX" (MESSAGES UNSEEN)', "UID SEARCH UID 5:*", "UID SEARCH UNSEEN", "FETCH 1:3 (UID)", "UID FETCH 5 (UID RFC822.SIZE INTERNALDATE BODY.PEEK[])", "UID FETCH 5 (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID DATE)]<0.100>)", "NOOP", "LOGOUT"]) guard(ok);
  for (const bad of ['SELECT "INBOX"', "UID STORE 5 +FLAGS (\\Seen)", "STORE 1 +FLAGS (\\Deleted)", "EXPUNGE", "UID EXPUNGE 5", "UID COPY 5 Trash", "UID MOVE 5 Trash", 'DELETE "INBOX"', 'APPEND "INBOX" {5}', "CLOSE", 'CREATE "x"', 'RENAME "a" "b"',
    "UID FETCH 5 (BODY[])", "UID FETCH 5 (RFC822)", "UID FETCH 5 (RFC822.TEXT)", "UID FETCH 5 (BODY.PEEK[] BODY[TEXT])", "UID FETCH 5 (BINARY[1])", "FETCH 1 (BODY[HEADER])",
    "NOOP\r\nA2 STORE 1 +FLAGS (\\Deleted)", "UID SEARCH ALL\nx DELETE INBOX", "noop", ""]) assertThrows(() => guard(bad), Error, undefined, bad);
  assertEquals(quote('a"b\\c'), '"a\\"b\\\\c"');
  for (const bad of ["a\r\nb", "a\nb", "zażółć", "a\u0000"]) assertThrows(() => quote(bad));
});

Deno.test("login, EXAMINE, searches and PEEK fetches work across chunk boundaries and literals", async () => {
  const srv = new FakeServer([wiad(11, "<a@x.example>"), wiad(12, "<b@x.example>", "Zażółć gęślą jaźń {5}\r\nlinia z nawiasem)"), wiad(15, "<c@x.example>", "x".repeat(5000))]);
  const im = new Imap(srv, 2000);
  await im.login("kadry@td-group.pl", PASS);
  const st = await im.status();
  assertEquals(st, { messages: 3, unseen: 3, uidnext: 16, uidvalidity: 7 });
  assertEquals(await im.examine(), { exists: 3, uidvalidity: 7, uidnext: 16 });
  assertEquals(await im.uidsAfter(11), [12, 15]);
  assertEquals(await im.uidsAfter(15), []);   // "16:*" answers with the last message (15): filtered out
  assertEquals(await im.uidsAfter(0), [11, 12, 15]);
  assertEquals(await im.newestUids(3, 2), [12, 15]);
  assertEquals(await im.newestUids(3, 20), [11, 12, 15]);
  assertEquals(await im.newestUids(0, 5), []);
  assertEquals(await im.uidsByMessageId("<b@x.example>"), [12]);
  const f = await im.fetch(12);
  assertEquals(new TextDecoder().decode(f!.body), srv.box[1].raw); // bytes intact, incl. a "{5}" inside the body
  assertEquals([f!.uid, f!.size, f!.internaldate], [12, new TextEncoder().encode(srv.box[1].raw).length, "09-Oct-2026 10:00:00 +0200"]);
  const h = await im.fetch(12, "HEADER.FIELDS (MESSAGE-ID DATE FROM TO SUBJECT)");
  assert(new TextDecoder().decode(h!.body).includes("Message-ID: <b@x.example>") && !new TextDecoder().decode(h!.body).includes("Content-Type"));
  assertEquals((await im.fetch(15, "", 100))!.body.length, 100);
  assertEquals(await im.fetch(999), null);
  await assertRejects(() => im.fetch(12, "1.2] BODY[")); // a section cannot smuggle another item in
  assertEquals(await im.uidsUnseen(), [11, 12, 15]);
  await im.logout();
  // nothing was marked as read, nothing else was ever sent
  assert(srv.box.every((x) => !x.seen) && srv.box.length === 3);
  assertEquals(srv.selected, "ro");
  assert(srv.log.every((c) => /^(LOGIN \*\*\*|EXAMINE |STATUS |UID SEARCH |FETCH \d+:\d+ \(UID\)|UID FETCH \d+ \(UID RFC822\.SIZE INTERNALDATE BODY\.PEEK\[|LOGOUT)/.test(c)), srv.log.join(" | "));
});

Deno.test("a wrong password fails without echoing it; a mailbox opened read-write is refused; silence times out", async () => {
  const srv = new FakeServer([wiad(1, "<a@x.example>")]);
  const im = new Imap(srv, 2000);
  const e = await assertRejects(() => im.login("kadry@td-group.pl", "zle-haslo-123"), Error);
  assert(/LOGIN odrzucone/.test(e.message) && !e.message.includes("zle-haslo-123") && !e.message.includes("kadry@"), e.message);
  // a server that answers EXAMINE without [READ-ONLY]
  const rw: Conn = (() => { const s = new FakeServer([wiad(1, "<a@x.example>")]); const w = s.write.bind(s); s.write = (p) => w(new TextEncoder().encode(new TextDecoder().decode(p).replace("EXAMINE", "SELECT"))); return s; })();
  const im2 = new Imap(rw, 2000);
  await im2.login("u", PASS);
  await assertRejects(() => im2.examine(), Error, "tylko do odczytu");
  const dead: Conn = { read: () => new Promise(() => {}), write: (p) => Promise.resolve(p.length), close() {} };
  await assertRejects(() => new Imap(dead, 50).login("u", "p"), Error, "przekroczono czas");
  const big = new Imap(new FakeServer([wiad(1, "<a@x.example>", "y".repeat(3000))]), 2000, 1000);
  await big.login("u", PASS); await big.examine();
  await assertRejects(() => big.fetch(1), Error, "limit");
});

// ---------------------------------------------------------------- mailbox browser commands on the wire
// A scripted server working on bytes: it honours literals ("{n}" -> "+ go ahead" -> n bytes) and records
// exactly what the client sent.
class Skrypt implements Conn {
  sent: { text: string; literals: Uint8Array[] }[] = [];
  private out: Uint8Array[] = [te.encode("* OK ready\r\n")];
  private buf = new Uint8Array(0);
  private cur = { text: "", literals: [] as Uint8Array[] };
  private need = 0;
  private waiters: (() => void)[] = [];
  constructor(private answer: (cmd: string, literals: Uint8Array[]) => (string | Uint8Array)[], private odmowLiteralu = false) {}
  private push(...parts: (string | Uint8Array)[]) { for (const p of parts) { const b = typeof p === "string" ? te.encode(p) : p; for (let i = 0; i < b.length; i += 11) this.out.push(b.slice(i, i + 11)); } this.waiters.splice(0).forEach((w) => w()); }
  async read(p: Uint8Array) { while (!this.out.length) await new Promise<void>((r) => this.waiters.push(r)); const c = this.out.shift()!; p.set(c); return c.length; }
  write(p: Uint8Array) {
    const n = new Uint8Array(this.buf.length + p.length); n.set(this.buf); n.set(p, this.buf.length); this.buf = n;
    for (;;) {
      if (this.need) { if (this.buf.length < this.need) break; this.cur.literals.push(this.buf.slice(0, this.need)); this.buf = this.buf.slice(this.need); this.need = 0; continue; }
      const i = this.buf.findIndex((b, k) => b === 13 && this.buf[k + 1] === 10);
      if (i < 0) break;
      const line = td.decode(this.buf.slice(0, i)); this.buf = this.buf.slice(i + 2);
      const m = line.match(/\{(\d+)\}$/);
      if (m) {
        this.cur.text += line.slice(0, m.index) + `{${this.cur.literals.length}}`;
        if (this.odmowLiteralu) { this.push(`${this.cur.text.split(" ")[0]} BAD literal refused\r\n`); this.cur = { text: "", literals: [] }; continue; }
        this.need = Number(m[1]); this.push("+ go ahead\r\n"); continue;
      }
      this.cur.text += line;
      const [tag, ...rest] = this.cur.text.split(" ");
      const cmd = rest.join(" ");
      this.sent.push({ text: cmd.startsWith("LOGIN") ? "LOGIN ***" : cmd, literals: this.cur.literals });
      if (cmd.startsWith("EXAMINE")) this.push("* 0 EXISTS\r\n* OK [UIDVALIDITY 1] ok\r\n* OK [UIDNEXT 1] ok\r\n");
      this.push(...this.answer(cmd, this.cur.literals), `${tag} OK ${cmd.startsWith("EXAMINE") ? "[READ-ONLY] " : ""}done\r\n`);
      this.cur = { text: "", literals: [] };
    }
    return Promise.resolve(p.length);
  }
  close() {}
}
const lit = (s: string) => { const b = te.encode(s); return [`{${b.length}}\r\n`, b] as (string | Uint8Array)[]; };

Deno.test("LIST: flags, delimiter, quoted / atom / literal names, special-use, modified UTF-7", async () => {
  const srv = new Skrypt((cmd) => cmd === 'LIST "" "*"' ? [
    '* LIST (\\HasChildren) "." INBOX\r\n', '* LIST (\\HasNoChildren \\Sent) "." "INBOX.Sent"\r\n', '* LIST (\\HasNoChildren) "." "INBOX.Wys&AUI-ane \\"stare\\""\r\n',
    '* LIST (\\Noselect \\HasChildren) "." "INBOX.Klienci"\r\n', "* LIST (\\HasNoChildren) \".\" ", ...lit("INBOX.Klienci.Alfa (2026)"), "\r\n", '* LIST (\\Trash) NIL Kosz\r\n', "* 3 EXISTS\r\n",
  ] : []);
  const im = new Imap(srv, 2000);
  const l = await im.list();
  assertEquals(l.map((f) => [f.raw, f.nazwa, f.delim, f.flagi.join(" ")]), [
    ["INBOX", "INBOX", ".", "\\HasChildren"], ["INBOX.Sent", "INBOX.Sent", ".", "\\HasNoChildren \\Sent"], ['INBOX.Wys&AUI-ane "stare"', 'INBOX.Wysłane "stare"', ".", "\\HasNoChildren"],
    ["INBOX.Klienci", "INBOX.Klienci", ".", "\\Noselect \\HasChildren"], ["INBOX.Klienci.Alfa (2026)", "INBOX.Klienci.Alfa (2026)", ".", "\\HasNoChildren"], ["Kosz", "Kosz", "/", "\\Trash"]]);
  // opening and counting a folder whose name has quotes and a backslash: escaped inside a quoted string
  await im.examine('INBOX.Wys&AUI-ane "stare"'); await im.status("A\\B");
  assertEquals(srv.sent.slice(1).map((c) => c.text), ['EXAMINE "INBOX.Wys&AUI-ane \\"stare\\""', 'STATUS "A\\\\B" (MESSAGES UNSEEN UIDNEXT UIDVALIDITY)']);
  // a non-ASCII name goes as a literal; CR/LF never goes at all
  await im.examine("Wysłane");
  assertEquals([srv.sent[3].text, td.decode(srv.sent[3].literals[0])], ["EXAMINE {0}", "Wysłane"]);
  await assertRejects(() => im.examine('INBOX"\r\nA9 DELETE "INBOX'));
  await assertRejects(() => im.status("INBOX\nx"));
  assertEquals(srv.sent.length, 4);
});

Deno.test("search: the text travels as UTF-8 literals — quotes, parentheses and IMAP words in it are just text", async () => {
  const srv = new Skrypt((cmd) => cmd.startsWith("UID SEARCH") ? ["* SEARCH 12 7 30\r\n"] : []);
  const im = new Imap(srv, 2000);
  const zly = 'żółć" OR ALL) UID STORE 1:* +FLAGS (\\Deleted';
  assertEquals(await im.szukaj({ tekst: zly, nieprzeczytane: true, od: "2026-10-01", do: "2026-10-09" }), [7, 12, 30]);
  assertEquals(srv.sent[0].text, "UID SEARCH CHARSET UTF-8 OR OR SUBJECT {0} FROM {1} TO {2} UNSEEN SINCE 1-Oct-2026 BEFORE 10-Oct-2026");
  assertEquals(srv.sent[0].literals.map((b) => td.decode(b)), [zly, zly, zly]);
  assertEquals(await im.szukaj({}), [7, 12, 30]);
  assertEquals(srv.sent[1].text, "UID SEARCH ALL");
  for (const tekst of ["a\r\nb", "a\nb UID STORE", "x".repeat(101)]) await assertRejects(() => im.szukaj({ tekst }));
  await assertRejects(() => im.szukaj({ od: "1-Oct-2026 OR ALL" }));
  assertEquals(srv.sent.length, 2);
  // a server that refuses the literal: an error, and the bytes are never sent
  const no = new Skrypt(() => [], true);
  await assertRejects(() => new Imap(no, 2000).szukaj({ tekst: "żółć" }), Error, "SEARCH odrzucone");
  assertEquals(no.sent.length, 0);
});

Deno.test("meta and part: flags, size, structure and header literal are read; parts only through PEEK", async () => {
  const head = "From: =?UTF-8?B?xbthbmV0YQ==?= <z@firma-alfa.example>\r\nSubject: Test (z nawiasem) {7}\r\n\r\n";
  const srv = new Skrypt((cmd) => {
    if (cmd.startsWith("UID FETCH 5,9 ")) return [
      '* 1 FETCH (UID 5 FLAGS (\\Seen \\Answered) INTERNALDATE "08-Oct-2026 09:00:00 +0200" RFC822.SIZE 2300 BODYSTRUCTURE ("text" "plain" ("charset" "utf-8") NIL NIL "8bit" 20 1 NIL NIL NIL NIL) BODY[HEADER.FIELDS (' + POLA + ')] ', ...lit(head), ")\r\n",
      '* 2 FETCH (FLAGS () UID 9 RFC822.SIZE 99 INTERNALDATE "09-Oct-2026 09:00:00 +0200" BODYSTRUCTURE (("text" "plain" NIL NIL NIL "7bit" 1 1)("application" "pdf" ("name" ', ...lit('dziwna "nazwa".pdf'), ') NIL NIL "base64" 400 NIL ("attachment" NIL)) "mixed") BODY[HEADER.FIELDS (' + POLA + ')] ""' + ")\r\n",
      "* 3 FETCH (FLAGS (\\Seen))\r\n",
    ];
    if (cmd.startsWith("FETCH 3:4 ")) return ['* 3 FETCH (UID 30 FLAGS () INTERNALDATE "x" RFC822.SIZE 1 BODYSTRUCTURE NIL)\r\n'];
    if (cmd.startsWith("UID FETCH 9 (UID BODY.PEEK[2]")) return ["* 2 FETCH (UID 9 BODY[2]<0> ", ...lit("JVBERi0x"), ")\r\n"];
    return [];
  });
  const im = new Imap(srv, 2000);
  const m = await im.meta([5, 9, 0, -3], true, true);
  assertEquals(srv.sent[0].text, "UID FETCH 5,9 (UID FLAGS INTERNALDATE RFC822.SIZE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (" + POLA + ")])");
  assertEquals(m.map((x) => [x.uid, x.flagi.join(","), x.size, x.internaldate]), [[5, "\\Seen,\\Answered", 2300, "08-Oct-2026 09:00:00 +0200"], [9, "", 99, "09-Oct-2026 09:00:00 +0200"]]);
  assertEquals(td.decode(m[0].sekcje["BODY[HEADER.FIELDS (" + POLA + ")]"]), head);
  const { czesci } = await import("./widok.ts");
  assertEquals(czesci(m[1].bs).map((c) => [c.id, c.typ, c.nazwa, c.zalacznik]), [["1", "text/plain", "", false], ["2", "application/pdf", 'dziwna "nazwa".pdf', true]]);
  assertEquals((await im.meta({ od: 3, do: 4 }, false, false)).map((x) => x.uid), [30]);
  assertEquals(srv.sent[1].text, "FETCH 3:4 (UID FLAGS INTERNALDATE RFC822.SIZE BODYSTRUCTURE)");
  assertEquals(await im.meta([], true, true), []);
  assertEquals(td.decode((await im.part(9, "2", 600))!), "JVBERi0x");
  assertEquals(srv.sent[2].text, "UID FETCH 9 (UID BODY.PEEK[2]<0.600>)");
  assertEquals(await im.part(9, "3"), null);
  for (const id of ["", "TEXT", "1.HEADER", "1] BODY[1", "1)\r\nx STORE", "1.2.3.4.5.6.7.8.9.10.11.12.13.14"]) await assertRejects(() => im.part(9, id));
  assert(srv.sent.every((c) => !/BODY\[/.test(c.text.replace(/BODY\.PEEK\[/g, ""))));
});
