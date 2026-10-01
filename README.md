# selldoes

Build **plugins** and **themes** for [Selldoes](https://selldoes.com) — one
package with the SDK types, the theme runtime and the `selldoes` CLI.

**v0.4.0 — the SDK is your workspace.** You don't develop *inside* plugin
folders anymore: the CLI remembers your projects, the web workspace is the
front door, and AI does the heavy lifting.

## Quickstart

```bash
npm install -g selldoes
selldoes                 # boots the web workspace and opens your browser
```

The workspace shows the plugins you've worked on lately, lets you import
existing folders or zips, create new projects (from a template **or by
describing them**), pull packages your developer account owns, and start
previews — each in its own tab, several at once.

```bash
selldoes import ~/code/my-plugin     # register an existing project (folder or .zip)
selldoes login --token sk_dev_…      # connect your developer account (portal → API tokens)
selldoes packages && selldoes pull my-plugin   # pull a package you own and keep developing it
selldoes create my-plugin --ai "a plugin that shows a live visitor counter"   # AI scaffold
selldoes ask "add a /stats route that counts rows"                           # assistant in the terminal
```

## How it fits together

| Surface | What it's for |
|---|---|
| **Web workspace** (`selldoes`, bare) | Daily driver: project cards, previews, import/create/pull, AI status |
| **Preview** (spawned per project, `:4591+`) | The existing per-plugin dev UI — jobs, API console, storefront, AI assistant with diffs + closed-loop apply |
| **Terminal** (`selldoes home`, `ask`, verbs) | TUI launcher, headless/CI (`build`, `publish`, `validate`, `pull`), terminal assistant |

State lives in `~/.selldoes/workspace.json` (your projects) and
`~/.selldoes.json` (developer token / theme API key) — per machine, not per
plugin folder, so the same workspace works from a global install or from a
checkout of this repo.

## Working on this repo (SDK development)

```bash
npm install
npm --prefix dev-ui install
npm run dev               # workspace server with the dev-ui on Vite (hot reload)
                          # + an "SDK dev" badge — edit dev-ui/src, it reloads
```

`npm run dev` reads the CLI straight from `cli/` (.mjs, no build step) and
serves the UI through Vite instead of the built `ui-dist`. Import your real
projects (e.g. a first-party plugin) into the same workspace and develop them
against the local SDK — that's the dogfood loop. Installed users get the built
UI and never touch Vite.

## Commands

| Command | What it does |
|---|---|
| `selldoes` | Web workspace + browser (`--no-open`, `--port <n>`, `--dev` = SDK-dev mode) |
| `selldoes home` | Terminal launcher: recents, import, create, your packages |
| `selldoes import <path>` | Register a folder or `.zip` in the workspace |
| `selldoes create [dir]` | Scaffold from a template (interactive) |
| `selldoes create [dir] --ai "…"` | Scaffold with AI — validated before a single file is written |
| `selldoes ask ["…"]` | Terminal assistant: chat about the current plugin, apply edits with `--yes` |
| `selldoes dev` | Preview server for a project (`:4590`, or spawned by the workspace) |
| `selldoes build` / `pack` / `validate` | Bundle / zip / validate |
| `selldoes publish` | Publish through your developer account (`sk_dev_…`) |
| `selldoes packages` / `pull <slug>` | List + download the packages your account owns |
| `selldoes login` / `whoami` / `logout` | Developer token (`sk_dev_…`) — or a merchant `sk_…` key for themes |
| `selldoes update` | Check npm and update the CLI (asks first) |

## The AI assistant

The same brain powers three surfaces — the preview's right panel, the
workspace's "Describe AI" create, and `selldoes ask`:

- **Providers**: OpenRouter, OpenAI, DeepInfra, **Anthropic**, **Gemini** and
  **Ollama** (local models, no key). Set a key in the environment or in
  `selldoes.config.json` (`assistant.provider` / `assistant.apiKey` /
  `assistant.model` / `assistant.baseUrl`).
- **Nothing is written without approval**: edits are proposed as per-file
  diffs, and every apply is snapshotted for undo.
- **Closed loop**: after applying, the assistant runs your plugin's test job
  (when declared) and feeds the outcome back into the chat.

## Importing (types & runtime)

```js
// Plugin runtime — types only, the sandbox provides `ctx` at runtime
import { definePlugin } from "selldoes"

// Theme runtime — React hooks + components, bundled into your theme
import { useStore, useProducts, ProductGrid, Price } from "selldoes/theme"
```

## Docs

- [Developing plugins](docs/developing-plugins.md)
- [Developing themes](docs/developing-themes.md)

## Releases

```bash
npm run build                  # compile the plugin types to dist/
git tag v0.4.0 && git push origin v0.4.0
```

Publishing runs in CI (`.github/workflows/publish.yml`) with provenance and
needs the `NPM_TOKEN` repository secret.

## License

MIT
