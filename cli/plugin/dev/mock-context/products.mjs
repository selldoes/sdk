/**
 * Builds the mock `ctx.products` capability. Reads/writes the store-scoped
 * `products` table, or proxies to the live store bridge when connected.
 */
export function createProducts({ db, storeId, requirePermission, liveProducts }) {
  /**
   * Mirrors the host's multi-category behaviour in the mock: `categories`
   * becomes a deduped name list and the first name doubles as the product's
   * primary `category`.
   */
  const withCategories = (input = {}) => {
    if (!Array.isArray(input.categories)) return input
    const names = [...new Set(input.categories.map((name) => String(name ?? "").trim()).filter(Boolean))]
    return { ...input, categories: names, category: names[0] ?? "" }
  }

  return {
    async list(opts = {}) {
      requirePermission("products:read", "ctx.products.list")
      let rows
      if (liveProducts()) {
        rows = await liveProducts().list(opts)
      } else {
        const conditions = opts.status ? { status: String(opts.status) } : {}
        rows = db.select(
          "products",
          conditions,
          {
            limit: opts.limit ?? 50,
            offset: opts.offset ?? 0,
            orderBy: opts.orderBy ?? "id",
            orderDir: opts.orderDir ?? "desc",
          },
          storeId,
        )
      }
      if (Array.isArray(opts.fields) && opts.fields.length > 0) {
        return rows.map((row) => {
          const projected = {}
          for (const field of opts.fields) projected[field] = row[field]
          return projected
        })
      }
      return rows
    },
    async create(input = {}) {
      requirePermission("products:write", "ctx.products.create")
      if (!input?.name) throw new Error("products.create requires a name")
      if (liveProducts()) {
        const result = await liveProducts().create(withCategories(input))
        return { id: result.id }
      }
      return { id: db.insert("products", withCategories(input), storeId).id }
    },
    async update(id, input = {}) {
      requirePermission("products:write", "ctx.products.update")
      if (liveProducts()) return liveProducts().update(id, withCategories(input))
      const existing = db.select("products", { id: Number(id) }, { limit: 1 }, storeId)[0]
      if (!existing) throw new Error(`Product ${id} not found in this store`)
      db.update("products", { id: Number(id) }, withCategories(input), storeId)
      return { updated: true }
    },
    async get(id) {
      requirePermission("products:read", "ctx.products.get")
      if (liveProducts()) return liveProducts().get(id)
      return db.select("products", { id: Number(id) }, { limit: 1 }, storeId)[0] ?? null
    },
    async findBySku(sku) {
      requirePermission("products:read", "ctx.products.findBySku")
      if (liveProducts()) return liveProducts().findBySku(sku)
      return db.select("products", { sku: String(sku) }, { limit: 1 }, storeId)[0] ?? null
    },
    async upsertBySku(input) {
      requirePermission("products:write", "ctx.products.upsertBySku")
      const data = withCategories(input)
      if (liveProducts()) return liveProducts().upsertBySku(data)
      const existing = db.select("products", { sku: input.sku }, { limit: 1 }, storeId)[0]
      if (existing) {
        db.update("products", { id: existing.id }, data, storeId)
        return { id: existing.id, created: false }
      }
      return { id: db.insert("products", data, storeId).id, created: true }
    },
  }
}
