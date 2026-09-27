#!/usr/bin/env node
// Reads an "Add or update a 3D printer" issue form (ISSUE_BODY) and writes the
// printer into data/printers.json. Run by .github/workflows/printer-from-issue.yml.
//
// Outputs (GITHUB_OUTPUT): ok=true|false, title=<PR title>
// Files ($RUNNER_TEMP):    pr-body.md on success, issue-comment.md on failure

import fs from "node:fs/promises";
import path from "node:path";

const DATA_FILE = "data/printers.json";
const IMAGE_DIR = "images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
const TECHNOLOGIES = ["FDM", "Resin (MSLA)", "SLS", "Other"];

// Must match the `label:` values in .github/ISSUE_TEMPLATE/add-printer.yml
const FIELDS = {
  brand: "Brand",
  model: "Model",
  price: "Price (USD)",
  x: "Build volume X (mm)",
  y: "Build volume Y (mm)",
  z: "Build volume Z (mm)",
  technology: "Technology",
  features: "Features",
  image: "Product image",
  links: "Where to buy",
};

const TMP = process.env.RUNNER_TEMP || "/tmp";

// ---------- parsing ----------

export function parseIssueForm(markdown) {
  const out = {};
  const sections = String(markdown).replace(/\r\n/g, "\n").split(/^###\s+/m).slice(1);
  for (const section of sections) {
    const nl = section.indexOf("\n");
    const label = (nl === -1 ? section : section.slice(0, nl)).trim();
    let value = nl === -1 ? "" : section.slice(nl + 1).trim();
    if (value === "_No response_") value = "";
    out[label] = value;
  }
  return out;
}

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export function parseNumber(s) {
  const t = String(s ?? "").replace(/[$,\s]|usd|mm/gi, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function slugify(s) {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function labelFromUrl(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (/(^|\.)amazon\./.test(host) || host === "amzn.to") return "Amazon";
  if (/(^|\.)aliexpress\./.test(host)) return "AliExpress";
  if (/(^|\.)ebay\./.test(host)) return "eBay";
  return host;
}

export function parseLinks(text) {
  const links = [];
  const bad = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim().replace(/^[-*]\s+/, "");
    if (!line) continue;
    let label = "";
    let url = "";
    let m;
    if ((m = line.match(/^\[([^\]]+)\]\((\S+)\)$/))) [, label, url] = m; // [Label](url)
    else if ((m = line.match(/^(.*?)\s*\|\s*(\S+)$/))) [, label, url] = m; // Label | url
    else url = line;
    url = url.replace(/^<|>$/g, "");
    if (!isHttpUrl(url)) {
      bad.push(line);
      continue;
    }
    label = clean(label).slice(0, 40) || labelFromUrl(url);
    if (!links.some((l) => l.url === url)) links.push({ label, url });
  }
  return { links, bad };
}

export function extractImageUrl(text) {
  const t = String(text ?? "");
  const m =
    t.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)/) || // ![alt](url)  (drag-and-drop uploads)
    t.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i) || // <img src="url">
    t.match(/(https?:\/\/\S+)/); // bare url
  return m ? m[1] : null;
}

