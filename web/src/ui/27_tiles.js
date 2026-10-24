// ---------------------------------------------------------------- drawing large sets: render worker, tiles, caches
// Sheets are drawn off the main thread where the browser allows it: a module worker runs its own
// copy of the embedded pdf.js with OffscreenCanvas and hands back pictures (ImageBitmap), so panning,
// zooming and tools stay responsive while a heavy sheet draws. Where that is not possible (no
// OffscreenCanvas, a refused worker, a very large file) the same drawing runs on the main thread.
//
// What the view shows, from first to last: the page's thumbnail stretched (instant, from memory or
// the device cache), the whole page at up to 2400 px, then 512 px tiles at the zoom in use, only for
// the part on screen, nearest the center first. Tiles live in a memory-capped cache, least recently
// used out first.

const RENDER_WORKER_MAX_BYTES = 200 * 1024 * 1024;
const rw = { worker: null, seq: 0, pending: new Map(), docId: null, opening: null, mode: "main thread", failed: false };
const RW_HANDLER = `
class OffCanvasFactory {
  create(w, h) { if (w <= 0 || h <= 0) throw new Error("Invalid canvas size"); const canvas = new OffscreenCanvas(w, h); return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) }; }
  reset(e, w, h) { e.canvas.width = w; e.canvas.height = h; }
  destroy(e) { e.canvas.width = e.canvas.height = 0; e.canvas = null; e.context = null; }
}
class NoFilters { addFilter() { return "none"; } addHCMFilter() { return "none"; } addAlphaFilter() { return "none"; } addLuminosityFilter() { return "none"; } addHighlightHCMFilter() { return "none"; } destroy() {} }
let doc = null, docId = null;
const tasks = new Map();
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.op === "init") {
      globalThis.pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(m.workerUrl, { type: "module" });
      self.postMessage({ id: m.id, ok: true, offscreen: typeof OffscreenCanvas === "function" });
    } else if (m.op === "open") {
      if (doc) { try { await doc.destroy(); } catch (x) {} doc = null; }
      doc = await globalThis.pdfjsLib.getDocument({ data: m.bytes, isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true,
        stopAtErrors: false, verbosity: 0, CanvasFactory: OffCanvasFactory, FilterFactory: NoFilters, ownerDocument: { fonts: self.fonts } }).promise;
      docId = m.docId;
      self.postMessage({ id: m.id, ok: true, n: doc.numPages });
    } else if (m.op === "render") {
      if (!doc || m.docId !== docId) throw new Error("no document");
      const pg = await doc.getPage(m.page + 1);
      const vp = pg.getViewport({ scale: m.scale, offsetX: -m.x, offsetY: -m.y });
      const c = new OffscreenCanvas(m.w, m.h);
      const ctx = c.getContext("2d", { alpha: false });
      ctx.fillStyle = m.paper; ctx.fillRect(0, 0, m.w, m.h);
      const t = pg.render({ canvasContext: ctx, viewport: vp, intent: "display", annotationMode: m.annots ? 1 : 0 });
      tasks.set(m.id, t);
      try { await t.promise; } finally { tasks.delete(m.id); }
      const bmp = c.transferToImageBitmap();
      self.postMessage({ id: m.id, ok: true, bmp }, [bmp]);
    } else if (m.op === "cancel") {
      const t = tasks.get(m.target);
      if (t) t.cancel();
    } else if (m.op === "release") {
      if (doc) { const pg = await doc.getPage(m.page + 1); pg.cleanup(); }
    }
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err), cancelled: !!(err && err.name === "RenderingCancelledException") }); }
};`;
function rwCall(msg, transfer) {
  return new Promise((resolve, reject) => {
    const id = ++rw.seq;
    rw.pending.set(id, { resolve, reject });
    rw.worker.postMessage(Object.assign({ id }, msg), transfer || []);
  });
}
async function startRenderWorker() {
  if (rw.worker || rw.failed) return !!rw.worker;
  try {
    if (typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") throw new Error("no OffscreenCanvas");
    if (!(await probeBlobWorkers())) throw new Error("workers from blob URLs do not run here");
    const src = $("vendor-pdfjs").textContent + "\n" + RW_HANDLER;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    rw.worker = new Worker(url, { type: "module" });
    rw.worker.onmessage = (e) => {
      const p = rw.pending.get(e.data.id);
      if (!p) { if (e.data.bmp) e.data.bmp.close(); return; }
      rw.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data); else { const err = new Error(e.data.error); if (e.data.cancelled) err.name = "RenderingCancelledException"; p.reject(err); }
    };
    rw.worker.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); stopRenderWorker(); };
    const r = await Promise.race([rwCall({ op: "init", workerUrl: pdfWorkerUrl() }), sleep(8000).then(() => { throw new Error("render worker did not start"); })]);
    if (!r.offscreen) throw new Error("no OffscreenCanvas in workers");
    rw.mode = "worker";
    return true;
  } catch (e) { stopRenderWorker(); return false; }
}
function stopRenderWorker() {
  if (rw.worker) { try { rw.worker.terminate(); } catch (e) { /* gone */ } }
  rw.worker = null; rw.docId = null; rw.opening = null; rw.failed = true; rw.mode = "main thread";
  for (const p of rw.pending.values()) p.reject(new Error("render worker stopped"));
  rw.pending.clear();
}
// The render worker gets its own copy of the open PDF (the bytes are copied, never shared).
function renderWorkerOpen(doc) {
  rw.docId = null;
  if (!doc || doc.size > RENDER_WORKER_MAX_BYTES) { rw.opening = null; return; }
  rw.opening = (async () => {
    if (!(await startRenderWorker())) return false;
    const bytes = doc.bytes.slice();
    await rwCall({ op: "open", bytes, docId: doc.id }, [bytes.buffer]);
    if (S.doc === doc) rw.docId = doc.id;
    return true;
  })().catch(() => { stopRenderWorker(); return false; });
}
function renderWorkerReady() { return !!(rw.worker && S.doc && rw.docId === S.doc.id); }
// One picture of a window of a page at a scale: from the worker when it is ready, else here.
// Returns { promise (resolves to a CanvasImageSource), cancel }.
function renderPicture(p, scale, x, y, w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (renderWorkerReady()) {
    let id = 0;
    const prom = new Promise((resolve, reject) => {
      id = ++rw.seq;
      rw.pending.set(id, { resolve: (d) => resolve(d.bmp), reject });
      rw.worker.postMessage({ id, op: "render", docId: rw.docId, page: p, scale, x, y, w, h, paper: paper(), annots: !(S.doc && S.doc.hideAnnots) });
    });
    return { promise: prom, cancel: () => { if (rw.worker && rw.pending.has(id)) rw.worker.postMessage({ id: ++rw.seq, op: "cancel", target: id }); } };
  }
  let task = null, cancelled = false;
  const prom = (async () => {
    const pg = await getPage(S.doc, p);
    if (cancelled) { const e = new Error("cancelled"); e.name = "RenderingCancelledException"; throw e; }
    const cv = document.createElement("canvas");
    task = renderInto(pg, cv, scale, x, y, w, h);
    await task.promise;
    return cv;
  })();
  return { promise: prom, cancel: () => { cancelled = true; if (task) try { task.cancel(); } catch (e) { /* done */ } } };
}

