const { PROXY_BASE, BROWSER_UA } = require("./config")

// ─── Fetch (direct or via the html-scraper proxy) ────────────────────────────

async function fetchPage(ctx, url, config) {
  if (config.useProxy && config.proxyApiKey) {
    const proxyUrl = `${PROXY_BASE}?url=${encodeURIComponent(url)}&waitUntil=load&followRedirects=true&timeoutMs=30000`
    const res = await ctx.http.get(proxyUrl, { Authorization: `Bearer ${config.proxyApiKey}` }, { timeoutMs: 60000 })
    const data = res.data
    const html = data && typeof data === "object" && data.data?.extracted ? data.data.extracted.html : ""
    if (!html) throw new Error(`Proxy returned no HTML (HTTP ${res.status})`)
    return html
  }
  const res = await ctx.http.get(
    url,
    { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" },
    { timeoutMs: 45000 },
  )
  if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`)
  return typeof res.data === "string" ? res.data : JSON.stringify(res.data)
}

module.exports = { fetchPage }
