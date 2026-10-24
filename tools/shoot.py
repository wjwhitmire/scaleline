"""Screenshots of the built app (docs/index.html) for design review.

Every main view (open plan, measuring, markups list, estimate, compare, and the automatic steps:
symbol search, sheet index, scale suggestion, calibrate, area by click with its boundary choice), and the review, exchange,
library, scanned sheet and help screens (comments, merge review, shared folder sync, live session,
text recognition, library, price list, labor rates, assembly editing, viewports, PDF markup import,
annotation export, tool chest and summary imports, snapshot, help, the tour, auto-takeoff,
plan review, the project manual check, plan questions with a mocked provider, model settings) at 400, 1024, 1280 and
1920 px wide, light and dark, into shots/ (ignored by git). It also reports sideways page scroll
and, on the touch layouts (1024 and 400), any visible control under 44 px.

Run: python3 web/build_pages.py && python3 tools/shoot.py [view ...]
"""

import binascii
import functools
import http.server
import json
import re
import socketserver
import sys
import threading
import zlib
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
import pdf_fixtures as fx  # noqa: E402

OUT = ROOT / "shots"
OCR_URL = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz"
OCR_DATA = ROOT / "node_modules" / "@tesseract.js-data" / "eng" / "4.0.0_best_int" / "eng.traineddata.gz"
WIDTHS = (400, 1024, 1280, 1920)
THEMES = ("light", "dark")
SHEET_H = 18 * 72


def plan_pt(x_ft, y_ft):
    return [216 + x_ft * 18, SHEET_H - (300 + y_ft * 18)]


SMALL = """() => [...document.querySelectorAll('#app button, #app input, #app select, #app [role=tab], .dialog button, .dialog input, .dialog select, .menu-list button, .pop button, .pop input')]
  .filter((e) => { const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
    if (getComputedStyle(e).visibility === 'hidden' || e.closest('[hidden]')) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    if (e.type === 'checkbox' || e.type === 'radio' || e.type === 'color') { const l = e.closest('label, li, tr, .pencils'); return !l || l.getBoundingClientRect().height < 43.5; }
    if (e.closest('table.grid') && e.closest('td') && e.closest('td').getBoundingClientRect().height >= 43.5) return false;
    return r.height < 43.5; })
  .slice(0, 12).map((e) => e.tagName + '#' + e.id + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().height) + ' ' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24))"""


class Server:
    def __enter__(self):
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / "docs"))
        handler.log_message = lambda *a: None
        self.srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
        self.srv.daemon_threads = True
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        return f"http://127.0.0.1:{self.srv.server_address[1]}"

    def __exit__(self, *a):
        self.srv.shutdown()


