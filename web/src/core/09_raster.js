// Pixel operations for the automatic tools. All take plain typed arrays and run the same in a
// worker, the page or node. Pixel coordinates have the origin at the top left.
//
// Room fill: binarize the sheet (ink = dark pixels), optionally close small gaps by growing the
// ink, flood fill from the clicked pixel, grow the region back, and trace its boundary along
// pixel edges. Islands inside the room (columns, shafts) come back as holes. The traced area
// equals the pixel count of the region exactly.
// Symbol search: normalized cross-correlation (NCC) of a picked symbol against the sheet,
// coarse on a reduced image, then refined at full size, with non-maximum suppression.
// Compare: binarize both sheets, find the shift that best aligns them, and box the pixels that
// were added or removed.

function gray_from_rgba(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    const a = rgba[j + 3] / 255;
    // Composite on white, then luma (BT.601 weights).
    const r = 255 - a * (255 - rgba[j]), gg = 255 - a * (255 - rgba[j + 1]), b = 255 - a * (255 - rgba[j + 2]);
    g[i] = Math.round(0.299 * r + 0.587 * gg + 0.114 * b);
  }
  return g;
}
function ink_mask(gray, threshold) {
  if (threshold === undefined) threshold = 160;
  const m = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) m[i] = gray[i] < threshold ? 1 : 0;
  return m;
}
// Grow set pixels by r in each direction (square kernel), two separable passes.
function dilate(mask, w, h, r) {
  if (!(r > 0)) return mask.slice();
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let last = -Infinity;
    for (let x = 0; x < w; x++) { if (mask[row + x]) last = x; if (x - last <= r) tmp[row + x] = 1; }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) { if (mask[row + x]) last = x; if (last - x <= r) tmp[row + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; if (y - last <= r) out[y * w + x] = 1; }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
  }
  return out;
}
// Scanline flood fill of open (0) pixels from (sx, sy). Returns the region or a reason.
function flood_region(blocked, w, h, sx, sy, maxPixels) {
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { ok: false, reason: "outside" };
  if (blocked[sy * w + sx]) return { ok: false, reason: "on_ink" };
  const region = new Uint8Array(w * h);
  const stack = [sx, sy];
  let count = 0;
  const cap = maxPixels || w * h;
  while (stack.length) {
    const y = stack.pop(), x0 = stack.pop();
    let x = x0;
    const row = y * w;
    if (region[row + x] || blocked[row + x]) continue;
    while (x > 0 && !blocked[row + x - 1] && !region[row + x - 1]) x--;
    let upOpen = false, downOpen = false;
    for (; x < w && !blocked[row + x] && !region[row + x]; x++) {
      region[row + x] = 1;
      if (++count > cap) return { ok: false, reason: "too_large" };
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) return { ok: false, reason: "leaks", count };
      if (y > 0) {
        const o = row - w + x;
        if (!blocked[o] && !region[o]) { if (!upOpen) { stack.push(x, y - 1); upOpen = true; } } else upOpen = false;
      }
      if (y < h - 1) {
        const o = row + w + x;
        if (!blocked[o] && !region[o]) { if (!downOpen) { stack.push(x, y + 1); downOpen = true; } } else downOpen = false;
      }
    }
  }
  return { ok: true, region, count };
}
// Grow a region back into open pixels by r (undoes the gap-closing growth of the ink).
function regrow(region, ink, w, h, r) {
  if (!(r > 0)) return region;
  const g = dilate(region, w, h, r);
  for (let i = 0; i < g.length; i++) if (ink[i]) g[i] = 0;
  return g;
}
// Boundary loops of a region along pixel edges. Each loop runs with the region on its right
// (clockwise on screen for the outer boundary). Returns loops as arrays of [x, y] corners.
function trace_loops(region, w, h) {
  const W1 = w + 1;
  const next = new Map(); // vertex key -> list of [toKey, dir]
  const add = (x0, y0, x1, y1, dir) => {
    const k = y0 * W1 + x0;
    let l = next.get(k);
    if (!l) { l = []; next.set(k, l); }
    l.push([y1 * W1 + x1, dir]);
  };
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? region[y * w + x] : 0);
  // dir: 0 right, 1 down, 2 left, 3 up
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!region[y * w + x]) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y, 0);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2);
      if (!at(x - 1, y)) add(x, y + 1, x, y, 3);
    }
  }
  const loops = [];
  for (const [startKey, list] of next) {
    while (list.length) {
      let [toKey, dir] = list.pop();
      const loop = [[startKey % W1, Math.floor(startKey / W1)]];
      let guard = 0;
      while (toKey !== startKey && guard++ < 4 * (w + 1) * (h + 1)) {
        loop.push([toKey % W1, Math.floor(toKey / W1)]);
        const outs = next.get(toKey);
        if (!outs || !outs.length) break;
        // At a pinch vertex, turn right first so loops stay separate.
        let pick = 0;
        if (outs.length > 1) {
          const pref = [(dir + 1) % 4, dir, (dir + 3) % 4];
          let bestRank = 9;
          outs.forEach((o, i) => { const r = pref.indexOf(o[1]); if (r >= 0 && r < bestRank) { bestRank = r; pick = i; } });
        }
        const o = outs.splice(pick, 1)[0];
        toKey = o[0]; dir = o[1];
      }
      loops.push(remove_collinear(loop));
    }
  }
  return loops.filter((l) => l.length >= 3);
}
function remove_collinear(loop) {
  const n = loop.length;
  if (n < 4) return loop;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n], b = loop[i], c = loop[(i + 1) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}
