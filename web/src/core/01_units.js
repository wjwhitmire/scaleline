// Units. Real lengths are inches, areas square inches, volumes cubic inches. Exact factors
// (1 in = 25.4 mm). Mirrors src/plantakeoff/units.py.
class TakeoffError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = "TakeoffError"; }
}
const LENGTH = { in: 1, ft: 12, yd: 36, mi: 63360, mm: 1 / 25.4, cm: 10 / 25.4, m: 1000 / 25.4, pt: 1 / 72 };
const AREA = { sq_in: 1, sf: 144, sy: 1296, sq_mm: (1 / 25.4) ** 2, sq_cm: (10 / 25.4) ** 2, sm: (1000 / 25.4) ** 2, acre: 43560 * 144 };
const VOLUME = { cu_in: 1, cf: 1728, cy: 46656, cu_m: (1000 / 25.4) ** 3, l: (100 / 25.4) ** 3, gal: 231 };
const UNIT_LABELS = {
  in: "in", ft: "ft", yd: "yd", mi: "mi", mm: "mm", cm: "cm", m: "m", pt: "pt", ftin: "ft-in",
  sq_in: "sq in", sf: "SF", sy: "SY", sq_mm: "sq mm", sq_cm: "sq cm", sm: "m2", acre: "ac",
  cu_in: "cu in", cf: "CF", cy: "CY", cu_m: "m3", l: "L", gal: "gal",
};
const AREA_FOR = { ftin: "sf", ft: "sf", in: "sq_in", yd: "sy", m: "sm", cm: "sq_cm", mm: "sm", mi: "sf" };
const VOLUME_FOR = { ftin: "cy", ft: "cf", in: "cu_in", yd: "cy", m: "cu_m", cm: "cu_m", mm: "cu_m", mi: "cy" };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function to_inches(value, unit) {
  if (unit === "ftin") unit = "ft";
  if (!has(LENGTH, unit)) throw new TakeoffError("unit", "Unknown length unit: " + unit);
  return Number(value) * LENGTH[unit];
}
function from_inches(inches, unit) {
  if (unit === "ftin") unit = "ft";
  if (!has(LENGTH, unit)) throw new TakeoffError("unit", "Unknown length unit: " + unit);
  return Number(inches) / LENGTH[unit];
}
function area_from_sq_in(v, unit) {
  if (!has(AREA, unit)) throw new TakeoffError("unit", "Unknown area unit: " + unit);
  return Number(v) / AREA[unit];
}
function area_to_sq_in(v, unit) {
  if (!has(AREA, unit)) throw new TakeoffError("unit", "Unknown area unit: " + unit);
  return Number(v) * AREA[unit];
}
function volume_from_cu_in(v, unit) {
  if (!has(VOLUME, unit)) throw new TakeoffError("unit", "Unknown volume unit: " + unit);
  return Number(v) / VOLUME[unit];
}
function volume_to_cu_in(v, unit) {
  if (!has(VOLUME, unit)) throw new TakeoffError("unit", "Unknown volume unit: " + unit);
  return Number(v) * VOLUME[unit];
}
function convert(value, src, dst) {
  for (const table of [LENGTH, AREA, VOLUME]) {
    const s = src === "ftin" && table === LENGTH ? "ft" : src;
    const d = dst === "ftin" && table === LENGTH ? "ft" : dst;
    if (has(table, s) && has(table, d)) return Number(value) * table[s] / table[d];
  }
  throw new TakeoffError("unit", "Cannot convert " + src + " to " + dst);
}
function unit_kind(unit) {
  if (unit === "ftin" || has(LENGTH, unit)) return "length";
  if (has(AREA, unit)) return "area";
  if (has(VOLUME, unit)) return "volume";
  if (unit === "ea" || unit === "count") return "count";
  throw new TakeoffError("unit", "Unknown unit: " + unit);
}

// ---------------------------------------------------------------- parsing
const NUM = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
const FRAC = String.raw`(?:\d+\s*/\s*\d+)`;
const MIXED = String.raw`(?:${NUM}(?:[\s-]+${FRAC})?|${FRAC})`;
const RE_FT_IN = new RegExp(String.raw`^\s*(${NUM})\s*(?:'|ft\b|feet\b|foot\b)\s*-?\s*(?:(${MIXED})\s*(?:"|''|in\b|inch\b|inches\b)?)?\s*$`, "i");
const RE_IN_ONLY = new RegExp(String.raw`^\s*(${MIXED})\s*(?:"|''|in\b|inch\b|inches\b)\s*$`, "i");
const RE_WITH_UNIT = new RegExp(String.raw`^\s*(${NUM})\s*(mm|cm|m|yd|yards?|meters?|metres?|millimeters?|centimeters?)\s*$`, "i");
const RE_BARE = new RegExp(String.raw`^\s*(${MIXED})\s*$`);
const UNIT_WORDS = {
  mm: "mm", millimeter: "mm", millimeters: "mm", cm: "cm", centimeter: "cm", centimeters: "cm",
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m", yd: "yd", yard: "yd", yards: "yd",
};

