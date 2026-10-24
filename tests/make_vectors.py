"""Write tests/vectors.json: inputs and the Python library's outputs, replayed against the
browser core by web/parity.test.mjs.

Run: python tests/make_vectors.py
"""

import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from plantakeoff import annotations, assembly, export, formula, geometry, library, markups, measure, merge, scale, units  # noqa: E402
from plantakeoff.brand import FILE_FORMAT  # noqa: E402
from plantakeoff.errors import TakeoffError  # noqa: E402

FUNCS = {
    "parse_length": units.parse_length, "format_ftin": units.format_ftin, "format_number": units.format_number,
    "format_length": units.format_length, "format_area": units.format_area, "format_volume": units.format_volume,
    "convert": units.convert, "unit_kind": units.unit_kind,
    "parse_scale_text": scale.parse_scale_text, "calibrate": scale.calibrate, "scale_from_ratio": scale.scale_from_ratio,
    "ratio_of": scale.ratio_of,
    "polyline_length": geometry.polyline_length, "signed_area": geometry.signed_area, "perimeter": geometry.perimeter,
    "self_intersections": geometry.self_intersections, "point_in_polygon": geometry.point_in_polygon,
    "polygon_with_holes": geometry.polygon_with_holes, "centroid": geometry.centroid, "angle_deg": geometry.angle_deg,
    "circle_through": geometry.circle_through, "bbox": geometry.bbox, "snap_angle": geometry.snap_angle,
    "nearest_on_segment": geometry.nearest_on_segment, "snap_grid": geometry.snap_grid, "snap": geometry.snap,
    "simplify": geometry.simplify, "segments_intersect": geometry.segments_intersect,
    "pitch_factor": measure.pitch_factor, "measure": measure.measure,
    "sum_quantities": assembly.sum_quantities, "component_quantity": assembly.component_quantity,
    "apply_assembly": assembly.apply_assembly, "estimate": assembly.estimate,
    "clean_markup": markups.clean_markup, "clean_document": markups.clean_document, "group_totals": markups.group_totals,
    "text_cell": export.text_cell, "num_cell": export.num_cell, "money_cell": export.money_cell,
    "estimate_csv": export.estimate_csv,
    "formula_eval": formula.evaluate, "formula_names": formula.names, "formula_variables": formula.variables,
    "assembly_env": assembly.assembly_env, "markup_scale": markups.markup_scale, "viewport_at": markups.viewport_at,
    "merge_markups": merge.merge_markups, "merge_documents": merge.merge_documents,
    "merge_comments": merge.merge_comments, "merge_status_log": merge.merge_status_log,
    "hex_to_rgb": annotations.hex_to_rgb, "rgb_to_hex": annotations.rgb_to_hex, "pdf_date_to_iso": annotations.pdf_date_to_iso,
    "iso_to_pdf_date": annotations.iso_to_pdf_date, "measure_dict": annotations.measure_dict,
    "scale_from_measure": annotations.scale_from_measure, "markup_to_annots": annotations.markup_to_annots,
    "annot_to_markup": annotations.annot_to_markup, "annots_to_markups": annotations.annots_to_markups,
    "viewport_from_vp": annotations.viewport_from_vp,
}


def nearest_label(ipp):
    s = scale.nearest_standard(ipp)
    return None if s is None else s["label"]


def rows_of(doc):
    d, _ = markups.clean_document(doc)
    return markups.markup_rows(d)


def csv_of(doc, group_by):
    d, _ = markups.clean_document(doc)
    return export.markup_list_csv(markups.markup_rows(d), d["columns"], group_by)


def estimate_of(doc):
    d, _ = markups.clean_document(doc)
    return markups.document_estimate(d)


FUNCS.update({"nearest_label": nearest_label, "rows_of": rows_of, "csv_of": csv_of, "estimate_of": estimate_of})

sys.path.insert(0, str(ROOT / "tests"))
import auto_vectors  # noqa: E402

FUNCS.update(auto_vectors.FUNCS)

cases = []


def case(fn, *args):
    try:
        out = FUNCS[fn](*args)
        cases.append({"fn": fn, "args": list(args), "out": json.loads(json.dumps(out))})
    except TakeoffError as e:
        cases.append({"fn": fn, "args": list(args), "error": e.code})


