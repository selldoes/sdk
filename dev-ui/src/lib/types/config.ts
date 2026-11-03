/** selldoes.config.json sections and the /__dev/config + settings endpoints. */

import type { AssistantConfigResponse } from "./assistant"
import type { PluginConfigField } from "./manifest"

export interface SettingsResponse {
  configSchema: PluginConfigField[]
  settings: Record<string, unknown>
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

/** How `bump before publish` increases the version. */
export type BumpMode = "patch" | "minor" | "major"

/** The `publish` section of selldoes.config.json (Ship page defaults). */
export interface PublishConfig {
  bump: BumpMode
}

/** Full /__dev/config payload — assistant + env + dev-server + publish settings. */
export interface DevConfigResponse extends AssistantConfigResponse {
  server: DevServerConfig
  publish: PublishConfig
  store: StoreConnectionView
}

/** Live store connection — ctx.products proxies to a real store when active. */
export interface StoreConnectionView {
  live: boolean
  appUrl: string | null
  storeId: number | null
  storeSlug: string | null
  apiKeySet: boolean
  apiKeyMasked: string | null
  /** True while the bridge is live (server-side resolved). */
  active?: boolean
}

/** GET /__dev/store — connection state + whether the bridge is live. */
export interface StoreStatusResponse extends StoreConnectionView {
  connection?: { appUrl: string; storeId: number; storeSlug: string } | null
  storeName?: string
}

/** POST /__dev/store/verify — key checked against the platform, nothing saved. */
export interface StoreVerifyResponse {
  ok: boolean
  appUrl: string
  userId: number | null
  apiKeySet: boolean
  stores: Array<{ id: number; slug: string; name: string }>
}

/** Sections accepted by POST /__dev/config (all optional). */
export interface SaveFileConfigInput {
  assistant?: Record<string, unknown>
  server?: Partial<DevServerConfig>
  ai?: { mockReply?: string | null }
  email?: { disabled?: boolean }
  sampleJobs?: Record<string, unknown> | null
  publish?: { bump?: BumpMode }
  /** "project" pins the assistant `model` into selldoes.config.json (override only). */
  scope?: "project"
}
