# Developing Selldoes plugins

Everything needed lives in one package — [`selldoes`](https://www.npmjs.com/package/selldoes):

| Import | What it is |
|---|---|
| `selldoes` | Types for `plugin.json`, `PluginContext`, `PluginExports` + `definePlugin()` |
| `selldoes/theme` | The theme runtime (hooks + components) — see [developing-themes.md](developing-themes.md) |
| `selldoes` CLI | `create`, `dev`, `build`, `pack`, `validate`, `bump`, `publish` |

## The workspace-first flow

The SDK remembers your projects per machine (`~/.selldoes/workspace.json`), so
you run the tooling from anywhere — the plugin folder is just a path. In the
dev shell the **sidebar workspace switcher** is a dropdown (like the
dashboard's store switcher): your projects, restart/open/remove for the
current one, then **New workspace** — a three-step dialog (start → details →
options) that scaffolds template or AI projects, imports a folder/.zip, or
pulls a package you own. It doubles as onboarding when the workspace is
empty; switching is in-place — the shell proxies to whichever project's
preview is selected:

```bash
selldoes                       # dev shell + browser: sidebar switcher, onboarding when empty
selldoes home                  # the same launcher, in your terminal
selldoes import ~/code/my-plugin   # folder or .zip → registered in the workspace
selldoes login --token sk_dev_…    # developer account (portal → API tokens)
selldoes pull my-plugin            # download a package your account owns, keep developing
selldoes remove my-plugin          # unregister it (files stay on disk; --delete-files deletes the folder)
selldoes delete my-plugin          # delete its developer workspace copy on the platform
```

`dev`, `build`, `validate`, `bump` and `publish` work from inside a project
exactly as before; run them outside one and you land in the workspace instead
of an error.

### Create with AI

Describe the plugin instead of filling a template — the model writes
`plugin.json`, the entry and (when useful) a dashboard UI. Output is
**validated before a single file is written** (valid manifest, declared slug,
entry present), with one automatic retry that feeds the error back:

```bash
selldoes create my-plugin --ai "a plugin that syncs orders to a Google Sheet"
```

The web workspace's **Create → Describe AI** runs the same pipeline.

### The assistant in your terminal

```bash
selldoes ask "add a /stats API route that counts rows"   # one-shot
selldoes ask                                             # interactive chat
selldoes ask "…" --yes                                   # apply proposed edits without prompting
```

Edits are shown with sizes (and `--dry-run` never writes); applying re-validates
and reports the result.

## Quick start (template lane)

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
  server/              Node job entries, optional (full Node — npm, fs, native addons)
  ui/                  dashboard UI (sandboxed iframe), optional
    index.html         page 1 — wired via ui.entry + dashboardPages[0].entry
    app.js             plain-JS pages share this script (React: ui/src/*.tsx → ui/assets/*.js)
    about.html         page 2 — one .html per dashboardPages entry
  selldoes.config.json dev-server settings (store id/slug, mock AI, sample data)
  jsconfig.json        editor + typecheck config using the SDK types
```

## Dashboard UI

Every plugin created from the templates ships a working **notes example** —
plain JS (`ui/index.html` + `ui/app.js`) or React + TypeScript
(`ui/index.html` + `ui/src/index.tsx`, bundled by esbuild on every save). The
host renders it in a sandboxed iframe; the UI calls
`/api/plugin-api/<slug>/<route>` with `storeId`/`storeSlug` query params.

**Multiple pages.** Each `dashboardPages[]` item may declare its own `entry`
(plugin-root-relative, under `ui/`); pages without an entry fall back to
`ui.entry`:

```json
{
  "ui": { "entry": "ui/index.html", "title": "My Plugin" },
  "dashboardPages": [
    { "label": "My Plugin", "path": "/", "icon": "puzzle", "entry": "ui/index.html" },
    { "label": "Settings", "path": "/settings", "icon": "settings", "entry": "ui/settings.html" }
  ]
}
```

For plain JS, each entry is just another HTML file under `ui/`. For React, a
page entry `ui/<name>.html` is bundled from `ui/src/<name>.tsx` (or `.ts`/`.jsx`/`.js`)
into `ui/assets/<name>.js` — if the HTML file is missing, the build generates a
shell for it. The **Dashboard page** preview shows a sidebar-style page rail;
`?page=/settings` deep-links a page.

**When an entry is missing** (deleted file, typo in `plugin.json`), the
preview shows a friendly fallback page in the iframe plus a callout with a
**Create** button — it scaffolds the default notes example for that page,
wires `plugin.json` (snapshot first, one undo reverts everything) and rebuilds.
The same button appears when a plugin has no `ui.entry` at all.

### No-code components (kit)

A `dashboardPages` item may declare `sections` instead of (or alongside) an
iframe entry — the preview renders them with the shared **kit** (no iframe),
the same idea as the store's section registries:

```json
{
  "label": "Reports",
  "path": "/reports",
  "sections": [
    { "type": "stats", "settings": { "items": [{ "label": "Rows", "value": "42" }] } },
    { "type": "table", "settings": { "route": "/stats", "columns": ["sku", "price"] } },
    { "type": "job", "settings": { "job": "import-products", "maxTicks": 20 } },
    { "type": "settings" }
  ]
}
```

Kit types: `text` (markdown), `stats`, `table` (your `apiRoutes` path — the
handler returns an array or `{ rows: [...] }` / `{ items: [...] }`), `job`
(run button + live transcript), `settings` (renders `configSchema`), `logs`,
`links`. Pages with `sections` need no `entry`; keep one as a fallback for
hosts that render iframes.

**Add/Edit components** on the Dashboard page opens the visual builder:
component palette on the left (click or drag onto the canvas), a live preview
in the middle (the exact kit renderer the host uses), and a settings inspector
on the right. It ships starter templates (Reports, About, Ops, Settings),
drag/arrow reordering, duplicate/delete, an optional per-section `id`, and a
**JSON** tab that stays in sync with the canvas for raw edits. **Save** writes
`dashboardPages[].sections` through the normal manifest pipeline — validated,
snapshotted and undoable (the builder's Undo button restores the previous
`plugin.json`).

**New page → Components** creates a kit-only page (a `dashboardPages` entry
with `sections: []` and no `entry`) and opens the builder; **New page → HTML**
scaffolds the notes example under `ui/` as before. You can also ask the AI
assistant ("add a stats row", "show /stats as a table"), which rewrites
`dashboardPages[].sections` through the normal manifest-edit pipeline.

### Creation buttons

The Dashboard page has **New page / New job / New hook / New route** buttons.
New page can create a **Components** page (kit-only, no `entry` — opens the
visual builder) or an **HTML** page (the notes example under `ui/`). Jobs,
hooks and routes codegen readable modules (`jobs/<type>.js`,
`hooks/<name>.js`, `routes/<path>.js`), patch `plugin.json` and append an
idempotent wiring block to the entry (`// <selldoes-scaffold:…>` markers,
inlined by esbuild) — then rebuild. Everything is snapshotted: one undo
reverts the whole scaffold.

## The local preview server

`selldoes dev` builds the runtime bundle and starts a preview server on
`http://127.0.0.1:4590/<projectId>` (the project's internal id leads the URL,
pages follow: `/{projectId}/settings`, …) — a React UI that mirrors the
Selldoes dashboard:

| Page | What it shows |
|---|---|
| **Overview** | A generated checklist (describe → preview → test → publish), quick job runs and what the manifest exposes |
| **Code** | The built-in editor: file tree, tabs, Monaco with the SDK's own types (IntelliSense for `definePlugin`, routes, jobs), save → rebuild, git changes with diffs and commit, quick open |
| **Packages** | Search npm, add/remove dependencies (installs + writes `plugin.json`), and rate each package against the sandbox — ✅ works, ⚠️ works with care, ❌ not allowed, with the reason |
| **Console** | Live dev-server logs and build errors — click a `file:line` error to open it in the editor |
| **Details & permissions** | Edit `plugin.json` from a form: name, description, icon (built-in picker or uploaded image), screenshots, category, tags and permissions (with the platform's risk/impact text). Saves are validated and undoable |
| **In Selldoes** | Exactly what store owners see: marketplace card, listing page (with screenshots), the install dialog and where your dashboard pages land in the sidebar |
| **Dashboard page** | Your dashboard UI in a sandboxed iframe, with a page rail for every `dashboardPages` entry; pages with `sections` render from the no-code kit and open in the visual components builder (palette, live canvas, inspector, templates, JSON tab); missing pages get a one-click "scaffold the notes example" button. Without a UI, a faithful replica of the host's settings + jobs page (plus the same scaffold button) |
| **Storefront** | A demo store with your `storefrontWidget` and every `storefrontPages` entry |
| **Jobs** | Run a declared job — chunked (`{ init, step, finalize }`) or a legacy function — with progress, per-item results and logs |
| **API console** | Pick a declared route, edit query/body, send and inspect JSON |
| **Hooks** | Fire `hooks[name]` with a payload |
| **Store data** | Inspect/reset the mock database (`.selldoes-dev/db.json`) |
| **Email / Realtime** | Calls made through `ctx.email.send` / `ctx.realtime.publish` |
| **Validate & publish** | One-click release: current version with the predicted bump, a bump-before-publish checkbox (patch/minor/major), release notes and a Publish button that builds, uploads and sends the listing to review through your connected developer account. Validation errors/warnings and the equivalent CLI commands are right there |
| **Settings (Project)** | Project identity + accent color, local danger zone (remove from workspace / delete files from disk), default release bump (patch/minor/major, saved per project, overrides the User settings fallback), the assistant **model** override (provider/key stay in User settings), dev-server config (`selldoes.config.json`: mock store identity, port, mocks) and the local danger zone (reset mock data / clear undo snapshots) |
| **Settings (User — header icon)** | Machine-level: assistant provider + API key (`~/.selldoes/settings.json`, applies to every project — never stored in a project folder), the developer account's packages (pull / update in place / delete workspace copy), the theme-lane API key, the workspace registry (default project directory, project list, clear registry), the default editor for `selldoes open` and the default release-bump fallback |

Everything the Details editor writes goes through `plugin.json` (backed up to
`.selldoes-dev/undo/`, restorable from the same page). Screenshots and custom
icons are stored in `screenshots/` and `assets/` inside the plugin and ship
with it.

### The code editor

The **Code** page is a complete edit loop in the browser:

- **Monaco** (the VS Code editor) with the SDK's shipped `dist/index.d.ts`, so
  `import { definePlugin } from "selldoes"` autocompletes and `plugin.json`
  validates against a schema.
- **File tree + tabs**; `plugin.json`, entry files and UI sources are all
  editable. Cmd/Ctrl+P quick-opens any file, Cmd/Ctrl+Shift+F searches the
  project, and Cmd/Ctrl+K opens the shell's command palette.
- **Save = rebuild.** Cmd/Ctrl+S writes the file (snapshotted first), triggers
  the esbuild rebuild and reports validation + build errors right in the
  editor; build errors also appear as Monaco markers when the location is
  known.
- **External changes stay in sync** (file watcher → SSE): AI applies and edits
  from your own editor refresh clean tabs, and dirty tabs get a conflict
  banner instead of being clobbered.
- **Git panel**: changed files with status chips, stage/unstage, side-by-side
  diff against `HEAD`, commit, and "Initialize repository" when there is none.
- **Undo / History**: every save, manifest edit, AI apply and delete is
  snapshotted; the AI panel's **History** tab restores any point.
- Prefer your own editor? **Open in editor** (topbar, tab header, or
  `selldoes open <file>:<line>`) jumps straight to VS Code / Cursor / Windsurf
  (`$SELDOES_EDITOR` overrides detection).
- **Terminal** (Cmd/Ctrl+`) runs a real shell in the project folder — a PTY
  when `node-pty` is available, a piped fallback otherwise; “open OS terminal”
  is always one click away.

### The AI rightbar

The **Ask AI** panel (top right) reads your manifest, validation output, file
tree and recent activity, then proposes edits **as real per-file diffs** (the
current file content travels with each proposal) that you approve before
anything is written. Supported providers: OpenRouter, OpenAI, DeepInfra,
**Anthropic** (`ANTHROPIC_API_KEY`), **Gemini** (`GEMINI_API_KEY`) and
**Ollama** (local models — no key; `assistant.provider: "ollama"`). The
provider key is **machine-level**: set it in the environment, or in **User
settings** (the header icon — stored in `~/.selldoes/settings.json`, applied
to every project, never written into a project folder so nothing leaks into
git). A project can pin a different model in **Project settings → Assistant
model override** (`assistant.model` in `selldoes.config.json` — safe to
commit). Older SDK versions saved the full assistant section into each
project's `selldoes.config.json`; the workspace migrates those credentials up
to the user settings on startup (fill-if-unset).

```bash
export OPENROUTER_API_KEY="sk-or-…"   # or ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY / …
```

`assistant.baseUrl` (User settings) overrides the endpoint (proxies,
gateways, mock servers). Every applied change is snapshotted under
`.selldoes-dev/undo/`. The gear icon in the panel opens a **settings dialog**
(provider, model, key, base URL, "test connection") that writes the user
settings and applies immediately — no restart. Chat history persists per
project, and selecting code in the editor attaches the file + selection to
your next message ("Explain" / "Improve" shortcuts included).

**Closed loop**: the Apply card can run your plugin's test-like job (the first
declared job whose type matches `test`/`preview`/`probe`) after a successful
rebuild — the outcome lands in the chat, so the assistant sees whether its
change actually works. It skips the run (and says so) when the rebuild fails or
no test job is declared.

### Dev-server settings

`selldoes.config.json` also controls:

- `storeId` / `storeSlug` / `storeName` — the mock store identity.
- `port`, `host` — where the server listens.
- `ai.mockReply`, `email.disabled` — runtime mocks for `ctx.ai` / `ctx.email`.
- `sampleJobs` — prefill for the Jobs page and quick runs, e.g.
  `{ "import-products": { "input": { "url": "https://…" }, "maxTicks": 10 } }`.
- `assistant.model` — optional per-project model override; the provider, key
  and base URL live in the User settings (`~/.selldoes/settings.json`).

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
| `api:external` | `ctx.http.get/post` (60s default timeout, `opts.timeoutMs` capped at 60s) |
| `ai:use` | `ctx.ai.complete` / `ctx.ai.image` |
| `email:send` | `ctx.email.send` through the platform SMTP |
| `files:read` / `files:write` | `ctx.files` (S3 media) |
| `products:read` / `products:write` | `ctx.products` |
| `realtime:publish` | `ctx.realtime.publish/poll` |
| `secrets:read` | `ctx.secrets.get(name)` — per-install secrets, never bundled or logged |
| `storage:read` / `storage:write` | `ctx.storage` — plugin- and store-scoped JSON values |
| `webhooks:register`, `sections:register`, `dashboard:pages` | Platform integrations |

`ctx.secrets.get(name)` reads a value configured for the installation (for
example a `configSchema` field of type `secret`); values are never bundled with
the plugin or written to logs. `ctx.storage` is a small JSON store scoped to
the plugin **and** the store — use it for cursors, tokens and sync state
instead of assuming a persistent filesystem (jobs run in disposable sandboxes).

Manifest extras: `ui` (dashboard iframe; `ui.entry` + per-page
`dashboardPages[].entry`), `storefrontWidget` (bubble on every
storefront page), `storefrontPages` (public pages such as `/kb`),
`publicRoutes` (visitor-callable API, no session), `delivery` (order-detail
sections), `jobs`, `schedules`, `hooks`, `configSchema`, `allowedTables`, plus listing
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

### Node jobs

A job with `"runtime": "node"` runs **once** in a full Node environment instead
of the QuickJS sandbox: any npm package works there, including native addons,
`sharp`, `playwright` and `fs`. Keep the handler in its own entry file so
Node-only imports never reach the QuickJS bundle:

```json
"jobs": [
  { "type": "sync", "name": "Sync" },
  {
    "type": "scrape", "name": "Deep scrape", "runtime": "node",
    "entry": "./server/scrape.js", "timeoutMs": 600000, "memoryMb": 1024
  }
]
```

```js
// server/scrape.js — serverless-friendly headless Chromium.
// `playwright` itself downloads browsers in a postinstall script, which the
// platform disables; use playwright-core plus a browser build that ships as a
// regular dependency.
const chromium = require("@sparticuz/chromium")
const { chromium: playwright } = require("playwright-core")

module.exports = async (input, ctx) => {
  const browser = await playwright.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args,
  })
  // … your code, any npm package (sharp, mysql2, …) …
  await browser.close()
  await ctx.storage.set("last-scrape", Date.now())
  return { ok: true }
}
```

On a container/VM host tier the browsers can be installed into the image
(`npx playwright install --with-deps chromium`) and plain `playwright` works.

- The module's default export (or `module.exports =`) is the handler; it runs
  once and returns a JSON-serializable result.
- `ctx` is the same capability surface as QuickJS jobs — `ctx.db`, `ctx.http`,
  `ctx.products`, `ctx.files`, `ctx.ai`, `ctx.storage`, `ctx.secrets`,
  `ctx.jobs` — enforced by the host. The job never receives store credentials
  or direct database access.
- Limits: `timeoutMs` 1s–30min (default 5min), `memoryMb` 128–4096 (default
  512). Jobs are queued, and concurrent runs per store are capped by the
  platform. The host may enforce a lower cap than the manifest asks for (the
  current AWS tier runs up to 14 minutes with a ~0.9 GB heap); the
  [runtime contract](node-jobs-runtime.md) lists the exact numbers.
- `selldoes build`/`publish` ship `dist/node/<type>.cjs` plus your
  `package.json` and lockfile; the platform installs dependencies once into an
  immutable image per release, so native addons work. Commit the lockfile and
  declare every imported package in `plugin.json` `dependencies`.
- The preview's **Jobs** tab runs Node jobs in your local Node process — a
  normal `npm install` in the plugin directory is enough to test them.
- Platform implementers: the artifact and execution contract lives in
  [node-jobs-runtime.md](node-jobs-runtime.md).

### Schedules

Declare cron schedules that enqueue declared jobs:

```json
"schedules": [
  {
    "name": "nightly-sync", "job": "sync", "cron": "0 3 * * *",
    "timezone": "America/New_York", "input": { "full": true }
  }
]
```

- Five fields: minute, hour, day-of-month, month, day-of-week. Supports `*`,
  ranges (`9-17`), lists (`1,15`), steps (`*/15`, `0-30/10`) and three-letter
  names (`MON-FRI`, `JAN`). Day-of-week `0` and `7` are Sunday.
- `timezone` is an IANA name (default UTC); `enabled: false` keeps a schedule
  declared but paused.
- At most 10 schedules per plugin; every `job` must be declared in `jobs`.
- The preview's **Jobs** tab lists schedules with their next fire time and a
  **Run now** button. The host owns the real scheduler (enqueue, retries,
  overlap policy, per-store enable/disable in the dashboard).

## npm dependencies

Plugins can use npm packages. Add one from the dev shell's **Packages** page
(search npm, click Add — it installs, declares the dependency and rates it
against the sandbox) or from the CLI:

```bash
selldoes add cheerio          # installs + declares the installed version
selldoes add cheerio@^1.2.0   # or pin a registry range
```

Declared versions live in `plugin.json`
(`"dependencies": { "cheerio": "^1.2.0" }`, registry ranges only, max 25).
Keep the plugin-local `package.json` in sync with `npm install` — the CLI
bundles with the local `node_modules`.

**What the checker means**

Packages imported by the QuickJS entry are rated against the sandbox. Packages
that only Node jobs use are rated against the **real Node runtime** instead and
show a violet **Node** chip: the image installs them from your lockfile, so
native addons, `sharp` and `playwright` are fine there.

| Badge | Meaning |
|---|---|
| ✅ Works | Pure-JS or browser-compatible package: bundles cleanly and its top level loads in the sandbox |
| ⚠️ Works with care | Bundles, but large (close to the 4 MB limit) or has warnings |
| ❌ Not allowed | Needs something the sandbox does not provide — a blocked Node builtin (`fs`, `net`, `http`, `child_process`, native addons) or a runtime global the shim set lacks (`navigator`, `crypto`, `async_hooks`, …). The message names the capability |

The build resolves packages with **browser-style resolution**, so packages that
ship a browser build (cheerio, for example) work without their Node-only
dependencies (cheerio's `undici` is skipped; `fromURL` is unavailable — use
`ctx.http.get`). Common Node builtins (`buffer`, `crypto`, `events`, `stream`,
`path`, `url`, `util`, …) are polyfilled into the bundle, and these globals are
injected into every bundle (feature-detected, so a real implementation always
wins):

- `atob` / `btoa`, `TextEncoder` / `TextDecoder`, `queueMicrotask`, `performance`
- `Buffer`, `process`

Nothing else exists at runtime: the production sandbox (QuickJS) has **no
`require()`**, no `navigator`, no WebCrypto, no `AsyncLocalStorage` and no DOM.
When a package needs one of those, the build fails and the message says which
one, so a missing global never looks like a mysterious refusal:

| Message | What it means | Do instead |
|---|---|---|
| `"fs" is not available in the Selldoes sandbox` | The package needs filesystem, process or raw network access | Use `ctx.files` / `ctx.db` / `ctx.http` |
| `needs the "navigator" global` | The package expects a browser global the sandbox does not carry | Use a browser-friendly alternative (for example cheerio 1.x instead of html-json) |
| `needs the "crypto" global` | The package expects WebCrypto | Use `ctx.http` for signed requests, or a pure-JS package that ships its own crypto |
| `needs the "async_hooks" Node module` | The package needs `AsyncLocalStorage` | Not supported — pick a different package |
| `ships a native addon (.node)` | Native code cannot be bundled | Use a pure-JS alternative |
| `is left as an external require` | A dynamic `require()` cannot be bundled | Avoid packages that require at runtime |

`Works` is a load-time guarantee, not a promise that every feature works: the
checker executes the bundle's top level, so a function that only fails when
called (cheerio's `fromURL`) still passes.

Everything else fails at build time with the offending import, instead of
failing in a store. Bundles are capped at **4 MB**; `selldoes build` and
`selldoes publish` enforce it. `selldoes add` installs with the project's
package manager (npm, pnpm, yarn or bun — detected from the lockfile).

At publish time the zip carries the finished bundle (`dist/bundle.js`); the
platform runs that exact file, so what passed your checker is what runs in
production.

## Build & publish

```bash
selldoes validate
selldoes bump patch       # patch | minor | major — or skip and bump from the Ship page
selldoes build            # dist/<slug>/ + bundle.js
selldoes pack             # dist/<slug>.zip for manual upload

# Publish through your developer account (portal → API tokens):
selldoes login --token sk_dev_…
selldoes publish --price 9.99 --billing monthly   # optional marketplace listing fields
```

In the dev shell, **Validate & publish → Publish** does all of it in one click:
it optionally bumps the version (default patch/minor/major from Settings →
Releases), builds and zips the plugin, uploads it through the connected
developer account and sends the listing to `pending` review. The page shows the
predicted version (`0.4.0 → 0.4.1`) and the platform rejects re-publishing a
version that already exists, unless the bundle is byte-identical.

Publishing stores the source + bundle in your developer workspace, writes an
**immutable release** (`releases/<slug>/<version>/`) and upserts the marketplace
listing as `pending`. Once an admin approves (Admin → Plugins), installed
stores see **Update available → Update now**. To refresh a local project from
your account later: `selldoes pull <slug> --update` (asks before touching a
dirty git repo; `--force` overrides). `selldoes packages` shows which local
projects are behind, and the Settings page offers the same with an Update
button.

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