class Shooter:
    def __init__(self, browser, url):
        self.ctx = browser.new_context(viewport={"width": 1500, "height": 950}, accept_downloads=True)
        self.pg = self.ctx.new_page()
        self.errors = []
        self.pg.on("pageerror", lambda e: self.errors.append(str(e)))
        self.pg.goto(url + "/index.html?example")
        self.pg.wait_for_selector("body[data-ready='1']", timeout=60000)
        self.pg.evaluate("window.__noPicker = true")

    def client(self, pt):
        return self.pg.evaluate("([a, b]) => takeoffInspect.pageToClient(a, b)", pt)

    def click_pt(self, pt):
        x, y = self.client(pt)
        self.pg.mouse.click(x, y)
        self.pg.wait_for_timeout(60)

    def key(self, k):
        self.pg.locator("#viewer").focus()
        self.pg.keyboard.press(k)
        self.pg.wait_for_timeout(60)

    def wait_msg(self, prefix, timeout=60000):
        self.pg.wait_for_function("(p) => document.getElementById('sb-message').textContent.startsWith(p)", arg=prefix, timeout=timeout)

    def reset(self):
        pg = self.pg
        for _ in range(3):
            if pg.locator("#dlg-close").count():
                pg.click("#dlg-close")
        pg.evaluate("document.querySelectorAll('.toast, #why-pop').forEach((n) => n.remove())")
        pg.evaluate("() => { const b = document.getElementById('live-leave'); if (b) b.click(); }")
        if pg.viewport_size["width"] > 600 and pg.evaluate("() => !document.getElementById('sb-live').hidden"):
            pg.click("#menu-team")
            pg.click("#menu-live-leave")
        if pg.evaluate("() => !document.getElementById('compare-canvas').hidden"):
            pg.evaluate("() => document.getElementById('menu-view').click()")
            pg.evaluate("() => [...document.querySelectorAll('.menu-list button')].find((b) => b.textContent.includes('Hide compare')).click()")
        pg.evaluate("document.querySelectorAll('.drawer-open, .sheet-open').forEach((n) => n.classList.remove('drawer-open', 'sheet-open'))")
        pg.mouse.click(2, 2)
        for _ in range(3):
            self.key("Escape")
        if pg.viewport_size["width"] > 1100:
            pg.evaluate("() => { for (const id of ['tab-list', 'tab-pages', 'tab-props']) document.getElementById(id).click(); }")

    def fit(self, w):
        self.key("Control+0" if w <= 600 else "Control+9")
        self.pg.wait_for_timeout(250)

    def select_first_markup(self):
        self.key("Tab")
        self.pg.wait_for_timeout(200)

    def arm(self, preset):
        self.pg.click("#tab-chest")
        self.pg.click("#preset-" + preset)

    def build_takeoff(self):
        """A small takeoff on sheet A-101: rooms, walls, a sidewalk, doors, a cloud, an RFI and statuses."""
        pg = self.pg
        pg.click("#thumb-1")
        pg.wait_for_selector("#suggest-apply", timeout=20000)
        pg.click("#suggest-apply")
        # Rooms by click, then dressed as flooring with its assembly.
        self.key("Shift+Alt+F")
        for pt, label, status in (((4, 4), "Living 101", "Accepted"), ((22, 7), "Bedroom 1 102", "Review"), ((34, 7), "Bedroom 2 103", "")):
            prev = pg.inner_text("#sb-message")
            self.click_pt(plan_pt(*pt))
            pg.wait_for_function("(p) => { const t = document.getElementById('sb-message').textContent; return t !== p && t.startsWith('Room traced'); }", arg=prev, timeout=60000)
        self.key("Escape")
        pg.select_option("#list-group", "")
        for i, (label, status) in enumerate((("Living 101", "Accepted"), ("Bedroom 1 102", "Review"), ("Bedroom 2 103", ""))):
            pg.locator("#list-body tr[data-id]").nth(i).click()
            pg.wait_for_selector("#prop-subject")
            pg.fill("#prop-subject", "Flooring")
            pg.press("#prop-subject", "Tab")
            pg.fill("#prop-label", label)
            pg.press("#prop-label", "Tab")
            pg.select_option("#prop-layer", "floors")
            pg.select_option("#prop-assembly", "flooring")
            if status:
                pg.select_option("#prop-status", status)
            pg.wait_for_timeout(100)
        self.reset()
        # Interior walls with the tool chest preset.
        self.arm("p-int-wall")
        for pt in ((16, 0.5), (16, 14), (40, 14)):
            self.click_pt(plan_pt(*pt))
        self.key("Enter")
        self.reset()
        self.arm("p-walk")
        for pt in ((5.5, -8), (9.5, -8), (9.5, -0.6), (5.5, -0.6)):
            self.click_pt(plan_pt(*pt))
        self.key("Enter")
        self.reset()
        # Bedroom 3 baseboard as a perimeter.
        self.key("Shift+Alt+P")
        for pt in ((30.3, 18.3), (39.5, 18.3), (39.5, 29.5), (30.3, 29.5)):
            self.click_pt(plan_pt(*pt))
        self.key("Enter")
        self.reset()
        # Doors counted by symbol search, as the Interior doors preset.
        self.key("Shift+Alt+S")
        x0, y0 = self.client(plan_pt(29.5, 13.9))
        x1, y1 = self.client(plan_pt(33.4, 10.6))
        pg.mouse.move(x0, y0)
        pg.mouse.down()
        pg.mouse.move((x0 + x1) / 2, (y0 + y1) / 2)
        pg.mouse.move(x1, y1)
        pg.mouse.up()
        pg.wait_for_selector("#cand-summary", timeout=60000)
        pg.select_option("#cand-preset", "p-door")
        pg.click("#cand-accept")
        self.reset()
        # Revision cloud and an RFI callout.
        self.arm("p-cloud")
        x0, y0 = self.client(plan_pt(16.6, 29.4))
        x1, y1 = self.client(plan_pt(24.4, 18.6))
        pg.mouse.move(x0, y0)
        pg.mouse.down()
        pg.mouse.move(x1, y1)
        pg.mouse.up()
        self.reset()
        self.arm("p-rfi")
        self.click_pt(plan_pt(20, 22))
        self.click_pt(plan_pt(25, 34))
        pg.fill("#ask-text", "RFI 07: confirm tub length")
        pg.click("#ask-ok")
        self.reset()
        pg.select_option("#list-group", "subject")
        pg.click("#tab-props")
        self.reset()
        # A comment thread with a mention and a reply, and an assignee, on the first room.
        pg.click("#menu-file")
        pg.click(".menu-list button:has-text('Settings')")
        pg.fill("#set-author", "Ana Ruiz")
        pg.click("#set-save")
        pg.fill("#nav-page", "2")
        pg.press("#nav-page", "Enter")
        self.select_first_markup()
        pg.click("#tab-props")
        pg.wait_for_selector("#comment-text")
        pg.fill("#comment-text", "@Ben the closet is in this area; split it out?")
        pg.click("#comment-post")
        pg.wait_for_timeout(100)
        pg.click("#comment-thread button[data-reply]")
        pg.fill("#comment-text", "Yes, as its own room. I will redo it.")
        pg.keyboard.press("Control+Enter")
        pg.fill("#prop-assignee", "Ben")
        pg.press("#prop-assignee", "Tab")
        self.reset()

    def shoot(self, name, w, theme, report):
        pg = self.pg
        pg.wait_for_timeout(250)
        info = pg.evaluate("() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth })")
        line = f"{name}-{w}-{theme}: scroll {info['sw']}/{info['cw']}"
        if info["sw"] > info["cw"] or info["bw"] > info["cw"]:
            line += " SIDEWAYS SCROLL"
        if w <= 1024:
            small = pg.evaluate(SMALL)
            if small:
                line += " small: " + "; ".join(small)
        report.append(line)
        pg.screenshot(path=str(OUT / f"{name}-{w}-{theme}.png"))


