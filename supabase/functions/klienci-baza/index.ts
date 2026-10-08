// Baza klientów: the office's lasting register of clients — service status, register data, contracts audit.
// PORTAL ONLY (JWT with app_metadata.portal === true). Every action is a POST with { action, ... }.
//
//   lista                                  any portal user
//     -> { ja, klienci: [{ ...klienci_baza, rej, rej_historia, ostrzezenia, odpis, kontakt?, audyt?, historia? }], umowy?, cena }
//     Brings the list up to date with the clients sheet first (at most every 30 minutes; never deletes).
//     Contact data only for users of the Kadry section (as in klienci-list); contracts, the audit and the
//     status history only for administrators.
//   sync                                   any portal user — the same update, at once
//   rejestr            { id, fresh? }      administrator — reads the register for one client (paid)
//   rejestr_wszystkie  { dry, dni?, z_zakonczonymi? }   administrator
//     dry: true  -> the plan: how many firms, requests and the estimated cost; nothing is fetched
//     dry: false -> reads at most MAX_NA_RAZ firms of the plan and says how many are left
//   status             { id, status, koniec_od?, obsluga_od?, powod? }   administrator
//   rozpoznaj          { id }              administrator — reads a contract scan and proposes the client
//   braki_csv                              administrator -> { csv }
//
// Register data: KRS firms through _shared/firma.ts (rejestr.io, paid per request) plus rejestr.io's basic
// record kept in full; sole traders are not in KRS — they are read from GUS (REGON) through DataPort.

