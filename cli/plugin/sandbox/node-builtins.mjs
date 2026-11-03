import fs from "node:fs"
import { builtinModules, createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)

/**
 * Builtins the sandbox will never provide. Returning an esbuild error beats an
 * "empty" shim: the build fails with the import site instead of shipping a
 * bundle that throws when the code first calls `fs.readFileSync`.
 */
export const BLOCKED_BUILTINS = [
  "fs",
  "fs/promises",
  "child_process",
  "cluster",
  "dgram",
  "dns",
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "worker_threads",
  "vm",
  "wasi",
  "module",
  "inspector",
]

/** Browser shims @jspm/core ships for the allow-listed builtins. */
let browserNodelibsDir = null
function nodelibsBrowserDir() {
  if (!browserNodelibsDir) {
    // `nodelibs/fs` resolves under the "node" condition; step sideways into
    // the shipped browser shims regardless of the ambient conditions.
    const anchor = require.resolve("@jspm/core/nodelibs/fs")
    browserNodelibsDir = path.resolve(anchor, "../../browser")
  }
  return browserNodelibsDir
}

export const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")))
export const BLOCKED = new Set(BLOCKED_BUILTINS)

/**
 * esbuild plugin that maps Node builtins to @jspm/core browser shims and turns
 * blocked builtins into build errors. Written directly against @jspm/core
 * (the same shims `esbuild-plugin-polyfill-node` wraps) so path resolution is
 * explicit and works under `node -e`, `node --test` and installed CLIs alike.
 */
export function sandboxNodePlugin() {
  return {
    name: "selldoes-sandbox-node",
    setup(build) {
      const browserDir = nodelibsBrowserDir()
      build.onResolve({ filter: /^node:/ }, (args) => resolveBuiltin(args.path.replace(/^node:/, ""), browserDir))
      build.onResolve({ filter: /^[a-z_][a-z0-9_/.-]*$/ }, (args) => {
        if (!BUILTINS.has(args.path)) return null
        return resolveBuiltin(args.path, browserDir)
      })
    },
  }
}

function resolveBuiltin(name, browserDir) {
  if (BLOCKED.has(name)) {
    return {
      errors: [
        {
          text: `"${name}" is not available in the Selldoes sandbox — plugins run without filesystem, process or raw network access. Use the ctx capabilities (ctx.db, ctx.http, ctx.files…) instead.`,
        },
      ],
    }
  }
  const shim = path.join(browserDir, `${name}.js`)
  if (fs.existsSync(shim)) return { path: shim }
  return {
    errors: [{ text: `"${name}" has no browser shim and is not available in the Selldoes sandbox` }],
  }
}

/** esbuild plugins that polyfill Node builtins for the sandbox. */
export function sandboxPlugins() {
  return [sandboxNodePlugin()]
}
