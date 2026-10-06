import type { UserSettingsPatch, UserSettingsResponse } from "./types"

/** Client for the workspace server (`/__ws/*`) — the web front door. */

export interface WsExample {
  id: string
  name: string
  description: string
  badge?: string | null
  /** Dashboard UI the example ships with. */
  ui: "none" | "js" | "react"
}

export interface WsProject {
  id: string
  kind: "plugin" | "theme"
  name: string
  slug: string
  path: string
  source?: string
  /** Plugin/theme version from the manifest, when present. */
  version?: string
  /** Built-in icon name from the project manifest, when present. */
  icon?: string
  /** Uploaded custom icon path from the manifest (e.g. "assets/icon.png"). */
  iconUrl?: string
  /** Accent chosen in the New-workspace wizard (cosmetic, stored in workspace.json). */
  color?: string | null
  createdAt?: string
  lastOpenedAt?: string
  missing?: boolean
}

/** Resolves a project's custom icon (uploaded image) to a URL the shell can render. */
export function projectIconUrl(project: { id?: string; iconUrl?: string | null }): string | null {
  const value = String(project.iconUrl ?? "").trim()
  if (!value) return null
  if (/^(https?:)?\/\//.test(value) || value.startsWith("data:")) return value
  if (!project.id) return null
  return `/__ws/project-icon/${encodeURIComponent(project.id)}`
}

export interface WsPreview {
  id: string
  projectId: string
  slug: string
  name: string
  url: string
  port: number
  alive: boolean
  startedAt?: string
  log?: string[]
}

export interface WsBootstrap {
  mode: "workspace"
  sdk: { version: string; dev: boolean }
  projects: WsProject[]
  current: { project: WsProject; url: string | null; port: number | null; alive: boolean } | null
  account: { connected: boolean; appUrl?: string; email?: string; name?: string; unreachable?: boolean }
  assistant: { configured: boolean; provider?: string; model?: string }
  defaultDir: string
  previews: WsPreview[]
}

export interface WsPackage {
  slug: string
  name: string
  latestVersion: string
  status: string
  updatedAt?: string
}

/** Result of a pull/update from the developer account (`/__ws/pull`). */
export interface PullSummary {
  updated: boolean
  written: number
  version: string | null
  previousVersion: string | null
}

/** Per-package detail from GET /__ws/package/<slug> (plugin + releases + listing). */
export interface WsPackageDetail {
  plugin: {
    slug: string
    name?: string
    description?: string
    latestVersion?: string
    status?: string
    updatedAt?: string
  }
  releases?: { version?: string; notes?: string; createdAt?: string }[]
  listing?: { status?: string; price?: number } | null
}

/** Theme-lane (merchant API key) state — never contains the raw key. */
export interface WsThemeStatus {
  connected: boolean
  baseUrl: string | null
  defaultStoreSlug: string | null
  apiKeyMasked: string | null
  stores?: string[]
  userId?: number | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = (body as { error?: string }).error || `Request failed (${response.status})`
    const error = new Error(message) as Error & { code?: string }
    error.code = (body as { code?: string }).code
    throw error
  }
  return body as T
}

function post<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  })
}

