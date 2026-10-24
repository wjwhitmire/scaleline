"""Headless browser tests of the built app (docs/index.html, served as GitHub Pages serves it: links
filled in, under /scaleline/) in Chromium via Playwright.

They open the example plan set, read the title block scale, calibrate, measure an area and a
length, check the markups list totals, trace a room by clicking inside it, count doors with the
symbol search, compare revisions and carry markups forward, flatten to a new PDF, and feed the
app hostile PDFs. A separate test checks that the page makes no network requests at all.
Skipped when Playwright or its Chromium is not installed.
"""

import functools
import http.server
import io
import json
import math
import re
import runpy
import socketserver
import sys
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pdf_fixtures as fx  # noqa: E402

playwright_api = pytest.importorskip("playwright.sync_api")

# The example floor plan (sheet A-101, page 2) is drawn at 1/4" = 1'-0" (18 pt per foot) with its
# origin 216 pt from the left and 300 pt from the bottom of a 24 x 18 in sheet.
SHEET_H = 18 * 72


def plan_pt(x_ft, y_ft):
    return [216 + x_ft * 18, SHEET_H - (300 + y_ft * 18)]


# The browser tests run on the page as GitHub Pages serves it: docs/ with the publish step's links
# filled in (ship.sh), under the site's subpath, never on the dev build.
PAGES_NAME = "scaleline"
FILL = {"https://wjwhitmire.github.io/scaleline/": f"https://wjwhitmire.github.io/{PAGES_NAME}/", "wjwhitmire": "wjwhitmire",
        "https://github.com/wjwhitmire/scaleline": f"https://github.com/wjwhitmire/{PAGES_NAME}"}


def published_copy(dst):
    """docs/ copied to dst/<name>/ with every publish placeholder filled, as the published site holds it."""
    out = dst / PAGES_NAME
    for f in (ROOT / "docs").rglob("*"):
        if f.is_file():
            data = f.read_bytes()
            for k, v in FILL.items():
                data = data.replace(k.encode(), v.encode())
            target = out / f.relative_to(ROOT / "docs")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    return dst


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    build = runpy.run_path(str(ROOT / "web" / "build_pages.py"))
    build["build_docs"](build["build_app"]())
    root = published_copy(tmp_path_factory.mktemp("pages"))

    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map,
                              **{".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".mjs": "text/javascript"})

        def log_message(self, *a):
            pass

    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(root)))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/{PAGES_NAME}"
    srv.shutdown()


@pytest.fixture(scope="module")
def browser():
    with playwright_api.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # no browser installed
            pytest.skip(f"Chromium is not available: {e}")
        yield b
        b.close()


class App:
    def __init__(self, browser, server, width=1500, height=900):
        self.ctx = browser.new_context(viewport={"width": width, "height": height}, accept_downloads=True)
        self.page = self.ctx.new_page()
        self.errors, self.dialogs, self.requests, self.popups = [], [], [], []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("dialog", lambda d: (self.dialogs.append(d.message), d.dismiss()))
        self.page.on("request", lambda r: self.requests.append(r.url))
        self.page.on("popup", lambda p: self.popups.append(p.url))
        self.server = server
        self.page.goto(server + "/index.html?example")
        self.page.wait_for_selector("body[data-ready='1']", timeout=60000)
        self.page.evaluate("window.__noPicker = true")

    def close(self):
        self.ctx.close()

    def msg(self):
        return self.page.inner_text("#sb-message")

    def wait_msg(self, prefix, timeout=60, not_this=None):
        t = time.time()
        while time.time() - t < timeout:
            m = self.msg()
            if m.startswith(prefix) and m != not_this:
                return m
            self.page.wait_for_timeout(100)
        raise AssertionError(f"status never started with {prefix!r}; last: {self.msg()!r}")

    def client(self, pt):
        return self.page.evaluate("([a, b]) => takeoffInspect.pageToClient(a, b)", pt)

    def click_pt(self, pt):
        x, y = self.client(pt)
        self.page.mouse.click(x, y)
        self.page.wait_for_timeout(80)

    def drag_pt(self, a, b):
        x0, y0 = self.client(a)
        x1, y1 = self.client(b)
        self.page.mouse.move(x0, y0)
        self.page.mouse.down()
        self.page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2)
        self.page.mouse.move(x1, y1)
        self.page.mouse.up()

    def key(self, k):
        self.page.locator("#viewer").focus()
        self.page.keyboard.press(k)

    def open_pdf(self, data, name="test.pdf"):
        self.page.set_input_files("#file-pdf", files=[{"name": name, "mimeType": "application/pdf", "buffer": data}])

    def floor_plan(self):
        self.page.click("#thumb-1")
        self.page.wait_for_function("() => takeoffInspect.page() === 1")
        self.page.wait_for_selector("#suggest-apply", timeout=20000)

    def markups(self):
        return self.page.evaluate("() => takeoffInspect.markups()")


@pytest.fixture()
def app(browser, server):
    a = App(browser, server)
    yield a
    assert a.errors == [], a.errors
    a.close()


