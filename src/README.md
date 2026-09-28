# Build Plate: 3D printers, to scale

A fast, single-page comparison of 3D printers. Every build volume is drawn on one plate at the same scale; filter, sort, and compare up to four side by side on price, build volume, largest printable cube, speed, temperatures and machine size.

Built with Astro and Tailwind CSS. The build produces **one minified `index.html`** with the CSS, JavaScript and all printer data inside it: about 18 KB over the wire, and the first screen, the plate drawing code and most of the script arrive in the first network round trip. A second version at `/live/` loads the data in the browser instead; see "Baked-in vs live".

## Design

- **The build plate** is a dark, slicer-style viewport that draws every printer's build volume as a wireframe, nested at one corner, to scale. On wide screens it stays beside the list: pointing at a row lights up that printer and shows its largest cube; printers picked for comparison stay drawn. The comparison sheet opens with the same plate showing only the compared printers.
- **Filament colors.** Each brand gets a color (assigned in `src/lib/printers.mjs`), used for its wireframe, cube, dot, and its "best" highlights in the comparison.
- **The headline is printed in layers**: filled with horizontal bands like FDM layer lines, and it prints in from the bottom on load before the wireframes draw in. Both are skipped for people who prefer reduced motion.
- **Metric and US units.** A switch in the header flips every measurement between mm / L / °C / mm/s / kg / $ per litre and in / in³ / °F / in/s / lb / $ per ft³. See "Units" below.
- **Display type** is the system font at its heaviest weight (SF Pro, Segoe UI or Roboto), so there are no font files to load.

## How it's fast

- **The list is rendered at build time.** It's plain HTML, so it shows up before any script runs, and expanding a row works with no JavaScript at all (`<details>`).
- **The build plate is drawn on page load** from data the rows already carry (id, color, build volume), which is much smaller than shipping the drawing itself. Its exact shape is reserved at build time, so nothing moves when it appears, and the draw-in animation covers the moment it's created. Without JavaScript it shows a short note instead.
- **One request.** CSS, JS and data are inlined, and type uses the system font. Only product photos are separate files.
- **The script only hides, reorders and reads** rows that already exist. No framework, no JSON fetch, no re-rendering. About 3 KB compressed.
- **Photos are resized to WebP at build time** (a 112 px thumbnail and a 360 px image for the comparison view) and lazy-loaded.
- Off-screen rows skip layout with `content-visibility: auto`. No blur or shadow effects that cost repaints while scrolling.

## Project layout

```
src/data/printers.json          the printer list (edit this, or use the issue form)
src/assets/printers/            printer photos: square WebPs, see "Photos" below
src/components/Page.astro       the page (both versions, see "Baked-in vs live")
src/pages/index.astro           home page: data baked in at build time
src/pages/live/index.astro      live version: data fetched in the browser
src/pages/data/printers.json.js publishes the public dataset at /data/printers.json
src/lib/printers.mjs            build only: cleans the data, derived values, brand colors
src/lib/photos.mjs              build only: finds and resizes each printer's photo
src/lib/format.mjs              formatters and the spec list          ┐ pure, no data inside:
src/lib/render.mjs              HTML for rows, chips and the legend   │ used by the build and
src/lib/geometry.mjs            isometric glyphs and the build plate  │ in the browser, so both
src/lib/units.mjs               metric / US formatting                ┘ render identical markup
src/lib/links.mjs               store-link cleaning (build and bot)
src/scripts/app.js              filtering, sorting, comparison, plate, units
src/scripts/static.js           home page entry
src/scripts/live.js             live page entry: fetch, render, then start
src/styles/global.css           Tailwind entry, tokens, components
scripts/postbuild.mjs           inlines and bundles each page's CSS/JS (the live page's script becomes a file), minifies HTML
scripts/add-printer-from-issue.mjs   turns an issue into a data change
scripts/lib/image.mjs           photo normalizer (bot and `npm run images`)
scripts/optimize-images.mjs     normalizes photos added by hand
.github/ISSUE_TEMPLATE/add-printer.yml
.github/workflows/deploy.yml               build and publish to Pages
.github/workflows/printer-from-issue.yml   issue -> pull request
```

## Baked-in vs live

The site builds two versions of the same page from the same components:

- **`/`** has the printer data baked into the HTML.
- **`/live/`** fetches `data/printers.json` when the page loads and shows skeletons (rows, the plate, the legend) until it arrives. It reserves the plate's last known shape so nothing moves when the data lands, and shows a "Try again" message if the request fails.

Once loaded they're pixel-identical.

