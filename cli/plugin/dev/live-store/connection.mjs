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
