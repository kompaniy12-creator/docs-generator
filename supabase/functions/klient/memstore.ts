// A Store in memory with fictional data — for the tests (portal_test.ts) and the local harness
// (harness.ts). Never imported by index.ts. Every person, firm and number here is made up.
import { type Flaga, type Store, type Ustawienia, WIDOCZNE } from "./portal.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
export const NIP_A = "5555555555", NIP_B = "7777777777", NIP_C = "8888888888"; // not valid NIPs
export const KONTO_A = { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "jan.testowy@przykladowa-firma.test", nip: [NIP_A, NIP_C], nazwa: "Jan Testowy" };
export const KONTO_B = { id: "bbbbbbbb-0000-4000-8000-000000000002", email: "anna.przykladowa@inna-firma.test", nip: [NIP_B], nazwa: "Anna Przykładowa" };
const W = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ID = {
  wA1: W(1), wA2: W(2), wA3: W(3), wA4: W(4), wA5: W(5), wA6: W(6), wAnowe: W(7), wAzla: W(8), wB1: W(101),
  aktaA: "22222222-0000-4000-8000-000000000001", aktaAukryty: "22222222-0000-4000-8000-000000000002", aktaB: "22222222-0000-4000-8000-000000000101",
  umowaA: "33333333-0000-4000-8000-000000000001", umowaAukryta: "33333333-0000-4000-8000-000000000002", umowaB: "33333333-0000-4000-8000-000000000101",
  histA: "44444444-0000-4000-8000-000000000001", histAstara: "44444444-0000-4000-8000-000000000002", histApeln: "44444444-0000-4000-8000-000000000003", histB: "44444444-0000-4000-8000-000000000101",
  pakA: "55555555-0000-4000-8000-000000000001", dokA1: "66666666-0000-4000-8000-000000000001", dokA2: "66666666-0000-4000-8000-000000000002",
  zglB: "77777777-0000-4000-8000-000000000101",
};
const plus = (now: number, d: number) => new Date(now + d * 86400000).toISOString().slice(0, 10);

