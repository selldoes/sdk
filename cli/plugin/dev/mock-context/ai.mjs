import { DEFAULT_MOCK_MODELS, DEFAULT_MOCK_PROMPTS } from "./defaults.mjs"

/**
 * Builds the mock `ctx.ai` capability. Unless a live store bridge is connected
 * (`live.ai`, `live.prompts`, `live.models`), replies come from
 * `selldoes.config.json` `ai.*` overrides or the dev-preview defaults.
 */
export function createAi({ config, live, requirePermission, log }) {
  return {
    async complete(opts = {}) {
      requirePermission("ai:use", "ctx.ai.complete")
      const prompt = String(opts.prompt ?? "")
      log(`[ai] complete(${prompt.length} chars)${opts.model ? ` model=${opts.model}` : ""}`)
      // Live store: the store's own AI provider — the preview writes REAL copy.
      if (live.ai) {
        const result = await live.ai.complete(opts)
        return { text: result.text ?? "", tokensUsed: result.tokensUsed ?? 0 }
      }
      let text = config.ai?.mockReply ?? "(mock AI reply — set `ai.mockReply` in selldoes.config.json)"
      for (const [needle, reply] of Object.entries(config.ai?.responses ?? {})) {
        if (prompt.toLowerCase().includes(String(needle).toLowerCase())) {
          text = String(reply)
          break
        }
      }
      return { text, tokensUsed: 0 }
    },
    async image(opts = {}) {
      requirePermission("ai:use", "ctx.ai.image")
      log("[ai] image()")
      // Live store: the store's own image model.
      if (live.ai) return live.ai.image(opts)
      return { url: config.ai?.mockImage ?? "" }
    },
    async listPrompts(opts = {}) {
      requirePermission("ai:use", "ctx.ai.listPrompts")
      // Live store: the platform's saved prompt library (Dashboard → AI Prompts).
      if (live.prompts) {
        const prompts = await live.prompts.list(opts)
        log(`[live] ai.listPrompts → ${prompts.length} prompt(s)`)
        return prompts
      }
      log(`[ai] listPrompts(${opts.type ?? "all"}) (mock)`)
      // Dev mock library — override with `ai.mockPrompts` in selldoes.config.json.
      const prompts = (Array.isArray(config.ai?.mockPrompts) ? config.ai.mockPrompts : DEFAULT_MOCK_PROMPTS).map((prompt) => ({
        id: prompt.id,
        name: prompt.name,
        description: prompt.description ?? null,
        type: prompt.type ?? "text",
        field: prompt.field ?? "custom",
        template: prompt.template ?? "",
        provider: prompt.provider ?? "mock",
        model: prompt.model ?? "mock",
        isDefault: prompt.isDefault === true,
        aspectRatio: prompt.aspectRatio ?? null,
      }))
      return opts.type ? prompts.filter((prompt) => prompt.type === String(opts.type)) : prompts
    },
    async getPrompt(id) {
      requirePermission("ai:use", "ctx.ai.getPrompt")
      if (live.prompts) return live.prompts.get(id)
      const prompts = await this.listPrompts()
      return prompts.find((prompt) => prompt.id === Number(id)) ?? null
    },
    async listModels(opts = {}) {
      requirePermission("ai:use", "ctx.ai.listModels")
      // Live store: the store's enabled AI models (with pricing).
      if (live.models) {
        const models = await live.models.list(opts)
        log(`[live] ai.listModels → ${models.length} model(s)`)
        return models
      }
      log(`[ai] listModels(${opts.type ?? "all"}) (mock)`)
      // Dev mock catalog — override with `ai.mockModels` in selldoes.config.json.
      const models = Array.isArray(config.ai?.mockModels) ? config.ai.mockModels : DEFAULT_MOCK_MODELS
      return opts.type ? models.filter((model) => model.type === String(opts.type)) : models
    },
  }
}
