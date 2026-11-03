import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { normalizeDevHost } from "./http.mjs"
import { reclaimPort } from "./port.mjs"
import { defaultProjectsDir, getCurrentProjectId, getWorkspaceSettings, listProjects } from "./workspace.mjs"
import { createBootstrap } from "./workspace-server/bootstrap.mjs"
import { assertDevDependencies, setupDevMode } from "./workspace-server/dev.mjs"
import { SDK_ROOT } from "./workspace-server/paths.mjs"
import { createPreviewManager } from "./workspace-server/previews.mjs"
import { createRequestHandler } from "./workspace-server/router.mjs"
import { attachWorkspaceTerminal } from "./workspace-server/terminal-bridge.mjs"

// Re-exported for callers/tests that predate `cli/sdk-watch.mjs`.
export { watchSdkSources } from "./sdk-watch.mjs"

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
 *
 * Implementation lives under `cli/workspace-server/`: `paths` (constants),
 * `respond` (HTTP helpers), `spa` (ui-dist serving), `previews` (child
 * lifecycle), `bootstrap` (SPA bootstrap data), `router` (request routing),
 * `dev` (Vite + SDK watcher) and `terminal-bridge`.
 */

export async function startWorkspaceServer({ port = 4590, host = "127.0.0.1", dev = false } = {}) {
  // The workspace shell exposes file writes and a terminal — never routable.
  host = normalizeDevHost(host, { fallback: "127.0.0.1", log: (line) => console.log(`  ${line}`) })

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

  // SDK-dev mode needs the dev-ui dependencies up front (the Vite middleware
  // itself is created after the http server exists — HMR sockets attach to it).
  if (dev) assertDevDependencies()

  const previewManager = createPreviewManager({ host, log: (line) => console.log(`  ${line}`) })
  const { bootstrap, resetAccountCache } = createBootstrap({ sdkVersion, dev, resolveDefaultDir, previewManager })

  let devMiddleware = null
  let disposeSdkWatch = null

  const server = http.createServer(
    createRequestHandler({
      host,
      previewManager,
      bootstrap,
      resolveDefaultDir,
      resetAccountCache,
      getDevMiddleware: () => devMiddleware,
    }),
  )

  // ── Terminal (workspace-owned; cwd = selected project) ──────────────────────
  const terminals = attachWorkspaceTerminal(server)

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
    const setup = await setupDevMode({ server, restartLivePreviews: previewManager.restartLivePreviews })
    devMiddleware = setup.devMiddleware
    disposeSdkWatch = setup.disposeSdkWatch
  }

  // The shell opens on the current project's URL (/{projectId}) — bare root
  // when nothing is selected (the onboarding dialog takes over).
  const currentId = getCurrentProjectId()
  const current = currentId ? (listProjects().find((entry) => entry.id === currentId) ?? null) : null
  const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${listenPort}${current && !current.missing ? `/${current.id}` : ""}`

  const shutdown = () => {
    disposeSdkWatch?.()
    for (const preview of previewManager.previews.values()) {
      if (preview.proc && preview.proc.exitCode === null) preview.proc.kill()
    }
    terminals.closeAll()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 800).unref()
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)

  return { url, port: listenPort, host, server, previews: previewManager.listPreviews, close: shutdown, dev: Boolean(dev) }
}
