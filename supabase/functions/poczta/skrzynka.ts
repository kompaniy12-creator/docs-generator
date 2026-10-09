// Poczta — the mailbox browser: every folder and every message of the office mailboxes, READ-ONLY.
// Live from IMAP (EXAMINE + BODY.PEEK only — nothing is marked as read, moved, flagged or deleted) and nothing
// of the mail is stored: the only trace is the access log (who opened which message / downloaded which
// attachment), which the owner can read. The model is asked only when a person clicks "Utwórz zadanie".
//
//   { action: "foldery", skrzynka }                                    folders with counters
//   { action: "lista_imap", skrzynka, folder, strona?, szukaj?, nieprzeczytane?, zalaczniki?, od?, do? }
//   { action: "wiadomosc_imap", skrzynka, folder, uid }                headers, text, cleaned HTML, attachments list
//   { action: "zalacznik_imap", skrzynka, folder, uid, part }          the file itself (binary answer)
//   { action: "analizuj_imap", skrzynka, folder, uid }                 run the normal analysis for this one message
//   { action: "dziennik" }                                             admin: the access log

import { analizuj, type Ctx, type Deps, type ImapLike, MAX_RAW, type Me, PARTIAL, przyjmij } from "./core.ts";
import { dataOk, isSkrzynka, parseMail, poczatekDnia, sha256hex, SKRZYNKI, type Skrzynka } from "./logic.ts";
import { type Folder, type Meta, typFolderu, withTimeout } from "./imap.ts";
export { typFolderu };
import { daneOdpowiedzi } from "./wysylka.ts";
import { oczyscWychodzacy } from "./mime.ts";
import { cidWHtml, czesci, maZalaczniki, naTekst, nazwaPliku, oczyscHtml, odkoduj, ramka, rozmiarPo, tekstCzesc, zalaczniki } from "./widok.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
type Out = { status: number; body: Any; raw?: { bytes: Uint8Array; headers: Record<string, string> } };
export const AKCJE = ["foldery", "liczniki", "lista_imap", "wiadomosc_imap", "zalacznik_imap", "analizuj_imap", "dziennik"];
export const STRONA = 30;
export const NA_MINUTE = 40;                    // mailbox requests of one person per minute
export const MAX_ZALACZNIK = 20 * 1024 * 1024;  // decoded bytes of one download
const MAX_TEKST = 600 * 1024, MAX_HTML = 1400 * 1024, MAX_CID = 500 * 1024, MAX_CID_RAZEM = 2 * 1024 * 1024, SKAN = 400, BUDZET_MS = 55000;
const OBRAZY = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const moze = (me: Me, s: Skrzynka) => me.admin || me.sekcje === null || me.sekcje.includes(SKRZYNKI[s].sekcja);
const noselect = (f: Folder) => f.flagi.some((x) => /^\\(noselect|nonexistent)$/i.test(x));
const PORZADEK = ["inbox", "sent", "drafts", "archive", "", "junk", "trash"];
const b64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const naglowek = (m: Meta) => { const k = Object.keys(m.sekcje).find((x) => x.startsWith("BODY[HEADER")); return k ? m.sekcje[k] : new Uint8Array(0); };

// the folder the browser names must be one the server itself listed for this mailbox
async function folderZListy(im: ImapLike, name: unknown): Promise<Folder | null> {
  if (typeof name !== "string" || !name || name.length > 300 || /[\r\n\0]/.test(name)) return null;
  return (await im.list()).find((f) => f.raw === name && !noselect(f)) ?? null;
}