import { loadKlienciRows } from "../_shared/klienci.ts";
import { firmaConfigured, getFirma } from "../_shared/firma.ts";
import {
  audytKlienta, CENA_REJESTR_IO, csvBraki, digits, dopasuj, formaTyp, isDate, klientId, nipOk, odcisk, ostrzezeniaRejestru,
  pewnyKlient, planOdswiezenia, roznice, type Wyciag, wyciagGus, wyciagKrs,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const REJESTR_IO_KEY = Deno.env.get("REJESTR_IO_KEY") ?? "";
const DATAPORT_KEY = Deno.env.get("DATAPORT_API_KEY") ?? "";
const BIURO_NIP = Deno.env.get("BIURO_NIP") ?? "7831916366";
const MODEL = "claude-opus-4-8";
const BUCKET = "klienci-umowy";
const MAX_BYTES = 24 * 1024 * 1024;
const SYNC_MIN = 30;       // the list follows the clients sheet at most this often
const MAX_NA_RAZ = 5;      // firms read from the register in one call of rejestr_wszystkie
const DNI_DOMYSLNIE = 30;  // a snapshot younger than this is not read again

// deno-lint-ignore no-explicit-any
type Any = any;

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
async function all(path: string): Promise<Any[]> {
  const out: Any[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const r = await db(path, { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error(path.split("?")[0] + ": " + r.status);
    const part = await r.json();
    out.push(...part);
    if (part.length < 1000) break;
  }
  return out;
}
type Ja = { email: string; admin: boolean; kadry: boolean };
async function portal(req: Request): Promise<Ja | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  if (m.portal !== true || !u.email) return null;
  const admin = m.portal_admin === true;
  return { email: String(u.email), admin, kadry: admin || !Array.isArray(m.portal_sections) || m.portal_sections.includes("kadry") };
}
const enc = encodeURIComponent;
const okId = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && (/^\d{10}$/.test(v) || /^nazwa:.+/.test(v));
const REJ_KOL = "id,klient,nip,fetched_at,sprawdzono_at,zrodlo,znaleziono,krs,regon,nazwa,forma,data_rejestracji,kapital,adres,organ,reprezentacja,zarzad,wspolnicy,prokurenci,pkd,stan,zmiany,odcisk";

// ---------------------------------------------------------------- the list follows the clients sheet
async function sync(force: boolean): Promise<{ zsynchronizowano: boolean; blad?: string }> {
  if (!force) {
    const r = await db("klienci_baza?select=arkusz_at&arkusz_at=not.is.null&order=arkusz_at.desc&limit=1");
    const last = r.ok ? (await r.json())[0]?.arkusz_at : null;
    if (last && Date.now() - Date.parse(last) < SYNC_MIN * 60000) return { zsynchronizowano: false };
  }
  try {
    const list = await loadKlienciRows();
    if (list.length < 3) throw new Error("podejrzanie mało wierszy w bazie klientów"); // never mark everybody as gone on a broken read
    const now = new Date().toISOString(), seen = new Set<string>(), rows: Any[] = [];
    const t = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n) || null;
    for (const k of list) {
      const id = klientId(k);
      if (seen.has(id) || id === "nazwa:") continue; // the first row of a repeated NIP wins, as in the sheet copy
      seen.add(id);
      rows.push({ id, nip: digits(k.nip) || null, nazwa: t(k.nazwa) ?? digits(k.nip), forma: t(k.forma, 120), opodatkowanie: t(k.opodatkowanie, 200), adres: t(k.adres), miasto: t(k.miasto, 120), opiekun: t(k.opiekun, 120), kadrowy: t(k.kadrowy, 120), w_arkuszu: true, arkusz_at: now, brak_od: null });
    }
    // only the columns sent are overwritten: the service status of a client already known stays as it is
    const up = await db("klienci_baza", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    if (!up.ok) throw new Error("zapis listy: " + up.status);
    // rows that left the sheet are kept and only marked
    for (const k of await all("klienci_baza?select=id&w_arkuszu=is.true")) {
      if (!seen.has(k.id)) await db(`klienci_baza?id=eq.${enc(k.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ w_arkuszu: false, brak_od: now }) });
    }
    return { zsynchronizowano: true };
  } catch (e) {
    console.error("klienci-baza sync", String((e as Error)?.message ?? e));
    return { zsynchronizowano: false, blad: "Nie udało się odświeżyć listy z arkusza klientów — pokazuję ostatni zapisany stan." };
  }
}

// ---------------------------------------------------------------- register
const wierszNaWyciag = (r: Any): Wyciag => ({
  znaleziono: r.znaleziono, krs: r.krs, regon: r.regon, nazwa: r.nazwa, forma: r.forma, data_rejestracji: r.data_rejestracji, kapital: r.kapital == null ? null : Number(r.kapital),
  adres: r.adres, organ: r.organ, reprezentacja: r.reprezentacja, zarzad: r.zarzad ?? [], wspolnicy: r.wspolnicy ?? [], prokurenci: r.prokurenci ?? [], pkd: r.pkd, stan: r.stan,
});
async function gus(nip: string): Promise<Any> {
  if (!DATAPORT_KEY) throw new Error("brak konfiguracji GUS (DataPort)");
  const r = await fetch("https://dataport.pl/api/v1/company/" + nip, { headers: { "X-API-Key": DATAPORT_KEY, Accept: "application/json" } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 404 || d?.success === false) return { success: false };
  if (!r.ok) throw new Error("GUS HTTP " + r.status);
  return d;
}
// Reads the register for one client and stores the result: a new snapshot when something changed,
// otherwise only the date of the check. `dni`: our own cache of rejestr.io younger than this is reused.
async function odswiez(k: Any, fresh: boolean, dni: number): Promise<{ ok: boolean; zmiany: number; zrodlo?: string; blad?: string }> {
  const nip = digits(k.nip), now = new Date().toISOString();
  const koniec = async (blad: string | null) => { await db(`klienci_baza?id=eq.${enc(k.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ rejestr_at: now, rejestr_blad: blad }) }); };
  try {
    if (!nipOk(nip)) throw new Error("brak poprawnego NIP");
    let zrodlo: "krs" | "gus" = formaTyp(k.forma) === "krs" ? "krs" : "gus";
    let w: Wyciag, dane: Any, surowe: Any = null;
    if (zrodlo === "krs") {
      if (!firmaConfigured()) throw new Error("brak konfiguracji rejestr.io");
      let f = await getFirma(nip, false);
      if (f.z_pamieci && (fresh || Date.now() - Date.parse(f.pobrano) > dni * 86400000)) f = await getFirma(nip, true);
      if (f.found === false) zrodlo = "gus"; // the sheet says "spółka", KRS does not know the NIP: look in REGON
      else {
        // rejestr.io's own basic record (dates of entries, main activity, struck off or not) — one more paid request
        const r = REJESTR_IO_KEY ? await fetch(`https://rejestr.io/api/v2/org/${digits(f.krs) || "nip" + nip}`, { headers: { Authorization: REJESTR_IO_KEY } }) : null;
        surowe = r?.ok ? await r.json() : null;
        dane = f; w = wyciagKrs(f, surowe);
      }
    }
    if (zrodlo === "gus") { dane = await gus(nip); w = wyciagGus(dane); surowe = null; }
    const p = await db(`klienci_rejestr?klient=eq.${enc(k.id)}&select=${REJ_KOL}&order=fetched_at.desc&limit=1`);
    const prev = p.ok ? (await p.json())[0] : null;
    const zm = prev ? roznice(wierszNaWyciag(prev), w!) : [];
    const kolumny = { ...w!, nip, zrodlo, odcisk: odcisk(w!), dane, surowe, sprawdzono_at: now };
    // the same state as last time (or only fields we did not read before): confirm the existing snapshot
    const zapis = prev && !zm.length && prev.zrodlo === zrodlo
      ? await db(`klienci_rejestr?id=eq.${prev.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(kolumny) })
      : await db("klienci_rejestr", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...kolumny, klient: k.id, fetched_at: now, zmiany: zm }) });
    if (!zapis.ok) throw new Error("zapis danych rejestru: " + zapis.status);
    await koniec(null);
    return { ok: true, zmiany: zm.length, zrodlo };
  } catch (e) {
    const blad = String((e as Error)?.message ?? e).slice(0, 200);
    console.error("klienci-baza rejestr", blad);
    await koniec(blad);
    return { ok: false, zmiany: 0, blad };
  }
}

// ---------------------------------------------------------------- contracts: reading a scan
const RODZAJE = ["ksiegowosc", "kadry", "powierzenie", "aneks", "pelnomocnictwo", "upowaznienie", "wypowiedzenie", "inne"];
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["analiza", "rodzaj", "podtyp", "obejmuje", "klient", "data_zawarcia", "obowiazuje_od", "obowiazuje_do", "bezterminowa", "okres_wypowiedzenia", "zakres", "wynagrodzenie", "podpisy", "stron", "pewnosc", "uwagi"],
  properties: {
    analiza: { type: "string", description: "Krótko: co to za dokument, kto jest stronami i po czym to rozpoznano." },
    rodzaj: { type: "string", enum: RODZAJE },
    podtyp: { type: "string", description: "Dla pełnomocnictwa / upoważnienia: np. UPL-1, UPL-1P, PPS-1, ZUS PEL, KSeF (ZAW-FA), e-Urząd Skarbowy, ogólne. W innych przypadkach pusty." },
    obejmuje: { type: "array", items: { type: "string", enum: ["ksiegowosc", "kadry", "powierzenie"] }, description: "Co faktycznie obejmuje treść dokumentu (umowa może obejmować kilka rzeczy naraz)." },
    klient: {
      type: "object", additionalProperties: false, required: ["nazwa", "nip", "krs", "reprezentanci"],
      properties: {
        nazwa: { type: "string" }, nip: { type: "string" }, krs: { type: "string" },
        reprezentanci: { type: "array", items: { type: "object", additionalProperties: false, required: ["imie_nazwisko", "funkcja"], properties: { imie_nazwisko: { type: "string" }, funkcja: { type: "string" } } } },
      },
    },
    data_zawarcia: { type: "string", description: "RRRR-MM-DD albo pusty" },
    obowiazuje_od: { type: "string", description: "RRRR-MM-DD albo pusty" },
    obowiazuje_do: { type: "string", description: "RRRR-MM-DD albo pusty (pusty także przy umowie na czas nieokreślony)" },
    bezterminowa: { type: "boolean" },
    okres_wypowiedzenia: { type: "string" },
    zakres: { type: "string", description: "Zakres usług w 1–3 zdaniach." },
    wynagrodzenie: { type: "string", description: "Wynagrodzenie dokładnie tak, jak zapisano (kwota, okres), albo pusty." },
    podpisy: { type: "string", enum: ["obie_strony", "tylko_klient", "tylko_biuro", "brak", "nieczytelne"] },
    stron: { type: "integer" },
    pewnosc: { type: "string", enum: ["wysoka", "srednia", "niska"] },
    uwagi: { type: "string", description: "Wątpliwości: nieczytelne fragmenty, brak stron, kilka dokumentów w jednym pliku, brak podpisu. Pusty, gdy brak." },
  },
};
const PROMPT = `To skan dokumentu z teczki klienta biura rachunkowego w Polsce. Biuro (zleceniobiorca / przyjmujący zlecenie / podmiot przetwarzający / pełnomocnik) ma NIP ${BIURO_NIP}. „Klient” to DRUGA strona dokumentu — zleceniodawca, administrator danych albo mocodawca — nigdy biuro.

Ustal:
1) rodzaj dokumentu:
   ksiegowosc — umowa o prowadzenie ksiąg rachunkowych / podatkowych, o świadczenie usług księgowych (także gdy obejmuje również kadry);
   kadry — umowa wyłącznie o obsługę kadrowo-płacową;
   powierzenie — odrębna umowa powierzenia przetwarzania danych osobowych (art. 28 RODO);
   aneks — aneks do umowy; pelnomocnictwo — UPL-1, UPL-1P, PPS-1, ZUS PEL, pełnomocnictwo ogólne lub szczególne;
   upowaznienie — upoważnienie / zgłoszenie uprawnień do e-Urzędu Skarbowego lub KSeF (np. ZAW-FA); wypowiedzenie — wypowiedzenie albo porozumienie o rozwiązaniu umowy; inne — wszystko inne.
2) „obejmuje”: zaznacz ksiegowosc, kadry, powierzenie — zgodnie z treścią. „powierzenie” zaznacz także wtedy, gdy umowa o usługi zawiera postanowienia o powierzeniu przetwarzania danych osobowych (paragraf lub załącznik), a nie tylko ogólną klauzulę informacyjną.
3) klienta: nazwę (firmę) dokładnie jak w dokumencie, NIP, numer KRS oraz osoby, które podpisały lub zostały wskazane jako reprezentujące klienta, z funkcją (np. prezes zarządu, prokurent, właściciel, pełnomocnik).
4) datę zawarcia (dla wypowiedzenia — datę pisma), od kiedy i do kiedy dokument obowiązuje (dla wypowiedzenia „obowiazuje_do” = dzień, w którym umowa się rozwiązuje), czy jest na czas nieokreślony, okres wypowiedzenia, zakres usług, wynagrodzenie, liczbę stron skanu.
5) podpisy: czy widać podpisy obu stron (własnoręczne albo informację o podpisie elektronicznym).

