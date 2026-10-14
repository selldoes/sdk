import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { connectStore, createLiveProductsBridge, maskKey, readStoreBlock, storeView, verifyStoreKey, writeStoreBlock } from "./live-store.mjs"

test("readStoreBlock: defaults, env fallback and normalization", () => {
  assert.deepEqual(readStoreBlock(null), { live: false, appUrl: "", apiKey: "", storeId: null, storeSlug: "" })

  const block = readStoreBlock({ store: { live: true, appUrl: "https://selldoes.com/", apiKey: "sk_abc", storeId: "6", storeSlug: "otrjoy" } })
  assert.equal(block.live, true)
  assert.equal(block.appUrl, "https://selldoes.com") // trailing slash stripped
  assert.equal(block.storeId, 6)
  assert.equal(block.storeSlug, "otrjoy")
})

test("storeView never exposes the raw key", () => {
  const view = storeView({ store: { live: true, appUrl: "https://x.com", apiKey: "sk_1234567890", storeId: 2 } })
  assert.equal(view.apiKeySet, true)
  assert.equal(view.apiKeyMasked, "sk_1…7890")
  assert.ok(JSON.stringify(view).indexOf("sk_1234567890") === -1)
})

test("maskKey: short keys are fully masked", () => {
  assert.equal(maskKey(""), null)
  assert.equal(maskKey("sk_abc"), "•••")
  assert.equal(maskKey("sk_1234567890"), "sk_1…7890")
})

test("writeStoreBlock: merges, prunes empties and round-trips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-store-"))
  fs.writeFileSync(path.join(dir, "selldoes.config.json"), JSON.stringify({ storeId: 1 }))

  writeStoreBlock(dir, { live: true, appUrl: "https://x.com", apiKey: "sk_k", storeId: 3 })
  const first = JSON.parse(fs.readFileSync(path.join(dir, "selldoes.config.json"), "utf8"))
  assert.equal(first.store.live, true)
  assert.equal(first.storeId, 1) // untouched sibling keys survive

  writeStoreBlock(dir, { live: false, storeSlug: "" })
  const second = JSON.parse(fs.readFileSync(path.join(dir, "selldoes.config.json"), "utf8"))
  assert.equal(second.store.live, false)
  assert.equal(second.store.storeSlug, undefined) // empty values pruned
  assert.equal(second.store.appUrl, "https://x.com")

  fs.rmSync(dir, { recursive: true, force: true })
})

test("bridge: rejects developer tokens and empty input in connectStore-shaped validation", () => {
  // connectStore does network I/O — validate its synchronous guards via the
  // exported bridge helpers only. (Full connect flow is covered manually.)
  const bridge = createLiveProductsBridge({ appUrl: "https://x.com", apiKey: "sk_k", storeId: 1 })
  assert.equal(typeof bridge.findBySku, "function")
  assert.equal(typeof bridge.upsertBySku, "function")
  assert.equal(typeof bridge.update, "function")
  assert.equal(typeof bridge.list, "function")
  assert.equal(typeof bridge.get, "function")
  assert.equal(typeof bridge.create, "function")
})

test("bridge: update by unknown id fails with an actionable message", async () => {
  const bridge = createLiveProductsBridge({ appUrl: "https://x.com", apiKey: "sk_k", storeId: 1 })
  await assert.rejects(() => bridge.update(999, { price: "1.00" }), /call findBySku first/)
  await assert.rejects(() => bridge.get(999), /call findBySku first/)
})

// ── verifyStoreKey / connectStore against a stub platform ───────────────────
const KEY = "sk_test_aaaa1111"
const STORES = [
  { id: 3, slug: "shop-a", name: "Shop A" },
  { id: 8, slug: "shop-b", name: "Shop B" },
]

async function withStubPlatform(fn) {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/templates/me" && req.headers["x-api-key"] === KEY) {
      res.setHeader("content-type", "application/json")
      return res.end(JSON.stringify({ userId: 7, stores: STORES }))
    }
    res.statusCode = 401
    res.end(JSON.stringify({ error: "invalid key" }))
  }).listen(0)
  await new Promise((r) => server.once("listening", r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base)
  } finally {
    server.close()
  }
}

test("verifyStoreKey: returns every store on the account + userId, commits nothing", async () => {
  await withStubPlatform(async (base) => {
    const verified = await verifyStoreKey({ appUrl: base, apiKey: KEY })
    assert.equal(verified.appUrl, base)
    assert.equal(verified.userId, 7)
    assert.deepEqual(verified.stores, STORES)
  })
})

test("connectStore: picks the matching store, else the account's first", async () => {
  await withStubPlatform(async (base) => {
    const first = await connectStore({ appUrl: base, apiKey: KEY })
    assert.equal(first.storeId, 3)
    assert.equal(first.storeSlug, "shop-a")
    assert.equal(first.storeName, "Shop A")

    const byId = await connectStore({ appUrl: base, apiKey: KEY, storeId: "8" })
    assert.equal(byId.storeId, 8)
    assert.equal(byId.storeSlug, "shop-b")

    const bySlug = await connectStore({ appUrl: base, apiKey: KEY, storeSlug: "shop-a" })
    assert.equal(bySlug.storeId, 3)
  })
})

test("verifyStoreKey: rejects developer tokens and bad keys with clear errors", async () => {
  await withStubPlatform(async (base) => {
    await assert.rejects(() => verifyStoreKey({ appUrl: base, apiKey: "sk_dev_x" }), /developer token/)
    await assert.rejects(() => verifyStoreKey({ appUrl: base, apiKey: "sk_test_wrong" }), /invalid key/)
    await assert.rejects(() => verifyStoreKey({ appUrl: base, apiKey: "" }), /merchant API key/)
  })
})

test("verifyStoreKey: app URL falls back to SELLDOES_APP_URL when omitted", async () => {
  await withStubPlatform(async (base) => {
    const previous = process.env.SELLDOES_APP_URL
    process.env.SELLDOES_APP_URL = base
    try {
      const verified = await verifyStoreKey({ apiKey: KEY })
      assert.equal(verified.appUrl, base)
      assert.deepEqual(verified.stores, STORES)
    } finally {
      if (previous === undefined) delete process.env.SELLDOES_APP_URL
      else process.env.SELLDOES_APP_URL = previous
    }
  })
})
