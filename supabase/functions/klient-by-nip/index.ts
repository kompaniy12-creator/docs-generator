// Client lookup by NIP in the office's client base. Only OUR clients — if the NIP isn't there,
// the firm isn't a client.
// PUBLIC endpoint (called from the intake form), so it gives the minimum the form fills in: the firm's
// name and its register address (nazwa / miasto / ulica / kod / regon — public register data) and
// whether the office already holds an e-mail address (never the address or a part of it).
// Internal columns (telefon, e-mail, Telegram chat id, opiekun, kadrowy, język) never leave the server.
// One client is read by its NIP (not the whole list); calls are capped per address and per day.

import { firmaConfigured, getFirma } from "../_shared/firma.ts";
import { firstMail } from "../_shared/klienci.ts";
import { gusFirma, ipKlucz, limit, nipOk, parseAdres } from "../gus-company/dane.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_IP_DZIEN = 60;     // lookups a day from one address (an office's staff share one)
const MAX_DZIEN = 3000;      // ... and from everybody together

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

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });

  let nip = "";
  if (req.method === "GET") nip = new URL(req.url).searchParams.get("nip") || "";
  else if (req.method === "POST") {
    if (Number(req.headers.get("content-length") ?? "0") > 2000) return json({ error: "Nieprawidłowe zapytanie." }, 400, origin);
    try { nip = String((await req.json())?.nip ?? ""); } catch { /* */ }
  } else return json({ error: "Method not allowed" }, 405, origin);
  nip = nip.slice(0, 40).replace(/[^0-9]/g, "");
  if (nip.length !== 10) return json({ error: "Nieprawidłowy NIP (10 cyfr)." }, 400, origin);
  // a number that cannot be a NIP is nobody's: the same answer as for any firm that is not a client
  if (!nipOk(nip)) return json({ found: false, nip }, 200, origin);

  const ip = await ipKlucz(req);
  if (!(await limit("kbn-ip:" + ip, MAX_IP_DZIEN)) || !(await limit("kbn", MAX_DZIEN))) {
    return json({ error: "Za dużo zapytań — spróbuj ponownie później albo skontaktuj się z biurem." }, 429, origin);
  }

  // 1) the client, by its NIP
  let client: { nazwa: string; miasto: string; adres: string; mail: string } | null = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/portal_klienci?nip=eq.${nip}&select=dane&limit=1`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const k = (await r.json())[0]?.dane;
    if (k) client = { nazwa: String(k.nazwa ?? ""), miasto: String(k.miasto ?? ""), adres: String(k.adres ?? ""), mail: firstMail(String(k.email ?? "")) };
  } catch (_e) {
    console.error("klient-by-nip: baza klientów niedostępna");
    return json({ error: "Nie udało się odczytać bazy klientów." }, 502, origin);
  }
  if (!client) return json({ found: false, nip }, 200, origin);

  // The form only needs to know that documents can go to an address the office already has.
  // `email_hint` stays for the published form (it tests it for emptiness) but shows nothing of the address.
  const ma_email = !!client.mail, email_hint = ma_email ? "zapisany w biurze" : "";
  let ulica = "", regon = "", kod = "";

  // 2) registry data from our own firm base (filled from rejestr.io on first use).
  // Only reached for firms that are our clients, so the paid first lookup is bounded.
  try {
    const fd = firmaConfigured() ? await getFirma(nip) : null;
    if (fd && fd.found) {
      return json({ found: true, nazwa: fd.nazwa || client.nazwa, nip, miasto: fd.miasto || client.miasto, ulica: fd.ulica || "", kod: fd.kod || "", regon: fd.regon || "", ma_email, email_hint }, 200, origin);
    }
  } catch (_e) { /* fall back to the clients base / GUS below */ }

  // 2a) prefer the address from the clients base
  if (client.adres.trim()) {
    const a = parseAdres(client.adres);
    ulica = a.ulica; kod = a.kod;
    if (!client.miasto && a.miasto) client.miasto = a.miasto;
  }
  // 2b) only if there is no street, best-effort from GUS (cached; within the provider's daily cap)
  if (!ulica) {
    try {
      const g = await gusFirma(nip, null);
      if (g.stan === "ok") {
        regon = g.dane.regon;
        const a = parseAdres(g.dane.adres);
        ulica = a.ulica; kod = a.kod;
        if (!client.miasto && a.miasto) client.miasto = a.miasto;
      }
    } catch (_e) { /* non-fatal — the base is enough */ }
  }
  return json({ found: true, nazwa: client.nazwa, nip, miasto: client.miasto, ulica, kod, regon, ma_email, email_hint }, 200, origin);
});
