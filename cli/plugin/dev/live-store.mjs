import fs from "node:fs"
import os from "node:os"
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
 *   ctx.ai.complete / ctx.ai.image                                 → live
 *     (the store's own AI provider + model, authenticated with the same
 *     merchant API key — the preview writes REAL copy)
 *   ctx.ai.listPrompts / getPrompt / listModels                    → live
 *   ctx.files.importFromUrl                                        → passthrough
 *     (the URL is kept as-is; the platform re-hosts it into store media)
 *   ctx.db (plugin-owned tables, e.g. staging)                     → local mock
 *   ctx.email / ctx.realtime / ctx.storage                         → local mock
 *
 * The connection lives in selldoes.config.json:
 *   "store": { "live": true, "appUrl": "…", "storeId": 6, "storeSlug": "otrjoy" }
 * The API key itself is stored per-project next to it (treat the folder like
 * a secret store — or set SELLDOES_STORE_API_KEY to keep it out of the file).
 *
 * A local Selldesk checkout (selldesk.net/next on :9582) is preferred over the
 * saved URL — see resolveLiveAppUrl. SELLDOES_APP_URL / SELLDOES_LOCAL_PLATFORM
 * override the detection.
 */

const EXTERNAL_PRODUCTS = "/api/external/products"
const EXTERNAL_AI_PROMPTS = "/api/external/ai/prompts"
const EXTERNAL_AI_MODELS = "/api/external/ai/models"
/** The merchant API also exposes the AI runner (the same one the dashboard uses). */
const AI_EXECUTE = "/api/ai/execute"
/** Fields `full=1` returns — mirrors what plugins read back from findBySku. */
const FULL_FIELDS = ["id", "sku", "name", "price", "status", "category", "subCategory", "image", "mainImage", "variationGroups", "customAttributes"]

/**
 * Local platform auto-detection.
 *
 * `selldoes dev` can bridge to a real Selldesk instance. When the platform repo
 * is checked out on the developer's machine (`selldesk.net/next`, started with
 * `npm run dev` on port 9582) the dev server prefers that local instance over
 * the hosted selldoes.com — so a plugin dev working on the platform gets the
 * local build without editing `selldoes.config.json`.
 *
 * Overrides:
 *   SELLDOES_LOCAL_PLATFORM=http://localhost:3000  → use that URL directly
 *   SELLDOES_LOCAL_PLATFORM=/path/to/selldesk.net  → use that checkout
 *   SELLDOES_LOCAL_PLATFORM=off                     → disable detection
 *   SELLDOES_APP_URL=…                              → always wins
 */
export const LOCAL_PLATFORM_PORT = 9582
export const LOCAL_PLATFORM_URL = `http://localhost:${LOCAL_PLATFORM_PORT}`

function localPlatformSetting() {
  return String(process.env.SELLDOES_LOCAL_PLATFORM ?? "").trim()
}

function localPlatformDisabled() {
  return ["off", "0", "false", "no"].includes(localPlatformSetting().toLowerCase())
}

