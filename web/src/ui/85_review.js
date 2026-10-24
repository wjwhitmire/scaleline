// ---------------------------------------------------------------- plan review and the project manual check
// Plan review runs fixed rule checks over the set (core plan_review): duplicate sheet numbers, the
// drawing index against the title blocks, untagged doors, rooms against the room or finish schedule,
// dimension strings that do not add up or do not match the drawing, scale mismatches, and changes
// between revisions without a cloud. Each finding links to its place and evidence and can become an
// RFI callout with a click. A model may then summarize the findings and suggest RFIs; it sees only
// the findings, and the findings never depend on it.
// The project manual check reads a specification PDF or text locally into CSI sections and matches
// them against the takeoff both ways (core parse_sections, match_scope); a model is asked only about
// lines that the word list cannot place, and its answers must name a section the manual has.
const RV = { result: null, shown: null, hot: null, filter: "all" };

async function reviewInputs(progress, cancelled) {
  const n = S.doc.numPages;
  await readAllTitleBlocks();
  const runs = await runAutoTakeoff(Array.from({ length: n }, (_, i) => i), (k, t) => progress && progress(k, t), cancelled);
  const at = new Map(runs.map((r) => [r.page, r.result]));
  const sheets = [];
  for (let p = 0; p < n; p++) {
    if (cancelled && cancelled()) break;
    const tb = S.titleBlocks[p] || {};
    let items = [], segs = [];
    try { items = await pageText(p); } catch (e) { items = []; }
    try { segs = (await sheetLineWork(p)).segs.filter((s) => s[5] === 0).map((s) => [s[0], s[1], s[2], s[3]]); } catch (e) { segs = []; }
    const sc = pageScale(p);
    const r = at.get(p);
    sheets.push({ page: p, number: tb.sheet_number || (model().pages[String(p)] || {}).label || "", title: tb.sheet_title || (model().pages[String(p)] || {}).title || "",
      scale_text: tb.scale ? tb.scale.text : "", in_per_pt: sc && sc.source !== "titleblock" ? sc.in_per_pt : null, viewports: viewportsOf(p).length,
      items, segs, doors: r ? r.doors : [], rooms: r ? r.rooms : [],
      clouds: pageMarkups(p).filter((m) => m.type === "cloud" || /revision/i.test(m.subject || "")).map((m) => ({ id: m.id, points: m.points })),
      changes: S.compare && S.compare.boxes && S.compare.page === p ? S.compare.boxes : [] });
  }
  return { sheets };
}
async function openPlanReview() {
  if (!S.doc) { status("Open a plan set first."); return; }
  let cancel = false;
  showBusy("Reviewing sheet 1 of " + S.doc.numPages + "...");
  let set;
  try { set = await reviewInputs((k, t) => showBusy("Reviewing sheet " + Math.min(k + 1, t) + " of " + t + "..."), () => cancel); }
  catch (e) { showBusy(""); status("The review could not run: " + cleanName(e.message, 120), "bad"); return; }
  showBusy("");
  RV.result = C.plan_review(set);
  RV.summary = null;
  showPlanReview();
}
function reviewOverlay(scr) {
  if (!RV.result || !dialogOpen || RV.hot === null) return;
  const f = RV.result.findings.find((x) => x.id === RV.hot);
  if (!f || f.page !== S.view.page || !f.where) return;
  const r = screenRect(f.where);
  const pts = rectPts([r[0] - 6, r[1] - 6], [r[2] + 6, r[3] + 6]);
  cased(scr, "path", { d: cloudPath(pts, true, 6) }, pencilColor("m-redline"), 1.6);
}
const SEV_CHIP = { high: "bad", medium: "warn", low: "" };
function showPlanReview() {
  const res = RV.result;
  const list = el("div", { cls: "tablewrap auto-list", id: "rv-list" });
  const rfis = C.review_rfi_drafts(res.findings);
  const render = () => {
    clear(list);
    const shown = res.findings.filter((f) => RV.filter === "all" || f.severity === RV.filter);
    if (!shown.length) { list.append(el("p", { cls: "help", text: res.findings.length ? "No finding at this level." : "Every check passed on this set." })); return; }
    const ul = el("ul", { cls: "findings" });
    for (const f of shown) {
      const go = el("button", { type: "button", cls: "btn small", text: "Show" });
      go.addEventListener("click", async () => {
        RV.hot = f.id;
        if (f.page !== S.view.page) await goToPage(f.page);
        if (f.where) centerOn((f.where[0] + f.where[2]) / 2, (f.where[1] + f.where[3]) / 2);
        render();
        drawScreenLayer();
      });
      const rfi = rfis.find((r) => r.finding === f.id);
      const mk = rfi ? el("button", { type: "button", cls: "btn small", text: "RFI callout" }) : null;
      if (mk) mk.addEventListener("click", () => { addRfiCallout(f, rfi); mk.disabled = true; });
      ul.append(el("li", { cls: RV.hot === f.id ? "sel" : null, "data-finding": f.id }, [
        el("span", { cls: "chip " + SEV_CHIP[f.severity], text: f.severity }),
        el("span", { cls: "m", text: f.sheet }),
        el("span", { cls: "msg", text: f.message }),
        el("details", { cls: "ev" }, [el("summary", { text: "Evidence (" + f.evidence.length + ")" }), el("ul", null, f.evidence.map((e) => el("li", { cls: "m", text: e.kind + ": " + e.text })))]),
        el("span", { cls: "row" }, [go, mk]),
      ]));
    }
    list.append(ul);
  };
  const seg = el("span", { cls: "seg", role: "group", "aria-label": "Show", id: "rv-filter" });
  for (const [v, l] of [["all", "All"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]]) {
    const n = v === "all" ? res.findings.length : res.findings.filter((f) => f.severity === v).length;
    const b = el("button", { type: "button", id: "rv-filter-" + v, "aria-pressed": RV.filter === v ? "true" : "false", text: l + " " + n });
    b.addEventListener("click", () => { RV.filter = v; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); render(); });
    seg.append(b);
  }
  const copy = el("button", { type: "button", cls: "btn small", id: "rv-copy", text: "Copy RFIs" });
  copy.addEventListener("click", () => copyText(rfis.map((r) => r.id + "\t" + r.sheet + "\t" + r.subject + "\t" + r.question).join("\n"), rfis.length + " RFIs"));
  const sumBox = el("div", { id: "rv-summary" });
  const sumBtn = el("button", { type: "button", cls: "btn small", id: "rv-summarize", text: "Summarize with AI" });
  sumBtn.addEventListener("click", () => summarizeReview(sumBox, sumBtn));
  if (RV.summary) renderReviewSummary(sumBox, RV.summary);
  const checked = res.checked.length + " checks ran: " + res.checked.join(", ") + ".";
  const body = el("div", null, [
    keyAnswer("Findings", res.findings.length + " found", S.doc.numPages + " sheets", "rv-total"),
    el("div", { cls: "why" }, [el("b", { text: "Why" }), el("span", { text: "Fixed rule checks on the set's text, title blocks and line work, with auto-takeoff's doors and rooms. " + checked + (res.notes.length ? " " + res.notes.join(" ") : "") })]),
    el("div", { cls: "auto-ctl" }, [seg, copy, aiAvailable() ? sumBtn : el("span", { cls: "help", text: "A summary with suggested RFIs needs one of the AI switches in Settings." })]),
    sumBox,
    list,
  ]);
  openDialog({ title: "Plan review", icon: "review", src: rfis.length + " draft RFIs", wide: true, cls: "auto", body,
    note: "Nothing changes on the drawings unless you click RFI callout. One undo removes each callout.",
    onCancel: () => { RV.hot = null; drawScreenLayer(); }, actions: [{ label: "Close", onClick: () => { RV.hot = null; drawScreenLayer(); } }] });
  render();
}
function addRfiCallout(f, rfi) {
  const w = f.where || [72, 72, 144, 108];
  const prev = S.preset;
  S.preset = S.presets.find((p) => p.id === "p-rfi") || null;
  const m = newMarkup("callout", [[w[2], w[1]], [w[2] + 60, w[1] - 40]], { text: (rfi.id + ": " + rfi.question).slice(0, 2000), label: rfi.subject });
  m.page = f.page;
  S.preset = prev;
  const cm = C.clean_markup(m);
  if (!cm) { status("That callout could not be placed.", "warn"); return; }
  addMarkups([cm], "Add RFI callout");
  undoToast("Added " + rfi.id + " as a callout on " + f.sheet + ".");
}
async function summarizeReview(box, btn) {
  const findings = RV.result.findings;
  btn.disabled = true;
  try {
    const raw = await modelText(C.ask_review_messages(findings), "Plan review summary");
    if (raw !== null) RV.summary = C.ask_read_review_reply(raw, findings);
  } catch (e) { status("The summary failed: " + cleanName(e.message, 160), "bad"); }
  if (dialogOpen && $("rv-summary") === box) { if (RV.summary) renderReviewSummary(box, RV.summary); btn.disabled = false; } else showPlanReview();
}
function renderReviewSummary(box, s) {
  clear(box);
  box.append(el("div", { cls: "why small" }, [el("b", { text: "Summary" }), el("span", { text: s.summary || "The model gave no summary." })]));
  if (s.rfis.length) box.append(el("ul", { cls: "help" }, s.rfis.map((r) => el("li", { text: "Suggested RFI (from " + r.findings.join(", ") + "): " + r.question }))));
  if (s.dropped) box.append(el("p", { cls: "help", text: s.dropped + " suggested RFI" + (s.dropped === 1 ? " was" : "s were") + " dropped: " + (s.dropped === 1 ? "it named" : "they named") + " no finding." }));
}

