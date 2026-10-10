import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { contentTypeFor } from "./util.mjs"
import { probePort, reclaimPort } from "./port.mjs"
import { sendNotFound } from "./not-found-page.mjs"
import { defaultProjectsDir, getCurrentProjectId, getWorkspaceSettings, listProjects, setCurrentProject, touchProject } from "./workspace.mjs"
import { attachTerminalServer } from "./terminal.mjs"

/**
 * The workspace server — the web front door of the SDK.
 *
 *   selldoes                  → starts this server and opens the browser
 *   selldoes workspace --dev  → same server with the dev-ui on Vite (HMR) —
 *                               the SDK developer's mode (`npm run dev`)
 *
 * Serves:
 *   /              → 302 /<projectId> (the current project's internal id)
 *   /<projectId>/* → the workspace SPA (ui-dist, or Vite in --dev mode) —
 *                    the id is the first URL segment (YouTube-style, 11
 *                    base64url chars) and also selects that project (deep
 *                    links included)
 *   /__ws/*        → workspace API (projects, import, create, packages, pull,
 *                    preview spawning)
 *
 * Plugin previews are NOT hosted here: opening a project spawns
 * `selldoes dev --dir <path> --port <n>` as a child process (4591+), so
 * several previews run side by side and this server never dies.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SDK_ROOT = path.resolve(HERE, "..")
const UI_DIST = path.join(HERE, "plugin", "dev", "ui-dist")
const BIN = path.join(SDK_ROOT, "bin", "selldoes.mjs")

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
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  res.end(JSON.stringify(data))
}

function html(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
  res.end(body)
}

/**
 * 404 for the workspace shell: a styled page for browsers (with links back
 * into the workspace), the usual JSON body for API clients.
 */
function notFound(req, res, pathname) {
  const currentId = getCurrentProjectId()
  const project = currentId ? listProjects().find((entry) => entry.id === currentId) ?? null : null
  const homeUrl = project && !project.missing ? `/${project.id}` : "/"
  return sendNotFound(req, res, {
    pathname,
    homeUrl,
    homeLabel: project && !project.missing ? `Back to ${project.name}` : "Open workspace",
    hint:
      project && !project.missing
        ? "If you followed a link from the sidebar, the page may have been renamed — pick it from the sidebar or press Ctrl+K for the command palette."
        : "Create or import a project to fill the workspace, or open User settings for machine-wide preferences.",
    links: project && !project.missing
      ? [
          { to: `/${project.id}`, label: "Overview" },
          { to: `/${project.id}/code`, label: "Code" },
          { to: `/${project.id}/settings`, label: "Project settings" },
          { to: `/${project.id}/user-settings`, label: "User settings" },
        ]
      : [{ to: "/user-settings", label: "User settings" }],
  })
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ""
    req.on("data", (chunk) => {
      data += chunk
      if (data.length > 8_000_000) req.destroy()
    })
    req.on("end", () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve({})
      }
    })
  })
}

async function findFreePort(host, start = 4591, end = 4640) {
  for (let port = start; port <= end; port++) {
    if (await probePort(port, host)) return port
  }
  throw new Error(`No free port between ${start} and ${end}`)
}

