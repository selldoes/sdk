import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { packageManagerEnv, readJson } from "../util.mjs"

/**
 * Dependency helpers shared by `selldoes build/validate`, the `selldoes add`
 * command and the Packages page. The manifest (`plugin.json.dependencies`) is
 * the source of truth the platform installs from, so every add/remove keeps it
 * in sync with the real `node_modules` install.
 */

const NAME_RE = /^(@[a-z0-9-_.]+\/)?[a-z0-9-_.]+$/i
// Mirrors platform/src/lib/plugins/sandbox/dependencies.ts — registry ranges only.
const SPEC_RE = /^[\^~]?\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/
const SPEC_SHORT_RE = /^[\^~]?\d+\.\d+$/
export const MAX_DEPENDENCIES = 25

/** Returns an error string, or null when the spec is publishable. */
export function validateDependencySpec(name, spec) {
  if (!NAME_RE.test(String(name ?? ""))) return `invalid package name "${name}"`
  const value = String(spec ?? "").trim()
  if (!value) return `"${name}" needs a version range`
  if (!SPEC_RE.test(value) && !SPEC_SHORT_RE.test(value)) {
    return `"${name}" must use a registry version range (got "${value}") — wildcards, URLs, git and file specs are not allowed`
  }
  return null
}

export function validateDependencies(dependencies, { max = MAX_DEPENDENCIES } = {}) {
  const errors = []
  const names = Object.keys(dependencies ?? {})
  if (names.length > max) errors.push(`too many dependencies (${names.length}); the limit is ${max}`)
  for (const name of names) {
    const error = validateDependencySpec(name, dependencies[name])
    if (error) errors.push(error)
  }
  return { ok: errors.length === 0, errors }
}

export function readManifest(pluginDir) {
  return readJson(path.join(pluginDir, "plugin.json"))
}

/** Writes `dependencies` back to plugin.json (sorted; removed when empty). */
export function writeDependencies(pluginDir, dependencies) {
  const manifestPath = path.join(pluginDir, "plugin.json")
  const manifest = readJson(manifestPath)
  const sorted = {}
  for (const key of Object.keys(dependencies ?? {}).sort()) sorted[key] = dependencies[key]
  if (Object.keys(sorted).length > 0) manifest.dependencies = sorted
  else delete manifest.dependencies
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/** Which package manager owns this project (lockfile detection, npm default). */
export function detectPackageManager(pluginDir) {
  if (fs.existsSync(path.join(pluginDir, "pnpm-lock.yaml"))) return "pnpm"
  if (fs.existsSync(path.join(pluginDir, "yarn.lock"))) return "yarn"
  if (fs.existsSync(path.join(pluginDir, "bun.lockb")) || fs.existsSync(path.join(pluginDir, "bun.lock"))) return "bun"
  return "npm"
}

function installCommand(pm, spec) {
  if (pm === "pnpm") return `pnpm add ${spec}`
  if (pm === "yarn") return `yarn add ${spec}`
  if (pm === "bun") return `bun add ${spec}`
  return `npm install ${spec} --save --no-audit --no-fund`
}

function removeCommand(pm, name) {
  if (pm === "pnpm") return `pnpm remove ${name}`
  if (pm === "yarn") return `yarn remove ${name}`
  if (pm === "bun") return `bun remove ${name}`
  return `npm uninstall ${name} --no-audit --no-fund`
}

/** Runs one shell command in the project, capturing the tail of its output. */
export function runPackageCommand(command, { cwd, timeoutMs = 180_000 } = {}) {
  // Clean env: inherited npm_config_* vars (npm_config_allow_scripts in
  // particular) make npm 11 reject project-scoped commands with EALLOWSCRIPTS.
  const result = spawnSync(command, {
    cwd,
    encoding: "utf8",
    shell: true,
    windowsHide: true,
    timeout: timeoutMs,
    env: packageManagerEnv(),
  })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  if (result.error) return { ok: false, output: result.error.message, command }
  if (result.status !== 0) return { ok: false, output: output.split("\n").filter(Boolean).slice(-8).join("\n"), command }
  return { ok: true, output, command }
}

/** Reads the version npm actually installed (scoped names supported). */
export function installedVersion(pluginDir, name) {
  try {
    const file = path.join(pluginDir, "node_modules", ...String(name).split("/"), "package.json")
    return JSON.parse(fs.readFileSync(file, "utf8")).version ?? null
  } catch {
    return null
  }
}

/**
 * Ensures the plugin has a package.json that lists every declared dependency.
 * `npm install <pkg>` prunes packages that aren't in package.json, so an
 * install must not run before the manifest's dependencies are materialized.
 */
export function ensurePackageJson(pluginDir, manifest) {
  const file = path.join(pluginDir, "package.json")
  let pkg = {}
  if (fs.existsSync(file)) {
    try {
      pkg = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
      throw new Error("package.json exists but is not valid JSON")
    }
  }
  const dependencies = { ...(manifest?.dependencies ?? {}), ...(pkg.dependencies ?? {}) }
  // The manifest wins when both declare the same package.
  for (const [name, range] of Object.entries(manifest?.dependencies ?? {})) dependencies[name] = range
  const next = {
    ...pkg,
    name: pkg.name ?? manifest?.slug ?? path.basename(pluginDir),
    version: pkg.version ?? manifest?.version ?? "0.0.0",
    private: true,
    dependencies,
  }
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

/**
 * Installs a package and declares it in plugin.json. `range` is optional; the
 * installed version is pinned as `^x.y.z` when omitted.
 */
export async function addDependency({ pluginDir, name, range, log = () => {} }) {
  const packageName = String(name ?? "").trim()
  if (!NAME_RE.test(packageName)) throw new Error(`Invalid package name "${name}"`)
  if (range !== undefined && range !== null && String(range).trim() !== "") {
    const error = validateDependencySpec(packageName, range)
    if (error) throw new Error(error)
  }
  const pm = detectPackageManager(pluginDir)
  const spec = range ? `${packageName}@${range}` : packageName
  const command = installCommand(pm, spec)
  ensurePackageJson(pluginDir, readManifest(pluginDir))
  log(`  ${command}`)
  const result = runPackageCommand(command, { cwd: pluginDir })
  if (!result.ok) throw new Error(`Could not install ${packageName}:\n${result.output}`)

  const version = installedVersion(pluginDir, packageName)
  const saved = range ? String(range) : version ? `^${version}` : null
  if (!saved) throw new Error(`Installed ${packageName} but could not read its version — declare it in plugin.json manually`)

  const manifest = readManifest(pluginDir)
  writeDependencies(pluginDir, { ...(manifest.dependencies ?? {}), [packageName]: saved })
  return { name: packageName, range: saved, version, manager: pm, command }
}

/** Uninstalls a package and removes it from plugin.json. */
export async function removeDependency({ pluginDir, name, log = () => {} }) {
  const packageName = String(name ?? "").trim()
  if (!NAME_RE.test(packageName)) throw new Error(`Invalid package name "${name}"`)
  const pm = detectPackageManager(pluginDir)
  const command = removeCommand(pm, packageName)
  ensurePackageJson(pluginDir, readManifest(pluginDir))
  log(`  ${command}`)
  const result = runPackageCommand(command, { cwd: pluginDir })
  if (!result.ok) throw new Error(`Could not remove ${packageName}:\n${result.output}`)
  const manifest = readManifest(pluginDir)
  const dependencies = { ...(manifest.dependencies ?? {}) }
  delete dependencies[packageName]
  writeDependencies(pluginDir, dependencies)
  return { name: packageName, manager: pm, command }
}
