"""Markups as standard PDF annotations, both ways.

Other PDF programs keep markups as annotations in the page's /Annots array (ISO 32000, 12.5).
Measurements carry a /Measure dictionary (ISO 32000, 12.9: a rectilinear measure, /Subtype /RL,
with number format arrays /X for the scale and /D, /A for distance and area units, each entry's
/C a conversion factor). This module maps between our markups and a plain description of an
annotation; the browser reads and writes the PDF objects themselves (pdf-lib) and hands this
module plain values, so the mapping is pure and the same in Python and in the browser core.

A plain annotation is a dict with these keys (all optional except subtype and rect):

  subtype   "Line", "PolyLine", "Polygon", "Square", "Circle", "FreeText", "Ink", "Highlight", "Stamp"
  rect      [x0, y0, x1, y1] in PDF user space
  it        the intent name (/IT), for example "LineDimension" or "PolygonDimension"
  l         [x1, y1, x2, y2] for a Line          vertices  [x1, y1, x2, y2, ...] for PolyLine, Polygon
  ink       [[x1, y1, ...], ...] for Ink          quad      [x1, y1, ... 8 per box] for Highlight
  cl        [x1, y1, x2, y2(, x3, y3)] callout line for FreeText
  rd        [left, top, right, bottom] inset of the drawn shape in a Square or Circle rect
  le        [start, end] line ending names       cloudy    true when the border effect is cloudy
  color, interior   [r, g, b] from 0 to 1        opacity   /CA          width   border width
  contents, subject, title (author), nm (unique name), m and creation (PDF dates), label
  measure   {"r": label, "x": [{"u", "c"}], "d": [...], "a": [...], "v": [...]}
  private   this tool's own markup (an object; written into the PDF as JSON text under a private
            key), kept so a round trip loses nothing

Intent names follow the standard (LineArrow, LineDimension, PolyLineDimension, PolygonDimension,
PolygonCloud, FreeTextCallout); the names another program writes for volume, count, angle,
radius and diameter measurements (PolygonVolume, PolygonCount, PolyLineAngle, PolygonRadius,
CircleDimension) were read from publicly shared files and are used for those types.

Sheet points (x right, y down, the page's own /Rotate and crop applied) map to user space by the
inverse of the page transform: ctx["transform"] is the pdf.js viewport transform at scale 1.
"""

from __future__ import annotations

import json
import math
import re

from . import geometry as g
from .errors import TakeoffError
from .markups import clean_markup, display
from .measure import MEASURE_TYPES, measure

UNIT_INCHES = {
    "'": 12.0, "ft": 12.0, "feet": 12.0, "foot": 12.0, "ft'": 12.0,
    '"': 1.0, "in": 1.0, "inch": 1.0, "inches": 1.0,
    "yd": 36.0, "yard": 36.0, "yards": 36.0, "mi": 63360.0,
    "m": 1 / 0.0254, "cm": 1 / 2.54, "mm": 1 / 25.4, "km": 1000 / 0.0254,
}
METRIC_UNITS = ("m", "cm", "mm")
ROUND = 1000.0


def _r3(x):
    return math.floor(x * ROUND + 0.5) / ROUND


def mat_inv(m):
    det = m[0] * m[3] - m[1] * m[2]
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det,
            (m[1] * m[4] - m[0] * m[5]) / det]


def mat_apply(m, x, y):
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]


def to_user(ctx, p):
    q = mat_apply(mat_inv(ctx["transform"]), p[0], p[1])
    return [_r3(q[0]), _r3(q[1])]


def to_sheet(ctx, x, y):
    q = mat_apply(ctx["transform"], x, y)
    return [_r3(q[0]), _r3(q[1])]


def _flat(pts):
    out = []
    for p in pts:
        out.extend(p)
    return out


def _pairs(flat):
    if not isinstance(flat, list):
        return []
    nums = [float(v) for v in flat[:2 * 20000] if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and abs(v) <= 1e7]
    return [[nums[i], nums[i + 1]] for i in range(0, len(nums) - 1, 2)]


