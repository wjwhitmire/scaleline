// ---------------------------------------------------------------- sheet view: pan, zoom, render
// A base image of the whole page (at most about 2,400 px on its long side, cached for recent pages)
// and, when zoomed past it, tiles at screen resolution for the part on screen (27_tiles.js).
// Markups are SVG on top, in sheet points, so they stay sharp at any zoom.
const BASE_MAX = 2400;
const ZOOM_MIN = 0.02, ZOOM_MAX = 64;
const baseCache = new Map(); // page -> { canvas, scale }
let baseTask = null;
const viewer = () => $("viewer");

function vw() { return viewer().clientWidth; }
function vh() { return viewer().clientHeight; }
function dpr() { return Math.min(3, window.devicePixelRatio || 1); }
// View rotation (Ctrl+Shift+Plus and Minus): the sheet turns on screen in 90 degree steps, clockwise.
// Markups stay in sheet points; only the mapping to the screen turns. The rotated page box starts at
// the pan point, the same way pdf.js lays out a rotated viewport.
function curInfo() { return pageInfoNow(S.view.page) || { w: 1, h: 1 }; }
function viewDims(info) { const i = info || curInfo(); return (S.view.rot || 0) % 180 ? { w: i.h, h: i.w } : { w: i.w, h: i.h }; }
// The affine map from sheet points to the rotated page frame (no zoom or pan): [a, b, c, d, e, f].
function rotMatrix(info) {
  const i = info || curInfo();
  switch (S.view.rot || 0) {
    case 90: return [0, 1, -1, 0, i.h, 0];
    case 180: return [-1, 0, 0, -1, i.w, i.h];
    case 270: return [0, -1, 1, 0, 0, i.w];
    default: return [1, 0, 0, 1, 0, 0];
  }
}
// Sheet points to screen pixels: zoom and pan after the rotation.
function viewMatrix() {
  const r = rotMatrix(), z = S.view.zoom;
  return [r[0] * z, r[1] * z, r[2] * z, r[3] * z, r[4] * z + S.view.panX, r[5] * z + S.view.panY];
}
function matrixAttr(m) { return "matrix(" + m.map((v) => +v.toFixed(6)).join(" ") + ")"; }
function pageToScreen(x, y) { const m = viewMatrix(); return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
function screenToPage(sx, sy) {
  const m = viewMatrix(), det = m[0] * m[3] - m[1] * m[2];
  const dx = sx - m[4], dy = sy - m[5];
  return [(m[3] * dx - m[2] * dy) / det, (m[0] * dy - m[1] * dx) / det];
}
// A box in sheet points as a screen rectangle [x0, y0, x1, y1] (any rotation).
function screenRect(b) {
  const pts = [pageToScreen(b[0], b[1]), pageToScreen(b[2], b[1]), pageToScreen(b[2], b[3]), pageToScreen(b[0], b[3])];
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
function clientToPage(e) {
  const r = viewer().getBoundingClientRect();
  return screenToPage(e.clientX - r.left, e.clientY - r.top);
}
function setViewRotation(deg) {
  if (!S.doc) return;
  const c = screenToPage(vw() / 2, vh() / 2);
  S.view.rot = ((deg % 360) + 360) % 360;
  centerOn(c[0], c[1]);
  overlayDirty = true;
  layoutView();
  emit("view");
  status(S.view.rot ? "View turned " + S.view.rot + " degrees clockwise. Markups and measurements are unchanged." : "View back to the sheet as drawn.");
}
function rotateView(step) { if (S.doc) { if (compareShowing() && S.view.rot === 0) { status("Close the compare overlay to turn the view.", "warn"); return; } setViewRotation((S.view.rot || 0) + step); } }

async function goToPage(p, opts) {
  if (!S.doc) return;
  p = Math.max(0, Math.min(S.doc.numPages - 1, p));
  const changed = p !== S.view.page || (opts && opts.force);
  S.view.page = p;
  if (changed) { cancelDraft(); S.selection.clear(); emit("selection"); }
  const info = await pageInfo(p);
  if (p !== S.view.page) return;
  if (changed && !(opts && opts.keepView)) { if (isPhone()) fitWidth(true); else fitPage(true); }
  layoutView();
  renderBase(p);
  emit("view");
  releasePages(new Set([p, p - 1, p + 1]));
  afterPageShown(p, info);
}
function fitPage(silent) {
  if (!pageInfoNow(S.view.page)) return;
  const info = viewDims();
  const W = vw(), H = vh();
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min((W - 24) / info.w, (H - 24) / info.h)));
  S.view.zoom = z;
  S.view.panX = (W - info.w * z) / 2;
  S.view.panY = (H - info.h * z) / 2;
  if (!silent) viewChanged();
}
function fitWidth(silent) {
  if (!pageInfoNow(S.view.page)) return;
  const info = viewDims();
  const z = (vw() - 24) / info.w;
  S.view.zoom = z;
  S.view.panX = 12;
  S.view.panY = 12;
  if (silent !== true) viewChanged();
}
function actualSize() { zoomAt(1 / (S.view.zoom), vw() / 2, vh() / 2); }
function zoomAt(factor, sx, sy) {
  const z0 = S.view.zoom;
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z0 * factor));
  S.view.panX = sx - (sx - S.view.panX) * (z / z0);
  S.view.panY = sy - (sy - S.view.panY) * (z / z0);
  S.view.zoom = z;
  viewChanged();
}
function zoomTo(rectPage) {
  const [x0, y0, x1, y1] = rectPage;
  const turned = (S.view.rot || 0) % 180 !== 0;
  const w = Math.max(1, turned ? y1 - y0 : x1 - x0), h = Math.max(1, turned ? x1 - x0 : y1 - y0);
  S.view.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min((vw() - 40) / w, (vh() - 40) / h)));
  centerOn((x0 + x1) / 2, (y0 + y1) / 2);
}
function panBy(dx, dy) { S.view.panX += dx; S.view.panY += dy; viewChanged(); }
function centerOn(x, y) {
  const r = rotMatrix(), z = S.view.zoom;
  S.view.panX = vw() / 2 - (r[0] * x + r[2] * y + r[4]) * z;
  S.view.panY = vh() / 2 - (r[1] * x + r[3] * y + r[5]) * z;
  viewChanged();
}
let viewRaf = 0;
function viewChanged() {
  if (viewRaf) return;
  viewRaf = requestAnimationFrame(() => { viewRaf = 0; layoutView(); emit("view"); });
}

