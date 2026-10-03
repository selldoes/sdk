# selldoes

Build **plugins** and **themes** for [Selldoes](https://selldoes.com) — one
package with the SDK types, the theme runtime and the `selldoes` CLI.

**v0.5.0 — the workspace is an IDE.** The web workspace now ships a real code
editor: a Monaco **Code** page with SDK IntelliSense, save → rebuild, git,
search and an integrated terminal; a **Console** with clickable build errors;
and an AI assistant that edits with your selection as context, snapshots every
change and lets you restore any point in time.

## Quickstart

```bash
npm install -g selldoes
selldoes                 # boots the dev shell and opens your browser
```

The shell opens on `/preview` with a **workspace switcher in the sidebar** (the
store-switcher of the dev world): the current project, when it was last open,
and a click away — switch projects in-place, create new ones (from a template
**or by describing them**), import existing folders or zips, pull packages your
developer account owns. Empty workspace? The onboarding dialog opens over the
shell. Each project's preview is spawned behind the shell, so switching never
loses your place.

```bash
selldoes import ~/code/my-plugin     # register an existing project (folder or .zip)
selldoes login --token sk_dev_…      # connect your developer account (portal → API tokens)
selldoes packages && selldoes pull my-plugin   # pull a package you own and keep developing it
selldoes create my-plugin --ai "a plugin that shows a live visitor counter"   # AI scaffold
selldoes ask "add a /stats route that counts rows"                           # assistant in the terminal
selldoes open index.js:12            # jump to a file/line in VS Code, Cursor or Windsurf
```

## How it fits together

| Surface | What it's for |
|---|---|
| **Dev shell** (`selldoes`, bare → `/preview`) | Daily driver: the preview UI with a **workspace switcher in the sidebar** (like the dashboard's store switcher). The dropdown lists your projects (switch in-place, restart/open/remove the current one) plus **New workspace** — a three-step dialog (start → details → options) for template or Describe-AI projects, folder/.zip imports and pulling packages you own. Empty workspace → the same dialog opens as onboarding. A **Settings** page manages the project, the registry, connected accounts (developer + theme lanes) and the dev server — including deleting a project locally or its workspace copy remotely |
| **Code + Console** (shell pages) | Monaco editor over the project (SDK types, save → rebuild, git diffs/commit, quick open, search, terminal drawer) and a live log console whose build errors jump to the offending line |
| **Preview** (proxied per project, spawned on `4591+`) | The existing per-plugin dev UI — jobs, API console, storefront, AI assistant with diffs + closed-loop apply. The shell proxies to whichever project is selected |
| **Terminal** (`selldoes home`, `ask`, verbs) | TUI launcher, headless/CI (`build`, `publish`, `validate`, `pull`), terminal assistant, `selldoes open` |

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

> **Restart the server after backend edits.** Vite hot-reloads only the UI
> (`dev-ui/src`). The server-side `cli/*.mjs` modules are loaded once at
> startup and cached by Node for the process lifetime, so a new `/__ws/*`
> route added after boot answers `Unknown workspace route` until you restart
> (`Ctrl+C`, then `npm run dev` again). The UI will happily show buttons for
> routes the running server does not know yet.

## Commands

| Command | What it does |
|---|---|
| `selldoes` | Web workspace + browser (`--no-open`, `--port <n>`, `--dev` = SDK-dev mode) |
| `selldoes home` | Terminal launcher: recents, import, create, your packages |
| `selldoes import <path>` | Register a folder or `.zip` in the workspace |
| `selldoes remove [project]` | Unregister a project (files stay on disk); `--delete-files` also deletes the folder (typed-slug confirm) |
| `selldoes delete <slug>` | Delete a package's developer workspace copy on the platform (published marketplace artifacts stay) |
| `selldoes open [file[:line]]` | Open the project (or a file/line) in your editor; `--terminal` for an OS terminal |
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
  `assistant.model` / `assistant.baseUrl`) — or use the settings dialog in the
  assistant panel, which applies without a restart.
- **Nothing is written without approval**: edits are proposed as per-file
  diffs, and every apply is snapshotted for undo (restore any snapshot from
  the panel's **History** tab).
- **Selection-aware**: the code you select in the editor rides along with your
  next message; chat history persists per project.
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
