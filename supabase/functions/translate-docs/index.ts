// Translates fragments of Polish employment documents for the bilingual packet
// (Polish original + translation opposite it). PORTAL ONLY — requires a Supabase
// JWT with app_metadata.portal === true, so the model cannot be used anonymously.
// Input:  { target: "<citizenship in Polish or a language name>", strings: [..] }
// Output: { language, script, fallback, translations: [..] } (same order as input).
// The generator caches results in the browser, so each string is translated once.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-opus-4-8";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MAX_STRINGS = 60;
const MAX_CHARS = 8000;

// Scripts the PDF generator has fonts for. Anything else falls back to English.
const SCRIPTS = ["latin", "cyrillic", "greek", "georgian", "armenian"];

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}

async function requirePortal(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  const u = await r.json();
  // section access: admins and accounts without a portal_sections list have every section
  const secs = u?.app_metadata?.portal_sections;
  const kadry = u?.app_metadata?.portal_admin === true || !Array.isArray(secs) || secs.includes("kadry");
  return u?.app_metadata?.portal === true && kadry;
}

const SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string" },
    script: { type: "string", enum: SCRIPTS },
    fallback: { type: "boolean" },
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer" }, t: { type: "string" } },
        required: ["i", "t"],
        additionalProperties: false,
      },
    },
  },
  required: ["language", "script", "fallback", "translations"],
  additionalProperties: false,
};

function instruction(target: string) {
  return `Tłumaczysz fragmenty polskich dokumentów kadrowych (kwestionariusz osobowy, oświadczenia podatkowe i ZUS, PPK, RODO, informacja o warunkach zatrudnienia) dla cudzoziemca, który podpisuje je w Polsce. Tłumaczenie zostanie wydrukowane obok polskiego oryginału, żeby pracownik rozumiał, co podpisuje.

JĘZYK DOCELOWY — wskazanie użytkownika: "${target}".
- Jeśli to obywatelstwo (np. "ukraińskie", "gruzińskie", "indyjskie", "Ukraina"), wybierz język urzędowy tego państwa, w którym wydawane są jego paszporty i którym posługuje się większość obywateli (Ukraina → ukraiński, Białoruś → rosyjski, Gruzja → gruziński, Indie → hindi, Nepal → nepalski, Filipiny → filipiński, Kolumbia → hiszpański).
- Jeśli to nazwa języka (np. "rosyjski", "English"), użyj właśnie tego języka.
- Obsługiwane pisma: ${SCRIPTS.join(", ")}. Jeżeli wybrany język używa innego pisma (np. dewanagari, bengalskiego, arabskiego, chińskiego, tajskiego — PDF nie potrafi ich poprawnie złożyć), przetłumacz na ANGIELSKI i ustaw "fallback": true, "script": "latin". W pozostałych przypadkach "fallback": false.
- "language": nazwa użytego języka po polsku (np. "ukraiński"). "script": pismo użytego języka.

ZASADY TŁUMACZENIA:
- Tłumacz wiernie i kompletnie, rejestrem urzędowym/prawniczym; niczego nie dodawaj, nie pomijaj i nie komentuj.
- Zachowaj bez zmian: numerację i znaki na początku ("1.  ", "2)  ", "§ ", "–  "), znaczniki {0}, {1}, {2}, ciągi kropek do wypełnienia ("........"), gwiazdki przypisów (*, **, ***), kwoty, liczby, daty, procenty i numery artykułów.
- Warianty do skreślenia typu "Nie jestem/Jestem*" tłumacz jako dwa warianty rozdzielone ukośnikiem, z gwiazdką w tym samym miejscu.
- Formy z ukośnikiem dla płci ("zatrudniona/ny", "Pani/Pan") oddaj naturalnie w języku docelowym.
- Skróty i nazwy własne polskich instytucji i dokumentów zostaw po polsku: PESEL, NIP, ZUS, NFZ, PPK, PIT, PIT-2, KRUS, RODO, Dz. U. — przy pierwszym RODO możesz dodać w nawiasie odpowiednik (np. GDPR). "Kodeks pracy", "Urząd Skarbowy" przetłumacz opisowo.
- Krótkie etykiety pól (np. "Nazwisko", "Gmina", "Powiat", "Województwo") tłumacz krótko, bez dwukropka.
- Każdy element wejściowy ma numer "i"; zwróć dokładnie jeden element wyjściowy o tym samym "i" dla każdego wejściowego.`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!(await requirePortal(req))) return json({ error: "Brak dostępu (portal)." }, 403, origin);
  if (!ANTHROPIC_KEY) return json({ error: "Brak konfiguracji ANTHROPIC_API_KEY." }, 500, origin);

  let payload: { target?: string; strings?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Nieprawidłowy JSON." }, 400, origin);
  }
  const target = (payload.target || "").toString().replace(/["\n\r]/g, " ").trim().slice(0, 80);
  const strings = Array.isArray(payload.strings) ? payload.strings.map((s) => String(s)) : [];
  if (!target) return json({ error: "Brak języka / obywatelstwa." }, 400, origin);
  if (!strings.length) return json({ error: "Brak tekstów." }, 400, origin);
  if (strings.length > MAX_STRINGS || strings.join("").length > MAX_CHARS) {
    return json({ error: "Za dużo tekstu w jednym żądaniu." }, 413, origin);
  }

  const items = strings.map((pl, i) => ({ i, pl }));
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 12000,
        messages: [{ role: "user", content: instruction(target) + "\n\nTEKSTY (JSON):\n" + JSON.stringify(items) }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });
    if (!res.ok) {
      console.error("Anthropic error", res.status, await res.text());
      return json({ error: "Błąd modelu (" + res.status + ")." }, 502, origin);
    }
    const data = await res.json();
    if (data.stop_reason === "refusal") return json({ error: "Model odmówił tłumaczenia." }, 422, origin);
    if (data.stop_reason === "max_tokens") return json({ error: "Tłumaczenie zbyt długie — spróbuj ponownie." }, 502, origin);
    const textBlock = (data.content || []).find((b: { type: string }) => b.type === "text");
    if (!textBlock) return json({ error: "Pusta odpowiedź modelu." }, 502, origin);

    let parsed: { language?: string; script?: string; fallback?: boolean; translations?: Array<{ i: number; t: string }> };
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return json({ error: "Nie udało się sparsować tłumaczenia." }, 502, origin);
    }
    // by index, so a skipped item never shifts the rest; "" = left untranslated
    const translations = strings.map(() => "");
    for (const it of parsed.translations || []) {
      if (Number.isInteger(it.i) && it.i >= 0 && it.i < strings.length && typeof it.t === "string") translations[it.i] = it.t.trim();
    }
    return json({
      language: parsed.language || target,
      script: SCRIPTS.includes(parsed.script || "") ? parsed.script : "latin",
      fallback: parsed.fallback === true,
      translations,
    }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