def touch(w):
    return w <= 1100


def view_open(s, w):
    pass


def view_measuring(s, w):
    pg = s.pg
    s.fit(w)
    if w <= 600:
        pg.click("#tray-more")
        pg.click(".menu-list button:has-text('Polylength')")
    else:
        if touch(w):
            pg.click("#rail-chest")
        else:
            pg.click("#tab-chest")
        pg.click("#preset-p-int-wall")
    for pt in ((0.6, 29.4), (8, 29.4)):
        s.click_pt(plan_pt(*pt))
    x, y = s.client(plan_pt(8, 22))
    pg.mouse.move(x, y)
    if pg.evaluate("() => document.activeElement && document.activeElement.id") == "viewer":
        pg.keyboard.type("12'6")
    pg.wait_for_timeout(150)


def view_markups(s, w):
    pg = s.pg
    s.fit(w)
    s.select_first_markup()
    if w <= 600:
        return
    if touch(w):
        pg.click("#rail-props")
    else:
        pg.click("#tab-props")
        pg.click("#tab-list")


def view_list_touch(s, w):
    pg = s.pg
    s.fit(w)
    s.select_first_markup()
    if w <= 600:
        pg.click("#btn-phone-more")
        pg.click(".menu-list button:has-text('Markups list')")
    elif touch(w):
        pg.click("#rail-list")
    else:
        pg.click("#tab-list")


def view_estimate(s, w):
    pg = s.pg
    s.fit(w)
    if w <= 600:
        pg.click("#btn-phone-more")
        pg.click(".menu-list button:has-text('Estimate')")
    elif touch(w):
        pg.click("#rail-list")
        pg.click("#tab-estimate")
    else:
        pg.click("#tab-estimate")
    pg.wait_for_timeout(200)


def view_compare(s, w):
    pg = s.pg
    s.fit(w)
    s.key("Control+Shift+C")
    if pg.locator("#cmp-example").count():
        pg.click("#cmp-example")
        pg.wait_for_selector("#cmp-run", timeout=30000)
    pg.evaluate("() => { document.getElementById('sb-message').textContent = ''; }")
    pg.click("#cmp-run")
    s.wait_msg("Compared")
    s.shoot("compare-overlay", w, s.theme, s.report)
    s.key("Control+Shift+C")
    pg.click("#cmp-mode-side")
    pg.click("#dlg-close")
    pg.wait_for_timeout(600)
    s.shoot("compare-side", w, s.theme, s.report)
    s.key("Control+Shift+C")
    pg.click("#cmp-mode-overlay")
    pg.click("#dlg-close")
    s.key("Control+Shift+C")
    pg.wait_for_selector("#cmp-changes", timeout=10000)