/** Serves the built SPA (ui-dist) with an index.html fallback. */
function serveSpa(res, pathname, { devMiddleware } = {}) {
  if (devMiddleware) return null // caller delegates to Vite
  // URLs are /<projectId>/<page> — asset requests (/assets/…) resolve against
  // ui-dist by full pathname; anything else falls back to the SPA shell.
  const requested = pathname.replace(/^\//, "")
  const candidate = requested ? path.join(UI_DIST, ...requested.split("/")) : path.join(UI_DIST, "index.html")
  const root = path.resolve(UI_DIST)
  const relative = path.relative(root, path.resolve(candidate))
  // `path.relative` avoids the sibling-prefix trap startsWith() has (e.g. ui-dist-evil).
  const safe = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  if (safe && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    res.writeHead(200, { "Content-Type": contentTypeFor(candidate), "Cache-Control": "no-store", "Content-Security-Policy": UI_CSP })
    fs.createReadStream(candidate).pipe(res)
    return true
  }
  const index = path.join(UI_DIST, "index.html")
  if (!fs.existsSync(index)) {
    return html(res, 500, "Workspace UI is not built. Run `npm run build:dev-ui` in the SDK repo.")
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": UI_CSP })
  fs.createReadStream(index).pipe(res)
  return true
}

const MAX_LOG_LINES = 200

export async function startWorkspaceServer({ port = 4590, host = "127.0.0.1", dev = false } = {}) {
  const previews = new Map() // id → preview record
  const spawning = new Map() // project.id → in-flight spawn promise
  let previewSeq = 0
  let accountCache = { at: 0, value: null }

  // The UI's connect/disconnect routes write ~/.selldoes.json — drop the
  // cached identity so the next bootstrap reflects it immediately.
  function resetAccountCache() {
    accountCache = { at: 0, value: null }
  }

  const sdkVersion = JSON.parse(fs.readFileSync(path.join(SDK_ROOT, "package.json"), "utf8")).version
  const defaultDirFallback = defaultProjectsDir()

  // One-time migration: assistant credentials older SDK versions saved into
  // project folders move up to ~/.selldoes/settings.json (fill-if-unset).
  void (async () => {
    try {
      const { migrateProjectAssistantConfigs } = await import("./user-settings.mjs")
      const result = migrateProjectAssistantConfigs(listProjects())
      if (result.migrated.length > 0) {
        console.log(`  moved assistant credentials from ${result.migrated.length} project(s) to ~/.selldoes/settings.json`)
      }
    } catch {
      // migration is best-effort — never block the workspace on it
    }
  })()

  /** The default parent dir for new projects — workspace.json wins, else ~/Documents/Selldoes. */
  function resolveDefaultDir() {
    try {
      return getWorkspaceSettings().defaultDir ?? defaultDirFallback
    } catch {
      return defaultDirFallback
    }
  }

  // ── SDK-dev mode: serve the dev-ui through Vite (HMR) ──────────────────────
  let devMiddleware = null
  if (dev) {
    const viteEntry = path.join(SDK_ROOT, "dev-ui", "node_modules", "vite", "dist", "node", "index.js")
    if (!fs.existsSync(viteEntry)) {
      throw new Error("SDK-dev mode needs the dev-ui dependencies — run `npm install` in dev-ui/ first")
    }
    // created after the http server exists (HMR sockets attach to it)
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      const pathname = url.pathname

      // ── Workspace API ──────────────────────────────────────────────────────
      if (pathname.startsWith("/__ws/")) {
        const { route } = await import("./workspace-api.mjs")
        return await route({
          req,
          res,
          pathname,
          readBody,
          json,
          html,
          ctx: {
            previews,
            findPreview,
            startPreview,
            stopPreview,
            listPreviews,
            bootstrap,
            // Read fresh per request so `/__ws/settings` applies immediately.
            get defaultDir() {
              return resolveDefaultDir()
            },
            host,
            selectProject,
            restartProject,
            currentPreviewRecord,
            getCurrentId: getCurrentProjectId,
            resetAccountCache,
          },
        })
      }

      // ── Proxy to the current project's preview server ──────────────────────
      // The shell (:4590) hosts the sidebar and dialogs; per-project data
      // flows through the current preview child, so switching workspaces
      // never leaves the shell.
      const isProxyPath =
        pathname === "/__dev" ||
        pathname.startsWith("/__dev/") ||
        pathname === "/api/plugin-api" ||
        pathname.startsWith("/api/plugin-api/") ||
        pathname === "/api/plugin-public" ||
        pathname.startsWith("/api/plugin-public/") ||
        pathname === "/api/plugins" ||
        pathname.startsWith("/api/plugins/")
      if (isProxyPath) {
        let preview = currentPreviewRecord()
        if (!preview) {
          // Lazy spawn: the current workspace boots its preview on first use.
          const currentId = getCurrentProjectId()
          const project = currentId ? listProjects().find((entry) => entry.id === currentId) ?? null : null
          if (project && !project.missing) {
            try {
              preview = await spawnOnce(project)
            } catch (error) {
              return json(res, 502, { error: `Could not start the preview for ${project.slug}: ${error.message}` })
            }
          }
        }
        if (!preview) {
          return json(res, 404, { error: "No workspace project selected — pick one in the sidebar", code: "no-project" })
        }
        const target = http.request(
          {
            host: "127.0.0.1",
            port: preview.port,
            path: req.url,
            method: req.method,
            headers: { ...req.headers, host: `127.0.0.1:${preview.port}` },
          },
          (upstream) => {
            res.writeHead(upstream.statusCode ?? 502, upstream.headers)
            upstream.pipe(res)
          },
        )
        target.on("error", () => {
          if (!res.headersSent) json(res, 502, { error: `Preview for ${preview.slug} is not responding` })
          else res.end()
        })
        req.pipe(target)
        return
      }

      // ── SPA shell ──────────────────────────────────────────────────────────
      // URLs are /<projectId>/<page> — the project's internal id (YouTube-
      // style, 11 base64url chars). The segment is authoritative: opening
      // /{id}/… selects that project (deep links open the right workspace),
      // then the SPA is served. Assets (/assets/…) fall through to ui-dist.
      if (req.method === "GET") {
        const [requestedId] = pathname.split("/").filter(Boolean)
        if (requestedId && requestedId !== "assets") {
          const project = listProjects().find((entry) => entry.id === requestedId)
          if (project && !project.missing && getCurrentProjectId() !== project.id) {
            setCurrentProject(project.id)
          }
        }
        if (pathname === "/") {
          const currentId = getCurrentProjectId()
          const project = currentId ? listProjects().find((entry) => entry.id === currentId) ?? null : null
          if (project && !project.missing) {
            res.writeHead(302, { Location: `/${project.id}` })
            res.end()
            return
          }
        }
        if (devMiddleware) {
          // Vite owns the SPA + assets in SDK-dev mode (base is "/").
          return devMiddleware(req, res, () => notFound(req, res, pathname))
        }
        return serveSpa(res, pathname)
      }

      notFound(req, res, pathname)
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  // ── Terminal (workspace-owned; cwd = selected project) ──────────────────────
  const terminals = attachTerminalServer({
    server,
    path: "/__ws/terminal",
    resolveCwd: (url) => {
      const requested = url.searchParams.get("projectId") || getCurrentProjectId()
      const project = listProjects().find((entry) => entry.id === requested)
      return project && !project.missing ? project.path : null
    },
    log: (line) => console.log(`  ${line}`),
  })

  // ── Preview spawning ────────────────────────────────────────────────────────
  function findPreview(id) {
    return previews.get(String(id)) ?? null
  }

  /** The alive preview backing the shell's current workspace, if any. */
  function currentPreviewRecord() {
    const currentId = getCurrentProjectId()
    if (!currentId) return null
    return [...previews.values()].find((preview) => preview.projectId === currentId && preview.proc && preview.proc.exitCode === null) ?? null
  }

  /** Selects a project as the shell's current workspace (spawning its preview). */
  async function selectProject(project) {
    if (project.missing) throw new Error(`${project.path} no longer exists`)
    const preview = await spawnOnce(project)
    setCurrentProject(project.id)
    return preview
  }

  /** Resolves when the preview port accepts connections (or fails loudly). */
  async function waitForPreview(preview) {
    const deadline = Date.now() + 15_000
    for (;;) {
      if (preview.proc && preview.proc.exitCode !== null) {
        throw new Error(`preview exited during startup — last log: ${preview.log.slice(-2).join(" | ") || "none"}`)
      }
      // probePort resolves true when the port is FREE — busy means listening.
      if (!(await probePort(preview.port, "127.0.0.1"))) return preview
      if (Date.now() > deadline) throw new Error(`preview did not start listening on ${preview.port} within 15s`)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  /**
   * Spawn-once guard: the proxy lazily boots the current project's preview
   * on the first request, and concurrent requests must not double-spawn.
   * Resolves only once the preview port actually accepts connections.
   */
  function spawnOnce(project) {
    const inFlight = spawning.get(project.id)
    if (inFlight) return inFlight
    const promise = startPreview(project)
      .then(waitForPreview)
      .then((preview) => {
        spawning.delete(project.id)
        return preview
      })
      .catch((error) => {
        spawning.delete(project.id)
        throw error
      })
    spawning.set(project.id, promise)
    return promise
  }

  /** Kill + respawn the current project's preview (for stuck bundles). */
  async function restartProject(project) {
    const existing = [...previews.values()].find((preview) => preview.projectId === project.id && preview.proc && preview.proc.exitCode === null)
    if (existing) stopPreview(existing.id)
    const preview = await startPreview(project)
    setCurrentProject(project.id)
    return waitForPreview(preview)
  }

  function listPreviews() {
    return [...previews.values()].map((preview) => ({
      id: preview.id,
      projectId: preview.projectId,
      slug: preview.slug,
      name: preview.name,
      url: preview.url,
      port: preview.port,
      pid: preview.proc?.pid ?? null,
      alive: Boolean(preview.proc && preview.proc.exitCode === null && !preview.proc.killed),
      startedAt: preview.startedAt,
      log: preview.log.slice(-40),
    }))
  }

  async function startPreview(project) {
    if (project.kind !== "plugin") {
      throw new Error("Web previews are for plugins — theme dev needs a store: run `selldoes dev --dir <path> --store <slug>`")
    }
    const existing = [...previews.values()].find((preview) => preview.projectId === project.id && preview.proc && preview.proc.exitCode === null)
    if (existing) return existing
    if (project.missing) throw new Error(`${project.path} no longer exists`)

    const previewPort = await findFreePort(host)
    const child = spawn(process.execPath, [BIN, "dev", "--dir", project.path, "--port", String(previewPort)], {
      cwd: project.path,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SELDOES_NO_UPDATE_CHECK: "1" },
      windowsHide: true,
    })
    const preview = {
      id: `pv${++previewSeq}`,
      projectId: project.id,
      slug: project.slug,
      name: project.name,
      port: previewPort,
      url: `http://${host === "0.0.0.0" ? "localhost" : host}:${previewPort}/${project.id}`,
      proc: child,
      log: [],
      startedAt: new Date().toISOString(),
    }
    const capture = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue
        preview.log.push(line)
        if (preview.log.length > MAX_LOG_LINES) preview.log.splice(0, preview.log.length - MAX_LOG_LINES)
      }
    }
    child.stdout.on("data", capture)
    child.stderr.on("data", capture)
    child.on("exit", () => {
      preview.exitedAt = new Date().toISOString()
    })
    previews.set(preview.id, preview)
    touchProject({ dir: project.path, kind: project.kind, source: project.source })
    return preview
  }

  function stopPreview(id) {
    const preview = findPreview(id)
    if (!preview) return false
    if (preview.proc && preview.proc.exitCode === null) preview.proc.kill()
    // Drop the record immediately — a dying process still reports
    // exitCode === null for a moment and would poison currentPreviewRecord().
    previews.delete(String(id))
    return true
  }

  // ── Bootstrap data for the workspace SPA ────────────────────────────────────
  async function accountInfo() {
    let account
    try {
      const mod = await import("./account.mjs")
      const cfg = mod.loadConfig()
      const auth = mod.developerAuth({}, cfg)
      if (!auth.token) return { connected: false, appUrl: auth.appUrl }
      if (accountCache.value && Date.now() - accountCache.at < 60_000) return accountCache.value
      const me = await fetch(auth.appUrl + "/api/developers/me", {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.json())
      const value = { connected: true, appUrl: auth.appUrl, email: me?.account?.email, name: me?.account?.name, status: me?.account?.status }
      accountCache = { at: Date.now(), value }
      return value
    } catch {
      // Cache the failure too — otherwise every bootstrap refetches a dead host.
      const value = { connected: true, appUrl: accountCache.value?.appUrl, unreachable: true }
      accountCache = { at: Date.now(), value }
      return value
    }
  }

  async function bootstrap() {
    let assistant = { configured: false }
    try {
      const { resolveAssistant, assistantSummary } = await import("./plugin/dev/assistant.mjs")
      assistant = assistantSummary(resolveAssistant({ config: {} }))
    } catch {
      // assistant module unavailable
    }
    let userSettings = null
    try {
      const { userSettingsView } = await import("./user-settings.mjs")
      userSettings = userSettingsView()
    } catch {
      // user-settings module unavailable
    }
    const currentId = getCurrentProjectId()
    const currentProject = currentId ? listProjects().find((entry) => entry.id === currentId) ?? null : null
    const currentPreview = currentPreviewRecord()
    return {
      mode: "workspace",
      sdk: { version: sdkVersion, dev: Boolean(dev) },
      projects: listProjects(),
      current:
        currentProject && !currentProject.missing
          ? {
              project: currentProject,
              url: currentPreview?.url ?? null,
              port: currentPreview?.port ?? null,
              alive: Boolean(currentPreview),
            }
          : null,
      account: await accountInfo(),
      assistant,
      userSettings,
      defaultDir: resolveDefaultDir(),
      previews: listPreviews().filter((preview) => preview.alive),
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  const listenPort = Number(port)
  // A previous workspace may still hold the port (a hard Ctrl+C on Windows can
  // orphan the node process) — stop it so restarts don't crash-loop on
  // EADDRINUSE. Another app on the port gets a clear error instead.
  await reclaimPort(listenPort, host)
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(listenPort, host, resolve)
  })

  if (dev) {
    const viteEntry = pathToFileURL(path.join(SDK_ROOT, "dev-ui", "node_modules", "vite", "dist", "node", "index.js")).href
    const vite = await import(viteEntry)
    const viteServer = await vite.createServer({
      configFile: path.join(SDK_ROOT, "dev-ui", "vite.config.ts"),
      root: path.join(SDK_ROOT, "dev-ui"),
      base: "/",
      appType: "spa",
      server: { middlewareMode: true, hmr: { server } },
    })
    devMiddleware = viteServer.middlewares
  }

  // The shell opens on the current project's URL (/{projectId}) — bare root
  // when nothing is selected (the onboarding dialog takes over).
  const currentId = getCurrentProjectId()
  const current = currentId ? listProjects().find((entry) => entry.id === currentId) ?? null : null
  const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${listenPort}${current && !current.missing ? `/${current.id}` : ""}`

  const shutdown = () => {
    for (const preview of previews.values()) {
      if (preview.proc && preview.proc.exitCode === null) preview.proc.kill()
    }
    terminals.closeAll()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 800).unref()
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)

  return { url, port: listenPort, host, server, previews: listPreviews, close: shutdown, dev: Boolean(dev) }
}
