// Runs after `astro build`:
//  1. makes sure every stylesheet and script is inlined into each page, and
//     bundles scripts that import shared chunks (both pages share app.js,
//     so the bundler splits it out) into one self-contained script
//     Pages marked <body data-js="external"> (the live page) get their script
//     as a separate file instead, loaded from <head> in parallel with the data
//  2. minifies the HTML (plus inline JS)
import fs from "node:fs/promises";
import path from "node:path";
import { minify } from "html-minifier-terser";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { minify as terser } from "terser";

const DIST = "dist";
const JSON_FILE = path.join(DIST, "data", "printers.json");

const kb = (n) => `${(n / 1024).toFixed(1)} KB`.padStart(9);

// Resolve an asset href like /repo/assets/x.css to a file in dist/
const base = (process.env.BASE_PATH || "/").replace(/\/?$/, "/");
const assetPath = (href) => path.join(DIST, href.startsWith(base) ? href.slice(base.length) : href.replace(/^\//, ""));

async function inlineAssets(html, inlined = []) {
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
  return { html, inlined };
}

// Inline scripts that import a shared chunk ("./app.X.js") get bundled with it
async function bundleInlineModules(html, used) {
  return replaceAsync(html, /<script type="module">([\s\S]*?)<\/script>/g, async (tag, code) => {
    if (!/(^|[;\s}])import\s*[\w{*"']/.test(code)) return tag; // already self-contained
    const result = await build({
      stdin: { contents: code, resolveDir: path.join(DIST, "assets"), loader: "js" },
      bundle: true,
      write: false,
      metafile: true,
      format: "esm",
      target: "es2022",
      minify: true,
      logLevel: "silent",
    });
    for (const input of Object.keys(result.metafile.inputs)) if (!input.startsWith("<stdin>")) used.push(path.resolve(input));
    return `<script type="module">${result.outputFiles[0].text.trim().replace(/<\/script/gi, "<\\/script")}</script>`;
  });
}

// Live page: the data costs a second round trip anyway, so the script rides along
// in that one instead of weighing down the first. Moves the (already bundled)
// module script to assets/<name>.<hash>.js and loads it from <head>.
async function externalizeModules(html, file) {
  if (!/<body[^>]*data-js="external"/.test(html)) return html;
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  if (!scripts.length) return html;
  const bundled = scripts.map((m) => m[1].replace(/<\\\/script/gi, "</script")).join("\n");
  // Same minification the inline scripts get from html-minifier
  const { code } = await terser(bundled, { module: true, compress: { passes: 2 }, mangle: { toplevel: true } });
  const name = `${path.basename(path.dirname(file)) || "page"}.${createHash("sha256").update(code).digest("hex").slice(0, 8)}.js`;
  await fs.mkdir(path.join(DIST, "assets"), { recursive: true });
  await fs.writeFile(path.join(DIST, "assets", name), code);
  const rel = path.relative(path.dirname(file), DIST).split(path.sep).join("/");
  const src = `${rel ? rel + "/" : ""}assets/${name}`;
  for (const m of scripts) html = html.replace(m[0], "");
  console.log(`  script moved to assets/${name} (${(code.length / 1024).toFixed(1)} KB)`);
  return html.replace("</head>", `<script type="module" src="${src}"></script></head>`);
}

async function replaceAsync(str, re, fn) {
  const parts = await Promise.all([...str.matchAll(re)].map((m) => fn(...m)));
  let i = 0;
  return str.replace(re, () => parts[i++]);
}

// Every page: index.html and live/index.html
const pages = (await fs.readdir(DIST, { recursive: true })).filter((f) => f.endsWith(".html")).map((f) => path.join(DIST, f));
const inlinedFiles = [];

for (const file of pages) {
  const { html: withAssets } = await inlineAssets(await fs.readFile(file, "utf8"), inlinedFiles);
  const html = await externalizeModules(await bundleInlineModules(withAssets, inlinedFiles), file);
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
  await fs.writeFile(file, out);
  console.log(`${kb(out.length)}  ${path.relative(DIST, file)}`);

  // Fail loudly if anything still points at an external script or stylesheet
  const external = /<body[^>]*data-js=external/.test(out);
  if (/<link rel=stylesheet/.test(out) || (!external && /<script[^>]+src=/.test(out))) {
    console.error(`${path.relative(DIST, file)} still references an external script or stylesheet`);
    process.exit(1);
  }
}
for (const f of new Set(inlinedFiles)) await fs.rm(f, { force: true });

// Keep the public JSON compact
const data = JSON.parse(await fs.readFile(JSON_FILE, "utf8"));
await fs.writeFile(JSON_FILE, JSON.stringify(data));
console.log(`${kb(JSON.stringify(data).length)}  data/printers.json`);
