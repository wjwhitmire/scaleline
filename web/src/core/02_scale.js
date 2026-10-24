// Drawing scales as real inches per PDF point. Mirrors src/plantakeoff/scale.py.
const PT_PER_IN = 72;
const ARCHITECTURAL = [
  ['1/32" = 1\'-0"', 1 / 32, 12], ['1/16" = 1\'-0"', 1 / 16, 12], ['3/32" = 1\'-0"', 3 / 32, 12],
  ['1/8" = 1\'-0"', 1 / 8, 12], ['3/16" = 1\'-0"', 3 / 16, 12], ['1/4" = 1\'-0"', 1 / 4, 12],
  ['3/8" = 1\'-0"', 3 / 8, 12], ['1/2" = 1\'-0"', 1 / 2, 12], ['3/4" = 1\'-0"', 3 / 4, 12],
  ['1" = 1\'-0"', 1, 12], ['1 1/2" = 1\'-0"', 1.5, 12], ['3" = 1\'-0"', 3, 12], ['6" = 1\'-0"', 6, 12],
  ['12" = 1\'-0" (full size)', 12, 12],
];
const ENGINEERING = [5, 10, 20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 500, 600, 1000].map((n) => ['1" = ' + n + "'", 1, n * 12]);
const METRIC = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 1250, 2500, 5000].map((n) => ["1:" + n, 1, n]);
const STANDARD_SCALES = [].concat(
  ARCHITECTURAL.map(([l, p, r]) => ({ group: "Architectural", label: l, in_per_pt: r / (p * PT_PER_IN) })),
  ENGINEERING.map(([l, p, r]) => ({ group: "Engineering", label: l, in_per_pt: r / (p * PT_PER_IN) })),
  METRIC.map(([l, p, r]) => ({ group: "Metric", label: l, in_per_pt: r / (p * PT_PER_IN) })),
);

function scale_from_ratio(paper_in, real_in) {
  if (!(paper_in > 0 && real_in > 0 && Number.isFinite(paper_in) && Number.isFinite(real_in))) {
    throw new TakeoffError("scale", "Both sides of a scale must be positive numbers");
  }
  return real_in / (paper_in * PT_PER_IN);
}
function calibrate(p1, p2, real_in) {
  const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  if (!(d > 1e-6)) throw new TakeoffError("calibrate", "Pick two different points to calibrate");
  if (!(real_in > 0 && Number.isFinite(real_in))) throw new TakeoffError("calibrate", "The known distance must be greater than zero");
  return real_in / d;
}
function ratio_of(in_per_pt) { return in_per_pt * PT_PER_IN; }
function nearest_standard(in_per_pt, tolerance) {
  if (tolerance === undefined) tolerance = 0.005;
  let best = null;
  for (const s of STANDARD_SCALES) {
    const rel = Math.abs(s.in_per_pt - in_per_pt) / s.in_per_pt;
    if (rel <= tolerance && (best === null || rel < best[0])) best = [rel, s];
  }
  return best === null ? null : best[1];
}

const LEN = String.raw`(?:${NUM}\s*'\s*-?\s*(?:${MIXED}\s*(?:"|'')?)?|${MIXED}\s*(?:"|''|'|in\b|inch(?:es)?\b|ft\b|feet\b|foot\b|mm\b|cm\b|m\b)?)`;
const RE_EQ = new RegExp(String.raw`(${LEN})\s*=\s*(${LEN})`, "gi");
const RE_RATIO = /(?<![\d.:])1\s*:\s*(\d+(?:\.\d+)?)(?![\d:])/g;
const RE_NTS = /\bN\.?\s?T\.?\s?S\b\.?|\bNOT\s+TO\s+SCALE\b/gi;
const RE_HAS_UNIT = /["'a-z]/i;
const RE_SCALE_WORD = /\bscale\b/i;
const METRIC_N = new Set([1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 1250, 2500, 5000]);

function parse_scale_text(text) {
  if (typeof text !== "string") return [];
  const t = normQuotes(text.slice(0, 20000));
  const found = [];
  let m;
  RE_EQ.lastIndex = 0;
  while ((m = RE_EQ.exec(t)) !== null) {
    if (m[0].length === 0) { RE_EQ.lastIndex++; continue; }
    const left = m[1].trim(), right = m[2].trim();
    if (!(RE_HAS_UNIT.test(left) && RE_HAS_UNIT.test(right))) continue;
    let paper, real;
    try { paper = parse_length(left, "in"); real = parse_length(right, "ft"); } catch (e) { continue; }
    if (!(paper >= 0.005 && paper <= 24 && real >= paper && real / paper <= 100000)) continue;
    found.push({ start: m.index, text: m[0].trim(), in_per_pt: scale_from_ratio(paper, real) });
  }
  RE_RATIO.lastIndex = 0;
  while ((m = RE_RATIO.exec(t)) !== null) {
    const n = parseFloat(m[1]);
    const near = RE_SCALE_WORD.test(t.slice(Math.max(0, m.index - 16), m.index));
    if (n < 1 || n > 100000 || !(near || (METRIC_N.has(n) && n >= 5))) continue;
    found.push({ start: m.index, text: m[0], in_per_pt: n / PT_PER_IN });
  }
  RE_NTS.lastIndex = 0;
  while ((m = RE_NTS.exec(t)) !== null) found.push({ start: m.index, text: m[0], in_per_pt: null });
  found.sort((a, b) => a.start - b.start);
  return found;
}
