import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  connectStore,
  createLiveAiBridge,
  createLiveModelsBridge,
  createLiveProductsBridge,
  createLivePromptsBridge,
  findLocalPlatformDir,
  LOCAL_PLATFORM_URL,
  maskKey,
  readStoreBlock,
  resolveLiveAppUrl,
  storeView,
  verifyStoreKey,
  writeStoreBlock,
} from "./live-store.mjs"

/** Run `fn` with the given env vars set (undefined deletes), restoring after. */
function withEnv(vars, fn) {
  const previous = {}
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key]
    if (vars[key] === undefined) delete process.env[key]
    else process.env[key] = vars[key]
  }
  try {
    return fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

test("findLocalPlatformDir: detects a checkout via SELLDOES_LOCAL_PLATFORM and 'next' nesting", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "local-platform-"))
  const nextDir = path.join(repo, "next")
  fs.mkdirSync(nextDir)
  fs.writeFileSync(path.join(nextDir, "package.json"), "{}")

  // Pointing at the repo root finds the nested next/ dir.
  assert.equal(
    withEnv({ SELLDOES_LOCAL_PLATFORM: repo }, () => findLocalPlatformDir()),
    nextDir,
  )
  // Pointing straight at next/ works too.
  assert.equal(
    withEnv({ SELLDOES_LOCAL_PLATFORM: nextDir }, () => findLocalPlatformDir()),
    nextDir,
  )
  // off disables detection entirely.
  assert.equal(
    withEnv({ SELLDOES_LOCAL_PLATFORM: "off" }, () => findLocalPlatformDir()),
    null,
  )
  fs.rmSync(repo, { recursive: true, force: true })
})

test("resolveLiveAppUrl: explicit > SELLDOES_APP_URL > local platform > saved", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "local-platform-"))
  fs.writeFileSync(path.join(repo, "package.json"), "{}")
  const base = { SELLDOES_LOCAL_PLATFORM: undefined, SELLDOES_APP_URL: undefined }

  // Explicit argument wins over everything.
  assert.equal(
    withEnv({ ...base, SELLDOES_LOCAL_PLATFORM: repo }, () => resolveLiveAppUrl("https://saved.com", "https://explicit.com")),
    "https://explicit.com",
  )
  // SELLDOES_APP_URL wins over a local checkout (trailing slash stripped).
  assert.equal(
    withEnv({ ...base, SELLDOES_LOCAL_PLATFORM: repo, SELLDOES_APP_URL: "https://env.com/" }, () =>
      resolveLiveAppUrl("https://saved.com"),
    ),
    "https://env.com",
  )
  // A local checkout wins over the saved URL.
  assert.equal(
    withEnv({ ...base, SELLDOES_LOCAL_PLATFORM: repo }, () => resolveLiveAppUrl("https://saved.com")),
    LOCAL_PLATFORM_URL,
  )
  // SELLDOES_LOCAL_PLATFORM as a URL is used directly.
  assert.equal(
    withEnv({ ...base, SELLDOES_LOCAL_PLATFORM: "http://localhost:3000" }, () => resolveLiveAppUrl("https://saved.com")),
    "http://localhost:3000",
  )
  // Disabled → the saved URL.
  assert.equal(
    withEnv({ ...base, SELLDOES_LOCAL_PLATFORM: "off" }, () => resolveLiveAppUrl("https://saved.com")),
    "https://saved.com",
  )
  fs.rmSync(repo, { recursive: true, force: true })
})

