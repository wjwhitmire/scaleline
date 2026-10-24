// Undo and redo over immutable snapshots of the takeoff state: markups, layers, scales. Each step
// keeps a label so the Edit menu can say what it will undo.
const HISTORY_CAP = 300;
function history_new(present) { return { past: [], future: [], present }; }
function history_commit(h, next, label) {
  if (next === h.present) return h;
  const past = h.past.concat([{ state: h.present, label: label || "Edit" }]);
  if (past.length > HISTORY_CAP) past.splice(0, past.length - HISTORY_CAP);
  return { past, future: [], present: next, lastLabel: label || "Edit" };
}
function history_undo(h) {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), future: [{ state: h.present, label: prev.label }].concat(h.future), present: prev.state, lastLabel: prev.label };
}
function history_redo(h) {
  if (!h.future.length) return h;
  const nxt = h.future[0];
  return { past: h.past.concat([{ state: h.present, label: nxt.label }]), future: h.future.slice(1), present: nxt.state, lastLabel: nxt.label };
}
