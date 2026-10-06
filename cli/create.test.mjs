import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { EXAMPLES, listExamples, resolveExample, scaffoldProject } from "./create.mjs"

/** Isolates the workspace registry (~/.selldoes) so tests never touch the real one. */
function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-create-home-"))
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
  process.env.HOME = home
  process.env.USERPROFILE = home
  return () => {
    if (previous.HOME === undefined) delete process.env.HOME
    else process.env.HOME = previous.HOME
    if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previous.USERPROFILE
  }
}

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-create-"))
  return path.join(root, "my-project")
}

test("example catalog: plugin and theme entries carry UI metadata", () => {
  const plugins = listExamples("plugin")
  const themes = listExamples("theme")
  assert.deepEqual(
    plugins.map((entry) => entry.id),
    ["notes", "react", "blank", "importer", "ai-copy", "delivery", "widget"],
  )
  assert.deepEqual(
    themes.map((entry) => entry.id),
    ["starter", "editorial", "bold", "minimal"],
  )
  assert.equal(plugins.find((entry) => entry.id === "react").ui, "react")
  assert.equal(plugins.find((entry) => entry.id === "blank").ui, "none")
  assert.equal(plugins.find((entry) => entry.id === "importer").ui, "js")
  assert.equal(themes.find((entry) => entry.id === "editorial").ui, "none")
  for (const entry of [...plugins, ...themes]) {
    assert.ok(entry.name.length > 0, `${entry.id} has a name`)
    assert.ok(entry.description.length > 20, `${entry.id} has a description`)
    assert.ok(fs.existsSync(new URL(`../templates/${EXAMPLES.plugin.concat(EXAMPLES.theme).find((e) => e.id === entry.id).dir}`, import.meta.url)), `${entry.id} template exists`)
  }
})

test("resolveExample: explicit ids win, legacy flags pick the old defaults", () => {
  assert.equal(resolveExample("plugin", "importer").dir, "plugin-importer")
  assert.equal(resolveExample("theme", "editorial").dir, "theme-editorial")
  assert.equal(resolveExample("plugin", null, { withUi: false }).id, "blank")
  assert.equal(resolveExample("plugin", null, { uiFlavor: "react" }).id, "react")
  assert.equal(resolveExample("plugin", null, {}).id, "notes")
  assert.equal(resolveExample("theme", null, {}).id, "starter")
  assert.throws(() => resolveExample("plugin", "nope"), /Unknown plugin example "nope"/)
})

test("scaffoldProject: the importer example ships jobs, sections and a status UI", async () => {
  const restore = fakeHome()
  try {
    const dir = tempProject()
    const created = await scaffoldProject({
      kind: "plugin",
      example: "importer",
      dir,
      name: "OTR Importer",
      slug: "otr-importer",
      version: "0.2.0",
      description: "Imports things",
    })
    assert.equal(created.example, "importer")
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"))
    assert.equal(manifest.slug, "otr-importer")
    assert.equal(manifest.name, "OTR Importer")
    assert.ok(manifest.jobs.length >= 4, "declares the import pipeline jobs")
    assert.equal(manifest.dashboardPages[0].sections.some((section) => section.type === "job"), true)
    assert.equal(manifest.ui.entry, "ui/status.html")
    assert.ok(fs.existsSync(path.join(dir, "ui", "status.html")))
    const index = fs.readFileSync(path.join(dir, "index.js"), "utf8")
    assert.match(index, /import-products/)
    assert.match(index, /ctx\.products\.upsertBySku/)
  } finally {
    restore()
  }
})

test("scaffoldProject: blank has no UI, React swaps in the TSX dashboard", async () => {
  const restore = fakeHome()
  try {
    const blankDir = tempProject()
    await scaffoldProject({ kind: "plugin", example: "blank", dir: blankDir, name: "Blank" })
    assert.equal(fs.existsSync(path.join(blankDir, "ui")), false)
    const blankManifest = JSON.parse(fs.readFileSync(path.join(blankDir, "plugin.json"), "utf8"))
    assert.equal(blankManifest.ui, undefined)
    assert.equal(blankManifest.dashboardPages, undefined)

    const reactDir = tempProject()
    await scaffoldProject({ kind: "plugin", example: "react", dir: reactDir, name: "Reacted" })
    assert.ok(fs.existsSync(path.join(reactDir, "ui", "src")))
    const pkg = JSON.parse(fs.readFileSync(path.join(reactDir, "package.json"), "utf8"))
    assert.ok(pkg.dependencies.react)
  } finally {
    restore()
  }
})

test("scaffoldProject: theme examples replace the starter pages", async () => {
  const restore = fakeHome()
  try {
    const dir = tempProject()
    const created = await scaffoldProject({ kind: "theme", example: "editorial", dir, name: "Editorial" })
    assert.equal(created.example, "editorial")
    const home = fs.readFileSync(path.join(dir, "src", "home.tsx"), "utf8")
    assert.match(home, /Georgia/, "uses the editorial type")
    assert.ok(fs.existsSync(path.join(dir, "manifest.json")))
  } finally {
    restore()
  }
})
