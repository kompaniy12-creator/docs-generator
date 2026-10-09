// Podpisy elektroniczne — signing of employment documents between the employer and the worker.
//
// The signing happens OUTSIDE the portal: a party downloads the PDF, signs it with a qualified
// signature in its own software, with podpis zaufany on podpis.gov.pl, or by hand on a printout,
// and brings the result back. The portal issues the files, collects them, checks what the bytes
// can tell, and an HR officer confirms every signature by hand (validates the file on
// podpis.gov.pl and clicks "zweryfikowano"). Nothing is sent to anybody by this function.
//
// ============================== API CONTRACT ==============================
// POST only. JSON body { action, ... } — or multipart/form-data (same fields as strings +
// the file in the field `plik`) for the actions marked [multipart].
// Answers: 200 { ... } | 4xx/5xx { error: "<Polish text for the user>", kod?: "<machine code>" }.
// Who is calling is decided by the headers, in this order:
//   x-podpis-token: <token from the worker's link>          -> worker
//   x-klient-token: <client session of the `klient` function> -> employer (only its own NIPs)
//   Authorization: Bearer <portal JWT, section kadry>         -> office
//
// ---- everyone ----
//   reguly                      -> { rodzaje, metody, podpisuje, macierz[], ostrzezenia, potwierdzenia, stwierdzono,
//                                    potwierdzenia_weryfikacji, powod_rodzaj, max_mb, max_mb_link: 15, formaty }
//                                  max_mb is the caller's own upload limit: 15 with x-podpis-token, otherwise 24
//                                  macierz row: { rodzaj, cudzoziemiec, pracodawca[], pracownik[], pracownik_po_kwalifikowanym[],
//                                  podstawa, podpisuje_domyslnie, podpisuje_wymuszone } — podpisuje_wymuszone: "potwierdzenie"
//                                  for informational kinds (receipt only), "pracodawca" for kinds the employer signs alone
//                                  (świadectwo pracy, skierowanie na badania, kara porządkowa), else null; dokument_dodaj
//                                  overrides whatever `podpisuje` was sent with it
//   The caller is established from the headers BEFORE the body is read: without a valid token /
//   session only a JSON body up to 10 KB is accepted (`reguly`). Uploads must carry Content-Length
//   (411 kod "dlugosc") and are refused above the cap before reading (413 kod "rozmiar"):
//   24 MB for the office and the employer, 15 MB for the worker's link. A body that is not a
//   JSON object -> 400.
//
// ---- shapes ----
//   Pakiet   { id, created_at, firma, nip, worker_name, typ: "praca"|"zlecenie", cudzoziemiec, bez_pesel,
//              status, status_nazwa, wydano_at, zakonczono_at, anulowano_at, dokumenty: Dokument[] }
//            status: szkic | u_pracodawcy | u_pracownika | weryfikacja | gotowy | zakonczony | anulowany
//            office also gets: created_by, zgloszenie_id, uwagi, anulowano_by, anulowano_powod,
//            zakonczono_by, link: { wazny_do, utworzono, przez, aktywny } | null
//            worker also gets: link_wazny_do
//   Dokument { id, lp, tytul, rodzaj, rodzaj_nazwa, podpisuje: "obie"|"pracodawca"|"pracownik"|"potwierdzenie",
//              podpisuje_nazwa, status, status_nazwa,
//              zadanie,            what the CALLER should do now: "podpisz" | "potwierdz_odbior" |
//                                  "czeka_na_pracodawce" | "czeka_na_weryfikacje" | "nic"
//              wydany: { nazwa, rozmiar, sha256 },
//              pracodawca: Krok, pracownik: Krok, odbior_at,
//              reguly: { pracodawca: Regula, pracownik: Regula },
//              pliki: ("wydany"|"pracodawca"|"pracownik")[]   files the caller may download now
//              do_podpisu: "wydany"|"pracodawca"             the file an electronic signature goes on
//              finalne: (...)[]                               the signed document, once it is ready }
//            status: u_pracodawcy | weryfikacja_pracodawcy | u_pracownika | weryfikacja_pracownika |
//                    gotowy | w_aktach | anulowany
//   Krok     { status: nie_dotyczy|oczekuje|wgrany|zweryfikowany|odrzucony, metoda, metoda_nazwa, at,
//              wgral, wiazanie: "prefiks"|"wzrokowa"|"pominiete", baza, rewizje, sha256, rozmiar, mime,
//              ostrzezenie: { wersja, at } | null, zweryfikowano_at, odrzucenie }
//            wiazanie "prefiks" means only: the upload CONTAINS the issued file as its first bytes and
//            ends with a signature dictionary covering the whole upload; `rewizje` revisions were
//            appended — what they changed on the page is for a person to check. Never show it as
//            "the same document".
//            odrzucenie is given only to the office and to the side that has to bring a new file
//            (the employer sees the worker step's reason only when the employer uploaded that scan).
//            wgral on the worker's step = "pracodawca" | "biuro" when somebody uploaded in the worker's name.
//   Regula   { podstawa, metody: [{ id: "kwalifikowany"|"zaufany"|"odreczny", nazwa, uwaga,
//              ostrzezenie: { wersja, tekst, potwierdzenie } | null }] }
//            A method with `ostrzezenie` may be used only after the signer has been shown `tekst`
//            in full and ticked a box labelled with `potwierdzenie`; then send potwierdzam=true
//            and ostrzezenie_wersja=<wersja>. Show the text exactly as given.
//
// ---- worker (x-podpis-token) ----
//   podglad                                   -> { pakiet: Pakiet }
//   plik    { dokument, ktory? }              -> { url, nazwa, sha256, wazny_s }   ktory: do_podpisu (default) |
//                                                wydany | pracodawca | pracownik; the link lives 120 s
//   wgraj   [multipart] { dokument, metoda, potwierdzam?, ostrzezenie_wersja?, plik }
//                                             -> { ok, sha256, wiazanie, baza, rewizje, weryfikacja }
//   odbior  { dokument, potwierdzam: true }   -> { ok, odbior_at }    informacja o warunkach zatrudnienia;
//                                                only after the file was downloaded (kod "pobierz")
//   errors: 401 kod "link" (wrong / expired / withdrawn — one answer), 429 kod "limit"
//
// ---- employer (x-klient-token) ----
//   lista   { nip? }                          -> { pakiety: Pakiet[] }   never drafts, only own NIPs
//   plik    { dokument, ktory? }              -> as above
//   wgraj   [multipart] { dokument, strona?: "pracodawca" (default) | "pracownik", metoda,
//                         potwierdzam?, ostrzezenie_wersja?, plik }
//           strona "pracownik" = a scan of the document the worker signed by hand (metoda must be
//           "odreczny"); allowed once the employer's own signature is verified
//           — only into an empty or rejected worker step, or over a scan the employer itself uploaded;
//           a file the worker (or the office) brought and that waits for verification cannot be
//           replaced by the employer (409 kod "krok")
//   errors: 401 { wyloguj: true } (session unknown / expired), 403 { ustaw_haslo: true }, 404 for another
//           firm's document. NOTE: a request WITHOUT the x-klient-token header is treated as an office
//           call and answers plain 403 { error } — no `wyloguj` flag.
//
// ---- office (Authorization: Bearer <portal JWT>) ----
//   lista   { status? }                       -> { pakiety: Pakiet[] }
//   pakiet  { id }                            -> { pakiet, log: LogRow[] }
//   utworz  { zgloszenie_id, cudzoziemiec: bool, typ?, bez_pesel?, uwagi? }   worker, firm and NIP are
//           taken from the submission — or, without a submission:
//           { nip, firma, worker_name, typ, cudzoziemiec, bez_pesel?, uwagi? }  -> { ok, pakiet } (status szkic)
//   dokument_dodaj [multipart] { pakiet, rodzaj, tytul, podpisuje?, czesc?, plik (PDF) } -> { ok, dokument }
//   dokument_usun  { dokument }               drafts only
//   wydaj   { id }                            opens the employer's step            -> { ok, pakiet }
//   weryfikuj { dokument, strona, ok: true, sha256, stwierdzono, potwierdzenia: { tresc, waznosc?, pracodawca? },
//               raport?: { zrodlo?, podpisujacy?, uwagi? } }
//           sha256      — of the file the officer downloaded and checked; must equal the stored one and the
//                         step must still be "wgrany", else 409 kod "zmieniony" (the update is conditional)
//           stwierdzono — the kind of signature per the validator: kwalifikowany | zaufany | osobisty |
//                         odreczny; when it differs from the declared method -> 409 kod "rodzaj" (+ powod):
//                         the file must be rejected so the party re-uploads through the right path
//           potwierdzenia — all the ticks required for this file (400 kod "potwierdzenia" + brakuje[]):
//                         tresc always; waznosc for electronic signatures; pracodawca when the worker
//                         signed on top of the employer's file. Stored in the trail with their texts.
//           -> { ok, ten_sam }   ten_sam: the same officer uploaded this file and verified it (recorded,
//                         shown in the office's list, noted in the Akta entry)
//   weryfikuj { dokument, strona, ok: false, powod, sha256?, stwierdzono? }   rejection reopens that side's step
//   wgraj   [multipart] { dokument, strona, metoda, pomin_wiazanie?, plik }   a file the office received
//           outside the portal; never for a method that carries a warning
//   plik    { dokument, ktory }               -> { url, ... }
//   link    { id, dni? }                      -> { ok, url, wazny_do, wiadomosc }   a NEW link each time; 7 days
//           by default (1–30); the link of a closed package stops working 14 days after closing
//           (only its hash is kept, so an old link cannot be shown again; the old one stops working)
//   link_uniewaznij { id }
//   anuluj  { id, powod }
//   zakoncz { id }                            files the signed documents into Akta osobowe -> { ok, plikow, przypisane }
//
// ---- upload checks (kod; HTTP 400 unless said otherwise) ----
//   metoda (400 unknown / missing method; 403 the employer sending for the worker anything but
//   "odreczny"), plik (400 no file part), zapis (502 storage refused the file — retry),
//   rozmiar (always HTTP 413), bez_podpisu has two texts: "no signature in the file" and
//   "the signature does not cover the whole file / is not properly embedded" (same kod).
//   pusty, rozmiar (24 MB; 15 MB by link), typ (PDF / JPG / PNG by magic bytes only), niezgodny (content differs
//   from the declared type), pdf (electronic signature needs a PDF), bez_podpisu (no signature
//   dictionary in the appended part, or its last /ByteRange does not start after the issued bytes
//   and reach the end of the file), nie_nasz (the issued file is not a byte prefix of the
//   upload), niepodpisany (the very file we issued), metoda_niedozwolona (+ reguly),
//   ostrzezenie (409, + ostrzezenie { wersja, tekst, potwierdzenie }), ostrzezenie_osobiscie,
//   kolejnosc (the employer signs first), krok, zamkniety, limit (429 — checked first: per hour
//   and per day), dlugosc (411). A file replaced before it was verified is deleted from the bucket.
//   Detached signatures (XAdES / ASiC / .sig) are out of scope in this version.
// ==========================================================================

