// Podpisy: the request handler. All I/O goes through `Store` and `Auth` (index.ts gives the
// real ones), so the whole flow can be run in a test with an in-memory store.
// The API contract is at the top of index.ts.
import * as C from "./checks.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
export type Store = {
  pakiet(id: string): Promise<Any | null>;
  pakietByLink(hash: string): Promise<Any | null>;
  pakiety(f: { nip?: string[]; status?: string }): Promise<Any[]>;
  pakietInsert(row: Any): Promise<Any>;
  pakietPatch(id: string, patch: Any): Promise<void>;
  dokumenty(pakietIds: string[]): Promise<Any[]>;
  dokument(id: string): Promise<Any | null>;
  dokInsert(row: Any): Promise<Any>;
  dokPatch(id: string, patch: Any): Promise<void>;
  // patches only while the given columns still hold the given values; false = nothing matched
  dokPatchIf(id: string, cond: Record<string, string>, patch: Any): Promise<boolean>;
  dokDelete(id: string): Promise<void>;
  log(row: Any): Promise<void>;
  logi(pakietId: string): Promise<Any[]>;
  logCount(f: { pakiet_id: string; dokument_id?: string; akcja: string; strona: string; od: string }): Promise<number>;
  proby(ip: string, od: string): Promise<number>;
  probaAdd(ip: string): Promise<void>;
  filePut(path: string, bytes: Uint8Array, mime: string): Promise<boolean>;
  fileGet(path: string): Promise<Uint8Array | null>;
  fileDel(paths: string[]): Promise<void>;
  fileUrl(path: string, nazwa: string, sec: number): Promise<string | null>;
  zgloszenie(id: string): Promise<Any | null>;
  // puts a file into Akta osobowe (bucket + row), returns false when it could not; repeating the
  // call with the same row id must not make a second copy
  aktaInsert(row: Any, bytes: Uint8Array): Promise<boolean>;
};
export type Auth = {
  staff(req: Request): Promise<string | null>;
  klient(req: Request): Promise<{ email: string; nip: string[]; haslo: boolean } | null>;
};
export type Deps = { store: Store; auth: Auth; app: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_DNI = 7, LINK_DNI_MAX = 30, URL_SEC = 120, MAX_DOK = 40;
const LINK_PO_ZAMKNIECIU_DNI = 14; // a closed package's link dies by itself after this many days
const OTWARCIE_CO_MIN = 30;        // "link opened" goes to the trail at most this often
const MAX_JSON = 100 * 1024, MAX_JSON_ANON = 10 * 1024;
const PROBY_OKNO_MIN = 15, PROBY_MAX = 10;
const LIMIT_H: Record<string, number> = { pracownik: 30, pracodawca: 60 }; // upload attempts per package per hour
const LIMIT_D: Record<string, number> = { pracownik: 100, pracodawca: 300 }; // ...and per day
const LINK_ZLY = "Link jest nieważny albo wygasł. Poproś dział kadr o nowy link.";
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const txt = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

export function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-klient-token, x-podpis-token",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
}
export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function rand(n = 6) { return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

type Rola = "biuro" | "pracodawca" | "pracownik";
type Ctx = { rola: Rola; kto: string; ip: string; ua: string; store: Store; origin: string | null };

// ---------------- what each side is shown ----------------
function krok(d: Any, x: "pd" | "pr", rola: Rola) {
  const przez = String(d[x + "_przez"] ?? "");
  return {
    status: d[x + "_status"], metoda: d[x + "_metoda"], metoda_nazwa: d[x + "_metoda"] ? C.METODY[d[x + "_metoda"]] : null,
    at: d[x + "_at"], wgral: rola === "biuro" ? przez || null : przez.split(":")[0] || null,
    wiazanie: d[x + "_wiazanie"], baza: d[x + "_baza"], rewizje: d[x + "_rewizje"] ?? null, sha256: d[x + "_sha256"], rozmiar: d[x + "_rozmiar"], mime: d[x + "_mime"],
    ostrzezenie: d[x + "_ostrzezenie"] ? { wersja: d[x + "_ostrzezenie"].wersja, at: d[x + "_ostrzezenie"].at } : null,
    zweryfikowano_at: d[x + "_wer_at"], zweryfikowal: rola === "biuro" ? d[x + "_wer_przez"] : undefined,
    // the reason is for the office and for the side that has to bring a new file
    odrzucenie: d[x + "_status"] === "odrzucony" && (rola === "biuro" || (x === "pd" ? rola === "pracodawca" : rola === "pracownik" || przez.startsWith("pracodawca:"))) ? d[x + "_odrzucenie"] : null,
    ten_sam: rola === "biuro" ? d[x + "_raport"]?.ten_sam === true : undefined,
    raport: rola === "biuro" ? d[x + "_raport"] : undefined,
  };
}
// may this side have this file now?
function wolno(d: Any, p: Any, ktory: string, rola: Rola): boolean {
  if (rola === "biuro") return ktory === "wydany" || !!d[(ktory === "pracodawca" ? "pd" : "pr") + "_path"];
  if (p.status === "szkic" || p.status === "anulowany") return false;
  if (ktory === "wydany") return true;
  if (ktory === "pracodawca") return !!d.pd_path && (rola === "pracodawca" || d.pd_status === "zweryfikowany");
  if (ktory === "pracownik") return !!d.pr_path && (rola === "pracownik" || d.pr_status === "zweryfikowany" || String(d.pr_przez ?? "").startsWith("pracodawca:"));
  return false;
}
function regulaOut(r: C.Regula) {
  return { podstawa: r.podstawa, metody: r.metody.map((x) => ({ id: x.id, nazwa: x.nazwa, uwaga: x.uwaga ?? null, ostrzezenie: x.ostrzezenie ? { wersja: x.ostrzezenie, tekst: C.OSTRZEZENIA[x.ostrzezenie], potwierdzenie: C.POTWIERDZENIA[x.ostrzezenie] } : null })) };
}
function dokOut(d: Any, p: Any, rola: Rola) {
  const aktywny = !["szkic", "anulowany", "zakonczony"].includes(p.status) && d.status !== "anulowany" && d.status !== "w_aktach";
  const moze = (x: "pd" | "pr") => aktywny && ["oczekuje", "odrzucony", "wgrany"].includes(d[x + "_status"]);
  // what this side should do with the document now
  let zadanie = "nic";
  if (aktywny && rola === "pracodawca" && moze("pd")) zadanie = d.pd_status === "wgrany" ? "czeka_na_weryfikacje" : "podpisz";
  if (aktywny && rola === "pracownik") {
    if (d.podpisuje === "potwierdzenie") zadanie = d.odbior_at ? "nic" : "potwierdz_odbior";
    else if (d.pr_status !== "nie_dotyczy" && d.pr_status !== "zweryfikowany") {
      zadanie = !["zweryfikowany", "nie_dotyczy"].includes(d.pd_status) ? "czeka_na_pracodawce" : d.pr_status === "wgrany" ? "czeka_na_weryfikacje" : "podpisz";
    }
  }
  const gotowy = d.status === "gotowy" || d.status === "w_aktach";
  return {
    id: d.id, lp: d.lp, tytul: d.tytul, rodzaj: d.rodzaj, rodzaj_nazwa: C.RODZAJE[d.rodzaj], podpisuje: d.podpisuje, podpisuje_nazwa: C.PODPISUJE[d.podpisuje],
    czesc: rola === "biuro" ? d.czesc : undefined, status: d.status, status_nazwa: C.STATUS_DOK[d.status], zadanie,
    wydany: { nazwa: d.wydany_nazwa, rozmiar: d.wydany_rozmiar, sha256: d.wydany_sha256 },
    pracodawca: krok(d, "pd", rola), pracownik: krok(d, "pr", rola), odbior_at: d.odbior_at,
    reguly: { pracodawca: regulaOut(C.regula(d.rodzaj, p.cudzoziemiec, "pracodawca", null)), pracownik: regulaOut(C.regula(d.rodzaj, p.cudzoziemiec, "pracownik", d.pd_status === "zweryfikowany" ? d.pd_metoda : null)) },
    // files this side may download now; do_podpisu — the one an electronic signature goes on
    pliki: ["wydany", "pracodawca", "pracownik"].filter((k) => wolno(d, p, k, rola)),
    do_podpisu: rola === "pracownik" && C.plikPracodawcyDoPodpisu(d) ? "pracodawca" : "wydany",
    finalne: gotowy ? C.finalne(d).filter((k) => wolno(d, p, k, rola)) : [],
    akta_ids: rola === "biuro" ? d.akta_ids : undefined,
  };
}
function pakOut(p: Any, docs: Any[], rola: Rola) {
  const mine = docs.filter((d) => d.pakiet_id === p.id).sort((a, b) => a.lp - b.lp);
  const base = {
    id: p.id, created_at: p.created_at, firma: p.firma, nip: p.nip, worker_name: p.worker_name, typ: p.typ, cudzoziemiec: p.cudzoziemiec, bez_pesel: p.bez_pesel,
    status: p.status, status_nazwa: C.STATUS_PAK[p.status], wydano_at: p.wydano_at, zakonczono_at: p.zakonczono_at, anulowano_at: p.anulowano_at,
    dokumenty: mine.map((d) => dokOut(d, p, rola)),
  };
  if (rola === "pracownik") return { ...base, link_wazny_do: p.link_expires };
  if (rola === "pracodawca") return base;
  return {
    ...base, created_by: p.created_by, zgloszenie_id: p.zgloszenie_id, uwagi: p.uwagi, anulowano_by: p.anulowano_by, anulowano_powod: p.anulowano_powod, zakonczono_by: p.zakonczono_by,
    link: p.link_hash ? { wazny_do: p.link_expires, utworzono: p.link_at, przez: p.link_by, aktywny: Date.parse(p.link_expires ?? "") > Date.now() } : null,
  };
}

async function przelicz(store: Store, pakietId: string) {
  const p = await store.pakiet(pakietId);
  if (!p) return;
  const docs = await store.dokumenty([pakietId]);
  for (const d of docs) { const s = C.statusDok(d); if (s !== d.status) { await store.dokPatch(d.id, { status: s }); d.status = s; } }
  const ps = C.statusPak(p, docs);
  if (ps !== p.status) await store.pakietPatch(p.id, { status: ps });
}
async function zapisz(c: Ctx, row: { pakiet_id?: string | null; dokument_id?: string | null; akcja: string; wynik?: string; sha256?: string | null; info?: Any }) {
  // who / from where never comes from the request body
  await c.store.log({ pakiet_id: row.pakiet_id ?? null, dokument_id: row.dokument_id ?? null, strona: c.rola, kto: c.kto, akcja: row.akcja, wynik: row.wynik ?? "ok", ip: c.ip, ua: c.ua, sha256: row.sha256 ?? null, info: row.info ?? null });
}

// HOOK — notifications. v1 sends nothing by itself (no e-mail, Telegram or SMS); the office
// copies the link and the message text. When notifications are added, send them from here:
// events "wydano", "wgrano" (strona), "zweryfikowano", "odrzucono", "zakonczono", "anulowano".
// deno-lint-ignore no-unused-vars
async function powiadom(zdarzenie: string, p: Any, d?: Any): Promise<void> { /* intentionally empty */ }

function wiadomosc(p: Any, url: string, do_: string) {
  const dzien = new Date(do_).toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", year: "numeric" });
  return `Dzień dobry,

${p.firma ? "firma " + p.firma : "pracodawca"} przekazuje Pani/Panu dokumenty dotyczące zatrudnienia — do podpisania przez internet.

Link (ważny do ${dzien}, przeznaczony tylko dla Pani/Pana — proszę go nikomu nie przekazywać):
${url}

Po otwarciu linku zobaczy Pani/Pan listę dokumentów, wyjaśnienie, jak je podpisać, oraz miejsce na odesłanie podpisanych plików albo zdjęć podpisanych wydruków.

W razie pytań prosimy o kontakt z działem kadr TD Consulting Group.`;
}

// ---------------- upload of a signed file / a scan ----------------
async function wgraj(c: Ctx, p: Any, d: Any, strona: "pracodawca" | "pracownik", body: Any, plik: File | null) {
  const o = c.origin, x = strona === "pracodawca" ? "pd" : "pr";
  const odmowa = async (error: string, kod: string, status = 400, extra: Any = {}, sha?: string) => {
    await zapisz(c, { pakiet_id: p.id, dokument_id: d.id, akcja: "wgranie", wynik: "odmowa", sha256: sha ?? null, info: { strona, kod, metoda: String(body.metoda ?? "").slice(0, 20) || null } });
    return json({ error, kod, ...extra }, status, o);
  };
  // the limit comes first: past it nothing is checked, stored or written to the trail
  if (c.rola !== "biuro") {
    const f = { pakiet_id: p.id, akcja: "wgranie", strona: c.rola };
    if (await c.store.logCount({ ...f, od: new Date(Date.now() - 3600000).toISOString() }) >= LIMIT_H[c.rola]) return json({ error: "Zbyt wiele prób wgrania pliku. Spróbuj ponownie za godzinę.", kod: "limit" }, 429, o);
    if (await c.store.logCount({ ...f, od: new Date(Date.now() - 86400000).toISOString() }) >= LIMIT_D[c.rola]) return json({ error: "Zbyt wiele prób wgrania pliku. Spróbuj ponownie jutro albo skontaktuj się z działem kadr.", kod: "limit" }, 429, o);
  }
  if (["szkic", "anulowany", "zakonczony"].includes(p.status) || d.status === "anulowany" || d.status === "w_aktach") return odmowa("Ten pakiet nie przyjmuje już plików.", "zamkniety", 409);
  if (!["oczekuje", "odrzucony", "wgrany"].includes(d[x + "_status"])) return odmowa(d[x + "_status"] === "nie_dotyczy" ? "Tego dokumentu ta strona nie podpisuje." : "Podpis tej strony jest już zweryfikowany.", "krok", 409);
  if (strona === "pracownik" && !["zweryfikowany", "nie_dotyczy"].includes(d.pd_status)) return odmowa("Ten dokument najpierw podpisuje pracodawca — plik pracownika można wgrać po zweryfikowaniu podpisu pracodawcy.", "kolejnosc", 409);
  const metoda = String(body.metoda ?? "");
  if (!C.METODY[metoda]) return odmowa("Wybierz sposób podpisania.", "metoda");
  // the employer may bring the worker's signature only as a scan of the handwritten one
  // ...and never over a file the worker (or the office) brought: only into an empty or rejected step, or over its own scan
  if (c.rola === "pracodawca" && strona === "pracownik" && d.pr_status === "wgrany" && !String(d.pr_przez ?? "").startsWith("pracodawca:")) return odmowa("Plik pracownika jest już wgrany i czeka na weryfikację — pracodawca nie może go zastąpić.", "krok", 409);
  if (c.rola === "pracodawca" && strona === "pracownik" && metoda !== "odreczny") return odmowa("Pracodawca może wgrać za pracownika tylko skan dokumentu podpisanego przez niego odręcznie.", "metoda", 403);
  const r = C.regula(d.rodzaj, p.cudzoziemiec, strona, d.pd_status === "zweryfikowany" ? d.pd_metoda : null);
  const wybrana = r.metody.find((mm) => mm.id === metoda);
  if (!wybrana) return odmowa("Ten sposób podpisania nie jest dopuszczalny dla tego dokumentu. " + r.podstawa, "metoda_niedozwolona", 400, { reguly: regulaOut(r) });
  let ostrzezenie: Any = null;
  if (wybrana.ostrzezenie) {
    // the warning is accepted by the signer in person, never by somebody on their behalf
    const sam = (c.rola === "pracodawca" && strona === "pracodawca") || (c.rola === "pracownik" && strona === "pracownik");
    if (!sam) return odmowa("Ostrzeżenie o podpisie zaufanym musi potwierdzić sam podpisujący — taki plik strona wgrywa samodzielnie.", "ostrzezenie_osobiscie", 403);
    const tekst = C.OSTRZEZENIA[wybrana.ostrzezenie];
    if (body.potwierdzam !== true && body.potwierdzam !== "true" || String(body.ostrzezenie_wersja ?? "") !== wybrana.ostrzezenie) {
      return odmowa("Przed wgraniem pliku podpisanego podpisem zaufanym trzeba przeczytać i potwierdzić ostrzeżenie.", "ostrzezenie", 409, { ostrzezenie: { wersja: wybrana.ostrzezenie, tekst, potwierdzenie: C.POTWIERDZENIA[wybrana.ostrzezenie] } });
    }
    ostrzezenie = { wersja: wybrana.ostrzezenie, sha256: await C.sha256Text(tekst), at: new Date().toISOString(), kto: c.kto };
  }
  if (!plik) return odmowa("Brak pliku.", "plik");
  const max = c.rola === "pracownik" ? C.MAX_LINK : C.MAX_BYTES;
  if (plik.size > max) return odmowa(max === C.MAX_LINK ? C.ERR.rozmiar_link : C.ERR.rozmiar, "rozmiar", 413);

  const bytes = new Uint8Array(await plik.arrayBuffer());
  const bases: C.Base[] = [];
  if (strona === "pracownik" && C.plikPracodawcyDoPodpisu(d)) bases.push({ id: "pracodawca", rozmiar: d.pd_rozmiar, sha256: d.pd_sha256 });
  bases.push({ id: "wydany", rozmiar: d.wydany_rozmiar, sha256: d.wydany_sha256 });
  const pomin = c.rola === "biuro" && (body.pomin_wiazanie === true || body.pomin_wiazanie === "true");
  const v = await C.inspect(bytes, plik.type, metoda, bases, pomin, max);
  if (!v.ok) return odmowa(v.error, v.kod, 400, {}, v.sha256);

  const path = `${p.id}/${d.id}/${x}-${rand()}.${C.EXT[v.kind]}`;
  if (!await c.store.filePut(path, bytes, C.MIME[v.kind])) return odmowa("Nie udało się zapisać pliku — spróbuj ponownie.", "zapis", 502, {}, v.sha256);
  const at = new Date().toISOString(), przez = c.rola === "pracownik" ? "pracownik:link" : `${c.rola}:${c.kto}`;
  await c.store.dokPatch(d.id, {
    [x + "_status"]: "wgrany", [x + "_metoda"]: metoda, [x + "_path"]: path, [x + "_mime"]: C.MIME[v.kind], [x + "_sha256"]: v.sha256, [x + "_rozmiar"]: bytes.length,
    [x + "_baza"]: v.baza, [x + "_wiazanie"]: v.wiazanie, [x + "_rewizje"]: v.rewizje, [x + "_at"]: at, [x + "_przez"]: przez, [x + "_ostrzezenie"]: ostrzezenie,
    [x + "_wer_przez"]: null, [x + "_wer_at"]: null, [x + "_odrzucenie"]: null, [x + "_raport"]: null,
  });
  // a file that was replaced before anybody verified it is not kept (its hash stays in the trail)
  const zastapiony = d[x + "_status"] === "wgrany" && d[x + "_path"] ? String(d[x + "_path"]) : null;
  if (zastapiony) await c.store.fileDel([zastapiony]).catch(() => undefined);
  await zapisz(c, {
    pakiet_id: p.id, dokument_id: d.id, akcja: "wgranie", sha256: v.sha256,
    info: { strona, metoda, mime: C.MIME[v.kind], rozmiar: bytes.length, baza: v.baza, wiazanie: v.wiazanie, rewizje: v.rewizje, path, poprzedni: d[x + "_path"] ?? null, poprzedni_sha256: d[x + "_sha256"] ?? null, poprzedni_usuniety: !!zastapiony,
      ostrzezenie: ostrzezenie ? { ...ostrzezenie, tekst: C.OSTRZEZENIA[ostrzezenie.wersja], potwierdzenie: C.POTWIERDZENIA[ostrzezenie.wersja] } : null },
  });
  await przelicz(c.store, p.id);
  await powiadom("wgrano", p, d);
  return json({ ok: true, sha256: v.sha256, wiazanie: v.wiazanie, baza: v.baza, rewizje: v.rewizje, weryfikacja: v.wiazanie === "wzrokowa" ? "do weryfikacji wzrokowej" : "do weryfikacji podpisu" }, 200, o);
}

async function plikUrl(c: Ctx, p: Any, d: Any, ktory: string) {
  if (ktory === "do_podpisu") ktory = c.rola === "pracownik" && C.plikPracodawcyDoPodpisu(d) ? "pracodawca" : "wydany";
  if (!["wydany", "pracodawca", "pracownik"].includes(ktory) || !wolno(d, p, ktory, c.rola)) return json({ error: "Plik nie jest dostępny." }, 404, c.origin);
  const x = ktory === "pracodawca" ? "pd" : "pr";
  const path = ktory === "wydany" ? d.wydany_path : d[x + "_path"], sha = ktory === "wydany" ? d.wydany_sha256 : d[x + "_sha256"];
  const ext = ktory === "wydany" ? "pdf" : String(path).split(".").pop();
  const nazwa = C.plainName(d.tytul, 60) + (ktory === "wydany" ? "" : ktory === "pracodawca" ? "_podpis_pracodawcy" : d.pr_baza === "pracodawca" ? "_podpisany" : "_podpis_pracownika") + "." + ext;
  const url = await c.store.fileUrl(path, nazwa, URL_SEC);
  if (!url) return json({ error: "Nie udało się przygotować pliku." }, 502, c.origin);
  await zapisz(c, { pakiet_id: p.id, dokument_id: d.id, akcja: "pobranie", sha256: sha, info: { ktory } });
  return json({ url, nazwa, sha256: sha, wazny_s: URL_SEC }, 200, c.origin);
}

// ---------------- closing: the signed files go to Akta osobowe ----------------
async function doAkt(c: Ctx, p: Any, d: Any): Promise<string[] | null> {
  const ids: string[] = [];
  const opis = (x: "pd" | "pr") => d[x + "_status"] === "zweryfikowany" ? `${x === "pd" ? "pracodawca" : "pracownik"} — ${C.METODY[d[x + "_metoda"]]}` : "";
  const uwagi = d.podpisuje === "potwierdzenie"
    ? `Przekazano elektronicznie; pracownik potwierdził odbiór ${String(d.odbior_at).slice(0, 16).replace("T", " ")} UTC.`
    : "Podpisy: " + [opis("pd"), opis("pr")].filter(Boolean).join("; ") + ".";
  const sami = (["pd", "pr"] as const).filter((x) => d[x + "_raport"]?.ten_sam === true).map((x) => x === "pd" ? "pracodawcy" : "pracownika");
  const uwagi2 = uwagi + (sami.length ? ` Plik ${sami.join(" i ")} wgrała i zweryfikowała ta sama osoba z biura.` : "");
  for (const k of C.finalne(d)) {
    const x = k === "pracodawca" ? "pd" : "pr";
    const path = k === "wydany" ? d.wydany_path : d[x + "_path"], sha = k === "wydany" ? d.wydany_sha256 : d[x + "_sha256"];
    const mime = k === "wydany" ? "application/pdf" : d[x + "_mime"];
    const bytes = await c.store.fileGet(path);
    // what goes to the file is exactly what was verified
    if (!bytes || await C.sha256(bytes) !== sha) return null;
    // the same document and file role always land in the same Akta row: closing twice makes no duplicates
    const id = await C.uuid5(`${d.id}:${k}`), ext = String(path).split(".").pop();
    const nazwa = C.plainName(d.tytul, 60) + (k === "wydany" ? "" : k === "pracownik" && d.pr_baza === "pracodawca" ? "_podpisany" : "_podpis_" + (k === "pracodawca" ? "pracodawcy" : "pracownika")) + "." + ext;
    const elektr = k !== "wydany" && d[x + "_metoda"] !== "odreczny";
    const ok = await c.store.aktaInsert({
      id, path: `${id}/${nazwa}`, nazwa, rozmiar: bytes.length, mime, uploaded_by: "podpisy:" + c.kto,
      // without a submission behind the package nobody is guessed: a person assigns the worker
      status: p.zgloszenie_id ? "przypisany" : "do_sprawdzenia",
      nip: p.nip, firma: p.firma, worker_id: p.zgloszenie_id ?? null, worker_name: p.worker_name, czesc: d.czesc, rodzaj: d.tytul.slice(0, 200),
      data_dok: elektr ? String(d[x + "_at"]).slice(0, 10) : null, uwagi: uwagi2,
      sprawdzil: p.zgloszenie_id ? c.kto : null, sprawdzono_at: p.zgloszenie_id ? new Date().toISOString() : null,
      ai: { podpisy: { pakiet: p.id, dokument: d.id, plik: k, sha256: sha } },
    }, bytes);
    if (!ok) return null;
    ids.push(id);
  }
  return ids;
}

// the request body, but never more than `cap` bytes of it (null = it was bigger)
async function czytaj(req: Request, cap: number): Promise<Uint8Array | null> {
  const cl = req.headers.get("content-length");
  if (cl !== null && Number(cl) > cap) return null;
  const r = req.body?.getReader();
  if (!r) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    if (n > cap) { await r.cancel().catch(() => undefined); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let i = 0;
  for (const x of parts) { out.set(x, i); i += x.length; }
  return out;
}

// reads the body to the end without keeping it (at most `cap` bytes, then gives up)
async function spusc(req: Request, cap: number): Promise<void> {
  const r = req.body?.getReader();
  if (!r) return;
  try {
    for (let n = 0; n <= cap;) { const { done, value } = await r.read(); if (done) return; n += value.length; }
    await r.cancel();
  } catch { /* the sender went away */ }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin"), o = origin, store = deps.store;
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || (req.headers.get("x-real-ip") ?? "").slice(0, 64) || "?";
    const ua = (req.headers.get("user-agent") ?? "").slice(0, 200);
    const mk = (rola: Rola, kto: string): Ctx => ({ rola, kto, ip, ua, store, origin });

    // 1. Who is calling — settled from the headers, before a single byte of the body is read.
    const linkTok = req.headers.get("x-podpis-token");
    let rola: Rola | null = null, brak: Response | null = null, p: Any = null, k: Awaited<ReturnType<Auth["klient"]>> = null, me: string | null = null;
    if (linkTok !== null) {
      const found = linkTok.length >= 40 && linkTok.length <= 80 && /^[A-Za-z0-9_-]+$/.test(linkTok) ? await store.pakietByLink(await C.sha256Text(linkTok)) : null;
      if (!found) {
        // only unknown tokens count as guesses; a good link is never locked out by its neighbours
        if (await store.proby(ip, new Date(Date.now() - PROBY_OKNO_MIN * 60000).toISOString()) >= PROBY_MAX) brak = json({ error: "Zbyt wiele nieudanych prób. Spróbuj ponownie za kilkanaście minut.", kod: "limit" }, 429, o);
        else { await store.probaAdd(ip); brak = json({ error: LINK_ZLY, kod: "link" }, 401, o); }
      } else if (!found.link_expires || Date.parse(found.link_expires) < Date.now() || found.status === "szkic" || found.status === "anulowany"
        || (found.status === "zakonczony" && Date.parse(found.zakonczono_at ?? "") + LINK_PO_ZAMKNIECIU_DNI * 86400000 < Date.now())) {
        // one answer for a wrong, an expired and a withdrawn link
        brak = json({ error: LINK_ZLY, kod: "link" }, 401, o);
      } else { rola = "pracownik"; p = found; }
    } else if (req.headers.get("x-klient-token")) {
      k = await deps.auth.klient(req);
      if (!k) brak = json({ error: "Sesja wygasła — zaloguj się ponownie.", wyloguj: true }, 401, o);
      else if (!k.haslo) brak = json({ error: "Najpierw ustaw hasło.", ustaw_haslo: true }, 403, o);
      else rola = "pracodawca";
    } else {
      me = await deps.auth.staff(req);
      if (me) rola = "biuro"; else brak = json({ error: "Brak dostępu." }, 403, o);
    }

    // 2. The body — capped by who is calling. A stranger may send only a small JSON (`reguly`).
    let body: Any = {}, plik: File | null = null;
    const multipart = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
    if (multipart) {
      if (!rola) return brak!;
      const cl = req.headers.get("content-length"), max = rola === "pracownik" ? C.MAX_LINK : C.MAX_BYTES;
      if (cl === null || !/^\d+$/.test(cl)) return json({ error: "Brak nagłówka Content-Length — plik trzeba wysłać w całości, nie strumieniem.", kod: "dlugosc" }, 411, o);
      if (Number(cl) > max + 64 * 1024) {
        // nothing is kept: the rest of the upload is let through and dropped, so that the sender
        // gets this answer instead of a broken connection
        await spusc(req, 3 * max);
        return json({ error: max === C.MAX_LINK ? C.ERR.rozmiar_link : C.ERR.rozmiar, kod: "rozmiar" }, 413, o);
      }
      const fd = await req.formData();
      for (const [key, v] of fd.entries()) { if (typeof v === "string") body[key] = v.slice(0, 2000); else if (key === "plik") plik = v as File; }
    } else {
      const raw = await czytaj(req, rola ? MAX_JSON : MAX_JSON_ANON);
      if (!raw) return json({ error: "Żądanie jest za duże.", kod: "rozmiar" }, 413, o);
      try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { body = null; }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Nieprawidłowe żądanie." }, 400, o);
    }
    const action = String(body.action ?? "");
    if (action === "reguly") {
      return json({ rodzaje: C.RODZAJE, metody: C.METODY, podpisuje: C.PODPISUJE, macierz: C.macierz(), ostrzezenia: C.OSTRZEZENIA, potwierdzenia: C.POTWIERDZENIA,
        stwierdzono: C.STWIERDZONO, potwierdzenia_weryfikacji: C.POTWIERDZENIA_WER, powod_rodzaj: C.POWOD_RODZAJ, max_mb: rola === "pracownik" ? 15 : 24, max_mb_link: 15, formaty: ["PDF", "JPG", "PNG"] }, 200, o);
    }
    if (!rola) return brak!;

    // ======================= worker (public link) =======================
    if (rola === "pracownik") {
      const c = mk("pracownik", "link");
      if (action === "podglad") {
        if (await store.logCount({ pakiet_id: p.id, akcja: "otwarcie", strona: "pracownik", od: new Date(Date.now() - OTWARCIE_CO_MIN * 60000).toISOString() }) < 1) await zapisz(c, { pakiet_id: p.id, akcja: "otwarcie" });
        return json({ pakiet: pakOut(p, await store.dokumenty([p.id]), "pracownik") }, 200, o);
      }
      const d = UUID.test(String(body.dokument ?? "")) ? await store.dokument(String(body.dokument)) : null;
      if (!d || d.pakiet_id !== p.id) return json({ error: "Nie ma takiego dokumentu." }, 404, o);
      if (action === "plik") {
        if (await store.logCount({ pakiet_id: p.id, akcja: "pobranie", strona: "pracownik", od: new Date(Date.now() - 3600000).toISOString() }) >= 120) return json({ error: "Zbyt wiele pobrań. Spróbuj ponownie za godzinę.", kod: "limit" }, 429, o);
        return await plikUrl(c, p, d, String(body.ktory ?? "do_podpisu"));
      }
      if (action === "wgraj") return await wgraj(c, p, d, "pracownik", body, plik);
      if (action === "odbior") {
        if (d.podpisuje !== "potwierdzenie" || p.status === "zakonczony" || d.status === "anulowany") return json({ error: "Ten dokument nie wymaga potwierdzenia odbioru." }, 409, o);
        if (d.odbior_at) return json({ ok: true, odbior_at: d.odbior_at }, 200, o);
        if (body.potwierdzam !== true) return json({ error: "Zaznacz potwierdzenie odbioru." }, 400, o);
        // receipt can be confirmed only for something that was actually fetched
        if (await store.logCount({ pakiet_id: p.id, dokument_id: d.id, akcja: "pobranie", strona: "pracownik", od: p.created_at }) < 1) return json({ error: "Najpierw pobierz dokument i zapoznaj się z nim.", kod: "pobierz" }, 409, o);
        const at = new Date().toISOString();
        await store.dokPatch(d.id, { odbior_at: at, odbior_ip: ip });
        await zapisz(c, { pakiet_id: p.id, dokument_id: d.id, akcja: "odbior", sha256: d.wydany_sha256, info: { tekst: "Potwierdzam, że otrzymałam/em ten dokument i mogę go zapisać oraz wydrukować." } });
        await przelicz(store, p.id);
        return json({ ok: true, odbior_at: at }, 200, o);
      }
      return json({ error: "Nieznana akcja." }, 400, o);
    }

    // ======================= employer (client session) =======================
    if (rola === "pracodawca" && k) {
      const c = mk("pracodawca", k.email);
      if (action === "lista") {
        const nip = digits(body.nip);
        if (nip && !k.nip.includes(nip)) return json({ error: "Brak dostępu do tej firmy." }, 403, o);
        const nips = k.nip;
        const pak = (await store.pakiety({ nip: nip ? [nip] : nips })).filter((q) => q.status !== "szkic" && nips.includes(q.nip));
        const docs = pak.length ? await store.dokumenty(pak.map((q) => q.id)) : [];
        return json({ pakiety: pak.map((q) => pakOut(q, docs, "pracodawca")) }, 200, o);
      }
      const d = UUID.test(String(body.dokument ?? "")) ? await store.dokument(String(body.dokument)) : null;
      p = d ? await store.pakiet(d.pakiet_id) : null;
      // a document of another firm does not exist for this client
      if (!d || !p || !k.nip.includes(p.nip) || p.status === "szkic") return json({ error: "Nie ma takiego dokumentu." }, 404, o);
      if (action === "plik") return await plikUrl(c, p, d, String(body.ktory ?? "do_podpisu"));
      if (action === "wgraj") return await wgraj(c, p, d, body.strona === "pracownik" ? "pracownik" : "pracodawca", body, plik);
      return json({ error: "Nieznana akcja." }, 400, o);
    }

    // ======================= office (portal JWT, Kadry) =======================
    if (!me) return brak ?? json({ error: "Brak dostępu." }, 403, o);
    const c = mk("biuro", me);

    if (action === "lista") {
      const st = String(body.status ?? "");
      const pak = await store.pakiety(C.STATUS_PAK[st] ? { status: st } : {});
      const docs = pak.length ? await store.dokumenty(pak.map((q) => q.id)) : [];
      return json({ pakiety: pak.map((q) => pakOut(q, docs, "biuro")) }, 200, o);
    }
    if (action === "utworz") {
      let row: Any;
      const zid = String(body.zgloszenie_id ?? "");
      if (typeof body.cudzoziemiec !== "boolean") return json({ error: "Zaznacz, czy pracownik jest cudzoziemcem — od tego zależą dopuszczalne sposoby podpisania." }, 400, o);
      if (zid) {
        const z = UUID.test(zid) ? await store.zgloszenie(zid) : null;
        if (!z) return json({ error: "Nie znaleziono zgłoszenia pracownika." }, 404, o);
        const zp = z.payload ?? {}, nip = digits(zp.z_nip);
        if (nip.length !== 10) return json({ error: "Zgłoszenie nie ma poprawnego NIP pracodawcy." }, 400, o);
        // worker and firm come from the submission, not from the browser
        if (body.nip && digits(body.nip) !== nip) return json({ error: "NIP nie zgadza się z NIP pracodawcy w zgłoszeniu." }, 400, o);
        row = { zgloszenie_id: z.id, nip, firma: txt(zp.z_nazwa, 200) || null, worker_name: txt(z.worker_name, 200) || "—", typ: body.typ === "praca" || body.typ === "zlecenie" ? body.typ : zp.u_typ === "praca" ? "praca" : "zlecenie", bez_pesel: typeof body.bez_pesel === "boolean" ? body.bez_pesel : digits(zp.p_pesel).length !== 11 };
      } else {
        const nip = digits(body.nip), worker = txt(body.worker_name, 200);
        if (nip.length !== 10) return json({ error: "Podaj NIP pracodawcy (10 cyfr)." }, 400, o);
        if (worker.length < 3) return json({ error: "Podaj imię i nazwisko pracownika." }, 400, o);
        if (body.typ !== "praca" && body.typ !== "zlecenie") return json({ error: "Wybierz rodzaj umowy." }, 400, o);
        row = { zgloszenie_id: null, nip, firma: txt(body.firma, 200) || null, worker_name: worker, typ: body.typ, bez_pesel: body.bez_pesel === true };
      }
      const np = await store.pakietInsert({ ...row, cudzoziemiec: body.cudzoziemiec, created_by: me, status: "szkic", uwagi: txt(body.uwagi, 500) || null });
      await zapisz(c, { pakiet_id: np.id, akcja: "utworzenie", info: { nip: np.nip, typ: np.typ, cudzoziemiec: np.cudzoziemiec, zgloszenie_id: np.zgloszenie_id } });
      return json({ ok: true, pakiet: pakOut(np, [], "biuro") }, 200, o);
    }

    // actions on a document
    if (["plik", "wgraj", "weryfikuj", "dokument_usun"].includes(action)) {
      const d = UUID.test(String(body.dokument ?? "")) ? await store.dokument(String(body.dokument)) : null;
      p = d ? await store.pakiet(d.pakiet_id) : null;
      if (!d || !p) return json({ error: "Nie ma takiego dokumentu." }, 404, o);
      if (action === "plik") return await plikUrl(c, p, d, String(body.ktory ?? "wydany"));
      if (action === "wgraj") return await wgraj(c, p, d, body.strona === "pracownik" ? "pracownik" : "pracodawca", body, plik);
      if (action === "dokument_usun") {
        if (p.status !== "szkic") return json({ error: "Dokument można usunąć tylko z niewydanego pakietu." }, 409, o);
        await store.dokDelete(d.id);
        await zapisz(c, { pakiet_id: p.id, dokument_id: d.id, akcja: "dokument_usuniety", sha256: d.wydany_sha256, info: { tytul: d.tytul } });
        return json({ ok: true }, 200, o);
      }
      // weryfikuj
      const x = body.strona === "pracownik" ? "pr" : body.strona === "pracodawca" ? "pd" : "";
      if (!x) return json({ error: "Wskaż, czyj podpis." }, 400, o);
      if (["szkic", "anulowany", "zakonczony"].includes(p.status) || d.status === "w_aktach") return json({ error: "Ten pakiet jest zamknięty." }, 409, o);
      const st = d[x + "_status"];
      // what the officer found in the validator's report, and the file the officer actually looked at
      const stwierdzono = C.STWIERDZONO[String(body.stwierdzono ?? "")] ? String(body.stwierdzono) : null;
      const widziany = /^[0-9a-f]{64}$/.test(String(body.sha256 ?? "")) ? String(body.sha256) : null;
      const ZMIENIONY = "Plik został zmieniony po tym, jak go pobrano do sprawdzenia — pobierz i sprawdź ponownie.";
      const tenSam = d[x + "_przez"] === "biuro:" + me; // the same person brought the file and judges it
      if (body.ok === true) {
        if (st !== "wgrany") return json({ error: "Nie ma pliku czekającego na weryfikację." }, 409, o);
        if (!widziany) return json({ error: "Najpierw pobierz plik i sprawdź go — weryfikacja dotyczy konkretnego pliku.", kod: "sha256" }, 400, o);
        if (widziany !== d[x + "_sha256"]) return json({ error: ZMIENIONY, kod: "zmieniony" }, 409, o);
        if (!stwierdzono) return json({ error: "Wybierz rodzaj podpisu według weryfikatora.", kod: "rodzaj" }, 400, o);
        // a file declared as one kind of signature but signed with another must come back through
        // the right path (with the warning where it applies) — it is never accepted here
        if (stwierdzono !== d[x + "_metoda"]) return json({ error: `Zadeklarowano: ${C.METODY[d[x + "_metoda"]]}, a weryfikator pokazuje: ${C.STWIERDZONO[stwierdzono]}. Takiego pliku nie można zatwierdzić — odrzuć go z powodem: „${C.POWOD_RODZAJ}”.`, kod: "rodzaj", powod: C.POWOD_RODZAJ }, 409, o);
        const wym = C.wymaganePotwierdzenia(d[x + "_metoda"], d[x + "_baza"]), pot = body.potwierdzenia && typeof body.potwierdzenia === "object" ? body.potwierdzenia : {};
        const brakuje = wym.filter((key) => pot[key] !== true);
        if (brakuje.length) return json({ error: "Zaznacz wszystkie potwierdzenia: " + brakuje.map((key) => "„" + C.POTWIERDZENIA_WER[key] + "”").join(", ") + ".", kod: "potwierdzenia", brakuje }, 400, o);
        const at = new Date().toISOString();
        const rap = {
          zrodlo: txt(body.raport?.zrodlo, 80) || (d[x + "_metoda"] === "odreczny" ? "weryfikacja wzrokowa" : "podpis.gov.pl"), podpisujacy: txt(body.raport?.podpisujacy, 200) || null, uwagi: txt(body.raport?.uwagi, 500) || null,
          stwierdzono, potwierdzenia: Object.fromEntries(wym.map((key) => [key, C.POTWIERDZENIA_WER[key]])), sha256: widziany, ten_sam: tenSam, at, przez: me,
        };
        // conditional: only while this very file is still the one waiting
        const ok = await store.dokPatchIf(d.id, { [x + "_status"]: "wgrany", [x + "_sha256"]: widziany }, { [x + "_status"]: "zweryfikowany", [x + "_wer_przez"]: me, [x + "_wer_at"]: at, [x + "_odrzucenie"]: null, [x + "_raport"]: rap });
        if (!ok) return json({ error: ZMIENIONY, kod: "zmieniony" }, 409, o);
        await zapisz(c, { pakiet_id: p.id, dokument_id: d.id, akcja: "weryfikacja", sha256: widziany, info: { strona: body.strona, metoda: d[x + "_metoda"], wiazanie: d[x + "_wiazanie"], rewizje: d[x + "_rewizje"] ?? null, raport: rap, ten_sam: tenSam } });
        await przelicz(store, p.id);
        await powiadom("zweryfikowano", p, d);
        return json({ ok: true, ten_sam: tenSam }, 200, o);
      }
      if (body.ok === false) {
        const powod = txt(body.powod, 500);
        if (powod.length < 3) return json({ error: "Podaj powód odrzucenia — zobaczy go strona, która ma poprawić podpis." }, 400, o);
        if (st !== "wgrany" && st !== "zweryfikowany") return json({ error: "Nie ma pliku do odrzucenia." }, 409, o);
        // the worker's signature may sit on top of the employer's file
        if (x === "pd" && ["wgrany", "zweryfikowany"].includes(d.pr_status)) return json({ error: "Pracownik już podpisał ten dokument — najpierw odrzuć podpis pracownika." }, 409, o);
        if (widziany && widziany !== d[x + "_sha256"]) return json({ error: ZMIENIONY, kod: "zmieniony" }, 409, o);
        const ok = await store.dokPatchIf(d.id, { [x + "_status"]: st, [x + "_sha256"]: d[x + "_sha256"] }, { [x + "_status"]: "odrzucony", [x + "_odrzucenie"]: powod, [x + "_wer_przez"]: me, [x + "_wer_at"]: new Date().toISOString() });
        if (!ok) return json({ error: ZMIENIONY, kod: "zmieniony" }, 409, o);
        await zapisz(c, { pakiet_id: p.id, dokument_id: d.id, akcja: "odrzucenie", wynik: "odrzucono", sha256: d[x + "_sha256"], info: { strona: body.strona, powod, metoda: d[x + "_metoda"], stwierdzono, ten_sam: tenSam } });
        await przelicz(store, p.id);
        await powiadom("odrzucono", p, d);
        return json({ ok: true }, 200, o);
      }
      return json({ error: "Brak decyzji." }, 400, o);
    }

    // actions on a package
    const pid = String(body.pakiet ?? body.id ?? "");
    p = UUID.test(pid) ? await store.pakiet(pid) : null;
    if (!p) return json({ error: "Nie ma takiego pakietu." }, 404, o);
    if (action === "pakiet") return json({ pakiet: pakOut(p, await store.dokumenty([p.id]), "biuro"), log: await store.logi(p.id) }, 200, o);
    if (action === "dokument_dodaj") {
      if (p.status !== "szkic") return json({ error: "Dokumenty można dodawać tylko do niewydanego pakietu." }, 409, o);
      const rodzaj = String(body.rodzaj ?? ""), tytul = txt(body.tytul, 200);
      if (!C.RODZAJE[rodzaj]) return json({ error: "Nieznany rodzaj dokumentu." }, 400, o);
      if (tytul.length < 3) return json({ error: "Podaj tytuł dokumentu." }, 400, o);
      let podpisuje = C.PODPISUJE[String(body.podpisuje ?? "")] ? String(body.podpisuje) : C.domyslniePodpisuje(rodzaj, p.cudzoziemiec);
      // art. 29 § 3 KP: delivered, never signed here; and nothing else is "acknowledge only"
      if (rodzaj === "informacja_warunki") podpisuje = "potwierdzenie";
      else if (podpisuje === "potwierdzenie") return json({ error: "Samo potwierdzenie odbioru dotyczy tylko informacji o warunkach zatrudnienia." }, 400, o);
      const czesc = /^[A-EZ]$/.test(String(body.czesc ?? "")) ? String(body.czesc) : p.typ === "zlecenie" ? "Z" : "B";
      if (!plik) return json({ error: "Brak pliku." }, 400, o);
      const bytes = new Uint8Array(await plik.arrayBuffer());
      if (!bytes.length || bytes.length > C.MAX_BYTES) return json({ error: C.ERR.rozmiar, kod: "rozmiar" }, 413, o);
      if (C.sniff(bytes) !== "pdf") return json({ error: "Do podpisu wydajemy tylko pliki PDF.", kod: "typ" }, 400, o);
      const docs = await store.dokumenty([p.id]);
      if (docs.length >= MAX_DOK) return json({ error: `Pakiet może mieć najwyżej ${MAX_DOK} dokumentów.` }, 400, o);
      const id = crypto.randomUUID(), sha = await C.sha256(bytes), path = `${p.id}/${id}/wydany-${rand()}.pdf`;
      if (!await store.filePut(path, bytes, "application/pdf")) return json({ error: "Nie udało się zapisać pliku." }, 502, o);
      const d = await store.dokInsert({
        id, pakiet_id: p.id, lp: docs.reduce((mx: number, x: Any) => Math.max(mx, x.lp), 0) + 1, rodzaj, tytul, czesc, podpisuje, ...C.kroki(podpisuje), status: "u_pracodawcy",
        wydany_path: path, wydany_nazwa: C.plainName(tytul, 60) + ".pdf", wydany_sha256: sha, wydany_rozmiar: bytes.length,
      });
      await zapisz(c, { pakiet_id: p.id, dokument_id: d.id, akcja: "dokument_dodany", sha256: sha, info: { rodzaj, tytul, podpisuje, czesc, rozmiar: bytes.length } });
      return json({ ok: true, dokument: dokOut({ ...d, status: C.statusDok(d) }, p, "biuro") }, 200, o);
    }
    if (action === "wydaj") {
      if (p.status !== "szkic") return json({ error: "Pakiet jest już wydany." }, 409, o);
      if (!(await store.dokumenty([p.id])).length) return json({ error: "Pakiet nie ma jeszcze żadnego dokumentu." }, 400, o);
      await store.pakietPatch(p.id, { status: "u_pracodawcy", wydano_at: new Date().toISOString() });
      await przelicz(store, p.id);
      await zapisz(c, { pakiet_id: p.id, akcja: "wydanie" });
      await powiadom("wydano", p);
      return json({ ok: true, pakiet: pakOut((await store.pakiet(p.id))!, await store.dokumenty([p.id]), "biuro") }, 200, o);
    }
    if (action === "link") {
      if (["szkic", "anulowany"].includes(p.status)) return json({ error: "Link można utworzyć dla wydanego, nieanulowanego pakietu." }, 409, o);
      const dni = Math.min(LINK_DNI_MAX, Math.max(1, Math.round(Number(body.dni) || LINK_DNI)));
      const token = newToken(), wazny = new Date(Date.now() + dni * 86400000).toISOString();
      // a new link replaces the old one: only one is ever valid
      await store.pakietPatch(p.id, { link_hash: await C.sha256Text(token), link_expires: wazny, link_at: new Date().toISOString(), link_by: me });
      await zapisz(c, { pakiet_id: p.id, akcja: "link_utworzony", info: { wazny_do: wazny, zastapil: !!p.link_hash } });
      const url = `${deps.app}podpis.html#t=${token}`;
      return json({ ok: true, url, wazny_do: wazny, wiadomosc: wiadomosc(p, url, wazny) }, 200, o);
    }
    if (action === "link_uniewaznij") {
      await store.pakietPatch(p.id, { link_hash: null, link_expires: null });
      await zapisz(c, { pakiet_id: p.id, akcja: "link_uniewazniony" });
      return json({ ok: true }, 200, o);
    }
    if (action === "anuluj") {
      if (p.status === "zakonczony" || p.status === "anulowany") return json({ error: "Tego pakietu nie można już anulować." }, 409, o);
      const powod = txt(body.powod, 500);
      if (powod.length < 3) return json({ error: "Podaj powód anulowania." }, 400, o);
      await store.pakietPatch(p.id, { status: "anulowany", anulowano_at: new Date().toISOString(), anulowano_by: me, anulowano_powod: powod, link_hash: null, link_expires: null });
      for (const d of await store.dokumenty([p.id])) await store.dokPatch(d.id, { status: "anulowany" });
      await zapisz(c, { pakiet_id: p.id, akcja: "anulowanie", info: { powod } });
      await powiadom("anulowano", p);
      return json({ ok: true }, 200, o);
    }
    if (action === "zakoncz") {
      if (p.status !== "gotowy") return json({ error: "Pakiet można zamknąć, gdy wszystkie dokumenty są podpisane (albo potwierdzone) i zweryfikowane." }, 409, o);
      const docs = (await store.dokumenty([p.id])).sort((a, b) => a.lp - b.lp);
      let n = 0;
      for (const d of docs) {
        if (d.status === "w_aktach") continue; // closing can be repeated after a failure
        if (C.statusDok(d) !== "gotowy") return json({ error: "Nie wszystkie dokumenty są gotowe." }, 409, o);
        const ids = await doAkt(c, p, d);
        if (!ids) {
          await zapisz(c, { pakiet_id: p.id, dokument_id: d.id, akcja: "do_akt", wynik: "blad" });
          return json({ error: `Nie udało się przenieść do akt dokumentu „${d.tytul}” — spróbuj ponownie (przeniesione wcześniej dokumenty nie zostaną zdublowane).`, przeniesiono: n }, 502, o);
        }
        await store.dokPatch(d.id, { status: "w_aktach", akta_ids: ids });
        await zapisz(c, { pakiet_id: p.id, dokument_id: d.id, akcja: "do_akt", info: { akta_ids: ids, czesc: d.czesc, pliki: C.finalne(d) } });
        n += ids.length;
      }
      await store.pakietPatch(p.id, { status: "zakonczony", zakonczono_at: new Date().toISOString(), zakonczono_by: me });
      await zapisz(c, { pakiet_id: p.id, akcja: "zakonczenie", info: { plikow: n, przypisane: !!p.zgloszenie_id } });
      await powiadom("zakonczono", p);
      return json({ ok: true, plikow: n, przypisane: !!p.zgloszenie_id }, 200, o);
    }
    return json({ error: "Nieznana akcja." }, 400, o);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
}
