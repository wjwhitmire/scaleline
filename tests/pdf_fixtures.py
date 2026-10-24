"""PDF files for tests, written by hand so every byte is known: hostile files (scripts, lies about
page counts, garbage), giant pages, and large plan sets for the performance check.

Run as a script to write a large set: python tests/pdf_fixtures.py 300 out.pdf
"""

import math
import sys
import zlib


def build_pdf(objects, root=1, compress=False):
    """objects: {number: bytes body}. Returns a PDF with a correct cross-reference table."""
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        out += f"{num} 0 obj\n".encode() + objects[num] + b"\nendobj\n"
    xref = len(out)
    n = max(objects) + 1
    out += f"xref\n0 {n}\n".encode() + b"0000000000 65535 f \n"
    for i in range(1, n):
        out += (f"{offsets[i]:010d} 00000 n \n" if i in offsets else "0000000000 65535 f \n").encode()
    out += f"trailer\n<< /Size {n} /Root {root} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def stream(data, compress=True):
    if compress:
        z = zlib.compress(data)
        return f"<< /Length {len(z)} /Filter /FlateDecode >>\nstream\n".encode() + z + b"\nendstream"
    return f"<< /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream"


FONT = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"


def script_pdf():
    """One page with JavaScript everywhere a viewer might run it: open action, document scripts,
    page and document additional actions, a full-page link and a form field."""
    js = b"<< /S /JavaScript /JS (app.alert\\('script ran'\\); this.submitForm\\('https://example.invalid/'\\); this.print\\(\\);) >>"
    content = b"BT /F1 24 Tf 72 700 Td (A PDF that carries scripts) Tj ET"
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R /Names << /JavaScript << /Names [(doc) 4 0 R] >> >> "
           b"/AA << /WC 4 0 R /WS 4 0 R /DS 4 0 R /WP 4 0 R /DP 4 0 R >> /AcroForm << /Fields [7 0 R] >> >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 8 0 R >> >> "
           b"/Annots [6 0 R 7 0 R] /AA << /O 4 0 R /C 4 0 R >> >>",
        4: js,
        5: stream(content, compress=False),
        6: b"<< /Type /Annot /Subtype /Link /Rect [0 0 612 792] /A 4 0 R >>",
        7: b"<< /Type /Annot /Subtype /Widget /FT /Tx /T (field) /Rect [72 600 300 630] /P 3 0 R /AA << /K 4 0 R /F 4 0 R /Fo 4 0 R >> >>",
        8: FONT,
    }
    return build_pdf(objs)


def page_count_pdf(n):
    """n real pages sharing one content stream."""
    kids = " ".join(f"{i} 0 R" for i in range(10, 10 + n))
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode(),
        3: stream(b"BT /F1 12 Tf 72 700 Td (page) Tj ET"),
        4: FONT,
    }
    for i in range(n):
        objs[10 + i] = b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 3 0 R /Resources << /Font << /F1 4 0 R >> >> >>"
    return build_pdf(objs)


def lying_count_pdf():
    """A page tree that claims a million pages but holds one."""
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1000000 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
    }
    return build_pdf(objs)


def giant_page_pdf():
    """One page 200 x 200 inches (the largest a PDF allows) with a few lines."""
    content = b"4 w 0 0 m 14400 14400 l S 14400 0 m 0 14400 l S 100 100 14200 14200 re S"
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 14400 14400] /Contents 4 0 R >>",
        4: stream(content),
    }
    return build_pdf(objs)


def garbage_pdf(seed=7, size=20000):
    import random
    rng = random.Random(seed)
    return b"%PDF-1.7\n" + bytes(rng.randrange(256) for _ in range(size))


def truncated_pdf():
    whole = script_pdf()
    return whole[: len(whole) // 2]


def nested_pdf(depth=100000):
    """A content stream and an object with absurd nesting."""
    deep = b"[" * depth + b"]" * depth
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R /Bomb 4 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>",
        4: deep,
        5: stream(b"q " * 5000 + b"0 0 m 100 100 l S" + b" Q" * 5000),
    }
    return build_pdf(objs)


