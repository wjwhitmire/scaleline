// Tests for the browser-only core added for team review, imports and exports: PDF object syntax,
// tool chest files, markup summaries, price lists, the XLSX writer, QR codes, live session message
// checks, and scan cleanup and line detection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { loadCore } from "./load_core.mjs";

const C = loadCore();
const plain = (x) => JSON.parse(JSON.stringify(x));

test("PDF object syntax: dictionaries, arrays, names, strings, numbers and references", () => {
  const o = plain(C.parse_pdf_object("<</Subtype/Polygon /IT /PolygonDimension /C [1 0 0.5] /Subj (Area \\(net\\)\\101) /T <FEFF0041006E0061> /P 3 0 R /N -12.5 /B true /Z null /Na#20me 1 % comment\n /H <41 42>>>"));
  assert.deepEqual(o, { Subtype: "/Polygon", IT: "/PolygonDimension", C: [1, 0, 0.5], Subj: "Area (net)A", T: "Ana", P: null, N: -12.5, B: true, Z: null, "Na me": 1, H: "AB" });
  assert.equal(C.parse_pdf_object("[1 2 R 3]").length, 2);
  for (const bad of ["<</A", "(unclosed", "<</A 1 >", "[1 2", "<zz>", "<<" .repeat(80) + ">>".repeat(80)]) assert.throws(() => C.parse_pdf_object(bad), bad);
  // keys that would touch the object prototype are dropped
  assert.equal(Object.keys(C.parse_pdf_object("<</__proto__ 1 /constructor 2 /ok 3>>")).join(), "ok");
});

test("plain annotation from a parsed dictionary", () => {
  const d = C.parse_pdf_object("<</Subtype/Line/IT/LineDimension/L[0 0 18 0]/Rect[0 0 18 2]/C[0 0 1]/CA 0.5/BS<</W 2>>/Contents(1'-0\")/Measure<</R(q)/X[<</U(ft)/C 0.0555556>>]/D[<</U(ft)/C 1>>]/A[<</U(sq ft)/C 1>>]>>>>");
  const a = plain(C.plain_annot(d));
  assert.equal(a.subtype, "Line");
  assert.deepEqual(a.measure.x, [{ u: "ft", c: 0.0555556 }]);
  assert.equal(a.width, 2);
  const r = C.annot_to_markup(a, { transform: [1, 0, 0, -1, 0, 100] }, 0, 0);
  assert.equal(r.markup.type, "length");
  assert.ok(Math.abs(r.scale - 0.6666672) < 1e-6);
});

const raw = (s) => s;
function btx(items) {
  return '<?xml version="1.0" encoding="utf-8"?>\n<BluebeamRevuToolSet Version="1"><Title>Drywall tools</Title>' +
    items.map((it, i) => "<ToolChestItem Version=\"1\"><Name>ITEM" + i + "</Name><Type>" + it.type + "</Type><Raw>" + it.raw + "</Raw><Index>" + i + "</Index></ToolChestItem>").join("") +
    "</BluebeamRevuToolSet>";
}
test("tool chest file: plain and zlib hex items become presets", () => {
  const area = "<</Subtype/Polygon/IT/PolygonDimension/Subj(Gypsum ceiling)/C[0 0.5 0]/IC[0 0.5 0]/CA 0.4/Vertices[0 0 10 0 10 10]/Measure<</X[<</U(ft)/C 0.05>>]>>>>";
  const count = "<</Subtype/Polygon/IT/PolygonCount/Subj(Receptacle)/C[1 0 0]/Vertices[0 0 1 0 1 1]>>";
  const callout = "<</Subtype/FreeText/IT/FreeTextCallout/Subj(RFI)/Contents(See detail)/DA(1 0 0 rg /Helv 14 Tf)/CL[5.5 5.5 40 35 53.8 35]>>";
  const hex = deflateSync(Buffer.from(count, "latin1")).toString("hex");
  const xml = btx([{ type: "Bluebeam.PDF.Annotations.AnnotationMeasureArea", raw: raw(area.replace(/</g, "&lt;").replace(/>/g, "&gt;")) },
    { type: "Bluebeam.PDF.Annotations.AnnotationMeasureCount", raw: hex }, { type: "Bluebeam.PDF.Annotations.AnnotationFreeText", raw: callout.replace(/</g, "&lt;").replace(/>/g, "&gt;") },
    { type: "x", raw: "&lt;&lt;/Subtype/Widget&gt;&gt;" }]);
  const f = C.btx_items(xml);
  assert.equal(f.title, "Drywall tools");
  assert.equal(f.items.length, 4);
  assert.equal(f.items[1].compressed, true);
  assert.equal(f.items[0].compressed, false);
  const p0 = plain(C.btx_preset(f.items[0], f.items[0].raw, 0));
  assert.equal(p0.tool, "area");
  assert.equal(p0.subject, "Gypsum ceiling");
  assert.equal(p0.color, "#008000");
  assert.equal(p0.opacity, 0.4);
  const text = Buffer.from(C.hex_bytes(f.items[1].raw)).toString("hex");
  assert.equal(text.slice(0, 4), "789c");
  const p1 = plain(C.btx_preset(f.items[1], count, 1));
  assert.equal(p1.tool, "count");
  const p2 = plain(C.btx_preset(f.items[2], callout, 2));
  assert.equal(p2.tool, "callout");
  assert.equal(p2.text, "See detail");
  assert.equal(p2.font_size, 14);
  assert.equal(C.btx_preset(f.items[3], "<</Subtype/Widget>>", 3), null);
  assert.throws(() => C.btx_items("<!DOCTYPE x [<!ENTITY a 'b'>]><x/>"));
});

