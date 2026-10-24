// ---------------------------------------------------------------- the PDF worker
// Reading markups from a PDF's annotations and writing them back both load the whole PDF with the
// PDF library (pdf-lib), which unpacks every object stream on load. That runs here in a worker, not
// on the page: before loading, every object stream is found in the raw bytes and unpacked with a
// byte limit (core: objstm_scan, objstm_check), so a compression bomb or a stream that claims
// millions of objects is refused with a plain message; a worker that still runs out of memory, or
// takes longer than two minutes, is stopped and the page carries on.
// The functions below run inside the worker (they are sent to it as source); none of them touches
// the page.
// A PDF object as plain values: names as "/Name", numbers, text, arrays and dictionaries. References
// are followed (to a depth); streams, parents, appearances and popups are left out.
const PLAIN_SKIP = new Set(["P", "Parent", "AP", "Popup", "IRT", "Kids", "Resources", "Contents_Stream"]);
function pdfPlain(lib, ctx, obj, depth, budget) {
  if (obj === undefined || obj === null || depth > 8 || budget.n-- <= 0) return null;
  if (obj instanceof lib.PDFRef) return pdfPlain(lib, ctx, ctx.lookup(obj), depth + 1, budget);
  if (obj instanceof lib.PDFName) return "/" + obj.decodeText();
  if (obj instanceof lib.PDFNumber) return obj.asNumber();
  if (obj instanceof lib.PDFString || obj instanceof lib.PDFHexString) return Array.from(obj.decodeText()).slice(0, 100000).join("");
  if (obj instanceof lib.PDFBool) return obj.asBoolean();
  if (obj instanceof lib.PDFArray) {
    const out = [];
    for (let i = 0; i < Math.min(obj.size(), 40000); i++) out.push(pdfPlain(lib, ctx, obj.get(i), depth + 1, budget));
    return out;
  }
  if (obj instanceof lib.PDFDict) {
    const o = {};
    for (const [k, v] of obj.entries()) {
      const key = k.decodeText();
      if (PLAIN_SKIP.has(key) || C.RESERVED_IDS.includes(key)) continue;
      o[key] = pdfPlain(lib, ctx, v, depth + 1, budget);
    }
    return o;
  }
  return null;
}

