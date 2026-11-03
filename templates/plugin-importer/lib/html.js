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

module.exports = { decodeEntities, stripTags, htmlBlockToText, attrValue, applyMarkup, imageExtension, normalizeJson }
