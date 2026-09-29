# Developing Selldoes plugins

Everything needed lives in one package — [`selldoes`](https://www.npmjs.com/package/selldoes):

| Import | What it is |
|---|---|
| `selldoes` | Types for `plugin.json`, `PluginContext`, `PluginExports` + `definePlugin()` |
| `selldoes/theme` | The theme runtime (hooks + components) — see [developing-themes.md](developing-themes.md) |
| `selldoes` CLI | `create`, `dev`, `build`, `pack`, `validate`, `publish` |

## Quick start

```bash
npx selldoes create my-plugin       # asks: Plugin or Theme?
cd my-plugin
npm install
npx selldoes dev
```

## Anatomy

```
my-plugin/
  plugin.json          manifest — permissions, API routes, UI, storefront widget/pages
  index.js             runtime entry (sandboxed); exports apiRoutes / jobs / hooks / deliveryProvider
  ui/                  dashboard UI (sandboxed iframe), optional
    index.html
    app.js
  selldoes.config.json dev-server settings (store id/slug, mock AI, sample data)
  jsconfig.json        editor + typecheck config using the SDK types
```

## The local preview server

`selldoes dev` builds the runtime bundle and starts a preview server on
`http://127.0.0.1:4590/preview` — a React UI that mirrors the Selldoes
dashboard:

| Page | What it shows |
|---|---|
| **Overview** | A generated checklist (describe → preview → test → publish), quick job runs and what the manifest exposes |
| **Details & permissions** | Edit `plugin.json` from a form: name, description, icon (built-in picker or uploaded image), screenshots, category, tags and permissions (with the platform's risk/impact text). Saves are validated and undoable |
| **In Selldoes** | Exactly what store owners see: marketplace card, listing page (with screenshots), the install dialog and where your dashboard pages land in the sidebar |
| **Dashboard page** | Your `ui/entry` in a sandboxed iframe; without a UI, a faithful replica of the host's settings + jobs page |
| **Storefront** | A demo store with your `storefrontWidget` and every `storefrontPages` entry |
| **Jobs** | Run a declared job — chunked (`{ init, step, finalize }`) or a legacy function — with progress, per-item results and logs |
| **API console** | Pick a declared route, edit query/body, send and inspect JSON |
| **Hooks** | Fire `hooks[name]` with a payload |
| **Store data** | Inspect/reset the mock database (`.selldoes-dev/db.json`) |
| **Email / Realtime** | Calls made through `ctx.email.send` / `ctx.realtime.publish` |
| **Validate & publish** | Validation errors/warnings and the exact CLI commands per release step |

Everything the Details editor writes goes through `plugin.json` (backed up to
`.selldoes-dev/undo/`, restorable from the same page). Screenshots and custom
icons are stored in `screenshots/` and `assets/` inside the plugin and ship
with it.

### The AI rightbar

The **Ask AI** panel (top right) reads your manifest, validation output, file
tree and recent activity, then proposes edits as file diffs you approve before
anything is written. Set a provider key and restart `selldoes dev`:

```bash
export OPENROUTER_API_KEY="sk-or-…"   # or OPENAI_API_KEY / DEEPINFRA_API_KEY
```

or in `selldoes.config.json`:

```json
{ "assistant": { "provider": "openrouter", "model": "anthropic/claude-sonnet-4" } }
```

`assistant.apiKey` also works — keep that file out of git when it holds a key.
Every applied change is snapshotted under `.selldoes-dev/undo/`.

### Dev-server settings

`selldoes.config.json` also controls:

- `storeId` / `storeSlug` / `storeName` — the mock store identity.
- `port`, `host` — where the server listens.
- `ai.mockReply`, `email.disabled` — runtime mocks for `ctx.ai` / `ctx.email`.
- `sampleJobs` — prefill for the Jobs page and quick runs, e.g.
  `{ "import-products": { "input": { "url": "https://…" }, "maxTicks": 10 } }`.
- `assistant` — provider/model for the AI rightbar.

Settings entered into a plugin's `configSchema` form (Dashboard page → the
host-page replica) are persisted to `.selldoes-dev/settings.json` and merged
into `ctx.config`, so plugin code reads the same values the form shows.

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
sections), `jobs`, `hooks`, `configSchema`, `allowedTables`, plus listing
metadata: `icon` (a built-in icon name), `iconUrl` (a custom image inside the
plugin, e.g. `assets/icon.png`), `screenshots`, `tags` and `category`. The
Details editor in `selldoes dev` writes these for you.

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
SELLDOES_SESSION_COOKIE="session=…" npm run publish -- --app-url https://selldoes.com --store 123

# CI / first-party flow (service token):
npm run publish -- --app-url https://selldoes.com --token $SELLDOES_PUBLISH_TOKEN
```

Publishing writes an **immutable release** (`releases/<slug>/<version>/`) and
upserts the marketplace listing as `pending`. Once an admin approves, installed
stores see **Update available → Update now**. Bump `version` in `plugin.json`
for every release.

## Keeping the CLI up to date

Every command except `help`, `version` and `update` checks npm for a newer
`selldoes` and prints a one-line notice when one exists. Update in place:

```bash
selldoes update           # checks, then asks before installing
selldoes update --check   # report only (exit 1 when outdated)
selldoes update --yes     # no prompt (scripts/CI)
```

The check is capped at one second and never blocks work when offline. Set
`SELLDOES_NO_UPDATE_CHECK=1` to disable it. `selldoes update` detects whether
you run a global install (`npm install -g`) or a project dependency
(`npm install -D`) and uses the matching command.

## Releases

The `selldoes` package is published from CI (`.github/workflows/publish.yml`)
when a version tag is pushed:

```bash
npm version patch              # or edit package.json
git push && git push --tags    # tag like v0.3.1 → published with provenance
```

The workflow compiles the plugin types (`npm run build`), publishes to npm and
needs the `NPM_TOKEN` repository secret. Plugin projects live in their own
repositories — start one with `npx selldoes create`.
