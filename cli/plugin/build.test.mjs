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

test("buildPlugin: Node jobs emit a dist/node artifact with external packages and the lockfile", async () => {
  const manifest = {
    slug: "node-plugin",
    name: "Node Plugin",
    description: "test",
    version: "0.1.0",
    entry: "./index.js",
    jobs: [
      { type: "sync", name: "Sync", runtime: "quickjs" },
      { type: "scrape", name: "Scrape", runtime: "node", entry: "./server/scrape.js", timeoutMs: 60_000, memoryMb: 1024 },
    ],
    dependencies: { "fake-lib": "^1.0.0" },
  }
  const root = tempPlugin(manifest, {
    "index.js": "module.exports = { jobs: { sync: { async step() { return { done: true } } } } }\n",
    "server/scrape.js": 'const fake = require("fake-lib")\nmodule.exports = async (input) => fake.scrape(input)\n',
    "package.json": `${JSON.stringify({ name: "node-plugin", private: true, dependencies: { "fake-lib": "^1.0.0" } }, null, 2)}\n`,
    "package-lock.json": `${JSON.stringify({ name: "node-plugin", lockfileVersion: 3, packages: {} }, null, 2)}\n`,
  })
  fs.mkdirSync(path.join(root, "node_modules", "fake-lib"), { recursive: true })
  fs.writeFileSync(
    path.join(root, "node_modules", "fake-lib", "package.json"),
    JSON.stringify({ name: "fake-lib", version: "1.0.0", main: "index.js" }),
  )
  fs.writeFileSync(path.join(root, "node_modules", "fake-lib", "index.js"), "module.exports = { scrape: (input) => ({ scraped: input }) }\n")

  const built = await buildPlugin(root, { outDir: path.join(root, "dist"), zip: true, log: () => {} })
  assert.ok(built.nodeArtifact, "node artifact is reported")
  assert.deepEqual(built.nodeArtifact.jobs.map((job) => job.type), ["scrape"])
  assert.equal(built.nodeArtifact.jobs[0].file, "scrape.cjs")
  assert.equal(built.nodeArtifact.jobs[0].timeoutMs, 60_000)
  assert.equal(built.nodeArtifact.jobs[0].memoryMb, 1024)

  const nodeDir = path.join(built.outDir, "node")
  for (const file of ["scrape.cjs", "artifact.json", "package.json", "package-lock.json"]) {
    assert.ok(fs.existsSync(path.join(nodeDir, file)), `${file} exists`)
  }
  const artifact = JSON.parse(fs.readFileSync(path.join(nodeDir, "artifact.json"), "utf8"))
  assert.equal(artifact.schemaVersion, 1)

  // The Node bundle keeps npm packages external — the image installs them.
  const entry = fs.readFileSync(path.join(nodeDir, "scrape.cjs"), "utf8")
  assert.match(entry, /require\("fake-lib"\)/)
  assert.ok(!entry.includes("scrape: (input) => ({ scraped: input })"), "dependency code is not inlined")

  // The zip carries the artifact next to the QuickJS bundle.
  const { unzipSync } = await import("fflate")
  const entries = Object.keys(unzipSync(fs.readFileSync(built.zipPath)))
  assert.ok(entries.includes("dist/bundle.js"))
  assert.ok(entries.includes("dist/node/scrape.cjs"))
  assert.ok(entries.includes("dist/node/artifact.json"))
  assert.ok(entries.includes("dist/node/package-lock.json"))
})

test("buildPlugin: plugins without Node jobs do not emit dist/node", async () => {
  const root = tempPlugin({ ...JS_MANIFEST, jobs: [{ type: "sync", name: "Sync" }] }, {})
  const built = await buildPlugin(root, { outDir: path.join(root, "dist"), log: () => {} })
  assert.equal(built.nodeArtifact, null)
  assert.ok(!fs.existsSync(path.join(built.outDir, "node")))
})
