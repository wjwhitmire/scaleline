// Tests for the browser-only parts of the core: room fill, symbol search, compare, title block
// reading, carry forward and undo history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load_core.mjs";

const C = loadCore();
// Values from the core live in another realm; compare them as plain JSON.
const plain = (x) => JSON.parse(JSON.stringify(x));

// A white canvas with drawing helpers (gray values, 255 = paper, 0 = ink).
function canvas(w, h) {
  const g = new Uint8Array(w * h).fill(255);
  const put = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) g[y * w + x] = 0; };
  const rect = (x0, y0, x1, y1, t = 1) => {
    for (let k = 0; k < t; k++) {
      for (let x = x0; x <= x1; x++) { put(x, y0 + k); put(x, y1 - k); }
      for (let y = y0; y <= y1; y++) { put(x0 + k, y); put(x1 - k, y); }
    }
  };
  const fill = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y); };
  const line = (x0, y0, x1, y1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) put(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n));
  };
  return { g, w, h, put, rect, fill, line };
}

test("room fill: a closed room gives its interior area exactly", () => {
  const c = canvas(200, 150);
  c.rect(20, 20, 179, 129, 3); // walls 3 px thick; interior 23..176 x 23..126
  const r = C.detect_room(c.g, c.w, c.h, 100, 70, {});
  assert.equal(r.ok, true);
  const inner = (176 - 23 + 1) * (126 - 23 + 1);
  assert.equal(r.pixels, inner);
  assert.equal(Math.abs(C.signed_area(r.outer)), inner);
  assert.equal(r.outer.length, 4);
  assert.deepEqual(plain(r.holes), []);
});

test("room fill: a column inside the room comes back as a hole", () => {
  const c = canvas(200, 150);
  c.rect(20, 20, 179, 129, 2);
  c.fill(90, 60, 99, 69); // 10 x 10 column
  const r = C.detect_room(c.g, c.w, c.h, 40, 40, {});
  assert.equal(r.ok, true);
  assert.equal(r.holes.length, 1);
  assert.equal(Math.abs(C.signed_area(r.holes[0])), 100);
  const net = Math.abs(C.signed_area(r.outer)) - 100;
  assert.equal(net, r.pixels);
});

test("room fill: an opening leaks to the sheet edge unless gaps are closed", () => {
  const c = canvas(200, 150);
  c.rect(20, 20, 179, 129, 2);
  for (let y = 70; y < 76; y++) { c.g[y * 200 + 20] = 255; c.g[y * 200 + 21] = 255; } // 6 px door gap
  assert.equal(C.detect_room(c.g, c.w, c.h, 100, 70, {}).reason, "leaks");
  const r = C.detect_room(c.g, c.w, c.h, 100, 70, { gap: 4 });
  assert.equal(r.ok, true);
  const inner = (177 - 22 + 1) * (127 - 22 + 1);
  assert.ok(Math.abs(r.pixels - inner) / inner < 0.01, `${r.pixels} vs ${inner}`);
});

test("room fill: clicking on ink or outside is refused", () => {
  const c = canvas(50, 50);
  c.rect(5, 5, 44, 44, 1);
  assert.equal(C.detect_room(c.g, 50, 50, 5, 5, {}).reason, "on_ink");
  assert.equal(C.detect_room(c.g, 50, 50, -1, 5, {}).reason, "outside");
});

test("room fill: an L-shaped room traces to six corners", () => {
  const c = canvas(120, 120);
  // outline of an L as 1 px lines
  c.line(10, 10, 100, 10); c.line(100, 10, 100, 50); c.line(100, 50, 50, 50);
  c.line(50, 50, 50, 100); c.line(50, 100, 10, 100); c.line(10, 100, 10, 10);
  const r = C.detect_room(c.g, 120, 120, 20, 20, {});
  assert.equal(r.ok, true);
  assert.equal(r.outer.length, 6);
  assert.equal(Math.abs(C.signed_area(r.outer)), r.pixels);
});

function symbol(c, x, y, rot) {
  // A door-like mark: a 12 px leaf plus a quarter arc, rotated by multiples of 90 degrees.
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push([0, i]);
  for (let a = 0; a <= 90; a += 3) pts.push([Math.round(12 * Math.sin(a * Math.PI / 180)), Math.round(12 * Math.cos(a * Math.PI / 180))]);
  for (let i = 0; i < 6; i++) pts.push([i + 3, 3]);
  for (const [px, py] of pts) {
    let qx = px, qy = py;
    for (let r = 0; r < rot; r++) [qx, qy] = [12 - qy, qx];
    c.put(x + qx, y + qy);
  }
}

