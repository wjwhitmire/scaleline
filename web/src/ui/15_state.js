// ---------------------------------------------------------------- state
// The takeoff for the open PDF is one plain object in the markup file format (see the core's
// clean_document). Every edit makes a new object and goes through commit(), so undo, redo and
// autosave see every change.
const S = {
  doc: null,            // { id, name, size, bytes, pdf, numPages, pageInfo: [] }
  hist: C.history_new(null),
  view: { page: 0, zoom: 1, panX: 0, panY: 0, rot: 0 },
  tool: "select",
  preset: null,          // the tool chest preset arming the tool, if any
  toolProps: {},         // per tool overrides of style and quantities
  draft: null,
  selection: new Set(),
  settings: {
    author: "", wheel: "zoom", snapContent: true, snapMarkup: true, grid: false, gridFt: 1, ortho: false,
    keepPdf: true, autoTitleScale: false, theme: "", activeLayer: "", declutter: true,
    net: {},               // network switches turned on (OCR, Live session); every one is off by default
    stunHost: "",          // optional public STUN host for live sessions across networks (empty: LAN only)
    roomBoundary: "inside", // area by click: the walls' inside face, centerline or outside face
  },
  presets: [],
  ui: { left: "pages", right: "props", bottom: "list", groupBy: "subject", filter: "", sort: null, thisPage: false, leftOpen: true, rightOpen: true, bottomOpen: true },
  titleBlocks: {},        // page -> read_title_block result (suggestions only)
  search: null,
  compare: null,
  candidates: null,       // symbol search results waiting for confirmation
};
const listeners = { model: [], view: [], selection: [], tool: [], doc: [], status: [], layout: [], commit: [] };
function on(kind, fn) { listeners[kind].push(fn); }
function emit(kind, arg) { for (const fn of listeners[kind]) { try { fn(arg); } catch (e) { console.error(e); } } }

function model() { return S.hist.present; }
function emptyModel(name, id) {
  return {
    format: C.FILE_FORMAT, version: C.FILE_VERSION,
    settings: Object.assign({}, C.DEFAULT_SETTINGS, { author: S.settings.author || "" }),
    pages: {}, layers: JSON.parse(JSON.stringify(C.DEFAULT_LAYERS)), assemblies: JSON.parse(JSON.stringify(C.DEFAULT_ASSEMBLIES)),
    columns: [], markups: [], document: { name: name || "", sha256: id || "" },
  };
}
// Apply a change. fn gets a shallow copy of the model to replace fields on; return value ignored.
function commit(label, fn, opts) {
  const cur = model();
  const next = Object.assign({}, cur);
  fn(next);
  S.hist = C.history_commit(S.hist, next, label);
  afterChange();
  emit("commit", { prev: cur, next, label, remote: !!(opts && opts.remote) });
}
// A change that arrives from someone else (a live session peer): applied to the present and to
// every undo and redo step, so undoing my own work never removes theirs. Not an undo step itself.
function applyRemote(patch) {
  const h = S.hist;
  const fix = (e) => Object.assign({}, e, { state: patch(e.state) });
  const prev = h.present;
  S.hist = Object.assign({}, h, { past: h.past.map(fix), future: h.future.map(fix), present: patch(h.present) });
  pruneSelection();
  afterChange();
  emit("commit", { prev, next: S.hist.present, label: "", remote: true });
}
// Session bookkeeping on every markup: a revision counter, a short history of version ids (what a
// merge uses to tell which copy is newer), who changed it last, and a status history.
// In a live session someone with no name set is "Guest" and three letters, so what they draw is theirs.
function whoAmI() { return S.settings.author || (model() && model().settings.author) || liveGuestName(); }
function stampNew(m) {
  m.rev = 1;
  m.vers = [newId("v")];
  if (whoAmI()) m.modified_by = whoAmI();
  if (m.status) m.status_log = [{ status: m.status, by: whoAmI(), at: nowIso() }];
  return m;
}
function stampEdit(old, c) {
  c.rev = (old.rev || 0) + 1;
  c.vers = (old.vers || []).concat([newId("v")]).slice(-32);
  c.modified = nowIso();
  if (whoAmI()) c.modified_by = whoAmI(); else delete c.modified_by;
  if ((old.status || "") !== (c.status || "")) c.status_log = (old.status_log || []).concat([{ status: c.status || "", by: whoAmI(), at: c.modified }]).slice(-200);
  return c;
}
function undo() {
  if (!S.hist.past.length) { status("Nothing to undo."); return; }
  const label = S.hist.past[S.hist.past.length - 1].label;
  S.hist = C.history_undo(S.hist);
  pruneSelection();
  afterChange();
  status("Undid " + label + ".");
}
function redo() {
  if (!S.hist.future.length) { status("Nothing to redo."); return; }
  S.hist = C.history_redo(S.hist);
  status("Redid " + S.hist.lastLabel + ".");
  pruneSelection();
  afterChange();
}
function afterChange() {
  indexCache = null;
  emit("model");
  scheduleSave();
}
function pruneSelection() {
  const ids = new Set(model().markups.map((m) => m.id));
  for (const id of Array.from(S.selection)) if (!ids.has(id)) S.selection.delete(id);
  emit("selection");
}

