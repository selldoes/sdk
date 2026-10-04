import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { PluginRunner } from "./runner.mjs"

function tempPlugin(manifest, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-runner-"))
  fs.writeFileSync(path.join(root, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [relative, content] of Object.entries(files ?? {})) {
    const full = path.join(root, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

const NODE_JOB_MANIFEST = {
  slug: "node-runner",
  name: "Node Runner",
  description: "test",
  version: "0.1.0",
  entry: "./index.js",
  jobs: [{ type: "write-file", name: "Write file", runtime: "node", entry: "./server/write.js" }],
}

test("PluginRunner: Node jobs run in the local Node process with filesystem access", async () => {
  const root = tempPlugin(NODE_JOB_MANIFEST, {
    "index.js": "module.exports = { jobs: {} }\n",
    "server/write.js": `const fs = require("node:fs")
module.exports = async (input) => {
  fs.writeFileSync(input.path, "written")
  return { path: input.path, ok: true }
}
`,
  })
  const runner = new PluginRunner({
    pluginDir: root,
    manifest: JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")),
    devDir: path.join(root, ".selldoes-dev"),
    log: () => {},
  })
  await runner.build()
  const target = path.join(root, "out.txt")
  const run = await runner.runJob("write-file", { path: target }, {}, 5)
  assert.equal(run.kind, "node")
  assert.equal(run.done, true)
  assert.deepEqual(run.result, { path: target, ok: true })
  assert.equal(fs.readFileSync(target, "utf8"), "written")
})

test("PluginRunner: a Node entry without a handler reports a clear error", async () => {
  const root = tempPlugin(NODE_JOB_MANIFEST, {
    "index.js": "module.exports = { jobs: {} }\n",
    "server/write.js": "module.exports = { notAHandler: true }\n",
  })
  const runner = new PluginRunner({
    pluginDir: root,
    manifest: JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")),
    devDir: path.join(root, ".selldoes-dev"),
    log: () => {},
  })
  await assert.rejects(() => runner.runJob("write-file", {}, {}, 5), /no loaded handler/)
})
