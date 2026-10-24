"""Merging two people's markup files for the same plan set, with no server.

Every markup carries a stable id and a short version history (``vers``, the last entry is the
current version; each edit adds one). Deleted markups leave a tombstone with the history they had.
That is enough to tell, for each id, whether one side's markup descends from the other's:

* same current version, or identical content: nothing to do;
* their current version is in my history: mine is newer, keep mine;
* my current version is in their history: theirs is newer, take theirs;
* otherwise both changed it since they last shared it: a conflict for the person to review.

A markup only one side has is added, unless the other side deleted it: a deletion of the version
I have (or one after it) removes it; a deletion of an older version, while I kept editing, is a
conflict. Comments merge as a union by comment id on whichever version wins (a deleted comment
stays deleted), and status history merges as a union in time order, so no review note is lost.

Conflicts are settled by choices: "mine", "theirs" or "both" (both keeps mine and adds theirs
under a new id). Until a choice is made a conflicted markup keeps my version. Layers,
assemblies, custom columns and rates merge by id (mine wins on a clash); page entries fill in
what mine lacks. The same function runs in the browser core (parity vectors).
"""

from __future__ import annotations

from .errors import TakeoffError
from .markups import LIMITS

SESSION_KEYS = ("vers", "rev", "modified", "modified_by", "comments", "status_log")


def _cur(m):
    v = m.get("vers") or []
    return v[-1] if v else ""


def _kept_mark(tomb):
    """The version mark a markup carries once its owner kept it against this deletion."""
    v = tomb.get("vers") or []
    return ("kept:" + (v[-1] if v else tomb["id"]))[:64]


def _deleted_covers(m, tomb):
    """A tombstone covers a markup when it deleted that version or a later one."""
    c = _cur(m)
    return (c in tomb["vers"]) if c else not tomb["vers"]


