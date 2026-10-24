"""The markup file (an editable JSON sidecar for each PDF), its validation, and the markup list:
one row per markup with its measurement, grouping and totals.

Validation never trusts a file. Unknown fields are dropped, text is trimmed to a cap, numbers
must be finite and in range, and a bad markup is skipped with a count instead of failing the
whole file.
"""

from __future__ import annotations

import math
import re

from . import units as u
from .brand import FILE_FORMAT, FILE_VERSION
from .errors import TakeoffError
from .measure import MEASURE_TYPES, measure

MARKUP_TYPES = MEASURE_TYPES + (
    "cloud", "callout", "text", "arrow", "line", "rect", "ellipse", "polygon", "polyline", "highlight", "pen", "stamp",
)
TYPE_LABELS = {
    "length": "Length", "polylength": "Polylength", "area": "Area", "perimeter": "Perimeter", "count": "Count",
    "volume": "Volume", "angle": "Angle", "radius": "Radius", "diameter": "Diameter", "quantity": "Imported quantity", "cloud": "Cloud", "callout": "Callout", "text": "Text",
    "arrow": "Arrow", "line": "Line", "rect": "Rectangle", "ellipse": "Ellipse", "polygon": "Polygon",
    "polyline": "Polyline", "highlight": "Highlight", "pen": "Pen", "stamp": "Stamp",
}
GLYPHS = ("circle", "square", "triangle", "diamond")
STATUSES = ("", "Open", "Accepted", "Rejected", "Completed", "Review", "Cancelled")
LENGTH_UNITS = ("ftin", "ft", "in", "yd", "m", "cm", "mm")
AREA_UNITS = ("sf", "sy", "sq_in", "sm", "sq_cm", "sq_mm", "acre")
VOLUME_UNITS = ("cy", "cf", "cu_in", "cu_m", "l", "gal")
LIMITS = {"markups": 100000, "points": 20000, "holes": 200, "pages": 20000, "layers": 500, "assemblies": 2000,
          "components": 100, "columns": 50, "text": 5000, "short": 200, "coord": 1e7, "comments": 500,
          "comment": 2000, "status_log": 200, "versions": 32, "viewports": 50, "params": 30, "rates": 200,
          "formula": 500, "why": 1000}
DEFAULT_SETTINGS = {"length_unit": "ftin", "area_unit": "sf", "volume_unit": "cy", "places": 2, "denominator": 16,
                    "author": "", "markup_pct": 0.0, "tax_pct": 0.0, "overhead_pct": 0.0}

_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_CTRL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]")


def clean_text(v, cap):
    if not isinstance(v, str):
        return ""
    return _CTRL.sub("", v)[:cap]


def _num(v, lo, hi, default=None):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return default
    x = float(v)
    if not math.isfinite(x) or x < lo or x > hi:
        return default
    return x


def _pts(v, cap):
    if not isinstance(v, list) or len(v) > cap:
        return None
    out = []
    lim = LIMITS["coord"]
    for p in v:
        if not isinstance(p, list) or len(p) != 2:
            return None
        x, y = _num(p[0], -lim, lim), _num(p[1], -lim, lim)
        if x is None or y is None:
            return None
        out.append([x, y])
    return out


RESERVED_IDS = ("__proto__", "constructor", "prototype")
_PARAM = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,31}$")
FORMULA_NAMES = ("LF", "PF", "SF", "WSF", "CF", "CY", "EA", "N")


def _id(v):
    return v if isinstance(v, str) and _ID.fullmatch(v) and v not in RESERVED_IDS else None


def _ids(v, cap):
    if not isinstance(v, list):
        return []
    out = []
    for x in v[-cap:]:
        i = _id(x)
        if i and i not in out:
            out.append(i)
    return out


def clean_comment(c):
    """One comment or reply on a markup: id, author, time, text, the comment it answers, resolved and
    deleted flags (a deleted comment keeps its id so a merge does not bring it back)."""
    if not isinstance(c, dict):
        return None
    cid = _id(c.get("id"))
    if cid is None:
        return None
    out = {"id": cid, "author": clean_text(c.get("author"), 100), "at": clean_text(c.get("at"), 40),
           "text": clean_text(c.get("text"), LIMITS["comment"])}
    rt = _id(c.get("reply_to"))
    if rt and rt != cid:
        out["reply_to"] = rt
    if c.get("resolved") is True:
        out["resolved"] = True
    if c.get("deleted") is True:
        out["deleted"] = True
        out["text"] = ""
    elif not out["text"]:
        return None
    return out


