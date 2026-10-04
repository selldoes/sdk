/** Thin client for the dev server (`/__dev/*` + the plugin API lanes). */

import type {
  AssistantChatResult,
  AssistantEdits,
  Bootstrap,
  BumpMode,
  DevAccount,
  DevConfigResponse,
  DevStatus,
  FileRead,
  FileTree,
  FileWriteResult,
  GitCommit,
  GitStatus,
  PluginManifest,
  PublishInput,
  PublishResult,
  PackagesResponse,
  NpmSearchResult,
  SaveFileConfigInput,
  SearchResult,
  SettingsResponse,
  SnapshotInfo,
  ScaffoldCodeResult,
  ScaffoldUiResult,
  UiEntriesResponse,
  UserSettingsPatch,
  UserSettingsResponse,
  Validation,
  VersionBumpResult,
} from "./types"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = (body as { error?: string }).error || `Request failed (${response.status})`
    const error = new Error(message) as Error & { code?: string; body?: unknown }
    error.code = (body as { code?: string }).code
    error.body = body
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

export const dev = {
  bootstrap: () => request<Bootstrap>("/__dev/bootstrap"),
  status: () => request<DevStatus>("/__dev/status"),
  visit: (page: string) => post<{ ok: boolean }>("/__dev/visit", { page }),
  saveManifest: (manifest: PluginManifest) =>
    post<{ ok: boolean; manifest: PluginManifest; validation: Validation }>("/__dev/manifest", { manifest }),
  undoManifest: () => post<{ ok: boolean; manifest: PluginManifest | null }>("/__dev/manifest/undo", {}),
  /** Bumps plugin.json version — mode for patch/minor/major, or an explicit version. */
  version: (input: { mode?: BumpMode; version?: string } = {}) => post<VersionBumpResult>("/__dev/version", input),
  /** Builds, zips and publishes through the connected developer account. */
  publish: (input: PublishInput = {}) => post<PublishResult>("/__dev/publish", input),
  /** Developer-account state from ~/.selldoes.json (standalone dev server). */
  account: () => request<DevAccount>("/__dev/account"),
  connectAccount: (token: string, appUrl?: string) =>
    post<DevAccount>("/__dev/account/connect", { token, ...(appUrl ? { appUrl } : {}) }),
  disconnectAccount: () => post<{ connected: false; had: boolean }>("/__dev/account/disconnect", {}),
  uploadAsset: (input: { folder: "assets" | "screenshots"; name: string; data: string }) =>
    post<{ path: string; url: string }>("/__dev/assets", input),
  deleteAsset: (path: string) => post<{ ok: boolean }>("/__dev/assets/delete", { path }),
  settings: () => request<SettingsResponse>("/__dev/settings"),
  saveSettings: (settings: Record<string, unknown>) => post<{ ok: boolean; settings: Record<string, unknown> }>("/__dev/settings", { settings }),
  assistant: () => request<{ configured: boolean; provider?: string; model?: string }>("/__dev/assistant"),
  assistantChat: (messages: { role: string; content: string }[], context: Record<string, unknown>) =>
    post<AssistantChatResult>("/__dev/assistant/chat", { messages, context }),
  assistantApply: (edits: AssistantEdits, options?: { testJob?: boolean }) =>
    post<ApplyResult>("/__dev/assistant/apply", { edits, testJob: options?.testJob === true }),

  // ── Dashboard UI (entries + one-click notes scaffold) ─────────────────────
  uiEntries: () => request<UiEntriesResponse>("/__dev/ui/entries"),
  scaffoldUi: (input: { entry?: string; label?: string; path?: string; icon?: string } = {}) =>
    post<ScaffoldUiResult>("/__dev/ui/scaffold", input),
  // ── Code scaffolds (New job / New hook / New route) ───────────────────────
  scaffoldJob: (input: { type: string; name?: string; description?: string; runtime?: "quickjs" | "node" }) =>
    post<ScaffoldCodeResult>("/__dev/scaffold/job", input),
  scaffoldHook: (input: { name: string }) => post<ScaffoldCodeResult>("/__dev/scaffold/hook", input),
  scaffoldRoute: (input: { path: string }) => post<ScaffoldCodeResult>("/__dev/scaffold/route", input),

  // ── Code editor ───────────────────────────────────────────────────────────
  files: () => request<FileTree>("/__dev/files"),
  readFile: (path: string) => request<FileRead>(`/__dev/files/read?path=${encodeURIComponent(path)}`),
  writeFile: (path: string, content: string) => post<FileWriteResult>("/__dev/files/write", { path, content }),
  createFile: (path: string, type: "file" | "dir") => post<{ ok: boolean; path: string; type: "file" | "dir" }>("/__dev/files/create", { path, type }),
  renameFile: (from: string, to: string) => post<{ ok: boolean; from: string; to: string }>("/__dev/files/rename", { from, to }),
  deleteFile: (path: string) => post<{ ok: boolean; path: string }>("/__dev/files/delete", { path }),
  search: (query: string, options?: { caseSensitive?: boolean; regex?: boolean }) =>
    request<SearchResult>(
      `/__dev/search?q=${encodeURIComponent(query)}${options?.caseSensitive ? "&case=1" : ""}${options?.regex ? "&regex=1" : ""}`,
    ),
  sdkTypes: () => request<{ path: string | null; content: string }>("/__dev/sdk-types"),
  snapshots: () => request<{ snapshots: SnapshotInfo[] }>("/__dev/snapshots"),
  restoreSnapshot: (name: string) => post<{ ok: boolean; meta: SnapshotInfo; validation: Validation }>("/__dev/snapshots/restore", { name }),

  // ── Assistant settings + chat history ─────────────────────────────────────
  config: () => request<DevConfigResponse>("/__dev/config"),
  /** Assistant-only shortcut — saves to the user settings (~/.selldoes/settings.json). */
  saveConfig: (assistant: Record<string, unknown>) =>
    post<{ ok: boolean; restartRequired?: boolean } & DevConfigResponse>("/__dev/config", { assistant }),
  /** Saves selldoes.config.json sections (server/ai/email/sampleJobs/publish). */
  saveFileConfig: (input: SaveFileConfigInput) =>
    post<{ ok: boolean; restartRequired?: boolean } & DevConfigResponse>("/__dev/config", input),
  /** User (global) settings — ~/.selldoes/settings.json (standalone `selldoes dev`). */
  userSettings: () => request<UserSettingsResponse>("/__dev/user-settings"),
  saveUserSettings: (input: UserSettingsPatch) => post<{ ok: boolean } & UserSettingsResponse>("/__dev/user-settings", input),
  undoClear: () => post<{ ok: boolean; cleared: number }>("/__dev/undo/clear", {}),
  testAssistant: () => post<{ ok: boolean; provider?: string; model?: string }>("/__dev/assistant/test", {}),
  chatHistory: () => request<{ items: unknown[] }>("/__dev/assistant/history"),
  saveChatHistory: (items: unknown[]) =>
    request<{ ok: boolean; count: number }>("/__dev/assistant/history", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }),

  // ── Git ───────────────────────────────────────────────────────────────────
  gitStatus: () => request<GitStatus>("/__dev/git/status"),
  gitDiff: (path?: string, staged?: boolean) =>
    request<{ diff: string }>(`/__dev/git/diff?${path ? `path=${encodeURIComponent(path)}&` : ""}${staged ? "staged=1" : ""}`),
  gitShow: (path: string, rev = "HEAD") => request<{ content: string }>(`/__dev/git/show?path=${encodeURIComponent(path)}&rev=${encodeURIComponent(rev)}`),
  gitLog: () => request<{ repo: boolean; commits: GitCommit[] }>("/__dev/git/log"),
  gitStage: (paths: string[]) => post<GitStatus>("/__dev/git/stage", { paths }),
  gitUnstage: (paths: string[]) => post<GitStatus>("/__dev/git/unstage", { paths }),
  gitCommit: (message: string, paths?: string[]) => post<GitStatus>("/__dev/git/commit", { message, paths }),
  gitInit: () => post<GitStatus>("/__dev/git/init", {}),

  // ── Packages (npm dependencies + sandbox compatibility) ───────────────────
  packages: () => request<PackagesResponse>("/__dev/packages"),
  checkPackages: () => post<PackagesResponse>("/__dev/packages/check", {}),
  searchNpm: (query: string) => request<{ results: NpmSearchResult[] }>(`/__dev/packages/search?q=${encodeURIComponent(query)}`),
  addPackage: (name: string, range?: string) =>
    post<PackagesResponse & { ok: boolean; rebuildError?: string }>("/__dev/packages/add", { name, ...(range ? { range } : {}) }),
  removePackage: (name: string) =>
    post<PackagesResponse & { ok: boolean; rebuildError?: string }>("/__dev/packages/remove", { name }),

  // ── External editor / OS terminal ─────────────────────────────────────────
  openEditor: (input: { file?: string; line?: number; column?: number; editor?: string; terminal?: boolean } = {}) =>
    post<{ opened: boolean; editor?: string; terminal?: string; error?: string }>("/__dev/open", input),
  runJob: (payload: { type: string; input?: unknown; maxTicks?: number }) =>
    post<{ ok?: boolean; error?: string; run?: JobRun; telemetry?: JobTelemetry }>("/__dev/run-job", payload),
  runHook: (hook: string, payload: unknown) => post<{ ok?: boolean; error?: string; result?: unknown }>("/__dev/run-hook", { hook, payload }),
  rebuild: () => post<{ ok: boolean; rebuilds: number }>("/__dev/rebuild", {}),
  resetData: () => post<{ ok: boolean }>("/__dev/reset-data", {}),
  tables: () => request<{ tables: Record<string, { rows: number; columns: string[]; sample: unknown[] }> }>("/__dev/state"),
  outbox: () => request<{ outbox: { to: string; subject: string; text?: string; html?: string; at: string }[] }>("/__dev/outbox"),
  events: () => request<{ events: { id: number; channel: string; event: string; data: unknown; at: string }[] }>("/__dev/events"),
  logs: () => request<{ logs: string[]; rebuilds: number }>("/__dev/logs"),
}

export interface JobRun {
  kind?: string
  ticks?: number
  done?: boolean
  result?: unknown
  state?: unknown
}

/** What `/__dev/assistant/apply` returns — includes the closed-loop test run. */
export interface ApplyResult {
  ok: boolean
  validation: Validation
  applied: string[]
  rebuildError?: string
  test?: {
    type?: string
    ticks?: number
    done?: boolean
    result?: unknown
    error?: string | null
    skipped?: string
    items?: unknown[]
    logs?: unknown[]
  }
}

export interface JobTelemetry {
  progress?: { processed?: number; total?: number; failed?: number; skipped?: number; message?: string }[]
  items?: { ref: string; status: string; error?: string; data?: unknown; productId?: number }[]
  logs?: { level?: string; message: string }[]
}

/** Reads a File as base64 (without the data: prefix). */
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}