test("markup summary CSV and XML become imported quantities", () => {
  const csv = "﻿Subject,Page Label,Author,Status,Length,Area,Count,Comments,Cost Code\r\n" +
    "Wall,A-101,Ana,Accepted,12'-6\",,,check,09 21 16\r\nFloor,A-102,Ben,,,\"1,250.5 sf\",,,09 65 19\r\nDoor,A-101,Ana,,,,7,,08 14 16\r\nBad,A-101,,,,,,,\r\n";
  const s = C.summary_from_csv(csv);
  const pages = { "A-101": 1, "A-102": 2 };
  const r = plain(C.summary_markups(s, (label) => (label in pages ? pages[label] : null), 3, "rv"));
  assert.equal(r.markups.length, 3);
  assert.deepEqual(r.skipped, [5]);
  assert.deepEqual(r.markups.map((m) => [m.page, m.qty.kind]), [[1, "length"], [2, "area"], [1, "count"]]);
  assert.equal(r.markups[0].qty.value, 150);
  assert.equal(r.markups[1].qty.value, 1250.5 * 144);
  assert.equal(r.markups[0].custom[r.columns[0].id], "09 21 16");
  assert.equal(r.columns[0].name, "Cost Code");
  const meas = C.measure(r.markups[1], null);
  assert.equal(meas.area_sq_in, 1250.5 * 144);
  const xml = "<Markups><Markup><Subject>Slab</Subject><Page_Label>A-102</Page_Label><Volume>3.5 cu yd</Volume></Markup>" +
    "<Markup><Subject>Curb</Subject><Page_Label>A-102</Page_Label><Length>40'</Length></Markup></Markups>";
  const x = plain(C.summary_markups(C.summary_from_xml(xml), (label) => (label in pages ? pages[label] : null), 3, "rx"));
  assert.deepEqual(x.markups.map((m) => [m.subject, m.page, m.qty.kind, m.qty.value]), [["Slab", 2, "volume", 3.5 * 46656], ["Curb", 2, "length", 480]]);
});

test("markup summary values: the unit written with the number wins over the column's unit", () => {
  const q = (s, h) => plain(C.parse_measurement(s, h));
  assert.deepEqual(q("250 sq m", "sf"), { kind: "area", value: 250 * 1550.0031000062 });
  assert.deepEqual(q("0.5 ac", "sf"), { kind: "area", value: 0.5 * 6272640 });
  assert.deepEqual(q("3.50 yd³", "cu ft"), { kind: "volume", value: 3.5 * 46656 });
  assert.deepEqual(q("125.5", "sf"), { kind: "area", value: 125.5 * 144 });
  assert.deepEqual(q("1,250", ""), { kind: "length", value: 15000 });
  assert.deepEqual(q("14 each", ""), { kind: "count", value: 14 });
  assert.equal(q("5 small", ""), null);
  const csv = "Subject,Page Label,Measurement,Measurement Unit\nWall,A-101,125.5,ft\nFloor,A-101,300,sf\nSlab,A-101,12,cy\n";
  const sm = plain(C.summary_markups(C.summary_from_csv(csv), () => 0, 1, "rv"));
  assert.deepEqual(sm.markups.map((m) => [m.subject, m.qty.kind, m.qty.value]), [["Wall", "length", 1506], ["Floor", "area", 43200], ["Slab", "volume", 12 * 46656]]);
});

