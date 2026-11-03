import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { probePort } from "../../port.mjs"
import { startDevServer } from "./server.mjs"

/**
 * Smoke test for the plugin dev server. It starts a real server against a
 * throwaway plugin and asserts the core endpoints answer and that the
 * DNS-rebinding guard rejects a non-loopback Host header.
 */

const MANIFEST = {
  slug: "smoke-plugin",
  name: "Smoke Plugin",
  description: "A plugin used by the dev-server smoke test.",
  version: "0.0.1",
  author: "test",
  permissions: [],
}

function tempPlugin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-dev-smoke-"))
  fs.writeFileSync(path.join(dir, "plugin.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`)
  fs.writeFileSync(
    path.join(dir, "selldoes.config.json"),
    `${JSON.stringify({ storeId: 1, storeSlug: "smoke", storeName: "Smoke Store" }, null, 2)}\n`,
  )
  fs.writeFileSync(path.join(dir, "index.js"), "module.exports = {}\n")
  return dir
}

async function freePort() {
  for (let port = 4700; port < 4800; port++) {
    if (await probePort(port, "127.0.0.1")) return port
  }
  throw new Error("no free port in 4700-4799")
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function postJson(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

/** Raw request so a forbidden-in-browser Host header can be set. */
function rawGet(port, requestPath, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, method: "GET", headers: { host } }, (res) => {
      res.resume()
      res.on("end", () => resolve(res.statusCode))
    })
    req.on("error", reject)
    req.end()
  })
}

test("dev server: core endpoints respond and non-loopback Hosts are refused", async (t) => {
  const pluginDir = tempPlugin()
  const port = await freePort()
  const server = await startDevServer({ pluginDir, port, exitOnClose: false })
  t.after(async () => {
    await server.close()
    fs.rmSync(pluginDir, { recursive: true, force: true })
  })

  const base = `http://127.0.0.1:${port}`

  const bootstrap = await getJson(`${base}/__dev/bootstrap`)
  assert.equal(bootstrap.status, 200)
  assert.equal(bootstrap.body.manifest.slug, "smoke-plugin")
  assert.equal(bootstrap.body.store.slug, "smoke")

  const status = await getJson(`${base}/__dev/status`)
  assert.equal(status.status, 200)

  const config = await getJson(`${base}/__dev/config`)
  assert.equal(config.status, 200)
  assert.equal(config.body.server.storeSlug, "smoke")

  const files = await getJson(`${base}/__dev/files`)
  assert.equal(files.status, 200)

  // Read-only endpoints across every route group must answer, not 5xx.
  for (const pathname of [
    "/__dev/settings",
    "/__dev/assistant",
    "/__dev/store",
    "/__dev/state",
    "/__dev/outbox",
    "/__dev/events",
    "/__dev/logs",
    "/__dev/snapshots",
    "/__dev/packages",
    "/__dev/account",
    "/__dev/ui/entries",
    "/__dev/user-settings",
    "/__dev/sdk-types",
    "/__dev/git/status",
  ]) {
    const res = await getJson(`${base}${pathname}`)
    assert.ok(res.status < 500, `${pathname} returned ${res.status}`)
  }

  // A write + read round-trip through the files service.
  const written = await postJson(`${base}/__dev/files/write`, { path: "notes.txt", content: "hello" })
  assert.equal(written.status, 200)
  const read = await getJson(`${base}/__dev/files/read?path=notes.txt`)
  assert.equal(read.status, 200)
  assert.equal(read.body.content, "hello")

  // Settings preview round-trip.
  const settings = await postJson(`${base}/__dev/settings`, { settings: { greeting: "hi" } })
  assert.equal(settings.status, 200)
  assert.equal(settings.body.settings.greeting, "hi")

  // A loopback Host passes; a rebinding-style Host is refused.
  assert.equal(await rawGet(port, "/__dev/status", `127.0.0.1:${port}`), 200)
  assert.equal(await rawGet(port, "/__dev/status", "evil.example"), 403)
})
