// deno test -A supabase/functions/poczta/
// The controlled write path: what it can do, and — above all — what it cannot.
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import type { Conn, Folder } from "./imap.ts";
import { guardZapis, ImapZapis } from "./imapw.ts";

const te = new TextEncoder(), td = new TextDecoder();
const F = (raw: string, flagi: string[] = []): Folder => ({ raw, nazwa: raw, delim: ".", flagi });

Deno.test("write guard: only APPEND, the four flags, UID MOVE / COPY, listed-UID expunge, folder commands and the read-only commands pass", () => {
  for (const ok of ['SELECT "INBOX"', "SELECT {7}", 'APPEND "INBOX.Sent" (\\Seen) {120}', 'APPEND "INBOX.Drafts" (\\Seen \\Draft) {9}', "APPEND {8} () {5}",
    "UID STORE 7 +FLAGS.SILENT (\\Seen)", "UID STORE 7,8,9 -FLAGS.SILENT (\\Seen \\Flagged)", "UID STORE 5 +FLAGS.SILENT (\\Answered)", "UID STORE 5 +FLAGS.SILENT ($Forwarded)",
    "UID STORE 5 +FLAGS.SILENT (\\Deleted)", "UID EXPUNGE 5", 'UID MOVE 5,6 "INBOX.Trash"', "UID MOVE 5 {9}", "CAPABILITY",
    "UID STORE 5,6,7 +FLAGS.SILENT (\\Deleted)", "UID EXPUNGE 5,6,7", 'UID COPY 5,6 "INBOX.Klienci"', "UID COPY 5 {9}", 'CREATE "INBOX.Klienci"', "CREATE {12}", 'RENAME "INBOX.A" "INBOX.B"', "RENAME {7} {9}",
    'DELETE "INBOX.Stare"', 'SUBSCRIBE "INBOX.Klienci"', 'UNSUBSCRIBE "INBOX.Stare"',
    'EXAMINE "INBOX"', 'LIST "" "*"', "UID FETCH 5 (UID BODY.PEEK[1])", "UID SEARCH ALL", "LOGOUT"]) guardZapis(ok);
  for (const bad of ["EXPUNGE", "UID EXPUNGE 1:*", "UID EXPUNGE 5:9", "UID EXPUNGE 5,6:9", "UID EXPUNGE *", "UID EXPUNGE", "UID EXPUNGE " + Array.from({ length: 201 }, (_, i) => i + 1).join(","), "CLOSE", "UNSELECT",
    "DELETE INBOX.Stare", 'DELETE "a" "b"', "DELETE", 'RENAME "A"', 'RENAME "A" "B" "C"', "RENAME A B", "CREATE Nowy", 'CREATE "a" (USE (\\Trash))', 'SUBSCRIBE "x" "y"', 'LSUB "" "*"',
    'UID COPY 1:* "x"', 'UID COPY 5:9 "x"', "UID COPY 5 INBOX", 'UID COPY 5 "a" "b"', 'CREATE "x"\r\nA2 DELETE "INBOX"',
    "UID STORE 1:* +FLAGS.SILENT (\\Deleted)", "UID STORE 5:9 +FLAGS.SILENT (\\Deleted)", "UID STORE 5 -FLAGS.SILENT (\\Deleted)", "UID STORE 5 +FLAGS (\\Deleted)", "UID STORE 5 +FLAGS.SILENT (\\Seen \\Deleted)", "UID STORE 5 +FLAGS (\\Seen)", "UID STORE 5 FLAGS.SILENT (\\Seen)",
    "UID STORE 5 +FLAGS.SILENT (\\Draft)", "UID STORE 5 +FLAGS.SILENT ($Junk)", "UID STORE 5 +FLAGS.SILENT (NonJunk)", "UID STORE 5 +FLAGS.SILENT ()", "STORE 1:* +FLAGS.SILENT (\\Seen)", "UID STORE 1:* +FLAGS.SILENT (\\Seen)",
    'COPY 5 "INBOX.Trash"', 'COPY 1:* "x"', 'MOVE 1:* "INBOX.Trash"', 'UID MOVE 1:* "INBOX.Trash"', "UID MOVE 5 INBOX.Trash", 'UID MOVE 5 "a" "b"',
    'APPEND "INBOX" (\\Seen \\Deleted) {5}', 'APPEND "INBOX" (\\Flagged) {5}', 'APPEND "x" (\\Seen) "tekst"', 'APPEND "x" (\\Seen) {5}\r\nA2 DELETE "INBOX"',
    'SELECT "INBOX" (CONDSTORE)', "UID FETCH 5 (BODY[1])", 'SETACL "INBOX" anyone lrswipkxtecda', 'SETQUOTA "" (STORAGE 1)', "AUTHENTICATE PLAIN", "STARTTLS", "IDLE", "ENABLE QRESYNC", "UID SORT (DATE) UTF-8 ALL", ""]) {
    assertThrows(() => guardZapis(bad), Error, undefined, bad);
  }
});

