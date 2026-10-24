// ---------------------------------------------------------------- live session (peer to peer)
// Up to 8 people on the same plan set at once, with no server: WebRTC data channels, set up by
// exchanging a code (copy and paste, or a QR code drawn here). The host invites each guest; guests
// that join later connect to the others through messages the host relays. Only markups, cursors,
// shapes being drawn and comments travel; the PDF never does, and peers compare its SHA-256. The
// link is encrypted by WebRTC (DTLS); both sides show a short session fingerprint made from the
// two certificate fingerprints so people can check they reached each other and nobody in between.
// Every message from a peer is untrusted: it is size-capped, rate-limited per peer and per kind,
// and checked field by field (peer_message in the core) before anything reaches the takeoff.
const LIVE_MAX_PEERS = 8;
const live = { on: false, role: null, session: "", me: "", hostId: "", locked: false, ownOnly: false, peers: new Map(), invites: new Map(), bad: 0 };
const PEER_PENCILS = ["m-cobalt", "m-plum", "m-viridian", "m-amber", "m-sky", "m-redline", "m-graphite"];
const liveEnc = new TextEncoder(), liveDec = new TextDecoder();

async function packCode(obj) {
  const bytes = liveEnc.encode(JSON.stringify(obj));
  let out = bytes;
  try {
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    out = new Uint8Array(await new Response(cs).arrayBuffer());
    return C.CODE_PREFIX + "z" + C.b64url_encode(out);
  } catch (e) { return C.CODE_PREFIX + "j" + C.b64url_encode(out); }
}
async function unpackCode(text) {
  const t = String(text || "").trim();
  if (!t.startsWith(C.CODE_PREFIX) || t.length > 40000) throw new Error("This is not a session code. Codes start with " + C.CODE_PREFIX);
  const kind = t[C.CODE_PREFIX.length], body = C.b64url_decode(t.slice(C.CODE_PREFIX.length + 1));
  let bytes = body;
  if (kind === "z") {
    try { bytes = await inflateCapped(body, "deflate-raw", 100000); } catch (e) { throw new Error("The session code is damaged or too large."); }
  } else if (kind !== "j") throw new Error("This is not a session code.");
  let obj;
  try { obj = JSON.parse(liveDec.decode(bytes)); } catch (e) { throw new Error("The session code is damaged. Copy it again."); }
  try { return C.session_code_check(obj); } catch (e) { throw new Error(e.message); }
}
// Wait for the browser to gather its connection candidates (no trickle: the code carries them all).
function iceDone(pc, ms) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") { resolve(); return; }
    const t = setTimeout(resolve, ms || 4000);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); resolve(); } });
  });
}
function localSdp(pc) { const s = pc.localDescription ? pc.localDescription.sdp : ""; return S.settings.stunHost ? s : C.sdp_lan_only(s); }
// What we accept from a code or a relayed signal: with no STUN host set, local network candidates only.
function remoteSdp(sdp) { return S.settings.stunHost ? sdp : C.sdp_lan_only(sdp); }
async function sessionFingerprint(pc) {
  const input = C.session_fingerprint_input(pc.localDescription ? pc.localDescription.sdp : "", pc.remoteDescription ? pc.remoteDescription.sdp : "");
  const hex = await sha256Hex(liveEnc.encode(input));
  return C.fingerprint_groups(hex);
}
function liveGuestName() { return live.on && live.me ? "Guest " + live.me.slice(-3).toUpperCase() : ""; }
function liveName() { return whoAmI() || "Guest " + live.me.slice(-3).toUpperCase(); }
// Who sent a message, for the host's "own markups only" setting: a name someone else in the session
// also uses counts as no one's.
function liveSender(peer) {
  const name = peer.name || "";
  const dup = !name || name === liveName() || Array.from(live.peers.values()).some((p) => p !== peer && p.name === name);
  return { host: peer.id === live.hostId, name, dup };
}
const liveMayEdit = (peer, existing, incoming) => C.peer_may_edit({ own: live.ownOnly }, liveSender(peer), existing, incoming);
function peerColor(i) { return pencilColor(PEER_PENCILS[i % PEER_PENCILS.length]); }

