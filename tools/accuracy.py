"""Measure the accuracy corpus with the app, the way a person would, and compare with the golden
values in its manifest.

For every sheet: the title block reader's scale is checked against the sheet's real scale (and the
real scale is set where it was not read), viewports are imported from the PDF where the sheet has
them, and each probe is measured with the app's own tools in a headless browser: lengths,
perimeters, areas and angles clicked with snapping on after zooming to them (each click lands
OFFSET_PX screen pixels off the true corner, so snapping has to find it), the column's diameter, the outlets found from one boxed example,
and room B traced by one click. Results are the relative error per probe (degrees for angles, items
for counts), summed up per measurement and per kind of sheet.

Run: python tools/make_corpus.py && python tools/accuracy.py [--corpus corpus] [--json out.json]
Uses the built page in docs/ (python web/build_pages.py) and Playwright's Chromium.
"""

import argparse
import functools
import http.server
import json
import math
import socketserver
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OFFSET_PX = 3  # screen pixels: how far from the true corner each click lands (a steady hand)
TOOL_KEYS = {"length": "Shift+Alt+L", "perimeter": "Shift+Alt+P", "area": "Shift+Alt+A", "angle": "Shift+Alt+G", "diameter": "Shift+Alt+D", "roomfill": "Shift+Alt+F"}
RAW_KEY = {"length": "value", "perimeter": "value", "area": "value", "angle": "value", "diameter": "value", "roomfill": "value"}


def serve_docs():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "docs")))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


class Driver:
    """A page of the app in a browser context, with the few moves the runner needs."""

    def __init__(self, browser, url, width=1500, height=950):
        self.ctx = browser.new_context(viewport={"width": width, "height": height})
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.goto(url + "/index.html")
        self.page.wait_for_selector("body[data-ready='1']", timeout=60000)

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
            self.page.wait_for_timeout(50)
        raise TimeoutError(f"status never started with {prefix!r}; last {self.msg()!r}")

    def key(self, k):
        self.page.locator("#viewer").focus()
        self.page.keyboard.press(k)

    def client(self, pt):
        return self.page.evaluate("([a, b]) => takeoffInspect.pageToClient(a, b)", pt)

    def click(self, pt):
        x, y = self.client(pt)
        self.page.mouse.click(x, y)
        self.page.wait_for_timeout(40)

    def drag(self, a, b):
        x0, y0 = self.client(a)
        x1, y1 = self.client(b)
        self.page.mouse.move(x0, y0)
        self.page.mouse.down()
        self.page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2)
        self.page.mouse.move(x1, y1)
        self.page.mouse.up()

    def open(self, data, name):
        prev = self.msg()
        self.page.set_input_files("#file-pdf", files=[{"name": name, "mimeType": "application/pdf", "buffer": data}])
        self.wait_msg("Opened " + name, timeout=120)
        self.page.wait_for_timeout(300)
        del prev

    def go(self, p):
        self.page.fill("#nav-page", str(p + 1))
        self.page.press("#nav-page", "Enter")
        self.page.wait_for_function(f"() => takeoffInspect.page() === {p}")
        self.page.wait_for_function("() => document.getElementById('busy').hidden")
        self.page.wait_for_timeout(250)

    def markups(self):
        return self.page.evaluate("() => takeoffInspect.markups()")


OCR_URL = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz"
OCR_DATA = ROOT / "node_modules" / "@tesseract.js-data" / "eng" / "4.0.0_best_int" / "eng.traineddata.gz"


def recognize(d):
    """Scanned sheets: turn the OCR switch on and read every sheet, the language data served from the
    installed npm package (the same pinned file; the app checks its fingerprint either way)."""
    pg = d.page
    body = OCR_DATA.read_bytes()
    pg.route(OCR_URL, lambda route: route.fulfill(status=200, body=body, headers={"content-type": "application/gzip", "content-length": str(len(body)), "access-control-allow-origin": "*"}))
    pg.click("#menu-automate")
    pg.click("#menu-ocr")
    pg.click("#ocr-switch-on")
    pg.wait_for_selector("#ocr-download, #ocr-run")
    if pg.locator("#ocr-download").count():
        pg.click("#ocr-download")
    pg.wait_for_selector("#ocr-run", timeout=120000)
    for cb in pg.locator("#ocr-pages input[type=checkbox]").all():
        cb.check()
    pg.click("#ocr-run")
    pg.wait_for_function("() => /Use text/.test(document.querySelector('#ocr-run').textContent)", timeout=600000)
    pg.click("#ocr-run")
    d.wait_msg("Recognized text added")


