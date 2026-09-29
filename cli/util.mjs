import fs from "node:fs"
import path from "node:path"

export function die(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

export function fileExists(file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/** Walks up from `cwd` until a plugin.json is found. */
export function findPluginRoot(cwd = process.cwd()) {
  let dir = path.resolve(cwd)
  for (let depth = 0; depth < 12; depth++) {
    if (fileExists(path.join(dir, "plugin.json"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Parses `selldoes <command> [args] [--flag value]` into a structure.
 * Boolean flags may be used bare (`--zip`) or with a value (`--port 4590`).
 */
export function parseArgs(argv) {
  const [command = "help", ...rest] = argv
  const args = []
  const flags = {}
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (!token.startsWith("--")) {
      args.push(token)
      continue
    }
    const name = token.slice(2)
    const next = rest[i + 1]
    if (next !== undefined && !next.startsWith("-")) {
      flags[name] = next
      i++
    } else {
      flags[name] = true
    }
  }
  return { command, args, flags }
}

export const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
}

export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream"
}

export function openBrowser(url) {
  const platform = process.platform
  const command = platform === "win32" ? `start "" "${url}"` : platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`
  import("node:child_process")
    .then(({ exec }) => exec(command))
    .catch(() => {})
}
