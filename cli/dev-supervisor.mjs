import { spawn as nodeSpawn } from "node:child_process"
import path from "node:path"
import { watchSdkSources } from "./sdk-watch.mjs"

/**
 * Supervises a long-lived `selldoes` child for SDK development.
 *
 * The node process running the CLI caches `cli/**` modules for its lifetime,
 * so SDK edits need a fresh process. This supervisor keeps the parent (and
 * the terminal's Ctrl+C, the shell URL and the browser tab) while spawning
 * the real server as a child over an IPC channel:
 *
 *   - an SDK source change → graceful shutdown message, then respawn with the
 *     new code on the same port (the caller prints what is watched)
 *   - `isChildHandled(file, root)` → the child owns that change (e.g. the
 *     workspace restarts previews itself); the supervisor stays out of it
 *     while the child is alive, but restarts it if it is not
 *   - an unexpected child exit → the supervisor stays, prints a hint, and
 *     restarts on the next change (no crash loops)
 *   - Ctrl+C / SIGTERM → the child is stopped and the supervisor exits
 *
 * `spawnProcess` and `watchSources` are injectable for tests.
 */
export function superviseSdkProcess({
  name,
  scriptPath,
  args,
  env = {},
  isChildHandled = () => false,
  spawnProcess = nodeSpawn,
  watchSources = watchSdkSources,
  log = (line) => console.log(`  ${line}`),
}) {
  let child = null
  let spawnCount = 0
  let stopping = false
  const expectedExits = new WeakSet()
  let restartChain = Promise.resolve()
  let disposeWatch = () => {}

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const alive = (candidate = child) => Boolean(candidate && candidate.exitCode === null && !candidate.killed)

  const stopChild = async (c) => {
    if (!alive(c)) return
    expectedExits.add(c)
    try {
      c.send?.({ type: "shutdown" })
    } catch {
      // IPC channel gone — the kill below is the fallback
    }
    const gracefulDeadline = Date.now() + 2500
    while (alive(c) && Date.now() < gracefulDeadline) await delay(50)
    if (!alive(c)) return
    try {
      c.kill()
    } catch {
      // raced with the exit
    }
    const hardDeadline = Date.now() + 1500
    while (alive(c) && Date.now() < hardDeadline) await delay(50)
  }

  const spawnChild = () => {
    if (alive()) return child
    spawnCount += 1
    const suppressOpen = spawnCount > 1
    let spawned
    try {
      spawned = spawnProcess(process.execPath, [scriptPath, ...args], {
        stdio: ["inherit", "inherit", "inherit", "ipc"],
        env: {
          ...process.env,
          ...env,
          // A restart must not pop another browser tab.
          ...(suppressOpen ? { DEV_OPEN_SUPPRESS: "1" } : {}),
        },
        windowsHide: true,
      })
    } catch (error) {
      log(`${name} could not start: ${error.message}`)
      return null
    }
    child = spawned
    spawned.on?.("error", (error) => {
      log(`${name} spawn error: ${error.message}`)
      if (child === spawned) child = null
    })
    spawned.on?.("exit", (code, signal) => {
      if (child === spawned) child = null
      if (stopping || expectedExits.has(spawned)) return
      const detail = signal ? `signal ${signal}` : `code ${code}`
      log(`${name} exited (${detail}) — save any SDK source file to restart it`)
    })
    return spawned
  }

  const restart = (reason) => {
    restartChain = restartChain
      .then(async () => {
        if (stopping) return
        if (!alive()) {
          log(`${reason} — starting ${name}`)
          spawnChild()
          return
        }
        log(`${reason} — restarting ${name}`)
        await stopChild(child)
        if (stopping) return
        await delay(25)
        if (!alive()) spawnChild()
      })
      .catch((error) => log(`${name} restart failed: ${error.message}`))
    return restartChain
  }

  let finish
  const done = new Promise((resolve) => {
    finish = resolve
  })

  const onSignal = () => shutdown()
  const shutdown = () => {
    if (stopping) return
    stopping = true
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)
    disposeWatch()
    const stoppingChild = alive() ? stopChild(child) : Promise.resolve()
    void stoppingChild.then(() => finish())
    // Safety net: never hang the terminal on a wedged child.
    setTimeout(() => finish(), 5000).unref?.()
  }

  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  disposeWatch = watchSources((file, root) => {
    if (stopping) return
    if (alive() && isChildHandled(file, root)) return
    void restart(`SDK code changed (${path.basename(root)}/${file})`)
  })

  spawnChild()

  done.stop = shutdown
  return done
}

/** Supervises `workspace --dev` (SDK dev mode): shell edits restart the workspace child. */
export function runWorkspaceSupervisor({ port }) {
  return superviseSdkProcess({
    name: "workspace",
    scriptPath: process.argv[1],
    args: ["workspace", "--dev", "--port", String(port)],
    env: { SELLDOES_WORKSPACE_CHILD: "1", SELDOES_NO_UPDATE_CHECK: "1" },
    // The child restarts live previews for plugin/kit edits itself; anything
    // outside those roots (shell routes, CLI core, bin) needs a fresh process.
    isChildHandled: (file, root) => file.startsWith("plugin/") || path.basename(root) === "kit",
  })
}

/** Supervises a standalone `dev` preview server: any SDK edit restarts it. */
export function runPreviewSupervisor({ pluginDir, port, host, open = false }) {
  const args = ["dev", "--dir", pluginDir]
  if (port) args.push("--port", String(port))
  if (host) args.push("--host", String(host))
  if (open) args.push("--open")
  return superviseSdkProcess({
    name: "dev server",
    scriptPath: process.argv[1],
    args,
    env: { SELLDOES_DEV_CHILD: "1", SELDOES_NO_UPDATE_CHECK: "1" },
  })
}