// Position the canvases for the current view and lay out the tiles it needs.
function layoutView() {
  const info = pageInfoNow(S.view.page);
  if (!info) return;
  const z = S.view.zoom;
  const dims = viewDims(info);
  const sh = $("page-shadow");
  sh.style.left = S.view.panX + "px"; sh.style.top = S.view.panY + "px";
  sh.style.width = dims.w * z + "px"; sh.style.height = dims.h * z + "px";
  const base = $("base-canvas");
  const b = baseCache.get(S.view.page);
  base.style.width = info.w * z + "px";
  base.style.height = info.h * z + "px";
  // The base image is drawn unturned; the view matrix turns, zooms and places it.
  const r = rotMatrix(info);
  base.style.transformOrigin = "0 0";
  base.style.transform = S.view.rot ? "matrix(" + [r[0], r[1], r[2], r[3], r[4] * z + S.view.panX, r[5] * z + S.view.panY].join(",") + ")" : "translate(" + S.view.panX + "px," + S.view.panY + "px)";
  const cmp = $("compare-canvas");
  if (!cmp.hidden) {
    cmp.style.width = info.w * z + "px"; cmp.style.height = info.h * z + "px";
    cmp.style.transformOrigin = "0 0";
    cmp.style.transform = base.style.transform;
  }
  // past the whole-page picture's resolution, tiles at the zoom in use cover what is on screen
  const need = !!b && z * dpr() > b.scale * 1.05;
  layoutTiles(need);
  base.style.visibility = base.dataset.page === String(S.view.page) ? "visible" : "hidden";
  layoutCompareSide();
  drawOverlay();
}
async function renderBase(p) {
  const base = $("base-canvas");
  const cached = baseCache.get(p);
  if (cached) { copyCanvas(cached.canvas, base); layoutView(); return; }
  if (baseTask) { try { baseTask.cancel(); } catch (e) { /* done */ } baseTask = null; }
  showBusy("Drawing sheet " + (p + 1) + "...");
  const t0 = performance.now();
  const docAt = S.doc;
  try {
    const info = await pageInfo(p);
    const scale = Math.min(4, BASE_MAX / Math.max(info.w, info.h));
    // first the thumbnail, stretched, so the sheet is there at once
    storedThumb(p).then((th) => {
      if (!th || S.view.page !== p || baseCache.has(p)) return;
      base.width = Math.round(info.w * scale); base.height = Math.round(info.h * scale);
      const ctx = base.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(th, 0, 0, base.width, base.height);
      base.dataset.page = String(p);
      S.lastPreviewMs = performance.now() - t0;
      layoutView();
    });
    if (rw.opening) await rw.opening;
    const task = renderPicture(p, scale, 0, 0, info.w * scale, info.h * scale);
    baseTask = task;
    const img = await task.promise;
    baseTask = null;
    let cv = img;
    if (!(img instanceof HTMLCanvasElement)) { cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; cv.getContext("2d", { alpha: false }).drawImage(img, 0, 0); if (img.close) img.close(); }
    S.lastRenderMs = performance.now() - t0;
    baseCache.set(p, { canvas: cv, scale });
    while (baseCache.size > 4) baseCache.delete(baseCache.keys().next().value);
    if (S.view.page === p) { copyCanvas(cv, base); layoutView(); }
  } catch (e) {
    // a drawing for a plan set that has since been replaced is not an error worth reporting
    if ((!e || e.name !== "RenderingCancelledException") && S.doc === docAt) status("Could not draw this page: " + cleanName(e && e.message, 100), "bad");
  } finally {
    showBusy("");
  }
  emit("view");
}
function copyCanvas(src, dst) {
  dst.width = src.width; dst.height = src.height;
  dst.getContext("2d").drawImage(src, 0, 0);
  dst.dataset.page = String(S.view.page);
}
function showBusy(msg) { const b = $("busy"); b.textContent = msg; b.hidden = !msg; }
function invalidateRenders() { baseCache.clear(); dropTiles(true); }

