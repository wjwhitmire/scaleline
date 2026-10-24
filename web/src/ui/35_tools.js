// ---------------------------------------------------------------- tools
// Generic industry tool names and the keyboard habits estimators already have.
const TOOLS = [
  { id: "select", label: "Select", icon: "select", key: "V", kind: "select", group: "nav" },
  { id: "pan", label: "Pan", icon: "pan", key: "Shift+V", kind: "pan", group: "nav" },
  { id: "zoom", label: "Zoom", icon: "zoom", key: "Z", kind: "zoom", group: "nav" },
  { id: "text", label: "Text box", icon: "text", key: "T", alt: ["W"], kind: "single", group: "markup" },
  { id: "callout", label: "Callout", icon: "callout", key: "Q", kind: "callout", group: "markup" },
  { id: "cloud", label: "Cloud", icon: "cloud", key: "C", kind: "two", group: "markup" },
  { id: "arrow", label: "Arrow", icon: "arrow", key: "A", kind: "two", group: "markup" },
  { id: "line", label: "Line", icon: "line", key: "L", kind: "two", group: "markup" },
  { id: "rect", label: "Rectangle", icon: "rect", key: "R", kind: "two", group: "markup" },
  { id: "ellipse", label: "Ellipse", icon: "ellipse", key: "E", kind: "two", group: "markup" },
  { id: "polygon", label: "Polygon", icon: "polygon", key: "Shift+P", kind: "multi", closed: true, group: "markup" },
  { id: "polyline", label: "Polyline", icon: "polyline", key: "Shift+N", alt: ["N"], kind: "multi", group: "markup" },
  { id: "pen", label: "Pen", icon: "pen", key: "P", kind: "free", group: "markup" },
  { id: "highlight", label: "Highlight", icon: "highlight", key: "H", kind: "two", group: "markup" },
  { id: "stamp", label: "Stamp", icon: "stamp", key: "", kind: "single", group: "markup" },
  { id: "length", label: "Length", icon: "length", key: "Shift+Alt+L", alt: ["3"], kind: "two", group: "measure" },
  { id: "polylength", label: "Polylength", icon: "polylength", key: "Shift+Alt+Q", alt: ["2"], kind: "multi", group: "measure" },
  { id: "area", label: "Area", icon: "area", key: "Shift+Alt+A", alt: ["1"], kind: "multi", closed: true, group: "measure" },
  { id: "perimeter", label: "Perimeter", icon: "perimeter", key: "Shift+Alt+P", kind: "multi", closed: true, group: "measure" },
  { id: "volume", label: "Volume", icon: "volume", key: "Shift+Alt+V", kind: "multi", closed: true, group: "measure" },
  { id: "count", label: "Count", icon: "count", key: "Shift+Alt+C", alt: ["4"], kind: "count", group: "measure" },
  { id: "angle", label: "Angle", icon: "angle", key: "Shift+Alt+G", kind: "three", group: "measure" },
  { id: "radius", label: "Radius", icon: "radius", key: "Shift+Alt+U", kind: "two", group: "measure" },
  { id: "diameter", label: "Diameter", icon: "diameter", key: "Shift+Alt+D", kind: "two", group: "measure" },
  { id: "calibrate", label: "Calibrate", icon: "calibrate", key: "Shift+Alt+K", kind: "two", group: "auto" },
  { id: "roomfill", label: "Area by click (room fill)", icon: "roomfill", key: "Shift+Alt+F", alt: ["J"], kind: "click", group: "auto" },
  { id: "findsymbol", label: "Find symbol and count", icon: "findsymbol", key: "Shift+Alt+S", kind: "box", group: "auto" },
  { id: "cutout", label: "Add cutout to area", icon: "cutout", key: "Shift+Alt+X", kind: "multi", closed: true, group: "auto" },
  { id: "snapshot", label: "Snapshot", icon: "snapshot", key: "G", kind: "box", group: "doc" },
  { id: "viewport", label: "Viewport", icon: "viewport", key: "Shift+Alt+W", kind: "box", group: "doc" },
];
const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
const TYPING_TOOLS = new Set(["length", "polylength", "line", "polyline", "polygon", "area", "perimeter", "volume", "cutout", "arrow", "rect", "cloud"]);