def offset(pt, i, zoom):
    """A click OFFSET_PX screen pixels away from pt, in a direction that turns with i."""
    a = math.radians(45 + 90 * i)
    r = OFFSET_PX / zoom
    return [pt[0] + r * math.cos(a), pt[1] + r * math.sin(a)]


def set_scale(d, label):
    pg = d.page
    pg.click("#sb-scale")
    pg.wait_for_selector("#measure-standard")
    pg.select_option("#measure-apply-to", "this")
    pg.select_option("#measure-standard", label)
    pg.wait_for_timeout(100)


def zoom_to(d, pts, pad=0.3, least=72):
    """Zoom the way a person does before clicking corners: the probe's points fill the view."""
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    m = max(least, w, h) * pad
    d.page.evaluate("(r) => takeoffInspect.zoomTo(r[0], r[1], r[2], r[3])", [min(xs) - m, min(ys) - m, max(xs) + m, max(ys) + m])
    d.page.wait_for_timeout(60)


def measure_probe(d, pr):
    pg = d.page
    k = pr["kind"]
    pg.evaluate("() => document.querySelectorAll('.toast').forEach((t) => t.remove())")
    before = {m["id"] for m in d.markups()}
    if k == "count":
        b = pr["box"]
        zoom_to(d, [[b[0], b[1]], [b[2], b[3]]], pad=4, least=8)
    elif k != "roomfill":
        zoom_to(d, pr["pts"])
    if k == "count":
        d.key("Escape")
        d.key("Shift+Alt+S")
        b = pr["box"]
        d.drag([b[0], b[1]], [b[2], b[3]])
        pg.wait_for_selector("#cand-summary", timeout=60000)
        n = int(pg.inner_text("#cand-summary").split(" of ")[0])
        pg.click("#dlg-close")
        d.key("Escape")
        pg.evaluate("() => takeoffInspect.fit()")
        return n
    d.key("Escape")
    d.key(TOOL_KEYS[k])
    if k == "roomfill":
        prev = d.msg()
        d.click(pr["pts"][0])
        d.wait_msg("Room traced", not_this=prev)
    else:
        z = pg.evaluate("() => takeoffInspect.zoom()")
        for i, p in enumerate(pr["pts"]):
            d.click(offset(p, i, z))
        if k in ("perimeter", "area"):
            d.key("Enter")
    pg.wait_for_timeout(120)
    d.key("Escape")
    pg.evaluate("() => takeoffInspect.fit()")
    new = [m for m in d.markups() if m["id"] not in before]
    if not new:
        return None
    raw = pg.evaluate("(id) => takeoffInspect.raw(id)", new[-1]["id"])
    if not raw:
        return None
    if k == "angle":
        return raw.get("angle_deg")
    if k == "diameter":
        return 2 * raw["radius_in"] if raw.get("radius_in") is not None else raw.get("value")
    if k == "roomfill":
        return raw.get("area_sq_in")
    return raw.get("value")


