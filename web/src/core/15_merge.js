// Merging two people's markup files without a server. Mirrors merge.py: each markup's version
// history (vers) says whether one side descends from the other; concurrent edits and edits of a
// deleted markup are conflicts settled by a choice ("mine", "theirs" or "both").
const SESSION_KEYS = ["vers", "rev", "modified", "modified_by", "comments", "status_log"];
function _mcur(m) { const v = m.vers || []; return v.length ? v[v.length - 1] : ""; }
function _deleted_covers(m, tomb) { const c = _mcur(m); return c ? tomb.vers.includes(c) : !tomb.vers.length; }
function _deq(a, b) {
  const na = typeof a === "number", nb = typeof b === "number";
  if (na || nb) return na && nb && a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => _deq(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && _deq(a[k], b[k]));
  }
  return a === b;
}
function _without(m, keys) { const o = {}; for (const k of Object.keys(m)) if (!keys.includes(k)) o[k] = m[k]; return o; }
function _msame(a, b) { return _deq(_without(a, SESSION_KEYS), _without(b, SESSION_KEYS)); }
function merge_comments(a, b) {
  const out = [], idx = new Map();
  for (const c of (a || []).concat(b || [])) {
    if (idx.has(c.id)) {
      let prev = out[idx.get(c.id)];
      if (c.deleted && !prev.deleted) prev = Object.assign({}, prev, { deleted: true, text: "" });
      if (c.resolved && !prev.resolved) prev = Object.assign({}, prev, { resolved: true });
      out[idx.get(c.id)] = prev;
      continue;
    }
    idx.set(c.id, out.length);
    out.push(Object.assign({}, c));
  }
  return out.slice(0, LIMITS.comments);
}
function merge_status_log(a, b) {
  const seen = new Set(), out = [];
  for (const e of (a || []).concat(b || [])) {
    const k = JSON.stringify([e.at || "", e.by || "", e.status || ""]);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(Object.assign({}, e));
  }
  out.sort((x, y) => cmpStr(x.at || "", y.at || "") || cmpStr(x.by || "", y.by || "") || cmpStr(x.status || "", y.status || ""));
  return out.slice(-LIMITS.status_log);
}
function _with_threads(win, other) {
  const out = Object.assign({}, win);
  const cm = merge_comments(win.comments, other.comments);
  if (cm.length) out.comments = cm;
  const sl = merge_status_log(win.status_log, other.status_log);
  if (sl.length) out.status_log = sl;
  const own = (win.vers || []).slice();
  const vers = (other.vers || []).filter((v) => !own.includes(v)).concat(own);
  if (vers.length) out.vers = vers.slice(-LIMITS.versions);
  return out;
}
function _vers_union(win, other) {
  const own = win.vers || [];
  return (other.vers || []).filter((v) => !own.includes(v)).concat(own).slice(-LIMITS.versions);
}
function _both_id(mid, taken) {
  for (let n = 2; n < 1000; n++) { const cand = mid.slice(0, 58) + "." + n; if (!taken.has(cand)) return cand; }
  return mid.slice(0, 50) + ".x" + taken.size;
}
// The version mark a markup carries once its owner kept it against a teammate's deletion.
function _kept_mark(tomb) {
  const v = tomb.vers || [];
  return ("kept:" + (v.length ? v[v.length - 1] : tomb.id)).slice(0, 64);
}
function merge_markups(mine, theirs, mine_tombs, theirs_tombs, choices) {
  choices = choices || {};
  const mt = new Map((mine_tombs || []).map((t) => [t.id, t]));
  const tt = new Map((theirs_tombs || []).map((t) => [t.id, t]));
  const byT = new Map(theirs.map((m) => [m.id, m]));
  const out = [], conflicts = [];
  const report = { added: 0, updated: 0, kept: 0, removed: 0, conflicts: 0, resolved: 0 };
  const taken = new Set(mine.map((m) => m.id).concat(Array.from(byT.keys())));
  const tombs = new Map((mine_tombs || []).map((t) => [t.id, t]));
  const settle = (cid, kind, a, b) => {
    const ch = has(choices, cid) ? choices[cid] : null;
    if (ch === null || ch === undefined) {
      conflicts.push({ id: cid, kind, mine: a, theirs: b });
      report.conflicts += 1;
      return a !== null ? [a] : [];
    }
    report.resolved += 1;
    if (ch === "theirs") {
      if (b === null) { tombs.set(cid, tt.get(cid)); return []; }
      tombs.delete(cid);
      return [a !== null ? _with_threads(b, a) : b];
    }
    if (ch === "both" && a !== null && b !== null) {
      const nid = _both_id(cid, taken);
      taken.add(nid);
      // mine keeps its id and learns their version, so the same file does not ask again
      return [Object.assign({}, a, { vers: _vers_union(a, b) }), Object.assign({}, b, { id: nid })];
    }
    if (a === null) {
      // I deleted it and keep it deleted: the tombstone covers their version from now on
      const t = tombs.get(cid), bv = b.vers || [];
      tombs.set(cid, Object.assign({}, t, { vers: (t.vers || []).filter((v) => !bv.includes(v)).concat(bv).slice(-LIMITS.versions) }));
      return [];
    }
    if (b === null) {
      // I keep mine against their deletion: mine records it, so the same file does not ask again
      const mark = _kept_mark(tt.get(cid));
      const v = (a.vers || []).filter((x) => x !== mark);
      return [Object.assign({}, a, { vers: v.length ? v.slice(0, -1).concat([mark], v.slice(-1)).slice(-LIMITS.versions) : [mark] })];
    }
    return [_with_threads(a, b)];
  };
  for (const a of mine) {
    const b = byT.get(a.id);
    if (b === undefined) {
      const t = tt.get(a.id);
      if (t === undefined) { out.push(a); report.kept += 1; }
      else if (_deleted_covers(a, t)) { tombs.set(a.id, t); report.removed += 1; }
      else if ((a.vers || []).includes(_kept_mark(t))) { out.push(a); report.kept += 1; }
      else out.push(...settle(a.id, "deleted_by_them", a, null));
      continue;
    }
    const ca = _mcur(a), cb = _mcur(b);
    if ((ca && ca === cb) || _msame(a, b)) { out.push(_with_threads(a, b)); report.kept += 1; }
    else if (cb && (a.vers || []).includes(cb)) { out.push(_with_threads(a, b)); report.kept += 1; }
    else if (ca && (b.vers || []).includes(ca)) { out.push(_with_threads(b, a)); report.updated += 1; }
    else out.push(...settle(a.id, "edited", a, b));
  }
  const mineIds = new Set(mine.map((m) => m.id));
  for (const b of theirs) {
    if (mineIds.has(b.id)) continue;
    const t = mt.get(b.id);
    if (t === undefined) { out.push(b); report.added += 1; }
    else if (_deleted_covers(b, t)) continue;
    else out.push(...settle(b.id, "deleted_by_me", null, b));
  }
  if (out.length > LIMITS.markups) {
    throw new TakeoffError("limit", "Merging would make " + out.length.toLocaleString("en-US") + " markups; the limit is " + LIMITS.markups.toLocaleString("en-US") +
      ". Nothing was merged. Split the set into parts or archive finished markups first.");
  }
  const outIds = new Set(out.map((m) => m.id));
  for (const [tid, t] of tt) if (!tombs.has(tid) && !outIds.has(tid) && !mineIds.has(tid)) tombs.set(tid, t);
  const tombList = Array.from(tombs.entries()).filter(([i]) => !outIds.has(i)).map(([, t]) => t);
  return { markups: out, tombstones: tombList, conflicts, report };
}
function _munion(a, b) { const ids = new Set(a.map((x) => x.id)); return a.concat(b.filter((x) => !ids.has(x.id))); }
function merge_documents(mine, theirs, choices) {
  const r = merge_markups(mine.markups, theirs.markups, mine.tombstones || [], theirs.tombstones || [], choices);
  const doc = Object.assign({}, mine);
  doc.markups = r.markups;
  if (r.tombstones.length) doc.tombstones = r.tombstones; else delete doc.tombstones;
  doc.layers = _munion(mine.layers, theirs.layers);
  doc.assemblies = _munion(mine.assemblies, theirs.assemblies);
  doc.columns = _munion(mine.columns, theirs.columns);
  const rates = _munion(mine.rates || [], theirs.rates || []);
  if (rates.length) doc.rates = rates;
  const pages = {};
  for (const k of Object.keys(mine.pages)) pages[k] = Object.assign({}, mine.pages[k]);
  for (const k of Object.keys(theirs.pages)) {
    const e = theirs.pages[k];
    if (!has(pages, k)) { pages[k] = Object.assign({}, e); continue; }
    const p = pages[k];
    for (const key of ["scale", "label", "title"]) if (!has(p, key) && has(e, key)) p[key] = e[key];
    if (e.viewports && e.viewports.length) p.viewports = _munion(p.viewports || [], e.viewports).slice(0, LIMITS.viewports);
  }
  doc.pages = pages;
  return { doc, conflicts: r.conflicts, report: r.report };
}
