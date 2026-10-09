// extract-worker: the checks made before any paid model call. No network here.

export const MAX_FILES = 6;                         // what the public form sends at most
export const MAX_TOTAL_B64 = 9 * 1024 * 1024;       // ~6.7 MB of binary across all files
export const MAX_PDF_B64 = 4 * 1024 * 1024;         // one PDF: ~3 MB of binary
export const MAX_BODY = 10 * 1024 * 1024;           // the whole request
export const DOC_TYPES = ["dowód osobisty", "paszport", "karta pobytu"];
export const OK_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

export const LIMIT_IP_H = 10;    // readings an hour from one address
export const LIMIT_DZIEN = 200;  // readings a day, everybody together

// the hint that goes into the prompt: one of three known values or nothing
export function docType(v: unknown): string {
  return typeof v === "string" && DOC_TYPES.includes(v) ? v : "";
}

// what the file really is, by its first bytes
export function sniff(b: Uint8Array): string | null {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
function head(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.slice(0, 24));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

export type Plik = { mime: string; data: string };
export type Wynik = { ok: true; files: Plik[] } | { ok: false; status: number; error: string };

// count, shape, size and real type of every file — before anything is sent anywhere
export function sprawdz(files: unknown): Wynik {
  if (!Array.isArray(files) || !files.length) return { ok: false, status: 400, error: "Brak plików." };
  if (files.length > MAX_FILES) return { ok: false, status: 400, error: `Za dużo plików (max ${MAX_FILES}).` };
  const out: Plik[] = [];
  let total = 0;
  for (const f of files) {
    if (!f || typeof f !== "object" || Array.isArray(f)) return { ok: false, status: 400, error: "Nieprawidłowy plik." };
    const mime = typeof (f as Plik).mime === "string" ? (f as Plik).mime.toLowerCase().split(";")[0].trim() : "";
    const data = typeof (f as Plik).data === "string" ? (f as Plik).data : "";
    if (!OK_MIME.includes(mime)) return { ok: false, status: 400, error: "Nieobsługiwany format pliku — dozwolone są zdjęcia JPG, PNG, WEBP, GIF i pliki PDF." };
    if (data.length < 100) return { ok: false, status: 400, error: "Plik jest pusty." };
    total += data.length;
    if (total > MAX_TOTAL_B64) return { ok: false, status: 413, error: "Pliki są za duże." };
    if (mime === "application/pdf" && data.length > MAX_PDF_B64) return { ok: false, status: 413, error: "Plik PDF jest za duży do automatycznego odczytu (najwyżej 3 MB)." };
    // plain base64 only (no data: prefix, no white space), and the content must be what the type says
    if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { ok: false, status: 400, error: "Nieprawidłowy plik." };
    const h = head(data);
    if (!h || sniff(h) !== mime) return { ok: false, status: 400, error: "Zawartość pliku nie odpowiada jego typowi — dodaj zdjęcie JPG / PNG albo plik PDF." };
    out.push({ mime, data });
  }
  return { ok: true, files: out };
}

// the caller's address: the first element of x-forwarded-for, as the other functions take it
export function ip(req: Request): string {
  const v = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(v) ? v : "nieznany";
}
// counters are kept under a hash, not under the address itself
export async function kluczIp(adres: string, teraz = new Date()): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("extract:" + adres));
  const h = [...new Uint8Array(d)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
  return `extract:ip:${h}:${teraz.toISOString().slice(11, 13)}`;
}
