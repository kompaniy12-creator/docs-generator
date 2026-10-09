// Tasks for the team: system tasks, reminders, escalation to the owner.
//
// Scheduled (pg_cron, header x-cron-key):
//   POST { action: "run", dry? }
//     1. system tasks from the Kadry data (unreviewed submission, packet before the first day,
//        ZUS and labour-office deadlines, residence documents and contracts about to end) —
//        created once (key "klucz"), closed by the system when the reason disappears;
//        a ZUS / labour-office task ticked by a person also ticks the duty in Kontrola
//     2. Telegram reminder to every person with tasks due by tomorrow or marked urgent (once a day)
//     3. serious breaches — a statutory deadline missed, an urgent task overdue, any task
//        3 days overdue — are reported to the owner once per task
// Portal (JWT):
//   POST { action: "team" }                  portal users (+ settings for an admin)
//   POST { action: "notify", id, event }     "new" | "done" | "comment" — push to the other side
//   POST { action: "settings", ... }         admin — Telegram chats, owner chat, default HR person
//   POST { action: "test", email }           admin — test message to that person's chat
//
// Telegram texts carry task titles only; system titles name the firm, never the worker.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TG = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CRON_KEY = Deno.env.get("CRON_KEY") ?? "";
const PORTAL = "https://docgenerator.td-group.pl";
const KEY = "zadania";

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
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
function isCron(req: Request) {
  const k = req.headers.get("x-cron-key") ?? "";
  if (!CRON_KEY || k.length !== CRON_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < k.length; i++) diff |= k.charCodeAt(i) ^ CRON_KEY.charCodeAt(i);
  return diff === 0;
}
async function portalUser(req: Request): Promise<{ email: string; admin: boolean } | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.app_metadata?.portal === true && u.email ? { email: String(u.email).toLowerCase(), admin: u.app_metadata.portal_admin === true } : null;
}
async function portalUsers(): Promise<{ email: string; admin: boolean }[]> {
  const out: { email: string; admin: boolean }[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    if (!r.ok) throw new Error("auth admin " + r.status);
    const batch = (await r.json()).users ?? [];
    for (const u of batch) if (u.app_metadata?.portal === true && u.email) out.push({ email: String(u.email).toLowerCase(), admin: u.app_metadata.portal_admin === true });
    if (batch.length < 1000) break;
  }
  return out.sort((a, b) => a.email.localeCompare(b.email));
}

type Settings = { telegram: Record<string, string>; szef: string; kadry: string };
async function settings(): Promise<Settings> {
  const r = await db(`portal_ustawienia?key=eq.${KEY}&select=value`);
  const v = r.ok ? (await r.json())[0]?.value ?? {} : {};
  return { telegram: v.telegram ?? {}, szef: v.szef ?? "", kadry: v.kadry ?? "" };
}
// What is in force: the staff profiles (portal_pracownicy, page Zespół) win over the settings key —
// a person's Telegram chat, and the default HR person (the deputy while that person is away).
// No table, no profile or any error leaves the stored settings in force.
async function effective(): Promise<Settings> {
  const set = await settings();
  try {
    const r = await db("portal_pracownicy?aktywny=is.true&telegram_chat=not.is.null&select=email,telegram_chat");
    for (const p of (r.ok ? await r.json() : []) as { email: string; telegram_chat: string }[]) {
      if (/^-?\d{4,20}$/.test(p.telegram_chat ?? "")) set.telegram[p.email] = p.telegram_chat;
    }
    const d = await db("rpc/portal_pracownik_domyslny", { method: "POST", body: JSON.stringify({ p_dzial: "kadry" }) });
    const who = d.ok ? await d.json() : null;
    // tasks may only go to somebody who can sign in to the portal
    if (typeof who === "string" && who && who !== set.kadry && (await portalUsers()).some((u) => u.email === who)) set.kadry = who;
  } catch (e) { console.error("pracownicy", e); }
  return set;
}
async function tgSend(chat: string, text: string): Promise<boolean> {
  if (!TG || !/^-?\d{4,20}$/.test(chat)) return false;
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3900), disable_web_page_preview: true }),
  }).then((x) => x.json()).catch(() => ({ ok: false }));
  if (!r?.ok) console.error("telegram", r?.description);
  return !!r?.ok;
}

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const days = (iso: string, from: string) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const pl = (iso: string) => iso.split("-").reverse().join(".");

