import fs from "node:fs"
import path from "node:path"

/**
 * Live store connection for `selldoes dev`.
 *
 * By default the preview runs against the local mock store (db.json). A live
 * connection points `ctx.products` (and image re-hosting) at a REAL Selldoes
 * store through the platform's merchant API (`/api/external/products`,
 * authenticated with a merchant API key `sk_…` from Dashboard → Settings →
 * API Keys) — so you can test a plugin end-to-end against real catalog data
 * without publishing it.
 *
 * Scope of the bridge (deliberate):
 *   ctx.products.findBySku / upsertBySku / list / update / create  → live
 *   ctx.files.importFromUrl                                        → passthrough
 *     (the URL is kept as-is; the platform re-hosts it into store media)
 *   ctx.db (plugin-owned tables, e.g. staging)                     → local mock
 *   ctx.ai / ctx.email / ctx.realtime / ctx.storage                → local mock
 *
 * The connection lives in selldoes.config.json:
 *   "store": { "live": true, "appUrl": "…", "storeId": 6, "storeSlug": "otrjoy" }
 * The API key itself is stored per-project next to it (treat the folder like
 * a secret store — or set SELLDOES_STORE_API_KEY to keep it out of the file).
 */

const EXTERNAL_PRODUCTS = "/api/external/products"
/** Fields `full=1` returns — mirrors what plugins read back from findBySku. */
const FULL_FIELDS = ["id", "sku", "name", "price", "status", "category", "subCategory", "image", "mainImage", "variationGroups", "customAttributes"]

export function readStoreBlock(config) {
  const store = config && typeof config.store === "object" && config.store !== null ? config.store : {}
  return {
    live: store.live === true,
    appUrl: String(store.appUrl ?? "").replace(/\/+$/, ""),
    apiKey: String(store.apiKey ?? process.env.SELLDOES_STORE_API_KEY ?? ""),
    storeId: Number(store.storeId) || null,
    storeSlug: String(store.storeSlug ?? ""),
  }
}

export function writeStoreBlock(pluginDir, patch) {
  const configPath = path.join(pluginDir, "selldoes.config.json")
  let config = {}
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  } catch {
    // first write
  }
  const current = config.store && typeof config.store === "object" ? config.store : {}
  const next = { ...current, ...patch }
  for (const key of Object.keys(next)) {
    if (next[key] === null || next[key] === undefined || next[key] === "") delete next[key]
  }
  if (Object.keys(next).length === 0) delete config.store
  else config.store = next
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return config.store ?? {}
}

/** Masked view of the store block for the settings UI / /__dev/store GET. */
export function storeView(config) {
  const store = readStoreBlock(config)
  return {
    live: store.live,
    appUrl: store.appUrl || null,
    storeId: store.storeId,
    storeSlug: store.storeSlug || null,
    apiKeySet: Boolean(store.apiKey),
    apiKeyMasked: store.apiKey ? maskKey(store.apiKey) : null,
  }
}

export function maskKey(value) {
  const key = String(value ?? "")
  if (!key) return null
  if (key.length <= 8) return "•••"
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

/**
 * Verifies a merchant API key + resolves the target store.
 * `GET {appUrl}/api/templates/me` with `x-api-key` returns the user + stores.
 */
export async function connectStore({ appUrl, apiKey, storeId, storeSlug }) {
  const base = String(appUrl ?? "").replace(/\/+$/, "")
  const key = String(apiKey ?? "").trim()
  if (!base) throw new Error("Provide the Selldoes app URL, e.g. https://selldoes.com")
  if (!key) throw new Error("Provide a merchant API key (Dashboard → Settings → API Keys).")
  if (key.startsWith("sk_dev_")) {
    throw new Error("sk_dev_… is a developer token. Live store connections use a merchant API key (sk_…).")
  }

  let me = null
  try {
    const res = await fetch(`${base}/api/templates/me`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text()
    try {
      me = JSON.parse(text)
    } catch {
      // non-JSON body
    }
    if (!res.ok) throw new Error(me?.error || `${res.status} ${res.statusText}`)
  } catch (error) {
    throw new Error(`Could not verify the API key against ${base}: ${error.message}`)
  }

  const stores = Array.isArray(me?.stores) ? me.stores : []
  if (stores.length === 0) throw new Error("This API key's account has no stores.")
  const wanted = String(storeId ?? "").trim()
  const wantedSlug = String(storeSlug ?? "").trim()
  const store =
    (wanted ? stores.find((entry) => String(entry.id) === wanted) : null) ||
    (wantedSlug ? stores.find((entry) => String(entry.slug) === wantedSlug) : null) ||
    stores[0]

  return {
    appUrl: base,
    apiKey: key,
    storeId: Number(store.id),
    storeSlug: String(store.slug ?? ""),
    storeName: String(store.name ?? ""),
    userId: me?.userId ?? null,
  }
}

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

  const call = async (method, search = "", body) => {
    const url = `${appUrl}${EXTERNAL_PRODUCTS}${search}${search ? "&" : "?"}storeId=${storeId}`
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
    if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText} (${EXTERNAL_PRODUCTS})`)
    return data
  }

  const remember = (product) => {
    if (product && product.id && product.sku) idToSku.set(Number(product.id), String(product.sku))
    return product
  }

  return {
    async findBySku(sku) {
      const data = await call("GET", `sku=${encodeURIComponent(String(sku))}&full=1`)
      if (!data?.exists || !data?.product) return null
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
      const capped = opts.limit ? skus.slice(0, Number(opts.limit)) : skus
      const rows = []
      for (const sku of capped) {
        const full = await call("GET", `sku=${encodeURIComponent(String(sku))}&full=1`)
        if (full?.product) rows.push(remember(full.product))
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
        if (!existing?.name) throw new Error(`products.update(${id}) has no supported fields for live mode (price/variationGroups/categories)`)
        body.name = existing.name
        delete body.updateFields
        const data = await call("POST", "", body)
        log(`[live] product upserted ${sku} → #${data.id}`)
        return { updated: true }
      }
      body.updateFields = updateFields
      const data = await call("POST", "", body)
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
