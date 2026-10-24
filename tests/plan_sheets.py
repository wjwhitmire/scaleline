"""Floor plan sheets with ground-truth labels, for auto-takeoff tests and the accuracy corpus.

Each layout is a small invented building (example data) drawn the way CAD exports draw plans:
walls as two face lines that break where other walls join and at openings, jamb lines across
openings, doors as a leaf line and a quarter arc (Bezier curves, or chains of short lines on the
CAD-style sheet), windows as two sill lines with a glass line between, hatched or heavier exterior
walls, room names and numbers, door tags (some doors left untagged on purpose), receptacle and
detector symbols with a legend, dimension strings, a sheet border and a title block strip. Some
things a takeoff tool can get wrong are drawn on purpose: a 12 in deep shelf (two parallel lines a
wall thickness apart) and a table.

Labels are in sheet points (origin top left, y down, page rotation applied), the space the app
works in: wall centerlines from junction to junction with thickness and kind, room clear outlines
with clear areas, door openings with widths and tags, windows, symbol positions (legend copies
left out) and the distractors.

Used by tools/make_corpus.py (PDF files and the manifest) and by tests (the line work directly,
without a PDF reader).
"""

import math
import random
import zlib

FONT = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
K_ARC = 0.5522847498

# ---------------------------------------------------------------- layouts (feet, x right, y down)

HOUSE = {
    "name": "P-HOUSE", "title": "FIRST FLOOR PLAN", "number": "A-101", "size": (1728, 1296), "ipp": 48 / 72,
    "scale": '1/4" = 1\'-0"', "origin": (160, 300), "hatch": True, "arc": "bezier", "ext_t": 8, "int_t": 4.5,
    "ext_w": 0.7, "int_w": 0.5,
    "walls": [((0, 0), (48, 0), "ext"), ((48, 0), (48, 32), "ext"), ((0, 32), (48, 32), "ext"), ((0, 0), (0, 32), "ext"),
              ((20, 0), (20, 32), "int"), ((0, 14), (20, 14), "int"), ((20, 18), (48, 18), "int"), ((34, 18), (34, 32), "int"),
              ((10, 14), (10, 32), "int")],
    "rooms": [((0, 0, 20, 14), "LIVING", "101"), ((0, 14, 10, 32), "BEDROOM", "102"), ((10, 14, 20, 32), "STUDY", "103"),
              ((20, 0, 48, 18), "KITCHEN", "104"), ((20, 18, 34, 32), "BEDROOM", "105"), ((34, 18, 48, 32), "OFFICE", "106")],
    # (wall index, center along the wall in ft, width ft, side the leaf swings to (+1: larger y or x), hinge end, tag)
    "doors": [(0, 10, 6, 1, "pair", "D1"), (5, 5, 3, 1, "lo", "D2"), (5, 15, 2.67, 1, "hi", ""), (4, 7, 3, -1, "lo", "D4"),
              (6, 27, 3, 1, "lo", "D5"), (6, 41, 3, 1, "hi", "D6"), (8, 23, 2.67, -1, "lo", "")],
    "windows": [(0, 30, 5), (0, 42, 4), (3, 6, 4), (3, 24, 3), (2, 27, 4), (2, 41, 4), (1, 9, 5)],
    "outlets": [(1.2, 4), (1.2, 10), (8, 1.2), (16, 12.8), (1.2, 20), (1.2, 28), (12, 30.8), (18.8, 22), (26, 1.2), (40, 16.8),
                (46.8, 8), (22, 30.8), (46.8, 26), (36, 30.8)],
    "detectors": [(14, 4), (6, 18), (16, 18), (40, 6), (30, 22), (44, 22)],
    "legend": (0, 38),
    "shelf": (36, 2.0, 6, 1.0),  # x, y (top line), length ft, depth ft: a false wall
    "table": (6, 5, 5, 3),
    "dims": [(0, 20, -4), (20, 48, -4), (0, 48, -7)],
}