/** Candidate `next/` dirs of a local Selldesk platform checkout. */
function localPlatformCandidates() {
  const setting = localPlatformSetting()
  const candidates = []
  // An explicit path (not a URL, not the disable flag) is checked first.
  if (setting && !localPlatformDisabled() && !/^https?:\/\//i.test(setting)) candidates.push(setting)
  const home = os.homedir()
  candidates.push(
    path.join(home, "Desktop", "selldesk.net", "next"),
    path.join(home, "OneDrive", "Desktop", "selldesk.net", "next"),
    path.join(home, "Documents", "selldesk.net", "next"),
    path.join(home, "selldesk.net", "next"),
  )
  return candidates
}

/**
 * The local platform `next/` directory when a checkout is present, else null.
 * A candidate counts when it holds a `package.json` directly, or a `next/`
 * sub-directory that does (so the repo root works too).
 */
export function findLocalPlatformDir() {
  if (localPlatformDisabled()) return null
  for (const candidate of localPlatformCandidates()) {
    if (!candidate) continue
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate
    const nested = path.join(candidate, "next")
    if (fs.existsSync(path.join(nested, "package.json"))) return nested
  }
  return null
}

/**
 * The app URL the live bridge should talk to. Precedence:
 *   1. the `explicit` argument
 *   2. `SELLDOES_APP_URL`
 *   3. `SELLDOES_LOCAL_PLATFORM` when it is a URL
 *   4. a detected local platform checkout → http://localhost:9582
 *   5. the saved `store.appUrl`
 */
export function resolveLiveAppUrl(saved, explicit) {
  const clean = (value) => String(value ?? "").replace(/\/+$/, "") || null
  const explicitUrl = clean(explicit) || clean(process.env.SELLDOES_APP_URL)
  if (explicitUrl) return explicitUrl
  const setting = localPlatformSetting()
  if (!localPlatformDisabled() && /^https?:\/\//i.test(setting)) return clean(setting)
  if (findLocalPlatformDir()) return LOCAL_PLATFORM_URL
  return clean(saved)
}

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
 * Verifies a merchant API key + returns EVERY store on the account (the
 * settings UI shows this list in the "which store?" picker dialog).
 * `GET {appUrl}/api/templates/me` with `x-api-key` returns the user + stores.
 * Nothing is written here — use connectStore to commit a selection.
 *
 * The app URL is resolved automatically: explicit argument → SELLDOES_APP_URL
 * → https://selldoes.com. Callers never need to supply one.
 */
export async function verifyStoreKey({ appUrl, apiKey }) {
  const base =
    String(appUrl ?? "").replace(/\/+$/, "") ||
    String(process.env.SELLDOES_APP_URL ?? "").replace(/\/+$/, "") ||
    "https://selldoes.com"
  const key = String(apiKey ?? "").trim()
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
  return {
    appUrl: base,
    apiKey: key,
    userId: me?.userId ?? null,
    stores: stores.map((entry) => ({
      id: Number(entry.id),
      slug: String(entry.slug ?? ""),
      name: String(entry.name ?? ""),
    })),
  }
}

/**
 * Verifies a merchant API key + resolves the target store.
 * Picks the store matching storeId/storeSlug, else the account's first one.
 */
export async function connectStore({ appUrl, apiKey, storeId, storeSlug }) {
  const verified = await verifyStoreKey({ appUrl, apiKey })
  const wanted = String(storeId ?? "").trim()
  const wantedSlug = String(storeSlug ?? "").trim()
  const store =
    (wanted ? verified.stores.find((entry) => String(entry.id) === wanted) : null) ||
    (wantedSlug ? verified.stores.find((entry) => String(entry.slug) === wantedSlug) : null) ||
    verified.stores[0]

  return {
    appUrl: verified.appUrl,
    apiKey: verified.apiKey,
    storeId: store.id,
    storeSlug: store.slug,
    storeName: store.name,
    userId: verified.userId,
  }
}

/**
 * Builds the live `ctx.ai` prompts bridge (saved AI prompts from Dashboard →
 * AI Prompts). Backed by the platform's merchant API
 * (`/api/external/ai/prompts`) — an older host that answers 404 surfaces a
 * clear "deploy the latest Selldesk" error instead of an empty list.
 */
export function createLivePromptsBridge(connection, log = () => {}) {
  const { appUrl, apiKey, storeId } = connection

  const call = async (search = "") => {
    const params = new URLSearchParams({ storeId: String(storeId) })
    const extra = String(search ?? "").replace(/^\?/, "")
    if (extra) {
      for (const [key, value] of new URLSearchParams(extra)) params.append(key, value)
    }
    const url = `${appUrl}${EXTERNAL_AI_PROMPTS}?${params.toString()}`
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      // non-JSON body
    }
    if (res.status === 404 && !data?.error) {
      throw new Error("the store's platform does not expose AI prompt listing — deploy the latest Selldesk (GET /api/external/ai/prompts)")
    }
    if (!res.ok) {
      const detail = data?.error || res.statusText || "request failed"
      throw new Error(`${detail} [${res.status} GET ${url}]`)
    }
    return data
  }

  return {
    async list(opts = {}) {
      const data = await call(opts.type ? `type=${encodeURIComponent(String(opts.type))}` : "")
      return Array.isArray(data?.prompts) ? data.prompts : []
    },
    async get(id) {
      // The external API lists rather than fetches by id — filter client-side
      // (the prompt library is small) to keep one endpoint.
      const prompts = await this.list()
      return prompts.find((prompt) => Number(prompt.id) === Number(id)) ?? null
    },
  }
}

/**
 * Builds the live `ctx.ai.listModels` bridge — the store's enabled AI models
 * (with pricing, context window and capabilities). Backed by the platform's
 * merchant API (`/api/external/ai/models`) — an older host that answers 404
 * surfaces a clear "deploy the latest Selldesk" error instead of an empty list.
 */
export function createLiveModelsBridge(connection, log = () => {}) {
  const { appUrl, apiKey, storeId } = connection

  const call = async (search = "") => {
    const params = new URLSearchParams({ storeId: String(storeId) })
    const extra = String(search ?? "").replace(/^\?/, "")
    if (extra) {
      for (const [key, value] of new URLSearchParams(extra)) params.append(key, value)
    }
    const url = `${appUrl}${EXTERNAL_AI_MODELS}?${params.toString()}`
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      // non-JSON body
    }
    if (res.status === 404 && !data?.error) {
      throw new Error("the store's platform does not expose AI model listing — deploy the latest Selldesk (GET /api/external/ai/models)")
    }
    if (!res.ok) {
      const detail = data?.error || res.statusText || "request failed"
      throw new Error(`${detail} [${res.status} GET ${url}]`)
    }
    return data
  }

  return {
    async list(opts = {}) {
      const params = new URLSearchParams()
      if (opts.type) params.set("type", String(opts.type))
      if (opts.provider) params.set("provider", String(opts.provider))
      const data = await call(params.toString())
      return Array.isArray(data?.models) ? data.models : []
    },
  }
}

