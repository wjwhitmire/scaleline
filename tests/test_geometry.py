"""Geometry against hand-computed cases."""

import math

import pytest

from plantakeoff import geometry as g
from plantakeoff.errors import TakeoffError


def test_distance_and_polyline():
    assert g.dist([0, 0], [3, 4]) == 5
    assert g.polyline_length([[0, 0], [3, 4], [3, 10]]) == 11
    assert g.polyline_length([[1, 1]]) == 0


def test_shoelace_rectangle_both_windings():
    rect = [[0, 0], [10, 0], [10, 5], [0, 5]]
    assert g.signed_area(rect) == 50  # clockwise on screen (y down) is positive
    assert g.signed_area(rect[::-1]) == -50


def test_l_shape_area_and_perimeter():
    # 20 x 10 with a 10 x 5 notch: 200 - 50 = 150. Perimeter 20+5+10+5+10+10 = 60.
    l_shape = [[0, 0], [20, 0], [20, 5], [10, 5], [10, 10], [0, 10]]
    assert abs(g.signed_area(l_shape)) == 150
    assert g.perimeter(l_shape) == 60


def test_triangle_area():
    assert abs(g.signed_area([[0, 0], [4, 0], [0, 3]])) == 6


def test_large_coordinates_stay_accurate():
    off = 1e6
    sq = [[off, off], [off + 1, off], [off + 1, off + 1], [off, off + 1]]
    assert g.signed_area(sq) == 1


def test_holes_subtract():
    outer = [[0, 0], [100, 0], [100, 100], [0, 100]]
    hole1 = [[10, 10], [20, 10], [20, 20], [10, 20]]
    hole2 = [[50, 50], [70, 50], [70, 60], [50, 60]]
    r = g.polygon_with_holes(outer, [hole1, hole2])
    assert r["gross"] == 10000 and r["cutouts"] == 100 + 200 and r["net"] == 9700
    assert r["perimeter"] == 400 and r["cutout_perimeter"] == 40 + 60
    assert r["warnings"] == []


def test_hole_outside_and_overlap_warn():
    outer = [[0, 0], [10, 0], [10, 10], [0, 10]]
    r = g.polygon_with_holes(outer, [[[8, 8], [12, 8], [12, 12], [8, 12]]])
    assert "cutout_1_outside_outline" in r["warnings"]
    a = [[1, 1], [5, 1], [5, 5], [1, 5]]
    b = [[3, 3], [7, 3], [7, 7], [3, 7]]
    r = g.polygon_with_holes(outer, [a, b])
    assert "cutouts_1_and_2_overlap" in r["warnings"]


def test_cutouts_larger_than_outline_floor_at_zero():
    outer = [[0, 0], [1, 0], [1, 1], [0, 1]]
    big = [[0, 0], [1, 0], [1, 1], [0, 1]]
    r = g.polygon_with_holes(outer, [big, big])
    assert r["net"] == 0 and "cutouts_exceed_outline" in r["warnings"]


def test_self_intersection_bowtie():
    bowtie = [[0, 0], [10, 10], [10, 0], [0, 10]]
    assert g.self_intersections(bowtie) == [[0, 2]]
    assert "outline_crosses_itself" in g.polygon_with_holes(bowtie)["warnings"]
    # The shoelace sum of a symmetric bowtie cancels to zero: the reason for the warning.
    assert g.signed_area(bowtie) == 0


def test_simple_polygons_do_not_flag():
    assert g.self_intersections([[0, 0], [10, 0], [10, 10], [0, 10]]) == []
    assert g.self_intersections([[0, 0], [20, 0], [20, 5], [10, 5], [10, 10], [0, 10]]) == []


def test_touching_vertex_counts_as_intersection():
    # Edge 3 passes through vertex 1's position again.
    pts = [[0, 0], [10, 0], [10, 10], [5, 0], [0, 10]]
    assert g.self_intersections(pts)


def test_point_in_polygon():
    sq = [[0, 0], [10, 0], [10, 10], [0, 10]]
    assert g.point_in_polygon([5, 5], sq)
    assert not g.point_in_polygon([15, 5], sq)
    assert g.point_in_polygon([10, 5], sq)  # on an edge


def test_angle():
    assert g.angle_deg([10, 0], [0, 0], [0, 10]) == pytest.approx(90)
    assert g.angle_deg([10, 0], [0, 0], [10, 10]) == pytest.approx(45)
    assert g.angle_deg([10, 0], [0, 0], [-10, 0]) == pytest.approx(180)
    with pytest.raises(TakeoffError):
        g.angle_deg([0, 0], [0, 0], [1, 1])


def test_circle_through_three_points():
    c = g.circle_through([5, 0], [0, 5], [-5, 0])
    assert c["center"] == pytest.approx([0, 0], abs=1e-12)
    assert c["radius"] == pytest.approx(5)
    c = g.circle_through([3, 4], [-4, 3], [0, -5])
    assert c["radius"] == pytest.approx(5)
    with pytest.raises(TakeoffError):
        g.circle_through([0, 0], [1, 1], [2, 2])


def test_centroid():
    assert g.centroid([[0, 0], [10, 0], [10, 10], [0, 10]]) == pytest.approx([5, 5])
    assert g.centroid([[0, 0], [6, 0], [0, 6]]) == pytest.approx([2, 2])


def test_snap_angle():
    p = g.snap_angle([0, 0], [10, 1], 45)
    assert p == pytest.approx([10, 0])
    p = g.snap_angle([0, 0], [10, 9], 45)
    assert p == pytest.approx([9.5, 9.5])
    p = g.snap_angle([0, 0], [1, 10], 90)
    assert p == pytest.approx([0, 10])


def test_snap_priorities():
    segs = [([0, 0], [10, 0])]
    assert g.snap([0.3, 0.2], 1, vertices=[[0, 0]], segments=segs)["kind"] == "vertex"
    s = g.snap([5.2, 0.4], 1, vertices=[[0, 0]], segments=segs)
    assert s["kind"] == "midpoint" and s["point"] == [5, 0]
    s = g.snap([7.5, 0.4], 1, segments=segs)
    assert s["kind"] == "edge" and s["point"] == pytest.approx([7.5, 0])
    s = g.snap([7.4, 3.6], 1, segments=segs, grid=1)
    assert s["kind"] == "grid" and s["point"] == [7, 4]
    assert g.snap([7.4, 3.6], 1)["kind"] == "none"


def test_simplify():
    pts = [[0, 0], [1, 0.01], [2, -0.01], [3, 0], [3, 3]]
    assert g.simplify(pts, 0.1) == [[0, 0], [3, 0], [3, 3]]


def test_bad_points():
    with pytest.raises(TakeoffError):
        g.polyline_length([[0, 0], [float("nan"), 1]])
    with pytest.raises(TakeoffError):
        g.polyline_length([[0, 0, 0]])
    with pytest.raises(TakeoffError):
        g.polygon_with_holes([[0, 0], [1, 1]])


def test_bbox():
    assert g.bbox([[3, -1], [0, 4], [2, 2]]) == [0, -1, 3, 4]
    assert math.isclose(g.perimeter([[0, 0], [3, 4]]), 10)
