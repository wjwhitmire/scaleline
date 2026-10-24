// Markups as standard PDF annotations, both ways. Mirrors annotations.py, where the plain
// annotation description and the /Measure mapping are explained. The page code reads and writes
// the PDF objects (pdf-lib) and hands these functions plain values.
const UNIT_INCHES = {
  "'": 12, ft: 12, feet: 12, foot: 12, "ft'": 12, "\"": 1, in: 1, inch: 1, inches: 1, yd: 36, yard: 36, yards: 36, mi: 63360,
  m: 1 / 0.0254, cm: 1 / 2.54, mm: 1 / 25.4, km: 1000 / 0.0254,
};
const METRIC_UNITS = ["m", "cm", "mm"];
const ANNOT_SUBTYPE = {
  length: ["Line", "LineDimension"], polylength: ["PolyLine", "PolyLineDimension"], perimeter: ["PolyLine", "PolyLineDimension"],
  area: ["Polygon", "PolygonDimension"], volume: ["Polygon", "PolygonVolume"], count: ["Polygon", "PolygonCount"],
  angle: ["PolyLine", "PolyLineAngle"], radius: ["Polygon", "PolygonRadius"], diameter: ["Circle", "CircleDimension"],
  cloud: ["Polygon", "PolygonCloud"], callout: ["FreeText", "FreeTextCallout"], text: ["FreeText", ""], arrow: ["Line", "LineArrow"],
  line: ["Line", ""], rect: ["Square", ""], ellipse: ["Circle", ""], polygon: ["Polygon", ""], polyline: ["PolyLine", ""],
  highlight: ["Highlight", ""], pen: ["Ink", ""], stamp: ["Stamp", ""], quantity: ["Square", ""],
};
function _r3(x) { return Math.floor(x * 1000 + 0.5) / 1000; }
function mat_inv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
function to_user(ctx, p) { const q = mat_apply(mat_inv(ctx.transform), p[0], p[1]); return [_r3(q[0]), _r3(q[1])]; }
function to_sheet(ctx, x, y) { const q = mat_apply(ctx.transform, x, y); return [_r3(q[0]), _r3(q[1])]; }
function _aflat(pts) { const out = []; for (const p of pts) out.push(p[0], p[1]); return out; }
function _pairs(flat) {
  if (!Array.isArray(flat)) return [];
  const nums = flat.slice(0, 40000).filter((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e7);
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}
function _anums(v, n) {
  if (!Array.isArray(v) || v.length !== n) return null;
  for (const x of v) if (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > 1e7) return null;
  return v.slice();
}
function hex_to_rgb(h) { const n = parseInt(h.slice(1), 16); return [_r3(((n >> 16) & 255) / 255), _r3(((n >> 8) & 255) / 255), _r3((n & 255) / 255)]; }
function rgb_to_hex(c) {
  if (!Array.isArray(c) || ![1, 3, 4].includes(c.length)) return null;
  const v = c.map((x) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0));
  let rgb;
  if (v.length === 1) rgb = [v[0], v[0], v[0]];
  else if (v.length === 4) { const k = v[3]; rgb = [(1 - v[0]) * (1 - k), (1 - v[1]) * (1 - k), (1 - v[2]) * (1 - k)]; }
  else rgb = v;
  return "#" + rgb.map((x) => Math.floor(x * 255 + 0.5).toString(16).padStart(2, "0")).join("");
}
const RE_PDF_DATE = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/;
function _fdiv(a, b) { return Math.floor(a / b); }
function _days_from_civil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = _fdiv(y >= 0 ? y : y - 399, 400);
  const yoe = y - era * 400;
  const doy = _fdiv(153 * (m + (m > 2 ? -3 : 9)) + 2, 5) + d - 1;
  const doe = yoe * 365 + _fdiv(yoe, 4) - _fdiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}
