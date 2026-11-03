/** Builds the mock `ctx.db` capability (store scoping + allowed-tables enforcement). */
export function createDb({ db, storeId, tablePrefix, requirePermission, resolveTable, checkAccess, ensureAccessibleTable, log }) {
  return {
    async ensureTable(name, columns) {
      requirePermission("db:schema", "ctx.db.ensureTable")
      const table = `${tablePrefix}${String(name)
        .replace(/[^a-z0-9_]/gi, "_")
        .toLowerCase()}`
      const result = db.ensureTable(table, columns, storeId)
      if (result.created) log(`[db] created table ${table}`)
      return result
    },
    async select(table, conditions = {}, opts = {}) {
      const resolved = resolveTable(table)
      checkAccess(resolved, "read")
      ensureAccessibleTable(resolved)
      return db.select(resolved, conditions, opts, storeId)
    },
    async count(table, conditions = {}) {
      const resolved = resolveTable(table)
      checkAccess(resolved, "read")
      ensureAccessibleTable(resolved)
      return db.count(resolved, conditions, storeId)
    },
    async insert(table, data = {}) {
      const resolved = resolveTable(table)
      checkAccess(resolved, "write")
      ensureAccessibleTable(resolved)
      return db.insert(resolved, data, storeId)
    },
    async insertMany(table, rows = []) {
      const resolved = resolveTable(table)
      checkAccess(resolved, "write")
      ensureAccessibleTable(resolved)
      return db.insertMany(resolved, rows, storeId)
    },
    async update(table, conditions, data) {
      const resolved = resolveTable(table)
      checkAccess(resolved, "write")
      ensureAccessibleTable(resolved)
      return db.update(resolved, conditions, data, storeId)
    },
    async delete(table, conditions) {
      const resolved = resolveTable(table)
      checkAccess(resolved, "write")
      ensureAccessibleTable(resolved)
      return db.delete(resolved, conditions, storeId)
    },
  }
}
