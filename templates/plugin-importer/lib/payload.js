const { applyMarkup } = require("./html")

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

module.exports = { buildVariationGroups, buildCustomAttributes, buildTrackListing }
