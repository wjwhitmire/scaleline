"""Auto-takeoff: walls, rooms, doors, windows and repeated symbols found in a sheet's line work.

Deterministic geometry, no model. Input is the sheet's line work in sheet points (origin top left,
y down), as the browser reads it from the PDF's drawing operators (or from line detection on a
scanned sheet), plus the sheet's text and scale. Every result is a suggestion with a confidence
and a "why"; nothing becomes a markup until the person accepts it.

Methods and limits:
  walls    two parallel lines (within 1 degree) a wall thickness apart (2.5 to 16 in at the sheet
           scale) that run together for at least 2 ft and 2.5 times the thickness. Each line pairs
           with its nearest partner first. Pieces in line with the same thickness are joined across
           corner gaps (up to 1.6 times the thickness) and across door and window openings found
           here (on a scan, where door swings are not read, gaps up to bridge_in, such as 48 in,
           are taken as openings). Ends are carried to where they meet another wall's centerline.
           A wall drawn as three or more lines (veneer plus studs) is read as two walls.
  windows  a line between and parallel to two wall faces, closed by jamb lines across the wall.
  doors    an arc (25 to 100 degrees, so doors drawn part open count; 18 to 48 in radius) with a straight leaf from the arc
           center to one arc end. Arcs are Bezier curves or chains of short lines. Two leaves that
           close on the same point are one pair of doors. Door tags are read when they have a letter
           (D1, 101A); a tag of digits alone cannot be told from a room number and is not read.
  rooms    closed faces of the wall centerline graph, at least 16 SF, and not a sliver (twice the
           area over the perimeter at least 18 in). The clear area
           insets each edge by half its wall's thickness. Named from the largest text inside (a
           name set on two or three stacked lines is joined) and numbered from a number inside.
  symbols  small connected clusters of lines and curves (3 to 40 pt across; a part drawn inside another
           belongs to it; dimension lines with their ticks are left out) with the same shape in
           any of the 8 quarter-turn and mirror orientations, three or more alike. A copy with a
           label starting within two symbol sizes of it, outside every room, is read as a legend
           entry: its label names the group and the copy is not counted.
  types    walls are grouped by thickness, line weight, hatch, fill and whether they are on the
           outline of the rooms (outside walls); rules the person edits map
           each group to a tool chest preset (first rule that matches wins).
Pure functions, no I/O. The browser core (web/src/core/23_autotakeoff.js) gives the same results.
"""

from __future__ import annotations

import math
import re

from .errors import TakeoffError

PAR = 0.0175  # sin of 1 degree: two directions closer than this are parallel
PERP = 0.0175  # cos of 89 degrees: two directions with a dot product under this are perpendicular
DEFAULT_IPP = 48 / 72  # 1/4" = 1'-0": assumed for the size limits when a sheet has no scale
LIMITS = {"segs": 60000, "curves": 20000, "text": 20000, "walls": 3000}
DEFAULTS = {
    "wall_min_in": 2.5, "wall_max_in": 16.0, "wall_min_len_in": 24.0,
    "door_min_in": 18.0, "door_max_in": 48.0,
    "window_min_in": 12.0, "window_max_in": 144.0,
    "room_min_sf": 16.0, "room_min_width_in": 18.0,
    "symbol_min_pt": 3.0, "symbol_max_pt": 40.0, "symbol_min_count": 3,
    "bridge_in": 0.0,
}
HATCH = ("any", "yes", "no")
DEFAULT_RULES = [
    {"id": "ext-outline", "name": "Exterior wall", "preset": "p-ext-wall", "min_in": 0, "max_in": 1e9, "min_weight": 0,
     "max_weight": 1e9, "hatch": "any", "fill": "any", "outer": "yes"},
    {"id": "ext-hatched", "name": "Exterior wall", "preset": "p-ext-wall", "min_in": 0, "max_in": 1e9, "min_weight": 0,
     "max_weight": 1e9, "hatch": "yes", "fill": "any", "outer": "any"},
    {"id": "int", "name": "Interior partition", "preset": "p-int-wall", "min_in": 0, "max_in": 1e9, "min_weight": 0,
     "max_weight": 1e9, "hatch": "any", "fill": "any", "outer": "any"},
]
DIM_TEXT = re.compile(r"^\s*\d+\s*'\s*(-?\s*\d+(\s+\d+/\d+)?\s*\"?)?\s*$|^\s*\d+(\s+\d+/\d+)?\s*\"\s*$|^\s*\d+'?-\d+")
AREA_TEXT = re.compile(r"^\s*[\d,.]+\s*(SF|S\.F\.|SQ\.?\s*FT\.?|M2)\s*$", re.I)
DOOR_TAG = re.compile(r"^(D-?\d{1,3}[A-Z]?|\d{1,4}[A-Z])$")
ROOM_NO = re.compile(r"^[A-Z]?\d{1,4}$")
LEGEND_WORDS = re.compile(r"^(LEGEND|SYMBOLS?|SYMBOL LEGEND|KEY|NOTES?|GENERAL NOTES)\s*:?$", re.I)


def _rnd(x):
    """Round half up, like JavaScript Math.round."""
    return float(math.floor(x + 0.5))


def _r6(x):
    return _rnd(x * 1e6) / 1e6


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _len(dx, dy):
    return math.sqrt(dx * dx + dy * dy)


# ------------------------------------------------------------------ input


def _clean_page(page):
    if not isinstance(page, dict):
        raise TakeoffError("input", "The sheet must be an object with its line work")
    w, h = page.get("w"), page.get("h")
    if not (_num(w) and _num(h) and w > 0 and h > 0):
        raise TakeoffError("input", "The sheet needs its width and height in points")
    segs = []
    for s in (page.get("segs") or [])[:LIMITS["segs"]] if isinstance(page.get("segs"), list) else []:
        if not isinstance(s, list) or len(s) < 4 or not all(_num(v) for v in s[:4]):
            continue
        x0, y0, x1, y1 = float(s[0]), float(s[1]), float(s[2]), float(s[3])
        lw = float(s[4]) if len(s) > 4 and _num(s[4]) and s[4] >= 0 else 0.0
        fill = 1 if len(s) > 5 and not isinstance(s[5], bool) and s[5] == 1 else 0
        dx, dy = x1 - x0, y1 - y0
        if dx < 0 or (dx == 0 and dy < 0):
            x0, y0, x1, y1, dx, dy = x1, y1, x0, y0, -dx, -dy
        L = _len(dx, dy)
        if L < 0.5:
            continue
        segs.append({"i": len(segs), "a": (x0, y0), "b": (x1, y1), "u": (dx / L, dy / L), "L": L, "w": lw, "f": fill})
    curves = []
    for c in (page.get("curves") or [])[:LIMITS["curves"]] if isinstance(page.get("curves"), list) else []:
        if not isinstance(c, list) or len(c) < 8 or not all(_num(v) for v in c[:8]):
            continue
        lw = float(c[8]) if len(c) > 8 and _num(c[8]) and c[8] >= 0 else 0.0
        curves.append({"i": len(curves), "p": [(float(c[k]), float(c[k + 1])) for k in (0, 2, 4, 6)], "w": lw})
    text = []
    for it in (page.get("text") or [])[:LIMITS["text"]] if isinstance(page.get("text"), list) else []:
        if isinstance(it, dict) and isinstance(it.get("str"), str) and all(_num(it.get(k)) for k in ("x", "y", "w", "h")):
            text.append(it)
    ipp = page.get("in_per_pt")
    ipp = float(ipp) if _num(ipp) and ipp > 0 else None
    return float(w), float(h), segs, curves, text, ipp


def drawing_area(segs, w, h):
    """The part of the sheet inside its border and left of (or above) its title block strip: tall
    lines that run most of the sheet's height near its sides, and wide lines near its top and bottom.
    segs as in auto_takeoff. Returns [x0, y0, x1, y1] in sheet points."""
    x0, y0, x1, y1 = 0.0, 0.0, w, h
    for s in segs:
        a, b = s[:2], s[2:4]
        dx, dy = abs(b[0] - a[0]), abs(b[1] - a[1])
        if dx <= PAR * dy and dy >= 0.8 * h and min(a[1], b[1]) <= 0.15 * h and max(a[1], b[1]) >= 0.85 * h:
            x = (a[0] + b[0]) / 2
            if x >= 0.6 * w:
                x1 = min(x1, x)
            elif x <= 0.4 * w:
                x0 = max(x0, x)
        elif dy <= PAR * dx and dx >= 0.8 * w and min(a[0], b[0]) <= 0.15 * w and max(a[0], b[0]) >= 0.85 * w:
            y = (a[1] + b[1]) / 2
            if y >= 0.6 * h:
                y1 = min(y1, y)
            elif y <= 0.4 * h:
                y0 = max(y0, y)
    return [x0, y0, x1, y1]


# ------------------------------------------------------------------ text lines


def text_lines(items):
    """Items grouped into lines (similar baseline, left to right), as the title block reader does.
    Items marked vertical (text turned with the sheet) each stay a line of their own."""
    its = []
    for it in items or []:
        if not isinstance(it, dict) or not isinstance(it.get("str"), str):
            continue
        s = re.sub(r"\s+", " ", it["str"]).strip()
        if not s or len(s) > 300:
            continue
        nums = [it.get(k) for k in ("x", "y", "w", "h")]
        if not all(_num(v) for v in nums):
            continue
        its.append({"str": s, "x": float(nums[0]), "y": float(nums[1]), "w": max(0.0, float(nums[2])), "h": max(0.0, float(nums[3])),
                    "v": it.get("vertical") is True})
    its.sort(key=lambda a: (a["y"], a["x"]))
    lines = []
    for it in its:
        tol = max(1.5, it["h"] * 0.4)
        line = None
        for ln in lines if not it["v"] else []:  # turned text keeps to its own line
            if ln["v"]:
                continue
            if abs(ln["y"] - it["y"]) <= tol and it["x"] >= ln["x1"] - it["h"] * 0.5 and it["x"] - ln["x1"] < min(it["h"], ln["h"]) * 2.5:
                line = ln
                break
        if line is None:
            line = {"y": it["y"], "x0": it["x"], "x1": it["x"] + it["w"], "h": it["h"], "parts": [], "v": it["v"]}
            lines.append(line)
        line["parts"].append(it)
        line["x1"] = max(line["x1"], it["x"] + it["w"])
        line["x0"] = min(line["x0"], it["x"])
        line["h"] = max(line["h"], it["h"])
    out = []
    for ln in lines:
        ln["parts"].sort(key=lambda p: p["x"])
        s = ""
        last = None
        for p in ln["parts"]:
            if last is not None and p["x"] - last > p["h"] * 0.15:
                s += " "
            s += p["str"]
            last = p["x"] + p["w"]
        out.append({"str": re.sub(r"\s+", " ", s).strip(), "x": ln["x0"], "y": ln["y"], "w": ln["x1"] - ln["x0"], "h": ln["h"]})
    return out


