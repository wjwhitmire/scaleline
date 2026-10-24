"""Measurements: sheet geometry times the page scale.

A length on the sheet in points times in_per_pt is real inches. An area in square points
times in_per_pt squared is real square inches. Volume is net area times depth. A pitched
area (roofs) is plan area times sqrt(1 + (rise / 12)^2) for a pitch of rise in 12; pitch applies to
areas only, never to volumes (a slab or a footing is measured in plan). A diameter is two points
across the circle, or three points on it.
"""

from __future__ import annotations

import math

from . import geometry as g
from .errors import TakeoffError

MEASURE_TYPES = ("length", "polylength", "area", "perimeter", "count", "volume", "angle", "radius", "diameter",
                 "quantity")
# An imported quantity (for example a row of another program's markup summary) carries its own value
# in base units (inches, square inches, cubic inches or a count) and does not depend on the scale.
QTY_KEYS = {"length": "length_in", "area": "area_sq_in", "volume": "volume_cu_in", "count": "count"}

# What each measurement type reports as its main quantity.
PRIMARY = {
    "length": "length",
    "polylength": "length",
    "perimeter": "length",
    "radius": "length",
    "diameter": "length",
    "quantity": "count",
    "area": "area",
    "volume": "volume",
    "count": "count",
    "angle": "angle",
}


def _strict(v):
    if v is None:
        return 0.0
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return math.nan
    return float(v)


def pitch_factor(rise_per_12: float) -> float:
    r = _strict(rise_per_12)
    if not math.isfinite(r) or r < 0 or r > 48:
        raise TakeoffError("measure", "Pitch must be between 0 and 48 (rise in 12)")
    return math.sqrt(1.0 + (r / 12.0) ** 2)


def _num(v, name, lo=0.0, hi=1e9):
    x = _strict(v)
    if not math.isfinite(x) or x < lo or x > hi:
        raise TakeoffError("measure", f"{name} is out of range")
    return x


def measure(markup: dict, in_per_pt):
    """Quantities for one measurement markup. in_per_pt None means the page is not calibrated;
    counts and angles still work and scaled quantities come back as None."""
    t = markup.get("type")
    if t not in MEASURE_TYPES:
        raise TakeoffError("measure", f"Not a measurement type: {t}")
    pts = g.points(markup.get("points") or [])
    s = None if in_per_pt is None else float(in_per_pt)
    if s is not None and not (s > 0 and math.isfinite(s)):
        raise TakeoffError("measure", "The page scale must be a positive number")
    out = {
        "type": t,
        "kind": PRIMARY[t],
        "length_in": None,
        "perimeter_in": None,
        "area_sq_in": None,
        "volume_cu_in": None,
        "wall_area_sq_in": None,
        "count": None,
        "angle_deg": None,
        "radius_in": None,
        "value": None,
        "warnings": [],
    }

    def sc(x):
        return None if s is None else x * s

    def sc2(x):
        return None if s is None else x * s * s

    if t == "quantity":
        q = markup.get("qty")
        if not isinstance(q, dict) or q.get("kind") not in QTY_KEYS:
            raise TakeoffError("measure", "An imported quantity needs a kind and a value")
        v = _num(q.get("value"), "Quantity", 0.0, 1e15)
        out["kind"] = q["kind"]
        out[QTY_KEYS[q["kind"]]] = int(v) if q["kind"] == "count" and v == int(v) else v
        out["value"] = v
        return out
    if t == "count":
        out["count"] = len(pts)
        out["value"] = float(len(pts))
        return out
    if t == "angle":
        if len(pts) < 3:
            raise TakeoffError("measure", "An angle needs three points")
        out["angle_deg"] = g.angle_deg(pts[0], pts[1], pts[2])
        out["value"] = out["angle_deg"]
        return out
    if t in ("length", "polylength"):
        if len(pts) < 2:
            raise TakeoffError("measure", "A length needs two points")
        if t == "length":
            pts = pts[:2]
        L = sc(g.polyline_length(pts))
        out["length_in"] = L
        h = _num(markup.get("height"), "Height")
        if h > 0 and L is not None:
            out["wall_area_sq_in"] = L * h
        out["value"] = L
        return out
    if t == "perimeter":
        if len(pts) < 2:
            raise TakeoffError("measure", "A perimeter needs at least two points")
        P = sc(g.perimeter(pts))
        out["length_in"] = P
        out["perimeter_in"] = P
        h = _num(markup.get("height"), "Height")
        if h > 0 and P is not None:
            out["wall_area_sq_in"] = P * h
        out["value"] = P
        return out
    if t == "radius":
        if len(pts) == 2:
            r = g.dist(pts[0], pts[1])
        elif len(pts) >= 3:
            r = g.circle_through(pts[0], pts[1], pts[2])["radius"]
        else:
            raise TakeoffError("measure", "A radius needs a center and an edge point, or three points on the arc")
        R = sc(r)
        out["radius_in"] = R
        out["length_in"] = R
        if R is not None:
            out["perimeter_in"] = 2 * math.pi * R
            out["area_sq_in"] = math.pi * R * R
        out["value"] = R
        return out
    if t == "diameter":
        if len(pts) == 2:
            r = g.dist(pts[0], pts[1]) / 2
        elif len(pts) >= 3:
            r = g.circle_through(pts[0], pts[1], pts[2])["radius"]
        else:
            raise TakeoffError("measure", "A diameter needs two points across the circle, or three points on it")
        R = sc(r)
        out["radius_in"] = R
        if R is not None:
            out["length_in"] = 2 * R
            out["perimeter_in"] = 2 * math.pi * R
            out["area_sq_in"] = math.pi * R * R
        out["value"] = out["length_in"]
        return out
    # area and volume
    if len(pts) < 3:
        raise TakeoffError("measure", "An area needs at least three points")
    poly = g.polygon_with_holes(pts, markup.get("holes") or [])
    out["warnings"] = poly["warnings"]
    A = sc2(poly["net"])
    if t == "area":
        pf = pitch_factor(markup.get("pitch"))
        if A is not None:
            A *= pf
    out["area_sq_in"] = A
    out["perimeter_in"] = sc(poly["perimeter"])
    if t == "area":
        out["value"] = A
        return out
    depth = _num(markup.get("depth"), "Depth")
    out["volume_cu_in"] = None if A is None else A * depth
    out["value"] = out["volume_cu_in"]
    return out
