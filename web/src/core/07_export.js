// CSV export with the formula guard. Mirrors export.py.
const GUARD = ["=", "+", "-", "@", "\t", "\r"];
function text_cell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (GUARD.some((g) => s.startsWith(g))) s = "'" + s;
  if (/[,"\r\n]/.test(s) || s !== s.replace(/^ +| +$/g, "")) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function num_cell(x, places) {
  if (places === undefined) places = 6;
  if (x === null || x === undefined) return "";
  x = Number(x);
  if (!Number.isFinite(x)) return "";
  const scale = 10 ** places;
  const n = Math.floor(Math.abs(x) * scale + 0.5);
  const whole = Math.floor(n / scale), frac = n % scale;
  let s = String(whole);
  if (frac) s += "." + String(frac).padStart(places, "0").replace(/0+$/, "");
  return (x < 0 && n ? "-" : "") + s;
}
function money_cell(cents) {
  const neg = cents < 0, a = Math.abs(Math.trunc(cents));
  return (neg ? "-" : "") + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
}
function markup_list_csv(rows, columns, group_by) {
  columns = columns || [];
  const head = ["Page", "Sheet", "Type", "Subject", "Label", "Layer", "Author", "Status", "Date", "Measurement", "Quantity", "Unit", "Warnings"].concat(columns.map((c) => c.name));
  const lines = [head.map(text_cell).join(",")];
  for (const r of rows) {
    const cells = [String(r.page), text_cell(r.sheet), text_cell(r.type), text_cell(r.subject), text_cell(r.label), text_cell(r.layer),
      text_cell(r.author), text_cell(r.status), text_cell(r.date), text_cell(r.measurement), num_cell(r.quantity), text_cell(r.unit), text_cell(r.warnings)];
    for (const c of columns) cells.push(text_cell(r.custom[c.id] || ""));
    lines.push(cells.join(","));
  }
  if (group_by) {
    lines.push("");
    lines.push(["Totals by " + group_by, "Rows", "Quantity", "Unit"].map(text_cell).join(","));
    for (const g of group_totals(rows, group_by)) {
      const name = g.group || "(none)";
      if (!g.totals.length) lines.push([text_cell(name), String(g.rows), "", ""].join(","));
      for (const t of g.totals) lines.push([text_cell(name), String(g.rows), num_cell(t.quantity), text_cell(t.unit)].join(","));
    }
  }
  return lines.join("\r\n") + "\r\n";
}
function estimate_csv(est) {
  const head = ["Assembly", "Component", "Source", "Base quantity", "Raw quantity", "With waste", "Order quantity", "Unit", "Unit cost", "Cost"];
  const lines = [head.map(text_cell).join(",")];
  for (const line of est.lines) {
    for (const c of line.components) {
      lines.push([text_cell(line.name), text_cell(c.name), text_cell(c.source), num_cell(c.base, 4), num_cell(c.raw, 4), num_cell(c.with_waste, 4),
        num_cell(c.order, 4), text_cell(c.unit), money_cell(c.unit_cost_cents), money_cell(c.cost_cents)].join(","));
    }
    lines.push([text_cell(line.name), text_cell("Assembly total"), "", "", "", "", "", "", "", money_cell(line.cost_cents)].join(","));
  }
  for (const [label, key] of [["Subtotal", "subtotal_cents"], ["Markup", "markup_cents"], ["Tax", "tax_cents"], ["Total", "total_cents"]]) {
    lines.push([text_cell(label), "", "", "", "", "", "", "", "", money_cell(est[key])].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
