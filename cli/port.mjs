import net from "node:net"
import { execFile } from "node:child_process"

/**
 * Port reclamation for the workspace server.
 *
 * A hard Ctrl+C (or a supervisor that only kills the shell it spawned) can
 * leave the previous workspace node process listening on the port. The next
 * `selldoes` / `npm run dev` then dies with EADDRINUSE — and a process
 * supervisor crash-loops on it. Before listening we stop a stale SDK process
 * that still holds the port; when the listener is some other app we fail with
 * a clear message instead of killing it.
 */

const PROBE_TIMEOUT_MS = 1500
const FREE_TIMEOUT_MS = 5000
const TERM_GRACE_MS = 1500

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      resolve(error && !stdout ? "" : String(stdout ?? ""))
    })
  })
}

/** Resolves true when nothing is listening on host:port. */
export function probePort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once("error", () => resolve(false))
    probe.once("listening", () => probe.close(() => resolve(true)))
    probe.listen(port, host)
  })
}

/** PIDs with a TCP socket in LISTEN state on `port`. */
export async function listenerPids(port) {
  if (process.platform === "win32") {
    const out = await run("netstat", ["-ano", "-p", "TCP"])
    const pids = new Set()
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5 || parts[0].toUpperCase() !== "TCP") continue
      if (parts[3].toUpperCase() !== "LISTENING") continue
      const local = /:(\d+)$/.exec(parts[1])
      if (local && Number(local[1]) === Number(port)) pids.add(Number(parts[4]))
    }
    return [...pids].filter((pid) => Number.isInteger(pid) && pid > 0)
  }
  const out = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))].filter((pid) => Number.isInteger(pid) && pid > 0)
}

/** Host to probe: a wildcard bind is reachable on loopback. */
function probeHost(host) {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host
}

/** True when `port` answers like this SDK's workspace shell (GET /__ws/projects). */
async function answersAsWorkspace(port, host) {
  try {
    const res = await fetch(`http://${probeHost(host)}:${port}/__ws/projects`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!res.ok) return false
    const data = await res.json().catch(() => null)
    return Array.isArray(data?.projects)
  } catch {
    return false
  }
}

/** PID → command line for the given PIDs ("" when the lookup tool is missing). */
async function commandLines(pids) {
  const map = new Map()
  if (pids.length === 0) return map
  if (process.platform === "win32") {
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(" or ")
    const out = await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { "$($_.ProcessId)\t$($_.CommandLine)" }`,
    ])
    for (const line of out.split(/\r?\n/)) {
      const tab = line.indexOf("\t")
      if (tab <= 0) continue
      const pid = Number(line.slice(0, tab).trim())
      if (Number.isInteger(pid)) map.set(pid, line.slice(tab + 1))
    }
    return map
  }
  const out = await run("ps", ["-o", "pid=,args=", "-p", pids.join(",")])
  for (const line of out.split(/\r?\n/)) {
    const row = line.trim()
    const space = row.indexOf(" ")
    if (space <= 0) continue
    const pid = Number(row.slice(0, space))
    if (Number.isInteger(pid)) map.set(pid, row.slice(space + 1))
  }
  return map
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "EPERM"
  }
}

/** Stops the given PIDs; on Windows this is a forced tree kill. */
async function stopPids(pids) {
  if (pids.length === 0) return
  if (process.platform === "win32") {
    for (const pid of pids) await run("taskkill", ["/PID", String(pid), "/F", "/T"])
    return
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + TERM_GRACE_MS
  while (Date.now() < deadline && pids.some(alive)) await sleep(100)
  for (const pid of pids) {
    if (!alive(pid)) continue
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // raced with the exit
    }
  }
}

/**
 * True when a command line invokes the SDK CLI (e.g. `node bin/selldoes.mjs
 * workspace`, or a global `selldoes` shim). The lookahead matters on machines
 * whose user folder is itself named "Selldoes": `C:\Users\Selldoes\…` must not
 * match, while `…\bin\selldoes.mjs` and a standalone `selldoes` token must.
 */
function looksLikeSelldoesCli(command) {
  return /selldoes(?:\.mjs)?(?=["'\s]|$)/i.test(command)
}

/**
 * Makes `host:port` listenable: a free port passes straight through; a stale
 * Selldoes workspace (or any process whose command line invokes the CLI) is
 * stopped; anything else throws with a message that points at `--port`.
 */
export async function reclaimPort(port, host = "127.0.0.1", log = (line) => console.log(`  ${line}`)) {
  if (await probePort(port, host)) return { reclaimed: false, killed: [] }

  const pids = await listenerPids(port)
  const isWorkspace = await answersAsWorkspace(port, host)
  let owned = pids
  if (!isWorkspace) {
    const lines = await commandLines(pids)
    owned = pids.filter((pid) => looksLikeSelldoesCli(lines.get(pid) ?? ""))
  }

  if (owned.length === 0) {
    const who = pids.length > 0 ? ` (pid ${pids.join(", ")})` : ""
    throw new Error(`Port ${port} is already in use${who} by another app — stop it, or start with --port <n>`)
  }

  await stopPids(owned)
  log(`port ${port} was busy — stopped the previous ${isWorkspace ? "workspace" : "Selldoes"} process (pid ${owned.join(", ")})`)

  const deadline = Date.now() + FREE_TIMEOUT_MS
  while (!(await probePort(port, host))) {
    if (Date.now() > deadline) throw new Error(`Port ${port} is still in use after stopping pid ${owned.join(", ")}`)
    await sleep(150)
  }
  return { reclaimed: true, killed: owned }
}
