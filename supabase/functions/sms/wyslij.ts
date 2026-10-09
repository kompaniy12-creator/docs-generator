// The one guarded way an SMS leaves the portal. Used by the `sms` function itself and importable by other
// functions (terminy, podpisy):   import { wyslijSms } from "../sms/wyslij.ts";
//
// Provider: SMSAPI.pl (smsapi.pl/docs) — POST https://api.smsapi.pl/sms.do, Authorization: Bearer <token>,
// form fields to / message / from / format=json / encoding=utf-8 / test=1 / normalize=1 / max_parts /
// idx + check_idx=1 / details=1 / notify_url (only with settings.raporty); backup host api2.smsapi.pl. The token is the function secret
// SMSAPI_TOKEN: it is read here and goes nowhere but the Authorization header — never to a log, an
// answer or the database.
//
// TEST MODE: while settings.wlaczone is false, or when the caller asks for it, the provider gets test=1 —
// it validates the request and answers, but delivers and charges nothing. The whole path (guards, log) is
// the same.
//
// Order of work: recipient -> text -> guards (quiet hours, duplicate, caps) -> a row in sms_wiadomosci ->
// provider -> the row is completed. No row, no sending; a refusal by a guard is logged as "odrzucony".

import { loadKlienciRows } from "../_shared/klienci.ts";
import {
  analiza, czytajOdpowiedz, czytajUst, DUP_MIN, dzienPL, losowy, MAX_CZESCI, MAX_CZESCI_ADMIN, MAX_TRESC, numer, pierwszyNumer, przygotuj, sha,
  type Ust, wGodzinach,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TOKEN = Deno.env.get("SMSAPI_TOKEN") ?? "";
const HOSTY = ["https://api.smsapi.pl", "https://api2.smsapi.pl"];
const CALLBACK = `${SUPABASE_URL}/functions/v1/sms`;

// deno-lint-ignore no-explicit-any
type Any = any;
export const smsSkonfigurowane = () => !!TOKEN;

function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}
export async function ustawieniaSms(): Promise<Ust> {
  const r = await db("portal_ustawienia?key=eq.sms&select=value,updated_at");
  if (!r.ok) throw new Error("ustawienia: " + r.status);
  const w = (await r.json())[0];
  return czytajUst(w ? { ...w.value, updated_at: w.updated_at } : null);
}

// One request to the provider; the backup host is tried when the first does not answer or answers 5xx.
// Returns the status and the parsed JSON only — never the request.
export async function smsapi(path: string, init: { method?: string; form?: URLSearchParams } = {}): Promise<{ http: number; dane: Any; zapas: boolean }> {
  let ostatni = { http: 0, dane: null as Any, zapas: false };
  for (let i = 0; i < HOSTY.length; i++) {
    try {
      const r = await fetch(HOSTY[i] + path, {
        method: init.method ?? "GET", signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json", ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" } : {}) },
        body: init.form ? init.form.toString() : undefined,
      });
      const dane = await r.json().catch(() => null);
      ostatni = { http: r.status, dane, zapas: i > 0 };
      if (r.status < 500) return ostatni;
    } catch (_e) {
      ostatni = { http: 0, dane: null, zapas: i > 0 }; // the error object may quote the request: not kept
    }
  }
  return ostatni;
}

export type SmsZlecenie = {
  nip?: string;            // recipient: a client — the number is read from the clients base, or …
  telefon?: string;        // … an explicit number (the caller decides who may use it)
  tresc: string;
  cel?: string; ref?: string;
  kto: string;             // staff e-mail from the verified session, or "automat"
  automat?: boolean;       // true: never outside the allowed hours, never in test mode by accident
  admin?: boolean;         // may send up to MAX_CZESCI_ADMIN parts
  test?: boolean;          // force the provider's test mode
  mimoCiszy?: boolean;     // a person confirmed sending outside the allowed hours
  nazwa?: string;          // recipient's name for the log when there is no NIP
  teraz?: Date;
};
export type SmsWynik = {
  ok: boolean; test: boolean; kod?: string; error?: string; wymaga_potwierdzenia?: boolean;
  id?: string; telefon?: string; odbiorca?: string; tresc?: string; czesci?: number; kodowanie?: string; koszt?: number | null; status?: string;
  ostrzezenia: string[];
};

const CEL = /^[a-z0-9_]{1,30}$/;

