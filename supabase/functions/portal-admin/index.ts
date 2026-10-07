// Portal access management for the "Dostęp" admin page. ADMIN ONLY — the caller's
// JWT must belong to a user with app_metadata.portal_admin === true (checked
// against the auth server, not the token payload). Uses the service-role key,
// which exists only here, to read / create users and set app_metadata.portal.
// The auth project is shared with other apps, so only portal users are listed and
// "revoke" clears the portal flag — it never deletes the account.
//
// POST { action: "list" }
//      { action: "add", email, password? }      create the user or grant an existing one
//      { action: "revoke", id }
//      { action: "password", id, password }
//      { action: "admin", id, on }
//      { action: "sections", id, sections }    array of section keys, or null = all

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MIN_PASSWORD = 10;
const SECTIONS = ["rejestracja", "biezaca", "kadry"];
// null = every section; otherwise the known keys only
function cleanSections(v: unknown): string[] | null {
  return Array.isArray(v) ? SECTIONS.filter((s) => v.includes(s)) : null;
}

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

type AuthUser = {
  id: string; email?: string; created_at?: string; last_sign_in_at?: string | null;
  app_metadata?: Record<string, unknown>;
};

async function caller(req: Request): Promise<AuthUser | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return await r.json();
}

function admin(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  });
}
async function allUsers(): Promise<AuthUser[]> {
  const out: AuthUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await admin(`users?page=${page}&per_page=1000`);
    if (!r.ok) throw new Error("auth admin " + r.status);
    const batch = (await r.json()).users ?? [];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}
async function getUser(id: string): Promise<AuthUser | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await admin(`users/${id}`);
  return r.ok ? await r.json() : null;
}
const isPortal = (u: AuthUser) => u.app_metadata?.portal === true;
const view = (u: AuthUser) => ({
  id: u.id, email: u.email ?? "", admin: u.app_metadata?.portal_admin === true,
  sections: cleanSections(u.app_metadata?.portal_sections),
  created_at: u.created_at ?? null, last_sign_in_at: u.last_sign_in_at ?? null,
});

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!SERVICE) return json({ error: "Brak konfiguracji serwera." }, 500, origin);

  const me = await caller(req);
  if (!me || me.app_metadata?.portal_admin !== true) return json({ error: "Brak uprawnień administratora." }, 403, origin);

  let body: { action?: string; email?: string; password?: string; id?: string; on?: boolean; sections?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Nieprawidłowy JSON." }, 400, origin);
  }

  try {
    if (body.action === "list") {
      const users = (await allUsers()).filter(isPortal).map(view)
        .sort((a, b) => a.email.localeCompare(b.email));
      return json({ users, me: me.id }, 200, origin);
    }

    if (body.action === "add") {
      const email = (body.email ?? "").trim().toLowerCase();
      const password = body.password ?? "";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Nieprawidłowy e-mail." }, 400, origin);
      const existing = (await allUsers()).find((u) => (u.email ?? "").toLowerCase() === email);
      if (existing) {
        // the account already exists (maybe from another app) — grant access, keep its password
        const r = await admin(`users/${existing.id}`, { method: "PUT", body: JSON.stringify({ app_metadata: { portal: true, portal_sections: cleanSections(body.sections) } }) });
        if (!r.ok) return json({ error: "Nie udało się nadać dostępu." }, 502, origin);
        return json({ ok: true, existed: true }, 200, origin);
      }
      if (password.length < MIN_PASSWORD) return json({ error: `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.` }, 400, origin);
      const r = await admin("users", {
        method: "POST",
        body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { portal: true, portal_sections: cleanSections(body.sections) } }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return json({ error: e.msg || e.message || "Nie udało się utworzyć konta." }, 400, origin);
      }
      return json({ ok: true, existed: false }, 200, origin);
    }

    // the remaining actions target an existing portal user
    const target = await getUser(body.id ?? "");
    if (!target || !isPortal(target)) return json({ error: "Nie znaleziono użytkownika portalu." }, 404, origin);

    if (body.action === "revoke") {
      if (target.id === me.id) return json({ error: "Nie można odebrać dostępu samemu sobie." }, 400, origin);
      const r = await admin(`users/${target.id}`, { method: "PUT", body: JSON.stringify({ app_metadata: { portal: false, portal_admin: false } }) });
      return r.ok ? json({ ok: true }, 200, origin) : json({ error: "Nie udało się odebrać dostępu." }, 502, origin);
    }
    if (body.action === "password") {
      const password = body.password ?? "";
      if (password.length < MIN_PASSWORD) return json({ error: `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.` }, 400, origin);
      const r = await admin(`users/${target.id}`, { method: "PUT", body: JSON.stringify({ password }) });
      return r.ok ? json({ ok: true }, 200, origin) : json({ error: "Nie udało się zmienić hasła." }, 502, origin);
    }
    if (body.action === "sections") {
      const r = await admin(`users/${target.id}`, { method: "PUT", body: JSON.stringify({ app_metadata: { portal_sections: cleanSections(body.sections) } }) });
      return r.ok ? json({ ok: true }, 200, origin) : json({ error: "Nie udało się zmienić sekcji." }, 502, origin);
    }
    if (body.action === "admin") {
      if (target.id === me.id) return json({ error: "Nie można zmienić własnych uprawnień administratora." }, 400, origin);
      const r = await admin(`users/${target.id}`, { method: "PUT", body: JSON.stringify({ app_metadata: { portal_admin: body.on === true } }) });
      return r.ok ? json({ ok: true }, 200, origin) : json({ error: "Nie udało się zmienić uprawnień." }, 502, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
