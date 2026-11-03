import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { watchSdkSources } from "../sdk-watch.mjs"
import { SDK_ROOT } from "./paths.mjs"

/** SDK-dev mode needs the dev-ui dependencies (Vite) installed. */
export function assertDevDependencies() {
  const viteEntry = path.join(SDK_ROOT, "dev-ui", "node_modules", "vite", "dist", "node", "index.js")
  if (!fs.existsSync(viteEntry)) {
    throw new Error("SDK-dev mode needs the dev-ui dependencies — run `npm install` in dev-ui/ first")
  }
}

/**
 * Mounts the dev-ui through Vite (HMR) — created after the http server exists
 * because the HMR sockets attach to it — and wires the SDK source watcher to
 * restart live previews in place.
 */
export async function setupDevMode({ server, restartLivePreviews }) {
  const viteEntry = pathToFileURL(path.join(SDK_ROOT, "dev-ui", "node_modules", "vite", "dist", "node", "index.js")).href
  const vite = await import(viteEntry)
  const viteServer = await vite.createServer({
    configFile: path.join(SDK_ROOT, "dev-ui", "vite.config.ts"),
    root: path.join(SDK_ROOT, "dev-ui"),
    base: "/",
    appType: "spa",
    server: { middlewareMode: true, hmr: { server } },
  })

  // SDK-dev auto-reload: Vite hot-reloads the shell UI. A supervised child
  // (spawned by dev-supervisor.mjs) only handles preview code here — the
  // supervisor restarts the whole workspace when shell-level sources change.
  // Unsupervised, previews restart on any SDK change and shell edits still
  // need a manual workspace restart.
  const supervised = process.env.SELLDOES_WORKSPACE_CHILD === "1"
  const disposeSdkWatch = watchSdkSources((file, root) => {
    const fromKit = path.basename(root) === "kit"
    const previewCode = fromKit || file.startsWith("plugin/")
    if (supervised && !previewCode) return
    void restartLivePreviews(`SDK code changed (${path.basename(root)}/${file})`)
    if (!previewCode) {
      console.log("  note: workspace shell code changed — restart the workspace once to pick it up")
    }
  })

  return { devMiddleware: viteServer.middlewares, disposeSdkWatch }
}
