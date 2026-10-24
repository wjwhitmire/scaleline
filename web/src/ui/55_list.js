// ---------------------------------------------------------------- markups list (bottom panel)
const rowH = () => (isTouch() ? 44 : 26);
const BASE_COLS = [
  ["page", "Page", true], ["sheet", "Sheet"], ["type", "Type"], ["subject", "Subject"], ["label", "Label"], ["layer", "Layer"],
  ["author", "Author"], ["status", "Status"], ["date", "Date"], ["measurement", "Measurement", true], ["quantity", "Quantity", true], ["unit", "Unit"],
  ["assignee", "Assigned"], ["comments", "Comments", true],
];
const rowCache = new WeakMap();
let listRows = [], listDisplay = [];

function allRows() {
  const md = model();
  const layerNames = {};
  for (const l of md.layers) layerNames[l.id] = l.name;
  return md.markups.map((m) => {
    const sig = [md.settings, md.pages[String(m.page)], md.layers];
    const hit = rowCache.get(m);
    if (hit && hit.sig.every((x, i) => x === sig[i])) return hit.row;
    const row = C.markup_row(md, m, layerNames);
    // list-only fields: who it is assigned to and how many comments it has
    row.assignee = m.assignee || "";
    const n = (m.comments || []).filter((c) => !c.deleted).length;
    row.comments = n ? n + (m.resolved ? " resolved" : "") : "";
    rowCache.set(m, { sig, row });
    return row;
  });
}
function buildListPane() {
  const pane = clear($("pane-list"));
  const bar = el("div", { cls: "listbar" });
  const groupSel = el("select", { id: "list-group", "aria-label": "Group by" });
  const filter = el("input", { type: "search", cls: "search", id: "list-filter", placeholder: "Filter markups", "aria-label": "Filter the markups list" });
  filter.value = S.ui.filter;
  filter.addEventListener("input", debounce(() => { S.ui.filter = filter.value; renderList(); }, 150));
  groupSel.addEventListener("change", () => { S.ui.groupBy = groupSel.value; renderList(); });
  const thisPage = el("input", { type: "checkbox", id: "list-this-page", checked: S.ui.thisPage });
  thisPage.addEventListener("change", () => { S.ui.thisPage = thisPage.checked; renderList(); });
  const mine = el("input", { type: "checkbox", id: "list-mine", checked: !!S.ui.mine });
  mine.addEventListener("change", () => {
    S.ui.mine = mine.checked;
    if (S.ui.mine && !whoAmI()) { askName("Assigned to me matches your name against assignees and @names in comments.", () => renderList()); return; }
    renderList();
  });
  const exp = el("button", { type: "button", cls: "btn small", id: "list-export" }, [icon("export"), "Export CSV"]);
  exp.addEventListener("click", exportListCsv);
  const cp = el("button", { type: "button", cls: "btn small", id: "list-copy" }, [icon("copy"), "Copy CSV"]);
  cp.addEventListener("click", () => copyText(listCsv(), "markups list as CSV"));
  const cols = el("button", { type: "button", cls: "btn small", id: "list-columns" }, [icon("settings"), "Columns"]);
  cols.addEventListener("click", openColumns);
  bar.append(el("label", { for: "list-group", cls: "cap", text: "Group" }), groupSel, filter, el("label", { cls: "chk", for: "list-this-page" }, [thisPage, "This sheet"]),
    el("label", { cls: "chk", for: "list-mine" }, [mine, "Assigned to me"]), cols, exp, cp,
    el("span", { cls: "tot", id: "list-count" }));
  const wrap = el("div", { cls: "tablewrap", id: "list-wrap" });
  const table = el("table", { cls: "grid", id: "list-table" });
  wrap.append(table);
  wrap.addEventListener("scroll", () => renderListWindow());
  pane.append(bar, wrap, el("div", { cls: "listfoot", id: "list-totals" }));
}
function listColumns() {
  return BASE_COLS.concat(model().columns.map((c) => ["custom:" + c.id, c.name]));
}
function renderList() {
  if (!S.doc || !model()) return;
  if (!$("list-table")) buildListPane();
  const groupSel = $("list-group");
  const groupOpts = [["", "None"], ["subject", "Subject"], ["type", "Type"], ["page", "Page"], ["sheet", "Sheet"], ["layer", "Layer"], ["status", "Status"], ["author", "Author"], ["assignee", "Assigned"]]
    .concat(model().columns.map((c) => ["custom:" + c.id, c.name]));
  clear(groupSel);
  for (const [v, l] of groupOpts) groupSel.append(el("option", { value: v, text: l }));
  groupSel.value = S.ui.groupBy;
  let rows = allRows();
  if (S.ui.thisPage) rows = rows.filter((r) => r.page === S.view.page + 1);
  if (S.ui.mine) { const me = whoAmI(); rows = rows.filter((r) => { const m = markupById(r.id); return m && C.assigned_to(m, me); }); }
  if ($("list-mine")) $("list-mine").checked = !!S.ui.mine;
  const f = S.ui.filter.trim().toLowerCase();
  if (f) rows = rows.filter((r) => [r.sheet, r.type, r.subject, r.label, r.layer, r.author, r.status, r.measurement, r.date].concat(Object.values(r.custom)).some((v) => String(v).toLowerCase().includes(f)));
  if (S.ui.sort) {
    const [key, dir] = S.ui.sort;
    const val = (r) => (key === "measurement" || key === "quantity" ? (r.quantity === null ? -Infinity : r.quantity) : key === "page" ? r.page : C.row_key(r, key).toLowerCase());
    rows = rows.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }
  listRows = rows;
  listDisplay = [];
  if (S.ui.groupBy) {
    const groups = C.group_totals(rows, S.ui.groupBy);
    const byKey = new Map();
    for (const r of rows) { const k = C.row_key(r, S.ui.groupBy); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
    for (const g of groups) {
      listDisplay.push({ group: g });
      for (const r of byKey.get(g.group) || []) listDisplay.push({ row: r });
    }
  } else listDisplay = rows.map((r) => ({ row: r }));
  const table = $("list-table");
  clear(table);
  const cols = listColumns();
  const thr = el("tr", null, [el("th", { cls: "sw" }, [el("span", { cls: "sr-only", text: "Color" })])]);
  for (const [key, label, num] of cols) {
    const th = el("th", { cls: num ? "num" : "", scope: "col", tabindex: 0, "aria-sort": S.ui.sort && S.ui.sort[0] === key ? (S.ui.sort[1] > 0 ? "ascending" : "descending") : "none", text: label });
    const sortIt = () => { S.ui.sort = S.ui.sort && S.ui.sort[0] === key ? (S.ui.sort[1] > 0 ? [key, -1] : null) : [key, 1]; renderList(); };
    th.addEventListener("click", sortIt);
    th.addEventListener("keydown", (e) => { if (e.key === "Enter") sortIt(); });
    thr.append(th);
  }
  table.append(el("thead", null, [thr]), el("tbody", { id: "list-body" }));
  const nSel = rows.filter((r) => S.selection.has(r.id)).length;
  $("list-count").textContent = rows.length.toLocaleString() + " markup" + (rows.length === 1 ? "" : "s") + (nSel ? ", " + nSel + " selected" : "");
  $("tab-list-count").textContent = model().markups.length ? model().markups.length.toLocaleString() : "";
  renderListWindow();
  renderTotals(rows);
}
function renderListWindow() {
  const wrap = $("list-wrap"), body = $("list-body");
  if (!wrap || !body) return;
  const cols = listColumns();
  const first = Math.max(0, Math.floor(wrap.scrollTop / rowH()) - 10);
  const count = Math.ceil(wrap.clientHeight / rowH()) + 20;
  const last = Math.min(listDisplay.length, first + count);
  clear(body);
  if (first > 0) body.append(el("tr", { "aria-hidden": "true", style: "height:" + first * rowH() + "px" }));
  for (let i = first; i < last; i++) {
    const d = listDisplay[i];
    if (d.group) {
      const g = d.group;
      const qi = cols.findIndex((c) => c[0] === "quantity"), ui = cols.findIndex((c) => c[0] === "unit");
      const one = g.totals.length === 1 && qi >= 0 && ui === qi + 1;
      const tot = g.totals.map((t) => C.format_number(t.quantity, model().settings.places) + " " + unitLabel(t.unit)).join(", ");
      const name = el("td", { colspan: one ? qi + 1 : cols.length + 1 }, [g.group || "(none)", el("span", { cls: "n", text: String(g.rows) }), !one && tot ? el("span", { cls: "n", text: tot }) : null]);
      const cells = [name];
      if (one) {
        cells.push(el("td", { cls: "num qty", text: C.format_number(g.totals[0].quantity, model().settings.places) }), el("td", { text: unitLabel(g.totals[0].unit) }));
        for (let k = ui + 1; k < cols.length; k++) cells.push(el("td"));
      }
      body.append(el("tr", { cls: "group" }, cells));
      continue;
    }
    const r = d.row;
    const mk = markupById(r.id);
    const tr = el("tr", { cls: S.selection.has(r.id) ? "sel" : "", "data-id": r.id });
    const pc = mk ? colorOf(mk) : "";
    tr.append(el("td", { cls: "sw" }, [el("span", { cls: "swatch", style: "--pc:" + pc })]));
    for (const [key, , num] of cols) {
      let v;
      if (key === "quantity") v = r.quantity === null ? "" : C.format_number(r.quantity, model().settings.places);
      else if (key.startsWith("custom:")) v = r.custom[key.slice(7)] || "";
      else v = r[key] === null || r[key] === undefined ? "" : String(r[key]);
      if (key === "unit") v = unitLabel(v);
      if (key === "measurement") v = unitText(v);
      if (key === "status") {
        const s = select(C.STATUSES.map((x) => [x, x || "None"]).concat(C.STATUSES.includes(r.status) ? [] : [[r.status, r.status]]), r.status, { "aria-label": "Status" });
        s.addEventListener("change", () => updateMarkups([r.id], (c) => { if (s.value) c.status = s.value; else delete c.status; }, "Set status"));
        tr.append(el("td", null, [statChip(r.status, [s])]));
        continue;
      }
      if (key === "type" && mk) { tr.append(el("td", null, [el("span", { cls: "tcell", style: "--pc:" + pc }, [icon(typeIcon(mk.type)), v])])); continue; }
      const cls = (num ? "num" : "") + (key === "quantity" ? " qty" : "") + (key === "sheet" || key === "date" ? " m" : "");
      tr.append(el("td", { cls: cls.trim(), text: v, title: v }));
    }
    tr.addEventListener("click", (e) => selectFromList(r.id, e));
    body.append(tr);
  }
  const rest = listDisplay.length - last;
  if (rest > 0) body.append(el("tr", { "aria-hidden": "true", style: "height:" + rest * rowH() + "px" }));
}
function renderTotals(rows) {
  const box = clear($("list-totals"));
  const g = C.group_totals(rows, "unit").filter((x) => x.group && x.totals.length);
  const sums = el("span", { id: "list-grand-totals" });
  for (const x of g) sums.append(el("span", { cls: "sum" }, [C.format_number(x.totals[0].quantity, model().settings.places) + " ", el("small", { text: unitLabel(x.group) })]), " ");
  if (!g.length) sums.append(el("span", { cls: "help", text: "none" }));
  box.append(el("span", { cls: "cap", text: "Totals" }), sums);
}
async function selectFromList(id, e) {
  const m = markupById(id);
  if (!m) return;
  if (e && (e.shiftKey || e.ctrlKey || e.metaKey)) { if (S.selection.has(id)) S.selection.delete(id); else S.selection.add(id); }
  else { S.selection.clear(); S.selection.add(id); }
  if (m.page !== S.view.page) { const keep = new Set(S.selection); await goToPage(m.page); S.selection = keep; }
  const b = markupBounds(m);
  const r = pageToScreen(b[0], b[1]), r2 = pageToScreen(b[2], b[3]);
  if (r[0] < 0 || r[1] < 0 || r2[0] > vw() || r2[1] > vh()) centerOn((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  emit("selection");
}
function listCsv() { return C.markup_list_csv(listRows, model().columns, S.ui.groupBy); }
function exportListCsv() {
  saveFile(safeFileName((S.doc ? S.doc.name.replace(/\.pdf$/i, "") : "takeoff") + "-markups") + ".csv", "﻿" + listCsv(), "text/csv", "CSV");
  status("Markups list exported (" + listRows.length + " rows). Text cells that start with = + - or @ are prefixed so spreadsheets do not run them.");
}
function openColumns() {
  const ul = el("ul", { cls: "list" });
  const draw = () => {
    clear(ul);
    for (const c of model().columns) {
      const del = el("button", { type: "button", cls: "iconbtn", "aria-label": "Remove column " + c.name }, [icon("trash")]);
      del.addEventListener("click", () => { commit("Remove column", (n) => { n.columns = n.columns.filter((x) => x.id !== c.id); }); draw(); });
      ul.append(el("li", null, [el("span", { cls: "grow", text: c.name }), del]));
    }
  };
  draw();
  const name = input({ id: "col-name", placeholder: "Cost code" });
  const add = el("button", { type: "button", cls: "btn small", id: "col-add", text: "Add column" });
  add.addEventListener("click", () => {
    const n = cleanName(name.value, 100);
    if (!n) return;
    if (model().columns.length >= C.LIMITS.columns) { status("Up to " + C.LIMITS.columns + " custom columns.", "warn"); return; }
    commit("Add column", (m) => { m.columns = m.columns.concat([{ id: newId("c"), name: n }]); });
    name.value = "";
    draw();
  });
  openDialog({ title: "Custom columns", icon: "settings", body: el("div", null, [el("p", { cls: "help", text: "Custom columns appear in the list, in Properties and in the CSV export." }), ul, el("div", { cls: "row", style: "margin-top:8px" }, [name, add])]), actions: [{ label: "Done", primary: true }] });
}
const renderListSoon = debounce(() => { if (S.ui.bottom === "list") renderList(); }, 60);
on("model", renderListSoon);
on("selection", () => { if (S.ui.bottom === "list") { document.querySelectorAll("#list-body tr[data-id]").forEach((tr) => tr.classList.toggle("sel", S.selection.has(tr.dataset.id))); const c = $("list-count"); if (c && model()) { const n = listRows.filter((r) => S.selection.has(r.id)).length; c.textContent = listRows.length.toLocaleString() + " markup" + (listRows.length === 1 ? "" : "s") + (n ? ", " + n + " selected" : ""); } } });
on("view", () => { if (S.ui.thisPage && $("list-table") && $("list-table").dataset.page !== String(S.view.page)) { $("list-table").dataset.page = String(S.view.page); renderListSoon(); } });
