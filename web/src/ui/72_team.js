// ---------------------------------------------------------------- team review without a server
// Comments and replies on any markup with @names, resolve, assigned to me; merging a teammate's
// markup file with a review of conflicts; and a shared folder that keeps everyone's files merged.

// ---- comments in Properties
function mentionSpans(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(/(^|[^\w@])(@[A-Za-z0-9][\w.-]{0,40})/g)) {
    const at = m.index + m[1].length;
    if (at > last) out.push(document.createTextNode(text.slice(last, at)));
    out.push(el("span", { cls: "mention", text: m[2] }));
    last = at + m[2].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}
function shortTime(iso) { return String(iso || "").replace("T", " ").replace(/:\d\dZ$/, "").replace(/Z$/, ""); }
function knownPeople() {
  const names = new Set();
  for (const m of model().markups) {
    if (m.author) names.add(m.author);
    if (m.assignee) names.add(m.assignee);
    for (const c of m.comments || []) if (c.author) names.add(c.author);
  }
  if (whoAmI()) names.add(whoAmI());
  return Array.from(names).sort();
}
let replyTo = null;
function commentsBlock(m) {
  const box = el("div", { cls: "comments", id: "prop-comments" });
  const live = (m.comments || []).filter((c) => !c.deleted).length;
  box.append(el("h3", { cls: "h" }, [icon("comment"), "Comments", live ? el("span", { cls: "count", text: String(live) }) : null,
    m.resolved ? el("span", { cls: "stat accepted" }, [icon("accepted"), el("span", { text: "Resolved" })]) : null]));
  // assigned to
  const dl = el("datalist", { id: "people-list" }, knownPeople().map((n) => el("option", { value: n })));
  const as = input({ value: m.assignee || "", list: "people-list", placeholder: "Name" });
  as.addEventListener("change", () => updateMarkups([m.id], (c) => { const v = cleanName(as.value, 100); if (v) c.assignee = v; else delete c.assignee; }, "Assign"));
  box.append(field("Assigned to", as, "prop-assignee"), dl);
  // the thread: comments in order, replies under the comment they answer
  const list = el("ul", { cls: "thread", id: "comment-thread" });
  const all = m.comments || [];
  const ids = new Set(all.map((c) => c.id));
  const tops = all.filter((c) => !c.reply_to || !ids.has(c.reply_to));
  const item = (c, depth) => {
    const mine = c.author && c.author === whoAmI();
    const head = el("div", { cls: "ch" }, [el("b", { text: c.author || "Someone" }), el("span", { cls: "mono t", text: shortTime(c.at) })]);
    const body = el("p", { cls: "cb" + (c.deleted ? " gone" : "") }, c.deleted ? [document.createTextNode("Comment deleted")] : mentionSpans(c.text));
    const acts = el("div", { cls: "ca" });
    if (!c.deleted && depth < 4) {
      const r = el("button", { type: "button", cls: "link", text: "Reply", "data-reply": c.id });
      r.addEventListener("click", () => { replyTo = c.id; renderProps(); setTimeout(() => { const t = $("comment-text"); if (t) t.focus(); }, 0); });
      acts.append(r);
    }
    if (mine && !c.deleted) {
      const d = el("button", { type: "button", cls: "link", text: "Delete" });
      d.addEventListener("click", () => updateMarkups([m.id], (x) => { x.comments = (x.comments || []).map((k) => (k.id === c.id ? Object.assign({}, k, { deleted: true, text: "" }) : k)); }, "Delete comment"));
      acts.append(d);
    }
    const li = el("li", { cls: "cm d" + Math.min(depth, 3), "data-id": c.id }, [head, body, acts]);
    list.append(li);
    for (const r of all.filter((x) => x.reply_to === c.id && x.id !== c.id)) item(r, depth + 1);
  };
  tops.forEach((c) => item(c, 0));
  if (!all.length) list.append(el("li", { cls: "help", text: "No comments yet. Type @ and a name to ask someone." }));
  box.append(list);
  // composer
  const ta = el("textarea", { id: "comment-text", rows: 2, placeholder: replyTo ? "Reply" : "Add a comment, @name to ask someone" });
  const post = el("button", { type: "button", cls: "btn small primary", id: "comment-post" }, [icon("comment"), replyTo ? "Reply" : "Comment"]);
  // with no name set yet, the composer asks for it once, right here, and remembers it
  const nameBox = whoAmI() ? null : input({ id: "comment-author", placeholder: "Your name, so comments say who wrote them", "aria-label": "Your name" });
  const send = () => {
    const text = String(ta.value || "").slice(0, 2000).trim();
    if (!text) return;
    if (nameBox && cleanName(nameBox.value, 100)) { S.settings.author = cleanName(nameBox.value, 100); kvSet("settings", S.settings); }
    const c = { id: newId("c"), author: whoAmI(), at: nowIso(), text };
    if (replyTo) c.reply_to = replyTo;
    replyTo = null;
    updateMarkups([m.id], (x) => { x.comments = (x.comments || []).concat([c]); if (x.resolved) delete x.resolved; }, "Comment");
    const who = C.mentions(text);
    status("Comment added" + (who.length ? " for " + who.map((n) => "@" + n).join(", ") : "") + ". It travels with the markup file and live sessions.");
  };
  post.addEventListener("click", send);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  const row = el("div", { cls: "row" }, [post]);
  if (replyTo) {
    const parent = all.find((c) => c.id === replyTo);
    const cancel = el("button", { type: "button", cls: "btn small ghost", text: "Cancel reply" });
    cancel.addEventListener("click", () => { replyTo = null; renderProps(); });
    row.prepend(el("span", { cls: "help", text: "Replying to " + ((parent && parent.author) || "a comment") }));
    row.append(cancel);
  }
  const res = el("button", { type: "button", cls: "btn small", id: "comment-resolve" }, [icon(m.resolved ? "open-status" : "accepted"), m.resolved ? "Reopen" : "Resolve"]);
  res.addEventListener("click", () => updateMarkups([m.id], (x) => { if (x.resolved) delete x.resolved; else x.resolved = true; }, m.resolved ? "Reopen comments" : "Resolve comments"));
  row.append(res);
  box.append(field(replyTo ? "Reply" : "Comment", ta, "comment-text"));
  if (nameBox) box.append(field("Your name", nameBox, "comment-author"));
  box.append(row);
  // status history
  if ((m.status_log || []).length) {
    box.append(el("h3", { cls: "h" }, [icon("review"), "Status history"]),
      el("ul", { cls: "slog", id: "status-log" }, m.status_log.slice().reverse().slice(0, 30).map((e) => el("li", null, [
        statChip(e.status), el("span", { text: e.by ? "by " + e.by : "" }), el("span", { cls: "mono t", text: shortTime(e.at) })]))));
  }
  const meta = [m.rev ? "Revision " + m.rev : "", m.modified_by ? "last changed by " + m.modified_by : "", m.modified ? shortTime(m.modified) : ""].filter(Boolean).join(", ");
  if (meta) box.append(el("p", { cls: "help mono", id: "prop-revision", text: meta }));
  return box;
}
on("selection", () => { replyTo = null; });

