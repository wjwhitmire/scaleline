"""The full function test's checks that the other browser tests did not already make, on the page as
GitHub Pages serves it (the `server` fixture serves docs/ with the publish links filled, under
/scaleline/).

- Every standard scale preset: a line one inch of paper long measures what the scale's own text says.
- Every measurement type drawn on exact points and checked by hand, and the interior partition
  assembly, overhead, markup and tax worked by hand.
- Regressions: the cutout picks its area (the page's only area at once, otherwise the next area
  clicked), the shortcut sheet lists every key the page answers, a revision is compared as soon as it
  opens, and team features ask for your name where they need it.
"""

import math
import re
import sys
from fractions import Fraction
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_browser import App, app, browser, plan_pt, server  # noqa: E402,F401


def blank_pdf():
    reportlab = pytest.importorskip("reportlab.pdfgen.canvas")
    import io
    buf = io.BytesIO()
    c = reportlab.Canvas(buf, pagesize=(612, 792))
    c.drawString(400, 40, "BLANK TEST SHEET")
    c.showPage()
    c.save()
    return buf.getvalue()


def real_inches_per_paper_inch(label):
    """From the scale's own words: a" = 1'-0" is 12 / a, 1" = N' is 12 N, 1:N is N."""
    m = re.match(r'^(\d+)?\s*(\d+/\d+)?"\s*=\s*1\'-0"', label)
    if m:
        return float(Fraction(12) / (Fraction(int(m.group(1) or 0)) + (Fraction(m.group(2)) if m.group(2) else 0)))
    m = re.match(r"^1\"\s*=\s*(\d+)'$", label)
    if m:
        return 12.0 * int(m.group(1))
    return float(re.match(r"^1:(\d+)$", label).group(1))


def ctrl_click(app, pt):
    """A click with Ctrl held, which places the point exactly where it is (no snapping)."""
    x, y = app.client(pt)
    app.page.keyboard.down("Control")
    app.page.mouse.click(x, y)
    app.page.keyboard.up("Control")
    app.page.wait_for_timeout(60)


def show(app, pts, pad=60):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    app.page.evaluate("([a, b, c, d]) => takeoffInspect.zoomTo(a, b, c, d)", [min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad])


def raw(app, mid):
    return app.page.evaluate("(id) => takeoffInspect.raw(id)", mid)


def test_every_standard_scale_preset(app):
    pg = app.page
    app.open_pdf(blank_pdf(), "blank.pdf")
    pg.wait_for_function("() => document.getElementById('doc-name').textContent.includes('blank')", timeout=30000)
    app.key("Shift+Alt+L")
    ctrl_click(app, [100, 100])
    ctrl_click(app, [172, 100])
    app.key("Escape")
    mid = app.markups()[-1]["id"]
    app.key("Alt+U")
    if pg.get_attribute("#tab-measure", "aria-selected") != "true":
        app.key("Alt+U")
    labels = pg.eval_on_selector_all("#measure-standard option", "o => o.map(x => x.value).filter(Boolean)")
    assert len(labels) == 44
    for label in labels:
        pg.select_option("#measure-standard", label)
        got = raw(app, mid)["length_in"]
        assert got == pytest.approx(real_inches_per_paper_inch(label), rel=1e-12), label


