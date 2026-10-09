// Local harness for the client profile: serves the repository and answers the two functions the page
// calls with portal.ts over the in-memory store (fictional data). No database, no real session:
//   deno run --allow-net=127.0.0.1 --allow-read=. supabase/functions/klient/harness.ts [port]
// then open http://127.0.0.1:<port>/klient/ and put a harness token into localStorage
// (tdcg_klient_sesja = "harness-A-0000000000000000" or "harness-B-0000000000000000").
import { biuroAkcja, klientAkcja, type Plik } from "./portal.ts";
import { ID, KONTO_A, KONTO_B, memStore, NIP_A } from "./memstore.ts";

const port = Number(Deno.args[0] ?? "8831");
const m = memStore();
const deps = { store: m.store, now: () => Date.now() };
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css", png: "image/png", svg: "image/svg+xml", json: "application/json", woff2: "font/woff2", jpg: "image/jpeg" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const konto = (req: Request) => { const t = req.headers.get("x-klient-token") ?? ""; return t.startsWith("harness-A-") ? KONTO_A : t.startsWith("harness-B-") ? KONTO_B : null; };
const metody = [{ id: "kwalifikowany", nazwa: "kwalifikowany podpis elektroniczny" }, { id: "zaufany", nazwa: "podpis zaufany" }, { id: "odreczny", nazwa: "podpis odręczny — wydruk i skan" }];
const krok = (status: string) => ({ status, metoda: null, metoda_nazwa: null, at: status === "oczekuje" ? null : new Date().toISOString(), wgral: null, odrzucenie: null });
const PAKIETY = [{
  id: ID.pakA, firma: "Przykładowa Firma Testowa Sp. z o.o.", nip: NIP_A, worker_name: "Oksana Testowa", typ: "zlecenie", bez_pesel: false, status: "u_pracodawcy", status_nazwa: "u pracodawcy", wydano_at: new Date().toISOString(),
  dokumenty: [
    { id: ID.dokA1, tytul: "Umowa zlecenia", rodzaj_nazwa: "umowa zlecenia", podpisuje: "obie", podpisuje_nazwa: "obie strony", status: "u_pracodawcy", status_nazwa: "czeka na podpis pracodawcy", zadanie: "podpisz", pliki: ["wydany"], finalne: [],
      pracodawca: krok("oczekuje"), pracownik: krok("oczekuje"), reguly: { pracodawca: { metody, podstawa: "Umowa zlecenia — forma dokumentowa wystarcza (art. 77² Kodeksu cywilnego)." }, pracownik: { metody } } },
    { id: ID.dokA2, tytul: "Informacja o przetwarzaniu danych", rodzaj_nazwa: "zgoda / informacja RODO", podpisuje: "pracownik", podpisuje_nazwa: "pracownik", status: "gotowy", status_nazwa: "gotowy", zadanie: "nic", pliki: ["wydany", "pracownik"], finalne: ["pracownik"],
      pracodawca: krok("nie_dotyczy"), pracownik: { ...krok("zweryfikowany"), baza: "wydany" }, reguly: { pracodawca: { metody: [], podstawa: "" }, pracownik: { metody } } },
  ],
}];

Deno.serve({ port, hostname: "127.0.0.1" }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/fn/klient") {
    const k = konto(req);
    let body: Record<string, unknown> = {};
    const pliki: Plik[] = [];
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/")) {
      for (const [key, v] of (await req.formData()).entries()) {
        if (typeof v === "string") body[key] = v; else pliki.push({ nazwa: v.name, typ: v.type, bytes: new Uint8Array(await v.arrayBuffer()) });
      }
    } else body = await req.json();
    // the office's preview: a made-up administrator token of the harness
    if (body.action === "biuro_podglad") {
      if (req.headers.get("authorization") !== "Bearer harness-admin") return json({ error: "Tylko pracownik biura (portal)." }, 403);
      const o = await biuroAkcja(deps, { email: "admin@biuro.test", admin: true, sekcje: null }, body);
      return json(o.body, o.status);
    }
    if (!k) return json({ error: "Sesja wygasła — zaloguj się ponownie.", wyloguj: true }, 401);
    if (body.action === "logout") return json({ ok: true });
    if (body.action === "me") return json({ email: k.email, nazwa: k.nazwa, firmy: await Promise.all(k.nip.map(async (n) => ({ nip: n, nazwa: (await m.store.klient(n)).dane?.nazwa ?? n }))) });
    const o = await klientAkcja(deps, k, body, pliki);
    return o ? json(o.body, o.status) : json({ error: "Nieznana akcja." }, 400);
  }
  if (req.method === "POST" && url.pathname === "/fn/podpisy") {
    const k = konto(req);
    if (!k) return json({ error: "Sesja wygasła — zaloguj się ponownie.", wyloguj: true }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === "lista") return json({ pakiety: PAKIETY.filter((p) => p.nip === body.nip && k.nip.includes(p.nip)) });
    return json({ error: "W makiecie pliki nie są dostępne." }, 404);
  }
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith("/")) path += "index.html";
  if (path.includes("..")) return new Response("nie", { status: 400 });
  try {
    let data = await Deno.readFile("." + path);
    if (path === "/klient/klient.js") {
      data = new TextEncoder().encode(new TextDecoder().decode(data)
        .replace("https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/klient", "/fn/klient").replace("https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/podpisy", "/fn/podpisy"));
    }
    return new Response(data, { headers: { "Content-Type": TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream", "Cache-Control": "no-store" } });
  } catch { return new Response("brak", { status: 404 }); }
});