test("price list: column guess, proposals by code then name, apply", () => {
  const csv = "Item Code,Description,UOM,Unit Price,Labor Hours\nGWB-12,Gypsum board 1/2 in,SHEET,$14.50,0.25\n,Studs,EA,\"3.89\",\n,Junk,EA,n/a,\n";
  const p = C.parse_csv(csv);
  const map = plain(C.price_columns_guess(p.rows[0]));
  assert.deepEqual(map, { code: 0, name: 1, unit: 2, material: 3, labor_hours: 4 });
  const asm = [{ id: "a", name: "Wall", components: [{ name: "Board", code: "gwb-12", unit: "SHEET", unit_cost_cents: 0 }, { name: "Studs, boxes of 1000", unit: "EA" }, { name: "Nails" }] }];
  const r = plain(C.price_proposals(asm, p.rows.slice(1), map));
  assert.deepEqual(r.unreadable_rows, [2]);
  assert.deepEqual(r.proposals.map((x) => [x.component, x.material_to, x.hours_to, x.why]), [[0, 1450, 0.25, "code gwb-12"], [1, 389, 0, "name (without the pack size)"]]);
  const applied = plain(C.apply_price_proposals(asm, r.proposals));
  assert.equal(applied[0].components[0].unit_cost_cents, 1450);
  assert.equal(applied[0].components[0].labor_hours, 0.25);
  assert.equal(applied[0].components[2].unit_cost_cents, undefined);
  assert.equal(C.parse_money_cents("(1,234.50)"), -123450);
});

test("price list: a labor price stays labor, as hours at the component's rate", () => {
  const csv = "Code,Material,Labor\nA1,10.00,45.00\nB2,,30.00\n";
  const p = C.parse_csv(csv);
  const map = plain(C.price_columns_guess(p.rows[0], p.rows.slice(1)));
  assert.deepEqual(map, { code: 0, material: 1, labor_cost: 2 });
  // a "Material" column of words is the name, of amounts the price
  assert.deepEqual(plain(C.price_columns_guess(["Material", "Price"], [["Gypsum board", "14.50"]])), { name: 0, material: 1 });
  const rates = [{ id: "carp", name: "Carpenter", cents_per_hour: 6000 }];
  const asm = [{ id: "a", name: "Wall", components: [{ name: "Board", code: "A1", unit: "EA", source: "count", labor_rate: "carp" }, { name: "Trim", code: "B2", unit: "EA", source: "count" }] }];
  const r = plain(C.price_proposals(asm, p.rows.slice(1), map, rates));
  // 45.00 a unit at 60.00 an hour is 0.75 h; material is the material price alone
  assert.deepEqual(r.proposals.map((x) => [x.component, x.material_to, x.hours_to, x.labor_needs_rate]), [[0, 1000, 0.75, false]]);
  // without a rate and without a material price there is nothing to apply: it is not folded into material
  const est = C.estimate([C.apply_price_proposals(asm, r.proposals)[0]], { a: [{ kind: "count", count: 4, value: 4 }] }, 0, 0, 0, rates);
  assert.equal(est.material_cents, 4000);
  assert.equal(est.labor_cents, 18000);
  const r2 = plain(C.price_proposals([{ id: "b", name: "x", components: [{ name: "Board", code: "A1", unit: "EA" }] }], p.rows.slice(1), map, []));
  assert.deepEqual(r2.proposals.map((x) => [x.material_to, x.hours_to, x.labor_needs_rate]), [[1000, 0, true]]);
});

test("XLSX: a stored zip with the parts a workbook needs", () => {
  const z = C.xlsx_workbook([{ name: "Markups", rows: [[{ v: "Page", s: 1 }, "=1+1"], [1, 2.5]], freeze: true, filter: true }, { name: "Mark/ups", rows: [["x"]] }]);
  const text = Buffer.from(z).toString("latin1");
  assert.equal(text.slice(0, 4), "PK\u0003\u0004");
  for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "_rels/.rels"]) assert.ok(text.includes(part), part);
  assert.ok(text.includes('t="inlineStr"><is><t xml:space="preserve">=1+1</t>'), "text that looks like a formula stays text");
  assert.ok(!/<f>/.test(text) && !/vbaProject/.test(text));
  assert.equal(C.crc32(C.utf8("The quick brown fox jumps over the lazy dog")), 0x414fa339);
  assert.equal(C.col_name(0) + C.col_name(25) + C.col_name(26) + C.col_name(701), "AZAAZZ");
});