// ---- merging a teammate's markup file
async function readMarkupFileFrom(file) {
  if (file.size > 50 * 1024 * 1024) throw new Error("A markup file over 50 MB is not accepted.");
  let raw;
  try { raw = JSON.parse(await readFileText(file)); } catch (e) { throw new Error("This is not a valid markup file (JSON could not be read)."); }
  return C.clean_document(raw)[0];
}
function conflictLabel(m) {
  if (!m) return "deleted";
  const d = displayOf(m);
  return (m.subject || C.TYPE_LABELS[m.type]) + (d ? ", " + d.text : "") + ", rev " + (m.rev || 0) + (m.modified_by ? " by " + m.modified_by : "") + (m.modified ? ", " + shortTime(m.modified) : "");
}
const CONFLICT_WHY = { edited: "Both of you changed it since you last shared files.", deleted_by_me: "You deleted it; they kept changing it.", deleted_by_them: "They deleted it; you kept changing it." };
// The merge review: what was found, why, the conflicts with a choice each, and one primary.
function openMergeReview(theirs, from, opts) {
  const o = opts || {};
  let first;
  try { first = C.merge_documents(model(), theirs); } catch (e) { status(e.message, "bad"); return null; }
  const choices = {};
  for (const c of first.conflicts) choices[c.id] = "mine";
  const rep = first.report;
  const changes = rep.added + rep.updated + rep.removed;
  if (!changes && !first.conflicts.length) {
    if (!o.quiet) status("Nothing new in " + from + ": every markup there is already here.");
    return null;
  }
  const mismatch = theirs.document && theirs.document.sha256 && theirs.document.sha256 !== S.doc.id;
  const list = el("ul", { cls: "cands conflicts", id: "merge-conflicts" });
  first.conflicts.forEach((c, i) => {
    const seg = el("div", { cls: "seg", role: "group", "aria-label": "Keep which version" });
    const opt = (val, label) => {
      const b = el("button", { type: "button", id: "merge-" + i + "-" + val, "aria-pressed": choices[c.id] === val ? "true" : "false", text: label });
      b.addEventListener("click", () => { choices[c.id] = val; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); });
      return b;
    };
    seg.append(opt("mine", "Keep mine"), opt("theirs", "Keep theirs"));
    if (c.mine && c.theirs) seg.append(opt("both", "Keep both"));
    const m = c.mine || c.theirs;
    const go = el("button", { type: "button", cls: "iconbtn", "aria-label": "Show this markup", title: "Show it" }, [icon("zoom")]);
    go.addEventListener("click", async () => { if (m.page !== S.view.page) await goToPage(m.page); const b = markupBounds(m); zoomTo([b[0] - 60, b[1] - 60, b[2] + 60, b[3] + 60]); });
    list.append(el("li", { cls: "cand conflict" }, [el("span", { cls: "w" }, [
      el("b", { text: (m.subject || C.TYPE_LABELS[m.type]) + ", sheet " + sheetLabel(m.page) }),
      el("span", { text: CONFLICT_WHY[c.kind] }),
      el("span", { cls: "mono", text: "Mine: " + conflictLabel(c.mine) }), el("span", { cls: "mono", text: "Theirs: " + conflictLabel(c.theirs) })]), seg, go]));
  });
  const chips = el("div", { cls: "chips", id: "merge-summary" }, [
    el("span", { cls: "chip", text: rep.added + " new" }), el("span", { cls: "chip", text: rep.updated + " updated" }),
    el("span", { cls: "chip", text: rep.removed + " deleted" }), el("span", { cls: "chip" + (first.conflicts.length ? " warn" : ""), text: first.conflicts.length + " to decide" })]);
  const body = el("div", null, [
    el("div", { cls: "why" }, [el("b", { text: "Why" }), el("span", { text: "Markups are matched by their id. Each one keeps a short history of its versions, so a newer copy replaces an older one without asking. " +
      (first.conflicts.length ? "A markup changed on both sides since you last shared files needs your choice." : "Nothing was changed on both sides.") + " Comments and status history from both files are kept either way." }),
      mismatch ? el("span", { cls: "warn", style: "grid-column:2" }, [icon("review"), "This file was made for a different PDF (" + (theirs.document.name || "unknown") + "). Pages may not line up."]) : null]),
    el("div", { cls: "auto-ctl" }, [chips]),
    first.conflicts.length ? list : el("p", { cls: "help", style: "padding:0 12px 12px", text: changes + " change" + (changes === 1 ? "" : "s") + " will come in." }),
  ]);
  return new Promise((resolve) => {
    openDialog({ title: "Merge markups from " + from, icon: "merge", src: theirs.markups.length + " markups in the file", wide: true, cls: "auto", body,
      note: "Nothing changes until you click Merge. One undo removes the merge.",
      onCancel: () => resolve(null),
      actions: [{ label: "Cancel", onClick: () => resolve(null) },
        { label: "Merge " + (changes + first.conflicts.length) + " change" + (changes + first.conflicts.length === 1 ? "" : "s"), primary: true, id: "merge-apply", onClick: () => {
          const r = applyMerge(theirs, choices, "Merge markups from " + from);
          resolve(r);
        } }] });
  });
}
function applyMerge(theirs, choices, label) {
  let r;
  try { r = C.merge_documents(model(), theirs, choices); } catch (e) { status(e.message, "bad"); return null; }
  commit(label, (n) => {
    n.markups = r.doc.markups;
    if (r.doc.tombstones) n.tombstones = r.doc.tombstones; else delete n.tombstones;
    n.layers = r.doc.layers; n.assemblies = r.doc.assemblies; n.columns = r.doc.columns; n.pages = r.doc.pages;
    if (r.doc.rates) n.rates = r.doc.rates;
  });
  const rep = r.report;
  undoToast("Merged: " + rep.added + " new, " + rep.updated + " updated, " + rep.removed + " deleted" + (rep.resolved ? ", " + rep.resolved + " decided" : "") + ".");
  status("Merged " + label.replace(/^Merge markups from /, "") + ". Ctrl+Z undoes the merge.");
  return r;
}
async function mergeFromFile(file) {
  if (!S.doc || !file) return;
  try {
    const theirs = await readMarkupFileFrom(file);
    await openMergeReview(theirs, cleanName(file.name.replace(/\.markups\.json$|\.json$/i, ""), 60));
  } catch (e) { status(e.message, "bad"); }
}

