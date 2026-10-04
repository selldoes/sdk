import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { MockDb } from "./mock-db.mjs"
import { createMockContext } from "./mock-context.mjs"

function setup(permissions, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-mock-ctx-"))
  const devDir = path.join(root, ".selldoes-dev")
  const manifest = { slug: "demo-plugin", permissions }
  const db = new MockDb({ file: path.join(devDir, "db.json") })
  const { ctx } = createMockContext({ pluginDir: root, manifest, db, storeId: 7, config, devDir, log: () => {} })
  return { root, ctx }
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
