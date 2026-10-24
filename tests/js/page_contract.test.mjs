// Static checks on web/app.html and docs/index.html: the page contract and the security rules
// in SECURITY.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadCore, root } from "./load_core.mjs";

const html = readFileSync(join(root, "web", "app.html"), "utf8");
const docs = readFileSync(join(root, "docs", "index.html"), "utf8");
const block = (id) => { const m = new RegExp('<script[^>]*id="' + id + '"[^>]*>\\n?([\\s\\S]*?)\\n?</script>').exec(html); return m ? m[1] : null; };
const own = block("core") + "\n" + block("ui");
const markupOnly = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/, "");

test("standalone page contract: title, fonts link, style, no document tags", () => {
  const lines = html.split("\n");
  assert.match(lines[0], /^<title>[^<]+<\/title>$/);
  assert.ok(lines[1].startsWith('<link rel="stylesheet" href="https://fonts.googleapis.com/'));
  assert.equal(lines[2], "<style>");
  assert.ok(!/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(html));
  assert.ok(!new RegExp(["cla", "ude:"].join(""), "i").test(html), "no host-specific meta tags");
});

test("one network gate, every switch off by default", () => {
  const gate = /\nasync function net\(feature, url, opts\) \{[\s\S]*?\n\}\n/.exec(own);
  assert.ok(gate, "the net() gate is missing");
  assert.equal([...own.matchAll(/\bfetch\s*\(/g)].length, 1, "fetch is called only inside net()");
  assert.match(gate[0], /\bfetch\s*\(/);
  // the gate allows three features, each with exact addresses: OCR (the language data and the text
  // engine file on this same site), the on-device model (its library, model library and every pinned
  // model file, redirects only to the repository's own hosts), and the providers' two addresses
  assert.match(own, /const NET_FEATURES = Object\.freeze\(\{\n  ocr: Object\.freeze\(\{ title: "OCR", urls: Object\.freeze\(\[OCR_DATA\.url, OCR_WASM_URL\]\) \}\),\n/);
  assert.match(own, /"ai-local": Object\.freeze\(\{ title: "AI on this device", urls: Object\.freeze\(\[C\.LOCAL_MODEL\.lib, C\.LOCAL_MODEL\.modelLib\]\.concat\(C\.LOCAL_MODEL\.files\.map\(\(f\) => f\.url\)\)\),\n    redirectHosts: Object\.freeze\(\["huggingface\.co", "hf\.co"\]\) \}\)/);
  // only that feature follows redirects, and only to those hosts
  assert.match(gate[0], /redirect: hosts \? "follow" : "error"/);
  assert.match(gate[0], /if \(r\.redirected\)[\s\S]*throw new Error\("Blocked: a redirect to/);
  assert.equal([...own.matchAll(/redirectHosts:/g)].length, 1);
  assert.match(own, /"ai-cloud": Object\.freeze\(\{ title: "AI with your own key", urls: null \}\)/);
  // that switch reaches only the one address Settings names, through the same gate
  const decide = /\nfunction netDecision\(feature, url\) \{[\s\S]*?\n\}\n/.exec(own)[0];
  assert.match(decide, /const service = feature === "ai-cloud" \? C\.ai_endpoint\(S\.settings\.aiBase \|\| ""\) : null;/);
  assert.match(decide, /const urls = service \? \(service\.ok \? \[service\.url\] : \[\]\) : f\.urls;/);
  assert.match(decide, /!urls\.includes\(u\.href\)/);
  assert.match(own, /const OCR_WASM_URL = new URL\(OCR_WASM\.file, document\.baseURI\)\.href;/);
  const pin = JSON.parse(/const OCR_WASM = Object\.freeze\((\{[^)]*\})\);/.exec(own)[1]);
  const pins = JSON.parse(readFileSync(join(root, "web", "vendor", "pins.json"), "utf8"));
  assert.deepEqual([pin.file, pin.sri], [pins.ocrWasm.file, pins.ocrWasm.sri]);
  // peer connections are made in one place, behind the Live session switch
  assert.equal([...own.matchAll(/new RTCPeerConnection\b/g)].length, 1);
  const peer = /\nfunction netPeer\(\) \{[\s\S]*?\n\}\n/.exec(own);
  assert.ok(peer && /new RTCPeerConnection/.test(peer[0]) && /switchOn\("live"\)/.test(peer[0]));
  assert.ok(!/RTCPeerConnection\s*\(/.test(own.replace(peer[0], "")), "no other peer connections");
  // every switch starts off: the default settings turn nothing on
  assert.match(own, /net: \{\},\s+\/\/ network switches turned on/);
  const code = own.split("\n").filter((ln) => !/^\s*\/\//.test(ln)).join("\n");
  const calls = [...code.matchAll(/\bnet\("([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(Array.from(new Set(calls)).sort(), ["ai-cloud", "ai-local", "ocr"], "only the pinned OCR downloads, the pinned model files and the chosen provider call the gate");
  // the on-device model's library is the one module loaded at run time, after the gate allows it
  const imports = [...code.matchAll(/\bimport\s*\(/g)];
  assert.equal(imports.length, 1);
  const local = /\nasync function localEngine\(onProgress\) \{[\s\S]*?\n\}\n/.exec(own);
  assert.ok(local && /netDecision\("ai-local", L\.lib\)[\s\S]*if \(!d\.ok\) throw[\s\S]*await ensureModelFiles\([\s\S]*import\(L\.lib\)/.test(local[0]));
  // every model file is checked against its pin before it is kept, and a bad one is refused
  const ensure = /\nasync function ensureModelFiles\(onProgress\) \{[\s\S]*?\n\}\n/.exec(own);
  assert.ok(ensure && /net\("ai-local", f\.url\)[\s\S]*if \(!\(await ok\(buf\)\)\) throw[\s\S]*cache\.put\(f\.url/.test(ensure[0]));
});

test("our scripts make no network calls and use no eval, HTML sinks or blocking dialogs", () => {
  const banned = [/XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/, /\beval\s*\(/, /new\s+Function/,
    /innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\b(alert|confirm|prompt)\s*\(/, /window\.print/, /importScripts/];
  for (const re of banned) assert.ok(!re.test(own), "found " + re);
  assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(markupOnly), "inline event handler attribute");
});

test("the only outside addresses are the fonts stylesheet, the pinned OCR data and the pinned on-device model", () => {
  const urls = [...markupOnly.matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((m) => m[0]);
  for (const u of urls) assert.ok(u.startsWith("https://fonts.googleapis.com/") || u === "http://www.w3.org/2000/svg", u);
  const inCode = [...own.matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((m) => m[0]);
  // the addresses our code names are the pinned OCR language data and the pinned on-device model
  // (its library, model library and weights), each behind its own switch; the provider addresses for
  // "AI with your own key" are assembled from the provider table, also behind a switch. The rest are
  // XML namespace names inside files we write (SVG, spreadsheets), which are never fetched.
  const names = (u) => u === "http://www.w3.org/2000/svg" || u.startsWith("http://schemas.openxmlformats.org/") || u.startsWith("http://purl.org/") ||
    // examples in the AI service's help text and placeholder, never fetched (the gate takes only the address typed in Settings)
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u) || /^https:\/\/[a-z0-9.-]*example(\.org)?\//.test(u);
  assert.deepEqual(Array.from(new Set(inCode.filter((u) => !names(u)))).sort(), [
    "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/lib/index.js",
    "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz",
    "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC/resolve/9bd564b064631febf14deadcac492efb761d60c3/",
    "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/00fe7a40e57e5e8eb9fef87526a4bf28ad5846c0/web-llm-models/v0_2_84/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
  ]);
});

test("embedded libraries match their pinned SHA-384 hashes", () => {
  const pins = JSON.parse(readFileSync(join(root, "web", "vendor", "pins.json"), "utf8"));
  for (const [id, name] of [["vendor-pdfjs", "pdfjs"], ["vendor-pdflib", "pdflib"], ["vendor-pdfjs-worker", "pdfjsWorker"]]) {
    let text = block(id);
    for (const [a, b] of pins[name].restore || []) text = text.split(a).join(b);
    // The build trims the file's final newline, so check the text as embedded and with it restored.
    const digests = [text, text + "\n"].map((t) => "sha384-" + createHash("sha384").update(t, "utf8").digest("base64"));
    assert.ok(digests.includes(pins[name].sri), id);
  }
  assert.equal(/type="text\/plain" id="vendor-pdfjs-worker"/.test(html), true, "the worker source is inert text");
  // the text engine: its glue as inert text, its WebAssembly as base64 data
  let core = block("vendor-ocr-core");
  for (const [a, b] of pins.ocrCore.restore || []) core = core.split(a).join(b);
  assert.ok([core, core + "\n"].map((x) => "sha384-" + createHash("sha384").update(x, "utf8").digest("base64")).includes(pins.ocrCore.sri), "vendor-ocr-core");
  const wasm = Buffer.from(block("vendor-ocr-wasm").replace(/\s+/g, ""), "base64");
  assert.equal("sha384-" + createHash("sha384").update(wasm).digest("base64"), pins.ocrWasm.sri, "vendor-ocr-wasm");
  assert.equal(/type="text\/plain" id="vendor-ocr-core"/.test(html) && /type="application\/octet-stream" id="vendor-ocr-wasm"/.test(html), true, "the engine is inert until used");
});

test("pdf.js runs with eval and XFA off; annotations are drawn as pictures, never as live forms or scripts", () => {
  assert.match(own, /isEvalSupported:\s*false/);
  assert.match(own, /enableXfa:\s*false/);
  // annotations are drawn as pictures (1) or not at all (0), never as forms (2) or for print storage (3)
  assert.ok([...own.matchAll(/annotationMode:\s*([^,}]+)/g)].every((m) => /^(1|0|S\.doc && S\.doc\.hideAnnots \? 0 : 1|m\.annots \? 1 : 0)\s*$/.test(m[1])));
  assert.ok(!/enableScripting|AnnotationLayer|renderInteractiveForms/.test(own));
});

test("the Pages build has a strict policy: connections fenced to https and this computer behind the gate, no eval", () => {
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(docs)[1];
  assert.match(csp, /default-src 'none'/);
  const hosts = [...csp.matchAll(/https?:[^\s;]+/g)].map((m) => m[0]);
  const L = loadCore().LOCAL_MODEL;
  assert.ok(L.weights.endsWith("/resolve/" + L.revision + "/") && /^[0-9a-f]{40}$/.test(L.revision), "the model's files at one fixed revision");
  assert.ok(L.files.length === 33 && L.files.every((f) => f.url.startsWith(L.weights) && f.bytes > 0 && (/^[0-9a-f]{64}$/.test(f.sha256 || "") || /^[0-9a-f]{40}$/.test(f.git || ""))));
  assert.deepEqual(hosts, [L.lib, "http://localhost:*", "http://127.0.0.1:*"], "the model library's script, and connections fenced to https and this computer");
  assert.match(csp, /connect-src 'self' https: http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*;/);
  assert.match(csp, /script-src [^;]*https:\/\/cdn\.jsdelivr\.net\/npm\/@mlc-ai\/web-llm@0\.2\.84\/lib\/index\.js /, "the one script address: the pinned model library");
  const map = JSON.parse(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/.exec(docs)[1]);
  assert.deepEqual(map, { integrity: { [L.lib]: L.libSri } }, "the import map pins the model library");
  assert.ok(!/'unsafe-eval'|'unsafe-inline'[^;]*;\s*worker|script-src[^;]*'unsafe-inline'/.test(csp), "no eval and no inline scripts without a hash");
  assert.match(csp, /script-src[^;]*'wasm-unsafe-eval'/, "WebAssembly for the embedded text engine only");
  assert.ok(!/fonts\.googleapis/.test(docs), "fonts are served with the page");
  const hashes = new Set([...csp.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]));
  for (const m of docs.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*\btype="(?!module"|importmap")[^"]*")[^>]*>([\s\S]*?)<\/script>/g)) {
    assert.ok(hashes.has(createHash("sha256").update(m[1], "utf8").digest("base64")), "an inline script without a policy hash");
  }
});

test("every control in the static markup has an id and a label", () => {
  for (const m of markupOnly.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)) {
    const attrs = m[2];
    assert.match(attrs, /\bid="[^"]+"/, m[0]);
    const id = /\bid="([^"]+)"/.exec(attrs)[1];
    const labelled = /aria-label="/.test(attrs) || new RegExp('<label[^>]*for="' + id + '"').test(markupOnly) || (m[1] === "button" && !/type="file"/.test(attrs));
    assert.ok(labelled, "no label for " + id);
  }
});

test("the Pages build keeps the text engine in its own pinned file, not in the page", () => {
  const pins = JSON.parse(readFileSync(join(root, "web", "vendor", "pins.json"), "utf8"));
  assert.match(docs, /<script type="application\/octet-stream" id="vendor-ocr-wasm"><\/script>/);
  const wasm = readFileSync(join(root, "docs", pins.ocrWasm.file));
  assert.equal("sha384-" + createHash("sha384").update(wasm).digest("base64"), pins.ocrWasm.sri);
  assert.ok(docs.length < 4 * 1024 * 1024, "the Pages page is " + docs.length + " bytes");
});

test("no em dashes in the page", () => {
  assert.ok(!html.includes("\u2014") && !docs.includes("\u2014"));
});
