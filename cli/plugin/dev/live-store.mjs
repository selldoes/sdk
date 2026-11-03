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
 *
 * Implementation lives under ./live-store/ — this module is the stable public
 * surface (re-exports) so callers and tests keep importing `live-store.mjs`.
 */

export {
  createLiveAiBridge,
  createLiveModelsBridge,
  createLivePromptsBridge,
} from "./live-store/ai-bridge.mjs"
export { connectStore, verifyStoreKey } from "./live-store/connection.mjs"
export {
  findLocalPlatformDir,
  LOCAL_PLATFORM_PORT,
  LOCAL_PLATFORM_URL,
  resolveLiveAppUrl,
} from "./live-store/platform-url.mjs"
export { createLiveProductsBridge } from "./live-store/products-bridge.mjs"
export { maskKey, readStoreBlock, storeView, writeStoreBlock } from "./live-store/store-config.mjs"