OFFICE = {
    "name": "P-OFFICE", "title": "SECOND FLOOR PLAN", "number": "A-102", "size": (2592, 1728), "ipp": 48 / 72,
    "scale": '1/4" = 1\'-0"', "origin": (220, 320), "hatch": False, "arc": "bezier", "ext_t": 10, "int_t": 5,
    "ext_w": 1.0, "int_w": 0.5,
    "walls": [((0, 0), (64, 0), "ext"), ((64, 0), (64, 40), "ext"), ((0, 40), (64, 40), "ext"), ((0, 0), (0, 40), "ext"),
              ((0, 16), (64, 16), "int"), ((0, 22), (64, 22), "int"),
              ((16, 0), (16, 16), "int"), ((32, 0), (32, 16), "int"), ((48, 0), (48, 16), "int"),
              ((20, 22), (20, 40), "int"), ((40, 22), (40, 40), "int")],
    "rooms": [((0, 0, 16, 16), "OFFICE", "201"), ((16, 0, 32, 16), "OFFICE", "202"), ((32, 0, 48, 16), "CONFERENCE", "203"),
              ((48, 0, 64, 16), "OFFICE", "204"), ((0, 16, 64, 22), "CORRIDOR", "205"), ((0, 22, 20, 40), "OPEN OFFICE", "206"),
              ((20, 22, 40, 40), "STORAGE", "207"), ((40, 22, 64, 40), "BREAK ROOM", "208")],
    "doors": [(4, 8, 3, -1, "lo", "201A"), (4, 24, 3, -1, "hi", "202A"), (4, 40, 3, -1, "lo", ""), (4, 56, 3, -1, "hi", "204A"),
              (5, 10, 3, 1, "lo", "206A"), (5, 30, 3, 1, "hi", "207A"), (5, 52, 3, 1, "lo", ""), (3, 19, 5.33, -1, "pair", "200A")],
    "windows": [(0, 8, 5), (0, 24, 5), (0, 40, 6), (0, 56, 5), (2, 10, 6), (2, 30, 4), (2, 52, 6), (1, 8, 4), (1, 31, 4)],
    "outlets": [(1.3, 8), (14.7, 8), (24, 1.3), (30.7, 8), (40, 1.3), (40, 14.7), (56, 1.3), (62.7, 8), (5, 38.7), (15, 38.7),
                (1.3, 31), (30, 38.7), (38.7, 30), (52, 38.7), (62.7, 31)],
    "detectors": [(11, 11), (27, 11), (43, 11), (59, 11), (44, 19), (14, 34), (34, 34), (58, 34)],
    "legend": (66, 4),
    "shelf": (22, 37.5, 8, 1.0),
    "table": (36, 6, 8, 4),
    "dims": [(0, 16, -4), (16, 32, -4), (32, 48, -4), (48, 64, -4), (0, 64, -7)],
}

CLINIC = {
    "name": "P-CLINIC", "title": "CLINIC PLAN", "number": "A-103", "size": (1728, 1296), "ipp": 96 / 72,
    "scale": '1/8" = 1\'-0"', "origin": (180, 300), "hatch": True, "arc": "polyline", "ext_t": 8, "int_t": 4.875,
    "ext_w": 0.6, "int_w": 0.4,
    "walls": [((0, 0), (100, 0), "ext"), ((100, 0), (100, 60), "ext"), ((0, 60), (100, 60), "ext"), ((0, 0), (0, 60), "ext"),
              ((0, 25), (100, 25), "int"), ((0, 33), (100, 33), "int"),
              ((20, 0), (20, 25), "int"), ((40, 0), (40, 25), "int"), ((60, 0), (60, 25), "int"), ((80, 0), (80, 25), "int"),
              ((25, 33), (25, 60), "int"), ((50, 33), (50, 60), "int"), ((75, 33), (75, 60), "int")],
    "rooms": [((0, 0, 20, 25), "WAITING", "1"), ((20, 0, 40, 25), "EXAM", "2"), ((40, 0, 60, 25), "EXAM", "3"),
              ((60, 0, 80, 25), "EXAM", "4"), ((80, 0, 100, 25), "LAB", "5"), ((0, 25, 100, 33), "CORRIDOR", "6"),
              ((0, 33, 25, 60), "RECEPTION", "7"), ((25, 33, 50, 60), "OFFICE", "8"), ((50, 33, 75, 60), "STAFF", "9"),
              ((75, 33, 100, 60), "STORAGE", "10")],
    "doors": [(4, 10, 3, -1, "lo", "1A"), (4, 30, 3, -1, "hi", "2A"), (4, 50, 3, -1, "lo", "3A"), (4, 70, 3, -1, "hi", ""),
              (4, 90, 3, -1, "lo", "5A"), (5, 12, 3, 1, "hi", "7A"), (5, 37, 3, 1, "lo", "8A"), (5, 62, 3, 1, "hi", ""),
              (5, 88, 3, 1, "lo", "10A"), (0, 10, 6, 1, "pair", "1B")],
    "windows": [(0, 30, 6), (0, 50, 6), (0, 70, 6), (0, 90, 5), (2, 12, 6), (2, 37, 6), (2, 62, 6), (2, 88, 6), (3, 12, 5), (1, 12, 5)],
    "outlets": [(1.6, 12), (30, 1.6), (50, 1.6), (70, 1.6), (98.4, 12), (12, 58.4), (37, 58.4), (62, 58.4), (88, 58.4), (48.4, 46)],
    "detectors": [(14, 12), (34, 12), (54, 12), (74, 12), (94, 12), (18, 46), (43, 46), (68, 46), (93, 46)],
    "legend": (0, 66),
    "shelf": None,
    "table": None,
    "dims": [(0, 20, -6), (20, 40, -6), (40, 60, -6), (60, 80, -6), (80, 100, -6), (0, 100, -11)],
}

