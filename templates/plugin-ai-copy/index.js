/**
 * AI product copy — a worked example of `ctx.ai` + `ctx.products`.
 *
 * Walks the catalog, finds products that need copy and rewrites the
 * description + bullet points through the store's AI provider. One product per
 * job step, checkpointed — safe to stop and resume at any time.
 *
 * Permissions: ai:use, products:read, products:write.
 */

/** @typedef {import("selldoes").PluginContext} PluginContext */
/** @typedef {import("selldoes").PluginExports} PluginExports */

/**
 * Checkpointed state for one `generate-copy` run.
 *
 * @typedef {object} CopyState
 * @property {string} phase
 * @property {number[]} ids
 * @property {number} page
 * @property {number} cursor
 * @property {boolean} collected
 * @property {{ generated: number, failed: number }} stats
 * @property {{ onlyMissing: boolean, maxProducts: number, bulletCount: number, instructions: string }} config
 */

const DEFAULT_SYSTEM_PROMPT =
  "You write product copy for an online store. Be factual, warm and specific. Never invent details that are not in the data."

/**
 * Products this plugin considers "needing copy". Paging keeps each call small;
 * the job only ever keeps the ids, so state stays tiny no matter the catalog.
 *
 * @param {PluginContext} ctx
 * @param {CopyState} state
 * @returns {Promise<CopyState>}
 */
async function findCandidates(ctx, state) {
  const pageSize = 100
  const maxPages = 40
  const ids = state.ids.slice()
  const seen = {}
  for (const id of ids) seen[id] = true

  for (let page = state.page; page < maxPages; page++) {
    const products = await ctx.products.list({
      limit: pageSize,
      offset: page * pageSize,
      orderBy: "id",
      orderDir: "asc",
      fields: ["id", "name", "description", "bulletpoints"],
    })
    for (const product of products) {
      const id = Number(product.id)
      if (seen[id]) continue
      const description = String(product.description ?? "").trim()
      const bullets = String(product.bulletpoints ?? "").trim()
      if (state.onlyMissing && description.length > 40 && bullets) continue
      seen[id] = true
      ids.push(id)
      if (state.maxProducts > 0 && ids.length >= state.maxProducts) break
    }
    if (products.length < pageSize) break
    if (state.maxProducts > 0 && ids.length >= state.maxProducts) break
  }

  return { ...state, ids, page: maxPages, collected: true }
}

/** One AI call, then one product update. @param {PluginContext} ctx @param {CopyState["config"]} config @param {number} productId */
async function generateForProduct(ctx, config, productId) {
  const product = await ctx.products.get(productId)
  if (!product) throw new Error(`Product ${productId} not found in this store`)

  const data = [
    `Name: ${product.name}`,
    `SKU: ${product.sku ?? ""}`,
    `Price: ${product.price ?? ""}`,
    `Current description: ${String(product.description ?? "").slice(0, 4000) || "(none)"}`,
  ].join("\n")

  const description = await ctx.ai.complete({
    systemPrompt: config.instructions || DEFAULT_SYSTEM_PROMPT,
    prompt:
      `${data}\n\nWrite an HTML product description (200–300 words) using only <h2>, <h3>, <p>, <ul> and <li>. ` +
      "Do not mention price, shipping or delivery. Output the HTML only.",
    maxTokens: 1200,
  })

  const bullets = await ctx.ai.complete({
    systemPrompt: config.instructions || DEFAULT_SYSTEM_PROMPT,
    prompt:
      `${data}\n\nWrite ${config.bulletCount} short bullet points (6–8 words each) about this product. ` +
      "Plain text, one per line, no dashes or numbering, no price or logistics.",
    maxTokens: 300,
  })

  const bulletpoints = String(bullets.text ?? "")
    .split("\n")
    .map((line) => line.replace(/^[\s\-•*‣▪▸→]+/g, "").trim())
    .filter(Boolean)
    .join("\n")

  await ctx.products.update(productId, {
    description: String(description.text ?? "").trim() || String(product.description ?? ""),
    bulletpoints: bulletpoints || product.bulletpoints,
  })

  return { descriptionChars: String(description.text ?? "").length, bulletCount: bulletpoints ? bulletpoints.split("\n").length : 0 }
}

/** @type {NonNullable<PluginExports["jobs"]>} */
const jobs = {
  /**
   * Chunked: one listing pass, then one product per step. The host checkpoints
   * the returned state between ticks, so the job resumes exactly where it was.
   */
  "generate-copy": {
    /** @param {unknown} _input @param {PluginContext} ctx @returns {CopyState} */
    init(_input, ctx) {
      return {
        phase: "collect",
        ids: [],
        page: 0,
        cursor: 0,
        collected: false,
        stats: { generated: 0, failed: 0 },
        config: {
          onlyMissing: ctx.config.onlyMissing !== false,
          maxProducts: Math.max(0, Number(ctx.config.maxProducts) || 0),
          bulletCount: Math.max(1, Math.min(Number(ctx.config.bulletCount) || 4, 8)),
          instructions: ctx.config.instructions ? String(ctx.config.instructions) : "",
        },
      }
    },

    /** @param {CopyState} state @param {PluginContext} ctx */
    async step(state, ctx) {
      let next = state
      if (!next.collected) {
        next = await findCandidates(ctx, next)
        await ctx.jobs.progress({ total: next.ids.length, processed: 0, message: `Found ${next.ids.length} products` })
        return { state: next, done: next.ids.length === 0, result: next.ids.length === 0 ? next.stats : undefined }
      }
      if (next.cursor >= next.ids.length) return { state: next, done: true, result: next.stats }

      const productId = next.ids[next.cursor]
      try {
        const result = await generateForProduct(ctx, next.config, productId)
        next.stats.generated += 1
        await ctx.jobs.item({ ref: `#${productId}`, status: "ok", productId, data: result })
      } catch (error) {
        next.stats.failed += 1
        await ctx.jobs.item({
          ref: `#${productId}`,
          status: "failed",
          productId,
          error: (error && error.message) || String(error),
        })
      }

      const done = next.cursor + 1 >= next.ids.length
      next = { ...next, cursor: next.cursor + 1 }
      await ctx.jobs.progress({
        total: next.ids.length,
        processed: next.cursor,
        failed: next.stats.failed,
        message: `${next.stats.generated} written · ${next.stats.failed} failed`,
      })
      return { state: next, done, result: done ? next.stats : undefined }
    },

    /** @param {CopyState} state @param {PluginContext} ctx */
    finalize(state, ctx) {
      ctx.jobs.log(`AI copy finished — ${state.stats.generated} product(s) rewritten`)
      return state.stats
    },
  },
}

/** @type {NonNullable<PluginExports["apiRoutes"]>} */
const apiRoutes = {
  /** Rows for the dashboard's candidates table. */
  products: {
    GET: async (ctx) => {
      const products = await ctx.products.list({
        limit: 20,
        orderBy: "id",
        orderDir: "desc",
        fields: ["id", "name", "sku", "description", "bulletpoints"],
      })
      return {
        ok: true,
        rows: products.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          copy: String(product.description ?? "").trim() ? "written" : "missing",
        })),
      }
    },
  },
}

module.exports = { jobs, apiRoutes }
