import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { contentTypeFor, readJson } from "../../util.mjs"
import { sendNotFound } from "../../not-found-page.mjs"
import { openInEditor, openTerminal } from "../../open-editor.mjs"
import { buildPlugin } from "../build.mjs"
import { MockDb, seedDemoTables } from "./mock-db.mjs"
import { createMockContext } from "./mock-context.mjs"
import { PluginRunner, cleanPath } from "./runner.mjs"
import { ManifestStore } from "./manifest-store.mjs"
import { DevState } from "./dev-state.mjs"
import { deleteAsset, resolveAsset, saveAsset } from "./assets.mjs"
import { applyNotesPlan, detectUiFlavor, planNotesUi, resolveUiAsset, uiFallbackHtml } from "./ui-scaffold.mjs"
import { applyCodePlan, planCodeScaffold } from "./code-scaffold.mjs"
import { assistantChat, assistantSummary, normalizeEdits, resolveAssistant } from "./assistant.mjs"
import { createFilesService } from "./files.mjs"
import { createGit } from "./git.mjs"
import { createStream, watchProject } from "./stream.mjs"
import { attachTerminalServer } from "../../terminal.mjs"
import { addDependency, detectPackageManager, installedVersion, removeDependency } from "../dependencies.mjs"
import { describeSchedules } from "../schedule.mjs"
import { probeNodePackage, probePackage } from "../sandbox.mjs"
import { BUMP_MODES, bumpVersion, isValidVersion } from "../version.mjs"
import { projectIdFor } from "../../workspace.mjs"
import { applyUserSettingsPatch, userSettingsView } from "../../user-settings.mjs"

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
  /** Package compatibility probes, keyed by `name@version`. */
  const packageProbeCache = new Map()
  /**
   * Serializes package mutations (add/remove/check). Concurrent clicks used to
   * interleave npm installs and plugin.json/package.json writes, corrupting
   * the manifest and double-rebuilding; now each mutation runs to completion
   * before the next starts.
   */
  let packageMutationChain = Promise.resolve()
  const withPackageMutationLock = (fn) => {
    const run = packageMutationChain.then(fn, fn)
    packageMutationChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
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
    const wantsUi = Boolean(manifest.ui?.entry) || (manifest.dashboardPages ?? []).some((page) => page?.entry)
    if (!wantsUi) {
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
      const me = await fetch(auth.appUrl + "/api/developers/me", {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(8000),
      }).then((response) => response.json())
      return { connected: true, appUrl: auth.appUrl, email: me?.account?.email, name: me?.account?.name, status: me?.account?.status }
    } catch {
      return { connected: true, appUrl: auth.appUrl, unreachable: true }
    }
  }

  /**
   * Packages page payload: declared dependencies, their runtime rating and the
   * packages the current bundle actually imports. QuickJS-imported packages run
   * the sandbox probe; everything else in a plugin with Node jobs is rated
   * against real Node, so `playwright`/`sharp` are not mislabelled.
   */
  const packagesPayload = async ({ refresh = false } = {}) => {
    const manifest = manifestStore.read()
    const dependencies = manifest.dependencies ?? {}
    const sandbox = runner.sandbox ?? { ok: true, errors: [], warnings: [], packages: [], imported: [], missingDependencies: [], sizeKb: 0 }
    const bundled = new Set(sandbox.packages ?? [])
    const importedByQuickJs = new Set(sandbox.imported ?? [])
    const nodePackages = runner.nodePackages ?? new Set()
    const hasNodeJobs = runner.hasNodeJobs()
    const declaredNames = Object.keys(dependencies)
    const missing = (sandbox.missingDependencies ?? []).filter((name) => !declaredNames.includes(name))

    const rate = async (name) => {
      const installed = installedVersion(pluginDir, name)
      // The QuickJS gate is the stricter one: if the sandboxed bundle imports
      // the package it must survive the sandbox. Otherwise a plugin with Node
      // jobs gets the Node rating.
      const usedByQuickJs = bundled.has(name) || importedByQuickJs.has(name)
      const runtime = usedByQuickJs ? "quickjs" : hasNodeJobs || nodePackages.has(name) ? "node" : "quickjs"
      const base = { name, declared: true, range: dependencies[name], installed, bundled: bundled.has(name), runtime }
      if (!installed) {
        return { ...base, status: "blocked", message: "not installed locally — add it again to install it" }
      }
      const key = `${runtime}:${name}@${installed}`
      if (refresh) packageProbeCache.delete(key)
      if (!packageProbeCache.has(key)) {
        const probe = runtime === "node" ? probeNodePackage({ pluginDir, name }) : probePackage({ pluginDir, name })
        packageProbeCache.set(key, probe.catch((error) => ({ status: "blocked", message: error.message, sizeKb: null })))
      }
      const probe = await packageProbeCache.get(key)
      return { ...base, status: probe.status, message: probe.message, sizeKb: probe.sizeKb ?? null }
    }

    const packages = await Promise.all(declaredNames.map(rate))
    return {
      manager: detectPackageManager(pluginDir),
      dependencies,
      packages,
      missing,
      sandbox: { ok: sandbox.ok, errors: sandbox.errors, warnings: sandbox.warnings, sizeKb: sandbox.sizeKb },
    }
  }

  // The project's internal id — the first URL segment (/{id}/settings),
  // YouTube-style: 11 random base64url chars, stable per registered folder.
  const projectId = projectIdFor(pluginDir)

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      const pathname = url.pathname

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
      if (req.method === "POST" && pathname === "/__dev/undo/clear") {
        const undoRoot = path.join(devDir, "undo")
        let cleared = 0
        try {
          if (fs.existsSync(undoRoot)) {
            cleared = fs.readdirSync(undoRoot).length
            fs.rmSync(undoRoot, { recursive: true, force: true })
          }
        } catch (error) {
          return json(res, 500, { error: `Could not clear the undo history: ${error.message}` })
        }
        log(`undo history cleared (${cleared} snapshot(s))`)
        return json(res, 200, { ok: true, cleared })
      }

      // ── Version bump (Ship page, `selldoes version`) ───────────────────────
      if (req.method === "POST" && pathname === "/__dev/version") {
        const body = await readBody(req)
        const current = manifestStore.read()
        const explicit = typeof body?.version === "string" && body.version.trim() ? body.version.trim() : null
        let next
        try {
          if (explicit) {
            if (!isValidVersion(explicit)) throw new Error(`"${explicit}" is not a valid x.y.z version`)
            next = explicit
          } else {
            next = bumpVersion(current.version, String(body?.mode ?? "patch"))
          }
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
        if (next === current.version) {
          return json(res, 200, { ok: true, unchanged: true, previous: current.version, version: next, manifest: current, validation: manifestStore.validation() })
        }
        const written = manifestStore.write({ ...current, version: next })
        log(`version bumped ${current.version} → ${next}`)
        stream.broadcast("snapshots", {})
        stream.broadcast("files", { paths: ["plugin.json"] })
        await touchWorkspace()
        let rebuildError = null
        try {
          await rebuildAll()
        } catch (error) {
          rebuildError = error.message
        }
        return json(res, 200, {
          ok: true,
          previous: current.version,
          version: next,
          manifest: written.manifest,
          validation: written.validation,
          ...(rebuildError ? { rebuildError } : {}),
        })
      }

      // ── Publish (one click from the Ship page) ─────────────────────────────
      if (req.method === "POST" && pathname === "/__dev/publish") {
        const body = await readBody(req)
        const account = await import("../../account.mjs")
        const auth = account.developerAuth({}, account.loadConfig())
        if (!auth.token) {
          return json(res, 400, {
            ok: false,
            code: "not-connected",
            error: "Connect a developer account first — Settings → Developer account.",
          })
        }

        // Optional version bump: applied before the release zip is built.
        let bumped = null
        if (body?.bump && body.bump.enabled === true) {
          const current = manifestStore.read()
          try {
            const next = bumpVersion(current.version, String(body.bump.mode ?? "patch"))
            manifestStore.write({ ...current, version: next })
            bumped = { from: current.version, to: next }
            log(`version bumped ${current.version} → ${next} — publishing`)
            stream.broadcast("snapshots", {})
            stream.broadcast("files", { paths: ["plugin.json"] })
            await touchWorkspace()
          } catch (error) {
            return json(res, 400, { ok: false, error: error.message })
          }
        }

        const lines = []
        const collect = (line) => {
          const text = String(line ?? "")
          if (!text.trim()) return
          lines.push(text)
          log(text)
        }
        try {
          const { publishPlugin } = await import("../publish.mjs")
          const result = await publishPlugin({
            pluginDir,
            appUrl: auth.appUrl,
            token: auth.token,
            notes: typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined,
            price: Number(body?.price ?? 0) || 0,
            currency: typeof body?.currency === "string" ? body.currency : "USD",
            billingPeriod: typeof body?.billingPeriod === "string" ? body.billingPeriod : "one_time",
            trialDays: Number(body?.trialDays ?? 0) || 0,
            log: collect,
          })
          if (!result.ok) {
            return json(res, 502, {
              ok: false,
              error: result.payload?.error ?? `Publish failed (HTTP ${result.status})`,
              violations: result.payload?.violations ?? [],
              errors: result.payload?.errors ?? [],
              log: lines,
              ...(bumped ? { bumped } : {}),
            })
          }
          const manifest = manifestStore.read()
          return json(res, 200, {
            ok: true,
            version: result.payload?.release?.version ?? manifest.version,
            release: result.payload?.release ?? null,
            listing: result.payload?.listing ?? null,
            log: lines,
            ...(bumped ? { bumped } : {}),
          })
        } catch (error) {
          return json(res, 500, { ok: false, error: error.message, log: lines, ...(bumped ? { bumped } : {}) })
        }
      }

      // ── Developer account (standalone `selldoes dev`; shell uses /__ws/*) ──
      if (req.method === "GET" && pathname === "/__dev/account") {
        return json(res, 200, await accountInfo())
      }
      if (req.method === "POST" && pathname === "/__dev/account/connect") {
        const body = await readBody(req)
        const account = await import("../../account.mjs")
        try {
          const result = await account.connectDeveloper(
            String(body?.token ?? ""),
            body?.appUrl ? String(body.appUrl) : undefined,
          )
          return json(res, 200, {
            connected: true,
            appUrl: result.appUrl,
            email: result.account?.email,
            name: result.account?.name,
            status: result.account?.status,
          })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/account/disconnect") {
        const account = await import("../../account.mjs")
        const had = account.disconnectDeveloper()
        return json(res, 200, { connected: false, had })
      }

      // ── Dashboard UI: entry status + one-click notes scaffold ─────────────
      if (req.method === "GET" && pathname === "/__dev/ui/entries") {
        const manifest = manifestStore.read()
        const resolvedUiEntry = manifest.ui?.entry ? String(manifest.ui.entry).replace(/^\.\//, "").replace(/\\/g, "/") : null
        const byEntry = new Map()
        const touch = (entry, page) => {
          if (!entry) return
          const record = byEntry.get(entry) ?? { entry, isDefault: entry === resolvedUiEntry, pages: [] }
          if (page) record.pages.push({ label: page.label ?? entry, path: page.path ?? "/" })
          byEntry.set(entry, record)
        }
        touch(resolvedUiEntry, null)
        for (const page of manifest.dashboardPages ?? []) {
          touch(page?.entry ? String(page.entry).replace(/^\.\//, "").replace(/\\/g, "/") : resolvedUiEntry, page)
        }
        const uiRoot = path.resolve(pluginDir, "ui")
        const builtRoot = uiDir ? path.resolve(uiDir) : null
        const isFile = (file) => Boolean(file && fs.existsSync(file) && fs.statSync(file).isFile())
        const entries = [...byEntry.values()].map((record) => {
          const underUi = record.entry.startsWith("ui/")
          const sourceFile = underUi ? path.resolve(pluginDir, record.entry) : null
          const builtFile = builtRoot && underUi ? path.resolve(builtRoot, record.entry.slice(3)) : null
          return {
            ...record,
            underUi,
            sourceExists: Boolean(sourceFile && sourceFile.startsWith(uiRoot + path.sep) && isFile(sourceFile)),
            builtExists: Boolean(builtFile && builtFile.startsWith(builtRoot + path.sep) && isFile(builtFile)),
          }
        })
        return json(res, 200, { hasUi: Boolean(resolvedUiEntry), flavor: detectUiFlavor(pluginDir), entries })
      }
      if (req.method === "POST" && pathname === "/__dev/ui/scaffold") {
        const body = await readBody(req)
        try {
          const current = manifestStore.read()
          const plan = planNotesUi({
            pluginDir,
            manifest: current,
            entry: body?.entry || current.ui?.entry || "ui/index.html",
          })

          // Ensure manifest wiring: ui.entry + a dashboardPages entry for the page.
          const manifest = JSON.parse(JSON.stringify(current))
          let manifestChanged = false
          if (!manifest.ui?.entry) {
            manifest.ui = { ...(manifest.ui ?? {}), entry: "ui/index.html", title: manifest.ui?.title ?? manifest.name }
            manifestChanged = true
          }
          const pages = Array.isArray(manifest.dashboardPages) ? manifest.dashboardPages : []
          const resolved = (page) => String(page?.entry ?? manifest.ui?.entry ?? "").replace(/^\.\//, "")
          if (!pages.some((page) => resolved(page) === plan.entry)) {
            const requestedLabel = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : null
            const requestedPath = typeof body?.path === "string" && body.path.trim() ? body.path.trim() : null
            const requestedIcon = typeof body?.icon === "string" && body.icon.trim() ? body.icon.trim() : null
            if (pages.length === 0) {
              pages.push({
                label: requestedLabel ?? manifest.name,
                path: requestedPath && requestedPath.startsWith("/") ? requestedPath : "/",
                ...(requestedIcon ? { icon: requestedIcon } : manifest.icon ? { icon: manifest.icon } : {}),
                entry: plan.entry,
              })
            } else if (plan.isRoot) {
              const target = pages.find((page) => !page?.entry) ?? pages[0]
              target.entry = plan.entry
            } else {
              const rel = plan.relHtml.replace(/\.html?$/i, "")
              const derived = rel
                .split(/[/\\-]+/)
                .filter(Boolean)
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ")
              pages.push({
                label: requestedLabel ?? derived,
                path: requestedPath && requestedPath.startsWith("/") ? requestedPath : `/${rel}`,
                ...(requestedIcon ? { icon: requestedIcon } : {}),
                entry: plan.entry,
              })
            }
            manifestChanged = true
          }
          if (manifestChanged) manifest.dashboardPages = pages

          // One snapshot covers the whole scaffold — a single undo reverts it.
          manifestStore.snapshots.create({ reason: "scaffold dashboard ui", files: [...plan.files, "plugin.json"] })
          const written = applyNotesPlan(pluginDir, plan)
          if (manifestChanged) manifestStore.write(manifest)

          let rebuildError = null
          try {
            await rebuildAll()
          } catch (error) {
            rebuildError = error.message
          }
          log(`scaffolded dashboard UI (${plan.flavor})${written.length ? `: ${written.join(", ")}` : " — files already present"}`)
          if (written.length) {
            stream.broadcast("files", { paths: written })
            stream.broadcast("snapshots", {})
          }
          return json(res, 200, {
            ok: true,
            entry: plan.entry,
            flavor: plan.flavor,
            written,
            manifest: manifestStore.read(),
            validation: manifestStore.validation(),
            ...(rebuildError ? { rebuildError } : {}),
          })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
      }

      // ── Code scaffolds: New job / New hook / New route ─────────────────────
      if (req.method === "POST" && pathname.startsWith("/__dev/scaffold/")) {
        const kind = pathname.slice("/__dev/scaffold/".length)
        if (!["job", "hook", "route"].includes(kind)) return json(res, 404, { error: `Unknown scaffold "${kind}" (expected job, hook or route)` })
        const body = await readBody(req)
        try {
          const current = manifestStore.read()
          const plan = planCodeScaffold({
            pluginDir,
            manifest: current,
            kind,
            name: body?.type ?? body?.name ?? body?.path,
            description: body?.description,
            runtime: body?.runtime,
          })
          // One snapshot covers module + wiring + manifest — one undo reverts it.
          manifestStore.snapshots.create({
            reason: `scaffold ${kind}`,
            files: [...plan.files, ...(plan.wiring ? [plan.entry] : []), "plugin.json"],
          })
          const written = applyCodePlan(pluginDir, plan)
          manifestStore.write(plan.manifest)
          let rebuildError = null
          try {
            await rebuildAll()
          } catch (error) {
            rebuildError = error.message
          }
          log(`scaffolded ${kind}: ${plan.file}${written.includes(plan.entry) ? " (+ entry wiring)" : ""}`)
          stream.broadcast("files", { paths: written })
          stream.broadcast("snapshots", {})
          return json(res, 200, {
            ok: true,
            kind,
            file: plan.file,
            written,
            manifest: manifestStore.read(),
            validation: manifestStore.validation(),
            ...(rebuildError ? { rebuildError } : {}),
          })
        } catch (error) {
          return json(res, 400, { error: error.message })
        }
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
        // Effective assistant config: user settings (~/.selldoes/settings.json)
        // merged with the project's optional `assistant.model` override.
        const resolved = resolveAssistant({ config: fileConfig })
        let userSettings = null
        try {
          userSettings = userSettingsView()
        } catch {
          // user-settings module unavailable
        }
        return {
          assistant: {
            provider: resolved.provider,
            model: resolved.model,
            baseUrl: resolved.baseUrl,
            apiKey: maskKey(resolved.apiKey),
            apiKeySet: Boolean(resolved.apiKey),
            projectModel: fileConfig.assistant?.model ?? null,
          },
          env: {
            OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
            ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
            GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
            OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
            DEEPINFRA_API_KEY: Boolean(process.env.DEEPINFRA_API_KEY),
            OLLAMA_HOST: process.env.OLLAMA_HOST ?? null,
          },
          server: {
            storeId: Number(fileConfig.storeId ?? 1),
            storeSlug: String(fileConfig.storeSlug ?? "dev-store"),
            storeName: String(fileConfig.storeName ?? "Dev Store"),
            port: Number(fileConfig.port ?? 4590),
            host: String(fileConfig.host ?? "127.0.0.1"),
            ai: { mockReply: fileConfig.ai?.mockReply ?? null },
            email: { disabled: Boolean(fileConfig.email?.disabled) },
            sampleJobs: fileConfig.sampleJobs ?? null,
          },
          publish: {
            // Per-project override wins; otherwise the user-level default
            // (~/.selldoes/settings.json) — never a bare "patch" surprise.
            bump: BUMP_MODES.includes(String(fileConfig.publish?.bump))
              ? String(fileConfig.publish.bump)
              : userSettings?.publish?.bump ?? "patch",
          },
        }
      }
      if (pathname === "/__dev/config") {
        if (req.method === "GET") return json(res, 200, configPayload())
        if (req.method === "POST") {
          // Sections map to selldoes.config.json keys: `server`
          // (storeId/storeSlug/storeName/port/host), `ai` (mockReply),
          // `email` (disabled), `sampleJobs` and `publish` — plus the
          // assistant. `assistant` writes to the user settings
          // (~/.selldoes/settings.json) unless `scope: "project"` pins a
          // per-project `model` override. Assistant settings apply
          // immediately (resolved per request); everything else is baked in
          // at startup, so the response flags `restartRequired`.
          const body = await readBody(req)
          const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
          if (
            !isObject(body?.assistant) &&
            !isObject(body?.server) &&
            !isObject(body?.ai) &&
            !isObject(body?.email) &&
            !isObject(body?.publish) &&
            body?.sampleJobs === undefined
          ) {
            return json(res, 400, { error: "Nothing to save — send assistant, server, ai, email, publish or sampleJobs" })
          }
          const fileConfig = readConfig()
          const next = { ...fileConfig }
          let restartRequired = false

          if (body.assistant !== undefined) {
            if (!isObject(body.assistant)) return json(res, 400, { error: "assistant must be an object" })
            if (body.scope === "project") {
              // Per-project override: only `model` lives in the project folder —
              // credentials and provider selection are user-level, never committed.
              for (const key of Object.keys(body.assistant)) {
                if (key !== "model") {
                  return json(res, 400, { error: `Project assistant override only supports \`model\` — \`${key}\` lives in User settings` })
                }
              }
              const merged = { ...(fileConfig.assistant ?? {}) }
              if (body.assistant.model === undefined || body.assistant.model === null || body.assistant.model === "") delete merged.model
              else merged.model = String(body.assistant.model).trim()
              if (Object.keys(merged).length > 0) next.assistant = merged
              else delete next.assistant
            } else {
              // The assistant belongs to the developer, not to this project:
              // save to ~/.selldoes/settings.json (applies to every project).
              try {
                applyUserSettingsPatch({ assistant: body.assistant })
              } catch (error) {
                return json(res, 400, { error: error.message })
              }
              log("assistant settings saved to ~/.selldoes/settings.json — applied immediately")
              return json(res, 200, { ok: true, restartRequired: false, ...configPayload() })
            }
          }

          if (body.server !== undefined) {
            if (!isObject(body.server)) return json(res, 400, { error: "server must be an object" })
            const srv = body.server
            if (srv.storeId !== undefined && srv.storeId !== null && srv.storeId !== "") {
              const value = Number(srv.storeId)
              if (!Number.isInteger(value) || value < 1) return json(res, 400, { error: "server.storeId must be a positive integer" })
              if (value !== Number(fileConfig.storeId ?? 1)) restartRequired = true
              next.storeId = value
            }
            if (srv.storeSlug !== undefined && srv.storeSlug !== null) {
              const value = String(srv.storeSlug).trim()
              if (!value) return json(res, 400, { error: "server.storeSlug cannot be empty" })
              if (value !== String(fileConfig.storeSlug ?? "dev-store")) restartRequired = true
              next.storeSlug = value
            }
            if (srv.storeName !== undefined && srv.storeName !== null) {
              const value = String(srv.storeName).trim()
              if (value !== String(fileConfig.storeName ?? "Dev Store")) restartRequired = true
              next.storeName = value
            }
            if (srv.port !== undefined && srv.port !== null && srv.port !== "") {
              const value = Number(srv.port)
              if (!Number.isInteger(value) || value < 1024 || value > 65535) return json(res, 400, { error: "server.port must be between 1024 and 65535" })
              if (value !== Number(fileConfig.port ?? 4590)) restartRequired = true
              next.port = value
            }
            if (srv.host !== undefined && srv.host !== null && srv.host !== "") {
              const value = String(srv.host).trim()
              if (value !== String(fileConfig.host ?? "127.0.0.1")) restartRequired = true
              next.host = value
            }
          }

          if (body.ai !== undefined) {
            if (!isObject(body.ai)) return json(res, 400, { error: "ai must be an object" })
            const merged = { ...(fileConfig.ai ?? {}) }
            if ("mockReply" in body.ai) {
              const value = body.ai.mockReply === null || body.ai.mockReply === "" ? null : String(body.ai.mockReply)
              if (value !== (fileConfig.ai?.mockReply ?? null)) restartRequired = true
              if (value === null) delete merged.mockReply
              else merged.mockReply = value
            }
            if (Object.keys(merged).length > 0) next.ai = merged
            else delete next.ai
          }

          if (body.email !== undefined) {
            if (!isObject(body.email)) return json(res, 400, { error: "email must be an object" })
            const merged = { ...(fileConfig.email ?? {}) }
            if ("disabled" in body.email) {
              const value = Boolean(body.email.disabled)
              if (value !== Boolean(fileConfig.email?.disabled)) restartRequired = true
              if (value) merged.disabled = true
              else delete merged.disabled
            }
            if (Object.keys(merged).length > 0) next.email = merged
            else delete next.email
          }

          if (body.sampleJobs !== undefined) {
            const value = body.sampleJobs
            if (value !== null && !isObject(value)) return json(res, 400, { error: "sampleJobs must be an object or null" })
            const nextValue = value ?? null
            if (JSON.stringify(nextValue ?? null) !== JSON.stringify(fileConfig.sampleJobs ?? null)) restartRequired = true
            if (nextValue) next.sampleJobs = nextValue
            else delete next.sampleJobs
          }

          if (body.publish !== undefined) {
            if (!isObject(body.publish)) return json(res, 400, { error: "publish must be an object" })
            const merged = { ...(fileConfig.publish ?? {}) }
            if ("bump" in body.publish) {
              const value = String(body.publish.bump ?? "").trim()
              if (!BUMP_MODES.includes(value)) return json(res, 400, { error: `publish.bump must be one of ${BUMP_MODES.join(", ")}` })
              merged.bump = value
            }
            if (Object.keys(merged).length > 0) next.publish = merged
            else delete next.publish
          }

          fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`)
          log(restartRequired ? "settings saved to selldoes.config.json — restart the preview to apply" : "settings saved to selldoes.config.json")
          return json(res, 200, { ok: true, restartRequired, ...configPayload() })
        }
      }

      // ── User (global) settings — ~/.selldoes/settings.json ──────────────────
      // Standalone `selldoes dev` twin of the workspace's /__ws/user-settings:
      // assistant credentials, default project dir, editor preference and the
      // default release bump.
      if (pathname === "/__dev/user-settings") {
        if (req.method === "GET") return json(res, 200, userSettingsView())
        if (req.method === "POST") {
          const body = await readBody(req)
          try {
            applyUserSettingsPatch(body ?? {})
            return json(res, 200, { ok: true, ...userSettingsView() })
          } catch (error) {
            return json(res, 400, { error: error.message })
          }
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

      // ── Packages (npm dependencies + sandbox compatibility) ────────────────
      if (req.method === "GET" && pathname === "/__dev/packages") {
        try {
          return json(res, 200, await packagesPayload())
        } catch (error) {
          return json(res, 500, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/packages/check") {
        return withPackageMutationLock(async () => {
          packageProbeCache.clear()
          return json(res, 200, await packagesPayload({ refresh: true }))
        })
      }
      if (req.method === "GET" && pathname === "/__dev/packages/search") {
        const query = (url.searchParams.get("q") ?? "").trim()
        if (!query) return json(res, 200, { results: [] })
        try {
          const response = await fetch(`https://registry.npmjs.org/-/v1/search?size=20&text=${encodeURIComponent(query)}`, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(8_000),
          })
          if (!response.ok) throw new Error(`npm registry answered HTTP ${response.status}`)
          const data = await response.json()
          const results = (data.objects ?? [])
            .map((entry) => ({
              name: entry.package?.name,
              version: entry.package?.version,
              description: entry.package?.description ?? "",
              date: entry.package?.date ?? null,
              publisher: entry.package?.publisher?.username ?? null,
              links: { npm: entry.package?.links?.npm, homepage: entry.package?.links?.homepage },
            }))
            .filter((entry) => entry.name)
          return json(res, 200, { results })
        } catch (error) {
          return json(res, 502, { error: `npm search failed: ${error.message}` })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/packages/add") {
        const body = await readBody(req)
        const name = String(body?.name ?? "").trim()
        if (!name) return json(res, 400, { error: "Missing package name" })
        return withPackageMutationLock(async () => {
          manifestStore.snapshots.create({ reason: `add package ${name}`, files: ["plugin.json", "package.json"] })
          try {
            const result = await addDependency({ pluginDir, name, range: body?.range, log })
            packageProbeCache.clear()
            stream.broadcast("files", { paths: ["plugin.json", "package.json"] })
            stream.broadcast("snapshots", {})
            log(`package installed: ${result.name}@${result.range} (${result.manager})`)
            let rebuildError = null
            try {
              await rebuildAll()
            } catch (error) {
              rebuildError = error.message
            }
            return json(res, 200, { ok: true, result, ...(rebuildError ? { rebuildError } : {}), ...(await packagesPayload()) })
          } catch (error) {
            return json(res, 400, { error: error.message })
          }
        })
      }
      if (req.method === "POST" && pathname === "/__dev/packages/remove") {
        const body = await readBody(req)
        const name = String(body?.name ?? "").trim()
        if (!name) return json(res, 400, { error: "Missing package name" })
        return withPackageMutationLock(async () => {
          manifestStore.snapshots.create({ reason: `remove package ${name}`, files: ["plugin.json", "package.json"] })
          try {
            const result = await removeDependency({ pluginDir, name, log })
            packageProbeCache.clear()
            stream.broadcast("files", { paths: ["plugin.json", "package.json"] })
            stream.broadcast("snapshots", {})
            log(`package removed: ${result.name} (${result.manager})`)
            let rebuildError = null
            try {
              await rebuildAll()
            } catch (error) {
              rebuildError = error.message
            }
            return json(res, 200, { ok: true, result, ...(rebuildError ? { rebuildError } : {}), ...(await packagesPayload()) })
          } catch (error) {
            return json(res, 400, { error: error.message })
          }
        })
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
          return json(res, 200, {
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
        const requested = decodeURIComponent(rest.join("/"))
        const fallback = (reason) =>
          html(
            res,
            404,
            uiFallbackHtml({ title: manifest.ui?.title ?? manifest.name, entry: reason === "missing" ? requested : null, reason, slug: manifest.slug }),
          )
        if (!uiDir) return fallback("no-ui")
        const file = resolveUiAsset(uiDir, requested)
        if (!file) return fallback("missing")
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

      // Unknown path: styled page for browser navigations, JSON for API clients.
      return sendNotFound(req, res, {
        pathname,
        homeUrl: `/${projectId}`,
        homeLabel: "Back to the preview",
        hint:
          "Preview pages live under this project's id — pick one from the sidebar, or press Ctrl+K for the command palette.",
        links: [
          { to: `/${projectId}`, label: "Overview" },
          { to: `/${projectId}/code`, label: "Code" },
          { to: `/${projectId}/console`, label: "Console" },
          { to: `/${projectId}/settings`, label: "Settings" },
        ],
      })
    } catch (error) {
      return json(res, 500, { error: error.message })
    }
  })

  const listenPort = Number(port ?? config.port ?? 4590)
  const listenHost = String(host ?? config.host ?? "127.0.0.1")

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

  const url = `http://${listenHost === "0.0.0.0" ? "localhost" : listenHost}:${listenPort}/${projectId}`

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
