// The office's client base (name, NIP, contact data, Telegram chat).
//
// Source of entry is the clients sheet; the portal works from its own private copy in the
// database (portal_klienci, service role only). The copy is refreshed from the sheet when it
// is older than REFRESH_MIN and the sheet answers; when the sheet is unreachable (or has been
// closed to link access) the copy keeps serving, so nothing in the portal depends on the
// sheet being readable by link.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SHEET_ID = Deno.env.get("KLIENCI_SHEET_ID") ?? "1JXTjEEPBS6RVbZbuHhpl1E87gBEDdQW0QdnX5JKY5a8";
const SHEET_CSV = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const REFRESH_MIN = 30;

export type KlientRow = {
  nazwa: string; nip: string; adres: string; forma: string; opodatkowanie: string; telefon: string;
  email: string; kontakt: string; miasto: string; opiekun: string; kadrowy: string; telegram: string; jezyk: string;
};
export type Klient = { nazwa: string; email: string; chat: string };

export const okMail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
// the first valid address of a cell that may hold several
export function firstMail(cell: string): string {
  const m = (cell ?? "").trim().split(/[;,\s]+/)[0] ?? "";
  return okMail(m) ? m : "";
}

function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", i = 0, inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function readSheet(): Promise<KlientRow[]> {
  const res = await fetch(SHEET_CSV, { redirect: "follow" });
  if (!res.ok) throw new Error("arkusz klientów: HTTP " + res.status);
  if (!(res.headers.get("content-type") ?? "").includes("csv")) throw new Error("arkusz klientów: brak dostępu");
  const rows = parseCSV(await res.text());
  if (rows.length < 2) throw new Error("arkusz klientów: pusty");
  const h = rows[0].map((c) => c.toLowerCase());
  const col = (n: string) => h.findIndex((c) => c.includes(n));
  const idx = {
    nazwa: col("nazwa"), nip: col("nip"), adres: col("adres"), forma: col("forma prawna"), opodatkowanie: col("opodatkow"),
    telefon: col("telefon"), email: col("mail"), kontakt: col("kontaktow"), miasto: col("miasto"),
    opiekun: col("opiekun"), kadrowy: col("kadrow"), telegram: col("telegram"), jezyk: col("język"),
  };
  if (idx.nip < 0 || idx.nazwa < 0) throw new Error("arkusz klientów: brak kolumn Nazwa / NIP");
  const g = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const out: KlientRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const nip = g(row, idx.nip).replace(/\D/g, ""), nazwa = g(row, idx.nazwa);
    if (!nazwa && !nip) continue;
    out.push({
      nazwa, nip, adres: g(row, idx.adres), forma: g(row, idx.forma), opodatkowanie: g(row, idx.opodatkowanie),
      telefon: g(row, idx.telefon), email: g(row, idx.email), kontakt: g(row, idx.kontakt), miasto: g(row, idx.miasto),
      opiekun: g(row, idx.opiekun), kadrowy: g(row, idx.kadrowy), telegram: g(row, idx.telegram), jezyk: g(row, idx.jezyk),
    });
  }
  return out;
}

async function sync(): Promise<void> {
  const list = await readSheet();
  if (list.length < 3) throw new Error("arkusz klientów: podejrzanie mało wierszy"); // never wipe the copy on a broken read
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const rows = [];
  for (const k of list) {
    const id = k.nip.length === 10 ? k.nip : "nazwa:" + k.nazwa.toLowerCase();
    if (seen.has(id)) continue; // the first row of a duplicated NIP wins, as before
    seen.add(id);
    rows.push({ id, nip: k.nip, dane: { ...k, poz: rows.length }, synced_at: now }); // poz keeps the sheet order
  }
  const up = await db("portal_klienci", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  if (!up.ok) throw new Error("kopia bazy klientów: " + up.status);
  // rows that left the sheet leave the copy too
  await db(`portal_klienci?synced_at=lt.${encodeURIComponent(now)}`, { method: "DELETE" });
}

async function readCopy(): Promise<{ rows: KlientRow[]; age: number }> {
  const r = await db("portal_klienci?select=dane,synced_at&order=id");
  if (!r.ok) throw new Error("kopia bazy klientów: " + r.status);
  const data: { dane: KlientRow & { poz?: number }; synced_at: string }[] = await r.json();
  data.sort((a, b) => (a.dane.poz ?? 0) - (b.dane.poz ?? 0));
  const newest = data.reduce((m, x) => Math.max(m, Date.parse(x.synced_at)), 0);
  return { rows: data.map(({ dane: { poz: _p, ...k } }) => k as KlientRow), age: newest ? (Date.now() - newest) / 60000 : Infinity };
}

// All clients. Throws only when there is neither a copy nor a readable sheet.
export async function loadKlienciRows(): Promise<KlientRow[]> {
  let copy = await readCopy();
  if (copy.age > REFRESH_MIN) {
    try { await sync(); copy = await readCopy(); }
    catch (e) {
      console.error("klienci sync", e);
      if (!copy.rows.length) throw new Error("Baza klientów jest niedostępna (" + String((e as Error)?.message ?? e) + ").");
    }
  }
  return copy.rows;
}

// Contact data by NIP.
export async function loadKlienci(): Promise<Map<string, Klient>> {
  const out = new Map<string, Klient>();
  for (const k of await loadKlienciRows()) {
    if (k.nip.length !== 10 || out.has(k.nip)) continue;
    out.set(k.nip, { nazwa: k.nazwa, email: firstMail(k.email), chat: k.telegram });
  }
  return out;
}
