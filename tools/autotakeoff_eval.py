"""Measure auto-takeoff against the labeled plan sheets: precision and recall per class.

The sheets (tests/plan_sheets.py, written into the corpus by tools/make_corpus.py) are invented
floor plans drawn the way CAD exports draw them, with ground truth for every wall, room, door,
window and symbol, plus things drawn on purpose to fool a detector (a shelf, a table, dimension
strings, a border and title block). Vector sheets are read with pdf.js exactly as the app reads
them (tools/sheet_input.mjs); the scanned sheet goes through the app's line and door swing
detection, and its receptacles through the app's pick-one-find-the-rest search with the first
labeled copy as the example (the same search for doors is reported beside it).

Both cores run on the same input: the browser core (the numbers reported) and the Python library;
any difference is a failure.

Scoring, per class:
  walls    (types: the found wall covering most of a labeled wall must be exterior or interior as
           labeled) a found wall counts when at least 80% of its length lies on labeled centerlines (parallel,
           within half a wall thickness, plus 2 pt); a labeled wall is found when 80% of its length
           is covered by found walls. Precision and recall count walls; the length error compares
           total found and labeled length.
  rooms    a found room matches a labeled room when its center lies inside the label and the areas
           agree within 5%; one to one. Names are checked on matched rooms.
  doors, windows   a found opening matches the nearest unmatched label within a quarter of the
           label's width (at least 6 pt); widths and door tags are checked on matches.
  symbols  every counted copy is matched to the nearest unmatched labeled copy within 3 pt; the
           kind must agree with the legend label when the group has one.

Run: python tools/autotakeoff_eval.py [--corpus corpus] [--json out.json] [--sweep]
Without a corpus the sheets are written to a temporary folder first.
"""

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

from plantakeoff import autotakeoff as at  # noqa: E402

NODE = ["node", str(ROOT / "tools" / "sheet_input.mjs")]


def node(*args):
    r = subprocess.run(NODE + [str(a) for a in args], capture_output=True, text=True, timeout=1200)
    if r.returncode != 0:
        raise SystemExit("sheet_input.mjs failed: " + r.stderr[-2000:])


def entries(corpus):
    man = Path(corpus) / "manifest.json" if corpus else None
    if man and man.exists():
        m = json.loads(man.read_text())
        found = [f for f in m.get("files", []) if f.get("kind", "").startswith("autotakeoff")]
        if found:
            return Path(corpus), found
    import pdf_fixtures as fx
    import plan_sheets as ps
    out = Path(tempfile.mkdtemp(prefix="plans-"))
    return out, ps.write_files(out, fx.build_pdf, fx.stream)


# ---------------------------------------------------------------- scoring


def _frame(a, b):
    L = math.dist(a, b)
    return (b[0] - a[0]) / L, (b[1] - a[1]) / L, L


def _cover(target, others, tol_of):
    """Length of target (a, b) that lies on any of others (parallel, within tolerance), merged."""
    a, b = target["a"], target["b"]
    ux, uy, L = _frame(a, b)
    spans = []
    for o in others:
        vx, vy, M = _frame(o["a"], o["b"])
        if abs(ux * vy - uy * vx) > 0.02:
            continue
        tol = tol_of(target, o)
        offs = [-(p[0] - a[0]) * uy + (p[1] - a[1]) * ux for p in (o["a"], o["b"])]
        if max(abs(x) for x in offs) > tol:
            continue
        al = sorted((p[0] - a[0]) * ux + (p[1] - a[1]) * uy for p in (o["a"], o["b"]))
        lo, hi = max(0.0, al[0]), min(L, al[1])
        if hi > lo:
            spans.append((lo, hi))
    spans.sort()
    tot, cur = 0.0, None
    for lo, hi in spans:
        if cur is None or lo > cur[1]:
            if cur:
                tot += cur[1] - cur[0]
            cur = [lo, hi]
        else:
            cur[1] = max(cur[1], hi)
    if cur:
        tot += cur[1] - cur[0]
    return tot, L