def view_symbols(s, w):
    pg = s.pg
    s.fit(w)
    if w <= 600:
        pg.click("#tray-more")
        pg.click(".menu-list button:has-text('Find symbol and count')")
    else:
        s.key("Shift+Alt+S")
    x0, y0 = s.client(plan_pt(17.6, 13.9))
    x1, y1 = s.client(plan_pt(21.4, 10.6))
    pg.mouse.move(x0, y0)
    pg.mouse.down()
    pg.mouse.move((x0 + x1) / 2, (y0 + y1) / 2)
    pg.mouse.move(x1, y1)
    pg.mouse.up()
    pg.wait_for_selector("#cand-summary", timeout=60000)


def view_sheets(s, w):
    pg = s.pg
    if w <= 600:
        pg.click("#btn-phone-more")
        pg.click(".menu-list button:has-text('Sheets')")
    elif touch(w):
        pg.click("#rail-sheets")
    else:
        pg.click("#tab-sheets")
    pg.click("#sheets-read")
    pg.wait_for_selector("#sheets-apply", timeout=30000)


def view_why(s, w):
    pg = s.pg
    pg.fill("#nav-page", "3") if w > 600 else None
    if w > 600:
        pg.press("#nav-page", "Enter")
        pg.wait_for_selector("#suggest-why", timeout=20000)
        pg.click("#suggest-why")
    pg.wait_for_timeout(200)


def view_room(s, w):
    """Area by click with its card: what was traced, the boundary choice and Keep area."""
    s.fit(w)
    s.key("Shift+Alt+F")
    s.click_pt(plan_pt(34, 7))
    s.pg.wait_for_selector("#room-card", timeout=20000)
    s.pg.wait_for_timeout(200)


def view_calibrate(s, w):
    pg = s.pg
    s.fit(w)
    if w <= 600:
        pg.click("#tray-more")
        pg.click(".menu-list button:has-text('Calibrate')")
    else:
        s.key("Shift+Alt+K")
    s.click_pt(plan_pt(0, 30))
    s.click_pt(plan_pt(40, 30))
    pg.fill("#cal-known", "40'")


def view_toast(s, w):
    pg = s.pg
    s.fit(w)
    if w <= 600:
        pg.click("#tray-more")
        pg.click(".menu-list button:has-text('Area by click')")
    else:
        s.key("Shift+Alt+F")
    s.click_pt(plan_pt(8, 24))
    pg.wait_for_selector(".toast", timeout=60000)


def menu(s, top, item):
    pg = s.pg
    if s.pg.viewport_size["width"] <= 600:
        pg.click("#btn-phone-more")
        pg.click(".menu-list button:has-text('" + top.capitalize() + "')")
    else:
        pg.click("#menu-" + top)
    pg.click("#" + item if not item.startswith(".") else item)


def view_comments(s, w):
    pg = s.pg
    s.fit(w)
    s.select_first_markup()
    if w <= 600:
        pg.click("#btn-phone-more")
        pg.click(".menu-list button:has-text('Properties')")
    elif touch(w):
        pg.click("#rail-props")
    else:
        pg.click("#tab-props")
    pg.wait_for_selector("#prop-comments")
    pg.evaluate("() => document.getElementById('prop-comments').scrollIntoView()")


def view_merge(s, w):
    pg = s.pg
    ms = pg.evaluate("() => takeoffInspect.markups()")
    mine = next(m for m in ms if len(m.get("vers", [])) >= 2)
    theirs = dict(mine, subject="Flooring, carpet", vers=mine["vers"][:-1] + ["vTheirs1"], rev=mine["rev"], modified_by="Ben", author=mine.get("author", ""))
    extra = dict(ms[-1], id="ben-1", subject="Ben's count", vers=["vB1"], rev=1, modified_by="Ben")
    doc = {"format": "field-tools-takeoff-markups", "version": 1, "markups": [theirs, extra]}
    pg.set_input_files("#file-merge", files=[{"name": "takeoff.ben.markups.json", "mimeType": "application/json", "buffer": json.dumps(doc).encode()}])
    pg.wait_for_selector("#merge-apply", timeout=20000)


def view_sync(s, w):
    menu(s, "team", ".menu-list button:has-text('Shared folder sync')")
    s.pg.wait_for_selector("#sync-choose")


def view_live(s, w):
    pg = s.pg
    pg.evaluate("() => { const b = document.getElementById('live-leave'); if (b) b.click(); }")
    menu(s, "team", ".menu-list button:has-text('Start a live session')")
    if pg.locator("#live-switch-on").count():
        pg.click("#live-switch-on")
    pg.wait_for_selector("#live-offer-code", timeout=20000)
    pg.wait_for_timeout(600)


def view_library(s, w):
    pg = s.pg
    view_estimate(s, w)
    pg.click("#est-library")
    pg.select_option("#lib-division", "09")
    pg.check("#lib-lib-092900-a")
    pg.check("#lib-lib-099123-b")


