"""Build the browser app.

1. web/app.html: the standalone page (no doctype, html, head or body tags). It starts with
   <title>, then the fonts stylesheet, then <style>, then the body markup and the scripts: the
   pinned pdf.js and pdf-lib builds (checked against their SHA-384 pins), the pdf.js worker
   source and the text engine as inert data, the example plan set as base64, the core
   (web/src/core/*.js in name order) and the interface (web/src/ui/*.js in name order). pdf.js is
   an ES module, so its block and the interface (which needs it) are module scripts; modules run
   in document order.
2. docs/index.html: app.html wrapped as a full HTML document for GitHub Pages, with a
   Content-Security-Policy whose connections are fenced to this site, https and a model server on
   this computer, with the network gate (web/src/ui/12_net.js) allowing only exact addresses behind
   each switch (the text engine's WebAssembly is a separate file, docs/tesseract-core-lstm.wasm,
   fetched from this site only when OCR is used and checked against its pin), a
   guard that refuses to run inside another site's frame, self-hosted fonts, the PWA manifest and
   a service worker that caches the app shell.

The product name comes from src/plantakeoff/brand.py.
Run: python web/build_pages.py
"""

import base64
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src"
VENDOR = ROOT / "web" / "vendor"
APP = ROOT / "web" / "app.html"
DOCS = ROOT / "docs"


def read(p):
    return p.read_text(encoding="utf-8")


def product_name():
    m = re.search(r'^PRODUCT_NAME = "([^"]+)"', read(ROOT / "src" / "plantakeoff" / "brand.py"), re.M)
    return m.group(1)


ICONS = json.loads(read(SRC / "icons.json"))


def icon_svg(name, cls="i"):
    paths = ICONS[name]
    return (f'<svg class="{cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="{paths}"/></svg>')


def expand_icons(html):
    return re.sub(r"\{\{icon:([a-z0-9-]+)\}\}", lambda m: icon_svg(m.group(1)), html)


def vendor(name):
    pins = json.loads(read(VENDOR / "pins.json"))
    pin = pins[name]
    if pin.get("binary"):
        data = (VENDOR / pin["file"]).read_bytes()
        digest = "sha384-" + base64.b64encode(hashlib.sha384(data).digest()).decode()
        if digest != pin["sri"]:
            raise SystemExit(f"{pin['file']} does not match its pinned hash")
        enc = base64.b64encode(data).decode()
        return "\n".join(enc[i:i + 120] for i in range(0, len(enc), 120))
    text = read(VENDOR / pin["file"])
    check = text
    for a, b in pin.get("restore", []):
        check = check.replace(a, b)
    digest = "sha384-" + base64.b64encode(hashlib.sha384(check.encode("utf-8")).digest()).decode()
    if digest != pin["sri"]:
        raise SystemExit(f"{pin['file']} does not match its pinned hash")
    if "</script" in text.lower():
        raise SystemExit(f"{pin['file']} contains '</script'")
    return text.rstrip("\n")


def joined(folder):
    return "\n".join(f"// ---- {p.parent.name}/{p.name}\n" + read(p) for p in sorted(folder.glob("*.js")))


def b64_lines(path):
    data = base64.b64encode(path.read_bytes()).decode()
    return "\n".join(data[i:i + 120] for i in range(0, len(data), 120))


def example_manual():
    text = read(ROOT / "examples" / "example-project-manual.txt")
    if "</script" in text.lower() or "<!--" in text:
        raise SystemExit("the example project manual would end its block early")
    return text


# The on-device model's library: pinned by version and SHA-384 (also enforced by the import map's
# integrity entry), the one script address the policy names.
PROVIDERS_JS = read(SRC / "core" / "27_providers.js")
LOCAL_LIB = re.search(r'lib: "([^"]+)"', PROVIDERS_JS).group(1)
LOCAL_LIB_SRI = re.search(r'libSri: "([^"]+)"', PROVIDERS_JS).group(1)

