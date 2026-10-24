"""Measurements, assemblies, the estimate, the markup file and CSV export."""

import json
import math

import pytest

from plantakeoff import assembly as a
from plantakeoff import export as x
from plantakeoff import markups as mk
from plantakeoff.brand import FILE_FORMAT
from plantakeoff.errors import TakeoffError
from plantakeoff.measure import measure, pitch_factor

QUARTER = 12 / 18  # 1/4" = 1'-0": real inches per point


def test_length_at_quarter_inch_scale():
    # 2.5 in of paper = 180 pt = 10'-0" real.
    r = measure({"type": "length", "points": [[0, 0], [180, 0]]}, QUARTER)
    assert r["length_in"] == pytest.approx(120)
    assert r["kind"] == "length" and r["value"] == r["length_in"]


def test_length_uses_two_points_only():
    r = measure({"type": "length", "points": [[0, 0], [180, 0], [180, 900]]}, QUARTER)
    assert r["length_in"] == pytest.approx(120)


def test_polylength_with_height_gives_wall_area():
    r = measure({"type": "polylength", "points": [[0, 0], [180, 0], [180, 90]], "height": 96}, QUARTER)
    assert r["length_in"] == pytest.approx(180)  # 15 ft
    assert r["wall_area_sq_in"] == pytest.approx(180 * 96)  # 15 ft x 8 ft = 120 SF


def test_area_with_cutout_in_square_feet():
    # 40 ft x 30 ft room (720 x 540 pt at 1/4", 18 pt per foot), minus a 10 x 10 ft shaft.
    outer = [[0, 0], [720, 0], [720, 540], [0, 540]]
    hole = [[180, 180], [360, 180], [360, 360], [180, 360]]
    r = measure({"type": "area", "points": outer, "holes": [hole]}, QUARTER)
    assert r["area_sq_in"] / 144 == pytest.approx(1200 - 100)
    assert r["perimeter_in"] / 12 == pytest.approx(140)


def test_pitched_area():
    r = measure({"type": "area", "points": [[0, 0], [720, 0], [720, 540], [0, 540]], "pitch": 6}, QUARTER)
    assert r["area_sq_in"] / 144 == pytest.approx(1200 * math.sqrt(1 + 0.25))
    assert pitch_factor(12) == pytest.approx(math.sqrt(2))
    with pytest.raises(TakeoffError):
        pitch_factor(-1)


def test_volume_slab():
    # 30 ft x 40 ft slab, 4 in thick = 400 CF = 14.8148 CY.
    r = measure({"type": "volume", "points": [[0, 0], [720, 0], [720, 540], [0, 540]], "depth": 4}, QUARTER)
    assert r["volume_cu_in"] / 1728 == pytest.approx(400)
    assert r["volume_cu_in"] / 46656 == pytest.approx(400 / 27)


def test_count_angle_radius_perimeter():
    assert measure({"type": "count", "points": [[1, 1], [2, 2], [3, 3]]}, None)["count"] == 3
    assert measure({"type": "angle", "points": [[10, 0], [0, 0], [0, 10]]}, None)["angle_deg"] == pytest.approx(90)
    r = measure({"type": "radius", "points": [[0, 0], [36, 0]]}, QUARTER)
    assert r["radius_in"] == pytest.approx(24)
    assert r["area_sq_in"] == pytest.approx(math.pi * 576)
    r = measure({"type": "radius", "points": [[36, 0], [0, 36], [-36, 0]]}, QUARTER)
    assert r["radius_in"] == pytest.approx(24)
    r = measure({"type": "perimeter", "points": [[0, 0], [180, 0], [180, 180], [0, 180]]}, QUARTER)
    assert r["perimeter_in"] == pytest.approx(480)


def test_uncalibrated_page():
    r = measure({"type": "area", "points": [[0, 0], [1, 0], [1, 1]]}, None)
    assert r["value"] is None and r["area_sq_in"] is None
    with pytest.raises(TakeoffError):
        measure({"type": "length", "points": [[0, 0], [1, 1]]}, 0)
    with pytest.raises(TakeoffError):
        measure({"type": "cloud", "points": [[0, 0], [1, 1]]}, 1)


