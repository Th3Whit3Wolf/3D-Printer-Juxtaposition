#!/usr/bin/env node
// Reads an "Add or update a 3D printer" issue form (ISSUE_BODY) and writes the
// printer into src/data/printers.json. Run by .github/workflows/printer-from-issue.yml.
//
// Outputs (GITHUB_OUTPUT): ok=true|false, title=<PR title>
// Files ($RUNNER_TEMP):    pr-body.md on success, issue-comment.md on failure

import fs from "node:fs/promises";
import path from "node:path";
import { cleanUrl, labelFor, isAmazonShortHost } from "../src/lib/links.mjs";
import { normalizeImage, describe } from "./lib/image.mjs";

const DATA_FILE = "src/data/printers.json";
const IMAGE_DIR = "src/assets/printers";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // before optimization
const TECHNOLOGIES = ["FDM", "Resin (MSLA)", "SLS", "Other"];
const KINEMATICS = ["CoreXY", "Bed slinger", "Delta", "IDEX", "Other"];
const TMP = process.env.RUNNER_TEMP || "/tmp";

// Must match the `label:` values in .github/ISSUE_TEMPLATE/add-printer.yml
const F = {
  brand: "Brand",
  model: "Model",
  price: "Price (USD)",
  x: "Build volume X",
  y: "Build volume Y",
  z: "Build volume Z",
  technology: "Technology",
  links: "Where to buy",
  kinematics: "Motion system",
  features: "Features",
  materials: "Colors or materials in one print",
  hotend: "Hotend max temperature",
  bed: "Bed max temperature",
  speed: "Claimed top speed",
  footprint: "Machine size W × D × H",
  weight: "Weight",
  released: "Release year",
  image: "Product image",
};

// ---------- parsing ----------

export function parseIssueForm(markdown) {
  const out = {};
  const sections = String(markdown).replace(/\r\n/g, "\n").split(/^###\s+/m).slice(1);
  for (const section of sections) {
    const nl = section.indexOf("\n");
    const label = (nl === -1 ? section : section.slice(0, nl)).trim();
    let value = nl === -1 ? "" : section.slice(nl + 1).trim();
    if (value === "_No response_" || value === "None") value = "";
    out[label] = value;
  }
  return out;
}

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export function parseNumber(s) {
  const t = String(s ?? "").replace(/[$,\s]|usd|mm\/s|mm|kg|°c|c$/gi, "");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

// Measurements may be typed in metric or US units; everything is stored metric.
//   length: "256", "256 mm", "10.1 in", "10.1\""     -> mm
//   temp:   "300", "300 °C", "572 F", "572°F"      -> °C
//   speed:  "500", "500 mm/s", "19.7 in/s"         -> mm/s
//   mass:   "12.5", "12.5 kg", "27.5 lb"           -> kg
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const INCH = /(\d)\s*("|”|″|in\b|inch|inches)/i;
export function parseMeasure(text, kind) {
  const t = String(text ?? "").trim();
  const v = parseNumber(t.replace(/[a-z°"”″/]+/gi, " "));
  if (v == null) return null;
  if (kind === "length") return INCH.test(t) ? round(v * 25.4, 1) : v;
  if (kind === "speed") return /in\s*\/\s*s|ips/i.test(t) ? round(v * 25.4, 0) : v;
  if (kind === "temp") return /(\d|°)\s*f\b/i.test(t) ? round(((v - 32) * 5) / 9, 0) : v;
  if (kind === "mass") return /lbs?\b|pounds?/i.test(t) ? round(v / 2.20462, 2) : v;
  return v;
}

export function parseDims(s) {
  const t = String(s ?? "");
  const parts = t.match(/\d+(\.\d+)?/g);
  if (parts?.length !== 3) return null;
  const inches = INCH.test(t) || /\bin(ches)?\b/i.test(t);
  return parts.map((p) => (inches ? round(Number(p) * 25.4, 1) : Number(p)));
}

export function slugify(s) {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Follows amzn.to / a.co redirects so the stored link is the clean /dp/ASIN form
async function expandShortLink(url) {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const host = new URL(current).hostname;
    if (!isAmazonShortHost(host)) return current;
    try {
      const res = await fetch(current, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 printer-compare-bot" } });
      const next = res.headers.get("location");
      if (!next) return current;
      current = new URL(next, current).href;
    } catch {
      return current;
    }
  }
  return current;
}

export async function parseLinks(text) {
  const links = [];
  const bad = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim().replace(/^[-*]\s+/, "");
    if (!line) continue;
    let label = "";
    let url = "";
    let m;
    if ((m = line.match(/^\[([^\]]+)\]\((\S+)\)$/))) [, label, url] = m;
    else if ((m = line.match(/^(.*?)\s*\|\s*(\S+)$/))) [, label, url] = m;
    else url = line;
    url = url.replace(/^<|>$/g, "");
    let cleaned = cleanUrl(url);
    if (!cleaned) {
      bad.push(line);
      continue;
    }
    cleaned = cleanUrl(await expandShortLink(cleaned));
    label = clean(label).slice(0, 40) || labelFor(cleaned);
    if (!links.some((l) => l.url === cleaned)) links.push({ label, url: cleaned });
  }
  return { links, bad };
}

export function extractImageUrl(text) {
  const t = String(text ?? "");
  const m = t.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)/) || t.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i) || t.match(/(https?:\/\/\S+)/);
  return m ? m[1] : null;
}

// ---------- image download + normalization ----------

async function downloadImage(url, id) {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "printer-compare-bot" } });
  if (!res.ok) throw new Error(`the server answered HTTP ${res.status}`);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/") && type !== "application/octet-stream") throw new Error(`the link isn't an image (got ${type || "no content type"})`);
  if (Number(res.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) throw new Error("it's larger than 20 MB");
  const input = Buffer.from(await res.arrayBuffer());
  if (input.length > MAX_IMAGE_BYTES) throw new Error("it's larger than 20 MB");

  let result;
  try {
    result = await normalizeImage(input);
  } catch {
    throw new Error("it couldn't be read as an image");
  }

  await fs.mkdir(IMAGE_DIR, { recursive: true });
  for (const f of await fs.readdir(IMAGE_DIR)) {
    if (f.startsWith(`${id}.`) && f !== `${id}.webp`) await fs.rm(path.join(IMAGE_DIR, f));
  }
  await fs.writeFile(path.join(IMAGE_DIR, `${id}.webp`), result.buffer);
  return { file: `${id}.webp`, before: result.before, after: result.after };
}

