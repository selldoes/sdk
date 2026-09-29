import fs from "node:fs"
import path from "node:path"

/**
 * In-memory, store-scoped mock of the host's `ctx.db` tables, persisted to
 * `<pluginDir>/.selldesk-dev/db.json` so preview data survives restarts.
 *
 * Semantics mirror the production sandbox: every row carries `store_id`,
 * conditions are equality by default and support the same operator objects
 * (`like`, `in`, `ne`, `gt`, `gte`, `lt`, `lte`, `isNull`, `notNull`; `null`
 * matches IS NULL), and `orderDir` chooses the sort direction.
 */
export class MockDb {
  constructor({ file }) {
    this.file = file
    this.tables = {}
    this.saveTimer = null
    this.load()
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"))
        if (parsed && typeof parsed === "object" && parsed.tables) this.tables = parsed.tables
      }
    } catch {
      this.tables = {}
    }
  }

  save() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveNow(), 150)
  }

  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify({ tables: this.tables }, null, 2))
  }

  reset() {
    this.tables = {}
    this.saveNow()
  }

  hasTable(name) {
    return Boolean(this.tables[name])
  }

  ensureTable(name, columns = {}, storeId) {
    if (this.tables[name]) return { table: name, created: false }
    this.tables[name] = {
      columns: { id: "int", store_id: "int", ...columns },
      rows: [],
      nextId: 1,
      createdAt: new Date().toISOString(),
      createdStoreId: storeId,
    }
    this.save()
    return { table: name, created: true }
  }

  table(name) {
    const table = this.tables[name]
    if (!table) {
      throw new Error(
        `Table "${name}" does not exist. Own tables are created with ctx.db.ensureTable(); system tables must already exist.`,
      )
    }
    return table
  }

  clone(row) {
    return JSON.parse(JSON.stringify(row))
  }

  matches(row, conditions) {
    for (const [key, value] of Object.entries(conditions ?? {})) {
      const current = row[key]
      if (value === null || value === undefined) {
        if (current !== null && current !== undefined) return false
        continue
      }
      if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
        const op = value
        if (op.like !== undefined) {
          const needle = String(op.like).toLowerCase()
          if (!String(current ?? "").toLowerCase().includes(needle)) return false
          continue
        }
        if (Array.isArray(op.in)) {
          if (!op.in.some((item) => String(item) === String(current))) return false
          continue
        }
        if (op.isNull === true) {
          if (current !== null && current !== undefined) return false
          continue
        }
        if (op.notNull === true) {
          if (current === null || current === undefined) return false
          continue
        }
        if (op.ne !== undefined && String(current) === String(op.ne)) return false
        if (op.gt !== undefined && !(Number(current) > Number(op.gt))) return false
        if (op.gte !== undefined && !(Number(current) >= Number(op.gte))) return false
        if (op.lt !== undefined && !(Number(current) < Number(op.lt))) return false
        if (op.lte !== undefined && !(Number(current) <= Number(op.lte))) return false
        continue
      }
      if (String(current) !== String(value)) return false
    }
    return true
  }

  filtered(name, conditions, storeId) {
    const table = this.table(name)
    return table.rows.filter(
      (row) => (storeId === undefined || Number(row.store_id) === Number(storeId)) && this.matches(row, conditions),
    )
  }

  select(name, conditions = {}, opts = {}, storeId) {
    const rows = this.filtered(name, conditions, storeId)
    if (opts.orderBy) {
      const direction = opts.orderDir === "asc" ? 1 : -1
      rows.sort((a, b) => {
        const left = a[opts.orderBy]
        const right = b[opts.orderBy]
        if (typeof left === "number" && typeof right === "number") return (left - right) * direction
        return String(left ?? "").localeCompare(String(right ?? "")) * direction
      })
    }
    const offset = Math.max(Number(opts.offset) || 0, 0)
    const limit = Math.max(Math.min(Number(opts.limit) || 100, 1000), 1)
    return rows.slice(offset, offset + limit).map((row) => this.clone(row))
  }

  count(name, conditions = {}, storeId) {
    return this.filtered(name, conditions, storeId).length
  }

  insert(name, data = {}, storeId) {
    const table = this.table(name)
    const row = { ...data, id: table.nextId++ }
    if (storeId !== undefined) row.store_id = Number(storeId)
    table.rows.push(row)
    this.save()
    return { id: row.id }
  }

  insertMany(name, rows = [], storeId) {
    const ids = []
    for (const row of rows) ids.push(this.insert(name, row, storeId).id)
    return { inserted: ids.length, ids }
  }

  update(name, conditions, data = {}, storeId) {
    const rows = this.filtered(name, conditions, storeId)
    const clean = { ...data }
    delete clean.id
    delete clean.store_id
    for (const row of rows) Object.assign(row, clean)
    if (rows.length > 0) this.save()
    return { affected: rows.length }
  }

  delete(name, conditions, storeId) {
    const table = this.table(name)
    const before = table.rows.length
    table.rows = table.rows.filter(
      (row) => !((storeId === undefined || Number(row.store_id) === Number(storeId)) && this.matches(row, conditions)),
    )
    const affected = before - table.rows.length
    if (affected > 0) this.save()
    return { affected }
  }

  snapshot() {
    const out = {}
    for (const [name, table] of Object.entries(this.tables)) {
      out[name] = { rows: table.rows.length, columns: Object.keys(table.columns) }
    }
    return out
  }
}

/** Sample commerce data so plugins that read products/orders have something to show. */
export function seedDemoTables(db, storeId) {
  if (!db.hasTable("products")) db.ensureTable("products", { name: "varchar", sku: "varchar", price: "decimal", status: "varchar" }, storeId)
  if (!db.hasTable("orders")) db.ensureTable("orders", { order_number: "varchar", total: "decimal", status: "varchar", created_at: "timestamp" }, storeId)
  if (!db.hasTable("customers")) db.ensureTable("customers", { name: "varchar", email: "varchar" }, storeId)

  if (db.count("products", {}, storeId) === 0) {
    db.insertMany(
      "products",
      [
        { name: "Classic Tee", sku: "TEE-001", price: 24.9, status: "active" },
        { name: "Canvas Tote", sku: "TOTE-002", price: 18.5, status: "active" },
        { name: "Mug — Logo", sku: "MUG-003", price: 12.0, status: "draft" },
      ],
      storeId,
    )
  }
  if (db.count("orders", {}, storeId) === 0) {
    db.insertMany(
      "orders",
      [
        { order_number: "1001", total: 49.8, status: "paid", created_at: new Date().toISOString().slice(0, 19).replace("T", " ") },
        { order_number: "1002", total: 12.0, status: "pending", created_at: new Date().toISOString().slice(0, 19).replace("T", " ") },
      ],
      storeId,
    )
  }
  if (db.count("customers", {}, storeId) === 0) {
    db.insertMany("customers", [{ name: "Ada Lovelace", email: "ada@example.com" }], storeId)
  }
}
