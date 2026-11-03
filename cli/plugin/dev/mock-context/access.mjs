/**
 * Permission and table-scope helpers shared by the mock capabilities. Mirrors
 * the production sandbox: plugin.json is re-read on every check so the dev
 * server keeps running while you edit permissions/allowedTables, and a restart
 * is not required for the mock to honour them.
 */
export function createAccess({ manifest, getManifest, tablePrefix, db, storeId, log }) {
  const currentManifest = () => (getManifest ? getManifest() : manifest) ?? manifest
  const currentPermissions = () => new Set(currentManifest().permissions ?? [])
  const currentAllowedTables = () => new Set(currentManifest().allowedTables ?? [])

  const requirePermission = (permission, action) => {
    if (!currentPermissions().has(permission)) {
      throw new Error(`Missing permission "${permission}" required for ${action}. Add it to plugin.json "permissions".`)
    }
  }

  const resolveTable = (name) => {
    const table = String(name ?? "")
    if (table.startsWith(tablePrefix)) return table
    if (table.startsWith("plugin_")) throw new Error(`Plugins cannot access another plugin's table "${table}"`)
    if (currentAllowedTables().has(table)) return table
    return `${tablePrefix}${table.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`
  }

  const checkAccess = (table, mode) => {
    const owned = table.startsWith(tablePrefix)
    if (!owned && !currentAllowedTables().has(table)) {
      throw new Error(`Table "${table}" is not declared in plugin.json "allowedTables".`)
    }
    if (mode === "read") requirePermission("db:read", `ctx.db read on "${table}"`)
    else requirePermission("db:write", `ctx.db write on "${table}"`)
  }

  /**
   * Platform tables (declared in allowedTables) already exist in production;
   * in the mock they are created lazily on first use with no fixed columns.
   */
  const ensureAccessibleTable = (table) => {
    if (db.hasTable(table)) return
    if (table.startsWith(tablePrefix)) {
      throw new Error(`Table "${table}" does not exist yet — create it with ctx.db.ensureTable().`)
    }
    db.ensureTable(table, {}, storeId)
    log(`[db] created mock table ${table} (platform table from allowedTables)`)
  }

  return {
    currentManifest,
    currentPermissions,
    requirePermission,
    resolveTable,
    checkAccess,
    ensureAccessibleTable,
  }
}
