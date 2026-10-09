// Poczta — mailbox browser, pure parts: the structure of a message (BODYSTRUCTURE), decoding of its parts,
// and the cleaning of HTML mail for display. Tested in widok_test.ts.
//
// HTML mail is hostile input. Three independent layers keep it harmless:
//   1. oczyscHtml(): an allow-list sanitiser — no script, style blocks, forms, frames, objects, meta, base, svg;
//      no event handlers; only http(s)/mailto/tel links; inline CSS limited to harmless properties without url();
//      remote pictures are disarmed (kept as data-zdalne, loaded only when the reader asks).
//   2. ramka(): the result is wrapped into a document with a Content-Security-Policy that allows nothing but
//      inline styles and data: pictures (https: pictures only after the reader's click).
//   3. the page shows that document in <iframe sandbox> WITHOUT allow-scripts and WITHOUT allow-same-origin,
//      through the srcdoc property — the mail never becomes part of the portal's own DOM.

import sanitizeHtml from "npm:sanitize-html@2.17.0";
import { type Node, str } from "./imap.ts";

// ---------------------------------------------------------------- header words and parameters
function dekoduj(bytes: Uint8Array, charset: string): string {
  const cs = (charset || "utf-8").trim().toLowerCase().replace(/^(x-)?(cp|win)-?(125\d)$/, "windows-$3");
  try { return new TextDecoder(cs, { fatal: false }).decode(bytes); } catch { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
}
export function base64Bytes(src: Uint8Array | string): Uint8Array {
  const s = typeof src === "string" ? new TextEncoder().encode(src) : src;
  const out = new Uint8Array(Math.floor(s.length * 3 / 4) + 3);
  let acc = 0, bits = 0, n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const v = c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 71 : c >= 48 && c <= 57 ? c + 4 : c === 43 || c === 45 ? 62 : c === 47 || c === 95 ? 63 : -1;
    if (v < 0) continue; // line breaks, padding, anything foreign
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 255; }
  }
  return out.subarray(0, n);
}
export function qpBytes(s: Uint8Array, naglowek = false): Uint8Array {
  const out = new Uint8Array(s.length);
  let n = 0;
  const hex = (c: number) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 61) {
      if (s[i + 1] === 13 && s[i + 2] === 10) { i += 2; continue; }
      if (s[i + 1] === 10) { i += 1; continue; }
      const a = hex(s[i + 1] ?? 0), b = hex(s[i + 2] ?? 0);
      if (a >= 0 && b >= 0) { out[n++] = a * 16 + b; i += 2; continue; }
    }
    out[n++] = naglowek && c === 95 ? 32 : c;
  }
  return out.subarray(0, n);
}
// RFC 2047: "=?UTF-8?B?...?=" and "=?iso-8859-2?Q?...?=" inside header values and file names
export function dekodujSlowa(v: string): string {
  return String(v ?? "").replace(/(=\?[^?\s]+\?[bq]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bq]\?)/gi, "$1")
    .replace(/=\?([^?\s]+)\?([bq])\?([^?\s]*)\?=/gi, (_m, cs: string, e: string, t: string) => dekoduj(e.toLowerCase() === "b" ? base64Bytes(t) : qpBytes(new TextEncoder().encode(t), true), cs.split("*")[0]));
}
// A parameter that may be plain, RFC 2047-encoded, or RFC 2231 (name*=UTF-8''%C5%BC…, name*0*=…; name*1=…)
export function parametr(params: Record<string, string>, name: string): string {
  if (params[name + "*"]) return pct(params[name + "*"], true);
  if (name + "*0" in params || name + "*0*" in params) {
    let out = "", cs = "utf-8";
    const raw: number[] = [];
    for (let i = 0; i < 40; i++) {
      const ext = params[`${name}*${i}*`], plain = params[`${name}*${i}`];
      if (ext === undefined && plain === undefined) break;
      if (ext !== undefined) {
        let v = ext;
        if (i === 0) { const m = v.match(/^([^']*)'[^']*'(.*)$/s); if (m) { cs = m[1] || "utf-8"; v = m[2]; } }
        raw.push(...pctBytes(v));
      } else raw.push(...new TextEncoder().encode(plain));
    }
    out = dekoduj(new Uint8Array(raw), cs);
    return out;
  }
  return dekodujSlowa(params[name] ?? "");
}
function pctBytes(v: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "%" && /^[0-9a-f]{2}$/i.test(v.slice(i + 1, i + 3))) { out.push(parseInt(v.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(...new TextEncoder().encode(v[i]));
  }
  return out;
}
function pct(v: string, withCharset: boolean): string {
  let cs = "utf-8";
  if (withCharset) { const m = v.match(/^([^']*)'[^']*'(.*)$/s); if (m) { cs = m[1] || "utf-8"; v = m[2]; } }
  return dekoduj(new Uint8Array(pctBytes(v)), cs);
}

// ---------------------------------------------------------------- BODYSTRUCTURE
export type Czesc = {
  id: string; typ: string;            // "text/plain"
  charset: string; kodowanie: string; // transfer encoding, lower case
  rozmiar: number;                    // bytes as stored in the message (encoded)
  nazwa: string; cid: string; zalacznik: boolean; inline: boolean;
};
const pary = (n: Node | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (Array.isArray(n)) for (let i = 0; i + 1 < n.length; i += 2) { const k = str(n[i]).toLowerCase(); if (k && !(k in out)) out[k] = str(n[i + 1]); }
  return out;
};
const czystaNazwa = (s: string) => s.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "").replace(/[\\/]/g, "_").trim().slice(0, 160);
// The leaves of a message, numbered the way IMAP addresses them ("1", "1.2", "2"). An attached message
// (message/rfc822) is one leaf — it is offered for download, not opened.
export function czesci(bs: Node | null): Czesc[] {
  const out: Czesc[] = [];
  const walk = (n: Node, path: string, depth: number) => {
    if (!Array.isArray(n) || depth > 20 || out.length >= 200) return;
    if (Array.isArray(n[0])) { // multipart: children first, then the subtype
      let k = 0;
      while (k < n.length && Array.isArray(n[k])) { walk(n[k], path ? `${path}.${k + 1}` : String(k + 1), depth + 1); k++; }
      return;
    }
    const typ = (str(n[0]) + "/" + str(n[1])).toLowerCase();
    const params = pary(n[2]);
    // where the extension data starts depends on the type
    const ext = typ.startsWith("text/") ? 8 : typ === "message/rfc822" ? 10 : 7;
    const disp = Array.isArray(n[ext + 1]) ? n[ext + 1] as Node[] : null;
    const dtyp = disp ? str(disp[0]).toLowerCase() : "";
    const dparams = disp ? pary(disp[1]) : {};
    const nazwa = czystaNazwa(parametr(dparams, "filename") || parametr(params, "name"));
    const cid = str(n[3]).replace(/^<|>$/g, "").trim();
    const tekst = typ === "text/plain" || typ === "text/html";
    out.push({
      id: path || "1", typ, charset: params.charset ?? "", kodowanie: str(n[5]).toLowerCase(), rozmiar: Number(str(n[6])) || 0,
      nazwa, cid, inline: dtyp === "inline", zalacznik: dtyp === "attachment" || (!tekst && !(dtyp === "inline" && cid && typ.startsWith("image/"))) || (tekst && !!nazwa && dtyp !== "inline"),
    });
  };
  if (bs) walk(bs, "", 0);
  return out;
}
export const tekstCzesc = (cz: Czesc[], typ: "text/plain" | "text/html") => cz.find((c) => c.typ === typ && !c.zalacznik) ?? null;
// what the reader sees as attachments (pictures used inside the HTML are not listed)
export function zalaczniki(cz: Czesc[], uzyteCid: Set<string> = new Set()): Czesc[] {
  const plain = tekstCzesc(cz, "text/plain"), html = tekstCzesc(cz, "text/html");
  return cz.filter((c) => c !== plain && c !== html && !(c.cid && uzyteCid.has(c.cid)) && (c.zalacznik || c.inline));
}
export const maZalaczniki = (cz: Czesc[]) => cz.some((c) => c.zalacznik);
// decoded size of a part, from its stored size
export const rozmiarPo = (c: Czesc) => (c.kodowanie === "base64" ? Math.floor(c.rozmiar * 0.74) : c.rozmiar);
export function odkoduj(c: Pick<Czesc, "kodowanie">, bytes: Uint8Array): Uint8Array {
  return c.kodowanie === "base64" ? base64Bytes(bytes) : c.kodowanie === "quoted-printable" ? qpBytes(bytes) : bytes;
}
export const naTekst = (c: Czesc, bytes: Uint8Array) => dekoduj(odkoduj(c, bytes), c.charset);

// A safe name for the browser's download: no path, no control characters, never an empty name.
export function nazwaPliku(c: Czesc): string {
  const n = czystaNazwa(c.nazwa).replace(/["<>|:*?]/g, "_").replace(/^\.+/, "");
  return n || "zalacznik-" + c.id.replace(/\./g, "-") + (c.typ === "message/rfc822" ? ".eml" : "");
}

// ---------------------------------------------------------------- HTML mail
const BEZPIECZNY_STYL = /^(?![\s\S]*(?:url\s*\(|expression|javascript:|@import|behavior|-moz-binding|\\|<|>|\/\*))[\s\S]{0,200}$/i;
const STYLE = ["color", "background-color", "font", "font-family", "font-size", "font-weight", "font-style", "text-align", "text-decoration", "text-transform", "line-height", "letter-spacing", "white-space",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-style", "border-width", "border-collapse", "border-spacing", "border-radius",
  "width", "max-width", "min-width", "height", "max-height", "min-height", "vertical-align", "display", "float", "clear", "list-style", "list-style-type", "table-layout", "word-break", "overflow-wrap"];
const TAGI = ["a", "abbr", "b", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "div", "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins",
  "li", "ol", "p", "pre", "q", "s", "small", "span", "strike", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"];
const WSPOLNE = ["style", "align", "valign", "width", "height", "bgcolor", "color", "border", "cellpadding", "cellspacing", "colspan", "rowspan", "dir", "lang", "title", "face", "size"];
const MAX_HTML = 1024 * 1024, MAX_DATA_IMG = 600 * 1024;
const OBRAZ = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;

// `cid`: pictures of the message already turned into data: URIs (Content-ID -> URI).
// Returns the cleaned fragment and how many remote pictures were disarmed.
export function oczyscHtml(html: string, cid: Map<string, string> = new Map()): { html: string; zdalne: number } {
  let zdalne = 0;
  const out = sanitizeHtml(String(html ?? "").slice(0, MAX_HTML), {
    allowedTags: TAGI,
    allowedAttributes: { "*": WSPOLNE, a: ["href", "target", "rel", "title"], img: ["src", "alt", "width", "height", "data-zdalne", "style", "align", "border"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["data"] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    allowedStyles: { "*": Object.fromEntries(STYLE.map((p) => [p, [BEZPIECZNY_STYL]])) },
    nonTextTags: ["style", "script", "textarea", "option", "noscript", "title", "head", "template", "xmp", "noembed", "noframes", "plaintext", "iframe", "object", "embed", "svg", "math", "select"],
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: false,
    transformTags: {
      // a link opens outside the portal, in a new tab, and shows where it really leads
      a: (_tag: string, at: Record<string, string>) => {
        const a: Record<string, string> = {};
        try {
          const u = new URL(String(at.href ?? "").trim());
          if (["http:", "https:", "mailto:", "tel:"].includes(u.protocol)) {
            a.href = u.href; a.target = "_blank"; a.rel = "noopener noreferrer nofollow";
            a.title = u.protocol.startsWith("http") ? "Otwiera: " + u.host : u.protocol === "mailto:" ? "Adres e-mail: " + u.pathname.slice(0, 120) : "Telefon";
          }
        } catch { /* not a usable address: the text stays, the link goes */ }
        return { tagName: "a", attribs: a };
      },
      // pictures: embedded ones stay, pictures of the message are resolved, remote ones wait for the reader's click
      img: (_tag: string, at: Record<string, string>) => {
        const a: Record<string, string> = {};
        for (const k of ["alt", "width", "height", "style", "align", "border"]) if (typeof at[k] === "string") a[k] = at[k];
        const src = String(at.src ?? "").trim();
        if (/^cid:/i.test(src)) { const d = cid.get(src.slice(4).trim().replace(/^<|>$/g, "")); if (d) a.src = d; }
        else if (/^data:/i.test(src)) { if (src.length <= MAX_DATA_IMG && OBRAZ.test(src)) a.src = src.replace(/\s+/g, ""); }
        else { try { const u = new URL(src); if (u.protocol === "https:" && !u.username && !u.password) { a["data-zdalne"] = u.href; zdalne++; } } catch { /* dropped */ } }
        return { tagName: "img", attribs: a };
      },
    },
  });
  return { html: out, zdalne };
}
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";
// The whole document for the sandboxed frame. Remote pictures stay off.
export function ramka(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="referrer" content="no-referrer"><base target="_blank">` +
    `<style>html{background:#fff}body{margin:14px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#1B3F7F}blockquote{margin:8px 0 8px 8px;padding-left:10px;border-left:3px solid #d4dbe6;color:#555}pre{white-space:pre-wrap}</style></head><body>${html}</body></html>`;
}
// The reader asked for the pictures from the internet: the same document with https: pictures allowed and armed.
// (poczta.js does these two replacements in the browser; kept here so the tests cover them.)
export function pokazObrazy(srcdoc: string): string {
  return srcdoc.replace("img-src data:;", "img-src data: https:;").replace(/ data-zdalne="/g, ' src="');
}
// the Content-IDs an HTML body refers to
export function cidWHtml(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of String(html ?? "").slice(0, MAX_HTML).matchAll(/cid:([^"'\s>)]{1,200})/gi)) out.add(m[1].replace(/^<|>$/g, ""));
  return out;
}