// Simplify a closed loop (Douglas-Peucker on the open chain from its farthest pair).
function simplify_closed(loop, tol) {
  if (loop.length <= 4 || !(tol > 0)) return loop;
  let far = 0, fd = -1;
  for (let i = 1; i < loop.length; i++) { const d = dist(loop[0], loop[i]); if (d > fd) { fd = d; far = i; } }
  const a = simplify(loop.slice(0, far + 1), tol), b = simplify(loop.slice(far).concat([loop[0]]), tol);
  const out = a.concat(b.slice(1, -1));
  return out.length >= 3 ? out : loop;
}
// The room under a clicked pixel: outline and holes in pixel coordinates. Islands smaller than
// minHole square pixels (room names, symbols) are treated as part of the room.
function detect_room(gray, w, h, sx, sy, opts) {
  opts = opts || {};
  const ink = ink_mask(gray, opts.threshold || 160);
  const gap = Math.max(0, Math.min(40, Math.round(opts.gap || 0)));
  const blocked = gap ? dilate(ink, w, h, gap) : ink;
  const f = flood_region(blocked, w, h, sx, sy, opts.maxPixels || Math.floor(w * h * 0.6));
  if (!f.ok) return { ok: false, reason: f.reason };
  const region = regrow(f.region, ink, w, h, gap);
  // Keep only the part connected to the click (regrowth can touch other pockets).
  const f2 = flood_region(invert(region), w, h, sx, sy);
  const final = f2.ok ? f2.region : region;
  let pixels = 0;
  for (let i = 0; i < final.length; i++) pixels += final[i];
  const loops = trace_loops(final, w, h);
  if (!loops.length) return { ok: false, reason: "no_boundary" };
  loops.sort((a, b) => Math.abs(signed_area(b)) - Math.abs(signed_area(a)));
  const tol = opts.simplify === undefined ? 0.75 : opts.simplify;
  let outer = simplify_closed(loops[0], tol);
  let holes = loops.slice(1).filter((l) => Math.abs(signed_area(l)) >= (opts.minHole || 4)).map((l) => simplify_closed(l, tol));
  let faces = null;
  if (ROOM_BOUNDARIES.includes(opts.boundary)) {
    const r = room_boundary(gray, w, h, outer, holes, opts);
    outer = r.outer; holes = r.holes; faces = r.faces;
  }
  return { ok: true, outer, holes, pixels, faces, boundary: faces ? opts.boundary : null };
}