// ---- shared folder sync (File System Access; Chromium browsers)
const SYNC_EVERY_MS = 30000;
// Teammates' files: name.person.markups.json, at most 64 of them looked at per pass.
const SYNC_NAME = /^[^\\/\u0000-\u001f]{1,200}\.markups\.json$/i, SYNC_MAX_FILES = 64;
const sync = { handle: null, name: "", timer: null, busy: false, lastWritten: null, seen: new Map(), pending: [], docId: null, log: [] };
const syncSupported = () => typeof window.showDirectoryPicker === "function";
function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "me"; }
function ownSyncName() { return safeFileName(S.doc.name.replace(/\.pdf$/i, "")).replace(/\s+/g, "-") + "." + slug(whoAmI()) + ".markups.json"; }
async function syncPermission(handle, ask) {
  try {
    if (!handle.queryPermission) return true;
    if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
    return ask && (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  } catch (e) { return false; }
}
async function startSync(handle, quiet) {
  stopSync();
  sync.handle = handle;
  sync.name = handle.name || "folder";
  sync.docId = S.doc.id;
  sync.lastWritten = null;
  sync.seen = new Map();
  await kvSet("sync:" + S.doc.id, handle);
  await syncNow();
  sync.timer = setInterval(syncNow, SYNC_EVERY_MS);
  renderSyncChip();
  if (!quiet) status("Shared folder sync is on: " + sync.name + ". Your markups are written there and teammates' files are merged every 30 seconds.");
}
function stopSync() {
  clearInterval(sync.timer);
  sync.timer = null;
  sync.handle = null;
  sync.pending = [];
  renderSyncChip();
}
async function syncNow() {
  if (!sync.handle || sync.busy || !S.doc || sync.docId !== S.doc.id) return;
  sync.busy = true;
  try {
    // 1. write my file when my takeoff changed
    if (whoAmI() && sync.lastWritten !== model()) {
      const fh = await sync.handle.getFileHandle(ownSyncName(), { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(Object.assign({ app: NAME }, model())));
      await w.close();
      sync.lastWritten = model();
      sync.seen.set(ownSyncName(), Infinity);
    }
    // 2. read teammates' files for this PDF and merge what changed. Only plain files directly in the
    // chosen folder count (no subfolders); a file that cannot be read, is too large or is not a
    // markup file is skipped and tried again only when it changes.
    let looked = 0;
    for await (const [name, h] of sync.handle.entries()) {
      if (h.kind !== "file" || !SYNC_NAME.test(name) || name === ownSyncName()) continue;
      if (++looked > SYNC_MAX_FILES) break;
      let f;
      try { f = await h.getFile(); } catch (e) { continue; }
      if (sync.seen.get(name) === f.lastModified) continue;
      sync.seen.set(name, f.lastModified);
      let theirs;
      try { theirs = await readMarkupFileFrom(f); } catch (e) { continue; }
      if (!theirs.document || theirs.document.sha256 !== S.doc.id) continue;
      const who = name.replace(/\.markups\.json$/i, "").split(".").pop();
      let r;
      try { r = C.merge_documents(model(), theirs); } catch (e) { status(who + ": " + e.message, "bad"); continue; }
      const changes = r.report.added + r.report.updated + r.report.removed;
      if (r.conflicts.length) {
        sync.pending = sync.pending.filter((p) => p.name !== name).concat([{ name, who, theirs, conflicts: r.conflicts.length }]);
        renderSyncChip();
        continue;
      }
      if (!changes) continue;
      applyMerge(theirs, {}, "Sync from " + who);
      sync.log.unshift({ at: nowIso(), who, changes });
      sync.lastWritten = null;
    }
  } catch (e) {
    status("Shared folder sync stopped: " + cleanName(e && e.message, 100) + ". Open Team, Shared folder sync to resume.", "warn");
    stopSync();
  } finally { sync.busy = false; renderSyncChip(); }
}
function renderSyncChip() {
  const box = $("sb-sync");
  if (!box) return;
  clear(box);
  box.hidden = !sync.handle && !sync.resume;
  if (sync.resume && !sync.handle) {
    const b = el("button", { type: "button", cls: "sb", id: "sync-resume" }, [icon("folder-sync"), el("span", { text: "Resume folder sync" })]);
    b.addEventListener("click", async () => { const h = sync.resume; if (await syncPermission(h, true)) { sync.resume = null; startSync(h); } else status("The folder was not shared with the app again.", "warn"); });
    box.append(b);
    return;
  }
  if (!sync.handle) return;
  const n = sync.pending.reduce((s, p) => s + p.conflicts, 0);
  const b = el("button", { type: "button", cls: "sb" + (n ? " warn" : ""), id: "sync-chip", title: "Shared folder: " + sync.name }, [icon("folder-sync"), el("span", { cls: "only-desk", text: n ? n + " to decide" : "Synced" })]);
  b.addEventListener("click", () => (n ? reviewPendingSync() : openSyncDialog()));
  box.append(b);
}
async function reviewPendingSync() {
  const p = sync.pending.shift();
  renderSyncChip();
  if (!p) return;
  await openMergeReview(p.theirs, p.who + " (shared folder)");
  sync.lastWritten = null;
}
function openSyncDialog() {
  if (!S.doc) return;
  const body = el("div", { cls: "stack" });
  if (!syncSupported()) {
    body.append(el("p", { cls: "help", text: "This browser cannot keep a shared folder open for a web app (Chromium browsers such as Chrome and Edge can). Use Team, Merge markups from a file instead: send your markup file to teammates and merge theirs." }));
    openDialog({ title: "Shared folder sync", icon: "folder-sync", body, actions: [{ label: "Merge from a file...", onClick: () => $("file-merge").click() }, { label: "Close", primary: true }] });
    return;
  }
  const nameIn = input({ id: "sync-author", value: whoAmI(), placeholder: "Your name" });
  body.append(el("p", { cls: "help", text: "Pick a folder your team already shares (OneDrive, Dropbox, Google Drive for desktop, a network drive). " + NAME +
      " writes your markups there as one file with your name and merges each teammate's file for this PDF when you open it and every 30 seconds. No server is involved; the folder service carries the files." }),
    field("Your name (on your file)", nameIn),
    el("div", { cls: "why small" }, [el("b", { text: "Now" }), el("span", { id: "sync-state", text: sync.handle ? "Syncing with " + sync.name + (sync.log.length ? ". Last merge: " + sync.log[0].changes + " changes from " + sync.log[0].who + "." : ".") : "Off." })]));
  const actions = [{ label: "Close" }];
  if (sync.handle) actions.unshift({ label: "Stop syncing", id: "sync-stop", onClick: () => { stopSync(); kvSet("sync:" + S.doc.id, null); status("Shared folder sync is off."); } },
    { label: "Sync now", id: "sync-now", onClick: async () => { await syncNow(); status("Synced with " + sync.name + "."); } });
  else actions.push({ label: "Choose folder...", primary: true, id: "sync-choose", onClick: async () => {
    const n = cleanName(nameIn.value, 100);
    if (!n) { status("Enter your name first: it goes on your file so teammates know whose it is.", "warn"); return true; }
    if (n !== S.settings.author) { S.settings.author = n; kvSet("settings", S.settings); }
    let h;
    try { h = await window.showDirectoryPicker({ mode: "readwrite", id: "takeoff-shared" }); } catch (e) { return; }
    await startSync(h);
  } });
  openDialog({ title: "Shared folder sync", icon: "folder-sync", body, actions });
}
// On opening a plan set, pick its shared folder up again (the browser may ask for permission).
on("doc", async () => {
  stopSync();
  sync.resume = null;
  if (!S.doc || !syncSupported()) return;
  const h = await kvGet("sync:" + S.doc.id, null);
  if (!h) return;
  if (await syncPermission(h, false)) startSync(h, true);
  else { sync.resume = h; renderSyncChip(); }
});

// Ask once for the person's name at the moment a feature needs it, and remember it on this device.
function askName(why, done) {
  const nm = input({ id: "ask-name", placeholder: "Your name" });
  openDialog({ title: "Your name", icon: "users", body: el("div", null, [el("p", { cls: "help", text: why + " It is kept on this device and goes with your markups and comments." }), field("Name", nm)]),
    enter: () => $("ask-name-ok").click(),
    actions: [{ label: "Not now" }, { label: "Save", primary: true, id: "ask-name-ok", onClick: () => {
      const n = cleanName(nm.value, 100);
      if (!n) { status("Type a name, or choose Not now.", "warn"); return true; }
      S.settings.author = n; kvSet("settings", S.settings);
      status("Name saved: " + n + ".");
      if (done) done();
    } }] });
}