# ---------------------------------------------------------------- assemblies

DRYWALL = {"id": "gwb", "name": "Interior wall, 5/8 in board both sides", "components": [
    {"name": "Gypsum board 4x8", "source": "wall_area", "source_unit": "sf", "factor": 2, "waste_pct": 10,
     "pack": 32, "unit": "sheet", "unit_cost_cents": 1450},
    {"name": "Studs 16 in o.c.", "source": "length", "source_unit": "ft", "factor": 0.75, "per_each": 1,
     "waste_pct": 5, "pack": 1, "unit": "ea", "unit_cost_cents": 589},
    {"name": "Track top and bottom", "source": "length", "source_unit": "ft", "factor": 2, "waste_pct": 5,
     "pack": 10, "unit": "10 ft stick", "unit_cost_cents": 799},
    {"name": "Hang and finish labor", "source": "wall_area", "source_unit": "sf", "factor": 4 / 100,
     "unit": "hr", "unit_cost_cents": 6500},
]}


def test_drywall_assembly_hand_check():
    # Two walls: 15 ft and 25 ft long, both 8 ft high.
    walls = [measure({"type": "polylength", "points": [[0, 0], [270, 0]], "height": 96}, QUARTER),
             measure({"type": "polylength", "points": [[0, 0], [450, 0]], "height": 96}, QUARTER)]
    # Check the walls: 270 pt = 15 ft, 450 pt = 25 ft.
    res = a.apply_assembly(DRYWALL, walls)
    t = res["totals"]
    assert t["length_in"] / 12 == pytest.approx(40) and t["measurements"] == 2
    board, studs, track, labor = res["components"]
    # Wall area 40 x 8 = 320 SF, both sides 640 SF, +10% = 704 SF, / 32 = 22 sheets exactly.
    assert board["raw"] == pytest.approx(640) and board["with_waste"] == pytest.approx(704)
    assert board["order"] == 22 and board["cost_cents"] == 22 * 1450
    # Studs: 40 x 0.75 + 1 per wall x 2 = 32, +5% = 33.6, round up 34.
    assert studs["raw"] == pytest.approx(32) and studs["order"] == 34
    # Track: 80 LF + 5% = 84 LF, sticks of 10 ft: 9.
    assert track["order"] == 9 and track["cost_cents"] == 9 * 799
    # Labor: 320 SF of wall x 0.04 hr/SF (both sides) = 12.8 hr, not rounded to a pack.
    assert labor["order"] == pytest.approx(12.8) and labor["cost_cents"] == 83200
    assert res["cost_cents"] == 22 * 1450 + 34 * 589 + 9 * 799 + 83200


def test_round_up_does_not_add_a_unit_on_exact_multiples():
    tot = a.sum_quantities([{"kind": "area", "value": 1.0, "area_sq_in": 144 * 96.0}])
    c = a.component_quantity({"source": "area", "source_unit": "sf", "factor": 1, "pack": 32}, tot)
    assert c["order"] == 3
    tot = a.sum_quantities([{"kind": "area", "value": 1.0, "area_sq_in": 144 * (0.1 + 0.2) * 320}])
    c = a.component_quantity({"source": "area", "source_unit": "sf", "factor": 1, "pack": 96}, tot)
    assert c["order"] == 1


def test_zero_quantity_orders_nothing():
    c = a.component_quantity({"source": "area", "pack": 32}, a.sum_quantities([]))
    assert c["order"] == 0 and c["cost_cents"] == 0


def test_estimate_markup_and_tax():
    walls = [measure({"type": "polylength", "points": [[0, 0], [270, 0]], "height": 96}, QUARTER)]
    est = a.estimate([DRYWALL], {"gwb": walls}, markup_pct=15, tax_pct=8.25)
    sub = est["subtotal_cents"]
    assert est["markup_cents"] == int(math.floor(sub * 0.15 + 0.5))
    assert est["tax_cents"] == int(math.floor((sub + est["markup_cents"]) * 0.0825 + 0.5))
    assert est["total_cents"] == sub + est["markup_cents"] + est["tax_cents"]


