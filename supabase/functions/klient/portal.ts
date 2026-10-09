// Client profile, stage 2: what a signed-in client sees and may do beyond the first version.
// Pure logic over a Store (store.ts talks to the database; tests and the local harness use a
// store in memory). index.ts has already checked the session and the password gate before any of
// this runs; every action here checks the firm (NIP) against the account again and never trusts
// an id from the browser: a row is read first and must belong to that NIP — otherwise 404.
//
// Client (x-klient-token), every action takes { nip }:
//   start             what needs attention now, scope of service, the office's contact persons
//   pracownicy        workers of the firm (employed / in progress / ended) with deadlines
//   pracownik         { id }             one worker: data the employer has, PESEL / document number /
//                                        bank account masked; documents available to the employer
//   pracownik_pokaz   { id, pole }       unmask one field (pesel | dokument | konto) — logged
//   dokumenty         documents issued for the firm (history, contracts and scans the office shared)
//   pobierz           { zrodlo, id, n? } short-lived download link — logged
//                                        zrodlo: komplet | historia | akta | umowa | zgloszenie
//   ksiegi            accounting: caretaker, accounts, monthly closing, invoices
//   zgloszenia        the firm's requests to the office with status and reply
//   zgloszenie_nowe   { kategoria, rodzaj?, temat, tresc, worker_id? } + files (multipart `plik`)
//   firma             the firm's data as the office has it, register data, accounts with access
// Office (portal JWT):
//   biuro_zgloszenia  { nip?, status? }             requests of clients (by the caller's sections)
//   biuro_zgloszenie  { id, status?, odpowiedz? }   set the status / the short reply shown to the client
//   biuro_zalacznik   { id, n }                     download link to an attachment
//   biuro_udostepnij  { zrodlo: akta|umowa, id, udostepnij }   share / unshare a document with the client
//   biuro_udostepnione { zrodlo, ids[] }            which of these documents are shared
//   biuro_podglad     { nip, akcja: {...} }         administrator: a read-only action as the client sees it

// deno-lint-ignore no-explicit-any
type Any = any;
export type Konto = { id: string; email: string; nip: string[]; nazwa: string | null };
export type Staff = { email: string; admin: boolean; sekcje: string[] | null }; // sekcje null = every section
export type Odp = { status: number; body: Any };
export type Plik = { nazwa: string; typ: string; bytes: Uint8Array };
export type Zalacznik = { n: number; nazwa: string; mime: string; rozmiar: number; path: string; sha256: string };
export type Flaga = "akta" | "umowa";

export interface Store {
  klient(nip: string): Promise<{ dane: Any | null; baza: Any | null }>;
  workers(nip: string): Promise<Any[]>; // only submissions the office has checked (see WIDOCZNE)
  noweIle(nip: string): Promise<number>; // unchecked submissions: a number, never their content
  worker(id: string): Promise<Any | null>;
  onboarding(nip: string): Promise<Any | null>;
  podpisy(nip: string): Promise<Any[]>; // [{ id, zgloszenie_id, status, dokumenty: [{ id, tytul, status, podpisuje, pd_status }] }]
  logins(kontoId: string): Promise<string[]>; // newest first
  log(konto: { id?: string; email?: string } | null, akcja: string, info?: unknown): Promise<void>;
  countLog(kontoId: string, akcja: string, since: string): Promise<number>;
  aktaShared(nip: string): Promise<Any[]>;
  aktaDoc(id: string): Promise<Any | null>; // { id, nip, status, path, nazwa, shared }
  umowyShared(klientId: string): Promise<Any[]>;
  umowa(id: string): Promise<Any | null>; // { id, klient, status, path, nazwa, shared }
  historia(nip: string, typy: string[]): Promise<Any[]>;
  historiaDoc(id: string): Promise<Any | null>; // { id, doc_type, filename, pdf_path, nip, znip }
  zamkniecia(nip: string): Promise<Any[]>;
  invoicesSync(): Promise<string | null>;
  invoices(nip: string, from: string): Promise<Any[]>;
  rejestr(klientId: string): Promise<Any | null>;
  konta(nip: string): Promise<Any[]>;
  zgloszenia(nip: string): Promise<Any[]>;
  zgloszenie(id: string): Promise<Any | null>;
  zgloszeniaOd(kontoId: string, since: string): Promise<number>;
  zgloszenieInsert(row: Any): Promise<boolean>;
  zgloszeniePatch(id: string, patch: Any): Promise<void>;
  zgloszeniaBiuro(f: { nip?: string; status?: string; kategorie: string[] }): Promise<Any[]>;
  upload(bucket: string, path: string, bytes: Uint8Array, mime: string): Promise<boolean>;
  usun(bucket: string, paths: string[]): Promise<void>;
  sign(bucket: string, path: string, sekundy: number, nazwa: string): Promise<string | null>;
  assignee(dzial: "kadry" | "ksiegowosc", alias: string): Promise<string | null>;
  zadanieInsert(spec: Any): Promise<{ id: string } | null>;
  zadaniaStatus(ids: string[]): Promise<Record<string, string>>;
  flagSet(zrodlo: Flaga, id: string, on: boolean, kto: string): Promise<boolean>;
  flags(zrodlo: Flaga, ids: string[]): Promise<string[]>;
  obiektFlagi(zrodlo: Flaga, id: string): Promise<boolean>; // does the document exist
  // the client's own link to the office's Telegram bot (module komunikacja); utworz=false only reads an existing one
  telegramLink(klientId: string, kto: string, utworz: boolean): Promise<string | null>;
}
export type Deps = { store: Store; now: () => number };

