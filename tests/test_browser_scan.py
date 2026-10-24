"""Headless browser tests for scanned drawings: the OCR switch and its one pinned download (served
here from the installed npm package instead of the network), text recognition on a skewed scan feeding
the title block reader and search, and snapping to lines found in the picture."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_browser import ROOT, App, browser, server  # noqa: E402,F401
import pdf_fixtures as fx  # noqa: E402

pytest.importorskip("PIL")
OCR_URL = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz"
DATA = ROOT / "node_modules" / "@tesseract.js-data" / "eng" / "4.0.0_best_int" / "eng.traineddata.gz"


@pytest.fixture()
def scan_app(browser, server):
    a = App(browser, server)
    yield a
    assert a.errors == [], a.errors
    a.close()


def serve_data(a, body=None):
    hits = []

    def handle(route):
        hits.append(route.request.url)
        data = body if body is not None else DATA.read_bytes()
        route.fulfill(status=200, body=data, headers={"content-type": "application/gzip", "content-length": str(len(data)), "access-control-allow-origin": "*"})

    a.page.route(OCR_URL, handle)
    return hits


def test_ocr_reads_a_skewed_scan_into_title_blocks_and_search(scan_app):
    if not DATA.is_file():
        pytest.skip("npm ci has not installed the language data dev dependency")
    a, pg = scan_app, scan_app.page
    hits = serve_data(a)
    a.open_pdf(fx.scanned_text_pdf(), "scan.pdf")
    a.wait_msg("Opened")
    # off by default: the menu explains the switch and nothing is fetched
    pg.click("#menu-automate")
    pg.click("#menu-ocr")
    pg.wait_for_selector("#ocr-switch-on")
    assert hits == []
    pg.click("#ocr-switch-on")
    pg.wait_for_selector("#ocr-download")
    pg.click("#ocr-download")
    pg.wait_for_selector("#ocr-run", timeout=60000)
    assert hits == [OCR_URL]
    assert pg.is_checked("#ocr-p-0")
    pg.click("#ocr-region-sheet")
    pg.click("#ocr-run")
    pg.wait_for_function("() => /Use text/.test(document.querySelector('#ocr-run').textContent)", timeout=180000)
    row = pg.inner_text("#ocr-pages")
    assert "sheet A-101" in row and "straightened" in row, row
    assert a.markups() == []
    pg.click("#ocr-run")
    a.wait_msg("Recognized text added to 1 sheet")
    words = " ".join(pg.evaluate("() => takeoffInspect.text(0)"))
    assert "FLOOR PLAN" in words and "A-101" in words
    # the title block reader now names the sheet and offers its scale
    pg.click("#tab-sheets")
    pg.click("#sheets-read")
    pg.wait_for_selector("#sheets-apply", timeout=30000)
    pg.click("#sheets-apply")
    pg.wait_for_timeout(200)
    assert "A-101" in pg.inner_text("#sheet-list")
    assert round(pg.evaluate("() => takeoffInspect.scale(0)") * 72) == 48
    # a second visit uses the kept data: no new download
    pg.click("#menu-automate")
    pg.click("#menu-ocr")
    pg.wait_for_selector("#ocr-run")
    assert hits == [OCR_URL]
    # the text engine came from this site, once, as its own file (the page itself does not carry it)
    engine = [u for u in a.requests if u.endswith("/tesseract-core-lstm.wasm")]
    assert engine == [a.server + "/tesseract-core-lstm.wasm"], engine
    assert all(u.startswith(a.server) or u.startswith(("blob:", "data:")) or u == OCR_URL for u in a.requests)


def test_ocr_refuses_an_engine_that_does_not_match_its_pin(scan_app):
    if not DATA.is_file():
        pytest.skip("npm ci has not installed the language data dev dependency")
    a, pg = scan_app, scan_app.page
    serve_data(a)
    wasm = (ROOT / "docs" / "tesseract-core-lstm.wasm").read_bytes()
    bad = bytearray(wasm)
    bad[len(bad) // 2] ^= 0xFF
    pg.route("**/tesseract-core-lstm.wasm", lambda r: r.fulfill(status=200, body=bytes(bad), headers={"content-type": "application/wasm", "content-length": str(len(bad))}))
    a.open_pdf(fx.scanned_text_pdf(dpi=72), "scan.pdf")
    a.wait_msg("Opened")
    pg.click("#menu-automate")
    pg.click("#menu-ocr")
    pg.click("#ocr-switch-on")
    pg.click("#ocr-download")
    pg.wait_for_selector("#ocr-run", timeout=60000)
    pg.click("#ocr-run")
    a.wait_msg("Text recognition failed")
    assert "text engine does not match its pinned fingerprint" in a.msg()
    assert pg.evaluate("() => takeoffInspect.text(0)") == []


def test_ocr_refuses_data_that_does_not_match_its_pin(scan_app):
    a, pg = scan_app, scan_app.page
    serve_data(a, body=b"\x1f\x8b" + b"x" * 2952871)
    a.open_pdf(fx.scanned_text_pdf(dpi=72), "scan.pdf")
    a.wait_msg("Opened")
    pg.click("#menu-automate")
    pg.click("#menu-ocr")
    pg.click("#ocr-switch-on")
    pg.click("#ocr-download")
    pg.wait_for_function("() => /fingerprint/.test(document.querySelector('#ocr-dl-msg').textContent)", timeout=30000)
    assert pg.locator("#ocr-run").count() == 0


def test_snapping_to_lines_found_in_a_scan(scan_app):
    a, pg = scan_app, scan_app.page
    a.open_pdf(fx.scanned_text_pdf(skew=0), "scan.pdf")
    a.wait_msg("Opened")
    pg.wait_for_function("() => { const g = takeoffInspect.snapGeometry(); return g && g.raster; }", timeout=60000)
    g = pg.evaluate("() => takeoffInspect.snapGeometry()")
    assert g["segs"] >= 4 and g["crossings"] >= 4, g
    # a length drawn near the wall corners lands on them: (100, 100) to (600, 100) is 500 pt
    pg.click("#sb-scale")
    pg.select_option("#measure-standard", "1/4\" = 1'-0\"")
    a.key("Escape")
    a.key("Shift+Alt+L")
    a.click_pt([103, 104])
    a.click_pt([597, 97])
    a.key("Enter")
    m = a.markups()[-1]
    xs = [p[0] for p in m["points"]]
    assert abs(xs[0] - 100) < 2.5 and abs(xs[1] - 600) < 2.5, m["points"]
