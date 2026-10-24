"""Plane geometry on sheet coordinates (PDF points, x right, y down).

Lengths and areas here are in sheet units; measure.py applies the scale.
Methods: Euclidean distance; shoelace formula for polygon area; holes subtract their
absolute area; a segment-pair test flags outlines that cross themselves (the shoelace
result is then not the enclosed area, so callers warn); angle from atan2 of the two
rays; circle through three points from the perpendicular bisectors (circumcircle).
"""

from __future__ import annotations

import math

from .errors import TakeoffError

EPS = 1e-12


def _round(x: float) -> float:
    """Round half up, the same as JavaScript Math.round."""
    return float(math.floor(x + 0.5))


def _pt(p):
    if not (isinstance(p, (list, tuple)) and len(p) == 2):
        raise TakeoffError("geometry", "A point is a pair of numbers")
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in p):
        raise TakeoffError("geometry", "A point must have finite coordinates")
    x, y = float(p[0]), float(p[1])
    if not (math.isfinite(x) and math.isfinite(y)):
        raise TakeoffError("geometry", "A point must have finite coordinates")
    return x, y


def points(pts, minimum=0):
    out = [_pt(p) for p in (pts or [])]
    if len(out) < minimum:
        raise TakeoffError("geometry", f"Need at least {minimum} points")
    return out


def dist(a, b) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def polyline_length(pts) -> float:
    p = points(pts)
    return sum(dist(p[i], p[i + 1]) for i in range(len(p) - 1))


def signed_area(pts) -> float:
    """Shoelace sum. Positive when the vertices run clockwise on screen (y down)."""
    p = points(pts)
    n = len(p)
    if n < 3:
        return 0.0
    # Shift to the first vertex to keep the sum well conditioned for large coordinates.
    ox, oy = p[0]
    s = 0.0
    for i in range(n):
        x1, y1 = p[i][0] - ox, p[i][1] - oy
        x2, y2 = p[(i + 1) % n][0] - ox, p[(i + 1) % n][1] - oy
        s += x1 * y2 - x2 * y1
    return s / 2.0


def perimeter(pts) -> float:
    p = points(pts)
    if len(p) < 2:
        return 0.0
    return polyline_length(p + [p[0]]) if len(p) > 2 else 2 * dist(p[0], p[1])


def _orient(a, b, c) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_seg(a, b, c, tol) -> bool:
    return (min(a[0], b[0]) - tol <= c[0] <= max(a[0], b[0]) + tol
            and min(a[1], b[1]) - tol <= c[1] <= max(a[1], b[1]) + tol)


def segments_intersect(a, b, c, d) -> bool:
    """True when closed segments ab and cd share a point."""
    scale = max(1.0, abs(a[0]), abs(a[1]), abs(b[0]), abs(b[1]), abs(c[0]), abs(c[1]), abs(d[0]), abs(d[1]))
    tol = 1e-9 * scale * scale
    d1, d2 = _orient(c, d, a), _orient(c, d, b)
    d3, d4 = _orient(a, b, c), _orient(a, b, d)
    if ((d1 > tol and d2 < -tol) or (d1 < -tol and d2 > tol)) and ((d3 > tol and d4 < -tol) or (d3 < -tol and d4 > tol)):
        return True
    lt = 1e-9 * scale
    if abs(d1) <= tol and _on_seg(c, d, a, lt):
        return True
    if abs(d2) <= tol and _on_seg(c, d, b, lt):
        return True
    if abs(d3) <= tol and _on_seg(a, b, c, lt):
        return True
    if abs(d4) <= tol and _on_seg(a, b, d, lt):
        return True
    return False


def self_intersections(pts, closed=True, limit=50):
    """Index pairs (i, j) of non-adjacent edges that touch or cross. Edge i runs from vertex i to i+1."""
    p = points(pts)
    n = len(p)
    m = n if closed else n - 1
    if m < 3:
        return []
    out = []
    for i in range(m):
        a, b = p[i], p[(i + 1) % n]
        for j in range(i + 1, m):
            if j == i + 1 or (closed and i == 0 and j == m - 1):
                continue
            c, d = p[j], p[(j + 1) % n]
            if segments_intersect(a, b, c, d):
                out.append([i, j])
                if len(out) >= limit:
                    return out
    return out


def point_in_polygon(pt, poly) -> bool:
    """Even-odd ray test. Points exactly on an edge count as inside."""
    x, y = _pt(pt)
    p = points(poly)
    n = len(p)
    inside = False
    for i in range(n):
        a, b = p[i], p[(i + 1) % n]
        if abs(_orient(a, b, (x, y))) <= 1e-9 * max(1.0, dist(a, b)) and _on_seg(a, b, (x, y), 1e-9):
            return True
        if (a[1] > y) != (b[1] > y):
            xi = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x < xi:
                inside = not inside
    return inside


def polygon_with_holes(outer, holes=()):
    """Area and perimeters of an outline with cutouts, plus warnings.

    area = |shoelace(outer)| - sum |shoelace(hole)|, floored at zero.
    """
    o = points(outer, 3)
    hs = [points(h, 3) for h in (holes or [])]
    warnings = []
    if self_intersections(o):
        warnings.append("outline_crosses_itself")
    gross = abs(signed_area(o))
    cut = 0.0
    for k, h in enumerate(hs):
        if self_intersections(h):
            warnings.append(f"cutout_{k + 1}_crosses_itself")
        if not all(point_in_polygon(v, o) for v in h):
            warnings.append(f"cutout_{k + 1}_outside_outline")
        cut += abs(signed_area(h))
    for i in range(len(hs)):
        for j in range(i + 1, len(hs)):
            if any(point_in_polygon(v, hs[j]) for v in hs[i]) or any(point_in_polygon(v, hs[i]) for v in hs[j]):
                warnings.append(f"cutouts_{i + 1}_and_{j + 1}_overlap")
    net = gross - cut
    if net < 0:
        warnings.append("cutouts_exceed_outline")
        net = 0.0
    return {
        "gross": gross,
        "cutouts": cut,
        "net": net,
        "perimeter": perimeter(o),
        "cutout_perimeter": sum(perimeter(h) for h in hs),
        "warnings": warnings,
    }


