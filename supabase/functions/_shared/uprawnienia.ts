// Uprawnienia szczegółowe — the typed face of the catalogue for the edge functions.
// The catalogue and the rules live in ./uprawnienia.js, an IDENTICAL copy of /uprawnienia.js of the portal
// (uprawnienia_test.ts compares them; after a change: cp uprawnienia.js supabase/functions/_shared/).
//
// How a function uses it (after its own cron / token-role branches and its section check):
//   const ja = { admin, wyl: wylaczone(app_metadata) };                     // in its caller resolver
//   if (!mozna(ja, AKCJE[action] ?? BAZA)) return json(odmowa(AKCJE[action] ?? BAZA), 403, origin);
import "./uprawnienia.js";

// deno-lint-ignore no-explicit-any
const U = (globalThis as any).Uprawnienia;

/** The switch-off list of an account, or "blad" when the claim is present but is not a list (deny everything). */
export type Wyl = string[] | "blad";
export type Upr = { admin: boolean; wyl: Wyl };

/** app_metadata -> the list. No claim = []. */
export function wylaczone(appMetadata: unknown): Wyl {
  return U.wylaczone(appMetadata && typeof appMetadata === "object" ? appMetadata : null);
}
/** May the caller use `klucz`? Administrators always; a malformed claim never; otherwise unless the key or an ancestor is listed. */
export function mozna(c: Upr, klucz: string): boolean {
  return U.mozeLista(c, klucz) === true;
}
/** The key an action needs: the one the function's own table names for it, otherwise the function's base key.
 *  (An own-property lookup: an action called "constructor" or "__proto__" is simply an unknown action.) */
export function kluczAkcji(mapa: Record<string, string>, akcja: unknown, baza: string): string {
  return typeof akcja === "string" && Object.hasOwn(mapa, akcja) ? mapa[akcja] : baza;
}
/** The body of a refusal (send it with HTTP 403). */
export function odmowa(klucz: string): { error: string; kod: "wylaczone"; klucz: string } {
  return { error: `Ta funkcja jest wyłączona dla Twojego konta: ${U.etykieta(klucz)}.`, kod: "wylaczone", klucz };
}
/** Is the key in the catalogue (and not an administrator-only entry)? */
export function znany(klucz: string): boolean {
  return U.znany(klucz) === true && U.KLUCZE[klucz].tylkoAdmin !== true;
}
/** Validation before storing: known keys only, no duplicates, descendants of a listed key dropped, sorted, capped. */
export function normalizuj(lista: unknown): { ok: true; lista: string[] } | { ok: false; blad: string } {
  return U.normalizuj(lista);
}
export const etykieta = (klucz: string): string => U.etykieta(klucz);
/** Every key of the catalogue (for tests). */
export const KLUCZE: string[] = U.LISTA.map((n: { klucz: string }) => n.klucz);
