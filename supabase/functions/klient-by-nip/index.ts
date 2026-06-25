// Client lookup by NIP against the live "clients" Google Sheet (published CSV).
// Only OUR clients — if the NIP isn't in the sheet, the firm isn't a client.
// PUBLIC endpoint (called from the intake form): returns only safe employer
// fields (nazwa/miasto/ulica/regon). Internal columns (telefon, e-mail,
// Telegram Chat ID, opiekun, kadrowy, język) are NEVER returned to the browser —
// the portal/notification jobs read those server-side by NIP when needed.
// ulica/regon (not in the sheet) are best-effort enriched from GUS (DataPort).

const SHEET_ID = "1JXTjEEPBS6RVbZbuHhpl1E87gBEDdQW0QdnX5JKY5a8";
const SHEET_CSV = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const DATAPORT_KEY = Deno.env.get("DATAPORT_API_KEY") ?? "";

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

// minimal RFC-4180 CSV parser (handles quoted fields, commas, escaped quotes, CRLF)
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", i = 0, inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
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

function col(headers: string[], needle: string): number {
  const n = needle.toLowerCase();
  return headers.findIndex((h) => h.toLowerCase().includes(n));
}

function parseAdres(adres: string) {
  const out = { ulica: "", kod: "", miasto: "" };
  if (!adres) return out;
  const m = adres.match(/(\d{2}-\d{3})/);
  if (m && m.index != null) {
    out.kod = m[1];
    out.ulica = adres.slice(0, m.index).trim();
    out.miasto = adres.slice(m.index + m[1].length).trim();
  } else { out.ulica = adres.trim(); }
  out.ulica = out.ulica.replace(/\s*\/\s*/g, "/").replace(/\s{2,}/g, " ").trim();
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });

  let nip = "";
  if (req.method === "GET") nip = new URL(req.url).searchParams.get("nip") || "";
  else if (req.method === "POST") { try { nip = ((await req.json()).nip || "").toString(); } catch { /* */ } }
  else return json({ error: "Method not allowed" }, 405, origin);
  nip = nip.replace(/[^0-9]/g, "");
  if (nip.length !== 10) return json({ error: "Nieprawidłowy NIP (10 cyfr)." }, 400, origin);

  // 1) find the client in the sheet
  let client: { nazwa: string; miasto: string; adres: string } | null = null;
  try {
    const res = await fetch(SHEET_CSV, { redirect: "follow" });
    const csv = await res.text();
    const rows = parseCSV(csv);
    if (rows.length) {
      const headers = rows[0];
      const iNip = col(headers, "nip"), iNazwa = col(headers, "nazwa"),
        iMiasto = col(headers, "miasto"), iAdres = col(headers, "adres");
      for (let r = 1; r < rows.length; r++) {
        const cell = (iNip >= 0 ? rows[r][iNip] : "") || "";
        if (cell.replace(/[^0-9]/g, "") === nip) {
          client = {
            nazwa: (iNazwa >= 0 ? rows[r][iNazwa] : "") || "",
            miasto: (iMiasto >= 0 ? rows[r][iMiasto] : "") || "",
            adres: (iAdres >= 0 ? rows[r][iAdres] : "") || "",
          };
          break;
        }
      }
    }
  } catch (e) {
    console.error("sheet fetch", e);
    return json({ error: "Nie udało się odczytać bazy klientów." }, 502, origin);
  }

  if (!client) return json({ found: false, nip }, 200, origin);

  let ulica = "", regon = "", kod = "";

  // 2a) prefer the address from the sheet
  if (client.adres && client.adres.trim()) {
    const a = parseAdres(client.adres);
    ulica = a.ulica; kod = a.kod;
    if (!client.miasto && a.miasto) client.miasto = a.miasto;
  }

  // 2b) only if the sheet has no street, best-effort enrich from GUS
  if (!ulica && DATAPORT_KEY) {
    try {
      const g = await fetch("https://dataport.pl/api/v1/company/" + nip, {
        headers: { "X-API-Key": DATAPORT_KEY, "Accept": "application/json" },
      });
      const gd = await g.json().catch(() => ({}));
      if (g.ok && gd && gd.success !== false) {
        regon = gd.regon || "";
        const a = parseAdres(gd.adres || "");
        ulica = a.ulica; kod = a.kod;
        if (!client.miasto && a.miasto) client.miasto = a.miasto;
      }
    } catch (_e) { /* non-fatal — sheet data is enough */ }
  }

  return json({
    found: true,
    nazwa: client.nazwa,
    nip,
    miasto: client.miasto,
    ulica,
    kod,
    regon,
  }, 200, origin);
});