def test_every_measurement_type_by_hand(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")

    def draw(key, pts, finish=True):
        show(app, [plan_pt(*q) for q in pts])
        app.key("Escape")
        app.key(key)
        for q in pts:
            ctrl_click(app, plan_pt(*q))
        if finish:
            app.key("Enter")
        pg.wait_for_timeout(100)
        app.key("Escape")
        return app.markups()[-1]["id"]

    assert raw(app, draw("Shift+Alt+L", [(0, -3), (25, -3)], False))["length_in"] == pytest.approx(300)
    assert raw(app, draw("Shift+Alt+Q", [(0, -6), (10, -6), (10, -16), (16, -8)]))["length_in"] == pytest.approx(360)  # 10 + 10 + 10 (6-8-10)
    area = draw("Shift+Alt+A", [(44, 0), (64, 0), (64, 30), (44, 30)])
    r = raw(app, area)
    assert (r["area_sq_in"] / 144, r["perimeter_in"] / 12) == (pytest.approx(600), pytest.approx(100))
    # the cutout tool picks the selected area: a 5 x 4 ft hole leaves 580 SF
    pg.locator(f"#list-body tr[data-id='{area}']").click()
    show(app, [plan_pt(49, 5), plan_pt(54, 9)])
    app.key("Shift+Alt+X")
    for q in [(49, 5), (54, 5), (54, 9), (49, 9)]:
        ctrl_click(app, plan_pt(*q))
    app.key("Enter")
    pg.wait_for_timeout(100)
    app.key("Escape")
    assert raw(app, area)["area_sq_in"] / 144 == pytest.approx(580)
    assert raw(app, draw("Shift+Alt+P", [(44, 35), (54, 35), (54, 45), (44, 45)]))["perimeter_in"] / 12 == pytest.approx(40)
    vol = draw("Shift+Alt+V", [(56, 35), (66, 35), (66, 45), (56, 45)])
    pg.locator(f"#list-body tr[data-id='{vol}']").click()
    pg.fill("#prop-depth", "6\"")
    pg.press("#prop-depth", "Tab")
    pg.wait_for_timeout(150)
    assert raw(app, vol)["volume_cu_in"] / 1728 == pytest.approx(50)  # 100 SF x 0.5 ft
    assert raw(app, draw("Shift+Alt+C", [(0, 45), (2, 45), (4, 45), (6, 45), (8, 45)]))["count"] == 5
    assert raw(app, draw("Shift+Alt+G", [(20, 48), (12, 48), (12, 53)], False))["angle_deg"] == pytest.approx(90)
    assert raw(app, draw("Shift+Alt+G", [(30, 48), (22, 48), (27, 53)], False))["angle_deg"] == pytest.approx(45)
    assert raw(app, draw("Shift+Alt+U", [(40, 48), (43, 52)], False))["radius_in"] == pytest.approx(60)  # 3-4-5 ft
    assert raw(app, draw("Shift+Alt+D", [(46, 50), (58, 50)], False))["radius_in"] == pytest.approx(72)
    # pitch on the area: 580 SF at 6 in 12 is 580 x sqrt(1.25)
    pg.locator(f"#list-body tr[data-id='{area}']").click()
    pg.fill("#prop-pitch", "6")
    pg.press("#prop-pitch", "Tab")
    pg.wait_for_timeout(150)
    assert raw(app, area)["area_sq_in"] / 144 == pytest.approx(580 * math.sqrt(1.25))


def test_interior_partition_estimate_by_hand(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    pg.click("#tab-chest")
    pg.click("#preset-p-int-wall")
    show(app, [plan_pt(0, -3), plan_pt(20, -3)])
    ctrl_click(app, plan_pt(0, -3))
    ctrl_click(app, plan_pt(20, -3))
    app.key("Enter")
    pg.wait_for_timeout(150)
    app.key("Escape")
    line = [x for x in pg.evaluate("() => takeoffInspect.estimate()")["lines"] if x["id"] == "int-partition"][0]
    # 20 ft x 9 ft = 180 SF of wall. Board: 180 x 2 sides x 1.10 / 32 = 12.375, so 13 sheets at 14.50.
    # Studs: 20 x 0.75 + 1 = 16 x 1.05 = 16.8, so 17 at 5.89. Track: 20 x 2 x 1.05 / 10 = 4.2, so 5 at 7.99.
    # Finishing: 180 x 0.04 = 7.2 h at 65.00. Total 188.50 + 100.13 + 39.95 + 468.00 = 796.58.
    assert [(c["order"], c["cost_cents"]) for c in line["components"]] == [(13, 18850), (17, 10013), (5, 3995), (pytest.approx(7.2), 46800)]
    assert line["cost_cents"] == 79658
    pg.click("#tab-estimate")
    for fid, v in [("est-overhead", "10"), ("est-markup", "15"), ("est-tax", "8.25")]:
        pg.fill("#" + fid, v)
        pg.press("#" + fid, "Tab")
        pg.wait_for_timeout(100)
    est = pg.evaluate("() => takeoffInspect.estimate()")
    # overhead 7965.8 -> 7966; markup (79658 + 7966) x 15% = 13143.6 -> 13144; tax 100768 x 8.25% = 8313.36 -> 8313
    assert (est["overhead_cents"], est["markup_cents"], est["tax_cents"], est["total_cents"]) == (7966, 13144, 8313, 109081)
    assert "1,090.81" in pg.inner_text("#tab-estimate-total")


def test_cutout_picks_its_area(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    show(app, [plan_pt(0, 0), plan_pt(40, 30)])
    app.key("Shift+Alt+A")
    for q in [(0, 0), (40, 0), (40, 30), (0, 30)]:
        ctrl_click(app, plan_pt(*q))
    app.key("Enter")
    app.key("Escape")
    app.key("Escape")  # nothing selected
    app.key("Shift+Alt+X")
    assert pg.evaluate("document.getElementById('viewer').dataset.tool") == "cutout"
    assert "only area on this sheet" in app.msg()
    app.key("Escape")
    app.key("Shift+Alt+A")
    for q in [(44, 0), (54, 0), (54, 10), (44, 10)]:
        ctrl_click(app, plan_pt(*q))
    app.key("Enter")
    app.key("Escape")
    app.key("Escape")
    # two areas now: the next area clicked arms the cutout, and the message says so
    app.key("Shift+Alt+X")
    assert pg.evaluate("document.getElementById('viewer').dataset.tool") == "select"
    assert app.msg().startswith("Click the area or volume to cut into")
    first = app.markups()[0]["id"]
    pg.locator(f"#list-body tr[data-id='{first}']").click()
    assert pg.evaluate("document.getElementById('viewer').dataset.tool") == "cutout"


def test_shortcut_sheet_lists_every_key(app):
    pg = app.page
    pg.click("#menu-help")
    pg.locator(".menu-list button", has_text="Keyboard shortcuts").click()
    sheet = pg.inner_text(".dialog .body")
    for k in ["Shift+Alt+T", "Ctrl+O", "Ctrl+S", "Ctrl+C", "Ctrl+V", "Ctrl+A", "Delete", "Shift+Alt+L", "Shift+Alt+W", "Ctrl+Shift+C", "Alt+L", "Ctrl+9", "F1"]:
        assert k in sheet, k


def test_a_revision_is_compared_as_soon_as_it_opens(app):
    pg = app.page
    app.floor_plan()
    pg.keyboard.press("Control+Shift+C")
    pg.click("#cmp-example")
    pg.wait_for_selector("#cmp-mode", timeout=60000)
    assert "7 changed areas" in pg.inner_text("#cmp-changes").lower()
    assert not pg.evaluate("document.getElementById('compare-canvas').hidden")
    pg.click("#cmp-mode-side")
    pg.wait_for_function("() => !document.getElementById('cmp-side').hidden")


def test_team_features_ask_for_a_name_where_they_need_it(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    show(app, [plan_pt(0, 0), plan_pt(20, 0)])
    app.key("Shift+Alt+L")
    ctrl_click(app, plan_pt(0, -2))
    ctrl_click(app, plan_pt(10, -2))
    app.key("Escape")
    pg.locator("#list-body tr[data-id]").first.click()
    pg.click("#tab-props")
    pg.fill("#comment-author", "Ana")
    pg.fill("#comment-text", "Check this @Ben")
    pg.click("#comment-post")
    pg.wait_for_timeout(150)
    m = app.markups()[-1]
    assert m["comments"][0]["author"] == "Ana" and pg.evaluate("() => takeoffInspect.settings().author") == "Ana"
    assert pg.locator("#comment-author").count() == 0  # asked once


def test_assigned_to_me_asks_for_the_name_once(browser, server):
    a = App(browser, server)
    try:
        pg = a.page
        pg.click("#tab-list")
        pg.check("#list-mine")
        pg.wait_for_selector("#ask-name")
        pg.fill("#ask-name", "Ben")
        pg.click("#ask-name-ok")
        assert pg.evaluate("() => takeoffInspect.settings().author") == "Ben"
        assert a.errors == []
    finally:
        a.close()


def test_starts_when_storage_never_answers(browser, server):
    """Some browsers never answer IndexedDB for a page opened from a file (headless Chromium with
    web/app.html over file:// did this): the app must still start, without storage, and say so."""
    ctx = browser.new_context()
    ctx.add_init_script("IDBFactory.prototype.open = function () { return {}; };")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    try:
        pg.goto(server + "/index.html?example")
        pg.wait_for_selector("body[data-ready='1']", timeout=30000)
        assert pg.evaluate("() => takeoffInspect.numPages()") == 3
        assert errors == []
    finally:
        ctx.close()


def test_works_when_workers_never_run(browser, server):
    """Workers made from blob URLs that never run and never fail (headless Chromium does this for
    web/app.html opened from a file): the PDF engine and image work fall back to the main thread."""
    ctx = browser.new_context(viewport={"width": 1500, "height": 900}, accept_downloads=True)
    ctx.add_init_script("window.Worker = function () { this.postMessage = function () {}; this.terminate = function () {}; this.addEventListener = function () {}; };")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    try:
        pg.goto(server + "/index.html?example")
        pg.wait_for_selector("body[data-ready='1']", timeout=60000)
        assert pg.evaluate("() => takeoffInspect.engine()") == {"pdf": "main thread", "compute": "main thread", "render": "main thread"}
        pg.click("#thumb-1")
        pg.wait_for_selector("#suggest-apply", timeout=30000)
        pg.click("#suggest-apply")
        pg.locator("#viewer").focus()
        pg.keyboard.press("Shift+Alt+F")
        x, y = pg.evaluate("([a, b]) => takeoffInspect.pageToClient(a, b)", plan_pt(34, 7))
        pg.mouse.click(x, y)
        pg.wait_for_function("() => document.getElementById('sb-message').textContent.startsWith('Room traced')", timeout=60000)
        assert errors == []
    finally:
        ctx.close()