# Drawn to be hard: exterior walls as solid fills with no outline (poche), doors left open at 45
# and 30 degrees, room names on two lines, door tags in circles (a repeated shape that is not a
# symbol to count), receptacles touching the walls, at 3/16" = 1'-0".
HARD = {
    "name": "P-HARD", "title": "TENANT PLAN", "number": "A-104", "size": (1728, 1296), "ipp": 64 / 72,
    "scale": '3/16" = 1\'-0"', "origin": (200, 320), "hatch": False, "poche": True, "tag_circle": True, "arc": "bezier",
    "ext_t": 8, "int_t": 4.5, "ext_w": 0.7, "int_w": 0.5,
    "walls": [((0, 0), (56, 0), "ext"), ((56, 0), (56, 36), "ext"), ((0, 36), (56, 36), "ext"), ((0, 0), (0, 36), "ext"),
              ((22, 0), (22, 36), "int"), ((22, 16), (56, 16), "int"), ((40, 16), (40, 36), "int"), ((0, 20), (22, 20), "int")],
    "rooms": [((0, 0, 22, 20), "LOBBY", "1"), ((0, 20, 22, 36), "BREAK\nROOM", "2"), ((22, 0, 56, 16), "OPEN OFFICE", "3"),
              ((22, 16, 40, 36), "MEETING", "4"), ((40, 16, 56, 36), "FILE\nSTORAGE", "5")],
    "doors": [(0, 8, 3, 1, "lo", "1"), (7, 11, 3, 1, "hi", "2", 45), (4, 8, 3, -1, "lo", "3"), (5, 31, 3, 1, "lo", "4", 30),
              (5, 48, 3, 1, "hi", ""), (6, 26, 3, 1, "lo", "5")],
    "windows": [(0, 40, 6), (2, 10, 5), (2, 30, 5), (1, 8, 4), (3, 28, 4)],
    "outlets": [(0.667, 6), (0.667, 12), (12, 0.667), (30, 0.667), (46, 0.667), (30, 16.52), (50, 16.52), (8, 35.333), (30, 35.333),
                (48, 35.333)],
    "detectors": [(11, 8), (11, 29), (36, 9), (31, 27), (49, 30)],
    "legend": (0, 41),
    "shelf": None,
    "table": None,
    "dims": [(0, 22, -4), (22, 56, -4), (0, 56, -7)],
}

LAYOUTS = {"house": HOUSE, "office": OFFICE, "clinic": CLINIC, "hard": HARD}


# ---------------------------------------------------------------- drawing


