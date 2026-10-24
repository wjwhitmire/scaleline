// ---------------------------------------------------------------- compare revisions and carry markups forward
function cssColor(name) {
  const probe = el("span", { style: "color:var(" + name + ")" });
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
async function renderGrayOf(pdf, p, scale, W, H) {
  const pg = await pdf.getPage(p + 1);
  const cv = document.createElement("canvas");
  await renderInto(pg, cv, scale, 0, 0, W, H).promise;
  const img = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
  cv.width = cv.height = 1;
  return C.gray_from_rgba(img.data, img.width, img.height);
}
async function loadCompareSource(bytes, name) {
  const pdf = await openPdf(bytes);
  if (S.compare && S.compare.pdf) { try { S.compare.pdf.destroy(); } catch (e) { /* ignore */ } }
  S.compare = { pdf, name, bytes, numPages: pdf.numPages, titles: {}, showBoxes: true };
  // Read sheet numbers in the new set so sheets pair up by number, not page order.
  for (let p = 0; p < Math.min(pdf.numPages, 2000); p++) {
    try {
      const pg = await pdf.getPage(p + 1);
      const vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => {
        const t = window.pdfjsLib.Util.transform(vp.transform, it.transform);
        return { str: it.str, x: t[4], y: t[5], w: it.width, h: Math.hypot(t[2], t[3]) };
      });
      S.compare.titles[p] = C.read_title_block(items, vp.width, vp.height).sheet_number;
    } catch (e) { S.compare.titles[p] = ""; }
  }
}
function matchPage(oldPage) {
  const label = (model().pages[String(oldPage)] || {}).label || (S.titleBlocks[oldPage] || {}).sheet_number || "";
  if (label) {
    for (const [p, t] of Object.entries(S.compare.titles)) if (t && t === label) return { page: Number(p), why: "same sheet number " + label };
  }
  if (S.compare.numPages === 1) return { page: 0, why: "the new file has one page" };
  return { page: Math.min(oldPage, S.compare.numPages - 1), why: "same page position (no matching sheet number)" };
}
async function comparePages(oldPage, newPage) {
  const info = await pageInfo(oldPage);
  const scale = Math.min(2, Math.sqrt(6e6 / (info.w * info.h)));
  const W = Math.round(info.w * scale), H = Math.round(info.h * scale);
  const a = await renderGrayOf(S.doc.pdf, oldPage, scale, W, H);
  const b = await renderGrayOf(S.compare.pdf, newPage, scale, W, H);
  const r = await compute("compare", { a, b, w: W, h: H, max: Math.round(60 * scale), pad: Math.round(6 * scale), min: Math.round(8 * scale),
    cA: cssColor("--cmp-old"), cB: cssColor("--cmp-new"), cBoth: cssColor("--cmp-same") });
  return { scale, W, H, dx: r.dx / scale, dy: r.dy / scale, boxes: r.boxes.map((q) => [q[0] / scale, q[1] / scale, q[2] / scale, q[3] / scale]), img: r.img, nAdded: r.nAdded, nRemoved: r.nRemoved };
}
async function showCompareOverlay(oldPage, newPage, why) {
  showBusy("Comparing sheets...");
  try {
    const r = await comparePages(oldPage, newPage);
    S.compare.page = oldPage;
    S.compare.newPage = newPage;
    S.compare.boxes = r.boxes;
    S.compare.shift = [r.dx, r.dy];
    S.compare.why = why;
    dashOldOnly(r.img, r.W, r.H, cssColor("--cmp-old"), r.scale);
    const cv = $("compare-canvas");
    cv.width = r.W; cv.height = r.H;
    cv.getContext("2d").putImageData(new ImageData(r.img, r.W, r.H), 0, 0);
    S.compare.sideFor = null;
    setCompareMode(S.compare.mode || "overlay");
    status("Compared with " + S.compare.name + " page " + (newPage + 1) + " (" + why + "). " + r.boxes.length + " changed area" + (r.boxes.length === 1 ? "" : "s") +
      "; the new sheet sits " + C.format_number(r.dx, 1) + ", " + C.format_number(r.dy, 1) + " pt from the old. Amber dashed is only in the old sheet, cobalt solid only in the new; changed areas are clouded.");
    return r;
  } finally { showBusy(""); }
}
function hideCompare() {
  $("compare-canvas").hidden = true;
  $("cmp-side").hidden = true;
  if (S.compare) S.compare.boxes = null;
  drawScreenLayer();
}
function compareShowing() { return !$("compare-canvas").hidden || !$("cmp-side").hidden || !!(S.compare && S.compare.boxes); }
// Lines only in the old sheet are drawn dashed, not just in another color: the old-only pixels
// keep a 7 on, 3.5 off rhythm along both diagonals, so horizontal, vertical and sloped lines all
// break into dashes (readable in grayscale and for every color-vision type).
function dashOldOnly(img, w, h, old, scale) {
  const on = Math.max(2, Math.round(7 * scale)), period = on + Math.max(1, Math.round(3.5 * scale));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      if (img[j] !== old[0] || img[j + 1] !== old[1] || img[j + 2] !== old[2]) continue;
      if ((x + y) % period >= on || ((x - y) % period + period) % period >= on) { img[j] = img[j + 1] = img[j + 2] = 255; }
    }
  }
}
// Compare views: Overlay (both sheets in one image), Side by side (the revision in the right half,
// panned and zoomed with this sheet) and Changes (clouds only).
function setCompareMode(mode) {
  if (!S.compare || !S.compare.boxes) return;
  S.compare.mode = mode;
  $("compare-canvas").hidden = mode !== "overlay";
  $("cmp-side").hidden = mode !== "side";
  if (mode === "side") renderCompareSide();
  layoutView();
}
async function renderCompareSide() {
  const c = S.compare;
  if (!c || c.sideFor === c.newPage) { layoutCompareSide(); return; }
  const pg = await c.pdf.getPage(c.newPage + 1);
  const vp = pg.getViewport({ scale: 1 });
  const scale = Math.min(3, 2400 / Math.max(vp.width, vp.height));
  const cv = $("cmp-side-canvas");
  await renderInto(pg, cv, scale, 0, 0, vp.width * scale, vp.height * scale).promise;
  c.sideFor = c.newPage;
  c.sideInfo = { w: vp.width, h: vp.height };
  layoutCompareSide();
}
function layoutCompareSide() {
  const box = $("cmp-side");
  if (box.hidden || !S.compare || !S.compare.sideInfo) return;
  const z = S.view.zoom, sh = S.compare.shift || [0, 0], inf = S.compare.sideInfo;
  const cv = $("cmp-side-canvas");
  cv.style.width = inf.w * z + "px";
  cv.style.height = inf.h * z + "px";
  // The same sheet point sits at the same place in both halves: new = old + shift.
  cv.style.transform = "translate(" + (S.view.panX - sh[0] * z) + "px," + (S.view.panY - sh[1] * z) + "px)";
}
// A revision just opened: compare this sheet with its match at once, so the overlay, the changed
// areas and the view modes are there without another click. The dialog says how they were paired.
async function compareNow() {
  if (!S.compare) return;
  try { const mp = matchPage(S.view.page); await showCompareOverlay(S.view.page, mp.page, mp.why); } catch (e) { status("Compare failed: " + cleanName(e.message, 120), "bad"); }
}
function openCompareDialog() {
  if (!S.doc) return;
  const body = el("div", { cls: "stack" });
  const src = el("p", { cls: "help", id: "cmp-source", text: S.compare ? "Revision: " + S.compare.name + " (" + S.compare.numPages + " page" + (S.compare.numPages === 1 ? "" : "s") + ")" : "Open the new revision of this set, or try the example revision." });
  const openBtn = el("button", { type: "button", cls: "btn small", id: "cmp-open" }, [icon("open"), "Open revision PDF"]);
  openBtn.addEventListener("click", () => $("file-compare").click());
  const exBtn = el("button", { type: "button", cls: "btn small", id: "cmp-example", text: "Use example revision" });
  exBtn.addEventListener("click", async () => {
    const node = $("example-pdf-rev2");
    await loadCompareSource(b64ToBytes(node.textContent), node.dataset.name);
    closeDialog();
    await compareNow();
    openCompareDialog();
  });
  body.append(src, el("div", { cls: "row" }, [openBtn, exBtn]));
  const actions = [{ label: "Close" }];
  if (S.compare) {
    const mp = matchPage(S.view.page);
    const pick = select(Array.from({ length: S.compare.numPages }, (_, i) => [String(i), "Page " + (i + 1) + (S.compare.titles[i] ? " (" + S.compare.titles[i] + ")" : "")]), String(mp.page), { id: "cmp-page" });
    body.append(field("Compare with", pick));
    // Old in amber dashed, new in cobalt solid, unchanged in gray; changed areas as redline clouds.
    body.append(el("div", { cls: "legend" }, [
      el("div", null, [el("span", { cls: "ln d", style: "--c:var(--cmp-old)" }), "Only in this sheet (removed)"]),
      el("div", null, [el("span", { cls: "ln", style: "--c:var(--cmp-new)" }), "Only in the revision (added)"]),
      el("div", null, [el("span", { cls: "ln", style: "--c:var(--cmp-same)" }), "Unchanged"]),
    ]));
    const shift = S.compare.shift && S.compare.page === S.view.page ? " Aligned by a shift of " + C.format_number(S.compare.shift[0], 1) + " pt right and " + C.format_number(S.compare.shift[1], 1) + " pt down, found from the ink profiles." : "";
    body.append(el("div", { cls: "why small" }, [el("b", { text: "Why" }), el("span", { text: "Paired by " + mp.why + "." + shift })]));
    if (S.compare.boxes && S.compare.page === S.view.page) {
      const seg = el("span", { cls: "seg", role: "group", "aria-label": "Compare view", id: "cmp-mode" });
      for (const [m, l] of [["overlay", "Overlay"], ["side", "Side by side"], ["changes", "Changes"]]) {
        const b = el("button", { type: "button", id: "cmp-mode-" + m, "aria-pressed": (S.compare.mode || "overlay") === m ? "true" : "false", text: l });
        b.addEventListener("click", () => { setCompareMode(m); seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); });
        seg.append(b);
      }
      body.append(el("div", { cls: "field" }, [el("span", { cls: "lbl", text: "View" }), seg]));
    }
    const boxes = el("input", { type: "checkbox", id: "cmp-boxes", checked: S.compare.showBoxes });
    boxes.addEventListener("change", () => { S.compare.showBoxes = boxes.checked; drawScreenLayer(); });
    body.append(el("label", { cls: "chk", for: "cmp-boxes" }, [boxes, "Cloud the changed areas on the sheet"]));
    if (S.compare.boxes && S.compare.page === S.view.page) {
      const list = el("div", { id: "cmp-changes" }, [el("span", { cls: "cap", text: S.compare.boxes.length + " changed area" + (S.compare.boxes.length === 1 ? "" : "s") })]);
      S.compare.boxes.slice(0, 50).forEach((b, i) => {
        const z = el("button", { type: "button", cls: "btn small", text: "Zoom" });
        z.addEventListener("click", () => { closeDialog(); zoomTo([b[0] - 60, b[1] - 60, b[2] + 60, b[3] + 60]); });
        list.append(el("div", { cls: "chg" }, [el("span", { cls: "no", text: String(i + 1) }), el("span", { text: "Around " + Math.round(b[0]) + ", " + Math.round(b[1]) + " pt, " + Math.round(b[2] - b[0]) + " by " + Math.round(b[3] - b[1]) + " pt" }), z]));
      });
      body.append(list);
    }
    body.append(el("div", { cls: "note" }, [icon("carry"), el("span", null, [el("b", { text: "Carry markups to revision " }), "opens the new set and copies every markup, scale and setting onto its matching sheet, moved by the measured shift. Markups that touch a changed area are set to Review. The old set and its markups stay as they were."])]));
    actions.push({ label: "Overlay", id: "cmp-run", onClick: () => { showCompareOverlay(S.view.page, Number(pick.value), Number(pick.value) === mp.page ? mp.why : "your choice"); } });
    actions.push({ label: "Cloud changes", id: "cmp-cloud", onClick: async () => { await cloudChanges(Number(pick.value)); } });
    actions.push({ label: "Carry markups to revision", primary: true, id: "cmp-carry", onClick: async () => { await carryForward(); return true; } });
  }
  openDialog({ title: "Compare revisions", icon: "compare", src: S.compare ? "Sheet " + sheetLabel(S.view.page) : null, wide: true, body, actions });
}
async function cloudChanges(newPage) {
  const r = S.compare.page === S.view.page && S.compare.newPage === newPage && S.compare.boxes ? { boxes: S.compare.boxes } : await showCompareOverlay(S.view.page, newPage, "your choice");
  if (!r.boxes.length) { status("No changes found to cloud."); return; }
  const layer = model().layers.find((l) => l.id === "revisions") ? "revisions" : undefined;
  const list = r.boxes.slice(0, 200).map((b) => {
    const m = { id: newId("m"), type: "cloud", page: S.view.page, points: [[round3(b[0]), round3(b[1])], [round3(b[2]), round3(b[3])]], subject: "Revision change", color: pencilColor("m-redline"), created: nowIso(), label: "Found by compare" };
    if (layer) m.layer = layer;
    return C.clean_markup(m);
  }).filter(Boolean);
  addMarkups(list, "Cloud revision changes");
  status("Clouded " + list.length + " changed area" + (list.length === 1 ? "" : "s") + " on layer Revision changes. Ctrl+Z removes them.");
  undoToast("Clouded " + list.length + " changed area" + (list.length === 1 ? "" : "s") + " on Revision changes.");
}
async function carryForward() {
  const old = model();
  const oldName = S.doc.name;
  const pagesWithMarkups = Array.from(new Set(old.markups.map((m) => m.page))).sort((a, b) => a - b);
  const allPages = Array.from({ length: S.doc.numPages }, (_, i) => i);
  // Pair sheets by sheet number first; a sheet without a match pairs with the same page position,
  // unless a numbered sheet already claimed that page.
  await readAllTitleBlocks();
  const pairs = new Map(), claimed = new Set();
  for (const p of allPages) {
    const label = (old.pages[String(p)] || {}).label || (S.titleBlocks[p] || {}).sheet_number || "";
    const hit = label ? Object.entries(S.compare.titles).find(([, t]) => t === label) : null;
    if (hit) { pairs.set(p, { page: Number(hit[0]), why: "same sheet number " + label }); claimed.add(Number(hit[0])); }
  }
  for (const p of allPages) {
    if (pairs.has(p)) continue;
    if (p < S.compare.numPages && !claimed.has(p)) pairs.set(p, { page: p, why: "same page position (no matching sheet number)" });
  }
  showBusy("Carrying markups forward...");
  const carried = [];
  let flagged = 0;
  const report = [];
  try {
    for (const p of pagesWithMarkups) {
      const mp = pairs.get(p);
      if (!mp) { report.push("Sheet " + sheetLabel(p) + ": no matching sheet in the new set; its " + old.markups.filter((m) => m.page === p).length + " markups were not carried"); continue; }
      let r = { dx: 0, dy: 0, boxes: [] };
      try { r = await comparePages(p, mp.page); } catch (e) { /* carry without a shift */ }
      const out = C.carry_forward(old.markups.filter((m) => m.page === p), mp.page, [r.dx, r.dy], r.boxes, () => newId("m"), nowIso());
      for (const m of out.markups) { delete m.carried_from; const c = C.clean_markup(m); if (c) carried.push(c); }
      flagged += out.flagged;
      report.push("Sheet " + sheetLabel(p) + " to page " + (mp.page + 1) + " (" + mp.why + "): " + out.markups.length + " markups, " + out.flagged + " to review");
    }
    const next = JSON.parse(JSON.stringify(old));
    next.markups = carried;
    next.pages = {};
    for (const [p, mp] of pairs) {
      const e = old.pages[String(p)];
      if (e && !next.pages[String(mp.page)]) next.pages[String(mp.page)] = e;
    }
    const bytes = S.compare.bytes, name = S.compare.name;
    S.compare = null;
    $("compare-canvas").hidden = true;
    await openDocument(bytes, name, { carried: next });
    const kept = S.doc.carryKept || 0;
    if (kept) report.unshift("Kept the " + kept + " markup" + (kept === 1 ? "" : "s") + " already saved for " + name + "; the carried markups were added beside them");
    status("Opened " + name + " with " + carried.length + " markups carried from " + oldName + "; " + flagged + " marked Review because the drawing changed under them. Ctrl+Z removes the carried markups.");
    openDialog({ title: "Markups carried forward", icon: "carry", body: el("div", { cls: "stack" }, [
      el("div", { cls: "note" }, [icon("carry"), el("span", null, [el("b", { text: carried.length + " markups carried to " + name + ". " }), flagged + " touch a changed area and are set to Review; filter the list by Review to check them."])]),
    ].concat(report.map((t) => el("p", { cls: "help", text: t })))), actions: [{ label: "Close", primary: true }] });
  } catch (e) {
    status("Carry forward failed: " + cleanName(e.message, 120), "bad");
  } finally { showBusy(""); }
}
