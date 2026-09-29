#!/usr/bin/env node

import { readFile, writeFile, mkdir, readdir, copyFile, rm, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import http from "node:http"
import { createRequire } from "node:module"
import { unzipSync, zipSync, strFromU8 } from "fflate"

const require = createRequire(import.meta.url)
const esbuild = require("esbuild")

const PACKAGE_NAME = "selldoes/theme"
const CONFIG_PATH = path.join(os.homedir(), ".selldoes.json")
const PAGE_TYPES = ["home", "product", "category", "search", "cart", "checkout", "thankyou", "login", "profile", "pages", "wishlist", "error"]

let FLAGS = {}
let ARGS = []

function flag(name, fallback = undefined) {
  const value = FLAGS[name]
  return value === undefined ? fallback : value
}
function hasFlag(name) {
  return FLAGS[name] === true
}

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8"))
  } catch {
    return {}
  }
}
async function saveConfig(cfg) {
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8")
}

function apiKey() {
  return flag("api-key") || process.env.SELLDOES_API_KEY || null
}
function baseUrl() {
  return flag("base") || process.env.SELLDOES_BASE || "http://selldoes.localhost:9582"
}

async function api(pathname, options = {}, key = apiKey()) {
  const base = baseUrl().replace(/\/$/, "")
  const res = await fetch(base + pathname, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(key ? { "x-api-key": key } : {}),
    },
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (!res.ok) {
    const msg = data && typeof data === "object" && data.error ? data.error : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

function log(msg) {
  console.log(msg)
}
function fail(msg) {
  console.error("Error: " + msg)
  process.exit(1)
}

async function findSrcPages() {
  // Custom page types declared in manifest.json take precedence — they become
  // storefront routes (/store/<slug>/<pageType>) and customizer tabs.
  const manifest = await readManifest()
  const declared = Object.keys(manifest.pages || {})
  if (declared.length > 0) {
    const existing = declared.filter((p) => existsSync(path.resolve("src", `${p}.tsx`)) || existsSync(path.resolve("src", `${p}.jsx`)))
    if (existing.length > 0) return existing
  }
  const srcDir = path.resolve("src")
  if (!existsSync(srcDir)) return []
  const files = readdirSyncSafe(srcDir)
  return files
    .filter((f) => /\.(tsx|jsx|ts|js)$/.test(f))
    .map((f) => f.replace(/\.(tsx|jsx|ts|js)$/, ""))
    .filter((name) => PAGE_TYPES.includes(name))
}
function readdirSyncSafe(dir) {
  try {
    return require("node:fs").readdirSync(dir)
  } catch {
    return []
  }
}

async function generateEntries(pages) {
  const entriesDir = path.resolve(".selldoes/entries")
  await mkdir(entriesDir, { recursive: true })
  for (const page of pages) {
    const srcFile = path.resolve("src", `${page}.tsx`)
    if (!existsSync(srcFile)) continue
    const entry = [
      `import React from "react"`,
      `import { createRoot } from "react-dom/client"`,
      `import { createStorefrontBridge, SDKProvider } from "${PACKAGE_NAME}"`,
      `import Page from ${JSON.stringify(srcFile)}`,
      `async function mount() {`,
      `  try {`,
      `    const bridge = await createStorefrontBridge()`,
      `    const root = document.getElementById("root")`,
      `    createRoot(root).render(React.createElement(SDKProvider, { bridge }, React.createElement(Page)))`,
      `  } catch (err) {`,
      `    document.getElementById("root").textContent = "Bridge failed: " + err.message`,
      `  }`,
      `}`,
      `mount()`,
    ].join("\n")
    await writeFile(path.join(entriesDir, `${page}.mjs`), entry, "utf8")
  }
}

async function bundle(pages, outdir, minify) {
  const entries = {}
  for (const page of pages) {
    entries[page] = path.resolve(".selldoes/entries", `${page}.mjs`)
  }
  const ctx = await esbuild.context({
    entryPoints: entries,
    outbase: path.resolve(".selldoes/entries"),
    outdir,
    bundle: true,
    splitting: true,
    format: "esm",
    jsx: "automatic",
    loader: { ".tsx": "jsx", ".jsx": "jsx", ".ts": "ts" },
    platform: "browser",
    target: "es2020",
    minify,
    sourcemap: false,
    logLevel: "warning",
  })
  return ctx
}

async function readManifest() {
  try {
    return JSON.parse(await readFile("manifest.json", "utf8"))
  } catch {
    return {}
  }
}

async function writeManifest(pages) {
  const existing = await readManifest()
  const pagesConfig = {}
  for (const page of pages) pagesConfig[page] = { custom: true, entry: `pages/${page}.js` }
  const manifest = {
    name: existing.name || "My Selldoes Template",
    version: existing.version || "1.0.0",
    apiVersion: "1",
    mode: existing.mode || "full-page",
    pages: { ...(existing.pages || {}), ...pagesConfig },
    shell: existing.shell || { hideToolbar: true, hideHeader: true, hideFooter: true },
  }
  await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2), "utf8")
  return manifest
}

