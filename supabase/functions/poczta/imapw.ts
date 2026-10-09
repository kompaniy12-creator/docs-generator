// The CONTROLLED WRITE PATH to a mailbox. Browsing keeps using the read-only client (imap.ts: EXAMINE + PEEK).
// This class can do exactly these changes, and nothing else:
//   APPEND          a message into the Sent or the Drafts folder (never INBOX or any other folder)
//   UID STORE       add / remove \Seen, \Answered, \Flagged, $Forwarded
//   UID MOVE        messages to another folder of the same mailbox (delete = move to Trash; nothing is ever
//                   removed for good from here)
//   UID COPY        messages to another folder of the same mailbox
//   draft replace   \Deleted + UID EXPUNGE <that one UID>, only while the Drafts folder is selected
//   empty Trash/Spam  \Deleted + UID EXPUNGE <an explicit list of UIDs, at most 200>, only while a Trash or Spam folder
//                   is selected (the handler passes the portal's chosen one and lets only an administrator do it)
//   folders         CREATE / RENAME / DELETE (+ SUBSCRIBE / UNSUBSCRIBE, so other mail programs show the same tree) of
//                   USER folders only: never INBOX, never a folder of a standard kind or with a special-use flag, never
//                   one with subfolders; DELETE only when the server says the folder holds no message
// No plain EXPUNGE, no "1:*" anywhere, no CLOSE (which expunges), no other flags, no ACL / quota / anything else.
// Every command passes guardZapis(); the folder rules are enforced by the methods (tested in imapw_test.ts).

import { astring, type Conn, type Folder, folderUzytkownika, guard, Imap, mutf7, nieWybieralny, typFolderu } from "./imap.ts";