class Plan:
    """A layout drawn on a sheet: line work, curves and text in sheet points, plus labels."""

    def __init__(self, lay):
        self.lay = lay
        self.ipp = lay["ipp"]
        self.k = 12 / self.ipp  # points per foot
        self.W, self.H = lay["size"]
        self.ox, self.oy = lay["origin"]
        self.segs, self.curves, self.text, self.fills = [], [], [], []
        self.labels = {"walls": [], "rooms": [], "doors": [], "windows": [], "symbols": {}, "distractors": []}
        self.draw()

    def P(self, x, y):
        return (self.ox + x * self.k, self.oy + y * self.k)

    def line(self, a, b, w):
        self.segs.append([a[0], a[1], b[0], b[1], w, 0])

    def fill_rect(self, a, b):
        """A filled rectangle with no outline; its edges are fill-only line work."""
        x0, y0, x1, y1 = min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])
        self.fills.append((x0, y0, x1, y1))
        for p, q in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
            self.segs.append([p[0], p[1], q[0], q[1], 0, 1])

    def put_text(self, s, x, y, size):
        self.text.append({"str": s, "x": x, "y": y, "w": round(0.56 * size * len(s), 3), "h": size, "size": size})

    def wall_geom(self):
        """Per wall: axis ('h' or 'v'), fixed coordinate, start, end (ft), thickness (ft), kind."""
        out = []
        for (a, b, kind) in self.lay["walls"]:
            t = (self.lay["ext_t"] if kind == "ext" else self.lay["int_t"]) / 12
            if a[1] == b[1]:
                out.append({"axis": "h", "c": a[1], "s0": min(a[0], b[0]), "s1": max(a[0], b[0]), "t": t, "kind": kind})
            else:
                out.append({"axis": "v", "c": a[0], "s0": min(a[1], b[1]), "s1": max(a[1], b[1]), "t": t, "kind": kind})
        return out

    def draw(self):
        lay, P = self.lay, self.P
        walls = self.wall_geom()
        rects = []
        for w in walls:  # wall rectangles in ft, ends carried half a thickness past the centerline ends
            h = w["t"] / 2
            if w["axis"] == "h":
                rects.append((w["s0"] - h, w["c"] - h, w["s1"] + h, w["c"] + h))
            else:
                rects.append((w["c"] - h, w["s0"] - h, w["c"] + h, w["s1"] + h))
        openings = {i: [] for i in range(len(walls))}
        for d in lay["doors"]:
            openings[d[0]].append((d[1] - d[2] / 2, d[1] + d[2] / 2))
        for wd in lay["windows"]:
            openings[wd[0]].append((wd[1] - wd[2] / 2, wd[1] + wd[2] / 2))
        eps = 1e-9
        for i, w in enumerate(walls):
            lw = lay["ext_w"] if w["kind"] == "ext" else lay["int_w"]
            r = rects[i]
            if w["kind"] == "ext" and lay.get("poche"):
                lo, hi = (r[0], r[2]) if w["axis"] == "h" else (r[1], r[3])
                h = w["t"] / 2
                for a, b in _subtract((lo, hi), openings[i]):
                    if w["axis"] == "h":
                        self.fill_rect(P(a, w["c"] - h), P(b, w["c"] + h))
                    else:
                        self.fill_rect(P(w["c"] - h, a), P(w["c"] + h, b))
            for side in (-1, 1) if not (w["kind"] == "ext" and lay.get("poche")) else ():
                off = w["c"] + side * w["t"] / 2
                lo, hi = (r[0], r[2]) if w["axis"] == "h" else (r[1], r[3])
                cuts = list(openings[i])
                for j, q in enumerate(rects):
                    if j == i:
                        continue
                    if w["axis"] == "h":
                        if q[1] + eps < off < q[3] - eps:
                            cuts.append((q[0], q[2]))
                    else:
                        if q[0] + eps < off < q[2] - eps:
                            cuts.append((q[1], q[3]))
                for a, b in _subtract((lo, hi), cuts):
                    if b - a < 1e-6:
                        continue
                    if w["axis"] == "h":
                        self.line(P(a, off), P(b, off), lw)
                    else:
                        self.line(P(off, a), P(off, b), lw)
            # label: the centerline from junction to junction
            if w["axis"] == "h":
                a, b = P(w["s0"], w["c"]), P(w["s1"], w["c"])
            else:
                a, b = P(w["c"], w["s0"]), P(w["c"], w["s1"])
            self.labels["walls"].append({"a": list(a), "b": list(b), "t_in": w["t"] * 12, "kind": w["kind"]})
            if w["kind"] == "ext" and lay["hatch"]:
                self.hatch(w, openings[i])
        for i, w in enumerate(walls):  # jambs at every opening
            for a, b in openings[i]:
                for s in (a, b):
                    h = w["t"] / 2
                    if w["axis"] == "h":
                        self.line(P(s, w["c"] - h), P(s, w["c"] + h), lay["int_w"])
                    else:
                        self.line(P(w["c"] - h, s), P(w["c"] + h, s), lay["int_w"])
        for d in lay["doors"]:
            self.door(walls[d[0]], *d[1:])
        for wd in lay["windows"]:
            self.window(walls[wd[0]], *wd[1:])
        self.rooms(walls)
        self.symbols()
        self.extras()
        self.title_block()

    def hatch(self, w, openings):
        """45 degree lines every 5 pt across an exterior wall, clipped to it (corners left plain)."""
        h = w["t"] / 2
        step = 5 / self.k
        lo, hi = w["s0"] + h, w["s1"] - h
        spans = _subtract((lo, hi), openings)
        for a, b in spans:
            s = a + step / 2
            while s < b:
                # a diagonal across the band: from (s, -h) to (s + 2h, +h), clipped to [a, b]
                x0, x1 = s, s + 2 * h
                if x1 > b:
                    break
                if w["axis"] == "h":
                    self.line(self.P(x0, w["c"] - h + 0.01), self.P(x1, w["c"] + h - 0.01), 0.2)
                else:
                    self.line(self.P(w["c"] - h + 0.01, x0), self.P(w["c"] + h - 0.01, x1), 0.2)
                s += step

    def _pt(self, w, along, off):
        return self.P(along, w["c"] + off) if w["axis"] == "h" else self.P(w["c"] + off, along)

    def door(self, w, center, width, side, hinge, tag, angle=90):
        """side: the leaf swings toward +1 (larger y on a horizontal wall, larger x on a vertical one) or -1."""
        h = w["t"] / 2
        lo, hi = center - width / 2, center + width / 2
        off_face = side * h
        swing = side
        leaves = [(lo, width / 2, 1), (hi, width / 2, -1)] if hinge == "pair" else ([(lo, width, 1)] if hinge == "lo" else [(hi, width, -1)])
        for hpos, r, dirn in leaves:
            hinge_p = self._pt(w, hpos, off_face)
            ca, sa = math.cos(math.radians(angle)), math.sin(math.radians(angle))
            open_p = self._pt(w, hpos + dirn * r * ca, off_face + swing * r * sa)
            closed_p = self._pt(w, hpos + dirn * r, off_face)
            self.line(hinge_p, open_p, 0.35)
            self.arc(hinge_p, open_p, closed_p, r * self.k)
        mid = self._pt(w, center, off_face)
        hp, rr, dn = leaves[0]
        swing_box = [self._pt(w, hp, off_face), self._pt(w, hp, off_face + swing * rr * math.sin(math.radians(angle))), self._pt(w, hp + dn * rr, off_face)]
        if hinge == "pair":
            hp2, _, dn2 = leaves[1]
            swing_box += [self._pt(w, hp2, off_face), self._pt(w, hp2, off_face + swing * rr)]
        xs, ys = [q[0] for q in swing_box], [q[1] for q in swing_box]
        self.labels["doors"].append({"at": list(mid), "width_in": width * 12, "leaves": 2 if hinge == "pair" else 1, "tag": tag, "angle": angle,
                                     "box": [min(xs), min(ys), max(xs), max(ys)]})
        if tag:
            tp = self._pt(w, center, off_face + swing * (width * 0.5 + 1.5) if hinge != "pair" else off_face - swing * 2.5)
            self.put_text(tag, tp[0] - 3 * len(tag), tp[1] + 3, 6)
            if self.lay.get("tag_circle"):
                self.circle(tp[0] - 3 * len(tag) + 0.56 * 6 * len(tag) / 2, tp[1], 6.5, 0.25)

    def arc(self, c, p0, p1, r):
        a0 = math.atan2(p0[1] - c[1], p0[0] - c[0])
        a1 = math.atan2(p1[1] - c[1], p1[0] - c[0])
        d = a1 - a0
        while d > math.pi:
            d -= 2 * math.pi
        while d < -math.pi:
            d += 2 * math.pi
        if self.lay["arc"] == "polyline":
            n = 8
            pts = [(c[0] + r * math.cos(a0 + d * i / n), c[1] + r * math.sin(a0 + d * i / n)) for i in range(n + 1)]
            pts[0], pts[-1] = p0, p1
            for i in range(n):
                self.line(pts[i], pts[i + 1], 0.25)
            return
        k = 4 / 3 * math.tan(d / 4)
        q0 = (p0[0] - k * (p0[1] - c[1]), p0[1] + k * (p0[0] - c[0]))
        q1 = (p1[0] + k * (p1[1] - c[1]), p1[1] - k * (p1[0] - c[0]))
        self.curves.append([p0[0], p0[1], q0[0], q0[1], q1[0], q1[1], p1[0], p1[1], 0.25])

    def window(self, w, center, width):
        h = w["t"] / 2
        lo, hi = center - width / 2, center + width / 2
        for off in (-h, h):
            self.line(self._pt(w, lo, off), self._pt(w, hi, off), 0.35)
        self.line(self._pt(w, lo, 0), self._pt(w, hi, 0), 0.25)
        self.labels["windows"].append({"at": list(self._pt(w, center, 0)), "width_in": width * 12})

    def rooms(self, walls):
        lay = self.lay
        for (x0, y0, x1, y1), name, num in lay["rooms"]:
            # clear outline: each side moved in by half of the wall on it
            def half(axis, c, s0, s1):
                best = None
                for w in walls:
                    if w["axis"] == axis and abs(w["c"] - c) < 1e-9 and w["s0"] <= s0 + 1e-9 and w["s1"] >= s1 - 1e-9:
                        best = w["t"] / 2
                return best
            top, bot = half("h", y0, x0, x1), half("h", y1, x0, x1)
            lef, rig = half("v", x0, y0, y1), half("v", x1, y0, y1)
            cx0, cy0, cx1, cy1 = x0 + lef, y0 + top, x1 - rig, y1 - bot
            poly = [self.P(cx0, cy0), self.P(cx1, cy0), self.P(cx1, cy1), self.P(cx0, cy1)]
            self.labels["rooms"].append({"name": name.replace("\n", " "), "number": num, "pts": [list(p) for p in poly],
                                         "area_sq_in": (cx1 - cx0) * (cy1 - cy0) * 144})
            cx, cy = self.P((x0 + x1) / 2, (y0 + y1) / 2)
            parts = name.split("\n")
            for n, part in enumerate(parts):
                self.put_text(part, cx - 0.56 * 9 * len(part) / 2, cy + 11 * (n - len(parts) + 1), 9)
            self.put_text(num, cx - 0.56 * 7 * len(num) / 2, cy + 11, 7)

    def outlet(self, cx, cy):
        r = 4.5
        self.circle(cx, cy, r, 0.35)
        for sx in (-0.4, 0.4):
            self.line((cx + sx * r, cy - 0.5 * r), (cx + sx * r, cy + 0.5 * r), 0.35)

    def detector(self, cx, cy):
        s = 5
        for a, b in (((-s, -s), (s, -s)), ((s, -s), (s, s)), ((s, s), (-s, s)), ((-s, s), (-s, -s))):
            self.line((cx + a[0], cy + a[1]), (cx + b[0], cy + b[1]), 0.35)
        self.circle(cx, cy, 3, 0.35)

    def circle(self, cx, cy, r, w):
        k = K_ARC * r
        pts = [(cx + r, cy), (cx, cy + r), (cx - r, cy), (cx, cy - r), (cx + r, cy)]
        ctrl = [((cx + r, cy + k), (cx + k, cy + r)), ((cx - k, cy + r), (cx - r, cy + k)),
                ((cx - r, cy - k), (cx - k, cy - r)), ((cx + k, cy - r), (cx + r, cy - k))]
        for i in range(4):
            a, b = pts[i], pts[i + 1]
            (c1, c2) = ctrl[i]
            self.curves.append([a[0], a[1], c1[0], c1[1], c2[0], c2[1], b[0], b[1], w])

    def symbols(self):
        lay = self.lay
        outs = [self.P(x, y) for x, y in lay["outlets"]]
        dets = [self.P(x, y) for x, y in lay["detectors"]]
        for p in outs:
            self.outlet(*p)
        for p in dets:
            self.detector(*p)
        self.labels["symbols"] = {"DUPLEX RECEPTACLE": [list(p) for p in outs], "SMOKE DETECTOR": [list(p) for p in dets]}
        lx, ly = lay["legend"]
        p = self.P(lx + 1, ly)
        self.outlet(*p)
        self.put_text("DUPLEX RECEPTACLE", p[0] + 12, p[1] + 3, 7)
        p = self.P(lx + 1, ly + 2.5 * 18 / self.k)
        self.detector(*p)
        self.put_text("SMOKE DETECTOR", p[0] + 12, p[1] + 3, 7)
        self.put_text("LEGEND", self.P(lx, ly)[0], self.P(lx, ly)[1] - 14, 8)

    def extras(self):
        lay, P = self.lay, self.P
        if lay.get("shelf"):
            x, y, L, dpt = lay["shelf"]
            self.line(P(x, y), P(x + L, y), 0.35)
            self.line(P(x, y + dpt), P(x + L, y + dpt), 0.35)
            self.line(P(x, y), P(x, y + dpt), 0.35)
            self.line(P(x + L, y), P(x + L, y + dpt), 0.35)
            a, b = P(x, y + dpt / 2), P(x + L, y + dpt / 2)
            self.labels["distractors"].append({"kind": "shelf", "a": list(a), "b": list(b)})
        if lay.get("table"):
            x, y, w, d = lay["table"]
            for a, b in (((x, y), (x + w, y)), ((x + w, y), (x + w, y + d)), ((x + w, y + d), (x, y + d)), ((x, y + d), (x, y))):
                self.line(P(*a), P(*b), 0.3)
        for x0, x1, y in lay["dims"]:
            a, b = P(x0, y), P(x1, y)
            self.line(a, b, 0.18)
            for x in (a, b):
                self.line((x[0], x[1] - 4), (x[0], x[1] + 18), 0.18)
                self.line((x[0] - 3, x[1] + 3), (x[0] + 3, x[1] - 3), 0.35)
            s = _ftin(x1 - x0)
            self.put_text(s, (a[0] + b[0]) / 2 - 0.56 * 7 * len(s) / 2, a[1] - 3, 7)

    def title_block(self):
        W, H = self.W, self.H
        m = 36
        for a, b in (((m, m), (W - m, m)), ((W - m, m), (W - m, H - m)), ((W - m, H - m), (m, H - m)), ((m, H - m), (m, m))):
            self.line(a, b, 1.0)
        x = W - m - 216
        self.line((x, m), (x, H - m), 0.7)
        for y in (H - m - 72, H - m - 144, H - m - 216):
            self.line((x, y), (W - m, y), 0.35)
        self.put_text("EXAMPLE DATA - INVENTED PROJECT", x + 12, m + 30, 8)
        self.put_text("SHEET TITLE", x + 12, H - m - 196, 6)
        self.put_text(self.lay["title"], x + 12, H - m - 170, 12)
        self.put_text("SCALE: " + self.lay["scale"], x + 12, H - m - 120, 9)
        self.put_text(self.lay["number"], x + 12, H - m - 30, 24)

    def page(self):
        """The line work as the app reads it from the PDF (rotation 0)."""
        return {"w": self.W, "h": self.H, "segs": [list(s) for s in self.segs], "curves": [list(c) for c in self.curves],
                "text": [{k: t[k] for k in ("str", "x", "y", "w", "h")} for t in self.text], "in_per_pt": self.ipp}

    def content(self):
        """PDF content stream: sheet points are y-down from the top left; PDF user space is y-up."""
        H = self.H
        f = lambda v: f"{v:.3f}"  # noqa: E731
        ops = ["0 G 0 g 1 J 1 j"]
        cur = None
        for x0, y0, x1, y1 in self.fills:
            ops.append(f"{f(x0)} {f(H - y1)} {f(x1 - x0)} {f(y1 - y0)} re f")
        for s in self.segs:
            if s[5] == 1:
                continue
            if s[4] != cur:
                ops.append(f"{s[4]:g} w")
                cur = s[4]
            ops.append(f"{f(s[0])} {f(H - s[1])} m {f(s[2])} {f(H - s[3])} l S")
        for c in self.curves:
            if c[8] != cur:
                ops.append(f"{c[8]:g} w")
                cur = c[8]
            ops.append(f"{f(c[0])} {f(H - c[1])} m {f(c[2])} {f(H - c[3])} {f(c[4])} {f(H - c[5])} {f(c[6])} {f(H - c[7])} c S")
        for t in self.text:
            s = t["str"].replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            ops.append(f"BT /F1 {t['size']:g} Tf {f(t['x'])} {f(H - t['y'])} Td ({s}) Tj ET")
        return "\n".join(ops).encode()


