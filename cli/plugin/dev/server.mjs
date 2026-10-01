import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { contentTypeFor, readJson } from "../../util.mjs"
import { openInEditor, openTerminal } from "../../open-editor.mjs"
import { buildPlugin } from "../build.mjs"
import { MockDb, seedDemoTables } from "./mock-db.mjs"
import { createMockContext } from "./mock-context.mjs"
import { PluginRunner, cleanPath } from "./runner.mjs"
import { ManifestStore } from "./manifest-store.mjs"
import { DevState } from "./dev-state.mjs"
import { deleteAsset, resolveAsset, saveAsset } from "./assets.mjs"
import { assistantChat, assistantSummary, normalizeEdits, resolveAssistant } from "./assistant.mjs"
import { createFilesService } from "./files.mjs"
import { createGit } from "./git.mjs"
import { createStream, watchProject } from "./stream.mjs"
import { attachTerminalServer } from "../../terminal.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI_DIR = path.join(HERE, "ui-dist")

const UI_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
].join("; ")

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  res.end(body)
}

function html(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ""
    req.on("data", (chunk) => {
      data += chunk
      if (data.length > 8_000_000) req.destroy()
    })
    req.on("end", () => {
      if (!data) return resolve(null)
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve(data)
      }
    })
  })
}

/** Serves the built React preview SPA (ui-dist) with an index.html fallback. */
function servePreview(res, pathname) {
  if (!fs.existsSync(UI_DIR)) {
    return html(
      res,
      503,
      `<!doctype html><html><body style="font:14px system-ui;padding:40px;max-width:640px;margin:auto">
        <h2>Preview UI is not built yet</h2>
        <p>The <code>selldoes</code> package you are running does not include <code>cli/plugin/dev/ui-dist</code>.</p>
        <p>If you are working on the SDK itself, build it once:</p>
        <pre style="background:#f4f4f5;padding:12px;border-radius:8px">npm --prefix dev-ui install\nnpm --prefix dev-ui run build</pre>
      </body></html>`,
    )
  }
  let relative = decodeURIComponent(pathname.replace(/^\/preview\/?/, ""))
  if (!relative || !path.extname(relative)) relative = "index.html"
  let file = path.resolve(UI_DIR, relative)
  if (!file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.join(UI_DIR, "index.html")
  }
  res.writeHead(200, { "Content-Type": contentTypeFor(file), "Cache-Control": "no-store" })
  res.end(fs.readFileSync(file))
}

/**
 * Starts the local plugin preview server:
 *
 *   /preview/**                React preview UI (marketplace, details editor, AI rightbar)
 *   /api/plugin-api/<slug>/**  the plugin's authenticated `apiRoutes` (handlers run locally)
 *   /api/plugin-public/<slug>/** the plugin's `publicRoutes` + storefront widget/pages
 *   /api/plugins/<slug>/ui/**  the built dashboard UI (sandboxed iframe)
 *   /__dev/**                  dev endpoints (manifest, assets, assistant, jobs,
 *                              hooks, files, snapshots, git, config, search,
 *                              stream (SSE), open-in-editor…)
 *   WS /__dev/terminal         integrated terminal session for this project
 */
