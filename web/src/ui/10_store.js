// ---------------------------------------------------------------- storage: IndexedDB on this device
// Stores: docs (markups and settings per PDF, keyed by the PDF's SHA-256), files (a copy of each
// opened PDF so it reopens after a reload; can be turned off), kv (settings, tool chest), cache
// (page text, recognized text and thumbnails per PDF, rebuilt when missing; trimmed to a cap).
const DB_NAME = "field-tools-takeoff";
const STORES = ["docs", "files", "kv", "cache"];
let DB = null;

// A browser that never answers the open (seen with pages opened from a file in some browsers) must
// not hold the start-up: after IDB_WAIT_MS the app starts without storage and says so.
const IDB_WAIT_MS = 5000;
function idbOpen() {
  return new Promise((resolve, reject) => {
    let req, done = false;
    const timer = setTimeout(() => { done = true; reject(new Error("Storage did not answer.")); }, IDB_WAIT_MS);
    const finish = (fn, v) => { if (done) { if (fn === resolve && v && v.close) v.close(); return; } done = true; clearTimeout(timer); fn(v); };
    try { req = indexedDB.open(DB_NAME, 2); } catch (e) { finish(reject, e); return; }
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
    req.onsuccess = () => finish(resolve, req.result);
    req.onerror = () => finish(reject, req.error);
    req.onblocked = () => finish(reject, new Error("Another tab is upgrading storage. Close it and reload."));
  });
}
function idb(store, mode, fn) {
  return new Promise((resolve, reject) => {
    if (!DB) { resolve(undefined); return; }
    let tx;
    try { tx = DB.transaction(store, mode); } catch (e) { reject(e); return; }
    let out;
    const r = fn(tx.objectStore(store));
    if (r && "onsuccess" in r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Storage write was refused (the device may be full)."));
  });
}
const dbGet = (store, key) => idb(store, "readonly", (s) => s.get(key));
const dbPut = (store, key, val) => idb(store, "readwrite", (s) => s.put(val, key));
const dbDel = (store, key) => idb(store, "readwrite", (s) => s.delete(key));
const dbKeys = (store) => idb(store, "readonly", (s) => s.getAllKeys());
async function kvGet(key, dflt) { try { const v = await dbGet("kv", key); return v === undefined ? dflt : v; } catch (e) { return dflt; } }
async function kvSet(key, val) { try { await dbPut("kv", key, val); } catch (e) { status("Could not save settings: " + e.message, "bad"); } }

// The cache store: anything in it can be thrown away and rebuilt. Entries carry their write time;
// past CACHE_CAP entries the oldest go first.
const CACHE_CAP = 4000;
let cacheWrites = 0;
async function cacheGet(key, dflt) {
  try { const v = await dbGet("cache", key); return v && v.v !== undefined ? v.v : dflt; } catch (e) { return dflt; }
}
async function cacheSet(key, val) {
  try { await dbPut("cache", key, { v: val, t: Date.now() }); } catch (e) { return; }
  if (++cacheWrites % 200 === 0) trimCache();
}
async function trimCache() {
  try {
    const keys = await dbKeys("cache");
    if (keys.length <= CACHE_CAP) return;
    const ages = [];
    for (const k of keys) { const v = await dbGet("cache", k); ages.push([v && v.t || 0, k]); }
    ages.sort((a, b) => a[0] - b[0]);
    for (const [, k] of ages.slice(0, keys.length - CACHE_CAP)) await dbDel("cache", k);
  } catch (e) { /* the cache is optional */ }
}
async function storageInit() {
  try { DB = await idbOpen(); } catch (e) { DB = null; status("Storage is not available here, so work is not saved between visits.", "warn"); }
}
async function recentDocs() {
  if (!DB) return [];
  const keys = await dbKeys("docs");
  const out = [];
  for (const k of keys) {
    const d = await dbGet("docs", k);
    if (d && d.meta) out.push(Object.assign({ id: k }, d.meta));
  }
  out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return out;
}
async function storageUsage() {
  try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (e) { /* none */ }
  return null;
}
// Delete all data: the open plan set included. Pending autosaves are cancelled and storage is
// detached first, so nothing the open takeoff does afterwards can write it back; then every store
// is cleared and the database itself is deleted. The page reloads straight after.
async function deleteAllData() {
  clearTimeout(saveTimer);
  const db = DB;
  DB = null;
  if (db) {
    for (const s of STORES) {
      await new Promise((resolve) => {
        try { const tx = db.transaction(s, "readwrite"); tx.objectStore(s).clear(); tx.oncomplete = tx.onerror = tx.onabort = () => resolve(); } catch (e) { resolve(); }
      });
    }
    try { db.close(); } catch (e) { /* closed */ }
  }
  await new Promise((resolve) => {
    try { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve(); } catch (e) { resolve(); }
  });
  try { Object.keys(localStorage).filter((k) => k.startsWith("takeoff:")).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* none */ }
  // the on-device model's files, when AI on this device was used
  try { if (typeof caches !== "undefined") for (const k of ["webllm/config", "webllm/wasm", "webllm/model"]) await caches.delete(k); } catch (e) { /* none */ }
}
