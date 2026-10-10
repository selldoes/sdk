import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { MockDb } from "./mock-db.mjs"
import { createMockContext } from "./mock-context.mjs"

function setup(permissions, config = {}, manifestOverrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-mock-ctx-"))
  const devDir = path.join(root, ".selldoes-dev")
  const manifest = { slug: "demo-plugin", permissions, ...manifestOverrides }
  const db = new MockDb({ file: path.join(devDir, "db.json") })
  const { ctx, pendingJobs } = createMockContext({ pluginDir: root, manifest, db, storeId: 7, config, devDir, log: () => {} })
  return { root, ctx, pendingJobs, db }
}

test("mock context: storage round-trips values", async () => {
  const { ctx } = setup(["storage:read", "storage:write"])
  assert.equal(await ctx.storage.get("cursor"), null)
  await ctx.storage.set("cursor", { page: 3 })
  assert.deepEqual(await ctx.storage.get("cursor"), { page: 3 })
  const keys = await ctx.storage.list()
  assert.deepEqual(keys.map((entry) => entry.key), ["cursor"])
  assert.equal((await ctx.storage.delete("cursor")).deleted, true)
  assert.equal((await ctx.storage.delete("cursor")).deleted, false)
  assert.equal(await ctx.storage.get("cursor"), null)
})

test("mock context: storage and secrets are permission-gated", async () => {
  const { ctx } = setup([])
  await assert.rejects(() => ctx.storage.get("x"), /Missing permission "storage:read"/)
  await assert.rejects(() => ctx.storage.set("x", 1), /Missing permission "storage:write"/)
  await assert.rejects(() => ctx.storage.delete("x"), /Missing permission "storage:write"/)
  await assert.rejects(() => ctx.secrets.get("KEY"), /Missing permission "secrets:read"/)
})

test("mock context: secrets read from selldoes.config.json and missing keys are null", async () => {
  const { ctx } = setup(["secrets:read"], { secrets: { STRIPE_KEY: "sk_test_123" } })
  assert.equal(await ctx.secrets.get("STRIPE_KEY"), "sk_test_123")
  assert.equal(await ctx.secrets.get("MISSING"), null)
})

test("mock context: permission edits apply without restarting", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-mock-ctx-"))
  const devDir = path.join(root, ".selldoes-dev")
  let manifest = { slug: "demo-plugin", permissions: [] }
  const db = new MockDb({ file: path.join(devDir, "db.json") })
  const { ctx } = createMockContext({
    pluginDir: root,
    manifest,
    getManifest: () => manifest,
    db,
    storeId: 7,
    config: {},
    devDir,
    log: () => {},
  })

  await assert.rejects(() => ctx.storage.get("x"), /Missing permission "storage:read"/)
  assert.deepEqual(ctx.permissions, [])

  // The dev server keeps running while plugin.json changes on disk.
  manifest = { slug: "demo-plugin", permissions: ["storage:read"] }
  assert.deepEqual(ctx.permissions, ["storage:read"])
  assert.equal(await ctx.storage.get("x"), null)
})

test("mock context: job declaration edits apply without restarting", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-mock-ctx-"))
  const devDir = path.join(root, ".selldoes-dev")
  let manifest = { slug: "demo-plugin", permissions: [], jobs: [] }
  const db = new MockDb({ file: path.join(devDir, "db.json") })
  const { ctx, pendingJobs } = createMockContext({
    pluginDir: root,
    manifest,
    getManifest: () => manifest,
    db,
    storeId: 7,
    config: {},
    devDir,
    log: () => {},
  })

  await assert.rejects(() => ctx.jobs.enqueue({ type: "import-batch" }), /not declared/)

  // plugin.json is re-read per capability check — new jobs are enqueueable.
  manifest = { slug: "demo-plugin", permissions: [], jobs: [{ type: "import-batch" }] }
  const result = await ctx.jobs.enqueue({ type: "import-batch", input: { cursor: 3 } })
  assert.equal(typeof result.jobId, "number")
  assert.deepEqual(pendingJobs.map((job) => ({ type: job.type, input: job.input })), [
    { type: "import-batch", input: { cursor: 3 } },
  ])
})

test("mock context: products store categories and keep the first as primary", async () => {
  const { ctx, db } = setup(["products:read", "products:write"])
  db.ensureTable("products", { name: "varchar", sku: "varchar", price: "decimal", status: "varchar" }, 7)
  const created = await ctx.products.create({
    name: "Old Time Radio",
    sku: "OTR-1",
    categories: ["Drama", "Comedy", "Drama"],
  })
  const row = await ctx.products.get(created.id)
  assert.deepEqual(row.categories, ["Drama", "Comedy"])
  assert.equal(row.category, "Drama")

  await ctx.products.update(created.id, { categories: [] })
  const cleared = await ctx.products.get(created.id)
  assert.deepEqual(cleared.categories, [])
  assert.equal(cleared.category, "")
})

test("mock context: jobs.enqueue validates declared jobs and records the queue", async () => {
  const { ctx, pendingJobs } = setup(["storage:read"], {}, {
    jobs: [{ type: "import-batch", name: "Import batch", runtime: "node" }],
  })
  await assert.rejects(() => ctx.jobs.enqueue({ type: "nope" }), /not declared/)

  const result = await ctx.jobs.enqueue({ type: "import-batch", input: { cursor: 5 } })
  assert.equal(typeof result.jobId, "number")
  assert.deepEqual(pendingJobs.map((job) => ({ type: job.type, input: job.input })), [
    { type: "import-batch", input: { cursor: 5 } },
  ])
})
