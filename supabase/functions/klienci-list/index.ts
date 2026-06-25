// Full clients list from the Google Sheet — PORTAL ONLY (returns internal
// columns: phone, e-mail, Telegram chat id, opiekun, kadrowy, język). Requires a
// Supabase JWT with app_metadata.portal === true. Used by the registry page.

const SHEET_ID = "1JXTjEEPBS6RVbZbuHhpl1E87gBEDdQW0QdnX5JKY5a8";
const SHEET_CSV = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}

async function requirePortal(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const u = await r.json();
  return u?.app_metadata?.portal === true;
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
function col(h: string[], n: string): number { const x = n.toLowerCase(); return h.findIndex((c) => c.toLowerCase().includes(x)); }

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (!(await requirePortal(req))) return json({ error: "Brak dostępu (portal)." }, 403, origin);

  try {
    const res = await fetch(SHEET_CSV, { redirect: "follow" });
    const rows = parseCSV(await res.text());
    if (!rows.length) return json({ clients: [] }, 200, origin);
    const h = rows[0];
    const idx = {
      nazwa: col(h, "nazwa"), nip: col(h, "nip"), adres: col(h, "adres"),
      forma: col(h, "forma prawna"), opod: col(h, "opodatkow"),
      telefon: col(h, "telefon"), email: col(h, "mail"), kontakt: col(h, "kontaktow"),
      miasto: col(h, "miasto"), opiekun: col(h, "opiekun"), kadrowy: col(h, "kadrow"),
      chat: col(h, "telegram"), jezyk: col(h, "język"),
    };
    const g = (row: string[], i: number) => (i >= 0 ? (row[i] || "").trim() : "");
    const clients = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const nip = g(row, idx.nip).replace(/[^0-9]/g, "");
      const nazwa = g(row, idx.nazwa);
      if (!nazwa && !nip) continue;
      clients.push({
        nazwa, nip,
        adres: g(row, idx.adres), forma: g(row, idx.forma), opodatkowanie: g(row, idx.opod),
        telefon: g(row, idx.telefon), email: g(row, idx.email), kontakt: g(row, idx.kontakt),
        miasto: g(row, idx.miasto), opiekun: g(row, idx.opiekun), kadrowy: g(row, idx.kadrowy),
        telegram: g(row, idx.chat), jezyk: g(row, idx.jezyk),
      });
    }
    return json({ clients }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Nie udało się odczytać bazy klientów." }, 502, origin);
  }
});
