import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const REGISTRY_URL = "https://registry.npmjs.org/-/package/selldoes/dist-tags"
const CHECK_TIMEOUT_MS = 1000

export const CURRENT_VERSION = PACKAGE.version

/** Fetches the latest published version — null when offline, slow, or the registry doesn't answer in time. */
export async function fetchLatestVersion(timeoutMs = CHECK_TIMEOUT_MS) {
  if (typeof fetch !== "function") return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(REGISTRY_URL, { signal: controller.signal, headers: { accept: "application/json" } })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.latest === "string" ? data.latest : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Numeric x.y.z comparison; prerelease suffixes are ignored. Returns -1, 0 or 1. */
export function compareVersions(a, b) {
  const parse = (value) => String(value).split("-")[0].split(".").map((part) => parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
  }
  return 0
}

/** How this CLI is running: a global install, a project dependency, or the npx cache. */
export function detectInstallMode() {
  const here = fileURLToPath(import.meta.url).split(path.sep).join("/")
  if (here.includes("/_npx/")) return "npx"
  const marker = "/node_modules/"
  const index = here.lastIndexOf(marker)
  if (index === -1) return "unknown"
  const root = here.slice(0, index)
  const cwd = process.cwd().split(path.sep).join("/")
  return cwd === root || cwd.startsWith(`${root}/`) ? "local" : "global"
}

export function installCommandFor(mode) {
  return mode === "local" ? "npm install -D selldoes@latest" : "npm install -g selldoes@latest"
}

export async function getUpdateInfo() {
  const latest = await fetchLatestVersion()
  return {
    current: CURRENT_VERSION,
    latest,
    outdated: latest !== null && compareVersions(latest, CURRENT_VERSION) > 0,
    mode: detectInstallMode(),
  }
}

export function printUpdateNotice(info) {
  const suggestion = info.mode === "npx" ? "npx selldoes@latest" : "selldoes update"
  process.stderr.write(`\n  ⬆ selldoes ${info.latest} is available (you have ${info.current}) — run: ${suggestion}\n\n`)
}
