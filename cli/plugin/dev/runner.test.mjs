import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { compileRoutePattern, matchDeclaredRoute, PluginRunner } from "./runner.mjs"

function tempPlugin(manifest, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-runner-"))
  fs.writeFileSync(path.join(root, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [relative, content] of Object.entries(files ?? {})) {
    const full = path.join(root, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

const NODE_JOB_MANIFEST = {
  slug: "node-runner",
  name: "Node Runner",
  description: "test",
  version: "0.1.0",
  entry: "./index.js",
  jobs: [{ type: "write-file", name: "Write file", runtime: "node", entry: "./server/write.js" }],
}

test("PluginRunner: Node jobs run in the local Node process with filesystem access", async () => {
  const root = tempPlugin(NODE_JOB_MANIFEST, {
    "index.js": "module.exports = { jobs: {} }\n",
    "server/write.js": `const fs = require("node:fs")
module.exports = async (input) => {
  fs.writeFileSync(input.path, "written")
  return { path: input.path, ok: true }
}
`,
  })
  const runner = new PluginRunner({
    pluginDir: root,
    manifest: JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")),
    devDir: path.join(root, ".selldoes-dev"),
    log: () => {},
  })
  await runner.build()
  const target = path.join(root, "out.txt")
  const run = await runner.runJob("write-file", { path: target }, {}, 5)
  assert.equal(run.kind, "node")
  assert.equal(run.done, true)
  assert.deepEqual(run.result, { path: target, ok: true })
  assert.equal(fs.readFileSync(target, "utf8"), "written")
})

test("PluginRunner: a Node entry without a handler reports a clear error", async () => {
  const root = tempPlugin(NODE_JOB_MANIFEST, {
    "index.js": "module.exports = { jobs: {} }\n",
    "server/write.js": "module.exports = { notAHandler: true }\n",
  })
  const runner = new PluginRunner({
    pluginDir: root,
    manifest: JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")),
    devDir: path.join(root, ".selldoes-dev"),
    log: () => {},
  })
  await assert.rejects(() => runner.runJob("write-file", {}, {}, 5), /no loaded handler/)
})

const CHUNKED_MANIFEST = {
  slug: "chunked-runner",
  name: "Chunked Runner",
  description: "test",
  version: "0.1.0",
  entry: "./index.js",
  jobs: [{ type: "count", name: "Count" }],
}

const CHUNKED_ENTRY = `export const jobs = {
  count: {
    init() { return { n: 0 } },
    step(state) {
      const next = { ...state, n: state.n + 1 }
      return { state: next, done: next.n >= 10, result: next.n >= 10 ? { total: next.n } : undefined }
    },
  },
}
`

function chunkedRunner() {
  const root = tempPlugin(CHUNKED_MANIFEST, { "index.js": CHUNKED_ENTRY })
  const runner = new PluginRunner({
    pluginDir: root,
    manifest: JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")),
    devDir: path.join(root, ".selldoes-dev"),
    log: () => {},
  })
  return runner.build().then(() => runner)
}

test("PluginRunner: a paused chunked job resumes from its checkpoint, not from init", async () => {
  const runner = await chunkedRunner()
  const paused = await runner.runJob("count", {}, {}, 4)
  assert.equal(paused.done, false)
  assert.equal(paused.state.n, 4)
  const resumed = await runner.runJob("count", {}, {}, 10, { state: paused.state })
  assert.equal(resumed.done, true)
  assert.equal(resumed.state.n, 10)
  assert.deepEqual(resumed.result, { total: 10 })
})

test("PluginRunner: an expired deadline pauses between steps and resumes cleanly", async () => {
  const runner = await chunkedRunner()
  const paused = await runner.runJob("count", {}, {}, 100, null, Date.now() - 1)
  assert.equal(paused.done, false)
  assert.equal(paused.state.n, 0)
  const resumed = await runner.runJob("count", {}, {}, 100, { state: paused.state }, Date.now() + 60_000)
  assert.equal(resumed.done, true)
  assert.equal(resumed.state.n, 10)
})

test("route matching: exact beats params beats longest prefix", () => {
  const routes = [
    { path: "/products" },
    { path: "/products/:id" },
    { path: "/products/:id/restock" },
    { path: "/catalog/:category/items" },
  ]

  assert.deepEqual(matchDeclaredRoute(routes, "/products"), { route: routes[0], params: {} })
  assert.deepEqual(matchDeclaredRoute(routes, "/products/42"), { route: routes[1], params: { id: "42" } })
  assert.deepEqual(matchDeclaredRoute(routes, "/products/42/restock"), { route: routes[2], params: { id: "42" } })
  assert.deepEqual(matchDeclaredRoute(routes, "/catalog/shoes/items"), { route: routes[3], params: { category: "shoes" } })
  // Param values are URL-decoded.
  assert.deepEqual(matchDeclaredRoute(routes, "/products/a%20b").params, { id: "a b" })
  // Prefix fallback for nested paths under a static route.
  const withSub = [{ path: "/notes" }]
  assert.deepEqual(matchDeclaredRoute(withSub, "/notes/42/comments"), { route: withSub[0], params: {} })
  assert.equal(matchDeclaredRoute(routes, "/elsewhere"), null)
})

test("route matching: compileRoutePattern tolerates a trailing slash", () => {
  const { regex, names } = compileRoutePattern("/products/:id")
  assert.deepEqual(names, ["id"])
  assert.match("/products/7", regex)
  assert.match("/products/7/", regex)
  assert.doesNotMatch("/products/7/restock", regex)
})
