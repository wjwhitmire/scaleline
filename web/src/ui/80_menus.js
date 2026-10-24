// ---------------------------------------------------------------- menus, toolbar, keyboard, status bar
function cmd(label, run, key, opts) { return Object.assign({ label, run, key: key || "" }, opts || {}); }
const MENUS = () => [
  ["File", [
    cmd("Open PDF...", () => $("file-pdf").click(), "Ctrl+O", { icon: "open" }),
    cmd("Open example plan set", openExample, "", { icon: "pages" }),
    cmd("Recent plan sets...", openRecent),
    "-",
    cmd("Save markup file", saveMarkupFile, "Ctrl+S", { icon: "save" }),
    cmd("Open markup file...", () => $("file-markups").click()),
    cmd("Flatten markups to new PDF...", flattenAndSave, "", { icon: "flatten" }),
    cmd("Save PDF with markups as annotations...", exportAnnotatedPdf, "", { icon: "export", id: "menu-annot-pdf" }),
    cmd("Import markups from this PDF...", () => openPdfImport(false), "", { icon: "import", id: "menu-annot-import" }),
    cmd("Import a markup summary (CSV or XML)...", () => $("file-summary").click(), "", { icon: "import", id: "menu-summary-import" }),
    "-",
    cmd("Export workbook (XLSX)", exportXlsx, "", { icon: "table", id: "menu-xlsx" }),
    cmd("Markup summary report (PDF)", exportSummaryPdf, "", { icon: "report", id: "menu-summary-pdf" }),
    cmd("Estimate report (PDF)", exportEstimatePdf, "", { icon: "report", id: "menu-estimate-pdf" }),
    cmd("Export markups list (CSV)", exportListCsv, "", { icon: "export" }),
    cmd("Export all saved takeoffs (JSON)", exportAll, "", { icon: "export" }),
    cmd("Export estimate (CSV)", () => { togglePanel("bottom", "estimate", true); $("est-export") && $("est-export").click(); }, "", { icon: "estimate" }),
    "-",
    cmd("Settings and privacy...", openSettings, "", { icon: "settings" }),
  ]],
  ["Edit", [
    cmd(() => "Undo" + (S.hist.past.length ? " " + S.hist.past[S.hist.past.length - 1].label.toLowerCase() : ""), undo, "Ctrl+Z", { icon: "undo", disabled: () => !S.hist.past.length }),
    cmd(() => "Redo" + (S.hist.future.length ? " " + S.hist.future[0].label.toLowerCase() : ""), redo, "Ctrl+Y", { icon: "redo", disabled: () => !S.hist.future.length }),
    "-",
    cmd("Copy", copySelection, "Ctrl+C", { icon: "copy" }),
    cmd("Paste", pasteMarkups, "Ctrl+V"),
    cmd("Delete", () => deleteMarkups(Array.from(S.selection)), "Delete", { icon: "trash", disabled: () => !S.selection.size }),
    cmd("Select all on page", selectAllOnPage, "Ctrl+A", { icon: "select" }),
    "-",
    cmd("Snapshot (copy an area as a picture)", () => setTool("snapshot"), "G", { icon: "snapshot" }),
    cmd("Viewport (a scale for one area)", () => setTool("viewport"), "Shift+Alt+W", { icon: "viewport" }),
  ]],
  ["View", [
    cmd("Zoom in", () => zoomAt(1.25, vw() / 2, vh() / 2), "Ctrl+=", { icon: "zoom" }),
    cmd("Zoom out", () => zoomAt(0.8, vw() / 2, vh() / 2), "Ctrl+-"),
    cmd("Fit page", () => fitPage(), "Ctrl+9", { icon: "fit" }),
    cmd("Fit width", fitWidth, "Ctrl+0"),
    cmd("Actual size", actualSize, "Ctrl+8"),
    cmd("Rotate view clockwise", () => rotateView(90), "Ctrl+Shift+Plus", { icon: "rotate-cw" }),
    cmd("Rotate view counterclockwise", () => rotateView(-90), "Ctrl+Shift+Minus", { icon: "rotate-ccw" }),
    "-",
    cmd("Markups list", () => togglePanel("bottom", "list"), "Alt+L", { icon: "markups-list" }),
    cmd("Tool chest", () => togglePanel("right", "chest"), "Alt+X", { icon: "chest" }),
    cmd("Layers", () => togglePanel("right", "layers"), "Alt+Y", { icon: "layers" }),
    cmd("Thumbnails", () => togglePanel("left", "pages"), "", { icon: "pages" }),
    cmd("Sheet index", () => togglePanel("left", "sheets"), "", { icon: "sheets" }),
    "-",
    cmd(() => (S.settings.declutter === false ? "Hide overlapping labels" : "Show all labels"), () => {
      S.settings.declutter = S.settings.declutter === false;
      kvSet("settings", S.settings);
      drawOverlay();
      status(S.settings.declutter ? "Overlapping labels are hidden; the selected label and the larger measurements stay." : "Every label is shown.");
    }, "", { icon: "eye", id: "menu-declutter" }),
    cmd("Hide compare overlay", hideCompare, "", { icon: "compare", disabled: () => !compareShowing() }),
    cmd(() => (S.doc && S.doc.hideAnnots ? "Show the PDF's own markups" : "Hide the PDF's own markups"), () => setAnnotsShown(!!(S.doc && S.doc.hideAnnots)), "", { icon: "layers", id: "menu-pdf-annots" }),
  ]],
  ["Markup", TOOLS.filter((t) => t.group === "markup").map((t) => cmd(t.label, () => setTool(t.id), t.key, { icon: t.icon }))],
  ["Measure", TOOLS.filter((t) => t.group === "measure").map((t) => cmd(t.label, () => setTool(t.id), t.key, { icon: t.icon })).concat(["-", cmd("Calibrate", () => setTool("calibrate"), "Shift+Alt+K", { icon: "calibrate" })])],
  ["Automate", [
    cmd("Area by click (room fill)", () => setTool("roomfill"), "Shift+Alt+F", { icon: "roomfill" }),
    cmd("Find symbol and count", () => setTool("findsymbol"), "Shift+Alt+S", { icon: "findsymbol" }),
    cmd("Add cutout to selected area", () => setTool("cutout"), "Shift+Alt+X", { icon: "cutout" }),
    cmd("Read title blocks (sheet index and scales)", () => { togglePanel("left", "sheets", true); $("sheets-read") && $("sheets-read").click(); }, "", { icon: "sheets" }),
    cmd("Recognize text on scanned sheets (OCR)...", () => openOcrDialog(), "", { icon: "ocr", id: "menu-ocr" }),
    cmd("Compare revisions and carry markups...", openCompareDialog, "Ctrl+Shift+C", { icon: "compare" }),
    "-",
    cmd("Auto-takeoff this sheet...", () => openAutoTakeoff(false), "Shift+Alt+T", { icon: "auto", id: "menu-autotakeoff" }),
    cmd("Auto-takeoff every sheet...", () => openAutoTakeoff(true), "", { icon: "auto", id: "menu-autotakeoff-all" }),
    cmd("Review the plan set...", openPlanReview, "", { icon: "review", id: "menu-review" }),
    cmd("Check against the project manual...", openManualCheck, "", { icon: "library", id: "menu-manual" }),
    cmd("Ask about these plans...", openAsk, "", { icon: "comment", id: "menu-ask" }),
  ]],
  ["Team", [
    cmd("Merge markups from a file...", () => $("file-merge").click(), "", { icon: "merge" }),
    cmd("Shared folder sync...", openSyncDialog, "", { icon: "folder-sync" }),
    "-",
    cmd("Start a live session...", () => openLiveDialog("host"), "", { icon: "live" }),
    cmd("Join a live session...", () => openLiveDialog("join"), "", { icon: "users" }),
    cmd(() => (live.role === "host" ? "End the live session" : "Leave the live session"), () => endLiveSession("You left the live session."), "", { icon: "close", id: "menu-live-leave", disabled: () => !live.on }),
    "-",
    cmd(() => (S.ui.mine ? "Show all markups in the list" : "Markups assigned to me"), () => { S.ui.mine = !S.ui.mine; togglePanel("bottom", "list", true); renderList(); }, "", { icon: "comment", id: "menu-mine" }),
    cmd("Your name and settings...", openSettings, "", { icon: "settings" }),
  ]],
  ["Help", [
    cmd("Help", () => openHelp(), "F1", { icon: "help", id: "menu-help" }),
    cmd("Take the tour", () => startTour(), "", { icon: "tour", id: "menu-tour" }),
    cmd("Coming from Revu", () => openHelp("revu"), "", { icon: "import", id: "menu-revu" }),
    cmd("Keyboard shortcuts", openShortcuts, "?", { icon: "key" }),
    cmd("Method and limits", () => { togglePanel("right", "measure", true); setTimeout(() => { const d = $("method-limits"); if (d) { d.open = true; d.scrollIntoView(); } }, 50); }, "", { icon: "why" }),
    cmd("About", openAbout, "", { icon: "help" }),
  ]],
];

