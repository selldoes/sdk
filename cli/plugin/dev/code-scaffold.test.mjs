import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { applyCodePlan, planCodeScaffold } from "./code-scaffold.mjs"

function tempPlugin(manifest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-code-scaffold-"))
  fs.writeFileSync(path.join(root, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(
    path.join(root, "index.js"),
    ["const apiRoutes = { notes: { async GET() { return { ok: true } } } }", "", "module.exports = { apiRoutes }", ""].join("\n"),
  )
  return root
}

const BASE = {
  slug: "demo-plugin",
  name: "Demo",
  description: "test",
  version: "0.1.0",
  entry: "./index.js",
  apiRoutes: [{ path: "/notes", methods: ["GET"] }],
}

test("job scaffold: module + manifest entry + entry wiring", () => {
  const root = tempPlugin(BASE)
  const plan = planCodeScaffold({ pluginDir: root, manifest: JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")), kind: "job", name: "Import Products" })
  assert.equal(plan.file, "jobs/import-products.js")
  assert.equal(plan.manifest.jobs.length, 1)
  assert.equal(plan.manifest.jobs[0].type, "import-products")
  assert.equal(plan.manifest.jobs[0].name, "Import Products")
  assert.match(plan.wiring, /module\.exports\.jobs = \{ \.\.\.module\.exports\.jobs, \.\.\.require\("\.\/jobs\/import-products\.js"\) \}/)

  const written = applyCodePlan(root, plan)
  assert.deepEqual(written, ["jobs/import-products.js", "index.js"])
  assert.ok(fs.existsSync(path.join(root, "jobs", "import-products.js")))
  const entry = fs.readFileSync(path.join(root, "index.js"), "utf8")
  assert.match(entry, /<selldoes-scaffold:jobs>/)
  assert.match(entry, /require\("\.\/jobs\/import-products\.js"\)/)

  // Idempotent: the next plan sees the marker and skips the wiring.
  const again = planCodeScaffold({ pluginDir: root, manifest: plan.manifest, kind: "job", name: "other-job" })
  assert.equal(again.wiring, null)
  applyCodePlan(root, again)
  const entryAfter = fs.readFileSync(path.join(root, "index.js"), "utf8")
  assert.equal(entryAfter.split("<selldoes-scaffold:jobs>").length, 2, "wiring block appended once")
})

test("job scaffold (node): standalone server/ entry, no wiring, runtime declared", () => {
  const root = tempPlugin(BASE)
  const plan = planCodeScaffold({
    pluginDir: root,
    manifest: JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")),
    kind: "job",
    name: "Deep Sync",
    runtime: "node",
  })
  assert.equal(plan.file, "server/deep-sync.js")
  assert.equal(plan.wiring, null, "node entries are standalone — index.js stays untouched")
  assert.deepEqual(plan.manifest.jobs[0], {
    type: "deep-sync",
    name: "Deep Sync",
    description: "The Deep Sync job.",
    runtime: "node",
    entry: "./server/deep-sync.js",
  })
  const written = applyCodePlan(root, plan)
  assert.deepEqual(written, ["server/deep-sync.js"])
  const module = fs.readFileSync(path.join(root, "server", "deep-sync.js"), "utf8")
  assert.match(module, /module\.exports = async \(input, ctx\) =>/)
})

test("hook scaffold: colon names get safe files, manifest maps handler", () => {
  const root = tempPlugin(BASE)
  const plan = planCodeScaffold({ pluginDir: root, manifest: BASE, kind: "hook", name: "order:delivered" })
  assert.equal(plan.file, "hooks/order-delivered.js")
  assert.deepEqual(plan.manifest.hooks["order:delivered"], { handler: "hooks/order-delivered.js" })
  assert.match(plan.wiring, /module\.exports\.hooks/)
  applyCodePlan(root, plan)
  const module = fs.readFileSync(path.join(root, plan.file), "utf8")
  assert.match(module, /"order:delivered"/)
})

test("route scaffold: declares GET and wires apiRoutes", () => {
  const root = tempPlugin(BASE)
  const plan = planCodeScaffold({ pluginDir: root, manifest: BASE, kind: "route", name: "stats" })
  assert.equal(plan.file, "routes/stats.js")
  assert.deepEqual(plan.manifest.apiRoutes[plan.manifest.apiRoutes.length - 1], { path: "/stats", methods: ["GET"] })
  assert.match(plan.wiring, /module\.exports\.apiRoutes/)
  applyCodePlan(root, plan)
  assert.ok(fs.existsSync(path.join(root, "routes", "stats.js")))
})

test("scaffolds reject duplicates and bad names", () => {
  const root = tempPlugin(BASE)
  assert.throws(() => planCodeScaffold({ pluginDir: root, manifest: BASE, kind: "route", name: "notes" }), /already declared/)
  assert.throws(() => planCodeScaffold({ pluginDir: root, manifest: { ...BASE, jobs: [{ type: "sync" }] }, kind: "job", name: "sync" }), /already declared/)
  assert.throws(() => planCodeScaffold({ pluginDir: root, manifest: { ...BASE, hooks: { "order:delivered": {} } }, kind: "hook", name: "order:delivered" }), /already declared/)
  assert.throws(() => planCodeScaffold({ pluginDir: root, manifest: BASE, kind: "job", name: "Bad Type!" }), /lowercase/)
  assert.throws(() => planCodeScaffold({ pluginDir: root, manifest: BASE, kind: "route", name: "has space" }), /lowercase paths/)
  assert.throws(() => planCodeScaffold({ pluginDir: root, manifest: BASE, kind: "job", name: "" }), /name is required/i)
})
