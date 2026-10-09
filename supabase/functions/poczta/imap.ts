// A minimal, strictly READ-ONLY IMAP4rev1 client for the edge runtime (Deno.connectTls).
//
// It can only: LOGIN, EXAMINE (never SELECT), STATUS, UID SEARCH, FETCH (UID), UID FETCH with
// BODY.PEEK[...] (never BODY[...] / RFC822, which would set \Seen), NOOP, LOGOUT. Every command
// passes guard() below, so nothing in this file can mark, move, flag or delete a message.

export interface Conn {
  read(p: Uint8Array): Promise<number | null>;
  write(p: Uint8Array): Promise<number>;
  close(): void;
}
export type Fetched = { uid: number; size: number; internaldate: string; body: Uint8Array };
export type Examined = { exists: number; uidvalidity: number; uidnext: number };

const enc = new TextEncoder();
const dec = new TextDecoder("latin1"); // protocol lines are ASCII; message bytes are returned untouched

// what may ever be sent to the server (literals appear here as "{n}"; their bytes are data, not commands)
const FETCH_ITEMS = new Set(["UID", "FLAGS", "INTERNALDATE", "RFC822.SIZE", "BODYSTRUCTURE", "ENVELOPE"]);
export function guard(cmd: string): void {
  if (/[\r\n\0]/.test(cmd)) throw new Error("imap: niedozwolony znak w poleceniu");
  const ok = /^(LOGIN |EXAMINE |STATUS |LIST |UID SEARCH |UID FETCH |FETCH |NOOP$|LOGOUT$)/.test(cmd);
  if (!ok) throw new Error("imap: polecenie spoza listy tylko-do-odczytu");
  if (/^(UID )?FETCH /.test(cmd)) {
    // message data only through BODY.PEEK[...] (plain BODY[...] and RFC822 / RFC822.TEXT set \Seen); the rest from a closed list
    const m = cmd.match(/^(?:UID )?FETCH [0-9:,*]+ \((.*)\)$/);
    if (!m) throw new Error("imap: FETCH bez PEEK jest zabroniony");
    const rest = m[1].replace(/BODY\.PEEK\[[^\]\r\n]*\](<\d+\.\d+>)?/g, " ").trim();
    for (const t of rest.split(/\s+/).filter(Boolean)) if (!FETCH_ITEMS.has(t)) throw new Error("imap: FETCH bez PEEK jest zabroniony");
  }
}
export const quote = (s: string) => {
  if (/[\r\n\0]/.test(s) || /[^\x20-\x7e]/.test(s)) throw new Error("imap: wartość nie nadaje się do polecenia");
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
};

// a string argument: quoted when plain ASCII, otherwise a literal (length-prefixed bytes — nothing in it can be read as a command)
export function astring(v: string): string | Uint8Array {
  if (/[\r\n\0]/.test(v)) throw new Error("imap: wartość nie nadaje się do polecenia");
  return /^[\x20-\x7e]*$/.test(v) ? quote(v) : enc.encode(v);
}

// ---- parsing of parenthesised server data (FETCH items, LIST lines, BODYSTRUCTURE)
export type Node = string | null | Uint8Array | Node[];
// Atoms and quoted strings become strings, NIL becomes null, literals stay bytes, lists become arrays.
// "BODY[HEADER.FIELDS (A B)]<0>" is one atom.
export function tok(text: string, literals: Uint8Array[] = []): Node[] {
  let i = 0, depth = 0;
  const list = (): Node[] => {
    const out: Node[] = [];
    if (++depth > 60) throw new Error("imap: zbyt głębokie zagnieżdżenie");
    for (;;) {
      while (text[i] === " ") i++;
      if (i >= text.length) break;
      const c = text[i];
      if (c === ")") { i++; break; }
      if (c === "(") { i++; out.push(list()); continue; }
      if (c === '"') {
        let v = ""; i++;
        while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; v += text[i++] ?? ""; }
        i++; out.push(v); continue;
      }
      if (c === "\u0001") { const e = text.indexOf("\u0001", i + 1); out.push(literals[Number(text.slice(i + 1, e))] ?? new Uint8Array(0)); i = e + 1; continue; }
      let v = "";
      while (i < text.length && text[i] !== " " && text[i] !== ")" && text[i] !== "(") {
        if (text[i] === "[") { const e = text.indexOf("]", i); const end = e < 0 ? text.length : e + 1; v += text.slice(i, end); i = end; } else v += text[i++];
      }
      out.push(v.toUpperCase() === "NIL" ? null : v);
    }
    depth--;
    return out;
  };
  return list();
}
export const str = (n: Node | undefined): string => (typeof n === "string" ? n : n instanceof Uint8Array ? new TextDecoder().decode(n) : "");