def _nums(v, n):
    """A list of n finite numbers (within the coordinate limit), or None."""
    if not isinstance(v, list) or len(v) != n:
        return None
    out = []
    for x in v:
        if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or abs(x) > 1e7:
            return None
        out.append(float(x))
    return out


def hex_to_rgb(h):
    n = int(h[1:], 16)
    return [_r3(((n >> 16) & 255) / 255), _r3(((n >> 8) & 255) / 255), _r3((n & 255) / 255)]


def rgb_to_hex(c):
    """#rrggbb from a PDF color array: gray (1), RGB (3) or CMYK (4) components from 0 to 1."""
    if not isinstance(c, list) or len(c) not in (1, 3, 4):
        return None
    v = [float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) else 0.0 for x in c]
    v = [min(1.0, max(0.0, x)) for x in v]
    if len(v) == 1:
        rgb = [v[0]] * 3
    elif len(v) == 4:
        k = v[3]
        rgb = [(1 - v[0]) * (1 - k), (1 - v[1]) * (1 - k), (1 - v[2]) * (1 - k)]
    else:
        rgb = v
    return "#" + "".join(f"{int(math.floor(x * 255 + 0.5)):02x}" for x in rgb)


_PDF_DATE = re.compile(r"^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+\-])?(\d{2})?'?(\d{2})?'?")


def pdf_date_to_iso(s):
    """A PDF date (D:YYYYMMDDHHmmSS+HH'mm') as UTC text YYYY-MM-DDTHH:MM:SSZ, or ""."""
    if not isinstance(s, str):
        return ""
    m = _PDF_DATE.match(s.strip())
    if not m:
        return ""
    y = int(m.group(1))
    mo, d = int(m.group(2) or 1), int(m.group(3) or 1)
    hh, mi, ss = int(m.group(4) or 0), int(m.group(5) or 0), int(m.group(6) or 0)
    if not (1 <= mo <= 12 and 1 <= d <= 31 and hh <= 23 and mi <= 59 and ss <= 59):
        return ""
    off = 0
    if m.group(7) in ("+", "-"):
        off = (int(m.group(8) or 0) * 60 + int(m.group(9) or 0)) * (1 if m.group(7) == "+" else -1)
    days = _days_from_civil(y, mo, d)
    t = days * 86400 + hh * 3600 + mi * 60 + ss - off * 60
    return _iso(t)


def _days_from_civil(y, m, d):
    y -= m <= 2
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def _iso(t):
    days, rem = divmod(t, 86400)
    z = days + 719468
    era = (z if z >= 0 else z - 146096) // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + (3 if mp < 10 else -9)
    y += m <= 2
    return f"{y:04d}-{m:02d}-{d:02d}T{rem // 3600:02d}:{rem % 3600 // 60:02d}:{rem % 60:02d}Z"


def iso_to_pdf_date(s):
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})", s or "")
    if not m:
        return ""
    return "D:" + "".join(m.groups()) + "Z"


def measure_dict(in_per_pt, label, settings):
    """A rectilinear /Measure for a scale: /X converts points to feet (or meters), /D and /A are
    distance and area in those units (/C 1), with inches as the second distance unit for
    feet-and-inches display."""
    metric = settings.get("length_unit") in METRIC_UNITS
    if metric:
        x = {"u": "m", "c": in_per_pt * 0.0254}
        d = [{"u": "m", "c": 1.0}]
        a = [{"u": "sq m", "c": 1.0}]
        v = [{"u": "cu m", "c": 1.0}]
    else:
        x = {"u": "ft", "c": in_per_pt / 12.0}
        d = [{"u": "ft", "c": 1.0}] + ([{"u": "in", "c": 12.0}] if settings.get("length_unit") == "ftin" else [])
        a = [{"u": "sq ft", "c": 1.0}]
        v = [{"u": "cu ft", "c": 1.0}]
    return {"r": label or "", "x": [x], "d": d, "a": a, "v": v}


