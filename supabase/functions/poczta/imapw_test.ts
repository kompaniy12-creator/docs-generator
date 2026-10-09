// deno test -A supabase/functions/poczta/
// The controlled write path: what it can do, and — above all — what it cannot.
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import type { Conn, Folder } from "./imap.ts";
import { guardZapis, ImapZapis } from "./imapw.ts";

const te = new TextEncoder(), td = new TextDecoder();
const F = (raw: string, flagi: string[] = []): Folder => ({ raw, nazwa: raw, delim: ".", flagi });

Deno.test("write guard: only APPEND, the four flags, UID MOVE, one-UID expunge and the read-only commands pass", () => {
  for (const ok of ['SELECT "INBOX"', "SELECT {7}", 'APPEND "INBOX.Sent" (\\Seen) {120}', 'APPEND "INBOX.Drafts" (\\Seen \\Draft) {9}', "APPEND {8} () {5}",
    "UID STORE 7 +FLAGS.SILENT (\\Seen)", "UID STORE 7,8,9 -FLAGS.SILENT (\\Seen \\Flagged)", "UID STORE 5 +FLAGS.SILENT (\\Answered)", "UID STORE 5 +FLAGS.SILENT ($Forwarded)",
    "UID STORE 5 +FLAGS.SILENT (\\Deleted)", "UID EXPUNGE 5", 'UID MOVE 5,6 "INBOX.Trash"', "UID MOVE 5 {9}", "CAPABILITY",
    'EXAMINE "INBOX"', 'LIST "" "*"', "UID FETCH 5 (UID BODY.PEEK[1])", "UID SEARCH ALL", "LOGOUT"]) guardZapis(ok);
  for (const bad of ["EXPUNGE", "UID EXPUNGE 1:*", "UID EXPUNGE 5,6", "UID EXPUNGE 5:9", "CLOSE", 'DELETE "INBOX.Stare"', 'RENAME "A" "B"', 'CREATE "Nowy"', 'SUBSCRIBE "x"', 'UNSUBSCRIBE "x"',
    "UID STORE 1:* +FLAGS.SILENT (\\Deleted)", "UID STORE 5,6 +FLAGS.SILENT (\\Deleted)", "UID STORE 5 -FLAGS.SILENT (\\Deleted)", "UID STORE 5 +FLAGS.SILENT (\\Seen \\Deleted)", "UID STORE 5 +FLAGS (\\Seen)", "UID STORE 5 FLAGS.SILENT (\\Seen)",
    "UID STORE 5 +FLAGS.SILENT (\\Draft)", "UID STORE 5 +FLAGS.SILENT ($Junk)", "UID STORE 5 +FLAGS.SILENT (NonJunk)", "UID STORE 5 +FLAGS.SILENT ()", "STORE 1:* +FLAGS.SILENT (\\Seen)", "UID STORE 1:* +FLAGS.SILENT (\\Seen)",
    'UID COPY 5 "INBOX.Trash"', 'COPY 1:* "x"', 'MOVE 1:* "INBOX.Trash"', 'UID MOVE 1:* "INBOX.Trash"', "UID MOVE 5 INBOX.Trash", 'UID MOVE 5 "a" "b"',
    'APPEND "INBOX" (\\Seen \\Deleted) {5}', 'APPEND "INBOX" (\\Flagged) {5}', 'APPEND "x" (\\Seen) "tekst"', 'APPEND "x" (\\Seen) {5}\r\nA2 DELETE "INBOX"',
    'SELECT "INBOX" (CONDSTORE)', "UID FETCH 5 (BODY[1])", 'SETACL "INBOX" anyone lrswipkxtecda', 'SETQUOTA "" (STORAGE 1)', "AUTHENTICATE PLAIN", "STARTTLS", "IDLE", "ENABLE QRESYNC", "UID SORT (DATE) UTF-8 ALL", ""]) {
    assertThrows(() => guardZapis(bad), Error, undefined, bad);
  }
});

// a scripted server: answers OK to everything, with the tagged text given per command
function serwer(odp: (cmd: string) => string = () => "OK done") {
  const sent: { text: string; literal?: Uint8Array }[] = [];
  let out: Uint8Array[] = [te.encode("* OK ready\r\n")], buf = new Uint8Array(0), need = 0, cur = "", lit: Uint8Array | undefined;
  const waiters: (() => void)[] = [];
  const push = (s: string) => { out.push(te.encode(s)); waiters.splice(0).forEach((w) => w()); };
  const c: Conn = {
    async read(p) { while (!out.length) await new Promise<void>((r) => waiters.push(r)); const x = out.shift()!; p.set(x); return x.length; },
    write(p) {
      const n = new Uint8Array(buf.length + p.length); n.set(buf); n.set(p, buf.length); buf = n;
      for (;;) {
        if (need) { if (buf.length < need) break; lit = buf.slice(0, need); buf = buf.slice(need); need = 0; continue; }
        const i = buf.findIndex((b, k) => b === 13 && buf[k + 1] === 10);
        if (i < 0) break;
        const line = td.decode(buf.slice(0, i)); buf = buf.slice(i + 2);
        const m = line.match(/\{(\d+)\}$/);
        if (m) { cur += line; need = Number(m[1]); push("+ go\r\n"); continue; }
        cur += line;
        const [tag, ...rest] = cur.split(" "), cmd = rest.join(" ");
        sent.push({ text: cmd, literal: lit });
        if (cmd === "CAPABILITY") push("* CAPABILITY IMAP4rev1 UIDPLUS MOVE LITERAL+\r\n");
        push(`${tag} ${odp(cmd)}\r\n`);
        cur = ""; lit = undefined;
      }
      return Promise.resolve(p.length);
    },
    close() {},
  };
  return { c, sent };
}