// Every page's annotations and viewports, read into markups (nothing is added yet).
async function wkRead(lib, C, msg) {
  const doc = await lib.PDFDocument.load(msg.bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const pages = doc.getPages();
  const out = { pages: [], markups: [], skipped: 0, scales: new Map(), viewports: new Map(), annots: 0 };
  for (let p = 0; p < pages.length && p < msg.transforms.length; p++) {
    const node = pages[p].node;
    const arr = node.Annots();
    const vpArr = node.lookup(lib.PDFName.of("VP"));
    if ((!arr || !arr.size()) && !vpArr) continue;
    const ctx = { transform: msg.transforms[p] };
    const budget = { n: 400000 };
    const plain = [];
    if (arr) for (let i = 0; i < Math.min(arr.size(), 20000); i++) {
      const d = pdfPlain(lib, doc.context, arr.get(i), 0, budget);
      const a = C.plain_annot(d);
      if (a) plain.push(a);
    }
    out.annots += plain.length;
    const r = C.annots_to_markups(plain, ctx, p);
    out.markups.push(...r.markups);
    out.skipped += r.skipped;
    if (r.scale) out.scales.set(p, r.scale);
    if (vpArr instanceof lib.PDFArray) {
      const vps = [];
      for (let i = 0; i < Math.min(vpArr.size(), 50); i++) {
        const d = pdfPlain(lib, doc.context, vpArr.get(i), 0, budget);
        if (!d || typeof d !== "object") continue;
        const meas = C.plain_annot({ Subtype: "/Square", Measure: d.Measure });
        const v = C.viewport_from_vp({ bbox: d.BBox, name: typeof d.Name === "string" ? d.Name : "", measure: meas && meas.measure }, ctx, i);
        if (v) vps.push(v);
      }
      if (vps.length) out.viewports.set(p, vps);
    }
    if (r.markups.length || out.viewports.has(p)) out.pages.push(p);
  }
  return { pages: out.pages, markups: out.markups, skipped: out.skipped, annots: out.annots, scales: Array.from(out.scales), viewports: Array.from(out.viewports) };
}

async function wkWrite(lib, C, msg) {
  const doc = await lib.PDFDocument.load(msg.bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const opts = msg.opts;
  const cat = doc.catalog;
  // The copy never carries anything that runs: no open action, no document, page or annotation
  // triggers (/AA), no document scripts, and no script, launch or form submission actions on the
  // annotations it keeps (links to pages and web addresses stay).
  for (const k of ["OpenAction", "AA"]) try { cat.delete(lib.PDFName.of(k)); } catch (e) { /* none */ }
  try { const names = cat.lookup(lib.PDFName.of("Names")); if (names && names.delete) names.delete(lib.PDFName.of("JavaScript")); } catch (e) { /* none */ }
  const c = doc.context, N = (s) => lib.PDFName.of(s);
  const RUNS = new Set(["JavaScript", "Launch", "SubmitForm", "ImportData", "ResetForm", "Rendition", "Sound", "Movie", "RichMediaExecute", "GoToE", "GoToR"]);
  const actionRuns = (a, depth) => {
    if (!(a instanceof lib.PDFDict) || depth > 8) return false;
    const t = a.lookup(N("S"));
    if (t instanceof lib.PDFName && RUNS.has(t.decodeText())) return true;
    const next = a.lookup(N("Next"));
    if (next instanceof lib.PDFDict) return actionRuns(next, depth + 1);
    if (next instanceof lib.PDFArray) for (let i = 0; i < next.size(); i++) if (actionRuns(next.lookup(i), depth + 1)) return true;
    return false;
  };
  // form fields: their triggers and any XFA form (which carries its own scripts)
  try {
    const form = cat.lookup(N("AcroForm"));
    if (form instanceof lib.PDFDict) {
      form.delete(N("XFA"));
      let budget = 20000;
      const strip = (f, depth) => {
        if (!(f instanceof lib.PDFDict) || depth > 16 || budget-- <= 0) return;
        f.delete(N("AA"));
        if (actionRuns(f.lookup(N("A")), 0)) f.delete(N("A"));
        const kids = f.lookup(N("Kids"));
        if (kids instanceof lib.PDFArray) for (let i = 0; i < kids.size(); i++) strip(kids.lookup(i), depth + 1);
      };
      const fields = form.lookup(N("Fields"));
      if (fields instanceof lib.PDFArray) for (let i = 0; i < fields.size(); i++) strip(fields.lookup(i), 0);
    }
  } catch (e) { /* no form */ }
  const helv = c.obj({}); helv.set(N("Type"), N("Font")); helv.set(N("Subtype"), N("Type1")); helv.set(N("BaseFont"), N("Helvetica")); helv.set(N("Encoding"), N("WinAnsiEncoding"));
  const helvRef = c.register(helv);
  const pages = doc.getPages();
  const ours = new Set(msg.ours);
  const byPage = new Map(msg.pages.map((e) => [e.p, e]));
  let written = 0, annots = 0;
  for (let p = 0; p < pages.length; p++) {
    const entry = byPage.get(p);
    const list = entry ? entry.items : [];
    const vps = entry ? entry.vps : [];
    const node = pages[p].node;
    try { node.delete(N("AA")); } catch (e) { /* none */ }
    // drop what an earlier export of these markups left
    const old = node.Annots();
    const keep = [];
    if (old) for (let i = 0; i < old.size(); i++) {
      const ref = old.get(i), d = c.lookup(ref);
      if (d instanceof lib.PDFDict) {
        try { d.delete(N("AA")); if (actionRuns(d.lookup(N("A")), 0)) d.delete(N("A")); } catch (e) { /* leave it */ }
      }
      let mine = false;
      try {
        if (d instanceof lib.PDFDict) {
          const nm = d.lookup(N("NM"));
          const id = nm && (nm.decodeText ? nm.decodeText() : "");
          mine = !!d.get(N("FTMarkup")) || (id && (ours.has(id) || ours.has(id.replace(/\.\d+$/, ""))));
        }
      } catch (e) { mine = false; }
      if (!mine) keep.push(ref);
    }
    if (!list.length && !vps.length && keep.length === (old ? old.size() : 0)) continue;
    const inv = C.mat_inv(entry.transform);
    const toPdf = (q) => C.mat_apply(inv, q[0], q[1]);
    const up = C.mat_apply(inv, 1, 0), o = C.mat_apply(inv, 0, 0);
    const textAngle = Math.atan2(up[1] - o[1], up[0] - o[0]) * 180 / Math.PI;
    const refs = keep.slice();
    for (const it of list) {
      for (const [a, shapes] of it.annots) { refs.push(buildAnnot(lib, doc, pages[p].ref, a, shapes, toPdf, textAngle, helvRef)); annots++; }
      written++;
    }
    node.set(N("Annots"), c.obj(refs));
    // viewports as /VP entries (ISO 32000 12.9): a box and its measure
    if (vps.length) {
      const arr = vps.map((v) => {
        const a = toPdf([v.rect[0], v.rect[3]]), b = toPdf([v.rect[2], v.rect[1]]);
        const md = v.md;
        const nf = (l) => c.obj(l.map((x) => { const f = c.obj({}); f.set(N("Type"), N("NumberFormat")); f.set(N("U"), pdfText(lib, x.u)); f.set(N("C"), c.obj(x.c)); return f; }));
        const m = c.obj({}); m.set(N("Type"), N("Measure")); m.set(N("Subtype"), N("RL")); m.set(N("R"), pdfText(lib, md.r)); m.set(N("X"), nf(md.x)); m.set(N("D"), nf(md.d)); m.set(N("A"), nf(md.a));
        const d = c.obj({}); d.set(N("Type"), N("Viewport")); d.set(N("Name"), pdfText(lib, v.name));
        d.set(N("BBox"), c.obj([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])].map((x) => Math.round(x * 1000) / 1000)));
        d.set(N("Measure"), m);
        return d;
      });
      node.set(N("VP"), c.obj(arr));
    }
  }
  doc.setProducer(msg.name + " (Field Tools)");
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, written, annots };
}

