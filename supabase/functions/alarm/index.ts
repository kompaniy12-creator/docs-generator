// Outage alert for the owner. Called by the external monitor (.github/workflows/monitor.yml) when the portal's
// database / sign-in stop answering, and once more when they are back. Deliberately uses NO database: it must
// work while the database is down. One fixed recipient (secret ALARM_CHAT), fixed texts; the caller adds only a
// short technical note. Caller is checked by the ALARM_KEY secret (header x-alarm-key).
const KEY = Deno.env.get("ALARM_KEY") ?? "";
const CHAT = Deno.env.get("ALARM_CHAT") ?? "";
const TG = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

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
  const teraz = new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });
  const tekst = stan === "ok"
    ? `✅ Портал снова работает (${teraz}).`
    : `🚨 Портал не отвечает: база данных / вход недоступны (${teraz}).\n${szczegoly}\nНапишите Claude «портал лежит» — перезапуск занимает несколько минут.`;
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: tekst, disable_web_page_preview: true }),
  });
  return json({ ok: r.ok }, r.ok ? 200 : 502);
});
