# File formats

Everything Scaleline saves is JSON in UTF-8 with a `format` name and an integer `version`. Readers
rebuild every file field by field: unknown keys are dropped, bad entries are skipped and counted,
and the rest of the file still loads. The rules below are the ones `src/plantakeoff/markups.py` and
`web/src/core/06_markups.js` enforce (the two are kept equal by the parity tests).

Common rules:

- **Ids** are 1 to 64 characters from letters, digits and `_ . : -`, and never `__proto__`,
  `constructor` or `prototype`.
- **Text** is trimmed to its cap (200 characters for short fields unless noted); control and
  bidirectional-override characters are removed.
- **Coordinates** are PDF points (1/72 in of paper) on the sheet as shown: origin at the top left,
  y down, the page's own `/Rotate` applied. They are finite and within 10,000,000.
- **Colors** are `#rrggbb`.
- **Money** is whole cents (integers). **Dates** are UTC text, `YYYY-MM-DDTHH:MM:SSZ`.

## Markup file

`*.markups.json`, format `field-tools-takeoff-markups`, version 1. One takeoff of one PDF.

```json
{
  "format": "field-tools-takeoff-markups",
  "version": 1,
  "document": { "name": "plans.pdf", "sha256": "64 hex characters of the PDF" },
  "settings": { "length_unit": "ftin", "area_unit": "sf", "volume_unit": "cy", "places": 2, "denominator": 16,
                "author": "Ana", "markup_pct": 10, "tax_pct": 8.25, "overhead_pct": 5 },
  "pages": {
    "1": { "label": "A-101", "title": "FLOOR PLAN",
           "scale": { "in_per_pt": 0.6667, "label": "1/4\" = 1'-0\"", "source": "titleblock" },
           "viewports": [ { "id": "vp1", "name": "DETAIL 3", "rect": [1300, 200, 1700, 500],
                            "scale": { "in_per_pt": 0.1111, "label": "1 1/2\" = 1'-0\"", "source": "standard" } } ] }
  },
  "layers": [ { "id": "l1", "name": "Drywall", "visible": true, "locked": false, "assembly": "a1" } ],
  "assemblies": [ "see Assemblies below" ],
  "rates": [ { "id": "r1", "name": "Carpenter", "cents_per_hour": 6500 } ],
  "columns": [ { "id": "c1", "name": "Cost code" } ],
  "markups": [ "see Markups below" ],
  "tombstones": [ { "id": "m7", "at": "2026-10-01T10:00:00Z", "by": "Ben", "vers": ["v3", "v9"] } ]
}
```

| Field | Rule |
|---|---|
| `settings.length_unit` | `ftin`, `ft`, `in`, `yd`, `m`, `cm`, `mm` |
| `settings.area_unit` | `sf`, `sy`, `sq_in`, `sm`, `sq_cm`, `sq_mm`, `acre` |
| `settings.volume_unit` | `cy`, `cf`, `cu_in`, `cu_m`, `l`, `gal` |
| `settings.places`, `denominator` | 0 to 6 decimals; fractions of 1, 2, 4, 8, 16, 32 or 64 |
| `settings.markup_pct`, `overhead_pct` | 0 to 1000; `tax_pct` 0 to 100 |
| `pages` | keyed by the page index from 0 (as text), at most 20,000 |
| `scale.in_per_pt` | real inches per PDF point, 1e-6 to 1e7; `source` is `standard`, `calibrated`, `titleblock`, `copied` or `imported` |
| `viewports` | at most 50 per page; `rect` is `[x0, y0, x1, y1]`; a markup measures at the scale of the viewport it names |
| `layers` | at most 500 |
| `columns` | custom columns for the markups list, at most 50 |
| `tombstones` | markups deleted on this copy, kept so a merge does not bring them back |

### Markups

At most 100,000 per file.

