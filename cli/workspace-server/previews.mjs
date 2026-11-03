import { spawn } from "node:child_process"
import { probePort } from "../port.mjs"
import { getCurrentProjectId, listProjects, setCurrentProject, touchProject } from "../workspace.mjs"
import { BIN, MAX_LOG_LINES } from "./paths.mjs"

/**
 * The preview lifecycle: spawns, tracks and stops the per-project
 * `selldoes dev` children the shell proxies to. All state (live previews and
 * in-flight spawns) is scoped to one manager instance.
 */
export function createPreviewManager({ host, log = () => {} } = {}) {
  const previews = new Map() // id → preview record
  const spawning = new Map() // project.id → in-flight spawn promise
  let previewSeq = 0

  async function findFreePort(host, start = 4591, end = 4640) {
    for (let port = start; port <= end; port++) {
      if (await probePort(port, host)) return port
    }
    throw new Error(`No free port between ${start} and ${end}`)
  }

  function findPreview(id) {
    return previews.get(String(id)) ?? null
  }

  /** The alive preview backing the shell's current workspace, if any. */
  function currentPreviewRecord() {
    const currentId = getCurrentProjectId()
    if (!currentId) return null
    return (
      [...previews.values()].find(
        (preview) => preview.projectId === currentId && preview.proc && preview.proc.exitCode === null,
      ) ?? null
    )
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
    const existing = [...previews.values()].find(
      (preview) => preview.projectId === project.id && preview.proc && preview.proc.exitCode === null,
    )
    if (existing) stopPreview(existing.id)
    const preview = await startPreview(project)
    setCurrentProject(project.id)
    return waitForPreview(preview)
  }

  /**
   * SDK-dev auto-reload: when the SDK's own server sources change, every live
   * preview runs a stale copy of `cli/**` (children load it at spawn time).
   * Restart them in place — the shell URL, ports and selection stay put.
   * Serialized: rapid save bursts coalesce into one restart per preview.
   */
  let previewRestartChain = Promise.resolve()
  function restartLivePreviews(reason) {
    previewRestartChain = previewRestartChain.then(async () => {
      const alive = [...previews.values()].filter((preview) => preview.proc && preview.proc.exitCode === null)
      if (alive.length === 0) return
      log(`${reason} — restarting ${alive.length} preview(s)`)
      for (const preview of alive) {
        const project = listProjects().find((entry) => entry.id === preview.projectId)
        stopPreview(preview.id)
        if (!project || project.missing) continue
        try {
          await spawnOnce(project)
        } catch (error) {
          log(`preview ${project.slug} restart failed: ${error.message}`)
        }
      }
    })
    return previewRestartChain
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
    const existing = [...previews.values()].find(
      (preview) => preview.projectId === project.id && preview.proc && preview.proc.exitCode === null,
    )
    if (existing) return existing
    if (project.missing) throw new Error(`${project.path} no longer exists`)

    const previewPort = await findFreePort(host)
    const child = spawn(process.execPath, [BIN, "dev", "--dir", project.path, "--port", String(previewPort)], {
      cwd: project.path,
      stdio: ["ignore", "pipe", "pipe"],
      // SELLDOES_PREVIEW tells the dev child the workspace supervises it —
      // preview children skip their own SDK watcher (this server restarts
      // them in place when the SDK's preview code changes).
      env: { ...process.env, SELDOES_NO_UPDATE_CHECK: "1", SELLDOES_PREVIEW: "1" },
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

  return {
    previews,
    findPreview,
    currentPreviewRecord,
    selectProject,
    waitForPreview,
    spawnOnce,
    restartProject,
    restartLivePreviews,
    listPreviews,
    startPreview,
    stopPreview,
  }
}
