// Sends the generated packet of a submission to the employer for signing:
// by e-mail from the office mailbox (SMTP of mail.td-group.pl, kadry@td-group.pl;
// needs the SMTP_PASS secret) and / or to the client's
// Telegram chat (TELEGRAM_BOT_TOKEN + the chat id from the clients sheet).
// PORTAL ONLY, Kadry section. The PDF is the one the generator saved for this
// submission (payload.komplet.path in the portal-documents bucket).
//
// POST { action: "test_mail" }  -> { ok } — verifies the SMTP login, sends nothing
// POST { action: "info", id }
//   -> { komplet, filename, email_zgloszenie, email_baza, telegram, mail_configured }
// POST { action: "send", id, email?, mail: bool, telegram: bool }
//   -> { mail: "ok" | "skipped" | "not_configured" | "<error>", telegram: same, status }

import nodemailer from "npm:nodemailer@6.9.14";
import { loadKlienci, okMail } from "../_shared/klienci.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TG = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
// The mail goes out through the office's own server, so it really comes from
// kadry@td-group.pl and passes the domain's strict SPF / DMARC. Port 465 (implicit
// TLS): edge functions may not open 25 / 587.
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "mail.td-group.pl";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "kadry@td-group.pl";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? "";
const MAIL_FROM = `TD Consulting Group — Kadry <${SMTP_USER}>`;
const BUCKET = "portal-documents";

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
async function portalUser(req: Request): Promise<{ email: string } | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const secs = u?.app_metadata?.portal_sections;
  const kadry = u?.app_metadata?.portal_admin === true || !Array.isArray(secs) || secs.includes("kadry");
  return u?.app_metadata?.portal === true && kadry ? { email: u.email ?? "" } : null;
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

// the client's contact data from the client base (by NIP)
async function clientContact(nip: string): Promise<{ email: string; chat: string }> {
  if (!/^\d{10}$/.test(nip)) return { email: "", chat: "" };
  try {
    const k = (await loadKlienci()).get(nip);
    return { email: k?.email ?? "", chat: k?.chat ?? "" };
  } catch (e) { console.error("klienci", e); return { email: "", chat: "" }; }
}