Zasady: niczego nie zgaduj. Jeśli czegoś nie widać — zostaw puste. NIP przepisz tylko wtedy, gdy jest czytelny w całości (10 cyfr). Nie wpisuj NIP biura jako NIP klienta. Gdy plik zawiera kilka różnych dokumentów albo nie da się ustalić klienta, napisz to w „uwagi” i ustaw pewność „niska”.`;
const TOO_BIG = "Plik jest za duży do automatycznego odczytu (ponad 24 MB) — zeskanuj w niższej rozdzielczości albo podziel na części.";

async function rozpoznaj(id: string, origin: string | null): Promise<Response> {
  const fail = async (msg: string) => { await db(`klienci_umowy?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "blad", uwagi: msg }) }); return json({ error: msg }, 200, origin); };
  try {
    const r = await db(`klienci_umowy?id=eq.${id}&select=*`);
    const row = r.ok ? (await r.json())[0] : null;
    if (!row) return json({ error: "Nie znaleziono dokumentu." }, 404, origin);
    // the path comes from a row the browser inserted: accept only "<row id>/<plain file name>" inside our bucket
    if (typeof row.path !== "string" || !/^[0-9a-f-]{36}\/[A-Za-z0-9_.\-]+$/i.test(row.path) || row.path.includes("..") || !row.path.startsWith(row.id + "/")) return await fail("Nieprawidłowa ścieżka pliku.");
    if (Number(row.rozmiar) > MAX_BYTES) return await fail(TOO_BIG);
    // one reading at a time per document (each one is a paid request)
    if (row.status === "analiza" && Date.now() - Date.parse(row.analiza_at ?? "") < 120000) return json({ error: "Ten dokument jest właśnie odczytywany." }, 200, origin);
    await db(`klienci_umowy?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "analiza", analiza_at: new Date().toISOString() }) });

    const f = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${row.path.split("/").map(enc).join("/")}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    if (!f.ok) return await fail("Nie udało się odczytać pliku z magazynu.");
    if (Number(f.headers.get("content-length") ?? 0) > MAX_BYTES) return await fail(TOO_BIG);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.length > MAX_BYTES) return await fail(TOO_BIG);
    // the type is decided by the file's own first bytes, not by what the browser declared
    const pdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!pdf && !png && !jpg) return await fail("To nie jest plik PDF, JPEG ani PNG.");
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const block = pdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: btoa(bin) } }
      : { type: "image", source: { type: "base64", media_type: png ? "image/png" : "image/jpeg", data: btoa(bin) } };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }], output_config: { format: { type: "json_schema", schema: SCHEMA } } }),
    });
    if (!res.ok) { console.error("model", res.status); return await fail("Odczyt nie powiódł się (" + res.status + ") — spróbuj ponownie albo przypisz ręcznie."); }
    const out = await res.json();
    const text = (out.content ?? []).find((b: Any) => b.type === "text")?.text;
    let a: Any;
    try { a = JSON.parse(text); } catch { return await fail("Odczyt zwrócił nieczytelną odpowiedź — spróbuj ponownie albo przypisz ręcznie."); }
    const kl = a.klient ?? {};
    if (digits(kl.nip) === BIURO_NIP) kl.nip = ""; // the office itself is never the client

    const [klienci, rej] = await Promise.all([all("klienci_baza?select=id,nip,nazwa&order=id"), all("klienci_rejestr?select=klient,krs,nazwa,fetched_at&order=fetched_at.desc")]);
    const ostatni = new Map<string, Any>();
    for (const x of rej) if (!ostatni.has(x.klient)) ostatni.set(x.klient, x);
    const kand = dopasuj(kl, klienci.map((k) => ({ ...k, krs: ostatni.get(k.id)?.krs, rej_nazwa: ostatni.get(k.id)?.nazwa }))).slice(0, 6);
    // the uploader may have said whose contract this is; a valid NIP of somebody else in the document overrules it
    const wskazany = okId(row.klient) && klienci.some((k) => k.id === row.klient) ? row.klient : null;
    const nipDok = digits(kl.nip);
    let pewny: string | null = pewnyKlient(kand, a.pewnosc);
    if (wskazany) pewny = nipOk(nipDok) && /^\d{10}$/.test(wskazany) && nipDok !== wskazany ? null : (a.pewnosc === "niska" ? null : wskazany);
    const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n) || null;
    const patch: Any = {
      status: pewny ? "przypisany" : "do_sprawdzenia", klient: pewny ?? wskazany,
      rodzaj: RODZAJE.includes(a.rodzaj) ? a.rodzaj : "inne", podtyp: s(a.podtyp, 80),
      obejmuje: [...new Set((Array.isArray(a.obejmuje) ? a.obejmuje : []).filter((x: Any) => ["ksiegowosc", "kadry", "powierzenie"].includes(x)))],
      data_zawarcia: isDate(a.data_zawarcia) ? a.data_zawarcia : null, kontrahent: s(kl.nazwa, 300), kontrahent_nip: nipDok.length === 10 ? nipDok : null, kontrahent_krs: digits(kl.krs).slice(0, 10) || null,
      reprezentanci: (Array.isArray(kl.reprezentanci) ? kl.reprezentanci : []).slice(0, 10).map((p: Any) => ({ imie_nazwisko: String(p.imie_nazwisko ?? "").slice(0, 120), funkcja: String(p.funkcja ?? "").slice(0, 120) })).filter((p: Any) => p.imie_nazwisko),
      obowiazuje_od: isDate(a.obowiazuje_od) ? a.obowiazuje_od : null, obowiazuje_do: isDate(a.obowiazuje_do) ? a.obowiazuje_do : null, bezterminowa: a.bezterminowa === true,
      wypowiedzenie: s(a.okres_wypowiedzenia, 300), zakres: s(a.zakres, 1000), wynagrodzenie: s(a.wynagrodzenie, 300),
      podpisy: ["obie_strony", "tylko_klient", "tylko_biuro", "brak", "nieczytelne"].includes(a.podpisy) ? a.podpisy : null, stron: Number(a.stron) > 0 ? Math.min(Number(a.stron), 5000) : null,
      uwagi: s(a.uwagi, 600),
      ai: { pewnosc: a.pewnosc, analiza: String(a.analiza ?? "").slice(0, 600), klient: { nazwa: s(kl.nazwa, 300), nip: nipDok || null, krs: digits(kl.krs) || null }, kandydaci: kand },
    };
    const up = await db(`klienci_umowy?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    if (!up.ok) return await fail("Nie udało się zapisać odczytu (" + up.status + ").");
    return json({ ok: true, status: patch.status }, 200, origin);
  } catch (e) {
    console.error("klienci-baza rozpoznaj", String((e as Error)?.message ?? e).slice(0, 200));
    return await fail("Błąd podczas odczytu — spróbuj ponownie.");
  }
}

