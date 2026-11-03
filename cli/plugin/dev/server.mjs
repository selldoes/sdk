import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { html, isLoopbackRequest, json, normalizeDevHost } from "../../http.mjs"
import { reclaimPort } from "../../port.mjs"
import { attachTerminalServer } from "../../terminal.mjs"
import { contentTypeFor, readJson } from "../../util.mjs"
import { projectIdFor } from "../../workspace.mjs"
import { buildPlugin, collectUiEntries } from "../build.mjs"
import { describeSchedules } from "../schedule.mjs"
import { assistantChat, assistantSummary, normalizeEdits, resolveAssistant } from "./assistant.mjs"
import { DevState } from "./dev-state.mjs"
import { createFilesService } from "./files.mjs"
import { createGit } from "./git.mjs"
import {
  createLiveAiBridge,
  createLiveModelsBridge,
  createLiveProductsBridge,
  createLivePromptsBridge,
  findLocalPlatformDir,
  LOCAL_PLATFORM_URL,
  readStoreBlock,
  resolveLiveAppUrl,
} from "./live-store.mjs"
import { ManifestStore } from "./manifest-store.mjs"
import { createMockContext } from "./mock-context.mjs"
import { MockDb, seedDemoTables } from "./mock-db.mjs"
import { createAssistantRoutes } from "./routes/assistant.mjs"
import { createConfigRoutes } from "./routes/config.mjs"
import { createFileRoutes } from "./routes/files.mjs"
import { createJobRoutes } from "./routes/jobs.mjs"
import { createManifestRoutes } from "./routes/manifest.mjs"
import { createPackagesRoutes } from "./routes/packages.mjs"
import { createPlatformRoutes } from "./routes/platform.mjs"
import { createStoreRoutes } from "./routes/store.mjs"
import { createUiRoutes } from "./routes/ui.mjs"
import { PluginRunner } from "./runner.mjs"
import { createStream, watchProject } from "./stream.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI_DIR = path.join(HERE, "ui-dist")

/**
 * True when the manifest declares any UI: an HTML entry (dashboard pages, the
 * designed settings dialog, storefront widget/pages) or kit-authored sections
 * whose entry the kit compiler only writes during a build.
 */