def main():
    rng = random.Random(2026)
    # units
    for t in ["12'-6\"", "12' 6 1/2\"", "12'6-1/2\"", "6\"", "1/4\"", "1 1/2\"", "12'", "12.5 ft", "3.2 m", "250 mm",
              "25 cm", "2 yd", "7", "7 1/2", "0'-3/8\"", "", "abc", "1/0\"", "12′-6″", "  4' 0\"  ", ".5\""]:
        case("parse_length", t)
    case("parse_length", "10", "m")
    case("parse_length", "10", "in")
    for x in [0, 0.03, 0.5, 11.99999, 150.5, 150.3, -18, 1e6 + 0.123, 35.96875]:
        for d in (1, 8, 16, 32):
            case("format_ftin", x, d)
    case("format_ftin", 1, 3)
    for x in [0, 0.005, -0.004, 2.5, 1234567.891, -1234.5678, 1e12 / 7]:
        for p in (0, 1, 2, 4):
            case("format_number", x, p)
    for u in ("ftin", "ft", "in", "yd", "m", "cm", "mm"):
        case("format_length", 150.5, u, 3, 16)
    for u in ("sf", "sy", "sm", "sq_in", "acre"):
        case("format_area", 172800, u, 2)
    for u in ("cy", "cf", "cu_m", "l", "gal"):
        case("format_volume", 691200, u, 2)
    for a, b in [("cy", "cf"), ("sm", "sf"), ("acre", "sf"), ("ftin", "in"), ("m", "ft"), ("sf", "ft"), ("gal", "l")]:
        case("convert", 3.5, a, b)
    for u in ("ftin", "sf", "cy", "ea", "parsec"):
        case("unit_kind", u)
    # scales
    for t in ['SCALE: 1/4" = 1\'-0"', "SCALE: 1/8\"=1'", '1" = 20\'', '1"=20\'-0"', "SCALE 1:100", "scale 1 : 50",
              '3/16" = 1\'-0" NTS', '1 1/2" = 1\'-0"', "Meeting at 1:30 pm, room 2 = 3", "NOT TO SCALE", "1:200",
              'PLAN 1/4" = 1\'-0"   DETAIL 1 1/2" = 1\'-0"', "N.T.S.", "", '1/4 " = 1 \'-0 "', "1:7"]:
        case("parse_scale_text", t)
    for ipp in [s["in_per_pt"] for s in scale.STANDARD_SCALES] + [0.7, 12 / 18 * 1.004]:
        case("nearest_label", ipp)
    case("calibrate", [100, 100], [280, 100], 120)
    case("calibrate", [1, 1], [1, 1], 10)
    case("calibrate", [0, 0], [3, 4], -1)
    case("scale_from_ratio", 0.25, 12)
    case("scale_from_ratio", 0, 12)
    case("ratio_of", 2 / 3)
    # geometry, hand cases
    rect = [[0, 0], [10, 0], [10, 5], [0, 5]]
    lsh = [[0, 0], [20, 0], [20, 5], [10, 5], [10, 10], [0, 10]]
    bow = [[0, 0], [10, 10], [10, 0], [0, 10]]
    for p in (rect, rect[::-1], lsh, bow, [[0, 0], [4, 0], [0, 3]], [[1, 1]], [[0, 0], [3, 4]]):
        case("signed_area", p)
        case("perimeter", p)
        case("polyline_length", p)
        case("self_intersections", p)
        case("centroid", p)
        case("bbox", p)
    case("self_intersections", [[0, 0], [10, 0], [10, 10], [5, 0], [0, 10]])
    case("self_intersections", bow, False)
    case("polyline_length", [[0, 0], [float(1), "x"]])
    case("polyline_length", [[0, 0], [True, 1]])
    for q in ([5, 5], [15, 5], [10, 5], [0, 0]):
        case("point_in_polygon", q, rect)
    outer = [[0, 0], [100, 0], [100, 100], [0, 100]]
    case("polygon_with_holes", outer, [[[10, 10], [20, 10], [20, 20], [10, 20]], [[50, 50], [70, 50], [70, 60], [50, 60]]])
    case("polygon_with_holes", outer, [[[90, 90], [120, 90], [120, 120], [90, 120]]])
    case("polygon_with_holes", outer, [[[1, 1], [50, 1], [50, 50], [1, 50]], [[30, 30], [70, 30], [70, 70], [30, 70]]])
    case("polygon_with_holes", [[0, 0], [1, 0], [1, 1], [0, 1]], [[[0, 0], [1, 0], [1, 1], [0, 1]]] * 2)
    case("polygon_with_holes", [[0, 0], [1, 1]], [])
    case("angle_deg", [10, 0], [0, 0], [0, 10])
    case("angle_deg", [10, 0], [0, 0], [-10, 1e-9])
    case("angle_deg", [0, 0], [0, 0], [1, 1])
    case("circle_through", [5, 0], [0, 5], [-5, 0])
    case("circle_through", [3, 4], [-4, 3], [0, -5])
    case("circle_through", [0, 0], [1, 1], [2, 2])
    for p in ([10, 1], [10, 9], [1, 10], [-3, -3.2], [0, 0]):
        case("snap_angle", [0, 0], p, 45)
        case("snap_angle", [1, 2], p, 15)
    case("nearest_on_segment", [5, 5], [0, 0], [10, 0])
    case("nearest_on_segment", [-5, 5], [0, 0], [10, 0])
    case("snap_grid", [7.4, 3.6], 1)
    case("snap_grid", [7.5, -2.5], 2.5)
    segs = [[[0, 0], [10, 0]], [[10, 0], [10, 10]]]
    for p in ([0.3, 0.2], [5.2, 0.4], [7.5, 0.4], [7.4, 3.6], [10.4, 5.1], [50, 50]):
        case("snap", p, 1, [[0, 0], [10, 10]], segs, 1)
        case("snap", p, 1, [], segs, 0)
    case("simplify", [[0, 0], [1, 0.01], [2, -0.01], [3, 0], [3, 3]], 0.1)
    case("segments_intersect", [0, 0], [10, 10], [0, 10], [10, 0])
    case("segments_intersect", [0, 0], [10, 0], [10, 0], [20, 0])
    case("segments_intersect", [0, 0], [10, 0], [11, 0], [20, 0])
    # geometry, random
    for _ in range(60):
        n = rng.randint(3, 20)
        p = [[rng.uniform(-500, 500), rng.uniform(-500, 500)] for _ in range(n)]
        holes = []
        case("signed_area", p)
        case("perimeter", p)
        case("self_intersections", p)
        case("centroid", p)
        case("polygon_with_holes", p, holes)
        case("point_in_polygon", [rng.uniform(-500, 500), rng.uniform(-500, 500)], p)
        case("simplify", p, rng.uniform(0, 100))
        case("snap_angle", p[0], p[1], rng.choice([15, 30, 45, 90]))
    # measurements
    Q = 12 / 18
    big = [[0, 0], [720, 0], [720, 540], [0, 540]]
    hole = [[180, 180], [360, 180], [360, 360], [180, 360]]
    ms = [
        {"type": "length", "points": [[0, 0], [180, 0], [180, 900]]},
        {"type": "polylength", "points": [[0, 0], [180, 0], [180, 90]], "height": 96},
        {"type": "area", "points": big, "holes": [hole]},
        {"type": "area", "points": big, "pitch": 6},
        {"type": "area", "points": bow},
        {"type": "volume", "points": big, "depth": 4},
        {"type": "perimeter", "points": [[0, 0], [180, 0], [180, 180], [0, 180]], "height": 120},
        {"type": "count", "points": [[1, 1], [2, 2], [3, 3]]},
        {"type": "angle", "points": [[10, 0], [0, 0], [0, 10]]},
        {"type": "radius", "points": [[0, 0], [36, 0]]},
        {"type": "radius", "points": [[36, 0], [0, 36], [-36, 0]]},
        {"type": "radius", "points": [[0, 0]]},
        {"type": "diameter", "points": [[0, 0], [72, 0]]},
        {"type": "diameter", "points": [[36, 0], [0, 36], [-36, 0]]},
        {"type": "diameter", "points": [[0, 0]]},
        {"type": "volume", "points": big, "depth": 4, "pitch": 6},
        {"type": "angle", "points": [[0, 0], [1, 1]]},
        {"type": "area", "points": big, "pitch": -2},
        {"type": "volume", "points": big, "depth": "4"},
        {"type": "cloud", "points": [[0, 0], [1, 1]]},
    ]
    for m in ms:
        case("measure", m, Q)
        case("measure", m, None)
    case("measure", ms[0], 0)
    case("measure", ms[0], -1)
    for _ in range(40):
        t = rng.choice(["length", "polylength", "area", "perimeter", "volume", "count", "radius", "diameter"])
        n = {"length": 2, "polylength": rng.randint(2, 8), "area": rng.randint(3, 10), "perimeter": rng.randint(2, 8),
             "volume": rng.randint(3, 8), "count": rng.randint(1, 9), "radius": rng.choice([2, 3]), "diameter": rng.choice([2, 3])}[t]
        m = {"type": t, "points": [[rng.uniform(0, 3000), rng.uniform(0, 2000)] for _ in range(n)]}
        if t in ("volume",):
            m["depth"] = rng.uniform(0, 24)
        if t in ("area", "volume") and rng.random() < 0.3:
            m["pitch"] = rng.choice([0, 4, 6, 12])
        if t in ("polylength", "perimeter") and rng.random() < 0.5:
            m["height"] = rng.uniform(0, 200)
        case("measure", m, rng.choice([Q, 1 / 3, 100 / 72, 3.3333333333]))
    # assemblies
    comps = [
        {"name": "Gypsum board 4x8", "source": "wall_area", "source_unit": "sf", "factor": 2, "waste_pct": 10, "pack": 32,
         "unit": "sheet", "unit_cost_cents": 1450},
        {"name": "Studs", "source": "length", "source_unit": "ft", "factor": 0.75, "per_each": 1, "waste_pct": 5, "pack": 1,
         "unit": "ea", "unit_cost_cents": 589},
        {"name": "Labor", "source": "wall_area", "source_unit": "sf", "factor": 0.04, "unit": "hr", "unit_cost_cents": 6500},
        {"name": "Each", "source": "each", "factor": 2, "pack": 1, "unit": "ea", "unit_cost_cents": 100},
        {"name": "Concrete", "source": "volume", "source_unit": "cy", "factor": 1, "waste_pct": 5, "pack": 0.5,
         "unit": "half yard", "unit_cost_cents": 8250},
        {"name": "Count", "source": "count", "factor": 1.5, "unit": "hr", "unit_cost_cents": 6500},
    ]
    results = [measure.measure(m, Q) for m in ms[:11]]
    results = json.loads(json.dumps(results))
    case("sum_quantities", results)
    tot = assembly.sum_quantities(results)
    for c in comps:
        case("component_quantity", c, tot)
    case("component_quantity", {"source": "bogus"}, tot)
    case("component_quantity", {"source": "area", "source_unit": "ft"}, tot)
    case("component_quantity", {"source": "area", "factor": "2"}, tot)
    case("component_quantity", {"source": "area", "factor": True}, tot)
    case("component_quantity", {"source": "area", "waste_pct": -1}, tot)
    asm = {"id": "a1", "name": "Wall", "components": comps}
    case("apply_assembly", asm, results)
    case("estimate", [asm, {"id": "a2", "name": "Empty", "components": comps[:2]}], {"a1": results}, 15, 8.25)
    case("estimate", [asm], {"a1": results}, -1, 0)
    for _ in range(30):
        tq = {"length_in": rng.uniform(0, 1e5), "perimeter_in": rng.uniform(0, 1e5), "area_sq_in": rng.uniform(0, 1e7),
              "volume_cu_in": rng.uniform(0, 1e7), "wall_area_sq_in": rng.uniform(0, 1e7), "count": rng.randint(0, 500),
              "measurements": rng.randint(0, 50), "missing_scale": 0}
        c = dict(rng.choice(comps))
        c["waste_pct"] = rng.choice([0, 5, 10, 12.5])
        c["pack"] = rng.choice([0, 1, 8, 32, 33.3, 0.5])
        case("component_quantity", c, tq)
    # markup file
    doc = {
        "format": FILE_FORMAT, "version": 1,
        "settings": {"length_unit": "ftin", "area_unit": "sf", "volume_unit": "cy", "places": 2, "author": "Estimator",
                     "markup_pct": 12, "tax_pct": 8.25, "denominator": 16.0},
        "pages": {"0": {"scale": {"in_per_pt": Q, "label": '1/4" = 1\'-0"', "source": "standard"}, "label": "A-101",
                        "title": "FLOOR PLAN"},
                  "2": {"scale": {"in_per_pt": 240 / 72, "label": '1" = 20\'', "source": "titleblock"}},
                  "x": {}, "07": {"label": "seven"}},
        "layers": [{"id": "walls", "name": "Walls", "assembly": "a1"}, {"id": "walls"}, {"id": "bad id"}, "x"],
        "assemblies": [asm, {"id": "a2", "components": "nope"}],
        "columns": [{"id": "phase", "name": "Phase"}, {"id": "phase"}, {"id": "cost-code", "name": "Cost code"}],
        "markups": [
            {"id": "m1", "type": "area", "page": 0, "points": big, "holes": [hole], "subject": "Floor",
             "custom": {"phase": "=1+1", "cost-code": "09 65 00"}},
            {"id": "m2", "type": "polylength", "page": 0, "points": [[0, 0], [270, 0]], "height": 96, "subject": "Wall",
             "layer": "walls", "assembly": "a1", "assembly_source": "layer"},
            {"id": "m3", "type": "count", "page": 0, "points": [[5, 5], [6, 6]], "subject": "Door", "glyph": "diamond"},
            {"id": "m3b", "type": "count", "page": 0, "points": [[7, 7]], "glyph": "star"},
            {"id": "m3c", "type": "length", "page": 0, "points": [[0, 0], [5, 0]], "glyph": "circle"},
            {"id": "m4", "type": "cloud", "page": 1, "points": [[0, 0], [10, 10]], "text": "Check this"},
            {"id": "m5", "type": "length", "page": 1, "points": [[0, 0], [10, 0]], "subject": "Wall"},
            {"id": "m6", "type": "volume", "page": 2, "points": [[0, 0], [72, 0], [72, 36], [0, 36]], "depth": 4,
             "subject": "Sidewalk", "assembly": "a1", "color": "#AABBCC", "opacity": 0.5, "status": "Open"},
            {"id": "m7", "type": "angle", "page": 0, "points": [[10, 0], [0, 0], [0, 10]], "subject": "Wall"},
            {"id": "m7b", "type": "angle", "page": 0, "points": [[10, 0], [0, 0], [10, 10]], "subject": "Wall"},
            {"id": "m7c", "type": "diameter", "page": 0, "points": [[0, 0], [36, 0]], "subject": "Column"},
            {"id": "m8", "type": "area", "page": 0, "points": bow, "subject": "Floor"},
            {"id": "m9", "type": "text", "page": 7, "points": [[1, 2]], "text": "a‮b\u0007c", "subject": "Note"},
            {"id": "bad id", "type": "area", "page": 0, "points": rect},
            {"id": "x1", "type": "script", "page": 0, "points": [[0, 0]]},
            {"id": "x2", "type": "length", "page": -1, "points": [[0, 0], [1, 1]]},
            {"id": "x3", "type": "length", "page": 0, "points": [[0, 0], [1e300, 1]]},
            {"id": "x4", "type": "length", "page": 0, "points": [[0, 0]]},
            {"id": "x5", "type": "length", "page": True, "points": [[0, 0], [1, 1]]},
            {"id": "m1", "type": "count", "page": 0, "points": [[0, 0]]},
            {"id": "__proto__", "type": "count", "page": 0, "points": [[0, 0]]},
            "not an object",
            {"id": "x6", "type": "text", "page": 0.0, "points": [[0, 0]], "text": "z" * 6000, "color": "red",
             "opacity": 7, "custom": {"__proto__": "p", "ok": "v", "bad key": "w"}, "label": 5, "assembly_source": "layer"},
            {"id": "x7", "type": "count", "page": 1.5, "points": [[0, 0]]},
        ],
        "document": {"name": "plans.pdf", "sha256": "ab" * 32},
    }
    case("clean_document", doc)
    for bad in (None, [], "x", {"format": "other", "version": 1}, {"format": FILE_FORMAT, "version": "1"},
                {"format": FILE_FORMAT, "version": 99}, {"format": FILE_FORMAT, "version": 1, "markups": {"a": 1}},
                {"format": FILE_FORMAT, "version": 1, "markups": None, "settings": "x", "pages": [], "layers": {}},
                {"format": FILE_FORMAT, "version": True}):
        case("clean_document", bad)
    case("rows_of", doc)
    for key in ("subject", "type", "page", "layer", "status", "custom:phase", "sheet"):
        rows = rows_of(doc)
        case("group_totals", rows, key)
    case("csv_of", doc, "subject")
    case("csv_of", doc, "")
    for lu in ("ft", "m", "in"):
        d2 = json.loads(json.dumps(doc))
        d2["settings"].update({"length_unit": lu, "area_unit": "sm" if lu == "m" else "sy", "volume_unit": "cf", "places": 3})
        case("rows_of", d2)
    case("estimate_of", doc)
    case("estimate_csv", estimate_of(doc))
    for s in ["=HYPERLINK(\"x\")", "+1", "-1", "@SUM(A1)", "\tx", "\rx", "plain", "a,b", "line\nbreak", " pad", "", None,
              "q\"uote", "été"]:
        case("text_cell", s)
    for x in [1200.0, 14.814814814814815, -0.0000001, -2.5, None, 0.1 + 0.2, 123456789.123456789, 1e-7, 5e-7]:
        case("num_cell", x)
        case("num_cell", x, 2)
    for c in [-1234, 5, 0, 100, 123456789]:
        case("money_cell", c)
    phase2(rng, doc, Q, big, hole, comps)
    auto_vectors.phase3(case, random.Random(16))
    out = {"cases": cases}
    path = ROOT / "tests" / "vectors.json"
    path.write_text(json.dumps(out, indent=0, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)} ({len(cases)} cases)")


