// Poczta — what makes the mailbox browser a mail client proper:
//
//   reading   { action: "szukaj_wszedzie", skrzynka, szukaj?, w_tresci?, od?, do?, nieprzeczytane?, oflagowane? }   every folder, one after another, within a time budget
//             { action: "odswiez_imap", skrzynka, folder, uidvalidity, po_uid, uids[] }   what changed since the page's cached list
//             { action: "otwarto_imap", skrzynka, folder, uid }     the real opening of a message that was fetched ahead
//             { action: "eml_imap" | "zrodlo_imap", skrzynka, folder, uid }   the message as a file / its source as text (capped)
//             { action: "nieprzeczytane" }                          unread counters of the caller's mailboxes (for the badge)
//   folders   { action: "folder_utworz", skrzynka, nazwa, rodzic? } { action: "folder_zmien", skrzynka, folder, nazwa }
//             { action: "folder_usun", skrzynka, folder, potwierdzenie? }   USER folders only; messages go to Trash first
//             { action: "oproznij", skrzynka, typ: "trash" | "junk", potwierdzenie? }   administrators; the portal's chosen folder only
//   people    { action: "podpisy" | "podpis_zapisz" | "podpis_usun" }       several signatures per person, a default per mailbox
//             { action: "szablony" | "szablon_zapisz" | "szablon_usun" }    templates shared by the people of a mailbox
//             { action: "kontakty" | "kontakt_zapisz" | "kontakt_usun" | "kto_to" }   the mailbox's address book
//   later     { action: "zaplanuj", skrzynka, szkic_id, kiedy, klucz, … } { action: "zaplanowane" } { action: "zaplanowane_anuluj", id }
//             cron: { action: "wyslij_zaplanowane" } — the message itself stays a draft in the mailbox; the queue row
//             only says when, who and which draft. When its time comes it goes through the ordinary "wyslij".
//
// Every answer of a confirmation kind ({ potwierdz: n }) changes nothing: the page asks the person and calls again.

import PostalMime from "npm:postal-mime@2.4.4";
import { type Ctx, type Deps, type ImapLike, type ImapZapisLike, type Me } from "./core.ts";
import { type Folder, folderUzytkownika, type Meta, naMutf7, nieWybieralny, typFolderu, withTimeout } from "./imap.ts";
import { folderPortalu, NAZWY } from "./foldery.ts";
import { dataOk, isSkrzynka, parseMail, sha256hex, SKRZYNKI, type Skrzynka } from "./logic.ts";
import { adres, adresy, adresyZNaglowka, b64, bezCtl, nazwaPlikuWych, oczyscWychodzacy } from "./mime.ts";
import { folderZListy, MAX_ZALACZNIK, NA_MINUTE, wierszListy } from "./skrzynka.ts";
import { nieznaneAdresy, pisanie, wzorPodpisu } from "./wysylka.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
type Out = { status: number; body: Any; raw?: { bytes: Uint8Array; headers: Record<string, string> } };
export const AKCJE_N = ["szukaj_wszedzie", "odswiez_imap", "otwarto_imap", "eml_imap", "zrodlo_imap", "nieprzeczytane", "folder_utworz", "folder_zmien", "folder_usun", "oproznij",
  "podpisy", "podpis_zapisz", "podpis_usun", "szablony", "szablon_zapisz", "szablon_usun", "kontakty", "kontakt_zapisz", "kontakt_usun", "kto_to", "zaplanuj", "zaplanowane", "zaplanowane_anuluj"];
const Z_IMAP = ["szukaj_wszedzie", "odswiez_imap", "otwarto_imap", "eml_imap", "zrodlo_imap", "folder_utworz", "folder_zmien", "folder_usun", "oproznij", "zaplanuj"];
export const BUDZET_SZUKANIA = 30000, NA_FOLDER = 20, MAX_WYNIKOW = 200, MAX_ZRODLO = 300 * 1024, MAX_PODPISOW = 10, MAX_SZABLONOW = 100, MAX_KONTAKTOW = 2000, MAX_CZEKA = 50, PARTIA = 200;
const BUDZET_MS = 100000, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const moze = (me: Me, s: Skrzynka) => me.admin || me.sekcje === null || me.sekcje.includes(SKRZYNKI[s].sekcja);
const naglowek = (m: Meta) => { const k = Object.keys(m.sekcje).find((x) => x.startsWith("BODY[HEADER")); return k ? m.sekcje[k] : new Uint8Array(0); };
const blad = (e: unknown) => String((e as Error)?.message ?? e).replace(/[^\x20-\x7e -ɏ]/g, " ").slice(0, 200);
const PORZADEK = ["inbox", "sent", "drafts", "archive", "", "junk", "trash"];
const etykieta = (f: Folder) => NAZWY[typFolderu(f)] ? `${NAZWY[typFolderu(f)]}${typFolderu(f) === "inbox" ? "" : " (" + f.nazwa.split(f.delim).pop() + ")"}` : f.nazwa.split(f.delim).filter((x, i) => !(i === 0 && x.toUpperCase() === "INBOX")).join(" / ");
const plik = (name: string, bytes: Uint8Array): Out => ({ status: 200, body: null, raw: { bytes, headers: {
  "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Content-Security-Policy": "sandbox; default-src 'none'",
  "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
} } });

