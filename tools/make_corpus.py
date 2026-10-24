"""Write the accuracy corpus: synthetic plan sheets whose every dimension is known, in the shapes
real plan sets come in, with a manifest of golden values to measure them against.

Each sheet draws the same small building (40 x 30 ft, split into a 16 ft and a 24 ft room, six
outlet symbols, a 2 ft round column and a 30 degree line) at a printed scale, with a title block that
states the scale. What varies is everything a takeoff tool can get wrong:

  rotated pages      /Rotate 90, 180 and 270, and drawings turned inside the page by the content
                     matrix (cm), alone and combined with /Rotate
  sheet sizes        ARCH D (24 x 36 in), ARCH E (36 x 48 in), ANSI B (11 x 17 in), letter
  page boxes         a MediaBox that does not start at the origin, and a CropBox inside it
  vector-heavy       over 100,000 path operations on one sheet (hatching)
  scans              the sheet as a grayscale picture at 150, 200, 300 and 400 dpi, turned by up to
                     1.5 degrees, with specks
  viewports          a plan at 1/8" = 1'-0" and an enlarged copy at 1/4" = 1'-0" on one sheet, with
                     a /VP viewport dictionary for the enlarged part
  large set          300 sheets (the performance set)
  auto-takeoff       floor plans with ground truth for every wall, room, door, window and symbol
                     (tests/plan_sheets.py): three ordinary sheets, one turned by /Rotate 90, one
                     drawn to be hard (solid fill walls, doors left part open, two-line room names,
                     tags in circles), and a 200 dpi scan; measured by tools/autotakeoff_eval.py

The manifest (corpus/manifest.json) lists, per sheet, the scale and the probes: points in sheet
points (what the viewer shows: origin top left, rotation applied) with the real value each
measurement must give. Sheet points are computed here from the PDF geometry, independently of the
app, the way ISO 32000 defines the page: user space through the CropBox and /Rotate.

Run: python tools/make_corpus.py [--out corpus] [--quick]
--quick writes the small subset the test suite uses. Output is not committed (see .gitignore).
"""

import argparse
import json
import math
import random
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
import pdf_fixtures as fx  # noqa: E402
import plan_sheets  # noqa: E402

FONT = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
SCALES = {  # label: real inches per paper point
    '1/8" = 1\'-0"': 96 / 72, '1/4" = 1\'-0"': 48 / 72, '3/8" = 1\'-0"': 32 / 72, '1/2" = 1\'-0"': 24 / 72,
    '1" = 20\'': 240 / 72, '1" = 10\'': 120 / 72,
}
SIZES = {"letter": (612, 792), "ansi-b": (1224, 792), "arch-d": (2592, 1728), "arch-e": (3456, 2592)}

# The building in plan feet (x right, y up), from its lower left corner.
OUTLETS = [(19, 4), (24, 4), (29, 4), (34, 4), (24, 26), (34, 26)]
COLUMN = (30, 18)  # center x, y in feet; its radius is 1 ft, or 18 pt of paper where that is larger
SYMBOL_R = 4.5  # outlet symbols are drawn at a paper size (points), whatever the scale
SLOPE = ((16, 15), 10, 30)  # start (on the partition), length ft, angle degrees above horizontal


def mat_mul(a, b):
    """a then b (PDF order: the result maps a point through a, then b)."""
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2],
            a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]


def apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def view_matrix(box, rotate):
    """User space to sheet points at scale 1 (ISO 32000 8.3.2.3 and 7.7.3.3): the visible box's top
    left goes to (0, 0), y grows down, and /Rotate turns the page clockwise."""
    x0, y0, x1, y1 = box
    r = rotate % 360
    if r == 0:
        return [1, 0, 0, -1, -x0, y1]
    if r == 90:
        return [0, 1, 1, 0, -y0, -x0]
    if r == 180:
        return [-1, 0, 0, 1, x1, -y0]
    return [0, -1, -1, 0, y1, x1]


