// ---------------------------------------------------------------- left panel: pages, sheets, search
// Thumbnails are a virtual list: only the slots near the visible part of the pane exist, so a set
// of thousands of sheets costs the same as a set of ten. Each slot draws from memory, the device
// cache, or the renderer, in that order.
const thumbQueue = [];
let thumbBusy = false;
const thumbWin = { slot: 0, first: -1, last: -1, raf: 0 };
const THUMB_GAP = 10;
function makeThumb(p) {
  const b = el("button", { type: "button", cls: "thumb", id: "thumb-" + p, "data-page": p, "aria-label": "Page " + (p + 1) }, [
    el("div", { cls: "tcanvas" }),
    el("div", { cls: "tl" }, [el("span", { cls: "no", text: String(p + 1) }), el("span", { cls: "t", text: "" }), el("span", { cls: "mk", title: "Markups", text: "" })]),
  ]);
  b.addEventListener("click", () => { if (isTouch()) closeDrawers(); goToPage(p); });
  return b;
}
function buildThumbs() {
  const box = clear($("thumbs"));
  thumbQueue.length = 0;
  thumbWin.slot = 0; thumbWin.first = thumbWin.last = -1;
  if (!S.doc) return;
  box.classList.add("virtual");
  drawThumbWindow();
  markCurrentThumb();
}
function drawThumbWindow() {
  thumbWin.raf = 0;
  const pane = $("pane-pages"), box = $("thumbs");
  if (!S.doc || !pane) return;
  const n = S.doc.numPages;
  if (!thumbWin.slot) {
    const probe = makeThumb(0);
    probe.style.visibility = "hidden";
    box.append(probe);
    const h = probe.offsetHeight;
    probe.remove();
    if (h < 20) { // the pane is not shown: lay out the first few so they exist, measure later
      if (!box.children.length) for (let p = 0; p < Math.min(n, 12); p++) { const b = makeThumb(p); b.style.top = p * 170 + "px"; box.append(b); }
      box.style.height = n * 170 + "px";
      refreshThumbLabels();
      return;
    }
    thumbWin.slot = h + THUMB_GAP;
    clear(box);
    thumbWin.first = thumbWin.last = -1;
  }
  const slot = thumbWin.slot;
  box.style.height = Math.max(0, n * slot - THUMB_GAP) + "px";
  const top = Math.max(0, pane.scrollTop - box.offsetTop), h = pane.clientHeight || 600;
  const first = Math.max(0, Math.floor(top / slot) - 3), last = Math.min(n - 1, Math.ceil((top + h) / slot) + 3);
  if (first === thumbWin.first && last === thumbWin.last) return;
  for (const b of Array.from(box.children)) {
    const p = Number(b.dataset.page);
    if (p < first || p > last) { b.remove(); const i = thumbQueue.indexOf(p); if (i >= 0) thumbQueue.splice(i, 1); }
  }
  for (let p = first; p <= last; p++) {
    if ($("thumb-" + p)) continue;
    const b = makeThumb(p);
    b.style.top = p * slot + "px";
    box.append(b);
    if (!thumbQueue.includes(p)) thumbQueue.push(p);
  }
  thumbWin.first = first; thumbWin.last = last;
  refreshThumbLabels();
  const cur = $("thumb-" + S.view.page);
  if (cur) cur.setAttribute("aria-current", "true");
  pumpThumbs();
}
function scheduleThumbWindow() { if (!thumbWin.raf) thumbWin.raf = requestAnimationFrame(drawThumbWindow); }
async function pumpThumbs() {
  if (thumbBusy || !S.doc) return;
  thumbBusy = true;
  const doc = S.doc;
  while (thumbQueue.length && S.doc === doc) {
    const p = thumbQueue.shift();
    const b = $("thumb-" + p);
    if (!b || b.dataset.drawn) continue;
    try {
      // from memory or the device cache when this set was opened before, else drawn
      let cv = null;
      const stored = await storedThumb(p);
      if (stored) {
        cv = document.createElement("canvas");
        cv.width = stored.width; cv.height = stored.height;
        cv.getContext("2d").drawImage(stored, 0, 0);
      } else {
        const info = await pageInfo(p);
        const scale = 220 / Math.max(info.w, info.h);
        if (rw.opening) await rw.opening;
        const img = await renderPicture(p, scale, 0, 0, info.w * scale, info.h * scale).promise;
        if (img instanceof HTMLCanvasElement) cv = img;
        else { cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; cv.getContext("2d").drawImage(img, 0, 0); if (img.close) img.close(); }
        if (S.doc === doc) keepThumb(p, cv);
      }
      if (S.doc !== doc) break;
      const holder = b.querySelector(".tcanvas");
      clear(holder).append(cv);
      b.dataset.drawn = "1";
    } catch (e) { /* skip a page that will not draw */ }
    await nextFrame();
  }
  thumbBusy = false;
}
function refreshThumbLabels() {
  if (!S.doc || !model()) return;
  for (const b of Array.from($("thumbs").children)) {
    const p = Number(b.dataset.page);
    const e = model().pages[String(p)] || {};
    const n = pageMarkups(p).length;
    b.querySelector(".no").textContent = e.label || String(p + 1);
    b.querySelector(".t").textContent = e.title || (e.label ? "Page " + (p + 1) : "");
    b.querySelector(".mk").textContent = n ? String(n) : "";
  }
}
function markCurrentThumb() {
  document.querySelectorAll(".thumb[aria-current]").forEach((t) => t.removeAttribute("aria-current"));
  if (!S.doc) return;
  const pane = $("pane-pages");
  if (S.ui.left === "pages" && pane && thumbWin.slot) {
    const y = $("thumbs").offsetTop + S.view.page * thumbWin.slot;
    if (y < pane.scrollTop || y + thumbWin.slot > pane.scrollTop + pane.clientHeight) pane.scrollTop = Math.max(0, y - thumbWin.slot);
  }
  drawThumbWindow();
  const b = $("thumb-" + S.view.page);
  if (b) b.setAttribute("aria-current", "true");
}
function isVisibleIn(elm, box) {
  const a = elm.getBoundingClientRect(), b = box.getBoundingClientRect();
  return a.top >= b.top && a.bottom <= b.bottom;
}