import { handle, type Auth, type Store } from "./core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP = "https://docgenerator.td-group.pl/";
const BUCKET = "podpisy", AKTA = "akta-osobowe";

// deno-lint-ignore no-explicit-any
type Any = any;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...H, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
async function rows(path: string): Promise<Any[]> { const r = await db(path); if (!r.ok) throw new Error(`db ${r.status} ${path.split("?")[0]}`); return await r.json(); }
async function write(path: string, method: string, body?: unknown): Promise<Any[]> {
  const r = await db(path, { method, headers: { Prefer: "return=representation" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`db ${method} ${r.status} ${path.split("?")[0]} ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}
async function count(path: string): Promise<number> {
  const r = await db(path, { method: "HEAD", headers: { Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" } });
  if (!r.ok && r.status !== 206 && r.status !== 416) throw new Error(`db count ${r.status}`);
  return Number((r.headers.get("content-range") ?? "").split("/")[1]) || 0;
}
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const store: Store = {
  async pakiet(id) { return (await rows(`podpisy_pakiety?id=eq.${id}&select=*`))[0] ?? null; },
  async pakietByLink(hash) { return (await rows(`podpisy_pakiety?link_hash=eq.${hash}&select=*`))[0] ?? null; },
  async pakiety(f) {
    const q = [f.nip ? `nip=in.(${f.nip.filter((n) => /^\d{10}$/.test(n)).join(",")})` : "", f.status ? `status=eq.${f.status}` : ""].filter(Boolean).join("&");
    return await rows(`podpisy_pakiety?select=*&order=created_at.desc&limit=500${q ? "&" + q : ""}`);
  },
  async pakietInsert(row) { return (await write("podpisy_pakiety", "POST", row))[0]; },
  async pakietPatch(id, patch) { await write(`podpisy_pakiety?id=eq.${id}`, "PATCH", patch); },
  async dokumenty(ids) {
    const out: Any[] = [];
    for (let i = 0; i < ids.length; i += 100) out.push(...await rows(`podpisy_dokumenty?pakiet_id=in.(${ids.slice(i, i + 100).join(",")})&select=*&order=lp.asc&limit=5000`));
    return out;
  },
  async dokument(id) { return (await rows(`podpisy_dokumenty?id=eq.${id}&select=*`))[0] ?? null; },
  async dokInsert(row) { return (await write("podpisy_dokumenty", "POST", row))[0]; },
  async dokPatch(id, patch) { await write(`podpisy_dokumenty?id=eq.${id}`, "PATCH", patch); },
  async dokPatchIf(id, cond, patch) {
    const q = Object.keys(cond).map((k) => `${k}=eq.${encodeURIComponent(cond[k])}`).join("&");
    return (await write(`podpisy_dokumenty?id=eq.${id}&${q}`, "PATCH", patch)).length > 0;
  },
  async dokDelete(id) { await write(`podpisy_dokumenty?id=eq.${id}`, "DELETE"); },
  async log(row) { await write("podpisy_log", "POST", row); },
  async logi(pakietId) { return await rows(`podpisy_log?pakiet_id=eq.${pakietId}&select=id,at,dokument_id,strona,kto,akcja,wynik,ip,sha256,info&order=id.asc&limit=1000`); },
  async logCount(f) {
    return await count(`podpisy_log?select=id&pakiet_id=eq.${f.pakiet_id}&akcja=eq.${f.akcja}&strona=eq.${f.strona}&at=gte.${encodeURIComponent(f.od)}${f.dokument_id ? `&dokument_id=eq.${f.dokument_id}` : ""}`);
  },
  async proby(ip, od) { return await count(`podpisy_proby?select=id&ip=eq.${encodeURIComponent(ip)}&at=gte.${encodeURIComponent(od)}`); },
  async probaAdd(ip) {
    await write("podpisy_proby", "POST", { ip });
    await db(`podpisy_proby?at=lt.${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}`, { method: "DELETE" }).catch(() => undefined);
  },
  async filePut(path, bytes, mime) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${enc(path)}`, { method: "POST", headers: { ...H, "Content-Type": mime, "x-upsert": "false" }, body: bytes as BodyInit });
    if (!r.ok) console.error("storage put", r.status, (await r.text()).slice(0, 200));
    return r.ok;
  },
  async fileGet(path) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${enc(path)}`, { headers: H });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  },
  async fileDel(paths) {
    if (!paths.length) return;
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
  },
  // always an attachment, never rendered from our origin
  async fileUrl(path, nazwa, sec) {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${enc(path)}`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: sec }) });
    const j = r.ok ? await r.json() : null;
    return j?.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}&download=${encodeURIComponent(nazwa)}` : null;
  },
  async zgloszenie(id) { return (await rows(`zatrudnienie_zgloszenia?id=eq.${id}&select=id,worker_name,status,payload`))[0] ?? null; },
  async aktaInsert(row, bytes) {
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${AKTA}/${enc(row.path)}`, { method: "POST", headers: { ...H, "Content-Type": row.mime, "x-upsert": "true" }, body: bytes as BodyInit });
    if (!up.ok) { console.error("akta put", up.status, (await up.text()).slice(0, 200)); return false; }
    // the row id is derived from the document and the file role: a repeated closing (retry, double
    // click) finds the row already there and leaves it alone
    const ins = await db("akta_dokumenty?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(row) });
    if (!ins.ok) { console.error("akta row", ins.status, (await ins.text()).slice(0, 200)); return false; }
    return true;
  },
};

const auth: Auth = {
  // portal user with the Kadry section (as in the `akta` function)
  async staff(req) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token || token === ANON) return null;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    const m = u?.app_metadata ?? {};
    const kadry = m.portal_admin === true || !Array.isArray(m.portal_sections) || m.portal_sections.includes("kadry");
    return m.portal === true && kadry && u.email ? String(u.email) : null;
  },
  // the client session of the `klient` function: client accounts are not Supabase auth users,
  // the token is looked up by its hash and everything is then filtered by the account's NIPs
  async klient(req) {
    const token = req.headers.get("x-klient-token") ?? "";
    if (token.length < 20) return null;
    const r = await db(`klient_sesje?token_hash=eq.${await sha256(token)}&rodzaj=eq.sesja&select=expires_at,klient_konta(id,email,nip,aktywny,haslo_hash)`);
    const row = r.ok ? (await r.json())[0] : null;
    if (!row || Date.parse(row.expires_at) < Date.now()) return null;
    const k = row.klient_konta;
    return k && k.aktywny ? { email: String(k.email), nip: (k.nip ?? []).map(String), haslo: !!k.haslo_hash } : null;
  },
};

Deno.serve((req) => handle(req, { store, auth, app: APP }));
