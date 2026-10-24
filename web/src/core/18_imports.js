// Imports: PDF object syntax, a small XML reader, tool chest files from another program (.btx),
// its markup summary exports (CSV and XML), and price lists (CSV with column mapping). Pure: the
// page reads files, inflates compressed parts and hands text here.

// ---------------------------------------------------------------- PDF object syntax (ISO 32000, 7.3)
// Values: numbers, booleans, null, names ("/Name"), strings (literal and hex, UTF-16 with a BOM
// decoded), arrays and dictionaries (plain objects keyed by name without the slash). Indirect
// references ("1 0 R") read as null: a tool chest item is self-contained.
const PDF_DELIMS = "()<>[]{}/%";
const PDF_WS = " \t\r\n\f\0";
function parse_pdf_object(text) {
  if (typeof text !== "string") throw new TakeoffError("import", "Expected text");
  if (text.length > 4000000) throw new TakeoffError("import", "The object is too large");
  let i = 0, depth = 0, items = 0;
  const n = text.length;
  const skip = () => {
    for (;;) {
      while (i < n && PDF_WS.includes(text[i])) i++;
      if (i < n && text[i] === "%") { while (i < n && text[i] !== "\n" && text[i] !== "\r") i++; continue; }
      return;
    }
  };
  const fail = (msg) => { throw new TakeoffError("import", msg + " at character " + i); };
  const decodeBytes = (codes) => {
    if (codes.length >= 2 && codes[0] === 0xfe && codes[1] === 0xff) {
      let s = "";
      for (let k = 2; k + 1 < codes.length; k += 2) s += String.fromCharCode((codes[k] << 8) | codes[k + 1]);
      return s;
    }
    if (codes.length >= 3 && codes[0] === 0xef && codes[1] === 0xbb && codes[2] === 0xbf) {
      try { return decodeURIComponent(codes.slice(3).map((c) => "%" + c.toString(16).padStart(2, "0")).join("")); } catch (e) { /* not UTF-8 */ }
    }
    return codes.map((c) => String.fromCharCode(c)).join("");
  };
  function value() {
    if (++items > 200000) fail("Too many values");
    skip();
    if (i >= n) fail("Unexpected end");
    const c = text[i];
    if (c === "<" && text[i + 1] === "<") {
      if (++depth > 64) fail("Nested too deeply");
      i += 2;
      const out = {};
      for (;;) {
        skip();
        if (text[i] === ">" && text[i + 1] === ">") { i += 2; depth--; return out; }
        if (text[i] !== "/") fail("Expected a name in the dictionary");
        const key = name().slice(1);
        const v = value();
        if (key && !RESERVED_IDS.includes(key)) out[key] = v;
      }
    }
    if (c === "[") {
      if (++depth > 64) fail("Nested too deeply");
      i++;
      const out = [];
      for (;;) {
        skip();
        if (text[i] === "]") { i++; depth--; return out; }
        if (i >= n) fail("Unclosed array");
        out.push(value());
      }
    }
    if (c === "(") {
      i++;
      let level = 1;
      const codes = [];
      while (i < n) {
        const ch = text[i++];
        if (ch === "\\") {
          const e = text[i++];
          const map = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
          if (e === undefined) break;
          if (has(map, e)) codes.push(map[e]);
          else if (e >= "0" && e <= "7") {
            let o = e;
            while (o.length < 3 && text[i] >= "0" && text[i] <= "7") o += text[i++];
            codes.push(parseInt(o, 8) & 255);
          } else if (e === "\r") { if (text[i] === "\n") i++; }
          else if (e !== "\n") codes.push(e.charCodeAt(0) & 255);
          continue;
        }
        if (ch === "(") level++;
        if (ch === ")" && --level === 0) return decodeBytes(codes);
        codes.push(ch.charCodeAt(0) & 255);
      }
      fail("Unclosed string");
    }
    if (c === "<") {
      i++;
      let hex = "";
      while (i < n && text[i] !== ">") { if (!PDF_WS.includes(text[i])) hex += text[i]; i++; }
      i++;
      if (!/^[0-9a-fA-F]*$/.test(hex)) fail("Bad hex string");
      if (hex.length % 2) hex += "0";
      const codes = [];
      for (let k = 0; k < hex.length; k += 2) codes.push(parseInt(hex.slice(k, k + 2), 16));
      return decodeBytes(codes);
    }
    if (c === "/") return name();
    // numbers, keywords and references
    let j = i;
    while (j < n && !PDF_WS.includes(text[j]) && !PDF_DELIMS.includes(text[j])) j++;
    const word = text.slice(i, j);
    if (!word) fail("Unexpected character");
    i = j;
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      // "1 0 R" is a reference
      const save = i;
      const m = /^\s+(\d+)\s+R(?![^\s()<>[\]{}/%])/.exec(text.slice(i, i + 32));
      if (/^\d+$/.test(word) && m) { i += m[0].length; return null; }
      i = save;
      return Number(word);
    }
    return word;
  }
  function name() {
    let j = i + 1;
    while (j < n && !PDF_WS.includes(text[j]) && !PDF_DELIMS.includes(text[j])) j++;
    const raw = text.slice(i + 1, j);
    i = j;
    return "/" + raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  const v = value();
  return v;
}
// A parsed annotation dictionary as the plain description the annotation mapping reads.
function _nm(v) { return typeof v === "string" && v.startsWith("/") ? v.slice(1) : ""; }
function _nf(arr) {
  return Array.isArray(arr) ? arr.filter(isObj).map((x) => ({ u: typeof x.U === "string" ? x.U : "", c: typeof x.C === "number" ? x.C : 0 })) : [];
}
function plain_annot(d) {
  if (!isObj(d)) return null;
  const a = { subtype: _nm(d.Subtype) };
  const nums = (v) => (Array.isArray(v) && v.every((x) => typeof x === "number") ? v : undefined);
  if (nums(d.Rect)) a.rect = d.Rect;
  if (_nm(d.IT)) a.it = _nm(d.IT);
  for (const [k, key] of [["l", "L"], ["vertices", "Vertices"], ["quad", "QuadPoints"], ["cl", "CL"], ["rd", "RD"], ["color", "C"], ["interior", "IC"]]) if (nums(d[key])) a[k] = d[key];
  if (Array.isArray(d.InkList)) a.ink = d.InkList.filter((s) => nums(s));
  if (Array.isArray(d.LE)) a.le = d.LE.map(_nm);
  for (const [k, key] of [["contents", "Contents"], ["subject", "Subj"], ["title", "T"], ["nm", "NM"], ["m", "M"], ["creation", "CreationDate"], ["label", "Label"]]) {
    if (typeof d[key] === "string") a[k] = d[key];
  }
  if (typeof d.CA === "number") a.opacity = d.CA;
  if (isObj(d.BS) && typeof d.BS.W === "number") a.width = d.BS.W;
  else if (Array.isArray(d.Border) && typeof d.Border[2] === "number") a.width = d.Border[2];
  if (isObj(d.BE) && _nm(d.BE.S) === "C") a.cloudy = true;
  const meas = isObj(d.Measure) ? d.Measure : isObj(d.BBMeasure) ? d.BBMeasure : null;
  if (meas) a.measure = { r: typeof meas.R === "string" ? meas.R : "", x: _nf(meas.X), d: _nf(meas.D), a: _nf(meas.A) };
  if (typeof d.FTMarkup === "string") a.private = d.FTMarkup;
  return a;
}