// Sheets: the index (sheet number, title, scale) with the title block reader.
function renderSheets() {
  const pane = clear($("pane-sheets"));
  if (!S.doc) return;
  const readBtn = el("button", { type: "button", cls: "btn", id: "sheets-read" }, [icon("auto"), "Read title blocks"]);
  const prog = el("div", { cls: "progress", hidden: true, style: "margin-top:8px" }, [el("div")]);
  const note = el("p", { cls: "help", id: "sheets-note", text: "Proposes sheet numbers, titles and scales with a reason for each. Nothing changes until you accept." });
  readBtn.addEventListener("click", async () => {
    readBtn.disabled = true; prog.hidden = false;
    await readAllTitleBlocks((n, t) => { prog.firstChild.style.width = (100 * n / t) + "%"; });
    prog.hidden = true; readBtn.disabled = false;
    showSheetIndexProposal();
  });
  const list = el("ul", { cls: "list", id: "sheet-list" });
  const rows = Math.min(S.doc.numPages, 5000);
  for (let p = 0; p < rows; p++) {
    const e = model().pages[String(p)] || {};
    const sc = e.scale;
    const btn = el("button", { type: "button", cls: "link", text: (e.label ? e.label + "  " : "") + (e.title || "Page " + (p + 1)), "aria-current": p === S.view.page ? "page" : null });
    btn.addEventListener("click", () => { if (isTouch()) closeDrawers(); goToPage(p); });
    const li = el("li", { cls: p === S.view.page ? "active" : "" }, [el("span", { cls: "no", text: e.label || String(p + 1) }), btn,
      el("span", { cls: "meta", style: sc ? "" : "color:var(--warn)", text: sc ? sc.label || "scaled" : "no scale" })]);
    list.append(li);
  }
  pane.append(list, el("div", { style: "margin-top:10px" }, [readBtn]), note, prog);
}
function showSheetIndexProposal() {
  const n = S.doc.numPages;
  const tbl = el("table", { cls: "grid" });
  tbl.append(el("thead", null, [el("tr", null, [el("th", null, [el("span", { cls: "sr-only", text: "Use" })]), el("th", { cls: "num", text: "Page" }), el("th", { text: "Sheet" }), el("th", { text: "Title" }), el("th", { text: "Scale" }), el("th", { text: "Why" })])]));
  const tb = el("tbody");
  let found = 0, scales = 0, read = 0;
  const use = new Set();
  for (let p = 0; p < n; p++) {
    const r = S.titleBlocks[p];
    if (!r) continue;
    read++;
    if (r.sheet_number) found++;
    if (r.scale) scales++;
    if (r.sheet_number || r.sheet_title || r.scale) use.add(p);
    if (p >= 400) continue;
    const cb = el("input", { type: "checkbox", id: "sheets-use-" + p, checked: use.has(p), "aria-label": "Use page " + (p + 1) });
    cb.addEventListener("change", () => { if (cb.checked) use.add(p); else use.delete(p); });
    const why = el("td", { cls: "why-c", text: r.why.join("; ") + "." });
    if (r.scale && r.scale.multiple) why.append(el("br"), el("span", { cls: "warn" }, [icon("review"), "More than one scale on this sheet: the title block scale is used. Check details at their own scale."]));
    if (!r.sheet_number && !r.scale) why.append(el("br"), el("span", { cls: "warn" }, [icon("review"), "Nothing found: a scanned sheet, or no title block text."]));
    tb.append(el("tr", null, [el("td", null, [cb]), el("td", { cls: "num", text: String(p + 1) }), el("td", { cls: "m", style: "font-weight:600", text: r.sheet_number || "-" }),
      el("td", { text: r.sheet_title || "-" }), el("td", { cls: "m", text: r.scale ? r.scale.text : "-" }), why]));
  }
  tbl.append(tb);
  const useScales = el("input", { type: "checkbox", id: "sheets-use-scales", checked: true });
  openDialog({ title: "Sheet index from title blocks", icon: "sheets", src: read + " of " + n + " read", wide: true, cls: "auto", body: el("div", null, [
    el("div", { cls: "why small" }, [el("b", { text: "Why" }), el("span", { text: "Found sheet numbers on " + found + " of " + n + " pages and scale notes on " + scales + ", from the text in each title block. Each row says how it was read." + (n > 400 ? " The first 400 pages are shown." : "") })]),
    el("div", { cls: "tablewrap", style: "max-height:50vh;border-top:1px solid var(--hair)" }, [tbl]),
  ]), note: el("label", { cls: "chk note-l", for: "sheets-use-scales" }, [useScales, "Also set scales on sheets without one"]),
  actions: [{ label: "Cancel" }, { label: "Use these", primary: true, id: "sheets-apply", onClick: () => {
    const r = applySheetIndex(useScales.checked, use);
    status("Sheet index built: " + r.labels + " sheet numbers" + (useScales.checked ? ", " + r.scales + " scales" : "") + ". Ctrl+Z undoes it.");
    undoToast("Sheet index built: " + r.labels + " sheet numbers" + (useScales.checked ? ", " + r.scales + " scales" : "") + ".");
  } }] });
}

