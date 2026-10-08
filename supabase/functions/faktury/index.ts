// Invoices issued by the office (wFirma) -> table `invoices`, for the client profile.
//
// Scheduled (pg_cron, header x-cron-key):  POST { action: "sync" }
//   Reads every invoice from wFirma (API keys WFIRMA_ACCESS_KEY / WFIRMA_SECRET_KEY /
//   WFIRMA_APP_KEY, optional WFIRMA_COMPANY_ID) and upserts by wfirma_id. All or nothing:
//   nothing is written unless the whole list was read. Without the application key the
//   function only reports that it is not configured.
// Portal admin (JWT):  POST { action: "status" } — last sync and whether the keys are set.
//
// The row shape is the one the office's notification bot already uses (wfirma_sync.py);
// contractor_nip is added so a client can be shown its own invoices.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_KEY = Deno.env.get("CRON_KEY") ?? "";
const ACCESS = Deno.env.get("WFIRMA_ACCESS_KEY") ?? "";
const SECRET = Deno.env.get("WFIRMA_SECRET_KEY") ?? "";
const APPKEY = Deno.env.get("WFIRMA_APP_KEY") ?? "";
const COMPANY = Deno.env.get("WFIRMA_COMPANY_ID") ?? "";
const WF = "https://api2.wfirma.pl";
const NON_DEBT = new Set(["proforma", "offer"]);
const configured = () => !!(ACCESS && SECRET && APPKEY);

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
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

// deno-lint-ignore no-explicit-any
type Any = any;
async function wf(module: string, action: string, body: unknown): Promise<Any> {
  const url = `${WF}/${module}/${action}?inputFormat=json&outputFormat=json${COMPANY ? `&company_id=${encodeURIComponent(COMPANY)}` : ""}`;
  const r = await fetch(url, { method: "POST", headers: { accessKey: ACCESS, secretKey: SECRET, appKey: APPKEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  const code = data?.status?.code;
  if (r.status !== 200 || code !== "OK") throw new Error(`wFirma ${module}/${action}: HTTP ${r.status}, status=${code ?? "?"} ${data?.status?.message ?? ""}`.trim());
  return data;
}
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

async function fetchAll(): Promise<Any[]> {
  const all = new Map<number, Any>();
  let total = 0;
  for (let page = 1; page <= 500; page++) {
    const data = await wf("invoices", "find", { invoices: { parameters: { page, limit: 100, order: { asc: "id" } } } });
    const block = data.invoices ?? {};
    const items = Object.entries(block).filter(([k, v]) => /^\d+$/.test(k) && (v as Any)?.invoice).map(([, v]) => (v as Any).invoice);
    for (const inv of items) all.set(Number(inv.id), inv);
    total = Number(block.parameters?.total ?? 0);
    if (!items.length || all.size >= total) break;
  }
  if (total && all.size !== total) throw new Error(`pobrano ${all.size} faktur z ${total}`);
  return [...all.values()];
}
function toRow(inv: Any, now: string) {
  const type = inv.type ?? "", ps = inv.paymentstate ?? "", due = date(inv.paymentdate);
  const status = NON_DEBT.has(type) ? type : ps === "paid" ? "paid" : due && due < now.slice(0, 10) ? "overdue" : "issued";
  const d = inv.contractor_detail ?? {};
  const nip = String(d.nip ?? "").replace(/\D/g, "");
  return {
    wfirma_id: Number(inv.id), invoice_number: inv.fullnumber ?? "", issue_date: date(inv.date), due_date: due,
    amount: Number(inv.total ?? 0), currency: inv.currency || "PLN", status,
    paid_date: ps === "paid" ? date(inv.paymentdate_paid ?? inv.paid_date) : null,
    contractor_nip: nip.length === 10 ? nip : null,
    // stored as a JSON string — the format the notification bot reads
    wfirma_data: JSON.stringify({
      contractor_id: inv.contractor?.id ?? 0, contractor_name: d.name ?? "", contractor_nip: d.nip ?? "",
      netto: inv.netto ?? "", tax: inv.tax ?? "", type, paymentstate: ps, alreadypaid: inv.alreadypaid ?? "", description: inv.description ?? "",
    }),
    synced_at: now,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }
  try {
    if (body.action === "sync") {
      if (!isCron(req)) return json({ error: "Brak dostępu." }, 403, origin);
      if (!configured()) return json({ ok: false, skonfigurowane: false }, 200, origin);
      const log = await db("portal_zadania_log", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ zadanie: "faktury" }) });
      const logId = log.ok ? (await log.json())[0]?.id : null;
      const end = (ok: boolean, info: unknown) => logId == null ? Promise.resolve() : db(`portal_zadania_log?id=eq.${logId}`, { method: "PATCH", body: JSON.stringify({ ok, info, finished_at: new Date().toISOString() }) });
      try {
        const now = new Date().toISOString();
        const rows = (await fetchAll()).map((i) => toRow(i, now));
        for (let i = 0; i < rows.length; i += 500) {
          const up = await db("invoices?on_conflict=wfirma_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 500)) });
          if (!up.ok) throw new Error("zapis faktur: " + up.status + " " + (await up.text()).slice(0, 160));
        }
        await db("sync_log", { method: "POST", body: JSON.stringify({ source: "wfirma", action: "invoices_sync", records_count: rows.length, details: { by: "portal" }, synced_at: now }) }).catch(() => undefined);
        await end(true, { faktury: rows.length });
        return json({ ok: true, faktury: rows.length }, 200, origin);
      } catch (e) {
        await end(false, { error: String((e as Error)?.message ?? e).slice(0, 300) });
        throw e;
      }
    }
    if (!(await isAdmin(req))) return json({ error: "Tylko administrator." }, 403, origin);
    if (body.action === "status") {
      const r = await db("invoices?select=synced_at&order=synced_at.desc&limit=1");
      return json({ skonfigurowane: configured(), brak: [!ACCESS && "WFIRMA_ACCESS_KEY", !SECRET && "WFIRMA_SECRET_KEY", !APPKEY && "WFIRMA_APP_KEY"].filter(Boolean), ostatnia_synchronizacja: r.ok ? (await r.json())[0]?.synced_at ?? null : null }, 200, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
