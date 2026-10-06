# __PLUGIN_NAME__

A working **product importer** — the SDK's end-to-end scraping example. It
scans a listing page, follows pagination, parses each product page and creates
store products with artwork, variants and optional AI copy.

## How it works

```
listing page ──► product URLs ──► one product per job step ──► store products
   (ctx.http)                      (chunked, checkpointed)     (ctx.products)
```

- **Chunked jobs** — `import-products` fetches the listing once, then imports
  one product per `step`. The host checkpoints state after every step, so an
  import survives pauses, restarts and time limits. Close the page and re-open
  it; the job resumes where it stopped.
- **Artwork** — images are re-hosted through `ctx.files` (original or AI).
- **AI copy** — optional description + bullet points via `ctx.ai`, and an
  optional AI main image from a saved prompt.
- **Skip / refresh** — existing SKUs are skipped or updated; `refresh-products`
  patches only price, variants and categories so hand-edited copy survives.
- **Dashboard** — the sidebar page runs every job with one click, shows the
  latest products and the settings form. The **Status** page reads `/status`
  and `/recent` (see `ui/status.html`).

## Make it yours

This example targets OTRCat. Adapt one of these in `index.js`:

| Function | Job |
|---|---|
| `extractProductUrls(html)` | pulls product URLs out of a listing page |
| `findNextPageUrl(html)` | follows pagination |
| `parseProductPage(html, url)` | maps a product page to `{ title, price, variations, volumes, … }` |
| `buildVariationGroups(...)` / `buildCustomAttributes(...)` | shapes the store payload |

The pipeline, queueing, AI steps and product writes stay the same. The parser
uses targeted regexes because the QuickJS sandbox has no `node_modules`; a Node
job entry (`"runtime": "node"`) could use cheerio instead.

## Settings

Everything is configurable from the dashboard without touching code — listing
URL, product cap, price multiplier, status, image/AI options and the optional
HTML proxy. Configure them from the **settings** section on the main page.

## Develop

```bash
npm install
npx selldoes dev     # run Test fetch first, then Preview a parse, then Import
```

Mock AI replies come from `selldoes.config.json`; `sampleJobs` prefills the
Jobs page. `npm run typecheck` checks `index.js` against the SDK types.
