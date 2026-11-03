/** Ship page: developer account, version bumps and publish results. */

import type { BumpMode } from "./config"
import type { PluginManifest, Validation } from "./manifest"

/** Developer-account state for the Ship page (never contains the token). */
export interface DevAccount {
  connected: boolean
  appUrl?: string
  email?: string
  name?: string
  status?: string
  unreachable?: boolean
}

export interface VersionBumpResult {
  ok: boolean
  unchanged?: boolean
  previous: string
  version: string
  manifest: PluginManifest
  validation: Validation
  rebuildError?: string
}

export interface PublishInput {
  notes?: string
  bump?: { enabled: boolean; mode: BumpMode }
  price?: number
  currency?: string
  billingPeriod?: string
  trialDays?: number
}

export interface PublishResult {
  ok: boolean
  code?: string
  error?: string
  violations?: { message?: string }[]
  errors?: string[]
  version?: string
  release?: { slug?: string; version?: string; hash?: string } | null
  listing?: { slug?: string; status?: string; version?: string; price?: number; currency?: string } | null
  log?: string[]
  bumped?: { from: string; to: string } | null
}