function setTool(id, preset) {
  if (!TOOL[id]) return;
  cancelDraft();
  S.tool = id;
  S.preset = preset || null;
  S.cutoutPending = false;
  let note = "";
  if (id === "cutout") {
    // A cutout needs the area it cuts. With none selected: the page's only area is used, and with
    // several the next area clicked arms the cutout by itself.
    const isArea = (m) => m && (m.type === "area" || m.type === "volume");
    let sel = Array.from(S.selection).map(markupById).filter(isArea);
    if (sel.length !== 1) {
      const onPage = pageMarkups(S.view.page).filter((m) => isArea(m) && layerVisible(m) && !layerLocked(m));
      if (onPage.length === 1) {
        S.selection = new Set([onPage[0].id]);
        emit("selection");
        sel = onPage;
        note = " Cutting into " + (onPage[0].subject || "the area") + ", the only area on this sheet.";
      }
    }
    if (sel.length !== 1) { S.tool = "select"; S.cutoutPending = true; }
  }
  const v = viewer();
  v.dataset.tool = S.tool;
  v.dataset.draw = ["select", "pan"].includes(S.tool) ? "0" : "1";
  emit("tool");
  const t = TOOL[S.tool];
  const hint = {
    multi: "Click each corner. Enter or double click to finish, Backspace to remove the last point, Esc to cancel. Type a length to place the next point exactly.",
    two: "Click two points, or press and drag. Hold Shift to lock the angle.",
    three: "Click the first arm, the vertex, then the second arm.",
    count: "Click each item to count it. Enter or Esc ends the count.",
    click: "Click inside a room. The enclosed area is traced, with columns and shafts as cutouts.",
    box: S.tool === "snapshot" ? "Drag a box around the area to copy as a picture, markups included." : S.tool === "viewport" ? "Drag a box around a detail or view drawn at its own scale." : "Drag a box around one symbol. Matches on this page are found for you to confirm.",
    single: "Click where it goes.", callout: "Click the point, then where the text goes.", free: "Draw while holding the button down.",
    zoom: "Click to zoom in, Alt-click to zoom out, drag a box to zoom to it.", pan: "Drag to pan.", select: "",
  }[t.kind];
  if (S.cutoutPending) status("Click the area or volume to cut into; the cutout tool then arms itself. Esc cancels.", "warn");
  else if (S.tool !== "select") status(t.label + (S.preset ? " (" + S.preset.name + ")" : "") + ". " + hint + note);
  else status("");
}
// The cutout asked for an area: the first area or volume selected arms it.
on("selection", () => {
  if (!S.cutoutPending || S.tool !== "select") return;
  const sel = Array.from(S.selection).map(markupById).filter((m) => m && (m.type === "area" || m.type === "volume"));
  if (sel.length === 1) setTool("cutout");
});

// Properties a new markup gets: tool defaults, then the preset, then edits made in Properties.
function toolDefaults(type) {
  const p = Object.assign({}, S.preset || {}, S.toolProps[type] || {});
  const out = {};
  for (const k of ["subject", "color", "fill", "opacity", "width", "font_size", "depth", "height", "pitch", "text", "status", "glyph"]) if (p[k] !== undefined && p[k] !== "") out[k] = p[k];
  // A preset names a pencil; the markup keeps the color itself so files and flattened PDFs carry it.
  if (!out.color && p.pencil && TYPE_PENCIL[type]) out.color = pencilColor(p.pencil);
  if (!out.subject) out.subject = C.TYPE_LABELS[type] || type;
  const layer = p.layer || S.settings.activeLayer || "";
  if (layer && layerById(layer)) out.layer = layer;
  const res = C.resolve_assembly(type, p.assembly ? p : null, out.layer ? layerById(out.layer) : null);
  if (res) { out.assembly = res.assembly; out.assembly_source = res.source; }
  if (S.preset) out.preset = S.preset.id;
  return out;
}
function newMarkup(type, points, extra) {
  const m = Object.assign({ id: newId("m"), type, page: S.view.page, points: points.map((p) => [round3(p[0]), round3(p[1])]) }, toolDefaults(type), extra || {});
  m.author = whoAmI();
  if (!m.author) delete m.author;
  m.created = nowIso();
  const vp = m.points.length ? C.viewport_at(model(), m.page, m.points[0]) : null;
  if (vp) m.viewport = vp;
  return stampNew(m);
}
function round3(x) { return Math.round(x * 1000) / 1000; }
function explainAssembly(m) {
  if (!m.assembly) return "";
  const a = model().assemblies.find((x) => x.id === m.assembly);
  if (!a) return "";
  return " Assembly \"" + a.name + "\" applied from the " + (m.assembly_source === "preset" ? "tool chest preset" : "layer") + ".";
}
function createMarkup(type, points, extra, label) {
  const m = newMarkup(type, points, extra);
  const clean = C.clean_markup(m);
  if (!clean) { status("That shape is not complete.", "warn"); return null; }
  addMarkups([clean], label || "Add " + (C.TYPE_LABELS[type] || type).toLowerCase());
  const d = displayOf(clean);
  status((C.TYPE_LABELS[type] || type) + (d ? ": " + d.text : "") + "." + explainAssembly(clean) + (d && d.r && d.r.value === null && d.r.kind !== "count" && d.r.kind !== "angle" ? " This page has no scale yet: calibrate or pick a scale." : ""));
  return clean;
}

