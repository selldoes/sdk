import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * User (global) settings — who you are on this machine, not what a project is.
 *
 *   File: ~/.selldoes/settings.json
 *   {
 *     "assistant": { "provider": "openrouter", "model": "…", "apiKey": "sk-…", "baseUrl": "…" },
 *     "defaultDir": "C:/…/Selldoes",
 *     "editor": "code",
 *     "publish": { "bump": "patch" }
 *   }
 *
 * Everything here applies to every project. Project folders keep only what is
 * genuinely per-project in selldoes.config.json (dev server, mock store, the
 * release-bump override, plugin secrets) — never credentials. Older SDK
 * versions saved assistant keys into each project; `migrateProjectAssistantConfigs`
 * lifts those into this file.
 */

const BUMP_MODES = new Set(["patch", "minor", "major"])

export const USER_SETTINGS_BUMP_MODES = ["patch", "minor", "major"]

/** Test hook: SELLDOES_SETTINGS_FILE points the store at a temp file. */
export function userSettingsFile() {
  return process.env.SELLDOES_SETTINGS_FILE || path.join(os.homedir(), ".selldoes", "settings.json")
}

/** Never throws — a missing or corrupt file reads as "all defaults". */
export function loadUserSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(userSettingsFile(), "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function maskApiKey(value) {
  const key = String(value ?? "")
  if (!key) return null
  if (key.length <= 8) return "••••"
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

/** The `assistant` section of the user settings (never throws). */
export function userAssistant() {
  const value = loadUserSettings().assistant
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function writeSettings(next) {
  const file = userSettingsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return next
}

/**
 * Merges a patch into the user settings.
 *   undefined → keep the saved value
 *   null / "" → clear the field
 *   anything else → set
 * Returns the stored settings. Throws on invalid input.
 */
export function applyUserSettingsPatch(patch = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Settings patch must be an object")
  const current = loadUserSettings()
  const next = { ...current }

  if (patch.assistant !== undefined) {
    if (!patch.assistant || typeof patch.assistant !== "object" || Array.isArray(patch.assistant)) {
      throw new Error("assistant must be an object")
    }
    const merged = { ...(current.assistant ?? {}) }
    for (const field of ["provider", "model", "apiKey", "baseUrl", "maxTokens"]) {
      if (!(field in patch.assistant)) continue
      const value = patch.assistant[field]
      if (value === undefined || value === null || value === "") {
        delete merged[field]
      } else if (field === "maxTokens") {
        merged.maxTokens = Math.max(256, Math.min(Number(value) || 4000, 16000))
      } else {
        merged[field] = String(value).trim()
      }
    }
    if (Object.keys(merged).length > 0) next.assistant = merged
    else delete next.assistant
  }

  if (patch.defaultDir !== undefined) {
    const value = patch.defaultDir === null || patch.defaultDir === "" ? null : String(patch.defaultDir).trim()
    if (value === null) delete next.defaultDir
    else next.defaultDir = value
  }

  if (patch.editor !== undefined) {
    const value = patch.editor === null || patch.editor === "" || patch.editor === "auto" ? null : String(patch.editor).trim()
    if (value === null) delete next.editor
    else next.editor = value
  }

  if (patch.publish !== undefined) {
    if (!patch.publish || typeof patch.publish !== "object" || Array.isArray(patch.publish)) throw new Error("publish must be an object")
    const merged = { ...(current.publish ?? {}) }
    if ("bump" in patch.publish) {
      const value = patch.publish.bump
      if (value === undefined || value === null || value === "") delete merged.bump
      else {
        const mode = String(value).trim()
        if (!BUMP_MODES.has(mode)) throw new Error(`publish.bump must be one of ${[...BUMP_MODES].join(", ")}`)
        merged.bump = mode
      }
    }
    if (Object.keys(merged).length > 0) next.publish = merged
    else delete next.publish
  }

  // Keep a saved defaultDir valid on disk (same rule as the workspace registry).
  if (next.defaultDir) {
    const normalized = path.resolve(String(next.defaultDir))
    try {
      if (fs.existsSync(normalized)) {
        if (!fs.statSync(normalized).isDirectory()) throw new Error("that path is a file, not a folder")
      } else {
        fs.mkdirSync(normalized, { recursive: true })
      }
    } catch (error) {
      throw new Error(`Could not use ${normalized}: ${error instanceof Error ? error.message : String(error)}`)
    }
    next.defaultDir = process.platform === "win32" ? normalized.replace(/\\/g, "/") : normalized
  }

  return writeSettings(next)
}

/** Read-only view for APIs — never contains the raw assistant key. */
export function userSettingsView() {
  const settings = loadUserSettings()
  const assistant = settings.assistant ?? {}
  return {
    assistant: {
      provider: assistant.provider ?? null,
      model: assistant.model ?? null,
      baseUrl: assistant.baseUrl ?? null,
      apiKeyMasked: maskApiKey(assistant.apiKey),
      apiKeySet: Boolean(assistant.apiKey),
      maxTokens: assistant.maxTokens ?? null,
    },
    defaultDir: settings.defaultDir ?? null,
    editor: settings.editor ?? null,
    publish: {
      bump: BUMP_MODES.has(String(settings.publish?.bump)) ? String(settings.publish.bump) : null,
    },
    file: userSettingsFile(),
  }
}

/**
 * One-time migration: assistant credentials that older SDK versions saved into
 * each project's selldoes.config.json move up to the user settings (fill-if-
 * unset); a project keeps only `assistant.model` as its per-project override.
 * Returns { migrated: [slug], cleared: n }.
 */
export function migrateProjectAssistantConfigs(projects = []) {
  const migrated = []
  let cleared = 0
  const user = loadUserSettings()
  const userAssistantConfig = { ...(user.assistant ?? {}) }
  let userChanged = false

  for (const project of projects) {
    if (!project?.path) continue
    const configPath = path.join(project.path, "selldoes.config.json")
    let fileConfig
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"))
    } catch {
      continue
    }
    const section = fileConfig?.assistant
    if (!section || typeof section !== "object" || Array.isArray(section)) continue

    // Credentials + provider preference are machine-level.
    for (const field of ["provider", "apiKey", "baseUrl", "maxTokens"]) {
      if (section[field] !== undefined && section[field] !== null && section[field] !== "" && userAssistantConfig[field] === undefined) {
        userAssistantConfig[field] = section[field]
        userChanged = true
      }
    }
    // The model stays per project when set — it is the project's override.
    const nextSection = {}
    if (section.model) nextSection.model = String(section.model)
    if (Object.keys(nextSection).length > 0) fileConfig.assistant = nextSection
    else delete fileConfig.assistant
    fs.writeFileSync(configPath, `${JSON.stringify(fileConfig, null, 2)}\n`)
    migrated.push(String(project.slug ?? project.path))
    cleared++
  }

  if (userChanged) writeSettings({ ...user, assistant: userAssistantConfig })
  return { migrated, cleared }
}
