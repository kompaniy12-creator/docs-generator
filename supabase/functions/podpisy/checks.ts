// Podpisy: everything that needs no database — the byte checks on uploaded files, the rules
// (which document may be signed how, by whom, with what warning) and the status arithmetic.
// Kept apart from index.ts so it can be tested on its own.

// The office and the employer: 24 MB — what the akta-osobowe bucket takes, so a closed package
// can always be filed. The worker's link: 15 MB (photos are scaled down in the browser).
export const MAX_BYTES = 24 * 1024 * 1024;
export const MAX_LINK = 15 * 1024 * 1024;

// ---------------- bytes ----------------
export type Kind = "pdf" | "jpeg" | "png" | null;
export const MIME: Record<string, string> = { pdf: "application/pdf", jpeg: "image/jpeg", png: "image/png" };
export const EXT: Record<string, string> = { pdf: "pdf", jpeg: "jpg", png: "png" };

// what the file really is, by its first bytes (the name and the declared type prove nothing)
export function sniff(b: Uint8Array): Kind {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  return null;
}
// the type the sender declared, reduced to our three kinds ("" = nothing declared)
export function declared(mime: string): Kind | "" | "other" {
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  if (!m || m === "application/octet-stream") return "";
  if (m === "application/pdf") return "pdf";
  if (m === "image/jpeg" || m === "image/jpg" || m === "image/pjpeg") return "jpeg";
  if (m === "image/png") return "png";
  return "other";
}
export async function sha256(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as BufferSource);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function sha256Text(s: string): Promise<string> { return sha256(new TextEncoder().encode(s)); }

