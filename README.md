# Scaleline

Field Tools No. 16. Free, open-source plan takeoff and markup for estimators, subcontractors, GCs and owner-builders. Open a PDF plan set, set the scale, measure lengths, areas, counts and volumes, mark up the sheets, roll the quantities into an estimate and export it. Everything runs in your browser; plan files and markups stay on your device.

Live tool: https://wjwhitmire.github.io/scaleline/

The product name lives in one constant (`src/plantakeoff/brand.py`, mirrored in `web/src/core/00_brand.js` and checked by a test). The markup file keeps its original format id, so files saved under the working name still open.

## What it does

- **Plan sets.** Opens local PDFs of any size up to 500 MB and 5,000 sheets. Sheets draw in a background worker; the view shows the sheet's thumbnail at once, then the whole sheet, then sharp tiles for the part on screen as you zoom. Thumbnails and the markups list are virtual lists, so a 300-sheet set with 100,000 markups pans at 60 frames per second (see Performance). Sheet index with sheet numbers, titles and scales. Text search across every sheet with hits highlighted.
- **Scale.** Per sheet: pick a standard architectural (1/32" to 12" = 1'-0"), engineering (1" = 5' to 1000', including 300', 400', 600' and 1000' for site and civil sheets) or metric (1:1 to 1:5000) scale, or calibrate by clicking two points and typing the known length. **Viewports** give a detail or an enlarged plan its own scale; measurements that start inside one use it. Feet and inches, decimal feet, inches, yards, meters, centimeters or millimeters, with fractions to 1/64".
- **Measure.** Length, polylength, area with cutouts, perimeter, count, volume (area times depth), angle, radius, diameter. Wall area from a length or perimeter and a height. Pitched roof area. Snap to drawing line work (and to lines and crossings found in scans), to markups and to a grid; Shift locks to 45 degrees; type a length while drawing to place the next point exactly (sketch to scale).
- **Scanned drawings.** Text recognition on the device (behind the OCR switch): each sheet is cleaned up (contrast, straightened, specks removed) and read, and its words feed search, the title block reader and the sheet index. Symbol search is tuned for scans.
- **Mark up.** Cloud, callout, text box, arrow, line, rectangle, ellipse, polygon, polyline, pen, highlight, stamp. Colors, fill, opacity, line width, font size, status (with its history), author, assignee, subject, label and custom columns. Snapshot (G) copies an area as a picture.
- **Team review.** Comments and replies on each markup with @names, resolve, and an Assigned to me filter. Merge markups from a teammate's file with a review of every conflict (keep mine, theirs or both). Shared folder sync: pick a folder (OneDrive, Dropbox, a network drive) and teammates' markups merge in when you open the set and every 30 seconds. **Live session**: work on the same set at the same time, peer to peer, with live cursors and names, markups as they are drawn, presence and a host lock; the PDF never leaves your device.
- **Layers.** Show, hide, lock, rename, an active layer for new markups, and a default assembly per layer.
- **Markups list.** Every markup with page, sheet, type, subject, label, layer, author, status, assignee, comments, date and measurement; custom columns; group, sort and filter; totals by group and by unit (angles are listed, never added up); status set from the list.
- **Estimate.** Assemblies of components rounded up to whole purchase units, with material and labor (hours per unit at a trade's rate), overhead, markup and tax. Formulas with named inputs (`either(WSF, LF * height_ft) / 32`) when a factor is not enough. A **library of 191 assemblies** by CSI MasterFormat division, with waste factors and a note on how each is figured, and no prices: import your price list (CSV, any column names) and review what it changes before applying it.
- **Tool chest.** Saved presets that arm a tool with its subject, layer, style, depth or height, pitch and assembly. Kept on the device for every plan set; export and import, including Revu tool sets (`.btx`).
- **Compare revisions.** Overlay an old and a new sheet with the differences in color, outline the changed areas, cloud them, and carry every markup to the new set.
- **Exchange.** Export the markups list and the estimate as CSV or XLSX, a markup summary report and an estimate report as PDF, a flattened PDF, the markup file, or a PDF with every markup as a standard annotation with its measurement scale. Import markups and viewports from a PDF's annotations (including measurements made in other programs, which keep their scale), and Revu markup summaries (CSV or XML). The JSON formats are documented in FORMAT.md.
- **Help.** A help panel (F1) with the shortcut sheet, a page for people coming from Revu, the file formats and what touches the network, and a guided tour.
- **Undo and redo** for every change, with the action named in the Edit menu. **Autosave** to the device as you work. **Export all** saved takeoffs and the tool chest as one JSON file; **Delete all data** in Settings removes everything, the open plan set included.
- **Tablet and pen.** Pinch to zoom and two-finger pan; with a pen, the pen draws and a finger pans.

### Automatic, visible and undoable

Each automatic step shows what it found and why, nothing lands in the takeoff until you accept it (or turn on a rule for it), and every accepted result is one undo.

| Step | What happens |
|---|---|
| Scale from the title block | Opening a sheet without a scale reads its text for a scale note (`SCALE: 1/4" = 1'-0"`, `1" = 20'`, `1:100`, `NTS`) and offers it in the status bar with Apply and Why. The reason names the note, whether it is labeled SCALE, whether it sits in the title block, whether the sheet holds more than one scale, and warns when the page is 11 x 17 or smaller (a reduced set prints the wrong scale). A rule in Settings applies it automatically. |
| Sheet index from title blocks | Read title blocks finds each sheet's number and title and proposes the whole index in a table with the reason for every row; Use these applies it, and can set scales on sheets that have none. |
| Count symbols | Find symbol and count: drag a box around one symbol. Every copy on the sheet is found, including turned and mirrored ones, listed with a match score and outlined on the sheet. Search all sheets extends it to the set. Uncheck or move the threshold, then Add counts. |
| Room area by clicking inside | Area by click traces the enclosed space under the click, with columns and shafts as cutouts, and puts each edge on its wall: the inside face (net floor area, the default), the wall centerline or the outside face, chosen on its card and remembered. If the space leaks through a door opening it closes small gaps step by step and says how far it went. |
| Compare and carry forward | The new revision is paired by sheet number, aligned (the shift is reported), and every markup is copied onto it. Markups that touch a changed area get status Review. A report lists each sheet pairing and anything not carried. Markups already saved for the new revision stay, and Ctrl+Z removes the carried ones in one step. |
| Text on scanned sheets | Recognize text (Automate menu, behind the OCR switch) lists the sheets without a text layer; it reads the ones you pick and shows the words, confidence, straightening and the sheet number and scale it found before you click Use text. |
| Markups in a PDF | A PDF that carries markups of its own says so when it opens. Import markups from this PDF lists what it found by type, which pages have a measurement scale, and the viewports, before anything is added. |
| Prices from a price list | Import a price list (CSV) guesses which column is which from the header and the cells under it, lets you change it, then lists each component it matched, by code or by name, with the old and new price; mismatched units start unchecked. Labor stays labor: hours per unit go to labor, and a labor price per unit becomes hours at the component's labor rate. |
| Assemblies by layer or preset | A new measurement drawn with a tool chest preset gets the preset's assembly; otherwise it gets its layer's assembly. Properties says which and why; Ctrl+Z removes the measurement. |
| Auto-takeoff | One click (Shift+Alt+T) reads the sheet's line work and lists every wall, room, door, window and repeated symbol it found, each with a confidence and the reason, outlined on the sheet. Kinds and a minimum confidence filter the list; wall types come from rules you edit, each mapped to a tool chest preset. Add puts the chosen ones in as lengths, areas and counts in one undoable step, with the title block's scale on a sheet that has none (the card shows it first). Every sheet does the whole set. |
| Plan review | Fixed rule checks over the set, each finding with its sheet, place and evidence, a draft RFI, and a click to drop it on the sheet as an RFI callout. |
| Project manual check | The specification's sections against the takeoff, both ways, every row with the text it came from. |

### Familiar layout and keys

Menu bar, tool bar, pages and sheets on the left, properties, tool chest, layers and measurements on the right, the markups list along the bottom, page navigation, zoom, snap toggles and the scale in the status bar. Keys:

| Action | Keys |
|---|---|
| Select, pan, zoom | V, Shift+V, Z |
| Text box, callout, cloud, arrow, line | T (or W), Q, C, A, L |
| Rectangle, ellipse, polygon, polyline, pen, highlight | R, E, Shift+P, Shift+N (or N), P, H |
| Length, polylength, area, perimeter | Shift+Alt+L, Shift+Alt+Q, Shift+Alt+A, Shift+Alt+P |
| Volume, count, angle, radius, diameter | Shift+Alt+V, Shift+Alt+C, Shift+Alt+G, Shift+Alt+U, Shift+Alt+D |
| Snapshot (copy an area as a picture), viewport | G, Shift+Alt+W |
| Calibrate, area by click, find symbol, cutout | Shift+Alt+K, Shift+Alt+F (or J), Shift+Alt+S, Shift+Alt+X |
| Auto-takeoff this sheet | Shift+Alt+T |
| Area, polylength, length, count (number keys) | 1, 2, 3, 4 |
| Finish, remove last point, cancel | Enter or double click, Backspace, Esc |
| Zoom in, out, fit page, fit width, actual size | + or Ctrl+=, - or Ctrl+-, Ctrl+9, Ctrl+0, Ctrl+8 |
| Rotate the view clockwise, counterclockwise | Ctrl+Shift+Plus, Ctrl+Shift+Minus |
| Previous and next page, first and last | Ctrl+Left, Ctrl+Right (or Page Up, Page Down), Home, End |
| Markups list, tool chest, layers, properties, measurements, thumbnails | Alt+L, Alt+X, Alt+Y, Alt+P, Alt+U, Alt+T |
| Snap to markups, content, grid | Ctrl+Shift+F7, F8, F9 (grid also Shift+F9) |
| Undo, redo, copy, paste, delete, select all | Ctrl+Z, Ctrl+Y, Ctrl+C, Ctrl+V, Delete, Ctrl+A |
| Next and previous markup, nudge | Tab, Shift+Tab, arrow keys (Shift for 10 pt) |
| Pan while any tool is active | Hold Space and drag, or drag with the middle button |

Help (F1) lists them all in the app, with a page for people coming from Revu.

## Auto-takeoff, plan review and plan questions

Everything here except asking questions works with no model and no download.

- **Auto-takeoff** (Automate menu, Shift+Alt+T) finds walls, rooms, doors, windows and repeated symbols on a sheet or the whole set, from the sheet's own line work: walls are pairs of parallel lines a wall thickness apart; rooms are the closed spaces between wall centerlines, named and numbered from the text inside them, with the clear area inside the walls; doors are an arc with a leaf line from its center (pairs of doors too); windows are a line between two wall faces closed by jamb lines; symbols are the same small shape three or more times in any quarter turn or mirror, named from a legend when one sits beside a copy outside the rooms (that copy is not counted). Wall types come from thickness, line weight, hatch, fill and whether the wall is on the outline, through rules you edit, each mapped to a tool chest preset. On a scanned sheet the walls and rooms come from lines found in the picture, and doors from the swing arcs found in it: at each opening in a wall's face line, the ink around each jamb votes for a quarter circle from the far jamb (a circular Hough search held to door radii), and a door needs both the arc and a straight leaf from the hinge to the arc's end. When no sheet scale is set and the title block has a scale note, Add sets that scale on the sheet in the same undo step and the card says so; with no note the markups are added without a scale.
- **Plan review** (Automate menu) runs rule checks over the set: duplicate sheet numbers, the drawing index against the title blocks, doors with no tag (a tag can be letters and digits, or digits alone in a tag circle beside the door; a sheet that tags none of its doors gives one finding, not one per door), rooms on the plans against the room or finish schedule (both ways), dimension strings that do not add up, dimensions that do not match the drawing at the sheet's scale (several that agree on one ratio are reported as a scale problem), title block scales that differ from the scale set on the sheet, several scale notes on a sheet without viewports, and changes between revisions (from Compare) with no revision cloud. Each finding shows its evidence and place, and most carry a draft RFI that one click places on the sheet as a callout. With a model switch on, the model writes a short summary and suggests RFIs, each citing the findings it rests on.
- **Project manual check** (Automate menu) reads a specification PDF or text file on the device into its CSI sections and matches them with the takeoff both ways: sections with nothing measured, measured items whose section the manual lacks (or whose division it has but not the section), and items the word list cannot place. Divisions 00 and 01 are listed as general requirements. Every row shows the text it came from. With a model switch on, the model is asked only about the unplaced items and may answer only with a section the manual has. An invented example manual is built in.
- **Ask about these plans** (Automate menu) answers questions from the takeoff (markups, quantities, the sheet index, title blocks, room names, the drawings' text, the estimate and any review findings). The model reads only that data and calls tools that run the takeoff's own math; every number in the answer must match one the tools returned for that question (never digits in the drawings' text), and any other number is marked [?]. Every request to a provider, including each round of tool results, is shown and waits for your Send. Answers cite markups and sheets, and a click on a citation shows it. The model can propose markups, a status or a list filter; nothing changes until you click it, and each click is one undo. Text in the drawings and documents is data, never instructions.

### Models

Two switches in Settings, both off by default:

- **AI on this device** downloads a small open model once (Qwen2.5 1.5B Instruct, 4-bit, about 0.9 GB, needs about 1.6 GB of graphics memory) with WebLLM 0.2.84 on WebGPU. The library is pinned by version and SHA-384, the model library by commit and SHA-384, and the model's files by one fixed revision of its repository and the size and hash of each file; every file is checked before it is used, and the browser keeps them. Nothing about the plans leaves the device. Without WebGPU the app says so.
- **AI with your own key** sends questions to your own AI service (any OpenAI-compatible chat completions API, hosted or on this computer), with your key, which stays on the device. Before anything is sent you see the request exactly as it goes, with your key masked, and each round of tool results waits for its own Send. The PDF goes only if you tick it for that question.

### Your own AI service

AI with your own key works with any service with an OpenAI-compatible chat completions API, or a local model server. In Settings you type the service's base address (for example `https://your-service.example/v1`, or `http://localhost:11434/v1` for a server on this computer), the model id it uses and your key (a server on this computer may need none). Requests go only to that address: https to any host, or http only to localhost and 127.0.0.1. The service's own terms apply to what you send it.

### Auto-takeoff accuracy

`python tools/autotakeoff_eval.py` writes labeled floor plans (`tests/plan_sheets.py`, also part of `tools/make_corpus.py`), reads them with pdf.js exactly as the app does, runs both cores (they must agree) and scores each class. The sheets: a house with hatched exterior walls, an office with a corridor, a clinic at 1/8" = 1'-0" with door swings drawn as short lines (CAD style), the house turned by /Rotate 90, a sheet drawn to be hard (solid fill walls with no outline, doors left 45 and 30 degrees open, two-line room names, numeric door tags inside circles, receptacles touching walls), and the house as a 200 dpi scan turned 0.6 degrees. Each also carries a border and title block, dimension strings, a legend, a table and a 12 in deep shelf.

| Class (count labeled) | Vector sheets: precision | recall | Scan: precision | recall |
|---|---|---|---|---|
| Walls (50; 9 on the scan) | 93% | 100% | 90% | 100% |
| Rooms (35; 6) | 100% | 100% | 100% | 100% |
| Doors (38; 7) | 100% | 100% | 100% | 100% |
| Windows (38; 7) | 100% | 100% | 100% | 100% |
| Symbols (97 copies; 14 receptacles) | 95% | 100% | 93% (from one boxed receptacle) | 100% |

Also: wall lengths within 2.2% of labeled on every sheet, the scan included (the extra length is the shelf), every wall typed exterior or interior correctly (9 of 9 on the scan), room clear areas exact on vector sheets and within 0.14% on the scan, room names right on every matched vector room, door widths exact on vector sheets and within 0.36 in on the scan, door tags right where the tag has a letter (D1, 201A; 1 of 6 on the hard sheet, whose tags are bare numbers). On the scan, the same doors searched from one boxed door instead find 3 of 7 (43%), the method before scans read door swings.

Door swings on scans, more widely (`python tools/autotakeoff_eval.py --sweep`): every labeled plan painted as a scan at 150, 200 and 300 dpi, turned -1.1, 0.6 and 0 degrees, through the app's line and door detection. 88 of 93 doors are found (95%) and none wrongly: 21 of 21 on the house, 24 of 24 on the office, 30 of 30 on the clinic (door swings drawn as chains of short lines) and 13 of 18 on the hard sheet, whose walls are solid fill with no face lines, so some openings show no wall gap to search.

These are invented sheets drawn by the same project that wrote the detector, so they are kinder than real plan sets. What they show honestly: the shelf and a shelf against a wall are suggested as walls (precision 85 to 90% on those sheets), door tags in circles are suggested as a repeated symbol (75% symbol precision on the hard sheet), numeric door tags are not read by auto-takeoff (plan review accepts them beside a door), on scans the shelf is suggested as a wall as on the vector sheets, and doors on scans of solid fill walls are often missed. Only the house was tested as a scan in the main table, and room names on scans need text recognition first. Real sets will add curved and angled walls, walls drawn as three or more lines, blocks with overlapping line work and symbols drawn at several sizes. Every suggestion is shown with its reason and nothing is added without a click.

## Quick start

```
pip install -e .[dev]
pytest -q                                   # Python library, repository rules, headless browser tests
python tests/make_vectors.py && node web/parity.test.mjs
npm ci && npm test                          # browser core and page contract
python web/build_pages.py                   # web/app.html and docs/ (the Pages build)
python examples/make_example.py             # regenerate the example plan set
PYTHONPATH=src python -m plantakeoff.library # regenerate the assemblies library (browser and JSON copies)
python tools/make_corpus.py && python tools/accuracy.py   # the accuracy corpus, measured
python tools/bench.py                       # timings on a 300-sheet set

plantakeoff length "12'-6 1/2\"" --to m      # 3.8227 m
plantakeoff scale "SCALE: 1/8\" = 1'-0\""    # 1/8" = 1'-0": 1:96.00
plantakeoff list plans.markups.json --group-by subject
plantakeoff estimate plans.markups.json
```

The app opens with an example: an invented single-story house on three sheets (site plan at 1" = 20', floor plan at 1/4" = 1'-0", roof plan at 1/8" = 1'-0") labeled EXAMPLE DATA, and a second revision of the floor plan for trying compare. `examples/make_example.py` draws them with exact geometry so the tests can check measurements by hand.

## Layout

| Path | What it holds |
|---|---|
| `src/plantakeoff/` | Python library: `units`, `scale`, `geometry`, `measure`, `assembly`, `formula`, `markups` (file validation, markup list, grouping), `merge`, `annotations` (the PDF annotation mapping), `library` (the assemblies library, which writes its browser and JSON copies), `export` (CSV), `cli` |
| `web/src/core/` | Browser core, pure functions: the same modules as the library plus title block reading, raster tools (room fill, symbol search, compare, scan cleanup and line finding), carry forward, undo history, line work extraction, the PDF object and XML readers for imports, the XLSX writer, QR codes, live session message checks and the default layers, assemblies and presets |
| `web/src/ui/` | The interface. Colors live only in the token blocks at the top of `web/src/style.css`: graphite chrome, the pencil set for markups on the sheet, and one redline answer per view. `12_net.js` is the only way out (see SECURITY.md) |
| `web/vendor/` | pdf.js, pdf-lib and the text engine (tesseract.js-core) exactly as published on npm, with `pins.json` (`tools/vendor.py` copies them from `node_modules` and checks the pins) |
| `web/app.html`, `docs/` | Built single-file app (everything inside, 7.5 MB) and the Pages build (PWA, self-hosted fonts; the page is 3.6 MB and the text engine's WebAssembly is its own pinned file, `docs/tesseract-core-lstm.wasm`, loaded only when OCR is used) |
| `tools/make_corpus.py`, `tools/accuracy.py` | The accuracy corpus (synthetic sheets with golden values) and the runner that measures it with the app |
| `tools/bench.py` | Times a 300-sheet set: open, sheet changes, panning, the 100,000-row list, memory |
| `tools/fetch_public_sets.py` | Downloads public-domain government plan sets into `corpus/public/` to try (never run by the tests, never committed) |
| `tools/shoot.py` | Screenshots of every main view at 400, 1024, 1280 and 1920 px, light and dark, into `shots/`, with checks for sideways scroll and touch targets under 44 px |
| `tests/` | pytest (library, properties, parity vectors, repository rules, headless browser), `tests/js/` (node) |
| `FORMAT.md` | The markup, tool chest and assemblies file formats |

## Method and equations

- **Scale.** Real inches per PDF point (1/72 in of paper). A standard scale of `p` inches of paper to `r` real inches gives `r / (72 p)`. Calibration gives `known length / distance between the picked points`. Unit factors are exact: 1 in = 25.4 mm (international yard and pound, 1959), 1 ft = 12 in, 1 yd = 36 in, 1 acre = 43,560 SF, 1 gal = 231 cu in.
- **Length.** Euclidean distance; polylength is the sum of segment lengths.
- **Area.** Shoelace (surveyor's) formula, `A = 1/2 |sum (x_i y_(i+1) - x_(i+1) y_i)|`, computed relative to the first vertex for accuracy at large coordinates. Net area subtracts each cutout's absolute area and is floored at zero. Every pair of non-adjacent edges is tested for crossing (orientation tests with collinear overlap); a crossing outline or cutout, a cutout outside the outline, or overlapping cutouts are reported, because the formula is then not the enclosed area.
- **Perimeter, volume, wall area, pitch.** Closed polyline length; net plan area times depth; length times height; plan area times `sqrt(1 + (rise / 12)^2)` for a pitch of rise in 12 (Pythagoras). Pitch applies to areas only: a volume (slab, footing, fill) is plan area times depth, and a pitch set on it is ignored.
- **Angle, radius and diameter.** Angle from `atan2` of the cross and dot products of the two arms (0 to 180 degrees). Radius from a center and an edge point, or the circumcircle of three points on the arc from the intersection of perpendicular bisectors. Diameter from two points across the circle (half their distance is the radius) or three points on it. Group totals in the markups list count angles as rows but never add them: a sum of angles is not a quantity.
- **Snapping.** Nearest vertex, then segment midpoint, then nearest point on a segment, then grid, within 10 screen pixels. Line work comes from the PDF's own drawing operators with the current transform applied (curves reduced to their chords). The 45 degree lock projects onto the nearest ray.
- **Assemblies.** `raw = source quantity in its unit x factor + per-measurement x measurements`, or the component's formula over the totals (`LF PF SF WSF CF CY EA N`) and the assembly's inputs; `with waste = raw x (1 + waste/100)`, `order = ceil(with waste / pack)` when a pack size is set, `material = order x unit cost`, `labor = order x hours per unit x the trade's rate`, each in whole cents rounded half away from zero. Quantities are summed over every linked measurement before rounding up, so a job buys whole sheets once, not once per wall. Overhead applies to the subtotal, markup to subtotal plus overhead, and tax to all three.
- **Viewports.** A markup measures at the scale of the viewport its first point falls in (the last one drawn wins where viewports overlap), else at the page scale.
- **Merging.** Each markup carries an edit counter and the ids of its last 32 versions. A markup changed on one side only (the other side's latest version is in its history) takes that side; changed on both sides, or changed on one and deleted on the other, is a conflict for the person to decide. Deleted markups leave a tombstone so a merge does not bring them back. Comments and status histories merge by id and time.
- **Text recognition.** The sheet is drawn at up to 300 pixels per inch of paper (at most 24 million pixels), its contrast stretched, its skew found by the projection profile method (the angle within plus or minus 5 degrees, in 0.5 then 0.05 degree steps, where the rows of a sample of ink pixels vary most) and turned straight, thresholded by Otsu's method (Otsu, 1979), and specks of a few pixels removed, then read by Tesseract's LSTM engine in sparse text mode. Words go back through the straightening onto the sheet. Feet and inch marks are small and often lost, so a low-confidence word made only of digits and dimension marks is kept, and `= 1-0"` after an equals sign reads as `= 1'-0"`.
- **Snapping on scans.** The picture is straightened, thresholded and cleaned the same way; horizontal and vertical runs of ink longer than about 18 pt are joined into lines along their centers, their crossings found, and both turned back onto the page. Snapping uses their ends and crossings like vector line work.

- **Area by click.** The sheet is drawn at up to 2.5 pixels per point (at most 12 million pixels), pixels darker than 170 of 255 are ink, the enclosed space under the click is flood filled (optionally after growing the ink by 2, 4 or 7 pixels to close gaps, then growing the space back), and its boundary is traced along pixel edges and simplified with Douglas-Peucker (Douglas and Peucker, 1973) at 0.75 pixel. Islands under about 12 x 12 pt of paper (room names, symbols) count as part of the room; larger ones become cutouts. Whole pixels put the trace a fraction of a pixel off the ink, so each edge is then moved to its wall: the grayscale is read across the edge at up to 32 places, and each wall line's width (its total darkness between paper and ink) and middle (the centroid of that darkness) give its two faces, which pixel averaging does not shift. A second line within 10 in (at the sheet's scale) behind the first is the same wall when the whole stays under 24 in. Each edge takes the median of its readings; edges with no wall (a doorway closed by gap bridging) take the median of the other walls. The boundary is the inside face, the inside face plus half the wall, or plus all of it; neighboring edges are joined where their moved lines cross. Cutouts are always taken at their face.
- **Symbol search.** Normalized cross-correlation of the picked symbol with every window of the sheet, with box sums from integral images for the window means and variances (Lewis, "Fast Normalized Cross-Correlation", 1995). A coarse pass on images reduced so the symbol is about 8 pixels across (skipping blank windows and windows with far more or less ink than the symbol), a middle pass, and a full-resolution pass; non-maximum suppression; the symbol is also tried turned 90, 180 and 270 degrees and mirrored. Matches from 0.6 up are listed; 0.72 and up start checked.
- **Compare.** Both sheets drawn at the same size and binarized; the shift comes from cross-correlating row and column ink profiles, then a 5 x 5 pixel search; pixels present in one sheet and not within 1 pixel of ink in the other are changes; changes are grouped into boxes by connected components after growing them a few pixels.
- **Auto-takeoff.** Line work is read from pdf.js's operator list with the drawing transform, line widths and a fill flag, curves kept as Bezier curves. Walls: segments 2 ft and longer, parallel within 1 degree and 2.5 to 16 in apart at the sheet scale (1/4" = 1'-0" assumed without one), overlapping at least 2 ft and 2.5 times their spacing, nearest partner first, no stretch of a line used twice per side; pieces in line with the same thickness join across gaps up to 1.6 times the thickness and across door and window openings found on them; ends extend to the next wall's centerline (L and T corners). Rooms: the centerlines are split where they cross, dead ends are removed, and faces are walked turning most to the right at each vertex; faces under 16 SF or slivers are dropped; the clear outline moves each edge in by half its wall. Doors: a Bezier curve or a chain of short lines that fits a circle within 0.4% of its radius, sweeping 25 to 100 degrees with an 18 to 48 in radius, with a straight leaf from its center to one end. Symbols: connected clusters 3 to 40 pt across (a part inside another belongs to it), compared by their points to half a point in all 8 quarter turns and mirrors. Border and title block strips are found as lines running most of the sheet near its edges and left out. Python and JavaScript give the same results (parity cases).
- **Plan review.** Dimension strings: horizontal dimension text read as a length, each with the dimension line under it; a dimension whose line spans two or more others on another row, tiling it, must equal their sum within 1/2 in. A dimension's drawn length at the sheet scale must match its text within 2% and 1 in. Sheet numbers compare without spaces, dashes and dots; titles compare as words.
- **Project manual.** Section headings in the 2004 and later form (six digits, with or without spaces, an optional .NN) and the 1995 five-digit form; END OF SECTION closes one. Items match a section through their assembly's code (six digits) or a fixed list of words, each good to the precision it names (for example doors to 08 1).
- **Title blocks.** Text items are joined into lines; a sheet number is a code such as A-101, A1.01 or S-2 (or one after SHEET NO.), scored by size and position (right edge and bottom of the sheet); the title is a SHEET TITLE label's value or the largest wordy line near the sheet number; scale notes are parsed as `paper length = real length` (both with units) or `1:N` near the word SCALE or at a common metric ratio.

## Limits

- A printed scale is only right for a sheet printed at full size. Reduced sets need a calibration against a known dimension.
- Area by click works on a raster: after its edges are put on the walls it lands within about a tenth of a point of paper of the wall face on the accuracy corpus (see Accuracy). Walls that are not straight lines (curved walls, hatched or very light walls) are read less well; check them. Dashed or broken walls may need a line drawn across the gap. Door swings drawn into a room are excluded from it, as drawn, and a wall centerline or outside face is only as good as the walls drawn around the room.
- Symbol search finds symbols at the size picked. Copies drawn at other scales, overlapping heavy line work, or turned at angles other than 90 degrees can be missed; similar shapes can match. You confirm every match. On a 150 dpi scan it found 4 of 6 symbols.
- Snapping on scans finds straight horizontal and vertical lines (after straightening); sloped lines and curves have no snap points, so those clicks land where you put them.
- Text recognition reads printed text, in English, and needs the one-time language data download. Handwriting and very small text are not read reliably.
- Compare assumes one shift per sheet. A view moved within an otherwise fixed sheet shows as changed.
- Rotated pages are measured and flattened in the orientation shown. Pages with a different scale in x and y are not supported.
- Live sessions connect browsers directly. On the local network nothing else is needed; across networks a STUN host must be set, and peers behind strict firewalls may still not connect (there is no relay server).
- Auto-takeoff reads straight walls drawn as two lines. Curved walls, walls at angles in a way that leaves no parallel partner, walls drawn as three or more lines (veneer and studs) and walls drawn as a single line are missed or split; shelves and counters a wall thickness deep are suggested as walls. Doors need a swing arc and a leaf; door tags are read only when they have a letter. Symbols must be drawn at the same size; a symbol that touches other line work becomes a different shape. Viewport scales are not used (the sheet's scale is). On scans, doors are read only where a swing arc and its leaf sit at a gap in a wall's face line (doors in solid fill walls are often missed; box one and Find symbol finds the rest), and gaps up to 4 ft in a wall are taken as openings.
- Plan review reads horizontal text only; turned dimension text and schedules drawn as pictures are not read. A room schedule is read from rows that start with a room number.
- The on-device model is small: it follows the reply format most of the time but not always, and an answer it cannot format is shown as plain text with its numbers checked. The weights' own config and tokenizer files are fetched from the model's repository without a hash pin in this build (the model library and the WebLLM library are pinned); `huggingface.co` was not reachable when the pins were made.
- Large raster-heavy plan sets are held in memory while open; a 500 MB set needs a desktop browser with memory to match. The render worker keeps its own copy of sets up to 200 MB; larger ones draw on the main thread.

## Import and export

- Opens any PDF, including sets exported from Bluebeam Revu, PlanSwift, STACK or a CAD program. Markups stored in the PDF as standard annotations (lines, polylines, polygons, rectangles, ellipses, text boxes, callouts, ink, highlights, stamps) can be imported as editable markups; measurements keep the scale in their measurement dictionary, counted items join by subject, and page viewports come along.
- Revu tool sets (`.btx`, including compressed items) import into the tool chest. Revu markup summaries (CSV or XML) import as quantities in the markups list that feed assemblies like any measurement.
- Price lists (CSV with any column names) update component prices and labor hours after a review; labor prices become hours at each component's labor rate.
- Markups list and estimate export as CSV (UTF-8 with a byte order mark, CRLF line ends, with the formula guard described in SECURITY.md) and XLSX (values only, no macros). The markup summary and the estimate also export as PDF reports.
- The markup file (`*.markups.json`) is this tool's editable format; assemblies and the tool chest have files of their own. All three are documented in FORMAT.md.
- Flatten writes a standard PDF with the markups drawn in. Save PDF with markups as annotations writes them as standard PDF annotations with appearances and measurement scales, which other viewers show and takeoff programs read.

## Validation

357 pytest tests (262 for the library, the repository rules, the exports and the published copy, 95 in headless Chromium on the page as GitHub Pages serves it: links filled in, under /scaleline/), 63 node tests, and 1,564 parity cases (43,339 checks). TESTING.md records the full function test: every tool, key, menu item, import and export, with the results.

- `pytest`: hand-computed geometry (rectangles, L shapes, triangles, cutouts, bowties, large coordinates), calibration round trips at every standard scale, feet-inch parsing and formatting, scale notes, assemblies checked by hand (drywall and studs, formulas with inputs, labor and overhead), the formula parser against hostile input, merging (edits on one side, on both sides, deletes against edits, a settled conflict not asked again, comments and status histories), the PDF annotation mapping through real PDF objects (pikepdf) both ways, annotations shaped like another program's measurement markups, the library (191 assemblies, each valid, with its note and no prices, and hand checks of drywall and slab assemblies), markup file validation against hostile input, the CSV formula guard, the XLSX writer read back by openpyxl (formula-like text kept as text, no external links), QR codes read back by OpenCV; seeded property tests; repository rules; and the headless browser tests below.
- `node web/parity.test.mjs`: 1,540 cases written by the Python library replayed against the browser core (numbers to 1e-9 relative, text and error codes exact), covering units, scales, measurement, assemblies, formulas, merging, the annotation mapping, auto-takeoff on labeled sheets, plan review, the project manual check and the plan question checks.
- `npm test`: room fill on drawn rooms, symbol search including turned copies, compare, carry forward, title block reading, undo history, line work from pdf.js's path data, the PDF object and XML readers (document types refused), tool chest items, markup summaries, price list matching, the XLSX and zip writer, QR codes, live session message checks and rate limits, seeded fuzzing of the live session checks, session codes and every import reader (prototype keys, long tags, deep nesting), local network candidate filtering, area by click on antialiased test rasters (inside face, centerline and outside face of single and double line walls, a doorway, a column), scan cleanup (threshold, skew, specks, lines and crossings on a turned picture, recognized words back onto the sheet), and the page contract and security rules (one network gate with four switches, all off; the one outside address; the policy; pinned libraries including the text engine).
- Headless browser (Chromium), as before: rotated, offset and cropped pages, scans, the CVE-2024-4367 proof, framing, Delete all data, carry forward, desktop keys, the example takeoff, room fill, symbol search, the sheet index, compare, flatten, hostile PDFs, no network requests, touch, phone width, autosave and a large set. New in this version:
  - **Accuracy corpus** (`tests/test_browser_accuracy.py`): a quick corpus of 10 sheets (rotations 0 to 270, drawings turned by the content matrix, an offset and cropped page box, two viewports at different scales, a 150 dpi scan turned 1.5 degrees) measured with the app's own tools, each measurement type within its tolerance.
  - **Team** (`test_browser_team.py`): comments with mentions and replies, assigned to me, status history; merging a teammate's file with a conflict review; shared folder sync; a live session between two browser contexts joined by copying codes on localhost (a markup from the host, a comment back from the guest, the host's named cursor, and the host lock); the live session blocked while its switch is off; a hostile host sending malformed, oversized and prototype-keyed messages, HTML in every field, fake rosters and floods (the guest shows text as text, keeps its settings and disconnects it); hostile files in the shared folder (a folder named like a markup file, broken JSON, a 120,000-markup file for another PDF, prototype keys, a file over 50 MB).
  - **Scans** (`test_browser_scan.py`): the OCR switch, the one pinned download (served from the npm package), altered data refused, the text engine fetched once from the same site as its own file and an altered engine refused, a skewed scan read into the title block reader (sheet A-101, scale 1/4" = 1'-0") and search, snapping to lines found in a scan.
  - **Exchange** (`test_browser_exchange.py`): measurement markups from another program's PDF imported with their scales and viewport; a viewport drawn by hand; markups written as annotations and read back by the Python reader, by pdf.js (with their measurement text and line ends) and by the app itself; annotations written into a PDF full of scripts give a file qpdf accepts with no script or action left anywhere; XLSX and both PDF reports.
  - **Library** (`test_browser_library.py`): the library browser, labor rates, a price list with other column names mapped and reviewed, overhead, formulas and inputs, assemblies shared as a file, a `.btx` tool set with compressed items, a markup summary as quantities.
  - **Large sets** (`test_browser_perf.py`): the render worker, tiles, a window of thumbnails for 120 sheets, the device cache of page text and thumbnails, and 100,000 markups in the list.
  - **Auto-takeoff and plan questions** (`test_browser_ai.py`): auto-takeoff on A-101 adds one batch that one undo removes, wall type rules edited and reset, plan review with an RFI callout, the project manual check both ways, plan questions off by default with nothing sent, the AI service mocked, hosted and on localhost (every request shown before its Send, tool results included, byte for byte, the key never in it, no PDF unless ticked, links removed, a number the model wrote itself, in digits or in words, marked [?]), a hostile title block obeyed by a mocked model with nothing changed, fetched or reset, the key absent from every export and store but its own, the on-device model's files fetched only from their pinned revision and a tampered file refused and never kept, the file check against git blob ids and SHA-256, doors found on a scanned sheet in the app, and the title block scale set with accepted auto-takeoff and removed by the same undo.
  - **Help** (`test_browser_help.py`): the help panel, the shortcut sheet, the page for people coming from Revu, the tour, and no request and no peer connection across every new part with both switches off.

### Accuracy

`python tools/make_corpus.py && python tools/accuracy.py` measures 17 sheets (13 vector, 4 scans at 150 to 400 dpi turned up to 1.5 degrees) the way a person would: zoomed in, each click 3 screen pixels off the true point so snapping has to find it. Errors are relative to the golden value (degrees for angles, items for counts). Headless Chromium on a Linux container:

| Measurement | Vector sheets: worst (mean) | Scans: worst (mean) |
|---|---|---|
| Scale read from the title block | 13 of 13 | 4 of 4 (after text recognition) |
| Length | 0.000% | 0.21% (0.09%) |
| Perimeter | 0.000% | 0.13% (0.10%) |
| Area (snapped corners) | 0.000% | 0.41% (0.33%) |
| Length and area inside a viewport at its own scale | 0.000% | |
| Angle | 0.001 deg | 1.0 deg (0.7 deg) |
| Diameter | 0.000% | 1.0% (1.0%) |
| Count (find symbol from one example) | exact on all 13 | 2 missed on the 150 dpi scan, exact on the others |
| Area by click (inside face) | 0.50% (0.13%) | 0.09% (0.06%) |

On vector sheets snapping lands on the drawing's own coordinates, so lengths, areas and angles are exact to the arithmetic. Area by click traces a raster and then puts each edge on its wall face; it still lands about a tenth of a point of paper inside the walls on vector sheets (the 0.50% is a small room on a letter sheet at 1" = 20'; before the edges were moved to the walls that room was off by 1.5%). On scans snapping finds straight horizontal and vertical lines, so sloped lines and curves are clicked by hand, which is where the angle and diameter errors come from.

### Performance

`python tools/bench.py` (add `--heavy`, or `--pdf` for any file), headless Chromium on a shared Linux container with no GPU (software drawing; a desktop browser is usually faster). Targets: first sheet under 2 s, a sheet change under 300 ms, 60 frames per second panning.

| Set | First sheet | Sheet change, median (worst) | Back to a seen sheet | Panning zoomed in | 100,000-row list |
|---|---|---|---|---|---|
| 300 sheets, 36 x 24 in vector floor plans (0.4 MB) | 0.25 s | 98 ms (122 ms) | 124 ms | 60 fps | drawn in 0.28 s, scrolls at 58 fps |
| 300 sheets with about 12,000 hatch segments and an image underlay each (6.2 MB) | 1.39 s | 132 ms (183 ms) | 109 ms | 60 fps | scrolls at 58 fps |
| One sheet with 110,000 path operations | 1.56 s | | | 60 fps | |

Sheets draw in the render worker; the thumbnail shows first (from memory or the device cache), then the whole sheet, then 512 px tiles for the part on screen. The tile cache holds up to about 48 MB per GB of device memory (96 to 512 MB). The JavaScript heap stayed between 87 and 117 MB with 100,000 markups loaded. Sheet changes include the round trip of the test driver.

## License

MIT, copyright 2026 Will Whitmire. pdf.js 5.7.284 is Apache 2.0 (Mozilla), pdf-lib is MIT (Andrew Dillon), tesseract.js-core 6.1.2 (the Tesseract engine) is Apache 2.0, the English language data (tessdata, through @tesseract.js-data/eng) is Apache 2.0 and is downloaded only when OCR is turned on, Encode Sans is OFL 1.1, Ubuntu Sans Mono is under the Ubuntu Font Licence 1.0; their licenses are in `web/vendor/` and `web/src/pwa/fonts/`.

Built by Will Whitmire. Runs entirely in your browser; nothing you enter is uploaded.