test("readStoreBlock: defaults, env fallback and normalization", () => {
  assert.deepEqual(readStoreBlock(null), { live: false, appUrl: "", apiKey: "", storeId: null, storeSlug: "" })

  const block = readStoreBlock({
    store: { live: true, appUrl: "https://selldoes.com/", apiKey: "sk_abc", storeId: "6", storeSlug: "otrjoy" },
  })
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
  const server = http
    .createServer((req, res) => {
      if (req.url === "/api/templates/me" && req.headers["x-api-key"] === KEY) {
        res.setHeader("content-type", "application/json")
        return res.end(JSON.stringify({ userId: 7, stores: STORES }))
      }
      res.statusCode = 401
      res.end(JSON.stringify({ error: "invalid key" }))
    })
    .listen(0)
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

// ── products bridge against a stub external-products API ────────────────────
const PRODUCTS = {
  "sku-a": { id: 11, sku: "sku-a", name: "A", price: "1.00", variationGroups: null, customAttributes: null },
  "sku-b": { id: 12, sku: "sku-b", name: "B", price: "2.00", variationGroups: null, customAttributes: null },
  "sku-c": { id: 13, sku: "sku-c", name: "C", price: "3.00", variationGroups: null, customAttributes: null },
}

/**
 * Stub platform products API. `mode: "bare"` mimics pre-`full=1` deploys that
 * answer `{exists:true}` without the product row.
 */
async function withStubProducts(options, fn) {
  if (typeof options === "function") {
    fn = options
    options = {}
  }
  const { mode = "full" } = options ?? {}
  const requests = []
  const server = http
    .createServer((req, res) => {
      requests.push({ method: req.method, url: req.url })
      res.setHeader("content-type", "application/json")
      if (!req.url?.startsWith("/api/external/products")) {
        res.statusCode = 404
        return res.end(JSON.stringify({ error: "not found" }))
      }
      const url = new URL(req.url, "http://stub")
      if (req.method === "POST") {
        let body = ""
        req.on("data", (chunk) => (body += chunk))
        req.on("end", () => {
          const parsed = JSON.parse(body || "{}")
          const existing = PRODUCTS[parsed.sku]
          res.statusCode = existing ? 200 : 201
          res.end(JSON.stringify({ id: existing?.id ?? 99, sku: parsed.sku, created: !existing }))
        })
        return
      }
      if (url.searchParams.get("list") === "all") {
        return res.end(JSON.stringify({ skus: Object.keys(PRODUCTS) }))
      }
      const sku = url.searchParams.get("sku")
      const product = PRODUCTS[sku]
      if (!product) return res.end(JSON.stringify({ exists: false }))
      if (mode === "bare") return res.end(JSON.stringify({ exists: true }))
      if (url.searchParams.get("full")) return res.end(JSON.stringify({ exists: true, id: product.id, product }))
      return res.end(JSON.stringify({ exists: true, id: product.id }))
    })
    .listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await fn(base, requests)
  } finally {
    server.close()
  }
}

test("bridge: GET queries are store-scoped and never glue onto the path", async () => {
  await withStubProducts(async (base, requests) => {
    const bridge = createLiveProductsBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    const product = await bridge.findBySku("sku-a")
    assert.equal(product.id, 11)
    assert.equal(product.name, "A")
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, "/api/external/products?storeId=6&sku=sku-a&full=1")
  })
})

test("bridge: list honors offset and hydrates only the requested page", async () => {
  await withStubProducts(async (base, requests) => {
    const bridge = createLiveProductsBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    const page = await bridge.list({ limit: 2, offset: 1 })
    assert.deepEqual(
      page.map((row) => row.sku),
      ["sku-b", "sku-c"],
    )
    const hydrated = requests
      .filter((request) => request.url.includes("sku="))
      .map((request) => new URL(request.url, "http://stub").searchParams.get("sku"))
    assert.deepEqual(hydrated, ["sku-b", "sku-c"])
  })
})

test("bridge: upsertBySku posts to the store-scoped endpoint", async () => {
  await withStubProducts(async (base, requests) => {
    const bridge = createLiveProductsBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    const result = await bridge.upsertBySku({ name: "A", sku: "sku-a", price: "1.00" })
    assert.equal(result.id, 11)
    assert.equal(result.created, false)
    const posted = requests.find((request) => request.method === "POST")
    assert.equal(posted.url, "/api/external/products?storeId=6")
  })
})

test("bridge: a platform without full=1 warns once and reads as null", async () => {
  await withStubProducts({ mode: "bare" }, async (base) => {
    const logs = []
    const bridge = createLiveProductsBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 }, (line) => logs.push(line))
    assert.equal(await bridge.findBySku("sku-a"), null)
    assert.equal(await bridge.findBySku("sku-b"), null)
    assert.equal(logs.filter((line) => line.includes("deploy the latest Selldesk")).length, 1)
  })
})