// ---------------------------------------------------------------- snapping
function snapPoint(raw, e, from) {
  const tolPage = 10 / S.view.zoom;
  let p = raw;
  S.snapHint = null;
  const noSnap = e && (e.ctrlKey || e.metaKey);
  if (!noSnap) {
    const verts = [], segs = [];
    if (S.settings.snapMarkup) {
      for (const m of pageMarkups(S.view.page)) {
        if (!layerVisible(m) || ["text", "stamp", "callout"].includes(m.type)) continue;
        const b = markupBounds(m);
        if (raw[0] < b[0] - tolPage || raw[0] > b[2] + tolPage || raw[1] < b[1] - tolPage || raw[1] > b[3] + tolPage) continue;
        for (const q of m.points) verts.push(q);
        const closed = ["area", "volume", "polygon", "perimeter"].includes(m.type);
        for (let i = 0; i < m.points.length - 1 + (closed ? 1 : 0); i++) segs.push([m.points[i], m.points[(i + 1) % m.points.length]]);
      }
    }
    if (S.draft) for (const q of S.draft.points.slice(0, -1)) verts.push(q);
    if (S.settings.snapContent && S.vectors && S.vectors.page === S.view.page) {
      for (const s of S.vectors.grid.near(raw[0], raw[1], tolPage)) {
        verts.push([s[0], s[1]], [s[2], s[3]]);
        segs.push([[s[0], s[1]], [s[2], s[3]]]);
      }
      // a scanned sheet also offers the crossings of its lines
      if (S.vectors.grid.pointGrid) for (const s of S.vectors.grid.pointGrid.near(raw[0], raw[1], tolPage)) verts.push([s[0], s[1]]);
    }
    let grid = 0;
    if (S.settings.grid) {
      const sc = pageScale(S.view.page);
      grid = sc ? (S.settings.gridFt * 12) / sc.in_per_pt : 18;
    }
    const r = C.snap(raw, tolPage, verts, segs, grid);
    if (r.kind !== "none") { p = r.point; if (r.kind !== "grid") S.snapHint = r; }
  }
  if (from && (S.settings.ortho || (e && e.shiftKey))) { p = C.snap_angle(from, p, 45); S.snapHint = null; }
  return p;
}
async function loadVectors(p) {
  if (!S.settings.snapContent) return;
  try {
    let grid = await pageVectors(p);
    // A scanned sheet has no line work of its own: find lines in the picture instead.
    if (grid.segs.length < 20) { try { grid = await rasterVectorsCached(p); } catch (e) { /* keep the empty grid */ } }
    if (S.view.page === p) S.vectors = { page: p, grid };
  } catch (e) { S.vectors = null; }
}

