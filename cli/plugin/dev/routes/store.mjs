import { json, readBody } from "../../../http.mjs"
import { connectStore, readStoreBlock, storeView, verifyStoreKey, writeStoreBlock } from "../live-store.mjs"

/**
 * Developer-account and live-store routes.
 *
 * The live-store handlers swap the mock context's product bridge in place
 * (`applyLiveStore`) and keep `ctxConfig.store` in sync so running jobs see the
 * change immediately.
 *
 * Returns a `handle(req, res, url)` that resolves `true` once it has answered a
 * `/__dev/account*` or `/__dev/store*` request, `false` otherwise.
 */
export function createStoreRoutes({ pluginDir, readConfig, accountInfo, liveStore, ctxConfig, applyLiveStore, resolveAppUrl }) {
  return async function handle(req, res, url) {
    const pathname = url.pathname

    // ── Developer account ──────────────────────────────────────────────────
    if (req.method === "GET" && pathname === "/__dev/account") {
      json(res, 200, await accountInfo())
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/account/connect") {
      const body = await readBody(req)
      const account = await import("../../../account.mjs")
      try {
        const result = await account.connectDeveloper(String(body?.token ?? ""), body?.appUrl ? String(body.appUrl) : undefined)
        json(res, 200, {
          connected: true,
          appUrl: result.appUrl,
          email: result.account?.email,
          name: result.account?.name,
          status: result.account?.status,
        })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/account/disconnect") {
      const account = await import("../../../account.mjs")
      const had = account.disconnectDeveloper()
      json(res, 200, { connected: false, had })
      return true
    }

    // ── Live store connection (ctx.products → a real store) ───────────────
    if (req.method === "GET" && pathname === "/__dev/store") {
      json(res, 200, {
        ...storeView(readConfig()),
        active: Boolean(liveStore.bridge),
        connection: liveStore.connection
          ? {
              appUrl: liveStore.connection.appUrl,
              storeId: liveStore.connection.storeId,
              storeSlug: liveStore.connection.storeSlug,
            }
          : null,
      })
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/store/verify") {
      const body = await readBody(req)
      const stored = readStoreBlock(readConfig())
      const apiKey = body?.useStoredKey ? stored.apiKey : body?.apiKey
      if (body?.useStoredKey && !apiKey) {
        json(res, 400, { error: "No stored merchant API key for this project — enter the key first." })
        return true
      }
      try {
        const verified = await verifyStoreKey({
          appUrl: await resolveAppUrl(body?.appUrl),
          apiKey,
        })
        json(res, 200, {
          ok: true,
          appUrl: verified.appUrl,
          userId: verified.userId,
          apiKeySet: Boolean(verified.apiKey),
          stores: verified.stores,
        })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/store/connect") {
      const body = await readBody(req)
      const stored = readStoreBlock(readConfig())
      const apiKey = body?.useStoredKey ? stored.apiKey : body?.apiKey
      if (body?.useStoredKey && !apiKey) {
        json(res, 400, { error: "No stored merchant API key for this project — enter the key first." })
        return true
      }
      try {
        const connected = await connectStore({
          appUrl: await resolveAppUrl(body?.appUrl),
          apiKey,
          storeId: body?.storeId,
          storeSlug: body?.storeSlug,
        })
        writeStoreBlock(pluginDir, {
          live: true,
          appUrl: connected.appUrl,
          apiKey: connected.apiKey,
          storeId: connected.storeId,
          storeSlug: connected.storeSlug,
        })
        ctxConfig.store = readStoreBlock(readConfig())
        applyLiveStore()
        json(res, 200, {
          ok: true,
          ...storeView(readConfig()),
          active: Boolean(liveStore.bridge),
          storeName: connected.storeName,
          connection: { appUrl: connected.appUrl, storeId: connected.storeId, storeSlug: connected.storeSlug },
        })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/store/disconnect") {
      writeStoreBlock(pluginDir, { live: false })
      delete ctxConfig.store
      applyLiveStore()
      json(res, 200, { ok: true, active: false, ...storeView(readConfig()) })
      return true
    }

    return false
  }
}
