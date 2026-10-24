// Auto-takeoff: walls, rooms, doors, windows and repeated symbols from a sheet's line work.
// Deterministic geometry, no model; the same results as src/plantakeoff/autotakeoff.py (methods and
// limits are written there). Input is in sheet points (origin top left, y down). Every result is a
// suggestion with a confidence and a why; nothing becomes a markup until the person accepts it.
//
// extract_paths reads a pdf.js operator list into that input: straight segments with their line
// width and a fill flag, and cubic curves (door swings and symbols), through the page transform.
const {
  auto_takeoff, auto_proposals, auto_classify_wall, auto_clean_rules, auto_drawing_area, auto_text_lines, auto_scan_door_arcs,
  AUTO_DEFAULTS, AUTO_RULES, extract_paths,
} = (() => {
  const PAR = 0.0175, PERP = 0.0175, DEFAULT_IPP = 48 / 72;
  const LIM = { segs: 60000, curves: 20000, text: 20000, walls: 3000 };
  const DEFAULTS = Object.freeze({
    wall_min_in: 2.5, wall_max_in: 16.0, wall_min_len_in: 24.0, door_min_in: 18.0, door_max_in: 48.0,
    window_min_in: 12.0, window_max_in: 144.0, room_min_sf: 16.0, room_min_width_in: 18.0,
    symbol_min_pt: 3.0, symbol_max_pt: 40.0, symbol_min_count: 3, bridge_in: 0,
  });
  const HATCH = ["any", "yes", "no"];
  const RULES = Object.freeze([
    Object.freeze({ id: "ext-outline", name: "Exterior wall", preset: "p-ext-wall", min_in: 0, max_in: 1e9, min_weight: 0, max_weight: 1e9, hatch: "any", fill: "any", outer: "yes" }),
    Object.freeze({ id: "ext-hatched", name: "Exterior wall", preset: "p-ext-wall", min_in: 0, max_in: 1e9, min_weight: 0, max_weight: 1e9, hatch: "yes", fill: "any", outer: "any" }),
    Object.freeze({ id: "int", name: "Interior partition", preset: "p-int-wall", min_in: 0, max_in: 1e9, min_weight: 0, max_weight: 1e9, hatch: "any", fill: "any", outer: "any" }),
  ]);
  const DIM_TEXT = /^\s*\d+\s*'\s*(-?\s*\d+(\s+\d+\/\d+)?\s*"?)?\s*$|^\s*\d+(\s+\d+\/\d+)?\s*"\s*$|^\s*\d+'?-\d+/;
  const AREA_TEXT = /^\s*[\d,.]+\s*(SF|S\.F\.|SQ\.?\s*FT\.?|M2)\s*$/i;
  const DOOR_TAG = /^(D-?\d{1,3}[A-Z]?|\d{1,4}[A-Z])$/;
  const ROOM_NO = /^[A-Z]?\d{1,4}$/;
  const LEGEND_WORDS = /^(LEGEND|SYMBOLS?|SYMBOL LEGEND|KEY|NOTES?|GENERAL NOTES)\s*:?$/i;
  const rnd = (x) => Math.floor(x + 0.5);
  const r6 = (x) => rnd(x * 1e6) / 1e6;
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const len = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
  const g = (x) => String(x);

  // ---------------------------------------------------------------- input
  function cleanPage(page) {
    if (!page || typeof page !== "object" || Array.isArray(page)) throw new TakeoffError("input", "The sheet must be an object with its line work");
    const w = page.w, h = page.h;
    if (!(num(w) && num(h) && w > 0 && h > 0)) throw new TakeoffError("input", "The sheet needs its width and height in points");
    const segs = [];
    for (const s of Array.isArray(page.segs) ? page.segs.slice(0, LIM.segs) : []) {
      if (!Array.isArray(s) || s.length < 4 || !s.slice(0, 4).every(num)) continue;
      let x0 = s[0], y0 = s[1], x1 = s[2], y1 = s[3];
      const lw = s.length > 4 && num(s[4]) && s[4] >= 0 ? s[4] : 0;
      const fill = s.length > 5 && s[5] === 1 ? 1 : 0;
      let dx = x1 - x0, dy = y1 - y0;
      if (dx < 0 || (dx === 0 && dy < 0)) { [x0, y0, x1, y1] = [x1, y1, x0, y0]; dx = -dx; dy = -dy; }
      const L = len(dx, dy);
      if (L < 0.5) continue;
      segs.push({ i: segs.length, a: [x0, y0], b: [x1, y1], u: [dx / L, dy / L], L, w: lw, f: fill });
    }
    const curves = [];
    for (const c of Array.isArray(page.curves) ? page.curves.slice(0, LIM.curves) : []) {
      if (!Array.isArray(c) || c.length < 8 || !c.slice(0, 8).every(num)) continue;
      const lw = c.length > 8 && num(c[8]) && c[8] >= 0 ? c[8] : 0;
      curves.push({ i: curves.length, p: [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]], [c[6], c[7]]], w: lw });
    }
    const text = [];
    for (const it of Array.isArray(page.text) ? page.text.slice(0, LIM.text) : []) {
      if (it && typeof it === "object" && typeof it.str === "string" && ["x", "y", "w", "h"].every((k) => num(it[k]))) text.push(it);
    }
    const ipp = num(page.in_per_pt) && page.in_per_pt > 0 ? page.in_per_pt : null;
    return { w, h, segs, curves, text, ipp };
  }

  function drawingArea(segs, w, h) {
    let x0 = 0, y0 = 0, x1 = w, y1 = h;
    for (const s of segs) {
      const a = [s[0], s[1]], b = [s[2], s[3]];
      const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
      if (dx <= PAR * dy && dy >= 0.8 * h && Math.min(a[1], b[1]) <= 0.15 * h && Math.max(a[1], b[1]) >= 0.85 * h) {
        const x = (a[0] + b[0]) / 2;
        if (x >= 0.6 * w) x1 = Math.min(x1, x);
        else if (x <= 0.4 * w) x0 = Math.max(x0, x);
      } else if (dy <= PAR * dx && dx >= 0.8 * w && Math.min(a[0], b[0]) <= 0.15 * w && Math.max(a[0], b[0]) >= 0.85 * w) {
        const y = (a[1] + b[1]) / 2;
        if (y >= 0.6 * h) y1 = Math.min(y1, y);
        else if (y <= 0.4 * h) y0 = Math.max(y0, y);
      }
    }
    return [x0, y0, x1, y1];
  }

  function textLines(items) {
    const its = [];
    for (const it of items || []) {
      if (!it || typeof it !== "object" || typeof it.str !== "string") continue;
      const s = it.str.replace(/\s+/g, " ").trim();
      if (!s || s.length > 300) continue;
      const nums = [it.x, it.y, it.w, it.h];
      if (!nums.every(num)) continue;
      its.push({ str: s, x: nums[0], y: nums[1], w: Math.max(0, nums[2]), h: Math.max(0, nums[3]), v: it.vertical === true });
    }
    its.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of its) {
      const tol = Math.max(1.5, it.h * 0.4);
      let line = null;
      for (const ln of it.v ? [] : lines) {
        if (ln.v) continue;
        if (Math.abs(ln.y - it.y) <= tol && it.x >= ln.x1 - it.h * 0.5 && it.x - ln.x1 < Math.min(it.h, ln.h) * 2.5) { line = ln; break; }
      }
      if (!line) { line = { y: it.y, x0: it.x, x1: it.x + it.w, h: it.h, parts: [], v: it.v }; lines.push(line); }
      line.parts.push(it);
      line.x1 = Math.max(line.x1, it.x + it.w);
      line.x0 = Math.min(line.x0, it.x);
      line.h = Math.max(line.h, it.h);
    }
    return lines.map((ln) => {
      ln.parts.sort((a, b) => a.x - b.x);
      let s = "", last = null;
      for (const p of ln.parts) {
        if (last !== null && p.x - last > p.h * 0.15) s += " ";
        s += p.str;
        last = p.x + p.w;
      }
      return { str: s.replace(/\s+/g, " ").trim(), x: ln.x0, y: ln.y, w: ln.x1 - ln.x0, h: ln.h };
    });
  }

  // ---------------------------------------------------------------- spatial grid
  class Grid {
    constructor(cell, cap) { this.cell = cell; this.cap = cap || 4000; this.cells = new Map(); this.wide = []; }
    add(idx, x0, y0, x1, y1) {
      const c = this.cell;
      const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c), j0 = Math.floor(y0 / c), j1 = Math.floor(y1 / c);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > this.cap) { this.wide.push(idx); return; }
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = i * 1000003 + j;
        let l = this.cells.get(k);
        if (!l) { l = []; this.cells.set(k, l); }
        l.push(idx);
      }
    }
    query(x0, y0, x1, y1) {
      const c = this.cell;
      const out = new Set(this.wide);
      const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c), j0 = Math.floor(y0 / c), j1 = Math.floor(y1 / c);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > this.cap * 4) {
        for (const v of this.cells.values()) for (const x of v) out.add(x);
      } else {
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const v = this.cells.get(i * 1000003 + j);
          if (v) for (const x of v) out.add(x);
        }
      }
      return Array.from(out).sort((a, b) => a - b);
    }
  }
  const segBox = (s, pad) => [Math.min(s.a[0], s.b[0]) - pad, Math.min(s.a[1], s.b[1]) - pad, Math.max(s.a[0], s.b[0]) + pad, Math.max(s.a[1], s.b[1]) + pad];
  function frame(s, p) {
    const dx = p[0] - s.a[0], dy = p[1] - s.a[1];
    return [dx * s.u[0] + dy * s.u[1], -dx * s.u[1] + dy * s.u[0]];
  }
  const parallel = (s, t) => Math.abs(s.u[0] * t.u[1] - s.u[1] * t.u[0]) <= PAR;
  const perp = (s, t) => Math.abs(s.u[0] * t.u[0] + s.u[1] * t.u[1]) <= PERP;
  function relation(s, t) {
    if (!parallel(s, t)) return null;
    const [a0, o0] = frame(s, t.a), [a1, o1] = frame(s, t.b);
    return [(o0 + o1) / 2, Math.min(a0, a1), Math.max(a0, a1), Math.abs(o0 - o1)];
  }

  // ---------------------------------------------------------------- windows
  function findWindows(segs, grid, lim) {
    const { tmin, tmax } = lim;
    const found = [], glass = new Set();
    for (const gl of segs) {
      if (gl.L < lim.window_min || gl.L > lim.window_max) continue;
      const best = { 1: null, "-1": null };
      for (const j of grid.query(...segBox(gl, tmax))) {
        if (j === gl.i) continue;
        const rel = relation(gl, segs[j]);
        if (rel === null) continue;
        const [off, a0, a1, spread] = rel;
        if (spread > 0.25 + 0.05 * Math.abs(off) || Math.abs(off) < tmin * 0.25 || Math.abs(off) > tmax) continue;
        const ov = Math.min(gl.L, a1) - Math.max(0, a0);
        if (ov < 0.8 * gl.L) continue;
        const side = off > 0 ? 1 : -1;
        const cur = best[side];
        if (cur === null || Math.abs(off) < Math.abs(cur[0]) || (Math.abs(off) === Math.abs(cur[0]) && j < cur[1])) best[side] = [off, j];
      }
      if (best[1] === null || best["-1"] === null) continue;
      const oa = best["-1"][0], ob = best[1][0];
      const width = ob - oa;
      if (width < tmin || width > tmax) continue;
      if (Math.min(-oa, ob) / Math.max(-oa, ob) < 0.25) continue;
      const tol = Math.max(1.5, 0.1 * gl.L);
      const jambs = [];
      for (const end of [0, gl.L]) {
        let hit = null;
        for (const j of grid.query(...segBox(gl, tmax))) {
          const t = segs[j];
          if (j === gl.i || !perp(gl, t)) continue;
          const [a0, o0] = frame(gl, t.a), [a1, o1] = frame(gl, t.b);
          if (Math.abs((a0 + a1) / 2 - end) > tol) continue;
          const lo = Math.min(o0, o1), hi = Math.max(o0, o1);
          if (Math.min(hi, ob) - Math.max(lo, oa) >= 0.7 * width) { hit = j; break; }
        }
        jambs.push(hit);
      }
      const jambSegs = jambs.filter((j) => j !== null);
      const n = jambSegs.length;
      if (n === 0) continue;
      const mid = [(gl.a[0] + gl.b[0]) / 2, (gl.a[1] + gl.b[1]) / 2];
      let dup = false;
      for (const f of found) {
        if (Math.abs(f.u[0] * gl.u[1] - f.u[1] * gl.u[0]) <= PAR && len(f.c[0] - mid[0], f.c[1] - mid[1]) < 0.5 * f.L) { dup = true; break; }
      }
      glass.add(gl.i);
      if (dup) continue;
      found.push({ c: mid, u: gl.u, L: gl.L, t: width, jambs: n, glass: gl.i, jambSegs, faces: [best["-1"][1], best[1][1]], a: gl.a, b: gl.b });
    }
    return [found, glass];
  }

  // ---------------------------------------------------------------- doors
  function circle(a, b, c) {
    const ax = a[0], ay = a[1];
    const bx = b[0] - ax, by = b[1] - ay, cx = c[0] - ax, cy = c[1] - ay;
    const d = 2 * (bx * cy - by * cx);
    if (Math.abs(d) < 1e-9) return null;
    const b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (cy * b2 - by * c2) / d, uy = (bx * c2 - cx * b2) / d;
    return [[ax + ux, ay + uy], len(ux, uy)];
  }
  function bez(p, t) {
    const m = 1 - t;
    const a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
    return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
  }
  function arcFromPoints(pts) {
    const a = pts[0], m = pts[Math.floor(pts.length / 2)], b = pts[pts.length - 1];
    const circ = circle(a, m, b);
    if (circ === null) return null;
    const [c, r] = circ;
    for (const p of pts) if (Math.abs(len(p[0] - c[0], p[1] - c[1]) - r) > 0.004 * r + 0.05) return null;
    const va = [a[0] - c[0], a[1] - c[1]], vb = [b[0] - c[0], b[1] - c[1]], vm = [m[0] - c[0], m[1] - c[1]];
    const cosw = (va[0] * vb[0] + va[1] * vb[1]) / (r * r);
    if ((va[0] * vm[0] + va[1] * vm[1]) / (r * r) < cosw - 1e-9) return null;
    return { c, r, p0: a, p1: b, cos: cosw };
  }
  const key4 = (p) => rnd(p[0] * 4) + "," + rnd(p[1] * 4);
  function findArcs(curves, segs, lim) {
    const out = [];
    for (const cv of curves) {
      const arc = arcFromPoints([0, 0.25, 0.5, 0.75, 1].map((t) => bez(cv.p, t)));
      if (arc) { arc.src = ["c", cv.i]; out.push(arc); }
    }
    const short = segs.filter((s) => s.L <= lim.door_max * 0.45);
    const ends = new Map();
    for (const s of short) for (const p of [s.a, s.b]) {
      const k = key4(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(s.i);
    }
    const cnt = (k) => (ends.get(k) || []).length;
    const used = new Set();
    for (const s of short) {
      if (used.has(s.i)) continue;
      const ka = key4(s.a), kb = key4(s.b);
      if (cnt(ka) === 2 && cnt(kb) === 2) continue;
      const chain = [s.i];
      const pts = cnt(ka) !== 2 ? [s.a, s.b] : [s.b, s.a];
      let cur = key4(pts[pts.length - 1]);
      const seen = new Set([s.i]);
      while (chain.length < 400) {
        const nxt = (ends.get(cur) || []).filter((j) => !seen.has(j));
        if (nxt.length !== 1 || cnt(cur) !== 2) break;
        const t = segs[nxt[0]];
        seen.add(t.i);
        chain.push(t.i);
        const far = key4(t.a) === cur ? t.b : t.a;
        pts.push(far);
        cur = key4(far);
      }
      if (chain.length < 4) continue;
      const runs = [];
      for (let i = 0; i < pts.length - 4; i++) {
        let j = i + 4;
        if (arcFromPoints(pts.slice(i, j + 1)) === null) continue;
        while (j + 1 < pts.length && arcFromPoints(pts.slice(i, j + 2)) !== null) j++;
        runs.push([j - i, i, j]);
      }
      runs.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
      const taken = [];
      for (const [, i, j] of runs) {
        if (taken.some(([a, b]) => i < b && a < j)) continue;
        taken.push([i, j]);
        const arc = arcFromPoints(pts.slice(i, j + 1));
        arc.src = ["s", chain.slice(i, j)];
        for (const x of chain.slice(i, j)) used.add(x);
        out.push(arc);
      }
    }
    const joined = [], taken = new Set();
    out.forEach((a, i) => {
      if (taken.has(i)) return;
      let cur = Object.assign({}, a);
      for (let j = i + 1; j < out.length; j++) {
        if (taken.has(j)) continue;
        const b = out[j];
        if (a.cos < 0.7 || b.cos < 0.7) continue;
        if (len(a.c[0] - b.c[0], a.c[1] - b.c[1]) > 0.03 * a.r + 0.3 || Math.abs(a.r - b.r) > 0.03 * a.r + 0.3) continue;
        const tol = 0.05 * a.r + 0.3;
        const pairs = [[cur.p1, b.p0, cur.p0, b.p1], [cur.p1, b.p1, cur.p0, b.p0], [cur.p0, b.p0, cur.p1, b.p1], [cur.p0, b.p1, cur.p1, b.p0]];
        for (const [meet, other, keep, far] of pairs) {
          if (len(meet[0] - other[0], meet[1] - other[1]) <= tol) {
            const c = cur.c, r = cur.r;
            const va = [keep[0] - c[0], keep[1] - c[1]], vb = [far[0] - c[0], far[1] - c[1]];
            cur = { c, r, p0: keep, p1: far, cos: (va[0] * vb[0] + va[1] * vb[1]) / (r * r), src: cur.src };
            taken.add(j);
            break;
          }
        }
      }
      joined.push(cur);
    });
    return joined;
  }

  // Door swings on a scanned sheet, from its ink mask: a circular vote constrained to quarter arcs
  // at wall gaps, plus the leaf line (method in autotakeoff.py, scan_door_arcs). Pixels in and out.
  const SCAN_DOOR_BINS = 30, SCAN_DOOR_LIM = { segs: 20000, gaps: 4000 };
  function scanDoorArcs(mask, w, h, segs, opts) {
    const o = opts && typeof opts === "object" ? opts : {};
    const rMin = o.r_min, rMax = o.r_max;
    if (!(num(rMin) && num(rMax) && rMin >= 2 && rMin <= rMax && rMax <= 4000)) throw new TakeoffError("input", "Door radii must be numbers of pixels, r_min up to r_max");
    if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w * h <= 400000000)) throw new TakeoffError("input", "The picture needs its width and height in pixels");
    if (!mask || !(mask.length >= w * h)) throw new TakeoffError("input", "The mask is smaller than the picture");
    const NB = SCAN_DOOR_BINS, BAND = 2, CELL = 32, QMAX = NB + 4;
    const gw = Math.floor((w + CELL - 1) / CELL), gh = Math.floor((h + CELL - 1) / CELL);
    const buckets = new Map();
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (!mask[row + x]) continue;
        const key = Math.floor(x / CELL) + Math.floor(y / CELL) * gw;
        let l = buckets.get(key);
        if (!l) { l = []; buckets.set(key, l); }
        l.push(x, y);
      }
    }
    const ink = (x, y) => {
      const xi = Math.floor(x + 0.5), yi = Math.floor(y + 0.5);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = xi + dx, yy = yi + dy;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h && mask[yy * w + xx]) return true;
      }
      return false;
    };
    const S = [];
    (Array.isArray(segs) ? segs : []).slice(0, SCAN_DOOR_LIM.segs).forEach((s, i) => {
      if (!Array.isArray(s) || s.length < 4 || !s.slice(0, 4).every(num)) return;
      const dx = s[2] - s[0], dy = s[3] - s[1], L = len(dx, dy);
      if (L >= 2) S.push([i, [s[0], s[1]], [s[2], s[3]], [dx / L, dy / L]]);
    });
    const gmin = rMin * 0.9, gmax = 2 * rMax * 1.05;
    const ends = new Grid(Math.max(8, gmax));
    S.forEach((s, k) => { for (const p of [s[1], s[2]]) ends.add(k, p[0], p[1], p[0], p[1]); });
    const gaps = [], seen = new Set();
    outer: for (let k = 0; k < S.length; k++) {
      const [, a, b, u] = S[k];
      for (const [e, d] of [[a, [-u[0], -u[1]]], [b, u]]) {
        let best = null;
        for (const j of ends.query(e[0] - gmax, e[1] - gmax, e[0] + gmax, e[1] + gmax)) {
          if (j === k) continue;
          const [, a2, b2, u2] = S[j];
          if (Math.abs(u[0] * u2[1] - u[1] * u2[0]) > 0.035) continue;
          for (const [f, other] of [[a2, b2], [b2, a2]]) {
            const vx = f[0] - e[0], vy = f[1] - e[1], along = vx * d[0] + vy * d[1];
            if (along < gmin || along > gmax || Math.abs(vx * d[1] - vy * d[0]) > 3) continue;
            if ((other[0] - e[0]) * d[0] + (other[1] - e[1]) * d[1] <= along) continue;
            if (best === null || along < best[0]) best = [along, j, f];
          }
        }
        if (best === null) continue;
        const key = Math.min(k, best[1]) + ":" + Math.max(k, best[1]);
        if (seen.has(key)) continue;
        seen.add(key);
        gaps.push([e, best[2], best[0]]);
        if (gaps.length >= SCAN_DOOR_LIM.gaps) break outer;
      }
    }
    const cands = [];
    for (const [e1, e2, g] of gaps) {
      const u = [(e2[0] - e1[0]) / g, (e2[1] - e1[1]) / g], n = [-u[1], u[0]];
      const rlo = Math.max(rMin, 0.38 * g), rhi = Math.min(rMax, 1.12 * g);
      if (rlo > rhi) continue;
      const base = rlo - BAND - 7, nr = Math.floor(rhi - base) + BAND + 8;
      for (const [c, d0] of [[e1, u], [e2, [-u[0], -u[1]]]]) {
        const R = rhi + BAND + 8, pix = [];
        for (let cy = Math.max(0, Math.floor((c[1] - R) / CELL)); cy <= Math.min(gh - 1, Math.floor((c[1] + R) / CELL)); cy++) {
          for (let cx = Math.max(0, Math.floor((c[0] - R) / CELL)); cx <= Math.min(gw - 1, Math.floor((c[0] + R) / CELL)); cx++) {
            const l = buckets.get(cx + cy * gw);
            if (l) for (let t = 0; t < l.length; t++) pix.push(l[t]);
          }
        }
        for (const side of [1, -1]) {
          const m = [n[0] * side, n[1] * side];
          const acc = [];
          for (let t = 0; t < nr; t++) acc.push(new Int32Array(QMAX + 1));
          for (let t = 0; t < pix.length; t += 2) {
            const vx = pix[t] - c[0], vy = pix[t + 1] - c[1];
            const a = vx * d0[0] + vy * d0[1], b = vx * m[0] + vy * m[1];
            if (b < 0 || (a >= 0 && a + b === 0)) continue;
            const ri = Math.floor(len(vx, vy) - base);
            if (ri < 0 || ri >= nr) continue;
            const qi = Math.floor((a >= 0 ? b / (a + b) : 1 - a / (b - a)) * NB);
            if (qi <= QMAX) acc[ri][qi]++;
          }
          const any = (lo, hi, q) => { for (let t = lo; t <= hi; t++) if (acc[t][q]) return true; return false; };
          let best = null;
          for (let ri = BAND + 7; ri < nr - BAND - 7; ri++) {
            const r = base + ri + 0.5;
            if (r < rlo || r > rhi) continue;
            let E = 0, miss = 0, hits = 0;
            for (let q = 1; q <= QMAX; q++) {
              if (any(ri - BAND, ri + BAND, q)) { E = q; miss = 0; hits++; }
              else if (++miss > 5) break;
            }
            if (E < 9 || hits < 0.75 * E) continue;
            const span = Math.max(1, E - 3);
            let rin = 0, rout = 0;
            for (let q = 2; q < E - 1; q++) {
              if (any(ri - BAND - 4, ri - BAND - 2, q)) rin++;
              if (any(ri + BAND + 2, ri + BAND + 4, q)) rout++;
            }
            const ringIn = rin / span, ringOut = rout / span;
            if (ringIn > 0.4 || ringOut > 0.4) continue;
            const score = hits * 4 - ringIn - ringOut;
            if (best === null || score > best[0][0]) best = [[score, r, E]];
            else if (score === best[0][0]) best.push([score, r, E]);
          }
          if (best === null) continue;
          const [score, r, E] = best[Math.floor((best.length - 1) / 2)]; // the middle of a run of equal radii
          let leaf = null;
          for (let t = 0; t < 13; t++) {
            const q = (E - 1 + t * 0.25) / NB;
            const qa = 1 - q, qb = q <= 1 ? q : 2 - q;
            const vx = qa * d0[0] + qb * m[0], vy = qa * d0[1] + qb * m[1], vl = len(vx, vy);
            const dx = vx / vl, dy = vy / vl, nsamp = Math.floor(0.8 * r) + 1;
            let got = 0;
            for (let s = 0; s < nsamp; s++) if (ink(c[0] + (0.12 * r + s) * dx, c[1] + (0.12 * r + s) * dy)) got++;
            const frac = got / nsamp;
            if (leaf === null || frac > leaf[0][0]) leaf = [[frac, dx, dy]];
            else if (frac === leaf[0][0]) leaf.push([frac, dx, dy]);
          }
          const [frac, ldx, ldy] = leaf[Math.floor((leaf.length - 1) / 2)]; // the middle of equally inked directions
          if (frac < 0.75) continue;
          cands.push({ order: cands.length, c, r, d0, open: [ldx, ldy], score });
        }
      }
    }
    cands.sort((x, y) => y.score - x.score || x.order - y.order);
    const kept = [];
    for (const cd of cands) {
      if (kept.some((k2) => len(cd.c[0] - k2.c[0], cd.c[1] - k2.c[1]) < 0.35 * cd.r && Math.abs(cd.r - k2.r) < 0.25 * cd.r)) continue;
      kept.push(cd);
    }
    kept.sort((x, y) => x.order - y.order);
    const curves = [], leaves = [], drop = new Set();
    for (const cd of kept) {
      const c = cd.c, r = cd.r, e0 = cd.d0, e1 = cd.open;
      const p0 = [c[0] + r * e0[0], c[1] + r * e0[1]], p1 = [c[0] + r * e1[0], c[1] + r * e1[1]];
      const cosw = Math.max(-1, Math.min(1, e0[0] * e1[0] + e0[1] * e1[1]));
      const sgn = e0[0] * e1[1] - e0[1] * e1[0] >= 0 ? 1 : -1;
      const kk = 4 / 3 * Math.sqrt((1 - cosw) / 2) / (1 + Math.sqrt((1 + cosw) / 2));
      const t0 = [-sgn * e0[1], sgn * e0[0]], t1 = [-sgn * e1[1], sgn * e1[0]];
      curves.push([p0[0], p0[1], p0[0] + kk * r * t0[0], p0[1] + kk * r * t0[1], p1[0] - kk * r * t1[0], p1[1] - kk * r * t1[1], p1[0], p1[1], 0]);
      leaves.push([c[0], c[1], p1[0], p1[1]]);
      const leaf = { a: c, u: e1, L: r };
      for (const [i, a, b] of S) if (ptSeg(a, leaf) <= 2.5 && ptSeg(b, leaf) <= 2.5) drop.add(i);
    }
    return { curves, leaves, drop: Array.from(drop).sort((a, b) => a - b) };
  }

  function findDoors(arcs, segs, grid, lines, lim) {
    const found = [], used = new Set();
    for (const arc of arcs) {
      const r = arc.r;
      if (r < lim.door_min || r > lim.door_max) continue;
      if (arc.cos > 0.9063 || arc.cos < -0.1737) continue;
      const c = arc.c, tol = Math.max(1.5, 0.1 * r);
      let leaf = null;
      for (const j of grid.query(c[0] - r - tol, c[1] - r - tol, c[0] + r + tol, c[1] + r + tol)) {
        const s = segs[j];
        if (Math.abs(s.L - r) > 0.12 * r + 1) continue;
        for (const [near, far] of [[s.a, s.b], [s.b, s.a]]) {
          if (len(near[0] - c[0], near[1] - c[1]) > tol) continue;
          for (const [k, tip] of [[0, arc.p0], [1, arc.p1]]) {
            if (len(far[0] - tip[0], far[1] - tip[1]) <= tol && leaf === null) leaf = [j, k];
          }
        }
        if (leaf !== null) break;
      }
      if (leaf === null) continue;
      found.push({ c, r, open: leaf[1] === 0 ? arc.p0 : arc.p1, closed: leaf[1] === 0 ? arc.p1 : arc.p0, leaf: leaf[0], leaves: 1, src: arc.src });
      used.add(leaf[0]);
      if (arc.src[0] === "s") for (const x of arc.src[1]) used.add(x);
    }
    const out = [], taken = new Set();
    found.forEach((d0, i) => {
      if (taken.has(i)) return;
      let d = d0;
      for (let j = i + 1; j < found.length; j++) {
        const e = found[j];
        if (taken.has(j)) continue;
        const tol = Math.max(1.5, 0.1 * d.r);
        if (len(d.closed[0] - e.closed[0], d.closed[1] - e.closed[1]) <= tol && Math.abs(d.r - e.r) <= 0.15 * d.r + 1) {
          d = Object.assign({}, d, { leaves: 2, pair: e });
          taken.add(j);
          break;
        }
      }
      out.push(d);
    });
    for (const d of out) {
      if (d.leaves === 2) {
        const e = d.pair;
        d.a = d.c; d.b = e.c;
        d.width = len(d.c[0] - e.c[0], d.c[1] - e.c[1]);
      } else {
        d.a = d.c; d.b = d.closed;
        d.width = len(d.c[0] - d.closed[0], d.c[1] - d.closed[1]);
      }
      d.mid = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
      let tag = null;
      for (const ln of lines) {
        if (!DOOR_TAG.test(ln.str)) continue;
        const cx = ln.x + ln.w / 2, cy = ln.y - ln.h / 2;
        const dd = len(cx - d.mid[0], cy - d.mid[1]);
        if (dd <= 2.5 * d.r && (tag === null || dd < tag[1])) tag = [ln.str, dd];
      }
      d.tag = tag ? tag[0] : "";
    }
    return [out, used];
  }

  // ---------------------------------------------------------------- walls
  function findPairs(segs, grid, lim, skip) {
    const { tmin, tmax } = lim, lmin = lim.wall_min_len;
    const cands = [];
    for (const s of segs) {
      if (skip.has(s.i) || s.L < lmin) continue;
      for (const j of grid.query(...segBox(s, tmax))) {
        if (j <= s.i || skip.has(j)) continue;
        const t = segs[j];
        if (t.L < lmin) continue;
        const rel = relation(s, t);
        if (rel === null) continue;
        const [off, a0, a1, spread] = rel;
        const d = Math.abs(off);
        if (d < tmin || d > tmax || spread > 0.25 + 0.1 * d) continue;
        const lo = Math.max(0, a0), hi = Math.min(s.L, a1);
        if (hi - lo < Math.max(lmin, 2.5 * d)) continue;
        cands.push([d, s.i, j, off, lo, hi]);
      }
    }
    cands.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
    const covered = new Map();
    const coverFrac = (key, lo, hi) => {
      let tot = 0;
      for (const [a, b] of covered.get(key) || []) tot += Math.max(0, Math.min(hi, b) - Math.max(lo, a));
      return tot / (hi - lo);
    };
    const addCover = (key, lo, hi) => { if (!covered.has(key)) covered.set(key, []); covered.get(key).push([lo, hi]); };
    const pieces = [];
    for (const [d, i, j, off, lo, hi] of cands) {
      const s = segs[i], t = segs[j];
      const side = off > 0 ? 1 : -1;
      const pLo = [s.a[0] + s.u[0] * lo, s.a[1] + s.u[1] * lo], pHi = [s.a[0] + s.u[0] * hi, s.a[1] + s.u[1] * hi];
      const tl0 = frame(t, pLo)[0], tl1 = frame(t, pHi)[0];
      const tlo = Math.min(tl0, tl1), thi = Math.max(tl0, tl1);
      if (coverFrac(i + "," + side, lo, hi) >= 0.5 || coverFrac(j + "," + (-side), tlo, thi) >= 0.5) continue;
      addCover(i + "," + side, lo, hi);
      addCover(j + "," + (-side), tlo, thi);
      const nx = -s.u[1], ny = s.u[0], hh = off / 2;
      pieces.push({ a: [pLo[0] + nx * hh, pLo[1] + ny * hh], b: [pHi[0] + nx * hh, pHi[1] + ny * hh], u: s.u, t: d, w: (s.w + t.w) / 2,
        fill: s.f === 1 && t.f === 1, segs: [i, j] });
    }
    return pieces;
  }

  function unionFind(n) {
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
    return { find, union };
  }
  const plen = (p) => len(p.b[0] - p.a[0], p.b[1] - p.a[1]);

  function mergePieces(pieces, openings, bridge) {
    const n = pieces.length;
    const uf = unionFind(n);
    const grid = new Grid(48);
    pieces.forEach((p, k) => grid.add(k, Math.min(p.a[0], p.b[0]) - 4, Math.min(p.a[1], p.b[1]) - 4, Math.max(p.a[0], p.b[0]) + 4, Math.max(p.a[1], p.b[1]) + 4));
    const reach = pieces.reduce((m, p) => Math.max(m, p.t), 0) * 1.6 + 2;
    const maxOpen = openings.reduce((m, o) => Math.max(m, o.L), 0) + 2;
    pieces.forEach((p, k) => {
      const pad = Math.max(reach, maxOpen);
      const L = plen(p);
      const sp = { a: p.a, b: p.b, u: p.u, L };
      for (const m of grid.query(Math.min(p.a[0], p.b[0]) - pad, Math.min(p.a[1], p.b[1]) - pad, Math.max(p.a[0], p.b[0]) + pad, Math.max(p.a[1], p.b[1]) + pad)) {
        if (m <= k) continue;
        const q = pieces[m];
        if (Math.abs(p.u[0] * q.u[1] - p.u[1] * q.u[0]) > PAR) continue;
        if (Math.abs(p.t - q.t) > 0.15 * Math.max(p.t, q.t)) continue;
        const [a0, o0] = frame(sp, q.a), [a1, o1] = frame(sp, q.b);
        if (Math.abs((o0 + o1) / 2) > Math.max(0.75, 0.15 * Math.min(p.t, q.t))) continue;
        const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
        const gap = Math.max(lo - L, -hi, 0);
        let ok = gap <= 1.6 * Math.max(p.t, q.t) + 1 || gap <= bridge;
        if (!ok) {
          const [g0, g1] = lo >= L ? [L, lo] : [hi, 0];
          for (const o of openings) {
            const [oa, oo] = frame(sp, o.c);
            if (g0 - 2 <= oa && oa <= g1 + 2 && Math.abs(oo) <= p.t / 2 + 2 && Math.abs(o.L - gap) <= 0.25 * gap + 2) { ok = true; break; }
          }
        }
        if (ok) uf.union(k, m);
      }
    });
    const groups = new Map();
    for (let k = 0; k < n; k++) { const r = uf.find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); }
    const walls = [];
    for (const root of Array.from(groups.keys()).sort((a, b) => a - b)) {
      const mem = groups.get(root);
      let longest = mem[0];
      for (const k of mem) if (plen(pieces[k]) > plen(pieces[longest]) || (plen(pieces[k]) === plen(pieces[longest]) && k < longest)) longest = k;
      const base = pieces[longest];
      const fr = { a: base.a, u: base.u };
      let lo = null, hi = null, wsum = 0, osum = 0, tsum = 0, lwsum = 0, fill = true;
      const used = [];
      for (const k of mem) {
        const p = pieces[k], pl = plen(p);
        const [a0, o0] = frame(fr, p.a), [a1, o1] = frame(fr, p.b);
        lo = lo === null ? Math.min(a0, a1) : Math.min(lo, a0, a1);
        hi = hi === null ? Math.max(a0, a1) : Math.max(hi, a0, a1);
        wsum += pl; osum += pl * (o0 + o1) / 2; tsum += pl * p.t; lwsum += pl * p.w;
        fill = fill && p.fill;
        used.push(...p.segs);
      }
      const off = osum / wsum;
      const [ux, uy] = base.u, nx = -uy, ny = ux, [ax, ay] = base.a;
      walls.push({ a: [ax + ux * lo + nx * off, ay + uy * lo + ny * off], b: [ax + ux * hi + nx * off, ay + uy * hi + ny * off], u: base.u,
        t: tsum / wsum, w: lwsum / wsum, fill, pieces: mem.length, segs: Array.from(new Set(used)).sort((a, b) => a - b), drawn: wsum });
    }
    return walls;
  }

  function extendWalls(walls) {
    const n = walls.length;
    const ext = walls.map(() => [0, 0]);
    for (let i = 0; i < n; i++) {
      const w = walls[i], Lw = plen(w);
      for (let j = i + 1; j < n; j++) {
        const v = walls[j];
        const den = w.u[0] * v.u[1] - w.u[1] * v.u[0];
        if (Math.abs(den) <= PAR) continue;
        const dx = v.a[0] - w.a[0], dy = v.a[1] - w.a[1];
        const s = (dx * v.u[1] - dy * v.u[0]) / den, t = (dx * w.u[1] - dy * w.u[0]) / den;
        const Lv = plen(v);
        const e = 0.5 * (w.t + v.t) + 1;
        if (s < -e || s > Lw + e || t < -e || t > Lv + e) continue;
        if (s < 0) ext[i][0] = Math.max(ext[i][0], -s);
        else if (s > Lw) ext[i][1] = Math.max(ext[i][1], s - Lw);
        if (t < 0) ext[j][0] = Math.max(ext[j][0], -t);
        else if (t > Lv) ext[j][1] = Math.max(ext[j][1], t - Lv);
      }
    }
    walls.forEach((w, k) => {
      const [ux, uy] = w.u;
      w.a = [w.a[0] - ux * ext[k][0], w.a[1] - uy * ext[k][0]];
      w.b = [w.b[0] + ux * ext[k][1], w.b[1] + uy * ext[k][1]];
    });
  }

  function markHatch(walls, segs, grid, skip) {
    for (const w of walls) {
      const L = plen(w), fr = { a: w.a, u: w.u }, pad = w.t;
      let n = 0;
      for (const j of grid.query(Math.min(w.a[0], w.b[0]) - pad, Math.min(w.a[1], w.b[1]) - pad, Math.max(w.a[0], w.b[0]) + pad, Math.max(w.a[1], w.b[1]) + pad)) {
        if (skip.has(j)) continue;
        const s = segs[j];
        if (Math.abs(w.u[0] * s.u[0] + w.u[1] * s.u[1]) > 0.94 || s.L > 2 * w.t) continue;
        const [a, o] = frame(fr, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]);
        if (a >= 0 && a <= L && Math.abs(o) < 0.42 * w.t) n++;
      }
      w.hatch_n = n;
      w.hatch = n >= Math.max(3, L / (3 * w.t));
    }
  }

  // ---------------------------------------------------------------- rooms
  function pseudoAngle(dx, dy) { const p = dx / (Math.abs(dx) + Math.abs(dy)); return dy < 0 ? p - 1 : 1 - p; }
  function polyArea(pts) {
    let s = 0;
    const n = pts.length, ox = pts[0][0], oy = pts[0][1];
    for (let i = 0; i < n; i++) {
      const x0 = pts[i][0] - ox, y0 = pts[i][1] - oy, x1 = pts[(i + 1) % n][0] - ox, y1 = pts[(i + 1) % n][1] - oy;
      s += x0 * y1 - x1 * y0;
    }
    return s / 2;
  }
  function inside(pt, poly) {
    const [x, y] = pt;
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function faces(walls) {
    const n = walls.length;
    const cuts = walls.map((w) => [0, plen(w)]);
    for (let i = 0; i < n; i++) {
      const w = walls[i], Lw = cuts[i][1];
      for (let j = i + 1; j < n; j++) {
        const v = walls[j];
        const den = w.u[0] * v.u[1] - w.u[1] * v.u[0];
        if (Math.abs(den) <= PAR) continue;
        const dx = v.a[0] - w.a[0], dy = v.a[1] - w.a[1];
        const s = (dx * v.u[1] - dy * v.u[0]) / den, t = (dx * w.u[1] - dy * w.u[0]) / den;
        const Lv = cuts[j][1];
        if (s >= -0.5 && s <= Lw + 0.5 && t >= -0.5 && t <= Lv + 0.5) {
          cuts[i].push(Math.min(Lw, Math.max(0, s)));
          cuts[j].push(Math.min(Lv, Math.max(0, t)));
        }
      }
    }
    const verts = [], vindex = new Map();
    const vid = (p) => {
      const kx = rnd(p[0] * 2), ky = rnd(p[1] * 2);
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        const k = (kx + dx) + "," + (ky + dy);
        if (vindex.has(k)) {
          const q = verts[vindex.get(k)];
          if (len(q[0] - p[0], q[1] - p[1]) <= 0.75) return vindex.get(k);
        }
      }
      const k = kx + "," + ky;
      vindex.set(k, verts.length);
      verts.push(p);
      return vindex.get(k);
    };
    const edges = new Map();
    walls.forEach((w, i) => {
      const cs = Array.from(new Set(cuts[i].map(r6))).sort((a, b) => a - b);
      const ids = cs.map((c) => vid([w.a[0] + w.u[0] * c, w.a[1] + w.u[1] * c]));
      for (let k = 0; k < ids.length - 1; k++) {
        const a = ids[k], b = ids[k + 1];
        if (a !== b) {
          const key = Math.min(a, b) + "," + Math.max(a, b);
          if (!edges.has(key)) edges.set(key, [Math.min(a, b), Math.max(a, b), i]);
        }
      }
    });
    const adj = new Map();
    for (const [a, b] of edges.values()) {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b); adj.get(b).add(a);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const v of Array.from(adj.keys()).sort((a, b) => a - b)) {
        const s = adj.get(v);
        if (s.size === 1) {
          const o = s.values().next().value;
          adj.get(o).delete(v);
          adj.delete(v);
          changed = true;
        } else if (s.size === 0) { adj.delete(v); changed = true; }
      }
    }
    const order = new Map();
    for (const v of adj.keys()) {
      const p = verts[v];
      order.set(v, Array.from(adj.get(v)).map((o) => [pseudoAngle(verts[o][0] - p[0], verts[o][1] - p[1]), o]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[1]));
    }
    const seen = new Set(), out = [];
    for (const v of Array.from(adj.keys()).sort((a, b) => a - b)) {
      for (const o of order.get(v)) {
        if (seen.has(v + "," + o)) continue;
        const cyc = [];
        let a = v, b = o, ok = true;
        while (!seen.has(a + "," + b)) {
          seen.add(a + "," + b);
          cyc.push([a, b]);
          const nb = order.get(b);
          const k = nb.indexOf(a);
          const c = nb[(k - 1 + nb.length) % nb.length];
          a = b; b = c;
          if (cyc.length > 5000) { ok = false; break; }
        }
        if (ok && a === cyc[0][0] && b === cyc[0][1]) out.push(cyc.map((e) => [e[0], edges.get(Math.min(e[0], e[1]) + "," + Math.max(e[0], e[1]))[2]]));
      }
    }
    return [verts, out];
  }
  function dropCollinear(pts, wl) {
    const op = [], ow = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const la = len(b[0] - a[0], b[1] - a[1]), lb = len(c[0] - b[0], c[1] - b[1]);
      if (la > 1e-9 && lb > 1e-9 && Math.abs(cr) <= 1e-6 * la * lb && (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0) continue;
      op.push(b); ow.push(wl[i]);
    }
    return [op, ow];
  }
  function inset(pts, offs) {
    const n = pts.length, area = polyArea(pts), sgn = area > 0 ? 1 : -1;
    const lines = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const L = len(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const nx = -uy * sgn, ny = ux * sgn, d = offs[i];
      lines.push([[a[0] + nx * d, a[1] + ny * d], [ux, uy]]);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const [p, u] = lines[(i - 1 + n) % n], [q, v] = lines[i];
      const den = u[0] * v[1] - u[1] * v[0];
      if (Math.abs(den) < 1e-9) { out.push(q); continue; }
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const s = (dx * v[1] - dy * v[0]) / den;
      out.push([p[0] + u[0] * s, p[1] + u[1] * s]);
    }
    const a2 = polyArea(out);
    if (a2 * area <= 0 || Math.abs(a2) >= Math.abs(area)) return null;
    for (let i = 0; i < n; i++) {
      const a = out[i], b = out[(i + 1) % n], e0 = pts[i], e1 = pts[(i + 1) % n];
      if ((b[0] - a[0]) * (e1[0] - e0[0]) + (b[1] - a[1]) * (e1[1] - e0[1]) <= 0) return null;
    }
    return out;
  }
  function findRooms(walls, lines, lim, ipp) {
    for (const w of walls) w.outer = false;
    const [verts, fs] = faces(walls);
    const polys = [];
    for (const f of fs) {
      const pts = f.map(([v]) => verts[v]), wl = f.map(([, w]) => w);
      if (pts.length < 3) continue;
      polys.push([polyArea(pts), pts, wl]);
    }
    if (!polys.length) return [];
    let big = polys[0];
    for (const p of polys) if (Math.abs(p[0]) > Math.abs(big[0])) big = p;
    const outerSign = big[0] > 0 ? 1 : -1;
    const k2 = ipp ? ipp * ipp : DEFAULT_IPP * DEFAULT_IPP;
    const rooms = [];
    for (const [a, pts0, wl0] of polys) {
      if ((a > 0) === (outerSign > 0)) { for (const x of wl0) walls[x].outer = true; continue; }
      const [pts, wl] = dropCollinear(pts0, wl0);
      if (pts.length < 3) continue;
      const area = Math.abs(polyArea(pts));
      let per = 0;
      for (let i = 0; i < pts.length; i++) per += len(pts[(i + 1) % pts.length][0] - pts[i][0], pts[(i + 1) % pts.length][1] - pts[i][1]);
      if (area * k2 / 144 < lim.room_min_sf || 2 * area / per * (ipp || DEFAULT_IPP) < lim.room_min_width_in) continue;
      const clear = inset(pts, wl.map((w) => walls[w].t / 2));
      const poly = clear || pts;
      const names = lines.filter((ln) => inside([ln.x + ln.w / 2, ln.y - ln.h / 2], poly));
      let name = "", number = "", best = null;
      const words = [];
      for (const ln of names) {
        const s = ln.str;
        if (DIM_TEXT.test(s) || AREA_TEXT.test(s) || DOOR_TAG.test(s)) continue;
        if (ROOM_NO.test(s)) { if (!number) number = s; continue; }
        if (!/[A-Za-z]{2}/.test(s)) continue;
        words.push(ln);
        if (best === null || ln.h > best.h || (ln.h === best.h && ln.y < best.y)) best = ln;
      }
      if (best) {
        const group = [best];
        let grew = true;
        while (grew && group.length < 3) {
          grew = false;
          let top = group[0], bot = group[0];
          for (const q of group) { if (q.y < top.y) top = q; if (q.y > bot.y) bot = q; }
          for (const ln of words) {
            if (group.includes(ln) || Math.abs(ln.h - best.h) > 0.1 * best.h) continue;
            if (Math.abs(ln.x + ln.w / 2 - (best.x + best.w / 2)) > Math.max(ln.w, best.w) / 2) continue;
            if ((ln.y - bot.y > 0 && ln.y - bot.y <= 1.6 * best.h) || (top.y - ln.y > 0 && top.y - ln.y <= 1.6 * best.h)) { group.push(ln); grew = true; break; }
          }
        }
        group.sort((a, b) => a.y - b.y);
        name = group.map((q) => q.str).join(" ");
      }
      rooms.push({ pts, clear, walls: wl, area, clear_area: clear ? Math.abs(polyArea(clear)) : null, name, number, texts: names.length });
    }
    return rooms;
  }

  // ---------------------------------------------------------------- symbols
  function ptSeg(p, s) {
    const dx = p[0] - s.a[0], dy = p[1] - s.a[1];
    const t = Math.max(0, Math.min(s.L, dx * s.u[0] + dy * s.u[1]));
    return len(p[0] - s.a[0] - s.u[0] * t, p[1] - s.a[1] - s.u[1] * t);
  }
  function findDimensions(segs, grid, used, smax) {
    const dims = new Set();
    for (const d of segs) {
      if (used.has(d.i) || d.L <= smax) continue;
      const attached = [];
      let ends = 0;
      for (const e of [d.a, d.b]) {
        let tick = false;
        const near = [];
        for (const j of grid.query(e[0] - 1, e[1] - 1, e[0] + 1, e[1] + 1)) {
          if (j === d.i || used.has(j)) continue;
          const s = segs[j];
          if (s.L > smax * 1.5 || ptSeg(e, s) > 0.75) continue;
          const c = Math.abs(d.u[0] * s.u[0] + d.u[1] * s.u[1]);
          if (c <= PERP) near.push(j);
          else if (c >= 0.5 && c <= 0.87) { tick = true; near.push(j); }
        }
        if (tick) { ends++; attached.push(...near); }
      }
      if (ends === 2) { dims.add(d.i); for (const x of attached) dims.add(x); }
    }
    return dims;
  }
  function findSymbols(segs, curves, usedS, usedC, lines, lim, rooms) {
    const smin = lim.symbol_min, smax = lim.symbol_max;
    const items = [];
    for (const s of segs) if (!usedS.has(s.i) && s.L <= smax * 1.5) items.push(["s", s.i, [s.a, s.b]]);
    for (const c of curves) {
      if (usedC.has(c.i)) continue;
      const xs = c.p.map((q) => q[0]), ys = c.p.map((q) => q[1]);
      if (Math.max(...xs) - Math.min(...xs) > smax * 1.5 || Math.max(...ys) - Math.min(...ys) > smax * 1.5) continue;
      items.push(["c", c.i, [c.p[0], bez(c.p, 0.5), c.p[3]]]);
    }
    const n = items.length;
    const boxes = items.map((it) => {
      const xs = it[2].map((q) => q[0]), ys = it[2].map((q) => q[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    });
    const grid = new Grid(Math.max(8, smax / 2));
    boxes.forEach((b, k) => grid.add(k, b[0] - 0.75, b[1] - 0.75, b[2] + 0.75, b[3] + 0.75));
    const uf = unionFind(n);
    boxes.forEach((b, k) => {
      for (const m of grid.query(b[0] - 0.75, b[1] - 0.75, b[2] + 0.75, b[3] + 0.75)) {
        if (m <= k) continue;
        const c = boxes[m];
        if (c[0] <= b[2] + 0.75 && b[0] <= c[2] + 0.75 && c[1] <= b[3] + 0.75 && b[1] <= c[3] + 0.75) uf.union(k, m);
      }
    });
    const groupBy = () => {
      const m = new Map();
      for (let k = 0; k < n; k++) { const r = uf.find(k); if (!m.has(r)) m.set(r, []); m.get(r).push(k); }
      return m;
    };
    let comps = groupBy();
    const cbox = new Map();
    for (const [root, mem] of comps) {
      cbox.set(root, [Math.min(...mem.map((k) => boxes[k][0])), Math.min(...mem.map((k) => boxes[k][1])), Math.max(...mem.map((k) => boxes[k][2])), Math.max(...mem.map((k) => boxes[k][3]))]);
    }
    const roots = Array.from(cbox.keys()).sort((a, b) => a - b);
    const cgrid = new Grid(Math.max(8, smax / 2));
    for (const root of roots) { const b = cbox.get(root); if (Math.max(b[2] - b[0], b[3] - b[1]) <= smax) cgrid.add(root, ...b); }
    for (const root of roots) {
      const b = cbox.get(root);
      let best = null;
      for (const other of cgrid.query(...b)) {
        if (other === root) continue;
        const c = cbox.get(other);
        if (c[0] - 0.5 <= b[0] && c[1] - 0.5 <= b[1] && b[2] <= c[2] + 0.5 && b[3] <= c[3] + 0.5 && (c[2] - c[0]) * (c[3] - c[1]) > (b[2] - b[0]) * (b[3] - b[1])) {
          const area = (c[2] - c[0]) * (c[3] - c[1]);
          if (best === null || area < best[0] || (area === best[0] && other < best[1])) best = [area, other];
        }
      }
      if (best) uf.union(root, best[1]);
    }
    comps = groupBy();
    const sigs = new Map();
    for (const root of Array.from(comps.keys()).sort((a, b) => a - b)) {
      const mem = comps.get(root);
      const x0 = Math.min(...mem.map((k) => boxes[k][0])), y0 = Math.min(...mem.map((k) => boxes[k][1]));
      const x1 = Math.max(...mem.map((k) => boxes[k][2])), y1 = Math.max(...mem.map((k) => boxes[k][3]));
      const size = Math.max(x1 - x0, y1 - y0);
      if (size < smin || size > smax) continue;
      if (mem.length < 2 && items[mem[0]][0] === "s") continue;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      let best = null;
      for (let rot = 0; rot < 8; rot++) {
        const toks = [];
        for (const k of mem) {
          const [kind, , pts] = items[k];
          let q = [];
          for (const p of pts) {
            let x = p[0] - cx, y = p[1] - cy;
            for (let r = 0; r < rot % 4; r++) [x, y] = [-y, x];
            if (rot >= 4) x = -x;
            const mx = rnd(x * 1000), my = rnd(y * 1000);
            q.push([Math.floor((mx + 250) / 500), Math.floor((my + 250) / 500)]);
          }
          if (kind === "s") q.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
          else if (q[2][0] < q[0][0] || (q[2][0] === q[0][0] && q[2][1] < q[0][1])) q = [q[2], q[1], q[0]];
          toks.push(kind + ":" + q.map((v) => v[0] + " " + v[1]).join(","));
        }
        toks.sort();
        const sig = toks.join("|");
        if (best === null || sig < best) best = sig;
      }
      if (!sigs.has(best)) sigs.set(best, []);
      sigs.get(best).push({ box: [x0, y0, x1, y1], c: [cx, cy], size, items: mem.map((k) => [items[k][0], items[k][1]]) });
    }
    const groups = [];
    for (const [sig, inst] of sigs) {
      if (inst.length < lim.symbol_min_count) continue;
      let legend = null;
      inst.forEach((ins, k) => {
        if (rooms.some((poly) => inside(ins.c, poly))) return;
        const [x0, y0, x1, y1] = ins.box;
        for (const ln of lines) {
          if (ln.str.length < 4 || !/[A-Za-z]{3}/.test(ln.str) || LEGEND_WORDS.test(ln.str)) continue;
          const d = len(Math.max(x0 - ln.x, 0, ln.x - x1), Math.max(y0 - ln.y, 0, ln.y - y1));
          if (d > 0 && d <= 2 * ins.size && (legend === null || d < legend[2])) legend = [k, ln.str, d];
        }
      });
      groups.push({ sig, inst, legend });
    }
    return groups;
  }

  // ---------------------------------------------------------------- wall types
  function classifyWall(f, rules) {
    for (const r of rules || []) {
      const t = f.thickness_in;
      const g0 = (k, d) => (r[k] === undefined ? d : r[k]);
      if (t !== null && t !== undefined && !(g0("min_in", 0) <= t && t < g0("max_in", 1e9))) continue;
      const wt = f.weight_pt === undefined ? 0 : f.weight_pt;
      if (!(g0("min_weight", 0) <= wt && wt <= g0("max_weight", 1e9))) continue;
      const h = g0("hatch", "any");
      if ((h === "yes" && !f.hatch) || (h === "no" && f.hatch)) continue;
      const fl = g0("fill", "any");
      if ((fl === "yes" && !f.fill) || (fl === "no" && f.fill)) continue;
      const ou = g0("outer", "any");
      if ((ou === "yes" && !f.outer) || (ou === "no" && f.outer)) continue;
      return r;
    }
    return null;
  }
  const RULE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
  function cleanRules(rules) {
    if (!Array.isArray(rules)) return RULES.map((r) => Object.assign({}, r));
    const out = [];
    for (const r of rules.slice(0, 100)) {
      if (!r || typeof r !== "object" || Array.isArray(r)) continue;
      const rid = r.id;
      if (typeof rid !== "string" || !RULE_ID.test(rid) || out.some((x) => x.id === rid)) continue;
      let name = typeof r.name === "string" ? r.name : "";
      name = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || rid;
      const preset = typeof r.preset === "string" && RULE_ID.test(r.preset) ? r.preset : "";
      const c = { id: rid, name, preset };
      for (const [k, d] of [["min_in", 0], ["max_in", 1e9], ["min_weight", 0], ["max_weight", 1e9]]) {
        const v = r[k];
        c[k] = num(v) && v >= 0 && v <= 1e9 ? v : d;
      }
      c.hatch = HATCH.includes(r.hatch) ? r.hatch : "any";
      c.fill = HATCH.includes(r.fill) ? r.fill : "any";
      c.outer = HATCH.includes(r.outer) ? r.outer : "any";
      out.push(c);
    }
    return out;
  }

  // ---------------------------------------------------------------- main
  const fmtIn = (x) => g(rnd(x * 8) / 8) + " in";
  function fmtFt(inches) {
    let ft = Math.floor(inches / 12 + 1e-9);
    let rem = rnd((inches - ft * 12) * 4) / 4;
    if (rem >= 12) { ft += 1; rem = 0; }
    return g(ft) + "'-" + g(rem) + '"';
  }
  function centroid(pts) {
    const a = polyArea(pts);
    if (Math.abs(a) < 1e-12) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const ox = pts[0][0], oy = pts[0][1], n = pts.length;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      const x0 = pts[i][0] - ox, y0 = pts[i][1] - oy, x1 = pts[(i + 1) % n][0] - ox, y1 = pts[(i + 1) % n][1] - oy;
      const cr = x0 * y1 - x1 * y0;
      cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
    }
    return [ox + cx / (6 * a), oy + cy / (6 * a)];
  }

  function autoTakeoff(page, opts) {
    const P = cleanPage(page);
    const { w, h, ipp } = P;
    let { segs, curves, text } = P;
    const o0 = opts && typeof opts === "object" && !Array.isArray(opts) ? opts : null;
    const reg = o0 ? o0.region : null;
    let area;
    if (Array.isArray(reg) && reg.length === 4 && reg.every(num) && reg[2] > reg[0] && reg[3] > reg[1]) area = reg.slice();
    else area = drawingArea(segs.map((s) => [s.a[0], s.a[1], s.b[0], s.b[1]]), w, h);
    const ax0 = area[0] + 0.5, ay0 = area[1] + 0.5, ax1 = area[2] - 0.5, ay1 = area[3] - 0.5;
    const ins = (p) => ax0 < p[0] && p[0] < ax1 && ay0 < p[1] && p[1] < ay1;
    segs = segs.filter((s) => ins(s.a) && ins(s.b));
    segs.forEach((s, k) => { s.i = k; });
    curves = curves.filter((c) => c.p.every(ins));
    curves.forEach((c, k) => { c.i = k; });
    text = text.filter((t) => ins([t.x, t.y]));
    const o = Object.assign({}, DEFAULTS);
    if (o0) for (const k of Object.keys(DEFAULTS)) if (num(o0[k]) && o0[k] > 0) o[k] = k !== "symbol_min_count" ? o0[k] : Math.trunc(o0[k]);
    const rules = o0 && Object.prototype.hasOwnProperty.call(o0, "rules") ? cleanRules(o0.rules) : RULES.map((r) => Object.assign({}, r));
    const k = ipp || DEFAULT_IPP;
    const lim = { tmin: o.wall_min_in / k, tmax: o.wall_max_in / k, wall_min_len: o.wall_min_len_in / k, door_min: o.door_min_in / k, door_max: o.door_max_in / k,
      window_min: o.window_min_in / k, window_max: o.window_max_in / k, room_min_sf: o.room_min_sf, room_min_width_in: o.room_min_width_in,
      symbol_min: o.symbol_min_pt, symbol_max: o.symbol_max_pt, symbol_min_count: o.symbol_min_count, bridge: o.bridge_in / k };
    const notes = [];
    if (!(area[0] === 0 && area[1] === 0 && area[2] === w && area[3] === h)) notes.push("Only the drawing area is read: the sheet border and title block strip are left out.");
    if (ipp === null) notes.push("No scale is set on this sheet, so the size limits assume 1/4\" = 1'-0\" and quantities are in sheet points. Set the scale for real lengths and areas.");
    const grid = new Grid(Math.max(16, lim.tmax));
    for (const s of segs) grid.add(s.i, ...segBox(s, 0));
    const lines = textLines(text);

    const [windows, glass] = findWindows(segs, grid, lim);
    const arcs = findArcs(curves, segs, lim);
    const [doors, doorSegs] = findDoors(arcs, segs, grid, lines, lim);
    const skip = new Set([...glass, ...doorSegs]);
    const pieces = findPairs(segs, grid, lim, skip);
    const openings = doors.map((d) => ({ c: d.mid, L: d.width })).concat(windows.map((x) => ({ c: x.c, L: x.L })));
    let walls = mergePieces(pieces, openings, lim.bridge);
    walls.sort((x, y) => (x.a[1] + x.b[1]) / 2 - (y.a[1] + y.b[1]) / 2 || (x.a[0] + x.b[0]) / 2 - (y.a[0] + y.b[0]) / 2);
    walls = walls.slice(0, LIM.walls);
    extendWalls(walls);
    const wallSegs = new Set();
    for (const wl of walls) for (const x of wl.segs) wallSegs.add(x);
    markHatch(walls, segs, grid, new Set([...wallSegs, ...skip]));
    const rooms = findRooms(walls, lines, lim, ipp);

    const hatchSegs = new Set();
    for (const wl of walls) {
      const L = plen(wl), fr = { a: wl.a, u: wl.u };
      for (const j of grid.query(...segBox(wl, wl.t))) {
        const s = segs[j];
        const [a, off] = frame(fr, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]);
        if (a >= -wl.t / 2 && a <= L + wl.t / 2 && Math.abs(off) <= 0.5 * wl.t + 0.5) hatchSegs.add(j);
      }
    }
    let usedS = new Set([...wallSegs, ...skip, ...hatchSegs]);
    for (const wd of windows) { usedS.add(wd.glass); for (const x of wd.jambSegs) usedS.add(x); for (const x of wd.faces) usedS.add(x); }
    const usedC = new Set();
    for (const d of doors) {
      for (const src of [d.src].concat(d.pair ? [d.pair.src] : [])) {
        if (src[0] === "c") usedC.add(src[1]);
        else for (const x of src[1]) usedS.add(x);
      }
      usedS.add(d.leaf);
      if (d.pair) usedS.add(d.pair.leaf);
    }
    for (const a of arcs) {
      if (a.src[0] !== "c") continue;
      for (const d of doors) if (len(a.c[0] - d.c[0], a.c[1] - d.c[1]) < 1 && Math.abs(a.r - d.r) < 1) usedC.add(a.src[1]);
    }
    usedS = new Set([...usedS, ...findDimensions(segs, grid, usedS, lim.symbol_max)]);
    const groups = findSymbols(segs, curves, usedS, usedC, lines, lim, rooms.map((r) => r.clear || r.pts));

    const real = (v) => (ipp ? r6(v * ipp) : null);
    const p6 = (p) => [r6(p[0]), r6(p[1])];
    const outWalls = walls.map((wl, n) => {
      const L = plen(wl);
      const feats = { thickness_in: real(wl.t), weight_pt: r6(wl.w), hatch: wl.hatch, fill: wl.fill, outer: !!wl.outer };
      const rule = classifyWall(feats, rules);
      const drawn = L > 0 ? Math.min(1, wl.drawn / L) : 0;
      const conf = 0.55 + 0.25 * drawn + (wl.pieces === 1 ? 0.1 : 0) + (rule ? 0.1 : 0);
      const tdesc = ipp ? fmtIn(wl.t * ipp) : g(rnd(wl.t * 10) / 10) + " pt";
      const why = "Two parallel lines " + tdesc + " apart run together for " + (ipp ? fmtFt(wl.drawn * ipp) : g(rnd(wl.drawn)) + " pt") +
        (wl.pieces > 1 ? " in " + wl.pieces + " pieces" : "") + "; line weight " + g(rnd(wl.w * 100) / 100) + " pt" +
        (wl.hatch ? ", hatched" : "") + (wl.fill ? ", filled" : "") + (wl.outer ? ", on the outline" : "") + ". " +
        (rule ? 'Rule "' + rule.name + '" matches.' : "No wall type rule matches.");
      return { id: "w" + (n + 1), kind: "wall", a: p6(wl.a), b: p6(wl.b), length_pt: r6(L), length_in: real(L), thickness_pt: r6(wl.t),
        thickness_in: feats.thickness_in, weight_pt: feats.weight_pt, hatch: wl.hatch, fill: wl.fill, outer: feats.outer, type: rule ? rule.id : "",
        type_name: rule ? rule.name : "Unclassified wall", preset: rule ? rule.preset : "", conf: r6(Math.min(0.97, conf)), why };
    });
    const outRooms = rooms.map((r, n) => {
      const ra = r.clear_area !== null ? r.clear_area : r.area;
      const poly = r.clear || r.pts;
      const label = (r.name + (r.number ? " " + r.number : "")).trim();
      const conf = 0.6 + (r.clear ? 0.2 : 0) + (r.name ? 0.15 : 0);
      const why = "A closed space bounded by " + r.pts.length + " wall centerlines" +
        (r.clear ? "; the clear area insets each edge by half its wall" : "; the clear area could not be found, so this is on the centerlines") +
        (label ? '; named from the text "' + label + '" inside it.' : "; no room name inside it.");
      return { id: "r" + (n + 1), kind: "room", pts: poly.map(p6), center: p6(centroid(poly)), area_pt: r6(ra), area_sq_in: ipp ? r6(ra * ipp * ipp) : null,
        centerline_area_sq_in: ipp ? r6(r.area * ipp * ipp) : null, name: r.name, number: r.number, label: label || "Room " + (n + 1),
        conf: r6(Math.min(0.97, conf)), why };
    });
    const outDoors = doors.map((d, n) => {
      let onWall = false;
      for (const wl of walls) {
        const [a, off] = frame({ a: wl.a, u: wl.u }, d.mid);
        const L = plen(wl);
        if (a >= -2 && a <= L + 2 && Math.abs(off) <= wl.t / 2 + 2) { onWall = true; break; }
      }
      const conf = 0.7 + (onWall ? 0.15 : 0) + (d.tag ? 0.1 : 0);
      const wdesc = ipp ? fmtFt(d.width * ipp) : g(rnd(d.width)) + " pt";
      const why = (d.leaves === 2 ? "Two arcs" : "An arc") + " of about 90 degrees with a leaf line from the hinge; opening " + wdesc +
        (onWall ? "; in a wall" : "; not in a wall found here") + (d.tag ? "; tag " + d.tag + " beside it." : "; no door tag found beside it.");
      return { id: "d" + (n + 1), kind: "door", at: p6(d.mid), hinge: p6(d.c), a: p6(d.a), b: p6(d.b), width_pt: r6(d.width), width_in: real(d.width),
        leaves: d.leaves, tag: d.tag, in_wall: onWall, conf: r6(Math.min(0.97, conf)), why };
    });
    const outWindows = windows.map((wd, n) => {
      const conf = 0.65 + 0.15 * wd.jambs;
      const wdesc = ipp ? fmtFt(wd.L * ipp) : g(rnd(wd.L)) + " pt";
      const why = "A line between two wall faces " + (ipp ? fmtIn(wd.t * ipp) : g(rnd(wd.t * 10) / 10) + " pt") + " apart, closed by " +
        (wd.jambs === 2 ? "jamb lines at both ends" : "a jamb line at one end") + "; width " + wdesc + ".";
      return { id: "n" + (n + 1), kind: "window", at: p6(wd.c), a: p6(wd.a), b: p6(wd.b), width_pt: r6(wd.L), width_in: real(wd.L), conf: r6(Math.min(0.97, conf)), why };
    });
    const outSymbols = groups.map((gr, n) => {
      const inst = gr.inst, legend = gr.legend;
      const counted = inst.filter((_, k) => !(legend && k === legend[0]));
      const kinds = { s: 0, c: 0 };
      for (const [kind] of inst[0].items) kinds[kind]++;
      const shape = (kinds.c ? kinds.c + " curve" + (kinds.c !== 1 ? "s" : "") + " and " : "") + kinds.s + " line" + (kinds.s !== 1 ? "s" : "");
      const name = legend ? legend[1] : "Symbol " + (n + 1);
      const why = counted.length + " copies of the same shape (" + shape + ", " + g(rnd(inst[0].size * 10) / 10) + " pt across), matched in any quarter turn or mirror" +
        (legend ? '; the copy beside the label "' + legend[1] + '" is a legend entry and is not counted.' : ".");
      const conf = 0.6 + Math.min(0.3, 0.03 * counted.length) + (legend ? 0.05 : 0);
      return { id: "s" + (n + 1), kind: "symbol", name, count: counted.length, at: counted.map((x) => p6(x.c)), size_pt: r6(inst[0].size),
        legend: legend ? p6(inst[legend[0]].c) : null, conf: r6(Math.min(0.97, conf)), why };
    });
    const types = new Map();
    for (const wl of outWalls) {
      const th = rnd((wl.thickness_in !== null ? wl.thickness_in : wl.thickness_pt) * 4) / 4, wt = rnd(wl.weight_pt * 10) / 10;
      const tk = JSON.stringify([wl.type, th, wt, wl.hatch, wl.fill]);
      if (!types.has(tk)) types.set(tk, { rule: wl.type, name: wl.type_name, preset: wl.preset, thickness: th, thickness_unit: ipp ? "in" : "pt", weight_pt: wt,
        hatch: wl.hatch, fill: wl.fill, walls: [], length_pt: 0 });
      const t = types.get(tk);
      t.walls.push(wl.id);
      t.length_pt = r6(t.length_pt + wl.length_pt);
    }
    const outTypes = Array.from(types.values()).map((t, n) => Object.assign(t, { id: "t" + (n + 1), length_in: ipp ? r6(t.length_pt * ipp) : null }));
    return { walls: outWalls, rooms: outRooms, doors: outDoors, windows: outWindows, symbols: outSymbols, types: outTypes, notes, scale: ipp,
      area: area.map(r6), stats: { segments: segs.length, curves: curves.length, text_lines: lines.length, arcs: arcs.length, pieces: pieces.length } };
  }

  function proposals(result, accepted, pageIndex) {
    const ids = new Set(accepted || []);
    const out = [];
    for (const wl of result.walls || []) if (ids.has(wl.id)) out.push({ tool: "length", page: pageIndex, points: [wl.a, wl.b], label: wl.type_name, preset: wl.preset, subject: wl.type_name, source: wl.id });
    for (const r of result.rooms || []) if (ids.has(r.id)) out.push({ tool: "area", page: pageIndex, points: r.pts, label: r.label, preset: "p-floor", subject: "Room", source: r.id });
    const doors = (result.doors || []).filter((d) => ids.has(d.id));
    if (doors.length) out.push({ tool: "count", page: pageIndex, points: doors.map((d) => d.at), label: "Doors", preset: "p-door", subject: "Door", source: doors.map((d) => d.id).join(",") });
    const wins = (result.windows || []).filter((d) => ids.has(d.id));
    if (wins.length) out.push({ tool: "count", page: pageIndex, points: wins.map((d) => d.at), label: "Windows", preset: "", subject: "Window", source: wins.map((d) => d.id).join(",") });
    for (const s of result.symbols || []) if (ids.has(s.id) && s.at.length) out.push({ tool: "count", page: pageIndex, points: s.at, label: s.name, preset: "", subject: "Symbol", source: s.id });
    return out;
  }

  // ---------------------------------------------------------------- operator list reader
  // Straight segments [x0, y0, x1, y1, line width, fill flag] and cubic curves [8 numbers, line width]
  // in sheet points (base is the page's viewport transform at scale 1). Line widths are scaled by the
  // transforms. Quadratic curves are raised to cubic. Paths that are only clipped are skipped.
  function extractPaths(fnArray, argsArray, OPS, base, cap) {
    const max = cap || 150000;
    const segs = [], curves = [];
    let ctm = base ? base.slice() : [1, 0, 0, 1, 0, 0], lw = 1;
    const stack = [];
    const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const paintKind = (op) => {
      if (op === OPS.stroke || op === OPS.closeStroke) return 0;
      if (op === OPS.fill || op === OPS.eoFill) return 1;
      if (op === OPS.fillStroke || op === OPS.eoFillStroke || op === OPS.closeFillStroke || op === OPS.closeEOFillStroke) return 2;
      return -1;
    };
    const emit = (pathSegs, pathCurves, kind) => {
      if (kind < 0) return;
      const w = lw * scaleOf(ctm);
      for (const s of pathSegs) if (segs.length < max) segs.push([s[0], s[1], s[2], s[3], kind === 1 ? 0 : w, kind === 1 ? 1 : 0]);
      for (const c of pathCurves) if (curves.length < max) curves.push(c.concat([kind === 1 ? 0 : w]));
    };
    const walk = (data, isNew) => {
      const ps = [], pc = [];
      let cur = null, start = null;
      const P = (x, y) => mat_apply(ctm, x, y);
      const seg = (a, b) => { if (a[0] !== b[0] || a[1] !== b[1]) ps.push([a[0], a[1], b[0], b[1]]); };
      if (isNew) {
        for (let k = 0; k < data.length;) {
          const op = data[k++];
          if (op === 0) { cur = P(data[k], data[k + 1]); start = cur; k += 2; }
          else if (op === 1) { const p = P(data[k], data[k + 1]); if (cur) seg(cur, p); cur = p; k += 2; }
          else if (op === 2) {
            const c1 = P(data[k], data[k + 1]), c2 = P(data[k + 2], data[k + 3]), p = P(data[k + 4], data[k + 5]);
            if (cur) pc.push([cur[0], cur[1], c1[0], c1[1], c2[0], c2[1], p[0], p[1]]);
            cur = p; k += 6;
          } else if (op === 3) {
            const q = P(data[k], data[k + 1]), p = P(data[k + 2], data[k + 3]);
            if (cur) pc.push([cur[0], cur[1], cur[0] + 2 / 3 * (q[0] - cur[0]), cur[1] + 2 / 3 * (q[1] - cur[1]), p[0] + 2 / 3 * (q[0] - p[0]), p[1] + 2 / 3 * (q[1] - p[1]), p[0], p[1]]);
            cur = p; k += 4;
          } else if (op === 4) { if (cur && start) seg(cur, start); cur = start; }
          else break;
        }
      }
      return [ps, pc];
    };
    let pendingOld = null;
    for (let i = 0; i < fnArray.length && segs.length < max; i++) {
      const fn = fnArray[i], args = argsArray[i];
      if (fn === OPS.save) stack.push([ctm, lw]);
      else if (fn === OPS.restore) { if (stack.length) [ctm, lw] = stack.pop(); }
      else if (fn === OPS.transform) { if (args && args.length === 6) ctm = mat_mul(ctm, args); }
      else if (fn === OPS.setLineWidth) { if (args && num(args[0])) lw = args[0]; }
      else if (fn === OPS.setGState) {
        const list = args && Array.isArray(args[0]) ? args[0] : [];
        for (const e of list) if (Array.isArray(e) && e[0] === "LW" && num(e[1])) lw = e[1];
      } else if (fn === OPS.paintFormXObjectBegin) {
        stack.push([ctm, lw]);
        if (args && Array.isArray(args[0]) && args[0].length === 6) ctm = mat_mul(ctm, args[0]);
      } else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) [ctm, lw] = stack.pop(); }
      else if (fn === OPS.constructPath && args) {
        if (typeof args[0] === "number") {
          const data = Array.isArray(args[1]) ? args[1][0] : null;
          if (!data) continue;
          const [ps, pc] = walk(data, true);
          emit(ps, pc, paintKind(args[0]));
        } else {
          // pdf.js 3 and 4: the path, then a separate paint operator
          const ops = args[0], co = args[1];
          if (!ops || !co) continue;
          const ps = [], pc = [];
          let k = 0, cur = null, start = null;
          const P = (x, y) => mat_apply(ctm, x, y);
          for (const op of ops) {
            if (op === OPS.moveTo) { cur = P(co[k], co[k + 1]); start = cur; k += 2; }
            else if (op === OPS.lineTo) { const p = P(co[k], co[k + 1]); if (cur && (cur[0] !== p[0] || cur[1] !== p[1])) ps.push([cur[0], cur[1], p[0], p[1]]); cur = p; k += 2; }
            else if (op === OPS.curveTo) { const c1 = P(co[k], co[k + 1]), c2 = P(co[k + 2], co[k + 3]), p = P(co[k + 4], co[k + 5]); if (cur) pc.push([cur[0], cur[1], c1[0], c1[1], c2[0], c2[1], p[0], p[1]]); cur = p; k += 6; }
            else if (op === OPS.curveTo2 || op === OPS.curveTo3) { const p = P(co[k + 2], co[k + 3]); if (cur) ps.push([cur[0], cur[1], p[0], p[1]]); cur = p; k += 4; }
            else if (op === OPS.closePath) { if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) ps.push([cur[0], cur[1], start[0], start[1]]); cur = start; }
            else if (op === OPS.rectangle) {
              const x = co[k], y = co[k + 1], ww = co[k + 2], hh = co[k + 3];
              const a = P(x, y), b = P(x + ww, y), c = P(x + ww, y + hh), d = P(x, y + hh);
              ps.push([a[0], a[1], b[0], b[1]], [b[0], b[1], c[0], c[1]], [c[0], c[1], d[0], d[1]], [d[0], d[1], a[0], a[1]]);
              cur = a; start = a; k += 4;
            }
          }
          pendingOld = [ps, pc, ctm, lw];
        }
      } else if (pendingOld) {
        const kind = paintKind(fn);
        if (kind >= 0 || fn === OPS.endPath) {
          const [ps, pc, m, w0] = pendingOld;
          const keep = [ctm, lw];
          ctm = m; lw = w0;
          emit(ps, pc, kind);
          [ctm, lw] = keep;
          pendingOld = null;
        }
      }
    }
    return { segs, curves };
  }

  return {
    auto_takeoff: autoTakeoff, auto_proposals: proposals, auto_classify_wall: classifyWall, auto_clean_rules: cleanRules,
    auto_drawing_area: drawingArea, auto_text_lines: textLines, auto_scan_door_arcs: scanDoorArcs, AUTO_DEFAULTS: DEFAULTS, AUTO_RULES: RULES, extract_paths: extractPaths,
  };
})();