// ---------------------------------------------------------------- pointer handling per tool
let press = null; // { x, y, page point, time }
function toolPointer(kind, e) {
  const t = TOOL[S.tool];
  const raw = clientToPage(e);
  if (kind === "down") press = { cx: e.clientX, cy: e.clientY, p: raw, moved: false, type: e.pointerType };
  if (kind === "move" && press && Math.hypot(e.clientX - press.cx, e.clientY - press.cy) > 4) press.moved = true;
  switch (t.kind) {
    case "select": return selectPointer(kind, e, raw);
    case "zoom": return zoomPointer(kind, e, raw);
    case "two": return twoPointer(kind, e, raw);
    case "three": return multiPointer(kind, e, raw, 3);
    case "multi": return multiPointer(kind, e, raw, 0);
    case "count": return countPointer(kind, e, raw);
    case "free": return freePointer(kind, e, raw);
    case "single": if (kind === "up" && !press.moved) singleClick(raw); return null;
    case "callout": return calloutPointer(kind, e, raw);
    case "click": if (kind === "up" && !press.moved) runRoomFill(raw); return null;
    case "box": return boxPointer(kind, e, raw);
    default: return null;
  }
}
function toolCancelPointer() { press = null; if (S.draft && S.draft.drag) cancelDraft(); }
function cancelDraft() {
  if (S.draft) { S.draft = null; drawScreenLayer(); }
  S.snapHint = null;
  closeTypedLength();
}
function drawDraft(scr) {
  const d = S.draft;
  if (d.kind === "box") {
    const a = pageToScreen(d.a[0], d.a[1]), b = pageToScreen(d.b[0], d.b[1]);
    twoTone(scr, "rect", { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) }, "ov-sel-under", "ov-box", 1.2);
    return;
  }
  const pts = d.points.concat(d.hover ? [d.hover] : []);
  if (!pts.length) return;
  const type = d.type;
  const preset = S.preset || {};
  const m = { id: "draft", type, page: S.view.page, points: pts, color: preset.color || (preset.pencil ? pencilColor(preset.pencil) : null) || (S.toolProps[type] && S.toolProps[type].color) || typeColor(type), glyph: preset.glyph };
  if (type === "cutout") { m.type = "polygon"; m.color = pencilColor("m-redline"); }
  if (type === "calibrate") { m.type = "length"; m.color = pencilColor("m-cobalt"); }
  Object.assign(m, S.toolProps[type] || {}, S.preset ? { depth: S.preset.depth, height: S.preset.height, pitch: S.preset.pitch } : {});
  let disp = null;
  if (C.MEASURE_TYPES.includes(m.type) && pts.length >= (m.type === "area" || m.type === "volume" ? 3 : 2)) {
    try {
      const sc = scaleAt(S.view.page, pts[0]);
      const r = C.measure(Object.assign({}, m, { points: pts.map((p) => [p[0], p[1]]) }), sc ? sc.in_per_pt : null);
      disp = { text: unitText(C.display(r, model().settings)[0]) };
      if (type === "calibrate") disp = { text: sc ? unitText(C.display(r, model().settings)[0]) : "" };
    } catch (e) { disp = null; }
  }
  const g = svg("g", { transform: matrixAttr(viewMatrix()), opacity: 0.85 });
  if (pts.length === 1) {
    g.append(svg("circle", { cx: pts[0][0], cy: pts[0][1], r: 4 / S.view.zoom, fill: m.color, class: "ov-cas", "stroke-width": 1.5 / S.view.zoom }));
  } else {
    const node = markupNode(m, { draft: true, disp });
    g.append(node);
  }
  fixScreenSized(g, S.view.zoom);
  scr.append(g);
}

