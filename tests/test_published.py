"""The page as it is published: the ship step fills https://wjwhitmire.github.io/scaleline/, wjwhitmire and https://github.com/wjwhitmire/scaleline
in every file, and GitHub Pages serves docs/ over https under /NAME/. Fill a copy the same way,
check every fingerprinted script still matches the page policy, then load it from an https
address with service workers allowed. The page must start with no errors and no policy refusals
(the service worker registration included, which only happens over https)."""
import base64
import hashlib
import mimetypes
import re
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
NAME = "scaleline"
ORIGIN = "https://example.github.io"
FILL = {"https://wjwhitmire.github.io/scaleline/": f"{ORIGIN}/{NAME}/", "wjwhitmire": "example", "https://github.com/wjwhitmire/scaleline": f"https://github.com/example/{NAME}"}
DATA_TYPES = re.compile(r'type="(text/plain|application/octet-stream|application/json)"')


def _filled_site(tmp_path):
    site = tmp_path / NAME
    shutil.copytree(ROOT / "docs", site)
    for f in site.rglob("*"):
        if not f.is_file():
            continue
        raw = f.read_bytes()
        if b"{{" not in raw:
            continue
        for k, v in FILL.items():
            raw = raw.replace(k.encode(), v.encode())
        f.write_bytes(raw)
    return site


def test_filled_page_keeps_its_script_fingerprints(tmp_path):
    html = (_filled_site(tmp_path) / "index.html").read_text(encoding="utf-8")
    head = html[: html.index("</head>")]
    policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', head).group(1)
    allowed = set(re.findall(r"'(sha256-[A-Za-z0-9+/=]+)'", policy.split("script-src", 1)[1].split(";", 1)[0]))
    for attrs, body in re.findall(r"<script([^>]*)>(.*?)</script>", html, re.S):
        if "src=" in attrs or DATA_TYPES.search(attrs):
            continue
        digest = "sha256-" + base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode()
        assert digest in allowed, f"inline script {attrs.strip() or '(plain)'} no longer matches the page policy"
    worker = policy.split("worker-src", 1)[1].split(";", 1)[0] if "worker-src" in policy else ""
    if (ROOT / "docs" / "sw.js").exists() and worker:
        assert "'self'" in worker, "the policy would refuse the service worker"


def test_filled_page_starts_over_https(tmp_path):
    api = pytest.importorskip("playwright.sync_api")
    site = _filled_site(tmp_path)
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    mimetypes.add_type("application/wasm", ".wasm")

    def serve(route):
        rel = route.request.url.split(f"{ORIGIN}/{NAME}/", 1)[-1].split("?", 1)[0].split("#", 1)[0] or "index.html"
        f = site / rel
        if f.is_file():
            route.fulfill(status=200, body=f.read_bytes(), content_type=mimetypes.guess_type(f.name)[0] or "application/octet-stream")
        else:
            route.fulfill(status=404, body="")

    with api.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # noqa: BLE001
            pytest.skip(f"Chromium is not available: {e}")
        try:
            ctx = b.new_context(service_workers="allow")
            ctx.route(f"{ORIGIN}/**", serve)
            ctx.add_init_script("window.__refused = []; document.addEventListener('securitypolicyviolation', e => window.__refused.push(e.violatedDirective + ' ' + e.blockedURI));")
            pg = ctx.new_page()
            errors, refused = [], []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: refused.append(m.text) if "Content Security Policy" in m.text else None)
            pg.goto(f"{ORIGIN}/{NAME}/")
            pg.wait_for_function("() => document.body.dataset.ready === '1'", timeout=60000)
            pg.wait_for_timeout(1500)
            refused += pg.evaluate("window.__refused")
            assert not errors, errors
            assert not refused, refused
            ctx.close()
        finally:
            b.close()
