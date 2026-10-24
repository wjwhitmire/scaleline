// ---------------------------------------------------------------- help: the help panel and the guided tour
// The help panel answers the questions people bring: how do I start, what are the keys, where is
// the thing I used in the other program, what do the files hold, what touches the network. The
// tour points at the parts of the screen in the order a takeoff goes.

function shortcutRows() {
  const rows = [];
  for (const t of TOOLS) if (t.key || t.alt) rows.push([t.label, [t.key].concat(t.alt || []).filter(Boolean).join(" or ")]);
  rows.push(["Pan", "Hold Space and drag, middle button drag, or two fingers"], ["Zoom", "Mouse wheel, Ctrl+wheel, pinch, + and - (or Ctrl+= and Ctrl+-)"],
    ["Fit page / width / actual size", "Ctrl+9 / Ctrl+0 / Ctrl+8"], ["Rotate the view clockwise / counterclockwise", "Ctrl+Shift+Plus / Ctrl+Shift+Minus"],
    ["Properties / measurements / thumbnails", "Alt+P / Alt+U / Alt+T"], ["Finish a shape", "Enter or double click"], ["Remove the last point", "Backspace"],
    ["Cancel", "Esc"], ["Lock angle to 45 degrees", "Hold Shift"], ["Skip snapping for one point", "Hold Ctrl"], ["Type a length while drawing", "Type it (12'6\") then Enter"],
    ["Undo / redo", "Ctrl+Z / Ctrl+Y"], ["Next / previous page", "Ctrl+Right / Ctrl+Left, Page Down / Page Up"], ["First / last page", "Home / End"],
    ["Next / previous markup", "Tab / Shift+Tab"], ["Nudge selection", "Arrow keys (Shift for 10 pt)"], ["Markups list / tool chest / layers", "Alt+L / Alt+X / Alt+Y"],
    ["Snap to markups / content / grid", "Ctrl+Shift+F7 / F8 / F9 (grid also Shift+F9)"], ["Find text", "Ctrl+F"], ["Compare revisions", "Ctrl+Shift+C"],
    ["Auto-takeoff this sheet", "Shift+Alt+T"], ["Open a PDF / save the markup file", "Ctrl+O / Ctrl+S"], ["Copy / paste / select all on the sheet", "Ctrl+C / Ctrl+V / Ctrl+A"],
    ["Delete the selection", "Delete or Backspace"], ["Help / this shortcut sheet", "F1 / ?"], ["Number keys 1 to 4", "Area, polylength, length, count (when not drawing)"]);
  return rows;
}
function keyTable(rows, id) {
  return el("table", { cls: "grid keys", id: id || null }, [el("thead", null, [el("tr", null, [el("th", { text: "Action" }), el("th", { text: "Keys" })])]),
    el("tbody", null, rows.map(([a, b]) => el("tr", null, [el("td", { text: a }), el("td", { cls: "m wrap" }, b.split(" or ").flatMap((k, i) => (i ? [" or ", el("kbd", { text: k })] : [el("kbd", { text: k })])))])))]);
}
// What each place in the other program is called here. Written for people who know it well.
const FROM_REVU = [
  ["Markups list", "Markups list (Alt+L), along the bottom. Group, sort, filter, custom columns, status, totals; export as CSV or XLSX."],
  ["Tool Chest", "Tool chest (Alt+X), on the right. Import your .btx tool sets from the tool chest's Import button."],
  ["Measurements panel and Calibrate", "Measurements (Alt+U): the sheet's scale, standard scales, Calibrate (Shift+Alt+K), units and display."],
  ["Viewports", "Viewports (Shift+Alt+W): a box with its own scale; measurements that start inside use it. Viewports saved in a PDF come in with Import markups from this PDF."],
  ["Dynamic Fill", "Area by click (J or Shift+Alt+F): one click inside a room traces it, with columns as cutouts and gap closing it explains; the card sets the boundary at the walls' inside face, centerline or outside face."],
  ["VisualSearch", "Find symbol and count (Shift+Alt+S): box one symbol, every copy is listed with its match score for you to confirm."],
  ["Overlay and Compare Documents", "Compare revisions (Ctrl+Shift+C): overlay in two colors, changed areas boxed and clouded, markups carried to the new set."],
  ["Studio Sessions", "Team: shared folder sync, Merge markups with a review of conflicts, and Live session (peer to peer, no server; the PDF never leaves your device)."],
  ["Snapshot", "Snapshot (G): copies a boxed area, markups included, as a picture."],
  ["Markup summary", "File, Markup summary report (PDF) and Export workbook (XLSX). File, Import a markup summary reads a CSV or XML summary as quantities."],
  ["Flatten", "File, Flatten markups to new PDF. Or keep them editable: Save PDF with markups as annotations."],
  ["Spaces", "Not here. Draw the room as an area and use its subject or a custom column."],
  ["Sets, Studio Projects, batch link", "Not here. Open one plan set at a time; Compare revisions carries work between versions."],
];
function helpSections() {
  const p = (t) => el("p", { cls: "prose", text: t });
  const li = (items) => el("ul", { cls: "prose-list" }, items.map((t) => el("li", { text: t })));
  return [
    ["start", "Start here", "help", () => el("div", null, [
      p("A takeoff goes in four steps, and the screen is laid out in that order: open the plan set, set each sheet's scale, measure and count, then read the totals and the estimate."),
      li(["Open a PDF from File or by dropping it on the window. The example plan set opens on first use.",
        "Set the scale: the status bar shows each sheet's scale. A scale note in the title block is offered there with Apply and Why; or pick a standard scale, or Calibrate on a known dimension.",
        "Measure with the tools on the tool bar or their keys. Snapping finds corners and lines in the drawing; type a length while drawing to place the next point exactly.",
        "The markups list totals what you measured; Estimate turns measurements into orders through assemblies. Nothing you do is uploaded."]),
      el("div", { cls: "row", style: "margin-top:10px" }, [btn("help-tour", "Take the tour", "tour", () => { closeDialog(); startTour(); }), btn("help-example", "Open the example", "pages", () => { closeDialog(); openExample(); })]),
    ])],
    ["keys", "Keyboard shortcuts", "key", () => el("div", null, [p("The keys estimators already know from desktop takeoff programs work here."), el("div", { cls: "tablewrap" }, [keyTable(shortcutRows(), "help-keys")])])],
    ["revu", "Coming from Revu", "import", () => el("div", null, [
      p("If you know Bluebeam Revu, most of this will feel familiar: the same panels in the same places and the same measurement keys. Here is where things are, and what does not exist here."),
      el("div", { cls: "tablewrap" }, [el("table", { cls: "grid", id: "help-revu" }, [el("thead", null, [el("tr", null, [el("th", { text: "In Revu" }), el("th", { text: "Here" })])]),
        el("tbody", null, FROM_REVU.map(([a, b]) => el("tr", null, [el("td", { text: a }), el("td", { cls: "wrap", text: b })])))])]),
      el("h3", { cls: "h", text: "Bringing your work over" }),
      li(["Tool sets (.btx): Tool chest, Import. Each tool's type, subject, colors, width, opacity and text come along; tools of kinds this app has not are skipped and counted.",
        "Markups in a PDF: open the PDF, then File, Import markups from this PDF. Measurements keep the scale written with them, counts join by subject, viewports come along.",
        "A markup summary (CSV or XML): File, Import a markup summary. Each row becomes a quantity in the list that can feed assemblies.",
        "Going back: File, Save PDF with markups as annotations writes standard PDF annotations with their measurement scale, which Revu and other viewers read."]),
    ])],
    ["formats", "Files and formats", "save", () => el("div", null, [
      p("Everything this app saves is plain JSON with a format name and a version, documented field by field in FORMAT.md in the source repository."),
      li(["Markup file (*.markups.json, format field-tools-takeoff-markups): scales, viewports, layers, assemblies, columns, rates and every markup in PDF points, with comments and status history.",
        "Tool chest (format field-tools-tool-chest): presets that arm a tool with its subject, layer, style and assembly.",
        "Assemblies (format field-tools-takeoff-assemblies): assemblies with their inputs, formulas, waste and labor, and labor rates. The built-in library uses the same format.",
        "Exports: CSV, XLSX (no macros, no formulas), PDF reports, a flattened PDF, and a PDF with standard annotations."]),
    ])],
    ["network", "Network and privacy", "lock", () => el("div", null, [
      p("The page makes no network requests unless you turn on a network switch in Settings. All of them are off until you turn them on."),
      li(["OCR: allows one download of the English text recognition data (" + (OCR_DATA.bytes / 1048576).toFixed(1) + " MB) from cdn.jsdelivr.net, checked against its pinned fingerprint and kept on this device. Recognition runs here.",
        NET_SWITCHES["ai-local"].title + ": " + NET_SWITCHES["ai-local"].detail,
        NET_SWITCHES["ai-cloud"].title + ": " + NET_SWITCHES["ai-cloud"].detail + " The key stays on this device and is never in exports.",
        "Auto-takeoff, plan review and the project manual check run on this device with no model and no download.",
        "Live session: peer-to-peer connections to teammates. Markups, cursors and comments go directly between devices, encrypted; the PDF never leaves yours. With no STUN host set, only your local network is used.",
        "Plan files, markups and caches live in this browser's storage. Settings, Delete all data removes all of it."]),
    ])],
    ["method", "Method and limits", "why", () => methodNotes()],
  ];
}
function btn(id, label, ic, run) {
  const b = el("button", { type: "button", cls: "btn", id }, [icon(ic), label]);
  b.addEventListener("click", run);
  return b;
}
function openHelp(section) {
  const secs = helpSections();
  const nav = el("nav", { cls: "help-nav", "aria-label": "Help topics" });
  const body = el("div", { cls: "help-body", id: "help-body", tabindex: "-1" });
  const show = (key) => {
    const s = secs.find((x) => x[0] === key) || secs[0];
    nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", b.dataset.key === s[0] ? "page" : "false"));
    clear(body).append(el("h3", { cls: "help-h", text: s[1] }), s[3]());
    body.scrollTop = 0;
  };
  for (const [key, label, ic] of secs) {
    const b = el("button", { type: "button", id: "help-nav-" + key, "data-key": key }, [icon(ic), el("span", { text: label })]);
    b.addEventListener("click", () => show(key));
    nav.append(b);
  }
  openDialog({ title: "Help", icon: "help", wide: true, cls: "help-panel", body: el("div", { cls: "help-wrap" }, [nav, body]), actions: [{ label: "Close", primary: true }] });
  show(section || "start");
}

