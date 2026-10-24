// Area by click: the traced outline moved to the wall's inside face, centerline or outside face,
// on synthetic antialiased rasters with known geometry (fractional pixel positions on purpose).
import test from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load_core.mjs";

const C = loadCore();
const plain = (v) => JSON.parse(JSON.stringify(v));

// A gray picture where ink(x, y) says whether a point of paper is ink; 8 x 8 samples a pixel.
function raster(w, h, ink) {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) if (ink(x + (i + 0.5) / 8, y + (j + 0.5) / 8)) n++;
    g[y * w + x] = Math.round(255 * (1 - n / 64));
  }
  return g;
}
const inRect = (x, y, r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
const grow = (r, d) => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
const areaOf = (res) => Math.abs(C.signed_area(res.outer)) - res.holes.reduce((s, hl) => s + Math.abs(C.signed_area(hl)), 0);
const W = 220, H = 190, ROOM = [40.3, 50.6, 160.7, 130.2];
const rw = ROOM[2] - ROOM[0], rh = ROOM[3] - ROOM[1];
const OPTS = { threshold: 170, gap: 0, maxWall: 20, maxGap: 6, minHole: 20 };

test("one thick wall line: inside face, centerline and outside face", () => {
  const T = 5.5;
  const g = raster(W, H, (x, y) => inRect(x, y, grow(ROOM, T)) && !inRect(x, y, ROOM));
  const plain = C.detect_room(g, W, H, 100, 90, OPTS);
  const want = { inside: rw * rh, center: (rw + T) * (rh + T), outside: (rw + 2 * T) * (rh + 2 * T) };
  // without the boundary step the outline sits inside the ink: smaller than the inside face
  assert.ok(areaOf(plain) < want.inside * 0.999, "the raw trace is " + areaOf(plain) + ", the inside face " + want.inside);
  for (const mode of C.ROOM_BOUNDARIES) {
    const r = C.detect_room(g, W, H, 100, 90, Object.assign({ boundary: mode }, OPTS));
    assert.equal(r.boundary, mode);
    assert.ok(Math.abs(areaOf(r) / want[mode] - 1) < 0.002, mode + ": " + areaOf(r) + " vs " + want[mode]);
    assert.ok(Math.abs(r.faces.thickness - T) < 0.15, "wall " + r.faces.thickness);
  }
});

test("a wall drawn as two lines counts as one wall; a line farther out does not", () => {
  const L = 1.25, gap = 3.5, T = 2 * L + gap;
  const dim = 14; // a dimension line well outside the wall
  const g = raster(W, H, (x, y) => (inRect(x, y, grow(ROOM, L)) && !inRect(x, y, ROOM)) ||
    (inRect(x, y, grow(ROOM, T)) && !inRect(x, y, grow(ROOM, L + gap))) || (inRect(x, y, grow(ROOM, dim + 1)) && !inRect(x, y, grow(ROOM, dim))));
  const c = C.detect_room(g, W, H, 100, 90, Object.assign({ boundary: "center" }, OPTS));
  assert.ok(Math.abs(areaOf(c) / ((rw + T) * (rh + T)) - 1) < 0.004, "center " + areaOf(c));
  const o = C.detect_room(g, W, H, 100, 90, Object.assign({ boundary: "outside" }, OPTS));
  assert.ok(Math.abs(areaOf(o) / ((rw + 2 * T) * (rh + 2 * T)) - 1) < 0.004, "outside " + areaOf(o));
});

test("a column stays at its face and a doorway takes the other walls' thickness", () => {
  const T = 4.25, COL = [70.4, 70.2, 82.9, 82.7];
  const door = [ROOM[0] + 30, ROOM[3] - 1, ROOM[0] + 42, ROOM[3] + T + 1];
  const g = raster(W, H, (x, y) => ((inRect(x, y, grow(ROOM, T)) && !inRect(x, y, ROOM)) && !inRect(x, y, door)) || inRect(x, y, COL));
  const r = C.detect_room(g, W, H, 120, 90, Object.assign({}, OPTS, { boundary: "outside", gap: 7 }));
  assert.ok(r.ok && r.holes.length === 1);
  const col = (COL[2] - COL[0]) * (COL[3] - COL[1]);
  assert.ok(Math.abs(Math.abs(C.signed_area(r.holes[0])) / col - 1) < 0.01, "column " + Math.abs(C.signed_area(r.holes[0])));
  const want = (rw + 2 * T) * (rh + 2 * T) - col;
  assert.ok(Math.abs(areaOf(r) / want - 1) < 0.004, "outside with a doorway " + areaOf(r) + " vs " + want);
});

test("offset_loop moves each edge by its own distance", () => {
  // clockwise on screen (y down): outward is to the left of each edge
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(plain(C.offset_loop(sq, [1, 1, 1, 1])).map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)), [[-1, -1], [11, -1], [11, 11], [-1, 11]]);
  assert.deepEqual(plain(C.offset_loop(sq, [0, 2, 0, 0])).map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)), [[0, 0], [12, 0], [12, 10], [0, 10]]);
});
