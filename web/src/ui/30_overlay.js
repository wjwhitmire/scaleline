// ---------------------------------------------------------------- markups drawn as SVG over the sheet
// The pencil set: every markup type has a default pencil (a token in the stylesheet) and a second
// cue besides color: end ticks on lengths, a tint on areas, a hatch on volumes, shaped glyphs on
// counts, a long dash on perimeter, angle and radius, scallops on clouds. Every stroke is drawn
// over a paper casing so it reads on white and on gray drawings alike.
const TYPE_PENCIL = {
  length: "m-cobalt", polylength: "m-cobalt", perimeter: "m-sky", area: "m-viridian", volume: "m-plum", count: "m-amber",
  angle: "m-sky", radius: "m-sky", diameter: "m-sky", cloud: "m-redline", callout: "m-graphite", text: "m-graphite", arrow: "m-graphite",
  line: "m-graphite", rect: "m-graphite", ellipse: "m-graphite", polygon: "m-graphite", polyline: "m-graphite", highlight: "m-highlight",
  pen: "m-graphite", stamp: "m-viridian",
};
const PENCIL_NAMES = { "m-cobalt": "Cobalt", "m-viridian": "Viridian", "m-amber": "Amber", "m-plum": "Plum", "m-redline": "Redline", "m-sky": "Sky", "m-graphite": "Graphite" };
const DEFAULT_WIDTH = { length: 2.2, polylength: 2.2, pen: 1.5, cloud: 1.6, callout: 1.1, arrow: 1.6, line: 1.6 };
const DASHED = new Set(["perimeter", "angle", "radius", "diameter"]);
const FILLED = new Set(["area", "volume", "highlight"]);
const FILL_DEFAULT = 0.3;
const STATUS_GLYPH = { Open: ["open-status", "m-graphite"], Review: ["review", "m-amber"], Accepted: ["accepted", "m-viridian"], Completed: ["completed", "m-cobalt"], Rejected: ["rejected", "m-redline"], Cancelled: ["cancelled", "m-graphite"] };
let overlayDirty = true;
on("model", () => { overlayDirty = true; drawOverlay(); });
on("selection", () => { overlayDirty = true; drawOverlay(); });

function pencilColor(name) { return tok(name || "m-graphite"); }
function typeColor(type) { return pencilColor(TYPE_PENCIL[type]); }
function colorOf(m) { return m.color || (m.pencil ? pencilColor(m.pencil) : typeColor(m.type)); }
function widthOf(m) { return m.width !== undefined ? m.width : (DEFAULT_WIDTH[m.type] || 1.75); }
function fillOf(m) { return m.opacity !== undefined ? m.opacity : (m.type === "highlight" ? 0.6 : FILL_DEFAULT); }
function typeIcon(type) { return ICONS[type] ? type : "select"; }
function glyphOf(m) { return m.glyph || (m.type === "count" ? "circle" : null); }
// Which pencil a color is, if it is one of the set.
function pencilOf(hex) { return Object.keys(PENCIL_NAMES).find((k) => tok(k) === String(hex || "").toLowerCase()) || null; }

