// Scanned drawings: cleanup before text recognition and counting, line detection for snapping on
// raster sheets, and turning recognized words into the same text items a vector sheet gives.
//
// Threshold: Otsu's method (Otsu, 1979) picks the gray level that best separates ink and paper.
// Skew: the angle (within +-5 degrees) at which the row profile of ink pixels is sharpest (the
// variance of row sums is largest), searched coarse then fine (projection profile method).
// Despeckle: connected ink specks smaller than a set number of pixels are paper noise.
// Lines: long horizontal and vertical ink runs, merged across neighboring rows or columns into
// one segment along the stroke's center; their ends and crossings are the snap points.

function otsu_threshold(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}
// Stretch contrast so the darkest 1 percent is black and the lightest 1 percent is white.
function stretch_contrast(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const cut = gray.length * 0.01;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > cut) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > cut) break; }
  const out = new Uint8Array(gray.length);
  if (hi - lo < 16) { out.set(gray); return out; }
  const k = 255 / (hi - lo);
  for (let i = 0; i < gray.length; i++) out[i] = Math.max(0, Math.min(255, Math.round((gray[i] - lo) * k)));
  return out;
}
function _row_variance(xs, ys, n, ang, h) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const bins = new Float64Array(h * 2 + 8);
  for (let i = 0; i < n; i++) {
    const r = Math.round(ys[i] * c - xs[i] * s) + h + 4;
    if (r >= 0 && r < bins.length) bins[r]++;
  }
  let m = 0, v = 0;
  for (let i = 0; i < bins.length; i++) m += bins[i];
  m /= bins.length;
  for (let i = 0; i < bins.length; i++) v += (bins[i] - m) * (bins[i] - m);
  return v;
}
// Skew in degrees: how far the drawing is turned on the scan, in the sense rotate_gray turns an
// image, so rotate_gray(image, -skew) straightens it.
function estimate_skew(gray, w, h, opts) {
  const o = Object.assign({ maxDeg: 5, threshold: null, samples: 60000 }, opts || {});
  const t = o.threshold === null ? otsu_threshold(gray) : o.threshold;
  let n = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] < t) n++;
  if (n < 50) return 0;
  const step = Math.max(1, Math.floor(n / o.samples));
  const xs = new Float64Array(Math.ceil(n / step) + 1), ys = new Float64Array(xs.length);
  let k = 0, seen = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (gray[y * w + x] >= t) continue;
    if (seen++ % step === 0 && k < xs.length) { xs[k] = x; ys[k] = y; k++; }
  }
  const rad = Math.PI / 180;
  let best = 0, bestV = -1;
  for (let d = -o.maxDeg; d <= o.maxDeg + 1e-9; d += 0.5) { const v = _row_variance(xs, ys, k, d * rad, h); if (v > bestV) { bestV = v; best = d; } }
  const c0 = best;
  for (let d = c0 - 0.5; d <= c0 + 0.5 + 1e-9; d += 0.05) { const v = _row_variance(xs, ys, k, d * rad, h); if (v > bestV) { bestV = v; best = d; } }
  // the profile is sharpest when the rows are turned back by the skew: the skew is the opposite
  return -Math.round(best * 100) / 100 || 0;
}
// Turn an image by deg about its center (bilinear), paper filled in at the corners.
function rotate_gray(gray, w, h, deg) {
  if (!deg) return gray.slice();
  const out = new Uint8Array(w * h);
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const sx = c * dx - s * dy + cx, sy = s * dx + c * dy + cy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) { out[y * w + x] = 255; continue; }
      const fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
      out[y * w + x] = Math.round(gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy) + gray[i + w] * (1 - fx) * fy + gray[i + w + 1] * fx * fy);
    }
  }
  return out;
}
// Where a point of the original lands in the turned image, and back.
function rotate_point(x, y, w, h, deg, inverse) {
  const a = (inverse ? 1 : -1) * deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const cx = (w - 1) / 2, cy = (h - 1) / 2, dx = x - cx, dy = y - cy;
  return [c * dx - s * dy + cx, s * dx + c * dy + cy];
}
// Remove ink specks of fewer than minPixels (8-connected) from a 0/1 mask.
function despeckle(mask, w, h, minPixels) {
  const out = mask.slice();
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const small = new Int32Array(Math.max(1, minPixels));
  for (let i = 0; i < w * h; i++) {
    if (!out[i] || seen[i]) continue;
    let sp = 0, n = 0;
    stack[sp++] = i; seen[i] = 1;
    while (sp) {
      const p = stack[--sp];
      if (n < minPixels) small[n] = p;
      n++;
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (out[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
      }
    }
    if (n < minPixels) for (let k = 0; k < n; k++) out[small[k]] = 0;
  }
  return out;
}
// Cleanup for a scanned sheet: contrast, deskew, threshold, despeckle. Returns the cleaned gray
// image (ink black on white), the skew found and the threshold used.
function clean_scan(gray, w, h, opts) {
  const o = Object.assign({ deskew: true, speck: 6 }, opts || {});
  let g = stretch_contrast(gray);
  const skew = o.deskew ? estimate_skew(g, w, h) : 0;
  if (Math.abs(skew) >= 0.1) g = rotate_gray(g, w, h, -skew);
  const t = otsu_threshold(g);
  let m = ink_mask(g, t + 1);
  if (o.speck > 0) m = despeckle(m, w, h, o.speck);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = m[i] ? 0 : 255;
  return { gray: out, skew, threshold: t };
}
// Long straight strokes in a 0/1 ink mask: horizontal and vertical segments [x0, y0, x1, y1] along
// the stroke centers, in pixels. minLen is the shortest run kept; gap bridges small breaks.
function detect_lines(mask, w, h, opts) {
  const o = Object.assign({ minLen: 40, gap: 2, maxThick: 12 }, opts || {});
  const runs = (get, along, across) => {
    const open = new Map(); // run start key -> {a0, a1, b0, b1}
    const done = [];
    for (let b = 0; b < across; b++) {
      const cur = [];
      let a = 0;
      while (a < along) {
        if (!get(a, b)) { a++; continue; }
        let e = a;
        let lastInk = a;
        while (e < along && (get(e, b) || e - lastInk <= o.gap)) { if (get(e, b)) lastInk = e; e++; }
        if (lastInk - a + 1 >= o.minLen) cur.push([a, lastInk]);
        a = e;
      }
      // join with runs on the previous row that overlap most of their length
      const next = new Map();
      for (const [a0, a1] of cur) {
        let joined = null;
        for (const [k, r] of open) {
          const ov = Math.min(a1, r.a1) - Math.max(a0, r.a0);
          if (ov > 0.6 * Math.min(a1 - a0, r.a1 - r.a0) && b - r.b1 === 1 && r.b1 - r.b0 < o.maxThick) { joined = k; break; }
        }
        if (joined !== null) {
          const r = open.get(joined);
          open.delete(joined);
          next.set(joined, { a0: Math.min(r.a0, a0), a1: Math.max(r.a1, a1), b0: r.b0, b1: b, sum: r.sum + (a1 - a0), n: r.n + 1 });
        } else next.set(b * 100003 + a0, { a0, a1, b0: b, b1: b, sum: a1 - a0, n: 1 });
      }
      for (const r of open.values()) done.push(r);
      open.clear();
      for (const [k, r] of next) open.set(k, r);
    }
    for (const r of open.values()) done.push(r);
    return done.filter((r) => r.b1 - r.b0 < o.maxThick);
  };
  const H = runs((x, y) => mask[y * w + x], w, h).map((r) => [r.a0, (r.b0 + r.b1) / 2, r.a1, (r.b0 + r.b1) / 2]);
  const V = runs((y, x) => mask[y * w + x], h, w).map((r) => [(r.b0 + r.b1) / 2, r.a0, (r.b0 + r.b1) / 2, r.a1]);
  return H.concat(V);
}
// Crossings and corners of horizontal and vertical segments (pixels or points), within tol.
function line_intersections(segs, tol) {
  const t = tol === undefined ? 2 : tol;
  const hs = segs.filter((s) => Math.abs(s[1] - s[3]) <= t), vs = segs.filter((s) => Math.abs(s[0] - s[2]) <= t);
  const out = [];
  for (const a of hs) {
    const y = (a[1] + a[3]) / 2, x0 = Math.min(a[0], a[2]) - t, x1 = Math.max(a[0], a[2]) + t;
    for (const b of vs) {
      const x = (b[0] + b[2]) / 2, y0 = Math.min(b[1], b[3]) - t, y1 = Math.max(b[1], b[3]) + t;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push([x, y]);
      if (out.length > 50000) return out;
    }
  }
  return out;
}
// Snap geometry for a scanned sheet: threshold, drop specks, find long strokes and where they
// cross. Segments and crossings are in pixels.
// A scan turned by a degree or two is straightened first (lines are found as horizontal and
// vertical runs), and what is found is turned back onto the page picture.
// With opts.doors ({r_min, r_max}, door radii in pixels) the door swings are found too, in the same
// straightened mask (auto_scan_door_arcs): {curves, leaves, drop}, turned back like the lines.
function scan_lines(gray, w, h, opts) {
  const o = Object.assign({ minLen: 40, gap: 2, speck: 6, deskew: true, doors: null }, opts || {});
  let g = gray, skew = 0;
  if (o.deskew) { skew = estimate_skew(gray, w, h); if (Math.abs(skew) >= 0.1) g = rotate_gray(gray, w, h, -skew); else skew = 0; }
  const t = otsu_threshold(g);
  let m = ink_mask(g, t + 1);
  if (o.speck > 0) m = despeckle(m, w, h, o.speck);
  let segs = detect_lines(m, w, h, { minLen: o.minLen, gap: o.gap });
  let ints = line_intersections(segs, 3);
  // door swings are thin strokes, often half-toned when a scan is reduced: they are looked for in a
  // lighter mask (halfway from the ink threshold to white), cleaned of specks the same way
  const doors = o.doors ? auto_scan_door_arcs(despeckle(ink_mask(g, door_threshold(t)), w, h, Math.max(1, o.speck)), w, h, segs, o.doors) : null;
  if (skew) {
    const back = (x, y) => rotate_point(x, y, w, h, -skew, true);
    segs = segs.map((s) => back(s[0], s[1]).concat(back(s[2], s[3])));
    ints = ints.map((q) => back(q[0], q[1]));
    if (doors) {
      doors.curves = doors.curves.map((c) => back(c[0], c[1]).concat(back(c[2], c[3]), back(c[4], c[5]), back(c[6], c[7]), [c[8]]));
      doors.leaves = doors.leaves.map((s) => back(s[0], s[1]).concat(back(s[2], s[3])));
    }
  }
  return doors ? { segs, ints, skew, doors } : { segs, ints, skew };
}
// The gray level under which a pixel counts as ink for the door search.
function door_threshold(t) { return Math.floor((t + 1 + 255) / 2); }
// The auto-takeoff input from scan_lines on a picture of k pixels per point: the lines in sheet
// points, each door leaf in place of the lines found on it, and the door swings as curves.
function scan_page_lines(r, k) {
  const d = r.doors || { curves: [], leaves: [], drop: [] };
  const drop = new Set(d.drop);
  const segs = r.segs.filter((s, i) => !drop.has(i)).map((s) => [s[0] / k, s[1] / k, s[2] / k, s[3] / k, 0, 0]);
  for (const s of d.leaves) segs.push([s[0] / k, s[1] / k, s[2] / k, s[3] / k, 0, 0]);
  return { segs, curves: d.curves.map((c) => c.slice(0, 8).map((v) => v / k).concat([0])) };
}
// A grayscale image as a binary PGM file (P5), the plainest format the text engine reads.
function pgm_bytes(gray, w, h) {
  const head = utf8("P5\n" + w + " " + h + "\n255\n");
  const out = new Uint8Array(head.length + gray.length);
  out.set(head);
  out.set(gray, head.length);
  return out;
}
// Words from the text engine's tab separated output (level 5 rows).
function tsv_words(tsv) {
  const out = [];
  for (const line of String(tsv || "").split("\n")) {
    const f = line.split("\t");
    if (f[0] !== "5" || f.length < 12) continue;
    const text = f.slice(11).join("\t").trim();
    const conf = Number(f[10]);
    if (!text || !(conf >= 0)) continue;
    out.push({ text, block: Number(f[2]), par: Number(f[3]), line: Number(f[4]), x: Number(f[6]), y: Number(f[7]), w: Number(f[8]), h: Number(f[9]), conf });
  }
  return out;
}
// Recognized words as text items in sheet points (the same shape a vector sheet's text gives):
// words of one line are joined, and boxes go back through the deskew and the raster scale.
// Feet and inch marks are small and often lost in a scan: "1/4" = 1-0"" is read back as
// 1/4" = 1'-0" when it follows an equals sign (the only way a scale note is written).
function ocr_fix_marks(str) {
  return String(str).replace(/(=\s*)(\d{1,3})\s*[-\u2013]\s*(\d{1,2})("|\u201d|'')?/g, (m, eq, ft, inch) => eq + ft + "'-" + inch + '"');
}
const OCR_DIM = /^[0-9'"\u2019\u201d\-\/=.:]+$/;
function ocr_text_items(words, scale, skewDeg, w, h, minConf) {
  const lines = new Map();
  const min = minConf === undefined ? 50 : minConf;
  for (const wd of words) {
    // a low-confidence word made only of digits and dimension marks (with at least one digit) is
    // kept: those are what the engine is least sure of and what a scale note needs
    if (wd.conf < min && !(wd.text.length >= 3 && /\d/.test(wd.text) && OCR_DIM.test(wd.text))) continue;
    const k = wd.block + ":" + wd.par + ":" + wd.line;
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k).push(wd);
  }
  const out = [];
  for (const ws of lines.values()) {
    ws.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const wd of ws) {
      if (cur && wd.x - (cur.x + cur.w) <= Math.max(wd.h, cur.h) * 1.2) { cur.str += " " + wd.text; cur.w = wd.x + wd.w - cur.x; cur.h = Math.max(cur.h, wd.h); cur.y1 = Math.max(cur.y1, wd.y + wd.h); }
      else { if (cur) out.push(cur); cur = { str: wd.text, x: wd.x, w: wd.w, h: wd.h, y1: wd.y + wd.h }; }
    }
    if (cur) out.push(cur);
  }
  return out.map((it) => {
    // the baseline at the left end, back from the deskewed image to the page raster
    const p = Math.abs(skewDeg || 0) >= 0.1 ? rotate_point(it.x, it.y1, w, h, -skewDeg, true) : [it.x, it.y1];
    return { str: ocr_fix_marks(it.str), x: p[0] / scale, y: p[1] / scale, w: it.w / scale, h: it.h / scale, vertical: false };
  });
}
