import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * SDK-source watcher for development.
 *
 * Watches the running SDK's own sources (`cli/`, `bin/`, `kit/`) so edits can
 * apply without manual restarts: the workspace server restarts preview
 * children, and the supervisor (`dev-supervisor.mjs`) restarts a whole child
 * process when shell-level sources change.
 *
 * Uses recursive `fs.watch` where the platform supports it (Windows, macOS,
 * Node ≥ 20 on Linux) and falls back to a 1 s mtime poll per root everywhere
 * else (Node 18 on Linux throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM). A
 * watcher error mid-run also demotes that root to polling instead of silently
 * stopping.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Repository root of the SDK that is running (`cli/` → `..`). */
export const SDK_SOURCE_ROOT = path.resolve(HERE, "..")

/** Default watch roots for SDK development. */
export const SDK_WATCH_ROOTS = [
  path.join(SDK_SOURCE_ROOT, "cli"),
  path.join(SDK_SOURCE_ROOT, "bin"),
  path.join(SDK_SOURCE_ROOT, "kit"),
]

const IGNORED_PARTS = new Set(["node_modules", "ui-dist", ".git", ".github"])
const SOURCE_RE = /\.(mjs|js|json|css)$/
const DEBOUNCE_MS = 350
const POLL_INTERVAL_MS = 1000
const SIGNATURE_DEPTH = 10

function isIgnored(relative) {
  if (!relative) return false
  if (relative.includes(".test.")) return true
  return relative.split("/").some((part) => IGNORED_PARTS.has(part))
}

function isSource(relative) {
  return Boolean(relative) && SOURCE_RE.test(relative)
}

/** Normalizes an fs.watch filename to a POSIX-style path relative to the root. */
function normalizeName(filename) {
  return String(filename ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
}

/** `path\0size\0mtime` lines for every watched source under `root`. */
function signatureOf(root, depth = SIGNATURE_DEPTH) {
  const out = []
  const walk = (dir, level, prefix) => {
    if (level > depth) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || IGNORED_PARTS.has(entry.name)) continue
        walk(path.join(dir, entry.name), level + 1, relative)
        continue
      }
      if (!entry.isFile() || isIgnored(relative) || !isSource(relative)) continue
      let stat
      try {
        stat = fs.statSync(path.join(dir, entry.name))
      } catch {
        continue
      }
      out.push(`${relative}\u0000${stat.size}\u0000${Math.round(stat.mtimeMs)}`)
    }
  }
  walk(root, 0, "")
  return out
}

/** Splits a signature entry into `[path, fingerprint]`. */
function entryParts(entry) {
  const separator = entry.indexOf("\u0000")
  return [entry.slice(0, separator), entry.slice(separator)]
}

/**
 * Watches `roots` (default: the running SDK's `cli/`, `bin/` and `kit/`) and
 * calls `onChange(relativePath, root)` for source edits, debounced so a save
 * burst is one call. Returns a dispose function with an `active` flag (false
 * when neither native watching nor polling could start).
 */
export function watchSdkSources(onChange, roots = SDK_WATCH_ROOTS) {
  const pending = new Map() // `${root}\0${file}` → { file, root }
  const watchers = []
  const polledRoots = new Set()
  const lastSignatures = new Map() // root → joined signature
  let timer = null
  let pollTimer = null

  const flush = () => {
    timer = null
    if (pending.size === 0) return
    const batch = [...pending.values()]
    pending.clear()
    for (const { file, root } of batch) onChange(file, root)
  }

  const trigger = (root, filename) => {
    const relative = normalizeName(filename)
    if (!relative || isIgnored(relative) || !isSource(relative)) return
    pending.set(`${root}\u0000${relative}`, { file: relative, root })
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, DEBOUNCE_MS)
  }

  const pollPass = () => {
    for (const root of polledRoots) {
      const next = signatureOf(root)
      const signature = next.join("\n")
      const previous = lastSignatures.get(root) ?? ""
      if (signature === previous) continue
      lastSignatures.set(root, signature)
      const before = new Map((previous ? previous.split("\n") : []).map(entryParts))
      for (const entry of next) {
        const [file, fingerprint] = entryParts(entry)
        if (before.get(file) !== fingerprint) trigger(root, file)
      }
      for (const file of before.keys()) {
        if (!next.some((entry) => entryParts(entry)[0] === file)) trigger(root, file)
      }
    }
  }

  const ensurePolling = (root) => {
    if (polledRoots.has(root)) return
    polledRoots.add(root)
    lastSignatures.set(root, signatureOf(root).join("\n"))
    if (!pollTimer) {
      pollTimer = setInterval(pollPass, POLL_INTERVAL_MS)
      pollTimer.unref?.()
    }
  }

  for (const root of roots) {
    try {
      const watcher = fs.watch(root, { recursive: true }, (_event, filename) => trigger(root, filename))
      watcher.on("error", () => {
        watcher.close()
        const index = watchers.indexOf(watcher)
        if (index >= 0) watchers.splice(index, 1)
        ensurePolling(root)
      })
      watchers.push(watcher)
    } catch {
      // recursive fs.watch is platform-dependent — poll this root instead
      ensurePolling(root)
    }
  }

  return Object.assign(
    () => {
      if (timer) clearTimeout(timer)
      timer = null
      pending.clear()
      for (const watcher of watchers.splice(0)) {
        try {
          watcher.close()
        } catch {
          // already gone
        }
      }
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      polledRoots.clear()
    },
    {
      get active() {
        return watchers.length > 0 || polledRoots.size > 0
      },
    },
  )
}
