import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { superviseSdkProcess } from "./dev-supervisor.mjs"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Minimal ChildProcess stand-in: `send` exits gracefully, `kill` does not. */
function fakeChild() {
  const child = new EventEmitter()
  child.exitCode = null
  child.killed = false
  child.messages = []
  child.send = (message) => {
    child.messages.push(message)
    setTimeout(() => {
      if (child.exitCode === null) {
        child.exitCode = 0
        child.emit("exit", 0, null)
      }
    }, 5)
  }
  child.kill = () => {
    if (child.exitCode !== null) return
    child.killed = true
    child.exitCode = 1
    child.emit("exit", 1, "SIGKILL")
  }
  return child
}

function harness(options = {}) {
  const children = []
  let change = null
  const run = superviseSdkProcess({
    name: "test server",
    scriptPath: "C:/fake/bin/selldoes.mjs",
    args: ["dev"],
    spawnProcess: () => {
      const child = fakeChild()
      children.push(child)
      return child
    },
    watchSources: (onChange) => {
      change = onChange
      return Object.assign(() => {}, { active: true })
    },
    log: () => {},
    ...options,
  })
  return { run, children, emitChange: (file, root) => change(file, root) }
}

test("superviseSdkProcess: restarts the child on SDK changes", async () => {
  const { run, children, emitChange } = harness()
  assert.equal(children.length, 1, "spawns the first child immediately")
  emitChange("server.mjs", "C:/sdk/cli")
  await sleep(400)
  assert.deepEqual(children[0].messages, [{ type: "shutdown" }], "asks the old child to stop gracefully")
  assert.equal(children.length, 2, "spawns a replacement")
  await run.stop()
  await run
})

test("superviseSdkProcess: child-handled changes wait while the child is alive", async () => {
  const { run, children, emitChange } = harness({
    isChildHandled: (file) => file.startsWith("plugin/"),
  })
  emitChange("plugin/dev/server.mjs", "C:/sdk/cli")
  await sleep(100)
  assert.equal(children.length, 1, "preview-owned changes must not restart the workspace child")
  emitChange("workspace-server.mjs", "C:/sdk/cli")
  await sleep(400)
  assert.equal(children.length, 2, "shell-level changes restart the child")
  await run.stop()
  await run
})

test("superviseSdkProcess: a crashed child restarts on the next change", async () => {
  const { run, children, emitChange } = harness({
    isChildHandled: () => true,
  })
  children[0].exitCode = 1
  children[0].emit("exit", 1, null)
  await sleep(50)
  assert.equal(children.length, 1, "no crash loop without a change")
  emitChange("plugin/dev/server.mjs", "C:/sdk/cli")
  await sleep(100)
  assert.equal(children.length, 2, "the next change brings it back")
  await run.stop()
  await run
})
