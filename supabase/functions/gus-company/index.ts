// GUS company lookup by NIP for the employer section (public intake form + portal).
// Proxies DataPort.pl (GUS BIR 1.1). The DataPort key lives only in the
// DATAPORT_API_KEY secret — never exposed to the browser.
// Public endpoint (called from the client form); deploy with --no-verify-jwt.

const DATAPORT_KEY = Deno.env.get("DATAPORT_API_KEY") ?? "";
const DP_BASE = "https://dataport.pl/api/v1/company/";

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

// "ul. Garbary 71 /9 61-866 Poznań" -> { ulica, kod, miasto }
function parseAdres(adres: string) {
  const out = { ulica: "", kod: "", miasto: "", adres };
  if (!adres) return out;
  const m = adres.match(/(\d{2}-\d{3})/);
  if (m && m.index != null) {
    out.kod = m[1];
    out.ulica = adres.slice(0, m.index).trim();
    out.miasto = adres.slice(m.index + m[1].length).trim();
  } else {
    out.ulica = adres.trim();
  }
  // normalise "71 /9" -> "71/9", collapse spaces
  out.ulica = out.ulica.replace(/\s*\/\s*/g, "/").replace(/\s{2,}/g, " ").trim();
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (!DATAPORT_KEY) return json({ error: "Brak konfiguracji DATAPORT_API_KEY." }, 500, origin);

  let nip = "";
  if (req.method === "GET") {
    nip = new URL(req.url).searchParams.get("nip") || "";
  } else if (req.method === "POST") {
    try { nip = ((await req.json()).nip || "").toString(); } catch { /* ignore */ }
  } else {
    return json({ error: "Method not allowed" }, 405, origin);
  }
  nip = nip.replace(/[^0-9]/g, "");
  if (nip.length !== 10) return json({ error: "Nieprawidłowy NIP (10 cyfr)." }, 400, origin);

  try {
    const res = await fetch(DP_BASE + nip, {
      headers: { "X-API-Key": DATAPORT_KEY, "Accept": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.success === false) {
      const msg = (data && (data.message || data.error)) || ("Nie znaleziono firmy (" + res.status + ").");
      return json({ error: msg }, res.status === 404 ? 404 : 502, origin);
    }
    const a = parseAdres(data.adres || "");
    return json({
      success: true,
      nazwa: data.nazwa || "",
      nip: data.nip || nip,
      regon: data.regon || "",
      ulica: a.ulica,
      kod: a.kod,
      miasto: a.miasto,
      adres: data.adres || "",
    }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Błąd połączenia z GUS." }, 502, origin);
  }
});