class Sheet:
    def __init__(self, name, category, size="arch-d", scale='1/4" = 1\'-0"', rotate=0, ctm=None, media_offset=(0, 0), crop_inset=0,
                 origin=(300, 300), heavy=0, scan=None, viewport=None):
        self.name, self.category, self.scale_label, self.rotate = name, category, scale, rotate
        self.in_per_pt = SCALES[scale]
        w, h = SIZES[size]
        self.size = size
        ox, oy = media_offset
        self.media = [ox, oy, ox + w, oy + h]
        self.crop = [ox + crop_inset, oy + crop_inset, ox + w - crop_inset, oy + h - crop_inset] if crop_inset else None
        self.ctm = ctm or [1, 0, 0, 1, 0, 0]
        self.origin = (ox + origin[0], oy + origin[1])
        self.heavy, self.scan, self.viewport = heavy, scan, viewport

    def symbol_box(self, at):
        """A box around one outlet symbol in sheet points (the symbol is SYMBOL_R points across)."""
        cx, cy = self.ft(*at)
        m = SYMBOL_R * 1.6
        pts = [self.to_sheet(cx + dx, cy + dy) for dx in (-m, m) for dy in (-m, m)]
        return [min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)]

    def column_r(self, ipp=None):
        """The column's radius in feet: 1 ft, or 18 pt of paper on small-scale sheets."""
        return max(1.0, 18 * (ipp or self.in_per_pt) / 12)

    @property
    def box(self):
        return self.crop or self.media

    def ft(self, x, y, base=None, ipp=None):
        """Plan feet to drawing coordinates (before the content matrix)."""
        bx, by = base or self.origin
        k = 12 / (ipp or self.in_per_pt)
        return (bx + x * k, by + y * k)

    def to_sheet(self, x, y):
        u = apply(self.ctm, x, y)
        s = apply(view_matrix(self.box, self.rotate), *u)
        if self.scan:
            s = self.scan_turn(*s)
        return [round(s[0], 3), round(s[1], 3)]

    def scan_turn(self, x, y):
        """Where a sheet point lands after the scanner turned the page by the skew (about its center)."""
        x0, y0, x1, y1 = self.box
        cx, cy = (x1 - x0) / 2, (y1 - y0) / 2
        a = math.radians(self.scan["skew"])
        dx, dy = x - cx, y - cy
        return (cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a))

    # ---- drawing
    def plan_ops(self, base=None, ipp=None, label=True):
        P = lambda x, y: self.ft(x, y, base, ipp)  # noqa: E731
        ops = []
        f = lambda v: f"{v:.3f}"  # noqa: E731
        poly = lambda pts: " ".join(f"{f(a)} {f(b)} {'m' if i == 0 else 'l'}" for i, (a, b) in enumerate(pts))  # noqa: E731
        ops.append("2 w 0 G " + poly([P(0, 0), P(40, 0), P(40, 30), P(0, 30)]) + " h S")
        ops.append(poly([P(16, 0), P(16, 30)]) + " S")
        k = 12 / (ipp or self.in_per_pt)
        for (x, y) in OUTLETS:  # a circle with two ticks, 0.75 ft across
            cx, cy = P(x, y)
            r = SYMBOL_R
            ops.append("1 w " + circle_ops(cx, cy, r) + f" {f(cx - r * 0.4)} {f(cy - r * 0.5)} m {f(cx - r * 0.4)} {f(cy + r * 0.5)} l S"
                       f" {f(cx + r * 0.4)} {f(cy - r * 0.5)} m {f(cx + r * 0.4)} {f(cy + r * 0.5)} l S")
        cx, cy = P(COLUMN[0], COLUMN[1])
        ops.append("1.5 w " + circle_ops(cx, cy, self.column_r(ipp) * k))
        (sx, sy), L, ang = SLOPE
        a, b = P(sx, sy), P(sx + L * math.cos(math.radians(ang)), sy + L * math.sin(math.radians(ang)))
        ops.append(f"1 w {f(a[0])} {f(a[1])} m {f(b[0])} {f(b[1])} l S")
        if label:
            x, y = P(0, -6)
            ops.append(f"BT /F1 14 Tf {f(x)} {f(y)} Td (SCALE: {pdf_text(self.scale_label if ipp is None else label_of(ipp))}) Tj ET")
        return ops

    def content(self):
        ops = []
        a = self.ctm
        ops.append("q " + " ".join(f"{v:.6f}" for v in a) + " cm")
        ops += self.plan_ops()
        if self.viewport:
            vb, vlabel = self.viewport["base"], self.viewport["scale"]
            ops += self.plan_ops(base=vb, ipp=SCALES[vlabel])
        if self.heavy:
            ops.append("0.25 w 0.5 G")
            rnd = random.Random(7)
            x0, y0 = self.ft(0.5, 0.5)
            x1, y1 = self.ft(15.5, 29.5)
            n = 0
            while n < self.heavy:
                t = rnd.random()
                yy = y0 + (y1 - y0) * t
                ops.append(f"{x0:.2f} {yy:.2f} m {x1:.2f} {yy - (x1 - x0) * 0.2:.2f} l S")
                n += 3
        ops.append("Q")
        # title block in plain page space (inside the visible box, lower right)
        bx0, by0, bx1, by1 = self.box
        ops.append(f"BT /F1 30 Tf {bx1 - 200:.1f} {by0 + 60:.1f} Td ({self.name.upper()[:12]}) Tj ET")
        ops.append(f"BT /F1 10 Tf {bx1 - 200:.1f} {by0 + 40:.1f} Td (SCALE: {pdf_text(self.scale_label)}) Tj ET")
        return "\n".join(ops).encode()

    # ---- probes: what to measure and what it must give (real inches, square inches, degrees, items)
    def probes(self):
        S = self.to_sheet
        P = lambda x, y, base=None, ipp=None: S(*self.ft(x, y, base, ipp))  # noqa: E731
        out = [
            {"kind": "length", "pts": [P(0, 0), P(40, 0)], "value": 480.0, "what": "bottom wall, corner to corner"},
            {"kind": "perimeter", "pts": [P(0, 0), P(40, 0), P(40, 30), P(0, 30)], "value": 1680.0, "what": "building outline"},
            {"kind": "area", "pts": [P(16, 0), P(40, 0), P(40, 30), P(16, 30)], "value": 720 * 144.0, "what": "room B on wall centerlines"},
            {"kind": "angle", "pts": [P(16, 7), P(16, 15), P(16 + 8 * math.cos(math.radians(30)), 15 + 8 * math.sin(math.radians(30)))], "value": 120.0,
             "what": "sloped line against the partition below it"},
            {"kind": "diameter", "pts": [P(COLUMN[0] - self.column_r(), COLUMN[1]), P(COLUMN[0] + self.column_r(), COLUMN[1])], "value": 24.0 * self.column_r(), "what": "round column"},
            {"kind": "count", "box": self.symbol_box(OUTLETS[0]), "value": 12 if self.viewport else 6, "what": "outlets (both views)" if self.viewport else "outlets"},
        ]
        # room fill: the clear inside of room B (walls are 2 pt wide on their centerlines), less the
        # round column with its 1.5 pt outline (a cutout); the small outlet symbols count as floor
        wall_in = 2 * self.in_per_pt
        clear = (24 * 12 - wall_in) * (30 * 12 - wall_in)
        col_r = self.column_r() * 12 + 0.75 * self.in_per_pt
        out.append({"kind": "roomfill", "pts": [P(20, 12)], "value": clear - math.pi * col_r ** 2, "what": "room B by click (inside the walls, less the column)"})
        if self.viewport:
            vb, vl = self.viewport["base"], SCALES[self.viewport["scale"]]
            out.append({"kind": "length", "pts": [P(0, 0, vb, vl), P(40, 0, vb, vl)], "value": 480.0, "what": "bottom wall in the enlarged view", "viewport": True})
            out.append({"kind": "area", "pts": [P(16, 0, vb, vl), P(40, 0, vb, vl), P(40, 30, vb, vl), P(16, 30, vb, vl)], "value": 720 * 144.0, "what": "room B in the enlarged view", "viewport": True})
        return out

    def page_dict(self, content_ref):
        box = "/MediaBox [" + " ".join(f"{v:g}" for v in self.media) + "]"
        if self.crop:
            box += " /CropBox [" + " ".join(f"{v:g}" for v in self.crop) + "]"
        return (f"<< /Type /Page /Parent 2 0 R {box} /Rotate {self.rotate} /Contents {content_ref} 0 R "
                f"/Resources << /Font << /F1 3 0 R >> >>{self.viewport_dict()} >>")

    def viewport_dict(self):
        if not self.viewport:
            return ""
        vb, vl = self.viewport["base"], self.viewport["scale"]
        (a0, b0), (a1, b1) = self.ft(-3, -8, vb, SCALES[vl]), self.ft(43, 33, vb, SCALES[vl])
        corners = [apply(self.ctm, a0, b0), apply(self.ctm, a1, b1)]
        xs, ys = [c[0] for c in corners], [c[1] for c in corners]
        ft_per_pt = SCALES[vl] / 12
        return (f" /VP [<< /Type /Viewport /BBox [{min(xs):.2f} {min(ys):.2f} {max(xs):.2f} {max(ys):.2f}] /Name (ENLARGED PLAN) "
                f"/Measure << /Type /Measure /Subtype /RL /R ({pdf_text(vl)}) /X [<< /Type /NumberFormat /U (ft) /C {ft_per_pt:.9f} >>] "
                f"/D [<< /Type /NumberFormat /U (ft) /C 1 >>] /A [<< /Type /NumberFormat /U (sq ft) /C 1 >>] >> >>]")


