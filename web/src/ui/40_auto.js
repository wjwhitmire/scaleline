// ---------------------------------------------------------------- automatic tools
// Each one shows what it found and why, and nothing lands in the takeoff until the person
// accepts it; every accepted result is one undoable step.

// A worker built from the core's own source runs the pixel work off the main thread.
const work = { worker: null, seq: 0, pending: new Map(), mode: "main thread" };
function startComputeWorker() {
  try {
    const core = $("core").textContent;
    const handler = "\nself.onmessage=function(e){var m=e.data,r;try{" +
      "if(m.op==='room'){r=CORE.detect_room(m.gray,m.w,m.h,m.x,m.y,m.opts);}" +
      "else if(m.op==='symbol'){r=CORE.find_symbol(m.gray,m.w,m.h,m.tpl,m.tw,m.th,m.opts);}" +
      "else if(m.op==='compare'){var s=CORE.best_shift(m.a,m.b,m.w,m.h,m.max);var d=CORE.diff_masks(m.a,m.b,m.w,m.h,s.dx,s.dy,1);" +
      "var boxes=CORE.change_boxes(d.added.map(function(v,i){return v|d.removed[i];}),m.w,m.h,m.pad,m.min);" +
      "var img=CORE.overlay_rgba(d,m.w,m.h,m.cA,m.cB,m.cBoth);r={dx:s.dx,dy:s.dy,boxes:boxes,nAdded:d.nAdded,nRemoved:d.nRemoved,img:img};}" +
      "else if(m.op==='clean'){r=CORE.clean_scan(m.gray,m.w,m.h,m.opts);}" +
      "else if(m.op==='lines'){r=CORE.scan_lines(m.gray,m.w,m.h,m.opts);}" +
      "else if(m.op==='autotakeoff'){r=CORE.auto_takeoff(m.page,m.opts);}" +
      "self.postMessage({id:m.id,ok:true,r:r});}catch(err){self.postMessage({id:m.id,ok:false,error:String(err&&err.message||err)});}};";
    const url = URL.createObjectURL(new Blob(['"use strict";\n' + core + handler], { type: "text/javascript" }));
    const w = new Worker(url);
    w.onmessage = (e) => {
      const p = work.pending.get(e.data.id);
      if (!p) return;
      work.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.r); else p.reject(new Error(e.data.error));
    };
    w.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); work.worker = null; work.mode = "main thread"; for (const p of work.pending.values()) p.reject(new Error("worker stopped")); work.pending.clear(); };
    work.worker = w;
    work.mode = "worker";
  } catch (e) { work.worker = null; }
}
function compute(op, msg) {
  if (!work.worker) {
    return nextFrame().then(() => {
      if (op === "room") return C.detect_room(msg.gray, msg.w, msg.h, msg.x, msg.y, msg.opts);
      if (op === "symbol") return C.find_symbol(msg.gray, msg.w, msg.h, msg.tpl, msg.tw, msg.th, msg.opts);
      if (op === "clean") return C.clean_scan(msg.gray, msg.w, msg.h, msg.opts);
      if (op === "lines") return C.scan_lines(msg.gray, msg.w, msg.h, msg.opts);
      if (op === "autotakeoff") return C.auto_takeoff(msg.page, msg.opts);
      const s = C.best_shift(msg.a, msg.b, msg.w, msg.h, msg.max);
      const d = C.diff_masks(msg.a, msg.b, msg.w, msg.h, s.dx, s.dy, 1);
      const both = d.added.map((v, i) => v | d.removed[i]);
      return { dx: s.dx, dy: s.dy, boxes: C.change_boxes(both, msg.w, msg.h, msg.pad, msg.min), nAdded: d.nAdded, nRemoved: d.nRemoved, img: C.overlay_rgba(d, msg.w, msg.h, msg.cA, msg.cB, msg.cBoth) };
    });
  }
  return new Promise((resolve, reject) => {
    const id = ++work.seq;
    work.pending.set(id, { resolve, reject });
    work.worker.postMessage(Object.assign({ op, id }, msg));
  });
}

