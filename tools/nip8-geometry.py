#!/usr/bin/env python3
"""Re-measure the NIP-8 field geometry used by nip-8.js.

The generator draws onto the official blank (nip-8-template.pdf), so every
coordinate must come from that file. Run this after replacing the template with
a newer version of the form (e.g. NIP-8(5)) and paste the printed T / C / K
tables into nip-8.js.

    uv run --with pymupdf python tools/nip8-geometry.py nip-8-template.pdf [geom.json]

Source of the blank: podatki-arch.mf.gov.pl/media/10330/form-nip-8.pdf (NIP-8(4)).
"""
import json, sys
import pymupdf

doc = pymupdf.open(sys.argv[1])
H = doc[0].rect.height
RIGHT_FRAME = 568.0

# ---- position -> (page, first word of the label) ----
TEXT = {
    5:  (0, "Naczelnik"), 6: (0, "Nazwa"), 7: (0, "Nazwa"),
    8:  (0, "Numer"), 9: (0, "Numer"),
    14: (0, "Telefon"), 16: (0, "Faks"), 18: (0, "E-mail"),
    34: (1, "Kraj"), 35: (1, "Województwo"), 36: (1, "Powiat"),
    37: (1, "Gmina"), 38: (1, "Ulica"), 39: (1, "Nr"), 40: (1, "Nr"),
    41: (1, "Kod"), 42: (1, "Miejscowość"), 43: (1, "Określenie"),
    46: (1, "Nazwa"),
    47: (1, "Kraj"), 48: (1, "Województwo"), 49: (1, "Powiat"),
    50: (1, "Gmina"), 51: (1, "Ulica"), 52: (1, "Nr"), 53: (1, "Nr"),
    54: (1, "Kod"), 55: (1, "Miejscowość"),
    56: (1, "Kraj"), 57: (1, "Kod"), 60: (1, "Kraj"), 61: (1, "Kod"),
    94: (3, "Imię"), 95: (3, "Nazwisko"), 96: (3, "Podpis"),
    98: (3, "Imię"), 99: (3, "Nazwisko"), 100: (3, "Podpis"),
}
# positions whose text belongs at the TOP of a tall merged cell (signature boxes)
TOP_ALIGNED = {96, 100}

# position -> (page, hint x0, hint bottom y in pdf-lib space, expected cell count)
COMB = {
    1:  (0,  74.8, 779.5, 10),   # NIP składającego
    45: (1,  59.9, 501.1, 10),   # NIP biura rachunkowego
    58: (1, 442.7, 309.4, 3),    # waluta rachunku 1
    62: (1, 442.7, 242.9, 3),    # waluta rachunku 2
    97: (3, 124.7, 474.5, 11),   # NIP/PESEL osoby 1
    101:(3, 124.7, 426.4, 11),   # NIP/PESEL osoby 2
}
# multi-group combs: position -> (page, hint bottom y, [hint x0 of each group])
COMB_GROUPS = {
    59: (1, 285.5, [142.8, 180.9, 238.1, 295.4, 352.6, 409.9, 467.0]),  # IBAN rach. 1
    63: (1, 220.1, [99.5, 137.4, 194.7, 251.9, 309.2, 366.5, 423.7]),   # IBAN rach. 2
    93: (3, 522.6, [238.0, 275.0, 312.0]),                              # data: dd mm rrrr
}
GROUP_CELLS = {59: [2, 4, 4, 4, 4, 4, 4], 63: [2, 4, 4, 4, 4, 4, 4], 93: [2, 2, 4]}

# name -> (page, hint cx, hint cy in pdf-lib space)
CHECK = {
    "p4_identyfikacyjne": (0,  69.8, 533.6),
    "p4_aktualizacyjne":  (0, 315.7, 533.6),
    "p13_tak":            (0, 110.9, 289.6),
    "p13_nie":            (0, 157.6, 289.6),
    "p32_tak":            (1, 265.2, 728.1),
    "p32_nie":            (1, 329.3, 728.1),
    "p33_prowadzenie":    (1, 112.9, 704.1),
    "p33_zakonczenie":    (1, 334.5, 704.1),
    "p44_biuro":          (1, 163.0, 562.7),
    "p44_wlasny":         (1, 379.0, 562.7),
    "p64_likwidacja":     (1, 522.8, 226.9),
    "p92_pelnomocnictwo": (3, 296.0, 609.1),
}

def page_rules(p):
    h, v = [], []
    for d in p.get_drawings():
        r, fill = d["rect"], d.get("fill")
        if fill is None or max(fill) >= 0.5:
            continue
        if r.height <= 2.2 and r.width >= 25: h.append((r.y0, r.x0, r.x1))
        if r.width <= 2.2 and r.height >= 8:  v.append((r.x0, r.y0, r.y1))
    return h, v