function _p2(n) { return String(n).padStart(2, "0"); }
function _iso_of(t) {
  const days = _fdiv(t, 86400), rem = t - days * 86400;
  const z = days + 719468;
  const era = _fdiv(z >= 0 ? z : z - 146096, 146097);
  const doe = z - era * 146097;
  const yoe = _fdiv(doe - _fdiv(doe, 1460) + _fdiv(doe, 36524) - _fdiv(doe, 146096), 365);
  let y = yoe + era * 400;
  const doy = doe - (365 * yoe + _fdiv(yoe, 4) - _fdiv(yoe, 100));
  const mp = _fdiv(5 * doy + 2, 153);
  const d = doy - _fdiv(153 * mp + 2, 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  y += m <= 2 ? 1 : 0;
  return String(y).padStart(4, "0") + "-" + _p2(m) + "-" + _p2(d) + "T" + _p2(_fdiv(rem, 3600)) + ":" + _p2(_fdiv(rem % 3600, 60)) + ":" + _p2(rem % 60) + "Z";
}
function pdf_date_to_iso(s) {
  if (typeof s !== "string") return "";
  const m = RE_PDF_DATE.exec(s.trim());
  if (!m) return "";
  const y = parseInt(m[1], 10), mo = parseInt(m[2] || "1", 10), d = parseInt(m[3] || "1", 10);
  const hh = parseInt(m[4] || "0", 10), mi = parseInt(m[5] || "0", 10), ss = parseInt(m[6] || "0", 10);
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && hh <= 23 && mi <= 59 && ss <= 59)) return "";
  let off = 0;
  if (m[7] === "+" || m[7] === "-") off = (parseInt(m[8] || "0", 10) * 60 + parseInt(m[9] || "0", 10)) * (m[7] === "+" ? 1 : -1);
  return _iso_of(_days_from_civil(y, mo, d) * 86400 + hh * 3600 + mi * 60 + ss - off * 60);
}
function iso_to_pdf_date(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(s || "");
  return m ? "D:" + m.slice(1, 7).join("") + "Z" : "";
}
function measure_dict(in_per_pt, label, settings) {
  const lu = settings.length_unit;
  if (METRIC_UNITS.includes(lu)) {
    return { r: label || "", x: [{ u: "m", c: in_per_pt * 0.0254 }], d: [{ u: "m", c: 1 }], a: [{ u: "sq m", c: 1 }], v: [{ u: "cu m", c: 1 }] };
  }
  return { r: label || "", x: [{ u: "ft", c: in_per_pt / 12 }], d: [{ u: "ft", c: 1 }].concat(lu === "ftin" ? [{ u: "in", c: 12 }] : []),
    a: [{ u: "sq ft", c: 1 }], v: [{ u: "cu ft", c: 1 }] };
}
function scale_from_measure(meas) {
  if (!isObj(meas) || !Array.isArray(meas.x) || !meas.x.length || !isObj(meas.x[0])) return null;
  const c = meas.x[0].c;
  const u = String(has(meas.x[0], "u") ? meas.x[0].u : "").trim().toLowerCase();
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return null;
  if (!has(UNIT_INCHES, u)) return null;
  const ipp = c * UNIT_INCHES[u];
  return ipp >= 1e-6 && ipp <= 1e7 ? ipp : null;
}
function annot_text_box(m) {
  const t = m.type, p = m.points;
  const len = (s) => Array.from(s).length;
  if (t === "stamp") {
    const fs = has(m, "font_size") ? m.font_size : 20;
    const w = Math.max(3, len(m.text || "")) * fs * 0.68 + fs;
    return [p[0][0], p[0][1], p[0][0] + w, p[0][1] + fs * 1.7];
  }
  const fs = has(m, "font_size") ? m.font_size : 12;
  const lines = (m.text || "").split("\n");
  const wchars = Math.max(4, ...lines.map(len));
  const q = t === "callout" ? p[1] : p[0];
  const extra = t === "callout" ? 2 : 1;
  const w = p.length > extra ? Math.abs(p[p.length - 1][0] - q[0]) : wchars * fs * 0.56 + fs * 0.8;
  const h = lines.length * fs * 1.2 + fs * 0.6;
  return [q[0], q[1], q[0] + w, q[1] + h];
}
function _bbox_flat(pts, pad) { const b = bbox(pts); return [_r3(b[0] - pad), _r3(b[1] - pad), _r3(b[2] + pad), _r3(b[3] + pad)]; }
function _circle_pts(c, r, n) { const out = []; for (let i = 0; i < n; i++) out.push([c[0] + r * Math.cos(2 * Math.PI * i / n), c[1] + r * Math.sin(2 * Math.PI * i / n)]); return out; }
function markup_to_annots(m, ctx) {
  const t = m.type;
  const [sub, it] = ANNOT_SUBTYPE[t];
  const st = ctx.settings || {};
  const ipp = has(ctx, "in_per_pt") ? ctx.in_per_pt : null;
  const color = m.color || ctx.color || "";
  const base = {
    subtype: sub, it, color: color ? hex_to_rgb(color) : [0, 0, 0], opacity: has(m, "opacity") ? m.opacity : 1, width: has(m, "width") ? m.width : 1.5,
    subject: m.subject || "", title: m.author || "", nm: m.id, m: iso_to_pdf_date(m.modified || m.created || ""),
    creation: iso_to_pdf_date(m.created || ""), label: m.label || "", private: m,
  };
  if (t === "area" || t === "volume" || t === "highlight" || m.fill) base.interior = m.fill || color ? hex_to_rgb(m.fill || color) : [0, 0, 0];
  let contents = m.text || "";
  if (MEASURE_TYPES.includes(t)) {
    try { const r = measure(m, ipp); contents = Object.keys(st).length ? display(r, st)[0] : contents; } catch (e) { if (!(e instanceof TakeoffError)) throw e; contents = ""; }
    if (ipp !== null && ipp !== undefined && !["count", "angle", "quantity"].includes(t)) base.measure = measure_dict(ipp, ctx.scale_label || "", st);
  }
  base.contents = contents;
  const U = (p) => to_user(ctx, p);
  const P = m.points;
  const pad = (has(m, "width") ? m.width : 1.5) + 2;
  const w = (extra) => Object.assign({}, base, extra);
  if (t === "count") {
    return P.map((p, i) => {
      const ring = _circle_pts(p, 5, 16).map(U);
      const a = w({ vertices: _aflat(ring), rect: _bbox_flat(ring, 1), nm: m.id + (i === 0 ? "" : "." + i) });
      if (i) delete a.private;
      return a;
    });
  }
  if (sub === "Line") {
    const u = [U(P[0]), U(P[1])];
    const a = w({ l: _aflat(u), rect: _bbox_flat(u, pad) });
    if (t === "arrow") a.le = ["None", "OpenArrow"];
    return [a];
  }
  if (t === "perimeter") {
    const ring = P.map(U).concat(P.length > 2 ? [U(P[0])] : []);
    return [w({ vertices: _aflat(ring), rect: _bbox_flat(ring, pad) })];
  }
  if (t === "radius") {
    let c, e;
    if (P.length >= 3) { const o = circle_through(P[0], P[1], P[2]); c = o.center; e = P[0]; } else { c = P[0]; e = P[1]; }
    const r = dist(c, e);
    return [w({ vertices: _aflat([U(e), U(c), U(e)]), rect: _bbox_flat([U([c[0] - r, c[1] - r]), U([c[0] + r, c[1] + r])], pad) })];
  }
  if (sub === "PolyLine" || sub === "Polygon") {
    let u = P.map(U);
    const a = w({ vertices: _aflat(u), rect: _bbox_flat(u, pad + (t === "cloud" ? 8 : 0)) });
    if (t === "cloud" && P.length === 2) { u = [P[0], [P[1][0], P[0][1]], P[1], [P[0][0], P[1][1]]].map(U); a.vertices = _aflat(u); }
    if (t === "cloud") a.cloudy = true;
    return [a];
  }
  if (sub === "Square" || sub === "Circle") {
    let box;
    if (t === "diameter") {
      let c, r;
      if (P.length >= 3) { const o = circle_through(P[0], P[1], P[2]); c = o.center; r = o.radius; }
      else { c = [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2]; r = dist(P[0], P[1]) / 2; }
      box = [U([c[0] - r, c[1] - r]), U([c[0] + r, c[1] + r])];
    } else if (t === "quantity") box = [U([P[0][0] - 6, P[0][1] - 6]), U([P[0][0] + 6, P[0][1] + 6])];
    else box = [U(P[0]), U(P.length > 1 ? P[1] : P[0])];
    const inner = _bbox_flat(box, 0), h = _r3(pad / 2);
    return [w({ rect: [_r3(inner[0] - h), _r3(inner[1] - h), _r3(inner[2] + h), _r3(inner[3] + h)], rd: [h, h, h, h] })];
  }
  if (t === "highlight") {
    const b = _bbox_flat([U(P[0]), U(P[1])], 0);
    return [w({ quad: [b[0], b[3], b[2], b[3], b[0], b[1], b[2], b[1]], rect: b, opacity: has(m, "opacity") ? m.opacity : 0.6 })];
  }
  if (t === "pen") { const u = P.map(U); return [w({ ink: [_aflat(u)], rect: _bbox_flat(u, pad) })]; }
  const box = annot_text_box(m);
  const corners = [U([box[0], box[1]]), U([box[2], box[3]])];
  const inner = _bbox_flat(corners, 0);
  const a = w({ rect: inner, contents: m.text || "" });
  if (t === "callout") {
    const tip = U(P[0]);
    const anchor = [P[0][0] < box[0] ? box[0] : box[2], (box[1] + box[3]) / 2];
    a.cl = tip.concat(U(anchor));
    const outer = _bbox_flat(corners.concat([tip]), 2);
    a.rect = outer;
    a.rd = [_r3(inner[0] - outer[0]), _r3(outer[3] - inner[3]), _r3(outer[2] - inner[2]), _r3(inner[1] - outer[1])];
  }
  return [a];
}
function _num_in(text) { const m = /-?\d[\d,]*(?:\.\d+)?/.exec(text || ""); return m ? Number(m[0].replace(/,/g, "")) : null; }
const VOLUME_WORDS = [["cu yd", 46656], ["cy", 46656], ["cu ft", 1728], ["cf", 1728], ["cu m", 61023.744094732], ["m3", 61023.744094732], ["cu in", 1]];
function _volume_in(text) {
  const t = (text || "").toLowerCase();
  const n = _num_in(t);
  if (n === null) return null;
  for (const [word, k] of VOLUME_WORDS) if (t.includes(word)) return n * k;
  return null;
}
function _aclose(p, q) { return Math.abs(p[0] - q[0]) <= 0.5 && Math.abs(p[1] - q[1]) <= 0.5; }
function _circle_of(m) {
  const P = m.points;
  if (P.length >= 3) { const o = circle_through(P[0], P[1], P[2]); return [o.center, o.radius]; }
  if (m.type === "radius") return [P[0], dist(P[0], P[1])];
  return [[(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2], dist(P[0], P[1]) / 2];
}
function _geometry_matches(stored, read) {
  let a = stored.points, b = read.points;
  const t = stored.type;
  if (t === "cloud" && a.length === 2) a = [a[0], [a[1][0], a[0][1]], a[1], [a[0][0], a[1][1]]];
  try {
    if (t === "perimeter" && b.length === a.length + 1) b = b.slice(0, -1);
    if (["count", "text", "callout", "stamp"].includes(t)) return _aclose(a[0], b[0]);
    if (t === "radius" || t === "diameter") { const [ca, ra] = _circle_of(stored), [cb, rb] = _circle_of(read); return _aclose(ca, cb) && Math.abs(ra - rb) <= 0.5; }
    if (a.length !== b.length) return false;
    return a.every((p, i) => _aclose(p, b[i]));
  } catch (e) { return false; }
}
function annot_to_markup(a, ctx, page, index) {
  if (!isObj(a)) return null;
  const sub = a.subtype;
  const it = String(a.it || "");
  const S = (x, y) => to_sheet(ctx, x, y);
  const nm = typeof a.nm === "string" ? a.nm : "";
  const mid = RE_ID.test(nm) && !RESERVED_IDS.includes(nm) ? nm : "pdf-" + (page + 1) + "-" + (index + 1);
  const scale = scale_from_measure(a.measure);
  const base = { id: mid, page };
  const col = rgb_to_hex(a.color);
  if (col) base.color = col;
  const fill = rgb_to_hex(a.interior);
  for (const [key, src] of [["subject", "subject"], ["author", "title"], ["label", "label"]]) if (typeof a[src] === "string" && a[src].trim()) base[key] = a[src];
  const created = pdf_date_to_iso(a.creation);
  if (created) base.created = created;
  const mod = pdf_date_to_iso(a.m);
  if (mod) base.modified = mod;
  if (typeof a.width === "number" && a.width > 0 && a.width <= 100) base.width = a.width;
  if (typeof a.opacity === "number" && a.opacity >= 0 && a.opacity < 1) base.opacity = a.opacity;
  const contents = typeof a.contents === "string" ? a.contents : "";
  const rect = _anums(a.rect, 4);
  const rd = _anums(a.rd, 4) || [0, 0, 0, 0];
  let count = false, m = null;
  const mk = (extra) => Object.assign({}, base, extra);
  if (sub === "Line") {
    const pts = _pairs(a.l).map((p) => S(p[0], p[1])).slice(0, 2);
    if (pts.length === 2) {
      const le = Array.isArray(a.le) ? a.le : [];
      const arrow = it === "LineArrow" || le.some((x) => typeof x === "string" && x.includes("Arrow"));
      const t = it === "LineDimension" || (scale && !arrow) ? "length" : (arrow ? "arrow" : "line");
      m = mk({ type: t, points: pts });
    }
  } else if (sub === "PolyLine" || sub === "Polygon") {
    const pts = _pairs(a.vertices).map((p) => S(p[0], p[1]));
    if (sub === "PolyLine") {
      if (it === "PolyLineAngle" && pts.length >= 3) m = mk({ type: "angle", points: pts.slice(0, 3) });
      else if (it === "PolyLineDimension" || scale) m = mk({ type: "polylength", points: pts });
      else m = mk({ type: "polyline", points: pts });
    } else if (it === "PolygonCount" && pts.length) {
      m = mk({ type: "count", points: [[_r3(pts.reduce((s, p) => s + p[0], 0) / pts.length), _r3(pts.reduce((s, p) => s + p[1], 0) / pts.length)]] });
      count = true;
    } else if (it === "PolygonRadius" && pts.length >= 2) m = mk({ type: "radius", points: [pts[1], pts[0]] });
    else if (it === "PolygonVolume" && pts.length >= 3) {
      m = mk({ type: "volume", points: pts, depth: 0 });
      if (fill) m.fill = fill;
      const vol = _volume_in(contents);
      if (vol !== null && scale) { const area = Math.abs(signed_area(pts)) * scale * scale; if (area > 0) m.depth = _r3(vol / area); }
    } else if (it === "PolygonCloud" || a.cloudy) m = mk({ type: "cloud", points: pts });
    else if (it === "PolygonDimension" || scale) { m = mk({ type: "area", points: pts }); if (fill) m.fill = fill; }
    else { m = mk({ type: "polygon", points: pts }); if (fill) m.fill = fill; }
  } else if ((sub === "Square" || sub === "Circle") && rect) {
    const p0 = S(rect[0] + rd[0], rect[1] + rd[3]), p1 = S(rect[2] - rd[2], rect[3] - rd[1]);
    const lo = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1])], hi = [Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])];
    if (sub === "Circle" && (it === "CircleDimension" || scale)) { const cy = _r3((lo[1] + hi[1]) / 2); m = mk({ type: "diameter", points: [[lo[0], cy], [hi[0], cy]] }); }
    else { m = mk({ type: sub === "Circle" ? "ellipse" : "rect", points: [lo, hi] }); if (fill) m.fill = fill; }
  } else if (sub === "FreeText" && rect) {
    const p0 = S(rect[0] + rd[0], rect[3] - rd[1]), p1 = S(rect[2] - rd[2], rect[1] + rd[3]);
    const lo = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1])];
    const text = contents || " ";
    const cl = _pairs(a.cl).map((p) => S(p[0], p[1]));
    if (it === "FreeTextCallout" && cl.length) m = mk({ type: "callout", points: [cl[0], lo], text });
    else m = mk({ type: "text", points: [lo], text });
  } else if (sub === "Ink") {
    const strokes = Array.isArray(a.ink) ? a.ink : [];
    if (strokes.length) m = mk({ type: "pen", points: _pairs(strokes[0]).map((p) => S(p[0], p[1])) });
  } else if (sub === "Highlight") {
    const pts = _pairs(a.quad).map((p) => S(p[0], p[1]));
    if (pts.length >= 2) { const b = bbox(pts); m = mk({ type: "highlight", points: [[b[0], b[1]], [b[2], b[3]]] }); }
  } else if (sub === "Stamp" && rect) {
    const p0 = S(rect[0], rect[3]), p1 = S(rect[2], rect[1]);
    m = mk({ type: "stamp", points: [[Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1])]], text: Array.from(contents || a.subject || "STAMP").slice(0, 200).join("") });
  }
  if (m === null) return null;
  let pm = null;
  if (typeof a.private === "string" && a.private) { try { pm = JSON.parse(a.private); } catch (e) { pm = null; } }
  else if (isObj(a.private)) pm = a.private;
  if (isObj(pm) && pm.type && pm.id === m.id) {
    const same = pm.type === m.type || (pm.type === "perimeter" && m.type === "polylength");
    if (same) {
      const cp = clean_markup(Object.assign({}, pm, { page }));
      if (cp && _geometry_matches(cp, m)) m = cp;
      else if (cp) { const keep = _without(cp, ["points", "holes", "type", "page"]); m = Object.assign({}, m, keep); }
    }
  }
  const c = clean_markup(m);
  if (c === null) return null;
  return { markup: c, scale, count };
}
function annots_to_markups(annots, ctx, page) {
  const out = [], counts = new Map(), scales = new Map(), whole = new Set();
  let skipped = 0;
  (annots || []).forEach((a, i) => {
    const nm = isObj(a) && typeof a.nm === "string" ? a.nm : "";
    if (nm.includes(".") && whole.has(nm.slice(0, nm.lastIndexOf(".")))) return;
    const r = annot_to_markup(a, ctx, page, i);
    if (r === null) { skipped += 1; return; }
    if (r.scale) { const k = _r3(r.scale * 1e6) / 1e6; scales.set(k, (scales.get(k) || 0) + 1); }
    let mk = r.markup;
    if (r.count && mk.type === "count" && mk.points.length > 1) { whole.add(mk.id); out.push(mk); return; }
    if (r.count) {
      const key = JSON.stringify([mk.subject || "", mk.color || ""]);
      if (counts.has(key)) { counts.get(key).points.push(mk.points[0]); return; }
      mk = Object.assign({}, mk, { points: mk.points.slice() });
      counts.set(key, mk);
    }
    out.push(mk);
  });
  let best = null;
  for (const [k, n] of scales) if (best === null || n > scales.get(best)) best = k;
  return { markups: out, scale: best, skipped };
}
function viewport_from_vp(vp, ctx, index) {
  if (!isObj(vp)) return null;
  const ipp = scale_from_measure(vp.measure);
  const bb = _anums(vp.bbox, 4);
  if (ipp === null || bb === null) return null;
  const p0 = to_sheet(ctx, bb[0], bb[1]), p1 = to_sheet(ctx, bb[2], bb[3]);
  const rect = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])];
  if (rect[2] - rect[0] <= 0 || rect[3] - rect[1] <= 0) return null;
  const label = isObj(vp.measure) && typeof vp.measure.r === "string" ? vp.measure.r : "";
  const name = typeof vp.name === "string" ? vp.name : "";
  return { id: "vp-" + (index + 1), name: Array.from(name || label || "Viewport " + (index + 1)).slice(0, 100).join(""), rect,
    scale: { in_per_pt: ipp, label: Array.from(label || "").slice(0, 80).join(""), source: "imported" } };
}
