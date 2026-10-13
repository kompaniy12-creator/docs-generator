// Outage alert for the owner. Called by the external monitor (.github/workflows/monitor.yml) when the portal's
// database / sign-in stop answering, and once more when they are back. Deliberately uses NO database: it must
// work while the database is down. One fixed recipient (secret ALARM_CHAT), fixed texts; the caller adds only a
// short technical note. Caller is checked by the ALARM_KEY secret (header x-alarm-key).
const KEY = Deno.env.get("ALARM_KEY") ?? "";
const CHAT = Deno.env.get("ALARM_CHAT") ?? "";
const TG = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
// Auto-restart (owner's decision of 2026-10-13): management token of the Supabase account, used for exactly two calls
// on this one project — read health, restart. Never returned, never logged.
const MGMT = Deno.env.get("SB_MGMT_TOKEN") ?? "";
const REF = "dpfxwkxpzqqjtmgqwozw";
const API = "https://api.supabase.com/v1/projects/" + REF;

// Restarts the project only when Supabase itself reports the database as unhealthy and no restart is already running.
async function restart(): Promise<string> {
  if (!MGMT) return "автоперезапуск не настроен";
  const h = { Authorization: "Bearer " + MGMT };
  try {
    const p = await fetch(API, { headers: h, signal: AbortSignal.timeout(20000) });
    const status = p.ok ? String((await p.json())?.status ?? "") : "";
    if (/RESTARTING|COMING_UP|RESTORING|UPGRADING|PAUS|INACTIVE/.test(status)) return "проект уже в состоянии " + status + " — не трогаю";
    const r = await fetch(API + "/health?services=db", { headers: h, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return "не удалось узнать состояние базы (" + r.status + ") — не перезапускаю";
    const db = ((await r.json()) as Array<{ name: string; healthy: boolean }>).find((x) => x.name === "db");
    if (!db || db.healthy) return "Supabase считает базу исправной — не перезапускаю";
    const x = await fetch(API + "/restart", { method: "POST", headers: h, signal: AbortSignal.timeout(30000) });
    return x.ok ? "база не отвечает — запустил перезапуск, обычно это 5–7 минут" : "перезапуск не принят (" + x.status + ")";
  } catch (_e) { return "ошибка при обращении к Supabase — не перезапускаю"; }
}

function rowne(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const json = (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!KEY || !rowne(req.headers.get("x-alarm-key") ?? "", KEY)) return json({ error: "forbidden" }, 403);
  if (!CHAT || !TG) return json({ error: "nie skonfigurowano" }, 503);
  const b = await req.json().catch(() => ({}));
  const stan = b?.stan === "ok" ? "ok" : "awaria";
  const szczegoly = String(b?.szczegoly ?? "").replace(/[^\p{L}\p{N} .,:;=()\/_-]/gu, " ").slice(0, 300);
  const akcja = stan === "awaria" && b?.restart === true ? await restart() : "";
  const teraz = new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });
  const tekst = stan === "ok"
    ? `✅ Портал снова работает (${teraz}).`
    : `🚨 Портал не отвечает: база данных / вход недоступны (${teraz}).\n${szczegoly}\n${akcja ? "Действие: " + akcja + "." : "Перезапуск уже запускался недавно — жду результата."}`;
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: tekst, disable_web_page_preview: true }),
  });
  return json({ ok: r.ok, restart: /запустил перезапуск/.test(akcja) }, r.ok ? 200 : 502);
});
