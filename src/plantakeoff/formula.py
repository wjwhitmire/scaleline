"""Assembly formulas: a small, safe arithmetic language for component quantities.

A formula is text such as ``LF * 12 / spacing_in + N`` or ``ceil(SF * layers / 32)``. It is parsed
by hand (no eval) into a tree and evaluated against named numbers:

  LF   total length in feet          PF   total perimeter in feet
  SF   total area in square feet     WSF  total wall area in square feet
  CF   total volume in cubic feet    CY   total volume in cubic yards
  EA   total count                   N    number of linked measurements

plus the assembly's own parameters (for example ``spacing_in``, ``height_ft``, ``coats``).

Grammar (usual precedence, ``^`` binds tightest and to the right):

  expr  := term (("+" | "-") term)*
  term  := unary (("*" | "/") unary)*
  unary := ("+" | "-") unary | power
  power := atom ("^" unary)?
  atom  := number | name | name "(" expr ("," expr)* ")" | "(" expr ")"

Functions: ceil, floor, round (half up), min, max, abs, sqrt, and either(a, b), which is a unless a
is zero, then b (a wall assembly uses the drawn wall area, or length times a height parameter when
the measurement has no height). ceil and floor forgive a 1e-9
floating error so ceil(3.0000000001) is 3, the same rule the purchase-unit round up uses.
Limits: 500 characters, 200 tokens, nesting 40 deep. Every failure is a TakeoffError with code
"formula" and a plain message; the browser core gives the same results (parity vectors).
"""

from __future__ import annotations

import math
import re

from .errors import TakeoffError

MAX_LEN = 500
MAX_TOKENS = 200
MAX_DEPTH = 40
EPS = 1e-9
FUNCS = {"ceil": (1, 1), "floor": (1, 1), "round": (1, 1), "abs": (1, 1), "sqrt": (1, 1), "min": (1, 20), "max": (1, 20),
         "either": (2, 2)}
VARIABLES = ("LF", "PF", "SF", "WSF", "CF", "CY", "EA", "N")
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,31}$")


def _fail(msg):
    raise TakeoffError("formula", msg)


DIGITS = "0123456789"
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_"


def tokenize(text):
    """Numbers, names and the operators + - * / ^ ( ) and comma. ASCII only."""
    if not isinstance(text, str):
        _fail("A formula must be text")
    if len(text) > MAX_LEN:
        _fail(f"A formula can be at most {MAX_LEN} characters")
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in " \t\r\n":
            i += 1
            continue
        if c in DIGITS or (c == "." and i + 1 < n and text[i + 1] in DIGITS):
            j = i
            while j < n and text[j] in DIGITS:
                j += 1
            if j < n and text[j] == ".":
                j += 1
                while j < n and text[j] in DIGITS:
                    j += 1
            if j < n and text[j] in "eE":
                k = j + 1
                if k < n and text[k] in "+-":
                    k += 1
                if k < n and text[k] in DIGITS:
                    j = k
                    while j < n and text[j] in DIGITS:
                        j += 1
            out.append(("num", float(text[i:j])))
            i = j
        elif c in LETTERS:
            j = i
            while j < n and (text[j] in LETTERS or text[j] in DIGITS):
                j += 1
            if j - i > 32:
                _fail("A name in the formula is longer than 32 characters")
            out.append(("name", text[i:j]))
            i = j
        elif c in "+-*/^(),":
            out.append(("op", c))
            i += 1
        else:
            _fail(f"Unexpected character {c!r} in the formula")
        if len(out) > MAX_TOKENS:
            _fail(f"A formula can have at most {MAX_TOKENS} parts")
    return out