// ---------------------------------------------------------------- limits and constants
export const MAX_PLIK = 15 * 1024 * 1024, MAX_PLIKOW = 3;
export const MAX_BODY = MAX_PLIKOW * MAX_PLIK + 64 * 1024;
const ZGL_NA_DOBE = 10, ZGL_NA_10MIN = 3, ODKRYC_NA_H = 40, POBRAN_NA_H = 120;
const BUCKET_ZGL = "klient-zgloszenia";
// the office itself — never a private phone or address of a member of staff
export const BIURO = { nazwa: "TD Consulting Group", telefon: "61 600 68 28", email_kadry: "kadry@td-group.pl", email_ksiegowosc: "ksiegowosc@td-group.pl" };
// documents from the history of generated documents a client may see: the firm's own papers.
// Not here on purpose: pełnomocnictwo and e-Urząd (they carry the PESEL of the proxy), rejestracja S24.
export const HIST_TYPY: Record<string, string> = {
  "umowa-zlecenie": "Komplet dokumentów do umowy", "wynagrodzenie": "Uchwała o wynagrodzeniu",
  "zalacznik-pobyt": "Załącznik nr 1 do wniosku o pobyt", "nip-8": "NIP-8",
};
const UMOWA: Record<string, string> = { praca: "umowa o pracę", zlecenie: "umowa zlecenie" };
const ETAP: Record<string, string> = { sprawdzone: "sprawdzone — przygotowujemy dokumenty", wyslane: "dokumenty wysłane do podpisu" };
const KATEGORIE = ["kadry", "ksiegowosc", "inne"], RODZAJE = ["pytanie", "zmiana_pracownika", "dane_firmy", "dokumenty_ksiegowe"], STATUSY = ["przyjete", "w_toku", "zalatwione"];
const POLA: Record<string, string> = { pesel: "p_pesel", dokument: "p_dowod", konto: "p_konto" };
const TERMINY: [string, string, string][] = [
  ["umowa", "u_do", "u_bezterminowo"], ["karta_pobytu", "p_karta_do", "p_karta_bezterm"], ["zezwolenie", "p_zezwolenie_do", "p_zezwolenie_bezterm"],
  ["paszport", "p_paszport_do", "p_paszport_bezterm"], ["badania", "p_badania_do", "p_badania_bezterm"],
];

const uuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const odp = (status: number, body: Any): Odp => ({ status, body });
const brak = (co = "Dokument nie jest dostępny.") => odp(404, { error: co });
export function dzisWarszawa(now: number): string { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date(now)); }
function dni(dzis: string, data: string): number { return Math.round((Date.parse(data + "T00:00:00Z") - Date.parse(dzis + "T00:00:00Z")) / 86400000); }
export function jezykOf(v: unknown): "pl" | "ru" | "uk" {
  const s = String(v ?? "").toLowerCase();
  return /^(uk|ua)|ukrain|україн/.test(s) ? "uk" : /^ru|russ|рус|ros/.test(s) ? "ru" : "pl";
}
// scope of service: no accounting caretaker — no accounting; no HR officer — no HR (the clients base decides)
export function zakresOf(kl: { dane: Any | null; baza: Any | null }): { kadry: boolean; ksiegowosc: boolean } {
  const z = kl.baza ?? kl.dane;
  if (!z) return { kadry: true, ksiegowosc: true }; // a firm missing from the clients base: nothing to decide by
  return { kadry: String(z.kadrowy ?? "").trim() !== "", ksiegowosc: String(z.opiekun ?? "").trim() !== "" };
}
function mod97(num: string) { let r = 0; for (const c of num) r = (r * 10 + Number(c)) % 97; return r; }
// tax micro-account: LK + 10100071 + 222 + 2 + NIP + 00 (structure published by the Ministry of Finance)
export function mikrorachunek(nip: string) { const body = `101000712222${nip}00`; return String(98 - mod97(body + "252100")).padStart(2, "0") + body; }

// ---------------------------------------------------------------- files
export function rodzajPliku(b: Uint8Array): "pdf" | "jpeg" | "png" | "" {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  return "";
}
const MIME = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png" }, EXT = { pdf: "pdf", jpeg: "jpg", png: "png" };
// what the bytes are decides; a declared type that says something else is refused
export function sprawdzPlik(p: Plik): { ok: true; rodzaj: "pdf" | "jpeg" | "png" } | { ok: false; kod: string; error: string } {
  if (!p.bytes.length) return { ok: false, kod: "pusty", error: `Plik „${p.nazwa}” jest pusty.` };
  if (p.bytes.length > MAX_PLIK) return { ok: false, kod: "rozmiar", error: `Plik „${p.nazwa}” jest za duży — najwyżej 15 MB.` };
  const r = rodzajPliku(p.bytes);
  if (!r) return { ok: false, kod: "typ", error: `Plik „${p.nazwa}”: dozwolone są tylko pliki PDF, JPG i PNG.` };
  const t = p.typ.toLowerCase().split(";")[0].trim();
  const decl = !t || t === "application/octet-stream" ? "" : t === "application/pdf" ? "pdf" : /^image\/p?jpe?g$/.test(t) ? "jpeg" : t === "image/png" ? "png" : "inny";
  if (decl === "inny") return { ok: false, kod: "typ", error: `Plik „${p.nazwa}”: dozwolone są tylko pliki PDF, JPG i PNG.` };
  if (decl && decl !== r) return { ok: false, kod: "niezgodny", error: `Plik „${p.nazwa}”: zawartość nie odpowiada typowi pliku.` };
  return { ok: true, rodzaj: r };
}
async function sha256hex(b: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", b as BufferSource);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const nazwaPliku = (s: string) => txt(s, 200).replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").slice(-120) || "plik";