def label_of(ipp):
    return next(k for k, v in SCALES.items() if abs(v - ipp) < 1e-12)


def pdf_text(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def circle_ops(cx, cy, r):
    k = 0.5522847498 * r
    f = lambda v: f"{v:.3f}"  # noqa: E731
    return (f"{f(cx + r)} {f(cy)} m {f(cx + r)} {f(cy + k)} {f(cx + k)} {f(cy + r)} {f(cx)} {f(cy + r)} c "
            f"{f(cx - k)} {f(cy + r)} {f(cx - r)} {f(cy + k)} {f(cx - r)} {f(cy)} c "
            f"{f(cx - r)} {f(cy - k)} {f(cx - k)} {f(cy - r)} {f(cx)} {f(cy - r)} c "
            f"{f(cx + k)} {f(cy - r)} {f(cx + r)} {f(cy - k)} {f(cx + r)} {f(cy)} c h S")


def box_around(a, b):
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])]


def rot_ctm(deg, about):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    x, y = about
    return [c, s, -s, c, x - c * x + s * y, y - s * x - c * y]


def vector_pdf(sheets):
    objs = {1: b"<< /Type /Catalog /Pages 2 0 R >>", 3: FONT}
    kids = []
    n = 10
    for sh in sheets:
        objs[n] = fx.stream(sh.content())
        objs[n + 1] = sh.page_dict(n).encode()
        kids.append(f"{n + 1} 0 R")
        n += 2
    objs[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode()
    return fx.build_pdf(objs)


def scan_pdf(sh):
    """The sheet as a picture: the vector drawing painted into pixels at the scan's dpi, turned by
    its skew, with specks. Needs Pillow."""
    from PIL import Image, ImageDraw, ImageFont
    dpi, skew = sh.scan["dpi"], sh.scan["skew"]
    x0, y0, x1, y1 = sh.box
    k = dpi / 72
    W, H = round((x1 - x0) * k), round((y1 - y0) * k)
    img = Image.new("L", (W, H), 244)
    d = ImageDraw.Draw(img)
    px = lambda x, y: ((x - x0) * k, (y1 - y) * k)  # noqa: E731
    lw = max(1, round(2 * k))
    P = lambda x, y: px(*sh.ft(x, y))  # noqa: E731
    d.line([P(0, 0), P(40, 0), P(40, 30), P(0, 30), P(0, 0)], fill=15, width=lw, joint="curve")
    d.line([P(16, 0), P(16, 30)], fill=15, width=lw)
    ftk = 12 / sh.in_per_pt * k
    for (x, y) in OUTLETS:
        cx, cy = P(x, y)
        r = SYMBOL_R * k
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=15, width=max(1, round(k)))
        for sx in (-0.4, 0.4):
            d.line([(cx + sx * r, cy - 0.5 * r), (cx + sx * r, cy + 0.5 * r)], fill=15, width=max(1, round(k)))
    cx, cy = P(COLUMN[0], COLUMN[1])
    r = sh.column_r() * ftk
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=15, width=max(1, round(1.5 * k)))
    (sx, sy), L, ang = SLOPE
    d.line([P(sx, sy), P(sx + L * math.cos(math.radians(ang)), sy + L * math.sin(math.radians(ang)))], fill=15, width=max(1, round(k)))

    def font(pt):
        size = max(8, round(pt * k))
        for name in ("DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                pass
        return ImageFont.load_default(size=size)
    d.text(px(x1 - 200, y0 + 90), sh.name.upper()[:12], fill=10, font=font(30))
    d.text(px(x1 - 200, y0 + 52), "SCALE: " + sh.scale_label, fill=10, font=font(12))
    rnd = random.Random(dpi)
    for _ in range(int(W * H / 40000)):
        x, y = rnd.randrange(W - 3), rnd.randrange(H - 3)
        d.rectangle([x, y, x + rnd.randrange(1, 3), y + rnd.randrange(1, 3)], fill=rnd.randrange(40, 140))
    if skew:
        img = img.rotate(-skew, resample=Image.BILINEAR, fillcolor=244)
    data = zlib.compress(img.tobytes(), 6)
    w, h = x1 - x0, y1 - y0
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
        3: FONT,
        4: f"<< /Type /Page /Parent 2 0 R /MediaBox [{x0:g} {y0:g} {x1:g} {y1:g}] /Contents 5 0 R /Resources << /XObject << /Im0 6 0 R >> >> >>".encode(),
        5: fx.stream(f"q {w:g} 0 0 {h:g} {x0:g} {y0:g} cm /Im0 Do Q".encode()),
        6: f"<< /Type /XObject /Subtype /Image /Width {W} /Height {H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length {len(data)} /Filter /FlateDecode >>\nstream\n".encode()
           + data + b"\nendstream",
    }
    return fx.build_pdf(objs)


