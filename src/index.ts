/**
 * selldoes — types and helpers for first-party plugins.
 *
 * The SDK is development-time only: it is never bundled into a plugin release.
 * Runtime code receives a `PluginContext` from the host sandbox.
 */

// ─── Manifest ────────────────────────────────────────────────────────────────

export interface PluginDashboardPage {
  label: string
  path: string
  icon?: string
  group?: string
}

export interface PluginUi {
  /** HTML entry inside the plugin bundle, e.g. "ui/index.html". */
  entry: string
  title?: string
  height?: number
}

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
  methods: ("GET" | "POST" | "PUT" | "PATCH" | "DELETE")[]
}

export interface PluginManifest {
  slug: string
  name: string
  description: string
  version: string
  author?: string
  icon?: string
  homepage?: string
  entry?: string
  permissions?: PluginPermission[]
  allowedTables?: string[]
  dependencies?: Record<string, string>
  dashboardPages?: PluginDashboardPage[]
  /** Renders the plugin's own dashboard UI in a sandboxed iframe. */
  ui?: PluginUi
  /** Declares deliveryProvider(storeId, order, ctx) for the order page. */
  delivery?: boolean
  apiRoutes?: PluginApiRoute[]
  /** Routes callable by storefront visitors without a dashboard session. */
  publicRoutes?: PluginApiRoute[]
  /** Sandboxed storefront widget iframe (e.g. a chat bubble). */
  storefrontWidget?: { entry: string; width?: number; height?: number }
  /** Public storefront pages owned by the plugin (e.g. a help center at `/kb`). */
  storefrontPages?: { path: string; title: string; entry: string }[]
  jobs?: PluginJobDefinition[]
  configSchema?: PluginConfigField[]
  sections?: { type: string; name: string; description?: string }[]
  tags?: string[]
  category?: string
  screenshots?: string[]
}

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

// ─── Capabilities ────────────────────────────────────────────────────────────

export interface PluginDB {
  /**
   * Read rows from a table the plugin has permission to access.
   * Conditions are equality by default and support operator objects:
   * `{ like: "term" }`, `{ in: [...] }`, `{ ne, gt, gte, lt, lte }`; `null`
   * matches `IS NULL`.
   */
  select(
    table: string,
    conditions?: Record<string, unknown>,
    opts?: { limit?: number; offset?: number; orderBy?: string; orderDir?: "asc" | "desc" },
  ): Promise<Record<string, unknown>[]>
  count(table: string, conditions?: Record<string, unknown>): Promise<number>
  insert(table: string, data: Record<string, unknown>): Promise<{ id: number }>
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<{ inserted: number }>
  update(table: string, conditions: Record<string, unknown>, data: Record<string, unknown>): Promise<{ affected: number }>
  delete(table: string, conditions: Record<string, unknown>): Promise<{ affected: number }>
  /**
   * Creates a store-scoped table owned by the plugin. The sandbox forces
   * `store_id` on every read/write, so plugins never see another store's rows.
   */
  ensureTable(name: string, columns: Record<string, "int" | "bigint" | "text" | "varchar" | "boolean" | "json" | "timestamp" | "decimal">): Promise<{ table: string; created: boolean }>
}

export interface PluginHttp {
  get(url: string, headers?: Record<string, string>, opts?: { timeoutMs?: number }): Promise<{ status: number; data: unknown }>
  post(url: string, body: unknown, headers?: Record<string, string>, opts?: { timeoutMs?: number }): Promise<{ status: number; data: unknown }>
}

export interface PluginAI {
  complete(opts: {
    prompt: string
    systemPrompt?: string
    model?: string
    maxTokens?: number
    temperature?: number
    timeoutMs?: number
  }): Promise<{ text: string; tokensUsed: number }>
  /** Generate an image through the store's AI image settings (saved prompt + provider). */
  image(opts?: {
    prompt?: string
    /** Saved AI prompt id (Dashboard → AI Prompts); defaults to the store's image prompt. */
    promptId?: number
    /** Source image to upscale/enhance. */
    referenceImage?: string
    /** Requested size, e.g. "2048x2048". Models may snap to a supported size. */
    size?: string
    aspectRatio?: string
  }): Promise<{ url?: string; base64?: string }>
}

export interface PluginFileUploadInput {
  /** Base64-encoded file contents (QuickJS has no Buffer/Blob). */
  name: string
  data: string
  contentType?: string
  folder?: string
}

export interface PluginFileRecord {
  key: string
  url: string
  size: number
}

export interface PluginFiles {
  upload(input: PluginFileUploadInput): Promise<{ url: string; key: string; size: number }>
  importFromUrl(input: { url: string; name?: string; folder?: string; contentType?: string }): Promise<{ url: string; key: string; size: number }>
  list(prefix?: string): Promise<PluginFileRecord[]>
  delete(key: string): Promise<{ deleted: boolean }>
}

export interface PluginProductInput {
  name?: string
  description?: string
  sku?: string
  price?: number | string
  compareAtPrice?: number | string
  costPrice?: number | string
  stock?: number
  status?: string
  condition?: string
  image?: string
  mainImage?: string
  screenshots?: string[] | string
  category?: string
  subCategory?: string
  bulletpoints?: string
  deliveryInstructions?: string
  productNotes?: string
  videoUrl?: string
  /** Variant groups (object/array or a JSON string). */
  variationGroups?: unknown
  /** Custom product attributes (object/array or a JSON string). */
  customAttributes?: unknown
  isDigital?: boolean
  hidden?: boolean
}

