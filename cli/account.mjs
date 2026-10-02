import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as prompts from "@clack/prompts"
import { die, openBrowser } from "./util.mjs"

/**
 * The developer-account lane of the workspace.
 *
 *   selldoes login --token sk_dev_…   connect a developer account (portal → API tokens)
 *   selldoes packages                 list the packages you own
 *   selldoes pull <slug>              download one of your packages and keep developing it
 *   selldoes whoami                   connected identity (developer + theme lanes)
 *   selldoes logout                   remove saved credentials
 *
 * Credentials live in ~/.selldoes.json next to the theme lane's merchant key:
 *   { "developerToken": "sk_dev_…", "appUrl": "https://selldoes.com", "apiKey": "sk_…" }
 *
 * This is what replaces importing from npm/GitHub: your Selldoes developer
 * account is the source of truth for the packages you own. Publish from here
 * (`selldoes publish`), pull them back with `selldoes pull`, keep iterating.
 */

const CONFIG_PATH = path.join(os.homedir(), ".selldoes.json")
const DEFAULT_APP_URL = "https://selldoes.com"

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
  } catch {
    return {}
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf8")
}

/** Resolved developer-token auth (flag/env fallbacks included). */
export function developerAuth(flags = {}, cfg = loadConfig()) {
  const token = String(flags.token ?? process.env.SELLDOES_DEV_TOKEN ?? cfg.developerToken ?? "")
  const appUrl = String(flags["app-url"] ?? process.env.SELLDOES_APP_URL ?? cfg.appUrl ?? DEFAULT_APP_URL).replace(/\/$/, "")
  return { token: token || null, appUrl }
}

export function isDeveloperToken(value) {
  return String(value ?? "").startsWith("sk_dev_")
}