def score_walls(found, labels, ipp):
    lab = [{"a": w["a"], "b": w["b"], "t": w["t_in"] / ipp, "kind": w["kind"]} for w in labels]
    det = [{"a": w["a"], "b": w["b"], "t": w["thickness_pt"], "type": w["type_name"]} for w in found]
    tol = lambda x, y: max(x["t"], y["t"]) / 2 + 2  # noqa: E731
    tp_det = sum(1 for d in det if (lambda c: c[0] >= 0.8 * c[1])(_cover(d, lab, tol)))
    tp_lab = sum(1 for l_ in lab if (lambda c: c[0] >= 0.8 * c[1])(_cover(l_, det, tol)))
    # wall type: the found wall covering most of each labeled wall, exterior or interior
    typed = 0
    for l_ in lab:
        best = max(det, key=lambda d: _cover(l_, [d], tol)[0], default=None)
        if best is not None and _cover(l_, [best], tol)[0] >= 0.5 * math.dist(l_["a"], l_["b"]):
            typed += 1 if (best["type"] == "Exterior wall") == (l_["kind"] == "ext") else 0
    len_found = sum(math.dist(d["a"], d["b"]) for d in det) * ipp / 12
    len_lab = sum(math.dist(l_["a"], l_["b"]) for l_ in lab) * ipp / 12
    return {"found": len(det), "labeled": len(lab), "tp_found": tp_det, "tp_labeled": tp_lab, "lf_found": len_found, "lf_labeled": len_lab,
            "typed_right": typed}


def _inside(pt, poly):
    x, y = pt
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def score_rooms(found, labels, check_names=True):
    used = set()
    tp, names_ok, area_err = 0, 0, []
    for r in found:
        for k, lab in enumerate(labels):
            if k in used or not _inside(r["center"], lab["pts"]):
                continue
            if r["area_sq_in"] is None or abs(r["area_sq_in"] - lab["area_sq_in"]) > 0.05 * lab["area_sq_in"]:
                continue
            used.add(k)
            tp += 1
            area_err.append(abs(r["area_sq_in"] - lab["area_sq_in"]) / lab["area_sq_in"])
            if r["name"] == lab["name"] and r["number"] == lab["number"]:
                names_ok += 1
            break
    return {"found": len(found), "labeled": len(labels), "tp_found": tp, "tp_labeled": tp, "named": names_ok if check_names else None,
            "area_err_max": max(area_err) if area_err else None}


def score_points(found, labels, width_key=None):
    used = set()
    tp, width_err, tags_ok, tags_n = 0, [], 0, 0
    for f in found:
        best = None
        for k, lab in enumerate(labels):
            if k in used:
                continue
            tol = max(6.0, 0.25 * lab["width_in"] / f.get("_ipp", 1)) if width_key else 3.0
            d = math.dist(f["at"], lab["at"])
            if d <= tol and (best is None or d < best[0]):
                best = (d, k)
        if best:
            used.add(best[1])
            tp += 1
            lab = labels[best[1]]
            if width_key and f.get("width_in") is not None:
                width_err.append(abs(f["width_in"] - lab["width_in"]))
            if "tag" in lab:
                tags_n += 1
                tags_ok += 1 if f.get("tag", "") == lab["tag"] else 0
    out = {"found": len(found), "labeled": len(labels), "tp_found": tp, "tp_labeled": tp}
    if width_err:
        out["width_err_max_in"] = max(width_err)
    if tags_n:
        out["tags_right"] = tags_ok
        out["tags_checked"] = tags_n
    return out


