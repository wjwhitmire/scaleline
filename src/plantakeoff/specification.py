"""Specification check: read a project manual's sections and match them against the takeoff.

Reading (no model): section headings in CSI MasterFormat form, "SECTION 09 29 00 - GYPSUM BOARD",
"SECTION 092900", "09 29 00 GYPSUM BOARD" (a heading line in capitals) and the older five-digit form
"SECTION 09250". A section runs to END OF SECTION or the next heading; a heading seen twice (a table
of contents, then the section) keeps the one with text under it.

Matching, both ways (no model):
  each takeoff item gets a section number from its assembly's code (the library's assemblies carry
  one), or else from words in its label, subject, layer or assembly name (a fixed word list, below);
  a section matches an item when their numbers agree to the item's precision (a word match is good
  to the level it names, often the first four digits).
  Rows: "matched" (a section with the items and quantities under it), "no quantities" (a section in
  divisions 02 to 49 with nothing measured; divisions 00 and 01 are procurement and general
  requirements and are listed as such), "no section" (measured items whose section, and whose whole
  division, the manual does not have), "division only" (the division is there, the section is not),
  and "not classified" (items with no code and no word match). Only the not classified lines may be
  sent to a model, as data, with the manual's own section list as the only allowed answers.
Every row carries the source text it came from: the heading line and the first lines under it, or
the item's own label and assembly. Pure functions; web/src/core/25_specification.js gives the same
results.
"""

from __future__ import annotations

import math
import re

from .errors import TakeoffError

HEAD_SECTION = re.compile(r"^\s*SECTION\s+(\d{2})\s?(\d{2})\s?(\d{2})(?:\.(\d{2}))?\b\s*[-:.–]?\s*(.*)$", re.I)
HEAD_OLD = re.compile(r"^\s*SECTION\s+(\d{5})\b\s*[-:.–]?\s*(.*)$", re.I)
HEAD_BARE = re.compile(r"^\s*(\d{2})\s(\d{2})\s(\d{2})(?:\.(\d{2}))?\s+[-–]?\s*([A-Z][A-Z0-9 ,&/()'-]{2,80})$")
END = re.compile(r"^\s*END\s+OF\s+SECTION\b", re.I)
PART = re.compile(r"^\s*PART\s+([123])\b", re.I)

DIVISIONS = {
    "00": "Procurement and contracting requirements", "01": "General requirements", "02": "Existing conditions",
    "03": "Concrete", "04": "Masonry", "05": "Metals", "06": "Wood, plastics and composites",
    "07": "Thermal and moisture protection", "08": "Openings", "09": "Finishes", "10": "Specialties",
    "11": "Equipment", "12": "Furnishings", "13": "Special construction", "14": "Conveying equipment",
    "21": "Fire suppression", "22": "Plumbing", "23": "Heating, ventilating and air conditioning",
    "25": "Integrated automation", "26": "Electrical", "27": "Communications", "28": "Electronic safety and security",
    "31": "Earthwork", "32": "Exterior improvements", "33": "Utilities",
}

# Words in a takeoff item and the section they point to, with how many digits of the number count.
WORDS = [
    (r"\bdemo(lition|lish)?\b", "02 41 00", 4),
    (r"\b(rebar|reinforc\w*|welded wire|mesh)\b", "03 20 00", 4),
    (r"\b(concrete|slab|footing|foundation|sidewalk slab)\b", "03 30 00", 4),
    (r"\b(masonry|cmu|block wall|brick)\b", "04 20 00", 4),
    (r"\b(steel stud|metal stud|metal framing)\b", "09 22 16", 6),
    (r"\b(gypsum|drywall|wallboard|partition)\b", "09 29 00", 4),
    (r"\b(studs?|framing|plates?|lumber|joists?|rafters?|[1-4]x(?:4|6|8|10|12))\b", "06 10 00", 4),
    (r"\b(sheathing|osb|plywood)\b", "06 16 00", 4),
    (r"\b(insulation|batt)\b", "07 21 00", 4),
    (r"\b(roof\w*|shingles?|underlayment)\b", "07 30 00", 3),
    (r"\b(house wrap|weather barrier|vapor barrier)\b", "07 25 00", 4),
    (r"\b(hardware|lockset|lever set|hinges?)\b", "08 71 00", 4),
    (r"\b(doors?|frames?)\b", "08 10 00", 3),
    (r"\b(windows?|glazing|storefront)\b", "08 50 00", 3),
    (r"\b(acoustical|ceiling)\b", "09 51 00", 4),
    (r"\b(flooring|vinyl|carpet|resilient|tile|lvt|vct)\b", "09 60 00", 3),
    (r"\b(paint\w*|coating)\b", "09 91 00", 4),
    (r"\b(toilet accessor\w*|signage)\b", "10 00 00", 2),
    (r"\b(sprinklers?)\b", "21 13 00", 4),
    (r"\b(plumbing|fixtures?|lavator\w*|water closet|sink|toilet)\b", "22 40 00", 3),
    (r"\b(duct\w*|hvac|diffusers?|grilles?)\b", "23 00 00", 2),
    (r"\b(receptacles?|outlets?|switch(es)?|wiring device\w*)\b", "26 27 26", 4),
    (r"\b(lighting|luminaires?|light fixtures?)\b", "26 50 00", 3),
    (r"\b(data|telecom\w*)\b", "27 00 00", 2),
    (r"\b(excavat\w*|trench\w*|backfill|grading|earthwork)\b", "31 20 00", 3),
    (r"\b(paving|asphalt|curbs?|sidewalks?)\b", "32 10 00", 3),
    (r"\b(landscap\w*|sod|seeding|planting)\b", "32 90 00", 3),
]
_WORDS = [(re.compile(p, re.I), n, d) for p, n, d in WORDS]


