// Client profile (employer's view of its own firm).
//
// Public endpoint with its own sessions — client accounts are NOT Supabase auth users, so a
// client can never reach any table directly; every answer is built here and filtered by the
// NIP numbers attached to the account.
//
// Client:
//   POST { action: "login", email }        one-time link by e-mail (same answer whether or not
//                                          the account exists)
//   POST { action: "verify", token }       link -> session (30 days)
//   POST { action: "me" }                  x-klient-token: account + firms
//   POST { action: "dane", nip }           workers, submissions in progress, onboarding steps
//   POST { action: "dokument", id }        short-lived link to the packet sent for signing
//   POST { action: "logout" }
// Office (portal JWT, administrator):
//   POST { action: "konta" }               list of client accounts
//   POST { action: "konto_zapisz", email, nip[], nazwa?, aktywny? }
//   POST { action: "konto_usun", id }
//   POST { action: "zaproszenie", id, wyslij }   wyslij=true: e-mail with the link;
//                                                wyslij=false: returns the link to copy

import nodemailer from "npm:nodemailer@6.9.14";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "mail.td-group.pl";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "kadry@td-group.pl";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? "";
const APP = "https://docgenerator.td-group.pl/klient/";
const LINK_MIN = 20, SESSION_DAYS = 30, LINKS_PER_15MIN = 3;

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-klient-token",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const okMail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
async function log(konto: { id?: string; email?: string } | null, akcja: string, info?: unknown) {
  await db("klient_log", { method: "POST", body: JSON.stringify({ konto_id: konto?.id ?? null, email: konto?.email ?? null, akcja, info: info ?? null }) }).catch(() => undefined);
}

type Konto = { id: string; email: string; nip: string[]; nazwa: string | null; aktywny: boolean; last_login?: string | null; created_at?: string };

async function kontoByEmail(email: string): Promise<Konto | null> {
  const r = await db(`klient_konta?email=eq.${encodeURIComponent(email)}&select=*`);
  return r.ok ? (await r.json())[0] ?? null : null;
}
async function makeLink(k: Konto): Promise<string> {
  const token = newToken();
  await db("klient_sesje", {
    method: "POST",
    body: JSON.stringify({ token_hash: await sha256(token), konto_id: k.id, rodzaj: "link", expires_at: new Date(Date.now() + LINK_MIN * 60000).toISOString() }),
  });
  return `${APP}#t=${token}`;
}
async function sendLink(k: Konto, link: string, invitation: boolean) {
  if (!SMTP_PASS) throw new Error("Poczta nie jest skonfigurowana.");
  const tr = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  const text = `Dzień dobry,

${invitation ? "biuro TD Consulting Group udostępniło Państwu profil klienta — podgląd pracowników, terminów dokumentów i spraw prowadzonych dla Państwa firmy." : "oto link do logowania w profilu klienta TD Consulting Group."}

Aby wejść, proszę otworzyć link (ważny ${LINK_MIN} minut, jednorazowy):
${link}

Kolejnym razem wystarczy wpisać ten adres e-mail na stronie ${APP} — wyślemy nowy link. Hasło nie jest potrzebne.

Jeżeli to nie Państwo prosili o logowanie, proszę zignorować tę wiadomość.

Pozdrawiamy
TD Consulting Group`;
  await tr.sendMail({ from: `TD Consulting Group <${SMTP_USER}>`, to: k.email, subject: invitation ? "Profil klienta TD Consulting Group — dostęp" : "Logowanie do profilu klienta TD Consulting Group", text });
}

async function session(req: Request): Promise<Konto | null> {
  const token = req.headers.get("x-klient-token") ?? "";
  if (token.length < 20) return null;
  const r = await db(`klient_sesje?token_hash=eq.${await sha256(token)}&rodzaj=eq.sesja&select=expires_at,klient_konta(*)`);
  const row = r.ok ? (await r.json())[0] : null;
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  const k: Konto | null = row.klient_konta ?? null;
  return k && k.aktywny ? k : null;
}
async function isAdmin(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.app_metadata?.portal === true && u?.app_metadata?.portal_admin === true ? String(u.email ?? "admin") : null;
}

