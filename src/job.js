// @ts-check
/**
 * `selldoes/job` — runtime-agnostic helpers for plugin jobs.
 *
 * Everything here is pure JavaScript on top of `ctx.db`, so it runs in the
 * QuickJS sandbox and in Node jobs alike. The queue lives in a plugin-owned
 * table (`ctx.db.ensureTable`), is store-scoped by the host and survives
 * restarts — the supported replacement for juggling cursors in `ctx.storage`.
 *
 * @typedef {import("./index").PluginDB} PluginDB
 */

/** @typedef {"pending" | "processing" | "done" | "failed"} QueueStatus */

/**
 * One queued row, as returned by `queue.claim()` / `queue.peek()`.
 *
 * @template [T=unknown]
 * @typedef {object} QueueItem
 * @property {number} id
 * @property {string} ref              Stable identity (SKU, URL, file key, …).
 * @property {T | null} data           JSON payload attached to the item.
 * @property {QueueStatus} status
 * @property {number} attempts         Claim count so far (1 on first claim).
 * @property {string | null} error     Last failure message, if any.
 */

/**
 * @template [T=unknown]
 * @typedef {object} QueuePush
 * @property {string} ref
 * @property {T} [data]
 */

/**
 * @template [T=unknown]
 * @typedef {object} Queue
 * @property {string} table
 * @property {() => Promise<{ table: string, created: boolean }>} ensure
 * @property {(items: QueuePush<T> | QueuePush<T>[]) => Promise<{ inserted: number }>} push
 * @property {(limit?: number) => Promise<QueueItem<T>[]>} claim
 * @property {(items: QueueItem<T> | QueueItem<T>[] | number | number[]) => Promise<{ affected: number }>} complete
 * @property {(items: QueueItem<T> | QueueItem<T>[] | number | number[], error?: unknown) => Promise<{ failed: number, retried: number }>} fail
 * @property {(items: QueueItem<T> | QueueItem<T>[] | number | number[]) => Promise<{ affected: number }>} retry
 * @property {(items: QueueItem<T> | QueueItem<T>[] | number | number[]) => Promise<{ affected: number }>} reset
 * @property {(limit?: number, status?: QueueStatus) => Promise<QueueItem<T>[]>} peek
 * @property {() => Promise<{ pending: number, processing: number, done: number, failed: number, total: number }>} stats
 * @property {(options?: { status?: QueueStatus, all?: boolean }) => Promise<{ deleted: number }>} clear
 * @property {(handler: (item: QueueItem<T>) => Promise<void> | void, options?: DrainOptions) => Promise<DrainResult>} drain
 */

/**
 * @typedef {object} DrainOptions
 * @property {number} [batchSize=10]     Items claimed per round.
 * @property {number} [maxBatches]       Stop after this many rounds (default: unlimited).
 *                                      A failed item is left pending for a later run,
 *                                      not retried within the same drain.
 * @property {(result: { processed: number, failed: number, batches: number }) => void} [onBatch]
 */

/**
 * @typedef {object} DrainResult
 * @property {number} processed  Items handled without throwing.
 * @property {number} failed     Items whose handler threw (marked for retry/failed).
 * @property {number} batches    Rounds claimed.
 */

const STATUSES = /** @type {const} */ (["pending", "processing", "done", "failed"])

/**
 * Creates a durable job queue on top of `ctx.db`.
 *
 * @template [T=unknown]
 * @param {{ db: PluginDB }} ctx            Plugin or job context.
 * @param {string} name                     Plugin-owned table name (e.g. "import_queue").
 * @param {object} [options]
 * @param {number} [options.maxAttempts=3]  Attempts before an item is marked failed instead of retried.
 * @returns {Queue<T>}
 */