export async function wyslijSms(z: SmsZlecenie): Promise<SmsWynik> {
  const teraz = z.teraz ?? new Date();
  const ost: string[] = [];
  const ust = await ustawieniaSms();
  const test = z.test === true || !ust.wlaczone;
  const nie = (kod: string, error: string, extra: Partial<SmsWynik> = {}): SmsWynik => ({ ok: false, test, kod, error, ostrzezenia: ost, ...extra });
  // an automatic job never "practises" on its own: with the module off it simply does not send
  if (z.automat && !ust.wlaczone && z.test !== true) return nie("wylaczone", "Wysyłka SMS jest wyłączona.");
  const cel = CEL.test(z.cel ?? "") ? z.cel! : "reczny";

  // ---- recipient
  let n, nazwa = String(z.nazwa ?? "").trim().slice(0, 300) || null, nip: string | null = null;
  if (z.nip != null && z.nip !== "") {
    nip = String(z.nip).replace(/\D/g, "");
    if (nip.length !== 10) return nie("odbiorca", "Nieprawidłowy NIP klienta.");
    const k = (await loadKlienciRows()).find((x) => x.nip === nip);
    if (!k) return nie("odbiorca", "Nie ma takiego klienta w bazie klientów.");
    nazwa = k.nazwa.slice(0, 300) || null;
    n = pierwszyNumer(k.telefon, ust.zagranica);
  } else n = numer(z.telefon, ust.zagranica);
  if (!n.ok) return nie("numer", n.error);

  // ---- text
  if (typeof z.tresc !== "string" || !z.tresc.trim()) return nie("tresc", "Wpisz treść wiadomości.");
  if (z.tresc.length > MAX_TRESC) return nie("tresc", "Treść jest za długa (najwyżej " + MAX_TRESC + " znaków).");
  const p = przygotuj(z.tresc, ust.normalizuj), a = analiza(p.tresc);
  if (p.podpis_dodany) ost.push("podpis_dodany");
  const maxCzesci = z.admin ? MAX_CZESCI_ADMIN : MAX_CZESCI;
  if (a.czesci > maxCzesci) return nie("za_dluga", `Wiadomość zajmuje ${a.czesci} części SMS — dozwolone są najwyżej ${maxCzesci}. Skróć treść${a.kodowanie === "UCS-2" ? " albo usuń znaki spoza podstawowego alfabetu" : ""}.`);
  if (!smsSkonfigurowane()) return nie("brak_konfiguracji", "SMS nie jest jeszcze skonfigurowany (brak tokenu SMSAPI).");
  if (!test && !ust.nadawca) return nie("nadawca", "W ustawieniach nie wybrano nazwy nadawcy.");

  const poza = !wGodzinach(teraz, ust.godziny);
  if (poza) {
    if (z.automat) return nie("cisza", `Poza godzinami wysyłki (${ust.godziny.od}–${ust.godziny.do}).`);
    if (!test && !z.mimoCiszy) return nie("cisza", `Jest poza godzinami wysyłki (${ust.godziny.od}–${ust.godziny.do}). Potwierdź, że mimo to chcesz wysłać teraz.`, { wymaga_potwierdzenia: true });
    ost.push("poza_godzinami");
  }

  const hash = await sha(p.tresc), idx = losowy();
  const wiersz = {
    kto: String(z.kto || "automat").slice(0, 200), odbiorca_nip: nip, odbiorca_nazwa: nazwa, telefon: n.e164, tresc: p.tresc, tresc_hash: hash,
    czesci: a.czesci, kodowanie: a.kodowanie, nadawca: ust.nadawca || null, cel, ref: z.ref ? String(z.ref).slice(0, 120) : null, test, idx,
  };
  const zapisz = async (pola: Any) => {
    const r = await db("sms_wiadomosci", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...wiersz, ...pola }) });
    return r.ok ? (await r.json())[0]?.id as string : null;
  };
  const odrzuc = async (kod: string, error: string) => { await zapisz({ status: "odrzucony", provider_blad: kod, idx: null }); return nie(kod, error, { telefon: n.e164 }); };

  // ---- guards: the same text to the same number, then the caps (counted atomically in the database)
  const od = new Date(teraz.getTime() - DUP_MIN * 60000).toISOString();
  const dup = await db(`sms_wiadomosci?select=id&telefon=eq.${encodeURIComponent(n.e164)}&tresc_hash=eq.${hash}&test=is.${test}&status=in.(nowy,test,wyslany,dostarczony)&created_at=gte.${encodeURIComponent(od)}&limit=1`);
  if (!dup.ok) return nie("baza", "Nie udało się sprawdzić historii wysyłek — nic nie wysłano.");
  if ((await dup.json()).length) return await odrzuc("duplikat", `Taka sama wiadomość poszła na ten numer w ciągu ostatnich ${DUP_MIN} minut.`);
  const pre = test ? "test:" : "", hNr = (await sha(n.e164)).slice(0, 32), slot = Math.floor(teraz.getTime() / (DUP_MIN * 60000));
  const rez = await db("rpc/sms_rezerwuj", { method: "POST", body: JSON.stringify({
    p_klucze: [`${pre}dup:${(await sha(n.e164 + "|" + hash)).slice(0, 32)}:${slot}`, `${pre}nr:${hNr}`, `${pre}dzien`],
    p_maxy: [1, ust.limit_na_numer_dziennie, ust.limit_dzienny],
  }) });
  if (!rez.ok) return nie("baza", "Nie udało się sprawdzić limitów — nic nie wysłano.");
  const pelny = await rez.json();
  if (typeof pelny === "string") {
    if (pelny.includes("dup:")) return await odrzuc("duplikat", `Taka sama wiadomość poszła na ten numer w ciągu ostatnich ${DUP_MIN} minut.`);
    if (pelny.includes("nr:")) return await odrzuc("limit_numer", `Dzienny limit wiadomości na jeden numer (${ust.limit_na_numer_dziennie}) jest wyczerpany.`);
    return await odrzuc("limit_dzienny", `Dzienny limit wiadomości (${ust.limit_dzienny}) jest wyczerpany.`);
  }

  // ---- the log row first, then the provider
  const id = await zapisz({ status: "nowy" });
  if (!id) return nie("baza", "Nie udało się zapisać wiadomości w dzienniku — nic nie wysłano.");
  const form = new URLSearchParams({ to: n.e164.slice(1), message: p.tresc, format: "json", encoding: "utf-8", max_parts: String(maxCzesci), idx, check_idx: "1", details: "1" });
  if (ust.nadawca) form.set("from", ust.nadawca);
  if (ust.normalizuj) form.set("normalize", "1");
  if (test) form.set("test", "1"); else if (ust.raporty) form.set("notify_url", CALLBACK); // delivery reports: only when switched on
  let w = await smsapi("/sms.do", { method: "POST", form });
  let o = czytajOdpowiedz(w.http, w.dane);
  // the address of delivery reports was refused: the message matters more than its report
  if (!o.ok && o.kod === 70 && !test) { form.delete("notify_url"); w = await smsapi("/sms.do", { method: "POST", form }); o = czytajOdpowiedz(w.http, w.dane); ost.push("bez_raportu"); }
  // the first host accepted the message but its answer was lost: the backup host refuses the repeated idx
  const przyjetaWczesniej = !o.ok && o.kod === 53 && w.zapas;
  const koniec = async (pola: Any) => {
    const r = await db(`sms_wiadomosci?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(pola) });
    if (!r.ok) { ost.push("dziennik_niepelny"); console.error("sms dziennik", r.status); }
  };
  const wspolne = { id, telefon: n.e164, odbiorca: nazwa ?? undefined, tresc: p.tresc, kodowanie: a.kodowanie };
  if (o.ok || przyjetaWczesniej) {
    const status = test ? "test" : "wyslany", czesci = o.ok && o.czesci ? o.czesci : a.czesci, koszt = o.ok ? o.koszt : null;
    await koniec({ status, provider_id: o.ok ? o.id : null, provider_status: o.ok ? o.status : "ACCEPTED", koszt, czesci, provider_blad: przyjetaWczesniej ? "potwierdzenie z hosta zapasowego" : null });
    console.log("sms", status, cel, "części:", czesci, "dzień:", dzienPL(teraz)); // no number, no text
    return { ok: true, test, ...wspolne, czesci, koszt, status, ostrzezenia: ost };
  }
  await koniec({ status: "blad", provider_blad: (o.kod != null ? o.kod + ": " : "") + o.opis });
  console.error("sms błąd dostawcy", o.kod ?? "http " + w.http);
  return { ok: false, test, kod: "dostawca", error: o.opis, ...wspolne, czesci: a.czesci, status: "blad", ostrzezenia: ost };
}