def score_symbols(found, labels):
    lab = [(kind, p) for kind, pts in labels.items() for p in pts]
    used = set()
    tp, kind_ok, n = 0, 0, 0
    for g in found:
        for p in g["at"]:
            n += 1
            best = None
            for k, (kind, q) in enumerate(lab):
                if k in used:
                    continue
                d = math.dist(p, q)
                if d <= 3.0 and (best is None or d < best[0]):
                    best = (d, k)
            if best:
                used.add(best[1])
                tp += 1
                kind_ok += 1 if g["name"] == lab[best[1]][0] else 0
    return {"found": n, "labeled": len(lab), "tp_found": tp, "tp_labeled": tp, "kind_right": kind_ok}


def pr(s):
    p = s["tp_found"] / s["found"] if s["found"] else (1.0 if not s["labeled"] else 0.0)
    r = s["tp_labeled"] / s["labeled"] if s["labeled"] else 1.0
    return p, r


def same(a, b, path="result"):
    """The two cores' results agree (numbers to 1e-9 relative)."""
    if isinstance(b, float) or isinstance(a, float):
        if not (isinstance(a, (int, float)) and isinstance(b, (int, float))) or abs(a - b) > 1e-9 * max(1.0, abs(b)):
            return f"{path}: {a} != {b}"
        return None
    if isinstance(b, dict):
        if not isinstance(a, dict) or sorted(a) != sorted(b):
            return f"{path}: keys differ"
        for k in b:
            e = same(a[k], b[k], f"{path}.{k}")
            if e:
                return e
        return None
    if isinstance(b, (list, tuple)):
        if not isinstance(a, (list, tuple)) or len(a) != len(b):
            return f"{path}: lengths differ"
        for i, (x, y) in enumerate(zip(a, b)):
            e = same(x, y, f"{path}[{i}]")
            if e:
                return e
        return None
    return None if a == b else f"{path}: {a!r} != {b!r}"


# ---------------------------------------------------------------- run


def evaluate(corpus=None):
    base, files = entries(corpus)
    work = Path(tempfile.mkdtemp(prefix="eval-"))
    rows = []
    scan_diff = None
    for f in files:
        if f["kind"] == "autotakeoff":
            node("vector", base / f["file"], work / "in.json")
            pages = json.loads((work / "in.json").read_text())["pages"]
            sheets = f["sheets"]
            for s in sheets:
                pages[s["page"]]["in_per_pt"] = s["in_per_pt"]
            inputs = [pages[s["page"]] for s in sheets]
            opts = [{} for _ in sheets]
        else:
            s = f["sheets"][0]
            wp, hp = f["pixels"]
            k = 72 / s["scan"]["dpi"]
            sw, sh = wp * k, hp * k
            node("scan", base / f["raw"], wp, hp, k, sw, sh, s["in_per_pt"], work / "in.json")
            pages = json.loads((work / "in.json").read_text())["pages"]
            pages[0]["in_per_pt"] = s["in_per_pt"]
            sheets, inputs = f["sheets"], pages
            opts = [{"bridge_in": 48}]
            # the door search on the scan's mask: the Python core must find the same swings
            dj = json.loads((work / "in.json.doors.json").read_text())
            py_doors = at.scan_door_arcs((work / "in.json.mask").read_bytes(), dj["w"], dj["h"], dj["segs"], dj["opts"])
            scan_diff = same(json.loads(json.dumps(py_doors)), dj["result"], "scan_door_arcs")
        (work / "pages.json").write_text(json.dumps({"pages": inputs, "opts": opts}))
        node("takeoff", work / "pages.json", work / "out.json")
        js = json.loads((work / "out.json").read_text())["results"]
        for s, page, res, opt in zip(sheets, inputs, js, opts):
            py = at.auto_takeoff(page, opt)
            diff = same(json.loads(json.dumps(py)), res) or (scan_diff if s["scan"] else None)
            lab, ipp = s["labels"], s["in_per_pt"]
            for d in res["doors"]:
                d["_ipp"] = ipp
            row = {"sheet": s["name"], "file": f["file"], "page": s["page"], "rotate": s["rotate"], "scan": bool(s["scan"]), "parity": diff or "same",
                   "walls": score_walls(res["walls"], lab["walls"], ipp), "rooms": score_rooms(res["rooms"], lab["rooms"], not s["scan"]),
                   "windows": score_points(res["windows"], lab["windows"], "width_in")}
            row["doors"] = score_points(res["doors"], lab["doors"], "width_in")
            if s["scan"]:
                row["doors_by_example"] = template_score(base / f["raw"], f["pixels"], 72 / s["scan"]["dpi"], lab["doors"], ipp, work, "width_in")
                row["symbols"] = template_score(base / f["raw"], f["pixels"], 72 / s["scan"]["dpi"], [{"at": p} for p in lab["symbols"]["DUPLEX RECEPTACLE"]], ipp, work, None)
            else:
                row["symbols"] = score_symbols(res["symbols"], lab["symbols"])
            rows.append(row)
    return rows