# ------------------------------------------------------------------ spatial grid


class _Grid:
    """Items registered in every cell their box touches; long items past the cap go in a list
    that every query returns."""

    def __init__(self, cell, cap=4000):
        self.cell, self.cap, self.cells, self.wide = cell, cap, {}, []

    def add(self, idx, x0, y0, x1, y1):
        c = self.cell
        i0, i1 = math.floor(x0 / c), math.floor(x1 / c)
        j0, j1 = math.floor(y0 / c), math.floor(y1 / c)
        if (i1 - i0 + 1) * (j1 - j0 + 1) > self.cap:
            self.wide.append(idx)
            return
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                self.cells.setdefault(i * 1000003 + j, []).append(idx)

    def query(self, x0, y0, x1, y1):
        c = self.cell
        out = set(self.wide)
        i0, i1 = math.floor(x0 / c), math.floor(x1 / c)
        j0, j1 = math.floor(y0 / c), math.floor(y1 / c)
        if (i1 - i0 + 1) * (j1 - j0 + 1) > self.cap * 4:
            for v in self.cells.values():
                out.update(v)
            return sorted(out)
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                v = self.cells.get(i * 1000003 + j)
                if v:
                    out.update(v)
        return sorted(out)


def _seg_box(s, pad):
    return (min(s["a"][0], s["b"][0]) - pad, min(s["a"][1], s["b"][1]) - pad, max(s["a"][0], s["b"][0]) + pad,
            max(s["a"][1], s["b"][1]) + pad)


def _frame(s, p):
    """(along, offset) of point p in segment s's frame (origin at s.a, along s.u, offset along the normal)."""
    dx, dy = p[0] - s["a"][0], p[1] - s["a"][1]
    return dx * s["u"][0] + dy * s["u"][1], -dx * s["u"][1] + dy * s["u"][0]


def _parallel(s, t):
    return abs(s["u"][0] * t["u"][1] - s["u"][1] * t["u"][0]) <= PAR


def _perp(s, t):
    return abs(s["u"][0] * t["u"][0] + s["u"][1] * t["u"][1]) <= PERP


def _relation(s, t):
    """t seen from s: (offset, along0, along1, spread) or None when not parallel."""
    if not _parallel(s, t):
        return None
    a0, o0 = _frame(s, t["a"])
    a1, o1 = _frame(s, t["b"])
    return (o0 + o1) / 2, min(a0, a1), max(a0, a1), abs(o0 - o1)


# ------------------------------------------------------------------ windows


def _windows(segs, grid, lim):
    tmin, tmax = lim["tmin"], lim["tmax"]
    wmin, wmax = lim["window_min"], lim["window_max"]
    found = []
    glass = set()
    for g in segs:
        if g["L"] < wmin or g["L"] > wmax:
            continue
        x0, y0, x1, y1 = _seg_box(g, tmax)
        best = {1: None, -1: None}
        for j in grid.query(x0, y0, x1, y1):
            if j == g["i"]:
                continue
            t = segs[j]
            rel = _relation(g, t)
            if rel is None:
                continue
            off, a0, a1, spread = rel
            if spread > 0.25 + 0.05 * abs(off) or abs(off) < tmin * 0.25 or abs(off) > tmax:
                continue
            ov = min(g["L"], a1) - max(0.0, a0)
            if ov < 0.8 * g["L"]:
                continue
            side = 1 if off > 0 else -1
            cur = best[side]
            if cur is None or abs(off) < abs(cur[0]) or (abs(off) == abs(cur[0]) and j < cur[1]):
                best[side] = (off, j)
        if best[1] is None or best[-1] is None:
            continue
        oa, ob = best[-1][0], best[1][0]
        width = ob - oa
        if width < tmin or width > tmax:
            continue
        if min(-oa, ob) / max(-oa, ob) < 0.25:
            continue
        tol = max(1.5, 0.1 * g["L"])
        jambs = []
        for end in (0.0, g["L"]):
            hit = None
            for j in grid.query(*_seg_box(g, tmax)):
                t = segs[j]
                if j == g["i"] or not _perp(g, t):
                    continue
                a0, o0 = _frame(g, t["a"])
                a1, o1 = _frame(g, t["b"])
                if abs((a0 + a1) / 2 - end) > tol:
                    continue
                lo, hi = min(o0, o1), max(o0, o1)
                cover = min(hi, ob) - max(lo, oa)
                if cover >= 0.7 * width:
                    hit = j
                    break
            jambs.append(hit)
        n = sum(1 for j in jambs if j is not None)
        jamb_segs = [j for j in jambs if j is not None]
        if n == 0:
            continue
        mid = ((g["a"][0] + g["b"][0]) / 2, (g["a"][1] + g["b"][1]) / 2)
        dup = False
        for f in found:
            if abs(f["u"][0] * g["u"][1] - f["u"][1] * g["u"][0]) <= PAR and _len(f["c"][0] - mid[0], f["c"][1] - mid[1]) < 0.5 * f["L"]:
                dup = True
                break
        if dup:
            glass.add(g["i"])
            continue
        found.append({"c": mid, "u": g["u"], "L": g["L"], "t": width, "jambs": n, "glass": g["i"], "jamb_segs": jamb_segs,
                      "faces": (best[-1][1], best[1][1]), "a": g["a"], "b": g["b"]})
        glass.add(g["i"])
    return found, glass


# ------------------------------------------------------------------ doors


def _circle(a, b, c):
    ax, ay = a
    bx, by = b[0] - ax, b[1] - ay
    cx, cy = c[0] - ax, c[1] - ay
    d = 2 * (bx * cy - by * cx)
    if abs(d) < 1e-9:
        return None
    b2, c2 = bx * bx + by * by, cx * cx + cy * cy
    ux = (cy * b2 - by * c2) / d
    uy = (bx * c2 - cx * b2) / d
    return (ax + ux, ay + uy), _len(ux, uy)


def _bez(p, t):
    m = 1 - t
    a, b, c, d = m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t
    return (a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1])


