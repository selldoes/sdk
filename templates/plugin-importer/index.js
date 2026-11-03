/**
 * Product importer — a worked end-to-end scraping example.
 *
 * Scans a listing page, follows its pagination, parses each product page and
 * creates/updates store products with artwork, variants and (optional) AI
 * copy. Everything runs inside the sandboxed QuickJS VM: no fs, no network, no
 * secrets. The only way out is `ctx.*` capabilities, validated against the
 * manifest permissions:
 *
 *   api:external    fetch listing/product pages (direct or via the HTML proxy)
 *   ai:use          optional AI copy (description + bullet points) and AI main image
 *   files:write     import product artwork into store storage
 *   products:read   look up existing SKUs (skip/refresh)
 *   products:write  create and update store products
 *   db:read         count catalog rows for the status page
 *   storage:read/write  persist the last-import summary for the status page
 *
 * Jobs are chunked: the host calls `step` repeatedly within a tick budget and
 * checkpoints the state after every step, so an import survives pauses,
 * restarts and Lambda time limits.
 *
 * This example targets OTRCat. To point it at another site, adapt
 * `extractProductUrls`, `parseProductPage` and the `variations` mapping — the
 * job pipeline, queueing and product writing stay the same. The parser uses
 * targeted regexes because the sandbox has no node_modules; a Node job entry
 * (`"runtime": "node"`) could use cheerio instead.
 */

const { DEFAULT_LISTING_URL, SITE, MAX_LISTING_PAGES, configOf } = require("./lib/config")
const { fetchPage } = require("./lib/fetch")
const { extractProductUrls, findNextPageUrl } = require("./lib/listing")
const { parseProductPage } = require("./lib/product")
const { applyMarkup, normalizeJson } = require("./lib/html")
const { buildCustomAttributes, buildVariationGroups } = require("./lib/payload")
const { newStats, importStep } = require("./lib/pipeline")

// ─── Jobs ────────────────────────────────────────────────────────────────────

