import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { watchSdkSources } from "./workspace-server.mjs"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test("watchSdkSources: reports server source edits (debounced)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-watch-"))
  const calls = []
  const stop = watchSdkSources((file) => calls.push(file), [dir])
  try {
    if (!stop.active) return // recursive fs.watch unsupported on this platform
    fs.writeFileSync(path.join(dir, "server.mjs"), "// edit\n")
    await sleep(1200)
    assert.ok(calls.some((file) => file.includes("server.mjs")), `expected server.mjs, got ${JSON.stringify(calls)}`)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("watchSdkSources: ignores tests, build output and non-source files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-watch-"))
  const calls = []
  const stop = watchSdkSources((file) => calls.push(file), [dir])
  try {
    if (!stop.active) return
    fs.writeFileSync(path.join(dir, "live-store.test.mjs"), "// test\n")
    fs.mkdirSync(path.join(dir, "ui-dist"), { recursive: true })
    fs.writeFileSync(path.join(dir, "ui-dist", "index.js"), "// build\n")
    fs.writeFileSync(path.join(dir, "notes.txt"), "hello\n")
    await sleep(1200)
    assert.deepEqual(calls, [])
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("watchSdkSources: debounce coalesces rapid saves into one callback", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-watch-"))
  const calls = []
  const stop = watchSdkSources((file) => calls.push(file), [dir])
  try {
    if (!stop.active) return
    for (let index = 0; index < 5; index += 1) {
      fs.writeFileSync(path.join(dir, "server.mjs"), `// edit ${index}\n`)
      await sleep(40)
    }
    await sleep(1200)
    assert.equal(calls.length, 1, `expected one debounced call, got ${JSON.stringify(calls)}`)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
