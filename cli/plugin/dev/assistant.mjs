import fs from "node:fs"
import path from "node:path"
import {
  EDITABLE_EXTENSIONS,
  MAX_FILE_BYTES,
  listProjectFiles,
} from "./project-files.mjs"

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
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-5",
    api: "anthropic",
  },
  gemini: {
    // Google's OpenAI-compatible endpoint — same wire format as openai.
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
  },
  ollama: {
    // Local models — no key required (OLLAMA_HOST to point elsewhere).
    baseUrl: (env) => (env.OLLAMA_HOST ? `${String(env.OLLAMA_HOST).replace(/\/$/, "")}/v1` : "http://localhost:11434/v1"),
    envKey: "OLLAMA_API_KEY",
    defaultModel: "qwen3:8b",
    keyless: true,
  },
}

const MAX_CONTEXT_CHARS = 70_000

/** Resolves provider/model/key from selldoes.config.json + the environment. */
export function resolveAssistant({ config = {}, env = process.env } = {}) {
  const explicit = config.assistant ?? {}
  const provider =
    explicit.provider ||
    (env.OPENROUTER_API_KEY
      ? "openrouter"
      : env.ANTHROPIC_API_KEY
        ? "anthropic"
        : env.GEMINI_API_KEY
          ? "gemini"
          : env.OPENAI_API_KEY
            ? "openai"
            : env.DEEPINFRA_API_KEY
              ? "deepinfra"
              : "openrouter")
  const spec = PROVIDERS[provider] ?? PROVIDERS.openrouter
  const apiKey = String(explicit.apiKey ?? env[spec.envKey] ?? "")
  const baseUrl = explicit.baseUrl
    ? String(explicit.baseUrl).replace(/\/$/, "")
    : typeof spec.baseUrl === "function"
      ? spec.baseUrl(env)
      : spec.baseUrl
  return {
    // keyless providers (ollama) are "configured" the moment they're selected
    configured: spec.keyless ? true : Boolean(apiKey),
    provider,
    model: String(explicit.model ?? spec.defaultModel),
    maxTokens: Math.max(256, Math.min(Number(explicit.maxTokens) || 4000, 16000)),
    baseUrl,
    apiKey,
    api: spec.api ?? "openai",
  }
}

export function assistantSummary(resolved) {
  return { configured: resolved.configured, provider: resolved.provider, model: resolved.model }
}

