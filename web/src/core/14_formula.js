// Assembly formulas: a small, safe arithmetic language (no eval). Mirrors formula.py; see its
// notes for the grammar, the variables (LF, PF, SF, WSF, CF, CY, EA, N) and the limits.
const FORMULA_MAX_LEN = 500, FORMULA_MAX_TOKENS = 200, FORMULA_MAX_DEPTH = 40, FORMULA_EPS = 1e-9;
const FORMULA_FUNCS = { ceil: [1, 1], floor: [1, 1], round: [1, 1], abs: [1, 1], sqrt: [1, 1], min: [1, 20], max: [1, 20], either: [2, 2] };
const FORMULA_VARIABLES = ["LF", "PF", "SF", "WSF", "CF", "CY", "EA", "N"];
const F_DIGITS = "0123456789";
const F_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
const RE_PARAM = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
function _ffail(msg) { throw new TakeoffError("formula", msg); }
function _fq(c) { return c === "'" ? "\"'\"" : "'" + c + "'"; }

function formula_tokens(text) {
  if (typeof text !== "string") _ffail("A formula must be text");
  if (text.length > FORMULA_MAX_LEN) _ffail("A formula can be at most " + FORMULA_MAX_LEN + " characters");
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (" \t\r\n".includes(c)) { i++; continue; }
    if (F_DIGITS.includes(c) || (c === "." && i + 1 < n && F_DIGITS.includes(text[i + 1]))) {
      let j = i;
      while (j < n && F_DIGITS.includes(text[j])) j++;
      if (j < n && text[j] === ".") { j++; while (j < n && F_DIGITS.includes(text[j])) j++; }
      if (j < n && "eE".includes(text[j])) {
        let k = j + 1;
        if (k < n && "+-".includes(text[k])) k++;
        if (k < n && F_DIGITS.includes(text[k])) { j = k; while (j < n && F_DIGITS.includes(text[j])) j++; }
      }
      out.push(["num", Number(text.slice(i, j))]);
      i = j;
    } else if (F_LETTERS.includes(c)) {
      let j = i;
      while (j < n && (F_LETTERS.includes(text[j]) || F_DIGITS.includes(text[j]))) j++;
      if (j - i > 32) _ffail("A name in the formula is longer than 32 characters");
      out.push(["name", text.slice(i, j)]);
      i = j;
    } else if ("+-*/^(),".includes(c)) { out.push(["op", c]); i++; }
    else _ffail("Unexpected character " + _fq(c) + " in the formula");
    if (out.length > FORMULA_MAX_TOKENS) _ffail("A formula can have at most " + FORMULA_MAX_TOKENS + " parts");
  }
  return out;
}
function formula_parse(text) {
  const t = formula_tokens(text);
  if (!t.length) _ffail("The formula is empty");
  let i = 0, depth = 0;
  const peek = () => (i < t.length ? t[i] : ["end", null]);
  const isOp = (tok, op) => tok[0] === "op" && tok[1] === op;
  const take = () => { const tok = peek(); i++; return tok; };
  const expect = (op) => { const tok = take(); if (!isOp(tok, op)) _ffail("Expected " + _fq(op) + " in the formula"); };
  const enter = () => { depth++; if (depth > FORMULA_MAX_DEPTH) _ffail("The formula is nested too deeply"); };
  function expr() {
    enter();
    let node = term();
    while (isOp(peek(), "+") || isOp(peek(), "-")) { const op = take()[1]; node = ["bin", op, node, term()]; }
    depth--;
    return node;
  }
  function term() {
    let node = unary();
    while (isOp(peek(), "*") || isOp(peek(), "/")) { const op = take()[1]; node = ["bin", op, node, unary()]; }
    return node;
  }
  function unary() {
    if (isOp(peek(), "+") || isOp(peek(), "-")) {
      const op = take()[1];
      enter();
      const inner = unary();
      depth--;
      return op === "-" ? ["neg", inner] : inner;
    }
    return power();
  }
  function power() {
    const base = atom();
    if (isOp(peek(), "^")) { take(); enter(); const e = unary(); depth--; return ["bin", "^", base, e]; }
    return base;
  }
  function atom() {
    const [kind, val] = take();
    if (kind === "num") return ["num", val];
    if (kind === "name") {
      if (isOp(peek(), "(")) {
        if (!has(FORMULA_FUNCS, val)) _ffail("Unknown function " + val);
        take();
        const args = [expr()];
        while (isOp(peek(), ",")) { take(); args.push(expr()); }
        expect(")");
        const [lo, hi] = FORMULA_FUNCS[val];
        if (args.length < lo || args.length > hi) _ffail(val + " takes " + (lo === hi ? "one value" : lo + " to " + hi + " values"));
        return ["call", val, args];
      }
      return ["var", val];
    }
    if (kind === "op" && val === "(") { const node = expr(); expect(")"); return node; }
    if (kind === "end") _ffail("The formula ends too early");
    _ffail("Unexpected " + _fq(val) + " in the formula");
    return null;
  }
  const node = expr();
  if (i !== t.length) _ffail("The formula has extra text at the end");
  return node;
}
function formula_names(text) {
  const out = [];
  const walk = (n) => {
    if (n[0] === "var") { if (!out.includes(n[1])) out.push(n[1]); }
    else if (n[0] === "bin") { walk(n[2]); walk(n[3]); }
    else if (n[0] === "neg") walk(n[1]);
    else if (n[0] === "call") n[2].forEach(walk);
  };
  walk(formula_parse(text));
  return out;
}
function _ffin(x) { if (!Number.isFinite(x)) _ffail("The formula gives a number that is too large or not a number"); return x; }
function _fev(n, env) {
  const k = n[0];
  if (k === "num") return n[1];
  if (k === "var") { if (!env.has(n[1])) _ffail("Unknown name " + n[1] + " in the formula"); return env.get(n[1]); }
  if (k === "neg") return -_fev(n[1], env);
  if (k === "bin") {
    const a = _fev(n[2], env), b = _fev(n[3], env), op = n[1];
    if (op === "+") return _ffin(a + b);
    if (op === "-") return _ffin(a - b);
    if (op === "*") return _ffin(a * b);
    if (op === "/") { if (b === 0) _ffail("The formula divides by zero"); return _ffin(a / b); }
    if (a < 0 && b !== Math.floor(b)) _ffail("The formula raises a negative number to a fractional power");
    if (a === 0 && b < 0) _ffail("The formula divides by zero");
    return _ffin(Math.pow(a, b));
  }
  const args = n[2].map((a) => _fev(a, env));
  switch (n[1]) {
    case "ceil": return Math.ceil(args[0] - FORMULA_EPS);
    case "floor": return Math.floor(args[0] + FORMULA_EPS);
    case "round": return Math.floor(args[0] + 0.5);
    case "abs": return Math.abs(args[0]);
    case "sqrt": if (args[0] < 0) _ffail("The formula takes the square root of a negative number"); return Math.sqrt(args[0]);
    case "min": return Math.min(...args);
    case "either": return args[0] !== 0 ? args[0] : args[1];
    default: return Math.max(...args);
  }
}
function formula_eval(text, env) {
  const clean = new Map();
  for (const k of Object.keys(env || {})) {
    if (!RE_PARAM.test(k)) continue;
    const v = env[k];
    if (typeof v !== "number" || !Number.isFinite(v)) _ffail(k + " is not a number");
    clean.set(k, v);
  }
  const r = _fev(formula_parse(text), clean);
  return _ffin(r === 0 ? 0 : r);
}
function formula_variables(totals) {
  return {
    LF: totals.length_in / 12, PF: totals.perimeter_in / 12, SF: totals.area_sq_in / 144, WSF: totals.wall_area_sq_in / 144,
    CF: totals.volume_cu_in / 1728, CY: totals.volume_cu_in / 46656, EA: totals.count, N: totals.measurements,
  };
}