// ------------------------------------------------------------------ wall faces for area by click
// The traced outline follows whole pixels of the open space, so it sits a fraction of a pixel
// inside the ink (an antialiased edge pixel counts as ink once it is a third covered). Each edge is
// moved to where its wall really is: the grayscale picture is read along the edge's outward normal
// at up to 32 places, and the 50 percent crossing between paper and ink (to a hundredth of a pixel
// in practice) is the wall's inside face. The far side of the ink is its outside face; a second line
// close behind the first (a wall drawn as two lines) counts as the same wall when the whole wall
// stays under maxWall pixels. The boundary then is the inside face, the wall centerline or the
// outside face. Edges along an opening (a door closed by gap bridging) have no wall: they take the
// median of the others. Islands (columns) are always taken at their face.
const ROOM_BOUNDARIES = ["inside", "center", "outside"];
function _gray_at(gray, w, h, x, y) {
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  const g = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 255 : gray[j * w + i]);
  return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
}
function _median(v) { if (!v.length) return null; const s = v.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
// One profile from point (x, y) along unit normal (nx, ny): { inner, thick } in pixels from the
// traced edge, or null when no wall is found within reach. A face is placed by area, not by a
// threshold: the paper-to-ink ramp is integrated (normalized between the paper and the line's own
// darkest value), which for pixels that average the paper under them is exact on a straight edge.
function _wall_profile(gray, w, h, x, y, nx, ny, o) {
  const step = 0.125, back = 2.5, reach = o.maxWall + 3;
  const vals = [];
  for (let s = -back; s <= reach; s += step) vals.push(_gray_at(gray, w, h, x + nx * s, y + ny * s));
  const n = vals.length, at = (i) => -back + i * step;
  let paper = 0;
  for (let i = 0; i <= back / step; i++) paper = Math.max(paper, vals[i]);
  if (paper - o.threshold < 10) return null;
  // one dark run starting at i0: its faces (ink edge on each side) and where it ends
  const run = (i0) => {
    let i1 = i0;
    while (i1 + 1 < n && vals[i1 + 1] < o.threshold) i1++;
    let pk = i0;
    for (let k = i0; k <= i1; k++) if (vals[k] < vals[pk]) pk = k;
    // a line under about two pixels never shows its full darkness: use the drawing's own ink
    const wide = (i1 - i0) * step >= 2;
    const ink = wide || o.ink === undefined ? vals[pk] : Math.min(vals[pk], o.ink), span = paper - ink;
    if (span < 20) return null;
    // from clean paper before the line to clean paper after it
    let sa = i0;
    while (sa > 0 && vals[sa] < paper - 0.5) sa--;
    let sc = i1;
    while (sc < n - 1 && vals[sc] < paper - 0.5 && !(vals[sc + 1] < vals[sc] && vals[sc] >= o.threshold)) sc++;
    // the line's width is its total darkness and its middle the darkness's centroid; both survive
    // the pixel averaging exactly, so the faces are the middle plus and minus half the width
    const dk = (k) => Math.min(1, Math.max(0, (paper - vals[k]) / span));
    let D = 0, M = 0;
    for (let k = sa; k < sc; k++) { const a0 = dk(k), a1 = dk(k + 1), s0 = at(k); D += (a0 + a1) / 2 * step; M += (a0 * (s0 + step / 3) + a1 * (s0 + 2 * step / 3)) / 2 * step; }
    if (!(D > 0)) return null;
    const c = M / D, inner = c - D / 2, outer = c + D / 2;
    return { inner, outer, end: sc };
  };
  let i0 = -1;
  for (let i = 0; i < n; i++) if (vals[i] < o.threshold) { i0 = i; break; }
  if (i0 < 0) return null;
  const first = run(i0);
  if (!first || first.end >= n - 1) return null;
  let outer = first.outer;
  // a second line close behind: the same wall when the whole stays within maxWall
  let j = first.end;
  while (j < n && vals[j] >= o.threshold && at(j) - first.outer <= o.maxGap) j++;
  if (j < n && vals[j] < o.threshold && at(j) - first.outer <= o.maxGap) {
    const second = run(j);
    if (second && second.end < n - 1 && second.outer - first.inner <= o.maxWall) outer = second.outer;
  }
  if (outer - first.inner > o.maxWall || outer <= first.inner) return null;
  return { inner: first.inner, thick: outer - first.inner };
}
function _edge_faces(gray, w, h, loop, o) {
  const n = loop.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = loop[i], q = loop[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    if (len < 3) { out.push(null); continue; }
    const ux = dx / len, uy = dy / len, nx = uy, ny = -ux; // the open space is on the right: outward is left
    const k = Math.max(1, Math.min(32, Math.floor(len / 2)));
    const inn = [], thk = [];
    for (let j = 0; j < k; j++) {
      const t = 0.2 + 0.6 * (k === 1 ? 0.5 : j / (k - 1));
      const r = _wall_profile(gray, w, h, p[0] + dx * t, p[1] + dy * t, nx, ny, o);
      if (r) { inn.push(r.inner); thk.push(r.thick); }
    }
    out.push(inn.length >= Math.max(1, k * 0.3) ? { inner: _median(inn), thick: _median(thk) } : null);
  }
  return out;
}
// Move each edge of a closed loop outward (to its left) by d[i] and join neighbors where their
// lines cross; nearly parallel neighbors, or very sharp corners, keep a mitre of bounded length.
function offset_loop(loop, d) {
  const n = loop.length, lines = [];
  for (let i = 0; i < n; i++) {
    const p = loop[i], q = loop[(i + 1) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len, nx = uy, ny = -ux;
    lines.push({ px: p[0] + nx * d[i], py: p[1] + ny * d[i], ux, uy, nx, ny });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n], B = lines[i], v = loop[i];
    const den = A.ux * B.uy - A.uy * B.ux;
    const lim = 4 * Math.max(Math.abs(d[i]), Math.abs(d[(i - 1 + n) % n]), 0.5);
    let x = v[0] + B.nx * d[i], y = v[1] + B.ny * d[i];
    if (Math.abs(den) > 1e-6) {
      const t = ((B.px - A.px) * B.uy - (B.py - A.py) * B.ux) / den;
      const cx = A.px + A.ux * t, cy = A.py + A.uy * t;
      if (Math.hypot(cx - v[0], cy - v[1]) <= lim) { x = cx; y = cy; }
    }
    out.push([x, y]);
  }
  return out;
}
// The traced outline and islands moved to the boundary asked for. opts: boundary ("inside",
// "center" or "outside"), threshold, maxWall and maxGap (pixels).
// The drawing's ink around a loop: the 5th percentile of the dark pixels within reach of it.
function _ink_level(gray, w, h, loop, reach, threshold) {
  const b = bbox(loop);
  const x0 = Math.max(0, Math.floor(b[0] - reach)), y0 = Math.max(0, Math.floor(b[1] - reach)), x1 = Math.min(w - 1, Math.ceil(b[2] + reach)), y1 = Math.min(h - 1, Math.ceil(b[3] + reach));
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = gray[y * w + x]; if (v < threshold) { hist[v]++; n++; } }
  if (!n) return undefined;
  let c = 0;
  for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= n * 0.05) return v; }
  return undefined;
}
function room_boundary(gray, w, h, outer, holes, opts) {
  const o = { threshold: opts.threshold || 160, maxWall: Math.max(3, Math.min(200, opts.maxWall || 40)), maxGap: Math.max(0, Math.min(100, opts.maxGap === undefined ? 12 : opts.maxGap)) };
  o.ink = _ink_level(gray, w, h, outer, o.maxWall + 3, o.threshold);
  const ef = _edge_faces(gray, w, h, outer, o);
  const known = ef.filter((f) => f);
  // what an edge without a wall takes, and what the card reports: the median by length, so the
  // long walls count and the many short edges of a door swing do not
  const lens = outer.map((pt, i) => Math.hypot(outer[(i + 1) % outer.length][0] - pt[0], outer[(i + 1) % outer.length][1] - pt[1]));
  const wmed = (key) => {
    const v = ef.map((f, i) => (f ? [f[key], lens[i]] : null)).filter(Boolean).sort((x, y) => x[0] - y[0]);
    if (!v.length) return null;
    const half = v.reduce((t, x) => t + x[1], 0) / 2;
    let acc = 0;
    for (const [val, len] of v) { acc += len; if (acc >= half) return val; }
    return v[v.length - 1][0];
  };
  const inner0 = wmed("inner"), thick0 = wmed("thick");
  if (inner0 === null) return { outer, holes, faces: { inner: null, thickness: null, edges: 0, of: outer.length } };
  const mode = opts.boundary;
  const d = ef.map((f) => {
    const inner = f ? f.inner : inner0, thick = f ? f.thick : thick0;
    return mode === "inside" ? inner : mode === "center" ? inner + thick / 2 : inner + thick;
  });
  const newHoles = holes.map((hl) => {
    const hf = _edge_faces(gray, w, h, hl, Object.assign({}, o, { maxGap: 0 }));
    const hk = _median(hf.filter((f) => f).map((f) => f.inner));
    return offset_loop(hl, hf.map((f) => (f ? f.inner : hk === null ? inner0 : hk)));
  });
  return { outer: offset_loop(outer, d), holes: newHoles, faces: { inner: inner0, thickness: thick0, edges: known.length, of: outer.length } };
}
function invert(mask) {
  const o = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) o[i] = mask[i] ? 0 : 1;
  return o;
}

