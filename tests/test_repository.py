"""Repository rules: banned words, no em dashes, no local paths, the product name in one place,
and vendored libraries that match their pinned hashes. There are no exemptions for any name."""

import base64
import hashlib
import json
import re
from pathlib import Path

from plantakeoff.brand import PRODUCT_NAME

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".pytest_cache", "build", "dist"}


def repo_files():
    for p in ROOT.rglob("*"):
        if p.is_file() and not (SKIP_DIRS & set(p.relative_to(ROOT).parts)) and ".egg-info" not in str(p):
            yield p


# The words are kept as the first 16 hex digits of the SHA-256 of each lower-case word, so this file
# does not hold them. No exemption: they may appear in no file of the repository.
BANNED = {"c857d09db23e6822", "4efbad042be85b7a", "60965168ce762e94", "7d3194f79e645c42", "3ea125d0bff386e6"}
# Words kept out of our own prose (vendored libraries are not ours to edit).
BANNED_PROSE = {"b7ad567477c83756", "c44c9304b8a61f9c", "29a8825bd242f143", "9b42869e16304884", "d4f0bc5a29de06b5", "8c70b25cbbbe8e79",
                "d4f02eaafd1a9e9d", "7846086ae9fcf5a5"}
# Note files for coding tools: a Markdown file whose name is one of these words.
NOTES = {"c857d09db23e6822", "8c70b25cbbbe8e79"}


def digest(word):
    return hashlib.sha256(word.lower().encode("utf-8")).hexdigest()[:16]


def hits(text, words):
    # "X-compatible" (an API standard many services and local servers speak) is one word, not a name
    return sorted(w for w in set(re.findall(r"\w+(?:-compatible\b)?", text)) if digest(w) in words)


def test_repository_rules():
    banned = re.compile(r"\bAI[- ]generated\b|\bAI[- ]assist|\u2014", re.I)
    for p in repo_files():
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        assert banned.search(text) is None, f"{p}: banned text"
        assert not hits(text, BANNED), f"{p}: a banned name"
        if "vendor" not in p.parts and p.name != "package-lock.json":
            # Built pages embed the vendored libraries; check only our own parts of them.
            own = re.sub(r'<script[^>]*id="vendor-[^"]*"[^>]*>.*?</script>', "", text, flags=re.S)
            assert not hits(own, BANNED_PROSE), f"{p}: a banned word"
        assert ("/ho" + "me/") not in text, str(p)
    for p in ROOT.rglob("*"):
        if p.suffix.lower() == ".md" and not (SKIP_DIRS & set(p.relative_to(ROOT).parts)):
            assert digest(p.stem) not in NOTES, str(p)


def test_product_name_lives_in_one_place():
    allowed = {"brand.py", "00_brand.js", "test_repository.py", "vectors.json"}
    for p in repo_files():
        rel = p.relative_to(ROOT).as_posix()
        if not (rel.startswith("src/") or rel.startswith("web/src/core/") or rel.startswith("tests/")):
            continue
        if p.suffix in (".py", ".js", ".mjs", ".json") and p.name not in allowed:
            assert re.search(r"\b" + PRODUCT_NAME + r"\b", p.read_text(encoding="utf-8", errors="ignore")) is None, str(p)


def test_js_brand_matches():
    js = (ROOT / "web" / "src" / "core" / "00_brand.js").read_text(encoding="utf-8")
    assert f'PRODUCT_NAME = "{PRODUCT_NAME}"' in js


def test_vendored_libraries_match_pins():
    pins = json.loads((ROOT / "web" / "vendor" / "pins.json").read_text(encoding="utf-8"))
    for name, pin in pins.items():
        path = ROOT / "web" / "vendor" / pin["file"]
        if pin.get("binary"):
            raw = path.read_bytes()
        else:
            data = path.read_text(encoding="utf-8")
            for a, b in pin.get("restore", []):
                data = data.replace(a, b)
            raw = data.encode("utf-8")
        digest = "sha384-" + base64.b64encode(hashlib.sha384(raw).digest()).decode()
        assert digest == pin["sri"], name


def test_colors_live_only_in_the_token_blocks():
    """The stylesheet names colors only in its theme and sheet token blocks; scripts name none."""
    css = (ROOT / "web" / "src" / "style.css").read_text(encoding="utf-8")
    head, sep, rest = css.partition(":root{--paper:")
    assert sep, "the sheet token block is missing"
    rest = rest.split("}", 1)[1]
    assert ':root:not([data-theme="light"])' in head and ':root[data-theme="dark"]' in head and "prefers-color-scheme: dark" in head
    color = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(")
    assert color.search(rest) is None, color.search(rest)
    literal = re.compile(r"[\"'`]#[0-9a-fA-F]{3,8}[\"'`]|\brgba?\(\s*\d|\bhsla?\(\s*\d")
    for p in sorted((ROOT / "web" / "src").glob("*/*.js")):
        hit = literal.search(p.read_text(encoding="utf-8"))
        assert hit is None, f"{p.name}: {hit.group(0) if hit else ''}"
