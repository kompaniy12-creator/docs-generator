// Where a notice for ONE client goes on Telegram — for the other functions of the portal (wyslij-komplet,
// terminy, podpisy …):   import { botUrl, celeKlienta, zablokowana } from "../komunikacja/cele.ts";
//
// The rule: the client's active private subscribers of the bot; when there are none — nobody. The client's
// GROUP is used only when an administrator has allowed it for this client (klient_komunikacja.
// grupa_dozwolona) and nobody is subscribed. This file imports nothing, so it adds no weight to a function.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TOKEN_GRUPA = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TOKEN_SUB = Deno.env.get("KLIENT_BOT_TOKEN") || TOKEN_GRUPA;

export type Cel = { chat: string; bot: "sub" | "grupa"; subskrypcja: string | null };
const db = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

// klient: the client's id in the clients base (the NIP, or 'nazwa:<lower-case name>'); grupaZBazy: the
// group chat id from the clients base (field `telegram`). Never throws: on a database error nobody is notified.
export async function celeKlienta(klient: string, grupaZBazy: string): Promise<Cel[]> {
  if (!klient) return [];
  try {
    const s = await db(`klient_subskrypcje?select=id,chat_id&klient=eq.${encodeURIComponent(klient)}&aktywna=is.true&blocked_at=is.null`);
    if (!s.ok) return [];
    const suby: { id: string; chat_id: number }[] = await s.json();
    if (suby.length) return TOKEN_SUB ? suby.map((x) => ({ chat: String(x.chat_id), bot: "sub" as const, subskrypcja: x.id })) : [];
    if (!TOKEN_GRUPA || !/^-\d{5,20}$/.test(grupaZBazy ?? "")) return [];
    const f = await db(`klient_komunikacja?select=grupa_dozwolona&klient=eq.${encodeURIComponent(klient)}`);
    return f.ok && (await f.json())[0]?.grupa_dozwolona === true ? [{ chat: grupaZBazy, bot: "grupa", subskrypcja: null }] : [];
  } catch (_e) { return []; }
}
// The address of a Bot API method for that target. It contains the token: never log it, never return it.
export const botUrl = (bot: "sub" | "grupa", metoda: string) => `https://api.telegram.org/bot${bot === "sub" ? TOKEN_SUB : TOKEN_GRUPA}/${metoda}`;
// call after a 403 "bot was blocked by the user" / "user is deactivated", and after a delivery
export async function zablokowana(c: Cel): Promise<void> {
  if (c.subskrypcja) await db(`klient_subskrypcje?id=eq.${c.subskrypcja}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ blocked_at: new Date().toISOString() }) }).catch(() => {});
}
export async function doreczono(c: Cel): Promise<void> {
  if (c.subskrypcja) await db(`klient_subskrypcje?id=eq.${c.subskrypcja}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_delivery_at: new Date().toISOString() }) }).catch(() => {});
}
