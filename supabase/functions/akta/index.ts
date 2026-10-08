// Akta osobowe: reads a scanned document and files it under the right firm, worker and part.
//
// POST { action: "rozpoznaj", id }   portal JWT, Kadry section
//   Loads the scan (bucket akta-osobowe), asks the model who the document is about, which
//   employer, what kinds of documents are inside and to which part of the personnel file they
//   belong (A–E per § 3 of the regulation on employee documentation; Z = civil-law contractor),
//   then looks the person up among the office's workers. A clear match is filed at once;
//   anything doubtful goes to "do sprawdzenia" with the candidates, for a person to decide.
//   Nothing is ever filed on a guess.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-opus-4-8";
const BUCKET = "akta-osobowe";
const MAX_BYTES = 24 * 1024 * 1024;

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
async function portalKadry(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const m = u?.app_metadata ?? {};
  const kadry = m.portal_admin === true || !Array.isArray(m.portal_sections) || m.portal_sections.includes("kadry");
  return m.portal === true && kadry ? String(u.email ?? "") : null;
}

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["analiza", "pracownik", "pracodawca", "dokumenty", "rodzaj", "czesc", "data", "strony", "pewnosc", "uwagi"],
  properties: {
    analiza: { type: "string", description: "Krótko: co widać w skanie i po czym rozpoznano osobę i pracodawcę." },
    pracownik: {
      type: "object", additionalProperties: false, required: ["imie", "nazwisko", "pesel", "data_urodzenia"],
      properties: { imie: { type: "string" }, nazwisko: { type: "string" }, pesel: { type: "string" }, data_urodzenia: { type: "string", description: "RRRR-MM-DD albo pusty" } },
    },
    pracodawca: { type: "object", additionalProperties: false, required: ["nazwa", "nip"], properties: { nazwa: { type: "string" }, nip: { type: "string" } } },
    dokumenty: {
      type: "array", description: "Każdy odrębny dokument w skanie, w kolejności stron.",
      items: {
        type: "object", additionalProperties: false, required: ["strony", "rodzaj", "czesc", "data"],
        properties: { strony: { type: "string", description: "np. 1 albo 2-4" }, rodzaj: { type: "string" }, czesc: { type: "string", enum: ["A", "B", "C", "D", "E", "Z"] }, data: { type: "string", description: "data dokumentu RRRR-MM-DD albo pusty" } },
      },
    },
    rodzaj: { type: "string", description: "Rodzaj głównego dokumentu albo „teczka — N dokumentów”." },
    czesc: { type: "string", enum: ["A", "B", "C", "D", "E", "Z"], description: "Część akt głównego dokumentu." },
    data: { type: "string", description: "Data głównego dokumentu RRRR-MM-DD albo pusty." },
    strony: { type: "integer" },
    pewnosc: { type: "string", enum: ["wysoka", "srednia", "niska"] },
    uwagi: { type: "string", description: "Wątpliwości: nieczytelne fragmenty, kilka osób w jednym skanie, brak podpisu itp. Pusty, gdy brak." },
  },
};
const PROMPT = `To skan dokumentu (albo kilku dokumentów) z papierowych akt osobowych prowadzonych przez biuro kadrowe w Polsce.
Ustal: 1) kogo dotyczy — pracownika / zleceniobiorcę (imię, nazwisko, PESEL i data urodzenia, jeśli są widoczne), 2) pracodawcę / zleceniodawcę (nazwa, NIP), 3) jakie dokumenty są w skanie, na których stronach i do której części akt osobowych należą.

Części akt osobowych (§ 3 rozporządzenia w sprawie dokumentacji pracowniczej):
A — ubieganie się o zatrudnienie: kwestionariusz osobowy kandydata, świadectwa pracy z poprzednich miejsc, dyplomy i świadectwa, skierowania na badania lekarskie i orzeczenia lekarskie (badania wstępne, okresowe, kontrolne).
B — nawiązanie i przebieg zatrudnienia: kwestionariusz osobowy pracownika, umowa o pracę i aneksy, zakres czynności, informacja o warunkach zatrudnienia, potwierdzenia zapoznania się (regulamin pracy, BHP, ryzyko zawodowe, RODO, monitoring), szkolenia BHP, wypowiedzenia zmieniające, odpowiedzialność materialna, urlopy rodzicielskie / wychowawcze / bezpłatne, oświadczenia rodzica, PIT-2, PPK, praca zdalna, nagrody, podnoszenie kwalifikacji, dokumenty legalizujące pobyt i pracę cudzoziemca.
C — ustanie zatrudnienia: wypowiedzenie lub porozumienie o rozwiązaniu umowy, kopia świadectwa pracy, wnioski o świadectwo pracy, zajęcia komornicze, umowa o zakazie konkurencji po ustaniu zatrudnienia.
D — kary porządkowe i odpowiedzialność porządkowa.
E — kontrola trzeźwości lub środków działających podobnie do alkoholu.
Z — dokumenty zleceniobiorcy lub wykonawcy dzieła (umowa zlecenie / o dzieło, rachunki, oświadczenia zleceniobiorcy) — to nie są akta osobowe pracownika.

Zasady: niczego nie zgaduj. Jeśli pole nie jest widoczne — zostaw puste. Imię i nazwisko przepisz dokładnie tak, jak w dokumencie (łacińskimi literami). PESEL tylko gdy jest czytelny w całości (11 cyfr). Gdy skan dotyczy kilku osób albo nie da się ustalić osoby, napisz to w „uwagi” i ustaw pewność „niska”.`;

