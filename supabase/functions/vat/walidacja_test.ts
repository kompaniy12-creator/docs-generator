// deno test supabase/functions/vat/   (no network, no dependencies)
import { czytajDate, czytajKonto, czytajKraj, czytajNip, czytajNumerVat, czytajRegon, czytajWlasny, dzisPL, KRAJE_VIES, maska, nipOk, nrbOk, regonOk } from "./walidacja.ts";

function eq(a: unknown, b: unknown, co = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${co}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}
// the office's own public identifiers (TD Consulting Group) and numbers built only for the test
const NIP = "7831916366", REGON = "540118203", MIKRO = "56101000712222783191636600"; // tax micro-account of that NIP

Deno.test("NIP", () => {
  eq(nipOk(NIP), true); eq(nipOk("7831916367"), false); eq(nipOk("1234567890"), false); eq(nipOk("0000000000"), false);
  eq(czytajNip("783-191-63-66").ok, NIP); eq(czytajNip("PL 783 191 63 66").ok, NIP); eq(czytajNip(" 7831916366 ").ok, NIP);
  for (const zle of ["", "78319163", "783191636a", "7831916366/../x", "7831916366?date=1", 7831916366, null, undefined, {}, "１２３４５６７８９０", "7".repeat(200)]) {
    eq(czytajNip(zle).ok, undefined, "NIP " + String(zle));
  }
});
Deno.test("REGON", () => {
  eq(regonOk(REGON), true); eq(regonOk("540118204"), false); eq(regonOk("000000000"), false);
  eq(regonOk("12345678512347"), true); eq(regonOk("12345678512348"), false); // 14-digit: both check digits
  eq(czytajRegon("540 118 203").ok, REGON); eq(czytajRegon("5401182").ok, undefined); eq(czytajRegon("540118203/").ok, undefined);
});
Deno.test("rachunek", () => {
  eq(nrbOk(MIKRO), true); eq(nrbOk("12345678901234567890123456"), false);
  eq(czytajKonto("PL56 1010 0071 2222 7831 9163 6600").ok, MIKRO); eq(czytajKonto("56-1010-0071-2222-7831-9163-6600").ok, MIKRO);
  for (const zle of ["", MIKRO.slice(0, 25), MIKRO + "0", "DE" + MIKRO, MIKRO.slice(0, 25) + "x", MIKRO + "?date=2020-01-01", "../" + MIKRO, 1, null]) {
    eq(czytajKonto(zle).ok, undefined, "konto " + String(zle));
  }
  eq(maska(MIKRO), "…6600");
});
Deno.test("data", () => {
  const dzis = "2026-10-08";
  eq(czytajDate("2026-10-08", dzis).ok, "2026-10-08"); eq(czytajDate("2024-02-29", dzis).ok, "2024-02-29");
  for (const zle of ["2026-10-09", "2027-01-01", "2026-02-30", "2025-02-29", "2026-13-01", "08.10.2026", "2026-10-8", "2026-10-08T00:00", "2026-10-08&x=1", "1999-12-31", "", null, 20261008]) {
    eq(czytajDate(zle, dzis).ok, undefined, "data " + String(zle));
  }
  // "today" is the Polish day: 22:30 UTC on 8 Oct is already 9 Oct in Warsaw (CEST)
  eq(dzisPL(new Date("2026-10-08T22:30:00Z")), "2026-10-09"); eq(dzisPL(new Date("2026-01-15T22:30:00Z")), "2026-01-15");
});
Deno.test("VIES: kraj i numer", () => {
  eq(KRAJE_VIES.length, 28); eq(KRAJE_VIES.includes("GR"), false);
  eq(czytajKraj("el").ok, "EL"); eq(czytajKraj("GR").ok, "EL"); eq(czytajKraj("XI").ok, "XI");
  for (const zle of ["GB", "US", "", "P", "PLL", "../", null, 1]) eq(czytajKraj(zle).ok, undefined, "kraj " + String(zle));
  eq(czytajNumerVat("PL 783-191-63-66", "PL").ok, NIP); eq(czytajNumerVat(NIP, "PL").ok, NIP);
  eq(czytajNumerVat("1234567890", "PL").ok, undefined); eq(czytajNumerVat("123", "PL").ok, undefined);
  eq(czytajNumerVat("de 123.456.789", "DE").ok, "123456789"); eq(czytajNumerVat("GR123456789", "EL").ok, "123456789");
  eq(czytajNumerVat("ATU12345678", "AT").ok, "U12345678"); eq(czytajNumerVat("9Z54321Y", "IE").ok, "9Z54321Y");
  eq(czytajNumerVat("FR123456789", "FR").ok, "FR123456789"); eq(czytajNumerVat("FRXX123456789", "FR").ok, "XX123456789");
  for (const zle of ["", "1", "1234567890123", "12345/678", "123\"456", "123{456}", "ąęć12345", null, 5]) eq(czytajNumerVat(zle, "DE").ok, undefined, "numer " + String(zle));
});
Deno.test("VIES: własny numer", () => {
  eq(czytajWlasny("PL 7831916366").ok, { kraj: "PL", numer: NIP }); eq(czytajWlasny("783-191-63-66").ok, { kraj: "PL", numer: NIP });
  eq(czytajWlasny("DE123456789").ok, { kraj: "DE", numer: "123456789" }); eq(czytajWlasny("GR123456789").ok, { kraj: "EL", numer: "123456789" });
  for (const zle of ["PL1234567890", "GB123456789", "12345", "", "PL", null]) eq(czytajWlasny(zle).ok, undefined, "własny " + String(zle));
});
