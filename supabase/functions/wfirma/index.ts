// wFirma API proxy (API-Key method) for the document portal.
// Holds wFirma secrets server-side; callers must be authenticated portal users
// (Supabase JWT with app_metadata.portal === true). Never exposes wFirma keys.
//
// Actions (?action=):
//   ping        -> reports whether wFirma secrets are configured (no wFirma call)
//   companies   -> list companies available to the keys
//   company     -> &id=  full firma data (name, nip, regon, address)
//   contractors -> &q=   search contractors (kontrahenci)
//   staff       -> discover employees + e-akta folders via documents(set=staff)
//   raw         -> &module=&act=&id=  debug passthrough (portal-only)
// TODO e-akta upload: documents/add with set=staff + folder.id + staff_employee.id;
//   the file-content transport for type=file is undocumented — confirm with wFirma
//   support before implementing the upload action.

const WF_BASE = "https://api2.wfirma.pl";
const ACCESS = Deno.env.get("WFIRMA_ACCESS_KEY") ?? "";
const SECRET = Deno.env.get("WFIRMA_SECRET_KEY") ?? "";
const APPKEY = Deno.env.get("WFIRMA_APP_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

// Verify the caller is an authenticated portal user.
async function requirePortalUser(req: Request): Promise<{ ok: true } | { ok: false; status: number; msg: string }> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, msg: "Brak tokenu autoryzacji." };
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return { ok: false, status: 401, msg: "Nieprawidłowa sesja." };
  const user = await r.json();
  const portal = user?.app_metadata?.portal === true;
  if (!portal) return { ok: false, status: 403, msg: "Brak dostępu do portalu." };
  return { ok: true };
}

// Call wFirma with API-Key headers, JSON in/out.
async function wf(module: string, action: string, opts: { id?: string; companyId?: string; body?: unknown } = {}) {
  let url = `${WF_BASE}/${module}/${action}`;
  if (opts.id) url += `/${opts.id}`;
  url += `?inputFormat=json&outputFormat=json`;
  if (opts.companyId) url += `&company_id=${encodeURIComponent(opts.companyId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accessKey: ACCESS,
      secretKey: SECRET,
      appKey: APPKEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts.body ?? {}),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { httpStatus: res.status, data };
}

// Best-effort: pull the records out of a wFirma find/get JSON envelope.
function extractRecords(data: any, pluralKey: string, singularKey: string): any[] {
  const branch = data?.[pluralKey] ?? data?.api?.[pluralKey];
  if (!branch) return [];
  const out: any[] = [];
  for (const k of Object.keys(branch)) {
    if (k === "parameters") continue;
    const rec = branch[k];
    out.push(rec?.[singularKey] ?? rec);
  }
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });

  const url = new URL(req.url);
  // params come from query string or JSON body (so sb.functions.invoke works)
  let bodyParams: Record<string, string> = {};
  if (req.method === "POST") {
    try { bodyParams = await req.clone().json(); } catch { /* no body */ }
  }
  const param = (k: string) => url.searchParams.get(k) ?? bodyParams[k] ?? null;
  const action = param("action") ?? "ping";

  // auth
  const auth = await requirePortalUser(req);
  if (!auth.ok) return json({ error: auth.msg }, auth.status, origin);

  if (action === "ping") {
    return json({
      ok: true,
      configured: { accessKey: !!ACCESS, secretKey: !!SECRET, appKey: !!APPKEY },
      ready: !!(ACCESS && SECRET && APPKEY),
    }, 200, origin);
  }

  if (!ACCESS || !SECRET || !APPKEY) {
    return json({ error: "Integracja wFirma nie jest jeszcze skonfigurowana (brak appKey)." }, 503, origin);
  }

  try {
    if (action === "companies") {
      const r = await wf("companies", "find", { body: {} });
      let recs = extractRecords(r.data, "companies", "company");
      if (recs.length === 0) {
        const r2 = await wf("user_companies", "find", { body: {} });
        recs = extractRecords(r2.data, "user_companies", "user_company");
      }
      const companies = recs.map((c: any) => ({
        id: c?.id ?? c?.company_id ?? null,
        name: c?.name ?? c?.altname ?? "",
        nip: c?.nip ?? "",
      })).filter((c: any) => c.id);
      return json({ companies, raw: companies.length ? undefined : r.data }, 200, origin);
    }

    if (action === "company") {
      const id = param("id") ?? "";
      if (!id) return json({ error: "Brak parametru id." }, 400, origin);
      const r = await wf("companies", "get", { id, companyId: id });
      const comp = extractRecords(r.data, "companies", "company")[0] ?? {};
      const a = await wf("company_addresses", "findmain", { companyId: id, body: {} });
      const addr = extractRecords(a.data, "company_addresses", "company_address")[0] ?? {};
      return json({
        company: {
          id,
          name: comp.name ?? "",
          nip: comp.nip ?? "",
          regon: comp.regon ?? addr.regon ?? "",
          street: addr.street ?? "",
          zip: addr.zip ?? "",
          city: addr.city ?? "",
        },
        _debug: { comp, addr },
      }, 200, origin);
    }

    if (action === "contractors") {
      const q = param("q") ?? "";
      const companyId = param("company_id") ?? "";
      const body = q
        ? { contractors: { parameters: { conditions: { condition: { field: "name", operator: "like", value: q } }, limit: 50 } } }
        : { contractors: { parameters: { limit: 50 } } };
      const r = await wf("contractors", "find", { companyId, body });
      const recs = extractRecords(r.data, "contractors", "contractor");
      const contractors = recs.map((c: any) => ({
        id: c?.id ?? null,
        name: c?.name ?? "",
        nip: c?.nip ?? "",
        street: c?.street ?? "",
        zip: c?.zip ?? "",
        city: c?.city ?? "",
        account: c?.account_number ?? "",
      })).filter((c: any) => c.id);
      return json({ contractors }, 200, origin);
    }

    if (action === "staff") {
      // Discover employees + e-akta folders by mining existing staff documents.
      // (wFirma has no employees read endpoint; documents(set=staff) is the only route.)
      const companyId = param("company_id") ?? "";
      const body = {
        documents: {
          parameters: {
            conditions: { "0": { condition: { field: "set", operator: "eq", value: "staff" } } },
            limit: 200,
          },
        },
      };
      const r = await wf("documents", "find", { companyId, body });
      const docs = extractRecords(r.data, "documents", "document");
      const byEmployee: Record<string, any> = {};
      for (const d of docs) {
        const emp = d?.staff_employee ?? {};
        const eid = emp?.id;
        if (!eid) continue;
        if (!byEmployee[eid]) byEmployee[eid] = { id: eid, name: emp?.name ?? "", folders: {} };
        const f = d?.folder;
        if (f?.id) byEmployee[eid].folders[f.id] = f?.name ?? "";
      }
      return json({
        employees: Object.values(byEmployee).map((e: any) => ({
          id: e.id, name: e.name,
          folders: Object.keys(e.folders).map((fid) => ({ id: fid, name: e.folders[fid] })),
        })),
        _count: docs.length,
      }, 200, origin);
    }

    if (action === "raw") {
      const module = param("module") ?? "";
      const act = param("act") ?? "find";
      const id = param("id") ?? undefined;
      const companyId = param("company_id") ?? undefined;
      if (!module) return json({ error: "Brak parametru module." }, 400, origin);
      const r = await wf(module, act, { id, companyId, body: {} });
      return json({ httpStatus: r.httpStatus, data: r.data }, 200, origin);
    }

    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    return json({ error: "Błąd wywołania wFirma: " + (e?.message ?? String(e)) }, 502, origin);
  }
});
