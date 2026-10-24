"""Command line: read a markup file and print the markup list or the estimate as CSV,
convert a typed length, or read scale notes out of text.

  plantakeoff list markups.json [--group-by subject]
  plantakeoff estimate markups.json
  plantakeoff length "12'-6 1/2\\"" --to m
  plantakeoff scale "SCALE: 1/4\\" = 1'-0\\""
  plantakeoff merge mine.markups.json theirs.markups.json [--conflicts mine|theirs|both] > merged.json
  plantakeoff library > assemblies.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import units
from .errors import TakeoffError
from .export import estimate_csv, markup_list_csv
from .library import library_file
from .merge import merge_documents
from .markups import clean_document, document_estimate, markup_rows
from .scale import nearest_standard, parse_scale_text, ratio_of

MAX_BYTES = 50 * 1024 * 1024


def _load(path: str):
    p = Path(path)
    if not p.is_file():
        raise TakeoffError("file", f"No such file: {path}")
    if p.stat().st_size > MAX_BYTES:
        raise TakeoffError("file", "The markup file is larger than 50 MB")
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise TakeoffError("file", f"The markup file is not valid JSON ({e.__class__.__name__})") from None
    doc, report = clean_document(raw)
    dropped = sum(report.values())
    if dropped:
        print(f"note: skipped {dropped} invalid entries", file=sys.stderr)
    return doc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="plantakeoff", description="Plan takeoff math on markup files.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("list", help="markup list as CSV")
    a.add_argument("file")
    a.add_argument("--group-by", default="")
    b = sub.add_parser("estimate", help="estimate rollup as CSV")
    b.add_argument("file")
    c = sub.add_parser("length", help="convert a typed length")
    c.add_argument("text")
    c.add_argument("--to", default="ftin", choices=["ftin", "ft", "in", "yd", "m", "cm", "mm"])
    c.add_argument("--default-unit", default="ft")
    d = sub.add_parser("scale", help="read scale notes from text")
    d.add_argument("text")
    e = sub.add_parser("merge", help="merge two markup files for the same plan set")
    e.add_argument("mine")
    e.add_argument("theirs")
    e.add_argument("--conflicts", default="mine", choices=["mine", "theirs", "both"],
                   help="how to settle a markup both people changed (default: keep mine)")
    sub.add_parser("library", help="the built-in assemblies library as JSON")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "list":
            doc = _load(args.file)
            sys.stdout.write(markup_list_csv(markup_rows(doc), doc["columns"], args.group_by))
        elif args.cmd == "estimate":
            sys.stdout.write(estimate_csv(document_estimate(_load(args.file))))
        elif args.cmd == "length":
            inches = units.parse_length(args.text, args.default_unit)
            print(units.format_length(inches, args.to, 4))
        elif args.cmd == "merge":
            mine, theirs = _load(args.mine), _load(args.theirs)
            first = merge_documents(mine, theirs)
            choices = {c["id"]: args.conflicts for c in first["conflicts"]}
            r = merge_documents(mine, theirs, choices)
            rep = r["report"]
            print(f"added {rep['added']}, updated {rep['updated']}, removed {rep['removed']}, "
                  f"conflicts {len(first['conflicts'])} settled as {args.conflicts}", file=sys.stderr)
            for c in first["conflicts"]:
                print(f"conflict: {c['id']} ({c['kind']})", file=sys.stderr)
            sys.stdout.write(json.dumps(r["doc"], indent=1) + "\n")
        elif args.cmd == "library":
            sys.stdout.write(json.dumps(library_file(), indent=1) + "\n")
        elif args.cmd == "scale":
            for f in parse_scale_text(args.text):
                if f["in_per_pt"] is None:
                    print(f"{f['text']}: not to scale")
                    continue
                std = nearest_standard(f["in_per_pt"])
                print(f"{f['text']}: 1:{units.format_number(ratio_of(f['in_per_pt']), 2)}"
                      + (f" ({std['label']})" if std else ""))
    except TakeoffError as e:
        print(f"error: {e.message}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