// ---------------------------------------------------------------- a small XML reader
// Elements with attributes and text; no DTDs, no external entities (a document type is refused).
// Returns the root element: { name, attrs, children, text }.
function parse_xml(text) {
  if (typeof text !== "string") throw new TakeoffError("import", "Expected text");
  if (text.length > 50 * 1024 * 1024) throw new TakeoffError("import", "The file is too large");
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) throw new TakeoffError("import", "XML with a document type is not read");
  const ent = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
    if (e[0] === "#") { const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ""; }
    return { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" }[e];
  });
  const root = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0, count = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    const top = stack[stack.length - 1];
    if (lt < 0) { top.text += ent(text.slice(i)); break; }
    if (lt > i) top.text += ent(text.slice(i, lt));
    if (text.startsWith("<!--", lt)) { const e = text.indexOf("-->", lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith("<![CDATA[", lt)) { const e = text.indexOf("]]>", lt + 9); top.text += text.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith("<?", lt)) { const e = text.indexOf("?>", lt + 2); i = e < 0 ? n : e + 2; continue; }
    const gt = text.indexOf(">", lt);
    if (gt < 0) throw new TakeoffError("import", "Unclosed tag in the XML");
    const body = text.slice(lt + 1, gt);
    i = gt + 1;
    if (body[0] === "/") {
      const name = body.slice(1).trim();
      if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
      else throw new TakeoffError("import", "Mismatched closing tag </" + name.slice(0, 40) + "> in the XML");
      continue;
    }
    const selfClose = body.endsWith("/");
    const m = /^[A-Za-z_][\w.:-]*/.exec(body);
    if (!m || m[0].length > 200) throw new TakeoffError("import", "Bad tag in the XML");
    if (++count > 500000) throw new TakeoffError("import", "Too many elements in the XML");
    const el = { name: m[0], attrs: {}, children: [], text: "" };
    _xml_attrs(body.slice(m[0].length, selfClose ? body.length - 1 : body.length), el.attrs, ent);
    top.children.push(el);
    if (!selfClose) { if (stack.length > 200) throw new TakeoffError("import", "The XML is nested too deeply"); stack.push(el); }
  }
  if (stack.length > 1) throw new TakeoffError("import", "The XML ends inside <" + stack[stack.length - 1].name.slice(0, 40) + ">");
  const els = root.children;
  if (!els.length) throw new TakeoffError("import", "No XML elements found");
  return els[0];
}
// Attributes of one tag, read in a single pass (name = "value" or name = 'value'); anything else
// is skipped. A regular expression here would take quadratic time on a long run of name characters.
const XML_NAME_CH = /[\w.:-]/, XML_WS = /\s/;
function _xml_attrs(src, out, ent) {
  const n = src.length;
  let i = 0;
  while (i < n) {
    while (i < n && XML_WS.test(src[i])) i++;
    let j = i;
    while (j < n && XML_NAME_CH.test(src[j])) j++;
    if (j === i) { i++; continue; }
    const name = src.slice(i, j);
    let k = j;
    while (k < n && XML_WS.test(src[k])) k++;
    if (src[k] !== "=") { i = k; continue; }
    k++;
    while (k < n && XML_WS.test(src[k])) k++;
    const q = src[k];
    if (q !== "\"" && q !== "'") { i = k; continue; }
    const end = src.indexOf(q, k + 1);
    if (end < 0) break;
    if (/^[A-Za-z_]/.test(name) && name.length <= 200 && !RESERVED_IDS.includes(name)) out[name] = ent(src.slice(k + 1, end));
    i = end + 1;
  }
}
function xml_child(el, name) { return el.children.find((c) => c.name.toLowerCase() === name.toLowerCase()) || null; }
function xml_text(el, name) { const c = xml_child(el, name); return c ? c.text.trim() : ""; }

