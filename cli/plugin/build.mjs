import fs from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { zipSync } from "fflate"
import { fileExists, readJson } from "../util.mjs"

const UI_SOURCE_CANDIDATES = ["src/index.tsx", "src/index.ts", "src/index.jsx", "src/index.js", "index.tsx", "index.ts", "index.jsx", "index.js"]

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
  if (manifest.ui?.entry) {
    const uiRoot = path.join(pluginDir, "ui")
    if (!fs.existsSync(uiRoot)) {
      log(`  ! manifest declares ui.entry but ${path.relative(pluginDir, uiRoot) || "ui"}/ does not exist`)
    } else {
      const outUi = path.join(resolvedOut, "ui")
      fs.mkdirSync(outUi, { recursive: true })
      fs.cpSync(uiRoot, outUi, {
        recursive: true,
        filter: (source) => {
          const relative = path.relative(uiRoot, source).replace(/\\/g, "/")
          return relative !== "src" && !relative.startsWith("src/")
        },
      })

      const uiEntry = UI_SOURCE_CANDIDATES.find((candidate) => fileExists(path.join(uiRoot, candidate)))
      if (uiEntry) {
        await build({
          entryPoints: [path.join(uiRoot, uiEntry)],
          bundle: true,
          platform: "browser",
          format: "esm",
          target: "es2020",
          outfile: path.join(outUi, "assets", "index.js"),
          logLevel: "silent",
          absWorkingDir: pluginDir,
        })
      }

      if (!fileExists(path.join(outUi, "index.html"))) {
        fs.mkdirSync(outUi, { recursive: true })
        fs.writeFileSync(
          path.join(outUi, "index.html"),
          [
            "<!doctype html>",
            '<html lang="en">',
            "<head>",
            '<meta charset="utf-8" />',
            '<meta name="viewport" content="width=device-width, initial-scale=1" />',
            `<title>${manifest.name}</title>`,
            '<link rel="stylesheet" href="assets/index.css" onerror="this.remove()" />',
            "</head>",
            "<body>",
            '<div id="root"></div>',
            '<script type="module" src="assets/index.js"></script>',
            "</body>",
            "</html>",
            "",
          ].join("\n"),
        )
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