const jobs = {
  "test-fetch": {
    init(_input, ctx) {
      const pages = Math.max(1, Math.min(Number(ctx.config.pagesToFetch) || 3, 50))
      return { page: 0, total: pages, lastStatus: null, lastBytes: 0 }
    },

    async step(state, ctx) {
      const url = String(ctx.config.listingUrl || DEFAULT_LISTING_URL)
      const index = state.page
      ctx.jobs.log(`Fetching ${url} (${index + 1}/${state.total})`)
      const res = await ctx.http.get(url, {}, { timeoutMs: 30000 })
      const body = typeof res.data === "string" ? res.data : ""
      const next = { ...state, page: index + 1, lastStatus: res.status, lastBytes: body.length }
      await ctx.jobs.item({
        ref: `${url}#${next.page}`,
        status: res.status < 400 ? "ok" : "failed",
        error: res.status >= 400 ? `HTTP ${res.status}` : undefined,
        data: { status: res.status, bytes: body.length },
      })
      await ctx.jobs.progress({
        total: next.total,
        processed: next.page,
        message: `HTTP ${res.status} · ${(body.length / 1024).toFixed(0)} KB`,
      })
      return { state: next, done: next.page >= next.total }
    },

    finalize(state, ctx) {
      ctx.jobs.log("Test fetch finished")
      return { fetched: state.page, lastStatus: state.lastStatus, lastBytes: state.lastBytes }
    },
  },

  "probe-capabilities": {
    init() {
      return { phase: "start" }
    },

    async step(state, ctx) {
      if (state.phase !== "start") return { state, done: true }
      const imported = await ctx.files.importFromUrl({ url: "https://example.com", name: "probe.html", folder: "probe" })
      const product = await ctx.products.upsertBySku({
        name: "Capability Probe (plugin)",
        sku: "PROBE-CAPABILITIES",
        price: 9.99,
        status: "draft",
        hidden: true,
        description: "Created by the OTRCat plugin capability probe. Safe to delete.",
        mainImage: imported.url,
      })
      await ctx.jobs.progress({ total: 1, processed: 1, message: "Probe finished" })
      return {
        state: { ...state, phase: "done" },
        done: true,
        result: { productId: product.id, created: product.created, image: imported.url, imageBytes: imported.size },
      }
    },
  },

  /**
   * Parse tester: fetches one product URL and returns the parsed fields plus
   * the product payload the importer would save — writes nothing.
   */
  "preview-product": {
    init(input, ctx) {
      const config = configOf(ctx)
      return {
        fetched: false,
        url: String((input && (input.url || input.productUrl)) || "").trim(),
        config: {
          priceMultiplier: config.priceMultiplier,
          defaultStatus: config.defaultStatus,
          useProxy: config.useProxy,
          proxyApiKey: config.proxyApiKey,
        },
      }
    },

    async step(state, ctx) {
      if (state.fetched) return { state, done: true, result: state.preview }
      if (state.url?.indexOf("https://www.otrcat.com/p/") !== 0) {
        throw new Error('Pass a product URL, e.g. { "url": "https://www.otrcat.com/p/…" }')
      }
      const html = await fetchPage(ctx, state.url, state.config)
      const data = parseProductPage(html, state.url)
      const variations = data.variations.filter((variation) => variation.format !== "Audio CDs")
      const sku = state.url.split("/").pop() || "preview"
      const preview = {
        url: state.url,
        sku,
        parsed: {
          title: data.title,
          subtitle: data.subtitle,
          categories: data.categories,
          price: data.price,
          totalRecordings: data.totalRecordings,
          totalPlaytime: data.totalPlaytime,
          totalSpace: data.totalSpace,
          sampleLink: data.sampleLink,
          mainPicture: data.mainPicture,
          volumeCount: data.volumes.length,
          trackCount: data.volumes.reduce((count, volume) => count + volume.tracks.length, 0),
          volumes: data.volumes,
          variations: data.variations,
          keptVariations: variations.length,
          descriptionPreview: (data.description || "").slice(0, 600),
        },
        payload: {
          name: data.title,
          sku,
          price: applyMarkup(data.price, state.config.priceMultiplier),
          status: state.config.defaultStatus,
          category: data.categories[0] || "",
          subCategory: data.categories[1] || "",
          customAttributes: buildCustomAttributes(data, state.url),
          variationGroups: buildVariationGroups(variations, state.config.priceMultiplier),
        },
      }
      await ctx.jobs.progress({ total: 1, processed: 1, message: `Parsed ${data.title || state.url}` })
      return { state: { ...state, fetched: true, preview }, done: true, result: preview }
    },
  },

  /**
   * Import pipeline: one listing fetch, then one product per step. The host
   * keeps calling `step` until the tick budget runs out; state is checkpointed
   * after every step, so the import resumes exactly where it stopped.
   */
  "import-products": {
    init(_input, ctx) {
      const config = configOf(ctx)
      return {
        phase: "listing",
        cursor: 0,
        listingCursor: 0,
        nextUrl: "",
        urls: [],
        total: 0,
        stats: newStats(),
        config: {
          listingUrl: config.listingUrl,
          maxProducts: config.maxProducts,
          priceMultiplier: config.priceMultiplier,
          importImages: config.importImages,
          aiCopy: config.aiCopy,
          aiImage: config.aiImage,
          aiImagePromptId: config.aiImagePromptId,
          aiImageSize: config.aiImageSize,
          defaultStatus: config.defaultStatus,
          skipExisting: config.skipExisting,
          useProxy: config.useProxy,
          proxyApiKey: config.proxyApiKey,
          bulletCount: config.bulletCount,
          aiPrompt: config.aiPrompt,
        },
      }
    },

    async step(state, ctx) {
      const config = state.config

      if (state.phase === "listing") {
        const pageUrl = state.nextUrl || config.listingUrl
        ctx.jobs.log(`Fetching listing page ${state.listingCursor + 1}: ${pageUrl}`)
        const html = await fetchPage(ctx, pageUrl, config)

        const found = extractProductUrls(html)
        const urls = state.urls.slice()
        for (const url of found) {
          if (urls.indexOf(url) === -1) urls.push(url)
        }

        const nextUrl = findNextPageUrl(html)
        const hitCap = config.maxProducts > 0 && urls.length >= config.maxProducts
        const hitPageLimit = state.listingCursor + 1 >= MAX_LISTING_PAGES
        const capped = hitCap ? urls.slice(0, config.maxProducts) : urls
        const finished = !nextUrl || hitCap || hitPageLimit

        ctx.jobs.log(
          `Page ${state.listingCursor + 1}: +${found.length} URLs (${capped.length} total)${finished ? " — listing complete" : ""}`,
        )
        await ctx.jobs.progress({ total: capped.length, processed: 0, message: `Found ${capped.length} products` })

        const nextState = {
          ...state,
          urls: capped,
          total: capped.length,
          nextUrl: nextUrl,
          listingCursor: state.listingCursor + 1,
          phase: finished ? "import" : "listing",
        }
        return {
          state: nextState,
          done: finished && capped.length === 0,
          result: finished && capped.length === 0 ? { ...state.stats, urls: 0 } : undefined,
        }
      }

      if (state.cursor >= state.urls.length && !state.work) {
        return { state, done: true, result: state.stats }
      }

      const outcome = await importStep(ctx, state, config)
      const next = outcome.state
      const done = !next.work && next.cursor >= next.urls.length

      if (outcome.finished) {
        await ctx.jobs.progress({
          total: next.total,
          processed: next.cursor,
          failed: next.stats.failed,
          skipped: next.stats.skipped + next.stats.audioOnly,
          message: `${next.stats.created} created · ${next.stats.updated} updated · ${next.stats.failed} failed`,
        })
      }

      return { state: next, done, result: done ? next.stats : undefined }
    },

    /**
     * Persist a small summary for the dashboard's status page. `finalize` runs
     * once when the job completes (best effort).
     */
    async finalize(state, ctx) {
      const summary = {
        ...state.stats,
        total: state.total,
        finishedAt: new Date().toISOString(),
      }
      try {
        await ctx.storage.set("last-import", summary)
      } catch {
        // storage is optional — never fail a finished import over a summary
      }
      return summary
    },
  },

  /**
   * Refresh: re-check imported SKUs and patch price + variants when OTRCat
   * changed them. Runs one product per step, same chunking rules.
   */
  "refresh-products": {
    init(_input, ctx) {
      const config = configOf(ctx)
      return {
        phase: "collect",
        skus: [],
        cursor: 0,
        stats: { checked: 0, changed: 0, unchanged: 0, failed: 0 },
        config: {
          priceMultiplier: config.priceMultiplier,
          useProxy: config.useProxy,
          proxyApiKey: config.proxyApiKey,
          maxProducts: config.maxProducts,
        },
      }
    },

    async step(state, ctx) {
      const config = state.config

      if (state.phase === "collect") {
        // Only refresh products this importer created — never touch the
        // merchant's other catalog entries. Pages of 500 until exhausted.
        const PAGE_SIZE = 500
        const MAX_PAGES = 40
        const skus = []
        const seen = {}
        for (let page = 0; page < MAX_PAGES; page++) {
          const products = await ctx.products.list({
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
            fields: ["id", "sku", "customAttributes"],
            orderBy: "id",
            orderDir: "desc",
          })
          for (const product of products) {
            const attributesText =
              typeof product.customAttributes === "string"
                ? product.customAttributes
                : JSON.stringify(product.customAttributes || "")
            if (!product.sku || attributesText.indexOf("otrcat.com") === -1) continue
            const sku = String(product.sku)
            if (!seen[sku]) {
              seen[sku] = true
              skus.push(sku)
            }
          }
          if (products.length < PAGE_SIZE) break
        }
        const capped = config.maxProducts > 0 ? skus.slice(0, config.maxProducts) : skus
        ctx.jobs.log(`Refreshing ${capped.length} imported products`)
        return {
          state: { ...state, phase: "refresh", skus: capped },
          done: capped.length === 0,
          result: capped.length === 0 ? state.stats : undefined,
        }
      }

      if (state.cursor >= state.skus.length) {
        return { state, done: true, result: state.stats }
      }

      const sku = state.skus[state.cursor]
      try {
        const url = `${SITE}/p/${sku}`
        const html = await fetchPage(ctx, url, config)
        const data = parseProductPage(html, url)
        const variations = data.variations.filter((variation) => variation.format !== "Audio CDs")
        const existing = await ctx.products.findBySku(sku)
        let changed = false
        if (existing) {
          const nextPrice = applyMarkup(data.price, config.priceMultiplier)
          const nextGroups = buildVariationGroups(variations, config.priceMultiplier)
          const nextGroupsJson = nextGroups ? JSON.stringify(nextGroups) : ""
          const previousGroupsJson = normalizeJson(existing.variationGroups)
          const nextCategory = data.categories[0] || ""
          const nextSubCategory = data.categories[1] || ""
          const priceChanged = Number(existing.price) !== Number(nextPrice)
          const groupsChanged = previousGroupsJson !== nextGroupsJson
          const categoryChanged = String(existing.category || "") !== nextCategory
          const subCategoryChanged = String(existing.subCategory || "") !== nextSubCategory

          if (priceChanged || groupsChanged || categoryChanged || subCategoryChanged) {
            const patch = {}
            if (priceChanged) patch.price = nextPrice
            if (groupsChanged) patch.variationGroups = nextGroups || undefined
            if (categoryChanged) patch.category = nextCategory || undefined
            if (subCategoryChanged) patch.subCategory = nextSubCategory || undefined
            await ctx.products.update(existing.id, patch)
            changed = true
            state.stats.changed++
          } else {
            state.stats.unchanged++
          }
        }
        state.stats.checked++
        await ctx.jobs.item({
          ref: sku,
          status: "ok",
          productId: existing ? existing.id : undefined,
          data: { price: data.price, variants: variations.length, changed },
        })
      } catch (error) {
        state.stats.failed++
        await ctx.jobs.item({ ref: sku, status: "failed", error: error?.message || String(error) })
      }

      const next = { ...state, cursor: state.cursor + 1 }
      const done = next.cursor >= next.skus.length
      await ctx.jobs.progress({
        total: next.skus.length,
        processed: next.cursor,
        failed: next.stats.failed,
        message: `${next.stats.checked} checked · ${next.stats.changed} changed · ${next.stats.failed} failed`,
      })
      return { state: next, done, result: done ? next.stats : undefined }
    },
  },
}

// ─── API routes ──────────────────────────────────────────────────────────────

const apiRoutes = {
  ping: {
    GET: async (ctx) => ({
      ok: true,
      storeId: ctx.storeId,
      config: ctx.config,
      timestamp: new Date().toISOString(),
    }),
  },

  /** Latest products for the dashboard's "Recently imported" table. */
  recent: {
    GET: async (ctx) => {
      const products = await ctx.products.list({
        limit: 20,
        orderBy: "createdAt",
        orderDir: "desc",
        fields: ["id", "name", "sku", "price", "status", "mainImage", "createdAt"],
      })
      return {
        ok: true,
        rows: products.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          price: product.price,
          status: product.status,
        })),
      }
    },
  },

  /** Counts + the last import summary for the dashboard's status page. */
  status: {
    GET: async (ctx) => {
      const total = await ctx.db.count("products")
      const lastImport = await ctx.storage.get("last-import")
      return {
        ok: true,
        storeId: ctx.storeId,
        totalProducts: total,
        lastImport: lastImport ?? null,
        config: ctx.config,
      }
    },
  },
}

module.exports = { jobs, apiRoutes }
