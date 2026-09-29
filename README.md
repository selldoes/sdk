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

## Commands

| Command | Plugin | Theme |
|---|---|---|
| `selldoes create` | scaffold a plugin | scaffold a theme |
| `selldoes dev` | preview server (`:4590`) | live store preview (`:4173`) |
| `selldoes build` | bundle to `dist/<slug>/` | bundle to `dist/` + manifest |
| `selldoes pack` | build + zip | — |
| `selldoes validate` | manifest, entries, routes | manifest + page files |
| `selldoes publish` | marketplace listing | upload (`--public`) |
| `selldoes apply --store` | — | apply the theme to a store |
| `selldoes login / whoami / logout` | — | API-key auth |

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