def _eq(a, b):
    """Deep equality where numbers compare by value (1 and 1.0 are the same)."""
    na = isinstance(a, (int, float)) and not isinstance(a, bool)
    nb = isinstance(b, (int, float)) and not isinstance(b, bool)
    if na or nb:
        return na and nb and a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_eq(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_eq(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


def _same(a, b):
    """Two versions of a markup that differ only in session bookkeeping are the same drawing."""
    return _eq({k: v for k, v in a.items() if k not in SESSION_KEYS}, {k: v for k, v in b.items() if k not in SESSION_KEYS})


def merge_comments(a, b):
    """Union by comment id; a comment deleted or resolved on either side stays so. Order: a's
    comments first, then b's new ones, each in their own order."""
    out = []
    idx = {}
    for c in (a or []) + (b or []):
        if c["id"] in idx:
            prev = out[idx[c["id"]]]
            if c.get("deleted") and not prev.get("deleted"):
                prev = dict(prev, deleted=True, text="")
            if c.get("resolved") and not prev.get("resolved"):
                prev = dict(prev, resolved=True)
            out[idx[c["id"]]] = prev
            continue
        idx[c["id"]] = len(out)
        out.append(dict(c))
    return out[:LIMITS["comments"]]


def merge_status_log(a, b):
    seen = set()
    out = []
    for e in (a or []) + (b or []):
        k = (e.get("at", ""), e.get("by", ""), e.get("status", ""))
        if k in seen:
            continue
        seen.add(k)
        out.append(dict(e))
    out.sort(key=lambda e: (e.get("at", ""), e.get("by", ""), e.get("status", "")))
    return out[-LIMITS["status_log"]:]


def _with_threads(win, other):
    """The winning markup with comments and status history from both sides."""
    out = dict(win)
    cm = merge_comments(win.get("comments"), other.get("comments"))
    if cm:
        out["comments"] = cm
    sl = merge_status_log(win.get("status_log"), other.get("status_log"))
    if sl:
        out["status_log"] = sl
    own = list(win.get("vers") or [])
    vers = [v for v in other.get("vers") or [] if v not in own] + own
    if vers:
        out["vers"] = vers[-LIMITS["versions"]:]
    return out


def _vers_union(win, other):
    own = list(win.get("vers") or [])
    return ([v for v in other.get("vers") or [] if v not in own] + own)[-LIMITS["versions"]:]


def _both_id(mid, taken):
    for n in range(2, 1000):
        cand = (mid[:58] + "." + str(n))
        if cand not in taken:
            return cand
    return mid[:50] + ".x" + str(len(taken))


def merge_markups(mine, theirs, mine_tombs=(), theirs_tombs=(), choices=None):
    """Merge two markup lists. Returns {"markups", "tombstones", "conflicts", "report"}.

    Raises TakeoffError("limit") when the result would hold more markups than a file may (nothing is
    merged; reloading would otherwise drop the extra markups).
    conflicts: [{"id", "kind", "mine", "theirs"}] with kind "edited" (both changed it),
    "deleted_by_me" (I deleted a version they kept editing) or "deleted_by_them".
    report counts: added, updated, kept, removed, conflicts, resolved."""
    choices = choices or {}
    mt = {t["id"]: t for t in mine_tombs or []}
    tt = {t["id"]: t for t in theirs_tombs or []}
    by_t = {m["id"]: m for m in theirs}
    out, conflicts = [], []
    report = {"added": 0, "updated": 0, "kept": 0, "removed": 0, "conflicts": 0, "resolved": 0}
    taken = {m["id"] for m in mine} | set(by_t)
    tombs = {t["id"]: t for t in mine_tombs or []}

    def settle(cid, kind, a, b):
        """a is my side (a markup or None when I deleted it), b theirs. Returns markups to keep."""
        ch = choices.get(cid)
        if ch is None:
            conflicts.append({"id": cid, "kind": kind, "mine": a, "theirs": b})
            report["conflicts"] += 1
            return [a] if a is not None else []
        report["resolved"] += 1
        if ch == "theirs":
            if b is None:
                tombs[cid] = tt[cid]
                return []
            tombs.pop(cid, None)
            return [_with_threads(b, a) if a is not None else b]
        if ch == "both" and a is not None and b is not None:
            nid = _both_id(cid, taken)
            taken.add(nid)
            # mine keeps its id and learns their version, so the same file does not ask again
            return [dict(a, vers=_vers_union(a, b)), dict(b, id=nid)]
        if a is None:
            # I deleted it and keep it deleted: the tombstone covers their version from now on
            t = dict(tombs[cid])
            t["vers"] = [v for v in t.get("vers") or [] if v not in (b.get("vers") or [])] + list(b.get("vers") or [])
            t["vers"] = t["vers"][-LIMITS["versions"]:]
            tombs[cid] = t
            return []
        if b is None:
            # I keep mine against their deletion: mine records it, so the same file does not ask again
            mark = _kept_mark(tt[cid])
            v = [x for x in a.get("vers") or [] if x != mark]
            return [dict(a, vers=(v[:-1] + [mark] + v[-1:])[-LIMITS["versions"]:] if v else [mark])]
        return [_with_threads(a, b)]

    for a in mine:
        b = by_t.get(a["id"])
        if b is None:
            t = tt.get(a["id"])
            if t is None:
                out.append(a)
                report["kept"] += 1
            elif _deleted_covers(a, t):
                tombs[a["id"]] = t
                report["removed"] += 1
            elif _kept_mark(t) in (a.get("vers") or []):
                out.append(a)
                report["kept"] += 1
            else:
                out.extend(settle(a["id"], "deleted_by_them", a, None))
            continue
        ca, cb = _cur(a), _cur(b)
        if (ca and ca == cb) or _same(a, b):
            out.append(_with_threads(a, b))
            report["kept"] += 1
        elif cb and cb in (a.get("vers") or []):
            out.append(_with_threads(a, b))
            report["kept"] += 1
        elif ca and ca in (b.get("vers") or []):
            out.append(_with_threads(b, a))
            report["updated"] += 1
        else:
            out.extend(settle(a["id"], "edited", a, b))
    mine_ids = {m["id"] for m in mine}
    for b in theirs:
        if b["id"] in mine_ids:
            continue
        t = mt.get(b["id"])
        if t is None:
            out.append(b)
            report["added"] += 1
        elif _deleted_covers(b, t):
            continue
        else:
            out.extend(settle(b["id"], "deleted_by_me", None, b))
    for tid, t in tt.items():
        if tid not in tombs and tid not in {m["id"] for m in out} and tid not in mine_ids:
            tombs[tid] = t
    if len(out) > LIMITS["markups"]:
        raise TakeoffError("limit", f"Merging would make {len(out):,} markups; the limit is {LIMITS['markups']:,}. Nothing was merged. "
                           "Split the set into parts or archive finished markups first.")
    kept_ids = {m["id"] for m in out}
    tomb_list = [t for i, t in tombs.items() if i not in kept_ids]
    return {"markups": out, "tombstones": tomb_list, "conflicts": conflicts, "report": report}


def _union(a, b):
    ids = {x["id"] for x in a}
    return list(a) + [x for x in b if x["id"] not in ids]


def merge_documents(mine, theirs, choices=None):
    """Merge two cleaned markup documents (see markups.clean_document)."""
    r = merge_markups(mine["markups"], theirs["markups"], mine.get("tombstones", []), theirs.get("tombstones", []), choices)
    doc = dict(mine)
    doc["markups"] = r["markups"]
    if r["tombstones"]:
        doc["tombstones"] = r["tombstones"]
    else:
        doc.pop("tombstones", None)
    doc["layers"] = _union(mine["layers"], theirs["layers"])
    doc["assemblies"] = _union(mine["assemblies"], theirs["assemblies"])
    doc["columns"] = _union(mine["columns"], theirs["columns"])
    rates = _union(mine.get("rates", []), theirs.get("rates", []))
    if rates:
        doc["rates"] = rates
    pages = {k: dict(v) for k, v in mine["pages"].items()}
    for k, e in theirs["pages"].items():
        if k not in pages:
            pages[k] = dict(e)
            continue
        p = pages[k]
        for key in ("scale", "label", "title"):
            if key not in p and key in e:
                p[key] = e[key]
        if e.get("viewports"):
            p["viewports"] = _union(p.get("viewports", []), e["viewports"])[:LIMITS["viewports"]]
    doc["pages"] = pages
    return {"doc": doc, "conflicts": r["conflicts"], "report": r["report"]}
