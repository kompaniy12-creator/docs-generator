// Asystenci AI — the request handler, with everything that touches the outside handed in (index.ts
// wires the real database, storage and model; the tests wire fakes).
//
// EVERY action passes the test-mode gate first: portal administrator AND on the testers list.

import { asystent, ASYSTENCI, publiczne, walidujWejscie } from "./definicje.ts";
import { type Any, bramka, digits, type Dzis, dzisWarszawa, type Ja, type Jezyk, jezykKlienta, normalizujUstawienia, nowySlad, okNip, okUuid, type Plik, plusDni, sprawdzLimity, sprawdzPliki, type Ustawienia, walidujUstawienia } from "./logic.ts";
import { CENY, DOSTAWCA, GRANICE, MAX_ITERACJI, MAX_PLIK, MODELE, PRZERWANY_PO_MS } from "./modele.ts";
import type { Ctx, Store } from "./narzedzia.ts";
import { type Model, przebieg, tlumaczRu } from "./silnik.ts";

export const KLUCZ_USTAWIEN = "asystenci";
export const BUCKET = "asystenci-pliki";

// the runs table and the files kept for review — the only things this function ever writes
export interface Baza {
  ustawienia(): Promise<Any>;
  zapiszUstawienia(u: Ustawienia): Promise<void>;
  limit(klucz: string, max: number): Promise<boolean>;               // atomic daily counter; false = cap reached or no counter
  nowy(row: Any): Promise<string>;
  zmien(id: string, patch: Any): Promise<void>;
  jeden(id: string): Promise<Any | null>;
  ostatnie(od: string): Promise<Any[]>;                              // light rows since a day: created_at, kto, asystent, status, tokens, cost …
  usunStarsze(granica: string): Promise<{ usunieto: number; pliki: string[] }>;
  usun(id: string): Promise<string[]>;                               // -> paths of its kept files
  plikZapisz(path: string, bajty: Uint8Array, mime: string): Promise<boolean>;
  plikiUsun(paths: string[]): Promise<void>;
  plikUrl(path: string): Promise<string | null>;
}
export type Zaleznosci = {
  ja(req: Request): Promise<Ja | null>;
  baza: Baza; store: Store; model: Model; modelGotowy: boolean;
  teraz(): Date;
  wTle(p: Promise<unknown>): void;   // keeps the worker alive until the run is written down
};

function cors(origin: string | null) {
  return { "Access-Control-Allow-Origin": origin ?? "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" };
}
const KOLUMNY_LISTY = ["id", "created_at", "kto", "asystent", "tryb", "model", "status", "tokeny_we", "tokeny_wy", "tokeny_cache_r", "tokeny_cache_w", "koszt_usd", "czas_ms", "iteracje", "ocena", "blad", "kontekst"];
const lekki = (r: Any) => Object.fromEntries(KOLUMNY_LISTY.map((k) => [k, r[k] ?? null]));
const tokeny = (r: Any) => (r.tokeny_we ?? 0) + (r.tokeny_wy ?? 0) + (r.tokeny_cache_r ?? 0) + (r.tokeny_cache_w ?? 0);
const wToku = (r: Any, teraz: Date) => r.status === "w_toku" && teraz.getTime() - Date.parse(r.created_at) < PRZERWANY_PO_MS;
// a run nobody finished (the worker died) is shown as interrupted, never as running for ever
const zeStanem = (r: Any, teraz: Date) => (r.status === "w_toku" && !wToku(r, teraz) ? { ...r, status: "przerwany", blad: "Uruchomienie zostało przerwane (limit czasu serwera)." } : r);

function dzisiaj(rows: Any[], dzien: string, kto: string): Dzis {
  const d = rows.filter((r) => dzisWarszawa(new Date(r.created_at)) === dzien);
  return { moje: d.filter((r) => r.kto === kto).length, razem: d.length, koszt_usd: Math.round(d.reduce((s, r) => s + Number(r.koszt_usd ?? 0), 0) * 1e6) / 1e6 };
}

