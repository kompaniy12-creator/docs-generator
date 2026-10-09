// Watches the acts the portal relies on in the official ELI register (api.sejm.gov.pl).
//
// Scheduled (pg_cron, header x-cron-key):
//   POST { action: "run" }   for every act in portal_prawo_akty: compares the list of amending
//                            acts and the latest consolidated text with what was stored. A new
//                            amendment marks the act and every rule of the knowledge base that
//                            rests on it as "to be re-checked" and tells the HR team on Telegram.
//                            Also refreshes the minimum-wage rates (stawki function).
// Portal (JWT):
//   POST { action: "potwierdz", id }   admin — a rule was re-read against the act: clears the mark
//   POST { action: "potwierdz_akt", eli }  admin — clears the "changed" mark of an act
//
// The first check of an act only records the baseline; it raises no alert.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TG = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CRON_KEY = Deno.env.get("CRON_KEY") ?? "";
const ELI = "https://api.sejm.gov.pl/eli/acts/";
const PORTAL = "https://docgenerator.td-group.pl";

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
async function isAdmin(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const u = await r.json();
  return u?.app_metadata?.portal === true && u?.app_metadata?.portal_admin === true;
}
async function tellKadry(text: string) {
  if (!TG) return;
  const r = await db("portal_ustawienia?key=eq.telegram_kadry&select=value");
  const chats = r.ok ? (await r.json())[0]?.value : null;
  for (const c of Array.isArray(chats) ? chats : []) {
    await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: c.id, text, disable_web_page_preview: true }),
    }).catch(() => console.error("telegram: błąd sieci")); // never the error itself: its text carries the URL with the bot token
  }
}

type Akt = { eli: string; skrot: string; zmiany: string[]; tekst_jednolity: string | null; checked_at: string | null };

async function check(a: Akt): Promise<{ nowe: string[]; blad?: string }> {
  const r = await fetch(ELI + a.eli, { headers: { Accept: "application/json" } });
  if (!r.ok) return { nowe: [], blad: `${a.eli}: HTTP ${r.status}` };
  const j = await r.json();
  // deno-lint-ignore no-explicit-any
  const ids = (k: string): string[] => (j.references?.[k] ?? []).map((x: any) => String(x.id));
  const zmiany = ids("Akty zmieniające");
  const tj = ids("Inf. o tekście jednolitym")[0] ?? null;
  const known = new Set(a.zmiany ?? []);
  const first = !a.checked_at;
  const nowe = first ? [] : zmiany.filter((z) => !known.has(z));
  const patch: Record<string, unknown> = {
    tytul: String(j.title ?? "").slice(0, 300), change_date: j.changeDate ?? null,
    zmiany, tekst_jednolity: tj, checked_at: new Date().toISOString(),
  };
  if (nowe.length) patch.zmiana_wykryta = new Date().toISOString();
  await db(`portal_prawo_akty?eli=eq.${encodeURIComponent(a.eli)}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (nowe.length) {
    await db(`portal_wiedza?eli=eq.${encodeURIComponent(a.eli)}`, { method: "PATCH", body: JSON.stringify({ do_sprawdzenia: true }) });
  }
  return { nowe };
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
      const log = await db("portal_zadania_log", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ zadanie: "prawo" }) });
      const logId = log.ok ? (await log.json())[0]?.id : null;
      const r = await db("portal_prawo_akty?select=eli,skrot,zmiany,tekst_jednolity,checked_at");
      const akty: Akt[] = r.ok ? await r.json() : [];
      const changed: string[] = [], errors: string[] = [];
      for (const a of akty) {
        try {
          const c = await check(a);
          if (c.blad) errors.push(c.blad);
          if (c.nowe.length) changed.push(`${a.skrot} — nowa zmiana: ${c.nowe.map((x) => x.replace("DU/", "Dz.U. ").replace("/", " poz. ")).join(", ")}`);
        } catch (e) { errors.push(`${a.eli}: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
      }
      // minimum wage: the stawki function discovers and stores a new yearly act by itself
      let stawki = "ok";
      try { const s = await fetch(`${SUPABASE_URL}/functions/v1/stawki`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }); if (!s.ok) stawki = "HTTP " + s.status; }
      catch (e) { stawki = String((e as Error)?.message ?? e).slice(0, 80); }
      if (changed.length) {
        await tellKadry(`⚖️ Zmiana w przepisach, na których opiera się portal:\n${changed.map((c) => "• " + c).join("\n")}\n\nSprawdź oznaczone zasady: ${PORTAL}/wiedza.html`);
      }
      const ok = errors.length < Math.max(1, akty.length / 2) && akty.length > 0;
      if (logId != null) {
        await db(`portal_zadania_log?id=eq.${logId}`, { method: "PATCH", body: JSON.stringify({ ok, finished_at: new Date().toISOString(), info: { akty: akty.length, changed, errors, stawki } }) });
      }
      return json({ ok, akty: akty.length, changed, errors, stawki }, 200, origin);
    }

    if (!(await isAdmin(req))) return json({ error: "Brak uprawnień administratora." }, 403, origin);
    if (body.action === "potwierdz") {
      const id = String(body.id ?? "");
      if (!/^[a-z0-9-]{2,60}$/.test(id)) return json({ error: "Brak identyfikatora." }, 400, origin);
      const dzis = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
      await db(`portal_wiedza?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ do_sprawdzenia: false, zweryfikowano: dzis }) });
      return json({ ok: true }, 200, origin);
    }
    if (body.action === "potwierdz_akt") {
      const eli = String(body.eli ?? "");
      if (!/^DU\/\d{4}\/\d{1,5}$/.test(eli)) return json({ error: "Brak aktu." }, 400, origin);
      await db(`portal_prawo_akty?eli=eq.${encodeURIComponent(eli)}`, { method: "PATCH", body: JSON.stringify({ zmiana_wykryta: null }) });
      return json({ ok: true }, 200, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
