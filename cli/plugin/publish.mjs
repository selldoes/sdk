import fs from "node:fs"
import path from "node:path"
import { buildPlugin } from "./build.mjs"
import { readJson } from "../util.mjs"

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
 * Builds a plugin, zips it and publishes it to a SellDesk instance through the
 * developer account — the only publish lane since the legacy merchant/bundled
 * routes were removed (2026-10-01).
 *
 * Auth: a developer token (`sk_dev_…`, from the developer portal → API
 * tokens), via `--token`, `SELLDOES_DEV_TOKEN` or a previous
 * `selldoes login --token sk_dev_…`. The app URL comes from `--app-url`,
 * `SELLDOES_APP_URL` or the saved login.
 */
export async function publishPlugin({
  pluginDir,
  appUrl,
  token,
  notes,
  price = 0,
  currency = "USD",
  billingPeriod = "one_time",
  trialDays = 0,
  log = console.log,
}) {
  const manifest = readJson(path.join(pluginDir, "plugin.json"))
  const base = String(appUrl ?? "").replace(/\/$/, "")
  if (!base) throw new Error("--app-url (or SELLDOES_APP_URL, or a saved `selldoes login`) is required")
  const auth = String(token ?? process.env.SELLDOES_DEV_TOKEN ?? "").trim()
  if (!auth) {
    throw new Error(
      "Publishing needs a developer token: `selldoes login --token sk_dev_…` (developer portal → API tokens) or pass --token",
    )
  }

  log(`Building ${manifest.slug}…`)
  const built = await buildPlugin(pluginDir, {
    outDir: path.join(pluginDir, ".selldoes-dev", "publish"),
    zip: true,
    log,
  })
  const data = fs.readFileSync(built.zipPath).toString("base64")

  log(`Publishing ${manifest.slug} v${manifest.version} → ${base}`)
  const result = await postJson(
    `${base}/api/developers/publish`,
    {
      slug: manifest.slug,
      data,
      notes: typeof notes === "string" && notes ? notes : undefined,
      price: Number(price) > 0 ? Number(price) : 0,
      currency: String(currency || "USD").slice(0, 3).toUpperCase(),
      billingPeriod: String(billingPeriod ?? "one_time"),
      trialDays: Math.max(0, Math.min(Number(trialDays) || 0, 90)),
    },
    { Authorization: `Bearer ${auth}` },
  )
  if (!result.ok) {
    reportFailure("Publish failed", result)
    return { ok: false, ...result }
  }

  const listing = result.payload?.listing
  log(`✓ Published ${manifest.slug} v${result.payload?.release?.version ?? manifest.version}`)
  if (listing?.status) {
    log(`  Marketplace listing: ${listing.status}${listing.status === "pending" ? " — pending admin review." : "."}`)
  } else {
    log("  Saved to your developer workspace (no marketplace listing yet).")
  }
  return { ok: true, ...result }
}
