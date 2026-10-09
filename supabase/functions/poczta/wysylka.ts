// Poczta — writing: sending (new / reply / reply to all / forward), drafts in the mailbox's Drafts folder,
// and the changes a person makes in a mailbox (read / unread, flag, move, archive, delete = move to Trash, spam).
//
//   { action: "wyslij", skrzynka, klucz, do[], dw[]?, udw[]?, temat, html, zalaczniki[]?, odp?, cytat?, potwierdzone?, szkic_uid?, potwierdzenie?, pilna? }
//        zalaczniki: [{ nazwa, b64, cid? }]      odp: { folder, uid, tryb: "reply" | "reply_all" | "forward", czesci?: [part ids to forward] }
//   { action: "szkic_zapisz", skrzynka, szkic_id, poprzedni_uid?, do, dw, udw, temat, html }   -> { uid }
//   { action: "szkic_usun", skrzynka, szkic_id, uid }
//   { action: "akcja_imap", skrzynka, folder, uids[], co, cel? }   co: przeczytane | nieprzeczytane | flaga | bez_flagi | kosz | archiwum | spam | przenies
//   { action: "podpowiedzi", skrzynka, q }       addresses: clients base + whom this mailbox wrote with
//   { action: "podpis", skrzynka, html? }        read / save the caller's signature for this mailbox
//   { action: "wyslane_log" }                    admin: the send log
//
// Rails: From is always the mailbox itself; a person sends only from mailboxes of their section; caps per person
// and per mailbox (day, minute) and on recipients; a first message to an unknown address needs a confirmation;
// attachments are checked by content; the same "klucz" is never sent twice; every send is logged (append-only).
// Mailbox changes go through the controlled write path (imapw.ts) and each is logged in poczta_dostep.

import { type Ctx, type Deps, type Me } from "./core.ts";
import { DARMOWE, isSkrzynka, parseMail, plData, poczatekDnia, sha256hex, SKRZYNKI, type Skrzynka } from "./logic.ts";
import { type Folder, folderTypu, type Meta, nieWybieralny, typFolderu, withTimeout } from "./imap.ts";
import { type Flaga } from "./imapw.ts";
import { czesci, naTekst, odkoduj, oczyscHtml, rozmiarPo, tekstCzesc, zalaczniki as zalCzesci, base64Bytes } from "./widok.ts";
import { adresy, adresyZNaglowka, bezCtl, budujMime, cytat, idOk, MAX_INLINE, MAX_INLINE_N, MAX_ZAL_RAZEM, nazwaPlikuWych, nowyId, oczyscWychodzacy, sprawdzZalacznik, tekstNaHtml, tekstZHtml, tematOdp, type Zal } from "./mime.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
type Out = { status: number; body: Any };
export const AKCJE_W = ["wyslij", "szkic_zapisz", "szkic_usun", "akcja_imap", "podpowiedzi", "podpis", "wyslane_log"];
const DOMENA = "td-group.pl", UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, BUDZET_MS = 100000;
const moze = (me: Me, s: Skrzynka) => me.admin || me.sekcje === null || me.sekcje.includes(SKRZYNKI[s].sekcja);
const naglowek = (m: Meta) => { const k = Object.keys(m.sekcje).find((x) => x.startsWith("BODY[HEADER")); return k ? m.sekcje[k] : new Uint8Array(0); };
const blad = (e: unknown) => String((e as Error)?.message ?? e).replace(/[^\x20-\x7e -ɏ]/g, " ").slice(0, 200);
// what the mail server said, in words a person can act on
function smtpBlad(e: unknown): string {
  const m = blad(e);
  if (/\b(550|551|553|554)\b.*(recipient|user|mailbox|address|relay)|recipient.*reject|no such user/i.test(m)) return "Serwer poczty odrzucił adres odbiorcy — sprawdź, czy jest poprawny.";
  if (/\b552\b|too (large|big)|size/i.test(m)) return "Serwer poczty odrzucił wiadomość jako zbyt dużą.";
  if (/\b(535|534|530)\b|auth/i.test(m)) return "Serwer poczty odrzucił logowanie skrzynki — zgłoś to administratorowi.";
  if (/timeout|ETIMEDOUT|ECONN|przekroczono czas/i.test(m)) return "Brak odpowiedzi serwera poczty — wiadomość NIE została wysłana, spróbuj ponownie.";
  return "Serwer poczty nie przyjął wiadomości — nie została wysłana.";
}
const podpisDomyslny = (imie: string, s: Skrzynka) => `<p>Pozdrawiam${imie ? "<br>" + tekstNaHtml(imie) : ""}<br>TD Consulting Group — ${SKRZYNKI[s].nazwa}</p>`;