test("QR: versions grow with the text, and too much text is refused", () => {
  const a = C.qr_encode("hello", "M");
  assert.equal(a.version, 1);
  assert.equal(a.size, 21);
  const b = C.qr_encode("x".repeat(600), "L");
  assert.ok(b.version >= 15 && b.size === b.version * 4 + 17);
  assert.throws(() => C.qr_encode("x".repeat(3000), "H"));
});

test("live session: every message is checked field by field", () => {
  const ctx = { numPages: 3, host: false, locked: false };
  const pdf = "a".repeat(64);
  assert.equal(C.peer_message({ t: "hello", v: 1, name: "Ana‮", pdf, peer: "p1" }, ctx).name, "Ana");
  for (const bad of [null, [], { t: "eval" }, { t: "hello", v: 2, name: "x", pdf, peer: "p" }, { t: "hello", v: 1, name: "", pdf, peer: "p" },
    { t: "cursor", page: 9, x: 1, y: 1 }, { t: "cursor", page: 0, x: "1", y: 1 }, { t: "cursor", page: 0, x: 1e9, y: 1 },
    { t: "put", markup: { id: "__proto__", type: "count", page: 0, points: [[0, 0]] } }, { t: "put", markup: { id: "a", type: "count", page: 7, points: [[0, 0]] } },
    { t: "del", id: "bad id" }, { t: "comment", id: "a", comment: { id: "c", text: "" } }, { t: "lock", locked: true }, { t: "roster", peers: [] },
    { t: "signal", to: "a", from: "b", kind: "offer", sdp: "<script>" }, { t: "draft", page: 0, type: "script", points: [] }]) {
    assert.ok(C.peer_message(bad, ctx).error, JSON.stringify(bad));
  }
  const put = C.peer_message({ t: "put", markup: { id: "m1", type: "length", page: 1, points: [[0, 0], [10, 0]], subject: "x".repeat(500), evil: 1 } }, ctx);
  assert.equal(put.markup.subject.length, 200);
  assert.equal(put.markup.evil, undefined);
  assert.ok(C.peer_message({ t: "put", markup: { id: "m1", type: "length", page: 1, points: [[0, 0], [10, 0]] } }, { numPages: 3, host: false, locked: true }).error);
  assert.equal(C.peer_message({ t: "lock", locked: true }, { numPages: 3, host: true }).locked, true);
  // rate limit: a burst then refusal, then refill
  let st = null, ok = 0;
  for (let i = 0; i < 100; i++) { const [y, s] = C.peer_rate(st, "comment", 0); st = s; if (y) ok++; }
  assert.equal(ok, 20);
  assert.equal(C.peer_rate(st, "comment", 1)[0], true);
});

test("session codes, fingerprints, mentions and assignment", () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253]);
  assert.deepEqual(Array.from(C.b64url_decode(C.b64url_encode(bytes))), Array.from(bytes));
  assert.throws(() => C.b64url_decode("not base64!"));
  const code = { k: "offer", sdp: "v=0\r\na=fingerprint:sha-256 AB:CD\r\n", name: "Ana", pdf: "b".repeat(64), peer: "p1", session: "s1" };
  assert.equal(C.session_code_check(code).k, "offer");
  assert.throws(() => C.session_code_check(Object.assign({}, code, { sdp: "x" })));
  assert.throws(() => C.session_code_check(Object.assign({}, code, { pdf: "zz" })));
  const a = "v=0\r\na=fingerprint:sha-256 AA:BB\r\n", b = "v=0\r\na=fingerprint:sha-256 CC:DD\r\n";
  assert.equal(C.session_fingerprint_input(a, b), C.session_fingerprint_input(b, a));
  assert.equal(C.fingerprint_groups("0001ffff00000000"), "0001 5535 0000 0000");
  assert.equal(C.sdp_lan_only("a=candidate:1 1 udp 1 10.0.0.2 5000 typ host\r\na=candidate:2 1 udp 1 1.2.3.4 5000 typ srflx raddr 0.0.0.0"), "a=candidate:1 1 udp 1 10.0.0.2 5000 typ host");
  assert.deepEqual(plain(C.mentions("ping @Ben and @ana.lee, not me@mail")), ["Ben", "ana.lee"]);
  assert.equal(C.assigned_to({ assignee: "Ben Ortiz" }, "ben ortiz"), true);
  assert.equal(C.assigned_to({ comments: [{ id: "c", text: "@Ben check this" }] }, "Ben Ortiz"), true);
  assert.equal(C.assigned_to({ comments: [{ id: "c", text: "@Ben check this", resolved: true }] }, "Ben"), false);
  assert.equal(C.assigned_to({ comments: [{ id: "c", text: "@Ben" }] }, ""), false);
});

