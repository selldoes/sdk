import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { build, context } from "esbuild"
import { readJson } from "../../util.mjs"
import { checkSandboxBundle, nodeBuildOptions, nodeJobLimits, sandboxBuildOptions } from "../sandbox.mjs"

const nodeRequire = createRequire(import.meta.url)

/** Normalizes a declared route path (`/tickets/` → `/tickets`). */
export function cleanPath(value) {
  const trimmed = String(value ?? "").replace(/\/+$/g, "")
  return trimmed.length > 0 ? trimmed : "/"
}

/**
 * Loads the plugin's runtime bundle locally, mirroring how the host calls
 * `apiRoutes`, `jobs`, `hooks` and `deliveryProvider`.
 *
 * The bundle is rebuilt with esbuild (dependencies inlined, CommonJS) and
 * re-required after every change so edits are picked up on the next request.
 */
export class PluginRunner {
  constructor({ pluginDir, manifest, devDir, log = () => {} }) {
    this.pluginDir = pluginDir
    this.manifest = manifest
    this.devDir = devDir
    this.log = log
    this.bundlePath = path.join(devDir, "bundle.cjs")
    this.exports = null
    this.nodeHandlers = new Map()
    this.watchContext = null
    this.nodeWatchContexts = []
    this.rebuilds = 0
    /** Result of the last sandbox check (errors, warnings, packages…). */
    this.sandbox = null
    /** Set when the bundle failed to evaluate in the sandbox (exports are null). */
    this.loadError = null
    /** Set when a Node job bundle failed to load (its handler is absent). */
    this.nodeLoadError = null
  }

  /** True when any declared job runs on the Node tier. */
  hasNodeJobs() {
    return (this.manifest.jobs ?? []).some((job) => job?.runtime === "node")
  }

  jobDefinition(type) {
    return (this.manifest.jobs ?? []).find((job) => job?.type === type) ?? null
  }

