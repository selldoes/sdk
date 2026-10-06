/**
 * Storefront contact widget — a worked example of `storefrontWidget` +
 * `publicRoutes`.
 *
 * The host mounts `ui/widget.html` as a small sandboxed iframe on every
 * storefront page. Visitors can leave a message without a dashboard session;
 * the dashboard's "Messages" table reads them back.
 *
 * Permissions: db:read, db:write, db:schema (the plugin's own table).
 */

/** @typedef {import("selldoes").PluginContext} PluginContext */
/** @typedef {import("selldoes").PluginApiRequest} PluginApiRequest */
/** @typedef {import("selldoes").PluginExports} PluginExports */

const TABLE = "contact_messages"

/** @param {PluginContext} ctx */
async function ensureMessages(ctx) {
  await ctx.db.ensureTable(TABLE, {
    name: "varchar",
    email: "varchar",
    body: "text",
    handled: "boolean",
  })
}

/** @type {NonNullable<PluginExports["apiRoutes"]>} */
const apiRoutes = {
  /**
   * Public: a storefront visitor submits the widget form. No session here —
   * the store comes from the widget's `storeSlug` query param and the host
   * scopes `ctx` accordingly.
   *
   * POST /api/plugin-public/__PLUGIN_SLUG__/message  { name, email, body }
   */
  message: {
    /** @param {PluginContext} ctx @param {PluginApiRequest} request */
    async POST(ctx, request) {
      const payload = /** @type {{ name?: unknown, email?: unknown, body?: unknown }} */ (request.body ?? {})
      const body = String(payload.body ?? "").trim()
      if (body.length < 2) return { ok: false, error: "message is required" }
      if (body.length > 4000) return { ok: false, error: "message is too long" }

      await ensureMessages(ctx)
      const created = await ctx.db.insert(TABLE, {
        name: String(payload.name ?? "").trim().slice(0, 120),
        email: String(payload.email ?? "").trim().slice(0, 200),
        body,
        handled: 0,
      })
      return { ok: true, messageId: created.id }
    },
  },

  /**
   * Dashboard: the messages table (kit section reads this route).
   * GET /api/plugin-api/__PLUGIN_SLUG__/messages
   */
  messages: {
    /** @param {PluginContext} ctx */
    async GET(ctx) {
      await ensureMessages(ctx)
      const rows = await ctx.db.select(TABLE, {}, { orderBy: "id", orderDir: "desc", limit: 100 })
      return {
        ok: true,
        rows: rows.map((row) => ({
          id: row.id,
          name: row.name || "(anonymous)",
          email: row.email,
          body: String(row.body ?? "").slice(0, 200),
          handled: Number(row.handled) === 1 ? "yes" : "no",
        })),
      }
    },

    /**
     * Mark a message handled (or delete it) from the dashboard.
     * POST /api/plugin-api/__PLUGIN_SLUG__/messages  { id, handled?, delete? }
     * @param {PluginContext} ctx
     * @param {PluginApiRequest} request
     */
    async POST(ctx, request) {
      const payload = /** @type {{ id?: unknown, handled?: unknown, delete?: unknown }} */ (request.body ?? {})
      const id = Number(payload.id)
      if (!id) return { ok: false, error: "id is required" }
      await ensureMessages(ctx)
      if (payload.delete === true) {
        await ctx.db.delete(TABLE, { id })
        return { ok: true, deleted: true }
      }
      await ctx.db.update(TABLE, { id }, { handled: payload.handled === false ? 0 : 1 })
      return { ok: true }
    },
  },
}

module.exports = { apiRoutes }