// ---- connections
function wirePeer(peer) {
  const dc = peer.dc;
  dc.onopen = async () => {
    peer.open = true;
    peer.fingerprint = await sessionFingerprint(peer.pc);
    sendTo(peer, { t: "hello", v: C.PEER_PROTOCOL, name: liveName(), pdf: S.doc.id, peer: live.me, host: live.role === "host" });
    renderLive();
  };
  dc.onmessage = (e) => onPeerData(peer, e.data);
  dc.onclose = () => dropPeer(peer, (peer.name || "A teammate") + " left the session.");
  peer.pc.addEventListener("connectionstatechange", () => { if (["failed", "closed"].includes(peer.pc.connectionState)) dropPeer(peer, (peer.name || "A teammate") + " lost the connection."); });
}
function newPeerConnection(id) {
  const pc = netPeer();
  const peer = { id, name: "", pc, dc: null, open: false, rate: Object.create(null), bad: 0, cursor: null, draft: null, color: peerColor(live.peers.size + live.invites.size + 1), fingerprint: "", host: false, pdfOk: true };
  return peer;
}
function sendTo(peer, msg) {
  if (!peer.dc || peer.dc.readyState !== "open") return;
  const text = JSON.stringify(msg);
  if (text.length > C.PEER_MAX_BYTES) return;
  try { peer.dc.send(text); } catch (e) { /* closing */ }
}
function broadcast(msg, except) { for (const p of live.peers.values()) if (p !== except && p.pdfOk) sendTo(p, msg); }
function dropPeer(peer, why) {
  if (!live.peers.has(peer.id)) return;
  live.peers.delete(peer.id);
  try { peer.pc.close(); } catch (e) { /* closed */ }
  if (why) status(why);
  if (live.role === "host") sendRoster();
  if (live.role === "guest" && peer.id === live.hostId && !live.peers.size) endLiveSession("The host ended the session.");
  renderLive();
  drawScreenLayer();
}
function startLive(role) {
  if (!S.doc) return false;
  if (!switchOn("live")) return false;
  if (!live.on) {
    live.on = true; live.role = role; live.session = role === "host" ? newId("s") : ""; live.me = newId("p"); live.locked = false; live.ownOnly = false; live.hostId = role === "host" ? live.me : "";
  }
  renderLive();
  return true;
}
function endLiveSession(why) {
  if (!live.on) return;
  broadcast({ t: "bye" });
  for (const p of live.peers.values()) { try { p.pc.close(); } catch (e) { /* closed */ } }
  for (const p of live.invites.values()) { try { p.pc.close(); } catch (e) { /* closed */ } }
  live.peers.clear(); live.invites.clear();
  live.on = false; live.role = null; live.locked = false; live.ownOnly = false;
  renderLive();
  drawScreenLayer();
  if (why) status(why);
}
// Host: make an invitation code for one guest.
async function createInvite() {
  const id = newId("i");
  const peer = newPeerConnection("pending-" + id);
  peer.dc = peer.pc.createDataChannel("takeoff", { ordered: true });
  live.invites.set(id, peer);
  await peer.pc.setLocalDescription(await peer.pc.createOffer());
  await iceDone(peer.pc);
  const code = await packCode({ k: "offer", sdp: localSdp(peer.pc), name: liveName(), pdf: S.doc.id, peer: live.me, session: live.session, host: true });
  return { id, code };
}
async function acceptAnswer(inviteId, text) {
  const peer = live.invites.get(inviteId);
  if (!peer) throw new Error("This invitation is no longer open. Make a new one.");
  const a = await unpackCode(text);
  if (a.k !== "answer") throw new Error("That is an invitation code. Paste the reply code your teammate's screen shows.");
  if (a.session !== live.session) throw new Error("That reply is for another session.");
  if (a.peer === live.me || live.peers.has(a.peer)) throw new Error("That reply comes from someone already in the session. Make a new invitation.");
  if (live.peers.size >= LIVE_MAX_PEERS - 1) throw new Error("A session holds up to " + LIVE_MAX_PEERS + " people.");
  await peer.pc.setRemoteDescription({ type: "answer", sdp: remoteSdp(a.sdp) });
  live.invites.delete(inviteId);
  peer.id = a.peer;
  peer.name = a.name;
  live.peers.set(peer.id, peer);
  wirePeer(peer);
  return a;
}
// Guest: answer an invitation code.
async function answerInvite(text) {
  const o = await unpackCode(text);
  if (o.k !== "offer") throw new Error("That is a reply code. Paste the invitation code from the host.");
  live.session = o.session;
  live.hostId = o.peer;
  const peer = newPeerConnection(o.peer);
  peer.name = o.name;
  peer.host = true;
  peer.pdfOk = o.pdf === S.doc.id;
  peer.pc.ondatachannel = (e) => { peer.dc = e.channel; wirePeer(peer); };
  await peer.pc.setRemoteDescription({ type: "offer", sdp: remoteSdp(o.sdp) });
  await peer.pc.setLocalDescription(await peer.pc.createAnswer());
  await iceDone(peer.pc);
  live.peers.set(peer.id, peer);
  const code = await packCode({ k: "answer", sdp: localSdp(peer.pc), name: liveName(), pdf: S.doc.id, peer: live.me, session: live.session });
  return { offer: o, code, pdfOk: peer.pdfOk };
}
// Mesh: a guest who joins after others connects to each of them through the host's relay.
async function meshConnect(target) {
  if (live.peers.has(target.peer) || target.peer === live.me) return;
  const peer = newPeerConnection(target.peer);
  peer.name = target.name;
  peer.dc = peer.pc.createDataChannel("takeoff", { ordered: true });
  live.peers.set(peer.id, peer);
  wirePeer(peer);
  await peer.pc.setLocalDescription(await peer.pc.createOffer());
  await iceDone(peer.pc);
  const host = live.peers.get(live.hostId);
  if (host) sendTo(host, { t: "signal", to: target.peer, from: live.me, kind: "offer", sdp: localSdp(peer.pc) });
}
async function onSignal(from, m) {
  if (m.to !== live.me) {
    if (live.role === "host") { const t = live.peers.get(m.to); if (t && from.id === m.from) sendTo(t, m); }
    return;
  }
  // guests connect to each other only through the host, which checked who sent the signal
  if (live.role !== "guest" || from.id !== live.hostId) return;
  if (m.kind === "offer") {
    if (live.peers.size >= LIVE_MAX_PEERS - 1 || m.from === live.me || m.from === live.hostId || live.peers.has(m.from)) return;
    const peer = newPeerConnection(m.from);
    peer.pc.ondatachannel = (e) => { peer.dc = e.channel; wirePeer(peer); };
    live.peers.set(peer.id, peer);
    try {
      await peer.pc.setRemoteDescription({ type: "offer", sdp: remoteSdp(m.sdp) });
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
    } catch (e) { live.peers.delete(peer.id); try { peer.pc.close(); } catch (x) { /* closed */ } throw e; }
    await iceDone(peer.pc);
    const host = live.peers.get(live.hostId);
    if (host) sendTo(host, { t: "signal", to: m.from, from: live.me, kind: "answer", sdp: localSdp(peer.pc) });
  } else {
    const peer = live.peers.get(m.from);
    if (peer && !peer.pc.remoteDescription) await peer.pc.setRemoteDescription({ type: "answer", sdp: remoteSdp(m.sdp) });
  }
}
function sendRoster() {
  const peers = [{ peer: live.me, name: liveName() }].concat(Array.from(live.peers.values()).filter((p) => p.name).map((p) => ({ peer: p.id, name: p.name })));
  broadcast({ t: "roster", peers, locked: live.locked, own: live.ownOnly });
}