async function copyOptionalFiles() {
  for (const f of ["sections.json", "theme.json", "preview.png", "preview.jpg", "preview.webp"]) {
    if (existsSync(f)) await copyFile(f, path.join("dist", f))
  }
  if (existsSync("public")) {
    const files = readdirSyncSafe("public")
    for (const f of files) {
      await copyFile(path.join("public", f), path.join("dist", f))
    }
  }
}

async function buildCommand() {
  const pages = await findSrcPages()
  if (pages.length === 0) fail("No src/<pageType>.tsx files found. Create one, e.g. src/home.tsx")
  await rm("dist", { recursive: true, force: true })
  await mkdir("dist/pages", { recursive: true })
  await generateEntries(pages)
  const ctx = await bundle(pages, path.resolve("dist/pages"), true)
  try {
    await ctx.rebuild()
  } finally {
    await ctx.dispose()
  }
  await writeManifest(pages)
  await copyOptionalFiles()
  for (const page of pages) {
    if (!existsSync(path.join("dist/pages", `${page}.js`))) fail(`Build did not produce dist/pages/${page}.js`)
  }
  log(`Built ${pages.length} page(s) → dist/`)
}

async function devCommand() {
  const slug = flag("store") || (await loadConfig()).defaultStoreSlug
  if (!slug) fail("No store slug. Run `selldoes login` first or pass --store <slug>")
  const port = Number(flag("port", "4173"))
  const pages = await findSrcPages()
  if (pages.length === 0) fail("No src/<pageType>.tsx files found")

  await rm(".selldoes/dev", { recursive: true, force: true })
  await mkdir(".selldoes/dev/pages", { recursive: true })
  await generateEntries(pages)
  const ctx = await bundle(pages, path.resolve(".selldoes/dev/pages"), false)
  await ctx.watch()

  const base = baseUrl().replace(/\/$/, "")
  let initPayload = null
  try {
    const data = await fetch(`${base}/api/store/${slug}/sections`).then((r) => r.json())
    initPayload = data
  } catch {
    initPayload = { store: { name: slug, slug }, sections: {}, theme: {} }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    if (url.pathname === "/proxy") {
      const target = url.searchParams.get("url")
      if (!target || !target.startsWith("/api/store/")) {
        res.writeHead(403)
        res.end("blocked")
        return
      }
      try {
        const r = await fetch(base + target, {
          method: req.method,
          headers: { "content-type": req.headers["content-type"] || "" },
          body: req.method === "GET" ? undefined : req,
        })
        const text = await r.text()
        res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json" })
        res.end(text)
      } catch {
        res.writeHead(502)
        res.end("proxy error")
      }
      return
    }
    if (url.pathname === "/" || url.pathname === "/preview") {
      res.writeHead(200, { "content-type": "text/html" })
      res.end(previewHtml(slug, pages, JSON.stringify(initPayload)))
      return
    }
    if (url.pathname === "/page") {
      res.writeHead(200, { "content-type": "text/html" })
      res.end(frameHtml())
      return
    }
    if (url.pathname.startsWith("/dev/")) {
      const file = path.resolve(".selldoes/dev", url.pathname.slice(5))
      if (!file.startsWith(path.resolve(".selldoes/dev"))) {
        res.writeHead(403)
        res.end()
        return
      }
      try {
        const data = await readFile(file)
        res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "application/octet-stream" })
        res.end(data)
      } catch {
        res.writeHead(404)
        res.end("not found")
      }
      return
    }
    res.writeHead(404)
    res.end()
  })

  server.listen(port, () => {
    log(`Selldoes template dev server → http://localhost:${port}`)
    log(`Store: /${slug} · pages: ${pages.join(", ")}`)
    log("Hot reload is active. Edit src/*.tsx to see changes.")
  })
}

