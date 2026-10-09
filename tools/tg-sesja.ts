// One-time login of the office's Telegram account FOR THE PORTAL (function telegram-grupa).
// Run by the owner of the account, in his own terminal, from the repository root:
//
//   deno run -A tools/tg-sesja.ts              log in and store the session in the function's secrets
//   deno run -A tools/tg-sesja.ts --wyloguj    end the portal's session and remove it from the secrets
//
// It creates a NEW, separate session (Telegram → Settings → Devices shows it as "TD Portal") and does
// not read or change any other session of the account. The session string is never printed and never
// written to the repository: it goes straight to `supabase secrets set` through the child's standard
// input (so it is in no command line and in no shell history). What is printed: "Gotowe: sesja portalu
// zapisana" and the account's @name.
//
// Needs: Deno, the Supabase CLI logged in (`supabase login`), and the api id / api hash of the office's
// Telegram application (my.telegram.org) — taken from TG_API_ID / TG_API_HASH when set, asked otherwise.

import { Api, TelegramClient } from "npm:telegram@2.26.22";
import { StringSession } from "npm:telegram@2.26.22/sessions/index.js";

const PROJEKT = "dpfxwkxpzqqjtmgqwozw";
const URZADZENIE = "TD Portal";           // how the session is named among the account's devices
const SEKRETY = ["TG_ADMIN_SESSION", "TG_API_ID", "TG_API_HASH"];

const pisz = (t: string) => Deno.stdout.writeSync(new TextEncoder().encode(t));
function pytaj(etykieta: string): string {
  const v = prompt(etykieta);
  if (v == null) { console.error("Przerwano."); Deno.exit(1); }
  return v.trim();
}
// typed without echo (2FA password, api hash)
function ukryte(etykieta: string): string {
  if (!Deno.stdin.isTerminal()) return pytaj(etykieta);
  pisz(etykieta + " ");
  Deno.stdin.setRaw(true);
  const znaki: number[] = [], b = new Uint8Array(1);
  try {
    for (;;) {
      const n = Deno.stdin.readSync(b);
      if (!n || b[0] === 13 || b[0] === 10) break;
      if (b[0] === 3) { Deno.stdin.setRaw(false); pisz("\n"); console.error("Przerwano."); Deno.exit(1); }
      if (b[0] === 127 || b[0] === 8) znaki.pop(); else znaki.push(b[0]);
    }
  } finally { Deno.stdin.setRaw(false); pisz("\n"); }
  return new TextDecoder().decode(new Uint8Array(znaki)).trim();
}
// Telegram's refusal as its code only (the error object may carry request details)
const kod = (e: unknown) => { const k = String((e as { errorMessage?: string })?.errorMessage ?? ""); return /^[A-Z][A-Z0-9_]{2,60}$/.test(k) ? k : "błąd połączenia"; };

