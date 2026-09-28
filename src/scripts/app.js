// Filtering, sorting, comparison and the build plate.
// Works on rows already in the DOM: it only hides, reorders and reads them.

import { u } from "../lib/units.mjs";
import { plateSvg } from "../lib/geometry.mjs";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The Metric/US switch doesn't depend on the data, so it can start right away. */
let unitsReady = false;
export function setupUnits() {
  if (unitsReady) return;
  unitsReady = true;
  const unitsPicker = $("#units");
  const current = document.documentElement.dataset.units === "us" ? "us" : "metric";
  $(`input[value="${current}"]`, unitsPicker).checked = true;
  unitsPicker.addEventListener("change", (e) => {
    document.documentElement.dataset.units = e.target.value;
    try {
      localStorage.setItem("units", e.target.value);
    } catch {}
  });
}

/** Wires up the page. Call once the rows are in the DOM. */
export function start() {
  setupUnits();
  const MAX = 4;
  const form = $("#filters");
  const list = $("#list");
  const rows = $$(".row", list);
  const byId = new Map(rows.map((r) => [r.dataset.id, r]));
  const sheet = $("#sheet");
  // Draw the build plate from the rows' own data (id, color, build volume)
  $("#plate").innerHTML = plateSvg(
    rows.map((r) => {
      const [x, y, z] = r.dataset.bv.split(",").map(Number);
      return { id: r.dataset.id, color: r.style.getPropertyValue("--c"), bv: { x, y, z } };
    }),
  );
  const plate = $("#plate svg");
  const vols = new Map($$(".vol", plate).map((g) => [g.dataset.id, g]));
  const caption = $("#plate-caption");
  const captionIdle = caption.innerHTML;
  const SPECS = JSON.parse($("#specs").textContent); // [{ k, label, best }] in display order
  const PRICE_MAX = +form.maxPrice.max;
  const HEAD_DEFAULT = { name: "name", price: "price", "-volume": "-volume", "-side": "-side", ppl: "ppl" };
  let compare = [];

  const brandOf = (r) => $("[data-brand-label]", r).textContent;
  const modelOf = (r) => $("h3", r).textContent;
  const nameOf = (r) => `${brandOf(r)} ${modelOf(r)}`;
  const dot = (r) => `<span class="size-2 shrink-0 rounded-full" style="background:${r.style.getPropertyValue("--c")}"></span>`;

  /* ---------- filter + sort ---------- */

  function sortRows(spec) {
    const desc = spec.startsWith("-");
    const key = desc ? spec.slice(1) : spec;
    const val = key === "name" ? (r) => r.dataset.name : (r) => (r.dataset[key] === "" ? null : +r.dataset[key]);
    const sorted = [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return a.dataset.name.localeCompare(b.dataset.name);
      if (x == null) return 1; // unknown values always last
      if (y == null) return -1;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    });
    list.append(...sorted); // moves existing nodes, open rows stay open

    for (const h of $$("#heads [data-sort]")) {
      if (h.dataset.sort.replace(/^-/, "") === key) h.setAttribute("aria-sort", desc ? "descending" : "ascending");
      else h.removeAttribute("aria-sort");
    }
  }

  function apply() {
    const fd = new FormData(form);
    const q = String(fd.get("q") || "").trim().toLowerCase();
    const flags = new Set(fd.getAll("f"));
    const tech = new Set(fd.getAll("tech"));
    const brands = new Set(fd.getAll("brand"));
    const maxPrice = +fd.get("maxPrice");
    const minSide = +fd.get("minSide");
    const anyPrice = maxPrice >= PRICE_MAX;

    let shown = 0;
    for (const r of rows) {
      const d = r.dataset;
      const ok =
        (!q || d.name.includes(q)) &&
        (!flags.has("enclosed") || d.enclosed === "1") &&
        (!flags.has("multi") || +d.materials > 1) &&
        (!flags.has("corexy") || d.motion === "CoreXY") &&
        (!tech.size || tech.has(d.tech)) &&
        (!brands.size || brands.has(d.brand)) &&
        (anyPrice || (d.price !== "" && +d.price <= maxPrice)) &&
        +d.side >= minSide;
      r.hidden = !ok;
      vols.get(d.id)?.classList.toggle("off", !ok); // the plate shows what the list shows
      if (ok) shown++;
    }
    sortRows(String(fd.get("sort") || "price"));

    $("#price-out").value = anyPrice ? "Any" : `Up to $${maxPrice.toLocaleString("en-US")}`;
    $("#side-out").innerHTML = minSide ? `${u("len", minSide)} or more` : "Any";

    const panelCount = tech.size + brands.size + (anyPrice ? 0 : 1) + (minSide ? 1 : 0);
    const badge = $("#badge");
    badge.textContent = panelCount;
    badge.classList.toggle("hidden", !panelCount);

    const filtered = shown !== rows.length;
    $("#count").textContent = filtered ? `${shown} of ${rows.length} printers` : `${rows.length} printers`;
    $("#clear").hidden = !(filtered || q || flags.size || panelCount);
    $("#empty").hidden = shown > 0;
    saveUrl();
  }

  /* ---------- the plate ---------- */

  let hotId = null;

  function paintPlate() {
    for (const [id, g] of vols) {
      g.classList.toggle("sel", compare.includes(id));
      g.classList.toggle("hot", id === hotId);
    }
    plate.classList.toggle("has-focus", !!hotId || compare.length > 0);

    const r = byId.get(hotId);
    caption.innerHTML = r
      ? `<p class="flex items-center gap-2 font-semibold">${dot(r)}${esc(nameOf(r))}</p>
         <p class="mt-0.5 text-vp-muted">${u("dims", r.dataset.bv.split(",").map(Number))}, largest cube ${u("len", +r.dataset.side)}</p>`
      : compare.length
        ? `<p class="text-vp-muted">Comparing</p><p class="mt-0.5 flex flex-wrap gap-x-3">${compare.map((id) => `<span class="flex items-center gap-1.5">${dot(byId.get(id))}${esc(modelOf(byId.get(id)))}</span>`).join("")}</p>`
        : captionIdle;
  }

  function setHot(id) {
    if (hotId === id) return;
    const prev = byId.get(hotId);
    prev?.classList.remove("hot");
    hotId = id;
    byId.get(id)?.classList.add("hot");
    paintPlate();
  }

  /* ---------- comparison ---------- */

  function syncCompare() {
    const full = compare.length >= MAX;
    for (const r of rows) {
      const box = $("input[data-compare]", r);
      box.checked = compare.includes(r.dataset.id);
      box.disabled = full && !box.checked;
    }

    $("#tray").hidden = !compare.length;
    $("#tray-list").innerHTML = compare
      .map((id) => {
        const r = byId.get(id);
        return `<li class="flex shrink-0 items-center gap-2 rounded-xl bg-card/10 py-1 pr-1 pl-3 text-label whitespace-nowrap">${dot(r)}${esc(modelOf(r))}<button type="button" data-remove="${esc(id)}" class="grid size-7 place-items-center rounded-lg text-base hover:bg-card/15" aria-label="Remove ${esc(nameOf(r))}">×</button></li>`;
      })
      .join("");
    const open = $("#tray-open");
    open.disabled = compare.length < 2;
    open.textContent = compare.length < 2 ? "Pick one more" : `Compare ${compare.length}`;

    paintPlate();
    if (sheet.open) compare.length < 2 ? sheet.close() : renderSheet();
    saveUrl();
  }

  function toggle(id, on) {
    compare = compare.filter((x) => x !== id);
    if (on && compare.length < MAX) compare.push(id);
    syncCompare();
  }

  function renderSheet() {
    const picked = compare.map((id) => byId.get(id));
    const onlyDiff = $("#diff").checked;
    $("#sheet-title").textContent = `Comparing ${picked.length} printers`;

    // The compared volumes overlaid on one plate
    const overlay = plate.cloneNode(true);
    overlay.classList.add("only-sel");
    overlay.classList.remove("has-focus");
    for (const g of $$(".vol", overlay)) {
      g.classList.remove("off");
      g.classList.toggle("sel", compare.includes(g.dataset.id));
      g.classList.remove("hot");
    }
    $("#sheet-plate").replaceChildren(overlay);
    $("#sheet-key").innerHTML = picked
      .map((r) => `<li class="flex items-center gap-2.5">${dot(r)}<span class="font-semibold">${esc(nameOf(r))}</span><span class="text-vp-muted">${u("len", +r.dataset.side)} cube</span></li>`)
      .join("");

    const head = picked
      .map((r) => {
        const photo = r.dataset.hero
          ? `<div class="mb-3 aspect-square w-full max-w-36 overflow-hidden rounded-2xl bg-white"><img src="${esc(r.dataset.hero)}" alt="" class="size-full object-contain" decoding="async"></div>`
          : "";
        return `<th scope="col" class="min-w-36 px-4 pt-5 pb-3 text-left align-bottom font-normal" style="--c:${r.style.getPropertyValue("--c")}">${photo}
          <p class="flex items-center gap-1.5 text-xs text-muted">${dot(r)}${esc(brandOf(r))}</p>
          <p class="text-base font-semibold tracking-tight">${esc(modelOf(r))}</p>
          <button type="button" data-remove="${esc(r.dataset.id)}" class="mt-1 text-xs text-muted underline underline-offset-2 hover:text-ink">Remove</button>
        </th>`;
      })
      .join("");

    // Each value comes from the row itself: a summary cell or an item in its details
    const body = [];
    for (const { k, label, best: mode } of SPECS) {
      const cells = picked.map((r) => $(`[data-k="${k}"]`, r));
      const texts = cells.map((c) => (c ? ($("dd", c) ?? c).innerHTML : "—"));
      if (texts.every((t) => t === "—")) continue;
      if (onlyDiff && texts.every((t) => t === texts[0])) continue;
      const best = bestOf(cells.map((c) => (c?.dataset.v ? +c.dataset.v : null)), mode);
      body.push(
        tr(
          label,
          texts.map((t, i) => `<td class="px-4 py-3${best.has(i) ? " best" : ""}" style="--c:${picked[i].style.getPropertyValue("--c")}">${t}</td>`),
        ),
      );
    }
    body.push(tr("Where to buy", picked.map((r) => `<td class="px-4 py-3"><div class="flex flex-wrap gap-1.5">${$("[data-links]", r)?.innerHTML ?? "—"}</div></td>`)));

    $("#sheet-body").innerHTML = `<table class="w-full border-collapse text-sm" style="min-width:${6 + picked.length * 9}rem">
      <thead class="border-b border-line"><tr><td></td>${head}</tr></thead>
      <tbody class="divide-y divide-line">${body.join("")}</tbody></table>`;
  }

  const tr = (label, cells) =>
    `<tr class="align-top"><th scope="row" class="sticky left-0 w-24 bg-card px-4 py-3 text-left text-xs font-medium text-muted sm:w-36">${label}</th>${cells.join("")}</tr>`;

  function bestOf(values, mode) {
    const known = values.filter((v) => v != null);
    if (!mode || known.length < 2) return new Set();
    const target = mode === "min" ? Math.min(...known) : Math.max(...known);
    if (known.every((v) => v === target)) return new Set(); // a tie across the board isn't a "best"
    return new Set(values.flatMap((v, i) => (v === target ? [i] : [])));
  }

  /* ---------- URL state (shareable filters and comparisons) ---------- */

  function saveUrl(extra) {
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(form)) {
      if (v === "" || (k === "sort" && v === "price") || (k === "maxPrice" && +v >= PRICE_MAX) || (k === "minSide" && v === "0")) continue;
      p.append(k, v);
    }
    if (compare.length) p.set("compare", compare.join(","));
    if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const qs = p.toString().replace(/%2C/g, ",");
    const url = qs ? `?${qs}` : location.pathname;
    if (!extra) history.replaceState(null, "", url);
    return new URL(url, location.href).href;
  }

  function loadUrl() {
    const p = new URLSearchParams(location.search);
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === "checkbox") el.checked = p.getAll(el.name).includes(el.value);
      else if (p.has(el.name)) el.value = p.get(el.name);
    }
    compare = (p.get("compare") || "").split(",").filter((id) => byId.has(id)).slice(0, MAX);
    return p.get("view") === "compare" && compare.length >= 2;
  }

  /* ---------- events ---------- */

  form.addEventListener("input", apply);
  form.addEventListener("reset", () => requestAnimationFrame(apply));

  $("#more").addEventListener("click", (e) => {
    const open = e.currentTarget.getAttribute("aria-expanded") !== "true";
    e.currentTarget.setAttribute("aria-expanded", open);
    $("#panel").hidden = !open;
  });

  $("#heads").addEventListener("click", (e) => {
    const key = e.target.closest("[data-sort]")?.dataset.sort;
    if (!key) return;
    form.sort.value = key === "price" && form.sort.value === "price" ? "-price" : HEAD_DEFAULT[key];
    apply();
  });

  list.addEventListener("change", (e) => {
    if (e.target.matches("[data-compare]")) toggle(e.target.value, e.target.checked);
  });

  // Hovering, focusing or opening a row lights it up on the plate
  list.addEventListener("pointerover", (e) => setHot(e.target.closest(".row")?.dataset.id ?? null));
  list.addEventListener("pointerleave", () => setHot(null));
  list.addEventListener("focusin", (e) => setHot(e.target.closest(".row")?.dataset.id ?? null));
  list.addEventListener("toggle", (e) => e.target.open && setHot(e.target.closest(".row").dataset.id), true);

  const onRemove = (e) => {
    const id = e.target.closest("[data-remove]")?.dataset.remove;
    if (id) toggle(id, false);
  };
  $("#tray-list").addEventListener("click", onRemove);
  $("#sheet-body").addEventListener("click", onRemove);

  $("#tray-open").addEventListener("click", () => {
    renderSheet();
    sheet.showModal();
  });
  $("#sheet-close").addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (e) => e.target === sheet && sheet.close()); // backdrop
  $("#diff").addEventListener("change", renderSheet);

  $("#share").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(saveUrl({ view: "compare" }));
      btn.textContent = "Link copied";
    } catch {
      btn.textContent = "Couldn't copy";
    }
    setTimeout(() => (btn.textContent = "Copy link"), 1800);
  });

  const openOnLoad = loadUrl();
  if ($$("#panel input:checked").length || +form.maxPrice.value < PRICE_MAX || +form.minSide.value > 0) {
    $("#more").setAttribute("aria-expanded", "true");
    $("#panel").hidden = false;
  }
  apply();
  syncCompare();
  if (openOnLoad) {
    renderSheet();
    sheet.showModal();
  }
}