def _image_xobject(w, h, seed):
    import random
    rng = random.Random(seed)
    rows = []
    for y in range(h):
        base = (y * 255) // h
        rows.append(bytes((base + (x * 7) % 64 + rng.randrange(24)) % 256 for x in range(w)))
    data = zlib.compress(b"".join(rows), 6)
    return (f"<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceGray /BitsPerComponent 8 "
            f"/Length {len(data)} /Filter /FlateDecode >>\nstream\n").encode() + data + b"\nendstream"


def plan_set_pdf(n, heavy=False):
    """A large invented plan set: n sheets (36 x 24 in) of floor plans with walls, doors, text and a
    title block, each a little different, for the performance check. heavy=True adds about 12,000
    hatch segments per sheet and a shared 1600 x 1000 scanned-image underlay."""
    W, H = 36 * 72, 24 * 72
    objs = {1: b"<< /Type /Catalog /Pages 2 0 R >>", 4: FONT, 5: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"}
    if heavy:
        objs[6] = _image_xobject(1600, 1000, 3)
    kids = []
    for i in range(n):
        ops = [b"2 w 36 36 %d %d re S" % (W - 72, H - 72), b"1 w %d 36 m %d %d l S" % (W - 360, W - 360, H - 36)]
        # a grid of rooms: walls as filled rectangles
        cols, rows = 6 + i % 4, 4 + i % 3
        x0, y0, cw, rh = 150, 200, 300, 260
        for r in range(rows + 1):
            ops.append(b"0 g %d %d %d 8 re f" % (x0, y0 + r * rh, cols * cw + 8))
        for c in range(cols + 1):
            ops.append(b"0 g %d %d 8 %d re f" % (x0 + c * cw, y0, rows * rh + 8))
        for r in range(rows):
            for c in range(cols):
                cx, cy = x0 + c * cw + 60, y0 + r * rh + 8
                ops.append(b"1 w %d %d m %d %d l S" % (cx, cy, cx, cy + 54))
                ops.append(b"%d %d m %.1f %.1f %.1f %.1f %d %d c S" % (cx, cy + 54, cx + 30, cy + 54, cx + 54, cy + 30, cx + 54, cy))
                ops.append(b"BT /F1 10 Tf %d %d Td (ROOM %d%02d) Tj ET" % (x0 + c * cw + 110, y0 + r * rh + 130, i + 1, r * cols + c + 1))
        if heavy:
            ops.insert(0, b"q 700 0 0 440 1400 1150 cm /Im1 Do Q")
            for r in range(rows):
                for c in range(cols):
                    bx, by = x0 + c * cw + 8, y0 + r * rh + 8
                    seg = [b"0.3 w"]
                    for k in range(0, cw + rh - 16, 6):
                        x1, y1 = bx + min(k, cw - 8), by + max(0, k - (cw - 8))
                        x2, y2 = bx + max(0, k - (rh - 8)), by + min(k, rh - 8)
                        seg.append(b"%d %d m %d %d l" % (x1, y1, x2, y2))
                    seg.append(b"S")
                    ops.append(b" ".join(seg))
        ops.append(b"BT /F1 8 Tf %d 200 Td (SCALE) Tj ET" % (W - 340))
        ops.append(b"BT /F1 11 Tf %d 185 Td (1/8\" = 1'-0\") Tj ET" % (W - 340))
        ops.append(b"BT /F1 9 Tf %d 260 Td (SHEET TITLE) Tj ET" % (W - 340))
        ops.append(b"BT /F2 18 Tf %d 238 Td (FLOOR PLAN LEVEL %d) Tj ET" % (W - 340, i + 1))
        ops.append(b"BT /F2 40 Tf %d 80 Td (A-%d) Tj ET" % (W - 340, 101 + i))
        ops.append(b"BT /F1 12 Tf %d %d Td (EXAMPLE DATA: invented large plan set for performance testing) Tj ET" % (W - 340, H - 80))
        cnum, pnum = 10 + 2 * i, 11 + 2 * i
        objs[cnum] = stream(b"\n".join(ops))
        xo = " /XObject << /Im1 6 0 R >>" if heavy else ""
        objs[pnum] = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Contents {cnum} 0 R "
                      f"/Resources << /Font << /F1 4 0 R /F2 5 0 R >>{xo} >> >>").encode()
        kids.append(f"{pnum} 0 R")
    objs[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {n} >>".encode()
    return build_pdf(objs)


if __name__ == "__main__":
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    path = sys.argv[2] if len(sys.argv) > 2 else "large-plan-set.pdf"
    data = plan_set_pdf(count, heavy="--heavy" in sys.argv)
    with open(path, "wb") as f:
        f.write(data)
    print(f"wrote {path}: {count} sheets, {len(data):,} bytes")


# ---------------------------------------------------------------- realistic sheets for measuring
# A 40 x 30 ft building at 1/4" = 1'-0" (720 x 540 pt) with its lower left corner at (100, 100) in
# user space, a 4 x 6 ft shaft (72 x 108 pt) at (400, 300), five outlet circles, and a title block
# with the scale note. Hand value: 1,200 - 24 = 1,176 SF net.
BUILDING = [[100, 100], [820, 100], [820, 640], [100, 640]]
SHAFT = [[400, 300], [472, 300], [472, 408], [400, 408]]


def _plan_content(w, sheet, prefix=b""):
    ops = [prefix, b"4 w 100 100 720 540 re S 2 w 400 300 72 108 re S 1 w"]
    for i in range(5):
        x, y = 180 + i * 130, 140
        ops.append(f" {x - 6} {y - 6} 12 12 re S {x - 3} {y - 2} m {x - 3} {y + 2} l S {x + 3} {y - 2} m {x + 3} {y + 2} l S".encode())
    ops.append(f" BT /F1 22 Tf {w - 216} 86 Td ({sheet}) Tj ET BT /F1 9 Tf {w - 216} 65 Td (SCALE: 1/4\" = 1'-0\") Tj ET".encode())
    return b"".join(ops)


def rotated_set_pdf():
    """Eight sheets: rotations 0, 90, 180, 270; an 11 x 17 and a letter page; a page whose MediaBox
    starts at (-200, -150) with a CropBox inside it; and a page whose drawing opens with an unclosed
    q and a 0.5 cm, as some CAD exports do (it shows at half size). Page 6 is that CAD page."""
    pages = [  # (width, height, rotate, sheet, media offset, crop inset, content prefix)
        (2592, 1728, 0, "A-101", None, None, b""), (2592, 1728, 90, "A-102", None, None, b""),
        (2592, 1728, 180, "A-103", None, None, b""), (2592, 1728, 270, "A-104", None, None, b""),
        (1224, 792, 0, "A-105", None, None, b""), (612, 792, 0, "A-106", None, None, b"q 0.5 0 0 0.5 0 0 cm\n"),
        (2592, 1728, 0, "A-107", (-200, -150), 30, b""), (1728, 2592, 90, "A-108", None, None, b""),
    ]
    objs = {1: b"", 2: b"", 3: FONT}
    kids = []
    n = 4
    for w, h, rot, sheet, off, inset, prefix in pages:
        x0, y0 = off or (0, 0)
        box = f"/MediaBox [{x0} {y0} {x0 + w} {y0 + h}]"
        if inset:
            box += f" /CropBox [{x0 + inset} {y0 + inset} {x0 + w - inset} {y0 + h - inset}]"
        tw = (x0 + w - inset) if inset else w
        objs[n] = stream(_plan_content(tw, sheet, prefix))
        objs[n + 1] = (f"<< /Type /Page /Parent 2 0 R {box} /Rotate {rot} /Contents {n} 0 R "
                       f"/Resources << /Font << /F1 3 0 R >> >> >>").encode()
        kids.append(f"{n + 1} 0 R")
        n += 2
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objs[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode()
    return build_pdf(objs)


def scanned_sheet_pdf(dpi=100):
    """A 24 x 18 in sheet that is only a grayscale picture (a scan): the same building drawn into the
    pixels with 4 pt walls drawn inward from the outline, no text and no line work."""
    W, H = 24 * dpi, 18 * dpi
    k = dpi / 72
    img = bytearray(b"\xf8" * (W * H))

    def box(x0, y0, x1, y1, t):  # user-space rectangle, wall thickness t pt drawn inward
        X0, X1 = round(x0 * k), round(x1 * k)
        Y0, Y1 = H - round(y1 * k), H - round(y0 * k)
        T = max(1, round(t * k))
        for y in range(Y0, Y1):
            row = y * W
            if y < Y0 + T or y >= Y1 - T:
                img[row + X0:row + X1] = b"\x0a" * (X1 - X0)
            else:
                img[row + X0:row + X0 + T] = b"\x0a" * T
                img[row + X1 - T:row + X1] = b"\x0a" * T

    box(100, 100, 820, 640, 4)
    box(400, 300, 472, 408, 2)
    for i in range(5):
        x, y = 180 + i * 130, 140
        box(x - 5, y - 5, x + 5, y + 5, 1.5)
    data = zlib.compress(bytes(img))
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1728 1296] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>",
        4: stream(b"q 1728 0 0 1296 0 0 cm /Im0 Do Q"),
        5: f"<< /Type /XObject /Subtype /Image /Width {W} /Height {H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length {len(data)} /Filter /FlateDecode >>\nstream\n".encode()
           + data + b"\nendstream",
    }
    return build_pdf(objs)


