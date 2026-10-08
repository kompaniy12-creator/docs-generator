/* Komplet dokumentów — the same documents one by one.
   A small seam over the generator in umowa-zlecenie.js (loaded after it): the komplet is one
   merged PDF, this gives every selected document as its own PDF, built by the very same code
   (generateKomplet with a single document switched on), so the content is identical.

   window.KompletDokumenty
     .DOCS                      id -> { title, kind, podpisuje, czesc, wewnetrzny }
     .opis(id, typ)             -> { id, kind, title, podpisuje, czesc, wewnetrzny }
     .lista(data)               -> the documents selected in `data` (collectData() shape), in the
                                   komplet's order: [{ id, kind, title, podpisuje, czesc, wewnetrzny,
                                   build(tr) -> Promise<Uint8Array> }]
     .zbuduj(data, id, tr)      -> Promise<Uint8Array> — one document; tr = null (Polish only) or
                                   the translation object from .tlumaczenie()
     .tlumaczenie(data, onProgress) -> Promise<tr | null> — the bilingual variant, as the komplet does it
     .gotowe()                  -> Promise — the client's contract template and the statutory rates
                                   are loaded; await it before .dane(), as the komplet's button does
     .dane()                    -> collectData() of the komplet form

   kind / podpisuje are the categories of the signing module (supabase/functions/podpisy):
   they decide which ways of signing are lawful and who signs. */
/* global DOC_ORDER, generateKomplet, collectData, collectStrings, getTranslations, loadFonts, loadScriptFonts, umowaTpl */
(function () {
  'use strict';
  var T = function (praca, zlecenie) { return { praca: praca, zlecenie: zlecenie }; };
  var DOCS = {
    umowa:     { title: T('Umowa o pracę', 'Umowa zlecenia'), kind: T('umowa_praca', 'umowa_zlecenie'), podpisuje: 'obie' },
    kwestKand: { title: 'Kwestionariusz osobowy dla osoby ubiegającej się o zatrudnienie', kind: 'kwestionariusz', podpisuje: 'pracownik', czesc: 'A' },
    kwest:     { title: T('Kwestionariusz osobowy dla pracownika', 'Kwestionariusz osobowy'), kind: 'kwestionariusz', podpisuje: 'pracownik' },
    wybor:     { title: 'Oświadczenie o wyborze umowy zlecenia i informacja o różnicach', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    gotowka:   { title: 'Wniosek o wypłatę wynagrodzenia w gotówce', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    rodo:      { title: 'Klauzula informacyjna RODO', kind: 'zgoda_rodo', podpisuje: 'pracownik' },
    // for a foreigner the employer's information needs the written form: the server then asks both sides
    zwiazki:   { title: 'Informacja o prawie wstępowania do związków zawodowych', kind: 'zwiazki_info', podpisuje: null },
    zus:       { title: 'Oświadczenie zleceniobiorcy (cele podatkowe i ZUS)', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    wykonawca: { title: 'Oświadczenie wykonawcy dla celów podatkowych', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    pit2:      { title: 'PIT-2', kind: 'pit2', podpisuje: 'pracownik' },
    rodzina:   { title: 'Wniosek o zgłoszenie członków rodziny do ubezpieczenia', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    ppkInfo:   { title: 'Informacja dotycząca PPK', kind: 'oswiadczenie', podpisuje: 'obie' },
    ppkRez:    { title: 'Deklaracja o rezygnacji z wpłat do PPK', kind: 'ppk_rezygnacja', podpisuje: 'pracownik' },
    bhp:       { title: 'Oświadczenie BHP', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    rowne:     { title: 'Informacja dotycząca równego traktowania w zatrudnieniu', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    zakres:    { title: 'Zakres czynności', kind: 'inny', podpisuje: 'obie' },
    // art. 29 § 3 KP: delivered, not signed — the worker confirms receipt
    warunki:   { title: 'Informacja o warunkach zatrudnienia', kind: 'informacja_warunki', podpisuje: 'potwierdzenie' },
    przepisy:  { title: 'Oświadczenie pracownika o przepisach zakładowych', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    zusPrac:   { title: 'Oświadczenie pracownika dla celów ZUS', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    zgodaPit:  { title: 'Zgoda na PIT w formie elektronicznej', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    rodzic:    { title: 'Oświadczenie o uprawnieniach rodzicielskich', kind: 'oswiadczenie', podpisuje: 'pracownik' },
    // dividers of the paper file: nobody signs them
    zakladki:  { title: 'Zakładki do akt osobowych (części A–E)', kind: null, podpisuje: null, wewnetrzny: true },
  };
  function pick(v, typ) { return v && typeof v === 'object' ? v[typ] : v; }
  function opis(id, typ) {
    var d = DOCS[id];
    if (!d) return null;
    return { id: id, kind: pick(d.kind, typ), title: pick(d.title, typ), podpisuje: d.podpisuje, czesc: d.czesc || (typ === 'zlecenie' ? 'Z' : 'B'), wewnetrzny: !!d.wewnetrzny };
  }
  async function zbuduj(data, id, tr) {
    if (!DOCS[id] || DOC_ORDER[data.typ].indexOf(id) < 0) throw new Error('Tego dokumentu nie ma w komplecie dla tej umowy: ' + id);
    await loadFonts();
    var one = Object.assign({}, data, { docs: {} });
    one.docs[id] = true;
    return generateKomplet(one, tr || null);
  }
  function lista(data) {
    return DOC_ORDER[data.typ].filter(function (id) { return data.docs[id] && DOCS[id]; }).map(function (id) {
      var o = opis(id, data.typ);
      o.build = function (tr) { return zbuduj(data, id, tr); };
      return o;
    });
  }
  // the bilingual variant, prepared exactly as the komplet's own button does
  async function tlumaczenie(data, onProgress) {
    if (!data.tlumaczenie || !data.tlumaczenie.on) return null;
    var target = data.tlumaczenie.jezyk || data.p.obywatelstwo;
    if (!target) throw new Error('Podaj obywatelstwo albo język tłumaczenia.');
    await loadFonts();
    var tr = await getTranslations(target, await collectStrings(data), onProgress || function () {});
    await loadScriptFonts(tr.script);
    return tr;
  }
  async function gotowe() { await umowaTpl.pending; if (window.Stawki && window.Stawki.ready) await window.Stawki.ready; }
  window.KompletDokumenty = { DOCS: DOCS, opis: opis, lista: lista, zbuduj: zbuduj, tlumaczenie: tlumaczenie, gotowe: gotowe, dane: function () { return collectData(); } };
})();
