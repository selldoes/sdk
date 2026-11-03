import fs from "node:fs"
import path from "node:path"

/**
 * Builds the mock `ctx.storage` capability. `ctx.storage` is plugin- and
 * store-scoped in production; the mock keeps the same scoping in one JSON file
 * (`<devDir>/storage.json`) so switching stores cannot leak values.
 */
export function createStorage({ devDir, storeId, tablePrefix, requirePermission, log }) {
  const storagePath = path.join(devDir, "storage.json")
  const storageScope = `${storeId}:${tablePrefix}`
  const readStorageFile = () => {
    try {
      return JSON.parse(fs.readFileSync(storagePath, "utf8"))
    } catch {
      return {}
    }
  }
  const storageEntries = () => readStorageFile()[storageScope] ?? {}
  const writeStorageEntries = (entries) => {
    const all = readStorageFile()
    if (Object.keys(entries).length > 0) all[storageScope] = entries
    else delete all[storageScope]
    fs.mkdirSync(devDir, { recursive: true })
    fs.writeFileSync(storagePath, `${JSON.stringify(all, null, 2)}\n`)
  }

  return {
    async get(key) {
      requirePermission("storage:read", "ctx.storage.get")
      const entry = storageEntries()[String(key)]
      return entry === undefined ? null : entry.value
    },
    async set(key, value) {
      requirePermission("storage:write", "ctx.storage.set")
      const entries = storageEntries()
      entries[String(key)] = { value, updatedAt: new Date().toISOString() }
      writeStorageEntries(entries)
      log(`[storage] set ${key}`)
      return { key: String(key) }
    },
    async delete(key) {
      requirePermission("storage:write", "ctx.storage.delete")
      const entries = storageEntries()
      const existed = Object.hasOwn(entries, String(key))
      delete entries[String(key)]
      writeStorageEntries(entries)
      return { deleted: existed }
    },
    async list(prefix = "") {
      requirePermission("storage:read", "ctx.storage.list")
      const wanted = String(prefix ?? "")
      return Object.entries(storageEntries())
        .filter(([key]) => !wanted || key.startsWith(wanted))
        .map(([key, entry]) => ({ key, updatedAt: entry?.updatedAt }))
        .sort((a, b) => a.key.localeCompare(b.key))
    },
  }
}
