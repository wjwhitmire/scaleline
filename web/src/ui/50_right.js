// ---------------------------------------------------------------- right panel: properties, tool chest, layers, measurements
const TEXT_TYPES = new Set(["text", "callout", "stamp", "cloud"]);
const STATUS_ICON = { Open: "open-status", Review: "review", Accepted: "accepted", Completed: "completed", Rejected: "rejected", Cancelled: "cancelled" };
const GLYPH_LABELS = { circle: "Circle", square: "Square", triangle: "Triangle", diamond: "Diamond" };
const ASSEMBLY_FROM = { preset: "the tool chest preset", layer: "the layer", manual: "a manual choice" };

function presetColor(p) { return p.color || (p.pencil ? pencilColor(p.pencil) : typeColor(p.tool)); }
// A status as a glyph and a word, never color alone.
function statChip(s, kids) {
  const name = s || "";
  return el("span", { cls: "stat " + (name ? name.toLowerCase() : "none") }, [icon(STATUS_ICON[name] || "open-status")].concat(kids || [el("span", { text: name || "No status" })]));
}
// The key answer: the one number a view exists for, drawn in redline as a dimension string.
function splitQty(text) {
  const m = /^(.*\d[^A-Za-z]*?)\s+([A-Za-z][A-Za-z. ]*)$/.exec(text || "");
  return m ? [m[1], m[2]] : [text || "", ""];
}
function keyAnswer(label, text, src, id) {
  const [v, u] = splitQty(text);
  return el("div", { cls: "key" }, [
    el("div", { cls: "k" }, [el("span", { cls: "cap", text: label }), el("span", { cls: "src", text: src || "" })]),
    el("span", { cls: "dim" }, [el("b", { cls: "v", id: id || null, text: v }), u ? el("span", { cls: "u", text: u }) : null]),
  ]);
}
const KEY_LABEL = { length: "Length", polylength: "Length", perimeter: "Perimeter", area: "Area", volume: "Volume", count: "Count", angle: "Angle", radius: "Radius", diameter: "Diameter" };
function keyLabelOf(m) { return m.type === "area" && m.holes && m.holes.length ? "Net area" : KEY_LABEL[m.type] || "Quantity"; }
function keySrcOf(m) {
  const n = (m.holes || []).length;
  return n ? n + " cutout" + (n === 1 ? "" : "s") : "";
}

