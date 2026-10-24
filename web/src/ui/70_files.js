// ---------------------------------------------------------------- opening, saving, flattening, exporting
async function openDocument(bytes, name, opts) {
  opts = opts || {};
  showBusy("Opening " + cleanName(name, 60) + "...");
  let pdf;
  try { pdf = await openPdf(bytes); } catch (e) { showBusy(""); status(e.message, "bad"); throw e; }
  const id = await sha256Hex(bytes);
  if (S.doc && S.doc.pdf) { await saveNow(); try { S.doc.pdf.destroy(); } catch (e) { /* ignore */ } }
  resetPdfCaches();
  invalidateRenders();
  hideCompare();
  S.titleBlocks = {};
  if (live.on) endLiveSession("Opened another plan set: you left the live session.");
  S.selection.clear();
  S.vectors = null;
  S.search = null;
  S.candidates = null;
  S.draft = null;
  let state = null, page = 0;
  const saved = DB ? await dbGet("docs", id).catch(() => null) : null;
  if (saved && saved.state) { state = saved.state; page = (saved.view && saved.view.page) || 0; }
  let report = null;
  try { [state, report] = C.clean_document(state || emptyModel(name, id)); } catch (e) { [state, report] = C.clean_document(emptyModel(name, id)); status("The saved markups for this file could not be read and were set aside.", "warn"); }
  state.document = { name: cleanName(name, 200), sha256: /^[0-9a-f]{64}$/.test(id) ? id : "" };
  S.doc = { id, name: cleanName(name, 200), size: bytes.length, bytes, pdf, numPages: pdf.numPages, pageInfo: [], storedFile: false };
  S.hist = C.history_new(state);
  if (opts.carried) {
    // Carried markups land on top of anything already saved for this revision, as one step that
    // Ctrl+Z removes; work already done on the new set is never replaced.
    const merged = mergeCarried(state, C.clean_document(opts.carried)[0], !!(saved && saved.state));
    merged.document = state.document;
    S.doc.carryKept = state.markups.length;
    S.hist = C.history_commit(S.hist, merged, "Carry markups forward");
  }
  indexCache = null;
  if (DB && S.settings.keepPdf) {
    try { await dbPut("files", id, bytes); S.doc.storedFile = true; } catch (e) { status("Could not keep a copy of this PDF on the device (storage full?). Markups are still saved.", "warn"); }
  }
  await kvSet("lastDoc", id);
  S.doc.example = !!opts.example;
  document.title = S.doc.name + " - " + NAME;
  buildThumbs();
  emit("doc");
  emit("model");
  await goToPage(Math.min(page, S.doc.numPages - 1), { force: true });
  showBusy("");
  if (opts.carried) scheduleSave();
  const dropped = report ? Object.values(report).reduce((a, b) => a + b, 0) : 0;
  if (dropped) status("Opened, but " + dropped + " saved entries were not valid and were skipped.", "warn");
  return S.doc;
}
// Combine a takeoff carried from an older revision with what is already saved for the new one.
// Without saved work the carried takeoff is used whole (its layers, assemblies, columns and units).
function mergeCarried(base, carried, hasSaved) {
  if (!hasSaved) return Object.assign({}, carried);
  const out = Object.assign({}, base);
  const ids = new Set(base.markups.map((m) => m.id));
  out.markups = base.markups.concat(carried.markups.filter((m) => !ids.has(m.id)));
  out.pages = Object.assign({}, base.pages);
  for (const [k, e] of Object.entries(carried.pages)) {
    const b = out.pages[k];
    if (!b) out.pages[k] = e;
    else if (!b.scale && e.scale) out.pages[k] = Object.assign({}, b, { scale: e.scale });
  }
  const union = (a, b) => a.concat(b.filter((x) => !a.some((y) => y.id === x.id)));
  out.layers = union(base.layers, carried.layers);
  out.assemblies = union(base.assemblies, carried.assemblies);
  out.columns = union(base.columns, carried.columns);
  return out;
}
async function openFromFile(file) {
  if (!file) return;
  if (file.size > MAX_PDF_BYTES) { status("This PDF is larger than 500 MB. Split the set and open the parts.", "bad"); return; }
  try {
    const bytes = await readFileBytes(file);
    await openDocument(bytes, file.name || "plans.pdf");
    status("Opened " + cleanName(file.name, 80) + ". Markups are saved on this device as you work.");
  } catch (e) { status(e.message, "bad"); }
}
async function openExample() {
  const node = $("example-pdf");
  await openDocument(b64ToBytes(node.textContent), node.dataset.name, { example: true });
  status("Example data: an invented three-sheet plan set. Read title blocks in Sheets, calibrate, and measure.");
}
async function openRecent() {
  const list = await recentDocs();
  const ul = el("ul", { cls: "list", id: "recent-list" });
  for (const d of list.slice(0, 50)) {
    const b = el("button", { type: "button", cls: "link", text: d.name + "  (" + d.pages + " pages, " + d.markups + " markups)" });
    b.disabled = !d.hasFile;
    b.addEventListener("click", async () => {
      closeDialog();
      const bytes = await dbGet("files", d.id);
      if (!bytes) { status("The PDF copy is not on this device. Open the file again; its markups come back with it.", "warn"); return; }
      await openDocument(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), d.name);
    });
    const del = el("button", { type: "button", cls: "iconbtn", "aria-label": "Forget " + d.name }, [icon("trash")]);
    del.addEventListener("click", async () => { await dbDel("docs", d.id); await dbDel("files", d.id); li.remove(); });
    const li = el("li", null, [b, el("span", { cls: "help", text: String(d.updated).slice(0, 10) }), del]);
    ul.append(li);
  }
  openDialog({ title: "Recent plan sets", body: list.length ? ul : el("p", { cls: "help", text: "Nothing saved on this device yet." }), actions: [{ label: "Close" }] });
}

