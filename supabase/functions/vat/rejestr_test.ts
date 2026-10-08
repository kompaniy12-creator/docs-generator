// deno test supabase/functions/vat/   — rows of the register; all data fictional except the office's own NIP
import { wierszRejestru } from "./rejestr.ts";

function eq(a: unknown, b: unknown, co = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${co}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}
const KTO = "ksiegowa@example.test", NIP = "7831916366", KONTO = "56101000712222783191636600";
const podmiot = (nazwa: string, status: string) => ({ nazwa, nip: NIP, status, regon: "540118203", krs: null, konta: [KONTO], wirtualne: false });

Deno.test("biała lista — wyszukiwanie", () => {
  const out = { podmioty: [podmiot("PRZYKŁADOWA SP. Z O.O.", "Czynny")], requestId: "abcde-1234567", requestDateTime: "09-10-2026 10:15:00", date: "2026-10-09" };
  const w = wierszRejestru("wl_search", KTO, { by: "nip", value: NIP, date: "2026-10-09" }, out, null);
  eq([w.kto, w.rodzaj, w.nip, w.nazwa, w.wynik, w.na_dzien, w.request_id, w.request_time], [KTO, "wl_search", NIP, "PRZYKŁADOWA SP. Z O.O.", "Czynny", "2026-10-09", "abcde-1234567", "09-10-2026 10:15:00"]);
  eq(w.szczegoly, out); eq(w.zapytanie, { by: "nip", value: NIP, date: "2026-10-09" });

  // by account: the account is kept in full in `zapytanie`, the NIP comes from the single subject found
  const k = wierszRejestru("wl_search", KTO, { by: "konto", value: KONTO, date: "2026-10-09" }, out, null);
  eq([k.nip, k.zapytanie.value], [NIP, KONTO]);

  const brak = wierszRejestru("wl_search", KTO, { by: "regon", value: "540118203", date: "2026-10-01" }, { podmioty: [], requestId: "x-1", requestDateTime: "09-10-2026 10:15:00", date: "2026-10-01" }, null);
  eq([brak.wynik, brak.nip, brak.nazwa, brak.request_id, brak.na_dzien], ["brak w wykazie", null, null, "x-1", "2026-10-01"]);

  const dwa = wierszRejestru("wl_search", KTO, { by: "konto", value: KONTO, date: "2026-10-09" }, { podmioty: [podmiot("ALFA", "Czynny"), podmiot("BETA", "Zwolniony")], requestId: "x-2", requestDateTime: "t" }, null);
  eq([dwa.wynik, dwa.nazwa, dwa.nip], ["2 podmioty: Czynny, Zwolniony", "ALFA (+1)", null]);
});
Deno.test("biała lista — para NIP + rachunek", () => {
  const w = wierszRejestru("wl_check", KTO, { nip: NIP, konto: KONTO, date: "2026-10-09" }, { przypisany: "NIE", nip: NIP, konto: KONTO, date: "2026-10-09", requestId: "x-3", requestDateTime: "09-10-2026 10:16:00" }, null);
  eq([w.nip, w.nazwa, w.wynik, w.na_dzien, w.request_id, w.zapytanie.konto], [NIP, null, "NIE", "2026-10-09", "x-3", KONTO]);
});
Deno.test("VIES", () => {
  const out = { wazny: true, kraj: "DE", numer: "123456789", nazwa: "BEISPIEL GMBH", adres: "MUSTERSTR. 1\n10115 BERLIN", dataZapytania: "2026-10-08T22:30:00.000Z", identyfikator: "WAPIAAAAtest", zWlasnym: "PL" + NIP };
  const w = wierszRejestru("vies", KTO, { kraj: "DE", numer: "123456789", wlasny: "PL" + NIP }, out, null);
  // 22:30 UTC on 8 Oct is already 9 Oct in Poland
  eq([w.nip, w.nazwa, w.wynik, w.na_dzien, w.request_id, w.request_time], ["DE123456789", "BEISPIEL GMBH", "ważny", "2026-10-09", "WAPIAAAAtest", "2026-10-08T22:30:00.000Z"]);
  const pl = wierszRejestru("vies", KTO, { kraj: "PL", numer: NIP, wlasny: null }, { wazny: false, kraj: "PL", numer: NIP, nazwa: null, adres: null, dataZapytania: "2026-10-09T08:00:00Z", identyfikator: null, zWlasnym: null }, null);
  eq([pl.nip, pl.wynik, pl.request_id, pl.nazwa], [NIP, "nieważny", null, null]);
});
Deno.test("błąd po stronie rejestru też jest wpisem", () => {
  const w = wierszRejestru("wl_check", KTO, { nip: NIP, konto: KONTO, date: "2018-01-01" }, null, { message: "Data sprzed zakresu wykazu. [WL-118]", kod: "WL-118" });
  eq([w.wynik, w.nip, w.na_dzien, w.request_id, w.szczegoly], ["błąd WL-118", NIP, "2018-01-01", null, { error: "Data sprzed zakresu wykazu. [WL-118]", kod: "WL-118" }]);
  const v = wierszRejestru("vies", KTO, { kraj: "DE", numer: "123456789", wlasny: null }, null, { message: "niedostępna", kod: "MS_UNAVAILABLE" }, new Date("2026-10-09T10:00:00Z"));
  eq([v.wynik, v.nip, v.na_dzien], ["błąd MS_UNAVAILABLE", "DE123456789", "2026-10-09"]);
});