// ---------------------------------------------------------------- workers
function terminy(p: Any) {
  const out: Record<string, { data: string | null; bezterminowo: boolean }> = {};
  for (const [k, d, b] of TERMINY) out[k] = { data: isDate(p[d]) ? p[d] : null, bezterminowo: p[b] === true };
  return out;
}
const statusPrac = (s: string) => s === "zatrudniony" ? "zatrudniony" : s === "archiwum" ? "zakonczony" : "w_trakcie";
function wiersz(w: Any) {
  const p = w.payload ?? {};
  return {
    id: w.id, imie_nazwisko: w.worker_name ?? "", status: statusPrac(w.status), etap: ETAP[w.status] ?? null,
    stanowisko: p.u_stanowisko ?? "", umowa: UMOWA[p.u_typ] ?? p.u_umowa ?? "", od: isDate(p.u_od) ? p.u_od : null,
    obywatelstwo: p.p_obywatelstwo ?? "", zgloszono: w.created_at ?? null, terminy: terminy(p),
  };
}
// The NIP of a submission is typed by whoever fills in the public employment form, so a submission
// belongs to a firm only once the office has checked it: an unchecked one ("nowe") could be planted
// by anybody, or carry a real person's data under a mistyped NIP. Until then the client sees only
// how many submissions wait for the office — no name, no data, nothing to unmask or download.
export const WIDOCZNE = ["sprawdzone", "wyslane", "zatrudniony", "archiwum"];
const nalezy = (w: Any, nip: string) => !!w && WIDOCZNE.includes(w.status) && digits(w.payload?.z_nip) === nip;
// a path inside the bucket of generated documents, exactly as history.js builds it — the value sits in
// a JSON field staff can edit, so it is never passed to Storage unchecked
export const okSciezka = (p: unknown): p is string => typeof p === "string" && !p.includes("..") && /^[a-z0-9-]+\/\d{4}-\d{2}-\d{2}\/[\w.-]+\.(pdf|zip)$/i.test(p);
const kompletDostepny = (w: Any) => okSciezka(w.payload?.komplet?.path) && ["wyslane", "zatrudniony", "archiwum"].includes(w.status);
const pakietWidoczny = (p: Any) => p.status !== "szkic";
function doPodpisu(pak: Any[]): number {
  let n = 0;
  for (const p of pak) {
    if (["szkic", "zakonczony", "anulowany"].includes(p.status)) continue;
    for (const d of p.dokumenty ?? []) if (d.status === "u_pracodawcy" && ["oczekuje", "odrzucony"].includes(d.pd_status)) n++;
  }
  return n;
}
function adres(p: Any, pre: string): string {
  const ul = [p[pre + "ulica"], [p[pre + "nrdom"], p[pre + "nrmiesz"]].filter(Boolean).join("/")].filter(Boolean).join(" ");
  return [ul, [p[pre + "kod"], p[pre + "miejscowosc"]].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------- requests
function statusZgl(z: Any, zad: Record<string, string>): string {
  if (z.status_reczny) return z.status;
  const s = z.zadanie_id ? zad[z.zadanie_id] : null;
  return s === "zrobione" ? "zalatwione" : s === "w_toku" ? "w_toku" : z.status;
}
function zglDlaKlienta(z: Any, zad: Record<string, string>) {
  return {
    id: z.id, utworzono: z.created_at, autor: z.email, kategoria: z.kategoria, rodzaj: z.rodzaj, pracownik: z.worker_name ?? null, temat: z.temat, tresc: z.tresc,
    status: statusZgl(z, zad), odpowiedz: z.odpowiedz ?? null, odpowiedz_at: z.odpowiedz_at ?? null,
    zalaczniki: ((z.zalaczniki ?? []) as Zalacznik[]).map((a) => ({ n: a.n, nazwa: a.nazwa, rozmiar: a.rozmiar })),
  };
}
const KAT_NAZWA: Record<string, string> = { kadry: "kadry", ksiegowosc: "księgowość", inne: "inne" };
function mb(n: number) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (Math.round(n / 104857.6) / 10).toString().replace(".", ",") + " MB"; }

async function noweZgloszenie(d: Deps, k: Konto, nip: string, kl: { dane: Any | null; baza: Any | null }, body: Any, pliki: Plik[]): Promise<Odp> {
  const kategoria = String(body.kategoria ?? ""), rodzaj = String(body.rodzaj ?? "pytanie");
  const temat = txt(body.temat, 200), tresc = txt(body.tresc, 4000);
  if (!KATEGORIE.includes(kategoria)) return odp(400, { error: "Wybierz, czego dotyczy zgłoszenie." });
  if (!RODZAJE.includes(rodzaj)) return odp(400, { error: "Nieznany rodzaj zgłoszenia." });
  if (temat.length < 3) return odp(400, { error: "Wpisz temat zgłoszenia." });
  if (tresc.length < 3) return odp(400, { error: "Opisz, czego dotyczy zgłoszenie." });
  if (pliki.length > MAX_PLIKOW) return odp(400, { kod: "liczba", error: `Do jednego zgłoszenia można dodać najwyżej ${MAX_PLIKOW} pliki.` });
  const sprawdzone: { p: Plik; rodzaj: "pdf" | "jpeg" | "png" }[] = [];
  for (const p of pliki) {
    const s = sprawdzPlik(p);
    if (!s.ok) return odp(s.kod === "rozmiar" ? 413 : 400, { kod: s.kod, error: s.error });
    sprawdzone.push({ p, rodzaj: s.rodzaj });
  }
  // a request about a worker: the worker must be the firm's own
  let worker: Any = null;
  if (body.worker_id != null && body.worker_id !== "") {
    if (!uuid(body.worker_id)) return brak("Nie znaleziono pracownika.");
    worker = await d.store.worker(body.worker_id);
    if (!nalezy(worker, nip)) return brak("Nie znaleziono pracownika.");
  }
  const teraz = d.now();
  if (await d.store.zgloszeniaOd(k.id, new Date(teraz - 600000).toISOString()) >= ZGL_NA_10MIN ||
      await d.store.zgloszeniaOd(k.id, new Date(teraz - 86400000).toISOString()) >= ZGL_NA_DOBE) {
    return odp(429, { kod: "limit", error: "Wysłano już dużo zgłoszeń w krótkim czasie. Prosimy spróbować później albo zadzwonić do biura." });
  }
  const id = crypto.randomUUID();
  const zal: Zalacznik[] = [];
  for (const [i, s] of sprawdzone.entries()) {
    const path = `${id}/${i + 1}.${EXT[s.rodzaj]}`;
    if (!await d.store.upload(BUCKET_ZGL, path, s.p.bytes, MIME[s.rodzaj])) {
      await d.store.usun(BUCKET_ZGL, zal.map((a) => a.path));
      return odp(502, { kod: "zapis", error: "Nie udało się zapisać załącznika. Prosimy spróbować ponownie." });
    }
    zal.push({ n: i + 1, nazwa: nazwaPliku(s.p.nazwa), mime: MIME[s.rodzaj], rozmiar: s.p.bytes.length, path, sha256: await sha256hex(s.p.bytes) });
  }
  const firma = kl.dane?.nazwa ?? kl.baza?.nazwa ?? `NIP ${nip}`;
  const row = {
    id, konto_id: k.id || null, email: k.email, nip, firma, kategoria, rodzaj, worker_id: worker?.id ?? null, worker_name: worker?.worker_name ?? null,
    temat, tresc, zalaczniki: zal, status: "przyjete",
  };
  if (!await d.store.zgloszenieInsert(row)) {
    await d.store.usun(BUCKET_ZGL, zal.map((a) => a.path));
    return odp(500, { kod: "zapis", error: "Nie udało się zapisać zgłoszenia. Prosimy spróbować ponownie." });
  }
  // the task for the right person: HR officer / accounting caretaker of this client, else the default
  const dzial = kategoria === "ksiegowosc" ? "ksiegowosc" : kategoria === "kadry" ? "kadry" : String(kl.baza?.opiekun ?? kl.dane?.opiekun ?? "").trim() ? "ksiegowosc" : "kadry";
  const alias = String((dzial === "kadry" ? kl.baza?.kadrowy ?? kl.dane?.kadrowy : kl.baza?.opiekun ?? kl.dane?.opiekun) ?? "").trim();
  let zadanie: { id: string } | null = null, assignee: string | null = null;
  try {
    assignee = await d.store.assignee(dzial, alias);
    if (assignee) {
      const opis = [
        `Zgłoszenie z profilu klienta (${KAT_NAZWA[kategoria]}).`, `Firma: ${firma}, NIP ${nip}`, `Od: ${k.email}`,
        worker ? `Pracownik: ${worker.worker_name ?? ""}` : "", "", tresc, "",
        zal.length ? "Załączniki: " + zal.map((a) => `${a.nazwa} (${mb(a.rozmiar)})`).join("; ") : "Bez załączników.",
        "Status i odpowiedź dla klienta: funkcja klient, akcja biuro_zgloszenie; zamknięcie zadania pokazuje klientowi „załatwione”.",
      ].filter((x, i) => x !== "" || i === 4 || i === 6).join("\n").slice(0, 4000);
      zadanie = await d.store.zadanieInsert({
        created_by: "system", assignee, tytul: `Klient: ${temat} — ${firma}`.slice(0, 200), opis, termin: null, pilne: false,
        zrodlo: "reczne", klucz: `klient:${id}`, link: `klienci.html?zgloszenie=${id}`,
      });
      if (zadanie) await d.store.zgloszeniePatch(id, { zadanie_id: zadanie.id, assignee });
    }
  } catch (e) { console.error("zadanie", e); }
  await d.store.log(k, "zgloszenie", { id, nip, kategoria, rodzaj, zalaczniki: zal.length, zadanie: !!zadanie });
  return odp(200, { ok: true, id, status: "przyjete" });
}

// ---------------------------------------------------------------- accounting
const FAKTURY_SWIEZE_H = 26; // invoices are shown only when the last sync with wFirma is this fresh
function krok(k: Any, id: string): { stan: "tak" | "nie" | "nd"; kiedy: string | null } {
  const e = k?.[id];
  return !e ? { stan: "nie", kiedy: null } : e.nd ? { stan: "nd", kiedy: null } : { stan: "tak", kiedy: typeof e.at === "string" ? e.at.slice(0, 10) : null };
}
async function ksiegi(d: Deps, nip: string, kl: { dane: Any | null; baza: Any | null }) {
  const dane = kl.dane ?? {};
  const oc = await d.store.onboarding(nip);
  // monthly closing in the client's words; internal notes (uwagi) and who ticked a step stay in the office
  const zamkniecia = (await d.store.zamkniecia(nip)).slice(0, 6).map((z) => ({
    okres: z.okres, dokumenty: krok(z.kroki, "dok"), zaksiegowano: krok(z.kroki, "ksiegi"), deklaracje: krok(z.kroki, "jpk"), zamkniety: krok(z.kroki, "zamk"),
  }));
  const sync = await d.store.invoicesSync();
  let faktury: Any = { stan: "niedostepne" };
  if (sync && d.now() - Date.parse(sync) < FAKTURY_SWIEZE_H * 3600000) {
    const lista = await d.store.invoices(nip, new Date(d.now() - 730 * 86400000).toISOString().slice(0, 10));
    const open = lista.filter((f) => f.status !== "paid");
    const sum = (l: Any[]) => Object.entries(l.reduce((acc: Record<string, number>, f) => { acc[f.currency] = (acc[f.currency] ?? 0) + Number(f.amount); return acc; }, {})).map(([waluta, kwota]) => ({ waluta, kwota: Math.round((kwota as number) * 100) / 100 }));
    faktury = { stan: "ok", na_dzien: sync, lista, do_zaplaty: sum(open), po_terminie: sum(open.filter((f) => f.status === "overdue")) };
  }
  let onboarding = null;
  if (oc && !oc.archived) {
    const tasks: Any[] = (oc.tasks ?? []).filter((t: Any) => t.status !== "na");
    onboarding = {
      gotowe: tasks.filter((t) => t.status === "done").length, wszystkie: tasks.length,
      od_klienta: tasks.filter((t) => t.clientAction && t.status !== "done").map((t) => ({ co: t.clientAction, sprawa: t.title, termin: t.dueDate ?? null })),
    };
  }
  return {
    opiekun: dane.opiekun || kl.baza?.opiekun || null, forma: dane.forma || null, opodatkowanie: dane.opodatkowanie || null,
    mikrorachunek: mikrorachunek(nip), nrs: oc?.nrs ?? null, zamkniecia, faktury, onboarding,
  };
}

// ---------------------------------------------------------------- client actions
const AKCJE = ["start", "pracownicy", "pracownik", "pracownik_pokaz", "dokumenty", "pobierz", "ksiegi", "zgloszenia", "zgloszenie_nowe", "firma"];
const POZA = (co: string) => odp(403, { zakres: true, error: `Biuro nie prowadzi dla tej firmy ${co}.` });

export async function klientAkcja(d: Deps, k: Konto, body: Any, pliki: Plik[] = []): Promise<Odp | null> {
  const akcja = String(body?.action ?? "");
  if (!AKCJE.includes(akcja)) return null;
  const nip = digits(body.nip);
  if (nip.length !== 10 || !k.nip.includes(nip)) return odp(403, { error: "Brak dostępu do tej firmy." });
  const kl = await d.store.klient(nip);
  const zakres = zakresOf(kl);
  const dane = kl.dane ?? {};
  const dzis = dzisWarszawa(d.now());

  if (akcja === "start") {
    const out: Any = {
      firma: { nip, nazwa: dane.nazwa ?? kl.baza?.nazwa ?? `NIP ${nip}` }, zakres, jezyk: jezykOf(dane.jezyk),
      // names of the persons who look after the client, and the office's own contact data — nothing private
      kontakt: { opiekun: zakres.ksiegowosc ? String(dane.opiekun ?? kl.baza?.opiekun ?? "").trim() || null : null, kadrowy: zakres.kadry ? String(dane.kadrowy ?? kl.baza?.kadrowy ?? "").trim() || null : null, biuro: BIURO },
      poprzednie_logowanie: k.id ? (await d.store.logins(k.id))[1] ?? null : null,
      liczby: { pracownicy: 0, w_trakcie: 0, w_weryfikacji: 0, do_podpisu: 0, zgloszenia_otwarte: 0 }, terminy_pracownikow: [], od_klienta: [], podatki: null,
    };
    if (zakres.kadry) {
      out.liczby.w_weryfikacji = await d.store.noweIle(nip);
      for (const w of (await d.store.workers(nip)).filter((x) => nalezy(x, nip))) {
        const s = statusPrac(w.status);
        if (s === "w_trakcie") out.liczby.w_trakcie++;
        if (s !== "zatrudniony") continue;
        out.liczby.pracownicy++;
        const t = terminy(w.payload ?? {});
        for (const [co] of TERMINY) {
          const x = t[co];
          if (x.data && !x.bezterminowo && dni(dzis, x.data) <= 30) out.terminy_pracownikow.push({ id: w.id, imie_nazwisko: w.worker_name ?? "", co, data: x.data, dni: dni(dzis, x.data) });
        }
      }
      out.terminy_pracownikow.sort((a: Any, b: Any) => a.dni - b.dni);
      out.terminy_pracownikow = out.terminy_pracownikow.slice(0, 60);
      out.liczby.do_podpisu = doPodpisu(await d.store.podpisy(nip));
    }
    if (zakres.ksiegowosc) {
      out.podatki = { forma: dane.forma ?? "", opodatkowanie: dane.opodatkowanie ?? "" }; // for the deadline calendar
      const oc = await d.store.onboarding(nip);
      if (oc && !oc.archived) out.od_klienta = ((oc.tasks ?? []) as Any[]).filter((t) => t.status !== "na" && t.status !== "done" && t.clientAction).map((t) => ({ co: t.clientAction, sprawa: t.title, termin: t.dueDate ?? null })).slice(0, 30);
    }
    const zg = await d.store.zgloszenia(nip);
    const zad = await d.store.zadaniaStatus(zg.map((z) => z.zadanie_id).filter(Boolean));
    out.liczby.zgloszenia_otwarte = zg.filter((z) => statusZgl(z, zad) !== "zalatwione").length;
    return odp(200, out);
  }

  if (akcja === "pracownicy") {
    if (!zakres.kadry) return POZA("kadr");
    return odp(200, { pracownicy: (await d.store.workers(nip)).filter((w) => nalezy(w, nip)).map(wiersz), w_weryfikacji: await d.store.noweIle(nip) });
  }

  if (akcja === "pracownik" || akcja === "pracownik_pokaz") {
    if (!zakres.kadry) return POZA("kadr");
    if (!uuid(body.id)) return brak("Nie znaleziono pracownika.");
    const w = await d.store.worker(body.id);
    if (!nalezy(w, nip)) return brak("Nie znaleziono pracownika.");
    const p = w.payload ?? {};
    if (akcja === "pracownik_pokaz") {
      const pole = String(body.pole ?? "");
      if (!POLA[pole]) return odp(400, { error: "Nieznane pole." });
      if (!k.id) return odp(403, { error: "W podglądzie biura dane pozostają zakryte." });
      if (await d.store.countLog(k.id, "odkrycie", new Date(d.now() - 3600000).toISOString()) >= ODKRYC_NA_H) return odp(429, { kod: "limit", error: "Zbyt wiele odsłonięć danych w ciągu godziny. Prosimy spróbować później." });
      // every unmasking leaves a trace: who, whose data, which field
      await d.store.log(k, "odkrycie", { nip, pracownik: w.id, pole });
      return odp(200, { pole, wartosc: String(p[POLA[pole]] ?? "") });
    }
    const pak = (await d.store.podpisy(nip)).filter((x) => pakietWidoczny(x) && x.zgloszenie_id === w.id);
    const akta = (await d.store.aktaShared(nip)).filter((a) => a.worker_id === w.id);
    return odp(200, {
      pracownik: {
        ...wiersz(w), imiona: p.p_imiona ?? "", nazwisko: p.p_nazwisko ?? "", data_urodzenia: isDate(p.p_dataur) ? p.p_dataur : null,
        telefon: p.p_telefon ?? "", email: p.p_email ?? "", adres: adres(p, "a_"),
        // masked: the value itself is given only by pracownik_pokaz
        ma: { pesel: !!String(p.p_pesel ?? "").trim(), dokument: !!String(p.p_dowod ?? "").trim(), konto: !!String(p.p_konto ?? "").trim() },
        dokument_typ: p.p_doc_typ ?? "", bez_pesel: p.p_nopesel === true || p.p_nopesel === "tak", wyplata_gotowka: p.p_gotowka === true,
        umowa_szczegoly: {
          rodzaj: UMOWA[p.u_typ] ?? p.u_umowa ?? "", stanowisko: p.u_stanowisko ?? "", od: isDate(p.u_od) ? p.u_od : null, do: isDate(p.u_do) ? p.u_do : null,
          bezterminowo: p.u_bezterminowo === true, wymiar: p.u_wymiar ?? "", stawka: p.u_stawka ?? "", jednostka: p.u_jedn ?? "", minimalna: p.u_minimalna === true,
          godziny: p.u_godziny ?? "", miejsce: p.u_miejsce ?? "",
        },
      },
      dokumenty: {
        komplet: kompletDostepny(w) ? { id: w.id, nazwa: nazwaPliku(p.komplet.filename ?? "komplet.pdf") } : null,
        podpisy: pak.flatMap((x) => (x.dokumenty ?? []).filter((dk: Any) => dk.status !== "anulowany").map((dk: Any) => ({ id: dk.id, tytul: dk.tytul, podpisany: ["gotowy", "w_aktach"].includes(dk.status) }))),
        akta: akta.map((a) => ({ id: a.id, rodzaj: a.rodzaj ?? "", czesc: a.czesc ?? "", data: a.data_dok ?? null })),
      },
    });
  }

  if (akcja === "dokumenty") {
    const seen = new Set<string>();
    // the newest version of each generated document (the office may have produced it more than once)
    const firmowe = (await d.store.historia(nip, Object.keys(HIST_TYPY))).filter((h) => {
      const key = `${h.doc_type}|${String(h.subject ?? "").toLowerCase()}`;
      if (!HIST_TYPY[h.doc_type] || seen.has(key)) return false;
      seen.add(key); return true;
    }).map((h) => ({ id: h.id, rodzaj: HIST_TYPY[h.doc_type], tytul: h.title ?? HIST_TYPY[h.doc_type], dotyczy: h.subject ?? "", data: h.created_at }));
    const umowy = kl.baza?.id ? (await d.store.umowyShared(kl.baza.id)).map((u) => ({
      id: u.id, rodzaj: u.rodzaj ?? "inne", podtyp: u.podtyp ?? "", data_zawarcia: u.data_zawarcia ?? null, obowiazuje_od: u.obowiazuje_od ?? null, obowiazuje_do: u.obowiazuje_do ?? null, bezterminowa: u.bezterminowa === true,
    })) : [];
    let akta: Any[] = [], komplety: Any[] = [];
    if (zakres.kadry) {
      akta = (await d.store.aktaShared(nip)).map((a) => ({ id: a.id, pracownik: a.worker_name ?? "", rodzaj: a.rodzaj ?? "", czesc: a.czesc ?? "", data: a.data_dok ?? null }));
      komplety = (await d.store.workers(nip)).filter((w) => nalezy(w, nip) && kompletDostepny(w)).map((w) => ({ id: w.id, pracownik: w.worker_name ?? "", do_podpisu: w.status === "wyslane", nazwa: nazwaPliku(w.payload.komplet.filename ?? "komplet.pdf") }));
    }
    return odp(200, { firmowe, umowy, akta, komplety });
  }

  if (akcja === "pobierz") {
    const zrodlo = String(body.zrodlo ?? "");
    if (!uuid(body.id)) return brak();
    if (!k.id) return odp(403, { error: "W podglądzie biura pliki nie są pobierane." });
    if (await d.store.countLog(k.id, "pobranie", new Date(d.now() - 3600000).toISOString()) >= POBRAN_NA_H) return odp(429, { kod: "limit", error: "Zbyt wiele pobrań w ciągu godziny. Prosimy spróbować później." });
    let bucket = "", path = "", nazwa = "dokument.pdf";
    if (zrodlo === "komplet") {
      const w = await d.store.worker(body.id);
      if (!zakres.kadry || !nalezy(w, nip) || !kompletDostepny(w)) return brak();
      bucket = "portal-documents"; path = w.payload.komplet.path; nazwa = nazwaPliku(w.payload.komplet.filename ?? "komplet.pdf");
    } else if (zrodlo === "historia") {
      const h = await d.store.historiaDoc(body.id);
      if (!h || !HIST_TYPY[h.doc_type] || !okSciezka(h.pdf_path) || (h.nip !== nip && h.znip !== nip)) return brak();
      bucket = "portal-documents"; path = h.pdf_path; nazwa = nazwaPliku(h.filename ?? "dokument.pdf");
    } else if (zrodlo === "akta") {
      const a = await d.store.aktaDoc(body.id);
      if (!zakres.kadry || !a || a.nip !== nip || a.status !== "przypisany" || a.shared !== true) return brak();
      bucket = "akta-osobowe"; path = a.path; nazwa = nazwaPliku(a.nazwa ?? "dokument.pdf");
    } else if (zrodlo === "umowa") {
      const u = await d.store.umowa(body.id);
      if (!u || !kl.baza?.id || u.klient !== kl.baza.id || u.status !== "przypisany" || u.shared !== true) return brak();
      bucket = "klienci-umowy"; path = u.path; nazwa = nazwaPliku(u.nazwa ?? "umowa.pdf");
    } else if (zrodlo === "zgloszenie") {
      const z = await d.store.zgloszenie(body.id);
      const a = z && z.nip === nip ? ((z.zalaczniki ?? []) as Zalacznik[]).find((x) => x.n === Number(body.n)) : null;
      if (!a) return brak();
      bucket = BUCKET_ZGL; path = a.path; nazwa = a.nazwa;
    } else return brak();
    // the storage path never leaves the function: only a link that dies in two minutes and downloads as a file
    const url = await d.store.sign(bucket, path, 120, nazwa);
    if (!url) return odp(502, { error: "Nie udało się przygotować pliku." });
    await d.store.log(k, "pobranie", { nip, zrodlo, id: body.id, n: zrodlo === "zgloszenie" ? Number(body.n) : undefined });
    return odp(200, { url, nazwa });
  }

  if (akcja === "ksiegi") {
    if (!zakres.ksiegowosc) return POZA("księgowości");
    return odp(200, await ksiegi(d, nip, kl));
  }

  if (akcja === "zgloszenia") {
    const zg = await d.store.zgloszenia(nip);
    const zad = await d.store.zadaniaStatus(zg.map((z) => z.zadanie_id).filter(Boolean));
    return odp(200, { zgloszenia: zg.map((z) => zglDlaKlienta(z, zad)), limity: { plikow: MAX_PLIKOW, mb: MAX_PLIK / 1048576 } });
  }
  if (akcja === "zgloszenie_nowe") {
    if (!k.id) return odp(403, { error: "W podglądzie biura zgłoszeń się nie wysyła." });
    return await noweZgloszenie(d, k, nip, kl, body, pliki);
  }

  if (akcja === "firma") {
    const r = kl.baza?.id ? await d.store.rejestr(kl.baza.id) : null;
    // the preview of the office never creates a link, it only shows one that exists
    let tg: string | null = null;
    try { tg = kl.baza?.id ? await d.store.telegramLink(kl.baza.id, k.id ? `klient:${k.email}` : k.email, !!k.id) : null; } catch (e) { console.error("telegram", e); }
    return odp(200, {
      dane: { nazwa: dane.nazwa ?? kl.baza?.nazwa ?? "", nip, forma: dane.forma ?? "", opodatkowanie: zakres.ksiegowosc ? dane.opodatkowanie ?? "" : "", adres: dane.adres ?? "", miasto: dane.miasto ?? "",
        telefon: dane.telefon ?? "", email: dane.email ?? "", kontakt: dane.kontakt ?? "" },
      // public register data only (extracted columns) — never the raw register answer
      rejestr: r ? { krs: r.krs ?? null, regon: r.regon ?? null, nazwa: r.nazwa ?? null, forma: r.forma ?? null, data_rejestracji: r.data_rejestracji ?? null, adres: r.adres ?? null,
        reprezentacja: r.reprezentacja ?? null, stan: r.stan ?? null, sprawdzono: r.sprawdzono_at ?? null,
        zarzad: (Array.isArray(r.zarzad) ? r.zarzad : []).map((o: Any) => ({ imie_nazwisko: [o.imie, o.nazwisko].filter(Boolean).join(" ") || o.imie_nazwisko || "", funkcja: o.funkcja ?? "" })) } : null,
      konta: (await d.store.konta(nip)).map((x) => ({ email: x.email, ostatnie_logowanie: x.last_login ?? null, ja: x.id === k.id })),
      powiadomienia: { email: k.email, telegram: tg && /^https:\/\/t\.me\/[A-Za-z0-9_]{4,40}\?start=[A-Za-z0-9_-]{8,128}$/.test(tg) ? { link: tg } : null },
    });
  }
  return null;
}

// ---------------------------------------------------------------- office actions
const PODGLAD = ["start", "pracownicy", "pracownik", "dokumenty", "ksiegi", "zgloszenia", "firma"];
const maSekcje = (s: Staff, sekcja: string) => s.admin || s.sekcje === null || s.sekcje.includes(sekcja);
function kategorieStaff(s: Staff): string[] {
  const out: string[] = [];
  if (maSekcje(s, "kadry")) out.push("kadry");
  if (maSekcje(s, "onboarding")) out.push("ksiegowosc"); // the accounting section of the portal
  if (out.length) out.push("inne");
  return out;
}
export const BIURO_AKCJE = ["biuro_zgloszenia", "biuro_zgloszenie", "biuro_zalacznik", "biuro_udostepnij", "biuro_udostepnione", "biuro_podglad"];

export async function biuroAkcja(d: Deps, s: Staff, body: Any): Promise<Odp> {
  const akcja = String(body?.action ?? "");
  const kat = kategorieStaff(s);
  if (akcja === "biuro_zgloszenia") {
    if (!kat.length) return odp(403, { error: "Brak uprawnień do zgłoszeń klientów." });
    const nip = digits(body.nip), status = String(body.status ?? "");
    const zg = await d.store.zgloszeniaBiuro({ nip: nip.length === 10 ? nip : undefined, status: STATUSY.includes(status) ? status : undefined, kategorie: kat });
    const zad = await d.store.zadaniaStatus(zg.map((z) => z.zadanie_id).filter(Boolean));
    return odp(200, { zgloszenia: zg.map((z) => ({ ...zglDlaKlienta(z, zad), nip: z.nip, firma: z.firma, zadanie_id: z.zadanie_id ?? null, assignee: z.assignee ?? null, odpowiedzial: z.odpowiedzial ?? null })) });
  }
  if (akcja === "biuro_zgloszenie" || akcja === "biuro_zalacznik") {
    if (!uuid(body.id)) return brak("Nie znaleziono zgłoszenia.");
    const z = await d.store.zgloszenie(body.id);
    // a request of a category outside the caller's sections does not exist for the caller
    if (!z || !kat.includes(z.kategoria)) return brak("Nie znaleziono zgłoszenia.");
    if (akcja === "biuro_zalacznik") {
      const a = ((z.zalaczniki ?? []) as Zalacznik[]).find((x) => x.n === Number(body.n));
      if (!a) return brak("Nie znaleziono załącznika.");
      const url = await d.store.sign(BUCKET_ZGL, a.path, 120, a.nazwa);
      if (!url) return odp(502, { error: "Nie udało się przygotować pliku." });
      await d.store.log(null, "biuro_pobranie", { by: s.email, zgloszenie: z.id, n: a.n });
      return odp(200, { url, nazwa: a.nazwa });
    }
    const patch: Any = {};
    if (body.status != null) {
      if (!STATUSY.includes(String(body.status))) return odp(400, { error: "Nieznany status." });
      patch.status = String(body.status); patch.status_reczny = true;
    }
    if (body.odpowiedz != null) {
      patch.odpowiedz = txt(body.odpowiedz, 2000) || null;
      patch.odpowiedzial = s.email; patch.odpowiedz_at = new Date(d.now()).toISOString();
    }
    if (!Object.keys(patch).length) return odp(400, { error: "Podaj status albo odpowiedź." });
    await d.store.zgloszeniePatch(z.id, patch);
    await d.store.log(null, "biuro_zgloszenie", { by: s.email, zgloszenie: z.id, status: patch.status ?? null, odpowiedz: patch.odpowiedz != null });
    return odp(200, { ok: true });
  }
  if (akcja === "biuro_udostepnij" || akcja === "biuro_udostepnione") {
    const zrodlo = String(body.zrodlo ?? "") as Flaga;
    if (zrodlo !== "akta" && zrodlo !== "umowa") return odp(400, { error: "Nieznane źródło dokumentu." });
    // personnel files: the HR section; contracts with clients: administrators (as the contracts themselves)
    if (zrodlo === "akta" ? !maSekcje(s, "kadry") : !s.admin) return odp(403, { error: "Brak uprawnień do tych dokumentów." });
    if (akcja === "biuro_udostepnione") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).filter(uuid).slice(0, 500);
      return odp(200, { udostepnione: ids.length ? await d.store.flags(zrodlo, ids) : [] });
    }
    if (!uuid(body.id) || !await d.store.obiektFlagi(zrodlo, body.id)) return brak();
    const on = body.udostepnij === true;
    if (!await d.store.flagSet(zrodlo, body.id, on, s.email)) return odp(500, { error: "Nie udało się zapisać." });
    await d.store.log(null, "biuro_udostepnienie", { by: s.email, zrodlo, id: body.id, udostepniony: on });
    return odp(200, { ok: true, udostepniony: on });
  }
  if (akcja === "biuro_podglad") {
    // an administrator looks at the profile exactly as the client would — reading only, no unmasking, no files
    if (!s.admin) return odp(403, { error: "Tylko administrator portalu." });
    const nip = digits(body.nip), inner = body.akcja ?? {};
    if (nip.length !== 10 || !PODGLAD.includes(String(inner.action ?? ""))) return odp(400, { error: "Ta akcja nie jest dostępna w podglądzie." });
    if (inner.action === "start") await d.store.log(null, "podglad_biura", { by: s.email, nip });
    const out = await klientAkcja(d, { id: "", email: s.email, nip: [nip], nazwa: null }, { ...inner, nip });
    return out ?? odp(400, { error: "Nieznana akcja." });
  }
  return odp(400, { error: "Nieznana akcja." });
}