export interface PluginProducts {
  create(input: PluginProductInput & { name: string }): Promise<{ id: number }>
  update(id: number, input: PluginProductInput): Promise<{ updated: boolean }>
  get(id: number): Promise<Record<string, unknown> | null>
  /** Find a product by SKU within the plugin's store. */
  findBySku(sku: string): Promise<Record<string, unknown> | null>
  list(opts?: {
    limit?: number
    offset?: number
    status?: string
    fields?: string[]
    orderBy?: "id" | "sku" | "name" | "price" | "createdAt"
    orderDir?: "asc" | "desc"
  }): Promise<Record<string, unknown>[]>
  /** Create or update a product keyed by SKU. */
  upsertBySku(input: PluginProductInput & { name: string; sku: string }): Promise<{ id: number; created: boolean }>
}

export interface PluginRealtime {
  publish(channel: string, event: string, data?: unknown): Promise<{ id: number; pushed: boolean }>
  poll(channel: string, opts?: { since?: number; limit?: number }): Promise<{ events: { id: number; event: string; data: unknown }[]; cursor: number }>
}

export interface PluginEmail {
  /** Transactional email through the platform SMTP (permission `email:send`). */
  send(input: { to: string; subject: string; html?: string; text?: string }): Promise<{ sent: boolean }>
}

// ─── Runtime context ─────────────────────────────────────────────────────────

export interface PluginContext {
  storeId: number
  permissions: PluginPermission[]
  tablePrefix: string
  config: Record<string, unknown>
  db: PluginDB
  http: PluginHttp
  ai: PluginAI
  files: PluginFiles
  products: PluginProducts
  realtime: PluginRealtime
  email: PluginEmail
}

export interface PluginApiRequest {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
}

// ─── Background jobs ─────────────────────────────────────────────────────────

export interface PluginJobProgress {
  total?: number
  processed?: number
  failed?: number
  skipped?: number
  /** Short human-readable status line shown in the dashboard. */
  message?: string
}

export interface PluginJobItemInput {
  ref: string
  status: "ok" | "failed" | "skipped"
  productId?: number
  error?: string
  data?: Record<string, unknown>
}

/** What a chunked job's `step` returns each time the host calls it. */
export interface PluginJobStepResult {
  state?: unknown
  progress?: PluginJobProgress
  done?: boolean
  /** Final summary stored on the job row when `done` is true. */
  result?: unknown
}

/** Reporting helpers available as `ctx.jobs` inside job handlers. */
export interface PluginJobReporter {
  progress(progress: PluginJobProgress): Promise<void>
  item(item: PluginJobItemInput): Promise<void>
  log(message: string, level?: "info" | "warn" | "error"): Promise<void>
}

/**
 * Context passed to job handlers. Mirrors `PluginContext` and adds the
 * `ctx.jobs` reporter; every capability is brokered by the host sandbox.
 */
export interface JobContext {
  storeId: number
  permissions: PluginPermission[]
  config: Record<string, unknown>
  http: PluginHttp
  db: PluginDB
  ai: PluginAI
  files: PluginFiles
  products: PluginProducts
  realtime: PluginRealtime
  email: PluginEmail
  jobs: PluginJobReporter
}

/** Contract a plugin implements for each job type declared in its manifest. */
export interface PluginJobHandlers {
  /** Runs once before the first step; return the initial state. */
  init?(input: unknown, ctx: JobContext): Promise<unknown> | unknown
  /** Runs repeatedly; return `done: true` when the job is finished. */
  step(state: unknown, ctx: JobContext): Promise<PluginJobStepResult> | PluginJobStepResult
  /** Runs once after the last step (best effort). */
  finalize?(state: unknown, ctx: JobContext): Promise<unknown> | unknown
}

export type PluginJob = PluginJobHandlers | ((input: unknown, ctx: JobContext) => Promise<unknown>)

// ─── Plugin exports ──────────────────────────────────────────────────────────

export interface PluginExports {
  init?(ctx: PluginContext): void | Promise<void>
  destroy?(): void | Promise<void>
  /** Chunked job handlers (`{ init, step, finalize }`) keyed by declared type. */
  jobs?: Record<string, PluginJob>
  apiRoutes?: Record<string, Record<string, (ctx: PluginContext, request: PluginApiRequest) => Promise<unknown>>>
  /**
   * Storefront order-detail sections ("Digital deliveries"). Runs in the
   * sandbox with a store-scoped ctx when the manifest declares `delivery: true`.
   */
  deliveryProvider?(
    storeId: number,
    order: Record<string, unknown>,
    ctx: PluginContext,
  ): Promise<{ id: string; title: string; items: { label: string; value: string }[] } | null>
  hooks?: Record<string, (payload: unknown, ctx: PluginContext) => Promise<unknown>>
}

/** Identity helper for type inference in plugin entry files. */
export function definePlugin<T extends PluginExports>(plugin: T): T {
  return plugin
}