let openMenu = null;
function buildMenus() {
  const nav = clear($("menus"));
  for (const [name] of MENUS()) {
    const wrap = el("div", { cls: "menu" });
    const btn = el("button", { type: "button", id: "menu-" + name.toLowerCase(), "aria-haspopup": "menu", "aria-expanded": "false", text: name });
    btn.addEventListener("click", (e) => { e.stopPropagation(); if (openMenu && openMenu.btn === btn) closeMenu(); else showMenu(btn, name); });
    btn.addEventListener("mouseenter", () => { if (openMenu && openMenu.btn !== btn && openMenu.btn.parentNode && openMenu.btn.parentNode.classList.contains("menu")) showMenu(btn, name); });
    wrap.append(btn);
    nav.append(wrap);
  }
  // Touch: the menus fold behind one button; phone: panels and menus behind More.
  $("btn-menu").addEventListener("click", (e) => {
    e.stopPropagation();
    if (openMenu && openMenu.btn === $("btn-menu")) { closeMenu(); return; }
    showItems($("btn-menu"), MENUS().map(([name]) => cmd(name, () => showMenu($("btn-menu"), name), "", { icon: "chevron-right", keep: true })));
  });
  $("btn-phone-more").addEventListener("click", (e) => {
    e.stopPropagation();
    if (openMenu && openMenu.btn === $("btn-phone-more")) { closeMenu(); return; }
    const panels = [["Pages", "left", "pages", "pages"], ["Sheets", "left", "sheets", "sheets"], ["Search", "left", "search", "search"], ["Properties", "right", "props", "settings"],
      ["Tool chest", "right", "chest", "chest"], ["Layers", "right", "layers", "layers"], ["Measurements", "right", "measure", "measurements"], ["Markups list", "bottom", "list", "markups-list"], ["Estimate", "bottom", "estimate", "estimate"]];
    const items = panels.map(([l, side, tab, ic]) => cmd(l, () => togglePanel(side, tab, true), "", { icon: ic }));
    items.push("-");
    for (const [name] of MENUS()) items.push(cmd(name, () => showMenu($("btn-phone-more"), name), "", { icon: "chevron-right", keep: true }));
    showItems($("btn-phone-more"), items);
  });
  $("btn-touch-undo").addEventListener("click", undo);
  document.addEventListener("click", () => closeMenu());
}
function showMenu(btn, name) {
  showItems(btn, MENUS().find((m) => m[0] === name)[1], name);
}
// A menu list under a button: icon, label and the shortcut in mono.
function showItems(btn, items, title) {
  closeMenu();
  const list = el("div", { cls: "menu-list", role: "menu", "aria-label": title || btn.getAttribute("aria-label") || "Menu" });
  for (const it of items) {
    if (it === "-") { list.append(el("hr")); continue; }
    const label = typeof it.label === "function" ? it.label() : it.label;
    const b = el("button", { type: "button", role: "menuitem", id: it.id || null, disabled: it.disabled && it.disabled() ? true : null }, [it.icon ? icon(it.icon) : el("span", { cls: "ph-i" }), el("span", { cls: "l", text: label }), el("kbd", { text: it.key })]);
    b.addEventListener("click", (e) => { e.stopPropagation(); if (!it.keep) closeMenu(); it.run(); });
    list.append(b);
  }
  list.addEventListener("keydown", (e) => {
    const bs = Array.from(list.querySelectorAll("button:not([disabled])"));
    const i = bs.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
    if (e.key === "Escape") { closeMenu(); btn.focus(); }
  });
  list.style.position = "fixed";
  list.style.visibility = "hidden";
  document.body.append(list);
  const r = btn.getBoundingClientRect(), lr = list.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - lr.width - 8));
  const below = r.bottom + lr.height <= window.innerHeight - 8;
  list.style.left = left + "px";
  list.style.top = (below ? r.bottom + 2 : Math.max(8, r.top - lr.height - 2)) + "px";
  list.style.visibility = "";
  btn.setAttribute("aria-expanded", "true");
  openMenu = { btn, list };
  const first = list.querySelector("button:not([disabled])");
  if (first) first.focus({ preventScroll: true });
}
function closeMenu() {
  if (!openMenu) return;
  openMenu.list.remove();
  openMenu.btn.setAttribute("aria-expanded", "false");
  openMenu = null;
}

