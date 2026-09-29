# __PLUGIN_NAME__

A [SellDesk](https://selldoes.com) plugin.

## Develop locally

```bash
npm install
npm run dev
```

The preview server opens at http://127.0.0.1:4590/preview with:

- **Dashboard UI** — your `ui/` rendered exactly like the host does
- **Storefront** — widget and storefront pages with a mock store
- **API console** — call your declared routes with mock data
- **Jobs / Hooks** — run and fire them without deploying
- **Data** — inspect and reset the mock database

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
SELDESK_SESSION_COOKIE="session=…" npm run publish -- --app-url https://selldoes.com --store 123

# CI / first-party (service token):
npm run publish -- --app-url https://selldoes.com --token $SELDESK_PUBLISH_TOKEN
```

New versions are immutable releases; bump `version` in `plugin.json` before
publishing again.
