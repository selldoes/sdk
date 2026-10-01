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

/** `selldoes login` — routes merchant keys to the theme lane, tokens here. */
export async function loginCommand(args, flags) {
  const cfg = loadConfig()
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
  if (!isDeveloperToken(token)) {
    die("Developer tokens start with sk_dev_. A plain sk_… key is a merchant API key — that's the theme lane (`selldoes login --api-key sk_…`).")
  }

  const appUrl = String(flags["app-url"] ?? cfg.appUrl ?? process.env.SELLDOES_APP_URL ?? DEFAULT_APP_URL).replace(/\/$/, "")
  let account
  try {
    ;({ account } = await devFetch(appUrl, "/api/developers/me", String(token)))
  } catch (error) {
    die(`Could not verify the token against ${appUrl}: ${error.message}`)
  }
  if (account.status && account.status !== "active") {
    die(`This developer account is ${account.status} — suspended accounts cannot be used.`)
  }

  cfg.developerToken = String(token)
  cfg.appUrl = appUrl
  saveConfig(cfg)
  console.log(`✓ Connected as ${account.name} <${account.email}> (${appUrl})`)
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