test("symbol search finds every copy, including rotated ones, and nothing else", () => {
  const c = canvas(300, 200);
  const spots = [[20, 20, 0], [100, 30, 0], [200, 150, 0], [60, 120, 1], [240, 40, 2]];
  for (const [x, y, r] of spots) symbol(c, x, y, r);
  c.rect(150, 80, 190, 120, 1); // a different shape
  const tpl = new Uint8Array(15 * 15);
  for (let j = 0; j < 15; j++) for (let i = 0; i < 15; i++) tpl[j * 15 + i] = c.g[(19 + j) * 300 + 19 + i];
  const hits = C.find_symbol(c.g, 300, 200, tpl, 15, 15, { threshold: 0.8, rotations: true });
  assert.equal(hits.length, spots.length, JSON.stringify(hits.map((h) => [h.x, h.y, h.score.toFixed(2)])));
  for (const [x, y] of spots) assert.ok(hits.some((h) => Math.abs(h.x + 1 - x) <= 2 && Math.abs(h.y + 1 - y) <= 2), `missing ${x},${y}`);
  const upright = C.find_symbol(c.g, 300, 200, tpl, 15, 15, { threshold: 0.8, rotations: false });
  assert.equal(upright.length, 3);
});

test("symbol search ignores a blank template", () => {
  const c = canvas(100, 100);
  assert.deepEqual(plain(C.find_symbol(c.g, 100, 100, new Uint8Array(100).fill(255), 10, 10, {})), []);
});

test("compare: shift is found and the change is boxed", () => {
  const a = canvas(240, 160), b = canvas(240, 160);
  a.rect(20, 20, 200, 140, 2); a.line(100, 20, 100, 140);
  // revision: same drawing moved by (5, -3) with a new wall added
  b.rect(25, 17, 205, 137, 2); b.line(105, 17, 105, 137); b.line(150, 17, 150, 80);
  const s = C.best_shift(a.g, b.g, 240, 160, 20);
  assert.deepEqual([s.dx, s.dy], [5, -3]);
  const d = C.diff_masks(a.g, b.g, 240, 160, s.dx, s.dy, 1);
  assert.equal(d.nRemoved, 0);
  const boxes = C.change_boxes(d.added, 240, 160, 4, 5);
  assert.equal(boxes.length, 1);
  const [x0, y0, x1, y1] = boxes[0];
  assert.ok(x0 <= 145 && x1 >= 146 && y0 <= 20 && y1 >= 77, JSON.stringify(boxes[0]));
});

test("compare: identical sheets have no changes", () => {
  const a = canvas(100, 100);
  a.rect(10, 10, 90, 90, 1);
  const d = C.diff_masks(a.g, a.g, 100, 100, 0, 0, 1);
  assert.equal(d.nAdded + d.nRemoved, 0);
  assert.deepEqual(plain(C.change_boxes(d.added, 100, 100)), []);
});

test("carry forward moves markups and flags the ones in changed areas", () => {
  let n = 0;
  const ms = [
    { id: "a", type: "area", page: 0, points: [[0, 0], [10, 0], [10, 10]], label: "Room" },
    { id: "b", type: "count", page: 0, points: [[100, 100]] },
  ];
  const r = C.carry_forward(ms, 3, [5, -3], [[100, 90, 120, 110]], () => "n" + (++n), "2026-10-22");
  assert.equal(r.flagged, 1);
  assert.deepEqual(plain(r.markups[0].points), [[5, -3], [15, -3], [15, 7]]);
  assert.equal(r.markups[0].page, 3);
  assert.equal(r.markups[0].status, undefined);
  assert.equal(r.markups[1].status, "Review");
  assert.equal(r.markups[1].id, "n2");
  assert.equal(ms[1].points[0][0], 100, "original untouched");
});

test("a change only flags markups it actually touches", () => {
  const count = { id: "c", type: "count", page: 0, points: [[0, 0], [100, 100]] };
  assert.equal(C.markup_touches_box(count, [40, 40, 60, 60]), false, "inside the bounding box but away from every point");
  assert.equal(C.markup_touches_box(count, [95, 95, 105, 105]), true);
  const room = { id: "r", type: "area", page: 0, points: [[0, 0], [100, 0], [100, 100], [0, 100]] };
  assert.equal(C.markup_touches_box(room, [40, 40, 60, 60]), true, "inside the room");
  assert.equal(C.markup_touches_box(room, [-10, 40, 5, 60]), true, "across an edge");
  assert.equal(C.markup_touches_box(room, [120, 40, 130, 60]), false);
  const line = { id: "l", type: "length", page: 0, points: [[0, 0], [100, 100]] };
  assert.equal(C.markup_touches_box(line, [60, 10, 90, 40]), false, "beside the line");
  assert.equal(C.markup_touches_box(line, [45, 45, 55, 55]), true);
});

