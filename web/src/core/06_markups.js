// The markup file, its validation, and the markup list. Mirrors markups.py.
const MARKUP_TYPES = MEASURE_TYPES.concat(["cloud", "callout", "text", "arrow", "line", "rect", "ellipse", "polygon", "polyline", "highlight", "pen", "stamp"]);
const TYPE_LABELS = {
  length: "Length", polylength: "Polylength", area: "Area", perimeter: "Perimeter", count: "Count", volume: "Volume",
  angle: "Angle", radius: "Radius", diameter: "Diameter", quantity: "Imported quantity", cloud: "Cloud", callout: "Callout", text: "Text", arrow: "Arrow", line: "Line",
  rect: "Rectangle", ellipse: "Ellipse", polygon: "Polygon", polyline: "Polyline", highlight: "Highlight", pen: "Pen", stamp: "Stamp",
};
const GLYPHS = ["circle", "square", "triangle", "diamond"];
const STATUSES = ["", "Open", "Accepted", "Rejected", "Completed", "Review", "Cancelled"];
const LENGTH_UNITS = ["ftin", "ft", "in", "yd", "m", "cm", "mm"];
const AREA_UNITS = ["sf", "sy", "sq_in", "sm", "sq_cm", "sq_mm", "acre"];
const VOLUME_UNITS = ["cy", "cf", "cu_in", "cu_m", "l", "gal"];
const LIMITS = { markups: 100000, points: 20000, holes: 200, pages: 20000, layers: 500, assemblies: 2000, components: 100, columns: 50, text: 5000, short: 200, coord: 1e7,
  comments: 500, comment: 2000, status_log: 200, versions: 32, viewports: 50, params: 30, rates: 200, formula: 500, why: 1000 };
const DEFAULT_SETTINGS = { length_unit: "ftin", area_unit: "sf", volume_unit: "cy", places: 2, denominator: 16, author: "", markup_pct: 0, tax_pct: 0, overhead_pct: 0 };
const NEED_POINTS = { length: 2, polylength: 2, perimeter: 2, area: 3, volume: 3, angle: 3, radius: 2, diameter: 2, quantity: 1, count: 1, cloud: 2, rect: 2, ellipse: 2, highlight: 2, line: 2, arrow: 2, callout: 2, polygon: 3, polyline: 2, pen: 2, text: 1, stamp: 1 };
const RE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const RE_COLOR = /^#[0-9a-fA-F]{6}$/;
const RE_CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function clean_text(v, cap) {
  if (typeof v !== "string") return "";
  const s = v.replace(RE_CTRL, "");
  // Count code points, as the Python library does.
  return s.length <= cap ? s : Array.from(s).slice(0, cap).join("");
}
function _num(v, lo, hi, dflt) {
  if (dflt === undefined) dflt = null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) return dflt;
  return v;
}
function _pts(v, cap) {
  if (!Array.isArray(v) || v.length > cap) return null;
  const out = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const x = _num(p[0], -LIMITS.coord, LIMITS.coord), y = _num(p[1], -LIMITS.coord, LIMITS.coord);
    if (x === null || y === null) return null;
    out.push([x, y]);
  }
  return out;
}
const RESERVED_IDS = ["__proto__", "constructor", "prototype"];
function _id(v) { return typeof v === "string" && RE_ID.test(v) && !RESERVED_IDS.includes(v) ? v : null; }
const FORMULA_NAMES = ["LF", "PF", "SF", "WSF", "CF", "CY", "EA", "N"];
function _ids(v, cap) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v.slice(-cap)) { const i = _id(x); if (i && !out.includes(i)) out.push(i); }
  return out;
}
// One comment or reply on a markup (see clean_comment in markups.py).
function clean_comment(c) {
  if (!isObj(c)) return null;
  const cid = _id(c.id);
  if (cid === null) return null;
  const out = { id: cid, author: clean_text(c.author, 100), at: clean_text(c.at, 40), text: clean_text(c.text, LIMITS.comment) };
  const rt = _id(c.reply_to);
  if (rt && rt !== cid) out.reply_to = rt;
  if (c.resolved === true) out.resolved = true;
  if (c.deleted === true) { out.deleted = true; out.text = ""; }
  else if (!out.text) return null;
  return out;
}
function clean_status_entry(e) {
  if (!isObj(e)) return null;
  const out = { status: clean_text(e.status, 40), by: clean_text(e.by, 100), at: clean_text(e.at, 40) };
  return out.status || out.at ? out : null;
}

