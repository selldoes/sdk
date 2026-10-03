import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { build, context } from "esbuild"
import { readJson } from "../../util.mjs"

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
    this.watchContext = null
    this.rebuilds = 0
  }

  entryPoint() {
    return path.join(this.pluginDir, String(this.manifest.entry ?? "./index.js").replace(/^\.\//, ""))
  }

  buildOptions(extraPlugins = []) {
    return {
      entryPoints: [this.entryPoint()],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "es2020",
      outfile: this.bundlePath,
      logLevel: "silent",
      absWorkingDir: this.pluginDir,
      plugins: extraPlugins,
    }
  }

  async build() {
    fs.mkdirSync(this.devDir, { recursive: true })
    const result = await build(this.buildOptions())
    for (const warning of result.warnings) this.log(`[esbuild] ${warning.text}`)
    this.load()
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
              this.load()
              onRebuild?.()
            })
          },
        },
      ]),
    )
    await this.watchContext.watch()
  }

  async stopWatching() {
    if (this.watchContext) {
      await this.watchContext.dispose()
      this.watchContext = null
    }
  }

  load() {
    const cached = nodeRequire.cache[nodeRequire.resolve(this.bundlePath)]
    if (cached) delete nodeRequire.cache[nodeRequire.resolve(this.bundlePath)]
    this.exports = nodeRequire(this.bundlePath)
    return this.exports
  }

  routes() {
    return this.exports?.apiRoutes ?? {}
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
    const job = this.exports?.jobs?.[type]
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

  async runHook(name, payload, ctx) {
    const declared = this.manifest.hooks?.[name]
    const bundled = this.exports?.hooks?.[name]
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
    if (typeof this.exports?.deliveryProvider !== "function") {
      throw new Error("The plugin does not export deliveryProvider()")
    }
    return this.exports.deliveryProvider(ctx.storeId, order, ctx)
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