def corpus(quick=False):
    """[(file name, [Sheet], kind)] for the whole corpus or the quick subset."""
    D = (2592, 1728)
    mid = (D[0] / 2, D[1] / 2)
    rotations = [Sheet(f"R-{r}", "rotated page", rotate=r) for r in (0, 90, 180, 270)]
    ctms = [Sheet("C-30", "turned by the content matrix", ctm=rot_ctm(30, mid), origin=(900, 500)),
            Sheet("C-90R", "content matrix and /Rotate", ctm=rot_ctm(90, mid), rotate=90, origin=(900, 400))]
    boxes = [Sheet("B-OFF", "MediaBox off the origin, CropBox inside", media_offset=(-200, -150), crop_inset=30),
             Sheet("B-CROP", "CropBox inside, rotated", crop_inset=60, rotate=90)]
    sizes = [Sheet("S-LETTER", "letter", size="letter", scale='1" = 20\'', origin=(150, 300)),
             Sheet("S-ANSIB", "ANSI B", size="ansi-b", scale='1/8" = 1\'-0"', origin=(200, 200)),
             Sheet("S-ARCHE", "ARCH E", size="arch-e", scale='3/8" = 1\'-0"', origin=(400, 500))]
    heavy = [Sheet("H-100K", "vector-heavy (over 100,000 path operations)", heavy=110000)]
    views = [Sheet("V-2", "two viewports at different scales", scale='1/8" = 1\'-0"', origin=(200, 300),
                   viewport={"base": (1100, 300), "scale": '1/4" = 1\'-0"'})]
    scans = [Sheet(f"SC-{dpi}", f"scan {dpi} dpi, turned {skew} deg", scale='1/4" = 1\'-0"', scan={"dpi": dpi, "skew": skew})
             for dpi, skew in ((150, 1.5), (200, 0.8), (300, -1.0), (400, 0.4))]
    if quick:
        return [("vector.pdf", rotations + ctms[:2] + boxes[:1] + views, "vector"), ("scan-150.pdf", [scans[0]], "scan")]
    out = [("rotated.pdf", rotations, "vector"), ("content-matrix.pdf", ctms, "vector"), ("page-boxes.pdf", boxes, "vector"),
           ("sizes.pdf", sizes, "vector"), ("vector-heavy.pdf", heavy, "vector"), ("viewports.pdf", views, "vector")]
    out += [(f"scan-{s.scan['dpi']}.pdf", [s], "scan") for s in scans]
    return out


