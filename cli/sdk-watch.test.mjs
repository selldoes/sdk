import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { watchSdkSources } from "./sdk-watch.mjs"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test("watchSdkSources: reports the watched root alongside the file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-watch-root-"))
  const calls = []
  const stop = watchSdkSources((file, root) => calls.push({ file, root }), [dir])
  try {
    if (!stop.active) return // no native watch and polling disabled
    fs.writeFileSync(path.join(dir, "runtime.css"), "/* edit */\n")
    await sleep(1200)
    assert.ok(
      calls.some((call) => call.file.includes("runtime.css") && call.root === dir),
      `expected runtime.css anchored to ${dir}, got ${JSON.stringify(calls)}`,
    )
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("watchSdkSources: ignores ui-dist build output", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-watch-uidist-"))
  const calls = []
  const stop = watchSdkSources((file) => calls.push(file), [dir])
  try {
    if (!stop.active) return
    fs.mkdirSync(path.join(dir, "ui-dist"), { recursive: true })
    fs.writeFileSync(path.join(dir, "ui-dist", "index.js"), "// build\n")
    fs.writeFileSync(path.join(dir, "styles.css"), "/* watched */\n")
    await sleep(1200)
    assert.ok(!calls.some((file) => file.includes("ui-dist")), `ui-dist must be ignored, got ${JSON.stringify(calls)}`)
    assert.ok(
      calls.some((file) => file.includes("styles.css")),
      `styles.css should be reported, got ${JSON.stringify(calls)}`,
    )
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