function clean_markup(m) {
  if (!isObj(m)) return null;
  const mid = _id(m.id), t = m.type, page = m.page;
  if (mid === null || typeof t !== "string" || !MARKUP_TYPES.includes(t) || !Number.isInteger(page) || page < 0 || page >= LIMITS.pages) return null;
  const pts = _pts(m.points, LIMITS.points);
  if (pts === null || pts.length < NEED_POINTS[t]) return null;
  const out = { id: mid, type: t, page, points: pts };
  if ((t === "area" || t === "volume") && Array.isArray(m.holes)) {
    const hs = [];
    for (const h of m.holes.slice(0, LIMITS.holes)) {
      const hp = _pts(h, LIMITS.points);
      if (hp !== null && hp.length >= 3) hs.push(hp);
    }
    if (hs.length) out.holes = hs;
  }
  for (const key of ["subject", "label", "author", "created", "modified", "modified_by", "assignee"]) {
    const s = clean_text(m[key], LIMITS.short);
    if (s) out[key] = s;
  }
  if (Number.isInteger(m.rev) && m.rev >= 0 && m.rev <= 1000000000) out.rev = m.rev;
  const vers = _ids(m.vers, LIMITS.versions);
  if (vers.length) out.vers = vers;
  if (m.resolved === true) out.resolved = true;
  if (Array.isArray(m.status_log)) {
    const entries = m.status_log.slice(-LIMITS.status_log).map(clean_status_entry).filter((e) => e);
    if (entries.length) out.status_log = entries;
  }
  if (Array.isArray(m.comments)) {
    const seenC = new Set(), cl = [];
    for (const x of m.comments.slice(0, LIMITS.comments)) {
      const cc = clean_comment(x);
      if (cc && !seenC.has(cc.id)) { seenC.add(cc.id); cl.push(cc); }
    }
    if (cl.length) out.comments = cl;
  }
  if (t === "quantity") {
    const q = m.qty;
    const kind = isObj(q) ? q.kind : null;
    const val = isObj(q) ? _num(q.value, 0, 1e15) : null;
    if (!["length", "area", "volume", "count"].includes(kind) || val === null) return null;
    out.qty = { kind, value: val };
  }
  const text = clean_text(m.text, LIMITS.text);
  if (text) out.text = text;
  const status = clean_text(m.status, 40);
  if (status) out.status = status;
  for (const key of ["layer", "assembly", "preset", "viewport"]) {
    const v = _id(m[key]);
    if (v) out[key] = v;
  }
  if (["layer", "preset", "manual"].includes(m.assembly_source) && has(out, "assembly")) out.assembly_source = m.assembly_source;
  if (typeof m.color === "string" && RE_COLOR.test(m.color)) out.color = m.color.toLowerCase();
  if (t === "count" && typeof m.glyph === "string" && GLYPHS.includes(m.glyph)) out.glyph = m.glyph;
  if (typeof m.fill === "string" && RE_COLOR.test(m.fill)) out.fill = m.fill.toLowerCase();
  for (const [key, lo, hi] of [["opacity", 0, 1], ["width", 0, 100], ["font_size", 4, 400], ["depth", 0, 1e6], ["height", 0, 1e6], ["pitch", 0, 48], ["rotation", -360, 360]]) {
    const v = _num(m[key], lo, hi);
    if (v !== null) out[key] = v;
  }
  if (isObj(m.custom)) {
    const cc = {};
    for (const k of Object.keys(m.custom).sort().slice(0, LIMITS.columns)) {
      if (_id(k)) {
        const s = clean_text(m.custom[k], 500);
        if (s) cc[k] = s;
      }
    }
    if (Object.keys(cc).length) out.custom = cc;
  }
  return out;
}
function clean_scale(s) {
  if (!isObj(s)) return null;
  const ipp = _num(s.in_per_pt, 1e-6, 1e7);
  if (ipp === null) return null;
  const src = s.source;
  return { in_per_pt: ipp, label: clean_text(s.label, 80), source: ["standard", "calibrated", "titleblock", "copied", "imported"].includes(src) ? src : "calibrated" };
}
function clean_component(c) {
  if (!isObj(c)) return null;
  const src = c.source;
  if (typeof src !== "string" || !has(SOURCES, src)) return null;
  const out = { name: clean_text(c.name, LIMITS.short), source: src, unit: clean_text(c.unit, 24) };
  const su = c.source_unit;
  if (typeof su === "string" && (has(LENGTH, su) || has(AREA, su) || has(VOLUME, su))) out.source_unit = su;
  for (const [key, lo, hi, d] of [["factor", -1e9, 1e9, 1], ["per_each", -1e9, 1e9, 0], ["waste_pct", 0, 1000, 0], ["pack", 0, 1e9, 0]]) out[key] = _num(c[key], lo, hi, d);
  out.unit_cost_cents = Math.trunc(_num(c.unit_cost_cents, -1e11, 1e11, 0));
  const f = clean_text(c.formula, LIMITS.formula).trim();
  if (f) out.formula = f;
  const code = clean_text(c.code, 40).trim();
  if (code) out.code = code;
  const hrs = _num(c.labor_hours, 0, 1e6);
  if (hrs) out.labor_hours = hrs;
  const lr = _id(c.labor_rate);
  if (lr) out.labor_rate = lr;
  return out;
}
function clean_param(p) {
  if (!isObj(p)) return null;
  const pid = p.id;
  if (typeof pid !== "string" || !RE_PARAM.test(pid) || FORMULA_NAMES.includes(pid)) return null;
  const v = _num(p.value, -1e9, 1e9);
  if (v === null) return null;
  const out = { id: pid, name: clean_text(p.name, 100) || pid, value: v };
  const unit = clean_text(p.unit, 24);
  if (unit) out.unit = unit;
  return out;
}
// One assembly with the optional library fields (see clean_assembly in markups.py).
function clean_assembly(a) {
  const aid = isObj(a) ? _id(a.id) : null;
  if (!aid || !Array.isArray(a.components)) return null;
  const comps = a.components.slice(0, LIMITS.components).map(clean_component).filter((c) => c);
  const out = { id: aid, name: clean_text(a.name, LIMITS.short) || aid, components: comps };
  const params = [];
  for (const p of Array.isArray(a.params) ? a.params.slice(0, LIMITS.params) : []) {
    const cp = clean_param(p);
    if (cp && !params.some((q) => q.id === cp.id)) params.push(cp);
  }
  if (params.length) out.params = params;
  for (const [key, cap] of [["division", 8], ["code", 40], ["group", 60], ["why", LIMITS.why]]) {
    const v = clean_text(a[key], cap).trim();
    if (v) out[key] = v;
  }
  if (MEASURE_TYPES.includes(a.tool)) out.tool = a.tool;
  return out;
}
function clean_viewport(v) {
  if (!isObj(v)) return null;
  const vid = _id(v.id), r = v.rect, sc = clean_scale(v.scale);
  if (vid === null || sc === null || !Array.isArray(r) || r.length !== 4) return null;
  const nums = r.map((x) => _num(x, -LIMITS.coord, LIMITS.coord));
  if (nums.some((x) => x === null)) return null;
  const x0 = Math.min(nums[0], nums[2]), x1 = Math.max(nums[0], nums[2]), y0 = Math.min(nums[1], nums[3]), y1 = Math.max(nums[1], nums[3]);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  return { id: vid, name: clean_text(v.name, 100), rect: [x0, y0, x1, y1], scale: sc };
}
function clean_tombstone(t) {
  if (!isObj(t)) return null;
  const tid = _id(t.id);
  if (tid === null) return null;
  return { id: tid, at: clean_text(t.at, 40), by: clean_text(t.by, 100), vers: _ids(t.vers, LIMITS.versions) };
}
function clean_rate(r) {
  const rid = isObj(r) ? _id(r.id) : null;
  if (rid === null) return null;
  const v = _num(r.cents_per_hour, 0, 1e7);
  if (v === null) return null;
  return { id: rid, name: clean_text(r.name, 100) || rid, cents_per_hour: v };
}
function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function clean_document(doc) {
  if (!isObj(doc)) throw new TakeoffError("file", "This is not a markup file (expected a JSON object)");
  if (doc.format !== FILE_FORMAT) throw new TakeoffError("file", "This is not a markup file from this tool");
  const v = doc.version;
  if (!Number.isInteger(v) || v < 1) throw new TakeoffError("file", "The markup file has no valid version");
  if (v > FILE_VERSION) throw new TakeoffError("file", "This markup file was written by a newer version. Update the app to open it.");
  const report = { markups_dropped: 0, pages_dropped: 0, layers_dropped: 0, assemblies_dropped: 0 };
  const settings = Object.assign({}, DEFAULT_SETTINGS);
  const s = doc.settings;
  if (isObj(s)) {
    if (LENGTH_UNITS.includes(s.length_unit)) settings.length_unit = s.length_unit;
    if (AREA_UNITS.includes(s.area_unit)) settings.area_unit = s.area_unit;
    if (VOLUME_UNITS.includes(s.volume_unit)) settings.volume_unit = s.volume_unit;
    const p = _num(s.places, 0, 6);
    if (p !== null) settings.places = Math.trunc(p);
    if ([1, 2, 4, 8, 16, 32, 64].includes(s.denominator)) settings.denominator = s.denominator;
    settings.author = clean_text(s.author, 100);
    settings.markup_pct = _num(s.markup_pct, 0, 1000, 0);
    settings.tax_pct = _num(s.tax_pct, 0, 100, 0);
    settings.overhead_pct = _num(s.overhead_pct, 0, 1000, 0);
  }
  const pages = {};
  if (isObj(doc.pages)) {
    const keys = Object.keys(doc.pages).sort((a, b) => a.length - b.length || cmpStr(a, b)).slice(0, LIMITS.pages);
    for (const k of keys) {
      const pv = doc.pages[k];
      if (!(/^[0-9]{1,9}$/.test(k) && parseInt(k, 10) < LIMITS.pages && isObj(pv))) { report.pages_dropped += 1; continue; }
      const entry = {};
      const sc = clean_scale(pv.scale);
      if (sc) entry.scale = sc;
      for (const key of ["label", "title"]) {
        const t = clean_text(pv[key], LIMITS.short);
        if (t) entry[key] = t;
      }
      const vps = [];
      if (Array.isArray(pv.viewports)) {
        for (const v of pv.viewports.slice(0, LIMITS.viewports)) {
          const cv = clean_viewport(v);
          if (cv && !vps.some((x) => x.id === cv.id)) vps.push(cv);
        }
      }
      if (vps.length) entry.viewports = vps;
      pages[String(parseInt(k, 10))] = entry;
    }
  }
  const layers = [];
  let seen = new Set();
  for (const lay of Array.isArray(doc.layers) ? doc.layers.slice(0, LIMITS.layers) : []) {
    const lid = isObj(lay) ? _id(lay.id) : null;
    if (!lid || seen.has(lid)) { report.layers_dropped += 1; continue; }
    seen.add(lid);
    const entry = { id: lid, name: clean_text(lay.name, 100) || lid, visible: lay.visible !== false, locked: lay.locked === true };
    const a = _id(lay.assembly);
    if (a) entry.assembly = a;
    layers.push(entry);
  }
  const assemblies = [];
  seen = new Set();
  for (const a of Array.isArray(doc.assemblies) ? doc.assemblies.slice(0, LIMITS.assemblies) : []) {
    const ca = clean_assembly(a);
    if (ca === null || seen.has(ca.id)) { report.assemblies_dropped += 1; continue; }
    seen.add(ca.id);
    assemblies.push(ca);
  }
  const columns = [];
  for (const col of Array.isArray(doc.columns) ? doc.columns.slice(0, LIMITS.columns) : []) {
    const cid = isObj(col) ? _id(col.id) : null;
    if (cid && !columns.some((c) => c.id === cid)) columns.push({ id: cid, name: clean_text(col.name, 100) || cid });
  }
  let raw_m = doc.markups;
  if (raw_m !== undefined && raw_m !== null && !Array.isArray(raw_m)) throw new TakeoffError("file", "The markups field must be a list");
  raw_m = raw_m || [];
  if (raw_m.length > LIMITS.markups) { report.markups_dropped += raw_m.length - LIMITS.markups; raw_m = raw_m.slice(0, LIMITS.markups); }
  const markups = [];
  seen = new Set();
  for (const m of raw_m) {
    const cm = clean_markup(m);
    if (cm === null || seen.has(cm.id)) { report.markups_dropped += 1; continue; }
    seen.add(cm.id);
    markups.push(cm);
  }
  const out = { format: FILE_FORMAT, version: FILE_VERSION, settings, pages, layers, assemblies, columns, markups };
  const tombs = [];
  if (Array.isArray(doc.tombstones)) {
    const seenT = new Set(seen);
    for (const t of doc.tombstones.slice(-LIMITS.markups)) {
      const ct = clean_tombstone(t);
      if (ct && !seenT.has(ct.id)) { seenT.add(ct.id); tombs.push(ct); }
    }
  }
  if (tombs.length) out.tombstones = tombs;
  const rates = [];
  if (Array.isArray(doc.rates)) {
    for (const r of doc.rates.slice(0, LIMITS.rates)) {
      const cr = clean_rate(r);
      if (cr && !rates.some((x) => x.id === cr.id)) rates.push(cr);
    }
  }
  if (rates.length) out.rates = rates;
  if (isObj(doc.document)) {
    const d = doc.document;
    out.document = { name: clean_text(d.name, 200), sha256: typeof d.sha256 === "string" && /^[0-9a-f]{64}$/.test(d.sha256) ? d.sha256 : "" };
  }
  return [out, report];
}