// a scripted server: answers OK to everything, with the tagged text given per command
function serwer(odp: (cmd: string) => string = () => "OK done", przed: (cmd: string) => string = () => "") {
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
        if (przed(cmd)) push(przed(cmd));
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

Deno.test("folders and emptying: only user folders are created, renamed or deleted; only a Trash / Spam folder is emptied, by listed UIDs", async () => {
  let wiadomosci = 0;
  const s = serwer((cmd) => cmd.startsWith("EXAMINE") ? "OK [READ-ONLY] done" : "OK done",
    (cmd) => cmd.startsWith("EXAMINE") ? "* 0 EXISTS\r\n* OK [UIDVALIDITY 1] ok\r\n" : cmd.startsWith("STATUS") ? `* STATUS x (MESSAGES ${wiadomosci} UNSEEN 0 UIDNEXT 9 UIDVALIDITY 1)\r\n` : "");
  const im = new ImapZapis(s.c, 2000);
  const list = [F("INBOX"), F("INBOX.Sent", ["\\Sent"]), F("INBOX.Trash", ["\\Trash"]), F("INBOX.spam"), F("INBOX.Drafts"), F("INBOX.Klienci"), F("INBOX.Klienci.Alfa"), F("INBOX.Stare"), F("INBOX.Wazne", ["\\Flagged"]), F("INBOX.Puste", ["\\Noselect"])];
  // create: never a system name (in any language or case), never twice, never with characters the server reads specially
  for (const raw of ["INBOX", "inbox", "INBOX.Kosz", "INBOX.TRASH", "INBOX.Sent", "INBOX.Wys&AUI-ane", "INBOX.Spam", "INBOX.Archiwum", "INBOX.Robocze", "INBOX.klienci", "INBOX.Stare", "INBOX.Żółte", "INBOX.a%", "INBOX.a*", 'INBOX.a"b', "INBOX.a\\b",
    "INBOX.", "INBOX..x", "INBOX. x", "INBOX.x ", 'INBOX.x"\r\nA9 DELETE "INBOX', "x".repeat(201), "", "INBOX.Sent.Moje", "INBOX.Trash.Moje", "INBOX.Niema.Moje", "INBOX.Puste.Moje"]) await assertRejects(() => im.utworz(raw, ".", list), Error, undefined, raw);
  // rename / delete: never INBOX, a folder of a standard kind, one with a special-use flag, one with subfolders, one that is not listed
  for (const f of [list[0], list[1], list[2], list[3], list[4], list[5], list[8], list[9], F("INBOX.Obcy")]) {
    await assertRejects(() => im.zmienNazwe(f, "INBOX.Nowa", list), Error, undefined, f.raw);
    await assertRejects(() => im.usunFolder(f, list), Error, undefined, f.raw);
  }
  // a rename keeps the folder where it is and cannot take a system or an existing name
  for (const n of ["Nowa", "INBOX.Klienci.Nowa", "INBOX.Kosz", "INBOX.Klienci", "INBOX.stare", "INBOX"]) await assertRejects(() => im.zmienNazwe(list[7], n, list), Error, undefined, n);
  // emptying needs a selected Trash or Spam folder; copying needs a selected folder and another target
  await assertRejects(() => im.oproznij([5]), Error, "tylko Kosz i Spam");
  await assertRejects(() => im.kopiuj([5], list[5]), Error, "najpierw wybierz");
  assertEquals(s.sent.length, 0);
  for (const f of [list[0], list[4], list[5], list[1]]) { await im.wybierz(f); await assertRejects(() => im.oproznij([5]), Error, "tylko Kosz i Spam"); }
  await assertRejects(() => im.kopiuj([5], list[1]), Error, "docelowy");
  await assertRejects(() => im.kopiuj([5], list[9]), Error, "docelowy");
  assert(s.sent.every((x) => x.text.startsWith("SELECT")));
  // a folder that still holds a message is not deleted
  wiadomosci = 3;
  await assertRejects(() => im.usunFolder(list[7], list), Error, "nie jest pusty");
  assert(!s.sent.some((x) => x.text.startsWith("DELETE")));
  // what does go out
  const od = s.sent.length;
  wiadomosci = 0;
  await im.utworz("INBOX.Nowy klient", ".", list);
  await im.utworz("INBOX.Klienci.Beta", ".", list);
  await im.utworz("INBOX.&AXsA8wFC-te", ".", list);
  await im.zmienNazwe(list[7], "INBOX.Archiwalne 2025", list);
  await im.usunFolder(list[6], list);
  await im.wybierz(list[0]); await im.kopiuj([5, 6], list[5]);
  await im.wybierz(list[2]); await im.oproznij([7, 8, 8]);
  await im.wybierz(list[3]); await im.oproznij([9]);
  await assertRejects(() => im.oproznij([]), Error, "lista");
  await assertRejects(() => im.oproznij(Array.from({ length: 201 }, (_, i) => i + 1)), Error, "lista");
  assertEquals(s.sent.slice(od).map((x) => x.text), ['CREATE "INBOX.Nowy klient"', 'SUBSCRIBE "INBOX.Nowy klient"', 'CREATE "INBOX.Klienci.Beta"', 'SUBSCRIBE "INBOX.Klienci.Beta"', 'CREATE "INBOX.&AXsA8wFC-te"', 'SUBSCRIBE "INBOX.&AXsA8wFC-te"',
    'RENAME "INBOX.Stare" "INBOX.Archiwalne 2025"', 'UNSUBSCRIBE "INBOX.Stare"', 'SUBSCRIBE "INBOX.Archiwalne 2025"',
    'EXAMINE "INBOX"', 'STATUS "INBOX.Klienci.Alfa" (MESSAGES UNSEEN UIDNEXT UIDVALIDITY)', 'DELETE "INBOX.Klienci.Alfa"', 'UNSUBSCRIBE "INBOX.Klienci.Alfa"',
    'SELECT "INBOX"', 'UID COPY 5,6 "INBOX.Klienci"', 'SELECT "INBOX.Trash"', "CAPABILITY", "UID STORE 7,8 +FLAGS.SILENT (\\Deleted)", "UID EXPUNGE 7,8",
    'SELECT "INBOX.spam"', "CAPABILITY", "UID STORE 9 +FLAGS.SILENT (\\Deleted)", "UID EXPUNGE 9"]);
});
