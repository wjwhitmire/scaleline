// ---------------------------------------------------------------- PDF engine (pdf.js, pinned and embedded)
// pdf.js (an ES module) parses and draws in a module worker started from its embedded source (a
// blob URL). PDF JavaScript, XFA forms and font eval are off: a plan set can carry scripts, and
// none of them run.
const MAX_PDF_BYTES = 500 * 1024 * 1024;
const MAX_PAGES = 5000;
let pdfjsMode = "none";
let workerSrcUrl = null;

// The worker source as a blob URL (made once; a render worker may start a second PDF worker from it).
function pdfWorkerUrl() {
  if (!workerSrcUrl) workerSrcUrl = URL.createObjectURL(new Blob([$("vendor-pdfjs-worker").textContent], { type: "text/javascript" }));
  return workerSrcUrl;
}
// Some browsers create workers from blob URLs that never run and never fail (headless Chromium does
// this for a page opened from a file). One tiny worker must answer within a few seconds; otherwise
// the PDF engine and the image work run on the main thread instead of waiting forever.
let blobWorkersOk = null;
function probeBlobWorkers() {
  if (blobWorkersOk === null) blobWorkersOk = new Promise((resolve) => {
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" })), { type: "module" }); } catch (e) { resolve(false); return; }
    const end = (ok) => { clearTimeout(t); try { w.terminate(); } catch (e) { /* gone */ } resolve(ok); };
    const t = setTimeout(() => end(false), 3000);
    w.onmessage = () => end(true);
    w.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); end(false); };
  });
  return blobWorkersOk;
}
async function pdfjs() {
  const lib = window.pdfjsLib;
  if (!lib || !lib.getDocument) throw new Error("The PDF engine did not load.");
  if (pdfjsMode === "none") {
    try {
      if (!(await probeBlobWorkers())) throw new Error("workers from blob URLs do not run here");
      const w = new Worker(pdfWorkerUrl(), { type: "module" });
      lib.GlobalWorkerOptions.workerPort = w;
      pdfjsMode = "worker";
    } catch (e) {
      // A page policy or browser that refuses module workers from blobs: run the worker code on the
      // main thread instead (pdf.js picks up its handler from the global the worker module sets).
      const s = document.createElement("script");
      s.type = "module";
      s.textContent = $("vendor-pdfjs-worker").textContent;
      document.head.append(s);
      for (let i = 0; i < 100 && !window.pdfjsWorker; i++) await sleep(20);
      pdfjsMode = window.pdfjsWorker ? "main thread" : "unavailable";
    }
  }
  return lib;
}
function pdfOptions(bytes) {
  return {
    data: bytes, isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true,
    stopAtErrors: false, verbosity: 0, disableFontFace: false, fontExtraProperties: false,
  };
}
async function openPdf(bytes) {
  if (bytes.length > MAX_PDF_BYTES) throw new Error("This PDF is larger than 500 MB. Split the set and open the parts.");
  if (bytes.length < 8 || String.fromCharCode.apply(null, bytes.subarray(0, Math.min(1024, bytes.length))).indexOf("%PDF") < 0) {
    throw new Error("This file is not a PDF (no %PDF header near the start).");
  }
  const lib = await pdfjs();
  const task = lib.getDocument(pdfOptions(bytes.slice()));
  let pdf;
  try {
    pdf = await Promise.race([task.promise, sleep(60000).then(() => { throw new Error("The PDF took too long to open."); })]);
  } catch (e) {
    try { task.destroy(); } catch (x) { /* ignore */ }
    const msg = e && e.name === "PasswordException" ? "This PDF is password protected. Remove the password and open it again."
      : "This PDF could not be read" + (e && e.message ? " (" + cleanName(e.message, 100) + ")" : "") + ".";
    throw new Error(msg);
  }
  if (pdf.numPages > MAX_PAGES) {
    try { pdf.destroy(); } catch (x) { /* ignore */ }
    throw new Error("This PDF has " + pdf.numPages.toLocaleString() + " pages. The limit is " + MAX_PAGES.toLocaleString() + "; split the set and open the parts.");
  }
  if (pdf.numPages < 1) throw new Error("This PDF has no pages.");
  return pdf;
}

// Page proxies with a small cache; pages far from the current one release their memory.
const pageCache = new Map();
function getPage(doc, p) {
  if (!pageCache.has(p)) pageCache.set(p, doc.pdf.getPage(p + 1));
  return pageCache.get(p);
}
function releasePages(keep) {
  for (const [p, prom] of pageCache) {
    if (keep.has(p)) continue;
    prom.then((pg) => { try { pg.cleanup(); } catch (e) { /* busy */ } }).catch(() => {});
    pageCache.delete(p);
  }
}
// Size and orientation of a page at scale 1 in sheet points (rotation applied).
async function pageInfo(p) {
  const d = S.doc;
  if (d.pageInfo[p]) return d.pageInfo[p];
  const pg = await getPage(d, p);
  const vp = pg.getViewport({ scale: 1 });
  d.pageInfo[p] = { w: vp.width, h: vp.height, rotate: pg.rotate, transform: vp.transform.slice(), view: pg.view.slice() };
  return d.pageInfo[p];
}
function pageInfoNow(p) { return S.doc && S.doc.pageInfo[p]; }

