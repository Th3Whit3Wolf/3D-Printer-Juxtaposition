// Live page: fetch the data, render the rows and filters in place of the
// skeletons, then start the page as usual.
import { start, setupUnits } from "./app.js";
import { rowHtml, chipHtml, legendHtml, facets, byPrice } from "../lib/render.mjs";
import { glyphScale, plateLayout } from "../lib/geometry.mjs";

const $ = (s) => document.querySelector(s);
const src = new URL(document.body.dataset.src, location.href);

async function load() {
  const list = $("#list");
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const printers = (await res.json())
      .map((p) => ({
        ...p,
        name: `${p.brand} ${p.model}`,
        // photo paths in the JSON are relative to the JSON file
        thumb: p.thumb && new URL(p.thumb, src).href,
        hero: p.hero && new URL(p.hero, src).href,
      }))
      .sort(byPrice);

    const f = facets(printers);
    const volumes = printers.map((p) => p.bv);
    const scale = glyphScale(volumes);
    const { W, H } = plateLayout(volumes);

    list.innerHTML = printers.map((p) => rowHtml(p, scale)).join("");
    list.removeAttribute("aria-busy");
    $("#legend").innerHTML = legendHtml(f.brands);
    $("#tech-options").innerHTML = f.technologies.map((t) => chipHtml("tech", t)).join("");
    $("#brand-options").innerHTML = f.brands.map(([b, color]) => chipHtml("brand", b, color)).join("");
    const filters = $("#filters");
    filters.maxPrice.max = f.maxPrice; // max before value, or the browser clamps the value to the old max (0)
    filters.maxPrice.value = f.maxPrice;
    filters.minSide.max = f.maxSide;
    $("#plate").style.aspectRatio = `${W}/${H}`;
    $("#plate").replaceChildren(); // drop the skeleton

    start();
  } catch (err) {
    list.removeAttribute("aria-busy");
    $("#count").textContent = "Couldn't load printers";
    list.innerHTML = `<div class="px-4 py-16 text-center"><p class="font-medium">The printer list didn't load.</p><p class="mt-1 text-label text-muted">${String(err.message).replace(/</g, "&lt;")}</p><button type="button" class="btn mx-auto mt-4">Try again</button></div>`;
    list.querySelector("button").onclick = () => location.reload();
  }
}

setupUnits();
load();
