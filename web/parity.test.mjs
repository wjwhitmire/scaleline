// Parity check: load the browser core (web/src/core/*.js, joined in name order) in node:vm and
// replay every case in tests/vectors.json, written by the Python library. Numbers must agree to
// 1e-9 relative (1e-12 absolute near zero); text, keys and error codes must agree exactly.
// Usage: python tests/make_vectors.py && node web/parity.test.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { coreSource, root } from "../tests/js/load_core.mjs";

if (/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|document|window|localStorage|indexedDB|eval)\b\s*[.(]/.test(coreSource) || /new Function/.test(coreSource)) {
  console.error("FAIL: the core must not touch the network, the DOM, storage or eval");
  process.exit(1);
}
const ctx = vm.createContext({});
vm.runInContext('"use strict";\n' + coreSource + "\n;globalThis.CORE = CORE;", ctx, { filename: "core.js" });
const C = ctx.CORE;
const V = JSON.parse(readFileSync(join(root, "tests", "vectors.json"), "utf8"));

const ADAPT = {
  nearest_label: (ipp) => { const s = C.nearest_standard(ipp); return s === null ? null : s.label; },
  rows_of: (doc) => C.markup_rows(C.clean_document(doc)[0]),
  csv_of: (doc, g) => { const d = C.clean_document(doc)[0]; return C.markup_list_csv(C.markup_rows(d), d.columns, g); },
  estimate_of: (doc) => C.document_estimate(C.clean_document(doc)[0]),
  // a scan mask passed as run lengths (zeros first), as tests/auto_vectors.py writes it
  auto_scan_door_arcs_rle: (runs, w, h, segs, opts) => {
    const n = String(runs).split(",").map(Number), m = new Uint8Array(n.reduce((a, b) => a + b, 0));
    let at = 0;
    n.forEach((k, i) => { if (i % 2) m.fill(1, at, at + k); at += k; });
    return C.auto_scan_door_arcs(m, w, h, segs, opts);
  },
};
let checks = 0;
const failures = [];
const fail = (m) => { if (failures.length < 40) failures.push(m); else failures.length++; };
function close(a, b) { return a === b || Math.abs(a - b) <= Math.max(1e-12, 1e-9 * Math.max(Math.abs(a), Math.abs(b))); }
function compare(got, want, path) {
  checks++;
  if (typeof want === "number") { if (typeof got !== "number" || !close(got, want)) fail(`${path}: got ${got}, want ${want}`); return; }
  if (want === null || typeof want !== "object") { if (got !== want) fail(`${path}: got ${JSON.stringify(got)?.slice(0, 200)}, want ${JSON.stringify(want)?.slice(0, 200)}`); return; }
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) { fail(`${path}: length got ${got && got.length}, want ${want.length}`); return; }
    want.forEach((w, i) => compare(got[i], w, `${path}[${i}]`));
    return;
  }
  if (got === null || typeof got !== "object") { fail(`${path}: want an object, got ${JSON.stringify(got)?.slice(0, 80)}`); return; }
  const gk = Object.keys(got).sort().join(","), wk = Object.keys(want).sort().join(",");
  if (gk !== wk) fail(`${path}: keys differ\n  got  ${gk}\n  want ${wk}`);
  for (const k of Object.keys(want)) compare(got[k], want[k], `${path}.${k}`);
}
const inRealm = (x) => vm.runInContext("(" + JSON.stringify(x) + ")", ctx);
const counts = {};
V.cases.forEach((c, i) => {
  counts[c.fn] = (counts[c.fn] || 0) + 1;
  const fn = ADAPT[c.fn] || C[c.fn];
  if (typeof fn !== "function") { fail(`case ${i}: no function ${c.fn}`); return; }
  let got, err = null;
  try { got = fn(...inRealm(c.args)); } catch (e) { err = e; }
  const where = `case ${i} ${c.fn}(${JSON.stringify(c.args).slice(0, 80)})`;
  if ("error" in c) {
    checks++;
    if (!err) fail(`${where}: expected error ${c.error}, got ${JSON.stringify(got)?.slice(0, 120)}`);
    else if (err.code !== c.error) fail(`${where}: error ${err.code || err.message}, want ${c.error}`);
    return;
  }
  if (err) { fail(`${where}: threw ${err.code || ""} ${err.message}`); return; }
  compare(JSON.parse(JSON.stringify(got)), c.out, where);
});
if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`FAIL: ${failures.length} mismatches in ${checks} checks`);
  process.exit(1);
}
console.log(`parity ok: ${V.cases.length} cases, ${checks} checks across ${Object.keys(counts).length} functions`);
