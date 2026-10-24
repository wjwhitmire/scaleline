// ---------------------------------------------------------------- assemblies library, price lists, labor rates
// The built-in library holds assemblies by CSI MasterFormat division: generic names, quantities
// and waste only, and a note on why each is figured the way it is. It carries no prices: those come
// from a price list the estimator imports (or types), matched to components by code, then by name.

function openLibrary() {
  if (!model()) return;
  const lib = C.ASSEMBLY_LIBRARY;
  const keyOf = (a) => (a.code || "") + "|" + a.name;
  const have = new Set(model().assemblies.map(keyOf));
  const pick = new Set();
  const q = input({ id: "lib-search", placeholder: "Search: drywall, 09 29, footing...", "aria-label": "Search the library", type: "search" });
  const divs = Array.from(new Set(lib.map((a) => a.division))).sort();
  const divName = (d) => { const a = lib.find((x) => x.division === d); return d + "  " + (DIVISIONS[d] || (a && a.group) || ""); };
  const div = select([["", "All divisions"]].concat(divs.map((d) => [d, divName(d)])), "", { id: "lib-division", "aria-label": "Division" });
  const list = el("ul", { cls: "cands lib-list", id: "lib-list" });
  const count = el("span", { cls: "help", id: "lib-count" });
  let primary = null;
  const draw = () => {
    clear(list);
    const words = String(q.value || "").toLowerCase().split(/\s+/).filter(Boolean);
    const shown = lib.filter((a) => (!div.value || a.division === div.value) && words.every((w) => (a.name + " " + a.code + " " + a.group + " " + a.why + " " + a.components.map((c) => c.name).join(" ")).toLowerCase().includes(w)));
    for (const a of shown) {
      const cb = el("input", { type: "checkbox", id: "lib-" + a.id, checked: pick.has(a.id), "aria-label": "Add " + a.name });
      cb.addEventListener("change", () => { if (cb.checked) pick.add(a.id); else pick.delete(a.id); sync(); });
      const comps = a.components.map((c) => c.name + " (" + c.unit + (c.waste_pct ? ", " + C.format_number(c.waste_pct, 1).replace(/\.0$/, "") + "% waste" : "") + ")").join("; ");
      list.append(el("li", { cls: "cand lib" + (have.has(keyOf(a)) ? " off" : "") }, [cb, el("span", { cls: "w" }, [
        el("span", { cls: "lib-h" }, [el("code", { text: a.code }), el("b", { text: a.name }), icon(a.tool || "assembly"), have.has(keyOf(a)) ? el("span", { cls: "chip", text: "in this takeoff" }) : null]),
        el("span", { cls: "lib-why", text: a.why }), el("span", { cls: "lib-c", text: comps })])]));
    }
    count.textContent = shown.length + " of " + lib.length + " assemblies";
  };
  const sync = () => { if (primary) { primary.textContent = pick.size ? "Add " + pick.size + " assembl" + (pick.size === 1 ? "y" : "ies") : "Add"; primary.disabled = !pick.size; } };
  q.addEventListener("input", debounce(draw, 120));
  div.addEventListener("change", draw);
  draw();
  const d = openDialog({ title: "Assemblies library", icon: "library", src: lib.length + " by CSI division", wide: true, cls: "auto",
    body: el("div", null, [
      el("div", { cls: "why" }, [el("b", { text: "Why" }), el("span", { text: "Each assembly turns a measurement into what you order: its components, the waste each needs and the purchase unit it rounds up to. The note on each says how it is figured. There are no prices here; import your price list or type your own." })]),
      el("div", { cls: "auto-ctl" }, [q, div, count]), list]),
    note: "Nothing is added until you click Add. One undo removes them.",
    actions: [{ label: "Cancel" }, { label: "Add", primary: true, id: "lib-add", onClick: () => {
      const add = lib.filter((a) => pick.has(a.id)).map((a) => C.clean_assembly(Object.assign(JSON.parse(JSON.stringify(a)), { id: newId("a") })));
      if (!add.length) return true;
      commit("Add assemblies from the library", (n) => { n.assemblies = n.assemblies.concat(add); });
      undoToast("Added " + add.length + " assembl" + (add.length === 1 ? "y" : "ies") + " from the library.");
      status("Added " + add.length + " assembl" + (add.length === 1 ? "y" : "ies") + ". Link them to measurements through a layer or a tool chest preset.");
      togglePanel("bottom", "estimate", true);
    } }] });
  primary = d.box.querySelector("#lib-add");
  sync();
}
// MasterFormat division titles (the public division numbering; titles in our own short words).
const DIVISIONS = {
  "02": "Existing conditions", "03": "Concrete", "04": "Masonry", "05": "Metals", "06": "Wood and plastics", "07": "Thermal and moisture",
  "08": "Openings", "09": "Finishes", "10": "Specialties", "11": "Equipment", "12": "Furnishings", "13": "Special construction", "14": "Conveying",
  "21": "Fire suppression", "22": "Plumbing", "23": "HVAC", "26": "Electrical", "27": "Communications", "28": "Safety and security",
  "31": "Earthwork", "32": "Exterior improvements", "33": "Utilities",
};

