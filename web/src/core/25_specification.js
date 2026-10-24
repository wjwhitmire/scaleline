// Specification check: sections of a project manual read locally (CSI MasterFormat numbers), matched
// against the takeoff both ways, every row with the text it came from. The same results as
// src/plantakeoff/specification.py (methods and limits are written there).
const { parse_sections, section_number, classify_item, match_scope, apply_classes, DIVISIONS } = (() => {
  const HEAD_SECTION = /^\s*SECTION\s+(\d{2})\s?(\d{2})\s?(\d{2})(?:\.(\d{2}))?\b\s*[-:.\u2013]?\s*(.*)$/i;
  const HEAD_OLD = /^\s*SECTION\s+(\d{5})\b\s*[-:.\u2013]?\s*(.*)$/i;
  const HEAD_BARE = /^\s*(\d{2})\s(\d{2})\s(\d{2})(?:\.(\d{2}))?\s+[-\u2013]?\s*([A-Z][A-Z0-9 ,&/()'-]{2,80})$/;
  const END = /^\s*END\s+OF\s+SECTION\b/i;
  const PART = /^\s*PART\s+([123])\b/i;
  const DIV = Object.freeze({
    "00": "Procurement and contracting requirements", "01": "General requirements", "02": "Existing conditions",
    "03": "Concrete", "04": "Masonry", "05": "Metals", "06": "Wood, plastics and composites",
    "07": "Thermal and moisture protection", "08": "Openings", "09": "Finishes", "10": "Specialties",
    "11": "Equipment", "12": "Furnishings", "13": "Special construction", "14": "Conveying equipment",
    "21": "Fire suppression", "22": "Plumbing", "23": "Heating, ventilating and air conditioning",
    "25": "Integrated automation", "26": "Electrical", "27": "Communications", "28": "Electronic safety and security",
    "31": "Earthwork", "32": "Exterior improvements", "33": "Utilities",
  });
  const WORDS = [
    [/\bdemo(lition|lish)?\b/i, "02 41 00", 4],
    [/\b(rebar|reinforc\w*|welded wire|mesh)\b/i, "03 20 00", 4],
    [/\b(concrete|slab|footing|foundation|sidewalk slab)\b/i, "03 30 00", 4],
    [/\b(masonry|cmu|block wall|brick)\b/i, "04 20 00", 4],
    [/\b(steel stud|metal stud|metal framing)\b/i, "09 22 16", 6],
    [/\b(gypsum|drywall|wallboard|partition)\b/i, "09 29 00", 4],
    [/\b(studs?|framing|plates?|lumber|joists?|rafters?|[1-4]x(?:4|6|8|10|12))\b/i, "06 10 00", 4],
    [/\b(sheathing|osb|plywood)\b/i, "06 16 00", 4],
    [/\b(insulation|batt)\b/i, "07 21 00", 4],
    [/\b(roof\w*|shingles?|underlayment)\b/i, "07 30 00", 3],
    [/\b(house wrap|weather barrier|vapor barrier)\b/i, "07 25 00", 4],
    [/\b(hardware|lockset|lever set|hinges?)\b/i, "08 71 00", 4],
    [/\b(doors?|frames?)\b/i, "08 10 00", 3],
    [/\b(windows?|glazing|storefront)\b/i, "08 50 00", 3],
    [/\b(acoustical|ceiling)\b/i, "09 51 00", 4],
    [/\b(flooring|vinyl|carpet|resilient|tile|lvt|vct)\b/i, "09 60 00", 3],
    [/\b(paint\w*|coating)\b/i, "09 91 00", 4],
    [/\b(toilet accessor\w*|signage)\b/i, "10 00 00", 2],
    [/\b(sprinklers?)\b/i, "21 13 00", 4],
    [/\b(plumbing|fixtures?|lavator\w*|water closet|sink|toilet)\b/i, "22 40 00", 3],
    [/\b(duct\w*|hvac|diffusers?|grilles?)\b/i, "23 00 00", 2],
    [/\b(receptacles?|outlets?|switch(es)?|wiring device\w*)\b/i, "26 27 26", 4],
    [/\b(lighting|luminaires?|light fixtures?)\b/i, "26 50 00", 3],
    [/\b(data|telecom\w*)\b/i, "27 00 00", 2],
    [/\b(excavat\w*|trench\w*|backfill|grading|earthwork)\b/i, "31 20 00", 3],
    [/\b(paving|asphalt|curbs?|sidewalks?)\b/i, "32 10 00", 3],
    [/\b(landscap\w*|sod|seeding|planting)\b/i, "32 90 00", 3],
  ];
  const clean = (s, cap) => (typeof s === "string" ? s : "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, cap);
  const digits = (n) => (n || "").replace(/\D/g, "");
  const numFrom = (m) => m[1] + " " + m[2] + " " + m[3] + (m[4] ? "." + m[4] : "");

  function sectionNumber(text) {
    if (typeof text !== "string") return null;
    const m = /^(\d{2})\s?(\d{2})\s?(\d{2})(?:\.(\d{2}))?$/.exec(text.trim());
    return m ? numFrom(m) : null;
  }
  function parseSections(lines) {
    if (!Array.isArray(lines)) throw new TakeoffError("input", "The project manual must be a list of lines");
    const rows = [];
    for (const ln of lines.slice(0, 200000)) {
      if (typeof ln === "string") rows.push([0, clean(ln, 400)]);
      else if (ln && typeof ln === "object" && !Array.isArray(ln)) {
        const pg = Number.isInteger(ln.page) && ln.page >= 0 && ln.page < 100000 ? ln.page : 0;
        rows.push([pg, clean(ln.str, 400)]);
      }
    }
    const secs = [];
    let cur = null;
    rows.forEach(([pg, s], i) => {
      if (!s) return;
      let head = null, m;
      if ((m = HEAD_SECTION.exec(s))) head = [numFrom(m), m[5], false];
      else if ((m = HEAD_OLD.exec(s))) head = [m[1], m[2], true];
      else if ((m = HEAD_BARE.exec(s))) head = [numFrom(m), m[5], false];
      if (head) {
        const [number, title, old] = head;
        cur = { number, title: clean(title, 120), division: number.slice(0, 2), division_name: DIV[number.slice(0, 2)] || "", page: pg, line: i, text: s, body: "", parts: [], old, ended: false };
        secs.push(cur);
        return;
      }
      if (cur === null || cur.ended) return;
      if (END.test(s)) { cur.ended = true; return; }
      const pm = PART.exec(s);
      if (pm && !cur.parts.includes(pm[1])) cur.parts.push(pm[1]);
      if (cur.body.length < 400) cur.body = (cur.body + " " + s).trim().slice(0, 400);
    });
    const out = [], index = new Map();
    for (const sec of secs) {
      delete sec.ended;
      const k = sec.number;
      if (index.has(k)) {
        const prev = out[index.get(k)];
        if (!prev.body && sec.body) { sec.listed = true; out[index.get(k)] = sec; } else prev.listed = true;
        continue;
      }
      index.set(k, out.length);
      out.push(sec);
    }
    for (const sec of out) { if (sec.listed === undefined) sec.listed = false; sec.parts.sort(); }
    return { sections: out, lines: rows.length };
  }
  function classifyItem(item) {
    const it = item && typeof item === "object" ? item : null;
    const code = it ? sectionNumber(clean(it.assembly_code, 40)) : null;
    if (code) return { number: code, digits: 6, source: "code", why: "assembly code " + code, also: [] };
    const text = it ? ["label", "subject", "layer", "assembly_name"].map((k) => clean(it[k], 200)).join(" ") : "";
    const found = [];
    for (const [rx, number, d] of WORDS) {
      const m = rx.exec(text);
      if (m && !found.some((f) => f.number === number)) found.push({ number, digits: d, why: 'the word "' + m[0] + '"' });
    }
    if (!found.length) return null;
    return Object.assign({}, found[0], { source: "words", also: found.slice(1) });
  }
  const counts = (rows) => { const c = {}; for (const r of rows) c[r.status] = (c[r.status] || 0) + 1; return c; };
  function matchScope(sections, items) {
    const secs = (sections || []).filter((s) => s && typeof s === "object" && typeof s.number === "string");
    const its = [];
    for (const it of items || []) {
      if (!it || typeof it !== "object") continue;
      const q = it.quantity;
      its.push({ id: clean(it.id, 64), label: clean(it.label, 200) || clean(it.subject, 200), assembly: clean(it.assembly_name, 200),
        quantity: typeof q === "number" && Number.isFinite(q) ? q : null, unit: clean(it.unit, 20), cls: classifyItem(it) });
    }
    const rows = [], used = new Set();
    for (const s of secs) {
      const sd = digits(s.number), hits = [];
      its.forEach((it, k) => {
        const c = it.cls;
        if (!c) return;
        for (const cc of [c].concat(c.also)) {
          const id = digits(cc.number);
          if (s.old ? sd.slice(0, 2) === id.slice(0, 2) : sd.slice(0, cc.digits) === id.slice(0, cc.digits)) { hits.push(k); it.hitWhy = cc.why; break; }
        }
      });
      const source = { page: s.page, text: s.text, body: s.body };
      if (hits.length) {
        for (const k of hits) used.add(k);
        rows.push({ status: "matched", section: s.number, title: s.title, source,
          items: hits.map((k) => ({ id: its[k].id, label: its[k].label, quantity: its[k].quantity, unit: its[k].unit, why: its[k].hitWhy })) });
      } else if (s.division === "00" || s.division === "01") rows.push({ status: "general", section: s.number, title: s.title, source, items: [] });
      else rows.push({ status: "no quantities", section: s.number, title: s.title, source, items: [] });
    }
    const divs = new Set(secs.map((s) => s.division));
    its.forEach((it, k) => {
      if (used.has(k)) return;
      const src = { page: null, text: it.label + (it.assembly ? " (" + it.assembly + ")" : ""), body: "" };
      const entry = { id: it.id, label: it.label, quantity: it.quantity, unit: it.unit };
      const c = it.cls;
      if (!c) { rows.push({ status: "not classified", section: "", title: "", source: src, items: [entry] }); return; }
      entry.why = c.why;
      const div = c.number.slice(0, 2);
      rows.push({ status: divs.has(div) ? "division only" : "no section", section: c.number, title: DIV[div] || "", source: src, items: [entry] });
    });
    return { rows, counts: counts(rows) };
  }
  function applyClasses(result, answers, sections) {
    const allowed = new Map(sections.map((s) => [s.number, s]));
    const rejected = [], rows = [];
    for (const r of result.rows) {
      if (r.status !== "not classified") { rows.push(r); continue; }
      let it = r.items[0];
      const ans = answers && typeof answers === "object" && Object.prototype.hasOwnProperty.call(answers, it.id) ? answers[it.id] : null;
      const n = typeof ans === "string" ? sectionNumber(ans) : null;
      if (n && allowed.has(n)) {
        it = Object.assign({}, it, { why: "classified by the model (check it)" });
        rows.push({ status: "matched", section: n, title: allowed.get(n).title, source: r.source, items: [it], model: true });
      } else {
        if (ans !== null && ans !== undefined) rejected.push(it.id);
        rows.push(r);
      }
    }
    return [{ rows, counts: counts(rows) }, rejected];
  }
  return { parse_sections: parseSections, section_number: sectionNumber, classify_item: classifyItem, match_scope: matchScope, apply_classes: applyClasses, DIVISIONS: DIV };
})();
