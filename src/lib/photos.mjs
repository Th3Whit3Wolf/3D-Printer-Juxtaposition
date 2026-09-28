// Build only: finds each printer's photo in src/assets/printers/ and makes the
// two sizes the page uses. Matching ignores case, and a file named after the
// printer's id (bambu-lab-p1s.webp) is found even without "image".
import { getImage } from "astro:assets";

const files = import.meta.glob("../assets/printers/*", { eager: true, import: "default" });
const local = new Map(
  Object.entries(files)
    .filter(([path]) => /\.(jpe?g|png|webp|avif|gif|tiff?)$/i.test(path))
    .map(([path, meta]) => [path.split("/").pop().toLowerCase(), meta]),
);
const byStem = new Map([...local].map(([name, meta]) => [name.replace(/\.[^.]+$/, ""), meta]));

// Paths relative to the site root ("assets/x.webp"), so they work under any base path
const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
const rel = (src) => (src.startsWith(base) ? src.slice(base.length) : src.replace(/^\//, ""));

async function photoFor(p, missing) {
  const named = p.image && !/^https?:/i.test(p.image) ? p.image.split("/").pop().toLowerCase() : null;
  const meta = (named && local.get(named)) || byStem.get(p.id);
  if (meta) {
    const [thumb, hero] = await Promise.all([
      getImage({ src: meta, width: 112, height: 112, format: "webp", quality: 72 }),
      getImage({ src: meta, width: 320, height: 320, format: "webp", quality: 72 }),
    ]);
    return { thumb: rel(thumb.src), hero: rel(hero.src) };
  }
  if (/^https:\/\//i.test(p.image ?? "")) return { thumb: p.image, hero: p.image };
  if (p.image) missing.push(`${p.id}: "${p.image}" not found in src/assets/printers/`);
  return {};
}

let cache;
/** Printers with thumb/hero photo URLs (relative to the site root) */
export function withPhotos(printers) {
  cache ??= (async () => {
    const missing = [];
    const out = await Promise.all(printers.map(async (p) => ({ ...p, ...(await photoFor(p, missing)) })));
    if (missing.length) console.warn(`\n⚠ Printer photos not found:\n  ${missing.join("\n  ")}\n  Files there: ${[...local.keys()].join(", ") || "(none)"}\n`);
    return out;
  })();
  return cache;
}
