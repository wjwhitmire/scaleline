"""The auto-takeoff evaluation end to end: the labeled sheets as PDFs, read with pdf.js the way the
app reads them, both cores agreeing, and precision and recall no lower than the README reports."""

import re
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

pytestmark = pytest.mark.skipif(shutil.which("node") is None or not (ROOT / "node_modules" / "pdfjs-dist").is_dir(),
                                reason="needs node and the pdfjs-dist dev dependency (npm ci)")

# Floors under the numbers in the README (vector sheets, then the scan).
FLOOR = {"vector": {"walls": (0.90, 1.00), "rooms": (1.00, 1.00), "doors": (1.00, 1.00), "windows": (1.00, 1.00), "symbols": (0.90, 0.98)},
         "scan": {"walls": (0.90, 1.00), "rooms": (1.00, 1.00), "doors": (1.00, 1.00), "windows": (1.00, 1.00), "symbols": (0.90, 1.00)}}


@pytest.fixture(scope="module")
def rows():
    pytest.importorskip("PIL")
    import autotakeoff_eval as ev
    return ev.evaluate(None)


def test_both_cores_agree_on_every_sheet(rows):
    assert rows and all(r["parity"] == "same" for r in rows), [r["parity"] for r in rows]


@pytest.mark.parametrize("kind", ["vector", "scan"])
def test_precision_and_recall(rows, kind):
    import autotakeoff_eval as ev
    _, tot, tot_scan = ev.table(rows)
    t = tot if kind == "vector" else tot_scan
    for cls, (p_min, r_min) in FLOOR[kind].items():
        p, r = ev.pr(t[cls])
        assert p >= p_min and r >= r_min, (kind, cls, p, r)


def test_door_swings_on_scans_of_every_plan():
    """Door swings read from scans of every labeled plan at 150, 200 and 300 dpi: no wrong door, and
    at least 80% found (the README's sweep)."""
    pytest.importorskip("PIL")
    import autotakeoff_eval as ev
    last = ev.sweep().splitlines()[-1]
    m = re.search(r"P (\d+)% R (\d+)%", last)
    assert m and int(m.group(1)) == 100 and int(m.group(2)) >= 80, last