def centroid(pts):
    """Area centroid of a simple polygon; vertex mean when the area is degenerate."""
    p = points(pts, 1)
    a = signed_area(p)
    if abs(a) < EPS or len(p) < 3:
        return [sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)]
    ox, oy = p[0]
    cx = cy = 0.0
    n = len(p)
    for i in range(n):
        x1, y1 = p[i][0] - ox, p[i][1] - oy
        x2, y2 = p[(i + 1) % n][0] - ox, p[(i + 1) % n][1] - oy
        f = x1 * y2 - x2 * y1
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    return [cx / (6 * a) + ox, cy / (6 * a) + oy]


def angle_deg(a, vertex, b) -> float:
    """Angle at vertex between rays to a and b, 0 to 180 degrees."""
    a, v, b = _pt(a), _pt(vertex), _pt(b)
    ux, uy = a[0] - v[0], a[1] - v[1]
    wx, wy = b[0] - v[0], b[1] - v[1]
    if math.hypot(ux, uy) < EPS or math.hypot(wx, wy) < EPS:
        raise TakeoffError("geometry", "An angle needs two arms of nonzero length")
    return math.degrees(abs(math.atan2(ux * wy - uy * wx, ux * wx + uy * wy)))


def circle_through(a, b, c):
    """Center and radius of the circle through three points."""
    a, b, c = _pt(a), _pt(b), _pt(c)
    ox, oy = a
    bx, by = b[0] - ox, b[1] - oy
    cx, cy = c[0] - ox, c[1] - oy
    d = 2.0 * (bx * cy - by * cx)
    span = max(dist(a, b), dist(b, c), dist(a, c))
    if abs(d) <= 1e-12 * max(1.0, span * span):
        raise TakeoffError("geometry", "The three points are in a line, so they do not define a circle")
    b2, c2 = bx * bx + by * by, cx * cx + cy * cy
    ux = (cy * b2 - by * c2) / d
    uy = (bx * c2 - cx * b2) / d
    return {"center": [ux + ox, uy + oy], "radius": math.hypot(ux, uy)}


def bbox(pts):
    p = points(pts, 1)
    xs = [q[0] for q in p]
    ys = [q[1] for q in p]
    return [min(xs), min(ys), max(xs), max(ys)]


# ------------------------------------------------------------------- snapping


def snap_angle(origin, pt, step_deg=45.0):
    """Project pt onto the nearest ray from origin at a multiple of step_deg (ortho and 45 degree lock)."""
    o, p = _pt(origin), _pt(pt)
    dx, dy = p[0] - o[0], p[1] - o[1]
    r = math.hypot(dx, dy)
    if r < EPS or not step_deg > 0:
        return [p[0], p[1]]
    step = math.radians(step_deg)
    ang = _round(math.atan2(dy, dx) / step) * step
    ux, uy = math.cos(ang), math.sin(ang)
    t = dx * ux + dy * uy
    return [o[0] + t * ux, o[1] + t * uy]


def nearest_on_segment(p, a, b):
    p, a, b = _pt(p), _pt(a), _pt(b)
    vx, vy = b[0] - a[0], b[1] - a[1]
    L2 = vx * vx + vy * vy
    if L2 < EPS:
        return [a[0], a[1]]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2))
    return [a[0] + t * vx, a[1] + t * vy]


def snap_grid(p, spacing, origin=(0.0, 0.0)):
    p = _pt(p)
    if not spacing > 0:
        return [p[0], p[1]]
    return [origin[0] + _round((p[0] - origin[0]) / spacing) * spacing,
            origin[1] + _round((p[1] - origin[1]) / spacing) * spacing]


def snap(p, tolerance, vertices=(), segments=(), grid=0.0):
    """Snap a point. Priority: endpoint or vertex, then segment midpoint, then nearest point on a
    segment, then grid. Returns {"point", "kind"} where kind is vertex, midpoint, edge, grid or none."""
    p = _pt(p)
    best = None
    for v in vertices:
        d = dist(p, v)
        if d <= tolerance and (best is None or d < best[0]):
            best = (d, [float(v[0]), float(v[1])])
    if best:
        return {"point": best[1], "kind": "vertex"}
    for a, b in segments:
        m = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
        d = dist(p, m)
        if d <= tolerance and (best is None or d < best[0]):
            best = (d, m)
    if best:
        return {"point": best[1], "kind": "midpoint"}
    for a, b in segments:
        q = nearest_on_segment(p, a, b)
        d = dist(p, q)
        if d <= tolerance and (best is None or d < best[0]):
            best = (d, q)
    if best:
        return {"point": best[1], "kind": "edge"}
    if grid and grid > 0:
        return {"point": snap_grid(p, grid), "kind": "grid"}
    return {"point": [p[0], p[1]], "kind": "none"}


def simplify(pts, tolerance):
    """Douglas-Peucker simplification of an open polyline (iterative)."""
    p = points(pts)
    n = len(p)
    if n < 3:
        return [list(q) for q in p]
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        a, b = p[i], p[j]
        dmax, idx = -1.0, -1
        for k in range(i + 1, j):
            d = dist(p[k], nearest_on_segment(p[k], a, b))
            if d > dmax:
                dmax, idx = d, k
        if idx >= 0 and dmax > tolerance:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [list(q) for q, k in zip(p, keep) if k]