test("title block: sheet number, title and scale with reasons", () => {
  const W = 36 * 72, H = 24 * 72;
  const items = [
    { str: "FIRST FLOOR PLAN", x: 200, y: 1600, w: 300, h: 18 },
    { str: 'SCALE: 1/4" = 1\'-0"', x: 200, y: 1625, w: 200, h: 10 },
    { str: "EXAMPLE DATA", x: 2300, y: 1450, w: 150, h: 10 },
    { str: "SHEET TITLE", x: 2300, y: 1520, w: 80, h: 7 },
    { str: "FLOOR PLAN", x: 2300, y: 1545, w: 200, h: 20 },
    { str: "SCALE", x: 2300, y: 1570, w: 40, h: 7 },
    { str: '1/4" = 1\'-0"', x: 2300, y: 1585, w: 100, h: 10 },
    { str: "SHEET", x: 2500, y: 1600, w: 40, h: 7 },
    { str: "A-101", x: 2500, y: 1660, w: 120, h: 36 },
    { str: "DATE 2026-10-01", x: 2300, y: 1660, w: 100, h: 8 },
  ];
  const r = C.read_title_block(items, W, H);
  assert.equal(r.sheet_number, "A-101");
  assert.equal(r.sheet_title, "FLOOR PLAN");
  assert.ok(Math.abs(C.ratio_of(r.scale.in_per_pt) - 48) < 1e-9);
  assert.equal(r.scale.multiple, false);
  assert.equal(r.reduced_warning, false);
  assert.ok(r.why.length >= 3);
});

test("title block: labeled sheet number, multiple scales, reduced sheet warning", () => {
  const W = 17 * 72, H = 11 * 72;
  const items = [
    { str: "SHEET NO: S-201", x: 1000, y: 760, w: 150, h: 12 },
    { str: "FOUNDATION DETAILS", x: 1000, y: 700, w: 150, h: 14 },
    { str: 'DETAIL 1  SCALE: 1 1/2" = 1\'-0"', x: 50, y: 300, w: 200, h: 8 },
    { str: 'SCALE: 1/8" = 1\'-0"', x: 1000, y: 730, w: 100, h: 8 },
  ];
  const r = C.read_title_block(items, W, H);
  assert.equal(r.sheet_number, "S-201");
  assert.equal(r.sheet_title, "FOUNDATION DETAILS");
  assert.equal(r.scale.multiple, true);
  assert.ok(Math.abs(C.ratio_of(r.scale.in_per_pt) - 96) < 1e-9, "prefers the title block scale");
  assert.equal(r.reduced_warning, true);
});

test("title block: a sheet turned a quarter is read in the turned frame, either way round", () => {
  // the sheet as drawn (landscape, 36 x 24 in), then shown turned a quarter (portrait), its text vertical
  const FW = 2592, FH = 1728;
  const flat = [
    { str: "SHEET TITLE", x: 2300, y: 1520, w: 80, h: 7 },
    { str: "FLOOR PLAN", x: 2300, y: 1545, w: 200, h: 20 },
    { str: 'SCALE: 1/4" = 1\'-0"', x: 2300, y: 1585, w: 140, h: 10 },
    { str: "A-101", x: 2500, y: 1660, w: 120, h: 36 },
    { str: "D2", x: 600, y: 700, w: 20, h: 9 },
    { str: "BEDROOM", x: 500, y: 600, w: 60, h: 9 },
  ];
  const W = FH, H = FW;
  const up = flat.map((i) => ({ str: i.str, x: i.y, y: H - i.x, w: i.h, h: i.w, vertical: true, up: true }));
  const down = flat.map((i) => ({ str: i.str, x: W - i.y, y: i.x, w: i.h, h: i.w, vertical: true, up: false }));
  // a door tag set level on the turned sheet, as CAD often leaves tags
  const level = [{ str: "D2", x: 700, y: 900, w: 20, h: 9 }];
  for (const items of [up, down, up.map((i) => Object.assign({}, i, { up: undefined })), down.map((i) => Object.assign({}, i, { up: undefined }))]) {
    const r = C.read_title_block(items.concat(level), W, H);
    assert.equal(r.sheet_number, "A-101");
    assert.equal(r.sheet_title, "FLOOR PLAN");
    assert.ok(Math.abs(C.ratio_of(r.scale.in_per_pt) - 48) < 1e-9);
    assert.match(r.why[0], /turned a quarter/);
  }
});

test("title block: nothing found on an empty page", () => {
  const r = C.read_title_block([], 612, 792);
  assert.equal(r.sheet_number, "");
  assert.equal(r.scale, null);
});

