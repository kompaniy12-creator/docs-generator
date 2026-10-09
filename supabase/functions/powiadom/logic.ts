// powiadom: what needs no network — cleaning the text an anonymous form supplied before the
// office's bot repeats it in the HR chat.

// One short line of plain text: no links, no @mentions, no markup, no control characters.
export function czysty(v: unknown, max = 80): string {
  let s = typeof v === "string" ? v : "";
  s = s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, " ");
  // scheme://…, www.…, t.me/…, and bare host names with a common ending
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "(link)")
    .replace(/\b(?:www\.|t\.me\/|telegram\.me\/)\S+/gi, "(link)")
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|biz|io|me|ru|ua|by|pl|eu|de|uk|cn|xyz|top|site|online|link|click|shop|app|dev|co|cc|ly|gg|tk)\b(?:\/\S*)?/gi, "(link)");
  s = s.replace(/@[A-Za-z0-9_]{2,}/g, "(@)");
  s = s.replace(/[<>*_`~\[\]{}|\\]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
export function dataIso(v: unknown): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}
// a string that is safe to log: the bot token (and anything shaped like "bot<digits>:<key>") is cut out
export function bezTokenu(s: string, token: string): string {
  let out = String(s ?? "");
  if (token) out = out.split(token).join("***");
  return out.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***");
}
// deno-lint-ignore no-explicit-any
export function tekstNowe(p: any, portal: string): string {
  const umowa = p?.u_typ === "praca" ? "umowa o pracę" : p?.u_typ === "zlecenie" ? "umowa zlecenie" : "—";
  const n = Array.isArray(p?.documents) ? Math.min(p.documents.length, 99) : 0;
  const od = dataIso(p?.u_od);
  return `🆕 Nowe zgłoszenie pracownika\nFirma: ${czysty(p?.z_nazwa) || "—"}\nUmowa: ${umowa}${od ? "\nOd: " + od : ""}\nDokumenty: ${n}\n\nOtwórz: ${portal}/zatrudnienie.html`;
}
