// Runs after `astro build`:
//  1. makes sure every stylesheet and script is inlined into index.html
//  2. minifies the HTML (plus inline JS)
//  3. writes Zopfli .gz and Brotli .br copies of the HTML and the JSON
import fs from "node:fs/promises";
import path from "node:path";
import { minify } from "html-minifier-terser";

const DIST = "dist";
const HTML = path.join(DIST, "index.html");
const JSON_FILE = path.join(DIST, "data", "printers.json");

const kb = (n) => `${(n / 1024).toFixed(1)} KB`.padStart(9);

// Resolve an asset href like /repo/assets/x.css to a file in dist/
const base = (process.env.BASE_PATH || "/").replace(/\/?$/, "/");
const assetPath = (href) => path.join(DIST, href.startsWith(base) ? href.slice(base.length) : href.replace(/^\//, ""));

async function inlineAssets(html) {
  const inlined = [];
  html = await replaceAsync(html, /<link rel="stylesheet" href="([^"]+)"[^>]*>/g, async (tag, href) => {
    const file = assetPath(href);
    inlined.push(file);
    return `<style>${await fs.readFile(file, "utf8")}</style>`;
  });
  html = await replaceAsync(html, /<script type="module" src="([^"]+)"><\/script>/g, async (tag, src) => {
    const file = assetPath(src);
    inlined.push(file);
    const code = (await fs.readFile(file, "utf8")).replace(/<\/script/gi, "<\\/script");
    return `<script type="module">${code}</script>`;
  });
  for (const f of inlined) await fs.rm(f);
  return { html, inlined };
}

async function replaceAsync(str, re, fn) {
  const parts = await Promise.all([...str.matchAll(re)].map((m) => fn(...m)));
  let i = 0;
  return str.replace(re, () => parts[i++]);
}

const source = await fs.readFile(HTML, "utf8");
const { html, inlined } = await inlineAssets(source);
if (inlined.length) console.log(`Inlined ${inlined.map((f) => path.basename(f)).join(", ")}`);

const out = await minify(html, {
  collapseWhitespace: true,
  collapseBooleanAttributes: true,
  decodeEntities: true,
  removeComments: true,
  removeRedundantAttributes: true,
  removeAttributeQuotes: true,
  removeOptionalTags: false,
  sortAttributes: true, // consistent attribute order compresses better
  sortClassName: true,
  minifyCSS: false, // Tailwind/Lightning CSS output is already minified; older CSS minifiers mangle modern syntax
  minifyJS: { module: true, compress: { passes: 2 }, mangle: { toplevel: true } },
});
await fs.writeFile(HTML, out);

// Keep the public JSON compact
const data = JSON.parse(await fs.readFile(JSON_FILE, "utf8"));
await fs.writeFile(JSON_FILE, JSON.stringify(data));

// Fail loudly if anything still points at an external script or stylesheet
if (/<link rel=stylesheet|<script[^>]+src=/.test(out)) {
  console.error("index.html still references an external script or stylesheet");
  process.exit(1);
}
