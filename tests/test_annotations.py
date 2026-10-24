"""Markups as standard PDF annotations: the mapping both ways, a round trip through real PDF objects
(pikepdf), annotations shaped like another program's measurement markups (built from the ISO
32000 measurement dictionary), viewports, dates and colors."""

import io
import math

import pytest

from plantakeoff import annotations as an
from plantakeoff import markups as mk
from plantakeoff.measure import measure

pikepdf = pytest.importorskip("pikepdf")
QUARTER = 12 / 18
S = dict(mk.DEFAULT_SETTINGS)
CTX = {"transform": [1, 0, 0, -1, 0, 792], "in_per_pt": QUARTER, "scale_label": '1/4" = 1\'-0"', "settings": S}

MARKUPS = [
    {"id": "m1", "type": "length", "page": 0, "points": [[100, 100], [280, 100]], "author": "Ana", "created": "2026-10-01T10:00:00Z"},
    {"id": "m2", "type": "area", "page": 0, "points": [[0, 0], [720, 0], [720, 540], [0, 540]], "holes": [[[180, 180], [360, 180], [360, 360], [180, 360]]],
     "subject": "Floor", "fill": "#006f4f", "opacity": 0.3, "comments": [{"id": "c1", "author": "Ana", "at": "t", "text": "@Ben check"}]},
    {"id": "m3", "type": "count", "page": 0, "points": [[5, 5], [50, 50], [90, 90]], "subject": "Door", "color": "#b66e00"},
    {"id": "m4", "type": "callout", "page": 0, "points": [[10, 10], [60, 40]], "text": "RFI 12"},
    {"id": "m5", "type": "radius", "page": 0, "points": [[100, 100], [136, 100]]},
    {"id": "m6", "type": "diameter", "page": 0, "points": [[100, 100], [172, 100]]},
    {"id": "m7", "type": "perimeter", "page": 0, "points": [[0, 0], [100, 0], [100, 50]]},
    {"id": "m8", "type": "cloud", "page": 0, "points": [[0, 0], [100, 50]]},
    {"id": "m9", "type": "pen", "page": 0, "points": [[0, 0], [10, 5], [20, 0]]},
    {"id": "m10", "type": "highlight", "page": 0, "points": [[0, 0], [100, 10]]},
    {"id": "m11", "type": "volume", "page": 0, "points": [[0, 0], [72, 0], [72, 36], [0, 36]], "depth": 4},
    {"id": "m12", "type": "text", "page": 0, "points": [[300, 300]], "text": "Hello"},
    {"id": "m13", "type": "stamp", "page": 0, "points": [[300, 400]], "text": "APPROVED"},
    {"id": "m14", "type": "angle", "page": 0, "points": [[10, 0], [0, 0], [0, 10]]},
]


def to_pdf_obj(pdf, v):
    """A plain value as a PDF object, the way the browser writer stores it."""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        return pikepdf.String(v)
    if isinstance(v, list):
        return pikepdf.Array([to_pdf_obj(pdf, x) for x in v])
    raise TypeError(v)


NUMBER_FORMAT = lambda u, c: pikepdf.Dictionary(Type=pikepdf.Name.NumberFormat, U=pikepdf.String(u), C=c)  # noqa: E731


def write_annot(pdf, a):
    d = pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name("/" + a["subtype"]), Rect=to_pdf_obj(pdf, a["rect"]))
    if a.get("it"):
        d.IT = pikepdf.Name("/" + a["it"])
    for key, name in (("l", "L"), ("vertices", "Vertices"), ("quad", "QuadPoints"), ("cl", "CL"), ("rd", "RD"),
                      ("color", "C"), ("interior", "IC")):
        if key in a:
            d[pikepdf.Name("/" + name)] = to_pdf_obj(pdf, a[key])
    if "ink" in a:
        d.InkList = to_pdf_obj(pdf, a["ink"])
    if "le" in a:
        d.LE = pikepdf.Array([pikepdf.Name("/" + x) for x in a["le"]])
    for key, name in (("contents", "Contents"), ("subject", "Subj"), ("title", "T"), ("nm", "NM"), ("m", "M"), ("creation", "CreationDate")):
        if a.get(key):
            d[pikepdf.Name("/" + name)] = pikepdf.String(a[key])
    d.CA = a.get("opacity", 1)
    d.BS = pikepdf.Dictionary(W=a.get("width", 1))
    if a.get("cloudy"):
        d.BE = pikepdf.Dictionary(S=pikepdf.Name.C, I=1)
    if a.get("measure"):
        mm = a["measure"]
        d.Measure = pikepdf.Dictionary(Type=pikepdf.Name.Measure, Subtype=pikepdf.Name.RL, R=pikepdf.String(mm["r"]),
                                       X=pikepdf.Array([NUMBER_FORMAT(x["u"], x["c"]) for x in mm["x"]]),
                                       D=pikepdf.Array([NUMBER_FORMAT(x["u"], x["c"]) for x in mm["d"]]),
                                       A=pikepdf.Array([NUMBER_FORMAT(x["u"], x["c"]) for x in mm["a"]]))
    if a.get("private"):
        import json
        d[pikepdf.Name("/FTMarkup")] = pikepdf.String(json.dumps(a["private"]))
    return pdf.make_indirect(d)


