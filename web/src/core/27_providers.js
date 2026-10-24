// "AI with your own key": one kind of service, any service with an OpenAI-compatible chat
// completions API, hosted or a model server on this computer. The person gives its base address,
// a model id and a key. This file builds the exact request and reads the reply. Pure: no network
// here (the interface sends the request through the network gate after the person has seen it).
// The key goes only in the request's authorization header; the preview shows it masked. A PDF goes
// only when the person ticks it, as a file part of the question.
const { AI_SERVICE, ai_endpoint, provider_request, provider_preview, provider_reply, provider_tool_turns, LOCAL_MODEL } = (() => {
  const SERVICE = Object.freeze({ label: "Your own AI service (OpenAI-compatible API)", path: "/chat/completions" });
  // The on-device model (WebLLM on WebGPU): the library and the model library pinned by version,
  // commit and SHA-384, and the model's own files pinned to one immutable revision of its repository
  // (the commit, in every address, never "main"), each with its size and hash as the repository
  // lists them: SHA-256 for the weight shards (their LFS object ids), the git blob id (SHA-1 of
  // "blob <size>\0" and the bytes) for the three small JSON files that git keeps directly. The
  // interface checks every file before WebLLM may read it (see web/src/ui/86_ask.js).
  const REV = "9bd564b064631febf14deadcac492efb761d60c3";
  const REPO = "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
  const LOCAL = Object.freeze({
    lib: "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/lib/index.js",
    libSri: "sha384-5MijLIyJ9qCCduGUqcQWzGRAlKv5QcEBdmvFE2ScHZty1UnxxUKWE+Xc8uzMWKUE",
    model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    revision: REV,
    weights: "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC/resolve/9bd564b064631febf14deadcac492efb761d60c3/",
    modelLib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/00fe7a40e57e5e8eb9fef87526a4bf28ad5846c0/web-llm-models/v0_2_84/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
    modelLibSri: "sha384-FBvWNtRNIYDNCzQgX2mqvP9zNj49hM0VsGivHw5Jl+LESLn5cnajYCei4ahrC3PI",
    // [file, bytes, hash]: the files WebLLM 0.2.84 reads for this model, in the order it reads them
    files: Object.freeze([
      ["mlc-chat-config.json", 2043, { git: "f3c0d0fead8e572882c174f8150f968743f9c9c4" }],
      ["tokenizer.json", 7031645, { git: "443909a61d429dff23010e5bddd28ff530edda00" }],
      ["tensor-cache.json", 124489, { git: "ec11c25c3311f24d7867e21699779e259f996404" }],
      ["params_shard_0.bin", 116686848, { sha256: "29e46841454786b2c36cbcfd1d9a0777f8cb2bb55fb7cdf9ebd3df6ea6aa61f6" }],
      ["params_shard_1.bin", 22330368, { sha256: "a99a03870f60127bdc3891f0bdc13a0f6e25efa984e9a5d6b188b5aae6f4fbae" }],
      ["params_shard_2.bin", 26331136, { sha256: "c67f6aff8524441396efaa09488ea4536437e35389e0843d87fda796be9d3412" }],
      ["params_shard_3.bin", 26331136, { sha256: "b14d44d720b45dbedd9c7786f1f9db1ce79392fcda0ecc8cbd6deddef6ca3ebd" }],
      ["params_shard_4.bin", 26331136, { sha256: "e96c7b30a24f581df1ee5758e1697a214187a89e9e9bc93529950e2f16beecbf" }],
      ["params_shard_5.bin", 26331136, { sha256: "8370ade73f96fe5cdb4a816da39703032ca5610699e9714790e6e9c49be5086e" }],
      ["params_shard_6.bin", 26331136, { sha256: "48e651ada394e162b0bb016d8b3e340a8d29b0b67e06121ecdc6c368eec1b96d" }],
      ["params_shard_7.bin", 26331136, { sha256: "9eb581bc89582d23c43f66197a63ca2e80291c32eefd66695f6b6eaedf3e24ab" }],
      ["params_shard_8.bin", 26331136, { sha256: "f8d5dfd8eaf86d361d20310d1d9aa7ba661156112d8524874aae78410cb3b663" }],
      ["params_shard_9.bin", 26331136, { sha256: "ace7a4a00e819481571e08ead14f031e3b014f6f8cef665142b6b6463045b493" }],
      ["params_shard_10.bin", 26331136, { sha256: "cbe9fa5eaff5463502bf9cc766b39081482e7df30ffc250d8f3e83c45d1700d1" }],
      ["params_shard_11.bin", 26331136, { sha256: "f99e7bfc14e17d88d905360dd1f0ecbaab98d5778acdd762e397254c293a2b42" }],
      ["params_shard_12.bin", 26331136, { sha256: "3ec7ea81f305fc10b5ed9958ae279486d113d2621029f5f4a4cb820bc803c2ca" }],
      ["params_shard_13.bin", 26331136, { sha256: "6eb032a6d30b5d2bbf4b0d16ecdfaf6fa295dffa676e828917d5f8fe4d4d7ef2" }],
      ["params_shard_14.bin", 26331136, { sha256: "e1a10d9e18641e9eab280e7c9cb4c7ee05b6dc3ab35b244ffe559da00b1fc950" }],
      ["params_shard_15.bin", 26331136, { sha256: "fe24b3ddc07e311556e6968bb62506ae8980ca1ec55393f12ae41de468d93067" }],
      ["params_shard_16.bin", 26331136, { sha256: "f86a010144bfae8748ac0abdd705d3d9c54bcb864bc51a4b7d3da8dab7d6c379" }],
      ["params_shard_17.bin", 26331136, { sha256: "b473e5c8b5c226c751a393d666066cb6e8b1bf7e61604691a31fea2f82abef66" }],
      ["params_shard_18.bin", 26331136, { sha256: "e36912a08ea82dfdcad4ebc288a6541d2112038e987d98f7f2f5cd8f8957cf2d" }],
      ["params_shard_19.bin", 26331136, { sha256: "795125e8c8eb20e28733df956ab32bb57ea2376ec99cd84b4d36f8f6f32b1f42" }],
      ["params_shard_20.bin", 26331136, { sha256: "ea919f0b2a79aa359eab6cc8003dfce9cf7c742fe254651211793eb56bfb3122" }],
      ["params_shard_21.bin", 26331136, { sha256: "221e4cef4c28ac298fd44678378e506188a537f2752e0aba2f45066fdee27a85" }],
      ["params_shard_22.bin", 26331136, { sha256: "13c31268f630b52a72c158f2b7d97a672d128e760540b318566cfd70fe5e62ee" }],
      ["params_shard_23.bin", 26331136, { sha256: "498c729548a5afbf07735b0183534867cad01dc57132ae1e8802041f193f6f23" }],
      ["params_shard_24.bin", 26331136, { sha256: "103fdc607fcb3dc31d0861999f1f692768a3e2edfa81ef2f53eefc6713caf8ae" }],
      ["params_shard_25.bin", 26331136, { sha256: "d60dffdf3c88f4990e04a18c343a0ce479b8f98960afb75154a1a835f29f6ea4" }],
      ["params_shard_26.bin", 26331136, { sha256: "086adb852f72e13c69f0cd06628375f4d5810d8fb8e00450fb1e1c964b510f77" }],
      ["params_shard_27.bin", 26331136, { sha256: "473be20481f3a4dcdb7128827edfe16e92c6d1b3019c330ff4dd05156a1f9a43" }],
      ["params_shard_28.bin", 26331136, { sha256: "a7f2c9235da81fce6230b160007449d8f000a1f8c57a68313dce91ca080f088f" }],
      ["params_shard_29.bin", 18589696, { sha256: "59a8497760bc9da56ce4619e082490c607b3f107bad7ec312fb33ce1a0d3dc71" }],
    ].map((f) => Object.freeze({ name: f[0], url: REPO + "/resolve/" + REV + "/" + f[0], bytes: f[1], sha256: f[2].sha256 || null, git: f[2].git || null,
      scope: f[0] === "mlc-chat-config.json" ? "webllm/config" : "webllm/model" }))),
    approxBytes: 8.8e8, vramMB: 1630, contextTokens: 4096,
  });
  const err = (m) => new TakeoffError("provider", m);

  // The address requests go to, from the base address the person typed: https to any host, or
  // http only to a model server on this computer (localhost or 127.0.0.1). No user name, password,
  // query or fragment. The chat completions path is added unless the address already ends with it.
  function endpoint(base) {
    const raw = typeof base === "string" ? base.trim() : "";
    if (!raw) return { ok: false, why: "Type the service's base address, such as https://example.org/v1." };
    if (/[@\s?#\\]/.test(raw)) return { ok: false, why: "The address cannot carry a user name, password, query or fragment." };
    const m = /^([Hh][Tt][Tt][Pp][Ss]?):\/\/([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?(\/[A-Za-z0-9._~%\/-]*)?$/.exec(raw);
    if (!m || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(m[2].toLowerCase()) || (m[3] && Number(m[3]) > 65535)) {
      return { ok: false, why: "That is not a web address." };
    }
    const scheme = m[1].toLowerCase(), hostname = m[2].toLowerCase();
    const local = hostname === "localhost" || hostname === "127.0.0.1";
    if (!(scheme === "https" || local)) return { ok: false, why: "Use an https address, or http only for a server on this computer (localhost or 127.0.0.1)." };
    const port = m[3] && Number(m[3]) !== (scheme === "https" ? 443 : 80) ? ":" + Number(m[3]) : "";
    const host = hostname + port, origin = scheme + "://" + host;
    let path = (m[4] || "").replace(/\/+$/, "");
    if (!path.endsWith(SERVICE.path)) path += SERVICE.path;
    const url = origin + path;
    return { ok: true, url, host, origin, local };
  }
  // messages: [{role: system|user|assistant|tool, content, calls?: [{id, name, args}], call_id?}]
  function request(base, model, key, messages, tools, opts) {
    const ep = endpoint(base);
    if (!ep.ok) throw err(ep.why);
    const m = typeof model === "string" ? model.trim() : "";
    if (!/^[A-Za-z0-9._:\/@+-]{1,120}$/.test(m)) throw err("Type the model id the service uses.");
    const k = typeof key === "string" ? key.trim() : "";
    if (!ep.local && k.length < 10) throw err("Paste your API key. It is kept on this device only.");
    if (/[\r\n]/.test(k)) throw err("The key cannot hold a line break.");
    const o = opts || {};
    const pdf = o.attachPdf && o.pdf && typeof o.pdf.base64 === "string" ? o.pdf : null;
    const sys = messages.filter((x) => x.role === "system").map((x) => x.content).join("\n\n");
    const rest = messages.filter((x) => x.role !== "system");
    const lastUser = rest.map((x) => x.role).lastIndexOf("user");
    const out = [{ role: "system", content: sys }];
    rest.forEach((x, i) => {
      if (x.role === "tool") out.push({ role: "tool", tool_call_id: x.call_id, content: x.content });
      else if (x.role === "assistant" && x.calls && x.calls.length) {
        out.push({ role: "assistant", content: x.content || null, tool_calls: x.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) });
      } else if (x.role === "user" && i === lastUser && pdf) {
        out.push({ role: "user", content: [{ type: "file", file: { filename: (pdf.name || "plans.pdf").slice(0, 120), file_data: "data:application/pdf;base64," + pdf.base64 } }, { type: "text", text: x.content }] });
      } else out.push({ role: x.role, content: x.content });
    });
    const body = { model: m, messages: out, max_tokens: 1024 };
    if (tools && tools.length) body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const headers = { "content-type": "application/json" };
    if (k) headers.authorization = "Bearer " + k;
    return { url: ep.url, host: ep.host, headers, body: JSON.stringify(body) };
  }
  // What the person sees before anything is sent: the address, the headers with the key masked, and
  // the body exactly as it will be sent (a PDF shows as its size, not its bytes).
  function preview(req) {
    const h = {};
    for (const k of Object.keys(req.headers)) {
      const v = req.headers[k];
      h[k] = k === "authorization" ? "Bearer (your key, " + (v.length - 7) + " characters)" : v;
    }
    const body = req.body.replace(/("file_data":"data:application\/pdf;base64,)([A-Za-z0-9+/=]{200,})"/g, (x, a, b) => a + "(PDF, " + Math.round(b.length * 0.75 / 1024) + " KB)\"");
    return { url: req.url, headers: h, body, bytes: req.body.length };
  }
  // A reply: {text, calls: [{id, name, args}]}. Unknown shapes give empty text and no calls.
  function reply(json) {
    if (!json || typeof json !== "object") return { text: "", calls: [] };
    const m = Array.isArray(json.choices) && json.choices[0] && json.choices[0].message ? json.choices[0].message : null;
    if (!m) return { text: "", calls: [] };
    const calls = [];
    for (const c of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
      if (!c || !c.function || typeof c.function.name !== "string") continue;
      let args = {};
      try { const v = JSON.parse(c.function.arguments || "{}"); if (v && typeof v === "object" && !Array.isArray(v)) args = v; } catch (e) { args = {}; }
      calls.push({ id: String(c.id || "").slice(0, 100), name: c.function.name.slice(0, 60), args });
    }
    return { text: typeof m.content === "string" ? m.content : "", calls };
  }
  // The transcript turns for a round of tool calls and their results (results as JSON text).
  function toolTurns(text, calls, results) {
    const turns = [{ role: "assistant", content: text || "", calls }];
    calls.forEach((c, i) => turns.push({ role: "tool", call_id: c.id, content: JSON.stringify(results[i]) }));
    return turns;
  }
  return { AI_SERVICE: SERVICE, ai_endpoint: endpoint, provider_request: request, provider_preview: preview, provider_reply: reply, provider_tool_turns: toolTurns, LOCAL_MODEL: LOCAL };
})();
