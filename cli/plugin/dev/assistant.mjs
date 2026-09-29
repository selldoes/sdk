import fs from "node:fs"
import path from "node:path"

/**
 * The AI rightbar brain: talks to the developer's own provider (OpenRouter,
 * OpenAI or DeepInfra) with the plugin's files as context, and translates the
 * reply into file/manifest edit proposals that the developer approves before
 * anything is written.
 */

const PROVIDERS = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-sonnet-4",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
  },
  deepinfra: {
    baseUrl: "https://api.deepinfra.com/v1/openai",
    envKey: "DEEPINFRA_API_KEY",
    defaultModel: "deepseek-ai/DeepSeek-V4-Flash",
  },
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".github", ".selldoes-dev", "coverage"])
const TEXT_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".css",
  ".html",
  ".md",
  ".txt",
  ".svg",
])
const EDITABLE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".css", ".html", ".json", ".md", ".txt"])
const MAX_FILE_BYTES = 400_000
const MAX_CONTEXT_CHARS = 70_000

/** Resolves provider/model/key from selldoes.config.json + the environment. */
export function resolveAssistant({ config = {}, env = process.env } = {}) {
  const explicit = config.assistant ?? {}
  const provider =
    explicit.provider ||
    (env.OPENROUTER_API_KEY ? "openrouter" : env.OPENAI_API_KEY ? "openai" : env.DEEPINFRA_API_KEY ? "deepinfra" : "openrouter")
  const spec = PROVIDERS[provider] ?? PROVIDERS.openrouter
  const apiKey = String(explicit.apiKey ?? env[spec.envKey] ?? "")
  return {
    configured: Boolean(apiKey),
    provider,
    model: String(explicit.model ?? spec.defaultModel),
    maxTokens: Math.max(256, Math.min(Number(explicit.maxTokens) || 4000, 16000)),
    baseUrl: spec.baseUrl,
    apiKey,
  }
}

export function assistantSummary(resolved) {
  return { configured: resolved.configured, provider: resolved.provider, model: resolved.model }
}

function walkFiles(pluginDir, root = pluginDir, depth = 0) {
  if (depth > 4) return []
  const out = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...walkFiles(pluginDir, path.join(root, entry.name), depth + 1))
      continue
    }
    const full = path.join(root, entry.name)
    const relative = path.relative(pluginDir, full).replace(/\\/g, "/")
    if (relative === "plugin.json") continue
    const extension = path.extname(entry.name).toLowerCase()
    if (!TEXT_EXTENSIONS.has(extension)) continue
    let size = 0
    try {
      size = fs.statSync(full).size
    } catch {
      continue
    }
    out.push({ path: relative, size, full })
  }
  return out
}

