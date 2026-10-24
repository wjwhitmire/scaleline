"""Plan review: deterministic checks on a plan set, each finding tied to its evidence.

Rules (all run without a model):
  duplicate-sheet    two or more sheets with the same sheet number (compared without spaces,
                     dashes and dots, so A-101 and A101 are the same)
  index              the drawing index on a cover sheet (a heading such as SHEET INDEX, then rows
                     of a sheet number and title) against the title blocks: listed but missing,
                     present but not listed, and titles that differ
  untagged-door      a door found by auto-takeoff with no door tag beside it: neither the tag
                     auto-takeoff read nor a short mark (D1, 101A, or digits alone, as drawn in a
                     tag circle) within 2.5 door widths that sits nearer the door than any room's
                     center (room numbers sit at the room's center). A sheet where no door has a
                     tag (three doors or more) gives one finding for the sheet, not one per door
  room-schedule      rooms named on plans against the rows of a room or finish schedule (a heading
                     such as ROOM FINISH SCHEDULE, then rows starting with a room number), both ways
  dimension-sum      a dimension string whose parts do not add up to the overall dimension that
                     spans them (more than 1/2 in apart). Parts and overall are read from horizontal
                     dimension text and the dimension line under each; turned text is not read.
  dimension-scale    a dimension whose drawn length at the sheet scale differs from its text by more
                     than 2% (and 1 in); two or more that agree on one ratio are reported once as a
                     scale problem with that ratio
  scale-mismatch     the title block's scale against the scale set on the sheet (more than 1% apart),
                     and a sheet with several different scale notes and no viewports
  revision-cloud     a change found by comparing revisions that no revision cloud covers

Every finding has an id, the rule, a severity, the page and a place on it, a plain message, the
evidence (the text, markups or detections it rests on) and, where it fits, a draft RFI. A model can
summarize the findings afterwards, but the findings never depend on it.
Pure functions; the browser core (web/src/core/24_review.js) gives the same results.
"""

from __future__ import annotations

import math
import re

from .errors import TakeoffError
from .scale import parse_scale_text
from .units import format_ftin, parse_length

INDEX_HEAD = re.compile(r"^(SHEET|DRAWING)S?\s+(INDEX|LIST)\b", re.I)
INDEX_ROW = re.compile(r"^([A-Z]{1,3}[-. ]?\d{1,3}(?:\.\d{1,3})?[A-Z]?)\s+(.{2,120})$")
SCHED_HEAD = re.compile(r"\b(ROOM\s+FINISH|ROOM|FINISH)\s+SCHEDULE\b", re.I)
ROOM_NO = re.compile(r"^[A-Z]?\d{1,4}$")
TAG_MARK = re.compile(r"^(D-?\d{1,3}[A-Z]?|[A-Z]?\d{1,4}[A-Z]?)$")
DIM_LIKE = re.compile(r"^\s*\d[\d\s/]*(?:'|\")")
SEVERITY = ("high", "medium", "low")


def _rnd(x):
    return float(math.floor(x + 0.5))


def _r6(x):
    return _rnd(x * 1e6) / 1e6


def _g(x):
    x = float(x)
    return str(int(x)) if x == int(x) else repr(x)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _clean(s, cap=200):
    s = s if isinstance(s, str) else ""
    s = re.sub(r"[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]", " ", s)
    return re.sub(r"\s+", " ", s).strip()[:cap]


def sheet_key(number):
    """A sheet number for comparing: upper case without spaces, dashes and dots."""
    return re.sub(r"[-. ]", "", number.upper()) if isinstance(number, str) else ""


def _title_key(t):
    return re.sub(r"[^A-Z0-9]+", " ", t.upper()).strip()


def _items(raw):
    out = []
    for it in raw or []:
        if not isinstance(it, dict) or not isinstance(it.get("str"), str):
            continue
        if not all(_num(it.get(k)) for k in ("x", "y", "w", "h")):
            continue
        s = _clean(it["str"], 300)
        if s:
            out.append({"str": s, "x": float(it["x"]), "y": float(it["y"]), "w": max(0.0, float(it["w"])),
                        "h": max(0.0, float(it["h"])), "v": it.get("vertical") is True})
    return out


