// Build only: reads src/data/printers.json, cleans it and adds derived values
// and brand colors. Rendering lives in format.mjs / render.mjs so the browser
// can use it too.

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

/** The public dataset: cleaned, with derived values, photo URLs, and numbers rounded. */
// 4 decimals: enough that the page's own 1-decimal display rounds the same as
// it does from the exact number (2 decimals turned 10.648 L into 10.65 → "10.7")
const round = (v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v);
export const toPublic = ({ name, image, ...p }) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => [k, round(v)]));
