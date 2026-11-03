const { fetchPage } = require("./fetch")
const { parseProductPage } = require("./product")
const { applyMarkup, imageExtension } = require("./html")
const { buildVariationGroups, buildCustomAttributes, buildTrackListing } = require("./payload")
const { DESCRIPTION_PROMPT, BULLETPOINTS_PROMPT, aiInput } = require("./ai")

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
        if (copy.text?.trim()) work.description = copy.text.trim()
      } catch (error) {
        ctx.jobs.log(`${label} AI description failed (${error?.message || error}) — keeping original`, "warn")
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
        ctx.jobs.log(`${label} AI bullets failed (${error?.message || error})`, "warn")
      }
      work.step =
        config.aiImage && work.data.mainPicture ? "ai-image" : config.importImages && work.data.mainPicture ? "image" : "save"
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
        if (ai?.base64) {
          const uploaded = await ctx.files.upload({
            name: `${work.sku}.webp`,
            data: ai.base64,
            contentType: "image/webp",
            folder: "products",
          })
          work.imageUrl = uploaded.url
        } else if (ai?.url && ai.url.indexOf("data:") === 0) {
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
        } else if (ai?.url) {
          try {
            const imported = await ctx.files.importFromUrl({
              url: ai.url,
              name: `${work.sku}-ai.${imageExtension(ai.url)}`,
              folder: "products",
            })
            work.imageUrl = imported.url
          } catch (error) {
            ctx.jobs.log(`${label} AI image re-host failed (${error?.message || error}) — using the provider URL`, "warn")
            work.imageUrl = ai.url
          }
        } else {
          ctx.jobs.log(`${label} AI image returned nothing — using original artwork`, "warn")
        }
      } catch (error) {
        ctx.jobs.log(`${label} AI image failed (${error?.message || error}) — using original artwork`, "warn")
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
        ctx.jobs.log(`${label} image import failed (${error?.message || error})`, "warn")
      }
      work.step = "save"
      return { finished: false, state: { ...state, stats, work } }
    }

    // step === "save"
    const data = work.data
    const trackListing = buildTrackListing(data)
    const description = trackListing
      ? `${work.description || data.description}${trackListing}`
      : work.description || data.description
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
    ctx.jobs.log(`${label} FAILED ${work.sku}: ${error?.message || error}`, "error")
    await ctx.jobs.item({ ref: work.sku, status: "failed", error: error?.message || String(error) })
    return finish()
  }
}

module.exports = { newStats, importStep }
