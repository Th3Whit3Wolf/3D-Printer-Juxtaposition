"use strict";

/* ------------------------------------------------------------------ *
 * Settings
 * owner/repo are detected from a *.github.io URL automatically. Set
 * them here if you use a custom domain, so "Suggest a printer" works.
 * ------------------------------------------------------------------ */
const CONFIG = {
  owner: "",
  repo: "",
  issueTemplate: "add-printer.yml",
  dataUrl: "data/printers.json",
  currency: "USD",
  maxCompare: 4,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  printers: [],
  byId: new Map(),
  compare: [], // printer ids, in the order they were picked
};

const fmtMoney = new Intl.NumberFormat(undefined, { style: "currency", currency: CONFIG.currency, maximumFractionDigits: 0 });
const fmtMoney2 = new Intl.NumberFormat(undefined, { style: "currency", currency: CONFIG.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtLitres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const fmtMm = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/* ---------------- helpers ---------------- */

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Only allow http(s) links and images stored in this repo's images/ folder.
function safeUrl(url) {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u;
  if (/^images\/[\w.\-/]+$/.test(u) && !u.includes("..")) return u;
  return null;
}

function numOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const money = (n) => (n == null ? "Price unknown" : fmtMoney.format(n));
const litres = (n) => `${fmtLitres.format(n)} L`;
const dims = (p) => `${fmtMm.format(p.build_volume.x)} × ${fmtMm.format(p.build_volume.y)} × ${fmtMm.format(p.build_volume.z)} mm`;

function isValidPrinter(p) {
  const v = p && p.build_volume;
  return p && p.id && p.brand && p.model && v && [v.x, v.y, v.z].every((n) => typeof n === "number" && n > 0);
}

function enrich(p) {
  const { x, y, z } = p.build_volume;
  const side = Math.min(x, y, z);
  const volumeL = (x * y * z) / 1e6;
  const price = typeof p.price === "number" ? p.price : null;
  return {
    ...p,
    name: `${p.brand} ${p.model}`,
    price,
    side,
    volumeL,
    cubeL: side ** 3 / 1e6,
    pricePerL: price != null ? price / volumeL : null,
    links: Array.isArray(p.links) ? p.links.filter((l) => safeUrl(l && l.url)) : [],
  };
}

/* ---------------- build-volume glyph ----------------
 * Isometric drawing of each printer's build volume with its largest cube
 * in gold. Every glyph shares one scale, so sizes compare at a glance. */

const G = { w: 140, h: 124, pad: 6, k: 1 };
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

function computeGlyphScale(list) {
  let maxW = 1, maxH = 1;
  for (const p of list) {
    const { x, y, z } = p.build_volume;
    maxW = Math.max(maxW, (x + y) * COS30);
    maxH = Math.max(maxH, (x + y) * SIN30 + z);
  }
  G.k = Math.min((G.w - 2 * G.pad) / maxW, (G.h - 2 * G.pad) / maxH);
}

function glyph(p) {
  const { x: X, y: Y, z: Z } = p.build_volume;
  const k = G.k;
  const s = p.side;
  const boxW = (X + Y) * COS30 * k;
  const ox = (G.w - boxW) / 2 + Y * COS30 * k;
  const oy = G.h - G.pad - (X + Y) * SIN30 * k;
  const pt = (x, y, z) => `${(ox + (x - y) * COS30 * k).toFixed(2)},${(oy + ((x + y) * SIN30 - z) * k).toFixed(2)}`;
  const poly = (cls, pts) => `<polygon class="${cls}" points="${pts.map((q) => pt(...q)).join(" ")}"/>`;

  const faces = (x0, y0, z0, x1, y1, z1, cls) => [
    poly(cls[0], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]), // top
    poly(cls[1], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]), // right (x = max)
    poly(cls[2], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]), // left (y = max)
  ].join("");

  const hidden = `<path class="vol-hidden" d="M${pt(0, 0, 0)} L${pt(X, 0, 0)} M${pt(0, 0, 0)} L${pt(0, Y, 0)} M${pt(0, 0, 0)} L${pt(0, 0, Z)}"/>`;
  const label = `Build volume ${dims(p)}; largest cube ${fmtMm.format(s)} mm per side`;

  return `<svg class="glyph" viewBox="0 0 ${G.w} ${G.h}" role="img" aria-label="${esc(label)}">
    ${hidden}
    ${faces(0, 0, 0, X, Y, Z, ["vol-face", "vol-face", "vol-face"])}
    ${faces(X - s, Y - s, 0, X, Y, s, ["cube-top", "cube-right", "cube-left"])}
  </svg>`;
}