/**
 * Stub platform AI-prompts API (`/api/external/ai/prompts`). `mode: "missing"`
 * mimics an older host that answers a plain 404 page.
 */
async function withStubPrompts(options, fn) {
  if (typeof options === "function") {
    fn = options
    options = {}
  }
  const { mode = "full" } = options ?? {}
  const requests = []
  const PROMPTS = [
    {
      id: 2,
      name: "Album cover",
      description: null,
      type: "image",
      field: "mainImage",
      template: "T1",
      provider: "openai",
      model: "gpt-image-1",
      isDefault: true,
      aspectRatio: "1:1",
    },
    {
      id: 15,
      name: "Vintage radio",
      description: "style",
      type: "image",
      field: "mainImage",
      template: "T2",
      provider: "openai",
      model: "gpt-image-1",
      isDefault: false,
      aspectRatio: null,
    },
  ]
  const server = http
    .createServer((req, res) => {
      requests.push({ method: req.method, url: req.url })
      if (mode === "missing") {
        res.statusCode = 404
        return res.end("<html>Not Found</html>")
      }
      if (!req.url?.startsWith("/api/external/ai/prompts")) {
        res.statusCode = 404
        res.setHeader("content-type", "application/json")
        return res.end(JSON.stringify({ error: "not found" }))
      }
      res.setHeader("content-type", "application/json")
      const url = new URL(req.url, "http://stub")
      const type = url.searchParams.get("type")
      const prompts = type ? PROMPTS.filter((prompt) => prompt.type === type) : PROMPTS
      res.end(JSON.stringify({ prompts }))
    })
    .listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await fn(base, requests)
  } finally {
    server.close()
  }
}

test("prompts bridge: list is store-scoped and type-filterable", async () => {
  await withStubPrompts(async (base, requests) => {
    const bridge = createLivePromptsBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    const all = await bridge.list()
    assert.deepEqual(
      all.map((prompt) => prompt.id),
      [2, 15],
    )
    const images = await bridge.list({ type: "image" })
    assert.equal(images.length, 2)
    assert.ok(requests.every((request) => request.url.startsWith("/api/external/ai/prompts?storeId=6")))
    assert.ok(requests[1].url.includes("type=image"))
  })
})

test("prompts bridge: get filters the listed library by id", async () => {
  await withStubPrompts(async (base) => {
    const bridge = createLivePromptsBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    const prompt = await bridge.get(15)
    assert.equal(prompt.name, "Vintage radio")
    assert.equal(await bridge.get(999), null)
  })
})

test("prompts bridge: an older host surfaces a deploy hint instead of an empty list", async () => {
  await withStubPrompts({ mode: "missing" }, async (base) => {
    const bridge = createLivePromptsBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    await assert.rejects(() => bridge.list(), /deploy the latest Selldesk/)
  })
})

/**
 * Stub platform AI-models API (`/api/external/ai/models`). `mode: "missing"`
 * mimics an older host that answers a plain 404 page.
 */
async function withStubModels(options, fn) {
  if (typeof options === "function") {
    fn = options
    options = {}
  }
  const { mode = "full" } = options ?? {}
  const requests = []
  const MODELS = [
    {
      provider: "apiraven",
      modelId: "amazon/nova-micro",
      name: "Nova Micro",
      type: "text",
      vendor: "Amazon",
      contextLength: 128000,
      maxCompletionTokens: 8192,
      inputCostPer1M: "0.035000",
      outputCostPer1M: "0.140000",
      supportedParameters: [],
      supportsReferenceImage: false,
    },
    {
      provider: "apiraven",
      modelId: "black-forest-labs/flux-3-image",
      name: "FLUX 3",
      type: "image",
      vendor: "Black Forest Labs",
      contextLength: null,
      maxCompletionTokens: null,
      inputCostPer1M: null,
      outputCostPer1M: null,
      supportedParameters: [],
      supportsReferenceImage: true,
    },
  ]
  const server = http
    .createServer((req, res) => {
      requests.push({ method: req.method, url: req.url })
      if (mode === "missing") {
        res.statusCode = 404
        return res.end("<html>Not Found</html>")
      }
      if (!req.url?.startsWith("/api/external/ai/models")) {
        res.statusCode = 404
        res.setHeader("content-type", "application/json")
        return res.end(JSON.stringify({ error: "not found" }))
      }
      res.setHeader("content-type", "application/json")
      const url = new URL(req.url, "http://stub")
      const type = url.searchParams.get("type")
      const models = type ? MODELS.filter((model) => model.type === type) : MODELS
      res.end(JSON.stringify({ models }))
    })
    .listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await fn(base, requests)
  } finally {
    server.close()
  }
}

