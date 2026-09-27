// Turns data/printers.json into everything the page renders.
// All derived numbers are computed here at build time, not in the browser.

import raw from "../data/printers.json";
import { cleanUrl, labelFor } from "./links.mjs";

const AMAZON_TAG = process.env.AMAZON_TAG || "";

const n = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const litres = (mm3) => mm3 / 1e6;

/** Rough filament compatibility from temperatures and enclosure (FDM only). */
function filaments(p) {
  if (p.technology !== "FDM" || !p.hotend || !p.bed) return null;
  const out = ["PLA"];
  if (p.hotend >= 250 && p.bed >= 70) out.push("PETG");
  if (p.enclosed && p.hotend >= 250 && p.bed >= 90) out.push("ABS/ASA");
  if (p.enclosed && p.hotend >= 290 && p.bed >= 100) out.push("PA/PC");
  return out;
}

function normalize(p) {
  const bv = p.build_volume || {};
  const x = n(bv.x), y = n(bv.y), z = n(bv.z);
  if (!p.id || !p.brand || !p.model || !x || !y || !z) return null;

  const fp = p.footprint || {};
  const footprint = n(fp.w) && n(fp.d) && n(fp.h) ? { w: fp.w, d: fp.d, h: fp.h } : null;
  const volume = litres(x * y * z);
  const side = Math.min(x, y, z);
  const price = n(p.price);

  const links = (Array.isArray(p.links) ? p.links : [])
    .map((l) => {
      const url = cleanUrl(l?.url, { amazonTag: AMAZON_TAG });
      return url && { label: (l.label || labelFor(url)).slice(0, 40), url };
    })
    .filter(Boolean);

  const q = {
    id: String(p.id),
    brand: String(p.brand),
    model: String(p.model),
    name: `${p.brand} ${p.model}`,
    price,
    priceUpdated: p.price_updated || null,
    technology: p.technology || "Other",
    kinematics: p.kinematics || null,
    enclosed: !!p.enclosed,
    materials: n(p.max_materials) ?? (p.multi_material ? 2 : 1),
    bv: { x, y, z },
    volume,
    side,
    cube: litres(side ** 3),
    pricePerL: price ? price / volume : null,
    footprint,
    footprintL: footprint ? litres(footprint.w * footprint.d * footprint.h) : null,
    weight: n(p.weight_kg),
    hotend: n(p.hotend_max_c),
    bed: n(p.bed_max_c),
    speed: n(p.max_speed_mm_s),
    released: n(p.released),
    image: p.image || null,
    links,
    added: p.added || "",
  };
  q.efficiency = q.footprintL ? (volume / q.footprintL) * 100 : null;
  q.filaments = filaments(q);
  return q;
}

const all = raw.map(normalize).filter(Boolean);

// Each brand gets a filament color, used for its wireframe, cube, dot and highlights.
const FILAMENTS = ["#ff7a1a", "#1fb5c7", "#e0457b", "#7bc043", "#8b6cf6", "#f2b705", "#3d7bf5", "#13a38b", "#f25c54", "#b5838d"];
export const brands = [...new Set(all.map((p) => p.brand))].sort((a, b) => a.localeCompare(b));
export const brandColor = Object.fromEntries(brands.map((b, i) => [b, FILAMENTS[i % FILAMENTS.length]]));
for (const p of all) p.color = brandColor[p.brand];

export const printers = all;

/* ---------- formatting ---------- */

const f0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const f1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const f2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = {
  price: (v) => (v ? usd.format(v) : "—"),
  ppl: (v) => (v ? usd2.format(v) : "—"),
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
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const SPECS = [
  { k: "price", label: "Price", row: false, best: "min", v: (p) => p.price, text: (p) => fmt.price(p.price) + (p.priceUpdated ? ` <small>as of ${esc(p.priceUpdated)}</small>` : "") },
  { k: "ppl", label: "Price per litre", row: false, best: "min", v: (p) => p.pricePerL, text: (p) => fmt.ppl(p.pricePerL) },
  { k: "volume", label: "Build volume", row: false, best: "max", v: (p) => p.volume, text: (p) => `${fmt.dims(p.bv)} mm<br><small>${fmt.L(p.volume)}</small>` },
  { k: "cube", label: "Largest cube", row: false, best: "max", v: (p) => p.side, text: (p) => `${fmt.mm(p.side)} mm<br><small>${fmt.L(p.cube)}</small>` },
  { k: "tech", label: "Technology", text: (p) => esc(p.technology) },
  { k: "motion", label: "Motion system", text: (p) => p.kinematics && esc(p.kinematics) },
  { k: "enclosed", label: "Enclosed", text: (p) => yesNo(p.enclosed) },
  { k: "materials", label: "Colors / materials", best: "max", v: (p) => p.materials, text: (p) => (p.materials > 1 ? `Up to ${p.materials}` : "Single") },
  { k: "filaments", label: "Filaments (est.)", text: (p) => p.filaments && esc(p.filaments.join(", ")) },
  { k: "hotend", label: "Hotend max", best: "max", v: (p) => p.hotend, text: (p) => p.hotend && `${p.hotend} °C` },
  { k: "bed", label: "Bed max", best: "max", v: (p) => p.bed, text: (p) => p.bed && `${p.bed} °C` },
  { k: "speed", label: "Top speed (claimed)", best: "max", v: (p) => p.speed, text: (p) => p.speed && `${fmt.int(p.speed)} mm/s` },
  { k: "footprint", label: "Footprint", best: "min", v: (p) => p.footprintL, text: (p) => p.footprint && `${fmt.dims({ x: p.footprint.w, y: p.footprint.d, z: p.footprint.h })} mm` },
  { k: "efficiency", label: "Space efficiency", best: "max", v: (p) => p.efficiency, text: (p) => p.efficiency && `${f0.format(p.efficiency)}% of its box` },
  { k: "weight", label: "Weight", text: (p) => p.weight && `${f1.format(p.weight)} kg` },
  { k: "released", label: "Released", best: "max", v: (p) => p.released, text: (p) => p.released && String(p.released) },
];

/* ---------- isometric geometry ---------- */

const COS30 = Math.cos(Math.PI / 6);
const r1 = (v) => Math.round(v * 10) / 10;

// Paths for the three visible faces of a box (top, right = +x, left = +y)
function faces(P, x0, y0, x1, y1, z1) {
  const q = (pts) => "M" + pts.map((p) => P(...p)).join("L") + "Z";
  return [
    q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]),
    q([[x1, y0, 0], [x1, y1, 0], [x1, y1, z1], [x1, y0, z1]]),
    q([[x0, y1, 0], [x1, y1, 0], [x1, y1, z1], [x0, y1, z1]]),
  ];
}

