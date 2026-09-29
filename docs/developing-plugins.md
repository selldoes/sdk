# Developing SellDesk plugins

Everything needed to build, preview and publish a plugin lives in this repo:

| Package | What it is |
|---|---|
| [`@selldesk/plugin-sdk`](../sdk/) | Types for `plugin.json`, `PluginContext`, `PluginExports` + `definePlugin()` |
| [`@selldesk/plugin-cli`](../cli/) | `selldesk-plugin dev/build/pack/validate/publish` — includes the local preview server |
| [`create-selldesk-plugin`](../create-plugin/) | `npm create selldesk-plugin` scaffolder |

## Quick start

```bash
npm create selldesk-plugin@latest my-plugin
cd my-plugin
npm install
npm run dev
```

## Anatomy

```
my-plugin/
  plugin.json          manifest — permissions, API routes, UI, storefront widget/pages
  index.js             runtime entry (sandboxed); exports apiRoutes / jobs / hooks / deliveryProvider
  ui/                  dashboard UI (sandboxed iframe), optional
    index.html
    app.js
  selldesk.config.json dev-server settings (store id/slug, mock AI, sample data)
  jsconfig.json        editor + typecheck config using the SDK types
```

## The local preview server

`npm run dev` builds the runtime bundle and starts a preview server on
`http://127.0.0.1:4590/preview`:

| Tab | What it shows |
|---|---|
| **Overview** | Manifest summary, rebuild button, developer notes |
| **Dashboard UI** | Your `ui/entry` in a sandboxed iframe, exactly like the host, talking to `/api/plugin-api/<slug>/**` with a mock store |
| **Storefront** | A demo store with your `storefrontWidget` and every `storefrontPages` entry |
| **API console** | Pick a declared route, edit query/body, send and inspect JSON |
| **Jobs** | Run a declared job to completion — chunked (`{ init, step, finalize }`) or a legacy function — with progress, per-item results and logs |
| **Hooks** | Fire `hooks[name]` with a payload |
| **Data** | Inspect/reset the mock database (`.selldesk-dev/db.json`) |
| **Email / Realtime** | Calls made through `ctx.email.send` / `ctx.realtime.publish` |

The mock context enforces the same rules as production: permissions must be
declared, tables must be in `allowedTables` (or plugin-owned), rows are
store-scoped, and condition operators (`like`, `in`, `ne`, `gt/gte/lt/lte`,
`null`) behave identically. The one difference: the dev server executes your
code in Node, while production uses a QuickJS sandbox — avoid Node globals
(`process`, `Buffer`, `require`, `fs`) in plugin code.

## Runtime capabilities

| Permission | Grants |
|---|---|
| `db:read` / `db:write` | Read/write permitted tables + own `plugin_<slug>_*` tables |
| `db:schema` | `ctx.db.ensureTable(name, columns)` |
| `api:external` | `ctx.http.get/post` (10s timeout) |
| `ai:use` | `ctx.ai.complete` / `ctx.ai.image` |
| `email:send` | `ctx.email.send` through the platform SMTP |
| `files:read` / `files:write` | `ctx.files` (S3 media) |
| `products:read` / `products:write` | `ctx.products` |
| `realtime:publish` | `ctx.realtime.publish/poll` |
| `webhooks:register`, `sections:register`, `dashboard:pages` | Platform integrations |

Manifest extras: `ui` (dashboard iframe), `storefrontWidget` (bubble on every
storefront page), `storefrontPages` (public pages such as `/kb`),
`publicRoutes` (visitor-callable API, no session), `delivery` (order-detail
sections), `jobs`, `hooks`, `configSchema`, `allowedTables`.

## Background jobs

Jobs declared in `jobs` are chunked: export a handler per type and the host
calls `step` until it returns `done: true`, checkpointing the returned `state`
between ticks (survives pauses, restarts and tick-budget timeouts).

```js
module.exports = {
  jobs: {
    "sync-notes": {
      init(input, ctx) {
        return { cursor: 0 } // initial state
      },
      async step(state, ctx) {
        const rows = await ctx.db.select("notes", {}, { limit: 1, offset: state.cursor })
        if (rows.length === 0) return { state, done: true, result: { total: state.cursor } }
        await ctx.jobs.item({ ref: String(rows[0].id), status: "ok" })
        await ctx.jobs.progress({ processed: state.cursor + 1, total: state.cursor + 1 })
        return { state: { cursor: state.cursor + 1 }, done: false }
      },
      finalize(state, ctx) {
        ctx.jobs.log(`synced ${state.cursor} note(s)`)
        return { synced: state.cursor }
      },
    },
  },
}
```

Inside steps, `ctx.jobs.progress()`, `ctx.jobs.item()` and `ctx.jobs.log()`
report to the job row; step results may also include `progress`. The preview
server's **Jobs** tab runs handlers against the mock context and renders
progress, items and logs. A legacy `async (input, ctx) => …` function is still
supported.

## npm dependencies

Plugins may declare npm dependencies (registry version ranges only, max 25) in
the manifest. The platform installs them at publish time (scripts disabled),
rejects native addons and inlines everything into the sandbox bundle (4 MB
limit). Only a small allow-list of pure-JS Node builtins is available at
runtime (`buffer`, `crypto`, `events`, `stream`, `string_decoder`, `url`,
`util`, …) and the QuickJS lane has no `require` at all — avoid packages that
need `fs`, `net`, `http` or other Node-only APIs. For local development add a
plugin-local `package.json` and `npm install`, because the CLI's `build`/`dev`
bundle with the local `node_modules`.

## Build & publish

```bash
npm run validate
npm run build          # dist/<slug>/ + bundle.js
npm run pack           # dist/<slug>.zip for manual upload

# Merchant flow (upload to your store, then submit for review):
SELDESK_SESSION_COOKIE="session=…" npm run publish -- --app-url https://selldoes.com --store 123

# CI / first-party flow (service token):
npm run publish -- --app-url https://selldoes.com --token $SELDESK_PUBLISH_TOKEN
```

Publishing writes an **immutable release** (`releases/<slug>/<version>/`) and
upserts the marketplace listing as `pending`. Once an admin approves, installed
stores see **Update available → Update now**. Bump `version` in `plugin.json`
for every release.

## Releases

The SDK packages are published from CI (`.github/workflows/npm-publish.yml`)
when a version tag is pushed:

| Tag | Package |
|---|---|
| `sdk-v<version>` | `@selldesk/plugin-sdk` |
| `cli-v<version>` | `@selldesk/plugin-cli` |
| `create-v<version>` | `create-selldesk-plugin` |

Bump the version in the package's `package.json`, push the tag, and the
workflow builds and publishes it with provenance (requires the `NPM_TOKEN`
repository secret).

This repo hosts the SDK, the CLI and the scaffolder only — plugin projects live
in their own repositories (start one with `npm create selldesk-plugin`).
