/**
 * The sandbox contract, mirrored from the host runner:
 *   - bundles are CommonJS and must evaluate with **no** `require()`
 *   - browser-style resolution decides which package entry is bundled
 *   - Node builtins the sandbox refuses must fail the build, not the runtime
 *   - the host caps a bundle at 4 MB
 *
 * Keeping the build and check in one place means preview, `selldoes build`,
 * the Packages page and `selldoes publish` all agree about what will run.
 */
export const SANDBOX_LIMITS = {
  maxBundleBytes: 4 * 1024 * 1024,
  warnBundleBytes: 2 * 1024 * 1024,
  maxDependencies: 25,
  evalTimeoutMs: 5_000,
}

/** Node job defaults and bounds, mirrored by validation, build and the runner. */
export const NODE_JOB_DEFAULTS = { timeoutMs: 300_000, memoryMb: 512 }
export const NODE_JOB_LIMITS = {
  minTimeoutMs: 1_000,
  maxTimeoutMs: 30 * 60_000,
  minMemoryMb: 128,
  maxMemoryMb: 4096,
}

/** Clamps a Node job definition to the supported timeout/memory envelope. */
export function nodeJobLimits(job) {
  const timeoutMs = Number(job?.timeoutMs)
  const memoryMb = Number(job?.memoryMb)
  return {
    timeoutMs: Math.min(
      Math.max(
        Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : NODE_JOB_DEFAULTS.timeoutMs,
        NODE_JOB_LIMITS.minTimeoutMs,
      ),
      NODE_JOB_LIMITS.maxTimeoutMs,
    ),
    memoryMb: Math.min(
      Math.max(Number.isFinite(memoryMb) && memoryMb > 0 ? memoryMb : NODE_JOB_DEFAULTS.memoryMb, NODE_JOB_LIMITS.minMemoryMb),
      NODE_JOB_LIMITS.maxMemoryMb,
    ),
  }
}
