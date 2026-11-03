import fs from "node:fs"
import { isLoopbackHostname, json, readBody } from "../../../http.mjs"
import { applyUserSettingsPatch, userSettingsView } from "../../../user-settings.mjs"
import { BUMP_MODES } from "../../version.mjs"
import { resolveAssistant } from "../assistant.mjs"
import { storeView } from "../live-store.mjs"

/** Mirrors the platform's secret mask for `type: "secret"` config fields. */
function maskKey(value) {
  const key = String(value ?? "")
  if (!key) return null
  if (key.length <= 8) return "•••"
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

/**
 * Project settings (`selldoes.config.json`) and user settings
 * (`~/.selldoes/settings.json`) for the preview's Settings pages.
 *
 * Returns a `handle(req, res, url)` that resolves `true` once it has answered a
 * `/__dev/config` or `/__dev/user-settings` request, `false` otherwise.
 */
export function createConfigRoutes({ readConfig, configPath, log, liveStore }) {
  const configPayload = () => {
    const fileConfig = readConfig()
    // Effective assistant config: user settings (~/.selldoes/settings.json)
    // merged with the project's optional `assistant.model` override.
    const resolved = resolveAssistant({ config: fileConfig })
    let userSettings = null
    try {
      userSettings = userSettingsView()
    } catch {
      // user-settings module unavailable
    }
    return {
      assistant: {
        provider: resolved.provider,
        model: resolved.model,
        baseUrl: resolved.baseUrl,
        apiKey: maskKey(resolved.apiKey),
        apiKeySet: Boolean(resolved.apiKey),
        projectModel: fileConfig.assistant?.model ?? null,
      },
      env: {
        OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
        ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
        GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
        OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
        DEEPINFRA_API_KEY: Boolean(process.env.DEEPINFRA_API_KEY),
        OLLAMA_HOST: process.env.OLLAMA_HOST ?? null,
      },
      server: {
        storeId: Number(fileConfig.storeId ?? 1),
        storeSlug: String(fileConfig.storeSlug ?? "dev-store"),
        storeName: String(fileConfig.storeName ?? "Dev Store"),
        port: Number(fileConfig.port ?? 4590),
        host: String(fileConfig.host ?? "127.0.0.1"),
        ai: { mockReply: fileConfig.ai?.mockReply ?? null },
        email: { disabled: Boolean(fileConfig.email?.disabled) },
        sampleJobs: fileConfig.sampleJobs ?? null,
      },
      store: {
        ...storeView(fileConfig),
        active: Boolean(liveStore.bridge),
      },
      publish: {
        // Per-project override wins; otherwise the user-level default
        // (~/.selldoes/settings.json) — never a bare "patch" surprise.
        bump: BUMP_MODES.includes(String(fileConfig.publish?.bump))
          ? String(fileConfig.publish.bump)
          : (userSettings?.publish?.bump ?? "patch"),
      },
    }
  }

  const handleConfig = async (req, res) => {
    if (req.method === "GET") {
      json(res, 200, configPayload())
      return true
    }
    // Sections map to selldoes.config.json keys: `server`
    // (storeId/storeSlug/storeName/port/host), `ai` (mockReply),
    // `email` (disabled), `sampleJobs` and `publish` — plus the
    // assistant. `assistant` writes to the user settings
    // (~/.selldoes/settings.json) unless `scope: "project"` pins a
    // per-project `model` override. Assistant settings apply
    // immediately (resolved per request); everything else is baked in
    // at startup, so the response flags `restartRequired`.
    const body = await readBody(req)
    const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    if (
      !isObject(body?.assistant) &&
      !isObject(body?.server) &&
      !isObject(body?.ai) &&
      !isObject(body?.email) &&
      !isObject(body?.publish) &&
      body?.sampleJobs === undefined
    ) {
      json(res, 400, { error: "Nothing to save — send assistant, server, ai, email, publish or sampleJobs" })
      return true
    }
    const fileConfig = readConfig()
    const next = { ...fileConfig }
    let restartRequired = false

    if (body.assistant !== undefined) {
      if (!isObject(body.assistant)) {
        json(res, 400, { error: "assistant must be an object" })
        return true
      }
      if (body.scope === "project") {
        // Per-project override: only `model` lives in the project folder —
        // credentials and provider selection are user-level, never committed.
        for (const key of Object.keys(body.assistant)) {
          if (key !== "model") {
            json(res, 400, { error: `Project assistant override only supports \`model\` — \`${key}\` lives in User settings` })
            return true
          }
        }
        const merged = { ...(fileConfig.assistant ?? {}) }
        if (body.assistant.model === undefined || body.assistant.model === null || body.assistant.model === "")
          delete merged.model
        else merged.model = String(body.assistant.model).trim()
        if (Object.keys(merged).length > 0) next.assistant = merged
        else delete next.assistant
      } else {
        // The assistant belongs to the developer, not to this project:
        // save to ~/.selldoes/settings.json (applies to every project).
        try {
          applyUserSettingsPatch({ assistant: body.assistant })
        } catch (error) {
          json(res, 400, { error: error.message })
          return true
        }
        log("assistant settings saved to ~/.selldoes/settings.json — applied immediately")
        json(res, 200, { ok: true, restartRequired: false, ...configPayload() })
        return true
      }
    }

    if (body.server !== undefined) {
      if (!isObject(body.server)) {
        json(res, 400, { error: "server must be an object" })
        return true
      }
      const srv = body.server
      if (srv.storeId !== undefined && srv.storeId !== null && srv.storeId !== "") {
        const value = Number(srv.storeId)
        if (!Number.isInteger(value) || value < 1) {
          json(res, 400, { error: "server.storeId must be a positive integer" })
          return true
        }
        if (value !== Number(fileConfig.storeId ?? 1)) restartRequired = true
        next.storeId = value
      }
      if (srv.storeSlug !== undefined && srv.storeSlug !== null) {
        const value = String(srv.storeSlug).trim()
        if (!value) {
          json(res, 400, { error: "server.storeSlug cannot be empty" })
          return true
        }
        if (value !== String(fileConfig.storeSlug ?? "dev-store")) restartRequired = true
        next.storeSlug = value
      }
      if (srv.storeName !== undefined && srv.storeName !== null) {
        const value = String(srv.storeName).trim()
        if (value !== String(fileConfig.storeName ?? "Dev Store")) restartRequired = true
        next.storeName = value
      }
      if (srv.port !== undefined && srv.port !== null && srv.port !== "") {
        const value = Number(srv.port)
        if (!Number.isInteger(value) || value < 1024 || value > 65535) {
          json(res, 400, { error: "server.port must be between 1024 and 65535" })
          return true
        }
        if (value !== Number(fileConfig.port ?? 4590)) restartRequired = true
        next.port = value
      }
      if (srv.host !== undefined && srv.host !== null && srv.host !== "") {
        const value = String(srv.host).trim()
        if (!isLoopbackHostname(value)) {
          json(res, 400, {
            error:
              "server.host must be a loopback address (127.0.0.1, ::1 or localhost) — the dev server is never exposed to the network",
          })
          return true
        }
        if (value !== String(fileConfig.host ?? "127.0.0.1")) restartRequired = true
        next.host = value
      }
    }

    if (body.ai !== undefined) {
      if (!isObject(body.ai)) {
        json(res, 400, { error: "ai must be an object" })
        return true
      }
      const merged = { ...(fileConfig.ai ?? {}) }
      if ("mockReply" in body.ai) {
        const value = body.ai.mockReply === null || body.ai.mockReply === "" ? null : String(body.ai.mockReply)
        if (value !== (fileConfig.ai?.mockReply ?? null)) restartRequired = true
        if (value === null) delete merged.mockReply
        else merged.mockReply = value
      }
      if (Object.keys(merged).length > 0) next.ai = merged
      else delete next.ai
    }

    if (body.email !== undefined) {
      if (!isObject(body.email)) {
        json(res, 400, { error: "email must be an object" })
        return true
      }
      const merged = { ...(fileConfig.email ?? {}) }
      if ("disabled" in body.email) {
        const value = Boolean(body.email.disabled)
        if (value !== Boolean(fileConfig.email?.disabled)) restartRequired = true
        if (value) merged.disabled = true
        else delete merged.disabled
      }
      if (Object.keys(merged).length > 0) next.email = merged
      else delete next.email
    }

    if (body.sampleJobs !== undefined) {
      const value = body.sampleJobs
      if (value !== null && !isObject(value)) {
        json(res, 400, { error: "sampleJobs must be an object or null" })
        return true
      }
      const nextValue = value ?? null
      if (JSON.stringify(nextValue ?? null) !== JSON.stringify(fileConfig.sampleJobs ?? null)) restartRequired = true
      if (nextValue) next.sampleJobs = nextValue
      else delete next.sampleJobs
    }

    if (body.publish !== undefined) {
      if (!isObject(body.publish)) {
        json(res, 400, { error: "publish must be an object" })
        return true
      }
      const merged = { ...(fileConfig.publish ?? {}) }
      if ("bump" in body.publish) {
        const value = String(body.publish.bump ?? "").trim()
        if (!BUMP_MODES.includes(value)) {
          json(res, 400, { error: `publish.bump must be one of ${BUMP_MODES.join(", ")}` })
          return true
        }
        merged.bump = value
      }
      if (Object.keys(merged).length > 0) next.publish = merged
      else delete next.publish
    }

    fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`)
    log(
      restartRequired
        ? "settings saved to selldoes.config.json — restart the preview to apply"
        : "settings saved to selldoes.config.json",
    )
    json(res, 200, { ok: true, restartRequired, ...configPayload() })
    return true
  }

  // ── User (global) settings — ~/.selldoes/settings.json ──────────────────
  // Standalone `selldoes dev` twin of the workspace's /__ws/user-settings:
  // assistant credentials, default project dir, editor preference and the
  // default release bump.
  const handleUserSettings = async (req, res) => {
    if (req.method === "GET") {
      json(res, 200, userSettingsView())
      return true
    }
    const body = await readBody(req)
    try {
      applyUserSettingsPatch(body ?? {})
      json(res, 200, { ok: true, ...userSettingsView() })
    } catch (error) {
      json(res, 400, { error: error.message })
    }
    return true
  }

  return async function handle(req, res, url) {
    const pathname = url.pathname
    if (pathname === "/__dev/config") return await handleConfig(req, res)
    if (pathname === "/__dev/user-settings") return await handleUserSettings(req, res)
    return false
  }
}