  /** One build unit per Node job: its entry file and output bundle. */
  nodeJobEntries() {
    return (this.manifest.jobs ?? [])
      .filter((job) => job?.runtime === "node")
      .map((job) => {
        const type = String(job.type)
        const relative = String(job.entry ?? this.manifest.entry ?? "./index.js").replace(/^\.\//, "")
        return {
          type,
          definition: job,
          source: path.join(this.pluginDir, relative),
          outfile: path.join(this.devDir, `node-${type.replace(/[^a-z0-9_-]/gi, "_")}.cjs`),
        }
      })
  }

  entryPoint() {
    return path.join(this.pluginDir, String(this.manifest.entry ?? "./index.js").replace(/^\.\//, ""))
  }

  buildOptions(extraPlugins = []) {
    // The same profile as `selldoes build` — browser-resolved, Node builtins
    // polyfilled, nothing left as an external require. What you preview is
    // what the sandbox will execute.
    return sandboxBuildOptions({
      pluginDir: this.pluginDir,
      entryPoints: [this.entryPoint()],
      outfile: this.bundlePath,
      metafile: true,
      extraPlugins,
    })
  }

  nodeBuildOptions(job, extraPlugins = []) {
    // Node-tier jobs build like a real Node app: plugin files bundled, npm
    // packages left external so node_modules (native addons included) works.
    return nodeBuildOptions({
      pluginDir: this.pluginDir,
      entryPoints: [job.source],
      outfile: job.outfile,
      extraPlugins,
    })
  }

  /** Builds + loads every Node job bundle. Load failures are logged, not thrown. */
  async buildNode() {
    for (const job of this.nodeJobEntries()) {
      const result = await build(this.nodeBuildOptions(job))
      this.finishNodeBuild(job, result)
    }
    return this.nodeHandlers
  }

  finishNodeBuild(job, result) {
    for (const warning of result.warnings) this.log(`[esbuild:node] ${warning.text}`)
    try {
      const resolved = nodeRequire.resolve(job.outfile)
      delete nodeRequire.cache[resolved]
      const mod = nodeRequire(job.outfile)
      const handler = typeof mod === "function" ? mod : typeof mod?.default === "function" ? mod.default : mod?.jobs?.[job.type]
      if (typeof handler !== "function") {
        throw new Error("does not export a handler (module.exports = async (input, ctx) => …)")
      }
      this.nodeHandlers.set(job.type, handler)
      this.nodeLoadError = null
    } catch (error) {
      this.nodeLoadError = error instanceof Error ? error.message : String(error)
      this.nodeHandlers.delete(job.type)
      this.log(`[node] ✗ ${job.type}: ${this.nodeLoadError}`)
    }
    return this.nodeHandlers.get(job.type) ?? null
  }

  /** Logs esbuild/sandbox output and loads the bundle, never throwing. */
  finishBuild(result) {
    for (const warning of result.warnings) this.log(`[esbuild] ${warning.text}`)
    this.sandbox = checkSandboxBundle({
      bundlePath: this.bundlePath,
      metafile: result.metafile,
      manifest: this.manifest,
    })
    for (const warning of this.sandbox.warnings) this.log(`[sandbox] ${warning}`)
    for (const error of this.sandbox.errors) this.log(`[sandbox] ✗ ${error}`)
    this.loadError = null
    try {
      this.load()
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error)
      this.exports = null
      this.log(`[sandbox] ✗ bundle failed to load: ${this.loadError}`)
    }
    return this.sandbox
  }

  async build() {
    fs.mkdirSync(this.devDir, { recursive: true })
    const result = await build(this.buildOptions())
    this.finishBuild(result)
    if (this.hasNodeJobs()) await this.buildNode()
    return this.exports
  }

  /** Rebuilds on every change; `onRebuild` runs after a successful build. */
  async watch(onRebuild) {
    this.watchContext = await context(
      this.buildOptions([
        {
          name: "selldoes-reload",
          setup: (buildContext) => {
            buildContext.onEnd((result) => {
              if (result.errors.length > 0) {
                for (const error of result.errors) {
                  const location = error.location ? `${error.location.file}:${error.location.line}:${error.location.column}: ` : ""
                  this.log(`[esbuild] ${location}${error.text}`)
                }
                return
              }
              this.rebuilds += 1
              try {
                this.finishBuild(result)
              } catch (error) {
                this.loadError = error instanceof Error ? error.message : String(error)
                this.log(`[sandbox] ✗ ${this.loadError}`)
              }
              onRebuild?.()
            })
          },
        },
      ]),
    )
    await this.watchContext.watch()
    for (const job of this.nodeJobEntries()) {
      const nodeContext = await context(
        this.nodeBuildOptions(job, [
          {
            name: "selldoes-node-reload",
            setup: (buildContext) => {
              buildContext.onEnd((result) => {
                if (result.errors.length > 0) {
                  for (const error of result.errors) this.log(`[esbuild:node] ${error.text}`)
                  return
                }
                this.finishNodeBuild(job, result)
              })
            },
          },
        ]),
      )
      await nodeContext.watch()
      this.nodeWatchContexts.push(nodeContext)
    }
  }

  async stopWatching() {
    if (this.watchContext) {
      await this.watchContext.dispose()
      this.watchContext = null
    }
    for (const nodeContext of this.nodeWatchContexts) await nodeContext.dispose()
    this.nodeWatchContexts = []
  }

  load() {
    const cached = nodeRequire.cache[nodeRequire.resolve(this.bundlePath)]
    if (cached) delete nodeRequire.cache[nodeRequire.resolve(this.bundlePath)]
    this.exports = nodeRequire(this.bundlePath)
    return this.exports
  }

  /** The loaded bundle, or a clear error when the sandbox refused it. */
  bundle() {
    if (this.loadError) throw new Error(`The bundle failed to load in the sandbox: ${this.loadError}`)
    if (!this.exports) throw new Error("The plugin bundle has not been built yet")
    return this.exports
  }

  routes() {
    return this.bundle().apiRoutes ?? {}
  }

  /** Mirrors the host's handler lookup (leading slash optional, trailing slash tolerated). */
  resolveHandler(declaredPath, method) {
    const routes = this.routes()
    const clean = cleanPath(declaredPath)
    const candidates = [clean, clean.replace(/^\//, ""), `${clean}/`]
    for (const key of candidates) {
      const group = routes[key]
      if (group && typeof group === "object") {
        const upper = method.toUpperCase()
        const handler = group[upper] ?? group[upper.toLowerCase()] ?? group[upper[0] + upper.slice(1).toLowerCase()]
        if (typeof handler === "function") return handler
      }
    }
    return null
  }

  async invokeRoute(declaredPath, request, ctx) {
    const handler = this.resolveHandler(declaredPath, request.method)
    if (!handler) throw new Error(`No handler for ${request.method} ${declaredPath}`)
    return handler(ctx, request)
  }

  /**
   * Runs a job for up to `maxTicks` iterations. Supports both shapes:
   *
   *   jobs[type] = async (input, ctx) => result        (legacy function form)
   *   jobs[type] = { init, step, finalize }            (host contract)
   *
   * Returns a transcript the preview UI renders:
   * `{ kind, ticks, state, result, done }`.
   */
  async runJob(type, input, ctx, maxTicks = 50) {
    const definition = this.jobDefinition(type)
    if (definition?.runtime === "node") return this.runNodeJob(type, input, ctx, definition)

    const job = this.bundle().jobs?.[type]
    if (!job) throw new Error(`Job "${type}" is not exported from the bundle`)

    if (typeof job === "function") {
      const ticks = []
      let last
      for (let tick = 0; tick < maxTicks; tick += 1) {
        last = await job(input, ctx)
        ticks.push(last)
        if (last === undefined || last === null || last === false) break
        if (typeof last === "object" && last.done === true) break
      }
      return {
        kind: "function",
        ticks,
        state: null,
        result: last && typeof last === "object" ? last.result ?? null : last ?? null,
        done: true,
      }
    }

    if (typeof job.step !== "function") {
      throw new Error(`Job "${type}" exports neither a function nor an { init, step, finalize } handler`)
    }

    let state = typeof job.init === "function" ? await job.init(input, ctx) : undefined
    const ticks = []
    let done = false
    let result = null

    for (let tick = 0; tick < maxTicks; tick += 1) {
      const stepResult = (await job.step(state, ctx)) ?? {}
      ticks.push(stepResult)
      if (stepResult && typeof stepResult === "object") {
        if ("state" in stepResult) state = stepResult.state
        if (stepResult.done === true) {
          done = true
          result = stepResult.result ?? null
          break
        }
      } else if (stepResult === undefined || stepResult === null || stepResult === false) {
        done = true
        break
      }
    }

    if (done && typeof job.finalize === "function") {
      const finalResult = await job.finalize(state, ctx)
      if (finalResult !== undefined) result = finalResult
    }

    return { kind: "chunked", ticks, state, result, done }
  }

  /**
   * Runs a `runtime: "node"` job once in the local Node process — the same
   * environment the production Node sandbox provides, bounded by the job's
   * declared timeout. Returns the same transcript shape as chunked jobs.
   */
  async runNodeJob(type, input, ctx, definition) {
    if (!this.nodeHandlers.has(type)) await this.buildNode()
    const handler = this.nodeHandlers.get(type)
    if (typeof handler !== "function") {
      throw new Error(
        `Node job "${type}" has no loaded handler${this.nodeLoadError ? `: ${this.nodeLoadError}` : " — check its entry file"}`,
      )
    }
    const { timeoutMs } = nodeJobLimits(definition)
    let timer
    try {
      const result = await Promise.race([
        Promise.resolve(handler(input, ctx)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Node job "${type}" exceeded its ${timeoutMs}ms timeout`)), timeoutMs)
        }),
      ])
      return { kind: "node", ticks: [result], state: null, result: result ?? null, done: true }
    } finally {
      clearTimeout(timer)
    }
  }

  async runHook(name, payload, ctx) {
    const declared = this.manifest.hooks?.[name]
    const bundled = this.bundle().hooks?.[name]
    if (typeof bundled === "function") return bundled(payload, ctx)
    if (declared?.handler) {
      throw new Error(
        `Hook "${name}" declares handler ${declared.handler}, which is not part of the bundle. ` +
          `Export it from your entry as hooks["${name}"] to preview it here (the host loads handler files separately).`,
      )
    }
    throw new Error(`Hook "${name}" is not exported as hooks["${name}"]`)
  }

  async runDelivery(order, ctx) {
    const bundle = this.bundle()
    if (typeof bundle.deliveryProvider !== "function") {
      throw new Error("The plugin does not export deliveryProvider()")
    }
    return bundle.deliveryProvider(ctx.storeId, order, ctx)
  }

  hasUi() {
    return Boolean(this.manifest.ui?.entry) || (this.manifest.dashboardPages ?? []).some((page) => page?.entry)
  }

  uiEntry() {
    return this.manifest.ui?.entry ?? null
  }
}

export function loadManifest(pluginDir) {
  return readJson(path.join(pluginDir, "plugin.json"))
}
