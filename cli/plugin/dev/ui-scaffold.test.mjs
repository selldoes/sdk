import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { applyNotesPlan, detectUiFlavor, normalizePageEntry, planNotesUi, resolveUiAsset, uiFallbackHtml } from "./ui-scaffold.mjs"

function tempPlugin({ react = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-ui-scaffold-"))
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    JSON.stringify({ slug: "demo-plugin", name: "Demo Plugin", ui: { entry: "ui/index.html" } }, null, 2),
  )
  if (react) {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" } }))
  }
  return root
}

test("normalizePageEntry accepts plugin-root-relative ui entries", () => {
  assert.equal(normalizePageEntry("ui/index.html"), "ui/index.html")
  assert.equal(normalizePageEntry("./ui/settings.html"), "ui/settings.html")
  assert.equal(normalizePageEntry("ui\\reports\\summary.HTML"), "ui/reports/summary.HTML")
  assert.equal(normalizePageEntry(undefined, "ui/index.html"), "ui/index.html")
  assert.equal(normalizePageEntry("", "ui/about.html"), "ui/about.html")
})

test("normalizePageEntry rejects escapes and non-html paths", () => {
  assert.throws(() => normalizePageEntry("../secret.html"), /under ui\//)
  assert.throws(() => normalizePageEntry("ui/../../secret.html"), /under ui\//)
  assert.throws(() => normalizePageEntry("/etc/passwd.html"), /under ui\//)
  assert.throws(() => normalizePageEntry("pages/home.html"), /under ui\//)
  assert.throws(() => normalizePageEntry("ui/app.js"), /\.html files/)
})

test("detectUiFlavor: react dependency or TSX sources win", () => {
  assert.equal(detectUiFlavor(tempPlugin()), "js")
  assert.equal(detectUiFlavor(tempPlugin({ react: true })), "react")
  const tsx = tempPlugin()
  fs.mkdirSync(path.join(tsx, "ui", "src"), { recursive: true })
  fs.writeFileSync(path.join(tsx, "ui", "src", "index.tsx"), "export default null\n")
  assert.equal(detectUiFlavor(tsx), "react")
})

test("planNotesUi (js): notes example for the root page", () => {
  const root = tempPlugin()
  const plan = planNotesUi({ pluginDir: root, entry: "ui/index.html" })
  assert.equal(plan.flavor, "js")
  assert.equal(plan.isRoot, true)
  assert.deepEqual(plan.files, ["ui/index.html", "ui/app.js", "ui/app.css"])
  const written = applyNotesPlan(root, plan)
  assert.deepEqual(written, plan.files)
  const html = fs.readFileSync(path.join(root, "ui", "index.html"), "utf8")
  assert.match(html, /Demo Plugin/)
  assert.match(html, /app\.js/)
  const app = fs.readFileSync(path.join(root, "ui", "app.js"), "utf8")
  assert.match(app, /demo-plugin/)
  // Existing files are never overwritten; a second pass writes nothing.
  fs.writeFileSync(path.join(root, "ui", "index.html"), "custom\n")
  assert.deepEqual(applyNotesPlan(root, plan), [])
  assert.equal(fs.readFileSync(path.join(root, "ui", "index.html"), "utf8"), "custom\n")
})

test("planNotesUi (js): secondary page shares app.js/app.css", () => {
  const root = tempPlugin()
  const plan = planNotesUi({ pluginDir: root, entry: "ui/about.html" })
  assert.equal(plan.isRoot, false)
  assert.deepEqual(plan.files, ["ui/about.html", "ui/app.js", "ui/app.css"])
  applyNotesPlan(root, plan)
  const html = fs.readFileSync(path.join(root, "ui", "about.html"), "utf8")
  assert.match(html, /app\.js/)
})

test("planNotesUi (react): bundles via ui/src/<name>.tsx → assets/<name>.js", () => {
  const root = tempPlugin({ react: true })
  const plan = planNotesUi({ pluginDir: root, entry: "ui/settings.html" })
  assert.equal(plan.flavor, "react")
  assert.deepEqual(plan.files, ["ui/settings.html", "ui/src/settings.tsx", "ui/src/styles.css"])
  applyNotesPlan(root, plan)
  const html = fs.readFileSync(path.join(root, "ui", "settings.html"), "utf8")
  assert.match(html, /assets\/settings\.js/)
  const source = fs.readFileSync(path.join(root, "ui", "src", "settings.tsx"), "utf8")
  assert.match(source, /demo-plugin/)
  assert.match(source, /Demo Plugin/)
})

test("planNotesUi (react): root page uses the template entry", () => {
  const root = tempPlugin({ react: true })
  const plan = planNotesUi({ pluginDir: root })
  assert.deepEqual(plan.files, ["ui/index.html", "ui/src/index.tsx", "ui/src/styles.css"])
  applyNotesPlan(root, plan)
  const html = fs.readFileSync(path.join(root, "ui", "index.html"), "utf8")
  assert.match(html, /assets\/index\.js/)
})

test("resolveUiAsset: ui/index.html entry maps onto dist/ui/index.html", () => {
  const uiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-ui-dist-"))
  fs.mkdirSync(path.join(uiRoot, "assets"), { recursive: true })
  fs.writeFileSync(path.join(uiRoot, "index.html"), "<html></html>")
  fs.writeFileSync(path.join(uiRoot, "assets", "index.js"), "export {}\n")

  assert.equal(resolveUiAsset(uiRoot, "ui/index.html"), path.join(uiRoot, "index.html"))
  assert.equal(resolveUiAsset(uiRoot, "index.html"), path.join(uiRoot, "index.html"))
  assert.equal(resolveUiAsset(uiRoot, "ui/assets/index.js"), path.join(uiRoot, "assets", "index.js"))
  assert.equal(resolveUiAsset(uiRoot, "assets/index.js"), path.join(uiRoot, "assets", "index.js"))
  assert.equal(resolveUiAsset(uiRoot, "ui/missing.html"), null)
  assert.equal(resolveUiAsset(uiRoot, "../plugin.json"), null)
  assert.equal(resolveUiAsset(uiRoot, "ui/../../plugin.json"), null)
})

test("uiFallbackHtml: friendly page with a scaffold postMessage button", () => {
  const html = uiFallbackHtml({ title: "Demo <Plugin>", entry: "ui/index.html", reason: "missing", slug: "demo-plugin" })
  assert.match(html, /Dashboard UI not found/)
  assert.match(html, /ui\/index\.html/)
  assert.match(html, /selldoes:ui-scaffold/)
  assert.match(html, /Demo &lt;Plugin&gt;/)
  assert.doesNotMatch(html, /Asset .* not found/)
  const bare = uiFallbackHtml({ title: "Demo", entry: null, reason: "no-ui", slug: "demo-plugin" })
  assert.match(bare, /No dashboard UI yet/)
})