async function devFetch(appUrl, pathname, token, options = {}) {
  const res = await fetch(appUrl + pathname, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    // non-JSON body
  }
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText} (${pathname})`)
  return data
}

function cancel() {
  prompts.cancel("Cancelled")
  process.exit(0)
}

/**
 * Connects a developer account: verify the token against the app, then save
 * it next to the theme lane's merchant key. Shared by `selldoes login` and
 * the dev-ui's `/__ws/connect` route — throws on failure, callers present
 * the error however they like.
 */
export async function connectDeveloper(token, appUrlOverride) {
  const value = String(token ?? "").trim()
  if (!value) throw new Error("Provide a developer token (create one in the developer portal → API tokens).")
  if (!isDeveloperToken(value)) {
    throw new Error("Developer tokens start with sk_dev_. A plain sk_… key is a merchant API key — that's the theme lane (`selldoes login --api-key sk_…`).")
  }

  const cfg = loadConfig()
  const appUrl = String(appUrlOverride ?? cfg.appUrl ?? process.env.SELLDOES_APP_URL ?? DEFAULT_APP_URL).replace(/\/$/, "")
  let account
  try {
    ;({ account } = await devFetch(appUrl, "/api/developers/me", value))
  } catch (error) {
    throw new Error(`Could not verify the token against ${appUrl}: ${error.message}`)
  }
  if (account.status && account.status !== "active") {
    throw new Error(`This developer account is ${account.status} — suspended accounts cannot be used.`)
  }

  cfg.developerToken = value
  cfg.appUrl = appUrl
  saveConfig(cfg)
  return { appUrl, account }
}

/** Clears the developer lane's saved credentials (the dev-ui "Disconnect"). */
export function disconnectDeveloper() {
  const cfg = loadConfig()
  const had = Boolean(cfg.developerToken)
  delete cfg.developerToken
  delete cfg.appUrl
  saveConfig(cfg)
  return had
}

/** `selldoes login` — routes merchant keys to the theme lane, tokens here. */
export async function loginCommand(args, flags) {
  let token = flags.token ?? flags["api-key"] ?? process.env.SELLDOES_DEV_TOKEN ?? null

  // A plain sk_… key belongs to the theme lane — hand it over untouched.
  if (token && !isDeveloperToken(token)) {
    const { themeCommand } = await import("./theme.mjs")
    const themeFlags = { "api-key": String(token) }
    if (flags.base) themeFlags.base = String(flags.base)
    if (flags.store) themeFlags.store = String(flags.store)
    return themeCommand("login", [], themeFlags)
  }

  if (!token && process.stdin.isTTY) {
    const answer = await prompts.password({
      message: "Developer token (sk_dev_… — developer portal → API tokens)",
      mask: "*",
    })
    if (prompts.isCancel(answer)) cancel()
    token = String(answer ?? "").trim()
  }
  if (!token) {
    die("Provide a developer token: selldoes login --token sk_dev_… (create one in the developer portal → API tokens)")
  }

  let connected
  try {
    connected = await connectDeveloper(token, flags["app-url"])
  } catch (error) {
    die(error.message)
  }
  console.log(`✓ Connected as ${connected.account.name} <${connected.account.email}> (${connected.appUrl})`)
  console.log("  Your packages: `selldoes packages` · pull one to keep developing: `selldoes pull <slug>`")
}

export async function logoutCommand() {
  const cfg = loadConfig()
  const had = { developer: Boolean(cfg.developerToken), merchant: Boolean(cfg.apiKey) }
  delete cfg.developerToken
  delete cfg.appUrl
  delete cfg.apiKey
  delete cfg.baseUrl
  delete cfg.defaultStoreSlug
  saveConfig(cfg)
  if (!had.developer && !had.merchant) {
    console.log("Nothing to log out.")
    return
  }
  console.log("✓ Logged out (developer token and merchant key removed).")
}

export async function whoamiCommand(args, flags) {
  const cfg = loadConfig()
  const { token, appUrl } = developerAuth(flags, cfg)
  let shown = false

  if (token) {
    try {
      const { account } = await devFetch(appUrl, "/api/developers/me", token)
      const { plugins } = await devFetch(appUrl, "/api/developers/plugins", token)
      console.log(`Developer: ${account.name} <${account.email}> · ${account.status} · ${appUrl}`)
      console.log(`Packages: ${plugins.length}`)
      for (const plugin of plugins.slice(0, 10)) {
        console.log(`  • ${plugin.slug} v${plugin.latestVersion} (${plugin.status})`)
      }
      if (plugins.length > 10) console.log(`  … and ${plugins.length - 10} more`)
      shown = true
    } catch (error) {
      console.log(`Developer lane: ${error.message}`)
    }
  }

  if (cfg.apiKey) {
    const { themeCommand } = await import("./theme.mjs")
    await themeCommand("whoami", [], { "api-key": cfg.apiKey })
    shown = true
  }

  if (!shown) {
    die("Not logged in. Run `selldoes login --token sk_dev_…` (developer) or `selldoes login --api-key sk_…` (themes).")
  }
}

/** The account's packages — shared by `selldoes packages` and the home launcher. */
export async function listPackages(flags = {}) {
  const { token, appUrl } = developerAuth(flags)
  if (!token) {
    throw new Error("Not connected. Run `selldoes login --token sk_dev_…` first (developer portal → API tokens).")
  }
  const { plugins } = await devFetch(appUrl, "/api/developers/plugins", token)
  return { appUrl, plugins: plugins ?? [] }
}

function cleanSlug(slug) {
  const value = String(slug ?? "").trim()
  if (!/^[a-z0-9-]+$/.test(value)) throw new Error(`"${value}" is not a valid slug`)
  return value
}

/** One package with its releases + marketplace listing state (GET). */
export async function getPackage(slug, flags = {}) {
  const clean = cleanSlug(slug)
  const { token, appUrl } = developerAuth(flags)
  if (!token) throw new Error("Not connected. Run `selldoes login --token sk_dev_…` first.")
  return devFetch(appUrl, `/api/developers/plugins/${clean}`, token)
}

/**
 * Deletes a package's developer workspace copy on the platform
 * (DELETE /api/developers/plugins/<slug>). The workspace package and its
 * stored files go; published marketplace artifacts stay — admins manage the
 * listing and immutable releases from the listings screen. Re-publishing the
 * slug creates a fresh draft.
 */
export async function deletePackage(slug, flags = {}) {
  const clean = cleanSlug(slug)
  const { token, appUrl } = developerAuth(flags)
  if (!token) throw new Error("Not connected. Run `selldoes login --token sk_dev_…` first.")
  const data = await devFetch(appUrl, `/api/developers/plugins/${clean}`, token, { method: "DELETE" })
  return { slug: clean, appUrl, ok: data?.success !== false }
}

/** `selldoes delete <slug>` — deletes the remote workspace copy (asks first). */
export async function deletePackageCommand(args, flags) {
  const slug = args.find((arg) => !arg.startsWith("-"))
  if (!slug) die("Usage: selldoes delete <slug> [--yes]")
  const clean = cleanSlug(slug)
  if (flags.yes !== true) {
    if (!process.stdin.isTTY) die("Refusing to delete without confirmation — re-run with --yes (scripts/CI).")
    const answer = await prompts.confirm({
      message: `Delete "${clean}" from your developer workspace on the platform?`,
      initialValue: false,
    })
    if (prompts.isCancel(answer) || !answer) {
      prompts.cancel("Cancelled")
      return
    }
  }
  const result = await deletePackage(clean)
  console.log(`✓ Deleted ${clean} from ${result.appUrl}`)
  console.log("  Published marketplace artifacts stay — admins manage those from the listings screen.")
  console.log("  Re-publishing the slug creates a fresh draft.")
}

// ── Theme lane (merchant API keys) ──────────────────────────────────────────
// The theme lane's credentials live in the same ~/.selldoes.json as the
// developer token: { apiKey, baseUrl, defaultStoreSlug } — written by
// `selldoes login --api-key` and read by theme dev/apply.

function maskSecret(value) {
  const text = String(value ?? "")
  if (!text) return null
  if (text.length <= 8) return "••••••••"
  return `${text.slice(0, 4)}…${text.slice(-4)}`
}

/** Saved theme-lane state — never returns the raw key. */
export function themeLaneStatus() {
  const cfg = loadConfig()
  return {
    connected: Boolean(cfg.apiKey),
    baseUrl: cfg.baseUrl ?? null,
    defaultStoreSlug: cfg.defaultStoreSlug ?? null,
    apiKeyMasked: maskSecret(cfg.apiKey),
  }
}

/**
 * Connects the theme lane: verifies the merchant API key against
 * {base}/api/templates/me (the same call `selldoes login --api-key` makes),
 * then saves apiKey/baseUrl/defaultStoreSlug next to the developer token.
 */
export async function themeLaneConnect({ apiKey, baseUrl, defaultStoreSlug } = {}) {
  const key = String(apiKey ?? "").trim()
  if (!key) throw new Error("Provide a merchant API key (Dashboard → Settings → API Keys).")
  const base = String(baseUrl ?? loadConfig().baseUrl ?? process.env.SELLDOES_BASE ?? DEFAULT_APP_URL).replace(/\/$/, "")
  let me = null
  try {
    const res = await fetch(`${base}/api/templates/me`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text()
    try {
      me = JSON.parse(text)
    } catch {
      // non-JSON body
    }
    if (!res.ok) throw new Error(me?.error || `${res.status} ${res.statusText}`)
  } catch (error) {
    throw new Error(`Could not verify the API key against ${base}: ${error.message}`)
  }
  const cfg = loadConfig()
  const stores = Array.isArray(me?.stores) ? me.stores : []
  const requested = String(defaultStoreSlug ?? "").trim()
  cfg.apiKey = key
  cfg.baseUrl = base
  cfg.defaultStoreSlug = requested || stores[0]?.slug || null
  saveConfig(cfg)
  return {
    baseUrl: base,
    defaultStoreSlug: cfg.defaultStoreSlug,
    stores: stores.map((store) => store?.slug).filter(Boolean),
    userId: me?.userId ?? null,
  }
}

/** Clears the theme lane's saved credentials (the developer token stays). */
export function themeLaneDisconnect() {
  const cfg = loadConfig()
  const had = Boolean(cfg.apiKey)
  delete cfg.apiKey
  delete cfg.baseUrl
  delete cfg.defaultStoreSlug
  saveConfig(cfg)
  return had
}

export async function packagesCommand(args, flags) {
  const { appUrl, plugins } = await listPackages(flags)
  if (plugins.length === 0) {
    console.log(`No packages yet on ${appUrl}.`)
    console.log("  Upload one in the developer portal, or publish from a local project: `selldoes publish`.")
    return
  }
  console.log(`Packages on ${appUrl}:`)
  for (const plugin of plugins) {
    console.log(`  • ${plugin.slug} v${plugin.latestVersion}  ${plugin.name}  (${plugin.status}, updated ${String(plugin.updatedAt).slice(0, 10)})`)
  }
  console.log("\nKeep developing one: `selldoes pull <slug>`")
}

const UNSAFE_SEGMENT = (segment) => segment === ".." || segment === "." || (segment.startsWith(".") && segment !== ".env.example")

/**
 * Downloads a package's stored source into a local project folder and
 * registers it in the workspace. Shared by `selldoes pull` and the launcher.
 */
export async function pullPackage(slug, flags = {}) {
  const cleanSlug = String(slug ?? "").trim()
  if (!/^[a-z0-9-]+$/.test(cleanSlug)) throw new Error(`"${cleanSlug}" is not a valid slug`)
  const { token, appUrl } = developerAuth(flags)
  if (!token) throw new Error("Not connected. Run `selldoes login --token sk_dev_…` first.")

  const meta = await devFetch(appUrl, `/api/developers/plugins/${cleanSlug}`, token)
  const pluginMeta = meta.plugin ?? meta
  const snapshot = await devFetch(appUrl, `/api/developers/plugins/${cleanSlug}/source`, token)

  const target = path.resolve(String(flags.dir ?? path.join(os.homedir(), "Selldoes", cleanSlug)))
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`${target} is not empty — pass --dir <path> to pull somewhere else.`)
  }
  fs.mkdirSync(target, { recursive: true })

  let written = 0
  for (const file of snapshot.files ?? []) {
    const relative = String(file?.path ?? "").replace(/\\/g, "/").replace(/^\.?\//, "")
    const segments = relative.split("/").filter(Boolean)
    if (!relative || segments.length === 0 || segments.some(UNSAFE_SEGMENT) || path.posix.isAbsolute(relative)) continue
    const destination = path.join(target, ...segments)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8"))
    written++
  }
  if (written === 0) throw new Error("The stored source had no usable files — try re-publishing from the portal.")

  const { importProject } = await import("./home.mjs")
  const project = importProject(target, { source: "account" })
  const version = snapshot.plugin?.version ?? pluginMeta.latestVersion ?? ""
  console.log(`✓ Pulled ${project.name}${version ? ` v${version}` : ""} → ${target}`)
  console.log(`  ${written} file(s) · registered in your workspace`)
  console.log("  Next: `selldoes dev` from anywhere, or `selldoes home`.")
  return project
}

export async function pullCommand(args, flags) {
  const slug = args.find((arg) => !arg.startsWith("-"))
  if (!slug) die("Usage: selldoes pull <slug> [--dir <path>]")
  await pullPackage(slug, flags)
}

export { openBrowser }
