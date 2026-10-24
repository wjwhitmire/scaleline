"""Draw the example plan set: an invented single-story house on three full-size sheets (24 x 18 in).

  examples/example-plans.pdf        C-101 site plan (1" = 20'), A-101 floor plan (1/4" = 1'-0"),
                                    A-201 roof plan (1/8" = 1'-0")
  examples/example-plans-rev2.pdf   A-101 revision 2: the bath wall moves 2 ft, a closet door is
                                    added, and the sheet is plotted 6 pt right and 4 pt down

Every sheet is labeled EXAMPLE DATA. The project, address and people are invented.
The geometry is exact so tests can check measurements by hand.
Needs reportlab (a dev dependency). Output is byte-for-byte repeatable.

Run: python examples/make_example.py
"""

import math
from pathlib import Path

from reportlab import rl_config
from reportlab.lib.colors import Color, black
from reportlab.pdfgen import canvas

rl_config.invariant = 1

HERE = Path(__file__).resolve().parent
W, H = 24 * 72, 18 * 72
GREY = Color(0.35, 0.35, 0.35)
LIGHT = Color(0.6, 0.6, 0.6)

PROJECT = "EXAMPLE RESIDENCE"
ADDRESS = "100 EXAMPLE WAY (INVENTED)"


def title_block(c, number, title, scale_text, rev="1", date="2026-10-01"):
    x0 = W - 4.5 * 72
    c.setLineWidth(2)
    c.rect(36, 36, W - 72, H - 72)
    c.setLineWidth(1)
    c.line(x0, 36, x0, H - 36)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(x0 + 14, H - 80, "EXAMPLE DATA")
    c.setFont("Helvetica", 8)
    for i, line in enumerate(["Invented drawings for trying the takeoff", "tool. Not a real project. Not for", "construction."]):
        c.drawString(x0 + 14, H - 98 - i * 11, line)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(x0 + 14, H - 170, PROJECT)
    c.setFont("Helvetica", 9)
    c.drawString(x0 + 14, H - 184, ADDRESS)
    y = 330
    c.line(x0, y + 40, W - 36, y + 40)
    c.setFont("Helvetica", 7)
    c.drawString(x0 + 14, y + 22, "SHEET TITLE")
    c.setFont("Helvetica-Bold", 16)
    c.drawString(x0 + 14, y, title)
    c.setFont("Helvetica", 7)
    c.drawString(x0 + 14, y - 30, "SCALE")
    c.setFont("Helvetica", 10)
    c.drawString(x0 + 14, y - 44, scale_text)
    c.setFont("Helvetica", 7)
    c.drawString(x0 + 14, y - 74, "DATE")
    c.drawString(x0 + 120, y - 74, "REVISION")
    c.setFont("Helvetica", 10)
    c.drawString(x0 + 14, y - 88, date)
    c.drawString(x0 + 120, y - 88, rev)
    c.line(x0, y - 110, W - 36, y - 110)
    c.setFont("Helvetica", 7)
    c.drawString(x0 + 14, y - 130, "SHEET")
    c.setFont("Helvetica-Bold", 40)
    c.drawString(x0 + 14, y - 180, number)


class Plan:
    """Draw in feet with the origin at a point on the sheet and a scale in points per foot."""

    def __init__(self, c, ox, oy, ppf):
        self.c, self.ox, self.oy, self.ppf = c, ox, oy, ppf

    def p(self, x, y):
        return self.ox + x * self.ppf, self.oy + y * self.ppf

    def wall(self, x0, y0, x1, y1):
        a, b = self.p(x0, y0), self.p(x1, y1)
        self.c.rect(min(a[0], b[0]), min(a[1], b[1]), abs(b[0] - a[0]), abs(b[1] - a[1]), stroke=0, fill=1)

    def line(self, x0, y0, x1, y1, width=0.75):
        self.c.setLineWidth(width)
        self.c.line(*self.p(x0, y0), *self.p(x1, y1))

    def text(self, x, y, s, size=9, bold=False, center=True):
        self.c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        px, py = self.p(x, y)
        (self.c.drawCentredString if center else self.c.drawString)(px, py, s)


