// Asystenci AI — the ONE place with model ids, prices and hard limits.
//
// Model ids and prices were read from the provider's current model table on 2026-10-09 (see the
// claude-api reference used when this file was written). Prices are USD per 1 000 000 tokens and are
// used only to ESTIMATE the cost shown to the owner; the provider's invoice is the truth.
//
// Two models on purpose:
//   GLOWNY — reasoning over several sources, law, checks, vision on documents (quality first);
//   SZYBKI — short drafts and renderings from data the code has already computed (latency first).

export const MODEL_GLOWNY = "claude-opus-5-5";
export const MODEL_SZYBKI = "claude-haiku-5-5";
export const MODELE = [MODEL_GLOWNY, MODEL_SZYBKI] as const;
export type ModelId = typeof MODELE[number];

export const DOSTAWCA = "Anthropic, PBC (USA) — Claude API";

// we: input, wy: output, cache_r: cache read, cache_w: cache write (5-minute cache = 1.25 × input)
export type Cena = { we: number; wy: number; cache_r: number; cache_w: number };
export const CENY: Record<string, Cena> = {
  "claude-opus-5-5": { we: 4, wy: 20, cache_r: 0.2, cache_w: 5 },
  "claude-haiku-5-5": { we: 0.1, wy: 0.5, cache_r: 0.01, cache_w: 0.125 }, // cache prices: 0.1 × / 1.25 × input (estimate)
  // models a declined request may be re-run on by the provider (server-side fallback)
  "claude-opus-5": { we: 5, wy: 25, cache_r: 0.5, cache_w: 6.25 },
  "claude-opus-4-8": { we: 5, wy: 25, cache_r: 0.5, cache_w: 6.25 },
};
// a model that is not in the table is priced as the most expensive one — never under-report
export const CENA_NIEZNANA: Cena = { we: 5, wy: 25, cache_r: 0.5, cache_w: 6.25 };

// Refusals of the main model are re-run by the provider on its recommended model (beta header below).
// The fast model has no server-side fallback — the parameter must not be sent for it.
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const FALLBACK_DLA: readonly string[] = [MODEL_GLOWNY];

// ---- hard limits of one run (code, not settings) ----
export const MAX_ITERACJI = 6;            // model calls in one run (tool rounds + the answer)
export const MAX_NARZEDZI_W_RUNDZIE = 6;  // tool calls honoured in one round
export const MAX_TOKENOW_PRZEBIEGU = 220_000; // input + output over all calls of a run
export const MAX_TOKENOW_ODPOWIEDZI = 16_000; // max_tokens of one call (thinking counts towards it)
export const BUDZET_MS = 125_000;         // wall clock of a run; an edge worker lives ~150 s at least
export const TIMEOUT_WYWOLANIA_MS = 90_000;
export const MAX_WYNIK_NARZEDZIA = 24_000; // characters of one tool result given to the model
export const MAX_TEKST_WEJSCIA = 20_000;   // characters of pasted text
export const MAX_PLIK = 10 * 1024 * 1024;
export const MAX_PLIKOW = 6;
export const MAX_PLIKI_RAZEM = 14 * 1024 * 1024;
export const PRZERWANY_PO_MS = 6 * 60_000; // a run still "w toku" after this is reported as interrupted

// ---- defaults of the settings the administrator edits on the page ----
export const DOMYSLNE = {
  dziennie_osoba: 40,     // runs a day per tester
  dziennie_razem: 80,     // runs a day, everybody
  koszt_dzien_usd: 5,     // estimated spend a day, everybody
  retencja_dni: 30,
};
export const GRANICE = {
  dziennie_osoba: [1, 300], dziennie_razem: [1, 1000], koszt_dzien_usd: [0.1, 100], retencja_dni: [1, 365],
} as const;
