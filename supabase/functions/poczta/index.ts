// Poczta: e-mail arriving at the office mailboxes (kadry@, ksiegowosc@) is described by the model and
// becomes a proposal of a task for the team. The original always stays in the mailbox, untouched.
//
// How mail gets here
//   PUSH (primary)  POST ?action=odbierz&skrzynka=kadry|ksiegowosc   header x-poczta-key (POCZTA_WEBHOOK_KEY)
//                   body = ONE raw RFC 822 message (the mail server's forwarder sends a copy of each
//                   incoming message). 15 MB cap, per-minute / per-day limits; answered at once, the
//                   analysis runs after the response.
//   POLL (fallback) POST { action: "run", dry? }   header x-cron-key — IMAP over TLS, strictly read-only
//                   (EXAMINE + BODY.PEEK, see imap.ts): asks only for UIDs above the last one seen, skips
//                   what push already delivered (same Message-ID), finishes analyses that were cut short.
// Both paths run the same pipeline (core.ts): parse -> dedupe by Message-ID per mailbox -> mask identifiers
// -> model (no tools; the message is data) -> validate every field -> match the client and the person
// responsible in code -> store a row (first 600 characters only) -> task per the mailbox mode:
//   wylaczona (default)  nothing is read or stored
//   podglad              proposals only; a person clicks "Utwórz zadanie"
//   auto                 tasks for messages that need action from known clients; the rest stays a proposal
//
// Portal (JWT; kadry rows — section Kadry, ksiegowosc rows — section Księgowość, admin — all):
//   { action: "lista", skrzynka?, status?, kategoria?, limit? }
//   { action: "zadanie", id, tytul, opis?, termin?, assignee, pilne? }   -> { zadanie_id, powiadom }
//   { action: "bez_dzialania", id }
//   { action: "ponow", id }                 analyse again from the mailbox (admin; staff when not analysed yet)
// Admin:
//   { action: "status", sprawdz? }          per mailbox: configured, mode, last run, counters, push/poll, login test
//   { action: "ustawienia", ustawienia }    modes, default people, name map, limits
//   { action: "pobierz", skrzynka, ile?, dry? }   poll now, always as a preview (never creates a task)
//   { action: "retencja", miesiace? }       delete rows older than N months (default 6); not scheduled
//   { action: "autotest" }                  model + table round trip on a built-in fictional message
// Cron only: { action: "diag" }             login + counters, proves reading leaves "unseen" unchanged
//
// Secrets: SMTP_PASS (kadry@, the same password as for sending) or IMAP_PASS_KADRY, IMAP_PASS_KSIEGOWOSC,
// POCZTA_WEBHOOK_KEY, CRON_KEY, ANTHROPIC_API_KEY; optional IMAP_HOST, IMAP_PORT, IMAP_USER_KADRY,
// IMAP_USER_KSIEGOWOSC. Nothing here sends e-mail, Telegram or SMS.

import { loadKlienciRows } from "../_shared/klienci.ts";
import nodemailer from "npm:nodemailer@6.9.14";
import { Imap } from "./imap.ts";
import { ImapZapis } from "./imapw.ts";
import { type Deps, handle, type Me, type Row, type Store } from "./core.ts";
import { normNazwa, type Skrzynka, SKRZYNKI, wiersze } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-opus-4-8";
// the certificate of the mail server is issued for the hosting name, not for mail.td-group.pl
const IMAP_HOST = Deno.env.get("IMAP_HOST") ?? "host552333.hostido.net.pl";
const IMAP_PORT = Number(Deno.env.get("IMAP_PORT") ?? "993");
// sending goes through the same host with the mailbox's own login (never mail.td-group.pl: the certificate is for the hosting name)
const SMTP_HOST = Deno.env.get("POCZTA_SMTP_HOST") ?? IMAP_HOST;
const SMTP_PORT = Number(Deno.env.get("POCZTA_SMTP_PORT") ?? "465");
const SMTP_USER = (Deno.env.get("SMTP_USER") ?? "kadry@td-group.pl").toLowerCase();
const KONTA: Record<Skrzynka, { user: string; pass: string }> = {
  kadry: { user: Deno.env.get("IMAP_USER_KADRY") ?? SKRZYNKI.kadry.adres, pass: "" },
  ksiegowosc: { user: Deno.env.get("IMAP_USER_KSIEGOWOSC") ?? SKRZYNKI.ksiegowosc.adres, pass: Deno.env.get("IMAP_PASS_KSIEGOWOSC") ?? "" },
};
KONTA.kadry.pass = Deno.env.get("IMAP_PASS_KADRY") ?? (SMTP_USER === KONTA.kadry.user.toLowerCase() ? Deno.env.get("SMTP_PASS") ?? "" : "");

