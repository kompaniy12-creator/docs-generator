// Client lookup by NIP in the office's client base (the portal's private copy of the
// clients sheet). Only OUR clients — if the NIP isn't there, the firm isn't a client.
// PUBLIC endpoint (called from the intake form): returns only safe employer
// fields (nazwa/miasto/ulica/regon). Internal columns (telefon, e-mail,
// Telegram Chat ID, opiekun, kadrowy, język) are NEVER returned to the browser —
// the portal/notification jobs read those server-side by NIP when needed.
// ulica/regon (not in the sheet) are best-effort enriched from GUS (DataPort).

import { firmaConfigured, getFirma } from "../_shared/firma.ts";
import { firstMail, loadKlienciRows } from "../_shared/klienci.ts";

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
  let client: { nazwa: string; miasto: string; adres: string; mail: string } | null = null;
  try {
    const k = (await loadKlienciRows()).find((x) => x.nip === nip);
    if (k) client = { nazwa: k.nazwa, miasto: k.miasto, adres: k.adres, mail: firstMail(k.email) };
  } catch (e) {
    console.error("sheet fetch", e);
    return json({ error: "Nie udało się odczytać bazy klientów." }, 502, origin);
  }

  if (!client) return json({ found: false, nip }, 200, origin);

  let ulica = "", regon = "", kod = "";
  // Never the address itself — only a masked hint ("bi***@gmail.com"), so the form can say
  // that documents will go to the address we already have.
  const mm = client.mail.match(/^([^@\s]{1,2})[^@\s]*(@[^@\s]+\.[^@\s]+)$/);
  const email_hint = mm ? mm[1] + "***" + mm[2] : "";

  // 2) registry data from our own firm base (filled from rejestr.io on first use).
  // Only reached for firms that are our clients, so the paid first lookup is bounded.
  try {
    const fd = firmaConfigured() ? await getFirma(nip) : null;
    if (fd && fd.found) {
      return json({
        found: true, nazwa: fd.nazwa || client.nazwa, nip,
        miasto: fd.miasto || client.miasto, ulica: fd.ulica || "", kod: fd.kod || "", regon: fd.regon || "", email_hint,
      }, 200, origin);
    }
  } catch (_e) { /* fall back to the sheet / GUS below */ }

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
    email_hint,
  }, 200, origin);
});
