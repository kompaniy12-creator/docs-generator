// strona: the public site td-group.pl talks to the portal through this one function. No sign-in: every value is
// checked here (logic.ts) and nothing is ever read back to the caller.
//
// POST { action: "zgloszenie", imie, email, telefon?, firma?, wiadomosc?, wycena?, jezyk?, strona?, www, t }
//   the contact form. The submission is saved (strona_zgloszenia — the Pulpit shows it) and mailed to the office
//   with Reply-To set to the visitor. `www` is a field people never see (robots fill it) and `t` is how long the
//   page was open: both kinds of robot get an "ok" and nothing is stored. Caps per hour and per day.
// POST { action: "wizyta", p, r }
//   one page view: a known path of the site and the kind of the referring site are counted per day
//   (strona_wizyty). No address, no identifier, nothing about the visitor is stored.
//
// Secrets: SMTP_PASS (mailbox kadry@), optional SMTP_HOST / SMTP_PORT / SMTP_USER.

import nodemailer from "npm:nodemailer@6.9.14";
import { BOT, mail, SCIEZKA, zgloszenie, zrodlo } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "smtp.jdm.pl";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "kadry@td-group.pl";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? "";
const BIURO = "info@td-group.pl";
// the site itself and its local preview
const ORIGINS = ["https://td-group.pl", "http://localhost:4173"];
const NA_GODZINE = 15, NA_DOBE = 60;

function cors(origin: string) {
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
}
function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  if (!ORIGINS.includes(origin)) return new Response("", { status: 403 });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false }, 405, origin);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 12000) return json({ ok: false }, 413, origin);
    body = JSON.parse(raw);
  } catch { return json({ ok: false }, 400, origin); }

  try {
    if (body?.action === "wizyta") {
      const p = String(body.p ?? "");
      if (SCIEZKA.test(p) && !BOT.test(req.headers.get("User-Agent") ?? "")) {
        const r = await db("rpc/strona_wizyta", { method: "POST", body: JSON.stringify({ p_sciezka: p, p_zrodlo: zrodlo(body.r) }) });
        if (!r.ok) console.error("strona wizyta", r.status);
      }
      return json({ ok: true }, 200, origin);
    }

    if (body?.action === "zgloszenie") {
      // robots: the hidden field filled in, or the form sent sooner than a person can type it
      if (String(body.www ?? "") !== "" || !(Number(body.t) >= 2500)) return json({ ok: true }, 200, origin);
      const z = zgloszenie(body);
      if (!z) return json({ ok: false, error: "dane" }, 400, origin);

      const doba = await db(`strona_zgloszenia?select=utworzono,email,wiadomosc,wycena&utworzono=gte.${new Date(Date.now() - 86400000).toISOString()}&order=utworzono.desc&limit=${NA_DOBE + 1}`);
      if (!doba.ok) return json({ ok: false }, 500, origin);
      const ostatnie: { utworzono: string; email: string; wiadomosc: string; wycena: string }[] = await doba.json();
      // the same form sent twice (double click, reload): one submission
      if (ostatnie.some((o) => o.email === z.email && o.wiadomosc === z.wiadomosc && o.wycena === z.wycena && Date.parse(o.utworzono) > Date.now() - 600000)) return json({ ok: true }, 200, origin);
      if (ostatnie.length >= NA_DOBE || ostatnie.filter((o) => Date.parse(o.utworzono) > Date.now() - 3600000).length >= NA_GODZINE) return json({ ok: false, error: "limit" }, 429, origin);

      const ins = await db("strona_zgloszenia", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(z) });
      if (!ins.ok) { console.error("strona zgloszenie", ins.status); return json({ ok: false }, 500, origin); }
      const id = (await ins.json())[0]?.id;

      // the submission is safe in the database; the mail is a convenience and its failure is only noted
      let wyslano = false;
      if (SMTP_PASS) {
        try {
          const m = mail(z);
          const tr = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: SMTP_USER, pass: SMTP_PASS }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
          await tr.sendMail({ from: `TD Consulting Group — strona <${SMTP_USER}>`, to: BIURO, replyTo: { name: z.imie.replace(/["<>]/g, ""), address: z.email }, subject: m.subject, text: m.text });
          wyslano = true;
        } catch (e) { console.error("strona mail", String((e as Error)?.message ?? e).replace(/[^\x20-\x7e]/g, " ").slice(0, 200)); }
      }
      if (id) await db(`strona_zgloszenia?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ mail_ok: wyslano }) });
      return json({ ok: true }, 200, origin);
    }
    return json({ ok: false }, 400, origin);
  } catch (e) {
    console.error("strona", String((e as Error)?.message ?? e).slice(0, 200));
    return json({ ok: false }, 500, origin);
  }
});