// ---- labor rates: a small table per takeoff (trade and dollars per hour)
const COMMON_TRADES = ["Laborer", "Carpenter", "Concrete finisher", "Mason", "Ironworker", "Drywall finisher", "Painter", "Roofer", "Plumber", "Electrician", "Sheet metal worker", "Equipment operator"];
function openRates() {
  if (!model()) return;
  let rows = (model().rates || []).map((r) => Object.assign({}, r));
  const tbl = el("tbody", { id: "rates-body" });
  const draw = () => {
    clear(tbl);
    rows.forEach((r, i) => {
      const nm = input({ value: r.name, "aria-label": "Trade", id: "rate-name-" + i });
      nm.addEventListener("change", () => { r.name = cleanName(nm.value, 100) || r.name; });
      const v = el("input", { type: "number", cls: "n", step: "0.01", min: 0, value: (r.cents_per_hour / 100).toFixed(2), "aria-label": "Dollars per hour", id: "rate-value-" + i });
      v.addEventListener("change", () => { r.cents_per_hour = Math.max(0, Math.round((Number(v.value) || 0) * 100)); });
      const del = el("button", { type: "button", cls: "iconbtn", "aria-label": "Remove " + r.name }, [icon("trash")]);
      del.addEventListener("click", () => { rows = rows.filter((x) => x !== r); draw(); });
      const used = model().assemblies.reduce((s, a) => s + a.components.filter((c) => c.labor_rate === r.id).length, 0);
      tbl.append(el("tr", null, [el("td", null, [nm]), el("td", { cls: "num" }, [v]), el("td", { cls: "help", text: used ? used + " component" + (used === 1 ? "" : "s") : "" }), el("td", null, [del])]));
    });
    if (!rows.length) tbl.append(el("tr", null, [el("td", { colspan: 4, cls: "help", text: "No labor rates yet. Add the trades you price, with your loaded hourly cost." })]));
  };
  draw();
  const add = el("button", { type: "button", cls: "btn small", id: "rate-add" }, [icon("plus"), "Add trade"]);
  add.addEventListener("click", () => { rows.push({ id: newId("r"), name: "Trade " + (rows.length + 1), cents_per_hour: 0 }); draw(); });
  const common = el("button", { type: "button", cls: "btn small", id: "rate-common", text: "Add common trades" });
  common.addEventListener("click", () => { for (const t of COMMON_TRADES) if (!rows.some((r) => r.name === t)) rows.push({ id: newId("r"), name: t, cents_per_hour: 0 }); draw(); });
  openDialog({ title: "Labor rates", icon: "users", body: el("div", null, [
    el("p", { cls: "help", text: "A component's labor is its order quantity times its hours per unit times its trade's rate. Rates stay with this takeoff and travel in its markup file." }),
    el("div", { cls: "tablewrap" }, [el("table", { cls: "grid" }, [el("thead", null, [el("tr", null, [el("th", { text: "Trade" }), el("th", { cls: "num", text: "$ per hour" }), el("th", { text: "Used by" }), el("th")])]), tbl])]),
    el("div", { cls: "row", style: "margin-top:8px" }, [add, common])]),
  actions: [{ label: "Cancel" }, { label: "Save rates", primary: true, id: "rates-save", onClick: () => {
    const clean = rows.map(C.clean_rate).filter(Boolean).slice(0, 200);
    const ids = new Set(clean.map((r) => r.id));
    commit("Edit labor rates", (n) => {
      n.rates = clean;
      // components that named a removed trade lose the link (their hours stay)
      n.assemblies = n.assemblies.map((a) => (a.components.some((c) => c.labor_rate && !ids.has(c.labor_rate)) ? Object.assign({}, a, { components: a.components.map((c) => { if (!c.labor_rate || ids.has(c.labor_rate)) return c; const y = Object.assign({}, c); delete y.labor_rate; return y; }) }) : a));
    });
    status("Saved " + clean.length + " labor rate" + (clean.length === 1 ? "" : "s") + ".");
  } }] });
}

