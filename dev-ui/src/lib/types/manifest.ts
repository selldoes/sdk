/** Plugin manifest shape: permissions, config, jobs, routes, sections and pricing. */

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
  | "secrets:read"
  | "storage:read"
  | "storage:write"

export interface PluginConfigField {
  key: string
  label: string
  type: "string" | "text" | "number" | "boolean" | "select" | "model-select" | "secret"
  description?: string
  placeholder?: string
  default?: string | number | boolean
  /** Static options. `model-select` rows may also carry title/subtitle/meta/price/pinned. */
  options?: {
    value: string
    label: string
    title?: string
    subtitle?: string
    meta?: string
    price?: number | null
    pinned?: boolean
  }[]
  /** A plugin API route the kit fetches options from at render time (e.g. "/ai/models?type=text"). */
  optionsFrom?: string
  required?: boolean
  /** "Learn more" link rendered under the field (e.g. where to get an API key). */
  learnMoreUrl?: string
}

export interface PluginJobDefinition {
  type: string
  name: string
  description?: string
  tickBudgetMs?: number
  runtime?: "quickjs" | "node"
  timeoutMs?: number
  memoryMb?: number
}

export interface PluginScheduleDefinition {
  job: string
  cron: string
  name?: string
  description?: string
  timezone?: string
  input?: unknown
  enabled?: boolean
  /** Computed by the dev server; ISO timestamp or null. */
  nextRunAt?: string | null
  /** Set when the expression cannot fire (shown in the preview). */
  error?: string | null
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

/** Marketplace pricing — what the listing card shows and publish sends. */
export interface PluginPricing {
  /** 0 (or absent) = free. */
  amount: number
  /** ISO 4217 code, default USD. */
  currency?: string
  /** How often the store is billed. */
  billingPeriod?: "one_time" | "monthly" | "yearly"
  /** Marketplace trial length in days (0–90). */
  trialDays?: number
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
  dashboardPages?: {
    label: string
    path: string
    icon?: string
    group?: string
    entry?: string
    sections?: PluginDashboardSection[]
  }[]
  ui?: { entry: string; title?: string; height?: number }
  delivery?: boolean
  apiRoutes?: PluginApiRoute[]
  publicRoutes?: PluginApiRoute[]
  storefrontWidget?: { entry: string; width?: number; height?: number }
  storefrontPages?: { path: string; title: string; entry: string }[]
  jobs?: PluginJobDefinition[]
  schedules?: PluginScheduleDefinition[]
  configSchema?: PluginConfigField[]
  /**
   * Designed settings dialog — authored on the Design → Settings page.
   * The kit compiler turns `sections` into `entry` (`ui/kit/settings.html`);
   * the platform's plugin manager renders it in a dialog instead of the
   * plugin home page when present.
   */
  settingsDialog?: { entry?: string; sections?: PluginDashboardSection[] }
  sections?: { type: string; name: string; description?: string }[]
  tags?: string[]
  category?: string
  screenshots?: string[]
  /** Marketplace pricing — drives the listing card and publish defaults. */
  pricing?: PluginPricing
  [key: string]: unknown
}

export interface Validation {
  errors: string[]
  warnings: string[]
}