// ---- tiles
const TILE = 512;
const tiles = { cache: new Map(), bytes: 0, queue: [], running: new Map(), want: new Set(), level: 0, page: -1, rot: 0 };
// Memory for tiles: a share of the device's memory where the browser says, else 256 MB.
function tileCap() { const gb = navigator.deviceMemory || 4; return Math.max(96, Math.min(512, gb * 48)) * 1048576; }
function tileLevel() { const need = S.view.zoom * dpr(); return Math.pow(2, Math.ceil(Math.log2(need) * 2 - 1e-9) / 2); }
function tileKey(p, s, tx, ty) { return p + "|" + s.toFixed(4) + "|" + tx + "|" + ty; }
function tileLayer() {
  let l = $("tile-layer");
  if (!l) { l = el("div", { id: "tile-layer", cls: "tile-layer", "aria-hidden": "true" }); $("base-canvas").after(l); }
  return l;
}
function dropTiles(all) {
  for (const [k, t] of tiles.running) { if (all || !tiles.want.has(k)) { t.cancel(); tiles.running.delete(k); } }
  tiles.queue = tiles.queue.filter((q) => !all && tiles.want.has(q.key));
  if (all) {
    for (const t of tiles.cache.values()) if (t.img && t.img.close) t.img.close();
    tiles.cache.clear(); tiles.bytes = 0;
    const l = $("tile-layer");
    if (l) clear(l);
  }
}
function evictTiles() {
  const cap = tileCap();
  if (tiles.bytes <= cap) return;
  // least recently used first, never what is on screen
  const order = Array.from(tiles.cache.entries()).filter(([k]) => !tiles.want.has(k)).sort((a, b) => a[1].used - b[1].used);
  for (const [k, t] of order) {
    if (tiles.bytes <= cap * 0.85) break;
    tiles.cache.delete(k);
    tiles.bytes -= t.bytes;
    if (t.img && t.img.close) t.img.close();
    if (t.node) t.node.remove();
  }
}
// Lay out the tiles for the current view, queue the missing ones and draw what is cached.
function layoutTiles(on) {
  const layer = tileLayer();
  if (!on || !S.doc) { layer.hidden = true; tiles.want = new Set(); dropTiles(false); return; }
  const p = S.view.page, info = pageInfoNow(p);
  if (!info) return;
  const s = tileLevel();
  const M = viewMatrix();
  layer.hidden = false;
  layer.style.transform = "matrix(" + [M[0] / s, M[1] / s, M[2] / s, M[3] / s, M[4], M[5]].map((v) => +v.toFixed(6)).join(",") + ")";
  // the visible part of the page, in points, with a margin of half a tile
  const corners = [[0, 0], [vw(), 0], [0, vh()], [vw(), vh()]].map((c) => screenToPage(c[0], c[1]));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const pad = TILE / s / 2;
  const x0 = Math.max(0, Math.min(...xs) - pad), x1 = Math.min(info.w, Math.max(...xs) + pad);
  const y0 = Math.max(0, Math.min(...ys) - pad), y1 = Math.min(info.h, Math.max(...ys) + pad);
  const W = Math.ceil(info.w * s), H = Math.ceil(info.h * s);
  const tx0 = Math.floor(x0 * s / TILE), tx1 = Math.floor(Math.min(W - 1, x1 * s) / TILE);
  const ty0 = Math.floor(y0 * s / TILE), ty1 = Math.floor(Math.min(H - 1, y1 * s) / TILE);
  const cx = (x0 + x1) / 2 * s / TILE, cy = (y0 + y1) / 2 * s / TILE;
  const want = new Set();
  const missing = [];
  const now = performance.now();
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const key = tileKey(p, s, tx, ty);
    want.add(key);
    const t = tiles.cache.get(key);
    if (t) {
      t.used = now;
      if (!t.node) {
        t.node = el("canvas", { cls: "tile", width: t.w, height: t.h, style: "left:" + tx * TILE + "px;top:" + ty * TILE + "px;width:" + t.w + "px;height:" + t.h + "px" });
        t.node.dataset.key = key;
        t.node.getContext("2d", { alpha: false }).drawImage(t.img, 0, 0);
      }
      if (t.node.parentNode !== layer) layer.append(t.node);
    } else if (!tiles.running.has(key)) missing.push({ key, p, s, tx, ty, d: Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) });
  }
  // tiles of other levels or pages leave the layer (they stay cached)
  for (const n of Array.from(layer.children)) if (!want.has(n.dataset.key)) n.remove();
  tiles.want = want;
  dropTiles(false);
  missing.sort((a, b) => a.d - b.d);
  tiles.queue = missing.concat(tiles.queue.filter((q) => want.has(q.key) && !missing.some((m) => m.key === q.key)));
  pumpTiles();
}
const TILE_PARALLEL = 2;
function pumpTiles() {
  while (tiles.running.size < TILE_PARALLEL && tiles.queue.length) {
    const q = tiles.queue.shift();
    if (!tiles.want.has(q.key) || tiles.cache.has(q.key)) continue;
    const info = pageInfoNow(q.p);
    if (!info) continue;
    const W = Math.ceil(info.w * q.s), H = Math.ceil(info.h * q.s);
    const w = Math.min(TILE, W - q.tx * TILE), h = Math.min(TILE, H - q.ty * TILE);
    if (w <= 0 || h <= 0) continue;
    const job = renderPicture(q.p, q.s, q.tx * TILE, q.ty * TILE, w, h);
    tiles.running.set(q.key, job);
    job.promise.then((img) => {
      tiles.running.delete(q.key);
      const t = { key: q.key, img, w, h, bytes: w * h * 4, used: performance.now(), node: null };
      tiles.cache.set(q.key, t);
      tiles.bytes += t.bytes;
      evictTiles();
      if (tiles.want.has(q.key) && S.view.page === q.p) {
        const layer = tileLayer();
        t.node = el("canvas", { cls: "tile", width: w, height: h, style: "left:" + q.tx * TILE + "px;top:" + q.ty * TILE + "px;width:" + w + "px;height:" + h + "px" });
        t.node.dataset.key = q.key;
        t.node.getContext("2d", { alpha: false }).drawImage(img, 0, 0);
        layer.append(t.node);
        S.tilesDrawn = (S.tilesDrawn || 0) + 1;
      }
      pumpTiles();
    }).catch(() => { tiles.running.delete(q.key); pumpTiles(); });
  }
}