// Tool bar: groups in the familiar order, each with a caption (shown from 1600 px). Rarely used
// tools fold behind the group's chevron below 1440 px (h2) and on touch screens (h1 too). Ids,
// order and keys never change.
const TOOL_GROUPS = [["file", "File"], ["nav", "Navigate"], ["markup", "Markup"], ["measure", "Measure"], ["auto", "Automate"], ["doc", "Document"]];
const FOLD = { open: 1, save: 1, undo: 1, redo: 1, zoom: 1, arrow: 1, line: 1, rect: 1, ellipse: 1, polygon: 2, polyline: 2, pen: 2, highlight: 2, stamp: 2,
  perimeter: 1, angle: 2, radius: 2, diameter: 2, cutout: 1, flatten: 2, settings: 2, snapshot: 1 };
const TOOL_SHORT = { roomfill: "Area by click", findsymbol: "Find symbol and count", cutout: "Add cutout" };
function buildToolbar() {
  const tb = clear($("toolbar"));
  const groups = {};
  for (const [gid, cap] of TOOL_GROUPS) {
    const row = el("div", { cls: "row" });
    const g = el("div", { cls: "tgroup tg-" + gid, role: "group", "aria-label": cap }, [row, el("span", { cls: "tcap cap", text: cap })]);
    groups[gid] = { row, g, cap, folds: new Set() };
    tb.append(g);
  }
  const add = (gid, id, label, ic, run, key, fold) => {
    const short = gid === "measure" ? label.split(" ")[0] : label;
    const b = el("button", { type: "button", cls: "tb" + (fold ? " h" + fold : ""), id, "data-label": label, "data-key": key || "", "data-icon": ic, "aria-label": label + (key ? " (" + key + ")" : ""), title: label + (key ? " (" + key + ")" : "") }, [icon(ic), el("span", { cls: "lbl", text: short })]);
    b.addEventListener("click", run);
    groups[gid].row.append(b);
    if (fold) groups[gid].folds.add(fold);
    return b;
  };
  add("file", "tb-open", "Open PDF", "open", () => $("file-pdf").click(), "Ctrl+O", FOLD.open);
  add("file", "tb-save", "Save markup file", "save", saveMarkupFile, "Ctrl+S", FOLD.save);
  add("file", "tb-undo", "Undo", "undo", undo, "Ctrl+Z", FOLD.undo);
  add("file", "tb-redo", "Redo", "redo", redo, "Ctrl+Y", FOLD.redo);
  for (const t of TOOLS) {
    const b = add(t.group, "tool-" + t.id, t.label, t.icon, () => setTool(S.tool === t.id && t.id !== "select" ? "select" : t.id), t.key, FOLD[t.id]);
    b.setAttribute("aria-pressed", "false");
  }
  add("doc", "tb-compare", "Compare revisions", "compare", openCompareDialog, "Ctrl+Shift+C");
  add("doc", "tb-flatten", "Flatten to PDF", "flatten", flattenAndSave, "", FOLD.flatten);
  add("doc", "tb-settings", "Settings", "settings", openSettings, "", FOLD.settings);
  for (const [gid] of TOOL_GROUPS) {
    const G = groups[gid];
    if (!G.folds.size) continue;
    const more = el("button", { type: "button", cls: "tb more" + (G.folds.has(1) || G.folds.has(2) ? " m1" : "") + (G.folds.has(2) ? " m2" : ""), id: "tb-more-" + gid,
      "aria-label": "More " + G.cap.toLowerCase() + " tools", "aria-haspopup": "menu", "aria-expanded": "false", title: "More " + G.cap.toLowerCase() + " tools" }, [icon("chevron-down")]);
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openMenu && openMenu.btn === more) { closeMenu(); return; }
      const hidden = Array.from(G.row.querySelectorAll(".tb:not(.more)")).filter((b) => getComputedStyle(b).display === "none");
      showItems(more, hidden.map((b) => cmd(b.dataset.label, () => b.click(), b.dataset.key, { icon: b.dataset.icon })), G.cap);
    });
    G.row.append(more);
  }
  tb.append(el("span", { cls: "preset-chip", id: "preset-chip", hidden: true }));
  buildTray();
}
function syncToolbar() {
  for (const t of TOOLS) {
    const b = $("tool-" + t.id);
    if (!b) continue;
    const on = S.tool === t.id;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.classList.toggle("armed", on && !!S.preset);
    if (on && S.preset) b.style.setProperty("--pc", presetColor(S.preset)); else b.style.removeProperty("--pc");
    const pip = b.querySelector(".pip");
    const wantPip = on && !["select", "pan", "zoom"].includes(t.id);
    if (wantPip && !pip) b.append(el("span", { cls: "pip", title: "Tool stays on" }));
    if (!wantPip && pip) pip.remove();
  }
  const chip = clear($("preset-chip"));
  chip.hidden = !S.preset;
  if (S.preset) {
    chip.style.setProperty("--pc", presetColor(S.preset));
    const layer = S.preset.layer && layerById(S.preset.layer);
    const off = el("button", { type: "button", cls: "iconbtn", id: "preset-disarm", "aria-label": "Disarm the preset", title: "Disarm the preset" }, [icon("close")]);
    off.addEventListener("click", () => setTool(S.tool));
    chip.append(el("span", { cls: "sw" }), el("span", { cls: "only-desk", text: "Preset:" }), el("b", { text: S.preset.name }), ...(layer ? [el("span", { cls: "only-desk", text: "on " + layer.name })] : []), off);
  }
  for (const b of document.querySelectorAll("#tray .tb[data-tool]")) b.setAttribute("aria-pressed", S.tool === b.dataset.tool ? "true" : "false");
}
on("tool", () => { syncToolbar(); renderChestActive(); });
function renderChestActive() { if (S.ui.right === "chest") renderChest(); }

