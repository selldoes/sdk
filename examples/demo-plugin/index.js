/**
 * Demo Plugin — a worked example of everything a Selldoes plugin can do.
 *
 * Runs inside the platform sandbox and may only use the APIs the manifest
 * declares permissions for. `selldoes dev` executes this file in Node with the
 * same permission checks, a mock store and mock AI/email.
 *
 * @typedef {import("selldoes").PluginContext} PluginContext
 * @typedef {import("selldoes").PluginApiRequest} PluginApiRequest
 * @typedef {import("selldoes").PluginExports} PluginExports
 */

/** @type {NonNullable<PluginExports["apiRoutes"]>} */
const apiRoutes = {
  /**
   * Notes CRUD — the classic "own table" example.
   * GET|POST|DELETE /api/plugin-api/demo-plugin/notes
   */
  notes: {
    async GET(ctx) {
      await ctx.db.ensureTable("notes", { body: "text", done: "boolean" })
      const notes = await ctx.db.select("notes", {}, { orderBy: "id", orderDir: "desc" })
      return { ok: true, notes }
    },

    /** @param {PluginContext} ctx @param {PluginApiRequest} request */
    async POST(ctx, request) {
      const payload = /** @type {{ body?: unknown }} */ (request.body ?? {})
      const body = String(payload.body ?? "").trim()
      if (!body) return { ok: false, error: "body is required" }
      await ctx.db.ensureTable("notes", { body: "text", done: "boolean" })
      const created = await ctx.db.insert("notes", { body, done: 0 })
      return { ok: true, noteId: created.id }
    },

    /** @param {PluginContext} ctx @param {PluginApiRequest} request */
    async DELETE(ctx, request) {
      const id = Number(request.query?.id)
      if (!id) return { ok: false, error: "id is required" }
      await ctx.db.delete("notes", { id })
      return { ok: true }
    },
  },

  /**
   * Store snapshot for the dashboard UI: table counts + a peek at products.
   * GET /api/plugin-api/demo-plugin/stats
   */
  stats: {
    async GET(ctx) {
      await ctx.db.ensureTable("notes", { body: "text", done: "boolean" })
      const notes = await ctx.db.count("notes")
      const products = await ctx.products.list({ limit: 5, orderBy: "id", orderDir: "asc" })
      const settings = {
        greeting: ctx.config?.greeting ?? "Hello from the demo plugin!",
        maxPerRun: ctx.config?.maxPerRun ?? 3,
        notify: ctx.config?.notify !== false,
      }
      return {
        ok: true,
        storeId: ctx.storeId,
        notes,
        productCount: products.length,
        products: products.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          price: product.price,
        })),
        settings,
      }
    },
  },

  /**
   * The settings form values (configSchema) as your code sees them.
   * GET /api/plugin-api/demo-plugin/settings
   */
  settings: {
    async GET(ctx) {
      return {
        ok: true,
        settings: {
          greeting: ctx.config?.greeting ?? "Hello from the demo plugin!",
          maxPerRun: ctx.config?.maxPerRun ?? 3,
          notify: ctx.config?.notify !== false,
        },
      }
    },
  },

  /**
   * AI blurb writer — `ai:use` in action.
   * POST /api/plugin-api/demo-plugin/blurb  { "productId": 1 }
   */
  blurb: {
    async POST(ctx, request) {
      const productId = Number(/** @type {{ productId?: unknown }} */ (request.body ?? {}).productId ?? 0)
      if (!productId) return { ok: false, error: "productId is required" }

      const product = await ctx.products.get(productId)
      if (!product) return { ok: false, error: `Product ${productId} not found in this store` }

      const { text, tokensUsed } = await ctx.ai.complete({
        systemPrompt: "You write one-sentence product blurbs for an online store.",
        prompt: `Product: ${product.name}\nPrice: ${product.price}\nWrite a friendly one-sentence blurb.`,
        maxTokens: 120,
      })

      return { ok: true, productId, product: product.name, blurb: text, tokensUsed }
    },
  },

  /**
   * Public route for the storefront widget. No dashboard session needed.
   * GET /api/plugin-public/demo-plugin/hello?storeSlug=dev-store
   */
  hello: {
    async GET(ctx) {
      return {
        ok: true,
        greeting: ctx.config?.greeting ?? "Hello from the demo plugin!",
        storeId: ctx.storeId,
        at: new Date().toISOString(),
      }
    },
  },
}

/** @type {NonNullable<PluginExports["jobs"]>} */
const jobs = {
  /** Chunked job: walks the catalog a few products per tick. */
  "import-products": {
    /** @param {PluginContext} ctx */
    async init(input, ctx) {
      const limit = Number(ctx.config?.maxPerRun) || 3
      const products = await ctx.products.list({ limit: 100, orderBy: "id", orderDir: "asc" })
      return { ids: products.map((product) => product.id), cursor: 0, imported: 0, batch: limit }
    },

    async step(state, ctx) {
      const batch = state.batch || 3
      for (let index = 0; index < batch && state.cursor < state.ids.length; index += 1) {
        const id = state.ids[state.cursor]
        const product = await ctx.products.get(id)
        await ctx.jobs.item({
          ref: product?.sku ? String(product.sku) : `#${id}`,
          status: product ? "ok" : "skipped",
          productId: id,
          data: product ? { name: product.name } : undefined,
        })
        state.cursor += 1
        state.imported += 1
      }

      await ctx.jobs.progress({
        processed: state.cursor,
        total: state.ids.length,
        message: `imported ${state.imported} of ${state.ids.length}`,
      })

      return { state, done: state.cursor >= state.ids.length }
    },

    async finalize(state, ctx) {
      await ctx.jobs.log(`import finished — ${state.imported} product(s)`)
      return { imported: state.imported }
    },
  },

  /** Legacy function job: one AI call, returns when it's done. */
  async "generate-blurbs"(input, ctx) {
    const productId = Number(/** @type {{ productId?: unknown }} */ (input ?? {}).productId ?? 1)
    const product = await ctx.products.get(productId)
    if (!product) return { done: true, result: { ok: false, error: `Product ${productId} not found` } }
    const { text } = await ctx.ai.complete({ prompt: `One-sentence blurb for ${product.name}` })
    return { done: true, result: { ok: true, productId, blurb: text } }
  },
}

/** @type {NonNullable<PluginExports["hooks"]>} */
const hooks = {
  /** Fire it from the Hooks page: payload comes straight through. */
  async "demo:ping"(payload, ctx) {
    return {
      pong: true,
      storeId: ctx.storeId,
      received: payload ?? null,
      at: new Date().toISOString(),
    }
  },
}

/** @type {PluginExports} */
const plugin = { apiRoutes, jobs, hooks }

module.exports = plugin
