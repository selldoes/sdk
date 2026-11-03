/** AI assistant chat results, file edits and provider configuration. */

import type { PluginManifest } from "./manifest"

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

export interface AssistantConfigResponse {
  assistant: {
    provider?: string | null
    model?: string | null
    baseUrl?: string | null
    apiKey?: string | null
    apiKeySet?: boolean
    /** The per-project `assistant.model` override from selldoes.config.json, when set. */
    projectModel?: string | null
  }
  env: Record<string, boolean | string | null>
}
