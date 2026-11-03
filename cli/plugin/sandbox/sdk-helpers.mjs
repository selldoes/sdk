import fs from "node:fs"
import path from "node:path"
import { HERE } from "./paths.mjs"

/**
 * Resolves `selldoes/job` and `selldoes/node` to the CLI's own copy of the
 * helper so it is bundled into the plugin artifact (the helper is part of the
 * toolchain, not a dependency the execution image installs). In an SDK
 * checkout the source file wins — always fresh; installed users get `dist/`.
 */
export function resolveSdkHelperPath(subpath) {
  const root = path.resolve(HERE, "..", "..")
  const srcTs = path.join(root, "src", `${subpath}.ts`)
  const srcJs = path.join(root, "src", `${subpath}.js`)
  const dist = path.join(root, "dist", `${subpath}.js`)
  if (fs.existsSync(srcTs)) return srcTs
  if (fs.existsSync(srcJs)) return srcJs
  if (fs.existsSync(dist)) return dist
  return null
}

/**
 * esbuild plugin for the SDK runtime helpers.
 *
 * `selldoes/job` is QuickJS-safe (pure `ctx.db` code) and bundles everywhere.
 * `selldoes/node` needs real Node packages, so importing it from the sandbox
 * bundle fails with an actionable error instead of a mysterious external.
 */
export function sdkHelpersPlugin({ nodeRuntime = false } = {}) {
  return {
    name: "selldoes-sdk-helpers",
    setup(build) {
      build.onResolve({ filter: /^selldoes\/(job|node)$/ }, (args) => {
        const subpath = args.path.slice("selldoes/".length)
        if (subpath === "node" && !nodeRuntime) {
          return {
            errors: [
              {
                text:
                  '"selldoes/node" can only be imported from a Node job entry (a job with "runtime": "node" and server/*.js) — ' +
                  "it needs sharp/playwright, which the QuickJS sandbox cannot run.",
              },
            ],
          }
        }
        const helper = resolveSdkHelperPath(subpath)
        if (!helper) {
          return { errors: [{ text: `The selldoes CLI could not find its "${args.path}" helper — reinstall selldoes.` }] }
        }
        return { path: helper }
      })
    },
  }
}
