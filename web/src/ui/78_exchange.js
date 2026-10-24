// ---------------------------------------------------------------- exchange: PDF annotations, spreadsheets, reports
// Markups go into a PDF as standard annotations (ISO 32000: Line, PolyLine, Polygon, Square,
// Circle, FreeText, Ink, Highlight, Stamp, with a /Measure dictionary on measurements), each with
// its own appearance so any viewer draws it, and come back from any PDF that carries them,
// including measurement markups made in other programs. The mapping itself is in the core
// (markup_to_annots, annots_to_markups) and mirrors the Python package; this file only moves
// values between those plain descriptions and the PDF objects (pdf-lib).

// Every page's annotations and viewports, read into markups (nothing is added yet) in the PDF worker.
async function readPdfMarkups(bytes) {
  const transforms = [];
  for (let p = 0; p < S.doc.numPages; p++) transforms.push((await pageInfo(p)).transform);
  const r = await pdfWork("read", { bytes: bytes.slice(), transforms });
  return { pages: r.pages, markups: r.markups, skipped: r.skipped, annots: r.annots, scales: new Map(r.scales), viewports: new Map(r.viewports) };
}
const KIND_OF_TYPE = (t) => (C.MEASURE_TYPES.includes(t) ? "measure" : "markup");
async function openPdfImport(quiet) {
  if (!S.doc) return;
  let found;
  showBusy("Reading markups in the PDF...");
  try { found = await readPdfMarkups(S.doc.bytes); } catch (e) { showBusy(""); if (!quiet) status("Could not read the PDF's markups: " + cleanName(e.message, 120), "bad"); return; }
  showBusy("");
  const have = new Set(model().markups.map((m) => m.id));
  const fresh = found.markups.filter((m) => !have.has(m.id));
  const dupes = found.markups.length - fresh.length;
  if (!fresh.length && !found.viewports.size) {
    if (!quiet) status(found.annots ? "The PDF's " + found.annots + " annotations are already in this takeoff or are not markups." : "This PDF has no markups of its own.");
    return;
  }
  const byType = new Map();
  for (const m of fresh) byType.set(m.type, (byType.get(m.type) || 0) + 1);
  const use = new Set(byType.keys());
  const list = el("ul", { cls: "cands", id: "pdfimp-types" });
  for (const [t, n] of Array.from(byType).sort((a, b) => b[1] - a[1])) {
    const cb = el("input", { type: "checkbox", id: "pdfimp-t-" + t, checked: true, "aria-label": "Import " + (C.TYPE_LABELS[t] || t) });
    cb.addEventListener("change", () => { if (cb.checked) use.add(t); else use.delete(t); });
    const pages = new Set(fresh.filter((m) => m.type === t).map((m) => m.page));
    list.append(el("li", { cls: "cand ocr" }, [cb, el("span", { cls: "w" }, [el("b", { text: n + " " + (C.TYPE_LABELS[t] || t).toLowerCase() + (n === 1 ? "" : "s") }),
      el("span", { text: (KIND_OF_TYPE(t) === "measure" ? "measurement, " : "markup, ") + "on " + pages.size + " page" + (pages.size === 1 ? "" : "s") })])]));
  }
  const scalePages = Array.from(found.scales.keys()).filter((p) => !pageScale(p));
  const setScales = el("input", { type: "checkbox", id: "pdfimp-scales", checked: scalePages.length > 0, disabled: !scalePages.length });
  const nVp = Array.from(found.viewports.values()).reduce((s, l) => s + l.length, 0);
  const addVps = el("input", { type: "checkbox", id: "pdfimp-viewports", checked: nVp > 0, disabled: !nVp });
  const used = found.annots - found.skipped;
  const why = "The PDF carries " + found.annots + " annotations. " + used + " are markups this app understands" + (used !== found.markups.length ? ", " + found.markups.length + " once counted items with the same subject join one count" : "") + (dupes ? " (" + dupes + " already in this takeoff)" : "") +
    (found.skipped ? "; " + found.skipped + " others (links, form fields, notes) are left alone" : "") + ". Measurements keep the scale written in their /Measure dictionary" +
    (found.scales.size ? " (found on " + found.scales.size + " page" + (found.scales.size === 1 ? "" : "s") + ")" : "") + ".";
  openDialog({ title: "Markups in this PDF", icon: "import", src: fresh.length + " new", wide: true, cls: "auto",
    body: el("div", null, [el("div", { cls: "why" }, [el("b", { text: "Why" }), el("span", { text: why })]),
      el("div", { cls: "auto-ctl" }, [el("label", { cls: "chk", for: "pdfimp-scales" }, [setScales, "Set page scales from the PDF on " + scalePages.length + " page" + (scalePages.length === 1 ? "" : "s") + " without one"]),
        el("label", { cls: "chk", for: "pdfimp-viewports" }, [addVps, "Add " + nVp + " viewport" + (nVp === 1 ? "" : "s")])]), list]),
    note: "Nothing is added until you click Import. One undo removes it.",
    actions: [{ label: "Cancel" }, { label: "Import", primary: true, id: "pdfimp-ok", onClick: () => {
      const take = fresh.filter((m) => use.has(m.type)).map((m) => (m.vers && m.vers.length ? m : stampNew(Object.assign({}, m))));
      commit("Import markups from the PDF", (n) => {
        n.pages = Object.assign({}, n.pages);
        if (setScales.checked) for (const p of scalePages) {
          const ipp = found.scales.get(p), std = C.nearest_standard(ipp, 1e-6);
          n.pages[String(p)] = Object.assign({}, n.pages[String(p)] || {}, { scale: { in_per_pt: ipp, label: std ? std.label : "1:" + C.format_number(C.ratio_of(ipp), 1), source: "imported" } });
        }
        if (addVps.checked) for (const [p, vps] of found.viewports) {
          const e = Object.assign({}, n.pages[String(p)] || {});
          const names = new Set((e.viewports || []).map((v) => v.name));
          e.viewports = (e.viewports || []).concat(vps.filter((v) => !names.has(v.name)).map((v) => Object.assign({}, v, { id: newId("vp") }))).slice(0, 50);
          n.pages[String(p)] = e;
        }
        const ids = new Set(take.map((m) => m.id));
        n.markups = n.markups.concat(take.map((m) => { const id = C.viewport_at(n, m.page, m.points[0]); return id ? Object.assign({}, m, { viewport: id }) : m; }));
        if (n.tombstones) n.tombstones = n.tombstones.filter((t) => !ids.has(t.id));
      });
      undoToast("Imported " + take.length + " markup" + (take.length === 1 ? "" : "s") + " from the PDF.");
      // the PDF's own drawings of them would show twice: hide them (View menu switches them back)
      if (take.length) setAnnotsShown(false, true);
      status("Imported " + take.length + " markup" + (take.length === 1 ? "" : "s") + " from the PDF" + (setScales.checked && scalePages.length ? ", scales on " + scalePages.length + " page" + (scalePages.length === 1 ? "" : "s") : "") + ". The PDF's own drawings of them are hidden; View, Show the PDF's own markups brings them back.");
    } }] });
}
// When a plan set opens with markups of its own, say so once (nothing is imported without a click).
on("doc", async () => {
  if (!S.doc || !model() || model().markups.length) return;
  await nextFrame();
  try {
    const pg = await getPage(S.doc, S.view.page);
    const anns = await pg.getAnnotations({ intent: "display" });
    const marks = anns.filter((a) => ["Line", "PolyLine", "Polygon", "Square", "Circle", "FreeText", "Ink", "Stamp", "Highlight"].includes(a.subtype));
    if (marks.length) toast("This PDF has markups of its own (" + marks.length + " on this sheet).", { label: "Review", run: () => openPdfImport(false) }, "import");
  } catch (e) { /* no annotations to offer */ }
});

