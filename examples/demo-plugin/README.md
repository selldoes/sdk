# Demo Plugin

A worked example of everything a Selldoes plugin can do — used as the default
target of `npm run dev` in this repository and by the VS Code launch configs.

It is a normal plugin project: point `selldoes dev` at it (or open the folder
itself in a terminal) and every preview page has something to show.

## What it demonstrates

| Piece | Where to look in the preview |
|---|---|
| Notes CRUD in an own table (`ctx.db`) | **API console** → `GET/POST/DELETE /notes` |
| Store snapshot (`ctx.products`) | **API console** → `GET /stats`, dashboard UI |
| AI calls (`ctx.ai.complete`) | **API console** → `POST /blurb`, **Jobs** → Generate blurbs |
| Chunked job (`init`/`step`/`finalize`) | **Jobs** → Import products (progress, items, logs) |
| Legacy function job | **Jobs** → Generate blurbs |
| Hook | **Hooks** → `demo:ping` |
| Settings form (`configSchema`) | **Dashboard page** → the host settings replica, then Save |
| Dashboard UI (`ui/entry`) | **Dashboard page** iframe |
| Storefront widget (`storefrontWidget`) | **Storefront** → bottom-right bubble |
| Public route (`publicRoutes`) | widget's "hello" call |
| Listing metadata (icon, screenshots, tags) | **Details & permissions**, **In Selldoes** |

## Run it

From the repository root:

```bash
npm run dev          # node bin/selldoes.mjs dev --dir examples/demo-plugin
npm run dev -- --port 4600   # if 4590 is taken
```

Or directly:

```bash
node bin/selldoes.mjs dev --dir examples/demo-plugin --open
```

Then open http://127.0.0.1:4590/preview. Try the checklist: run **Import
products** from the Overview, send a request in the **API console**, fire the
hook, and check **In Selldoes** for the listing preview.

## Publish (only if you want to)

The manifest is intentionally generic (`demo-plugin`). To publish your own copy,
change `slug`, `name` and `author` first — the slug is permanent.