def scale_from_measure(meas):
    """Real inches per point from a /Measure's first /X number format, or None."""
    if not isinstance(meas, dict):
        return None
    xs = meas.get("x")
    if not isinstance(xs, list) or not xs or not isinstance(xs[0], dict):
        return None
    c = xs[0].get("c")
    u = str(xs[0].get("u", "")).strip().lower()
    if isinstance(c, bool) or not isinstance(c, (int, float)) or not math.isfinite(c) or c <= 0:
        return None
    k = UNIT_INCHES.get(u)
    if k is None:
        return None
    ipp = c * k
    return ipp if 1e-6 <= ipp <= 1e7 else None


def text_box(m):
    """The box a text, callout or stamp takes on the sheet (the same estimate the viewer draws)."""
    t = m["type"]
    p = m["points"]
    if t == "stamp":
        fs = m.get("font_size", 20)
        w = max(3, len(m.get("text", ""))) * fs * 0.68 + fs
        return [p[0][0], p[0][1], p[0][0] + w, p[0][1] + fs * 1.7]
    fs = m.get("font_size", 12)
    lines = (m.get("text") or "").split("\n")
    wchars = max([4] + [len(ln) for ln in lines])
    q = p[1] if t == "callout" else p[0]
    extra = 2 if t == "callout" else 1
    w = abs(p[-1][0] - q[0]) if len(p) > extra else wchars * fs * 0.56 + fs * 0.8
    h = len(lines) * fs * 1.2 + fs * 0.6
    return [q[0], q[1], q[0] + w, q[1] + h]


SUBTYPE = {
    "length": ("Line", "LineDimension"), "polylength": ("PolyLine", "PolyLineDimension"),
    "perimeter": ("PolyLine", "PolyLineDimension"), "area": ("Polygon", "PolygonDimension"),
    "volume": ("Polygon", "PolygonVolume"), "count": ("Polygon", "PolygonCount"),
    "angle": ("PolyLine", "PolyLineAngle"), "radius": ("Polygon", "PolygonRadius"),
    "diameter": ("Circle", "CircleDimension"), "cloud": ("Polygon", "PolygonCloud"),
    "callout": ("FreeText", "FreeTextCallout"), "text": ("FreeText", ""), "arrow": ("Line", "LineArrow"),
    "line": ("Line", ""), "rect": ("Square", ""), "ellipse": ("Circle", ""), "polygon": ("Polygon", ""),
    "polyline": ("PolyLine", ""), "highlight": ("Highlight", ""), "pen": ("Ink", ""), "stamp": ("Stamp", ""),
    "quantity": ("Square", ""),
}


def _bbox_flat(pts, pad):
    b = g.bbox(pts)
    return [_r3(b[0] - pad), _r3(b[1] - pad), _r3(b[2] + pad), _r3(b[3] + pad)]


def _circle_pts(c, r, n=16):
    return [[c[0] + r * math.cos(2 * math.pi * i / n), c[1] + r * math.sin(2 * math.pi * i / n)] for i in range(n)]


