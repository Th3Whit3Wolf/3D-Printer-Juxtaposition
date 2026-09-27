# 3D printer comparison

A fast, single-page comparison of 3D printers: filter, sort, and compare up to four side by side on price, build volume, largest printable cube, speed, temperatures and machine size.

## How it's fast

- **Everything is rendered at build time.** The list is plain HTML, so it shows up before any script runs, and expanding a row works with no JavaScript at all (`<details>`).
- **One request.** CSS, JS and data are inlined, and there are no web fonts (it uses the system font). Only product photos are separate files.
- **The script only hides, reorders and reads** rows that already exist. No framework, no JSON fetch, no re-rendering. About 3 KB compressed.
- **Photos are resized to WebP at build time** (a 112 px thumbnail and a 360 px image for the comparison view) and lazy-loaded.
- Off-screen rows skip layout with `content-visibility: auto`. No blur or shadow effects that cost repaints while scrolling.

## Project layout

```
src/data/printers.json          the printer list (edit this, or use the issue form)
src/assets/printers/            printer photos, any size; optimized at build
src/pages/index.astro           the page
src/pages/data/printers.json.js publishes cleaned data at /data/printers.json
src/lib/printers.mjs            derived values, spec list, build-volume drawing
src/lib/links.mjs               store-link cleaning (used by the build and the bot)
src/scripts/app.js              filtering, sorting, comparison, shareable URLs
src/styles/global.css           Tailwind entry and design tokens (light and dark)
scripts/postbuild.mjs           inline check, HTML minify, Zopfli + Brotli
scripts/add-printer-from-issue.mjs   turns an issue into a data change
.github/ISSUE_TEMPLATE/add-printer.yml
.github/workflows/deploy.yml               build and publish to Pages
.github/workflows/printer-from-issue.yml   issue -> pull request
```

## Setup

1. Push to a GitHub repository.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.** Every push to `main` builds and deploys. The workflow sets the base path, so `https://<you>.github.io/<repo>/` works without config changes.
3. **Create the label `new-printer`** (Issues → Labels). The form applies it and the bot only runs on issues that have it; GitHub silently drops labels that don't exist.
4. **Settings → Actions → General → Workflow permissions:** choose *Read and write* and tick *Allow GitHub Actions to create and approve pull requests*.

Local development needs Node 22.12 or newer:

```
npm install
npm run dev       # live-reloading dev server
npm run build     # writes dist/
npm run preview   # serves dist/
```

## Compression and GitHub Pages

The build writes `index.html.gz` (Zopfli) and `index.html.br` (Brotli) next to the originals, and the same for `data/printers.json`.

GitHub Pages doesn't serve pre-compressed files. It compresses responses itself, so on Pages you get its gzip, not the Zopfli copy (the difference is a few percent). The pre-compressed files pay off on hosts that serve them directly, such as nginx (`gzip_static` / `brotli_static`), Caddy (`precompressed`), or S3/CloudFront with the `Content-Encoding` set.

The page doesn't fetch the JSON at all, since the data is already in the HTML. `data/printers.json` is published for anyone who wants the dataset.

## Store links

Links are cleaned at build time and when submitted:

- Amazon links become `https://www.amazon.<tld>/dp/<ASIN>` (a 290-character search-result link turns into 40 characters). `amzn.to` and `a.co` short links are expanded by the bot first. Search links keep only the search term.
- Other links lose tracking parameters like `utm_*`, `gclid` and `fbclid`.

## Adding printers

Through the site: **Suggest a printer** opens the issue form. The bot validates the answers, copies the photo into `src/assets/printers/`, checks that the site still builds, and opens a pull request that closes the issue when merged. If something's wrong it comments on the issue instead, and editing the issue re-runs it. Submitting a brand + model that already exists updates it (handy for price changes).

By hand: add an entry to `src/data/printers.json`:

```json
{
  "id": "bambu-lab-p1s",
  "brand": "Bambu Lab",
  "model": "P1S",
  "price": 649,
  "price_updated": "2026-09-27",
  "technology": "FDM",
  "kinematics": "CoreXY",
  "enclosed": true,
  "max_materials": 4,
  "build_volume": { "x": 256, "y": 256, "z": 256 },
  "footprint": { "w": 389, "d": 389, "h": 458 },
  "weight_kg": 12.95,
  "hotend_max_c": 300,
  "bed_max_c": 100,
  "max_speed_mm_s": 500,
  "released": 2023,
  "image": "bambu-lab-p1s.jpg",
  "links": [{ "label": "Official store", "url": "https://..." }],
  "added": "2026-09-27"
}
```

Only `id`, `brand`, `model`, `technology`, `build_volume` and `links` are required. `image` is a file name in `src/assets/printers/` (or a full https URL, which is used as-is without optimization).

Calculated at build time: largest cube, volumes in litres, price per litre, **space efficiency** (build volume as a share of the machine's outer box), and **estimated filaments** (from max temperatures and enclosure).

The sample printers are placeholders. Prices and specs are approximate, links go to brand home pages and Amazon searches, and there are no photos. Replace them with checked numbers and real product pages.