def test_assembly_rejects_bad_input():
    tot = a.sum_quantities([])
    with pytest.raises(TakeoffError):
        a.component_quantity({"source": "bogus"}, tot)
    with pytest.raises(TakeoffError):
        a.component_quantity({"source": "area", "source_unit": "ft"}, tot)
    with pytest.raises(TakeoffError):
        a.component_quantity({"source": "area", "factor": float("inf")}, tot)
    with pytest.raises(TakeoffError):
        a.component_quantity({"source": "area", "factor": "abc"}, tot)


def test_uncalibrated_measurements_are_counted_as_missing():
    tot = a.sum_quantities([measure({"type": "area", "points": [[0, 0], [1, 0], [1, 1]]}, None)])
    assert tot["missing_scale"] == 1 and tot["area_sq_in"] == 0


# ------------------------------------------------------------- markup file


def sample_doc():
    return {
        "format": FILE_FORMAT, "version": 1,
        "settings": {"length_unit": "ftin", "area_unit": "sf", "volume_unit": "cy", "places": 2, "author": "Estimator"},
        "pages": {"0": {"scale": {"in_per_pt": QUARTER, "label": '1/4" = 1\'-0"', "source": "standard"}, "label": "A-101"}},
        "layers": [{"id": "walls", "name": "Walls", "assembly": "gwb"}],
        "assemblies": [DRYWALL],
        "columns": [{"id": "phase", "name": "Phase"}],
        "markups": [
            {"id": "m1", "type": "area", "page": 0, "points": [[0, 0], [720, 0], [720, 540], [0, 540]],
             "subject": "Floor", "custom": {"phase": "=1+1"}},
            {"id": "m2", "type": "polylength", "page": 0, "points": [[0, 0], [270, 0]], "height": 96,
             "subject": "Wall", "layer": "walls", "assembly": "gwb", "assembly_source": "layer"},
            {"id": "m3", "type": "count", "page": 0, "points": [[5, 5], [6, 6]], "subject": "Door"},
            {"id": "m4", "type": "cloud", "page": 1, "points": [[0, 0], [10, 10]], "text": "Check this"},
            {"id": "m5", "type": "length", "page": 1, "points": [[0, 0], [10, 0]], "subject": "Wall"},
        ],
    }


def test_clean_document_keeps_good_markups():
    doc, rep = mk.clean_document(sample_doc())
    assert len(doc["markups"]) == 5 and sum(rep.values()) == 0
    assert doc["layers"][0]["assembly"] == "gwb"


def test_clean_document_drops_hostile_entries():
    raw = sample_doc()
    raw["markups"] += [
        {"id": "bad id with spaces", "type": "area", "page": 0, "points": [[0, 0], [1, 0], [1, 1]]},
        {"id": "x1", "type": "script", "page": 0, "points": [[0, 0]]},
        {"id": "x2", "type": "length", "page": -1, "points": [[0, 0], [1, 1]]},
        {"id": "x3", "type": "length", "page": 0, "points": [[0, 0], [1e308 * 10, 1]]},
        {"id": "x4", "type": "length", "page": 0, "points": [[0, 0]]},
        {"id": "x5", "type": "length", "page": True, "points": [[0, 0], [1, 1]]},
        {"id": "m1", "type": "count", "page": 0, "points": [[0, 0]]},  # duplicate id
        "not an object",
        {"id": "x6", "type": "text", "page": 0, "points": [[0, 0]], "text": "a‮b" + "z" * 9000,
         "color": "red", "opacity": 7, "__proto__": {"polluted": True}},
    ]
    doc, rep = mk.clean_document(raw)
    assert rep["markups_dropped"] == 8
    t = doc["markups"][-1]
    assert t["id"] == "x6" and len(t["text"]) == 5000 and "‮" not in t["text"]
    assert "color" not in t and "opacity" not in t and "__proto__" not in t


@pytest.mark.parametrize("bad", [None, [], "x", {"format": "other", "version": 1},
                                 {"format": FILE_FORMAT, "version": "1"}, {"format": FILE_FORMAT, "version": 99},
                                 {"format": FILE_FORMAT, "version": 1, "markups": {"a": 1}}])