// ------------------------------------------------------------- markup list
function page_scale(doc, page) {
  const entry = (doc.pages && has(doc.pages, String(page)) && doc.pages[String(page)]) || {};
  return entry.scale ? entry.scale.in_per_pt : null;
}
// The scale a markup is measured at: its viewport's, when the page has it, else the page scale.
function markup_scale(doc, m) {
  if (m.viewport) {
    const entry = (doc.pages && has(doc.pages, String(m.page)) && doc.pages[String(m.page)]) || {};
    for (const v of entry.viewports || []) if (v.id === m.viewport) return v.scale.in_per_pt;
  }
  return page_scale(doc, m.page);
}
function viewport_at(doc, page, pt) {
  const entry = (doc.pages && has(doc.pages, String(page)) && doc.pages[String(page)]) || {};
  let hit = null;
  for (const v of entry.viewports || []) { const r = v.rect; if (r[0] <= pt[0] && pt[0] <= r[2] && r[1] <= pt[1] && pt[1] <= r[3]) hit = v.id; }
  return hit;
}
function display(result, settings) {
  const kind = result.kind, lu = settings.length_unit, pl = settings.places;
  if (kind === "count") return [group3(result.count) + " ea", result.count, "ea"];
  if (kind === "angle") return [format_number(result.angle_deg, 1) + " deg", result.angle_deg, "deg"];
  if (result.value === null) return ["Not calibrated", null, ""];
  if (kind === "length") {
    const unit = lu === "ftin" ? "ft" : lu;
    return [format_length(result.value, lu, pl, settings.denominator), from_inches(result.value, lu), UNIT_LABELS[unit]];
  }
  if (kind === "area") {
    const au = settings.area_unit;
    return [format_area(result.value, au, pl), area_from_sq_in(result.value, au), UNIT_LABELS[au]];
  }
  const vu = settings.volume_unit;
  return [format_volume(result.value, vu, pl), volume_from_cu_in(result.value, vu), UNIT_LABELS[vu]];
}
function markup_row(doc, m, layerNames) {
  const pageEntry = (doc.pages && doc.pages[String(m.page)]) || {};
  const row = {
    id: m.id, page: m.page + 1, sheet: pageEntry.label || "", type: TYPE_LABELS[m.type], subject: m.subject || "",
    label: m.label || "", layer: (m.layer && has(layerNames, m.layer) && layerNames[m.layer]) || "", author: m.author || "",
    status: m.status || "", date: m.created || "", measurement: "", quantity: null, unit: "", warnings: "",
    custom: Object.assign({}, m.custom || {}),
  };
  if (MEASURE_TYPES.includes(m.type)) {
    try {
      const r = measure(m, markup_scale(doc, m));
      [row.measurement, row.quantity, row.unit] = display(r, doc.settings);
      row.warnings = r.warnings.join(" ");
    } catch (e) {
      if (!(e instanceof TakeoffError)) throw e;
      row.measurement = "Invalid";
      row.warnings = e.code;
    }
  }
  return row;
}
function markup_rows(doc) {
  const layerNames = {};
  for (const l of doc.layers || []) layerNames[l.id] = l.name;
  return doc.markups.map((m) => markup_row(doc, m, layerNames));
}
function row_key(row, key) {
  if (key.startsWith("custom:")) return row.custom[key.slice(7)] || "";
  const v = row[key];
  return v === null || v === undefined ? "" : String(v);
}
// Angles are counted as rows but never added up: a sum of angles is not a quantity.
const NOT_SUMMED = ["deg"];
function group_totals(rows, key) {
  const groups = new Map();
  for (const r of rows) {
    const k = row_key(r, key);
    if (!groups.has(k)) groups.set(k, { group: k, rows: 0, totals: {} });
    const g = groups.get(k);
    g.rows += 1;
    if (r.quantity !== null && r.unit && !NOT_SUMMED.includes(r.unit)) g.totals[r.unit] = (has(g.totals, r.unit) ? g.totals[r.unit] : 0) + r.quantity;
  }
  const keys = Array.from(groups.keys()).sort((a, b) => (a === "") - (b === "") || cmpStr(a.toLowerCase(), b.toLowerCase()) || cmpStr(a, b));
  return keys.map((k) => {
    const g = groups.get(k);
    return { group: g.group, rows: g.rows, totals: Object.keys(g.totals).sort(cmpStr).map((unit) => ({ unit, quantity: g.totals[unit] })) };
  });
}
function document_estimate(doc) {
  const by = {};
  for (const m of doc.markups) {
    const a = m.assembly;
    if (a && MEASURE_TYPES.includes(m.type)) {
      let r;
      try { r = measure(m, markup_scale(doc, m)); } catch (e) { if (e instanceof TakeoffError) continue; throw e; }
      (by[a] = by[a] || []).push(r);
    }
  }
  const st = doc.settings;
  return estimate(doc.assemblies, by, st.markup_pct || 0, st.tax_pct || 0, st.overhead_pct || 0, doc.rates || []);
}