def clean_status_entry(e):
    if not isinstance(e, dict):
        return None
    out = {"status": clean_text(e.get("status"), 40), "by": clean_text(e.get("by"), 100), "at": clean_text(e.get("at"), 40)}
    return out if out["status"] or out["at"] else None


def clean_markup(m):
    """A validated copy of one markup, or None when it cannot be used."""
    if not isinstance(m, dict):
        return None
    mid, t = _id(m.get("id")), m.get("type")
    page = m.get("page")
    if isinstance(page, float) and page.is_integer():
        page = int(page)
    if mid is None or t not in MARKUP_TYPES or isinstance(page, bool) or not isinstance(page, int) \
            or not 0 <= page < LIMITS["pages"]:
        return None
    pts = _pts(m.get("points"), LIMITS["points"])
    if pts is None:
        return None
    need = {"length": 2, "polylength": 2, "perimeter": 2, "area": 3, "volume": 3, "angle": 3, "radius": 2,
            "diameter": 2, "quantity": 1, "count": 1, "cloud": 2, "rect": 2, "ellipse": 2, "highlight": 2, "line": 2, "arrow": 2, "callout": 2,
            "polygon": 3, "polyline": 2, "pen": 2, "text": 1, "stamp": 1}[t]
    if len(pts) < need:
        return None
    out = {"id": mid, "type": t, "page": page, "points": pts}
    holes = m.get("holes")
    if t in ("area", "volume") and isinstance(holes, list):
        hs = []
        for h in holes[:LIMITS["holes"]]:
            hp = _pts(h, LIMITS["points"])
            if hp is not None and len(hp) >= 3:
                hs.append(hp)
        if hs:
            out["holes"] = hs
    for key in ("subject", "label", "author", "created", "modified", "modified_by", "assignee"):
        s = clean_text(m.get(key), LIMITS["short"])
        if s:
            out[key] = s
    rev = m.get("rev")
    if isinstance(rev, float) and rev.is_integer():
        rev = int(rev)
    if not isinstance(rev, bool) and isinstance(rev, int) and 0 <= rev <= 1_000_000_000:
        out["rev"] = rev
    vers = _ids(m.get("vers"), LIMITS["versions"])
    if vers:
        out["vers"] = vers
    if m.get("resolved") is True:
        out["resolved"] = True
    log = m.get("status_log")
    if isinstance(log, list):
        entries = [e for e in (clean_status_entry(x) for x in log[-LIMITS["status_log"]:]) if e]
        if entries:
            out["status_log"] = entries
    cms = m.get("comments")
    if isinstance(cms, list):
        seen_c = set()
        cl = []
        for x in cms[:LIMITS["comments"]]:
            cc = clean_comment(x)
            if cc and cc["id"] not in seen_c:
                seen_c.add(cc["id"])
                cl.append(cc)
        if cl:
            out["comments"] = cl
    if t == "quantity":
        q = m.get("qty")
        kind = q.get("kind") if isinstance(q, dict) else None
        val = _num(q.get("value"), 0, 1e15) if isinstance(q, dict) else None
        if kind not in ("length", "area", "volume", "count") or val is None:
            return None
        out["qty"] = {"kind": kind, "value": val}
    text = clean_text(m.get("text"), LIMITS["text"])
    if text:
        out["text"] = text
    status = clean_text(m.get("status"), 40)
    if status:
        out["status"] = status
    for key in ("layer", "assembly", "preset", "viewport"):
        v = _id(m.get(key))
        if v:
            out[key] = v
    src = m.get("assembly_source")
    if src in ("layer", "preset", "manual") and "assembly" in out:
        out["assembly_source"] = src
    c = m.get("color")
    if isinstance(c, str) and _COLOR.fullmatch(c):
        out["color"] = c.lower()
    g = m.get("glyph")
    if t == "count" and isinstance(g, str) and g in GLYPHS:
        out["glyph"] = g
    f = m.get("fill")
    if isinstance(f, str) and _COLOR.fullmatch(f):
        out["fill"] = f.lower()
    for key, lo, hi in (("opacity", 0, 1), ("width", 0, 100), ("font_size", 4, 400), ("depth", 0, 1e6),
                        ("height", 0, 1e6), ("pitch", 0, 48), ("rotation", -360, 360)):
        v = _num(m.get(key), lo, hi)
        if v is not None:
            out[key] = v
    custom = m.get("custom")
    if isinstance(custom, dict):
        cc = {}
        for k in sorted(custom)[:LIMITS["columns"]]:
            if _id(k):
                s = clean_text(custom[k], 500)
                if s:
                    cc[k] = s
        if cc:
            out["custom"] = cc
    return out


