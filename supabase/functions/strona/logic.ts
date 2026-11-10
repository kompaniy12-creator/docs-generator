// strona: the checks, kept apart from the handler so that tests can call them.

// pages of td-group.pl that may be counted: the same list in three language folders
export const SCIEZKA = /^\/(uk\/|ru\/)?(|uslugi\/|uslugi\/(ksiegowosc|kadry-i-place|zatrudnianie-cudzoziemcow|legalizacja-pobytu|rejestracja-spolek)\/|cennik\/|dla-klientow\/|o-nas\/|kontakt\/|polityka-prywatnosci\/|dane-rejestrowe\/)$/;
export const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
export const BOT = /bot|crawl|spider|headless|lighthouse|preview|monitor|curl|wget|python|scrapy/i;

// one line of text: no control characters, no line breaks (these values go into mail headers)
export const linia = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
// several lines of text: line breaks stay, other control characters go
export const tekst = (v: unknown, max: number) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

// where a visit came from, as one of a few fixed words: the address itself is never stored
export function zrodlo(host: unknown): string {
  const h = String(host ?? "").toLowerCase().replace(/^www\./, "").slice(0, 100);
  if (!h) return "bezpośrednio";
  if (h === "td-group.pl") return "strona";
  if (h === "docgenerator.td-group.pl") return "portal";
  if (/(^|\.)google\.[a-z.]{2,6}$/.test(h)) return "google";
  if (/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.com|yandex\.[a-z]{2,3}|ecosia\.org|brave\.com|startpage\.com)$/.test(h)) return "inna wyszukiwarka";
  if (/(^|\.)(t\.me|telegram\.org)$/.test(h)) return "telegram";
  if (/(^|\.)(facebook\.com|instagram\.com|linkedin\.com|lnkd\.in|t\.co|x\.com|twitter\.com|tiktok\.com|youtube\.com)$/.test(h)) return "media społecznościowe";
  if (/(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/.test(h)) return "asystent AI";
  return "inne strony";
}

export type Zgloszenie = { imie: string; email: string; telefon: string; firma: string; wiadomosc: string; wycena: string; jezyk: string; strona: string };
// the cleaned submission, or null when it cannot be answered (no name, no valid address, nothing said)
// deno-lint-ignore no-explicit-any
export function zgloszenie(b: any): Zgloszenie | null {
  const z = {
    imie: linia(b?.imie, 120), email: linia(b?.email, 120).toLowerCase(), telefon: linia(b?.telefon, 40), firma: linia(b?.firma, 120),
    wiadomosc: tekst(b?.wiadomosc, 3000), wycena: tekst(b?.wycena, 1500),
    jezyk: ["pl", "uk", "ru"].includes(b?.jezyk) ? b.jezyk : "pl",
    strona: SCIEZKA.test(String(b?.strona ?? "")) ? String(b.strona) : "",
  };
  if (!z.imie || !EMAIL.test(z.email) || (!z.wiadomosc && !z.wycena)) return null;
  return z;
}

export function mail(z: Zgloszenie): { subject: string; text: string } {
  const JEZYK: Record<string, string> = { pl: "polski", uk: "ukraiński", ru: "rosyjski" };
  return {
    subject: `Zapytanie ze strony td-group.pl — ${z.imie}${z.firma ? " (" + z.firma + ")" : ""}`,
    text: [
      "Nowe zapytanie z formularza na td-group.pl.",
      "",
      `Imię i nazwisko: ${z.imie}`,
      `E-mail: ${z.email}`,
      `Telefon: ${z.telefon || "—"}`,
      `Firma: ${z.firma || "—"}`,
      `Język strony: ${JEZYK[z.jezyk]}`,
      "",
      z.wiadomosc ? "Wiadomość:\n" + z.wiadomosc : "Wiadomość: —",
      ...(z.wycena ? ["", "Wycena z kalkulatora:\n" + z.wycena] : []),
      "",
      "Odpowiedz na tę wiadomość — odpowiedź trafi do osoby, która wypełniła formularz.",
    ].join("\n"),
  };
}
