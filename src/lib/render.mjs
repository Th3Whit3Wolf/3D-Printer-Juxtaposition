// HTML for the data-driven parts of the page: rows, filter chips, the plate
// legend. Plain template strings, so the build (baked-in page) and the browser
// (live page) produce identical markup. Every data value is escaped.
import { esc, fmt, SPECS } from "./format.mjs";
import { u } from "./units.mjs";
import { glyph } from "./geometry.mjs";

const initials = (s) => s.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const tags = (p) => [p.enclosed && "Enclosed", p.kinematics, p.materials > 1 && `${p.materials} colors`, p.technology !== "FDM" && p.technology].filter(Boolean);
const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${esc(v ?? "")}"`).join("");
const dot = (color) => `<span class="size-2 shrink-0 rounded-full" style="background:${esc(color)}"></span>`;

/** Filter values that depend on the data */
export function facets(printers) {
  const colors = new Map();
  for (const p of printers) if (!colors.has(p.brand)) colors.set(p.brand, p.color);
  return {
    brands: [...colors.keys()].sort((a, b) => a.localeCompare(b)).map((b) => [b, colors.get(b)]),
    technologies: [...new Set(printers.map((p) => p.technology))].sort(),
    maxPrice: Math.ceil(Math.max(0, ...printers.map((p) => p.price || 0)) / 50) * 50,
    maxSide: Math.ceil(Math.max(0, ...printers.map((p) => p.side)) / 10) * 10,
  };
}

export const byPrice = (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.name.localeCompare(b.name);

export const chipHtml = (name, value, color) =>
  `<label class="chip"><input type="checkbox" name="${name}" value="${esc(value)}" class="sr-only">${color ? dot(color) : ""}${esc(value)}</label>`;

export const legendHtml = (brands) => brands.map(([b, color]) => `<li class="flex items-center gap-1.5">${dot(color)}${esc(b)}</li>`).join("");

/**
 * One printer row.
 * @param p      a printer from the public dataset (with thumb/hero photo URLs)
 * @param scale  shared glyph scale for the whole list (geometry.glyphScale)
 */
export function rowHtml(p, scale) {
  const { x, y, z } = p.bv;
  const photo = p.thumb
    ? `<div class="grid size-13 place-items-center overflow-hidden rounded-xl bg-white md:size-14" data-thumb><img src="${esc(p.thumb)}" alt="" width="56" height="56" loading="lazy" decoding="async" class="size-full object-contain"></div>`
    : `<div class="grid size-13 place-items-center overflow-hidden rounded-xl bg-filament/16 md:size-14" data-thumb><span class="type-display text-sm text-filament" aria-hidden="true">${esc(initials(p.brand))}</span></div>`;

  const specs = SPECS.filter((s) => s.row !== false)
    .map((s) => {
      const text = s.text(p);
      if (!text) return "";
      const v = s.best ? s.v(p) : null;
      return `<div data-k="${s.k}"${v == null ? "" : ` data-v="${Math.round(v * 100) / 100}"`}><dt>${s.label}</dt><dd>${text}</dd></div>`;
    })
    .join("");

  const links = p.links?.length
    ? `<div class="mt-3 flex flex-wrap gap-2" data-links>${p.links
        .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer nofollow" class="btn-ink h-9 px-4 text-label">${esc(l.label)}</a>`)
        .join("")}</div>`
    : "";

  const ppl = p.pricePerL ? p.pricePerL.toFixed(2) : "";

  return `<article class="row relative border-b border-line last:border-b-0" style="--c:${esc(p.color)}"${attrs({
    "data-id": p.id,
    "data-name": `${p.name} ${p.technology} ${p.kinematics ?? ""}`.toLowerCase(),
    "data-brand": p.brand,
    "data-tech": p.technology,
    "data-motion": p.kinematics,
    "data-enclosed": p.enclosed ? "1" : "0",
    "data-materials": p.materials,
    "data-price": p.price,
    "data-ppl": ppl,
    "data-volume": p.volume.toFixed(2),
    "data-side": p.side,
    "data-bv": `${x},${y},${z}`,
    "data-speed": p.speed,
    "data-released": p.released,
    "data-hero": p.hero,
  })}>
<details><summary class="cols min-h-21 cursor-pointer py-3.5 pr-14 pl-4 transition-colors hover:bg-hover md:pr-4">
${photo}
<div class="min-w-0"><p class="flex items-center gap-1.5 truncate text-xs text-muted" data-brand-label><span class="size-2 shrink-0 rounded-full bg-filament"></span>${esc(p.brand)}</p><h3 class="truncate text-base font-semibold tracking-tight">${esc(p.model)}</h3><p class="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted"><span class="md:hidden">${u("len", p.side)} cube</span>${tags(p).map((t) => `<span>${esc(t)}</span>`).join("")}</p></div>
<p class="text-right type-display text-lead" data-k="price" data-v="${p.price ?? ""}">${fmt.price(p.price)}</p>
<p class="hidden text-right text-balance md:block" data-k="volume" data-v="${p.volume.toFixed(2)}"><span>${u("dims", [x, y, z])}</span><br><small>${u("vol", p.volume)}</small></p>
<div class="hidden items-center gap-2.5 md:flex">${glyph(p.bv, scale, "w-11 shrink-0")}<p class="whitespace-nowrap" data-k="cube" data-v="${p.side}"><span class="font-semibold">${u("len", p.side)}</span><br><small>${u("vol", p.cube)}</small></p></div>
<p class="hidden text-right md:block" data-k="ppl" data-v="${ppl}">${fmt.ppl(p.pricePerL)}</p>
<span class="hidden md:block"></span>
</summary>
<div class="px-4 pt-2 pb-5 md:pl-22"><dl class="specs grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl bg-hover p-4 sm:grid-cols-3 lg:grid-cols-4">${specs}</dl>${links}</div>
</details>
<label class="absolute top-0 right-2 grid h-21 w-10 cursor-pointer place-items-center md:right-4 md:w-11" title="Add to comparison"><input type="checkbox" value="${esc(p.id)}" data-compare class="peer sr-only"><span class="sr-only">Compare ${esc(p.name)}</span><span aria-hidden="true" class="peer-ring grid size-6 place-items-center rounded-lg border-[1.5px] border-line bg-card text-transparent transition-colors peer-checked:border-filament peer-checked:bg-filament peer-checked:text-white peer-disabled:opacity-35"><svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m3.5 8.5 3 3 6-7"/></svg></span></label>
</article>`;
}
