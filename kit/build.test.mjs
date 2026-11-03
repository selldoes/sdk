import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildKitRuntime } from "../scripts/build-kit.mjs"

/**
 * Guards the generated kit runtime: `kit/runtime.js` is committed but built
 * from `kit/src/*.js`. If someone edits a fragment without rebuilding (or edits
 * the generated file directly), this fails.
 */
test("kit/runtime.js is up to date with kit/src", () => {
  const tmp = path.join(os.tmpdir(), `selldoes-kit-runtime-${Date.now()}.js`)
  const { source } = buildKitRuntime({ outFile: tmp })
  fs.rmSync(tmp, { force: true })
  const committed = fs.readFileSync(new URL("./runtime.js", import.meta.url), "utf8")
  assert.equal(source, committed, "kit/runtime.js is stale — run `npm run build:kit`")
})
