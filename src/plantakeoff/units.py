"""Units: every real length is carried in inches, every area in square inches and every
volume in cubic inches. Conversions use exact factors (1 in = 25.4 mm by definition).

Parsing accepts the forms estimators type: 12'-6", 12' 6 1/2", 12'6-1/2", 6", 12', 12.5 ft,
3.2 m, 250 mm, 1/4", 1 1/2". Formatting writes feet and inches with a fraction (1/16 by
default), decimal feet, inches, yards, meters, centimeters or millimeters.
"""

from __future__ import annotations

import math
import re

from .errors import TakeoffError

# inches per unit
LENGTH = {
    "in": 1.0,
    "ft": 12.0,
    "yd": 36.0,
    "mi": 63360.0,
    "mm": 1.0 / 25.4,
    "cm": 10.0 / 25.4,
    "m": 1000.0 / 25.4,
    "pt": 1.0 / 72.0,
}
# square inches per unit
AREA = {
    "sq_in": 1.0,
    "sf": 144.0,
    "sy": 1296.0,
    "sq_mm": (1.0 / 25.4) ** 2,
    "sq_cm": (10.0 / 25.4) ** 2,
    "sm": (1000.0 / 25.4) ** 2,
    "acre": 43560.0 * 144.0,
}
# cubic inches per unit
VOLUME = {
    "cu_in": 1.0,
    "cf": 1728.0,
    "cy": 46656.0,
    "cu_m": (1000.0 / 25.4) ** 3,
    "l": (100.0 / 25.4) ** 3,
    "gal": 231.0,
}

UNIT_LABELS = {
    "in": "in", "ft": "ft", "yd": "yd", "mi": "mi", "mm": "mm", "cm": "cm", "m": "m", "pt": "pt",
    "ftin": "ft-in",
    "sq_in": "sq in", "sf": "SF", "sy": "SY", "sq_mm": "sq mm", "sq_cm": "sq cm", "sm": "m2", "acre": "ac",
    "cu_in": "cu in", "cf": "CF", "cy": "CY", "cu_m": "m3", "l": "L", "gal": "gal",
}

# The area and volume unit that goes with each display length unit.
AREA_FOR = {"ftin": "sf", "ft": "sf", "in": "sq_in", "yd": "sy", "m": "sm", "cm": "sq_cm", "mm": "sm", "mi": "sf"}
VOLUME_FOR = {"ftin": "cy", "ft": "cf", "in": "cu_in", "yd": "cy", "m": "cu_m", "cm": "cu_m", "mm": "cu_m", "mi": "cy"}


def to_inches(value: float, unit: str) -> float:
    if unit == "ftin":
        unit = "ft"
    if unit not in LENGTH:
        raise TakeoffError("unit", f"Unknown length unit: {unit}")
    return float(value) * LENGTH[unit]


def from_inches(inches: float, unit: str) -> float:
    if unit == "ftin":
        unit = "ft"
    if unit not in LENGTH:
        raise TakeoffError("unit", f"Unknown length unit: {unit}")
    return float(inches) / LENGTH[unit]


def area_from_sq_in(sq_in: float, unit: str) -> float:
    if unit not in AREA:
        raise TakeoffError("unit", f"Unknown area unit: {unit}")
    return float(sq_in) / AREA[unit]


def area_to_sq_in(value: float, unit: str) -> float:
    if unit not in AREA:
        raise TakeoffError("unit", f"Unknown area unit: {unit}")
    return float(value) * AREA[unit]


def volume_from_cu_in(cu_in: float, unit: str) -> float:
    if unit not in VOLUME:
        raise TakeoffError("unit", f"Unknown volume unit: {unit}")
    return float(cu_in) / VOLUME[unit]


def volume_to_cu_in(value: float, unit: str) -> float:
    if unit not in VOLUME:
        raise TakeoffError("unit", f"Unknown volume unit: {unit}")
    return float(value) * VOLUME[unit]


def convert(value: float, src: str, dst: str) -> float:
    """Convert between two units of the same kind (length, area or volume)."""
    for table in (LENGTH, AREA, VOLUME):
        s = "ft" if (src == "ftin" and table is LENGTH) else src
        d = "ft" if (dst == "ftin" and table is LENGTH) else dst
        if s in table and d in table:
            return float(value) * table[s] / table[d]
    raise TakeoffError("unit", f"Cannot convert {src} to {dst}")


def unit_kind(unit: str) -> str:
    if unit == "ftin" or unit in LENGTH:
        return "length"
    if unit in AREA:
        return "area"
    if unit in VOLUME:
        return "volume"
    if unit in ("ea", "count"):
        return "count"
    raise TakeoffError("unit", f"Unknown unit: {unit}")


# ------------------------------------------------------------------ parsing

_NUM = r"(?:\d+(?:\.\d*)?|\.\d+)"
_FRAC = r"(?:\d+\s*/\s*\d+)"
# a number with an optional fraction: 6, 6.5, 6 1/2, 6-1/2, 1/2
_MIXED = rf"(?:{_NUM}(?:[\s-]+{_FRAC})?|{_FRAC})"