// ---- the project manual
const PM = { lines: null, name: "", result: null, sections: null, filter: "all", model: false };
const PM_STATUS = [["all", "All"], ["no quantities", "No quantities"], ["no section", "No section"], ["division only", "Division only"], ["not classified", "Not classified"], ["matched", "Matched"], ["general", "General"]];
function takeoffItems() {
  const rows = C.markup_rows(model());
  const groups = new Map();
  for (const m of model().markups) {
    if (!C.MEASURE_TYPES.includes(m.type)) continue;
    const key = (m.label || m.subject || C.TYPE_LABELS[m.type]) + "|" + (m.assembly || "");
    if (!groups.has(key)) {
      const a = m.assembly ? model().assemblies.find((x) => x.id === m.assembly) : null;
      groups.set(key, { id: "g" + (groups.size + 1), label: m.label || m.subject || C.TYPE_LABELS[m.type], subject: m.subject || "", layer: m.layer ? (layerById(m.layer) || {}).name || "" : "",
        assembly_name: a ? a.name : "", assembly_code: a && a.code ? a.code : "", quantity: 0, unit: "", ids: [] });
    }
    const g = groups.get(key), r = rows.find((x) => x.id === m.id);
    g.ids.push(m.id);
    if (r && r.quantity !== null && (!g.unit || g.unit === r.unit)) { g.unit = r.unit; g.quantity += r.quantity; }
  }
  return Array.from(groups.values());
}
async function manualLinesFromPdf(bytes) {
  const lib = await pdfjs();
  const doc = await lib.getDocument(pdfOptions(bytes.slice())).promise;
  const lines = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 3000); p++) {
      const pg = await doc.getPage(p);
      const vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const t = lib.Util.transform(vp.transform, it.transform);
        items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: Math.hypot(t[2], t[3]) });
      }
      for (const ln of C.auto_text_lines(items)) lines.push({ page: p - 1, str: ln.str });
      if (p % 10 === 0) { showBusy("Reading the project manual, page " + p + " of " + doc.numPages + "..."); await nextFrame(); }
    }
  } finally { try { doc.destroy(); } catch (e) { /* closed */ } }
  return lines;
}
async function openManualCheck() {
  if (!S.doc) { status("Open a plan set first."); return; }
  const file = el("input", { type: "file", id: "pm-file", accept: "application/pdf,.pdf,text/plain,.txt" });
  const ex = el("button", { type: "button", cls: "btn", id: "pm-example", text: "Use the example project manual" });
  const go = async (lines, name) => { PM.lines = lines; PM.name = name; PM.model = false; closeDialog(); runManualCheck(); };
  ex.addEventListener("click", () => go(C.parse_sections ? $("example-manual").textContent.split(/\r?\n/).map((s) => ({ page: 0, str: s })) : [], "Example project manual"));
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (f.size > 100 * 1048576) { status("That file is larger than 100 MB.", "warn"); return; }
    showBusy("Reading the project manual...");
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const isPdf = String.fromCharCode.apply(null, bytes.subarray(0, 5)) === "%PDF-";
      const lines = isPdf ? await manualLinesFromPdf(bytes) : new TextDecoder().decode(bytes).split(/\r?\n/).slice(0, 200000).map((s) => ({ page: 0, str: s }));
      showBusy("");
      go(lines, f.name);
    } catch (e) { showBusy(""); status("The project manual could not be read: " + cleanName(e.message, 120), "bad"); }
  });
  if (PM.lines) { runManualCheck(); return; }
  openDialog({ title: "Check against the project manual", icon: "library", body: el("div", { cls: "stack" }, [
    el("p", { cls: "help", text: "Pick the specification as a PDF or a text file. It is read on this device into CSI sections, then matched against the takeoff: sections with nothing measured yet, and measured items with no section." }),
    el("div", { cls: "field" }, [el("label", { for: "pm-file", text: "Project manual (PDF or text)" }), file]), ex]),
    actions: [{ label: "Cancel" }] });
}
function runManualCheck() {
  const parsed = C.parse_sections(PM.lines);
  PM.sections = parsed.sections;
  PM.result = C.match_scope(parsed.sections, takeoffItems());
  showManualCheck();
}
function showManualCheck() {
  const res = PM.result;
  const list = el("div", { cls: "tablewrap auto-list", id: "pm-list" });
  const items = takeoffItems();
  const render = () => {
    clear(list);
    const rows = res.rows.filter((r) => PM.filter === "all" || r.status === PM.filter);
    const tbl = el("table", { cls: "grid" }, [el("thead", null, [el("tr", null, ["Status", "Section", "Title", "Takeoff", "Source text"].map((h) => el("th", { text: h })))])]);
    const tb = el("tbody");
    for (const r of rows) {
      const qty = r.items.map((i) => i.label + (i.quantity !== null && i.unit ? " " + C.format_number(i.quantity, 2) + " " + i.unit : "")).join("; ");
      const tr = el("tr", { "data-status": r.status }, [el("td", null, [el("span", { cls: "chip " + (r.status === "matched" || r.status === "general" ? "good" : r.status === "not classified" ? "" : "warn"), text: r.status + (r.model ? " (model)" : "") })]),
        el("td", { cls: "m", text: r.section }), el("td", { text: r.title }), el("td", { text: qty, title: r.items.map((i) => i.why || "").filter(Boolean).join("; ") }),
        el("td", { cls: "whycell src", title: (r.source.text + " " + r.source.body).trim(), text: (r.source.page !== null && r.source.page !== undefined ? "p. " + (r.source.page + 1) + ": " : "") + r.source.text + (r.source.body ? " " + r.source.body : "") })]);
      tr.addEventListener("click", () => {
        const it = r.items[0] && items.find((g) => g.id === r.items[0].id);
        if (it) { S.selection = new Set(it.ids); const m = markupById(it.ids[0]); if (m && m.page !== S.view.page) goToPage(m.page).then(() => { S.selection = new Set(it.ids); emit("selection"); }); else emit("selection"); }
      });
      tb.append(tr);
    }
    tbl.append(tb);
    list.append(rows.length ? tbl : el("p", { cls: "help", text: "No row with this status." }));
  };
  const seg = el("span", { cls: "seg", role: "group", "aria-label": "Show", id: "pm-filter" });
  for (const [v, l] of PM_STATUS) {
    const n = v === "all" ? res.rows.length : res.counts[v] || 0;
    if (v !== "all" && !n) continue;
    const b = el("button", { type: "button", "aria-pressed": PM.filter === v ? "true" : "false", text: l + " " + n });
    b.addEventListener("click", () => { PM.filter = v; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); render(); });
    seg.append(b);
  }
  const cls = el("button", { type: "button", cls: "btn small", id: "pm-classify", text: "Classify the unplaced lines with AI" });
  cls.addEventListener("click", async () => {
    cls.disabled = true;
    try {
      const raw = await modelText(C.ask_classify_messages(res.rows, PM.sections), "Project manual lines");
      if (raw !== null) {
        const [next, rejected] = C.apply_classes(res, C.ask_read_classes(raw), PM.sections);
        PM.result = next;
        PM.model = true;
        closeDialog();
        showManualCheck();
        status("The model placed " + (next.rows.filter((r) => r.model).length) + " line(s)" + (rejected.length ? "; " + rejected.length + " answer(s) named no section of this manual and were left out" : "") + ". Check them: they are marked (model).");
        return;
      }
    } catch (e) { status("Classifying failed: " + cleanName(e.message, 160), "bad"); }
    cls.disabled = false;
  });
  const reload = el("button", { type: "button", cls: "btn small ghost", id: "pm-other", text: "Another manual" });
  reload.addEventListener("click", () => { PM.lines = null; closeDialog(); openManualCheck(); });
  const nq = res.counts["no quantities"] || 0;
  const body = el("div", null, [
    keyAnswer("Specified, not measured", nq + " sections", PM.sections.length + " sections read", "pm-total"),
    el("div", { cls: "why" }, [el("b", { text: "Why" }), el("span", { text: "Read " + PM.sections.length + " sections from " + PM.name + " by their CSI numbers. A takeoff item matches a section through its assembly's code, or else through words in its label, subject, layer or assembly name. Divisions 00 and 01 are general requirements and are listed, not measured. Every row shows the text it came from." })]),
    el("div", { cls: "auto-ctl" }, [seg, (res.counts["not classified"] || 0) && aiAvailable() ? cls : null, reload]),
    list,
  ]);
  openDialog({ title: "Project manual check", icon: "library", src: PM.name, wide: true, cls: "auto", body, actions: [{ label: "Close" }] });
  render();
}
