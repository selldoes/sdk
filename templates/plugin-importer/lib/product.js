const { stripTags, attrValue, decodeEntities, htmlBlockToText } = require("./html")

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
    name: text
      .replace(/\s*-\s*\$[0-9.]+/, "")
      .replace(/\s+/g, " ")
      .trim(),
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
      const track = stripTags(inner)
        .replace(/\.mp3$/i, "")
        .trim()
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
      const track = stripTags(li[1])
        .replace(/\.mp3$/i, "")
        .trim()
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
        .map((track) =>
          track
            .replace(/\.mp3$/i, "")
            .replace(/\s+/g, " ")
            .trim(),
        )
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

  const contentText = stripTags(
    html.slice(html.indexOf('class="product-content"') !== -1 ? html.indexOf('class="product-content"') : 0, 120000),
  )
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

module.exports = { parseProductPage }