/** Builds the model context: manifest, validation, file tree and key files. */
function collectContext({ pluginDir, manifest, validation, activity }) {
  const files = walkFiles(pluginDir).sort((a, b) => a.path.localeCompare(b.path))
  const tree = files.map((file) => `${file.path} (${file.size}b)`).join("\n")

  const wanted = new Set(["plugin.json"])
  const entry = String(manifest.entry ?? "./index.js").replace(/^\.\//, "")
  wanted.add(entry)
  if (manifest.ui?.entry) wanted.add(String(manifest.ui.entry).replace(/^\.\//, ""))
  for (const file of files) {
    if (file.path.startsWith("ui/")) wanted.add(file.path)
  }

  let budget = MAX_CONTEXT_CHARS
  const snippets = []
  const addSnippet = (relative, content) => {
    if (content.length > budget) return
    budget -= content.length
    snippets.push({ path: relative, content })
  }

  addSnippet("plugin.json", JSON.stringify(manifest, null, 2))
  for (const relative of wanted) {
    if (relative === "plugin.json") continue
    const file = files.find((entryFile) => entryFile.path === relative)
    if (!file) continue
    try {
      const content = fs.readFileSync(file.full, "utf8")
      addSnippet(relative, content)
    } catch {
      // skip unreadable
    }
  }
  for (const file of files) {
    if (budget <= 0) break
    if (snippets.some((snippet) => snippet.path === file.path)) continue
    if (file.size > 12_000) continue
    try {
      addSnippet(file.path, fs.readFileSync(file.full, "utf8"))
    } catch {
      // skip
    }
  }

  return {
    tree,
    snippets,
    activity: {
      visits: activity?.visits ?? {},
      jobs: activity?.jobs ?? {},
      routes: activity?.routes ?? {},
    },
    validation,
  }
}

const SDK_REFERENCE = `Runtime is sandboxed (QuickJS in production; Node locally with the same permission checks).
Only these capabilities exist, gated by manifest permissions:
- ctx.db.select/count/insert/insertMany/update/delete/ensureTable (db:read/db:write/db:schema)
- ctx.http.get/post (api:external) — 10s timeout, public URLs only
- ctx.ai.complete({prompt}) / ctx.ai.image() (ai:use)
- ctx.email.send({to,subject,html,text}) (email:send)
- ctx.files.upload/importFromUrl/list/delete (files:read/files:write)
- ctx.products.list/get/create/update/findBySku/upsertBySku (products:read/products:write)
- ctx.realtime.publish/poll (realtime:publish)
- ctx.storeId, ctx.config (declared configSchema values), ctx.permissions, ctx.tablePrefix
No require(), no process/Buffer/fs/fetch. Tables: own tables are plugin_<slug>_* via ensureTable; store tables must be in allowedTables.
API routes: exports.apiRoutes = { "<path>": { GET(ctx, request) {...}, POST(ctx, request) {...} } } — declared in manifest apiRoutes.
Jobs are chunked: exports.jobs = { "<type>": { init(input, ctx), step(state, ctx), finalize(state, ctx) } } — step returns { state, progress, done, result }; use ctx.jobs.progress/item/log.
Hooks: exports.hooks = { "<name>": async (payload, ctx) => result }.
Dashboard UI: manifest ui.entry points at an HTML file; plain JS or a bundled ui/src/index.tsx; it calls /api/plugin-api/<slug>/<route> with storeId/storeSlug query params.
Default export with init/destroy is optional.`

function systemPrompt({ manifest, context }) {
  const snippets = context.snippets.map((snippet) => `--- ${snippet.path} ---\n${snippet.content}`).join("\n\n")
  return `You are the Selldoes plugin assistant inside \`selldoes dev\`, helping one developer build their plugin locally.
You can read the plugin files below and propose edits. Be concise: explain briefly, then propose.

Plugin: ${manifest.slug} v${manifest.version} — ${manifest.name}
Validation: ${context.validation.errors.length} error(s), ${context.validation.warnings.length} warning(s)
${context.validation.errors.map((error) => `- error: ${error}`).join("\n")}

File tree:
${context.tree}

SDK reference:
${SDK_REFERENCE}

When you want to change files, end your reply with exactly ONE fenced block:

\`\`\`selldoes-edits
{
  "summary": "one line describing the change",
  "files": [{ "path": "index.js", "content": "…the FULL new file content…" }],
  "manifest": { "…": "optional FULL updated plugin.json when metadata or declarations change" }
}
\`\`\`

Rules for edits:
- Paths are relative to the plugin root; never use "..", node_modules or dist.
- Always return the complete new file content (not a patch).
- Only include files you actually change. Include "manifest" only when plugin.json changes.
- Keep the code sandbox-safe (see SDK reference) and declare any new permission it needs.
- If the developer just asks a question, reply in prose without an edit block.

Files:
${snippets}`
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Validates and normalizes the model's edit proposal. */
export function normalizeEdits(payload) {
  if (!payload || typeof payload !== "object") return null
  const files = []
  for (const entry of Array.isArray(payload.files) ? payload.files : []) {
    const relative = String(entry?.path ?? "").replace(/\\/g, "/").replace(/^\.\//, "")
    if (!relative || relative.includes("..") || relative.split("/").some((part) => part === "node_modules" || part.startsWith("."))) continue
    const extension = path.extname(relative).toLowerCase()
    if (!EDITABLE_EXTENSIONS.has(extension)) continue
    const content = typeof entry?.content === "string" ? entry.content : null
    if (content === null || content.length > MAX_FILE_BYTES) continue
    files.push({ path: relative, content })
  }
  const manifest = payload.manifest && typeof payload.manifest === "object" && !Array.isArray(payload.manifest) ? payload.manifest : undefined
  if (files.length === 0 && !manifest) return null
  return {
    summary: typeof payload.summary === "string" ? payload.summary.slice(0, 300) : undefined,
    files,
    manifest,
  }
}

/** Splits a model reply into prose + an edit proposal. */
export function parseAssistantReply(text) {
  const raw = String(text ?? "")
  const match = /```selldoes-edits\s*([\s\S]*?)```/.exec(raw)
  const payload = match ? safeJson(match[1].trim()) : null
  const fallback = !payload && raw.trim().startsWith("{") && raw.includes('"files"') ? safeJson(raw.trim()) : null
  const edits = normalizeEdits(payload ?? fallback)
  const prose = match ? raw.replace(match[0], "").trim() : fallback ? "" : raw.trim()
  return { text: prose, edits }
}

/**
 * Sends the conversation to the provider and returns `{ text, edits }`.
 * Throws Error with a `code: "not-configured"` when no key is available.
 */
export async function assistantChat({ pluginDir, manifest, validation, activity, messages, config, log = () => {} }) {
  const resolved = resolveAssistant({ config })
  if (!resolved.configured) {
    const error = new Error(
      "No AI provider key found. Add OPENROUTER_API_KEY / OPENAI_API_KEY / DEEPINFRA_API_KEY, or set assistant.apiKey in selldoes.config.json.",
    )
    error.code = "not-configured"
    throw error
  }

  const context = collectContext({ pluginDir, manifest, validation, activity })
  const history = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
    .slice(-12)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 20_000) }))

  log(`[assistant] ${resolved.provider} · ${resolved.model} · ${history.length} message(s)`)

  const response = await fetch(`${resolved.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolved.apiKey}`,
      "HTTP-Referer": "https://selldoes.com",
      "X-Title": "Selldoes plugin preview",
    },
    body: JSON.stringify({
      model: resolved.model,
      messages: [{ role: "system", content: systemPrompt({ manifest, context }) }, ...history],
      temperature: 0.2,
      max_tokens: resolved.maxTokens,
    }),
    signal: AbortSignal.timeout(120_000),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = data?.error?.message ?? data?.error ?? `HTTP ${response.status}`
    throw new Error(`AI provider error: ${detail}`)
  }
  const raw = data?.choices?.[0]?.message?.content ?? ""
  const parsed = parseAssistantReply(raw)
  return { text: parsed.text, edits: parsed.edits, provider: resolved.provider, model: resolved.model, usage: data?.usage ?? null }
}