function dostep(): { id: number; hash: string } {
  // the office's bot project already holds the application's id and hash — take them from there when not given
  const zPliku: Record<string, string> = {};
  try {
    for (const l of Deno.readTextFileSync((Deno.env.get("HOME") ?? "") + "/Claude/td-accounting-bot/.env").split("\n")) {
      const m = l.match(/^(TG_API_ID|TG_API_HASH)=\s*["']?([^"'\s#]+)/); if (m) zPliku[m[1]] = m[2];
    }
  } catch { /* no such file: ask */ }
  const recznie = Deno.args.includes("--pytaj");   // type the api id / api hash by hand instead of taking the stored ones
  const id = Number((!recznie && (Deno.env.get("TG_API_ID") || zPliku.TG_API_ID)) || pytaj("api id aplikacji Telegram (my.telegram.org):"));
  const hash = (!recznie && (Deno.env.get("TG_API_HASH") || zPliku.TG_API_HASH)) || ukryte("api hash (nie będzie widoczny):");
  if (!Number.isInteger(id) || id <= 0 || !/^[0-9a-f]{32}$/i.test(hash)) { console.error("Nieprawidłowe api id albo api hash (hash to 32 znaki szesnastkowe)."); Deno.exit(1); }
  return { id, hash };
}
// Where Telegram says it sent the code — shown so nobody waits for an SMS that was sent into the app (or the other way round)
const GDZIE: Record<string, string> = {
  "auth.SentCodeTypeApp": "wiadomością w aplikacji Telegram tego konta (czat „Telegram”, powiadomienia serwisowe) — nie SMS-em",
  "auth.SentCodeTypeSms": "SMS-em na ten numer", "auth.SentCodeTypeCall": "połączeniem głosowym na ten numer",
  "auth.SentCodeTypeFlashCall": "krótkim połączeniem (kod to końcówka numeru dzwoniącego)", "auth.SentCodeTypeMissedCall": "nieodebranym połączeniem (kod to końcówka numeru dzwoniącego)",
  "auth.SentCodeTypeEmailCode": "e-mailem na adres logowania przypisany do konta", "auth.SentCodeTypeFragmentSms": "na Fragment (numer anonimowy)",
  "auth.SentCodeTypeFirebaseSms": "SMS-em na ten numer", "auth.SentCodeTypeSetUpEmailRequired": "— Telegram wymaga najpierw ustawienia e-maila logowania w aplikacji",
};
// Login by QR code: no login code is needed. The owner scans it in the official app of the office account
// (Ustawienia → Urządzenia → Połącz urządzenie). Default; `--kod` switches to the login-code way.
async function zalogujQr(id: number, hash: string): Promise<TelegramClient> {
  const qr = (await import("npm:qrcode-terminal@0.12.0")).default;
  const tg = new TelegramClient(new StringSession(""), id, hash, { connectionRetries: 3, deviceModel: URZADZENIE, systemVersion: "Supabase Edge", appVersion: "telegram-grupa" });
  tg.setLogLevel("none" as never);
  await tg.connect();
  console.log("W aplikacji Telegram na telefonie, na koncie biura (@twojaksiegowa_admin): Ustawienia → Urządzenia → Połącz urządzenie — i zeskanuj kod poniżej.");
  try {
    await tg.signInUserWithQrCode({ apiId: id, apiHash: hash }, {
      qrCode: (k) => { console.log("\nKod QR (odświeża się co ok. 30 s — skanuj najnowszy, na dole):"); qr.generate("tg://login?token=" + k.token.toString("base64url"), { small: true }); return Promise.resolve(); },
      password: () => Promise.resolve(ukryte("Hasło weryfikacji dwuetapowej (nie będzie widoczne):")),
      onError: (e) => { console.error("Telegram odmówił: " + kod(e)); return Promise.resolve(true); },
    });
  } catch (e) { console.error("Logowanie kodem QR nieudane: " + kod(e)); Deno.exit(1); }
  return tg;
}
async function zaloguj(id: number, hash: string): Promise<TelegramClient> {
  const tg = new TelegramClient(new StringSession(""), id, hash, { connectionRetries: 3, deviceModel: URZADZENIE, systemVersion: "Supabase Edge", appVersion: "telegram-grupa" });
  tg.setLogLevel("none" as never);
  await tg.connect();
  const telefon = pytaj("Numer telefonu konta biura (z +48…):").replace(/[^\d+]/g, "");
  // deno-lint-ignore no-explicit-any
  let w: any;
  const wyslij = async () => {
    for (let i = 0; i < 3; i++) {
      try { return await tg.invoke(new Api.auth.SendCode({ phoneNumber: telefon, apiId: id, apiHash: hash, settings: new Api.CodeSettings({}) })); }
      catch (e) {
        const m = String((e as { errorMessage?: string })?.errorMessage ?? "").match(/^(?:PHONE|NETWORK|USER)_MIGRATE_(\d+)$/);
        if (!m) throw e;
        // deno-lint-ignore no-explicit-any
        await (tg as any)._switchDC(Number(m[1]));
      }
    }
    throw new Error("migracja");
  };
  try { w = await wyslij(); }
  catch (e) {
    const s = Number((e as { seconds?: number })?.seconds) || 0;
    console.error("Telegram odmówił wysłania kodu: " + kod(e) + (s ? " — spróbuj ponownie za " + Math.ceil(s / 60) + " min. Nie uruchamiaj logowania wcześniej, bo blokada się wydłuża." : ""));
    Deno.exit(1);
  }
  for (let proba = 0; proba < 4; proba++) {
    console.log("Telegram wysłał kod " + (GDZIE[w.type?.className] ?? "(" + String(w.type?.className) + ")") + "." + (w.nextType ? " Jeśli nie dojdzie: zostaw puste i naciśnij Enter" + (w.timeout ? " (najwcześniej za " + w.timeout + " s)" : "") + ", a Telegram wyśle go inną drogą." : ""));
    const k = pytaj("Kod logowania:").replace(/\D/g, "");
    if (!k) {
      try { w = await tg.invoke(new Api.auth.ResendCode({ phoneNumber: telefon, phoneCodeHash: w.phoneCodeHash })); }
      catch (e) { console.error("Telegram odmówił ponownego wysłania: " + kod(e) + ". Poczekaj chwilę i spróbuj jeszcze raz."); }
      continue;
    }
    try { await tg.invoke(new Api.auth.SignIn({ phoneNumber: telefon, phoneCodeHash: w.phoneCodeHash, phoneCode: k })); return tg; }
    catch (e) {
      const c = kod(e);
      if (c === "SESSION_PASSWORD_NEEDED") {
        for (let i = 0; i < 3; i++) {
          try { await tg.signInWithPassword({ apiId: id, apiHash: hash }, { password: () => Promise.resolve(ukryte("Hasło weryfikacji dwuetapowej (nie będzie widoczne):")), onError: (er) => { throw er; } }); return tg; }
          catch (er) { console.error("Telegram odmówił: " + kod(er)); }
        }
        break;
      }
      console.error("Telegram odmówił: " + c + (c === "PHONE_CODE_INVALID" ? " — kod się nie zgadza, wpisz ponownie." : ""));
      if (c === "PHONE_CODE_EXPIRED") break;
    }
  }
  console.error("Logowanie nieudane — przerwano."); Deno.exit(1);
}
// `supabase secrets …` with nothing secret in its arguments; its own output is not shown
async function supabase(args: string[], stdin?: string): Promise<boolean> {
  try {
    const p = new Deno.Command("supabase", { args: ["secrets", ...args, "--project-ref", PROJEKT], stdin: stdin == null ? "null" : "piped", stdout: "null", stderr: "null" }).spawn();
    if (stdin != null) { const w = p.stdin.getWriter(); await w.write(new TextEncoder().encode(stdin)); await w.close(); }
    return (await p.status).success;
  } catch { return false; }
}
async function zapiszSekrety(pary: Record<string, string>): Promise<boolean> {
  const env = Object.entries(pary).map(([k, v]) => `${k}="${v.replace(/[\\"]/g, "\\$&")}"`).join("\n") + "\n";
  if (await supabase(["set", "--env-file", "/dev/stdin"], env)) return true;
  // a CLI that cannot read the pipe: a private temporary file, removed at once
  const dir = await Deno.makeTempDir({ prefix: "tg-sesja-" }), plik = dir + "/sekrety.env";
  try {
    await Deno.writeTextFile(plik, env, { mode: 0o600 });
    return await supabase(["set", "--env-file", plik]);
  } finally { await Deno.remove(dir, { recursive: true }).catch(() => {}); }
}

if (Deno.args.includes("--wyloguj")) {
  // The stored session cannot be read back from the secrets, so the account is asked to end it:
  // a short-lived login finds the portal's session among the devices by its name and resets it.
  console.log("Zakończenie sesji portalu. Zaloguj konto biura jeszcze raz — ta pomocnicza sesja zostanie zaraz wylogowana.");
  const d = dostep();
  const tg = await (Deno.args.includes("--kod") ? zaloguj : zalogujQr)(d.id, d.hash);
  let zakonczone = 0, odmowa = "";
  try {
    const lista = await tg.invoke(new Api.account.GetAuthorizations());
    for (const a of lista.authorizations) {
      if (a.current || a.deviceModel !== URZADZENIE) continue;
      try { await tg.invoke(new Api.account.ResetAuthorization({ hash: a.hash })); zakonczone++; } catch (e) { odmowa = kod(e); }
    }
  } finally {
    try { await tg.invoke(new Api.auth.LogOut()); } catch { /* the helper session ends with the process anyway */ }
    await tg.destroy().catch(() => {});
  }
  const usuniete = await supabase(["unset", SEKRETY[0]]);
  if (odmowa === "FRESH_RESET_AUTHORISATION_FORBIDDEN") console.log("Telegram nie pozwala świeżo zalogowanej sesji kończyć innych przez 24 godziny. Zakończ sesję „" + URZADZENIE + "” w aplikacji Telegram: Ustawienia → Urządzenia.");
  else if (odmowa) console.log("Telegram odmówił zakończenia sesji (" + odmowa + ") — zakończ ją w aplikacji Telegram: Ustawienia → Urządzenia.");
  else console.log(zakonczone ? "Gotowe: sesja portalu zakończona (" + zakonczone + ")." : "Konto nie ma aktywnej sesji „" + URZADZENIE + "”.");
  console.log(usuniete ? "Sekret " + SEKRETY[0] + " usunięty z funkcji portalu." : "Nie udało się usunąć sekretu " + SEKRETY[0] + " — sprawdź `supabase login` i usuń go w panelu Supabase.");
  Deno.exit(0);
}

console.log("Logowanie konta Telegram biura dla portalu. Powstanie nowa, osobna sesja „" + URZADZENIE + "” — pozostałe sesje konta zostają bez zmian.");
const d = dostep();
const tg = await (Deno.args.includes("--kod") ? zaloguj : zalogujQr)(d.id, d.hash);
let nazwa = "";
let ok = false;
try {
  const ja = await tg.getMe();
  nazwa = String((ja as { username?: string }).username ?? "");
  ok = await zapiszSekrety({ TG_ADMIN_SESSION: String(tg.session.save()), TG_API_ID: String(d.id), TG_API_HASH: d.hash });
  // could not be stored: the fresh session would be an orphan, so it is ended at once
  if (!ok) { try { await tg.invoke(new Api.auth.LogOut()); } catch { /* shown below */ } }
} finally { await tg.destroy().catch(() => {}); }
if (!ok) {
  console.error("Nie udało się zapisać sekretów w Supabase (sprawdź `supabase login` i dostęp do projektu). Nowa sesja została wylogowana — uruchom narzędzie ponownie.");
  Deno.exit(1);
}
console.log("Gotowe: sesja portalu zapisana" + (nazwa ? " (@" + nazwa + ")" : "") + ".");
