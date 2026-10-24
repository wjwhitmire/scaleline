"""Assemblies and the estimate rollup.

An assembly is a list of components. Each component turns the summed quantities of every
measurement linked to the assembly into a purchase quantity and a cost:

    raw       = convert(sum of source, source_unit) * factor + per_each * measurements
    with_waste = raw * (1 + waste_pct / 100)
    order     = ceil(with_waste / pack)      when pack > 0 (whole purchase units)
              = with_waste                   when pack = 0 (labor hours, lump quantities)
    cost      = order * unit_cost            (integer cents, rounded half away from zero)

A component may give a formula instead of a source and factor (see formula.py); the formula's
value is the raw quantity, before waste and the round up. Formulas see the summed totals as
LF, PF, SF, WSF, CF, CY, EA and N, plus the assembly's own parameters.

Cost splits into material and labor. unit_cost_cents is the material price of one order unit;
labor_hours per order unit times the hourly rate of the component's labor_rate (from the rate
table) is its labor:

    material  = order * unit_cost                  labor = order * labor_hours * rate
    cost      = material + labor                   (each in integer cents, half away from zero)

Quantities are summed before rounding up, so a job with 40 walls buys whole sheets once,
not once per wall. Money is integer cents. The estimate adds overhead on the subtotal, markup
(profit) on subtotal plus overhead, and tax on all three.
"""

from __future__ import annotations

import math

from . import formula as fx
from . import units as u
from .errors import TakeoffError

SOURCES = {
    # source: (key in a measure() result, unit kind)
    "length": ("length_in", "length"),
    "perimeter": ("perimeter_in", "length"),
    "area": ("area_sq_in", "area"),
    "volume": ("volume_cu_in", "volume"),
    "wall_area": ("wall_area_sq_in", "area"),
    "count": ("count", "count"),
    "each": (None, "count"),
}
BASE = {"length": "in", "area": "sq_in", "volume": "cu_in"}
CEIL_EPS = 1e-9


def _round_half_away(x: float) -> int:
    return int(math.floor(abs(x) + 0.5)) * (1 if x >= 0 else -1)


def _finite(v, name, lo=-1e12, hi=1e12):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise TakeoffError("assembly", f"{name} must be a number")
    x = float(v)
    if not math.isfinite(x) or x < lo or x > hi:
        raise TakeoffError("assembly", f"{name} is out of range")
    return x


def sum_quantities(results):
    """Add up measure() results. None values (an uncalibrated page) count as missing."""
    tot = {"length_in": 0.0, "perimeter_in": 0.0, "area_sq_in": 0.0, "volume_cu_in": 0.0,
           "wall_area_sq_in": 0.0, "count": 0, "measurements": 0, "missing_scale": 0}
    for r in results:
        tot["measurements"] += 1
        scaled = r["kind"] in ("length", "area", "volume")
        if scaled and r.get("value") is None:
            tot["missing_scale"] += 1
        for key in ("length_in", "perimeter_in", "area_sq_in", "volume_cu_in", "wall_area_sq_in"):
            if r.get(key) is not None:
                tot[key] += r[key]
        if r.get("count") is not None:
            tot["count"] += r["count"]
    return tot


def _rate_table(rates):
    out = {}
    for r in rates or []:
        if isinstance(r, dict) and isinstance(r.get("id"), str):
            v = r.get("cents_per_hour", 0)
            if not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v):
                out[r["id"]] = float(v)
    return out