// ---------------------------------------------------------------- everything the page shows
async function lista(ja: Ja) {
  const s = await sync(false);
  const [klienci, rej, odpisy] = await Promise.all([
    all("klienci_baza?select=*&order=nazwa"),
    all(`klienci_rejestr?select=${REJ_KOL}&order=fetched_at.desc`),
    all("portal_odpisy_cache?select=krs,fetched_at"),
  ]);
  const rejBy = new Map<string, Any[]>();
  for (const r of rej) { const l = rejBy.get(r.klient) ?? []; l.push(r); rejBy.set(r.klient, l); }
  const odpis = new Map<string, string>(odpisy.map((o) => [String(o.krs), String(o.fetched_at)]));
  let kontakty = new Map<string, Any>();
  if (ja.kadry) {
    try { kontakty = new Map((await loadKlienciRows()).map((k) => [klientId(k), { telefon: k.telefon, email: k.email, kontakt: k.kontakt, jezyk: k.jezyk }])); } catch { /* the list still shows without contact data */ }
  }
  let umowy: Any[] = [], historia: Any[] = [];
  if (ja.admin) [umowy, historia] = await Promise.all([all("klienci_umowy?select=*&order=created_at.desc"), all("klienci_status_historia?select=*&order=created_at.desc")]);
  const dzis = new Date().toISOString().slice(0, 10), teraz = Date.now();
  const out = klienci.map((k) => {
    const rs = rejBy.get(k.id) ?? [], r = rs[0] ?? null;
    const o: Any = {
      ...k, rej: r ? { ...r, odcisk: undefined } : null,
      rej_historia: rs.slice(1, 12).map((x) => ({ fetched_at: x.fetched_at, sprawdzono_at: x.sprawdzono_at, zmiany: x.zmiany, nazwa: x.nazwa })),
      ostrzezenia: ostrzezeniaRejestru(k, r, teraz),
      odpis: r?.krs && odpis.has(String(r.krs).padStart(10, "0")) ? odpis.get(String(r.krs).padStart(10, "0")) : null,
    };
    if (ja.kadry) o.kontakt = kontakty.get(k.id) ?? null;
    if (ja.admin) {
      o.audyt = audytKlienta(k, rs, umowy.filter((u) => u.klient === k.id && u.status === "przypisany"), dzis);
      o.historia = historia.filter((h) => h.klient === k.id);
    }
    return o;
  });
  return { ja: { email: ja.email, admin: ja.admin, kontakty: ja.kadry }, klienci: out, umowy: ja.admin ? umowy : undefined, cena: CENA_REJESTR_IO, dni: DNI_DOMYSLNIE, sync: s };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const ja = await portal(req);
  if (!ja) return json({ error: "Brak dostępu (portal)." }, 403, origin);
  let body: Any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }
  const action = String(body?.action ?? "");
  const tylkoAdmin = () => json({ error: "Tę czynność może wykonać tylko administrator portalu." }, 403, origin);

  try {
    if (action === "lista") return json(await lista(ja), 200, origin);
    if (action === "sync") return json(await sync(true), 200, origin);

    if (action === "rejestr") {
      if (!ja.admin) return tylkoAdmin();
      if (!okId(body.id)) return json({ error: "Nieprawidłowy identyfikator klienta." }, 400, origin);
      const k = (await all(`klienci_baza?id=eq.${enc(body.id)}&select=*`))[0];
      if (!k) return json({ error: "Nie ma takiego klienta." }, 404, origin);
      // every reading is paid: not more often than once a minute per client
      if (k.rejestr_at && Date.now() - Date.parse(k.rejestr_at) < 60000) return json({ error: "Dane tego klienta były pobierane przed chwilą — spróbuj za minutę." }, 429, origin);
      // fresh: false takes what our own base of firms already holds, whatever its age (no paid request for the KRS chapter)
      return json(await odswiez(k, body.fresh !== false, body.fresh === false ? 36500 : 0), 200, origin);
    }

    if (action === "rejestr_wszystkie") {
      if (!ja.admin) return tylkoAdmin();
      const dni = Math.max(1, Math.min(365, Math.round(Number(body.dni) || DNI_DOMYSLNIE)));
      const [klienci, rej, cache] = await Promise.all([all("klienci_baza?select=*&order=nazwa"), all("klienci_rejestr?select=klient,sprawdzono_at&order=sprawdzono_at.desc"), all("portal_firmy_cache?select=nip,fetched_at")]);
      const ost = new Map<string, string>();
      for (const r of rej) if (!ost.has(r.klient)) ost.set(r.klient, r.sprawdzono_at);
      const plan = planOdswiezenia(klienci.map((k) => ({ ...k, rej_at: ost.get(k.id) ?? null })), Object.fromEntries(cache.map((c) => [c.nip, c.fetched_at])), dni, Date.now(), body.z_zakonczonymi === true);
      const podsumowanie = { firm: plan.pozycje.length, krs_firm: plan.krs_firm, gus_firm: plan.gus_firm, zapytan_rejestr_io: plan.zapytan_rejestr_io, zapytan_gus: plan.zapytan_gus, koszt_zl: plan.koszt_zl, cena: CENA_REJESTR_IO, pominiete: plan.pominiete, dni, na_raz: MAX_NA_RAZ };
      if (body.dry !== false) return json({ dry: true, ...podsumowanie }, 200, origin);
      const byId = new Map(klienci.map((k) => [k.id, k]));
      const zrobione: Any[] = [];
      for (const p of plan.pozycje.slice(0, MAX_NA_RAZ)) {
        const w = await odswiez(byId.get(p.id), false, dni);
        zrobione.push({ id: p.id, nazwa: p.nazwa, ...w });
      }
      return json({ dry: false, zrobione, pozostalo: Math.max(0, plan.pozycje.length - zrobione.length), ...podsumowanie }, 200, origin);
    }

    if (action === "status") {
      if (!ja.admin) return tylkoAdmin();
      if (!okId(body.id)) return json({ error: "Nieprawidłowy identyfikator klienta." }, 400, origin);
      if (!["obslugiwany", "wstrzymany", "zakonczony"].includes(body.status)) return json({ error: "Nieznany status." }, 400, origin);
      const data = (v: unknown) => (v == null || v === "" ? null : isDate(v) && v >= "1990-01-01" && v <= "2100-12-31" ? v : undefined);
      const koniec = data(body.koniec_od), od = data(body.obsluga_od);
      if (koniec === undefined || od === undefined) return json({ error: "Nieprawidłowa data." }, 400, origin);
      if (body.status === "zakonczony" && !koniec) return json({ error: "Podaj dzień, od którego obsługa jest zakończona." }, 400, origin);
      if (body.status === "zakonczony" && od && koniec! < od) return json({ error: "Koniec obsługi nie może być wcześniejszy niż jej początek." }, 400, origin);
      const r = await db("rpc/klienci_ustaw_status", { method: "POST", body: JSON.stringify({ p_id: body.id, p_status: body.status, p_obsluga_od: od, p_koniec_od: koniec, p_powod: String(body.powod ?? "").trim().slice(0, 1000), p_kto: ja.email }) });
      if (!r.ok) { const t = await r.text(); return json({ error: t.includes("nie ma takiego klienta") ? "Nie ma takiego klienta." : "Nie udało się zapisać statusu." }, t.includes("nie ma takiego") ? 404 : 500, origin); }
      return json({ ok: true, klient: await r.json() }, 200, origin);
    }

    if (action === "rozpoznaj") {
      if (!ja.admin) return tylkoAdmin();
      if (!ANTHROPIC_KEY) return json({ error: "Brak konfiguracji odczytu dokumentów." }, 500, origin);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id ?? "")) return json({ error: "Nieprawidłowy identyfikator dokumentu." }, 400, origin);
      return await rozpoznaj(body.id, origin);
    }

    if (action === "braki_csv") {
      if (!ja.admin) return tylkoAdmin();
      const l = await lista(ja);
      return json({ csv: csvBraki(l.klienci.filter((k: Any) => k.status !== "zakonczony").map((k: Any) => ({ k, a: k.audyt }))) }, 200, origin);
    }
    return json({ error: "Nieznana akcja." }, 400, origin);
  } catch (e) {
    console.error("klienci-baza", action, String((e as Error)?.message ?? e).slice(0, 200));
    return json({ error: "Błąd serwera — spróbuj ponownie." }, 500, origin);
  }
});