// ---- the guided tour: one step at a time, pointing at the part of the screen it is about
const TOUR = [
  { at: "#menus", title: "Menus", text: "Files, editing, views and every tool, with their keys. Help is the last menu." },
  { at: "#left-panel", title: "Pages and sheets", text: "Thumbnails of every sheet, the sheet index read from title blocks, and text search across the set." },
  { at: "#sb-scale", title: "The scale of this sheet", text: "Every measurement depends on it. A scale note found in the title block is offered here with Apply and Why. Click to calibrate or pick one." },
  { at: "#toolbar", title: "Tools", text: "Markups, measurements and the automatic tools. Hover a tool for its key; the keys match desktop takeoff programs." },
  { at: "#viewer", title: "The sheet", text: "Click to measure; snapping finds corners and lines. Space and drag pans, the wheel zooms. Automatic tools show what they found and why, and nothing is added until you accept it." },
  { at: "#right-panel", title: "Properties, tool chest, layers, measurements", text: "Edit the selected markup, arm a tool with a saved preset, organize layers, and set scales, viewports and units." },
  { at: "#bottom, #tab-list", title: "Markups list and estimate", text: "Every markup with its quantity and totals by group. Estimate turns measurements into orders through assemblies, with a library to start from." },
  { at: "#menu-team", title: "Team", text: "Comments and assignments, merging a teammate's markups with a review, a shared folder that keeps in sync, and live sessions." },
];
let tour = null;
function startTour(i) {
  endTour();
  tour = { i: i || 0 };
  drawTour();
}
function endTour() {
  if (!tour) return;
  document.querySelectorAll(".tour-pop, .tour-ring").forEach((n) => n.remove());
  window.removeEventListener("resize", drawTour);
  document.removeEventListener("keydown", tourKey, true);
  tour = null;
  kvSet("tourDone", true);
}
function tourKey(e) {
  if (!tour) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endTour(); status("Tour closed. Help, Take the tour starts it again."); }
  else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); tourGo(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); tourGo(-1); }
}
function tourGo(d) {
  if (!tour) return;
  const n = tour.i + d;
  if (n < 0) return;
  if (n >= TOUR.length) { endTour(); status("That is the tour. Help (F1) has the keys and more."); return; }
  tour.i = n;
  drawTour();
}
function drawTour() {
  if (!tour) return;
  document.querySelectorAll(".tour-pop, .tour-ring").forEach((n) => n.remove());
  const step = TOUR[tour.i];
  const target = step.at.split(",").map((s) => document.querySelector(s.trim())).find((n) => n && n.getClientRects().length && n.getBoundingClientRect().width > 0);
  const r = target ? target.getBoundingClientRect() : { left: window.innerWidth / 2 - 100, top: window.innerHeight / 2 - 40, width: 200, height: 80, right: window.innerWidth / 2 + 100, bottom: window.innerHeight / 2 + 40 };
  const ring = el("div", { cls: "tour-ring", "aria-hidden": "true", style: "left:" + (r.left - 4) + "px;top:" + (r.top - 4) + "px;width:" + (r.width + 8) + "px;height:" + (r.height + 8) + "px" });
  const back = el("button", { type: "button", cls: "btn ghost", id: "tour-back", text: "Back", disabled: tour.i === 0 });
  back.addEventListener("click", () => tourGo(-1));
  const next = el("button", { type: "button", cls: "btn primary", id: "tour-next", text: tour.i === TOUR.length - 1 ? "Done" : "Next" });
  next.addEventListener("click", () => tourGo(1));
  const skip = el("button", { type: "button", cls: "btn ghost", id: "tour-skip", text: "Close" });
  skip.addEventListener("click", () => { endTour(); status("Tour closed. Help, Take the tour starts it again."); });
  const pop = el("div", { cls: "tour-pop", role: "dialog", "aria-modal": "false", "aria-labelledby": "tour-title", id: "tour-pop" }, [
    el("span", { cls: "cap", text: "Step " + (tour.i + 1) + " of " + TOUR.length }), el("h2", { id: "tour-title", text: step.title }), el("p", { text: step.text }),
    el("div", { cls: "row" }, [skip, el("span", { style: "flex:1" }), back, next])]);
  document.body.append(ring, pop);
  // place the card beside the target where it fits on screen, else over it
  const W = window.innerWidth, H = window.innerHeight, m = 16;
  const pw = Math.min(340, W - 2 * m);
  pop.style.width = pw + "px";
  const ph = pop.getBoundingClientRect().height;
  const fits = (x, y) => x >= m && y >= m && x + pw <= W - m && y + ph <= H - m;
  const cands = [[r.right + 12, r.top], [r.left - pw - 12, r.top], [r.left, r.bottom + 12], [r.left, r.top - ph - 12],
    [r.left + r.width / 2 - pw / 2, r.top + r.height / 2 - ph / 2]];
  let [x, y] = cands.find(([a, b]) => fits(a, b)) || cands[cands.length - 1];
  x = Math.max(m, Math.min(W - pw - m, x));
  y = Math.max(m, Math.min(H - ph - m, y));
  pop.style.left = x + "px"; pop.style.top = y + "px";
  window.addEventListener("resize", drawTour);
  document.addEventListener("keydown", tourKey, true);
  next.focus();
}
