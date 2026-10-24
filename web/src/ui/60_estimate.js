// ---------------------------------------------------------------- estimate: assemblies and cost rollup
const SOURCE_LABELS = { length: "Length", perimeter: "Perimeter", area: "Area", volume: "Volume", wall_area: "Wall area", count: "Count", each: "Each measurement" };
const SOURCE_UNITS = { length: ["ft", "in", "yd", "m", "mm"], perimeter: ["ft", "in", "yd", "m"], area: ["sf", "sy", "sm", "sq_in"], wall_area: ["sf", "sy", "sm"], volume: ["cy", "cf", "cu_m", "l", "gal"], count: [""], each: [""] };

function renderEstimate() {
  const pane = clear($("pane-estimate"));
  if (!S.doc || !model()) return;
  let est;
  try { est = C.document_estimate(model()); } catch (e) { pane.append(el("p", { cls: "chip bad", text: e.message })); return; }
  const st = model().settings;
  $("tab-estimate-total").textContent = money(est.total_cents);
  const head = el("div", { cls: "listbar" });
  const mk = el("input", { type: "number", cls: "pct", id: "est-markup", min: 0, max: 1000, step: 0.5, value: st.markup_pct || 0 });
  const tx = el("input", { type: "number", cls: "pct", id: "est-tax", min: 0, max: 100, step: 0.05, value: st.tax_pct || 0 });
  const oh = el("input", { type: "number", cls: "pct", id: "est-overhead", min: 0, max: 1000, step: 0.5, value: st.overhead_pct || 0 });
  const setPct = (key, inp, hi) => inp.addEventListener("change", () => {
    const v = Math.max(0, Math.min(hi, Number(inp.value) || 0));
    commit("Set " + ({ markup_pct: "markup", tax_pct: "tax", overhead_pct: "overhead" })[key], (n) => { n.settings = Object.assign({}, n.settings, { [key]: v }); });
  });
  setPct("markup_pct", mk, 1000);
  setPct("tax_pct", tx, 100);
  setPct("overhead_pct", oh, 1000);
  const exp = el("button", { type: "button", cls: "btn small", id: "est-export" }, [icon("export"), "Export CSV"]);
  exp.addEventListener("click", () => saveFile(safeFileName((S.doc.name || "takeoff").replace(/\.pdf$/i, "") + "-estimate") + ".csv", "﻿" + C.estimate_csv(est), "text/csv", "CSV"));
  const xl = el("button", { type: "button", cls: "btn small", id: "est-xlsx" }, [icon("table"), "XLSX"]);
  xl.addEventListener("click", exportXlsx);
  const pdf = el("button", { type: "button", cls: "btn small", id: "est-pdf" }, [icon("report"), "PDF"]);
  pdf.addEventListener("click", exportEstimatePdf);
  const cp = el("button", { type: "button", cls: "btn small", id: "est-copy" }, [icon("copy"), "Copy CSV"]);
  cp.addEventListener("click", () => copyText(C.estimate_csv(est), "estimate as CSV"));
  const edit = el("button", { type: "button", cls: "btn small", id: "est-assemblies", "aria-pressed": S.ui.estEdit ? "true" : "false" }, [icon("assembly"), S.ui.estEdit ? "Done editing" : "Assemblies"]);
  edit.addEventListener("click", () => { S.ui.estEdit = !S.ui.estEdit; renderEstimate(); });
  const add = el("button", { type: "button", cls: "btn small", id: "est-add-assembly" }, [icon("plus"), "Add assembly"]);
  add.addEventListener("click", () => commit("Add assembly", (n) => { n.assemblies = n.assemblies.concat([{ id: newId("a"), name: "New assembly", components: [{ name: "Material", source: "area", source_unit: "sf", factor: 1, per_each: 0, waste_pct: 10, pack: 0, unit: "SF", unit_cost_cents: 0 }] }]); }));
  const lib = el("button", { type: "button", cls: "btn small", id: "est-library" }, [icon("library"), "Library"]);
  lib.addEventListener("click", openLibrary);
  const more = el("button", { type: "button", cls: "btn small", id: "est-more", "aria-haspopup": "menu" }, [icon("more"), "Prices and rates"]);
  more.addEventListener("click", (e) => { e.stopPropagation(); showItems(more, [
    cmd("Import a price list (CSV)...", () => $("file-prices").click(), "", { icon: "price", id: "est-prices" }),
    cmd("Labor rates...", openRates, "", { icon: "users", id: "est-rates" }),
    "-",
    cmd("Save assemblies to a file", exportAssemblies, "", { icon: "export", id: "est-asm-export" }),
    cmd("Add assemblies from a file...", () => $("file-assemblies").click(), "", { icon: "import", id: "est-asm-import" }),
  ], "Prices and rates"); });
  head.append(el("label", { for: "est-overhead", cls: "cap", text: "Overhead %" }), oh, el("label", { for: "est-markup", cls: "cap", text: "Markup %" }), mk, el("label", { for: "est-tax", cls: "cap", text: "Tax %" }), tx, lib, edit, ...(S.ui.estEdit ? [add] : []), more, exp, xl, pdf, cp,
    el("span", { cls: "tot", text: "Example prices, edit before use" }));
  pane.append(head);
  if (!S.ui.estEdit) { estimateView(pane, est); return; }
  const wrap = el("div", { cls: "tablewrap" });
  const t = el("table", { cls: "grid", id: "est-table" });
  t.append(el("thead", null, [el("tr", null, ["Component", "Source", "Unit of source", "Factor", "Per meas.", "Formula", "Waste %", "Pack", "Order unit", "Unit cost", "Labor h/unit", "Labor rate", "Base qty", "Order qty", "Cost", ""].map((h, i) => el("th", { cls: [3, 4, 6, 7, 9, 10, 12, 13, 14].includes(i) ? "num" : "", text: h })))]));
  const body = el("tbody");
  est.lines.forEach((line, ai) => {
    const asm = model().assemblies[ai];
    const tot = line.totals;
    const nameInp = input({ value: asm.name, "aria-label": "Assembly name", style: "min-width:220px;max-width:none;font-weight:600" });
    nameInp.addEventListener("change", () => editAssembly(asm.id, (a) => { a.name = cleanName(nameInp.value, 200) || a.name; }, "Rename assembly"));
    const addC = el("button", { type: "button", cls: "btn small", text: "Add component" });
    addC.addEventListener("click", () => editAssembly(asm.id, (a) => { a.components = a.components.concat([{ name: "Item", source: "count", factor: 1, per_each: 0, waste_pct: 0, pack: 1, unit: "ea", unit_cost_cents: 0 }]); }, "Add component"));
    const delA = el("button", { type: "button", cls: "iconbtn", "aria-label": "Delete assembly " + asm.name }, [icon("trash")]);
    delA.addEventListener("click", () => commit("Delete assembly", (n) => {
      n.assemblies = n.assemblies.filter((a) => a.id !== asm.id);
      n.layers = n.layers.map((l) => { if (l.assembly !== asm.id) return l; const c = Object.assign({}, l); delete c.assembly; return c; });
      n.markups = n.markups.map((m) => { if (m.assembly !== asm.id) return m; const c = Object.assign({}, m); delete c.assembly; delete c.assembly_source; return c; });
    }));
    const linked = tot.measurements + " measurement" + (tot.measurements === 1 ? "" : "s") + (tot.missing_scale ? ", " + tot.missing_scale + " on pages without a scale (not counted)" : "");
    body.append(el("tr", { cls: "group" }, [el("td", { colspan: 2 }, [nameInp]), el("td", { colspan: 8, text: (asm.code ? asm.code + "  " : "") + linked }), el("td", { colspan: 4, cls: "num", text: "" }),
      el("td", { cls: "num", text: money(line.cost_cents) }), el("td", null, [addC, delA])]));
    if (asm.why) body.append(el("tr", { cls: "why-row" }, [el("td", { colspan: 16 }, [el("div", { cls: "why small" }, [el("b", { text: "Why" }), el("span", { text: asm.why })])])]));
    if ((asm.params || []).length) {
      const cells = (asm.params || []).map((pm, pi) => {
        const inp = el("input", { type: "number", cls: "n", step: "any", value: pm.value, id: "est-param-" + ai + "-" + pm.id, "aria-label": pm.name });
        inp.addEventListener("change", () => editAssembly(asm.id, (a) => { a.params = a.params.map((x, k) => (k === pi ? Object.assign({}, x, { value: Number(inp.value) || 0 }) : x)); }, "Edit assembly input"));
        return el("label", { cls: "param", for: "est-param-" + ai + "-" + pm.id }, [el("span", { text: pm.name + (pm.unit ? " (" + pm.unit + ")" : "") }), inp, el("code", { text: pm.id })]);
      });
      body.append(el("tr", { cls: "params-row" }, [el("td", { colspan: 16 }, [el("div", { cls: "params" }, cells)])]));
    }
    line.components.forEach((c, ci) => {
      const comp = asm.components[ci];
      const set = (key, parse) => (ev) => {
        let v = ev.target.value;
        if (parse) v = parse(v);
        editAssembly(asm.id, (a) => { a.components = a.components.map((x, k) => (k === ci ? Object.assign({}, x, { [key]: v }) : x)); }, "Edit component");
      };
      const num = (key, val, step) => { const i = el("input", { type: "number", cls: "n", step: step || "any", value: val, "aria-label": key }); i.addEventListener("change", set(key, (v) => Number(v) || 0)); return i; };
      const nm = input({ value: comp.name, "aria-label": "Component name" });
      nm.addEventListener("change", set("name", (v) => cleanName(v, 200)));
      const src = select(Object.keys(SOURCE_LABELS).map((k) => [k, SOURCE_LABELS[k]]), comp.source, { "aria-label": "Source" });
      src.addEventListener("change", () => editAssembly(asm.id, (a) => { a.components = a.components.map((x, k) => { if (k !== ci) return x; const y = Object.assign({}, x, { source: src.value }); const u = SOURCE_UNITS[src.value][0]; if (u) y.source_unit = u; else delete y.source_unit; return y; }); }, "Edit component"));
      const su = select(SOURCE_UNITS[comp.source].map((u) => [u, u ? C.UNIT_LABELS[u] : "-"]), comp.source_unit || SOURCE_UNITS[comp.source][0], { "aria-label": "Unit of the source quantity" });
      su.addEventListener("change", set("source_unit"));
      const unit = input({ value: comp.unit, "aria-label": "Order unit", style: "width:80px" });
      unit.addEventListener("change", set("unit", (v) => cleanName(v, 24)));
      const cost = el("input", { type: "number", cls: "n", step: "0.01", value: (comp.unit_cost_cents / 100).toFixed(2), "aria-label": "Unit cost in dollars" });
      cost.addEventListener("change", set("unit_cost_cents", (v) => Math.round((Number(v) || 0) * 100)));
      const fx = input({ value: comp.formula || "", "aria-label": "Formula", cls: "formula", placeholder: "SF * 1.1", style: "width:160px" });
      fx.addEventListener("change", () => {
        const v = String(fx.value || "").trim();
        if (v) { try { C.formula_parse(v); const names = C.formula_names(v); const known = new Set(C.FORMULA_VARIABLES.concat((asm.params || []).map((x) => x.id))); const unknown = names.filter((x) => !known.has(x)); if (unknown.length) throw new Error("Unknown name: " + unknown.join(", ")); } catch (err) { status("Formula: " + cleanName(err.message, 160), "warn"); fx.value = comp.formula || ""; return; } }
        editAssembly(asm.id, (a) => { a.components = a.components.map((x, k) => { if (k !== ci) return x; const y = Object.assign({}, x); if (v) y.formula = v; else delete y.formula; return y; }); }, "Edit formula");
      });
      fx.title = "Optional. Uses LF PF SF WSF CF CY EA N and this assembly's inputs; replaces source, factor and per measurement.";
      const hrs = num("labor_hours", comp.labor_hours || 0);
      const rates = model().rates || [];
      const rate = select([["", "None"]].concat(rates.map((r) => [r.id, r.name + " " + money(r.cents_per_hour) + "/h"])), comp.labor_rate || "", { "aria-label": "Labor rate" });
      rate.addEventListener("change", () => editAssembly(asm.id, (a) => { a.components = a.components.map((x, k) => { if (k !== ci) return x; const y = Object.assign({}, x); if (rate.value) y.labor_rate = rate.value; else delete y.labor_rate; return y; }); }, "Set labor rate"));
      const del = el("button", { type: "button", cls: "iconbtn", "aria-label": "Remove component" }, [icon("trash")]);
      del.addEventListener("click", () => editAssembly(asm.id, (a) => { a.components = a.components.filter((x, k) => k !== ci); }, "Remove component"));
      body.append(el("tr", null, [el("td", null, [nm]), el("td", null, [src]), el("td", null, [su]), el("td", { cls: "num" }, [num("factor", comp.factor)]),
        el("td", { cls: "num" }, [num("per_each", comp.per_each)]), el("td", null, [fx]), el("td", { cls: "num" }, [num("waste_pct", comp.waste_pct, 0.5)]), el("td", { cls: "num" }, [num("pack", comp.pack)]),
        el("td", null, [unit]), el("td", { cls: "num" }, [cost]), el("td", { cls: "num" }, [hrs]), el("td", null, [rate]), el("td", { cls: "num", text: fmtNum(c.base, 2) }), el("td", { cls: "num", text: fmtNum(c.order, comp.pack > 0 ? 0 : 2) }),
        el("td", { cls: "num", text: money(c.cost_cents) }), el("td", null, [del])]));
    });
  });
  for (const [label, key] of [["Material", "material_cents"], ["Labor", "labor_cents"], ["Subtotal", "subtotal_cents"], ["Overhead", "overhead_cents"], ["Markup", "markup_cents"], ["Tax", "tax_cents"]]) {
    body.append(el("tr", { cls: "total" }, [el("td", { colspan: 14, text: label }), el("td", { cls: "num", id: "est-" + key, text: money(est[key]) }), el("td")]));
  }
  t.append(body);
  wrap.append(t);
  pane.append(wrap, estimateTotal(est));
}
// The estimate total: this view's key answer.
function estimateTotal(est) {
  return el("div", { cls: "est-total" }, [
    el("div", { cls: "est-side" }, [el("span", { cls: "help", text: "Quantities sum over every linked measurement, then round up to whole purchase units." })]),
    el("div", { cls: "k" }, [el("span", { cls: "cap", text: "Estimate total" }), el("span", { cls: "dim" }, [el("b", { cls: "v", id: "est-total_cents", text: money(est.total_cents) })])]),
  ]);
}
// What each assembly drew on, in words: "52'-6\" LF, 9'-0\" high, 472.50 SF wall".
function assemblySource(asm, tot) {
  const st = model().settings;
  const srcs = new Set(asm.components.map((c) => c.source));
  const bits = [];
  if (srcs.has("length") && tot.length_in) bits.push(C.format_length(tot.length_in, st.length_unit, st.places, st.denominator) + (st.length_unit === "ftin" ? " LF" : ""));
  if (srcs.has("perimeter") && tot.perimeter_in && !srcs.has("length")) bits.push(C.format_length(tot.perimeter_in, st.length_unit, st.places, st.denominator) + " perimeter");
  if (srcs.has("area") && tot.area_sq_in) bits.push(C.format_area(tot.area_sq_in, st.area_unit, st.places));
  if (srcs.has("wall_area") && tot.wall_area_sq_in) bits.push(C.format_area(tot.wall_area_sq_in, st.area_unit, st.places) + " wall");
  if (srcs.has("volume") && tot.volume_cu_in) bits.push(C.format_volume(tot.volume_cu_in, st.volume_unit, st.places));
  if (srcs.has("count") && tot.count) bits.push(tot.count + " EA");
  bits.push(tot.measurements + " measurement" + (tot.measurements === 1 ? "" : "s"));
  if (tot.missing_scale) bits.push(tot.missing_scale + " without a scale, not counted");
  return bits.join(", ");
}
function estimateView(pane, est) {
  const wrap = el("div", { cls: "tablewrap" });
  const t = el("table", { cls: "grid est", id: "est-table" });
  t.append(el("thead", null, [el("tr", null, [["Assembly and component"], ["Need with waste", "num"], ["Order", "num"], ["Unit"], ["Unit cost", "num"], ["Cost", "num"]].map(([h, c]) => el("th", { cls: c || "", text: h })))]));
  const body = el("tbody");
  est.lines.forEach((line, ai) => {
    const asm = model().assemblies[ai];
    body.append(el("tr", { cls: "asm" }, [el("td", { colspan: 5 }, [asm.name, el("span", { cls: "src", text: assemblySource(asm, line.totals) })]), el("td", { cls: "num", text: money(line.cost_cents) })]));
    line.components.forEach((c, ci) => {
      const comp = asm.components[ci];
      body.append(el("tr", null, [el("td", { cls: "comp", text: comp.name }), el("td", { cls: "num muted", text: fmtNum(c.with_waste, 2) }), el("td", { cls: "num qty", text: fmtNum(c.order, comp.pack > 0 ? 0 : 2) }),
        el("td", { text: unitLabel(comp.unit) }), el("td", { cls: "num", text: money(c.unit_cost_cents) }), el("td", { cls: "num", text: money(c.cost_cents) })]));
    });
  });
  const st = model().settings;
  if (est.labor_cents) body.append(el("tr", { cls: "foot first" }, [el("td", { colspan: 5, text: "Material" }), el("td", { cls: "num", id: "est-material_cents", text: money(est.material_cents) })]),
    el("tr", { cls: "foot" }, [el("td", { colspan: 5, text: "Labor" }), el("td", { cls: "num", id: "est-labor_cents", text: money(est.labor_cents) })]));
  body.append(el("tr", { cls: "foot" + (est.labor_cents ? "" : " first") }, [el("td", { colspan: 5, text: "Subtotal" }), el("td", { cls: "num", id: "est-subtotal_cents", text: money(est.subtotal_cents) })]),
    ...(st.overhead_pct ? [el("tr", { cls: "foot" }, [el("td", { colspan: 5, text: "Overhead " + C.format_number(st.overhead_pct, 2).replace(/\.00$/, "") + "%" }), el("td", { cls: "num", id: "est-overhead_cents", text: money(est.overhead_cents) })])] : []),
    el("tr", { cls: "foot" }, [el("td", { colspan: 5, text: "Markup " + C.format_number(st.markup_pct || 0, 2).replace(/\.00$/, "") + "%" + (st.overhead_pct ? " on subtotal and overhead" : "") }), el("td", { cls: "num", id: "est-markup_cents", text: money(est.markup_cents) })]),
    el("tr", { cls: "foot" }, [el("td", { colspan: 5, text: "Tax " + C.format_number(st.tax_pct || 0, 2).replace(/\.00$/, "") + "% on subtotal and markup" }), el("td", { cls: "num", id: "est-tax_cents", text: money(est.tax_cents) })]));
  t.append(body);
  wrap.append(t);
  pane.append(wrap, estimateTotal(est));
}
function editAssembly(id, fn, label) {
  commit(label, (n) => { n.assemblies = n.assemblies.map((a) => { if (a.id !== id) return a; const c = Object.assign({}, a); fn(c); return c; }); });
}
on("model", debounce(() => { if (S.ui.bottom === "estimate") renderEstimate(); }, 80));
