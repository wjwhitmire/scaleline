"""Drawing scales. A scale is carried as real inches per PDF point (a PDF point is 1/72 inch
of paper). A sheet printed at 1/4" = 1'-0" has 0.25 in of paper (18 pt) for 12 real inches,
so in_per_pt = 12 / 18 = 0.6667.

Calibration: two points picked on the sheet and the real distance between them give
in_per_pt = real / distance_in_points. Standard architectural, engineering and metric scales
are listed below. parse_scale_text reads scale notes such as SCALE: 1/4" = 1'-0", 1" = 20'
or 1:100 out of title block text.
"""

from __future__ import annotations

import math
import re

from .errors import TakeoffError
from .units import _MIXED, _NUM, parse_length

PT_PER_IN = 72.0

# (label, paper inches, real inches)
ARCHITECTURAL = [
    ('1/32" = 1\'-0"', 1 / 32, 12.0),
    ('1/16" = 1\'-0"', 1 / 16, 12.0),
    ('3/32" = 1\'-0"', 3 / 32, 12.0),
    ('1/8" = 1\'-0"', 1 / 8, 12.0),
    ('3/16" = 1\'-0"', 3 / 16, 12.0),
    ('1/4" = 1\'-0"', 1 / 4, 12.0),
    ('3/8" = 1\'-0"', 3 / 8, 12.0),
    ('1/2" = 1\'-0"', 1 / 2, 12.0),
    ('3/4" = 1\'-0"', 3 / 4, 12.0),
    ('1" = 1\'-0"', 1.0, 12.0),
    ('1 1/2" = 1\'-0"', 1.5, 12.0),
    ('3" = 1\'-0"', 3.0, 12.0),
    ('6" = 1\'-0"', 6.0, 12.0),
    ('12" = 1\'-0" (full size)', 12.0, 12.0),
]
ENGINEERING = [(f'1" = {n}\'', 1.0, n * 12.0) for n in (5, 10, 20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 500, 600, 1000)]
METRIC = [(f"1:{n}", 1.0, float(n)) for n in (1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 1250, 2500, 5000)]

STANDARD_SCALES = (
    [{"group": "Architectural", "label": l, "in_per_pt": r / (p * PT_PER_IN)} for l, p, r in ARCHITECTURAL]
    + [{"group": "Engineering", "label": l, "in_per_pt": r / (p * PT_PER_IN)} for l, p, r in ENGINEERING]
    + [{"group": "Metric", "label": l, "in_per_pt": r / (p * PT_PER_IN)} for l, p, r in METRIC]
)


def scale_from_ratio(paper_in: float, real_in: float) -> float:
    """in_per_pt for paper_in inches of paper representing real_in real inches."""
    if not (paper_in > 0 and real_in > 0 and math.isfinite(paper_in) and math.isfinite(real_in)):
        raise TakeoffError("scale", "Both sides of a scale must be positive numbers")
    return real_in / (paper_in * PT_PER_IN)


def calibrate(p1, p2, real_in: float) -> float:
    """in_per_pt from two picked points (PDF points) and the real distance between them in inches."""
    d = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    if not (d > 1e-6):
        raise TakeoffError("calibrate", "Pick two different points to calibrate")
    if not (real_in > 0 and math.isfinite(real_in)):
        raise TakeoffError("calibrate", "The known distance must be greater than zero")
    return real_in / d


def ratio_of(in_per_pt: float) -> float:
    """The scale written as 1:N (real over paper, same units)."""
    return in_per_pt * PT_PER_IN


def nearest_standard(in_per_pt: float, tolerance: float = 0.005):
    """The standard scale within a relative tolerance, or None."""
    best = None
    for s in STANDARD_SCALES:
        rel = abs(s["in_per_pt"] - in_per_pt) / s["in_per_pt"]
        if rel <= tolerance and (best is None or rel < best[0]):
            best = (rel, s)
    return None if best is None else best[1]


# ------------------------------------------------------- scale notes in text

_LEN = (
    rf"(?:{_NUM}\s*'\s*-?\s*(?:{_MIXED}\s*(?:\"|'')?)?"
    rf"|{_MIXED}\s*(?:\"|''|'|in\b|inch(?:es)?\b|ft\b|feet\b|foot\b|mm\b|cm\b|m\b)?)"
)
_EQ = re.compile(rf"({_LEN})\s*=\s*({_LEN})", re.I)
_RATIO = re.compile(r"(?<![\d.:])1\s*:\s*(\d+(?:\.\d+)?)(?![\d:])")
_NTS = re.compile(r"\bN\.?\s?T\.?\s?S\b\.?|\bNOT\s+TO\s+SCALE\b", re.I)
_HAS_UNIT = re.compile(r"[\"'a-z]", re.I)
_SCALE_WORD = re.compile(r"\bscale\b", re.I)
_METRIC_N = {1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 1250, 2500, 5000}


def parse_scale_text(text: str):
    """Every scale note found in text, in order: dicts with start, text and in_per_pt (None for NTS)."""
    if not isinstance(text, str):
        return []
    t = text[:20000].replace("′", "'").replace("″", '"').replace("’", "'").replace("”", '"')
    found = []
    for m in _EQ.finditer(t):
        left, right = m.group(1).strip(), m.group(2).strip()
        if not (_HAS_UNIT.search(left) and _HAS_UNIT.search(right)):
            continue
        try:
            paper = parse_length(left, "in")
            real = parse_length(right, "ft")
        except TakeoffError:
            continue
        if not (0.005 <= paper <= 24 and real >= paper and real / paper <= 100000):
            continue
        found.append({"start": m.start(), "text": m.group(0).strip(), "in_per_pt": scale_from_ratio(paper, real)})
    for m in _RATIO.finditer(t):
        n = float(m.group(1))
        near = _SCALE_WORD.search(t, max(0, m.start() - 16), m.start()) is not None
        if n < 1 or n > 100000 or not (near or n in _METRIC_N and n >= 5):
            continue
        found.append({"start": m.start(), "text": m.group(0), "in_per_pt": n / PT_PER_IN})
    for m in _NTS.finditer(t):
        found.append({"start": m.start(), "text": m.group(0), "in_per_pt": None})
    found.sort(key=lambda f: f["start"])
    return found

