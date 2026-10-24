"""Headless browser tests for exchange: markups written into a PDF as standard annotations and read
back (by this app, by the Python reader through pikepdf, and by pdf.js), measurement markups from
another program's PDF imported with their scales and viewport, viewports drawn by hand, and the
XLSX workbook and PDF reports."""

import io
import sys
import time
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_browser import App, app, browser, plan_pt, server  # noqa: E402,F401
import pdf_fixtures as fx  # noqa: E402
from test_annotations import read_annot  # noqa: E402

from plantakeoff import annotations as an  # noqa: E402

pikepdf = pytest.importorskip("pikepdf")


def menu(pg, top, item):
    pg.click("#menu-" + top)
    pg.click("#" + item)


def draw(app, key, pts, finish=True):
    app.key(key)
    for p in pts:
        app.click_pt(plan_pt(*p))
    if finish:
        app.key("Enter")


def test_measurement_markups_from_another_program_import_with_scale_and_viewport(app):
    pg = app.page
    app.open_pdf(fx.measured_markups_pdf(), "measured.pdf")
    app.wait_msg("Opened")
    pg.wait_for_selector("#toast-action", timeout=20000)
    assert "markups of its own" in pg.inner_text(".toast")
    pg.click("#toast-action")
    pg.wait_for_selector("#pdfimp-ok")
    why = pg.inner_text(".dialog .why")
    assert "13 annotations" in why and "11 are markups" in why and "2 others" in why
    assert pg.is_checked("#pdfimp-scales") and pg.is_checked("#pdfimp-viewports")
    assert app.markups() == []
    pg.click("#pdfimp-ok")
    app.wait_msg("Imported 9 markups")
    ms = {m["id"]: m for m in app.markups()}
    assert sorted(m["type"] for m in ms.values()) == ["area", "area", "callout", "count", "diameter", "length", "pen", "polylength", "rect"]
    assert pg.evaluate("() => takeoffInspect.scale(0)") == pytest.approx(12 / 18)
    vps = pg.evaluate("() => takeoffInspect.viewports(0)")
    assert len(vps) == 1 and vps[0]["name"] == "DETAIL 1" and vps[0]["scale"]["in_per_pt"] == pytest.approx(1 / 9)
    m = lambda i: pg.evaluate("(id) => takeoffInspect.measured(id)", i)  # noqa: E731
    assert m("bb-1")["text"] == "16'-8\""
    assert m("bb-2")["qty"] == pytest.approx(200)
    assert m("bb-3")["qty"] == pytest.approx(15)
    assert m("bb-4")["qty"] == pytest.approx(4, abs=0.01)
    # the area inside the detail viewport measures at 1 1/2" = 1'-0": 108 pt square is 1 ft x 1 ft
    assert ms["bb-8"]["viewport"] == vps[0]["id"]
    assert m("bb-8")["qty"] == pytest.approx(1)
    count = [x for x in ms.values() if x["type"] == "count"][0]
    assert m(count["id"])["qty"] == 3
    # the PDF's own drawings of them are hidden now; the View menu brings them back
    pg.click("#menu-view")
    assert "Show the PDF's own markups" in pg.inner_text("#menu-pdf-annots")
    pg.click("#menu-pdf-annots")
    app.wait_msg("The PDF's own markups are drawn again")
    # one undo takes the whole import back
    app.key("Control+z")
    pg.wait_for_timeout(200)
    assert app.markups() == [] and pg.evaluate("() => takeoffInspect.scale(0)") is None


