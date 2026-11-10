import { assertEquals } from "jsr:@std/assert@1";
import { linia, mail, SCIEZKA, zgloszenie, zrodlo } from "./logic.ts";

Deno.test("only pages of the site are counted", () => {
  for (const p of ["/", "/cennik/", "/uk/", "/ru/uslugi/kadry-i-place/", "/uslugi/rejestracja-spolek/"]) assertEquals(SCIEZKA.test(p), true, p);
  for (const p of ["", "/x/", "/cennik", "/en/", "/uslugi/inne/", "/cennik/?a=1", "/../etc"]) assertEquals(SCIEZKA.test(p), false, p);
});

Deno.test("the source of a visit is one of a few fixed words", () => {
  assertEquals(zrodlo(""), "bezpośrednio");
  assertEquals(zrodlo("www.google.pl"), "google");
  assertEquals(zrodlo("google.com.ua"), "google");
  assertEquals(zrodlo("notgoogle.pl.example"), "inne strony");
  assertEquals(zrodlo("td-group.pl"), "strona");
  assertEquals(zrodlo("l.facebook.com"), "media społecznościowe");
  assertEquals(zrodlo("evil\n<script>"), "inne strony");
});

Deno.test("a submission needs a name, a valid address and something to say", () => {
  assertEquals(zgloszenie({ imie: "Jan Testowy", email: "jan@example.com" }), null);
  assertEquals(zgloszenie({ imie: "Jan Testowy", email: "jan@example", wiadomosc: "x" }), null);
  assertEquals(zgloszenie({ imie: "", email: "jan@example.com", wiadomosc: "x" }), null);
  const z = zgloszenie({ imie: " Jan\r\nBcc: x@example.com ", email: "JAN@Example.com", wycena: "Razem: 300 zł", jezyk: "de", strona: "/zla/" })!;
  assertEquals(z.imie, "Jan Bcc: x@example.com");
  assertEquals(z.email, "jan@example.com");
  assertEquals(z.jezyk, "pl");
  assertEquals(z.strona, "");
});

Deno.test("nothing a visitor types can add a mail header", () => {
  assertEquals(linia("a\r\nb\tc", 50), "a b c");
  const m = mail(zgloszenie({ imie: "Jan\nTestowy", firma: "Przykładowa Firma Testowa\r\nTo: x@example.com", email: "jan@example.com", wiadomosc: "Dzień dobry" })!);
  assertEquals(/[\r\n]/.test(m.subject), false);
});