def markup_to_annots(m, ctx):
    """Plain annotations for one markup (a count gives one per counted item). ctx: transform,
    in_per_pt (or None), scale_label, settings."""
    t = m["type"]
    sub, it = SUBTYPE[t]
    st = ctx.get("settings") or {}
    ipp = ctx.get("in_per_pt")
    color = m.get("color") or ctx.get("color") or ""
    base = {"subtype": sub, "it": it, "color": hex_to_rgb(color) if color else [0, 0, 0], "opacity": m.get("opacity", 1.0),
            "width": m.get("width", 1.5), "subject": m.get("subject", ""), "title": m.get("author", ""),
            "nm": m["id"], "m": iso_to_pdf_date(m.get("modified") or m.get("created", "")),
            "creation": iso_to_pdf_date(m.get("created", "")), "label": m.get("label", ""),
            "private": m}
    if t in ("area", "volume", "highlight") or m.get("fill"):
        base["interior"] = hex_to_rgb(m.get("fill") or color) if (m.get("fill") or color) else [0, 0, 0]
    contents = m.get("text", "")
    if t in MEASURE_TYPES:
        try:
            r = measure(m, ipp)
            contents = display(r, st)[0] if st else contents
        except TakeoffError:
            contents = ""
        if ipp is not None and t not in ("count", "angle", "quantity"):
            base["measure"] = measure_dict(ipp, ctx.get("scale_label", ""), st)
    base["contents"] = contents
    U = lambda p: to_user(ctx, p)  # noqa: E731
    P = m["points"]
    pad = float(m.get("width", 1.5)) + 2
    if t == "count":
        out = []
        for i, p in enumerate(P):
            ring = [U(q) for q in _circle_pts(p, 5)]
            a = dict(base, vertices=_flat(ring), rect=_bbox_flat(ring, 1), nm=m["id"] + ("" if i == 0 else "." + str(i)))
            if i:
                a.pop("private")
            out.append(a)
        return out
    if sub == "Line":
        u = [U(P[0]), U(P[1])]
        a = dict(base, l=_flat(u), rect=_bbox_flat(u, pad))
        if t == "arrow":
            a["le"] = ["None", "OpenArrow"]
        return [a]
    if t == "perimeter":
        ring = [U(p) for p in P] + ([U(P[0])] if len(P) > 2 else [])
        return [dict(base, vertices=_flat(ring), rect=_bbox_flat(ring, pad))]
    if t == "radius":
        if len(P) >= 3:
            o = g.circle_through(P[0], P[1], P[2])
            c, e = o["center"], P[0]
        else:
            c, e = P[0], P[1]
        v = [U(e), U(c), U(e)]
        r = g.dist(c, e)
        return [dict(base, vertices=_flat(v), rect=_bbox_flat([U([c[0] - r, c[1] - r]), U([c[0] + r, c[1] + r])], pad))]
    if sub in ("PolyLine", "Polygon"):
        u = [U(p) for p in P]
        a = dict(base, vertices=_flat(u), rect=_bbox_flat(u, pad + (8 if t == "cloud" else 0)))
        if t == "cloud" and len(P) == 2:
            q = [P[0], [P[1][0], P[0][1]], P[1], [P[0][0], P[1][1]]]
            u = [U(p) for p in q]
            a["vertices"] = _flat(u)
        if t == "cloud":
            a["cloudy"] = True
        return [a]
    if sub in ("Square", "Circle"):
        if t == "diameter":
            if len(P) >= 3:
                o = g.circle_through(P[0], P[1], P[2])
                c, r = o["center"], o["radius"]
            else:
                c, r = [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2], g.dist(P[0], P[1]) / 2
            box = [U([c[0] - r, c[1] - r]), U([c[0] + r, c[1] + r])]
        elif t == "quantity":
            box = [U([P[0][0] - 6, P[0][1] - 6]), U([P[0][0] + 6, P[0][1] + 6])]
        else:
            box = [U(P[0]), U(P[1] if len(P) > 1 else P[0])]
        inner = _bbox_flat(box, 0)
        h = _r3(pad / 2)
        return [dict(base, rect=[_r3(inner[0] - h), _r3(inner[1] - h), _r3(inner[2] + h), _r3(inner[3] + h)], rd=[h, h, h, h])]
    if t == "highlight":
        b = _bbox_flat([U(P[0]), U(P[1])], 0)
        return [dict(base, quad=[b[0], b[3], b[2], b[3], b[0], b[1], b[2], b[1]], rect=b, opacity=m.get("opacity", 0.6))]
    if t == "pen":
        u = [U(p) for p in P]
        return [dict(base, ink=[_flat(u)], rect=_bbox_flat(u, pad))]
    box = text_box(m)
    corners = [U([box[0], box[1]]), U([box[2], box[3]])]
    inner = _bbox_flat(corners, 0)
    a = dict(base, rect=inner, contents=m.get("text", ""))
    if t == "callout":
        tip = U(P[0])
        anchor = [box[0] if P[0][0] < box[0] else box[2], (box[1] + box[3]) / 2]
        a["cl"] = tip + U(anchor)
        outer = _bbox_flat(corners + [tip], 2)
        a["rect"] = outer
        # the text box inside the rect: left, top, right and bottom insets
        a["rd"] = [_r3(inner[0] - outer[0]), _r3(outer[3] - inner[3]), _r3(outer[2] - inner[2]), _r3(inner[1] - outer[1])]
    return [a]