// Markup helpers.
let indexCache = null;
function index() {
  if (indexCache && indexCache.model === model()) return indexCache;
  const byPage = new Map(), byId = new Map();
  for (const m of model().markups) {
    byId.set(m.id, m);
    let l = byPage.get(m.page);
    if (!l) { l = []; byPage.set(m.page, l); }
    l.push(m);
  }
  indexCache = { model: model(), byPage, byId };
  return indexCache;
}
function pageMarkups(p) { return index().byPage.get(p) || []; }
function markupById(id) { return index().byId.get(id); }
function layerById(id) { return model().layers.find((l) => l.id === id); }
function layerVisible(m) { if (!m.layer) return true; const l = layerById(m.layer); return !l || l.visible !== false; }
function layerLocked(m) { if (!m.layer) return false; const l = layerById(m.layer); return !!(l && l.locked); }
// also(n), when given, changes the same model copy in the same undo step (a scale set with the markups).
function addMarkups(list, label, also) {
  const stamped = list.map((m) => (m.vers && m.vers.length ? m : stampNew(Object.assign({}, m))));
  commit(label, (n) => {
    if (also) also(n);
    n.markups = n.markups.concat(stamped);
    // a markup that comes back (undone delete, re-import) is no longer deleted
    if (n.tombstones) { const ids = new Set(stamped.map((m) => m.id)); n.tombstones = n.tombstones.filter((t) => !ids.has(t.id)); }
  });
}
function updateMarkups(ids, patchFn, label) {
  const set = new Set(ids);
  commit(label, (n) => {
    n.markups = n.markups.map((m) => {
      if (!set.has(m.id)) return m;
      const c = Object.assign({}, m);
      patchFn(c);
      return stampEdit(m, c);
    });
  });
}
function deleteMarkups(ids, label) {
  const set = new Set(ids);
  commit(label || "Delete", (n) => {
    const gone = n.markups.filter((m) => set.has(m.id));
    n.markups = n.markups.filter((m) => !set.has(m.id));
    // deleted markups leave a tombstone so a teammate's older copy does not bring them back on merge
    if (gone.length) n.tombstones = (n.tombstones || []).filter((t) => !set.has(t.id)).concat(gone.map((m) => ({ id: m.id, at: nowIso(), by: whoAmI(), vers: (m.vers || []).slice(-32) }))).slice(-C.LIMITS.markups);
  });
  for (const id of ids) S.selection.delete(id);
  emit("selection");
}

// Scales and measuring.
function pageScale(p) {
  const e = model() && model().pages[String(p)];
  return e && e.scale ? e.scale : null;
}
function setPageScale(pages, scale, label) {
  commit(label || "Set scale", (n) => {
    n.pages = Object.assign({}, n.pages);
    for (const p of pages) {
      const k = String(p);
      const e = Object.assign({}, n.pages[k] || {});
      if (scale) e.scale = scale; else delete e.scale;
      n.pages[k] = e;
    }
  });
}
// Viewports: boxes on a sheet with their own scale (a detail at 1 1/2" = 1'-0" on a 1/8" plan).
function viewportsOf(p) { const e = model() && model().pages[String(p)]; return (e && e.viewports) || []; }
function markupScaleOf(m) {
  if (m.viewport) { const v = viewportsOf(m.page).find((x) => x.id === m.viewport); if (v) return v.scale; }
  return pageScale(m.page);
}
function scaleAt(p, pt) {
  const id = pt && model() ? C.viewport_at(model(), p, pt) : null;
  if (id) { const v = viewportsOf(p).find((x) => x.id === id); if (v) return v.scale; }
  return pageScale(p);
}
function setViewports(p, fn, label) {
  commit(label, (n) => {
    n.pages = Object.assign({}, n.pages);
    const e = Object.assign({}, n.pages[String(p)] || {});
    const vps = fn((e.viewports || []).slice());
    if (vps.length) e.viewports = vps; else delete e.viewports;
    n.pages[String(p)] = e;
    // markups inside a viewport box measure at its scale; those outside drop a stale link
    n.markups = n.markups.map((m) => {
      if (m.page !== p) return m;
      const id = C.viewport_at(n, p, m.points[0]);
      if ((m.viewport || null) === id) return m;
      const c = Object.assign({}, m);
      if (id) c.viewport = id; else delete c.viewport;
      return c;
    });
  });
}
const measureCache = new WeakMap();
function measureOf(m) {
  if (!C.MEASURE_TYPES.includes(m.type)) return null;
  const sc = markupScaleOf(m);
  const ipp = sc ? sc.in_per_pt : null;
  const hit = measureCache.get(m);
  if (hit && hit.ipp === ipp) return hit.r;
  let r = null;
  try { r = C.measure(m, ipp); } catch (e) { r = null; }
  measureCache.set(m, { ipp, r });
  return r;
}
function displayOf(m) {
  const r = measureOf(m);
  if (!r) return null;
  const [text, qty, unit] = C.display(r, model().settings);
  return { text: unitText(text), qty, unit: unitLabel(unit), r };
}
// Display only: counts read "EA" on screen; files, CSV and the core keep the stored "ea".
function unitLabel(u) { return u === "ea" ? "EA" : u; }
function unitText(t) { return String(t == null ? "" : t).replace(/(^|\s)ea$/, "$1EA"); }
function settingsUnits() { return model().settings; }

// Autosave to IndexedDB, half a second after the last change.
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
async function saveNow() {
  if (!DB || !S.doc || !model()) return;
  try {
    await dbPut("docs", S.doc.id, {
      meta: { name: S.doc.name, size: S.doc.size, pages: S.doc.numPages, updated: nowIso(), markups: model().markups.length, hasFile: !!S.doc.storedFile },
      state: model(), view: { page: S.view.page },
    });
  } catch (e) { status("Autosave failed: " + e.message, "bad"); }
}
