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
// What the office prepares when the client has no work-legalising document: the office's price and the
// fee of the authority (PLN), which the firm pays separately from its own account. The form sends the
// choice; only its key is taken from there — names and amounts are these.
export const ZAMOW: Record<string, { nazwa: string; cena: number; urzad: number }> = {
  powiadomienie: { nazwa: "Powiadomienie o powierzeniu pracy obywatelowi Ukrainy", cena: 100, urzad: 0 },
  oswiadczenie: { nazwa: "Oświadczenie o powierzeniu pracy (Białoruś, Mołdawia, Armenia, Ukraina)", cena: 150, urzad: 400 },
  zezwolenie_a: { nazwa: "Zezwolenie na pracę typ A", cena: 250, urzad: 400 },
};
// deno-lint-ignore no-explicit-any
export function zamowienie(p: any) {
  const k = typeof p?.zamow_praca?.k === "string" ? p.zamow_praca.k : "";
  return Object.hasOwn(ZAMOW, k) ? { k, ...ZAMOW[k] } : null;
}
// The task for the HR officer about an ordered document (without the assignee), or null when nothing was ordered.
// deno-lint-ignore no-explicit-any
export function zadanieZamowienia(p: any, id: string) {
  const z = zamowienie(p);
  if (!z) return null;
  const osoba = czysty(`${p?.p_imiona ?? ""} ${p?.p_nazwisko ?? ""}`, 80) || "—";
  const firma = czysty(p?.z_nazwa) || "—";
  const nip = String(p?.z_nip ?? "").replace(/\D/g, "").slice(0, 10);
  const od = dataIso(p?.u_od);
  const opis = [
    "Klient zamówił w formularzu zgłoszenia pracownika przygotowanie dokumentu legalizującego pracę.",
    `Dokument: ${z.nazwa}`,
    `Cena biura: ${z.cena} zł`,
    `Opłata urzędowa: ${z.urzad ? z.urzad + " zł" : "bezpłatnie"}${z.urzad ? " — płaci firma osobno, ze swojego rachunku" : ""}`,
    `Pracownik: ${osoba}${czysty(p?.p_obywatelstwo, 40) ? ", obywatelstwo: " + czysty(p?.p_obywatelstwo, 40) : ""}`,
    `Firma: ${firma}${nip ? ", NIP " + nip : ""}`,
    od ? `Planowany początek pracy: ${od}` : "",
    "Zgłoszenie i dokumenty pracownika: strona „Zatrudnienie” (link w zadaniu).",
  ].filter(Boolean).join("\n");
  return {
    created_by: "system", tytul: `Zamówienie: ${z.nazwa} — ${osoba} (${firma})`.slice(0, 200), opis, termin: null, pilne: false,
    zrodlo: "system", klucz: `zamow_praca:${id}`, link: "zatrudnienie.html", nip,
  };
}
// deno-lint-ignore no-explicit-any
export function tekstNowe(p: any, portal: string): string {
  const umowa = p?.u_typ === "praca" ? "umowa o pracę" : p?.u_typ === "zlecenie" ? "umowa zlecenie" : "—";
  const n = Array.isArray(p?.documents) ? Math.min(p.documents.length, 99) : 0;
  const od = dataIso(p?.u_od);
  const z = zamowienie(p);
  return `🆕 Nowe zgłoszenie pracownika\nFirma: ${czysty(p?.z_nazwa) || "—"}\nUmowa: ${umowa}${od ? "\nOd: " + od : ""}\nDokumenty: ${n}${z ? `\nZamówienie w biurze: ${z.nazwa} — ${z.cena} zł` : ""}\n\nOtwórz: ${portal}/zatrudnienie.html`;
}
