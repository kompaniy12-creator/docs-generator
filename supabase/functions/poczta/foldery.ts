// Poczta — which folder of a kind the portal uses. A mailbox often has several folders of the same kind
// ("Sent", "SENT", "Sent Messages" — every mail program made its own). The administrator may choose one per
// kind in the settings; without a choice the portal takes the one with the NEWEST message, i.e. the one the
// staff's mail program is using now, so that sent mail and deleted mail stay where people look for them.

import { type Folder, type Meta, nieWybieralny, typFolderu } from "./imap.ts";

export const TYPY = ["sent", "drafts", "trash", "junk", "archive"] as const;
export type Typ = typeof TYPY[number];
export const NAZWY: Record<string, string> = { inbox: "Odebrane", sent: "Wysłane", drafts: "Robocze", trash: "Kosz", junk: "Spam", archive: "Archiwum" };
type Czyta = { examine(box?: string): Promise<{ exists: number }>; meta(set: { od: number; do: number }, uidMode: boolean, naglowki: boolean, struktura?: boolean): Promise<Meta[]> };
const pamiec = new Map<string, { raw: string; do: number }>(); // per running instance, one hour

export const dataImap = (s: string) => { const t = Date.parse(s.replace(/^\s*(\d{1,2})-(\w{3})-(\d{4}) /, "$1 $2 $3 ")); return Number.isFinite(t) ? t : 0; };
// when the newest message of a folder arrived (0 = empty or unreadable)
export async function ostatnia(im: Czyta, f: Folder): Promise<number> {
  try { const ex = await im.examine(f.raw); if (!ex.exists) return 0; return dataImap((await im.meta({ od: ex.exists, do: ex.exists }, false, false, false))[0]?.internaldate ?? ""); }
  catch { return 0; }
}
export const kandydaci = (list: Folder[], typ: string) => list.filter((f) => !nieWybieralny(f) && typFolderu(f) === typ);
export async function folderPortalu(im: Czyta, list: Folder[], klucz: string, typ: Typ, wybrany: string | undefined, now: number): Promise<Folder | null> {
  const k = kandydaci(list, typ);
  if (!k.length) return null;
  const cfg = wybrany ? k.find((f) => f.raw === wybrany) : null; // the configured one, as long as it still exists and is of that kind
  if (cfg) return cfg;
  if (k.length === 1) return k[0];
  const c = pamiec.get(klucz + ":" + typ), hit = c && c.do > now ? k.find((f) => f.raw === c.raw) : null;
  if (hit) return hit;
  let best = k[0], bestT = -1;
  for (const f of k) {
    const t = await ostatnia(im, f), flaga = f.flagi.some((x) => x.toLowerCase() === "\\" + typ) ? 1 : 0;
    if (t + flaga > bestT) { best = f; bestT = t + flaga; } // equal dates: the server's own special-use folder wins
  }
  pamiec.set(klucz + ":" + typ, { raw: best.raw, do: now + 3600000 });
  return best;
}
export const zapomnij = () => pamiec.clear();