test("scans: threshold, skew, despeckle, lines, crossings, recognized words", () => {
  const w = 400, h = 300, g = new Uint8Array(w * h).fill(255);
  for (let y = 40; y < 280; y += 40) for (let x = 30; x < 370; x++) { g[y * w + x] = 20; g[(y + 1) * w + x] = 20; }
  for (let x = 30; x < 371; x += 85) for (let y = 40; y < 242; y++) g[y * w + x] = 20;
  for (let i = 0; i < 40; i++) g[(10 + (i * 37) % 280) * w + (5 + (i * 53) % 390)] = 30; // specks
  assert.ok(Math.abs(C.otsu_threshold(g) - 137) < 120);
  const turned = C.rotate_gray(g, w, h, 2.5);
  assert.ok(Math.abs(C.estimate_skew(turned, w, h) - 2.5) <= 0.15);
  const clean = C.clean_scan(turned, w, h);
  assert.ok(Math.abs(clean.skew - 2.5) <= 0.15);
  const mask = C.ink_mask(g, 128);
  const ds = C.despeckle(mask, w, h, 4);
  assert.equal(ds[(10) * w + 5], 0);
  assert.equal(ds[40 * w + 100], 1);
  const segs = C.detect_lines(ds, w, h, { minLen: 40 });
  const hs = segs.filter((s) => s[1] === s[3]), vs = segs.filter((s) => s[0] === s[2]);
  assert.equal(hs.length, 6);
  assert.equal(vs.length, 5);
  assert.ok(Math.abs(hs[0][1] - 40.5) < 0.6 && hs[0][0] === 30 && hs[0][2] === 370);
  const x = C.line_intersections(segs, 2);
  assert.ok(x.length >= 25);
  const sl = C.scan_lines(g, w, h, { minLen: 40, speck: 4 });
  assert.equal(sl.segs.length, 11);
  assert.ok(sl.ints.length >= 25);
  // turned 1.5 degrees: lines are still found, and their crossings land back on the turned picture
  const tg = C.rotate_gray(g, w, h, 1.5);
  const st = C.scan_lines(tg, w, h, { minLen: 40, speck: 4 });
  assert.ok(Math.abs(st.skew - 1.5) <= 0.15, String(st.skew));
  assert.ok(st.segs.length >= 10);
  const corner = C.rotate_point(30, 40.5, w, h, 1.5, false);
  assert.ok(st.ints.some((q) => Math.hypot(q[0] - corner[0], q[1] - corner[1]) < 2.5), JSON.stringify(corner));
  const words = C.tsv_words("level\tpage\n5\t1\t1\t1\t1\t1\t100\t200\t60\t20\t93.3\tSCALE:\n5\t1\t1\t1\t1\t2\t170\t200\t40\t20\t90\t1/4\"\n5\t1\t2\t1\t1\t1\t10\t10\t40\t20\t20\tnoise\n");
  assert.equal(words.length, 3);
  const items = plain(C.ocr_text_items(words, 2, 0, w, h));
  assert.deepEqual(items, [{ str: "SCALE: 1/4\"", x: 50, y: 110, w: 55, h: 10, vertical: false }]);
  assert.equal(C.ocr_fix_marks("SCALE: 1/4\" = 1-0\""), "SCALE: 1/4\" = 1'-0\"");
  assert.equal(C.ocr_fix_marks("SCALE: 1/8\" = 1'-0\""), "SCALE: 1/8\" = 1'-0\"");
  assert.equal(C.ocr_fix_marks("ROOM 1-0"), "ROOM 1-0");
  const low = C.tsv_words("5\t1\t1\t1\t1\t1\t100\t200\t60\t20\t93\tSCALE:\n5\t1\t1\t1\t1\t2\t170\t200\t40\t20\t90\t1/4\"\n5\t1\t1\t1\t1\t3\t215\t200\t10\t20\t95\t=\n5\t1\t1\t1\t1\t4\t230\t200\t40\t20\t20\t1-0\"\n5\t1\t1\t1\t1\t5\t280\t200\t40\t20\t20\tFOO\n");
  assert.equal(C.ocr_text_items(low, 1, 0, w, h)[0].str, "SCALE: 1/4\" = 1'-0\"");
  const pgm = C.pgm_bytes(new Uint8Array([0, 255, 128, 64]), 2, 2);
  assert.equal(Buffer.from(pgm.slice(0, 11)).toString("latin1"), "P5\n2 2\n255\n");
});
