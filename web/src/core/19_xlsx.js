// A small XLSX writer (Office Open XML spreadsheet, ISO/IEC 29500) built by hand: worksheets of
// numbers and text with a bold header row, number formats, column widths, a frozen header and a
// filter, zipped without compression (stored). No macros, no formulas, no shared strings, no links
// to other files: text is written inline, so a cell that starts with = is text, never a formula,
// and such a cell also carries the quote prefix style, so editing it in a spreadsheet program
// keeps it text instead of turning it into a formula.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function utf8(s) {
  const out = [];
  for (const ch of String(s)) {
    let cp = ch.codePointAt(0);
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}
// Stored (method 0) zip: local headers, data, central directory, end record. Times are fixed at
// 1980-01-01 so the same workbook gives the same bytes.
function zip_store(files) {
  const parts = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255];
  const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = utf8(f.name), data = f.data instanceof Uint8Array ? f.data : utf8(f.data);
    const crc = crc32(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    const local = Uint8Array.from([...u32(0x04034b50), ...common]);
    parts.push(local, name, data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = parts.concat(central, [end]);
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let k = 0;
  for (const b of all) { out.set(b, k); k += b.length; }
  return out;
}
function xml_escape(s) {
  return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function col_name(i) { let s = "", n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
// Styles: 0 plain, 1 bold header, 2 number with two places, 3 money, 4 bold money, 5 bold number, 6 whole number,
// 7 text with the quote prefix, 8 bold text with the quote prefix.
const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/>' +
  '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" quotePrefix="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
// Text a spreadsheet program would read as a formula (or a DDE call) if it were typed in.
const XLSX_FORMULA_START = /^[=+\-@\t\r\uff1d\uff0b\uff0d\uff20]/;
// A cell is a number, text, null, or {v, s} with a style number.
function sheet_xml(sheet) {
  const rows = sheet.rows || [];
  const widths = sheet.widths || [];
  const ncols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  if (sheet.freeze) x += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  if (widths.length) x += "<cols>" + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.max(4, Math.min(100, w)) + '" customWidth="1"/>').join("") + "</cols>";
  x += "<sheetData>";
  rows.forEach((r, ri) => {
    x += '<row r="' + (ri + 1) + '">';
    r.forEach((cell, ci) => {
      if (cell === null || cell === undefined || cell === "") return;
      const ref = col_name(ci) + (ri + 1);
      const v = isObj(cell) ? cell.v : cell, s = isObj(cell) && cell.s ? ' s="' + cell.s + '"' : "";
      if (v === null || v === undefined || v === "") return;
      if (typeof v === "number" && Number.isFinite(v)) x += '<c r="' + ref + '"' + s + "><v>" + v + "</v></c>";
      else {
        const text = Array.from(String(v)).slice(0, 32767).join("");
        const st = XLSX_FORMULA_START.test(text) ? ' s="' + (isObj(cell) && cell.s === 1 ? 8 : 7) + '"' : s;
        x += '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xml_escape(text) + "</t></is></c>";
      }
    });
    x += "</row>";
  });
  x += "</sheetData>";
  if (sheet.filter && rows.length > 1 && ncols) x += '<autoFilter ref="A1:' + col_name(ncols - 1) + rows.length + '"/>';
  return x + "</worksheet>";
}
function xlsx_workbook(sheets) {
  const names = [];
  const safe = sheets.map((s, i) => {
    let n = String(s.name || "Sheet" + (i + 1)).replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet" + (i + 1);
    while (names.includes(n.toLowerCase())) n = n.slice(0, 28) + " " + (i + 1);
    names.push(n.toLowerCase());
    return Object.assign({}, s, { name: n });
  });
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    safe.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") + "</Types>";
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const defined = safe.map((s, i) => (s.filter && (s.rows || []).length > 1
    ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">&apos;' + xml_escape(s.name) + "&apos;!$A$1:$" +
      col_name(Math.max(0, (s.rows[0] || []).length - 1)) + "$" + s.rows.length + "</definedName>" : "")).join("");
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    safe.map((s, i) => '<sheet name="' + xml_escape(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + "</sheets>" +
    (defined ? "<definedNames>" + defined + "</definedNames>" : "") + "</workbook>";
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    safe.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") +
    '<Relationship Id="rId' + (safe.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const files = [
    { name: "[Content_Types].xml", data: ct }, { name: "_rels/.rels", data: rels }, { name: "xl/workbook.xml", data: wb },
    { name: "xl/_rels/workbook.xml.rels", data: wbRels }, { name: "xl/styles.xml", data: XLSX_STYLES },
  ].concat(safe.map((s, i) => ({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: sheet_xml(s) })));
  return zip_store(files);
}
// The markups list and the estimate as worksheets.
function markups_sheet(rows, columns) {
  const head = ["Page", "Sheet", "Type", "Subject", "Label", "Layer", "Author", "Status", "Date", "Measurement", "Quantity", "Unit"].concat(columns.map((c) => c.name));
  const out = [head.map((h) => ({ v: h, s: 1 }))];
  for (const r of rows) {
    out.push([r.page, r.sheet, r.type, r.subject, r.label, r.layer, r.author, r.status, r.date, r.measurement,
      r.quantity === null ? null : { v: r.quantity, s: 2 }, r.unit].concat(columns.map((c) => r.custom[c.id] || "")));
  }
  return { name: "Markups", rows: out, widths: [6, 10, 14, 24, 18, 14, 14, 11, 20, 18, 12, 8].concat(columns.map(() => 16)), freeze: true, filter: true };
}
function estimate_sheet(est) {
  const out = [["Assembly", "Component", "Need with waste", "Order", "Unit", "Unit cost", "Material", "Labor hours", "Labor", "Cost"].map((h) => ({ v: h, s: 1 }))];
  for (const line of est.lines) {
    for (const c of line.components) {
      out.push([line.name, c.name, { v: c.with_waste, s: 2 }, { v: c.order, s: 2 }, c.unit, { v: c.unit_cost_cents / 100, s: 3 },
        { v: c.material_cents / 100, s: 3 }, { v: c.labor_hours, s: 2 }, { v: c.labor_cents / 100, s: 3 }, { v: c.cost_cents / 100, s: 3 }]);
    }
    out.push([{ v: line.name, s: 1 }, { v: "Assembly total", s: 1 }, null, null, null, null, { v: line.material_cents / 100, s: 4 }, null, { v: line.labor_cents / 100, s: 4 }, { v: line.cost_cents / 100, s: 4 }]);
  }
  out.push([]);
  for (const [label, key] of [["Material", "material_cents"], ["Labor", "labor_cents"], ["Subtotal", "subtotal_cents"], ["Overhead", "overhead_cents"], ["Markup", "markup_cents"], ["Tax", "tax_cents"], ["Total", "total_cents"]]) {
    out.push([{ v: label, s: 1 }, null, null, null, null, null, null, null, null, { v: (est[key] || 0) / 100, s: label === "Total" ? 4 : 3 }]);
  }
  return { name: "Estimate", rows: out, widths: [30, 34, 14, 10, 8, 12, 12, 12, 12, 14], freeze: true };
}