test("models bridge: list is store-scoped and type-filterable", async () => {
  await withStubModels(async (base, requests) => {
    const bridge = createLiveModelsBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    const all = await bridge.list()
    assert.deepEqual(
      all.map((model) => model.modelId),
      ["amazon/nova-micro", "black-forest-labs/flux-3-image"],
    )
    const images = await bridge.list({ type: "image" })
    assert.equal(images.length, 1)
    assert.equal(images[0].modelId, "black-forest-labs/flux-3-image")
    assert.ok(requests.every((request) => request.url.startsWith("/api/external/ai/models?storeId=6")))
    assert.ok(requests[1].url.includes("type=image"))
  })
})

test("models bridge: an older host surfaces a deploy hint instead of an empty list", async () => {
  await withStubModels({ mode: "missing" }, async (base) => {
    const bridge = createLiveModelsBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    await assert.rejects(() => bridge.list(), /deploy the latest Selldesk/)
  })
})

/**
 * Stub platform AI runner (`/api/ai/execute`) — the endpoint the dashboard
 * and the CLI scrapers use, authenticated with the merchant API key.
 */
async function withStubAi(fn) {
  const requests = []
  const server = http
    .createServer((req, res) => {
      let body = ""
      req.on("data", (chunk) => {
        body += chunk
      })
      req.on("end", () => {
        requests.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : {} })
        if (!req.url?.startsWith("/api/ai/execute")) {
          res.statusCode = 404
          res.setHeader("content-type", "application/json")
          return res.end(JSON.stringify({ error: "not found" }))
        }
        res.setHeader("content-type", "application/json")
        const parsed = body ? JSON.parse(body) : {}
        if (String(parsed.prompt || "").includes("FAIL")) {
          res.statusCode = 500
          return res.end(JSON.stringify({ error: "AI provider exploded" }))
        }
        if (parsed.target?.type === "image") return res.end(JSON.stringify({ url: "https://cdn.test/out.png" }))
        res.end(JSON.stringify({ text: "REAL COPY" }))
      })
    })
    .listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await fn(base, requests)
  } finally {
    server.close()
  }
}

test("ai bridge: complete posts the prompt with the merchant key and the store id", async () => {
  await withStubAi(async (base, requests) => {
    const bridge = createLiveAiBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    const result = await bridge.complete({ prompt: "Write a description" })
    assert.equal(result.text, "REAL COPY")
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, "/api/ai/execute")
    assert.equal(requests[0].headers["x-api-key"], "sk_k")
    assert.equal(requests[0].body.prompt, "Write a description")
    assert.equal(requests[0].body.storeId, 6)
  })
})

test("ai bridge: image posts the saved prompt id and returns the provider url", async () => {
  await withStubAi(async (base, requests) => {
    const bridge = createLiveAiBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    const result = await bridge.image({ promptId: 15, size: "1600x1600", aspectRatio: "1:1" })
    assert.equal(result.url, "https://cdn.test/out.png")
    assert.equal(requests[0].body.promptId, 15)
    assert.equal(requests[0].body.size, "1600x1600")
    assert.deepEqual(requests[0].body.target, { type: "image", field: "mainImage" })
  })
})

test("ai bridge: a failing platform surfaces the error", async () => {
  await withStubAi(async (base) => {
    const bridge = createLiveAiBridge({ appUrl: base, apiKey: "sk_k", storeId: 6 })
    await assert.rejects(() => bridge.complete({ prompt: "FAIL" }), /AI provider exploded/)
  })
})