```json
{ "id": "m1", "type": "area", "page": 1, "points": [[100, 100], [820, 100], [820, 640], [100, 640]],
  "holes": [[[400, 300], [472, 300], [472, 408], [400, 408]]],
  "subject": "Floor", "label": "Level 1", "layer": "l1", "assembly": "a1", "assembly_source": "layer",
  "color": "#006f4f", "fill": "#006f4f", "opacity": 0.3, "width": 1.5, "depth": 4, "height": 9, "pitch": 6,
  "status": "Review", "author": "Ana", "created": "2026-10-01T10:00:00Z", "modified": "2026-10-02T08:12:00Z",
  "modified_by": "Ben", "assignee": "Ben", "rev": 3, "vers": ["v1a", "v2b", "v3c"],
  "status_log": [ { "status": "Review", "by": "Ben", "at": "2026-10-02T08:12:00Z" } ],
  "comments": [ { "id": "c1", "author": "Ana", "at": "2026-10-01T10:05:00Z", "text": "@Ben check the shaft" },
                { "id": "c2", "author": "Ben", "at": "2026-10-02T08:10:00Z", "text": "Done", "reply_to": "c1", "resolved": true } ],
  "custom": { "c1": "09 29 00" }, "viewport": "vp1" }
```

| Field | Rule |
|---|---|
| `type` | measurements: `length`, `polylength`, `area`, `perimeter`, `count`, `volume`, `angle`, `radius`, `diameter`, `quantity`; markups: `cloud`, `callout`, `text`, `arrow`, `line`, `rect`, `ellipse`, `polygon`, `polyline`, `highlight`, `pen`, `stamp` |
| `points` | at least 2 (area, volume, angle, polygon: 3; count, text, stamp, quantity: 1), at most 20,000 |
| `holes` | cutouts of an area or volume, at most 200, each at least 3 points |
| `qty` | only on `quantity` (a row imported from a markup summary): `{ "kind": "length" \| "area" \| "volume" \| "count", "value": number }` in inches, square inches, cubic inches or items |
| `text` | up to 5,000 characters (text, callout, stamp, cloud note) |
| `opacity` 0 to 1, `width` 0 to 100, `font_size` 4 to 400, `depth`, `height` (inches) 0 to 1,000,000, `pitch` 0 to 48 (rise in 12), `rotation` -360 to 360 | |
| `glyph` | count only: `circle`, `square`, `triangle`, `diamond` |
| `assembly_source` | `layer`, `preset` or `manual`: where the assembly came from |
| `rev`, `vers` | the edit counter and the last 32 version ids; merging compares these to tell an edit from a copy |
| `comments` | at most 500, each up to 2,000 characters; a deleted comment keeps its id with empty text |
| `status_log` | the last 200 status changes |
| `custom` | values for the custom columns, by column id, up to 500 characters each |

## Tool chest

Format `field-tools-tool-chest`, version 1. Presets that arm a tool. Kept on the device for every
plan set; exported and imported from the Tool chest panel. Files over 2 MB are refused.

```json
{ "format": "field-tools-tool-chest", "version": 1,
  "presets": [ { "id": "p1", "name": "Slab on grade", "tool": "volume", "subject": "Slab", "layer": "l2",
                 "color": "#3253c6", "fill": "#3253c6", "opacity": 0.25, "width": 1.5, "depth": 4, "assembly": "a3" },
               { "id": "p2", "name": "Duplex outlet", "tool": "count", "subject": "Outlets", "glyph": "circle", "pencil": "m-amber" } ] }
```

`tool` is any drawing tool id (the markup types above). The other keys are the markup fields that a
new markup takes from the preset: `subject`, `layer`, `color`, `pencil` (a named pencil color),
`fill`, `opacity`, `width`, `font_size`, `depth`, `height`, `pitch`, `assembly`, `text`, `glyph`.
Each preset is checked against the markup rules before it is kept.

Tool sets from Bluebeam Revu (`.btx`) import into the same chest: each item's stored annotation is
read (compressed items are inflated) and becomes a preset of the matching type.

## Assemblies

Format `field-tools-takeoff-assemblies`, version 1. The built-in library
(`examples/assemblies-library.json`) and files saved with Estimate, Prices and rates, Save
assemblies to a file. The same assembly objects sit in a markup file's `assemblies`.

