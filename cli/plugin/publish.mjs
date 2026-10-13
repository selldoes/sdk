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
 *
 * Pricing: `price`/`currency`/`billingPeriod`/`trialDays` default to the
 * manifest's `pricing` block (the one the Details editor writes) when the
 * caller omits them — explicit arguments always win.
 */
export async function publishPlugin({
  pluginDir,
  appUrl,
  token,
  notes,
  price,
  currency,
  billingPeriod,
  trialDays,
  log = console.log,
}) {
  const manifest = readJson(path.join(pluginDir, "plugin.json"))
  const pricing = manifest.pricing && typeof manifest.pricing === "object" ? manifest.pricing : {}
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

  // Explicit arguments beat the manifest's pricing block; the platform
  // defaults (0 / USD / one_time) apply when neither exists.
  const resolvedPrice = price !== undefined ? Number(price) || 0 : Number(pricing.amount) > 0 ? Number(pricing.amount) : 0
  const resolvedCurrency = currency ?? (typeof pricing.currency === "string" ? pricing.currency : "USD")
  const resolvedBilling = billingPeriod ?? (typeof pricing.billingPeriod === "string" ? pricing.billingPeriod : "one_time")
  const resolvedTrial = trialDays !== undefined ? Number(trialDays) || 0 : Number(pricing.trialDays) || 0

  log(`Publishing ${manifest.slug} v${manifest.version} → ${base}`)
  log(
    resolvedPrice > 0
      ? `  Listing price: ${resolvedCurrency} ${resolvedPrice} (${resolvedBilling}${resolvedTrial > 0 ? `, ${resolvedTrial}-day trial` : ""})`
      : "  Listing price: free",
  )
  const result = await postJson(
    `${base}/api/developers/publish`,
    {
      slug: manifest.slug,
      data,
      notes: typeof notes === "string" && notes ? notes : undefined,
      price: resolvedPrice,
      currency: String(resolvedCurrency || "USD").slice(0, 3).toUpperCase(),
      billingPeriod: String(resolvedBilling ?? "one_time"),
      trialDays: Math.max(0, Math.min(Number(resolvedTrial) || 0, 90)),
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