def door(pl, hinge, leaf_dir, close_dir, radius=3.0):
    """A swing door: leaf from the hinge along leaf_dir, arc from the leaf tip to the far jamb."""
    c = pl.c
    hx, hy = hinge
    tip = (hx + leaf_dir[0] * radius, hy + leaf_dir[1] * radius)
    pl.line(hx, hy, tip[0], tip[1], 1.25)
    a0 = math.degrees(math.atan2(leaf_dir[1], leaf_dir[0]))
    a1 = math.degrees(math.atan2(close_dir[1], close_dir[0]))
    sweep = (a1 - a0 + 540) % 360 - 180
    cx, cy = pl.p(hx, hy)
    r = radius * pl.ppf
    c.setLineWidth(1)
    c.arc(cx - r, cy - r, cx + r, cy + r, a0, sweep)


def outlet(pl, x, y):
    c = pl.c
    cx, cy = pl.p(x, y)
    c.setLineWidth(0.9)
    c.circle(cx, cy, 4.5, stroke=1, fill=0)
    c.line(cx - 2, cy - 7, cx - 2, cy + 7)
    c.line(cx + 2, cy - 7, cx + 2, cy + 7)


def dimension(pl, x0, y0, x1, y1, label, offset):
    """A dimension line offset from the measured points, with ticks and the label."""
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * offset, dx / L * offset
    a, b = (x0 + nx, y0 + ny), (x1 + nx, y1 + ny)
    pl.line(x0, y0, a[0] + nx * 0.15, a[1] + ny * 0.15, 0.4)
    pl.line(x1, y1, b[0] + nx * 0.15, b[1] + ny * 0.15, 0.4)
    pl.line(*a, *b, 0.5)
    t = 0.35
    for q in (a, b):
        pl.line(q[0] - t, q[1] - t, q[0] + t, q[1] + t, 1)
    c = pl.c
    mx, my = pl.p((a[0] + b[0]) / 2 + nx * 0.25, (a[1] + b[1]) / 2 + ny * 0.25)
    c.saveState()
    c.translate(mx, my)
    c.rotate(math.degrees(math.atan2(dy, dx)))
    c.setFont("Helvetica", 9)
    c.drawCentredString(0, 2, label)
    c.restoreState()


T_EXT = 0.5
T_INT = 1 / 3