/* ---------------- filters + sorting ---------------- */

const SORTS = {
  "price-asc": { key: (p) => p.price, dir: 1 },
  "price-desc": { key: (p) => p.price, dir: -1 },
  "volume-desc": { key: (p) => p.volumeL, dir: -1 },
  "cube-desc": { key: (p) => p.side, dir: -1 },
  "ppl-asc": { key: (p) => p.pricePerL, dir: 1 },
  "name-asc": { key: (p) => p.name.toLowerCase(), dir: 1 },
  "added-desc": { key: (p) => p.added || "", dir: -1 },
};

function readFilters() {
  const fd = new FormData($("#filter-form"));
  return {
    q: String(fd.get("q") || "").trim().toLowerCase(),
    priceMin: numOrNull(fd.get("priceMin")),
    priceMax: numOrNull(fd.get("priceMax")),
    minSide: Number(fd.get("minSide") || 0),
    enclosure: fd.get("enclosure") || "any",
    multi: fd.get("multi") === "on",
    brands: new Set(fd.getAll("brand")),
    tech: new Set(fd.getAll("tech")),
  };
}

function matches(p, f) {
  if (f.q && !`${p.name} ${p.technology || ""}`.toLowerCase().includes(f.q)) return false;
  if (f.priceMin != null && (p.price == null || p.price < f.priceMin)) return false;
  if (f.priceMax != null && (p.price == null || p.price > f.priceMax)) return false;
  if (p.side < f.minSide) return false;
  if (f.enclosure === "yes" && !p.enclosed) return false;
  if (f.enclosure === "no" && p.enclosed) return false;
  if (f.multi && !p.multi_material) return false;
  if (f.brands.size && !f.brands.has(p.brand)) return false;
  if (f.tech.size && !f.tech.has(p.technology)) return false;
  return true;
}

function sortList(list, sortId) {
  const s = SORTS[sortId] || SORTS["price-asc"];
  return [...list].sort((a, b) => {
    const ka = s.key(a), kb = s.key(b);
    if (ka == null && kb == null) return a.name.localeCompare(b.name);
    if (ka == null) return 1; // unknowns always last
    if (kb == null) return -1;
    if (ka < kb) return -s.dir;
    if (ka > kb) return s.dir;
    return a.name.localeCompare(b.name);
  });
}

