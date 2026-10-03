/** Types mirroring the plugin manifest + dev-server payloads. */

export type PluginPermission =
  | "db:read"
  | "db:write"
  | "db:schema"
  | "api:external"
  | "ai:use"
  | "email:send"
  | "files:read"
  | "files:write"
  | "products:read"
  | "products:write"
  | "realtime:publish"
  | "webhooks:register"
  | "sections:register"
  | "dashboard:pages"

export interface PluginConfigField {
  key: string
  label: string
  type: "string" | "text" | "number" | "boolean" | "select" | "secret"
  description?: string
  placeholder?: string
  default?: string | number | boolean
  options?: { value: string; label: string }[]
  required?: boolean
}

export interface PluginJobDefinition {
  type: string
  name: string
  description?: string
  tickBudgetMs?: number
}

export interface PluginApiRoute {
  path: string
  methods: string[]
}

/** One dashboard-page component (mirrors the store's SerializedSection shape). */
export interface PluginDashboardSection {
  id?: string
  type: string
  settings?: Record<string, unknown>
  [key: string]: unknown
}

export interface PluginManifest {
  slug: string
  name: string
  description: string
  version: string
  author?: string
  icon?: string
  /** Custom icon image (path inside the plugin, or an absolute URL). */
  iconUrl?: string
  homepage?: string
  entry?: string
  permissions?: PluginPermission[] | string[]
  allowedTables?: string[]
  dependencies?: Record<string, string>
  dashboardPages?: { label: string; path: string; icon?: string; group?: string; entry?: string; sections?: PluginDashboardSection[] }[]
  ui?: { entry: string; title?: string; height?: number }
  delivery?: boolean
  apiRoutes?: PluginApiRoute[]
  publicRoutes?: PluginApiRoute[]
  storefrontWidget?: { entry: string; width?: number; height?: number }
  storefrontPages?: { path: string; title: string; entry: string }[]
  jobs?: PluginJobDefinition[]
  configSchema?: PluginConfigField[]
  sections?: { type: string; name: string; description?: string }[]
  tags?: string[]
  category?: string
  screenshots?: string[]
  [key: string]: unknown
}

export interface Validation {
  errors: string[]
  warnings: string[]
}

export interface DevStore {
  id: number
  slug: string
  name: string
}

export interface DevStatus {
  rebuilds: number
  builtAt: string
  lastError?: string | null
  errors?: string[]
}

export interface DevActivity {
  visits: Record<string, boolean>
  jobs: { count: number; lastType?: string; lastAt?: string }
  routes: { count: number; lastPath?: string; lastAt?: string }
  hooks: { count: number; lastHook?: string; lastAt?: string }
  sampleJobs?: Record<string, { input?: unknown; maxTicks?: number }>
}

export interface AssistantConfig {
  configured: boolean
  provider?: string
  model?: string
}

export interface Bootstrap {
  manifest: PluginManifest
  validation: Validation
  store: DevStore
  status: DevStatus
  activity: DevActivity
  assistant: AssistantConfig
  snapshots: number
}

export interface AssistantFileEdit {
  path: string
  content: string
  before?: string
  exists?: boolean
}

export interface AssistantEdits {
  summary?: string
  files: AssistantFileEdit[]
  manifest?: PluginManifest
}

export interface AssistantChatResult {
  text?: string
  edits?: AssistantEdits
  error?: string
  code?: string
}

export interface SettingsResponse {
  configSchema: PluginConfigField[]
  settings: Record<string, unknown>
}

// ─── Dashboard UI entries + scaffold ─────────────────────────────────────────

export interface UiPageRef {
  label: string
  path: string
}

/** Status of one declared dashboard-UI HTML entry (ui.entry / dashboardPages[].entry). */
export interface UiEntryStatus {
  entry: string
  /** True when this is the manifest's `ui.entry` (the default page). */
  isDefault: boolean
  /** False when the entry path is not under ui/ (the preview only serves ui/). */
  underUi: boolean
  /** Sidebar pages that render this entry (empty for a bare ui.entry). */
  pages: UiPageRef[]
  /** The file exists in the plugin source. */
  sourceExists: boolean
 /** The file exists in the built UI output (what the iframe loads). */
  builtExists: boolean
}