// ---- assemblies as a file to share: the documented library format
function exportAssemblies() {
  if (!model()) return;
  const data = JSON.stringify({ format: C.LIBRARY_FORMAT, version: C.LIBRARY_VERSION, app: NAME, exported: nowIso(), rates: model().rates || [], assemblies: model().assemblies }, null, 1);
  saveFile(safeFileName((S.doc ? S.doc.name.replace(/\.pdf$/i, "") : "takeoff") + "-assemblies") + ".json", data, "application/json", "Assemblies");
  status("Saved " + model().assemblies.length + " assemblies to a file. Teammates add them with Add assemblies from a file.");
}
async function importAssemblies(file) {
  if (file.size > 4 * 1024 * 1024) { status("An assemblies file over 4 MB is not accepted.", "warn"); return; }
  let data;
  try { data = JSON.parse(await readFileText(file)); } catch (e) { status("This is not an assemblies file (JSON could not be read).", "bad"); return; }
  if (!data || data.format !== C.LIBRARY_FORMAT || !Array.isArray(data.assemblies)) { status("This is not an assemblies file.", "bad"); return; }
  const names = new Set(model().assemblies.map((a) => a.name.toLowerCase()));
  const add = [], same = [];
  for (const a of data.assemblies.slice(0, 2000)) {
    const c = C.clean_assembly(Object.assign({}, a, { id: newId("a") }));
    if (!c) continue;
    if (names.has(c.name.toLowerCase())) { same.push(c.name); continue; }
    add.push(c);
  }
  const rates = (Array.isArray(data.rates) ? data.rates : []).map(C.clean_rate).filter(Boolean);
  const newRates = rates.filter((r) => !(model().rates || []).some((x) => x.id === r.id));
  if (!add.length) { status("Nothing new: " + (same.length ? same.length + " assemblies with these names are already here." : "the file has no usable assemblies."), "warn"); return; }
  commit("Add assemblies from a file", (n) => { n.assemblies = n.assemblies.concat(add); if (newRates.length) n.rates = (n.rates || []).concat(newRates); });
  undoToast("Added " + add.length + " assembl" + (add.length === 1 ? "y" : "ies") + (same.length ? "; " + same.length + " with names already here were skipped" : "") + ".");
}