def write(out_dir, quick=False, large=True):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"note": "Golden values: real inches (length, perimeter, diameter), square inches (area, roomfill), degrees (angle), items (count).", "files": []}
    for name, sheets, kind in corpus(quick):
        data = vector_pdf(sheets) if kind == "vector" else scan_pdf(sheets[0])
        (out_dir / name).write_bytes(data)
        manifest["files"].append({"file": name, "kind": kind, "bytes": len(data), "sheets": [
            {"page": i, "name": s.name, "category": s.category, "size": s.size, "rotate": s.rotate, "scale": s.scale_label, "in_per_pt": s.in_per_pt,
             "scan": s.scan, "viewport": s.viewport and {"scale": s.viewport["scale"], "in_per_pt": SCALES[s.viewport["scale"]]}, "probes": s.probes()}
            for i, s in enumerate(sheets)]})
    manifest["files"] += plan_sheets.write_files(out_dir, fx.build_pdf, fx.stream)
    if large and not quick:
        data = fx.plan_set_pdf(300)
        (out_dir / "set-300.pdf").write_bytes(data)
        manifest["files"].append({"file": "set-300.pdf", "kind": "set", "bytes": len(data), "sheets": 300})
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=str(ROOT / "corpus"))
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    m = write(a.out, a.quick)
    for f in m["files"]:
        print(f"{f['file']}: {f['bytes']:,} bytes")


if __name__ == "__main__":
    main()