function propInputs(target, isTool, apply) {
  // target: a markup (or tool defaults object with a type); apply(key, value) commits the change.
  const box = el("div");
  const type = target.type;
  const add = (label, inp, key, parse) => {
    inp.addEventListener("change", () => {
      let v = inp.type === "checkbox" ? inp.checked : inp.value;
      if (parse) { try { v = parse(v); } catch (e) { status(e.message, "warn"); return; } }
      apply(key, v);
    });
    box.append(field(label, inp, "prop-" + key));
  };
  add("Subject", input({ value: target.subject || "" }), "subject", (v) => cleanName(v, 200));
  if (!isTool) add("Label", input({ value: target.label || "" }), "label", (v) => cleanName(v, 200));
  add("Layer", select([["", "(none)"]].concat(model().layers.map((l) => [l.id, l.name])), target.layer || ""), "layer");
  add("Status", select(C.STATUSES.map((s) => [s, s || "(none)"]), target.status || ""), "status");
  // Color: the pencil set as swatches (pressed = ring), plus any other color.
  const cur = String(target.color || (target.pencil ? pencilColor(target.pencil) : typeColor(type))).toLowerCase();
  const pens = el("div", { cls: "pencils", role: "group", "aria-label": "Pencil set" });
  for (const name of Object.keys(PENCIL_NAMES)) {
    const hex = pencilColor(name);
    const b = el("button", { type: "button", cls: "pencil", id: "prop-pencil-" + name, style: "--pc:" + hex, "aria-label": PENCIL_NAMES[name], title: PENCIL_NAMES[name], "aria-pressed": hex === cur ? "true" : "false" });
    b.addEventListener("click", () => apply("color", hex));
    pens.append(b);
  }
  const other = el("input", { type: "color", id: "prop-color", value: /^#[0-9a-f]{6}$/.test(cur) ? cur : pencilColor("m-graphite"), "aria-label": "Other color", title: "Other color" });
  other.addEventListener("change", () => apply("color", other.value));
  pens.append(other);
  box.append(el("div", { cls: "field" }, [el("span", { cls: "lbl", text: "Color" }), pens]));
  if (type === "count") add("Glyph", select(C.GLYPHS.map((g) => [g, GLYPH_LABELS[g]]), target.glyph || "circle"), "glyph");
  if (["area", "volume", "rect", "ellipse", "polygon", "highlight"].includes(type)) {
    const tint = type === "area" || type === "volume";
    const v = target.opacity !== undefined ? target.opacity : (FILLED.has(type) ? fillOf(target) : 1);
    const rng = el("input", { type: "range", min: tint ? 0.15 : 0, max: tint ? 0.45 : 1, step: 0.05, value: v, "aria-label": "Fill opacity" });
    const out = el("output", { text: Math.round(v * 100) + "%" });
    rng.addEventListener("input", () => { out.textContent = Math.round(Number(rng.value) * 100) + "%"; });
    rng.addEventListener("change", () => apply("opacity", Number(rng.value)));
    rng.id = "prop-opacity";
    box.append(el("div", { cls: "field" }, [el("label", { for: "prop-opacity", text: "Fill" }), el("div", { cls: "range" }, [rng, out])]));
  }
  if (!["count", "text", "stamp", "highlight"].includes(type)) add("Line width", el("input", { type: "number", min: 0, max: 20, step: 0.25, value: widthOf(target) }), "width", (v) => Math.max(0, Math.min(20, Number(v) || 0)));
  if (TEXT_TYPES.has(type)) {
    add("Font size", el("input", { type: "number", min: 4, max: 200, step: 1, value: target.font_size || (type === "stamp" ? 20 : 12) }), "font_size", (v) => Math.max(4, Math.min(200, Number(v) || 12)));
    const ta = el("textarea", { rows: 3 });
    ta.value = target.text || "";
    add("Text", ta, "text", (v) => String(v).slice(0, 5000));
  }
  const lu = model().settings.length_unit;
  const fmtLen = (inches) => (inches ? C.format_length(inches, lu, 3) : "");
  if (type === "volume") add("Depth", input({ value: fmtLen(target.depth), placeholder: "4\"" }), "depth", (v) => (v.trim() ? C.parse_length(v, "in") : 0));
  if (["polylength", "perimeter"].includes(type)) add("Height", input({ value: fmtLen(target.height), placeholder: "9'-0\"", title: "Height, for wall area" }), "height", (v) => (v.trim() ? C.parse_length(v, "ft") : 0));
  if (type === "area") add("Pitch", el("input", { type: "number", min: 0, max: 48, step: 0.5, value: target.pitch || 0, title: "Rise in 12" }), "pitch", (v) => Math.max(0, Math.min(48, Number(v) || 0)));
  if (!isTool) add("Author", input({ value: target.author || "" }), "author", (v) => cleanName(v, 100));
  if (!isTool) for (const col of model().columns) {
    const inp = input({ value: (target.custom || {})[col.id] || "" });
    inp.addEventListener("change", () => apply("custom:" + col.id, cleanName(inp.value, 500)));
    box.append(field(col.name, inp, "prop-custom-" + col.id));
  }
  return box;
}
// The assembly a measurement uses, and where it came from.
function assemblyBlock(target, apply) {
  const box = el("div");
  const s = select([["", "(none)"]].concat(model().assemblies.map((a) => [a.id, a.name])), target.assembly || "", { id: "prop-assembly" });
  s.addEventListener("change", () => apply("assembly", s.value));
  box.append(el("h3", { cls: "h" }, [icon("assembly"), "Assembly"]), field("Assembly", s));
  if (target.assembly) {
    const a = model().assemblies.find((x) => x.id === target.assembly);
    const src = target.assembly_source;
    const words = src === "preset" ? "From the tool chest preset" + (S.presets.find((p) => p.id === target.preset) ? " " + S.presets.find((p) => p.id === target.preset).name : "") + ", which wins over the layer."
      : src === "layer" ? "From the layer " + ((layerById(target.layer) || {}).name || "") + "." : "Chosen by hand.";
    box.append(el("div", { cls: "why small" }, [el("b", { text: "Why" }), el("span", { text: words + (a ? " Quantities roll into " + a.name + " in the estimate." : "") + " Ctrl+Z removes the measurement." })]));
  }
  return box;
}
function applyProp(m, key, v) {
  if (key.startsWith("custom:")) {
    const k = key.slice(7);
    m.custom = Object.assign({}, m.custom || {});
    if (v) m.custom[k] = v; else delete m.custom[k];
    if (!Object.keys(m.custom).length) delete m.custom;
    return;
  }
  if (v === "" || v === null || v === 0 && ["depth", "height", "pitch"].includes(key)) delete m[key]; else m[key] = v;
  if (key === "assembly") { if (v) m.assembly_source = "manual"; else delete m.assembly_source; }
  if (key === "layer" && v && !m.assembly && C.MEASURE_TYPES.includes(m.type)) {
    const l = layerById(v);
    if (l && l.assembly) { m.assembly = l.assembly; m.assembly_source = "layer"; }
  }
}
function measureRows(m, d) {
  const r = d.r, st = model().settings;
  const rows = [];
  const len = (x) => C.format_length(x, st.length_unit, st.places, st.denominator);
  if (r.kind === "area" || r.kind === "volume") {
    if (m.holes && m.holes.length) {
      const gross = Object.assign({}, m);
      delete gross.holes;
      try { const g = C.measure(gross, markupScaleOf(m).in_per_pt); rows.push(["Gross area", C.format_area(g.area_sq_in, st.area_unit, st.places)]); rows.push(["Cutouts (" + m.holes.length + ")", C.format_area(g.area_sq_in - r.area_sq_in, st.area_unit, st.places)]); } catch (e) { /* no scale */ }
    }
    if (r.kind === "volume" && r.area_sq_in !== null) rows.push(["Area", C.format_area(r.area_sq_in, st.area_unit, st.places)]);
  }
  if (r.perimeter_in !== null && m.type !== "perimeter") rows.push(["Perimeter", len(r.perimeter_in)]);
  if (r.wall_area_sq_in !== null) rows.push(["Wall area", C.format_area(r.wall_area_sq_in, st.area_unit, st.places)]);
  if (r.radius_in !== null && m.type !== "radius") rows.push(["Radius", len(r.radius_in)]);
  if (m.type === "radius" && r.radius_in !== null) rows.push(["Diameter", len(2 * r.radius_in)]);
  const sc = markupScaleOf(m);
  const vp = m.viewport ? viewportsOf(m.page).find((v) => v.id === m.viewport) : null;
  rows.push(["Sheet, scale", sheetLabel(m.page) + (vp ? ", viewport " + vp.name : "") + (sc ? ", " + sc.label : ", no scale")]);
  return rows;
}
function renderProps() {
  const pane = clear($("pane-props"));
  if (!S.doc || !model()) return;
  const sel = Array.from(S.selection).map(markupById).filter(Boolean);
  if (sel.length) {
    const m = sel[0];
    const ids = sel.map((x) => x.id);
    const apply = (key, v) => updateMarkups(ids, (c) => applyProp(c, key, v), "Edit " + key.replace("custom:", "").replace("_", " "));
    const col = colorOf(m);
    const sub = [m.subject, m.label].filter(Boolean).join(", ");
    pane.append(el("div", { cls: "ph", style: "--pc:" + col }, [
      el("span", { cls: "sw" }, [icon(typeIcon(m.type))]),
      el("span", { cls: "t" }, [el("b", { text: sel.length > 1 ? sel.length + " markups selected" : C.TYPE_LABELS[m.type] }), sub && sel.length === 1 ? el("span", { text: sub }) : null]),
      sel.length === 1 && m.status ? statChip(m.status) : null,
    ]));
    const d = displayOf(m);
    if (d && sel.length === 1) {
      const r = d.r;
      if (r.value === null && r.kind !== "count" && r.kind !== "angle") pane.append(el("p", { cls: "chip warn", id: "prop-no-scale", text: "This page has no scale yet: calibrate or pick a scale." }));
      else pane.append(keyAnswer(keyLabelOf(m), d.text, keySrcOf(m), "prop-key"));
      const rows = measureRows(m, d);
      pane.append(el("dl", { cls: "readouts", id: "prop-measure" }, rows.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { cls: k === "Sheet, scale" ? "mono" : "", text: v })])));
      for (const w of r.warnings) pane.append(el("p", { cls: "chip warn", text: w.replace(/_/g, " ") }));
    }
    if (sel.length === 1 && C.MEASURE_TYPES.includes(m.type)) pane.append(assemblyBlock(m, apply));
    pane.append(el("h3", { cls: "h", text: "Properties" }));
    pane.append(propInputs(m, false, apply));
    const row = el("div", { cls: "row", style: "margin-top:10px" });
    const del = el("button", { type: "button", cls: "btn danger small", id: "prop-delete" }, [icon("trash"), "Delete"]);
    del.addEventListener("click", () => deleteMarkups(ids));
    row.append(del);
    if (sel.length === 1 && (m.type === "area" || m.type === "volume")) {
      const cut = el("button", { type: "button", cls: "btn small", id: "prop-cutout" }, [icon("cutout"), "Add cutout"]);
      cut.addEventListener("click", () => setTool("cutout"));
      row.append(cut);
      if (m.holes && m.holes.length) {
        const rm = el("button", { type: "button", cls: "btn small", text: "Remove cutouts" });
        rm.addEventListener("click", () => updateMarkups([m.id], (c) => { delete c.holes; }, "Remove cutouts"));
        row.append(rm);
      }
    }
    if (sel.length === 1) {
      const save = el("button", { type: "button", cls: "btn small", id: "prop-to-chest" }, [icon("chest"), "Add to tool chest"]);
      save.addEventListener("click", () => presetFromMarkup(m));
      row.append(save);
    }
    pane.append(row);
    if (sel.length === 1) pane.append(commentsBlock(m));
    return;
  }
  const t = TOOL[S.tool];
  const type = { calibrate: "length", roomfill: "area", findsymbol: "count", cutout: "area" }[S.tool] || S.tool;
  pane.append(el("div", { cls: "ph", style: "--pc:" + (S.preset ? presetColor(S.preset) : typeColor(type)) }, [
    el("span", { cls: "sw" }, [icon(t.icon)]),
    el("span", { cls: "t" }, [el("b", { text: t.label }), el("span", { text: S.preset ? "Preset: " + S.preset.name : "Tool" + (t.key ? ", " + t.key : "") })]),
  ]));
  if (["select", "pan", "zoom"].includes(S.tool)) {
    pane.append(el("p", { cls: "help", text: "Select a markup to see its quantity and edit its properties, or pick a tool. New markups use the tool's properties and the active layer." }));
    return;
  }
  if (S.preset) pane.append(el("div", { cls: "why small" }, [el("b", { text: "Why" }), el("span", { text: "Armed with the tool chest preset " + S.preset.name + ". Its layer, style and assembly go on every new markup; the preset wins over the layer's assembly." })]));
  const defaults = Object.assign({ type }, S.preset || {}, S.toolProps[type] || {});
  pane.append(el("h3", { cls: "h", text: "Tool properties" }));
  pane.append(propInputs(defaults, true, (key, v) => {
    S.toolProps[type] = Object.assign({}, S.toolProps[type] || {});
    if (v === "" || v === 0 && ["depth", "height", "pitch"].includes(key)) delete S.toolProps[type][key]; else S.toolProps[type][key] = v;
    status("Tool property set: " + key.replace("_", " ") + ".");
    renderProps();
  }));
}
on("selection", () => renderProps());
on("tool", () => renderProps());
on("model", () => renderProps());

