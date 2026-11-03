/** Dependency packages, sandbox size and npm search results. */

export type PackageStatus = "ok" | "warn" | "blocked" | "missing"

export interface PackageInfo {
  name: string
  declared: boolean
  range?: string
  installed: string | null
  status: PackageStatus
  message: string
  sizeKb?: number | null
  bundled: boolean
  /** Runtime the rating targets: the QuickJS sandbox or a Node job. */
  runtime?: "quickjs" | "node"
}

export interface SandboxSummary {
  ok: boolean
  errors: string[]
  warnings: string[]
  sizeKb: number
}

export interface PackagesResponse {
  manager: string
  dependencies: Record<string, string>
  packages: PackageInfo[]
  /** Imported by the bundle but missing from plugin.json dependencies. */
  missing: string[]
  sandbox: SandboxSummary
}

export interface NpmSearchResult {
  name: string
  version?: string
  description?: string
  date?: string | null
  publisher?: string | null
  links?: { npm?: string; homepage?: string }
}