export async function startDevServer({ pluginDir, port, host } = {}) {
  const configPath = path.join(pluginDir, "selldoes.config.json")
  const readConfig = () => {
    try {
      return fs.existsSync(configPath) ? readJson(configPath) : {}
    } catch {
      return {}
    }
  }
  const config = readConfig()
  const storeId = Number(config.storeId ?? 1)
  const storeSlug = String(config.storeSlug ?? "dev-store")
  const storeName = String(config.storeName ?? "Dev Store")
  const devDir = path.join(pluginDir, ".selldoes-dev")

  const stream = createStream()
  const logs = []
  const log = (line) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${line}`
    logs.push(entry)
    if (logs.length > 300) logs.shift()
    if (line.startsWith("[esbuild]")) buildStatus.lastError = line
    process.stdout.write(`  ${entry}\n`)
    stream.broadcast("log", { line: entry })
  }

  const buildStatus = { rebuilds: 0, builtAt: new Date().toISOString(), lastError: null, errors: [] }

  const manifestStore = new ManifestStore({ pluginDir, devDir, log })
  const state = new DevState({ file: path.join(devDir, "state.json") })

  const db = new MockDb({ file: path.join(devDir, "db.json") })
  seedDemoTables(db, storeId)

  const runner = new PluginRunner({ pluginDir, manifest: manifestStore.read(), devDir, log })
  const rebuildAll = async () => {
    try {
      runner.manifest = manifestStore.read()
      await runner.build()
      await buildUi()
      buildStatus.rebuilds = runner.rebuilds
      buildStatus.builtAt = new Date().toISOString()
      buildStatus.lastError = null
      buildStatus.errors = []
      log(`rebuilt (bundle${manifestStore.read().ui?.entry ? " + ui" : ""})`)
      stream.broadcast("build", { ...buildStatus })
    } catch (error) {
      buildStatus.lastError = error.message
      buildStatus.errors = String(error.message)
        .split("\n")
        .filter((line) => /:\d+:\d+/.test(line))
        .slice(0, 20)
      if (buildStatus.errors.length === 0) buildStatus.errors = [error.message]
      stream.broadcast("build", { ...buildStatus })
      throw error
    }
  }

  await runner.build()
  log(`bundle built (${runner.bundlePath.replace(pluginDir, ".")})`)
  // The watcher's first pass is the initial build, not a rebuild.
  let initialWatchPass = true
  await runner.watch(() => {
    if (initialWatchPass) {
      initialWatchPass = false
      runner.rebuilds = 0
      buildStatus.rebuilds = 0
      return
    }
    buildStatus.rebuilds = runner.rebuilds
    buildStatus.builtAt = new Date().toISOString()
    buildStatus.lastError = null
    buildStatus.errors = []
    log("bundle rebuilt")
    stream.broadcast("build", { ...buildStatus })
  })

  let uiDir = null
  const buildUi = async () => {
    const manifest = manifestStore.read()
    if (!manifest.ui?.entry) {
      uiDir = null
      return
    }
    const built = await buildPlugin(pluginDir, { outDir: path.join(devDir, "dist") })
    uiDir = path.join(built.outDir, "ui")
  }
  await buildUi()
  if (uiDir) log(`ui built (${uiDir.replace(pluginDir, ".")})`)

  // ctx.config sees selldoes.config.json plus the values saved from the
  // settings form in the preview (so plugin code reads what the form shows).
  const ctxConfig = { ...config, ...state.settings() }
  let settingsKeys = Object.keys(state.settings())
  const applySettings = (values) => {
    for (const key of settingsKeys) delete ctxConfig[key]
    settingsKeys = Object.keys(values ?? {})
    for (const [key, value] of Object.entries(values ?? {})) ctxConfig[key] = value
    state.setSettings(values ?? {})
  }

  const { ctx, outbox, events, jobEvents } = createMockContext({
    pluginDir,
    manifest: manifestStore.read(),
    db,
    storeId,
    config: ctxConfig,
    devDir,
    log,
  })

  const resetJobEvents = () => {
    jobEvents.logs.length = 0
    jobEvents.items.length = 0
    jobEvents.progress.length = 0
  }

  // ── Editor services (files, git, live stream) ─────────────────────────────
  const filesService = createFilesService({
    pluginDir,
    sdkRoot: path.resolve(HERE, "..", "..", ".."),
    snapshots: manifestStore.snapshots,
    rebuild: rebuildAll,
    log,
  })
  const gitService = createGit({ pluginDir })
  const projectWatcher = watchProject(pluginDir, (paths) => stream.broadcast("files", { paths }))

  const bootstrap = () => ({
    manifest: manifestStore.read(),
    validation: manifestStore.validation(),
    store: { id: storeId, slug: storeSlug, name: storeName },
    status: buildStatus,
    activity: { ...state.data, sampleJobs: config.sampleJobs ?? {} },
    assistant: assistantSummary(resolveAssistant({ config: readConfig() })),
    snapshots: manifestStore.snapshotCount(),
  })

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      const pathname = url.pathname

      // ── Preview SPA ─────────────────────────────────────────────────────────
      if (req.method === "GET" && pathname === "/") {
        res.writeHead(302, { Location: "/preview" })
        res.end()
        return
      }
      if (req.method === "GET" && (pathname === "/preview" || pathname.startsWith("/preview/"))) {
        return servePreview(res, pathname)
      }

      // ── Dev endpoints ───────────────────────────────────────────────────────
      if (req.method === "GET" && pathname === "/__dev/bootstrap") {
        return json(res, 200, bootstrap())
      }
      if (req.method === "GET" && pathname === "/__dev/status") {
        return json(res, 200, buildStatus)
      }
      if (req.method === "POST" && pathname === "/__dev/visit") {
        const body = await readBody(req)
        state.visit(body?.page)
        return json(res, 200, { ok: true })
      }

      // ── Manifest (details editor) ──────────────────────────────────────────
      if (req.method === "POST" && pathname === "/__dev/manifest") {
        const body = await readBody(req)
        const next = body?.manifest
        if (!next || typeof next !== "object" || Array.isArray(next)) {
          return json(res, 400, { error: "A manifest object is required" })
        }
        if (String(next.slug) !== String(manifestStore.read().slug)) {
          return json(res, 400, { error: "The slug is permanent and cannot be changed here" })
        }
        const result = manifestStore.write(next)
        log("plugin.json saved from the Details editor")
        stream.broadcast("snapshots", {})
        try {
          await rebuildAll()
        } catch (error) {
          return json(res, 200, { ok: true, ...result, rebuildError: error.message })
        }
        return json(res, 200, { ok: true, ...result })
      }
      if (req.method === "POST" && pathname === "/__dev/manifest/undo") {
        const restored = manifestStore.undo()
        if (!restored) return json(res, 400, { error: "Nothing to undo" })
        stream.broadcast("snapshots", {})
        try {
          await rebuildAll()
        } catch (error) {
          return json(res, 200, { ok: true, manifest: restored, rebuildError: error.message })
        }
        return json(res, 200, { ok: true, manifest: restored })
      }

      // ── Assets (icon + screenshots) ────────────────────────────────────────
      if (req.method === "POST" && pathname === "/__dev/assets") {
        const body = await readBody(req)
        try {
          const saved = saveAsset({ pluginDir, folder: body?.folder, name: body?.name, data: body?.data })
          log(`asset saved (${saved.path})`)
          return json(res, 200, saved)
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/assets/delete") {
        const body = await readBody(req)
        try {
          const result = deleteAsset({ pluginDir, relative: body?.path })
          return json(res, 200, { ok: true, ...result })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }
      if (req.method === "GET" && pathname.startsWith("/__dev/assets/")) {
        const relative = decodeURIComponent(pathname.slice("/__dev/assets/".length))
        const file = resolveAsset(pluginDir, relative)
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return json(res, 404, { error: "Asset not found" })
        }
        res.writeHead(200, { "Content-Type": contentTypeFor(file), "Cache-Control": "no-store" })
        res.end(fs.readFileSync(file))
        return
      }

      // ── Settings (configSchema form in the host-page preview) ──────────────
      if (req.method === "GET" && pathname === "/__dev/settings") {
        const manifest = manifestStore.read()
        return json(res, 200, { configSchema: manifest.configSchema ?? [], settings: state.settings() })
      }
      if (req.method === "POST" && pathname === "/__dev/settings") {
        const body = await readBody(req)
        applySettings(body?.settings ?? {})
        log("settings preview saved (merged into ctx.config)")
        return json(res, 200, { ok: true, settings: state.settings() })
      }

      // ── AI assistant ───────────────────────────────────────────────────────
      if (req.method === "GET" && pathname === "/__dev/assistant") {
        return json(res, 200, assistantSummary(resolveAssistant({ config: readConfig() })))
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
          return json(res, 200, { ok: true, ...result })
        } catch (error) {
          return json(res, error.code === "not-configured" ? 400 : 502, { error: error.message, code: error.code })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/assistant/apply") {
        const body = await readBody(req)
        const edits = normalizeEdits(body?.edits)
        if (!edits) return json(res, 400, { error: "Nothing to apply" })
        const current = manifestStore.read()
        if (edits.manifest && String(edits.manifest.slug) !== String(current.slug)) {
          return json(res, 400, { error: "The assistant tried to change the slug — that is not allowed" })
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
              log(`assistant closed loop: test job ${candidate.type} → ${run.done ? "done" : "tick limit"} (${run.ticks.length} tick(s))`)
            } catch (error) {
              test = { type: candidate.type, error: error.message }
            }
          } else {
            test = { skipped: "no test-like job declared in plugin.json" }
          }
        }

        return json(res, 200, {
          ok: true,
          applied,
          validation,
          ...(rebuildError ? { rebuildError } : {}),
          ...(test ? { test } : {}),
        })
      }

      // ── Provider settings + connection test ───────────────────────────────
      const maskKey = (value) => {
        const key = String(value ?? "")
        if (!key) return null
        if (key.length <= 8) return "•••"
        return `${key.slice(0, 4)}…${key.slice(-4)}`
      }
      const configPayload = () => {
        const fileConfig = readConfig()
        const assistant = fileConfig.assistant ?? {}
        return {
          assistant: {
            provider: assistant.provider ?? null,
            model: assistant.model ?? null,
            baseUrl: assistant.baseUrl ?? null,
            apiKey: maskKey(assistant.apiKey),
            apiKeySet: Boolean(assistant.apiKey),
          },
          env: {
            OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
            ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
            GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
            OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
            DEEPINFRA_API_KEY: Boolean(process.env.DEEPINFRA_API_KEY),
            OLLAMA_HOST: process.env.OLLAMA_HOST ?? null,
          },
        }
      }
      if (pathname === "/__dev/config") {
        if (req.method === "GET") return json(res, 200, configPayload())
        if (req.method === "POST") {
          const body = await readBody(req)
          const assistant = body?.assistant && typeof body.assistant === "object" ? body.assistant : null
          if (!assistant) return json(res, 400, { error: "Missing assistant settings" })
          const fileConfig = readConfig()
          const merged = { ...(fileConfig.assistant ?? {}), ...assistant }
          for (const [key, value] of Object.entries(merged)) {
            if (value === undefined || value === null || value === "") delete merged[key]
          }
          const next = { ...fileConfig, assistant: merged }
          fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`)
          log("assistant settings saved to selldoes.config.json")
          return json(res, 200, { ok: true, ...configPayload() })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/assistant/test") {
        const resolved = resolveAssistant({ config: readConfig() })
        if (!resolved.configured) return json(res, 400, { error: "No provider key configured", code: "not-configured" })
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
          return json(res, 200, { ok: true, provider: resolved.provider, model: resolved.model })
        } catch (error) {
          return json(res, 502, { error: error.message, code: "unreachable" })
        }
      }

      // ── Chat history (persisted per project) ──────────────────────────────
      const historyPath = path.join(devDir, "assistant-chat.json")
      if (req.method === "GET" && pathname === "/__dev/assistant/history") {
        try {
          return json(res, 200, JSON.parse(fs.readFileSync(historyPath, "utf8")))
        } catch {
          return json(res, 200, { items: [] })
        }
      }
      if ((req.method === "PUT" || req.method === "POST") && pathname === "/__dev/assistant/history") {
        const body = await readBody(req)
        const items = Array.isArray(body?.items) ? body.items.slice(-60) : []
        const serialized = JSON.stringify({ items })
        if (serialized.length > 500_000) return json(res, 400, { error: "Chat history is too large" })
        fs.mkdirSync(devDir, { recursive: true })
        fs.writeFileSync(historyPath, serialized)
        return json(res, 200, { ok: true, count: items.length })
      }

      // ── Live stream (files, build, logs, snapshots) ───────────────────────
      if (req.method === "GET" && pathname === "/__dev/stream") {
        return stream.handle(req, res)
      }

      // ── Code editor: files, search, SDK types, snapshots ──────────────────
      if (req.method === "GET" && pathname === "/__dev/files") {
        return json(res, 200, filesService.tree())
      }
      if (req.method === "GET" && pathname === "/__dev/files/read") {
        try {
          return json(res, 200, filesService.read(url.searchParams.get("path") ?? ""))
        } catch (error) {
          return json(res, 404, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/files/write") {
        const body = await readBody(req)
        try {
          const result = await filesService.write(body?.path, body?.content)
          stream.broadcast("snapshots", {})
          return json(res, 200, { ok: true, ...result, validation: manifestStore.validation() })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/files/create") {
        const body = await readBody(req)
        try {
          const result = filesService.create(body?.path, body?.type === "dir" ? "dir" : "file")
          stream.broadcast("snapshots", {})
          stream.broadcast("files", { paths: [result.path] })
          return json(res, 200, { ok: true, ...result })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/files/rename") {
        const body = await readBody(req)
        try {
          const result = filesService.rename(body?.from, body?.to)
          stream.broadcast("snapshots", {})
          stream.broadcast("files", { paths: [result.from, result.to] })
          return json(res, 200, { ok: true, ...result })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/files/delete") {
        const body = await readBody(req)
        try {
          const result = filesService.remove(body?.path)
          stream.broadcast("snapshots", {})
          stream.broadcast("files", { paths: [result.path] })
          return json(res, 200, { ok: true, ...result })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }
      if (req.method === "GET" && pathname === "/__dev/search") {
        try {
          const result = filesService.search(url.searchParams.get("q") ?? "", {
            caseSensitive: url.searchParams.get("case") === "1",
            regex: url.searchParams.get("regex") === "1",
          })
          return json(res, 200, result)
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }
      if (req.method === "GET" && pathname === "/__dev/sdk-types") {
        const types = filesService.sdkTypes()
        if (!types.path) return json(res, 404, { error: "SDK type definitions not found" })
        return json(res, 200, types)
      }
      if (req.method === "GET" && pathname === "/__dev/snapshots") {
        return json(res, 200, { snapshots: filesService.snapshots() })
      }
      if (req.method === "POST" && pathname === "/__dev/snapshots/restore") {
        const body = await readBody(req)
        try {
          const meta = filesService.restoreSnapshot(body?.name)
          await rebuildAll().catch(() => {})
          stream.broadcast("snapshots", {})
          stream.broadcast("files", { paths: (meta?.files ?? []).map((file) => file.path) })
          return json(res, 200, { ok: true, meta, validation: manifestStore.validation() })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }

      // ── Git ────────────────────────────────────────────────────────────────
      if (pathname.startsWith("/__dev/git/")) {
        const action = pathname.slice("/__dev/git/".length)
        try {
          if (req.method === "GET" && action === "status") return json(res, 200, await gitService.status())
          if (req.method === "GET" && action === "show") {
            return json(res, 200, await gitService.show(url.searchParams.get("path"), url.searchParams.get("rev") ?? "HEAD"))
          }
          if (req.method === "GET" && action === "diff") {
            return json(res, 200, await gitService.diff(url.searchParams.get("path"), url.searchParams.get("staged") === "1"))
          }
          if (req.method === "GET" && action === "log") return json(res, 200, await gitService.log())
          if (req.method === "POST" && action === "stage") {
            const body = await readBody(req)
            return json(res, 200, await gitService.stage(body?.paths))
          }
          if (req.method === "POST" && action === "unstage") {
            const body = await readBody(req)
            return json(res, 200, await gitService.unstage(body?.paths))
          }
          if (req.method === "POST" && action === "commit") {
            const body = await readBody(req)
            return json(res, 200, await gitService.commit(body?.message, body?.paths))
          }
          if (req.method === "POST" && action === "init") {
            return json(res, 200, await gitService.init())
          }
          return json(res, 404, { error: `Unknown git route: ${action}` })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }

      // ── Open in external editor / OS terminal ─────────────────────────────
      if (req.method === "POST" && pathname === "/__dev/open") {
        const body = await readBody(req)
        try {
          const result = body?.terminal
            ? await openTerminal({ dir: pluginDir })
            : await openInEditor({
                dir: pluginDir,
                file: body?.file,
                line: body?.line,
                column: body?.column,
                editor: body?.editor,
              })
          return json(res, 200, result)
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }

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
        return json(res, 200, { tables })
      }
      if (req.method === "POST" && pathname === "/__dev/reset-data") {
        db.reset()
        seedDemoTables(db, storeId)
        log("mock data reset")
        return json(res, 200, { ok: true })
      }
      if (req.method === "POST" && pathname === "/__dev/rebuild") {
        try {
          await rebuildAll()
          return json(res, 200, { ok: true, rebuilds: runner.rebuilds })
        } catch (error) {
          return json(res, 500, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/run-job") {
        const body = await readBody(req)
        try {
          resetJobEvents()
          const maxTicks = Math.max(1, Math.min(Number(body?.maxTicks) || 50, 500))
          const run = await runner.runJob(body?.type, body?.input ?? {}, ctx, maxTicks)
          state.record("jobs", { type: body?.type })
          log(`job ${body?.type} ran ${run.ticks.length} tick(s)${run.done ? " — done" : " — tick limit reached"}`)
          const stateJson = run.state === undefined || run.state === null ? "" : JSON.stringify(run.state)
          return json(res, 200, {
            ok: true,
            run: {
              kind: run.kind,
              ticks: run.ticks.length,
              done: run.done,
              result: run.result ?? null,
              state: stateJson && stateJson.length <= 20000 ? run.state : undefined,
            },
            telemetry: {
              progress: jobEvents.progress.slice(),
              items: jobEvents.items.slice(),
              logs: jobEvents.logs.slice(),
            },
          })
        } catch (error) {
          return json(res, 500, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/run-hook") {
        const body = await readBody(req)
        try {
          const result = await runner.runHook(body?.hook, body?.payload ?? {}, ctx)
          state.record("hooks", { hook: body?.hook })
          log(`hook ${body?.hook} fired`)
          return json(res, 200, { ok: true, result: result ?? null })
        } catch (error) {
          return json(res, 500, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/delivery") {
        const body = await readBody(req)
        try {
          const result = await runner.runDelivery(body?.order ?? config.sampleOrder ?? { id: 1001, order_number: "1001", items: [] }, ctx)
          return json(res, 200, { ok: true, result: result ?? null })
        } catch (error) {
          return json(res, 500, { error: error.message })
        }
      }
      if (req.method === "GET" && pathname === "/__dev/outbox") return json(res, 200, { outbox })
      if (req.method === "GET" && pathname === "/__dev/events") return json(res, 200, { events })
      if (req.method === "GET" && pathname === "/__dev/logs") return json(res, 200, { logs: logs.slice(-80), rebuilds: runner.rebuilds })
      if (req.method === "GET" && pathname.startsWith("/__dev/files/")) {
        const key = decodeURIComponent(pathname.slice("/__dev/files/".length))
        const file = path.resolve(path.join(devDir, "files"), key)
        const root = path.resolve(path.join(devDir, "files"))
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return json(res, 404, { error: "File not found" })
        }
        res.writeHead(200, { "Content-Type": contentTypeFor(file), "Cache-Control": "no-store" })
        res.end(fs.readFileSync(file))
        return
      }

      // ── Plugin UI assets (dashboard + public) ──────────────────────────────
      const uiMatch = /^\/api\/(?:plugins|plugin-public)\/([^/]+)\/ui\/(.*)$/.exec(pathname)
      if (req.method === "GET" && uiMatch) {
        const [, slug, ...rest] = uiMatch
        const manifest = manifestStore.read()
        if (slug !== manifest.slug) return json(res, 404, { error: `Only "${manifest.slug}" runs in this dev server` })
        if (!uiDir) return json(res, 404, { error: "This plugin declares no ui.entry" })
        const root = path.resolve(uiDir)
        const file = path.resolve(root, rest.join("/"))
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return json(res, 404, { error: `Asset "${rest.join("/")}" not found` })
        }
        res.writeHead(200, {
          "Content-Type": contentTypeFor(file),
          "Content-Security-Policy": UI_CSP,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        res.end(fs.readFileSync(file))
        return
      }

      // ── Plugin API routes ───────────────────────────────────────────────────
      const apiMatch = /^\/api\/(plugin-api|plugin-public)\/([^/]+)(\/.*)?$/.exec(pathname)
      if (apiMatch) {
        const manifest = manifestStore.read()
        const kind = apiMatch[1] === "plugin-public" ? "public" : "authenticated"
        const [, , slug, tail] = apiMatch
        if (slug !== manifest.slug) return json(res, 404, { error: `Only "${manifest.slug}" runs in this dev server` })
        const requestPath = cleanPath(tail ?? "/")
        const declaredList = kind === "public" ? manifest.publicRoutes ?? [] : manifest.apiRoutes ?? []
        const match = declaredList.find((route) => {
          const declared = cleanPath(route.path)
          return requestPath === declared || requestPath.startsWith(`${declared}/`)
        })
        if (!match) return json(res, 404, { error: `No ${kind} route "${requestPath}" declared in plugin.json` })
        const methods = (match.methods ?? ["GET"]).map((method) => method.toUpperCase())
        if (!methods.includes(req.method)) {
          return json(res, 405, { error: `Method ${req.method} not allowed for ${match.path}` })
        }
        const body = req.method === "GET" || req.method === "HEAD" ? null : await readBody(req)
        const query = Object.fromEntries(url.searchParams.entries())
        try {
          const started = Date.now()
          const result = await runner.invokeRoute(match.path, { method: req.method, path: requestPath, query, body }, ctx)
          state.record("routes", { path: requestPath })
          log(`${req.method} ${requestPath} → ${Date.now() - started}ms`)
          if (result && typeof result === "object" && "status" in result && "body" in result) {
            return json(res, Number(result.status) || 200, result.body)
          }
          return json(res, 200, result ?? null)
        } catch (error) {
          log(`${req.method} ${requestPath} → error: ${error.message}`)
          return json(res, 500, { error: error.message })
        }
      }

      return json(res, 404, { error: `Not found: ${pathname}` })
    } catch (error) {
      return json(res, 500, { error: error.message })
    }
  })

  const listenPort = Number(port ?? config.port ?? 4590)
  const listenHost = String(host ?? "127.0.0.1")

  const terminals = attachTerminalServer({
    server,
    path: "/__dev/terminal",
    resolveCwd: () => pluginDir,
    log,
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(listenPort, listenHost, resolve)
  })

  const url = `http://${listenHost === "0.0.0.0" ? "localhost" : listenHost}:${listenPort}/preview`

  const shutdown = async () => {
    await runner.stopWatching()
    projectWatcher.close()
    terminals.closeAll()
    stream.closeAll()
    db.saveNow()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)

  return { url, port: listenPort, host: listenHost, close: shutdown, runner }
}