export function memStore(now: () => number = () => Date.now()) {
  const t = now();
  const prac = (id: string, nip: string, name: string, status: string, p: Any, days = 200) => ({
    id, worker_name: name, status, created_at: new Date(t - days * 86400000).toISOString(),
    payload: { z_nip: nip, p_imiona: name.split(" ")[0], p_nazwisko: name.split(" ").slice(1).join(" "), p_obywatelstwo: "ukraińskie", p_pesel: "99999999990", p_dowod: "TEST123456", p_doc_typ: "paszport",
      p_konto: "00 0000 0000 0000 0000 0000 0000", p_dataur: "1990-01-01", p_telefon: "+48 000 000 000", p_email: "pracownik@przyklad.test",
      a_ulica: "Testowa", a_nrdom: "1", a_nrmiesz: "2", a_kod: "00-000", a_miejscowosc: "Przykładowo", u_typ: "zlecenie", u_stanowisko: "magazynier", u_od: plus(t, -days), u_stawka: "31,40", u_jedn: "godz.", ...p },
  });
  const db = {
    klienci: {
      [NIP_A]: { dane: { nazwa: "Przykładowa Firma Testowa Sp. z o.o.", nip: NIP_A, forma: "sp. z o.o.", opodatkowanie: "CIT, VAT miesięcznie", adres: "ul. Testowa 1, 00-000 Przykładowo", miasto: "Przykładowo", telefon: "+48 000 000 000", email: "biuro@przykladowa-firma.test", kontakt: "Jan Testowy", opiekun: "Przykładowa K.", kadrowy: "Testowa A.", jezyk: "Ukrainian" },
        baza: { id: NIP_A, nazwa: "Przykładowa Firma Testowa Sp. z o.o.", opiekun: "Przykładowa K.", kadrowy: "Testowa A.", status: "obslugiwany" } },
      [NIP_B]: { dane: { nazwa: "Inna Firma Testowa Sp. z o.o.", nip: NIP_B, forma: "sp. z o.o.", opodatkowanie: "", opiekun: "", kadrowy: "Testowa A.", jezyk: "Russian" },
        baza: { id: NIP_B, nazwa: "Inna Firma Testowa Sp. z o.o.", opiekun: null, kadrowy: "Testowa A.", status: "obslugiwany" } },
      [NIP_C]: { dane: { nazwa: "Trzecia Testowa — Jan Testowy", nip: NIP_C, forma: "JDG", opodatkowanie: "ryczałt, VAT kwartalnie", opiekun: "Przykładowa K.", kadrowy: "", jezyk: "" },
        baza: { id: NIP_C, nazwa: "Trzecia Testowa — Jan Testowy", opiekun: "Przykładowa K.", kadrowy: "", status: "obslugiwany" } },
    } as Record<string, { dane: Any; baza: Any }>,
    workers: [
      prac(ID.wA1, NIP_A, "Oksana Testowa", "zatrudniony", { p_karta_do: plus(t, 12), p_paszport_do: plus(t, 400), p_badania_do: plus(t, 90), u_do: plus(t, 150), komplet: { path: "umowa-zlecenie/2026-01-01/a1.pdf", filename: "komplet-testowa.pdf" } }),
      prac(ID.wA2, NIP_A, "Dmytro Przykładowy", "zatrudniony", { p_zezwolenie_do: plus(t, -5), p_paszport_do: plus(t, 25), u_typ: "praca", u_stanowisko: "operator wózka", u_bezterminowo: true, u_wymiar: "pełny etat", u_stawka: "5200", u_jedn: "mies." }),
      prac(ID.wA3, NIP_A, "Iryna Wzorcowa", "zatrudniony", { p_karta_bezterm: true, p_badania_do: plus(t, 300), u_do: plus(t, 60), p_pesel: "" }),
      prac(ID.wA4, NIP_A, "Andrii Próbny", "wyslane", { u_od: plus(t, 7), komplet: { path: "umowa-zlecenie/2026-01-02/a4.pdf", filename: "komplet-probny.pdf" } }, 3),
      prac(ID.wA5, NIP_A, "Olena Dawna", "archiwum", { u_do: plus(t, -40) }, 500),
      prac(ID.wA6, NIP_A, "Taras Sprawdzony", "sprawdzone", { u_od: plus(t, 10) }, 2),
      // not checked by the office yet: sent through the public form by anybody, with whatever NIP was typed
      prac(ID.wAnowe, NIP_A, "PODRZUCONY Niezweryfikowany", "nowe", { p_pesel: "88888888880", komplet: { path: "umowa-zlecenie/2026-01-05/n.pdf", filename: "n.pdf" } }, 1),
      // a packet path somebody tampered with
      prac(ID.wAzla, NIP_A, "Zła Ścieżka", "zatrudniony", { komplet: { path: "../akta-osobowe/cudzy/skan.pdf", filename: "x.pdf" } }, 50),
      prac(ID.wB1, NIP_B, "Piotr Cudzy", "zatrudniony", { p_karta_do: plus(t, 3), komplet: { path: "umowa-zlecenie/2026-01-03/b1.pdf", filename: "komplet-cudzy.pdf" } }),
    ] as Any[],
    onboarding: { [NIP_A]: { nrs: "00000000000000000000000000", tasks: [
      { title: "Pełnomocnictwo UPL-1", clientAction: "Podpisać i odesłać UPL-1", status: "waiting_client", dueDate: plus(t, 4) },
      { title: "Umowa", clientAction: "Podpisać umowę", status: "done" }, { title: "Rachunek", status: "todo" } ] } } as Record<string, Any>,
    podpisy: [{ id: ID.pakA, nip: NIP_A, zgloszenie_id: ID.wA1, status: "u_pracodawcy", dokumenty: [
      { id: ID.dokA1, tytul: "Umowa zlecenia", status: "u_pracodawcy", podpisuje: "obie", pd_status: "oczekuje" },
      { id: ID.dokA2, tytul: "Informacja o przetwarzaniu danych", status: "gotowy", podpisuje: "pracownik", pd_status: "nie_dotyczy" } ] }] as Any[],
    akta: [
      { id: ID.aktaA, nip: NIP_A, status: "przypisany", path: `${ID.aktaA}/skan.pdf`, nazwa: "skan.pdf", worker_id: ID.wA1, worker_name: "Oksana Testowa", czesc: "B", rodzaj: "umowa zlecenia", data_dok: "2026-01-01" },
      { id: ID.aktaAukryty, nip: NIP_A, status: "przypisany", path: `${ID.aktaAukryty}/kara.pdf`, nazwa: "kara.pdf", worker_id: ID.wA1, worker_name: "Oksana Testowa", czesc: "D", rodzaj: "kara porządkowa", data_dok: "2026-02-01" },
      { id: ID.aktaB, nip: NIP_B, status: "przypisany", path: `${ID.aktaB}/skan.pdf`, nazwa: "skan.pdf", worker_id: ID.wB1, worker_name: "Piotr Cudzy", czesc: "B", rodzaj: "umowa", data_dok: "2026-01-01" },
    ] as Any[],
    umowy: [
      { id: ID.umowaA, klient: NIP_A, status: "przypisany", path: `${ID.umowaA}/umowa.pdf`, nazwa: "umowa.pdf", rodzaj: "kadry", podtyp: "", data_zawarcia: "2025-03-01", obowiazuje_od: "2025-03-01", bezterminowa: true, wynagrodzenie: "TAJNE" },
      { id: ID.umowaAukryta, klient: NIP_A, status: "przypisany", path: `${ID.umowaAukryta}/aneks.pdf`, nazwa: "aneks.pdf", rodzaj: "aneks" },
      { id: ID.umowaB, klient: NIP_B, status: "przypisany", path: `${ID.umowaB}/umowa.pdf`, nazwa: "umowa.pdf", rodzaj: "kadry" },
    ] as Any[],
    flagi: { akta: new Set([ID.aktaA, ID.aktaB]), umowa: new Set([ID.umowaA, ID.umowaB]), historia: new Set<string>() } as Record<Flaga, Set<string>>,
    ust: { historia: "auto" } as Ustawienia,
    historia: [
      { id: ID.histA, created_at: new Date(t - 5 * 86400000).toISOString(), doc_type: "umowa-zlecenie", title: "Umowa zlecenie — komplet", subject: "Oksana Testowa", filename: "komplet.pdf", pdf_path: "umowa-zlecenie/2026-01-01/a1.pdf", nip: null, znip: NIP_A },
      { id: ID.histAstara, created_at: new Date(t - 9 * 86400000).toISOString(), doc_type: "umowa-zlecenie", title: "Umowa zlecenie — komplet", subject: "Oksana Testowa", filename: "komplet-stary.pdf", pdf_path: "umowa-zlecenie/2025-12-01/a0.pdf", nip: null, znip: NIP_A },
      { id: ID.histApeln, created_at: new Date(t - 2 * 86400000).toISOString(), doc_type: "pelnomocnictwo", title: "Pełnomocnictwo", subject: "", filename: "peln.pdf", pdf_path: "pelnomocnictwo/x.pdf", nip: NIP_A, znip: null },
      { id: ID.histB, created_at: new Date(t - 2 * 86400000).toISOString(), doc_type: "wynagrodzenie", title: "Uchwała", subject: "", filename: "uchwala.pdf", pdf_path: "wynagrodzenie/b.pdf", nip: NIP_B, znip: null },
    ] as Any[],
    zamkniecia: [
      { nip: NIP_A, okres: "2026-09", kroki: { dok: { at: "2026-10-03T08:00:00Z", by: "ksiegowa@biuro.test" }, ksiegi: { at: "2026-10-06T08:00:00Z", by: "x" } }, uwagi: "NOTATKA WEWNĘTRZNA" },
      { nip: NIP_A, okres: "2026-08", kroki: { dok: { at: "2026-09-02T08:00:00Z" }, ksiegi: { at: "2026-09-10T08:00:00Z" }, jpk: { nd: true }, zamk: { at: "2026-09-21T08:00:00Z" } }, uwagi: null },
    ] as Any[],
    invoices: [{ invoice_number: "FV/TEST/1", issue_date: plus(t, -20), due_date: plus(t, -6), amount: 1230, currency: "PLN", status: "overdue", paid_date: null, contractor_nip: NIP_A },
      { invoice_number: "FV/TEST/2", issue_date: plus(t, -50), due_date: plus(t, -36), amount: 1230, currency: "PLN", status: "paid", paid_date: plus(t, -40), contractor_nip: NIP_A }] as Any[],
    sync: new Date(t - 3600000).toISOString() as string | null,
    rejestr: { [NIP_A]: { krs: "0000000000", regon: "000000000", nazwa: "PRZYKŁADOWA FIRMA TESTOWA SP. Z O.O.", forma: "spółka z ograniczoną odpowiedzialnością", data_rejestracji: "2020-01-02", adres: "ul. Testowa 1, 00-000 Przykładowo",
      reprezentacja: "Każdy członek zarządu samodzielnie.", zarzad: [{ imie: "Jan", nazwisko: "Testowy", funkcja: "Prezes Zarządu" }], stan: "aktywna", sprawdzono_at: new Date(t - 86400000).toISOString(), dane: { tajne: 1 } } } as Record<string, Any>,
    konta: [{ ...KONTO_A, last_login: new Date(t - 3600000).toISOString() }, { ...KONTO_B, last_login: null }] as Any[],
    zgloszenia: [{ id: ID.zglB, created_at: new Date(t - 86400000).toISOString(), konto_id: KONTO_B.id, email: KONTO_B.email, nip: NIP_B, firma: "Inna Firma Testowa Sp. z o.o.", kategoria: "kadry", rodzaj: "pytanie", temat: "Pytanie cudzej firmy", tresc: "Treść cudza",
      zalaczniki: [{ n: 1, nazwa: "cudzy.pdf", mime: "application/pdf", rozmiar: 10, path: `${ID.zglB}/1.pdf`, sha256: "" }], status: "przyjete", status_reczny: false, zadanie_id: null }] as Any[],
    zadania: [] as Any[],
    log: [] as Any[],
    pliki: new Map<string, Uint8Array>(),
    logowania: { [KONTO_A.id]: [new Date(t - 60000).toISOString(), new Date(t - 3 * 86400000).toISOString()] } as Record<string, string[]>,
    assignee: "kadrowa@biuro.test" as string | null,
    uploadOk: true,
    tg: [] as Any[], tgLink: "https://t.me/przykladowy_bot?start=TESTtoken1234567890" as string | null,
    surowe: false, // true: the store "forgets" the status filter — the handlers must still refuse
  };
  const s: Store = {
    klient: (nip) => Promise.resolve(db.klienci[nip] ?? { dane: null, baza: null }),
    workers: (nip) => Promise.resolve(db.workers.filter((w) => w.payload.z_nip === nip && (db.surowe || WIDOCZNE.includes(w.status)))),
    noweIle: (nip) => Promise.resolve(db.workers.filter((w) => w.payload.z_nip === nip && w.status === "nowe").length),
    worker: (id) => Promise.resolve(db.workers.find((w) => w.id === id) ?? null),
    onboarding: (nip) => Promise.resolve(db.onboarding[nip] ?? null),
    podpisy: (nip) => Promise.resolve(db.podpisy.filter((p) => p.nip === nip)),
    logins: (id) => Promise.resolve(db.logowania[id] ?? []),
    log: (konto, akcja, info) => { db.log.push({ at: new Date(now()).toISOString(), konto_id: konto?.id || null, email: konto?.email ?? null, akcja, info }); return Promise.resolve(); },
    countLog: (id, akcja, since) => Promise.resolve(db.log.filter((l) => l.konto_id === id && l.akcja === akcja && l.at >= since).length),
    aktaShared: (nip) => Promise.resolve(db.akta.filter((a) => a.nip === nip && a.status === "przypisany" && db.flagi.akta.has(a.id))),
    aktaDoc: (id) => { const a = db.akta.find((x) => x.id === id); return Promise.resolve(a ? { ...a, shared: db.flagi.akta.has(id) } : null); },
    umowyShared: (kid) => Promise.resolve(db.umowy.filter((u) => u.klient === kid && u.status === "przypisany" && db.flagi.umowa.has(u.id))),
    umowa: (id) => { const u = db.umowy.find((x) => x.id === id); return Promise.resolve(u ? { ...u, shared: db.flagi.umowa.has(id) } : null); },
    historia: (nip, typy) => Promise.resolve(db.historia.filter((h) => typy.includes(h.doc_type) && (h.nip === nip || h.znip === nip)).sort((a, b) => a.created_at < b.created_at ? 1 : -1)),
    historiaDoc: (id) => Promise.resolve(db.historia.find((h) => h.id === id) ?? null),
    zamkniecia: (nip) => Promise.resolve(db.zamkniecia.filter((z) => z.nip === nip)),
    invoicesSync: () => Promise.resolve(db.sync),
    invoices: (nip) => Promise.resolve(db.invoices.filter((f) => f.contractor_nip === nip)),
    rejestr: (kid) => Promise.resolve(db.rejestr[kid] ?? null),
    konta: (nip) => Promise.resolve(db.konta.filter((k) => k.nip.includes(nip))),
    zgloszenia: (nip) => Promise.resolve(db.zgloszenia.filter((z) => z.nip === nip).sort((a, b) => a.created_at < b.created_at ? 1 : -1)),
    zgloszenie: (id) => Promise.resolve(db.zgloszenia.find((z) => z.id === id) ?? null),
    zgloszeniaOd: (kid, since) => Promise.resolve(db.zgloszenia.filter((z) => z.konto_id === kid && z.created_at >= since).length),
    zgloszenieInsert: (row) => { db.zgloszenia.push({ created_at: new Date(now()).toISOString(), status_reczny: false, zadanie_id: null, ...row }); return Promise.resolve(true); },
    zgloszeniePatch: (id, patch) => { Object.assign(db.zgloszenia.find((z) => z.id === id) ?? {}, patch); return Promise.resolve(); },
    zgloszeniaBiuro: (f) => Promise.resolve(db.zgloszenia.filter((z) => f.kategorie.includes(z.kategoria) && (!f.nip || z.nip === f.nip) && (!f.status || z.status === f.status))),
    upload: (bucket, path, bytes) => { if (db.uploadOk) db.pliki.set(`${bucket}/${path}`, bytes); return Promise.resolve(db.uploadOk); },
    usun: (bucket, paths) => { for (const p of paths) db.pliki.delete(`${bucket}/${p}`); return Promise.resolve(); },
    sign: (bucket, path, sek, nazwa) => Promise.resolve(`https://storage.test/sign/${bucket}/${path}?token=test&exp=${sek}&download=${encodeURIComponent(nazwa)}`),
    assignee: () => Promise.resolve(db.assignee),
    zadanieInsert: (spec) => { const z = { id: crypto.randomUUID(), status: "nowe", ...spec }; db.zadania.push(z); return Promise.resolve({ id: z.id }); },
    zadaniaStatus: (ids) => Promise.resolve(Object.fromEntries(db.zadania.filter((z) => ids.includes(z.id)).map((z) => [z.id, z.status]))),
    flagSet: (zr, id, on) => { if (on) db.flagi[zr].add(id); else db.flagi[zr].delete(id); return Promise.resolve(true); },
    flags: (zr, ids) => Promise.resolve(ids.filter((i) => db.flagi[zr].has(i))),
    telegramLink: (kid, kto, utworz) => { db.tg.push({ kid, kto, utworz }); return Promise.resolve(db.tgLink); },
    obiektFlagi: (zr, id) => Promise.resolve((zr === "akta" ? db.akta : zr === "umowa" ? db.umowy : db.historia).some((x) => x.id === id)),
    ustawienia: () => Promise.resolve({ ...db.ust }),
    ustawieniaZapisz: (u) => { db.ust = { ...u }; return Promise.resolve(true); },
  };
  return { store: s, db };
}
