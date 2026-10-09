// deno test --allow-env supabase/functions/powiadom/core_test.ts
// Nothing here touches the network: fetch is replaced, so no message can leave.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { bezTokenu, czysty, dataIso, tekstNowe } from "./logic.ts";

const TOKEN = "123456:TEST-token_abc";
Deno.env.set("SUPABASE_URL", "https://db.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
Deno.env.set("TELEGRAM_BOT_TOKEN", TOKEN);
const { handle } = await import("./core.ts");

Deno.test("czysty: links, mentions, markup and length", () => {
  assertEquals(czysty("Przykładowa Firma Testowa Sp. z o.o."), "Przykładowa Firma Testowa Sp. z o.o.");
  assertEquals(czysty("PILNE! zaloguj się: https://zly.example/login?x=1 teraz"), "PILNE! zaloguj się: (link) teraz");
  assertEquals(czysty("wejdź www.zly.example/a i t.me/oszust oraz zly-bank.com/x"), "wejdź (link) i (link) oraz (link)");
  assertEquals(czysty("napisz do @admin_td i @x1"), "napisz do (@) i (@)");
  assertEquals(czysty("<b>Firma</b> *pogrubiona* [tekst](x) `kod`"), "b Firma /b pogrubiona tekst (x) kod");
  assertEquals(czysty("a\n\nb\tc‮ d"), "a b c d");
  assert(czysty("x".repeat(500)).length <= 80);
  assertEquals(czysty(null), "");
  assertEquals(czysty({ a: 1 }), "");
  // an ordinary company name with a dot survives
  assertEquals(czysty("P.H.U. Kowalski s.c."), "P.H.U. Kowalski s.c.");
});
Deno.test("dataIso / tekstNowe", () => {
  assertEquals(dataIso("2026-11-01"), "2026-11-01");
  assertEquals(dataIso("2026-11-01\nhttps://x.example"), "");
  const t = tekstNowe({ z_nazwa: "Firma https://zly.example @ktos", u_typ: "<script>", u_od: "jutro t.me/x", documents: new Array(500).fill(1) }, "https://portal.test");
  assert(!/zly\.example|@ktos|t\.me|script|jutro/.test(t), t);
  assert(t.includes("Firma: Firma (link) (@)") && t.includes("Umowa: —") && t.includes("Dokumenty: 99") && t.endsWith("https://portal.test/zatrudnienie.html"));
  assertEquals(tekstNowe({ u_typ: "praca", u_od: "2026-11-01" }, "P").split("\n").slice(1, 4), ["Firma: —", "Umowa: umowa o pracę", "Od: 2026-11-01"]);
});
Deno.test("bezTokenu", () => {
  assertEquals(bezTokenu(`error sending request for url (https://api.telegram.org/bot${TOKEN}/sendMessage)`, TOKEN), "error sending request for url (https://api.telegram.org/bot***/sendMessage)");
  assertEquals(bezTokenu("https://api.telegram.org/bot999:OTHER_key-1/x", TOKEN), "https://api.telegram.org/bot***/x");
});

// ---- the handler with a mocked fetch ----
type Row = { id: string; status: string; created_at: string; payload: Record<string, unknown> };
function world(row: Row | null, opts: { sentHour?: number; tgThrows?: boolean; chats?: unknown[] } = {}) {
  const sent: { chat_id: string; text: string }[] = [];
  const logs: string[] = [];
  const realFetch = globalThis.fetch, realErr = console.error;
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET";
    await Promise.resolve(); // let parallel handlers interleave
    if (url.startsWith("https://api.telegram.org/")) {
      if (opts.tgThrows) throw new TypeError(`error sending request for url (${url})`);
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }));
    }
    if (url.includes("portal_ustawienia")) return new Response(JSON.stringify([{ value: opts.chats ?? [{ id: "-1000", name: "kadry" }] }]));
    if (url.includes("zatrudnienie_zgloszenia") && method === "PATCH") {
      // the database's conditional update: only while still 'nowe' and unmarked
      assert(url.includes("status=eq.nowe") && url.includes("payload->>_powiadomiono=is.null"), "unconditional update: " + url);
      if (!row || row.status !== "nowe" || row.payload._powiadomiono) return new Response("[]");
      row.payload = JSON.parse(String(init?.body)).payload;
      return new Response(JSON.stringify([{ id: row.id }]));
    }
    if (url.includes("zatrudnienie_zgloszenia") && url.includes("created_at=gte.")) return new Response("[]", { headers: { "content-range": `0-0/${opts.sentHour ?? 0}` } });
    if (url.includes("zatrudnienie_zgloszenia")) return new Response(JSON.stringify(row ? [structuredClone(row)] : []));
    throw new Error("unexpected fetch " + url);
  }) as typeof fetch;
  return { sent, logs, restore() { globalThis.fetch = realFetch; console.error = realErr; } };
}
const ID = "00000000-0000-4000-8000-000000000001";
const call = (id = ID) => handle(new Request("https://fn.test/powiadom", { method: "POST", body: JSON.stringify({ action: "nowe", id }) })).then((r) => r.json());
const fresh = (payload: Record<string, unknown> = {}): Row => ({ id: ID, status: "nowe", created_at: new Date().toISOString(), payload: { z_nazwa: "Przykładowa Firma Testowa Sp. z o.o.", u_typ: "zlecenie", ...payload } });