// "2026-10-12T08:30" on a clock in Warsaw -> the instant (null: not a date, or an hour that does not exist that day)
export function chwilaWarszawa(lok: unknown): number | null {
  if (typeof lok !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(lok)) return null;
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  for (const off of ["+02:00", "+01:00"]) {
    const t = Date.parse(lok + ":00" + off);
    if (Number.isFinite(t) && f.format(new Date(t)).replace(" ", "T") === lok) return t;
  }
  return null;
}
// a name a person typed for a folder: one level, bounded, nothing the server treats specially
export function nazwaFolderu(v: unknown, delim: string): string | null {
  const n = bezCtl(v, 80);
  return n && n.length <= 60 && !n.includes(delim) && !/[\\/%*"]/.test(n) && n.toUpperCase() !== "INBOX" ? n : null;
}

const liczniki = new Map<string, { do: number; v: Any }>(); // per running instance, one minute: many open portals, one login to the mail server
export const zapomnijLiczniki = () => liczniki.clear();

// ---------------------------------------------------------------- "Wyślij później": the queue, run by cron
export async function wyslijZaplanowane(d: Deps, ctx: Ctx): Promise<Any> {
  const t0 = d.now(), out = { wyslane: 0, bledy: 0, odlozone: 0, pominiete: 0 };
  const rows = await d.store.rekordy("poczta_kolejka", { stan: "czeka" }, { doKiedy: new Date(t0).toISOString(), limit: 10 });
  for (const r of rows) {
    if (d.now() - t0 > 80000) break;
    const s = r.skrzynka as Skrzynka, teraz = () => new Date(d.now()).toISOString();
    // taken by exactly one run: the row leaves "czeka" before anything is sent
    if (!isSkrzynka(s) || (await d.store.rekordZmien("poczta_kolejka", { id: r.id, stan: "czeka" }, { stan: "wysylanie", proba_at: teraz() })) !== 1) { out.pominiete++; continue; }
    const koniec = async (stan: string, b: string | null) => { await d.store.rekordZmien("poczta_kolejka", { id: r.id }, { stan, blad: b, koniec_at: stan === "czeka" ? null : teraz() }).catch(() => {}); };
    let im: ImapLike | null = null;
    try {
      if (!ctx.users.has(String(r.kto))) throw new Error("osoba, która zaplanowała wysyłkę, nie ma już konta w portalu");
      if (!d.konta[s]) throw new Error("skrzynka nie jest skonfigurowana");
      im = await d.imap(s, Math.ceil(MAX_ZALACZNIK * 1.45));
      const drafts = await folderPortalu(im, await im.list(), s, "drafts", ctx.ust.foldery[s].drafts, d.now());
      if (!drafts) throw new Error("brak folderu wersji roboczych");
      await im.examine(drafts.raw);
      const uid = (await im.szkice(String(r.szkic_id))).pop();
      const full = uid ? await im.fetch(uid, "") : null;
      await im.logout().catch(() => {}); im = null;
      if (!uid || !full) throw new Error("szkic tej wiadomości został usunięty z folderu Robocze");
      const m: Any = await PostalMime.parse(full.body);
      const lista = (l: Any) => (Array.isArray(l) ? l : []).map((a: Any) => String(a?.address ?? "")).filter(Boolean);
      const o = r.opcje ?? {};
      const zal = (m.attachments ?? []).map((a: Any) => {
        const cid = String(a.contentId ?? "").replace(/^<|>$/g, "");
        return { nazwa: a.filename || "zalacznik", b64: b64(typeof a.content === "string" ? new TextEncoder().encode(a.content) : new Uint8Array(a.content)), cid: (a.disposition === "inline" || a.related) && /^[A-Za-z0-9._-]{1,60}$/.test(cid) ? cid : undefined };
      });
      // the ordinary send, as the person who scheduled it: the same caps, log, Sent copy; the draft goes when it is out
      const w = await pisanie(d, { email: String(r.kto), admin: false, sekcje: [SKRZYNKI[s].sekcja] }, ctx, {
        action: "wyslij", skrzynka: s, klucz: r.klucz, do: lista(m.to), dw: lista(m.cc), udw: lista(m.bcc), temat: m.subject ?? "", html: m.html ?? "", zalaczniki: zal,
        odp: o.odp ?? undefined, cytat: o.cytat !== false, potwierdzone: true, potwierdzenie: o.potwierdzenie === true, pilna: o.pilna === true, szkic_id: r.szkic_id, szkic_uid: uid,
      });
      if (w.body?.ok) { out.wyslane++; await koniec("wyslano", (w.body.ostrzezenia ?? []).join(" ").slice(0, 300) || null); }
      else if (w.status === 429 && d.now() - Date.parse(r.kiedy) < 12 * 3600000) { out.odlozone++; await koniec("czeka", String(w.body?.error ?? "limit").slice(0, 300)); } // a cap: tried again at the next run
      else { out.bledy++; await koniec("blad", String(w.body?.error ?? "nie wysłano").slice(0, 300)); }
    } catch (e) { out.bledy++; console.error("poczta kolejka", blad(e)); await koniec("blad", blad(e)); }
    finally { if (im) await (im as ImapLike).logout().catch(() => {}); }
  }
  return out;
}

export async function narzedzia(d: Deps, me: Me, ctx: Ctx, body: Any): Promise<Out> {
  const teraz = () => new Date(d.now()).toISOString();
  const limit = async () => (await d.store.dziennikLicz(me.email, new Date(d.now() - 60000).toISOString())) >= NA_MINUTE;

  // ------------------------------------------------------------ unread counters for the badge
  if (body.action === "nieprzeczytane") {
    const moje = (Object.keys(SKRZYNKI) as Skrzynka[]).filter((s) => moze(me, s) && d.konta[s]);
    const out: Any = {};
    let razem = 0;
    for (const s of moje) {
      let c = liczniki.get(s);
      if (!c || c.do <= d.now()) {
        if (await limit()) return { status: 429, body: { error: "Za dużo zapytań do skrzynki — odczekaj minutę." } };
        await d.store.dziennik({ kto: me.email, akcja: "foldery", skrzynka: s, folder: null });
        let im: ImapLike | null = null;
        try { im = await d.imap(s); const st = await withTimeout(im.status("INBOX"), 20000, "przekroczono czas"); c = { do: d.now() + 60000, v: { nieprzeczytane: st.unseen, wiadomosci: st.messages, uidnext: st.uidnext } }; liczniki.set(s, c); }
        catch (e) { console.error("poczta liczniki", blad(e)); c = undefined; }
        finally { if (im) await im.logout().catch(() => {}); }
      }
      if (c) { out[s] = { adres: SKRZYNKI[s].adres, ...c.v }; razem += Number(c.v.nieprzeczytane) || 0; }
    }
    return { status: 200, body: { skrzynki: out, razem } };
  }

  const s = body.skrzynka;
  if (!isSkrzynka(s) || !moze(me, s)) return { status: 403, body: { error: "Brak dostępu do tej skrzynki." } };
  const R = d.store;

  // ------------------------------------------------------------ signatures (the caller's own)
  if (body.action === "podpisy" || body.action === "podpis_zapisz" || body.action === "podpis_usun") {
    const moje = await R.rekordy("poczta_sygnatury", { kto: me.email }, { limit: 30 });
    if (body.action === "podpisy") {
      const prof = await R.profilPracownika(me.email).catch(() => ({ imie: "", stanowisko: "", telefon: "" }));
      return { status: 200, body: { lista: moje.map((x) => ({ id: x.id, nazwa: x.nazwa, html: x.html, domyslna: (x.domyslna ?? []).includes(s) })).sort((a, b) => String(a.nazwa).localeCompare(String(b.nazwa), "pl")),
        profil: prof, wzor: wzorPodpisu(prof, s), dawny: await R.podpis(me.email, s).catch(() => null), stopka: ctx.ust.stopka[s] } };
    }
    if (!UUID.test(String(body.id ?? "")) && !(body.action === "podpis_zapisz" && body.id == null)) return { status: 400, body: { error: "Nieprawidłowy podpis." } };
    const stary = body.id ? moje.find((x) => x.id === body.id) : null;
    if (body.id && !stary) return { status: 404, body: { error: "Nie ma takiego podpisu." } };
    if (body.action === "podpis_usun") { await R.rekordUsun("poczta_sygnatury", { id: body.id, kto: me.email }); return { status: 200, body: { ok: true } }; }
    const nazwa = bezCtl(body.nazwa, 60), html = oczyscWychodzacy(String(body.html ?? "")).slice(0, 4000);
    if (!nazwa) return { status: 200, body: { error: "Nazwij podpis (np. „Pełny”, „Krótki”)." } };
    if (!html.replace(/<[^>]*>/g, "").trim()) return { status: 200, body: { error: "Podpis jest pusty." } };
    if (!stary && moje.length >= MAX_PODPISOW) return { status: 200, body: { error: `Najwyżej ${MAX_PODPISOW} podpisów — usuń któryś.` } };
    const inne = (stary?.domyslna ?? []).filter((x: string) => x !== s && isSkrzynka(x));
    // one default per mailbox: the mark moves from the previous one
    if (body.domyslna === true) for (const x of moje) if (x.id !== stary?.id && (x.domyslna ?? []).includes(s)) await R.rekordZmien("poczta_sygnatury", { id: x.id, kto: me.email }, { domyslna: x.domyslna.filter((y: string) => y !== s) });
    const row = await R.rekordZapisz("poczta_sygnatury", { id: stary?.id ?? crypto.randomUUID(), kto: me.email, nazwa, html, domyslna: body.domyslna === true ? [...inne, s] : inne, updated_at: teraz() });
    return row ? { status: 200, body: { ok: true, id: row.id } } : { status: 200, body: { error: "Nie udało się zapisać podpisu." } };
  }

  // ------------------------------------------------------------ templates of the mailbox (everybody of the section manages them)
  if (body.action === "szablony" || body.action === "szablon_zapisz" || body.action === "szablon_usun") {
    const wszystkie = await R.rekordy("poczta_szablony", { skrzynka: s }, { limit: MAX_SZABLONOW + 20 });
    if (body.action === "szablony") return { status: 200, body: { szablony: wszystkie.map((x) => ({ id: x.id, nazwa: x.nazwa, temat: x.temat ?? "", html: x.html, kto: x.updated_by, kiedy: x.updated_at })).sort((a, b) => String(a.nazwa).localeCompare(String(b.nazwa), "pl")) } };
    const stary = body.id ? wszystkie.find((x) => x.id === body.id) : null;
    if (body.id != null && !stary) return { status: 404, body: { error: "Nie ma takiego szablonu." } };
    if (body.action === "szablon_usun") { if (!stary) return { status: 400, body: { error: "Nieprawidłowy szablon." } }; await R.rekordUsun("poczta_szablony", { id: stary.id, skrzynka: s }); return { status: 200, body: { ok: true } }; }
    const nazwa = bezCtl(body.nazwa, 80), html = oczyscWychodzacy(String(body.html ?? "")).slice(0, 20000);
    if (!nazwa) return { status: 200, body: { error: "Nazwij szablon." } };
    if (!html.replace(/<[^>]*>/g, "").trim()) return { status: 200, body: { error: "Szablon jest pusty." } };
    if (!stary && wszystkie.length >= MAX_SZABLONOW) return { status: 200, body: { error: `Najwyżej ${MAX_SZABLONOW} szablonów w skrzynce.` } };
    const row = await R.rekordZapisz("poczta_szablony", { id: stary?.id ?? crypto.randomUUID(), skrzynka: s, nazwa, temat: bezCtl(body.temat, 250), html, utworzyl: stary?.utworzyl ?? me.email, updated_by: me.email, updated_at: teraz() });
    return row ? { status: 200, body: { ok: true, id: row.id } } : { status: 200, body: { error: "Nie udało się zapisać szablonu." } };
  }

  // ------------------------------------------------------------ the address book of the mailbox
  if (body.action === "kontakty" || body.action === "kontakt_zapisz" || body.action === "kontakt_usun" || body.action === "kto_to") {
    const zapisane = await R.rekordy("poczta_kontakty", { skrzynka: s }, { limit: MAX_KONTAKTOW });
    if (body.action === "kto_to") {
      // whose address is it: for the {klient} and {imie} places of a template
      const a = adres(body.adres);
      if (!a) return { status: 200, body: { klient: "", imie: "" } };
      const k = zapisane.find((x) => x.adres === a), kl = ctx.klienci.find((x) => adresy(x.email, 10).ok.includes(a));
      const imie = (v: unknown) => { const t = bezCtl(v, 80).split(" ")[0] ?? ""; return /^\p{Lu}\p{Ll}{1,30}$/u.test(t) ? t : ""; };
      return { status: 200, body: { klient: kl?.nazwa ?? k?.firma ?? "", imie: imie(k?.nazwa) || imie(kl?.kontakt) } };
    }
    if (body.action === "kontakty") {
      const q = bezCtl(body.q, 60).toLowerCase();
      const pasuje = (...v: unknown[]) => !q || v.join(" ").toLowerCase().includes(q);
      const lista = zapisane.filter((x) => pasuje(x.adres, x.nazwa, x.firma, x.notatka)).sort((a, b) => String(a.nazwa || a.adres).localeCompare(String(b.nazwa || b.adres), "pl")).slice(0, 300)
        .map((x) => ({ id: x.id, adres: x.adres, nazwa: x.nazwa ?? "", firma: x.firma ?? "", notatka: x.notatka ?? "", kto: x.updated_by }));
      // suggestions: addresses of the clients base and of the correspondence that are not saved yet
      const propozycje: Any[] = [];
      if (body.zrodla === true) {
        const mam = new Set(zapisane.map((x) => String(x.adres)));
        for (const k of ctx.klienci) for (const a of adresy(k.email, 10).ok) if (!mam.has(a) && pasuje(a, k.nazwa) && propozycje.length < 60 && !propozycje.some((p) => p.adres === a)) propozycje.push({ adres: a, nazwa: bezCtl(k.kontakt, 80), firma: k.nazwa, zrodlo: "baza klientów" });
        if (q.length >= 2) for (const a of await R.adresySzukaj(s, q).catch(() => [])) if (!mam.has(a) && !propozycje.some((p) => p.adres === a)) propozycje.push({ adres: a, nazwa: "", firma: "", zrodlo: "korespondencja" });
      }
      return { status: 200, body: { kontakty: lista, razem: zapisane.length, propozycje: propozycje.slice(0, 60) } };
    }
    const stary = body.id ? zapisane.find((x) => x.id === body.id) : null;
    if (body.id != null && !stary) return { status: 404, body: { error: "Nie ma takiego kontaktu." } };
    if (body.action === "kontakt_usun") { if (!stary) return { status: 400, body: { error: "Nieprawidłowy kontakt." } }; await R.rekordUsun("poczta_kontakty", { id: stary.id, skrzynka: s }); return { status: 200, body: { ok: true } }; }
    const a = adres(body.adres);
    if (!a) return { status: 200, body: { error: "Nieprawidłowy adres e-mail." } };
    if (zapisane.some((x) => x.adres === a && x.id !== stary?.id)) return { status: 200, body: { error: "Ten adres jest już w kontaktach." } };
    if (!stary && zapisane.length >= MAX_KONTAKTOW) return { status: 200, body: { error: "Książka adresowa jest pełna." } };
    const row = await R.rekordZapisz("poczta_kontakty", { id: stary?.id ?? crypto.randomUUID(), skrzynka: s, adres: a, nazwa: bezCtl(body.nazwa, 120), firma: bezCtl(body.firma, 160), notatka: bezCtl(body.notatka, 300), utworzyl: stary?.utworzyl ?? me.email, updated_by: me.email, updated_at: teraz() });
    return row ? { status: 200, body: { ok: true, id: row.id } } : { status: 200, body: { error: "Ten adres jest już w kontaktach." } };
  }

  // ------------------------------------------------------------ the queue of scheduled messages (reading, cancelling)
  if (body.action === "zaplanowane") {
    const rows = await R.rekordy("poczta_kolejka", { skrzynka: s }, { limit: 60 });
    return { status: 200, body: { zaplanowane: rows.map((r) => ({ id: r.id, kto: r.kto, kiedy: r.kiedy, stan: r.stan, temat: r.temat, odbiorcy: r.odbiorcy ?? [], blad: r.blad ?? null, szkic_id: r.szkic_id, moje: r.kto === me.email })) } };
  }
  if (body.action === "zaplanowane_anuluj") {
    if (!UUID.test(String(body.id ?? ""))) return { status: 400, body: { error: "Nieprawidłowy identyfikator." } };
    const r = (await R.rekordy("poczta_kolejka", { id: body.id, skrzynka: s }, { limit: 1 }))[0];
    if (!r) return { status: 404, body: { error: "Nie ma takiej zaplanowanej wiadomości." } };
    if (r.kto !== me.email && !me.admin) return { status: 403, body: { error: "Wysyłkę może anulować osoba, która ją zaplanowała, albo administrator." } };
    const n = await R.rekordZmien("poczta_kolejka", { id: r.id, stan: "czeka" }, { stan: "anulowano", blad: "anulowano: " + me.email, koniec_at: teraz() });
    return { status: 200, body: n === 1 ? { ok: true } : { error: "Tej wiadomości nie da się już anulować — została wysłana albo właśnie wychodzi." } };
  }

  if (!Z_IMAP.includes(body.action)) return { status: 400, body: { error: "Nieznana akcja." } };
  if (!d.konta[s]) return { status: 200, body: { error: "Skrzynka nie jest skonfigurowana." } };
  if (await limit()) return { status: 429, body: { error: "Za dużo zapytań do skrzynki — odczekaj minutę." } };
  const log = (akcja: string, x: Any = {}) => R.dziennik({ kto: me.email, akcja, skrzynka: s, folder: typeof body.folder === "string" ? body.folder.slice(0, 300) : null, ...x });
  const uid = Math.floor(Number(body.uid));
  const zUid = ["otwarto_imap", "eml_imap", "zrodlo_imap"].includes(body.action);
  if (zUid && !(uid > 0 && uid < 4294967296)) return { status: 400, body: { error: "Nieprawidłowy numer wiadomości." } };

  let im: ImapLike | null = null;
  const praca = async (): Promise<Out> => {
    // ---------------------------------------------------------- folders and emptying (the controlled write path)
    if (["folder_utworz", "folder_zmien", "folder_usun", "oproznij"].includes(body.action)) {
      if (body.action === "oproznij" && !me.admin) return { status: 403, body: { error: "Kosz i Spam opróżnia administrator." } };
      const w: ImapZapisLike = await d.imapw(s);
      im = w;
      const list = await w.list(), delim = list[0]?.delim ?? ".";
      const zmiana = (folder: string, szczegoly: string) => R.dziennik({ kto: me.email, akcja: "zmiana", skrzynka: s, folder: folder.slice(0, 300), szczegoly: szczegoly.slice(0, 300) });

      if (body.action === "oproznij") {
        const typ = body.typ === "junk" ? "junk" : body.typ === "trash" ? "trash" : null;
        if (!typ) return { status: 400, body: { error: "Nieznany folder." } };
        // only the folder the portal itself uses as Trash / Spam — never one named by the browser
        const f = await folderPortalu(w, list, s, typ, ctx.ust.foldery[s][typ], d.now());
        if (!f) return { status: 200, body: { error: "W tej skrzynce nie ma takiego folderu." } };
        await w.wybierz(f);
        const uids = await w.szukaj({});
        if (!uids.length) return { status: 200, body: { ok: true, usunieto: 0, zostalo: 0 } };
        if (Math.floor(Number(body.potwierdzenie)) !== uids.length) return { status: 200, body: { potwierdz: uids.length, folder: f.raw, pytanie: `${NAZWY[typ]}: ${uids.length} wiadomości zostanie usuniętych NA STAŁE — także z programów pocztowych. Tego nie da się cofnąć.` } };
        const t0 = d.now();
        let n = 0;
        for (let i = 0; i < uids.length && d.now() - t0 < 80000; i += PARTIA) {
          const partia = uids.slice(i, i + PARTIA);
          await zmiana(f.raw, `opróżnianie (${NAZWY[typ]}): usuwam na stałe ${partia.length}`); // the log first, as everywhere
          await w.oproznij(partia);
          n += partia.length;
        }
        return { status: 200, body: { ok: true, usunieto: n, zostalo: uids.length - n } };
      }
      if (body.action === "folder_utworz") {
        const n = nazwaFolderu(body.nazwa, delim);
        if (!n) return { status: 200, body: { error: "Nazwa folderu: do 60 znaków, bez znaków . / \\ % * \"." } };
        if (list.length >= 200) return { status: 200, body: { error: "W skrzynce jest już bardzo dużo folderów." } };
        const rodzic = typeof body.rodzic === "string" && body.rodzic ? list.find((f) => f.raw === body.rodzic && folderUzytkownika(f)) ?? null : null;
        if (body.rodzic && !rodzic) return { status: 200, body: { error: "Podfolder można założyć tylko we własnym (nie systemowym) folderze." } };
        if (rodzic && rodzic.raw.split(delim).length >= 5) return { status: 200, body: { error: "Zbyt głęboko zagnieżdżony folder." } };
        // where ordinary folders live on this server: next to INBOX, or under it ("INBOX.Klienci")
        const baza = rodzic ? rodzic.raw : list.some((f) => f.raw.toUpperCase().startsWith("INBOX" + delim)) ? "INBOX" : "";
        const raw = (baza ? baza + delim : "") + naMutf7(n);
        await w.utworz(raw, delim, list);
        await zmiana(raw, "folder: utworzono");
        return { status: 200, body: { ok: true, folder: raw } };
      }
      const f = typeof body.folder === "string" ? list.find((x) => x.raw === body.folder) ?? null : null;
      if (!f) return { status: 400, body: { error: "Nie ma takiego folderu w tej skrzynce." } };
      if (!folderUzytkownika(f)) return { status: 200, body: { error: "Folderów systemowych (Odebrane, Wysłane, Robocze, Kosz, Spam, Archiwum) nie można zmieniać ani usuwać." } };
      if (list.some((x) => x.raw.startsWith(f.raw + f.delim))) return { status: 200, body: { error: "Ten folder ma podfoldery — najpierw zajmij się nimi." } };
      if (body.action === "folder_zmien") {
        const n = nazwaFolderu(body.nazwa, f.delim);
        if (!n) return { status: 200, body: { error: "Nazwa folderu: do 60 znaków, bez znaków . / \\ % * \"." } };
        const raw = f.raw.slice(0, f.raw.lastIndexOf(f.delim) + 1) + naMutf7(n);
        await w.zmienNazwe(f, raw, list);
        await zmiana(f.raw, "folder: nowa nazwa -> " + raw);
        return { status: 200, body: { ok: true, folder: raw } };
      }
      // folder_usun: nothing is lost — the messages go to Trash, and only the empty folder is removed
      const ile = (await w.status(f.raw)).messages;
      if (ile > 0) {
        if (Math.floor(Number(body.potwierdzenie)) !== ile) return { status: 200, body: { potwierdz: ile, pytanie: `Folder „${f.nazwa.split(f.delim).pop()}” zawiera ${ile} wiadomości. Zostaną przeniesione do Kosza, a folder usunięty.` } };
        const kosz = await folderPortalu(w, list, s, "trash", ctx.ust.foldery[s].trash, d.now());
        if (!kosz) return { status: 200, body: { error: "W tej skrzynce nie ma Kosza — przenieś wiadomości ręcznie, potem usuń folder." } };
        await w.wybierz(f);
        const uids = await w.szukaj({});
        for (let i = 0; i < uids.length; i += PARTIA) { await w.przenies(uids.slice(i, i + PARTIA), kosz); await zmiana(f.raw, `folder usuwany: ${Math.min(PARTIA, uids.length - i)} wiadomości -> ${kosz.raw}`); }
      }
      await w.usunFolder(f, list); // refuses when the server still counts a message in it
      await zmiana(f.raw, "folder: usunięto");
      return { status: 200, body: { ok: true, przeniesiono: ile } };
    }

    // ---------------------------------------------------------- scheduling: the draft in the mailbox is what will go
    if (body.action === "zaplanuj") {
      if (!UUID.test(String(body.szkic_id ?? "")) || !UUID.test(String(body.klucz ?? ""))) return { status: 400, body: { error: "Nieprawidłowy szkic." } };
      const kiedy = chwilaWarszawa(body.kiedy);
      if (kiedy == null) return { status: 200, body: { error: "Podaj datę i godzinę wysyłki." } };
      if (kiedy < d.now() + 60000) return { status: 200, body: { error: "Termin wysyłki musi być w przyszłości." } };
      if (kiedy > d.now() + 90 * 86400000) return { status: 200, body: { error: "Wysyłkę można zaplanować najwyżej 90 dni naprzód." } };
      im = await d.imap(s);
      const list = await im.list();
      const drafts = await folderPortalu(im, list, s, "drafts", ctx.ust.foldery[s].drafts, d.now());
      if (!drafts) return { status: 200, body: { error: "W tej skrzynce nie ma folderu wersji roboczych." } };
      await im.examine(drafts.raw);
      const su = (await im.szkice(body.szkic_id)).pop();
      const m = su ? (await im.meta([su], true, true, false))[0] : null;
      if (!m) return { status: 200, body: { error: "Najpierw zapisz wiadomość jako szkic." } };
      // recipients and subject are read from the draft itself, never from the browser
      const h = (await parseMail(naglowek(m))).naglowki, temat = bezCtl((await parseMail(naglowek(m))).temat, 250);
      const wszyscy = [...new Set([...adresyZNaglowka(h["to"]), ...adresyZNaglowka(h["cc"]), ...adresyZNaglowka(h["bcc"])])];
      if (!wszyscy.length) return { status: 200, body: { error: "Podaj co najmniej jednego odbiorcę." } };
      if (wszyscy.length > ctx.ust.limity.odbiorcy) return { status: 200, body: { error: `Najwyżej ${ctx.ust.limity.odbiorcy} odbiorców w jednej wiadomości.` } };
      if (!temat) return { status: 200, body: { error: "Podaj temat wiadomości." } };
      const nowe = await nieznaneAdresy(d, ctx, s, wszyscy);
      if (nowe.length && body.potwierdzone !== true) return { status: 200, body: { potwierdz: nowe, pytanie: "Pierwsza wiadomość na ten adres — nie ma go w bazie klientów, kontaktach ani w dotychczasowej korespondencji tej skrzynki. Sprawdź adres przed zaplanowaniem." } };
      if ((await R.rekordy("poczta_kolejka", { skrzynka: s, stan: "czeka" }, { limit: MAX_CZEKA + 1 })).length >= MAX_CZEKA) return { status: 200, body: { error: "W tej skrzynce czeka już bardzo dużo zaplanowanych wiadomości." } };
      const odp = body.odp && typeof body.odp === "object" && typeof body.odp.folder === "string" && list.some((f) => f.raw === body.odp.folder && !nieWybieralny(f)) && Math.floor(Number(body.odp.uid)) > 0
        ? { folder: body.odp.folder, uid: Math.floor(Number(body.odp.uid)), tryb: body.odp.tryb === "forward" ? "forward" : "reply", czesci: (Array.isArray(body.odp.czesci) ? body.odp.czesci : []).slice(0, 30).map(String).filter((x: string) => /^\d{1,3}(\.\d{1,3}){0,12}$/.test(x)) } : null;
      // one waiting send per draft: scheduling again replaces the previous time
      await R.rekordZmien("poczta_kolejka", { skrzynka: s, szkic_id: body.szkic_id, stan: "czeka" }, { stan: "anulowano", blad: "zaplanowano ponownie", koniec_at: teraz() });
      const row = await R.rekordZapisz("poczta_kolejka", { id: crypto.randomUUID(), kto: me.email, skrzynka: s, kiedy: new Date(kiedy).toISOString(), stan: "czeka", klucz: body.klucz, szkic_id: body.szkic_id, temat, odbiorcy: wszyscy,
        opcje: { odp, cytat: body.cytat !== false, potwierdzenie: body.potwierdzenie === true, pilna: body.pilna === true }, created_at: teraz() });
      if (!row) return { status: 200, body: { error: "Ta wiadomość została już zaplanowana albo wysłana." } };
      return { status: 200, body: { ok: true, id: row.id, kiedy: row.kiedy } };
    }

    // ---------------------------------------------------------- reading
    im = await d.imap(s, body.action === "eml_imap" ? Math.ceil(MAX_ZALACZNIK * 1.05) : undefined);

    if (body.action === "szukaj_wszedzie") {
      const tekst = typeof body.szukaj === "string" ? body.szukaj.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100) : "";
      for (const k of ["od", "do"]) if (body[k] && !dataOk(body[k])) return { status: 400, body: { error: "Nieprawidłowa data." } };
      if (tekst.length < 2 && !body.od && !body.do && body.nieprzeczytane !== true && body.oflagowane !== true) return { status: 200, body: { error: "Wpisz co najmniej 2 znaki albo wybierz filtr." } };
      await log("lista");
      const rank = (f: Folder) => { const i = PORZADEK.indexOf(typFolderu(f)); return i < 0 ? 4 : i; };
      const foldery = (await im.list()).filter((f) => !nieWybieralny(f)).sort((a, b) => rank(a) - rank(b) || a.nazwa.localeCompare(b.nazwa, "pl")).slice(0, 120);
      const t0 = d.now(), out: Any[] = [], pominiete: string[] = [];
      let przeszukane = 0;
      for (const f of foldery) {
        // one folder after another; what does not fit into the time budget is named, not silently dropped
        if (d.now() - t0 > BUDZET_SZUKANIA || out.length >= MAX_WYNIKOW) { pominiete.push(etykieta(f)); continue; }
        try {
          await im.examine(f.raw);
          const uids = (await im.szukaj({ tekst, wTresci: body.w_tresci === true, nieprzeczytane: body.nieprzeczytane === true, oflagowane: body.oflagowane === true, od: body.od || undefined, do: body.do || undefined })).slice(-NA_FOLDER);
          przeszukane++;
          if (!uids.length) continue;
          for (const m of await im.meta(uids, true, true)) out.push({ ...(await wierszListy(m)), folder: f.raw, folder_nazwa: etykieta(f), typ_folderu: typFolderu(f) });
        } catch (e) { console.error("poczta szukaj", blad(e)); pominiete.push(etykieta(f)); }
      }
      out.sort((a, b) => String(b.data).localeCompare(String(a.data)));
      return { status: 200, body: { wiadomosci: out.slice(0, MAX_WYNIKOW).map(({ mid: _m, ...r }) => r), przeszukane, foldery: foldery.length, pominiete, na_folder: NA_FOLDER } };
    }

    const folder = await folderZListy(im, body.folder);
    if (!folder) return { status: 400, body: { error: "Nie ma takiego folderu w tej skrzynce." } };
    const ex = await im.examine(folder.raw);

    // what changed since the list the page keeps: new messages, flags of the known ones, the ones that are gone
    if (body.action === "odswiez_imap") {
      await log("lista");
      const po = Math.floor(Number(body.po_uid));
      if (Number(body.uidvalidity) !== ex.uidvalidity || !(po >= 0)) return { status: 200, body: { pelne: true } };
      const nowe = (await im.uidsAfter(po)).filter((u) => u > po);
      if (nowe.length > 60) return { status: 200, body: { pelne: true } };
      const rows = [];
      for (const m of (await im.meta(nowe, true, true)).sort((a, b) => b.uid - a.uid)) rows.push(await wierszListy(m));
      const kto = await R.przypisania(s, rows.map((r) => r.mid).filter(Boolean)).catch(() => ({} as Record<string, string>));
      const znane = [...new Set((Array.isArray(body.uids) ? body.uids : []).map((x: unknown) => Math.floor(Number(x))).filter((x: number) => x > 0 && x < 4294967296))].slice(0, 150) as number[];
      const fl = (m: Meta, f: string) => m.flagi.some((x) => x.toLowerCase() === f);
      const flagi = znane.length ? (await im.meta(znane, true, false, false)).map((m) => ({ uid: m.uid, przeczytana: fl(m, "\\seen"), odpowiedziano: fl(m, "\\answered"), oflagowana: fl(m, "\\flagged") })) : [];
      return { status: 200, body: { uidvalidity: ex.uidvalidity, uidnext: ex.uidnext, razem: ex.exists, nowe: rows.map(({ mid, ...r }) => ({ ...r, przypisany: kto[mid] ?? null })), flagi } };
    }

    const m = (await im.meta([uid], true, true, false))[0];
    if (!m) return { status: 404, body: { error: "Nie ma takiej wiadomości (mogła zostać przeniesiona albo usunięta)." } };
    const mail = await parseMail(naglowek(m));
    const hash = (await sha256hex(mail.messageId)).slice(0, 32);

    if (body.action === "otwarto_imap") {
      await log("otwarcie", { uid, msg_hash: hash });
      return { status: 200, body: { ok: true, kto: await R.ktoCo(s, hash).catch(() => []) } };
    }
    if (body.action === "zrodlo_imap") {
      const full = await im.fetch(uid, "", MAX_ZRODLO);
      if (!full) return { status: 404, body: { error: "Nie udało się odczytać wiadomości." } };
      await log("otwarcie", { uid, msg_hash: hash });
      // text only: the page shows it in a <pre> through textContent, never as markup
      return { status: 200, body: { zrodlo: new TextDecoder("utf-8", { fatal: false }).decode(full.body).replace(/\u0000/g, ""), obciete: m.size > full.body.length, rozmiar: m.size } };
    }
    // eml_imap: the whole message as a file (always a download)
    if (m.size > MAX_ZALACZNIK) return { status: 413, body: { error: "Wiadomość jest za duża do pobrania przez portal (ponad 20 MB)." } };
    const full = await im.fetch(uid, "");
    if (!full) return { status: 404, body: { error: "Nie udało się odczytać wiadomości." } };
    await log("zalacznik", { uid, msg_hash: hash, czesc: "0", rozmiar: full.body.length });
    return plik((nazwaPlikuWych(mail.temat).replace(/\.+$/, "").slice(0, 80) || "wiadomosc") + ".eml", full.body);
  };
  try { return await withTimeout(praca(), BUDZET_MS, "przekroczono czas"); }
  catch (e) {
    const msg = blad(e);
    console.error("poczta narzedzia", msg);
    const t = /przekroczono czas/.test(msg) ? "Serwer poczty odpowiada zbyt wolno — spróbuj ponownie."
      : /zastrzeżona/.test(msg) ? "Ta nazwa jest zastrzeżona dla folderu systemowego — wybierz inną."
      : /już istnieje|ALREADYEXISTS/i.test(msg) ? "Folder o takiej nazwie już istnieje."
      : /nie jest pusty/.test(msg) ? "Folder nie jest pusty (pojawiły się w nim nowe wiadomości) — spróbuj ponownie."
      : /podfoldery/.test(msg) ? "Ten folder ma podfoldery — najpierw zajmij się nimi."
      : /nazwa folderu|nadrzędny/.test(msg) ? "Nieprawidłowa nazwa folderu."
      : /UID EXPUNGE|MOVE/.test(msg) ? "Serwer poczty nie obsługuje tej operacji."
      : /BADCHARSET|SEARCH odrzucone/.test(msg) ? "Serwer poczty nie przyjął tego wyszukiwania."
      : "Operacja na skrzynce nie powiodła się.";
    return { status: 200, body: { error: t } };
  } finally { if (im) await (im as ImapLike).logout().catch(() => {}); }
}