def run(corpus_dir, files=None, browser=None, url=None, log=print):
    corpus_dir = Path(corpus_dir)
    manifest = json.loads((corpus_dir / "manifest.json").read_text())
    results = []
    own = None
    if browser is None:
        from playwright.sync_api import sync_playwright
        own = sync_playwright().start()
        browser = own.chromium.launch()
    srv = None
    if url is None:
        srv, url = serve_docs()
    try:
        for f in manifest["files"]:
            if f["kind"] == "set" or f["kind"].startswith("autotakeoff") or (files and f["file"] not in files):
                continue
            d = Driver(browser, url)
            try:
                d.open((corpus_dir / f["file"]).read_bytes(), f["file"])
                pg = d.page
                if f["kind"] == "scan" and OCR_DATA.is_file():
                    recognize(d)
                # title blocks first: the reader's scale against the real one
                pg.click("#tab-sheets")
                pg.click("#sheets-read")
                pg.wait_for_selector("#sheets-apply", timeout=120000)
                pg.click("#sheets-apply")
                pg.wait_for_timeout(200)
                if any(s.get("viewport") for s in f["sheets"]):
                    pg.click("#menu-file")
                    pg.click("#menu-annot-import")
                    pg.wait_for_selector("#pdfimp-ok", timeout=30000)
                    pg.click("#pdfimp-ok")
                    pg.wait_for_timeout(200)
                for sh in f["sheets"]:
                    d.go(sh["page"])
                    read = pg.evaluate(f"() => takeoffInspect.scale({sh['page']})")
                    scale_ok = read is not None and abs(read - sh["in_per_pt"]) < 1e-9
                    results.append({"file": f["file"], "sheet": sh["name"], "category": sh["category"], "kind": "scale from title block",
                                    "golden": sh["in_per_pt"], "measured": read, "error": 0.0 if scale_ok else 1.0, "ok": scale_ok})
                    if not scale_ok:
                        set_scale(d, sh["scale"])
                    for pr in sh["probes"]:
                        try:
                            got = measure_probe(d, pr)
                        except Exception as e:  # a probe that fails is a result, not a crash
                            got = None
                            log(f"  {sh['name']} {pr['kind']}: {e}")
                        g = pr["value"]
                        if got is None:
                            err = None
                        elif pr["kind"] == "angle":
                            err = abs(got - g)
                        elif pr["kind"] == "count":
                            err = abs(got - g)
                        else:
                            err = abs(got - g) / g
                        results.append({"file": f["file"], "sheet": sh["name"], "category": sh["category"], "kind": pr["kind"] + (" (viewport)" if pr.get("viewport") else ""),
                                        "what": pr["what"], "golden": g, "measured": got, "error": err})
                    log(f"{f['file']} {sh['name']}: " + ", ".join(f"{r['kind']} {fmt_err(r)}" for r in results if r["sheet"] == sh["name"] and r["file"] == f["file"]))
                if d.errors:
                    log(f"  page errors: {d.errors}")
            finally:
                d.close()
    finally:
        if srv:
            srv.shutdown()
        if own:
            browser.close()
            own.stop()
    return results


def fmt_err(r):
    if r["error"] is None:
        return "FAILED"
    if r["kind"].startswith("angle"):
        return f"{r['error']:.3f} deg"
    if r["kind"].startswith("count"):
        return f"{r['measured']} of {r['golden']}"
    if r["kind"] == "scale from title block":
        return "read" if r["ok"] else "not read"
    return f"{100 * r['error']:.3f}%"


def summary(results):
    """Rows per measurement kind: probes, failures, worst and mean error, worst sheet."""
    rows = []
    for kind in sorted({r["kind"] for r in results}):
        rs = [r for r in results if r["kind"] == kind]
        errs = [r["error"] for r in rs if r["error"] is not None]
        worst = max(rs, key=lambda r: -1 if r["error"] is None else r["error"])
        rows.append({"kind": kind, "probes": len(rs), "failed": sum(r["error"] is None for r in rs),
                     "max": max(errs) if errs else None, "mean": sum(errs) / len(errs) if errs else None, "worst": worst["sheet"]})
    return rows


def table(rows):
    out = ["| Measurement | Probes | Failed | Worst error | Mean error | Worst sheet |", "|---|---:|---:|---:|---:|---|"]
    for r in rows:
        if r["kind"].startswith("angle"):
            f = lambda v: "-" if v is None else f"{v:.3f} deg"  # noqa: E731
        elif r["kind"].startswith("count") or r["kind"] == "scale from title block":
            f = lambda v: "-" if v is None else f"{v:.2g}" if r["kind"].startswith("count") else ("all read" if v == 0 else f"{v:.0%} missed")  # noqa: E731
        else:
            f = lambda v: "-" if v is None else f"{100 * v:.3f}%"  # noqa: E731
        out.append(f"| {r['kind']} | {r['probes']} | {r['failed']} | {f(r['max'])} | {f(r['mean'])} | {r['worst']} |")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--corpus", default=str(ROOT / "corpus"))
    ap.add_argument("--json", default=None)
    ap.add_argument("--file", action="append", default=None)
    a = ap.parse_args()
    res = run(a.corpus, a.file)
    rows = summary(res)
    print()
    print(table(rows))
    if a.json:
        Path(a.json).write_text(json.dumps({"results": res, "summary": rows}, indent=1))


if __name__ == "__main__":
    sys.exit(main())