// ---------------------------------------------------------------- tool chest files (.btx)
// Observed in publicly shared files: a root element with a <Title> and <ToolChestItem> elements,
// each with <Name>, <Type> and <Raw>. Raw is the annotation dictionary in PDF syntax, written as
// is or as hex of zlib-compressed bytes (starting 789c). The page inflates hex parts.
const HEX_ZLIB = /^\s*78(9c|da|01|5e)[0-9a-fA-F\s]+$/;
function btx_items(xml) {
  const root = parse_xml(xml);
  const title = xml_text(root, "Title");
  const out = [];
  const walk = (el) => {
    for (const c of el.children) {
      if (c.name === "ToolChestItem") {
        const raw = xml_text(c, "Raw");
        out.push({ name: xml_text(c, "Name"), type: xml_text(c, "Type"), raw: raw.replace(/\s+/g, HEX_ZLIB.test(raw) ? "" : " "),
          compressed: HEX_ZLIB.test(raw), title: xml_text(c, "Title") });
        if (out.length >= 5000) return;
      } else walk(c);
    }
  };
  walk(root);
  return { title, items: out };
}
function hex_bytes(hex) {
  const h = hex.replace(/\s+/g, "");
  if (!/^([0-9a-fA-F]{2})*$/.test(h)) throw new TakeoffError("import", "Bad hex data");
  const out = new Uint8Array(h.length / 2);
  for (let k = 0; k < out.length; k++) out[k] = parseInt(h.slice(2 * k, 2 * k + 2), 16);
  return out;
}
// What one tool chest item becomes: a preset for our tool chest (or null for types we have not).
const BTX_FONT = /(\d+(?:\.\d+)?)\s*(?:pt|Tf)/;
function btx_preset(item, rawText, index) {
  let d;
  try { d = parse_pdf_object(rawText); } catch (e) { return null; }
  const a = plain_annot(d);
  if (!a || !a.subtype) return null;
  // A tool has no position: give it a unit shape so the annotation mapping can say what it is.
  const shape = {
    Line: { l: [0, 0, 10, 0] }, PolyLine: { vertices: [0, 0, 10, 0, 10, 10] }, Polygon: { vertices: [0, 0, 10, 0, 10, 10] },
    Square: { rect: [0, 0, 10, 10] }, Circle: { rect: [0, 0, 10, 10] }, FreeText: { rect: [0, 0, 60, 20], cl: a.it === "FreeTextCallout" ? [0, 0, 20, 10, 30, 10] : undefined },
    Ink: { ink: [[0, 0, 5, 5, 10, 0]] }, Highlight: { quad: [0, 10, 10, 10, 0, 0, 10, 0] }, Stamp: { rect: [0, 0, 60, 20] },
  }[a.subtype];
  if (!shape) return null;
  const probe = Object.assign({}, a, shape, { rect: shape.rect || [0, 0, 10, 10] });
  delete probe.private;
  const r = annot_to_markup(probe, { transform: [1, 0, 0, -1, 0, 100] }, 0, index);
  if (!r) return null;
  const m = r.markup;
  const tool = m.type === "polylength" && /perimeter/i.test(a.subject || "") ? "perimeter" : m.type;
  if (!TYPE_LABELS[tool] || tool === "quantity") return null;
  const name = Array.from(item.title || item.name || a.subject || TYPE_LABELS[tool]).slice(0, 80).join("").trim() || TYPE_LABELS[tool];
  const p = { id: "btx-" + (index + 1), name, tool, subject: a.subject || TYPE_LABELS[tool], imported: true };
  if (m.color) p.color = m.color;
  if (m.fill) p.fill = m.fill;
  if (has(m, "opacity")) p.opacity = m.opacity;
  if (has(m, "width")) p.width = m.width;
  if (tool === "volume" && m.depth) p.depth = m.depth;
  if ((tool === "stamp" || tool === "callout" || tool === "text") && a.contents) p.text = Array.from(a.contents).slice(0, 200).join("");
  const fs = typeof d.DA === "string" ? BTX_FONT.exec(d.DA) : null;
  if (fs && Number(fs[1]) >= 4 && Number(fs[1]) <= 400) p.font_size = Number(fs[1]);
  return p;
}

