import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { builtinModules, createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** Injected into every runtime bundle (atob/btoa/TextEncoder/TextDecoder…). */
export const GLOBALS_SHIM = path.join(HERE, "sandbox", "globals.js")
const BUFFER_GLOBAL = path.join(HERE, "sandbox", "buffer-global.js")
const PROCESS_GLOBAL = path.join(HERE, "sandbox", "process-global.js")

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
      Math.max(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : NODE_JOB_DEFAULTS.timeoutMs, NODE_JOB_LIMITS.minTimeoutMs),
      NODE_JOB_LIMITS.maxTimeoutMs,
    ),
    memoryMb: Math.min(
      Math.max(Number.isFinite(memoryMb) && memoryMb > 0 ? memoryMb : NODE_JOB_DEFAULTS.memoryMb, NODE_JOB_LIMITS.minMemoryMb),
      NODE_JOB_LIMITS.maxMemoryMb,
    ),
  }
}

/**
 * Builtins the sandbox will never provide. Returning an esbuild error beats an
 * "empty" shim: the build fails with the import site instead of shipping a
 * bundle that throws when the code first calls `fs.readFileSync`.
 */
export const BLOCKED_BUILTINS = [
  "fs",
  "fs/promises",
  "child_process",
  "cluster",
  "dgram",
  "dns",
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "worker_threads",
  "vm",
  "wasi",
  "module",
  "inspector",
]

/** Browser shims @jspm/core ships for the allow-listed builtins. */
let browserNodelibsDir = null
function nodelibsBrowserDir() {
  if (!browserNodelibsDir) {
    // `nodelibs/fs` resolves under the "node" condition; step sideways into
    // the shipped browser shims regardless of the ambient conditions.
    const anchor = require.resolve("@jspm/core/nodelibs/fs")
    browserNodelibsDir = path.resolve(anchor, "../../browser")
  }
  return browserNodelibsDir
}

const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")))
const BLOCKED = new Set(BLOCKED_BUILTINS)

/**
 * esbuild plugin that maps Node builtins to @jspm/core browser shims and turns
 * blocked builtins into build errors. Written directly against @jspm/core
 * (the same shims `esbuild-plugin-polyfill-node` wraps) so path resolution is
 * explicit and works under `node -e`, `node --test` and installed CLIs alike.
 */
export function sandboxNodePlugin() {
  return {
    name: "selldoes-sandbox-node",
    setup(build) {
      const browserDir = nodelibsBrowserDir()
      build.onResolve({ filter: /^node:/ }, (args) => resolveBuiltin(args.path.replace(/^node:/, ""), browserDir))
      build.onResolve({ filter: /^[a-z_][a-z0-9_/.-]*$/ }, (args) => {
        if (!BUILTINS.has(args.path)) return null
        return resolveBuiltin(args.path, browserDir)
      })
    },
  }
}

function resolveBuiltin(name, browserDir) {
  if (BLOCKED.has(name)) {
    return {
      errors: [
        {
          text: `"${name}" is not available in the Selldoes sandbox — plugins run without filesystem, process or raw network access. Use the ctx capabilities (ctx.db, ctx.http, ctx.files…) instead.`,
        },
      ],
    }
  }
  const shim = path.join(browserDir, `${name}.js`)
  if (fs.existsSync(shim)) return { path: shim }
  return {
    errors: [{ text: `"${name}" has no browser shim and is not available in the Selldoes sandbox` }],
  }
}

/** esbuild plugins that polyfill Node builtins for the sandbox. */
export function sandboxPlugins() {
  return [sandboxNodePlugin()]
}

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
    plugins: [...sandboxPlugins(), ...extraPlugins],
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
    plugins: [...extraPlugins],
  }
}

// ─── Bundle analysis ─────────────────────────────────────────────────────────

const NODE_MODULES = /(?:^|[/\\])node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)(?=[/\\]|$)/

function normalizePackage(name) {
  return String(name).replace(/\\/g, "/")
}

/** Every dependency (direct or transitive) that ended up inside the bundle. */
export function collectBundledPackages(metafile) {
  const packages = new Set()
  for (const file of Object.keys(metafile?.inputs ?? {})) {
    const match = NODE_MODULES.exec(file)
    if (match) packages.add(normalizePackage(match[1]))
  }
  return [...packages].sort()
}

/** Packages the plugin's own source imports (not transitive dependencies). */
export function collectImportedPackages(metafile) {
  const packages = new Set()
  for (const [file, info] of Object.entries(metafile?.inputs ?? {})) {
    // Only the plugin's own files count: SDK-injected files live outside the
    // plugin dir (relative keys start with "..") and their imports are ours.
    if (path.isAbsolute(file) || file.startsWith("..") || NODE_MODULES.test(file)) continue
    for (const imported of info.imports ?? []) {
      if (imported.external) continue
      const match = NODE_MODULES.exec(imported.path ?? "")
      if (match) packages.add(normalizePackage(match[1]))
    }
  }
  return [...packages].sort()
}

