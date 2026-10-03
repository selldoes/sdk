import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { buildPlugin, packPluginSource } from "./build.mjs"
import {
  collectBundledPackages,
  collectExternals,
  collectImportedPackages,
  evaluateBundle,
  SANDBOX_LIMITS,
} from "./sandbox.mjs"

function tempPlugin(manifest, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-sandbox-"))
  fs.writeFileSync(path.join(root, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [relative, content] of Object.entries(files ?? {})) {
    const full = path.join(root, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

const BASE = { slug: "sandbox-plugin", name: "Sandbox", description: "test", version: "0.1.0", entry: "./index.js" }

/** A local package that uses the allow-listed `events` builtin. */
function fakeEventsPackage(root) {
  fs.mkdirSync(path.join(root, "node_modules", "fake-events"), { recursive: true })
  fs.writeFileSync(
    path.join(root, "node_modules", "fake-events", "package.json"),
    JSON.stringify({ name: "fake-events", version: "1.0.0", main: "index.js" }),
  )
  fs.writeFileSync(
    path.join(root, "node_modules", "fake-events", "index.js"),
    'const { EventEmitter } = require("events")\nmodule.exports = { make: () => new EventEmitter() }\n',
  )
}

test("metafile helpers: externals, bundled and imported packages", () => {
  const metafile = {
    inputs: {
      "index.js": {
        imports: [
          { path: "node_modules/fake-events/index.js", external: false },
          { path: "../../sdk/cli/plugin/sandbox/globals.js", external: true },
          { path: "C:\\sdk\\node_modules\\@jspm\\core\\nodelibs\\browser\\buffer.js", external: true },
        ],
      },
      "node_modules/fake-events/index.js": {
        imports: [{ path: "node_modules/@jspm/core/nodelibs/browser/events.js", external: false }],
      },
      "../../sdk/cli/plugin/sandbox/buffer-global.js": {
        imports: [{ path: "../../sdk/node_modules/@jspm/core/nodelibs/browser/buffer.js", external: false }],
      },
    },
  }
  assert.deepEqual(collectImportedPackages(metafile), ["fake-events"])
  // Bundled packages come from the input keys, not import records.
  assert.deepEqual(collectBundledPackages(metafile), ["fake-events"])
  assert.deepEqual(collectExternals(metafile), [])
})

test("buildPlugin: a declared local package using an allow-listed builtin bundles cleanly", async () => {
  const root = tempPlugin(
    { ...BASE, dependencies: { "fake-events": "^1.0.0" } },
    { "index.js": 'const fake = require("fake-events")\nmodule.exports = { apiRoutes: {}, hooks: {} }\n' },
  )
  fakeEventsPackage(root)
  const built = await buildPlugin(root, { outDir: path.join(root, "dist"), log: () => {} })
  assert.equal(built.sandbox.ok, true, built.sandbox.errors.join("\n"))
  assert.ok(built.sandbox.packages.includes("fake-events"))
  assert.deepEqual(built.sandbox.externals, [])
  assert.equal(built.sandbox.load.ok, true)
})

test("buildPlugin: importing a package without declaring it fails the sandbox check", async () => {
  const root = tempPlugin(
    { ...BASE },
    { "index.js": 'const fake = require("fake-events")\nmodule.exports = { apiRoutes: {} }\n' },
  )
  fakeEventsPackage(root)
  await assert.rejects(
    () => buildPlugin(root, { outDir: path.join(root, "dist"), log: () => {} }),
    /fake-events.*not declared/,
  )
})

test("buildPlugin: blocked Node builtins fail with an actionable error", async () => {
  const root = tempPlugin({ ...BASE }, { "index.js": 'const fs = require("fs")\nmodule.exports = { apiRoutes: {} }\n' })
  await assert.rejects(
    () => buildPlugin(root, { outDir: path.join(root, "dist"), log: () => {} }),
    /not available in the Selldoes sandbox/,
  )
})

test("evaluateBundle: reports a require() leak instead of throwing", () => {
  const file = path.join(os.tmpdir(), `selldoes-eval-${Date.now()}.cjs`)
  fs.writeFileSync(file, 'const missing = require("definitely-not-real")\nmodule.exports = {}\n')
  const result = evaluateBundle(file)
  assert.equal(result.ok, false)
  assert.match(result.error, /require is not defined|definitely-not-real/)
  fs.rmSync(file, { force: true })
})

test("packPluginSource: includes the prebuilt bundle at dist/bundle.js", async () => {
  const root = tempPlugin(
    { ...BASE, dependencies: { "fake-events": "^1.0.0" } },
    { "index.js": 'const fake = require("fake-events")\nmodule.exports = { apiRoutes: {} }\n' },
  )
  fakeEventsPackage(root)
  const built = await buildPlugin(root, { outDir: path.join(root, "dist"), log: () => {} })
  const packed = await packPluginSource(root, { zipPath: path.join(root, "out.zip"), bundlePath: built.bundlePath })
  const { unzipSync } = await import("fflate")
  const entries = Object.keys(unzipSync(fs.readFileSync(packed.zipPath)))
  assert.ok(entries.includes("plugin.json"))
  assert.ok(entries.includes("index.js"))
  assert.ok(entries.includes("dist/bundle.js"))
})

test("sandbox limits match the host contract", () => {
  assert.equal(SANDBOX_LIMITS.maxBundleBytes, 4 * 1024 * 1024)
  assert.equal(SANDBOX_LIMITS.maxDependencies, 25)
})