Deno.test("write path: Sent copy, flags, move and draft replace go out exactly as intended", async () => {
  const s = serwer((cmd) => cmd.startsWith("APPEND") ? "OK [APPENDUID 7 321] done" : cmd.startsWith("SELECT") ? "OK [READ-WRITE] done" : "OK done");
  const im = new ImapZapis(s.c, 2000);
  const raw = te.encode("Subject: x\r\n\r\nTreść zażółć\r\n");
  assertEquals(await im.dopisz(F("INBOX.Sent", ["\\Sent"]), ["\\Seen"], raw), 321);
  assertEquals([s.sent[0].text, td.decode(s.sent[0].literal!)], [`APPEND "INBOX.Sent" (\\Seen) {${raw.length}}`, "Subject: x\r\n\r\nTreść zażółć\r\n"]);
  await im.dopisz(F("INBOX.Drafts"), ["\\Draft", "\\Seen", "\\Seen"], raw);
  assert(s.sent[1].text.startsWith('APPEND "INBOX.Drafts" (\\Seen \\Draft) {'));
  await im.wybierz(F("INBOX"));
  await im.flagi([5, 5, 6], true, ["\\Seen"]);
  await im.flagi([5], false, ["\\Flagged"]);
  await im.flagi([5], true, ["\\Answered", "$Forwarded"]);
  await im.przenies([5, 6], F("INBOX.Trash", ["\\Trash"]));
  assertEquals(s.sent.slice(2).map((x) => x.text), ['SELECT "INBOX"', "UID STORE 5,6 +FLAGS.SILENT (\\Seen)", "UID STORE 5 -FLAGS.SILENT (\\Flagged)", "UID STORE 5 +FLAGS.SILENT (\\Answered $Forwarded)", "CAPABILITY", 'UID MOVE 5,6 "INBOX.Trash"']);
  await im.wybierz(F("INBOX.Drafts", ["\\Drafts"]));
  await im.usunSzkic(321);
  assertEquals(s.sent.slice(-3).map((x) => x.text), ["CAPABILITY", "UID STORE 321 +FLAGS.SILENT (\\Deleted)", "UID EXPUNGE 321"]);
});

Deno.test("write path: the methods refuse everything outside their rules before anything is sent", async () => {
  const s = serwer();
  const im = new ImapZapis(s.c, 2000);
  const raw = te.encode("x");
  // APPEND only to Sent / Drafts — never INBOX, Trash, an ordinary or an unselectable folder
  for (const f of [F("INBOX"), F("INBOX.Trash", ["\\Trash"]), F("INBOX.Klienci"), F("INBOX.Archive", ["\\Archive"]), F("INBOX.Sent", ["\\Sent", "\\Noselect"])]) await assertRejects(() => im.dopisz(f, ["\\Seen"], raw), Error);
  // nothing changes before a folder is chosen
  await assertRejects(() => im.flagi([5], true, ["\\Seen"]), Error, "najpierw wybierz");
  await assertRejects(() => im.przenies([5], F("INBOX.Trash")), Error, "najpierw wybierz");
  await assertRejects(() => im.usunSzkic(5), Error, "tylko własny szkic");
  await assertRejects(() => im.wybierz(F("Ukryty", ["\\Noselect"])), Error);
  await assertRejects(() => im.wybierz(F('INBOX"\r\nA9 DELETE "INBOX')), Error);
  assertEquals(s.sent.length, 0);
  await im.wybierz(F("INBOX"));
  // deleting for good is possible only inside Drafts
  await assertRejects(() => im.usunSzkic(5), Error, "tylko własny szkic");
  await im.wybierz(F("INBOX.Trash", ["\\Trash"]));
  await assertRejects(() => im.usunSzkic(5), Error, "tylko własny szkic");
  // other flags, empty or huge lists, the same folder as target, an unselectable target
  // deno-lint-ignore no-explicit-any
  for (const fl of [["\\Deleted"], ["\\Draft"], ["$Junk"], []] as any[]) await assertRejects(() => im.flagi([5], true, fl), Error, "niedozwolona flaga");
  for (const u of [[], [0], [-1], [NaN], Array.from({ length: 201 }, (_, i) => i + 1)]) await assertRejects(() => im.flagi(u, true, ["\\Seen"]), Error, "lista");
  await assertRejects(() => im.przenies([5], F("INBOX.Trash", ["\\Trash"])), Error, "docelowy");
  await assertRejects(() => im.przenies([5], F("X", ["\\Noselect"])), Error, "docelowy");
  assertEquals(s.sent.map((x) => x.text), ['SELECT "INBOX"', 'SELECT "INBOX.Trash"']);
  // a server without MOVE / UIDPLUS: refused, never replaced by COPY + EXPUNGE
  const stary = serwer();
  const o = { c: stary.c, sent: stary.sent };
  const im2 = new ImapZapis({ ...o.c, write: (p) => o.c.write(p) }, 2000);
  // deno-lint-ignore no-explicit-any
  (im2 as any).mozliwosci = () => Promise.resolve("IMAP4REV1");
  await im2.wybierz(F("INBOX.Drafts"));
  await assertRejects(() => im2.przenies([5], F("INBOX.Trash")), Error, "MOVE");
  await assertRejects(() => im2.usunSzkic(5), Error, "UID EXPUNGE");
  assert(o.sent.every((x) => !/COPY|EXPUNGE|STORE/.test(x.text)));
});