def phase2(rng, doc, Q, big, hole, comps):
    """Formulas, assemblies with labor and overhead, the session fields, viewports, imported
    quantities, merging and the PDF annotation mapping."""
    env = {"LF": 100.0, "SF": 480.0, "WSF": 900.0, "N": 3.0, "EA": 7.0, "spacing_in": 16.0, "coats": 2.0, "height_ft": 9.0}
    for f in ["LF * 12 / spacing_in + N", "ceil(SF * 2 / 32)", "2^3^2", "-2^2", "max(1, 2, 3) + min(4, 5)", "round(2.5) + round(-2.5)",
              "floor(2.9999999999)", "ceil(3.0000000001)", "sqrt(WSF) * coats", "(LF + 2) * (height_ft - 1) / 3", "abs(-4.5e-1)",
              "1.5e3 + .25", "EA * 1.1", "", "1 +", "(1", "1)", "foo(1)", "x", "1 / 0", "sqrt(-1)", "1 2", "a @ b", "min()",
              "ceil(1, 2)", "either(WSF, LF * height_ft)", "either(0, LF * height_ft)", "either(1)", "(-8) ^ 0.5", "0 ^ -1", "10 ^ 400", "1" + "+1" * 250, "(" * 45 + "1" + ")" * 45, "a" * 33, "  SF  "]:
        case("formula_eval", f, env)
    case("formula_eval", "x + 1", {"x": True})
    case("formula_eval", "x + 1", {"x": float("1e308"), "bad name": 3})
    for f in ["LF * spacing_in + max(SF, WSF)", "ceil(a / b) + a", "1 +"]:
        case("formula_names", f)
    tq = {"length_in": 1200.0, "perimeter_in": 600.0, "area_sq_in": 144000.0, "volume_cu_in": 93312.0, "wall_area_sq_in": 129600.0,
          "count": 7, "measurements": 3, "missing_scale": 0}
    case("formula_variables", tq)
    asm = {"id": "studs", "name": "Wall framing", "params": [{"id": "spacing_in", "value": 16}, {"id": "LF", "value": 9}, {"id": "bad", "value": "x"}],
           "components": [{"name": "Studs", "source": "length", "formula": "ceil(LF * 12 / spacing_in) + N", "waste_pct": 10, "pack": 1,
                           "unit": "ea", "unit_cost_cents": 389, "labor_hours": 0.05, "labor_rate": "carp"},
                          {"name": "Plates", "source": "length", "factor": 3, "waste_pct": 5, "unit": "lf", "unit_cost_cents": 52,
                           "labor_hours": 0.01, "labor_rate": "none"},
                          {"name": "Bad", "source": "length", "formula": "LF / zz", "unit": "ea"}]}
    case("assembly_env", asm, tq)
    rates = [{"id": "carp", "name": "Carpenter", "cents_per_hour": 6850}, {"id": "x", "cents_per_hour": True}]
    for c in asm["components"]:
        case("component_quantity", c, tq, assembly.assembly_env(asm, tq), rates)
    case("component_quantity", {"source": "area", "formula": "SF / 32", "pack": 1, "unit_cost_cents": 1450}, tq)
    case("component_quantity", {"source": "area", "labor_hours": -1}, tq)
    good = dict(asm, components=asm["components"][:2])
    res = [measure.measure(m, Q) for m in [{"type": "length", "points": [[0, 0], [720, 0]], "height": 108},
                                            {"type": "polylength", "points": [[0, 0], [360, 0], [360, 180]], "height": 108}]]
    res = json.loads(json.dumps(res))
    case("apply_assembly", good, res, rates)
    case("apply_assembly", asm, res, rates)
    case("estimate", [good], {"studs": res}, 12, 8.25, 10, rates)
    case("estimate", [good], {"studs": res}, 0, 0, 1001, rates)
    for _ in range(25):
        f = rng.choice(["LF * a + b", "ceil(SF / a) * b", "max(EA, a) + N * b", "WSF / a + CF * b", "sqrt(SF) * a - b", "round(CY * a) + b"])
        e = {"LF": rng.uniform(0, 500), "SF": rng.uniform(0, 5000), "EA": rng.randint(0, 40), "N": rng.randint(0, 9),
             "WSF": rng.uniform(0, 9000), "CF": rng.uniform(0, 900), "CY": rng.uniform(0, 30), "a": rng.uniform(0.1, 30), "b": rng.uniform(-5, 5)}
        case("formula_eval", f, e)
    # session fields, viewports, imported quantities, rates and tombstones in a document
    d2 = json.loads(json.dumps(doc))
    d2["settings"]["overhead_pct"] = 7.5
    d2["rates"] = [{"id": "carp", "name": "Carpenter", "cents_per_hour": 6850}, {"id": "carp"}, {"id": "lab", "cents_per_hour": -1},
                   {"id": "bad id", "cents_per_hour": 1}, {"id": "lab2", "cents_per_hour": 4200}]
    d2["pages"]["0"]["viewports"] = [
        {"id": "detail", "name": "Detail 3", "rect": [900, 100, 600, 400], "scale": {"in_per_pt": 1 / 6, "label": '1 1/2" = 1\'-0"', "source": "standard"}},
        {"id": "detail", "rect": [0, 0, 1, 1], "scale": {"in_per_pt": 1}}, {"id": "flat", "rect": [0, 0, 0, 5], "scale": {"in_per_pt": 1}},
        {"id": "noscale", "rect": [0, 0, 5, 5]}, {"id": "nan", "rect": [0, 0, "x", 5], "scale": {"in_per_pt": 1}}, "x"]
    d2["assemblies"][0]["params"] = [{"id": "spacing_in", "name": "Stud spacing", "value": 16, "unit": "in"}, {"id": "SF", "value": 1},
                                     {"id": "9bad", "value": 1}, {"id": "spacing_in", "value": 24}]
    d2["assemblies"][0].update({"division": "09", "code": "09 21 16", "group": "Drywall", "why": "Two layers on studs.", "tool": "polylength"})
    d2["assemblies"][0]["components"] = d2["assemblies"][0]["components"] + [
        {"name": "Screws", "source": "wall_area", "formula": "ceil(WSF * 2 / spacing_in)", "code": " SCR-1 ", "labor_hours": 0.02,
         "labor_rate": "carp", "unit": "box", "pack": 0},
        {"name": "Typo", "source": "each", "formula": 7}]
    d2["markups"] += [
        {"id": "s1", "type": "length", "page": 0, "points": [[700, 200], [880, 200]], "viewport": "detail", "rev": 3.0, "vers": ["v1", "v2", "v3", "v2", "bad id"],
         "modified_by": "Ana", "assignee": "Ben", "resolved": True, "status": "Accepted",
         "status_log": [{"status": "Open", "by": "Ana", "at": "2026-10-01T10:00:00Z"}, {"status": "Accepted", "by": "Ben", "at": "2026-10-02T11:00:00Z"}, "x", {}],
         "comments": [{"id": "c1", "author": "Ana", "at": "2026-10-01T10:00:00Z", "text": "Check @Ben"},
                      {"id": "c2", "author": "Ben", "at": "2026-10-01T11:00:00Z", "text": "Done", "reply_to": "c1", "resolved": True},
                      {"id": "c3", "author": "Ana", "text": "", "deleted": True}, {"id": "c1", "text": "dup"}, {"id": "c4", "text": ""},
                      {"id": "c5", "text": "self", "reply_to": "c5"}, {"text": "no id"}]},
        {"id": "s2", "type": "length", "page": 0, "points": [[0, 0], [180, 0]], "viewport": "missing", "rev": -1, "vers": "v1", "resolved": "yes"},
        {"id": "q1", "type": "quantity", "page": 1, "points": [[10, 10]], "qty": {"kind": "area", "value": 14400}, "subject": "Carpet", "assembly": "a1"},
        {"id": "q2", "type": "quantity", "page": 1, "points": [[10, 10]], "qty": {"kind": "count", "value": 12}},
        {"id": "q3", "type": "quantity", "page": 1, "points": [[10, 10]], "qty": {"kind": "angle", "value": 1}},
        {"id": "q4", "type": "quantity", "page": 1, "points": [[10, 10]]},
        {"id": "q5", "type": "quantity", "page": 1, "points": [[10, 10]], "qty": {"kind": "length", "value": -1}},
    ]
    d2["tombstones"] = [{"id": "gone", "at": "2026-10-03T00:00:00Z", "by": "Ana", "vers": ["v9"]}, {"id": "m1", "vers": []},
                        {"id": "gone"}, {"id": "bad id"}, "x"]
    case("clean_document", d2)
    case("rows_of", d2)
    case("estimate_of", d2)
    case("estimate_csv", estimate_of(d2))
    cd2, _ = markups.clean_document(d2)
    for m in cd2["markups"][:3] + cd2["markups"][-4:]:
        case("markup_scale", cd2, m)
    for pt in ([700, 200], [100, 100], [900, 400]):
        case("viewport_at", cd2, 0, pt)
    case("measure", {"type": "quantity", "points": [[0, 0]], "qty": {"kind": "volume", "value": 46656}}, None)
    case("measure", {"type": "quantity", "points": [[0, 0]], "qty": {"kind": "length", "value": "x"}}, Q)
    case("measure", {"type": "quantity", "points": [[0, 0]]}, Q)
    # merging
    def mk(i, pts, vers, **kw):
        return dict({"id": i, "type": "count", "page": 0, "points": pts, "vers": vers}, **kw)
    base = mk("a", [[1, 1]], ["v1"])
    cases_m = [
        ([mk("a", [[2, 2]], ["v1", "v2"])], [base], [], []),
        ([base], [mk("a", [[2, 2]], ["v1", "v2"])], [], []),
        ([mk("a", [[2, 2]], ["v1", "v2"])], [mk("a", [[3, 3]], ["v1", "v3"])], [], []),
        ([mk("a", [[2, 2]], ["v1", "v2"], comments=[{"id": "c1", "author": "A", "at": "1", "text": "x"}])],
         [mk("a", [[2, 2]], ["v1", "v9"], comments=[{"id": "c2", "author": "B", "at": "2", "text": "y"}, {"id": "c1", "author": "A", "at": "1", "text": "", "deleted": True}],
             status_log=[{"status": "Review", "by": "B", "at": "2026"}])], [], []),
        ([], [mk("a", [[2, 2]], ["v1", "v2"])], [{"id": "a", "at": "", "by": "", "vers": ["v1"]}], []),
        ([], [base], [{"id": "a", "at": "", "by": "", "vers": ["v1"]}], []),
        ([mk("a", [[2, 2]], ["v1", "v2"])], [], [], [{"id": "a", "at": "", "by": "", "vers": ["v1"]}]),
        ([base], [], [], [{"id": "a", "at": "", "by": "", "vers": ["v1"]}]),
        ([base, mk("b", [[5, 5]], [])], [mk("c", [[6, 6]], ["w1"]), mk("b", [[5, 5]], [])], [], [{"id": "z", "at": "", "by": "", "vers": []}]),
        ([mk("b", [[5, 5]], [])], [mk("b", [[6, 6]], [])], [], []),
    ]
    for mine, theirs, mt, tt in cases_m:
        case("merge_markups", mine, theirs, mt, tt)
        r = merge.merge_markups(mine, theirs, mt, tt)
        for ch in ("mine", "theirs", "both"):
            case("merge_markups", mine, theirs, mt, tt, {c["id"]: ch for c in r["conflicts"]})
    case("merge_comments", [{"id": "c1", "text": "a"}], [{"id": "c1", "text": "a", "resolved": True}, {"id": "c2", "text": "b"}])
    case("merge_status_log", [{"status": "Open", "by": "A", "at": "2"}], [{"status": "Open", "by": "A", "at": "2"}, {"status": "Done", "by": "B", "at": "1"}])
    mine_doc, _ = markups.clean_document(d2)
    theirs_doc = json.loads(json.dumps(mine_doc))
    theirs_doc["markups"][0]["points"] = [[0, 0], [10, 0], [10, 10], [0, 10]]
    theirs_doc["markups"][0]["vers"] = ["t1"]
    theirs_doc["markups"] = theirs_doc["markups"][:5]
    theirs_doc["layers"].append({"id": "theirs", "name": "Theirs", "visible": True, "locked": False})
    theirs_doc["pages"]["5"] = {"label": "A-501"}
    theirs_doc["pages"]["0"]["viewports"] = [{"id": "v2", "name": "", "rect": [0, 0, 10, 10], "scale": {"in_per_pt": 1.0, "label": "", "source": "calibrated"}}]
    theirs_doc["tombstones"] = [{"id": "m2", "at": "", "by": "", "vers": []}]
    case("merge_documents", mine_doc, theirs_doc)
    case("merge_documents", mine_doc, theirs_doc, {"m1": "theirs", "m2": "theirs"})
    # PDF annotation mapping
    for c in [[1, 0, 0], [0.5], [0, 1, 1, 0], [2, -1, 0.5], "x", [1, 2]]:
        case("rgb_to_hex", c)
    for h in ["#3253c6", "#000000", "#ffffff"]:
        case("hex_to_rgb", h)
    for dts in ["D:20210420201946-06'00'", "D:20210420201946Z", "D:2021", "D:20211301", "D:19991231235959+14'00'", "x", None, "D:20240229120000-00'30"]:
        case("pdf_date_to_iso", dts)
    for iso in ["2026-10-22T15:04:05Z", "2026-10-22", ""]:
        case("iso_to_pdf_date", iso)
    for lu in ("ftin", "ft", "m", "mm"):
        case("measure_dict", Q, '1/4" = 1\'-0"', dict(markups.DEFAULT_SETTINGS, length_unit=lu))
    for meas in [{"x": [{"u": "'", "c": 0.05555556}]}, {"x": [{"u": "m", "c": 0.0254}]}, {"x": [{"u": "parsec", "c": 1}]},
                 {"x": [{"u": "ft", "c": -1}]}, {"x": []}, {"x": [{"u": "in", "c": True}]}, None, {"x": [{"u": " FT ", "c": 2}]}]:
        case("scale_from_measure", meas)
    S = dict(markups.DEFAULT_SETTINGS)
    rot = [0, -1, -1, 0, 1296, 1728]  # a 90 degree /Rotate on a 1728 x 1296 page
    for tr, ipp in (([1, 0, 0, -1, 0, 792], Q), (rot, 1 / 3), ([1, 0, 0, -1, -36, 828], None)):
        ctx = {"transform": tr, "in_per_pt": ipp, "scale_label": "q", "settings": S}
        ms = [{"id": "m1", "type": "length", "page": 0, "points": [[100, 100], [280, 100]], "author": "Ana", "created": "2026-10-01T10:00:00Z"},
              {"id": "m2", "type": "area", "page": 0, "points": big, "holes": [hole], "subject": "Floor", "fill": "#006f4f", "opacity": 0.3},
              {"id": "m3", "type": "count", "page": 0, "points": [[5, 5], [50, 50], [90, 90]], "subject": "Door", "color": "#b66e00"},
              {"id": "m4", "type": "callout", "page": 0, "points": [[10, 10], [60, 40]], "text": "RFI 12\nsee detail"},
              {"id": "m5", "type": "radius", "page": 0, "points": [[100, 100], [136, 100]]},
              {"id": "m5b", "type": "radius", "page": 0, "points": [[136, 100], [100, 136], [64, 100]]},
              {"id": "m6", "type": "diameter", "page": 0, "points": [[100, 100], [172, 100]]},
              {"id": "m7", "type": "perimeter", "page": 0, "points": [[0, 0], [100, 0], [100, 50]]},
              {"id": "m8", "type": "cloud", "page": 0, "points": [[0, 0], [100, 50]]},
              {"id": "m9", "type": "pen", "page": 0, "points": [[0, 0], [10, 5], [20, 0]]},
              {"id": "m10", "type": "highlight", "page": 0, "points": [[0, 0], [100, 10]]},
              {"id": "m11", "type": "volume", "page": 0, "points": [[0, 0], [720, 0], [720, 540], [0, 540]], "depth": 4},
              {"id": "m12", "type": "text", "page": 0, "points": [[300, 300]], "text": "Hello"},
              {"id": "m13", "type": "stamp", "page": 0, "points": [[300, 400]], "text": "APPROVED"},
              {"id": "m14", "type": "arrow", "page": 0, "points": [[0, 0], [50, 50]]},
              {"id": "m15", "type": "angle", "page": 0, "points": [[10, 0], [0, 0], [0, 10]]},
              {"id": "m16", "type": "rect", "page": 0, "points": [[10, 10], [40, 30]], "fill": "#ffd84a"},
              {"id": "m17", "type": "ellipse", "page": 0, "points": [[10, 10], [40, 30]]},
              {"id": "m18", "type": "polyline", "page": 0, "points": [[10, 10], [40, 30], [50, 5]]},
              {"id": "m19", "type": "quantity", "page": 0, "points": [[10, 10]], "qty": {"kind": "area", "value": 1440}}]
        annots = []
        for m in ms:
            case("markup_to_annots", m, ctx)
            annots += annotations.markup_to_annots(m, ctx)
        annots = json.loads(json.dumps(annots))
        case("annots_to_markups", annots, ctx, 0)
        bare = [{k: v for k, v in a.items() if k != "private"} for a in annots]
        case("annots_to_markups", bare, ctx, 2)
    # annotations shaped like another program's measurement markups (keys read from public files)
    bb = {"x": [{"u": "'", "c": 0.05555556}], "d": [{"u": "'", "c": 1}, {"u": '"', "c": 12}], "a": [{"u": "sf", "c": 1}], "r": "0.25 in = 1 ft"}
    ctx = {"transform": [1, 0, 0, -1, 0, 792], "in_per_pt": None, "settings": S}
    foreign = [
        {"subtype": "Line", "it": "LineDimension", "l": [54.39779, 694.4846, 151.9132, 693.8595], "rect": [48.9, 688.4, 157.5, 715.7],
         "measure": bb, "nm": "MDTQWOSJVVVNNQCS", "title": "est", "subject": "Length Measurement", "contents": "5'-5\"",
         "color": [1, 0, 0], "creation": "D:20210420201946-06'00'", "le": ["ClosedArrow", "ClosedArrow"]},
        {"subtype": "Polygon", "it": "PolygonDimension", "vertices": [45.6, 608.2, 104.4, 650.7, 221.9, 588.8, 233.8, 657.6, 287.6, 515.7, 83.2, 548.8],
         "measure": bb, "nm": "PAOKKUUIYRQJZESN", "interior": [1, 0, 0], "rect": [40, 510, 293, 663]},
        {"subtype": "PolyLine", "it": "PolyLineDimension", "vertices": [345.07, 643.85, 368.82, 517.58, 509.47, 511.33, 520.10, 644.48],
         "measure": bb, "nm": "UZLSKFCOKKKGKUUI", "subject": "Perimeter Measurement"},
        {"subtype": "Circle", "it": "CircleDimension", "rect": [49.84745, 379.4477, 145.2117, 473.812], "rd": [5, 4.5, 4.999992, 4.499992], "measure": bb, "nm": "SNUKTXMHVHCBAPTB"},
        {"subtype": "Polygon", "it": "PolygonRadius", "vertices": [288.3559, 409.1057, 230.0505, 443.195, 288.1847, 408.8145], "measure": bb, "nm": "OOCXUKFPNIPBTVKO"},
        {"subtype": "PolyLine", "it": "PolyLineAngle", "vertices": [76.27625, 331.9274, 83.77743, 275.6685, 162.5399, 276.9187], "measure": bb},
        {"subtype": "Polygon", "it": "PolygonVolume", "vertices": [245.678, 301.2976, 245.678, 240.663, 321.3149, 240.663, 321.3149, 301.2976],
         "measure": bb, "contents": "12.75 cu ft", "nm": "DZLFEBKDIRAIDESP"},
        {"subtype": "Polygon", "it": "PolygonCount", "vertices": [439.7, 269.4, 430.7, 278.4, 421.7, 269.4, 430.7, 260.4], "subject": "Count Measurement", "color": [0, 1, 0], "nm": "YMZJOBJUUFRFTFGD"},
        {"subtype": "Polygon", "it": "PolygonCount", "vertices": [339.7, 269.4, 330.7, 278.4, 321.7, 269.4, 330.7, 260.4], "subject": "Count Measurement", "color": [0, 1, 0], "nm": "X2"},
        {"subtype": "FreeText", "it": "FreeTextCallout", "rect": [10, 10, 120, 60], "rd": [30, 2, 2, 20], "cl": [12, 12, 40, 30, 40, 35], "contents": "RFI"},
        {"subtype": "Link", "rect": [0, 0, 1, 1]}, {"subtype": "Square", "rect": [0, 0, "x", 1]}, "garbage",
        {"subtype": "Line", "l": [0, 0]}, {"subtype": "Stamp", "rect": [10, 10, 80, 40], "subject": "Approved", "nm": "__proto__"},
        {"subtype": "Highlight", "quad": [0, 10, 50, 10, 0, 0, 50, 0], "opacity": 0.4},
        {"subtype": "Ink", "ink": [[0, 0, 5, 5, 10, 0], [1, 1, 2, 2]], "width": 2},
        {"subtype": "Polygon", "vertices": [0, 0, 10, 0, 10, 10], "cloudy": True},
        {"subtype": "Polygon", "it": "PolygonDimension", "vertices": [0, 0, 10, 0, 10, 10], "private": "{not json"},
        {"subtype": "Line", "it": "LineDimension", "l": [0, 0, 10, 0], "nm": "p1", "private": {"id": "p1", "type": "length", "page": 9, "points": [[0, 792], [10, 792]], "subject": "Stored", "layer": "walls"}},
        {"subtype": "Line", "it": "LineDimension", "l": [0, 0, 20, 0], "nm": "p2", "private": {"id": "p2", "type": "length", "page": 9, "points": [[0, 792], [10, 792]], "subject": "Moved elsewhere"}},
    ]
    case("annots_to_markups", foreign, ctx, 0)
    for i, a in enumerate(foreign):
        case("annot_to_markup", a, ctx, 1, i)
    case("viewport_from_vp", {"bbox": [0, 0, 612, 792], "measure": bb, "name": "Plan"}, ctx, 0)
    case("viewport_from_vp", {"bbox": [0, 0, 612, 792], "measure": {"x": []}}, ctx, 1)
    case("viewport_from_vp", {"bbox": [5, 5, 5, 9], "measure": bb}, ctx, 2)
    case("viewport_from_vp", {"bbox": [0, 0, 100, 50], "measure": dict(bb, r=7)}, ctx, 3)
    # every library assembly applied to a mix of measurements, with and without wall heights
    lib_res = [measure.measure(m, Q) for m in [
        {"type": "length", "points": [[0, 0], [720, 0]]}, {"type": "polylength", "points": [[0, 0], [360, 0], [360, 180]], "height": 96},
        {"type": "area", "points": big, "holes": [hole], "pitch": 6}, {"type": "volume", "points": big, "depth": 4},
        {"type": "count", "points": [[1, 1], [2, 2], [3, 3]]}, {"type": "perimeter", "points": big}]]
    lib_res = json.loads(json.dumps(lib_res))
    for a in library.library():
        ca = markups.clean_assembly(a)
        case("apply_assembly", ca, lib_res[:3] if rng.random() < 0.5 else lib_res)


if __name__ == "__main__":
    main()
