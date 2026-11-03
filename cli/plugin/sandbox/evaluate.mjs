import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { SANDBOX_LIMITS } from "./limits.mjs"

/**
 * Evaluates the finished bundle the way the host will: CommonJS, no `require`,
 * no `process`, no `Buffer`, no timers. Throws are returned, not raised.
 *
 * NOTE: `node:vm` is a convenience boundary, not a security sandbox — a
 * determined bundle can still reach the host. This runs only against bundles a
 * developer built locally (and the host's real QuickJS realm is what ships), so
 * it exists to catch load-time mistakes, not to contain hostile code.
 */
export function evaluateBundle(bundlePath) {
  let source
  try {
    source = fs.readFileSync(bundlePath, "utf8")
  } catch (error) {
    return { ok: false, error: `Could not read the bundle: ${error.message}` }
  }
  const sandbox = { console, module: { exports: {} }, exports: {} }
  sandbox.globalThis = sandbox
  sandbox.module.exports = sandbox.exports
  try {
    const context = vm.createContext(sandbox)
    new vm.Script(source, { filename: path.basename(bundlePath) }).runInContext(context, {
      timeout: SANDBOX_LIMITS.evalTimeoutMs,
    })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

/**
 * Turns a raw bundle-load error into an actionable explanation. The QuickJS
 * realm only carries the injected shims, so the common failures are a missing
 * browser global or a Node module the browser shims cannot emulate. The
 * Packages page and `selldoes build` both show this text, so authors can tell
 * a genuinely Node-only package from one that just needs a global the sandbox
 * does not carry. Unknown errors are returned unchanged.
 */
export function describeLoadError(error) {
  const message = String(error ?? "").trim()
  if (!message) return "the bundle failed to load in the sandbox"

  const missingGlobal = /^ReferenceError:\s*([A-Za-z_$][\w$]*)\s+is not defined/.exec(message)
  if (missingGlobal) {
    return `needs the "${missingGlobal[1]}" global, which the sandbox does not provide — use a browser-friendly alternative or a ctx capability`
  }

  const unsupportedModule = /Node\.js\s+([\w/-]+)\s+module is not supported by JSPM core/.exec(message)
  if (unsupportedModule) {
    return `needs the "${unsupportedModule[1]}" Node module, which the sandbox cannot emulate — use a ctx capability or a different package`
  }

  if (/crypto\.subtle|SubtleCrypto/.test(message)) {
    return "needs WebCrypto (crypto.subtle), which the sandbox does not provide — use a ctx capability or a different package"
  }

  if (/timed out/i.test(message)) {
    return `took longer than ${SANDBOX_LIMITS.evalTimeoutMs / 1000}s to load — the sandbox evaluates each bundle with a ${SANDBOX_LIMITS.evalTimeoutMs / 1000}s budget`
  }

  return message
}

/** Turns an esbuild failure into a short, actionable message. */
export function describeBuildError(message) {
  const first =
    String(message ?? "")
      .split("\n")
      .find((line) => line.includes("ERROR:")) ?? String(message ?? "").split("\n")[0]
  const text = first.replace(/^.*?ERROR:\s*/, "").trim()
  if (/No loader is configured for "\.node"/.test(text)) {
    return "ships a native addon (.node), which the sandbox cannot run — use a pure-JS alternative"
  }
  return text
}