// folder names travel in "modified UTF-7" (RFC 3501 5.1.3): "&AUI-" is "ł", "&-" is "&"
export function mutf7(s: string): string {
  return s.replace(/&([A-Za-z0-9+,]*)-/g, (_m, b: string) => {
    if (!b) return "&";
    try {
      const bin = atob(b.replace(/,/g, "/") + "===".slice((b.length + 3) % 4));
      let out = "";
      for (let k = 0; k + 1 < bin.length; k += 2) out += String.fromCharCode((bin.charCodeAt(k) << 8) | bin.charCodeAt(k + 1));
      return out;
    } catch { return "&" + b + "-"; }
  });
}
export type Folder = { raw: string; nazwa: string; delim: string; flagi: string[] };
export type Meta = { uid: number; flagi: string[]; size: number; internaldate: string; bs: Node | null; sekcje: Record<string, Uint8Array> };
export type Szukaj = { tekst?: string; wTresci?: boolean; nieprzeczytane?: boolean; oflagowane?: boolean; od?: string; do?: string };
// header fields read with every message of a list or a view
export const POLA = "FROM TO CC REPLY-TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES X-PORTAL-SZKIC";
const MIES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// 2026-10-09 -> 9-Oct-2026 (throws on anything that is not a real ISO date)
export function imapData(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const t = m ? Date.parse(iso + "T00:00:00Z") : NaN;
  if (!m || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== iso) throw new Error("imap: nieprawidłowa data");
  return `${Number(m[3])}-${MIES[Number(m[2]) - 1]}-${m[1]}`;
}

export class Imap {
  private buf = new Uint8Array(0);
  private n = 0;
  // `straz`: the check every command passes before it is sent (read-only here; imapw.ts has the controlled write path)
  constructor(protected c: Conn, protected timeoutMs = 20000, protected maxLiteral = 16 * 1024 * 1024, protected straz: (cmd: string) => void = guard) {}

  static async connect(host: string, port: number, timeoutMs = 20000, maxLiteral?: number): Promise<Imap> {
    // certificate validation stays on (the default); a wrong host name fails here
    const c = await withTimeout(Deno.connectTls({ hostname: host, port }), timeoutMs, "imap: przekroczono czas łączenia");
    const i = new this(c, timeoutMs, maxLiteral);
    const g = await i.response();
    if (!/^\* (OK|PREAUTH)/i.test(g.text)) { i.close(); throw new Error("imap: nieoczekiwane powitanie serwera"); }
    return i;
  }
  close() { try { this.c.close(); } catch { /* already closed */ } }

