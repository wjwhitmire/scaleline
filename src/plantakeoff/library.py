"""The built-in assemblies library, organized by CSI MasterFormat division number.

Each assembly turns linked measurements into purchase quantities with formulas (see formula.py),
an industry-typical waste factor and a purchase unit, and carries a "why" note that says where
its numbers come from. Names are generic trade terms and the wording is our own; only the
division and section numbers come from MasterFormat. No prices ship: costs start at zero and come
from a price list the user imports (prices go stale and vary by region).

Formulas see the totals of the linked measurements: LF (length, ft), PF (perimeter, ft), SF (area,
square feet, pitch applied), WSF (wall area, square feet, from a height on the measurement), CF and
CY (volume), EA (count) and N (number of measurements), plus each assembly's own parameters.
Waste is applied after the formula and before the round up to whole purchase units.

Run ``python -m plantakeoff.library`` to write web/src/core/17_library.js (the browser copy) and
the shareable JSON file; a test checks both are up to date.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

LIBRARY_FORMAT = "field-tools-takeoff-assemblies"
LIBRARY_VERSION = 1


def P(pid, name, value, unit=""):
    out = {"id": pid, "name": name, "value": value}
    if unit:
        out["unit"] = unit
    return out


def C(name, formula, unit, waste=0, pack=0, source="area"):
    return {"name": name, "source": source, "formula": formula, "waste_pct": waste, "pack": pack, "unit": unit,
            "factor": 1, "per_each": 0, "unit_cost_cents": 0}


_ITEMS = []


def A(code, name, group, tool, why, comps, params=()):
    digits = re.sub(r"\D", "", code)
    n = sum(1 for a in _ITEMS if a["code"] == code)
    _ITEMS.append({"id": f"lib-{digits}-{chr(97 + n)}", "name": name, "division": code[:2], "code": code, "group": group,
                   "tool": tool, "why": why, "params": list(params), "components": comps})


WALL_AREA = "either(WSF, LF * height_ft)"
H9 = P("height_ft", "Wall height when the measurement has none", 9, "ft")

# ---------------------------------------------------------------- 02 Existing conditions
A("02 41 19", "Interior partition demolition", "Demolition", "polylength",
  "Wall area is drawn length times height; debris is the wall's solid volume times 1.4 for the air "
  "between broken pieces, rounded up to 20 CY roll-off containers.",
  [C("Partition removal", WALL_AREA, "SF", source="wall_area"),
   C("Debris, loose", WALL_AREA + " * thickness_in / 12 / 27 * 1.4", "CY", source="wall_area"),
   C("Roll-off containers", WALL_AREA + " * thickness_in / 12 / 27 * 1.4", "EA", pack=20, source="wall_area")],
  [H9, P("thickness_in", "Wall thickness", 5, "in")])
A("02 41 19", "Floor finish removal", "Demolition", "area",
  "Removal is the floor area. Scraping adhesive is counted on the same area; debris uses a quarter inch "
  "of material plus bulking, which is small, so one container usually covers a floor.",
  [C("Finish removal", "SF", "SF"), C("Adhesive scraping", "SF", "SF"),
   C("Debris, loose", "SF * 0.25 / 12 / 27 * 1.4", "CY")])
A("02 41 19", "Ceiling removal", "Demolition", "area",
  "Ceiling area plus grid and tile debris at about one cubic yard per 250 SF, a common rule for lay-in ceilings.",
  [C("Ceiling removal", "SF", "SF"), C("Debris, loose", "SF / 250", "CY")])
A("02 41 16", "Concrete slab removal", "Demolition", "area",
  "Slab volume is area times thickness. Concrete in place weighs about 2 tons a cubic yard (150 lb a CF) and "
  "swells about 40 percent when broken and loaded, so the haul volume is larger but the weight is not.",
  [C("Slab removal", "SF", "SF"), C("Concrete debris, loose", "SF * thickness_in / 12 / 27 * 1.4", "CY"),
   C("Concrete debris weight", "SF * thickness_in / 12 / 27 * 2.0", "TON")],
  [P("thickness_in", "Slab thickness", 4, "in")])
A("02 41 19", "Fixture and device removal", "Demolition", "count",
  "One removal per counted item, with a cap or plate to make each disconnected point safe.",
  [C("Removal", "EA", "EA", source="count"), C("Cap or blank plate", "EA", "EA", source="count")])

# ---------------------------------------------------------------- 03 Concrete
for thk, wwf in ((4, True), (5, True), (6, False)):
    reinf = ([C("Welded wire reinforcement sheets", "SF / 160", "SHEET", waste=10, pack=1)] if wwf else
             [C("Rebar #4, both ways", "SF * 2 * 12 / spacing_in", "LF", waste=10, source="area"),
              C("Rebar #4 weight", "SF * 2 * 12 / spacing_in * 0.668", "LB", waste=10),
              C("Bar chairs", "SF / 16", "EA", waste=5, pack=1)])
    A("03 30 00", f"Slab on grade, {thk} in", "Slabs", "area",
      f"Concrete is area times {thk} in over 27 to get cubic yards, with 5 percent waste for subgrade variation "
      "and spillage. Vapor retarder laps add 10 percent. "
      + ("Wire mesh comes in 8 x 20 ft sheets (160 SF) with 10 percent lap waste." if wwf else
         "Rebar runs both ways at the spacing given; 0.668 lb per foot is the weight of a #4 bar; chairs at one per 16 SF.")
      + " Curing compound covers about 200 SF a gallon.",
      [C("Concrete", f"SF * {thk} / 12 / 27", "CY", waste=5, pack=0.25),
       C("Vapor retarder", "SF", "SF", waste=10), *reinf,
       C("Finishing", "SF", "SF"), C("Curing compound", "SF / 200", "GAL", waste=5, pack=1),
       C("Control joints, sawn", "SF / control_spacing_ft * 2", "LF", waste=0)],
      [P("spacing_in", "Rebar spacing", 18, "in"), P("control_spacing_ft", "Control joint spacing", 12, "ft")]
      if not wwf else [P("control_spacing_ft", "Control joint spacing", 12, "ft")])
A("03 30 00", "Concrete by measured volume", "Slabs", "volume",
  "For any volume measured with a depth: cubic yards with 5 percent waste, plus a pump "
  "or truck charge counted once per pour (one per measurement).",
  [C("Concrete", "CY", "CY", waste=5, pack=0.25, source="volume"), C("Placement (per pour)", "N", "EA", source="each")])
A("03 30 00", "Continuous wall footing", "Footings", "polylength",
  "Concrete is length times width times depth. Longitudinal bars run the full length with 10 percent for laps "
  "and waste; side forms are both faces of the footing depth.",
  [C("Concrete", "LF * width_in / 12 * depth_in / 12 / 27", "CY", waste=5, pack=0.25, source="length"),
   C("Rebar #4, continuous", "LF * bars", "LF", waste=10, source="length"),
   C("Rebar #4 weight", "LF * bars * 0.668", "LB", waste=10, source="length"),
   C("Edge forms", "LF * 2 * depth_in / 12", "SFCA", waste=5, source="length")],
  [P("width_in", "Footing width", 20, "in"), P("depth_in", "Footing depth", 10, "in"), P("bars", "Continuous bars", 3)])
A("03 30 00", "Spread footing", "Footings", "count",
  "Each counted footing is length times width times depth. Bars run both ways at the spacing: the bars along "
  "the length are spread across the width and the bars along the width across the length, each bar the "
  "footing dimension less 3 in cover at each end.",
  [C("Concrete", "EA * len_ft * wid_ft * depth_ft / 27", "CY", waste=5, pack=0.25, source="count"),
   C("Rebar #5, both ways", "EA * ((ceil(wid_ft * 12 / spacing_in) + 1) * (len_ft - 0.5) + (ceil(len_ft * 12 / spacing_in) + 1) * (wid_ft - 0.5))", "LF", waste=10, source="count"),
   C("Edge forms", "EA * 2 * (len_ft + wid_ft) * depth_ft", "SFCA", waste=5, source="count")],
  [P("len_ft", "Footing length", 4, "ft"), P("wid_ft", "Footing width", 4, "ft"), P("depth_ft", "Footing depth", 1.5, "ft"),
   P("spacing_in", "Bar spacing", 12, "in")])
A("03 30 00", "Foundation wall, cast in place", "Walls", "polylength",
  "Concrete is length times height times thickness. Forms cover both faces. Vertical bars at the spacing "
  "over the height, horizontal bars at the spacing over the length, plus 10 percent for laps. Each form tie "
  "passes through the wall and holds both faces, one tie per 4 SF of wall (2 x 2 ft spacing).",
  [C("Concrete", "LF * height_ft * thickness_in / 12 / 27", "CY", waste=5, pack=0.25, source="length"),
   C("Wall forms, both faces", "LF * height_ft * 2", "SFCA", waste=5, source="length"),
   C("Vertical rebar", "(LF * 12 / vspacing_in + N) * height_ft", "LF", waste=10, source="length"),
   C("Horizontal rebar", "LF * (ceil(height_ft * 12 / hspacing_in) + 1)", "LF", waste=10, source="length"),
   C("Form ties", "LF * height_ft / 4", "EA", waste=5, pack=1, source="length")],
  [P("height_ft", "Wall height", 8, "ft"), P("thickness_in", "Wall thickness", 8, "in"),
   P("vspacing_in", "Vertical bar spacing", 16, "in"), P("hspacing_in", "Horizontal bar spacing", 12, "in")])
A("03 30 00", "Grade beam", "Footings", "polylength",
  "Concrete is the beam section times length; four continuous bars and stirrups at the spacing, each stirrup "
  "the section perimeter.",
  [C("Concrete", "LF * width_in / 12 * depth_in / 12 / 27", "CY", waste=5, pack=0.25, source="length"),
   C("Longitudinal rebar", "LF * 4", "LF", waste=10, source="length"),
   C("Stirrups", "LF * 12 / stirrup_in", "EA", waste=5, pack=1, source="length"),
   C("Forms, both sides", "LF * 2 * depth_in / 12", "SFCA", waste=5, source="length")],
  [P("width_in", "Beam width", 12, "in"), P("depth_in", "Beam depth", 24, "in"), P("stirrup_in", "Stirrup spacing", 12, "in")])
A("03 30 00", "Drilled pier", "Footings", "count",
  "Each pier is a cylinder: 3.1416 times radius squared times depth, with 10 percent overbreak because drilled "
  "holes run larger than the auger.",
  [C("Concrete", "EA * 3.1416 * (diameter_in / 24) ^ 2 * depth_ft / 27", "CY", waste=10, pack=0.25, source="count"),
   C("Vertical bars", "EA * bars * (depth_ft - 0.25)", "LF", waste=10, source="count"),
   C("Drilling", "EA * depth_ft", "VLF", source="count")],
  [P("diameter_in", "Pier diameter", 18, "in"), P("depth_ft", "Pier depth", 10, "ft"), P("bars", "Vertical bars", 6)])
A("03 30 00", "Concrete column", "Columns", "count",
  "Each column is width times depth times height; forms are the four faces; ties at the spacing over the height.",
  [C("Concrete", "EA * size_in ^ 2 / 144 * height_ft / 27", "CY", waste=5, pack=0.25, source="count"),
   C("Column forms", "EA * 4 * size_in / 12 * height_ft", "SFCA", waste=5, source="count"),
   C("Vertical bars", "EA * 4 * (height_ft + 2)", "LF", waste=10, source="count"),
   C("Ties", "EA * ceil(height_ft * 12 / tie_in)", "EA", waste=5, pack=1, source="count")],
  [P("size_in", "Column size", 16, "in"), P("height_ft", "Column height", 12, "ft"), P("tie_in", "Tie spacing", 12, "in")])
A("03 30 00", "Elevated slab", "Slabs", "area",
  "Concrete is area times thickness; deck forms or shoring cover the full area; two mats of bars at the spacing.",
  [C("Concrete", "SF * thickness_in / 12 / 27", "CY", waste=5, pack=0.25),
   C("Deck forms", "SF", "SF", waste=5), C("Rebar, two ways, two mats", "SF * 4 * 12 / spacing_in", "LF", waste=10)],
  [P("thickness_in", "Slab thickness", 8, "in"), P("spacing_in", "Bar spacing", 12, "in")])
A("03 30 00", "Concrete topping", "Slabs", "area",
  "A thin topping is area times thickness; bonding compound covers about 300 SF a gallon.",
  [C("Topping concrete", "SF * thickness_in / 12 / 27", "CY", waste=8, pack=0.25),
   C("Bonding compound", "SF / 300", "GAL", waste=5, pack=1)],
  [P("thickness_in", "Topping thickness", 2, "in")])
A("03 35 00", "Concrete sealer", "Finishes", "area",
  "Penetrating sealer covers about 250 SF a gallon a coat; two coats are typical.",
  [C("Sealer", "SF * coats / 250", "GAL", waste=5, pack=1)], [P("coats", "Coats", 2)])
A("03 15 00", "Expansion joint", "Joints", "length",
  "Joint filler strips run the drawn length in 10 ft pieces, with sealant over the top.",
  [C("Joint filler", "LF", "LF", waste=5, pack=10, source="length"),
   C("Joint sealant", "LF / 20", "TUBE", waste=10, pack=1, source="length")])
A("03 30 00", "Concrete stair", "Stairs", "count",
  "Count each flight. Volume is the waist slab plus the risers' triangles: with 7 in risers, 11 in treads and a "
  "6 in waist that is about 0.13 CY per riser for a 4 ft wide stair.",
  [C("Concrete", "EA * risers * 0.13 * width_ft / 4", "CY", waste=8, pack=0.25, source="count"),
   C("Stair forms", "EA * risers * width_ft * 1.6", "SFCA", waste=10, source="count")],
  [P("risers", "Risers per flight", 14), P("width_ft", "Stair width", 4, "ft")])

# ---------------------------------------------------------------- 04 Masonry
for size, grout_cf in ((6, 0.17), (8, 0.26), (12, 0.43)):
    A("04 22 00", f"Concrete block wall, {size} in", "Block", "polylength",
      f"A standard 8 x 16 in face block covers 0.889 SF, so walls take 1.125 blocks a SF. Mortar runs about 3 "
      f"bags per 100 blocks. Grouting every cell of a {size} in wall takes about {grout_cf} CF a SF of wall; "
      "ladder joint reinforcement goes in every other course (every 16 in).",
      [C("Concrete block", WALL_AREA + " * 1.125", "EA", waste=5, pack=1, source="wall_area"),
       C("Mortar", WALL_AREA + " * 1.125 * 3 / 100", "BAG", waste=10, pack=1, source="wall_area"),
       C("Grout, cells filled", WALL_AREA + f" * {grout_cf} / 27 * grouted_pct / 100", "CY", waste=10, pack=0.25, source="wall_area"),
       C("Joint reinforcement", WALL_AREA + " * 0.75", "LF", waste=10, pack=10, source="wall_area"),
       C("Vertical rebar", "(LF * 12 / bar_spacing_in + N) * height_ft", "LF", waste=10, source="length")],
      [H9, P("grouted_pct", "Share of cells grouted", 100, "%"), P("bar_spacing_in", "Vertical bar spacing", 32, "in")])
A("04 21 13", "Brick veneer", "Brick", "polylength",
  "Modular brick with 3/8 in joints is 6.86 brick a SF. Mortar is about 7 CF per 1,000 brick. Wall ties go one per "
  "2.67 SF (16 in by 24 in); flashing and weeps at the base run the wall length.",
  [C("Brick", WALL_AREA + " * 6.86", "EA", waste=5, pack=1, source="wall_area"),
   C("Mortar", WALL_AREA + " * 6.86 * 7 / 1000", "CF", waste=10, source="wall_area"),
   C("Wall ties", WALL_AREA + " / 2.67", "EA", waste=5, pack=1, source="wall_area"),
   C("Base flashing", "LF", "LF", waste=10, source="length"), C("Weep vents", "LF * 12 / 24", "EA", pack=1, source="length")],
  [H9])
A("04 43 00", "Stone veneer, adhered", "Stone", "polylength",
  "Adhered stone is sold by face area; corners are counted separately in practice, so 10 percent waste covers "
  "cutting. Scratch coat and mortar at about one 80 lb bag per 20 SF.",
  [C("Stone veneer", WALL_AREA, "SF", waste=10, source="wall_area"), C("Lath", WALL_AREA, "SF", waste=10, source="wall_area"),
   C("Mortar", WALL_AREA + " / 20", "BAG", waste=10, pack=1, source="wall_area")], [H9])
A("04 22 00", "Block by wall area", "Block", "area",
  "For a wall elevation measured as an area: 1.125 standard blocks a SF and 3 bags of mortar per 100 blocks.",
  [C("Concrete block", "SF * 1.125", "EA", waste=5, pack=1), C("Mortar", "SF * 1.125 * 3 / 100", "BAG", waste=10, pack=1)])
A("04 05 13", "Masonry cleaning", "Brick", "area",
  "Masonry cleaner covers about 100 SF a gallon at working strength.",
  [C("Cleaning", "SF", "SF"), C("Cleaner", "SF / 100", "GAL", waste=10, pack=1)])

# ---------------------------------------------------------------- 05 Metals
A("05 52 13", "Pipe handrail", "Rails", "length",
  "Rail runs the drawn length; posts at the spacing plus one at the end of each run; brackets every 4 ft on walls.",
  [C("Handrail pipe", "LF", "LF", waste=5, pack=21, source="length"),
   C("Posts", "LF / post_spacing_ft + N", "EA", pack=1, source="length"), C("Wall brackets", "LF / 4", "EA", pack=1, source="length")],
  [P("post_spacing_ft", "Post spacing", 5, "ft")])
A("05 52 13", "Guardrail", "Rails", "length",
  "Top and mid rails run the length, posts at the spacing plus one per run, pickets at 4 in clear.",
  [C("Rails", "LF * 2", "LF", waste=5, source="length"), C("Posts", "LF / post_spacing_ft + N", "EA", pack=1, source="length"),
   C("Pickets", "LF * 12 / 4.5", "EA", waste=3, pack=1, source="length")], [P("post_spacing_ft", "Post spacing", 5, "ft")])
A("05 12 00", "Steel lintel", "Structural steel", "count",
  "Each counted opening gets an angle the opening width plus 8 in bearing at each end.",
  [C("Lintel angle", "EA * (opening_ft + 16 / 12)", "LF", waste=5, source="count")], [P("opening_ft", "Opening width", 4, "ft")])
A("05 31 00", "Steel floor deck", "Deck", "area",
  "Deck sheets cover their width; 5 percent for end laps and cuts. Puddle welds at about one per 4 SF.",
  [C("Metal deck", "SF", "SF", waste=5), C("Welds or fasteners", "SF / 4", "EA", waste=5, pack=1)])
A("05 40 00", "Cold-formed steel studs, load bearing", "Light gauge", "polylength",
  "Studs at the spacing over the length plus one per wall end; top and bottom track run the length twice.",
  [C("Studs", "ceil(LF * 12 / spacing_in) + N", "EA", waste=5, pack=1, source="length"),
   C("Track", "LF * 2", "LF", waste=5, pack=10, source="length"), C("Screws", "(ceil(LF * 12 / spacing_in) + N) * 8 / 1000", "BOX", pack=1, source="length")],
  [P("spacing_in", "Stud spacing", 16, "in")])
A("05 50 00", "Pipe bollard", "Site metals", "count",
  "Each bollard is a pipe the exposed height plus embedment, filled with concrete.",
  [C("Bollard pipe", "EA * (height_ft + embed_ft)", "LF", waste=5, source="count"),
   C("Concrete fill and footing", "EA * 0.25", "CY", waste=10, pack=0.25, source="count")],
  [P("height_ft", "Exposed height", 4, "ft"), P("embed_ft", "Embedment", 3, "ft")])
A("05 51 00", "Steel stair", "Stairs", "count",
  "Count each flight: treads and risers per flight, two stringers the flight's run.",
  [C("Treads", "EA * risers", "EA", pack=1, source="count"), C("Stringers", "EA * 2 * risers * 0.92", "LF", waste=5, source="count")],
  [P("risers", "Risers per flight", 14)])

# ---------------------------------------------------------------- 06 Wood
for size, sp in (("2x4", 16), ("2x4", 24), ("2x6", 16), ("2x6", 24)):
    A("06 11 00", f"Wood stud wall, {size} at {sp} in", "Framing", "polylength",
      f"Studs at {sp} in centers over the length, plus one per wall end and two for each corner or opening "
      "(the openings parameter). Plates are one bottom and two top, so three times the length, in 16 ft stock.",
      [C(f"{size} studs", f"ceil(LF * 12 / {sp}) + N + 2 * openings", "EA", waste=10, pack=1, source="length"),
       C(f"{size} plates", "LF * 3", "LF", waste=10, pack=16, source="length"),
       C("Nails", "LF / 100", "BOX", pack=1, source="length")],
      [P("openings", "Corners and openings to add studs for", 0)])
for size, sp in (("2x10", 16), ("2x12", 16), ("I-joist", 19.2)):
    A("06 11 00", f"Floor joists, {size} at {sp} in", "Framing", "area",
      f"Joist length per square foot is 12 / {sp} at {sp} in centers. Rim board runs the perimeter of the area; "
      "blocking or bridging at mid span adds about 10 percent.",
      [C(f"{size} joists", f"SF * 12 / {sp}", "LF", waste=10, source="area"), C("Rim board", "PF", "LF", waste=10, pack=16, source="perimeter"),
       C("Joist hangers", f"SF * 12 / {sp} / span_ft * 2", "EA", waste=5, pack=1)],
      [P("span_ft", "Joist span", 14, "ft")])
A("06 16 00", "Subfloor, 3/4 in panels", "Sheathing", "area",
  "Panels are 4 x 8 ft (32 SF) with 10 percent for cutting; one tube of subfloor adhesive does about 3 panels.",
  [C("Subfloor panels", "SF / 32", "SHEET", waste=10, pack=1), C("Subfloor adhesive", "SF / 32 / 3", "TUBE", waste=5, pack=1)])
A("06 16 00", "Wall sheathing", "Sheathing", "polylength",
  "Wall area over 32 SF per 4 x 8 panel with 10 percent for openings cut out and waste.",
  [C("Sheathing panels", WALL_AREA + " / 32", "SHEET", waste=10, pack=1, source="wall_area")], [H9])
A("06 16 00", "Roof sheathing", "Sheathing", "area",
  "Roof area (with pitch) over 32 SF per panel, 10 percent waste for hips and valleys, and one panel clip per panel "
  "edge between rafters.",
  [C("Roof sheathing panels", "SF / 32", "SHEET", waste=10, pack=1), C("Panel clips", "SF / 32 * 2", "EA", waste=5, pack=1)])
A("06 17 53", "Roof trusses", "Framing", "length",
  "Draw the ridge or the wall the trusses bear on: trusses at the spacing over the length, plus one, and the gable ends.",
  [C("Trusses", "ceil(LF * 12 / spacing_in) + N", "EA", pack=1, source="length"),
   C("Hurricane ties", "(ceil(LF * 12 / spacing_in) + N) * 2", "EA", pack=1, source="length")],
  [P("spacing_in", "Truss spacing", 24, "in")])
A("06 11 00", "Rafters", "Framing", "area",
  "Rafter length per square foot of roof is 12 over the spacing; ridge and ceiling joists are counted separately.",
  [C("Rafters", "SF * 12 / spacing_in", "LF", waste=10)], [P("spacing_in", "Rafter spacing", 16, "in")])
A("06 11 00", "Blocking", "Framing", "length",
  "Solid blocking along the drawn line in 8 ft stock with 15 percent for short pieces.",
  [C("Blocking", "LF", "LF", waste=15, pack=8, source="length")])
A("06 22 00", "Baseboard, wood", "Trim", "length",
  "Trim runs the drawn length; 10 percent covers miters and short ends, bought in 16 ft pieces.",
  [C("Baseboard", "LF", "LF", waste=10, pack=16, source="length"), C("Finish nails", "LF / 500", "BOX", pack=1, source="length")])
A("06 22 00", "Crown molding", "Trim", "length",
  "Crown takes more waste than base (15 percent) for compound miters, in 16 ft pieces.",
  [C("Crown molding", "LF", "LF", waste=15, pack=16, source="length")])
A("06 22 00", "Door casing", "Trim", "count",
  "Each door gets casing on both sides: two legs and a head per side, about 17 LF a side for a 3 x 7 door.",
  [C("Casing", "EA * sides * 17", "LF", waste=10, pack=7, source="count")], [P("sides", "Sides cased", 2)])
A("06 22 00", "Window casing and stool", "Trim", "count",
  "Each window gets its perimeter in casing plus a stool and apron the width.",
  [C("Casing", "EA * 2 * (width_ft + height_ft)", "LF", waste=10, source="count"),
   C("Stool and apron", "EA * width_ft * 2", "LF", waste=10, source="count")],
  [P("width_ft", "Window width", 3, "ft"), P("height_ft", "Window height", 4, "ft")])
A("06 41 00", "Base cabinets", "Casework", "length",
  "Base cabinets by running length; fillers and end panels add about 5 percent.",
  [C("Base cabinets", "LF", "LF", waste=5, source="length")])
A("06 41 00", "Wall cabinets", "Casework", "length",
  "Wall cabinets by running length; fillers add about 5 percent.",
  [C("Wall cabinets", "LF", "LF", waste=5, source="length")])
A("06 41 00", "Countertop", "Casework", "length",
  "Countertop area is the run times the depth (25.5 in standard) with 10 percent for seams and overhangs; "
  "backsplash runs the same length.",
  [C("Countertop", "LF * depth_in / 12", "SF", waste=10, source="length"), C("Backsplash", "LF", "LF", waste=10, source="length")],
  [P("depth_in", "Countertop depth", 25.5, "in")])
A("06 41 00", "Shelving", "Casework", "length",
  "Shelf length times the number of shelves, with standards every 32 in.",
  [C("Shelving", "LF * shelves", "LF", waste=10, source="length"), C("Standards", "ceil(LF * 12 / 32) + N", "EA", pack=1, source="length")],
  [P("shelves", "Shelves", 5)])
A("06 15 00", "Wood deck", "Exterior wood", "area",
  "Deck boards cover their width plus the gap: LF of board per SF is 12 over (width plus gap). Joists at 16 in.",
  [C("Deck boards", "SF * 12 / (board_in + gap_in)", "LF", waste=10), C("Joists", "SF * 12 / 16", "LF", waste=10),
   C("Deck screws", "SF / 100", "BOX", waste=5, pack=1)],
  [P("board_in", "Board width", 5.5, "in"), P("gap_in", "Gap", 0.125, "in")])
A("06 20 00", "Fascia board", "Exterior wood", "length",
  "Fascia runs the eave and rake length in 16 ft stock with 10 percent for joints.",
  [C("Fascia", "LF", "LF", waste=10, pack=16, source="length")])
A("06 20 00", "Soffit", "Exterior wood", "area",
  "Soffit panels cover the soffit area with 10 percent for cutting; vents every 10 ft are counted separately.",
  [C("Soffit", "SF", "SF", waste=10)])
A("06 43 00", "Wood stair", "Stairs", "count",
  "Count each flight: treads and risers per flight and three stringers.",
  [C("Treads", "EA * (risers - 1)", "EA", pack=1, source="count"), C("Risers", "EA * risers", "EA", pack=1, source="count"),
   C("Stringers", "EA * 3", "EA", pack=1, source="count")], [P("risers", "Risers per flight", 14)])

# ---------------------------------------------------------------- 07 Thermal and moisture protection
for r, where, tool, src, formula in (("R-13", "2x4 walls", "polylength", "wall_area", WALL_AREA),
                                     ("R-21", "2x6 walls", "polylength", "wall_area", WALL_AREA),
                                     ("R-30", "ceilings", "area", "area", "SF"), ("R-38", "ceilings", "area", "area", "SF")):
    A("07 21 16", f"Batt insulation, {r}, {where}", "Insulation", tool,
      "Batts cover the framed area; 5 percent for cutting around boxes and blocking. Bags hold the square feet "
      "given (it varies by product, so set it from the label).",
      [C(f"Batts {r}", formula, "SF", waste=5, source=src), C("Bags", formula + " / bag_sf", "BAG", waste=5, pack=1, source=src)],
      ([H9] if src == "wall_area" else []) + [P("bag_sf", "Square feet per bag", 40 if src == "wall_area" else 50, "SF")])
A("07 21 26", "Blown attic insulation", "Insulation", "area",
  "Loose fill: bags per SF at the target depth come from the bag chart; the default is about 40 SF a bag at R-38.",
  [C("Loose fill", "SF / sf_per_bag", "BAG", waste=5, pack=1)], [P("sf_per_bag", "Square feet per bag at the target R", 40, "SF")])
A("07 21 13", "Rigid board insulation", "Insulation", "area",
  "4 x 8 boards (32 SF) with 5 percent waste; fasteners or adhesive at about 8 per board.",
  [C("Insulation boards", "SF / 32", "SHEET", waste=5, pack=1), C("Fasteners", "SF / 32 * 8", "EA", waste=5, pack=1)])
A("07 21 19", "Spray foam insulation", "Insulation", "area",
  "Spray foam is sold by board foot: area times thickness in inches; 10 percent for overspray and trimming.",
  [C("Spray foam", "SF * thickness_in", "BF", waste=10)], [P("thickness_in", "Thickness", 3, "in")])
A("07 25 00", "Weather barrier wrap", "Barriers", "polylength",
  "Wrap covers the wall area with 10 percent for laps; a 9 x 150 ft roll covers 1,350 SF; tape runs the seams.",
  [C("Wrap", WALL_AREA + " / 1350", "ROLL", waste=10, pack=1, source="wall_area"),
   C("Seam tape", WALL_AREA + " / 9", "LF", waste=10, source="wall_area")], [H9])
A("07 26 00", "Vapor retarder", "Barriers", "area",
  "Sheet covers the area with 10 percent for 6 in laps; rolls of 10 x 100 ft (1,000 SF).",
  [C("Vapor retarder", "SF / 1000", "ROLL", waste=10, pack=1)])
A("07 31 13", "Asphalt shingle roof", "Roofing", "area",
  "Draw the roof with its pitch so the area is the true slope area. A square is 100 SF, three bundles a square, "
  "10 percent waste for hips and valleys (15 percent on cut-up roofs). Drip edge runs the area's perimeter.",
  [C("Shingles", "SF / 100 * 3", "BDL", waste=10, pack=1), C("Underlayment", "SF / 1000", "ROLL", waste=10, pack=1),
   C("Drip edge", "PF", "LF", waste=10, pack=10, source="perimeter"), C("Starter strip", "PF / 2", "LF", waste=10, source="perimeter"),
   C("Roofing nails", "SF / 100 * 2.5", "LB", waste=5)])
A("07 41 13", "Metal roof panels", "Roofing", "area",
  "Panels cover the sloped area with 5 percent for end laps and trim cuts; fasteners about 80 per square.",
  [C("Metal panels", "SF", "SF", waste=5), C("Fasteners", "SF / 100 * 80", "EA", waste=5, pack=250)])
A("07 54 23", "Single-ply membrane roof", "Roofing", "area",
  "Membrane rolls of 10 x 100 ft with 10 percent for seams and flashing; insulation boards 4 x 8 with plates and "
  "screws at about 8 per board.",
  [C("Membrane", "SF / 1000", "ROLL", waste=10, pack=1), C("Roof insulation", "SF / 32", "SHEET", waste=5, pack=1),
   C("Plates and screws", "SF / 32 * 8", "EA", waste=5, pack=500)])
A("07 52 00", "Modified bitumen roof", "Roofing", "area",
  "Rolls cover about one square each after laps, two plies, 10 percent waste.",
  [C("Base sheet", "SF / 100", "ROLL", waste=10, pack=1), C("Cap sheet", "SF / 100", "ROLL", waste=10, pack=1)])
A("07 51 00", "Built-up roof, 4 ply", "Roofing", "area",
  "Four plies of felt (each roll about 4 squares) and asphalt at about 25 lb per square per ply.",
  [C("Felt", "SF / 100 * 4 / 4", "ROLL", waste=10, pack=1), C("Asphalt", "SF / 100 * 25 * 4", "LB", waste=10)])
A("07 30 00", "Roof underlayment", "Roofing", "area",
  "Synthetic underlayment rolls cover about 1,000 SF with laps; 10 percent waste.",
  [C("Underlayment", "SF / 1000", "ROLL", waste=10, pack=1)])
A("07 71 23", "Gutters and downspouts", "Roof accessories", "length",
  "Gutter runs the drawn eave length; hangers every 2 ft; one downspout per 35 ft of gutter (and at least one per run).",
  [C("Gutter", "LF", "LF", waste=5, source="length"), C("Hangers", "LF / 2", "EA", pack=1, source="length"),
   C("Downspouts", "max(N, LF / 35)", "EA", pack=1, source="length"),
   C("Downspout pipe", "max(N, LF / 35) * downspout_ft", "LF", waste=5, source="length")],
  [P("downspout_ft", "Downspout height", 12, "ft")])
A("07 62 00", "Sheet metal flashing", "Flashing", "length",
  "Flashing runs the drawn length in 10 ft pieces with 4 in laps (about 5 percent).",
  [C("Flashing", "LF", "LF", waste=5, pack=10, source="length")])
A("07 92 00", "Joint sealant", "Sealants", "length",
  "A 10.1 oz tube fills about 24 LF of a 1/4 x 1/4 in joint; the default joint size gives the LF per tube.",
  [C("Sealant", "LF / lf_per_tube", "TUBE", waste=10, pack=1, source="length"), C("Backer rod", "LF", "LF", waste=10, source="length")],
  [P("lf_per_tube", "Joint length per tube", 24, "LF")])
A("07 84 00", "Firestopping at penetrations", "Firestopping", "count",
  "One firestop system per counted penetration; a tube of sealant does about four small pipe penetrations.",
  [C("Firestop systems", "EA", "EA", source="count"), C("Firestop sealant", "EA / 4", "TUBE", waste=10, pack=1, source="count")])
A("07 13 00", "Below-grade waterproofing", "Waterproofing", "polylength",
  "Sheet membrane covers the wall area below grade with 10 percent for laps; protection board over it.",
  [C("Membrane", WALL_AREA, "SF", waste=10, source="wall_area"), C("Protection board", WALL_AREA + " / 32", "SHEET", waste=5, pack=1, source="wall_area")],
  [P("height_ft", "Depth below grade", 8, "ft")])
A("07 11 13", "Dampproofing", "Waterproofing", "polylength",
  "Asphalt dampproofing covers about 50 SF a gallon a coat on concrete.",
  [C("Dampproofing", WALL_AREA + " / 50", "GAL", waste=10, pack=5, source="wall_area")], [P("height_ft", "Depth below grade", 8, "ft")])
A("07 46 33", "Vinyl siding", "Siding", "polylength",
  "Siding is sold by the square (100 SF) with 10 percent waste; J channel around openings and corner posts are "
  "counted from the openings and corners parameters.",
  [C("Siding", WALL_AREA + " / 100", "SQ", waste=10, pack=1, source="wall_area"),
   C("Starter strip", "LF", "LF", waste=10, pack=12, source="length"), C("Outside corners", "corners", "EA", pack=1, source="each")],
  [H9, P("corners", "Outside corners", 4)])
A("07 46 46", "Fiber cement lap siding", "Siding", "polylength",
  "Planks cover their exposure: plank LF per SF is 12 over the exposure in inches, in 12 ft planks, 10 percent waste.",
  [C("Lap siding", WALL_AREA + " * 12 / exposure_in / 12", "EA", waste=10, pack=1, source="wall_area"),
   C("Siding nails", WALL_AREA + " / 500", "BOX", pack=1, source="wall_area")],
  [H9, P("exposure_in", "Exposure", 7, "in")])
A("09 24 00", "Portland cement stucco", "Plaster", "polylength",
  "Three coats total about 7/8 in; one bag of cement plaster covers about 12 SF at that thickness; lath under it.",
  [C("Metal lath", WALL_AREA, "SF", waste=10, source="wall_area"), C("Plaster", WALL_AREA + " / 12", "BAG", waste=10, pack=1, source="wall_area"),
   C("Weep screed", "LF", "LF", waste=5, pack=10, source="length")], [H9])
A("07 24 00", "Exterior insulation and finish system", "Siding", "polylength",
  "Foam board 2 x 4 ft (8 SF), mesh and base coat over the area, finish coat at about 100 SF a pail.",
  [C("Foam board", WALL_AREA + " / 8", "SHEET", waste=10, pack=1, source="wall_area"),
   C("Reinforcing mesh", WALL_AREA, "SF", waste=10, source="wall_area"),
   C("Finish coat", WALL_AREA + " / 100", "PAIL", waste=5, pack=1, source="wall_area")], [H9])

# ---------------------------------------------------------------- 08 Openings
A("08 14 16", "Interior door, prehung", "Doors", "count",
  "Each counted door: the slab and frame, three hinges, a lockset and a door stop.",
  [C("Prehung door", "EA", "EA", source="count"), C("Hinges", "EA * 3", "EA", source="count"),
   C("Lockset", "EA", "EA", source="count"), C("Door stop", "EA", "EA", source="count")])
A("08 14 16", "Exterior door", "Doors", "count",
  "Each counted door: prehung unit, threshold, weatherstripping set, deadbolt and lockset.",
  [C("Exterior door unit", "EA", "EA", source="count"), C("Threshold", "EA", "EA", source="count"),
   C("Weatherstripping set", "EA", "EA", source="count"), C("Deadbolt", "EA", "EA", source="count"), C("Lockset", "EA", "EA", source="count")])
A("08 11 13", "Hollow metal door and frame", "Doors", "count",
  "Each counted opening: frame, door, and anchors (about three per jamb).",
  [C("Hollow metal frame", "EA", "EA", source="count"), C("Hollow metal door", "EA", "EA", source="count"),
   C("Frame anchors", "EA * 6", "EA", source="count")])
A("08 71 00", "Door hardware set", "Hardware", "count",
  "A typical set per counted door: hinges (3), lever set, closer and wall stop.",
  [C("Hinges", "EA * 3", "EA", source="count"), C("Lever set", "EA", "EA", source="count"),
   C("Closer", "EA * closers", "EA", source="count"), C("Wall stop", "EA", "EA", source="count")], [P("closers", "Closers per door", 1)])
A("08 50 00", "Windows", "Windows", "count",
  "Each counted window: the unit, flashing tape around its perimeter with 10 percent lap, and sealant.",
  [C("Window unit", "EA", "EA", source="count"), C("Flashing tape", "EA * 2 * (width_ft + height_ft)", "LF", waste=10, source="count"),
   C("Sealant", "EA * 2 * (width_ft + height_ft) / 24", "TUBE", waste=10, pack=1, source="count")],
  [P("width_ft", "Window width", 3, "ft"), P("height_ft", "Window height", 4, "ft")])
A("08 41 13", "Aluminum storefront", "Storefront", "length",
  "Storefront by elevation: length times height in glass area, mullions every 5 ft.",
  [C("Storefront", "LF * height_ft", "SF", waste=3, source="length"), C("Vertical mullions", "ceil(LF / 5) + N", "EA", pack=1, source="length")],
  [P("height_ft", "Storefront height", 10, "ft")])
A("08 36 13", "Overhead sectional door", "Doors", "count",
  "Each counted door: the door with its track, and an operator. Doors are ordered to the opening size, so there is no waste.",
  [C("Sectional door", "EA", "EA", source="count"), C("Operator", "EA", "EA", source="count")])
A("08 62 00", "Skylight", "Windows", "count",
  "Each counted skylight with the curb flashing kit made for it; a skylight is a unit, so there is no waste factor.",
  [C("Skylight", "EA", "EA", source="count"), C("Flashing kit", "EA", "EA", source="count")])
A("08 31 00", "Access panel", "Doors", "count",
  "One panel per counted opening; panels are made to size, so the count is the order.", [C("Access panel", "EA", "EA", source="count")])

# ---------------------------------------------------------------- 09 Finishes
for label, sides, layers, thick in (("1/2 in, one side", 1, 1, "1/2"), ("1/2 in, both sides", 2, 1, "1/2"),
                                    ("5/8 in Type X, both sides", 2, 1, "5/8"), ("5/8 in Type X, two layers each side", 2, 2, "5/8")):
    A("09 29 00", f"Gypsum board wall, {label}", "Drywall", "polylength",
      f"Board area is wall area times {sides} side(s) times {layers} layer(s) over 32 SF a 4 x 8 sheet, with 10 percent "
      "waste for openings and offcuts. Screws run about one per SF of board, in boxes of 1,000; joint compound about "
      "1 gallon per 100 SF of taped face (4.5 gallon pails) and tape about 0.37 LF per SF.",
      [C(f"Gypsum board {thick} in", f"{WALL_AREA} * {sides} * {layers} / 32", "SHEET", waste=10, pack=1, source="wall_area"),
       C("Screws", f"{WALL_AREA} * {sides} * {layers}", "EA", waste=5, pack=1000, source="wall_area"),
       C("Joint compound", f"{WALL_AREA} * {sides} / 100", "GAL", waste=5, pack=4.5, source="wall_area"),
       C("Joint tape", f"{WALL_AREA} * {sides} * 0.37", "LF", waste=5, pack=500, source="wall_area")], [H9])
A("09 29 00", "Gypsum board ceiling", "Drywall", "area",
  "Ceiling board, 1/2 in sag-resistant, over 32 SF a sheet with 10 percent waste; compound and tape as on walls.",
  [C("Ceiling board", "SF / 32", "SHEET", waste=10, pack=1), C("Screws", "SF * 1.2", "EA", waste=5, pack=1000),
   C("Joint compound", "SF / 100", "GAL", waste=5, pack=4.5), C("Joint tape", "SF * 0.37", "LF", waste=5, pack=500)])
A("09 29 00", "Moisture-resistant board", "Drywall", "polylength",
  "Wet-area walls, one side, over 32 SF a sheet with 10 percent waste.",
  [C("Moisture-resistant board", WALL_AREA + " / 32", "SHEET", waste=10, pack=1, source="wall_area")], [H9])
A("09 28 13", "Cement backer board", "Tile backing", "area",
  "Backer board 3 x 5 ft (15 SF) with 10 percent waste; screws at about 1 per SF and mesh tape on seams.",
  [C("Backer board", "SF / 15", "SHEET", waste=10, pack=1), C("Backer screws", "SF * 1.1", "EA", waste=5, pack=500),
   C("Mesh tape", "SF * 0.5", "LF", waste=5, pack=150)])
A("09 22 16", "Metal stud partition with board both sides", "Drywall", "polylength",
  "Studs at the spacing plus one per wall end, top and bottom track, and 5/8 in board both sides over 32 SF a sheet.",
  [C("Metal studs", "ceil(LF * 12 / spacing_in) + N", "EA", waste=5, pack=1, source="length"),
   C("Track", "LF * 2", "LF", waste=5, pack=10, source="length"),
   C("Gypsum board", WALL_AREA + " * 2 / 32", "SHEET", waste=10, pack=1, source="wall_area")],
  [H9, P("spacing_in", "Stud spacing", 16, "in")])
for size, tile_sf in (("2 x 2 ft", 4), ("2 x 4 ft", 8)):
    A("09 51 13", f"Acoustical ceiling, {size}", "Ceilings", "area",
      f"Tiles at {tile_sf} SF each with 5 percent for border cuts. Main runners every 4 ft (SF / 4 LF), cross tees "
      f"fill the module (one 4 ft or 2 ft tee per tile on 2 x 2, one 4 ft tee per tile on 2 x 4), wall angle runs the room perimeter, and a hanger wire every 16 SF.",
      [C(f"Ceiling tiles {size}", f"SF / {tile_sf}", "EA", waste=5, pack=1), C("Main runners", "SF / 4", "LF", waste=5, pack=12),
       C("Cross tees", f"SF / {tile_sf if tile_sf == 4 else 8}", "EA", waste=5, pack=1),
       C("Wall angle", "PF", "LF", waste=10, pack=12, source="perimeter"), C("Hanger wires", "SF / 16", "EA", waste=5, pack=1)])
A("09 91 23", "Paint walls, primer and two coats", "Painting", "polylength",
  "Paint covers about 350 SF a gallon a coat on smooth board; primer the same. 5 percent for touch-up and loss.",
  [C("Primer", WALL_AREA + " / 350", "GAL", waste=5, pack=1, source="wall_area"),
   C("Finish paint", WALL_AREA + " * coats / 350", "GAL", waste=5, pack=1, source="wall_area")], [H9, P("coats", "Finish coats", 2)])
A("09 91 23", "Paint ceilings", "Painting", "area",
  "Flat ceiling paint covers about 350 SF a gallon a coat on primed board; 5 percent covers loss in the tray and touch-up.",
  [C("Ceiling paint", "SF * coats / 350", "GAL", waste=5, pack=1)], [P("coats", "Coats", 2)])
A("09 91 23", "Paint trim", "Painting", "length",
  "Trim paints about 1 SF per LF of 4 in trim; a quart covers about 100 SF.",
  [C("Trim paint", "LF * coats / 100", "QT", waste=10, pack=1, source="length")], [P("coats", "Coats", 2)])
A("09 91 23", "Paint doors and frames", "Painting", "count",
  "A door and frame both sides is about 50 SF; at 350 SF a gallon a coat.",
  [C("Door paint", "EA * 50 * coats / 350", "GAL", waste=10, pack=1, source="count")], [P("coats", "Coats", 2)])
A("09 93 00", "Stain and clear finish", "Painting", "area",
  "Stain covers about 250 SF a gallon; clear coat about 400 SF a gallon a coat.",
  [C("Stain", "SF / 250", "GAL", waste=5, pack=1), C("Clear finish", "SF * 2 / 400", "GAL", waste=5, pack=1)])
A("09 96 46", "Epoxy floor coating", "Coatings", "area",
  "Two-part epoxy kits cover about 250 SF a coat; primer one coat and two finish coats.",
  [C("Epoxy primer", "SF / 250", "KIT", waste=5, pack=1), C("Epoxy finish", "SF * 2 / 250", "KIT", waste=5, pack=1)])
A("09 68 16", "Broadloom carpet", "Carpet", "area",
  "Carpet is sold by the square yard (9 SF) from 12 ft rolls; 10 percent covers seams and pattern match. Pad matches "
  "the carpet; tack strip runs the room perimeter.",
  [C("Carpet", "SF / 9", "SY", waste=10), C("Pad", "SF / 9", "SY", waste=10), C("Tack strip", "PF", "LF", waste=5, pack=4, source="perimeter")])
A("09 68 13", "Carpet tile", "Carpet", "area",
  "24 x 24 in tiles (4 SF) with 5 percent for border cuts; adhesive about 400 SF a gallon.",
  [C("Carpet tiles", "SF / 4", "EA", waste=5, pack=1), C("Tile adhesive", "SF / 400", "GAL", waste=5, pack=1)])
A("09 65 16", "Resilient sheet flooring", "Resilient", "area",
  "Sheet goods from 6 or 12 ft rolls; 10 percent for seams and fitting.",
  [C("Sheet flooring", "SF / 9", "SY", waste=10), C("Adhesive", "SF / 150", "GAL", waste=5, pack=1)])
A("09 65 19", "Luxury vinyl tile or plank", "Resilient", "area",
  "Planks come in cartons; the default carton covers 24 SF; 7 percent waste for straight lay.",
  [C("Vinyl plank", "SF / carton_sf", "CTN", waste=7, pack=1)], [P("carton_sf", "Square feet per carton", 24, "SF")])
A("09 65 19", "Vinyl composition tile", "Resilient", "area",
  "12 x 12 in tile, 45 to a box, 5 percent waste; adhesive about 200 SF a gallon.",
  [C("VCT", "SF / 45", "BOX", waste=5, pack=1), C("VCT adhesive", "SF / 200", "GAL", waste=5, pack=1)])
A("09 30 13", "Ceramic floor tile", "Tile", "area",
  "Tile area with 10 percent for cuts (15 percent on a diagonal). Thinset about 50 SF a 50 lb bag with a 1/4 in notch; "
  "grout about 1 lb per 8 SF for 12 in tile with 1/8 in joints.",
  [C("Floor tile", "SF", "SF", waste=10), C("Thinset", "SF / 50", "BAG", waste=5, pack=1), C("Grout", "SF / 8", "LB", waste=10, pack=25)])
A("09 30 13", "Ceramic wall tile", "Tile", "polylength",
  "Wall tile over the wall area, 10 percent for cuts; mastic about 50 SF a gallon; grout about 1 lb per 10 SF.",
  [C("Wall tile", WALL_AREA, "SF", waste=10, source="wall_area"), C("Mastic", WALL_AREA + " / 50", "GAL", waste=5, pack=1, source="wall_area"),
   C("Grout", WALL_AREA + " / 10", "LB", waste=10, pack=25, source="wall_area")], [P("height_ft", "Tile height", 8, "ft")])
A("09 30 16", "Large-format porcelain tile", "Tile", "area",
  "Large tile with 12 percent waste (less flexible cuts); large-format mortar about 40 SF a bag; leveling clips about 4 per tile.",
  [C("Porcelain tile", "SF", "SF", waste=12), C("Large-format mortar", "SF / 40", "BAG", waste=5, pack=1),
   C("Leveling clips", "SF / tile_sf * 4", "EA", waste=10, pack=100)], [P("tile_sf", "Tile size", 4, "SF")])
A("09 64 29", "Hardwood flooring", "Wood flooring", "area",
  "Strip hardwood with 7 percent waste for end cuts (10 percent on diagonals); underlayment paper and cleats at about 1 per SF.",
  [C("Hardwood", "SF", "SF", waste=7), C("Underlayment", "SF / 400", "ROLL", waste=10, pack=1), C("Flooring cleats", "SF * 1.1", "EA", waste=5, pack=1000)])
A("09 62 19", "Laminate flooring", "Wood flooring", "area",
  "Floating laminate in cartons (default 20 SF) with 8 percent waste; foam underlayment rolls of 100 SF.",
  [C("Laminate", "SF / carton_sf", "CTN", waste=8, pack=1), C("Underlayment", "SF / 100", "ROLL", waste=10, pack=1)],
  [P("carton_sf", "Square feet per carton", 20, "SF")])
A("09 65 13", "Resilient base", "Base", "length",
  "Rubber or vinyl base in 120 ft coils with 5 percent waste; adhesive one tube per 40 LF; outside corners are counted separately.",
  [C("Resilient base", "LF / 120", "COIL", waste=5, pack=1, source="length"), C("Base adhesive", "LF / 40", "TUBE", waste=5, pack=1, source="length")])
A("09 05 61", "Self-leveling underlayment", "Floor prep", "area",
  "A 50 lb bag covers about 50 SF at 1/8 in, so bags are area times thickness over 6.25.",
  [C("Self-leveler", "SF * thickness_in / 6.25", "BAG", waste=10, pack=1), C("Primer", "SF / 300", "GAL", waste=5, pack=1)],
  [P("thickness_in", "Average thickness", 0.25, "in")])
A("09 72 00", "Wallcovering", "Wallcovering", "polylength",
  "A double roll gives about 56 SF of usable covering after pattern match; 15 percent extra for matching.",
  [C("Wallcovering", WALL_AREA + " / 56", "DROLL", waste=15, pack=1, source="wall_area")], [H9])
A("03 35 43", "Polished concrete floor", "Coatings", "area",
  "Grinding and polishing by area with densifier at about 400 SF a gallon.",
  [C("Grind and polish", "SF", "SF"), C("Densifier", "SF / 400", "GAL", waste=5, pack=1)])

# ---------------------------------------------------------------- 10 Specialties
A("10 21 13", "Toilet compartments", "Toilet rooms", "count",
  "Each counted compartment: panels, door and one pilaster, plus one extra pilaster per run.",
  [C("Compartments", "EA", "EA", source="count"), C("Extra pilasters", "N", "EA", source="each")])
A("10 28 13", "Toilet accessories set", "Toilet rooms", "count",
  "Per counted toilet room: grab bars (2), paper dispenser, mirror, soap dispenser and towel dispenser.",
  [C("Grab bars", "EA * 2", "EA", source="count"), C("Paper dispenser", "EA", "EA", source="count"),
   C("Mirror", "EA", "EA", source="count"), C("Soap dispenser", "EA", "EA", source="count"), C("Towel dispenser", "EA", "EA", source="count")])
A("10 44 13", "Fire extinguisher and cabinet", "Fire protection specialties", "count",
  "One extinguisher and one cabinet per counted location; travel distance rules set where they go, the count sets how many.",
  [C("Extinguisher", "EA", "EA", source="count"), C("Cabinet", "EA", "EA", source="count")])
A("10 14 00", "Room signs", "Signage", "count",
  "One sign per counted door or room; signs are made to order, so the count is the order with no waste.", [C("Signs", "EA", "EA", source="count")])
A("10 51 13", "Metal lockers", "Lockers", "count",
  "Count each locker; base and end panels about one per six lockers.",
  [C("Lockers", "EA", "EA", source="count"), C("End panels", "ceil(EA / 6) + N", "EA", source="count")])
A("10 26 00", "Corner guards", "Wall protection", "count",
  "One guard per counted outside corner, in the height given (4 ft is common in corridors).", [C("Corner guards", "EA", "EA", source="count")], [P("height_ft", "Guard height", 4, "ft")])
A("10 26 00", "Wall protection rail", "Wall protection", "length",
  "Crash rail along the drawn length in 12 ft pieces with end caps per run.",
  [C("Crash rail", "LF", "LF", waste=5, pack=12, source="length"), C("End caps", "N * 2", "EA", source="each")])

# ---------------------------------------------------------------- 11 Equipment and 12 Furnishings
A("11 31 00", "Residential appliances", "Appliances", "count",
  "One appliance per count with its own connection kit (water line, cord or vent), since each one needs a separate hookup.", [C("Appliances", "EA", "EA", source="count"), C("Connection kits", "EA", "EA", source="count")])
A("12 21 13", "Window blinds", "Window treatments", "count",
  "One blind per counted window; blinds are cut to each opening, so there is no waste factor.", [C("Blinds", "EA", "EA", source="count")])
A("12 36 00", "Window sills, solid surface", "Countertops", "count",
  "Each counted window gets a sill the opening width plus 1 in of horn at each end; 10 percent covers cutting from stock lengths.",
  [C("Sills", "EA * (width_ft + 2 / 12)", "LF", waste=10, source="count")], [P("width_ft", "Window width", 3, "ft")])

# ---------------------------------------------------------------- 21 Fire suppression
A("21 13 13", "Sprinkler heads", "Sprinklers", "count",
  "Each counted head with a drop (arm-over) of pipe and two fittings.",
  [C("Sprinkler heads", "EA", "EA", waste=2, pack=1, source="count"), C("Drop pipe", "EA * drop_ft", "LF", waste=10, source="count"),
   C("Fittings", "EA * 2", "EA", waste=5, pack=1, source="count")], [P("drop_ft", "Pipe per head", 8, "LF")])
A("21 13 13", "Sprinklers by floor area", "Sprinklers", "area",
  "A budget count of heads: area over the coverage per head (130 SF is common for light hazard design; the code "
  "maximum is larger), rounded up, with branch line at about 12 ft per head.",
  [C("Sprinkler heads", "ceil(SF / coverage_sf)", "EA", pack=1), C("Branch line pipe", "ceil(SF / coverage_sf) * 12", "LF", waste=10)],
  [P("coverage_sf", "Coverage per head", 130, "SF")])
A("21 11 00", "Fire department connection", "Sprinklers", "count",
  "One fire department connection per counted location, with its check valve set as one unit.", [C("Fire department connection", "EA", "EA", source="count")])

# ---------------------------------------------------------------- 22 Plumbing
A("22 40 00", "Plumbing fixture rough-in", "Fixtures", "count",
  "Each counted fixture: supply and waste piping allowances in feet, a trap and stop valves.",
  [C("Supply pipe", "EA * supply_ft", "LF", waste=10, source="count"), C("Waste pipe", "EA * waste_ft", "LF", waste=10, source="count"),
   C("Traps", "EA", "EA", source="count"), C("Stop valves", "EA * 2", "EA", source="count")],
  [P("supply_ft", "Supply pipe per fixture", 20, "LF"), P("waste_ft", "Waste pipe per fixture", 12, "LF")])
A("22 42 13", "Water closets", "Fixtures", "count",
  "Each counted toilet: fixture, seat, wax ring and closet bolts, and a supply line.",
  [C("Water closet", "EA", "EA", source="count"), C("Seat", "EA", "EA", source="count"), C("Wax ring and bolts", "EA", "EA", source="count"),
   C("Supply line", "EA", "EA", source="count")])
A("22 42 16", "Lavatories", "Fixtures", "count",
  "Each counted lavatory: fixture, faucet, trap and two supply lines.",
  [C("Lavatory", "EA", "EA", source="count"), C("Faucet", "EA", "EA", source="count"), C("Trap", "EA", "EA", source="count"),
   C("Supply lines", "EA * 2", "EA", source="count")])
A("22 42 16", "Sinks", "Fixtures", "count",
  "Each counted sink: fixture, faucet, basket strainers, trap and supply lines.",
  [C("Sink", "EA", "EA", source="count"), C("Faucet", "EA", "EA", source="count"), C("Strainers", "EA * bowls", "EA", source="count"),
   C("Trap", "EA", "EA", source="count")], [P("bowls", "Bowls per sink", 2)])
A("22 33 00", "Water heater", "Equipment", "count",
  "Each counted heater with an expansion tank, relief discharge piping and a pan.",
  [C("Water heater", "EA", "EA", source="count"), C("Expansion tank", "EA", "EA", source="count"), C("Drain pan", "EA", "EA", source="count")])
A("22 13 19", "Floor drains", "Drainage", "count",
  "Each counted drain with a trap primer connection and 10 ft of waste pipe.",
  [C("Floor drain", "EA", "EA", source="count"), C("Waste pipe", "EA * 10", "LF", waste=10, source="count")])
A("22 11 16", "Domestic water piping", "Piping", "length",
  "Pipe along the drawn route with 10 percent for offsets, one fitting per 10 ft, hangers every 6 ft, in 20 ft sticks.",
  [C("Water pipe", "LF", "LF", waste=10, pack=20, source="length"), C("Fittings", "LF / 10", "EA", waste=10, pack=1, source="length"),
   C("Hangers", "LF / 6", "EA", pack=1, source="length")])
A("22 13 16", "Drain, waste and vent piping", "Piping", "length",
  "Pipe along the route with 10 percent waste, one fitting per 8 ft, hangers every 4 ft, in 10 ft lengths; cement "
  "and primer about one quart pair per 100 joints.",
  [C("DWV pipe", "LF", "LF", waste=10, pack=10, source="length"), C("Fittings", "LF / 8", "EA", waste=10, pack=1, source="length"),
   C("Hangers", "LF / 4", "EA", pack=1, source="length")])
A("22 11 23", "Fuel gas piping", "Piping", "length",
  "Black steel or flexible gas pipe along the route, fittings every 10 ft, hangers every 6 ft.",
  [C("Gas pipe", "LF", "LF", waste=10, source="length"), C("Fittings", "LF / 10", "EA", waste=10, pack=1, source="length"),
   C("Hangers", "LF / 6", "EA", pack=1, source="length")])
A("22 05 76", "Cleanouts", "Drainage", "count",
  "One cleanout per counted location; codes call for them at changes of direction and at set intervals along a run.", [C("Cleanouts", "EA", "EA", source="count")])

# ---------------------------------------------------------------- 23 HVAC
A("23 37 13", "Supply diffusers", "Air distribution", "count",
  "Each counted diffuser with its flex connection (default 8 ft) and a balancing damper.",
  [C("Diffusers", "EA", "EA", source="count"), C("Flex duct", "EA * flex_ft", "LF", waste=10, source="count"),
   C("Balancing dampers", "EA", "EA", source="count")], [P("flex_ft", "Flex duct per diffuser", 8, "LF")])
A("23 37 13", "Return grilles", "Air distribution", "count",
  "One return grille per counted opening; grilles are sized to the duct, so the count is the order.", [C("Return grilles", "EA", "EA", source="count")])
A("23 31 13", "Rectangular ductwork", "Ductwork", "length",
  "Sheet metal weight is the duct perimeter times the length times the sheet weight per SF (24 gauge galvanized is "
  "about 1.156 lb/SF), plus 20 percent for seams, joints and hangers.",
  [C("Ductwork", "LF * perimeter_in / 12 * lb_per_sf", "LB", waste=20, source="length"),
   C("Duct sealant", "LF * perimeter_in / 12 / 75", "GAL", waste=10, pack=1, source="length"),
   C("Hangers", "LF / 8", "EA", pack=1, source="length")],
  [P("perimeter_in", "Duct perimeter", 64, "in"), P("lb_per_sf", "Sheet weight", 1.156, "lb/SF")])
A("23 31 13", "Round flexible duct", "Ductwork", "length",
  "Flex duct comes in 25 ft boxes; 10 percent for slack and connections.",
  [C("Flex duct", "LF / 25", "BOX", waste=10, pack=1, source="length")])
A("23 34 23", "Exhaust fans", "Fans", "count",
  "Each counted fan with a roof or wall cap and about 10 ft of duct to the outside, with 10 percent duct waste.",
  [C("Exhaust fans", "EA", "EA", source="count"), C("Caps", "EA", "EA", source="count"), C("Duct", "EA * 10", "LF", waste=10, source="count")])
A("23 09 23", "Thermostats", "Controls", "count",
  "One thermostat per counted zone with about 50 ft of control cable back to the equipment.",
  [C("Thermostats", "EA", "EA", source="count"), C("Control cable", "EA * 50", "LF", waste=10, source="count")])
A("23 07 13", "Duct insulation wrap", "Ductwork", "length",
  "Wrap covers the duct perimeter times length with 10 percent for laps; tape at the seams.",
  [C("Duct wrap", "LF * perimeter_in / 12", "SF", waste=10, source="length")], [P("perimeter_in", "Duct perimeter", 64, "in")])
A("23 81 00", "Cooling by floor area (budget)", "Equipment", "area",
  "A budget check only: a common rule is about one ton of cooling per 400 SF of conditioned area. A load calculation "
  "sets the real size.",
  [C("Cooling capacity", "SF / sf_per_ton", "TON", pack=0.5)], [P("sf_per_ton", "Square feet per ton", 400, "SF")])

# ---------------------------------------------------------------- 26 Electrical
A("26 27 26", "Duplex receptacles", "Devices", "count",
  "Each counted outlet: device, box, cover plate and a branch cable allowance (default 25 ft) in 250 ft coils.",
  [C("Receptacles", "EA", "EA", waste=2, pack=1, source="count"), C("Device boxes", "EA", "EA", source="count"),
   C("Cover plates", "EA", "EA", source="count"), C("Branch cable", "EA * cable_ft / 250", "COIL", waste=10, pack=1, source="count")],
  [P("cable_ft", "Cable per device", 25, "LF")])
A("26 27 26", "Switches", "Devices", "count",
  "Each counted switch: device, box, plate and a cable allowance (default 20 ft) with 10 percent for terminations.",
  [C("Switches", "EA", "EA", source="count"), C("Device boxes", "EA", "EA", source="count"), C("Cover plates", "EA", "EA", source="count"),
   C("Branch cable", "EA * cable_ft", "LF", waste=10, source="count")], [P("cable_ft", "Cable per device", 20, "LF")])
A("26 51 00", "Recessed light fixtures", "Lighting", "count",
  "Each counted fixture with a whip (default 6 ft) and cable allowance.",
  [C("Recessed fixtures", "EA", "EA", source="count"), C("Fixture whips", "EA", "EA", source="count"),
   C("Branch cable", "EA * cable_ft", "LF", waste=10, source="count")], [P("cable_ft", "Cable per fixture", 15, "LF")])
A("26 51 00", "Lay-in troffers, 2 x 4", "Lighting", "count",
  "Each counted troffer with a flexible whip and two independent tie wires from the structure, as lay-in fixtures need in most ceilings.",
  [C("Troffers", "EA", "EA", source="count"), C("Fixture whips", "EA", "EA", source="count"), C("Tie wires", "EA * 2", "EA", source="count")])
A("26 52 00", "Exit and emergency lights", "Lighting", "count",
  "One exit sign or emergency light per counted location; units are complete with battery, so the count is the order.", [C("Exit or emergency units", "EA", "EA", source="count")])
A("26 24 16", "Panelboards", "Distribution", "count",
  "Each counted panel with its circuit breakers (default 24 spaces).",
  [C("Panelboards", "EA", "EA", source="count"), C("Circuit breakers", "EA * breakers", "EA", source="count")], [P("breakers", "Breakers per panel", 24)])
A("26 05 33", "EMT conduit with wire", "Raceways", "length",
  "Conduit along the route in 10 ft sticks with 10 percent for bends; a coupling per stick, a strap every 8 ft, and "
  "wire the conduit length times the conductors plus 10 percent for terminations.",
  [C("EMT conduit", "LF", "LF", waste=10, pack=10, source="length"), C("Couplings", "LF / 10", "EA", waste=5, pack=1, source="length"),
   C("Straps", "LF / 8", "EA", pack=1, source="length"), C("Building wire", "LF * conductors * 1.1", "LF", waste=5, pack=500, source="length")],
  [P("conductors", "Conductors in the conduit", 3)])
A("26 05 19", "Nonmetallic cable runs", "Wiring", "length",
  "Cable along the drawn route plus 15 percent for drops and terminations, in 250 ft coils; staples every 4 ft.",
  [C("NM cable", "LF / 250", "COIL", waste=15, pack=1, source="length"), C("Staples", "LF / 4", "EA", pack=100, source="length")])
A("27 15 00", "Data outlets", "Communications", "count",
  "Each counted outlet: jacks (default 2), faceplate, box and a cable run (default 150 ft, under the 295 ft channel limit).",
  [C("Jacks", "EA * jacks", "EA", source="count"), C("Faceplates", "EA", "EA", source="count"),
   C("Cable", "EA * jacks * run_ft / 1000", "BOX", waste=10, pack=1, source="count")],
  [P("jacks", "Jacks per outlet", 2), P("run_ft", "Average run", 150, "LF")])
A("28 31 00", "Smoke detectors", "Fire alarm", "count",
  "Each counted detector with its base and about 30 ft of cable to the next device, plus 10 percent for terminations.",
  [C("Detectors", "EA", "EA", source="count"), C("Bases", "EA", "EA", source="count"), C("Cable", "EA * 30", "LF", waste=10, source="count")])
A("26 51 00", "Lighting by floor area", "Lighting", "area",
  "A layout check: fixtures at one per the coverage area (64 SF suits 2 x 4 troffers on an 8 ft grid), rounded up.",
  [C("Fixtures", "ceil(SF / coverage_sf)", "EA", pack=1)], [P("coverage_sf", "Coverage per fixture", 64, "SF")])
A("26 56 00", "Site light poles", "Lighting", "count",
  "Each counted pole: pole, fixture head(s) and a concrete base.",
  [C("Poles", "EA", "EA", source="count"), C("Fixture heads", "EA * heads", "EA", source="count"),
   C("Pole base concrete", "EA * 0.75", "CY", waste=10, pack=0.25, source="count")], [P("heads", "Heads per pole", 1)])

# ---------------------------------------------------------------- 31 Earthwork
A("31 23 16", "Bulk excavation", "Excavation", "volume",
  "Measure the cut as a volume (area times depth). Soil swells about 25 percent when dug; trucks haul about 12 loose CY.",
  [C("Excavation, bank", "CY", "CY", source="volume"), C("Haul, loose", "CY * 1.25", "CY", source="volume"),
   C("Truck loads", "CY * 1.25", "LOAD", pack=12, source="volume")])
A("31 23 16", "Trench excavation and backfill", "Excavation", "length",
  "Trench volume is length times width times depth. Bedding fills 6 in under the pipe; backfill is the rest, with 15 "
  "percent extra because compacted soil takes more than its bank volume.",
  [C("Trench excavation", "LF * width_ft * depth_ft / 27", "CY", source="length"),
   C("Bedding", "LF * width_ft * 0.5 / 27", "CY", waste=10, pack=1, source="length"),
   C("Backfill, compacted", "LF * width_ft * (depth_ft - 0.5) / 27 * 1.15", "CY", source="length")],
  [P("width_ft", "Trench width", 2, "ft"), P("depth_ft", "Trench depth", 4, "ft")])
A("31 23 23", "Fill and compaction", "Fill", "volume",
  "Compacted fill needs about 25 percent more loose material than its finished volume.",
  [C("Fill, compacted", "CY", "CY", source="volume"), C("Fill, loose delivered", "CY * 1.25", "CY", pack=1, source="volume")])
A("31 22 13", "Fine grading", "Grading", "area",
  "Fine grading is priced by the square yard: the drawn area over 9. No waste, since it is a service on the area itself.", [C("Fine grading", "SF / 9", "SY")])
A("31 05 16", "Aggregate base", "Base", "area",
  "Base volume is area times thickness; crushed stone weighs about 1.4 tons a CY placed, and compaction takes about 15 "
  "percent more material.",
  [C("Aggregate base", "SF * thickness_in / 12 / 27 * 1.4", "TON", waste=15)], [P("thickness_in", "Base thickness", 6, "in")])
A("31 14 13", "Topsoil", "Landscape prep", "area",
  "Topsoil volume is area times depth, with 15 percent for settling.",
  [C("Topsoil", "SF * depth_in / 12 / 27", "CY", waste=15, pack=1)], [P("depth_in", "Topsoil depth", 4, "in")])
A("31 25 00", "Silt fence", "Erosion control", "length",
  "Fence along the drawn line with stakes every 6 ft, in 100 ft rolls.",
  [C("Silt fence", "LF / 100", "ROLL", waste=5, pack=1, source="length"), C("Stakes", "LF / 6 + N", "EA", pack=1, source="length")])
A("31 25 00", "Inlet protection", "Erosion control", "count",
  "One filter per counted storm inlet, kept in place until the site is stabilized.", [C("Inlet filters", "EA", "EA", source="count")])

# ---------------------------------------------------------------- 32 Exterior improvements
A("32 12 16", "Asphalt paving", "Paving", "area",
  "Asphalt weighs about 145 lb per CF in place: tons are area times thickness in feet times 145 over 2,000. Tack coat "
  "about 0.05 gallon a SY between lifts; aggregate base under it.",
  [C("Asphalt", "SF * thickness_in / 12 * 145 / 2000", "TON", waste=5),
   C("Aggregate base", "SF * base_in / 12 / 27 * 1.4", "TON", waste=15), C("Tack coat", "SF / 9 * 0.05", "GAL", waste=5, pack=1)],
  [P("thickness_in", "Asphalt thickness", 3, "in"), P("base_in", "Base thickness", 6, "in")])
A("32 16 13", "Concrete curb and gutter", "Curbs", "length",
  "Concrete is the section area times the length (a 6 in curb with a 24 in gutter is about 1.6 SF), forms both faces, "
  "joints every 10 ft.",
  [C("Concrete", "LF * section_sf / 27", "CY", waste=5, pack=0.25, source="length"),
   C("Forms", "LF * 2", "LF", waste=5, source="length"), C("Joints", "LF / 10", "EA", pack=1, source="length")],
  [P("section_sf", "Section area", 1.6, "SF")])
A("32 16 13", "Concrete curb", "Curbs", "length",
  "Concrete is the section area times length (a 6 x 18 in curb is 0.75 SF).",
  [C("Concrete", "LF * section_sf / 27", "CY", waste=5, pack=0.25, source="length"), C("Forms", "LF * 2", "LF", waste=5, source="length")],
  [P("section_sf", "Section area", 0.75, "SF")])
A("32 13 13", "Concrete sidewalk", "Walks", "area",
  "Concrete is area times thickness; control joints every 5 ft across a 5 ft walk come to about 0.2 LF a SF.",
  [C("Concrete", "SF * thickness_in / 12 / 27", "CY", waste=5, pack=0.25), C("Control joints", "SF * 0.2", "LF"),
   C("Aggregate base", "SF * 4 / 12 / 27 * 1.4", "TON", waste=15)], [P("thickness_in", "Walk thickness", 4, "in")])
A("32 17 23", "Pavement striping", "Markings", "length",
  "A 4 in line uses about one gallon of traffic paint per 300 LF.",
  [C("Striping", "LF", "LF", source="length"), C("Traffic paint", "LF / 300", "GAL", waste=10, pack=5, source="length")])
A("32 17 23", "Parking stall striping", "Markings", "count",
  "Each counted stall shares lines with its neighbor: about one 18 ft line per stall plus one per row.",
  [C("Striping", "EA * 18 + N * 18", "LF", source="count"), C("Traffic paint", "(EA + N) * 18 / 300", "GAL", waste=10, pack=1, source="count")])
A("32 17 13", "Wheel stops", "Markings", "count",
  "Each counted wheel stop with the two anchor pins that hold it to the pavement.", [C("Wheel stops", "EA", "EA", source="count"), C("Pins", "EA * 2", "EA", source="count")])
A("32 92 23", "Sod", "Lawns", "area",
  "Sod by area with 5 percent for cuts; a pallet covers about 450 SF.",
  [C("Sod", "SF / 450", "PALLET", waste=5, pack=1)])
A("32 92 19", "Seeding", "Lawns", "area",
  "Seed at about 5 lb per 1,000 SF for a new lawn; mulch at about one bale per 1,000 SF.",
  [C("Seed", "SF / 1000 * 5", "LB", waste=5), C("Straw mulch", "SF / 1000", "BALE", waste=5, pack=1)])
A("32 31 13", "Chain link fence", "Fences", "length",
  "Fabric and top rail run the length; line posts every 10 ft; end posts two per run; concrete about 0.1 CY a post.",
  [C("Fabric", "LF", "LF", waste=5, pack=50, source="length"), C("Top rail", "LF", "LF", waste=5, pack=21, source="length"),
   C("Line posts", "LF / 10", "EA", pack=1, source="length"), C("End posts", "N * 2", "EA", source="each"),
   C("Post concrete", "(LF / 10 + N * 2) * 0.1", "CY", waste=10, pack=0.25, source="length")])
A("32 31 29", "Wood fence", "Fences", "length",
  "Posts every 8 ft, two or three rails per bay, and pickets at their width plus gap.",
  [C("Posts", "LF / 8 + N", "EA", pack=1, source="length"), C("Rails", "LF * rails", "LF", waste=10, pack=8, source="length"),
   C("Pickets", "LF * 12 / picket_in", "EA", waste=5, pack=1, source="length")],
  [P("rails", "Rails", 3), P("picket_in", "Picket width with gap", 6, "in")])
A("32 14 13", "Unit pavers", "Paving", "area",
  "Pavers by area with 5 percent for cuts (10 percent on curves); bedding sand at 1 in and joint sand.",
  [C("Pavers", "SF", "SF", waste=5), C("Bedding sand", "SF / 12 / 27", "CY", waste=10, pack=0.5), C("Joint sand", "SF / 100", "BAG", pack=1)])

# ---------------------------------------------------------------- 33 Utilities
A("33 41 00", "Storm drain pipe", "Storm", "length",
  "Pipe along the drawn run in 20 ft lengths with bedding at about 0.1 CY a LF for 12 to 18 in pipe.",
  [C("Storm pipe", "LF", "LF", waste=5, pack=20, source="length"), C("Pipe bedding", "LF * 0.1", "CY", waste=10, pack=1, source="length")])
A("33 31 00", "Sanitary sewer pipe", "Sanitary", "length",
  "Pipe in 14 ft lengths along the run with bedding about 0.08 CY a LF for 6 to 8 in pipe.",
  [C("Sewer pipe", "LF", "LF", waste=5, pack=14, source="length"), C("Pipe bedding", "LF * 0.08", "CY", waste=10, pack=1, source="length")])
A("33 14 00", "Water main", "Water", "length",
  "Pipe along the run in 20 ft lengths; thrust blocks at bends are counted separately; tracer wire runs the length.",
  [C("Water pipe", "LF", "LF", waste=5, pack=20, source="length"), C("Tracer wire", "LF", "LF", waste=10, pack=500, source="length")])
A("33 05 61", "Manholes", "Structures", "count",
  "Each counted manhole: base, riser sections to the depth (4 ft sections), cone, and frame and cover.",
  [C("Manhole base", "EA", "EA", source="count"), C("Riser sections", "EA * ceil(depth_ft / 4)", "EA", source="count"),
   C("Frame and cover", "EA", "EA", source="count")], [P("depth_ft", "Manhole depth", 8, "ft")])
A("33 44 13", "Catch basins", "Structures", "count",
  "Each counted catch basin with its frame and grate; structures are set to depth in the field.", [C("Catch basin", "EA", "EA", source="count"), C("Grate", "EA", "EA", source="count")])


def _purchase_units():
    """Pack sizes become purchase units: the order quantity is a count of packs, so a component
    sold in 16 ft pieces is counted in pieces, screws in boxes and compound in pails. Concrete is
    left unrounded (suppliers round to their own increments)."""
    for a in _ITEMS:
        for c in a["components"]:
            pack, unit = c["pack"], c["unit"]
            if pack in (0, 1):
                continue
            if unit == "CY":
                c["pack"] = 0
                continue
            if unit == "TON":
                c["formula"] = f"ceil(({c['formula']}) / {pack:g}) * {pack:g}"
                c["pack"] = 0
                continue
            name = c["name"].lower()
            if unit == "LF":
                new = "SPOOL" if "wire" in name else "ROLL" if pack in (50, 150, 500) or "tape" in name or "fabric" in name else "PC"
                if new == "PC":
                    c["name"] = f"{c['name']}, {pack:g} ft pieces"
                else:
                    c["name"] = f"{c['name']}, {pack:g} ft {new.lower()}s"
            elif unit == "EA":
                new = "BOX"
                c["name"] = f"{c['name']}, boxes of {pack:g}"
            elif unit == "GAL":
                new = "PAIL"
                c["name"] = f"{c['name']}, {pack:g} gallon pails"
            elif unit == "LB":
                new = "BAG"
                c["name"] = f"{c['name']}, {pack:g} lb bags"
            elif unit == "LOAD":
                new = "LOAD"
            else:
                raise ValueError(f"no purchase unit for {unit} in packs of {pack}")
            c["formula"] = f"({c['formula']}) / {pack:g}"
            c["unit"] = new
            c["pack"] = 1


_purchase_units()


def library():
    """Every assembly in the library (a fresh copy)."""
    return json.loads(json.dumps(_ITEMS))


def library_file():
    """The library as a shareable file in the documented assemblies format."""
    return {"format": LIBRARY_FORMAT, "version": LIBRARY_VERSION, "assemblies": library()}


def _js():
    data = json.dumps(library(), indent=None, separators=(",", ":"), ensure_ascii=True)
    lines = [data[i:i + 160] for i in range(0, len(data), 160)]
    return ("// Generated by src/plantakeoff/library.py; do not edit. The built-in assemblies library by CSI\n"
            "// MasterFormat division (generic names, our own wording, no prices).\n"
            "const ASSEMBLY_LIBRARY = JSON.parse(\n" + " +\n".join(json.dumps(x) for x in lines) + ");\n"
            "const LIBRARY_FORMAT = " + json.dumps(LIBRARY_FORMAT) + ";\nconst LIBRARY_VERSION = " + str(LIBRARY_VERSION) + ";\n")


def write(root=None):
    root = Path(root or Path(__file__).resolve().parents[2])
    (root / "web" / "src" / "core" / "17_library.js").write_text(_js(), encoding="utf-8")
    (root / "examples" / "assemblies-library.json").write_text(json.dumps(library_file(), indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    write(sys.argv[1] if len(sys.argv) > 1 else None)
    print(f"wrote {len(_ITEMS)} assemblies")
