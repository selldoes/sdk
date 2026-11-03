import { json, readBody } from "../../../http.mjs"
import { addDependency, detectPackageManager, installedVersion, removeDependency } from "../../dependencies.mjs"
import { probeNodePackage, probePackage } from "../../sandbox.mjs"

/**
 * Packages page routes: declared npm dependencies with their sandbox/Node
 * runtime rating, registry search, and add/remove (which run npm and rebuild).
 *
 * `packagesPayload` is the shared payload builder; the mutation lock serializes
 * add/remove/check so concurrent clicks cannot interleave npm installs and
 * plugin.json/package.json writes.
 */
export function createPackagesRoutes({ pluginDir, manifestStore, runner, log, stream, rebuildAll }) {
  /** Package compatibility probes, keyed by `name@version`. */
  const packageProbeCache = new Map()
  /**
   * Serializes package mutations (add/remove/check). Concurrent clicks used to
   * interleave npm installs and plugin.json/package.json writes, corrupting
   * the manifest and double-rebuilding; now each mutation runs to completion
   * before the next starts.
   */
  let packageMutationChain = Promise.resolve()
  const withPackageMutationLock = (fn) => {
    const run = packageMutationChain.then(fn, fn)
    packageMutationChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * Packages page payload: declared dependencies, their runtime rating and the
   * packages the current bundle actually imports. QuickJS-imported packages run
   * the sandbox probe; everything else in a plugin with Node jobs is rated
   * against real Node, so `playwright`/`sharp` are not mislabelled.
   */
  const packagesPayload = async ({ refresh = false } = {}) => {
    const manifest = manifestStore.read()
    const dependencies = manifest.dependencies ?? {}
    const sandbox = runner.sandbox ?? {
      ok: true,
      errors: [],
      warnings: [],
      packages: [],
      imported: [],
      missingDependencies: [],
      sizeKb: 0,
    }
    const bundled = new Set(sandbox.packages ?? [])
    const importedByQuickJs = new Set(sandbox.imported ?? [])
    const nodePackages = runner.nodePackages ?? new Set()
    const hasNodeJobs = runner.hasNodeJobs()
    const declaredNames = Object.keys(dependencies)
    const missing = (sandbox.missingDependencies ?? []).filter((name) => !declaredNames.includes(name))

    const rate = async (name) => {
      const installed = installedVersion(pluginDir, name)
      // The QuickJS gate is the stricter one: if the sandboxed bundle imports
      // the package it must survive the sandbox. Otherwise a plugin with Node
      // jobs gets the Node rating.
      const usedByQuickJs = bundled.has(name) || importedByQuickJs.has(name)
      const runtime = usedByQuickJs ? "quickjs" : hasNodeJobs || nodePackages.has(name) ? "node" : "quickjs"
      const base = { name, declared: true, range: dependencies[name], installed, bundled: bundled.has(name), runtime }
      if (!installed) {
        return { ...base, status: "blocked", message: "not installed locally — add it again to install it" }
      }
      const key = `${runtime}:${name}@${installed}`
      if (refresh) packageProbeCache.delete(key)
      if (!packageProbeCache.has(key)) {
        const probe = runtime === "node" ? probeNodePackage({ pluginDir, name }) : probePackage({ pluginDir, name })
        packageProbeCache.set(
          key,
          probe.catch((error) => ({ status: "blocked", message: error.message, sizeKb: null })),
        )
      }
      const probe = await packageProbeCache.get(key)
      return { ...base, status: probe.status, message: probe.message, sizeKb: probe.sizeKb ?? null }
    }

    const packages = await Promise.all(declaredNames.map(rate))
    return {
      manager: detectPackageManager(pluginDir),
      dependencies,
      packages,
      missing,
      sandbox: { ok: sandbox.ok, errors: sandbox.errors, warnings: sandbox.warnings, sizeKb: sandbox.sizeKb },
    }
  }

  return async function handle(req, res, url) {
    const pathname = url.pathname

    if (req.method === "GET" && pathname === "/__dev/packages") {
      try {
        json(res, 200, await packagesPayload())
      } catch (error) {
        json(res, 500, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/packages/check") {
      await withPackageMutationLock(async () => {
        packageProbeCache.clear()
        json(res, 200, await packagesPayload({ refresh: true }))
      })
      return true
    }
    if (req.method === "GET" && pathname === "/__dev/packages/search") {
      const query = (url.searchParams.get("q") ?? "").trim()
      if (!query) {
        json(res, 200, { results: [] })
        return true
      }
      try {
        const response = await fetch(`https://registry.npmjs.org/-/v1/search?size=20&text=${encodeURIComponent(query)}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        })
        if (!response.ok) throw new Error(`npm registry answered HTTP ${response.status}`)
        const data = await response.json()
        const results = (data.objects ?? [])
          .map((entry) => ({
            name: entry.package?.name,
            version: entry.package?.version,
            description: entry.package?.description ?? "",
            date: entry.package?.date ?? null,
            publisher: entry.package?.publisher?.username ?? null,
            links: { npm: entry.package?.links?.npm, homepage: entry.package?.links?.homepage },
          }))
          .filter((entry) => entry.name)
        json(res, 200, { results })
      } catch (error) {
        json(res, 502, { error: `npm search failed: ${error.message}` })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/packages/add") {
      const body = await readBody(req)
      const name = String(body?.name ?? "").trim()
      if (!name) {
        json(res, 400, { error: "Missing package name" })
        return true
      }
      await withPackageMutationLock(async () => {
        manifestStore.snapshots.create({ reason: `add package ${name}`, files: ["plugin.json", "package.json"] })
        try {
          const result = await addDependency({ pluginDir, name, range: body?.range, log })
          packageProbeCache.clear()
          stream.broadcast("files", { paths: ["plugin.json", "package.json"] })
          stream.broadcast("snapshots", {})
          log(`package installed: ${result.name}@${result.range} (${result.manager})`)
          let rebuildError = null
          try {
            await rebuildAll()
          } catch (error) {
            rebuildError = error.message
          }
          json(res, 200, { ok: true, result, ...(rebuildError ? { rebuildError } : {}), ...(await packagesPayload()) })
        } catch (error) {
          json(res, 400, { error: error.message })
        }
      })
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/packages/remove") {
      const body = await readBody(req)
      const name = String(body?.name ?? "").trim()
      if (!name) {
        json(res, 400, { error: "Missing package name" })
        return true
      }
      await withPackageMutationLock(async () => {
        manifestStore.snapshots.create({ reason: `remove package ${name}`, files: ["plugin.json", "package.json"] })
        try {
          const result = await removeDependency({ pluginDir, name, log })
          packageProbeCache.clear()
          stream.broadcast("files", { paths: ["plugin.json", "package.json"] })
          stream.broadcast("snapshots", {})
          log(`package removed: ${result.name} (${result.manager})`)
          let rebuildError = null
          try {
            await rebuildAll()
          } catch (error) {
            rebuildError = error.message
          }
          json(res, 200, { ok: true, result, ...(rebuildError ? { rebuildError } : {}), ...(await packagesPayload()) })
        } catch (error) {
          json(res, 400, { error: error.message })
        }
      })
      return true
    }

    return false
  }
}
