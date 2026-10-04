import fs from "node:fs"
import path from "node:path"

/**
 * Builds a `PluginContext` that mirrors the production sandbox for local
 * development: permission checks, store scoping, allowed-tables enforcement,
 * and mocked AI/email/realtime/files behaviour.
 *
 * Differences from production are deliberate and documented in the CLI README:
 * the runtime executes in Node (not QuickJS), and outbound integrations are
 * mocked unless configured in `selldoes.config.json`.
 */
export function createMockContext({ pluginDir, manifest, db, storeId, config = {}, devDir, log = () => {} }) {
  const tablePrefix = `plugin_${String(manifest.slug).replace(/-/g, "_")}_`
  const permissions = new Set(manifest.permissions ?? [])
  const allowedTables = new Set(manifest.allowedTables ?? [])
  const outbox = []
  const events = []
  const jobEvents = { logs: [], items: [], progress: [] }
  const filesDir = path.join(devDir, "files")
  let realtimeCursor = 0

  const requirePermission = (permission, action) => {
    if (!permissions.has(permission)) {
      throw new Error(`Missing permission "${permission}" required for ${action}. Add it to plugin.json "permissions".`)
    }
  }

  const resolveTable = (name) => {
    const table = String(name ?? "")
    if (table.startsWith(tablePrefix)) return table
    if (table.startsWith("plugin_")) throw new Error(`Plugins cannot access another plugin's table "${table}"`)
    if (allowedTables.has(table)) return table
    return `${tablePrefix}${table.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`
  }

  const checkAccess = (table, mode) => {
    const owned = table.startsWith(tablePrefix)
    if (!owned && !allowedTables.has(table)) {
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

  const filesUrl = (key) => `/__dev/files/${encodeURIComponent(key)}`

  // ctx.storage is plugin- and store-scoped in production; the mock keeps the
  // same scoping in one JSON file so switching stores cannot leak values.
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

  const ctx = {
    storeId,
    permissions: [...permissions],
    tablePrefix,
    config,

    db: {
      async ensureTable(name, columns) {
        requirePermission("db:schema", "ctx.db.ensureTable")
        const table = `${tablePrefix}${String(name).replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`
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
    },

    http: {
      async get(url, headers, opts) {
        return httpRequest("GET", url, undefined, headers, opts)
      },
      async post(url, body, headers, opts) {
        return httpRequest("POST", url, body, headers, opts)
      },
    },

    ai: {
      async complete(opts = {}) {
        requirePermission("ai:use", "ctx.ai.complete")
        const prompt = String(opts.prompt ?? "")
        log(`[ai] complete(${prompt.length} chars)${opts.model ? ` model=${opts.model}` : ""}`)
        let text = config.ai?.mockReply ?? "(mock AI reply — set `ai.mockReply` in selldoes.config.json)"
        for (const [needle, reply] of Object.entries(config.ai?.responses ?? {})) {
          if (prompt.toLowerCase().includes(String(needle).toLowerCase())) {
            text = String(reply)
            break
          }
        }
        return { text, tokensUsed: 0 }
      },
      async image() {
        requirePermission("ai:use", "ctx.ai.image")
        log("[ai] image()")
        return { url: config.ai?.mockImage ?? "" }
      },
    },

    files: {
      async upload({ name, data, folder }) {
        requirePermission("files:write", "ctx.files.upload")
        fs.mkdirSync(filesDir, { recursive: true })
        const safe = `${folder ? `${String(folder).replace(/[^a-z0-9_-]/gi, "_")}/` : ""}${String(name).replace(/[^a-z0-9._-]/gi, "_")}`
        const base64 = String(data).replace(/^data:[^;]+;base64,/, "")
        fs.mkdirSync(path.dirname(path.join(filesDir, safe)), { recursive: true })
        fs.writeFileSync(path.join(filesDir, safe), Buffer.from(base64, "base64"))
        const key = safe.replace(/\\/g, "/")
        return { url: filesUrl(key), key, size: fs.statSync(path.join(filesDir, safe)).size }
      },
      async importFromUrl({ url, name, folder }) {
        requirePermission("files:write", "ctx.files.importFromUrl")
        const response = await fetch(url)
        const buffer = Buffer.from(await response.arrayBuffer())
        fs.mkdirSync(filesDir, { recursive: true })
        const safe = `${folder ? `${String(folder).replace(/[^a-z0-9_-]/gi, "_")}/` : ""}${String(name ?? path.basename(new URL(url).pathname)).replace(/[^a-z0-9._-]/gi, "_")}`
        fs.mkdirSync(path.dirname(path.join(filesDir, safe)), { recursive: true })
        fs.writeFileSync(path.join(filesDir, safe), buffer)
        const key = safe.replace(/\\/g, "/")
        return { url: filesUrl(key), key, size: buffer.length }
      },
      async list(prefix = "") {
        requirePermission("files:read", "ctx.files.list")
        if (!fs.existsSync(filesDir)) return []
        const out = []
        const walk = (current) => {
          for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name)
            if (entry.isDirectory()) walk(full)
            else {
              const key = path.relative(filesDir, full).replace(/\\/g, "/")
              if (!prefix || key.startsWith(prefix)) out.push({ key, url: filesUrl(key), size: fs.statSync(full).size })
            }
          }
        }
        walk(filesDir)
        return out
      },
      async delete(key) {
        requirePermission("files:write", "ctx.files.delete")
        const target = path.join(filesDir, String(key))
        if (!target.startsWith(filesDir) || !fs.existsSync(target)) return { deleted: false }
        fs.rmSync(target)
        return { deleted: true }
      },
    },

    products: {
      async list(opts = {}) {
        requirePermission("products:read", "ctx.products.list")
        const conditions = opts.status ? { status: String(opts.status) } : {}
        const rows = db.select(
          "products",
          conditions,
          {
            limit: opts.limit ?? 50,
            offset: opts.offset ?? 0,
            orderBy: opts.orderBy ?? "id",
            orderDir: opts.orderDir ?? "desc",
          },
          storeId,
        )
        if (Array.isArray(opts.fields) && opts.fields.length > 0) {
          return rows.map((row) => {
            const projected = {}
            for (const field of opts.fields) projected[field] = row[field]
            return projected
          })
        }
        return rows
      },
      async create(input = {}) {
        requirePermission("products:write", "ctx.products.create")
        if (!input?.name) throw new Error("products.create requires a name")
        return { id: db.insert("products", input, storeId).id }
      },
      async update(id, input = {}) {
        requirePermission("products:write", "ctx.products.update")
        const existing = db.select("products", { id: Number(id) }, { limit: 1 }, storeId)[0]
        if (!existing) throw new Error(`Product ${id} not found in this store`)
        db.update("products", { id: Number(id) }, input, storeId)
        return { updated: true }
      },
      async get(id) {
        requirePermission("products:read", "ctx.products.get")
        return db.select("products", { id: Number(id) }, { limit: 1 }, storeId)[0] ?? null
      },
      async findBySku(sku) {
        requirePermission("products:read", "ctx.products.findBySku")
        return db.select("products", { sku: String(sku) }, { limit: 1 }, storeId)[0] ?? null
      },
      async upsertBySku(input) {
        requirePermission("products:write", "ctx.products.upsertBySku")
        const existing = db.select("products", { sku: input.sku }, { limit: 1 }, storeId)[0]
        if (existing) {
          db.update("products", { id: existing.id }, input, storeId)
          return { id: existing.id, created: false }
        }
        return { id: db.insert("products", input, storeId).id, created: true }
      },
    },

    jobs: {
      async progress(update = {}) {
        const entry = { ...update, at: new Date().toISOString() }
        jobEvents.progress.push(entry)
        const bits = []
        if (entry.processed !== undefined) bits.push(`${entry.processed}${entry.total !== undefined ? `/${entry.total}` : ""} processed`)
        if (entry.failed) bits.push(`${entry.failed} failed`)
        if (entry.skipped) bits.push(`${entry.skipped} skipped`)
        if (entry.message) bits.push(entry.message)
        log(`[job] progress ${bits.join(" · ") || "updated"}`)
      },
      async item(entry = {}) {
        jobEvents.items.push(entry)
        log(`[job] item ${entry.status ?? "ok"} ${entry.ref ?? ""}${entry.error ? ` — ${entry.error}` : ""}`)
      },
      async log(message, level = "info") {
        jobEvents.logs.push({ message: String(message), level })
        log(`[job] ${message}`)
      },
    },

    realtime: {
      async publish(channel, event, data) {
        requirePermission("realtime:publish", "ctx.realtime.publish")
        const entry = { id: ++realtimeCursor, channel: String(channel), event: String(event), data, at: new Date().toISOString() }
        events.push(entry)
        if (events.length > 500) events.shift()
        log(`[realtime] ${channel} → ${event}`)
        return { id: entry.id, pushed: false }
      },
      async poll(channel, opts = {}) {
        const since = Number(opts.since) || 0
        const list = events.filter((entry) => entry.channel === String(channel) && entry.id > since)
        const limited = list.slice(0, opts.limit ?? 50)
        return { events: limited.map((entry) => ({ id: entry.id, event: entry.event, data: entry.data })), cursor: limited.at(-1)?.id ?? since }
      },
    },

    email: {
      async send({ to, subject, html, text }) {
        requirePermission("email:send", "ctx.email.send")
        const entry = { to: String(to ?? ""), subject: String(subject ?? ""), html: html ?? null, text: text ?? null, at: new Date().toISOString() }
        outbox.push(entry)
        if (outbox.length > 100) outbox.shift()
        log(`[email] → ${entry.to}: ${entry.subject}`)
        return { sent: config.email?.disabled !== true }
      },
    },

    secrets: {
      async get(name) {
        requirePermission("secrets:read", "ctx.secrets.get")
        const value = config.secrets?.[String(name)]
        return value === undefined || value === null ? null : String(value)
      },
    },

    storage: {
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
        const existed = Object.prototype.hasOwnProperty.call(entries, String(key))
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
    },
  }

  async function httpRequest(method, url, body, headers, opts) {
    requirePermission("api:external", "ctx.http")
    // 60s default/cap — scraping via apiraven (waitUntil=load) needs the headroom.
    const requested = Number(opts?.timeoutMs)
    const timeoutMs = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : 60_000, 1_000), 60_000)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method,
        headers: { ...(headers ?? {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      const text = await response.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
      return { status: response.status, data }
    } finally {
      clearTimeout(timer)
    }
  }

  return { ctx, outbox, events, jobEvents }
}