// ---- writing annotations (the PDF objects are built in the PDF worker, 79_pdfwork.js)
// Which shapes one annotation of a markup draws (a count's items are one annotation each).
function annotShapes(m, a, i) {
  if (m.type === "count") return flatShapes(Object.assign({}, m, { points: [m.points[i]], label: i === 0 ? m.label : "" }));
  return flatShapes(m);
}
// The markups as annotations, worked out here (colors, shapes, scales); the PDF itself is read and
// written in the PDF worker (79_pdfwork.js).
async function annotatedPdf(opts) {
  const pagesPlan = new Map();
  const entry = async (p) => {
    if (!pagesPlan.has(p)) pagesPlan.set(p, { p, transform: (await pageInfo(p)).transform, items: [], vps: [] });
    return pagesPlan.get(p);
  };
  for (const m of model().markups) {
    if (!opts.hidden && !layerVisible(m)) continue;
    if (m.page < 0 || m.page >= S.doc.numPages) continue;
    const e = await entry(m.page);
    const sc = markupScaleOf(m);
    const ctx = { transform: e.transform, settings: model().settings, color: colorOf(m), in_per_pt: sc ? sc.in_per_pt : null, scale_label: sc ? sc.label || "" : "" };
    let as;
    try { as = C.markup_to_annots(Object.assign({}, m, { color: colorOf(m) }), ctx); } catch (err) { continue; }
    e.items.push({ annots: as.map((a, i) => { if (!opts.private) delete a.private; return [a, annotShapes(m, a, i)]; }) });
  }
  for (let p = 0; p < S.doc.numPages; p++) {
    const vps = viewportsOf(p);
    if (!vps.length) continue;
    const e = await entry(p);
    e.vps = vps.map((v) => ({ rect: v.rect, name: v.name, md: C.measure_dict(v.scale.in_per_pt, v.scale.label || "", model().settings) }));
  }
  return pdfWork("write", { bytes: S.doc.bytes.slice(), opts: { private: !!opts.private }, ours: model().markups.map((m) => m.id), pages: Array.from(pagesPlan.values()), name: NAME });
}
async function exportAnnotatedPdf() {
  if (!S.doc) return;
  const hidden = el("input", { type: "checkbox", id: "annot-hidden" });
  const priv = el("input", { type: "checkbox", id: "annot-private", checked: true });
  openDialog({ title: "Save a PDF with markups as annotations", icon: "export", body: el("div", null, [
    el("p", { cls: "help", text: "Writes a new PDF in which every markup is a standard PDF annotation: other PDF viewers show them, and takeoff programs read measurements with their scale. The original file is not changed." }),
    el("label", { cls: "chk", for: "annot-hidden" }, [hidden, "Include markups on hidden layers"]),
    el("label", { cls: "chk", for: "annot-private" }, [priv, "Keep each markup's full details in the file, so this app reads them back exactly (status, comments, assemblies)"]),
  ]), actions: [{ label: "Cancel" }, { label: "Save PDF", primary: true, id: "annot-ok", onClick: async () => {
    showBusy("Writing annotations...");
    try {
      const r = await annotatedPdf({ hidden: hidden.checked, private: priv.checked });
      showBusy("");
      await saveFile(safeFileName(S.doc.name.replace(/\.pdf$/i, "")) + "-markups.pdf", new Blob([r.bytes], { type: "application/pdf" }), "application/pdf", "PDF");
      status("Saved a PDF with " + r.written + " markups as " + r.annots + " annotations.");
    } catch (e) { showBusy(""); status("Writing the PDF failed: " + cleanName(e.message, 120), "bad"); }
  } }] });
}