def _subtract(span, cuts):
    out = [span]
    for a, b in sorted(cuts):
        nxt = []
        for x, y in out:
            if b <= x or a >= y:
                nxt.append((x, y))
                continue
            if a > x:
                nxt.append((x, a))
            if b < y:
                nxt.append((b, y))
        out = nxt
    return out


def _ftin(ft):
    whole = int(math.floor(ft + 1e-9))
    inch = round((ft - whole) * 12)
    return f"{whole}'-{inch}\""


# ---------------------------------------------------------------- rotation, scans and PDFs


def rotate_point(p, W, H, rotate):
    """A sheet point at /Rotate 0 to where the viewer shows it with /Rotate (clockwise)."""
    x, y = p
    r = rotate % 360
    if r == 0:
        return [x, y]
    if r == 90:
        return [H - y, x]
    if r == 180:
        return [W - x, H - y]
    return [y, W - x]


def map_labels(labels, fn):
    def pt(p):
        return [round(v, 4) for v in fn(p)]
    out = {"walls": [dict(w, a=pt(w["a"]), b=pt(w["b"])) for w in labels["walls"]],
           "rooms": [dict(r, pts=[pt(p) for p in r["pts"]]) for r in labels["rooms"]],
           "doors": [dict(d, at=pt(d["at"]), box=_box_of([fn(q) for q in ((d["box"][0], d["box"][1]), (d["box"][2], d["box"][1]), (d["box"][2], d["box"][3]), (d["box"][0], d["box"][3]))])) for d in labels["doors"]],
           "windows": [dict(d, at=pt(d["at"])) for d in labels["windows"]],
           "symbols": {k: [pt(p) for p in v] for k, v in labels["symbols"].items()},
           "distractors": [dict(d, a=pt(d["a"]), b=pt(d["b"])) for d in labels["distractors"]]}
    return out


