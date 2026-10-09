// Poczta — building an outgoing message (pure; tested in mime_test.ts).
// Addresses, header values and file names are validated / encoded here, so nothing typed by a person can add a
// header or a MIME part: CR, LF and other control characters never reach a header.

import sanitizeHtml from "npm:sanitize-html@2.17.0";
import { htmlToText } from "./logic.ts";

const te = new TextEncoder();
const CTL = /[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
export const bezCtl = (s: unknown, max: number) => String(s ?? "").replace(CTL, " ").replace(/\s+/g, " ").trim().slice(0, max);

// one e-mail address, strict: a local part, "@", a domain with a dot; no spaces, quotes, brackets, control characters
const ADRES = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export function adres(v: unknown): string | null {
  if (typeof v !== "string" || /[\u0000-\u001f\u007f]/.test(v)) return null;
  const a = v.trim().toLowerCase();
  return a.length <= 254 && ADRES.test(a) && !a.includes("..") ? a : null;
}
// a list typed by a person or sent by the page: every entry must be a valid address (no silent dropping)
export function adresy(v: unknown, max: number): { ok: string[]; zle: string[] } {
  const ok: string[] = [], zle: string[] = [];
  const list = Array.isArray(v) ? v : String(v ?? "").split(/[;,\s]+/);
  for (const x of list.slice(0, 200)) {
    if (typeof x !== "string" || !x.trim()) continue;
    const a = adres(x);
    if (a) { if (!ok.includes(a)) ok.push(a); } else zle.push(bezCtl(x, 80));
  }
  if (ok.length > max) zle.push(`ponad ${max} adresów`);
  return { ok, zle };
}
// addresses inside a header value of a received message (for "reply" / "reply to all")
export function adresyZNaglowka(v: unknown): string[] {
  const out: string[] = [];
  for (const m of String(v ?? "").matchAll(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) { const a = adres(m[0]); if (a && !out.includes(a)) out.push(a); }
  return out.slice(0, 50);
}

export function b64(bytes: Uint8Array): string { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
const b64linie = (bytes: Uint8Array) => b64(bytes).replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");
// RFC 2047: plain ASCII stays; anything else becomes =?UTF-8?B?…?= words of at most 75 characters
export function slowo(v: string): string {
  const s = bezCtl(v, 998);
  if (/^[\x20-\x7e]*$/.test(s) && !/=\?/.test(s)) return s;
  const out: string[] = [];
  let cur = "";
  for (const ch of s) { if (te.encode(cur + ch).length > 39) { out.push(cur); cur = ""; } cur += ch; }
  if (cur) out.push(cur);
  return out.map((w) => `=?UTF-8?B?${b64(te.encode(w))}?=`).join("\r\n ");
}
// a display name in From: encoded when not plain, quoted when it has specials
export const nazwaAdres = (nazwa: string, a: string) => {
  const n = bezCtl(nazwa, 120);
  if (!n) return a;
  return (/^[A-Za-z0-9 .!#$%&'*+/=?^_`{|}~-]*$/.test(n) ? (/[.]/.test(n) ? `"${n}"` : n) : slowo(n)) + ` <${a}>`;
};
// long address lists are folded at commas
const zloz = (name: string, list: string[]) => { let line = name + ":", out = ""; for (const [i, a] of list.entries()) { const part = " " + a + (i < list.length - 1 ? "," : ""); if (line.length + part.length > 76 && line !== name + ":") { out += line + "\r\n"; line = part; } else line += part; } return out + line; };
export const nazwaPlikuWych = (n: unknown) => bezCtl(n, 150).replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "").trim() || "zalacznik";
// file name parameter: an ASCII fallback plus the RFC 2231 form for everything else
function plik(param: string, nazwa: string): string {
  const n = nazwaPlikuWych(nazwa);
  let ascii = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  if (ascii === n && ascii.length <= 60) return `${param}="${ascii}"`;
  if (ascii.length > 60) ascii = ascii.slice(0, 50) + (ascii.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "");
  // the exact name in pieces short enough for one line each, never cutting a %XX in two
  const enc = encodeURIComponent(n).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const czesci: string[] = [];
  for (let i = 0, cur = ""; i <= enc.length;) {
    const next = enc[i] === "%" ? enc.slice(i, i + 3) : enc[i] ?? "";
    if (i === enc.length || cur.length + next.length > 50) { czesci.push(cur); cur = ""; if (i === enc.length) break; }
    cur += next; i += next.length;
  }
  return `${param}="${ascii}"` + (czesci.length === 1 ? `;\r\n ${param}*=UTF-8''${czesci[0]}` : czesci.map((c, i) => `;\r\n ${param}*${i}*=${i === 0 ? "UTF-8''" : ""}${c}`).join(""));
}

// ---------------------------------------------------------------- attachments
export const MAX_ZAL_RAZEM = 20 * 1024 * 1024, MAX_INLINE = 2 * 1024 * 1024, MAX_INLINE_N = 8;
const ROZSZ: Record<string, { typ: string; magia: (b: Uint8Array) => boolean }> = (() => {
  const zaczyna = (...sig: number[][]) => (b: Uint8Array) => sig.some((s) => s.every((x, i) => b[i] === x));
  const zip = zaczyna([0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]), ole = zaczyna([0xd0, 0xcf, 0x11, 0xe0]);
  const tekst = (b: Uint8Array) => !b.subarray(0, 4096).some((x) => x === 0) && !zaczyna([0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46], [0x23, 0x21])(b);
  return {
    pdf: { typ: "application/pdf", magia: zaczyna([0x25, 0x50, 0x44, 0x46]) },
    png: { typ: "image/png", magia: zaczyna([0x89, 0x50, 0x4e, 0x47]) }, jpg: { typ: "image/jpeg", magia: zaczyna([0xff, 0xd8, 0xff]) }, jpeg: { typ: "image/jpeg", magia: zaczyna([0xff, 0xd8, 0xff]) },
    gif: { typ: "image/gif", magia: zaczyna([0x47, 0x49, 0x46, 0x38]) }, webp: { typ: "image/webp", magia: (b) => zaczyna([0x52, 0x49, 0x46, 0x46])(b) && b[8] === 0x57 && b[9] === 0x45 },
    tif: { typ: "image/tiff", magia: zaczyna([0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a]) }, tiff: { typ: "image/tiff", magia: zaczyna([0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a]) },
    docx: { typ: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magia: zip }, xlsx: { typ: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magia: zip },
    pptx: { typ: "application/vnd.openxmlformats-officedocument.presentationml.presentation", magia: zip }, odt: { typ: "application/vnd.oasis.opendocument.text", magia: zip }, ods: { typ: "application/vnd.oasis.opendocument.spreadsheet", magia: zip },
    zip: { typ: "application/zip", magia: zip }, doc: { typ: "application/msword", magia: ole }, xls: { typ: "application/vnd.ms-excel", magia: ole }, ppt: { typ: "application/vnd.ms-powerpoint", magia: ole },
    rtf: { typ: "application/rtf", magia: zaczyna([0x7b, 0x5c, 0x72, 0x74, 0x66]) }, txt: { typ: "text/plain", magia: tekst }, csv: { typ: "text/csv", magia: tekst }, xml: { typ: "application/xml", magia: tekst },
    eml: { typ: "message/rfc822", magia: tekst }, "7z": { typ: "application/x-7z-compressed", magia: zaczyna([0x37, 0x7a, 0xbc, 0xaf]) },
  };
})();
// The type comes from the extension AND must agree with the first bytes; programs and scripts have no entry.
export function sprawdzZalacznik(nazwa: string, bytes: Uint8Array): { ok: true; typ: string } | { ok: false; error: string } {
  const n = nazwaPlikuWych(nazwa), ext = (n.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? "").toLowerCase();
  const r = ROZSZ[ext];
  if (!r) return { ok: false, error: `„${n}”: tego rodzaju pliku nie można wysłać z portalu (dozwolone: PDF, obrazy, dokumenty Office / OpenDocument, ZIP, 7z, TXT, CSV, XML, EML).` };
  if (!bytes.length) return { ok: false, error: `„${n}”: plik jest pusty.` };
  if (!r.magia(bytes)) return { ok: false, error: `„${n}”: zawartość pliku nie zgadza się z jego rozszerzeniem.` };
  return { ok: true, typ: r.typ };
}

// ---------------------------------------------------------------- the body a person wrote
const KOLOR = /^(#[0-9a-f]{3,6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;
const WYCH_TAGI = ["p", "br", "div", "span", "b", "strong", "i", "em", "u", "s", "a", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "hr", "pre", "img", "font"];
// The HTML that leaves: a short allow-list. No scripts, styles blocks, forms, frames, remote pictures (only
// cid: pictures that are attached to this very message), no event handlers; links http(s) / mailto only.
export function oczyscWychodzacy(html: string, cid: Set<string> = new Set()): string {
  return sanitizeHtml(String(html ?? "").slice(0, 400000), {
    allowedTags: WYCH_TAGI,
    allowedAttributes: { a: ["href"], img: ["src", "alt", "width", "height"], "*": ["style"], font: ["color"] },
    allowedSchemes: ["http", "https", "mailto"], allowedSchemesByTag: { img: ["cid"] }, allowProtocolRelative: false,
    allowedStyles: { "*": { color: [KOLOR], "text-align": [/^(left|right|center|justify)$/], "font-weight": [/^(bold|normal|[1-9]00)$/], "font-style": [/^(italic|normal)$/], "text-decoration": [/^(underline|line-through|none)$/], "margin-left": [/^\d{1,2}px$/] } },
    nonTextTags: ["style", "script", "textarea", "option", "noscript", "title", "head", "template", "iframe", "object", "embed", "svg", "math", "select", "xmp", "plaintext"],
    disallowedTagsMode: "discard",
    transformTags: {
      img: (_t: string, at: Record<string, string>) => {
        const m = /^cid:([A-Za-z0-9._@-]{1,80})$/.exec(String(at.src ?? "").trim());
        if (!m || !cid.has(m[1])) return { tagName: "span", attribs: {} }; // a remote or unknown picture is never sent
        const a: Record<string, string> = { src: "cid:" + m[1], alt: bezCtl(at.alt, 100) };
        for (const k of ["width", "height"]) if (/^\d{1,4}$/.test(at[k] ?? "")) a[k] = at[k];
        return { tagName: "img", attribs: a };
      },
      font: (_t: string, at: Record<string, string>) => ({ tagName: "span", attribs: KOLOR.test(at.color ?? "") ? { style: "color:" + at.color } : {} }),
    },
  });
}
// the plain-text alternative: links keep their address
export function tekstZHtml(html: string): string {
  return htmlToText(String(html ?? "").replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, t: string) => {
    const txt = t.replace(/<[^>]*>/g, "").trim(), url = href.replace(/&amp;/g, "&").replace(/^mailto:/, "");
    return !txt || txt === url || txt === href ? url : `${txt} (${url})`;
  }).replace(/<li\b[^>]*>/gi, "• ").replace(/<blockquote\b[^>]*>/gi, "\n").replace(/<hr\b[^>]*>/gi, "\n----------\n"));
}
const escH = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const tekstNaHtml = (t: string) => escH(t).replace(/\r?\n/g, "<br>");
// The original under a reply ("W dniu … … napisał(a):") or a forward (a block with its headers).
// `html` must already be the CLEANED original (widok.oczyscHtml) — remote pictures in it are dropped here.
export function cytat(tryb: "reply" | "forward", o: { od: string; data: string; temat: string; do: string; html: string; tekst: string }): { html: string; tekst: string } {
  const czysty = o.html ? o.html.replace(/<img\b[^>]*\bdata-zdalne="[^"]*"[^>]*>/gi, "").replace(/<img\b(?![^>]*\bsrc="data:)[^>]*>/gi, "") : tekstNaHtml(o.tekst);
  const tekst = o.tekst || htmlToText(o.html);
  if (tryb === "reply") {
    const kto = `W dniu ${o.data} ${o.od} napisał(a):`;
    return { html: `<p>${escH(kto)}</p><blockquote style="margin:0 0 0 8px;padding-left:10px;border-left:2px solid #99a">${czysty}</blockquote>`, tekst: kto + "\n" + tekst.split(/\r?\n/).map((l) => "> " + l).join("\n") };
  }
  const head = [["Od", o.od], ["Data", o.data], ["Temat", o.temat], ["Do", o.do]].filter((x) => x[1]);
  return {
    html: `<p>---------- Przekazana wiadomość ----------<br>${head.map(([k, v]) => `<b>${k}:</b> ${escH(v)}`).join("<br>")}</p>${czysty}`,
    tekst: "---------- Przekazana wiadomość ----------\n" + head.map(([k, v]) => `${k}: ${v}`).join("\n") + "\n\n" + tekst,
  };
}
export function tematOdp(tryb: "reply" | "forward", temat: string): string {
  const t = bezCtl(temat, 230);
  return tryb === "reply" ? (/^(re|odp|aw|sv)\s*:/i.test(t) ? t : "Re: " + t) : (/^(fwd?|pd)\s*:/i.test(t) ? t : "Fwd: " + t);
}

// ---------------------------------------------------------------- the message itself
export type Zal = { nazwa: string; typ: string; bytes: Uint8Array; cid?: string };
export type Wiadomosc = {
  od: { nazwa: string; adres: string }; do: string[]; dw: string[]; udw: string[]; temat: string; tekst: string; html: string;
  zalaczniki: Zal[]; messageId: string; data: Date; inReplyTo?: string; refs?: string[]; potwierdzenie?: boolean; pilna?: boolean; szkicId?: string;
  szkicOdp?: string;   // a draft of a reply / forward remembers its original (see odpNaglowek)
};
// "reply 123 <folder name, base64url>": what a draft answers, so that it can be resumed on another device
const ODP = /^(reply|forward) (\d{1,10}) ([A-Za-z0-9_-]{1,400})$/;
export function odpNaglowek(o: { tryb?: unknown; uid?: unknown; folder?: unknown } | null | undefined): string | undefined {
  const uid = Math.floor(Number(o?.uid));
  if (!o || typeof o.folder !== "string" || !o.folder || o.folder.length > 290 || /[\r\n\0]/.test(o.folder) || !(uid > 0 && uid < 4294967296)) return undefined;
  const v = `${o.tryb === "forward" ? "forward" : "reply"} ${uid} ${b64(te.encode(o.folder)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  return ODP.test(v) ? v : undefined;
}
export function odpZNaglowka(v: unknown): { tryb: "reply" | "forward"; uid: number; folder: string } | null {
  const m = ODP.exec(String(v ?? "").trim());
  if (!m) return null;
  try {
    const bin = atob(m[3].replace(/-/g, "+").replace(/_/g, "/") + "===".slice((m[3].length + 3) % 4));
    const folder = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return /[\r\n\0]/.test(folder) ? null : { tryb: m[1] as "reply" | "forward", uid: Number(m[2]), folder };
  } catch { return null; }
}
const ID = /^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,200}@[A-Za-z0-9.-]{1,200}>$/;
export const idOk = (v: unknown): v is string => typeof v === "string" && ID.test(v);
export const nowyId = (domena: string) => `<${crypto.randomUUID()}@${domena}>`;
function dataRfc(d: Date): string {
  const D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], p = (n: number) => String(n).padStart(2, "0");
  return `${D[d.getUTCDay()]}, ${p(d.getUTCDate())} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}
// `zUdw`: the copy kept in "Sent" carries the Bcc line; the one handed to the server for delivery never does.
export function budujMime(w: Wiadomosc, zUdw = false): Uint8Array {
  for (const a of [w.od.adres, ...w.do, ...w.dw, ...w.udw]) if (!adres(a)) throw new Error("mime: nieprawidłowy adres");
  if (!idOk(w.messageId) || (w.inReplyTo && !idOk(w.inReplyTo)) || (w.refs ?? []).some((r) => !idOk(r))) throw new Error("mime: nieprawidłowy identyfikator wiadomości");
  let n = 0;
  const granica = () => `=_portal_${crypto.randomUUID().replace(/-/g, "")}_${++n}`;
  const h: string[] = [];
  h.push("From: " + nazwaAdres(w.od.nazwa, w.od.adres));
  if (w.do.length) h.push(zloz("To", w.do));
  if (w.dw.length) h.push(zloz("Cc", w.dw));
  if (zUdw && w.udw.length) h.push(zloz("Bcc", w.udw));
  h.push("Reply-To: " + w.od.adres, "Subject: " + slowo(w.temat), "Date: " + dataRfc(w.data), "Message-ID: " + w.messageId);
  if (w.inReplyTo) h.push("In-Reply-To: " + w.inReplyTo);
  if (w.refs?.length) h.push("References: " + w.refs.slice(-20).join("\r\n "));
  if (w.potwierdzenie) h.push("Disposition-Notification-To: " + w.od.adres);
  if (w.pilna) h.push("X-Priority: 1 (Highest)", "Importance: High");
  if (w.szkicId) { if (!/^[0-9a-f-]{36}$/.test(w.szkicId)) throw new Error("mime: nieprawidłowy szkic"); h.push("X-Portal-Szkic: " + w.szkicId); }
  if (w.szkicOdp) { if (!w.szkicId || !ODP.test(w.szkicOdp)) throw new Error("mime: nieprawidłowy szkic"); h.push("X-Portal-Odp: " + w.szkicOdp); }
  h.push("MIME-Version: 1.0");

  const czesc = (typ: string, bytes: Uint8Array, extra: string[] = []) => [`Content-Type: ${typ}`, "Content-Transfer-Encoding: base64", ...extra, "", b64linie(bytes)].join("\r\n");
  const multi = (rodzaj: string, parts: string[]) => { const g = granica(); return { naglowek: `multipart/${rodzaj};\r\n boundary="${g}"`, body: parts.map((p) => `--${g}\r\n${p}\r\n`).join("") + `--${g}--` }; };
  const jako = (m: { naglowek: string; body: string }) => `Content-Type: ${m.naglowek}\r\n\r\n${m.body}`;
  const inl = w.zalaczniki.filter((z) => z.cid), zal = w.zalaczniki.filter((z) => !z.cid);
  for (const z of inl) if (!/^[A-Za-z0-9._@-]{1,80}$/.test(z.cid!) || !/^image\/(png|jpeg|gif|webp)$/.test(z.typ)) throw new Error("mime: nieprawidłowy obraz w treści");
  for (const z of w.zalaczniki) if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(z.typ)) throw new Error("mime: nieprawidłowy typ załącznika");
  let htmlPart = czesc('text/html; charset="UTF-8"', te.encode(`<!doctype html><html><head><meta charset="utf-8"></head><body>${w.html}</body></html>`));
  if (inl.length) htmlPart = jako(multi("related", [htmlPart, ...inl.map((z) => czesc(`${z.typ};\r\n ${plik("name", z.nazwa)}`, z.bytes, [`Content-ID: <${z.cid}>`, `Content-Disposition: inline;\r\n ${plik("filename", z.nazwa)}`]))]));
  let root = multi("alternative", [czesc('text/plain; charset="UTF-8"', te.encode(w.tekst)), htmlPart]);
  if (zal.length) root = multi("mixed", [jako(root), ...zal.map((z) => czesc(`${z.typ};\r\n ${plik("name", z.nazwa)}`, z.bytes, [`Content-Disposition: attachment;\r\n ${plik("filename", z.nazwa)}`]))]);
  return te.encode(h.join("\r\n") + `\r\nContent-Type: ${root.naglowek}\r\n\r\n${root.body}\r\n`);
}
