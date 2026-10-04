import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { execFile } from "node:child_process"
import { resolveAsset } from "./plugin/dev/assets.mjs"
import { applyUserSettingsPatch, loadUserSettings } from "./user-settings.mjs"

/**
 * The workspace registry: which plugin/theme projects this developer has been
 * working on, stored per machine (not per project) so the CLI can be run from
 * anywhere — the SDK is the workspace, plugin folders are just referenced by
 * path.
 *
 * File: ~/.selldoes/workspace.json
 * {
 *   "version": 2,
 *   "projects": [
 *     { "id": "Xk9Qm2ZpL7A", "kind": "plugin", "name": "OTRCat Scraper", "slug": "otrcat-scraper",
 *       "path": "C:/…/plugins/otrcat-scraper", "source": "folder",
 *       "createdAt": "…", "lastOpenedAt": "…" }
 *   ]
 * }
 *
 * Project ids are YouTube-style: 11 random base64url chars (A–Z a–z 0–9 - _),
 * URL-safe and opaque — they lead every dev-shell URL (/{id}/settings).
 */

const MAX_PROJECTS = 50

/** Accent colors the dev shell can store per project (cosmetic only). */
export const PROJECT_COLORS = new Set(["orange", "violet", "sky", "emerald", "rose", "amber"])

export function workspaceDir() {
  return path.join(os.homedir(), ".selldoes")
}

export function workspaceFile() {
  return path.join(workspaceDir(), "workspace.json")
}

/**
 * Where new projects land by default: `~/Documents/Selldoes` when a Documents
 * folder exists (Windows/macOS/Linux desktops), else `~/Selldoes`. This is only
 * the fallback — a `defaultDir` saved in the workspace wins. The registry file
 * itself stays at ~/.selldoes/workspace.json.
 */
export function defaultProjectsDir() {
  const home = os.homedir()
  try {
    const documents = path.join(home, "Documents")
    if (fs.existsSync(documents) && fs.statSync(documents).isDirectory()) {
      return path.join(documents, "Selldoes")
    }
  } catch {
    // fall through to the home-folder default
  }
  return path.join(home, "Selldoes")
}

const EMPTY = { version: 2, projects: [], currentId: null, defaultDir: null }

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
  const icon = typeof manifest.icon === "string" && manifest.icon ? manifest.icon : undefined
  const iconUrl = typeof manifest.iconUrl === "string" && manifest.iconUrl ? manifest.iconUrl : undefined
  const version = typeof manifest.version === "string" && manifest.version ? manifest.version : undefined
  if (kind === "theme") {
    return { name: String(manifest.name ?? base), slug: base, icon, iconUrl, version }
  }
  return { name: String(manifest.name ?? base), slug: String(manifest.slug ?? base), icon, iconUrl, version }
}

export function loadWorkspace() {
  try {
    const stored = JSON.parse(fs.readFileSync(workspaceFile(), "utf8"))
    const data = {
      version: 2,
      currentId: typeof stored.currentId === "string" ? stored.currentId : null,
      defaultDir: typeof stored.defaultDir === "string" && stored.defaultDir ? stored.defaultDir : null,
      projects: (Array.isArray(stored.projects) ? stored.projects : []).map((project) => {
        const clean = { ...project }
        delete clean.missing // runtime-only flag, never persisted
        return clean
      }),
    }
    // v1 → v2: legacy 12-hex ids ("79fefc289e48") become YouTube-style ids
    // ("Xk9Qm2ZpL7A") — regenerated once and persisted, currentId remapped.
    if (Number(stored.version ?? 1) < 2 && data.projects.some((project) => typeof project.id === "string" && !NEW_ID.test(project.id))) {
      const remap = new Map()
      for (const project of data.projects) {
        if (typeof project.id === "string" && !NEW_ID.test(project.id)) {
          const next = newProjectId()
          remap.set(project.id, next)
          project.id = next
        }
      }
      if (data.currentId && remap.has(data.currentId)) data.currentId = remap.get(data.currentId)
      saveWorkspace(data)
    }
    return data
  } catch {
    return JSON.parse(JSON.stringify(EMPTY))
  }
}