export async function przegladarka(d: Deps, me: Me, ctx: Ctx, body: Any): Promise<Out> {
  if (body.action === "dziennik") {
    if (!me.admin) return { status: 403, body: { error: "Tylko administrator." } };
    return { status: 200, body: { dziennik: await d.store.dziennikLista(300) } };
  }
  const s = body.skrzynka;
  // the mailbox comes from the fixed list and must belong to the caller's section
  if (!isSkrzynka(s) || !moze(me, s)) return { status: 403, body: { error: "Brak dostępu do tej skrzynki." } };
  if (!d.konta[s]) return { status: 200, body: { error: "Skrzynka nie jest skonfigurowana." } };
  if (await d.store.dziennikLicz(me.email, new Date(d.now() - 60000).toISOString()) >= NA_MINUTE) return { status: 429, body: { error: "Za dużo zapytań do skrzynki — odczekaj minutę." } };
  const log = (akcja: string, x: Any = {}) => d.store.dziennik({ kto: me.email, akcja, skrzynka: s, folder: typeof body.folder === "string" ? body.folder.slice(0, 300) : null, ...x });
  const uid = Math.floor(Number(body.uid));
  const zUid = ["wiadomosc_imap", "zalacznik_imap", "analizuj_imap"].includes(body.action);
  if (zUid && !(uid > 0 && uid < 4294967296)) return { status: 400, body: { error: "Nieprawidłowy numer wiadomości." } };
  // list and folder requests are counted at once; opening and downloading are logged with the message's hash below
  if (!zUid) await log(body.action === "foldery" || body.action === "liczniki" ? "foldery" : "lista");

  let im: ImapLike | null = null;
  const praca = async (): Promise<Out> => {
    im = await d.imap(s, body.action === "zalacznik_imap" ? Math.ceil(MAX_ZALACZNIK * 1.45) : undefined);

    if (body.action === "foldery") {
      d.store.dziennikSprzataj(new Date(d.now() - 86400000).toISOString()).catch(() => {});
      const out = [];
      for (const f of (await im.list()).slice(0, 120)) {
        const o: Any = { id: f.raw, nazwa: f.nazwa.split(f.delim).pop(), sciezka: f.nazwa, poziom: f.nazwa.split(f.delim).length - 1, typ: typFolderu(f), wybieralny: !noselect(f), wiadomosci: null, nieprzeczytane: null };
        if (o.wybieralny) { try { const st = await im.status(f.raw); o.wiadomosci = st.messages; o.nieprzeczytane = st.unseen; } catch { /* a folder that cannot be counted is still listed */ } }
        out.push(o);
      }
      out.sort((a, b) => (a.poziom === 0 && b.poziom === 0 ? PORZADEK.indexOf(a.typ) - PORZADEK.indexOf(b.typ) : 0) || a.sciezka.localeCompare(b.sciezka, "pl"));
      return { status: 200, body: { skrzynka: s, adres: SKRZYNKI[s].adres, foldery: out } };
    }

    // a light refresh while the page is open: the inbox and the folder on screen, nothing else
    if (body.action === "liczniki") {
      const out: Any = {};
      for (const name of [...new Set(["INBOX", typeof body.folder === "string" ? body.folder : "INBOX"])].slice(0, 2)) {
        const f = name === "INBOX" ? { raw: "INBOX" } : await folderZListy(im, name);
        if (f) { const st = await im.status(f.raw); out[f.raw] = { wiadomosci: st.messages, nieprzeczytane: st.unseen, uidnext: st.uidnext }; }
      }
      return { status: 200, body: { liczniki: out } };
    }

    const folder = await folderZListy(im, body.folder);
    if (!folder) return { status: 400, body: { error: "Nie ma takiego folderu w tej skrzynce." } };
    const ex = await im.examine(folder.raw); // read-only or an error

    if (body.action === "lista_imap") {
      const strona = Math.max(1, Math.min(100000, Math.floor(Number(body.strona)) || 1));
      const tekst = typeof body.szukaj === "string" ? body.szukaj.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100) : "";
      for (const k of ["od", "do"]) if (body[k] && !dataOk(body[k])) return { status: 400, body: { error: "Nieprawidłowa data." } };
      const filtr = !!tekst || body.nieprzeczytane === true || body.oflagowane === true || body.zalaczniki === true || !!body.od || !!body.do;
      let metas: Meta[] = [], razem = ex.exists, przeszukano: number | null = null;
      if (!filtr) {
        const hi = ex.exists - (strona - 1) * STRONA;
        if (hi >= 1) metas = await im.meta({ od: Math.max(1, hi - STRONA + 1), do: hi }, false, true);
      } else {
        let uids = (await im.szukaj({ tekst, wTresci: body.w_tresci === true, oflagowane: body.oflagowane === true, nieprzeczytane: body.nieprzeczytane === true, od: body.od || undefined, do: body.do || undefined })).reverse();
        if (body.zalaczniki === true) { // IMAP cannot search for attachments: the newest SKAN matches are looked through
          const scan = uids.slice(0, SKAN), keep = new Set<number>();
          for (let i = 0; i < scan.length; i += 100) for (const m of await im.meta(scan.slice(i, i + 100), true, false)) if (maZalaczniki(czesci(m.bs))) keep.add(m.uid);
          przeszukano = scan.length;
          uids = scan.filter((u) => keep.has(u));
        }
        razem = uids.length;
        metas = await im.meta(uids.slice((strona - 1) * STRONA, strona * STRONA), true, true);
      }
      const rows = [];
      for (const m of metas.sort((a, b) => b.uid - a.uid)) {
        const h = await parseMail(naglowek(m)).catch(() => null);
        const idate = Date.parse(m.internaldate.replace(/^(\d{1,2})-(\w{3})-(\d{4}) /, "$1 $2 $3 "));
        rows.push({
          uid: m.uid, od_nazwa: h?.odNazwa ?? "", od_adres: h?.odAdres ?? "", do: (h?.doAdresy ?? []).slice(0, 3), temat: h?.temat ?? "",
          data: h?.data ?? (Number.isFinite(idate) ? new Date(idate).toISOString() : null), rozmiar: m.size,
          przeczytana: m.flagi.some((f) => /^\\seen$/i.test(f)), odpowiedziano: m.flagi.some((f) => /^\\answered$/i.test(f)), oflagowana: m.flagi.some((f) => /^\\flagged$/i.test(f)),
          zalaczniki: maZalaczniki(czesci(m.bs)),
        });
      }
      return { status: 200, body: { folder: folder.raw, strona, na_stronie: STRONA, razem, przeszukano, wiadomosci: rows } };
    }

    const m = (await im.meta([uid], true, true))[0];
    if (!m) return { status: 404, body: { error: "Nie ma takiej wiadomości (mogła zostać przeniesiona albo usunięta)." } };
    const mail = await parseMail(naglowek(m));
    const hash = (await sha256hex(mail.messageId)).slice(0, 32);
    const cz = czesci(m.bs);

    if (body.action === "wiadomosc_imap") {
      const plain = tekstCzesc(cz, "text/plain"), html = tekstCzesc(cz, "text/html");
      let tekst = plain ? naTekst(plain, (await im.part(uid, plain.id, MAX_TEKST)) ?? new Uint8Array(0)) : "";
      const htmlRaw = html ? naTekst(html, (await im.part(uid, html.id, MAX_HTML)) ?? new Uint8Array(0)) : "";
      let srcdoc: string | null = null, zdalne = 0;
      const uzyte = new Set<string>();
      if (htmlRaw) {
        // pictures that belong to the message itself (cid:) are embedded, within a size cap
        const chce = cidWHtml(htmlRaw), mapa = new Map<string, string>();
        let razem = 0, n = 0;
        for (const c of cz) {
          if (!c.cid || !chce.has(c.cid) || !OBRAZY.includes(c.typ) || c.rozmiar > MAX_CID || razem + c.rozmiar > MAX_CID_RAZEM || ++n > 12) continue;
          const b = await im.part(uid, c.id);
          if (!b) continue;
          razem += c.rozmiar;
          mapa.set(c.cid, `data:${c.typ};base64,${b64(odkoduj(c, b))}`);
          uzyte.add(c.cid);
        }
        const o = oczyscHtml(htmlRaw, mapa);
        srcdoc = ramka(o.html); zdalne = o.zdalne;
      }
      // the access log comes before the content: without the log row the message is not shown
      await log("otwarcie", { uid, msg_hash: hash });
      const wiersz = await d.store.znajdz(s, mail.messageId).catch(() => null);
      const typ = typFolderu(folder);
      const szkicId = mail.naglowki["x-portal-szkic"]?.trim() ?? "";
      const flaga = (f: string) => m.flagi.some((x) => x.toLowerCase() === f);
      const zad = wiersz?.zadanie_id ? (await d.store.zadania([wiersz.zadanie_id]))[0] ?? null : null;
      return { status: 200, body: {
        folder: folder.raw, uid, rozmiar: m.size, przeczytana: m.flagi.some((f) => /^\\seen$/i.test(f)),
        od_nazwa: mail.odNazwa, od_adres: mail.odAdres, do: mail.doAdresy, temat: mail.temat, data: mail.data,
        tekst: tekst.slice(0, 300000), srcdoc, zdalne,
        zalaczniki: zalaczniki(cz, uzyte).map((c) => ({ part: c.id, nazwa: nazwaPliku(c), typ: c.typ, rozmiar: rozmiarPo(c), za_duzy: rozmiarPo(c) > MAX_ZALACZNIK })),
        odpowiedziano: flaga("\\answered"), przekazano: flaga("$forwarded"), oflagowana: flaga("\\flagged"), typ_folderu: typ,
        odp: daneOdpowiedzi(mail.naglowki, mail.odAdres, mail.temat, s),
        // a draft written in the portal can be opened for editing again
        szkic: typ === "drafts" && /^[0-9a-f-]{36}$/.test(szkicId) ? { id: szkicId, html: oczyscWychodzacy(htmlRaw) } : null,
        // a shared mailbox: who already opened or answered this message from the portal
        kto: await d.store.ktoCo(s, hash).catch(() => []),
        analiza: wiersz ? { id: wiersz.id, status: wiersz.status, opisana: !!wiersz.ai, zadanie: zad ? { id: zad.id, status: zad.status, tytul: zad.tytul } : null } : null,
      } };
    }

    if (body.action === "zalacznik_imap") {
      const c = zalaczniki(cz).find((x) => x.id === String(body.part ?? ""));
      if (!c) return { status: 404, body: { error: "Nie ma takiego załącznika." } };
      if (rozmiarPo(c) > MAX_ZALACZNIK) return { status: 413, body: { error: "Załącznik jest za duży do pobrania przez portal (ponad 20 MB) — otwórz wiadomość w programie pocztowym." } };
      const raw = await im.part(uid, c.id);
      if (!raw) return { status: 404, body: { error: "Nie udało się odczytać załącznika." } };
      const bytes = odkoduj(c, raw);
      if (bytes.length > MAX_ZALACZNIK) return { status: 413, body: { error: "Załącznik jest za duży do pobrania przez portal (ponad 20 MB)." } };
      await log("zalacznik", { uid, msg_hash: hash, czesc: c.id, rozmiar: bytes.length });
      const name = nazwaPliku(c);
      // always a download, never something the browser could run or show as a page
      return { status: 200, body: null, raw: { bytes, headers: {
        "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      } } };
    }

    // analizuj_imap: the normal analysis of this one message, on a person's explicit click
    if (!d.modelReady) return { status: 200, body: { error: "Analiza nie jest skonfigurowana." } };
    const juz = await d.store.znajdz(s, mail.messageId);
    if (juz && (juz.ai || juz.zadanie_id)) return { status: 200, body: { ok: true, wiersz: juz.id, bylo: true } };
    if (await d.store.licz(s, { od: poczatekDnia(d.now()), analizowane: true }) >= ctx.ust.limity.dziennie) return { status: 200, body: { error: "Dzienny limit analiz wyczerpany." } };
    const big = m.size > MAX_RAW;
    const full = await im.fetch(uid, "", big ? PARTIAL : undefined);
    if (!full) return { status: 404, body: { error: "Nie udało się odczytać wiadomości." } };
    const inbox = folder.raw.toUpperCase() === "INBOX";
    await log("analiza", { uid, msg_hash: hash });
    const p = await przyjmij(d, ctx, s, full.body, { droga: "reczna", wymus: true, uid: inbox ? uid : undefined, uidvalidity: inbox ? ex.uidvalidity : undefined, obciete: big, rozmiar: m.size });
    const row = p.row ?? juz;
    if (!row) return { status: 200, body: { error: "Nie udało się zapisać wiadomości." } };
    if (p.wynik === "bez_analizy") return { status: 200, body: { error: row.powod ?? "Analiza nie jest teraz możliwa.", wiersz: row.id } };
    const pm = p.mail ?? await parseMail(full.body);
    if (p.wynik === "duplikat") await d.store.patch(row.id, { analiza_start: new Date(d.now()).toISOString() });
    // never a task by itself: the person decides on the proposal (mode "podglad" for this call)
    const a = await analizuj(d, ctx, row, pm, "podglad");
    return { status: 200, body: a.status === "blad" ? { error: "Analiza nie powiodła się — spróbuj ponownie.", wiersz: row.id } : { ok: true, wiersz: row.id, status: a.status } };
  };
  try { return await withTimeout(praca(), BUDZET_MS, "przekroczono czas"); }
  catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("poczta skrzynka", msg.replace(/[^\x20-\x7e]/g, " ").slice(0, 200));
    return { status: 200, body: { error: /przekroczono czas/.test(msg) ? "Serwer poczty odpowiada zbyt wolno — spróbuj ponownie." : /tylko do odczytu/.test(msg) ? "Folderu nie udało się otworzyć w trybie tylko do odczytu." : /BADCHARSET|SEARCH odrzucone/.test(msg) ? "Serwer poczty nie przyjął tego wyszukiwania." : "Nie udało się odczytać skrzynki." } };
  } finally { if (im) await (im as ImapLike).logout().catch(() => {}); }
}