// Tool chest: presets that arm a tool with saved properties.
const CHEST_GROUPS = [["Walls", (p) => ["length", "polylength", "perimeter"].includes(p.tool)], ["Floors and site", (p) => ["area", "volume"].includes(p.tool)],
  ["Counts", (p) => p.tool === "count"], ["Review", (p) => ["cloud", "callout", "stamp", "text"].includes(p.tool)], ["Markup", () => true]];
function presetSummary(p) {
  const bits = [C.TYPE_LABELS[p.tool] || p.tool];
  if (p.glyph) bits.push(p.glyph);
  const l = p.layer && model() && layerById(p.layer);
  if (l) bits.push(l.name);
  const a = p.assembly && model() && model().assemblies.find((x) => x.id === p.assembly);
  if (a) bits.push(a.name.split(",")[0]);
  else if (p.depth) bits.push("depth " + C.format_length(p.depth, "in", 0));
  return bits.join(", ");
}
let chestFilter = "";
function renderChest() {
  const pane = clear($("pane-chest"));
  const find = el("input", { type: "search", cls: "inp", id: "chest-search", placeholder: "Find a preset", "aria-label": "Find a preset", value: chestFilter });
  find.addEventListener("input", debounce(() => { chestFilter = find.value; renderChest(); const f = $("chest-search"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 150));
  const addCur = el("button", { type: "button", cls: "btn small", id: "chest-add" }, [icon("plus"), "Save tool"]);
  addCur.addEventListener("click", () => {
    if (["select", "pan", "zoom", "calibrate", "roomfill", "findsymbol", "cutout"].includes(S.tool)) { status("Pick a drawing or measuring tool first.", "warn"); return; }
    presetFromMarkup(Object.assign({ type: S.tool }, S.preset || {}, S.toolProps[S.tool] || {}));
  });
  pane.append(el("div", { cls: "chest-tools" }, [find, addCur]));
  const f = chestFilter.trim().toLowerCase();
  const left = S.presets.filter((p) => !f || (p.name + " " + presetSummary(p)).toLowerCase().includes(f));
  const used = new Set();
  for (const [name, test] of CHEST_GROUPS) {
    const items = left.filter((p) => !used.has(p.id) && test(p));
    if (!items.length) continue;
    items.forEach((p) => used.add(p.id));
    const g = el("div", { cls: "chest-group" }, [el("h3", { cls: "h", text: name })]);
    for (const p of items) {
      const on = !!(S.preset && S.preset.id === p.id);
      const b = el("button", { type: "button", cls: "chest-item", id: "preset-" + p.id, style: "--pc:" + presetColor(p), "aria-pressed": on ? "true" : "false" }, [
        el("span", { cls: "ic" }, [icon(TOOL[p.tool] ? TOOL[p.tool].icon : "select")]),
        el("span", { cls: "nm" }, [el("b", { text: p.name }), el("span", { text: presetSummary(p) })]),
      ]);
      b.addEventListener("click", () => { if (on) setTool(p.tool); else setTool(p.tool, p); });
      const del = el("button", { type: "button", cls: "iconbtn", "aria-label": "Remove preset " + p.name, title: "Remove" }, [icon("trash")]);
      del.addEventListener("click", () => { S.presets = S.presets.filter((x) => x.id !== p.id); kvSet("presets", S.presets); renderChest(); });
      g.append(el("div", { cls: "chest-row" }, [b, del]));
    }
    pane.append(g);
  }
  if (!used.size) pane.append(el("p", { cls: "help", text: f ? "No preset matches." : "No presets yet. Set up a tool and save it." }));
  const row = el("div", { cls: "row", style: "margin-top:8px" });
  const exp = el("button", { type: "button", cls: "btn small", id: "chest-export" }, [icon("export"), "Export"]);
  exp.addEventListener("click", () => saveFile("tool-chest.json", JSON.stringify({ format: "field-tools-tool-chest", version: 1, presets: S.presets }, null, 1), "application/json"));
  const imp = el("button", { type: "button", cls: "btn small", id: "chest-import", text: "Import" });
  imp.addEventListener("click", () => $("file-chest").click());
  const reset = el("button", { type: "button", cls: "btn small", id: "chest-reset", text: "Restore defaults" });
  reset.addEventListener("click", () => { S.presets = JSON.parse(JSON.stringify(C.DEFAULT_PRESETS)); kvSet("presets", S.presets); renderChest(); });
  row.append(exp, imp, reset);
  pane.append(row, el("p", { cls: "help", text: "Picking a preset arms its tool with the saved subject, layer, style and assembly. Kept on this device for every plan set." }));
}
const PRESET_KEYS = ["subject", "layer", "color", "pencil", "fill", "opacity", "width", "font_size", "depth", "height", "pitch", "assembly", "text", "glyph"];
function presetFromMarkup(m) {
  const name = input({ id: "preset-name", value: m.subject || C.TYPE_LABELS[m.type] });
  openDialog({ title: "Add to tool chest", icon: "chest", body: field("Name", name), enter: () => { $("preset-ok").click(); },
    actions: [{ label: "Cancel" }, { label: "Add", primary: true, id: "preset-ok", onClick: () => {
      const p = { id: newId("p"), name: cleanName(name.value, 80) || C.TYPE_LABELS[m.type], tool: m.type };
      for (const k of PRESET_KEYS) if (m[k] !== undefined && m[k] !== "") p[k] = m[k];
      S.presets = S.presets.concat([p]);
      kvSet("presets", S.presets);
      renderChest();
      status("Preset \"" + p.name + "\" added to the tool chest.");
    } }] });
}
async function importChest(file) {
  if (/\.(btx|xml)$/i.test(file.name)) { importBtx(file); return; }
  if (file.size > 2 * 1024 * 1024) { status("A tool chest file over 2 MB is not accepted.", "warn"); return; }
  try {
    const data = JSON.parse(await readFileText(file));
    if (!data || data.format !== "field-tools-tool-chest" || !Array.isArray(data.presets)) throw new Error("This is not a tool chest file.");
    const ok = [];
    for (const p of data.presets.slice(0, 500)) {
      if (!p || typeof p !== "object" || !TOOL[p.tool] || ["select", "pan", "zoom"].includes(p.tool)) continue;
      const probe = C.clean_markup(Object.assign({ id: "probe", type: p.tool, page: 0, points: [[0, 0], [1, 1], [2, 0]] }, p, { id: "probe" }));
      if (!probe) continue;
      const q = { id: newId("p"), name: cleanName(p.name, 80) || C.TYPE_LABELS[p.tool], tool: p.tool };
      for (const k of PRESET_KEYS) if (probe[k] !== undefined) q[k] = probe[k];
      if (C.PENCILS.includes(p.pencil)) q.pencil = p.pencil;
      ok.push(q);
    }
    S.presets = S.presets.concat(ok);
    kvSet("presets", S.presets);
    renderChest();
    status("Imported " + ok.length + " preset" + (ok.length === 1 ? "" : "s") + ".");
  } catch (e) { status("Could not import: " + cleanName(e.message, 100), "bad"); }
}

// Layers.
function renderLayers() {
  const pane = clear($("pane-layers"));
  if (!model()) return;
  const add = el("button", { type: "button", cls: "btn small", id: "layer-add" }, [icon("plus"), "New layer"]);
  add.addEventListener("click", () => commit("Add layer", (n) => { n.layers = n.layers.concat([{ id: newId("l"), name: "Layer " + (n.layers.length + 1), visible: true, locked: false }]); }));
  pane.append(el("div", { cls: "row", style: "margin-bottom:8px" }, [add, el("span", { cls: "help", style: "margin-left:auto", text: "Active layer gets new markups" })]));
  const box = el("div", { id: "layer-list" });
  const counts = new Map();
  for (const m of model().markups) counts.set(m.layer || "", (counts.get(m.layer || "") || 0) + 1);
  model().layers.forEach((l) => {
    const vis = el("button", { type: "button", cls: "iconbtn" + (l.visible ? "" : " off"), id: "layer-vis-" + l.id, "aria-label": (l.visible ? "Hide " : "Show ") + l.name, "aria-pressed": l.visible ? "true" : "false", title: l.visible ? "Hide" : "Show" }, [icon(l.visible ? "eye" : "eye-off")]);
    vis.addEventListener("click", () => editLayer(l.id, { visible: !l.visible }, l.visible ? "Hide layer" : "Show layer"));
    const lock = el("button", { type: "button", cls: "iconbtn" + (l.locked ? "" : " off"), "aria-label": (l.locked ? "Unlock " : "Lock ") + l.name, "aria-pressed": l.locked ? "true" : "false", title: l.locked ? "Unlock" : "Lock" }, [icon(l.locked ? "lock" : "unlock")]);
    lock.addEventListener("click", () => editLayer(l.id, { locked: !l.locked }, l.locked ? "Unlock layer" : "Lock layer"));
    const nm = input({ value: l.name, cls: "nm", "aria-label": "Layer name" });
    nm.addEventListener("change", () => editLayer(l.id, { name: cleanName(nm.value, 100) || l.name }, "Rename layer"));
    const more = el("button", { type: "button", cls: "iconbtn", id: "layer-more-" + l.id, "aria-label": "More for " + l.name, "aria-haspopup": "menu", "aria-expanded": "false", title: "More" }, [icon("more")]);
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openMenu && openMenu.btn === more) { closeMenu(); return; }
      const items = [cmd("Make active layer", () => setActiveLayer(l), "", { icon: "check", disabled: () => S.settings.activeLayer === l.id }), "-",
        cmd("No default assembly", () => editLayer(l.id, { assembly: undefined }, "Set layer assembly"), "", { icon: l.assembly ? null : "check" })];
      for (const a of model().assemblies) items.push(cmd(a.name, () => editLayer(l.id, { assembly: a.id }, "Set layer assembly"), "", { icon: l.assembly === a.id ? "check" : "assembly" }));
      items.push("-", cmd("Delete layer", () => commit("Delete layer", (n) => { n.layers = n.layers.filter((x) => x.id !== l.id); n.markups = n.markups.map((m) => { if (m.layer !== l.id) return m; const c = Object.assign({}, m); delete c.layer; return c; }); }), "", { icon: "trash" }));
      showItems(more, items, l.name);
    });
    const a = l.assembly && model().assemblies.find((x) => x.id === l.assembly);
    const row = el("div", { cls: "layer" + (S.settings.activeLayer === l.id ? " active" : ""), "data-layer": l.id }, [vis, lock, nm, el("span", { cls: "ct", title: "Markups", text: String(counts.get(l.id) || 0) }), more,
      a ? el("span", { cls: "asm", text: "Default assembly: " + a.name }) : null]);
    row.addEventListener("click", (e) => { if (e.target === row || e.target.classList.contains("asm") || e.target.classList.contains("ct")) setActiveLayer(l); });
    box.append(row);
  });
  pane.append(box, el("p", { cls: "help", text: "Click a layer's row to make it active. A layer's default assembly goes on new measurements drawn on it, unless a preset names one." }));
}
function setActiveLayer(l) { S.settings.activeLayer = l.id; kvSet("settings", S.settings); status("Active layer: " + l.name + "."); renderLayers(); }
function editLayer(id, patch, label) {
  commit(label, (n) => { n.layers = n.layers.map((l) => { if (l.id !== id) return l; const c = Object.assign({}, l, patch); if (c.assembly === undefined) delete c.assembly; return c; }); });
}