def view_estimate_edit(s, w):
    pg = s.pg
    if not pg.evaluate("() => takeoffInspect.assemblies().some((a) => a.params)"):
        view_estimate(s, w)
        pg.click("#est-library")
        pg.fill("#lib-search", "gypsum board wall, 1/2 in, one side")
        pg.wait_for_timeout(300)
        pg.locator("#lib-list input[type=checkbox]").first.check()
        pg.click("#lib-add")
        s.reset()
    view_estimate(s, w)
    if pg.get_attribute("#est-assemblies", "aria-pressed") != "true":
        pg.click("#est-assemblies")
    pg.wait_for_selector(".params-row")
    pg.evaluate("() => { const r = document.querySelector('.params-row'); let g = r.previousElementSibling; while (g && !g.classList.contains('group')) g = g.previousElementSibling; (g || r).scrollIntoView({ block: 'start' }); }")


def view_prices(s, w):
    pg = s.pg
    view_estimate(s, w)
    csv = "Item #,Description,UOM,Price,Hours\nG-12,Gypsum board 1/2 in,SHEET,$14.50,0.25\nP-1,Ceiling paint,GAL,32.00,0.1\nS-1,\"Screws, boxes of 1000\",BOX,38.00,\n"
    pg.set_input_files("#file-prices", files=[{"name": "supplier-prices.csv", "mimeType": "text/csv", "buffer": csv.encode()}])
    pg.wait_for_selector("#price-next")
    s.shoot("prices-columns", w, s.theme, s.report)
    pg.select_option("#price-col-labor_hours", "4")
    pg.click("#price-next")
    pg.wait_for_selector("#price-apply")


def view_rates(s, w):
    pg = s.pg
    view_estimate(s, w)
    pg.click("#est-more")
    pg.click("#est-rates")
    if not pg.locator("#rate-name-0").count():
        pg.click("#rate-common")
        pg.fill("#rate-value-0", "42")
        pg.fill("#rate-value-1", "58.5")


def view_viewport(s, w):
    pg = s.pg
    s.fit(w)
    if not pg.evaluate("() => takeoffInspect.viewports(1).length"):
        s.key("Shift+Alt+W")
        x0, y0 = s.client(plan_pt(-1, 31))
        x1, y1 = s.client(plan_pt(15, 15))
        pg.mouse.move(x0, y0)
        pg.mouse.down()
        pg.mouse.move(x1, y1)
        pg.mouse.up()
        pg.wait_for_selector("#vp-ok")
        pg.fill("#vp-name", "Enlarged living room")
        pg.select_option("#vp-scale", "1/2\" = 1'-0\"")
        s.shoot("viewport-dialog", w, s.theme, s.report)
        pg.click("#vp-ok")
    else:
        pg.evaluate("() => takeoffInspect.fit()")
    if w > 600:
        pg.click("#sb-scale")
        pg.wait_for_selector("#measure-viewports")
        pg.evaluate("() => document.getElementById('measure-viewports').scrollIntoView()")


def view_annot_export(s, w):
    menu(s, "file", "menu-annot-pdf")
    s.pg.wait_for_selector("#annot-ok")


def _btx():
    hx = lambda r: binascii.hexlify(zlib.compress(r.encode("latin-1"))).decode()  # noqa: E731
    items = [("Slab area", "<</Type/Annot/Subtype/Polygon/IT/PolygonDimension/Subj(Slab on grade)/C[0 0.4 0.8]/IC[0 0.4 0.8]/CA 0.3/BS<</W 2>>>>"),
             ("Wall length", "<</Type/Annot/Subtype/PolyLine/IT/PolyLineDimension/Subj(Interior wall)/C[0.7 0 0]/BS<</W 3>>>>"),
             ("Outlets", "<</Type/Annot/Subtype/Polygon/IT/PolygonCount/Subj(Duplex outlet)/C[0 0.5 0.3]/IC[0 0.5 0.3]>>"),
             ("RFI", "<</Type/Annot/Subtype/FreeText/IT/FreeTextCallout/Subj(RFI)/Contents(RFI)/DA(/Helv 12 Tf)>>"),
             ("Field form", "<</Type/Annot/Subtype/Widget>>")]
    body = "".join(f"<ToolChestItem Version=\"1\"><Name>{n}</Name><Type>x</Type><Raw>{hx(r)}</Raw></ToolChestItem>" for n, r in items)
    return f"<?xml version=\"1.0\"?><BluebeamRevuToolSet Version=\"1\"><Title>Estimating set</Title>{body}</BluebeamRevuToolSet>".encode()


