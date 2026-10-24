"""Headless browser tests for the help panel (topics, the shortcut sheet, the page for people coming
from Revu), the guided tour, and the network switches staying off through all of it."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_browser import App, app, browser, server  # noqa: E402,F401


def test_help_panel_topics_and_shortcut_sheet(app):
    pg = app.page
    app.key("F1")
    pg.wait_for_selector("#help-body")
    assert "Start here" in pg.inner_text("#help-body")
    pg.click("#help-nav-keys")
    keys = pg.inner_text("#help-keys")
    for want in ("Snapshot", "Diameter", "Viewport", "Shift+Alt+D", "Ctrl+Shift+Plus"):
        assert want in keys, want
    pg.click("#help-nav-revu")
    revu = pg.inner_text("#help-revu")
    for want in ("Dynamic Fill", "Area by click", "VisualSearch", "Tool Chest", "Spaces"):
        assert want in revu, want
    pg.click("#help-nav-network")
    assert "off until you turn them on" in pg.inner_text("#help-body")
    pg.click("#dlg-close")
    # the old entry point still lands on the shortcut sheet
    app.key("Shift+Slash")
    pg.wait_for_selector("#help-keys")


def test_guided_tour_steps_and_closes(app):
    pg = app.page
    pg.click("#menu-help")
    pg.click("#menu-tour")
    pg.wait_for_selector("#tour-pop")
    assert "STEP 1 OF 8" in pg.inner_text("#tour-pop").upper()
    for i in range(2, 9):
        pg.click("#tour-next")
        assert f"STEP {i} OF 8" in pg.inner_text("#tour-pop").upper()
        box = pg.locator("#tour-pop").bounding_box()
        assert box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= 1500 and box["y"] + box["height"] <= 900
    pg.click("#tour-back")
    assert "STEP 7 OF 8" in pg.inner_text("#tour-pop").upper()
    pg.keyboard.press("Escape")
    assert pg.locator("#tour-pop").count() == 0 and pg.locator(".tour-ring").count() == 0
    assert app.markups() == []


def test_help_fits_a_phone(browser, server):
    a = App(browser, server, width=400, height=800)
    try:
        pg = a.page
        pg.keyboard.press("F1")
        pg.wait_for_selector("#help-body")
        pg.click("#help-nav-revu")
        assert pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
        assert a.requests and all(u.startswith(a.server) or u.startswith("blob:") or u.startswith("data:") for u in a.requests)
    finally:
        a.close()


def test_nothing_reaches_the_network_with_both_switches_off(app):
    """The new parts (text recognition, live session, help, library, exports, annotations) with
    the OCR and Live session switches off: no request leaves the page, and RTCPeerConnection is
    never made."""
    pg = app.page
    pg.evaluate("""() => { window.__peers = 0; const P = window.RTCPeerConnection;
        window.RTCPeerConnection = function (...a) { window.__peers++; return new P(...a); }; }""")
    app.floor_plan()
    pg.click("#menu-automate")
    pg.click("#menu-ocr")
    pg.wait_for_selector("#ocr-switch-on")
    pg.click("#dlg-close")
    pg.click("#menu-team")
    pg.click(".menu-list button:has-text('Start a live session')")
    pg.wait_for_selector("#live-switch-on")
    if pg.locator("#dlg-close").count():
        pg.click("#dlg-close")
    if pg.locator("#live-leave").count():
        pg.click("#live-leave")
    pg.wait_for_timeout(100)
    app.key("F1")
    pg.click("#help-nav-revu")
    pg.click("#dlg-close")
    pg.click("#tab-estimate")
    pg.click("#est-library")
    pg.click("#dlg-close")
    with pg.expect_download():
        pg.click("#menu-file")
        pg.click("#menu-xlsx")
    pg.click("#menu-file")
    pg.click("#menu-annot-pdf")
    with pg.expect_download():
        pg.click("#annot-ok")
    pg.wait_for_timeout(500)
    external = [u for u in app.requests if not (u.startswith(app.server) or u.startswith("blob:") or u.startswith("data:"))]
    assert external == []
    assert pg.evaluate("() => window.__peers") == 0
