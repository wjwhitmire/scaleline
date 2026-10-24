// Assemblies and the estimate rollup. Mirrors assembly.py. Money is integer cents.
const SOURCES = {
  length: ["length_in", "length"], perimeter: ["perimeter_in", "length"], area: ["area_sq_in", "area"],
  volume: ["volume_cu_in", "volume"], wall_area: ["wall_area_sq_in", "area"], count: ["count", "count"], each: [null, "count"],
};
const BASE_UNIT = { length: "in", area: "sq_in", volume: "cu_in" };
const CEIL_EPS = 1e-9;
function round_half_away(x) { return Math.floor(Math.abs(x) + 0.5) * (x >= 0 ? 1 : -1); }
function _finite(v, name, lo, hi) {
  if (lo === undefined) lo = -1e12;
  if (hi === undefined) hi = 1e12;
  if (typeof v !== "number") throw new TakeoffError("assembly", name + " must be a number");
  if (!Number.isFinite(v) || v < lo || v > hi) throw new TakeoffError("assembly", name + " is out of range");
  return v;
}
function sum_quantities(results) {
  const tot = { length_in: 0, perimeter_in: 0, area_sq_in: 0, volume_cu_in: 0, wall_area_sq_in: 0, count: 0, measurements: 0, missing_scale: 0 };
  for (const r of results) {
    tot.measurements += 1;
    const scaled = r.kind === "length" || r.kind === "area" || r.kind === "volume";
    if (scaled && (r.value === null || r.value === undefined)) tot.missing_scale += 1;
    for (const key of ["length_in", "perimeter_in", "area_sq_in", "volume_cu_in", "wall_area_sq_in"]) {
      if (r[key] !== null && r[key] !== undefined) tot[key] += r[key];
    }
    if (r.count !== null && r.count !== undefined) tot.count += r.count;
  }
  return tot;
}
function _get(o, k, d) { return has(o, k) ? o[k] : d; }
function _rate_table(rates) {
  const out = new Map();
  for (const r of rates || []) {
    if (isObj(r) && typeof r.id === "string") {
      const v = _get(r, "cents_per_hour", 0);
      if (typeof v === "number" && Number.isFinite(v)) out.set(r.id, v);
    }
  }
  return out;
}
function component_quantity(comp, totals, env, rates) {
  const src = _get(comp, "source", "each");
  if (!has(SOURCES, src)) throw new TakeoffError("assembly", "Unknown source: " + src);
  const [key, kind] = SOURCES[src];
  const factor = _finite(_get(comp, "factor", 1), "Factor");
  const per_each = _finite(_get(comp, "per_each", 0), "Per measurement");
  const waste = _finite(_get(comp, "waste_pct", 0), "Waste", 0, 1000);
  const pack = _finite(_get(comp, "pack", 0), "Pack size", 0);
  const unit_cost = Math.trunc(_finite(_get(comp, "unit_cost_cents", 0), "Unit cost", -1e11, 1e11));
  const hours = _finite(_get(comp, "labor_hours", 0), "Labor hours", 0, 1e6);
  const rt = _rate_table(rates);
  const rate = rt.has(comp.labor_rate) ? rt.get(comp.labor_rate) : 0;
  const text = comp.formula;
  let base, raw;
  if (typeof text === "string" && text.trim()) {
    raw = formula_eval(text, env === undefined || env === null ? formula_variables(totals) : env);
    base = raw;
  } else {
    if (src === "each") base = totals.measurements;
    else if (kind === "count") base = totals[key];
    else {
      const su = comp.source_unit || { length: "ft", area: "sf", volume: "cy" }[kind];
      if (unit_kind(su) !== kind) throw new TakeoffError("assembly", su + " is not a " + kind + " unit");
      base = convert(totals[key], BASE_UNIT[kind], su);
    }
    raw = base * factor + per_each * totals.measurements;
  }
  const with_waste = raw * (1 + waste / 100);
  let order;
  if (pack > 0) order = with_waste > 0 ? Math.ceil(with_waste / pack - CEIL_EPS) : 0;
  else order = with_waste;
  const material = round_half_away(order * unit_cost), labor = round_half_away(order * hours * rate);
  return {
    name: String(_get(comp, "name", "")).slice(0, 120), unit: String(_get(comp, "unit", "")).slice(0, 24), source: src,
    base, raw, with_waste, order, unit_cost_cents: unit_cost, labor_hours: order * hours, material_cents: material, labor_cents: labor,
    cost_cents: material + labor,
  };
}
function assembly_env(assembly, totals) {
  const env = formula_variables(totals);
  for (const p of assembly.params || []) {
    if (isObj(p) && typeof p.id === "string" && !has(env, p.id)) {
      const v = _get(p, "value", 0);
      if (typeof v === "number" && Number.isFinite(v)) env[p.id] = v;
    }
  }
  return env;
}
function apply_assembly(assembly, results, rates) {
  const totals = sum_quantities(results);
  const env = assembly_env(assembly, totals);
  const comps = (assembly.components || []).map((c) => component_quantity(c, totals, env, rates));
  const sum = (k) => comps.reduce((s, c) => s + c[k], 0);
  return { id: has(assembly, "id") ? assembly.id : null, name: String(_get(assembly, "name", "")).slice(0, 120), totals, components: comps,
    material_cents: sum("material_cents"), labor_cents: sum("labor_cents"), cost_cents: sum("cost_cents") };
}
function estimate(assemblies, results_by_assembly, markup_pct, tax_pct, overhead_pct, rates) {
  const mp = _finite(markup_pct === undefined ? 0 : markup_pct, "Markup", 0, 1000);
  const tp = _finite(tax_pct === undefined ? 0 : tax_pct, "Tax", 0, 100);
  const op = _finite(overhead_pct === undefined || overhead_pct === null ? 0 : overhead_pct, "Overhead", 0, 1000);
  const lines = assemblies.map((a) => apply_assembly(a, (has(results_by_assembly, a.id) && results_by_assembly[a.id]) || [], rates));
  const sub = lines.reduce((s, l) => s + l.cost_cents, 0);
  const oh = round_half_away(sub * op / 100);
  const mk = round_half_away((sub + oh) * mp / 100);
  const tax = round_half_away((sub + oh + mk) * tp / 100);
  return { lines, material_cents: lines.reduce((s, l) => s + l.material_cents, 0), labor_cents: lines.reduce((s, l) => s + l.labor_cents, 0),
    subtotal_cents: sub, overhead_cents: oh, markup_cents: mk, tax_cents: tax, total_cents: sub + oh + mk + tax };
}