def clean_scale(s):
    if not isinstance(s, dict):
        return None
    ipp = _num(s.get("in_per_pt"), 1e-6, 1e7)
    if ipp is None:
        return None
    out = {"in_per_pt": ipp, "label": clean_text(s.get("label"), 80)}
    src = s.get("source")
    out["source"] = src if src in ("standard", "calibrated", "titleblock", "copied", "imported") else "calibrated"
    return out


def clean_component(c):
    if not isinstance(c, dict):
        return None
    from .assembly import SOURCES
    src = c.get("source")
    if not isinstance(src, str) or src not in SOURCES:
        return None
    out = {"name": clean_text(c.get("name"), LIMITS["short"]), "source": src,
           "unit": clean_text(c.get("unit"), 24)}
    su = c.get("source_unit")
    if isinstance(su, str) and su in (u.LENGTH.keys() | u.AREA.keys() | u.VOLUME.keys()):
        out["source_unit"] = su
    for key, lo, hi, d in (("factor", -1e9, 1e9, 1.0), ("per_each", -1e9, 1e9, 0.0), ("waste_pct", 0, 1000, 0.0),
                           ("pack", 0, 1e9, 0.0)):
        out[key] = _num(c.get(key), lo, hi, d)
    cost = _num(c.get("unit_cost_cents"), -1e11, 1e11, 0.0)
    out["unit_cost_cents"] = int(cost)
    f = clean_text(c.get("formula"), LIMITS["formula"]).strip()
    if f:
        out["formula"] = f
    code = clean_text(c.get("code"), 40).strip()
    if code:
        out["code"] = code
    hrs = _num(c.get("labor_hours"), 0, 1e6)
    if hrs:
        out["labor_hours"] = hrs
    lr = _id(c.get("labor_rate"))
    if lr:
        out["labor_rate"] = lr
    return out


def clean_param(p):
    if not isinstance(p, dict):
        return None
    pid = p.get("id")
    if not isinstance(pid, str) or not _PARAM.fullmatch(pid) or pid in FORMULA_NAMES:
        return None
    v = _num(p.get("value"), -1e9, 1e9)
    if v is None:
        return None
    out = {"id": pid, "name": clean_text(p.get("name"), 100) or pid, "value": v}
    unit = clean_text(p.get("unit"), 24)
    if unit:
        out["unit"] = unit
    return out


def clean_assembly(a):
    """One assembly: id, name, components, and the optional library fields (parameters for its
    formulas, CSI division, code, group, the measurement type it suits and a why note)."""
    aid = _id(a.get("id")) if isinstance(a, dict) else None
    if not aid or not isinstance(a.get("components"), list):
        return None
    comps = [c for c in (clean_component(x) for x in a["components"][:LIMITS["components"]]) if c]
    out = {"id": aid, "name": clean_text(a.get("name"), LIMITS["short"]) or aid, "components": comps}
    params = []
    for p in (a.get("params") or [])[:LIMITS["params"]] if isinstance(a.get("params"), list) else []:
        cp = clean_param(p)
        if cp and cp["id"] not in [q["id"] for q in params]:
            params.append(cp)
    if params:
        out["params"] = params
    for key, cap in (("division", 8), ("code", 40), ("group", 60), ("why", LIMITS["why"])):
        v = clean_text(a.get(key), cap).strip()
        if v:
            out[key] = v
    if a.get("tool") in MEASURE_TYPES:
        out["tool"] = a["tool"]
    return out


