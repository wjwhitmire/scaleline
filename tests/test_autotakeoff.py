"""Auto-takeoff on the labeled plan sheets: walls, rooms, doors, windows, symbols and wall types,
the limits it states, and bad input."""

import math

import pytest

import plan_sheets as ps
from plantakeoff import autotakeoff as at
from plantakeoff.errors import TakeoffError


@pytest.fixture(scope="module")
def results():
    return {k: (ps.Plan(v), at.auto_takeoff(ps.Plan(v).page())) for k, v in ps.LAYOUTS.items()}


def _covered(label, walls, tol):
    a, b = label["a"], label["b"]
    L = math.dist(a, b)
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    best = 0.0
    for w in walls:
        offs = [-(p[0] - a[0]) * uy + (p[1] - a[1]) * ux for p in (w["a"], w["b"])]
        if max(abs(o) for o in offs) > tol:
            continue
        al = sorted((p[0] - a[0]) * ux + (p[1] - a[1]) * uy for p in (w["a"], w["b"]))
        best = max(best, min(L, al[1]) - max(0.0, al[0]))
    return best / L


@pytest.mark.parametrize("name", list(ps.LAYOUTS))
def test_every_labeled_wall_is_found_with_its_type(results, name):
    plan, r = results[name]
    for lab in plan.labels["walls"]:
        tol = lab["t_in"] / plan.ipp / 2 + 2
        assert _covered(lab, r["walls"], tol) >= 0.95, lab
    by_kind = {w["type_name"] for w in r["walls"]}
    assert by_kind <= {"Exterior wall", "Interior partition"}
    # wall thickness read from the line spacing, to the sixteenth of an inch
    for w in r["walls"]:
        assert any(abs(w["thickness_in"] - t) < 1 / 16 for t in (plan.lay["ext_t"], plan.lay["int_t"], 12, 13)), w


@pytest.mark.parametrize("name", list(ps.LAYOUTS))
def test_rooms_have_the_labeled_clear_area_and_name(results, name):
    plan, r = results[name]
    assert len(r["rooms"]) == len(plan.labels["rooms"])
    for lab in plan.labels["rooms"]:
        hit = [x for x in r["rooms"] if x["name"] == lab["name"] and x["number"] == lab["number"]]
        assert hit, lab["name"]
        assert hit[0]["area_sq_in"] == pytest.approx(lab["area_sq_in"], rel=1e-9)


@pytest.mark.parametrize("name", list(ps.LAYOUTS))
def test_doors_windows_and_symbols(results, name):
    plan, r = results[name]
    assert len(r["doors"]) == len(plan.labels["doors"])
    for lab in plan.labels["doors"]:
        d = min(r["doors"], key=lambda x: math.dist(x["at"], lab["at"]))
        assert math.dist(d["at"], lab["at"]) < 1
        assert d["width_in"] == pytest.approx(lab["width_in"], abs=0.1)
        assert d["leaves"] == lab["leaves"]
        if lab["tag"] and not lab["tag"].isdigit():
            assert d["tag"] == lab["tag"]
    assert len(r["windows"]) == len(plan.labels["windows"])
    found = {s["name"]: s["count"] for s in r["symbols"]}
    for kind, pts in plan.labels["symbols"].items():
        assert found.get(kind, 0) >= len(pts) - 1, (kind, found)


def test_the_shelf_is_a_wall_suggestion_that_the_person_rejects(results):
    """Stated limit: two parallel lines a wall thickness apart are read as a wall."""
    plan, r = results["house"]
    shelf = plan.labels["distractors"][0]
    assert any(_covered({"a": shelf["a"], "b": shelf["b"]}, [w], 10) > 0.9 for w in r["walls"])


def test_every_result_has_a_confidence_and_a_why(results):
    for _, r in results.values():
        for k in ("walls", "rooms", "doors", "windows", "symbols"):
            for x in r[k]:
                assert 0 < x["conf"] <= 0.97 and x["why"] and x["why"][-1] == "."


def test_turned_sheet_and_no_scale():
    plan = ps.Plan(ps.HOUSE)
    page = plan.page()
    W, H = page["w"], page["h"]
    turned = {"w": H, "h": W, "in_per_pt": plan.ipp,
              "segs": [ps.rotate_point(s[:2], W, H, 90) + ps.rotate_point(s[2:4], W, H, 90) + s[4:] for s in page["segs"]],
              "curves": [sum((ps.rotate_point(c[i:i + 2], W, H, 90) for i in (0, 2, 4, 6)), []) + [c[8]] for c in page["curves"]],
              "text": [dict(t, x=ps.rotate_point([t["x"], t["y"]], W, H, 90)[0], y=ps.rotate_point([t["x"], t["y"]], W, H, 90)[1], vertical=True)
                       for t in page["text"]]}
    a, b = at.auto_takeoff(page), at.auto_takeoff(turned)
    assert len(a["walls"]) == len(b["walls"]) and len(a["doors"]) == len(b["doors"]) and len(a["rooms"]) == len(b["rooms"])
    assert sorted(round(r["area_sq_in"]) for r in a["rooms"]) == sorted(round(r["area_sq_in"]) for r in b["rooms"])
    page.pop("in_per_pt")
    c = at.auto_takeoff(page)
    assert c["walls"] and c["walls"][0]["length_in"] is None and "No scale" in c["notes"][-1]