// ---- price lists: CSV with code or name, unit, material price and labor
async function importPriceList(file) {
  if (!model()) return;
  if (file.size > 20 * 1024 * 1024) { status("A price list over 20 MB is not accepted.", "warn"); return; }
  let parsed;
  try { parsed = C.parse_csv(await readFileText(file), 100000); } catch (e) { status("The price list could not be read: " + cleanName(e.message, 120), "bad"); return; }
  if (parsed.rows.length < 2) { status("The price list has no rows under its header.", "warn"); return; }
  const header = parsed.rows[0], rows = parsed.rows.slice(1);
  const guess = C.price_columns_guess(header, rows);
  const roles = [["code", "Item code"], ["name", "Name or description"], ["unit", "Unit"], ["material", "Material price"], ["labor_hours", "Labor hours per unit"], ["labor_cost", "Labor price per unit"]];
  const sels = {};
  const opts = [["-1", "Not in this file"]].concat(header.map((h, i) => [String(i), (h || "Column " + (i + 1)) + "  (" + C.col_name(i) + ")"]));
  const grid = el("div", { cls: "map-grid" });
  for (const [k, label] of roles) {
    sels[k] = select(opts, String(guess[k] === undefined ? -1 : guess[k]), { id: "price-col-" + k });
    grid.append(field(label, sels[k]));
  }
  const sample = el("p", { cls: "help mono", text: "First row: " + rows[0].slice(0, 8).join(" | ").slice(0, 200) });
  openDialog({ title: "Price list columns", icon: "price", src: cleanName(file.name, 60) + ", " + rows.length + " rows", body: el("div", null, [
    el("p", { cls: "help", text: "Say which column holds what. Guesses come from the header names. Components are matched by item code first, then by name; you review every change next." }), sample, grid]),
  actions: [{ label: "Cancel" }, { label: "Find matches", primary: true, id: "price-next", onClick: () => {
    const map = {};
    for (const [k] of roles) { const v = Number(sels[k].value); if (v >= 0) map[k] = v; }
    if (map.code === undefined && map.name === undefined) { status("Pick the code or the name column, so items can be matched.", "warn"); return true; }
    if (map.material === undefined && map.labor_hours === undefined && map.labor_cost === undefined) { status("Pick at least one price or labor column.", "warn"); return true; }
    setTimeout(() => priceProposals(rows, map, file.name), 0);
  } }] });
}
function priceProposals(rows, map, fname) {
  const r = C.price_proposals(model().assemblies, rows, map, model().rates || []);
  const use = new Set(r.proposals.map((p, i) => i).filter((i) => !r.proposals[i].unit_mismatch));
  const list = el("ul", { cls: "cands", id: "price-list" });
  r.proposals.forEach((p, i) => {
    const cb = el("input", { type: "checkbox", id: "price-p-" + i, checked: use.has(i), "aria-label": "Apply to " + p.component_name });
    cb.addEventListener("change", () => { if (cb.checked) use.add(i); else use.delete(i); });
    const change = money(p.material_from) + " to " + money(p.material_to) + (p.hours_to !== p.hours_from ? ", labor " + fmtNum(p.hours_from, 3) + " to " + fmtNum(p.hours_to, 3) + " h" : "");
    list.append(el("li", { cls: "cand ocr" + (p.unit_mismatch ? " off" : "") }, [cb, el("span", { cls: "w" }, [el("b", { text: p.assembly_name + ": " + p.component_name }),
      el("span", { text: change + ". Matched by " + p.why + " (row " + (p.row + 2) + ")." }),
      p.unit_mismatch ? el("span", { cls: "warn" }, [icon("review"), "Units differ: the list says " + p.unit_to + ", the component orders " + p.unit_from + ". Left unchecked."]) : null,
      p.labor_needs_rate ? el("span", { cls: "warn" }, [icon("review"), "The list gives a labor price, but this component has no labor rate to turn it into hours; labor was left as it is. Set a labor rate on the component and import again."]) : null])]));
  });
  if (!r.proposals.length) list.append(el("li", { cls: "help", style: "padding:12px", text: "No component matched by code or name. Check the column choices, or give components the item codes your list uses." }));
  openDialog({ title: "Prices to apply", icon: "price", src: r.proposals.length + " matches", wide: true, cls: "auto", body: el("div", null, [
    el("div", { cls: "why" }, [el("b", { text: "Why" }), el("span", { text: "From " + cleanName(fname, 60) + ": " + rows.length + " rows, " + r.proposals.length + " matched to components" + (r.unreadable_rows.length ? ", " + r.unreadable_rows.length + " rows without a readable price" : "") + ". Material prices go to the unit cost; labor stays labor: hours per unit go to labor directly, and a labor price per unit becomes hours at the component's labor rate." })]), list]),
  note: "Nothing changes until you click Apply. One undo restores the old prices.",
  actions: [{ label: "Cancel" }, { label: "Apply", primary: true, id: "price-apply", onClick: () => {
    const chosen = r.proposals.filter((p, i) => use.has(i));
    if (!chosen.length) return true;
    commit("Apply price list", (n) => { n.assemblies = C.apply_price_proposals(n.assemblies, chosen); });
    undoToast("Prices applied to " + chosen.length + " component" + (chosen.length === 1 ? "" : "s") + ".");
  } }] });
}