def floor_plan(c, rev2=False):
    if rev2:
        # Revision 2 was plotted with a small offset: the whole sheet sits 6 pt right and 4 pt down.
        c.translate(6, -4)
    pl = Plan(c, 216, 300, 18.0)  # 1/4" = 1'-0": 18 pt per foot
    c.setFillColor(black)
    # exterior walls with the front door opening at x 6..9
    pl.wall(0, 0, 6, T_EXT)
    pl.wall(9, 0, 40, T_EXT)
    pl.wall(0, 30 - T_EXT, 40, 30)
    pl.wall(0, 0, T_EXT, 30)
    pl.wall(40 - T_EXT, 0, 40, 30)
    h = T_INT / 2
    bath_x = 24 if rev2 else 26
    # interior walls, centered on their lines, with door openings
    pl.wall(16 - h, T_EXT, 16 + h, 14.5)          # living | bedroom 1 and hall
    pl.wall(16 - h, 17.5, 16 + h, 30 - T_EXT)     # kitchen | bath
    pl.wall(T_EXT, 18 - h, 6, 18 + h)             # living | kitchen
    pl.wall(9, 18 - h, 16, 18 + h)
    pl.wall(16, 14 - h, 18, 14 + h)               # hall | bedrooms
    pl.wall(21, 14 - h, 30, 14 + h)
    pl.wall(33, 14 - h, 40 - T_EXT, 14 + h)
    pl.wall(28 - h, T_EXT, 28 + h, 14)            # bedroom 1 | bedroom 2
    pl.wall(16, 18 - h, 18, 18 + h)               # hall | bath and bedroom 3
    pl.wall(21, 18 - h, 30, 18 + h)
    if rev2:
        pl.wall(33, 18 - h, 33.5, 18 + h)
        pl.wall(36, 18 - h, 40 - T_EXT, 18 + h)
    else:
        pl.wall(33, 18 - h, 40 - T_EXT, 18 + h)
    pl.wall(bath_x - h, 18, bath_x + h, 30 - T_EXT)  # bath | bedroom 3
    # a column in the living room (a cutout for room fill)
    pl.wall(11, 7, 12.5, 8.5)
    # doors: every interior door is the same 3'-0" symbol, swinging into its room
    door(pl, (6, T_EXT), (0, 1), (1, 0))                    # front door into living
    door(pl, (6, 18 + h), (0, 1), (1, 0))                   # living to kitchen, into kitchen
    door(pl, (16 - h, 14.5), (-1, 0), (0, 1))               # hall to living, into living
    door(pl, (18, 14 - h), (0, -1), (1, 0))                 # bedroom 1
    door(pl, (30, 14 - h), (0, -1), (1, 0))                 # bedroom 2
    door(pl, (18, 18 + h), (0, 1), (1, 0))                  # bath
    door(pl, (30, 18 + h), (0, 1), (1, 0))                  # bedroom 3
    if rev2:
        door(pl, (36, 18 + h), (0, 1), (-1, 0), radius=2.5)  # new closet door
    # receptacles
    for x, y in [(3, 1.2), (12, 1.2), (1.2, 10), (14.8, 5), (4, 28.8), (12, 28.8), (22, 1.2), (34, 1.2), (38.8, 8),
                 (36, 28.8), (27.5, 22), (38.8, 24)]:
        outlet(pl, x, y)
    # room names
    for x, y, name in [(8, 10, "LIVING"), (8, 24, "KITCHEN"), (22, 7, "BEDROOM 1"), (34, 7, "BEDROOM 2"), (28, 15.6, "HALL"),
                       ((16 + bath_x) / 2, 24, "BATH"), ((bath_x + 40) / 2, 24, "BEDROOM 3")]:
        pl.text(x, y, name, 10, True)
    # dimensions (exact, for calibration)
    dimension(pl, 0, 30, 40, 30, "40'-0\"", 3)
    dimension(pl, 40, 30, 40, 0, "30'-0\"", 3)
    dimension(pl, 0, 0, 16, 0, "16'-0\"", -3)
    pl.text(20, -6.5, "FLOOR PLAN", 16, True)
    pl.text(20, -8, "SCALE: 1/4\" = 1'-0\"", 9)
    if rev2:
        c.setStrokeColor(GREY)
        pl.text(bath_x, 31.2, "REV 2: BATH WALL MOVED 2'-0\" WEST, CLOSET DOOR ADDED", 8)
        c.setStrokeColor(black)
    title_block(c, "A-101", "FLOOR PLAN", "1/4\" = 1'-0\"", rev="2" if rev2 else "1", date="2026-10-15" if rev2 else "2026-10-01")


