"""Files the browser core writes, checked with independent readers: the XLSX workbook opens in
openpyxl with its sheets, styles and values, and QR codes decode with OpenCV's detector."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

SCRIPT = """
import { loadCore } from "%s";
const C = loadCore();
const out = {};
const rows = [{ page: 1, sheet: "A-101", type: "Area", subject: "=cmd|' /C calc'!A0", label: "", layer: "Floors", author: "Ana", status: "Open",
  date: "2026-10-22", measurement: "1,200.00 SF", quantity: 1200, unit: "SF", custom: { cc: "09 65 19" } }];
const est = { lines: [{ name: "Slab", material_cents: 150000, labor_cents: 50000, cost_cents: 200000, components: [
  { name: "Concrete", with_waste: 15.56, order: 15.56, unit: "CY", unit_cost_cents: 14500, material_cents: 225620, labor_hours: 0, labor_cents: 0, cost_cents: 225620 }] }],
  material_cents: 225620, labor_cents: 0, subtotal_cents: 225620, overhead_cents: 0, markup_cents: 22562, tax_cents: 0, total_cents: 248182 };
out.xlsx = Buffer.from(C.xlsx_workbook([C.markups_sheet(rows, [{ id: "cc", name: "Cost code" }]), C.estimate_sheet(est)])).toString("base64");
out.qr = [];
for (const [text, lvl] of [["hello", "M"], ["SL1." + "abcdefghij".repeat(30), "L"], ["SL1." + "Zq9-_".repeat(120), "M"], ["x".repeat(700), "L"]]) {
  const q = C.qr_encode(text, lvl);
  out.qr.push({ text, size: q.size, modules: q.modules.map((r) => r.map((c) => (c ? 1 : 0)).join("")) });
}
console.log(JSON.stringify(out));
"""


def run_core():
    script = SCRIPT % (ROOT / "tests" / "js" / "load_core.mjs").as_uri()
    r = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=120, check=True)
    return json.loads(r.stdout)


def test_xlsx_opens_in_a_spreadsheet_reader(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    import base64
    out = run_core()
    p = tmp_path / "takeoff.xlsx"
    p.write_bytes(base64.b64decode(out["xlsx"]))
    wb = openpyxl.load_workbook(p)
    assert wb.sheetnames == ["Markups", "Estimate"]
    ws = wb["Markups"]
    assert [c.value for c in ws[1]][:4] == ["Page", "Sheet", "Type", "Subject"] and ws["A1"].font.bold
    assert ws["D2"].value == "=cmd|' /C calc'!A0" and ws["D2"].data_type == "s"  # text, never a formula
    assert ws["D2"].quotePrefix and not ws["B2"].quotePrefix  # and it stays text when someone edits it
    assert ws["K2"].value == 1200 and ws["M1"].value == "Cost code" and ws["M2"].value == "09 65 19"
    assert ws.freeze_panes == "A2" and ws.auto_filter.ref == "A1:M2"
    est = wb["Estimate"]
    assert est["F2"].value == 145 and est["F2"].number_format.startswith('"$"')
    assert est.cell(row=est.max_row, column=10).value == pytest.approx(2481.82)
    assert not wb.vba_archive
    import zipfile
    names = zipfile.ZipFile(p).namelist()
    assert not [n for n in names if "externalLink" in n or "vba" in n.lower() or "connections" in n]
    assert not any(b"TargetMode=\"External\"" in zipfile.ZipFile(p).read(n) for n in names if n.endswith(".rels"))


def test_qr_codes_decode():
    """OpenCV's detector misses some codes at some module sizes, so each code is drawn at a few
    sizes and must decode at one of them."""
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    for q in run_core()["qr"]:
        n = q["size"]
        grid = np.array([[int(c) for c in row] for row in q["modules"]], dtype=np.uint8)
        assert grid.shape == (n, n)
        found = False
        for scale in (4, 5, 6, 8, 10):
            quiet = 4
            img = np.full(((n + 2 * quiet) * scale,) * 2, 255, np.uint8)
            img[quiet * scale:(quiet + n) * scale, quiet * scale:(quiet + n) * scale] = np.kron(1 - grid, np.ones((scale, scale), np.uint8)) * 255
            text, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
            if text == q["text"]:
                found = True
                break
        assert found, (n, q["text"][:20])
