// Statutory minimum wage / minimum hourly rate by effective date, kept current
// automatically. Public GET (the public intake form needs it) -> { stawki: [...] }.
//
// Source of truth: the yearly "Rozporządzenie Rady Ministrów w sprawie wysokości
// minimalnego wynagrodzenia za pracę oraz wysokości minimalnej stawki godzinowej
// w RRRR r.", looked up in the official ELI register (api.sejm.gov.pl). When an act
// for a year we do not have yet appears, its PDF is read by the model, the figures
// are sanity-checked against the previous ones and stored in portal_stawki.
// The register is queried at most once a day, and only while a row is missing.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-opus-4-8";
const ELI = "https://api.sejm.gov.pl/eli/acts";
const TITLE = "minimalnego wynagrodzenia za pracę oraz wysokości minimalnej stawki godzinowej";

type Row = { valid_from: string; min_wage: number; min_hourly: number; source: string | null };

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
async function rows(): Promise<Row[]> {
  const r = await db("portal_stawki?select=valid_from,min_wage,min_hourly,source&order=valid_from.asc");
  if (!r.ok) throw new Error("db " + r.status);
  return (await r.json()).map((x: Row) => ({ ...x, min_wage: Number(x.min_wage), min_hourly: Number(x.min_hourly) }));
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    stawki: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          od: { type: "string" },
          wynagrodzenie: { type: "number" },
          stawka_godzinowa: { type: "number" },
        },
        required: ["od", "wynagrodzenie", "stawka_godzinowa"],
      },
    },
  },
  required: ["stawki"],
};

// figures of one act, e.g. [{od:"2027-01-01", wynagrodzenie:4950, stawka_godzinowa:32.3}]
async function readAct(pdf: Uint8Array) {
  let bin = "";
  for (let i = 0; i < pdf.length; i += 0x8000) bin += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: btoa(bin) } },
          { type: "text", text: 'To rozporządzenie w sprawie minimalnego wynagrodzenia za pracę i minimalnej stawki godzinowej. Zwróć w "stawki" po jednym elemencie dla każdej daty, od której obowiązują nowe kwoty (zwykle jedna: 1 stycznia; czasem druga: 1 lipca): "od" w formacie RRRR-MM-DD, "wynagrodzenie" — miesięczne minimalne wynagrodzenie w zł, "stawka_godzinowa" — minimalna stawka godzinowa w zł. Tylko kwoty wprost zapisane w akcie.' },
        ],
      }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    }),
  });
  if (!res.ok) throw new Error("model " + res.status);
  const data = await res.json();
  const text = (data.content || []).find((b: { type: string }) => b.type === "text")?.text ?? "{}";
  return (JSON.parse(text).stawki ?? []) as Array<{ od: string; wynagrodzenie: number; stawka_godzinowa: number }>;
}

// Look for acts covering years we have no row for; returns how many rows were added.
async function refresh(have: Row[]): Promise<number> {
  const r = await fetch(`${ELI}/search?title=${encodeURIComponent(TITLE)}&limit=5`);
  if (!r.ok) throw new Error("eli " + r.status);
  const items: Array<{ title: string; year: number; pos: number; publisher: string }> = (await r.json()).items ?? [];
  let added = 0;
  for (const act of items) {
    const m = act.title.match(/godzinowej w (\d{4}) r\./);
    if (!m) continue;
    const year = Number(m[1]);
    if (have.some((x) => x.valid_from.startsWith(String(year)))) continue;
    const pdf = await fetch(`${ELI}/${act.publisher}/${act.year}/${act.pos}/text.pdf`);
    if (!pdf.ok) continue;
    const found = await readAct(new Uint8Array(await pdf.arrayBuffer()));
    const prev = have.filter((x) => x.valid_from < `${year}-01-01`).pop();
    for (const f of found) {
      // sanity: right year, plausible amounts, hourly consistent with monthly, no big jump
      const ratio = f.wynagrodzenie / f.stawka_godzinowa;
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(f.od) && f.od.startsWith(String(year)) &&
        f.wynagrodzenie > 2000 && f.wynagrodzenie < 30000 && ratio > 120 && ratio < 200 &&
        (!prev || (f.wynagrodzenie >= prev.min_wage && f.wynagrodzenie <= prev.min_wage * 1.35));
      if (!ok) { console.error("rejected figures", act.year, act.pos, JSON.stringify(f)); continue; }
      const ins = await db("portal_stawki", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({
          valid_from: f.od, min_wage: f.wynagrodzenie, min_hourly: f.stawka_godzinowa,
          source: `Dz.U. ${act.year} poz. ${act.pos}`,
        }),
      });
      if (ins.ok) added++;
    }
  }
  return added;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...cors(origin) };
  try {
    let list = await rows();
    const now = new Date(), today = now.toISOString().slice(0, 10), nextYear = now.getUTCFullYear() + 1;
    // next year's act is published around mid-September; also recover if nothing covers today
    const missing = !list.some((x) => x.valid_from <= today) ||
      (now.getUTCMonth() >= 7 && !list.some((x) => x.valid_from.startsWith(String(nextYear))));
    if (missing && ANTHROPIC_KEY) {
      const c = await db("portal_stawki_check?id=eq.1&select=checked_at");
      const last = c.ok ? new Date((await c.json())[0]?.checked_at ?? 0).getTime() : 0;
      if (Date.now() - last > 20 * 3600 * 1000) {
        await db("portal_stawki_check?id=eq.1", { method: "PATCH", body: JSON.stringify({ checked_at: now.toISOString() }) });
        try {
          if (await refresh(list)) list = await rows();
        } catch (e) { console.error("refresh failed", e); }
      }
    }
    return new Response(JSON.stringify({ stawki: list }), { status: 200, headers });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "Wewnętrzny błąd serwera." }), { status: 500, headers });
  }
});
