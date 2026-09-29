# selldoes

Build **plugins** and **themes** for [Selldoes](https://selldoes.com) — one
package with the SDK types, the theme runtime and the `selldoes` CLI.

## Quickstart

```bash
npx selldoes create          # asks: Plugin or Theme?
cd my-project
npx selldoes dev
```

Or install it globally:

```bash
npm install -g selldoes
selldoes create
```

## Working on this repo

```bash
npm install
npm run build:dev-ui   # once: builds the preview UI (cli/plugin/dev/ui-dist)
npm run dev            # starts examples/demo-plugin → http://127.0.0.1:4590/preview
```

`examples/demo-plugin` is a full-featured plugin used to exercise every preview
page (jobs, hooks, API routes, settings, widget, dashboard UI). VS Code users
can press <kbd>F5</kbd> — launch configs are included, including a compound that
runs the dev server plus the Vite UI with hot reload.

## Commands

| Command | Plugin | Theme |
|---|---|---|
| `selldoes create` | scaffold a plugin (JS or React UI) | scaffold a theme |
| `selldoes dev` | preview server (`:4590`) — details editor, marketplace preview, AI rightbar | live store preview (`:4173`) |
| `selldoes build` | bundle to `dist/<slug>/` | bundle to `dist/` + manifest |
| `selldoes pack` | build + zip | — |
| `selldoes validate` | manifest, entries, routes | manifest + page files |
| `selldoes publish` | marketplace listing | upload (`--public`) |
| `selldoes apply --store` | — | apply the theme to a store |
| `selldoes login / whoami / logout` | — | API-key auth |
| `selldoes update` | check npm and update the CLI | same |

Every command except `help`, `version` and `update` checks npm for a newer
release (capped at one second, best-effort) and prints a one-line notice when
one exists. Update in place with `selldoes update` — it asks before installing —
or manually with `npm install -g selldoes@latest`. Set
`SELLDOES_NO_UPDATE_CHECK=1` to silence the check.

## Importing

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
git tag v0.3.1 && git push origin v0.3.1
```

Publishing runs in CI (`.github/workflows/publish.yml`) with provenance and
needs the `NPM_TOKEN` repository secret.

## License

MIT
