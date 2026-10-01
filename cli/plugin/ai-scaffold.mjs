import fs from "node:fs"
import path from "node:path"
import { callProvider, parseAssistantReply, resolveAssistant } from "./dev/assistant.mjs"
import { touchProject } from "../workspace.mjs"

/**
 * "Describe your plugin" — AI-first scaffolding.
 *
 * The model generates a complete plugin (manifest + entry + UI) instead of the
 * static templates. Output is validated before a single file is written, with
 * one automatic retry that feeds the validation error back to the model.
 */

const SCAFFOLD_SYSTEM = `You are the Selldoes plugin scaffolder. The developer describes a plugin in plain language; you generate a complete, working first version.

Generate these files:
- plugin.json — slug (kebab-case), name, one-line description, version "0.1.0", author "Your name", icon (a lucide name like "puzzle"), category, permissions (MINIMAL — only what the code actually uses), allowedTables [], entry "./index.js", dashboardPages + ui only when a dashboard UI makes sense
- index.js — sandbox-safe CommonJS. NO require(), process, Buffer, fs or fetch. Available capabilities (gated by permissions): ctx.db (db:read/db:write/db:schema via ensureTable plugin_<slug>_ tables), ctx.http.get/post (api:external), ctx.ai.complete/image (ai:use), ctx.email.send (email:send), ctx.files.upload/importFromUrl (files:read/files:write), ctx.products (products:read/products:write), ctx.realtime (realtime:publish), ctx.storeId, ctx.config.
  Jobs are chunked: exports.jobs = { "<type>": { init(input, ctx), step(state, ctx), finalize(state, ctx) } } — step returns { state, progress, done, result }.
  API routes: exports.apiRoutes = { "<path>": { GET(ctx, request), POST(ctx, request) } }.
  Hooks: exports.hooks = { "<name>": async (payload, ctx) => result }.
- ui/index.html (+ ui/app.js) only when the plugin needs dashboard UI. The UI calls /api/plugin-api/<slug>/<route> with storeId/storeSlug query params.

Respond with exactly ONE fenced block and nothing else after it:

\`\`\`selldoes-edits
{
  "summary": "one line",
  "files": [{ "path": "plugin.json", "content": "…FULL file content…" }, …]
}
\`\`\`

Rules: always COMPLETE file contents (never diffs or snippets); keep it small and idiomatic; declare every permission the code needs; sandbox-safe code only.`

const UNSAFE_SEGMENT = (segment) => segment === ".." || segment === "." || segment.startsWith(".")

/** Structural check of a scaffold proposal. Returns { ok } or { ok: false, error }. */
function validateScaffold(edits) {
  if (!edits || !Array.isArray(edits.files) || edits.files.length === 0) {
    return { ok: false, error: "the model returned no files" }
  }
  const manifestEntry =
    edits.files.find((file) => file.path === "plugin.json") ??
    (edits.manifest ? { path: "plugin.json", content: JSON.stringify(edits.manifest, null, 2) } : null)
  if (!manifestEntry) return { ok: false, error: "plugin.json is missing from the generated files" }
  let manifest
  try {
    manifest = JSON.parse(manifestEntry.content)
  } catch (error) {
    return { ok: false, error: `plugin.json is not valid JSON: ${error.message}` }
  }
  if (!manifest.slug || !/^[a-z0-9-]+$/.test(String(manifest.slug))) {
    return { ok: false, error: "plugin.json needs a valid slug (lowercase a-z, 0-9 and -)" }
  }
  if (!manifest.entry) return { ok: false, error: "plugin.json needs an \"entry\" field" }
  const entryPath = String(manifest.entry).replace(/^\.\//, "")
  if (!edits.files.some((file) => file.path === entryPath)) {
    return { ok: false, error: `the entry file "${entryPath}" is missing from the generated files` }
  }
  return { ok: true, manifest }
}

async function generate(resolved, conversation, log) {
  const { raw } = await callProvider(resolved, { system: SCAFFOLD_SYSTEM, messages: conversation, log })
  const parsed = parseAssistantReply(raw)
  return parsed
}

/**
 * Scaffolds a plugin from a natural-language description.
 * `dir` is created (must be empty or absent). Returns { dir, slug, files }.
 */
export async function scaffoldWithAi({ prompt, dir, config = {}, log = console.log }) {
  const description = String(prompt ?? "").trim()
  if (!description) throw new Error("Describe the plugin you want (empty prompt)")
  const target = path.resolve(String(dir ?? ""))
  if (!target || target === path.resolve(".")) throw new Error("A target folder is required")
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`${target} is not empty`)
  }

  const resolved = resolveAssistant({ config })
  if (!resolved.configured) {
    throw new Error(
      'No AI provider for scaffolding. Set OPENROUTER_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY / DEEPINFRA_API_KEY, use Ollama (assistant.provider: "ollama", no key), or assistant.apiKey in selldoes.config.json.',
    )
  }

  const userMessage = `Plugin request: ${description}\nProject folder: ${path.basename(target)}`
  const conversation = [{ role: "user", content: userMessage }]
  log(`[scaffold] ${resolved.provider} · ${resolved.model}`)
  const first = await generate(resolved, conversation, log)

  let edits = first.edits
  let check = validateScaffold(edits)
  if (!check.ok) {
    log(`[scaffold] rejected (${check.error}) — retrying with feedback…`)
    conversation.push(
      { role: "assistant", content: first.text || "(no prose reply)" },
      { role: "user", content: `Your plugin was rejected: ${check.error}. Return a corrected, complete plugin in one selldoes-edits block.` },
    )
    const retry = await generate(resolved, conversation, log)
    edits = retry.edits
    check = validateScaffold(edits)
    if (!check.ok) throw new Error(`AI scaffold failed validation twice: ${check.error}`)
  }

  // Write files (path-traversal safe).
  const written = []
  for (const file of edits.files) {
    const relative = String(file.path ?? "").replace(/\\/g, "/").replace(/^\.?\//, "")
    const segments = relative.split("/").filter(Boolean)
    if (!relative || segments.some(UNSAFE_SEGMENT) || path.posix.isAbsolute(relative)) continue
    const destination = path.join(target, ...segments)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, String(file.content ?? ""))
    written.push(relative)
  }
  if (edits.manifest && !written.includes("plugin.json")) {
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, "plugin.json"), `${JSON.stringify(edits.manifest, null, 2)}\n`)
    written.push("plugin.json")
  }
  if (!written.includes("plugin.json")) throw new Error("Scaffold produced no plugin.json — nothing written")

  const manifest = JSON.parse(fs.readFileSync(path.join(target, "plugin.json"), "utf8"))
  touchProject({ dir: target, kind: "plugin", source: "create", name: manifest.name, slug: manifest.slug })
  return { dir: target, slug: manifest.slug, name: manifest.name ?? manifest.slug, files: written, summary: edits.summary }
}