function twoPointer(kind, e, raw) {
  const t = S.tool;
  if (kind === "down") {
    if (!S.draft) { S.draft = { type: t, points: [snapPoint(raw, e)], hover: null, drag: true }; drawScreenLayer(); }
    return;
  }
  if (kind === "move") {
    if (S.draft) { S.draft.hover = snapPoint(raw, e, S.draft.points[0]); drawScreenLayer(); }
    else { snapPoint(raw, e); drawScreenLayer(); }
    return;
  }
  if (kind === "up" && S.draft) {
    if (press && press.moved && S.draft.drag) { finishTwo(snapPoint(raw, e, S.draft.points[0])); return; }
    if (S.draft.points.length === 1 && !S.draft.waiting) { S.draft.waiting = true; S.draft.drag = false; return; }
    if (S.draft.waiting) finishTwo(snapPoint(raw, e, S.draft.points[0]));
  }
}
function finishTwo(b) {
  const d = S.draft;
  const a = d.points[0];
  if (C.dist(a, b) * S.view.zoom < 3) { return; }
  S.draft = null;
  S.snapHint = null;
  if (d.type === "calibrate") { openCalibrate(a, b); drawScreenLayer(); return; }
  if (d.type === "cloud" || d.type === "rect" || d.type === "highlight" || d.type === "ellipse") {
    const lo = [Math.min(a[0], b[0]), Math.min(a[1], b[1])], hi = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    createMarkup(d.type, [lo, hi]);
  } else createMarkup(d.type, [a, b]);
  drawScreenLayer();
}
function multiPointer(kind, e, raw, fixed) {
  const t = S.tool;
  if (kind === "move") {
    const from = S.draft && S.draft.points.length ? S.draft.points[S.draft.points.length - 1] : null;
    const p = snapPoint(raw, e, from);
    if (S.draft) S.draft.hover = p;
    drawScreenLayer();
    return;
  }
  if (kind === "dblclick") { finishMulti(); return; }
  if (kind !== "up" || (press && press.moved)) return;
  const from = S.draft && S.draft.points.length ? S.draft.points[S.draft.points.length - 1] : null;
  const p = snapPoint(raw, e, from);
  if (!S.draft) S.draft = { type: t, points: [], hover: null };
  const pts = S.draft.points;
  // Clicking the first point again closes a closed shape.
  if (TOOL[t].closed && pts.length >= 3 && C.dist(p, pts[0]) * S.view.zoom < 8) { finishMulti(); return; }
  if (pts.length && C.dist(p, pts[pts.length - 1]) * S.view.zoom < 2) return; // a double click's second click
  pts.push(p);
  if (fixed && pts.length >= fixed) { finishMulti(); return; }
  drawScreenLayer();
}
function finishMulti() {
  const d = S.draft;
  if (!d) return;
  const pts = d.points;
  const need = { area: 3, volume: 3, perimeter: 2, polygon: 3, polyline: 2, polylength: 2, angle: 3, cutout: 3 }[d.type] || 2;
  if (pts.length < need) { status("Need at least " + need + " points.", "warn"); return; }
  S.draft = null;
  S.snapHint = null;
  closeTypedLength();
  if (d.type === "cutout") {
    const target = Array.from(S.selection).map(markupById).find((m) => m && (m.type === "area" || m.type === "volume"));
    if (!target) { status("The area to cut is no longer selected.", "warn"); return; }
    updateMarkups([target.id], (c) => { c.holes = (c.holes || []).concat([pts.map((q) => [round3(q[0]), round3(q[1])])]); }, "Add cutout");
    const dd = displayOf(markupById(target.id));
    status("Cutout added." + (dd ? " Net: " + dd.text + "." : ""));
    setTool("select");
    return;
  }
  createMarkup(d.type, pts);
  drawScreenLayer();
}
let countSession = null;
function countPointer(kind, e, raw) {
  if (kind === "move") { snapPoint(raw, e); drawScreenLayer(); return; }
  if (kind !== "up" || (press && press.moved)) return;
  const p = snapPoint(raw, e);
  const cur = countSession && markupById(countSession) ;
  if (cur && cur.page === S.view.page) {
    updateMarkups([cur.id], (c) => { c.points = c.points.concat([[round3(p[0]), round3(p[1])]]); }, "Add to count");
    status("Count: " + (cur.points.length + 1) + ". Enter or Esc ends this count.");
  } else {
    const m = createMarkup("count", [p], null, "Add count");
    countSession = m ? m.id : null;
  }
}
function endCount() { countSession = null; }
on("tool", () => { if (S.tool !== "count") endCount(); });
function freePointer(kind, e, raw) {
  if (kind === "down") { S.draft = { type: "pen", points: [raw], hover: null }; return; }
  if (kind === "move" && S.draft) {
    const last = S.draft.points[S.draft.points.length - 1];
    if (C.dist(last, raw) * S.view.zoom > 2) { S.draft.points.push(raw); drawScreenLayer(); }
    return;
  }
  if (kind === "up" && S.draft) {
    const pts = C.simplify(S.draft.points, 0.6 / S.view.zoom);
    S.draft = null;
    if (pts.length >= 2) createMarkup("pen", pts);
    drawScreenLayer();
  }
}
function singleClick(p) {
  if (S.tool === "stamp") {
    createMarkup("stamp", [p], { text: (S.preset && S.preset.text) || (S.toolProps.stamp && S.toolProps.stamp.text) || "APPROVED" });
    return;
  }
  askText("Text box", "", (text) => { if (text) createMarkup("text", [p], { text }); });
}
function calloutPointer(kind, e, raw) {
  if (kind !== "up" || (press && press.moved)) {
    if (kind === "move" && S.draft) { S.draft.hover = raw; drawScreenLayer(); }
    return;
  }
  if (!S.draft) { S.draft = { type: "line", points: [raw], hover: null }; drawScreenLayer(); return; }
  const tip = S.draft.points[0];
  S.draft = null;
  drawScreenLayer();
  askText("Callout", (S.preset && S.preset.text) || "", (text) => { if (text) createMarkup("callout", [tip, raw], { text }); });
}
function askText(title, initial, done) {
  const ta = el("textarea", { id: "ask-text", rows: 4, style: "width:100%" });
  ta.value = initial || "";
  openDialog({ title, body: el("div", null, [el("label", { for: "ask-text", text: "Text", cls: "help" }), ta]),
    actions: [{ label: "Cancel" }, { label: "Place", primary: true, id: "ask-ok", onClick: () => done(ta.value.slice(0, 5000)) }] });
}
function zoomPointer(kind, e, raw) {
  if (kind === "down") { S.draft = { kind: "box", a: raw, b: raw }; return; }
  if (kind === "move" && S.draft && S.draft.kind === "box") { S.draft.b = raw; drawScreenLayer(); return; }
  if (kind === "up" && S.draft) {
    const d = S.draft;
    S.draft = null;
    const r = viewer().getBoundingClientRect();
    if (press && press.moved) zoomTo([Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1]), Math.max(d.a[0], d.b[0]), Math.max(d.a[1], d.b[1])]);
    else zoomAt(e.altKey || e.shiftKey ? 0.5 : 2, e.clientX - r.left, e.clientY - r.top);
    drawScreenLayer();
  }
}
function boxPointer(kind, e, raw) {
  if (kind === "down") { S.draft = { kind: "box", a: raw, b: raw }; return; }
  if (kind === "move" && S.draft && S.draft.kind === "box") { S.draft.b = raw; drawScreenLayer(); return; }
  if (kind === "up" && S.draft) {
    const d = S.draft;
    S.draft = null;
    drawScreenLayer();
    const box = [Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1]), Math.max(d.a[0], d.b[0]), Math.max(d.a[1], d.b[1])];
    if ((box[2] - box[0]) * S.view.zoom < 6 || (box[3] - box[1]) * S.view.zoom < 6) { status(S.tool === "snapshot" ? "Drag a box around the area to copy." : "Drag a box around one symbol.", "warn"); return; }
    if (S.tool === "snapshot") runSnapshot(box); else if (S.tool === "viewport") openViewportDialog(S.view.page, null, box); else runFindSymbol(box);
  }
}