// ---- receiving: size cap, rate limit, field checks, then apply
const PEER_BAD_LIMIT = 50;
function onPeerData(peer, data) {
  if (typeof data !== "string" || data.length > C.PEER_MAX_BYTES) { strike(peer, "a message that was too large"); return; }
  let msg;
  try { msg = JSON.parse(data); } catch (e) { strike(peer, "data that was not a message"); return; }
  const kind = C.peer_kind(msg);
  const [ok, st] = C.peer_rate(peer.rate[kind], kind, performance.now() / 1000);
  peer.rate[kind] = st;
  if (!ok) { peer.dropped = (peer.dropped || 0) + 1; return; }
  const m = C.peer_message(msg, { numPages: S.doc ? S.doc.numPages : 0, host: peer.id === live.hostId, locked: live.locked });
  if (m.error) { strike(peer, m.error); return; }
  try { applyPeer(peer, m); } catch (e) { strike(peer, "a message that could not be applied"); }
}
function strike(peer, why) {
  peer.bad++;
  live.bad++;
  peer.lastBad = why;
  if (peer.bad >= PEER_BAD_LIMIT) {
    sendTo(peer, { t: "bye" });
    dropPeer(peer, (peer.name || "A peer") + " was disconnected: their app sent " + why + " too often.");
  }
}
function applyPeer(peer, m) {
  switch (m.t) {
    case "hello":
      // one hello per connection: a repeat changes nothing and gets no second copy of the takeoff
      if (peer.helloed) return;
      peer.helloed = true;
      peer.name = m.name;
      peer.pdfOk = m.pdf === S.doc.id;
      if (!peer.pdfOk) status(m.name + " has a different PDF open (fingerprint " + m.pdf.slice(0, 8) + "). Nothing is exchanged with them until you both open the same file.", "warn");
      else sendTo(peer, { t: "state", markups: model().markups });
      if (live.role === "host") sendRoster();
      renderLive();
      return;
    case "roster":
      live.locked = m.locked;
      live.ownOnly = m.own;
      for (const p of m.peers) if (p.peer !== live.me && !live.peers.has(p.peer) && live.role === "guest") meshConnect(p).catch(() => {});
      for (const p of m.peers) { const x = live.peers.get(p.peer); if (x && !x.name) x.name = p.name; }
      renderLive();
      return;
    case "cursor": peer.cursor = { page: m.page, x: m.x, y: m.y, at: performance.now() }; liveRedraw(); return;
    case "draft": peer.draft = m.points.length ? m : null; liveRedraw(); return;
    case "lock":
      if (m.own !== live.ownOnly) status(m.own ? "The host set the session so guests change only their own markups." : "Guests can change any markup again.");
      live.ownOnly = m.own;
      if (m.locked !== live.locked) status(m.locked ? "The host locked the session: your changes stay on your device until it is unlocked." : "The host unlocked the session.");
      live.locked = m.locked;
      renderLive();
      return;
    case "bye": dropPeer(peer, (peer.name || "A teammate") + " left the session."); return;
    case "signal": onSignal(peer, m).catch(() => strike(peer, "a connection signal that could not be used")); return;
    default: break;
  }
  if (!peer.pdfOk) return;
  if ((m.t === "put" || m.t === "del") && !liveMayEdit(peer, model().markups.find((x) => x.id === (m.t === "put" ? m.markup.id : m.id)) || null, m.t === "put" ? m.markup : null)) {
    peer.refused = (peer.refused || 0) + 1;
    status((peer.name || "A guest") + " changed a markup that is not theirs; the host lets guests change only their own, so it was not applied.", "warn");
    return;
  }
  if (m.t === "put") {
    peer.draft = null;
    applyRemote((st) => upsertMarkup(st, m.markup));
    if (live.role === "host") broadcast({ t: "put", markup: m.markup }, peer);
  } else if (m.t === "del") {
    applyRemote((st) => removeMarkup(st, m.id, peer.name));
    if (live.role === "host") broadcast({ t: "del", id: m.id }, peer);
  } else if (m.t === "comment") {
    applyRemote((st) => Object.assign({}, st, { markups: st.markups.map((x) => (x.id === m.id ? Object.assign({}, x, { comments: C.merge_comments(x.comments, [m.comment]) }) : x)) }));
  } else if (m.t === "state") {
    const before = new Map(model().markups.map((x) => [x.id, x]));
    applyRemote((st) => {
      try {
        if (live.ownOnly) {
          const have = new Map(st.markups.map((x) => [x.id, x]));
          m = Object.assign({}, m, { markups: m.markups.filter((x) => liveMayEdit(peer, have.get(x.id) || null, x)) });
        }
        const r = C.merge_markups(st.markups, m.markups, st.tombstones || [], [], {});
        const choices = {};
        for (const c of r.conflicts) choices[c.id] = peer.id === live.hostId ? "theirs" : "mine";
        const f = r.conflicts.length ? C.merge_markups(st.markups, m.markups, st.tombstones || [], [], choices) : r;
        return Object.assign({}, st, { markups: f.markups });
      } catch (e) { status(peer.name + ": " + e.message, "bad"); return st; }
    });
    if (live.role === "host") {
      const changed = model().markups.filter((x) => before.get(x.id) !== x);
      if (changed.length > 50) broadcast({ t: "state", markups: model().markups }, peer);
      else for (const x of changed) broadcast({ t: "put", markup: x }, peer);
    }
  }
}
function upsertMarkup(st, mk) {
  const i = st.markups.findIndex((x) => x.id === mk.id);
  if (i < 0 && st.markups.length >= C.LIMITS.markups) {
    status("A markup from the live session was not added: this file holds the most markups a file may (" + C.LIMITS.markups.toLocaleString() + ").", "bad");
    return st;
  }
  if (i < 0) return Object.assign({}, st, { markups: st.markups.concat([mk]), tombstones: (st.tombstones || []).filter((t) => t.id !== mk.id) });
  const r = C.merge_markups([st.markups[i]], [mk], [], [], { [mk.id]: "theirs" });
  const next = st.markups.slice();
  next[i] = r.markups[0];
  return Object.assign({}, st, { markups: next });
}
function removeMarkup(st, id, by) {
  const gone = st.markups.find((x) => x.id === id);
  if (!gone) return st;
  return Object.assign({}, st, { markups: st.markups.filter((x) => x.id !== id),
    tombstones: (st.tombstones || []).concat([{ id, at: nowIso(), by: by || "", vers: (gone.vers || []).slice(-32) }]) });
}
// ---- sending my changes, cursor and the shape I am drawing
on("commit", (c) => {
  if (!live.on || c.remote || !live.peers.size) return;
  if (live.locked && live.role !== "host") { status("The host locked the session: this change stays on your device.", "warn"); return; }
  const before = new Map(c.prev.markups.map((m) => [m.id, m]));
  const now = new Set();
  const changed = [];
  for (const m of c.next.markups) { now.add(m.id); if (before.get(m.id) !== m) changed.push(m); }
  let removed = c.prev.markups.filter((m) => !now.has(m.id)).map((m) => m.id);
  if (live.ownOnly && live.role !== "host") {
    const me = { host: false, name: liveName(), dup: false };
    const n = changed.length + removed.length;
    const mine = changed.filter((m) => C.peer_may_edit({ own: true }, me, before.get(m.id) || null, m));
    removed = removed.filter((id) => C.peer_may_edit({ own: true }, me, before.get(id) || null, null));
    changed.length = 0;
    changed.push(...mine);
    if (changed.length + removed.length < n) status("Only your own markups are shared: the host lets guests change only their own. Other changes stay on your device.", "warn");
  }
  if (changed.length > 50) broadcast({ t: "state", markups: c.next.markups });
  else for (const m of changed) broadcast({ t: "put", markup: m });
  for (const id of removed) broadcast({ t: "del", id });
});
let liveCursorAt = 0, liveDraftAt = 0;
function liveCursor(e) {
  if (!live.on || !live.peers.size || !S.doc) return;
  const t = performance.now();
  if (t - liveCursorAt < 50) return;
  liveCursorAt = t;
  const p = clientToPage(e);
  broadcast({ t: "cursor", page: S.view.page, x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10 });
  if (S.draft && S.draft.points && t - liveDraftAt > 60) {
    liveDraftAt = t;
    const pts = S.draft.points.concat(S.draft.hover ? [S.draft.hover] : []).slice(0, 2000);
    broadcast({ t: "draft", page: S.view.page, type: C.MARKUP_TYPES.includes(S.draft.type) ? S.draft.type : "polyline", points: pts.map((q) => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]) });
  } else if (!S.draft && liveDraftAt) { liveDraftAt = 0; broadcast({ t: "draft", page: S.view.page, type: "polyline", points: [] }); }
}
let liveRaf = 0;
function liveRedraw() { if (!liveRaf) liveRaf = requestAnimationFrame(() => { liveRaf = 0; drawScreenLayer(); }); }
// Peers' cursors and the shapes they are drawing, on the screen layer (called by drawScreenLayer).
function drawLivePeers(scr) {
  if (!live.on) return;
  const nowT = performance.now();
  for (const p of live.peers.values()) {
    if (p.draft && p.draft.page === S.view.page && p.draft.points.length) {
      const pts = p.draft.points.map((q) => pageToScreen(q[0], q[1]));
      scr.append(svg("path", { d: "M" + pts.map((q) => q[0] + " " + q[1]).join(" L"), fill: "none", stroke: p.color, "stroke-width": 1.5, "stroke-dasharray": "5 3", class: "live-draft" }));
    }
    if (!p.cursor || p.cursor.page !== S.view.page || nowT - p.cursor.at > 15000) continue;
    const s = pageToScreen(p.cursor.x, p.cursor.y);
    const g = svg("g", { class: "live-cursor", transform: "translate(" + s[0] + " " + s[1] + ")" });
    g.append(svg("path", { d: "M0 0L0 15L4 11L7 18L9.5 17L6.5 10L12 10Z", fill: p.color, class: "ov-cas", "stroke-width": 1.2 }));
    const t = svg("text", { x: 14, y: 22, class: "live-name", fill: p.color });
    t.textContent = p.name || "Guest";
    g.append(t);
    scr.append(g);
  }
}