export async function obsluz(req: Request, d: Zaleznosci): Promise<Response> {
  const origin = req.headers.get("Origin");
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ---- the gate: before the body is even read
  const ja = await d.ja(req).catch(() => null);
  let ust: Ustawienia;
  try { ust = normalizujUstawienia(await d.baza.ustawienia()); } catch { return json({ error: "Ustawienia asystentów są niedostępne." }, 503); }
  const odmowa = bramka(ja, ust);
  if (odmowa || !ja) return json({ error: odmowa?.error ?? "Brak dostępu.", kod: odmowa?.kod }, odmowa?.status ?? 403);

  if (Number(req.headers.get("content-length") ?? "0") > 22 * 1024 * 1024) return json({ error: "Żądanie jest za duże." }, 413);
  let b: Any;
  try { b = await req.json(); } catch { return json({ error: "Nieprawidłowy JSON." }, 400); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "Nieprawidłowy JSON." }, 400);
  const teraz = d.teraz(), dzien = dzisWarszawa(teraz), kto = ja.email.toLowerCase();

  try {
    switch (b.action) {
      case "lista": {
        const rows = await d.baza.ostatnie(plusDni(dzien, -1));
        return json({
          ja: { email: ja.email }, tryb_testowy: true, dostawca: DOSTAWCA, model_gotowy: d.modelGotowy, dzis: dzisiaj(rows, dzien, kto),
          ustawienia: ust, granice: GRANICE, modele: MODELE.map((id) => ({ id, cena: CENY[id] })), limity_przebiegu: { rundy: MAX_ITERACJI, plik_mb: MAX_PLIK / 1048576 },
          asystenci: ASYSTENCI.map((a) => ({ ...publiczne(a), wlaczony: !ust.wylaczone.includes(a.id), model: ust.modele[a.id] ?? a.model, model_domyslny: a.model })),
          w_toku: rows.filter((r) => r.kto === kto && wToku(r, teraz)).map((r) => r.id),
        });
      }

      case "slownik": {
        if (b.co === "klienci") return json({ klienci: (await d.store.klienci()).filter((k) => okNip(digits(k.nip))).map((k) => ({ nip: digits(k.nip), nazwa: String(k.nazwa).slice(0, 160), jezyk: jezykKlienta(k.jezyk), opiekun: k.opiekun || "", kadrowy: k.kadrowy || "" })) });
        if (b.co === "pracownicy") {
          const nip = digits(b.nip);
          if (!okNip(nip)) return json({ error: "Podaj NIP klienta." }, 400);
          return json({ pracownicy: (await d.store.pracownicy(nip)).filter((w) => digits(w.payload?.z_nip) === nip).map((w) => ({ id: w.id, nazwa: String(w.worker_name ?? "").slice(0, 120), status: w.status })).sort((p, q) => p.nazwa.localeCompare(q.nazwa, "pl")) });
        }
        if (b.co === "wiadomosci") return json({ wiadomosci: (await d.store.poczta()).slice(0, 40).map((m) => ({ id: m.id, data: String(m.data ?? m.created_at ?? "").slice(0, 16), od: String(m.od_nazwa || m.od_adres || "").slice(0, 80), temat: String(m.temat ?? "").slice(0, 160), kategoria: m.kategoria ?? "" })) });
        if (b.co === "akty") return json({ akty: (await d.store.prawo()).map((p) => ({ eli: p.eli, skrot: String(p.skrot || p.tytul || "").slice(0, 160), zmiana: String(p.change_date ?? "").slice(0, 10), wykryta: !!p.zmiana_wykryta })).sort((p, q) => q.zmiana.localeCompare(p.zmiana)) });
        return json({ error: "Nieznany słownik." }, 400);
      }

      case "uruchom": {
        const a = asystent(b.asystent);
        if (!a) return json({ error: "Nie ma takiego asystenta." }, 404);
        if (ust.wylaczone.includes(a.id)) return json({ error: "Ten asystent jest wyłączony w ustawieniach.", kod: "wylaczony" }, 409);
        if (!d.modelGotowy) return json({ error: "Brak konfiguracji dostępu do modelu (ANTHROPIC_API_KEY)." }, 503);
        const pl = sprawdzPliki(b.pliki);
        if (pl.blad) return json({ error: pl.blad }, 400);
        const wal = walidujWejscie(a, b.wejscie, pl.pliki, dzien);
        if (!wal.wejscie) return json({ error: wal.blad ?? "Niepoprawne dane." }, 400);
        const w = wal.wejscie;

        // the firm of the run must exist in the clients base; a client simulation is locked to it
        let jezyk: Jezyk | null = null;
        if (w.nip) {
          const k = (await d.store.klienci()).find((x) => digits(x.nip) === w.nip);
          if (!k) return json({ error: "Nie ma takiego NIP w bazie klientów." }, 404);
          if (a.odbiorca === "klient") jezyk = jezykKlienta(k.jezyk);
        }
        // limits: what was already spent today, one run at a time per tester, then the atomic counters
        const rows = await d.baza.ostatnie(plusDni(dzien, -1));
        const lim = sprawdzLimity(ust, dzisiaj(rows, dzien, kto));
        if (lim) return json({ error: lim.error, kod: lim.kod }, lim.status);
        if (rows.some((r) => r.kto === kto && wToku(r, teraz))) return json({ error: "Poprzednie uruchomienie jeszcze trwa — poczekaj na wynik.", kod: "w_toku" }, 409);
        if (!(await d.baza.limit("asystent:" + kto, ust.limity.dziennie_osoba)) || !(await d.baza.limit("asystent:razem", ust.limity.dziennie_razem))) {
          return json({ error: "Dzienny limit uruchomień został osiągnięty.", kod: "limit_licznik" }, 429);
        }

        const modelId = ust.modele[a.id] ?? a.model;
        const ctx: Ctx = { tryb: a.odbiorca === "klient" ? "klient" : "staff", nip: w.nip || null, dzis: dzien, slad: nowySlad() };
        const kontekst = { nip: w.nip || null, worker_id: w.worker_id || null, wiadomosc_id: w.wiadomosc_id || null, okres: w.okres || null, eli: w.eli || null, opiekun: w.opiekun || null, wariant: w.wariant || null, jezyk, tekst_znakow: w.tekst.length, pliki: w.pliki.map((f) => ({ nazwa: f.nazwa, mime: f.mime, rozmiar: f.rozmiar })) };
        const id = await d.baza.nowy({ kto, asystent: a.id, tryb: ctx.tryb, kontekst, model: modelId, status: "w_toku", kroki: [] });

        const praca = (async () => {
          const start = Date.now(), kroki: { t: number; co: string }[] = [];
          let pliki: string[] = [];
          try {
            if (b.zachowaj_plik === true && w.pliki.length) pliki = await zachowaj(d.baza, id, w.pliki);
            const r = await przebieg(a, w, ctx, { model: d.model, store: d.store, modelId, jezyk, teraz: () => Date.now(), krok: async (co) => { kroki.push({ t: Date.now() - start, co }); await d.baza.zmien(id, { kroki }); } });
            let ru: Any = null, z = r.zuzycie, koszt = r.koszt_usd;
            if (r.status === "gotowe" && r.wynik && ust.ru_auto && a.odbiorca === "staff") {
              const t = await tlumaczRu(r.wynik, d.model);
              ru = t.tlumaczenie; koszt += t.koszt_usd;
              z = { we: z.we + t.zuzycie.we, wy: z.wy + t.zuzycie.wy, cache_r: z.cache_r + t.zuzycie.cache_r, cache_w: z.cache_w + t.zuzycie.cache_w };
            }
            await d.baza.zmien(id, {
              status: r.status, model: r.model, wynik: r.wynik, uwagi: r.uwagi, zapis: r.zapis, blad: r.blad ?? null, iteracje: r.iteracje, kroki,
              tokeny_we: z.we, tokeny_wy: z.wy, tokeny_cache_r: z.cache_r, tokeny_cache_w: z.cache_w, koszt_usd: Math.round(koszt * 1e6) / 1e6,
              czas_ms: Date.now() - start, koniec_at: new Date().toISOString(), pliki, tlumaczenie_ru: ru,
            });
            // retention is kept without anybody pressing a button: each run clears what is older than the setting
            const stare = await d.baza.usunStarsze(new Date(Date.now() - ust.retencja_dni * 86400000).toISOString()).catch(() => null);
            if (stare?.pliki.length) await d.baza.plikiUsun(stare.pliki);
          } catch {
            await d.baza.zmien(id, { status: "blad", blad: "Błąd wewnętrzny uruchomienia.", czas_ms: Date.now() - start, koniec_at: new Date().toISOString(), pliki, kroki }).catch(() => {});
          }
        })();
        d.wTle(praca);
        return json({ id, status: "w_toku" }, 202);
      }

      case "stan":
      case "wynik": {
        if (!okUuid(b.id)) return json({ error: "Niepoprawny identyfikator." }, 400);
        const r = await d.baza.jeden(b.id);
        if (!r) return json({ error: "Nie ma takiego uruchomienia." }, 404);
        return json({ przebieg: zeStanem(r, teraz) });
      }

      case "historia": {
        const dni = Math.max(1, Math.min(60, Number(b.dni) || 14));
        const rows = (await d.baza.ostatnie(plusDni(dzien, -dni))).map((r) => zeStanem(r, teraz));
        const poDniach: Record<string, { przebiegow: number; tokeny: number; koszt_usd: number }> = {};
        for (const r of rows) { const k = dzisWarszawa(new Date(r.created_at)); const o = (poDniach[k] ??= { przebiegow: 0, tokeny: 0, koszt_usd: 0 }); o.przebiegow++; o.tokeny += tokeny(r); o.koszt_usd = Math.round((o.koszt_usd + Number(r.koszt_usd ?? 0)) * 1e6) / 1e6; }
        return json({ przebiegi: rows.filter((r) => !b.asystent || r.asystent === b.asystent).slice(0, 100).map(lekki), dni: Object.entries(poDniach).sort((p, q) => q[0].localeCompare(p[0])).map(([dzien, v]) => ({ dzien, ...v })) });
      }

      case "ocena": {
        if (!okUuid(b.id)) return json({ error: "Niepoprawny identyfikator." }, 400);
        if (![1, 0, -1].includes(b.ocena)) return json({ error: "Ocena: 1, 0 albo -1." }, 400);
        const r = await d.baza.jeden(b.id);
        if (!r) return json({ error: "Nie ma takiego uruchomienia." }, 404);
        await d.baza.zmien(b.id, { ocena: b.ocena || null, ocena_komentarz: String(b.komentarz ?? "").trim().slice(0, 2000) || null, ocena_at: teraz.toISOString(), ocena_kto: kto });
        return json({ ok: true });
      }

      case "tlumacz_ru": {
        if (!okUuid(b.id)) return json({ error: "Niepoprawny identyfikator." }, 400);
        const r = await d.baza.jeden(b.id);
        if (!r || r.status !== "gotowe" || !r.wynik) return json({ error: "Brak gotowego wyniku do przetłumaczenia." }, 404);
        if (r.tlumaczenie_ru) return json({ tlumaczenie_ru: r.tlumaczenie_ru });
        const lim = sprawdzLimity(ust, { ...dzisiaj(await d.baza.ostatnie(plusDni(dzien, -1)), dzien, kto), moje: 0, razem: 0 });
        if (lim) return json({ error: lim.error, kod: lim.kod }, lim.status);
        if (!d.modelGotowy) return json({ error: "Brak konfiguracji dostępu do modelu." }, 503);
        const t = await tlumaczRu(r.wynik, d.model);
        // the rendering is part of the same run: its tokens and cost are added to it
        await d.baza.zmien(b.id, { tlumaczenie_ru: t.tlumaczenie, tokeny_we: (r.tokeny_we ?? 0) + t.zuzycie.we, tokeny_wy: (r.tokeny_wy ?? 0) + t.zuzycie.wy, koszt_usd: Math.round((Number(r.koszt_usd ?? 0) + t.koszt_usd) * 1e6) / 1e6 });
        if (!t.tlumaczenie) return json({ error: t.blad ?? "Tłumaczenie nie powiodło się." }, 502);
        return json({ tlumaczenie_ru: t.tlumaczenie, koszt_usd: t.koszt_usd });
      }

      case "ustawienia": {
        const wal = walidujUstawienia(b.ustawienia, ja, ASYSTENCI.map((a) => a.id));
        if (!wal.ust) return json({ error: wal.bledy.join(" "), bledy: wal.bledy }, 400);
        await d.baza.zapiszUstawienia(wal.ust);
        return json({ ok: true, ustawienia: wal.ust });
      }

      case "czysc": {
        if (b.id !== undefined) {
          if (!okUuid(b.id)) return json({ error: "Niepoprawny identyfikator." }, 400);
          await d.baza.plikiUsun(await d.baza.usun(b.id));
          return json({ ok: true, usunieto: 1 });
        }
        const w = await d.baza.usunStarsze(new Date(teraz.getTime() - ust.retencja_dni * 86400000).toISOString());
        await d.baza.plikiUsun(w.pliki);
        return json({ ok: true, usunieto: w.usunieto, retencja_dni: ust.retencja_dni });
      }

      case "plik": {
        if (!okUuid(b.id)) return json({ error: "Niepoprawny identyfikator." }, 400);
        const r = await d.baza.jeden(b.id);
        const path = (Array.isArray(r?.pliki) ? r.pliki : [])[Number(b.nr) || 0];
        if (!path) return json({ error: "To uruchomienie nie ma zachowanego pliku." }, 404);
        const url = await d.baza.plikUrl(path);
        return url ? json({ url }) : json({ error: "Plik jest niedostępny." }, 502);
      }

      default:
        return json({ error: "Nieznana akcja." }, 400);
    }
  } catch (e) {
    console.error("asystent:", b.action, e instanceof Error ? e.name : "error");
    return json({ error: "Wewnętrzny błąd serwera." }, 500);
  }
}

// files the owner ticked "zachowaj do oceny": private bucket, a path nobody can guess, removed with the run
async function zachowaj(baza: Baza, id: string, pliki: Plik[]): Promise<string[]> {
  const out: string[] = [];
  for (const [i, f] of pliki.entries()) {
    const ext = f.mime === "application/pdf" ? "pdf" : f.mime === "image/png" ? "png" : "jpg";
    const path = `${id}/${i + 1}.${ext}`;
    const bajty = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    if (await baza.plikZapisz(path, bajty, f.mime)) out.push(path);
  }
  return out;
}
