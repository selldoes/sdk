# Selldoes plugin SDK

Build plugins for [Selldoes](https://selldoes.com) — the e-commerce platform.

| Package | npm | What it is |
|---|---|---|
| [`sdk/`](sdk/) | `@selldoes/plugin-sdk` | Types for `plugin.json`, `PluginContext`, `PluginExports` + `definePlugin()` |
| [`cli/`](cli/) | `@selldoes/plugin-cli` | `selldoes-plugin dev/build/pack/validate/publish` — includes the local preview server |
| [`create-plugin/`](create-plugin/) | `create-selldoes-plugin` | `npm create selldoes-plugin` scaffolder |

## Quick start

```bash
npm create selldoes-plugin@latest my-plugin
cd my-plugin
npm install
npm run dev        # preview at http://127.0.0.1:4590/preview
```

The preview server runs your plugin the way the Selldoes sandbox does:
dashboard UI in an iframe, storefront widget and pages, an API console, job and
hook runners and a mock store — all local, all fake.

Full guide: **[docs/developing-plugins.md](docs/developing-plugins.md)**.

## Working on these packages

```bash
npm install
npm run sdk:build     # compile @selldoes/plugin-sdk (tsc)
npm run pack:all      # npm tarballs in dist/packages/
```

## Releases

Publishing happens in CI (`.github/workflows/npm-publish.yml`) when a version
tag is pushed:

| Tag | Publishes |
|---|---|
| `sdk-v<version>` | `@selldoes/plugin-sdk` |
| `cli-v<version>` | `@selldoes/plugin-cli` |
| `create-v<version>` | `create-selldoes-plugin` |

Bump the matching `package.json` version, commit, then:

```bash
git tag sdk-v0.2.1 && git push origin sdk-v0.2.1
```

The workflow builds the SDK, publishes from the package directory with
`--provenance`, and needs the `NPM_TOKEN` repository secret.

## License

[MIT](LICENSE)