def read_annot(d):
    """A PDF annotation dictionary as the plain description (what the browser reader produces)."""
    def num_list(x):
        return [float(v) for v in x] if x is not None else None
    a = {"subtype": str(d.get("/Subtype", ""))[1:], "rect": num_list(d.get("/Rect"))}
    if "/IT" in d:
        a["it"] = str(d.IT)[1:]
    for key, name in (("l", "/L"), ("vertices", "/Vertices"), ("quad", "/QuadPoints"), ("cl", "/CL"), ("rd", "/RD"),
                      ("color", "/C"), ("interior", "/IC")):
        if name in d:
            a[key] = num_list(d[name])
    if "/InkList" in d:
        a["ink"] = [num_list(s) for s in d.InkList]
    if "/LE" in d:
        a["le"] = [str(x)[1:] for x in d.LE]
    for key, name in (("contents", "/Contents"), ("subject", "/Subj"), ("title", "/T"), ("nm", "/NM"), ("m", "/M"), ("creation", "/CreationDate")):
        if name in d:
            a[key] = str(d[name])
    if "/CA" in d:
        a["opacity"] = float(d.CA)
    if "/BS" in d and "/W" in d.BS:
        a["width"] = float(d.BS.W)
    if "/BE" in d and str(d.BE.get("/S", "")) == "/C":
        a["cloudy"] = True
    if "/Measure" in d:
        mm = d.Measure
        a["measure"] = {"r": str(mm.get("/R", "")), **{k.lower(): [{"u": str(x.get("/U", "")), "c": float(x.get("/C", 0))} for x in mm[k]]
                                                      for k in ("/X", "/D", "/A") if k in mm}}
        a["measure"] = {k.lstrip("/"): v for k, v in a["measure"].items()}
    if "/FTMarkup" in d:
        a["private"] = str(d[pikepdf.Name("/FTMarkup")])
    return a


def round_trip(markups, ctx, keep_private=True):
    pdf = pikepdf.new()
    pdf.add_blank_page(page_size=(612, 792))
    annots = []
    for m in markups:
        for a in an.markup_to_annots(m, ctx):
            if not keep_private:
                a.pop("private", None)
            annots.append(write_annot(pdf, a))
    pdf.pages[0].obj.Annots = pikepdf.Array(annots)
    buf = io.BytesIO()
    pdf.save(buf)
    back = pikepdf.open(io.BytesIO(buf.getvalue()))
    plain = [read_annot(d) for d in back.pages[0].obj.Annots]
    return an.annots_to_markups(plain, ctx, 0)


def test_round_trip_through_a_pdf_keeps_every_markup():
    r = round_trip(MARKUPS, CTX)
    # PDF writers keep about six significant digits in reals, so the scale comes back to 1e-5
    assert r["skipped"] == 0 and r["scale"] == pytest.approx(QUARTER, rel=1e-5)
    by = {m["id"]: m for m in r["markups"]}
    for m in MARKUPS:
        assert by[m["id"]]["type"] == m["type"], m["id"]
        assert by[m["id"]]["points"] == mk.clean_markup(m)["points"], m["id"]
    assert by["m2"]["holes"] and by["m2"]["comments"][0]["text"] == "@Ben check"
    assert by["m11"]["depth"] == 4


