import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { contentTypeFor, readJson } from "../../util.mjs"
import { buildPlugin } from "../build.mjs"
import { MockDb, seedDemoTables } from "./mock-db.mjs"
import { createMockContext } from "./mock-context.mjs"
import { PluginRunner, cleanPath } from "./runner.mjs"
import {
  apiPage,
  dashboardPage,
  dataPage,
  emailPage,
  hooksPage,
  jobsPage,
  overviewPage,
  realtimePage,
  storefrontPage,
} from "./pages.mjs"

const UI_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
].join("; ")

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  res.end(body)
}

function html(res, body) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ""
    req.on("data", (chunk) => {
      data += chunk
      if (data.length > 5_000_000) req.destroy()
    })
    req.on("end", () => {
      if (!data) return resolve(null)
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve(data)
      }
    })
  })
}

/**
 * Starts the local plugin preview server:
 *
 *   /preview/*                 preview pages (dashboard UI, storefront, API console, jobs, hooks, data)
 *   /api/plugin-api/<slug>/**  the plugin's authenticated `apiRoutes` (handlers run locally)
 *   /api/plugin-public/<slug>/** the plugin's `publicRoutes` (storefront widget/pages)
 *   /api/plugins/<slug>/ui/**  the built dashboard UI (sandboxed iframe)
 */