// Phone: a tray of six tools, the rest behind More.
function buildTray() {
  const tray = clear($("tray"));
  for (const id of ["select", "pan", "length", "area", "count"]) {
    const t = TOOL[id];
    const b = el("button", { type: "button", cls: "tb", id: "tray-" + id, "data-tool": id, "aria-pressed": "false", "aria-label": t.label }, [icon(t.icon), el("span", { cls: "lbl", text: t.label })]);
    b.addEventListener("click", () => setTool(S.tool === id && id !== "select" ? "select" : id));
    tray.append(b);
  }
  const more = el("button", { type: "button", cls: "tb", id: "tray-more", "aria-label": "More tools", "aria-haspopup": "menu", "aria-expanded": "false" }, [icon("more"), el("span", { cls: "lbl", text: "More" })]);
  more.addEventListener("click", (e) => {
    e.stopPropagation();
    if (openMenu && openMenu.btn === more) { closeMenu(); return; }
    const items = [];
    let g = "";
    for (const t of TOOLS) {
      if (["select", "pan", "length", "area", "count"].includes(t.id)) continue;
      if (g && t.group !== g) items.push("-");
      g = t.group;
      items.push(cmd(t.label, () => setTool(t.id), t.key, { icon: t.icon }));
    }
    items.push("-", cmd("Compare revisions", openCompareDialog, "Ctrl+Shift+C", { icon: "compare" }));
    showItems(more, items, "Tools");
  });
  tray.append(more);
}