// ---- tool chests from the other program (.btx): items become presets
// One item's stored annotation: at most 4 MB once inflated, and at most 64 MB for the whole file.
const BTX_ITEM_MAX = 4 * 1024 * 1024, BTX_TOTAL_MAX = 64 * 1024 * 1024;
async function inflateHex(hex, budget) {
  const bytes = C.hex_bytes(hex);
  const out = await inflateCapped(bytes, "deflate", Math.min(BTX_ITEM_MAX, budget ? budget.left : BTX_ITEM_MAX));
  if (budget) budget.left -= out.length;
  let t = "";
  for (let i = 0; i < out.length; i += 8192) t += String.fromCharCode.apply(null, out.subarray(i, i + 8192));
  return t;
}
async function importBtx(file) {
  if (file.size > 20 * 1024 * 1024) { status("A tool chest file over 20 MB is not accepted.", "warn"); return; }
  let f;
  try { f = C.btx_items(await readFileText(file)); } catch (e) { status("This tool chest could not be read: " + cleanName(e.message, 120), "bad"); return; }
  const presets = [];
  let failed = 0;
  const budget = { left: BTX_TOTAL_MAX };
  for (let i = 0; i < f.items.length; i++) {
    const it = f.items[i];
    let raw = it.raw;
    if (budget.left <= 0) { failed += f.items.length - i; break; }
    try { if (it.compressed) raw = await inflateHex(raw, budget); } catch (e) { failed++; continue; }
    const p = C.btx_preset(it, raw, i);
    if (p) { p.id = newId("p"); presets.push(p); } else failed++;
  }
  if (!presets.length) { status("No tools in this file match a markup or measurement type here" + (failed ? " (" + failed + " skipped)" : "") + ".", "warn"); return; }
  const use = new Set(presets.map((p, i) => i));
  const list = el("ul", { cls: "cands", id: "btx-list" });
  presets.forEach((p, i) => {
    const cb = el("input", { type: "checkbox", id: "btx-p-" + i, checked: true, "aria-label": "Import " + p.name });
    cb.addEventListener("change", () => { if (cb.checked) use.add(i); else use.delete(i); });
    list.append(el("li", { cls: "cand ocr" }, [cb, el("span", { cls: "w" }, [el("b", { text: p.name }), el("span", { text: (C.TYPE_LABELS[p.tool] || p.tool) + (p.subject && p.subject !== p.name ? ", subject " + p.subject : "") + (p.color ? ", " + p.color : "") })])]));
  });
  openDialog({ title: "Tools in " + cleanName(f.title || file.name, 60), icon: "chest", src: presets.length + " of " + f.items.length, wide: true, cls: "auto", body: el("div", null, [
    el("div", { cls: "why" }, [el("b", { text: "Why" }), el("span", { text: "Each tool in a Revu tool chest is a stored annotation. Its type, subject, colors, line width, opacity and text are read; " + (failed ? failed + " tools of other kinds are skipped. " : "") + "Measurement scales are not part of a tool and come from your sheets." })]), list]),
  note: "Nothing is added until you click Import.",
  actions: [{ label: "Cancel" }, { label: "Import", primary: true, id: "btx-ok", onClick: () => {
    const take = presets.filter((p, i) => use.has(i));
    S.presets = S.presets.concat(take);
    kvSet("presets", S.presets);
    renderChest();
    status("Imported " + take.length + " tool" + (take.length === 1 ? "" : "s") + " into the tool chest.");
  } }] });
}

