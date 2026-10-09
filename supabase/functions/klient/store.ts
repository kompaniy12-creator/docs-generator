// The database behind portal.ts: PostgREST and Storage with the service role. Nothing here decides
// who may see what — that is portal.ts; this file only fetches rows.
import { type Flaga, type Store, WIDOCZNE } from "./portal.ts";
import { zaproszenie } from "../komunikacja/core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// deno-lint-ignore no-explicit-any
type Any = any;

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
}
async function rows(path: string, init: RequestInit = {}): Promise<Any[]> {
  const r = await db(path, init);
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`db ${r.status} ${path.split("?")[0]} ${t.slice(0, 160)}`); }
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}
// tables of modules that may not be there yet: a missing table is "nothing", not an error
async function miekko(path: string): Promise<Any[]> {
  const r = await db(path).catch(() => null);
  if (!r?.ok) { await r?.body?.cancel(); return []; }
  return await r.json().catch(() => []);
}
const e = encodeURIComponent;
const sciezka = (p: string) => p.split("/").map(e).join("/");
const FLAGI: Record<Flaga, { tab: string; kol: string; zrodlo: string }> = {
  akta: { tab: "akta_udostepnienia", kol: "dokument_id", zrodlo: "akta_dokumenty" },
  umowa: { tab: "klienci_umowy_udostepnienia", kol: "umowa_id", zrodlo: "klienci_umowy" },
};
async function flags(zrodlo: Flaga, ids: string[]): Promise<string[]> {
  const f = FLAGI[zrodlo], out: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const part = await rows(`${f.tab}?${f.kol}=in.(${ids.slice(i, i + 100).join(",")})&udostepniony_klientowi=is.true&select=${f.kol}`);
    out.push(...part.map((x) => x[f.kol]));
  }
  return out;
}
async function rpc(fn: string, args: Record<string, string>): Promise<string | null> {
  const r = await db("rpc/" + fn, { method: "POST", body: JSON.stringify(args) }).catch(() => null);
  if (!r?.ok) { await r?.body?.cancel(); return null; }
  const v = await r.json().catch(() => null);
  return typeof v === "string" && v ? v.toLowerCase() : null;
}
// tasks may only go to somebody who can sign in to the portal
async function portalUsers(): Promise<{ email: string; admin: boolean }[]> {
  const out: { email: string; admin: boolean }[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    if (!r.ok) throw new Error("auth admin " + r.status);
    const batch = (await r.json()).users ?? [];
    for (const u of batch) if (u.app_metadata?.portal === true && u.email) out.push({ email: String(u.email).toLowerCase(), admin: u.app_metadata.portal_admin === true });
    if (batch.length < 1000) break;
  }
  return out.sort((a, b) => a.email.localeCompare(b.email));
}
const ZGL = "id,created_at,konto_id,email,nip,firma,kategoria,rodzaj,worker_id,worker_name,temat,tresc,zalaczniki,status,status_reczny,odpowiedz,odpowiedzial,odpowiedz_at,zadanie_id,assignee";

