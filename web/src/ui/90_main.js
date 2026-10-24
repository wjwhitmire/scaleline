// ---------------------------------------------------------------- start
async function boot() {
  // the Pages build marks the page when another site frames it; the app is then not started at all
  if (document.documentElement.hasAttribute("data-framed")) return;
  buildMenus();
  buildToolbar();
  initPanels();
  initStatusBar();
  initViewInput();
  initKeyboard();
  initFiles();
  buildListPane();
  probeBlobWorkers().then((ok) => { if (ok) startComputeWorker(); });
  await storageInit();
  S.settings = Object.assign(S.settings, await kvGet("settings", {}));
  applyTheme();
  S.presets = await kvGet("presets", null) || JSON.parse(JSON.stringify(C.DEFAULT_PRESETS));
  setTool("select");
  syncToolbar();
  renderChest();
  syncStatusBarIdle();
  // Reopen the last plan set if its copy is on this device; otherwise open the example.
  let opened = false;
  const last = await kvGet("lastDoc", null);
  if (last && !/[?&]example\b/.test(location.search)) {
    try {
      const bytes = await dbGet("files", last);
      const meta = await dbGet("docs", last);
      if (bytes && meta) { await openDocument(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), meta.meta.name); opened = true; }
    } catch (e) { opened = false; }
  }
  if (!opened) {
    try { await openExample(); } catch (e) { status("The example could not open: " + cleanName(e.message, 120), "bad"); }
  }
  document.body.dataset.ready = "1";
}
function syncStatusBarIdle() {
  for (const [id, key] of [["sb-snap-content", "snapContent"], ["sb-snap-markup", "snapMarkup"], ["sb-grid", "grid"], ["sb-ortho", "ortho"]]) $(id).setAttribute("aria-pressed", S.settings[key] ? "true" : "false");
}
on("doc", () => { renderSheets(); if (S.ui.right === "layers") renderLayers(); renderMeasure(); });
on("model", () => { if (S.ui.bottom === "estimate") renderEstimate(); });

// A read-only view for automated tests and support: positions and totals, no write access.
window.takeoffInspect = Object.freeze({
  pageToClient(x, y) { const r = viewer().getBoundingClientRect(); const s = pageToScreen(x, y); return [r.left + s[0], r.top + s[1]]; },
  page() { return S.view.page; },
  zoom() { return S.view.zoom; },
  markups() { return JSON.parse(JSON.stringify(model() ? model().markups : [])); },
  scale(p) { const s = pageScale(p === undefined ? S.view.page : p); return s ? s.in_per_pt : null; },
  markupCount() { return model() ? model().markups.length : 0; },
  numPages() { return S.doc ? S.doc.numPages : 0; },
  lastRenderMs() { return S.lastRenderMs || 0; },
  engine() { return { pdf: pdfjsMode, compute: work.mode, render: renderWorkerReady() ? "worker" : rw.opening ? "starting" : "main thread" }; },
  perf() { return { lastRenderMs: S.lastRenderMs || 0, lastPreviewMs: S.lastPreviewMs || 0, tilesDrawn: S.tilesDrawn || 0, tilesCached: tiles.cache.size, tileMB: Math.round(tiles.bytes / 1048576), thumbsInDom: $("thumbs").children.length }; },
  assemblies() { return JSON.parse(JSON.stringify(model() ? model().assemblies : [])); },
  rates() { return JSON.parse(JSON.stringify(model() ? model().rates || [] : [])); },
  presets() { return JSON.parse(JSON.stringify(S.presets || [])); },
  estimate() { try { return JSON.parse(JSON.stringify(C.document_estimate(model()))); } catch (e) { return null; } },
  shown(p) { const b = $("base-canvas"); return { preview: b.dataset.page === String(p), full: baseCache.has(p) && b.dataset.page === String(p) }; },
  zoomTo(x0, y0, x1, y1) { zoomTo([x0, y0, x1, y1]); layoutView(); return S.view.zoom; },
  fit() { fitPage(true); layoutView(); return S.view.zoom; },
  raw(id) { const m = markupById(id); const r = m && measureOf(m); return r ? JSON.parse(JSON.stringify(r)) : null; },
  measured(id) { const m = markupById(id); const d = m && displayOf(m); return d ? { qty: d.qty, unit: d.unit, text: d.text } : null; },
  viewports(p) { return JSON.parse(JSON.stringify(viewportsOf(p === undefined ? S.view.page : p))); },
  snapGeometry() { const v = S.vectors; return v ? { page: v.page, raster: !!v.grid.raster, segs: v.grid.segs.length, crossings: v.grid.pointGrid ? v.grid.pointGrid.segs.length : 0 } : null; },
  text(p) { return pageText(p === undefined ? S.view.page : p).then((items) => items.map((i) => i.str)); },
  checkModelFile(f, bytes) { return modelFileOk(f, new Uint8Array(bytes).buffer); },
  settings() { return JSON.parse(JSON.stringify(S.settings)); },
  modelPins() { return { revision: C.LOCAL_MODEL.revision, urls: NET_FEATURES["ai-local"].urls.slice() }; },
});

boot().catch((e) => { status("Start-up failed: " + cleanName(e && e.message, 160), "bad"); document.body.dataset.ready = "error"; });
