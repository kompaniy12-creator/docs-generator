// The office's client base (name, NIP, contact data, Telegram chat).
//
// The portal is the master of this list: the table portal_klienci (service role only) is the store of
// record, edited in "Baza klientów" through the klienci-baza function. The Google Sheet the list used to
// be copied from is retired — nothing here talks to the network outside the database.
//   id   = the NIP, or 'nazwa:<lower-case name>' for a client without one
//   dane = the row below, plus `poz` (the order in which the list is shown)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

const POLA: (keyof KlientRow)[] = ["nazwa", "nip", "adres", "forma", "opodatkowanie", "telefon", "email", "kontakt", "miasto", "opiekun", "kadrowy", "telegram", "jezyk"];

// All clients, in the order of the list (`poz`, then the name). Throws when the database cannot be read.
export async function loadKlienciRows(): Promise<KlientRow[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/portal_klienci?select=dane&order=id&limit=5000`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  if (!r.ok) throw new Error("Baza klientów jest niedostępna (" + r.status + ").");
  const data: { dane: Partial<KlientRow> & { poz?: number } }[] = await r.json();
  data.sort((a, b) => (a.dane?.poz ?? 1e9) - (b.dane?.poz ?? 1e9) || String(a.dane?.nazwa ?? "").localeCompare(String(b.dane?.nazwa ?? ""), "pl"));
  return data.map(({ dane }) => {
    const k = {} as KlientRow;
    for (const p of POLA) k[p] = String(dane?.[p] ?? "");
    return k;
  });
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