// Search: text in every page, with hits highlighted on the sheet.
async function runSearch(q) {
  const res = clear($("search-results"));
  const st = $("search-status");
  q = cleanName(q, 200);
  if (!q || !S.doc) { S.search = null; drawScreenLayer(); st.textContent = ""; return; }
  const needle = q.toLowerCase();
  S.search = { q, hits: [] };
  st.textContent = "Searching...";
  let count = 0;
  const token = {};
  S.searchToken = token;
  for (let p = 0; p < S.doc.numPages; p++) {
    if (S.searchToken !== token) return;
    let items;
    try { items = await pageText(p); } catch (e) { continue; }
    const lines = C.text_lines(items);
    for (const ln of lines) {
      const at = ln.str.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      count++;
      const hit = { page: p, x: ln.x, y: ln.y, w: ln.w, h: ln.h || 10 };
      S.search.hits.push(hit);
      if (count <= 500) {
        const b = el("button", { type: "button", cls: "link", text: ln.str.slice(Math.max(0, at - 30), at + needle.length + 40) });
        b.addEventListener("click", async () => { await goToPage(p); zoomTo([hit.x - 60, hit.y - 60, hit.x + hit.w + 60, hit.y + 40]); drawScreenLayer(); });
        res.append(el("li", null, [el("span", { cls: "chip", text: sheetLabel(p) }), b]));
      }
    }
    if (p % 10 === 9) { st.textContent = "Searching... page " + (p + 1) + " of " + S.doc.numPages; await nextFrame(); }
  }
  st.textContent = count ? count + " match" + (count === 1 ? "" : "es") + (count > 500 ? " (first 500 listed)" : "") : "No matches. Scanned drawings without a text layer cannot be searched.";
  drawScreenLayer();
}
$("pane-pages").addEventListener("scroll", scheduleThumbWindow, { passive: true });
if (typeof ResizeObserver === "function") new ResizeObserver(() => { if (S.doc) { const w = $("pane-pages").clientWidth; if (w !== thumbWin.width) { thumbWin.width = w; thumbWin.slot = 0; scheduleThumbWindow(); } } }).observe($("pane-pages"));