// ---------------------------------------------------------------- pointer, touch, pen and wheel
const pointers = new Map();
let gesture = null; // { kind: "pan" | "pinch" | "tool", ... }
let penSeen = false, spaceDown = false;

function initViewInput() {
  const v = viewer();
  v.addEventListener("contextmenu", (e) => e.preventDefault());
  v.addEventListener("pointerdown", (e) => {
    if (!S.doc) return;
    v.focus({ preventScroll: true });
    if (e.pointerType === "pen") penSeen = true;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try { v.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    const touches = Array.from(pointers.values()).filter((q) => q.type === "touch");
    if (touches.length >= 2) {
      if (gesture && gesture.kind === "tool") toolCancelPointer();
      const [a, b] = touches;
      gesture = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), z0: S.view.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, px: S.view.panX, py: S.view.panY };
      return;
    }
    const panButton = e.button === 1 || (e.button === 0 && (spaceDown || S.tool === "pan")) || (e.pointerType === "touch" && penSeen) || e.button === 2 && S.tool === "select";
    if (panButton) {
      gesture = { kind: "pan", x: e.clientX, y: e.clientY };
      v.classList.add("panning");
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    gesture = { kind: "tool" };
    toolPointer("down", e);
  });
  v.addEventListener("pointermove", (e) => {
    liveCursor(e);
    const p = pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (gesture && gesture.kind === "pinch") {
      const touches = Array.from(pointers.values()).filter((q) => q.type === "touch");
      if (touches.length >= 2) {
        const [a, b] = touches;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = v.getBoundingClientRect();
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, gesture.z0 * d / Math.max(1, gesture.d0)));
        const k = z / gesture.z0;
        S.view.zoom = z;
        S.view.panX = (cx - r.left) - (gesture.cx - r.left - gesture.px) * k;
        S.view.panY = (cy - r.top) - (gesture.cy - r.top - gesture.py) * k;
        viewChanged();
      }
      return;
    }
    if (gesture && gesture.kind === "pan") {
      panBy(e.clientX - gesture.x, e.clientY - gesture.y);
      gesture.x = e.clientX; gesture.y = e.clientY;
      return;
    }
    toolPointer("move", e);
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (gesture && gesture.kind === "pinch") { if (pointers.size === 0) gesture = null; return; }
    if (gesture && gesture.kind === "pan") { gesture = null; v.classList.remove("panning"); return; }
    if (gesture && gesture.kind === "tool") { gesture = null; if (e.type === "pointerup") toolPointer("up", e); else toolCancelPointer(); }
  };
  v.addEventListener("pointerup", end);
  v.addEventListener("pointercancel", end);
  v.addEventListener("dblclick", (e) => { if (S.doc) toolPointer("dblclick", e); });
  v.addEventListener("wheel", (e) => {
    if (!S.doc) return;
    e.preventDefault();
    const r = v.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh() : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    // Pinch on a trackpad arrives as a wheel event with Ctrl; two finger scrolls carry small or
    // sideways deltas. A mouse wheel zooms (or scrolls when set so in Settings).
    const trackpadScroll = !e.ctrlKey && (dx !== 0 || (e.deltaMode === 0 && Math.abs(dy) < 40 && dy % 1 !== 0));
    if (e.ctrlKey || (!trackpadScroll && S.settings.wheel === "zoom" && !e.shiftKey)) {
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
    } else if (e.shiftKey && !dx) panBy(-dy, 0);
    else panBy(-dx, -dy);
  }, { passive: false });
  window.addEventListener("resize", debounce(() => { if (S.doc) { layoutView(); emit("view"); } }, 100));
  window.addEventListener("keydown", (e) => { if (e.code === "Space" && !isTyping(e)) { spaceDown = true; } });
  window.addEventListener("keyup", (e) => { if (e.code === "Space") spaceDown = false; });
  window.addEventListener("blur", () => { spaceDown = false; });
}
function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