def build_app():
    name = product_name()
    core = joined(SRC / "core")
    pin = json.loads(read(VENDOR / "pins.json"))["ocrWasm"]
    wasm_pin = {"file": pin["file"], "sri": pin["sri"], "bytes": (VENDOR / pin["file"]).stat().st_size}
    ui = (joined(SRC / "ui").replace("/*ICONS*/", json.dumps(ICONS, sort_keys=True))
          .replace("/*OCR_WASM_PIN*/", json.dumps(wasm_pin, sort_keys=True)))
    for label, js in (("core", core), ("ui", ui)):
        if "</script" in js.lower():
            raise SystemExit(f"the {label} script contains '</script'; it would end the block early")
    t = read(SRC / "app.template.html")
    parts = [
        ("{{NAME}}", name),
        ("/*STYLE*/", read(SRC / "style.css")),
        ("<!--BODY-->", expand_icons(read(SRC / "body.html")).replace("{{NAME}}", name)),
        ("/*PDFJS*/", vendor("pdfjs")),
        ("/*PDFLIB*/", vendor("pdflib")),
        ("/*PDFJS_WORKER*/", vendor("pdfjsWorker")),
        ("/*OCR_CORE*/", vendor("ocrCore")),
        ("/*OCR_WASM*/", vendor("ocrWasm")),
        ("/*EXAMPLE_PDF*/", b64_lines(ROOT / "examples" / "example-plans.pdf")),
        ("/*EXAMPLE_PDF_REV2*/", b64_lines(ROOT / "examples" / "example-plans-rev2.pdf")),
        ("/*EXAMPLE_MANUAL*/", example_manual()),
        ("/*IMPORTMAP*/", json.dumps({"integrity": {LOCAL_LIB: LOCAL_LIB_SRI}})),
        ("/*CORE*/", core),
        ("/*UI*/", ui),
    ]
    for key, val in parts:
        if key not in t:
            raise SystemExit(f"template is missing {key}")
        t = t.replace(key, val.rstrip("\n"), 1 if key != "{{NAME}}" else -1)
    APP.write_text(t, encoding="utf-8")
    return t


