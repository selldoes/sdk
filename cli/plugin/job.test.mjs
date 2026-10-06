import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createQueue } from "../../src/job.js"
import { MockDb } from "./dev/mock-db.mjs"
import { createMockContext } from "./dev/mock-context.mjs"

function setup({ maxAttempts = 2 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-queue-"))
  const devDir = path.join(root, ".selldoes-dev")
  const manifest = { slug: "queue-test", permissions: ["db:read", "db:write", "db:schema"] }
  const db = new MockDb({ file: path.join(devDir, "db.json") })
  const { ctx } = createMockContext({ pluginDir: root, manifest, db, storeId: 3, config: {}, devDir, log: () => {} })
  return { ctx, queue: createQueue(ctx, "import_queue", { maxAttempts }) }
}

test("queue: push → claim → complete lifecycle", async () => {
  const { queue } = setup()
  const pushed = await queue.push([
    { ref: "OTR-1", data: { url: "https://example.com/p/1" } },
    { ref: "OTR-2", data: { url: "https://example.com/p/2" } },
    { ref: "OTR-3" },
  ])
  assert.equal(pushed.inserted, 3)
  assert.deepEqual(await queue.stats(), { pending: 3, processing: 0, done: 0, failed: 0, total: 3 })

  const claimed = await queue.claim(2)
  assert.equal(claimed.length, 2)
  assert.deepEqual(claimed.map((item) => item.ref), ["OTR-1", "OTR-2"])
  assert.deepEqual(claimed[0].data, { url: "https://example.com/p/1" })
  assert.equal(claimed[0].status, "processing")
  assert.equal(claimed[0].attempts, 1)

  // Claimed rows are invisible to a second claim while in flight.
  assert.equal((await queue.claim(5)).length, 1)
  await queue.complete(claimed)
  assert.deepEqual(await queue.stats(), { pending: 0, processing: 1, done: 2, failed: 0, total: 3 })
})

test("queue: fail retries until maxAttempts, then marks failed", async () => {
  const { queue } = setup({ maxAttempts: 2 })
  await queue.push({ ref: "OTR-9" })

  const [first] = await queue.claim(1)
  assert.deepEqual(await queue.fail(first, "boom"), { failed: 0, retried: 1 })
  assert.equal((await queue.stats()).pending, 1)

  const [second] = await queue.claim(1)
  assert.equal(second.attempts, 2)
  assert.deepEqual(await queue.fail(second, "boom again"), { failed: 1, retried: 0 })
  const stats = await queue.stats()
  assert.equal(stats.failed, 1)
  const [failed] = await queue.peek(10, "failed")
  assert.equal(failed.error, "boom again")

  // retry resets the status; reset also drops the attempt counter.
  await queue.retry(failed)
  assert.equal((await queue.stats()).pending, 1)
  const [again] = await queue.claim(1)
  assert.equal(again.attempts, 3)
})

test("queue: drain processes items and keeps failures for retry", async () => {
  const { queue } = setup({ maxAttempts: 3 })
  await queue.push([{ ref: "a" }, { ref: "b" }, { ref: "c" }])

  const seen = []
  const result = await queue.drain(
    async (item) => {
      if (item.ref === "b") throw new Error("skip b")
      seen.push(item.ref)
    },
    { batchSize: 2 },
  )
  assert.deepEqual(seen, ["a", "c"])
  assert.deepEqual(result, { processed: 2, failed: 1, batches: 2 })
  const stats = await queue.stats()
  assert.equal(stats.done, 2)
  assert.equal(stats.pending, 1)

  const cleared = await queue.clear({ status: "done" })
  assert.equal(cleared.deleted, 2)
  assert.equal((await queue.stats()).total, 1)
  await queue.clear({ all: true })
  assert.equal((await queue.stats()).total, 0)
})

test("queue: rejects invalid table names", () => {
  const { ctx } = setup()
  assert.throws(() => createQueue(ctx, "Bad-Name!"), /Invalid queue table name/)
})
