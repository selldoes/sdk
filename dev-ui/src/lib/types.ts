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
  dashboardPages?: { label: string; path: string; icon?: string; group?: string }[]
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
