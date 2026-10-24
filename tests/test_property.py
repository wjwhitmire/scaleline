"""Property tests with seeded random inputs (no extra dependencies)."""

import math
import random

import pytest

from plantakeoff import assembly as a
from plantakeoff import geometry as g
from plantakeoff import scale as s
from plantakeoff import units as u

N = 300


def star(rng, n, cx=0.0, cy=0.0):
    """A simple (non-crossing) polygon: vertices at increasing angles around a center, each in its own
    sector of 360/n degrees, so no gap between neighbors reaches 180 degrees."""
    step = 2 * math.pi / n
    angs = [k * step + rng.uniform(0, 0.9 * step) for k in range(n)]
    radii = [rng.uniform(5, 100) for _ in angs]
    return [[cx + r * math.cos(t), cy + r * math.sin(t)] for t, r in zip(angs, radii)]


def test_area_invariant_under_rigid_motion_and_reversal():
    rng = random.Random(1)
    for _ in range(N):
        p = star(rng, rng.randint(3, 30))
        A = abs(g.signed_area(p))
        th, dx, dy = rng.uniform(0, 6.3), rng.uniform(-1e4, 1e4), rng.uniform(-1e4, 1e4)
        c, sn = math.cos(th), math.sin(th)
        q = [[c * x - sn * y + dx, sn * x + c * y + dy] for x, y in p]
        assert abs(g.signed_area(q)) == pytest.approx(A, rel=1e-9)
        assert g.signed_area(p[::-1]) == pytest.approx(-g.signed_area(p), rel=1e-12)
        k = rng.randrange(len(p))
        assert g.signed_area(p[k:] + p[:k]) == pytest.approx(g.signed_area(p), rel=1e-9)
        assert g.perimeter(q) == pytest.approx(g.perimeter(p), rel=1e-9)


def test_area_scales_with_square_of_scale():
    rng = random.Random(2)
    for _ in range(N):
        p = star(rng, rng.randint(3, 12))
        k = rng.uniform(0.01, 100)
        q = [[x * k, y * k] for x, y in p]
        assert abs(g.signed_area(q)) == pytest.approx(abs(g.signed_area(p)) * k * k, rel=1e-9)


def test_star_polygons_are_simple():
    rng = random.Random(3)
    for _ in range(100):
        p = star(rng, rng.randint(3, 25))
        assert g.self_intersections(p) == []


def test_split_rectangle_areas_add_up():
    rng = random.Random(4)
    for _ in range(N):
        w, h, cut = rng.uniform(1, 500), rng.uniform(1, 500), rng.uniform(0.01, 0.99)
        x = w * cut
        left = [[0, 0], [x, 0], [x, h], [0, h]]
        right = [[x, 0], [w, 0], [w, h], [x, h]]
        whole = [[0, 0], [w, 0], [w, h], [0, h]]
        assert abs(g.signed_area(left)) + abs(g.signed_area(right)) == pytest.approx(abs(g.signed_area(whole)), rel=1e-12)


def test_hole_area_subtracts_exactly():
    rng = random.Random(5)
    for _ in range(N):
        W, H = rng.uniform(50, 500), rng.uniform(50, 500)
        x0, y0 = rng.uniform(1, W / 2), rng.uniform(1, H / 2)
        w, h = rng.uniform(1, W / 2 - 1), rng.uniform(1, H / 2 - 1)
        r = g.polygon_with_holes([[0, 0], [W, 0], [W, H], [0, H]], [[[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]])
        assert r["net"] == pytest.approx(W * H - w * h, rel=1e-12)
        assert r["warnings"] == []


def test_calibration_round_trip_random():
    rng = random.Random(6)
    for _ in range(N):
        p1 = [rng.uniform(0, 3000), rng.uniform(0, 2000)]
        p2 = [rng.uniform(0, 3000), rng.uniform(0, 2000)]
        if g.dist(p1, p2) < 1:
            continue
        known = rng.uniform(1, 50000)
        ipp = s.calibrate(p1, p2, known)
        assert g.dist(p1, p2) * ipp == pytest.approx(known, rel=1e-12)
        # A second segment measured at the same scale is proportional to its sheet length.
        q = [rng.uniform(0, 3000), rng.uniform(0, 2000)]
        assert g.dist(p1, q) * ipp == pytest.approx(known * g.dist(p1, q) / g.dist(p1, p2), rel=1e-9)


def test_standard_scale_round_trip():
    for sc in s.STANDARD_SCALES:
        assert s.nearest_standard(sc["in_per_pt"])["in_per_pt"] == sc["in_per_pt"]


def test_ftin_format_parse_round_trip():
    rng = random.Random(7)
    for _ in range(N):
        sixteenths = rng.randint(0, 16 * 12 * 2000)
        inches = sixteenths / 16
        text = u.format_ftin(inches)
        assert u.parse_length(text) == pytest.approx(inches, abs=1e-9)


def test_format_ftin_error_is_within_half_a_step():
    rng = random.Random(8)
    for _ in range(N):
        inches = rng.uniform(0, 5000)
        back = u.parse_length(u.format_ftin(inches, 16))
        assert abs(back - inches) <= 1 / 32 + 1e-9


def test_unit_conversions_round_trip():
    rng = random.Random(9)
    groups = [list(u.LENGTH), list(u.AREA), list(u.VOLUME)]
    for _ in range(N):
        units = rng.choice(groups)
        a1, b1 = rng.choice(units), rng.choice(units)
        v = rng.uniform(-1e6, 1e6)
        assert u.convert(u.convert(v, a1, b1), b1, a1) == pytest.approx(v, rel=1e-12)


def test_order_quantity_covers_need_and_is_minimal():
    rng = random.Random(10)
    for _ in range(N):
        sf = rng.uniform(0, 5000)
        pack = rng.choice([1, 8, 10, 32, 48, 100])
        waste = rng.choice([0, 5, 10, 15])
        tot = a.sum_quantities([{"kind": "area", "value": 1.0, "area_sq_in": sf * 144}])
        c = a.component_quantity({"source": "area", "source_unit": "sf", "pack": pack, "waste_pct": waste}, tot)
        need = sf * (1 + waste / 100)
        assert c["order"] * pack >= need - 1e-6 * max(1, need)
        assert (c["order"] - 1) * pack < need or c["order"] == 0


def test_snap_angle_keeps_points_on_rays():
    rng = random.Random(11)
    for _ in range(N):
        o = [rng.uniform(-100, 100), rng.uniform(-100, 100)]
        p = [rng.uniform(-100, 100), rng.uniform(-100, 100)]
        q = g.snap_angle(o, p, 45)
        ang = math.degrees(math.atan2(q[1] - o[1], q[0] - o[0]))
        if g.dist(o, q) > 1e-6:
            assert abs((ang / 45) - round(ang / 45)) < 1e-6
            assert g.dist(o, q) <= g.dist(o, p) + 1e-9


def test_simplify_keeps_endpoints_and_stays_close():
    rng = random.Random(12)
    for _ in range(100):
        pts = [[i, rng.uniform(-1, 1)] for i in range(50)]
        out = g.simplify(pts, 0.5)
        assert out[0] == pts[0] and out[-1] == pts[-1]
        for p in pts:
            d = min(g.dist(p, g.nearest_on_segment(p, out[i], out[i + 1])) for i in range(len(out) - 1))
            assert d <= 0.5 + 1e-9