```json
{ "format": "field-tools-takeoff-assemblies", "version": 1,
  "rates": [ { "id": "r1", "name": "Drywall finisher", "cents_per_hour": 5800 } ],
  "assemblies": [
    { "id": "a1", "name": "Gypsum board wall, 1/2 in, one side", "division": "09", "code": "09 29 00", "group": "Finishes",
      "tool": "polylength", "why": "Board area is wall length times height; sheets are 4 x 8 ft (32 SF) ...",
      "params": [ { "id": "height_ft", "name": "Wall height when the measurement has none", "value": 9, "unit": "ft" } ],
      "components": [
        { "name": "Gypsum board 1/2 in", "code": "GYP-12", "source": "wall_area", "formula": "either(WSF, LF * height_ft) / 32",
          "factor": 1, "per_each": 0, "waste_pct": 10, "pack": 1, "unit": "SHEET", "unit_cost_cents": 1450,
          "labor_hours": 0.25, "labor_rate": "r1" } ] } ] }
```

| Field | Rule |
|---|---|
| `division`, `code`, `group` | CSI MasterFormat division number, section number and group name (up to 8, 40, 60 characters) |
| `tool` | the measurement the assembly is meant for |
| `why` | how the quantities are figured, up to 1,000 characters |
| `params` | at most 30 named inputs (`id` is a letter or `_` then letters, digits, `_`, up to 32), usable in formulas |
| `components` | at most 100 |
| `source` | `length`, `perimeter`, `area`, `volume`, `wall_area`, `count` or `each` (one per measurement) |
| `source_unit` | the unit the source is taken in (`ft`, `sf`, `cy` ...) |
| `formula` | optional, up to 500 characters; replaces `source x factor + per_each x measurements`. Numbers, `+ - * / ( )`, the totals `LF` (length, ft), `PF` (perimeter, ft), `SF` (area), `WSF` (wall area), `CF`, `CY` (volume), `EA` (count), `N` (measurements), the assembly's `params`, and `ceil floor round abs sqrt min max either(a, b)` (`a` unless it is zero, then `b`). There is no other syntax: no names, calls or assignments beyond these |
| `waste_pct` 0 to 1000, `pack` | the order is `ceil(quantity x (1 + waste / 100) / pack)` when `pack` is above 0 |
| `unit_cost_cents` | material price per order unit |
| `labor_hours`, `labor_rate` | hours per order unit and the id of a rate in `rates` |

The library carries no prices. Prices come from a price list (CSV) matched to components by `code`,
then by name, and nothing changes until the estimator applies them.

## Exports

- **Export all** (Settings): format `field-tools-takeoff-export`, version 1, with `presets` (the
  tool chest) and `takeoffs`, each `{ id, meta, state }` where `state` is a markup file.
- **CSV**: UTF-8 with a byte order mark and CRLF line ends; text cells that start with `= + - @`,
  tab or carriage return are prefixed with an apostrophe.
- **XLSX**: a workbook written by hand (Office Open XML, stored zip): sheets Markups and Estimate,
  values only, no formulas, macros or external links.
- **PDF with annotations**: each markup as a standard annotation (ISO 32000-1, 12.5): Line,
  PolyLine, Polygon, Square, Circle, FreeText, Ink, Highlight or Stamp with an `/IT` intent
  (`LineDimension`, `PolyLineDimension`, `PolygonDimension`, and the intents measurement programs
  use for counts, volumes, angles, radii and diameters), a rectilinear `/Measure` dictionary
  (12.9) on measurements, an appearance stream so any viewer draws it, and `/FTMarkup` holding the
  markup's JSON so this app reads it back exactly. Viewports go out as `/VP` entries.

## Live session messages

Peers exchange JSON messages over WebRTC data channels, protocol version 1 (`hello` carries
`v: 1`). Every inbound message is checked field by field against the same rules as the markup file
(`peer_message` in `web/src/core/21_peer.js`), with a 1.5 MB size cap and a token-bucket rate limit
per peer and kind of message; anything else is dropped. Messages carry markups, comments, cursors,
drafts in progress and presence; the PDF is never sent, and peers compare its SHA-256 instead. Join
codes are `SL1.` followed by base64url text of the deflated offer or answer.
