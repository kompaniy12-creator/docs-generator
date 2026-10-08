// Input validation for the `vat` function. Pure functions, no I/O — covered by walidacja_test.ts
// (`deno test supabase/functions/vat/`). Everything that later reaches an upstream URL path or
// request body passes through here first and comes out as digits / a fixed-alphabet token.

// VIES member-state codes (ec.europa.eu, check-status): 27 EU states — Greece is EL, not GR — plus XI (Northern Ireland).
export const KRAJE_VIES = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"];

// spaces (incl. non-breaking) and dashes are the only separators people type into NIP / REGON / account fields
function bezOdstepow(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 80) return null;
  return v.replace(/[\s -]/g, "");
}

export function nipOk(n: string): boolean {
  if (!/^\d{10}$/.test(n) || /^(\d)\1{9}$/.test(n)) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let s = 0;
  for (let i = 0; i < 9; i++) s += w[i] * Number(n[i]);
  return s % 11 === Number(n[9]); // remainder 10 never equals a digit -> invalid
}
export function regonOk(n: string): boolean {
  if (!/^(\d{9}|\d{14})$/.test(n) || /^0+$/.test(n)) return false;
  const suma = (w: number[]) => w.reduce((s, x, i) => s + x * Number(n[i]), 0) % 11 % 10;
  if (suma([8, 9, 2, 3, 4, 5, 6, 7]) !== Number(n[8])) return false;
  return n.length === 9 || suma([2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8]) === Number(n[13]);
}
// Polish account number (NRB): 26 digits, IBAN check with country code PL (mod 97)
export function nrbOk(n: string): boolean {
  if (!/^\d{26}$/.test(n)) return false;
  const t = n.slice(2) + "2521" + n.slice(0, 2);
  let r = 0;
  for (let i = 0; i < t.length; i++) r = (r * 10 + Number(t[i])) % 97;
  return r === 1;
}

type Wynik = { ok: string; blad?: undefined } | { ok?: undefined; blad: string };

export function czytajNip(v: unknown): Wynik {
  let t = bezOdstepow(v);
  if (t === null) return { blad: "Podaj NIP." };
  t = t.replace(/^PL/i, "");
  if (!/^\d{10}$/.test(t)) return { blad: "NIP to 10 cyfr." };
  return nipOk(t) ? { ok: t } : { blad: "Nieprawidłowy NIP — nie zgadza się cyfra kontrolna." };
}
export function czytajRegon(v: unknown): Wynik {
  const t = bezOdstepow(v);
  if (t === null || !/^(\d{9}|\d{14})$/.test(t)) return { blad: "REGON to 9 albo 14 cyfr." };
  return regonOk(t) ? { ok: t } : { blad: "Nieprawidłowy REGON — nie zgadza się cyfra kontrolna." };
}
export function czytajKonto(v: unknown): Wynik {
  let t = bezOdstepow(v);
  if (t === null) return { blad: "Podaj numer rachunku." };
  t = t.replace(/^PL/i, "");
  if (!/^\d{26}$/.test(t)) return { blad: "Numer rachunku to 26 cyfr (polski NRB, z „PL” albo bez)." };
  return nrbOk(t) ? { ok: t } : { blad: "Nieprawidłowy numer rachunku — nie zgadza się liczba kontrolna." };
}

// today's date in Poland — the register answers in Polish time, and "not in the future" is judged there
export function dzisPL(teraz: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(teraz);
}
// YYYY-MM-DD, a real calendar day, not later than `dzis`
export function czytajDate(v: unknown, dzis: string = dzisPL()): Wynik {
  if (typeof v !== "string") return { blad: "Podaj datę (RRRR-MM-DD)." };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return { blad: "Data musi mieć format RRRR-MM-DD." };
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return { blad: "Taki dzień nie istnieje." };
  if (v > dzis) return { blad: "Data nie może być datą przyszłą." };
  if (+m[1] < 2000) return { blad: "Data sprzed zakresu wykazu." };
  return { ok: v };
}

export function czytajKraj(v: unknown): Wynik {
  if (typeof v !== "string") return { blad: "Wybierz kraj." };
  const k = v.trim().toUpperCase() === "GR" ? "EL" : v.trim().toUpperCase();
  return KRAJE_VIES.includes(k) ? { ok: k } : { blad: "Nieznany kod kraju — VIES obejmuje państwa UE i Irlandię Północną (XI)." };
}
// VAT number without the country prefix: letters, digits, "+" and "*" (old Irish numbers), 2–12 characters
// — the alphabet of the formats listed in the VIES FAQ. A prefix equal to the chosen country is dropped.
export function czytajNumerVat(v: unknown, kraj: string): Wynik {
  if (typeof v !== "string" || v.length > 40) return { blad: "Podaj numer VAT." };
  let t = v.toUpperCase().replace(/[\s .\-]/g, "");
  // (a French number may itself begin with the letters FR: 2-character key + 9 digits = 11 characters)
  if ((t.startsWith(kraj) || (kraj === "EL" && t.startsWith("GR"))) && !(kraj === "FR" && t.length === 11)) t = t.slice(2);
  if (!/^[0-9A-Z+*]{2,12}$/.test(t)) return { blad: "Numer VAT może zawierać tylko litery i cyfry (2–12 znaków, bez kodu kraju)." };
  if (kraj === "PL" && !nipOk(t)) return { blad: "Polski numer VAT UE to PL + prawidłowy NIP (10 cyfr)." };
  return { ok: t };
}
// requester's own number, e.g. "PL 783-191-63-66" or just the NIP (then Poland is assumed)
export function czytajWlasny(v: unknown): { ok: { kraj: string; numer: string }; blad?: undefined } | { ok?: undefined; blad: string } {
  if (typeof v !== "string" || v.length > 40) return { blad: "Nieprawidłowy własny numer VAT UE." };
  const t = v.toUpperCase().replace(/[\s .\-]/g, "");
  let kraj = "PL";
  const pre = /^[A-Z]{2}/.exec(t);
  if (pre) {
    const k = czytajKraj(pre[0]);
    if (k.blad !== undefined) return { blad: "Własny numer VAT UE: nieznany kod kraju „" + pre[0] + "”." };
    kraj = k.ok;
  }
  const n = czytajNumerVat(t, kraj);
  if (n.blad !== undefined) return { blad: "Własny numer VAT UE: " + n.blad };
  return { ok: { kraj, numer: n.ok } };
}

// for logs: never the whole account number
export function maska(konto: string): string {
  return "…" + konto.slice(-4);
}
