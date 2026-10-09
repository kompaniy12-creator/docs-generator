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
// Zespół (staff profiles, table portal_pracownicy — written only here):
//      { action: "team" }                       portal users + profiles + short names used in the clients base
//      { action: "profile_save", profile, nowy? }   create (nowy: true) or update a profile
//      { action: "profile_delete", email }      removes the profile only, never the account
//      { action: "profile_history", email }     last changes of the profile and of the access

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MIN_PASSWORD = 10;
const SECTIONS = ["rejestracja", "biezaca", "kadry", "legalizacja", "onboarding"];
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
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
// who changed whose access — best effort, never blocks the change itself
async function logAccess(email: string, kto: string, zmiany: Record<string, unknown>) {
  try {
    await db("portal_pracownicy_historia", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ email: email.toLowerCase(), kto, op: "dostep", zmiany }) });
  } catch (e) { console.error("historia", e); }
}

// Row level security reads the claims from the token: after access is taken away or narrowed the person's
// sessions are ended, so nothing can be refreshed with the old rights. Best effort — the change itself stands.
async function endSessions(id: string) {
  try {
    const r = await db("rpc/portal_zakoncz_sesje", { method: "POST", body: JSON.stringify({ p_user: id }) });
    if (!r.ok) console.error("sesje", r.status);
    await r.body?.cancel();
  } catch (_e) { console.error("sesje: błąd"); }
}

// ---- staff profiles
const MAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DZIALY = ["kadry", "ksiegowosc", "legalizacja", "spolka", "zarzad"];
const ODPOWIADA = ["domyslny_kadry", "domyslny_ksiegowosc", "sms", "akta", "podpisy_weryfikacja"];
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const list = (v: unknown, max: number, len: number) =>
  [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, len)).filter(Boolean))].slice(0, max);

