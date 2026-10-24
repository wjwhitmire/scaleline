"""Headless browser checks for very large sets: sheets draw in the render worker, the view uses tiles
when zoomed in, thumbnails and the markups list are virtual (a few dozen elements for hundreds of
sheets and 100,000 rows), page text and thumbnails are kept in the device cache, and flipping
sheets stays quick. tools/bench.py prints the full numbers."""

import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_browser import App, browser, server  # noqa: E402,F401
import pdf_fixtures as fx  # noqa: E402

CACHE_KEYS = """() => new Promise((ok) => { const r = indexedDB.open("field-tools-takeoff"); r.onsuccess = () => {
  const tx = r.result.transaction("cache", "readonly"); const q = tx.objectStore("cache").getAllKeys(); q.onsuccess = () => { ok(q.result); r.result.close(); }; }; })"""


def test_large_set_worker_tiles_virtual_lists_and_cache(browser, server):
    a = App(browser, server)
    try:
        pg = a.page
        a.open_pdf(fx.plan_set_pdf(120), "set-120.pdf")
        a.wait_msg("Opened set-120.pdf", timeout=120)
        pg.wait_for_function("() => takeoffInspect.shown(0).full", timeout=60000)
        assert pg.evaluate("() => takeoffInspect.engine()")["render"] == "worker"
        # thumbnails: a window of slots, not one per sheet
        pg.wait_for_timeout(800)
        perf = pg.evaluate("() => takeoffInspect.perf()")
        assert 0 < perf["thumbsInDom"] < 40
        pg.evaluate("() => { const p = document.getElementById('pane-pages'); p.scrollTop = p.scrollHeight / 2; }")
        pg.wait_for_timeout(400)
        mid = pg.evaluate("() => Array.from(document.querySelectorAll('#thumbs .thumb')).map((b) => Number(b.dataset.page))")
        assert min(mid) > 30 and len(mid) < 40
        # flips
        times = []
        for p in (60, 119, 7):
            pg.fill("#nav-page", str(p + 1))
            t = time.time()
            pg.press("#nav-page", "Enter")
            pg.wait_for_function(f"() => takeoffInspect.shown({p}).full", timeout=30000)
            times.append(time.time() - t)
        assert max(times) < 3, times
        assert pg.evaluate("() => takeoffInspect.page()") == 7
        # zoomed in: tiles draw for what is on screen
        pg.evaluate("() => takeoffInspect.zoomTo(400, 400, 700, 600)")
        pg.wait_for_function("() => takeoffInspect.perf().tilesDrawn > 0", timeout=30000)
        assert pg.evaluate("() => !document.getElementById('tile-layer').hidden")
        # the device cache holds page text and thumbnails for this PDF
        pg.click("#tab-search")
        pg.fill("#search-text", "ROOM 801")
        pg.press("#search-text", "Enter")
        pg.wait_for_function("() => document.querySelectorAll('#search-results li').length > 0", timeout=60000)
        keys = pg.evaluate(CACHE_KEYS)
        assert any(k.startswith("text:") for k in keys) and any(k.startswith("thumb:") for k in keys)
        # 100,000 markups: the list keeps a window of rows
        doc = {"format": "field-tools-takeoff-markups", "version": 1, "markups": [
            {"id": f"m{i}", "type": "length", "page": i % 120, "points": [[100, 100], [100 + i % 300, 140]]} for i in range(100000)]}
        pg.set_input_files("#file-markups", files=[{"name": "m.json", "mimeType": "application/json", "buffer": json.dumps(doc).encode()}])
        pg.click("#mk-replace", timeout=120000)
        if pg.get_attribute("#tab-list", "aria-selected") != "true":
            pg.click("#tab-list")
        pg.wait_for_function("() => document.querySelectorAll('#list-body tr[data-id]').length > 0", timeout=60000)
        assert pg.evaluate("() => takeoffInspect.markupCount()") == 100000
        assert pg.evaluate("() => document.querySelectorAll('#list-body tr[data-id]').length") < 100
        assert a.errors == []
    finally:
        a.close()
