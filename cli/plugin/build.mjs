import fs from "node:fs"
import path from "node:path"
import { builtinModules } from "node:module"
import { build } from "esbuild"
import { zipSync } from "fflate"
import { fileExists, readJson } from "../util.mjs"
import { checkSandboxBundle, formatSandboxIssues, nodeBuildOptions, nodeJobLimits, sandboxBuildOptions } from "./sandbox.mjs"

const NODE_BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")))

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
 *
 * When `bundlePath` is provided the finished sandbox bundle is added as
 * `dist/bundle.js`: the platform runs that file directly instead of installing
 * dependencies and rebuilding on the server.
 */
export async function packPluginSource(pluginDir, { zipPath, bundlePath, nodeDir } = {}) {
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

  // Prebuilt sandbox bundle (what the platform will execute). It sits at
  // dist/bundle.js in the zip so a stale local dist/ is never picked up.
  if (bundlePath && fileExists(bundlePath)) {
    entries["dist/bundle.js"] = new Uint8Array(fs.readFileSync(bundlePath))
  }

  // Node job artifact: bundled entry + package.json + lockfile, installed into
  // the execution image. Kept out of the source walk (dist/ is excluded).
  if (nodeDir && fs.existsSync(nodeDir)) {
    for (const entry of fs.readdirSync(nodeDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue
      entries[`dist/node/${entry.name}`] = new Uint8Array(fs.readFileSync(path.join(nodeDir, entry.name)))
    }
  }

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
  const bundlePath = path.join(resolvedOut, "bundle.js")
  const result = await build(
    sandboxBuildOptions({
      pluginDir,
      entryPoints: [path.join(pluginDir, String(manifest.entry ?? "./index.js").replace(/^\.\//, ""))],
      outfile: bundlePath,
      minify: true,
      metafile: true,
    }),
  )
  for (const warning of result.warnings) log(`  [esbuild] ${warning.text}`)

  // The bundle is the artifact the sandbox will execute — check it here so a
  // package that needs fs/net or exceeds 4 MB fails the build, not a store.
  const sandbox = checkSandboxBundle({ bundlePath, metafile: result.metafile, manifest })
  for (const warning of sandbox.warnings) log(`  [sandbox] ${warning}`)
  if (!sandbox.ok) {
    throw new Error(`The plugin bundle does not match the sandbox contract:\n${formatSandboxIssues(sandbox)}`)
  }

  // ── Node job artifact (optional) ────────────────────────────────────────────
  const nodeJobs = (manifest.jobs ?? []).filter((job) => job?.runtime === "node")
  let nodeDir = null
  let nodeArtifact = null
  if (nodeJobs.length > 0) {
    nodeDir = path.join(resolvedOut, "node")
    fs.mkdirSync(nodeDir, { recursive: true })

    const declared = manifest.dependencies ?? {}
    const imported = new Set()
    const jobArtifacts = []
    for (const job of nodeJobs) {
      const type = String(job.type)
      const relative = String(job.entry ?? manifest.entry ?? "./index.js").replace(/^\.\//, "")
      const file = `${type.replace(/[^a-z0-9_-]/gi, "_")}.cjs`
      const nodeResult = await build(
        nodeBuildOptions({
          pluginDir,
          entryPoints: [path.join(pluginDir, relative)],
          outfile: path.join(nodeDir, file),
          metafile: true,
        }),
      )
      for (const warning of nodeResult.warnings) log(`  [esbuild:node] ${warning.text}`)
      for (const info of Object.values(nodeResult.metafile?.inputs ?? {})) {
        for (const record of info.imports ?? []) {
          if (!record.external) continue
          const target = String(record.path ?? "")
          if (target.startsWith(".") || path.isAbsolute(target)) continue
          const bare = target.replace(/^node:/, "")
          const name = bare.startsWith("@") ? bare.split("/").slice(0, 2).join("/") : bare.split("/")[0]
          if (!NODE_BUILTINS.has(name) && name) imported.add(name)
        }
      }
      jobArtifacts.push({ type, file, ...nodeJobLimits(job) })
    }

    // The execution image installs dependencies from the plugin's package.json
    // and lockfile, so both must travel with the artifact.
    const pkgPath = path.join(pluginDir, "package.json")
    if (fileExists(pkgPath)) fs.copyFileSync(pkgPath, path.join(nodeDir, "package.json"))
    const lockfile = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"].find((name) =>
      fileExists(path.join(pluginDir, name)),
    )
    if (lockfile) fs.copyFileSync(path.join(pluginDir, lockfile), path.join(nodeDir, lockfile))
    else log("  ! Node jobs declared but no lockfile found — the execution image will resolve dependencies fresh")

    const undeclared = [...imported].filter((name) => !(name in declared)).sort()
    if (undeclared.length > 0) {
      log(`  ! Node jobs import ${undeclared.join(", ")} but plugin.json does not declare them — add them so the image installs them`)
    }

    nodeArtifact = {
      runtime: "node",
      node: ">=20",
      jobs: jobArtifacts,
      dependencies: declared,
    }
    fs.writeFileSync(path.join(nodeDir, "artifact.json"), `${JSON.stringify(nodeArtifact, null, 2)}\n`)
    log(`  node jobs: ${nodeJobs.map((job) => job.type).join(", ")} → dist/node/`)
  }

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

  const sizeKb = (fs.statSync(bundlePath).size / 1024).toFixed(1)
  let zipPath = null
  if (zip) {
    // Upload/publish format: source + the prebuilt sandbox bundle, so the
    // platform does not install npm dependencies or rebuild on the server.
    const packed = await packPluginSource(pluginDir, {
      zipPath: path.join(path.dirname(resolvedOut), `${manifest.slug}.zip`),
      bundlePath,
      nodeDir,
    })
    zipPath = packed.zipPath
  }

  return { manifest, outDir: resolvedOut, zipPath, sizeKb, sandbox, bundlePath, nodeDir, nodeArtifact }
}
