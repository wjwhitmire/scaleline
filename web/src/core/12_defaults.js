// Starting layers, assemblies and tool chest presets. Prices are placeholders for the example
// and are labeled as such in the app; every value is editable.
const DEFAULT_LAYERS = [
  { id: "walls", name: "Walls", visible: true, locked: false, assembly: "int-partition" },
  { id: "floors", name: "Floors", visible: true, locked: false },
  { id: "roof", name: "Roof", visible: true, locked: false, assembly: "roofing" },
  { id: "site", name: "Site", visible: true, locked: false },
  { id: "openings", name: "Doors and windows", visible: true, locked: false },
  { id: "electrical", name: "Electrical", visible: true, locked: false },
  { id: "notes", name: "Notes and markups", visible: true, locked: false },
  { id: "revisions", name: "Revision changes", visible: true, locked: false },
];
const DEFAULT_ASSEMBLIES = [
  { id: "int-partition", name: "Interior partition, 3-5/8 in steel stud, 5/8 in board both sides", components: [
    { name: "Gypsum board 4x8, 5/8 in", source: "wall_area", source_unit: "sf", factor: 2, waste_pct: 10, pack: 32, unit: "sheet", unit_cost_cents: 1450 },
    { name: "Steel studs, 16 in o.c.", source: "length", source_unit: "ft", factor: 0.75, per_each: 1, waste_pct: 5, pack: 1, unit: "ea", unit_cost_cents: 589 },
    { name: "Track, top and bottom", source: "length", source_unit: "ft", factor: 2, waste_pct: 5, pack: 10, unit: "10 ft stick", unit_cost_cents: 799 },
    { name: "Hang, tape and finish", source: "wall_area", source_unit: "sf", factor: 0.04, unit: "hr", unit_cost_cents: 6500 },
  ] },
  { id: "ext-wall", name: "Exterior wall, 2x6 at 16 in o.c., sheathing and wrap", components: [
    { name: "Studs 2x6", source: "length", source_unit: "ft", factor: 0.75, per_each: 1, waste_pct: 10, pack: 1, unit: "ea", unit_cost_cents: 845 },
    { name: "Plates 2x6 (three)", source: "length", source_unit: "ft", factor: 3, waste_pct: 10, pack: 16, unit: "16 ft board", unit_cost_cents: 1690 },
    { name: "OSB sheathing 7/16 in", source: "wall_area", source_unit: "sf", factor: 1, waste_pct: 8, pack: 32, unit: "sheet", unit_cost_cents: 1795 },
    { name: "House wrap", source: "wall_area", source_unit: "sf", factor: 1, waste_pct: 10, pack: 1000, unit: "roll", unit_cost_cents: 18900 },
  ] },
  { id: "slab", name: "Slab on grade with mesh and vapor barrier", components: [
    { name: "Concrete 3000 psi", source: "volume", source_unit: "cy", factor: 1, waste_pct: 5, pack: 0.5, unit: "half yard", unit_cost_cents: 8250 },
    { name: "Welded wire mesh", source: "area", source_unit: "sf", factor: 1, waste_pct: 10, pack: 750, unit: "roll", unit_cost_cents: 21500 },
    { name: "Vapor barrier 10 mil", source: "area", source_unit: "sf", factor: 1, waste_pct: 10, pack: 1000, unit: "roll", unit_cost_cents: 14900 },
    { name: "Place and finish", source: "area", source_unit: "sf", factor: 0.012, unit: "hr", unit_cost_cents: 5800 },
  ] },
  { id: "flooring", name: "Resilient flooring", components: [
    { name: "Vinyl plank", source: "area", source_unit: "sf", factor: 1, waste_pct: 10, pack: 24, unit: "carton", unit_cost_cents: 6480 },
    { name: "Base, 4 in", source: "perimeter", source_unit: "ft", factor: 1, waste_pct: 10, pack: 120, unit: "roll", unit_cost_cents: 7400 },
  ] },
  { id: "roofing", name: "Asphalt shingle roof", components: [
    { name: "Shingles (3 bundles per square)", source: "area", source_unit: "sf", factor: 1, waste_pct: 12, pack: 33.3, unit: "bundle", unit_cost_cents: 4200 },
    { name: "Underlayment", source: "area", source_unit: "sf", factor: 1, waste_pct: 10, pack: 1000, unit: "roll", unit_cost_cents: 12900 },
    { name: "Drip edge", source: "perimeter", source_unit: "ft", factor: 1, waste_pct: 5, pack: 10, unit: "10 ft piece", unit_cost_cents: 1100 },
  ] },
  { id: "doors", name: "Interior door, prehung, with hardware", components: [
    { name: "Prehung door", source: "count", factor: 1, pack: 1, unit: "ea", unit_cost_cents: 18900 },
    { name: "Lever set", source: "count", factor: 1, pack: 1, unit: "ea", unit_cost_cents: 3900 },
    { name: "Install", source: "count", factor: 1.5, unit: "hr", unit_cost_cents: 6500 },
  ] },
  { id: "outlets", name: "Duplex receptacle", components: [
    { name: "Receptacle, box, plate", source: "count", factor: 1, pack: 1, unit: "ea", unit_cost_cents: 1250 },
    { name: "Rough and trim", source: "count", factor: 0.6, unit: "hr", unit_cost_cents: 9500 },
  ] },
  { id: "sidewalk", name: "Concrete sidewalk, 4 in", components: [
    { name: "Concrete 3000 psi", source: "volume", source_unit: "cy", factor: 1, waste_pct: 8, pack: 0.5, unit: "half yard", unit_cost_cents: 8250 },
    { name: "Forming and finishing", source: "area", source_unit: "sf", factor: 0.03, unit: "hr", unit_cost_cents: 5800 },
  ] },
];
// Tool chest presets: a tool with saved properties. Picking one arms the tool with them. Colors are
// named from the pencil set (the markup colors on the sheet); the interface turns a name into its
// value, so a preset never carries a color of its own unless the person picks one. Count presets
// carry a glyph shape so counts read apart without color.
const PENCILS = ["m-cobalt", "m-viridian", "m-amber", "m-plum", "m-redline", "m-sky", "m-graphite"];
const DEFAULT_PRESETS = [
  { id: "p-int-wall", name: "Interior wall, 9 ft", tool: "polylength", subject: "Interior wall", layer: "walls", pencil: "m-cobalt", width: 3, height: 108, assembly: "int-partition" },
  { id: "p-ext-wall", name: "Exterior wall, 9 ft", tool: "polylength", subject: "Exterior wall", layer: "walls", pencil: "m-plum", width: 4, height: 108, assembly: "ext-wall" },
  { id: "p-slab", name: "Slab on grade, 4 in", tool: "volume", subject: "Slab", layer: "floors", pencil: "m-plum", opacity: 0.3, depth: 4, assembly: "slab" },
  { id: "p-floor", name: "Resilient flooring", tool: "area", subject: "Flooring", layer: "floors", pencil: "m-viridian", opacity: 0.3, assembly: "flooring" },
  { id: "p-roof", name: "Roof, 6 in 12", tool: "area", subject: "Roofing", layer: "roof", pencil: "m-amber", opacity: 0.3, pitch: 6, assembly: "roofing" },
  { id: "p-door", name: "Interior doors", tool: "count", subject: "Interior door", layer: "openings", pencil: "m-amber", glyph: "diamond", assembly: "doors" },
  { id: "p-outlet", name: "Duplex receptacles", tool: "count", subject: "Receptacle", layer: "electrical", pencil: "m-amber", glyph: "circle", assembly: "outlets" },
  { id: "p-walk", name: "Sidewalk, 4 in", tool: "volume", subject: "Sidewalk", layer: "site", pencil: "m-graphite", opacity: 0.3, depth: 4, assembly: "sidewalk" },
  { id: "p-cloud", name: "Revision cloud", tool: "cloud", subject: "Revision", layer: "revisions", pencil: "m-redline", width: 1.6 },
  { id: "p-rfi", name: "RFI callout", tool: "callout", subject: "RFI", layer: "notes", pencil: "m-graphite", text: "RFI: " },
  { id: "p-approved", name: "Approved stamp", tool: "stamp", subject: "Stamp", layer: "notes", pencil: "m-viridian", text: "APPROVED" },
  { id: "p-rejected", name: "Not approved stamp", tool: "stamp", subject: "Stamp", layer: "notes", pencil: "m-redline", text: "NOT APPROVED" },
];
// Which assembly a new measurement gets, and why: a preset wins over its layer.
function resolve_assembly(tool, preset, layer) {
  if (!MEASURE_TYPES.includes(tool)) return null;
  if (preset && preset.assembly) return { assembly: preset.assembly, source: "preset" };
  if (layer && layer.assembly) return { assembly: layer.assembly, source: "layer" };
  return null;
}
