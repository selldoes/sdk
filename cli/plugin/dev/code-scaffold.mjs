import fs from "node:fs"
import path from "node:path"

/**
 * Code scaffolding for the creation buttons: New job / New hook / New route.
 *
 * Each scaffold writes a readable module under `jobs/`, `hooks/` or `routes/`,
 * patches plugin.json and appends an idempotent wiring block to the entry file
 * (esbuild inlines the relative `require`s into the sandbox bundle):
 *
 *   // <selldoes-scaffold:jobs>
 *   module.exports.jobs = { ...module.exports.jobs, ...require("./jobs/import-products.js") }
 *   // </selldoes-scaffold:jobs>
 */

const UNSAFE = /[^a-z0-9:_-]+/i

function safeFileStem(value) {
  return String(value)
    .replace(/^\//, "")
    .replace(/:/g, "-")
    .replace(UNSAFE, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "item"
}

function titleFrom(value) {
  return String(value)
    .replace(/^\/+|:$/g, "")
    .split(/[:/\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

const WIRING = {
  jobs: (file) => `module.exports.jobs = { ...module.exports.jobs, ...require("./${file}") }`,
  hooks: (file) => `module.exports.hooks = { ...module.exports.hooks, ...require("./${file}") }`,
  apiRoutes: (file) => `module.exports.apiRoutes = { ...module.exports.apiRoutes, ...require("./${file}") }`,
}

const BLOCK_FOR = { job: "jobs", hook: "hooks", route: "apiRoutes" }

function jobModule(type) {
  return `/**
 * ${type} — chunked job. The host calls \`step\` until it returns \`done: true\`,
 * checkpointing the returned \`state\` between ticks (survives pauses and restarts).
 * @param {unknown} input
 * @param {import("selldoes").JobContext} ctx
 */
module.exports = {
  "${type}": {
    /** Runs once before the first step — return the initial state. */
    init(input, ctx) {
      return { processed: 0 }
    },
    /** Runs repeatedly on a small budget — return { state, done, result }. */
    async step(state, ctx) {
      // TODO: do a small chunk of work here (e.g. N rows / N products).
      await ctx.jobs.log(\`tick — processed \${state.processed}\`)
      await ctx.jobs.progress({ processed: state.processed, total: state.processed })
      return { state, done: true, result: { processed: state.processed } }
    },
    /** Runs once after the last step (best effort). */
    finalize(state, ctx) {
      ctx.jobs.log(\`\${type} finished: \${state.processed} processed\`)
      return { processed: state.processed }
    },
  },
}
`
}

function nodeJobModule(type) {
  return `/**
 * ${type} — Node job. Runs once in a full Node environment: any npm package
 * listed in package.json works, including native addons, fs and playwright.
 * Return a JSON-serializable result.
 * @param {unknown} input
 * @param {import("selldoes").JobContext} ctx
 */
module.exports = async (input, ctx) => {
  // TODO: do the work here.
  return { ok: true }
}
`
}

function hookModule(name) {
  return `/**
 * ${name} — hook handler. Return value is delivered back to the host.
 * @param {unknown} payload
 * @param {import("selldoes").PluginContext} ctx
 */
module.exports = {
  "${name}": async (payload, ctx) => {
    // TODO: react to the event.
    return { ok: true, received: Boolean(payload) }
  },
}
`
}

function routeModule(routePath) {
  const key = routePath.replace(/^\//, "")
  return `/**
 * /${key} — dashboard API route (session + store ownership enforced by the host).
 * @param {import("selldoes").PluginContext} ctx
 * @param {import("selldoes").PluginApiRequest} request
 */
module.exports = {
  "${key}": {
    async GET(ctx, request) {
      return { ok: true, path: request.path, query: request.query }
    },
  },
}
`
}

/**
 * Computes everything a code scaffold writes, without touching disk.
 * Returns { kind, file, manifest, targets, wiring } — the server snapshots
 * `files` before applying.
 */
export function planCodeScaffold({ pluginDir, manifest, kind, name, description, runtime }) {
  const current = JSON.parse(JSON.stringify(manifest ?? {}))
  const label = String(name ?? "").trim()
  if (!label) throw new Error("A name is required")

  const nodeJob = kind === "job" && runtime === "node"
  let file
  let content
  if (kind === "job") {
    const type = label.replace(/^\//, "").replace(/\s+/g, "-").toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(type)) throw new Error(`Job types use lowercase letters, digits and dashes (got "${label}")`)
    if ((current.jobs ?? []).some((job) => job?.type === type)) throw new Error(`Job "${type}" is already declared in plugin.json`)
    const jobDescription = String(description ?? "").trim() || `The ${titleFrom(type)} job.`
    if (nodeJob) {
      file = `server/${type}.js`
      content = nodeJobModule(type)
      current.jobs = [
        ...(current.jobs ?? []),
        { type, name: titleFrom(type), description: jobDescription, runtime: "node", entry: `./${file}` },
      ]
    } else {
      file = `jobs/${type}.js`
      content = jobModule(type)
      current.jobs = [...(current.jobs ?? []), { type, name: titleFrom(type), description: jobDescription }]
    }
  } else if (kind === "hook") {
    const name2 = label
    if ((current.hooks ?? {})[name2]) throw new Error(`Hook "${name2}" is already declared in plugin.json`)
    file = `hooks/${safeFileStem(name2)}.js`
    content = hookModule(name2)
    current.hooks = { ...(current.hooks ?? {}), [name2]: { handler: file } }
  } else if (kind === "route") {
    const routePath = label.startsWith("/") ? label : `/${label}`
    if (!/^\/[a-z0-9/_-]*$/i.test(routePath)) throw new Error(`Routes are lowercase paths like /stats (got "${label}")`)
    if ((current.apiRoutes ?? []).some((route) => route?.path === routePath)) throw new Error(`Route "${routePath}" is already declared in plugin.json`)
    file = `routes/${safeFileStem(routePath)}.js`
    content = routeModule(routePath)
    current.apiRoutes = [...(current.apiRoutes ?? []), { path: routePath, methods: ["GET"] }]
  } else {
    throw new Error(`Unknown scaffold kind "${kind}"`)
  }

  const entry = String(current.entry ?? "./index.js").replace(/^\.\//, "")
  let wiring = null
  // Node jobs are standalone entry files — nothing to wire into index.js.
  if (!nodeJob) {
    const blockName = BLOCK_FOR[kind]
    const marker = `// <selldoes-scaffold:${blockName}>`
    let entryContent = null
    try {
      entryContent = fs.readFileSync(path.join(pluginDir, entry), "utf8")
    } catch {
      throw new Error(`Entry file "${entry}" is missing — fix plugin.json before scaffolding`)
    }
    if (!entryContent.includes(marker)) {
      wiring = [marker, WIRING[blockName](file), `// </selldoes-scaffold:${blockName}>`, ""].join("\n")
    }
  }

  return { kind, file, entry, manifest: current, targets: [{ path: file, content }], wiring, files: [file] }
}

/** Writes a `planCodeScaffold` result. Existing module files are never overwritten. */
export function applyCodePlan(pluginDir, plan) {
  const written = []
  for (const target of plan.targets) {
    const full = path.resolve(pluginDir, target.path)
    if (!full.startsWith(path.resolve(pluginDir) + path.sep)) throw new Error(`Refusing to write outside the plugin: ${target.path}`)
    if (fs.existsSync(full)) continue
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, target.content)
    written.push(target.path)
  }
  if (plan.wiring) {
    const entryPath = path.join(pluginDir, plan.entry)
    const current = fs.readFileSync(entryPath, "utf8")
    const separator = current.endsWith("\n") ? "" : "\n"
    fs.writeFileSync(entryPath, `${current}${separator}${plan.wiring}`)
    written.push(plan.entry)
  }
  return written
}