def glyphs(p, chars):
    out = []
    for b in p.get_text("rawdict")["blocks"]:
        for l in b.get("lines", []):
            for s in l.get("spans", []):
                run = None
                for c in s["chars"]:
                    if c["c"] in chars:
                        if run is None: run = list(c["bbox"])
                        else:
                            run[2] = max(run[2], c["bbox"][2]); run[3] = max(run[3], c["bbox"][3])
                    elif run:
                        out.append(run); run = None
                if run: out.append(run); run = None
    return out

fields, combs, checks = {}, {}, {}

for num, (pi, firstword) in TEXT.items():
    p = doc[pi]; words = p.get_text("words"); tok = f"{num}."
    label = None
    for w in (w for w in words if w[4] == tok):
        nxt = sorted([t for t in words if abs(t[1] - w[1]) < 3 and w[2] - 0.5 < t[0] < w[2] + 12],
                     key=lambda t: t[0])
        if nxt and nxt[0][4] == firstword:
            label = w; break
    if label is None:
        raise SystemExit(f"label {num} not found")
    lx0, ly1 = label[0], label[3]
    hr, vr = page_rules(p)
    below = [h for h in hr if h[0] >= ly1 + 2 and h[1] <= lx0 + 2 <= h[2]]
    ybot = min(below)[0] if below else ly1 + 22
    right = [v[0] for v in vr if v[0] > label[2] + 2 and v[1] <= ybot - 2
             and v[2] >= ly1 + 2 and v[0] < RIGHT_FRAME - 1]
    xr = min(right) if right else RIGHT_FRAME
    y = H - (ly1 + 11) if num in TOP_ALIGNED else H - (ybot - 4.5)
    fields[num] = {"p": pi, "x": round(lx0 + 1.5, 1), "y": round(y, 1), "w": round(xr - lx0 - 5, 1)}

for num, (pi, hx, hy, cells) in COMB.items():
    runs = glyphs(doc[pi], "└┴┘─⏊")
    best = min(runs, key=lambda r: abs(r[0] - hx) + abs((H - r[3]) - hy) * 3)
    combs[num] = {"p": pi, "x0": round(best[0], 1), "x1": round(best[2], 1),
                  "y": round(H - best[3] + 1.5, 1), "n": cells}

for num, (pi, hy, hxs) in COMB_GROUPS.items():
    runs = [r for r in glyphs(doc[pi], "└┴┘─⏊") if abs((H - r[3]) - hy) < 3]
    groups = []
    for hx, n in zip(hxs if len(hxs) == len(GROUP_CELLS[num]) else hxs[1:], GROUP_CELLS[num]):
        best = min(runs, key=lambda r: abs(r[0] - hx))
        groups.append({"x0": round(best[0], 1), "x1": round(best[2], 1), "n": n})
    combs[num] = {"p": pi, "y": round(H - (hy * -1 + 2 * hy) + 1.5, 1), "groups": groups}
    combs[num]["y"] = round(hy + 1.5, 1)

for name, (pi, hx, hy) in CHECK.items():
    boxes = glyphs(doc[pi], "❑")
    best = min(boxes, key=lambda b: abs((b[0] + b[2]) / 2 - hx) + abs((H - (b[1] + b[3]) / 2) - hy))
    checks[name] = {"p": pi, "cx": round((best[0] + best[2]) / 2, 1),
                    "cy": round(H - (best[1] + best[3]) / 2, 1)}

GEOM = {"pageH": round(H, 2), "text": fields, "comb": combs, "check": checks}
if len(sys.argv) > 2:  # optional: dump the raw geometry for other tooling
    json.dump(GEOM, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)

# ---- printed as JS, ready to paste into nip-8.js ----
def _emit(g):
    n = lambda v: ('%g' % v)
    print('const T = { // labelled boxes: [page, x, baselineY, maxWidth]')
    for k in sorted(g['text'], key=int):
        f = g['text'][k]
        print(f"  {k}: [{f['p']}, {n(f['x'])}, {n(f['y'])}, {n(f['w'])}],")
    print('};')
    print('const C = { // character combs: [page, baselineY, [[x0, x1, cells], ...]]')
    for k in sorted(g['comb'], key=int):
        c = g['comb'][k]
        gs = (', '.join(f"[{n(x['x0'])}, {n(x['x1'])}, {x['n']}]" for x in c['groups'])
              if 'groups' in c else f"[{n(c['x0'])}, {n(c['x1'])}, {c['n']}]")
        print(f"  {k}: [{c['p']}, {n(c['y'])}, [{gs}]],")
    print('};')
    print('const K = { // checkbox squares: [page, centreX, centreY]')
    for k, c in g['check'].items():
        print(f"  {k}: [{c['p']}, {n(c['cx'])}, {n(c['cy'])}],")
    print('};')

_emit(GEOM)
