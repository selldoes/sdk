const EXTERNAL_AI_PROMPTS = "/api/external/ai/prompts"
const EXTERNAL_AI_MODELS = "/api/external/ai/models"
/** The merchant API also exposes the AI runner (the same one the dashboard uses). */
const AI_EXECUTE = "/api/ai/execute"

/**
 * Builds the live `ctx.ai` prompts bridge (saved AI prompts from Dashboard →
 * AI Prompts). Backed by the platform's merchant API
 * (`/api/external/ai/prompts`) — an older host that answers 404 surfaces a
 * clear "deploy the latest Selldesk" error instead of an empty list.
 */
export function createLivePromptsBridge(connection, log = () => {}) {
  const { appUrl, apiKey, storeId } = connection

  const call = async (search = "") => {
    const params = new URLSearchParams({ storeId: String(storeId) })
    const extra = String(search ?? "").replace(/^\?/, "")
    if (extra) {
      for (const [key, value] of new URLSearchParams(extra)) params.append(key, value)
    }
    const url = `${appUrl}${EXTERNAL_AI_PROMPTS}?${params.toString()}`
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      // non-JSON body
    }
    if (res.status === 404 && !data?.error) {
      throw new Error(
        "the store's platform does not expose AI prompt listing — deploy the latest Selldesk (GET /api/external/ai/prompts)",
      )
    }
    if (!res.ok) {
      const detail = data?.error || res.statusText || "request failed"
      throw new Error(`${detail} [${res.status} GET ${url}]`)
    }
    return data
  }

  return {
    async list(opts = {}) {
      const data = await call(opts.type ? `type=${encodeURIComponent(String(opts.type))}` : "")
      return Array.isArray(data?.prompts) ? data.prompts : []
    },
    async get(id) {
      // The external API lists rather than fetches by id — filter client-side
      // (the prompt library is small) to keep one endpoint.
      const prompts = await this.list()
      return prompts.find((prompt) => Number(prompt.id) === Number(id)) ?? null
    },
  }
}

/**
 * Builds the live `ctx.ai.listModels` bridge — the store's enabled AI models
 * (with pricing, context window and capabilities). Backed by the platform's
 * merchant API (`/api/external/ai/models`) — an older host that answers 404
 * surfaces a clear "deploy the latest Selldesk" error instead of an empty list.
 */
export function createLiveModelsBridge(connection, log = () => {}) {
  const { appUrl, apiKey, storeId } = connection

  const call = async (search = "") => {
    const params = new URLSearchParams({ storeId: String(storeId) })
    const extra = String(search ?? "").replace(/^\?/, "")
    if (extra) {
      for (const [key, value] of new URLSearchParams(extra)) params.append(key, value)
    }
    const url = `${appUrl}${EXTERNAL_AI_MODELS}?${params.toString()}`
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      // non-JSON body
    }
    if (res.status === 404 && !data?.error) {
      throw new Error(
        "the store's platform does not expose AI model listing — deploy the latest Selldesk (GET /api/external/ai/models)",
      )
    }
    if (!res.ok) {
      const detail = data?.error || res.statusText || "request failed"
      throw new Error(`${detail} [${res.status} GET ${url}]`)
    }
    return data
  }

  return {
    async list(opts = {}) {
      const params = new URLSearchParams()
      if (opts.type) params.set("type", String(opts.type))
      if (opts.provider) params.set("provider", String(opts.provider))
      const data = await call(params.toString())
      return Array.isArray(data?.models) ? data.models : []
    },
  }
}

/**
 * Builds the live `ctx.ai` bridge — text and image generation through the
 * store's own AI provider. Backed by the platform's AI runner
 * (`POST /api/ai/execute`, authenticated with the merchant API key), which
 * falls back to the store's saved provider + model when the request does not
 * name one. Without this bridge the preview answers every AI call with the
 * mock reply, so a plugin's copy never looks like the real thing.
 */
export function createLiveAiBridge(connection, log = () => {}) {
  const { appUrl, apiKey, storeId } = connection

  const call = async (body) => {
    const res = await fetch(`${appUrl.replace(/\/$/, "")}${AI_EXECUTE}`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, storeId }),
      signal: AbortSignal.timeout(120_000),
    })
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      // non-JSON body
    }
    if (!res.ok) {
      const detail = data?.error || res.statusText || "request failed"
      throw new Error(`${detail} [${res.status} POST ${AI_EXECUTE}]`)
    }
    return data ?? {}
  }

  return {
    async complete(opts = {}) {
      const prompt = String(opts.prompt ?? "")
      if (!prompt) throw new Error("ctx.ai.complete needs a prompt")
      const data = await call({
        prompt,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.provider ? { provider: opts.provider } : {}),
      })
      const text = String(data.text ?? data.content ?? "")
      log(`[live] ai.complete → ${text.length} characters`)
      return { text, tokensUsed: Number(data.tokensUsed) || 0 }
    },
    async image(opts = {}) {
      const data = await call({
        target: { type: "image", field: "mainImage" },
        ...(opts.promptId ? { promptId: opts.promptId } : {}),
        ...(opts.prompt ? { prompt: opts.prompt } : {}),
        ...(opts.referenceImage ? { referenceImage: opts.referenceImage } : {}),
        ...(opts.size ? { size: opts.size } : {}),
        ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      })
      log("[live] ai.image → generated")
      return {
        url: String(data.url ?? ""),
        base64: data.b64 ? String(data.b64) : undefined,
      }
    },
  }
}