// ---- the session panel and dialogs
function renderLive() {
  const chip = $("sb-live");
  if (chip) {
    clear(chip);
    chip.hidden = !live.on;
    if (live.on) {
      const b = el("button", { type: "button", cls: "sb live", id: "live-chip", title: "Live session" }, [icon("live"), el("span", { text: "Live " + (live.peers.size + 1) })]);
      b.addEventListener("click", () => toggleLivePanel(true));
      chip.append(b);
    }
  }
  const panel = $("live-panel");
  if (!live.on) { if (panel) panel.remove(); return; }
  if (panel) fillLivePanel(panel);
}
function toggleLivePanel(open) {
  let p = $("live-panel");
  if (p && !open) { p.remove(); return; }
  if (!p) {
    p = el("section", { cls: "live-panel", id: "live-panel", "aria-label": "Live session" });
    // the panel sits over the sheet: keep its pointer events away from the drawing tools
    for (const ev of ["pointerdown", "pointermove", "pointerup", "dblclick", "wheel"]) p.addEventListener(ev, (e) => e.stopPropagation());
    viewer().append(p);
  }
  fillLivePanel(p);
}
function fillLivePanel(p) {
  clear(p);
  const head = el("header", null, [icon("live"), el("b", { text: "Live session" }), el("span", { cls: "mono", text: live.role === "host" ? "host" : "guest" })]);
  const x = el("button", { type: "button", cls: "iconbtn", "aria-label": "Hide the panel" }, [icon("close")]);
  x.addEventListener("click", () => toggleLivePanel(false));
  head.append(x);
  p.append(head);
  const people = el("ul", { cls: "people", id: "live-people" }, [el("li", null, [el("span", { cls: "dot", style: "--pc:" + peerColor(0) }), el("span", { cls: "n", text: liveName() + " (you)" }), live.role === "host" ? el("span", { cls: "cap", text: "Host" }) : null])]);
  for (const peer of live.peers.values()) {
    people.append(el("li", { cls: "peer" + (peer.open ? "" : " wait"), "data-peer": peer.id }, [el("span", { cls: "dot", style: "--pc:" + peer.color }), el("span", { cls: "n", text: peer.name || "Connecting..." }),
      peer.id === live.hostId ? el("span", { cls: "cap", text: "Host" }) : null,
      peer.pdfOk ? null : el("span", { cls: "warn", title: "Different PDF" }, [icon("review"), "other PDF"]),
      peer.fingerprint ? el("span", { cls: "mono fp", title: "Session fingerprint with this person: read it aloud, it must match theirs", text: peer.fingerprint }) : null]));
  }
  p.append(people);
  const fps = Array.from(live.peers.values()).filter((x) => x.fingerprint);
  p.append(el("div", { cls: "why small" }, [el("b", { text: "Check" }), el("span", { id: "live-fp", text: fps.length ? "Each line shows a session fingerprint. Read it to that person: when it matches what they see, the link is theirs and encrypted end to end." : "Waiting for someone to connect." })]));
  if (live.locked) p.append(el("p", { cls: "chip warn", text: "Locked by the host: only the host's changes are shared." }));
  else if (live.ownOnly && live.role !== "host") p.append(el("p", { cls: "chip warn", text: "Set by the host: you change only your own markups." }));
  const row = el("div", { cls: "row" });
  if (live.role === "host") {
    const inv = el("button", { type: "button", cls: "btn small", id: "live-invite" }, [icon("users"), "Invite"]);
    inv.addEventListener("click", () => openLiveDialog("host"));
    const lock = el("button", { type: "button", cls: "btn small", id: "live-lock", "aria-pressed": live.locked ? "true" : "false" }, [icon(live.locked ? "unlock" : "lock"), live.locked ? "Unlock" : "Lock"]);
    lock.addEventListener("click", () => { live.locked = !live.locked; broadcast({ t: "lock", locked: live.locked, own: live.ownOnly }); sendRoster(); renderLive(); });
    row.append(inv, lock);
    const own = el("input", { type: "checkbox", id: "live-own" });
    own.checked = live.ownOnly;
    own.addEventListener("change", () => { live.ownOnly = own.checked; broadcast({ t: "lock", locked: live.locked, own: live.ownOnly }); sendRoster(); renderLive(); });
    p.append(el("label", { cls: "chk", for: "live-own" }, [own, "Guests can edit only their own markups"]));
  }
  const leave = el("button", { type: "button", cls: "btn small danger", id: "live-leave" }, [icon("close"), live.role === "host" ? "End session" : "Leave"]);
  leave.addEventListener("click", () => endLiveSession(live.role === "host" ? "Session ended." : "You left the session."));
  row.append(leave);
  p.append(row);
}
function qrSvg(text) {
  let q;
  try { q = C.qr_encode(text, text.length > 1200 ? "L" : "M"); } catch (e) { return el("p", { cls: "help", text: "The code is too long for a QR code; copy it instead." }); }
  const n = q.size, quiet = 4, dim = n + quiet * 2;
  const s = svg("svg", { viewBox: "0 0 " + dim + " " + dim, class: "qr", role: "img", "aria-label": "QR code of the session code", "shape-rendering": "crispEdges" });
  s.append(svg("rect", { width: dim, height: dim, class: "qr-bg" }));
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules[y][x]) d += "M" + (x + quiet) + " " + (y + quiet) + "h1v1h-1z";
  s.append(svg("path", { d, class: "qr-fg" }));
  return s;
}
function codeBox(id, code, label) {
  const ta = el("textarea", { id, cls: "code", rows: 3, readonly: true, "aria-label": label });
  ta.value = code;
  const copy = el("button", { type: "button", cls: "btn small", id: id + "-copy" }, [icon("copy"), "Copy code"]);
  copy.addEventListener("click", () => copyText(code, "session code"));
  return el("div", { cls: "codebox" }, [qrSvg(code), el("div", { cls: "stack" }, [ta, copy])]);
}
function switchOffNotice(mode) {
  const on = el("button", { type: "button", cls: "btn primary", id: "live-switch-on", text: "Turn on Live session" });
  on.addEventListener("click", () => {
    S.settings.net = Object.assign({}, S.settings.net, { live: true });
    kvSet("settings", S.settings);
    closeDialog();
    openLiveDialog(mode);
  });
  openDialog({ title: "Live session is off", icon: "live", body: el("div", { cls: "stack" }, [
    el("p", { cls: "help", text: NET_SWITCHES.live.detail }),
    el("p", { cls: "help", text: "It is a network switch, off until you turn it on here or in Settings. Turning it off ends any session." }), on]),
  actions: [{ label: "Cancel" }] });
}
async function openLiveDialog(mode) {
  if (!S.doc) return;
  if (!switchOn("live")) { switchOffNotice(mode); return; }
  // the PDF check and the session fingerprint need real SHA-256, which browsers give secure pages only
  if (!(window.crypto && crypto.subtle)) { status("A live session needs the app opened over https (or from this device). Open it from its web address and try again.", "warn"); return; }
  if (live.on && mode === "join" && live.role === "host") { status("You are hosting a session. End it to join another.", "warn"); return; }
  if (mode === "host") {
    startLive("host");
    const body = el("div", { cls: "stack" }, [el("p", { cls: "help", text: "Creating an invitation..." })]);
    const d = openDialog({ title: "Invite a teammate", icon: "users", wide: true, body, actions: [{ label: "Close" }] });
    let inv;
    try { inv = await createInvite(); } catch (e) { clear(body).append(el("p", { cls: "chip bad", text: cleanName(e.message, 200) })); return; }
    const ans = el("textarea", { id: "live-answer-in", rows: 3, placeholder: C.CODE_PREFIX + "...", "aria-label": "Reply code" });
    const go = el("button", { type: "button", cls: "btn primary", id: "live-connect", text: "Connect" });
    const msg = el("p", { cls: "help", id: "live-connect-msg" });
    go.addEventListener("click", async () => {
      try { const a = await acceptAnswer(inv.id, ans.value); msg.textContent = "Connecting to " + a.name + "..."; setTimeout(() => { closeDialog(); toggleLivePanel(true); }, 400); }
      catch (e) { msg.textContent = cleanName(e.message, 200); }
    });
    clear(body).append(
      el("p", { cls: "help", text: "1. Give this code to one teammate (they choose Team, Join a live session). They can scan the QR code or paste the text. It holds this device's network address on your local network and the PDF fingerprint, nothing else." }),
      codeBox("live-offer-code", inv.code, "Invitation code"),
      el("p", { cls: "help", text: "2. Paste the reply code their screen shows, then Connect." }), ans, el("div", { cls: "row" }, [go]), msg);
    void d;
    return;
  }
  // join
  const inp = el("textarea", { id: "live-join-code", rows: 3, placeholder: C.CODE_PREFIX + "...", "aria-label": "Invitation code" });
  const go = el("button", { type: "button", cls: "btn primary", id: "live-join-go", text: "Join" });
  const out = el("div", { cls: "stack", id: "live-join-out" });
  const body = el("div", { cls: "stack" }, [el("p", { cls: "help", text: "Paste the invitation code from the host. Open the same PDF first: markups only go between people with the same file." }), inp]);
  if ("BarcodeDetector" in window && navigator.mediaDevices) {
    const scan = el("button", { type: "button", cls: "btn small", id: "live-scan" }, [icon("qr"), "Scan QR code"]);
    scan.addEventListener("click", () => scanQrInto(inp));
    body.append(scan);
  }
  body.append(el("div", { cls: "row" }, [go]), out);
  go.addEventListener("click", async () => {
    clear(out);
    startLive("guest");
    try {
      const r = await answerInvite(inp.value);
      if (!r.pdfOk) out.append(el("p", { cls: "chip warn", id: "live-pdf-warn", text: "The host has a different PDF open (fingerprint " + r.offer.pdf.slice(0, 8) + ", yours " + S.doc.id.slice(0, 8) + "). You can connect, but nothing is exchanged until you both open the same file." }));
      out.append(el("p", { cls: "help", text: "Give this reply code back to " + r.offer.name + "; it connects when they paste it." }), codeBox("live-answer-code", r.code, "Reply code"));
    } catch (e) { out.append(el("p", { cls: "chip bad", text: cleanName(e.message, 200) })); if (!live.peers.size) endLiveSession(); }
  });
  openDialog({ title: "Join a live session", icon: "users", wide: true, body, actions: [{ label: "Close", onClick: () => { if (live.peers.size) toggleLivePanel(true); } }] });
}
// Scan a QR code with the camera where the browser can read barcodes (it reads frames on this device).
async function scanQrInto(target) {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); } catch (e) { status("The camera is not available: paste the code instead.", "warn"); return; }
  const video = el("video", { playsinline: true, muted: true, cls: "scan-video" });
  video.srcObject = stream;
  await video.play().catch(() => {});
  const det = new window.BarcodeDetector({ formats: ["qr_code"] });
  const stop = () => { for (const t of stream.getTracks()) t.stop(); };
  openDialog({ title: "Scan the QR code", icon: "qr", body: video, onCancel: stop, actions: [{ label: "Cancel", onClick: stop }] });
  for (let i = 0; i < 600 && stream.active; i++) {
    try { const r = await det.detect(video); if (r && r[0] && r[0].rawValue && r[0].rawValue.startsWith(C.CODE_PREFIX)) { target.value = r[0].rawValue.slice(0, 40000); stop(); closeDialog(); return; } } catch (e) { /* next frame */ }
    await sleep(100);
  }
  stop();
}