def _box_of(pts):
    return [round(min(p[0] for p in pts), 4), round(min(p[1] for p in pts), 4), round(max(p[0] for p in pts), 4), round(max(p[1] for p in pts), 4)]


def sheet_labels(plan, rotate=0, skew=0.0):
    W, H = plan.W, plan.H

    def fn(p):
        q = rotate_point(p, W, H, rotate)
        if skew:
            ww, hh = (H, W) if rotate % 180 else (W, H)
            cx, cy = ww / 2, hh / 2
            a = math.radians(skew)
            dx, dy = q[0] - cx, q[1] - cy
            q = [cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a)]
        return q
    return map_labels(plan.labels, fn)


def vector_pdf(plans, build_pdf, stream):
    """plans: [(Plan, rotate)]. build_pdf and stream come from tests/pdf_fixtures.py."""
    objs = {1: b"<< /Type /Catalog /Pages 2 0 R >>", 3: FONT}
    kids = []
    n = 10
    for plan, rotate in plans:
        objs[n] = stream(plan.content())
        objs[n + 1] = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {plan.W} {plan.H}] /Rotate {rotate} /Contents {n} 0 R "
                       f"/Resources << /Font << /F1 3 0 R >> >> >>").encode()
        kids.append(f"{n + 1} 0 R")
        n += 2
    objs[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode()
    return build_pdf(objs)


def scan_gray(plan, dpi, skew, seed=5):
    """The sheet painted into a grayscale picture at dpi, turned by skew degrees, with specks.
    Returns (bytes, width, height). Needs Pillow."""
    from PIL import Image, ImageDraw, ImageFont
    k = dpi / 72
    Wp, Hp = round(plan.W * k), round(plan.H * k)
    img = Image.new("L", (Wp, Hp), 244)
    d = ImageDraw.Draw(img)
    for x0, y0, x1, y1 in plan.fills:
        d.rectangle([x0 * k, y0 * k, x1 * k, y1 * k], fill=20)
    for s in plan.segs:
        if s[5] == 1:
            continue
        d.line([(s[0] * k, s[1] * k), (s[2] * k, s[3] * k)], fill=20, width=max(1, round(s[4] * k * 1.4)))
    for c in plan.curves:
        p = [(c[i], c[i + 1]) for i in (0, 2, 4, 6)]
        pts = []
        for i in range(17):
            t = i / 16
            m = 1 - t
            pts.append(((m ** 3 * p[0][0] + 3 * m * m * t * p[1][0] + 3 * m * t * t * p[2][0] + t ** 3 * p[3][0]) * k,
                        (m ** 3 * p[0][1] + 3 * m * m * t * p[1][1] + 3 * m * t * t * p[2][1] + t ** 3 * p[3][1]) * k))
        d.line(pts, fill=20, width=max(1, round(c[8] * k * 1.4)))

    def font(pt):
        size = max(6, round(pt * k))
        for name in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                pass
        return ImageFont.load_default(size=size)
    for t in plan.text:
        d.text((t["x"] * k, (t["y"] - t["size"]) * k), t["str"], fill=15, font=font(t["size"]))
    rnd = random.Random(seed)
    for _ in range(int(Wp * Hp / 60000)):
        x, y = rnd.randrange(Wp - 3), rnd.randrange(Hp - 3)
        d.rectangle([x, y, x + rnd.randrange(1, 3), y + rnd.randrange(1, 3)], fill=rnd.randrange(60, 160))
    if skew:
        img = img.rotate(-skew, resample=Image.BILINEAR, fillcolor=244)
    return img.tobytes(), Wp, Hp


def scan_pdf(plan, dpi, skew, build_pdf, stream):
    data, Wp, Hp = scan_gray(plan, dpi, skew)
    z = zlib.compress(data, 6)
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
        3: FONT,
        4: f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {plan.W} {plan.H}] /Contents 5 0 R /Resources << /XObject << /Im0 6 0 R >> >> >>".encode(),
        5: stream(f"q {plan.W} 0 0 {plan.H} 0 0 cm /Im0 Do Q".encode()),
        6: f"<< /Type /XObject /Subtype /Image /Width {Wp} /Height {Hp} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length {len(z)} /Filter /FlateDecode >>\nstream\n".encode()
           + z + b"\nendstream",
    }
    return build_pdf(objs)


