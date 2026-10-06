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

// ─── Tiny HTML helpers ───────────────────────────────────────────────────────

function decodeEntities(input) {
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&copy;/gi, "©")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
}

function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|h\d)>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Editorial text inside a content block. Mirrors the CLI scraper's DOM pass:
 * scripts/styles and social/copyright widgets are dropped, images become
 * `[image: alt]` placeholders and links are unwrapped.
 */
function htmlBlockToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(div|span|p)[^>]*class="[^"]*(?:copyright2|socialIcon)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<img\b[^>]*>/gi, (tag) => `[image: ${attrValue(tag, "alt")}]`)
      .replace(/<\/?(picture|source)\b[^>]*>/gi, " ")
      .replace(/<\/?a\b[^>]*>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|h\d|tr|td)>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
}

function attrValue(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) || tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i"))
  return match ? match[1] : ""
}

function applyMarkup(price, multiplier) {
  const value = parseFloat(String(price).replace(/[^0-9.]/g, ""))
  if (!Number.isFinite(value) || value <= 0) return "0.00"
  const result = value * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1)
  return (Math.round(result * 100) / 100).toFixed(2)
}

/** File extension from a URL path, ignoring query strings and fragments. */
function imageExtension(url) {
  const path = String(url).split("?")[0].split("#")[0]
  const extension = path.split(".").pop() || ""
  return /^[a-z0-9]{2,5}$/i.test(extension) ? extension.toLowerCase() : "gif"
}

