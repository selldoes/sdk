# @selldoes/plugin-sdk

Types and helpers for building [Selldoes](https://selldoes.com) plugins.

The SDK is **development-time only** — it is never bundled into a plugin
release. At runtime the host sandbox passes a `PluginContext` (`ctx.db`,
`ctx.http`, `ctx.ai`, `ctx.files`, `ctx.products`, `ctx.realtime`, `ctx.email`)
to your plugin.

```bash
npm install --save-dev @selldoes/plugin-sdk
```

```js
/** @type {import("@selldoes/plugin-sdk").PluginExports} */
module.exports = {
  /** @param {import("@selldoes/plugin-sdk").PluginContext} ctx */
  async init(ctx) {
    await ctx.db.ensureTable("notes", { body: "text" })
  },
  apiRoutes: {
    notes: {
      async GET(pluginCtx, request) {
        return { notes: await pluginCtx.db.select("notes", {}, { orderBy: "id" }) }
      },
    },
  },
}
```

## What's in the box

- `PluginManifest` — the `plugin.json` schema (permissions, tables, API routes,
  public routes, dashboard UI, storefront widget/pages, jobs, config).
- `PluginContext` / `PluginExports` — everything `index.js` can use.
- `PluginApiRequest` — the `request` argument of API route handlers.
- `definePlugin()` — an identity helper for IntelliSense in TypeScript files.

## Building & publishing

Use the CLI:

```bash
npm install --save-dev @selldoes/plugin-cli
npx selldoes-plugin dev       # local preview server
npx selldoes-plugin build     # bundle into dist/
npx selldoes-plugin publish   # upload + marketplace listing
```

Or start from a template: `npm create selldoes-plugin@latest my-plugin`.

## License

MIT