// ---------- outputs ----------

async function setOutput(name, value) {
  const line = `${name}=${String(value).replace(/[\r\n]+/g, " ")}\n`;
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}

async function fail(errors) {
  const body = ["I couldn't turn this issue into a pull request yet:", "", ...errors.map((e) => `- ${e}`), "", "Edit the issue to fix these and I'll try again automatically."].join("\n");
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

  const brand = clean(form[F.brand]).slice(0, 60);
  const model = clean(form[F.model]).slice(0, 80);
  if (!brand) errors.push("**Brand** is empty.");
  if (!model) errors.push("**Model** is empty.");

  const price = parseNumber(form[F.price]);
  if (price == null || price <= 0 || price > 100000) errors.push("**Price (USD)** should be a number, like `649` or `1299.99`.");

  const bv = {};
  for (const axis of ["x", "y", "z"]) {
    const v = parseMeasure(form[F[axis]], "length");
    if (v == null || v <= 0 || v > 5000) errors.push(`**${F[axis]}** should be a size like \`256\` (mm) or \`10.1 in\`.`);
    bv[axis] = v;
  }

  // Optional numbers: blank is fine, nonsense is not
  const optional = (key, min, max, hint, kind) => {
    const text = clean(form[F[key]]);
    if (!text) return undefined;
    const v = kind ? parseMeasure(text, kind) : parseNumber(text);
    if (v == null || v < min || v > max) {
      errors.push(`**${F[key]}** should be a number ${hint}, or left blank.`);
      return undefined;
    }
    return v;
  };
  const materials = optional("materials", 1, 64, "like `4`");
  const hotend = optional("hotend", 100, 600, "like `300` (°C) or `572 F`", "temp");
  const bed = optional("bed", 30, 200, "like `100` (°C) or `212 F`", "temp");
  const speed = optional("speed", 10, 5000, "like `500` (mm/s) or `19.7 in/s`", "speed");
  const weight = optional("weight", 0.5, 500, "like `12.5` (kg) or `27.5 lb`", "mass");
  const released = optional("released", 1990, new Date().getFullYear() + 1, "like `2024`");

  let footprint;
  if (clean(form[F.footprint])) {
    const d = parseDims(form[F.footprint]);
    if (!d || d.some((v) => v <= 0 || v > 5000)) errors.push(`**${F.footprint}** should be three numbers, like \`389 × 389 × 458\` (mm) or \`15.3 × 15.3 × 18 in\`.`);
    else footprint = { w: d[0], d: d[1], h: d[2] };
  }

  let technology = clean(form[F.technology]);
  if (!TECHNOLOGIES.includes(technology)) technology = "Other";
  const kinematicsRaw = clean(form[F.kinematics]);
  const kinematics = KINEMATICS.includes(kinematicsRaw) ? kinematicsRaw : undefined;
  const enclosed = /^- \[x\]\s*Enclosed build chamber/im.test(form[F.features] || "");

  const { links, bad } = await parseLinks(form[F.links]);
  for (const line of bad) errors.push(`**Where to buy**: \`${line.slice(0, 120)}\` isn't a web address starting with https://`);
  if (!links.length && !bad.length) errors.push("**Where to buy** needs at least one link.");

  const id = slugify(`${brand} ${model}`);
  if (brand && model && !id) errors.push("**Brand** and **Model** need at least some letters or numbers.");

  if (errors.length) return fail(errors);

  const data = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const index = data.findIndex((p) => p.id === id);
  const existing = index >= 0 ? data[index] : null;

  let image = existing?.image;
  const imageUrl = extractImageUrl(form[F.image]);
  if (imageUrl) {
    try {
      const saved = await downloadImage(imageUrl, id);
      image = saved.file;
      notes.push(`Image optimized: ${describe(saved.before)} → ${describe(saved.after)}, trimmed and centered on a square canvas.`);
    } catch (err) {
      notes.push(`Couldn't copy the image into the repo because ${err.message}. The page links to it directly instead, unoptimized. Replace it with a local file if you can.`);
      image = imageUrl;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  // Blank optional fields keep what an existing entry already had
  const keep = (value, key) => (value !== undefined ? value : existing?.[key]);
  const printer = Object.fromEntries(
    Object.entries({
      id,
      brand,
      model,
      price,
      price_updated: today,
      technology,
      kinematics: keep(kinematics, "kinematics"),
      enclosed,
      max_materials: keep(materials, "max_materials") ?? 1,
      build_volume: bv,
      footprint: keep(footprint, "footprint"),
      weight_kg: keep(weight, "weight_kg"),
      hotend_max_c: keep(hotend, "hotend_max_c"),
      bed_max_c: keep(bed, "bed_max_c"),
      max_speed_mm_s: keep(speed, "max_speed_mm_s"),
      released: keep(released, "released"),
      image,
      links,
      added: existing?.added ?? today,
      source_issue: Number(issue) || undefined,
    }).filter(([, v]) => v !== undefined && v !== null),
  );

  if (existing) data[index] = printer;
  else data.push(printer);
  data.sort((a, b) => a.brand.localeCompare(b.brand, "en", { sensitivity: "base" }) || a.model.localeCompare(b.model, "en", { sensitivity: "base", numeric: true }));
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + "\n");

  const verb = existing ? "Update" : "Add";
  const title = `${verb} ${brand} ${model}`;
  const side = Math.min(bv.x, bv.y, bv.z);
  const L = (mm3) => `${(mm3 / 1e6).toFixed(1)} L`;
  const optionalRows = [
    ["Motion system", printer.kinematics],
    ["Colors / materials", printer.max_materials > 1 ? `Up to ${printer.max_materials}` : "Single"],
    ["Hotend max", printer.hotend_max_c && `${printer.hotend_max_c} °C`],
    ["Bed max", printer.bed_max_c && `${printer.bed_max_c} °C`],
    ["Top speed (claimed)", printer.max_speed_mm_s && `${printer.max_speed_mm_s} mm/s`],
    ["Machine size", printer.footprint && `${printer.footprint.w} × ${printer.footprint.d} × ${printer.footprint.h} mm`],
    ["Weight", printer.weight_kg && `${printer.weight_kg} kg`],
    ["Released", printer.released],
  ].filter(([, v]) => v);

  const body = [
    `${existing ? "Updates" : "Adds"} **${brand} ${model}** from #${issue}${author ? ` (submitted by @${author})` : ""}.`,
    "",
    "| | |",
    "|---|---|",
    `| Price | $${price} |`,
    `| Build volume | ${bv.x} × ${bv.y} × ${bv.z} mm (${L(bv.x * bv.y * bv.z)}) |`,
    `| Largest cube | ${side} mm per side (${L(side ** 3)}) |`,
    `| Technology | ${mdCell(technology)} |`,
    `| Enclosed | ${enclosed ? "Yes" : "No"} |`,
    ...optionalRows.map(([k, v]) => `| ${k} | ${mdCell(v)} |`),
    `| Links | ${links.map((l) => `[${mdCell(l.label).replace(/[[\]]/g, "")}](${l.url})`).join(", ")} |`,
    "",
    ...(imageUrl ? [`Original image: <img src="${imageUrl.replace(/"/g, "%22")}" alt="" width="200">`, ""] : []),
    ...(notes.length ? ["**Notes**", ...notes.map((n) => `- ${n}`), ""] : []),
    "The site builds successfully with this change. Check the numbers against the manufacturer's page before merging.",
    "",
    `Closes #${issue}`,
  ].join("\n");

  await fs.writeFile(path.join(TMP, "pr-body.md"), body);
  await setOutput("ok", "true");
  await setOutput("title", title);
  console.log(body);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(err);
    await fail([`Something went wrong on my side: \`${String(err.message).slice(0, 200)}\`. A maintainer will take a look.`]);
  });
}
