import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Dashboard-UI scaffolding + friendly fallback pages.
 *
 * Every plugin ships a working "notes" example (plain JS or React). When a
 * declared page entry is missing — or the plugin has no UI at all — the dev
 * server can regenerate the notes example on demand ("Create this page") and
 * serves a styled fallback page instead of raw JSON in the iframe.
 */

const TEMPLATES_ROOT = fileURLToPath(new URL("../../../templates/", import.meta.url))
const JS_TEMPLATE = path.join(TEMPLATES_ROOT, "plugin", "ui")
const REACT_TEMPLATE = path.join(TEMPLATES_ROOT, "plugin-react-ui")

/** "react" when the plugin depends on React (or has TSX UI sources), else "js". */
export function detectUiFlavor(pluginDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"))
    if (pkg.dependencies?.react || pkg.devDependencies?.react) return "react"
  } catch {
    // no package.json — plain JS
  }
  const srcDir = path.join(pluginDir, "ui", "src")
  try {
    if (fs.existsSync(srcDir) && fs.readdirSync(srcDir).some((name) => /\.tsx$/i.test(name))) return "react"
  } catch {
    // unreadable ui/src — fall through
  }
  return "js"
}

const UNSAFE_SEGMENT = (segment) => segment === ".." || segment === "." || segment.startsWith(".")

