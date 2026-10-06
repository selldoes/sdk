# __PLUGIN_NAME__

A worked example of **`ctx.ai` + `ctx.products`**: walk the catalog, find
products that need copy, rewrite descriptions and bullet points through the
store's AI provider.

## How it works

1. **Collect** — `init` pages through `ctx.products.list()` and keeps only the
   ids that need copy (missing/short description or bullets).
2. **Generate** — one product per `step`: two `ctx.ai.complete()` calls (HTML
   description + plain-text bullets), then `ctx.products.update()`.
3. **Report** — every product lands in the job transcript as an item, and the
   job returns a `{ generated, failed }` summary.

The host checkpoints state between steps, so a 5,000-product pass survives
pauses, restarts and time limits. Tune `onlyMissing`, `maxProducts`,
`bulletCount` and the writing instructions from the dashboard settings panel.

## Try it

```bash
npm install
npx selldoes dev      # Store data seeds a few products; run "Generate product copy"
```

With `ai.mockReply` set in `selldoes.config.json` the AI calls return the mock
string, so the job is fully local. Remove it (and set a provider key) to use
the real model.

## Make it yours

- Swap the prompt in `generateForProduct()` for your own voice guide.
- Add a `category` filter to `findCandidates()`.
- Fan out with `ctx.jobs.enqueue({ type, input })` if you want one job per
  product instead of one step per product.