function mixed(text) {
  const t = text.trim();
  let m = new RegExp(String.raw`^(${NUM})[\s-]+(\d+)\s*/\s*(\d+)$`).exec(t);
  if (m) {
    const den = parseInt(m[3], 10);
    if (den === 0) throw new TakeoffError("parse", "Division by zero in a fraction");
    return parseFloat(m[1]) + parseInt(m[2], 10) / den;
  }
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) {
    const den = parseInt(m[2], 10);
    if (den === 0) throw new TakeoffError("parse", "Division by zero in a fraction");
    return parseInt(m[1], 10) / den;
  }
  return parseFloat(t);
}
function normQuotes(s) {
  return s.replace(/′/g, "'").replace(/″/g, '"').replace(/’/g, "'").replace(/”/g, '"');
}
function parse_length(text, default_unit) {
  if (default_unit === undefined) default_unit = "ft";
  if (typeof text !== "string") throw new TakeoffError("parse", "A length must be text");
  const t = normQuotes(text.trim());
  if (!t || t.length > 64) throw new TakeoffError("parse", "Type a length such as 12'-6\" or 3.5 m");
  let m = RE_FT_IN.exec(t);
  if (m) {
    let inches = parseFloat(m[1]) * 12;
    if (m[2]) inches += mixed(m[2]);
    return inches;
  }
  m = RE_IN_ONLY.exec(t);
  if (m) return mixed(m[1]);
  m = RE_WITH_UNIT.exec(t);
  if (m) return to_inches(parseFloat(m[1]), UNIT_WORDS[m[2].toLowerCase()]);
  m = RE_BARE.exec(t);
  if (m) return to_inches(mixed(m[1]), default_unit);
  throw new TakeoffError("parse", "Could not read the length \"" + t.slice(0, 40) + "\"");
}

// ------------------------------------------------------------- formatting
function round_half_up(x) { return Math.floor(x + 0.5); }
function format_ftin(inches, denominator) {
  if (denominator === undefined) denominator = 16;
  if (![1, 2, 4, 8, 16, 32, 64].includes(denominator)) throw new TakeoffError("unit", "Fraction denominator must be 1, 2, 4, 8, 16, 32 or 64");
  const neg = inches < 0;
  const units = round_half_up(Math.abs(inches) * denominator);
  const perFt = 12 * denominator;
  const ft = Math.floor(units / perFt), rem = units % perFt;
  const whole = Math.floor(rem / denominator);
  let num = rem % denominator, den = denominator;
  while (num && num % 2 === 0 && den % 2 === 0) { num /= 2; den /= 2; }
  const inch = String(whole) + (num ? " " + num + "/" + den : "");
  return (neg && units ? "-" : "") + ft + "'-" + inch + '"';
}
function group3(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function format_number(x, places) {
  if (!Number.isFinite(x)) return "-";
  const scale = 10 ** places;
  const n = round_half_up(Math.abs(x) * scale);
  const whole = Math.floor(n / scale), frac = n % scale;
  let s = group3(whole);
  if (places > 0) s += "." + String(frac).padStart(places, "0");
  return (x < 0 && n ? "-" : "") + s;
}
function format_length(inches, unit, places, denominator) {
  if (unit === undefined) unit = "ftin";
  if (places === undefined) places = 2;
  if (unit === "ftin") return format_ftin(inches, denominator === undefined ? 16 : denominator);
  return format_number(from_inches(inches, unit), places) + " " + UNIT_LABELS[unit];
}
function format_area(v, unit, places) {
  if (unit === undefined) unit = "sf";
  return format_number(area_from_sq_in(v, unit), places === undefined ? 2 : places) + " " + UNIT_LABELS[unit];
}
function format_volume(v, unit, places) {
  if (unit === undefined) unit = "cy";
  return format_number(volume_from_cu_in(v, unit), places === undefined ? 2 : places) + " " + UNIT_LABELS[unit];
}