// ---------------------------------------------------------------- CSV
// RFC 4180 with the usual tolerance: comma, tab or semicolon (whichever the header row uses most),
// quoted fields with doubled quotes, CR LF or LF, a byte order mark, blank lines skipped.
function parse_csv(text, maxRows) {
  if (typeof text !== "string") throw new TakeoffError("import", "Expected text");
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] || "";
  const counts = [",", "\t", ";"].map((d) => [d, firstLine.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  const delim = counts[0][1] > 1 ? counts[0][0] : ",";
  const rows = [];
  let row = [], cell = "", q = false, i = 0;
  const cap = maxRows || 50000;
  while (i < t.length) {
    const c = t[i];
    if (q) {
      if (c === "\"") { if (t[i + 1] === "\"") { cell += "\""; i += 2; continue; } q = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === "\"" && cell === "") { q = true; i++; continue; }
    if (c === delim) { row.push(cell); cell = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length > cap) throw new TakeoffError("import", "The file has more than " + cap + " rows");
      i += c === "\r" && t[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cell += c; i++;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return { delim, rows };
}
function _norm_head(s) { return String(s || "").toLowerCase().replace(/[_\s]+/g, " ").replace(/[^a-z0-9 %#./]/g, "").trim(); }
function parse_money_cents(s) {
  if (typeof s === "number") return Number.isFinite(s) ? Math.round(s * 100) : null;
  const t = String(s || "").replace(/[$\s,]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && Math.abs(v) < 1e9 ? Math.round(v * 100) : null;
}
function parse_plain_number(s) {
  const t = String(s === undefined || s === null ? "" : s).replace(/[\s,]/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------- markup summary exports
// The other program's markups list exports a summary as CSV or XML with its column names (Subject,
// Page Label, Page Index, Author, Date, Status, Color, Layer, Comments, Label, Length, Area,
// Volume, Count, Measurement and custom columns). Each row becomes an imported quantity: a list row
// with its value in base units, which links to assemblies like any measurement.
const SUMMARY_KNOWN = {
  subject: "subject", "page label": "page_label", "page index": "page_index", page: "page_index", author: "author", date: "date",
  "creation date": "created", status: "status", color: "color", layer: "layer", comments: "comments", label: "label",
  length: "length", area: "area", volume: "volume", count: "count", measurement: "measurement", "wall area": "wall_area",
  depth: "depth", space: "space", unit: "unit", units: "unit", "measurement unit": "unit", "measurement units": "unit", x: "x", y: "y", id: "id", "markup id": "id",
};
// A measured value with its unit as written: 12'-6", 125.5 sf, 3.2 cu yd, 14 ea, 2.5 m. The unit
// written with the number wins; unitHint (the column's own unit, or a unit column) only decides
// for a bare number.
const AREA_WORDS = [["sq ft", 144], ["sq. ft", 144], ["sf", 144], ["ft²", 144], ["ft2", 144], ["sq yd", 1296], ["sy", 1296], ["yd²", 1296],
  ["sq m", 1550.0031000062], ["m²", 1550.0031000062], ["m2", 1550.0031000062], ["sm", 1550.0031000062], ["sq in", 1], ["in²", 1], ["acre", 6272640], ["ac", 6272640]];
const VOLUME_MORE = [["cu. yd", 46656], ["yd³", 46656], ["yd3", 46656], ["cu. ft", 1728], ["ft³", 1728], ["ft3", 1728], ["m³", 61023.744094732], ["in³", 1]];
// a unit word on its own, not inside another word ("ac" is not in "each", "sm" not in "small")
function _has_unit(low, w) {
  for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) {
    const before = low[i - 1], after = low[i + w.length];
    if (!(before && /[a-z]/.test(before)) && !(after && /[a-z]/.test(after))) return true;
  }
  return false;
}
function _unit_kind_in(low, num) {
  if (num === null) return null;
  for (const [w, k] of VOLUME_WORDS.concat(VOLUME_MORE)) if (_has_unit(low, w)) return { kind: "volume", value: num * k };
  for (const [w, k] of AREA_WORDS) if (_has_unit(low, w)) return { kind: "area", value: num * k };
  if (/\b(ea|each|count|ct)\b/.test(low)) return { kind: "count", value: num };
  return null;
}
function parse_measurement(text, unitHint) {
  const s = String(text === undefined || text === null ? "" : text).trim();
  if (!s) return null;
  const own = s.toLowerCase(), hint = String(unitHint || "").trim().toLowerCase();
  const num = parse_plain_number(s.replace(/[^\d.,\-eE]+.*$/, "")) ?? _num_in(s);
  const r = _unit_kind_in(own, num) || (hint ? _unit_kind_in(own + " " + hint, num) : null);
  if (r) return r;
  const bare = /^-?[\d,]+(\.\d+)?$/.test(s) ? s.replace(/,/g, "") : s;
  const metric = /\bm\b|mm|cm|\bmeters?\b/.test(own) || (bare === s.replace(/,/g, "") && /^(m|mm|cm|meters?)$/.test(hint));
  try {
    const inches = parse_length(bare.replace(/\s*(lf|ln ft|lin ft)\b/i, " ft"), metric ? (/^(mm|cm)$/.test(hint) && !/[a-z]/.test(own) ? hint : "m") : (/^(in|")$/.test(hint) && !/[a-z'"]/.test(own) ? "in" : "ft"));
    return { kind: "length", value: inches };
  } catch (e) { /* not a length */ }
  return null;
}
function _summary_records(rows) {
  if (rows.length < 2) return { header: rows[0] || [], records: [] };
  const header = rows[0];
  return { header, records: rows.slice(1).map((r) => { const o = Object.create(null); header.forEach((h, i) => { o[h] = r[i] === undefined ? "" : r[i]; }); return o; }) };
}
function summary_from_csv(text) { const p = parse_csv(text); return _summary_records(p.rows); }
// XML summaries: the element that repeats most and holds leaf children (or attributes) is a row.
function summary_from_xml(text) {
  const root = parse_xml(text);
  const groups = new Map();
  const walk = (el) => {
    const leafs = el.children.filter((c) => !c.children.length);
    if (el.children.length && leafs.length === el.children.length || Object.keys(el.attrs).length >= 2 && !el.children.length) {
      groups.set(el.name, (groups.get(el.name) || []).concat([el]));
    }
    for (const c of el.children) walk(c);
  };
  walk(root);
  let best = null;
  for (const [name, list] of groups) if (!best || list.length > best[1].length) best = [name, list];
  if (!best) return { header: [], records: [] };
  const header = [];
  const records = best[1].map((el) => {
    const o = Object.create(null);
    for (const [k, v] of Object.entries(el.attrs)) { const h = k.replace(/_/g, " "); o[h] = v; if (!header.includes(h)) header.push(h); }
    for (const c of el.children) { const h = c.name.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"); o[h] = c.text.trim(); if (!header.includes(h)) header.push(h); }
    return o;
  });
  return { header, records };
}
// Rows as imported quantities. pageOf(label, index) maps a page label or 1-based index to a page.
function summary_markups(summary, pageOf, numPages, idPrefix) {
  const map = {};
  const known = (h) => (has(SUMMARY_KNOWN, _norm_head(h)) ? SUMMARY_KNOWN[_norm_head(h)] : null);
  for (const h of summary.header) { const k = known(h); if (k && !has(map, k)) map[k] = h; }
  const custom = summary.header.filter((h) => !known(h) && _norm_head(h));
  const columns = custom.slice(0, LIMITS.columns).map((h, i) => ({ id: "rv-" + (_norm_head(h).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || String(i)), name: Array.from(h).slice(0, 100).join("") }));
  const out = [], skipped = [];
  summary.records.forEach((r, i) => {
    const get = (k) => (has(map, k) ? String(r[map[k]] || "").trim() : "");
    let q = null;
    for (const k of ["count", "volume", "area", "length"]) {
      const v = get(k);
      if (!v) continue;
      if (k === "count") { const c = parse_plain_number(v); if (c !== null && c > 0) { q = { kind: "count", value: c }; break; } continue; }
      const p = parse_measurement(v, k === "area" ? "sf" : k === "volume" ? "cu ft" : "");
      if (p && p.kind === k) { q = p; break; }
    }
    if (!q && get("measurement")) q = parse_measurement(get("measurement"), get("unit"));
    if (!q || !(q.value >= 0)) { skipped.push(i + 2); return; }
    let page = pageOf(get("page_label"), parse_plain_number(get("page_index")));
    if (page === null || page === undefined || page < 0 || page >= numPages) page = 0;
    const m = { id: (idPrefix || "rv") + "-" + (i + 1), type: "quantity", page, points: [[18, 18 + (i % 200) * 3]], qty: q };
    m.subject = get("subject") || TYPE_LABELS.quantity;
    for (const [k, f] of [["author", "author"], ["status", "status"], ["label", "label"]]) if (get(k)) m[f] = get(k);
    const c = get("comments");
    if (c) m.text = c;
    const custom_vals = {};
    custom.forEach((h, k) => { if (k < columns.length && String(r[h] || "").trim()) custom_vals[columns[k].id] = String(r[h]).trim(); });
    if (Object.keys(custom_vals).length) m.custom = custom_vals;
    const cm = clean_markup(m);
    if (cm) out.push(cm); else skipped.push(i + 2);
  });
  return { markups: out, columns, skipped, mapped: map };
}

// ---------------------------------------------------------------- price lists
// A CSV with item code or name, unit, material price and labor (hours per unit or a labor price).
// Matching: a component's code first (exact, case ignored), then its name (case and spacing
// ignored). Nothing changes until the person applies the proposal.
const PRICE_GUESS = {
  code: ["code", "item code", "item", "sku", "part", "part number", "cost code", "item number"],
  name: ["name", "description", "item name", "material", "product"],
  unit: ["unit", "uom", "units", "unit of measure"],
  material: ["material", "material cost", "price", "unit price", "unit cost", "cost", "material price", "mat"],
  labor_hours: ["labor hours", "hours", "man hours", "mh", "labor hrs", "hrs per unit"],
  labor_cost: ["labor", "labor cost", "labor price", "install", "installation"],
};
// rows (optional): a few data rows, so a header that could be either ("Material") goes to the
// price when its cells are amounts and to the name when they are words.
function price_columns_guess(header, rows) {
  const norm = header.map(_norm_head);
  const sample = (rows || []).slice(0, 20);
  const numeric = header.map((h, i) => {
    const cells = sample.map((r) => String(r[i] === undefined ? "" : r[i]).trim()).filter((v) => v);
    return cells.length ? cells.filter((v) => parse_money_cents(v) !== null).length / cells.length : null;
  });
  const fits = (k, i) => numeric[i] === null || (k === "name" || k === "code" || k === "unit" ? numeric[i] < 0.6 : numeric[i] >= 0.4);
  const out = {};
  for (const [k, names] of Object.entries(PRICE_GUESS)) {
    const idx = norm.findIndex((h, i) => names.includes(h) && !Object.values(out).includes(i) && fits(k, i));
    if (idx >= 0) out[k] = idx;
  }
  return out;
}
function _keyname(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
// Labor stays labor: a labor price per unit becomes hours per unit at the component's labor rate
// (rates: the takeoff's rate table). Without a rate it cannot be split from material, so it is
// left out and the proposal says so (labor_needs_rate) rather than folded into the unit cost.
function price_proposals(assemblies, rows, mapping, rates) {
  const rateOf = _rate_table(rates);
  const byCode = new Map(), byName = new Map();
  const bad = [];
  rows.forEach((r, i) => {
    const cell = (k) => (has(mapping, k) && mapping[k] !== null && mapping[k] !== undefined && mapping[k] >= 0 ? r[mapping[k]] : undefined);
    const mat = cell("material") === undefined ? null : parse_money_cents(cell("material"));
    const hrs = cell("labor_hours") === undefined ? null : parse_plain_number(cell("labor_hours"));
    const lab = cell("labor_cost") === undefined ? null : parse_money_cents(cell("labor_cost"));
    if (mat === null && hrs === null && lab === null) { bad.push(i); return; }
    const item = { row: i, code: String(cell("code") || "").trim(), name: String(cell("name") || "").trim(), unit: String(cell("unit") || "").trim(), mat, hrs, lab };
    if (item.code) byCode.set(item.code.toLowerCase(), item);
    if (item.name) byName.set(_keyname(item.name), item);
  });
  const out = [];
  assemblies.forEach((a) => (a.components || []).forEach((c, ci) => {
    let it = null, why = "";
    if (c.code && byCode.has(c.code.toLowerCase())) { it = byCode.get(c.code.toLowerCase()); why = "code " + c.code; }
    else if (byName.has(_keyname(c.name))) { it = byName.get(_keyname(c.name)); why = "name"; }
    else if (c.name && byName.has(_keyname(c.name.split(",")[0]))) { it = byName.get(_keyname(c.name.split(",")[0])); why = "name (without the pack size)"; }
    if (!it) return;
    const rate = c.labor_rate && rateOf.has(c.labor_rate) ? rateOf.get(c.labor_rate) : 0;
    let hours = it.hrs === null ? (c.labor_hours || 0) : it.hrs, needsRate = false;
    if (it.hrs === null && it.lab !== null) {
      if (rate > 0) hours = it.lab / rate;
      else needsRate = true;
    }
    const p = { assembly: a.id, assembly_name: a.name, component: ci, component_name: c.name, row: it.row, why,
      unit_from: c.unit, unit_to: it.unit, unit_mismatch: !!(it.unit && c.unit && it.unit.toLowerCase() !== c.unit.toLowerCase()),
      material_from: c.unit_cost_cents || 0, material_to: it.mat === null ? (c.unit_cost_cents || 0) : it.mat,
      hours_from: c.labor_hours || 0, hours_to: Math.round(hours * 1e6) / 1e6, labor_needs_rate: needsRate };
    if (it.mat === null && hours === (c.labor_hours || 0) && needsRate) return;
    out.push(p);
  }));
  return { proposals: out, unreadable_rows: bad };
}
function apply_price_proposals(assemblies, proposals) {
  const by = new Map();
  for (const p of proposals) { if (!by.has(p.assembly)) by.set(p.assembly, []); by.get(p.assembly).push(p); }
  return assemblies.map((a) => {
    if (!by.has(a.id)) return a;
    const comps = a.components.map((c, ci) => {
      const p = by.get(a.id).find((x) => x.component === ci);
      if (!p) return c;
      const out = Object.assign({}, c, { unit_cost_cents: Math.trunc(p.material_to) });
      if (p.hours_to) out.labor_hours = p.hours_to; else delete out.labor_hours;
      return out;
    });
    return Object.assign({}, a, { components: comps });
  });
}