// deno-lint-ignore no-explicit-any
type Any = any;
const UMOWA: Record<string, string> = { praca: "umowa o pracę", zlecenie: "umowa zlecenie" };
const ETAP: Record<string, string> = { nowe: "przyjęte — czeka na sprawdzenie", sprawdzone: "sprawdzone — przygotowujemy dokumenty", wyslane: "dokumenty wysłane do podpisu" };

// What an employer may see about its own people: names, contract terms and document validity.
// No PESEL, no document numbers, no addresses, no scans.
async function firmData(nip: string) {
  const r = await db(`zatrudnienie_zgloszenia?select=id,worker_name,status,created_at,payload&payload->>z_nip=eq.${nip}&status=neq.archiwum&order=created_at.desc`, { headers: { Range: "0-999", "Range-Unit": "items" } });
  if (!r.ok) throw new Error("dane " + r.status);
  const rows: Any[] = await r.json();
  const pracownicy = [], zgloszenia = [];
  for (const w of rows) {
    const p = w.payload ?? {};
    const term = (k: string, bt: string) => ({ data: isDate(p[k]) ? p[k] : null, bezterminowo: p[bt] === true });
    if (w.status === "zatrudniony") {
      pracownicy.push({
        id: w.id, imie_nazwisko: w.worker_name ?? "", stanowisko: p.u_stanowisko ?? "", umowa: UMOWA[p.u_typ] ?? p.u_umowa ?? "",
        od: isDate(p.u_od) ? p.u_od : null, obywatelstwo: p.p_obywatelstwo ?? "",
        terminy: {
          umowa: term("u_do", "u_bezterminowo"), karta_pobytu: term("p_karta_do", "p_karta_bezterm"), zezwolenie: term("p_zezwolenie_do", "p_zezwolenie_bezterm"),
          paszport: term("p_paszport_do", "p_paszport_bezterm"), badania: term("p_badania_do", "p_badania_bezterm"),
        },
      });
    } else {
      zgloszenia.push({
        id: w.id, imie_nazwisko: w.worker_name ?? "", umowa: UMOWA[p.u_typ] ?? "", od: isDate(p.u_od) ? p.u_od : null,
        wyslane: w.created_at, status: w.status, etap: ETAP[w.status] ?? w.status, komplet: w.status === "wyslane" && !!p.komplet?.path,
      });
    }
  }
  // onboarding of the firm itself (accounting): progress and what we are waiting for from the client
  let onboarding = null;
  const o = await db(`onboarding_clients?select=data&data->>nip=eq.${nip}&limit=1`);
  const oc = o.ok ? (await o.json())[0]?.data : null;
  if (oc && !oc.archived) {
    const tasks: Any[] = (oc.tasks ?? []).filter((t: Any) => t.status !== "na");
    const done = tasks.filter((t) => t.status === "done").length;
    onboarding = {
      gotowe: done, wszystkie: tasks.length,
      od_klienta: tasks.filter((t) => t.clientAction && t.status !== "done").map((t) => ({ co: t.clientAction, sprawa: t.title, termin: t.dueDate ?? null, czekamy: t.status === "waiting_client" })),
    };
  }
  return { pracownicy, zgloszenia, onboarding };
}
async function firmNames(nips: string[]): Promise<{ nip: string; nazwa: string }[]> {
  const r = await db(`portal_klienci?nip=in.(${nips.join(",")})&select=nip,dane`);
  const list: Any[] = r.ok ? await r.json() : [];
  return nips.map((n) => ({ nip: n, nazwa: list.find((x) => x.nip === n)?.dane?.nazwa ?? `NIP ${n}` }));
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  let body: Any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }

  try {
    // ---------------- sign-in ----------------
    if (body.action === "login") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!okMail(email)) return json({ error: "Wpisz poprawny adres e-mail." }, 400, origin);
      const k = await kontoByEmail(email);
      if (k?.aktywny) {
        const since = new Date(Date.now() - 15 * 60000).toISOString();
        const c = await db(`klient_sesje?select=token_hash&konto_id=eq.${k.id}&rodzaj=eq.link&created_at=gte.${since}`);
        const recent = c.ok ? (await c.json()).length : 0;
        if (recent < LINKS_PER_15MIN) {
          try { await sendLink(k, await makeLink(k), false); await log(k, "link"); }
          catch (e) { console.error("mail", e); await log(k, "link_blad", { e: String((e as Error)?.message ?? e).slice(0, 160) }); }
        }
      }
      // the same answer for a known and an unknown address
      return json({ ok: true }, 200, origin);
    }
    if (body.action === "verify") {
      const token = String(body.token ?? "");
      if (token.length < 20) return json({ error: "Link jest nieprawidłowy." }, 400, origin);
      const hash = await sha256(token);
      // single use: the link is taken only if it has not been used yet
      const u = await db(`klient_sesje?token_hash=eq.${hash}&rodzaj=eq.link&used_at=is.null&expires_at=gt.${new Date().toISOString()}`, {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ used_at: new Date().toISOString() }),
      });
      const row = u.ok ? (await u.json())[0] : null;
      if (!row) return json({ error: "Link wygasł albo został już użyty. Poproś o nowy." }, 400, origin);
      const kr = await db(`klient_konta?id=eq.${row.konto_id}&select=*`);
      const k: Konto | null = kr.ok ? (await kr.json())[0] : null;
      if (!k?.aktywny) return json({ error: "Konto jest nieaktywne." }, 403, origin);
      const sess = newToken();
      await db("klient_sesje", { method: "POST", body: JSON.stringify({ token_hash: await sha256(sess), konto_id: k.id, rodzaj: "sesja", expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() }) });
      await db(`klient_konta?id=eq.${k.id}`, { method: "PATCH", body: JSON.stringify({ last_login: new Date().toISOString() }) });
      await log(k, "logowanie");
      return json({ ok: true, sesja: sess, email: k.email, firmy: await firmNames(k.nip) }, 200, origin);
    }

    // ---------------- office: client accounts ----------------
    if (["konta", "konto_zapisz", "konto_usun", "zaproszenie"].includes(body.action)) {
      const admin = await isAdmin(req);
      if (!admin) return json({ error: "Tylko administrator portalu." }, 403, origin);
      if (body.action === "konta") {
        const r = await db("klient_konta?select=id,email,nip,nazwa,aktywny,created_at,last_login&order=created_at.desc");
        const konta: Konto[] = r.ok ? await r.json() : [];
        const names = await firmNames([...new Set(konta.flatMap((k) => k.nip))]);
        return json({ konta: konta.map((k) => ({ ...k, firmy: k.nip.map((n) => names.find((x) => x.nip === n)!) })), mail: !!SMTP_PASS }, 200, origin);
      }
      if (body.action === "konto_zapisz") {
        const email = String(body.email ?? "").trim().toLowerCase();
        const nip = [...new Set((Array.isArray(body.nip) ? body.nip : String(body.nip ?? "").split(/[\s,;]+/)).map(digits).filter((n: string) => n.length === 10))];
        if (!okMail(email)) return json({ error: "Wpisz poprawny adres e-mail klienta." }, 400, origin);
        if (!nip.length) return json({ error: "Podaj co najmniej jeden NIP (10 cyfr)." }, 400, origin);
        // only firms that are our clients
        const known = await db(`portal_klienci?nip=in.(${nip.join(",")})&select=nip`);
        const have = new Set((known.ok ? await known.json() : []).map((x: Any) => x.nip));
        const missing = nip.filter((n) => !have.has(n));
        if (missing.length) return json({ error: "Tych NIP nie ma w bazie klientów: " + missing.join(", ") }, 400, origin);
        const r = await db("klient_konta?on_conflict=email", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify({ email, nip, nazwa: String(body.nazwa ?? "").trim().slice(0, 120) || null, aktywny: body.aktywny !== false, created_by: admin }),
        });
        if (!r.ok) return json({ error: "Nie udało się zapisać konta." }, 500, origin);
        const k = (await r.json())[0];
        // a deactivated account loses its sessions at once
        if (!k.aktywny) await db(`klient_sesje?konto_id=eq.${k.id}`, { method: "DELETE" });
        await log(k, "konto_zapis", { by: admin, nip, aktywny: k.aktywny });
        return json({ ok: true, konto: k }, 200, origin);
      }
      const id = String(body.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Brak konta." }, 400, origin);
      const kr = await db(`klient_konta?id=eq.${id}&select=*`);
      const k: Konto | null = kr.ok ? (await kr.json())[0] : null;
      if (!k) return json({ error: "Nie znaleziono konta." }, 404, origin);
      if (body.action === "konto_usun") {
        await db(`klient_konta?id=eq.${id}`, { method: "DELETE" });
        await log(k, "konto_usuniete", { by: admin });
        return json({ ok: true }, 200, origin);
      }
      // zaproszenie
      if (!k.aktywny) return json({ error: "Konto jest nieaktywne." }, 400, origin);
      const link = await makeLink(k);
      if (body.wyslij === true) {
        try { await sendLink(k, link, true); } catch (e) { return json({ error: "Nie udało się wysłać e-maila: " + String((e as Error)?.message ?? e).slice(0, 140) }, 200, origin); }
        await log(k, "zaproszenie", { by: admin });
        return json({ ok: true, wyslano: k.email }, 200, origin);
      }
      await log(k, "link_skopiowany", { by: admin });
      return json({ ok: true, link, wazny_min: LINK_MIN }, 200, origin);
    }

    // ---------------- client session ----------------
    const k = await session(req);
    if (!k) return json({ error: "Sesja wygasła — zaloguj się ponownie.", wyloguj: true }, 401, origin);
    if (body.action === "logout") {
      await db(`klient_sesje?token_hash=eq.${await sha256(req.headers.get("x-klient-token") ?? "")}`, { method: "DELETE" });
      return json({ ok: true }, 200, origin);
    }
    if (body.action === "me") return json({ email: k.email, nazwa: k.nazwa, firmy: await firmNames(k.nip) }, 200, origin);
    if (body.action === "dane") {
      const nip = digits(body.nip);
      if (!k.nip.includes(nip)) return json({ error: "Brak dostępu do tej firmy." }, 403, origin);
      return json(await firmData(nip), 200, origin);
    }
    if (body.action === "dokument") {
      const id = String(body.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Brak dokumentu." }, 400, origin);
      const r = await db(`zatrudnienie_zgloszenia?id=eq.${id}&select=status,payload`);
      const row = r.ok ? (await r.json())[0] : null;
      const p = row?.payload ?? {};
      // only the firm's own packet, and only once the office has sent it for signing
      if (!row || !k.nip.includes(digits(p.z_nip)) || row.status !== "wyslane" || !p.komplet?.path) return json({ error: "Dokument nie jest dostępny." }, 404, origin);
      const s = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/portal-documents/${p.komplet.path}`, {
        method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }),
      });
      const sj = s.ok ? await s.json() : null;
      if (!sj?.signedURL) return json({ error: "Nie udało się przygotować pliku." }, 502, origin);
      await log(k, "pobranie_kompletu", { id });
      return json({ url: `${SUPABASE_URL}/storage/v1${sj.signedURL}`, nazwa: p.komplet.filename ?? "komplet.pdf" }, 200, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