def test_example_calibrate_measure_and_list_totals(app):
    pg = app.page
    assert pg.evaluate("() => takeoffInspect.numPages()") == 3
    app.floor_plan()
    assert "1/4\" = 1'-0\"" in pg.inner_text("#sb-suggest")
    pg.click("#suggest-apply")
    assert pg.evaluate("() => takeoffInspect.scale()") == pytest.approx(12 / 18)
    # Calibrate as well, on the 40'-0" building width, and check the scale it computes.
    app.key("Shift+Alt+K")
    app.click_pt(plan_pt(0, 30))
    app.click_pt(plan_pt(40, 30))
    pg.fill("#cal-known", "40'")
    assert "1:48" in pg.inner_text("#cal-result")
    pg.click("#cal-ok")
    assert pg.evaluate("() => takeoffInspect.scale()") == pytest.approx(12 / 18, rel=1e-9)
    # Area: the 40 x 30 ft building outline.
    app.key("Shift+Alt+A")
    for c in [(0, 0), (40, 0), (40, 30), (0, 30)]:
        app.click_pt(plan_pt(*c))
    app.key("Enter")
    assert app.wait_msg("Area").startswith("Area: 1,200.00 SF")
    # Length: the 16'-0" living room dimension.
    app.key("Shift+Alt+L")
    app.click_pt(plan_pt(0, 0))
    app.click_pt(plan_pt(16, 0))
    assert app.wait_msg("Length") == "Length: 16'-0\"."
    app.key("Escape")
    pg.wait_for_timeout(200)
    totals = pg.inner_text("#list-grand-totals")
    assert "16.00 ft" in totals and "1,200.00 SF" in totals
    rows = pg.locator("#list-body tr[data-id]")
    assert rows.count() == 2
    # Undo removes the length; redo brings it back.
    app.key("Control+z")
    pg.wait_for_timeout(200)
    assert "16.00 ft" not in pg.inner_text("#list-grand-totals")
    app.key("Control+y")
    pg.wait_for_timeout(200)
    assert "16.00 ft" in pg.inner_text("#list-grand-totals")
    # CSV export: header, the two measurements, totals by subject.
    with pg.expect_download() as dl:
        pg.click("#list-export")
    text = Path(dl.value.path()).read_text(encoding="utf-8-sig")
    lines = text.split("\r\n")
    assert lines[0].startswith("Page,Sheet,Type,Subject,Label,Layer,Author,Status,Date,Measurement,Quantity,Unit")
    assert any(",1200," in ln and ",SF," in ln for ln in lines)
    assert any(",16,ft," in ln for ln in lines)