def roof_plan(c):
    pl = Plan(c, 300, 420, 9.0)  # 1/8" = 1'-0": 9 pt per foot
    c.setStrokeColor(black)
    # hip roof over a 40 x 30 house with 2 ft overhangs: 44 x 34 outline, ridge 10 ft
    pts = [(0, 0), (44, 0), (44, 34), (0, 34)]
    for i in range(4):
        pl.line(*pts[i], *pts[(i + 1) % 4], 1.5)
    pl.line(17, 17, 27, 17, 1.5)
    for a, b in [((0, 0), (17, 17)), ((0, 34), (17, 17)), ((44, 0), (27, 17)), ((44, 34), (27, 17))]:
        pl.line(*a, *b, 1)
    c.setDash(4, 3)
    for i in range(4):
        q = [(2, 2), (42, 2), (42, 32), (2, 32)]
        pl.line(*q[i], *q[(i + 1) % 4], 0.6)
    c.setDash()
    pl.text(22, 8, "6:12 TYP.", 9)
    pl.text(22, 18.5, "RIDGE", 8)
    pl.text(22, -2.5, "DASHED LINE: EXTERIOR WALLS BELOW", 8)
    dimension(pl, 0, 34, 44, 34, "44'-0\"", 4)
    dimension(pl, 44, 34, 44, 0, "34'-0\"", 4)
    pl.text(22, -7, "ROOF PLAN", 16, True)
    pl.text(22, -9.5, "SCALE: 1/8\" = 1'-0\"", 9)
    title_block(c, "A-201", "ROOF PLAN", "1/8\" = 1'-0\"")


def site_plan(c):
    pl = Plan(c, 400, 260, 3.6)  # 1" = 20': 3.6 pt per foot
    c.setStrokeColor(black)
    c.setDash([10, 3, 2, 3])
    lot = [(0, 0), (100, 0), (100, 150), (0, 150)]
    for i in range(4):
        pl.line(*lot[i], *lot[(i + 1) % 4], 1.2)
    c.setDash()
    # house footprint 40 x 30, 25 ft back from the front lot line, 30 ft from the west line
    c.setFillColor(LIGHT)
    a, b = pl.p(30, 25), pl.p(70, 55)
    c.rect(a[0], a[1], b[0] - a[0], b[1] - a[1], stroke=1, fill=1)
    c.setFillColor(black)
    pl.text(50, 39, "HOUSE", 9, True)
    # driveway 12 x 25 and a 4 ft sidewalk along the street
    for q in [[(56, 0), (68, 0), (68, 25), (56, 25)], [(0, -4), (100, -4), (100, 0), (0, 0)], [(36, 0), (40, 0), (40, 25), (36, 25)]]:
        for i in range(4):
            pl.line(*q[i], *q[(i + 1) % 4], 0.8)
    pl.text(62, 12, "DRIVE", 7)
    pl.text(80, -2.8, "SIDEWALK", 7)
    pl.text(50, -10, "EXAMPLE STREET (INVENTED)", 9, True)
    dimension(pl, 0, 150, 100, 150, "100.00'", 6)
    dimension(pl, 100, 150, 100, 0, "150.00'", 6)
    dimension(pl, 30, 0, 30, 25, "25'", 6)
    # north arrow
    nx, ny = pl.p(115, 130)
    c.setLineWidth(1)
    c.line(nx, ny, nx, ny + 40)
    c.line(nx, ny + 40, nx - 6, ny + 28)
    c.line(nx, ny + 40, nx + 6, ny + 28)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(nx, ny + 46, "N")
    pl.text(50, -18, "SITE PLAN", 16, True)
    pl.text(50, -22.5, "SCALE: 1\" = 20'", 9)
    title_block(c, "C-101", "SITE PLAN", "1\" = 20'")


def build(path, pages, title):
    c = canvas.Canvas(str(path), pagesize=(W, H), pageCompression=1)
    c.setTitle(title)
    c.setAuthor("Example data")
    c.setCreator("examples/make_example.py")
    for draw in pages:
        draw(c)
        c.showPage()
    c.save()


def main():
    build(HERE / "example-plans.pdf", [site_plan, floor_plan, roof_plan], "Example plan set (invented)")
    build(HERE / "example-plans-rev2.pdf", [lambda c: floor_plan(c, rev2=True)], "Example floor plan, revision 2 (invented)")
    for p in ("example-plans.pdf", "example-plans-rev2.pdf"):
        print(p, (HERE / p).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
