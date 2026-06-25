// AI worker-data extraction for the public employee intake form.
// Reads uploaded Polish identity documents (dowód osobisty / paszport / karta
// pobytu) with Claude Opus 4.8 vision + structured outputs and returns the
// zleceniobiorca's personal + address fields as validated JSON.
//
// PUBLIC endpoint (called from the client-facing form, no portal auth). The
// Anthropic key lives only in the ANTHROPIC_API_KEY secret — never exposed.
// Guards: max files / total size, image+pdf only.

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-opus-4-8";
const MAX_FILES = 6;
const MAX_TOTAL_B64 = 9 * 1024 * 1024; // ~6.7 MB of binary across all files
const OK_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

// Field schema — keys mirror the form input ids so the client can map 1:1.
const FIELDS = [
  "p_imiona", "p_nazwisko", "p_pesel", "p_dataur", "p_miejsceur",
  "p_obywatelstwo", "p_doc_typ", "p_dowod",
  "a_ulica", "a_nrdom", "a_nrmiesz", "a_kod", "a_miejscowosc", "a_gmina", "a_powiat", "a_wojewodztwo",
  // document validity end dates (ISO yyyy-mm-dd) — for expiry monitoring
  "p_karta_do", "p_paszport_do", "p_zezwolenie_do", "p_badania_do",
];
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...Object.fromEntries(FIELDS.map((k) => [k, { type: "string" }])),
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [...FIELDS, "warnings"],
};

const INSTRUCTION = `Jesteś asystentem kadrowym. Z załączonych zdjęć/skanów polskich dokumentów tożsamości (dowód osobisty, paszport, karta pobytu) odczytaj dane osoby i zwróć je w polach.

Zasady:
- Użyj pustego ciągu "" dla pól, których nie ma na dokumencie.
- p_dataur: format ISO RRRR-MM-DD.
- p_pesel: 11 cyfr (jeśli widoczny; karta pobytu/paszport zwykle nie mają PESEL).
- p_doc_typ: dokładnie jedna z wartości "dowód osobisty", "paszport", "karta pobytu".
- p_dowod: seria i numer dokumentu.
- p_obywatelstwo: po polsku (np. "polskie", "ukraińskie").
- Adres (a_*) wypełnij tylko jeśli jest na dokumencie (dowód osobisty czasem nie zawiera adresu).
- imiona/nazwisko/miejscowości zapisz poprawną polską pisownią z polskimi znakami.
- DATY WAŻNOŚCI (format ISO RRRR-MM-DD), odczytaj jeśli widoczne na dokumentach:
  • p_karta_do — data ważności karty pobytu ("ważna do" / "termin ważności"),
  • p_paszport_do — data ważności paszportu ("date of expiry" / "data ważności"),
  • p_zezwolenie_do — data końca zezwolenia na pracę / wizy / decyzji / oświadczenia o powierzeniu pracy,
  • p_badania_do — data ważności orzeczenia lekarskiego / badań (medkomisja / BHP).
  Pozostaw "" jeśli dany dokument lub data nie występuje.
- Do "warnings" dodaj uwagi o nieczytelnych lub niespójnych danych (np. PESEL nie zgadza się z datą urodzenia).`;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!ANTHROPIC_KEY) return json({ error: "Brak konfiguracji ANTHROPIC_API_KEY." }, 500, origin);

  let payload: { docType?: string; files?: Array<{ mime?: string; data?: string }> };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Nieprawidłowy JSON." }, 400, origin);
  }
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!files.length) return json({ error: "Brak plików." }, 400, origin);
  if (files.length > MAX_FILES) return json({ error: `Za dużo plików (max ${MAX_FILES}).` }, 400, origin);

  let total = 0;
  const blocks: unknown[] = [];
  for (const f of files) {
    const mime = (f.mime || "").toLowerCase();
    const data = f.data || "";
    if (!OK_MIME.has(mime)) return json({ error: `Nieobsługiwany format: ${mime}` }, 400, origin);
    total += data.length;
    if (total > MAX_TOTAL_B64) return json({ error: "Pliki są za duże." }, 413, origin);
    if (mime === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: mime, data } });
    } else {
      blocks.push({ type: "image", source: { type: "base64", media_type: mime, data } });
    }
  }
  blocks.push({ type: "text", text: INSTRUCTION + `\n\nWskazówka: typ dokumentu zgłoszony przez użytkownika: ${payload.docType || "(nieznany)"}.` });

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
        max_tokens: 2048,
        messages: [{ role: "user", content: blocks }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("Anthropic error", res.status, errText);
      return json({ error: "Błąd modelu (" + res.status + ")." }, 502, origin);
    }
    const data = await res.json();
    if (data.stop_reason === "refusal") {
      return json({ error: "Model odmówił przetworzenia dokumentów." }, 422, origin);
    }
    const textBlock = (data.content || []).find((b: { type: string }) => b.type === "text");
    if (!textBlock) return json({ error: "Pusta odpowiedź modelu." }, 502, origin);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return json({ error: "Nie udało się sparsować danych." }, 502, origin);
    }
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    const fields: Record<string, string> = {};
    for (const k of FIELDS) {
      const v = parsed[k];
      if (typeof v === "string" && v.trim() !== "") fields[k] = v.trim();
    }
    return json({ fields, warnings }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500, origin);
  }
});
