import path from "node:path"

import { createAccess } from "./mock-context/access.mjs"
import { createAi } from "./mock-context/ai.mjs"
import { createDb } from "./mock-context/db.mjs"
import { createEmail } from "./mock-context/email.mjs"
import { createFiles } from "./mock-context/files.mjs"
import { createHttp } from "./mock-context/http.mjs"
import { createJobs } from "./mock-context/jobs.mjs"
import { createProducts } from "./mock-context/products.mjs"
import { createRealtime } from "./mock-context/realtime.mjs"
import { createSecrets } from "./mock-context/secrets.mjs"
import { createStorage } from "./mock-context/storage.mjs"

/**
 * Builds a `PluginContext` that mirrors the production sandbox for local
 * development: permission checks, store scoping, allowed-tables enforcement,
 * and mocked AI/email/realtime/files behaviour.
 *
 * Differences from production are deliberate and documented in the CLI README:
 * the runtime executes in Node (not QuickJS), and outbound integrations are
 * mocked unless configured in `selldoes.config.json`.
 */
export function createMockContext({
  pluginDir,
  manifest,
  getManifest,
  db,
  storeId,
  config = {},
  devDir,
  log = () => {},
  liveStore = null,
  baseUrl = "",
}) {
  /**
   * Live store bridge (`{ bridge, prompts }` — mutated by the dev server's
   * /__dev/store connect/disconnect so switching modes needs no restart). When
   * `bridge` is set, ctx.products proxies to the real store through the
   * merchant API; `prompts` does the same for ctx.ai prompt listing.
   */
  const live = liveStore ?? { bridge: null }
  const liveProducts = () => live.bridge
  const tablePrefix = `plugin_${String(manifest.slug).replace(/-/g, "_")}_`

  const { currentManifest, currentPermissions, requirePermission, resolveTable, checkAccess, ensureAccessibleTable } =
    createAccess({
      manifest,
      getManifest,
      tablePrefix,
      db,
      storeId,
      log,
    })

  const outbox = []
  const events = []
  const jobEvents = { logs: [], items: [], progress: [] }
  /** Jobs queued with `ctx.jobs.enqueue` during a dev run; drained by the dev server. */
  const pendingJobs = []
  const filesDir = path.join(devDir, "files")

  const ctx = {
    storeId,
    get permissions() {
      return [...currentPermissions()]
    },
    tablePrefix,
    config,

    db: createDb({ db, storeId, tablePrefix, requirePermission, resolveTable, checkAccess, ensureAccessibleTable, log }),
    http: createHttp({ requirePermission }),
    ai: createAi({ config, live, requirePermission, log }),
    files: createFiles({ filesDir, baseUrl, requirePermission, liveProducts, log }),
    products: createProducts({ db, storeId, requirePermission, liveProducts }),
    jobs: createJobs({ currentManifest, jobEvents, pendingJobs, log }),
    realtime: createRealtime({ events, requirePermission, log }),
    email: createEmail({ outbox, config, requirePermission, log }),
    secrets: createSecrets({ config, requirePermission }),
    storage: createStorage({ devDir, storeId, tablePrefix, requirePermission, log }),
  }

  return { ctx, outbox, events, jobEvents, pendingJobs }
}
