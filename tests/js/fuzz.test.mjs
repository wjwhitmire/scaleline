// Fuzzing the parts that read untrusted input: live session messages from peers, session codes,
// the XML and PDF object readers, CSV and markup summary imports. Seeded, so a failure repeats.
import test from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load_core.mjs";

const C = loadCore();
const plain = (v) => JSON.parse(JSON.stringify(v));

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NASTY = ["__proto__", "constructor", "prototype", "toString", "<img src=x onerror=alert(1)>", "<script>alert(1)</script>", "javascript:alert(1)",
  "‮evil", "\u0000\u0007", "a".repeat(5000), "", " ", "1e309", "NaN", "-0", "p1", "m1", "v=0", "@Ana", "=cmd|' /C calc'!A0", "../../etc/passwd", "😀".repeat(50)];
const KEYS = ["t", "v", "name", "pdf", "peer", "host", "peers", "locked", "page", "x", "y", "type", "points", "markup", "id", "comment", "to", "from", "kind",
  "sdp", "markups", "text", "author", "subject", "label", "color", "custom", "holes", "comments", "status_log", "__proto__", "constructor"];

function value(r, depth) {
  const k = r();
  if (depth > 4 || k < 0.15) return [null, true, false, 0, -1, 1.5, 1e308, -1e308, 2 ** 53, Number.MAX_SAFE_INTEGER, 3, 7][Math.floor(r() * 12)];
  if (k < 0.4) return NASTY[Math.floor(r() * NASTY.length)];
  if (k < 0.55) return [Math.floor(r() * 3), r() * 1e7 - 5e6];
  if (k < 0.7) { const n = Math.floor(r() * 6); const a = []; for (let i = 0; i < n; i++) a.push(value(r, depth + 1)); return a; }
  const o = {};
  const n = Math.floor(r() * 6);
  for (let i = 0; i < n; i++) o[KEYS[Math.floor(r() * KEYS.length)]] = value(r, depth + 1);
  return o;
}
function message(r) {
  const m = value(r, 3) && r() < 0.2 ? value(r, 0) : {};
  if (r() < 0.9 && m && typeof m === "object" && !Array.isArray(m)) {
    m.t = r() < 0.9 ? C.PEER_TYPES[Math.floor(r() * C.PEER_TYPES.length)] : NASTY[Math.floor(r() * NASTY.length)];
    for (let i = 0; i < 1 + r() * 5; i++) m[KEYS[Math.floor(r() * KEYS.length)]] = value(r, 1);
    if (m.t === "hello") Object.assign(m, { v: 1, name: value(r, 2), pdf: r() < 0.5 ? "a".repeat(64) : value(r, 4), peer: r() < 0.5 ? "p1" : value(r, 4) });
    if (m.t === "put" && r() < 0.5) m.markup = { id: "m" + Math.floor(r() * 9), type: C.MARKUP_TYPES[Math.floor(r() * C.MARKUP_TYPES.length)], page: Math.floor(r() * 4), points: [[r() * 9, 1], [2, r() * 9], [5, 5]], subject: value(r, 3), comments: [{ id: "c1", text: value(r, 3), author: value(r, 3) }] };
  }
  // what arrives on the wire is JSON text; a JSON copy keeps __proto__ as an own key like the real thing
  return JSON.parse(JSON.stringify(m) || "null");
}
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/;
function walkStrings(v, f) {
  if (typeof v === "string") f(v);
  else if (Array.isArray(v)) v.forEach((x) => walkStrings(x, f));
  else if (v && typeof v === "object") for (const k of Object.keys(v)) { f(k); walkStrings(v[k], f); }
}

function walkKeys(v, f) {
  if (Array.isArray(v)) v.forEach((x) => walkKeys(x, f));
  else if (v && typeof v === "object") for (const k of Object.keys(v)) { f(k); walkKeys(v[k], f); }
}
const str = (v) => (typeof v === "string" ? v : JSON.stringify(v) || "");

test("fuzz: live session messages never throw and come out clean", () => {
  const r = rng(1234);
  let accepted = 0;
  for (let i = 0; i < 20000; i++) {
    const msg = message(r);
    const ctx = { numPages: 3, host: r() < 0.3, locked: r() < 0.2 };
    let out;
    assert.doesNotThrow(() => { out = C.peer_message(msg, ctx); }, JSON.stringify(msg).slice(0, 300));
    assert.ok(out && typeof out === "object");
    if (out.error) { assert.equal(typeof out.error, "string"); continue; }
    accepted++;
    assert.ok(C.PEER_TYPES.includes(out.t));
    assert.ok(JSON.stringify(out).length <= C.PEER_MAX_BYTES * 2);
    walkStrings(out, (s) => { if (out.t !== "signal") assert.ok(!CTRL.test(s), "control or direction character in " + JSON.stringify(s).slice(0, 60)); });
    walkKeys(out, (k) => assert.ok(!["__proto__", "constructor", "prototype"].includes(k), "reserved key " + k));
    if (out.t === "put") assert.deepEqual(plain(C.clean_markup(out.markup)), plain(out.markup));
    if (out.t === "state") for (const m of out.markups) assert.ok(m.page < 3);
    if (["roster", "lock"].includes(out.t)) assert.equal(ctx.host, true);
    if (ctx.locked && !ctx.host) assert.ok(!["put", "del", "comment", "draft", "state"].includes(out.t));
    if (out.name !== undefined) assert.ok(Array.from(out.name).length <= 60 && out.name.length > 0);
  }
  assert.ok(accepted > 1000, "the fuzzer reaches the accepting paths (" + accepted + ")");
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.toString.call({}), "[object Object]");
});

