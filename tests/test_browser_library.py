"""Headless browser tests for the assemblies library, labor rates, overhead, a price list import with
column mapping and review, assemblies shared as a file, tool chests from another program (.btx with
compressed items), and a markup summary imported as quantities."""

import binascii
import json
import sys
import zlib
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_browser import App, app, browser, plan_pt, server  # noqa: E402,F401


def area_on_floor_plan(app):
    pg = app.page
    app.floor_plan()
    pg.click("#suggest-apply")
    app.key("Shift+Alt+A")
    for c in [(0, 0), (40, 0), (40, 30), (0, 30)]:
        app.click_pt(plan_pt(*c))
    app.key("Enter")
    app.wait_msg("Area")
    return app.markups()[-1]


def test_library_rates_price_list_and_overhead(app):
    pg = app.page
    area = area_on_floor_plan(app)
    pg.click("#tab-estimate")
    before = len(pg.evaluate("() => takeoffInspect.assemblies()"))
    pg.click("#est-library")
    pg.wait_for_selector("#lib-list")
    assert "191 of 191" in pg.inner_text("#lib-count")
    pg.select_option("#lib-division", "09")
    pg.fill("#lib-search", "paint ceilings")
    pg.wait_for_timeout(300)
    assert pg.locator("#lib-list li").count() == 1
    assert "no prices" in pg.inner_text(".dialog .why").lower()
    pg.check("#lib-lib-099123-b")
    assert pg.inner_text("#lib-add") == "Add 1 assembly"
    pg.click("#lib-add")
    asms = pg.evaluate("() => takeoffInspect.assemblies()")
    assert len(asms) == before + 1 and asms[-1]["name"] == "Paint ceilings" and asms[-1]["code"] == "09 91 23"
    assert asms[-1]["components"][0]["unit_cost_cents"] == 0
    # link the area to it
    app.key("Escape")
    app.click_pt(plan_pt(20, 0))
    pg.wait_for_selector("#prop-assembly")
    pg.select_option("#prop-assembly", asms[-1]["id"])
    # labor rates
    pg.click("#est-more")
    pg.click("#est-rates")
    pg.click("#rate-add")
    pg.fill("#rate-name-0", "Painter")
    pg.fill("#rate-value-0", "60")
    pg.press("#rate-value-0", "Tab")
    pg.click("#rates-save")
    rates = pg.evaluate("() => takeoffInspect.rates()")
    assert rates == [{"id": rates[0]["id"], "name": "Painter", "cents_per_hour": 6000}]
    # a price list whose columns are named differently: map, review, apply
    csv = "Item #,Description,UOM,Price,Hours\nX-1,Ceiling paint,GAL,$32.50,0.5\nX-2,Something else,EA,4.00,\n"
    pg.click("#est-more")
    with pg.expect_file_chooser() as fc:
        pg.click("#est-prices")
    fc.value.set_files(files=[{"name": "prices.csv", "mimeType": "text/csv", "buffer": csv.encode()}])
    pg.wait_for_selector("#price-next")
    assert pg.input_value("#price-col-name") == "1" and pg.input_value("#price-col-material") == "3" and pg.input_value("#price-col-unit") == "2"
    pg.select_option("#price-col-labor_hours", "4")
    pg.click("#price-next")
    pg.wait_for_selector("#price-apply")
    assert "Matched by name" in pg.inner_text("#price-list")
    pg.click("#price-apply")
    comp = pg.evaluate("() => takeoffInspect.assemblies()")[-1]["components"][0]
    assert comp["unit_cost_cents"] == 3250 and comp["labor_hours"] == 0.5
    # the trade on the component, in the editing view
    pg.click("#est-assemblies")
    sel = pg.locator("select[aria-label='Labor rate']").last
    sel.select_option(rates[0]["id"])
    pg.wait_for_timeout(200)
    est = pg.evaluate("() => takeoffInspect.estimate()")
    line = [x for x in est["lines"] if x["name"] == "Paint ceilings"][0]
    c = line["components"][0]
    assert c["order"] > 0 and c["labor_cents"] == round(c["order"] * 0.5 * 6000)
    assert est["labor_cents"] >= c["labor_cents"]
    # overhead goes on before markup
    pg.fill("#est-overhead", "10")
    pg.press("#est-overhead", "Tab")
    pg.wait_for_timeout(200)
    est2 = pg.evaluate("() => takeoffInspect.estimate()")
    assert est2["overhead_cents"] == round(est2["subtotal_cents"] * 0.1)
    # one undo per step: undo the overhead, the trade, the prices
    for _ in range(3):
        app.key("Control+z")
        pg.wait_for_timeout(100)
    comp = pg.evaluate("() => takeoffInspect.assemblies()")[-1]["components"][0]
    assert comp["unit_cost_cents"] == 0
    assert area["id"] in [m["id"] for m in app.markups()]


def test_formula_and_inputs_in_an_assembly(app):
    pg = app.page
    area_on_floor_plan(app)
    pg.click("#tab-estimate")
    pg.click("#est-library")
    pg.fill("#lib-search", "slab on grade")
    pg.wait_for_timeout(300)
    first = pg.locator("#lib-list input[type=checkbox]").first
    first.check()
    pg.click("#lib-add")
    asm = pg.evaluate("() => takeoffInspect.assemblies()")[-1]
    assert asm.get("params") and any("formula" in c for c in asm["components"])
    pg.click("#est-assemblies")
    pg.wait_for_selector(".params-row")
    # a bad formula is refused with a reason, nothing changes
    f = pg.locator("input.formula").last
    f.fill("SF * nonsense")
    f.press("Tab")
    assert "Unknown name" in app.msg()
    assert pg.evaluate("() => takeoffInspect.assemblies()")[-1] == asm