export const store: Store = {
  async klient(nip) {
    const [k, b] = await Promise.all([
      rows(`portal_klienci?nip=eq.${nip}&select=dane&limit=1`),
      rows(`klienci_baza?nip=eq.${nip}&select=id,nazwa,opiekun,kadrowy,status,koniec_od&limit=1`),
    ]);
    return { dane: k[0]?.dane ?? null, baza: b[0] ?? null };
  },
  async workers(nip) {
    return await rows(`zatrudnienie_zgloszenia?select=id,worker_name,status,created_at,payload&payload->>z_nip=eq.${nip}&status=in.(${WIDOCZNE.join(",")})&order=created_at.desc`, { headers: { Range: "0-1999", "Range-Unit": "items" } });
  },
  async noweIle(nip) { return (await rows(`zatrudnienie_zgloszenia?select=id&payload->>z_nip=eq.${nip}&status=eq.nowe&limit=200`)).length; },
  async worker(id) { return (await rows(`zatrudnienie_zgloszenia?id=eq.${id}&select=id,worker_name,status,created_at,payload`))[0] ?? null; },
  async onboarding(nip) { return (await rows(`onboarding_clients?select=data&data->>nip=eq.${nip}&limit=1`))[0]?.data ?? null; },
  async podpisy(nip) {
    const p = await miekko(`podpisy_pakiety?nip=eq.${nip}&status=neq.szkic&select=id,zgloszenie_id,status,podpisy_dokumenty(id,tytul,status,podpisuje,pd_status)&order=created_at.desc&limit=300`);
    return p.map((x) => ({ id: x.id, zgloszenie_id: x.zgloszenie_id, status: x.status, dokumenty: x.podpisy_dokumenty ?? [] }));
  },
  async logins(kontoId) {
    return (await rows(`klient_log?konto_id=eq.${kontoId}&akcja=in.(logowanie_link,logowanie_haslo)&select=at&order=at.desc&limit=2`)).map((x) => x.at);
  },
  async log(konto, akcja, info) {
    await db("klient_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ konto_id: konto?.id || null, email: konto?.email ?? null, akcja, info: info ?? null }) }).then((r) => r.body?.cancel()).catch(() => undefined);
  },
  async countLog(kontoId, akcja, since) {
    return (await rows(`klient_log?konto_id=eq.${kontoId}&akcja=eq.${e(akcja)}&at=gte.${e(since)}&select=id&limit=500`)).length;
  },
  async aktaShared(nip) {
    const docs = await miekko(`akta_dokumenty?nip=eq.${nip}&status=eq.przypisany&select=id,worker_id,worker_name,czesc,rodzaj,data_dok,created_at&order=created_at.desc&limit=2000`);
    if (!docs.length) return [];
    const on = new Set(await flags("akta", docs.map((x) => x.id)));
    return docs.filter((x) => on.has(x.id));
  },
  async aktaDoc(id) {
    const a = (await miekko(`akta_dokumenty?id=eq.${id}&select=id,nip,status,path,nazwa,worker_id`))[0];
    return a ? { ...a, shared: (await flags("akta", [id])).length === 1 } : null;
  },
  async umowyShared(klientId) {
    const docs = await miekko(`klienci_umowy?klient=eq.${e(klientId)}&status=eq.przypisany&select=id,rodzaj,podtyp,data_zawarcia,obowiazuje_od,obowiazuje_do,bezterminowa&order=data_zawarcia.desc.nullslast&limit=300`);
    if (!docs.length) return [];
    const on = new Set(await flags("umowa", docs.map((x) => x.id)));
    return docs.filter((x) => on.has(x.id));
  },
  async umowa(id) {
    const u = (await miekko(`klienci_umowy?id=eq.${id}&select=id,klient,status,path,nazwa`))[0];
    return u ? { ...u, shared: (await flags("umowa", [id])).length === 1 } : null;
  },
  async historia(nip, typy) {
    return await rows(`portal_doc_history?select=id,created_at,doc_type,title,subject,filename&doc_type=in.(${typy.map(e).join(",")})&pdf_path=not.is.null&or=(payload->>nip.eq.${nip},payload->z->>nip.eq.${nip})&order=created_at.desc&limit=300`);
  },
  async historiaDoc(id) { return (await rows(`portal_doc_history?id=eq.${id}&select=id,doc_type,filename,pdf_path,nip:payload->>nip,znip:payload->z->>nip`))[0] ?? null; },
  async zamkniecia(nip) { return await miekko(`ksieg_zamkniecia?nip=eq.${nip}&select=okres,kroki&order=okres.desc&limit=6`); },
  async invoicesSync() { return (await miekko("invoices?select=synced_at&order=synced_at.desc&limit=1"))[0]?.synced_at ?? null; },
  async invoices(nip, from) {
    return await miekko(`invoices?select=invoice_number,issue_date,due_date,amount,currency,status,paid_date&contractor_nip=eq.${nip}&issue_date=gte.${from}&status=in.(issued,overdue,paid)&order=issue_date.desc&limit=200`);
  },
  async rejestr(klientId) {
    return (await miekko(`klienci_rejestr?klient=eq.${e(klientId)}&znaleziono=is.true&select=krs,regon,nazwa,forma,data_rejestracji,adres,reprezentacja,zarzad,stan,sprawdzono_at&order=fetched_at.desc&limit=1`))[0] ?? null;
  },
  async konta(nip) { return await rows(`klient_konta?nip=cs.{${nip}}&aktywny=is.true&select=id,email,last_login&order=email.asc`); },
  async zgloszenia(nip) { return await rows(`klient_zgloszenia?nip=eq.${nip}&select=${ZGL}&order=created_at.desc&limit=200`); },
  async zgloszenie(id) { return (await rows(`klient_zgloszenia?id=eq.${id}&select=${ZGL}`))[0] ?? null; },
  async zgloszeniaOd(kontoId, since) { return (await rows(`klient_zgloszenia?konto_id=eq.${kontoId}&created_at=gte.${e(since)}&select=id&limit=100`)).length; },
  async zgloszenieInsert(row) {
    const r = await db("klient_zgloszenia", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
    if (!r.ok) console.error("zgloszenie", r.status, (await r.text()).slice(0, 200)); else await r.body?.cancel();
    return r.ok;
  },
  async zgloszeniePatch(id, patch) { await rows(`klient_zgloszenia?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) }); },
  async zgloszeniaBiuro(f) {
    let p = `klient_zgloszenia?select=${ZGL}&kategoria=in.(${f.kategorie.join(",")})&order=created_at.desc&limit=300`;
    if (f.nip) p += `&nip=eq.${f.nip}`;
    if (f.status) p += `&status=eq.${f.status}`;
    return await rows(p);
  },
  async upload(bucket, path, bytes, mime) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${sciezka(path)}`, {
      method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": mime, "x-upsert": "false" }, body: bytes as BodyInit,
    });
    if (!r.ok) console.error("upload", r.status, (await r.text()).slice(0, 200)); else await r.body?.cancel();
    return r.ok;
  },
  async usun(bucket, paths) {
    if (!paths.length) return;
    await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, { method: "DELETE", headers: H, body: JSON.stringify({ prefixes: paths }) }).then((r) => r.body?.cancel()).catch(() => undefined);
  },
  async sign(bucket, path, sekundy, nazwa) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${sciezka(path)}`, { method: "POST", headers: H, body: JSON.stringify({ expiresIn: sekundy }) });
    const j = r.ok ? await r.json() : (await r.body?.cancel(), null);
    // `download` makes the storage answer with Content-Disposition: attachment — never shown inline
    return j?.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}&download=${e(nazwa)}` : null;
  },
  async assignee(dzial, alias) {
    const users = await portalUsers();
    const ok = (m: string | null) => !!m && users.some((u) => u.email === m);
    const a = alias ? await rpc("portal_pracownik_po_aliasie", { p_alias: alias }) : null;
    if (ok(a)) return a;
    const dflt = await rpc("portal_pracownik_domyslny", { p_dzial: dzial });
    if (ok(dflt)) return dflt;
    // as the `zadania` function: the person set in its settings, else an administrator
    const ust = String((await miekko("portal_ustawienia?key=eq.zadania&select=value"))[0]?.value?.kadry ?? "").toLowerCase();
    if (ok(ust)) return ust;
    return users.find((u) => u.admin)?.email ?? null;
  },
  async zadanieInsert(spec) {
    const ins = await rows("portal_zadania?on_conflict=klucz", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(spec) });
    if (ins[0]) return { id: ins[0].id };
    return (await rows(`portal_zadania?klucz=eq.${e(spec.klucz)}&select=id`))[0] ?? null;
  },
  async zadaniaStatus(ids) {
    const out: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 100) {
      for (const z of await miekko(`portal_zadania?id=in.(${ids.slice(i, i + 100).join(",")})&select=id,status`)) out[z.id] = z.status;
    }
    return out;
  },
  async flagSet(zrodlo, id, on, kto) {
    const f = FLAGI[zrodlo];
    const r = await db(`${f.tab}?on_conflict=${f.kol}`, {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ [f.kol]: id, udostepniony_klientowi: on, zmienil: kto, zmieniono_at: new Date().toISOString() }),
    });
    await r.body?.cancel();
    return r.ok;
  },
  flags,
  // the same link the office would hand to the client (module komunikacja builds and keeps it);
  // a bot that is not configured, or a slow Telegram, is simply "no link"
  async telegramLink(klientId, kto, utworz) {
    const z = await Promise.race([
      zaproszenie({ klient: klientId, kto, utworz }).catch((e) => { console.error("zaproszenie", String(e).slice(0, 120)); return null; }),
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    return z?.link || null;
  },
  async obiektFlagi(zrodlo, id) { return (await miekko(`${FLAGI[zrodlo].zrodlo}?id=eq.${id}&select=id`)).length === 1; },
};
