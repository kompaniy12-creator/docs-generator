// The CONTROLLED WRITE PATH to a mailbox. Browsing keeps using the read-only client (imap.ts: EXAMINE + PEEK).
// This class can do exactly these changes, and nothing else:
//   APPEND          a message into the Sent or the Drafts folder (never INBOX or any other folder)
//   UID STORE       add / remove \Seen, \Answered, \Flagged, $Forwarded
//   UID MOVE        messages to another folder of the same mailbox (delete = move to Trash; nothing is ever
//                   removed for good from here)
//   draft replace   \Deleted + UID EXPUNGE <that one UID>, only while the Drafts folder is selected
// No CREATE / RENAME / DELETE of folders, no plain EXPUNGE, no CLOSE (which expunges), no COPY, no other flags.
// Every command passes guardZapis(); the folder rules are enforced by the methods (tested in imapw_test.ts).

import { astring, type Conn, type Folder, guard, Imap, nieWybieralny, typFolderu } from "./imap.ts";

export const FLAGI = ["\\Seen", "\\Answered", "\\Flagged", "$Forwarded"] as const;
export type Flaga = typeof FLAGI[number];
const ARG = '(?:"(?:[^"\\\\\\r\\n]|\\\\.)*"|\\{\\d+\\})'; // a quoted string or a literal
const WZORY = [
  new RegExp(`^SELECT ${ARG}$`),
  new RegExp(`^APPEND ${ARG} \\((?:\\\\Seen|\\\\Draft|\\\\Seen \\\\Draft)?\\) \\{\\d+\\}$`),
  /^UID STORE \d+(,\d+){0,199} [+-]FLAGS\.SILENT \((\\Seen|\\Answered|\\Flagged|\$Forwarded)( (\\Seen|\\Answered|\\Flagged|\$Forwarded)){0,3}\)$/,
  /^UID STORE \d+ \+FLAGS\.SILENT \(\\Deleted\)$/, // one message; used only by usunSzkic()
  /^UID EXPUNGE \d+$/,                             // one message, by UID; used only by usunSzkic()
  new RegExp(`^UID MOVE \\d+(,\\d+){0,199} ${ARG}$`),
  /^CAPABILITY$/,
];
export function guardZapis(cmd: string): void {
  if (/[\r\n\0]/.test(cmd)) throw new Error("imap: niedozwolony znak w poleceniu");
  if (WZORY.some((w) => w.test(cmd))) return;
  guard(cmd); // everything else must be one of the read-only commands
}
const lista = (uids: number[]) => {
  const u = [...new Set(uids.map((x) => Math.floor(Number(x))).filter((x) => x > 0 && x < 4294967296))];
  if (!u.length || u.length > 200) throw new Error("imap: nieprawidłowa lista wiadomości");
  return u.join(",");
};

export class ImapZapis extends Imap {
  private wybrany: Folder | null = null;
  constructor(c: Conn, timeoutMs = 20000, maxLiteral = 16 * 1024 * 1024) { super(c, timeoutMs, maxLiteral, guardZapis); }

  async mozliwosci(): Promise<string> { return (await this.cmd("CAPABILITY")).untagged.map((u) => u.text).join(" ").toUpperCase(); }
  // open a folder for changes (must be one of the mailbox's own, selectable folders)
  async wybierz(f: Folder): Promise<void> {
    if (nieWybieralny(f)) throw new Error("imap: tego folderu nie można otworzyć");
    this.wybrany = null;
    await this.cmd("SELECT ", astring(f.raw));
    this.wybrany = f;
  }
  // a new message into Sent or Drafts; the new UID when the server tells it (UIDPLUS)
  async dopisz(f: Folder, flagi: ("\\Seen" | "\\Draft")[], raw: Uint8Array): Promise<number | null> {
    const typ = typFolderu(f);
    if (typ !== "sent" && typ !== "drafts") throw new Error("imap: dopisywać można tylko do Wysłanych i Roboczych");
    if (nieWybieralny(f)) throw new Error("imap: tego folderu nie można otworzyć");
    const fl = [...new Set(flagi)].filter((x) => x === "\\Seen" || x === "\\Draft").sort().reverse().join(" ");
    const r = await this.cmd("APPEND ", astring(f.raw), ` (${fl}) `, raw);
    const m = r.done.match(/\[APPENDUID \d+ (\d+)\]/i);
    return m ? Number(m[1]) : null;
  }
  async flagi(uids: number[], dodaj: boolean, flagi: Flaga[]): Promise<void> {
    if (!this.wybrany) throw new Error("imap: najpierw wybierz folder");
    const fl = [...new Set(flagi)].filter((x) => (FLAGI as readonly string[]).includes(x));
    if (!fl.length) throw new Error("imap: niedozwolona flaga");
    await this.cmd(`UID STORE ${lista(uids)} ${dodaj ? "+" : "-"}FLAGS.SILENT (${fl.join(" ")})`);
  }
  async przenies(uids: number[], cel: Folder): Promise<void> {
    if (!this.wybrany) throw new Error("imap: najpierw wybierz folder");
    if (nieWybieralny(cel) || cel.raw === this.wybrany.raw) throw new Error("imap: nieprawidłowy folder docelowy");
    if (!/\bMOVE\b/.test(await this.mozliwosci())) throw new Error("imap: serwer nie obsługuje przenoszenia (MOVE)");
    await this.cmd(`UID MOVE ${lista(uids)} `, astring(cel.raw));
  }
  // the previous copy of a draft is removed when a newer one was saved — only inside the Drafts folder
  async usunSzkic(uid: number): Promise<void> {
    if (!this.wybrany || typFolderu(this.wybrany) !== "drafts") throw new Error("imap: usuwać można tylko własny szkic w Roboczych");
    if (!/\bUIDPLUS\b/.test(await this.mozliwosci())) throw new Error("imap: serwer nie obsługuje UID EXPUNGE");
    const u = lista([uid]);
    await this.cmd(`UID STORE ${u} +FLAGS.SILENT (\\Deleted)`);
    await this.cmd(`UID EXPUNGE ${u}`);
  }
}