function pdfText(lib, s) { return lib.PDFHexString.fromText(String(s)); }
function escPdfString(s) {
  let out = "";
  for (const ch of winAnsi(s)) {
    const c = ch.charCodeAt(0);
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (c < 32 || c > 126) out += "\\" + c.toString(8).padStart(3, "0");
    else out += ch;
  }
  return out;
}
const n3 = (x) => (Math.round(x * 1000) / 1000).toString();
// Content operators that draw the shapes (sheet points) in PDF user space.
function shapeOps(shapes, toPdf, textAngle, gs) {
  const ops = [];
  const gsName = (stroke, fill) => {
    const k = n3(stroke) + "/" + n3(fill);
    if (!gs.has(k)) gs.set(k, { name: "G" + gs.size, CA: stroke, ca: fill });
    return gs.get(k).name;
  };
  const rgb = (h) => hexRgb(h).map(n3).join(" ");
  for (const s of shapes) {
    if (s.kind === "poly") {
      const ring = (pts, closed) => pts.map((q, i) => { const r = toPdf(q); return n3(r[0]) + " " + n3(r[1]) + (i ? " l" : " m"); }).join("\n") + (closed ? "\nh" : "");
      let path = ring(s.pts, s.closed);
      for (const h of s.holes || []) path += "\n" + ring(h, true);
      if (s.fill) ops.push("q /" + gsName(1, s.fillOpacity === undefined ? 1 : s.fillOpacity) + " gs " + rgb(s.fill) + " rg\n" + path + "\nf* Q");
      if (s.width > 0) ops.push("q /" + gsName(s.opacity === undefined ? 1 : s.opacity, 1) + " gs " + rgb(s.stroke) + " RG " + n3(s.width) + " w 1 J 1 j\n" + path + "\nS Q");
    } else if (s.kind === "text") {
      const a = textAngle * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      s.lines.forEach((ln, i) => {
        const b = toPdf([s.x, s.y + s.size * (i + 1) * 1.2 - s.size * 0.2]);
        ops.push("BT /Helv " + n3(s.size) + " Tf " + rgb(s.color) + " rg " + [c, sn, -sn, c, b[0], b[1]].map(n3).join(" ") + " Tm (" + escPdfString(ln.slice(0, 500)) + ") Tj ET");
      });
    }
  }
  return ops.join("\n");
}
function shapesBounds(shapes, toPdf) {
  const pts = [];
  for (const s of shapes) {
    if (s.kind === "poly") { for (const q of s.pts) pts.push(toPdf(q)); continue; }
    const w = Math.max(...s.lines.map((l) => l.length)) * s.size * 0.6;
    const h = s.lines.length * s.size * 1.2;
    for (const q of [[s.x, s.y], [s.x + w, s.y], [s.x, s.y + h], [s.x + w, s.y + h]]) pts.push(toPdf(q));
  }
  return pts.length ? C.bbox(pts) : null;
}
const RECT_GEOMETRY = new Set(["Square", "Circle", "FreeText", "Stamp"]);
function buildAnnot(lib, doc, pageRef, a, shapes, toPdf, textAngle, helvRef) {
  const c = doc.context, N = (s) => lib.PDFName.of(s);
  let rect = a.rect.slice();
  if (!RECT_GEOMETRY.has(a.subtype)) {
    const b = shapesBounds(shapes, toPdf);
    if (b) rect = [Math.min(rect[0], b[0] - 2), Math.min(rect[1], b[1] - 2), Math.max(rect[2], b[2] + 2), Math.max(rect[3], b[3] + 2)].map((x) => Math.round(x * 1000) / 1000);
  }
  const d = c.obj({});
  d.set(N("Type"), N("Annot"));
  d.set(N("Subtype"), N(a.subtype));
  d.set(N("Rect"), c.obj(rect));
  d.set(N("F"), c.obj(4));
  d.set(N("P"), pageRef);
  if (a.it) d.set(N("IT"), N(a.it));
  for (const [k, key] of [["l", "L"], ["vertices", "Vertices"], ["quad", "QuadPoints"], ["cl", "CL"], ["rd", "RD"], ["color", "C"], ["interior", "IC"]]) if (Array.isArray(a[k])) d.set(N(key), c.obj(a[k]));
  if (Array.isArray(a.ink)) d.set(N("InkList"), c.obj(a.ink.map((s) => c.obj(s))));
  if (Array.isArray(a.le)) d.set(N("LE"), c.obj(a.le.map((x) => N(x))));
  for (const [k, key] of [["contents", "Contents"], ["subject", "Subj"], ["title", "T"], ["nm", "NM"], ["label", "Label"]]) if (a[k]) d.set(N(key), pdfText(lib, a[k]));
  for (const [k, key] of [["m", "M"], ["creation", "CreationDate"]]) if (a[k]) d.set(N(key), lib.PDFString.of(a[k]));
  if (typeof a.opacity === "number" && a.opacity < 1) d.set(N("CA"), c.obj(a.opacity));
  const bs = c.obj({}); bs.set(N("W"), c.obj(a.width || 1)); bs.set(N("S"), N("S"));
  d.set(N("BS"), bs);
  if (a.cloudy) { const be = c.obj({}); be.set(N("S"), N("C")); be.set(N("I"), c.obj(1)); d.set(N("BE"), be); }
  if (a.measure) {
    const nf = (list) => c.obj(list.map((x) => { const f = c.obj({}); f.set(N("Type"), N("NumberFormat")); f.set(N("U"), pdfText(lib, x.u)); f.set(N("C"), c.obj(x.c)); return f; }));
    const md = c.obj({});
    md.set(N("Type"), N("Measure")); md.set(N("Subtype"), N("RL")); md.set(N("R"), pdfText(lib, a.measure.r || ""));
    md.set(N("X"), nf(a.measure.x)); md.set(N("D"), nf(a.measure.d)); md.set(N("A"), nf(a.measure.a));
    d.set(N("Measure"), md);
  }
  if (a.private) d.set(N("FTMarkup"), pdfText(lib, JSON.stringify(a.private)));
  // the appearance: the same drawing the flattened PDF gets, in user space over the annotation box
  const gs = new Map();
  const ops = shapeOps(shapes, toPdf, textAngle, gs);
  const gsDict = c.obj({});
  for (const g of gs.values()) { const e = c.obj({}); e.set(N("Type"), N("ExtGState")); e.set(N("CA"), c.obj(g.CA)); e.set(N("ca"), c.obj(g.ca)); gsDict.set(N(g.name), e); }
  const fonts = c.obj({}); fonts.set(N("Helv"), helvRef);
  const res = c.obj({}); res.set(N("Font"), fonts); res.set(N("ExtGState"), gsDict);
  const ap = c.flateStream(ops, { Type: "XObject", Subtype: "Form", BBox: rect, Matrix: [1, 0, 0, 1, 0, 0] });
  ap.dict.set(N("Resources"), res);
  const apDict = c.obj({}); apDict.set(N("N"), c.register(ap));
  d.set(N("AP"), apDict);
  return c.register(d);
}
// A copy of the PDF with every markup written as a standard annotation. Annotations this app wrote
// before (they carry our markup ids) are replaced, other annotations are kept.