// deno-lint-ignore no-explicit-any
type Any = any;
function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
async function rows<T = Any>(path: string, init: RequestInit = {}): Promise<T[]> {
  const r = await db(path, init);
  if (!r.ok) throw new Error(path.split("?")[0] + ": " + r.status + " " + (await r.text()).slice(0, 160));
  return await wiersze<T>(r);
}
async function count(path: string): Promise<number> {
  const r = await db(path, { method: "HEAD", headers: { Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" } });
  if (!r.ok && r.status !== 206 && r.status !== 416) throw new Error(path.split("?")[0] + ": " + r.status);
  return Number((r.headers.get("content-range") ?? "").split("/")[1] ?? 0) || 0;
}
const T = "poczta_wiadomosci";
const e = encodeURIComponent;
// a value inside in.(...) of PostgREST: quoted, with quotes and backslashes escaped
const q = (s: string) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

const store: Store = {
  async ustawienia() { return (await rows("portal_ustawienia?key=eq.poczta&select=value"))[0]?.value ?? {}; },
  async zapiszUstawienia(v) { await rows("portal_ustawienia", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "poczta", value: v, updated_at: new Date().toISOString() }) }); },
  async zadaniaKadry() { return String((await rows("portal_ustawienia?key=eq.zadania&select=value"))[0]?.value?.kadry ?? "").toLowerCase(); },
  // Staff profiles are built separately and may not be there yet: a missing table or helper is simply "no answer".
  async profil(s, alias) {
    const out = { alias: "", domyslny: "" };
    // the helpers answer with the person who handles it TODAY (the deputy during an absence)
    const rpc = async (fn: string, args: Record<string, string>): Promise<string | null> => {
      const r = await db("rpc/" + fn, { method: "POST", body: JSON.stringify(args) }).catch(() => null);
      if (!r?.ok) { await r?.body?.cancel(); return null; }
      const v = await r.json().catch(() => null);
      return typeof v === "string" ? v.toLowerCase() : "";
    };
    if (alias.trim()) {
      const m = await rpc("portal_pracownik_po_aliasie", { p_alias: alias.trim() });
      if (m) out.alias = m;
      else if (m === null) { // no helper: look the short name up in the table itself, if that exists
        const t = await db("portal_pracownicy?select=email,aliasy&aktywny=is.true").catch(() => null);
        if (t?.ok) { const hit = (await t.json() as Any[]).find((p) => (p.aliasy ?? []).some((a: string) => normNazwa(a) === normNazwa(alias))); if (hit?.email) out.alias = String(hit.email).toLowerCase(); }
        else await t?.body?.cancel();
      }
    }
    const d = await rpc("portal_pracownik_domyslny", { p_dzial: s });
    if (d) out.domyslny = d;
    return out;
  },
  async klientStatus(id) { return (await rows(`klienci_baza?id=eq.${e(id)}&select=status`))[0]?.status ?? null; },
  async stan(s) { return (await rows(`poczta_skrzynki?skrzynka=eq.${s}&select=*`))[0] ?? null; },
  async zapiszStan(s, patch) { await rows("poczta_skrzynki?on_conflict=skrzynka", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ skrzynka: s, ...patch }) }); },
  async lock(s) { const r = await db("rpc/poczta_lock", { method: "POST", body: JSON.stringify({ p_skrzynka: s }) }); if (!r.ok) throw new Error("poczta_lock: " + r.status); return (await r.json()) === true; },
  async unlock(s) { await rows(`poczta_skrzynki?skrzynka=eq.${s}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ lock_at: null }) }); },
  async znajdz(s, id) { return (await rows<Row>(`${T}?skrzynka=eq.${s}&message_id=eq.${e(id)}&select=*`))[0] ?? null; },
  async wiersz(id) { return (await rows<Row>(`${T}?id=eq.${e(id)}&select=*`))[0] ?? null; },
  async claim(row) {
    const r = await db(T, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (r.status === 409) { await r.body?.cancel(); return null; } // unique (skrzynka, message_id) or (skrzynka, uidvalidity, uid)
    if (!r.ok) throw new Error(T + ": " + r.status + " " + (await r.text()).slice(0, 160));
    return (await r.json())[0] ?? null;
  },
  async patch(id, p) { await rows(`${T}?id=eq.${e(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(p) }); },
  async usun(id) { await rows(`${T}?id=eq.${e(id)}&droga=eq.test`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); },
  async licz(s, f) {
    let p = `${T}?select=id&skrzynka=eq.${s}`;
    if (f.analizowane) p += `&analiza_start=gte.${e(f.od)}`;
    else if (f.auto) p += `&sprawdzono_at=gte.${e(f.od)}&powod=eq.auto`;
    else p += `&created_at=gte.${e(f.od)}`;
    if (f.droga) p += `&droga=eq.${f.droga}`;
    if (f.odAdres) p += `&od_adres=eq.${e(f.odAdres)}`;
    return await count(p);
  },
  async watek(s, ids, watek) {
    const or = [`watek.eq.${q(watek)}`];
    if (ids.length) or.push(`message_id.in.(${ids.map(q).join(",")})`, `watek.in.(${ids.map(q).join(",")})`);
    return await rows(`${T}?skrzynka=eq.${s}&zadanie_id=not.is.null&select=zadanie_id,created_at&or=${e("(" + or.join(",") + ")")}&limit=50`);
  },
  async zadania(ids) { return ids.length ? await rows(`portal_zadania?id=in.(${ids.map(e).join(",")})&select=id,status,assignee,tytul`) : []; },
  async zadanieInsert(spec) {
    const ins = await rows("portal_zadania?on_conflict=klucz", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(spec) });
    if (ins[0]) return ins[0];
    const old = (await rows(`portal_zadania?klucz=eq.${e(spec.klucz)}&select=id,status,assignee,tytul`))[0];
    if (!old) throw new Error("zadanie: nie zapisano");
    return old;
  },
  async zadanieKomentarz(id, text, at) {
    const cur = (await rows(`portal_zadania?id=eq.${e(id)}&select=komentarze`))[0];
    if (!cur) return;
    const list = [...(Array.isArray(cur.komentarze) ? cur.komentarze : []), { at, by: "system", text }].slice(-200);
    await rows(`portal_zadania?id=eq.${e(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ komentarze: list }) });
  },
  async lista(skrzynki, f) {
    let p = `${T}?select=*&skrzynka=in.(${skrzynki.join(",")})&droga=neq.test&order=created_at.desc&limit=${f.limit}`;
    if (f.status) p += `&status=eq.${f.status}`;
    if (f.kategoria) p += `&kategoria=eq.${f.kategoria}`;
    return await rows<Row>(p);
  },
  async niedokonczone(s, starsze, mlodsze) {
    return await rows<Row>(`${T}?select=*&skrzynka=eq.${s}&status=eq.nowa&ai_at=is.null&analiza_start=lt.${e(starsze)}&created_at=gt.${e(mlodsze)}&order=created_at.asc&limit=5`);
  },
  async statystyki(s) {
    const out: Record<string, number> = {};
    for (const st of ["nowa", "zadanie", "bez_dzialania", "pominieta", "blad"]) out[st] = await count(`${T}?select=id&skrzynka=eq.${s}&status=eq.${st}`);
    return out;
  },
  async dziennik(row) { await rows("poczta_dostep", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }); },
  async dziennikLicz(kto, od) { return await count(`poczta_dostep?select=id&kto=eq.${e(kto)}&at=gte.${e(od)}`); },
  async dziennikLista(limit) { return await rows(`poczta_dostep?select=at,kto,akcja,skrzynka,folder,uid,msg_hash,czesc,rozmiar,szczegoly&akcja=in.(otwarcie,zalacznik,analiza,zmiana)&order=at.desc&limit=${limit}`); },
  async dziennikSprzataj(starsze) { await rows(`poczta_dostep?akcja=in.(lista,foldery)&at=lt.${e(starsze)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); },
  async ktoCo(s, hash) {
    if (!/^[0-9a-f]{32}$/.test(hash)) return [];
    const a = await rows(`poczta_dostep?select=kto,akcja,at&skrzynka=eq.${s}&msg_hash=eq.${hash}&akcja=in.(otwarcie,zalacznik)&order=at.asc&limit=40`);
    const b = await rows(`poczta_wyslane?select=kto,odp_tryb,at&skrzynka=eq.${s}&odp_hash=eq.${hash}&wynik=eq.wyslano&order=at.asc&limit=20`);
    return [...a, ...b.map((x: Any) => ({ kto: x.kto, akcja: x.odp_tryb === "forward" ? "przekazanie" : "odpowiedz", at: x.at }))];
  },
  async wyslaneClaim(row) {
    const r = await db("poczta_wyslane", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (r.status === 409) { await r.body?.cancel(); return null; } // unique (klucz): sent already
    if (!r.ok) throw new Error("poczta_wyslane: " + r.status + " " + (await r.text()).slice(0, 160));
    return (await r.json())[0]?.id ?? null;
  },
  async wyslanePatch(id, p) { await rows(`poczta_wyslane?id=eq.${Number(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(p) }); },
  async wyslaneLicz(f) { return await count(`poczta_wyslane?select=id&at=gte.${e(f.od)}&wynik=neq.blad` + (f.kto ? `&kto=eq.${e(f.kto)}` : "") + (f.skrzynka ? `&skrzynka=eq.${f.skrzynka}` : "")); },
  async wyslaneLista(limit) { return await rows(`poczta_wyslane?select=at,kto,skrzynka,odbiorcy_do,odbiorcy_dw,odbiorcy_udw,temat,message_id,rozmiar,zalaczniki,wynik,blad,odp_tryb&order=at.desc&limit=${limit}`); },
  async znaneAdresy(s, adresy) {
    // only plain addresses go into the filters; anything unusual simply counts as "not known"
    const a = adresy.filter((x) => /^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(x)).slice(0, 60);
    if (!a.length) return [];
    const out = new Set<string>();
    for (const r of await rows(`${T}?select=od_adres&skrzynka=eq.${s}&od_adres=in.(${a.map(q).join(",")})&limit=200`)) out.add(r.od_adres);
    const arr = e("{" + a.join(",") + "}");
    for (const r of await rows(`poczta_wyslane?select=odbiorcy_do,odbiorcy_dw&skrzynka=eq.${s}&wynik=eq.wyslano&or=(odbiorcy_do.ov.${arr},odbiorcy_dw.ov.${arr})&limit=200`)) for (const x of [...r.odbiorcy_do, ...r.odbiorcy_dw]) if (a.includes(x)) out.add(x);
    return [...out];
  },
  async adresySzukaj(s, qq) {
    const k = qq.replace(/[^a-z0-9@._-]/g, "");
    if (k.length < 2) return [];
    const r = await rows(`${T}?select=od_adres&skrzynka=eq.${s}&od_adres=ilike.${e("*" + k + "*")}&order=created_at.desc&limit=60`);
    return [...new Set(r.map((x: Any) => String(x.od_adres)))].slice(0, 8) as string[];
  },
  async podpis(kto, s) { return (await rows(`poczta_podpisy?select=html&kto=eq.${e(kto)}&skrzynka=eq.${s}`))[0]?.html ?? null; },
  async podpisZapisz(kto, s, html) { await rows("poczta_podpisy?on_conflict=kto,skrzynka", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ kto, skrzynka: s, html, updated_at: new Date().toISOString() }) }); },
  async pracownik(email) {
    const r = await db(`portal_pracownicy?select=imie_nazwisko&email=eq.${e(email)}`).catch(() => null);
    if (!r?.ok) { await r?.body?.cancel(); return ""; } // the staff profiles may not exist
    return String((await r.json())[0]?.imie_nazwisko ?? "");
  },
  async usunStarsze(cutoff) { return (await rows(`${T}?created_at=lt.${e(cutoff)}&select=id`, { method: "DELETE", headers: { Prefer: "return=representation" } })).length; },
};

async function portalUser(req: Request): Promise<Me | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (m.portal !== true || !u.email) return null;
  return { email: String(u.email).toLowerCase(), admin: m.portal_admin === true, sekcje: Array.isArray(m.portal_sections) ? m.portal_sections.map(String) : null };
}
async function portalUsers(): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    if (!r.ok) throw new Error("auth admin " + r.status);
    const batch = (await r.json()).users ?? [];
    for (const u of batch) if (u.app_metadata?.portal === true && u.email) out.push(String(u.email).toLowerCase());
    if (batch.length < 1000) break;
  }
  return out;
}
async function ask(req: unknown): Promise<unknown> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(60000),
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(req),
  });
  if (!res.ok) { console.error("poczta model", res.status, (await res.text()).slice(0, 200)); throw new Error("model " + res.status); }
  const out = await res.json();
  const text = (out.content ?? []).find((b: Any) => b.type === "text")?.text;
  return JSON.parse(text);
}

const deps: Deps = {
  cronKey: Deno.env.get("CRON_KEY") ?? "", webhookKey: Deno.env.get("POCZTA_WEBHOOK_KEY") ?? "", model: MODEL, modelReady: !!ANTHROPIC_KEY,
  konta: { kadry: !!KONTA.kadry.pass, ksiegowosc: !!KONTA.ksiegowosc.pass },
  store, ask, klienci: loadKlienciRows, portalUser, portalUsers, now: () => Date.now(),
  async imap(s, maxLiteral) {
    const im = await Imap.connect(IMAP_HOST, IMAP_PORT, 20000, maxLiteral);
    try { await im.login(KONTA[s].user, KONTA[s].pass); } catch (err) { im.close(); throw err; }
    return im;
  },
  async imapw(s, maxLiteral) {
    const im = await ImapZapis.connect(IMAP_HOST, IMAP_PORT, 20000, maxLiteral) as ImapZapis;
    try { await im.login(KONTA[s].user, KONTA[s].pass); } catch (err) { im.close(); throw err; }
    return im;
  },
  // the mailbox's own SMTP: the envelope sender is the mailbox, the message is the bytes built in mime.ts
  async smtp(s, koperta, raw) {
    const tr = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: KONTA[s].user, pass: KONTA[s].pass }, connectionTimeout: 20000, socketTimeout: 60000 });
    try { await tr.sendMail({ envelope: { from: koperta.from, to: koperta.to }, raw: raw as Any }); } finally { tr.close(); }
  },
  async smtpSprawdz(s) {
    if (!KONTA[s].pass) return false;
    const tr = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: KONTA[s].user, pass: KONTA[s].pass }, connectionTimeout: 15000 });
    try { await tr.verify(); return true; } finally { tr.close(); }
  },
  bg(p) { const rt = (globalThis as Any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(p); },
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json", ...cors(origin) } });
  let out: { status: number; body: unknown; raw?: { bytes: Uint8Array; headers: Record<string, string> } };
  try { out = await handle(deps, req); }
  catch (err) { console.error("poczta", String((err as Error)?.message ?? err).slice(0, 300)); out = { status: 500, body: { error: "Wewnętrzny błąd serwera." } }; }
  // an attachment: bytes for a download, never a page
  if (out.raw) return new Response(out.raw.bytes as BodyInit, { status: 200, headers: { ...out.raw.headers, ...cors(origin) } });
  return new Response(JSON.stringify(out.body), { status: out.status, headers: { "Content-Type": "application/json", ...cors(origin) } });
});