// Panels and tabs. Desktop: side panels beside the sheet and the bottom panel below it. Touch: the
// side panels open as drawers from icon rails and the bottom panel as a sheet; a tap on the
// drawing closes them.
const TABS = { left: ["pages", "sheets", "search"], right: ["props", "chest", "layers", "measure"], bottom: ["list", "estimate"] };
const RAIL = { pages: "rail-pages", sheets: "rail-sheets", search: "rail-search", props: "rail-props", chest: "rail-chest", layers: "rail-layers", measure: "rail-measure", list: "rail-list", estimate: "rail-list" };
function showTab(side, tab) {
  S.ui[side] = tab;
  for (const t of TABS[side]) {
    const btn = $("tab-" + t), pane = $("pane-" + t);
    btn.setAttribute("aria-selected", t === tab ? "true" : "false");
    pane.hidden = t !== tab;
  }
  renderTab(tab);
  syncRails();
}
function renderTab(tab) {
  if (!S.doc) return;
  ({ pages: markCurrentThumb, sheets: renderSheets, search: () => {}, props: renderProps, chest: renderChest, layers: renderLayers, measure: renderMeasure, list: renderList, estimate: renderEstimate })[tab]();
}
function panelOf(side) { return side === "bottom" ? $("bottom") : $(side + "-panel"); }
function drawerOpen(side) { return side === "bottom" ? $("bottom").classList.contains("sheet-open") : panelOf(side).classList.contains("drawer-open"); }
function setDrawer(side, open) {
  const p = panelOf(side);
  p.classList.toggle(side === "bottom" ? "sheet-open" : "drawer-open", open);
  if (open && side !== "bottom") panelOf(side === "left" ? "right" : "left").classList.remove("drawer-open");
  syncRails();
}
function closeDrawers() { for (const s of ["left", "right", "bottom"]) panelOf(s).classList.remove(s === "bottom" ? "sheet-open" : "drawer-open"); syncRails(); }
function syncRails() {
  for (const side of ["left", "right", "bottom"]) {
    const open = isTouch() && drawerOpen(side);
    for (const t of TABS[side]) { const b = $(RAIL[t]); if (b && (side !== "bottom" || t === "list")) b.setAttribute("aria-expanded", open && (side === "bottom" || S.ui[side] === t) ? "true" : "false"); }
  }
  $("btn-left-panel").setAttribute("aria-pressed", $("left-panel").classList.contains("collapsed") ? "false" : "true");
  $("btn-right-panel").setAttribute("aria-pressed", $("right-panel").classList.contains("collapsed") ? "false" : "true");
}
function togglePanel(side, tab, forceOpen) {
  if (isTouch()) {
    const same = drawerOpen(side) && S.ui[side] === tab;
    if (same && !forceOpen) setDrawer(side, false);
    else { showTab(side, tab); setDrawer(side, true); }
    return;
  }
  const panel = panelOf(side);
  const collapsed = panel.classList.contains("collapsed");
  if (collapsed || forceOpen || S.ui[side] !== tab) {
    panel.classList.remove("collapsed");
    showTab(side, tab);
  } else panel.classList.add("collapsed");
  syncRails();
  setTimeout(() => { if (S.doc) { layoutView(); } }, 0);
}
function initPanels() {
  for (const side of Object.keys(TABS)) for (const t of TABS[side]) $("tab-" + t).addEventListener("click", () => {
    if (side === "bottom" && isTouch()) { togglePanel("bottom", t); return; }
    showTab(side, t);
  });
  for (const t of Object.keys(RAIL)) {
    if (t === "estimate") continue;
    const side = TABS.left.includes(t) ? "left" : TABS.right.includes(t) ? "right" : "bottom";
    $(RAIL[t]).addEventListener("click", () => togglePanel(side, side === "bottom" ? S.ui.bottom : t));
  }
  $("btn-left-panel").addEventListener("click", () => { $("left-panel").classList.toggle("collapsed"); syncRails(); setTimeout(layoutView, 0); });
  $("btn-right-panel").addEventListener("click", () => { $("right-panel").classList.toggle("collapsed"); syncRails(); setTimeout(layoutView, 0); });
  $("btn-bottom-collapse").addEventListener("click", () => {
    if (isTouch()) { setDrawer("bottom", !drawerOpen("bottom")); return; }
    $("bottom").classList.toggle("collapsed");
    setTimeout(layoutView, 0);
  });
  // On touch screens a tap on the drawing closes the drawers and the bottom sheet.
  viewer().addEventListener("pointerdown", () => { if (isTouch()) closeDrawers(); }, true);
  const relayout = () => { closeDrawers(); closeMenu(); emit("layout"); setTimeout(() => { if (S.doc) { layoutView(); emit("view"); } }, 0); };
  // Esc closes an open drawer or bottom sheet before anything else.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isTouch() && !dialogOpen && ["left", "right", "bottom"].some(drawerOpen)) { e.stopImmediatePropagation(); closeDrawers(); }
  }, true);
  touchMQ.addEventListener("change", relayout);
  phoneMQ.addEventListener("change", relayout);
  // Drag the bar above the markups list to resize it.
  const rz = $("bottom-resize");
  let start = null;
  rz.addEventListener("pointerdown", (e) => { start = { y: e.clientY, h: $("bottom").getBoundingClientRect().height }; rz.setPointerCapture(e.pointerId); });
  rz.addEventListener("pointermove", (e) => { if (!start) return; const h = Math.max(80, Math.min(window.innerHeight * 0.7, start.h - (e.clientY - start.y))); $("bottom").style.height = h + "px"; layoutView(); });
  rz.addEventListener("pointerup", () => { start = null; renderListWindow(); });
  rz.addEventListener("keydown", (e) => {
    const h = $("bottom").getBoundingClientRect().height;
    if (e.key === "ArrowUp") { $("bottom").style.height = Math.min(window.innerHeight * 0.7, h + 20) + "px"; layoutView(); }
    if (e.key === "ArrowDown") { $("bottom").style.height = Math.max(80, h - 20) + "px"; layoutView(); }
  });
  syncRails();
}
// The document name in the menu bar: example badge, file name, sheet count.
function renderDocName() {
  const box = clear($("doc-name"));
  if (!S.doc) return;
  if (S.doc.example) box.append(el("span", { cls: "badge-ex", text: "Example data" }));
  box.append(el("b", { text: S.doc.name, title: S.doc.name }), el("span", { cls: "mono count", text: S.doc.numPages + " sheet" + (S.doc.numPages === 1 ? "" : "s") }));
}
on("doc", renderDocName);