// Markup file: the editable sidecar (JSON) for a PDF.
function markupFileName() { return safeFileName((S.doc ? S.doc.name : "plans").replace(/\.pdf$/i, "")) + ".markups.json"; }
async function saveMarkupFile() {
  if (!S.doc) return;
  const data = JSON.stringify(Object.assign({ app: NAME }, model()), null, 1);
  await saveFile(markupFileName(), data, "application/json", "Markup file");
  status("Markup file saved. Open it with the same PDF to keep editing.");
}
async function openMarkupFile(file) {
  if (!S.doc || !file) return;
  if (file.size > 50 * 1024 * 1024) { status("A markup file over 50 MB is not accepted.", "bad"); return; }
  let raw;
  try { raw = JSON.parse(await readFileText(file)); } catch (e) { status("This is not a valid markup file (JSON could not be read).", "bad"); return; }
  let doc, report;
  try { [doc, report] = C.clean_document(raw); } catch (e) { status(e.message, "bad"); return; }
  const dropped = Object.values(report).reduce((a, b) => a + b, 0);
  const mismatch = doc.document && doc.document.sha256 && doc.document.sha256 !== S.doc.id;
  const tooFar = doc.markups.filter((m) => m.page >= S.doc.numPages).length;
  const body = el("div", null, [
    el("p", { text: doc.markups.length + " markups, " + doc.layers.length + " layers, " + doc.assemblies.length + " assemblies." }),
    dropped ? el("p", { cls: "chip warn", text: dropped + " invalid entries were skipped." }) : null,
    mismatch ? el("p", { cls: "chip warn", text: "This markup file was made for a different PDF (" + (doc.document.name || "unknown") + "). Pages may not line up." }) : null,
    tooFar ? el("p", { cls: "chip warn", text: tooFar + " markups are on pages this PDF does not have and will be dropped." }) : null,
  ]);
  const take = (replace) => {
    commit(replace ? "Replace markups from file" : "Add markups from file", (n) => {
      const ms = doc.markups.filter((m) => m.page < S.doc.numPages);
      if (replace) { Object.assign(n, doc, { document: n.document }); n.markups = ms; return; }
      const ids = new Set(n.markups.map((m) => m.id));
      n.markups = n.markups.concat(ms.filter((m) => !ids.has(m.id)));
      const lids = new Set(n.layers.map((l) => l.id));
      n.layers = n.layers.concat(doc.layers.filter((l) => !lids.has(l.id)));
      const aids = new Set(n.assemblies.map((a) => a.id));
      n.assemblies = n.assemblies.concat(doc.assemblies.filter((a) => !aids.has(a.id)));
      const cids = new Set(n.columns.map((c) => c.id));
      n.columns = n.columns.concat(doc.columns.filter((c) => !cids.has(c.id)));
      n.pages = Object.assign({}, doc.pages, n.pages);
    });
  };
  openDialog({ title: "Open markup file", body, actions: [{ label: "Cancel" }, { label: "Add to current", id: "mk-merge", onClick: () => take(false) }, { label: "Replace current", primary: true, id: "mk-replace", onClick: () => take(true) }] });
}

