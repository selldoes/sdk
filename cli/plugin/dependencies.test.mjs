import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  detectPackageManager,
  ensurePackageJson,
  installedVersion,
  validateDependencies,
  validateDependencySpec,
  writeDependencies,
} from "./dependencies.mjs"
import { packageManagerEnv } from "../util.mjs"

test("validateDependencySpec accepts registry ranges only", () => {
  for (const spec of ["^1.2.3", "~0.2.1", "1.2.3", "1.2", "^1.2", "2.0.0-beta.1"]) {
    assert.equal(validateDependencySpec("cheerio", spec), null, spec)
  }
  for (const spec of ["*", "latest", "file:../local", "link:../x", "github:a/b", "https://example.com/a.tgz", "workspace:*", ""]) {
    assert.ok(validateDependencySpec("cheerio", spec), `expected "${spec}" to be rejected`)
  }
  assert.ok(validateDependencySpec("bad name!", "^1.0.0"))
})

test("validateDependencies caps the list at 25 and reports every bad spec", () => {
  const many = Object.fromEntries(Array.from({ length: 26 }, (_, index) => [`pkg-${index}`, "^1.0.0"]))
  const result = validateDependencies(many)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes("too many dependencies")))
  assert.ok(validateDependencies({ cheerio: "latest" }).errors.some((error) => error.includes("registry version range")))
  assert.equal(validateDependencies({ cheerio: "^1.2.0" }).ok, true)
})

test("detectPackageManager: lockfile detection with npm fallback", () => {
  const make = (lockfile) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-pm-"))
    if (lockfile) fs.writeFileSync(path.join(root, lockfile), "")
    return root
  }
  assert.equal(detectPackageManager(make()), "npm")
  assert.equal(detectPackageManager(make("pnpm-lock.yaml")), "pnpm")
  assert.equal(detectPackageManager(make("yarn.lock")), "yarn")
  assert.equal(detectPackageManager(make("bun.lockb")), "bun")
  assert.equal(detectPackageManager(make("package-lock.json")), "npm")
})

test("writeDependencies: updates plugin.json, removes the key when empty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-deps-"))
  fs.writeFileSync(path.join(root, "plugin.json"), `${JSON.stringify({ slug: "x", name: "X", description: "d", version: "1.0.0" }, null, 2)}\n`)
  writeDependencies(root, { zod: "^3.23.0", cheerio: "^1.2.0" })
  const written = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"))
  assert.deepEqual(Object.keys(written.dependencies), ["cheerio", "zod"])
  writeDependencies(root, {})
  const cleared = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"))
  assert.equal("dependencies" in cleared, false)
})

test("packageManagerEnv: strips inherited npm config and disables scripts", () => {
  const env = packageManagerEnv({
    PATH: "x",
    HOME: "C:\\Users\\x",
    NPM_CONFIG_ALLOW_SCRIPTS: "@opencode/cli",
    npm_config_allow_scripts: "@opencode/cli",
    npm_config_prefix: "C:\\global",
  })
  assert.equal(env.PATH, "x")
  assert.equal(env.HOME, "C:\\Users\\x")
  assert.equal(env.NPM_CONFIG_ALLOW_SCRIPTS, undefined)
  assert.equal(env.npm_config_allow_scripts, undefined)
  assert.equal(env.npm_config_prefix, undefined)
  assert.equal(env.npm_config_ignore_scripts, "true")
})

test("ensurePackageJson: materializes manifest dependencies before npm install", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-pkgjson-"))
  const manifest = { slug: "my-plugin", version: "1.2.3", dependencies: { cheerio: "^1.2.0" } }
  const first = ensurePackageJson(root, manifest)
  assert.equal(first.name, "my-plugin")
  assert.equal(first.version, "1.2.3")
  assert.equal(first.private, true)
  assert.deepEqual(first.dependencies, { cheerio: "^1.2.0" })

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "custom", dependencies: { ms: "^2.0.0", cheerio: "1.0.0" } }),
  )
  const merged = ensurePackageJson(root, manifest)
  assert.equal(merged.name, "custom")
  assert.equal(merged.dependencies.ms, "^2.0.0")
  assert.equal(merged.dependencies.cheerio, "^1.2.0")
})

test("installedVersion: reads scoped and plain packages", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-installed-"))
  const write = (name, version) => {
    const dir = path.join(root, "node_modules", ...name.split("/"))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }))
  }
  write("zod", "3.23.8")
  write("@scope/pkg", "1.4.2")
  assert.equal(installedVersion(root, "zod"), "3.23.8")
  assert.equal(installedVersion(root, "@scope/pkg"), "1.4.2")
  assert.equal(installedVersion(root, "missing"), null)
})
