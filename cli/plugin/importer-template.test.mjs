import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { buildPlugin } from "./build.mjs"

const TEMPLATE = fileURLToPath(new URL("../../templates/plugin-importer/", import.meta.url))

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(src, dest)
    else fs.copyFileSync(src, dest)
  }
}

/**
 * The importer is the flagship example template — it must bundle and load in
 * the sandbox after every refactor. Built from a temp copy so the build's
 * generated `dist/` + `ui/kit/` never dirty the template in the repo.
 */
test("plugin-importer template builds and loads in the sandbox", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-importer-"))
  copyDir(TEMPLATE, dir)
  try {
    const out = await buildPlugin(dir, { log: () => {} })
    assert.deepEqual(out.sandbox.errors, [])
    assert.equal(out.sandbox.ok, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