function manifestHasUi(manifest) {
  return (
    collectUiEntries(manifest).length > 0 ||
    (manifest.settingsDialog?.sections ?? []).length > 0 ||
    (manifest.dashboardPages ?? []).some((page) => (page?.sections ?? []).length > 0)
  )
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
  // URLs are /<projectId>/<page> — the project's internal id. Assets
  // (/assets/…) resolve against ui-dist by full pathname; anything else
  // falls back to the SPA shell.
  let relative = decodeURIComponent(pathname.replace(/^\//, ""))
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
 *   /<projectId>/**           React preview UI (marketplace, details editor,
 *                             AI rightbar) — the project's internal id is the
 *                             first URL segment, like a Next.js store id
 *   /api/plugin-api/<slug>/**  the plugin's authenticated `apiRoutes` (handlers run locally)
 *   /api/plugin-public/<slug>/** the plugin's `publicRoutes` + storefront widget/pages
 *   /api/plugins/<slug>/ui/**  the built dashboard UI (sandboxed iframe)
 *   /__dev/**                  dev endpoints (manifest, assets, assistant, jobs,
 *                              hooks, files, snapshots, git, config, search,
 *                              stream (SSE), open-in-editor…)
 *   WS /__dev/terminal         integrated terminal session for this project
 */
export async function startDevServer({ pluginDir, port, host, exitOnClose = true } = {}) {
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

  const logs = []
  const buildStatus = { rebuilds: 0, builtAt: new Date().toISOString(), lastError: null, errors: [] }
  // Fresh SSE clients (a page reconnecting after an SDK restart) replay the
  // build status, which triggers the preview iframe to reload itself.
  const stream = createStream({ bootstrap: () => [{ event: "build", data: buildStatus }] })
  const log = (line) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${line}`
    logs.push(entry)
    if (logs.length > 300) logs.shift()
    if (line.startsWith("[esbuild]")) buildStatus.lastError = line
    process.stdout.write(`  ${entry}\n`)
    stream.broadcast("log", { line: entry })
  }

  const manifestStore = new ManifestStore({ pluginDir, devDir, log })
  const state = new DevState({ file: path.join(devDir, "state.json") })

  /**
   * Refreshes the workspace registry after a version bump so the shell's
   * "update available" comparisons use the new local version immediately.
   * Best-effort — standalone projects may not be registered yet.
   */
  const touchWorkspace = async () => {
    try {
      const { touchProject } = await import("../../workspace.mjs")
      touchProject({ dir: pluginDir, kind: "plugin" })
    } catch {
      // registry is best-effort
    }
  }

  const db = new MockDb({ file: path.join(devDir, "db.json") })
  seedDemoTables(db, storeId)

  const runner = new PluginRunner({ pluginDir, manifest: manifestStore.read(), devDir, log })
  /** When the last rebuild finished — the disk watcher suppresses its own echoes. */
  let lastRebuildAt = 0
  const rebuildAll = async () => {
    try {
      runner.manifest = manifestStore.read()
      await runner.build()
      await buildUi()
      buildStatus.rebuilds = runner.rebuilds
      buildStatus.builtAt = new Date().toISOString()
      buildStatus.lastError = null
      buildStatus.errors = []
      lastRebuildAt = Date.now()
      log(`rebuilt (bundle${manifestHasUi(manifestStore.read()) ? " + ui" : ""})`)
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
    if (!manifestHasUi(manifest)) {
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
  // The manifest's configSchema defaults are applied like the platform does
  // (resolveConfig): a missing or empty setting falls back to the default.
  const applySchemaDefaults = (values) => {
    const manifest = manifestStore.read()
    const out = { ...(values ?? {}) }
    for (const field of manifest.configSchema ?? []) {
      if (field.default === undefined) continue
      const current = out[field.key]
      if (current === undefined || current === null || current === "") out[field.key] = field.default
    }
    return out
  }
  const ctxConfig = applySchemaDefaults({ ...config, ...state.settings() })
  const applySettings = (values) => {
    const store = ctxConfig.store
    const merged = applySchemaDefaults({ ...config, ...(values ?? {}) })
    if (store) merged.store = store
    for (const key of Object.keys(ctxConfig)) delete ctxConfig[key]
    Object.assign(ctxConfig, merged)
    state.setSettings(values ?? {})
  }

  /**
   * Live store connection (Project settings → Store). When connected,
   * ctx.products proxies to the real store through the merchant API — see
   * cli/plugin/dev/live-store.mjs. The bridge object is swapped in place so
   * connect/disconnect applies to running jobs immediately.
   */
  const liveStore = { bridge: null, prompts: null, ai: null, models: null, connection: null }
  const applyLiveStore = () => {
    const block = readStoreBlock(readConfig())
    // A local Selldesk checkout (selldesk.net/next on :9582) wins over the
    // hosted URL — see resolveLiveAppUrl. SELLDOES_APP_URL always overrides.
    const appUrl = resolveLiveAppUrl(block.appUrl)
    if (block.live && appUrl && block.apiKey && block.storeId) {
      liveStore.connection = {
        appUrl,
        apiKey: block.apiKey,
        storeId: block.storeId,
        storeSlug: block.storeSlug,
      }
      liveStore.bridge = createLiveProductsBridge(liveStore.connection, log)
      liveStore.prompts = createLivePromptsBridge(liveStore.connection, log)
      liveStore.models = createLiveModelsBridge(liveStore.connection, log)
      liveStore.ai = createLiveAiBridge(liveStore.connection, log)
      log(`live store connected — ctx.products + ctx.ai → ${appUrl} (store ${block.storeSlug || block.storeId})`)
      const localDir = findLocalPlatformDir()
      if (appUrl === LOCAL_PLATFORM_URL && localDir) {
        log(
          `local Selldesk platform detected at ${localDir} — using ${LOCAL_PLATFORM_URL} instead of ${block.appUrl || "the hosted platform"} (set SELLDOES_LOCAL_PLATFORM=off to disable)`,
        )
      }
      return true
    }
    if (liveStore.bridge) log("live store disconnected — ctx.products back on the local mock")
    liveStore.bridge = null
    liveStore.prompts = null
    liveStore.models = null
    liveStore.ai = null
    liveStore.connection = null
    return false
  }
  applyLiveStore()

  /**
   * Target Selldoes instance for the live-store bridge. Explicit input wins,
   * then the project's saved block — otherwise reuse whatever instance the
   * developer account is logged into (~/.selldoes.json via developerAuth,
   * which itself falls back to SELLDOES_APP_URL / https://selldoes.com).
   * So a merchant API key alone is enough: no URL to type.
   */
  const resolveAppUrl = async (explicit) => {
    const clean = (value) => String(value ?? "").replace(/\/+$/, "") || null
    const target = clean(explicit) || clean(readStoreBlock(readConfig()).appUrl)
    if (target) return target
    try {
      const account = await import("../../account.mjs")
      return account.developerAuth().appUrl
    } catch {
      return "https://selldoes.com"
    }
  }

  // The port/host the preview listens on — resolved before the mock context
  // so media URLs can be absolute (like production).
  const listenPort = Number(port ?? config.port ?? 4590)
  const listenHost = normalizeDevHost(host ?? config.host, { fallback: "127.0.0.1", log })

  const { ctx, outbox, events, jobEvents, pendingJobs } = createMockContext({
    pluginDir,
    manifest: manifestStore.read(),
    // Permissions/allowedTables are re-read on every capability check, so
    // editing plugin.json applies without restarting the dev server.
    getManifest: () => manifestStore.read(),
    db,
    storeId,
    config: ctxConfig,
    devDir,
    log,
    // The preview's own origin — media URLs are absolute, like in production.
    baseUrl: () => `http://${listenHost === "0.0.0.0" ? "localhost" : listenHost}:${listenPort}`,
    // Live store bridge — mutated by /__dev/store connect/disconnect, so
    // switching between the mock and a real store needs no restart.
    liveStore,
  })

  const resetJobEvents = () => {
    jobEvents.logs.length = 0
    jobEvents.items.length = 0
    jobEvents.progress.length = 0
  }

  /**
   * Platform-shaped job rows for the compiled kit runtime. The dev runner runs
   * a job to completion (bounded ticks, queued jobs drained) in one call, so
   * the preview's Run buttons behave like the host: start → progress → done.
   *
   * When a run exhausts its tick budget it is parked as "paused" WITH its
   * checkpointed state, and the kit runtime's `POST /jobs/:id/tick` continues
   * it from where it stopped — mirroring how the platform resumes paused jobs
   * instead of spinning on a row that never advances.
   */
  const mockJobs = []
  let mockJobCursor = 0
  /** Steps one paused job continues per /tick call (bounded further by the wall-clock budget). */
  const TICK_STEPS_PER_CALL = 20
  /** Wall-clock budget per /tick continuation call (initial POSTs use the job's tickBudgetMs). */
  const TICK_BUDGET_MS = 10_000
  const MAX_TICK_BUDGET_MS = 60_000

  const drainChainedJobs = async (ticks) => {
    let chained = 0
    while (pendingJobs.length > 0 && chained < 10) {
      const next = pendingJobs.shift()
      await runner.runJob(next.type, next.input ?? {}, ctx, ticks)
      chained += 1
    }
    return chained
  }

  // The platform's worker picks up enqueued jobs on its own. The dev server
  // does the same on a timer, so a plugin that enqueues work from a route
  // (an image job, a chained import) sees it run — and its UI can wait for
  // the result instead of hanging.
  const chainedTimer = setInterval(() => {
    if (pendingJobs.length === 0) return
    void drainChainedJobs(5).catch(() => {})
  }, 2000)
  if (typeof chainedTimer.unref === "function") chainedTimer.unref()

  const runMockJob = async ({ type, input, maxTicks = 200, budgetMs = 0, resumeRow = null }) => {
    const manifest = manifestStore.read()
    const declared = (manifest.jobs ?? []).find((job) => job.type === type)
    if (!declared) throw new Error(`Job "${type}" is not declared in plugin.json "jobs"`)
    if (!resumeRow) resetJobEvents()
    state.record("jobs", { type })
    const row = resumeRow ?? {
      id: ++mockJobCursor,
      type,
      status: "running",
      total: 0,
      processed: 0,
      failed: 0,
      skipped: 0,
      progress: null,
      error: null,
      runtime: declared.runtime ?? "quickjs",
      createdAt: new Date().toISOString(),
    }
    row.status = "running"
    row.error = null
    if (!resumeRow) mockJobs.push(row)
    try {
      const ticks = Math.max(1, Math.min(Number(maxTicks) || 200, 500))
      // Bound each invocation's wall clock like the platform's tickBudgetMs:
      // the run pauses at the deadline and the next /tick continues it.
      const declaredBudget = Number(declared.tickBudgetMs) || 30_000
      const budget = Math.max(0, Math.min(Number(budgetMs) || declaredBudget, MAX_TICK_BUDGET_MS))
      const deadline = Date.now() + budget
      const resume = resumeRow?.checkpoint ? { state: resumeRow.checkpoint.state } : null
      const run = await runner.runJob(type, input ?? {}, ctx, ticks, resume, deadline)
      await drainChainedJobs(ticks)
      const last = jobEvents.progress.length > 0 ? jobEvents.progress[jobEvents.progress.length - 1] : {}
      row.status = run.done ? "completed" : "paused"
      row.processed = Number(last.processed) || row.processed
      row.total = Number(last.total) || row.total
      row.failed = Number(last.failed) || row.failed
      row.skipped = Number(last.skipped) || row.skipped
      row.progress = last.message ? { message: last.message } : row.progress
      row.result = run.result ?? row.result ?? null
      // Keep the checkpoint so a later /tick continues this exact run.
      row.checkpoint = run.done ? undefined : { input: input ?? {}, state: run.state }
      if (run.kind === "node") row.runtime = "node"
      log(`job ${type} ${resumeRow ? "resumed" : "ran"}${run.done ? " — done" : " — tick limit reached (paused)"}`)
    } catch (error) {
      row.status = "failed"
      row.error = String(error?.message ?? error)
      row.checkpoint = undefined
    }
    row.items = jobEvents.items.slice()
    row.logs = jobEvents.logs.slice()
    row.completedAt = new Date().toISOString()
    return row
  }

  /**
   * Continues a paused job when the kit runtime POSTs /jobs/:id/tick. Unknown,
   * finished or checkpoint-less jobs are returned unchanged (a no-op tick),
   * which is what the platform does for rows it no longer owns.
   */
  const tickMockJob = async (row) => {
    if (row?.status !== "paused" || !row.checkpoint) return row
    return runMockJob({
      type: row.type,
      input: row.checkpoint.input ?? {},
      maxTicks: TICK_STEPS_PER_CALL,
      budgetMs: TICK_BUDGET_MS,
      resumeRow: row,
    })
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

  /**
   * External edits (VS Code, the AI, another tool) apply like Code-page saves:
   * `plugin.json` and `ui/**` changes rebuild the manifest, kit pages and UI
   * bundle. Runtime entries (index.js, jobs, hooks) stay with esbuild's own
   * watcher — no double builds. A short quiet window skips the echo of the
   * dev server's own writes (Code page, scaffolds, AI apply — those already
   * rebuilt) and kit files `syncKitPages` regenerates during a build.
   */
  const AUTO_REBUILD_RE = /^(?:plugin\.json$|ui\/)/
  const AUTO_REBUILD_QUIET_MS = 1200
  const pendingRebuildPaths = new Set()
  let autoRebuildTimer = null
  const scheduleRebuild = (paths) => {
    for (const raw of paths) {
      const file = String(raw).replace(/\\/g, "/")
      if (AUTO_REBUILD_RE.test(file)) pendingRebuildPaths.add(file)
    }
    if (pendingRebuildPaths.size === 0) return
    if (autoRebuildTimer) clearTimeout(autoRebuildTimer)
    autoRebuildTimer = setTimeout(async () => {
      autoRebuildTimer = null
      const batch = [...pendingRebuildPaths]
      pendingRebuildPaths.clear()
      if (Date.now() - lastRebuildAt < AUTO_REBUILD_QUIET_MS) return
      try {
        const shown = batch.slice(0, 3).join(", ")
        log(`rebuilt from disk changes (${shown}${batch.length > 3 ? `, +${batch.length - 3} more` : ""})`)
        await rebuildAll()
      } catch (error) {
        // rebuildAll already surfaced the error on the build status stream
        log(`rebuild failed: ${error.message}`)
      }
    }, 300)
  }

  const projectWatcher = watchProject(pluginDir, (paths) => {
    stream.broadcast("files", { paths })
    scheduleRebuild(paths)
  })

  const bootstrap = () => ({
    manifest: manifestStore.read(),
    validation: manifestStore.validation(),
    store: { id: storeId, slug: storeSlug, name: storeName },
    status: buildStatus,
    activity: { ...state.data, sampleJobs: config.sampleJobs ?? {} },
    assistant: assistantSummary(resolveAssistant({ config: readConfig() })),
    schedules: describeSchedules(manifestStore.read()),
    snapshots: manifestStore.snapshotCount(),
  })

  /**
   * Developer-account state for the Ship page in standalone `selldoes dev`
   * (the workspace shell reads the same credentials through `/__ws/*`).
   * Never throws — an offline platform reports `unreachable` instead.
   */
  const accountInfo = async () => {
    const account = await import("../../account.mjs")
    const auth = account.developerAuth({}, account.loadConfig())
    if (!auth.token) return { connected: false, appUrl: auth.appUrl }
    try {
      const me = await fetch(`${auth.appUrl}/api/developers/me`, {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(8000),
      }).then((response) => response.json())
      return {
        connected: true,
        appUrl: auth.appUrl,
        email: me?.account?.email,
        name: me?.account?.name,
        status: me?.account?.status,
      }
    } catch {
      return { connected: true, appUrl: auth.appUrl, unreachable: true }
    }
  }

  // The project's internal id — the first URL segment (/{id}/settings),
  // YouTube-style: 11 random base64url chars, stable per registered folder.
  const projectId = projectIdFor(pluginDir)

  const configRoutes = createConfigRoutes({ readConfig, configPath, log, liveStore })

  const fileRoutes = createFileRoutes({ filesService, gitService, manifestStore, stream, rebuildAll })

  const storeRoutes = createStoreRoutes({
    pluginDir,
    readConfig,
    accountInfo,
    liveStore,
    ctxConfig,
    applyLiveStore,
    resolveAppUrl,
  })

  const jobRoutes = createJobRoutes({
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
  })

  const uiRoutes = createUiRoutes({
    pluginDir,
    getUiDir: () => uiDir,
    manifestStore,
    state,
    log,
    stream,
    rebuildAll,
    applySettings,
  })

  const manifestRoutes = createManifestRoutes({
    pluginDir,
    devDir,
    bootstrap,
    buildStatus,
    state,
    manifestStore,
    log,
    stream,
    rebuildAll,
    touchWorkspace,
  })

  const platformRoutes = createPlatformRoutes({
    projectId,
    devDir,
    manifestStore,
    state,
    applySettings,
    log,
    mockJobs,
    runMockJob,
    tickMockJob,
    runner,
    ctx,
    getUiDir: () => uiDir,
  })

  const packagesRoutes = createPackagesRoutes({ pluginDir, manifestStore, runner, log, stream, rebuildAll })

  const assistantRoutes = createAssistantRoutes({
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
  })

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      const pathname = url.pathname

      // DNS-rebinding guard: a loopback bind alone does not stop a malicious
      // page from resolving its own hostname to 127.0.0.1. Reject anything not
      // addressed to a loopback name.
      if (!isLoopbackRequest(req)) {
        return json(res, 403, { error: "The Selldoes dev server only accepts requests addressed to localhost" })
      }

      // ── Preview SPA ─────────────────────────────────────────────────────────
      // URLs are /<projectId>/<page> — anything that isn't a dev endpoint
      // serves the SPA (assets fall through to ui-dist).
      if (req.method === "GET" && !pathname.startsWith("/__dev") && !pathname.startsWith("/api")) {
        if (pathname === "/") {
          res.writeHead(302, { Location: `/${projectId}` })
          res.end()
          return
        }
        return servePreview(res, pathname)
      }

      if (await manifestRoutes(req, res, url)) return

      if (await storeRoutes(req, res, url)) return

      if (await uiRoutes(req, res, url)) return

      if (await packagesRoutes(req, res, url)) return

      if (await jobRoutes(req, res, url)) return

      if (await configRoutes(req, res, url)) return
      if (await assistantRoutes(req, res, url)) return
      if (await fileRoutes(req, res, url)) return

      // ── Live stream (files, build, logs, snapshots) ───────────────────────
      if (req.method === "GET" && pathname === "/__dev/stream") {
        return stream.handle(req, res)
      }

      if (await platformRoutes(req, res, url)) return
    } catch (error) {
      return json(res, 500, { error: error.message })
    }
  })

  const terminals = attachTerminalServer({
    server,
    path: "/__dev/terminal",
    resolveCwd: () => pluginDir,
    log,
  })

  // A hard Ctrl+C (or a supervisor restart) can leave the previous process
  // holding the port for a moment — stop a stale Selldoes process instead of
  // crash-looping the supervisor on EADDRINUSE. Another app on the port still
  // fails with a clear message.
  await reclaimPort(listenPort, listenHost, log)

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(listenPort, listenHost, resolve)
  })

  const url = `http://${listenHost === "0.0.0.0" ? "localhost" : listenHost}:${listenPort}/${projectId}`

  const shutdown = async () => {
    await runner.stopWatching()
    projectWatcher.close()
    terminals.closeAll()
    stream.closeAll()
    if (chainedTimer) clearInterval(chainedTimer)
    db.saveNow()
    if (!exitOnClose) {
      await new Promise((resolve) => server.close(resolve))
      return
    }
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  }
  if (exitOnClose) {
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
  }

  return { url, port: listenPort, host: listenHost, close: shutdown, runner }
}