function previewHtml(slug, pages, initPayloadJson) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Selldoes template preview — ${slug}</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; }
  #toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #0f172a; color: #fff; }
  #toolbar strong { font-size: 13px; margin-right: 8px; }
  #toolbar button { background: #1e293b; color: #fff; border: 1px solid #334155; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
  #toolbar button.active { background: #2563eb; border-color: #2563eb; }
  #toolbar a { color: #93c5fd; font-size: 12px; margin-left: auto; text-decoration: none; }
  #frame { width: 100%; height: calc(100dvh - 38px); border: 0; }
</style>
</head>
<body>
<div id="toolbar">
  <strong>Selldoes · ${slug}</strong>
  ${pages.map((p) => `<button data-page="${p}">${p}</button>`).join("")}
  <a target="_blank" href="/store/${slug}">Open live store ↗</a>
</div>
<iframe id="frame" sandbox="allow-scripts" src="/page?page=${pages[0]}"></iframe>
<script>
  var INIT_PAYLOAD = ${initPayloadJson};
  var iframe = document.getElementById("frame");
  document.querySelectorAll("#toolbar button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      iframe.src = "/page?page=" + btn.dataset.page;
      document.querySelectorAll("#toolbar button").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
    });
  });
  window.addEventListener("message", function (event) {
    var d = event.data || {};
    if (d.source !== "selldesk") return;
    if (d.type === "ready") {
      iframe.contentWindow.postMessage({ source: "selldesk", type: "init", payload: INIT_PAYLOAD }, "*");
    } else if (d.type === "fetch") {
      fetch("/proxy?url=" + encodeURIComponent(d.url), {
        method: d.method || "GET",
        headers: d.headers || {},
        body: d.body
      })
        .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, data: t }; }); })
        .catch(function () { return { ok: false, status: 0, data: null }; })
        .then(function (result) {
          iframe.contentWindow.postMessage({ source: "selldesk", type: "fetch:result", id: d.id, ok: result.ok, status: result.status, data: result.data }, "*");
        });
    }
  });
</script>
</body>
</html>`
}

function frameHtml() {
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><style>body{margin:0}#root{min-height:100dvh}</style></head>
<body>
<div id="root"></div>
<script type="module">
  var page = new URLSearchParams(location.search).get("page") || "home";
  import("/dev/" + page + ".js").catch(function (err) {
    document.getElementById("root").textContent = "Build error: " + err.message;
  });
</script>
</body>
</html>`
}

async function uploadCommand() {
  if (!existsSync("dist/manifest.json")) {
    log("dist/ not built yet — running build first...")
    await buildCommand()
  }
  const key = apiKey()
  if (!key) fail("No API key. Run `selldoes login --api-key sk_...`")
  const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"))

  async function collect(dir, base, out = {}) {
    const items = await readdir(dir, { withFileTypes: true })
    for (const item of items) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) await collect(full, path.join(base, item.name), out)
      else out[path.join(base, item.name).replace(/\\/g, "/")] = new Uint8Array(await readFile(full))
    }
    return out
  }
  const files = await collect("dist", "")

  const state = await loadState()
  const form = new FormData()
  form.append("file", new Blob([zipSync(files, { level: 9 })], { type: "application/zip" }), "template.zip")
  form.append("name", manifest.name || "")
  if (state.templateId) form.append("templateId", state.templateId)
  if (hasFlag("public")) form.append("isPublic", "true")

  log(`Uploading ${Object.keys(files).length} file(s) as "${manifest.name}"...`)
  const result = await api("/api/templates/upload", { method: "POST", body: form }, key)
  await saveState({ templateId: result.id })
  log(`Uploaded → ${result.id} (${result.status}, version ${result.version})`)
  const entryUrl = Object.entries(result.entries || {}).find(([p]) => p.startsWith("pages/"))
  if (entryUrl) log(`Entry: ${entryUrl[1]}`)
  log("Apply it to a store with:  selldoes apply --store <slug>")
}

