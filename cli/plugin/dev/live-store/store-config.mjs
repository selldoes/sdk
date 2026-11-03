import fs from "node:fs"
import path from "node:path"

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