def _rows(items):
    """Items on one baseline (within 1.5 pt or 30% of their height), left to right: table rows."""
    its = sorted([i for i in items if not i["v"]], key=lambda a: (a["y"], a["x"]))
    rows = []
    for it in its:
        if rows and abs(rows[-1][0]["y"] - it["y"]) <= max(1.5, 0.3 * it["h"]):
            rows[-1].append(it)
        else:
            rows.append([it])
    for r in rows:
        r.sort(key=lambda a: a["x"])
    return rows


def parse_sheet_index(items):
    """Rows of a drawing index on one page: [{number, title, y}]. Empty when the page has none."""
    rows = _rows(_items(items))
    head = None
    for r in rows:
        line = " ".join(c["str"] for c in r)
        if INDEX_HEAD.search(line):
            head = r
            break
    if head is None:
        return []
    hx, hy, hh = head[0]["x"], head[0]["y"], head[0]["h"]
    out = []
    last = hy
    misses = 0
    for r in rows:
        if r[0]["y"] <= hy:
            continue
        if r[0]["y"] - last > 4 * max(hh, r[0]["h"]):
            break
        cells = [c for c in r if c["x"] >= hx - 24]
        line = " ".join(c["str"] for c in cells)
        m = INDEX_ROW.match(line)
        if m:
            out.append({"number": m.group(1), "title": _clean(m.group(2), 120), "y": _r6(r[0]["y"])})
            last = r[0]["y"]
            misses = 0
        else:
            misses += 1
            if misses >= 2:
                break
    return out


def parse_schedule(items):
    """Rows of a room or finish schedule on one page: {kind, rows: [{number, name}]} or None."""
    rows = _rows(_items(items))
    head = None
    for r in rows:
        line = " ".join(c["str"] for c in r)
        m = SCHED_HEAD.search(line)
        if m:
            head = (r, "finish" if "FINISH" in m.group(1).upper() else "room")
            break
    if head is None:
        return None
    hy = head[0][0]["y"]
    out = []
    last = hy
    for r in rows:
        if r[0]["y"] <= hy:
            continue
        if r[0]["y"] - last > 5 * max(head[0][0]["h"], r[0]["h"]):
            break
        if ROOM_NO.match(r[0]["str"]) and len(r) >= 2 and re.search(r"[A-Za-z]{2}", r[1]["str"]):
            out.append({"number": r[0]["str"], "name": _clean(r[1]["str"], 80)})
            last = r[0]["y"]
    return {"kind": head[1], "rows": out}


# ---------------------------------------------------------------- dimensions


def _dims(items, segs):
    """Horizontal dimension text with the dimension line under or over it: [{value, text, x0, x1,
    y (line), cx}]. segs: [[x0, y0, x1, y1, ...]] in sheet points."""
    hor = []
    for s in segs or []:
        if not isinstance(s, list) or len(s) < 4 or not all(_num(v) for v in s[:4]):
            continue
        if abs(s[1] - s[3]) <= 0.5 and abs(s[2] - s[0]) >= 10:
            hor.append((min(s[0], s[2]), max(s[0], s[2]), (s[1] + s[3]) / 2))
    out = []
    for it in items:
        if it["v"] or not DIM_LIKE.match(it["str"]):
            continue
        try:
            v = parse_length(it["str"], "ft")
        except TakeoffError:
            continue
        if v <= 0:
            continue
        cx = it["x"] + it["w"] / 2
        best = None
        for x0, x1, y in hor:
            if not (x0 <= cx <= x1):
                continue
            d = y - it["y"]
            if -it["h"] - 10 <= d <= 10:
                k = abs(d)
                if best is None or k < best[0]:
                    best = (k, x0, x1, y)
        if best:
            out.append({"value": v, "text": it["str"], "x0": best[1], "x1": best[2], "y": best[3], "cx": cx})
    return out


