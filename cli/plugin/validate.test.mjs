import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { validatePluginDir } from "./validate.mjs"

function tempPlugin(manifest, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-validate-"))
  fs.writeFileSync(path.join(root, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(path.join(root, "index.js"), "module.exports = {}\n")
  for (const [relative, content] of Object.entries(files ?? {})) {
    const full = path.join(root, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

const BASE = { slug: "demo-plugin", name: "Demo", description: "test", version: "0.1.0", entry: "./index.js" }

test("dashboardPages: entries must exist, paths must be unique and start with /", () => {
  const root = tempPlugin(
    {
      ...BASE,
      ui: { entry: "ui/index.html" },
      dashboardPages: [
        { label: "Home", path: "/", entry: "ui/index.html" },
        { label: "Home again", path: "/", entry: "ui/index.html" },
        { label: "Missing", path: "/missing", entry: "ui/missing.html" },
        { label: "Bad path", path: "about", entry: "ui/about.html" },
        { path: "/nolabel" },
      ],
    },
    { "ui/index.html": "<html></html>", "ui/about.html": "<html></html>" },
  )
  const { errors } = validatePluginDir(root)
  assert.ok(errors.some((error) => error.includes('duplicate dashboardPages path "/"')), errors.join("\n"))
  assert.ok(errors.some((error) => error.includes('dashboardPages "/missing" entry "ui/missing.html" does not exist')))
  assert.ok(errors.some((error) => error.includes('dashboardPages path "about" must start with /')))
  assert.ok(errors.some((error) => error.includes('dashboardPages "/nolabel" needs a label')))
  // The valid first page is not flagged — exactly the four errors above.
  assert.equal(errors.length, 4, errors.join("\n"))
})

test("dashboardPages: a fully valid multi-page manifest validates clean", () => {
  const root = tempPlugin(
    {
      ...BASE,
      ui: { entry: "ui/index.html" },
      dashboardPages: [
        { label: "Home", path: "/", entry: "ui/index.html" },
        { label: "About", path: "/about", entry: "ui/about.html" },
        { label: "Fallback", path: "/fallback" },
      ],
    },
    { "ui/index.html": "<html></html>", "ui/about.html": "<html></html>" },
  )
  const { errors } = validatePluginDir(root)
  assert.deepEqual(errors, [])
})

test("ui.entry still must exist (dashboard UI without its file is an error)", () => {
  const root = tempPlugin({ ...BASE, ui: { entry: "ui/index.html" } })
  const { errors } = validatePluginDir(root)
  assert.ok(errors.some((error) => error.includes('ui.entry "ui/index.html" does not exist')))
})
