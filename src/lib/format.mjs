// Formatting and the spec list. Pure functions with no data inside, so both the
// build (baked-in page) and the browser (live page) can render with them.
import { u } from "./units.mjs";

export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---------- formatting ---------- */

const nf = (d, b) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d, ...(b ? { style: "currency", currency: "USD", maximumFractionDigits: d } : {}) });
const f0 = nf(0), f1 = nf(1), f2 =nf(2);
const usd = nf(0, 1)
const usd2 = nf(2, 1)

export const fmt = {
  price: (v) => (v ? usd.format(v) : "—"),
  ppl: (v) => (v ? u("ppv", v) : "—"),
  L: (v) => `${f1.format(v)} L`,
  mm: (v) => f2.format(v),
  dims: ({ x, y, z }) => `${f2.format(x)} × ${f2.format(y)} × ${f2.format(z)}`,
  int: (v) => f0.format(v),
};

/* ---------- specs ----------
 * One list drives the expanded row, the comparison table and the "best"
 * highlighting. `v` is the number used to find the best value; `best`
 * says whether lower or higher wins. `row: false` hides a spec in the
 * expanded row because the row already shows it. */

const yesNo = (b) => (b ? "Yes" : "No");

export const SPECS = [
  { k: "price", label: "Price", row: false, best: "min", v: (p) => p.price, text: (p) => fmt.price(p.price) },
  { k: "ppl", label: u("text", ["Price per litre", "Price per ft³"]), row: false, best: "min", v: (p) => p.pricePerL, text: (p) => fmt.ppl(p.pricePerL) },
  { k: "volume", label: "Build volume", row: false, best: "max", v: (p) => p.volume, text: (p) => `${u("dims", [p.bv.x, p.bv.y, p.bv.z])}<br><small>${u("vol", p.volume)}</small>` },
  { k: "cube", label: "Largest cube", row: false, best: "max", v: (p) => p.side, text: (p) => `${u("len", p.side)}<br><small>${u("vol", p.cube)}</small>` },
  { k: "tech", label: "Technology", text: (p) => esc(p.technology) },
  { k: "motion", label: "Motion system", text: (p) => p.kinematics && esc(p.kinematics) },
  { k: "enclosed", label: "Enclosed", text: (p) => yesNo(p.enclosed) },
  { k: "materials", label: "Colors / materials", best: "max", v: (p) => p.materials, text: (p) => (p.materials > 1 ? `Up to ${p.materials}` : "Single") },
  { k: "filaments", label: "Filaments (est.)", text: (p) => p.filaments && esc(p.filaments.join(", ")) },
  { k: "hotend", label: "Hotend max", best: "max", v: (p) => p.hotend, text: (p) => p.hotend && u("temp", p.hotend) },
  { k: "bed", label: "Bed max", best: "max", v: (p) => p.bed, text: (p) => p.bed && u("temp", p.bed) },
  { k: "speed", label: "Top speed (claimed)", best: "max", v: (p) => p.speed, text: (p) => p.speed && u("speed", p.speed) },
  { k: "footprint", label: "Footprint", best: "min", v: (p) => p.footprintL, text: (p) => p.footprint && u("dims", [p.footprint.w, p.footprint.d, p.footprint.h]) },
  { k: "efficiency", label: "Space efficiency", best: "max", v: (p) => p.efficiency, text: (p) => p.efficiency && `${f0.format(p.efficiency)}% of its box` },
  { k: "weight", label: "Weight", text: (p) => p.weight && u("mass", p.weight) },
  { k: "checked", label: "Price checked", text: (p) => p.priceUpdated && esc(p.priceUpdated) },
  { k: "released", label: "Released", best: "max", v: (p) => p.released, text: (p) => p.released && String(p.released) },
];