// ---------------------------------------------------------------- area by click (room fill)
const ROOM_GAPS = [0, 2, 4, 7];
const ROOM_BOUNDARY_LABELS = { inside: "Inside face", center: "Wall centerline", outside: "Outside face" };
function roomBoundary() { return C.ROOM_BOUNDARIES.includes(S.settings.roomBoundary) ? S.settings.roomBoundary : "inside"; }
async function runRoomFill(p, opts) {
  closeRoomCard();
  const maxStep = opts && opts.maxStep !== undefined ? opts.maxStep : ROOM_GAPS.length - 1;
  const page = S.view.page;
  const info = await pageInfo(page);
  showBusy("Finding the room...");
  try {
    const sc = rasterScale(info);
    const g = await pageGrayCached(page, sc);
    // how far a wall can reach: 24 in thick, a cavity 10 in, at the sheet's scale (else in points)
    const ipp = (scaleAt(page, p) || {}).in_per_pt;
    const px = (inches) => Math.max(3, Math.min(150, (ipp ? inches / ipp : inches) * sc));
    const bnd = roomBoundary();
    let res = null, gapUsed = 0, step = 0;
    // Try closing small gaps (door openings drawn without a swing, broken lines) step by step.
    for (const [i, gap] of ROOM_GAPS.slice(0, maxStep + 1).entries()) {
      step = i;
      res = await compute("room", { gray: g.gray, w: g.w, h: g.h, x: p[0] * sc, y: p[1] * sc, opts: { gap, threshold: 170, minHole: 150 * sc * sc, boundary: bnd, maxWall: px(24), maxGap: px(10) } });
      gapUsed = gap;
      if (res.ok || res.reason === "on_ink" || res.reason === "outside") break;
    }
    if (!res.ok) {
      const why = { on_ink: "That point is on a line. Click inside the room.", outside: "That point is off the sheet.",
        leaks: "The space is not closed: it runs to the edge of the sheet even after closing gaps up to " + (gapUsed / sc).toFixed(1) + " pt. Draw a line across the opening, then click again.",
        too_large: "The space is too large to be a room. Draw a line across the opening, then click again.", no_boundary: "No boundary was found." }[res.reason] || "No room found.";
      status(why, "warn");
      return;
    }
    const toPage = (loop) => loop.map((q) => [q[0] / sc, q[1] / sc]);
    const outer = toPage(res.outer);
    // Islands smaller than about 12 x 12 pt of paper are text and symbols, not cutouts.
    const holes = res.holes.map(toPage);
    const type = S.preset && ["area", "volume"].includes(S.preset.tool) ? S.preset.tool : "area";
    const m = createMarkup(type, outer, holes.length ? { holes } : null, "Add area by click");
    if (m) {
      const d = displayOf(m);
      const wall = res.faces && res.faces.thickness ? res.faces.thickness / sc : null;
      status("Room traced: " + (d ? d.text : "") + " to the " + ROOM_BOUNDARY_LABELS[bnd].toLowerCase() + (holes.length ? ", " + holes.length + " cutout" + (holes.length > 1 ? "s" : "") : "") +
        ". Traced at " + (sc * 72).toFixed(0) + " px per inch" + (gapUsed ? ", closing gaps up to " + (gapUsed / sc).toFixed(1) + " pt" : "") + ". Edit the corners if needed; Ctrl+Z removes it." + explainAssembly(m));
      showRoomCard(p, m, step, gapUsed / sc, holes.length, { boundary: bnd, wall, edges: res.faces ? res.faces.edges : 0, of: res.faces ? res.faces.of : 0, maxStep });
      undoToast("Area by click: " + (d ? d.text : "traced") + (holes.length ? ", " + holes.length + " cutout" + (holes.length > 1 ? "s" : "") : "") + (gapUsed ? ", gaps up to " + (gapUsed / sc).toFixed(1) + " pt closed" : "") + ". Drawn as a normal area; edit any corner.");
    }
  } catch (e) {
    status("Room fill failed: " + cleanName(e.message, 120), "bad");
  } finally { showBusy(""); }
}

