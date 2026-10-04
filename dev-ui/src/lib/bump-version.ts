import type { BumpMode } from "./types"

/**
 * Client-side mirror of `cli/plugin/version.mjs` — the Ship page shows the
 * predicted next version before the server applies it. Keep the rules in sync.
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

export function isValidVersion(value: string): boolean {
  return SEMVER.test(String(value ?? "").trim())
}

export function bumpVersion(value: string, mode: BumpMode): string | null {
  const match = SEMVER.exec(String(value ?? "").trim())
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (mode === "major") return `${major + 1}.0.0`
  if (mode === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}