def view_btx(s, w):
    s.pg.set_input_files("#file-chest", files=[{"name": "estimating.btx", "mimeType": "application/octet-stream", "buffer": _btx()}])
    s.pg.wait_for_selector("#btx-ok")


def view_summary(s, w):
    csv = ("Subject,Page Label,Length,Area,Count,Author,Cost Code\n"
           "Interior wall,A-101,\"52'-6\"\"\",,,Ana,09-29\nSlab,A-101,,1200 sf,,Ana,03-30\nDuplex outlet,A-101,,,14,Ben,26-27\nNote,A-101,,,,Ben,\n")
    menu(s, "file", "menu-summary-import") if s.pg.viewport_size["width"] > 600 else None
    s.pg.set_input_files("#file-summary", files=[{"name": "summary.csv", "mimeType": "text/csv", "buffer": csv.encode()}])
    s.pg.wait_for_selector("#summary-ok")


def view_snapshot(s, w):
    pg = s.pg
    s.fit(w)
    s.key("G")
    x0, y0 = s.client(plan_pt(-2, 31))
    x1, y1 = s.client(plan_pt(20, 12))
    pg.mouse.move(x0, y0)
    pg.mouse.down()
    pg.mouse.move(x1, y1)
    pg.mouse.up()
    pg.wait_for_selector("#snapshot-img", timeout=20000)


def view_help(s, w):
    pg = s.pg
    pg.keyboard.press("F1")
    pg.wait_for_selector("#help-body")
    s.shoot("help-start", w, s.theme, s.report)
    pg.click("#help-nav-keys")
    s.shoot("help-keys", w, s.theme, s.report)
    pg.click("#help-nav-revu")


def view_tour(s, w):
    pg = s.pg
    pg.evaluate("() => document.querySelectorAll('.tour-pop, .tour-ring').forEach((n) => n.remove())")
    menu(s, "help", "menu-tour")
    pg.wait_for_selector("#tour-pop")
    for _ in range(4):
        pg.click("#tour-next")
    pg.wait_for_timeout(150)


def after_tour(s):
    s.pg.evaluate("() => { const b = document.getElementById('tour-skip'); if (b) b.click(); }")


VIEWS2 = [("comments", view_comments), ("merge", view_merge), ("sync", view_sync), ("live", view_live), ("library", view_library),
          ("estimate-edit", view_estimate_edit), ("prices", view_prices), ("rates", view_rates), ("viewport", view_viewport),
          ("annot-export", view_annot_export), ("btx-import", view_btx), ("summary-import", view_summary), ("snapshot", view_snapshot),
          ("help-revu", view_help), ("tour", view_tour)]


def own_pdf_views(b, url, report, only):
    """Screens that need a PDF of their own: text recognition on a scan, and markups imported from a
    PDF's annotations."""
    for name in ("ocr", "pdf-import"):
        if only and name not in only:
            continue
        for w in WIDTHS:
            for theme in THEMES:
                s = Shooter(b, url)
                s.theme, s.report = theme, report
                pg = s.pg
                try:
                    pg.emulate_media(color_scheme=theme)
                    pg.set_viewport_size({"width": w, "height": 900 if w < 1900 else 1080})
                    if name == "ocr":
                        if not OCR_DATA.is_file():
                            report.append("ocr: skipped, npm ci has not installed the language data")
                            s.ctx.close()
                            return
                        body = OCR_DATA.read_bytes()
                        pg.route(OCR_URL, lambda r: r.fulfill(status=200, body=body, headers={"content-type": "application/gzip", "content-length": str(len(body)), "access-control-allow-origin": "*"}))
                        pg.set_input_files("#file-pdf", files=[{"name": "scanned-sheet.pdf", "mimeType": "application/pdf", "buffer": fx.scanned_text_pdf()}])
                        s.wait_msg("Opened scanned")
                        menu(s, "automate", "menu-ocr")
                        pg.click("#ocr-switch-on")
                        pg.click("#ocr-download")
                        pg.wait_for_selector("#ocr-run", timeout=60000)
                        s.shoot("ocr-found", w, theme, report)
                        pg.click("#ocr-run")
                        pg.wait_for_function("() => /Use text/.test(document.querySelector('#ocr-run').textContent)", timeout=180000)
                    else:
                        pg.set_input_files("#file-pdf", files=[{"name": "measured.pdf", "mimeType": "application/pdf", "buffer": fx.measured_markups_pdf()}])
                        s.wait_msg("Opened measured")
                        pg.wait_for_selector(".toast", timeout=20000)
                        s.fit(w)
                        s.shoot("pdf-import-offer", w, theme, report)
                        pg.click("#toast-action")
                        pg.wait_for_selector("#pdfimp-ok")
                    s.shoot(name, w, theme, report)
                    if name == "pdf-import":
                        pg.click("#pdfimp-ok")
                        s.reset()
                        s.fit(w)
                        s.shoot("pdf-imported", w, theme, report)
                except Exception as e:
                    report.append(f"{name}-{w}-{theme}: FAILED {str(e).splitlines()[0]}")
                    pg.screenshot(path=str(OUT / f"failed-{name}-{w}-{theme}.png"))
                report.extend("  error: " + e for e in s.errors)
                s.ctx.close()