def check_dimensions(items, segs, in_per_pt):
    """Findings (without ids) for dimension strings that do not add up and dimensions that do not
    match the drawing at the sheet scale."""
    dims = _dims(_items(items), segs)
    found = []
    for d in dims:
        parts = [e for e in dims if e is not d and 4 <= abs(e["y"] - d["y"]) <= 80 and e["x0"] >= d["x0"] - 1 and e["x1"] <= d["x1"] + 1]
        rows = {}
        for e in parts:
            rows.setdefault(_rnd(e["y"] * 2), []).append(e)
        for key in sorted(rows):
            row = sorted(rows[key], key=lambda e: e["x0"])
            if len(row) < 2:
                continue
            span = d["x1"] - d["x0"]
            if sum(e["x1"] - e["x0"] for e in row) < 0.97 * span:
                continue
            if any(row[i + 1]["x0"] < row[i]["x1"] - 1 for i in range(len(row) - 1)):
                continue
            total = sum(e["value"] for e in row)
            if abs(total - d["value"]) > 0.5:
                found.append({"rule": "dimension-sum", "severity": "high", "where": [_r6(d["x0"]), _r6(min(e["y"] for e in row) - 12), _r6(d["x1"]), _r6(d["y"] + 4)],
                              "message": "Dimension string does not add up: " + " + ".join(e["text"] for e in row) + " = " + format_ftin(total, 16)
                              + ", but the overall dimension reads " + d["text"] + ".",
                              "evidence": [{"kind": "text", "text": e["text"]} for e in row] + [{"kind": "text", "text": d["text"]}],
                              "rfi": {"subject": "Dimension string does not close",
                                      "question": "The dimensions " + ", ".join(e["text"] for e in row) + " add up to " + format_ftin(total, 16)
                                      + " but the overall dimension is " + d["text"] + ". Please confirm the correct dimensions."}})
    if in_per_pt:
        bad = []
        for d in dims:
            drawn = (d["x1"] - d["x0"]) * in_per_pt
            if abs(drawn - d["value"]) > max(1.0, 0.02 * d["value"]):
                bad.append((drawn / d["value"], d, drawn))
        groups = []
        for ratio, d, drawn in sorted(bad, key=lambda b: b[0]):
            if groups and abs(ratio - groups[-1][0][0]) <= 0.02 * groups[-1][0][0]:
                groups[-1].append((ratio, d, drawn))
            else:
                groups.append([(ratio, d, drawn)])
        for g in groups:
            if len(g) >= 2:
                r = g[0][0]
                found.append({"rule": "dimension-scale", "severity": "high", "where": None,
                              "message": f"{len(g)} dimensions measure {_g(_rnd(r * 100) / 100)} times their written value at the sheet scale. The scale set on this sheet may be wrong, or the view is not to scale.",
                              "evidence": [{"kind": "text", "text": d["text"] + " drawn " + format_ftin(drawn, 16)} for _, d, drawn in g[:6]],
                              "rfi": None})
            else:
                _, d, drawn = g[0]
                found.append({"rule": "dimension-scale", "severity": "medium", "where": [_r6(d["x0"]), _r6(d["y"] - 12), _r6(d["x1"]), _r6(d["y"] + 4)],
                              "message": "Dimension " + d["text"] + " is drawn " + format_ftin(drawn, 16) + " long at the sheet scale.",
                              "evidence": [{"kind": "text", "text": d["text"]}],
                              "rfi": {"subject": "Dimension does not match the drawing",
                                      "question": "The dimension " + d["text"] + " scales to " + format_ftin(drawn, 16)
                                      + ". Please confirm which governs."}})
    return found


# ---------------------------------------------------------------- the review


