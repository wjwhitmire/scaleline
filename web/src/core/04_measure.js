// Measurements: sheet geometry times the page scale. Mirrors measure.py.
const MEASURE_TYPES = ["length", "polylength", "area", "perimeter", "count", "volume", "angle", "radius", "diameter", "quantity"];
// An imported quantity carries its own value in base units and does not depend on the scale.
const QTY_KEYS = { length: "length_in", area: "area_sq_in", volume: "volume_cu_in", count: "count" };
const PRIMARY = { length: "length", polylength: "length", perimeter: "length", radius: "length", diameter: "length", quantity: "count", area: "area", volume: "volume", count: "count", angle: "angle" };

function _strict(v) {
  if (v === undefined || v === null) return 0;
  if (typeof v !== "number") return NaN;
  return v;
}
function pitch_factor(rise) {
  const r = _strict(rise);
  if (!Number.isFinite(r) || r < 0 || r > 48) throw new TakeoffError("measure", "Pitch must be between 0 and 48 (rise in 12)");
  return Math.sqrt(1 + (r / 12) ** 2);
}
function _mnum(v, name, lo, hi) {
  const x = _strict(v);
  if (!Number.isFinite(x) || x < (lo === undefined ? 0 : lo) || x > (hi === undefined ? 1e9 : hi)) throw new TakeoffError("measure", name + " is out of range");
  return x;
}
function measure(markup, in_per_pt) {
  const t = markup.type;
  if (!MEASURE_TYPES.includes(t)) throw new TakeoffError("measure", "Not a measurement type: " + t);
  let pts = points(markup.points || []);
  const s = in_per_pt === null || in_per_pt === undefined ? null : Number(in_per_pt);
  if (s !== null && !(s > 0 && Number.isFinite(s))) throw new TakeoffError("measure", "The page scale must be a positive number");
  const out = {
    type: t, kind: PRIMARY[t], length_in: null, perimeter_in: null, area_sq_in: null, volume_cu_in: null,
    wall_area_sq_in: null, count: null, angle_deg: null, radius_in: null, value: null, warnings: [],
  };
  const sc = (x) => (s === null ? null : x * s);
  const sc2 = (x) => (s === null ? null : x * s * s);
  if (t === "quantity") {
    const q = markup.qty;
    if (q === null || typeof q !== "object" || !has(QTY_KEYS, q.kind)) throw new TakeoffError("measure", "An imported quantity needs a kind and a value");
    const v = _mnum(q.value, "Quantity", 0, 1e15);
    out.kind = q.kind;
    out[QTY_KEYS[q.kind]] = v;
    out.value = v;
    return out;
  }
  if (t === "count") { out.count = pts.length; out.value = pts.length; return out; }
  if (t === "angle") {
    if (pts.length < 3) throw new TakeoffError("measure", "An angle needs three points");
    out.angle_deg = angle_deg(pts[0], pts[1], pts[2]);
    out.value = out.angle_deg;
    return out;
  }
  if (t === "length" || t === "polylength") {
    if (pts.length < 2) throw new TakeoffError("measure", "A length needs two points");
    if (t === "length") pts = pts.slice(0, 2);
    const L = sc(polyline_length(pts));
    out.length_in = L;
    const h = _mnum(markup.height, "Height");
    if (h > 0 && L !== null) out.wall_area_sq_in = L * h;
    out.value = L;
    return out;
  }
  if (t === "perimeter") {
    if (pts.length < 2) throw new TakeoffError("measure", "A perimeter needs at least two points");
    const P = sc(perimeter(pts));
    out.length_in = P; out.perimeter_in = P;
    const h = _mnum(markup.height, "Height");
    if (h > 0 && P !== null) out.wall_area_sq_in = P * h;
    out.value = P;
    return out;
  }
  if (t === "radius") {
    let r;
    if (pts.length === 2) r = dist(pts[0], pts[1]);
    else if (pts.length >= 3) r = circle_through(pts[0], pts[1], pts[2]).radius;
    else throw new TakeoffError("measure", "A radius needs a center and an edge point, or three points on the arc");
    const R = sc(r);
    out.radius_in = R; out.length_in = R;
    if (R !== null) { out.perimeter_in = 2 * Math.PI * R; out.area_sq_in = Math.PI * R * R; }
    out.value = R;
    return out;
  }
  if (t === "diameter") {
    let r;
    if (pts.length === 2) r = dist(pts[0], pts[1]) / 2;
    else if (pts.length >= 3) r = circle_through(pts[0], pts[1], pts[2]).radius;
    else throw new TakeoffError("measure", "A diameter needs two points across the circle, or three points on it");
    const R = sc(r);
    out.radius_in = R;
    if (R !== null) { out.length_in = 2 * R; out.perimeter_in = 2 * Math.PI * R; out.area_sq_in = Math.PI * R * R; }
    out.value = out.length_in;
    return out;
  }
  if (pts.length < 3) throw new TakeoffError("measure", "An area needs at least three points");
  const poly = polygon_with_holes(pts, markup.holes || []);
  out.warnings = poly.warnings;
  // Pitch applies to areas only; a volume is measured in plan.
  let A = sc2(poly.net);
  if (t === "area") { const pf = pitch_factor(markup.pitch); if (A !== null) A *= pf; }
  out.area_sq_in = A;
  out.perimeter_in = sc(poly.perimeter);
  if (t === "area") { out.value = A; return out; }
  const depth = _mnum(markup.depth, "Depth");
  out.volume_cu_in = A === null ? null : A * depth;
  out.value = out.volume_cu_in;
  return out;
}
