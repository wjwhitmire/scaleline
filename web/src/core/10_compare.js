// Carry markups from an old sheet to its new revision. Each markup moves by the alignment shift.
// A markup that touches a changed area is copied with status Review and a note, so nothing is
// silently wrong; everything else is copied as is.
function boxes_overlap(a, b) { return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]; }
function markup_bbox(m) {
  const pts = (m.holes || []).reduce((acc, h) => acc.concat(h), m.points.slice());
  return bbox(pts);
}
function in_box(p, b) { return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]; }
function segment_hits_box(a, c, b) {
  if (in_box(a, b) || in_box(c, b)) return true;
  const corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  for (let i = 0; i < 4; i++) if (segments_intersect(a, c, corners[i], corners[(i + 1) % 4])) return true;
  return false;
}
// Does a changed area touch this markup's lines, points or (for closed shapes) inside?
function markup_touches_box(m, b) {
  const bb = markup_bbox(m);
  if (!boxes_overlap(bb, b)) return false;
  const P = m.points;
  if (m.type === "count") return P.some((p) => in_box(p, b));
  if (P.length === 1) return in_box(P[0], b);
  if (P.length === 2 && ["rect", "cloud", "highlight", "ellipse"].includes(m.type)) return true;
  const closed = ["area", "volume", "polygon", "perimeter"].includes(m.type);
  const rings = [P].concat(m.holes || []);
  for (const r of rings) {
    for (let i = 0; i < r.length - (closed ? 0 : 1); i++) if (segment_hits_box(r[i], r[(i + 1) % r.length], b)) return true;
  }
  return closed && point_in_polygon([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], P);
}
function carry_forward(markups, newPage, shift, changed, makeId, stamp) {
  const dx = shift ? shift[0] : 0, dy = shift ? shift[1] : 0;
  const out = [];
  let flagged = 0;
  for (const m of markups) {
    const moved = (p) => [p[0] + dx, p[1] + dy];
    const c = JSON.parse(JSON.stringify(m));
    c.id = makeId();
    c.page = newPage;
    c.points = m.points.map(moved);
    if (m.holes) c.holes = m.holes.map((h) => h.map(moved));
    c.carried_from = m.id;
    if (stamp) c.modified = stamp;
    if ((changed || []).some((b) => markup_touches_box(c, b))) {
      c.status = "Review";
      c.label = (c.label ? c.label + " " : "") + "(check: drawing changed here)";
      c.label = c.label.slice(0, 200);
      flagged++;
    }
    out.push(c);
  }
  return { markups: out, flagged };
}