function buildFilterOptions() {
  const counts = (key) => {
    const m = new Map();
    for (const p of state.printers) if (p[key]) m.set(p[key], (m.get(p[key]) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const checks = (name, entries) =>
    entries.map(([v, n]) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(v)}"> ${esc(v)} <span class="n">${n}</span></label>`).join("");

  $("#brand-options").insertAdjacentHTML("beforeend", checks("brand", counts("brand")));
  $("#tech-options").insertAdjacentHTML("beforeend", checks("tech", counts("technology")));

  const maxSide = Math.max(0, ...state.printers.map((p) => p.side));
  $("#min-side").max = String(Math.ceil(maxSide / 10) * 10);
}

/* ---------------- rendering ---------------- */

function linksHTML(p) {
  return p.links
    .map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label || new URL(l.url).hostname)}</a>`)
    .join("");
}

function cardHTML(p) {
  const img = safeUrl(p.image);
  const picked = state.compare.includes(p.id);
  const full = !picked && state.compare.length >= CONFIG.maxCompare;
  const tags = [p.technology, p.enclosed ? "Enclosed" : "Open frame", p.multi_material ? "Multi-material" : null].filter(Boolean);

  return `<article class="card${picked ? " is-selected" : ""}" data-id="${esc(p.id)}">
    <div class="card-media${img ? "" : " is-empty"}">
      ${img ? `<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy">` : `<div class="media-fallback" aria-hidden="true">${esc(p.model)}</div>`}
    </div>
    <div class="card-body">
      <h2 class="card-title"><span class="brand">${esc(p.brand)}</span>${esc(p.model)}</h2>
      <div class="price-row">
        <p class="price">${money(p.price)}</p>
        ${p.price_updated ? `<p class="checked">checked ${esc(p.price_updated)}</p>` : ""}
      </div>
      <div class="spec">
        ${glyph(p)}
        <dl>
          <div><dt>Build volume</dt><dd>${dims(p)}<span class="sub">${litres(p.volumeL)}</span></dd></div>
          <div><dt>Largest cube</dt><dd class="cube-val">${fmtMm.format(p.side)} mm<span class="sub">${litres(p.cubeL)}</span></dd></div>
          <div><dt>Price per litre</dt><dd>${p.pricePerL != null ? fmtMoney2.format(p.pricePerL) : "—"}</dd></div>
        </dl>
      </div>
      <ul class="tags">${tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      ${p.links.length ? `<div class="links">${linksHTML(p)}</div>` : ""}
      <label class="compare-toggle${full ? " is-full" : ""}">
        <input type="checkbox" data-compare="${esc(p.id)}"${picked ? " checked" : ""}${full ? " disabled" : ""}>
        ${full ? `Compare (limit of ${CONFIG.maxCompare} reached)` : "Compare"}
      </label>
    </div>
  </article>`;
}

function render() {
  const f = readFilters();
  const list = sortList(state.printers.filter((p) => matches(p, f)), $("#sort").value);
  const grid = $("#grid");

  $("#min-side-out").textContent = f.minSide > 0 ? `${f.minSide} mm` : "any size";
  $("#count").textContent = list.length === state.printers.length
    ? `${list.length} printers`
    : `${list.length} of ${state.printers.length} printers`;

  grid.innerHTML = list.length
    ? list.map(cardHTML).join("")
    : `<div class="empty"><p>No printers match these filters.</p><button type="button" class="button" data-action="clear-filters">Clear filters</button></div>`;
}

function renderTray() {
  const tray = $("#tray");
  const picked = state.compare.map((id) => state.byId.get(id)).filter(Boolean);
  tray.hidden = picked.length === 0;
  document.body.classList.toggle("has-tray", picked.length > 0);
  $("#tray-list").innerHTML = picked
    .map((p) => `<li>${esc(p.name)}<button type="button" data-remove="${esc(p.id)}" aria-label="Remove ${esc(p.name)} from comparison">×</button></li>`)
    .join("");
  const open = $("#tray-open");
  open.disabled = picked.length < 2;
  open.textContent = picked.length < 2 ? "Pick one more to compare" : `Compare ${picked.length} printers`;
}

// Update card checkboxes in place (keeps keyboard focus where it was).
function syncCards() {
  const full = state.compare.length >= CONFIG.maxCompare;
  for (const card of $$(".card")) {
    const id = card.dataset.id;
    const picked = state.compare.includes(id);
    const box = $("input[data-compare]", card);
    const label = box.closest("label");
    card.classList.toggle("is-selected", picked);
    box.checked = picked;
    box.disabled = !picked && full;
    label.classList.toggle("is-full", !picked && full);
    label.lastChild.textContent = !picked && full ? ` Compare (limit of ${CONFIG.maxCompare} reached)` : " Compare";
  }
}

const COMPARE_ROWS = [
  { label: "Price", value: (p) => p.price, best: "min", cell: (p) => money(p.price) + (p.price_updated ? `<br><small>checked ${esc(p.price_updated)}</small>` : "") },
  { label: "Build volume", value: (p) => p.volumeL, best: "max", cell: (p) => `${dims(p)}<br>${litres(p.volumeL)}` },
  { label: "Largest cube", value: (p) => p.side, best: "max", cell: (p) => `${fmtMm.format(p.side)} mm per side<br>${litres(p.cubeL)}` },
  { label: "Price per litre", value: (p) => p.pricePerL, best: "min", cell: (p) => (p.pricePerL != null ? fmtMoney2.format(p.pricePerL) : "—") },
  { label: "Technology", cell: (p) => esc(p.technology || "—") },
  { label: "Enclosed", cell: (p) => (p.enclosed ? "Yes" : "No") },
  { label: "Multi-material", cell: (p) => (p.multi_material ? "Yes" : "No") },
  { label: "Where to buy", cell: (p) => (p.links.length ? `<div class="links">${linksHTML(p)}</div>` : "—") },
];

function bestSet(values, mode) {
  const known = values.map((v, i) => [v, i]).filter(([v]) => v != null);
  if (known.length < 2) return new Set();
  const target = mode === "min" ? Math.min(...known.map(([v]) => v)) : Math.max(...known.map(([v]) => v));
  if (known.every(([v]) => v === target)) return new Set(); // a tie across the board isn't a "best"
  return new Set(known.filter(([v]) => v === target).map(([, i]) => i));
}

function renderCompare() {
  const picked = state.compare.map((id) => state.byId.get(id)).filter(Boolean);
  if (picked.length < 2) {
    $("#compare-dialog").close();
    return;
  }
  const head = picked.map((p) => {
    const img = safeUrl(p.image);
    return `<th scope="col"><div class="col-head">
      ${img ? `<img src="${esc(img)}" alt="">` : glyph(p)}
      <div class="col-name"><small>${esc(p.brand)}</small>${esc(p.model)}</div>
      <button type="button" class="button button-quiet remove-col" data-remove="${esc(p.id)}">Remove</button>
    </div></th>`;
  }).join("");

  const rows = COMPARE_ROWS.map((row) => {
    const best = row.best ? bestSet(picked.map(row.value), row.best) : new Set();
    return `<tr><th scope="row">${row.label}</th>${picked.map((p, i) => `<td${best.has(i) ? ' class="best"' : ""}>${row.cell(p)}</td>`).join("")}</tr>`;
  }).join("");

  // Glyph row, only needed when photos took the header slot
  const glyphRow = picked.some((p) => safeUrl(p.image))
    ? `<tr><th scope="row">Size</th>${picked.map((p) => `<td>${glyph(p)}</td>`).join("")}</tr>`
    : "";

  $("#compare-body").innerHTML = `<table class="compare-table">
    <thead><tr><td></td>${head}</tr></thead>
    <tbody>${rows}${glyphRow}</tbody>
  </table>`;
}

/* ---------------- compare state ---------------- */

function toggleCompare(id, on) {
  const i = state.compare.indexOf(id);
  if (on && i === -1 && state.compare.length < CONFIG.maxCompare) state.compare.push(id);
  if (!on && i !== -1) state.compare.splice(i, 1);
  syncCards();
  renderTray();
  if ($("#compare-dialog").open) renderCompare();
}

/* ---------------- setup ---------------- */

function repoInfo() {
  if (CONFIG.owner && CONFIG.repo) return { owner: CONFIG.owner, repo: CONFIG.repo };
  const host = location.hostname;
  if (!host.endsWith(".github.io")) return null;
  const owner = host.slice(0, -".github.io".length);
  const first = location.pathname.split("/").filter(Boolean)[0];
  const repo = first && !first.includes(".") ? first : `${owner}.github.io`;
  return { owner, repo };
}

function setupSuggestLink() {
  const info = repoInfo();
  if (!info) return;
  const a = $("#suggest-link");
  a.href = `https://github.com/${info.owner}/${info.repo}/issues/new?template=${encodeURIComponent(CONFIG.issueTemplate)}`;
  a.target = "_blank";
  a.rel = "noopener";
  a.hidden = false;
}

function bindEvents() {
  const form = $("#filter-form");
  form.addEventListener("input", render);
  form.addEventListener("change", render);
  form.addEventListener("reset", () => setTimeout(render)); // run after the browser resets fields
  $("#sort").addEventListener("change", render);

  $("#grid").addEventListener("change", (e) => {
    const box = e.target.closest("input[data-compare]");
    if (box) toggleCompare(box.dataset.compare, box.checked);
  });
  $("#grid").addEventListener("click", (e) => {
    if (e.target.closest("[data-action='clear-filters']")) form.reset();
  });

  const removeHandler = (e) => {
    const btn = e.target.closest("[data-remove]");
    if (btn) toggleCompare(btn.dataset.remove, false);
  };
  $("#tray-list").addEventListener("click", removeHandler);
  $("#compare-body").addEventListener("click", removeHandler);

  $("#tray-clear").addEventListener("click", () => {
    state.compare = [];
    syncCards();
    renderTray();
  });
  $("#tray-open").addEventListener("click", () => {
    renderCompare();
    $("#compare-dialog").showModal();
  });
  $("#compare-close").addEventListener("click", () => $("#compare-dialog").close());
  $("#compare-dialog").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close(); // click on backdrop
  });
}

async function init() {
  setupSuggestLink();
  if (matchMedia("(max-width: 860px)").matches) $("#filter-panel").open = false;

  try {
    const res = await fetch(CONFIG.dataUrl, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    state.printers = raw.filter(isValidPrinter).map(enrich);
  } catch (err) {
    $("#grid").innerHTML = `<div class="empty"><p>Couldn't load ${esc(CONFIG.dataUrl)} (${esc(err.message)}).</p>
      <p>If you opened index.html straight from your computer, run <code>python3 -m http.server</code> in this folder and open http://localhost:8000 instead.</p></div>`;
    return;
  }

  state.byId = new Map(state.printers.map((p) => [p.id, p]));
  computeGlyphScale(state.printers);
  buildFilterOptions();
  bindEvents();
  render();
  renderTray();
}

init();