// deno-lint-ignore no-explicit-any
type Any = any;
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/gi, "l").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function workers(): Promise<Any[]> {
  const out: Any[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db("zatrudnienie_zgloszenia?select=id,worker_name,status,payload->>z_nip,payload->>z_nazwa,payload->>p_pesel,payload->>p_dataur,payload->>p_imiona,payload->>p_nazwisko", { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) throw new Error("pracownicy: " + r.status);
    const part = await r.json();
    out.push(...part);
    if (part.length < 1000) break;
  }
  return out;
}
const TOO_BIG = "Plik jest za duży do automatycznego odczytu (ponad 24 MB) — zeskanuj w niższej rozdzielczości albo podziel na części.";
// how well a worker fits what was read: PESEL decides, otherwise the name plus the employer or the birth date
function score(w: Any, a: Any): number {
  const pesel = digits(a.pracownik.pesel);
  if (pesel.length === 11 && digits(w.p_pesel) === pesel) {
    // a PESEL alone is not enough to file without a person: the surname read from the scan must agree too
    const sur = norm(a.pracownik.nazwisko ?? "");
    return sur && norm(w.worker_name || `${w.p_imiona} ${w.p_nazwisko}`).split(" ").includes(sur) ? 100 : 70;
  }
  const want = norm(`${a.pracownik.imie} ${a.pracownik.nazwisko}`).split(" ").filter(Boolean).sort().join(" ");
  const have = norm(w.worker_name || `${w.p_imiona} ${w.p_nazwisko}`).split(" ").filter(Boolean).sort().join(" ");
  if (!want || !have) return 0;
  let s = 0;
  if (want === have) s = 60;
  else {
    const A = want.split(" "), B = have.split(" ");
    const common = A.filter((x) => B.includes(x)).length;
    // the surname and at least one given name, e.g. a second name missing on one side
    if (common >= 2 && norm(a.pracownik.nazwisko).split(" ").every((x) => B.includes(x))) s = 45;
    else return 0;
  }
  const nip = digits(a.pracodawca.nip);
  if (nip.length === 10 && digits(w.z_nip) === nip) s += 30;
  else { const fn = norm(a.pracodawca.nazwa).replace(/\b(spolka|z|o|ograniczona|odpowiedzialnoscia|sp|sa)\b/g, "").trim(), wn = norm(w.z_nazwa); if (fn.length > 3 && (wn.includes(fn) || fn.includes(wn.replace(/\b(sp|z|o)\b/g, "").trim()))) s += 22; }
  if (isDate(a.pracownik.data_urodzenia) && w.p_dataur === a.pracownik.data_urodzenia) s += 20;
  return s;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const me = await portalKadry(req);
  if (!me) return json({ error: "Brak dostępu (portal, sekcja Kadry)." }, 403, origin);
  if (!ANTHROPIC_KEY) return json({ error: "Brak konfiguracji odczytu dokumentów." }, 500, origin);
  let body: Any;
  try { body = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400, origin); }
  if (body.action !== "rozpoznaj" || !/^[0-9a-f-]{36}$/i.test(body.id ?? "")) return json({ error: "Nieznana akcja." }, 400, origin);
  const id = body.id;
  const fail = async (msg: string) => { await db(`akta_dokumenty?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "blad", uwagi: msg }) }); return json({ error: msg }, 200, origin); };

  try {
    const r = await db(`akta_dokumenty?id=eq.${id}&select=*`);
    const row = r.ok ? (await r.json())[0] : null;
    if (!row) return json({ error: "Nie znaleziono dokumentu." }, 404, origin);
    // the path comes from a row the browser inserted: accept only "<row id>/<plain file name>" inside our bucket
    if (typeof row.path !== "string" || !/^[0-9a-f-]{36}\/[A-Za-z0-9_.\-]+$/i.test(row.path) || row.path.includes("..") || !row.path.startsWith(row.id + "/")) return await fail("Nieprawidłowa ścieżka pliku.");
    if (Number(row.rozmiar) > MAX_BYTES) return await fail(TOO_BIG);
    // one reading at a time per document (each one is a paid request)
    if (row.status === "analiza" && Date.now() - Date.parse(row.analiza_at ?? "") < 120000) return json({ error: "Ten dokument jest właśnie odczytywany." }, 200, origin);
    await db(`akta_dokumenty?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "analiza", analiza_at: new Date().toISOString() }) });

    const f = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${row.path.split("/").map(encodeURIComponent).join("/")}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    if (!f.ok) return await fail("Nie udało się odczytać pliku z magazynu.");
    if (Number(f.headers.get("content-length") ?? 0) > MAX_BYTES) return await fail(TOO_BIG);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.length > MAX_BYTES) return await fail(TOO_BIG);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const mime = row.mime || (row.nazwa.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    const block = mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mime, data: btoa(bin) } }
      : { type: "image", source: { type: "base64", media_type: /^image\/(jpeg|png|webp|gif)$/.test(mime) ? mime : "image/jpeg", data: btoa(bin) } };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }], output_config: { format: { type: "json_schema", schema: SCHEMA } } }),
    });
    if (!res.ok) { console.error("model", res.status, (await res.text()).slice(0, 300)); return await fail("Odczyt nie powiódł się (" + res.status + ") — spróbuj ponownie albo przypisz ręcznie."); }
    const out = await res.json();
    const text = (out.content ?? []).find((b: Any) => b.type === "text")?.text;
    let a: Any;
    try { a = JSON.parse(text); } catch { return await fail("Odczyt zwrócił nieczytelną odpowiedź — spróbuj ponownie albo przypisz ręcznie."); }

    // the uploader may have said which firm the scans belong to: then only its workers are considered
    const hint = digits(row.nip);
    const all = (await workers()).filter((w) => hint.length !== 10 || digits(w.z_nip) === hint);
    const ranked = all.map((w) => ({ w, s: score(w, a) })).filter((x) => x.s >= 45).sort((x, y) => y.s - x.s);
    const best = ranked[0], second = ranked[1];
    // filed automatically only when the match is strong, unique, and the model was not in doubt
    const sure = !!best && best.s >= 80 && (!second || best.s - second.s >= 15) && a.pewnosc !== "niska";
    const patch: Any = {
      status: sure ? "przypisany" : "do_sprawdzenia",
      rodzaj: String(a.rodzaj ?? "").slice(0, 200) || null, czesc: a.czesc ?? null, data_dok: isDate(a.data) ? a.data : null,
      strony: Number(a.strony) || null, spis: Array.isArray(a.dokumenty) ? a.dokumenty.slice(0, 80) : [],
      uwagi: String(a.uwagi ?? "").slice(0, 600) || null,
      ai: { pracownik: a.pracownik, pracodawca: a.pracodawca, pewnosc: a.pewnosc, analiza: String(a.analiza ?? "").slice(0, 600), kandydaci: ranked.slice(0, 5).map((x) => ({ id: x.w.id, nazwa: x.w.worker_name, firma: x.w.z_nazwa, nip: x.w.z_nip, status: x.w.status, wynik: x.s })) },
    };
    if (sure) Object.assign(patch, { worker_id: best.w.id, worker_name: best.w.worker_name, nip: digits(best.w.z_nip) || null, firma: best.w.z_nazwa ?? null });
    else {
      // at least the firm, when the employer on the paper is one of our clients
      const nip = digits(a.pracodawca.nip) || hint;
      if (nip.length === 10) { const k = await db(`portal_klienci?nip=eq.${nip}&select=dane`); const kl = k.ok ? (await k.json())[0] : null; if (kl) Object.assign(patch, { nip, firma: kl.dane?.nazwa ?? a.pracodawca.nazwa }); }
      patch.worker_name = [a.pracownik.imie, a.pracownik.nazwisko].filter(Boolean).join(" ") || null;
    }
    await db(`akta_dokumenty?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    return json({ ok: true, status: patch.status }, 200, origin);
  } catch (e) {
    console.error(e);
    return await fail("Błąd podczas odczytu — spróbuj ponownie.");
  }
});