// Flatten: draw every visible markup into a copy of the PDF with pdf-lib.
function matInv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
function hexRgb(h) { const n = parseInt(String(h || paperInk()).slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
function arcPts(cx, cy, rx, ry, a0, a1, n) { const out = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return out; }
function cloudPts(pts) {
  const P = pts.concat([pts[0]]);
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], L = C.dist(a, b), n = Math.max(1, Math.round(L / 14));
    for (let k = 0; k < n; k++) {
      const s = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], e = [a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n];
      const c = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2], r = L / n / 2, ang = Math.atan2(e[1] - s[1], e[0] - s[0]);
      out.push(...arcPts(c[0], c[1], r, r, ang + Math.PI, ang + 2 * Math.PI, 6));
    }
  }
  return out;
}
// Count glyph outlines (circle, square, triangle, diamond) as point lists for the PDF writer.
function glyphPts(p, shape, s) {
  const [x, y] = p;
  if (shape === "square") return [[x - s * 0.85, y - s * 0.85], [x + s * 0.85, y - s * 0.85], [x + s * 0.85, y + s * 0.85], [x - s * 0.85, y + s * 0.85]];
  if (shape === "triangle") return [[x, y - s], [x + s, y + s * 0.8], [x - s, y + s * 0.8]];
  if (shape === "diamond") return [[x, y - s * 1.1], [x + s * 1.1, y], [x, y + s * 1.1], [x - s * 1.1, y]];
  return arcPts(x, y, s, s, 0, 2 * Math.PI, 16);
}
// Primitives in sheet points: polylines/polygons and text blocks.
function flatShapes(m) {
  const col = colorOf(m), w = widthOf(m), op = m.opacity !== undefined ? m.opacity : 1;
  const P = m.points, out = [];
  const line = (pts, closed, extra) => out.push(Object.assign({ kind: "poly", pts, closed: !!closed, stroke: col, width: w, opacity: 1 }, extra || {}));
  const text = (x, y, s, size, color) => out.push({ kind: "text", x, y, lines: String(s || "").split("\n"), size, color: color || col });
  const disp = displayOf(m);
  const lab = disp ? disp.text : "";
  switch (m.type) {
    case "length": case "line": case "arrow": {
      line([P[0], P[1]]);
      if (m.type === "length") {
        // the architect's 45 degree tick at each end
        const ang = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]) - Math.PI / 4, s = 3.2 * Math.max(1, w / 2.2);
        for (const q of [P[0], P[1]]) line([[q[0] - Math.cos(ang) * s, q[1] - Math.sin(ang) * s], [q[0] + Math.cos(ang) * s, q[1] + Math.sin(ang) * s]], false, { width: 1.6 });
      }
      if (m.type === "arrow" || m.type === "callout") {
        const ang = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]), s = 6 + w * 2;
        line([[P[1][0] - s * Math.cos(ang - 0.45), P[1][1] - s * Math.sin(ang - 0.45)], P[1], [P[1][0] - s * Math.cos(ang + 0.45), P[1][1] - s * Math.sin(ang + 0.45)]]);
      }
      if (lab) text((P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2 - 12, lab, 9, paperInk());
      break;
    }
    case "polylength": case "polyline": case "pen": case "perimeter": case "angle":
      line(P, m.type === "perimeter" && P.length > 2);
      if (lab) text(P[Math.floor(P.length / 2)][0], P[Math.floor(P.length / 2)][1] - 12, lab, 9, paperInk());
      break;
    case "area": case "volume": case "polygon": {
      const filled = m.type !== "polygon" || m.fill;
      line(P, true, { holes: m.holes || [], fill: filled ? (m.fill || col) : null, fillOpacity: m.type === "polygon" ? op : (m.type === "volume" ? 0.14 : fillOf(m)) });
      if (lab) { const c = C.centroid(P); text(c[0] - lab.length * 2.5, c[1] - 5, lab, 9, paperInk()); }
      break;
    }
    case "count":
      for (const p of P) line(glyphPts(p, glyphOf(m), 5), true, { fill: col, fillOpacity: 0.9, stroke: paper(), width: 1.4 });
      if (lab && P.length) text(P[0][0] + 7, P[0][1] - 14, lab, 9, paperInk());
      break;
    case "radius": case "diameter": {
      const b = markupBounds(m), c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], r = (b[2] - b[0]) / 2;
      line(arcPts(c[0], c[1], r, r, 0, 2 * Math.PI, 72), true);
      if (m.type === "diameter") { const ang = Math.atan2(P[0][1] - c[1], P[0][0] - c[0]); line([[c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r], [c[0] - Math.cos(ang) * r, c[1] - Math.sin(ang) * r]]); }
      if (lab) text(c[0], c[1] - 14, lab, 9, paperInk());
      break;
    }
    case "rect": line(rectPts(P[0], P[1]), true, m.fill ? { fill: m.fill, fillOpacity: op } : null); break;
    case "highlight": line(rectPts(P[0], P[1]), true, { fill: col, fillOpacity: fillOf(m), width: 0 }); break;
    case "ellipse": { const a = P[0], b = P[1]; line(arcPts((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 2 * Math.PI, 72), true, m.fill ? { fill: m.fill, fillOpacity: op } : null); break; }
    case "cloud": { const pts = P.length === 2 ? rectPts(P[0], P[1]) : P; line(cloudPts(pts), true); if (m.text) { const b = C.bbox(pts); text(b[2] + 4, b[1], m.text, m.font_size || 10); } break; }
    case "callout": {
      const b = textBox(m), anchor = [P[0][0] < b[0] ? b[0] : b[2], (b[1] + b[3]) / 2];
      line([P[0], anchor]);
      const ang = Math.atan2(P[0][1] - anchor[1], P[0][0] - anchor[0]);
      line([[P[0][0] - 7 * Math.cos(ang - 0.45), P[0][1] - 7 * Math.sin(ang - 0.45)], P[0], [P[0][0] - 7 * Math.cos(ang + 0.45), P[0][1] - 7 * Math.sin(ang + 0.45)]]);
      line(rectPts([b[0], b[1]], [b[2], b[3]]), true, { fill: paper(), fillOpacity: 1, width: Math.max(0.75, w) });
      text(b[0] + (m.font_size || 12) * 0.4, b[1] + (m.font_size || 12) * 0.1, m.text, m.font_size || 12, m.color || paperInk());
      break;
    }
    case "text": text(P[0][0], P[0][1], m.text, m.font_size || 12); break;
    case "stamp": { const b = stampBox(m), fs = m.font_size || 20; line(rectPts([b[0], b[1]], [b[2], b[3]]), true, { width: Math.max(1.5, fs / 10) }); text(b[0] + fs * 0.5, b[1] + fs * 0.3, m.text || "STAMP", fs); break; }
    default: break;
  }
  return out;
}
// Snapshot (G): the boxed area of the sheet as a picture, markups included, drawn with the same
// shapes the flattened PDF gets. It goes to the clipboard when the browser allows it, and the dialog
// offers Copy again and Save as PNG.
function drawShapes(ctx, shapes, toPx, k) {
  for (const s of shapes) {
    if (s.kind === "poly") {
      ctx.beginPath();
      const ring = (pts, closed) => { pts.forEach((q, i) => { const r = toPx(q); if (i) ctx.lineTo(r[0], r[1]); else ctx.moveTo(r[0], r[1]); }); if (closed) ctx.closePath(); };
      ring(s.pts, s.closed);
      for (const h of s.holes || []) ring(h, true);
      if (s.fill) { ctx.globalAlpha = s.fillOpacity === undefined ? 1 : s.fillOpacity; ctx.fillStyle = s.fill; ctx.fill("evenodd"); }
      if (s.width > 0) { ctx.globalAlpha = s.opacity === undefined ? 1 : s.opacity; ctx.strokeStyle = s.stroke; ctx.lineWidth = s.width * k; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke(); }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = s.color;
      ctx.font = Math.max(1, s.size * k) + 'px "Encode Sans", "Helvetica Neue", Arial, sans-serif';
      s.lines.forEach((ln, i) => { const r = toPx([s.x, s.y + s.size * (i + 1) * 1.2 - s.size * 0.2]); ctx.fillText(ln.slice(0, 500), r[0], r[1]); });
    }
  }
}
async function snapshotCanvas(page, box, maxPx) {
  const pg = await getPage(S.doc, page);
  const w = box[2] - box[0], h = box[3] - box[1];
  const k = Math.max(0.5, Math.min(4, Math.sqrt((maxPx || 16e6) / (w * h))));
  const cv = document.createElement("canvas");
  await renderInto(pg, cv, k, box[0] * k, box[1] * k, w * k, h * k).promise;
  const ctx = cv.getContext("2d");
  const toPx = (q) => [(q[0] - box[0]) * k, (q[1] - box[1]) * k];
  for (const m of pageMarkups(page)) {
    if (!layerVisible(m)) continue;
    const b = markupBounds(m);
    if (b[2] < box[0] || b[0] > box[2] || b[3] < box[1] || b[1] > box[3]) continue;
    drawShapes(ctx, flatShapes(m), toPx, k);
  }
  return cv;
}
async function copyPicture(blob) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === "undefined") return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch (e) { return false; }
}
async function runSnapshot(box) {
  if (!S.doc) return;
  showBusy("Taking a snapshot...");
  let cv;
  try { cv = await snapshotCanvas(S.view.page, box); } catch (e) { showBusy(""); status("Snapshot failed: " + cleanName(e && e.message, 100), "bad"); return; }
  showBusy("");
  const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
  if (!blob) { status("Snapshot failed: the picture could not be made.", "bad"); return; }
  const copied = await copyPicture(blob);
  const url = URL.createObjectURL(blob);
  const img = el("img", { src: url, alt: "Snapshot of the boxed area", cls: "snap-preview", id: "snapshot-img" });
  const name = safeFileName(S.doc.name.replace(/\.pdf$/i, "")) + "-" + sheetLabel(S.view.page) + "-snapshot.png";
  openDialog({ title: "Snapshot", icon: "snapshot", src: "Sheet " + sheetLabel(S.view.page) + ", " + cv.width + " x " + cv.height + " px", body: el("div", { cls: "stack" }, [
    el("p", { cls: "help", id: "snapshot-note", text: copied ? "Copied to the clipboard as a picture. Paste it into an email, a report or a spreadsheet." : "The browser did not allow copying a picture here. Use Save as PNG, or Copy picture to try again." }),
    img]), onCancel: () => URL.revokeObjectURL(url),
  actions: [{ label: "Copy picture", id: "snapshot-copy", onClick: async () => { const ok = await copyPicture(blob); $("snapshot-note").textContent = ok ? "Copied to the clipboard." : "Copying a picture is not allowed here; use Save as PNG."; return true; } },
    { label: "Save as PNG", primary: true, id: "snapshot-save", onClick: async () => { await saveFile(name, blob, "image/png", "PNG picture"); URL.revokeObjectURL(url); } }] });
  status("Snapshot of " + cv.width + " x " + cv.height + " px" + (copied ? " copied to the clipboard." : " ready to save."));
  S.lastSnapshot = { w: cv.width, h: cv.height, copied };
}
function winAnsi(s) { return String(s).replace(/[^\x20-\x7e\xa0-\xff]/g, "?"); }
async function flattenPdf(opts) {
  if (!S.doc) return null;
  const lib = window.PDFLib;
  if (!lib || !lib.PDFDocument) { status("The PDF writer did not load.", "bad"); return null; }
  showBusy("Flattening markups into a new PDF...");
  try {
    const out = await lib.PDFDocument.load(S.doc.bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    // Do not carry document scripts or open actions into the new file.
    const cat = out.catalog;
    for (const k of ["OpenAction", "AA"]) try { cat.delete(lib.PDFName.of(k)); } catch (e) { /* none */ }
    try { const names = cat.lookup(lib.PDFName.of("Names")); if (names && names.delete) names.delete(lib.PDFName.of("JavaScript")); } catch (e) { /* none */ }
    const font = await out.embedFont(lib.StandardFonts.Helvetica);
    const pages = out.getPages();
    let drawn = 0;
    const byPage = new Map();
    for (const m of model().markups) {
      if (!opts.hidden && !layerVisible(m)) continue;
      if (!byPage.has(m.page)) byPage.set(m.page, []);
      byPage.get(m.page).push(m);
    }
    for (const [p, list] of byPage) {
      if (p >= pages.length) continue;
      const info = await pageInfo(p);
      const inv = matInv(info.transform);
      const toPdf = (q) => C.mat_apply(inv, q[0], q[1]);
      const up = C.mat_apply(inv, 1, 0), o = C.mat_apply(inv, 0, 0);
      const textAngle = Math.atan2(up[1] - o[1], up[0] - o[0]) * 180 / Math.PI;
      const page = pages[p];
      for (const m of list) {
        for (const s of flatShapes(m)) {
          if (s.kind === "poly") {
            const ring = (pts, closed) => pts.map((q, i) => { const r = toPdf(q); return (i ? "L" : "M") + r[0].toFixed(3) + " " + (-r[1]).toFixed(3); }).join(" ") + (closed ? " Z" : "");
            let d = ring(s.pts, s.closed);
            for (const h of s.holes || []) d += " " + ring(h, true);
            const o2 = { x: 0, y: 0, borderWidth: s.width, borderOpacity: s.opacity };
            if (s.width > 0) o2.borderColor = lib.rgb(...hexRgb(s.stroke));
            if (s.fill) { o2.color = lib.rgb(...hexRgb(s.fill)); o2.opacity = s.fillOpacity; }
            if (!s.width && !s.fill) continue;
            page.drawSvgPath(d, o2);
          } else {
            s.lines.forEach((ln, i) => {
              const base = toPdf([s.x, s.y + s.size * (i + 1) * 1.2 - s.size * 0.2]);
              page.drawText(winAnsi(ln).slice(0, 500), { x: base[0], y: base[1], size: s.size, font, color: lib.rgb(...hexRgb(s.color)), rotate: lib.degrees(textAngle) });
            });
          }
        }
        drawn++;
      }
    }
    out.setProducer(NAME + " (Field Tools)");
    const bytes = await out.save({ useObjectStreams: true });
    return { bytes, drawn };
  } finally { showBusy(""); }
}
async function flattenAndSave() {
  if (!S.doc) return;
  const hidden = el("input", { type: "checkbox", id: "flat-hidden" });
  const sidecar = el("input", { type: "checkbox", id: "flat-sidecar", checked: true });
  openDialog({ title: "Flatten markups to a new PDF", body: el("div", null, [
    el("p", { cls: "help", text: "Writes a new PDF with every markup drawn into the pages. The original PDF is not changed. Markups in a flattened PDF are no longer editable, so keep the markup file to edit them later." }),
    el("div", { cls: "row" }, [hidden, el("label", { for: "flat-hidden", text: "Include markups on hidden layers" })]),
    el("div", { cls: "row" }, [sidecar, el("label", { for: "flat-sidecar", text: "Also save the editable markup file" })]),
  ]), actions: [{ label: "Cancel" }, { label: "Flatten", primary: true, id: "flat-ok", onClick: async () => {
    try {
      const r = await flattenPdf({ hidden: hidden.checked });
      if (!r) return;
      await saveFile(safeFileName(S.doc.name.replace(/\.pdf$/i, "")) + "-flattened.pdf", new Blob([r.bytes], { type: "application/pdf" }), "application/pdf", "PDF");
      if (sidecar.checked) await saveMarkupFile();
      status("Flattened " + r.drawn + " markups into a new PDF.");
    } catch (e) { status("Flatten failed: " + cleanName(e.message, 120), "bad"); }
  } }] });
}

// Settings and data.
async function openSettings() {
  const author = input({ id: "set-author", value: S.settings.author || "" });
  const wheel = select([["zoom", "Zoom"], ["scroll", "Scroll"]], S.settings.wheel, { id: "set-wheel" });
  const keep = el("input", { type: "checkbox", id: "set-keep", checked: S.settings.keepPdf });
  const auto = el("input", { type: "checkbox", id: "set-auto-scale", checked: S.settings.autoTitleScale });
  const theme = select([["", "Follow the system"], ["light", "Light"], ["dark", "Dark"]], S.settings.theme, { id: "set-theme" });
  const gridFt = el("input", { type: "number", id: "set-grid", min: 0.1, max: 100, step: 0.5, value: S.settings.gridFt });
  const stun = input({ id: "set-stun", value: S.settings.stunHost || "", placeholder: "stun.example.org:3478" });
  const aiBase = input({ id: "set-ai-base", value: S.settings.aiBase || "", placeholder: "https://your-service.example/v1 or http://localhost:11434/v1" });
  const aiModel = input({ id: "set-ai-model", value: S.settings.aiModel || "", placeholder: "the model id the service uses" });
  const storedKey = await kvGet("aiKey", "");
  const aiKeyIn = el("input", { type: "password", id: "set-ai-key", autocomplete: "off", spellcheck: "false", value: AI.key || storedKey || "", placeholder: "paste your key" });
  const aiKeep = el("input", { type: "checkbox", id: "set-ai-keep", checked: !!storedKey });
  const usage = await storageUsage();
  const del = el("button", { type: "button", cls: "btn danger", id: "set-delete-all", text: "Delete all data on this device" });
  del.addEventListener("click", () => {
    openDialog({ title: "Delete all data?", body: el("p", { text: "This removes every saved markup, every kept PDF copy, the tool chest and settings from this browser. Files on your disk are not touched. This cannot be undone." }),
      actions: [{ label: "Cancel" }, { label: "Delete everything", danger: true, id: "set-delete-confirm", onClick: async () => { await deleteAllData(); toast("All local data deleted. Reloading."); setTimeout(() => location.reload(), 900); } }] });
  });
  openDialog({ title: "Settings", body: el("div", null, [
    field("Author name", author), field("Mouse wheel", wheel), field("Grid spacing (ft)", gridFt), field("Theme", theme),
    el("div", { cls: "row" }, [keep, el("label", { for: "set-keep", text: "Keep a copy of opened PDFs on this device so they reopen after a reload" })]),
    el("div", { cls: "row" }, [auto, el("label", { for: "set-auto-scale", text: "Rule: set the scale from the title block automatically on pages that have none (undoable)" })]),
    el("h3", { cls: "h", text: "Network switches" }),
    el("p", { cls: "help", text: "Everything runs in this browser and the page makes no network requests while these are off. Each one is off until you turn it on." }),
    ...Object.entries(NET_SWITCHES).map(([k, sw]) => el("label", { cls: "row sw-row", for: "set-net-" + k }, [el("input", { type: "checkbox", id: "set-net-" + k, checked: switchOn(k) }),
      el("span", null, [el("b", { text: sw.title }), el("span", { cls: "help", text: sw.detail })])])),
    el("p", { cls: "help", text: C.AI_SERVICE.label + ": any service with an OpenAI-compatible chat completions API, or a model server on this computer (http://localhost or http://127.0.0.1). Requests go only to the address you type here." }),
    field("Service base address", aiBase),
    field("Model id", aiModel),
    field("Your key", aiKeyIn),
    el("label", { cls: "row sw-row", for: "set-ai-keep" }, [aiKeep, el("span", { text: "Keep the key on this device (otherwise it is forgotten when this page closes). It is never put in exports or markup files." })]),
    field("STUN host (optional)", stun),
    el("p", { cls: "help", text: "Leave empty to keep live sessions on the local network. A STUN host (for example a public one your team trusts) lets peers on different networks find each other; only connection addresses go to it, never markups." }),
    el("h3", { cls: "h", text: "Privacy" }),
    el("p", { cls: "help", text: "Plan files and markups stay on this device in its storage" + (usage ? " (about " + C.format_number((usage.usage || 0) / 1048576, 1) + " MB used)" : "") + "." }),
    del,
  ]), actions: [{ label: "Cancel" }, { label: "Save", primary: true, id: "set-save", onClick: () => {
    S.settings.author = cleanName(author.value, 100);
    S.settings.wheel = wheel.value;
    S.settings.keepPdf = keep.checked;
    S.settings.autoTitleScale = auto.checked;
    S.settings.gridFt = Math.max(0.1, Math.min(100, Number(gridFt.value) || 1));
    S.settings.theme = theme.value;
    S.settings.net = {};
    for (const k of Object.keys(NET_SWITCHES)) if ($("set-net-" + k).checked) S.settings.net[k] = true;
    const sv = String(stun.value || "").trim();
    if (sv && !stunServer(sv)) { status("That STUN host is not a host name or address (host or host:port).", "warn"); return true; }
    S.settings.stunHost = sv;
    const base = String(aiBase.value || "").trim().slice(0, 300);
    if (base && !C.ai_endpoint(base).ok) { status(C.ai_endpoint(base).why, "warn"); return true; }
    S.settings.aiBase = base;
    delete S.settings.aiProvider;
    S.settings.aiModel = cleanName(aiModel.value, 120).replace(/[^A-Za-z0-9._:\/@+-]/g, "");
    const k = String(aiKeyIn.value || "").trim().slice(0, 500);
    AI.key = k || null;
    kvSet("aiKey", aiKeep.checked && k ? k : "");
    if (!switchOn("live")) endLiveSession && endLiveSession("Live session switched off.");
    applyTheme();
    kvSet("settings", S.settings);
    status("Settings saved.");
  } }] });
}
function applyTheme() {
  if (S.settings.theme) document.documentElement.setAttribute("data-theme", S.settings.theme);
  else document.documentElement.removeAttribute("data-theme");
}
// Full export: every takeoff saved on this device in one JSON file (markups, not the PDFs).
async function exportAll() {
  await saveNow();
  const docs = [];
  if (DB) for (const k of await dbKeys("docs")) { const d = await dbGet("docs", k); if (d && d.state) docs.push({ id: k, meta: d.meta, state: d.state }); }
  const data = JSON.stringify({ format: "field-tools-takeoff-export", version: 1, app: NAME, exported: nowIso(), presets: S.presets, takeoffs: docs }, null, 1);
  await saveFile("takeoffs-export.json", data, "application/json", "Export");
  status("Exported " + docs.length + " saved takeoff" + (docs.length === 1 ? "" : "s") + " and the tool chest.");
}
