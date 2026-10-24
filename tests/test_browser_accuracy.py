"""Golden values: the quick accuracy corpus (rotated pages, content turned by its matrix, an offset
and cropped page box, two viewports at different scales, a scan at 150 dpi turned 1.5 degrees) is
measured with the app's own tools, the way tools/accuracy.py does for the full corpus, and every
measurement type must come within its tolerance."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tests"))
from test_browser import browser, server  # noqa: E402,F401

pytest.importorskip("PIL")
import accuracy  # noqa: E402
import make_corpus  # noqa: E402

# per measurement: tolerance on vector sheets, on the scan (relative, or degrees, or items)
TOL = {
    "scale from title block": (0, 0), "length": (1e-4, 0.01), "perimeter": (1e-4, 0.01), "area": (1e-4, 0.01),
    "angle": (0.01, 1.5), "diameter": (0.005, 0.03), "count": (0, 2), "roomfill": (0.005, 0.005),
    "length (viewport)": (1e-4, None), "area (viewport)": (1e-4, None),
}


@pytest.fixture(scope="module")
def results(browser, server, tmp_path_factory):
    out = tmp_path_factory.mktemp("corpus")
    make_corpus.write(out, quick=True)
    return accuracy.run(out, browser=browser, url=server, log=lambda *a: None)


def test_every_probe_was_measured(results):
    assert results and all(r["error"] is not None for r in results), [r for r in results if r["error"] is None]


@pytest.mark.parametrize("kind", sorted(TOL))
def test_measurements_within_tolerance(results, kind):
    rs = [r for r in results if r["kind"] == kind]
    assert rs, kind
    for r in rs:
        tol = TOL[kind][1 if "scan" in r["category"] else 0]
        if kind == "scale from title block" and "scan" in r["category"] and not accuracy.OCR_DATA.is_file():
            continue  # the scan's title block needs text recognition, whose data comes from npm ci
        assert r["error"] <= tol, (r["sheet"], r["what"] if "what" in r else kind, r["golden"], r["measured"])
    print("\n" + accuracy.table(accuracy.summary(rs)))
