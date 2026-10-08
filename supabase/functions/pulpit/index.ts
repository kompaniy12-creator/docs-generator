// Administrator's dashboard: one answer with the state of the whole portal.
// POST {} with a portal JWT of an administrator. Read-only; everything is aggregated here,
// so the page needs no access to the tables that are closed to browsers
// (client base, onboarding, client accounts).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
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
async function all(path: string): Promise<Any[]> {
  const out: Any[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db(path, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error(path.split("?")[0] + ": " + r.status);
    const part = await r.json();
    out.push(...part);
    if (part.length < 1000) break;
  }
  return out;
}
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const days = (iso: string, from: string) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([nazwa, ile]) => ({ nazwa, ile }));

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!(await isAdmin(req))) return json({ error: "Tylko administrator." }, 403, origin);
  try {
    const dzis = today();
    const [rows, zadania, onb, klienci, konta, klog, joby, powiad, wiedza, akty, faktury, hist] = await Promise.all([
      all("zatrudnienie_zgloszenia?select=id,worker_name,status,created_at,payload"),
      all("portal_zadania?select=assignee,status,termin,pilne,eskalacja,done_at,done_by,created_at,created_by,zrodlo,tytul"),
      all("onboarding_clients?select=data"),
      all("portal_klienci?select=nip,dane"),
      all("klient_konta?select=aktywny,last_login,haslo_hash"),
      all(`klient_log?select=akcja,at,email&at=gte.${ago(7)}`),
      all(`portal_zadania_log?select=zadanie,started_at,ok,info&started_at=gte.${ago(8)}&order=started_at.desc`),
      all(`portal_powiadomienia?select=rodzaj,status,created_at&created_at=gte.${ago(30)}`),
      all("portal_wiedza?select=do_sprawdzenia"),
      all("portal_prawo_akty?select=skrot,zmiana_wykryta,checked_at"),
      db("invoices?select=synced_at&order=synced_at.desc&limit=1").then((r) => (r.ok ? r.json() : [])),
      all(`portal_doc_history?select=doc_type,created_at,user_email,title,subject&created_at=gte.${ago(30)}`),
    ]);

    // ---- Kadry
    const st: Record<string, number> = {};
    const firmy = new Map<string, number>();
    let cudz = 0, brakTerminow = 0, dokPo = 0, dok30 = 0, umowy30 = 0, umowyPo = 0;
    const terminy: Any[] = [];
    const DOKI: Record<string, string> = { p_karta_do: "karta pobytu", p_zezwolenie_do: "zezwolenie / wiza", p_paszport_do: "paszport", p_badania_do: "badania lekarskie", u_do: "umowa" };
    const perDay = new Map<string, number>();
    for (const w of rows) {
      st[w.status] = (st[w.status] ?? 0) + 1;
      const p = w.payload ?? {};
      if (!p._import && Date.parse(w.created_at) > Date.now() - 30 * 86400000) { const d = w.created_at.slice(0, 10); perDay.set(d, (perDay.get(d) ?? 0) + 1); }
      if (w.status !== "zatrudniony") continue;
      firmy.set(p.z_nazwa || "—", (firmy.get(p.z_nazwa || "—") ?? 0) + 1);
      const foreign = !!p.p_obywatelstwo && !/^pol/i.test(p.p_obywatelstwo);
      if (foreign) cudz++;
      if (foreign && !isDate(p.p_karta_do) && !isDate(p.p_zezwolenie_do) && p.p_karta_bezterm !== true && p.p_zezwolenie_bezterm !== true) brakTerminow++;
      for (const k of ["p_karta_do", "p_zezwolenie_do", "p_paszport_do", "p_badania_do"]) {
        if (!isDate(p[k])) continue;
        const d = days(p[k], dzis);
        if (d < 0) dokPo++; else if (d <= 30) dok30++;
        if (d >= -30 && d <= 90) terminy.push({ kto: w.worker_name ?? "", firma: p.z_nazwa ?? "", co: DOKI[k], data: p[k], dni: d });
      }
      if (isDate(p.u_do) && p.u_bezterminowo !== true) { const d = days(p.u_do, dzis); if (d < 0) umowyPo++; else if (d <= 30) umowy30++; if (d >= -30 && d <= 90) terminy.push({ kto: w.worker_name ?? "", firma: p.z_nazwa ?? "", co: DOKI.u_do, data: p.u_do, dni: d }); }
    }
    const dni: { d: string; n: number }[] = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); dni.push({ d, n: perDay.get(d) ?? 0 }); }

    // ---- Zadania
    const open = zadania.filter((z) => z.status === "nowe" || z.status === "w_toku");
    const late = open.filter((z) => z.termin && z.termin < dzis);
    const team = new Map<string, { otwarte: number; po_terminie: number; zrobione7: number }>();
    const person = (e: string) => team.get(e) ?? team.set(e, { otwarte: 0, po_terminie: 0, zrobione7: 0 }).get(e)!;
    for (const z of zadania) {
      const t = person(z.assignee);
      if (z.status === "nowe" || z.status === "w_toku") { t.otwarte++; if (z.termin && z.termin < dzis) t.po_terminie++; }
      if (z.status === "zrobione" && z.done_at && Date.parse(z.done_at) > Date.now() - 7 * 86400000) t.zrobione7++;
    }

    // ---- Księgowość: onboarding
    const oc = onb.map((x) => x.data).filter((c: Any) => c && !c.archived);
    let oLate = 0, oWait = 0, oPct = 0;
    const oList = oc.map((c: Any) => {
      const tasks: Any[] = (c.tasks ?? []).filter((t: Any) => t.status !== "na");
      const done = tasks.filter((t) => t.status === "done").length;
      const l = tasks.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < dzis).length;
      const w = tasks.filter((t) => t.status === "waiting_client").length;
      oLate += l; oWait += w;
      const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
      oPct += pct;
      return { id: c.id, nazwa: c.name, pct, po_terminie: l, czekamy: w };
    }).sort((a: Any, b: Any) => b.po_terminie - a.po_terminie || a.pct - b.pct);

    // ---- Klienci
    const opiek = new Map<string, number>(), formy = new Map<string, number>();
    for (const k of klienci) {
      opiek.set(k.dane?.opiekun || "bez opiekuna", (opiek.get(k.dane?.opiekun || "bez opiekuna") ?? 0) + 1);
      formy.set(k.dane?.forma || "—", (formy.get(k.dane?.forma || "—") ?? 0) + 1);
    }

    // ---- Automaty: the latest run of every job + failures of the week
    const lastJob = new Map<string, Any>();
    for (const j of joby) if (!lastJob.has(j.zadanie)) lastJob.set(j.zadanie, j);
    const JOBS = ["terminy", "watchdog", "zadania", "prawo", "faktury"];
    const automaty = JOBS.map((z) => { const j = lastJob.get(z); return { zadanie: z, ostatnio: j?.started_at ?? null, ok: j ? j.ok : null, problem: j && j.ok === false ? (j.info?.error ?? (j.info?.problems ?? []).join("; ") ?? "") : "" }; });

    // ---- recent activity across the modules
    const akt: { at: string; modul: string; tekst: string }[] = [];
    for (const w of rows) if (!w.payload?._import && Date.parse(w.created_at) > Date.now() - 14 * 86400000) akt.push({ at: w.created_at, modul: "Kadry", tekst: `Nowe zgłoszenie — ${w.payload?.z_nazwa ?? "firma"}` });
    for (const z of zadania) {
      if (z.done_at && Date.parse(z.done_at) > Date.now() - 14 * 86400000) akt.push({ at: z.done_at, modul: "Zadania", tekst: `Zrobione: ${z.tytul} (${String(z.done_by ?? "").split("@")[0] || "portal"})` });
      else if (z.created_at && Date.parse(z.created_at) > Date.now() - 14 * 86400000 && z.zrodlo === "reczne") akt.push({ at: z.created_at, modul: "Zadania", tekst: `Nowe zadanie: ${z.tytul} → ${String(z.assignee).split("@")[0]}` });
    }
    for (const l of klog) if (/^logowanie/.test(l.akcja)) akt.push({ at: l.at, modul: "Klienci", tekst: `Klient zalogował się do profilu (${l.email ?? "?"})` });
    for (const h of hist) if (Date.parse(h.created_at) > Date.now() - 14 * 86400000) akt.push({ at: h.created_at, modul: "Dokumenty", tekst: `${h.title ?? h.doc_type}${h.subject ? " — " + h.subject : ""} (${String(h.user_email ?? "").split("@")[0]})` });
    akt.sort((a, b) => b.at.localeCompare(a.at));

    const docs = new Map<string, number>();
    for (const h of hist) docs.set(h.doc_type, (docs.get(h.doc_type) ?? 0) + 1);

    return json({
      na_dzien: new Date().toISOString(),
      kadry: {
        pracownicy: st.zatrudniony ?? 0, archiwum: st.archiwum ?? 0, nowe: st.nowe ?? 0, w_toku: (st.sprawdzone ?? 0) + (st.wyslane ?? 0),
        cudzoziemcy: cudz, bez_terminow_pobytu: brakTerminow, dokumenty_po_terminie: dokPo, dokumenty_30: dok30, umowy_30: umowy30, umowy_po_terminie: umowyPo,
        firmy_z_pracownikami: firmy.size, top_firmy: top(firmy, 15), zgloszenia_30dni: dni,
        terminy_najblizsze: terminy.sort((a, b) => a.dni - b.dni).slice(0, 25),
      },
      zadania: {
        otwarte: open.length, po_terminie: late.length, pilne: open.filter((z) => z.pilne).length, eskalowane: open.filter((z) => z.eskalacja).length,
        z_systemu: open.filter((z) => z.zrodlo === "system").length,
        zespol: [...team.entries()].map(([email, v]) => ({ email, ...v })).sort((a, b) => b.po_terminie - a.po_terminie || b.otwarte - a.otwarte),
        pilne_lista: open.filter((z) => z.pilne).slice(0, 15).map((z) => ({ tytul: z.tytul, assignee: z.assignee, termin: z.termin })),
        zrobione7: zadania.filter((z) => z.status === "zrobione" && z.done_at && Date.parse(z.done_at) > Date.now() - 7 * 86400000).length,
        najstarsze: late.sort((a, b) => a.termin.localeCompare(b.termin)).slice(0, 15).map((z) => ({ tytul: z.tytul, assignee: z.assignee, termin: z.termin })),
      },
      onboarding: { firmy: oc.length, sredni_postep: oc.length ? Math.round(oPct / oc.length) : 0, zadania_po_terminie: oLate, czekamy_na_klienta: oWait, lista: oList.slice(0, 25) },
      klienci: {
        wszystkie: klienci.length, opiekunowie: top(opiek, 12), formy: top(formy, 6),
        konta: konta.length, konta_aktywne: konta.filter((k) => k.aktywny).length, konta_z_haslem: konta.filter((k) => k.haslo_hash).length,
        logowania_7dni: klog.filter((l) => /^logowanie/.test(l.akcja)).length,
      },
      automaty,
      powiadomienia_30dni: { wyslane: powiad.filter((p) => p.status === "ok").length, bledy: powiad.filter((p) => p.status !== "ok").length },
      prawo: { zasady_do_sprawdzenia: wiedza.filter((w) => w.do_sprawdzenia).length, zmienione_akty: akty.filter((a) => a.zmiana_wykryta).map((a) => a.skrot), akty: akty.length },
      faktury: { ostatnia_synchronizacja: faktury[0]?.synced_at ?? null },
      dokumenty_30dni: top(docs, 12),
      aktywnosc: akt.slice(0, 40),
    }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