def test_typed_length_and_formula_guard_in_csv(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    app.key("Shift+Alt+L")
    app.click_pt(plan_pt(0, -2))
    x, y = app.client(plan_pt(10, -2))
    pg.mouse.move(x, y)
    pg.keyboard.type("12'6")
    pg.keyboard.press("Enter")
    assert app.wait_msg("Length") == "Length: 12'-6\"."
    app.key("Escape")
    ms = app.markups()
    assert len(ms) == 1
    # Put a formula-looking subject on it and export.
    pg.locator("#list-body tr[data-id]").first.click()
    pg.fill("#prop-subject", "=HYPERLINK(\"http://x\")")
    pg.press("#prop-subject", "Tab")
    pg.wait_for_timeout(200)
    with pg.expect_download() as dl:
        pg.click("#list-export")
    text = Path(dl.value.path()).read_text(encoding="utf-8-sig")
    assert "\"'=HYPERLINK(\"\"http://x\"\")\"" in text


def test_room_fill_and_symbol_count(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    # Bedroom 2: 11'-4" x 13'-4" clear between wall faces, less the 3'-0" door swing that closes
    # it off: 151.11 - 7.07 = 144.04 SF.
    app.key("Shift+Alt+F")
    app.click_pt(plan_pt(34, 7))
    m = app.wait_msg("Room traced")
    sf = float(m.split(":")[1].split("SF")[0].replace(",", ""))
    assert sf == pytest.approx(151.11 - math.pi * 9 / 4, rel=0.004)
    # The living room has a column: it comes back as one cutout.
    app.click_pt(plan_pt(4, 4))
    assert "1 cutout" in app.wait_msg("Room traced", not_this=m)
    # Doors: pick one, every door on the sheet is found (seven, in four orientations).
    app.key("Shift+Alt+S")
    app.drag_pt(plan_pt(29.5, 13.9), plan_pt(33.4, 10.6))
    pg.wait_for_selector("#cand-summary", timeout=60000)
    assert pg.inner_text("#cand-summary").startswith("7 of ")
    pg.click("#cand-accept")
    assert "Added 7 counted items" in app.wait_msg("Added")
    counts = [x for x in app.markups() if x["type"] == "count"]
    assert len(counts) == 1 and len(counts[0]["points"]) == 7
    # One undo removes the whole accepted search.
    app.key("Control+z")
    pg.wait_for_timeout(200)
    assert not [x for x in app.markups() if x["type"] == "count"]


def test_sheet_index_from_title_blocks(app):
    pg = app.page
    pg.click("#tab-sheets")
    pg.click("#sheets-read")
    pg.wait_for_selector("#sheets-apply", timeout=30000)
    pg.click("#sheets-apply")
    pg.wait_for_timeout(200)
    labels = pg.inner_text("#sheet-list")
    for s in ("C-101", "A-101", "A-201", "SITE PLAN", "FLOOR PLAN", "ROOF PLAN"):
        assert s in labels
    assert pg.evaluate("() => [0, 1, 2].map((p) => Math.round(takeoffInspect.scale(p) * 72))") == [240, 48, 96]


def test_compare_and_carry_forward(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    app.key("Shift+Alt+A")
    for c in [(28.2, 0.5), (39.5, 0.5), (39.5, 13.8), (28.2, 13.8)]:
        app.click_pt(plan_pt(*c))
    app.key("Enter")
    app.key("Shift+Alt+A")
    for c in [(24.5, 18.5), (39.5, 18.5), (39.5, 29.5), (24.5, 29.5)]:
        app.click_pt(plan_pt(*c))
    app.key("Enter")
    app.key("Control+Shift+C")
    pg.click("#cmp-example")
    pg.wait_for_selector("#cmp-run", timeout=30000)
    pg.click("#cmp-run")
    m = app.wait_msg("Compared")
    assert "same sheet number A-101" in m
    dx, dy = (float(v) for v in re.search(r"sits (-?[\d.]+), (-?[\d.]+) pt", m).groups())
    assert dx == pytest.approx(6, abs=0.6) and dy == pytest.approx(4, abs=0.6)
    # Cloud the changes on the old sheet (one undoable step).
    app.key("Control+Shift+C")
    pg.click("#cmp-cloud")
    assert "Clouded" in app.wait_msg("Clouded")
    clouds = [x for x in app.markups() if x["type"] == "cloud"]
    assert len(clouds) >= 3 and all(c.get("layer") == "revisions" for c in clouds)
    app.key("Control+z")
    pg.wait_for_timeout(200)
    app.key("Control+Shift+C")
    pg.click("#cmp-carry")
    m = app.wait_msg("Opened")
    assert "example-plans-rev2.pdf" in m
    ms = app.markups()
    areas = [x for x in ms if x["type"] == "area"]
    assert len(areas) == 2 and all(x["page"] == 0 for x in areas)
    # The bedroom 3 area sat where the bath wall moved, so it is flagged; bedroom 2 is not.
    flagged = [x for x in areas if x.get("status") == "Review"]
    b2 = [x for x in areas if x.get("status") != "Review"][0]
    assert len(flagged) == 1 and max(q[1] for q in flagged[0]["points"]) < min(q[1] for q in b2["points"])
    # Points moved with the 6 pt right, 4 pt down plot offset.
    assert b2["points"][0][0] == pytest.approx(plan_pt(28.2, 0.5)[0] + 6, abs=1.0)
    assert b2["points"][0][1] == pytest.approx(plan_pt(28.2, 0.5)[1] + 4, abs=1.0)
    assert pg.evaluate("() => takeoffInspect.scale(0)") == pytest.approx(12 / 18)


def test_flatten_and_markup_file_round_trip(app):
    pg = app.page
    pypdf = pytest.importorskip("pypdf")
    app.floor_plan()
    pg.click("#suggest-apply")
    app.key("Shift+Alt+A")
    for c in [(0, 0), (40, 0), (40, 30), (0, 30)]:
        app.click_pt(plan_pt(*c))
    app.key("Enter")
    app.key("C")
    app.drag_pt(plan_pt(2, 2), plan_pt(8, 6))
    pg.wait_for_timeout(200)
    downloads = []
    pg.on("download", lambda d: downloads.append(d))
    pg.click("#tb-flatten")
    pg.click("#flat-ok")
    t = time.time()
    while len(downloads) < 2 and time.time() - t < 30:
        pg.wait_for_timeout(100)
    d1, d2 = sorted(downloads, key=lambda d: d.suggested_filename.endswith(".json"))
    assert d1.suggested_filename.endswith("-flattened.pdf") and d2.suggested_filename.endswith(".markups.json")
    flat = pypdf.PdfReader(io.BytesIO(Path(d1.path()).read_bytes()))
    assert len(flat.pages) == 3
    content = flat.pages[1].get_contents().get_data()
    assert len(content) > len(pypdf.PdfReader(str(ROOT / "examples" / "example-plans.pdf")).pages[1].get_contents().get_data())
    assert "1,200.00 SF" in flat.pages[1].extract_text()
    Path(ROOT / "shots").mkdir(exist_ok=True)
    (ROOT / "shots" / "flattened.pdf").write_bytes(Path(d1.path()).read_bytes())
    sidecar = json.loads(Path(d2.path()).read_text(encoding="utf-8"))
    assert sidecar["format"] == "field-tools-takeoff-markups" and len(sidecar["markups"]) == 2
    # Clear and reload the markup file: same markups come back.
    pg.click("#list-body tr[data-id]")
    app.key("Control+a")
    app.key("Delete")
    pg.wait_for_timeout(200)
    assert app.markups() == []
    pg.set_input_files("#file-markups", files=[{"name": "m.json", "mimeType": "application/json", "buffer": json.dumps(sidecar).encode()}])
    pg.click("#mk-replace")
    pg.wait_for_timeout(300)
    assert sorted(m["id"] for m in app.markups()) == sorted(m["id"] for m in sidecar["markups"])


def test_scripts_inside_pdfs_never_run(app):
    pg = app.page
    title = pg.title()
    app.open_pdf(fx.script_pdf(), "scripts.pdf")
    app.wait_msg("Opened")
    pg.wait_for_timeout(1500)
    assert app.dialogs == [] and app.popups == []
    assert not [u for u in app.requests if "example.invalid" in u]
    assert pg.title() != title and "scripts.pdf" in pg.title()
    # The page itself still renders and its text is searchable.
    pg.click("#tab-search")
    pg.fill("#search-text", "carries scripts")
    pg.click("#search-go")
    pg.wait_for_function("() => document.getElementById('search-status').textContent.includes('match')")
    assert pg.inner_text("#search-status").startswith("1 match")
    # Flattening drops the open action and the document scripts.
    pypdf = pytest.importorskip("pypdf")
    pg.click("#tb-flatten")
    pg.uncheck("#flat-sidecar")
    with pg.expect_download() as dl:
        pg.click("#flat-ok")
    out = pypdf.PdfReader(io.BytesIO(Path(dl.value.path()).read_bytes()))
    root = out.trailer["/Root"]
    assert "/OpenAction" not in root and "/AA" not in root
    names = root.get("/Names")
    assert names is None or "/JavaScript" not in names.get_object()


@pytest.mark.parametrize("name,maker,expect", [
    ("garbage.pdf", fx.garbage_pdf, "This PDF could not be read"),
    ("truncated.pdf", fx.truncated_pdf, None),
    ("not-a-pdf.pdf", lambda: b"PK\x03\x04 this is a zip", "This file is not a PDF"),
    ("too-many-pages.pdf", lambda: fx.page_count_pdf(5001), "This PDF has 5,001 pages"),
    ("lying-count.pdf", fx.lying_count_pdf, None),
    ("giant-page.pdf", fx.giant_page_pdf, None),
    ("nested.pdf", fx.nested_pdf, None),
])
def test_hostile_pdfs_fail_cleanly(app, name, maker, expect):
    pg = app.page
    app.open_pdf(maker(), name)
    t = time.time()
    while time.time() - t < 60:
        m = app.msg()
        if m.startswith("Opened") or "could not" in m or "not a PDF" in m or "pages" in m:
            break
        pg.wait_for_timeout(100)
    m = app.msg()
    if expect:
        assert expect in m, m
        # The previous plan set stays open and usable.
        assert pg.evaluate("() => takeoffInspect.numPages()") == 3
    else:
        assert m.startswith("Opened") or "could not be read" in m, m
    assert app.dialogs == []
    # The app still responds.
    app.key("Shift+Alt+L")
    assert "Length" in app.msg() or pg.locator("#tool-length[aria-pressed='true']").count() == 1


def test_no_network_requests(browser, server):
    a = App(browser, server)
    try:
        pg = a.page
        a.floor_plan()
        pg.click("#suggest-apply")
        a.key("Shift+Alt+F")
        a.click_pt(plan_pt(34, 7))
        a.wait_msg("Room traced")
        pg.wait_for_timeout(500)
        external = [u for u in a.requests if not (u.startswith(server) or u.startswith("blob:") or u.startswith("data:"))]
        assert external == []
        local = sorted({u[len(server):].split("?")[0] for u in a.requests if u.startswith(server)})
        assert set(local) <= {"/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png"} | {
            f"/fonts/{f.name}" for f in (ROOT / "docs" / "fonts").glob("*.woff2")}, local
    finally:
        a.close()


def test_touch_taps_measure(browser, server):
    """On a touch screen a tap places a point, the same as a click."""
    ctx = browser.new_context(viewport={"width": 1024, "height": 768}, has_touch=True, is_mobile=False)
    pg = ctx.new_page()
    try:
        pg.goto(server + "/index.html?example")
        pg.wait_for_selector("body[data-ready='1']", timeout=60000)
        # On a touch screen the pages panel is a drawer behind the left rail.
        pg.tap("#rail-pages")
        pg.tap("#thumb-1")
        pg.wait_for_selector("#suggest-apply", timeout=20000)
        pg.tap("#suggest-apply")
        pg.tap("#tool-length")
        for c in [(0, 0), (40, 0)]:
            x, y = pg.evaluate("([a, b]) => takeoffInspect.pageToClient(a, b)", plan_pt(*c))
            pg.touchscreen.tap(x, y)
            pg.wait_for_timeout(150)
        ms = pg.evaluate("() => takeoffInspect.markups()")
        assert len(ms) == 1 and ms[0]["type"] == "length"
        assert "40'-0\"" in pg.inner_text("#sb-message")
    finally:
        ctx.close()


def test_narrow_screen_has_no_sideways_scroll(browser, server):
    a = App(browser, server, width=400, height=800)
    try:
        assert a.page.evaluate("() => document.documentElement.scrollWidth") <= 400
        assert a.page.evaluate("() => document.body.scrollWidth") <= 400
        assert a.errors == []
    finally:
        a.close()


def test_autosave_survives_reload(browser, server):
    a = App(browser, server)
    try:
        pg = a.page
        a.floor_plan()
        pg.click("#suggest-apply")
        a.key("Shift+Alt+C")
        a.click_pt(plan_pt(5, 5))
        a.click_pt(plan_pt(6, 6))
        pg.wait_for_timeout(1200)
        pg.goto(server + "/index.html")
        pg.wait_for_selector("body[data-ready='1']", timeout=60000)
        ms = a.markups()
        assert len(ms) == 1 and len(ms[0]["points"]) == 2
        assert pg.evaluate("() => takeoffInspect.page()") == 1
    finally:
        a.close()


@pytest.mark.slow
@pytest.mark.parametrize("sheets,heavy", [(300, False), (150, True)])
def test_large_plan_set_stays_responsive(browser, server, tmp_path, sheets, heavy):
    """Open a large set, check first-sheet and page-change times, and read every title block."""
    data = fx.plan_set_pdf(sheets, heavy=heavy)
    a = App(browser, server)
    try:
        pg = a.page
        t = time.time()
        a.open_pdf(data, "large.pdf")
        a.wait_msg("Opened", timeout=120)
        open_s = time.time() - t
        assert pg.evaluate("() => takeoffInspect.numPages()") == sheets
        times = []
        for p in (1, sheets // 2, sheets - 1, 2, sheets * 2 // 3):
            t = time.time()
            pg.fill("#nav-page", str(p + 1))
            pg.press("#nav-page", "Enter")
            try:
                pg.wait_for_function(f"() => takeoffInspect.page() === {p} && takeoffInspect.lastRenderMs() > 0", timeout=30000)
            except Exception:
                raise AssertionError(f"page {p}: at {pg.evaluate('() => takeoffInspect.page()')}, field {pg.input_value('#nav-page')}, status {a.msg()!r}, errors {a.errors}")
            pg.wait_for_function("() => document.getElementById('busy').hidden")
            times.append(time.time() - t)
        # Input stays live while thumbnails draw: a tool change answers at once.
        t = time.time()
        a.key("Shift+Alt+A")
        assert pg.locator("#tool-area[aria-pressed='true']").count() == 1
        key_s = time.time() - t
        pg.click("#tab-sheets")
        t = time.time()
        pg.click("#sheets-read")
        pg.wait_for_selector("#sheets-apply", timeout=180000)
        read_s = time.time() - t
        report = {"sheets": sheets, "heavy": heavy, "open_s": round(open_s, 2), "page_change_s": [round(x, 2) for x in times], "tool_key_s": round(key_s, 3),
                  "read_all_title_blocks_s": round(read_s, 2), "pdf_mb": round(len(data) / 1e6, 2)}
        (tmp_path / "perf.json").write_text(json.dumps(report))
        print("\nPERF", json.dumps(report))
        assert open_s < 30 and max(times) < 10 and key_s < 1
    finally:
        a.close()


def test_area_by_click_boundary_inside_face_centerline_or_outside_face(app):
    """Bedroom 2 is 11'-4" x 13'-4" between wall faces; its walls are 4 in inside and 6 in outside,
    and the 3'-0" door swing closes it off. The centerline adds half of each wall and the outside
    face all of it; across the doorway (3 ft) the strip inside the wall's thickness stays out."""
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    swing = math.pi * 9 / 4
    want = {"inside": 151.11 - swing, "center": (11 + 1 / 3 + 1 / 6 + 1 / 4) * (13 + 1 / 3 + 1 / 4 + 1 / 6) - swing - 3 / 6,
            "outside": (11 + 1 / 3 + 1 / 3 + 1 / 2) * (13 + 1 / 3 + 1 / 2 + 1 / 3) - swing - 3 / 3}
    app.key("Shift+Alt+F")
    app.click_pt(plan_pt(34, 7))
    app.wait_msg("Room traced")
    pg.wait_for_selector("#room-boundary")
    assert pg.get_attribute("#room-bnd-inside", "aria-pressed") == "true"
    assert "inside face" in pg.inner_text("#room-card")
    got = {}
    for mode in ("inside", "center", "outside"):
        if mode != "inside":
            prev = app.msg()
            pg.click("#room-bnd-" + mode)
            app.wait_msg("Room traced", not_this=prev)
            pg.wait_for_selector(f"#room-bnd-{mode}[aria-pressed='true']")
        got[mode] = pg.evaluate("(id) => takeoffInspect.measured(id)", app.markups()[-1]["id"])["qty"]
        assert len(app.markups()) == 1, "switching the boundary replaces the area"
    for mode, sf in got.items():
        assert sf == pytest.approx(want[mode], rel=0.006), (mode, got, want)
    # the choice is remembered for the next room
    app.click_pt(plan_pt(22, 7))
    app.wait_msg("Room traced")
    assert pg.get_attribute("#room-bnd-outside", "aria-pressed") == "true"


def test_review_aids_room_card_side_by_side_and_labels(app):
    """Area by click explains itself in a card; compare offers side by side; counts read EA; labels declutter."""
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    app.key("Shift+Alt+F")
    app.click_pt(plan_pt(34, 7))
    app.wait_msg("Room traced")
    pg.wait_for_selector("#room-card")
    assert "Area by click" in pg.inner_text("#room-card")
    pg.click("#room-keep")
    assert pg.locator("#room-card").count() == 0
    app.key("Escape")
    # A length whose label lands on the room's label.
    app.key("Shift+Alt+L")
    app.click_pt(plan_pt(30.5, 7.6))
    app.click_pt(plan_pt(38, 7.6))
    app.key("Escape")
    # A count reads EA on screen; the stored file keeps its own unit.
    app.key("Shift+Alt+C")
    app.click_pt(plan_pt(5, 5))
    app.key("Enter")
    pg.wait_for_timeout(200)
    assert "1 EA" in pg.inner_text("#list-body")
    # Overlapping labels: at a low zoom some are hidden, and the View toggle shows them all.
    pg.wait_for_timeout(200)
    count_hidden = "() => document.querySelectorAll('#ov-root .ov-tag[data-placed]').length"
    assert pg.evaluate(count_hidden) >= 1
    pg.click("#menu-view")
    pg.click(".menu-list button:has-text('Show all labels')")
    pg.wait_for_timeout(100)
    assert pg.evaluate(count_hidden) == 0
    app.key("Control+9")
    # Compare: side by side shows the revision in the right half.
    app.key("Control+Shift+C")
    pg.click("#cmp-example")
    pg.wait_for_selector("#cmp-run", timeout=30000)
    pg.click("#cmp-run")
    app.wait_msg("Compared")
    app.key("Control+Shift+C")
    pg.click("#cmp-mode-side")
    pg.wait_for_function("() => !document.getElementById('cmp-side').hidden && document.getElementById('cmp-side-canvas').width > 100", timeout=20000)
    assert pg.locator("#compare-canvas").is_hidden()


# ---------------------------------------------------------------- realistic sheets, hardening, keys

TO_SHEET = """async ([b64, p, pts]) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  window.__testDocs = window.__testDocs || {}; const key = b64.length + ':' + b64.slice(-64);
  const pdf = window.__testDocs[key] || (window.__testDocs[key] = await pdfjsLib.getDocument({ data: u, isEvalSupported: false }).promise);
  const vp = (await pdf.getPage(p + 1)).getViewport({ scale: 1 });
  return pts.map(([x, y]) => vp.convertToViewportPoint(x, y)); }"""

# Bounding box of the colored (non-gray) pixels of a page rendered at 0.5 px per point by pdf.js.
INK_BOX = """async ([b64, p]) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  window.__testDocs = window.__testDocs || {}; const key = b64.length + ':' + b64.slice(-64);
  const pdf = window.__testDocs[key] || (window.__testDocs[key] = await pdfjsLib.getDocument({ data: u, isEvalSupported: false }).promise);
  const pg = await pdf.getPage(p + 1); const vp = pg.getViewport({ scale: 0.5 });
  const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const i = (y * cv.width + x) * 4;
    if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return x1 < 0 ? null : [x0, y0, x1, y1]; }"""


def _b64(data):
    import base64
    return base64.b64encode(data).decode()


def test_rotated_offset_and_cad_pages_measure_and_flatten_in_place(app):
    """Every sheet gets its scale from its title block, the building measures 1,176 SF net with its
    shaft as a cutout, and the flattened PDF draws each area exactly over the drawing: rotations 0,
    90, 180 and 270, mixed sheet sizes, an offset MediaBox with a CropBox, and a CAD page whose
    content leaves a scaled graphics state open."""
    pg = app.page
    data = fx.rotated_set_pdf()
    app.open_pdf(data, "rotated.pdf")
    app.wait_msg("Opened")
    b64 = _b64(data)
    expected = {}
    for p in range(8):
        pg.fill("#nav-page", str(p + 1))
        pg.press("#nav-page", "Enter")
        pg.wait_for_function(f"() => takeoffInspect.page() === {p}")
        pg.wait_for_selector("#suggest-apply", timeout=20000)
        pg.click("#suggest-apply")
        assert pg.evaluate("() => takeoffInspect.scale()") == pytest.approx(12 / 18)
        k = 0.5 if p == 5 else 1.0  # the CAD page shows its drawing at half size
        outline = pg.evaluate(TO_SHEET, [b64, p, [[x * k, y * k] for x, y in fx.BUILDING]])
        shaft = pg.evaluate(TO_SHEET, [b64, p, [[x * k, y * k] for x, y in fx.SHAFT]])
        app.key("Shift+Alt+A")
        for q in outline:
            app.click_pt(q)
        app.key("Enter")
        app.key("Escape")
        area = [m for m in app.markups() if m["page"] == p and m["type"] == "area"][-1]
        pg.locator(f"#list-body tr[data-id='{area['id']}']").click()
        app.key("Shift+Alt+X")
        for q in shaft:
            app.click_pt(q)
        app.key("Enter")
        app.key("Escape")
        pg.wait_for_timeout(150)
        text = pg.inner_text(f"#list-body tr[data-id='{area['id']}']")
        assert ("294.00 SF" if p == 5 else "1,176.00 SF") in text, (p, text)
        xs, ys = [q[0] for q in outline], [q[1] for q in outline]
        expected[p] = [min(xs) / 2, min(ys) / 2, max(xs) / 2, max(ys) / 2]
    downloads = []
    pg.on("download", lambda d: downloads.append(d))
    pg.click("#tb-flatten")
    pg.uncheck("#flat-sidecar")
    pg.click("#flat-ok")
    t = time.time()
    while not downloads and time.time() - t < 60:
        pg.wait_for_timeout(100)
    flat = _b64(Path(downloads[0].path()).read_bytes())
    for p, box in expected.items():
        got = pg.evaluate(INK_BOX, [flat, p])
        assert got is not None and max(abs(a - b) for a, b in zip(got, box)) <= 1.5, (p, got, box)


def test_scanned_sheet_area_by_click_and_symbol_count(app):
    """A raster-only sheet: no title block text, a standard scale picked by hand, the room traced by
    clicking inside it, and the five outlets found from one boxed example."""
    pg = app.page
    app.open_pdf(fx.scanned_sheet_pdf(), "scan.pdf")
    app.wait_msg("Opened")
    pg.wait_for_timeout(800)
    assert pg.locator("#suggest-apply").count() == 0
    pg.click("#sb-scale")
    pg.select_option("#measure-standard", "1/4\" = 1'-0\"")
    H = 18 * 72
    app.key("J")  # the fill-by-click key desktop takeoff users know
    assert pg.locator("#tool-roomfill[aria-pressed='true']").count() == 1
    app.click_pt([250, H - 500])
    m = app.wait_msg("Room traced")
    # Clear interior 711.36 x 531.36 pt (6 px walls at 100 dpi) less the 72 x 108 pt shaft: 1,142.6 SF
    # (outlet islands are small enough to count as room).
    sf = float(m.split(":")[1].split("SF")[0].replace(",", ""))
    assert sf == pytest.approx(1142.6, rel=0.005) and "1 cutout" in m
    app.key("Escape")
    app.key("Shift+Alt+S")
    app.drag_pt([171, H - 149], [189, H - 131])
    pg.wait_for_selector("#cand-summary", timeout=60000)
    assert pg.inner_text("#cand-summary").startswith("5 of 5")


def test_font_matrix_injection_never_runs(app, server):
    """CVE-2024-4367: the fixture really runs script in the vulnerable pdf.js 3.11.174 when eval is
    allowed (loaded from the dev dependency pdfjs-dist-3 on a test page with no policy), never runs in
    the embedded engine even with eval allowed (the upgrade carries the upstream fix), and never runs
    in the app, which also keeps eval off."""
    data = fx.font_matrix_pdf()
    old = ROOT / "node_modules" / "pdfjs-dist-3" / "legacy" / "build"
    if not (old / "pdf.min.js").is_file():
        pytest.skip("npm ci has not installed the pdfjs-dist-3 dev dependency")
    run = """async ([b64, evalOn]) => { window.__fontMatrixRan = 0;
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const pdf = await pdfjsLib.getDocument({ data: u, isEvalSupported: evalOn }).promise; const pg = await pdf.getPage(1);
      const vp = pg.getViewport({ scale: 1 }); const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; return window.__fontMatrixRan; }"""

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT)))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        vuln = app.ctx.new_page()
        vuln.goto(base + "/web/app.html?example")
        vuln.wait_for_selector("body[data-ready='1']", timeout=60000)
        # the embedded engine (the upgrade) with eval allowed: patched upstream, nothing runs
        assert vuln.evaluate(run, [_b64(data), True]) == 0
        vuln.close()
        vuln = app.ctx.new_page()
        rel = "/node_modules/pdfjs-dist-3/legacy/build/"
        vuln.set_content("<p>vulnerable engine</p>")
        vuln.add_script_tag(url=base + rel + "pdf.min.js")
        vuln.evaluate("(u) => { pdfjsLib.GlobalWorkerOptions.workerSrc = u; }", base + rel + "pdf.worker.min.js")
        assert vuln.evaluate(run, [_b64(data), True]) > 0, "the fixture no longer reaches the vulnerable path"
        assert vuln.evaluate(run, [_b64(data), False]) == 0
        vuln.close()
    finally:
        srv.shutdown()
    pg = app.page
    app.open_pdf(data, "font-matrix.pdf")
    app.wait_msg("Opened")
    pg.wait_for_timeout(1000)
    app.key("Control+9")
    pg.wait_for_timeout(500)
    assert pg.evaluate("window.__fontMatrixRan") is None


def test_framed_page_does_not_start(browser, server):
    """Another site framing the page sees only a notice with a link to open the app in its own tab."""
    ctx = browser.new_context(viewport={"width": 900, "height": 700})
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    try:
        pg.set_content(f'<iframe id="f" src="{server}/index.html" width="800" height="600"></iframe>')
        pg.frame_locator("#f").locator("#framed a").wait_for(timeout=30000)
        frame = next(f for f in pg.frames if f.url.startswith(server))
        assert frame.locator("#framed a").get_attribute("target") == "_blank"
        assert frame.locator("#framed a").get_attribute("href") == f"{server}/index.html"
        assert "own tab" in frame.locator("#framed").text_content()
        pg.wait_for_timeout(800)
        assert frame.evaluate("document.body.dataset.ready") is None
        assert not frame.locator("#viewer").is_visible()
        assert frame.evaluate("indexedDB.databases().then((d) => d.map((x) => x.name))") == []
    finally:
        ctx.close()
    assert errors == [], errors


def test_delete_all_removes_everything_including_the_open_set(browser, server):
    """Delete all data right after an edit: the queued autosave never writes the open takeoff back,
    and after the reload only the freshly opened example is stored, with no markups."""
    a = App(browser, server)
    try:
        pg = a.page
        a.open_pdf(fx.rotated_set_pdf(), "mine.pdf")
        a.wait_msg("Opened")
        pg.wait_for_selector("#suggest-apply", timeout=20000)
        pg.click("#suggest-apply")
        a.key("Shift+Alt+C")
        a.click_pt([300, 300])
        pg.wait_for_timeout(1000)
        a.click_pt([340, 300])  # this change is still waiting for autosave when the data is deleted
        pg.click("#menu-file")
        pg.click(".menu-list button:has-text('Settings')")
        pg.click("#set-delete-all")
        with pg.expect_navigation(timeout=30000):
            pg.click("#set-delete-confirm")
        pg.wait_for_selector("body[data-ready='1']", timeout=60000)
        pg.wait_for_timeout(1000)
        stored = pg.evaluate("""() => new Promise((res) => { const r = indexedDB.open('field-tools-takeoff'); r.onsuccess = () => {
            const tx = r.result.transaction(['docs', 'files']); const d = tx.objectStore('docs').getAll(); const f = tx.objectStore('files').getAllKeys();
            tx.oncomplete = () => res({ docs: d.result.map((x) => [x.meta.name, x.state.markups.length]), files: f.result.length }); }; })""")
        # the example opened after the reload may be saved too, but never with markups
        assert all(name == "example-plans.pdf" and n == 0 for name, n in stored["docs"]), stored
        assert stored["files"] <= 1, stored
        assert a.errors == []
    finally:
        a.close()


def test_carry_forward_keeps_work_saved_on_the_revision_and_undoes(app):
    """Work already saved for the new revision stays; the carried markups arrive as one undo step."""
    pg = app.page
    rev2 = (ROOT / "examples" / "example-plans-rev2.pdf").read_bytes()
    app.open_pdf(rev2, "example-plans-rev2.pdf")
    app.wait_msg("Opened")
    app.key("Shift+Alt+C")
    app.click_pt(plan_pt(5, 5))
    app.key("Enter")
    pg.wait_for_timeout(1200)
    kept = [m["id"] for m in app.markups()]
    assert len(kept) == 1
    app.open_pdf((ROOT / "examples" / "example-plans.pdf").read_bytes(), "example-plans.pdf")
    app.wait_msg("Opened")
    app.floor_plan()
    pg.click("#suggest-apply")
    app.key("Shift+Alt+A")
    for c in [(28.2, 0.5), (39.5, 0.5), (39.5, 13.8), (28.2, 13.8)]:
        app.click_pt(plan_pt(*c))
    app.key("Enter")
    app.key("Control+Shift+C")
    pg.click("#cmp-example")
    pg.wait_for_selector("#cmp-run", timeout=30000)
    pg.click("#cmp-run")
    app.wait_msg("Compared")
    app.key("Control+Shift+C")
    pg.click("#cmp-carry")
    app.wait_msg("Opened example-plans-rev2.pdf with")
    assert "Kept the 1 markup already saved" in pg.inner_text(".dialog")
    pg.keyboard.press("Escape")
    ms = app.markups()
    assert kept[0] in [m["id"] for m in ms] and len([m for m in ms if m["type"] == "area"]) == 1
    app.key("Control+z")
    pg.wait_for_timeout(200)
    assert [m["id"] for m in app.markups()] == kept


def test_desktop_takeoff_keys_and_each_units(app):
    """Keys a desktop takeoff user expects, and count units read EA in the list and the estimate."""
    pg = app.page
    app.floor_plan()
    for key, tool in [("Shift+N", "polyline"), ("N", "polyline"), ("J", "roomfill"), ("Shift+P", "polygon"), ("Shift+Alt+Q", "polylength")]:
        app.key("Escape")
        app.key(key)
        assert pg.locator(f"#tool-{tool}[aria-pressed='true']").count() == 1, key
    app.key("Escape")
    z = pg.evaluate("() => takeoffInspect.zoom()")
    app.key("=")
    assert pg.evaluate("() => takeoffInspect.zoom()") > z
    app.key("-")
    app.key("-")
    assert pg.evaluate("() => takeoffInspect.zoom()") < z
    app.key("Shift+F9")
    assert app.msg() == "Snap to grid on."
    app.key("Shift+F9")
    pg.click("#tab-estimate")
    pg.wait_for_timeout(200)
    est = pg.inner_text("#pane-estimate")
    assert re.search(r"(^|\s)ea(\s|$)", est) is None and "EA" in est
    assert re.search(r"(^|[\s\d])ea\b", pg.evaluate("() => document.getElementById('ov-root').textContent")) is None
