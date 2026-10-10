import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The no-code components kit compiler.
 *
 * `dashboardPages[].sections` is authored data; this compiler turns a page with
 * sections and no entry into a real UI entry (`ui/kit/<name>.html` + a copy of
 * the shared runtime) and points the page's `entry` at it. The platform then
 * serves that page in its sandboxed dashboard iframe — the same artifact the
 * preview shows, so what you build is what the store renders.
 *
 * Idempotent: safe to run before every build. Generated files are ordinary
 * plugin files (they travel through `pack`/`publish` like any other UI asset).
 * Pages that already declare an `entry` are left untouched — a hand-written UI
 * wins over the kit.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** Shared runtime shipped into every plugin that uses kit sections. */
const KIT_DIR = path.resolve(HERE, "..", "..", "kit")

const RUNTIME_FILES = ["runtime.js", "runtime.css"]

/** "/" → "home", "/reports/daily" → "reports-daily". */
export function kitPageName(pagePath) {
  const clean = String(pagePath ?? "/").replace(/^\/+/, "").replace(/\/+$/, "")
  const name = clean
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return name || "home"
}

/** Escapes `</script>`-breaking sequences when embedding JSON in HTML. */
function escapeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
}

function pageHtml({ title, slug, sections, jobs }) {
  const data = { slug, sections, jobs }
  const safeTitle = String(title ?? "").replace(/[<>&]/g, "")
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${safeTitle}</title>`,
    '    <link rel="stylesheet" href="runtime.css" />',
    "  </head>",
    "  <body>",
    '    <div id="kit-root"></div>',
    `    <script>window.__SELDOES_KIT__ = ${escapeJsonForHtml(data)};</script>`,
    '    <script src="runtime.js"></script>',
    "  </body>",
    "</html>",
    "",
  ].join("\n")
}

/**
 * Compiles kit pages into `ui/kit/` and points `dashboardPages[].entry` at
 * them. Returns `{ changed, compiled }`; `changed` is true when the manifest
 * was rewritten.
 */
export function syncKitPages(pluginDir) {
  const manifestPath = path.join(pluginDir, "plugin.json")
  if (!fs.existsSync(manifestPath)) return { changed: false, compiled: [] }

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  } catch {
    return { changed: false, compiled: [] }
  }

  const pages = Array.isArray(manifest.dashboardPages) ? manifest.dashboardPages : []
  const kitPages = pages.filter((page) => {
    if (!Array.isArray(page?.sections) || page.sections.length === 0) return false
    // (Re)compile pages with no entry, and pages whose entry is our generated
    // file (so editing sections regenerates the page every build). A custom
    // hand-written entry wins and stays untouched.
    const normalized = page.entry ? String(page.entry).replace(/^\.\//, "").replace(/\\/g, "/") : null
    return !normalized || normalized === `ui/kit/${kitPageName(page.path)}.html`
  })
  if (kitPages.length === 0) return { changed: false, compiled: [] }
  if (!fs.existsSync(KIT_DIR)) throw new Error(`Kit runtime not found at ${KIT_DIR}`)

  const kitDir = path.join(pluginDir, "ui", "kit")
  fs.mkdirSync(kitDir, { recursive: true })
  for (const file of RUNTIME_FILES) {
    const source = fs.readFileSync(path.join(KIT_DIR, file))
    const target = path.join(kitDir, file)
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(source)) {
      fs.writeFileSync(target, source)
    }
  }

  const jobs = (manifest.jobs ?? []).map((job) => ({
    type: job.type,
    name: job.name,
    runtime: job.runtime ?? "quickjs",
  }))

  const compiled = []
  let changed = false
  for (const page of kitPages) {
    const name = kitPageName(page.path)
    const entry = `ui/kit/${name}.html`
    const html = pageHtml({
      title: `${manifest.name ?? manifest.slug} — ${page.label ?? name}`,
      slug: manifest.slug,
      sections: page.sections,
      jobs,
    })
    const htmlPath = path.join(kitDir, `${name}.html`)
    if (!fs.existsSync(htmlPath) || fs.readFileSync(htmlPath, "utf8") !== html) {
      fs.writeFileSync(htmlPath, html)
    }
    if (page.entry !== entry) {
      page.entry = entry
      changed = true
    }
    compiled.push({ path: page.path, entry })
  }

  if (changed) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { changed, compiled }
}