def _num_in(text):
    m = re.search(r"-?\d[\d,]*(?:\.\d+)?", text or "")
    return float(m.group(0).replace(",", "")) if m else None


VOLUME_WORDS = (("cu yd", 46656.0), ("cy", 46656.0), ("cu ft", 1728.0), ("cf", 1728.0), ("cu m", 61023.744094732),
                ("m3", 61023.744094732), ("cu in", 1.0))


def _volume_in(text):
    t = (text or "").lower()
    n = _num_in(t)
    if n is None:
        return None
    for word, k in VOLUME_WORDS:
        if word in t:
            return n * k
    return None


def annot_to_markup(a, ctx, page, index):
    """One plain annotation as a markup on page (0 based), or None when it is not a markup type
    this tool keeps. Returns {"markup", "scale", "count"}; count is true for one counted item."""
    if not isinstance(a, dict):
        return None
    sub = a.get("subtype")
    it = str(a.get("it") or "")
    S = lambda x, y: to_sheet(ctx, x, y)  # noqa: E731
    nm = a.get("nm") if isinstance(a.get("nm"), str) else ""
    mid = nm if re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", nm or "") and nm not in ("__proto__", "constructor", "prototype") else f"pdf-{page + 1}-{index + 1}"
    scale = scale_from_measure(a.get("measure"))
    base = {"id": mid, "page": page}
    col = rgb_to_hex(a.get("color"))
    if col:
        base["color"] = col
    fill = rgb_to_hex(a.get("interior"))
    for key, src in (("subject", "subject"), ("author", "title"), ("label", "label")):
        if isinstance(a.get(src), str) and a[src].strip():
            base[key] = a[src]
    created = pdf_date_to_iso(a.get("creation"))
    if created:
        base["created"] = created
    mod = pdf_date_to_iso(a.get("m"))
    if mod:
        base["modified"] = mod
    w = a.get("width")
    if isinstance(w, (int, float)) and not isinstance(w, bool) and 0 <= w <= 100 and w > 0:
        base["width"] = float(w)
    op = a.get("opacity")
    if isinstance(op, (int, float)) and not isinstance(op, bool) and 0 <= op < 1:
        base["opacity"] = float(op)
    contents = a.get("contents") if isinstance(a.get("contents"), str) else ""
    rect = _nums(a.get("rect"), 4)
    rd = _nums(a.get("rd"), 4) or [0.0, 0.0, 0.0, 0.0]
    count = False
    m = None
    if sub == "Line":
        pts = [S(*p) for p in _pairs(a.get("l"))][:2]
        if len(pts) == 2:
            le = a.get("le") or []
            arrow = it == "LineArrow" or any(isinstance(x, str) and "Arrow" in x for x in le)
            t = "length" if (it == "LineDimension" or (scale and not arrow)) else ("arrow" if arrow else "line")
            m = dict(base, type=t, points=pts)
    elif sub in ("PolyLine", "Polygon"):
        pts = [S(*p) for p in _pairs(a.get("vertices"))]
        if sub == "PolyLine":
            if it == "PolyLineAngle" and len(pts) >= 3:
                m = dict(base, type="angle", points=pts[:3])
            elif it == "PolyLineDimension" or scale:
                m = dict(base, type="polylength", points=pts)
            else:
                m = dict(base, type="polyline", points=pts)
        else:
            if it == "PolygonCount" and pts:
                m = dict(base, type="count", points=[[_r3(sum(p[0] for p in pts) / len(pts)), _r3(sum(p[1] for p in pts) / len(pts))]])
                count = True
            elif it == "PolygonRadius" and len(pts) >= 2:
                m = dict(base, type="radius", points=[pts[1], pts[0]])
            elif it == "PolygonVolume" and len(pts) >= 3:
                m = dict(base, type="volume", points=pts, depth=0.0)
                if fill:
                    m["fill"] = fill
                vol = _volume_in(contents)
                if vol is not None and scale:
                    area = abs(g.signed_area(pts)) * scale * scale
                    if area > 0:
                        m["depth"] = _r3(vol / area)
            elif it == "PolygonCloud" or a.get("cloudy"):
                m = dict(base, type="cloud", points=pts)
            elif it == "PolygonDimension" or scale:
                m = dict(base, type="area", points=pts)
                if fill:
                    m["fill"] = fill
            else:
                m = dict(base, type="polygon", points=pts)
                if fill:
                    m["fill"] = fill
    elif sub in ("Square", "Circle") and rect:
        x0, y0 = rect[0] + rd[0], rect[1] + rd[3]
        x1, y1 = rect[2] - rd[2], rect[3] - rd[1]
        p0, p1 = S(x0, y0), S(x1, y1)
        lo = [min(p0[0], p1[0]), min(p0[1], p1[1])]
        hi = [max(p0[0], p1[0]), max(p0[1], p1[1])]
        if sub == "Circle" and (it == "CircleDimension" or scale):
            cy = _r3((lo[1] + hi[1]) / 2)
            m = dict(base, type="diameter", points=[[lo[0], cy], [hi[0], cy]])
        else:
            m = dict(base, type="ellipse" if sub == "Circle" else "rect", points=[lo, hi])
            if fill:
                m["fill"] = fill
    elif sub == "FreeText" and rect:
        p0, p1 = S(rect[0] + rd[0], rect[3] - rd[1]), S(rect[2] - rd[2], rect[1] + rd[3])
        lo = [min(p0[0], p1[0]), min(p0[1], p1[1])]
        text = contents or " "
        cl = [S(*p) for p in _pairs(a.get("cl"))]
        if it == "FreeTextCallout" and cl:
            m = dict(base, type="callout", points=[cl[0], lo], text=text)
        else:
            m = dict(base, type="text", points=[lo], text=text)
    elif sub == "Ink":
        strokes = a.get("ink") if isinstance(a.get("ink"), list) else []
        if strokes:
            pts = [S(*p) for p in _pairs(strokes[0])]
            m = dict(base, type="pen", points=pts)
    elif sub == "Highlight":
        pts = [S(*p) for p in _pairs(a.get("quad"))]
        if len(pts) >= 2:
            b = g.bbox(pts)
            m = dict(base, type="highlight", points=[[b[0], b[1]], [b[2], b[3]]])
    elif sub == "Stamp" and rect:
        p0, p1 = S(rect[0], rect[3]), S(rect[2], rect[1])
        m = dict(base, type="stamp", points=[[min(p0[0], p1[0]), min(p0[1], p1[1])]], text=(contents or a.get("subject") or "STAMP")[:200])
    if m is None:
        return None
    priv = a.get("private")
    pm = None
    if isinstance(priv, str) and priv:
        try:
            pm = json.loads(priv)
        except ValueError:
            pm = None
    elif isinstance(priv, dict):
        pm = priv
    if True:
        if isinstance(pm, dict) and pm.get("type") and pm.get("id") == m["id"]:
            same = pm.get("type") == m["type"] or (pm.get("type") == "perimeter" and m["type"] == "polylength")
            if same:
                cp = clean_markup(dict(pm, page=page))
                if cp and _geometry_matches(cp, m):
                    m = cp
                elif cp:
                    keep = {k: v for k, v in cp.items() if k not in ("points", "holes", "type", "page")}
                    m = dict(m, **keep)
    c = clean_markup(m)
    if c is None:
        return None
    return {"markup": c, "scale": scale, "count": count}


