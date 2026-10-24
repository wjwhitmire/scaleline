// Plan review: deterministic rule checks on a plan set, each finding tied to its evidence, with
// draft RFIs. The same results as src/plantakeoff/review.py (the rules and limits are written there).
const { plan_review, review_rfi_drafts, review_check_dimensions, parse_sheet_index, parse_schedule, sheet_key } = (() => {
  const INDEX_HEAD = /^(SHEET|DRAWING)S?\s+(INDEX|LIST)\b/i;
  const INDEX_ROW = /^([A-Z]{1,3}[-. ]?\d{1,3}(?:\.\d{1,3})?[A-Z]?)\s+(.{2,120})$/;
  const SCHED_HEAD = /\b(ROOM\s+FINISH|ROOM|FINISH)\s+SCHEDULE\b/i;
  const ROOM_NO = /^[A-Z]?\d{1,4}$/;
  const TAG_MARK = /^(D-?\d{1,3}[A-Z]?|[A-Z]?\d{1,4}[A-Z]?)$/;
  const DIM_LIKE = /^\s*\d[\d\s/]*(?:'|")/;
  const rnd = (x) => Math.floor(x + 0.5);
  const r6 = (x) => rnd(x * 1e6) / 1e6;
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const isInt = (v) => Number.isInteger(v);
  const clean = (s, cap) => (typeof s === "string" ? s : "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, cap === undefined ? 200 : cap);
  const sheetKey = (n) => (typeof n === "string" ? n.toUpperCase().replace(/[-. ]/g, "") : "");
  const titleKey = (t) => t.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

  function items(raw) {
    const out = [];
    for (const it of raw || []) {
      if (!it || typeof it !== "object" || typeof it.str !== "string") continue;
      if (!["x", "y", "w", "h"].every((k) => num(it[k]))) continue;
      const s = clean(it.str, 300);
      if (s) out.push({ str: s, x: it.x, y: it.y, w: Math.max(0, it.w), h: Math.max(0, it.h), v: it.vertical === true });
    }
    return out;
  }
  function rows(its) {
    const sorted = its.filter((i) => !i.v).sort((a, b) => a.y - b.y || a.x - b.x);
    const out = [];
    for (const it of sorted) {
      if (out.length && Math.abs(out[out.length - 1][0].y - it.y) <= Math.max(1.5, 0.3 * it.h)) out[out.length - 1].push(it);
      else out.push([it]);
    }
    for (const r of out) r.sort((a, b) => a.x - b.x);
    return out;
  }
  function parseSheetIndex(raw) {
    const rs = rows(items(raw));
    let head = null;
    for (const r of rs) if (INDEX_HEAD.test(r.map((c) => c.str).join(" "))) { head = r; break; }
    if (!head) return [];
    const hx = head[0].x, hy = head[0].y, hh = head[0].h;
    const out = [];
    let last = hy, misses = 0;
    for (const r of rs) {
      if (r[0].y <= hy) continue;
      if (r[0].y - last > 4 * Math.max(hh, r[0].h)) break;
      const line = r.filter((c) => c.x >= hx - 24).map((c) => c.str).join(" ");
      const m = INDEX_ROW.exec(line);
      if (m) { out.push({ number: m[1], title: clean(m[2], 120), y: r6(r[0].y) }); last = r[0].y; misses = 0; }
      else if (++misses >= 2) break;
    }
    return out;
  }
  function parseSchedule(raw) {
    const rs = rows(items(raw));
    let head = null;
    for (const r of rs) {
      const m = SCHED_HEAD.exec(r.map((c) => c.str).join(" "));
      if (m) { head = [r, m[1].toUpperCase().includes("FINISH") ? "finish" : "room"]; break; }
    }
    if (!head) return null;
    const hy = head[0][0].y, out = [];
    let last = hy;
    for (const r of rs) {
      if (r[0].y <= hy) continue;
      if (r[0].y - last > 5 * Math.max(head[0][0].h, r[0].h)) break;
      if (ROOM_NO.test(r[0].str) && r.length >= 2 && /[A-Za-z]{2}/.test(r[1].str)) { out.push({ number: r[0].str, name: clean(r[1].str, 80) }); last = r[0].y; }
    }
    return { kind: head[1], rows: out };
  }

  function dims(its, segs) {
    const hor = [];
    for (const s of segs || []) {
      if (!Array.isArray(s) || s.length < 4 || !s.slice(0, 4).every(num)) continue;
      if (Math.abs(s[1] - s[3]) <= 0.5 && Math.abs(s[2] - s[0]) >= 10) hor.push([Math.min(s[0], s[2]), Math.max(s[0], s[2]), (s[1] + s[3]) / 2]);
    }
    const out = [];
    for (const it of its) {
      if (it.v || !DIM_LIKE.test(it.str)) continue;
      let v;
      try { v = parse_length(it.str, "ft"); } catch (e) { continue; }
      if (v <= 0) continue;
      const cx = it.x + it.w / 2;
      let best = null;
      for (const [x0, x1, y] of hor) {
        if (!(x0 <= cx && cx <= x1)) continue;
        const d = y - it.y;
        if (d >= -it.h - 10 && d <= 10) { const k = Math.abs(d); if (best === null || k < best[0]) best = [k, x0, x1, y]; }
      }
      if (best) out.push({ value: v, text: it.str, x0: best[1], x1: best[2], y: best[3], cx });
    }
    return out;
  }
  function checkDimensions(raw, segs, ipp) {
    const ds = dims(items(raw), segs);
    const found = [];
    for (const d of ds) {
      const parts = ds.filter((e) => e !== d && Math.abs(e.y - d.y) >= 4 && Math.abs(e.y - d.y) <= 80 && e.x0 >= d.x0 - 1 && e.x1 <= d.x1 + 1);
      const byRow = new Map();
      for (const e of parts) { const k = rnd(e.y * 2); if (!byRow.has(k)) byRow.set(k, []); byRow.get(k).push(e); }
      for (const k of Array.from(byRow.keys()).sort((a, b) => a - b)) {
        const row = byRow.get(k).slice().sort((a, b) => a.x0 - b.x0);
        if (row.length < 2) continue;
        const span = d.x1 - d.x0;
        if (row.reduce((s, e) => s + (e.x1 - e.x0), 0) < 0.97 * span) continue;
        let overlap = false;
        for (let i = 0; i < row.length - 1; i++) if (row[i + 1].x0 < row[i].x1 - 1) overlap = true;
        if (overlap) continue;
        const total = row.reduce((s, e) => s + e.value, 0);
        if (Math.abs(total - d.value) > 0.5) {
          found.push({ rule: "dimension-sum", severity: "high", where: [r6(d.x0), r6(Math.min(...row.map((e) => e.y)) - 12), r6(d.x1), r6(d.y + 4)],
            message: "Dimension string does not add up: " + row.map((e) => e.text).join(" + ") + " = " + format_ftin(total, 16) + ", but the overall dimension reads " + d.text + ".",
            evidence: row.map((e) => ({ kind: "text", text: e.text })).concat([{ kind: "text", text: d.text }]),
            rfi: { subject: "Dimension string does not close",
              question: "The dimensions " + row.map((e) => e.text).join(", ") + " add up to " + format_ftin(total, 16) + " but the overall dimension is " + d.text + ". Please confirm the correct dimensions." } });
        }
      }
    }
    if (ipp) {
      const bad = [];
      for (const d of ds) {
        const drawn = (d.x1 - d.x0) * ipp;
        if (Math.abs(drawn - d.value) > Math.max(1, 0.02 * d.value)) bad.push([drawn / d.value, d, drawn]);
      }
      bad.sort((a, b) => a[0] - b[0]);
      const groups = [];
      for (const b of bad) {
        if (groups.length && Math.abs(b[0] - groups[groups.length - 1][0][0]) <= 0.02 * groups[groups.length - 1][0][0]) groups[groups.length - 1].push(b);
        else groups.push([b]);
      }
      for (const gr of groups) {
        if (gr.length >= 2) {
          found.push({ rule: "dimension-scale", severity: "high", where: null,
            message: gr.length + " dimensions measure " + String(rnd(gr[0][0] * 100) / 100) + " times their written value at the sheet scale. The scale set on this sheet may be wrong, or the view is not to scale.",
            evidence: gr.slice(0, 6).map(([, d, drawn]) => ({ kind: "text", text: d.text + " drawn " + format_ftin(drawn, 16) })), rfi: null });
        } else {
          const [, d, drawn] = gr[0];
          found.push({ rule: "dimension-scale", severity: "medium", where: [r6(d.x0), r6(d.y - 12), r6(d.x1), r6(d.y + 4)],
            message: "Dimension " + d.text + " is drawn " + format_ftin(drawn, 16) + " long at the sheet scale.",
            evidence: [{ kind: "text", text: d.text }],
            rfi: { subject: "Dimension does not match the drawing", question: "The dimension " + d.text + " scales to " + format_ftin(drawn, 16) + ". Please confirm which governs." } });
        }
      }
    }
    return found;
  }

  const overlap = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  function planReview(set) {
    if (!set || typeof set !== "object" || !Array.isArray(set.sheets)) throw new TakeoffError("input", "The plan set needs its sheets");
    const sheets = set.sheets.slice(0, 20000).filter((s) => s && typeof s === "object" && isInt(s.page));
    const findings = [], checked = [], notes = [];
    const add = (f, page, sheet) => findings.push(Object.assign({}, f, { page, sheet }));
    const label = (s) => clean(s.number, 40) || "page " + (s.page + 1);

    checked.push("duplicate-sheet");
    const by = new Map();
    for (const s of sheets) {
      const k = sheetKey(clean(s.number, 40));
      if (!k) continue;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(s);
    }
    for (const [, list] of by) {
      if (list.length < 2) continue;
      const pages = list.map((s) => String(s.page + 1)).join(", "), n = clean(list[0].number, 40);
      add({ rule: "duplicate-sheet", severity: "high", where: null, message: "Sheet number " + n + " is used on pages " + pages + ".",
        evidence: list.map((s) => ({ kind: "sheet", text: ("page " + (s.page + 1) + ": " + clean(s.number, 40) + " " + clean(s.title, 80)).trim() })),
        rfi: { subject: "Duplicate sheet number", question: "Sheet number " + n + " appears on more than one sheet (pages " + pages + "). Please confirm the correct numbering." } },
      list[1].page, label(list[1]));
    }
    let index = [], indexPage = null;
    for (const s of sheets) { const r = parseSheetIndex(s.items); if (r.length) { index = r; indexPage = s; break; } }
    if (index.length) {
      checked.push("index");
      const listed = new Map();
      for (const r of index) if (!listed.has(sheetKey(r.number))) listed.set(sheetKey(r.number), r);
      for (const r of index) {
        const k = sheetKey(r.number);
        if (!by.has(k)) {
          add({ rule: "index", severity: "medium", where: null, message: "The drawing index lists " + r.number + " " + r.title + ", but no sheet in the set has that number.",
            evidence: [{ kind: "text", text: r.number + " " + r.title }],
            rfi: { subject: "Sheet listed but missing", question: "The drawing index lists sheet " + r.number + " (" + r.title + "), which is not in the set. Please issue it or revise the index." } },
          indexPage.page, label(indexPage));
        } else {
          const s = by.get(k)[0], t = clean(s.title, 120);
          const a = titleKey(t), b = titleKey(r.title);
          if (t && a !== b && !b.includes(a) && !a.includes(b)) {
            add({ rule: "index", severity: "low", where: null, message: "Sheet " + r.number + ': the index says "' + r.title + '", the title block says "' + t + '".',
              evidence: [{ kind: "text", text: r.number + " " + r.title }, { kind: "sheet", text: t }], rfi: null }, s.page, label(s));
          }
        }
      }
      for (const [k, list] of by) {
        if (listed.has(k)) continue;
        const s = list[0];
        add({ rule: "index", severity: "low", where: null, message: "Sheet " + label(s) + " is not in the drawing index.",
          evidence: [{ kind: "sheet", text: (label(s) + " " + clean(s.title, 80)).trim() }], rfi: null }, s.page, label(s));
      }
    } else notes.push("No drawing index was found in the set's text, so the index check did not run.");

    checked.push("untagged-door");
    for (const s of sheets) {
      const doors = (s.doors || []).filter((d) => d && typeof d === "object" && Array.isArray(d.at) && d.at.length === 2 && d.at.every(num));
      const marks = items(s.items).filter((it) => TAG_MARK.test(it.str)).map((it) => [it.x + it.w / 2, it.y - it.h / 2]);
      const centers = (s.rooms || []).filter((r) => r && typeof r === "object" && Array.isArray(r.center) && r.center.length === 2 && r.center.every(num)).map((r) => r.center);
      const tagged = (d) => {
        if (clean(d.tag, 20)) return true;
        const reach = 2.5 * (num(d.width_pt) && d.width_pt > 0 ? d.width_pt : 36);
        return marks.some((m) => {
          const dd = Math.sqrt((m[0] - d.at[0]) ** 2 + (m[1] - d.at[1]) ** 2);
          return dd <= reach && centers.every((c) => dd < Math.sqrt((m[0] - c[0]) ** 2 + (m[1] - c[1]) ** 2));
        });
      };
      const bare = doors.filter((d) => !tagged(d));
      if (bare.length >= 3 && bare.length === doors.length) {
        const xs = bare.map((d) => d.at[0]), ys = bare.map((d) => d.at[1]);
        const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        add({ rule: "untagged-door", severity: "medium", where: [r6(box[0] - 12), r6(box[1] - 12), r6(box[2] + 12), r6(box[3] + 12)],
          message: "None of the " + bare.length + " doors on " + label(s) + " has a door tag.",
          evidence: bare.slice(0, 50).map((d) => ({ kind: "detection", ref: clean(d.id, 20), text: "door " + clean(d.id, 20) })),
          rfi: { subject: "Untagged doors", question: "The doors on sheet " + label(s) + " carry no door tags. Please provide door numbers and the door schedule, or confirm that none is required." } },
        s.page, label(s));
        continue;
      }
      for (const d of bare) {
        const at = d.at;
        add({ rule: "untagged-door", severity: "medium", where: [r6(at[0] - 12), r6(at[1] - 12), r6(at[0] + 12), r6(at[1] + 12)],
          message: "A door on " + label(s) + " has no door tag beside it.",
          evidence: [{ kind: "detection", ref: clean(d.id, 20), text: "door " + clean(d.id, 20) }],
          rfi: { subject: "Untagged door", question: "The door near the marked location on sheet " + label(s) + " has no tag. Please provide its door number and hardware set." } },
        s.page, label(s));
      }
    }
    const sched = [];
    for (const s of sheets) { const sc = parseSchedule(s.items); if (sc && sc.rows.length) sched.push([s, sc]); }
    const planRooms = [];
    for (const s of sheets) for (const r of s.rooms || []) if (r && typeof r === "object" && clean(r.number, 10)) planRooms.push([s, r]);
    if (sched.length) {
      checked.push("room-schedule");
      const rowsBy = new Map();
      for (const [s, sc] of sched) for (const r of sc.rows) if (!rowsBy.has(r.number.toUpperCase())) rowsBy.set(r.number.toUpperCase(), [s, r, sc.kind]);
      const seen = new Set();
      for (const [s, r] of planRooms) {
        const n = clean(r.number, 10).toUpperCase();
        seen.add(n);
        if (!rowsBy.has(n)) {
          const nm = clean(r.name, 60);
          add({ rule: "room-schedule", severity: "medium", where: null,
            message: ("Room " + n + " " + nm + " is on " + label(s) + " but not in the " + sched[0][1].kind + " schedule.").replace("  ", " "),
            evidence: [{ kind: "detection", ref: clean(r.id, 20), text: ("room " + n + " " + nm).trim() }],
            rfi: { subject: "Room missing from schedule", question: ("Room " + n + " " + nm + " on sheet " + label(s) + " is not in the schedule. Please provide its finishes.").replace("  ", " ") } },
          s.page, label(s));
        }
      }
      if (planRooms.length) {
        for (const [n, [s, r, kind]] of rowsBy) {
          if (seen.has(n)) continue;
          add({ rule: "room-schedule", severity: "low", where: null, message: "Room " + r.number + " " + r.name + " is in the " + kind + " schedule but on no plan read here.",
            evidence: [{ kind: "text", text: r.number + " " + r.name }], rfi: null }, s.page, label(s));
        }
      }
    } else notes.push("No room or finish schedule was found in the set's text, so the schedule check did not run.");

    checked.push("dimension-sum", "dimension-scale");
    for (const s of sheets) {
      let ipp = num(s.in_per_pt) && s.in_per_pt > 0 ? s.in_per_pt : null;
      if (s.viewports) ipp = null;
      for (const f of checkDimensions(s.items, s.segs, ipp)) add(f, s.page, label(s));
    }
    checked.push("scale-mismatch");
    for (const s of sheets) {
      const nf = parse_scale_text(clean(s.scale_text, 200)).filter((f) => f.in_per_pt);
      const ipp = num(s.in_per_pt) && s.in_per_pt > 0 ? s.in_per_pt : null;
      if (nf.length && ipp && Math.abs(nf[0].in_per_pt - ipp) > 0.01 * ipp) {
        add({ rule: "scale-mismatch", severity: "high", where: null, message: "The title block of " + label(s) + " says " + nf[0].text + ", but the scale set on the sheet is different.",
          evidence: [{ kind: "text", text: nf[0].text }], rfi: null }, s.page, label(s));
      }
      const texts = items(s.items).filter((i) => i.str.toUpperCase().includes("SCALE")).map((i) => i.str).join(" | ");
      const vals = [];
      for (const f of parse_scale_text(texts)) if (f.in_per_pt && vals.every((v) => Math.abs(f.in_per_pt - v[0]) > 1e-9)) vals.push([f.in_per_pt, f.text]);
      if (vals.length >= 2 && !s.viewports) {
        add({ rule: "scale-mismatch", severity: "medium", where: null,
          message: label(s) + " has " + vals.length + " different scale notes (" + vals.map((v) => v[1]).join(", ") + ") and no viewports, so every measurement on it uses one scale.",
          evidence: vals.map((v) => ({ kind: "text", text: v[1] })), rfi: null }, s.page, label(s));
      }
    }
    let anyChanges = false;
    for (const s of sheets) {
      const changes = (s.changes || []).filter((c) => Array.isArray(c) && c.length === 4 && c.every(num));
      if (!changes.length) continue;
      anyChanges = true;
      const clouds = [];
      for (const m of s.clouds || []) {
        if (m && typeof m === "object" && Array.isArray(m.points) && m.points.length) {
          const xs = m.points.map((p) => p[0]), ys = m.points.map((p) => p[1]);
          if (xs.every(num) && ys.every(num)) clouds.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
        }
      }
      for (const c of changes) {
        if (clouds.some((b) => overlap(c, b))) continue;
        add({ rule: "revision-cloud", severity: "medium", where: c.map(r6), message: "A change between revisions on " + label(s) + " has no revision cloud.",
          evidence: [{ kind: "detection", text: "change found by compare" }],
          rfi: { subject: "Unmarked revision", question: "Sheet " + label(s) + " changed at the marked location without a revision cloud or delta. Please confirm the change is intended and issue it clouded." } },
        s.page, label(s));
      }
    }
    if (anyChanges) checked.push("revision-cloud");
    const rank = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.page - b.page || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
    findings.forEach((f, n) => { f.id = "f" + (n + 1); });
    return { findings, checked, notes };
  }
  function rfiDrafts(findings) {
    const out = [];
    for (const f of findings) {
      if (!f.rfi) continue;
      out.push({ id: "RFI-" + String(out.length + 1).padStart(3, "0"), finding: f.id, page: f.page, sheet: f.sheet, subject: f.rfi.subject, question: f.rfi.question });
    }
    return out;
  }
  return { plan_review: planReview, review_rfi_drafts: rfiDrafts, review_check_dimensions: checkDimensions, parse_sheet_index: parseSheetIndex, parse_schedule: parseSchedule, sheet_key: sheetKey };
})();