# Every library but the text engine's WebAssembly is inside the page and fonts are served with it.
# The one outside address allowed is the OCR language data file and the one file fetched from this
# site is the text engine (both used only when the OCR switch is on). WebAssembly compilation is
# allowed for the text engine, which is checked against its pin before it runs; the engine runs in
# a worker made from a blob, which takes this policy, so the allowance has to be on the page.
# The two model switches add their exact addresses (above); with them off nothing goes there.
# Connections: this site, any https address, and http only to a model server on this computer
# (localhost and 127.0.0.1), because "AI with your own key" goes to whatever service address the
# person types. The policy is the outer fence; the gate in web/src/ui/12_net.js is the one that
# decides: every request goes through net(), which allows only each switch's exact addresses (the
# pinned OCR data, the pinned model files, the one service address set in Settings), and only with
# that switch on. With every switch off the page makes no request at all.
CSP = (
    "default-src 'none'; "
    "script-src {SCRIPT_HASHES} " + LOCAL_LIB + " 'wasm-unsafe-eval'; "
    "worker-src 'self' blob:; "
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; manifest-src 'self'; "
    "form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'"
)

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="referrer" content="no-referrer">
<meta name="description" content="Free plan takeoff and markup: calibrate, measure, count, mark up and estimate from PDF plan sets. Runs on your device; files never leave it.">
<meta name="theme-color" content="#fbfbfc" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#181b1f" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-192.png">
"""

# Framing guard: a page that another site puts in a frame could be used to trick clicks (for example
# on Delete all data), and GitHub Pages cannot send a header that forbids framing (a meta policy cannot
# set frame-ancestors). When framed, the page hides its markup, the interface does not start, and a
# short notice links to the app in its own tab. The script is covered by the policy hash like the others.
FRAME_GUARD = """<script>
(function () {
  var framed = true;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (!framed) return;
  document.documentElement.setAttribute("data-framed", "");
  document.addEventListener("DOMContentLoaded", function () {
    var box = document.createElement("div");
    box.id = "framed";
    var h = document.createElement("h1");
    h.textContent = "This page is shown inside another site.";
    var p = document.createElement("p");
    p.textContent = "For your safety {{NAME}} only runs in its own tab.";
    var a = document.createElement("a");
    a.href = location.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open {{NAME}} in its own tab";
    box.appendChild(h); box.appendChild(p); box.appendChild(a);
    document.body.insertBefore(box, document.body.firstChild);
  });
})();
</script>
<style>html[data-framed] body > :not(#framed){display:none!important}#framed{padding:24px max(16px,env(safe-area-inset-left,0px));font:400 1rem/1.5 system-ui,sans-serif}#framed h1{font-size:1.25rem;margin:0 0 8px}</style>
"""

# One variable file per family: Encode Sans carries both the width and weight axes.
FONT_FACES = "<style>\n" + "\n".join(
    f'@font-face{{font-family:"{fam}";src:url(fonts/{file}) format("woff2");font-weight:{w};{extra}font-display:swap}}'
    for fam, file, w, extra in [
        ("Encode Sans", "encode-sans-latin-standard-normal.woff2", "100 900", "font-stretch:75% 125%;"),
        ("Ubuntu Sans Mono", "ubuntu-sans-mono-latin-wght-normal.woff2", "400 700", ""),
    ]) + "\n</style>"

SW_REG = """<script>
if ("serviceWorker" in navigator && location.protocol === "https:" && !document.documentElement.hasAttribute("data-framed")) {
  try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) {}
}
</script>
"""


# Inline scripts that run: classic ones (no type) and modules. Inert data blocks carry another type.
SCRIPT_RE = r'<script(?![^>]*\bsrc=)(?![^>]*\btype="(?!module"|importmap")[^"]*")[^>]*>(.*?)</script>'


def build_docs(app):
    name = product_name()
    app = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]*>', FONT_FACES, app, count=1)
    # the text engine's WebAssembly goes next to the page instead of inside it
    app, n = re.subn(r'(<script type="application/octet-stream" id="vendor-ocr-wasm">)\n[A-Za-z0-9+/=\n]+\n(</script>)', r"\1\2", app, count=1)
    if n != 1:
        raise SystemExit("the text engine block is missing from the page")
    pin = json.loads(read(VENDOR / "pins.json"))["ocrWasm"]
    wasm = (VENDOR / pin["file"]).read_bytes()
    if "sha384-" + base64.b64encode(hashlib.sha384(wasm).digest()).decode() != pin["sri"]:
        raise SystemExit(f"{pin['file']} does not match its pinned hash")
    style_end = app.index("</style>", app.index("<style>\n")) + len("</style>")
    doc = (HEAD + FRAME_GUARD.replace("{{NAME}}", name) + app[:style_end] + "\n</head>\n<body>\n" + app[style_end:].lstrip("\n") + "\n" + SW_REG
           + "</body>\n</html>\n")
    hashes = []
    for m in re.finditer(SCRIPT_RE, doc, re.S):
        h = "'sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode("utf-8")).digest()).decode() + "'"
        if h not in hashes:
            hashes.append(h)
    # the PDF worker's code, which runs as a module on the page itself when a browser will not run
    # workers made from blob URLs (see probeBlobWorkers in web/src/ui/20_pdf.js)
    wm = re.search(r'<script type="text/plain" id="vendor-pdfjs-worker">(.*?)</script>', doc, re.S)
    if not wm:
        raise SystemExit("the PDF worker block is missing from the page")
    h = "'sha256-" + base64.b64encode(hashlib.sha256(wm.group(1).encode("utf-8")).digest()).decode() + "'"
    if h not in hashes:
        hashes.append(h)
    doc = doc.replace("{CSP}", CSP.replace("{SCRIPT_HASHES}", " ".join(hashes)), 1)
    DOCS.mkdir(exist_ok=True)
    (DOCS / "index.html").write_text(doc, encoding="utf-8")
    (DOCS / pin["file"]).write_bytes(wasm)
    for src in sorted((SRC / "pwa").rglob("*")):
        if src.is_file():
            dst = DOCS / src.relative_to(SRC / "pwa")
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.suffix in (".webmanifest", ".js"):
                dst.write_text(read(src).replace("{{NAME}}", name), encoding="utf-8")
            else:
                dst.write_bytes(src.read_bytes())
    shell = hashlib.sha256(doc.encode("utf-8"))
    for src in sorted((SRC / "pwa").rglob("*")):
        if src.is_file() and src.name != "sw.js":
            shell.update(src.read_bytes())
    sw = DOCS / "sw.js"
    sw.write_text(read(sw).replace('"takeoff-shell-v1"', '"takeoff-shell-' + shell.hexdigest()[:12] + '"'), encoding="utf-8")
    return DOCS / "index.html"


if __name__ == "__main__":
    app = build_app()
    out = build_docs(app)
    print(f"wrote {APP.relative_to(ROOT)} ({APP.stat().st_size:,} bytes) and {out.relative_to(ROOT)}")