// The area by click card: what was traced and why, with Try a smaller gap and Keep area.
function closeRoomCard() { const c = $("room-card"); if (c) c.remove(); }
function showRoomCard(p, m, step, gapPt, nHoles, info) {
  closeRoomCard();
  const d = displayOf(m);
  const f = info || {};
  const sc = markupScaleOf(m);
  const wallText = f.wall ? (sc ? C.format_length(f.wall * sc.in_per_pt, model().settings.length_unit, model().settings.places, model().settings.denominator) : C.format_number(f.wall, 1) + " pt") : "";
  const why = "Traced the enclosed space under your click." + (step ? " The space leaked through an opening, so gaps up to " + C.format_number(gapPt, 1) + " pt were closed (step " + (step + 1) + " of " + ROOM_GAPS.length + ")." : " It closed without bridging any gap.") +
    (nHoles ? " " + nHoles + " island" + (nHoles === 1 ? " became a cutout" : "s became cutouts") + "." : "") +
    (f.wall ? " Edges sit on the walls' " + ROOM_BOUNDARY_LABELS[f.boundary].toLowerCase() + " (walls read about " + wallText + " thick on " + f.edges + " of " + f.of + " edges)." : " No wall faces were read; the edges follow the traced pixels.");
  const seg = el("div", { cls: "seg", role: "group", "aria-label": "Boundary", id: "room-boundary" });
  for (const k of C.ROOM_BOUNDARIES) {
    const b = el("button", { type: "button", id: "room-bnd-" + k, "aria-pressed": k === f.boundary ? "true" : "false", text: ROOM_BOUNDARY_LABELS[k] });
    b.addEventListener("click", () => {
      if (k === roomBoundary()) return;
      S.settings.roomBoundary = k;
      kvSet("settings", S.settings);
      const top = S.hist.past[S.hist.past.length - 1];
      if (top && top.label === "Add area by click" && markupById(m.id)) undo();
      runRoomFill(p, { maxStep: f.maxStep });
    });
    seg.append(b);
  }
  const keep = el("button", { type: "button", cls: "btn primary small", id: "room-keep", text: "Keep area" });
  keep.addEventListener("click", closeRoomCard);
  const smaller = el("button", { type: "button", cls: "btn small", id: "room-smaller", text: "Try a smaller gap", disabled: !step });
  smaller.addEventListener("click", () => {
    const top = S.hist.past[S.hist.past.length - 1];
    if (top && top.label === "Add area by click" && markupById(m.id)) undo();
    runRoomFill(p, { maxStep: step - 1 });
  });
  const card = el("section", { cls: "auto-card", id: "room-card", "aria-labelledby": "room-card-h" }, [
    el("header", null, [icon("roomfill"), el("h4", { id: "room-card-h", text: "Area by click: " + (d ? d.text : "traced") }), el("span", { cls: "src", text: "Sheet " + sheetLabel(m.page) })]),
    el("div", { cls: "why small" }, [el("b", { text: "Why" }), el("span", { text: why })]),
    el("div", { cls: "room-bnd" }, [el("span", { cls: "help", text: "Boundary" }), seg]),
    el("footer", null, [el("span", { cls: "note-l", text: "Drawn as a normal area; edit any corner. Ctrl+Z removes it." }), smaller, keep]),
  ]);
  card.dataset.id = m.id;
  card.addEventListener("pointerdown", (e) => e.stopPropagation());
  viewer().append(card);
}
on("model", () => { const c = $("room-card"); if (c && !markupById(c.dataset.id)) c.remove(); });
on("tool", () => { if (S.tool !== "roomfill") closeRoomCard(); });
on("view", () => { const c = $("room-card"); if (c && markupById(c.dataset.id) && markupById(c.dataset.id).page !== S.view.page) c.remove(); });