def _to_plan(s, w):
    pg = s.pg
    pg.evaluate("() => document.getElementById('thumb-1').click()")
    pg.wait_for_function("() => takeoffInspect.page() === 1")
    pg.wait_for_timeout(800)
    s.fit(w)


def _mock_answer(pg):
    """Answer the provider's address here: one tool call, then an answer that cites a markup."""
    cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST"}
    turn = {"n": 0}

    def handle(route):
        if route.request.method == "OPTIONS":
            route.fulfill(status=204, headers=cors)
            return
        turn["n"] += 1
        door = pg.evaluate("() => (takeoffInspect.markups().find((m) => m.type === 'count') || {}).id || ''")
        if turn["n"] % 2 == 1:
            out = {"content": [{"type": "tool_use", "id": "t1", "name": "find_markups", "input": {"filter": {"label_contains": "door"}}}]}
        else:
            out = {"content": [{"type": "text", "text": "There are 7 doors on A-101 [M:%s], counted by the auto-takeoff. The plan shows 12 windows." % door}]}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(out), headers=cors)
    pg.route(re.compile(r"^https://api\.[a-z]+\.com/"), handle)


def _ai_settings(s, provider):
    pg = s.pg
    menu(s, "file", ".menu-list button:has-text('Settings')")
    pg.check("#set-net-ai-cloud")
    pg.select_option("#set-ai-provider", provider)
    pg.fill("#set-ai-key", "sk-test-0123456789abcdef")


def ai_views(b, url, report, only):
    """Auto-takeoff, plan review, the project manual check, plan questions (off, the payload shown
    before sending, and an answer from a mocked provider), the model settings and the live
    session's own-markups setting. Each starts from a fresh page."""
    names = ["auto-takeoff", "auto-takeoff-added", "plan-review", "manual-check", "ask-off", "ai-settings", "ask-preview", "ask-answer", "live-own"]
    if only and not any(n in only for n in names):
        return
    for w in WIDTHS:
        for theme in THEMES:
            s = Shooter(b, url)
            s.theme, s.report = theme, report
            pg = s.pg

            def shot(name):
                if not only or name in only:
                    s.shoot(name, w, theme, report)
            try:
                pg.emulate_media(color_scheme=theme)
                pg.set_viewport_size({"width": w, "height": 900 if w < 1900 else 1080})
                _to_plan(s, w)
                menu(s, "automate", "menu-autotakeoff")
                pg.wait_for_selector("#at-accept", timeout=60000)
                shot("auto-takeoff")
                pg.click("#at-accept")
                s.reset()
                s.fit(w)
                shot("auto-takeoff-added")
                menu(s, "automate", "menu-review")
                pg.wait_for_selector("#rv-total", timeout=60000)
                shot("plan-review")
                s.reset()
                menu(s, "automate", "menu-manual")
                pg.click("#pm-example")
                pg.wait_for_selector("#pm-total")
                shot("manual-check")
                s.reset()
                menu(s, "automate", "menu-ask")
                pg.wait_for_selector("#ask-settings")
                shot("ask-off")
                s.reset()
                _ai_settings(s, "a")
                shot("ai-settings")
                pg.click("#set-save")
                pg.wait_for_timeout(100)
                _mock_answer(pg)
                menu(s, "automate", "menu-ask")
                pg.wait_for_selector("#ask-q")
                pg.fill("#ask-q", "How many doors are on A-101?")
                pg.click("#ask-go")
                pg.wait_for_selector("#ask-send")
                shot("ask-preview")
                pg.click("#ask-send")
                pg.wait_for_selector("ul.ask-log li p.answer, ul.ask-log li .chip.bad", timeout=20000)
                shot("ask-answer")
                s.reset()
                menu(s, "team", ".menu-list button:has-text('Start a live session')")
                if pg.locator("#live-switch-on").count():
                    pg.click("#live-switch-on")
                pg.wait_for_selector("#live-offer-code", timeout=20000)
                pg.click("#dlg-close")
                pg.evaluate("() => document.getElementById('live-chip').click()")
                pg.wait_for_selector("#live-own", timeout=20000)
                pg.check("#live-own")
                pg.evaluate("() => document.getElementById('live-own').scrollIntoView({ block: 'center' })")
                shot("live-own")
            except Exception as e:
                report.append(f"ai-{w}-{theme}: FAILED {str(e).splitlines()[0]}")
                pg.screenshot(path=str(OUT / f"failed-ai-{w}-{theme}.png"))
            report.extend("  error: " + e for e in s.errors)
            s.ctx.close()


