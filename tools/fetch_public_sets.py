"""Download real plan sets that are in the public domain, to try the app on drawings nobody made for
it. Nothing here runs in the test suite, and nothing it downloads is committed (corpus/ is ignored).

Sources are works of the United States government (17 U.S.C. 105):
  flh        plan sheet templates and symbol sheets the Federal Lands Highway divisions publish for
             their projects (vector PDFs)
  habs       measured drawings of the Historic American Buildings Survey at the Library of Congress,
             found through the loc.gov JSON search; these are scans, saved as one PDF per sheet
             (the TIFF wrapped in a PDF page at its scanned size, so the drawing's graphic scale holds)
Add your own with --url (a public PDF you are allowed to use).

Each file is checked (it must be a PDF or an image, under --max-mb), named by its SHA-256, and listed
in corpus/public/sources.json with where it came from, so a run can be repeated and cited.

Run: python tools/fetch_public_sets.py [--source flh] [--source habs --query "floor plan" --limit 5] [--url URL]
"""

import argparse
import hashlib
import io
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "corpus" / "public"
FLH = [
    "https://flh.fhwa.dot.gov/resources/design/plans/cfl/template/documents/sym.pdf",
]
LOC_SEARCH = "https://www.loc.gov/photos/?q={q}&fa=partof:historic+american+buildings+survey&fo=json&c={c}"


def get(url, max_bytes):
    with urllib.request.urlopen(url, timeout=60) as r:
        data = r.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError(f"larger than {max_bytes // 1048576} MB")
    return data


def as_pdf(data, dpi_hint=300):
    """A PDF as is, or an image wrapped in a one-page PDF at its scanned size."""
    if data[:1024].find(b"%PDF") >= 0:
        return data
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    dpi = img.info.get("dpi", (dpi_hint, dpi_hint))[0] or dpi_hint
    buf = io.BytesIO()
    img.convert("L").save(buf, "PDF", resolution=float(dpi))
    return buf.getvalue()


def save(data, url, source, manifest):
    pdf = as_pdf(data)
    h = hashlib.sha256(pdf).hexdigest()
    name = f"{source}-{h[:16]}.pdf"
    (OUT / name).write_bytes(pdf)
    manifest[name] = {"url": url, "source": source, "sha256": h, "bytes": len(pdf)}
    print(f"saved {name} ({len(pdf):,} bytes) from {url}")


def habs_urls(query, limit):
    url = LOC_SEARCH.format(q=urllib.parse.quote_plus(query), c=max(1, min(limit * 3, 100)))
    res = json.loads(get(url, 20 * 1048576))
    out = []
    for item in res.get("results", []):
        for r in item.get("resources", []) or []:
            for key in ("pdf", "image", "large", "url"):
                v = r.get(key)
                if isinstance(v, str) and (v.endswith(".pdf") or v.endswith(".tif") or v.endswith(".jpg")):
                    out.append(v if v.startswith("http") else "https:" + v)
                    break
        if len(out) >= limit:
            break
    return out[:limit]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--source", action="append", choices=["flh", "habs"], default=[])
    ap.add_argument("--query", default="floor plan")
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--url", action="append", default=[])
    ap.add_argument("--max-mb", type=int, default=200)
    a = ap.parse_args()
    if not a.source and not a.url:
        ap.print_help()
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    mpath = OUT / "sources.json"
    manifest = json.loads(mpath.read_text()) if mpath.is_file() else {}
    jobs = [(u, "flh") for u in FLH if "flh" in a.source] + [(u, "url") for u in a.url]
    if "habs" in a.source:
        try:
            jobs += [(u, "habs") for u in habs_urls(a.query, a.limit)]
        except Exception as e:  # the search is a convenience; say why it failed and go on
            print(f"habs search failed: {e}", file=sys.stderr)
    failed = 0
    for url, source in jobs:
        try:
            save(get(url, a.max_mb * 1048576), url, source, manifest)
        except Exception as e:
            failed += 1
            print(f"skipped {url}: {e}", file=sys.stderr)
    mpath.write_text(json.dumps(manifest, indent=1))
    print(f"{len(jobs) - failed} of {len(jobs)} saved to {OUT}")
    return 1 if failed and failed == len(jobs) else 0


if __name__ == "__main__":
    sys.exit(main())