function checked(featuresText, label) {
  const re = new RegExp(`^- \\[x\\]\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "im");
  return re.test(featuresText || "");
}

// ---------- image download ----------

async function downloadImage(url, id) {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "printer-compare-bot" } });
  if (!res.ok) throw new Error(`the server answered HTTP ${res.status}`);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new Error(`it isn't a JPEG, PNG, WebP, GIF or AVIF image (got ${type || "no content type"})`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error("it's larger than 5 MB");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("it's larger than 5 MB");

  await fs.mkdir(IMAGE_DIR, { recursive: true });
  // Remove an older image for this printer saved with a different extension
  for (const f of await fs.readdir(IMAGE_DIR)) {
    if (f.startsWith(`${id}.`) && f !== `${id}.${ext}`) await fs.rm(path.join(IMAGE_DIR, f));
  }
  const file = `${IMAGE_DIR}/${id}.${ext}`;
  await fs.writeFile(file, buf);
  return file;
}

// ---------- outputs ----------

async function setOutput(name, value) {
  const line = `${name}=${String(value).replace(/[\r\n]+/g, " ")}\n`;
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}

async function fail(errors) {
  const body = [
    "I couldn't turn this issue into a pull request yet:",
    "",
    ...errors.map((e) => `- ${e}`),
    "",
    "Edit the issue to fix these and I'll try again automatically.",
  ].join("\n");
  await fs.writeFile(path.join(TMP, "issue-comment.md"), body);
  await setOutput("ok", "false");
  console.log(body);
}

const mdCell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

// ---------- main ----------

async function main() {
  const issue = process.env.ISSUE_NUMBER || "";
  const author = process.env.ISSUE_AUTHOR || "";
  const form = parseIssueForm(process.env.ISSUE_BODY || "");
  const errors = [];
  const notes = [];

  const brand = clean(form[FIELDS.brand]).slice(0, 60);
  const model = clean(form[FIELDS.model]).slice(0, 80);
  if (!brand) errors.push("**Brand** is empty.");
  if (!model) errors.push("**Model** is empty.");

  const price = parseNumber(form[FIELDS.price]);
  if (price == null || price <= 0 || price > 100000) errors.push("**Price (USD)** should be a number, like `699` or `1299.99`.");

  const dims = {};
  for (const axis of ["x", "y", "z"]) {
    const n = parseNumber(form[FIELDS[axis]]);
    if (n == null || n <= 0 || n > 5000) errors.push(`**${FIELDS[axis]}** should be a number of millimetres, like \`256\`.`);
    dims[axis] = n;
  }

  let technology = clean(form[FIELDS.technology]);
  if (!TECHNOLOGIES.includes(technology)) technology = "Other";

  const enclosed = checked(form[FIELDS.features], "Enclosed build chamber");
  const multi_material = checked(form[FIELDS.features], "Multi-material or multi-color printing");

  const { links, bad } = parseLinks(form[FIELDS.links]);
  for (const line of bad) errors.push(`**Where to buy**: \`${line.slice(0, 120)}\` isn't a web address starting with https://`);
  if (!links.length && !bad.length) errors.push("**Where to buy** needs at least one link.");

  const id = slugify(`${brand} ${model}`);
  if (brand && model && !id) errors.push("**Brand** and **Model** need at least some letters or numbers.");

  if (errors.length) return fail(errors);

  const data = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const index = data.findIndex((p) => p.id === id);
  const existing = index >= 0 ? data[index] : null;

  let image = existing?.image ?? null;
  const imageUrl = extractImageUrl(form[FIELDS.image]);
  if (imageUrl) {
    try {
      image = await downloadImage(imageUrl, id);
    } catch (err) {
      notes.push(`Couldn't copy the image into the repo because ${err.message}. The page links to it directly instead; swap in a local copy if it stops loading.`);
      image = imageUrl;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const printer = {
    id,
    brand,
    model,
    price,
    price_updated: today,
    technology,
    enclosed,
    multi_material,
    build_volume: { x: dims.x, y: dims.y, z: dims.z },
    ...(image ? { image } : {}),
    links,
    added: existing?.added ?? today,
    ...(Number(issue) ? { source_issue: Number(issue) } : {}),
  };

  if (existing) data[index] = printer;
  else data.push(printer);
  data.sort((a, b) => a.brand.localeCompare(b.brand, "en", { sensitivity: "base" }) || a.model.localeCompare(b.model, "en", { sensitivity: "base", numeric: true }));
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n");

  const verb = existing ? "Update" : "Add";
  const title = `${verb} ${brand} ${model}`;
  const side = Math.min(dims.x, dims.y, dims.z);
  const litres = (n) => `${(n / 1e6).toFixed(1)} L`;

  const body = [
    `${existing ? "Updates" : "Adds"} **${brand} ${model}** from #${issue}${author ? ` (submitted by @${author})` : ""}.`,
    "",
    "| | |",
    "|---|---|",
    `| Price | $${price} |`,
    `| Build volume | ${dims.x} × ${dims.y} × ${dims.z} mm (${litres(dims.x * dims.y * dims.z)}) |`,
    `| Largest cube | ${side} mm per side (${litres(side ** 3)}) |`,
    `| Technology | ${mdCell(technology)} |`,
    `| Enclosed | ${enclosed ? "Yes" : "No"} |`,
    `| Multi-material | ${multi_material ? "Yes" : "No"} |`,
    `| Links | ${links.map((l) => `[${mdCell(l.label).replace(/[[\]]/g, "")}](${l.url})`).join(", ")} |`,
    "",
    ...(imageUrl ? [`<img src="${imageUrl.replace(/"/g, "%22")}" alt="" width="280">`, ""] : []),
    ...(notes.length ? ["**Notes**", ...notes.map((n) => `- ${n}`), ""] : []),
    "Check the details against the manufacturer's page before merging.",
    "",
    `Closes #${issue}`,
  ].join("\n");

  await fs.writeFile(path.join(TMP, "pr-body.md"), body);
  await setOutput("ok", "true");
  await setOutput("title", title);
  console.log(body);
}

// Run only when executed directly (lets the helpers be imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(err);
    await fail([`Something went wrong on my side: \`${String(err.message).slice(0, 200)}\`. A maintainer will take a look.`]);
  });
}