def test_round_trip_without_the_stored_copy_keeps_measurements():
    """Another program that drops our private key still leaves standard annotations whose
    geometry and scale give the same quantities (cutouts and depth need the stored copy)."""
    r = round_trip(MARKUPS, CTX, keep_private=False)
    by = {m["id"]: m for m in r["markups"]}
    for mid in ("m1", "m5", "m6", "m14"):
        want = measure(mk.clean_markup(next(m for m in MARKUPS if m["id"] == mid)), QUARTER)["value"]
        assert measure(by[mid], r["scale"])["value"] == pytest.approx(want, rel=1e-4), mid
    assert by["m7"]["type"] == "polylength"  # a perimeter reads back as the closed polyline it is
    assert measure(by["m7"], r["scale"])["value"] == pytest.approx(measure(mk.clean_markup(MARKUPS[6]), QUARTER)["value"], rel=1e-4)
    assert len(by["m3"]["points"]) == 3 and by["m4"]["text"] == "RFI 12"


def test_rotated_page_maps_to_sheet_points():
    # a 90 degree /Rotate on a 1728 x 1296 page: sheet x runs down the user y axis
    ctx = dict(CTX, transform=[0, 1, 1, 0, 0, 0])
    a = an.markup_to_annots(MARKUPS[0], ctx)[0]
    assert a["l"] == [100, 100, 100, 280]
    back = an.annot_to_markup(a, ctx, 0, 0)["markup"]
    assert back["points"] == [[100, 100], [280, 100]]


def test_measure_dictionary_follows_the_standard():
    md = an.measure_dict(QUARTER, "q", S)
    assert md["x"] == [{"u": "ft", "c": pytest.approx(QUARTER / 12)}] and md["d"][1] == {"u": "in", "c": 12}
    assert an.scale_from_measure(md) == pytest.approx(QUARTER)
    metric = an.measure_dict(QUARTER, "q", dict(S, length_unit="m"))
    assert an.scale_from_measure(metric) == pytest.approx(QUARTER)
    assert an.scale_from_measure({"x": [{"u": "'", "c": 0.05555556}]}) == pytest.approx(0.6666667, rel=1e-6)
    for bad in (None, {}, {"x": []}, {"x": [{"u": "furlong", "c": 1}]}, {"x": [{"u": "ft", "c": 0}]}):
        assert an.scale_from_measure(bad) is None


def test_foreign_measurement_shapes():
    """Annotations shaped like another program's measurements (intent names and /Measure as in
    publicly shared files) read as our measurement types with their scale."""
    bb = {"x": [{"u": "'", "c": 1 / 18}], "d": [{"u": "'", "c": 1}, {"u": '"', "c": 12}], "a": [{"u": "sf", "c": 1}]}
    ctx = dict(CTX, in_per_pt=None)
    r = an.annots_to_markups([
        {"subtype": "Line", "it": "LineDimension", "l": [100, 700, 280, 700], "measure": bb, "rect": [0, 0, 1, 1]},
        {"subtype": "Circle", "it": "CircleDimension", "rect": [95, 495, 177, 577], "rd": [5, 5, 5, 5], "measure": bb},
        {"subtype": "Polygon", "it": "PolygonRadius", "vertices": [136, 500, 100, 500, 136, 500], "measure": bb},
        {"subtype": "Polygon", "it": "PolygonVolume", "vertices": [0, 0, 72, 0, 72, 36, 0, 36], "measure": bb, "contents": "2.67 cu ft"},
        {"subtype": "Polygon", "it": "PolygonCount", "vertices": [10, 10, 12, 12, 10, 14, 8, 12], "subject": "Outlet"},
        {"subtype": "Polygon", "it": "PolygonCount", "vertices": [20, 10, 22, 12, 20, 14, 18, 12], "subject": "Outlet"},
        {"subtype": "PolyLine", "it": "PolyLineAngle", "vertices": [10, 0, 0, 0, 0, 10], "measure": bb},
        {"subtype": "Link", "rect": [0, 0, 1, 1]},
    ], ctx, 0)
    t = [m["type"] for m in r["markups"]]
    assert t == ["length", "diameter", "radius", "volume", "count", "angle"] and r["skipped"] == 1
    ms = r["markups"]
    assert measure(ms[0], r["scale"])["value"] == pytest.approx(120, rel=1e-6)  # 10 ft
    assert measure(ms[1], r["scale"])["value"] == pytest.approx(48, rel=1e-6)  # 4 ft across
    assert measure(ms[2], r["scale"])["value"] == pytest.approx(24, rel=1e-6)  # 2 ft radius
    assert ms[3]["depth"] == pytest.approx(4, abs=0.01)  # 2.67 CF over 8 SF
    assert len(ms[4]["points"]) == 2
    assert measure(ms[5], None)["value"] == pytest.approx(90)


