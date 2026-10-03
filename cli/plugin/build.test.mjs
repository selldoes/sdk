import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { buildPlugin } from "./build.mjs"

function tempPlugin(manifest, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-build-"))
  fs.writeFileSync(path.join(root, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(path.join(root, "index.js"), "module.exports = { apiRoutes: {} }\n")
  for (const [relative, content] of Object.entries(files ?? {})) {
    const full = path.join(root, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

const JS_MANIFEST = {
  slug: "demo-plugin",
  name: "Demo Plugin",
  description: "test",
  version: "0.1.0",
  entry: "./index.js",
  ui: { entry: "ui/index.html" },
  dashboardPages: [
    { label: "Demo Plugin", path: "/", entry: "ui/index.html" },
    { label: "About", path: "/about", entry: "ui/about.html" },
  ],
}

test("buildPlugin (js): multi-page entries land in dist/ui", async () => {
  const root = tempPlugin(JS_MANIFEST, {
    "ui/index.html": "<html><script src=\"app.js\"></script></html>",
    "ui/app.js": "console.log('notes')",
    "ui/app.css": "body{}",
    "ui/about.html": "<html>about</html>",
  })
  const built = await buildPlugin(root, { outDir: path.join(root, "dist"), log: () => {} })
  const ui = path.join(built.outDir, "ui")
  assert.ok(fs.existsSync(path.join(ui, "index.html")))
  assert.ok(fs.existsSync(path.join(ui, "about.html")))
  assert.ok(fs.existsSync(path.join(ui, "app.js")))
  assert.ok(fs.existsSync(path.join(ui, "bundle.js")) === false)
  assert.ok(fs.existsSync(path.join(built.outDir, "bundle.js")))
})

test("buildPlugin (bundled): ui/src/<name>.tsx → ui/assets/<name>.js + generated shells", async () => {
  const manifest = {
    slug: "react-plugin",
    name: "React Plugin",
    description: "test",
    version: "0.1.0",
    entry: "./index.js",
    dashboardPages: [
      { label: "Home", path: "/", entry: "ui/index.html" },
      { label: "Reports", path: "/reports", entry: "ui/reports/summary.html" },
    ],
  }
  const root = tempPlugin(manifest, {
    // No ui/index.html on purpose — the build generates the shell.
    "ui/src/index.tsx": "import './styles.css'\nexport default function App() { return null }\n",
    "ui/src/styles.css": "body { color: red }\n",
    "ui/src/reports/summary.tsx": "export default function Summary() { return null }\n",
  })
  const built = await buildPlugin(root, { outDir: path.join(root, "dist"), log: () => {} })
  const ui = path.join(built.outDir, "ui")

  // Bundles
  assert.ok(fs.existsSync(path.join(ui, "assets", "index.js")))
  assert.ok(fs.existsSync(path.join(ui, "assets", "index.css")), "css imports are emitted next to the bundle")
  assert.ok(fs.existsSync(path.join(ui, "assets", "reports-summary.js")))

  // Generated shells point at the right bundles
  const home = fs.readFileSync(path.join(ui, "index.html"), "utf8")
  assert.match(home, /assets\/index\.js/)
  const summary = fs.readFileSync(path.join(ui, "reports", "summary.html"), "utf8")
  assert.match(summary, /assets\/reports-summary\.js/)

  // ui/src is never copied raw into the output
  assert.ok(!fs.existsSync(path.join(ui, "src")))
})

test("buildPlugin: entries outside ui/ are skipped with a warning", async () => {
  const manifest = { ...JS_MANIFEST, ui: { entry: "pages/home.html" }, dashboardPages: [] }
  const root = tempPlugin(manifest, { "pages/home.html": "<html></html>" })
  const warnings = []
  const built = await buildPlugin(root, { outDir: path.join(root, "dist"), log: (line) => warnings.push(String(line)) })
  assert.ok(warnings.some((line) => line.includes("outside ui/")))
  assert.ok(!fs.existsSync(path.join(built.outDir, "ui", "pages")))
})

test("buildPlugin: declared ui entries without ui/ do not crash the build", async () => {
  const root = tempPlugin(JS_MANIFEST, {})
  const warnings = []
  const built = await buildPlugin(root, { outDir: path.join(root, "dist"), log: (line) => warnings.push(String(line)) })
  assert.ok(warnings.some((line) => line.includes("ui/ does not exist")))
  assert.ok(fs.existsSync(path.join(built.outDir, "bundle.js")))
})