// Unpack each object stream with a byte limit before the library sees the file.
async function wkGuard(C, bytes) {
  const L = C.OBJSTM_LIMITS;
  const list = C.objstm_scan(bytes);
  const why = C.objstm_check(list);
  if (why) return why;
  let total = 0;
  const mb = (x) => (x / 1048576).toFixed(0) + " MB";
  for (const s of list) {
    if (s.filters.length > 2) return "An object stream in this PDF is packed " + s.filters.length + " times over; it is not read, to keep this page safe.";
    if (s.filters.length !== 1 || s.filters[0] !== "FlateDecode" || typeof DecompressionStream !== "function") { total += s.length; continue; }
    let got = 0, bomb = false;
    try {
      const rd = new Blob([bytes.subarray(s.start, s.start + s.length)]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        got += value.length;
        if (got > L.unpackedPerStream || (got > 16 * 1048576 && got > L.ratio * Math.max(1, s.length)) || total + got > L.unpacked) { bomb = true; try { await rd.cancel(); } catch (e) { /* stopped */ } break; }
      }
    } catch (e) { /* a damaged stream: the library reads what it can */ }
    if (bomb) return "An object stream in this PDF unpacks to more than " + mb(got) + " from " + Math.max(1, Math.round(s.length / 1024)) + " KB, which is how a compression bomb looks. The PDF's markups are not read, to keep this page safe.";
    total += got;
  }
  return null;
}
function wkHexRgb(h) { const n = h ? parseInt(String(h).slice(1), 16) : 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
const WK_PRELUDE = 'const C = CORE;\nconst PLAIN_SKIP = new Set(["P", "Parent", "AP", "Popup", "IRT", "Kids", "Resources", "Contents_Stream"]);\n' +
  'const RECT_GEOMETRY = new Set(["Square", "Circle", "FreeText", "Stamp"]);\nconst n3 = (x) => (Math.round(x * 1000) / 1000).toString();\nconst hexRgb = wkHexRgb;\n';
const WK_HANDLER = "\nself.onmessage = async (e) => { const m = e.data; try {" +
  " const why = await wkGuard(C, m.bytes); if (why) throw new Error(why);" +
  " const r = m.op === 'read' ? await wkRead(self.PDFLib, C, m) : await wkWrite(self.PDFLib, C, m);" +
  " self.postMessage({ id: m.id, ok: true, r }, r.bytes ? [r.bytes.buffer] : []);" +
  " } catch (err) { self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); } };";
const pdfw = { worker: null, seq: 0, pending: new Map() };
function pdfWorker() {
  if (pdfw.worker) return pdfw.worker;
  const fns = [wkGuard, wkHexRgb, pdfPlain, wkRead, wkWrite, pdfText, escPdfString, shapeOps, shapesBounds, buildAnnot, winAnsi].map(String).join("\n");
  const src = $("vendor-pdflib").textContent + "\n;\n" + $("core").textContent + "\n" + WK_PRELUDE + fns + WK_HANDLER;
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  w.onmessage = (e) => {
    const p = pdfw.pending.get(e.data.id);
    if (!p) return;
    pdfw.pending.delete(e.data.id);
    clearTimeout(p.timer);
    if (e.data.ok) p.resolve(e.data.r); else p.reject(new Error(e.data.error));
  };
  w.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); pdfStop("The PDF worker stopped, most likely out of memory: this PDF is too large or damaged to read its markups here."); };
  pdfw.worker = w;
  return w;
}
function pdfStop(msg) {
  if (pdfw.worker) pdfw.worker.terminate();
  pdfw.worker = null;
  for (const p of pdfw.pending.values()) { clearTimeout(p.timer); p.reject(new Error(msg)); }
  pdfw.pending.clear();
}
// Run one job in the worker. The bytes are handed over (pass a copy).
function pdfWork(op, msg) {
  return new Promise((resolve, reject) => {
    const id = ++pdfw.seq;
    const timer = setTimeout(() => pdfStop("Working on this PDF took longer than two minutes and was stopped."), 120000);
    pdfw.pending.set(id, { resolve, reject, timer });
    try { pdfWorker().postMessage(Object.assign({ op, id }, msg), [msg.bytes.buffer]); }
    catch (e) { clearTimeout(timer); pdfw.pending.delete(id); reject(e); }
  });
}
