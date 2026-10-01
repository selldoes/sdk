import fs from "node:fs"
import { SKIP_DIRS, listProjectFiles } from "./project-files.mjs"

/**
 * One SSE channel per dev server for everything the UI wants to react to:
 * file changes (editor sync), build status (topbar/console) and log lines.
 *
 *   GET /__dev/stream  →  event: hello|files|build|log
 *
 * The workspace shell proxies the preview child byte-for-byte, so this works
 * in both `selldoes` workspace mode and standalone `selldoes dev`.
 */
export function createStream() {
  const clients = new Set()

  const drop = (client) => {
    clients.delete(client)
    try {
      client.res.end()
    } catch {
      // already gone
    }
  }

  const handle = (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    })
    res.write("event: hello\ndata: {}\n\n")
    const client = { res }
    clients.add(client)
    const keepAlive = setInterval(() => {
      try {
        res.write(": ping\n\n")
      } catch {
        drop(client)
      }
    }, 25_000)
    keepAlive.unref?.()
    req.on("close", () => {
      clearInterval(keepAlive)
      clients.delete(client)
    })
  }

  const broadcast = (event, data) => {
    if (clients.size === 0) return
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of [...clients]) {
      try {
        client.res.write(payload)
      } catch {
        drop(client)
      }
    }
  }

  return {
    handle,
    broadcast,
    closeAll() {
      for (const client of [...clients]) drop(client)
    },
    get clientCount() {
      return clients.size
    },
  }
}

function signatureOf(root) {
  return listProjectFiles(root, { depth: 8 }).map((file) => `${file.path}\u0000${file.size}\u0000${Math.round(file.mtimeMs)}`)
}

/**
 * Watches the project for external changes and reports plugin-relative POSIX
 * paths. Uses recursive `fs.watch` where the platform supports it (Windows,
 * macOS, Node ≥ 20 on Linux) and falls back to a 1 s mtime poll everywhere
 * else — Node 18 on Linux throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM.
 */
export function watchProject(root, onPaths) {
  let watcher = null
  let pollTimer = null
  let debounce = null
  const pending = new Set()

  const flush = () => {
    debounce = null
    if (pending.size === 0) return
    const paths = [...pending]
    pending.clear()
    onPaths(paths)
  }

  const report = (filename) => {
    if (filename) {
      const relative = String(filename).replace(/\\/g, "/").replace(/^\/+/, "")
      const skipped = relative.split("/").some((part) => SKIP_DIRS.has(part))
      if (!skipped) pending.add(relative)
    }
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(flush, 120)
  }

  try {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => report(filename))
    watcher.on("error", () => {
      watcher?.close()
      watcher = null
      startPolling()
    })
  } catch {
    watcher = null
  }

  let lastSignature = signatureOf(root).join("\n")

  function startPolling() {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      const next = signatureOf(root)
      const nextSignature = next.join("\n")
      if (nextSignature === lastSignature) return
      const before = new Set(lastSignature ? lastSignature.split("\n") : [])
      const after = new Set(next)
      lastSignature = nextSignature
      const changed = []
      for (const entry of after) if (!before.has(entry)) changed.push(entry.split("\u0000")[0])
      for (const entry of before) if (!after.has(entry)) changed.push(entry.split("\u0000")[0])
      if (changed.length) onPaths([...new Set(changed)])
    }, 1000)
    pollTimer.unref?.()
  }

  if (!watcher) startPolling()

  return {
    close() {
      watcher?.close()
      watcher = null
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      if (debounce) clearTimeout(debounce)
    },
  }
}