/**
 * Builds the live `ctx.ai` bridge — text and image generation through the
 * store's own AI provider. Backed by the platform's AI runner
 * (`POST /api/ai/execute`, authenticated with the merchant API key), which
 * falls back to the store's saved provider + model when the request does not
 * name one. Without this bridge the preview answers every AI call with the
 * mock reply, so a plugin's copy never looks like the real thing.
 */
export function createLiveAiBridge(connection, log = () => {}) {
  const { appUrl, apiKey, storeId } = connection

  const call = async (body) => {
    const res = await fetch(`${appUrl.replace(/\/$/, "")}${AI_EXECUTE}`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, storeId }),
      signal: AbortSignal.timeout(120_000),
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
      throw new Error(`${detail} [${res.status} POST ${AI_EXECUTE}]`)
    }
    return data ?? {}
  }

  return {
    async complete(opts = {}) {
      const prompt = String(opts.prompt ?? "")
      if (!prompt) throw new Error("ctx.ai.complete needs a prompt")
      const data = await call({
        prompt,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.provider ? { provider: opts.provider } : {}),
      })
      const text = String(data.text ?? data.content ?? "")
      log(`[live] ai.complete → ${text.length} characters`)
      return { text, tokensUsed: Number(data.tokensUsed) || 0 }
    },
    async image(opts = {}) {
      const data = await call({
        target: { type: "image", field: "mainImage" },
        ...(opts.promptId ? { promptId: opts.promptId } : {}),
        ...(opts.prompt ? { prompt: opts.prompt } : {}),
        ...(opts.referenceImage ? { referenceImage: opts.referenceImage } : {}),
        ...(opts.size ? { size: opts.size } : {}),
        ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      })
      log("[live] ai.image → generated")
      return {
        url: String(data.url ?? ""),
        base64: data.b64 ? String(data.b64) : undefined,
      }
    },
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
    log("[live] the store's platform answered `exists` without the full product row — deploy the latest Selldesk to enable catalog reads (findBySku / refresh)")
  }

  const remember = (product) => {
    if (product && product.id && product.sku) idToSku.set(Number(product.id), String(product.sku))
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