test("text lines join split items", () => {
  const lines = C.text_lines([{ str: "SCALE:", x: 0, y: 100, w: 30, h: 8 }, { str: '1/4"', x: 33, y: 100, w: 15, h: 8 }, { str: "= 1'-0\"", x: 50, y: 100.5, w: 25, h: 8 }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].str, "SCALE: 1/4\" = 1'-0\"");
});

test("history: undo, redo, and a new edit clears redo", () => {
  let h = C.history_new({ n: 0 });
  h = C.history_commit(h, { n: 1 }, "one");
  h = C.history_commit(h, { n: 2 }, "two");
  h = C.history_undo(h);
  assert.equal(h.present.n, 1);
  assert.equal(h.lastLabel, "two");
  h = C.history_redo(h);
  assert.equal(h.present.n, 2);
  h = C.history_undo(h);
  h = C.history_commit(h, { n: 9 }, "nine");
  assert.equal(h.future.length, 0);
  assert.equal(C.history_redo(h).present.n, 9);
  let big = C.history_new(0);
  for (let i = 1; i <= 400; i++) big = C.history_commit(big, i, "x");
  assert.equal(big.past.length, 300);
});

test("assemblies apply by preset first, then layer", () => {
  const layer = { id: "walls", assembly: "int-partition" };
  assert.deepEqual(plain(C.resolve_assembly("polylength", { assembly: "ext-wall" }, layer)), { assembly: "ext-wall", source: "preset" });
  assert.deepEqual(plain(C.resolve_assembly("polylength", {}, layer)), { assembly: "int-partition", source: "layer" });
  assert.equal(C.resolve_assembly("cloud", { assembly: "x" }, layer), null);
  assert.equal(C.resolve_assembly("area", null, { id: "x" }), null);
});

test("default presets and assemblies are valid", () => {
  const [doc, report] = C.clean_document({ format: C.FILE_FORMAT, version: 1, layers: C.DEFAULT_LAYERS, assemblies: C.DEFAULT_ASSEMBLIES });
  assert.equal(report.layers_dropped + report.assemblies_dropped, 0);
  assert.equal(doc.assemblies.length, C.DEFAULT_ASSEMBLIES.length);
  const ids = new Set(C.DEFAULT_ASSEMBLIES.map((a) => a.id));
  for (const p of C.DEFAULT_PRESETS) {
    if (p.assembly) assert.ok(ids.has(p.assembly), p.id);
    assert.ok(C.MARKUP_TYPES.includes(p.tool), p.tool);
    assert.ok(C.PENCILS.includes(p.pencil) && !("color" in p), p.id);
    if (p.tool === "count") assert.ok(C.GLYPHS.includes(p.glyph), p.id);
  }
  for (const l of C.DEFAULT_LAYERS) if (l.assembly) assert.ok(ids.has(l.assembly));
});

test("line work: pdf.js 5 path data and the older operator format give the same segments", () => {
  const OPS = { save: 10, restore: 11, transform: 12, constructPath: 91, moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };
  // a 10 x 5 rectangle and a line drawn under a 2x scale
  const v5 = C.extract_segments([OPS.transform, OPS.constructPath, OPS.constructPath], [[2, 0, 0, 2, 0, 0],
    [20, [new Float32Array([0, 0, 0, 1, 10, 0, 1, 10, 5, 1, 0, 5, 4])], null], [20, [new Float32Array([0, 1, 1, 2, 2, 2, 3, 3, 4, 4])], null]], OPS);
  const v3 = C.extract_segments([OPS.transform, OPS.constructPath, OPS.constructPath], [[2, 0, 0, 2, 0, 0],
    [[OPS.rectangle], [0, 0, 10, 5]], [[OPS.moveTo, OPS.curveTo], [1, 1, 2, 2, 3, 3, 4, 4]]], OPS);
  assert.deepEqual(plain(v5), [[0, 0, 20, 0], [20, 0, 20, 10], [20, 10, 0, 10], [0, 10, 0, 0], [2, 2, 8, 8]]);
  assert.deepEqual(plain(v3), plain(v5));
  // empty path data and unknown codes stop cleanly
  assert.deepEqual(plain(C.extract_segments([OPS.constructPath], [[20, [null], null]], OPS)), []);
  assert.deepEqual(plain(C.extract_segments([OPS.constructPath], [[20, [new Float32Array([9, 1, 2])], null]], OPS)), []);
});

test("no two core files declare the same top-level name (a later one would silently replace the first)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { root } = await import("./load_core.mjs");
  const dir = join(root, "web", "src", "core");
  const seen = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js")).sort()) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/^(?:function|const|let|class) ([A-Za-z_$][\w$]*)/gm)) {
      assert.ok(!seen.has(m[1]), m[1] + " in " + f + " and " + seen.get(m[1]));
      seen.set(m[1], f);
    }
  }
});