/** Normalizes a stored JSON column to a comparable string. */
function normalizeJson(value) {
  if (value === undefined || value === null || value === "") return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// ─── Fetch (direct or via the html-scraper proxy) ────────────────────────────

async function fetchPage(ctx, url, config) {
  if (config.useProxy && config.proxyApiKey) {
    const proxyUrl = `${PROXY_BASE}?url=${encodeURIComponent(url)}&waitUntil=load&followRedirects=true&timeoutMs=30000`
    const res = await ctx.http.get(proxyUrl, { Authorization: `Bearer ${config.proxyApiKey}` }, { timeoutMs: 60000 })
    const data = res.data
    const html = data && typeof data === "object" && data.data && data.data.extracted ? data.data.extracted.html : ""
    if (!html) throw new Error(`Proxy returned no HTML (HTTP ${res.status})`)
    return html
  }
  const res = await ctx.http.get(url, { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" }, { timeoutMs: 45000 })
  if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`)
  return typeof res.data === "string" ? res.data : JSON.stringify(res.data)
}

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

// ─── Product page parsing ────────────────────────────────────────────────────

const FORMAT_MAP = {
  "Instant Download Only": "MP3 Download",
  "Instant Download": "MP3 Download",
  "MP3 Download": "MP3 Download",
  "MP3 CDs": "MP3 CDs",
  "Audio CDs": "Audio CDs",
}

function parseCategories(html) {
  const block = html.match(/class="[^"]*breadcrumbs?[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
  if (!block) return []
  const categories = []
  const re = /<a[^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = re.exec(block[1])) !== null) {
    const text = stripTags(match[1])
    if (text && text.toLowerCase() !== "home" && categories.indexOf(text) === -1) categories.push(text)
  }
  return categories
}

function parseVariations(html) {
  const select = html.match(/<select[^>]*id="[^"]*addtocart[^"]*"[^>]*>([\s\S]*?)<\/select>/i)
  if (!select) return []

  const variations = []
  const body = select[1]

  const groupRe = /<optgroup[^>]*label="([^"]*)"[^>]*>([\s\S]*?)<\/optgroup>/gi
  let groupMatch
  let sawGroup = false
  while ((groupMatch = groupRe.exec(body)) !== null) {
    sawGroup = true
    const groupLabel = FORMAT_MAP[groupMatch[1]] || groupMatch[1]
    const optionRe = /<option[^>]*>([\s\S]*?)<\/option>/gi
    let optionMatch
    while ((optionMatch = optionRe.exec(groupMatch[2])) !== null) {
      pushVariation(variations, groupLabel, optionMatch[1], optionMatch[0])
    }
  }

  if (!sawGroup) {
    const optionRe = /<option[^>]*>([\s\S]*?)<\/option>/gi
    let optionMatch
    while ((optionMatch = optionRe.exec(body)) !== null) {
      const text = stripTags(optionMatch[1])
      const group = /audio\s*cd/i.test(text) ? "Audio CDs" : /mp3\s*cd/i.test(text) ? "MP3 CDs" : "MP3 Download"
      pushVariation(variations, group, optionMatch[1], optionMatch[0])
    }
  }

  return variations
}

function pushVariation(variations, format, rawText, rawTag) {
  const text = stripTags(rawText)
  if (!text) return
  const priceMatch = text.match(/\$([0-9.]+)/)
  const value = decodeURIComponent(attrValue(rawTag, "value") || "")
  variations.push({
    format,
    name: text.replace(/\s*-\s*\$[0-9.]+/, "").replace(/\s+/g, " ").trim(),
    price: priceMatch ? priceMatch[1] : "0",
    sku: value,
  })
}

/** Primary track list layout: `<li class="volume-header">` + `<li>` tracks inside `.track_list ol`. */
function parseTrackLists(html) {
  const containers = []
  const startRe = /class="track_list"[^>]*>/g
  let match
  while ((match = startRe.exec(html)) !== null) containers.push(match.index)

  const volumes = []
  const seen = {}

  for (let i = 0; i < containers.length; i++) {
    const start = containers[i]
    const end = i + 1 < containers.length ? containers[i + 1] : Math.min(html.length, start + 400000)
    const slice = html.slice(start, end)

    // Track list markup: <ol ...> ... </ol> (flat list of volume headers + tracks)
    const olMatch = slice.match(/<ol[^>]*>([\s\S]*?)<\/ol>/i)
    if (!olMatch) continue

    const parsed = []
    let current = null
    const liRe = /<li([^>]*)>([\s\S]*?)<\/li>/gi
    let liMatch
    while ((liMatch = liRe.exec(olMatch[1])) !== null) {
      const attrs = liMatch[1]
      const inner = liMatch[2]
      if (/volume-header/i.test(attrs)) {
        const bold = inner.match(/<span[^>]*class="[^"]*bold[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
        const headerText = bold ? stripTags(bold[1]) : stripTags(inner)
        const volumeMatch = headerText.match(/volume\s*\d+/i)
        current = { name: volumeMatch ? volumeMatch[0].replace(/\s+/g, " ") : `Volume ${parsed.length + 1}`, tracks: [] }
        parsed.push(current)
        continue
      }
      if (/how-recordings-dated/i.test(attrs)) continue
      const track = stripTags(inner).replace(/\.mp3$/i, "").trim()
      if (!track) continue
      if (!current) {
        current = { name: "Volume 1", tracks: [] }
        parsed.push(current)
      }
      current.tracks.push(track)
    }

    const filtered = parsed.filter((volume) => volume.tracks.length > 0)
    if (filtered.length === 0) continue
    const signature = filtered.map((volume) => volume.tracks.join("\n")).join("\n---\n")
    if (seen[signature]) continue
    seen[signature] = true
    for (const volume of filtered) volumes.push(volume)
  }

  return volumes
}

/** Fallback A: `#audiocd_track_list` — one row per disc, name in td.audiocdvolumeinfo. */
function parseAudiocdVolumes(html) {
  const volumes = []
  const start = html.indexOf('id="audiocd_track_list"')
  if (start === -1) return volumes
  const tableEnd = html.indexOf("</table>", start)
  const slice = html.slice(start, tableEnd === -1 ? start + 200000 : tableEnd)
  const rowRe = /<tr[\s\S]*?<\/tr>/gi
  let row
  while ((row = rowRe.exec(slice)) !== null) {
    const cell = row[0].match(/<td[^>]*class="[^"]*audiocdvolumeinfo[^"]*"[^>]*>([\s\S]*?)<\/td>/i)
    if (!cell) continue
    const strong = cell[1].match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)
    const name = strong ? stripTags(strong[1]) : `Disc ${volumes.length + 1}`
    const tracks = []
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi
    let li
    while ((li = liRe.exec(cell[1])) !== null) {
      const track = stripTags(li[1]).replace(/\.mp3$/i, "").trim()
      if (track) tracks.push(track)
    }
    if (tracks.length > 0) volumes.push({ name: name || `Disc ${volumes.length + 1}`, tracks })
  }
  return volumes
}

/** Fallback B: the MP3-CD/download tables — first cell = volume, last cell = tracks. */
function parseMp3cdVolumes(html) {
  const volumes = []
  const seen = {}
  for (const id of ["download_mp3cd_track_list", "mp3cd_track_list"]) {
    const start = html.indexOf(`id="${id}"`)
    if (start === -1) continue
    const tableEnd = html.indexOf("</table>", start)
    const slice = html.slice(start, tableEnd === -1 ? start + 200000 : tableEnd)
    const rowRe = /<tr[\s\S]*?<\/tr>/gi
    let row
    while ((row = rowRe.exec(slice)) !== null) {
      const cells = []
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
      let cell
      while ((cell = cellRe.exec(row[0])) !== null) cells.push(cell[1])
      if (cells.length < 2) continue
      const name = stripTags(cells[0]) || `Volume ${volumes.length + 1}`
      const tracks = decodeEntities(
        String(cells[cells.length - 1])
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/(p|div|li|tr|td)>/gi, "\n")
          .replace(/<[^>]+>/g, ""),
      )
        .split("\n")
        .map((track) => track.replace(/\.mp3$/i, "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
      if (tracks.length === 0) continue
      const signature = `${name}\n${tracks.join("\n")}`
      if (seen[signature]) continue
      seen[signature] = true
      volumes.push({ name, tracks })
    }
  }
  return volumes
}

/** All track-list layouts OTRCat uses, in the same fallback order as the CLI scraper. */
function parseVolumes(html) {
  const lists = parseTrackLists(html)
  if (lists.length > 0) return lists
  const cds = parseAudiocdVolumes(html)
  if (cds.length > 0) return cds
  return parseMp3cdVolumes(html)
}

function parseProductPage(html, url) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = h1 ? stripTags(h1[1]) : ""

  const categories = parseCategories(html)

  let mainPicture = ""
  const imgRe = /<img[^>]+src="([^"]+)"/gi
  let imgMatch
  while ((imgMatch = imgRe.exec(html)) !== null) {
    const src = imgMatch[1]
    if (src.indexOf("/cds/") !== -1 || src.indexOf("products/cds") !== -1) {
      mainPicture = src
      break
    }
  }

  const variations = parseVariations(html)

  let price = ""
  for (const variation of variations) {
    const name = variation.name.toLowerCase()
    if (name.indexOf("download") !== -1 && name.indexOf("collection") !== -1 && name.indexOf("only") === -1) {
      price = variation.price
      break
    }
  }
  if (!price) {
    for (const variation of variations) {
      if (variation.name.toLowerCase().indexOf("download") !== -1) {
        price = variation.price
        break
      }
    }
  }

  // Description: #product_info holds the editorial copy; the add-to-cart
  // section that follows is the reliable end marker.
  let description = ""
  const infoIdx = html.indexOf('id="product_info"')
  if (infoIdx !== -1) {
    // Start at the opening `<` of the element (the slice point is mid-tag).
    const tagStart = html.lastIndexOf("<", infoIdx)
    const rest = html.slice(tagStart === -1 ? infoIdx : tagStart)
    const endMarkers = ["addtocart_dropdown", 'class="track_list"', "<footer"]
    let end = rest.length
    for (const marker of endMarkers) {
      const at = rest.indexOf(marker)
      if (at !== -1 && at < end) end = at
    }
    description = htmlBlockToText(rest.slice(0, end))
  } else {
    const contentIdx = html.indexOf('class="product-content"')
    if (contentIdx !== -1) description = htmlBlockToText(html.slice(contentIdx, contentIdx + 40000))
  }
  description = description.replace(/Text on OTRCAT\.com[\s\S]*$/i, "").trim()

  const contentText = stripTags(html.slice(html.indexOf('class="product-content"') !== -1 ? html.indexOf('class="product-content"') : 0, 120000))
  const recordingsMatch = contentText.match(/(\d+)\s*old time radio show recordings?/i)
  const playtimeMatch = contentText.match(/total playtime\s*([^)]+)/i)
  const spaceMatch = contentText.match(/([\d.]+\s*(?:MB|GB))/i)

  const subtitleMatch = html.match(/<p[^>]*class="[^"]*textleft[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
  const subtitle = subtitleMatch ? stripTags(subtitleMatch[1]) : ""

  const audioMatch = html.match(/<audio[^>]*src="([^"]+)"/i) || html.match(/<source[^>]*src="([^"]+)"/i)

  return {
    url,
    title,
    subtitle,
    categories,
    mainPicture,
    price,
    description,
    volumes: parseVolumes(html),
    variations,
    totalRecordings: recordingsMatch ? recordingsMatch[1] : "",
    totalPlaytime: playtimeMatch ? playtimeMatch[1].trim() : "",
    totalSpace: spaceMatch ? spaceMatch[1] : "",
    sampleLink: audioMatch ? audioMatch[1] : "",
  }
}

// ─── Product payload helpers ─────────────────────────────────────────────────

function buildVariationGroups(variations, multiplier) {
  if (variations.length === 0) return null

  const items = []
  for (const variation of variations) {
    if (variation.format === "MP3 CDs") {
      const base = parseFloat(variation.price) || 0
      items.push({
        name: variation.name,
        price: applyMarkup(base > 0 ? base + 5 : 0, multiplier),
        stock: "",
        group: "MP3 CDs",
        shippingPolicy: "1",
      })
    } else {
      items.push({
        name: variation.name,
        price: applyMarkup(variation.price, multiplier),
        stock: "",
        group: variation.format,
        shippingPolicy: variation.format !== "MP3 Download" ? "1" : "",
      })
    }
  }

  const cdVariations = variations.filter((variation) => variation.format === "MP3 CDs")
  const collectionCd = cdVariations.find((variation) => !/VOL|DISK|ONLY/i.test(variation.name)) || cdVariations[0]
  if (collectionCd) {
    items.push({
      name: collectionCd.name.replace(/^MP3 CD/i, "USB Stick"),
      price: applyMarkup((parseFloat(collectionCd.price) || 0) + 5, multiplier),
      stock: "",
      group: "USB Stick",
      shippingPolicy: "1",
    })
  }

  return [{ groupName: "Format", hasSubgroups: true, items }]
}

function buildCustomAttributes(data, url) {
  const attributes = [{ key: "EXTERNAL_PAGE", value: url, isVisible: false }]
  if (data.sampleLink) attributes.push({ key: "sampleLink", value: data.sampleLink, isVisible: false })
  if (data.mainPicture) attributes.push({ key: "mainPicture", value: data.mainPicture, isVisible: false })
  if (data.totalPlaytime) attributes.push({ key: "Total Playtime", value: data.totalPlaytime, isVisible: true })
  if (data.totalRecordings) attributes.push({ key: "Total Records", value: data.totalRecordings, isVisible: true })
  if (data.totalSpace) attributes.push({ key: "totalSpace", value: data.totalSpace, isVisible: false })
  if (data.subtitle) attributes.push({ key: "subtitle", value: data.subtitle, isVisible: false })
  if (data.volumes.length > 0) attributes.push({ key: "volumes", value: JSON.stringify(data.volumes), isVisible: false })
  return attributes
}

function buildTrackListing(data) {
  if (data.volumes.length === 0) return ""
  let total = 0
  const items = []
  for (const volume of data.volumes) {
    for (const track of volume.tracks) {
      total++
      items.push(`<li>${track.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li>`)
    }
  }
  const playtime = data.totalPlaytime ? ` (${data.totalPlaytime})` : ""
  return `<h3>Track Listing</h3><details><summary>Show all ${total} tracks${playtime}</summary><ul>${items.join("")}</ul></details>`
}

// ─── AI copy ─────────────────────────────────────────────────────────────────

const DESCRIPTION_PROMPT = `You are a copywriter for vintage Old Time Radio (OTR) programs and digital audio collections.

Write a natural, informative product description in HTML only: <h2>, <h3>, <p>, <ul>, <li>.

Always preserve all factual information provided — series name, episode titles, broadcast dates, episode count, genres, performers, and audio format. Never invent or speculate about missing details. Avoid unrelated information such as shipping, delivery, refunds, or logistics.

Incorporate the most interesting and relevant details from the title, description, categories, and metadata. Focus on what makes this collection appealing to collectors and enthusiasts.

Tone: informative and warm. Write naturally — no keyword stuffing, no salesy calls to action, no pricing mentions.

Length: approximately 200–300 words.

Structure:
<h2>Product Title</h2>
<p>Introduction — a few sentences that hook the reader</p>
<h3>Collection Highlights</h3>
<ul><li>2-4 notable highlights from the collection</li></ul>

Do not include a "Program Details" section or list technical specs like recording count, playtime, price, or performer lists verbatim. Weave those details naturally into the introduction and highlights instead.

Product data:`

const BULLETPOINTS_PROMPT = `You are a copywriter for a marketplace that sells vintage old-time radio shows.

Generate {bulletCount} short bullet points describing what this collection is about.

Rules:
- Plain text only, one per line
- Each bullet: 6-8 words max
- Describe the collection's content and appeal — genre, themes, notable shows included
- Do NOT list technical specs (no recording counts, playtime, audio format, sample availability, price)
- Do NOT include shipping, delivery, or purchasing information
- Be factual — never invent details
- Output each bullet point as a raw line with no dash, hyphen, asterisk, bullet character, or numbering prefix — just the plain text

Product data:`

function aiInput(data, price) {
  return JSON.stringify(
    {
      title: data.title,
      subtitle: data.subtitle,
      categories: data.categories,
      price: price,
      totalRecordings: data.totalRecordings || "",
      totalPlaytime: data.totalPlaytime || "",
      sampleAudioAvailable: !!data.sampleLink,
      rawDescription: (data.description || "").slice(0, 6000),
      volumeCount: data.volumes.length,
      totalTracks: data.volumes.reduce((count, volume) => count + volume.tracks.length, 0),
      volumes: data.volumes.slice(0, 12).map((volume) => ({
        name: volume.name,
        trackCount: volume.tracks.length,
        tracks: volume.tracks.slice(0, 10),
      })),
    },
    null,
    2,
  )
}

// ─── Import pipeline ─────────────────────────────────────────────────────────

function newStats() {
  return { created: 0, updated: 0, skipped: 0, failed: 0, audioOnly: 0 }
}

/**
 * One import unit per step. Each step performs at most one host call (fetch,
 * AI description, AI bullets, image import, save) so the state is checkpointed
 * between calls and a tick can pause between any two of them.
 */
async function importStep(ctx, state, config) {
  let work = state.work
  if (!work) {
    const url = state.urls[state.cursor]
    work = { url, sku: url.split("/").pop() || `otrcat-${state.cursor}`, step: "fetch" }
  }
  const label = `[${state.cursor + 1}/${state.total}]`
  const stats = { ...state.stats }

  const finish = (nextWork) => ({
    finished: true,
    state: { ...state, stats, work: null, cursor: state.cursor + 1 },
    nextWork,
  })

  try {
    if (work.step === "fetch") {
      const existing = await ctx.products.findBySku(work.sku)
      if (existing && config.skipExisting) {
        stats.skipped++
        await ctx.jobs.item({ ref: work.sku, status: "skipped", productId: existing.id, data: { reason: "exists" } })
        return finish()
      }

      const html = await fetchPage(ctx, work.url, config)
      const data = parseProductPage(html, work.url)
      if (!data.title) throw new Error("no product title found")

      const variations = data.variations.filter((variation) => variation.format !== "Audio CDs")
      if (data.variations.length > 0 && variations.length === 0) {
        stats.audioOnly++
        await ctx.jobs.item({ ref: work.sku, status: "skipped", data: { reason: "audio-cds-only" } })
        return finish()
      }

      const nextStep = config.aiCopy
        ? "copy-desc"
        : config.aiImage && data.mainPicture
          ? "ai-image"
          : config.importImages && data.mainPicture
            ? "image"
            : "save"
      ctx.jobs.log(`${label} parsed ${data.title} ($${data.price || "0"}, ${variations.length} variants)`)
      return {
        finished: false,
        state: {
          ...state,
          stats,
          work: { ...work, step: nextStep, data, variations, description: data.description, bulletpoints: "", imageUrl: "" },
        },
      }
    }

    if (work.step === "copy-desc") {
      try {
        const copy = await ctx.ai.complete({
          prompt: `${config.aiPrompt || DESCRIPTION_PROMPT}\n${aiInput(work.data, work.data.price)}`,
          maxTokens: 1200,
          timeoutMs: 25_000,
        })
        if (copy.text && copy.text.trim()) work.description = copy.text.trim()
      } catch (error) {
        ctx.jobs.log(`${label} AI description failed (${(error && error.message) || error}) — keeping original`, "warn")
      }
      work.step = "copy-bullets"
      return { finished: false, state: { ...state, stats, work } }
    }

    if (work.step === "copy-bullets") {
      try {
        const bullets = await ctx.ai.complete({
          prompt: `${BULLETPOINTS_PROMPT.replace("{bulletCount}", String(config.bulletCount))}\n${aiInput(work.data, work.data.price)}`,
          maxTokens: 400,
          timeoutMs: 25_000,
        })
        work.bulletpoints = (bullets.text || "")
          .split("\n")
          .map((line) => line.replace(/^[\s\-•*‣▪▸→]+/g, "").trim())
          .filter(Boolean)
          .join("\n")
      } catch (error) {
        ctx.jobs.log(`${label} AI bullets failed (${(error && error.message) || error})`, "warn")
      }
      work.step = config.aiImage && work.data.mainPicture
        ? "ai-image"
        : config.importImages && work.data.mainPicture
          ? "image"
          : "save"
      return { finished: false, state: { ...state, stats, work } }
    }

    if (work.step === "ai-image") {
      try {
        const ai = await ctx.ai.image({
          promptId: config.aiImagePromptId,
          referenceImage: work.data.mainPicture,
          size: config.aiImageSize,
          aspectRatio: "1:1",
        })
        if (ai && ai.base64) {
          const uploaded = await ctx.files.upload({
            name: `${work.sku}.webp`,
            data: ai.base64,
            contentType: "image/webp",
            folder: "products",
          })
          work.imageUrl = uploaded.url
        } else if (ai && ai.url && ai.url.indexOf("data:") === 0) {
          const comma = ai.url.indexOf(",")
          const semi = ai.url.indexOf(";")
          const contentType = semi > 5 ? ai.url.slice(5, semi) : "image/webp"
          const extension = contentType.split("/").pop() || "webp"
          const uploaded = await ctx.files.upload({
            name: `${work.sku}-ai.${extension}`,
            data: comma >= 0 ? ai.url.slice(comma + 1) : "",
            contentType,
            folder: "products",
          })
          work.imageUrl = uploaded.url
        } else if (ai && ai.url) {
          try {
            const imported = await ctx.files.importFromUrl({
              url: ai.url,
              name: `${work.sku}-ai.${imageExtension(ai.url)}`,
              folder: "products",
            })
            work.imageUrl = imported.url
          } catch (error) {
            ctx.jobs.log(`${label} AI image re-host failed (${(error && error.message) || error}) — using the provider URL`, "warn")
            work.imageUrl = ai.url
          }
        } else {
          ctx.jobs.log(`${label} AI image returned nothing — using original artwork`, "warn")
        }
      } catch (error) {
        ctx.jobs.log(`${label} AI image failed (${(error && error.message) || error}) — using original artwork`, "warn")
      }
      work.step = work.imageUrl || !(config.importImages && work.data.mainPicture) ? "save" : "image"
      return { finished: false, state: { ...state, stats, work } }
    }

    if (work.step === "image") {
      try {
        const extension = imageExtension(work.data.mainPicture)
        const imported = await ctx.files.importFromUrl({
          url: work.data.mainPicture,
          name: `${work.sku}.${extension}`,
          folder: "products",
        })
        work.imageUrl = imported.url
      } catch (error) {
        ctx.jobs.log(`${label} image import failed (${(error && error.message) || error})`, "warn")
      }
      work.step = "save"
      return { finished: false, state: { ...state, stats, work } }
    }

    // step === "save"
    const data = work.data
    const trackListing = buildTrackListing(data)
    const description = trackListing ? `${work.description || data.description}${trackListing}` : work.description || data.description
    const image = work.imageUrl || data.mainPicture

    const payload = {
      name: data.title,
      sku: work.sku,
      price: applyMarkup(data.price, config.priceMultiplier),
      description,
      bulletpoints: work.bulletpoints,
      status: config.defaultStatus,
      category: data.categories[0] || "",
      subCategory: data.categories[1] || "",
      image,
      mainImage: image,
      customAttributes: buildCustomAttributes(data, work.url),
      variationGroups: buildVariationGroups(work.variations, config.priceMultiplier) || undefined,
      productNotes: data.subtitle || undefined,
    }

    const result = await ctx.products.upsertBySku(payload)
    if (result.created) stats.created++
    else stats.updated++

    await ctx.jobs.item({
      ref: work.sku,
      status: "ok",
      productId: result.id,
      data: {
        title: data.title,
        price: payload.price,
        variants: work.variations.length,
        image: !!work.imageUrl,
        ai: !!work.bulletpoints,
      },
    })
    ctx.jobs.log(
      `${label} ${result.created ? "created" : "updated"} ${data.title} ($${payload.price}, ${work.variations.length} variants)`,
    )
    return finish()
  } catch (error) {
    stats.failed++
    ctx.jobs.log(`${label} FAILED ${work.sku}: ${(error && error.message) || error}`, "error")
    await ctx.jobs.item({ ref: work.sku, status: "failed", error: (error && error.message) || String(error) })
    return finish()
  }
}

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
      await ctx.jobs.progress({ total: next.total, processed: next.page, message: `HTTP ${res.status} · ${(body.length / 1024).toFixed(0)} KB` })
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
      if (!state.url || state.url.indexOf("https://www.otrcat.com/p/") !== 0) {
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

        ctx.jobs.log(`Page ${state.listingCursor + 1}: +${found.length} URLs (${capped.length} total)${finished ? " — listing complete" : ""}`)
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
        return { state: { ...state, phase: "refresh", skus: capped }, done: capped.length === 0, result: capped.length === 0 ? state.stats : undefined }
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
        await ctx.jobs.item({ ref: sku, status: "failed", error: (error && error.message) || String(error) })
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