def font_matrix_pdf():
    """The pdf.js font matrix injection (CVE-2024-4367, fixed upstream in 4.2.67): an embedded Type1
    font whose dictionary FontMatrix carries JavaScript, drawn with text render mode 7 so pdf.js builds
    glyph outlines. With eval allowed, pdf.js 3.11.174 runs it once per glyph; with isEvalSupported
    false it never runs. The program's own FontMatrix is blanked so the dictionary value is used.
    Needs reportlab and pypdf (dev dependencies)."""
    import io
    import os
    import re
    import reportlab
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, ByteStringObject, FloatObject, NameObject, NumberObject
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfgen import canvas

    fd = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
    face = pdfmetrics.EmbeddedType1Face(os.path.join(fd, "DarkGardenMK.afm"), os.path.join(fd, "DarkGardenMK.pfb"))
    pdfmetrics.registerTypeFace(face)
    pdfmetrics.registerFont(pdfmetrics.Font("FMX", face.name, "WinAnsiEncoding"))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(612, 792))
    t = c.beginText(72, 700)
    t.setFont("FMX", 36)
    t.setTextRenderMode(7)
    t.textLine("Plan notes")
    c.drawText(t)
    c.showPage()
    c.save()
    w = PdfWriter(clone_from=PdfReader(io.BytesIO(buf.getvalue())))
    for f in w.pages[0]["/Resources"]["/Font"].values():
        f = f.get_object()
        if "/FontDescriptor" not in f:
            continue
        f[NameObject("/FontMatrix")] = ArrayObject([FloatObject(0.001), NumberObject(0), NumberObject(0), FloatObject(0.001), NumberObject(0),
                                                    ByteStringObject(b"0); window.__fontMatrixRan = (window.__fontMatrixRan || 0) + 1; //")])
        ff = f["/FontDescriptor"].get_object()["/FontFile"].get_object()
        d = ff.get_data()
        m = re.search(rb"/FontMatrix\s*\[[^\]]*\]\s*readonly\s+def", d)
        if m:
            d = d[:m.start()] + b" " * (m.end() - m.start()) + d[m.end():]
        ff.set_data(d)
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def scanned_text_pdf(dpi=200, skew=1.2, seed=3):
    """A 24 x 18 in sheet scanned at `dpi` and turned `skew` degrees: walls, a title block in the
    lower right (sheet number, title, scale note) and a few hundred ink specks. Only pixels, no text
    layer. Needs Pillow."""
    import random

    from PIL import Image, ImageDraw, ImageFont

    W, H = 24 * dpi, 18 * dpi
    k = dpi / 72
    img = Image.new("L", (W, H), 246)
    d = ImageDraw.Draw(img)

    def font(pt):
        size = max(8, round(pt * k))
        for name in ("DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                pass
        return ImageFont.load_default(size=size)

    def P(x, y):  # sheet points, origin top left
        return (round(x * k), round(y * k))

    t = max(2, round(4 * k))
    d.rectangle([P(100, 100), P(1100, 900)], outline=12, width=t)
    d.line([P(600, 100), P(600, 900)], fill=12, width=t)
    d.line([P(100, 500), P(600, 500)], fill=12, width=t)
    # title block
    d.rectangle([P(1340, 1000), P(1700, 1270)], outline=12, width=max(1, round(1.5 * k)))
    d.text(P(1360, 1020), "FIRST FLOOR PLAN", fill=10, font=font(22))
    d.text(P(1360, 1080), "SCALE: 1/4\" = 1'-0\"", fill=10, font=font(16))
    d.text(P(1360, 1130), "SHEET", fill=10, font=font(12))
    d.text(P(1360, 1160), "A-101", fill=10, font=font(48))
    rnd = random.Random(seed)
    for _ in range(400):
        x, y = rnd.randrange(W - 3), rnd.randrange(H - 3)
        d.rectangle([x, y, x + rnd.randrange(1, 3), y + rnd.randrange(1, 3)], fill=rnd.randrange(30, 120))
    if skew:
        img = img.rotate(-skew, resample=Image.BILINEAR, fillcolor=246)
    data = zlib.compress(img.tobytes())
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1728 1296] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>",
        4: stream(b"q 1728 0 0 1296 0 0 cm /Im0 Do Q"),
        5: f"<< /Type /XObject /Subtype /Image /Width {W} /Height {H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length {len(data)} /Filter /FlateDecode >>\nstream\n".encode()
           + data + b"\nendstream",
    }
    return build_pdf(objs)