def test_rules_map_types_to_presets():
    feats = {"thickness_in": 4.5, "weight_pt": 0.5, "hatch": False, "fill": False, "outer": False}
    assert at.classify_wall(feats, at.DEFAULT_RULES)["preset"] == "p-int-wall"
    assert at.classify_wall(dict(feats, outer=True), at.DEFAULT_RULES)["preset"] == "p-ext-wall"
    rules = at.clean_rules([{"id": "thick", "name": "Thick", "preset": "p-x", "min_in": 6}, {"id": "bad id"}, "x", {"id": "thick"}])
    assert [r["id"] for r in rules] == ["thick"] and rules[0]["hatch"] == "any"
    assert at.classify_wall(feats, rules) is None
    r = at.auto_takeoff(ps.Plan(ps.HOUSE).page(), {"rules": [{"id": "all", "name": "Any wall", "preset": "p-int-wall"}]})
    assert {w["type_name"] for w in r["walls"]} == {"Any wall"}


def test_proposals_are_one_batch_of_markups():
    r = at.auto_takeoff(ps.Plan(ps.HOUSE).page())
    ids = [w["id"] for w in r["walls"]] + [x["id"] for x in r["rooms"]] + [d["id"] for d in r["doors"]] + [s["id"] for s in r["symbols"]]
    props = at.proposals(r, ids, 1)
    tools = [p["tool"] for p in props]
    assert tools.count("length") == len(r["walls"]) and tools.count("area") == len(r["rooms"])
    assert sum(len(p["points"]) for p in props if p["subject"] == "Door") == len(r["doors"])
    assert at.proposals(r, [], 1) == []


@pytest.mark.parametrize("bad", [None, [], {"w": 0, "h": 1}, {"h": 1}, "x"])
def test_bad_input(bad):
    with pytest.raises(TakeoffError):
        at.auto_takeoff(bad)


def test_junk_line_work_is_skipped():
    r = at.auto_takeoff({"w": 100, "h": 100, "segs": [[1, 2], "x", [0, 0, 0, 0], [float("nan"), 0, 1, 1], [1, 1, 50, 1, -3, True]],
                         "curves": [[1] * 7, None], "text": [{"str": 3}, None]})
    assert r["walls"] == [] and r["stats"]["segments"] == 1


@pytest.mark.parametrize("kind", ["door", "open45", "pair", "vertical"])
def test_door_swings_found_in_a_scan_mask(kind):
    import auto_vectors as av
    m, w, h, segs, o = av.door_mask(kind)
    r = at.scan_door_arcs(bytes(m), w, h, segs, o)
    hinges = [(30, 48), (114, 48)] if kind == "pair" else [(40, 48)]
    if kind == "vertical":
        hinges = [(48, 40)]
    assert len(r["curves"]) == len(hinges) == len(r["leaves"])
    for lf, cv in zip(r["leaves"], r["curves"]):
        assert min(math.dist(lf[:2], hg) for hg in hinges) < 0.01
        assert abs(math.dist(lf[:2], lf[2:]) - 42) <= 1.5 and abs(math.dist(lf[:2], cv[:2]) - 42) <= 1.5
        assert cv[6:8] == lf[2:]
        # the swing is a circle about the hinge, as auto_takeoff reads it
        assert at._arc_from_points([at._bez([(cv[i], cv[i + 1]) for i in (0, 2, 4, 6)], t) for t in (0, 0.25, 0.5, 0.75, 1)]) is not None
    if kind == "open45":
        lf = r["leaves"][0]
        ang = math.degrees(math.atan2(lf[3] - lf[1], lf[2] - lf[0]))
        assert abs(ang - 45) <= 3


@pytest.mark.parametrize("kind", ["no_arc", "no_leaf", "filled"])
def test_no_door_without_both_arc_and_leaf(kind):
    import auto_vectors as av
    m, w, h, segs, o = av.door_mask(kind)
    assert at.scan_door_arcs(bytes(m), w, h, segs, o) == {"curves": [], "leaves": [], "drop": []}


def test_scan_door_search_input():
    import auto_vectors as av
    m, w, h, segs, o = av.door_mask("door")
    for bad in ({"r_min": 50, "r_max": 20}, {"r_min": 1, "r_max": 20}, None, {"r_min": float("nan"), "r_max": 9}):
        with pytest.raises(TakeoffError):
            at.scan_door_arcs(bytes(m), w, h, segs, bad)
    with pytest.raises(TakeoffError):
        at.scan_door_arcs(bytes(m[:100]), w, h, segs, o)
    with pytest.raises(TakeoffError):
        at.scan_door_arcs(bytes(m), 0, h, segs, o)
    # the line found on the leaf is replaced by the leaf
    r = at.scan_door_arcs(bytes(m), w, h, segs + [[40, 50, 40, 89, 0, 0], "junk", [1, 2]], o)
    assert r["drop"] == [4]