async function applyCommand() {
  const key = apiKey()
  if (!key) fail("No API key. Run `selldoes login --api-key sk_...`")
  const state = await loadState()
  const templateId = flag("template") || state.templateId
  if (!templateId) fail("No template uploaded yet — run `selldoes upload` first")
  const slug = flag("store") || (await loadConfig()).defaultStoreSlug
  if (!slug) fail("No store slug. Use --store <slug>")

  const me = await api("/api/templates/me", {}, key)
  const store = (me.stores || []).find((s) => s.slug === slug)
  if (!store) fail(`Store "/${slug}" not found on this account`)
  await api(`/api/templates/${templateId}/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storeId: store.id }),
  }, key)
  log(`Applied ${templateId} → /store/${slug}`)
}

async function loginCommand() {
  const key = apiKey()
  if (!key) fail("Provide an API key: selldoes login --api-key sk_...")
  const me = await api("/api/templates/me", {}, key)
  const cfg = await loadConfig()
  cfg.apiKey = key
  cfg.baseUrl = baseUrl()
  cfg.defaultStoreSlug = me.stores?.[0]?.slug || null
  await saveConfig(cfg)
  log(`Logged in as user ${me.userId}`)
  log(`Stores: ${(me.stores || []).map((s) => `/${s.slug}`).join(", ") || "none"}`)
  if (me.stores?.length > 0) log(`Dev store: /${cfg.defaultStoreSlug} (change with --store <slug>)`)
}

async function logoutCommand() {
  await saveConfig({})
  log("Logged out.")
}

async function whoamiCommand() {
  const key = apiKey()
  if (!key) fail("Not logged in (no API key found). Run `selldoes login --api-key sk_...`")
  const me = await api("/api/templates/me", {}, key)
  log(`User ${me.userId} · stores: ${(me.stores || []).map((s) => `/${s.slug}`).join(", ") || "none"}`)
}

async function loadState() {
  try {
    return JSON.parse(await readFile(".selldoes/template.json", "utf8"))
  } catch {
    return {}
  }
}
async function saveState(state) {
  await mkdir(".selldoes", { recursive: true })
  await writeFile(".selldoes/template.json", JSON.stringify(state, null, 2), "utf8")
}

async function initCommand() {
  const templateId = ARGS[0]
  if (!templateId) fail("Pass a template id — or run `selldoes create --theme` to scaffold a new theme")
  const key = apiKey()
  if (!key) fail("No API key. Run `selldoes login --api-key sk_...` first (needed to download templates)")
  log(`Downloading template ${templateId}...`)
  const res = await fetch(`${baseUrl().replace(/\/$/, "")}/api/templates/${templateId}/download`, {
    headers: { "x-api-key": key },
  })
  if (!res.ok) fail(`Download failed (${res.status})`)
  const zip = new Uint8Array(await res.arrayBuffer())
  const files = unzipSync(zip)
  for (const [name, data] of Object.entries(files)) {
    await mkdir(path.dirname(name), { recursive: true })
    await writeFile(name, strFromU8(data), "utf8")
  }
  log(`Template ${templateId} scaffolded into ./`)
  log("Next: npm install && selldoes dev --store <slug>")
}

function help() {
  log(`
Selldoes themes — build storefront themes locally, publish with one command.

Usage:
  selldoes create --theme             Scaffold a new theme project
  selldoes login --api-key sk_...     Authenticate with an API key (Dashboard → Settings → API Keys)
  selldoes logout                     Remove saved credentials
  selldoes whoami                     Show the connected account + stores
  selldoes dev [--store <slug>]       Live preview against a real store (hot reload)
  selldoes build                      Bundle src/*.tsx → dist/ + manifest
  selldoes validate                   Check manifest.json and page entries
  selldoes publish [--public]         Build + upload dist/ to Selldoes
  selldoes apply --store <slug>       Apply the uploaded theme to a store
  selldoes init <template-id>         Download an existing theme as a local project

Flags:
  --base <url>       Selldoes base URL (default http://selldoes.localhost:9582)
  --api-key <key>    API key (or SELLDOES_API_KEY env var)
`)
}

async function validateCommand() {
  const manifest = await readManifest()
  if (!manifest || Object.keys(manifest).length === 0) fail("manifest.json not found or invalid")
  const pages = await findSrcPages()
  if (pages.length === 0) fail("No src/<pageType>.tsx files found")
  const declared = Object.keys(manifest.pages || {})
  for (const page of declared) {
    if (!pages.includes(page)) log(`  ! ${page} is declared in manifest.json but has no src/${page}.tsx`)
  }
  log(`✓ ${manifest.name || "theme"}@${manifest.version || "0.0.0"} — ${pages.length} page(s): ${pages.join(", ")}`)
}

export async function themeCommand(command, args, flags = {}) {
  FLAGS = flags || {}
  ARGS = args || []
  try {
    switch (command) {
      case "login": return await loginCommand()
      case "logout": return await logoutCommand()
      case "whoami": return await whoamiCommand()
      case "init": return await initCommand()
      case "dev": return await devCommand()
      case "build": return await buildCommand()
      case "publish": await buildCommand(); return await uploadCommand()
      case "upload": return await uploadCommand()
      case "apply": return await applyCommand()
      case "validate": return await validateCommand()
      default: help()
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}