// deno-lint-ignore no-explicit-any
type Row = { id: string; worker_name: string | null; status: string; created_at: string; payload: any };
type Zad = {
  id: string; created_by: string; assignee: string; tytul: string; opis: string | null; termin: string | null; pilne: boolean;
  status: string; zrodlo: string; klucz: string | null; przypomniano: string | null; eskalacja: string | null; done_by: string | null;
};
type Spec = { klucz: string; tytul: string; opis: string; termin: string; pilne: boolean; link: string };

async function pageAll<T>(path: string): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db(path, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error(path.split("?")[0] + ": " + r.status);
    const part: T[] = await r.json();
    all.push(...part);
    if (part.length < 1000) break;
  }
  return all;
}

// what the system wants open right now
function desired(rows: Row[], dzis: string): Spec[] {
  const out: Spec[] = [];
  for (const w of rows) {
    const p = w.payload ?? {};
    const firma = p.z_nazwa || "firma bez nazwy";
    const kto = w.worker_name ? `Pracownik: ${w.worker_name}.` : "";
    if (w.status === "nowe" && Date.now() - Date.parse(w.created_at) > 20 * 3600000) {
      out.push({ klucz: `zgl:${w.id}`, tytul: `Sprawdź nowe zgłoszenie — ${firma}`, opis: `${kto} Zgłoszenie czeka na sprawdzenie od ${pl(w.created_at.slice(0, 10))}.`, termin: dzis, pilne: false, link: "zatrudnienie.html" });
    }
    const foreigner = !!p.p_obywatelstwo && !/^pol/i.test(p.p_obywatelstwo);
    if (!p._import && isDate(p.u_od)) {
      const start = days(p.u_od, dzis);
      if (["nowe", "sprawdzone", "wyslane"].includes(w.status) && start <= 3 && start >= -45) {
        out.push({ klucz: `umowa:${w.id}`, tytul: `Komplet podpisany przed rozpoczęciem pracy — ${firma} (start ${pl(p.u_od)})`, opis: `${kto} Umowa musi być podpisana przed dopuszczeniem do pracy${foreigner ? " (cudzoziemiec — art. 5 ust. 1 ustawy z 20.03.2025 r.)" : ""}. Po odesłaniu podpisanego kompletu oznacz „Podpisane — zatrudniony”.`, termin: p.u_od, pilne: true, link: "zatrudnienie.html" });
      }
      if (["sprawdzone", "wyslane", "zatrudniony"].includes(w.status) && start <= 0 && start >= -45) {
        if (!p.k_zus) out.push({ klucz: `zus:${w.id}`, tytul: `Zgłoszenie do ZUS — ${firma} (termin ${pl(addDays(p.u_od, 7))})`, opis: `${kto} 7 dni od rozpoczęcia pracy (art. 36 ust. 4 ustawy o systemie ubezpieczeń społecznych).`, termin: addDays(p.u_od, 7), pilne: false, link: "kontrola.html" });
        if (foreigner && !p.k_pup) out.push({ klucz: `pup:${w.id}`, tytul: `Powiadomienie urzędu pracy — ${firma} (termin ${pl(addDays(p.u_od, 7))})`, opis: `${kto} Cudzoziemiec: ochrona czasowa lub oświadczenie — 7 dni od rozpoczęcia pracy (art. 5a / art. 70 ustawy z 20.03.2025 r.). Jeśli nie dotyczy, oznacz jako zrobione.`, termin: addDays(p.u_od, 7), pilne: false, link: "kontrola.html" });
      }
    }
    if (w.status !== "zatrudniony") continue;
    for (const [k, label] of [["p_karta_do", "Karta pobytu"], ["p_zezwolenie_do", "Zezwolenie / wiza"]] as const) {
      const v = p[k];
      if (!isDate(v)) continue;
      const d = days(v, dzis);
      if (d <= 14 && d >= -60) out.push({ klucz: `dok:${w.id}:${k}:${v}`, tytul: `${label} kończy się ${pl(v)} — ${firma}`, opis: `${kto} Uzyskaj nowy dokument albo potwierdzenie złożenia wniosku i wpisz nową datę w Kontroli. Praca bez ważnego tytułu pobytowego jest nielegalna (art. 2 pkt 2, art. 84 ustawy z 20.03.2025 r.).`, termin: v, pilne: d <= 7, link: "kontrola.html" });
    }
    if (isDate(p.u_do) && p.u_bezterminowo !== true) {
      const d = days(p.u_do, dzis);
      if (d <= 14 && d >= -14) out.push({ klucz: `umk:${w.id}:${p.u_do}`, tytul: `Umowa kończy się ${pl(p.u_do)} — ${firma}`, opis: `${kto} Ustal z klientem: przedłużenie (nowe dokumenty) albo zakończenie (wyrejestrowanie z ZUS, archiwum).`, termin: p.u_do, pilne: false, link: "kontrola.html" });
    }
  }
  return out;
}
const STATUTORY = /^(zus|pup|umowa|dok):/;

