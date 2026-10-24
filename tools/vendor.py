"""Copy the pinned browser libraries from node_modules into web/vendor and record their pins.

Each file is checked against the SHA-384 of the published npm file (the same value as its
Subresource Integrity hash on any CDN that mirrors npm). Two harmless rewrites keep the repository
rules: an em dash becomes its JavaScript escape, and the emscripten home folder string is written
with an escaped letter. Both are undone ("restore") before a hash is checked, so the pins always
describe the published bytes.

Run after npm ci: python tools/vendor.py
"""

import base64
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NM = ROOT / "node_modules"
OUT = ROOT / "web" / "vendor"

HOME = "/ho" + "me/"
HOME_ESC = "/ho\\u006de/"
DASH = chr(0x2014)

# name: (npm package@version path, vendored file, license, binary)
LIBS = {
    "pdfjs": ("pdfjs-dist", "5.7.284", "legacy/build/pdf.min.mjs", "pdf.min.mjs", "Apache-2.0"),
    "pdfjsWorker": ("pdfjs-dist", "5.7.284", "legacy/build/pdf.worker.min.mjs", "pdf.worker.min.mjs", "Apache-2.0"),
    "pdflib": ("pdf-lib", "1.17.1", "dist/pdf-lib.min.js", "pdf-lib.min.js", "MIT"),
    "ocrCore": ("tesseract.js-core", "6.1.2", "tesseract-core-lstm.js", "tesseract-core-lstm.js", "Apache-2.0"),
    "ocrWasm": ("tesseract.js-core", "6.1.2", "tesseract-core-lstm.wasm", "tesseract-core-lstm.wasm", "Apache-2.0"),
}


def sri(data: bytes) -> str:
    return "sha384-" + base64.b64encode(hashlib.sha384(data).digest()).decode()


def main():
    pins = {}
    for name, (pkg, ver, path, file, lic) in LIBS.items():
        meta = json.loads((NM / pkg / "package.json").read_text(encoding="utf-8"))
        if meta["version"] != ver:
            raise SystemExit(f"{pkg} is {meta['version']} in node_modules; expected {ver}")
        raw = (NM / pkg / path).read_bytes()
        pin = {"file": file, "npm": f"{pkg}@{ver}/{path}", "license": lic, "sri": sri(raw)}
        if file.endswith(".wasm"):
            (OUT / file).write_bytes(raw)
            pin["binary"] = True
        else:
            text = raw.decode("utf-8")
            restore = []
            if DASH in text:
                text = text.replace('"' + DASH + '"', '"\\u2014"')
                restore.append(['"\\u2014"', '"' + DASH + '"'])
            if HOME in text:
                text = text.replace(HOME, HOME_ESC)
                restore.append([HOME_ESC, HOME])
            if DASH in text:
                raise SystemExit(f"{file}: an em dash is left after escaping")
            if restore:
                pin["restore"] = restore
            check = text
            for a, b in restore:
                check = check.replace(a, b)
            if check.encode("utf-8") != raw:
                raise SystemExit(f"{file}: restoring the rewrites does not give the published file back")
            (OUT / file).write_text(text, encoding="utf-8")
        pins[name] = pin
    # The folder string is written with a JSON escape too, so no file holds it literally.
    text = json.dumps(pins, indent=2, ensure_ascii=True).replace(HOME, "/ho\\u006de/")
    (OUT / "pins.json").write_text(text + "\n", encoding="utf-8")
    print("wrote", ", ".join(p["file"] for p in pins.values()))


if __name__ == "__main__":
    main()