def clean_viewport(v):
    if not isinstance(v, dict):
        return None
    vid = _id(v.get("id"))
    r = v.get("rect")
    sc = clean_scale(v.get("scale"))
    if vid is None or sc is None or not isinstance(r, list) or len(r) != 4:
        return None
    lim = LIMITS["coord"]
    nums = [_num(x, -lim, lim) for x in r]
    if any(x is None for x in nums):
        return None
    x0, x1 = min(nums[0], nums[2]), max(nums[0], nums[2])
    y0, y1 = min(nums[1], nums[3]), max(nums[1], nums[3])
    if x1 - x0 <= 0 or y1 - y0 <= 0:
        return None
    return {"id": vid, "name": clean_text(v.get("name"), 100), "rect": [x0, y0, x1, y1], "scale": sc}


def clean_tombstone(t):
    if not isinstance(t, dict):
        return None
    tid = _id(t.get("id"))
    if tid is None:
        return None
    return {"id": tid, "at": clean_text(t.get("at"), 40), "by": clean_text(t.get("by"), 100),
            "vers": _ids(t.get("vers"), LIMITS["versions"])}


def clean_rate(r):
    rid = _id(r.get("id")) if isinstance(r, dict) else None
    if rid is None:
        return None
    v = _num(r.get("cents_per_hour"), 0, 1e7)
    if v is None:
        return None
    return {"id": rid, "name": clean_text(r.get("name"), 100) or rid, "cents_per_hour": v}


