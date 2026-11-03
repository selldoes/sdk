/** Dev-server bootstrap payload and live activity/status snapshots. */

import type { PluginManifest, PluginScheduleDefinition, Validation } from "./manifest"

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
  schedules: PluginScheduleDefinition[]
  snapshots: number
}
