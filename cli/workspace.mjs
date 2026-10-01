import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"

/**
 * The workspace registry: which plugin/theme projects this developer has been
 * working on, stored per machine (not per project) so the CLI can be run from
 * anywhere — the SDK is the workspace, plugin folders are just referenced by
 * path.
 *
 * File: ~/.selldoes/workspace.json
 * {
 *   "version": 1,
 *   "projects": [
 *     { "id": "…", "kind": "plugin", "name": "OTRCat Scraper", "slug": "otrcat-scraper",
 *       "path": "C:/…/plugins/otrcat-scraper", "source": "folder",
 *       "createdAt": "…", "lastOpenedAt": "…" }
 *   ]
 * }
 */

const MAX_PROJECTS = 50

export function workspaceDir() {
  return path.join(os.homedir(), ".selldoes")
}

export function workspaceFile() {
  return path.join(workspaceDir(), "workspace.json")
}

const EMPTY = { version: 1, projects: [] }

/** Normalizes a path so the same folder never appears twice. */
export function normalizePath(target) {
  const resolved = path.resolve(String(target))
  return process.platform === "win32" ? resolved.replace(/\\/g, "/") : resolved
}

function readManifest(dir, kind) {
  const manifestPath = path.join(dir, kind === "theme" ? "manifest.json" : "plugin.json")
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  } catch {
    return null
  }
}

/** Detects project kind by marker file. Returns "plugin" | "theme" | null. */
export function detectKind(dir) {
  if (fs.existsSync(path.join(dir, "plugin.json"))) return "plugin"
  if (fs.existsSync(path.join(dir, "manifest.json"))) return "theme"
  return null
}

/** Human metadata for a project dir (best effort — manifest may be absent). */
export function projectMeta(dir, kind) {
  const manifest = readManifest(dir, kind) ?? {}
  const base = path.basename(normalizePath(dir))
  if (kind === "theme") {
    return { name: String(manifest.name ?? base), slug: base }
  }
  return { name: String(manifest.name ?? base), slug: String(manifest.slug ?? base) }
}

export function loadWorkspace() {
  try {
    const stored = JSON.parse(fs.readFileSync(workspaceFile(), "utf8"))
    return {
      version: 1,
      projects: (Array.isArray(stored.projects) ? stored.projects : []).map((project) => {
        const clean = { ...project }
        delete clean.missing // runtime-only flag, never persisted
        return clean
      }),
    }
  } catch {
    return JSON.parse(JSON.stringify(EMPTY))
  }
}

function saveWorkspace(data) {
  fs.mkdirSync(workspaceDir(), { recursive: true })
  fs.writeFileSync(workspaceFile(), `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

/** Stable id from the normalized path — re-importing the same folder dedupes. */
function idFor(normalizedPath) {
  return crypto.createHash("sha1").update(normalizedPath).digest("hex").slice(0, 12)
}

/**
 * Registers (or refreshes) a project in the workspace.
 * `source` records how it got here: folder | zip | create | account.
 */
export function touchProject({ dir, kind, source = "folder", name, slug }) {
  const normalized = normalizePath(dir)
  const detected = kind ?? detectKind(normalized)
  if (!detected) throw new Error(`No plugin.json or manifest.json in ${normalized}`)
  const meta = projectMeta(normalized, detected)
  const data = loadWorkspace()
  const now = new Date().toISOString()
  const existing = data.projects.find((project) => project.path === normalized)
  if (existing) {
    existing.kind = detected
    existing.name = name ?? meta.name
    existing.slug = slug ?? meta.slug
    existing.lastOpenedAt = now
    if (source && source !== "folder") existing.source = source
  } else {
    data.projects.push({
      id: idFor(normalized),
      kind: detected,
      name: name ?? meta.name,
      slug: slug ?? meta.slug,
      path: normalized,
      source,
      createdAt: now,
      lastOpenedAt: now,
    })
  }
  // Keep the newest MAX_PROJECTS entries.
  data.projects.sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))
  if (data.projects.length > MAX_PROJECTS) data.projects = data.projects.slice(0, MAX_PROJECTS)
  saveWorkspace(data)
  return data.projects.find((project) => project.path === normalized)
}

/** Lists projects, newest first. `missing` flags paths that no longer exist. */
export function listProjects() {
  return loadWorkspace()
    .projects.map((project) => ({
      ...project,
      missing: !fs.existsSync(project.path),
    }))
    .sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))
}

export function getProject(id) {
  return listProjects().find((project) => project.id === id) ?? null
}

/** Removes a project from the list. Never touches files on disk. */
export function removeProject(id) {
  const data = loadWorkspace()
  const before = data.projects.length
  data.projects = data.projects.filter((project) => project.id !== id)
  saveWorkspace(data)
  return data.projects.length < before
}

/** Formats a timestamp for launcher hints ("2 hours ago"). */
export function relativeTime(iso) {
  if (!iso) return "never"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "never"
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(then).toISOString().slice(0, 10)
}