def test_clean_document_rejects(bad):
    with pytest.raises(TakeoffError):
        mk.clean_document(bad)


def test_markup_rows_and_groups():
    doc, _ = mk.clean_document(sample_doc())
    rows = mk.markup_rows(doc)
    by_id = {r["id"]: r for r in rows}
    assert by_id["m1"]["measurement"] == "1,200.00 SF" and by_id["m1"]["quantity"] == pytest.approx(1200)
    assert by_id["m2"]["measurement"] == "15'-0\"" and by_id["m2"]["unit"] == "ft"
    assert by_id["m3"]["measurement"] == "2 ea"
    assert by_id["m4"]["quantity"] is None
    assert by_id["m5"]["measurement"] == "Not calibrated"
    assert by_id["m1"]["sheet"] == "A-101" and by_id["m2"]["layer"] == "Walls"
    groups = mk.group_totals(rows, "subject")
    assert [g["group"] for g in groups] == ["Door", "Floor", "Wall", ""]
    wall = groups[2]
    assert wall["rows"] == 2 and wall["totals"] == [{"unit": "ft", "quantity": pytest.approx(15)}]
    phase = mk.group_totals(rows, "custom:phase")
    assert phase[0]["group"] == "=1+1"


def test_document_estimate():
    doc, _ = mk.clean_document(sample_doc())
    est = mk.document_estimate(doc)
    assert est["lines"][0]["totals"]["measurements"] == 1


# ------------------------------------------------------------------- CSV


@pytest.mark.parametrize("raw,cell", [
    ("=HYPERLINK(\"x\")", "\"'=HYPERLINK(\"\"x\"\")\""), ("+1", "'+1"), ("-1", "'-1"), ("@SUM(A1)", "'@SUM(A1)"),
    ("\tx", "'\tx"), ("plain", "plain"), ("a,b", "\"a,b\""), ("line\nbreak", "\"line\nbreak\""), (" pad", "\" pad\""),
    ("", ""), (None, ""),
])
def test_formula_guard(raw, cell):
    assert x.text_cell(raw) == cell


def test_num_cell():
    assert x.num_cell(1200.0) == "1200"
    assert x.num_cell(14.814814814814815) == "14.814815"
    assert x.num_cell(-0.0000001) == "0"
    assert x.num_cell(-2.5) == "-2.5"
    assert x.num_cell(None) == "" and x.num_cell(float("nan")) == ""
    assert x.money_cell(-1234) == "-12.34" and x.money_cell(5) == "0.05"


def test_markup_list_csv():
    doc, _ = mk.clean_document(sample_doc())
    out = x.markup_list_csv(mk.markup_rows(doc), doc["columns"], "subject")
    lines = out.split("\r\n")
    assert lines[0].startswith("Page,Sheet,Type,Subject") and lines[0].endswith(",Phase")
    assert "'=1+1" in lines[1]
    assert "Totals by subject,Rows,Quantity,Unit" in lines
    assert "Wall,2,15,ft" in lines
    assert out.endswith("\r\n")


def test_estimate_csv():
    doc, _ = mk.clean_document(sample_doc())
    out = x.estimate_csv(mk.document_estimate(doc))
    assert "Gypsum board 4x8" in out and out.splitlines()[-1].startswith("Total,")


def test_json_round_trip_is_stable():
    doc, _ = mk.clean_document(sample_doc())
    again, rep = mk.clean_document(json.loads(json.dumps(doc)))
    assert again == doc and sum(rep.values()) == 0


def test_cli(tmp_path, capsys):
    from plantakeoff.cli import main
    assert main(["length", "12'-6 1/2\"", "--to", "m"]) == 0
    assert capsys.readouterr().out.strip() == "3.8227 m"
    assert main(["scale", "SCALE: 1/8\" = 1'-0\" and NTS"]) == 0
    out = capsys.readouterr().out
    assert "1:96.00 (1/8\" = 1'-0\")" in out and "not to scale" in out
    f = tmp_path / "m.json"
    f.write_text(json.dumps(sample_doc()), encoding="utf-8")
    assert main(["list", str(f), "--group-by", "subject"]) == 0
    assert "Totals by subject" in capsys.readouterr().out
    assert main(["estimate", str(f)]) == 0
    assert capsys.readouterr().out.splitlines()[-1].startswith("Total,")
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert main(["list", str(bad)]) == 2
    assert "not valid JSON" in capsys.readouterr().err
    assert main(["list", str(tmp_path / "missing.json")]) == 2


