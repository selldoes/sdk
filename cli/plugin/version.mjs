/**
 * Semver helpers shared by the CLI, the dev server and the ship page.
 *
 * Deliberately dependency-free: `selldoes version patch` and the Ship page's
 * "bump before publish" must compute the same next version, and the platform's
 * version guard mirrors the same rules.
 */

/** Strict-enough semver: x.y.z with optional -prerelease / +build suffix. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

/** Bump modes accepted by `selldoes version <mode>` and the release setting. */
export const BUMP_MODES = ["patch", "minor", "major"]

/** True for a valid x.y.z (optionally -prerelease / +build) version. */
export function isValidVersion(value) {
  return SEMVER.test(String(value ?? "").trim())
}

/** Parsed version parts, or null when the value is not semver. */
export function parseVersion(value) {
  const match = SEMVER.exec(String(value ?? "").trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    build: match[5] ?? null,
  }
}

/**
 * "1.2.3" + patch|minor|major → "1.2.4" / "1.3.0" / "2.0.0".
 * Prerelease/build suffixes are dropped (a release bump moves forward).
 */
export function bumpVersion(value, mode = "patch") {
  const parsed = parseVersion(value)
  if (!parsed) throw new Error(`"${value}" is not a valid x.y.z version`)
  const clean = String(mode ?? "").trim().toLowerCase()
  if (!BUMP_MODES.includes(clean)) {
    throw new Error(`Unknown bump "${mode}" — use patch, minor or major`)
  }
  if (clean === "major") return `${parsed.major + 1}.0.0`
  if (clean === "minor") return `${parsed.major}.${parsed.minor + 1}.0`
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}

/** Numeric x.y.z comparison; prerelease suffixes are ignored. Returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return 0
}
