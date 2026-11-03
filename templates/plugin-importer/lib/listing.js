const { decodeEntities } = require("./html")

// ─── Listing parsing ─────────────────────────────────────────────────────────

function extractProductUrls(html) {
  const urls = []
  const seen = {}
  const push = (raw) => {
    const url = decodeEntities(String(raw)).split("#")[0]
    if (url && url.indexOf("https://www.otrcat.com/p/") === 0 && !seen[url]) {
      seen[url] = true
      urls.push(url)
    }
  }

  // Listing rows navigate via onclick="document.location='…/p/…'".
  const rowRe = /<tr[^>]*onclick="([^"]*)"/gi
  let row
  while ((row = rowRe.exec(html)) !== null) {
    const nav = row[1].match(/document\.location\s*=\s*['"]([^'"]+)/)
    if (nav) push(nav[1])
  }

  // Product titles link to the product page from the listing table.
  const titleRe = /<strong[^>]*class="[^"]*\bh3\b[^"]*"[^>]*>[\s\S]*?<a[^>]+href="(https:\/\/www\.otrcat\.com\/p\/[^"]+)"/gi
  let title
  while ((title = titleRe.exec(html)) !== null) push(title[1])

  // Fallback for markup changes: any product link on the page. This can pick
  // up sidebar/related links, so it only runs when the listing selectors match
  // nothing at all.
  if (urls.length === 0) {
    const anyRe = /href="(https:\/\/www\.otrcat\.com\/p\/[^"]+)"/gi
    let any
    while ((any = anyRe.exec(html)) !== null) push(any[1])
  }

  return urls
}

/** Next-page link from the listing pagination ("Next 100 »"). */
function findNextPageUrl(html) {
  const patterns = [
    /<a[^>]+href="([^"]+)"[^>]*class="[^"]*btn-pagination[^"]*"[^>]*>\s*Next/i,
    /<a[^>]+class="[^"]*btn-pagination[^"]*"[^>]*href="([^"]+)"[^>]*>\s*Next/i,
    /<a[^>]+href="([^"]+)"[^>]*rel="next"/i,
    /<a[^>]+rel="next"[^>]*href="([^"]+)"/i,
    /<a[^>]+href="([^"]*\bpage=\d+[^"]*)"[^>]*>\s*Next/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) {
      const url = decodeEntities(match[1])
      // Only follow same-site links that actually advance the pagination.
      if (url.indexOf("www.otrcat.com") !== -1 && url.indexOf("page=") !== -1) return url
    }
  }
  return ""
}

module.exports = { extractProductUrls, findNextPageUrl }