export const ws = {
  bootstrap: () => request<WsBootstrap>("/__ws/bootstrap"),
  importFolder: (folderPath: string) => post<{ project: WsProject }>("/__ws/import", { path: folderPath }),
  /** Starting points for the New-workspace dialog (served by the CLI). */
  examples: () =>
    request<{ plugin: WsExample[]; theme: WsExample[] }>("/__ws/examples"),
  create: (input: {
    name: string
    parentDir?: string
    kind: "plugin" | "theme"
    version?: string
    slug?: string
    /** Example id from `ws.examples()` (e.g. "importer", "editorial"). */
    example?: string
    description?: string
    author?: string
    category?: string
    icon?: string
    tags?: string[]
    permissions?: string[]
    color?: string
    /** base64 custom icon + its original filename (written into assets/ on create). */
    iconData?: string
    iconFileName?: string
    withUi?: boolean
    uiFlavor?: "js" | "react"
    /** false = register without making it current (themes can't preview in the shell). */
    select?: boolean
  }) => post<{ project: WsProject; needsInstall?: boolean; iconError?: string | null }>("/__ws/create", input),
  createAi: (input: {
    name: string
    prompt: string
    parentDir?: string
    slug?: string
    description?: string
    version?: string
    author?: string
    category?: string
    icon?: string
    tags?: string[]
    color?: string
    iconData?: string
    iconFileName?: string
    select?: boolean
  }) => post<{ project: WsProject; files: string[]; iconError?: string | null }>("/__ws/create-ai", input),
  packages: () => request<{ appUrl: string; plugins: WsPackage[] }>("/__ws/packages"),
  connect: (token: string, appUrl?: string) =>
    post<{ connected: true; appUrl: string; email?: string; name?: string }>("/__ws/connect", {
      token,
      ...(appUrl ? { appUrl } : {}),
    }),
  disconnect: () => post<{ connected: false }>("/__ws/disconnect"),
  pull: (slug: string, options: { dir?: string; update?: boolean; force?: boolean } = {}) =>
    post<{ project: WsProject; summary?: PullSummary }>("/__ws/pull", { slug, ...options }),
  deleteRemote: (slug: string) =>
    post<{ ok: boolean; slug: string; appUrl: string }>("/__ws/delete-remote", { slug, confirm: true }),
  package: (slug: string) => request<WsPackageDetail>(`/__ws/package/${encodeURIComponent(slug)}`),
  themeStatus: () => request<WsThemeStatus>("/__ws/theme-status"),
  themeConnect: (input: { apiKey: string; baseUrl?: string; defaultStoreSlug?: string }) =>
    post<WsThemeStatus>("/__ws/theme-connect", input),
  themeDisconnect: () => post<{ connected: false; had: boolean }>("/__ws/theme-disconnect"),
  select: (projectId: string) => post<{ current: WsBootstrap["current"] }>("/__ws/select", { projectId }),
  restart: () => post<{ current: WsBootstrap["current"] }>("/__ws/restart", {}),
  previews: () => request<{ previews: WsPreview[] }>("/__ws/previews"),
  close: (id: string) => post<{ ok: boolean }>("/__ws/close", { id }),
  remove: (projectId: string) => post<{ ok: boolean }>("/__ws/remove", { projectId }),
  /** Deletes the project folder from disk + unregisters it (typed-slug confirm server-side). */
  deleteFiles: (input: { projectId: string; confirmSlug: string; allowDirty?: boolean }) =>
    post<{ ok: boolean; slug: string; path: string; existed: boolean }>("/__ws/delete-files", input),
  /** Unregisters every project (files are never touched). */
  clearRegistry: () => post<{ ok: boolean; removed: number }>("/__ws/clear-registry", { confirm: true }),
  saveSettings: (input: { defaultDir: string }) => post<{ ok: boolean; defaultDir: string }>("/__ws/settings", input),
  /** User (global) settings — ~/.selldoes/settings.json (assistant, defaultDir, editor, publish fallback). */
  userSettings: () => request<UserSettingsResponse>("/__ws/user-settings"),
  saveUserSettings: (input: UserSettingsPatch) => post<{ ok: boolean } & UserSettingsResponse>("/__ws/user-settings", input),
  /** Pings the assistant provider from the user settings (no project preview needed). */
  testUserAssistant: () => post<{ ok: boolean; provider?: string; model?: string }>("/__ws/user-settings/test", {}),
  /** Opens the native OS folder picker on the machine running the server. */
  chooseFolder: (initialDir?: string) =>
    post<{ path: string | null; cancelled: boolean }>("/__ws/choose-folder", initialDir ? { initialDir } : {}),
  setColor: (projectId: string, color: string | null) =>
    post<{ ok: boolean; project: WsProject }>("/__ws/color", { projectId, color }),
  openEditor: (input: { projectId?: string; file?: string; line?: number; column?: number; editor?: string; terminal?: boolean } = {}) =>
    post<{ opened: boolean; editor?: string; terminal?: string; error?: string }>("/__ws/open-editor", input),
}
