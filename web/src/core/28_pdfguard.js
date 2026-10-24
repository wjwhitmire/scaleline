// Object streams in a PDF, found in its raw bytes before the PDF library reads the file. The library
// unpacks every object stream when it loads a file, so a stream that is tiny packed and enormous
// unpacked (a compression bomb), or one that claims millions of objects, could use up the memory
// of the page. The worker that reads and writes annotations checks each stream found here first,
// unpacking it with a byte limit, and refuses the file with a plain message when one is too large.
const OBJSTM_LIMITS = Object.freeze({ streams: 20000, objectsPerStream: 100000, objects: 2000000, unpackedPerStream: 64 * 1048576, unpacked: 512 * 1048576, ratio: 1000 });
function objstm_scan(bytes) {
  const b = bytes, n = b.length;
  const at = (i, s) => { for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false; return true; };
  const text = (i, j) => { let s = ""; for (let k = i; k < j && k < n; k++) s += String.fromCharCode(b[k]); return s; };
  const out = [];
  const T = "/ObjStm";
  for (let i = 0; i + T.length <= n; i++) {
    if (b[i] !== 0x2f || !at(i, T)) continue;
    const next = b[i + T.length];
    if (next !== undefined && /[A-Za-z0-9]/.test(String.fromCharCode(next))) continue;
    // the dictionary around it: back to "obj", forward to "stream"
    let s = i;
    while (s > 0 && i - s < 8192 && !at(s, "obj")) s--;
    let e = i;
    while (e < n && e - i < 8192 && !at(e, "stream")) e++;
    if (e >= n || !at(e, "stream")) continue;
    const dict = text(s, e);
    let dataStart = e + 6;
    if (b[dataStart] === 0x0d) dataStart++;
    if (b[dataStart] === 0x0a) dataStart++;
    const nm = /\/N\s+(\d+)/.exec(dict);
    const lm = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
    let length = lm && !lm[2] ? Number(lm[1]) : -1;
    if (length < 0 || dataStart + length > n) {
      let k = dataStart;
      while (k < n && !at(k, "endstream")) k++;
      length = Math.max(0, k - dataStart);
    }
    const filters = [];
    const fm = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dict);
    if (fm) for (const f of fm[1].match(/\/[A-Za-z0-9]+/g) || []) filters.push(f.slice(1));
    out.push({ at: i, start: dataStart, length, objects: nm ? Number(nm[1]) : 0, filters });
    i = dataStart + length;
    if (out.length > OBJSTM_LIMITS.streams) break;
  }
  return out;
}
// What the scan alone can refuse: too many streams or objects. Returns a message or null.
function objstm_check(list) {
  if (list.length > OBJSTM_LIMITS.streams) return "This PDF has more than " + OBJSTM_LIMITS.streams.toLocaleString("en-US") + " object streams; it is not read, to keep this page safe.";
  let total = 0;
  for (const s of list) {
    if (s.objects > OBJSTM_LIMITS.objectsPerStream) return "An object stream in this PDF claims " + s.objects.toLocaleString("en-US") + " objects; it is not read, to keep this page safe.";
    total += s.objects;
  }
  if (total > OBJSTM_LIMITS.objects) return "This PDF's object streams claim " + total.toLocaleString("en-US") + " objects; it is not read, to keep this page safe.";
  return null;
}
