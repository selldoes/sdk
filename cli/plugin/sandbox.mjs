/**
 * Sandbox build/check layer for plugin bundles.
 *
 * The implementation lives in `./sandbox/*` (esbuild options, builtin/helper
 * plugins, bundle analysis, evaluation, checks and package probes). This module
 * re-exports the public surface so importers — `build`, the dev runner, the
 * Packages page and the tests — keep working unchanged.
 */
export { nodeBuildOptions, sandboxBuildOptions } from "./sandbox/build-options.mjs"
export {
  collectBundledPackages,
  collectExternalPackages,
  collectExternals,
  collectImportedPackages,
} from "./sandbox/bundle-analysis.mjs"
export { checkSandboxBundle, formatSandboxIssues } from "./sandbox/check.mjs"
export { describeLoadError, evaluateBundle } from "./sandbox/evaluate.mjs"
export { NODE_JOB_DEFAULTS, NODE_JOB_LIMITS, nodeJobLimits, SANDBOX_LIMITS } from "./sandbox/limits.mjs"
export { BLOCKED_BUILTINS, sandboxNodePlugin, sandboxPlugins } from "./sandbox/node-builtins.mjs"
export { GLOBALS_SHIM } from "./sandbox/paths.mjs"
export { probeNodePackage, probePackage } from "./sandbox/probe.mjs"
export { resolveSdkHelperPath, sdkHelpersPlugin } from "./sandbox/sdk-helpers.mjs"