// Status bar.
function initStatusBar() {
  $("nav-first").addEventListener("click", () => goToPage(0));
  $("nav-prev").addEventListener("click", () => goToPage(S.view.page - 1));
  $("nav-next").addEventListener("click", () => goToPage(S.view.page + 1));
  $("nav-last").addEventListener("click", () => goToPage(S.doc ? S.doc.numPages - 1 : 0));
  $("nav-page").addEventListener("change", () => { const n = parseInt($("nav-page").value, 10); if (n > 0) goToPage(n - 1); });
  $("nav-page").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.stopPropagation(); const n = parseInt($("nav-page").value, 10); $("nav-page").blur(); if (n > 0 && n - 1 !== S.view.page) goToPage(n - 1); }
  });
  $("nav-page").addEventListener("blur", () => { $("nav-page").value = String(S.view.page + 1); });
  $("zoom-label").addEventListener("click", () => fitPage());
  const toggle = (id, key, label) => $(id).addEventListener("click", () => {
    S.settings[key] = !S.settings[key];
    kvSet("settings", S.settings);
    syncStatusBar();
    syncStatusBarIdle();
    if (key === "snapContent" && S.settings.snapContent && S.doc) loadVectors(S.view.page);
    status(label + (S.settings[key] ? " on." : " off."));
  });
  toggle("sb-snap-content", "snapContent", "Snap to content");
  toggle("sb-snap-markup", "snapMarkup", "Snap to markups");
  toggle("sb-grid", "grid", "Snap to grid");
  toggle("sb-ortho", "ortho", "Ortho");
  $("sb-scale").addEventListener("click", () => togglePanel("right", "measure", true));
}
const SCALE_SOURCE = { standard: "standard scale", calibrated: "calibrated", titleblock: "from title block", copied: "copied", imported: "from the PDF" };
function syncStatusBar() {
  if (!S.doc) return;
  if (document.activeElement !== $("nav-page")) $("nav-page").value = String(S.view.page + 1);
  $("nav-count").textContent = "/ " + S.doc.numPages + (sheetLabel(S.view.page) !== String(S.view.page + 1) ? "  " + sheetLabel(S.view.page) : "");
  $("zoom-label").textContent = Math.round(S.view.zoom * 100) + "%";
  syncStatusBarIdle();
  const sc = pageScale(S.view.page);
  const b = clear($("sb-scale"));
  b.className = "sb scale" + (sc ? "" : " none");
  b.append(icon("scale"), el("span", { text: sc ? sc.label : "No scale: calibrate" }));
  b.title = sc ? "Page scale " + sc.label + ", " + SCALE_SOURCE[sc.source] + ". Open Measurements" : "This page has no scale. Open Measurements to calibrate or pick one";
  const src = clear($("sb-scale-src"));
  src.hidden = !sc;
  if (sc) src.append(icon(sc.source === "titleblock" ? "auto" : sc.source === "calibrated" ? "calibrate" : "scale"), el("span", { text: SCALE_SOURCE[sc.source] }));
}
on("view", () => { syncStatusBar(); markCurrentThumb(); });
on("model", () => { syncStatusBar(); refreshThumbLabels(); if (S.ui.left === "sheets") renderSheets(); });