// Measurements: page scale, calibration and units.
const SCALE_FROM = { standard: ["scale", "Standard scale"], calibrated: ["calibrate", "Calibrated"], titleblock: ["auto", "From the title block"], copied: ["copy", "Copied from another sheet"], imported: ["import", "From markups in the PDF"] };
function renderMeasure() {
  const pane = clear($("pane-measure"));
  if (!S.doc || !model()) return;
  const p = S.view.page;
  const sc = pageScale(p);
  const card = el("div", { cls: "scalecard", id: "measure-scale" }, [el("span", { cls: "cap", text: "This sheet, " + sheetLabel(p) })]);
  if (sc) {
    const [ic, words] = SCALE_FROM[sc.source] || SCALE_FROM.calibrated;
    card.append(el("div", { cls: "big", style: "margin-top:6px" }, [el("span", { cls: "scalebar", "aria-hidden": "true" }, [el("i"), el("i"), el("i"), el("i")]), sc.label]),
      el("div", { cls: "row", style: "margin-top:8px" }, [el("span", { cls: "src-chip" }, [icon(ic), words]), el("span", { cls: "src-chip mono", text: "1:" + C.format_number(C.ratio_of(sc.in_per_pt), 2) })]));
  } else card.append(el("div", { cls: "big none", style: "margin-top:6px", text: "No scale: calibrate or pick one" }));
  pane.append(card);
  const opts = [["", "Choose a standard scale"]];
  for (const g of ["Architectural", "Engineering", "Metric"]) for (const s of C.STANDARD_SCALES.filter((x) => x.group === g)) opts.push([s.label, g + ": " + s.label]);
  const std = select(opts, sc && sc.source === "standard" ? sc.label : "", { id: "measure-standard" });
  const applyTo = select([["this", "This page"], ["all", "All pages"], ["unscaled", "Pages without a scale"]], "this", { id: "measure-apply-to" });
  std.addEventListener("change", () => {
    const s = C.STANDARD_SCALES.find((x) => x.label === std.value);
    if (!s) return;
    const pages = applyTo.value === "this" ? [p] : Array.from({ length: S.doc.numPages }, (_, i) => i).filter((i) => applyTo.value === "all" || !pageScale(i) || i === p);
    setPageScale(pages, { in_per_pt: s.in_per_pt, label: s.label, source: "standard" }, "Set scale " + s.label);
    status("Scale " + s.label + " set on " + pages.length + " page" + (pages.length === 1 ? "" : "s") + ".");
  });
  pane.append(field("Standard", std), field("Apply to", applyTo));
  const cal = el("button", { type: "button", cls: "btn", id: "measure-calibrate" }, [icon("calibrate"), "Calibrate"]);
  cal.addEventListener("click", () => setTool("calibrate"));
  const copyAll = el("button", { type: "button", cls: "btn", id: "measure-copy-all", text: "Apply to all sheets", disabled: !sc });
  copyAll.addEventListener("click", () => { setPageScale(Array.from({ length: S.doc.numPages }, (_, i) => i), Object.assign({}, sc, { source: "copied" }), "Copy scale to all pages"); });
  const clr = el("button", { type: "button", cls: "btn ghost", text: "Clear", disabled: !sc });
  clr.addEventListener("click", () => setPageScale([p], null, "Clear scale"));
  pane.append(el("div", { cls: "row", style: "margin:6px 0 10px" }, [cal, copyAll, clr]));
  const tb = S.titleBlocks[p];
  if (tb && tb.scale) {
    const b = el("button", { type: "button", cls: "btn small", id: "measure-use-titleblock", text: "Use " + tb.scale.text });
    b.addEventListener("click", () => applyTitleScale([p], "Set scale from title block"));
    pane.append(el("div", { cls: "why small" }, [el("b", { text: "Title block" }), el("span", { text: tb.why.join("; ") + "." })]), b);
  }
  pane.append(viewportSection(p));
  pane.append(el("h3", { cls: "h", text: "Units and display" }));
  const st = model().settings;
  const setU = (key, v, parse) => commit("Change units", (n) => { n.settings = Object.assign({}, n.settings, { [key]: parse ? parse(v) : v }); });
  const lu = select([["ftin", "Feet and inches"], ["ft", "Decimal feet"], ["in", "Inches"], ["yd", "Yards"], ["m", "Meters"], ["cm", "Centimeters"], ["mm", "Millimeters"]], st.length_unit, { id: "unit-length" });
  lu.addEventListener("change", () => commit("Change units", (n) => { n.settings = Object.assign({}, n.settings, { length_unit: lu.value, area_unit: C.AREA_FOR[lu.value], volume_unit: C.VOLUME_FOR[lu.value] }); }));
  const au = select(C.AREA_UNITS.map((u) => [u, C.UNIT_LABELS[u]]), st.area_unit, { id: "unit-area" });
  au.addEventListener("change", () => setU("area_unit", au.value));
  const vu = select(C.VOLUME_UNITS.map((u) => [u, C.UNIT_LABELS[u]]), st.volume_unit, { id: "unit-volume" });
  vu.addEventListener("change", () => setU("volume_unit", vu.value));
  const pl = select([0, 1, 2, 3, 4].map((n) => [String(n), String(n)]), String(st.places), { id: "unit-places" });
  pl.addEventListener("change", () => setU("places", pl.value, Number));
  const dn = select([1, 2, 4, 8, 16, 32].map((n) => [String(n), "1/" + n + " in"]), String(st.denominator), { id: "unit-fraction" });
  dn.addEventListener("change", () => setU("denominator", dn.value, Number));
  pane.append(field("Length", lu), field("Area", au), field("Volume", vu), field("Decimals", pl), field("Fractions", dn));
  pane.append(el("h3", { cls: "h", text: "Snap" }));
  const snaps = el("div", { cls: "row" });
  for (const [key, label, btn] of [["snapContent", "Content", "sb-snap-content"], ["snapMarkup", "Markups", "sb-snap-markup"], ["grid", "Grid", "sb-grid"], ["ortho", "Ortho", "sb-ortho"]]) {
    const cb = el("input", { type: "checkbox", id: "measure-snap-" + key, checked: !!S.settings[key] });
    cb.addEventListener("change", () => { if (!!S.settings[key] !== cb.checked) $(btn).click(); });
    snaps.append(el("label", { cls: "chk", for: "measure-snap-" + key }, [cb, label]));
  }
  pane.append(snaps);
  pane.append(methodNotes());
}
// Viewports on this sheet: each a box with its own scale. Markups drawn inside one measure at it.
function viewportSection(p) {
  const box = el("div", { id: "measure-viewports" }, [el("h3", { cls: "h", text: "Viewports" })]);
  const vps = viewportsOf(p);
  if (!vps.length) box.append(el("p", { cls: "help", text: "A sheet with details at other scales: draw a viewport around each, give it its scale, and measurements inside use it." }));
  const ul = el("ul", { cls: "list vp-list" });
  for (const v of vps) {
    const n = model().markups.filter((m) => m.page === p && m.viewport === v.id).length;
    const ed = el("button", { type: "button", cls: "iconbtn", "aria-label": "Edit viewport " + v.name }, [icon("settings")]);
    ed.addEventListener("click", () => openViewportDialog(p, v.id));
    const del = el("button", { type: "button", cls: "iconbtn", "aria-label": "Delete viewport " + v.name }, [icon("trash")]);
    del.addEventListener("click", () => { setViewports(p, (l) => l.filter((x) => x.id !== v.id), "Delete viewport"); status("Viewport " + v.name + " deleted; its markups measure at the page scale again."); });
    ul.append(el("li", null, [icon("viewport"), el("span", { cls: "grow", text: v.name }), el("span", { cls: "mono", text: v.scale.label || "1:" + C.format_number(C.ratio_of(v.scale.in_per_pt), 1) }),
      el("span", { cls: "help", text: n + " markup" + (n === 1 ? "" : "s") }), ed, del]));
  }
  const add = el("button", { type: "button", cls: "btn small", id: "measure-add-viewport" }, [icon("viewport"), "Draw a viewport"]);
  add.addEventListener("click", () => setTool("viewport"));
  box.append(ul, add);
  return box;
}
function openViewportDialog(p, id, rect) {
  const old = id ? viewportsOf(p).find((v) => v.id === id) : null;
  const name = input({ id: "vp-name", value: old ? old.name : "Detail " + (viewportsOf(p).length + 1) });
  const opts = [["", "Choose a scale"]];
  for (const g of ["Architectural", "Engineering", "Metric"]) for (const s of C.STANDARD_SCALES.filter((x) => x.group === g)) opts.push([s.label, g + ": " + s.label]);
  const std = select(opts, old && old.scale.label && C.STANDARD_SCALES.some((s) => s.label === old.scale.label) ? old.scale.label : "", { id: "vp-scale" });
  openDialog({ title: old ? "Viewport" : "New viewport", icon: "viewport", src: "Sheet " + sheetLabel(p), body: el("div", null, [field("Name", name), field("Scale", std),
    el("p", { cls: "help", text: "Measurements that start inside the box use this scale; everything else on the sheet keeps the page scale." })]),
  actions: [{ label: "Cancel" }, { label: old ? "Save" : "Add viewport", primary: true, id: "vp-ok", onClick: () => {
    const s = C.STANDARD_SCALES.find((x) => x.label === std.value);
    if (!s) { status("Pick the scale this view is drawn at.", "warn"); return true; }
    const v = { id: old ? old.id : newId("vp"), name: cleanName(name.value, 100) || "Viewport", rect: old ? old.rect : rect.map((x) => Math.round(x * 1000) / 1000), scale: { in_per_pt: s.in_per_pt, label: s.label, source: "standard" } };
    setViewports(p, (l) => (old ? l.map((x) => (x.id === old.id ? v : x)) : l.concat([v])), old ? "Edit viewport" : "Add viewport");
    if (!old) setTool("select");
    status("Viewport " + v.name + " at " + s.label + ". Measurements inside it use that scale.");
  } }] });
}
function methodNotes() {
  const items = [
    "Scale: real inches per PDF point (1/72 in of paper). Calibrate divides the known length by the distance between the two picked points.",
    "Length is the straight-line distance; polylength adds the segments. Area uses the shoelace formula on the outline minus each cutout. An outline that crosses itself is flagged, because the formula is then not the enclosed area.",
    "Volume is net area times depth. Pitched area is plan area times the square root of 1 + (rise/12) squared. Wall area is length times height.",
    "Assemblies add up every linked measurement first, apply waste, then round up to whole purchase units, so rounding happens once per job, not per wall.",
    "Area by click traces the room on a raster of the sheet (1 to 2.5 pixels per point), then moves each edge to the wall it found by reading the grayscale across it: the inside face (the default, net floor area), the wall centerline or the outside face, chosen on the card. Edges along an opening take the other walls' thickness. Check and edit corners for critical areas.",
    "Symbol search compares the picked symbol with every spot on the sheet by normalized correlation. Drawings with symbols at other sizes or heavy overlaps can miss; you confirm every match.",
    "Printed scales are only right when the sheet is printed at full size. Reduced sets need calibration against a known dimension.",
  ];
  return el("details", { cls: "method", id: "method-limits" }, [el("summary", { text: "Method and limits" }), el("ul", null, items.map((t) => el("li", { cls: "help", text: t })))]);
}
on("model", () => { if (S.ui.right === "layers") renderLayers(); if (S.ui.right === "measure") renderMeasure(); });
on("view", () => { if (S.ui.right === "measure" && $("pane-measure").dataset.page !== String(S.view.page)) { $("pane-measure").dataset.page = String(S.view.page); renderMeasure(); } });

