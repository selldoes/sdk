import fs from "node:fs"
import path from "node:path"
import { fileExists, readJson } from "../util.mjs"
import { validateDependencies } from "./dependencies.mjs"

const SLUG = /^[a-z0-9-]+$/
const VERSION = /^\d+\.\d+\.\d+$/
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]
const UI_PATH = /^[a-zA-Z0-9_\-./]+$/

/**
 * Validates one plugin directory the way the host will validate it on upload.
 * Returns `{ slug, manifest, errors, warnings }` — never throws.
 */
export function validatePluginDir(pluginDir, { expectedSlug } = {}) {
  const errors = []
  const warnings = []
  const manifestPath = path.join(pluginDir, "plugin.json")
  if (!fileExists(manifestPath)) return { slug: path.basename(pluginDir), errors: ["plugin.json is missing"], warnings }

  let manifest
  try {
    manifest = readJson(manifestPath)
  } catch (error) {
    return { slug: path.basename(pluginDir), errors: [`plugin.json is not valid JSON: ${error.message}`], warnings }
  }
  const slug = String(manifest.slug ?? "")

  if (!SLUG.test(slug)) errors.push(`invalid slug "${manifest.slug}" (use lowercase letters, digits and hyphens)`)
  if (expectedSlug && slug !== expectedSlug) errors.push(`slug "${slug}" does not match "${expectedSlug}"`)
  if (!manifest.name) errors.push("name is required")
  if (!VERSION.test(String(manifest.version ?? ""))) errors.push(`version "${manifest.version}" must be x.y.z`)
  if (!manifest.description) errors.push("description is required")

  const entry = path.join(pluginDir, String(manifest.entry ?? "./index.js").replace(/^\.\//, ""))
  if (!fileExists(entry)) errors.push(`entry "${manifest.entry ?? "./index.js"}" does not exist`)

  if (manifest.ui?.entry) {
    if (!UI_PATH.test(manifest.ui.entry)) errors.push(`ui.entry "${manifest.ui.entry}" contains invalid characters`)
    else if (!fileExists(path.join(pluginDir, manifest.ui.entry))) errors.push(`ui.entry "${manifest.ui.entry}" does not exist`)
  }
  if (manifest.storefrontWidget?.entry) {
    if (!fileExists(path.join(pluginDir, manifest.storefrontWidget.entry))) {
      errors.push(`storefrontWidget.entry "${manifest.storefrontWidget.entry}" does not exist`)
    }
  }

  const pagePaths = new Set()
  for (const page of manifest.storefrontPages ?? []) {
    if (!page?.path?.startsWith("/")) errors.push(`storefrontPages path "${page?.path}" must start with /`)
    if (pagePaths.has(page?.path)) errors.push(`duplicate storefrontPages path "${page?.path}"`)
    pagePaths.add(page?.path)
    if (!page?.title) errors.push(`storefrontPages "${page?.path}" needs a title`)
    if (page?.entry && !fileExists(path.join(pluginDir, page.entry))) {
      errors.push(`storefrontPages "${page.path}" entry "${page.entry}" does not exist`)
    }
  }

  const dashboardPaths = new Set()
  for (const page of manifest.dashboardPages ?? []) {
    if (!page?.path?.startsWith("/")) errors.push(`dashboardPages path "${page?.path}" must start with /`)
    if (dashboardPaths.has(page?.path)) errors.push(`duplicate dashboardPages path "${page?.path}"`)
    dashboardPaths.add(page?.path)
    if (!page?.label) errors.push(`dashboardPages "${page?.path}" needs a label`)
    if (page?.entry) {
      if (!UI_PATH.test(page.entry)) errors.push(`dashboardPages "${page.path}" entry "${page.entry}" contains invalid characters`)
      else if (!fileExists(path.join(pluginDir, page.entry))) {
        errors.push(`dashboardPages "${page.path}" entry "${page.entry}" does not exist`)
      }
    }
  }

  const seenRoutes = new Set()
  for (const route of manifest.apiRoutes ?? []) {
    if (!route?.path?.startsWith("/")) errors.push(`apiRoutes path "${route?.path}" must start with /`)
    if (seenRoutes.has(route?.path)) errors.push(`duplicate apiRoutes path "${route?.path}"`)
    seenRoutes.add(route?.path)
    for (const method of route?.methods ?? []) {
      if (!METHODS.includes(method)) errors.push(`apiRoutes ${route?.path}: unsupported method "${method}"`)
    }
  }
  const seenPublic = new Set()
  for (const route of manifest.publicRoutes ?? []) {
    if (!route?.path?.startsWith("/")) errors.push(`publicRoutes path "${route?.path}" must start with /`)
    if (seenPublic.has(route?.path)) errors.push(`duplicate publicRoutes path "${route?.path}"`)
    seenPublic.add(route?.path)
    for (const method of route?.methods ?? []) {
      if (!METHODS.includes(method)) errors.push(`publicRoutes ${route?.path}: unsupported method "${method}"`)
    }
  }

  if (manifest.permissions?.includes("db:read") && !(manifest.allowedTables ?? []).length) {
    warnings.push("db:read without allowedTables — the plugin can only read its own plugin_<slug>_* tables")
  }
  if (manifest.dependencies) {
    const dependencyCheck = validateDependencies(manifest.dependencies)
    for (const error of dependencyCheck.errors) errors.push(error)
  }

  return { slug, manifest, errors, warnings }
}

/** Validates every plugin folder in a `plugins/` directory. */
export function validatePluginsDir(pluginsDir, { slug } = {}) {
  const slugs = slug
    ? [slug]
    : fs
        .readdirSync(pluginsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
  return slugs.map((name) => validatePluginDir(path.join(pluginsDir, name), { expectedSlug: name }))
}