The live page is tuned around the fact that it needs a second round trip for its data anyway:

- **The HTML fits in the first network flight.** A new connection delivers about 14.6 KB (10 packets) in its first round trip. The live HTML (styles, skeleton, page shell) is about 10.3 KB compressed, so the skeleton paints after one round trip.
- **The script rides along with the data.** Instead of being inlined, it's a separate, cacheable file (`assets/live.<hash>.js`, about 7.2 KB compressed) loaded from `<head>`, so it downloads in parallel with the data in the second round trip that the page spends anyway. The post-build step does this for any page whose `<body>` has `data-js="external"`.
- **The data download starts immediately.** A `<link rel="preload">` in `<head>` requests `data/printers.json` as soon as the HTML starts arriving, instead of waiting for the script to run. The script's `fetch()` reuses that response (one request, checked in the browser).

Measured on a throttled 4G connection (150 ms round trip, 1.6 Mbps), served gzipped like GitHub Pages:

| | first paint | rows visible | interactive | first-flight HTML |
|---|---|---|---|---|
| `/` baked-in | ~215 ms | ~220 ms | ~285 ms | 18.6 KB (everything, 1 request) |
| `/live/` | ~215 ms | ~450 ms | ~450 ms | 10.3 KB (+ script 7.2 KB and data 1.1 KB in parallel) |

(Browser throttling doesn't model TCP slow start, which is where fitting in the first flight matters most, so real first visits favor the live page's layout more than this shows.)

The baked-in page still shows printers one round trip sooner, because it doesn't wait for data at all. On GitHub Pages the JSON only changes when the site is rebuilt, so the baked-in page is the better default. The live version earns its place if the data is ever updated separately from the site (say, a scheduled job that refreshes prices, or data hosted elsewhere). To drop it, delete `src/pages/live/` and `src/scripts/live.js`.

## Setup

1. Push to a GitHub repository.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.** Every push to `main` builds and deploys. The workflow sets the base path, so `https://<you>.github.io/<repo>/` works without config changes.
3. **Create the label `new-printer`** (Issues → Labels). The form applies it and the bot only runs on issues that have it; GitHub silently drops labels that don't exist.
4. **Settings → Actions → General → Workflow permissions:** choose *Read and write* and tick *Allow GitHub Actions to create and approve pull requests*.
5. Optional: to add an Amazon Associates tag to every Amazon link, add a repository variable `AMAZON_TAG` (Settings → Secrets and variables → Actions → Variables).

Local development needs Node 22.12 or newer:

```
npm install
npm run dev       # live-reloading dev server
npm run build     # writes dist/
npm run preview   # serves dist/
npm run images    # normalizes photos in src/assets/printers/
```

## Styling

Tailwind utilities in the markup, with a small vocabulary defined in `src/styles/global.css`:

- **Tokens** (`@theme`): colors (`bg-page`, `text-muted`, `border-line`, the dark `vp-*` viewport colors…), the in-between type sizes `text-2xs` / `text-label` / `text-body` / `text-lead`, `max-w-page` and `rounded-panel`. Light values are in `@theme`, dark overrides in the one `prefers-color-scheme` block below it.
- **Filament color:** each printer's brand color is set as `--c` on its row, and the `filament` color reads it, so `bg-filament`, `text-filament`, `border-filament` and `bg-filament/16` all follow the printer.
- **Components** (`@utility`, built with `@apply` so they stay tied to the tokens): `chip` (toggle chip around a hidden checkbox), `btn` (outline pill), `btn-ink` (solid pill; add the size where it's used), `peer-ring` (focus ring for the visible part of a hidden input), `col-head`, `cols` (the shared row grid), `type-display`, `no-scrollbar`. They work in `app.js` template strings too.
- **Custom CSS** (`@layer components`, nested): the layered headline, the isometric cubes and plate, row states, spec lists and the comparison's "Best" highlight.

When a value repeats, make it a token or component; one-off arbitrary values (the headline's `clamp()`, grid templates) are fine in place.

## Units

The data is always stored in metric. Every measurement on the page is rendered in both systems (`src/lib/units.mjs`), and CSS shows one based on `<html data-units="metric|us">`. That means:

- **No flash of the wrong units.** A tiny inline script in `<head>` picks the units before the first paint: the visitor's saved choice, otherwise US units for US-locale browsers (`en-US` and the like) and metric for everyone else.
- **Switching is instant.** It flips one attribute and never re-renders the list.
- The same module formats text built in the browser (plate caption, comparison sheet), so it always matches.

To change how something is shown (decimal places, or $/ft³ vs another volume unit), edit `KINDS` in `src/lib/units.mjs`. Sorting, filters and "best" highlighting all work on the metric numbers, so they're unaffected.

The issue form accepts either system too: `10.1 in`, `12.6"`, `572 F`, `19.7 in/s` and `27.5 lb` are converted to metric, and bare numbers are read as metric. Manufacturers usually publish metric specs, so converted values can be a fraction off (13.8 in becomes 350.5 mm, not 350). The pull request lists the stored values so you can tidy them before merging.

## Photos

Every photo is normalized before it's committed, so they all look like one set and stay small in the repository (typically 20–60 KB each):

- EXIF rotation is applied, then all metadata is stripped.
- A plain backdrop (white, grey or transparent) is trimmed, and the printer is centered on a **square** canvas with even padding, then flattened onto white.
- A photo without a plain backdrop (a printer on a desk) is cropped to a square around the subject instead of being letterboxed.
- Output is WebP, at most 800 × 800. Small sources are never upscaled.

The issue bot does this automatically and notes the before and after sizes in the pull request. For photos you add by hand, drop any JPEG/PNG/WebP/AVIF into `src/assets/printers/` (named after the printer's id), set `"image"` in the data, and run `npm run images`. It converts the file, deletes the original, and updates `printers.json`. Files that are already normalized are skipped, so it's safe to run anytime; `npm run images -- --force` re-processes everything (only worth it from good originals, since WebP is lossy). Settings are at the top of `scripts/lib/image.mjs`.

**Photo not showing?** The build prints a warning naming any printer whose photo it can't find, and the files it did find. Check that:

- the file is in `src/assets/printers/` (not `public/` or an old `images/` folder),
- `"image"` in `printers.json` matches the file name, or leave `"image"` out and name the file after the printer's id (`bambu-lab-p1s.webp`), which is found automatically. Matching ignores upper/lower case, so `.JPG` works,
- the file is committed. The bot's pull requests include it; photos added by hand need `git add`.

Image URLs are relative, so they work on a user site, under `/<repo>/`, or on a custom domain without any base-path setting.

The build then makes two small versions for the page (112 px thumbnails and 320 px for the comparison), so the 800 px files are never sent to visitors.

## Page size

About 18 KB gzipped for 10 printers, made up of roughly: CSS 6 KB, script 4.5 KB (including the plate drawing code), and about 225 bytes per printer. Adding printers barely moves it (100 printers is roughly +20 KB).

What matters most for speed is the first ~14 KB, which a new connection delivers in its first round trip: the page is ordered so the whole first screen fits in it, and the script (which only adds interactivity) comes last.

Tailwind is limited to scanning the site's own folders under `src/` (see the top of `src/styles/global.css`; add any new folder there, or its classes won't be generated). Scanning the whole repo made it generate utilities for words in the README and scripts, like `shadow` and `filter`, that the page never uses.

## Store links

Links are cleaned at build time and when submitted:

- Amazon links become `https://www.amazon.<tld>/dp/<ASIN>` (a 290-character search-result link turns into 40 characters). `amzn.to` and `a.co` short links are expanded by the bot first. Search links keep only the search term.
- Other links lose tracking parameters like `utm_*`, `gclid` and `fbclid`.

## Adding printers

Through the site: **Suggest a printer** opens the issue form. The bot validates the answers, normalizes the photo into `src/assets/printers/`, checks that the site still builds, and opens a pull request that closes the issue when merged. If something's wrong it comments on the issue instead, and editing the issue re-runs it. Submitting a brand + model that already exists updates it (handy for price changes).

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

Only `id`, `brand`, `model`, `technology`, `build_volume` and `links` are required. `image` is a file name in `src/assets/printers/` (or a full https URL, which is used as-is without optimization). Brand colors are assigned automatically.

Calculated at build time: largest cube, volumes in litres, price per litre, **space efficiency** (build volume as a share of the machine's outer box), and **estimated filaments** (from max temperatures and enclosure).

The sample printers are placeholders. Prices and specs are approximate, links go to brand home pages and Amazon searches, and there are no photos. Replace them with checked numbers and real product pages.

## Notes on the bot

- Anyone who can open issues can trigger a pull request, but nothing reaches the site until you merge. To limit it to collaborators, add `&& contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.issue.author_association)` to the job's `if:`.
- Pull requests opened with the default token don't trigger other workflows. The bot already builds the site before opening the PR, so that's covered. Merging to `main` deploys as usual.
- Images dragged into the form only download from public repositories.