/** Imports that stayed external — the sandbox has no `require()`, so these fail. */
export function collectExternals(metafile) {
  const externals = new Set()
  for (const info of Object.values(metafile?.inputs ?? {})) {
    for (const imported of info.imports ?? []) {
      if (!imported.external) continue
      const target = String(imported.path ?? "")
      // Injected shims resolve to absolute or relative file paths — not leaks.
      if (path.isAbsolute(target) || target.startsWith(".")) continue
      externals.add(target)
    }
  }
  return [...externals].sort()
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * Evaluates the finished bundle the way the host will: CommonJS, no `require`,
 * no `process`, no `Buffer`, no timers. Throws are returned, not raised.
 */
export function evaluateBundle(bundlePath) {
  let source
  try {
    source = fs.readFileSync(bundlePath, "utf8")
  } catch (error) {
    return { ok: false, error: `Could not read the bundle: ${error.message}` }
  }
  const sandbox = { console, module: { exports: {} }, exports: {} }
  sandbox.globalThis = sandbox
  sandbox.module.exports = sandbox.exports
  try {
    const context = vm.createContext(sandbox)
    new vm.Script(source, { filename: path.basename(bundlePath) }).runInContext(context, {
      timeout: SANDBOX_LIMITS.evalTimeoutMs,
    })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

/**
 * Turns a raw bundle-load error into an actionable explanation. The QuickJS
 * realm only carries the injected shims, so the common failures are a missing
 * browser global or a Node module the browser shims cannot emulate. The
 * Packages page and `selldoes build` both show this text, so authors can tell
 * a genuinely Node-only package from one that just needs a global the sandbox
 * does not carry. Unknown errors are returned unchanged.
 */
export function describeLoadError(error) {
  const message = String(error ?? "").trim()
  if (!message) return "the bundle failed to load in the sandbox"

  const missingGlobal = /^ReferenceError:\s*([A-Za-z_$][\w$]*)\s+is not defined/.exec(message)
  if (missingGlobal) {
    return `needs the "${missingGlobal[1]}" global, which the sandbox does not provide — use a browser-friendly alternative or a ctx capability`
  }

  const unsupportedModule = /Node\.js\s+([\w/-]+)\s+module is not supported by JSPM core/.exec(message)
  if (unsupportedModule) {
    return `needs the "${unsupportedModule[1]}" Node module, which the sandbox cannot emulate — use a ctx capability or a different package`
  }

  if (/crypto\.subtle|SubtleCrypto/.test(message)) {
    return "needs WebCrypto (crypto.subtle), which the sandbox does not provide — use a ctx capability or a different package"
  }

  if (/timed out/i.test(message)) {
    return `took longer than ${SANDBOX_LIMITS.evalTimeoutMs / 1000}s to load — the sandbox evaluates each bundle with a ${SANDBOX_LIMITS.evalTimeoutMs / 1000}s budget`
  }

  return message
}

/** Turns an esbuild failure into a short, actionable message. */
function describeBuildError(message) {
  const first = String(message ?? "").split("\n").find((line) => line.includes("ERROR:")) ?? String(message ?? "").split("\n")[0]
  const text = first.replace(/^.*?ERROR:\s*/, "").trim()
  if (/No loader is configured for "\.node"/.test(text)) {
    return "ships a native addon (.node), which the sandbox cannot run — use a pure-JS alternative"
  }
  return text
}

/**
 * Checks a built bundle against the sandbox contract.
 * Returns `{ ok, errors, warnings, bytes, sizeKb, externals, packages, imported,
 * missingDependencies, unusedDependencies, load }` — never throws.
 */
export function checkSandboxBundle({ bundlePath, metafile, manifest } = {}) {
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
  const unusedDependencies = Object.keys(declared).filter((name) => !packages.includes(name))
  for (const name of unusedDependencies) {
    warnings.push(`"${name}" is declared in plugin.json but was not bundled by this build`)
  }

  const load = bytes > 0 && externals.length === 0 ? evaluateBundle(bundlePath) : { ok: false, error: "skipped (bundle did not build cleanly)" }
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

/**
 * Probes a single package by bundling a virtual `require("<name>")` entry with
 * the sandbox profile. Used by the Packages page so a package can be rated
 * before it is ever executed. Returns a status the UI can render.
 */
export async function probePackage({ pluginDir, name }) {
  const os = await import("node:os")
  const esbuild = await import("esbuild")
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-probe-"))
  const entry = path.join(tempDir, "entry.js")
  fs.writeFileSync(entry, `module.exports = require(${JSON.stringify(name)})\n`)
  try {
    const result = await esbuild.build({
      ...sandboxBuildOptions({
        pluginDir,
        entryPoints: [entry],
        outfile: path.join(tempDir, "probe.js"),
        metafile: true,
      }),
      nodePaths: [path.join(pluginDir, "node_modules")],
      write: true,
    })
    const externals = collectExternals(result.metafile)
    const size = fs.statSync(path.join(tempDir, "probe.js")).size
    const load = evaluateBundle(path.join(tempDir, "probe.js"))
    if (externals.length > 0) {
      return {
        status: "blocked",
        message: `needs runtime require(): ${externals.slice(0, 3).join(", ")}`,
        sizeKb: Number((size / 1024).toFixed(1)),
      }
    }
    if (size > SANDBOX_LIMITS.maxBundleBytes) {
      return {
        status: "blocked",
        message: `bundles to ${formatBytes(size)} — over the 4 MB sandbox limit`,
        sizeKb: Number((size / 1024).toFixed(1)),
      }
    }
    if (!load.ok) {
      return { status: "blocked", message: describeLoadError(load.error), sizeKb: Number((size / 1024).toFixed(1)) }
    }
    if (size > SANDBOX_LIMITS.warnBundleBytes) {
      return {
        status: "warn",
        message: `works, but bundles to ${formatBytes(size)}`,
        sizeKb: Number((size / 1024).toFixed(1)),
      }
    }
    return { status: "ok", message: "bundles and loads in the sandbox", sizeKb: Number((size / 1024).toFixed(1)) }
  } catch (error) {
    const message = String(error?.message ?? error)
    return { status: "blocked", message: describeBuildError(message), sizeKb: null }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}