export const FLAGI = ["\\Seen", "\\Answered", "\\Flagged", "$Forwarded"] as const;
export type Flaga = typeof FLAGI[number];
const ARG = '(?:"(?:[^"\\\\\\r\\n]|\\\\.)*"|\\{\\d+\\})'; // a quoted string or a literal
const WZORY = [
  new RegExp(`^SELECT ${ARG}$`),
  new RegExp(`^APPEND ${ARG} \\((?:\\\\Seen|\\\\Draft|\\\\Seen \\\\Draft)?\\) \\{\\d+\\}$`),
  /^UID STORE \d+(,\d+){0,199} [+-]FLAGS\.SILENT \((\\Seen|\\Answered|\\Flagged|\$Forwarded)( (\\Seen|\\Answered|\\Flagged|\$Forwarded)){0,3}\)$/,
  /^UID STORE \d+(,\d+){0,199} \+FLAGS\.SILENT \(\\Deleted\)$/, // listed messages only; used by usunSzkic() and oproznij()
  /^UID EXPUNGE \d+(,\d+){0,199}$/,                             // listed messages only, by UID — never a range
  new RegExp(`^UID MOVE \\d+(,\\d+){0,199} ${ARG}$`),
  new RegExp(`^UID COPY \\d+(,\\d+){0,199} ${ARG}$`),
  new RegExp(`^(CREATE|DELETE|SUBSCRIBE|UNSUBSCRIBE) ${ARG}$`),
  new RegExp(`^RENAME ${ARG} ${ARG}$`),
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

// a name for a new folder, as the server will store it: bounded, no control characters, not a look-alike of a standard folder
function nowyFolder(raw: string, delim: string, list: Folder[]): Folder {
  const f: Folder = { raw, nazwa: mutf7(raw), delim, flagi: [] };
  if (!raw || raw.length > 200 || /[\r\n\0\u007f]|[^\x20-\x7e]/.test(raw) || /[%*"\\]/.test(raw) || raw.split(delim).some((p) => !p.trim() || p !== p.trim())) throw new Error("imap: nieprawidłowa nazwa folderu");
  if (!folderUzytkownika(f)) throw new Error("imap: ta nazwa jest zastrzeżona dla folderu systemowego");
  if (list.some((x) => x.raw.toLowerCase() === raw.toLowerCase())) throw new Error("imap: taki folder już istnieje");
  return f;
}
const maPodfoldery = (f: Folder, list: Folder[]) => list.some((x) => x.raw.startsWith(f.raw + f.delim));

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
  async kopiuj(uids: number[], cel: Folder): Promise<void> {
    if (!this.wybrany) throw new Error("imap: najpierw wybierz folder");
    if (nieWybieralny(cel) || cel.raw === this.wybrany.raw) throw new Error("imap: nieprawidłowy folder docelowy");
    await this.cmd(`UID COPY ${lista(uids)} `, astring(cel.raw));
  }
  // "Opróżnij kosz / spam": the listed messages of the selected Trash or Spam folder are removed for good
  async oproznij(uids: number[]): Promise<void> {
    const typ = this.wybrany ? typFolderu(this.wybrany) : "";
    if (typ !== "trash" && typ !== "junk") throw new Error("imap: opróżniać można tylko Kosz i Spam");
    const u = lista(uids);
    if (!/\bUIDPLUS\b/.test(await this.mozliwosci())) throw new Error("imap: serwer nie obsługuje UID EXPUNGE");
    await this.cmd(`UID STORE ${u} +FLAGS.SILENT (\\Deleted)`);
    await this.cmd(`UID EXPUNGE ${u}`);
  }
  // ---- folders of people (`list`: what the server listed a moment ago)
  async utworz(raw: string, delim: string, list: Folder[]): Promise<void> {
    const f = nowyFolder(raw, delim, list);
    const rodzic = raw.includes(delim) ? raw.slice(0, raw.lastIndexOf(delim)) : "";
    if (rodzic && rodzic.toUpperCase() !== "INBOX" && !list.some((x) => x.raw === rodzic && folderUzytkownika(x))) throw new Error("imap: nieprawidłowy folder nadrzędny");
    await this.cmd("CREATE ", astring(f.raw));
    await this.cmd("SUBSCRIBE ", astring(f.raw)).catch(() => {});
  }
  async zmienNazwe(f: Folder, nowy: string, list: Folder[]): Promise<void> {
    if (!list.some((x) => x.raw === f.raw) || !folderUzytkownika(f)) throw new Error("imap: tego folderu nie można zmienić");
    if (maPodfoldery(f, list)) throw new Error("imap: folder ma podfoldery");
    const n = nowyFolder(nowy, f.delim, list);
    // the folder stays where it is: only its last name changes
    if (n.raw.slice(0, n.raw.lastIndexOf(f.delim) + 1) !== f.raw.slice(0, f.raw.lastIndexOf(f.delim) + 1)) throw new Error("imap: nieprawidłowa nazwa folderu");
    if (this.wybrany?.raw === f.raw) { await this.examine("INBOX"); this.wybrany = null; }
    await this.cmd("RENAME ", astring(f.raw), " ", astring(n.raw));
    await this.cmd("UNSUBSCRIBE ", astring(f.raw)).catch(() => {});
    await this.cmd("SUBSCRIBE ", astring(n.raw)).catch(() => {});
  }
  // only an EMPTY user folder is ever deleted (the handler moves its messages to Trash first)
  async usunFolder(f: Folder, list: Folder[]): Promise<void> {
    if (!list.some((x) => x.raw === f.raw) || !folderUzytkownika(f)) throw new Error("imap: tego folderu nie można usunąć");
    if (maPodfoldery(f, list)) throw new Error("imap: folder ma podfoldery");
    await this.examine("INBOX"); this.wybrany = null; // never delete the folder that is open
    const st = await this.status(f.raw);
    if (st.messages !== 0) throw new Error("imap: folder nie jest pusty");
    await this.cmd("DELETE ", astring(f.raw));
    await this.cmd("UNSUBSCRIBE ", astring(f.raw)).catch(() => {});
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
