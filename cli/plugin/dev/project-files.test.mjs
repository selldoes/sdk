import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  guardPath,
  isTextName,
  listProjectFiles,
  normalizeRelative,
  readTextFile,
  searchProject,
  writeTextFile,
} from "./project-files.mjs"

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-files-"))
  fs.mkdirSync(path.join(root, "ui", "src"), { recursive: true })
  fs.mkdirSync(path.join(root, "node_modules", "left-over"), { recursive: true })
  fs.writeFileSync(path.join(root, "index.js"), "export const hello = () => 'hi'\n")
  fs.writeFileSync(path.join(root, "ui", "src", "app.tsx"), "export const App = () => null\n")
  fs.writeFileSync(path.join(root, "node_modules", "left-over", "index.js"), "nope\n")
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n")
  return root
}

test("normalizeRelative rejects escapes", () => {
  assert.equal(normalizeRelative("./ui/app.js"), "ui/app.js")
  assert.equal(normalizeRelative("ui\\app.js"), "ui/app.js")
  assert.throws(() => normalizeRelative("../secret.txt"))
  assert.throws(() => normalizeRelative("ui/../../secret.txt"))
  assert.throws(() => normalizeRelative("/etc/passwd"))
  assert.throws(() => normalizeRelative("C:\\Windows\\system32"))
})

test("guardPath stays inside the project", () => {
  const root = tempProject()
  const inside = guardPath(root, "ui/src/app.tsx")
  assert.ok(inside.startsWith(fs.realpathSync(root) + path.sep) || inside.startsWith(path.resolve(root) + path.sep))
  assert.throws(() => guardPath(root, "../outside.txt"))
  assert.throws(() => guardPath(root, "node_modules/pkg/index.js"))
})

test("guardPath rejects symlink escapes", (t) => {
  const root = tempProject()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-outside-"))
  const link = path.join(root, "linked")
  try {
    fs.symlinkSync(outside, link, "junction")
  } catch {
    t.skip("symlinks not available on this platform")
    return
  }
  assert.throws(() => guardPath(root, "linked/secret.txt"))
})

test("writeTextFile + readTextFile round-trip", () => {
  const root = tempProject()
  const written = writeTextFile(root, "ui/src/new.ts", "export const x = 1\n")
  assert.equal(written.path, "ui/src/new.ts")
  const read = readTextFile(root, "ui/src/new.ts")
  assert.equal(read.content, "export const x = 1\n")
  assert.throws(() => writeTextFile(root, "asset.png", "not really"))
  assert.throws(() => writeTextFile(root, "../escape.js", "nope"))
})

test("readTextFile rejects binaries and oversized files", () => {
  const root = tempProject()
  fs.writeFileSync(path.join(root, "blob.txt"), Buffer.from([1, 0, 2, 3]))
  assert.throws(() => readTextFile(root, "blob.txt"), /Binary/)
  fs.writeFileSync(path.join(root, "big.md"), "x".repeat(2000))
  assert.throws(() => readTextFile(root, "big.md", { maxBytes: 1000 }), /too large/)
})

test("listProjectFiles skips ignored dirs and reports dirs via projectTree", () => {
  const root = tempProject()
  const files = listProjectFiles(root).map((file) => file.path)
  assert.ok(files.includes("index.js"))
  assert.ok(files.includes("ui/src/app.tsx"))
  assert.ok(files.includes(".gitignore"))
  assert.ok(!files.some((file) => file.startsWith("node_modules/")))
})

test("searchProject finds bounded, case-aware hits", () => {
  const root = tempProject()
  const insensitive = searchProject(root, { query: "HELLO" })
  assert.equal(insensitive.hits.length, 1)
  assert.equal(insensitive.hits[0].path, "index.js")
  assert.equal(insensitive.hits[0].line, 1)
  const sensitive = searchProject(root, { query: "HELLO", caseSensitive: true })
  assert.equal(sensitive.hits.length, 0)
  const regex = searchProject(root, { query: "App\\s*=", regex: true })
  assert.equal(regex.hits.length, 1)
  assert.throws(() => searchProject(root, { query: "([", regex: true }), /Invalid/)
})

test("isTextName allows known text, rejects assets", () => {
  assert.equal(isTextName("index.mjs"), true)
  assert.equal(isTextName(".gitignore"), true)
  assert.equal(isTextName("logo.png"), false)
})