def _clean(s, cap):
    s = s if isinstance(s, str) else ""
    s = re.sub(r"[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]", " ", s)
    return re.sub(r"\s+", " ", s).strip()[:cap]


def section_number(text):
    """A section number in any common form, as "DD DD DD" (or "DD DD DD.DD"), or None."""
    if not isinstance(text, str):
        return None
    t = text.strip()
    m = re.match(r"^(\d{2})\s?(\d{2})\s?(\d{2})(?:\.(\d{2}))?$", t)
    if not m:
        return None
    return f"{m.group(1)} {m.group(2)} {m.group(3)}" + (f".{m.group(4)}" if m.group(4) else "")


def _digits(number):
    return re.sub(r"\D", "", number or "")


def parse_sections(lines):
    """Sections of a project manual. lines: [{page, str}] or strings, in reading order.
    Returns {sections: [{number, title, division, division_name, page, line, text, body, parts, old}],
    lines: count}. text is the heading line; body the first lines under it (up to 400 characters)."""
    if not isinstance(lines, list):
        raise TakeoffError("input", "The project manual must be a list of lines")
    rows = []
    for i, ln in enumerate(lines[:200000]):
        if isinstance(ln, str):
            rows.append((0, _clean(ln, 400)))
        elif isinstance(ln, dict):
            pg = ln.get("page")
            pg = pg if isinstance(pg, int) and not isinstance(pg, bool) and 0 <= pg < 100000 else 0
            rows.append((pg, _clean(ln.get("str"), 400)))
    secs = []
    cur = None
    for i, (pg, s) in enumerate(rows):
        if not s:
            continue
        head = None
        m = HEAD_SECTION.match(s)
        if m:
            head = (f"{m.group(1)} {m.group(2)} {m.group(3)}" + (f".{m.group(4)}" if m.group(4) else ""), m.group(5), False)
        else:
            m = HEAD_OLD.match(s)
            if m:
                head = (m.group(1), m.group(2), True)
            else:
                m = HEAD_BARE.match(s)
                if m:
                    head = (f"{m.group(1)} {m.group(2)} {m.group(3)}" + (f".{m.group(4)}" if m.group(4) else ""), m.group(5), False)
        if head:
            number, title, old = head
            title = _clean(title, 120)
            cur = {"number": number, "title": title, "division": number[:2], "division_name": DIVISIONS.get(number[:2], ""),
                   "page": pg, "line": i, "text": s, "body": "", "parts": [], "old": old, "ended": False}
            secs.append(cur)
            continue
        if cur is None or cur["ended"]:
            continue
        if END.match(s):
            cur["ended"] = True
            continue
        pm = PART.match(s)
        if pm and pm.group(1) not in cur["parts"]:
            cur["parts"].append(pm.group(1))
        if len(cur["body"]) < 400:
            cur["body"] = (cur["body"] + " " + s).strip()[:400]
    # a heading seen twice (table of contents, then the section): keep the one with text under it
    out = []
    index = {}
    for sec in secs:
        sec.pop("ended")
        k = sec["number"]
        if k in index:
            prev = out[index[k]]
            if not prev["body"] and sec["body"]:
                sec["listed"] = True
                out[index[k]] = sec
            else:
                prev["listed"] = True
            continue
        index[k] = len(out)
        out.append(sec)
    for sec in out:
        sec.setdefault("listed", False)
        sec["parts"] = sorted(sec["parts"])
    return {"sections": out, "lines": len(rows)}