/** Validates + normalizes a page entry: plugin-root-relative, under ui/, .html. */
export function normalizePageEntry(value, fallback = "ui/index.html") {
  const raw = String(value ?? "").trim() || fallback
  const normalized = raw.replace(/^\.\//, "").replace(/\\/g, "/")
  const segments = normalized.split("/").filter(Boolean)
  if (!normalized.startsWith("ui/") || segments.some(UNSAFE_SEGMENT) || path.posix.isAbsolute(normalized)) {
    throw new Error(`Page entries must be .html files under ui/ (got "${value}")`)
  }
  if (!/\.html?$/i.test(normalized)) {
    throw new Error(`Page entries must be .html files (got "${value}")`)
  }
  return normalized
}

function fillTokens(text, { name, slug }) {
  return String(text).split("__PLUGIN_NAME__").join(name).split("__PLUGIN_SLUG__").join(slug)
}

function readTemplateFile(templateDir, relative) {
  return fs.readFileSync(path.join(templateDir, relative), "utf8")
}

function reactShellHtml({ title, bundleName }) {
  return [
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
  ].join("\n")
}

/**
 * Computes the notes-example files for one dashboard page entry — without
 * touching disk. The dev server snapshots `plan.files` before writing so a
 * single undo reverts the whole scaffold.
 *
 *   ui/index.html          JS: templates/plugin/ui (index.html, app.js, app.css)
 *                          React: templates/plugin-react-ui (index.html, src/*)
 *   ui/<other>.html        JS: same shared app.js/app.css referenced by both pages
 *                          React: generated shell + ui/src/<other>.tsx from the template
 */
export function planNotesUi({ pluginDir, manifest, entry }) {
  let resolvedManifest = manifest ?? null
  if (!resolvedManifest) {
    try {
      resolvedManifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8"))
    } catch {
      resolvedManifest = null
    }
  }
  const normalized = normalizePageEntry(entry, resolvedManifest?.ui?.entry ?? "ui/index.html")
  const relHtml = normalized.slice("ui/".length)
  const isRoot = relHtml.toLowerCase() === "index.html"
  const flavor = detectUiFlavor(pluginDir)
  const baseName = String(resolvedManifest?.name ?? resolvedManifest?.slug ?? "My Plugin")
  // Secondary pages are titled "<Plugin> — <Page>" so a regenerated page is
  // distinguishable from the root notes page.
  const pageLabel = relHtml
    .replace(/\.html?$/i, "")
    .split(/[/\\-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
  const tokens = {
    name: isRoot ? baseName : pageLabel ? `${baseName} — ${pageLabel}` : baseName,
    slug: String(resolvedManifest?.slug ?? "my-plugin"),
  }

  const targets = []
  const add = (path, content) => targets.push({ path, content })

  if (flavor === "react") {
    if (isRoot) {
      add("ui/index.html", fillTokens(readTemplateFile(REACT_TEMPLATE, "index.html"), tokens))
      add("ui/src/index.tsx", fillTokens(readTemplateFile(REACT_TEMPLATE, "src/index.tsx"), tokens))
      add("ui/src/styles.css", readTemplateFile(REACT_TEMPLATE, "src/styles.css"))
    } else {
      const bundleName = relHtml.replace(/\.html?$/i, "").replace(/[/\\]/g, "-")
      add(normalized, reactShellHtml({ title: tokens.name, bundleName }))
      add(`ui/src/${relHtml.replace(/\.html?$/i, "")}.tsx`, fillTokens(readTemplateFile(REACT_TEMPLATE, "src/index.tsx"), tokens))
      add("ui/src/styles.css", readTemplateFile(REACT_TEMPLATE, "src/styles.css"))
    }
  } else {
    // Plain JS: the template page + its script/style work for the root page and
    // any additional page (flat ui/ folder — both pages reference app.js).
    add(isRoot ? "ui/index.html" : normalized, fillTokens(readTemplateFile(JS_TEMPLATE, "index.html"), tokens))
    add("ui/app.js", fillTokens(readTemplateFile(JS_TEMPLATE, "app.js"), tokens))
    add("ui/app.css", readTemplateFile(JS_TEMPLATE, "app.css"))
  }

  return { entry: normalized, relHtml, isRoot, flavor, tokens, targets, files: targets.map((target) => target.path) }
}

/** Writes a `planNotesUi` result. Existing files are never overwritten. */
export function applyNotesPlan(pluginDir, plan) {
  const written = []
  for (const target of plan.targets) {
    const full = path.resolve(pluginDir, target.path)
    if (!full.startsWith(path.resolve(pluginDir) + path.sep)) throw new Error(`Refusing to write outside the plugin: ${target.path}`)
    if (fs.existsSync(full)) continue
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, target.content)
    written.push(target.path)
  }
  return written
}

/** Convenience wrapper: plan + write. Returns { entry, flavor, written }. */
export function scaffoldNotesUi(args) {
  const plan = planNotesUi(args)
  const written = applyNotesPlan(args.pluginDir, plan)
  return { entry: plan.entry, flavor: plan.flavor, written }
}

/**
 * Resolves a requested UI asset inside the built ui/ folder. Entries are
 * declared plugin-root-relative ("ui/index.html") but served from dist/ui/ —
 * tolerate both "ui/index.html" and "index.html" (also for nested paths such
 * as "ui/assets/index.js"). Returns an absolute file path or null.
 */
export function resolveUiAsset(uiRoot, requested) {
  const root = path.resolve(uiRoot)
  const clean = String(requested ?? "").replace(/\\/g, "/")
  const candidates = clean.startsWith("ui/") ? [clean.slice(3), clean] : [clean, `ui/${clean}`]
  for (const candidate of candidates) {
    const resolved = path.resolve(root, candidate)
    if (resolved.startsWith(root + path.sep) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved
  }
  return null
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
}

/**
 * Styled in-iframe fallback for missing UI assets. Includes a "Create" button
 * that postMessages the preview shell (same-origin) to scaffold the notes UI.
 */
export function uiFallbackHtml({ title, entry, reason, slug }) {
  const name = escapeHtml(title ?? "Plugin")
  const shownEntry = entry ? escapeHtml(entry) : "ui/index.html"
  const isMissing = reason === "missing"
  const headline = isMissing ? "Dashboard UI not found" : "No dashboard UI yet"
  const explanation = isMissing
    ? `The manifest declares <code>${shownEntry}</code>, but that file is not in the built UI output. It may have been deleted, never created, or <code>plugin.json</code> may point at the wrong path.`
    : `This plugin has no <code>ui.entry</code>, so the host would render its standard settings + jobs page. You can scaffold the default notes example to get started.`
  const scaffoldEntry = isMissing && entry ? escapeHtml(entry) : ""
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${headline} — ${name}</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fafafa; color: #18181b; font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { max-width: 440px; padding: 32px; text-align: center; }
      .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: #fff1e6; color: #c2410c; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
      h1 { margin: 14px 0 8px; font-size: 20px; }
      p { margin: 0 0 12px; color: #52525b; }
      code { background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 5px; padding: 1px 5px; font-size: 12.5px; }
      ul { text-align: left; margin: 0 auto 16px; padding-left: 20px; color: #52525b; max-width: 380px; }
      li { margin-bottom: 4px; }
      button { appearance: none; border: 0; border-radius: 8px; background: #18181b; color: #fff; font: 600 13px/1 system-ui, sans-serif; padding: 11px 16px; cursor: pointer; }
      button:hover { background: #27272a; }
      button.hidden { display: none; }
      .hint { font-size: 12px; color: #a1a1aa; margin-top: 14px; }
    </style>
  </head>
  <body>
    <main>
      <span class="badge">${isMissing ? "missing asset" : "no ui.entry"}</span>
      <h1>${headline}</h1>
      <p>${explanation}</p>
      <ul>
        <li>Create <code>${shownEntry}</code> (and any scripts it references) under <code>ui/</code></li>
        <li>Or fix <code>plugin.json</code> so the entry points at a file that exists</li>
        <li>Or use the button below to scaffold the default notes example</li>
      </ul>
      <button id="scaffold" type="button">Create the notes dashboard UI</button>
      <p class="hint">This page replaces the raw "Asset not found" error in the preview.</p>
    </main>
    <script>
      (function () {
        var button = document.getElementById("scaffold")
        var embedded = window.parent && window.parent !== window
        if (!embedded) {
          button.classList.add("hidden")
          return
        }
        button.addEventListener("click", function () {
          window.parent.postMessage({ type: "selldoes:ui-scaffold", slug: ${JSON.stringify(String(slug ?? ""))}, entry: ${JSON.stringify(scaffoldEntry)} }, window.location.origin)
        })
      })()
    </script>
  </body>
</html>
`
}
