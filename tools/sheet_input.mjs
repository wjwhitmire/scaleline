// Read sheets the way the app does, for tools/autotakeoff_eval.py: pdf.js (the pinned version, from
// node_modules) gives each page's operator list and text, and the app's core turns them into the
// auto-takeoff input (line work and curves in sheet points with line widths, text items).
// For a scanned sheet the eval passes the page picture as a raw grayscale file instead; the core's
// line detection (scan_lines) finds the strokes, the same code the app runs in its worker.
//
// Usage: node tools/sheet_input.mjs vector <file.pdf> <out.json>
//        node tools/sheet_input.mjs scan <gray.raw> <width> <height> <points per pixel> <sheet w> <sheet h> <inches per point> <out.json>
//          (also writes <out.json>.mask and <out.json>.doors.json: the straightened ink mask, its lines and
//          the door swings found in it, for the Python core to repeat)
//        node tools/sheet_input.mjs takeoff <in.json> <out.json>   (the core's auto_takeoff on {pages, opts})
//        node tools/sheet_input.mjs template <gray.raw> <width> <height> <points per pixel> <x0 y0 x1 y1 in points> <out.json>
//          (pick one copy, find the rest: the area-by-example search the app runs on scans)
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { coreSource, root } from "../tests/js/load_core.mjs";

const ctx = vm.createContext({});
vm.runInContext('"use strict";\n' + coreSource + "\n;globalThis.K = { extract_paths, scan_lines, scan_page_lines, downsample, mat_apply, auto_takeoff, find_symbol, estimate_skew, rotate_gray, otsu_threshold, door_threshold, ink_mask, despeckle, detect_lines, auto_scan_door_arcs, AUTO_DEFAULTS };", ctx);
const K = ctx.K;

async function vector(file, out) {
  const pdfjs = await import(root + "/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const vp = pg.getViewport({ scale: 1 });
    const ol = await pg.getOperatorList({ intent: "display" });
    const r = K.extract_paths(ol.fnArray, ol.argsArray, pdfjs.OPS, vp.transform, 150000);
    const tc = await pg.getTextContent();
    const text = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const t = pdfjs.Util.transform(vp.transform, it.transform);
      const hgt = Math.hypot(t[2], t[3]);
      const vertical = Math.abs(t[1]) > Math.abs(t[0]);
      text.push(Object.assign({ str: it.str, x: t[4], y: t[5], w: vertical ? hgt : it.width, h: vertical ? it.width : hgt, vertical }, vertical ? { up: t[1] < 0 } : {}));
    }
    pages.push({ w: vp.width, h: vp.height, segs: Array.from(r.segs, (s) => Array.from(s)), curves: Array.from(r.curves, (c) => Array.from(c)), text });
  }
  writeFileSync(out, JSON.stringify({ pages }));
}

function scan(file, w, h, ptPerPx, sw, sh, ipp, out) {
  let gray = new Uint8Array(readFileSync(file));
  let W = w, H = h, k = ptPerPx;
  // the app works at about 2 pixels per point, capped near 12 million pixels (rasterScale)
  const target = Math.min(2.5, Math.sqrt(12e6 / (sw * sh)));
  const f = Math.max(1, Math.floor(1 / (k * target)));
  if (f > 1) { const d = K.downsample(gray, W, H, f); gray = d.g; W = d.w; H = d.h; k *= f; }
  // door radii in pixels from the sheet's scale, as the app passes them
  const doors = { r_min: K.AUTO_DEFAULTS.door_min_in / ipp / k, r_max: K.AUTO_DEFAULTS.door_max_in / ipp / k };
  const r = K.scan_lines(gray, W, H, { minLen: Math.round(12 / k), doors });
  const { segs, curves } = K.scan_page_lines(r, 1 / k);
  writeFileSync(out, JSON.stringify({ pages: [{ w: sw, h: sh, segs, curves, text: [] }], skew: r.skew, pixels: [W, H] }));
  // the same straightened mask scan_lines works on, for the Python core's door search
  let g = gray;
  if (Math.abs(r.skew) >= 0.1) g = K.rotate_gray(gray, W, H, -r.skew);
  const t = K.otsu_threshold(g);
  const lines = K.detect_lines(K.despeckle(K.ink_mask(g, t + 1), W, H, 6), W, H, { minLen: Math.round(12 / k), gap: 2 });
  const m = K.despeckle(K.ink_mask(g, K.door_threshold(t)), W, H, 6);
  const found = K.auto_scan_door_arcs(m, W, H, lines, doors);
  if (found.curves.length !== r.doors.curves.length) throw new Error("the door search differs from scan_lines");
  writeFileSync(out + ".mask", m);
  writeFileSync(out + ".doors.json", JSON.stringify({ w: W, h: H, segs: lines, opts: doors, result: found }));
}

function takeoff(file, out) {
  const inp = JSON.parse(readFileSync(file, "utf8"));
  const results = inp.pages.map((pg, i) => K.auto_takeoff(vm.runInContext("(" + JSON.stringify(pg) + ")", ctx), vm.runInContext("(" + JSON.stringify((inp.opts || [])[i] || {}) + ")", ctx)));
  writeFileSync(out, JSON.stringify({ results }));
}

function template(file, w, h, ptPerPx, box, out) {
  let gray = new Uint8Array(readFileSync(file));
  let W = w, H = h, k = ptPerPx;
  const f = Math.max(1, Math.floor(0.5 / k)); // about 2 pixels per point, like the app
  if (f > 1) { const d = K.downsample(gray, W, H, f); gray = d.g; W = d.w; H = d.h; k *= f; }
  const x0 = Math.round(box[0] / k), y0 = Math.round(box[1] / k), x1 = Math.round(box[2] / k), y1 = Math.round(box[3] / k);
  const tw = x1 - x0, th = y1 - y0, tpl = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) tpl[y * tw + x] = gray[(y0 + y) * W + x0 + x];
  const hits = K.find_symbol(gray, W, H, tpl, tw, th, { threshold: 0.7, mirror: true });
  writeFileSync(out, JSON.stringify({ hits: hits.map((q) => [(q.x + q.w / 2) * k, (q.y + q.h / 2) * k, q.score]) }));
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "vector") await vector(rest[0], rest[1]);
else if (mode === "scan") scan(rest[0], Number(rest[1]), Number(rest[2]), Number(rest[3]), Number(rest[4]), Number(rest[5]), Number(rest[6]), rest[7]);
else if (mode === "takeoff") takeoff(rest[0], rest[1]);
else if (mode === "template") template(rest[0], Number(rest[1]), Number(rest[2]), Number(rest[3]), rest.slice(4, 8).map(Number), rest[8]);
else { console.error("usage: sheet_input.mjs vector|scan ..."); process.exit(2); }