// the row to store, or the reason it cannot be stored
// deno-lint-ignore no-explicit-any
function cleanProfile(p: any): { row?: Record<string, unknown>; error?: string } {
  const email = str(p?.email, 200).toLowerCase();
  if (!MAIL.test(email)) return { error: "Nieprawidłowy e-mail." };
  const telefon = str(p.telefon, 30);
  if (telefon && !/^\+?[0-9 ()-]{5,30}$/.test(telefon)) return { error: "Telefon: tylko cyfry, spacje, + ( ) -." };
  const chat = str(p.telegram_chat, 25);
  if (chat && !/^-?\d{4,20}$/.test(chat)) return { error: "ID czatu Telegram to same cyfry (grupa — z minusem na początku)." };
  // the public @name (for the welcome message of a new client group); a page that does not send the field leaves it as it is
  const tgNazwa = str(p.telegram_username, 60).replace(/^(https?:\/\/)?t\.me\//i, "").replace(/^@/, "");
  if (tgNazwa && !/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(tgNazwa)) return { error: "Nazwa w Telegramie: 4–32 znaki — litery, cyfry i podkreślenie, zaczyna się od litery." };
  const skrzynki = list(p.skrzynki, 10, 200).map((x) => x.toLowerCase());
  if (skrzynki.some((x) => !MAIL.test(x))) return { error: "Skrzynka musi być adresem e-mail." };
  const zastepca = str(p.zastepca, 200).toLowerCase();
  if (zastepca && !MAIL.test(zastepca)) return { error: "Zastępca: nieprawidłowy e-mail." };
  if (zastepca === email) return { error: "Nie można być własnym zastępcą." };
  const od = date(p.nieobecny_od), doo = date(p.nieobecny_do);
  if (od && doo && od > doo) return { error: "Nieobecność: data „od” jest późniejsza niż „do”." };
  const odp: Record<string, unknown> = {};
  for (const k of ODPOWIADA) if (p.odpowiada?.[k] === true) odp[k] = true;
  const uwagi = str(p.odpowiada?.uwagi, 500);
  if (uwagi) odp.uwagi = uwagi;
  return {
    row: {
      email, imie_nazwisko: str(p.imie_nazwisko, 120), aliasy: list(p.aliasy, 20, 60), stanowisko: str(p.stanowisko, 120) || null,
      telefon: telefon || null, telegram_chat: chat || null, dzialy: DZIALY.filter((d) => Array.isArray(p.dzialy) && p.dzialy.includes(d)),
      skrzynki, odpowiada: odp, aktywny: p.aktywny !== false, nieobecny_od: od, nieobecny_do: doo, zastepca: zastepca || null,
      notatki: str(p.notatki, 2000) || null,
      ...(p.telegram_username === undefined ? {} : { telegram_username: tgNazwa || null }),
    },
  };
}
// the database's own refusals (short name taken, deputy without a profile) in words for the form
async function dbError(r: Response): Promise<string> {
  const e = await r.json().catch(() => ({}));
  if (e.code === "P0001") return String(e.message ?? "Nie udało się zapisać profilu.");
  if (e.code === "23503") return "Zastępca musi mieć własny profil.";
  if (e.code === "23505") return "Profil z tym adresem już istnieje.";
  if (e.code === "42P01" || e.code === "PGRST205") return "Brak tabeli profili — migracja portal_pracownicy nie została wykonana.";
  console.error("portal_pracownicy", r.status, e.code, e.message);
  return "Nie udało się zapisać profilu.";
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

  // deno-lint-ignore no-explicit-any
  let body: { action?: string; email?: string; password?: string; id?: string; on?: boolean; sections?: unknown; profile?: any; nowy?: boolean };
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

    const kto = String(me.email ?? "").toLowerCase();

    if (body.action === "team") {
      const all = await allUsers();
      const byMail = new Map(all.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]));
      const pr = await db("portal_pracownicy?select=*&order=imie_nazwisko.asc,email.asc");
      const tabela = pr.ok;
      // deno-lint-ignore no-explicit-any
      const profiles = (tabela ? await pr.json() : []).map((p: any) => {
        const u = byMail.get(p.email);
        // "inne" = the address has an account from another app of the office, without portal access
        return { ...p, konto: u ? (isPortal(u) ? "portal" : "inne") : "brak" };
      });
      // short names as the clients base has them, with the number of clients still served
      const skroty = new Map<string, { nazwa: string; opiekun: number; kadrowy: number }>();
      const kb = await db("klienci_baza?select=opiekun,kadrowy,status");
      for (const k of (kb.ok ? await kb.json() : []) as { opiekun: string | null; kadrowy: string | null; status: string }[]) {
        if (k.status === "zakonczony") continue;
        for (const pole of ["opiekun", "kadrowy"] as const) {
          const n = (k[pole] ?? "").trim();
          if (!n) continue;
          const s = skroty.get(n) ?? { nazwa: n, opiekun: 0, kadrowy: 0 };
          s[pole]++;
          skroty.set(n, s);
        }
      }
      // what the Zadania settings still hold, so the administrator can move it into the profiles
      const zs = await db("portal_ustawienia?key=eq.zadania&select=value");
      const zv = zs.ok ? (await zs.json())[0]?.value ?? {} : {};
      return json({
        me: me.id, email: kto, tabela, profiles,
        users: all.filter(isPortal).map(view).sort((a, b) => a.email.localeCompare(b.email)),
        skroty: [...skroty.values()].sort((a, b) => a.nazwa.localeCompare(b.nazwa, "pl")), klienci: kb.ok,
        zadania: { telegram: zv.telegram ?? {}, kadry: zv.kadry ?? "" },
      }, 200, origin);
    }

    if (body.action === "profile_save") {
      const c = cleanProfile(body.profile);
      if (!c.row) return json({ error: c.error }, 400, origin);
      const row: Record<string, unknown> = { ...c.row, updated_by: kto };
      const r = body.nowy === true
        ? await db("portal_pracownicy", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) })
        : await db(`portal_pracownicy?email=eq.${encodeURIComponent(String(row.email))}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
      if (!r.ok) return json({ error: await dbError(r) }, 400, origin);
      const saved = (await r.json())[0];
      if (!saved) return json({ error: "Nie ma takiego profilu." }, 404, origin);
      return json({ ok: true, profile: saved }, 200, origin);
    }

    if (body.action === "profile_delete" || body.action === "profile_history") {
      const email = str(body.email, 200).toLowerCase();
      if (!MAIL.test(email)) return json({ error: "Nieprawidłowy e-mail." }, 400, origin);
      const q = encodeURIComponent(email);
      if (body.action === "profile_history") {
        const r = await db(`portal_pracownicy_historia?email=eq.${q}&select=at,kto,op,zmiany&order=id.desc&limit=40`);
        return json({ historia: r.ok ? await r.json() : [] }, 200, origin);
      }
      const r = await db(`portal_pracownicy?email=eq.${q}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      if (!r.ok) return json({ error: await dbError(r) }, 400, origin);
      if (!(await r.json()).length) return json({ error: "Nie ma takiego profilu." }, 404, origin);
      // the delete trigger has no session to read the name from
      await db(`portal_pracownicy_historia?email=eq.${q}&op=eq.usunieto&kto=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ kto }) }).catch((e) => console.error("historia", e));
      return json({ ok: true }, 200, origin);
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
        await logAccess(email, kto, { portal: true, sekcje: cleanSections(body.sections), konto: "istniejące" });
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
      await logAccess(email, kto, { portal: true, sekcje: cleanSections(body.sections), konto: "nowe" });
      return json({ ok: true, existed: false }, 200, origin);
    }

    // the remaining actions target an existing portal user
    const target = await getUser(body.id ?? "");
    if (!target || !isPortal(target)) return json({ error: "Nie znaleziono użytkownika portalu." }, 404, origin);

    if (body.action === "revoke") {
      if (target.id === me.id) return json({ error: "Nie można odebrać dostępu samemu sobie." }, 400, origin);
      const r = await admin(`users/${target.id}`, { method: "PUT", body: JSON.stringify({ app_metadata: { portal: false, portal_admin: false } }) });
      if (r.ok) { await logAccess(target.email ?? "", kto, { portal: false }); await endSessions(target.id); }
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
      if (r.ok) { await logAccess(target.email ?? "", kto, { sekcje: cleanSections(body.sections) }); if (target.id !== me.id) await endSessions(target.id); }
      return r.ok ? json({ ok: true }, 200, origin) : json({ error: "Nie udało się zmienić sekcji." }, 502, origin);
    }
    if (body.action === "admin") {
      if (target.id === me.id) return json({ error: "Nie można zmienić własnych uprawnień administratora." }, 400, origin);
      const r = await admin(`users/${target.id}`, { method: "PUT", body: JSON.stringify({ app_metadata: { portal_admin: body.on === true } }) });
      if (r.ok) { await logAccess(target.email ?? "", kto, { administrator: body.on === true }); if (body.on !== true) await endSessions(target.id); }
      return r.ok ? json({ ok: true }, 200, origin) : json({ error: "Nie udało się zmienić uprawnień." }, 502, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
