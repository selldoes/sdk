import fs from "node:fs"
import path from "node:path"
import { buildPlugin } from "./build.mjs"
import { readJson } from "./util.mjs"

async function postJson(url, body, headers) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, ok: response.ok, payload }
}

function reportFailure(context, result) {
  const detail = result.payload?.error ?? `HTTP ${result.status}`
  console.error(`✗ ${context}: ${detail}`)
  for (const violation of result.payload?.violations ?? []) console.error(`  · ${violation.message ?? violation}`)
  for (const error of result.payload?.errors ?? []) console.error(`  · ${error}`)
}

/**
 * Builds a plugin, zips it and publishes it to a Selldoes instance.
 *
 * Two auth lanes:
 *  - `token`: CI / first-party service token (`x-selldoes-publish-token`).
 *  - `cookie`: a dashboard session cookie (`session=…`). The plugin is first
 *    uploaded to the caller's store (`install-upload`), then published from it.
 */
export async function publishPlugin({
  pluginDir,
  appUrl,
  token,
  cookie,
  storeId,
  price = 0,
  billingPeriod = "one_time",
  log = console.log,
}) {
  if (!appUrl) throw new Error("--app-url (or SELLDOES_APP_URL) is required")
  const manifest = readJson(path.join(pluginDir, "plugin.json"))
  const base = appUrl.replace(/\/$/, "")

  log(`Building ${manifest.slug}…`)
  const built = await buildPlugin(pluginDir, {
    outDir: path.join(pluginDir, ".selldoes-dev", "publish"),
    zip: true,
    log,
  })
  const data = fs.readFileSync(built.zipPath).toString("base64")

  if (token) {
    const result = await postJson(
      `${base}/api/plugins/marketplace/publish`,
      { slug: manifest.slug, data, price, billingPeriod },
      { "x-selldoes-publish-token": token },
    )
    if (!result.ok) {
      reportFailure("Publish failed", result)
      return { ok: false, ...result }
    }
    log(`✓ Published ${manifest.slug} v${result.payload?.release?.version ?? manifest.version} (listing: ${result.payload?.listing?.status ?? "?"})`)
    if (result.payload?.listing?.status === "pending") log("  The listing is pending admin review.")
    return { ok: true, ...result }
  }

  if (cookie) {
    log("Uploading to your store…")
    const upload = await postJson(
      `${base}/api/plugins/external`,
      { action: "install-upload", data, acknowledge: true, storeId: storeId ? Number(storeId) : undefined },
      { cookie },
    )
    if (!upload.ok) {
      reportFailure("Upload failed", upload)
      return { ok: false, ...upload }
    }
    log("Creating marketplace listing…")
    const result = await postJson(
      `${base}/api/plugins/marketplace/publish`,
      { slug: manifest.slug, storeId: storeId ? Number(storeId) : undefined, price, billingPeriod },
      { cookie },
    )
    if (!result.ok) {
      reportFailure("Publish failed", result)
      return { ok: false, ...result }
    }
    log(`✓ Published ${manifest.slug} v${manifest.version} (listing: ${result.payload?.listing?.status ?? "?"})`)
    if (result.payload?.listing?.status === "pending") log("  The listing is pending admin review.")
    return { ok: true, ...result }
  }

  throw new Error("Publishing needs auth: pass --token (CI) or --cookie (dashboard session)")
}
