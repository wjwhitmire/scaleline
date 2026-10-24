// ---------------------------------------------------------------- basics
const C = CORE;
const ICONS = /*ICONS*/;
const SVGNS = "http://www.w3.org/2000/svg";
const NAME = C.PRODUCT_NAME;
const $ = (id) => document.getElementById(id);

// Build an element. Text goes in with textContent only; attributes with setAttribute.
function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k === "cls") n.className = v;
      else if (k === "on") { for (const ev of Object.keys(v)) n.addEventListener(ev, v[ev]); }
      else if (k === "style") n.setAttribute("style", v);
      else if (k === "value") n.value = v;
      else if (k === "checked") n.checked = !!v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of kids || []) if (c !== null && c !== undefined && c !== false) n.append(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}
function svg(tag, attrs, kids) {
  const n = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k of Object.keys(attrs)) { const v = attrs[k]; if (v !== null && v !== undefined && v !== false) n.setAttribute(k, String(v)); }
  for (const c of kids || []) if (c) n.append(c);
  return n;
}
function icon(name, cls) {
  return svg("svg", { class: cls || "i", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    [svg("path", { d: ICONS[name] || "" })]);
}
// Colors come from the stylesheet's tokens only. A token is read once per theme.
const tokCache = new Map();
function tok(name) {
  const key = (document.documentElement.getAttribute("data-theme") || "") + name;
  if (!tokCache.has(key)) tokCache.set(key, getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim().toLowerCase());
  return tokCache.get(key);
}
const paper = () => tok("paper");
const paperInk = () => tok("paper-ink");
// Layouts: touch (1100 px and below, or a coarse pointer) and phone (600 px and below).
const touchMQ = window.matchMedia("(max-width: 1100px), (pointer: coarse)");
const phoneMQ = window.matchMedia("(max-width: 600px)");
const isTouch = () => touchMQ.matches;
const isPhone = () => phoneMQ.matches;
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
const debounce = (fn, ms) => { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let idSeq = 0;
function newId(prefix) { idSeq = (idSeq + 1) % 1e6; return (prefix || "m") + Date.now().toString(36) + idSeq.toString(36) + Math.floor(Math.random() * 1296).toString(36); }
function nowIso() { return new Date().toISOString().slice(0, 19) + "Z"; }
function cleanName(s, max) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").trim().slice(0, max || 120); }
function safeFileName(s) { return cleanName(s, 80).replace(/[\\/:*?"<>|]+/g, "-") || "file"; }
function money(cents) { return (cents < 0 ? "-$" : "$") + C.format_number(Math.abs(cents) / 100, 2); }
function fmtNum(x, p) { return x === null || x === undefined ? "" : C.format_number(x, p === undefined ? 2 : p); }

// Status line and toasts.
function status(msg, kind) {
  const s = $("sb-message");
  s.textContent = msg || "";
  s.className = kind ? "chip " + kind : "";
  emit("status", { msg: msg || "", kind });
}
// The ink toast: says what landed and offers Undo. It sits at the top of the sheet view.
let toastTimer = null;
function toast(msg, action, ic) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = el("div", { cls: "toast", role: "status" }, [icon(ic || "check"), el("span", { text: msg })]);
  if (action) t.append(el("button", { type: "button", id: "toast-action", text: action.label, on: { click: () => { t.remove(); action.run(); } } }));
  const x = el("button", { type: "button", cls: "x", "aria-label": "Dismiss" }, [icon("close")]);
  x.addEventListener("click", () => t.remove());
  t.append(x);
  // the toast sits over the sheet: keep its presses away from the sheet's drawing tools
  for (const ev of ["pointerdown", "pointerup", "mousedown", "dblclick", "wheel"]) t.addEventListener(ev, (e) => e.stopPropagation());
  ($("viewer") || document.body).append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), action ? 9000 : 4500);
}
// Undo for a step that just landed, from its toast.
function undoToast(msg) {
  const depth = S.hist.past.length;
  toast(msg, { label: "Undo", run: () => { if (S.hist.past.length === depth) undo(); } });
}

// Dialogs: our own modal (no alert, confirm or prompt).
let dialogOpen = null;
function openDialog(opts) {
  closeDialog();
  const back = el("div", { cls: "dialog-back" });
  const box = el("div", { cls: "dialog" + (opts.wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-labelledby": "dlg-title" });
  const close = el("button", { type: "button", cls: "iconbtn", id: "dlg-close", "aria-label": "Close" }, [icon("close")]);
  close.addEventListener("click", () => closeDialog(opts.onCancel));
  if (opts.cls) box.classList.add(...opts.cls.split(" "));
  box.append(el("header", null, [opts.icon ? icon(opts.icon) : null, el("h2", { id: "dlg-title", text: opts.title }), opts.src ? el("span", { cls: "src", text: opts.src }) : null, close]));
  const body = el("div", { cls: "body" });
  if (opts.body) body.append(opts.body);
  box.append(body);
  const foot = el("footer");
  if (opts.note) foot.append(typeof opts.note === "string" ? el("span", { cls: "note-l", text: opts.note }) : opts.note);
  for (const a of opts.actions || []) {
    const b = el("button", { type: "button", cls: "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : "") + (a.ghost ? " ghost" : ""), id: a.id || null, text: a.label });
    b.addEventListener("click", async () => { const keep = a.onClick ? await a.onClick() : false; if (keep !== true) closeDialog(); });
    foot.append(b);
  }
  if ((opts.actions || []).length || opts.note) box.append(foot);
  back.append(box);
  back.addEventListener("mousedown", (e) => { if (e.target === back) closeDialog(opts.onCancel); });
  back.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeDialog(opts.onCancel); }
    if (e.key === "Enter" && opts.enter && e.target.tagName !== "TEXTAREA") { e.preventDefault(); opts.enter(); }
  });
  document.body.append(back);
  dialogOpen = { back, prevFocus: document.activeElement };
  const first = box.querySelector("input, select, textarea, button.primary") || close;
  setTimeout(() => first.focus(), 0);
  return { box, body, foot };
}
function closeDialog(cb) {
  if (!dialogOpen) return;
  const d = dialogOpen;
  dialogOpen = null;
  d.back.remove();
  if (d.prevFocus && d.prevFocus.focus) try { d.prevFocus.focus(); } catch (e) { /* gone */ }
  if (typeof cb === "function") cb();
}
function field(label, input, id) {
  if (id) input.id = id;
  return el("div", { cls: "field" }, [el("label", { for: input.id, text: label }), input]);
}
function input(attrs) { return el("input", Object.assign({ type: "text" }, attrs)); }
function select(options, value, attrs) {
  const s = el("select", attrs);
  for (const o of options) {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    s.append(el("option", { value: v, text: label }));
  }
  if (value !== undefined && value !== null) s.value = value;
  return s;
}

// Saving files: the File System Access save picker where the browser has it, else a download.
async function saveFile(name, data, type, desc) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (window.showSaveFilePicker && !window.__noPicker) {
    try {
      const ext = "." + name.split(".").pop();
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc || ext, accept: { [type]: [ext] } }] });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      if (e && e.name === "AbortError") return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}
// Copy text: the clipboard in the click handler, else a selectable box.
function copyText(text, what) {
  const fallback = () => {
    const ta = el("textarea", { cls: "out", readonly: true, "aria-label": what || "Text to copy" });
    ta.value = text;
    openDialog({ title: "Copy " + (what || "text"), body: el("div", null, [el("p", { cls: "help", text: "Select all and copy." }), ta]), actions: [{ label: "Done", primary: true }] });
    setTimeout(() => { ta.focus(); ta.select(); }, 30);
  };
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) { fallback(); return; }
    navigator.clipboard.writeText(text).then(() => toast("Copied " + (what || "text") + ".")).catch(fallback);
  } catch (e) { fallback(); }
}
function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(r.error || new Error("Could not read the file"));
    r.readAsArrayBuffer(file);
  });
}
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("Could not read the file"));
    r.readAsText(file);
  });
}
async function sha256Hex(bytes) {
  try {
    const d = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    // No subtle crypto (an insecure context): fall back to a size and sample fingerprint.
    let h = 2166136261;
    const step = Math.max(1, Math.floor(bytes.length / 65536));
    for (let i = 0; i < bytes.length; i += step) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; }
    return ("f" + bytes.length.toString(16) + h.toString(16)).padEnd(64, "0").slice(0, 64);
  }
}
// Decompress (deflate, deflate-raw or gzip) while counting: stops as soon as the output passes cap
// bytes, so a small hostile input cannot expand into gigabytes in memory.
async function inflateCapped(bytes, format, cap) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    n += r.value.length;
    if (n > cap) { try { reader.cancel(); } catch (e) { /* stop */ } throw new Error("The data expands to more than " + Math.round(cap / 1048576) + " MB."); }
    parts.push(r.value);
  }
  const out = new Uint8Array(n);
  let k = 0;
  for (const part of parts) { out.set(part, k); k += part.length; }
  return out;
}
function b64ToBytes(b64) {
  const s = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