VIEWS = [("measuring", view_measuring), ("markups", view_markups), ("list", view_list_touch), ("estimate", view_estimate),
         ("auto-symbols", view_symbols), ("auto-sheets", view_sheets), ("auto-calibrate", view_calibrate), ("auto-toast", view_toast),
         ("compare", view_compare), ("auto-why", view_why), ("auto-room", view_room)]


def main(args):
    global WIDTHS
    widths = [int(a[2:]) for a in args if a.startswith("w=")]
    if widths:
        WIDTHS = tuple(widths)
    only = [a for a in args if not a.startswith("w=")]
    OUT.mkdir(exist_ok=True)
    report = []
    with Server() as url, sync_playwright() as p:
        b = p.chromium.launch()
        # The plan as it opens: sheet A-101 with the title block scale offered in the status bar.
        if not only or "open" in only:
            for w in WIDTHS:
                for theme in THEMES:
                    s = Shooter(b, url)
                    s.pg.emulate_media(color_scheme=theme)
                    s.pg.set_viewport_size({"width": w, "height": 900 if w < 1900 else 1080})
                    s.pg.wait_for_timeout(200)
                    if w > 1100:
                        s.pg.click("#thumb-1")
                    else:
                        s.pg.fill("#nav-page", "2") if w > 600 else None
                        if w > 600:
                            s.pg.press("#nav-page", "Enter")
                        else:
                            s.pg.evaluate("() => document.getElementById('nav-next').click()")
                    s.pg.wait_for_timeout(1500)
                    s.fit(w)
                    s.shoot("open", w, theme, report)
                    report.extend("  error: " + e for e in s.errors)
                    s.ctx.close()
        s = Shooter(b, url)
        s.build_takeoff()
        for w in WIDTHS:
            for theme in THEMES:
                s.pg.emulate_media(color_scheme=theme)
                s.pg.set_viewport_size({"width": w, "height": 900 if w < 1900 else 1080})
                s.pg.wait_for_timeout(300)
                s.theme, s.report = theme, report
                for name, fn in VIEWS:
                    if only and name not in only:
                        continue
                    s.reset()
                    if s.pg.evaluate("() => takeoffInspect.page()") != 1:
                        s.pg.evaluate("() => document.getElementById('thumb-1').click()")
                        s.pg.wait_for_timeout(800)
                    try:
                        fn(s, w)
                        s.shoot(name, w, theme, report)
                    except Exception as e:  # keep going; report the view that could not be set up
                        report.append(f"{name}-{w}-{theme}: FAILED {str(e).splitlines()[0]}")
                        s.pg.screenshot(path=str(OUT / f"failed-{name}-{w}-{theme}.png"))
                    if name == "auto-toast":
                        s.reset()
                        s.key("Control+z")
                for name, fn in VIEWS2:
                    if only and name not in only:
                        continue
                    s.reset()
                    if s.pg.evaluate("() => takeoffInspect.page()") != 1:
                        s.pg.evaluate("() => document.getElementById('thumb-1') && document.getElementById('thumb-1').click()")
                        s.pg.fill("#nav-page", "2") if w > 600 else None
                        s.pg.wait_for_timeout(800)
                    try:
                        fn(s, w)
                        s.shoot(name, w, theme, report)
                    except Exception as e:
                        report.append(f"{name}-{w}-{theme}: FAILED {str(e).splitlines()[0]}")
                        s.pg.screenshot(path=str(OUT / f"failed-{name}-{w}-{theme}.png"))
                    if name == "tour":
                        after_tour(s)
                    if name == "live":
                        s.reset()
        report.extend("  error: " + e for e in s.errors)
        own_pdf_views(b, url, report, only)
        ai_views(b, url, report, only)
        b.close()
    print("\n".join(report))


if __name__ == "__main__":
    main(sys.argv[1:])