def _box_overlap(a, b):
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def _bbox(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def plan_review(plan_set):
    """Run every rule. plan_set: {sheets: [{page, number, title, scale_text, in_per_pt, viewports,
    items, segs, doors, rooms, clouds, changes}]}; any part may be missing. doors and rooms come from
    auto-takeoff ({id, at, tag} and {id, name, number}); clouds are markups ({id, points}); changes
    are boxes from comparing revisions. Returns {findings, checked, notes}."""
    if not isinstance(plan_set, dict) or not isinstance(plan_set.get("sheets"), list):
        raise TakeoffError("input", "The plan set needs its sheets")
    sheets = []
    for s in plan_set["sheets"][:20000]:
        if not isinstance(s, dict) or not isinstance(s.get("page"), int) or isinstance(s.get("page"), bool):
            continue
        sheets.append(s)
    findings = []
    checked = []
    notes = []

    def add(f, page, sheet):
        f = dict(f)
        f["page"] = page
        f["sheet"] = sheet
        findings.append(f)

    def label(s):
        return _clean(s.get("number"), 40) or f"page {s['page'] + 1}"

    # duplicate sheet numbers
    checked.append("duplicate-sheet")
    by = {}
    order = []
    for s in sheets:
        k = sheet_key(_clean(s.get("number"), 40))
        if not k:
            continue
        if k not in by:
            by[k] = []
            order.append(k)
        by[k].append(s)
    for k in order:
        if len(by[k]) > 1:
            pages = ", ".join(str(s["page"] + 1) for s in by[k])
            add({"rule": "duplicate-sheet", "severity": "high", "where": None,
                 "message": f"Sheet number {_clean(by[k][0].get('number'), 40)} is used on pages {pages}.",
                 "evidence": [{"kind": "sheet", "text": f"page {s['page'] + 1}: {_clean(s.get('number'), 40)} {_clean(s.get('title'), 80)}".strip()} for s in by[k]],
                 "rfi": {"subject": "Duplicate sheet number", "question": f"Sheet number {_clean(by[k][0].get('number'), 40)} appears on more than one sheet (pages {pages}). Please confirm the correct numbering."}},
                by[k][1]["page"], label(by[k][1]))
    # drawing index against title blocks
    index, index_page = [], None
    for s in sheets:
        rows = parse_sheet_index(s.get("items"))
        if rows:
            index, index_page = rows, s
            break
    if index:
        checked.append("index")
        listed = {}
        for r in index:
            listed.setdefault(sheet_key(r["number"]), r)
        for r in index:
            k = sheet_key(r["number"])
            if k not in by:
                add({"rule": "index", "severity": "medium", "where": None,
                     "message": f"The drawing index lists {r['number']} {r['title']}, but no sheet in the set has that number.",
                     "evidence": [{"kind": "text", "text": f"{r['number']} {r['title']}"}],
                     "rfi": {"subject": "Sheet listed but missing", "question": f"The drawing index lists sheet {r['number']} ({r['title']}), which is not in the set. Please issue it or revise the index."}},
                    index_page["page"], label(index_page))
            else:
                s = by[k][0]
                t = _clean(s.get("title"), 120)
                if t and _title_key(t) != _title_key(r["title"]) and _title_key(t) not in _title_key(r["title"]) and _title_key(r["title"]) not in _title_key(t):
                    add({"rule": "index", "severity": "low", "where": None,
                         "message": f"Sheet {r['number']}: the index says \"{r['title']}\", the title block says \"{t}\".",
                         "evidence": [{"kind": "text", "text": f"{r['number']} {r['title']}"}, {"kind": "sheet", "text": t}],
                         "rfi": None}, s["page"], label(s))
        for k in order:
            if k not in listed:
                s = by[k][0]
                add({"rule": "index", "severity": "low", "where": None,
                     "message": f"Sheet {label(s)} is not in the drawing index.",
                     "evidence": [{"kind": "sheet", "text": f"{label(s)} {_clean(s.get('title'), 80)}".strip()}], "rfi": None}, s["page"], label(s))
    else:
        notes.append("No drawing index was found in the set's text, so the index check did not run.")
    # doors without tags
    checked.append("untagged-door")
    for s in sheets:
        doors = [d for d in (s.get("doors") or []) if isinstance(d, dict) and isinstance(d.get("at"), list) and len(d["at"]) == 2 and all(_num(v) for v in d["at"])]
        marks = [(it["x"] + it["w"] / 2, it["y"] - it["h"] / 2) for it in _items(s.get("items")) if TAG_MARK.match(it["str"])]
        centers = [r["center"] for r in (s.get("rooms") or []) if isinstance(r, dict) and isinstance(r.get("center"), list) and len(r["center"]) == 2
                   and all(_num(v) for v in r["center"])]

        def tagged(d):
            if _clean(d.get("tag"), 20):
                return True
            reach = 2.5 * (float(d["width_pt"]) if _num(d.get("width_pt")) and d["width_pt"] > 0 else 36.0)
            for m in marks:
                dd = math.sqrt((m[0] - d["at"][0]) ** 2 + (m[1] - d["at"][1]) ** 2)
                if dd <= reach and all(dd < math.sqrt((m[0] - c[0]) ** 2 + (m[1] - c[1]) ** 2) for c in centers):
                    return True
            return False
        bare = [d for d in doors if not tagged(d)]
        if len(bare) >= 3 and len(bare) == len(doors):
            box = _bbox([d["at"] for d in bare])
            add({"rule": "untagged-door", "severity": "medium", "where": [_r6(box[0] - 12), _r6(box[1] - 12), _r6(box[2] + 12), _r6(box[3] + 12)],
                 "message": f"None of the {len(bare)} doors on {label(s)} has a door tag.",
                 "evidence": [{"kind": "detection", "ref": _clean(d.get("id"), 20), "text": "door " + _clean(d.get("id"), 20)} for d in bare[:50]],
                 "rfi": {"subject": "Untagged doors", "question": f"The doors on sheet {label(s)} carry no door tags. Please provide door numbers and the door schedule, or confirm that none is required."}},
                s["page"], label(s))
            continue
        for d in bare:
            at = d["at"]
            add({"rule": "untagged-door", "severity": "medium", "where": [_r6(at[0] - 12), _r6(at[1] - 12), _r6(at[0] + 12), _r6(at[1] + 12)],
                 "message": f"A door on {label(s)} has no door tag beside it.",
                 "evidence": [{"kind": "detection", "ref": _clean(d.get("id"), 20), "text": "door " + _clean(d.get("id"), 20)}],
                 "rfi": {"subject": "Untagged door", "question": f"The door near the marked location on sheet {label(s)} has no tag. Please provide its door number and hardware set."}},
                s["page"], label(s))
    # rooms against schedules
    sched = []
    for s in sheets:
        sc = parse_schedule(s.get("items"))
        if sc and sc["rows"]:
            sched.append((s, sc))
    plan_rooms = []
    for s in sheets:
        for r in s.get("rooms") or []:
            if isinstance(r, dict) and _clean(r.get("number"), 10):
                plan_rooms.append((s, r))
    if sched:
        checked.append("room-schedule")
        rows = {}
        for s, sc in sched:
            for r in sc["rows"]:
                rows.setdefault(r["number"].upper(), (s, r, sc["kind"]))
        seen = set()
        for s, r in plan_rooms:
            n = _clean(r.get("number"), 10).upper()
            seen.add(n)
            if n not in rows:
                nm = _clean(r.get("name"), 60)
                add({"rule": "room-schedule", "severity": "medium", "where": None,
                     "message": f"Room {n} {nm} is on {label(s)} but not in the {sched[0][1]['kind']} schedule.".replace("  ", " "),
                     "evidence": [{"kind": "detection", "ref": _clean(r.get("id"), 20), "text": f"room {n} {nm}".strip()}],
                     "rfi": {"subject": "Room missing from schedule", "question": f"Room {n} {nm} on sheet {label(s)} is not in the schedule. Please provide its finishes.".replace("  ", " ")}},
                    s["page"], label(s))
        if plan_rooms:
            for n, (s, r, kind) in rows.items():
                if n not in seen:
                    add({"rule": "room-schedule", "severity": "low", "where": None,
                         "message": f"Room {r['number']} {r['name']} is in the {kind} schedule but on no plan read here.",
                         "evidence": [{"kind": "text", "text": f"{r['number']} {r['name']}"}], "rfi": None}, s["page"], label(s))
    else:
        notes.append("No room or finish schedule was found in the set's text, so the schedule check did not run.")
    # dimensions
    checked.append("dimension-sum")
    checked.append("dimension-scale")
    for s in sheets:
        ipp = s.get("in_per_pt") if _num(s.get("in_per_pt")) and s.get("in_per_pt") > 0 else None
        if s.get("viewports"):
            ipp = None  # several scales on the sheet: drawn lengths are not checked
        for f in check_dimensions(s.get("items"), s.get("segs"), ipp):
            add(f, s["page"], label(s))
    # scales
    checked.append("scale-mismatch")
    for s in sheets:
        notes_found = [f for f in parse_scale_text(_clean(s.get("scale_text"), 200)) if f["in_per_pt"]]
        ipp = s.get("in_per_pt") if _num(s.get("in_per_pt")) and s.get("in_per_pt") > 0 else None
        if notes_found and ipp and abs(notes_found[0]["in_per_pt"] - ipp) > 0.01 * ipp:
            add({"rule": "scale-mismatch", "severity": "high", "where": None,
                 "message": f"The title block of {label(s)} says {notes_found[0]['text']}, but the scale set on the sheet is different.",
                 "evidence": [{"kind": "text", "text": notes_found[0]["text"]}],
                 "rfi": None}, s["page"], label(s))
        texts = " | ".join(i["str"] for i in _items(s.get("items")) if "SCALE" in i["str"].upper())
        vals = []
        for f in parse_scale_text(texts):
            if f["in_per_pt"] and all(abs(f["in_per_pt"] - v[0]) > 1e-9 for v in vals):
                vals.append((f["in_per_pt"], f["text"]))
        if len(vals) >= 2 and not s.get("viewports"):
            add({"rule": "scale-mismatch", "severity": "medium", "where": None,
                 "message": f"{label(s)} has {len(vals)} different scale notes ({', '.join(v[1] for v in vals)}) and no viewports, so every measurement on it uses one scale.",
                 "evidence": [{"kind": "text", "text": v[1]} for v in vals], "rfi": None}, s["page"], label(s))
    # revision changes without clouds
    any_changes = False
    for s in sheets:
        changes = [c for c in s.get("changes") or [] if isinstance(c, list) and len(c) == 4 and all(_num(v) for v in c)]
        if not changes:
            continue
        any_changes = True
        clouds = []
        for m in s.get("clouds") or []:
            if isinstance(m, dict) and isinstance(m.get("points"), list) and m["points"]:
                try:
                    clouds.append(_bbox(m["points"]))
                except (TypeError, IndexError):
                    continue
        for c in changes:
            if not any(_box_overlap(c, b) for b in clouds):
                add({"rule": "revision-cloud", "severity": "medium", "where": [_r6(v) for v in c],
                     "message": f"A change between revisions on {label(s)} has no revision cloud.",
                     "evidence": [{"kind": "detection", "text": "change found by compare"}],
                     "rfi": {"subject": "Unmarked revision", "question": f"Sheet {label(s)} changed at the marked location without a revision cloud or delta. Please confirm the change is intended and issue it clouded."}},
                    s["page"], label(s))
    if any_changes:
        checked.append("revision-cloud")
    rank = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: (rank[f["severity"]], f["page"], f["rule"]))
    for n, f in enumerate(findings):
        f["id"] = f"f{n + 1}"
    return {"findings": findings, "checked": checked, "notes": notes}


def rfi_drafts(findings):
    """Draft RFIs from the findings that have one, numbered in order, each citing its finding."""
    out = []
    for f in findings:
        r = f.get("rfi")
        if r:
            out.append({"id": f"RFI-{len(out) + 1:03d}", "finding": f["id"], "page": f["page"], "sheet": f["sheet"],
                        "subject": r["subject"], "question": r["question"]})
    return out