def clean_document(doc):
    """Validate a markup file. Returns (document, report) where report counts what was dropped."""
    if not isinstance(doc, dict):
        raise TakeoffError("file", "This is not a markup file (expected a JSON object)")
    if doc.get("format") != FILE_FORMAT:
        raise TakeoffError("file", "This is not a markup file from this tool")
    v = doc.get("version")
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        raise TakeoffError("file", "The markup file has no valid version")
    if v > FILE_VERSION:
        raise TakeoffError("file", "This markup file was written by a newer version. Update the app to open it.")
    report = {"markups_dropped": 0, "pages_dropped": 0, "layers_dropped": 0, "assemblies_dropped": 0}
    settings = dict(DEFAULT_SETTINGS)
    s = doc.get("settings")
    if isinstance(s, dict):
        if s.get("length_unit") in LENGTH_UNITS:
            settings["length_unit"] = s["length_unit"]
        if s.get("area_unit") in AREA_UNITS:
            settings["area_unit"] = s["area_unit"]
        if s.get("volume_unit") in VOLUME_UNITS:
            settings["volume_unit"] = s["volume_unit"]
        p = _num(s.get("places"), 0, 6)
        if p is not None:
            settings["places"] = int(p)
        dn = s.get("denominator")
        if not isinstance(dn, bool) and dn in (1, 2, 4, 8, 16, 32, 64):
            settings["denominator"] = int(dn)
        settings["author"] = clean_text(s.get("author"), 100)
        settings["markup_pct"] = _num(s.get("markup_pct"), 0, 1000, 0.0)
        settings["tax_pct"] = _num(s.get("tax_pct"), 0, 100, 0.0)
        settings["overhead_pct"] = _num(s.get("overhead_pct"), 0, 1000, 0.0)
    pages = {}
    raw_pages = doc.get("pages")
    if isinstance(raw_pages, dict):
        for k in sorted(raw_pages, key=lambda x: (len(x), x))[:LIMITS["pages"]]:
            pv = raw_pages[k]
            if not (isinstance(k, str) and re.fullmatch(r"[0-9]{1,9}", k) and int(k) < LIMITS["pages"]
                    and isinstance(pv, dict)):
                report["pages_dropped"] += 1
                continue
            entry = {}
            sc = clean_scale(pv.get("scale"))
            if sc:
                entry["scale"] = sc
            for key in ("label", "title"):
                t = clean_text(pv.get(key), LIMITS["short"])
                if t:
                    entry[key] = t
            vps = []
            if isinstance(pv.get("viewports"), list):
                for v in pv["viewports"][:LIMITS["viewports"]]:
                    cv = clean_viewport(v)
                    if cv and cv["id"] not in [x["id"] for x in vps]:
                        vps.append(cv)
            if vps:
                entry["viewports"] = vps
            pages[str(int(k))] = entry
    layers = []
    seen = set()
    for lay in (doc.get("layers") or [])[:LIMITS["layers"]] if isinstance(doc.get("layers"), list) else []:
        lid = _id(lay.get("id")) if isinstance(lay, dict) else None
        if not lid or lid in seen:
            report["layers_dropped"] += 1
            continue
        seen.add(lid)
        entry = {"id": lid, "name": clean_text(lay.get("name"), 100) or lid,
                 "visible": lay.get("visible") is not False, "locked": lay.get("locked") is True}
        a = _id(lay.get("assembly"))
        if a:
            entry["assembly"] = a
        layers.append(entry)
    assemblies = []
    seen = set()
    raw_as = doc.get("assemblies")
    for a in (raw_as[:LIMITS["assemblies"]] if isinstance(raw_as, list) else []):
        ca = clean_assembly(a)
        if ca is None or ca["id"] in seen:
            report["assemblies_dropped"] += 1
            continue
        seen.add(ca["id"])
        assemblies.append(ca)
    columns = []
    raw_cols = doc.get("columns")
    for col in (raw_cols[:LIMITS["columns"]] if isinstance(raw_cols, list) else []):
        cid = _id(col.get("id")) if isinstance(col, dict) else None
        if cid and cid not in [c["id"] for c in columns]:
            columns.append({"id": cid, "name": clean_text(col.get("name"), 100) or cid})
    markups = []
    seen = set()
    raw_m = doc.get("markups")
    if raw_m is not None and not isinstance(raw_m, list):
        raise TakeoffError("file", "The markups field must be a list")
    raw_m = raw_m or []
    if len(raw_m) > LIMITS["markups"]:
        report["markups_dropped"] += len(raw_m) - LIMITS["markups"]
        raw_m = raw_m[:LIMITS["markups"]]
    for m in raw_m:
        cm = clean_markup(m)
        if cm is None or cm["id"] in seen:
            report["markups_dropped"] += 1
            continue
        seen.add(cm["id"])
        markups.append(cm)
    out_doc = {"format": FILE_FORMAT, "version": FILE_VERSION, "settings": settings, "pages": pages,
               "layers": layers, "assemblies": assemblies, "columns": columns, "markups": markups}
    tombs = []
    raw_t = doc.get("tombstones")
    if isinstance(raw_t, list):
        seen_t = set(seen)
        for t in raw_t[-LIMITS["markups"]:]:
            ct = clean_tombstone(t)
            if ct and ct["id"] not in seen_t:
                seen_t.add(ct["id"])
                tombs.append(ct)
    if tombs:
        out_doc["tombstones"] = tombs
    rates = []
    raw_r = doc.get("rates")
    if isinstance(raw_r, list):
        for r in raw_r[:LIMITS["rates"]]:
            cr = clean_rate(r)
            if cr and cr["id"] not in [x["id"] for x in rates]:
                rates.append(cr)
    if rates:
        out_doc["rates"] = rates
    dinfo = doc.get("document")
    if isinstance(dinfo, dict):
        out_doc["document"] = {"name": clean_text(dinfo.get("name"), 200),
                               "sha256": dinfo["sha256"] if isinstance(dinfo.get("sha256"), str)
                               and re.fullmatch(r"[0-9a-f]{64}", dinfo["sha256"]) else ""}
    return out_doc, report


# ------------------------------------------------------------- markup list


def page_scale(doc, page):
    entry = doc.get("pages", {}).get(str(page)) or {}
    sc = entry.get("scale")
    return sc["in_per_pt"] if sc else None


def markup_scale(doc, m):
    """The scale a markup is measured at: its viewport's scale when it names one that the page
    has, otherwise the page scale. A sheet can hold views at different scales (a plan at 1/4" and
    a detail at 1 1/2"); each view is a viewport with its own scale."""
    vp = m.get("viewport")
    if vp:
        entry = doc.get("pages", {}).get(str(m["page"])) or {}
        for v in entry.get("viewports", []):
            if v["id"] == vp:
                return v["scale"]["in_per_pt"]
    return page_scale(doc, m["page"])


