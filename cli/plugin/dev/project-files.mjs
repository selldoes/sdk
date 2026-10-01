import fs from "node:fs"
import path from "node:path"

/**
 * Shared file rules for the assistant, the file API and project search.
 *
 * Paths are always plugin-relative, POSIX-separated ("ui/src/index.tsx").
 * Everything that touches the filesystem goes through `guardPath`, which
 * rejects traversal, absolute paths, skipped folders and symlink escapes.
 */

export const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".github", ".selldoes-dev", "coverage"])

export const TEXT_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".css",
  ".html",
  ".md",
  ".txt",
  ".svg",
  ".yml",
  ".yaml",
  ".toml",
])

/** Editor-only allowlist (a superset of what the assistant may write). */
export const EDITABLE_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".html",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
])

/** Dotfiles that are useful to show even though they start with a dot. */
export const SPECIAL_TEXT_FILES = new Set([
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".env.example",
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  ".prettierignore",
  ".eslintrc",
  ".babelrc",
])

export const MAX_FILE_BYTES = 400_000
export const MAX_EDIT_BYTES = 1_500_000
export const MAX_SEARCH_BYTES = 400_000

export function toPosix(value) {
  return String(value).replace(/\\/g, "/")
}

/** Normalizes a plugin-relative path; throws when it escapes the project. */
export function normalizeRelative(value) {
  let posix = toPosix(value ?? "").trim()
  if (!posix || posix === ".") return ""
  if (/^[a-zA-Z]:/.test(posix) || posix.startsWith("/")) {
    throw new Error("Path must be relative to the project")
  }
  posix = posix.replace(/^\.\/+/, "").replace(/\/+/g, "/").replace(/\/+$/, "")
  const parts = posix.split("/")
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("Path escapes the project")
  }
  return posix
}

export function isSkipped(relative) {
  return normalizeRelative(relative)
    .split("/")
    .some((part) => SKIP_DIRS.has(part) || (part.startsWith(".") && !SPECIAL_TEXT_FILES.has(part)))
}

export function isTextName(name) {
  const base = path.basename(String(name ?? ""))
  if (SPECIAL_TEXT_FILES.has(base)) return true
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase())
}

export function isEditableName(name) {
  const base = path.basename(String(name ?? ""))
  if (SPECIAL_TEXT_FILES.has(base)) return true
  return EDITABLE_EXTENSIONS.has(path.extname(base).toLowerCase())
}

/**
 * Resolves `relative` inside `root` and proves containment, including through
 * symlinks: the nearest existing ancestor is realpath'd and must stay inside
 * the real project root.
 */
export function guardPath(root, relative) {
  const resolvedRoot = path.resolve(root)
  const normalized = normalizeRelative(relative)
  const candidate = path.resolve(resolvedRoot, normalized)
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Path escapes the project")
  }
  if (normalized && isSkipped(normalized)) {
    throw new Error("That folder is not editable in the preview")
  }
  let probe = candidate
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  try {
    const real = fs.realpathSync(probe)
    const realRoot = fs.realpathSync(resolvedRoot)
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new Error("Path escapes the project")
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("escapes the project")) throw error
    // unreadable ancestor — treat as contained; later fs calls will surface it
  }
  return candidate
}

/**
 * Lists text files under `root` (plugin-relative POSIX paths, sorted).
 * Directories are derived from the files, so empty ones don't show up.
 */
export function listProjectFiles(root, { depth = 6 } = {}) {
  const out = []
  const visit = (dir, relative, level) => {
    if (level > depth) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue
        visit(path.join(dir, entry.name), rel, level + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.startsWith(".") && !SPECIAL_TEXT_FILES.has(entry.name)) continue
      if (!isTextName(entry.name)) continue
      let size = 0
      let mtimeMs = 0
      try {
        const stat = fs.statSync(path.join(dir, entry.name))
        size = stat.size
        mtimeMs = stat.mtimeMs
      } catch {
        continue
      }
      out.push({ path: rel, type: "file", size, mtimeMs })
    }
  }
  visit(root, "", 0)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** Flat tree payload for the editor (files + the directories they live in). */
export function projectTree(root, options) {
  const files = listProjectFiles(root, options)
  const dirs = new Set()
  for (const file of files) {
    const parts = file.path.split("/")
    for (let index = 1; index < parts.length; index += 1) dirs.add(parts.slice(0, index).join("/"))
  }
  return {
    root: path.basename(path.resolve(root)),
    entries: [...dirs].sort().map((dir) => ({ path: dir, type: "dir" })).concat(files),
  }
}

export function readTextFile(root, relative, { maxBytes = MAX_EDIT_BYTES } = {}) {
  const full = guardPath(root, relative)
  let stat
  try {
    stat = fs.statSync(full)
  } catch {
    throw new Error(`File not found: ${normalizeRelative(relative) || "project root"}`)
  }
  if (!stat.isFile()) throw new Error("Not a file")
  if (stat.size > maxBytes) {
    throw new Error(`File is too large to open here (${Math.round(stat.size / 1024)} KB)`)
  }
  const buffer = fs.readFileSync(full)
  if (buffer.includes(0)) throw new Error("Binary files can't be edited in the preview")
  return {
    path: normalizeRelative(relative),
    content: buffer.toString("utf8"),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}

export function writeTextFile(root, relative, content) {
  const normalized = normalizeRelative(relative)
  if (!normalized) throw new Error("A file path is required")
  if (!isEditableName(normalized)) throw new Error("Only text files can be edited in the preview")
  if (typeof content !== "string") throw new Error("Missing file content")
  const bytes = Buffer.byteLength(content, "utf8")
  if (bytes > MAX_EDIT_BYTES) throw new Error(`File is too large (${Math.round(bytes / 1024)} KB)`)
  const full = guardPath(root, normalized)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
  return { path: normalized, size: bytes, mtimeMs: fs.statSync(full).mtimeMs }
}

/** Searches project text files. Returns bounded hits for the search palette. */
export function searchProject(root, { query, caseSensitive = false, regex = false, maxHits = 200 } = {}) {
  const needle = String(query ?? "")
  if (!needle) return { hits: [], files: 0, truncated: false }
  let pattern
  try {
    pattern = new RegExp(regex ? needle : needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi")
  } catch {
    throw new Error("Invalid search pattern")
  }
  const hits = []
  let files = 0
  let truncated = false
  for (const file of listProjectFiles(root, { depth: 8 })) {
    if (file.size > MAX_SEARCH_BYTES) continue
    let content
    try {
      const buffer = fs.readFileSync(guardPath(root, file.path))
      if (buffer.includes(0)) continue
      content = buffer.toString("utf8")
    } catch {
      continue
    }
    files += 1
    const lines = content.split("\n")
    for (let index = 0; index < lines.length; index += 1) {
      pattern.lastIndex = 0
      if (!pattern.test(lines[index])) continue
      const column = Math.max(0, lines[index].search(pattern)) + 1
      hits.push({
        path: file.path,
        line: index + 1,
        column,
        preview: lines[index].trim().slice(0, 200),
      })
      if (hits.length >= maxHits) {
        truncated = true
        return { hits, files, truncated }
      }
    }
  }
  return { hits, files, truncated }
}