def _close(p, q, tol=0.5):
    return abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol


def _circle_of(m):
    P = m["points"]
    if len(P) >= 3:
        o = g.circle_through(P[0], P[1], P[2])
        return o["center"], o["radius"]
    if m["type"] == "radius":
        return P[0], g.dist(P[0], P[1])
    return [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2], g.dist(P[0], P[1]) / 2


def _geometry_matches(stored, read):
    """True when the geometry read from the annotation is the stored markup's own (within half a
    point), so the stored copy with its cutouts, settings and comments can be used whole."""
    a, b = stored["points"], read["points"]
    t = stored["type"]
    if t == "cloud" and len(a) == 2:
        a = [a[0], [a[1][0], a[0][1]], a[1], [a[0][0], a[1][1]]]
    try:
        if t == "perimeter" and len(b) == len(a) + 1:
            b = b[:-1]
        if t in ("count", "text", "callout", "stamp"):
            return _close(a[0], b[0])
        if t in ("radius", "diameter"):
            ca, ra = _circle_of(stored)
            cb, rb = _circle_of(read)
            return _close(ca, cb) and abs(ra - rb) <= 0.5
        if len(a) != len(b):
            return False
        return all(_close(p, q) for p, q in zip(a, b))
    except Exception:
        return False


def annots_to_markups(annots, ctx, page):
    """Markups for one page's annotations. Counted items with the same subject and color become
    one count markup; the most common scale among measurement annotations is offered for the page.
    Returns {"markups", "scale", "skipped"}."""
    out, counts, scales, skipped = [], {}, {}, 0
    whole = set()
    for i, a in enumerate(annots or []):
        nm = a.get("nm") if isinstance(a, dict) and isinstance(a.get("nm"), str) else ""
        if "." in nm and nm.rsplit(".", 1)[0] in whole:
            continue  # another counted item of a count already restored whole from its stored copy
        r = annot_to_markup(a, ctx, page, i)
        if r is None:
            skipped += 1
            continue
        if r["scale"]:
            k = _r3(r["scale"] * 1e6) / 1e6
            scales[k] = scales.get(k, 0) + 1
        mk = r["markup"]
        if r["count"] and mk["type"] == "count" and len(mk["points"]) > 1:
            whole.add(mk["id"])
            out.append(mk)
            continue
        if r["count"]:
            key = (mk.get("subject", ""), mk.get("color", ""))
            if key in counts:
                counts[key]["points"].append(mk["points"][0])
                continue
            mk = dict(mk, points=list(mk["points"]))
            counts[key] = mk
        out.append(mk)
    best = None
    for k, n in scales.items():
        if best is None or n > scales[best]:
            best = k
    return {"markups": out, "scale": best, "skipped": skipped}


def viewport_from_vp(vp, ctx, index):
    """A page viewport (/VP entry: /BBox and /Measure) as one of our viewports, or None."""
    if not isinstance(vp, dict):
        return None
    ipp = scale_from_measure(vp.get("measure"))
    bb = _nums(vp.get("bbox"), 4)
    if ipp is None or bb is None:
        return None
    p0, p1 = to_sheet(ctx, bb[0], bb[1]), to_sheet(ctx, bb[2], bb[3])
    rect = [min(p0[0], p1[0]), min(p0[1], p1[1]), max(p0[0], p1[0]), max(p0[1], p1[1])]
    if rect[2] - rect[0] <= 0 or rect[3] - rect[1] <= 0:
        return None
    label = (vp.get("measure") or {}).get("r") if isinstance((vp.get("measure") or {}).get("r"), str) else ""
    name = vp.get("name") if isinstance(vp.get("name"), str) else ""
    return {"id": f"vp-{index + 1}", "name": (name or label or f"Viewport {index + 1}")[:100], "rect": rect,
            "scale": {"in_per_pt": ipp, "label": (label or "")[:80], "source": "imported"}}
