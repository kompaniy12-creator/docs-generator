// Company lookup by NIP for the employer section of the portal's forms. Sources, first that knows the firm
// (see _shared/jdg.ts): CEIDG (secret CEIDG_TOKEN), GUS / REGON through DataPort.pl (secret DATAPORT_API_KEY),
// MF's register of VAT payers (no key; VAT payers only).
// Public endpoint (deploy with --no-verify-jwt), therefore: the NIP checksum is verified before anything
// is asked, answers are kept for 30 days (table portal_gus_cache; MF's basic ones shorter), requests are
// capped per address and per day, and the providers' own error texts never reach the caller.
// Answer: { success, nazwa, nip, regon, ulica, kod, miasto, adres, zrodlo: "ceidg" | "gus" | "mf" }.

import { gusFirma, ipKlucz, nipOk, parseAdres } from "./dane.ts";

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
}
const NIEDOSTEPNE = "Usługa pobierania danych firmy jest chwilowo niedostępna — wpisz dane firmy ręcznie.";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });

  let nip = "";
  if (req.method === "GET") nip = new URL(req.url).searchParams.get("nip") || "";
  else if (req.method === "POST") {
    if (Number(req.headers.get("content-length") ?? "0") > 2000) return json({ error: "Nieprawidłowe zapytanie." }, 400, origin);
    try { nip = String((await req.json())?.nip ?? ""); } catch { /* ignore */ }
  } else return json({ error: "Method not allowed" }, 405, origin);
  nip = nip.slice(0, 40).replace(/[^0-9]/g, "");
  if (!nipOk(nip)) return json({ error: "Nieprawidłowy NIP (10 cyfr, zgodna cyfra kontrolna)." }, 400, origin);

  try {
    const w = await gusFirma(nip, await ipKlucz(req));
    // MF alone not knowing the NIP only means "not a VAT payer": the firm may exist
    if (w.stan === "brak") return json({ error: w.powod === "brak w wykazie VAT" ? "Nie udało się znaleźć danych firmy o tym NIP (nie ma jej w wykazie podatników VAT) — wpisz dane ręcznie." : "Nie znaleziono firmy o tym NIP w rejestrze." }, 404, origin);
    if (w.stan === "limit") return json({ error: "Za dużo zapytań — spróbuj ponownie jutro albo wpisz dane firmy ręcznie." }, 429, origin);
    if (w.stan !== "ok") return json({ error: NIEDOSTEPNE }, 503, origin);
    const a = parseAdres(w.dane.adres);
    return json({ success: true, nazwa: w.dane.nazwa, nip, regon: w.dane.regon, ulica: a.ulica, kod: a.kod, miasto: a.miasto, adres: w.dane.adres, zrodlo: w.zrodlo }, 200, origin);
  } catch (_e) {
    console.error("gus-company: błąd");
    return json({ error: NIEDOSTEPNE }, 503, origin);
  }
});