function indexOf(b: Uint8Array, needle: string, from: number): number {
  const n = needle.length, first = needle.charCodeAt(0), end = b.length - n;
  outer: for (let i = from; i <= end; i++) {
    if (b[i] !== first) continue;
    for (let j = 1; j < n; j++) if (b[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}
// true when `needle`, optional white space and then `value` occur at or after `from`
function hasPair(b: Uint8Array, needle: string, values: string[], from: number): boolean {
  for (let i = indexOf(b, needle, from); i !== -1; i = indexOf(b, needle, i + 1)) {
    let k = i + needle.length;
    while (k < b.length && (b[k] === 0x20 || b[k] === 0x0a || b[k] === 0x0d || b[k] === 0x09 || b[k] === 0x0c || b[k] === 0x00)) k++;
    for (const v of values) {
      if (k + v.length > b.length) continue;
      let same = true;
      for (let j = 0; j < v.length; j++) if (b[k + j] !== v.charCodeAt(j)) { same = false; break; }
      // "/Sig" must end there: "/SigRef", "/SigFieldLock" are other things
      const after = b[k + v.length];
      if (same && !(after !== undefined && ((after >= 0x30 && after <= 0x39) || (after >= 0x41 && after <= 0x5a) || (after >= 0x61 && after <= 0x7a) || after === 0x2e))) return true;
    }
  }
  return false;
}
const SUBFILTERS = ["/ETSI.CAdES.detached", "/adbe.pkcs7.detached", "/adbe.pkcs7.sha1", "/adbe.x509.rsa_sha1"];
// A signature dictionary in the bytes from `from` on: /ByteRange together with /Type /Sig
// (or, as /Type is optional in ISO 32000, a signature /SubFilter). This only says "somebody
// put a signature object here" — whether it is valid and whose it is, a person checks.
export function hasSignature(b: Uint8Array, from = 0): boolean {
  if (indexOf(b, "/ByteRange", from) === -1) return false;
  return hasPair(b, "/Type", ["/Sig"], from) || hasPair(b, "/SubFilter", SUBFILTERS, from);
}
// The /ByteRange arrays "[0 a b c]" found at or after `from`, in file order.
export function byteRanges(b: Uint8Array, from = 0): number[][] {
  const out: number[][] = [];
  for (let i = indexOf(b, "/ByteRange", from); i !== -1; i = indexOf(b, "/ByteRange", i + 1)) {
    let k = i + 10;
    const ws = () => { while (k < b.length && (b[k] === 0x20 || b[k] === 0x0a || b[k] === 0x0d || b[k] === 0x09 || b[k] === 0x0c || b[k] === 0x00)) k++; };
    ws();
    if (b[k] !== 0x5b) continue; // "["
    k++;
    const n: number[] = [];
    for (let j = 0; j < 4; j++) {
      ws();
      let d = 0, v = 0;
      while (k < b.length && b[k] >= 0x30 && b[k] <= 0x39 && d < 12) { v = v * 10 + (b[k] - 0x30); k++; d++; }
      if (!d) break;
      n.push(v);
    }
    ws();
    if (n.length === 4 && b[k] === 0x5d) out.push(n);
  }
  return out;
}
// A signature that really closes the file: the LAST /ByteRange after the base is "[0 a b c]" with
// the signature value (the gap a..b) lying after the base and b + c reaching the end of the file —
// i.e. a signature dictionary added after the issued bytes that covers the whole upload.
// A stray "/ByteRange /Type /Sig" in a comment does not pass; whether the signature is valid,
// whose it is and what the appended revisions changed on the page, a person still checks.
export function signedWhole(b: Uint8Array, base: number): boolean {
  if (!hasSignature(b, base)) return false;
  const r = byteRanges(b, base), last = r[r.length - 1];
  return !!last && last[0] === 0 && last[1] >= base && last[2] > last[1] && last[2] + last[3] === b.length;
}
// how many revisions were appended after the base (each ends with %%EOF)
export function revisions(b: Uint8Array, base: number): number {
  let n = 0;
  for (let i = indexOf(b, "%%EOF", base); i !== -1; i = indexOf(b, "%%EOF", i + 5)) n++;
  return n;
}
// PAdES appends a revision and never touches what was there: the file we issued must be
// the first `baseLen` bytes of what came back
export async function continues(upload: Uint8Array, baseLen: number, baseSha: string): Promise<boolean> {
  if (!(baseLen > 0) || upload.length <= baseLen) return false;
  return (await sha256(upload.subarray(0, baseLen))) === baseSha;
}

export type Base = { id: "wydany" | "pracodawca"; rozmiar: number; sha256: string };
export type Verdict =
  | { ok: true; kind: Exclude<Kind, null>; sha256: string; baza: Base["id"] | null; wiazanie: "prefiks" | "wzrokowa" | "pominiete"; rewizje: number | null }
  | { ok: false; kod: string; error: string; sha256?: string };

export const ERR = {
  pusty: "Plik jest pusty.",
  rozmiar: "Plik jest za duży — najwyżej 24 MB.",
  rozmiar_link: "Plik jest za duży — najwyżej 15 MB.",
  niepelny: "Podpis w tym pliku nie obejmuje całego dokumentu albo nie jest prawidłowo osadzony w pliku PDF. Podpisz pobrany plik jeszcze raz i wgraj dokładnie ten plik, który zapisał program do podpisu — bez dopisywania czegokolwiek po podpisie.",
  typ: "Dozwolone są tylko pliki PDF, JPG i PNG. Podpisy w osobnych plikach (XAdES, .xml, .sig, .asic) nie są w tej wersji obsługiwane — podpisz sam plik PDF (podpis wewnątrz pliku, PAdES).",
  niezgodny: "Zawartość pliku nie odpowiada jego typowi — wgraj oryginalny plik PDF, JPG albo PNG.",
  pdf: "Plik podpisany elektronicznie musi być plikiem PDF z podpisem w środku (PAdES). Zdjęcie albo skan wgraj jako „podpis odręczny”.",
  bez_podpisu: "Plik nie zawiera podpisu elektronicznego. Podpisz pobrany plik PDF i wgraj ten, który zapisał program do podpisu.",
  nie_nasz: "To nie jest plik, który wydaliśmy: podpis trzeba złożyć na dokładnie tym pliku PDF, który został pobrany z portalu — bez drukowania do PDF, zapisywania „jako” ani łączenia z innymi plikami.",
  niepodpisany: "To jest ten sam plik, który wydaliśmy — bez podpisu. Wgraj plik po podpisaniu albo skan podpisanego wydruku.",
};

// The checks on every upload. `bases` — the files an electronic signature may continue,
// most wanted first; `pomin` — the office decided to accept without the prefix binding.
export async function inspect(b: Uint8Array, mime: string, metoda: string, bases: Base[], pomin = false, max = MAX_BYTES): Promise<Verdict> {
  if (!b.length) return { ok: false, kod: "pusty", error: ERR.pusty };
  if (b.length > max) return { ok: false, kod: "rozmiar", error: max === MAX_LINK ? ERR.rozmiar_link : ERR.rozmiar };
  const kind = sniff(b), decl = declared(mime);
  if (!kind || decl === "other") return { ok: false, kod: "typ", error: ERR.typ };
  if (decl && decl !== kind) return { ok: false, kod: "niezgodny", error: ERR.niezgodny };
  const sha = await sha256(b);
  if (bases.some((x) => x.sha256 === sha)) return { ok: false, kod: metoda === "odreczny" ? "niepodpisany" : "bez_podpisu", error: metoda === "odreczny" ? ERR.niepodpisany : ERR.bez_podpisu, sha256: sha };
  if (metoda === "odreczny") return { ok: true, kind, sha256: sha, baza: null, wiazanie: "wzrokowa", rewizje: null };
  if (kind !== "pdf") return { ok: false, kod: "pdf", error: ERR.pdf, sha256: sha };
  for (const base of bases) {
    if (!(await continues(b, base.rozmiar, base.sha256))) continue;
    // the signature must be in what was appended, not something the base already carried
    if (!hasSignature(b, base.rozmiar)) return { ok: false, kod: "bez_podpisu", error: ERR.bez_podpisu, sha256: sha };
    // ...and it must be a real one, closing the whole file
    if (!signedWhole(b, base.rozmiar)) return { ok: false, kod: "bez_podpisu", error: ERR.niepelny, sha256: sha };
    return { ok: true, kind, sha256: sha, baza: base.id, wiazanie: "prefiks", rewizje: revisions(b, base.rozmiar) };
  }
  if (!hasSignature(b) || !byteRanges(b).length) return { ok: false, kod: "bez_podpisu", error: ERR.bez_podpisu, sha256: sha };
  if (pomin) return { ok: true, kind, sha256: sha, baza: null, wiazanie: "pominiete", rewizje: null };
  return { ok: false, kod: "nie_nasz", error: ERR.nie_nasz, sha256: sha };
}

// ---------------- rules ----------------
export const RODZAJE: Record<string, string> = {
  umowa_praca: "Umowa o pracę", aneks_praca: "Aneks do umowy o pracę", umowa_zlecenie: "Umowa zlecenia", aneks_zlecenie: "Aneks do umowy zlecenia",
  tlumaczenie: "Tłumaczenie umowy", zwiazki_info: "Informacja o prawie wstępowania do związków zawodowych",
  rozwiazanie: "Wypowiedzenie / porozumienie o rozwiązaniu umowy", ppk_rezygnacja: "Rezygnacja z PPK", odpowiedzialnosc: "Umowa o odpowiedzialności materialnej",
  pit2: "PIT-2", kwestionariusz: "Kwestionariusz osobowy", oswiadczenie: "Oświadczenie / wniosek", zgoda_rodo: "RODO — klauzula / zgoda",
  informacja_warunki: "Informacja o warunkach zatrudnienia", inny: "Inny dokument",
  // single HR documents (dokumenty.html) whose form the law — or the office's practice — fixes
  zakaz_konkurencji: "Umowa o zakazie konkurencji", kara_porzadkowa: "Zawiadomienie o karze porządkowej", zgoda_potracenie: "Zgoda na potrącenie z wynagrodzenia",
  swiadectwo_pracy: "Świadectwo pracy", skierowanie_badania: "Skierowanie na badania lekarskie", upowaznienie_rodo: "Upoważnienie do przetwarzania danych osobowych",
  oswiadczenie_cudz_tresc: "Oświadczenie cudzoziemca o otrzymaniu umowy w zrozumiałej wersji", ppk_wniosek: "Wniosek o dokonywanie wpłat do PPK",
  wypowiedzenie_zlecenia: "Wypowiedzenie umowy zlecenia", informacja_monitoring: "Informacja o monitoringu",
  informacja_dokumentacja: "Informacja o okresie przechowywania dokumentacji pracowniczej", informacja_dok_pobytowy: "Informacja o wygasającym dokumencie pobytowym",
};
// written form only: qualified or handwritten signature, never podpis zaufany. The sentence is shown to the signer.
const PISEMNE: Record<string, string> = {
  rozwiazanie: "Oświadczenie o wypowiedzeniu lub rozwiązaniu umowy o pracę wymaga formy pisemnej (art. 30 § 3 Kodeksu pracy)",
  ppk_rezygnacja: "Rezygnację z wpłat do PPK składa się w formie pisemnej (art. 23 ust. 2 ustawy o pracowniczych planach kapitałowych)",
  odpowiedzialnosc: "Umowa o odpowiedzialności materialnej wymaga formy pisemnej",
  zakaz_konkurencji: "Umowa o zakazie konkurencji wymaga formy pisemnej pod rygorem nieważności (art. 101³ Kodeksu pracy)",
  kara_porzadkowa: "O zastosowanej karze porządkowej pracodawca zawiadamia pracownika na piśmie (art. 110 Kodeksu pracy)",
  zgoda_potracenie: "Zgoda pracownika na potrącenie z wynagrodzenia musi być wyrażona na piśmie (art. 91 § 1 Kodeksu pracy)",
  swiadectwo_pracy: "Świadectwo pracy wydaje pracodawca (art. 97 § 1 Kodeksu pracy); podpisuje je pracodawca albo osoba go reprezentująca lub upoważniona, zgodnie z wzorem z rozporządzenia w sprawie świadectwa pracy",
  skierowanie_badania: "Skierowanie na badania lekarskie wydaje pracodawca według wzoru urzędowego, z podpisem pracodawcy (§ 4 ust. 1a rozporządzenia w sprawie badań lekarskich pracowników)",
  upowaznienie_rodo: "Do przetwarzania danych szczególnych kategorii mogą być dopuszczone wyłącznie osoby posiadające pisemne upoważnienie (art. 22¹b § 3 Kodeksu pracy); biuro stosuje formę pisemną dla każdego upoważnienia",
  oswiadczenie_cudz_tresc: "Oświadczenie dotyczy obowiązków wykonywanych wobec cudzoziemca na piśmie (art. 5 ust. 1, 2 i 4 ustawy o powierzaniu pracy cudzoziemcom); biuro stosuje dla niego formę pisemną",
  ppk_wniosek: "Wniosek o dokonywanie wpłat do PPK składa się podmiotowi zatrudniającemu w formie pisemnej (art. 23 ust. 10 ustawy o pracowniczych planach kapitałowych)",
};
// delivered, never signed: the worker only confirms the receipt
const ODBIOR: Record<string, string> = {
  informacja_warunki: "Informacja o warunkach zatrudnienia (art. 29 § 3 Kodeksu pracy) nie wymaga podpisu — można ją przekazać w postaci elektronicznej (art. 29 § 3³ Kodeksu pracy); portal zapisuje potwierdzenie odbioru przez pracownika.",
  informacja_monitoring: "Informację o monitoringu pracodawca przekazuje w postaci papierowej lub elektronicznej (art. 22² § 8 Kodeksu pracy) — podpis nie jest wymagany; portal zapisuje potwierdzenie odbioru przez pracownika.",
  informacja_dokumentacja: "Informację o okresie przechowywania dokumentacji pracowniczej wydaje się w postaci papierowej lub elektronicznej wraz ze świadectwem pracy (art. 94⁶ Kodeksu pracy) — podpis nie jest wymagany; portal zapisuje potwierdzenie odbioru przez pracownika.",
  informacja_dok_pobytowy: "Pismo informacyjne — przepisy nie wymagają podpisu; ważny jest dowód przekazania. Portal zapisuje potwierdzenie odbioru przez pracownika.",
};
// signed by the employer alone (the worker only receives the document)
const TYLKO_PRACODAWCA = ["kara_porzadkowa", "swiadectwo_pracy", "skierowanie_badania"];
// who signs when the kind leaves no choice (null = the office chooses)
export function wymuszonePodpisuje(rodzaj: string): string | null {
  if (ODBIOR[rodzaj]) return "potwierdzenie";
  return TYLKO_PRACODAWCA.includes(rodzaj) ? "pracodawca" : null;
}
export const METODY: Record<string, string> = { kwalifikowany: "kwalifikowany podpis elektroniczny", zaufany: "podpis zaufany (podpis.gov.pl)", odreczny: "podpis odręczny na wydruku + skan / zdjęcie" };
// what the officer may find in the validator's report ("osobisty" = e-dowód: never accepted here)
export const STWIERDZONO: Record<string, string> = { kwalifikowany: "kwalifikowany podpis elektroniczny", zaufany: "podpis zaufany", osobisty: "podpis osobisty (e-dowód)", odreczny: "podpis odręczny — skan / zdjęcie" };
export const POWOD_RODZAJ = "zadeklarowano inny rodzaj podpisu niż stwierdził weryfikator — wgraj ponownie, wybierając właściwy rodzaj";
// what the officer must tick before a signature can be confirmed
export const POTWIERDZENIA_WER: Record<string, string> = {
  tresc: "Treść dokumentu po otwarciu wgranego pliku jest taka sama jak w wydanym dokumencie",
  waznosc: "Weryfikator (podpis.gov.pl) potwierdza ważność podpisu i to, że podpis obejmuje cały dokument",
  pracodawca: "Podpis pracodawcy nie jest oznaczony jako złożony przed zmianą dokumentu",
};
export function wymaganePotwierdzenia(metoda: string | null, baza: string | null): string[] {
  if (metoda === "odreczny") return ["tresc"];
  return baza === "pracodawca" ? ["tresc", "waznosc", "pracodawca"] : ["tresc", "waznosc"];
}
export const PODPISUJE: Record<string, string> = { obie: "pracodawca i pracownik", pracodawca: "pracodawca", pracownik: "pracownik", potwierdzenie: "bez podpisu — pracownik potwierdza odbiór" };

// who signs by default (the office may choose otherwise, except for informacja_warunki)
export function domyslniePodpisuje(rodzaj: string, cudzoziemiec: boolean): string {
  const w = wymuszonePodpisuje(rodzaj);
  if (w) return w;
  if (["umowa_praca", "aneks_praca", "umowa_zlecenie", "aneks_zlecenie", "tlumaczenie", "rozwiazanie", "odpowiedzialnosc", "zakaz_konkurencji", "upowaznienie_rodo"].includes(rodzaj)) return "obie";
  // either side may terminate (art. 746 KC); most often the principal — the office may choose the worker
  if (rodzaj === "wypowiedzenie_zlecenia") return "pracodawca";
  // for a foreigner the employer's information itself needs the written form
  if (rodzaj === "zwiazki_info") return cudzoziemiec ? "obie" : "pracownik";
  return "pracownik";
}

// Warnings a signer must accept before uploading. The text is part of the evidence: the
// version, the SHA-256 of the text and the text itself go to the trail with every acceptance.
// Never edit a published text — add a new version.
export const OSTRZEZENIA: Record<string, string> = {
  "PZ-CUDZ-1":
    "UWAGA — RYZYKO PRAWNE. Umowa z cudzoziemcem musi być zawarta w formie pisemnej przed dopuszczeniem go do pracy (art. 5 ust. 1 ustawy z dnia 20 marca 2025 r. o warunkach dopuszczalności powierzania pracy cudzoziemcom na terytorium Rzeczypospolitej Polskiej, Dz.U. 2025 poz. 621). W formie pisemnej trzeba też przedstawić cudzoziemcowi treść umowy w języku dla niego zrozumiałym (art. 5 ust. 2) i informację o prawie wstępowania do związków zawodowych (art. 5 ust. 4).\n\n" +
    "Formę pisemną daje wyłącznie podpis własnoręczny (art. 78 § 1 Kodeksu cywilnego) albo kwalifikowany podpis elektroniczny (art. 78¹ Kodeksu cywilnego). Podpis zaufany złożony między podmiotami prywatnymi NIE jest równoważny podpisowi własnoręcznemu: daje tylko formę dokumentową (art. 77² Kodeksu cywilnego). Skutek podpisu własnoręcznego podpis zaufany ma jedynie wobec podmiotów publicznych (art. 20ae ustawy o informatyzacji działalności podmiotów realizujących zadania publiczne). Serwis podpis.gov.pl na pytanie, czy podpisem zaufanym można podpisać umowę między osobami prywatnymi lub firmami, odpowiada: „Nie”.\n\n" +
    "Powierzenie pracy cudzoziemcowi bez zawarcia umowy w formie pisemnej jest nielegalnym powierzeniem pracy (art. 2 pkt 2 lit. f tej ustawy) i podlega karze grzywny od 3 000 zł do 50 000 zł (art. 84 ust. 1). Dokument podpisany podpisem zaufanym może zostać uznany przez organ kontroli lub sąd za niespełniający wymogu formy pisemnej.\n\n" +
    "Bezpieczne sposoby: kwalifikowany podpis elektroniczny albo podpis własnoręczny na wydruku. Wybierając podpis zaufany, robisz to na własne ryzyko.",
};
export const POTWIERDZENIA: Record<string, string> = {
  "PZ-CUDZ-1": "Przeczytałam/em ostrzeżenie. Rozumiem, że podpis zaufany nie daje formy pisemnej wymaganej dla umowy z cudzoziemcem, i mimo to wybieram podpis zaufany.",
};
const UWAGA_29 = "Podpis zaufany pracownika jest tu dopuszczalny, ponieważ pracodawca podpisał umowę kwalifikowanym podpisem elektronicznym: dokument pracodawcy jest pisemnym potwierdzeniem ustaleń co do stron, rodzaju umowy i jej warunków (art. 29 § 2 Kodeksu pracy). Pełną formę pisemną po stronie pracownika daje tylko podpis kwalifikowany albo własnoręczny.";

export type Regula = { metody: { id: string; nazwa: string; ostrzezenie?: string; uwaga?: string }[]; podstawa: string };
const m = (id: string, extra: { ostrzezenie?: string; uwaga?: string } = {}) => ({ id, nazwa: METODY[id], ...extra });

// Which methods a party may use for a document. `pdMetoda` — how the employer signed
// (matters for the worker's podpis zaufany under an employment contract).
export function regula(rodzaj: string, cudzoziemiec: boolean, strona: "pracodawca" | "pracownik", pdMetoda: string | null): Regula {
  if (ODBIOR[rodzaj]) return { metody: [], podstawa: ODBIOR[rodzaj] };
  if (PISEMNE[rodzaj]) {
    return { metody: [m("kwalifikowany"), m("odreczny")], podstawa: PISEMNE[rodzaj] + " — tylko podpis kwalifikowany (art. 78¹ Kodeksu cywilnego) albo własnoręczny. Podpis zaufany nie jest tu przyjmowany." };
  }
  if (rodzaj === "wypowiedzenie_zlecenia") {
    return { metody: [m("kwalifikowany"), m("zaufany"), m("odreczny")], podstawa: "Wypowiedzenie umowy zlecenia (art. 746 Kodeksu cywilnego) wymaga zachowania formy dokumentowej, chyba że ustawa lub umowa zastrzega inną (art. 77 § 2 Kodeksu cywilnego) — sprawdź postanowienia umowy. Jeżeli umowa nie stanowi inaczej, można użyć każdego z trzech sposobów." };
  }
  if (cudzoziemiec && ["umowa_praca", "aneks_praca", "umowa_zlecenie", "aneks_zlecenie", "tlumaczenie", "zwiazki_info"].includes(rodzaj)) {
    return {
      metody: [m("kwalifikowany"), m("odreczny"), m("zaufany", { ostrzezenie: "PZ-CUDZ-1" })],
      podstawa: "Cudzoziemiec: wymagana forma pisemna (art. 5 ust. 1, 2 i 4 ustawy o powierzaniu pracy cudzoziemcom) — podpis kwalifikowany albo własnoręczny. Podpis zaufany tylko po zapoznaniu się z ostrzeżeniem i jego potwierdzeniu.",
    };
  }
  if (rodzaj === "umowa_praca" || rodzaj === "aneks_praca") {
    const metody = [m("kwalifikowany"), m("odreczny")];
    if (strona === "pracownik" && pdMetoda === "kwalifikowany") metody.push(m("zaufany", { uwaga: UWAGA_29 }));
    return { metody, podstawa: "Umowę o pracę zawiera się na piśmie (art. 29 § 2 Kodeksu pracy): podpis kwalifikowany (art. 78¹ Kodeksu cywilnego) albo własnoręczny. Podpis zaufany — tylko pracownik i tylko wtedy, gdy pracodawca podpisał podpisem kwalifikowanym." };
  }
  return { metody: [m("kwalifikowany"), m("zaufany"), m("odreczny")], podstawa: "Dla tego dokumentu przepisy nie wymagają formy pisemnej pod rygorem nieważności — można użyć każdego z trzech sposobów." };
}
// the whole matrix, for the hints in the office's and the employer's screens
export function macierz() {
  const out = [];
  for (const rodzaj of Object.keys(RODZAJE)) {
    for (const cudz of [false, true]) {
      const pd = regula(rodzaj, cudz, "pracodawca", null), pr = regula(rodzaj, cudz, "pracownik", null), prQ = regula(rodzaj, cudz, "pracownik", "kwalifikowany");
      out.push({ rodzaj, cudzoziemiec: cudz, pracodawca: pd.metody, pracownik: pr.metody, pracownik_po_kwalifikowanym: prQ.metody, podstawa: pd.podstawa,
        podpisuje_domyslnie: domyslniePodpisuje(rodzaj, cudz), podpisuje_wymuszone: wymuszonePodpisuje(rodzaj) });
    }
  }
  return out;
}

// ---------------- statuses ----------------
// deno-lint-ignore no-explicit-any
type Any = any;
export const STATUS_DOK: Record<string, string> = {
  u_pracodawcy: "czeka na podpis pracodawcy", weryfikacja_pracodawcy: "podpis pracodawcy do weryfikacji", u_pracownika: "czeka na pracownika",
  weryfikacja_pracownika: "podpis pracownika do weryfikacji", gotowy: "podpisany i zweryfikowany", w_aktach: "w aktach osobowych", anulowany: "anulowany",
};
export const STATUS_PAK: Record<string, string> = {
  szkic: "szkic — niewydany", u_pracodawcy: "u pracodawcy", u_pracownika: "u pracownika", weryfikacja: "do weryfikacji przez kadry",
  gotowy: "gotowy — do zamknięcia", zakonczony: "zakończony — w aktach", anulowany: "anulowany",
};
const done = (s: string) => s === "zweryfikowany" || s === "nie_dotyczy";
export function statusDok(d: Any): string {
  if (d.status === "anulowany" || d.status === "w_aktach") return d.status;
  if (d.pd_status === "wgrany") return "weryfikacja_pracodawcy";
  if (!done(d.pd_status)) return "u_pracodawcy";
  if (d.podpisuje === "potwierdzenie") return d.odbior_at ? "gotowy" : "u_pracownika";
  if (d.pr_status === "wgrany") return "weryfikacja_pracownika";
  if (!done(d.pr_status)) return "u_pracownika";
  return "gotowy";
}
export function statusPak(p: Any, docs: Any[]): string {
  if (["szkic", "anulowany", "zakonczony"].includes(p.status)) return p.status;
  const s = docs.filter((d) => d.status !== "anulowany").map(statusDok);
  if (!s.length) return p.status;
  if (s.every((x) => x === "gotowy" || x === "w_aktach")) return "gotowy";
  if (s.some((x) => x.startsWith("weryfikacja"))) return "weryfikacja";
  if (s.some((x) => x === "u_pracodawcy")) return "u_pracodawcy";
  return "u_pracownika";
}
// the step columns a new document starts with
export function kroki(podpisuje: string) {
  return {
    pd_status: podpisuje === "obie" || podpisuje === "pracodawca" ? "oczekuje" : "nie_dotyczy",
    pr_status: podpisuje === "obie" || podpisuje === "pracownik" ? "oczekuje" : "nie_dotyczy",
  };
}
const elektroniczny = (metoda: string | null) => metoda === "kwalifikowany" || metoda === "zaufany";
// the employer's file the worker's electronic signature should continue (or null)
export function plikPracodawcyDoPodpisu(d: Any): boolean {
  return d.pd_status === "zweryfikowany" && elektroniczny(d.pd_metoda) && !!d.pd_path;
}
// what makes up the signed document once both steps are done
export function finalne(d: Any): ("wydany" | "pracodawca" | "pracownik")[] {
  const pd = d.pd_status === "zweryfikowany" && d.pd_path, pr = d.pr_status === "zweryfikowany" && d.pr_path;
  if (pr && d.pr_baza === "pracodawca") return ["pracownik"]; // one file carrying both signatures
  const out: ("wydany" | "pracodawca" | "pracownik")[] = [];
  if (pd) out.push("pracodawca");
  if (pr) out.push("pracownik");
  return out.length ? out : ["wydany"];
}
export function plainName(s: string, max = 70): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/\.{2,}/g, ".").replace(/_+/g, "_").replace(/^[_.-]+|[_.-]+$/g, "").slice(0, max).replace(/[_.-]+$/, "") || "dokument";
}

// RFC 4122 version 5 (SHA-1, name-based): the same document and file role always give the same id
export async function uuid5(name: string): Promise<string> {
  const ns = [0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8]; // URL namespace
  const data = new Uint8Array([...ns, ...new TextEncoder().encode("td-podpisy:" + name)]);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((v) => v.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
