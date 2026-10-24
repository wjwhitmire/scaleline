// ---------------------------------------------------------------- scanned drawings: OCR and raster snapping
// Text recognition runs on this device: the engine (tesseract, compiled to WebAssembly, pinned) works
// in a worker. Its WebAssembly is embedded in the single-file page; the Pages build fetches it from
// this same site the first time OCR is used. The language data comes from the network once. Both
// sit behind the OCR switch, are checked against their pinned SHA-384 before they are kept and
// again each time before they are used, and are kept on the device. Sheets are cleaned first
// (contrast, deskew, threshold, despeckle) and the words go back through the deskew to sheet points,
// where search, the title block reader and the sheet index use them like a vector sheet's own text.
const ocr = { worker: null, ready: null, seq: 0, pending: new Map(), text: new Map(), docId: null };
const OCR_KV = "ocr:" + OCR_DATA.lang;
const OCR_WASM_KV = "ocr:engine:" + OCR_WASM.sri;
async function sha384Sri(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-384", bytes));
  let s = "";
  for (const b of d) s += String.fromCharCode(b);
  return "sha384-" + btoa(s);
}
async function keptBytes(key) { const b = await kvGet(key, null); return b ? (b instanceof Uint8Array ? b : new Uint8Array(b)) : null; }
async function ocrDataBytes() { return keptBytes(OCR_KV); }
// One pinned file through the network gate: the exact address, the exact size, the exact SHA-384.
async function downloadPinned(url, size, sri, what, progress) {
  if (!switchOn("ocr")) throw new Error("OCR is off. Turn it on to download the " + what + ".");
  const res = await net("ocr", url);
  if (!res.ok) throw new Error("The download failed (" + res.status + ").");
  const len = Number(res.headers.get("content-length") || 0);
  if (len && len !== size) throw new Error("The " + what + " is not the expected size; nothing was kept.");
  const reader = res.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    n += r.value.length;
    if (n > size) { try { reader.cancel(); } catch (e) { /* stop */ } throw new Error("The " + what + " is larger than expected; nothing was kept."); }
    parts.push(r.value);
    if (progress) progress(n / size);
  }
  const bytes = new Uint8Array(n);
  let k = 0;
  for (const p of parts) { bytes.set(p, k); k += p.length; }
  if ((await sha384Sri(bytes)) !== sri) throw new Error("The " + what + " does not match its pinned fingerprint; nothing was kept.");
  return bytes;
}
async function downloadOcrData(progress) {
  const bytes = await downloadPinned(OCR_DATA.url, OCR_DATA.bytes, OCR_DATA.sri, "language data", progress);
  await kvSet(OCR_KV, bytes);
  return bytes;
}
// The engine's WebAssembly: embedded, kept from an earlier visit, or fetched from this site once.
async function ocrWasmBytes() {
  const inline = $("vendor-ocr-wasm").textContent.trim();
  let bytes = inline ? b64ToBytes(inline) : await keptBytes(OCR_WASM_KV);
  if (bytes && (await sha384Sri(bytes)) !== OCR_WASM.sri) {
    if (inline) throw new Error("The embedded text engine does not match its pinned fingerprint; it was not used.");
    await kvSet(OCR_WASM_KV, null);
    bytes = null;
  }
  if (!bytes) {
    bytes = await downloadPinned(OCR_WASM_URL, OCR_WASM.bytes, OCR_WASM.sri, "text engine");
    await kvSet(OCR_WASM_KV, bytes);
  }
  return bytes;
}
// The engine worker: the embedded engine source plus a small message handler.
const OCR_HANDLER = `
var api = null, M = null;
async function gunzip(bytes) {
  var s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
self.onmessage = async function (e) {
  var m = e.data;
  try {
    if (m.op === "init") {
      M = await TesseractCore({ wasmBinary: m.wasm, print: function () {}, printErr: function () {} });
      M.FS.writeFile("/" + m.lang + ".traineddata", await gunzip(m.data));
      api = new M.TessBaseAPI();
      if (api.Init("/", m.lang, 1) !== 0) throw new Error("the language data did not load");
      api.SetVariable("tessedit_pageseg_mode", "11");
      api.SetVariable("user_defined_dpi", "300");
      self.postMessage({ id: m.id, ok: true });
    } else if (m.op === "page") {
      M.FS.writeFile("/input", m.pgm);
      if (api.SetImageFile(1, 0) === 1) throw new Error("the page image could not be read");
      api.Recognize(null);
      var tsv = api.GetTSVText(0);
      self.postMessage({ id: m.id, ok: true, tsv: tsv });
    }
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
};`;
function ocrCall(msg, transfer) {
  return new Promise((resolve, reject) => {
    const id = ++ocr.seq;
    ocr.pending.set(id, { resolve, reject });
    ocr.worker.postMessage(Object.assign({ id }, msg), transfer || []);
  });
}
async function ocrEngine() {
  if (ocr.ready) return ocr.ready;
  ocr.ready = (async () => {
    const data = await ocrDataBytes();
    if (!data) throw new Error("The language data is not on this device yet.");
    if ((await sha384Sri(data)) !== OCR_DATA.sri) { await kvSet(OCR_KV, null); throw new Error("The kept language data no longer matches its pinned fingerprint and was removed. Download it again."); }
    const wasm = await ocrWasmBytes();
    const src = $("vendor-ocr-core").textContent + "\n" + OCR_HANDLER;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    ocr.worker = new Worker(url);
    ocr.worker.onmessage = (e) => { const p = ocr.pending.get(e.data.id); if (!p) return; ocr.pending.delete(e.data.id); if (e.data.ok) p.resolve(e.data); else p.reject(new Error(e.data.error)); };
    ocr.worker.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); for (const p of ocr.pending.values()) p.reject(new Error("The text engine stopped.")); ocr.pending.clear(); ocr.ready = null; };
    await ocrCall({ op: "init", wasm, data: data.slice(), lang: OCR_DATA.lang }, [wasm.buffer]);
    return true;
  })();
  ocr.ready.catch(() => { ocr.ready = null; });
  return ocr.ready;
}
// Recognize one page (or its title block corner). Returns text items in sheet points.
async function ocrPage(p, opts) {
  const o = Object.assign({ deskew: true, region: "sheet" }, opts || {});
  await ocrEngine();
  const info = await pageInfo(p);
  // about 200 to 300 pixels per inch of paper, capped near 24 million pixels
  const full = Math.min(300 / 72, Math.sqrt(24e6 / (info.w * info.h)));
  const pg = await getPage(S.doc, p);
  let box = [0, 0, info.w, info.h];
  if (o.region === "titleblock") box = [info.w * 0.55, info.h * 0.55, info.w, info.h];
  const sc = o.region === "titleblock" ? Math.min(300 / 72, Math.sqrt(24e6 / ((box[2] - box[0]) * (box[3] - box[1])))) : full;
  const cv = document.createElement("canvas");
  await renderInto(pg, cv, sc, box[0] * sc, box[1] * sc, (box[2] - box[0]) * sc, (box[3] - box[1]) * sc).promise;
  const img = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
  const gray = C.gray_from_rgba(img.data, cv.width, cv.height);
  const w = cv.width, h = cv.height;
  cv.width = cv.height = 1;
  const clean = await compute("clean", { gray, w, h, opts: { deskew: o.deskew, speck: 4 } });
  const res = await ocrCall({ op: "page", pgm: C.pgm_bytes(clean.gray, w, h) });
  const words = C.tsv_words(res.tsv);
  const items = C.ocr_text_items(words, sc, clean.skew, w, h, 55).map((it) => Object.assign(it, { x: it.x + box[0], y: it.y + box[1], ocr: true }));
  return { items, words: words.length, skew: clean.skew, conf: words.length ? words.reduce((s, x) => s + x.conf, 0) / words.length : 0 };
}
// Recognized text kept for this plan set (on the device, in the cache store, keyed by the PDF).
function ocrItems(p) { return ocr.docId === (S.doc && S.doc.id) ? ocr.text.get(p) || null : null; }
async function loadOcrText() {
  ocr.text = new Map();
  ocr.docId = S.doc ? S.doc.id : null;
  if (!S.doc || !DB) return;
  const all = await cacheGet("ocr:" + S.doc.id, null);
  if (all && typeof all === "object") for (const [k, v] of Object.entries(all)) if (Array.isArray(v)) ocr.text.set(Number(k), v);
}
async function saveOcrText() {
  if (!S.doc) return;
  const o = {};
  for (const [k, v] of ocr.text) o[k] = v;
  await cacheSet("ocr:" + S.doc.id, o);
}
function useOcrText(results) {
  for (const [p, r] of results) { ocr.text.set(p, r.items); textCache.delete(p); delete S.titleBlocks[p]; }
  saveOcrText();
  afterPageShown(S.view.page);
  if (S.ui.left === "sheets") renderSheets();
}
on("doc", () => { loadOcrText(); });
// Pages with almost no text of their own: scanned sheets.
async function scannedPages(limit) {
  const out = [];
  for (let p = 0; p < S.doc.numPages && out.length < (limit || 400); p++) {
    let items = [];
    try { items = await nativeText(p); } catch (e) { items = []; }
    if (items.length < 3) out.push(p);
  }
  return out;
}
function ocrSwitchNotice() {
  const on = el("button", { type: "button", cls: "btn primary", id: "ocr-switch-on", text: "Turn on OCR" });
  on.addEventListener("click", () => { S.settings.net = Object.assign({}, S.settings.net, { ocr: true }); kvSet("settings", S.settings); closeDialog(); openOcrDialog(); });
  openDialog({ title: "OCR is off", icon: "ocr", body: el("div", { cls: "stack" }, [el("p", { cls: "help", text: NET_SWITCHES.ocr.detail }),
    el("p", { cls: "help", text: "It is a network switch, off until you turn it on here or in Settings." }), on]), actions: [{ label: "Cancel" }] });
}
async function openOcrDialog() {
  if (!S.doc) return;
  if (!switchOn("ocr")) { ocrSwitchNotice(); return; }
  if (!(await ocrDataBytes())) {
    const prog = el("div", { cls: "progress" }, [el("div")]);
    const msg = el("p", { cls: "help", id: "ocr-dl-msg", text: "The English language data (" + (OCR_DATA.bytes / 1048576).toFixed(1) + " MB) is downloaded once from cdn.jsdelivr.net, checked against its pinned fingerprint and kept on this device. Recognition itself never uses the network." });
    openDialog({ title: "Download the language data", icon: "ocr", body: el("div", { cls: "stack" }, [msg, prog]),
      actions: [{ label: "Cancel" }, { label: "Download", primary: true, id: "ocr-download", onClick: async () => {
        try { await downloadOcrData((f) => { prog.firstChild.style.width = Math.round(f * 100) + "%"; }); closeDialog(); status("Language data downloaded and checked."); openOcrDialog(); }
        catch (e) { msg.textContent = cleanName(e.message, 200); return true; }
      } }] });
    return;
  }
  showBusy("Looking for scanned sheets...");
  const pages = await scannedPages(400);
  showBusy("");
  const use = new Set(pages.includes(S.view.page) ? [S.view.page] : pages.slice(0, 1));
  const list = el("ul", { cls: "cands", id: "ocr-pages" });
  const results = new Map();
  const draw = () => {
    clear(list);
    for (const p of pages.slice(0, 400)) {
      const cb = el("input", { type: "checkbox", id: "ocr-p-" + p, checked: use.has(p), "aria-label": "Recognize page " + (p + 1) });
      cb.addEventListener("change", () => { if (cb.checked) use.add(p); else use.delete(p); });
      const r = results.get(p);
      const tb = r && r.items.length ? C.read_title_block(r.items, (pageInfoNow(p) || { w: 1, h: 1 }).w, (pageInfoNow(p) || { w: 1, h: 1 }).h) : null;
      const why = r ? r.words + " words, average confidence " + Math.round(r.conf) + "%" + (Math.abs(r.skew) >= 0.1 ? ", straightened " + r.skew.toFixed(2) + " deg" : "") +
        (tb && tb.sheet_number ? ", sheet " + tb.sheet_number : "") + (tb && tb.scale ? ", scale " + tb.scale.text : "") : "No text layer";
      list.append(el("li", { cls: "cand ocr" + (r ? "" : " off") }, [cb, el("span", { cls: "w" }, [el("b", { text: "Page " + (p + 1) + (sheetLabel(p) !== String(p + 1) ? ", " + sheetLabel(p) : "") }),
        el("span", { text: why }), r && r.items.length ? el("span", { cls: "mono", text: r.items.slice(0, 6).map((x) => x.str).join("  ").slice(0, 120) }) : null])]));
    }
    if (!pages.length) list.append(el("li", { cls: "help", style: "padding:12px", text: "Every sheet has its own text layer; nothing needs recognizing." }));
  };
  draw();
  const region = el("div", { cls: "seg", role: "group", "aria-label": "Area to read" });
  let where = "sheet";
  for (const [v, l] of [["sheet", "Whole sheet"], ["titleblock", "Title block corner (faster)"]]) {
    const b = el("button", { type: "button", id: "ocr-region-" + v, "aria-pressed": v === where ? "true" : "false", text: l });
    b.addEventListener("click", () => { where = v; region.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); });
    region.append(b);
  }
  const deskew = el("input", { type: "checkbox", id: "ocr-deskew", checked: true });
  const prog = el("div", { cls: "progress", hidden: true }, [el("div")]);
  let primary = null;
  const run = async () => {
    const todo = Array.from(use).sort((a, b) => a - b);
    if (!todo.length) { status("Pick at least one sheet.", "warn"); return true; }
    prog.hidden = false;
    primary.disabled = true;
    for (let i = 0; i < todo.length; i++) {
      primary.textContent = "Reading page " + (todo[i] + 1) + " (" + (i + 1) + " of " + todo.length + ")...";
      try { results.set(todo[i], await ocrPage(todo[i], { region: where, deskew: deskew.checked })); } catch (e) { status("Text recognition failed on page " + (todo[i] + 1) + ": " + cleanName(e.message, 120), "bad"); break; }
      prog.firstChild.style.width = Math.round(100 * (i + 1) / todo.length) + "%";
      draw();
    }
    primary.disabled = false;
    prog.hidden = true;
    primary.textContent = results.size ? "Use text from " + results.size + " sheet" + (results.size === 1 ? "" : "s") : "Recognize";
    return true;
  };
  const d = openDialog({ title: "Recognize text on scanned sheets", icon: "ocr", src: pages.length + " without a text layer", wide: true, cls: "auto",
    body: el("div", null, [
      el("div", { cls: "why" }, [el("b", { text: "Why" }), el("span", { text: "These sheets have no text of their own, so search, the title block reader and the sheet index see nothing on them. Recognition runs here, on this device: each sheet is cleaned up (contrast, straightened, specks removed) and read, and the words are placed back on the sheet." })]),
      el("div", { cls: "auto-ctl" }, [region, el("label", { cls: "chk", for: "ocr-deskew" }, [deskew, "Straighten and clean up first"]), prog]), list]),
    note: "Nothing is added until you click Use text. One undo removes it.",
    actions: [{ label: "Cancel" }, { label: "Recognize", primary: true, id: "ocr-run", onClick: async () => {
      if (!results.size) return run();
      useOcrText(results);
      const n = results.size;
      toast("Text added to " + n + " sheet" + (n === 1 ? "" : "s") + " for search and the title block reader.", { label: "Undo", run: () => {
        for (const p of results.keys()) { ocr.text.delete(p); textCache.delete(p); delete S.titleBlocks[p]; }
        saveOcrText();
        if (S.ui.left === "sheets") renderSheets();
        status("Recognized text removed.");
      } }, "ocr");
      status("Recognized text added to " + n + " sheet" + (n === 1 ? "" : "s") + ". Search and Read title blocks use it now.");
    } }] });
  primary = d.box.querySelector("#ocr-run");
}

// ---- raster snapping: lines and their crossings found in the scan
async function rasterVectors(p) {
  const info = await pageInfo(p);
  const sc = rasterScale(info);
  const g = await pageGrayCached(p, sc);
  const r = await compute("lines", { gray: g.gray, w: g.w, h: g.h, opts: { minLen: Math.max(20, Math.round(18 * sc)), gap: 2, speck: 6 } });
  const segs = r.segs.map((s) => [s[0] / sc, s[1] / sc, s[2] / sc, s[3] / sc]);
  const grid = C.segment_grid(segs, 24);
  grid.pointGrid = C.segment_grid(r.ints.map((q) => [q[0] / sc, q[1] / sc, q[0] / sc, q[1] / sc]), 24);
  grid.raster = true;
  return grid;
}
const rasterCache = new Map();
function rasterVectorsCached(p) {
  const k = (S.doc && S.doc.id) + ":" + p;
  if (rasterCache.has(k)) return rasterCache.get(k);
  const prom = rasterVectors(p);
  rasterCache.set(k, prom);
  if (rasterCache.size > 4) rasterCache.delete(rasterCache.keys().next().value);
  prom.catch(() => rasterCache.delete(k));
  return prom;
}