// ------------------------------------------------------------------ symbol search
function integral(gray, w, h) {
  const S = new Float64Array((w + 1) * (h + 1)), Q = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      rs += v; rq += v * v;
      const k = (y + 1) * (w + 1) + x + 1;
      S[k] = S[k - (w + 1)] + rs; Q[k] = Q[k - (w + 1)] + rq;
    }
  }
  return { S, Q };
}
function box_sum(T, w, x, y, tw, th) {
  const W1 = w + 1;
  return T[(y + th) * W1 + x + tw] - T[y * W1 + x + tw] - T[(y + th) * W1 + x] + T[y * W1 + x];
}
function downsample(gray, w, h, f) {
  if (f <= 1) return { g: gray, w, h };
  const W = Math.floor(w / f), H = Math.floor(h / f), g = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += gray[(y * f + j) * w + x * f + i];
    g[y * W + x] = Math.round(s / (f * f));
  }
  return { g, w: W, h: H };
}
// Template variants: 0, 90, 180 and 270 degrees, each optionally mirrored.
function template_variants(t, tw, th, rotations, mirror) {
  const out = [{ g: t, w: tw, h: th, rot: 0, mirror: false }];
  const rot90 = (v) => {
    const g = new Uint8Array(v.w * v.h);
    for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) g[x * v.h + (v.h - 1 - y)] = v.g[y * v.w + x];
    return { g, w: v.h, h: v.w };
  };
  const flip = (v) => {
    const g = new Uint8Array(v.w * v.h);
    for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) g[y * v.w + (v.w - 1 - x)] = v.g[y * v.w + x];
    return { g, w: v.w, h: v.h };
  };
  if (rotations) {
    let v = out[0];
    for (let r = 90; r < 360; r += 90) { v = Object.assign(rot90(v), { rot: r, mirror: false }); out.push(v); }
  }
  if (mirror) {
    const base = out.slice();
    for (const v of base) out.push(Object.assign(flip(v), { rot: v.rot, mirror: true }));
  }
  // Drop variants identical to an earlier one (symmetric symbols).
  return out.filter((v, i) => !out.slice(0, i).some((u) => u.w === v.w && u.h === v.h && u.g.every((p, k) => p === v.g[k])));
}
function ncc_at(img, iw, I, tpl, tw, th, tMean, tNorm, x, y) {
  const n = tw * th;
  const s = box_sum(I.S, iw, x, y, tw, th), q = box_sum(I.Q, iw, x, y, tw, th);
  const varI = q - s * s / n;
  if (varI < n * 4) return -1; // blank window
  const mI = s / n;
  let num = 0;
  for (let j = 0; j < th; j++) {
    const ro = (y + j) * iw + x, to = j * tw;
    for (let i = 0; i < tw; i++) num += (img[ro + i] - mI) * (tpl[to + i] - tMean);
  }
  return num / Math.sqrt(varI * tNorm);
}
function tpl_stats(g) {
  let s = 0;
  for (let i = 0; i < g.length; i++) s += g[i];
  const m = s / g.length;
  let q = 0;
  for (let i = 0; i < g.length; i++) q += (g[i] - m) * (g[i] - m);
  return { mean: m, norm: q };
}
// Find copies of a template in an image. Returns [{x, y, w, h, score, rot, mirror}] (top left).
// Three passes: a coarse one on images reduced so the template is about 8 px across (with a loose
// threshold and an ink-amount check that skips windows that hold far more or less ink than the
// symbol), a middle one at about a third of that reduction, and a final one at full resolution
// around each surviving spot.
function ink_ok(I, iw, x, y, tw, th, tInk) {
  const n = tw * th;
  const ink = n * 255 - box_sum(I.S, iw, x, y, tw, th);
  return ink >= tInk * 0.55 && ink <= tInk * 1.8;
}
function tpl_ink(g) { let s = 0; for (let i = 0; i < g.length; i++) s += 255 - g[i]; return s; }
function find_symbol(gray, w, h, tpl, tw, th, opts) {
  opts = opts || {};
  const thr = opts.threshold === undefined ? 0.8 : opts.threshold;
  const maxHits = opts.maxHits || 2000;
  const perVariant = opts.maxCandidates || 600;
  const variants = template_variants(tpl, tw, th, opts.rotations !== false, !!opts.mirror);
  const hits = [];
  const f = Math.max(1, Math.min(16, Math.floor(Math.min(tw, th) / 8)));
  const fm = Math.max(1, Math.floor(f / 3));
  const loose = f >= 4 ? 0.3 : f >= 2 ? 0.2 : 0.12;
  const small = downsample(gray, w, h, f), Ismall = integral(small.g, small.w, small.h);
  const mid = fm > 1 ? downsample(gray, w, h, fm) : { g: gray, w, h };
  const Imid = fm > 1 ? integral(mid.g, mid.w, mid.h) : null;
  const Ifull = integral(gray, w, h);
  const Iat = (lvl) => (lvl === mid && Imid ? Imid : Ifull);
  for (const v of variants) {
    const st = tpl_stats(v.g);
    if (st.norm < v.g.length * 4) continue; // blank template
    const sv = downsample(v.g, v.w, v.h, f), sst = tpl_stats(sv.g), sInk = tpl_ink(sv.g);
    const mv = fm > 1 ? downsample(v.g, v.w, v.h, fm) : { g: v.g, w: v.w, h: v.h };
    const mst = tpl_stats(mv.g);
    if (sst.norm < sv.g.length || mst.norm < mv.g.length) continue;
    const coarse = [];
    for (let y = 0; y + sv.h <= small.h; y++) {
      for (let x = 0; x + sv.w <= small.w; x++) {
        if (!ink_ok(Ismall, small.w, x, y, sv.w, sv.h, sInk)) continue;
        const c = ncc_at(small.g, small.w, Ismall, sv.g, sv.w, sv.h, sst.mean, sst.norm, x, y);
        if (c >= thr - loose) coarse.push([x, y, c]);
      }
    }
    coarse.sort((a, b) => b[2] - a[2]);
    // Suppress coarse hits within half a symbol of a stronger one (an occupancy grid keeps it linear).
    const blocked = new Uint8Array(small.w * small.h);
    const rx = Math.max(1, Math.floor(sv.w / 2)), ry = Math.max(1, Math.floor(sv.h / 2));
    let taken = 0;
    for (const [cx, cy] of coarse) {
      if (blocked[cy * small.w + cx]) continue;
      for (let y = Math.max(0, cy - ry); y <= Math.min(small.h - 1, cy + ry); y++) blocked.fill(1, y * small.w + Math.max(0, cx - rx), y * small.w + Math.min(small.w, cx + rx + 1));
      if (++taken > perVariant) break;
      // middle pass
      let bm = null;
      const k = f / fm;
      for (let y = Math.round((cy - 1) * k); y <= Math.round((cy + 1) * k); y++) {
        for (let x = Math.round((cx - 1) * k); x <= Math.round((cx + 1) * k); x++) {
          if (x < 0 || y < 0 || x + mv.w > mid.w || y + mv.h > mid.h) continue;
          const c = ncc_at(mid.g, mid.w, Iat(mid), mv.g, mv.w, mv.h, mst.mean, mst.norm, x, y);
          if (!bm || c > bm[2]) bm = [x, y, c];
        }
      }
      if (!bm || bm[2] < thr - 0.15) continue;
      // full resolution pass
      let best = null;
      for (let y = bm[1] * fm - fm; y <= bm[1] * fm + fm; y++) {
        for (let x = bm[0] * fm - fm; x <= bm[0] * fm + fm; x++) {
          if (x < 0 || y < 0 || x + v.w > w || y + v.h > h) continue;
          const c = fm > 1 ? ncc_at(gray, w, Ifull, v.g, v.w, v.h, st.mean, st.norm, x, y) : bm[2];
          if (!best || c > best.score) best = { x, y, w: v.w, h: v.h, score: c, rot: v.rot, mirror: v.mirror };
          if (fm === 1) break;
        }
        if (fm === 1) break;
      }
      if (best && best.score >= thr) hits.push(best);
    }
  }
  // Non-maximum suppression across variants.
  hits.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const hgt of hits) {
    const cx = hgt.x + hgt.w / 2, cy = hgt.y + hgt.h / 2;
    if (kept.some((k) => Math.abs(k.x + k.w / 2 - cx) < Math.max(k.w, hgt.w) * 0.5 && Math.abs(k.y + k.h / 2 - cy) < Math.max(k.h, hgt.h) * 0.5)) continue;
    kept.push(hgt);
    if (kept.length >= maxHits) break;
  }
  return kept;
}

