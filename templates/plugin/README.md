# __PLUGIN_NAME__

A [Selldoes](https://selldoes.com) plugin.

## Develop locally

```bash
npm install
npm run dev
```

The preview server opens at http://127.0.0.1:4590/<projectId> (the project's
internal id leads the URL, pages follow it) with:

- **Overview** — a checklist that walks you to publish
- **Details & permissions** — edit `plugin.json` (description, icon, screenshots, permissions) with undo
- **In Selldoes** — your marketplace card, listing page and the install dialog store owners see
- **Dashboard UI** — your `ui/` rendered exactly like the host does
- **Storefront** — widget and storefront pages with a mock store
- **API console** — call your declared routes with mock data
- **Jobs / Hooks** — run and fire them without deploying
- **Store data** — inspect and reset the mock database
- **Ask AI** — an assistant that reads your plugin and proposes file edits for review

The AI rightbar needs a provider key: set `OPENROUTER_API_KEY`,
`OPENAI_API_KEY` or `DEEPINFRA_API_KEY`, then restart `npm run dev`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Local preview server (Node runtime, mock `ctx`) |
| `npm run validate` | Check `plugin.json`, entries and routes |
| `npm run build` | Bundle to `dist/<slug>/` |
| `npm run pack` | Build + zip for manual upload |
| `npm run publish` | Upload + marketplace listing (`--app-url` + auth) |
| `npm run typecheck` | Type-checks with the SDK types |

## Runtime model

`index.js` runs inside the platform sandbox and may only use the APIs your
manifest declares permissions for. The dev server enforces the same permission
checks, store scoping and allowed-tables rules — so if it works locally, it
works in production (production additionally runs in QuickJS: avoid Node
globals like `process`, `Buffer` or `require`).

## Publish

```bash
# From your dashboard session (merchant flow):
SELLDOES_SESSION_COOKIE="session=…" npm run publish -- --app-url https://selldoes.com --store 123

# CI / first-party (service token):
npm run publish -- --app-url https://selldoes.com --token $SELLDOES_PUBLISH_TOKEN
```

New versions are immutable releases; bump `version` in `plugin.json` before
publishing again.