def test_assemblies_file_round_trip(app):
    pg = app.page
    pg.click("#tab-estimate")
    asms = pg.evaluate("() => takeoffInspect.assemblies()")
    pg.click("#est-more")
    with pg.expect_download() as dl:
        pg.click("#est-asm-export")
    data = json.loads(Path(dl.value.path()).read_text())
    assert data["format"] == "field-tools-takeoff-assemblies" and len(data["assemblies"]) == len(asms)
    data["assemblies"][0]["name"] = "Shared copy"
    pg.click("#est-more")
    with pg.expect_file_chooser() as fc:
        pg.click("#est-asm-import")
    fc.value.set_files(files=[{"name": "a.json", "mimeType": "application/json", "buffer": json.dumps(data).encode()}])
    pg.wait_for_timeout(300)
    names = [a["name"] for a in pg.evaluate("() => takeoffInspect.assemblies()")]
    assert names.count("Shared copy") == 1 and len(names) == len(asms) + 1


def _hexz(s):
    return binascii.hexlify(zlib.compress(s.encode("latin-1"))).decode()


def test_tool_chest_from_another_program(app):
    pg = app.page
    area_raw = ("<</Type/Annot/Subtype/Polygon/IT/PolygonDimension/Subj(Slab area)/C[0 0.5 1]/IC[0 0.5 1]/CA 0.35/BS<</W 2>>"
                "/Measure<</Type/Measure/Subtype/RL/R(1/4\" = 1'-0\")/X[<</U(ft)/C 0.0555556>>]/D[<</U(ft)/C 1>>]/A[<</U(sq ft)/C 1>>]>>>>")
    count_raw = "<</Type/Annot/Subtype/Polygon/IT/PolygonCount/Subj(Outlets)/C[1 0 0]/IC[1 0 0]>>"
    widget = "<</Type/Annot/Subtype/Widget>>"
    xml = ("<?xml version=\"1.0\" encoding=\"utf-8\"?><BluebeamRevuToolSet Version=\"1\"><Title>Estimating</Title>"
           f"<ToolChestItem Version=\"1\"><Name>a</Name><Type>Area</Type><Raw>{_hexz(area_raw)}</Raw></ToolChestItem>"
           f"<ToolChestItem Version=\"1\"><Name>b</Name><Type>Count</Type><Raw>{count_raw.replace('<', '&lt;').replace('>', '&gt;')}</Raw></ToolChestItem>"
           f"<ToolChestItem Version=\"1\"><Name>c</Name><Type>Form</Type><Raw>{_hexz(widget)}</Raw></ToolChestItem>"
           "</BluebeamRevuToolSet>")
    n0 = len(pg.evaluate("() => takeoffInspect.presets()"))
    pg.set_input_files("#file-chest", files=[{"name": "estimating.btx", "mimeType": "application/octet-stream", "buffer": xml.encode()}])
    pg.wait_for_selector("#btx-ok")
    assert "2 of 3" in pg.inner_text(".dialog header")
    pg.click("#btx-ok")
    ps = pg.evaluate("() => takeoffInspect.presets()")[n0:]
    assert [(p["tool"], p["subject"]) for p in ps] == [("area", "Slab area"), ("count", "Outlets")]
    assert ps[0]["opacity"] == pytest.approx(0.35) and ps[0]["width"] == 2


def test_markup_summary_becomes_quantities(app):
    pg = app.page
    csv = ("Subject,Page Label,Length,Area,Count,Author,Cost Code\n"
           "Wall,A-101,\"52'-6\"\"\",,,Ana,09-29\n"
           "Slab,A-101,,1200 sf,,Ana,03-30\n"
           "Outlets,A-101,,,14,Ben,26-27\n"
           "Note,A-101,,,,Ben,\n")
    app.floor_plan()
    pg.click("#tab-sheets")
    pg.click("#sheets-read")
    pg.wait_for_selector("#sheets-apply", timeout=30000)
    pg.click("#sheets-apply")
    pg.click("#menu-file")
    with pg.expect_file_chooser() as fc:
        pg.click("#menu-summary-import")
    fc.value.set_files(files=[{"name": "summary.csv", "mimeType": "text/csv", "buffer": csv.encode()}])
    pg.wait_for_selector("#summary-ok")
    why = pg.inner_text(".dialog .why")
    assert "Rows without a readable quantity are skipped: 5" in why and "1 other columns" in why
    pg.click("#summary-ok")
    ms = [m for m in app.markups() if m["type"] == "quantity"]
    assert len(ms) == 3 and {m["page"] for m in ms} == {1}
    q = {m["subject"]: m["qty"] for m in ms}
    assert q["Wall"] == {"kind": "length", "value": 630} and q["Slab"] == {"kind": "area", "value": 1200 * 144} and q["Outlets"] == {"kind": "count", "value": 14}
    assert any(m.get("custom") for m in ms)
