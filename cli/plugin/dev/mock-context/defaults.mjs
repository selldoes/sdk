/** Dev-preview prompt library for `ctx.ai.listPrompts` (override: `ai.mockPrompts`). */
export const DEFAULT_MOCK_PROMPTS = [
  {
    id: 1,
    name: "Product description",
    description: "System default — SEO copy",
    type: "text",
    field: "description",
    template: "Write a compelling product description for:\n{product}",
    isDefault: true,
  },
  {
    id: 2,
    name: "Bullet points",
    description: "System default — 3-5 bullet points",
    type: "text",
    field: "bulletpoints",
    template: "Generate 3-5 bullet points for:\n{product}",
  },
  {
    id: 15,
    name: "Vintage radio cover",
    description: "Album-cover style main image",
    type: "image",
    field: "mainImage",
    template: "Redraw the reference image as a vintage radio album cover",
    aspectRatio: "1:1",
  },
]

/**
 * Dev-preview model catalog for `ctx.ai.listModels` (override: `ai.mockModels`).
 * Mirrors the shape the platform's `ai_models` catalog exposes.
 */
export const DEFAULT_MOCK_MODELS = [
  {
    provider: "apiraven",
    modelId: "anthropic/claude-4.5-sonnet",
    name: "Claude 4.5 Sonnet",
    type: "text",
    vendor: "Anthropic",
    contextLength: 200000,
    maxCompletionTokens: 8192,
    inputCostPer1M: "3.000000",
    outputCostPer1M: "15.000000",
    description: null,
    supportedParameters: ["tools", "vision"],
    supportsReferenceImage: false,
  },
  {
    provider: "apiraven",
    modelId: "amazon/nova-micro",
    name: "Nova Micro",
    type: "text",
    vendor: "Amazon",
    contextLength: 128000,
    maxCompletionTokens: 8192,
    inputCostPer1M: "0.035000",
    outputCostPer1M: "0.140000",
    description: null,
    supportedParameters: [],
    supportsReferenceImage: false,
  },
  {
    provider: "apiraven",
    modelId: "black-forest-labs/flux-3-image",
    name: "FLUX 3",
    type: "image",
    vendor: "Black Forest Labs",
    contextLength: null,
    maxCompletionTokens: null,
    inputCostPer1M: null,
    outputCostPer1M: null,
    description: "$0.0288 per image",
    supportedParameters: [],
    supportsReferenceImage: true,
  },
]