// ---- markup summaries from the other program (CSV or XML): rows become imported quantities
async function importSummary(file) {
  if (!S.doc || !model()) { status("Open the plan set first, then import its markup summary.", "warn"); return; }
  if (file.size > 50 * 1024 * 1024) { status("A summary over 50 MB is not accepted.", "warn"); return; }
  let summary;
  try {
    const text = await readFileText(file);
    summary = /^\s*</.test(text) ? C.summary_from_xml(text) : C.summary_from_csv(text);
  } catch (e) { status("The summary could not be read: " + cleanName(e.message, 120), "bad"); return; }
  const labels = new Map();
  for (let p = 0; p < S.doc.numPages; p++) labels.set(sheetLabel(p).toLowerCase(), p);
  const pageOf = (label, index) => {
    if (label && labels.has(String(label).toLowerCase())) return labels.get(String(label).toLowerCase());
    if (index !== null && index !== undefined && index >= 1) return index - 1;
    return null;
  };
  const r = C.summary_markups(summary, pageOf, S.doc.numPages, "rv" + Date.now().toString(36));
  if (!r.markups.length) { status("No row of this summary has a quantity that could be read" + (r.skipped.length ? " (" + r.skipped.length + " rows skipped)" : "") + ".", "warn"); return; }
  const kinds = new Map();
  for (const m of r.markups) kinds.set(m.qty.kind, (kinds.get(m.qty.kind) || 0) + 1);
  const mapped = Object.entries(r.mapped).map(([k, h]) => h + " as " + k.replace(/_/g, " ")).join(", ");
  openDialog({ title: "Markup summary", icon: "import", src: r.markups.length + " rows", wide: true, cls: "auto", body: el("div", null, [
    el("div", { cls: "why" }, [el("b", { text: "Why" }), el("span", { text: "A Revu markup summary lists quantities, not shapes, so each row comes in as an imported quantity on its page: it is listed, totaled and can feed assemblies like any measurement. Columns read: " + (mapped || "none") + "." + (r.columns.length ? " " + r.columns.length + " other columns become custom columns." : "") + (r.skipped.length ? " Rows without a readable quantity are skipped: " + r.skipped.slice(0, 12).join(", ") + (r.skipped.length > 12 ? "..." : "") + "." : "") })]),
    el("ul", { cls: "list", id: "summary-kinds" }, Array.from(kinds).map(([k, n]) => el("li", null, [icon({ length: "length", area: "area", volume: "volume", count: "count" }[k] || "measurements"), el("span", { text: n + " " + k + (n === 1 ? "" : "s") })])))]),
  note: "Nothing is added until you click Import. One undo removes it.",
  actions: [{ label: "Cancel" }, { label: "Import", primary: true, id: "summary-ok", onClick: () => {
    const take = r.markups.map((m) => stampNew(Object.assign({}, m)));
    commit("Import a markup summary", (n) => {
      n.markups = n.markups.concat(take);
      const have = new Set(n.columns.map((c) => c.id));
      n.columns = n.columns.concat(r.columns.filter((c) => !have.has(c.id)));
    });
    undoToast("Imported " + take.length + " quantities from the summary.");
    togglePanel("bottom", "list", true);
  } }] });
}