// All 12 edges of a box as one path
function edges(P, x0, y0, x1, y1, z1) {
  const c = (x, y, z) => P(x, y, z);
  const seg = (a, b) => `M${c(...a)}L${c(...b)}`;
  const B = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  let d = "";
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = B[i], [bx, by] = B[(i + 1) % 4];
    d += seg([ax, ay, 0], [bx, by, 0]) + seg([ax, ay, z1], [bx, by, z1]) + seg([ax, ay, 0], [ax, ay, z1]);
  }
  return d;
}

/* Small per-row glyph: build volume outline with the largest cube inside.
   Every glyph shares one scale so sizes compare at a glance. */
const GW = 64, GH = 58, PAD = 2;
const glyphScale = (() => {
  let w = 1, h = 1;
  for (const { bv } of all) {
    w = Math.max(w, (bv.x + bv.y) * COS30);
    h = Math.max(h, (bv.x + bv.y) / 2 + bv.z);
  }
  return Math.min((GW - 2 * PAD) / w, (GH - 2 * PAD) / h);
})();

export function glyph(p, cls = "") {
  const { x: X, y: Y, z: Z } = p.bv;
  const s = p.side, k = glyphScale;
  const ox = (GW - (X + Y) * COS30 * k) / 2 + Y * COS30 * k;
  const oy = GH - PAD - ((X + Y) / 2) * k;
  const P = (x, y, z) => `${r1(ox + (x - y) * COS30 * k)} ${r1(oy + ((x + y) / 2 - z) * k)}`;
  const [t, r, l] = faces(P, X - s, Y - s, X, Y, s);
  return `<svg viewBox="0 0 ${GW} ${GH}" class="glyph ${cls}" aria-hidden="true"><path class="g-box" d="${faces(P, 0, 0, X, Y, Z).join("")}"/><path class="g-t" d="${t}"/><path class="g-r" d="${r}"/><path class="g-l" d="${l}"/></svg>`;
}

/* The build plate: every build volume nested on one plate, to scale,
   anchored at the front corner. Grid lines every 50 mm. */
export function plate() {
  const maxXY = Math.max(...all.map((p) => Math.max(p.bv.x, p.bv.y)));
  const maxZ = Math.max(...all.map((p) => p.bv.z));
  const S = Math.ceil((maxXY + 60) / 50) * 50; // plate size, mm
  const F = S - 30; // front anchor corner, mm
  const W = 440;
  const k = W / (2 * S * COS30);
  const H = Math.ceil((S + maxZ) * k + 24);
  const ox = W / 2, oy = H - S * k - 8;
  const P = (x, y, z) => `${r1(ox + (x - y) * COS30 * k)} ${r1(oy + ((x + y) / 2 - z) * k)}`;

  let grid = "";
  for (let g = 0; g <= S; g += 50) grid += `M${P(g, 0, 0)}L${P(g, S, 0)}M${P(0, g, 0)}L${P(S, g, 0)}`;
  const plateFace = `M${P(0, 0, 0)}L${P(S, 0, 0)}L${P(S, S, 0)}L${P(0, S, 0)}Z`;

  // Largest volumes first so small ones sit on top
  const order = [...all].sort((a, b) => b.volume - a.volume);
  const vols = order.map((p, i) => {
    const { x, y, z } = p.bv;
    const x0 = F - x, y0 = F - y, s = p.side;
    const [t, r, l] = faces(P, F - s, F - s, F, F, s);
    const [bt, br, bl] = faces(P, x0, y0, F, F, z);
    return `<g class="vol" data-id="${p.id}" style="--c:${p.color};--i:${i}"><path class="v-fill" d="${bt}${br}${bl}"/><path class="v-edge" pathLength="1" d="${edges(P, x0, y0, F, F, z)}"/><g class="v-cube"><path class="g-t" d="${t}"/><path class="g-r" d="${r}"/><path class="g-l" d="${l}"/></g></g>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="plate w-full" role="img" aria-label="Build volumes of all printers drawn to the same scale"><path class="p-face" d="${plateFace}"/><path class="p-grid" d="${grid}"/>${vols.join("")}</svg>`;
}

export const technologies = [...new Set(printers.map((p) => p.technology))].sort();
export const maxPrice = Math.ceil(Math.max(0, ...printers.map((p) => p.price || 0)) / 50) * 50;
export const maxSide = Math.ceil(Math.max(0, ...printers.map((p) => p.side)) / 10) * 10;

/** Public, cleaned copy of the data for data/printers.json in the build output. */
const round = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
export const publicData = printers.map(({ name, ...p }) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => [k, round(v)])),
);