// Keyboard: the habits estimators bring from the desktop takeoff tools.
function keyName(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let k = e.code && e.code.startsWith("Key") ? e.code.slice(3) : e.code && e.code.startsWith("Digit") ? e.code.slice(5) : e.key;
  if (k === "Equal" || k === "+" || k === "NumpadAdd" || e.code === "Equal" || e.code === "NumpadAdd") k = "=";
  if (k === "Minus" || k === "_" || k === "NumpadSubtract" || e.code === "Minus" || e.code === "NumpadSubtract") k = "-";
  parts.push(k.length === 1 ? k.toUpperCase() : k);
  return parts.join("+");
}
const KEYMAP = new Map();
function buildKeymap() {
  KEYMAP.clear();
  for (const t of TOOLS) {
    if (t.key) KEYMAP.set(t.key.replace("Shift+Alt", "Shift+Alt"), () => setTool(t.id));
    for (const a of t.alt || []) KEYMAP.set(a, () => setTool(t.id));
  }
  const map = {
    "Ctrl+Z": undo, "Ctrl+Y": redo, "Ctrl+Shift+Z": redo, "Ctrl+O": () => $("file-pdf").click(), "Ctrl+S": saveMarkupFile,
    "Ctrl+=": () => zoomAt(1.25, vw() / 2, vh() / 2), "Ctrl+-": () => zoomAt(0.8, vw() / 2, vh() / 2),
    "=": () => zoomAt(1.25, vw() / 2, vh() / 2), "Shift+=": () => zoomAt(1.25, vw() / 2, vh() / 2), "-": () => zoomAt(0.8, vw() / 2, vh() / 2),
    "Ctrl+Shift+=": () => rotateView(90), "Ctrl+Shift+-": () => rotateView(-90),
    "Alt+P": () => togglePanel("right", "props"), "Alt+U": () => togglePanel("right", "measure"), "Alt+T": () => togglePanel("left", "pages"),
    "Ctrl+9": () => fitPage(), "Ctrl+0": fitWidth, "Ctrl+8": actualSize,
    "Alt+L": () => togglePanel("bottom", "list"), "Alt+X": () => togglePanel("right", "chest"), "Alt+Y": () => togglePanel("right", "layers"),
    "Home": () => goToPage(0), "End": () => goToPage(S.doc.numPages - 1), "PageUp": () => goToPage(S.view.page - 1), "PageDown": () => goToPage(S.view.page + 1),
    "Ctrl+ArrowLeft": () => goToPage(S.view.page - 1), "Ctrl+ArrowRight": () => goToPage(S.view.page + 1),
    "Ctrl+F": () => { togglePanel("left", "search", true); $("left-panel").classList.remove("collapsed"); $("search-text").focus(); },
    "Ctrl+C": copySelection, "Ctrl+V": pasteMarkups, "Ctrl+A": selectAllOnPage, "Delete": () => deleteMarkups(Array.from(S.selection)),
    "Ctrl+Shift+F7": () => $("sb-snap-markup").click(), "Ctrl+Shift+F8": () => $("sb-snap-content").click(), "Ctrl+Shift+F9": () => $("sb-grid").click(), "Shift+F9": () => $("sb-grid").click(),
    "Ctrl+Shift+C": openCompareDialog, "Shift+Slash": openShortcuts, "Shift+?": openShortcuts, "?": openShortcuts, "F1": () => openHelp(),
    "Tab": () => cycleMarkup(1), "Shift+Tab": () => cycleMarkup(-1),
    "Shift+Alt+T": () => openAutoTakeoff(false),
  };
  for (const k of Object.keys(map)) KEYMAP.set(k, map[k]);
}
function initKeyboard() {
  buildKeymap();
  window.addEventListener("keydown", (e) => {
    if (dialogOpen || isTyping(e) || openMenu) return;
    if (!S.doc) return;
    // Tab and the arrow keys keep their usual meaning when focus is on a control outside the sheet.
    const onSheet = document.activeElement === document.body || document.activeElement === viewer();
    if (!onSheet && (e.key === "Tab" || e.key.startsWith("Arrow") || e.key === "Enter" || e.key === " ")) return;
    // While drawing: Enter finishes, Esc cancels, Backspace drops the last point, digits type a length.
    if (S.draft && S.draft.points) {
      if (e.key === "Enter") { e.preventDefault(); finishMulti(); return; }
      if (e.key === "Escape") { e.preventDefault(); cancelDraft(); return; }
      if (e.key === "Backspace") { e.preventDefault(); S.draft.points.pop(); if (!S.draft.points.length) cancelDraft(); else drawScreenLayer(); return; }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9.'"]$/.test(e.key)) { if (openTypedLength(e.key)) { e.preventDefault(); return; } }
    }
    if (e.key === "Escape") {
      if (S.candidates) { S.candidates = null; drawScreenLayer(); return; }
      if (S.cutoutPending) { S.cutoutPending = false; status("Cutout cancelled."); return; }
      if (S.tool === "count" && countSession) { endCount(); status("Count finished."); return; }
      if (S.tool !== "select") { setTool("select"); return; }
      if (S.selection.size) { S.selection.clear(); emit("selection"); }
      return;
    }
    if (e.key === "Enter" && S.tool === "count") { endCount(); status("Count finished."); return; }
    if (e.key === "Backspace" && S.selection.size) { e.preventDefault(); deleteMarkups(Array.from(S.selection)); return; }
    if (e.key.startsWith("Arrow") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      const ids = Array.from(S.selection).filter((id) => { const m = markupById(id); return m && !layerLocked(m); });
      if (ids.length) updateMarkups(ids, (c) => { c.points = c.points.map((q) => [q[0] + d[0] * step, q[1] + d[1] * step]); if (c.holes) c.holes = c.holes.map((h) => h.map((q) => [q[0] + d[0] * step, q[1] + d[1] * step])); }, "Nudge");
      else panBy(-d[0] * 40 * step / 1, -d[1] * 40 * step / 1);
      return;
    }
    const k = keyName(e);
    const fn = KEYMAP.get(k);
    if (fn) { e.preventDefault(); fn(); }
  });
}
function copySelection() {
  const list = Array.from(S.selection).map(markupById).filter(Boolean);
  if (!list.length) return;
  S.clipboard = JSON.parse(JSON.stringify(list));
  status("Copied " + list.length + " markup" + (list.length === 1 ? "" : "s") + ".");
}
function pasteMarkups() {
  if (!S.clipboard || !S.clipboard.length) return;
  const off = S.clipboard.every((m) => m.page === S.view.page) ? 12 : 0;
  const list = S.clipboard.map((m) => {
    const c = JSON.parse(JSON.stringify(m));
    c.id = newId("m"); c.page = S.view.page; c.created = nowIso();
    for (const k of ["vers", "rev", "comments", "status_log", "modified", "modified_by", "resolved"]) delete c[k];
    stampNew(c);
    c.points = c.points.map((q) => [q[0] + off, q[1] + off]);
    if (c.holes) c.holes = c.holes.map((h) => h.map((q) => [q[0] + off, q[1] + off]));
    return C.clean_markup(c);
  }).filter(Boolean);
  addMarkups(list, "Paste");
  S.selection = new Set(list.map((m) => m.id));
  emit("selection");
}
function selectAllOnPage() { S.selection = new Set(pageMarkups(S.view.page).filter(layerVisible).map((m) => m.id)); emit("selection"); }
function cycleMarkup(dir) {
  const list = pageMarkups(S.view.page).filter(layerVisible);
  if (!list.length) return;
  const cur = S.selection.size === 1 ? list.findIndex((m) => S.selection.has(m.id)) : -1;
  const next = list[(cur + dir + list.length) % list.length];
  S.selection = new Set([next.id]);
  const b = markupBounds(next);
  if (isPhone()) zoomTo([b[0] - 40, b[1] - 40, b[2] + 40, b[3] + 40]); else centerOn((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  emit("selection");
}
function openShortcuts() { openHelp("keys"); }
function openAbout() {
  const mark = document.querySelector(".brand .mark-svg").cloneNode(true);
  mark.setAttribute("aria-hidden", "true");
  mark.removeAttribute("role");
  const keys = el("button", { type: "button", cls: "btn", id: "about-keys", text: "Keyboard shortcuts" });
  keys.addEventListener("click", () => { closeDialog(); openShortcuts(); });
  const d = openDialog({ title: "About " + NAME, icon: "help", body: el("div", { cls: "stack" }, [
    el("div", { cls: "about" }, [mark, el("div", null, [el("b", { cls: "wm", text: NAME }), el("p", { cls: "help", text: "Free, open-source plan takeoff and markup. MIT license." })])]),
    el("p", { cls: "prose", text: "Built by Will Whitmire. Runs entirely in your browser; nothing you enter is uploaded." }),
    el("p", { cls: "maker", text: "W. Whitmire / Field Tools / No. 16" }),
    el("p", { cls: "help", text: "PDF engine: pdf.js " + ((window.pdfjsLib && window.pdfjsLib.version) || "") + " (Apache 2.0) and pdf-lib 1.17.1 (MIT), embedded and checked against pinned hashes. PDF engine mode: " + pdfjsMode + "; image work: " + work.mode + ". Type: Encode Sans (OFL) and Ubuntu Sans Mono (Ubuntu Font Licence)." }),
    methodNotes(),
  ]), actions: [{ label: "Close", primary: true }] });
  d.foot.prepend(keys);
}

// Files: inputs and drag and drop.
function initFiles() {
  $("file-pdf").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; openFromFile(f); });
  $("file-markups").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; openMarkupFile(f); });
  $("file-chest").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importChest(f); });
  $("file-merge").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) mergeFromFile(f); });
  $("file-prices").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importPriceList(f); });
  $("file-assemblies").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importAssemblies(f); });
  $("file-summary").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importSummary(f); });
  $("file-compare").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (f.size > MAX_PDF_BYTES) { status("That PDF is larger than 500 MB.", "bad"); return; }
    try { await loadCompareSource(await readFileBytes(f), cleanName(f.name, 200)); closeDialog(); await compareNow(); openCompareDialog(); } catch (err) { status(err.message, "bad"); }
  });
  const v = document.body;
  v.addEventListener("dragover", (e) => { e.preventDefault(); });
  v.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (/\.json$/i.test(f.name)) openMarkupFile(f); else openFromFile(f);
  });
  $("search-form").addEventListener("submit", (e) => { e.preventDefault(); runSearch($("search-text").value); });
}
