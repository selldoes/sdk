import assert from "node:assert/strict"
import http from "node:http"
import net from "node:net"
import { spawn } from "node:child_process"
import test from "node:test"
import { listenerPids, probePort, reclaimPort } from "./port.mjs"

const noop = () => {}

async function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function waitForExit(child, timeoutMs = 10_000) {
  // The child may already be gone (reclaimPort's port probe can outlive the
  // 'exit' event) — surface that instead of waiting for an event that fired.
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

test("reclaimPort: a free port passes straight through", async () => {
  const port = await ephemeralPort()
  assert.deepEqual(await reclaimPort(port, "127.0.0.1", noop), { reclaimed: false, killed: [] })
})

test("reclaimPort: refuses to kill a listener that is not a Selldoes workspace", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end("<h1>plain app</h1>")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  try {
    await assert.rejects(reclaimPort(port, "127.0.0.1", noop), /already in use/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("reclaimPort: stops a stale workspace listener and frees the port", async (t) => {
  const port = await ephemeralPort()
  // A minimal stand-in for the workspace shell: answers /__ws/projects.
  const script =
    `require("http")` +
    `.createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ projects: [] })) })` +
    `.listen(${port}, "127.0.0.1", () => console.log("ready"))`
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
  t.after(() => {
    if (child.exitCode === null) child.kill()
  })

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`nothing started listening on ${port}`)), 10_000)
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("ready")) return
      clearTimeout(timer)
      resolve()
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`listener exited early (code ${code})`))
    })
  })

  if (!(await listenerPids(port)).includes(child.pid)) {
    t.skip("cannot enumerate listening PIDs on this platform")
    return
  }

  const result = await reclaimPort(port, "127.0.0.1", noop)
  assert.deepEqual(result.killed, [child.pid])
  assert.equal(await waitForExit(child), true)
  assert.equal(await probePort(port, "127.0.0.1"), true)
})
