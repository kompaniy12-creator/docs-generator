// powiadom: the handler (index.ts only serves it, so that tests can call it with a mocked fetch).
import { bezTokenu, tekstNowe } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TG = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const PORTAL = "https://docgenerator.td-group.pl";
const KEY = "telegram_kadry";
const FRESH_MIN = 30;
const HOUR_CAP = 15; // at most this many "new submission" messages per hour

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
async function isAdmin(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const u = await r.json();
  return u?.app_metadata?.portal === true && u?.app_metadata?.portal_admin === true;
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
// deno-lint-ignore no-explicit-any
async function tg(method: string, body?: unknown): Promise<any> {
  // the bot token is part of the URL and Deno puts the URL into the text of a network error:
  // nothing thrown here may reach the logs or the caller as it is
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
    });
    return await r.json().catch(() => ({ ok: false, description: "HTTP " + r.status }));
  } catch (e) {
    console.error("telegram", method, "błąd sieci:", bezTokenu(e instanceof Error ? e.name : "error", TG));
    return { ok: false, description: "błąd sieci" };
  }
}
type Chat = { id: string; name: string };
async function savedChats(): Promise<Chat[]> {
  const r = await db(`portal_ustawienia?key=eq.${KEY}&select=value`);
  const v = r.ok ? (await r.json())[0]?.value : null;
  return Array.isArray(v) ? v : [];
}
async function send(chats: Chat[], text: string) {
  let ok = 0;
  for (const c of chats) {
    const r = await tg("sendMessage", { chat_id: c.id, text, disable_web_page_preview: true });
    if (r?.ok) ok++; else console.error("telegram", c.id, bezTokenu(String(r?.description ?? ""), TG).slice(0, 200));
  }
  return ok;
}

export async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!TG) return json({ error: "Brak konfiguracji bota Telegram." }, 500, origin);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }

  try {
    if (body.action === "nowe") {
      const id = String(body.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false }, 200, origin);
      const r = await db(`zatrudnienie_zgloszenia?id=eq.${id}&select=id,status,created_at,payload`);
      const row = r.ok ? (await r.json())[0] : null;
      const p = row?.payload ?? {};
      const fresh = row && Date.now() - new Date(row.created_at).getTime() < FRESH_MIN * 60000;
      if (!row || row.status !== "nowe" || !fresh || p._powiadomiono) return json({ ok: false }, 200, origin);
      const chats = await savedChats();
      if (!chats.length) return json({ ok: false }, 200, origin);
      // flood guard: the form is public, so a burst of submissions must not become a burst of messages
      const hourAgo = new Date(Date.now() - 3600000).toISOString();
      const cnt = await db(`zatrudnienie_zgloszenia?select=id&created_at=gte.${hourAgo}&payload->>_powiadomiono=not.is.null`, { headers: { Prefer: "count=exact", Range: "0-0" } });
      const sentHour = Number((cnt.headers.get("content-range") ?? "/0").split("/")[1]) || 0;
      // The mark is put BEFORE anything is sent and only by the one call that finds the row still
      // unmarked (conditional update): parallel calls with the same id cannot produce more messages.
      const mark = async (value: string) => {
        const m = await db(`zatrudnienie_zgloszenia?id=eq.${id}&status=eq.nowe&payload->>_powiadomiono=is.null`, {
          method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ payload: { ...p, _powiadomiono: value } }),
        });
        const rows = m.ok ? await m.json().catch(() => []) : [];
        return Array.isArray(rows) && rows.length > 0;
      };
      if (sentHour >= HOUR_CAP) {
        if (!(await mark("wstrzymane"))) return json({ ok: false }, 200, origin);
        if (sentHour === HOUR_CAP) await send(chats, `⚠️ Dużo zgłoszeń w ostatniej godzinie (${sentHour}+). Kolejne powiadomienia są wstrzymane — sprawdź listę: ${PORTAL}/zatrudnienie.html`);
        return json({ ok: false }, 200, origin);
      }
      if (!(await mark(new Date().toISOString()))) return json({ ok: false }, 200, origin);
      // the submission comes from a public form: its free text is cleaned (no links, mentions, markup; short)
      await send(chats, tekstNowe(p, PORTAL));
      return json({ ok: true }, 200, origin);
    }

    if (!(await isAdmin(req))) return json({ error: "Brak uprawnień administratora." }, 403, origin);

    if (body.action === "status") {
      const me = await tg("getMe");
      const wh = await tg("getWebhookInfo");
      return json({
        bot: me?.result?.username ?? null,
        // a bot with a webhook cannot be polled for recent chats
        can_list: !!(wh?.ok && !wh.result?.url),
        chats: await savedChats(),
      }, 200, origin);
    }
    if (body.action === "chats") {
      const up = await tg("getUpdates", { limit: 100, timeout: 0 });
      if (!up?.ok) return json({ error: "Bot ma ustawiony webhook — nie można pobrać listy czatów. Wpisz ID czatu ręcznie." }, 200, origin);
      const seen: Record<string, Chat> = {};
      for (const u of up.result ?? []) {
        const c = (u.message ?? u.channel_post ?? u.my_chat_member ?? u.edited_message)?.chat;
        if (!c) continue;
        seen[String(c.id)] = { id: String(c.id), name: c.title ?? [c.first_name, c.last_name].filter(Boolean).join(" ") ?? c.username ?? String(c.id) };
      }
      return json({ chats: Object.values(seen) }, 200, origin);
    }
    if (body.action === "save") {
      const chats: Chat[] = (Array.isArray(body.chats) ? body.chats : [])
        .map((c: Chat) => ({ id: String(c?.id ?? "").trim(), name: String(c?.name ?? "").trim().slice(0, 80) }))
        .filter((c: Chat) => /^-?\d{4,20}$/.test(c.id)).slice(0, 10);
      await db("portal_ustawienia", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: KEY, value: chats, updated_at: new Date().toISOString() }),
      });
      return json({ ok: true, chats }, 200, origin);
    }
    if (body.action === "test") {
      const chats = await savedChats();
      if (!chats.length) return json({ error: "Najpierw zapisz czat." }, 200, origin);
      const ok = await send(chats, `✅ Powiadomienia portalu TD są włączone.\nTutaj będą przychodzić informacje o nowych zgłoszeniach pracowników.\n${PORTAL}/kontrola.html`);
      return json({ ok: ok > 0, sent: ok, of: chats.length }, 200, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error("powiadom", bezTokenu(e instanceof Error ? e.message : String(e), TG).slice(0, 300));
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
}
