# @selldoes/plugin-cli

Command-line tool for building, previewing and publishing
[Selldoes](https://selldoes.com) plugins.

```bash
npm install --save-dev @selldoes/plugin-cli
```

Scaffold a new plugin instead with `npm create selldoes-plugin@latest my-plugin`
— generated projects come with `dev` / `build` / `pack` / `validate` /
`publish` scripts wired to this CLI.

## Commands

Run inside a plugin project (a directory containing `plugin.json`).

| Command | What it does |
|---|---|
| `selldoes-plugin dev` | Start the local preview server — dashboard UI (sandboxed iframe), storefront widget and pages, API console, job and hook runners, mock database |
| `selldoes-plugin build` | Bundle the plugin into `dist/<slug>/` (`--zip` also writes `dist/<slug>.zip`) |
| `selldoes-plugin pack` | Build + zip without publishing |
| `selldoes-plugin validate` | Check `plugin.json`, entries and declared routes |
| `selldoes-plugin publish` | Build, zip and publish to a Selldoes instance |

### Options

| Option | Applies to | Description |
|---|---|---|
| `--dir <path>` | all | Plugin directory (default: nearest folder with a `plugin.json`) |
| `--port <n>` / `--host <addr>` | dev | Preview server address (default `127.0.0.1:4590`, or `selldoes.config.json`) |
| `--open` | dev | Open the preview in your browser |
| `--app-url <url>` | publish | Target instance (or `SELLDOES_APP_URL`) |
| `--token <token>` | publish | Service publish token for CI (or `SELLDOES_PUBLISH_TOKEN`) |
| `--cookie <session=…>` | publish | Dashboard session cookie (or `SELLDOES_SESSION_COOKIE`) |
| `--store <id>` | dev / publish | Store id (session publish / mock store, or `selldoes.config.json`) |
| `--price <amount>` / `--billing <period>` | publish | Marketplace price and period (`one_time`, `monthly`, `yearly`) |
| `--zip` | build | Also produce a zip for manual upload |

## Publish flows

```bash
# Merchant flow — upload to your store, then submit for review:
SELLDOES_SESSION_COOKIE="session=…" selldoes-plugin publish \
  --app-url https://selldoes.com --store 123

# CI / first-party flow — service token:
SELLDOES_PUBLISH_TOKEN=… selldoes-plugin publish --app-url https://selldoes.com
```

Publishing writes an immutable release and sets the marketplace listing to
`pending`; once approved, installed stores see *Update available → Update now*.

## Local preview

`selldoes-plugin dev` serves <http://127.0.0.1:4590/preview> and enforces the
production sandbox rules — declared permissions, allowed/owned tables,
store-scoped rows and the same condition operators. One difference: the dev
server executes plugin code in Node, while production runs it in a QuickJS
sandbox — avoid Node globals (`process`, `Buffer`, `require`, `fs`) in plugin
code.

Full guide:
[docs/developing-plugins.md](https://github.com/selldoes/sdk/blob/main/docs/developing-plugins.md).

## License

MIT