// ---- thumbnails: kept in memory for the pages near the one open and on the device per PDF
const thumbMem = new Map();
function keepThumb(p, canvas) {
  thumbMem.set(p, canvas);
  if (thumbMem.size > 400) thumbMem.delete(thumbMem.keys().next().value);
  if (S.doc && canvas.toBlob) {
    const id = S.doc.id;
    canvas.toBlob((b) => { if (b) cacheSet("thumb:" + id + ":" + p, b); }, "image/webp", 0.8);
  }
}
async function storedThumb(p) {
  if (thumbMem.has(p)) return thumbMem.get(p);
  if (!S.doc) return null;
  const b = await cacheGet("thumb:" + S.doc.id + ":" + p, null);
  if (!(b instanceof Blob)) return null;
  try { const img = await createImageBitmap(b); return img; } catch (e) { return null; }
}
on("doc", () => { thumbMem.clear(); dropTiles(true); renderWorkerOpen(S.doc); loadAnnotsShown(); });
// Whether the PDF's own annotations are drawn: yes, until they are imported as markups (then the
// markups take their place); View, Show the PDF's own markups switches it back. Kept per PDF.
async function loadAnnotsShown() {
  const d = S.doc;
  if (!d) return;
  const hide = (await kvGet("annots-hidden:" + d.id, false)) === true;
  if (S.doc === d && hide !== !!d.hideAnnots) setAnnotsShown(!hide, true);
}
function setAnnotsShown(show, quiet) {
  if (!S.doc) return;
  S.doc.hideAnnots = !show;
  kvSet("annots-hidden:" + S.doc.id, !show);
  thumbMem.clear();
  invalidateRenders();
  renderBase(S.view.page);
  buildThumbs();
  if (!quiet) status(show ? "The PDF's own markups are drawn again, under this app's markups." : "The PDF's own markups are hidden; the imported markups take their place.");
}
