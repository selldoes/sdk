# @selldesk/plugin-sdk

Types and helpers for building [SellDesk](https://selldoes.com) plugins.

The SDK is **development-time only** — it is never bundled into a plugin
release. At runtime the host sandbox passes a `PluginContext` (`ctx.db`,
`ctx.http`, `ctx.ai`, `ctx.files`, `ctx.products`, `ctx.realtime`, `ctx.email`)
to your plugin.

```bash
npm install --save-dev @selldesk/plugin-sdk
```

```js
/** @type {import("@selldesk/plugin-sdk").PluginExports} */
module.exports = {
  /** @param {import("@selldesk/plugin-sdk").PluginContext} ctx */
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
npm install --save-dev @selldesk/plugin-cli
npx selldesk-plugin dev       # local preview server
npx selldesk-plugin build     # bundle into dist/
npx selldesk-plugin publish   # upload + marketplace listing
```

Or start from a template: `npm create selldesk-plugin@latest my-plugin`.

## License

MIT