def _arc_from_points(pts):
    """A circular arc through a run of points, or None: (center, radius, start, end, cos of sweep, cross sign)."""
    a, m, b = pts[0], pts[len(pts) // 2], pts[-1]
    circ = _circle(a, m, b)
    if circ is None:
        return None
    c, r = circ
    for p in pts:
        if abs(_len(p[0] - c[0], p[1] - c[1]) - r) > 0.004 * r + 0.05:
            return None
    va, vb, vm = (a[0] - c[0], a[1] - c[1]), (b[0] - c[0], b[1] - c[1]), (m[0] - c[0], m[1] - c[1])
    cosw = (va[0] * vb[0] + va[1] * vb[1]) / (r * r)
    # the middle point must lie on the short way round (sweeps up to 180 degrees)
    if (va[0] * vm[0] + va[1] * vm[1]) / (r * r) < cosw - 1e-9:
        return None
    return {"c": c, "r": r, "p0": a, "p1": b, "cos": cosw}


def _arcs(curves, segs, lim):
    out = []
    for cv in curves:
        p = cv["p"]
        pts = [_bez(p, t) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
        arc = _arc_from_points(pts)
        if arc:
            arc["src"] = ("c", cv["i"])
            out.append(arc)
    # chains of short lines that follow a circle (arcs exported as polylines)
    rmax = lim["door_max"]
    short = [s for s in segs if s["L"] <= rmax * 0.45]
    ends = {}
    for s in short:
        for key in (s["a"], s["b"]):
            ends.setdefault((_rnd(key[0] * 4), _rnd(key[1] * 4)), []).append(s["i"])
    used = set()
    for s in short:
        if s["i"] in used:
            continue
        ka, kb = (_rnd(s["a"][0] * 4), _rnd(s["a"][1] * 4)), (_rnd(s["b"][0] * 4), _rnd(s["b"][1] * 4))
        if len(ends.get(ka, [])) == 2 and len(ends.get(kb, [])) == 2:
            continue  # start chains at an end
        chain = [s["i"]]
        pts = [s["a"], s["b"]] if len(ends.get(ka, [])) != 2 else [s["b"], s["a"]]
        cur = (_rnd(pts[-1][0] * 4), _rnd(pts[-1][1] * 4))
        seen = {s["i"]}
        while len(chain) < 400:
            nxt = [j for j in ends.get(cur, []) if j not in seen]
            if len(nxt) != 1 or len(ends.get(cur, [])) != 2:
                break
            t = segs[nxt[0]]
            seen.add(t["i"])
            chain.append(t["i"])
            far = t["b"] if (_rnd(t["a"][0] * 4), _rnd(t["a"][1] * 4)) == cur else t["a"]
            pts.append(far)
            cur = (_rnd(far[0] * 4), _rnd(far[1] * 4))
        if len(chain) < 4:
            continue
        # split the chain into the longest runs that follow one circle (a pair of doors meets in
        # the middle; a jamb line can continue a chain past an arc's end): longest runs first
        runs = []
        for i in range(len(pts) - 4):
            j = i + 4
            if _arc_from_points(pts[i:j + 1]) is None:
                continue
            while j + 1 < len(pts) and _arc_from_points(pts[i:j + 2]) is not None:
                j += 1
            runs.append((j - i, i, j))
        runs.sort(key=lambda r: (-r[0], r[1]))
        taken = []
        for _, i, j in runs:
            if any(i < b and a < j for a, b in taken):
                continue
            taken.append((i, j))
            arc = _arc_from_points(pts[i:j + 1])
            arc["src"] = ("s", tuple(chain[i:j]))
            used.update(chain[i:j])
            out.append(arc)

    # join arcs that continue each other (a quarter circle drawn as two curves)
    joined = []
    taken = set()
    for i, a in enumerate(out):
        if i in taken:
            continue
        cur = dict(a)
        for j in range(i + 1, len(out)):
            if j in taken:
                continue
            b = out[j]
            if a["cos"] < 0.7 or b["cos"] < 0.7:
                continue  # only arcs of 45 degrees or less are joined (a door drawn in two curves)
            if _len(a["c"][0] - b["c"][0], a["c"][1] - b["c"][1]) > 0.03 * a["r"] + 0.3 or abs(a["r"] - b["r"]) > 0.03 * a["r"] + 0.3:
                continue
            tol = 0.05 * a["r"] + 0.3
            pairs = ((cur["p1"], b["p0"], cur["p0"], b["p1"]), (cur["p1"], b["p1"], cur["p0"], b["p0"]),
                     (cur["p0"], b["p0"], cur["p1"], b["p1"]), (cur["p0"], b["p1"], cur["p1"], b["p0"]))
            for meet, other_meet, keep, far in pairs:
                if _len(meet[0] - other_meet[0], meet[1] - other_meet[1]) <= tol:
                    c, r = cur["c"], cur["r"]
                    va, vb = (keep[0] - c[0], keep[1] - c[1]), (far[0] - c[0], far[1] - c[1])
                    cur = {"c": c, "r": r, "p0": keep, "p1": far, "cos": (va[0] * vb[0] + va[1] * vb[1]) / (r * r), "src": cur["src"]}
                    taken.add(j)
                    break
        joined.append(cur)
    return joined


def _doors(arcs, segs, grid, text_ls, lim):
    found = []
    used = set()
    for arc in arcs:
        r = arc["r"]
        if r < lim["door_min"] or r > lim["door_max"]:
            continue
        # 60 to 100 degrees: cos between 0.5 and -0.174
        if arc["cos"] > 0.9063 or arc["cos"] < -0.1737:
            continue
        c = arc["c"]
        tol = max(1.5, 0.1 * r)
        leaf = None
        for j in grid.query(c[0] - r - tol, c[1] - r - tol, c[0] + r + tol, c[1] + r + tol):
            s = segs[j]
            if abs(s["L"] - r) > 0.12 * r + 1:
                continue
            for near, far in ((s["a"], s["b"]), (s["b"], s["a"])):
                if _len(near[0] - c[0], near[1] - c[1]) > tol:
                    continue
                for k, tip in ((0, arc["p0"]), (1, arc["p1"])):
                    if _len(far[0] - tip[0], far[1] - tip[1]) <= tol:
                        if leaf is None:
                            leaf = (j, k)
            if leaf is not None:
                break
        if leaf is None:
            continue
        closed = arc["p1"] if leaf[1] == 0 else arc["p0"]
        found.append({"c": c, "r": r, "open": arc["p0"] if leaf[1] == 0 else arc["p1"], "closed": closed, "leaf": leaf[0],
                      "leaves": 1, "src": arc["src"]})
        used.add(leaf[0])
        if arc["src"][0] == "s":
            used.update(arc["src"][1])
    # pairs of doors: two leaves that close on the same point
    out = []
    taken = set()
    for i, d in enumerate(found):
        if i in taken:
            continue
        for j in range(i + 1, len(found)):
            e = found[j]
            if j in taken:
                continue
            tol = max(1.5, 0.1 * d["r"])
            if _len(d["closed"][0] - e["closed"][0], d["closed"][1] - e["closed"][1]) <= tol and abs(d["r"] - e["r"]) <= 0.15 * d["r"] + 1:
                d = dict(d, leaves=2, pair=e)
                taken.add(j)
                break
        out.append(d)
    for d in out:
        if d["leaves"] == 2:
            e = d["pair"]
            d["a"], d["b"] = d["c"], e["c"]
            d["width"] = _len(d["c"][0] - e["c"][0], d["c"][1] - e["c"][1])
        else:
            d["a"], d["b"] = d["c"], d["closed"]
            d["width"] = _len(d["c"][0] - d["closed"][0], d["c"][1] - d["closed"][1])
        d["mid"] = ((d["a"][0] + d["b"][0]) / 2, (d["a"][1] + d["b"][1]) / 2)
        tag = None
        for ln in text_ls:
            if not DOOR_TAG.match(ln["str"]):
                continue
            cx, cy = ln["x"] + ln["w"] / 2, ln["y"] - ln["h"] / 2
            dd = _len(cx - d["mid"][0], cy - d["mid"][1])
            if dd <= 2.5 * d["r"] and (tag is None or dd < tag[1]):
                tag = (ln["str"], dd)
        d["tag"] = tag[0] if tag else ""
    return out, used


# ------------------------------------------------------------------ door swings on scans

SCAN_DOOR_BINS = 30  # angle bins per quarter turn (pseudo-angle, about 3 degrees each)
SCAN_DOOR_LIMITS = {"segs": 20000, "gaps": 4000}


def _ink_buckets(mask, w, h, cell):
    """Ink pixels (x, y) of a 0/1 mask, bucketed in square cells."""
    gw = (w + cell - 1) // cell
    out = {}
    if isinstance(mask, (bytes, bytearray)):
        mb = bytes(mask[:w * h]).translate(bytes([0] + [1] * 255))
    else:
        mb = bytes(1 if v else 0 for v in list(mask)[:w * h])
    for y in range(h):
        row = y * w
        x = mb.find(b"\x01", row, row + w)
        while x != -1:
            px = x - row
            out.setdefault(px // cell + (y // cell) * gw, []).append((px, y))
            x = mb.find(b"\x01", x + 1, row + w)
    return out, gw, mb


def scan_door_arcs(mask, w, h, segs, opts=None):
    """Door swings on a scanned sheet, found in its ink mask (0/1 pixels, row by row).

    A door's hinge sits at a jamb: the end of a wall face line where it stops for an opening. So
    only the gaps between two wall lines in line with each other (an opening r_min*0.9 to
    2*r_max*1.05 wide) are searched. At each end of a gap, on each side of the wall, ink pixels
    vote in a grid of radius (1 px) and angle from the closed position (pseudo-angle bins of about 3
    degrees, out to about 100 degrees): a constrained circular Hough transform for a quarter arc
    from the far jamb. A radius is a swing when its band (+-2 px) holds ink in at least 75% of the
    bins from the closed position to where the arc ends (gaps of up to 5 bins bridged, at least 26
    degrees), and rings 4 to 6 px inside and outside hold little (a filled area or text is not an
    arc). The leaf must be there too: ink along a straight line from the hinge to the arc's open end
    for at least 75% of its length. One door per hinge (the strongest).

    segs: [[x0, y0, x1, y1, ...]] in pixels (the lines found in the same picture). opts: {r_min,
    r_max} door radii in pixels. Returns {curves: [[8 numbers, 0]] (each swing as a cubic Bezier
    from the closed position to the open one), leaves: [[x0, y0, x1, y1]], drop: [indices of segs
    that lie on a leaf, which the leaf replaces]}, in pixels; auto_takeoff reads them as it reads a
    vector sheet's doors."""
    o = opts if isinstance(opts, dict) else {}
    r_min, r_max = o.get("r_min"), o.get("r_max")
    if not (_num(r_min) and _num(r_max) and 2 <= r_min <= r_max <= 4000):
        raise TakeoffError("input", "Door radii must be numbers of pixels, r_min up to r_max")
    if not (isinstance(w, int) and isinstance(h, int) and not isinstance(w, bool) and w > 0 and h > 0 and w * h <= 400000000):
        raise TakeoffError("input", "The picture needs its width and height in pixels")
    if len(mask) < w * h:
        raise TakeoffError("input", "The mask is smaller than the picture")
    r_min, r_max = float(r_min), float(r_max)
    NB, BAND, CELL = SCAN_DOOR_BINS, 2, 32
    QMAX = NB + 4
    buckets, gw, mb = _ink_buckets(mask, w, h, CELL)
    gh = (h + CELL - 1) // CELL

    def ink(x, y):
        xi, yi = math.floor(x + 0.5), math.floor(y + 0.5)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                xx, yy = xi + dx, yi + dy
                if 0 <= xx < w and 0 <= yy < h and mb[yy * w + xx]:
                    return True
        return False

    S = []
    for i, s in enumerate((segs if isinstance(segs, list) else [])[:SCAN_DOOR_LIMITS["segs"]]):
        if not isinstance(s, (list, tuple)) or len(s) < 4 or not all(_num(v) for v in s[:4]):
            continue
        dx, dy = float(s[2]) - float(s[0]), float(s[3]) - float(s[1])
        L = _len(dx, dy)
        if L >= 2:
            S.append((i, (float(s[0]), float(s[1])), (float(s[2]), float(s[3])), (dx / L, dy / L)))
    gmin, gmax = r_min * 0.9, 2 * r_max * 1.05
    ends = _Grid(max(8.0, gmax))
    for k, (_, a, b, _) in enumerate(S):
        for p in (a, b):
            ends.add(k, p[0], p[1], p[0], p[1])
    # the wall gaps: a line's end, and the nearest end of another line in line with it, ahead
    gaps, seen = [], set()
    for k, (i, a, b, u) in enumerate(S):
        for e, d in ((a, (-u[0], -u[1])), (b, u)):
            best = None
            for j in ends.query(e[0] - gmax, e[1] - gmax, e[0] + gmax, e[1] + gmax):
                if j == k:
                    continue
                _, a2, b2, u2 = S[j]
                if abs(u[0] * u2[1] - u[1] * u2[0]) > 0.035:
                    continue
                for f, other in ((a2, b2), (b2, a2)):
                    vx, vy = f[0] - e[0], f[1] - e[1]
                    along = vx * d[0] + vy * d[1]
                    if along < gmin or along > gmax or abs(vx * d[1] - vy * d[0]) > 3:
                        continue
                    if (other[0] - e[0]) * d[0] + (other[1] - e[1]) * d[1] <= along:
                        continue
                    if best is None or along < best[0]:
                        best = (along, j, f)
            if best is None:
                continue
            key = (min(k, best[1]), max(k, best[1]))
            if key in seen:
                continue
            seen.add(key)
            gaps.append((e, best[2], best[0]))
            if len(gaps) >= SCAN_DOOR_LIMITS["gaps"]:
                break
        if len(gaps) >= SCAN_DOOR_LIMITS["gaps"]:
            break

    cands = []
    for gi, (e1, e2, g) in enumerate(gaps):
        u = ((e2[0] - e1[0]) / g, (e2[1] - e1[1]) / g)
        n = (-u[1], u[0])
        rlo, rhi = max(r_min, 0.38 * g), min(r_max, 1.12 * g)
        if rlo > rhi:
            continue
        base = rlo - BAND - 7
        nr = math.floor(rhi - base) + BAND + 8
        for hi_, (c, d0) in enumerate(((e1, u), (e2, (-u[0], -u[1])))):
            R = rhi + BAND + 8
            pix = []
            for cy in range(max(0, math.floor((c[1] - R) / CELL)), min(gh - 1, math.floor((c[1] + R) / CELL)) + 1):
                for cx in range(max(0, math.floor((c[0] - R) / CELL)), min(gw - 1, math.floor((c[0] + R) / CELL)) + 1):
                    pix.extend(buckets.get(cx + cy * gw, ()))
            for si, side in enumerate((1, -1)):
                m = (n[0] * side, n[1] * side)
                acc = [[0] * (QMAX + 1) for _ in range(nr)]
                for (px, py) in pix:
                    vx, vy = px - c[0], py - c[1]
                    a = vx * d0[0] + vy * d0[1]
                    b = vx * m[0] + vy * m[1]
                    if b < 0 or (a >= 0 and a + b == 0):
                        continue
                    ri = math.floor(_len(vx, vy) - base)
                    if ri < 0 or ri >= nr:
                        continue
                    qi = math.floor((b / (a + b) if a >= 0 else 1 - a / (b - a)) * NB)
                    if qi <= QMAX:
                        acc[ri][qi] += 1
                best = None
                for ri in range(BAND + 7, nr - BAND - 7):
                    r = base + ri + 0.5
                    if r < rlo or r > rhi:
                        continue
                    hit = [any(acc[t][q] for t in range(ri - BAND, ri + BAND + 1)) for q in range(QMAX + 1)]
                    E, miss, hits = 0, 0, 0
                    for q in range(1, QMAX + 1):
                        if hit[q]:
                            E, miss, hits = q, 0, hits + 1
                        else:
                            miss += 1
                            if miss > 5:
                                break
                    if E < 9 or hits < 0.75 * E:
                        continue
                    span = max(1, E - 3)
                    ring_in = sum(1 for q in range(2, E - 1) if any(acc[t][q] for t in range(ri - BAND - 4, ri - BAND - 1))) / span
                    ring_out = sum(1 for q in range(2, E - 1) if any(acc[t][q] for t in range(ri + BAND + 2, ri + BAND + 5))) / span
                    if ring_in > 0.4 or ring_out > 0.4:
                        continue
                    score = hits * 4 - ring_in - ring_out
                    if best is None or score > best[0][0]:
                        best = [(score, r, E)]
                    elif score == best[0][0]:
                        best.append((score, r, E))
                if best is None:
                    continue
                score, r, E = best[(len(best) - 1) // 2]  # the middle of a run of equal radii
                # the leaf: a straight line from the hinge to the arc's open end
                leaf = None
                for t in range(13):
                    q = (E - 1 + t * 0.25) / NB
                    qa, qb = (1 - q, q) if q <= 1 else (1 - q, 2 - q)
                    vx, vy = qa * d0[0] + qb * m[0], qa * d0[1] + qb * m[1]
                    vl = _len(vx, vy)
                    dx, dy = vx / vl, vy / vl
                    nsamp = math.floor(0.8 * r) + 1
                    got = sum(1 for s_ in range(nsamp) if ink(c[0] + (0.12 * r + s_) * dx, c[1] + (0.12 * r + s_) * dy))
                    frac = got / nsamp
                    if leaf is None or frac > leaf[0][0]:
                        leaf = [(frac, dx, dy)]
                    elif frac == leaf[0][0]:
                        leaf.append((frac, dx, dy))
                frac, dx, dy = leaf[(len(leaf) - 1) // 2]  # the middle of equally inked directions
                if frac < 0.75:
                    continue
                cands.append({"order": len(cands), "c": c, "r": r, "d0": d0, "open": (dx, dy), "score": score})
    cands.sort(key=lambda x: (-x["score"], x["order"]))
    kept = []
    for cd in cands:
        if any(_len(cd["c"][0] - k2["c"][0], cd["c"][1] - k2["c"][1]) < 0.35 * cd["r"] and abs(cd["r"] - k2["r"]) < 0.25 * cd["r"] for k2 in kept):
            continue
        kept.append(cd)
    kept.sort(key=lambda x: x["order"])
    curves, leaves, drop = [], [], set()
    for cd in kept:
        c, r, e0, e1 = cd["c"], cd["r"], cd["d0"], cd["open"]
        p0 = (c[0] + r * e0[0], c[1] + r * e0[1])
        p1 = (c[0] + r * e1[0], c[1] + r * e1[1])
        cosw = max(-1.0, min(1.0, e0[0] * e1[0] + e0[1] * e1[1]))
        sgn = 1 if e0[0] * e1[1] - e0[1] * e1[0] >= 0 else -1
        kk = 4 / 3 * math.sqrt((1 - cosw) / 2) / (1 + math.sqrt((1 + cosw) / 2))
        t0, t1 = (-sgn * e0[1], sgn * e0[0]), (-sgn * e1[1], sgn * e1[0])
        curves.append([p0[0], p0[1], p0[0] + kk * r * t0[0], p0[1] + kk * r * t0[1],
                       p1[0] - kk * r * t1[0], p1[1] - kk * r * t1[1], p1[0], p1[1], 0])
        leaf = {"a": c, "u": e1, "L": r}
        leaves.append([c[0], c[1], p1[0], p1[1]])
        for (i, a, b, _) in S:
            if _pt_seg(a, leaf) <= 2.5 and _pt_seg(b, leaf) <= 2.5:
                drop.add(i)
    return {"curves": curves, "leaves": leaves, "drop": sorted(drop)}


# ------------------------------------------------------------------ walls


def _pairs(segs, grid, lim, skip):
    tmin, tmax, lmin = lim["tmin"], lim["tmax"], lim["wall_min_len"]
    cands = []
    for s in segs:
        if s["i"] in skip or s["L"] < lmin:
            continue
        for j in grid.query(*_seg_box(s, tmax)):
            if j <= s["i"] or j in skip:
                continue
            t = segs[j]
            if t["L"] < lmin:
                continue
            rel = _relation(s, t)
            if rel is None:
                continue
            off, a0, a1, spread = rel
            d = abs(off)
            if d < tmin or d > tmax or spread > 0.25 + 0.1 * d:
                continue
            lo, hi = max(0.0, a0), min(s["L"], a1)
            if hi - lo < max(lmin, 2.5 * d):
                continue
            cands.append((d, s["i"], j, off, lo, hi))
    cands.sort(key=lambda c: (c[0], c[1], c[2]))
    covered = {}

    def cover_frac(key, lo, hi):
        tot = 0.0
        for a, b in covered.get(key, []):
            tot += max(0.0, min(hi, b) - max(lo, a))
        return tot / (hi - lo)

    pieces = []
    for d, i, j, off, lo, hi in cands:
        s, t = segs[i], segs[j]
        side = 1 if off > 0 else -1
        # the same stretch seen from t
        p_lo = (s["a"][0] + s["u"][0] * lo, s["a"][1] + s["u"][1] * lo)
        p_hi = (s["a"][0] + s["u"][0] * hi, s["a"][1] + s["u"][1] * hi)
        tl0, _ = _frame(t, p_lo)
        tl1, _ = _frame(t, p_hi)
        tlo, thi = min(tl0, tl1), max(tl0, tl1)
        if cover_frac((i, side), lo, hi) >= 0.5 or cover_frac((j, -side), tlo, thi) >= 0.5:
            continue
        covered.setdefault((i, side), []).append((lo, hi))
        covered.setdefault((j, -side), []).append((tlo, thi))
        nx, ny = -s["u"][1], s["u"][0]
        h = off / 2
        a = (p_lo[0] + nx * h, p_lo[1] + ny * h)
        b = (p_hi[0] + nx * h, p_hi[1] + ny * h)
        pieces.append({"a": a, "b": b, "u": s["u"], "t": d, "w": (s["w"] + t["w"]) / 2, "fill": s["f"] == 1 and t["f"] == 1,
                       "segs": (i, j)})
    return pieces


def _merge_pieces(pieces, openings, bridge=0.0):
    n = len(pieces)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    grid = _Grid(48.0)
    for k, p in enumerate(pieces):
        grid.add(k, min(p["a"][0], p["b"][0]) - 4, min(p["a"][1], p["b"][1]) - 4, max(p["a"][0], p["b"][0]) + 4, max(p["a"][1], p["b"][1]) + 4)
    reach = max([p["t"] for p in pieces] + [0.0]) * 1.6 + 2
    max_open = max([o["L"] for o in openings] + [0.0]) + 2
    for k, p in enumerate(pieces):
        pad = max(reach, max_open)
        L = _len(p["b"][0] - p["a"][0], p["b"][1] - p["a"][1])
        sp = {"a": p["a"], "b": p["b"], "u": p["u"], "L": L}
        for m in grid.query(min(p["a"][0], p["b"][0]) - pad, min(p["a"][1], p["b"][1]) - pad, max(p["a"][0], p["b"][0]) + pad,
                            max(p["a"][1], p["b"][1]) + pad):
            if m <= k:
                continue
            q = pieces[m]
            if abs(p["u"][0] * q["u"][1] - p["u"][1] * q["u"][0]) > PAR:
                continue
            if abs(p["t"] - q["t"]) > 0.15 * max(p["t"], q["t"]):
                continue
            a0, o0 = _frame(sp, q["a"])
            a1, o1 = _frame(sp, q["b"])
            if abs((o0 + o1) / 2) > max(0.75, 0.15 * min(p["t"], q["t"])):
                continue
            lo, hi = min(a0, a1), max(a0, a1)
            gap = max(lo - L, -hi, 0.0)
            ok = gap <= 1.6 * max(p["t"], q["t"]) + 1 or gap <= bridge
            if not ok:
                g0, g1 = (L, lo) if lo >= L else (hi, 0.0)
                for o in openings:
                    oa, oo = _frame(sp, o["c"])
                    if g0 - 2 <= oa <= g1 + 2 and abs(oo) <= p["t"] / 2 + 2 and abs(o["L"] - gap) <= 0.25 * gap + 2:
                        ok = True
                        break
            if ok:
                ra, rb = find(k), find(m)
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
    groups = {}
    for k in range(n):
        groups.setdefault(find(k), []).append(k)
    walls = []
    for root in sorted(groups):
        mem = groups[root]
        longest = max(mem, key=lambda k: (_len(pieces[k]["b"][0] - pieces[k]["a"][0], pieces[k]["b"][1] - pieces[k]["a"][1]), -k))
        base = pieces[longest]
        bl = _len(base["b"][0] - base["a"][0], base["b"][1] - base["a"][1])
        frame = {"a": base["a"], "u": base["u"]}
        lo, hi = None, None
        wsum = osum = tsum = lwsum = 0.0
        fill = True
        segs_used = []
        for k in mem:
            p = pieces[k]
            pl = _len(p["b"][0] - p["a"][0], p["b"][1] - p["a"][1])
            a0, o0 = _frame(frame, p["a"])
            a1, o1 = _frame(frame, p["b"])
            lo = min(a0, a1) if lo is None else min(lo, a0, a1)
            hi = max(a0, a1) if hi is None else max(hi, a0, a1)
            wsum += pl
            osum += pl * (o0 + o1) / 2
            tsum += pl * p["t"]
            lwsum += pl * p["w"]
            fill = fill and p["fill"]
            segs_used.extend(p["segs"])
        off = osum / wsum
        ux, uy = base["u"]
        nx, ny = -uy, ux
        ax, ay = base["a"]
        walls.append({"a": (ax + ux * lo + nx * off, ay + uy * lo + ny * off), "b": (ax + ux * hi + nx * off, ay + uy * hi + ny * off),
                      "u": base["u"], "t": tsum / wsum, "w": lwsum / wsum, "fill": fill, "pieces": len(mem),
                      "segs": sorted(set(segs_used)), "drawn": wsum, "base_len": bl})
    return walls


def _extend(walls):
    """Carry wall ends to where they meet another wall's centerline (L and T corners)."""
    n = len(walls)
    ext = [[0.0, 0.0] for _ in range(n)]  # how far each end moves outward
    for i in range(n):
        w = walls[i]
        Lw = _len(w["b"][0] - w["a"][0], w["b"][1] - w["a"][1])
        for j in range(i + 1, n):
            v = walls[j]
            den = w["u"][0] * v["u"][1] - w["u"][1] * v["u"][0]
            if abs(den) <= PAR:
                continue
            dx, dy = v["a"][0] - w["a"][0], v["a"][1] - w["a"][1]
            s = (dx * v["u"][1] - dy * v["u"][0]) / den  # along w
            t = (dx * w["u"][1] - dy * w["u"][0]) / den  # along v
            Lv = _len(v["b"][0] - v["a"][0], v["b"][1] - v["a"][1])
            e = 0.5 * (w["t"] + v["t"]) + 1
            if s < -e or s > Lw + e or t < -e or t > Lv + e:
                continue
            if s < 0:
                ext[i][0] = max(ext[i][0], -s)
            elif s > Lw:
                ext[i][1] = max(ext[i][1], s - Lw)
            if t < 0:
                ext[j][0] = max(ext[j][0], -t)
            elif t > Lv:
                ext[j][1] = max(ext[j][1], t - Lv)
    for k, w in enumerate(walls):
        ux, uy = w["u"]
        w["a"] = (w["a"][0] - ux * ext[k][0], w["a"][1] - uy * ext[k][0])
        w["b"] = (w["b"][0] + ux * ext[k][1], w["b"][1] + uy * ext[k][1])


def _hatch(walls, segs, grid, skip):
    for w in walls:
        L = _len(w["b"][0] - w["a"][0], w["b"][1] - w["a"][1])
        frame = {"a": w["a"], "u": w["u"]}
        pad = w["t"]
        box = (min(w["a"][0], w["b"][0]) - pad, min(w["a"][1], w["b"][1]) - pad, max(w["a"][0], w["b"][0]) + pad, max(w["a"][1], w["b"][1]) + pad)
        n = 0
        for j in grid.query(*box):
            if j in skip:
                continue
            s = segs[j]
            if abs(w["u"][0] * s["u"][0] + w["u"][1] * s["u"][1]) > 0.94 or s["L"] > 2 * w["t"]:
                continue  # parallel-ish or long: not hatch
            mx, my = (s["a"][0] + s["b"][0]) / 2, (s["a"][1] + s["b"][1]) / 2
            a, o = _frame(frame, (mx, my))
            if 0 <= a <= L and abs(o) < 0.42 * w["t"]:
                n += 1
        w["hatch_n"] = n
        w["hatch"] = n >= max(3, L / (3 * w["t"]))


# ------------------------------------------------------------------ rooms


def _faces(walls):
    """Closed faces of the centerline graph: split walls where they cross, drop dead ends, walk
    each half edge to the next one turning most to the right."""
    n = len(walls)
    cuts = [[0.0, _len(w["b"][0] - w["a"][0], w["b"][1] - w["a"][1])] for w in walls]
    for i in range(n):
        w = walls[i]
        Lw = cuts[i][1]
        for j in range(i + 1, n):
            v = walls[j]
            den = w["u"][0] * v["u"][1] - w["u"][1] * v["u"][0]
            if abs(den) <= PAR:
                continue
            dx, dy = v["a"][0] - w["a"][0], v["a"][1] - w["a"][1]
            s = (dx * v["u"][1] - dy * v["u"][0]) / den
            t = (dx * w["u"][1] - dy * w["u"][0]) / den
            Lv = cuts[j][1]
            if -0.5 <= s <= Lw + 0.5 and -0.5 <= t <= Lv + 0.5:
                cuts[i].append(min(Lw, max(0.0, s)))
                cuts[j].append(min(Lv, max(0.0, t)))
    verts = []
    vindex = {}

    def vid(p):
        key = (_rnd(p[0] * 2), _rnd(p[1] * 2))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                k = (key[0] + dx, key[1] + dy)
                if k in vindex:
                    q = verts[vindex[k]]
                    if _len(q[0] - p[0], q[1] - p[1]) <= 0.75:
                        return vindex[k]
        vindex[key] = len(verts)
        verts.append(p)
        return vindex[key]

    edges = {}
    for i, w in enumerate(walls):
        cs = sorted(set(_r6(c) for c in cuts[i]))
        ids = []
        for c in cs:
            ids.append(vid((w["a"][0] + w["u"][0] * c, w["a"][1] + w["u"][1] * c)))
        for k in range(len(ids) - 1):
            a, b = ids[k], ids[k + 1]
            if a != b:
                key = (min(a, b), max(a, b))
                if key not in edges:
                    edges[key] = i
    adj = {}
    for (a, b), w in edges.items():
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    changed = True
    while changed:
        changed = False
        for v in sorted(adj):
            if len(adj[v]) == 1:
                (o,) = tuple(adj[v])
                adj[o].discard(v)
                del adj[v]
                changed = True
            elif not adj[v]:
                del adj[v]
                changed = True
    order = {}
    for v in adj:
        p = verts[v]
        order[v] = sorted(adj[v], key=lambda o: (_pseudo_angle(verts[o][0] - p[0], verts[o][1] - p[1]), o))
    seen = set()
    faces = []
    for v in sorted(adj):
        for o in order[v]:
            if (v, o) in seen:
                continue
            cyc = []
            a, b = v, o
            ok = True
            while (a, b) not in seen:
                seen.add((a, b))
                cyc.append((a, b))
                nb = order[b]
                k = nb.index(a)
                c = nb[(k - 1) % len(nb)]
                a, b = b, c
                if len(cyc) > 5000:
                    ok = False
                    break
            if ok and (a, b) == cyc[0]:
                faces.append([(e[0], edges[(min(e), max(e))]) for e in cyc])
    return verts, faces


def _pseudo_angle(dx, dy):
    """A number that orders directions the way atan2 does, from arithmetic only (-2 to 2)."""
    p = dx / (abs(dx) + abs(dy))
    return p - 1 if dy < 0 else 1 - p


def _poly_area(pts):
    s = 0.0
    n = len(pts)
    ox, oy = pts[0]
    for i in range(n):
        x0, y0 = pts[i][0] - ox, pts[i][1] - oy
        x1, y1 = pts[(i + 1) % n][0] - ox, pts[(i + 1) % n][1] - oy
        s += x0 * y1 - x1 * y0
    return s / 2


def _inside(pt, poly):
    x, y = pt
    c = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def _drop_collinear(pts, wl):
    out_p, out_w = [], []
    n = len(pts)
    for i in range(n):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
        cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        la, lb = _len(b[0] - a[0], b[1] - a[1]), _len(c[0] - b[0], c[1] - b[1])
        if la > 1e-9 and lb > 1e-9 and abs(cr) <= 1e-6 * la * lb and (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0:
            continue
        out_p.append(b)
        out_w.append(wl[i])
    # wl[i] is the wall of the edge that starts at pts[i]; after dropping vertex i the edge from the
    # previous kept vertex keeps its own wall, which is what out_w holds
    return out_p, out_w


def _inset(pts, offs):
    """Each edge moved inward by its own offset (pts clockwise on screen); None when that fails."""
    n = len(pts)
    area = _poly_area(pts)
    sgn = 1 if area > 0 else -1
    lines = []
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        L = _len(b[0] - a[0], b[1] - a[1])
        ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        nx, ny = -uy * sgn, ux * sgn  # inward normal for this winding (y down)
        d = offs[i]
        lines.append(((a[0] + nx * d, a[1] + ny * d), (ux, uy)))
    out = []
    for i in range(n):
        (p, u), (q, v) = lines[i - 1], lines[i]
        den = u[0] * v[1] - u[1] * v[0]
        if abs(den) < 1e-9:
            out.append(q)
            continue
        dx, dy = q[0] - p[0], q[1] - p[1]
        s = (dx * v[1] - dy * v[0]) / den
        out.append((p[0] + u[0] * s, p[1] + u[1] * s))
    a2 = _poly_area(out)
    if a2 * area <= 0 or abs(a2) >= abs(area):
        return None
    for i in range(n):
        a, b = out[i], out[(i + 1) % n]
        e0, e1 = pts[i], pts[(i + 1) % n]
        if (b[0] - a[0]) * (e1[0] - e0[0]) + (b[1] - a[1]) * (e1[1] - e0[1]) <= 0:
            return None  # an edge turned around: the inset collapsed it
    return out


def _rooms(walls, text_ls, lim, ipp):
    for w in walls:
        w["outer"] = False
    verts, faces = _faces(walls)
    polys = []
    for f in faces:
        pts = [verts[v] for v, _ in f]
        wl = [w for _, w in f]
        if len(pts) < 3:
            continue
        a = _poly_area(pts)
        polys.append((a, pts, wl))
    if not polys:
        return []
    outer_sign = 1 if max(polys, key=lambda p: abs(p[0]))[0] > 0 else -1
    k2 = (ipp * ipp) if ipp else (DEFAULT_IPP * DEFAULT_IPP)
    rooms = []
    for a, pts, wl in polys:
        if (a > 0) == (outer_sign > 0):
            for w in wl:  # the outline of a group of rooms: these walls face the outside
                walls[w]["outer"] = True
            continue
        pts, wl = _drop_collinear(pts, wl)
        if len(pts) < 3:
            continue
        area = abs(_poly_area(pts))
        per = sum(_len(pts[(i + 1) % len(pts)][0] - pts[i][0], pts[(i + 1) % len(pts)][1] - pts[i][1]) for i in range(len(pts)))
        if area * k2 / 144 < lim["room_min_sf"] or 2 * area / per * (ipp or DEFAULT_IPP) < lim["room_min_width_in"]:
            continue
        clear = _inset(pts, [walls[w]["t"] / 2 for w in wl])
        poly = clear or pts
        names = []
        for ln in text_ls:
            cx, cy = ln["x"] + ln["w"] / 2, ln["y"] - ln["h"] / 2
            if _inside((cx, cy), poly):
                names.append(ln)
        name, number = "", ""
        best = None
        words = []
        for ln in names:
            s = ln["str"]
            if DIM_TEXT.match(s) or AREA_TEXT.match(s) or DOOR_TAG.match(s):
                continue
            if ROOM_NO.match(s):
                if not number:
                    number = s
                continue
            if not re.search(r"[A-Za-z]{2}", s):
                continue
            words.append(ln)
            if best is None or ln["h"] > best["h"] or (ln["h"] == best["h"] and ln["y"] < best["y"]):
                best = ln
        if best:
            # a name set on two or three lines: same size, stacked, centered on each other
            group = [best]
            grew = True
            while grew and len(group) < 3:
                grew = False
                top = min(group, key=lambda q: q["y"])
                bot = max(group, key=lambda q: q["y"])
                for ln in words:
                    if ln in group or abs(ln["h"] - best["h"]) > 0.1 * best["h"]:
                        continue
                    cx, bx = ln["x"] + ln["w"] / 2, best["x"] + best["w"] / 2
                    if abs(cx - bx) > max(ln["w"], best["w"]) / 2:
                        continue
                    if 0 < ln["y"] - bot["y"] <= 1.6 * best["h"] or 0 < top["y"] - ln["y"] <= 1.6 * best["h"]:
                        group.append(ln)
                        grew = True
                        break
            group.sort(key=lambda q: q["y"])
            name = " ".join(q["str"] for q in group)
        rooms.append({"pts": pts, "clear": clear, "walls": wl, "area": area, "clear_area": abs(_poly_area(clear)) if clear else None,
                      "name": name, "number": number, "texts": len(names)})
    return rooms


# ------------------------------------------------------------------ symbols


def _pt_seg(p, s):
    dx, dy = p[0] - s["a"][0], p[1] - s["a"][1]
    t = max(0.0, min(s["L"], dx * s["u"][0] + dy * s["u"][1]))
    return _len(p[0] - s["a"][0] - s["u"][0] * t, p[1] - s["a"][1] - s["u"][1] * t)


def _dimensions(segs, grid, used, smax):
    """Dimension lines with their extension lines and ticks: a line with a tick (a short line at 30 to
    60 degrees) through both of its ends. These are left out of symbol counting."""
    dims = set()
    for d in segs:
        if d["i"] in used or d["L"] <= smax:
            continue
        attached = []
        ends = 0
        for e in (d["a"], d["b"]):
            tick = False
            near = []
            for j in grid.query(e[0] - 1, e[1] - 1, e[0] + 1, e[1] + 1):
                if j == d["i"] or j in used:
                    continue
                s = segs[j]
                if s["L"] > smax * 1.5 or _pt_seg(e, s) > 0.75:
                    continue
                c = abs(d["u"][0] * s["u"][0] + d["u"][1] * s["u"][1])
                if c <= PERP:
                    near.append(j)
                elif 0.5 <= c <= 0.87:
                    tick = True
                    near.append(j)
            if tick:
                ends += 1
                attached.extend(near)
        if ends == 2:
            dims.add(d["i"])
            dims.update(attached)
    return dims


def _symbols(segs, curves, used_s, used_c, text_ls, lim, rooms):
    smin, smax = lim["symbol_min"], lim["symbol_max"]
    items = []
    for s in segs:
        if s["i"] in used_s or s["L"] > smax * 1.5:
            continue
        items.append(("s", s["i"], [s["a"], s["b"]]))
    for c in curves:
        if c["i"] in used_c:
            continue
        p = c["p"]
        xs, ys = [q[0] for q in p], [q[1] for q in p]
        if max(xs) - min(xs) > smax * 1.5 or max(ys) - min(ys) > smax * 1.5:
            continue
        items.append(("c", c["i"], [p[0], _bez(p, 0.5), p[3]]))
    n = len(items)
    boxes = []
    for it in items:
        xs, ys = [q[0] for q in it[2]], [q[1] for q in it[2]]
        boxes.append((min(xs), min(ys), max(xs), max(ys)))
    grid = _Grid(max(8.0, smax / 2))
    for k, b in enumerate(boxes):
        grid.add(k, b[0] - 0.75, b[1] - 0.75, b[2] + 0.75, b[3] + 0.75)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for k, b in enumerate(boxes):
        for m in grid.query(b[0] - 0.75, b[1] - 0.75, b[2] + 0.75, b[3] + 0.75):
            if m <= k:
                continue
            c = boxes[m]
            if c[0] <= b[2] + 0.75 and b[0] <= c[2] + 0.75 and c[1] <= b[3] + 0.75 and b[1] <= c[3] + 0.75:
                ra, rb = find(k), find(m)
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
    comps = {}
    for k in range(n):
        comps.setdefault(find(k), []).append(k)
    # a part drawn inside another (the circle inside a detector's square) belongs to it
    cbox = {}
    for root, mem in comps.items():
        cbox[root] = (min(boxes[k][0] for k in mem), min(boxes[k][1] for k in mem), max(boxes[k][2] for k in mem), max(boxes[k][3] for k in mem))
    cgrid = _Grid(max(8.0, smax / 2))
    for root in sorted(cbox):
        b = cbox[root]
        if max(b[2] - b[0], b[3] - b[1]) <= smax:
            cgrid.add(root, *b)
    for root in sorted(cbox):
        b = cbox[root]
        best = None
        for other in cgrid.query(*b):
            if other == root:
                continue
            c = cbox[other]
            if c[0] - 0.5 <= b[0] and c[1] - 0.5 <= b[1] and b[2] <= c[2] + 0.5 and b[3] <= c[3] + 0.5 and (c[2] - c[0]) * (c[3] - c[1]) > (b[2] - b[0]) * (b[3] - b[1]):
                area = (c[2] - c[0]) * (c[3] - c[1])
                if best is None or area < best[0] or (area == best[0] and other < best[1]):
                    best = (area, other)
        if best:
            ra, rb = find(root), find(best[1])
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)
    comps = {}
    for k in range(n):
        comps.setdefault(find(k), []).append(k)
    sigs = {}
    order = []
    for root in sorted(comps):
        mem = comps[root]
        x0 = min(boxes[k][0] for k in mem)
        y0 = min(boxes[k][1] for k in mem)
        x1 = max(boxes[k][2] for k in mem)
        y1 = max(boxes[k][3] for k in mem)
        size = max(x1 - x0, y1 - y0)
        if size < smin or size > smax:
            continue
        if len(mem) < 2 and items[mem[0]][0] == "s":
            continue
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        best = None
        for rot in range(8):
            toks = []
            for k in mem:
                kind, _, pts = items[k]
                q = []
                for p in pts:
                    x, y = p[0] - cx, p[1] - cy
                    for _ in range(rot % 4):
                        x, y = -y, x
                    if rot >= 4:
                        x = -x
                    # thousandths first (copies differ only by rounding noise), then half points
                    mx, my = int(_rnd(x * 1000)), int(_rnd(y * 1000))
                    q.append(((mx + 250) // 500, (my + 250) // 500))
                if kind == "s":
                    q.sort()
                elif q[2] < q[0]:
                    q = [q[2], q[1], q[0]]
                toks.append(kind + ":" + ",".join(f"{a} {b}" for a, b in q))
            toks.sort()
            sig = "|".join(toks)
            if best is None or sig < best:
                best = sig
        if best not in sigs:
            sigs[best] = []
            order.append(best)
        sigs[best].append({"box": (x0, y0, x1, y1), "c": (cx, cy), "size": size, "items": [(items[k][0], items[k][1]) for k in mem]})
    groups = []
    for sig in order:
        inst = sigs[sig]
        if len(inst) < lim["symbol_min_count"]:
            continue
        # a legend entry: a copy outside every room with a label starting beside it (any side, as
        # sheets can be turned); the nearest label wins
        legend = None
        for k, ins in enumerate(inst):
            if any(_inside(ins["c"], poly) for poly in rooms):
                continue
            x0, y0, x1, y1 = ins["box"]
            for ln in text_ls:
                if len(ln["str"]) < 4 or not re.search(r"[A-Za-z]{3}", ln["str"]) or LEGEND_WORDS.match(ln["str"]):
                    continue
                dx = max(x0 - ln["x"], 0.0, ln["x"] - x1)
                dy = max(y0 - ln["y"], 0.0, ln["y"] - y1)
                d = _len(dx, dy)
                if 0 < d <= 2 * ins["size"] and (legend is None or d < legend[2]):
                    legend = (k, ln["str"], d)
        groups.append({"sig": sig, "inst": inst, "legend": legend})
    return groups


# ------------------------------------------------------------------ wall types


def classify_wall(features, rules):
    """The first rule that matches a wall's features, or None. features: {thickness_in (or None
    without a scale), weight_pt, hatch, fill, outer (on the outline of a group of rooms)}.
    Thickness is matched as min_in <= t < max_in; yes/no/any for hatch, fill and outer."""
    for r in rules or []:
        t = features.get("thickness_in")
        if t is not None and not (r.get("min_in", 0) <= t < r.get("max_in", 1e9)):
            continue
        wt = features.get("weight_pt", 0.0)
        if not (r.get("min_weight", 0) <= wt <= r.get("max_weight", 1e9)):
            continue
        h = r.get("hatch", "any")
        if (h == "yes" and not features.get("hatch")) or (h == "no" and features.get("hatch")):
            continue
        f = r.get("fill", "any")
        if (f == "yes" and not features.get("fill")) or (f == "no" and features.get("fill")):
            continue
        ou = r.get("outer", "any")
        if (ou == "yes" and not features.get("outer")) or (ou == "no" and features.get("outer")):
            continue
        return r
    return None


_RULE_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")


def clean_rules(rules):
    """Validated wall type rules (the person edits these). Unknown fields dropped, bad rules skipped."""
    out = []
    if not isinstance(rules, list):
        return [dict(r) for r in DEFAULT_RULES]
    for r in rules[:100]:
        if not isinstance(r, dict):
            continue
        rid = r.get("id")
        if not isinstance(rid, str) or not _RULE_ID.match(rid) or rid in [x["id"] for x in out]:
            continue
        name = r.get("name") if isinstance(r.get("name"), str) else ""
        name = re.sub(r"[\u0000-\u001f\u007f]", "", name).strip()[:80] or rid
        preset = r.get("preset") if isinstance(r.get("preset"), str) and _RULE_ID.match(r.get("preset")) else ""
        c = {"id": rid, "name": name, "preset": preset}
        for k, d in (("min_in", 0.0), ("max_in", 1e9), ("min_weight", 0.0), ("max_weight", 1e9)):
            v = r.get(k)
            c[k] = float(v) if _num(v) and 0 <= v <= 1e9 else d
        c["hatch"] = r.get("hatch") if r.get("hatch") in HATCH else "any"
        c["fill"] = r.get("fill") if r.get("fill") in HATCH else "any"
        c["outer"] = r.get("outer") if r.get("outer") in HATCH else "any"
        out.append(c)
    return out


# ------------------------------------------------------------------ main


def _g(x):
    """A number as JavaScript's String() writes it (whole numbers without a decimal point)."""
    x = float(x)
    return str(int(x)) if x == int(x) else repr(x)


def _fmt_in(x):
    return f"{_g(_rnd(x * 8) / 8)} in"


def _fmt_ft(inches):
    ft = math.floor(inches / 12 + 1e-9)
    rem = _rnd((inches - ft * 12) * 4) / 4
    if rem >= 12:
        ft, rem = ft + 1, 0.0
    return f"{_g(ft)}'-{_g(rem)}\""


def auto_takeoff(page, opts=None):
    """Find walls, rooms, doors, windows and repeated symbols on one sheet.

    page: {w, h, segs: [[x0, y0, x1, y1, line width, fill flag]], curves: [[8 numbers, line width]],
    text: [{str, x, y, w, h}], in_per_pt}. opts: size limits (see DEFAULTS), rules, classes.
    Returns {walls, rooms, doors, windows, symbols, types, notes}; lengths in sheet points and, with a
    scale, real inches (areas in square points and square inches)."""
    w, h, segs, curves, text, ipp = _clean_page(page)
    reg = opts.get("region") if isinstance(opts, dict) else None
    if isinstance(reg, list) and len(reg) == 4 and all(_num(v) for v in reg) and reg[2] > reg[0] and reg[3] > reg[1]:
        area = [float(v) for v in reg]
    else:
        area = drawing_area([[s["a"][0], s["a"][1], s["b"][0], s["b"][1]] for s in segs], w, h)
    ax0, ay0, ax1, ay1 = area[0] + 0.5, area[1] + 0.5, area[2] - 0.5, area[3] - 0.5

    def inside(x, y):
        return ax0 < x < ax1 and ay0 < y < ay1

    kept = [s for s in segs if inside(*s["a"]) and inside(*s["b"])]
    for k, s in enumerate(kept):
        s["i"] = k
    segs = kept
    kept = [c for c in curves if all(inside(*q) for q in c["p"])]
    for k, c in enumerate(kept):
        c["i"] = k
    curves = kept
    text = [t for t in text if inside(t["x"], t["y"])]
    o = dict(DEFAULTS)
    if isinstance(opts, dict):
        for k in DEFAULTS:
            if _num(opts.get(k)) and opts[k] > 0:
                o[k] = float(opts[k]) if k != "symbol_min_count" else int(opts[k])
    rules = clean_rules(opts.get("rules")) if isinstance(opts, dict) and "rules" in opts else [dict(r) for r in DEFAULT_RULES]
    k = ipp or DEFAULT_IPP
    lim = {"tmin": o["wall_min_in"] / k, "tmax": o["wall_max_in"] / k, "wall_min_len": o["wall_min_len_in"] / k,
           "door_min": o["door_min_in"] / k, "door_max": o["door_max_in"] / k,
           "window_min": o["window_min_in"] / k, "window_max": o["window_max_in"] / k,
           "room_min_sf": o["room_min_sf"], "room_min_width_in": o["room_min_width_in"],
           "symbol_min": o["symbol_min_pt"], "symbol_max": o["symbol_max_pt"], "symbol_min_count": o["symbol_min_count"],
           "bridge": o["bridge_in"] / k}
    notes = []
    if area != [0.0, 0.0, w, h]:
        notes.append("Only the drawing area is read: the sheet border and title block strip are left out.")
    if ipp is None:
        notes.append("No scale is set on this sheet, so the size limits assume 1/4\" = 1'-0\" and quantities are in sheet points. Set the scale for real lengths and areas.")
    grid = _Grid(max(16.0, lim["tmax"]))
    for s in segs:
        grid.add(s["i"], *_seg_box(s, 0))
    text_ls = text_lines(text)

    windows, glass = _windows(segs, grid, lim)
    arcs = _arcs(curves, segs, lim)
    doors, door_segs = _doors(arcs, segs, grid, text_ls, lim)
    skip = set(glass) | set(door_segs)
    pieces = _pairs(segs, grid, lim, skip)
    openings = [{"c": d["mid"], "L": d["width"]} for d in doors] + [{"c": wd["c"], "L": wd["L"]} for wd in windows]
    walls = _merge_pieces(pieces, openings, lim["bridge"])
    walls.sort(key=lambda x: ((x["a"][1] + x["b"][1]) / 2, (x["a"][0] + x["b"][0]) / 2))
    walls = walls[:LIMITS["walls"]]
    _extend(walls)
    wall_segs = set()
    for wl in walls:
        wall_segs.update(wl["segs"])
    _hatch(walls, segs, grid, wall_segs | skip)
    rooms = _rooms(walls, text_ls, lim, ipp)

    # hatch lines belong to their wall, not to symbols
    # line work inside a wall's band (hatch, fill corners, jambs) belongs to the wall, not to symbols
    hatch_segs = set()
    for wl in walls:
        L = _len(wl["b"][0] - wl["a"][0], wl["b"][1] - wl["a"][1])
        frame = {"a": wl["a"], "u": wl["u"]}
        for j in grid.query(*_seg_box({"a": wl["a"], "b": wl["b"]}, wl["t"])):
            s = segs[j]
            mx, my = (s["a"][0] + s["b"][0]) / 2, (s["a"][1] + s["b"][1]) / 2
            a, off = _frame(frame, (mx, my))
            if -wl["t"] / 2 <= a <= L + wl["t"] / 2 and abs(off) <= 0.5 * wl["t"] + 0.5:
                hatch_segs.add(j)
    used_s = wall_segs | skip | hatch_segs
    for wd in windows:
        used_s.add(wd["glass"])
        used_s.update(wd["jamb_segs"])
        used_s.update(wd["faces"])
    used_c = set()
    for d in doors:
        for src in [d["src"]] + ([d["pair"]["src"]] if d.get("pair") else []):
            if src[0] == "c":
                used_c.add(src[1])
            else:
                used_s.update(src[1])
        used_s.add(d["leaf"])
        if d.get("pair"):
            used_s.add(d["pair"]["leaf"])
    for a in arcs:  # every door-sized arc piece (a door drawn in two curves)
        if a["src"][0] == "c":
            for d in doors:
                if _len(a["c"][0] - d["c"][0], a["c"][1] - d["c"][1]) < 1 and abs(a["r"] - d["r"]) < 1:
                    used_c.add(a["src"][1])
    used_s = used_s | _dimensions(segs, grid, used_s, lim["symbol_max"])
    groups = _symbols(segs, curves, used_s, used_c, text_ls, lim, [r["clear"] or r["pts"] for r in rooms])

    def real(v):
        return _r6(v * ipp) if ipp else None

    def p6(p):
        return [_r6(p[0]), _r6(p[1])]

    out_walls = []
    for n, wl in enumerate(walls):
        L = _len(wl["b"][0] - wl["a"][0], wl["b"][1] - wl["a"][1])
        feats = {"thickness_in": real(wl["t"]), "weight_pt": _r6(wl["w"]), "hatch": wl["hatch"], "fill": wl["fill"], "outer": wl.get("outer", False)}
        rule = classify_wall(feats, rules)
        drawn = min(1.0, wl["drawn"] / L) if L > 0 else 0.0
        conf = 0.55 + 0.25 * drawn + (0.1 if wl["pieces"] == 1 else 0.0) + (0.1 if rule else 0.0)
        tdesc = _fmt_in(wl["t"] * ipp) if ipp else f"{_g(_rnd(wl['t'] * 10) / 10)} pt"
        why = (f"Two parallel lines {tdesc} apart run together for {_fmt_ft(wl['drawn'] * ipp) if ipp else _g(_rnd(wl['drawn'])) + ' pt'}"
               f"{' in ' + str(wl['pieces']) + ' pieces' if wl['pieces'] > 1 else ''}; line weight {_g(_rnd(wl['w'] * 100) / 100)} pt"
               f"{', hatched' if wl['hatch'] else ''}{', filled' if wl['fill'] else ''}{', on the outline' if wl.get('outer') else ''}. "
               + (f"Rule \"{rule['name']}\" matches." if rule else "No wall type rule matches."))
        out_walls.append({"id": f"w{n + 1}", "kind": "wall", "a": p6(wl["a"]), "b": p6(wl["b"]), "length_pt": _r6(L),
                          "length_in": real(L), "thickness_pt": _r6(wl["t"]), "thickness_in": feats["thickness_in"],
                          "weight_pt": feats["weight_pt"], "hatch": wl["hatch"], "fill": wl["fill"], "outer": feats["outer"],
                          "type": rule["id"] if rule else "", "type_name": rule["name"] if rule else "Unclassified wall",
                          "preset": rule["preset"] if rule else "", "conf": _r6(min(0.97, conf)), "why": why})
    out_rooms = []
    for n, r in enumerate(rooms):
        ra = r["clear_area"] if r["clear_area"] is not None else r["area"]
        poly = r["clear"] or r["pts"]
        label = (r["name"] + (" " + r["number"] if r["number"] else "")).strip()
        conf = 0.6 + (0.2 if r["clear"] else 0.0) + (0.15 if r["name"] else 0.0)
        why = (f"A closed space bounded by {len(r['pts'])} wall centerlines"
               + (f"; the clear area insets each edge by half its wall" if r["clear"] else "; the clear area could not be found, so this is on the centerlines")
               + (f"; named from the text \"{label}\" inside it." if label else "; no room name inside it."))
        out_rooms.append({"id": f"r{n + 1}", "kind": "room", "pts": [p6(p) for p in poly], "center": p6(_centroid(poly)),
                          "area_pt": _r6(ra), "area_sq_in": _r6(ra * ipp * ipp) if ipp else None,
                          "centerline_area_sq_in": _r6(r["area"] * ipp * ipp) if ipp else None,
                          "name": r["name"], "number": r["number"], "label": label or f"Room {n + 1}",
                          "conf": _r6(min(0.97, conf)), "why": why})
    out_doors = []
    for n, d in enumerate(doors):
        on_wall = False
        for wl in walls:
            a, off = _frame({"a": wl["a"], "u": wl["u"]}, d["mid"])
            L = _len(wl["b"][0] - wl["a"][0], wl["b"][1] - wl["a"][1])
            if -2 <= a <= L + 2 and abs(off) <= wl["t"] / 2 + 2:
                on_wall = True
                break
        conf = 0.7 + (0.15 if on_wall else 0.0) + (0.1 if d["tag"] else 0.0)
        wdesc = _fmt_ft(d["width"] * ipp) if ipp else f"{_g(_rnd(d['width']))} pt"
        why = (f"{'Two arcs' if d['leaves'] == 2 else 'An arc'} of about 90 degrees with a leaf line from the hinge; "
               f"opening {wdesc}" + ("; in a wall" if on_wall else "; not in a wall found here")
               + (f"; tag {d['tag']} beside it." if d["tag"] else "; no door tag found beside it."))
        out_doors.append({"id": f"d{n + 1}", "kind": "door", "at": p6(d["mid"]), "hinge": p6(d["c"]), "a": p6(d["a"]), "b": p6(d["b"]),
                          "width_pt": _r6(d["width"]), "width_in": real(d["width"]), "leaves": d["leaves"], "tag": d["tag"],
                          "in_wall": on_wall, "conf": _r6(min(0.97, conf)), "why": why})
    out_windows = []
    for n, wd in enumerate(windows):
        conf = 0.65 + 0.15 * wd["jambs"]
        wdesc = _fmt_ft(wd["L"] * ipp) if ipp else f"{_g(_rnd(wd['L']))} pt"
        why = (f"A line between two wall faces {_fmt_in(wd['t'] * ipp) if ipp else _g(_rnd(wd['t'] * 10) / 10) + ' pt'} apart, "
               f"closed by {'jamb lines at both ends' if wd['jambs'] == 2 else 'a jamb line at one end'}; width {wdesc}.")
        out_windows.append({"id": f"n{n + 1}", "kind": "window", "at": p6(wd["c"]), "a": p6(wd["a"]), "b": p6(wd["b"]),
                            "width_pt": _r6(wd["L"]), "width_in": real(wd["L"]), "conf": _r6(min(0.97, conf)), "why": why})
    out_symbols = []
    for n, g in enumerate(groups):
        inst = g["inst"]
        legend = g["legend"]
        counted = [ins for k, ins in enumerate(inst) if not (legend and k == legend[0])]
        kinds = {"s": 0, "c": 0}
        for kind, _ in inst[0]["items"]:
            kinds[kind] += 1
        shape = (f"{kinds['c']} curve{'s' if kinds['c'] != 1 else ''} and " if kinds["c"] else "") + f"{kinds['s']} line{'s' if kinds['s'] != 1 else ''}"
        name = legend[1] if legend else f"Symbol {n + 1}"
        why = (f"{len(counted)} copies of the same shape ({shape}, {_g(_rnd(inst[0]['size'] * 10) / 10)} pt across), matched in any quarter turn or mirror"
               + (f"; the copy beside the label \"{legend[1]}\" is a legend entry and is not counted." if legend else "."))
        conf = 0.6 + min(0.3, 0.03 * len(counted)) + (0.05 if legend else 0.0)
        out_symbols.append({"id": f"s{n + 1}", "kind": "symbol", "name": name, "count": len(counted),
                            "at": [p6(ins["c"]) for ins in counted], "size_pt": _r6(inst[0]["size"]),
                            "legend": p6(inst[legend[0]]["c"]) if legend else None, "conf": _r6(min(0.97, conf)), "why": why})
    types = {}
    torder = []
    for wl in out_walls:
        tk = (wl["type"], _rnd((wl["thickness_in"] if wl["thickness_in"] is not None else wl["thickness_pt"]) * 4) / 4,
              _rnd(wl["weight_pt"] * 10) / 10, wl["hatch"], wl["fill"])
        if tk not in types:
            types[tk] = {"rule": wl["type"], "name": wl["type_name"], "preset": wl["preset"], "thickness": tk[1],
                         "thickness_unit": "in" if ipp else "pt", "weight_pt": tk[2], "hatch": tk[3], "fill": tk[4],
                         "walls": [], "length_pt": 0.0}
            torder.append(tk)
        types[tk]["walls"].append(wl["id"])
        types[tk]["length_pt"] = _r6(types[tk]["length_pt"] + wl["length_pt"])
    out_types = []
    for n, tk in enumerate(torder):
        t = types[tk]
        t["id"] = f"t{n + 1}"
        t["length_in"] = _r6(t["length_pt"] * ipp) if ipp else None
        out_types.append(t)
    return {"walls": out_walls, "rooms": out_rooms, "doors": out_doors, "windows": out_windows, "symbols": out_symbols,
            "types": out_types, "notes": notes, "scale": ipp, "area": [_r6(v) for v in area],
            "stats": {"segments": len(segs), "curves": len(curves), "text_lines": len(text_ls), "arcs": len(arcs), "pieces": len(pieces)}}


def _centroid(pts):
    a = _poly_area(pts)
    if abs(a) < 1e-12:
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    ox, oy = pts[0]
    cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i][0] - ox, pts[i][1] - oy
        x1, y1 = pts[(i + 1) % n][0] - ox, pts[(i + 1) % n][1] - oy
        cr = x0 * y1 - x1 * y0
        cx += (x0 + x1) * cr
        cy += (y0 + y1) * cr
    return (ox + cx / (6 * a), oy + cy / (6 * a))


def proposals(result, accepted, page_index):
    """The markups an accepted batch becomes: {tool, page, points, label, preset, subject, source}.
    Walls are lengths with their type's preset, rooms are areas, doors, windows and each symbol
    group are counts. accepted: ids from the result."""
    ids = set(accepted or [])
    out = []
    for wl in result.get("walls", []):
        if wl["id"] in ids:
            out.append({"tool": "length", "page": page_index, "points": [wl["a"], wl["b"]], "label": wl["type_name"],
                        "preset": wl["preset"], "subject": wl["type_name"], "source": wl["id"]})
    for r in result.get("rooms", []):
        if r["id"] in ids:
            out.append({"tool": "area", "page": page_index, "points": r["pts"], "label": r["label"], "preset": "p-floor",
                        "subject": "Room", "source": r["id"]})
    doors = [d for d in result.get("doors", []) if d["id"] in ids]
    if doors:
        out.append({"tool": "count", "page": page_index, "points": [d["at"] for d in doors], "label": "Doors", "preset": "p-door",
                    "subject": "Door", "source": ",".join(d["id"] for d in doors)})
    wins = [d for d in result.get("windows", []) if d["id"] in ids]
    if wins:
        out.append({"tool": "count", "page": page_index, "points": [d["at"] for d in wins], "label": "Windows", "preset": "",
                    "subject": "Window", "source": ",".join(d["id"] for d in wins)})
    for s in result.get("symbols", []):
        if s["id"] in ids and s["at"]:
            out.append({"tool": "count", "page": page_index, "points": s["at"], "label": s["name"], "preset": "",
                        "subject": "Symbol", "source": s["id"]})
    return out