function messageText(worker: string, firma: string, typ: string) {
  const umowa = typ === "praca" ? "umowa o pracę" : "umowa zlecenie";
  return `Dzień dobry,

w załączniku przesyłamy komplet dokumentów do zatrudnienia: ${worker} (${umowa})${firma ? ", " + firma : ""}.

Prosimy o wydrukowanie dokumentów, podpisanie ich przez pracownika oraz osobę reprezentującą firmę i odesłanie skanu podpisanego kompletu w odpowiedzi na tę wiadomość.

Pozdrawiamy
Dział kadr — TD Consulting Group`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const me = await portalUser(req);
  if (!me) return json({ error: "Brak dostępu (portal, sekcja Kadry)." }, 403, origin);

  let body: { action?: string; id?: string; email?: string; mail?: boolean; telegram?: boolean };
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }
  // Checks the mailbox login without sending anything.
  if (body.action === "test_mail") {
    if (!SMTP_PASS) return json({ ok: false, error: "Brak hasła (SMTP_PASS)." }, 200, origin);
    try {
      await nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: SMTP_USER, pass: SMTP_PASS } }).verify();
      return json({ ok: true, user: SMTP_USER, host: SMTP_HOST }, 200, origin);
    } catch (e) {
      return json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) }, 200, origin);
    }
  }
  if (!/^[0-9a-f-]{36}$/i.test(body.id ?? "")) return json({ error: "Brak identyfikatora zgłoszenia." }, 400, origin);

  try {
    const r = await db(`zatrudnienie_zgloszenia?id=eq.${body.id}&select=id,worker_name,status,payload`);
    const row = r.ok ? (await r.json())[0] : null;
    if (!row) return json({ error: "Nie znaleziono zgłoszenia." }, 404, origin);
    const p = row.payload ?? {};
    const komplet = p.komplet ?? null;
    const contact = await clientContact(String(p.z_nip ?? "").replace(/\D/g, ""));

    if (body.action === "info") {
      return json({
        komplet: !!komplet?.path, filename: komplet?.filename ?? "", wygenerowano: komplet?.at ?? null,
        email_zgloszenie: okMail(p.z_email ?? "") ? p.z_email : "",
        email_baza: okMail(contact.email) ? contact.email : "",
        telegram: !!(TG && contact.chat), mail_configured: !!SMTP_PASS, mail_from: SMTP_USER,
        wyslano: Array.isArray(p.wyslano) ? p.wyslano : [],
      }, 200, origin);
    }
    if (body.action !== "send") return json({ error: "Nieznana akcja." }, 400, origin);
    if (!komplet?.path) return json({ error: "Najpierw wygeneruj komplet dokumentów dla tego zgłoszenia." }, 400, origin);
    if (!body.mail && !body.telegram) return json({ error: "Wybierz e-mail lub Telegram." }, 400, origin);

    // The path sits in the submission's payload, which a Kadry user can edit: it is read with the
    // service role, so only a komplet the portal itself saved is accepted — the exact shape
    // history.js writes ("umowa-zlecenie/<date>/<id>.pdf"), known to the document history, and a PDF.
    const path = String(komplet.path);
    const ZLY = "Zapisany komplet ma nieprawidłową ścieżkę pliku — wygeneruj komplet ponownie.";
    if (!/^umowa-zlecenie\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9-]{1,64}\.pdf$/.test(path) || path.includes("..")) return json({ error: ZLY, kod: "sciezka" }, 400, origin);
    const h = await db(`portal_doc_history?pdf_path=eq.${encodeURIComponent(path)}&doc_type=eq.umowa-zlecenie&select=id&limit=1`);
    if (!h.ok || !(await h.json()).length) return json({ error: ZLY, kod: "sciezka" }, 400, origin);
    const file = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    if (!file.ok) return json({ error: "Nie udało się odczytać pliku kompletu." }, 502, origin);
    const pdf = new Uint8Array(await file.arrayBuffer());
    if (!(pdf.length > 4 && pdf[0] === 0x25 && pdf[1] === 0x50 && pdf[2] === 0x44 && pdf[3] === 0x46)) return json({ error: ZLY, kod: "sciezka" }, 400, origin);
    const filename = String(komplet.filename || "komplet.pdf").replace(/[^A-Za-z0-9_.\-]+/g, "_").slice(0, 120) || "komplet.pdf";
    const text = messageText(row.worker_name ?? "", p.z_nazwa ?? "", p.u_typ ?? "");

    let mail = "skipped", telegram = "skipped";
    const to = (body.email ?? "").trim() || p.z_email || contact.email;
    if (body.mail) {
      if (!SMTP_PASS) mail = "not_configured";
      else if (!okMail(to)) mail = "Brak poprawnego adresu e-mail klienta.";
      else {
        try {
          const tr = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: SMTP_USER, pass: SMTP_PASS } });
          await tr.sendMail({
            from: MAIL_FROM, to, bcc: SMTP_USER, // a copy stays in the office mailbox
            subject: `Dokumenty do podpisu — ${row.worker_name ?? ""}`,
            text, attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
          });
          mail = "ok";
        } catch (e) {
          console.error("smtp", e);
          mail = "Błąd wysyłki e-mail: " + String((e as Error)?.message ?? e).slice(0, 120);
        }
      }
    }
    if (body.telegram) {
      if (!TG || !contact.chat) telegram = "Brak czatu Telegram tego klienta w bazie.";
      else {
        const fd = new FormData();
        fd.append("chat_id", contact.chat);
        fd.append("caption", text.slice(0, 1000));
        fd.append("document", new Blob([pdf], { type: "application/pdf" }), filename);
        // the bot token is part of the URL and a network error's text carries the URL: never log it as it is
        try {
          const t = await fetch(`https://api.telegram.org/bot${TG}/sendDocument`, { method: "POST", body: fd });
          telegram = t.ok ? "ok" : "Błąd wysyłki Telegram (" + t.status + ").";
          if (!t.ok) console.error("telegram", t.status, (await t.text()).split(TG).join("***").slice(0, 300));
        } catch (e) {
          console.error("telegram: błąd sieci", e instanceof Error ? e.name : "error");
          telegram = "Błąd wysyłki Telegram (brak połączenia).";
        }
      }
    }

    const sent = mail === "ok" || telegram === "ok";
    if (sent) {
      const log = (Array.isArray(p.wyslano) ? p.wyslano : []).concat([{
        at: new Date().toISOString(), by: me.email,
        email: mail === "ok" ? to : null, telegram: telegram === "ok",
      }]);
      await db(`zatrudnienie_zgloszenia?id=eq.${row.id}`, {
        method: "PATCH", body: JSON.stringify({ status: "wyslane", payload: { ...p, wyslano: log } }),
      });
    }
    return json({ mail, telegram, to: mail === "ok" ? to : null, status: sent ? "wyslane" : row.status }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
