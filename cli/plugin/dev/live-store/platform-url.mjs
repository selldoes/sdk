import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Local platform auto-detection.
 *
 * `selldoes dev` can bridge to a real Selldesk instance. When the platform repo
 * is checked out on the developer's machine (`selldesk.net/next`, started with
 * `npm run dev` on port 9582) the dev server prefers that local instance over
 * the hosted selldoes.com — so a plugin dev working on the platform gets the
 * local build without editing `selldoes.config.json`.
 *
 * Overrides:
 *   SELLDOES_LOCAL_PLATFORM=http://localhost:3000  → use that URL directly
 *   SELLDOES_LOCAL_PLATFORM=/path/to/selldesk.net  → use that checkout
 *   SELLDOES_LOCAL_PLATFORM=off                     → disable detection
 *   SELLDOES_APP_URL=…                              → always wins
 */
export const LOCAL_PLATFORM_PORT = 9582
export const LOCAL_PLATFORM_URL = `http://localhost:${LOCAL_PLATFORM_PORT}`

function localPlatformSetting() {
  return String(process.env.SELLDOES_LOCAL_PLATFORM ?? "").trim()
}

function localPlatformDisabled() {
  return ["off", "0", "false", "no"].includes(localPlatformSetting().toLowerCase())
}

/** Candidate `next/` dirs of a local Selldesk platform checkout. */
function localPlatformCandidates() {
  const setting = localPlatformSetting()
  const candidates = []
  // An explicit path (not a URL, not the disable flag) is checked first.
  if (setting && !localPlatformDisabled() && !/^https?:\/\//i.test(setting)) candidates.push(setting)
  const home = os.homedir()
  candidates.push(
    path.join(home, "Desktop", "selldesk.net", "next"),
    path.join(home, "OneDrive", "Desktop", "selldesk.net", "next"),
    path.join(home, "Documents", "selldesk.net", "next"),
    path.join(home, "selldesk.net", "next"),
  )
  return candidates
}

/**
 * The local platform `next/` directory when a checkout is present, else null.
 * A candidate counts when it holds a `package.json` directly, or a `next/`
 * sub-directory that does (so the repo root works too).
 */
export function findLocalPlatformDir() {
  if (localPlatformDisabled()) return null
  for (const candidate of localPlatformCandidates()) {
    if (!candidate) continue
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate
    const nested = path.join(candidate, "next")
    if (fs.existsSync(path.join(nested, "package.json"))) return nested
  }
  return null
}

/**
 * The app URL the live bridge should talk to. Precedence:
 *   1. the `explicit` argument
 *   2. `SELLDOES_APP_URL`
 *   3. `SELLDOES_LOCAL_PLATFORM` when it is a URL
 *   4. a detected local platform checkout → http://localhost:9582
 *   5. the saved `store.appUrl`
 */
export function resolveLiveAppUrl(saved, explicit) {
  const clean = (value) => String(value ?? "").replace(/\/+$/, "") || null
  const explicitUrl = clean(explicit) || clean(process.env.SELLDOES_APP_URL)
  if (explicitUrl) return explicitUrl
  const setting = localPlatformSetting()
  if (!localPlatformDisabled() && /^https?:\/\//i.test(setting)) return clean(setting)
  if (findLocalPlatformDir()) return LOCAL_PLATFORM_URL
  return clean(saved)
}
