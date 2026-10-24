// Title block reading: sheet number, sheet title and scale notes from the text on a page.
// Input items are {str, x, y, w, h} in sheet points with the origin at the top left, y at the
// text baseline and h the font height. Everything here is a suggestion with a reason; the
// person applies it.
const RE_SHEET_NO = /^(?:[A-Z]{1,3}[-. ]?\d{1,3}(?:\.\d{1,3})?[A-Z]?)$/;
const RE_SHEET_IN = /\b(?:SHEET|DWG|DRAWING)\s*(?:NO\.?|NUMBER|#)?\s*:?\s*([A-Z]{1,3}[-. ]?\d{1,3}(?:\.\d{1,3})?[A-Z]?)\b/i;
const TITLE_STOP = /\b(SCALE|DATE|SHEET|DRAWN|CHECKED|PROJECT|REV|REVISION|JOB|NO\.|NUMBER|APPROVED|ISSUE|SEAL|PHONE|FAX|COPYRIGHT|PLOT|FILE|EXAMPLE DATA)\b/i;
const RE_TITLE_LABEL = /^(SHEET|DRAWING)\s+TITLE\s*:?\s*/i;

function clean_items(items) {
  const out = [];
  for (const it of items || []) {
    if (!it || typeof it.str !== "string") continue;
    const s = it.str.replace(/\s+/g, " ").trim();
    if (!s || s.length > 300) continue;
    const nums = [it.x, it.y, it.w, it.h].map(Number);
    if (!nums.every(Number.isFinite)) continue;
    out.push({ str: s, x: nums[0], y: nums[1], w: Math.max(0, nums[2]), h: Math.max(0, nums[3]) });
  }
  return out;
}
// Group items into lines (similar baseline, ordered left to right).
function text_lines(items) {
  const its = clean_items(items).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const tol = Math.max(1.5, it.h * 0.4);
    let line = lines.find((l) => Math.abs(l.y - it.y) <= tol && it.x >= l.x1 - it.h * 0.5 && it.x - l.x1 < Math.min(it.h, l.h) * 2.5);
    if (!line) { line = { y: it.y, x0: it.x, x1: it.x + it.w, h: it.h, parts: [] }; lines.push(line); }
    line.parts.push(it);
    line.x1 = Math.max(line.x1, it.x + it.w);
    line.x0 = Math.min(line.x0, it.x);
    line.h = Math.max(line.h, it.h);
  }
  return lines.map((l) => {
    l.parts.sort((a, b) => a.x - b.x);
    let s = "";
    let lastEnd = null;
    for (const p of l.parts) {
      if (lastEnd !== null && p.x - lastEnd > p.h * 0.15) s += " ";
      s += p.str;
      lastEnd = p.x + p.w;
    }
    return { str: s.replace(/\s+/g, " ").trim(), x: l.x0, y: l.y, w: l.x1 - l.x0, h: l.h };
  });
}
function in_title_zone(it, W, H) {
  // Title blocks sit along the right edge or the bottom edge of a sheet.
  return it.x + it.w >= W * 0.62 && it.y >= H * 0.45 || it.y >= H * 0.82;
}
// A sheet drawn turned a quarter (most of its text runs up or down the page, as on a sheet saved
// with /Rotate 90) is read in the turned frame: its vertical text becomes horizontal there. Items
// that say which way they run (up: true or false) are turned that way; otherwise both turns are
// read and the one with the stronger sheet number is kept.
function read_title_block(items, W, H) {
  const its = Array.isArray(items) ? items.filter((i) => i && typeof i === "object") : [];
  const vert = its.filter((i) => i.vertical === true);
  if (vert.length > its.length - vert.length) {
    const turn = (up) => vert.filter((i) => i.up === undefined || i.up === up).map((i) => (up
      ? { str: i.str, x: H - Number(i.y), y: Number(i.x), w: Number(i.h), h: Number(i.w) }
      : { str: i.str, x: Number(i.y), y: W - Number(i.x), w: Number(i.h), h: Number(i.w) }));
    const reads = [read_flat(turn(true), H, W), read_flat(turn(false), H, W)];
    const best = reads[1].score > reads[0].score ? reads[1] : reads[0];
    if (best.score > 0) {
      best.out.why.unshift("most of the sheet's text runs up or down the page, so it is read turned a quarter");
      return best.out;
    }
  }
  return read_flat(its, W, H).out;
}
function read_flat(items, W, H) {
  const lines = text_lines(items);
  const why = [];
  // Sheet number: an isolated code like A-101, scored by place and size.
  let best = null;
  for (const l of lines) {
    let code = null, labeled = false;
    if (RE_SHEET_NO.test(l.str)) code = l.str;
    else {
      const m = RE_SHEET_IN.exec(l.str);
      if (m) { code = m[1]; labeled = true; }
    }
    if (!code) continue;
    let score = l.h;
    if (in_title_zone(l, W, H)) score *= 3;
    if (l.x > W * 0.8 && l.y > H * 0.8) score *= 2;
    if (labeled) score *= 1.5;
    if (!best || score > best.score) best = { code: code.toUpperCase(), line: l, score };
  }
  let title = null;
  if (best) {
    why.push("sheet number \"" + best.code + "\" is the largest sheet code in the title block area");
    // Title: an explicit SHEET TITLE label, else the largest wordy line near the sheet number.
    const near = lines.filter((l) => l !== best.line && in_title_zone(l, W, H) && Math.abs(l.x - best.line.x) < W * 0.4);
    for (const l of near) {
      if (RE_TITLE_LABEL.test(l.str) && l.str.replace(RE_TITLE_LABEL, "").length >= 3) {
        title = { text: l.str.replace(RE_TITLE_LABEL, ""), line: l, score: Infinity };
      }
    }
    if (!title) {
      for (const l of near) {
        const letters = (l.str.match(/[A-Za-z]/g) || []).length;
        const digits = (l.str.match(/\d/g) || []).length;
        if (letters < 4 || digits > letters || TITLE_STOP.test(l.str) || RE_SHEET_NO.test(l.str)) continue;
        if (parse_scale_text(l.str).length) continue;
        const dy = Math.abs(l.y - best.line.y);
        const score = l.h * 10 - dy * 0.05 + (l.str === l.str.toUpperCase() ? 2 : 0);
        if (!title || score > title.score) title = { text: l.str, line: l, score };
      }
    }
    if (title) why.push("title \"" + title.text + "\" is the largest text line beside the sheet number");
  }
  // Scale notes: each line, and each line joined with the next (labels are often split).
  const scales = [];
  lines.forEach((l, i) => {
    for (const f of parse_scale_text(l.str)) {
      const label = /\bscale\b/i.test(l.str) || (i > 0 && /\bscale\s*:?\s*$/i.test(lines[i - 1].str));
      scales.push({ in_per_pt: f.in_per_pt, text: f.text, line: l.str, labeled: label, title_zone: in_title_zone(l, W, H), x: l.x, y: l.y });
    }
  });
  let scale = null;
  const usable = scales.filter((s) => s.in_per_pt !== null);
  const distinct = [];
  for (const s of usable) if (!distinct.some((d) => Math.abs(d.in_per_pt - s.in_per_pt) / d.in_per_pt < 1e-9)) distinct.push(s);
  const rank = (s) => (s.labeled ? 2 : 0) + (s.title_zone ? 1 : 0);
  if (distinct.length) {
    const pick = distinct.slice().sort((a, b) => rank(b) - rank(a))[0];
    scale = { in_per_pt: pick.in_per_pt, text: pick.text, multiple: distinct.length > 1 };
    why.push("scale note \"" + pick.text + "\"" + (pick.labeled ? " labeled SCALE" : "") + (pick.title_zone ? " in the title block" : "") +
      (distinct.length > 1 ? "; the sheet has " + distinct.length + " different scales, so check views drawn at another scale" : ""));
  } else if (scales.length) {
    why.push("the sheet is marked not to scale");
  }
  // A plan set printed smaller than its sheet size makes every printed scale wrong.
  const wIn = W / 72, hIn = H / 72;
  const long = Math.max(wIn, hIn), short = Math.min(wIn, hIn);
  const reduced = scale !== null && long <= 17.5 && short <= 11.5;
  if (reduced) why.push("the page is " + format_number(long, 1) + " x " + format_number(short, 1) + " in; if this set was reduced from a larger sheet the printed scale is wrong, so check against a known dimension");
  return { score: best ? best.score : 0, out: {
    sheet_number: best ? best.code : "",
    sheet_title: title ? title.text : "",
    scale,
    scales: scales.map((s) => ({ in_per_pt: s.in_per_pt, text: s.text, labeled: s.labeled, title_zone: s.title_zone })),
    page_in: [wIn, hIn],
    reduced_warning: reduced,
    why,
  } };
}
