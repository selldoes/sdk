import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { sandboxBuildOptions } from "./build-options.mjs"
import { collectExternals, formatBytes } from "./bundle-analysis.mjs"
import { describeBuildError, describeLoadError, evaluateBundle } from "./evaluate.mjs"
import { SANDBOX_LIMITS } from "./limits.mjs"

/**
 * Probes a single package by bundling a virtual `require("<name>")` entry with
 * the sandbox profile. Used by the Packages page so a package can be rated
 * before it is ever executed. Returns a status the UI can render.
 */
export async function probePackage({ pluginDir, name }) {
  const os = await import("node:os")
  const esbuild = await import("esbuild")
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "selldoes-probe-"))
  const entry = path.join(tempDir, "entry.js")
  fs.writeFileSync(entry, `module.exports = require(${JSON.stringify(name)})\n`)
  try {
    const result = await esbuild.build({
      ...sandboxBuildOptions({
        pluginDir,
        entryPoints: [entry],
        outfile: path.join(tempDir, "probe.js"),
        metafile: true,
      }),
      nodePaths: [path.join(pluginDir, "node_modules")],
      write: true,
    })
    const externals = collectExternals(result.metafile)
    const size = fs.statSync(path.join(tempDir, "probe.js")).size
    const load = evaluateBundle(path.join(tempDir, "probe.js"))
    if (externals.length > 0) {
      return {
        status: "blocked",
        message: `needs runtime require(): ${externals.slice(0, 3).join(", ")}`,
        sizeKb: Number((size / 1024).toFixed(1)),
      }
    }
    if (size > SANDBOX_LIMITS.maxBundleBytes) {
      return {
        status: "blocked",
        message: `bundles to ${formatBytes(size)} — over the 4 MB sandbox limit`,
        sizeKb: Number((size / 1024).toFixed(1)),
      }
    }
    if (!load.ok) {
      return { status: "blocked", message: describeLoadError(load.error), sizeKb: Number((size / 1024).toFixed(1)) }
    }
    if (size > SANDBOX_LIMITS.warnBundleBytes) {
      return {
        status: "warn",
        message: `works, but bundles to ${formatBytes(size)}`,
        sizeKb: Number((size / 1024).toFixed(1)),
      }
    }
    return { status: "ok", message: "bundles and loads in the sandbox", sizeKb: Number((size / 1024).toFixed(1)) }
  } catch (error) {
    const message = String(error?.message ?? error)
    return { status: "blocked", message: describeBuildError(message), sizeKb: null }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * Rates a package against the Node job runtime. The production image runs
 * `npm ci` from the plugin's lockfile and executes the package in real Node,
 * so the local check is exactly that: resolve it from the plugin's
 * `node_modules` and load it once. Never throws.
 *
 * The load runs in a throwaway child process (with a timeout) rather than the
 * CLI process, so a package with top-level side effects cannot take the dev
 * server down with it.
 */
export function probeNodePackage({ pluginDir, name, timeoutMs = 20_000 } = {}) {
  const script = [
    'const { createRequire } = require("node:module")',
    'const path = require("node:path")',
    "try {",
    '  const req = createRequire(path.join(process.argv[1], "package.json"))',
    "  req(req.resolve(process.argv[2]))",
    "  process.exit(0)",
    "} catch (error) {",
    "  process.stderr.write(String(error && error.message ? error.message : error))",
    "  process.exit(1)",
    "}",
  ].join("\n")

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.execPath, ["-e", script, pluginDir, String(name)], {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      })
    } catch (error) {
      resolve({ status: "blocked", message: `Node runtime: ${error.message}`, sizeKb: null, runtime: "node" })
      return
    }

    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    timer.unref?.()

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ status: "blocked", message: `Node runtime: ${error.message}`, sizeKb: null, runtime: "node" })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (timedOut) {
        return resolve({
          status: "blocked",
          message: `Node runtime: the package did not load within ${Math.round(timeoutMs / 1000)}s`,
          sizeKb: null,
          runtime: "node",
        })
      }
      if (code === 0) {
        return resolve({ status: "ok", message: "installs and loads in the Node runtime", sizeKb: null, runtime: "node" })
      }
      const detail = stderr.trim().split("\n")[0] || `the package failed to load (exit ${code})`
      resolve({ status: "blocked", message: `Node runtime: ${detail}`, sizeKb: null, runtime: "node" })
    })
  })
}
