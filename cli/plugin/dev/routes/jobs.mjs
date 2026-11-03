import { json, readBody } from "../../../http.mjs"

/**
 * Mock-data and job/hook/delivery routes for the preview: inspect and reset the
 * mock tables, rebuild, run a job (draining chained jobs), fire a hook or a
 * delivery handler, and read the outbox/events/logs streams.
 *
 * Returns a `handle(req, res, url)` that resolves `true` once it has answered a
 * matching request, `false` otherwise.
 */
export function createJobRoutes({
  db,
  storeId,
  seedDemoTables,
  log,
  rebuildAll,
  runner,
  resetJobEvents,
  ctx,
  state,
  pendingJobs,
  jobEvents,
  config,
  outbox,
  events,
  logs,
}) {
  return async function handle(req, res, url) {
    const pathname = url.pathname

    // ── Existing dev tools ─────────────────────────────────────────────────
    if (req.method === "GET" && pathname === "/__dev/state") {
      const tables = {}
      for (const [name, table] of Object.entries(db.tables)) {
        tables[name] = {
          rows: table.rows.length,
          columns: Object.keys(table.columns),
          sample: table.rows.slice(0, 5),
        }
      }
      json(res, 200, { tables })
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/reset-data") {
      db.reset()
      seedDemoTables(db, storeId)
      log("mock data reset")
      json(res, 200, { ok: true })
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/rebuild") {
      try {
        await rebuildAll()
        json(res, 200, { ok: true, rebuilds: runner.rebuilds })
      } catch (error) {
        json(res, 500, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/run-job") {
      const body = await readBody(req)
      try {
        resetJobEvents()
        const maxTicks = Math.max(1, Math.min(Number(body?.maxTicks) || 50, 500))
        const run = await runner.runJob(body?.type, body?.input ?? {}, ctx, maxTicks)
        state.record("jobs", { type: body?.type })
        const summary = run.kind === "node" ? "on the Node runtime" : `${run.ticks.length} tick(s)`
        log(`job ${body?.type} ran ${summary}${run.done ? " — done" : " — tick limit reached"}`)

        // Drain jobs queued with ctx.jobs.enqueue, so chained workflows
        // (discover → import batches) run end-to-end in the dev preview.
        const chained = []
        const CHAIN_LIMIT = 10
        while (pendingJobs.length > 0 && chained.length < CHAIN_LIMIT) {
          const next = pendingJobs.shift()
          const chainedRun = await runner.runJob(next.type, next.input ?? {}, ctx, maxTicks)
          chained.push({
            type: next.type,
            jobId: next.jobId,
            kind: chainedRun.kind,
            ticks: chainedRun.ticks.length,
            done: chainedRun.done,
            result: chainedRun.result ?? null,
          })
          log(`chained job ${next.type} ran${chainedRun.done ? " — done" : " — tick limit reached"}`)
        }
        if (pendingJobs.length > 0) {
          log(`job queue still holds ${pendingJobs.length} job(s) — run the job again to continue`)
        }

        const stateJson = run.state === undefined || run.state === null ? "" : JSON.stringify(run.state)
        json(res, 200, {
          ok: true,
          run: {
            kind: run.kind,
            ticks: run.ticks.length,
            done: run.done,
            result: run.result ?? null,
            state: stateJson && stateJson.length <= 20000 ? run.state : undefined,
          },
          chained,
          queued: pendingJobs.length,
          telemetry: {
            progress: jobEvents.progress.slice(),
            items: jobEvents.items.slice(),
            logs: jobEvents.logs.slice(),
          },
        })
      } catch (error) {
        json(res, 500, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/run-hook") {
      const body = await readBody(req)
      try {
        const result = await runner.runHook(body?.hook, body?.payload ?? {}, ctx)
        state.record("hooks", { hook: body?.hook })
        log(`hook ${body?.hook} fired`)
        json(res, 200, { ok: true, result: result ?? null })
      } catch (error) {
        json(res, 500, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/delivery") {
      const body = await readBody(req)
      try {
        const result = await runner.runDelivery(
          body?.order ?? config.sampleOrder ?? { id: 1001, order_number: "1001", items: [] },
          ctx,
        )
        json(res, 200, { ok: true, result: result ?? null })
      } catch (error) {
        json(res, 500, { error: error.message })
      }
      return true
    }
    if (req.method === "GET" && pathname === "/__dev/outbox") {
      json(res, 200, { outbox })
      return true
    }
    if (req.method === "GET" && pathname === "/__dev/events") {
      json(res, 200, { events })
      return true
    }
    if (req.method === "GET" && pathname === "/__dev/logs") {
      json(res, 200, { logs: logs.slice(-80), rebuilds: runner.rebuilds })
      return true
    }

    return false
  }
}
