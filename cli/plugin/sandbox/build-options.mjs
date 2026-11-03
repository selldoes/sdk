import { sandboxPlugins } from "./node-builtins.mjs"
import { BUFFER_GLOBAL, GLOBALS_SHIM, PROCESS_GLOBAL } from "./paths.mjs"
import { sdkHelpersPlugin } from "./sdk-helpers.mjs"

/**
 * esbuild options for the plugin runtime bundle. Callers pass their own
 * entryPoints/outfile so `dev` can watch a rebuild and `build` can produce the
 * publish artifact.
 */
export function sandboxBuildOptions({
  pluginDir,
  entryPoints,
  outfile,
  minify = false,
  metafile = false,
  logLevel = "silent",
  extraPlugins = [],
  banner,
  define,
}) {
  return {
    entryPoints,
    outfile,
    absWorkingDir: pluginDir,
    bundle: true,
    platform: "browser",
    format: "cjs",
    target: "es2020",
    mainFields: ["browser", "module", "main"],
    conditions: ["browser"],
    inject: [GLOBALS_SHIM, BUFFER_GLOBAL, PROCESS_GLOBAL],
    define: { "process.env.NODE_ENV": '"production"', ...(define ?? {}) },
    logLevel,
    minify,
    metafile,
    ...(banner ? { banner: { js: banner } } : {}),
    plugins: [sdkHelpersPlugin(), ...sandboxPlugins(), ...extraPlugins],
  }
}

/**
 * esbuild options for the Node job artifact. Unlike the QuickJS bundle this is
 * a real Node build: `packages: "external"` keeps every npm dependency out of
 * the bundle so the execution image installs it from the plugin's lockfile
 * (native addons included), while the plugin's own files are still bundled.
 */
export function nodeBuildOptions({ pluginDir, entryPoints, outfile, metafile = false, logLevel = "silent", extraPlugins = [] }) {
  return {
    entryPoints,
    outfile,
    absWorkingDir: pluginDir,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    packages: "external",
    logLevel,
    metafile,
    plugins: [sdkHelpersPlugin({ nodeRuntime: true }), ...extraPlugins],
  }
}
