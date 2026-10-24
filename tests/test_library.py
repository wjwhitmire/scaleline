"""The built-in assemblies library: size, division coverage, valid formulas, no prices, a why note on
each, and the browser copy and shareable file up to date."""

import json
import re
from pathlib import Path

from plantakeoff import assembly, library, markups
from plantakeoff.measure import measure

ROOT = Path(__file__).resolve().parent.parent
QUARTER = 12 / 18


def test_library_size_and_divisions():
    lib = library.library()
    assert len(lib) >= 150
    divisions = {a["division"] for a in lib}
    for d in ("02", "03", "04", "05", "06", "07", "08", "09", "10", "21", "22", "23", "26", "31", "32", "33"):
        assert d in divisions, d
    assert len({a["id"] for a in lib}) == len(lib)
    for a in lib:
        assert re.fullmatch(r"\d{2} \d{2} \d{2}", a["code"]) and a["code"][:2] == a["division"]


def test_every_assembly_is_valid_and_priceless_with_a_why():
    tot = {"length_in": 1200.0, "perimeter_in": 600.0, "area_sq_in": 144000.0, "volume_cu_in": 93312.0,
           "wall_area_sq_in": 0.0, "count": 7, "measurements": 3, "missing_scale": 0}
    for a in library.library():
        clean = markups.clean_assembly(a)
        assert clean is not None and len(clean["components"]) == len(a["components"]), a["id"]
        assert len(a["why"]) > 60, a["id"]
        assert a["tool"] in ("length", "polylength", "area", "volume", "count", "perimeter")
        env = assembly.assembly_env(clean, tot)
        for c in clean["components"]:
            assert c["unit_cost_cents"] == 0
            assert 0 <= c["waste_pct"] <= 25
            q = assembly.component_quantity(c, tot, env)
            assert q["order"] >= 0 and q["cost_cents"] == 0, (a["id"], c["name"])


def test_drywall_assembly_hand_check():
    # 40 ft of wall 9 ft high, board both sides: 720 SF over 32 SF a sheet is 22.5, plus 10 percent is 24.75, so 25 sheets.
    a = next(x for x in library.library() if x["name"] == "Gypsum board wall, 1/2 in, both sides")
    r = measure({"type": "polylength", "points": [[0, 0], [720, 0]]}, QUARTER)
    line = assembly.apply_assembly(markups.clean_assembly(a), [r])
    board = line["components"][0]
    assert board["raw"] == 22.5 and board["order"] == 25
    # with a height drawn on the measurement, the drawn wall area wins over the parameter
    r8 = measure({"type": "polylength", "points": [[0, 0], [720, 0]], "height": 96}, QUARTER)
    assert assembly.apply_assembly(markups.clean_assembly(a), [r8])["components"][0]["raw"] == 20


def test_slab_assembly_hand_check():
    # 30 x 40 ft slab, 4 in: 1,200 x 4 / 12 / 27 = 14.81 CY, plus 5 percent = 15.56 CY.
    a = next(x for x in library.library() if x["name"] == "Slab on grade, 4 in")
    r = measure({"type": "area", "points": [[0, 0], [720, 0], [720, 540], [0, 540]]}, QUARTER)
    c = assembly.apply_assembly(markups.clean_assembly(a), [r])["components"][0]
    assert abs(c["raw"] - 14.8148) < 1e-3 and abs(c["order"] - 15.5556) < 1e-3 and c["unit"] == "CY"


def test_pack_sizes_are_purchase_units():
    for a in library.library():
        for c in a["components"]:
            assert c["pack"] in (0, 1), (a["id"], c["name"])
    base = next(x for x in library.library() if x["name"] == "Baseboard, wood")["components"][0]
    assert base["unit"] == "PC" and "16 ft pieces" in base["name"]
    # 100 LF of base in 16 ft pieces with 10 percent waste: 110 / 16 = 6.875, so 7 pieces
    tot = {"length_in": 1200.0, "perimeter_in": 0.0, "area_sq_in": 0.0, "volume_cu_in": 0.0, "wall_area_sq_in": 0.0,
           "count": 0, "measurements": 1, "missing_scale": 0}
    assert assembly.component_quantity(markups.clean_component(base), tot)["order"] == 7


def test_generated_files_are_up_to_date(tmp_path):
    (tmp_path / "web" / "src" / "core").mkdir(parents=True)
    (tmp_path / "examples").mkdir()
    library.write(tmp_path)
    for rel in ("web/src/core/17_library.js", "examples/assemblies-library.json"):
        assert (tmp_path / rel).read_text(encoding="utf-8") == (ROOT / rel).read_text(encoding="utf-8"), rel
    data = json.loads((ROOT / "examples" / "assemblies-library.json").read_text(encoding="utf-8"))
    assert data["format"] == library.LIBRARY_FORMAT and len(data["assemblies"]) == len(library.library())
