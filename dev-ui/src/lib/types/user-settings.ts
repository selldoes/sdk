/** User (global) settings — ~/.selldoes/settings.json. */

import type { BumpMode } from "./config"

/** GET /__ws/user-settings (and /__dev/user-settings) — never contains the raw key. */
export interface UserSettingsResponse {
  assistant: {
    provider: string | null
    model: string | null
    baseUrl: string | null
    apiKeyMasked: string | null
    apiKeySet: boolean
    maxTokens: number | null
  }
  defaultDir: string | null
  editor: string | null
  publish: { bump: BumpMode | null }
  /** Absolute path of the settings file (shown in the UI for transparency). */
  file: string
}

/** POST body for the user-settings endpoints. undefined = keep, null/"" = clear. */
export interface UserSettingsPatch {
  assistant?: {
    provider?: string | null
    model?: string | null
    apiKey?: string | null
    baseUrl?: string | null
    maxTokens?: number | null
  }
  defaultDir?: string | null
  editor?: string | null
  publish?: { bump?: BumpMode | null }
}
