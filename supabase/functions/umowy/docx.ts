// DOCX as a ZIP of XML parts: reading, the safety check of an uploaded template, and filling the
// {{PLACEHOLDERS}} inside the document XML without touching anything else (formatting is preserved because
// only the text of <w:t> nodes changes). No library: DecompressionStream / CompressionStream ('deflate-raw').
//
// A placeholder may be split across several runs by the editor — matching is done on the text of the whole
// paragraph and the replacement is written into the first run it touches. Values are XML-escaped and
// stripped of control characters; a value can never create markup, a field or a new placeholder.

export type Wpis = { nazwa: string; metoda: number; crc: number; csize: number; usize: number; dane: Uint8Array /* compressed bytes as stored */; czas: number; data: number };

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const MAX_WPISOW = 300, MAX_ROZPAKOWANE = 40 * 1024 * 1024;

let CRC: Uint32Array | null = null;
export function crc32(b: Uint8Array): number {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function przez(strumien: TransformStream<Uint8Array, Uint8Array>, dane: Uint8Array): Promise<Uint8Array> {
  const out = new Response(new Blob([dane as BlobPart]).stream().pipeThrough(strumien as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}
const inflate = (d: Uint8Array) => przez(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>, d);
const deflate = (d: Uint8Array) => przez(new CompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>, d);

// The entries of a ZIP, read from its central directory. Throws on anything that is not a plain archive.
export function czytajZip(b: Uint8Array): Wpis[] {
  if (b.length < 22 || u32(b, 0) !== 0x04034b50) throw new Error("To nie jest plik DOCX (brak sygnatury archiwum).");
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("Uszkodzony plik DOCX (brak katalogu archiwum).");
  const n = u16(b, e + 10), cdOff = u32(b, e + 16);
  if (n === 0 || n > MAX_WPISOW) throw new Error("Nieprawidłowa liczba plików w archiwum DOCX.");
  const out: Wpis[] = [], dec = new TextDecoder();
  let o = cdOff, razem = 0;
  for (let i = 0; i < n; i++) {
    if (o + 46 > b.length || u32(b, o) !== 0x02014b50) throw new Error("Uszkodzony katalog archiwum DOCX.");
    const flagi = u16(b, o + 8), metoda = u16(b, o + 10), czas = u16(b, o + 12), data = u16(b, o + 14), crc = u32(b, o + 16), csize = u32(b, o + 20), usize = u32(b, o + 24);
    const nl = u16(b, o + 28), el = u16(b, o + 30), cl = u16(b, o + 32), lok = u32(b, o + 42);
    const nazwa = dec.decode(b.subarray(o + 46, o + 46 + nl));
    if (flagi & 1) throw new Error("Zaszyfrowany plik DOCX nie jest obsługiwany.");
    if (metoda !== 0 && metoda !== 8) throw new Error("Nieobsługiwana kompresja w pliku DOCX.");
    if (!nazwa || nazwa.includes("..") || nazwa.startsWith("/") || nazwa.includes("\\") || nazwa.includes("\0") || nazwa.length > 240) throw new Error("Niedozwolona nazwa pliku w archiwum DOCX.");
    razem += usize;
    if (razem > MAX_ROZPAKOWANE) throw new Error("Plik DOCX jest zbyt duży po rozpakowaniu.");
    if (lok + 30 > b.length || u32(b, lok) !== 0x04034b50) throw new Error("Uszkodzony wpis archiwum DOCX.");
    const start = lok + 30 + u16(b, lok + 26) + u16(b, lok + 28);
    if (start + csize > b.length) throw new Error("Uszkodzony wpis archiwum DOCX.");
    if (!nazwa.endsWith("/")) out.push({ nazwa, metoda, crc, csize, usize, dane: b.subarray(start, start + csize), czas, data });
    o += 46 + nl + el + cl;
  }
  return out;
}
export async function tresc(w: Wpis): Promise<Uint8Array> {
  const d = w.metoda === 0 ? w.dane : await inflate(w.dane);
  if (d.length !== w.usize || crc32(d) !== w.crc) throw new Error("Uszkodzony plik w archiwum DOCX: " + w.nazwa);
  return d;
}
// Writes the archive back: entries given new content are compressed again, the rest are copied byte for byte.
export async function piszZip(wpisy: Wpis[], nowe: Record<string, Uint8Array>): Promise<Uint8Array> {
  const enc = new TextEncoder(), czesci: Uint8Array[] = [], katalog: Uint8Array[] = [];
  let off = 0;
  for (const w of wpisy) {
    let metoda = w.metoda, crc = w.crc, csize = w.csize, usize = w.usize, dane = w.dane;
    const n = nowe[w.nazwa];
    if (n) { dane = await deflate(n); metoda = 8; crc = crc32(n); csize = dane.length; usize = n.length; }
    const nazwa = enc.encode(w.nazwa);
    const lh = new Uint8Array(30 + nazwa.length), v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, metoda, true); v.setUint16(10, w.czas, true); v.setUint16(12, w.data, true);
    v.setUint32(14, crc, true); v.setUint32(18, csize, true); v.setUint32(22, usize, true); v.setUint16(26, nazwa.length, true); v.setUint16(28, 0, true);
    lh.set(nazwa, 30);
    const ch = new Uint8Array(46 + nazwa.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, metoda, true); c.setUint16(12, w.czas, true); c.setUint16(14, w.data, true);
    c.setUint32(16, crc, true); c.setUint32(20, csize, true); c.setUint32(24, usize, true); c.setUint16(28, nazwa.length, true); c.setUint32(42, off, true);
    ch.set(nazwa, 46);
    czesci.push(lh, dane); katalog.push(ch);
    off += lh.length + dane.length;
  }
  const cdLen = katalog.reduce((s, k) => s + k.length, 0);
  const eo = new Uint8Array(22), ev = new DataView(eo.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, wpisy.length, true); ev.setUint16(10, wpisy.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, off, true);
  const out = new Uint8Array(off + cdLen + 22);
  let p = 0;
  for (const cz of [...czesci, ...katalog, eo]) { out.set(cz, p); p += cz.length; }
  return out;
}

// ---------------------------------------------------------------- XML of a part
const B = "\uE000", NB = "\uE001", DZ = "\uE002"; // private marks inside a rich value: bold / not bold / as the run
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
// what a person typed, made safe for a text node: one line, no control or private-use characters
export function czysc(v: unknown): string {
  return czyscSeg(v).trim();
}
// the same without trimming: a segment of a rich value may begin or end with a space
function czyscSeg(v: unknown): string {
  // deno-lint-ignore no-control-regex
  return String(v ?? "").replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(/[\u0000-\u001F\u007F-\u009F\uE000-\uF8FF\uFFFE\uFFFF]/g, "").replace(/ {2,}/g, " ");
}
export type Segment = { t: string; b?: boolean };
export type Wartosc = string | Segment[];
const naTekst = (w: Wartosc): string => typeof w === "string" ? esc(czysc(w)) : w.map((s) => (s.b === true ? B : s.b === false ? NB : DZ) + esc(czyscSeg(s.t))).join("");
export const wartoscTekst = (w: Wartosc): string => typeof w === "string" ? czysc(w) : w.map((s) => czyscSeg(s.t)).join("");

type Akapit = { od: number; do: number };
// paragraphs of a part, in document order (the templates have no nested paragraphs: text boxes are refused on upload)
function akapity(xml: string): Akapit[] {
  const out: Akapit[] = [];
  let i = 0;
  for (;;) {
    const s = xml.indexOf("<w:p", i);
    if (s < 0) break;
    const ch = xml[s + 4];
    if (ch !== ">" && ch !== " " && ch !== "/") { i = s + 4; continue; }
    const gt = xml.indexOf(">", s);
    if (gt < 0) break;
    if (xml[gt - 1] === "/") { i = gt + 1; continue; }
    const e = xml.indexOf("</w:p>", gt);
    if (e < 0) break;
    out.push({ od: s, do: e + 6 });
    i = e + 6;
  }
  return out;
}
type Wezel = { od: number; do: number; tekst: string; tag: number }; // positions of the text inside the paragraph string
function wezly(p: string): Wezel[] {
  const out: Wezel[] = [], re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) { const od = m.index + m[0].indexOf(">") + 1; out.push({ od, do: od + m[1].length, tekst: m[1], tag: m.index }); }
  return out;
}
const PH = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

// Visible text of a part: one line per paragraph, cells of a table row separated by " | ".
export function tekstCzesci(xml: string): string {
  const out: string[] = [];
  for (const a of akapity(xml)) {
    const p = xml.slice(a.od, a.do).replace(/<w:tab\/>/g, "<w:t>\t</w:t>").replace(/<w:br[^>]*\/>/g, "<w:t>\n</w:t>");
    out.push(unesc(wezly(p).map((w) => w.tekst).join("")));
  }
  return out.join("\n");
}
// Placeholders of a part with the number of occurrences, in the order of first appearance; plus brace
// fragments that are not a well-formed placeholder (a template with those is refused).
export function placeholdery(xml: string): { lista: { nazwa: string; ile: number }[]; bledne: string[] } {
  const ile = new Map<string, number>(), bledne: string[] = [];
  for (const a of akapity(xml)) {
    const t = wezly(xml.slice(a.od, a.do)).map((w) => w.tekst).join("");
    if (!t.includes("{") && !t.includes("}")) continue;
    for (const m of t.matchAll(PH)) ile.set(m[1], (ile.get(m[1]) ?? 0) + 1);
    const reszta = t.replace(PH, "");
    if (/\{\{|\}\}|\{[A-Z_]{3,}\}/.test(reszta)) bledne.push(unesc(reszta.replace(/\s+/g, " ")).slice(0, 120));
  }
  return { lista: [...ile].map(([nazwa, n]) => ({ nazwa, ile: n })), bledne };
}

export type Literal = { w_akapicie: string; szukaj: string; na: string }; // replace `szukaj` in the paragraph whose text contains `w_akapicie`
export type Wynik = { xml: string; uzyte: Record<string, number>; nieznane: string[]; literaly: boolean[] };

// Fills one part. wartosci[NAME] is a text, a rich text (segments, bold or not) or — when the placeholder
// stands for different things in different places — a list with one value per occurrence in document order.
// A placeholder without a value is left as it is and reported in `nieznane`.
export function wypelnij(xml: string, wartosci: Record<string, Wartosc | Wartosc[]>, literaly: Literal[] = []): Wynik {
  const uzyte: Record<string, number> = {}, nieznane: string[] = [], lit = literaly.map(() => false);
  const kawalki: string[] = [];
  let poprz = 0;
  for (const a of akapity(xml)) {
    let p = xml.slice(a.od, a.do);
    const ws = wezly(p), pelny = ws.map((w) => w.tekst).join("");
    type Traf = { od: number; do: number; na: string };
    const trafy: Traf[] = [];
    if (pelny.includes("{{")) {
      for (const m of pelny.matchAll(PH)) {
        const nazwa = m[1], k = uzyte[nazwa] ?? 0, w = wartosci[nazwa];
        uzyte[nazwa] = k + 1;
        // a list of values = one per occurrence; a list of segments = one rich value
        const jedna = Array.isArray(w) && w.length > 0 && w.every((x) => typeof x === "string" || Array.isArray(x)) ? (w as Wartosc[])[Math.min(k, w.length - 1)] : (w as Wartosc | undefined);
        if (jedna === undefined || jedna === null) { if (!nieznane.includes(nazwa)) nieznane.push(nazwa); continue; }
        trafy.push({ od: m.index!, do: m.index! + m[0].length, na: naTekst(jedna) });
      }
    }
    literaly.forEach((l, i) => {
      if (!pelny.includes(l.w_akapicie)) return;
      const s = esc(l.szukaj), at = pelny.indexOf(s);
      if (at < 0 || trafy.some((t) => at < t.do && at + s.length > t.od)) return;
      trafy.push({ od: at, do: at + s.length, na: esc(czysc(l.na)) });
      lit[i] = true;
    });
    if (trafy.length) {
      trafy.sort((x, y) => y.od - x.od);
      const teksty = ws.map((w) => w.tekst), poczatki: number[] = [];
      let acc = 0;
      for (const w of ws) { poczatki.push(acc); acc += w.tekst.length; }
      const zmienione = new Set<number>();
      for (const t of trafy) {
        // the nodes the match starts and ends in (a match never starts at the very end of a node)
        let i = 0;
        while (i + 1 < ws.length && poczatki[i + 1] <= t.od) i++;
        let j = i;
        while (j + 1 < ws.length && poczatki[j + 1] < t.do) j++;
        const a0 = t.od - poczatki[i], b0 = t.do - poczatki[j];
        if (i === j) teksty[i] = teksty[i].slice(0, a0) + t.na + teksty[i].slice(b0);
        else {
          teksty[j] = teksty[j].slice(b0);
          for (let k = i + 1; k < j; k++) teksty[k] = "";
          teksty[i] = teksty[i].slice(0, a0) + t.na;
          for (let k = i + 1; k <= j; k++) zmienione.add(k);
        }
        zmienione.add(i);
      }
      for (let k = ws.length - 1; k >= 0; k--) {
        if (!zmienione.has(k)) continue;
        const w = ws[k], otw = p.slice(w.tag, w.od);
        const tag = otw.includes("xml:space") ? otw : otw.replace(/^<w:t/, '<w:t xml:space="preserve"');
        p = p.slice(0, w.tag) + tag + teksty[k] + p.slice(w.do);
      }
      if (p.includes(B) || p.includes(NB) || p.includes(DZ)) p = rozdzielBiegi(p);
    }
    kawalki.push(xml.slice(poprz, a.od), p);
    poprz = a.do;
  }
  kawalki.push(xml.slice(poprz));
  return { xml: kawalki.join(""), uzyte, nieznane, literaly: lit };
}
// A run whose text carries rich marks becomes several runs with the same properties, bold switched per segment.
function rozdzielBiegi(p: string): string {
  const ZN = new RegExp("[" + B + NB + DZ + "]", "g");
  p = p.replace(/<w:r(?:\s[^>]*)?>(<w:rPr>[\s\S]*?<\/w:rPr>)?(<w:t(?:\s[^>]*)?>)([^<]*)<\/w:t><\/w:r>/g, (cale, rpr: string | undefined, tOpen: string, tekst: string) => {
    if (!ZN.test(tekst)) return cale;
    ZN.lastIndex = 0;
    const otw = cale.slice(0, cale.indexOf(">") + 1), czesci: { znak: string; t: string }[] = [];
    let znak = DZ, buf = "";
    for (const ch of tekst) {
      if (ch === B || ch === NB || ch === DZ) { if (buf) czesci.push({ znak, t: buf }); znak = ch; buf = ""; } else buf += ch;
    }
    if (buf) czesci.push({ znak, t: buf });
    const bez = (rpr ?? "").replace(/<w:b(?:Cs)?(?:\s[^>]*)?\/>/g, "");
    const zB = bez ? (/<w:rFonts[^>]*\/>/.test(bez) ? bez.replace(/(<w:rFonts[^>]*\/>)/, "$1<w:b/><w:bCs/>") : bez.replace("<w:rPr>", "<w:rPr><w:b/><w:bCs/>")) : "<w:rPr><w:b/><w:bCs/></w:rPr>";
    return czesci.map((c) => otw + (c.znak === B ? zB : c.znak === NB ? bez : (rpr ?? "")) + tOpen + c.t + "</w:t></w:r>").join("");
  });
  return p.replace(ZN, ""); // a run of another shape keeps the text, without the marks
}

// ---------------------------------------------------------------- a template as a whole
export const CZESCI = /^word\/(document|header\d*|footer\d*)\.xml$/;
const dec = new TextDecoder("utf-8", { fatal: true }), enc = new TextEncoder();

export type Szablon = { wpisy: Wpis[]; czesci: Record<string, string> };
export async function otworz(b: Uint8Array): Promise<Szablon> {
  const wpisy = czytajZip(b), czesci: Record<string, string> = {};
  for (const w of wpisy) if (CZESCI.test(w.nazwa)) czesci[w.nazwa] = dec.decode(await tresc(w));
  if (!czesci["word/document.xml"]) throw new Error("To nie jest dokument Word (brak word/document.xml).");
  return { wpisy, czesci };
}
// Is the file a plain Word document that is safe to keep as a template? Returns its placeholders.
export async function sprawdzSzablon(b: Uint8Array): Promise<{ lista: { nazwa: string; ile: number }[]; bledne: string[] }> {
  const s = await otworz(b);
  const nazwy = s.wpisy.map((w) => w.nazwa);
  if (!nazwy.includes("[Content_Types].xml") || !nazwy.includes("_rels/.rels")) throw new Error("To nie jest dokument Word (brak opisu zawartości).");
  const zly = nazwy.find((n) => /vbaProject|\.bin$|^word\/(embeddings|activeX)\/|\.(exe|js|vbs|dll|bat|cmd|ps1)$/i.test(n));
  if (zly) throw new Error("Szablon zawiera niedozwolony element (makro lub osadzony obiekt): " + zly);
  for (const w of s.wpisy) {
    if (w.nazwa === "[Content_Types].xml" || w.nazwa.endsWith(".rels")) {
      const x = dec.decode(await tresc(w));
      if (/macroEnabled|vnd\.ms-office\.vbaProject/i.test(x)) throw new Error("Szablon z makrami nie jest dozwolony — zapisz go jako zwykły .docx.");
      for (const r of x.matchAll(/<Relationship\b[^>]*>/g)) if (/TargetMode="External"/i.test(r[0]) && !/\/hyperlink"/.test(r[0])) throw new Error("Szablon odwołuje się do zewnętrznego zasobu — usuń powiązanie i zapisz ponownie.");
    }
  }
  const lista = new Map<string, number>(), bledne: string[] = [];
  for (const [nazwa, x] of Object.entries(s.czesci)) {
    if (/<w:txbxContent|<mc:AlternateContent/.test(x)) throw new Error("Szablon zawiera pole tekstowe (" + nazwa + ") — generator go nie obsługuje.");
    for (const m of x.matchAll(/<w:instrText[^>]*>([^<]*)<\/w:instrText>/g)) if (!/^\s*(PAGE|NUMPAGES)\s*(\\\*\s*\w+\s*)*$/.test(unesc(m[1]))) throw new Error("Szablon zawiera pole Word inne niż numer strony: " + unesc(m[1]).trim().slice(0, 40));
    if (/<w:fldSimple\b/.test(x) && [...x.matchAll(/<w:fldSimple\b[^>]*w:instr="([^"]*)"/g)].some((m) => !/^\s*(PAGE|NUMPAGES)\b/.test(unesc(m[1])))) throw new Error("Szablon zawiera pole Word inne niż numer strony.");
    const p = placeholdery(x);
    for (const e of p.lista) lista.set(e.nazwa, (lista.get(e.nazwa) ?? 0) + e.ile);
    bledne.push(...p.bledne);
  }
  return { lista: [...lista].map(([nazwa, ile]) => ({ nazwa, ile })), bledne };
}
export type Gotowy = { docx: Uint8Array; tekst: string; nieznane: string[]; pozostale: string[]; literaly: boolean[] };
// Fills every text part of the template and packs the document again.
export async function generuj(s: Szablon, wartosci: Record<string, Wartosc | Wartosc[]>, literaly: Literal[] = []): Promise<Gotowy> {
  const nowe: Record<string, Uint8Array> = {}, nieznane: string[] = [], pozostale: string[] = [], lit = literaly.map(() => false);
  let tekst = "";
  for (const nazwa of Object.keys(s.czesci).sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)))) {
    const w = wypelnij(s.czesci[nazwa], wartosci, nazwa === "word/document.xml" ? literaly : []);
    for (const n of w.nieznane) if (!nieznane.includes(n)) nieznane.push(n);
    if (nazwa === "word/document.xml") { w.literaly.forEach((v, i) => { lit[i] = v; }); tekst = tekstCzesci(w.xml); }
    const po = placeholdery(w.xml);
    for (const e of po.lista) if (!pozostale.includes("{{" + e.nazwa + "}}")) pozostale.push("{{" + e.nazwa + "}}");
    pozostale.push(...po.bledne);
    if (w.xml !== s.czesci[nazwa]) nowe[nazwa] = enc.encode(w.xml);
  }
  return { docx: await piszZip(s.wpisy, nowe), tekst, nieznane, pozostale, literaly: lit };
}
export async function sha256(b: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function b64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function zB64(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, "")), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