def sheets():
    """The auto-takeoff sheets of the corpus: (file, [(Plan, rotate)], kind, extra)."""
    house, office, clinic, hard = Plan(HOUSE), Plan(OFFICE), Plan(CLINIC), Plan(HARD)
    return [
        ("plans.pdf", [(house, 0), (office, 0), (clinic, 0), (house, 90), (hard, 0)], "vector", None),
        ("plans-scan-200.pdf", [(house, 0)], "scan", {"dpi": 200, "skew": 0.6}),
    ]


def write_files(out_dir, build_pdf, stream):
    """Write the auto-takeoff sheets into out_dir and return their manifest entries (with labels).
    A scanned sheet also gets its picture as a raw grayscale file (.gray) for the evaluation."""
    from pathlib import Path
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for name, plans, kind, extra in sheets():
        if kind == "vector":
            data = vector_pdf(plans, build_pdf, stream)
            (out_dir / name).write_bytes(data)
            entries.append({"file": name, "kind": "autotakeoff", "bytes": len(data), "sheets": [
                {"page": i, "name": p.lay["name"], "number": p.lay["number"], "in_per_pt": p.ipp, "rotate": rot, "scan": None,
                 "labels": sheet_labels(p, rot)} for i, (p, rot) in enumerate(plans)]})
        else:
            plan = plans[0][0]
            data = scan_pdf(plan, extra["dpi"], extra["skew"], build_pdf, stream)
            (out_dir / name).write_bytes(data)
            gray, wp, hp = scan_gray(plan, extra["dpi"], extra["skew"])
            raw = name.replace(".pdf", ".gray")
            (out_dir / raw).write_bytes(gray)
            entries.append({"file": name, "kind": "autotakeoff-scan", "bytes": len(data), "raw": raw, "pixels": [wp, hp], "sheets": [
                {"page": 0, "name": plan.lay["name"] + "-SCAN", "number": plan.lay["number"], "in_per_pt": plan.ipp, "rotate": 0,
                 "scan": extra, "labels": sheet_labels(plan, 0, extra["skew"])}]})
    return entries