  private async fill(): Promise<void> {
    const p = new Uint8Array(65536);
    const n = await withTimeout(this.c.read(p), this.timeoutMs, "imap: przekroczono czas odpowiedzi");
    if (n === null) throw new Error("imap: połączenie zamknięte");
    const next = new Uint8Array(this.buf.length + n);
    next.set(this.buf); next.set(p.subarray(0, n), this.buf.length);
    this.buf = next;
  }
  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf(10);
      if (i >= 0) {
        const l = dec.decode(this.buf.subarray(0, i > 0 && this.buf[i - 1] === 13 ? i - 1 : i));
        this.buf = this.buf.slice(i + 1);
        return l;
      }
      if (this.buf.length > 1024 * 1024) throw new Error("imap: zbyt długa linia odpowiedzi");
      await this.fill();
    }
  }
  private async bytes(n: number): Promise<Uint8Array> {
    if (n > this.maxLiteral) throw new Error("imap: literał większy niż limit");
    const parts: Uint8Array[] = [];
    let have = 0;
    while (have < n) {
      if (!this.buf.length) await this.fill();
      const take = Math.min(n - have, this.buf.length);
      parts.push(this.buf.slice(0, take));
      this.buf = this.buf.slice(take);
      have += take;
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  // one logical response: a line, with any {n} literals read and replaced by a placeholder
  private async response(): Promise<{ text: string; literals: Uint8Array[] }> {
    let text = "";
    const literals: Uint8Array[] = [];
    for (;;) {
      const l = await this.line();
      const m = l.match(/\{(\d+)\}$/);
      if (!m) { text += l; return { text, literals }; }
      text += l.slice(0, m.index) + `\u0001${literals.length}\u0001`;
      literals.push(await this.bytes(Number(m[1])));
    }
  }
  // Parts: protocol text (checked by guard) and literals (bytes, sent only after the server's "+" go-ahead).
  protected async cmd(...parts: (string | Uint8Array)[]): Promise<{ untagged: { text: string; literals: Uint8Array[] }[]; done: string }> {
    const command = parts.map((p) => (typeof p === "string" ? p : `{${p.length}}`)).join("");
    this.straz(command);
    const tag = "P" + (++this.n);
    const untagged: { text: string; literals: Uint8Array[] }[] = [];
    const fail = (rest: string) => new Error("imap: " + command.split(" ").slice(0, command.startsWith("UID ") ? 2 : 1).join(" ") + " odrzucone: " + rest.replace(/[^\x20-\x7e]/g, "").slice(0, 120));
    let line = `${tag} `;
    for (const p of parts) {
      if (typeof p === "string") { line += p; continue; }
      await this.c.write(enc.encode(`${line}{${p.length}}\r\n`));
      for (;;) { // wait for "+": anything untagged is kept, a tagged answer here is a refusal
        const r = await this.response();
        if (r.text.startsWith("+")) break;
        if (r.text.startsWith(tag + " ")) throw fail(r.text.slice(tag.length + 1));
        untagged.push(r);
      }
      await this.c.write(p);
      line = "";
    }
    await this.c.write(enc.encode(line + "\r\n"));
    for (;;) {
      const r = await this.response();
      if (r.text.startsWith(tag + " ")) {
        const rest = r.text.slice(tag.length + 1);
        // the server's own words only — the command (which may hold the password) is never echoed
        if (!/^OK/i.test(rest)) throw fail(rest);
        return { untagged, done: rest };
      }
      untagged.push(r);
    }
  }

  async login(user: string, pass: string): Promise<void> { await this.cmd(`LOGIN ${quote(user)} ${quote(pass)}`); }

  async examine(box = "INBOX"): Promise<Examined> {
    const r = await this.cmd("EXAMINE ", astring(box));
    if (!/\[READ-ONLY\]/i.test(r.done)) throw new Error("imap: skrzynka nie została otwarta tylko do odczytu");
    const all = r.untagged.map((u) => u.text).join("\n");
    const num = (re: RegExp) => Number(all.match(re)?.[1] ?? NaN);
    const out = { exists: num(/^\* (\d+) EXISTS/im), uidvalidity: num(/\[UIDVALIDITY (\d+)\]/i), uidnext: num(/\[UIDNEXT (\d+)\]/i) };
    if (!Number.isFinite(out.exists) || !Number.isFinite(out.uidvalidity)) throw new Error("imap: niepełna odpowiedź EXAMINE");
    if (!Number.isFinite(out.uidnext)) out.uidnext = 0; // very old servers: found through the last message instead
    return out;
  }
  async status(box = "INBOX"): Promise<{ messages: number; unseen: number; uidnext: number; uidvalidity: number }> {
    const r = await this.cmd("STATUS ", astring(box), " (MESSAGES UNSEEN UIDNEXT UIDVALIDITY)");
    const t = r.untagged.map((u) => u.text).join(" ");
    const num = (k: string) => Number(t.match(new RegExp(k + " (\\d+)", "i"))?.[1] ?? NaN);
    return { messages: num("MESSAGES"), unseen: num("UNSEEN"), uidnext: num("UIDNEXT"), uidvalidity: num("UIDVALIDITY") };
  }
  private async search(criteria: string): Promise<number[]> {
    const r = await this.cmd(`UID SEARCH ${criteria}`);
    const out: number[] = [];
    for (const u of r.untagged) { const m = u.text.match(/^\* SEARCH(.*)$/i); if (m) for (const x of m[1].trim().split(/\s+/)) if (/^\d+$/.test(x)) out.push(Number(x)); }
    return out.sort((a, b) => a - b);
  }
  // UIDs above `last` ("n:*" always returns the newest message, hence the filter)
  async uidsAfter(last: number): Promise<number[]> { return (await this.search(`UID ${last + 1}:*`)).filter((u) => u > last); }
  async uidsUnseen(): Promise<number[]> { return await this.search("UNSEEN"); }
  async uidsByMessageId(id: string): Promise<number[]> { return await this.search(`HEADER Message-ID ${quote(id)}`); }
  // UIDs of the newest n messages (by sequence number)
  async newestUids(exists: number, n: number): Promise<number[]> {
    if (exists < 1 || n < 1) return [];
    const r = await this.cmd(`FETCH ${Math.max(1, exists - n + 1)}:${exists} (UID)`);
    const out: number[] = [];
    for (const u of r.untagged) { const m = u.text.match(/^\* \d+ FETCH \(.*UID (\d+)/i); if (m) out.push(Number(m[1])); }
    return out.sort((a, b) => a - b);
  }
  // section: "" (whole message), "HEADER", "HEADER.FIELDS (...)"; max: read at most that many bytes
  async fetch(uid: number, section = "", max?: number): Promise<Fetched | null> {
    if (!/^(|HEADER|TEXT|HEADER\.FIELDS \([A-Za-z\- ]+\))$/.test(section)) throw new Error("imap: nieobsługiwana sekcja");
    const r = await this.cmd(`UID FETCH ${Math.floor(uid)} (UID RFC822.SIZE INTERNALDATE BODY.PEEK[${section}]${max ? `<0.${Math.floor(max)}>` : ""})`);
    for (const u of r.untagged) {
      if (!/^\* \d+ FETCH /i.test(u.text)) continue;
      const got = Number(u.text.match(/UID (\d+)/i)?.[1] ?? NaN);
      if (got !== Math.floor(uid)) continue;
      const lit = u.text.match(/BODY\[[^\]]*\](?:<\d+>)? \u0001(\d+)\u0001/i);
      const body = lit ? u.literals[Number(lit[1])] : new Uint8Array(0); // NIL or "" for an empty section
      return { uid: got, size: Number(u.text.match(/RFC822\.SIZE (\d+)/i)?.[1] ?? 0), internaldate: u.text.match(/INTERNALDATE "([^"]*)"/i)?.[1] ?? "", body };
    }
    return null;
  }
  // ---- mailbox browser (all read-only)
  async list(): Promise<Folder[]> {
    const r = await this.cmd('LIST "" "*"');
    const out: Folder[] = [];
    for (const u of r.untagged) {
      const m = u.text.match(/^\* LIST (.*)$/i);
      if (!m) continue;
      const t = tok(m[1], u.literals);
      const raw = str(t[2]);
      if (!raw || /[\r\n\0]/.test(raw)) continue;
      out.push({ raw, nazwa: mutf7(raw), delim: str(t[1]) || "/", flagi: (Array.isArray(t[0]) ? t[0] : []).map((f) => str(f)) });
    }
    return out;
  }
  // UIDs matching the filters, ascending. The text is sent as UTF-8 literals: it cannot break out of the command.
  async szukaj(f: Szukaj): Promise<number[]> {
    const parts: (string | Uint8Array)[] = ["UID SEARCH"];
    const tekst = (f.tekst ?? "").trim();
    if (tekst) {
      if (/[\r\n\0]/.test(tekst) || tekst.length > 100) throw new Error("imap: nieprawidłowy tekst wyszukiwania");
      const lit = enc.encode(tekst);
      // subject / sender / recipient; with `wTresci` anywhere in the message (headers and text)
      if (f.wTresci) parts.push(" CHARSET UTF-8 TEXT ", lit);
      else parts.push(" CHARSET UTF-8 OR OR SUBJECT ", lit, " FROM ", lit, " TO ", lit);
    }
    if (f.nieprzeczytane) parts.push(" UNSEEN");
    if (f.oflagowane) parts.push(" FLAGGED");
    if (f.od) parts.push(" SINCE " + imapData(f.od));
    if (f.do) parts.push(" BEFORE " + imapData(new Date(Date.parse(f.do + "T00:00:00Z") + 86400000).toISOString().slice(0, 10)));
    if (parts.length === 1) parts.push(" ALL");
    const r = await this.cmd(...parts);
    const out: number[] = [];
    for (const u of r.untagged) { const m = u.text.match(/^\* SEARCH(.*)$/i); if (m) for (const x of m[1].trim().split(/\s+/)) if (/^\d+$/.test(x)) out.push(Number(x)); }
    return out.sort((a, b) => a - b);
  }
  // Flags, size, date, structure and (optionally) chosen headers of many messages; `set` is a list of numbers or a range.
  async meta(set: number[] | { od: number; do: number }, uidMode: boolean, naglowki: boolean, struktura = true): Promise<Meta[]> {
    const ids = Array.isArray(set) ? set.map((x) => Math.floor(x)).filter((x) => x > 0).join(",") : `${Math.max(1, Math.floor(set.od))}:${Math.max(1, Math.floor(set.do))}`;
    if (!ids) return [];
    const items = "UID FLAGS INTERNALDATE RFC822.SIZE" + (struktura ? " BODYSTRUCTURE" : "") + (naglowki ? ` BODY.PEEK[HEADER.FIELDS (${POLA})]` : "");
    const r = await this.cmd(`${uidMode ? "UID " : ""}FETCH ${ids} (${items})`);
    const out: Meta[] = [];
    for (const u of r.untagged) {
      const m = u.text.match(/^\* \d+ FETCH (.*)$/i);
      if (!m) continue;
      const t = tok(m[1], u.literals)[0];
      if (!Array.isArray(t)) continue;
      const x: Meta = { uid: 0, flagi: [], size: 0, internaldate: "", bs: null, sekcje: {} };
      for (let k = 0; k + 1 < t.length; k += 2) {
        const key = str(t[k]).toUpperCase(), v = t[k + 1];
        if (key === "UID") x.uid = Number(str(v));
        else if (key === "FLAGS") x.flagi = (Array.isArray(v) ? v : []).map((f) => str(f));
        else if (key === "RFC822.SIZE") x.size = Number(str(v));
        else if (key === "INTERNALDATE") x.internaldate = str(v);
        else if (key === "BODYSTRUCTURE") x.bs = v;
        else if (key.startsWith("BODY[")) x.sekcje[key.replace(/<\d+>$/, "")] = v instanceof Uint8Array ? v : enc.encode(str(v));
      }
      if (x.uid) out.push(x);
    }
    return out;
  }
  // one MIME part (still encoded as in the message), at most `max` bytes
  async part(uid: number, id: string, max?: number): Promise<Uint8Array | null> {
    if (!/^\d{1,3}(\.\d{1,3}){0,12}$/.test(id)) throw new Error("imap: nieprawidłowa część");
    const r = await this.cmd(`UID FETCH ${Math.floor(uid)} (UID BODY.PEEK[${id}]${max ? `<0.${Math.floor(max)}>` : ""})`);
    for (const u of r.untagged) {
      const m = u.text.match(/^\* \d+ FETCH (.*)$/i);
      const t = m ? tok(m[1], u.literals)[0] : null;
      if (!Array.isArray(t)) continue;
      let ok = false, body: Uint8Array | null = null;
      for (let k = 0; k + 1 < t.length; k += 2) {
        const key = str(t[k]).toUpperCase(), v = t[k + 1];
        if (key === "UID") ok = Number(str(v)) === Math.floor(uid);
        else if (key.startsWith("BODY[")) body = v instanceof Uint8Array ? v : enc.encode(str(v));
      }
      if (ok && body) return body;
    }
    return null;
  }
  async logout(): Promise<void> { try { await this.cmd("LOGOUT"); } catch { /* the server may just hang up */ } this.close(); }
}

export function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let t: number | undefined;
  const timer = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t)) as Promise<T>;
}

