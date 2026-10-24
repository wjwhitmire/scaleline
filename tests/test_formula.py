"""Assembly formulas: the language, its limits, and assemblies that use formulas, labor and overhead."""

import math

import pytest

from plantakeoff import assembly as a
from plantakeoff import formula as f
from plantakeoff.errors import TakeoffError
from plantakeoff.measure import measure

QUARTER = 12 / 18


@pytest.mark.parametrize("text,value", [
    ("1 + 2 * 3", 7), ("(1 + 2) * 3", 9), ("2 ^ 3 ^ 2", 512), ("-2 ^ 2", -4), ("10 / 4", 2.5), ("+5 - -5", 10),
    ("ceil(3.0000000001)", 3), ("ceil(3.2)", 4), ("floor(2.9999999999)", 3), ("round(2.5)", 3), ("round(-2.5)", -2),
    ("max(1, 9, 3) - min(4, 2)", 7), ("abs(-0.5) + sqrt(16)", 4.5), ("either(0, 7)", 7), ("either(3, 7)", 3),
    ("1.5e2", 150), (".25 * 4", 1),
])
def test_values(text, value):
    assert f.evaluate(text, {}) == pytest.approx(value)


def test_variables_and_parameters():
    env = {"LF": 100.0, "spacing_in": 16.0, "N": 3.0}
    assert f.evaluate("LF * 12 / spacing_in + N", env) == pytest.approx(78)
    assert f.names("LF * spacing_in + max(SF, WSF)") == ["LF", "spacing_in", "SF", "WSF"]
    tot = {"length_in": 1200.0, "perimeter_in": 600.0, "area_sq_in": 144000.0, "volume_cu_in": 93312.0,
           "wall_area_sq_in": 129600.0, "count": 7, "measurements": 3}
    v = f.variables(tot)
    assert (v["LF"], v["PF"], v["SF"], v["WSF"], v["CF"], v["CY"], v["EA"], v["N"]) == (100, 50, 1000, 900, 54, 2, 7, 3)


@pytest.mark.parametrize("text", [
    "", "1 +", "(1", "1)", "foo(1)", "x", "1 / 0", "sqrt(-1)", "1 2", "a @ b", "min()", "ceil(1, 2)", "either(1)",
    "(-8) ^ 0.5", "0 ^ -1", "10 ^ 400", "1" + "+1" * 250, "(" * 45 + "1" + ")" * 45, "a" * 33, "__import__('os')",
    "x" * 501,
])
def test_refuses_bad_formulas(text):
    with pytest.raises(TakeoffError) as e:
        f.evaluate(text, {"a": 1, "b": 2})
    assert e.value.code == "formula"


def test_refuses_non_numbers():
    with pytest.raises(TakeoffError):
        f.evaluate("x + 1", {"x": True})
    with pytest.raises(TakeoffError):
        f.evaluate("x + 1", {"x": math.inf})
    assert f.evaluate("x", {"x": 2, "not a name": "ignored"}) == 2


def test_stud_wall_by_formula_hand_check():
    # 40 ft of wall at 16 in centers: 30 spaces, 30 + 1 studs per wall end; 10 percent waste, whole studs.
    r = measure({"type": "polylength", "points": [[0, 0], [720, 0]]}, QUARTER)
    asm = {"id": "w", "name": "Wall", "params": [{"id": "spacing_in", "value": 16}],
           "components": [{"name": "Studs", "source": "length", "formula": "ceil(LF * 12 / spacing_in) + N", "waste_pct": 10, "pack": 1,
                           "unit": "ea", "unit_cost_cents": 400, "labor_hours": 0.1, "labor_rate": "carp"}]}
    line = a.apply_assembly(asm, [r], [{"id": "carp", "cents_per_hour": 6000}])
    c = line["components"][0]
    assert c["raw"] == 31 and c["with_waste"] == pytest.approx(34.1) and c["order"] == 35
    assert c["material_cents"] == 35 * 400 and c["labor_cents"] == round(35 * 0.1 * 6000)
    assert line["cost_cents"] == c["material_cents"] + c["labor_cents"]


def test_overhead_then_markup_then_tax():
    asm = {"id": "x", "name": "X", "components": [{"name": "Lump", "source": "each", "factor": 1, "unit_cost_cents": 100000}]}
    r = measure({"type": "count", "points": [[0, 0]]}, None)
    est = a.estimate([asm], {"x": [r]}, markup_pct=10, tax_pct=8, overhead_pct=15)
    assert est["subtotal_cents"] == 100000
    assert est["overhead_cents"] == 15000
    assert est["markup_cents"] == 11500  # 10 percent of 115,000
    assert est["tax_cents"] == 10120  # 8 percent of 126,500
    assert est["total_cents"] == 136620
    # with no overhead the old rollup is unchanged
    old = a.estimate([asm], {"x": [r]}, markup_pct=10, tax_pct=8)
    assert old["total_cents"] == 100000 + 10000 + 8800 and old["overhead_cents"] == 0