def component_quantity(comp: dict, totals: dict, env=None, rates=None):
    src = comp.get("source", "each")
    if src not in SOURCES:
        raise TakeoffError("assembly", f"Unknown source: {src}")
    key, kind = SOURCES[src]
    factor = _finite(comp.get("factor", 1), "Factor")
    per_each = _finite(comp.get("per_each", 0), "Per measurement")
    waste = _finite(comp.get("waste_pct", 0), "Waste", 0, 1000)
    pack = _finite(comp.get("pack", 0), "Pack size", 0)
    unit_cost = int(_finite(comp.get("unit_cost_cents", 0), "Unit cost", -1e11, 1e11))
    hours = _finite(comp.get("labor_hours", 0), "Labor hours", 0, 1e6)
    rate = _rate_table(rates).get(comp.get("labor_rate"), 0.0)
    text = comp.get("formula")
    if isinstance(text, str) and text.strip():
        vars_ = fx.variables(totals) if env is None else env
        raw = fx.evaluate(text, vars_)
        base = raw
    else:
        if src == "each":
            base = float(totals["measurements"])
        elif kind == "count":
            base = float(totals[key])
        else:
            su = comp.get("source_unit") or {"length": "ft", "area": "sf", "volume": "cy"}[kind]
            if u.unit_kind(su) != kind:
                raise TakeoffError("assembly", f"{su} is not a {kind} unit")
            base = u.convert(totals[key], BASE[kind], su)
        raw = base * factor + per_each * totals["measurements"]
    with_waste = raw * (1.0 + waste / 100.0)
    if pack > 0:
        order = float(math.ceil(with_waste / pack - CEIL_EPS)) if with_waste > 0 else 0.0
    else:
        order = with_waste
    material = _round_half_away(order * unit_cost)
    labor = _round_half_away(order * hours * rate)
    return {
        "name": str(comp.get("name", ""))[:120],
        "unit": str(comp.get("unit", ""))[:24],
        "source": src,
        "base": base,
        "raw": raw,
        "with_waste": with_waste,
        "order": order,
        "unit_cost_cents": unit_cost,
        "labor_hours": order * hours,
        "material_cents": material,
        "labor_cents": labor,
        "cost_cents": material + labor,
    }


def assembly_env(assembly: dict, totals: dict):
    """The formula variables for one assembly: the summed totals and its own parameters."""
    env = fx.variables(totals)
    for p in assembly.get("params") or []:
        if isinstance(p, dict) and isinstance(p.get("id"), str) and p["id"] not in env:
            v = p.get("value", 0)
            if not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v):
                env[p["id"]] = float(v)
    return env


def apply_assembly(assembly: dict, results, rates=None):
    totals = sum_quantities(results)
    env = assembly_env(assembly, totals)
    comps = [component_quantity(c, totals, env, rates) for c in assembly.get("components", [])]
    return {
        "id": assembly.get("id"),
        "name": str(assembly.get("name", ""))[:120],
        "totals": totals,
        "components": comps,
        "material_cents": sum(c["material_cents"] for c in comps),
        "labor_cents": sum(c["labor_cents"] for c in comps),
        "cost_cents": sum(c["cost_cents"] for c in comps),
    }


def estimate(assemblies, results_by_assembly, markup_pct=0.0, tax_pct=0.0, overhead_pct=0.0, rates=None):
    """Roll every assembly into an estimate. results_by_assembly maps assembly id to the
    measure() results of the markups linked to it. Overhead applies to the subtotal, markup
    (profit) to subtotal plus overhead, and tax to subtotal plus overhead plus markup."""
    mp = _finite(markup_pct, "Markup", 0, 1000)
    tp = _finite(tax_pct, "Tax", 0, 100)
    op = _finite(overhead_pct, "Overhead", 0, 1000)
    lines = [apply_assembly(a, results_by_assembly.get(a.get("id"), []), rates) for a in assemblies]
    sub = sum(line["cost_cents"] for line in lines)
    oh = _round_half_away(sub * op / 100.0)
    mk = _round_half_away((sub + oh) * mp / 100.0)
    tax = _round_half_away((sub + oh + mk) * tp / 100.0)
    return {"lines": lines, "material_cents": sum(line["material_cents"] for line in lines),
            "labor_cents": sum(line["labor_cents"] for line in lines), "subtotal_cents": sub, "overhead_cents": oh,
            "markup_cents": mk, "tax_cents": tax, "total_cents": sub + oh + mk + tax}