export function createQueue(ctx, name, options = {}) {
  const table = String(name ?? "").trim()
  if (!/^[a-z][a-z0-9_]{0,60}$/.test(table)) {
    throw new Error(`Invalid queue table name ${JSON.stringify(name)} — use lowercase letters, digits and underscores`)
  }
  const maxAttempts = Number(options.maxAttempts) > 0 ? Math.trunc(Number(options.maxAttempts)) : 3
  /** @type {Promise<{ table: string, created: boolean }> | null} */
  let ensured = null

  const ensure = () => {
    if (!ensured) {
      ensured = Promise.resolve(
        ctx.db.ensureTable(table, {
          ref: "varchar",
          data: "text",
          status: "varchar",
          attempts: "int",
          error: "text",
        }),
      ).catch((error) => {
        ensured = null
        throw error
      })
    }
    return ensured
  }

  /** @param {unknown} value */
  const parseData = (value) => {
    if (value === null || value === undefined || value === "") return null
    if (typeof value === "object") return value
    try {
      return JSON.parse(String(value))
    } catch {
      return null
    }
  }

  /** @param {Record<string, unknown>} row @returns {QueueItem<T>} */
  const toItem = (row) => ({
    id: Number(row.id),
    ref: String(row.ref ?? ""),
    data: /** @type {T | null} */ (parseData(row.data)),
    status: /** @type {QueueStatus} */ (STATUSES.includes(/** @type {any} */ (row.status)) ? row.status : "pending"),
    attempts: Number(row.attempts ?? 0),
    error: row.error === null || row.error === undefined ? null : String(row.error),
  })

  /** @param {QueueItem<T> | QueueItem<T>[] | number | number[]} items */
  const idsOf = (items) => {
    const list = Array.isArray(items) ? items : [items]
    return list
      .map((item) => (typeof item === "number" ? item : Number(/** @type {QueueItem<T>} */ (item)?.id)))
      .filter((id) => Number.isFinite(id) && id > 0)
  }

  return {
    table,
    ensure,

    async push(items) {
      await ensure()
      const list = Array.isArray(items) ? items : [items]
      if (list.length === 0) return { inserted: 0 }
      const rows = list.map((item) => ({
        ref: String(item?.ref ?? ""),
        data: JSON.stringify(item?.data === undefined ? null : item.data),
        status: "pending",
        attempts: 0,
        error: null,
      }))
      const result = await ctx.db.insertMany(table, rows)
      return { inserted: Number(result?.inserted ?? rows.length) }
    },

    async claim(limit = 10) {
      await ensure()
      const size = Math.max(Math.min(Math.trunc(Number(limit) || 10), 200), 1)
      const rows = await ctx.db.select(table, { status: "pending" }, { limit: size, orderBy: "id", orderDir: "asc" })
      /** @type {QueueItem<T>[]} */
      const claimed = []
      for (const row of rows) {
        const attempts = Number(row.attempts ?? 0) + 1
        // Conditional update: two concurrent claims cannot both win a row.
        const result = await ctx.db.update(
          table,
          { id: Number(row.id), status: "pending" },
          { status: "processing", attempts },
        )
        if (Number(result?.affected ?? 0) > 0) {
          claimed.push(toItem({ ...row, status: "processing", attempts }))
        }
      }
      return claimed
    },

    async complete(items) {
      await ensure()
      const ids = idsOf(items)
      if (ids.length === 0) return { affected: 0 }
      const result = await ctx.db.update(table, { id: { in: ids } }, { status: "done", error: null })
      return { affected: Number(result?.affected ?? ids.length) }
    },

    async fail(items, error) {
      await ensure()
      let failed = 0
      let retried = 0
      for (const id of idsOf(items)) {
        const [row] = await ctx.db.select(table, { id }, { limit: 1 })
        const attempts = Number(row?.attempts ?? maxAttempts)
        const nextStatus = attempts < maxAttempts ? "pending" : "failed"
        await ctx.db.update(table, { id }, { status: nextStatus, error: error === undefined ? null : String(error).slice(0, 1000) })
        if (nextStatus === "failed") failed += 1
        else retried += 1
      }
      return { failed, retried }
    },

    async retry(items) {
      await ensure()
      const ids = idsOf(items)
      if (ids.length === 0) return { affected: 0 }
      const result = await ctx.db.update(table, { id: { in: ids } }, { status: "pending" })
      return { affected: Number(result?.affected ?? ids.length) }
    },

    async reset(items) {
      await ensure()
      const ids = idsOf(items)
      if (ids.length === 0) return { affected: 0 }
      const result = await ctx.db.update(table, { id: { in: ids } }, { status: "pending", attempts: 0, error: null })
      return { affected: Number(result?.affected ?? ids.length) }
    },

    async peek(limit = 50, status) {
      await ensure()
      const size = Math.max(Math.min(Math.trunc(Number(limit) || 50), 500), 1)
      const rows = await ctx.db.select(table, status ? { status } : {}, { limit: size, orderBy: "id", orderDir: "asc" })
      return rows.map(toItem)
    },

    async stats() {
      await ensure()
      const [pending, processing, done, failed] = await Promise.all([
        ctx.db.count(table, { status: "pending" }),
        ctx.db.count(table, { status: "processing" }),
        ctx.db.count(table, { status: "done" }),
        ctx.db.count(table, { status: "failed" }),
      ])
      return { pending, processing, done, failed, total: pending + processing + done + failed }
    },

    async clear(options = {}) {
      await ensure()
      if (options.all) {
        const total = (await this.stats()).total
        const result = await ctx.db.delete(table, {})
        return { deleted: Number(result?.affected ?? total) }
      }
      const status = options.status ?? "done"
      const removed = await ctx.db.count(table, { status })
      const result = await ctx.db.delete(table, { status })
      return { deleted: Number(result?.affected ?? removed) }
    },

    async drain(handler, drainOptions = {}) {
      const batchSize = Math.max(Math.min(Math.trunc(Number(drainOptions.batchSize) || 10), 200), 1)
      const maxBatches = Number.isFinite(drainOptions.maxBatches) ? Math.max(Math.trunc(Number(drainOptions.maxBatches)), 1) : Infinity
      let processed = 0
      let failed = 0
      let batches = 0
      /** Ids attempted in this drain — a failed item is retried by the next run, not here. */
      const attempted = new Set()
      while (batches < maxBatches) {
        const items = await this.claim(batchSize)
        if (items.length === 0) break
        const repeated = items.filter((item) => attempted.has(item.id))
        if (repeated.length > 0) await this.retry(repeated)
        const fresh = items.filter((item) => !attempted.has(item.id))
        if (fresh.length === 0) break
        batches += 1
        for (const item of fresh) {
          attempted.add(item.id)
          try {
            await handler(item)
            await this.complete(item)
            processed += 1
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await this.fail(item, message)
            failed += 1
          }
        }
        drainOptions.onBatch?.({ processed, failed, batches })
      }
      return { processed, failed, batches }
    },
  }
}
