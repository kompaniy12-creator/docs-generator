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

// what may ever be sent to the server
export function guard(cmd: string): void {
  if (/[\r\n]/.test(cmd)) throw new Error("imap: niedozwolony znak w poleceniu");
  const ok = /^(LOGIN |EXAMINE |STATUS |UID SEARCH |UID FETCH |FETCH |NOOP$|LOGOUT$)/.test(cmd);
  if (!ok) throw new Error("imap: polecenie spoza listy tylko-do-odczytu");
  if (/FETCH /.test(cmd)) {
    // message data only through PEEK; plain BODY[...] and RFC822 / RFC822.TEXT set \Seen
    const items = cmd.replace(/BODY\.PEEK\[[^\]]*\](<\d+\.\d+>)?/g, "").replace(/RFC822\.SIZE/g, "");
    if (/BODY\[|RFC822|BINARY\[/.test(items)) throw new Error("imap: FETCH bez PEEK jest zabroniony");
  }
}
export const quote = (s: string) => {
  if (/[\r\n\0]/.test(s) || /[^\x20-\x7e]/.test(s)) throw new Error("imap: wartość nie nadaje się do polecenia");
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
};

export class Imap {
  private buf = new Uint8Array(0);
  private n = 0;
  constructor(private c: Conn, private timeoutMs = 20000, private maxLiteral = 16 * 1024 * 1024) {}

  static async connect(host: string, port: number, timeoutMs = 20000, maxLiteral?: number): Promise<Imap> {
    // certificate validation stays on (the default); a wrong host name fails here
    const c = await withTimeout(Deno.connectTls({ hostname: host, port }), timeoutMs, "imap: przekroczono czas łączenia");
    const i = new Imap(c, timeoutMs, maxLiteral);
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
  private async cmd(command: string): Promise<{ untagged: { text: string; literals: Uint8Array[] }[]; done: string }> {
    guard(command);
    const tag = "P" + (++this.n);
    await this.c.write(enc.encode(`${tag} ${command}\r\n`));
    const untagged = [];
    for (;;) {
      const r = await this.response();
      if (r.text.startsWith(tag + " ")) {
        const rest = r.text.slice(tag.length + 1);
        // the server's own words only — the command (which may hold the password) is never echoed
        if (!/^OK/i.test(rest)) throw new Error("imap: " + command.split(" ")[0] + " odrzucone: " + rest.replace(/[^\x20-\x7e]/g, "").slice(0, 120));
        return { untagged, done: rest };
      }
      untagged.push(r);
    }
  }

  async login(user: string, pass: string): Promise<void> { await this.cmd(`LOGIN ${quote(user)} ${quote(pass)}`); }

  async examine(box = "INBOX"): Promise<Examined> {
    const r = await this.cmd(`EXAMINE ${quote(box)}`);
    if (!/\[READ-ONLY\]/i.test(r.done)) throw new Error("imap: skrzynka nie została otwarta tylko do odczytu");
    const all = r.untagged.map((u) => u.text).join("\n");
    const num = (re: RegExp) => Number(all.match(re)?.[1] ?? NaN);
    const out = { exists: num(/^\* (\d+) EXISTS/im), uidvalidity: num(/\[UIDVALIDITY (\d+)\]/i), uidnext: num(/\[UIDNEXT (\d+)\]/i) };
    if (!Number.isFinite(out.exists) || !Number.isFinite(out.uidvalidity)) throw new Error("imap: niepełna odpowiedź EXAMINE");
    if (!Number.isFinite(out.uidnext)) out.uidnext = 0; // very old servers: found through the last message instead
    return out;
  }
  async status(box = "INBOX"): Promise<{ messages: number; unseen: number; uidnext: number; uidvalidity: number }> {
    const r = await this.cmd(`STATUS ${quote(box)} (MESSAGES UNSEEN UIDNEXT UIDVALIDITY)`);
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
  async logout(): Promise<void> { try { await this.cmd("LOGOUT"); } catch { /* the server may just hang up */ } this.close(); }
}

export function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let t: number | undefined;
  const timer = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t)) as Promise<T>;
}