function cloudPath(pts, closed, r) {
  const P = pts.slice();
  if (closed) P.push(pts[0]);
  let d = "M" + P[0][0] + " " + P[0][1];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const L = C.dist(a, b);
    const n = Math.max(1, Math.round(L / (2 * r)));
    for (let k = 1; k <= n; k++) {
      const x = a[0] + (b[0] - a[0]) * k / n, y = a[1] + (b[1] - a[1]) * k / n;
      const rr = L / n / 2 * 1.08;
      d += " A" + rr + " " + rr + " 0 0 1 " + x + " " + y;
    }
  }
  return d;
}
function rectPts(a, b) { return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; }
function polyD(pts, closed) { return "M" + pts.map((p) => p[0] + " " + p[1]).join(" L") + (closed ? " Z" : ""); }
function arrowHead(a, b, size) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const s = size, w = 0.45;
  const p1 = [b[0] - s * Math.cos(ang - w), b[1] - s * Math.sin(ang - w)], p2 = [b[0] - s * Math.cos(ang + w), b[1] - s * Math.sin(ang + w)];
  return "M" + p1[0] + " " + p1[1] + " L" + b[0] + " " + b[1] + " L" + p2[0] + " " + p2[1];
}
function glyphD(x, y, shape, s) {
  if (shape === "square") return "M" + (x - s * 0.85) + " " + (y - s * 0.85) + "h" + 1.7 * s + "v" + 1.7 * s + "h" + -1.7 * s + "z";
  if (shape === "triangle") return "M" + x + " " + (y - s) + "L" + (x + s) + " " + (y + s * 0.8) + "H" + (x - s) + "z";
  if (shape === "diamond") return "M" + x + " " + (y - s * 1.1) + "L" + (x + s * 1.1) + " " + y + "L" + x + " " + (y + s * 1.1) + "L" + (x - s * 1.1) + " " + y + "z";
  return "M" + (x - s) + " " + y + "a" + s + " " + s + " 0 1 0 " + 2 * s + " 0a" + s + " " + s + " 0 1 0 " + -2 * s + " 0";
}
// A stroke drawn twice: paper casing (width + 2.5) under the colored line.
function cased(g, tag, geom, col, w, opts) {
  const o = opts || {};
  const base = Object.assign({ fill: "none", "stroke-linejoin": "round", "stroke-linecap": o.cap || "round" }, geom);
  g.append(svg(tag, Object.assign({}, base, { class: "ov-cas", "stroke-width": w + 2.5 })));
  const top = svg(tag, Object.assign({}, base, { stroke: col, "stroke-width": w, "stroke-dasharray": o.dash || null, "stroke-opacity": o.opacity !== undefined && o.opacity < 1 ? o.opacity : null }));
  g.append(top);
  return top;
}
// The architect's 45 degree tick at a vertex, turned with the line it ends.
function tick(g, p, ang, col, k) {
  const s = 3.2 * k, a = ang - Math.PI / 4;
  const dx = Math.cos(a) * s, dy = Math.sin(a) * s;
  const d = "M" + (p[0] - dx) + " " + (p[1] - dy) + "L" + (p[0] + dx) + " " + (p[1] + dy);
  g.append(svg("path", { d, class: "ov-cas", "stroke-width": 4 * k, "stroke-linecap": "round" }));
  g.append(svg("path", { d, stroke: col, "stroke-width": 1.6 * k, "stroke-linecap": "round" }));
}
function ticks(g, pts, col, w, closed) {
  const k = Math.max(1, w / 2.2);
  pts.forEach((p, i) => {
    const q = i > 0 ? pts[i - 1] : (closed ? pts[pts.length - 1] : pts[1]);
    if (!q) return;
    const ang = i > 0 || closed ? Math.atan2(p[1] - q[1], p[0] - q[0]) : Math.atan2(q[1] - p[1], q[0] - p[0]);
    tick(g, p, ang, col, k);
  });
}
// Hatch for volumes: a 14 percent wash with 45 degree lines, one pattern per color.
function hatchFill(col) {
  const id = "hatch-" + col.replace(/[^0-9a-z]/gi, "");
  if (!document.getElementById(id)) {
    const pat = svg("pattern", { id, width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, [
      svg("rect", { width: 5, height: 5, fill: col, "fill-opacity": 0.14 }),
      svg("path", { d: "M0 0v5", stroke: col, "stroke-width": 1.6, "stroke-opacity": 0.75 }),
    ]);
    $("ov-defs").append(pat);
  }
  return "url(#" + id + ")";
}
// Labels: paper tags with a hairline in the markup color, the type glyph and tabular figures, drawn
// at a constant screen size (12 px). Selected: inverted to ink. Elements with class ov-fix are
// placed at data-x, data-y in sheet points and scaled by 1 / zoom on every redraw.
const TAG_SIZE = 12;
function tagNode(x, y, text, glyph, col, sel, statusName, dy, start) {
  const size = TAG_SIZE;
  const w = text.length * size * 0.56 + size * 1.9 + 6, h = size * 1.75;
  const x0 = start ? 8 : -w / 2;
  const extra = statusName && STATUS_GLYPH[statusName] ? size * 1.9 : 0;
  const g = svg("g", { class: "ov-fix ov-tag" + (sel ? " sel" : ""), "data-x": x, "data-y": y, "data-dy": dy || 0, "data-x0": x0, "data-w": w + extra, "data-h": h });
  g.append(svg("rect", { x: x0, y: -h / 2, width: w, height: h, rx: 1.6, stroke: col, "stroke-width": 0.9 }));
  const gs = size / 24 * 1.15;
  g.append(svg("g", { transform: "translate(" + (x0 + 3) + " " + (-12 * gs) + ") scale(" + gs + ")" }, [
    svg("path", { d: ICONS[glyph] || "", class: "glyph", fill: "none", stroke: col, "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" }),
  ]));
  const t = svg("text", { x: x0 + size * 1.9 + 3, y: size * 0.36, "font-size": size, class: "ov-tag-t" });
  t.textContent = text;
  g.append(t);
  if (statusName && STATUS_GLYPH[statusName]) g.append(statusBadge(x0 + w + size * 0.9, 0, statusName, size * 0.9));
  return g;
}
function statusBadge(cx, cy, name, size) {
  const [gl, pen] = STATUS_GLYPH[name];
  const sc = size * 1.5 / 24;
  return svg("g", { class: "ov-badge" }, [
    svg("circle", { cx, cy, r: size * 0.85, class: "ov-paper ov-cas", "stroke-width": 1.5 }),
    svg("g", { transform: "translate(" + (cx - 12 * sc) + " " + (cy - 12 * sc) + ") scale(" + sc + ")" }, [
      svg("path", { d: ICONS[gl], fill: "none", stroke: pencilColor(pen), "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round" }),
    ]),
  ]);
}
// Tags stay upright and screen sized: the turn of the view is undone inside each one.
function fixTransform(n, z, extraDy) {
  const turn = S.view.rot ? " rotate(" + -S.view.rot + ")" : "";
  return "translate(" + n.dataset.x + " " + n.dataset.y + ")" + turn + " scale(" + (1 / z) + ") translate(0 " + (Number(n.dataset.dy || 0) + (extraDy || 0)) + ")";
}
function fixScreenSized(root, z) {
  root.querySelectorAll(".ov-fix").forEach((n) => n.setAttribute("transform", fixTransform(n, z)));
}
function textLines(g, x, y, text, fs, color, anchor) {
  const lines = String(text || "").split("\n").slice(0, 60);
  const t = svg("text", { x, y, fill: color, "font-size": fs, class: "ov-text", "text-anchor": anchor || "start" });
  lines.forEach((ln, i) => {
    const s = svg("tspan", { x, dy: i === 0 ? fs : fs * 1.2 });
    s.textContent = ln || " ";
    t.append(s);
  });
  g.append(t);
  return lines;
}
function textBox(m) {
  const fs = m.font_size || 12;
  const lines = String(m.text || "").split("\n");
  const wChars = Math.max(4, ...lines.map((l) => l.length));
  const p = m.type === "callout" ? m.points[1] : m.points[0];
  const w = m.points.length > (m.type === "callout" ? 2 : 1) ? Math.abs(m.points[m.points.length - 1][0] - p[0]) : wChars * fs * 0.56 + fs * 0.8;
  const h = lines.length * fs * 1.2 + fs * 0.6;
  return [p[0], p[1], p[0] + w, p[1] + h];
}
function stampBox(m) {
  const fs = m.font_size || 20;
  const w = Math.max(3, String(m.text || "").length) * fs * 0.68 + fs;
  const p = m.points[0];
  return [p[0], p[1], p[0] + w, p[1] + fs * 1.7];
}
// A diameter: two points across the circle (its center is their midpoint), or three on it.
function diameterGeom(P) {
  if (P.length >= 3) { try { const o = C.circle_through(P[0], P[1], P[2]); return { c: o.center, r: o.radius }; } catch (e) { return { c: P[0], r: 0 }; } }
  const b = P[1] || P[0];
  return { c: [(P[0][0] + b[0]) / 2, (P[0][1] + b[1]) / 2], r: C.dist(P[0], b) / 2 };
}
function radiusGeom(P) {
  let c = P[0], r = P[1] ? C.dist(P[0], P[1]) : 0;
  if (P.length >= 3) { try { const o = C.circle_through(P[0], P[1], P[2]); c = o.center; r = o.radius; } catch (e) { r = 0; } }
  return { c, r };
}

// One markup as an SVG group in sheet points.
function markupNode(m, opts) {
  const o = opts || {};
  const g = svg("g", { "data-id": m.id });
  if (m.status === "Cancelled") g.setAttribute("opacity", 0.4);
  const col = colorOf(m), w = widthOf(m);
  const op = m.opacity !== undefined ? m.opacity : 1;
  const dash = DASHED.has(m.type) ? (7 * w / 1.75) + " " + (3.5 * w / 1.75) : null;
  const P = m.points;
  const disp = o.draft ? o.disp : displayOf(m);
  const lab = disp ? disp.text : "";
  const sel = !!o.sel;
  const st = o.draft ? null : m.status;
  const tag = (x, y, dy, start) => { if (lab) g.append(tagNode(x, y, lab, typeIcon(m.type), col, sel, st, dy, start)); };
  switch (m.type) {
    case "length": case "line": case "arrow": {
      const a = P[0], b = P[1] || P[0];
      cased(g, "path", { d: polyD([a, b]) }, col, w, { opacity: m.type === "length" ? 1 : op });
      if (m.type === "arrow") cased(g, "path", { d: arrowHead(a, b, 6 + w * 2) }, col, w);
      if (m.type === "length") { ticks(g, [a, b], col, w); tag((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
      break;
    }
    case "polylength": case "polyline": case "pen": case "perimeter": {
      const closed = m.type === "perimeter" && P.length > 2;
      cased(g, "path", { d: polyD(P, closed) }, col, w, { dash, cap: dash ? "butt" : "round", opacity: C.MEASURE_TYPES.includes(m.type) ? 1 : op });
      if (m.type === "polylength" || m.type === "perimeter") ticks(g, P, col, m.type === "perimeter" ? w * 0.82 : w, closed);
      if (lab) { const k = Math.floor((P.length - 1) / 2); const a = P[k], b = P[Math.min(P.length - 1, k + 1)]; tag((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
      break;
    }
    case "area": case "volume": case "polygon": {
      let d = polyD(P, true);
      for (const h of m.holes || []) d += " " + polyD(h, true);
      if (m.type === "area") g.append(svg("path", { d, "fill-rule": "evenodd", fill: m.fill || col, "fill-opacity": fillOf(m) }));
      else if (m.type === "volume") g.append(svg("path", { d, "fill-rule": "evenodd", fill: hatchFill(m.fill || col), "fill-opacity": Math.min(1, fillOf(m) / FILL_DEFAULT) }));
      else if (m.fill) g.append(svg("path", { d, "fill-rule": "evenodd", fill: m.fill, "fill-opacity": op }));
      cased(g, "path", { d, "fill-rule": "evenodd" }, col, w);
      if (lab && P.length >= 3) {
        if (m.type === "volume") { const b = C.bbox(P); tag(b[2], (b[1] + b[3]) / 2, 0, true); }
        else { const c = C.centroid(P); tag(c[0], c[1]); }
      }
      break;
    }
    case "count": {
      const shape = glyphOf(m);
      P.forEach((p) => g.append(svg("path", { d: glyphD(p[0], p[1], shape, 5), fill: col, "fill-opacity": 0.9, class: "ov-cas", "stroke-width": 1.4 })));
      if (lab && P.length) tag(P[0][0], P[0][1], -20);
      break;
    }
    case "angle": {
      cased(g, "path", { d: polyD(P) }, col, w, { dash, cap: "butt" });
      if (P.length >= 3 && lab) tag(P[1][0], P[1][1], -20);
      break;
    }
    case "radius": {
      const { c, r } = radiusGeom(P);
      cased(g, "circle", { cx: c[0], cy: c[1], r }, col, w, { dash, cap: "butt" });
      cased(g, "path", { d: polyD([c, P.length >= 3 ? P[0] : (P[1] || c)]) }, col, w * 0.8, { dash: "4 3", cap: "butt" });
      tag(c[0], c[1], -16);
      break;
    }
    case "diameter": {
      const { c, r } = diameterGeom(P);
      cased(g, "circle", { cx: c[0], cy: c[1], r }, col, w, { dash, cap: "butt" });
      const ang = P.length >= 2 ? Math.atan2(P[0][1] - c[1], P[0][0] - c[0]) : 0;
      const a = [c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r], b = [c[0] - Math.cos(ang) * r, c[1] - Math.sin(ang) * r];
      cased(g, "path", { d: polyD([a, b]) }, col, w * 0.8, { cap: "butt" });
      ticks(g, [a, b], col, w);
      tag(c[0], c[1], -16);
      break;
    }
    case "rect": case "highlight": {
      const q = rectPts(P[0], P[1] || P[0]);
      if (m.type === "highlight") g.append(svg("path", { d: polyD(q, true), fill: col, "fill-opacity": fillOf(m), stroke: "none", style: "mix-blend-mode:multiply" }));
      else {
        if (m.fill) g.append(svg("path", { d: polyD(q, true), fill: m.fill, "fill-opacity": op }));
        cased(g, "path", { d: polyD(q, true) }, col, w);
      }
      break;
    }
    case "ellipse": {
      const a = P[0], b = P[1] || P[0];
      const geom = { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2 };
      if (m.fill) g.append(svg("ellipse", Object.assign({ fill: m.fill, "fill-opacity": op }, geom)));
      cased(g, "ellipse", geom, col, w);
      break;
    }
    case "cloud": {
      const pts = P.length === 2 ? rectPts(P[0], P[1]) : P;
      cased(g, "path", { d: cloudPath(pts, true, 7) }, col, w);
      const b = C.bbox(pts);
      if (o.cloudNo) {
        const d = svg("g", { class: "ov-fix ov-delta", "data-x": b[2], "data-y": b[1], "data-dy": 0 }, [
          svg("path", { d: "M0 -8l7.5 12.5h-15z", class: "ov-paper", stroke: col, "stroke-width": 1.3 }),
        ]);
        const t = svg("text", { x: 0, y: 2.6, "font-size": 8, "text-anchor": "middle", fill: col, class: "ov-tag-t" });
        t.textContent = String(o.cloudNo);
        d.append(t);
        g.append(d);
      }
      if (m.text) textLines(g, b[2] + 6, b[1], m.text, m.font_size || 10, col);
      break;
    }
    case "callout": {
      const box = textBox(m);
      const tip = P[0];
      const anchor = [tip[0] < box[0] ? box[0] : box[2], (box[1] + box[3]) / 2];
      cased(g, "path", { d: polyD([tip, anchor]) }, col, w);
      cased(g, "path", { d: arrowHead(anchor, tip, 7) }, col, w);
      g.append(svg("rect", { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1], class: "ov-paper", stroke: col, "stroke-width": Math.max(0.75, w) }));
      textLines(g, box[0] + (m.font_size || 12) * 0.4, box[1] + (m.font_size || 12) * 0.1, m.text, m.font_size || 12, m.color || paperInk());
      break;
    }
    case "text": {
      textLines(g, P[0][0], P[0][1], m.text, m.font_size || 12, col);
      break;
    }
    case "stamp": {
      const b = stampBox(m), fs = m.font_size || 20;
      g.append(svg("rect", { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1], rx: fs * 0.3, fill: "none", stroke: col, "stroke-width": Math.max(1.5, fs / 10) }));
      const t = svg("text", { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, fill: col, "font-size": fs, "font-weight": 700, class: "ov-stamp", "text-anchor": "middle", "dominant-baseline": "central" });
      t.textContent = m.text || "STAMP";
      g.append(t);
      break;
    }
    default: break;
  }
  // Label priority when labels collide: the selected one first, then the larger measurements.
  const tagEl = g.querySelector(".ov-tag");
  if (tagEl) { const b = C.bbox(P); tagEl.dataset.pri = sel ? Infinity : (b[2] - b[0]) * (b[3] - b[1]) + C.dist([b[0], b[1]], [b[2], b[3]]); }
  return g;
}
function markupBounds(m) {
  if (m.type === "callout") { const b = textBox(m); return C.bbox([m.points[0], [b[0], b[1]], [b[2], b[3]]]); }
  if (m.type === "text") return textBox(m);
  if (m.type === "stamp") return stampBox(m);
  if (m.type === "radius" || m.type === "diameter") { const { c, r } = (m.type === "radius" ? radiusGeom : diameterGeom)(m.points); return [c[0] - r, c[1] - r, c[0] + r, c[1] + r]; }
  if (m.type === "count") { const b = C.bbox(m.points); return [b[0] - 6, b[1] - 6, b[2] + 6, b[3] + 6]; }
  return C.markup_bbox(m);
}

// Redraw the overlay: markups (rebuilt when the model or selection changed), then the screen
// layer (handles, draft, candidates), which follows every view change.
function drawOverlay() {
  if (!S.doc || !model()) return;
  const root = $("ov-root");
  const z = S.view.zoom;
  root.setAttribute("transform", matrixAttr(viewMatrix()));
  if (overlayDirty || root.dataset.page !== String(S.view.page)) {
    clear(root);
    // viewports: a dashed box with the name and scale at its top left corner
    for (const v of viewportsOf(S.view.page)) {
      const r = v.rect, g = svg("g", { class: "ov-vp", "data-vp": v.id });
      g.append(svg("rect", { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1], class: "ov-vp-box", "vector-effect": "non-scaling-stroke" }));
      const tg = tagNode(r[0], r[1], v.name + "  " + (v.scale.label || ""), "viewport", "var(--muted)", false, null, -10, true);
      tg.dataset.pri = "1000000000";
      g.append(tg);
      root.append(g);
    }
    let clouds = 0;
    for (const m of pageMarkups(S.view.page)) {
      if (!layerVisible(m)) continue;
      root.append(markupNode(m, { sel: S.selection.has(m.id), cloudNo: m.type === "cloud" ? ++clouds : 0 }));
    }
    root.dataset.page = String(S.view.page);
    overlayDirty = false;
  }
  fixScreenSized(root, z);
  placeTags(root, z);
  drawScreenLayer();
}
// Greedy label placement: keep the selected label and the larger measurements; a label that
// would overlap one already placed moves above or below, and is hidden when neither is free.
// View > Show all labels turns this off.
function placeTags(root, z) {
  const tags = Array.from(root.querySelectorAll(".ov-tag"));
  for (const t of tags) { t.removeAttribute("display"); t.removeAttribute("data-placed"); }
  if (S.settings.declutter === false || tags.length < 2) return;
  tags.sort((a, b) => Number(b.dataset.pri) - Number(a.dataset.pri));
  const placed = [];
  const free = (r) => placed.every((q) => r[0] >= q[2] + 2 || r[2] <= q[0] - 2 || r[1] >= q[3] + 2 || r[3] <= q[1] - 2);
  for (const t of tags) {
    const sp = pageToScreen(Number(t.dataset.x), Number(t.dataset.y));
    const sx = sp[0], sy = sp[1] + Number(t.dataset.dy || 0);
    const x0 = Number(t.dataset.x0), w = Number(t.dataset.w), h = Number(t.dataset.h);
    let done = false;
    for (const off of [0, -(h + 3), h + 3]) {
      const r = [sx + x0, sy + off - h / 2, sx + x0 + w, sy + off + h / 2];
      if (!free(r)) continue;
      placed.push(r);
      if (off) t.dataset.placed = "moved";
      if (off) t.setAttribute("transform", fixTransform(t, z, off));
      done = true;
      break;
    }
    if (!done) { t.setAttribute("display", "none"); t.dataset.placed = "hidden"; }
  }
}
// Two-tone screen marks: a paper line under an ink line, so they read on any drawing and markup.
function twoTone(scr, tag, geom, under, cls, w) {
  scr.append(svg(tag, Object.assign({ class: under, "stroke-width": w + 2.5 }, geom)));
  scr.append(svg(tag, Object.assign({ class: cls, "stroke-width": w }, geom)));
}
function drawScreenLayer() {
  const scr = $("ov-screen");
  clear(scr);
  const z = S.view.zoom;
  const toS = (p) => pageToScreen(p[0], p[1]);
  // search hits
  if (S.search && S.search.hits) {
    for (const h of S.search.hits) {
      if (h.page !== S.view.page) continue;
      const r = screenRect([h.x, h.y - h.h, h.x + h.w, h.y + h.h * 0.25]);
      scr.append(svg("rect", { x: r[0], y: r[1], width: Math.max(2, r[2] - r[0]), height: Math.max(2, r[3] - r[1]), class: "ov-search" }));
    }
  }
  // symbol search candidates waiting for a decision: ink boxes, unchecked ones dashed
  if (S.candidates) {
    S.candidates.items.filter((c) => c.page === S.view.page).forEach((c) => {
      const r = screenRect([c.x0, c.y0, c.x1, c.y1]);
      const geom = { x: r[0] - 3, y: r[1] - 3, width: r[2] - r[0] + 6, height: r[3] - r[1] + 6 };
      if (c.on) twoTone(scr, "rect", geom, "ov-cand-under", "ov-cand", 2);
      else scr.append(svg("rect", Object.assign({ class: "ov-cand off", "stroke-width": 1.5 }, geom)));
    });
  }
  // auto-takeoff and plan review suggestions waiting for a decision
  if (typeof atOverlay === "function") atOverlay(scr);
  if (typeof reviewOverlay === "function") reviewOverlay(scr);
  // compare: changed areas as numbered redline clouds
  if (S.compare && S.compare.boxes && S.compare.page === S.view.page && S.compare.showBoxes) {
    const red = pencilColor("m-redline");
    S.compare.boxes.forEach((b, i) => {
      const sr = screenRect(b), a = [sr[0], sr[1]], c = [sr[2], sr[3]];
      const pts = rectPts([a[0] - 4, a[1] - 4], [c[0] + 4, c[1] + 4]);
      cased(scr, "path", { d: cloudPath(pts, true, Math.max(3, Math.min(8, Math.min(c[0] - a[0], c[1] - a[1]) / 4))) }, red, 1.6);
      const no = svg("g", { class: "ov-cmp-no", transform: "translate(" + (a[0] - 22) + " " + (a[1] - 8) + ")" }, [svg("rect", { width: 16, height: 15, "stroke-width": 1 })]);
      const t = svg("text", { x: 8, y: 11, "text-anchor": "middle" });
      t.textContent = String(i + 1);
      no.append(t);
      scr.append(no);
    });
  }
  // selection: a two-tone dashed box and paper handles with an ink border
  for (const id of S.selection) {
    const m = markupById(id);
    if (!m || m.page !== S.view.page) continue;
    const sr = screenRect(markupBounds(m));
    const geom = { x: sr[0] - 5, y: sr[1] - 5, width: sr[2] - sr[0] + 10, height: sr[3] - sr[1] + 10 };
    scr.append(svg("rect", Object.assign({ class: "ov-sel-under", "stroke-width": 2.6 }, geom)));
    scr.append(svg("rect", Object.assign({ class: "ov-sel", "stroke-width": 1.1 }, geom)));
    if (S.selection.size === 1 && editableVertices(m)) {
      const all = m.points.map((p, i) => ({ p, ring: -1, i })).concat(...(m.holes || []).map((h, hi) => h.map((p, i) => ({ p, ring: hi, i }))));
      for (const v of all) {
        const s = toS(v.p);
        scr.append(svg("rect", { x: s[0] - 3.2, y: s[1] - 3.2, width: 6.4, height: 6.4, class: "ov-handle", "stroke-width": 1.2 }));
      }
    }
  }
  // the shape being drawn, and what live session peers are drawing and pointing at
  if (S.draft) drawDraft(scr, z);
  drawLivePeers(scr);
  // snap glyphs: vertex square, midpoint triangle, nearest circle; ink over a paper ring
  if (S.snapHint) {
    const s = toS(S.snapHint.point);
    const kind = S.snapHint.kind;
    if (kind === "vertex") twoTone(scr, "rect", { x: s[0] - 5, y: s[1] - 5, width: 10, height: 10 }, "ov-snap-under", "ov-snap", 1.6);
    else if (kind === "midpoint") twoTone(scr, "path", { d: "M" + (s[0] - 6) + " " + (s[1] + 5) + " L" + s[0] + " " + (s[1] - 6) + " L" + (s[0] + 6) + " " + (s[1] + 5) + " Z" }, "ov-snap-under", "ov-snap", 1.6);
    else twoTone(scr, "circle", { cx: s[0], cy: s[1], r: 5 }, "ov-snap-under", "ov-snap", 1.6);
  }
}
function editableVertices(m) {
  return !["text", "stamp", "pen"].includes(m.type);
}
