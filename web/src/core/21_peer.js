// Live session messages. Every peer is untrusted input: each message is checked field by field
// against a fixed set of types and sizes before anything reaches the takeoff, and each peer has a
// token bucket per kind of message. Markups go through clean_markup like any file. The PDF itself
// is never sent; peers compare its SHA-256.
const PEER_PROTOCOL = 1;
const PEER_MAX_BYTES = 1500000;
const PEER_TYPES = ["hello", "roster", "cursor", "draft", "put", "del", "comment", "lock", "bye", "signal", "state"];
// Tokens per second and burst per kind.
const PEER_RATES = { cursor: [40, 80], draft: [30, 60], put: [20, 200], del: [20, 200], comment: [5, 20], signal: [4, 16], other: [5, 20], state: [1, 3] };
const RE_HEX64 = /^[0-9a-f]{64}$/;
function _pname(v) { return Array.from(clean_text(v, 60)).slice(0, 60).join("").trim(); }
function _peer_pt(x, y) {
  const a = _num(x, -LIMITS.coord, LIMITS.coord), b = _num(y, -LIMITS.coord, LIMITS.coord);
  return a === null || b === null ? null : [a, b];
}
// A received message as a clean copy, or {error} saying why it was refused. ctx: numPages, host
// (true when the sender is the host), locked (session locked by the host).
function peer_message(msg, ctx) {
  const no = (why) => ({ error: why });
  if (!isObj(msg) || typeof msg.t !== "string" || !PEER_TYPES.includes(msg.t)) return no("unknown message type");
  const t = msg.t;
  const page = () => (Number.isInteger(msg.page) && msg.page >= 0 && msg.page < ctx.numPages ? msg.page : null);
  if (ctx.locked && !ctx.host && ["put", "del", "comment", "draft"].includes(t)) return no("the session is locked by the host");
  switch (t) {
    case "hello": {
      if (msg.v !== PEER_PROTOCOL) return no("another protocol version");
      const name = _pname(msg.name);
      const pdf = typeof msg.pdf === "string" && RE_HEX64.test(msg.pdf) ? msg.pdf : null;
      const peer = _id(msg.peer);
      if (!name || !pdf || !peer) return no("hello needs a name, the PDF fingerprint and a peer id");
      return { t, v: PEER_PROTOCOL, name, pdf, peer, host: msg.host === true };
    }
    case "roster": {
      if (!ctx.host) return no("only the host sends the roster");
      if (!Array.isArray(msg.peers) || msg.peers.length > 8) return no("bad roster");
      const peers = [];
      for (const p of msg.peers) { const id = isObj(p) ? _id(p.peer) : null, name = isObj(p) ? _pname(p.name) : ""; if (id && name) peers.push({ peer: id, name }); }
      return { t, peers, locked: msg.locked === true, own: msg.own === true };
    }
    case "cursor": {
      const pg = page(), p = _peer_pt(msg.x, msg.y);
      if (pg === null || !p) return no("bad cursor");
      return { t, page: pg, x: p[0], y: p[1] };
    }
    case "draft": {
      const pg = page();
      if (pg === null || !MARKUP_TYPES.includes(msg.type) || !Array.isArray(msg.points) || msg.points.length > 2000) return no("bad draft");
      const pts = _pts(msg.points, 2000);
      if (!pts) return no("bad draft points");
      return { t, page: pg, type: msg.type, points: pts };
    }
    case "put": {
      const m = clean_markup(msg.markup);
      if (!m) return no("the markup is not valid");
      if (m.page >= ctx.numPages) return no("the markup is on a page this PDF does not have");
      return { t, markup: m };
    }
    case "del": {
      const id = _id(msg.id);
      return id ? { t, id } : no("bad id");
    }
    case "comment": {
      const id = _id(msg.id), c = clean_comment(msg.comment);
      return id && c ? { t, id, comment: c } : no("bad comment");
    }
    case "lock": {
      if (!ctx.host) return no("only the host locks the session");
      return { t, locked: msg.locked === true, own: msg.own === true };
    }
    case "bye": return { t };
    case "signal": {
      const to = _id(msg.to), from = _id(msg.from);
      if (!to || !from || !["offer", "answer"].includes(msg.kind) || typeof msg.sdp !== "string" || msg.sdp.length > 20000 || !msg.sdp.startsWith("v=0")) return no("bad signal");
      return { t, to, from, kind: msg.kind, sdp: msg.sdp };
    }
    case "state": {
      if (ctx.locked && !ctx.host) return no("the session is locked by the host");
      if (!Array.isArray(msg.markups) || msg.markups.length > LIMITS.markups) return no("bad state");
      const out = [];
      for (const x of msg.markups) { const m = clean_markup(x); if (m && m.page < ctx.numPages) out.push(m); }
      return { t, markups: out };
    }
    default: return no("unknown message type");
  }
}
// Whether a peer may change a markup under the host's setting "Guests can edit only their own
// markups" (policy.own). Every device checks this on what it receives, so a guest's app cannot get
// around it. sender: {host, name, dup} where dup means another person in the session uses the same
// name (then nothing counts as theirs); existing: the markup as this device has it, or null;
// incoming: the markup sent, or null for a delete. A markup is a guest's own when its author is the
// guest's name in the session.
function peer_may_edit(policy, sender, existing, incoming) {
  if (!policy || !policy.own || !sender || sender.host) return true;
  if (!sender.name || sender.dup) return false;
  if (existing && (existing.author || "") !== sender.name) return false;
  if (incoming && (incoming.author || "") !== sender.name) return false;
  return true;
}
// The rate bucket a message counts against: its type when it is one we know, else "other", so
// made-up types share one small bucket and never add keys.
function peer_kind(msg) { return isObj(msg) && typeof msg.t === "string" && PEER_TYPES.includes(msg.t) ? msg.t : "other"; }
// Token bucket: returns [ok, next state]. state is { tokens, at } per kind (seconds).
function peer_rate(state, kind, now) {
  const [rate, burst] = has(PEER_RATES, kind) ? PEER_RATES[kind] : PEER_RATES.other;
  const s = state && typeof state.tokens === "number" ? state : { tokens: burst, at: now };
  const tokens = Math.min(burst, s.tokens + Math.max(0, now - s.at) * rate);
  if (tokens < 1) return [false, { tokens, at: now }];
  return [true, { tokens: tokens - 1, at: now }];
}
// Join codes: base64url text of a small JSON offer or answer (the page deflates it first).
const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function b64url_encode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63] + (i + 1 < bytes.length ? B64U[(n >> 6) & 63] : "") + (i + 2 < bytes.length ? B64U[n & 63] : "");
  }
  return out;
}
function b64url_decode(text) {
  const t = String(text || "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9_-]*$/.test(t) || t.length % 4 === 1) throw new TakeoffError("code", "This is not a session code");
  const out = [];
  for (let i = 0; i < t.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < t.length ? B64U.indexOf(t[i + k]) : 0));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    out.push((n >> 16) & 255);
    if (i + 2 < t.length) out.push((n >> 8) & 255);
    if (i + 3 < t.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}
const CODE_PREFIX = "SL1.";
// The unpacked code object, checked: {k: "offer" | "answer", sdp, name, pdf, peer, session}.
function session_code_check(obj) {
  if (!isObj(obj) || !["offer", "answer"].includes(obj.k)) throw new TakeoffError("code", "This is not a session code");
  if (typeof obj.sdp !== "string" || !obj.sdp.startsWith("v=0") || obj.sdp.length > 20000) throw new TakeoffError("code", "The code has no connection details");
  const name = _pname(obj.name), peer = _id(obj.peer), session = _id(obj.session);
  if (!name || !peer || !session) throw new TakeoffError("code", "The code is missing a name or id");
  if (typeof obj.pdf !== "string" || !RE_HEX64.test(obj.pdf)) throw new TakeoffError("code", "The code is missing the PDF fingerprint");
  return { k: obj.k, sdp: obj.sdp, name, pdf: obj.pdf, peer, session, host: obj.host === true };
}
// The DTLS certificate fingerprints in an SDP (a=fingerprint:sha-256 AB:CD:...).
function sdp_fingerprints(sdp) {
  const out = [];
  for (const m of String(sdp || "").matchAll(/^a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)\s*$/gm)) out.push(m[1].toLowerCase() + " " + m[2].toUpperCase());
  return Array.from(new Set(out)).sort();
}
// The text both sides hash for the session fingerprint: both certificates, sorted, so either side
// computes the same value.
function session_fingerprint_input(localSdp, remoteSdp) {
  return sdp_fingerprints(localSdp).concat(sdp_fingerprints(remoteSdp)).sort().join("\n");
}
// Four groups of four digits from the first 8 bytes of a hex digest: short enough to read aloud.
function fingerprint_groups(hex) {
  const groups = [];
  for (let i = 0; i < 4; i++) groups.push(String(parseInt(hex.slice(i * 4, i * 4 + 4), 16) % 10000).padStart(4, "0"));
  return groups.join(" ");
}
// Is this a local network address: a hidden mDNS name (name.local), an IPv4 address that the
// IANA special-purpose registry marks as not globally reachable (private, shared, loopback,
// link-local, documentation and benchmarking ranges), or a loopback, link-local or unique local
// IPv6 address.
function lan_address(addr) {
  const s = String(addr || "").toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{0,62}\.local$/.test(s)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]), c = Number(v4[3]);
    return a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (s.includes(":")) return s === "::1" || /^fe[89ab][0-9a-f]?:/.test(s) || /^f[cd][0-9a-f]{0,2}:/.test(s);
  return false;
}
// Local network only: keep host candidates on local addresses and drop server reflexive, relay
// and peer reflexive candidates and any host candidate on a public address. Used on both the
// offer we send and the one we receive, so a code cannot point this device at an outside host.
function sdp_lan_only(sdp) {
  return String(sdp).split(/\r?\n/).filter((l) => {
    if (!/^a=candidate:/.test(l)) return true;
    const f = l.slice(12).trim().split(/\s+/);
    const typ = f.indexOf("typ");
    return typ > 0 && f[typ + 1] === "host" && lan_address(f[4]);
  }).join("\r\n");
}
// @names in comment text (letters, digits, dot, dash, underscore).
function mentions(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/(^|[^\w@])@([A-Za-z0-9][\w.-]{0,40})/g)) { const n = m[2].replace(/[.-]+$/, ""); if (!out.includes(n)) out.push(n); }
  return out;
}
// Is this markup waiting on me: assigned to me, or an unresolved comment names me.
function assigned_to(m, me) {
  const who = String(me || "").trim().toLowerCase();
  if (!who) return false;
  const nameKey = who.replace(/\s+/g, "");
  if ((m.assignee || "").trim().toLowerCase() === who) return true;
  if (m.resolved) return false;
  return (m.comments || []).some((c) => !c.deleted && !c.resolved && mentions(c.text).some((n) => n.toLowerCase() === nameKey || n.toLowerCase() === who.split(/\s+/)[0]));
}
