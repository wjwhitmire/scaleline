"""Headless browser tests for the review leftovers: the diameter tool, Snapshot (G), view rotation
(Ctrl+Shift+Plus and Minus), the larger engineering scales, and angles left out of list totals."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_browser import App, app, browser, plan_pt, server  # noqa: E402,F401


def test_diameter_tool_measures_across_the_circle(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    app.key("Control+Shift+F8")  # snap to content off: the circle is placed freely
    app.key("Shift+Alt+D")
    assert pg.locator("#tool-diameter[aria-pressed='true']").count() == 1
    app.click_pt(plan_pt(2, 2))
    app.click_pt(plan_pt(6, 2))
    ms = app.markups()
    assert ms[-1]["type"] == "diameter"
    assert "4'-0\"" in app.msg()
    pg.click("#tab-list")
    pg.wait_for_timeout(200)
    assert "Diameter" in pg.inner_text("#list-table")


def test_snapshot_copies_the_boxed_area_as_a_picture(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    app.key("Shift+Alt+L")
    app.click_pt(plan_pt(0, 0))
    app.click_pt(plan_pt(10, 0))
    app.key("g")
    assert pg.locator("#tool-snapshot[aria-pressed='true']").count() == 1
    app.drag_pt(plan_pt(-2, 3), plan_pt(12, -3))
    pg.wait_for_selector("#snapshot-img", timeout=20000)
    size = pg.evaluate("() => { const i = document.getElementById('snapshot-img'); return [i.naturalWidth, i.naturalHeight]; }")
    assert size[0] > 100 and size[1] > 40
    # the picture holds the length markup: some pixels carry the cobalt pencil
    blue = pg.evaluate("""() => { const i = document.getElementById('snapshot-img'); const c = document.createElement('canvas');
        c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext('2d'); x.drawImage(i, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0;
        for (let k = 0; k < d.length; k += 4) if (d[k + 2] > 150 && d[k] < 90 && d[k + 1] < 120) n++; return n; }""")
    assert blue > 20
    with pg.expect_download() as dl:
        pg.click("#snapshot-save")
    assert dl.value.suggested_filename.endswith("-snapshot.png")


def test_view_rotation_keeps_measurements_and_maps_clicks(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    before = app.client(plan_pt(0, 0))
    app.key("Control+Shift+Equal")
    assert "turned 90 degrees" in app.msg()
    after = app.client(plan_pt(0, 0))
    assert before != after
    # a length drawn on the turned view still measures in sheet terms
    app.key("Shift+Alt+L")
    app.click_pt(plan_pt(0, 0))
    app.click_pt(plan_pt(0, 20))
    m = app.markups()[-1]
    assert m["type"] == "length"
    assert abs(m["points"][0][0] - plan_pt(0, 0)[0]) < 1.5 and abs(m["points"][1][1] - plan_pt(0, 20)[1]) < 1.5
    assert "20'-0\"" in app.msg()
    # the base image is turned with the view and the tags stay upright
    assert "matrix(" in pg.evaluate("() => document.getElementById('base-canvas').style.transform")
    assert "rotate(-90)" in pg.evaluate("() => document.querySelector('#ov-root .ov-fix').getAttribute('transform')")
    app.key("Control+Shift+Minus")
    assert app.msg().startswith("View back to the sheet")
    assert app.client(plan_pt(0, 0)) == pytest.approx(before, abs=1.5)
    for _ in range(4):
        app.key("Control+Shift+Equal")
    assert app.client(plan_pt(0, 0)) == pytest.approx(before, abs=1.5)


def test_engineering_scales_and_angles_out_of_totals(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    pg.click("#tab-measure")
    pg.wait_for_timeout(200)
    labels = pg.evaluate("() => Array.from(document.querySelectorAll('#pane-measure select option')).map((o) => o.textContent)")
    for n in (300, 400, 600, 1000):
        assert f'Engineering: 1" = {n}\'' in labels
    app.key("Shift+Alt+G")
    for c in [(10, 0), (0, 0), (0, 10)]:
        app.click_pt(plan_pt(*c))
    app.key("Shift+Alt+G")
    for c in [(10, 2), (0, 2), (10, 12)]:
        app.click_pt(plan_pt(*c))
    pg.click("#tab-list")
    pg.wait_for_timeout(300)
    assert "deg" not in pg.inner_text("#list-grand-totals")
    pg.select_option("#list-group", "type")
    pg.wait_for_timeout(200)
    group = pg.locator("#list-body tr.group", has_text="Angle").inner_text()
    assert "deg" not in group and "2" in group