// ---------------------------------------------------------------- find symbol and count
// Matches down to 0.6 are kept; those at or above 0.72 start checked, and the slider moves the line.
const CAND_DEFAULT = 0.72;
// On a scanned sheet the search runs on a cleaned copy (contrast stretched, thresholded, specks
// removed; not turned, so positions stay put) and keeps matches down to 0.5, because scan noise
// and a slight skew lower every score.
const scanFlags = new Map();
async function isScanned(p) {
  const k = (S.doc && S.doc.id) + ":" + p;
  if (scanFlags.has(k)) return scanFlags.get(k);
  let r = false;
  try { r = (await nativeText(p)).length < 3 && (await pageVectors(p)).segs.length < 20; } catch (e) { r = false; }
  scanFlags.set(k, r);
  return r;
}
const cleanCache = new Map();
async function symbolGray(p, sc) {
  const g = await pageGrayCached(p, sc);
  if (!(await isScanned(p))) return g;
  const k = (S.doc && S.doc.id) + ":" + p + "@" + sc;
  if (cleanCache.has(k)) return cleanCache.get(k);
  const c = await compute("clean", { gray: g.gray, w: g.w, h: g.h, opts: { deskew: false, speck: 4 } });
  const out = { gray: c.gray, w: g.w, h: g.h, scale: sc, scanned: true };
  cleanCache.set(k, out);
  if (cleanCache.size > 2) cleanCache.delete(cleanCache.keys().next().value);
  return out;
}
async function runFindSymbol(box, opts) {
  const page = S.view.page;
  const info = await pageInfo(page);
  const sc = rasterScale(info);
  showBusy("Looking for matches...");
  try {
    const g = await symbolGray(page, sc);
    const x0 = Math.max(0, Math.floor(box[0] * sc)), y0 = Math.max(0, Math.floor(box[1] * sc));
    const tw = Math.min(g.w - x0, Math.ceil((box[2] - box[0]) * sc)), th = Math.min(g.h - y0, Math.ceil((box[3] - box[1]) * sc));
    if (tw < 6 || th < 6 || tw * th > 250000) { status("Pick a box around one symbol (not too small, not a whole room).", "warn"); return; }
    const tpl = new Uint8Array(tw * th);
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) tpl[j * tw + i] = g.gray[(y0 + j) * g.w + x0 + i];
    S.symbolTemplate = { tpl, tw, th, sc, opts: Object.assign({ threshold: g.scanned ? 0.5 : 0.6, rotations: true, mirror: true }, opts || {}) };
    const hits = await compute("symbol", { gray: g.gray, w: g.w, h: g.h, tpl, tw, th, opts: S.symbolTemplate.opts });
    const items = hits.map((h) => ({ page, x0: h.x / sc, y0: h.y / sc, x1: (h.x + h.w) / sc, y1: (h.y + h.h) / sc, score: h.score, on: h.score >= CAND_DEFAULT, rot: h.rot, mirror: h.mirror }));
    S.candidates = { items, box, pagesSearched: new Set([page]) };
    drawScreenLayer();
    openCandidates();
  } catch (e) {
    status("Symbol search failed: " + cleanName(e.message, 120), "bad");
  } finally { showBusy(""); }
}
async function searchMorePages(pages, progress, cancelled) {
  const st = S.symbolTemplate;
  if (!st || !S.candidates) return;
  let n = 0;
  for (const page of pages) {
    if (cancelled() || !S.candidates) break;
    if (S.candidates.pagesSearched.has(page)) { n++; continue; }
    const info = await pageInfo(page);
    const sc = rasterScale(info);
    // The symbol is drawn at the same paper size on every sheet; rescale the template if needed.
    let tpl = st.tpl, tw = st.tw, th = st.th;
    if (Math.abs(sc - st.sc) > 1e-6) {
      const k = sc / st.sc;
      tw = Math.max(6, Math.round(st.tw * k)); th = Math.max(6, Math.round(st.th * k));
      tpl = new Uint8Array(tw * th);
      for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) tpl[j * tw + i] = st.tpl[Math.min(st.th - 1, Math.floor(j / k)) * st.tw + Math.min(st.tw - 1, Math.floor(i / k))];
    }
    const g = await symbolGray(page, sc);
    const hits = await compute("symbol", { gray: g.gray, w: g.w, h: g.h, tpl, tw, th, opts: st.opts });
    if (!S.candidates) break;
    for (const h of hits) S.candidates.items.push({ page, x0: h.x / sc, y0: h.y / sc, x1: (h.x + h.w) / sc, y1: (h.y + h.h) / sc, score: h.score, on: h.score >= Number(($("cand-threshold") || {}).value || CAND_DEFAULT), rot: h.rot, mirror: h.mirror });
    S.candidates.pagesSearched.add(page);
    progress(++n, pages.length);
  }
  drawScreenLayer();
}
// A paper thumbnail of one match, cut from the page raster the search ran on.
function candThumb(c) {
  const cv = el("canvas", { cls: "thumb-s", width: 40, height: 32, "aria-hidden": "true" });
  const st = S.symbolTemplate;
  const g = st && grayCache.get(c.page + "@" + rasterScale(pageInfoNow(c.page) || { w: 1, h: 1 }));
  if (!g) return cv;
  const sc = g.scale, pad = 4 / sc;
  const x0 = Math.max(0, Math.floor((c.x0 - pad) * sc)), y0 = Math.max(0, Math.floor((c.y0 - pad) * sc));
  const w = Math.max(1, Math.min(g.w - x0, Math.ceil((c.x1 - c.x0 + 2 * pad) * sc))), h = Math.max(1, Math.min(g.h - y0, Math.ceil((c.y1 - c.y0 + 2 * pad) * sc)));
  const k = Math.min(40 / w, 32 / h);
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(40, 32);
  const ox = (40 - w * k) / 2, oy = (32 - h * k) / 2;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 40; x++) {
    const sx = Math.floor((x - ox) / k), sy = Math.floor((y - oy) / k);
    const v = sx >= 0 && sy >= 0 && sx < w && sy < h ? g.gray[(y0 + sy) * g.w + x0 + sx] : 255;
    const o = (y * 40 + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
// Every automatic step uses one pattern: what was found, why, the controls, the list, and a footer
// that states the contract (nothing lands until you click, one undo removes it all).
function openCandidates() {
  const cand = S.candidates;
  const summary = el("span", { id: "cand-summary" });
  const list = el("ul", { cls: "cands", id: "cand-list" });
  const thr = el("input", { type: "range", id: "cand-threshold", min: S.symbolTemplate ? S.symbolTemplate.opts.threshold : 0.6, max: 0.98, step: 0.01, value: CAND_DEFAULT, "aria-label": "Minimum match" });
  const thrOut = el("output", { text: Math.round(CAND_DEFAULT * 100) + "%" });
  const prog = el("div", { cls: "progress", hidden: true }, [el("div")]);
  const presetSel = select([["", "Count (no preset)"]].concat(S.presets.filter((p) => p.tool === "count").map((p) => [p.id, p.name])), S.preset && S.preset.tool === "count" ? S.preset.id : "", { id: "cand-preset" });
  let accept = null;
  const render = () => {
    clear(list);
    cand.items.sort((a, b) => a.page - b.page || b.score - a.score);
    let on = 0;
    cand.items.forEach((c, i) => {
      if (c.on) on++;
      if (i >= 500) return;
      const cb = el("input", { type: "checkbox", id: "cand-" + i, checked: c.on, "aria-label": "Keep match " + (i + 1) });
      cb.addEventListener("change", () => { c.on = cb.checked; render(); drawScreenLayer(); });
      const go = el("button", { type: "button", cls: "iconbtn", "aria-label": "Zoom to match " + (i + 1), title: "Zoom to it" }, [icon("zoom")]);
      go.addEventListener("click", async () => { await goToPage(c.page); zoomTo([c.x0 - 40, c.y0 - 40, c.x1 + 40, c.y1 + 40]); });
      const pct = Math.round(c.score * 100);
      const why = "Match " + pct + "%" + (c.rot ? ", turned " + c.rot + " deg" : "") + (c.mirror ? ", mirrored" : "") + (c.score < 0.72 ? ", similar shape" : "");
      list.append(el("li", { cls: "cand" + (c.on ? "" : " off") }, [cb, candThumb(c),
        el("span", { cls: "w" }, [el("b", { text: "Sheet " + sheetLabel(c.page) + ", at " + Math.round(c.x0) + ", " + Math.round(c.y0) + " pt" }), el("span", { text: why })]),
        el("span", { cls: "score" }, [el("span", { text: pct + "%" }), el("i", { style: "--s:" + pct + "%" })]), go]));
    });
    const pages = new Set(cand.items.filter((c) => c.on).map((c) => c.page));
    summary.textContent = on + " of " + cand.items.length + " matches selected on " + pages.size + " sheet" + (pages.size === 1 ? "" : "s") +
      ". Each spot was compared with the symbol you boxed (normalized correlation), including turned and mirrored copies. Matches at " + Math.round(Number(thr.value) * 100) + "% and up start checked; uncheck any that are wrong.";
    if (accept) accept.textContent = on ? "Add " + on + " count" + (on === 1 ? "" : "s") : "Add counts";
    drawScreenLayer();
  };
  thr.addEventListener("input", () => { const t = Number(thr.value); thrOut.textContent = Math.round(t * 100) + "%"; cand.items.forEach((c) => { c.on = c.score >= t; }); render(); });
  let cancel = false;
  const allBtn = el("button", { type: "button", cls: "btn small", id: "cand-all-pages" }, [icon("pages"), "Search all sheets"]);
  allBtn.addEventListener("click", async () => {
    allBtn.disabled = true; prog.hidden = false; cancel = false;
    const pages = Array.from({ length: S.doc.numPages }, (_, i) => i);
    await searchMorePages(pages, (n, total) => { prog.firstChild.style.width = (100 * n / total) + "%"; }, () => cancel);
    prog.hidden = true;
    render();
  });
  const body = el("div", null, [
    el("div", { cls: "why" }, [el("b", { text: "Why" }), summary]),
    el("div", { cls: "auto-ctl" }, [el("span", { cls: "range" }, [el("label", { cls: "cap", for: "cand-threshold", text: "Minimum" }), thr, thrOut]),
      el("div", { cls: "field" }, [el("label", { for: "cand-preset", text: "Count as" }), presetSel]), allBtn, prog]),
    list,
  ]);
  const d = openDialog({ title: "Found " + cand.items.length + " match" + (cand.items.length === 1 ? "" : "es") + " for the boxed symbol", icon: "findsymbol", src: "Sheet " + sheetLabel(S.view.page), wide: true, cls: "auto", body,
    note: "Nothing is added until you click Add. One undo removes all of them.",
    onCancel: () => { cancel = true; S.candidates = null; drawScreenLayer(); },
    actions: [
      { label: "Cancel", onClick: () => { cancel = true; S.candidates = null; drawScreenLayer(); } },
      { label: "Add counts", primary: true, id: "cand-accept", onClick: () => { cancel = true; acceptCandidates(presetSel.value); } },
    ] });
  accept = d.box.querySelector("#cand-accept");
  render();
}
function acceptCandidates(presetId) {
  const cand = S.candidates;
  S.candidates = null;
  if (!cand) return;
  const chosen = cand.items.filter((c) => c.on);
  if (!chosen.length) { drawScreenLayer(); status("No matches were selected."); return; }
  const prevPreset = S.preset;
  S.preset = S.presets.find((p) => p.id === presetId) || (prevPreset && prevPreset.tool === "count" ? prevPreset : null);
  const byPage = new Map();
  for (const c of chosen) { if (!byPage.has(c.page)) byPage.set(c.page, []); byPage.get(c.page).push([round3((c.x0 + c.x1) / 2), round3((c.y0 + c.y1) / 2)]); }
  const list = [];
  for (const [page, pts] of byPage) {
    const m = newMarkup("count", pts);
    m.page = page;
    m.label = "Found by symbol search";
    const c = C.clean_markup(m);
    if (c) list.push(c);
  }
  S.preset = prevPreset;
  addMarkups(list, "Add counts from symbol search");
  drawScreenLayer();
  status("Added " + chosen.length + " counted item" + (chosen.length === 1 ? "" : "s") + " on " + byPage.size + " sheet" + (byPage.size === 1 ? "" : "s") + "." + (list[0] ? explainAssembly(list[0]) : "") + " Ctrl+Z removes them.");
  const asName = S.presets.find((p) => p.id === presetId);
  toast("Added " + chosen.length + " count" + (chosen.length === 1 ? "" : "s") + (asName ? " to " + asName.name : "") + " on " + byPage.size + " sheet" + (byPage.size === 1 ? "" : "s") + "." + (list[0] && list[0].assembly ? " Assembly from the " + (list[0].assembly_source === "preset" ? "preset" : "layer") + "." : ""),
    { label: "Undo", run: () => { if (S.hist.past.length && S.hist.past[S.hist.past.length - 1].label === "Add counts from symbol search") undo(); } });
}

// ---------------------------------------------------------------- title blocks: sheet index and scale
async function readTitleBlock(p) {
  if (S.titleBlocks[p]) return S.titleBlocks[p];
  const info = await pageInfo(p);
  const items = await pageText(p);
  const r = C.read_title_block(items, info.w, info.h);
  S.titleBlocks[p] = r;
  return r;
}
function sheetLabel(p) {
  const e = model() && model().pages[String(p)];
  return (e && e.label) || String(p + 1);
}
// After a page shows: load snap geometry, and offer the title block scale if the page has none.
async function afterPageShown(p) {
  loadVectors(p);
  renderSuggestion(null);
  try {
    const tb = await readTitleBlock(p);
    if (S.view.page !== p) return;
    if (!pageScale(p) && tb.scale) {
      if (S.settings.autoTitleScale) {
        applyTitleScale([p], "Set scale from title block");
        status("Scale set from the title block: " + tb.scale.text + ". " + tb.why.join("; ") + ".");
      } else renderSuggestion(p, tb);
    }
  } catch (e) { /* a page without text */ }
}
function renderSuggestion(p, tb) {
  const box = clear($("sb-suggest"));
  closeWhyPop();
  S.suggestion = p === null || !tb ? null : { p, tb };
  renderSheetbar();
  if (p === null || !tb) return;
  const s = el("span", { cls: "suggest", id: "suggest-scale" }, [icon("auto"), el("span", { text: "Title block:" }), el("span", { cls: "mono", text: tb.scale.text })]);
  const apply = el("button", { type: "button", cls: "go", id: "suggest-apply", text: "Apply" });
  apply.addEventListener("click", () => { applyTitleScale([p], "Set scale from title block"); renderSuggestion(null); });
  const why = el("button", { type: "button", id: "suggest-why", "aria-expanded": "false", "aria-haspopup": "dialog", text: "Why" });
  why.addEventListener("click", (e) => { e.stopPropagation(); if ($("why-pop")) closeWhyPop(); else openWhyPop(why, p, tb); });
  s.append(apply, why);
  box.append(s);
}
// Why this scale: the reader's reasons, Apply, Apply to every sheet with a note, and the rule.
function closeWhyPop() { const w = $("why-pop"); if (w) w.remove(); const b = $("suggest-why"); if (b) b.setAttribute("aria-expanded", "false"); }
function openWhyPop(btn, p, tb) {
  closeWhyPop();
  const info = pageInfoNow(p);
  const reasons = tb.why.slice();
  if (info) {
    const win = info.w / 72, hin = info.h / 72;
    const small = Math.max(win, hin) <= 17.5;
    reasons.push("The page is " + C.format_number(win, 0) + " x " + C.format_number(hin, 0) + " in" + (small ? ": an 11 x 17 or smaller print is often a reduced set, so calibrate before you trust a printed scale." : ", a full-size sheet."));
  }
  const rule = el("input", { type: "checkbox", id: "why-rule", checked: !!S.settings.autoTitleScale });
  rule.addEventListener("change", () => { S.settings.autoTitleScale = rule.checked; kvSet("settings", S.settings); status(rule.checked ? "Rule on: title block scales are set on sheets without one (undoable)." : "Rule off."); });
  const ap = el("button", { type: "button", cls: "btn primary small", id: "why-apply", text: "Apply" });
  ap.addEventListener("click", () => { applyTitleScale([p], "Set scale from title block"); renderSuggestion(null); });
  const all = el("button", { type: "button", cls: "btn small", id: "why-apply-all", text: "Apply to every sheet with a note" });
  all.addEventListener("click", async () => {
    closeWhyPop();
    await readAllTitleBlocks();
    const pages = Array.from({ length: S.doc.numPages }, (_, i) => i).filter((i) => !pageScale(i) && S.titleBlocks[i] && S.titleBlocks[i].scale);
    const n = applyTitleScale(pages, "Set scales from title blocks");
    renderSuggestion(null);
    undoToast("Scale set from the title block on " + n + " sheet" + (n === 1 ? "" : "s") + ".");
  });
  const pop = el("div", { cls: "pop", id: "why-pop", role: "dialog", "aria-label": "Why this scale" }, [
    el("span", { cls: "cap", text: "Why " + tb.scale.text + " on " + sheetLabel(p) }),
    el("ul", null, reasons.map((w) => el("li", { text: w }))),
    el("div", { cls: "row" }, [ap, all]),
    el("label", { cls: "chk", for: "why-rule" }, [rule, "Always apply title block scales (Settings rule)"]),
  ]);
  pop.addEventListener("click", (e) => e.stopPropagation());
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeWhyPop(); btn.focus(); } });
  document.body.append(pop);
  const r = btn.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left - 40, window.innerWidth - pr.width - 8)) + "px";
  pop.style.top = Math.max(8, r.top - pr.height - 6) + "px";
  btn.setAttribute("aria-expanded", "true");
  ap.focus();
}
document.addEventListener("click", () => closeWhyPop());
// The page scale a title block's scale note gives ({in_per_pt, text} from read_title_block).
function titleScaleEntry(sc) {
  const std = C.nearest_standard(sc.in_per_pt, 1e-6);
  return { in_per_pt: sc.in_per_pt, label: std ? std.label : sc.text, source: "titleblock" };
}
// Set title block scales on pages, into the model copy n of a commit.
function putTitleScales(n, sets) {
  n.pages = Object.assign({}, n.pages);
  for (const [p, sc] of sets) n.pages[String(p)] = Object.assign({}, n.pages[String(p)] || {}, { scale: titleScaleEntry(sc) });
}
function applyTitleScale(pages, label) {
  const sets = pages.map((p) => [p, S.titleBlocks[p] && S.titleBlocks[p].scale]).filter((x) => x[1]);
  if (!sets.length) return 0;
  commit(label, (n) => putTitleScales(n, sets));
  return sets.length;
}
async function readAllTitleBlocks(progress, cancelled) {
  const n = S.doc.numPages;
  for (let p = 0; p < n; p++) {
    if (cancelled && cancelled()) break;
    try { await readTitleBlock(p); } catch (e) { S.titleBlocks[p] = { sheet_number: "", sheet_title: "", scale: null, scales: [], why: ["no text on this page"] }; }
    if (progress) progress(p + 1, n);
    if (p % 8 === 7) await nextFrame();
  }
}
function applySheetIndex(scales, only) {
  const n = S.doc.numPages;
  let labels = 0, sc = 0;
  commit("Build sheet index from title blocks", (m) => {
    m.pages = Object.assign({}, m.pages);
    for (let p = 0; p < n; p++) {
      const tb = S.titleBlocks[p];
      if (!tb || (only && !only.has(p))) continue;
      const e = Object.assign({}, m.pages[String(p)] || {});
      if (tb.sheet_number) { e.label = tb.sheet_number; labels++; }
      if (tb.sheet_title) e.title = tb.sheet_title.slice(0, 200);
      if (scales && tb.scale && !e.scale) {
        const std = C.nearest_standard(tb.scale.in_per_pt, 1e-6);
        e.scale = { in_per_pt: tb.scale.in_per_pt, label: std ? std.label : tb.scale.text, source: "titleblock" };
        sc++;
      }
      m.pages[String(p)] = e;
    }
  });
  return { labels, scales: sc };
}

