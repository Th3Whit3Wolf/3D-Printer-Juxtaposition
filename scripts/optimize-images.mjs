#!/usr/bin/env node
// Normalizes every photo in src/assets/printers/ (square, trimmed, padded,
// ≤ 800 px WebP) and points src/data/printers.json at the new files.
// Already-normalized images are skipped, so re-running doesn't re-compress them.
//
//   npm run images            normalize anything that isn't yet
//   npm run images -- --force redo every image (lossy: only from good originals)
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeImage, isNormalized, describe } from "./lib/image.mjs";

const DIR = "src/assets/printers";
const DATA = "src/data/printers.json";
const force = process.argv.includes("--force");

const data = JSON.parse(await fs.readFile(DATA, "utf8"));
const files = (await fs.readdir(DIR)).filter((f) => /\.(jpe?g|png|webp|avif|gif|tiff?|heic)$/i.test(f));
let saved = 0, changed = 0;

for (const file of files) {
  const src = path.join(DIR, file);
  const input = await fs.readFile(src);
  if (!force && (await isNormalized(input))) continue;

  const { buffer, before, after } = await normalizeImage(input);
  const base = file.replace(/\.[^.]+$/, "");
  const outName = `${base}.webp`;
  await fs.writeFile(path.join(DIR, outName), buffer);
  if (outName !== file) await fs.rm(src);

  for (const p of data) if (p.image === file) p.image = outName;
  saved += before.bytes - after.bytes;
  changed++;
  console.log(`${file}: ${describe(before)} → ${describe(after)}`);
}

if (changed) {
  await fs.writeFile(DATA, JSON.stringify(data, null, 2) + "\n");
  console.log(`\n${changed} image(s) normalized, ${Math.round(saved / 1024)} KB saved.`);
} else {
  console.log("All images are already normalized.");
}
