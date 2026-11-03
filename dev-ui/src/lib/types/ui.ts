/** Dashboard UI entries and the scaffold endpoints that regenerate them. */

import type { PluginManifest, Validation } from "./manifest"

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
