// ─── Config helpers ──────────────────────────────────────────────────────────

const DEFAULT_LISTING_URL = "https://www.otrcat.com/all?order=name&d=&limit=100"
const SITE = "https://www.otrcat.com"
const MAX_LISTING_PAGES = 50
const PROXY_BASE = "https://api.apiraven.com/v1/html-scraper/scrape"
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// ─── Config helpers ──────────────────────────────────────────────────────────

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  const text = String(value).toLowerCase()
  if (["1", "true", "yes", "on"].includes(text)) return true
  if (["0", "false", "no", "off"].includes(text)) return false
  return fallback
}

function configOf(ctx) {
  const c = ctx.config || {}
  return {
    listingUrl: String(c.listingUrl || DEFAULT_LISTING_URL),
    maxProducts: Math.max(0, num(c.maxProducts, 0)),
    priceMultiplier: num(c.priceMultiplier, 1),
    importImages: bool(c.importImages, true),
    aiCopy: bool(c.aiCopy, true),
    aiImage: bool(c.aiImage, false),
    aiImagePromptId: Math.max(1, num(c.aiImagePromptId, 15)),
    aiImageSize: String(c.aiImageSize || "2048x2048"),
    defaultStatus: String(c.defaultStatus || "draft"),
    skipExisting: bool(c.skipExisting, true),
    useProxy: bool(c.useProxy, false),
    proxyApiKey: c.proxyApiKey ? String(c.proxyApiKey) : "",
    bulletCount: Math.max(1, Math.min(num(c.bulletCount, 4), 8)),
    aiPrompt: c.aiPrompt ? String(c.aiPrompt) : "",
  }
}

module.exports = { DEFAULT_LISTING_URL, SITE, MAX_LISTING_PAGES, PROXY_BASE, BROWSER_UA, num, bool, configOf }