async function run(dry: boolean) {
  const dzis = today();
  const set = await effective();
  const rows = await pageAll<Row>("zatrudnienie_zgloszenia?select=id,worker_name,status,created_at,payload&status=neq.archiwum&order=created_at.asc");
  let all = await pageAll<Zad>("portal_zadania?select=id,created_by,assignee,tytul,opis,termin,pilne,status,zrodlo,klucz,przypomniano,eskalacja,done_by&order=created_at.asc");
  const want = desired(rows, dzis);
  const wantKeys = new Set(want.map((s) => s.klucz));
  const byKey = new Map(all.filter((z) => z.klucz).map((z) => [z.klucz!, z]));
  let owner = set.kadry;
  if (!owner) owner = (await portalUsers()).find((u) => u.admin)?.email ?? "";

  // 1a. a person ticked a ZUS / labour-office task -> tick the duty itself
  let synced = 0;
  for (const z of all) {
    const m = z.klucz?.match(/^(zus|pup):(.+)$/);
    if (!m || z.status !== "zrobione" || z.done_by === "system") continue;
    const w = rows.find((r) => r.id === m[2]);
    const flag = m[1] === "zus" ? "k_zus" : "k_pup";
    if (!w || w.payload?.[flag]) continue;
    synced++;
    if (!dry) await db(`zatrudnienie_zgloszenia?id=eq.${w.id}`, { method: "PATCH", body: JSON.stringify({ payload: { ...w.payload, [flag]: dzis } }) });
    wantKeys.delete(z.klucz!);
  }
  // 1b. new system tasks
  const fresh = owner ? want.filter((s) => !byKey.has(s.klucz)) : [];
  if (fresh.length && !dry) {
    const ins = await db("portal_zadania?on_conflict=klucz", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(fresh.map((s) => ({ ...s, created_by: "system", assignee: owner, zrodlo: "system" }))),
    });
    if (!ins.ok) throw new Error("zadania insert " + ins.status + " " + (await ins.text()).slice(0, 200));
  }
  // 1c. the reason is gone -> the system closes its own task
  const stale = all.filter((z) => z.zrodlo === "system" && z.klucz && ["nowe", "w_toku"].includes(z.status) && !wantKeys.has(z.klucz));
  if (stale.length && !dry) {
    await db(`portal_zadania?id=in.(${stale.map((z) => z.id).join(",")})`, { method: "PATCH", body: JSON.stringify({ status: "zrobione", done_at: new Date().toISOString(), done_by: "system" }) });
  }
  if (!dry && (fresh.length || stale.length)) all = await pageAll<Zad>("portal_zadania?select=id,created_by,assignee,tytul,opis,termin,pilne,status,zrodlo,klucz,przypomniano,eskalacja,done_by&order=created_at.asc");
  const open = all.filter((z) => ["nowe", "w_toku"].includes(z.status));

  // 2. reminders: due by tomorrow, overdue or urgent — one message per person, once a day per task
  const perPerson = new Map<string, Zad[]>();
  for (const z of open) {
    const due = z.termin ? days(z.termin, dzis) : null;
    if (z.przypomniano === dzis || !(z.pilne || (due !== null && due <= 1))) continue;
    (perPerson.get(z.assignee) ?? perPerson.set(z.assignee, []).get(z.assignee)!).push(z);
  }
  let reminded = 0, noChat = 0;
  for (const [email, list] of perPerson) {
    const chat = set.telegram[email];
    if (!chat) { noChat++; continue; }
    list.sort((a, b) => (a.termin ?? "9999").localeCompare(b.termin ?? "9999"));
    const lines = list.slice(0, 12).map((z) => {
      const d = z.termin ? days(z.termin, dzis) : null;
      const when = d === null ? "pilne" : d < 0 ? `po terminie ${-d} dni` : d === 0 ? "dziś" : "jutro";
      return `${d !== null && d < 0 ? "🔴" : z.pilne ? "🟠" : "▫️"} ${z.tytul} — ${when}`;
    });
    if (dry) { reminded++; continue; }
    const ok = await tgSend(chat, `✅ Twoje zadania — ${pl(dzis)}\n${lines.join("\n")}${list.length > 12 ? `\n…i jeszcze ${list.length - 12}` : ""}\n\n${PORTAL}/zadania.html`);
    if (ok) {
      reminded++;
      await db(`portal_zadania?id=in.(${list.map((z) => z.id).join(",")})`, { method: "PATCH", body: JSON.stringify({ przypomniano: dzis }) });
    }
  }

  // 3. serious breaches -> the owner, once per task
  const breaches = open.filter((z) => {
    if (z.eskalacja || !z.termin) return false;
    const late = -days(z.termin, dzis);
    return late >= 3 || (late >= 1 && (z.pilne || (z.klucz ? STATUTORY.test(z.klucz) : false)));
  });
  let escalated = 0;
  if (breaches.length && set.szef && !dry) {
    const lines = breaches.slice(0, 15).map((z) => `🔴 ${z.tytul}\n   odpowiada: ${z.assignee} · termin ${pl(z.termin!)} (${-days(z.termin!, dzis)} dni po terminie)`);
    const ok = await tgSend(set.szef, `🚨 Naruszenia terminów — ${pl(dzis)}\n\n${lines.join("\n")}${breaches.length > 15 ? `\n…i jeszcze ${breaches.length - 15}` : ""}\n\n${PORTAL}/zadania.html?w=po`);
    if (ok) {
      escalated = breaches.length;
      await db(`portal_zadania?id=in.(${breaches.map((z) => z.id).join(",")})`, { method: "PATCH", body: JSON.stringify({ eskalacja: new Date().toISOString() }) });
    }
  }
  return { open: open.length, nowe: fresh.length, zamkniete: stale.length, zsynchronizowane: synced, przypomnienia: reminded, bezTelegrama: noChat, naruszenia: breaches.length, eskalowane: escalated, szef: !!set.szef, odpowiedzialny: owner || null };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }

  try {
    if (body.action === "run") {
      if (!isCron(req)) return json({ error: "Brak dostępu." }, 403, origin);
      const dry = body.dry === true;
      const log = dry ? null : await db("portal_zadania_log", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ zadanie: "zadania" }) });
      const logId = log?.ok ? (await log.json())[0]?.id : null;
      try {
        const info = await run(dry);
        if (logId != null) await db(`portal_zadania_log?id=eq.${logId}`, { method: "PATCH", body: JSON.stringify({ ok: true, info, finished_at: new Date().toISOString() }) });
        return json({ ok: true, dry, info }, 200, origin);
      } catch (e) {
        if (logId != null) await db(`portal_zadania_log?id=eq.${logId}`, { method: "PATCH", body: JSON.stringify({ ok: false, info: { error: String((e as Error)?.message ?? e).slice(0, 300) }, finished_at: new Date().toISOString() }) });
        throw e;
      }
    }

    const me = await portalUser(req);
    if (!me) return json({ error: "Brak dostępu (portal)." }, 403, origin);
    const set = await effective();

    if (body.action === "team") {
      const users = await portalUsers();
      return json({
        me: me.email, admin: me.admin,
        team: users.map((u) => ({ email: u.email, admin: u.admin, telegram: !!set.telegram[u.email] })),
        settings: me.admin ? await settings() : undefined, szef: !!set.szef, bot: !!TG,
      }, 200, origin);
    }
    if (body.action === "notify") {
      const id = String(body.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false }, 200, origin);
      const r = await db(`portal_zadania?id=eq.${id}&select=tytul,assignee,created_by,termin,pilne,status`);
      const z = r.ok ? (await r.json())[0] : null;
      if (!z) return json({ ok: false }, 200, origin);
      let to = "", text = "";
      if (body.event === "new" && z.assignee !== me.email) {
        to = z.assignee;
        text = `🆕 Nowe zadanie od ${me.email}\n${z.pilne ? "🟠 PILNE · " : ""}${z.tytul}${z.termin ? `\nTermin: ${pl(z.termin)}` : ""}`;
      } else if (body.event === "done" && z.status === "zrobione" && z.created_by !== me.email && z.created_by !== "system") {
        to = z.created_by;
        text = `✔️ Zrobione: ${z.tytul}\nWykonał(a): ${me.email}`;
      } else if (body.event === "comment") {
        to = me.email === z.assignee ? z.created_by : z.assignee;
        text = `💬 Komentarz do zadania: ${z.tytul}\nOd: ${me.email}`;
      }
      const chat = to && to !== "system" && to !== me.email ? set.telegram[to] : "";
      const ok = chat ? await tgSend(chat, `${text}\n\n${PORTAL}/zadania.html`) : false;
      return json({ ok, telegram: !!chat }, 200, origin);
    }

    if (!me.admin) return json({ error: "Tylko administrator." }, 403, origin);
    if (body.action === "settings") {
      const emails = new Set((await portalUsers()).map((u) => u.email));
      const telegram: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.telegram ?? {})) {
        const chat = String(v ?? "").trim();
        if (emails.has(k.toLowerCase()) && /^-?\d{4,20}$/.test(chat)) telegram[k.toLowerCase()] = chat;
      }
      const szef = /^-?\d{4,20}$/.test(String(body.szef ?? "").trim()) ? String(body.szef).trim() : "";
      const kadry = emails.has(String(body.kadry ?? "").toLowerCase()) ? String(body.kadry).toLowerCase() : "";
      await db("portal_ustawienia", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: KEY, value: { telegram, szef, kadry, by: me.email }, updated_at: new Date().toISOString() }),
      });
      return json({ ok: true, settings: { telegram, szef, kadry } }, 200, origin);
    }
    if (body.action === "test") {
      const chat = body.email === "__szef" ? set.szef : set.telegram[String(body.email ?? "").toLowerCase()];
      if (!chat) return json({ error: "Brak zapisanego czatu Telegram." }, 200, origin);
      const ok = await tgSend(chat, `✅ Portal TD: tu będą przychodzić ${body.email === "__szef" ? "zgłoszenia o naruszeniach terminów" : "Twoje zadania i przypomnienia"}.\n${PORTAL}/zadania.html`);
      return json(ok ? { ok: true } : { error: "Telegram nie przyjął wiadomości — ta osoba musi najpierw napisać do bota (Start), a ID czatu musi być poprawne." }, 200, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
