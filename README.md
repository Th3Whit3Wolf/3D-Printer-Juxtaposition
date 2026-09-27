# 3D printer comparison

A static site for GitHub Pages that lists 3D printers, lets visitors filter and sort them, and compares up to four side by side on price, build volume and largest printable cube (the smallest of X, Y and Z, cubed).

New printers come in through an issue form. Submitting it runs a GitHub Action that turns the answers into a pull request editing `data/printers.json`.

## Files

```
index.html                         page
styles.css                         styles (light and dark)
app.js                             filtering, sorting, comparison
data/printers.json                 the printer list
images/                            printer photos (added by the bot or by hand)
.github/ISSUE_TEMPLATE/add-printer.yml     the issue form
.github/workflows/printer-from-issue.yml   issue -> pull request
scripts/add-printer-from-issue.mjs         parses the form, updates the JSON
.nojekyll                          tells Pages to serve files as-is
```

## Setup

1. **Push these files** to a new public repository on GitHub.
2. **Turn on Pages**: Settings → Pages → Build and deployment → Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)`. The site appears at `https://<you>.github.io/<repo>/`.
3. **Create the label** `new-printer` (Issues → Labels → New label). The form applies it automatically, and the workflow only runs on issues that have it. GitHub silently skips labels that don't exist yet, so this step matters.
4. **Let Actions open pull requests**: Settings → Actions → General → Workflow permissions → choose *Read and write permissions* and tick *Allow GitHub Actions to create and approve pull requests*.

That's it. The "Suggest a printer" button on the site links to the form automatically when served from `*.github.io`. On a custom domain, set `owner` and `repo` at the top of `app.js`.

## How the issue → pull request flow works

1. Someone opens an issue with the **Add or update a 3D printer** form.
2. The workflow reads the answers, checks them, and either
   - opens a pull request on branch `printer/issue-<number>` and comments the link on the issue, or
   - comments on the issue listing what needs fixing.
3. Editing the issue re-runs the workflow and updates the same pull request.
4. The pull request says `Closes #<number>`, so merging it closes the issue. Pages redeploys and the printer appears.

If a brand + model already exists, the pull request updates that entry instead of adding a duplicate (handy for price changes).

Images: the bot downloads the image (direct link or one dragged into the form) into `images/<id>.<ext>`. If the download fails, it links the remote image instead and says so in the pull request. Drag-and-drop uploads only download from **public** repositories.

Anyone who can open issues can trigger a pull request, but nothing reaches the site until you merge. To limit it to people you trust, add `&& contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.issue.author_association)` to the job's `if:` line.

Pull requests opened with the default `GITHUB_TOKEN` don't trigger other workflows. That's fine here, but if you add CI checks later, use a personal access token or GitHub App token in the `token:` input of `create-pull-request`.

## Data format

Each entry in `data/printers.json`:

```json
{
  "id": "bambu-lab-p1s",
  "brand": "Bambu Lab",
  "model": "P1S",
  "price": 649,
  "price_updated": "2026-09-27",
  "technology": "FDM",
  "enclosed": true,
  "multi_material": false,
  "build_volume": { "x": 256, "y": 256, "z": 256 },
  "image": "images/bambu-lab-p1s.jpg",
  "links": [
    { "label": "Official store", "url": "https://..." },
    { "label": "Amazon", "url": "https://..." }
  ],
  "added": "2026-09-27"
}
```

`price`, `image` and `price_updated` are optional. Prices are in USD (change `currency` in `app.js` to switch). Largest cube, volumes and price per litre are calculated in the browser.

The included printers are starting examples. Their prices are rough list prices and their links go to the brand's home page and an Amazon search, so check and replace them with real product pages and photos.

## Run it locally

`fetch()` doesn't work from `file://`, so serve the folder:

```
python3 -m http.server
```

then open http://localhost:8000.