function saveWorkspace(data) {
  fs.mkdirSync(workspaceDir(), { recursive: true })
  fs.writeFileSync(workspaceFile(), `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

// ── Project ids (YouTube-style) ─────────────────────────────────────────────
// YouTube video ids are 11 characters of base64url (A–Z a–z 0–9 - _): URL
// safe, case-sensitive, randomly generated and opaque — not derived from the
// content they name. We copy the format: 11 crypto-random chars ≈ 66 bits of
// entropy, ~64^11 possibilities.

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
const ID_LENGTH = 11
/** Ids in this format (checked by loadWorkspace to find legacy hex ids). */
const NEW_ID = new RegExp(`^[A-Za-z0-9_-]{${ID_LENGTH}}$`)

/** A fresh YouTube-style project id. `byte % 64` is bias-free (256 % 64 === 0). */
function newProjectId() {
  const bytes = crypto.randomBytes(ID_LENGTH)
  let id = ""
  for (let i = 0; i < ID_LENGTH; i += 1) id += ID_ALPHABET[bytes[i] % 64]
  return id
}

/**
 * The internal id a project's URLs carry (/{id}/page). Stable for a folder:
 * registered projects keep their id, unregistered ones are registered
 * (without stealing the shell's current selection) so the URL survives
 * restarts.
 */
export function projectIdFor(dir) {
  const normalized = normalizePath(dir)
  const existing = loadWorkspace().projects.find((project) => project.path === normalized)
  if (existing) return existing.id
  try {
    return touchProject({ dir: normalized, source: "folder", select: false }).id
  } catch {
    // Not a plugin folder (yet) — still give the URL an id.
    return newProjectId()
  }
}

/**
 * Registers (or refreshes) a project in the workspace.
 * `source` records how it got here: folder | zip | create | account.
 * `select` (default true) makes it the shell's current workspace — pass
 * false to register without switching to it.
 */
export function touchProject({ dir, kind, source = "folder", name, slug, color, select = true }) {
  const normalized = normalizePath(dir)
  const detected = kind ?? detectKind(normalized)
  if (!detected) throw new Error(`No plugin.json or manifest.json in ${normalized}`)
  const meta = projectMeta(normalized, detected)
  const data = loadWorkspace()
  const now = new Date().toISOString()
  const existing = data.projects.find((project) => project.path === normalized)
  const cleanColor = PROJECT_COLORS.has(String(color)) ? String(color) : null
  let id
  if (existing) {
    id = existing.id
    existing.kind = detected
    existing.name = name ?? meta.name
    existing.slug = slug ?? meta.slug
    // Keep the registry in sync with the manifest — including removals.
    if (meta.icon) existing.icon = meta.icon
    else delete existing.icon
    if (meta.iconUrl) existing.iconUrl = meta.iconUrl
    else delete existing.iconUrl
    if (meta.version) existing.version = meta.version
    else delete existing.version
    existing.lastOpenedAt = now
    if (source && source !== "folder") existing.source = source
    if (cleanColor) existing.color = cleanColor
  } else {
    id = newProjectId()
    data.projects.push({
      id,
      kind: detected,
      name: name ?? meta.name,
      slug: slug ?? meta.slug,
      ...(meta.icon ? { icon: meta.icon } : {}),
      ...(meta.iconUrl ? { iconUrl: meta.iconUrl } : {}),
      ...(meta.version ? { version: meta.version } : {}),
      path: normalized,
      source,
      createdAt: now,
      lastOpenedAt: now,
      ...(cleanColor ? { color: cleanColor } : {}),
    })
  }
  // Last opened/selected = the shell's current workspace (unless the caller
  // only registers — e.g. projectIdFor pinning an id for the URL).
  if (select) data.currentId = id
  // Keep the newest MAX_PROJECTS entries.
  data.projects.sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))
  if (data.projects.length > MAX_PROJECTS) data.projects = data.projects.slice(0, MAX_PROJECTS)
  saveWorkspace(data)
  return data.projects.find((project) => project.path === normalized)
}

/** The workspace the web shell should show, or null when nothing is selected. */
export function getCurrentProjectId() {
  const data = loadWorkspace()
  if (!data.currentId) return null
  return data.projects.some((project) => project.id === data.currentId) ? data.currentId : null
}

/** Selects the shell's current workspace (used by /__ws/select). */
export function setCurrentProject(id) {
  const data = loadWorkspace()
  const project = data.projects.find((entry) => entry.id === String(id))
  if (!project) return null
  data.currentId = project.id
  saveWorkspace(data)
  return project
}

/** Clears the selection without touching any project (used when nothing is previewable). */
export function clearCurrentProject() {
  const data = loadWorkspace()
  data.currentId = null
  saveWorkspace(data)
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

/**
 * Absolute path to a project's uploaded icon, or null when the manifest has no
 * local `iconUrl`. Used by the workspace server to serve `/__ws/project-icon/:id`.
 */
export function projectIconFile(project) {
  const value = String(project?.iconUrl ?? "").trim()
  if (!value || /^(https?:)?\/\//.test(value) || value.startsWith("data:")) return null
  return resolveAsset(project.path, value.replace(/^\.\//, ""))
}

/** Removes a project from the list. Never touches files on disk. */
export function removeProject(id) {
  const data = loadWorkspace()
  const before = data.projects.length
  data.projects = data.projects.filter((project) => project.id !== id)
  if (data.currentId === id) data.currentId = data.projects[0]?.id ?? null
  saveWorkspace(data)
  return data.projects.length < before
}

/**
 * Sets (or clears, with null) a project's accent color — the cosmetic tile
 * color the sidebar switcher and Settings page show.
 */
export function setProjectColor(id, color) {
  const data = loadWorkspace()
  const project = data.projects.find((entry) => entry.id === String(id))
  if (!project) return null
  project.color = PROJECT_COLORS.has(String(color)) ? String(color) : null
  saveWorkspace(data)
  return project
}

/**
 * Deletes a project's folder from disk, then unregisters it. Never runs
 * without a prior caller-side confirmation; refuses to touch a path that is
 * not registered in the workspace. When the folder is already gone it only
 * unregisters (reported via `existed: false`).
 */
export function deleteProjectFiles(id) {
  const data = loadWorkspace()
  const project = data.projects.find((entry) => entry.id === String(id))
  if (!project) throw new Error("Project not found in the workspace")
  const dir = normalizePath(project.path)
  const existed = fs.existsSync(dir)
  if (existed) {
    try {
      fs.rmSync(dir, { recursive: true, force: false })
    } catch (error) {
      throw new Error(`Could not delete ${dir}: ${error.message}`)
    }
    if (fs.existsSync(dir)) {
      throw new Error(`Could not fully delete ${dir} — close any program using it (editor, terminal, watcher) and try again`)
    }
  }
  removeProject(project.id)
  return { id: project.id, slug: project.slug, path: dir, existed }
}

/**
 * Best-effort git probe for destructive-action guards: `{ repo, dirty }`.
 * Answers `{ repo: false }` when git is missing or the folder is not a repo —
 * never throws, callers treat that as "no warning needed".
 */
export function gitProbe(dir) {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain"],
      { cwd: dir, timeout: 5000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout) => {
        if (error) return resolve({ repo: false, dirty: false })
        resolve({ repo: true, dirty: String(stdout ?? "").trim().length > 0 })
      },
    )
  })
}

/** Unregisters every project (files are never touched). Returns the count. */
export function clearWorkspace() {
  const data = loadWorkspace()
  const removed = data.projects.length
  data.projects = []
  data.currentId = null
  saveWorkspace(data)
  return removed
}

/** Workspace-level settings (defaultDir lives in ~/.selldoes/settings.json). */
export function getWorkspaceSettings() {
  try {
    const fromUser = loadUserSettings().defaultDir
    if (fromUser) return { defaultDir: fromUser }
  } catch {
    // fall through to the legacy workspace.json value
  }
  return { defaultDir: loadWorkspace().defaultDir ?? null }
}

/** Sets the default parent directory for newly created/imported projects. */
export function setDefaultDir(dir) {
  const value = String(dir ?? "").trim()
  if (!value) throw new Error("A default directory path is required")
  const normalized = normalizePath(value)
  try {
    if (fs.existsSync(normalized)) {
      if (!fs.statSync(normalized).isDirectory()) throw new Error("that path is a file, not a folder")
    } else {
      fs.mkdirSync(normalized, { recursive: true })
    }
  } catch (error) {
    throw new Error(`Could not use ${normalized}: ${error instanceof Error ? error.message : String(error)}`)
  }
  // The user settings win; workspace.json keeps a copy for older readers.
  applyUserSettingsPatch({ defaultDir: normalized })
  const data = loadWorkspace()
  data.defaultDir = normalized
  saveWorkspace(data)
  return normalized
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
