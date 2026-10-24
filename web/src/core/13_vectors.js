// Line work from a PDF page for snap to content. Input is a pdf.js operator list (fnArray,
// argsArray) and the pdf.js OPS code table; output is straight segments [x0, y0, x1, y1] in PDF
// user space with the current transform applied. Curves are reduced to their chord, which keeps
// their end points (the useful snap targets).
function mat_mul(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function mat_apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
function extract_segments(fnArray, argsArray, OPS, maxSegments) {
  const cap = maxSegments || 200000;
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const push = (a, b) => {
    if (out.length >= cap) return;
    if (a[0] === b[0] && a[1] === b[1]) return;
    out.push([a[0], a[1], b[0], b[1]]);
  };
  for (let i = 0; i < fnArray.length && out.length < cap; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.transform) { if (args && args.length === 6) ctm = mat_mul(ctm, args); }
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (args && Array.isArray(args[0]) && args[0].length === 6) ctm = mat_mul(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.constructPath && args) {
      if (typeof args[0] === "number") {
        // pdf.js 5: [paint op, [path data], bounds]; the data is a flat list of drawing codes
        // (0 move, 1 line, 2 cubic curve, 3 quadratic curve, 4 close) each followed by its numbers.
        const data = Array.isArray(args[1]) ? args[1][0] : null;
        if (!data) continue;
        let cur = null, start = null;
        for (let k = 0; k < data.length && out.length < cap;) {
          const op = data[k++];
          if (op === 0) { cur = mat_apply(ctm, data[k], data[k + 1]); start = cur; k += 2; }
          else if (op === 1) { const p = mat_apply(ctm, data[k], data[k + 1]); if (cur) push(cur, p); cur = p; k += 2; }
          else if (op === 2) { const p = mat_apply(ctm, data[k + 4], data[k + 5]); if (cur) push(cur, p); cur = p; k += 6; }
          else if (op === 3) { const p = mat_apply(ctm, data[k + 2], data[k + 3]); if (cur) push(cur, p); cur = p; k += 4; }
          else if (op === 4) { if (cur && start) push(cur, start); cur = start; }
          else break;
        }
        continue;
      }
      // pdf.js 3 and 4: [path ops, coordinates]
      const ops = args[0], co = args[1];
      if (!ops || !co) continue;
      let k = 0, cur = null, start = null;
      for (const op of ops) {
        if (op === OPS.moveTo) { cur = mat_apply(ctm, co[k], co[k + 1]); start = cur; k += 2; }
        else if (op === OPS.lineTo) { const p = mat_apply(ctm, co[k], co[k + 1]); if (cur) push(cur, p); cur = p; k += 2; }
        else if (op === OPS.curveTo) { const p = mat_apply(ctm, co[k + 4], co[k + 5]); if (cur) push(cur, p); cur = p; k += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { const p = mat_apply(ctm, co[k + 2], co[k + 3]); if (cur) push(cur, p); cur = p; k += 4; }
        else if (op === OPS.closePath) { if (cur && start) push(cur, start); cur = start; }
        else if (op === OPS.rectangle) {
          const x = co[k], y = co[k + 1], w = co[k + 2], h = co[k + 3];
          const a = mat_apply(ctm, x, y), b = mat_apply(ctm, x + w, y), c = mat_apply(ctm, x + w, y + h), d = mat_apply(ctm, x, y + h);
          push(a, b); push(b, c); push(c, d); push(d, a);
          cur = a; start = a; k += 4;
        }
      }
    }
  }
  return out;
}
// A uniform grid over segments so snapping only looks at the cells near the pointer.
function segment_grid(segs, cell) {
  const grid = new Map();
  const key = (i, j) => i * 100003 + j;
  segs.forEach((s, idx) => {
    const i0 = Math.floor(Math.min(s[0], s[2]) / cell), i1 = Math.floor(Math.max(s[0], s[2]) / cell);
    const j0 = Math.floor(Math.min(s[1], s[3]) / cell), j1 = Math.floor(Math.max(s[1], s[3]) / cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return; // very long lines (borders) are skipped
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let l = grid.get(k);
      if (!l) { l = []; grid.set(k, l); }
      l.push(idx);
    }
  });
  return { cell, grid, segs, near(x, y, r) {
    const out = new Set();
    for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) {
      for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); j++) {
        const l = grid.get(key(i, j));
        if (l) for (const idx of l) out.add(idx);
      }
    }
    return Array.from(out).map((idx) => segs[idx]);
  } };
}