def test_viewport_from_page_vp():
    vp = an.viewport_from_vp({"bbox": [0, 0, 612, 396], "measure": {"x": [{"u": "ft", "c": 1 / 18}], "r": '1/4" = 1\'-0"'}}, CTX, 0)
    assert vp["rect"] == [0, 396, 612, 792] and vp["scale"]["in_per_pt"] == pytest.approx(QUARTER) and vp["scale"]["source"] == "imported"
    assert an.viewport_from_vp({"bbox": [0, 0, "x", 1], "measure": {}}, CTX, 0) is None


@pytest.mark.parametrize("pdf_date,iso", [
    ("D:20210420201946-06'00'", "2021-04-21T02:19:46Z"), ("D:20210420201946Z", "2021-04-20T20:19:46Z"), ("D:2021", "2021-01-01T00:00:00Z"),
    ("D:19991231235959+14'00'", "1999-12-31T09:59:59Z"), ("D:20240229120000-00'30", "2024-02-29T12:30:00Z"), ("D:20211301", ""), ("x", ""),
])
def test_pdf_dates(pdf_date, iso):
    assert an.pdf_date_to_iso(pdf_date) == iso


def test_colors():
    assert an.rgb_to_hex([1, 0, 0]) == "#ff0000" and an.rgb_to_hex([0.5]) == "#808080" and an.rgb_to_hex([0, 1, 1, 0]) == "#ff0000"
    assert an.rgb_to_hex("x") is None and an.hex_to_rgb("#3253c6") == [0.196, 0.325, 0.776]
    assert math.isclose(an.mat_apply(an.mat_inv([1, 0, 0, -1, 0, 792]), 10, 20)[1], 772)


def test_reads_measurement_markups_shaped_like_another_programs():
    """The fixture built from the ISO 32000 dictionaries the way a widely used takeoff program writes
    them: types, measurements at the scale in each /Measure, counts joined by subject, a viewport."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import pdf_fixtures as fx

    pdf = pikepdf.open(io.BytesIO(fx.measured_markups_pdf()))
    page = pdf.pages[0].obj
    ctx = {"transform": [1, 0, 0, -1, 0, 1296]}
    r = an.annots_to_markups([read_annot(d) for d in page.Annots], ctx, 0)
    by = {m["id"]: m for m in r["markups"]}
    assert r["skipped"] == 2  # the note and the link
    assert sorted(m["type"] for m in r["markups"]) == ["area", "area", "callout", "count", "diameter", "length", "pen", "polylength", "rect"]
    q = 12 / 18
    assert measure(by["bb-1"], q)["value"] == pytest.approx(200)  # inches
    assert measure(by["bb-2"], q)["value"] == pytest.approx(200 * 144)
    assert measure(by["bb-3"], q)["value"] == pytest.approx(180)
    assert measure(by["bb-4"], q)["value"] == pytest.approx(48, abs=0.01)
    count = [m for m in r["markups"] if m["type"] == "count"][0]
    assert len(count["points"]) == 3 and count["subject"] == "Duplex outlet"
    assert by["bb-5"]["text"] == "Verify slab edge" and by["bb-5"]["author"] == "Ben"
    assert r["scale"] == pytest.approx(q)
    vp = an.viewport_from_vp({"bbox": [1300, 800, 1700, 1100], "name": "DETAIL 1",
                              "measure": read_annot(pikepdf.Dictionary(Subtype=pikepdf.Name.Square, Rect=[0, 0, 1, 1],
                                                                       Measure=page.VP[0].Measure))["measure"]}, ctx, 0)
    assert vp["name"] == "DETAIL 1" and vp["scale"]["in_per_pt"] == pytest.approx(1 / 9)
    assert vp["rect"] == [1300, 196, 1700, 496]