// the kind of a folder: from the special-use flag (RFC 6154), else from its usual names; "" = an ordinary folder
export function typFolderu(f: Folder): string {
  if (f.raw.toUpperCase() === "INBOX") return "inbox";
  const flag = f.flagi.map((x) => x.toLowerCase()).find((x) => ["\\sent", "\\drafts", "\\trash", "\\junk", "\\archive"].includes(x));
  if (flag) return flag.slice(1);
  const leaf = f.nazwa.split(f.delim).pop()!.toLowerCase();
  if (/^(sent|sent items|sent messages|wysłane|wyslane|elementy wysłane)$/.test(leaf)) return "sent";
  if (/^(drafts?|robocze|szkice|wersje robocze)$/.test(leaf)) return "drafts";
  if (/^(trash|kosz|deleted|deleted items|deleted messages|elementy usunięte)$/.test(leaf)) return "trash";
  if (/^(junk|spam|junk e-mail|wiadomości-śmieci)$/.test(leaf)) return "junk";
  if (/^(archive|archives|archiwum)$/.test(leaf)) return "archive";
  return "";
}
export const nieWybieralny = (f: Folder) => f.flagi.some((x) => /^\\(noselect|nonexistent)$/i.test(x));
// the one folder of a kind: the special-use one first, then the shallowest by name
export function folderTypu(list: Folder[], typ: string): Folder | null {
  const c = list.filter((f) => !nieWybieralny(f) && typFolderu(f) === typ);
  const flagged = c.find((f) => f.flagi.some((x) => x.toLowerCase() === "\\" + typ));
  return flagged ?? c.sort((a, b) => a.raw.split(a.delim).length - b.raw.split(b.delim).length || a.raw.length - b.raw.length)[0] ?? null;
}