def template_score(raw, pixels, k, labels, ipp, work, width_key):
    """Pick the first labeled copy as the example (a box around it) and find the rest."""
    if width_key:  # a box around the first single door's leaf and swing, as a person would draw it
        lab0 = next(lab for lab in labels if lab.get("leaves", 1) == 1)
        b = lab0["box"]
        box = [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3]
    else:
        first = labels[0]["at"]
        box = [first[0] - 7, first[1] - 7, first[0] + 7, first[1] + 7]
    node("template", raw, pixels[0], pixels[1], k, *[round(v, 2) for v in box], work / "hits.json")
    hits = json.loads((work / "hits.json").read_text())["hits"]
    found = [{"at": [h[0], h[1]]} for h in hits]
    # a hit is the center of the box it matched; a door's label point is its opening's center
    labs = [{"at": [(lab["box"][0] + lab["box"][2]) / 2, (lab["box"][1] + lab["box"][3]) / 2] if width_key else lab["at"],
             "width_in": lab.get("width_in", 0)} for lab in labels]
    used = set()
    tp = 0
    for fd in found:
        best = None
        for j, lab in enumerate(labs):
            if j in used:
                continue
            tol = max(6.0, 0.25 * lab["width_in"] / ipp) if width_key else 4.0
            d = math.dist(fd["at"], lab["at"])
            if d <= tol and (best is None or d < best[0]):
                best = (d, j)
        if best:
            used.add(best[1])
            tp += 1
    return {"found": len(found), "labeled": len(labs), "tp_found": tp, "tp_labeled": tp, "method": "example search"}


def sweep():
    """Door swings on scans of every labeled plan at three resolutions and skews: each plan painted as
    a scan (tests/plan_sheets.py), through the app's line and door detection, doors scored as above."""
    import plan_sheets as ps
    work = Path(tempfile.mkdtemp(prefix="sweep-"))
    out, tot = [], {"found": 0, "labeled": 0, "tp_found": 0, "tp_labeled": 0}
    for lay in (ps.HOUSE, ps.OFFICE, ps.CLINIC, ps.HARD):
        for dpi, skew in ((150, -1.1), (200, 0.6), (300, 0.0)):
            plan = ps.Plan(lay)
            gray, wp, hp = ps.scan_gray(plan, dpi, skew)
            (work / "s.gray").write_bytes(gray)
            k = 72 / dpi
            node("scan", work / "s.gray", wp, hp, k, wp * k, hp * k, plan.ipp, work / "in.json")
            page = json.loads((work / "in.json").read_text())["pages"][0]
            page["in_per_pt"] = plan.ipp
            (work / "pages.json").write_text(json.dumps({"pages": [page], "opts": [{"bridge_in": 48}]}))
            node("takeoff", work / "pages.json", work / "out.json")
            res = json.loads((work / "out.json").read_text())["results"][0]
            for d in res["doors"]:
                d["_ipp"] = plan.ipp
            sc = score_points(res["doors"], ps.sheet_labels(plan, 0, skew)["doors"], "width_in")
            for key in tot:
                tot[key] += sc[key]
            p_, r_ = pr(sc)
            out.append(f"{lay['name']:<10} {dpi} dpi, turned {skew:+.1f} deg: doors {sc['tp_found']} of {sc['labeled']} found, {sc['found'] - sc['tp_found']} wrong (P {p_:.0%} R {r_:.0%})")
    p_, r_ = pr(tot)
    out.append(f"all scans: P {p_:.0%} R {r_:.0%} ({tot['tp_labeled']} of {tot['labeled']} doors, {tot['found'] - tot['tp_found']} wrong)")
    return "\n".join(out)


