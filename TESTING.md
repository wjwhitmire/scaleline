# Testing

This is the record of a full function test of Scaleline: every tool in the tool bar, every key, every menu item, scale, measurement, markup, panel, import, export, automation, team feature and network switch, exercised on the page as GitHub Pages serves it.

## How the test was run

- **Published form.** `git archive HEAD` unpacked to a temporary folder, the publish step's placeholders filled (`https://wjwhitmire.github.io/scaleline/`, `wjwhitmire`, `https://github.com/wjwhitmire/scaleline`), and `docs/` served under `/scaleline/` on localhost, as Pages serves it, with its real Content-Security-Policy. The whole headless browser suite now runs this way: the shared `server` fixture in `tests/test_browser.py` serves a filled copy of `docs/` under `/scaleline/`, so no browser test runs on the dev build. `web/app.html` was also opened over `file://`.
- **Headless Chromium** (Playwright) at 1280 and 1500 px, and at 400 px with touch in light and dark. Every step recorded what was done, what was expected and what happened; the runs failed on any page error, policy violation, request outside the site, sideways scroll or touch target under 44 px.
- **Downloads were opened and checked**: CSV parsed (byte order mark, CRLF), XLSX opened with openpyxl and its zip inspected for macros and external links, every PDF rendered with pdfium, the flattened PDF and the PDF with annotations read with pikepdf, the markup file, tool chest and export-all JSON parsed and reopened.
- **Numbers** were checked against hand calculations: every standard scale from the scale's own text, every measurement type on exact points, the interior partition assembly with overhead, markup and tax, and the assemblies library's rules of thumb against published trade figures (block 1.125 per SF, modular brick 6.86 per SF, a tie per 2.67 SF, grout 0.17, 0.26 and 0.43 CF per SF of 6, 8 and 12 in block, #4 bar 0.668 lb per ft, 3 shingle bundles per square, paint 350 SF per gallon, mesh sheets 160 SF, VCT 45 SF a box).
- **Hostile input**: mutation fuzzing (18,000 mutated files) of the markup file reader and merge, markup summaries (CSV and XML), tool chests (.btx), project manuals and price lists in the browser core, and 3,000 mutated markup files through the Python reader, merge, estimate and CSV export; empty, entity, random-byte and deeply nested tool chests through the page; bad and zero calibration lengths.

## Results

264 recorded checks in the walkthrough and 95 headless browser tests on the published page; all pass.

### Bugs found and fixed

| Severity | Bug | Fix |
|---|---|---|
| Medium | `web/app.html` opened from a file never started in headless Chromium: the IndexedDB open never answered, so start-up waited forever. Workers made from blob URLs also never ran and never failed there, so opening a PDF waited 60 seconds and failed, and area by click, symbol search and auto-takeoff (the compute worker has no timeout) would have waited forever. | Storage gives up after 5 seconds and the app runs without it; a tiny worker must answer within 3 seconds or the PDF engine, the image work and sheet drawing run on the main thread. The Pages policy now lists the PDF worker's code, so that fallback also runs on the published page. Opened from a file, the page now loads the example in 1.5 s, measures and flattens. Tests: `test_browser_published.py` (storage that never answers, workers that never run). |
| Low | Add cutout (Shift+Alt+X) with no area selected wrote "Select one area or volume first" and erased it in the same step, so nothing was shown. | Replaced by the automatic choice below. Test: `test_browser_published.py`. |
| Low | The shortcut sheet in Help left out Shift+Alt+T (auto-takeoff), Ctrl+O, Ctrl+S, Ctrl+C, Ctrl+V, Ctrl+A, Delete and ?. | Listed. Test: `test_browser_published.py`. |

### Decisions automated

| Decision point | Before | After |
|---|---|---|
| Which area a cutout cuts | "Select one area or volume first" (a dead end, and it vanished) | The sheet's only area is picked at once and the message says so; with several, the next area clicked arms the cutout by itself (Esc cancels) |
| Comparing a revision | Load the revision, then click Overlay before the view modes and changed areas appear | The sheet is compared with its match as soon as the revision opens; overlay, side by side, changes and the list of changed areas are there, with how the sheets were paired and the measured shift |
| Your name for comments | "Set your name in Settings first" and the comment posted with no author | A name field in the comment box when no name is set; saved with the first comment and not asked again |
| Your name for Assigned to me | A warning in the status bar | Asks once in a small dialog, remembers it, and filters |
| Already automatic, checked | | Scale offered from the title block with Apply and Why (and a rule to apply it); sheet index from title blocks; symbol count from one example; room area by click; auto-takeoff with the title block scale; assemblies from a preset or layer; price list columns guessed from the header and cells; markups carried to a revision; recognized text proposed before use; every one shown with its reason and undone in one step |

## Function inventory

Result P: passed on the published page, with the check made. Where a check lives in the browser suite, the test file is named.

### Tool bar and tools

| Item | Check | Result |
|---|---|---|
| Open PDF, Save markup file, Undo, Redo, Compare revisions, Flatten to PDF, Settings | present and working | P |
| Select, Pan, Zoom | pressed state, hint, keys V, Shift+V, Z | P |
| Text box, Callout, Cloud, Arrow, Line, Rectangle, Ellipse, Polygon, Polyline, Pen, Highlight, Stamp | each drawn; text through its dialog (markup kept as text) | P |
| Length, Polylength, Area, Perimeter, Volume, Count, Angle, Radius, Diameter | each drawn on exact points and checked by hand (below) | P |
| Calibrate, Area by click, Find symbol and count, Add cutout | calibrated 144 pt = 10 ft; room and doors (`test_browser.py`); cutout by hand | P |
| Snapshot, Viewport | picture dialog; viewport with its own scale | P |
| Folded tools behind each group's More (below 1440 px) | listed and reachable | P |
| Phone tray (select, pan, length, area, count, More) | tap arms, More lists the rest | P |

### Keys

Every tool key and alternate (V, Shift+V, Z, T or W, Q, C, A, L, R, E, Shift+P, Shift+N or N, P, H, Shift+Alt+L or 3, Shift+Alt+Q or 2, Shift+Alt+A or 1, Shift+Alt+P, Shift+Alt+V, Shift+Alt+C or 4, Shift+Alt+G, Shift+Alt+U, Shift+Alt+D, Shift+Alt+K, Shift+Alt+F or J, Shift+Alt+S, Shift+Alt+X, G, Shift+Alt+W, Shift+Alt+T); zoom (Ctrl+=, Ctrl+-, =, -, Ctrl+9, Ctrl+0, Ctrl+8); rotate (Ctrl+Shift+Plus and Minus); pages (Home, End, Page Up, Page Down, Ctrl+Left, Ctrl+Right); panels (Alt+L, Alt+X, Alt+Y, Alt+P, Alt+U, Alt+T); snaps (Ctrl+Shift+F7, F8, F9, Shift+F9); F1, ?, Ctrl+F, Ctrl+Shift+C, Ctrl+S, Ctrl+O; while drawing Enter, Esc, Backspace and a typed length; Ctrl+A, Tab, Ctrl+C, Ctrl+V, arrow nudge (Shift for 10 pt), Delete, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z: all P.

### Menus

| Menu | Items | Result |
|---|---|---|
| File | Open PDF, Open example, Recent plan sets, Save markup file, Open markup file, Flatten, Save PDF with annotations, Import markups from this PDF, Import a markup summary, Export workbook (XLSX), Markup summary report (PDF), Estimate report (PDF), Export markups list (CSV), Export all saved takeoffs (JSON), Export estimate (CSV), Settings and privacy | P |
| Edit | Undo, Redo, Copy, Paste, Delete, Select all on page, Snapshot, Viewport | P |
| View | Zoom, fit, actual size, rotate, panels, Show all labels, Hide compare overlay, Hide the PDF's own markups | P |
| Markup, Measure | every tool and Calibrate | P |
| Automate | Area by click, Find symbol, Add cutout, Read title blocks, Recognize text (OCR), Compare revisions, Auto-takeoff this sheet and every sheet, Review the plan set, Check against the project manual, Ask about these plans | P |
| Team | Merge, Shared folder sync, Start and join a live session, leave, Assigned to me, Your name | P (live and sync in `test_browser_team.py`) |
| Help | Help, Take the tour (every step), Coming from Revu, Keyboard shortcuts, Method and limits, About | P |

### Scale and measurement, by hand

| Item | Check | Result |
|---|---|---|
| All 44 standard scales | a 1 in (72 pt) line measures what the scale's own text says (12 / a for a" = 1'-0", 12 N for 1" = N', N for 1:N), exact | P |
| Title block scale | 1/4" = 1'-0" offered and applied (12/18 in per pt) | P |
| Calibrate | 144 pt typed as 10' gives 1:60; empty, text, zero, negative and overflowing lengths refused with the scale unchanged | P |
| Apply to all sheets, Clear, the seven length units | P |
| Length | 25 ft line: 300 in | P |
| Polylength | 10 + 10 + 10 (a 6-8-10 triangle leg): 360 in | P |
| Area and perimeter | 20 x 30 ft: 600 SF, 100 ft | P |
| Cutout | 5 x 4 ft hole: 580 SF | P |
| Pitch | 580 SF at 6 in 12: 580 x sqrt(1.25) | P |
| Wall area | 25 ft at 9 ft high: 225 SF | P |
| Volume | 10 x 10 ft at 6 in: 50 CF | P |
| Count | 5 clicks: 5 | P |
| Angle | 90 and 45 degrees | P |
| Radius, diameter | 3-4-5 ft: 60 in; 12 ft across: radius 72 in | P |
| Typed length, Backspace, Esc | 12'6" placed exactly; triangle after a dropped point 12.5 SF; nothing added on Esc | P |
| Viewports | measurements inside use the viewport's scale (`test_browser_accuracy.py`) | P |

### Markups list, layers, estimate, tool chest

| Item | Check | Result |
|---|---|---|
| Markups list | group by each of nine keys, filter, this sheet, sort, custom column, status, totals (angles never summed) | P |
| List CSV | byte order mark, CRLF, header, a row per markup; formula guard (`test_browser.py`) | P |
| Workbook XLSX | Markups and Estimate sheets, a row per markup, no macros or external links | P |
| Markup summary and estimate PDF reports | render; estimate shows 1,090.81 | P |
| Layers | new, rename, hide and show, lock (locked markup does not move), make active, default assembly menu | P |
| Assembly by hand | interior partition on a 20 ft, 9 ft high wall: 13 sheets, 17 studs, 5 track, 7.2 h; $796.58 | P |
| Overhead, markup, tax | 10%, 15%, 8.25%: $1,090.81 (cents rounded half away from zero at each step) | P |
| Estimate CSV, XLSX, PDF, copy; assemblies editor, add assembly | P |
| Library | 191 assemblies by division, search, add | P |
| Labor rates, price list import | other column names mapped and reviewed; board price 15.25 applied | P |
| Tool chest | preset arms the tool (height, layer, assembly); save from Properties; export and import; .btx with a compressed item; empty, entity, random and oversized chests refused | P |
| Markup summary import | 52'-6" = 630 in, 1,200 SF, 14 EA | P |
| Markup file | Ctrl+S saves every markup; reopening restores them | P |

### Compare, flatten and PDF annotations

| Item | Check | Result |
|---|---|---|
| Compare with the example revision | compared on opening; 7 changed areas; shift 6.1, 4.3 pt (plotted 6, 4) | P |
| Overlay, side by side, changes | each shows the right layer | P |
| Cloud changes | 7 clouds on Revision changes, one undo | P |
| Carry markups to revision | every markup carried, the 1,200 SF area unchanged, report, one undo | P |
| Flatten | 3-page PDF with markups drawn in, no annotations left; markup file alongside | P |
| Save PDF with annotations | Polygon and Line annotations with measure dictionaries | P |
| Read annotations back | the annotated PDF opened and imported: markups back, area 1,200 SF at its own scale | P |
| PDF's own markups | hidden after import, View toggles them | P |

### Automation, team and network

| Item | Check | Result |
|---|---|---|
| Auto-takeoff this sheet, every sheet | walls, rooms, doors, windows, symbols with reasons; Add is one undo | P |
| Plan review, project manual check (example manual) | findings and sections both ways | P |
| Read title blocks into the sheet index | C-101, A-101, A-201 | P |
| Text search | hits for BEDROOM | P |
| Network switches | four, all off by default; Live session refused with its switch off; Ask and OCR explain their switches | P |
| OCR with mocked downloads, plan questions with a mocked service, the on-device model's pinned files | `test_browser_scan.py`, `test_browser_ai.py` | P |
| Comments, replies, mentions, resolve, Assigned to me, status history, merge with conflict review, shared folder sync with a mocked File System Access API, a live session between two browser contexts, hostile peers and files | `test_browser_team.py` | P |
| No request with every switch off | `test_browser.py`, `test_browser_help.py` | P |

### Platform

| Item | Result |
|---|---|
| Phone 400 px with touch, light and dark: no sideways scroll, touch targets 44 px, tool tray, More, panels as sheets | P |
| Framing guard, Delete all data, autosave and reload | P (`test_browser.py`) |
| Large sets: render worker, tiles, virtual thumbnails and list, device cache | P (`test_browser_perf.py`) |
| `web/app.html` over `file://`: loads the example, measures, flattens (PDF engine, image work and drawing on the main thread, storage when the browser gives it) | P after the fix |
| Command line: `length` (12'-6 1/2" is 3.8227 m), `scale`, `list --group-by`, `estimate`, `merge`, `library`; a missing file, an empty and an unreadable length give a one-line error and exit 2 | P |

## How to rerun

```
pip install -e .[dev] playwright
npm ci
pytest -q                                   # library, repository rules and the browser suite on the published page
python tests/make_vectors.py && node web/parity.test.mjs
npm test
```

## Test counts

| | Before | After |
|---|---|---|
| pytest | 347 (85 in the browser; 345 before this test plus 2 for the published copy added alongside it) | 357 (95 in the browser, all on the published page) |
| node | 63 | 63 |
| Parity cases (checks) | 1,564 (43,339) | 1,564 (43,339) |

## Known limits of this test

- Plan sets were the example, the synthetic corpus and generated sheets; no third-party plan set was used.
- Touch was emulated in Chromium; real tablets, pens and phones were not tested.
- The on-device model and a real AI service were not run; their requests were mocked and their pins checked.
- Live sessions ran between two contexts of one browser on localhost.
