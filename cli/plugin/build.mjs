import fs from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { zipSync } from "fflate"
import { fileExists, readJson } from "../util.mjs"

const UI_SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"]

/** Mirrors the host's upload validator: only these extensions may be zipped. */
const UPLOADABLE_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".json",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".md",
  ".txt",
  ".html",
  // Listing media (icons + screenshots) ships with the plugin source.
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".avif",
])
const PACK_EXCLUDED_DIRS = new Set(["node_modules", "dist", "coverage", ".git", ".github", ".selldoes-dev"])
const PACK_EXCLUDED_FILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "selldoes.config.json"])

/**
 * Collects every UI HTML entry declared by the manifest: `ui.entry` plus each
 * `dashboardPages[].entry`. Entries are plugin-root-relative ("ui/index.html").
 */
function collectUiEntries(manifest) {
  const entries = new Set()
  const add = (value) => {
    const entry = String(value ?? "").replace(/^\.\//, "").replace(/\\/g, "/").trim()
    if (entry) entries.add(entry)
  }
  add(manifest.ui?.entry)
  for (const page of manifest.dashboardPages ?? []) add(page?.entry)
  return [...entries]
}

/**
 * Finds the bundle source for a UI HTML entry: `ui/<rel>.html` ← `ui/src/<rel>.<ext>`
 * (the documented convention), with the legacy root-level `index.<ext>` fallback.
 */
function uiSourceCandidate(uiRoot, relHtml) {
  const rel = relHtml.replace(/\.html?$/i, "").replace(/\\/g, "/")
  for (const ext of UI_SOURCE_EXTENSIONS) {
    const candidate = path.join(uiRoot, "src", `${rel}${ext}`)
    if (fileExists(candidate)) return candidate
  }
  if (rel === "index") {
    for (const ext of UI_SOURCE_EXTENSIONS) {
      const candidate = path.join(uiRoot, `index${ext}`)
      if (fileExists(candidate)) return candidate
    }
  }
  return null
}

/** Bundle output name for an entry: "reports/summary.html" → "reports-summary". */
function uiBundleName(relHtml) {
  return relHtml.replace(/\.html?$/i, "").replace(/[/\\]/g, "-")
}

/** Writes a React-style HTML shell for a bundled entry (only when missing). */
function writeUiShell(outUi, relHtml, { title, bundleName }) {
  const target = path.join(outUi, relHtml)
  if (fileExists(target)) return false
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      `  <title>${title}</title>`,
      `  <link rel="stylesheet" href="assets/${bundleName}.css" onerror="this.remove()" />`,
      "</head>",
      "<body>",
      '  <div id="root"></div>',
      `  <script type="module" src="assets/${bundleName}.js"></script>`,
      "</body>",
      "</html>",
      "",
    ].join("\n"),
  )
  return true
}

/**
 * Zips the plugin **source** for upload/publish. The platform bundles the
 * runtime server-side, so the archive must contain `plugin.json`, the entry
 * file and `ui/**` — not the prebuilt `dist/` output.
 */
export async function packPluginSource(pluginDir, { zipPath } = {}) {
  const manifest = readJson(path.join(pluginDir, "plugin.json"))
  const entries = {}

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const relative = path.relative(pluginDir, full).replace(/\\/g, "/")
      if (entry.isDirectory()) {
        if (PACK_EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue
        walk(full)
        continue
      }
      if (entry.name.startsWith(".") || PACK_EXCLUDED_FILES.has(entry.name)) continue
      if (!UPLOADABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      entries[relative] = new Uint8Array(fs.readFileSync(full))
    }
  }
  walk(pluginDir)

  const target = zipPath ?? path.join(pluginDir, "dist", `${manifest.slug}.zip`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, zipSync(entries))
  return { manifest, zipPath: target, files: Object.keys(entries).length }
}

/**
 * Builds a plugin directory into `<outDir>/`:
 *
 *   bundle.js     sandbox runtime bundle (CommonJS, dependencies inlined)
 *   plugin.json   manifest copy
 *   ui/**         dashboard UI (copied, with an optional `ui/src` entry bundled)
 *
 * Pass `zip: true` to also write `<slug>.zip` next to the output directory.
 */
export async function buildPlugin(pluginDir, { outDir, zip = false, log = console.log } = {}) {
  const manifestPath = path.join(pluginDir, "plugin.json")
  if (!fileExists(manifestPath)) throw new Error(`No plugin.json in ${pluginDir}`)
  const manifest = readJson(manifestPath)
  const resolvedOut = outDir ?? path.join(pluginDir, "dist")

  fs.rmSync(resolvedOut, { recursive: true, force: true })
  fs.mkdirSync(resolvedOut, { recursive: true })

  // ── Runtime bundle ──────────────────────────────────────────────────────────
  const result = await build({
    entryPoints: [path.join(pluginDir, String(manifest.entry ?? "./index.js").replace(/^\.\//, ""))],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2020",
    outfile: path.join(resolvedOut, "bundle.js"),
    logLevel: "silent",
    absWorkingDir: pluginDir,
  })
  for (const warning of result.warnings) log(`  [esbuild] ${warning.text}`)

  // ── Dashboard UI (optional) ─────────────────────────────────────────────────
  const uiEntries = collectUiEntries(manifest)
  if (uiEntries.length > 0) {
    const uiRoot = path.join(pluginDir, "ui")
    const entries = uiEntries.filter((entry) => {
      if (entry.startsWith("ui/")) return true
      log(`  ! UI entry "${entry}" is outside ui/ — the preview serves entries from ui/`)
      return false
    })
    if (!fs.existsSync(uiRoot)) {
      log(`  ! manifest declares UI entries but ui/ does not exist`)
    } else if (entries.length > 0) {
      const outUi = path.join(resolvedOut, "ui")
      fs.mkdirSync(outUi, { recursive: true })
      fs.cpSync(uiRoot, outUi, {
        recursive: true,
        filter: (source) => {
          const relative = path.relative(uiRoot, source).replace(/\\/g, "/")
          return relative !== "src" && !relative.startsWith("src/")
        },
      })

      for (const entry of entries) {
        const relHtml = entry.slice("ui/".length)
        const bundleName = uiBundleName(relHtml)
        const source = uiSourceCandidate(uiRoot, relHtml)
        if (source) {
          await build({
            entryPoints: [source],
            bundle: true,
            platform: "browser",
            format: "esm",
            target: "es2020",
            outfile: path.join(outUi, "assets", `${bundleName}.js`),
            logLevel: "silent",
            absWorkingDir: pluginDir,
          })
          writeUiShell(outUi, relHtml, { title: manifest.ui?.title ?? manifest.name, bundleName })
        }
      }
    }
  }

  fs.writeFileSync(path.join(resolvedOut, "plugin.json"), JSON.stringify(manifest, null, 2))

  const sizeKb = (fs.statSync(path.join(resolvedOut, "bundle.js")).size / 1024).toFixed(1)
  let zipPath = null
  if (zip) {
    // Upload/publish format: the plugin source, bundled server-side.
    const packed = await packPluginSource(pluginDir, { zipPath: path.join(path.dirname(resolvedOut), `${manifest.slug}.zip`) })
    zipPath = packed.zipPath
  }

  return { manifest, outDir: resolvedOut, zipPath, sizeKb }
}