def table(rows):
    classes = ["walls", "rooms", "doors", "windows", "symbols"]
    out = []
    head = f"{'sheet':<16}" + "".join(f"{c:>18}" for c in classes) + "  parity"
    out.append(head)
    tot = {c: {"found": 0, "labeled": 0, "tp_found": 0, "tp_labeled": 0} for c in classes}
    tot_scan = {c: {"found": 0, "labeled": 0, "tp_found": 0, "tp_labeled": 0} for c in classes}
    for r in rows:
        cells = []
        for c in classes:
            s = r[c]
            p, rc = pr(s)
            cells.append(f"P {p:4.0%} R {rc:4.0%}".rjust(18))
            t = tot_scan if r["scan"] else tot
            for k in t[c]:
                t[c][k] += s[k]
        out.append(f"{r['sheet'] + (' r' + str(r['rotate']) if r['rotate'] else ''):<16}" + "".join(cells) + "  " + ("same" if r["parity"] == "same" else "DIFF"))
    for name, t in (("vector total", tot), ("scan total", tot_scan)):
        if not any(t[c]["labeled"] for c in classes):
            continue
        cells = []
        for c in classes:
            p, rc = pr(t[c])
            cells.append(f"P {p:4.0%} R {rc:4.0%}".rjust(18))
        out.append(f"{name:<16}" + "".join(cells))
    return "\n".join(out), tot, tot_scan


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--corpus", default=str(ROOT / "corpus"))
    ap.add_argument("--json")
    ap.add_argument("--sweep", action="store_true", help="also read door swings on scans of every plan at 150, 200 and 300 dpi")
    a = ap.parse_args()
    rows = evaluate(a.corpus)
    text, tot, tot_scan = table(rows)
    print(text)
    for r in rows:
        extra = []
        w = r["walls"]
        extra.append(f"wall length {w['lf_found']:.1f} of {w['lf_labeled']:.1f} LF; wall type right {w['typed_right']} of {w['labeled']}")
        if r["rooms"].get("named") is not None:
            extra.append(f"rooms named right {r['rooms']['named']} of {r['rooms']['tp_found']}")
        if r["rooms"].get("area_err_max") is not None:
            extra.append(f"room area error up to {r['rooms']['area_err_max']:.2%}")
        if "doors_by_example" in r:
            p_, r_ = pr(r["doors_by_example"])
            extra.append(f"doors by example (one boxed door) P {p_:.0%} R {r_:.0%}")
        if "width_err_max_in" in r["doors"]:
            extra.append(f"door width error up to {r['doors']['width_err_max_in']:.2f} in")
        if "tags_checked" in r["doors"]:
            extra.append(f"door tags right {r['doors']['tags_right']} of {r['doors']['tags_checked']}")
        if "kind_right" in r["symbols"]:
            extra.append(f"symbol kinds right {r['symbols']['kind_right']} of {r['symbols']['tp_found']}")
        print(f"  {r['sheet']}: " + "; ".join(extra))
    if a.sweep:
        print(sweep())
    if a.json:
        Path(a.json).write_text(json.dumps({"rows": rows, "vector": tot, "scan": tot_scan}, indent=1))
    bad = [r for r in rows if r["parity"] != "same"]
    if bad:
        for r in bad:
            print("parity:", r["sheet"], r["parity"])
        raise SystemExit(1)


if __name__ == "__main__":
    main()
