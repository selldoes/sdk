import assert from "node:assert/strict"
import { Readable } from "node:stream"
import test from "node:test"
import { hostnameFromHeader, isLoopbackHostname, isLoopbackRequest, normalizeDevHost, readBody } from "./http.mjs"

test("isLoopbackHostname accepts loopback names only", () => {
  for (const host of ["127.0.0.1", "127.1.2.3", "::1", "[::1]", "localhost", "LOCALHOST", "0:0:0:0:0:0:0:1"]) {
    assert.equal(isLoopbackHostname(host), true, `${host} should be loopback`)
  }
  for (const host of ["0.0.0.0", "::", "example.com", "8.8.8.8", "192.168.1.10", "", null, undefined]) {
    assert.equal(isLoopbackHostname(host), false, `${host} should not be loopback`)
  }
})

test("hostnameFromHeader strips the port and IPv6 brackets", () => {
  assert.equal(hostnameFromHeader("127.0.0.1:4590"), "127.0.0.1")
  assert.equal(hostnameFromHeader("localhost:4590"), "localhost")
  assert.equal(hostnameFromHeader("[::1]:4590"), "::1")
  assert.equal(hostnameFromHeader(""), "")
})

test("isLoopbackRequest reads the Host header", () => {
  assert.equal(isLoopbackRequest({ headers: { host: "127.0.0.1:4590" } }), true)
  assert.equal(isLoopbackRequest({ headers: { host: "evil.example:4590" } }), false)
  assert.equal(isLoopbackRequest({ headers: {} }), false)
})

test("normalizeDevHost refuses routable binds and explains why", () => {
  const lines = []
  assert.equal(normalizeDevHost("0.0.0.0", { log: (line) => lines.push(line) }), "127.0.0.1")
  assert.equal(lines.length, 1)
  assert.match(lines[0], /only listens on localhost/)
  assert.equal(normalizeDevHost("192.168.1.5"), "127.0.0.1")
  assert.equal(normalizeDevHost("127.0.0.1"), "127.0.0.1")
  assert.equal(normalizeDevHost("::1"), "::1")
  assert.equal(normalizeDevHost(""), "127.0.0.1")
  assert.equal(normalizeDevHost(undefined, { fallback: "localhost" }), "localhost")
})

test("readBody parses JSON, honors empty, and rejects oversize bodies", async () => {
  const req = (chunks) => {
    const stream = Readable.from(chunks)
    stream.destroy = () => {}
    return stream
  }

  assert.deepEqual(await readBody(req(['{"a":1}'])), { a: 1 })
  assert.equal(await readBody(req([])), null)
  assert.deepEqual(await readBody(req([]), { empty: {} }), {})
  // Non-JSON bodies come back as the raw string.
  assert.equal(await readBody(req(["not json"])), "not json")
  await assert.rejects(() => readBody(req([Buffer.alloc(20)]), { limit: 10 }), /exceeds/)
})