// ------------------------------------------------------------------ compare
// The shift (dx, dy) of image b that best lines it up with image a. Row and column ink profiles
// give each axis by 1-D cross-correlation; a small 2-D search at full size then settles it.
function profile_shift(pa, pb, R) {
  let best = 0, bs = -Infinity;
  const n = pa.length;
  for (let d = -R; d <= R; d++) {
    let s = 0;
    for (let i = Math.max(0, -d); i < Math.min(n, n - d); i++) s += pa[i] * pb[i + d];
    if (s > bs || (s === bs && Math.abs(d) < Math.abs(best))) { bs = s; best = d; }
  }
  return best;
}
function best_shift(a, b, w, h, maxShift) {
  const R = Math.max(1, Math.round(maxShift || 40));
  const ia = ink_mask(a), ib = ink_mask(b);
  const ra = new Float64Array(h), rb = new Float64Array(h), ca = new Float64Array(w), cb = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) { const u = ia[o + x], v = ib[o + x]; ra[y] += u; ca[x] += u; rb[y] += v; cb[x] += v; }
  }
  const dx0 = profile_shift(ca, cb, R), dy0 = profile_shift(ra, rb, R);
  let best = { dx: dx0, dy: dy0, score: -1 };
  for (let dy = dy0 - 2; dy <= dy0 + 2; dy++) for (let dx = dx0 - 2; dx <= dx0 + 2; dx++) {
    let s = 0;
    for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++) {
      const ra2 = y * w, rb2 = (y + dy) * w;
      for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) s += ia[ra2 + x] & ib[rb2 + x + dx];
    }
    if (s > best.score || (s === best.score && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, score: s };
  }
  return { dx: best.dx, dy: best.dy };
}
// Pixels in b (shifted by dx, dy onto a) that are new or gone, with a tolerance of tol pixels.
function diff_masks(a, b, w, h, dx, dy, tol) {
  tol = tol === undefined ? 1 : tol;
  const ia = ink_mask(a), ibRaw = ink_mask(b);
  const ib = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y + dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) { const sx = x + dx; if (sx >= 0 && sx < w) ib[y * w + x] = ibRaw[sy * w + sx]; }
  }
  const da = dilate(ia, w, h, tol), db = dilate(ib, w, h, tol);
  const added = new Uint8Array(w * h), removed = new Uint8Array(w * h);
  let nAdded = 0, nRemoved = 0;
  for (let i = 0; i < w * h; i++) {
    if (ib[i] && !da[i]) { added[i] = 1; nAdded++; }
    if (ia[i] && !db[i]) { removed[i] = 1; nRemoved++; }
  }
  return { a: ia, b: ib, added, removed, nAdded, nRemoved };
}
// Bounding boxes [x0, y0, x1, y1] of clusters of changed pixels (grown by pad), largest first.
function change_boxes(mask, w, h, pad, minPixels) {
  pad = pad === undefined ? 6 : pad;
  minPixels = minPixels === undefined ? 12 : minPixels;
  const grown = dilate(mask, w, h, pad);
  const seen = new Uint8Array(w * h);
  const boxes = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!grown[i] || seen[i]) continue;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % w, y = (k - x) / w;
      if (mask[k]) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      if (x > 0 && grown[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack.push(k - 1); }
      if (x < w - 1 && grown[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack.push(k + 1); }
      if (y > 0 && grown[k - w] && !seen[k - w]) { seen[k - w] = 1; stack.push(k - w); }
      if (y < h - 1 && grown[k + w] && !seen[k + w]) { seen[k + w] = 1; stack.push(k + w); }
    }
    if (n >= minPixels) boxes.push([Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(w, x1 + 1 + pad), Math.min(h, y1 + 1 + pad), n]);
  }
  boxes.sort((p, q) => q[4] - p[4]);
  return boxes;
}
// One RGBA overlay: ink in both sheets dark, only in the old sheet colorA, only in the new colorB.
function overlay_rgba(d, w, h, colorA, colorB, colorBoth) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    let c = null;
    if (d.a[i] && d.b[i]) c = colorBoth;
    else if (d.removed[i] || (d.a[i] && !d.b[i])) c = d.removed[i] ? colorA : colorBoth;
    else if (d.added[i] || d.b[i]) c = d.added[i] ? colorB : colorBoth;
    if (c) { out[j] = c[0]; out[j + 1] = c[1]; out[j + 2] = c[2]; out[j + 3] = 255; } else { out[j] = out[j + 1] = out[j + 2] = 255; out[j + 3] = 255; }
  }
  return out;
}
