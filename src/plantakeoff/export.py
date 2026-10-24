"""CSV export of the markup list and the estimate (RFC 4180, CRLF line ends).

Formula guard: a text cell that starts with = + - @ tab or carriage return gets a leading
apostrophe, so a spreadsheet shows the text instead of running it as a formula. Numbers that
this code formats itself are written plainly.
"""

from __future__ import annotations

import math

from .markups import group_totals

GUARD = ("=", "+", "-", "@", "\t", "\r")


def text_cell(v) -> str:
    s = "" if v is None else str(v)
    if s.startswith(GUARD):
        s = "'" + s
    if any(c in s for c in ',"\r\n') or s != s.strip(" "):
        s = '"' + s.replace('"', '""') + '"'
    return s


def num_cell(x, places: int = 6) -> str:
    """A number with up to `places` decimals, half away from zero, trailing zeros removed."""
    if x is None:
        return ""
    x = float(x)
    if not math.isfinite(x):
        return ""
    scale = 10 ** places
    n = int(math.floor(abs(x) * scale + 0.5))
    whole, frac = divmod(n, scale)
    s = str(whole)
    if frac:
        s += "." + str(frac).rjust(places, "0").rstrip("0")
    return ("-" if x < 0 and n else "") + s


def money_cell(cents: int) -> str:
    neg = cents < 0
    whole, frac = divmod(abs(int(cents)), 100)
    return ("-" if neg else "") + f"{whole}.{frac:02d}"


def markup_list_csv(rows, columns=(), group_by: str = "") -> str:
    head = ["Page", "Sheet", "Type", "Subject", "Label", "Layer", "Author", "Status", "Date", "Measurement",
            "Quantity", "Unit", "Warnings"] + [c["name"] for c in columns]
    lines = [",".join(text_cell(h) for h in head)]
    for r in rows:
        cells = [str(r["page"]), text_cell(r["sheet"]), text_cell(r["type"]), text_cell(r["subject"]),
                 text_cell(r["label"]), text_cell(r["layer"]), text_cell(r["author"]), text_cell(r["status"]),
                 text_cell(r["date"]), text_cell(r["measurement"]), num_cell(r["quantity"]), text_cell(r["unit"]),
                 text_cell(r["warnings"])]
        cells += [text_cell(r["custom"].get(c["id"], "")) for c in columns]
        lines.append(",".join(cells))
    if group_by:
        lines.append("")
        lines.append(",".join(text_cell(h) for h in ("Totals by " + group_by, "Rows", "Quantity", "Unit")))
        for g in group_totals(rows, group_by):
            name = g["group"] or "(none)"
            if not g["totals"]:
                lines.append(",".join([text_cell(name), str(g["rows"]), "", ""]))
            for t in g["totals"]:
                lines.append(",".join([text_cell(name), str(g["rows"]), num_cell(t["quantity"]), text_cell(t["unit"])]))
    return "\r\n".join(lines) + "\r\n"


def estimate_csv(est) -> str:
    head = ["Assembly", "Component", "Source", "Base quantity", "Raw quantity", "With waste", "Order quantity",
            "Unit", "Unit cost", "Cost"]
    lines = [",".join(text_cell(h) for h in head)]
    for line in est["lines"]:
        for c in line["components"]:
            lines.append(",".join([
                text_cell(line["name"]), text_cell(c["name"]), text_cell(c["source"]), num_cell(c["base"], 4),
                num_cell(c["raw"], 4), num_cell(c["with_waste"], 4), num_cell(c["order"], 4), text_cell(c["unit"]),
                money_cell(c["unit_cost_cents"]), money_cell(c["cost_cents"])]))
        lines.append(",".join([text_cell(line["name"]), text_cell("Assembly total"), "", "", "", "", "", "", "",
                               money_cell(line["cost_cents"])]))
    for label, key in (("Subtotal", "subtotal_cents"), ("Markup", "markup_cents"), ("Tax", "tax_cents"),
                       ("Total", "total_cents")):
        lines.append(",".join([text_cell(label), "", "", "", "", "", "", "", "", money_cell(est[key])]))
    return "\r\n".join(lines) + "\r\n"