def _measure(label, ft_per_pt):
    return (f"<< /Type /Measure /Subtype /RL /R ({label}) /X [<< /Type /NumberFormat /U (ft) /C {ft_per_pt:.9f} /D 100 >>] "
            f"/D [<< /Type /NumberFormat /U (ft) /C 1 >> << /Type /NumberFormat /U (in) /C 12 >>] /A [<< /Type /NumberFormat /U (sq ft) /C 1 >>] >>")


def measured_markups_pdf():
    """One 24 x 18 in sheet with measurement markups shaped the way a widely used takeoff program
    writes them, built only from the ISO 32000 annotation and measurement dictionaries: /IT intents,
    a /Measure on each measurement (1/4" = 1'-0", so 1 pt is 1/18 ft), counts as one small polygon per
    item sharing a subject, a viewport (/VP) at 1 1/2" = 1'-0", and a note and a link that are not
    markups. Coordinates are PDF user space (origin bottom left)."""
    q = _measure('1/4" = 1\'-0"', 1 / 18)
    d = _measure('1 1/2" = 1\'-0"', 1 / 108)
    H = 1296
    annots = [
        # 300 pt line: 16 ft 8 in
        f"<< /Type /Annot /Subtype /Line /IT /LineDimension /Rect [96 996 404 1004] /L [100 1000 400 1000] /C [1 0 0] /BS << /W 2 >> "
        f"/Subj (Length Measurement) /T (Ana) /Contents (16'-8\") /NM (bb-1) /M (D:20261001120000Z) /Measure {q} >>",
        # 360 x 180 pt: 20 ft x 10 ft = 200 SF
        f"<< /Type /Annot /Subtype /Polygon /IT /PolygonDimension /Rect [96 596 464 784] /Vertices [100 600 460 600 460 780 100 780] "
        f"/C [0 0 1] /IC [0 0 1] /CA 0.4 /Subj (Area Measurement) /Contents (200.00 sf) /NM (bb-2) /Measure {q} >>",
        # polylength 0,0 to 180,0 to 180,90: 10 ft + 5 ft = 15 ft
        f"<< /Type /Annot /Subtype /PolyLine /IT /PolyLineDimension /Rect [496 396 684 494] /Vertices [500 400 680 400 680 490] "
        f"/C [0 0.5 0] /Subj (Polylength Measurement) /NM (bb-3) /Measure {q} >>",
        # circle 72 pt across: 4 ft diameter
        f"<< /Type /Annot /Subtype /Circle /IT /CircleDimension /Rect [799 299 873 373] /RD [1 1 1 1] /C [0.5 0 0.5] /BS << /W 2 >> "
        f"/Subj (Diameter Measurement) /NM (bb-4) /Measure {q} >>",
        f"<< /Type /Annot /Subtype /FreeText /IT /FreeTextCallout /Rect [880 880 1100 960] /RD [80 20 2 2] /CL [882 882 960 930 960 930] "
        f"/Contents (Verify slab edge) /DA (/Helv 12 Tf 0 0 1 rg) /NM (bb-5) /T (Ben) >>",
        "<< /Type /Annot /Subtype /Ink /Rect [100 100 200 160] /InkList [[100 100 150 160 200 100]] /C [1 0.5 0] /BS << /W 3 >> /NM (bb-6) >>",
        "<< /Type /Annot /Subtype /Square /Rect [1000 100 1100 200] /C [0 0 0] /BS << /W 1 >> /Subj (Rectangle) /NM (bb-7) >>",
        # an area inside the viewport, measured at the detail scale: 108 x 108 pt = 9 x 9 ft... at 1 1/2": 1 ft x 1 ft
        f"<< /Type /Annot /Subtype /Polygon /IT /PolygonDimension /Rect [1396 896 1508 1008] /Vertices [1400 900 1508 900 1508 1008 1400 1008] "
        f"/C [0 0 1] /Subj (Area Measurement) /NM (bb-8) /Measure {d} >>",
        "<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (a sticky note) >>",
        "<< /Type /Annot /Subtype /Link /Rect [40 40 60 60] /A << /S /URI /URI (https://example.org/) >> >>",
    ]
    for i, (x, y) in enumerate([(300, 300), (360, 300), (420, 300)]):
        v = " ".join(f"{x + 5 * math.cos(2 * math.pi * k / 8):.3f} {y + 5 * math.sin(2 * math.pi * k / 8):.3f}" for k in range(8))
        annots.append(f"<< /Type /Annot /Subtype /Polygon /IT /PolygonCount /Rect [{x - 6} {y - 6} {x + 6} {y + 6}] /Vertices [{v}] "
                      f"/C [0 0.6 0.3] /IC [0 0.6 0.3] /Subj (Duplex outlet) /NM (bb-c{i}) >>")
    objs = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        4: stream(b"0.2 G 2 w 100 600 360 180 re S 1400 900 108 108 re S"),
    }
    refs = []
    for i, a in enumerate(annots):
        objs[10 + i] = a.encode("latin-1")
        refs.append(f"{10 + i} 0 R")
    vp = f"[<< /Type /Viewport /BBox [1300 800 1700 1100] /Name (DETAIL 1) /Measure {d} >>]"
    objs[3] = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1728 {H}] /Contents 4 0 R /Resources << >> "
               f"/Annots [{' '.join(refs)}] /VP {vp} >>").encode("latin-1")
    return build_pdf(objs)