def classify_item(item):
    """The section a takeoff item points to: {number, digits (how many count), source: "code" or
    "words", why, also: [other sections its words name]} or None. item: {label, subject, layer,
    assembly_name, assembly_code}. An interior partition names both studs and gypsum board."""
    code = section_number(_clean(item.get("assembly_code"), 40)) if isinstance(item, dict) else None
    if code:
        return {"number": code, "digits": 6, "source": "code", "why": f"assembly code {code}", "also": []}
    text = " ".join(_clean(item.get(k), 200) for k in ("label", "subject", "layer", "assembly_name")) if isinstance(item, dict) else ""
    found = []
    for rx, number, digits in _WORDS:
        m = rx.search(text)
        if m and number not in [f["number"] for f in found]:
            found.append({"number": number, "digits": digits, "why": f"the word \"{m.group(0)}\""})
    if not found:
        return None
    out = dict(found[0], source="words")
    out["also"] = found[1:]
    return out


def _match(sec_digits, item_digits, digits):
    return sec_digits[:digits] == item_digits[:digits]


def match_scope(sections, items):
    """Rows matching the manual's sections and the takeoff items both ways (see the module notes).
    sections: from parse_sections; items: [{id, label, subject, layer, assembly_name, assembly_code,
    quantity, unit}] (a takeoff group or markup). Returns {rows, counts}."""
    secs = [s for s in sections if isinstance(s, dict) and isinstance(s.get("number"), str)]
    its = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        c = classify_item(it)
        q = it.get("quantity")
        its.append({"id": _clean(it.get("id"), 64), "label": _clean(it.get("label"), 200) or _clean(it.get("subject"), 200),
                     "assembly": _clean(it.get("assembly_name"), 200), "quantity": q if isinstance(q, (int, float)) and not isinstance(q, bool) and math.isfinite(q) else None,
                     "unit": _clean(it.get("unit"), 20), "cls": c})
    rows = []
    used = set()
    for s in secs:
        sd = _digits(s["number"])
        hits = []
        for k, it in enumerate(its):
            c = it["cls"]
            if not c:
                continue
            # a five-digit (1995) number only tells the division
            for cc in [c] + c["also"]:
                if (sd[:2] == _digits(cc["number"])[:2]) if s["old"] else _match(sd, _digits(cc["number"]), cc["digits"]):
                    hits.append(k)
                    it["hit_why"] = cc["why"]
                    break
        source = {"page": s["page"], "text": s["text"], "body": s["body"]}
        if hits:
            used.update(hits)
            rows.append({"status": "matched", "section": s["number"], "title": s["title"], "source": source,
                         "items": [{"id": its[k]["id"], "label": its[k]["label"], "quantity": its[k]["quantity"], "unit": its[k]["unit"],
                                    "why": its[k]["hit_why"]} for k in hits]})
        elif s["division"] in ("00", "01"):
            rows.append({"status": "general", "section": s["number"], "title": s["title"], "source": source, "items": []})
        else:
            rows.append({"status": "no quantities", "section": s["number"], "title": s["title"], "source": source, "items": []})
    divisions = {s["division"] for s in secs}
    for k, it in enumerate(its):
        if k in used:
            continue
        src = {"page": None, "text": it["label"] + (" (" + it["assembly"] + ")" if it["assembly"] else ""), "body": ""}
        entry = {"id": it["id"], "label": it["label"], "quantity": it["quantity"], "unit": it["unit"]}
        c = it["cls"]
        if not c:
            rows.append({"status": "not classified", "section": "", "title": "", "source": src, "items": [entry]})
            continue
        entry["why"] = c["why"]
        div = c["number"][:2]
        rows.append({"status": "division only" if div in divisions else "no section", "section": c["number"],
                     "title": DIVISIONS.get(div, ""), "source": src, "items": [entry]})
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {"rows": rows, "counts": counts}


def apply_classes(result, answers, sections):
    """Fold a model's answers for not classified items back in, keeping only answers that name a
    section the manual has. answers: {item id: section number or None}. Returns (result, rejected)."""
    allowed = {s["number"]: s for s in sections}
    rejected = []
    rows = []
    for r in result["rows"]:
        if r["status"] != "not classified":
            rows.append(r)
            continue
        it = r["items"][0]
        ans = answers.get(it["id"]) if isinstance(answers, dict) else None
        num = section_number(ans) if isinstance(ans, str) else None
        if num and num in allowed:
            s = allowed[num]
            it = dict(it, why="classified by the model (check it)")
            rows.append({"status": "matched", "section": num, "title": s["title"], "source": r["source"], "items": [it], "model": True})
        else:
            if ans is not None:
                rejected.append(it["id"])
            rows.append(r)
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {"rows": rows, "counts": counts}, rejected