def test_count_glyph_is_kept_only_for_counts_and_known_shapes():
    from plantakeoff.markups import clean_markup
    base = {"id": "c1", "type": "count", "page": 0, "points": [[1, 1]]}
    assert clean_markup(dict(base, glyph="diamond"))["glyph"] == "diamond"
    assert "glyph" not in clean_markup(dict(base, glyph="star"))
    assert "glyph" not in clean_markup({"id": "l1", "type": "length", "page": 0, "points": [[0, 0], [1, 0]], "glyph": "circle"})


def test_pitch_never_multiplies_a_volume():
    outer = [[0, 0], [720, 0], [720, 540], [0, 540]]
    flat = measure({"type": "volume", "points": outer, "depth": 4}, QUARTER)
    pitched = measure({"type": "volume", "points": outer, "depth": 4, "pitch": 12}, QUARTER)
    assert pitched["volume_cu_in"] == pytest.approx(flat["volume_cu_in"])
    assert pitched["volume_cu_in"] == pytest.approx(1200 * 144 * 4)  # 1,200 SF x 4 in = 400 CF
    assert pitched["area_sq_in"] == pytest.approx(1200 * 144)
    roof = measure({"type": "area", "points": outer, "pitch": 12}, QUARTER)
    assert roof["area_sq_in"] == pytest.approx(1200 * 144 * math.sqrt(2))


def test_diameter_two_points_or_three_on_the_circle():
    d2 = measure({"type": "diameter", "points": [[0, 0], [72, 0]]}, QUARTER)  # 4 ft across
    assert d2["value"] == pytest.approx(48) and d2["radius_in"] == pytest.approx(24)
    assert d2["area_sq_in"] == pytest.approx(math.pi * 24 * 24)
    d3 = measure({"type": "diameter", "points": [[36, 0], [0, 36], [-36, 0]]}, QUARTER)
    assert d3["length_in"] == pytest.approx(48)
    assert measure({"type": "diameter", "points": [[0, 0], [72, 0]]}, None)["value"] is None
    with pytest.raises(TakeoffError):
        measure({"type": "diameter", "points": [[0, 0]]}, QUARTER)


def test_angles_are_listed_but_never_summed_in_group_totals():
    doc = {"format": FILE_FORMAT, "version": 1, "pages": {"0": {"scale": {"in_per_pt": QUARTER, "label": "q"}}}, "markups": [
        {"id": "a", "type": "angle", "page": 0, "points": [[10, 0], [0, 0], [0, 10]], "subject": "Corner"},
        {"id": "b", "type": "angle", "page": 0, "points": [[10, 0], [0, 0], [10, 10]], "subject": "Corner"},
        {"id": "c", "type": "length", "page": 0, "points": [[0, 0], [18, 0]], "subject": "Corner"}]}
    d, _ = mk.clean_document(doc)
    rows = mk.markup_rows(d)
    assert [r["unit"] for r in rows] == ["deg", "deg", "ft"]
    g = mk.group_totals(rows, "subject")
    assert g == [{"group": "Corner", "rows": 3, "totals": [{"unit": "ft", "quantity": pytest.approx(1.0)}]}]
    assert "deg" not in x.markup_list_csv(rows, [], "subject").split("Totals by")[1]


def test_engineering_scales_reach_one_inch_to_a_thousand_feet():
    from plantakeoff.scale import STANDARD_SCALES
    eng = {s["label"]: s["in_per_pt"] for s in STANDARD_SCALES if s["group"] == "Engineering"}
    for n in (300, 400, 600, 1000):
        assert eng[f'1" = {n}\''] == pytest.approx(n * 12 / 72)
