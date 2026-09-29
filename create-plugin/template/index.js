/**
 * __PLUGIN_NAME__ — SellDesk plugin runtime.
 *
 * Runs inside the QuickJS sandbox on the platform. Only what the manifest
 * declares is available: `ctx.db`, `ctx.http`, `ctx.ai`, `ctx.files`,
 * `ctx.products`, `ctx.realtime`, `ctx.email`.
 *
 * The dev server (`npm run dev`) executes this file in Node with the same
 * permission checks and a mock database, so API/UI development is fully local.
 */

/** @typedef {import("@selldesk/plugin-sdk").PluginContext} PluginContext */
/** @typedef {import("@selldesk/plugin-sdk").PluginApiRequest} PluginApiRequest */
/** @typedef {import("@selldesk/plugin-sdk").PluginExports} PluginExports */

/** @type {NonNullable<PluginExports["apiRoutes"]>} */
const apiRoutes = {
  notes: {
    /**
     * GET /api/plugin-api/__PLUGIN_SLUG__/notes
     * @param {PluginContext} ctx
     */
    async GET(ctx) {
      await ctx.db.ensureTable("notes", { body: "text", done: "boolean" })
      const notes = await ctx.db.select("notes", {}, { orderBy: "id", orderDir: "desc" })
      return { ok: true, notes }
    },

    /**
     * POST /api/plugin-api/__PLUGIN_SLUG__/notes  { body: "…" }
     * @param {PluginContext} ctx
     * @param {PluginApiRequest} request
     */
    async POST(ctx, request) {
      const payload = /** @type {{ body?: unknown }} */ (request.body ?? {})
      const body = String(payload.body ?? "").trim()
      if (!body) return { ok: false, error: "body is required" }

      await ctx.db.ensureTable("notes", { body: "text", done: "boolean" })
      const created = await ctx.db.insert("notes", { body, done: 0 })
      return { ok: true, noteId: created.id }
    },

    /**
     * DELETE /api/plugin-api/__PLUGIN_SLUG__/notes?id=1
     * @param {PluginContext} ctx
     * @param {PluginApiRequest} request
     */
    async DELETE(ctx, request) {
      const id = Number(request.query?.id)
      if (!id) return { ok: false, error: "id is required" }
      await ctx.db.delete("notes", { id })
      return { ok: true }
    },
  },
}

module.exports = { apiRoutes }
