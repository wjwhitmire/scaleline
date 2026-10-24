// Plane geometry on sheet coordinates (PDF points, x right, y down). Mirrors geometry.py.
const EPS = 1e-12;
function _pt(p) {
  if (!(Array.isArray(p) && p.length === 2)) throw new TakeoffError("geometry", "A point is a pair of numbers");
  const x = p[0], y = p[1];
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TakeoffError("geometry", "A point must have finite coordinates");
  }
  return [x, y];
}
function points(pts, minimum) {
  const out = (pts || []).map(_pt);
  if (out.length < (minimum || 0)) throw new TakeoffError("geometry", "Need at least " + minimum + " points");
  return out;
}
function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function polyline_length(pts) {
  const p = points(pts);
  let s = 0;
  for (let i = 0; i < p.length - 1; i++) s += dist(p[i], p[i + 1]);
  return s;
}
function signed_area(pts) {
  const p = points(pts);
  const n = p.length;
  if (n < 3) return 0;
  const ox = p[0][0], oy = p[0][1];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const x1 = a[0] - ox, y1 = a[1] - oy, x2 = b[0] - ox, y2 = b[1] - oy;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
function perimeter(pts) {
  const p = points(pts);
  if (p.length < 2) return 0;
  return p.length > 2 ? polyline_length(p.concat([p[0]])) : 2 * dist(p[0], p[1]);
}
function _orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function _on_seg(a, b, c, tol) {
  return Math.min(a[0], b[0]) - tol <= c[0] && c[0] <= Math.max(a[0], b[0]) + tol &&
    Math.min(a[1], b[1]) - tol <= c[1] && c[1] <= Math.max(a[1], b[1]) + tol;
}
function segments_intersect(a, b, c, d) {
  const scale = Math.max(1, Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]), Math.abs(c[0]), Math.abs(c[1]), Math.abs(d[0]), Math.abs(d[1]));
  const tol = 1e-9 * scale * scale;
  const d1 = _orient(c, d, a), d2 = _orient(c, d, b), d3 = _orient(a, b, c), d4 = _orient(a, b, d);
  if (((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) && ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))) return true;
  const lt = 1e-9 * scale;
  if (Math.abs(d1) <= tol && _on_seg(c, d, a, lt)) return true;
  if (Math.abs(d2) <= tol && _on_seg(c, d, b, lt)) return true;
  if (Math.abs(d3) <= tol && _on_seg(a, b, c, lt)) return true;
  if (Math.abs(d4) <= tol && _on_seg(a, b, d, lt)) return true;
  return false;
}
function self_intersections(pts, closed, limit) {
  if (closed === undefined) closed = true;
  if (limit === undefined) limit = 50;
  const p = points(pts);
  const n = p.length, m = closed ? n : n - 1;
  if (m < 3) return [];
  const out = [];
  for (let i = 0; i < m; i++) {
    const a = p[i], b = p[(i + 1) % n];
    for (let j = i + 1; j < m; j++) {
      if (j === i + 1 || (closed && i === 0 && j === m - 1)) continue;
      if (segments_intersect(a, b, p[j], p[(j + 1) % n])) {
        out.push([i, j]);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
function point_in_polygon(pt, poly) {
  const q = _pt(pt), x = q[0], y = q[1];
  const p = points(poly), n = p.length;
  let inside = false;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    if (Math.abs(_orient(a, b, q)) <= 1e-9 * Math.max(1, dist(a, b)) && _on_seg(a, b, q, 1e-9)) return true;
    if ((a[1] > y) !== (b[1] > y)) {
      const xi = a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
      if (x < xi) inside = !inside;
    }
  }
  return inside;
}
function polygon_with_holes(outer, holes) {
  const o = points(outer, 3);
  const hs = (holes || []).map((h) => points(h, 3));
  const warnings = [];
  if (self_intersections(o).length) warnings.push("outline_crosses_itself");
  const gross = Math.abs(signed_area(o));
  let cut = 0;
  hs.forEach((h, k) => {
    if (self_intersections(h).length) warnings.push("cutout_" + (k + 1) + "_crosses_itself");
    if (!h.every((v) => point_in_polygon(v, o))) warnings.push("cutout_" + (k + 1) + "_outside_outline");
    cut += Math.abs(signed_area(h));
  });
  for (let i = 0; i < hs.length; i++) {
    for (let j = i + 1; j < hs.length; j++) {
      if (hs[i].some((v) => point_in_polygon(v, hs[j])) || hs[j].some((v) => point_in_polygon(v, hs[i]))) {
        warnings.push("cutouts_" + (i + 1) + "_and_" + (j + 1) + "_overlap");
      }
    }
  }
  let net = gross - cut;
  if (net < 0) { warnings.push("cutouts_exceed_outline"); net = 0; }
  return { gross, cutouts: cut, net, perimeter: perimeter(o), cutout_perimeter: hs.reduce((s, h) => s + perimeter(h), 0), warnings };
}
function centroid(pts) {
  const p = points(pts, 1);
  const a = signed_area(p);
  if (Math.abs(a) < EPS || p.length < 3) {
    return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  }
  const ox = p[0][0], oy = p[0][1], n = p.length;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const x1 = p[i][0] - ox, y1 = p[i][1] - oy, x2 = p[(i + 1) % n][0] - ox, y2 = p[(i + 1) % n][1] - oy;
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  return [cx / (6 * a) + ox, cy / (6 * a) + oy];
}
function angle_deg(a, vertex, b) {
  a = _pt(a); const v = _pt(vertex); b = _pt(b);
  const ux = a[0] - v[0], uy = a[1] - v[1], wx = b[0] - v[0], wy = b[1] - v[1];
  if (Math.hypot(ux, uy) < EPS || Math.hypot(wx, wy) < EPS) throw new TakeoffError("geometry", "An angle needs two arms of nonzero length");
  return Math.abs(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy)) * 180 / Math.PI;
}
function circle_through(a, b, c) {
  a = _pt(a); b = _pt(b); c = _pt(c);
  const ox = a[0], oy = a[1];
  const bx = b[0] - ox, by = b[1] - oy, cx = c[0] - ox, cy = c[1] - oy;
  const d = 2 * (bx * cy - by * cx);
  const span = Math.max(dist(a, b), dist(b, c), dist(a, c));
  if (Math.abs(d) <= 1e-12 * Math.max(1, span * span)) throw new TakeoffError("geometry", "The three points are in a line, so they do not define a circle");
  const b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d, uy = (bx * c2 - cx * b2) / d;
  return { center: [ux + ox, uy + oy], radius: Math.hypot(ux, uy) };
}
function bbox(pts) {
  const p = points(pts, 1);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  return [x0, y0, x1, y1];
}
function snap_angle(origin, pt, step_deg) {
  if (step_deg === undefined) step_deg = 45;
  const o = _pt(origin), p = _pt(pt);
  const dx = p[0] - o[0], dy = p[1] - o[1];
  if (Math.hypot(dx, dy) < EPS || !(step_deg > 0)) return [p[0], p[1]];
  const step = step_deg * Math.PI / 180;
  const ang = Math.floor(Math.atan2(dy, dx) / step + 0.5) * step;
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const t = dx * ux + dy * uy;
  return [o[0] + t * ux, o[1] + t * uy];
}
function nearest_on_segment(p, a, b) {
  p = _pt(p); a = _pt(a); b = _pt(b);
  const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
  if (L2 < EPS) return [a[0], a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
  return [a[0] + t * vx, a[1] + t * vy];
}
function snap_grid(p, spacing, origin) {
  p = _pt(p);
  origin = origin || [0, 0];
  if (!(spacing > 0)) return [p[0], p[1]];
  return [origin[0] + Math.floor((p[0] - origin[0]) / spacing + 0.5) * spacing, origin[1] + Math.floor((p[1] - origin[1]) / spacing + 0.5) * spacing];
}
function snap(p, tolerance, vertices, segments, grid) {
  p = _pt(p);
  vertices = vertices || []; segments = segments || [];
  let best = null;
  for (const v of vertices) {
    const d = dist(p, v);
    if (d <= tolerance && (best === null || d < best[0])) best = [d, [Number(v[0]), Number(v[1])]];
  }
  if (best) return { point: best[1], kind: "vertex" };
  for (const [a, b] of segments) {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = dist(p, m);
    if (d <= tolerance && (best === null || d < best[0])) best = [d, m];
  }
  if (best) return { point: best[1], kind: "midpoint" };
  for (const [a, b] of segments) {
    const q = nearest_on_segment(p, a, b);
    const d = dist(p, q);
    if (d <= tolerance && (best === null || d < best[0])) best = [d, q];
  }
  if (best) return { point: best[1], kind: "edge" };
  if (grid && grid > 0) return { point: snap_grid(p, grid), kind: "grid" };
  return { point: [p[0], p[1]], kind: "none" };
}
function simplify(pts, tolerance) {
  const p = points(pts), n = p.length;
  if (n < 3) return p.map((q) => [q[0], q[1]]);
  const keep = new Array(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = p[i], b = p[j];
    let dmax = -1, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = dist(p[k], nearest_on_segment(p[k], a, b));
      if (d > dmax) { dmax = d; idx = k; }
    }
    if (idx >= 0 && dmax > tolerance) { keep[idx] = true; stack.push([i, idx]); stack.push([idx, j]); }
  }
  return p.filter((q, k) => keep[k]).map((q) => [q[0], q[1]]);
}
