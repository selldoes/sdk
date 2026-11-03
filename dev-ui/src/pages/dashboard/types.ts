import type { PluginDashboardSection } from "@/lib/types"

/** A dashboard page resolved from `dashboardPages[]` (or the bare `ui.entry` fallback). */
export interface ResolvedPage {
  label: string
  path: string
  icon?: string
  group?: string
  entry: string | null
  sections?: PluginDashboardSection[]
}