export async function startDevServer({ pluginDir, port, host } = {}) {
  const manifest = readJson(path.join(pluginDir, "plugin.json"))
  const configPath = path.join(pluginDir, "selldoes.config.json")
  const config = fs.existsSync(configPath) ? readJson(configPath) : {}
  const storeId = Number(config.storeId ?? 1)
  const storeSlug = String(config.storeSlug ?? "dev-store")
  const devDir = path.join(pluginDir, ".selldoes-dev")

  const logs = []
  const log = (line) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${line}`
    logs.push(entry)
    if (logs.length > 200) logs.shift()
    process.stdout.write(`  ${entry}\n`)
  }

  const db = new MockDb({ file: path.join(devDir, "db.json") })
  seedDemoTables(db, storeId)

  const runner = new PluginRunner({ pluginDir, manifest, devDir, log })
  await runner.build()
  log(`bundle built (${runner.bundlePath.replace(pluginDir, ".")})`)
  await runner.watch(() => log("bundle rebuilt"))

  let uiDir = null
  const buildUi = async () => {
    if (!manifest.ui?.entry) return
    const built = await buildPlugin(pluginDir, { outDir: path.join(devDir, "dist") })
    uiDir = path.join(built.outDir, "ui")
  }
  await buildUi()
  if (uiDir) log(`ui built (${uiDir.replace(pluginDir, ".")})`)

  const { ctx, outbox, events, jobEvents } = createMockContext({ pluginDir, manifest, db, storeId, config, devDir, log })

  const resetJobEvents = () => {
    jobEvents.logs.length = 0
    jobEvents.items.length = 0
    jobEvents.progress.length = 0
  }

  const rebuildAll = async () => {
    await runner.build()
    await buildUi()
    log("rebuilt (bundle" + (manifest.ui?.entry ? " + ui" : "") + ")")
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      const pathname = url.pathname

      // ── Preview pages ───────────────────────────────────────────────────────
      if (req.method === "GET" && pathname === "/") {
        res.writeHead(302, { Location: "/preview" })
        res.end()
        return
      }
      if (req.method === "GET" && pathname === "/preview") return html(res, overviewPage({ manifest }))
      if (req.method === "GET" && pathname === "/preview/dashboard") return html(res, dashboardPage({ manifest, storeId, storeSlug }))
      if (req.method === "GET" && pathname === "/preview/storefront") {
        return html(res, storefrontPage({ manifest, storeSlug, storeId, pagePath: url.searchParams.get("page") }))
      }
      if (req.method === "GET" && pathname === "/preview/api") return html(res, apiPage({ manifest }))
      if (req.method === "GET" && pathname === "/preview/jobs") return html(res, jobsPage({ manifest }))
      if (req.method === "GET" && pathname === "/preview/hooks") return html(res, hooksPage({ manifest }))
      if (req.method === "GET" && pathname === "/preview/data") return html(res, dataPage({ manifest }))
      if (req.method === "GET" && pathname === "/preview/email") return html(res, emailPage({ manifest }))
      if (req.method === "GET" && pathname === "/preview/realtime") return html(res, realtimePage({ manifest }))

      // ── Dev endpoints ───────────────────────────────────────────────────────
      if (req.method === "GET" && pathname === "/__dev/state") {
        const tables = {}
        for (const [name, table] of Object.entries(db.tables)) {
          tables[name] = {
            rows: table.rows.length,
            columns: Object.keys(table.columns),
            sample: table.rows.slice(0, 5),
          }
        }
        return json(res, 200, { tables })
      }
      if (req.method === "POST" && pathname === "/__dev/reset-data") {
        db.reset()
        seedDemoTables(db, storeId)
        log("mock data reset")
        return json(res, 200, { ok: true })
      }
      if (req.method === "POST" && pathname === "/__dev/rebuild") {
        try {
          await rebuildAll()
          return json(res, 200, { ok: true, rebuilds: runner.rebuilds })
        } catch (error) {
          return json(res, 500, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/run-job") {
        const body = await readBody(req)
        try {
          resetJobEvents()
          const maxTicks = Math.max(1, Math.min(Number(body?.maxTicks) || 50, 500))
          const run = await runner.runJob(body?.type, body?.input ?? {}, ctx, maxTicks)
          log(`job ${body?.type} ran ${run.ticks.length} tick(s)${run.done ? " — done" : " — tick limit reached"}`)
          const stateJson = run.state === undefined || run.state === null ? "" : JSON.stringify(run.state)
          return json(res, 200, {
            ok: true,
            run: {
              kind: run.kind,
              ticks: run.ticks.length,
              done: run.done,
              result: run.result ?? null,
              // Full state can be large (URL lists); only send it while it stays small.
              state: stateJson && stateJson.length <= 20000 ? run.state : undefined,
            },
            telemetry: {
              progress: jobEvents.progress.slice(),
              items: jobEvents.items.slice(),
              logs: jobEvents.logs.slice(),
            },
          })
        } catch (error) {
          return json(res, 500, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/run-hook") {
        const body = await readBody(req)
        try {
          const result = await runner.runHook(body?.hook, body?.payload ?? {}, ctx)
          log(`hook ${body?.hook} fired`)
          return json(res, 200, { ok: true, result: result ?? null })
        } catch (error) {
          return json(res, 500, { error: error.message })
        }
      }
      if (req.method === "POST" && pathname === "/__dev/delivery") {
        const body = await readBody(req)
        try {
          const result = await runner.runDelivery(body?.order ?? config.sampleOrder ?? { id: 1001, order_number: "1001", items: [] }, ctx)
          return json(res, 200, { ok: true, result: result ?? null })
        } catch (error) {
          return json(res, 500, { error: error.message })
        }
      }
      if (req.method === "GET" && pathname === "/__dev/outbox") return json(res, 200, { outbox })
      if (req.method === "GET" && pathname === "/__dev/events") return json(res, 200, { events })
      if (req.method === "GET" && pathname === "/__dev/logs") return json(res, 200, { logs: logs.slice(-80), rebuilds: runner.rebuilds })
      if (req.method === "GET" && pathname.startsWith("/__dev/files/")) {
        const key = decodeURIComponent(pathname.slice("/__dev/files/".length))
        const file = path.resolve(path.join(devDir, "files"), key)
        const root = path.resolve(path.join(devDir, "files"))
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return json(res, 404, { error: "File not found" })
        }
        res.writeHead(200, { "Content-Type": contentTypeFor(file), "Cache-Control": "no-store" })
        res.end(fs.readFileSync(file))
        return
      }

      // ── Plugin UI assets (dashboard + public) ──────────────────────────────
      const uiMatch = /^\/api\/(?:plugins|plugin-public)\/([^/]+)\/ui\/(.*)$/.exec(pathname)
      if (req.method === "GET" && uiMatch) {
        const [, slug, ...rest] = uiMatch
        if (slug !== manifest.slug) return json(res, 404, { error: `Only "${manifest.slug}" runs in this dev server` })
        if (!uiDir) return json(res, 404, { error: "This plugin declares no ui.entry" })
        const root = path.resolve(uiDir)
        const file = path.resolve(root, rest.join("/"))
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return json(res, 404, { error: `Asset "${rest.join("/")}" not found` })
        }
        res.writeHead(200, {
          "Content-Type": contentTypeFor(file),
          "Content-Security-Policy": UI_CSP,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        })
        res.end(fs.readFileSync(file))
        return
      }

      // ── Plugin API routes ───────────────────────────────────────────────────
      const apiMatch = /^\/api\/(plugin-api|plugin-public)\/([^/]+)(\/.*)?$/.exec(pathname)
      if (apiMatch) {
        const kind = apiMatch[1] === "plugin-public" ? "public" : "authenticated"
        const [, , slug, tail] = apiMatch
        if (slug !== manifest.slug) return json(res, 404, { error: `Only "${manifest.slug}" runs in this dev server` })
        const requestPath = cleanPath(tail ?? "/")
        const declaredList = kind === "public" ? manifest.publicRoutes ?? [] : manifest.apiRoutes ?? []
        const match = declaredList.find((route) => {
          const declared = cleanPath(route.path)
          return requestPath === declared || requestPath.startsWith(`${declared}/`)
        })
        if (!match) return json(res, 404, { error: `No ${kind} route "${requestPath}" declared in plugin.json` })
        const methods = (match.methods ?? ["GET"]).map((method) => method.toUpperCase())
        if (!methods.includes(req.method)) {
          return json(res, 405, { error: `Method ${req.method} not allowed for ${match.path}` })
        }
        const body = req.method === "GET" || req.method === "HEAD" ? null : await readBody(req)
        const query = Object.fromEntries(url.searchParams.entries())
        try {
          const started = Date.now()
          const result = await runner.invokeRoute(match.path, { method: req.method, path: requestPath, query, body }, ctx)
          log(`${req.method} ${requestPath} → ${Date.now() - started}ms`)
          if (result && typeof result === "object" && "status" in result && "body" in result) {
            return json(res, Number(result.status) || 200, result.body)
          }
          return json(res, 200, result ?? null)
        } catch (error) {
          log(`${req.method} ${requestPath} → error: ${error.message}`)
          return json(res, 500, { error: error.message })
        }
      }

      return json(res, 404, { error: `Not found: ${pathname}` })
    } catch (error) {
      return json(res, 500, { error: error.message })
    }
  })

  const listenPort = Number(port ?? config.port ?? 4590)
  const listenHost = String(host ?? "127.0.0.1")

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(listenPort, listenHost, resolve)
  })

  const url = `http://${listenHost === "0.0.0.0" ? "localhost" : listenHost}:${listenPort}/preview`

  const shutdown = async () => {
    await runner.stopWatching()
    db.saveNow()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)

  return { url, port: listenPort, host: listenHost, close: shutdown, runner }
}
