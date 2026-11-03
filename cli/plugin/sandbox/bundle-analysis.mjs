import path from "node:path"
import { BLOCKED, BUILTINS } from "./node-builtins.mjs"

const NODE_MODULES = /(?:^|[/\\])node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)(?=[/\\]|$)/

function normalizePackage(name) {
  return String(name).replace(/\\/g, "/")
}

/** Every dependency (direct or transitive) that ended up inside the bundle. */
export function collectBundledPackages(metafile) {
  const packages = new Set()
  for (const file of Object.keys(metafile?.inputs ?? {})) {
    const match = NODE_MODULES.exec(file)
    if (match) packages.add(normalizePackage(match[1]))
  }
  return [...packages].sort()
}

/** Packages the plugin's own source imports (not transitive dependencies). */
export function collectImportedPackages(metafile) {
  const packages = new Set()
  for (const [file, info] of Object.entries(metafile?.inputs ?? {})) {
    // Only the plugin's own files count: SDK-injected files live outside the
    // plugin dir (relative keys start with "..") and their imports are ours.
    if (path.isAbsolute(file) || file.startsWith("..") || NODE_MODULES.test(file)) continue
    for (const imported of info.imports ?? []) {
      if (imported.external) continue
      const match = NODE_MODULES.exec(imported.path ?? "")
      if (match) packages.add(normalizePackage(match[1]))
    }
  }
  return [...packages].sort()
}

/** Imports that stayed external — the sandbox has no `require()`, so these fail. */
export function collectExternals(metafile) {
  const externals = new Set()
  for (const info of Object.values(metafile?.inputs ?? {})) {
    for (const imported of info.imports ?? []) {
      if (!imported.external) continue
      const target = String(imported.path ?? "")
      // Injected shims resolve to absolute or relative file paths — not leaks.
      if (path.isAbsolute(target) || target.startsWith(".")) continue
      externals.add(target)
    }
  }
  return [...externals].sort()
}

/**
 * npm packages left external in a Node artifact (the image installs them from
 * package.json). Relative paths and Node builtins are skipped.
 *
 * By default SDK-injected files (`selldoes/job`, `selldoes/node`) are skipped:
 * their optional peers resolve from the plugin's own node_modules at runtime
 * and the helper fails with an actionable message when one is missing, so a
 * package the helper *could* use should not be reported as an undeclared
 * import. Pass `{ includeSdk: true }` to count them anyway (used to tell which
 * declared dependencies only a Node entry needs).
 */
export function collectExternalPackages(metafile, { includeSdk = false } = {}) {
  const packages = new Set()
  for (const [file, info] of Object.entries(metafile?.inputs ?? {})) {
    if (!includeSdk && (path.isAbsolute(file) || file.startsWith("..") || NODE_MODULES.test(file))) continue
    for (const imported of info.imports ?? []) {
      if (!imported.external) continue
      const target = String(imported.path ?? "")
      if (target.startsWith(".") || path.isAbsolute(target)) continue
      const bare = target.replace(/^node:/, "")
      if (BUILTINS.has(bare) || BLOCKED.has(bare)) continue
      const name = bare.startsWith("@") ? bare.split("/").slice(0, 2).join("/") : bare.split("/")[0]
      if (name) packages.add(name)
    }
  }
  return [...packages].sort()
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