Deno.test("one fresh submission -> one message, marked before sending", async () => {
  const row = fresh(), w = world(row);
  try {
    assertEquals(await call(), { ok: true });
    assertEquals(w.sent.length, 1);
    assert(w.sent[0].text.includes("Firma: Przykładowa Firma Testowa Sp. z o.o."));
    assert(typeof row.payload._powiadomiono === "string");
    assertEquals(await call(), { ok: false }); // a repeated call
    assertEquals(w.sent.length, 1);
  } finally { w.restore(); }
});
Deno.test("20 parallel calls with the same id -> still one message", async () => {
  const w = world(fresh());
  try {
    const out = await Promise.all(Array.from({ length: 20 }, () => call()));
    assertEquals(out.filter((x) => x.ok).length, 1);
    assertEquals(w.sent.length, 1);
  } finally { w.restore(); }
});
Deno.test("the attacker's text is not repeated by the bot", async () => {
  const w = world(fresh({ z_nazwa: "TD Kadry: PILNE — potwierdź hasło na https://zly.example/td @wszyscy <a href='x'>tu</a> " + "A".repeat(300), u_od: "2026-11-01 oraz www.zly.example" }));
  try {
    await call();
    const t = w.sent[0].text;
    assert(!/zly\.example|@wszyscy|[<>]/.test(t), t);
    assert(!t.includes("Od:"), t);
    assert(t.split("\n")[1].length <= "Firma: ".length + 80, t);
  } finally { w.restore(); }
});
Deno.test("old, processed, unknown or malformed -> nothing is sent", async () => {
  for (const row of [null, { ...fresh(), status: "sprawdzone" }, { ...fresh(), created_at: new Date(Date.now() - 3600000).toISOString() }, fresh({ _powiadomiono: "x" })]) {
    const w = world(row as Row | null);
    try { assertEquals(await call(), { ok: false }); assertEquals(w.sent.length, 0); } finally { w.restore(); }
  }
  const w = world(fresh());
  try { assertEquals(await call("not-an-id"), { ok: false }); assertEquals(w.sent.length, 0); } finally { w.restore(); }
});
Deno.test("hourly cap: one warning at the cap, silence above it, the row is marked", async () => {
  let row = fresh(), w = world(row, { sentHour: 15 });
  try { assertEquals(await call(), { ok: false }); assertEquals(w.sent.length, 1); assert(w.sent[0].text.startsWith("⚠️")); assertEquals(row.payload._powiadomiono, "wstrzymane"); } finally { w.restore(); }
  row = fresh(); w = world(row, { sentHour: 40 });
  try { assertEquals(await call(), { ok: false }); assertEquals(w.sent.length, 0); assertEquals(row.payload._powiadomiono, "wstrzymane"); } finally { w.restore(); }
  // parallel calls at the cap: one warning only
  w = world(fresh(), { sentHour: 15 });
  try { await Promise.all(Array.from({ length: 10 }, () => call())); assertEquals(w.sent.length, 1); } finally { w.restore(); }
});
Deno.test("a network error of the Telegram call never puts the bot token into the logs or the answer", async () => {
  const w = world(fresh(), { tgThrows: true });
  try {
    const out = await call();
    assert(!JSON.stringify(out).includes(TOKEN));
    assert(w.logs.length > 0);
    assert(!w.logs.join("\n").includes(TOKEN) && !/bot\d+:/.test(w.logs.join("\n")), w.logs.join("\n"));
  } finally { w.restore(); }
});
Deno.test("admin actions still need an administrator", async () => {
  const w = world(fresh());
  try {
    const r = await handle(new Request("https://fn.test/powiadom", { method: "POST", body: JSON.stringify({ action: "test" }) }));
    assertEquals(r.status, 403);
    assertEquals(w.sent.length, 0);
  } finally { w.restore(); }
});
