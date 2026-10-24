// ---------------------------------------------------------------- network: one gate, four switches
// Every way out of this page passes through this file. There are four network switches, all off
// by default, set in Settings:
//   OCR           a one-time download of the text recognition language data: one pinned file from
//                 one host, checked against its SHA-384 before it is kept; on the Pages build also
//                 the text engine itself, one pinned file from this same site;
//   AI on this device     the model library (pinned, checked) and then the pinned model files, once
//   AI with your own key  requests to the one service address the person sets, with their key
//   Live session  peer-to-peer connections (WebRTC data channels) to teammates. With no STUN host
//                 set it uses local network addresses only and contacts no server at all.
// fetch appears only in net() and RTCPeerConnection only in netPeer(); the headless tests check that
// the page makes no request with every switch off.
const OCR_DATA = Object.freeze({
  url: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz",
  sri: "sha384-JI+fraGAoc5GBGIliuqzHRnP1nJyrukg5ggNSBv/TO+YOVj+6Te6XXQOx7ia10xq",
  bytes: 2952873,
  lang: "eng",
});
// The text engine's WebAssembly: embedded in the single-file page (web/app.html); the Pages build
// keeps it in a separate file next to the page so the page stays small, and fetches it from this
// site only when OCR is used. Either way it is checked against this pin before it runs.
const OCR_WASM = Object.freeze(/*OCR_WASM_PIN*/);
const OCR_WASM_URL = new URL(OCR_WASM.file, document.baseURI).href;
const NET_SWITCHES = Object.freeze({
  ocr: Object.freeze({ title: "OCR", detail: "Text recognition for scanned sheets. Turning it on allows one download of the English language data (" +
    (OCR_DATA.bytes / 1048576).toFixed(1) + " MB) from cdn.jsdelivr.net, pinned and checked against its fingerprint, and loads the text engine from this site the same way. The recognition itself runs on this device." }),
  "ai-local": Object.freeze({ title: "AI on this device", detail: "Answers questions about your plans with a small open model that runs here, on the graphics chip (WebGPU). Turning it on allows one download of the model, about " +
    C.format_number(C.LOCAL_MODEL.approxBytes / 1e9, 1) + " GB, from huggingface.co (one fixed revision) and raw.githubusercontent.com, with its library from cdn.jsdelivr.net; every file is pinned by its hash and checked before it is used, and the browser keeps them, so it downloads once. It needs about " +
    C.format_number(C.LOCAL_MODEL.vramMB / 1024, 1) + " GB of graphics memory. Nothing about your plans leaves this device." }),
  "ai-cloud": Object.freeze({ title: "AI with your own key", detail: "Answers questions with the AI service you set below (any service with an OpenAI-compatible chat completions API, or a model server on this computer), using your key, which stays on this device. Before anything is sent you see exactly what goes: the question and the takeoff data the model may read, never the PDF unless you tick it. That service's terms apply to what you send." }),
  live: Object.freeze({ title: "Live session", detail: "Work on the same plan set with teammates at the same time, peer to peer. Markups, cursors and comments go directly between devices, encrypted; the PDF never leaves this device. With no STUN host set, only the local network is used." }),
});
const NET_FEATURES = Object.freeze({
  ocr: Object.freeze({ title: "OCR", urls: Object.freeze([OCR_DATA.url, OCR_WASM_URL]) }),
  // the library, the model library and each pinned model file, every one fetched here and checked
  // against its pin before WebLLM may read it (WebLLM itself fetches nothing: see 86_ask.js). The
  // repository answers a weight file with a redirect to its file store; only redirects to the
  // repository's own hosts are followed, and the bytes are checked against their SHA-256 anyway.
  "ai-local": Object.freeze({ title: "AI on this device", urls: Object.freeze([C.LOCAL_MODEL.lib, C.LOCAL_MODEL.modelLib].concat(C.LOCAL_MODEL.files.map((f) => f.url))),
    redirectHosts: Object.freeze(["huggingface.co", "hf.co"]) }),
  // exactly the one address set in Settings (https, or http only to a server on this computer)
  "ai-cloud": Object.freeze({ title: "AI with your own key", urls: null }),
});
function switchOn(name) {
  return !!(S.settings.net && Object.prototype.hasOwnProperty.call(S.settings.net, name) && S.settings.net[name] === true);
}
function netDecision(feature, url) {
  const f = Object.prototype.hasOwnProperty.call(NET_FEATURES, feature) ? NET_FEATURES[feature] : null;
  if (!f) return { ok: false, reason: "no such network feature" };
  if (!switchOn(feature)) return { ok: false, reason: f.title + " is off" };
  let u;
  try { u = new URL(url); } catch (e) { return { ok: false, reason: "not a web address" }; }
  const service = feature === "ai-cloud" ? C.ai_endpoint(S.settings.aiBase || "") : null;
  const urls = service ? (service.ok ? [service.url] : []) : f.urls;
  // https only, except for a file from this same site (which a local server may serve over http)
  // and a model server on this computer that Settings names
  const plainOk = u.origin === location.origin || (service && service.ok && service.local && u.origin === service.origin);
  if ((u.protocol !== "https:" && !plainOk) || !urls.includes(u.href)) return { ok: false, reason: u.hostname + " is not allowed" };
  return { ok: true };
}
async function net(feature, url, opts) {
  const d = netDecision(feature, url);
  if (!d.ok) throw new Error("Blocked: " + d.reason + ".");
  const hosts = NET_FEATURES[feature].redirectHosts || null;
  const r = await fetch(url, Object.assign({}, opts || {}, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: hosts ? "follow" : "error" }));
  if (r.redirected) {
    let h = "";
    try { h = new URL(r.url).hostname; } catch (e) { h = ""; }
    if (!hosts || !hosts.some((x) => h === x || h.endsWith("." + x))) throw new Error("Blocked: a redirect to " + (h || "an unknown address") + ".");
  }
  return r;
}
// A STUN host as written in Settings: a host name or IPv4 address with an optional port.
function stunServer(host) {
  const h = String(host || "").trim();
  if (!h) return null;
  const m = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+|\d{1,3}(\.\d{1,3}){3})(:(\d{1,5}))?$/i.exec(h);
  if (!m || (m[7] && Number(m[7]) > 65535)) return null;
  return "stun:" + h.toLowerCase();
}
// The only place a peer connection is made. Off unless the Live session switch is on.
function netPeer() {
  if (!switchOn("live")) throw new Error("Blocked: Live session is off. Turn it on in Settings.");
  if (typeof RTCPeerConnection !== "function") throw new Error("This browser has no peer-to-peer connections.");
  const stun = stunServer(S.settings.stunHost);
  return new RTCPeerConnection({ iceServers: stun ? [{ urls: stun }] : [], iceCandidatePoolSize: 0, bundlePolicy: "max-bundle" });
}
