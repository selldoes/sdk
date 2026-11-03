import fs from "node:fs"
import { collectBundledPackages, collectExternals, collectImportedPackages, formatBytes } from "./bundle-analysis.mjs"
import { describeLoadError, evaluateBundle } from "./evaluate.mjs"
import { SANDBOX_LIMITS } from "./limits.mjs"

/**
 * Checks a built bundle against the sandbox contract.
 * Returns `{ ok, errors, warnings, bytes, sizeKb, externals, packages, imported,
 * missingDependencies, unusedDependencies, load }` — never throws.
 *
 * `nodeDependencies` lists packages used only by `"runtime": "node"` entries:
 * they are legitimately absent from the sandbox bundle and are not reported as
 * unused.
 */
export function checkSandboxBundle({ bundlePath, metafile, manifest, nodeDependencies = [] } = {}) {
  const errors = []
  const warnings = []
  let bytes = 0
  let sizeKb = 0

  try {
    bytes = fs.statSync(bundlePath).size
    sizeKb = Number((bytes / 1024).toFixed(1))
  } catch (error) {
    errors.push(`Could not read the bundle (${error.message})`)
  }

  if (bytes > SANDBOX_LIMITS.maxBundleBytes) {
    errors.push(`bundle is ${formatBytes(bytes)} — the sandbox limit is 4 MB`)
  } else if (bytes > SANDBOX_LIMITS.warnBundleBytes) {
    warnings.push(`bundle is ${formatBytes(bytes)} — getting close to the 4 MB sandbox limit`)
  }

  const externals = collectExternals(metafile)
  for (const external of externals) {
    errors.push(`"${external}" is left as an external require — the sandbox has no require()`)
  }

  const packages = collectBundledPackages(metafile)
  const imported = collectImportedPackages(metafile)
  const declared = manifest?.dependencies ?? {}
  const missingDependencies = imported.filter((name) => !(name in declared))
  for (const name of missingDependencies) {
    errors.push(`"${name}" is bundled but not declared in plugin.json dependencies — the platform will not install it`)
  }
  const nodeOnly = new Set(nodeDependencies.map((name) => String(name)))
  const unusedDependencies = Object.keys(declared).filter((name) => !packages.includes(name) && !nodeOnly.has(name))
  for (const name of unusedDependencies) {
    warnings.push(`"${name}" is declared in plugin.json but was not bundled by this build`)
  }

  const load =
    bytes > 0 && externals.length === 0
      ? evaluateBundle(bundlePath)
      : { ok: false, error: "skipped (bundle did not build cleanly)" }
  if (!load.ok) {
    errors.push(`bundle failed to load in the sandbox: ${describeLoadError(load.error)}`)
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    bytes,
    sizeKb,
    externals,
    packages,
    imported,
    missingDependencies,
    unusedDependencies,
    load,
  }
}

/** Human-readable one-liner for logs. */
export function formatSandboxIssues(check) {
  const lines = []
  for (const error of check.errors) lines.push(`✗ ${error}`)
  for (const warning of check.warnings) lines.push(`! ${warning}`)
  return lines.join("\n")
}
