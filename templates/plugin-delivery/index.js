/**
 * Digital delivery — a worked example of the `deliveryProvider` contract.
 *
 * When the manifest declares `"delivery": true`, the storefront shows the
 * section this function returns on the order-detail page ("Digital
 * deliveries"). It runs in the sandbox with the plugin's store-scoped `ctx`.
 *
 * Permissions: none required for the section itself — the order it receives is
 * already scoped to the buyer and the store. Add `products:read` only if you
 * look up more catalog data.
 */

/** @typedef {import("selldoes").PluginContext} PluginContext */
/** @typedef {import("selldoes").PluginExports} PluginExports */

/**
 * @param {Record<string, unknown>} order
 * @returns {Record<string, unknown>[]}
 */
function orderLines(order) {
  const candidate = order.items ?? order.orderItems ?? order.lines ?? []
  return Array.isArray(candidate) ? candidate : []
}

/**
 * A per-item delivery line, from the checkout data or the product's instructions.
 * @param {Record<string, unknown>} item
 * @returns {{ label: string, value: string }}
 */
function lineFor(item) {
  const label = String(item.name ?? item.productName ?? item.title ?? `Item #${item.productId ?? ""}`)
  const value =
    String(item.deliveryInstructions ?? item.downloadUrl ?? item.licenseKey ?? item.key ?? "").trim() ||
    "Available in your account — contact the store if anything is missing."
  return { label, value }
}

/**
 * @param {number} storeId
 * @param {Record<string, unknown>} order
 * @param {PluginContext} ctx
 * @returns {Promise<{ id: string, title: string, items: { label: string, value: string }[] } | null>}
 */
async function deliveryProvider(storeId, order, ctx) {
  // `ctx` is store-scoped: use it for extra lookups (files, products, …).
  void storeId
  void ctx
  const lines = orderLines(order).filter((item) => item && typeof item === "object")
  const digital = lines.filter(
    (item) => item.isDigital || item.downloadUrl || item.licenseKey || item.deliveryInstructions,
  )
  if (digital.length === 0) return null

  return {
    id: "digital-delivery",
    title: "Your digital delivery",
    items: digital.map(lineFor),
  }
}

/** @type {NonNullable<PluginExports["apiRoutes"]>} */
const apiRoutes = {
  /** Tiny self-check for the API console: what would the buyer see? */
  preview: {
    GET: async (ctx) => ({
      ok: true,
      storeId: ctx.storeId,
      sample: {
        id: "digital-delivery",
        title: "Your digital delivery",
        items: [{ label: "Example album (MP3)", value: "Your download link appears here." }],
      },
    }),
  },
}

module.exports = { deliveryProvider, apiRoutes }