export async function pisanie(d: Deps, me: Me, ctx: Ctx, body: Any): Promise<Out> {
  if (body.action === "wyslane_log") {
    if (!me.admin) return { status: 403, body: { error: "Tylko administrator." } };
    return { status: 200, body: { wyslane: await d.store.wyslaneLista(300) } };
  }
  const s = body.skrzynka;
  // the mailbox comes from the fixed list and must belong to the caller's section — this is also who may send as it
  if (!isSkrzynka(s) || !moze(me, s)) return { status: 403, body: { error: "Brak dostępu do tej skrzynki." } };
  const teraz = () => new Date(d.now()).toISOString();

  if (body.action === "podpis") {
    if (typeof body.html === "string") { await d.store.podpisZapisz(me.email, s, oczyscWychodzacy(body.html).slice(0, 4000)); return { status: 200, body: { ok: true } }; }
    const zapisany = await d.store.podpis(me.email, s);
    return { status: 200, body: { html: zapisany ?? podpisDomyslny(await d.store.pracownik(me.email).catch(() => ""), s), wlasny: zapisany !== null, stopka: ctx.ust.stopka[s], nadawca: ctx.ust.nadawca[s] } };
  }
  if (body.action === "podpowiedzi") {
    const q = bezCtl(body.q, 60).toLowerCase();
    if (q.length < 2) return { status: 200, body: { adresy: [] } };
    const out: { adres: string; opis: string }[] = [];
    for (const k of ctx.klienci) for (const a of adresy(k.email, 10).ok) if ((a.includes(q) || k.nazwa.toLowerCase().includes(q)) && !out.some((x) => x.adres === a)) out.push({ adres: a, opis: k.nazwa });
    for (const a of await d.store.adresySzukaj(s, q).catch(() => [])) if (!out.some((x) => x.adres === a)) out.push({ adres: a, opis: "z korespondencji" });
    return { status: 200, body: { adresy: out.slice(0, 8) } };
  }
  if (!d.konta[s]) return { status: 200, body: { error: "Skrzynka nie jest skonfigurowana." } };
  if (await d.store.dziennikLicz(me.email, new Date(d.now() - 60000).toISOString()) >= 60) return { status: 429, body: { error: "Za dużo operacji na skrzynce — odczekaj minutę." } };

  let im: Awaited<ReturnType<Deps["imapw"]>> | null = null;
  const praca = async (): Promise<Out> => {
    // ------------------------------------------------------------ changes in the mailbox
    if (body.action === "akcja_imap") {
      const uids = [...new Set((Array.isArray(body.uids) ? body.uids : []).map((x: unknown) => Math.floor(Number(x))).filter((x: number) => x > 0 && x < 4294967296))] as number[];
      if (!uids.length || uids.length > 100) return { status: 400, body: { error: "Zaznacz od 1 do 100 wiadomości." } };
      const co = String(body.co ?? "");
      im = await d.imapw(s);
      const list = await im.list();
      const src = typeof body.folder === "string" ? list.find((f) => f.raw === body.folder && !nieWybieralny(f)) : null;
      if (!src) return { status: 400, body: { error: "Nie ma takiego folderu w tej skrzynce." } };
      const flagi: Record<string, [boolean, Flaga]> = { przeczytane: [true, "\\Seen"], nieprzeczytane: [false, "\\Seen"], flaga: [true, "\\Flagged"], bez_flagi: [false, "\\Flagged"] };
      let cel: Folder | null = null;
      if (co === "kosz") cel = folderTypu(list, "trash");
      else if (co === "archiwum") cel = folderTypu(list, "archive");
      else if (co === "spam") cel = folderTypu(list, "junk");
      else if (co === "przenies") cel = typeof body.cel === "string" ? list.find((f) => f.raw === body.cel && !nieWybieralny(f)) ?? null : null;
      else if (!flagi[co]) return { status: 400, body: { error: "Nieznana operacja." } };
      if (!flagi[co] && !cel) return { status: 200, body: { error: co === "przenies" ? "Nie ma takiego folderu docelowego." : "W tej skrzynce nie ma folderu na tę operację (Kosz / Archiwum / Spam)." } };
      if (cel && cel.raw === src.raw) return { status: 200, body: { error: "Wiadomość już jest w tym folderze." } };
      await im.wybierz(src);
      if (flagi[co]) await im.flagi(uids, flagi[co][0], [flagi[co][1]]); else await im.przenies(uids, cel!);
      for (const uid of uids) await d.store.dziennik({ kto: me.email, akcja: "zmiana", skrzynka: s, folder: src.raw.slice(0, 300), uid, szczegoly: (co + (cel ? " -> " + cel.raw : "")).slice(0, 300) });
      return { status: 200, body: { ok: true, ile: uids.length, cel: cel?.raw ?? null } };
    }

    // ------------------------------------------------------------ what a person wrote (shared by send and draft)
    const A = { do: adresy(body.do, 20), dw: adresy(body.dw, 20), udw: adresy(body.udw, 20) };
    const zle = [...A.do.zle, ...A.dw.zle, ...A.udw.zle];
    const temat = bezCtl(body.temat, 250);
    const szkic = body.action !== "wyslij";

    if (body.action === "szkic_usun" || body.action === "szkic_zapisz") {
      if (!UUID.test(String(body.szkic_id ?? ""))) return { status: 400, body: { error: "Nieprawidłowy szkic." } };
      im = await d.imapw(s);
      const drafts = folderTypu(await im.list(), "drafts");
      if (!drafts) return { status: 200, body: { error: "W tej skrzynce nie ma folderu wersji roboczych." } };
      // the previous copy is removed only when it really is THIS draft (its X-Portal-Szkic header says so)
      const stary = Math.floor(Number(body.action === "szkic_usun" ? body.uid : body.poprzedni_uid));
      let uid: number | null = null;
      if (body.action === "szkic_zapisz") {
        const html = oczyscWychodzacy(String(body.html ?? ""));
        const raw = budujMime({ od: { nazwa: ctx.ust.nadawca[s], adres: SKRZYNKI[s].adres }, do: A.do.ok, dw: A.dw.ok, udw: A.udw.ok, temat, tekst: tekstZHtml(html), html, zalaczniki: [], messageId: nowyId(DOMENA), data: new Date(d.now()), szkicId: body.szkic_id }, true);
        uid = await im.dopisz(drafts, ["\\Seen", "\\Draft"], raw);
      }
      if (stary > 0) {
        await im.wybierz(drafts);
        const m = (await im.meta([stary], true, true, false))[0];
        if (m && (await parseMail(naglowek(m))).naglowki["x-portal-szkic"]?.trim() === body.szkic_id) await im.usunSzkic(stary);
      }
      return { status: 200, body: { ok: true, uid } };
    }

    // ------------------------------------------------------------ wyslij
    if (!UUID.test(String(body.klucz ?? ""))) return { status: 400, body: { error: "Brak klucza wysyłki." } };
    if (zle.length) return { status: 200, body: { error: "Nieprawidłowy adres: " + zle.slice(0, 3).join(", ") } };
    const wszyscy = [...new Set([...A.do.ok, ...A.dw.ok, ...A.udw.ok])];
    if (!wszyscy.length) return { status: 200, body: { error: "Podaj co najmniej jednego odbiorcę." } };
    const L = ctx.ust.limity;
    if (wszyscy.length > L.odbiorcy) return { status: 200, body: { error: `Najwyżej ${L.odbiorcy} odbiorców w jednej wiadomości — do większych wysyłek służą Rozsyłki.` } };
    if (!temat) return { status: 200, body: { error: "Podaj temat wiadomości." } };
    const dzien = poczatekDnia(d.now());
    if (await d.store.wyslaneLicz({ kto: me.email, od: new Date(d.now() - 60000).toISOString() }) >= L.wysMinuta) return { status: 429, body: { error: "Za dużo wiadomości w ciągu minuty — odczekaj chwilę." } };
    if (await d.store.wyslaneLicz({ kto: me.email, od: dzien }) >= L.wysUzytkownik) return { status: 429, body: { error: "Dzienny limit wysłanych wiadomości (na osobę) wyczerpany." } };
    if (await d.store.wyslaneLicz({ skrzynka: s, od: dzien }) >= L.wysSkrzynka) return { status: 429, body: { error: "Dzienny limit wysłanych wiadomości tej skrzynki wyczerpany." } };

    // attachments: decoded here, checked by content; pictures placed in the text travel as cid parts of this message
    const zal: Zal[] = [];
    let razem = 0, inl = 0;
    for (const z of (Array.isArray(body.zalaczniki) ? body.zalaczniki : []).slice(0, 40)) {
      if (!z || typeof z.b64 !== "string" || z.b64.length > MAX_ZAL_RAZEM * 1.4) return { status: 200, body: { error: "Nieprawidłowy załącznik." } };
      const bytes = base64Bytes(z.b64), nazwa = nazwaPlikuWych(z.nazwa);
      const t = sprawdzZalacznik(nazwa, bytes);
      if (!t.ok) return { status: 200, body: { error: t.error } };
      razem += bytes.length;
      if (z.cid != null) {
        if (!/^[A-Za-z0-9._-]{1,60}$/.test(String(z.cid)) || !/^image\/(png|jpeg|gif|webp)$/.test(t.typ) || bytes.length > MAX_INLINE || ++inl > MAX_INLINE_N) return { status: 200, body: { error: "Obraz wklejony w treść jest za duży albo nieobsługiwany (PNG / JPG / GIF / WebP do 2 MB, najwyżej 8)." } };
        zal.push({ nazwa, typ: t.typ, bytes, cid: String(z.cid) });
      } else zal.push({ nazwa, typ: t.typ, bytes });
    }
    let html = oczyscWychodzacy(String(body.html ?? ""), new Set(zal.filter((z) => z.cid).map((z) => z.cid!)));
    let cytatTekst = "";
    // a picture that the text does not use is not sent along
    for (let i = zal.length - 1; i >= 0; i--) if (zal[i].cid && !html.includes(`cid:${zal[i].cid}"`)) { razem -= zal[i].bytes.length; zal.splice(i, 1); }
    let tekst = tekstZHtml(html);
    if (!tekst.trim() && !zal.length && body.odp?.tryb !== "forward") return { status: 200, body: { error: "Wiadomość jest pusta — napisz treść albo dodaj załącznik." } };

    // a first message to an address nobody here has written with: the person confirms it
    const znane = new Set([...ctx.klienci.flatMap((k) => adresy(k.email, 10).ok), ...(await d.store.znaneAdresy(s, wszyscy).catch(() => [])), ...Object.values(SKRZYNKI).map((x) => x.adres)]);
    // a colleague of a known client (same company domain, not a free-mail one) is not a stranger either
    const domeny = new Set([...znane].map((a) => a.split("@")[1]).filter((dm) => dm && !DARMOWE.has(dm)));
    let nowe = wszyscy.filter((a) => !znane.has(a) && !domeny.has(a.split("@")[1]));

    // reply / forward: the original is read from the mailbox (never trusted from the browser)
    let inReplyTo: string | undefined, refs: string[] | undefined, zrodlo: { folder: Folder; uid: number; hash: string; tryb: string } | null = null;
    im = await d.imapw(s, Math.ceil(MAX_ZAL_RAZEM * 1.45));
    const list = await im.list();
    if (body.odp && typeof body.odp === "object") {
      const tryb = body.odp.tryb === "forward" ? "forward" : "reply";
      const uid = Math.floor(Number(body.odp.uid));
      const f = typeof body.odp.folder === "string" ? list.find((x) => x.raw === body.odp.folder && !nieWybieralny(x)) : null;
      if (!f || !(uid > 0)) return { status: 400, body: { error: "Nie ma takiej wiadomości." } };
      await im.examine(f.raw);
      const m = (await im.meta([uid], true, true))[0];
      if (!m) return { status: 404, body: { error: "Wiadomość, na którą odpowiadasz, nie istnieje już w tym folderze." } };
      const o = await parseMail(naglowek(m));
      // answering the people of the original message is never "a first message"
      if (tryb === "reply") { const wOryginale = new Set([o.odAdres, ...o.doAdresy, ...adresyZNaglowka(o.naglowki["reply-to"])]); nowe = nowe.filter((a) => !wOryginale.has(a)); }
      if (tryb === "reply") { if (idOk(o.messageId)) inReplyTo = o.messageId; refs = [...o.refs, o.messageId].filter(idOk).slice(-20); }
      const cz = czesci(m.bs);
      if (body.cytat !== false) {
        const plain = tekstCzesc(cz, "text/plain"), hp = tekstCzesc(cz, "text/html");
        const t = plain ? naTekst(plain, (await im.part(uid, plain.id, 300 * 1024)) ?? new Uint8Array(0)) : "";
        const h = hp ? oczyscHtml(naTekst(hp, (await im.part(uid, hp.id, 600 * 1024)) ?? new Uint8Array(0))).html : "";
        const c = cytat(tryb, { od: o.odNazwa ? `${o.odNazwa} <${o.odAdres}>` : o.odAdres, data: plData(o.data ?? teraz()), temat: o.temat, do: o.doAdresy.join(", "), html: oczyscWychodzacy(h), tekst: t.slice(0, 200000) });
        html += "<br>" + c.html;
        cytatTekst = c.tekst;
      }
      if (tryb === "forward" && Array.isArray(body.odp.czesci)) {
        const dost = zalCzesci(cz);
        for (const id of body.odp.czesci.slice(0, 30)) {
          const c = dost.find((x) => x.id === String(id));
          if (!c) continue;
          if (razem + rozmiarPo(c) > MAX_ZAL_RAZEM) return { status: 200, body: { error: "Załączniki przekraczają 20 MB." } };
          const b = await im.part(uid, c.id);
          if (!b) continue;
          const bytes = odkoduj(c, b), nazwa = nazwaPlikuWych(c.nazwa || "zalacznik"), t = sprawdzZalacznik(nazwa, bytes);
          if (!t.ok) return { status: 200, body: { error: t.error + " Przekaż wiadomość bez tego załącznika." } };
          razem += bytes.length; zal.push({ nazwa, typ: t.typ, bytes });
        }
      }
      zrodlo = { folder: f, uid, hash: (await sha256hex(o.messageId)).slice(0, 32), tryb };
    }
    if (razem > MAX_ZAL_RAZEM) return { status: 200, body: { error: "Załączniki przekraczają 20 MB." } };
    if (nowe.length && body.potwierdzone !== true) return { status: 200, body: { potwierdz: nowe, pytanie: "Pierwsza wiadomość na ten adres — nie ma go w bazie klientów ani w dotychczasowej korespondencji tej skrzynki. Sprawdź adres przed wysłaniem." } };

    if (cytatTekst) tekst += "\n\n" + cytatTekst;
    // the footer set by the owner closes every message of the mailbox
    const stopka = ctx.ust.stopka[s];
    if (stopka) { html += `<br><p style="color:#666666">${tekstNaHtml(stopka)}</p>`; tekst += "\n\n" + stopka; }

    const messageId = nowyId(DOMENA);
    const w = { od: { nazwa: ctx.ust.nadawca[s], adres: SKRZYNKI[s].adres }, do: A.do.ok, dw: A.dw.ok, udw: A.udw.ok, temat, tekst, html, zalaczniki: zal, messageId, data: new Date(d.now()), inReplyTo, refs, potwierdzenie: body.potwierdzenie === true, pilna: body.pilna === true };
    const raw = budujMime(w), kopia = A.udw.ok.length ? budujMime(w, true) : raw;
    // the log row first: the same key is never sent twice, and a send that cannot be logged does not happen
    const logId = await d.store.wyslaneClaim({ kto: me.email, skrzynka: s, klucz: body.klucz, odbiorcy_do: A.do.ok, odbiorcy_dw: A.dw.ok, odbiorcy_udw: A.udw.ok, temat, temat_hash: (await sha256hex(temat)).slice(0, 32), message_id: messageId, rozmiar: raw.length, zalaczniki: zal.filter((z) => !z.cid).length, odp_tryb: zrodlo?.tryb ?? null, odp_hash: zrodlo?.hash ?? null, wynik: "wysylanie" });
    if (!logId) return { status: 200, body: { error: "Ta wiadomość została już wysłana (albo właśnie jest wysyłana)." } };
    try { await d.smtp(s, { from: SKRZYNKI[s].adres, to: wszyscy }, raw); }
    catch (e) {
      console.error("poczta smtp", blad(e));
      await d.store.wyslanePatch(logId, { wynik: "blad", blad: blad(e) }).catch(() => {});
      return { status: 200, body: { error: smtpBlad(e) } };
    }
    await d.store.wyslanePatch(logId, { wynik: "wyslano" }).catch(() => {});

    // after the send: the copy in "Sent", the mark on the original, the draft goes — none of these can undo the send
    const ostrzezenia: string[] = [];
    try { const sent = folderTypu(list, "sent"); if (!sent) throw new Error("brak folderu"); await im.dopisz(sent, ["\\Seen"], kopia); }
    catch (e) { console.error("poczta sent", blad(e)); ostrzezenia.push("Wiadomość wysłana, ale nie udało się zapisać kopii w folderze Wysłane."); }
    if (zrodlo) {
      try { await im.wybierz(zrodlo.folder); await im.flagi([zrodlo.uid], true, [zrodlo.tryb === "forward" ? "$Forwarded" : "\\Answered"]); }
      catch (e) { console.error("poczta flaga", blad(e)); ostrzezenia.push("Nie udało się oznaczyć oryginału jako " + (zrodlo.tryb === "forward" ? "przekazanego." : "odpowiedzianego.")); }
    }
    const su = Math.floor(Number(body.szkic_uid));
    if (su > 0 && UUID.test(String(body.szkic_id ?? ""))) {
      try {
        const drafts = folderTypu(list, "drafts");
        if (drafts) { await im.wybierz(drafts); const m = (await im.meta([su], true, true, false))[0]; if (m && (await parseMail(naglowek(m))).naglowki["x-portal-szkic"]?.trim() === body.szkic_id) await im.usunSzkic(su); }
      } catch (e) { console.error("poczta szkic", blad(e)); }
    }
    return { status: 200, body: { ok: true, message_id: messageId, ostrzezenia } };
  };
  try { return await withTimeout(praca(), BUDZET_MS, "przekroczono czas"); }
  catch (e) {
    console.error("poczta pisanie", blad(e));
    return { status: 200, body: { error: /przekroczono czas/.test(blad(e)) ? "Serwer poczty odpowiada zbyt wolno — sprawdź w folderze Wysłane, czy wiadomość wyszła, zanim spróbujesz ponownie." : /MOVE/.test(blad(e)) ? "Serwer poczty nie obsługuje przenoszenia wiadomości." : "Operacja na skrzynce nie powiodła się." } };
  } finally { if (im) await (im as { logout(): Promise<void> }).logout().catch(() => {}); }
}
// what the reading pane needs to start a reply: who to answer, and to whom "reply to all" also goes
export function daneOdpowiedzi(naglowki: Record<string, string>, od: string, temat: string, s: Skrzynka) {
  const moj = SKRZYNKI[s].adres;
  const rt = adresyZNaglowka(naglowki["reply-to"]), to = adresyZNaglowka(naglowki["to"]), cc = adresyZNaglowka(naglowki["cc"]);
  const nadawca = rt.length ? rt : od ? [od] : [];
  // a message this mailbox sent itself: "reply" goes to its recipients
  const doKogo = nadawca.length && nadawca.every((a) => a === moj) ? to : nadawca;
  return { do: doKogo, dw: [...new Set([...to, ...cc])].filter((a) => a !== moj && !doKogo.includes(a)).slice(0, 19), re: tematOdp("reply", temat), fwd: tematOdp("forward", temat) };
}
