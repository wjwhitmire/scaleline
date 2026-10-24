// ---------------------------------------------------------------- auto-takeoff
// One click per sheet (or for the whole set) finds walls, rooms, doors, windows and repeated symbols
// in the sheet's own line work: deterministic geometry in the core (auto_takeoff), no model and no
// download. The dialog shows what was found and why, with controls and a list; nothing is added
// until Add is clicked, and one undo removes the whole batch. Wall types come from rules the person
// edits (thickness, line weight, hatch, fill, outside wall), each mapped to a tool chest preset.
const AT = { runs: [], on: new Set(), hot: null, classes: { wall: true, room: true, door: true, window: true, symbol: true }, minConf: 0.5 };
const AT_KINDS = [["wall", "Walls", "walls"], ["room", "Rooms", "rooms"], ["door", "Doors", "doors"], ["window", "Windows", "windows"], ["symbol", "Symbols", "symbols"]];

function wallRules() { return Array.isArray(S.settings.wallRules) ? C.auto_clean_rules(S.settings.wallRules) : C.AUTO_RULES.map((r) => Object.assign({}, r)); }
async function sheetLineWork(p) {
  const pg = await getPage(S.doc, p);
  const vp = pg.getViewport({ scale: 1 });
  const ol = await pg.getOperatorList({ intent: "display", annotationMode: 0 });
  return C.extract_paths(ol.fnArray, ol.argsArray, window.pdfjsLib.OPS, vp.transform, 150000);
}
// The input for one sheet: its line work, or on a scanned sheet the strokes found in its picture.
async function autoTakeoffInput(p) {
  const info = await pageInfo(p);
  const lw = await sheetLineWork(p);
  let text = [];
  try { text = await pageText(p); } catch (e) { text = []; }
  let sc = pageScale(p), titleScale = null;
  if (!sc) {
    // no scale set: the title block's note, when it has one, sets the size limits, and Add sets it
    // on the sheet in the same undo step as the markups
    try { const tb = await readTitleBlock(p); if (tb.scale) { titleScale = tb.scale; sc = titleScaleEntry(tb.scale); } } catch (e) { /* no text */ }
  }
  let segs = lw.segs, curves = lw.curves, scan = false;
  if (segs.length < 40) {
    // a scan: the lines and the door swings found in the picture (door radii from the scale)
    const k = rasterScale(info);
    const g = await pageGrayCached(p, k);
    const ipp = sc ? sc.in_per_pt : 48 / 72, D = C.AUTO_DEFAULTS;
    const doors = { r_min: D.door_min_in / ipp * k, r_max: D.door_max_in / ipp * k };
    const r = await compute("lines", { gray: g.gray, w: g.w, h: g.h, opts: { minLen: Math.max(8, Math.round(12 * k)), doors } });
    ({ segs, curves } = C.scan_page_lines(r, k));
    scan = true;
  }
  return { page: { w: info.w, h: info.h, segs, curves, text, in_per_pt: sc ? sc.in_per_pt : null }, scan, lines: lw.segs.length, titleScale };
}
async function runAutoTakeoff(pages, progress, cancelled) {
  const runs = [];
  for (let i = 0; i < pages.length; i++) {
    if (cancelled && cancelled()) break;
    const p = pages[i];
    try {
      const inp = await autoTakeoffInput(p);
      const result = await compute("autotakeoff", { page: inp.page, opts: { rules: wallRules(), bridge_in: inp.scan ? 48 : 0 } });
      runs.push({ page: p, result, scan: inp.scan, titleScale: inp.titleScale });
    } catch (e) { runs.push({ page: p, result: null, error: cleanName(e.message, 120) }); }
    if (progress) progress(i + 1, pages.length);
  }
  return runs;
}
function atItems(run) {
  if (!run.result) return [];
  const r = run.result, out = [];
  for (const [kind, , key] of AT_KINDS) for (const x of r[key]) out.push({ key: run.page + ":" + x.id, page: run.page, kind, x });
  return out;
}
function atQuantity(it) {
  const x = it.x, ipp = pageScale(it.page);
  const st = model().settings;
  if (it.kind === "wall") return x.length_in === null ? C.format_number(x.length_pt, 0) + " pt" : C.format_length(x.length_in, st.length_unit, st.places, st.denominator);
  if (it.kind === "room") return x.area_sq_in === null ? C.format_number(x.area_pt, 0) + " sq pt" : C.format_area(x.area_sq_in, st.area_unit, st.places);
  if (it.kind === "symbol") return x.count + " ea";
  if (it.kind === "door" || it.kind === "window") return x.width_in === null ? C.format_number(x.width_pt, 0) + " pt wide" : C.format_ftin(x.width_in, 4) + " wide";
  return ipp ? "" : "";
}
function atLabel(it) {
  const x = it.x;
  if (it.kind === "wall") return x.type_name + ", " + (x.thickness_in === null ? C.format_number(x.thickness_pt, 1) + " pt" : C.format_number(x.thickness_in, 3) + " in");
  if (it.kind === "room") return x.label;
  if (it.kind === "door") return (x.leaves === 2 ? "Pair of doors" : "Door") + (x.tag ? " " + x.tag : "");
  if (it.kind === "window") return "Window";
  return x.name;
}
const atShown = (it) => AT.classes[it.kind] && it.x.conf >= AT.minConf;
// What the suggestions look like on the sheet: ink, unchecked ones dashed (drawn by drawScreenLayer).
function atOverlay(scr) {
  if (!AT.runs.length || !dialogOpen) return;
  for (const run of AT.runs) {
    if (run.page !== S.view.page) continue;
    for (const it of atItems(run)) {
      if (!atShown(it)) continue;
      const on = AT.on.has(it.key), hot = AT.hot === it.key, x = it.x;
      const cls = "ov-auto" + (on ? "" : " off") + (hot ? " hot" : "");
      const S2 = (p) => pageToScreen(p[0], p[1]);
      if (it.kind === "wall") {
        const a = S2(x.a), b = S2(x.b);
        scr.append(svg("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "ov-auto-under", "stroke-width": 5 }));
        scr.append(svg("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls, "stroke-width": hot ? 3 : 2 }));
      } else if (it.kind === "room") {
        const d = x.pts.map((p, i) => { const s = S2(p); return (i ? "L" : "M") + s[0] + " " + s[1]; }).join(" ") + " Z";
        scr.append(svg("path", { d, class: cls + " area", "stroke-width": hot ? 2.4 : 1.4 }));
      } else {
        for (const p of it.kind === "symbol" ? x.at : [x.at]) {
          const s = S2(p);
          scr.append(svg("rect", { x: s[0] - 6, y: s[1] - 6, width: 12, height: 12, class: "ov-auto-under", "stroke-width": 4, transform: "rotate(45 " + s[0] + " " + s[1] + ")" }));
          scr.append(svg("rect", { x: s[0] - 6, y: s[1] - 6, width: 12, height: 12, class: cls, "stroke-width": hot ? 2.4 : 1.6, transform: "rotate(45 " + s[0] + " " + s[1] + ")" }));
        }
      }
    }
  }
}
async function openAutoTakeoff(all) {
  if (!S.doc) { status("Open a plan set first."); return; }
  const pages = all ? Array.from({ length: S.doc.numPages }, (_, i) => i) : [S.view.page];
  showBusy(all ? "Reading sheet 1 of " + pages.length + "..." : "Reading the sheet's line work...");
  let runs;
  try { runs = await runAutoTakeoff(pages, (n, t) => showBusy("Reading sheet " + Math.min(n + 1, t) + " of " + t + "...")); }
  finally { showBusy(""); }
  AT.runs = runs;
  AT.on = new Set();
  for (const run of runs) for (const it of atItems(run)) if (it.x.conf >= AT.minConf) AT.on.add(it.key);
  showAutoTakeoff(all);
}
function atCounts() {
  const c = { wall: 0, room: 0, door: 0, window: 0, symbol: 0 };
  for (const run of AT.runs) for (const it of atItems(run)) if (atShown(it)) c[it.kind]++;
  return c;
}
function showAutoTakeoff(all) {
  const c = atCounts();
  const title = "Found " + c.wall + " wall" + (c.wall === 1 ? "" : "s") + ", " + c.room + " room" + (c.room === 1 ? "" : "s") + ", " + c.door + " door" + (c.door === 1 ? "" : "s") + ", " +
    c.window + " window" + (c.window === 1 ? "" : "s") + " and " + c.symbol + " symbol group" + (c.symbol === 1 ? "" : "s");
  const list = el("div", { cls: "tablewrap auto-list", id: "at-list" });
  const accept = { el: null };
  const notes = [];
  for (const run of AT.runs) {
    if (run.error) notes.push("Sheet " + sheetLabel(run.page) + ": " + run.error);
    else for (const n of run.result.notes) if (!notes.includes(n)) notes.push(n);
    if (run.scan && !notes.includes(SCAN_NOTE)) notes.push(SCAN_NOTE);
  }
  // sheets with no scale: Add sets the title block's scale in the same undo step, or says there is none
  const scaleLines = [];
  for (const run of AT.runs) {
    if (!run.result || pageScale(run.page)) continue;
    scaleLines.push(run.titleScale
      ? "Sheet " + sheetLabel(run.page) + " has no scale set. Add also sets it to " + titleScaleEntry(run.titleScale).label + ", read from its title block" +
        (titleScaleEntry(run.titleScale).label === run.titleScale.text ? "" : " (\u201c" + cleanName(run.titleScale.text, 60) + "\u201d)") + ", in the same step: one undo removes both."
      : "Sheet " + sheetLabel(run.page) + " has no scale set and its title block has no scale note, so the markups are added without one. Calibrate the sheet to measure them.");
  }
  const first = AT.runs.find((r) => r.result);
  const why = first ? (all ? "Read from the line work of " + AT.runs.length + " sheets" : "Read from " + (first.scan ? "the lines found in the scanned picture" : "the sheet's own line work (" + first.result.stats.segments.toLocaleString() + " lines, " + first.result.stats.curves.toLocaleString() + " curves)")) +
    ". Walls are pairs of parallel lines a wall thickness apart, rooms are the closed spaces between wall centerlines named from the text inside, doors are an arc with a leaf, windows a line between two wall faces with jambs, and symbols are the same small shape three or more times. Each row says why." : "Nothing could be read.";
  const render = () => {
    clear(list);
    const tbl = el("table", { cls: "grid" });
    tbl.append(el("thead", null, [el("tr", null, [el("th", { cls: "sw", text: "" }), el("th", { text: "Found" }), el("th", { text: "Sheet" }), el("th", { cls: "num", text: "Quantity" }), el("th", { cls: "num", text: "Confidence" }), el("th", { text: "Why" })])]));
    const tb = el("tbody");
    let shown = 0, chosen = 0;
    for (const run of AT.runs) for (const it of atItems(run)) {
      if (!atShown(it)) continue;
      shown++;
      if (AT.on.has(it.key)) chosen++;
      const box = el("input", { type: "checkbox", "aria-label": "Add " + atLabel(it), checked: AT.on.has(it.key) });
      box.addEventListener("change", () => { if (box.checked) AT.on.add(it.key); else AT.on.delete(it.key); render(); drawScreenLayer(); });
      const tr = el("tr", { cls: AT.hot === it.key ? "sel" : null, "data-key": it.key }, [el("td", { cls: "sw" }, [box]), el("td", null, [el("span", { cls: "tcell" }, [icon(it.kind === "wall" ? "length" : it.kind === "room" ? "area" : "count"), atLabel(it)])]),
        el("td", { cls: "m", text: sheetLabel(it.page) }), el("td", { cls: "num qty", text: atQuantity(it) }), el("td", { cls: "num", text: Math.round(it.x.conf * 100) + "%" }), el("td", { cls: "whycell", title: it.x.why, text: it.x.why })]);
      tr.addEventListener("click", async (e) => {
        if (e.target === box) return;
        AT.hot = it.key;
        if (it.page !== S.view.page) await goToPage(it.page);
        const pts = it.kind === "wall" ? [it.x.a, it.x.b] : it.kind === "room" ? it.x.pts : it.kind === "symbol" ? it.x.at : [it.x.at];
        const b = C.bbox(pts);
        centerOn((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
        render();
        drawScreenLayer();
      });
      tb.append(tr);
    }
    tbl.append(tb);
    list.append(shown ? tbl : el("p", { cls: "help", text: "Nothing at this confidence. Lower the minimum or turn a kind back on." }));
    if (accept.el) { accept.el.textContent = "Add " + chosen + " to the takeoff"; accept.el.disabled = !chosen; }
    $("at-count") && ($("at-count").textContent = shown + " shown, " + chosen + " chosen");
  };
  const kinds = el("div", { cls: "seg-checks", role: "group", "aria-label": "Kinds" }, AT_KINDS.map(([k, label]) => {
    const b = el("input", { type: "checkbox", id: "at-kind-" + k, checked: AT.classes[k] });
    b.addEventListener("change", () => { AT.classes[k] = b.checked; render(); drawScreenLayer(); });
    return el("label", { cls: "chk", for: "at-kind-" + k }, [b, label + " " + c[k]]);
  }));
  const thr = el("input", { type: "range", id: "at-min", min: 0.3, max: 0.95, step: 0.05, value: AT.minConf, "aria-label": "Minimum confidence" });
  const thrOut = el("output", { cls: "mono", for: "at-min", text: Math.round(AT.minConf * 100) + "%" });
  thr.addEventListener("input", () => { AT.minConf = Number(thr.value); thrOut.textContent = Math.round(AT.minConf * 100) + "%"; render(); drawScreenLayer(); });
  const types = el("details", { cls: "at-types", id: "at-types" }, [el("summary", { text: "Wall types and the presets they become" }), wallTypesEditor(() => { closeDialog(); openAutoTakeoff(all); })]);
  const body = el("div", null, [
    el("div", { cls: "why" }, [el("b", { text: "Why" }), el("span", { text: why })]),
    scaleLines.length ? el("div", { cls: "why", id: "at-scale" }, [el("b", { text: "Scale" }), el("span", null, scaleLines.map((t) => el("span", { cls: "line", text: t })))]) : null,
    notes.length ? el("ul", { cls: "help notes" }, notes.map((n) => el("li", { text: n }))) : null,
    el("div", { cls: "auto-ctl" }, [kinds, el("span", { cls: "range" }, [el("label", { cls: "cap", for: "at-min", text: "Minimum" }), thr, thrOut]), el("span", { cls: "cap", id: "at-count" })]),
    types,
    list,
  ]);
  const d = openDialog({ title, icon: "auto", src: all ? AT.runs.length + " sheets" : "Sheet " + sheetLabel(AT.runs[0] ? AT.runs[0].page : S.view.page), wide: true, cls: "auto", body,
    note: "Nothing is added until you click Add. One undo removes all of them.",
    onCancel: () => { AT.runs = []; drawScreenLayer(); },
    actions: [{ label: "Cancel", onClick: () => { AT.runs = []; drawScreenLayer(); } },
      all ? null : { label: "Every sheet", id: "at-all", onClick: () => { openAutoTakeoff(true); return true; } },
      { label: "Add", primary: true, id: "at-accept", onClick: () => acceptAutoTakeoff() }].filter(Boolean) });
  accept.el = d.box.querySelector("#at-accept");
  render();
  drawScreenLayer();
}
const SCAN_NOTE = "This is a scanned sheet: walls and rooms come from the lines found in its picture, and gaps up to 4 ft in a wall are taken as openings. Doors are read where the picture shows a swing arc with its leaf at a wall opening; for doors drawn another way, box one with Find symbol and count and the rest are found.";
// The wall type rules as a small table the person edits; Save keeps them on this device.
function wallTypesEditor(onSave) {
  const rules = wallRules();
  const presets = S.presets.filter((p) => p.tool === "length" || p.tool === "polylength");
  const tbl = el("table", { cls: "grid" }, [el("thead", null, [el("tr", null, ["Name", "Preset", "From (in)", "Under (in)", "Hatch", "Fill", "Outside"].map((h) => el("th", { text: h })))])]);
  const tb = el("tbody");
  const yn = (v, id) => select([["any", "Any"], ["yes", "Yes"], ["no", "No"]], v, { id });
  rules.forEach((r, i) => {
    tb.append(el("tr", { "data-rule": r.id }, [
      el("td", null, [input({ id: "rule-name-" + i, value: r.name, "aria-label": "Rule name" })]),
      el("td", null, [select([["", "No preset"]].concat(presets.map((p) => [p.id, p.name])), r.preset, { id: "rule-preset-" + i, "aria-label": "Preset" })]),
      el("td", null, [el("input", { type: "number", id: "rule-min-" + i, min: 0, step: 0.25, value: r.min_in, "aria-label": "From thickness" })]),
      el("td", null, [el("input", { type: "number", id: "rule-max-" + i, min: 0, step: 0.25, value: r.max_in >= 1e9 ? "" : r.max_in, placeholder: "any", "aria-label": "Under thickness" })]),
      el("td", null, [yn(r.hatch, "rule-hatch-" + i)]), el("td", null, [yn(r.fill, "rule-fill-" + i)]), el("td", null, [yn(r.outer, "rule-outer-" + i)]),
    ]));
  });
  tbl.append(tb);
  const save = el("button", { type: "button", cls: "btn small", id: "rules-save", text: "Save rules and read again" });
  save.addEventListener("click", () => {
    const out = rules.map((r, i) => ({ id: r.id, name: $("rule-name-" + i).value, preset: $("rule-preset-" + i).value, min_in: Number($("rule-min-" + i).value) || 0,
      max_in: $("rule-max-" + i).value === "" ? 1e9 : Number($("rule-max-" + i).value), hatch: $("rule-hatch-" + i).value, fill: $("rule-fill-" + i).value, outer: $("rule-outer-" + i).value }));
    S.settings.wallRules = C.auto_clean_rules(out);
    kvSet("settings", S.settings);
    onSave();
  });
  const reset = el("button", { type: "button", cls: "btn small ghost", id: "rules-reset", text: "Default rules" });
  reset.addEventListener("click", () => { delete S.settings.wallRules; kvSet("settings", S.settings); onSave(); });
  return el("div", null, [el("p", { cls: "help", text: "The first rule that fits a wall names its type and picks the tool chest preset it becomes. Outside means the wall is on the outline of the rooms." }),
    el("div", { cls: "tablewrap" }, [tbl]), el("div", { cls: "row" }, [save, reset])]);
}
function presetFor(id, tool) {
  const p = S.presets.find((x) => x.id === id);
  return p && (p.tool === tool || (tool === "length" && p.tool === "polylength")) ? p : null;
}
function acceptAutoTakeoff() {
  const list = [];
  const prev = S.preset;
  const scales = [];
  let n = 0;
  for (const run of AT.runs) {
    if (!run.result) continue;
    const ids = atItems(run).filter((it) => atShown(it) && AT.on.has(it.key)).map((it) => it.x.id);
    if (ids.length && run.titleScale && !pageScale(run.page)) scales.push([run.page, run.titleScale]);
    for (const pr of C.auto_proposals(run.result, ids, run.page)) {
      let preset = presetFor(pr.preset, pr.tool);
      if (!preset && pr.subject === "Symbol" && /recept|outlet/i.test(pr.label)) preset = presetFor("p-outlet", "count");
      S.preset = preset;
      const tool = preset && preset.tool === "polylength" && pr.tool === "length" ? "polylength" : pr.tool;
      const m = newMarkup(tool, pr.points, { label: pr.label.slice(0, 200) });
      m.page = pr.page;
      if (!preset) m.subject = pr.subject;
      const cm = C.clean_markup(m);
      if (cm) { list.push(cm); n += pr.tool === "count" ? pr.points.length : 1; }
    }
  }
  S.preset = prev;
  AT.runs = [];
  drawScreenLayer();
  if (!list.length) { status("Nothing was chosen."); return; }
  addMarkups(list, "Add auto-takeoff", scales.length ? (m) => putTitleScales(m, scales) : null);
  const scaled = scales.length ? " Set the scale of " + scales.map(([p, sc]) => "sheet " + sheetLabel(p) + " to " + titleScaleEntry(sc).label).join(", ") + " from the title block." : "";
  toast("Added " + list.length + " markup" + (list.length === 1 ? "" : "s") + " (" + n + " item" + (n === 1 ? "" : "s") + ") from auto-takeoff." + scaled,
    { label: "Undo", run: () => { if (S.hist.past.length && S.hist.past[S.hist.past.length - 1].label === "Add auto-takeoff") undo(); } });
  status("Added " + list.length + " markups from auto-takeoff." + scaled + " Ctrl+Z removes " + (scales.length ? "both" : "them") + ".");
}