_FT_IN = re.compile(
    rf"^\s*(?P<ft>{_NUM})\s*(?:'|ft\b|feet\b|foot\b)\s*-?\s*(?:(?P<in>{_MIXED})\s*(?:\"|''|in\b|inch\b|inches\b)?)?\s*$",
    re.I,
)
_IN_ONLY = re.compile(rf"^\s*(?P<in>{_MIXED})\s*(?:\"|''|in\b|inch\b|inches\b)\s*$", re.I)
_WITH_UNIT = re.compile(rf"^\s*(?P<v>{_NUM})\s*(?P<u>mm|cm|m|yd|yards?|meters?|metres?|millimeters?|centimeters?)\s*$", re.I)
_BARE = re.compile(rf"^\s*(?P<v>{_MIXED})\s*$")

_UNIT_WORDS = {
    "mm": "mm", "millimeter": "mm", "millimeters": "mm",
    "cm": "cm", "centimeter": "cm", "centimeters": "cm",
    "m": "m", "meter": "m", "meters": "m", "metre": "m", "metres": "m",
    "yd": "yd", "yard": "yd", "yards": "yd",
}


def _mixed(text: str) -> float:
    t = text.strip()
    m = re.match(rf"^({_NUM})[\s-]+(\d+)\s*/\s*(\d+)$", t)
    if m:
        den = int(m.group(3))
        if den == 0:
            raise TakeoffError("parse", "Division by zero in a fraction")
        return float(m.group(1)) + int(m.group(2)) / den
    m = re.match(r"^(\d+)\s*/\s*(\d+)$", t)
    if m:
        den = int(m.group(2))
        if den == 0:
            raise TakeoffError("parse", "Division by zero in a fraction")
        return int(m.group(1)) / den
    return float(t)


def parse_length(text: str, default_unit: str = "ft") -> float:
    """Parse a typed length and return inches. A bare number uses default_unit."""
    if not isinstance(text, str):
        raise TakeoffError("parse", "A length must be text")
    t = text.strip().replace("′", "'").replace("″", '"').replace("’", "'").replace("”", '"')
    if not t or len(t) > 64:
        raise TakeoffError("parse", "Type a length such as 12'-6\" or 3.5 m")
    m = _FT_IN.match(t)
    if m:
        inches = float(m.group("ft")) * 12.0
        if m.group("in"):
            inches += _mixed(m.group("in"))
        return inches
    m = _IN_ONLY.match(t)
    if m:
        return _mixed(m.group("in"))
    m = _WITH_UNIT.match(t)
    if m:
        u = _UNIT_WORDS[m.group("u").lower()]
        return to_inches(float(m.group("v")), u)
    m = _BARE.match(t)
    if m:
        return to_inches(_mixed(m.group("v")), default_unit)
    raise TakeoffError("parse", f"Could not read the length \"{t[:40]}\"")


# ---------------------------------------------------------------- formatting


def _round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


def format_ftin(inches: float, denominator: int = 16) -> str:
    """Feet and inches with a reduced fraction, e.g. 12'-6 1/2". Rounds to the nearest 1/denominator."""
    if denominator not in (1, 2, 4, 8, 16, 32, 64):
        raise TakeoffError("unit", "Fraction denominator must be 1, 2, 4, 8, 16, 32 or 64")
    neg = inches < 0
    units = _round_half_up(abs(inches) * denominator)  # in 1/denominator inches
    per_ft = 12 * denominator
    ft, rem = divmod(units, per_ft)
    whole, frac = divmod(rem, denominator)
    num, den = frac, denominator
    while num and num % 2 == 0 and den % 2 == 0:
        num //= 2
        den //= 2
    inch = str(whole) + (f" {num}/{den}" if num else "")
    return ("-" if neg and units else "") + f"{ft}'-{inch}\""


def format_number(x: float, places: int) -> str:
    """Fixed decimals with thousands separators, rounding half away from zero."""
    if not math.isfinite(x):
        return "-"
    scale = 10 ** places
    n = _round_half_up(abs(x) * scale)
    whole, frac = divmod(n, scale)
    s = f"{whole:,}"
    if places > 0:
        s += "." + str(frac).rjust(places, "0")
    return ("-" if x < 0 and n else "") + s


def format_length(inches: float, unit: str = "ftin", places: int = 2, denominator: int = 16) -> str:
    if unit == "ftin":
        return format_ftin(inches, denominator)
    return format_number(from_inches(inches, unit), places) + " " + UNIT_LABELS[unit]


def format_area(sq_in: float, unit: str = "sf", places: int = 2) -> str:
    return format_number(area_from_sq_in(sq_in, unit), places) + " " + UNIT_LABELS[unit]


def format_volume(cu_in: float, unit: str = "cy", places: int = 2) -> str:
    return format_number(volume_from_cu_in(cu_in, unit), places) + " " + UNIT_LABELS[unit]
