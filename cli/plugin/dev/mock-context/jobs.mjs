/**
 * Builds the mock `ctx.jobs` capability. Progress/items/logs are recorded on
 * the shared `jobEvents`; `enqueue` validates against plugin.json and records
 * onto `pendingJobs`, which the dev server drains.
 */
export function createJobs({ currentManifest, jobEvents, pendingJobs, log }) {
  let enqueuedJobCursor = 0

  return {
    async progress(update = {}) {
      const entry = { ...update, at: new Date().toISOString() }
      jobEvents.progress.push(entry)
      const bits = []
      if (entry.processed !== undefined)
        bits.push(`${entry.processed}${entry.total !== undefined ? `/${entry.total}` : ""} processed`)
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
    async enqueue(request = {}) {
      const type = String(request?.type ?? "").trim()
      const declared = (currentManifest().jobs ?? []).some((job) => job?.type === type)
      if (!declared) throw new Error(`Job "${type}" is not declared in plugin.json "jobs"`)
      const jobId = ++enqueuedJobCursor
      pendingJobs.push({ jobId, type, input: request?.input ?? null, at: new Date().toISOString() })
      log(`[job] enqueued ${type} (#${jobId})`)
      return { jobId }
    },
  }
}