// ---------------------------------------------------------------- selecting and editing
function hitTest(p, tolPage) {
  const list = pageMarkups(S.view.page);
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!layerVisible(m)) continue;
    if (hitMarkup(m, p, tolPage)) return m;
  }
  return null;
}
function distToPoly(p, pts, closed) {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - 1 + (closed ? 1 : 0); i++) best = Math.min(best, C.dist(p, C.nearest_on_segment(p, pts[i], pts[(i + 1) % n])));
  return best;
}
function hitMarkup(m, p, tol) {
  const P = m.points;
  switch (m.type) {
    case "count": return P.some((q) => C.dist(p, q) <= tol + 5);
    case "area": case "volume": case "highlight":
      if (m.type === "highlight") { const b = C.bbox(P); return p[0] >= b[0] - tol && p[0] <= b[2] + tol && p[1] >= b[1] - tol && p[1] <= b[3] + tol; }
      return (C.point_in_polygon(p, P) && !(m.holes || []).some((h) => C.point_in_polygon(p, h))) || distToPoly(p, P, true) <= tol;
    case "text": case "stamp": case "callout": {
      const b = markupBounds(m);
      if (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]) return true;
      return m.type === "callout" && distToPoly(p, [P[0], [b[0], (b[1] + b[3]) / 2]], false) <= tol;
    }
    case "rect": case "cloud": case "ellipse": {
      const b = C.bbox(P.length === 2 ? rectPts(P[0], P[1]) : P);
      const inside = p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
      const edge = Math.min(Math.abs(p[0] - b[0]), Math.abs(p[0] - b[2]), Math.abs(p[1] - b[1]), Math.abs(p[1] - b[3]));
      return inside && (edge <= tol + 4 || (m.fill && m.type !== "cloud"));
    }
    case "radius": case "diameter": { const b = markupBounds(m); const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; return Math.abs(C.dist(p, c) - (b[2] - b[0]) / 2) <= tol || C.dist(p, c) <= tol; }
    case "polygon": return distToPoly(p, P, true) <= tol || (!!m.fill && C.point_in_polygon(p, P));
    case "perimeter": return distToPoly(p, P, P.length > 2) <= tol;
    default: return distToPoly(p, P, false) <= tol;
  }
}
function handleAt(sx, sy) {
  if (S.selection.size !== 1) return null;
  const m = markupById(Array.from(S.selection)[0]);
  if (!m || m.page !== S.view.page || !editableVertices(m) || layerLocked(m)) return null;
  const rings = [{ ring: -1, pts: m.points }].concat((m.holes || []).map((h, i) => ({ ring: i, pts: h })));
  for (const r of rings) for (let i = 0; i < r.pts.length; i++) {
    const s = pageToScreen(r.pts[i][0], r.pts[i][1]);
    if (Math.abs(s[0] - sx) <= 7 && Math.abs(s[1] - sy) <= 7) return { m, ring: r.ring, i };
  }
  return null;
}
let drag = null;
function selectPointer(kind, e, raw) {
  const r = viewer().getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const tol = (e.pointerType === "touch" ? 14 : 6) / S.view.zoom;
  if (kind === "down") {
    const h = handleAt(sx, sy);
    if (h) { drag = { kind: "vertex", h, start: raw, orig: h.m }; return; }
    const m = hitTest(raw, tol);
    if (m) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { if (S.selection.has(m.id)) S.selection.delete(m.id); else S.selection.add(m.id); }
      else if (!S.selection.has(m.id)) { S.selection.clear(); S.selection.add(m.id); }
      emit("selection");
      const movable = Array.from(S.selection).map(markupById).filter((x) => x && !layerLocked(x));
      drag = { kind: "move", start: raw, orig: movable };
      return;
    }
    if (!e.shiftKey) { S.selection.clear(); emit("selection"); }
    drag = { kind: "box" };
    S.draft = { kind: "box", a: raw, b: raw };
    return;
  }
  if (kind === "move") {
    if (!drag) {
      const over = hitTest(raw, tol) || handleAt(sx, sy);
      viewer().style.cursor = handleAt(sx, sy) ? "pointer" : over ? "move" : "";
      return;
    }
    if (drag.kind === "box") { S.draft.b = raw; drawScreenLayer(); return; }
    if (!press || !press.moved) return;
    if (drag.kind === "vertex") {
      const p = snapPoint(raw, e);
      drag.preview = p;
      previewEdit(drag.orig, (c) => setVertex(c, drag.h.ring, drag.h.i, p));
      return;
    }
    if (drag.kind === "move") {
      const dx = raw[0] - drag.start[0], dy = raw[1] - drag.start[1];
      drag.dx = dx; drag.dy = dy;
      const root = $("ov-root");
      for (const m of drag.orig) {
        const g = root.querySelector('g[data-id="' + m.id + '"]');
        if (g) g.setAttribute("transform", "translate(" + dx + " " + dy + ")");
      }
      return;
    }
  }
  if (kind === "up") {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === "box") {
      const a = S.draft.a, b = S.draft.b;
      S.draft = null;
      if (press && press.moved) {
        const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
        for (const m of pageMarkups(S.view.page)) {
          if (!layerVisible(m)) continue;
          const mb = markupBounds(m);
          if (mb[0] >= box[0] && mb[2] <= box[2] && mb[1] >= box[1] && mb[3] <= box[3]) S.selection.add(m.id);
        }
      }
      emit("selection");
      return;
    }
    if (d.kind === "vertex" && d.preview) {
      updateMarkups([d.orig.id], (c) => setVertex(c, d.h.ring, d.h.i, [round3(d.preview[0]), round3(d.preview[1])]), "Edit points");
      return;
    }
    if (d.kind === "move" && (d.dx || d.dy) && d.orig.length) {
      const ids = d.orig.map((m) => m.id);
      updateMarkups(ids, (c) => {
        c.points = c.points.map((q) => [round3(q[0] + d.dx), round3(q[1] + d.dy)]);
        if (c.holes) c.holes = c.holes.map((h) => h.map((q) => [round3(q[0] + d.dx), round3(q[1] + d.dy)]));
      }, ids.length > 1 ? "Move markups" : "Move");
    }
  }
}
function setVertex(c, ring, i, p) {
  if (ring < 0) { c.points = c.points.slice(); c.points[i] = p; }
  else { c.holes = c.holes.map((h, k) => (k === ring ? h.map((q, j) => (j === i ? p : q)) : h)); }
}
function previewEdit(orig, fn) {
  const c = JSON.parse(JSON.stringify(orig));
  fn(c);
  const root = $("ov-root");
  const g = root.querySelector('g[data-id="' + orig.id + '"]');
  const node = markupNode(c, { draft: true, disp: (() => { try { const sc = markupScaleOf(c); const r = C.measure(c, sc ? sc.in_per_pt : null); return { text: unitText(C.display(r, model().settings)[0]) }; } catch (e) { return null; } })() });
  if (g) g.replaceWith(node);
  fixScreenSized(node, S.view.zoom);
  overlayDirty = true;
}