// Phone: the selected measurement's key answer in a bottom sheet, or the latest status line.
function renderSheetbar() {
  const bar = $("sheetbar");
  if (!bar || !isPhone()) return;
  clear(bar);
  bar.append(el("span", { cls: "grab", "aria-hidden": "true" }));
  // Page navigation and the title block scale suggestion, reachable without the menu.
  if (S.doc) {
    const n = S.doc.numPages, pg = S.view.page;
    const prev = el("button", { type: "button", cls: "iconbtn", id: "sheetbar-prev", "aria-label": "Previous page", disabled: pg <= 0 }, [icon("prev")]);
    prev.addEventListener("click", () => goToPage(pg - 1));
    const next = el("button", { type: "button", cls: "iconbtn", id: "sheetbar-next", "aria-label": "Next page", disabled: pg >= n - 1 }, [icon("next")]);
    next.addEventListener("click", () => goToPage(pg + 1));
    const head = el("div", { cls: "sb-head" }, [prev, el("span", { cls: "mono pgno", text: (sheetLabel(pg) !== String(pg + 1) ? sheetLabel(pg) + "  " : "") + (pg + 1) + " / " + n }), next]);
    const sg = S.suggestion && S.suggestion.p === pg ? S.suggestion : null;
    if (sg) {
      const ap = el("button", { type: "button", cls: "go", id: "sheetbar-apply", text: "Apply" });
      ap.addEventListener("click", () => { applyTitleScale([sg.p], "Set scale from title block"); renderSuggestion(null); });
      const why = el("button", { type: "button", id: "sheetbar-why", "aria-haspopup": "dialog", text: "Why" });
      why.addEventListener("click", (e) => { e.stopPropagation(); if ($("why-pop")) closeWhyPop(); else openWhyPop(why, sg.p, sg.tb); });
      head.append(el("span", { cls: "suggest" }, [icon("auto"), el("span", { cls: "mono", text: sg.tb.scale.text }), ap, why]));
    } else {
      const sc = pageScale(pg);
      head.append(el("span", { cls: "sb scale" + (sc ? "" : " none") }, [icon("scale"), el("span", { text: sc ? sc.label : "No scale" })]));
    }
    bar.append(head);
  }
  const inner = el("div", { cls: "sb-in" });
  const sel = S.doc && model() ? Array.from(S.selection).map(markupById).filter(Boolean) : [];
  const m = sel.length === 1 ? sel[0] : null;
  const d = m ? displayOf(m) : null;
  if (m && d && !(d.r.value === null && d.r.kind !== "count" && d.r.kind !== "angle")) {
    const name = [m.label || m.subject, keyLabelOf(m).toLowerCase()].filter(Boolean).join(", ");
    const det = el("button", { type: "button", cls: "btn", id: "sheetbar-details", "aria-label": "Open properties" }, [icon("chevron-up"), "Details"]);
    det.addEventListener("click", () => togglePanel("right", "props", true));
    const a = m.assembly && model().assemblies.find((x) => x.id === m.assembly);
    inner.append(el("div", null, [keyAnswer(name, d.text, keySrcOf(m), "sheetbar-key")]), det,
      el("span", { cls: "meta", text: [m.subject, a ? a.name.split(",")[0] + " assembly" : ""].filter(Boolean).join(", ") }), m.status ? statChip(m.status) : el("span"));
  } else {
    inner.append(el("span", { cls: "sb-msg", id: "sheetbar-msg", role: "status", text: $("sb-message").textContent || (S.doc ? "Select a measurement to see its quantity here." : "") }));
  }
  bar.append(inner);
}
on("selection", renderSheetbar);
on("model", renderSheetbar);
on("status", renderSheetbar);
on("layout", renderSheetbar);
on("view", renderSheetbar);