// Render a page (or a window of it) into a canvas. Returns a cancel handle and a promise.
// `turn` adds a view rotation (degrees clockwise) on top of the page's own /Rotate.
function renderInto(pg, canvas, scale, offX, offY, w, h, turn) {
  const vp = pg.getViewport(turn ? { scale, offsetX: -offX, offsetY: -offY, rotation: (pg.rotate + turn) % 360 } : { scale, offsetX: -offX, offsetY: -offY });
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = paper();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // the PDF's own annotations are drawn as pictures (1), or not at all (0) once they were imported as markups
  const task = pg.render({ canvasContext: ctx, viewport: vp, intent: "display", annotationMode: S.doc && S.doc.hideAnnots ? 0 : 1 });
  return task;
}
// A grayscale raster of a whole page at `scale` pixels per point, for the automatic tools.
async function pageGray(p, scale) {
  const pg = await getPage(S.doc, p);
  const info = await pageInfo(p);
  const cv = document.createElement("canvas");
  const task = renderInto(pg, cv, scale, 0, 0, info.w * scale, info.h * scale);
  await task.promise;
  const img = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
  const gray = C.gray_from_rgba(img.data, cv.width, cv.height);
  cv.width = cv.height = 1;
  return { gray, w: img.width, h: img.height, scale };
}
const grayCache = new Map();
async function pageGrayCached(p, scale) {
  const k = p + "@" + scale;
  if (grayCache.has(k)) return grayCache.get(k);
  const g = await pageGray(p, scale);
  grayCache.set(k, g);
  if (grayCache.size > 3) grayCache.delete(grayCache.keys().next().value);
  return g;
}
// Resolution for raster tools: about 2 px per point, capped near 12 million pixels.
function rasterScale(info) { return Math.min(2.5, Math.sqrt(12e6 / (info.w * info.h))); }

// Text on a page, as items in sheet points with the origin at the top left. A scanned sheet has
// none of its own; once its text is recognized (OCR), that text is used instead.
const textCache = new Map();
async function pageText(p) {
  if (textCache.has(p)) return textCache.get(p);
  const prom = (async () => {
    const items = await nativeText(p);
    const rec = items.length < 3 ? ocrItems(p) : null;
    return rec && rec.length ? rec : items;
  })();
  textCache.set(p, prom);
  prom.catch(() => textCache.delete(p));
  return prom;
}
// The page's own text layer, kept on the device per PDF so large sets search fast on reopening.
const nativeCache = new Map();
async function nativeText(p) {
  if (nativeCache.has(p)) return nativeCache.get(p);
  const prom = (async () => {
    const key = S.doc && S.doc.id ? "text:" + S.doc.id + ":" + p : null;
    if (key) { const hit = await cacheGet(key, null); if (Array.isArray(hit)) return hit; }
    const pg = await getPage(S.doc, p);
    const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent({ disableNormalization: false });
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const t = window.pdfjsLib.Util.transform(vp.transform, it.transform);
      const hgt = Math.hypot(t[2], t[3]) || Math.hypot(it.transform[2], it.transform[3]);
      const vertical = Math.abs(t[1]) > Math.abs(t[0]);
      const v = { str: it.str, x: t[4], y: t[5], w: vertical ? hgt : it.width, h: vertical ? it.width : hgt, vertical };
      if (vertical) v.up = t[1] < 0; // which way the text runs
      items.push(v);
    }
    if (key) cacheSet(key, items);
    return items;
  })();
  nativeCache.set(p, prom);
  if (nativeCache.size > 600) nativeCache.delete(nativeCache.keys().next().value);
  prom.catch(() => nativeCache.delete(p));
  return prom;
}
// Line work for snap to content, in sheet points.
const vectorCache = new Map();
async function pageVectors(p) {
  if (vectorCache.has(p)) return vectorCache.get(p);
  const prom = (async () => {
    const pg = await getPage(S.doc, p);
    const vp = pg.getViewport({ scale: 1 });
    const ol = await pg.getOperatorList({ intent: "display", annotationMode: 1 });
    const segs = C.extract_segments(ol.fnArray, ol.argsArray, window.pdfjsLib.OPS, 150000).map((s) => {
      const a = C.mat_apply(vp.transform, s[0], s[1]), b = C.mat_apply(vp.transform, s[2], s[3]);
      return [a[0], a[1], b[0], b[1]];
    });
    return C.segment_grid(segs, 24);
  })();
  vectorCache.set(p, prom);
  if (vectorCache.size > 6) vectorCache.delete(vectorCache.keys().next().value);
  prom.catch(() => vectorCache.delete(p));
  return prom;
}
function resetPdfCaches() {
  pageCache.clear(); textCache.clear(); nativeCache.clear(); vectorCache.clear(); grayCache.clear();
}
