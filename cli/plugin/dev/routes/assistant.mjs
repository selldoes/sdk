import fs from "node:fs"
import path from "node:path"
import { json, readBody } from "../../../http.mjs"

/**
 * AI-assistant routes for the preview: config summary, chat, applying edits,
 * the provider connection test and the per-project chat history.
 *
 * Returns a `handle(req, res, url)` that resolves `true` once it has answered an
 * `/__dev/assistant*` request, `false` otherwise.
 */
export function createAssistantRoutes({
  readConfig,
  pluginDir,
  devDir,
  manifestStore,
  state,
  log,
  stream,
  rebuildAll,
  runner,
  ctx,
  resetJobEvents,
  jobEvents,
  assistantChat,
  assistantSummary,
  normalizeEdits,
  resolveAssistant,
}) {
  const historyPath = path.join(devDir, "assistant-chat.json")

  return async function handle(req, res, url) {
    const pathname = url.pathname

    if (req.method === "GET" && pathname === "/__dev/assistant") {
      json(res, 200, assistantSummary(resolveAssistant({ config: readConfig() })))
      return true
    }

    if (req.method === "POST" && pathname === "/__dev/assistant/chat") {
      const body = await readBody(req)
      try {
        const result = await assistantChat({
          pluginDir,
          manifest: manifestStore.read(),
          validation: manifestStore.validation(),
          activity: state.data,
          messages: body?.messages,
          context: body?.context,
          config: readConfig(),
          log,
        })
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, error.code === "not-configured" ? 400 : 502, { error: error.message, code: error.code })
      }
      return true
    }

    if (req.method === "POST" && pathname === "/__dev/assistant/apply") {
      const body = await readBody(req)
      const edits = normalizeEdits(body?.edits)
      if (!edits) {
        json(res, 400, { error: "Nothing to apply" })
        return true
      }
      const current = manifestStore.read()
      if (edits.manifest && String(edits.manifest.slug) !== String(current.slug)) {
        json(res, 400, { error: "The assistant tried to change the slug — that is not allowed" })
        return true
      }
      const files = edits.files.map((file) => file.path)
      const touched = edits.manifest ? [...files, "plugin.json"] : files
      manifestStore.snapshots.create({ reason: "ai edits", files: touched })
      const applied = []
      for (const file of edits.files) {
        const full = path.resolve(pluginDir, file.path)
        if (!full.startsWith(path.resolve(pluginDir) + path.sep)) continue
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, file.content)
        applied.push(file.path)
      }
      if (edits.manifest) {
        fs.writeFileSync(path.join(pluginDir, "plugin.json"), `${JSON.stringify(edits.manifest, null, 2)}\n`)
        applied.push("plugin.json")
      }
      log(`assistant applied ${applied.length} file(s): ${applied.join(", ")}`)
      stream.broadcast("snapshots", {})
      stream.broadcast("files", { paths: applied })
      const validation = manifestStore.validation()
      let rebuildError = null
      try {
        await rebuildAll()
      } catch (error) {
        rebuildError = error.message
      }

      // Closed loop: when the client asks for it, run the plugin's test-like
      // job so the outcome can be fed back into the chat.
      let test = null
      if (body?.testJob && !rebuildError) {
        let jobs = []
        try {
          jobs = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8")).jobs ?? []
        } catch {
          // manifest unreadable — skip the test run
        }
        const candidate = jobs.find((job) => /test|preview|probe/i.test(String(job?.type ?? "")))
        if (candidate) {
          try {
            resetJobEvents()
            const run = await runner.runJob(candidate.type, body?.testInput ?? {}, ctx, 8)
            test = {
              type: candidate.type,
              ticks: run.ticks.length,
              done: run.done,
              result: run.result ?? null,
              error: null,
              items: jobEvents.items.slice(0, 20),
              logs: jobEvents.logs.slice(0, 20),
            }
            log(
              `assistant closed loop: test job ${candidate.type} → ${run.done ? "done" : "tick limit"} (${run.ticks.length} tick(s))`,
            )
          } catch (error) {
            test = { type: candidate.type, error: error.message }
          }
        } else {
          test = { skipped: "no test-like job declared in plugin.json" }
        }
      }

      json(res, 200, {
        ok: true,
        applied,
        validation,
        ...(rebuildError ? { rebuildError } : {}),
        ...(test ? { test } : {}),
      })
      return true
    }

    if (req.method === "POST" && pathname === "/__dev/assistant/test") {
      const resolved = resolveAssistant({ config: readConfig() })
      if (!resolved.configured) {
        json(res, 400, { error: "No provider key configured", code: "not-configured" })
        return true
      }
      try {
        const headers = { "Content-Type": "application/json" }
        if (resolved.api === "anthropic") {
          headers["x-api-key"] = resolved.apiKey
          headers["anthropic-version"] = "2023-06-01"
        } else if (resolved.apiKey) {
          headers.Authorization = `Bearer ${resolved.apiKey}`
        }
        const response = await fetch(`${resolved.baseUrl}/models`, { headers, signal: AbortSignal.timeout(10_000) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error?.message ?? data?.error ?? `HTTP ${response.status}`)
        json(res, 200, { ok: true, provider: resolved.provider, model: resolved.model })
      } catch (error) {
        json(res, 502, { error: error.message, code: "unreachable" })
      }
      return true
    }

    // ── Chat history (persisted per project) ──────────────────────────────
    if (req.method === "GET" && pathname === "/__dev/assistant/history") {
      try {
        json(res, 200, JSON.parse(fs.readFileSync(historyPath, "utf8")))
      } catch {
        json(res, 200, { items: [] })
      }
      return true
    }
    if ((req.method === "PUT" || req.method === "POST") && pathname === "/__dev/assistant/history") {
      const body = await readBody(req)
      const items = Array.isArray(body?.items) ? body.items.slice(-60) : []
      const serialized = JSON.stringify({ items })
      if (serialized.length > 500_000) {
        json(res, 400, { error: "Chat history is too large" })
        return true
      }
      fs.mkdirSync(devDir, { recursive: true })
      fs.writeFileSync(historyPath, serialized)
      json(res, 200, { ok: true, count: items.length })
      return true
    }

    return false
  }
}