// ---------------------------------------------------------------- typed lengths (sketch to scale)
let typed = null;
function openTypedLength(firstChar) {
  if (!S.draft || !S.draft.points || !S.draft.points.length || !TYPING_TOOLS.has(S.draft.type)) return false;
  if (!scaleAt(S.view.page, S.draft.points[0])) { status("Set the page scale first, then typed lengths are placed to scale.", "warn"); return true; }
  closeTypedLength();
  const last = S.draft.points[S.draft.points.length - 1];
  const s = pageToScreen(last[0], last[1]);
  const inp = input({ id: "typed-length-input", "aria-label": "Length of the next segment", placeholder: "12'-6\"" });
  inp.value = firstChar || "";
  const box = el("div", { cls: "typed-length", style: "left:" + Math.max(4, Math.min(vw() - 250, s[0] + 14)) + "px;top:" + Math.max(4, s[1] + 14) + "px" }, [icon("length"), el("label", { for: "typed-length-input", text: "Next segment" }), inp, el("kbd", { text: "Enter" })]);
  viewer().append(box);
  typed = box;
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { closeTypedLength(); viewer().focus(); }
    if (e.key === "Enter") {
      e.preventDefault();
      let inches;
      try { inches = C.parse_length(inp.value, lengthInputUnit()); } catch (err) { status(err.message, "warn"); return; }
      placeTyped(inches);
      closeTypedLength();
      viewer().focus();
    }
  });
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
  return true;
}
function lengthInputUnit() { const u = model().settings.length_unit; return u === "ftin" ? "ft" : u; }
function closeTypedLength() { if (typed) { typed.remove(); typed = null; } }
function placeTyped(inches) {
  const d = S.draft;
  if (!d) return;
  const sc = scaleAt(S.view.page, d.points[0]);
  const last = d.points[d.points.length - 1];
  const toward = d.hover || [last[0] + 1, last[1]];
  let dir = [toward[0] - last[0], toward[1] - last[1]];
  const L = Math.hypot(dir[0], dir[1]) || 1;
  dir = [dir[0] / L, dir[1] / L];
  const pts = inches / sc.in_per_pt;
  const p = [last[0] + dir[0] * pts, last[1] + dir[1] * pts];
  if (TOOL[d.type].kind === "two") { S.draft.hover = p; finishTwo(p); return; }
  d.points.push(p);
  d.hover = p;
  drawScreenLayer();
  status("Placed " + C.format_length(inches, model().settings.length_unit, 2) + ". Keep typing lengths or click; Enter finishes.");
}