def viewport_at(doc, page, pt):
    """The id of the last viewport on a page whose box holds the point, or None."""
    entry = doc.get("pages", {}).get(str(page)) or {}
    hit = None
    for v in entry.get("viewports", []):
        r = v["rect"]
        if r[0] <= pt[0] <= r[2] and r[1] <= pt[1] <= r[3]:
            hit = v["id"]
    return hit


def display(result, settings):
    """(formatted text, quantity in display units, unit label) for one measure() result."""
    kind = result["kind"]
    lu = settings["length_unit"]
    pl = settings["places"]
    if kind == "count":
        n = result["count"]
        return f"{n:,} ea", float(n), "ea"
    if kind == "angle":
        return u.format_number(result["angle_deg"], 1) + " deg", result["angle_deg"], "deg"
    if result["value"] is None:
        return "Not calibrated", None, ""
    if kind == "length":
        qty = u.from_inches(result["value"], lu)
        unit = "ft" if lu == "ftin" else lu
        return u.format_length(result["value"], lu, pl, settings["denominator"]), qty, u.UNIT_LABELS[unit]
    if kind == "area":
        au = settings["area_unit"]
        return u.format_area(result["value"], au, pl), u.area_from_sq_in(result["value"], au), u.UNIT_LABELS[au]
    vu = settings["volume_unit"]
    return u.format_volume(result["value"], vu, pl), u.volume_from_cu_in(result["value"], vu), u.UNIT_LABELS[vu]


def markup_rows(doc):
    settings = doc["settings"]
    layer_names = {lay["id"]: lay["name"] for lay in doc.get("layers", [])}
    rows = []
    for m in doc["markups"]:
        row = {
            "id": m["id"],
            "page": m["page"] + 1,
            "sheet": (doc.get("pages", {}).get(str(m["page"])) or {}).get("label", ""),
            "type": TYPE_LABELS[m["type"]],
            "subject": m.get("subject", ""),
            "label": m.get("label", ""),
            "layer": layer_names.get(m.get("layer", ""), ""),
            "author": m.get("author", ""),
            "status": m.get("status", ""),
            "date": m.get("created", ""),
            "measurement": "",
            "quantity": None,
            "unit": "",
            "warnings": "",
            "custom": dict(m.get("custom", {})),
        }
        if m["type"] in MEASURE_TYPES:
            try:
                r = measure(m, markup_scale(doc, m))
                row["measurement"], row["quantity"], row["unit"] = display(r, settings)
                row["warnings"] = " ".join(r["warnings"])
            except TakeoffError as e:
                row["measurement"] = "Invalid"
                row["warnings"] = e.code
        rows.append(row)
    return rows


def row_key(row, key):
    if key.startswith("custom:"):
        return row["custom"].get(key[7:], "")
    v = row.get(key, "")
    return "" if v is None else str(v)


NOT_SUMMED = ("deg",)


def group_totals(rows, key):
    """Groups of rows by a column, each with a row count and quantity totals per unit. Angles are
    counted as rows but never added up: a sum of angles is not a quantity."""
    groups = {}
    order = []
    for r in rows:
        k = row_key(r, key)
        if k not in groups:
            groups[k] = {"group": k, "rows": 0, "totals": {}}
            order.append(k)
        g = groups[k]
        g["rows"] += 1
        if r["quantity"] is not None and r["unit"] and r["unit"] not in NOT_SUMMED:
            g["totals"][r["unit"]] = g["totals"].get(r["unit"], 0.0) + r["quantity"]
    out = []
    for k in sorted(order, key=lambda s: (s == "", s.lower(), s)):
        g = groups[k]
        out.append({"group": g["group"], "rows": g["rows"],
                    "totals": [{"unit": unit, "quantity": g["totals"][unit]} for unit in sorted(g["totals"])]})
    return out


def document_estimate(doc):
    """The estimate for a cleaned document: every markup linked to an assembly, rolled up."""
    from .assembly import estimate
    by = {}
    for m in doc["markups"]:
        a = m.get("assembly")
        if a and m["type"] in MEASURE_TYPES:
            try:
                r = measure(m, markup_scale(doc, m))
            except TakeoffError:
                continue
            by.setdefault(a, []).append(r)
    st = doc["settings"]
    return estimate(doc["assemblies"], by, st.get("markup_pct", 0.0), st.get("tax_pct", 0.0),
                    st.get("overhead_pct", 0.0), doc.get("rates", []))
