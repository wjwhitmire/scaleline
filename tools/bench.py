"""Time the app on a large plan set in headless Chromium and print honest numbers.

Measured, on a 300-sheet set (36 x 24 in floor plans; --heavy adds about 12,000 hatch segments and an
image underlay per sheet):
  open        from choosing the file to the first sheet drawn in full
  flip        from Enter in the page box to the sheet on screen: the stretched thumbnail when one is
              cached, and the full picture
  pan         frames per second while dragging the sheet for two seconds, zoomed in to tiles
  list        drawing the markups list with 100,000 rows, and frame times while scrolling it
  memory      the page's JavaScript heap and the tile cache after the run
Targets from the plan: first sheet under 2 s, a flip under 300 ms, panning at 60 frames per second.

Headless Chromium has no GPU and draws in software; a desktop browser is usually faster. The machine
running this matters: say which when you quote the numbers.

Run: python web/build_pages.py && python tools/bench.py [--sheets 300] [--heavy] [--json out.json]
"""

import argparse
import json
import platform
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "tools"))
import pdf_fixtures as fx  # noqa: E402
from accuracy import Driver, serve_docs  # noqa: E402

FRAMES_JS = """async (ms) => {
  const t = []; const end = performance.now() + ms;
  await new Promise((done) => { const f = (now) => { t.push(now); if (now < end) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
  const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
  return { frames: d.length, fps: d.length / (ms / 1000), p50: d[Math.floor(d.length / 2)], p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1] };
}"""


def wait_shown(pg, p, which, timeout=60):
    t = time.time()
    while time.time() - t < timeout:
        if pg.evaluate(f"() => takeoffInspect.shown({p}).{which}"):
            return True
        pg.wait_for_timeout(5)
    return False


def bench(sheets=300, heavy=False, log=print, pdf=None):
    from playwright.sync_api import sync_playwright
    data = Path(pdf).read_bytes() if pdf else fx.plan_set_pdf(sheets, heavy=heavy)
    srv, url = serve_docs()
    out = {"sheets": sheets, "heavy": heavy, "pdf_mb": round(len(data) / 1e6, 2), "machine": f"{platform.system()} {platform.machine()}, {platform.python_version()}"}
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        d = Driver(b, url)
        pg = d.page
        try:
            t = time.time()
            pg.set_input_files("#file-pdf", files=[{"name": "set.pdf", "mimeType": "application/pdf", "buffer": data}])
            wait_shown(pg, 0, "full", 120)
            out["open_first_sheet_s"] = round(time.time() - t, 3)
            out["engine"] = pg.evaluate("() => takeoffInspect.engine()")
            sheets = out["sheets"] = pg.evaluate("() => takeoffInspect.numPages()")
            if sheets < 8:  # a single heavy sheet: time the first drawing and panning only
                pages = []
            pg.wait_for_timeout(1500)  # thumbnails near the top draw and are kept
            # flips: to sheets never shown, and back to ones seen (thumbnail or cached picture)
            rnd = random.Random(3)
            flips = []
            pages = [rnd.randrange(1, sheets) for _ in range(12)] + [0, 1, 2, 3] if sheets >= 8 else []
            for p in pages:
                pg.evaluate("() => document.getElementById('nav-page').focus()")
                pg.fill("#nav-page", str(p + 1))
                t = time.time()
                pg.press("#nav-page", "Enter")
                wait_shown(pg, p, "preview")
                first = time.time() - t
                wait_shown(pg, p, "full")
                full = time.time() - t
                flips.append({"page": p, "on_screen_ms": round(first * 1000), "full_ms": round(full * 1000)})
            out["flips"] = flips
            fresh = [f for f in flips[:12]] or [{"on_screen_ms": None, "full_ms": None}]
            if flips:
                out["flip_on_screen_ms_median"] = sorted(f["on_screen_ms"] for f in fresh)[len(fresh) // 2]
                out["flip_full_ms_median"] = sorted(f["full_ms"] for f in fresh)[len(fresh) // 2]
                out["flip_full_ms_max"] = max(f["full_ms"] for f in fresh)
                seen = flips[12:]
                out["flip_back_ms_median"] = sorted(f["full_ms"] for f in seen)[len(seen) // 2]
            # pan, zoomed in: tiles
            pg.evaluate("() => takeoffInspect.zoomTo(300, 300, 800, 600)")
            pg.wait_for_timeout(1500)
            box = pg.locator("#viewer").bounding_box()
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            d.key("Escape")
            pg.keyboard.down("Space")
            pg.mouse.move(cx, cy)
            pg.mouse.down()
            frames = pg.evaluate_handle(FRAMES_JS, 2000)
            for i in range(120):
                pg.mouse.move(cx - i * 4, cy - i * 2)
                pg.wait_for_timeout(16)
            pg.mouse.up()
            pg.keyboard.up("Space")
            out["pan"] = frames.json_value()
            out["tiles"] = pg.evaluate("() => takeoffInspect.perf()")
            # the markups list at 100,000 rows
            doc = {"format": "field-tools-takeoff-markups", "version": 1, "markups": [
                {"id": f"m{i}", "type": "count" if i % 3 == 0 else "length", "page": i % sheets, "subject": f"Item {i % 50}",
                 "points": [[100 + i % 500, 100], [140 + i % 500, 100]] if i % 3 else [[100 + i % 500, 100]]} for i in range(100000)]}
            pg.set_input_files("#file-markups", files=[{"name": "m.json", "mimeType": "application/json", "buffer": json.dumps(doc).encode()}])
            pg.wait_for_selector("#mk-replace", timeout=120000)
            t = time.time()
            pg.click("#mk-replace")
            if pg.get_attribute("#tab-list", "aria-selected") != "true":
                pg.click("#tab-list")
            pg.wait_for_function("() => document.querySelectorAll('#list-body tr[data-id]').length > 0", timeout=120000)
            out["list_100k_s"] = round(time.time() - t, 3)
            out["list_markups"] = pg.evaluate("() => takeoffInspect.markupCount()")
            out["list_rows_in_dom"] = pg.evaluate("() => document.querySelectorAll('#list-body tr[data-id]').length")
            frames = pg.evaluate_handle(FRAMES_JS, 2000)
            for i in range(60):
                pg.mouse.wheel(0, 400) if i % 2 == 0 else None
                pg.evaluate("() => { const w = document.querySelector('#pane-list .tablewrap') || document.querySelector('#list-body').closest('.tablewrap'); if (w) w.scrollTop += 800; }")
                pg.wait_for_timeout(30)
            out["list_scroll"] = frames.json_value()
            out["heap_mb"] = pg.evaluate("() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null")
            out["errors"] = d.errors
        finally:
            d.close()
            b.close()
    srv.shutdown()
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--sheets", type=int, default=300)
    ap.add_argument("--heavy", action="store_true")
    ap.add_argument("--pdf", default=None, help="time this PDF instead of the generated set")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    r = bench(a.sheets, a.heavy, pdf=a.pdf)
    print(json.dumps({k: v for k, v in r.items() if k != "flips"}, indent=1))
    if a.json:
        Path(a.json).write_text(json.dumps(r, indent=1))


if __name__ == "__main__":
    main()