class _Parser:
    def __init__(self, tokens):
        self.t = tokens
        self.i = 0
        self.depth = 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else ("end", None)

    def take(self):
        tok = self.peek()
        self.i += 1
        return tok

    def expect(self, op):
        tok = self.take()
        if tok != ("op", op):
            _fail(f"Expected {op!r} in the formula")

    def enter(self):
        self.depth += 1
        if self.depth > MAX_DEPTH:
            _fail("The formula is nested too deeply")

    def expr(self):
        self.enter()
        node = self.term()
        while self.peek() in (("op", "+"), ("op", "-")):
            op = self.take()[1]
            node = ("bin", op, node, self.term())
        self.depth -= 1
        return node

    def term(self):
        node = self.unary()
        while self.peek() in (("op", "*"), ("op", "/")):
            op = self.take()[1]
            node = ("bin", op, node, self.unary())
        return node

    def unary(self):
        if self.peek() in (("op", "+"), ("op", "-")):
            op = self.take()[1]
            self.enter()
            inner = self.unary()
            self.depth -= 1
            return ("neg", inner) if op == "-" else inner
        return self.power()

    def power(self):
        base = self.atom()
        if self.peek() == ("op", "^"):
            self.take()
            self.enter()
            exp = self.unary()
            self.depth -= 1
            return ("bin", "^", base, exp)
        return base

    def atom(self):
        kind, val = self.take()
        if kind == "num":
            return ("num", val)
        if kind == "name":
            if self.peek() == ("op", "("):
                if val not in FUNCS:
                    _fail(f"Unknown function {val}")
                self.take()
                args = [self.expr()]
                while self.peek() == ("op", ","):
                    self.take()
                    args.append(self.expr())
                self.expect(")")
                lo, hi = FUNCS[val]
                if not lo <= len(args) <= hi:
                    _fail(f"{val} takes " + ("one value" if lo == hi else f"{lo} to {hi} values"))
                return ("call", val, args)
            return ("var", val)
        if (kind, val) == ("op", "("):
            node = self.expr()
            self.expect(")")
            return node
        if kind == "end":
            _fail("The formula ends too early")
        _fail(f"Unexpected {val!r} in the formula")


def parse(text):
    """The formula as a tree of tuples; raises TakeoffError when it cannot be read."""
    tokens = tokenize(text)
    if not tokens:
        _fail("The formula is empty")
    p = _Parser(tokens)
    node = p.expr()
    if p.i != len(tokens):
        _fail("The formula has extra text at the end")
    return node


def names(text):
    """Every variable name the formula uses, in order of first use."""
    out = []

    def walk(n):
        if n[0] == "var" and n[1] not in out:
            out.append(n[1])
        elif n[0] == "bin":
            walk(n[2])
            walk(n[3])
        elif n[0] == "neg":
            walk(n[1])
        elif n[0] == "call":
            for a in n[2]:
                walk(a)

    walk(parse(text))
    return out


def _finite(x):
    if not math.isfinite(x):
        _fail("The formula gives a number that is too large or not a number")
    return x


def _ev(n, env):
    k = n[0]
    if k == "num":
        return n[1]
    if k == "var":
        if n[1] not in env:
            _fail(f"Unknown name {n[1]} in the formula")
        return env[n[1]]
    if k == "neg":
        return -_ev(n[1], env)
    if k == "bin":
        a, b = _ev(n[2], env), _ev(n[3], env)
        op = n[1]
        if op == "+":
            return _finite(a + b)
        if op == "-":
            return _finite(a - b)
        if op == "*":
            return _finite(a * b)
        if op == "/":
            if b == 0:
                _fail("The formula divides by zero")
            return _finite(a / b)
        if a < 0 and b != math.floor(b):
            _fail("The formula raises a negative number to a fractional power")
        if a == 0 and b < 0:
            _fail("The formula divides by zero")
        try:
            return _finite(math.pow(a, b))
        except OverflowError:
            _fail("The formula gives a number that is too large or not a number")
    args = [_ev(a, env) for a in n[2]]
    f = n[1]
    if f == "ceil":
        return float(math.ceil(args[0] - EPS))
    if f == "floor":
        return float(math.floor(args[0] + EPS))
    if f == "round":
        return float(math.floor(args[0] + 0.5))
    if f == "abs":
        return abs(args[0])
    if f == "sqrt":
        if args[0] < 0:
            _fail("The formula takes the square root of a negative number")
        return math.sqrt(args[0])
    if f == "min":
        return min(args)
    if f == "either":
        return args[0] if args[0] != 0 else args[1]
    return max(args)


def evaluate(text, env):
    """The value of a formula for the named numbers in env (a dict of finite numbers)."""
    clean = {}
    for k, v in (env or {}).items():
        if not isinstance(k, str) or not _NAME.match(k):
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            _fail(f"{k} is not a number")
        clean[k] = float(v)
    return _finite(float(_ev(parse(text), clean)))


def variables(totals):
    """The standard variables for summed measurement totals (see assembly.sum_quantities)."""
    return {
        "LF": totals["length_in"] / 12.0,
        "PF": totals["perimeter_in"] / 12.0,
        "SF": totals["area_sq_in"] / 144.0,
        "WSF": totals["wall_area_sq_in"] / 144.0,
        "CF": totals["volume_cu_in"] / 1728.0,
        "CY": totals["volume_cu_in"] / 46656.0,
        "EA": float(totals["count"]),
        "N": float(totals["measurements"]),
    }