// ---- spreadsheets
function workbookBytes() {
  let est = null;
  try { est = C.document_estimate(model()); } catch (e) { est = null; }
  const sheets = [C.markups_sheet(C.markup_rows(model()), model().columns)];
  if (est && est.lines.length) sheets.push(C.estimate_sheet(est));
  return C.xlsx_workbook(sheets);
}
async function exportXlsx() {
  if (!S.doc) return;
  const bytes = workbookBytes();
  await saveFile(safeFileName(S.doc.name.replace(/\.pdf$/i, "") + "-takeoff") + ".xlsx", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Excel workbook");
  status("Exported the markups" + (model().assemblies.length ? " and the estimate" : "") + " as an Excel workbook (no macros, no formulas).");
}

// ---- PDF reports: a plain table, letter landscape, with a header and page numbers
async function tablePdf(title, sub, cols, rows, foot) {
  const lib = window.PDFLib;
  const doc = await lib.PDFDocument.create();
  const font = await doc.embedFont(lib.StandardFonts.Helvetica), bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const W = 792, H = 612, M = 36, rowH = 14, size = 8.5;
  const total = cols.reduce((s, c) => s + c.w, 0);
  const xs = [];
  let x = M;
  for (const c of cols) { xs.push(x); x += c.w * (W - 2 * M) / total; }
  // printed on white whatever the screen theme: the paper ink, and the neutral comparison gray for the quiet parts
  const ink = lib.rgb(...hexRgb(tok("paper-ink"))), muted = lib.rgb(...hexRgb(tok("cmp-same"))), hair = muted;
  const fit = (s, f, sz, w) => { s = winAnsi(String(s === null || s === undefined ? "" : s)); while (s.length > 1 && f.widthOfTextAtSize(s, sz) > w - 4) s = s.slice(0, -2) + "."; return s; };
  const pages = [];
  let page = null, y = 0;
  const head = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    page.drawText(winAnsi(title), { x: M, y: H - M - 4, size: 14, font: bold, color: ink });
    page.drawText(winAnsi(sub), { x: M, y: H - M - 20, size: 9, font, color: muted });
    y = H - M - 44;
    cols.forEach((c, i) => { const t = fit(c.label, bold, size, (xs[i + 1] || W - M) - xs[i]); page.drawText(t, { x: c.num ? (xs[i + 1] || W - M) - bold.widthOfTextAtSize(t, size) - 3 : xs[i] + 1, y, size, font: bold, color: ink }); });
    page.drawLine({ start: { x: M, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.8, color: ink });
    y -= rowH + 2;
  };
  head();
  for (const r of rows) {
    if (y < M + 24) head();
    const f = r.bold ? bold : font;
    if (r.rule) page.drawLine({ start: { x: M, y: y + rowH - 3 }, end: { x: W - M, y: y + rowH - 3 }, thickness: 0.5, color: hair });
    r.cells.forEach((v, i) => {
      const t = fit(v, f, size, (xs[i + 1] || W - M) - xs[i]);
      page.drawText(t, { x: cols[i].num ? (xs[i + 1] || W - M) - f.widthOfTextAtSize(t, size) - 3 : xs[i] + 1, y, size, font: f, color: ink });
    });
    y -= rowH;
  }
  if (foot) { if (y < M + 40) head(); y -= 6; for (const ln of foot) { page.drawText(winAnsi(ln), { x: M, y, size: 8, font, color: muted }); y -= 11; } }
  pages.forEach((pg, i) => pg.drawText(winAnsi(NAME + "  |  " + new Date().toISOString().slice(0, 10) + "  |  page " + (i + 1) + " of " + pages.length), { x: M, y: M - 18, size: 7.5, font, color: muted }));
  doc.setProducer(NAME + " (Field Tools)");
  doc.setTitle(title);
  return doc.save();
}
async function exportSummaryPdf() {
  if (!S.doc) return;
  const st = model().settings;
  const rows = C.markup_rows(model());
  const cols = [{ label: "Page", w: 5, num: true }, { label: "Sheet", w: 8 }, { label: "Type", w: 10 }, { label: "Subject", w: 18 }, { label: "Label", w: 14 }, { label: "Layer", w: 11 },
    { label: "Author", w: 10 }, { label: "Status", w: 9 }, { label: "Measurement", w: 15, num: true }];
  const body = rows.map((r) => ({ cells: [r.page, r.sheet, r.type, r.subject, r.label, r.layer, r.author, r.status, unitText(r.measurement)] }));
  const groups = C.group_totals(rows, "subject").filter((g) => g.totals.length);
  if (groups.length) {
    body.push({ cells: ["", "", "", "Totals by subject", "", "", "", "", ""], bold: true, rule: true });
    for (const g of groups) body.push({ cells: ["", "", "", g.group || "(no subject)", "", "", "", "", g.totals.map((t) => C.format_number(t.quantity, st.places) + " " + unitLabel(t.unit)).join(", ")] });
  }
  const bytes = await tablePdf("Markup summary", S.doc.name + ", " + rows.length + " markups", cols, body, ["Measurements use each sheet's scale (or its viewport's). Angles are listed but never added up."]);
  await saveFile(safeFileName(S.doc.name.replace(/\.pdf$/i, "") + "-markup-summary") + ".pdf", new Blob([bytes], { type: "application/pdf" }), "application/pdf", "PDF");
  status("Saved the markup summary report (" + rows.length + " rows).");
}
async function exportEstimatePdf() {
  if (!S.doc) return;
  let est;
  try { est = C.document_estimate(model()); } catch (e) { status(e.message, "bad"); return; }
  const cols = [{ label: "Assembly", w: 20 }, { label: "Component", w: 22 }, { label: "Need", w: 8, num: true }, { label: "Order", w: 8, num: true }, { label: "Unit", w: 6 },
    { label: "Unit cost", w: 9, num: true }, { label: "Material", w: 10, num: true }, { label: "Labor h", w: 7, num: true }, { label: "Labor", w: 10, num: true }, { label: "Cost", w: 10, num: true }];
  const body = [];
  for (const line of est.lines) {
    line.components.forEach((c, i) => body.push({ rule: i === 0, cells: [i === 0 ? line.name : "", c.name, fmtNum(c.with_waste, 2), fmtNum(c.order, 2), c.unit, money(c.unit_cost_cents), money(c.material_cents), fmtNum(c.labor_hours, 2), money(c.labor_cents), money(c.cost_cents)] }));
    body.push({ bold: true, cells: ["", "Assembly total", "", "", "", "", money(line.material_cents), "", money(line.labor_cents), money(line.cost_cents)] });
  }
  body.push({ cells: [""].concat(Array(9).fill("")) });
  for (const [label, key] of [["Material", "material_cents"], ["Labor", "labor_cents"], ["Subtotal", "subtotal_cents"], ["Overhead", "overhead_cents"], ["Markup", "markup_cents"], ["Tax", "tax_cents"], ["Total", "total_cents"]]) {
    body.push({ bold: label === "Total", rule: label === "Total", cells: ["", label, "", "", "", "", "", "", "", money(est[key] || 0)] });
  }
  const bytes = await tablePdf("Estimate", S.doc.name + ", " + est.lines.length + " assemblies", cols, body, ["Quantities come from the linked measurements; waste is applied before rounding up to whole purchase units.", "Unit costs and labor rates are the ones entered in this takeoff. Check them before use."]);
  await saveFile(safeFileName(S.doc.name.replace(/\.pdf$/i, "") + "-estimate") + ".pdf", new Blob([bytes], { type: "application/pdf" }), "application/pdf", "PDF");
  status("Saved the estimate report.");
}