def test_viewport_drawn_by_hand_measures_at_its_own_scale(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    app.key("Shift+Alt+W")
    app.drag_pt(plan_pt(-2, -2), plan_pt(20, 12))
    pg.wait_for_selector("#vp-ok")
    pg.select_option("#vp-scale", "1/8\" = 1'-0\"")
    pg.fill("#vp-name", "Enlarged plan")
    pg.click("#vp-ok")
    app.wait_msg("Viewport Enlarged plan")
    pg.click("#sb-snap-content")  # place the points exactly where clicked
    draw(app, "Shift+Alt+L", [(0, 0), (16, 0)], finish=False)
    inside = app.markups()[-1]
    draw(app, "Shift+Alt+L", [(24, 0), (40, 0)], finish=False)
    outside = app.markups()[-1]
    app.key("Escape")
    q = lambda i: pg.evaluate("(id) => takeoffInspect.measured(id)", i)["qty"]  # noqa: E731
    assert inside["viewport"] and "viewport" not in outside
    assert q(inside["id"]) == pytest.approx(32) and q(outside["id"]) == pytest.approx(16)
    pg.click("#sb-scale")
    assert "Enlarged plan" in pg.inner_text("#measure-viewports")


def test_markups_written_as_annotations_read_back_everywhere(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    draw(app, "Shift+Alt+A", [(0, 0), (40, 0), (40, 30), (0, 30)])
    draw(app, "Shift+Alt+L", [(0, 0), (16, 0)], finish=False)
    app.key("Escape")
    draw(app, "Shift+Alt+C", [(3, 3), (5, 5), (7, 7)])
    draw(app, "Shift+Alt+D", [(20, 10), (24, 10)], finish=False)
    app.key("Escape")
    before = app.markups()
    assert len(before) == 4
    menu(pg, "file", "menu-annot-pdf")
    with pg.expect_download() as dl:
        pg.click("#annot-ok")
    data = Path(dl.value.path()).read_bytes()
    assert dl.value.suggested_filename.endswith("-markups.pdf")
    # the Python reader, through pikepdf: the same markups, measurements at the written scale
    pdf = pikepdf.open(io.BytesIO(data))
    page = pdf.pages[1].obj
    assert all("/AP" in d for d in page.Annots)
    mb = [float(x) for x in page.MediaBox]
    r = an.annots_to_markups([read_annot(d) for d in page.Annots], {"transform": [1, 0, 0, -1, -mb[0], mb[3]]}, 1)
    got = {m["id"]: m for m in r["markups"]}
    assert set(got) == {m["id"] for m in before}
    for m in before:
        g = got[m["id"]]
        assert g["type"] == m["type"]
        for p, q in zip(g["points"], m["points"]):
            assert p == pytest.approx(q, abs=0.01)
    assert r["scale"] == pytest.approx(12 / 18)
    # without the stored copy, the standard fields alone still give the measurements
    plain = [dict(read_annot(d), private=None) for d in page.Annots]
    for a in plain:
        a.pop("private")
    r2 = an.annots_to_markups(plain, {"transform": [1, 0, 0, -1, -mb[0], mb[3]]}, 1)
    assert sorted(m["type"] for m in r2["markups"]) == sorted(m["type"] for m in before)
    # pdf.js sees the annotations with their subtypes
    subs = pg.evaluate("""async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const d = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
        const p = await d.getPage(2);
        return (await p.getAnnotations()).map((a) => a.subtype).sort();
    }""", __import__("base64").b64encode(data).decode())
    assert subs == ["Circle", "Line", "Polygon", "Polygon", "Polygon", "Polygon"]
    # and this app reads its own file back: same ids, types and points
    app.open_pdf(data, "round-trip.pdf")
    app.wait_msg("Opened")
    menu(pg, "file", "menu-annot-import")
    pg.wait_for_selector("#pdfimp-ok")
    pg.click("#pdfimp-ok")
    app.wait_msg("Imported 4 markups")
    after = {m["id"]: m for m in app.markups()}
    for m in before:
        a = after[m["id"]]
        assert a["type"] == m["type"] and a.get("subject") == m.get("subject")
        for p, q in zip(a["points"], m["points"]):
            assert p == pytest.approx(q, abs=0.01)
    # writing again replaces this app's annotations instead of adding a second copy
    menu(pg, "file", "menu-annot-pdf")
    with pg.expect_download() as dl2:
        pg.click("#annot-ok")
    again = pikepdf.open(io.BytesIO(Path(dl2.value.path()).read_bytes()))
    assert len(again.pages[1].obj.Annots) == len(page.Annots)


def test_workbook_and_reports(app):
    pg = app.page
    openpyxl = pytest.importorskip("openpyxl")
    pypdf = pytest.importorskip("pypdf")
    app.floor_plan()
    pg.click("#suggest-apply")
    draw(app, "Shift+Alt+A", [(0, 0), (40, 0), (40, 30), (0, 30)])
    with pg.expect_download() as dl:
        menu(pg, "file", "menu-xlsx")
    data = Path(dl.value.path()).read_bytes()
    z = zipfile.ZipFile(io.BytesIO(data))
    assert not any(n.endswith(".bin") or "vba" in n.lower() for n in z.namelist())
    wb = openpyxl.load_workbook(io.BytesIO(data))
    ws = wb["Markups"]
    assert ws["A1"].value == "Page" and ws["K2"].value == pytest.approx(1200)
    with pg.expect_download() as dl2:
        menu(pg, "file", "menu-summary-pdf")
    text = pypdf.PdfReader(io.BytesIO(Path(dl2.value.path()).read_bytes())).pages[0].extract_text()
    assert "Markup summary" in text and "1,200.00 SF" in text
    with pg.expect_download() as dl3:
        menu(pg, "file", "menu-estimate-pdf")
    text = "\n".join(pg_.extract_text() for pg_ in pypdf.PdfReader(io.BytesIO(Path(dl3.value.path()).read_bytes())).pages)
    assert "Estimate" in text and "Total" in text and "Overhead" in text


def _walk(obj, seen, out, depth=0):
    """Every dictionary key and name reachable from obj (pikepdf objects)."""
    if depth > 40:
        return
    if isinstance(obj, pikepdf.Dictionary) or isinstance(obj, pikepdf.Stream):
        og = obj.objgen if obj.is_indirect else None
        if og:
            if og in seen:
                return
            seen.add(og)
        for k in obj.keys():
            out.add(k)
            _walk(obj.get(k), seen, out, depth + 1)
    elif isinstance(obj, pikepdf.Array):
        for x in obj:
            _walk(x, seen, out, depth + 1)
    elif isinstance(obj, pikepdf.Name):
        out.add(str(obj))


def test_annotated_copy_of_a_pdf_with_scripts_carries_no_scripts_or_actions(app, tmp_path):
    pg = app.page
    app.open_pdf(fx.script_pdf(), "scripts.pdf")
    app.wait_msg("Opened")
    app.key("Shift+Alt+C")
    for pt in ([150, 300], [200, 320]):
        x, y = pg.evaluate("([a, b]) => takeoffInspect.pageToClient(a, b)", pt)
        pg.mouse.click(x, y)
        pg.wait_for_timeout(80)
    app.key("Enter")
    assert len(app.markups()) == 1
    menu(pg, "file", "menu-annot-pdf")
    with pg.expect_download() as dl:
        pg.click("#annot-ok")
    out = tmp_path / "out.pdf"
    out.write_bytes(Path(dl.value.path()).read_bytes())
    # a valid PDF by an independent checker
    import subprocess
    chk = subprocess.run(["qpdf", "--check", str(out)], capture_output=True, text=True)
    assert chk.returncode in (0, 3), chk.stdout + chk.stderr  # 3: warnings only
    pdf = pikepdf.open(str(out))
    keys = set()
    _walk(pdf.trailer, set(), keys)
    for bad in ("/JavaScript", "/JS", "/AA", "/OpenAction", "/Launch", "/SubmitForm", "/XFA"):
        assert bad not in keys, bad
    annots = pdf.pages[0].obj.Annots
    subs = sorted(str(a.Subtype) for a in annots)
    assert subs == ["/Link", "/Polygon", "/Polygon", "/Widget"]  # a count writes one annotation per item
    link = [a for a in annots if a.Subtype == "/Link"][0]
    assert "/A" not in link
    assert app.errors == []


def test_annotations_we_write_carry_their_measurements_for_other_readers(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    draw(app, "Shift+Alt+L", [(0, 0), (16, 0)], finish=False)
    app.key("Escape")
    draw(app, "Shift+Alt+A", [(0, 0), (40, 0), (40, 30), (0, 30)])
    menu(pg, "file", "menu-annot-pdf")
    with pg.expect_download() as dl:
        pg.click("#annot-ok")
    data = Path(dl.value.path()).read_bytes()
    # pdf.js: the measurement text is the annotation's contents, the line's ends are where we drew them
    got = pg.evaluate("""async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const d = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
        const p = await d.getPage(2);
        return (await p.getAnnotations()).map((a) => ({ subtype: a.subtype, contents: a.contentsObj && a.contentsObj.str, line: a.lineCoordinates || null }));
    }""", __import__("base64").b64encode(data).decode())
    line = [a for a in got if a["subtype"] == "Line"][0]
    area = [a for a in got if a["subtype"] == "Polygon"][0]
    assert line["contents"] == "16'-0\""
    assert area["contents"].replace(",", "").startswith("1200") and "sf" in area["contents"].lower()
    pdf = pikepdf.open(io.BytesIO(data))
    mb = [float(x) for x in pdf.pages[1].obj.MediaBox]
    sheet = lambda x, y: [x - mb[0], mb[3] - y]  # noqa: E731
    a, b = sheet(*line["line"][:2]), sheet(*line["line"][2:])
    assert a == pytest.approx(plan_pt(0, 0), abs=0.01) and b == pytest.approx(plan_pt(16, 0), abs=0.01)
    # the /Measure dictionary: 1/4" = 1'-0" is 18 points a foot, so one point is 1/18 ft
    ln = [d for d in pdf.pages[1].obj.Annots if d.Subtype == "/Line"][0]
    assert str(ln.Measure.Subtype) == "/RL" and float(ln.Measure.X[0].C) == pytest.approx(1 / 18) and str(ln.Measure.X[0].U) == "ft"


def bomb_pdf(unpacked=80 * 1048576):
    """A one-page PDF that also carries an object stream which unpacks from about 80 KB to 80 MB."""
    import zlib
    z = zlib.compress(b"\0" * unpacked, 9)
    objs = {1: b"<< /Type /Catalog /Pages 2 0 R >>", 2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
            4: f"<< /Type /ObjStm /N 1 /First 4 /Length {len(z)} /Filter /FlateDecode >>\nstream\n".encode() + z + b"\nendstream"}
    return fx.build_pdf(objs)


def test_a_compression_bomb_is_refused_before_the_pdf_library_reads_it(app):
    pg = app.page
    app.open_pdf(bomb_pdf(), "bomb.pdf")
    app.wait_msg("Opened")
    menu(pg, "file", "menu-annot-import")
    t = time.time()
    while time.time() - t < 30 and "compression bomb" not in app.msg():
        pg.wait_for_timeout(200)
    assert "compression bomb" in app.msg() and "not read" in app.msg(), app.msg()
    # the page carries on
    assert app.errors == []
    assert pg.evaluate("() => takeoffInspect.numPages()") == 1