/** Builds the model context: manifest, validation, file tree and key files. */
function collectContext({ pluginDir, manifest, validation, activity }) {
  const files = listProjectFiles(pluginDir, { depth: 4 })
    .filter((file) => (!file.path.startsWith(".") || file.path === ".env.example") && file.path !== "plugin.json")
    .map((file) => ({ ...file, full: path.join(pluginDir, ...file.path.split("/")) }))
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
- ctx.http.get/post (api:external) — 60s default timeout (opts.timeoutMs, capped at 60s), public URLs only
- ctx.ai.complete({prompt}) / ctx.ai.image() (ai:use)
- ctx.email.send({to,subject,html,text}) (email:send)
- ctx.files.upload/importFromUrl/list/delete (files:read/files:write)
- ctx.products.list/get/create/update/findBySku/upsertBySku (products:read/products:write)
- ctx.realtime.publish/poll (realtime:publish)
- ctx.secrets.get(name) (secrets:read) — per-install secrets, never bundled or logged
- ctx.storage.get/set/delete/list (storage:read/storage:write) — plugin+store-scoped JSON
- ctx.storeId, ctx.config (declared configSchema values), ctx.permissions, ctx.tablePrefix
No require() of Node builtins, no process/Buffer/fs/fetch at runtime; npm packages are allowed — the bundler inlines anything listed in manifest "dependencies" (registry ranges, max 25). Tables: own tables are plugin_<slug>_* via ensureTable; store tables must be in allowedTables.
API routes: exports.apiRoutes = { "<path>": { GET(ctx, request) {...}, POST(ctx, request) {...} } } — declared in manifest apiRoutes.
Jobs are chunked: exports.jobs = { "<type>": { init(input, ctx), step(state, ctx), finalize(state, ctx) } } — step returns { state, progress, done, result }; use ctx.jobs.progress/item/log.
Node jobs: manifest job { "runtime": "node", "entry": "./server/<name>.js" } runs once in full Node (any npm package, fs, native addons); the entry exports a plain async (input, ctx) => result. Keep Node-only imports out of index.js.
Schedules: manifest "schedules": [{ name, job, cron, timezone?, input?, enabled? }] enqueues a declared job on a five-field cron (max 10).
Hooks: exports.hooks = { "<name>": async (payload, ctx) => result }.
Dashboard UI: manifest ui.entry points at an HTML file under ui/ (plugin-root-relative, e.g. "ui/index.html"); plain JS or a bundled ui/src/index.tsx; it calls /api/plugin-api/<slug>/<route> with storeId/storeSlug query params. Multiple pages: each dashboardPages[] item may declare its own entry ("ui/settings.html" ← ui/src/settings.tsx); pages without an entry fall back to ui.entry. Every plugin should ship a working example UI (the notes app) — never declare ui.entry without the file.
Dashboard page components (no-code): dashboardPages[].sections renders in the dashboard WITHOUT an iframe. Each item is { "type": "...", "settings": {...} }. Kit types: text {title, body (markdown: **bold**, \`code\`, - lists)}, stats {items:[{label,value,hint}]}, table {route, columns?, title?, maxRows?} (route is your apiRoutes path; handler returns an array or {rows:[…]}/{items:[…]}), job {job (declared job type), title?, input?, maxTicks?}, settings (renders the configSchema form), logs {lines?}, links {items:[{label,href}]}. Edit sections through manifest edits — keep the page's "entry" as a fallback. Developers often ask to "add a stats row", "show /stats as a table", or "add a job runner button".
Default export with init/destroy is optional.`

function systemPrompt({ manifest, context, editor }) {
  const snippets = context.snippets.map((snippet) => `--- ${snippet.path} ---\n${snippet.content}`).join("\n\n")
  const selection = editor?.selection?.text ? String(editor.selection.text).slice(0, 6000) : ""
  const editorSection =
    editor?.file || selection
      ? `\nEditor focus (the developer is looking at this right now):
${editor?.file ? `- open file: ${String(editor.file)}\n` : ""}${selection ? `- selected code:\n\`\`\`${editor?.language ?? ""}\n${selection}\n\`\`\`\n` : ""}
When the request is about "this" or the selection, it means the code above.`
      : ""
  return `You are the Selldoes plugin assistant inside \`selldoes dev\`, helping one developer build their plugin locally.
You can read the plugin files below and propose edits. Be concise: explain briefly, then propose.

Plugin: ${manifest.slug} v${manifest.version} — ${manifest.name}
Validation: ${context.validation.errors.length} error(s), ${context.validation.warnings.length} warning(s)
${context.validation.errors.map((error) => `- error: ${error}`).join("\n")}
${editorSection}
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
 * Sends messages to the resolved provider. Handles both wire formats:
 * Anthropic's Messages API (`api: "anthropic"`) and the OpenAI-compatible
 * chat-completions shape everything else uses (OpenRouter, OpenAI, DeepInfra,
 * Gemini's compat endpoint, Ollama). Returns `{ raw, usage }`.
 */
export async function callProvider(resolved, { system, messages, log = () => {} }) {
  const history = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
    .slice(-12)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 20_000) }))

  log(`[assistant] ${resolved.provider} · ${resolved.model} · ${history.length} message(s)`)

  if (resolved.api === "anthropic") {
    const response = await fetch(`${resolved.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": resolved.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: resolved.model,
        max_tokens: resolved.maxTokens,
        system,
        messages: history,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = data?.error?.message ?? data?.error ?? `HTTP ${response.status}`
      throw new Error(`AI provider error: ${detail}`)
    }
    const raw = (Array.isArray(data?.content) ? data.content : []).map((block) => block?.text ?? "").join("")
    return { raw, usage: data?.usage ?? null }
  }

  const headers = { "Content-Type": "application/json" }
  if (resolved.apiKey) headers.Authorization = `Bearer ${resolved.apiKey}`
  const response = await fetch(`${resolved.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      ...headers,
      "HTTP-Referer": "https://selldoes.com",
      "X-Title": "Selldoes plugin preview",
    },
    body: JSON.stringify({
      model: resolved.model,
      messages: [{ role: "system", content: system }, ...history],
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
  return { raw, usage: data?.usage ?? null }
}

/**
 * Attaches the CURRENT file content (`before`) + `exists` flag to every edit
 * so clients can render real diffs. CLI consumers (selldoes ask) get the same
 * data for their diff display.
 */
export function attachDiffs(pluginDir, edits) {
  if (!edits) return edits
  const root = path.resolve(pluginDir)
  for (const file of edits.files) {
    try {
      const full = path.resolve(root, file.path)
      if (!full.startsWith(root)) continue
      const exists = fs.existsSync(full)
      file.exists = exists
      file.before = exists ? fs.readFileSync(full, "utf8") : ""
    } catch {
      file.before = ""
    }
  }
  return edits
}

/**
 * Sends the conversation to the provider and returns `{ text, edits }`
 * (edits enriched with `before`/`exists` for diffing).
 * Throws Error with a `code: "not-configured"` when no key is available.
 */
export async function assistantChat({ pluginDir, manifest, validation, activity, messages, config, context, log = () => {} }) {
  const resolved = resolveAssistant({ config })
  if (!resolved.configured) {
    const error = new Error(
      "No AI provider key found. Add OPENROUTER_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY / DEEPINFRA_API_KEY, use Ollama (provider: \"ollama\", no key needed), or set assistant.apiKey in selldoes.config.json.",
    )
    error.code = "not-configured"
    throw error
  }

  const filesContext = collectContext({ pluginDir, manifest, validation, activity })
  const { raw, usage } = await callProvider(resolved, {
    system: systemPrompt({ manifest, context: filesContext, editor: context }),
    messages,
    log,
  })
  const parsed = parseAssistantReply(raw)
  attachDiffs(pluginDir, parsed.edits)
  return { text: parsed.text, edits: parsed.edits, provider: resolved.provider, model: resolved.model, usage }
}
