const EXTERNAL_PRODUCTS = "/api/external/products"
/** Fields `full=1` returns — mirrors what plugins read back from findBySku. */
const _FULL_FIELDS = [
  "id",
  "sku",
  "name",
  "price",
  "status",
  "category",
  "subCategory",
  "image",
  "mainImage",
  "variationGroups",
  "customAttributes",
]

/**
 * Builds the live `ctx.products` bridge. `connection` is the resolved
 * { appUrl, apiKey, storeId } — every call is store-scoped by the API key's
 * user plus the explicit `storeId` parameter.
 *
 * The bridge keeps a tiny id→sku cache from `full` reads so
 * `products.update(id, patch)` (used by refresh flows) can map back to the
 * targeted `updateFields` upsert the external API exposes.
 */
export function createLiveProductsBridge(connection, log = () => {}) {
  const { appUrl, apiKey, storeId } = connection
  const idToSku = new Map()

  /**
   * Every external-products request is store-scoped. Build the query with
   * URLSearchParams — the old string concatenation glued `list=all` onto the
   * path (`/productslist=all&storeId=…`) and every GET answered 404.
   */
  const call = async (method, search = "", body) => {
    const params = new URLSearchParams({ storeId: String(storeId) })
    const extra = String(search ?? "").replace(/^\?/, "")
    if (extra) {
      for (const [key, value] of new URLSearchParams(extra)) params.append(key, value)
    }
    const url = `${appUrl}${EXTERNAL_PRODUCTS}?${params.toString()}`
    const res = await fetch(url, {
      method,
      headers: {
        "x-api-key": apiKey,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      // non-JSON body
    }
    if (!res.ok) {
      const detail = data?.error || res.statusText || "request failed"
      throw new Error(`${detail} [${res.status} ${method} ${url}]`)
    }
    return data
  }

  /**
   * `full=1` returns the whole product row next to `exists` on current
   * Selldesk deploys. An older platform answers `{exists:true}` alone, which
   * makes catalog reads impossible — surface that once instead of silently
   * returning null for every SKU.
   */
  let warnedMissingFull = false
  const warnMissingFullRead = () => {
    if (warnedMissingFull) return
    warnedMissingFull = true
    log(
      "[live] the store's platform answered `exists` without the full product row — deploy the latest Selldesk to enable catalog reads (findBySku / refresh)",
    )
  }

  const remember = (product) => {
    if (product?.id && product.sku) idToSku.set(Number(product.id), String(product.sku))
    return product
  }

  return {
    async findBySku(sku) {
      const data = await call("GET", `sku=${encodeURIComponent(String(sku))}&full=1`)
      if (!data?.exists) return null
      if (!data?.product) {
        warnMissingFullRead()
        return null
      }
      return remember(data.product)
    },

    async get(id) {
      const sku = idToSku.get(Number(id))
      if (!sku) throw new Error(`products.get is not supported in live mode for an unknown id (${id}) — call findBySku first`)
      return this.findBySku(sku)
    },

    async list(opts = {}) {
      const data = await call("GET", "list=all")
      const skus = Array.isArray(data?.skus) ? data.skus : []
      const offset = Math.max(0, Number(opts.offset) || 0)
      const limit = Number(opts.limit) || 0
      const page = limit ? skus.slice(offset, offset + limit) : skus.slice(offset)
      const rows = []
      for (const sku of page) {
        const full = await call("GET", `sku=${encodeURIComponent(String(sku))}&full=1`)
        if (full?.product) rows.push(remember(full.product))
        else if (full?.exists) warnMissingFullRead()
      }
      return rows
    },

    async create(input = {}) {
      if (!input?.sku || !input?.name) throw new Error("products.create requires name + sku in live mode")
      const data = await call("POST", "", normalizePayload(input))
      log(`[live] product created/updated ${input.sku} → #${data.id}`)
      return { id: data.id, created: data.created === true }
    },

    async update(id, patch = {}) {
      const sku = idToSku.get(Number(id))
      if (!sku) throw new Error(`products.update is not supported in live mode for an unknown id (${id}) — call findBySku first`)
      const updateFields = []
      const body = normalizePayload({ ...patch, sku, name: patch.name ?? " " })
      if (patch.price !== undefined) updateFields.push("price")
      if (patch.variationGroups !== undefined) updateFields.push("variationGroups")
      if (patch.category !== undefined || patch.subCategory !== undefined) updateFields.push("categories")
      if (updateFields.length === 0) {
        // Nothing the targeted update supports — fall through to a full upsert
        // only when we have the required fields; otherwise report honestly.
        const existing = await this.findBySku(sku)
        if (!existing?.name)
          throw new Error(`products.update(${id}) has no supported fields for live mode (price/variationGroups/categories)`)
        body.name = existing.name
        delete body.updateFields
        const data = await call("POST", "", body)
        log(`[live] product upserted ${sku} → #${data.id}`)
        return { updated: true }
      }
      body.updateFields = updateFields
      const _data = await call("POST", "", body)
      log(`[live] product patched ${sku} (${updateFields.join(", ")})`)
      return { updated: true }
    },

    async upsertBySku(input) {
      if (!input?.sku) throw new Error("products.upsertBySku requires a sku")
      if (!input?.name) throw new Error("products.upsertBySku requires a name")
      const data = await call("POST", "", normalizePayload(input))
      log(`[live] ${data.created ? "created" : "updated"} ${input.sku} → #${data.id}`)
      remember({ id: data.id, sku: input.sku })
      return { id: data.id, created: data.created === true }
    },
  }
}

/** Maps the plugin payload onto the external API's CreateProductSchema. */
function normalizePayload(input) {
  const body = {
    name: input.name,
    sku: input.sku,
    price: input.price !== undefined ? String(input.price) : undefined,
    description: input.description,
    bulletpoints: input.bulletpoints,
    image: input.image,
    imageAsIs: input.imageAsIs,
    category: input.category,
    subCategory: input.subCategory,
    categories: input.categories,
    condition: input.condition,
    stock: input.stock,
    customAttributes: input.customAttributes,
    variationGroups: input.variationGroups,
    shippingPolicyId: input.shippingPolicyId,
    storeId: input.storeId,
    status: input.status === "draft" ? "draft" : undefined,
  }
  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key]
  }
  return body
}