export interface UiEntriesResponse {
  hasUi: boolean
  flavor: "js" | "react"
  entries: UiEntryStatus[]
}

/** What POST /__dev/ui/scaffold returns — regenerates the default notes example. */
export interface ScaffoldUiResult {
  ok: boolean
  entry: string
  flavor: "js" | "react"
  written: string[]
  manifest: PluginManifest
  validation: Validation
  rebuildError?: string
}

/** What POST /__dev/scaffold/{job,hook,route} returns — codegen + wiring. */
export interface ScaffoldCodeResult {
  ok: boolean
  kind: "job" | "hook" | "route"
  file: string
  written: string[]
  manifest: PluginManifest
  validation: Validation
  rebuildError?: string
}

// ─── Packages ────────────────────────────────────────────────────────────────

export type PackageStatus = "ok" | "warn" | "blocked" | "missing"

export interface PackageInfo {
  name: string
  declared: boolean
  range?: string
  installed: string | null
  status: PackageStatus
  message: string
  sizeKb?: number | null
  bundled: boolean
}

export interface SandboxSummary {
  ok: boolean
  errors: string[]
  warnings: string[]
  sizeKb: number
}

export interface PackagesResponse {
  manager: string
  dependencies: Record<string, string>
  packages: PackageInfo[]
  /** Imported by the bundle but missing from plugin.json dependencies. */
  missing: string[]
  sandbox: SandboxSummary
}

export interface NpmSearchResult {
  name: string
  version?: string
  description?: string
  date?: string | null
  publisher?: string | null
  links?: { npm?: string; homepage?: string }
}

// ─── Code editor ─────────────────────────────────────────────────────────────

export interface FileTreeEntry {
  path: string
  type: "file" | "dir"
  size?: number
  mtimeMs?: number
}

export interface FileTree {
  root: string
  entries: FileTreeEntry[]
}

export interface FileRead {
  path: string
  content: string
  size: number
  mtimeMs: number
}

export interface FileWriteResult {
  ok: boolean
  path: string
  size: number
  unchanged?: boolean
  rebuildError?: string | null
  validation?: Validation
}

export interface SearchHit {
  path: string
  line: number
  column: number
  preview: string
}

export interface SearchResult {
  hits: SearchHit[]
  files: number
  truncated: boolean
}

export interface SnapshotInfo {
  name: string
  reason?: string
  at?: string
  files?: { path: string; existed: boolean }[]
}

export interface AssistantConfigResponse {
  assistant: {
    provider?: string | null
    model?: string | null
    baseUrl?: string | null
    apiKey?: string | null
    apiKeySet?: boolean
  }
  env: Record<string, boolean | string | null>
}

/** The `server` section of selldoes.config.json (dev-server settings). */
export interface DevServerConfig {
  storeId: number
  storeSlug: string
  storeName: string
  port: number
  host: string
  ai: { mockReply: string | null }
  email: { disabled: boolean }
  sampleJobs: Record<string, unknown> | null
}

/** Full /__dev/config payload — assistant + env + dev-server settings. */
export interface DevConfigResponse extends AssistantConfigResponse {
  server: DevServerConfig
}

/** Sections accepted by POST /__dev/config (all optional). */
export interface SaveFileConfigInput {
  assistant?: Record<string, unknown>
  server?: Partial<DevServerConfig>
  ai?: { mockReply?: string | null }
  email?: { disabled?: boolean }
  sampleJobs?: Record<string, unknown> | null
}

export interface GitFile {
  status: string
  path: string
}

export interface GitStatus {
  repo: boolean
  branch?: string
  ahead?: number
  behind?: number
  files?: GitFile[]
  error?: string
}

export interface GitCommit {
  hash: string
  message: string
}
