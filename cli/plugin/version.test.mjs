import * as assert from "node:assert/strict"
import { test } from "node:test"
import { BUMP_MODES, bumpVersion, compareVersions, isValidVersion, parseVersion } from "./version.mjs"

test("isValidVersion accepts x.y.z with prerelease/build and rejects junk", () => {
  assert.equal(isValidVersion("1.2.3"), true)
  assert.equal(isValidVersion("0.0.1-beta.1"), true)
  assert.equal(isValidVersion("1.2.3+build.5"), true)
  assert.equal(isValidVersion("1.2"), false)
  assert.equal(isValidVersion("v1.2.3"), false)
  assert.equal(isValidVersion(""), false)
})

test("parseVersion splits parts and suffixes", () => {
  assert.deepEqual(parseVersion("2.10.4-rc.1"), {
    major: 2,
    minor: 10,
    patch: 4,
    prerelease: "rc.1",
    build: null,
  })
  assert.equal(parseVersion("nope"), null)
})

test("bumpVersion moves the requested part and drops suffixes", () => {
  assert.equal(bumpVersion("0.4.1", "patch"), "0.4.2")
  assert.equal(bumpVersion("0.4.1", "minor"), "0.5.0")
  assert.equal(bumpVersion("0.4.1", "major"), "1.0.0")
  assert.equal(bumpVersion("1.2.3-beta.2", "patch"), "1.2.4")
  assert.equal(bumpVersion("1.2.3", undefined), "1.2.4")
})

test("bumpVersion rejects invalid versions and unknown modes", () => {
  assert.throws(() => bumpVersion("1.2", "patch"), /not a valid/)
  assert.throws(() => bumpVersion("1.2.3", "huge"), /Unknown bump/)
  assert.deepEqual(BUMP_MODES, ["patch", "minor", "major"])
})

test("compareVersions orders numerically, ignoring suffixes", () => {
  assert.equal(compareVersions("1.2.3", "1.2.4"), -1)
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1)
  assert.equal(compareVersions("2.0.0", "2.0.0"), 0)
  assert.equal(compareVersions("1.2.3-rc.1", "1.2.3"), 0)
  assert.equal(compareVersions("bad", "1.0.0"), 0)
})
