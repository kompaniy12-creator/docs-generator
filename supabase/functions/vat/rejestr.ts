// Builds the row of public.vat_sprawdzenia for one check. Pure — covered by rejestr_test.ts.
import { dzisPL } from "./walidacja.ts";

export type Rodzaj = "wl_search" | "wl_check" | "vies";
export type Wpis = {
  kto: string; rodzaj: Rodzaj; zapytanie: Record<string, unknown>; nip: string | null; nazwa: string | null; wynik: string;
  na_dzien: string | null; request_id: string | null; request_time: string | null; szczegoly: Record<string, unknown>;
};
const s = (v: unknown, max: number) => typeof v === "string" && v ? v.slice(0, max) : null;

// zap  — the validated question: {by, value, date} | {nip, konto, date} | {kraj, numer, wlasny}
// out  — what the function returns to the page (already trimmed, no persons' data), or null when upstream failed
// blad — the upstream error, when there is no answer
// deno-lint-ignore no-explicit-any
export function wierszRejestru(rodzaj: Rodzaj, kto: string, zap: any, out: any, blad: { message: string; kod: string } | null, teraz: Date = new Date()): Wpis {
  const w: Wpis = { kto, rodzaj, zapytanie: zap, nip: null, nazwa: null, wynik: "", na_dzien: s(zap.date, 10), request_id: null, request_time: null, szczegoly: out ?? {} };
  if (rodzaj === "wl_search") w.nip = zap.by === "nip" ? zap.value : null;
  else if (rodzaj === "wl_check") w.nip = zap.nip;
  else { w.nip = zap.kraj === "PL" ? zap.numer : zap.kraj + zap.numer; w.na_dzien = dzisPL(teraz); } // VIES answers for the moment of asking

  if (blad) {
    w.wynik = ("błąd " + (blad.kod || "")).trim().slice(0, 60);
    w.szczegoly = { error: blad.message.slice(0, 500), kod: blad.kod || null };
    return w;
  }
  if (rodzaj === "wl_search") {
    const p = Array.isArray(out.podmioty) ? out.podmioty : [];
    w.wynik = p.length === 0 ? "brak w wykazie" : p.length === 1 ? (s(p[0].status, 40) ?? "brak statusu") : `${p.length} podmioty: ` + p.map((x: { status?: string }) => x.status ?? "?").join(", ").slice(0, 160);
    if (p.length) { w.nazwa = (s(p[0].nazwa, 300) ?? "") + (p.length > 1 ? ` (+${p.length - 1})` : "") || null; if (!w.nip && p.length === 1) w.nip = s(p[0].nip, 10); }
    w.request_id = s(out.requestId, 60); w.request_time = s(out.requestDateTime, 40);
  } else if (rodzaj === "wl_check") {
    w.wynik = out.przypisany;
    w.request_id = s(out.requestId, 60); w.request_time = s(out.requestDateTime, 40);
  } else {
    w.wynik = out.wazny ? "ważny" : "nieważny";
    w.nazwa = s(out.nazwa, 300);
    w.request_id = s(out.identyfikator, 60); w.request_time = s(out.dataZapytania, 40);
    const d = new Date(String(out.dataZapytania ?? ""));
    if (!isNaN(d.getTime())) w.na_dzien = dzisPL(d);
  }
  return w;
}
