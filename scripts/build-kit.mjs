import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Builds `kit/runtime.js` from the ordered fragments in `kit/src/`.
 *
 * The runtime is copied verbatim into every plugin that uses kit components
 * (see cli/plugin/kit.mjs), so it must stay a single classic script — no
 * `import`/`export`. It is authored as contiguous fragments that share one IIFE
 * scope and concatenated here in order. Edit `kit/src/*`, never the generated
 * `kit/runtime.js`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..")
const SRC_DIR = path.join(ROOT, "kit", "src")
const OUT_FILE = path.join(ROOT, "kit", "runtime.js")

/** Fragment order — the same order they appear in the generated runtime. */
const ORDER = [
  "_header.js",
  "01-state.js",
  "02-dom.js",
  "03-markdown.js",
  "04-host-api.js",
  "05-sections.js",
  "06-job.js",
  "07-rich-select.js",
  "08-fields.js",
  "09-logs-links.js",
  "10-components.js",
  "11-bootstrap.js",
  "_footer.js",
]

/** Concatenates the fragments and writes `kit/runtime.js`. Returns the output. */
export function buildKitRuntime({ outFile = OUT_FILE } = {}) {
  const output = `${ORDER.map((file) => fs.readFileSync(path.join(SRC_DIR, file), "utf8").replace(/\n$/, "")).join("\n")}\n`
  fs.writeFileSync(outFile, output)
  return { outFile, bytes: Buffer.byteLength(output), source: output }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { outFile, bytes } = buildKitRuntime()
  console.log(`  kit runtime built → ${path.relative(ROOT, outFile)} (${bytes} bytes)`)
}