// ---------------------------------------------------------------- calibrate
function openCalibrate(a, b) {
  const distPts = C.dist(a, b);
  const known = input({ id: "cal-known", placeholder: "10'-0\"", inputmode: "decimal" });
  const unitSel = select([["ftin", "Feet and inches"], ["ft", "Decimal feet"], ["in", "Inches"], ["m", "Meters"], ["mm", "Millimeters"], ["cm", "Centimeters"], ["yd", "Yards"]], model().settings.length_unit, { id: "cal-unit" });
  let applyTo = "this";
  const seg = el("span", { cls: "seg", role: "group", "aria-label": "Apply to", id: "cal-apply" });
  for (const [v, l] of [["this", "This sheet"], ["all", "All"], ["unscaled", "Unscaled"]]) {
    const b = el("button", { type: "button", id: "cal-apply-" + v, "aria-pressed": v === applyTo ? "true" : "false", text: l });
    b.addEventListener("click", () => { applyTo = v; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); });
    seg.append(b);
  }
  const out = el("span", { id: "cal-result", text: "Type the real length between the two points." });
  const tb = S.titleBlocks[S.view.page];
  let ipp = null;
  const update = () => {
    try {
      const inches = C.parse_length(known.value, unitSel.value === "ftin" ? "ft" : unitSel.value);
      ipp = C.calibrate(a, b, inches);
      const std = C.nearest_standard(ipp, 0.01);
      let s = "Scale 1:" + C.format_number(C.ratio_of(ipp), 2) + (std ? ", within 1% of " + std.label : ", not a standard scale") + ".";
      if (tb && tb.scale && Math.abs(tb.scale.in_per_pt / ipp - 1) > 0.01) s += " The title block says " + tb.scale.text + " (1:" + C.format_number(C.ratio_of(tb.scale.in_per_pt), 0) + "). This set may be printed reduced: keep the calibration.";
      out.textContent = s;
    } catch (e) { ipp = null; out.textContent = e.message; }
  };
  known.addEventListener("input", update);
  unitSel.addEventListener("change", update);
  const done = () => {
    if (!ipp) { out.textContent = "Type a length first, such as 10'-0\" or 3.5 m."; return true; }
    const pages = applyTo === "this" ? [S.view.page] : Array.from({ length: S.doc.numPages }, (_, i) => i).filter((p) => applyTo === "all" || !pageScale(p) || p === S.view.page);
    const std = C.nearest_standard(ipp, 1e-6);
    const scale = { in_per_pt: ipp, label: std ? std.label : "1:" + C.format_number(C.ratio_of(ipp), 2), source: "calibrated" };
    commit("Calibrate", (n) => {
      n.pages = Object.assign({}, n.pages);
      for (const p of pages) n.pages[String(p)] = Object.assign({}, n.pages[String(p)] || {}, { scale });
      if (unitSel.value !== n.settings.length_unit) n.settings = Object.assign({}, n.settings, { length_unit: unitSel.value, area_unit: C.AREA_FOR[unitSel.value], volume_unit: C.VOLUME_FOR[unitSel.value] });
    });
    status("Calibrated " + pages.length + " page" + (pages.length === 1 ? "" : "s") + " at 1:" + C.format_number(C.ratio_of(ipp), 2) + ".");
    setTool("select");
    return false;
  };
  // The two picked points: ink squares on paper rings over a dashed cobalt line.
  const pick = svg("svg", { viewBox: "0 0 150 40", "aria-hidden": "true" }, [
    svg("path", { d: "M10 24H140", class: "cp-under", "stroke-width": 4 }),
    svg("path", { d: "M10 24H140", class: "cp-line", "stroke-width": 1.6, "stroke-dasharray": "4 2" }),
    svg("path", { d: "M5 19h10v10H5zM135 19h10v10h-10z", class: "cp-under", fill: "none", "stroke-width": 3.5 }),
    svg("path", { d: "M5 19h10v10H5zM135 19h10v10h-10z", class: "cp-pt", "stroke-width": 1.4 }),
  ]);
  const lab = svg("text", { x: 75, y: 14, "text-anchor": "middle" });
  lab.textContent = C.format_number(distPts / 72, 3) + " in on paper";
  pick.append(lab);
  openDialog({ title: "Calibrate", icon: "calibrate", body: el("div", { cls: "stack" }, [
    el("div", { cls: "cal-pick" }, [pick, el("span", { cls: "help", text: "Two points picked on " + sheetLabel(S.view.page) + ", " + C.format_number(distPts / 72, 3) + " in apart on paper. Pick a long dimension for the best accuracy." })]),
    el("div", { cls: "field cal-big" }, [el("label", { for: "cal-known", text: "Known length" }), known]), field("Units", unitSel),
    el("div", { cls: "field" }, [el("span", { cls: "lbl", text: "Apply to" }), seg]),
    el("div", { cls: "why" }, [el("b", { text: "Result" }), out])]),
  enter: () => { if (done() !== true) closeDialog(); },
  note: "Enter to apply, Esc to cancel",
  actions: [{ label: "Cancel", onClick: () => setTool("select") }, { label: "Calibrate", primary: true, id: "cal-ok", onClick: done }] });
}