test("fuzz: rate buckets take any message type without throwing or growing", () => {
  for (const t of ["constructor", "__proto__", "toString", "hasOwnProperty", "cursor", "nope", 5, null]) {
    const kind = C.peer_kind({ t });
    assert.ok(C.PEER_TYPES.includes(kind) || kind === "other");
    assert.doesNotThrow(() => C.peer_rate(null, kind, 0));
    assert.doesNotThrow(() => C.peer_rate(null, t, 0));
  }
  assert.equal(C.peer_kind({ t: "constructor" }), "other");
  assert.equal(C.peer_kind(null), "other");
});

test("local network only: public candidates are dropped on both sides", () => {
  const sdp = ["v=0", "a=fingerprint:sha-256 AB:CD", "a=candidate:1 1 udp 2122 192.168.1.20 5000 typ host generation 0",
    "a=candidate:2 1 udp 2122 8.8.8.8 5000 typ host", "a=candidate:3 1 udp 1686 10.0.0.2 6000 typ srflx raddr 0.0.0.0 rport 0",
    "a=candidate:4 1 udp 2122 3d1c5d4e-1111-2222-3333-444455556666.local 5000 typ host", "a=candidate:5 1 udp 2122 2001:db8::1 5000 typ host",
    "a=candidate:6 1 udp 2122 fe80::1 5000 typ host", "a=candidate:7 1 tcp 1518 172.20.0.3 9 typ host tcptype active",
    "a=candidate:8 1 udp 41 1.2.3.4 3478 typ relay raddr 0.0.0.0 rport 0", "a=candidate:9 1 udp 2122 evil.example.com 5000 typ host", "a=end-of-candidates"].join("\r\n");
  const kept = C.sdp_lan_only(sdp).split("\r\n").filter((l) => l.startsWith("a=candidate")).map((l) => l.split(" ")[0]);
  assert.deepEqual(kept, ["a=candidate:1", "a=candidate:4", "a=candidate:6", "a=candidate:7"]);
  assert.ok(C.sdp_lan_only(sdp).includes("a=fingerprint:sha-256 AB:CD") && C.sdp_lan_only(sdp).includes("a=end-of-candidates"));
  for (const a of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.1.1", "127.0.0.1", "100.64.0.1", "192.0.2.2", "fd00::1", "::1", "abc.local"]) assert.ok(C.lan_address(a), a);
  for (const a of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "1.1.1.1", "2001:4860::8888", "example.com", "", "local", "x.local.example.com"]) assert.ok(!C.lan_address(a), a);
});

test("fuzz: session codes, XML, PDF objects, CSV and summaries refuse hostile input cleanly", () => {
  const r = rng(99);
  const known = (e) => e && (e.name === "TakeoffError" || e instanceof Error);
  for (let i = 0; i < 3000; i++) {
    const obj = message(r);
    if (r() < 0.5) Object.assign(obj || {}, { k: "offer", sdp: "v=0\r\n" + str(value(r, 3)), name: value(r, 3), pdf: "c".repeat(64), peer: "p2", session: "s1" });
    try { const c = C.session_code_check(obj); assert.ok(c.sdp.length <= 20000 && c.name.length); } catch (e) { assert.ok(known(e)); }
    const chunk = Array.from({ length: 1 + Math.floor(r() * 30) }, () => str(value(r, 3)).slice(0, 40)).join(["<", ">", "/", "<<", ">>", "(", ")", "[", "]", " ", "\n", "&", "\"", "="][Math.floor(r() * 14)]);
    for (const f of [C.parse_xml, C.parse_pdf_object, (t) => C.parse_csv(t, 1000), C.summary_from_csv, C.summary_from_xml, C.btx_items]) {
      try { f(chunk); } catch (e) { assert.ok(known(e), f.name + ": " + e); }
    }
  }
  assert.equal({}.polluted, undefined);
});

test("XML and PDF readers stay linear on long tags, deep nesting and prototype keys", () => {
  for (const text of ["<a " + "x".repeat(400000) + "></a>", "<a " + "x=\"1\" ".repeat(50000) + "/>", "<" + "a".repeat(300000) + "/>",
    "<!DOCTYPE a [<!ENTITY x \"y\">]><a>&x;</a>", "<a>" + "<b>".repeat(1000) + "</a>"]) {
    const t0 = Date.now();
    try { C.parse_xml(text); } catch (e) { assert.equal(e.name, "TakeoffError"); }
    assert.ok(Date.now() - t0 < 1500, "parse_xml took " + (Date.now() - t0) + " ms on " + text.slice(0, 30));
  }
  const x = C.parse_xml('<r __proto__="1" constructor="2" a="3"><__proto__>z</__proto__></r>');
  assert.deepEqual(Object.keys(x.attrs), ["a"]);
  assert.equal({}.z, undefined);
  const d = C.parse_pdf_object("<< /__proto__ << /polluted true >> /constructor 1 /A 2 >>");
  assert.deepEqual(Object.keys(d), ["A"]);
  assert.equal({}.polluted, undefined);
  let deep = "";
  for (let i = 0; i < 200; i++) deep += "[";
  assert.throws(() => C.parse_pdf_object(deep), /deeply|end/i);
  const s = C.summary_from_csv("__proto__,constructor,Subject,Length\nx,y,Wall,10'\n");
  const out = C.summary_markups(s, () => 0, 1, "rv");
  assert.equal(out.markups.length, 1);
  assert.equal({}.x, undefined);
});
