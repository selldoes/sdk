import fs from "node:fs"
import path from "node:path"
import { json, readBody } from "../../../http.mjs"
import { bumpVersion, isValidVersion } from "../../version.mjs"

/**
 * Core dev endpoints (bootstrap/status/visit), the manifest editor + undo,
 * version bumping and one-click publish.
 *
 * Returns a `handle(req, res, url)` that resolves `true` once it has answered a
 * matching request, `false` otherwise.
 */
export function createManifestRoutes({
  pluginDir,
  devDir,
  bootstrap,
  buildStatus,
  state,
  manifestStore,
  log,
  stream,
  rebuildAll,
  touchWorkspace,
}) {
  return async function handle(req, res, url) {
    const pathname = url.pathname

    // ── Dev endpoints ───────────────────────────────────────────────────────
    if (req.method === "GET" && pathname === "/__dev/bootstrap") {
      json(res, 200, bootstrap())
      return true
    }
    if (req.method === "GET" && pathname === "/__dev/status") {
      json(res, 200, buildStatus)
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/visit") {
      const body = await readBody(req)
      state.visit(body?.page)
      json(res, 200, { ok: true })
      return true
    }

    // ── Manifest (details editor) ──────────────────────────────────────────
    if (req.method === "POST" && pathname === "/__dev/manifest") {
      const body = await readBody(req)
      const next = body?.manifest
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        json(res, 400, { error: "A manifest object is required" })
        return true
      }
      if (String(next.slug) !== String(manifestStore.read().slug)) {
        json(res, 400, { error: "The slug is permanent and cannot be changed here" })
        return true
      }
      const result = manifestStore.write(next)
      log("plugin.json saved from the Details editor")
      stream.broadcast("snapshots", {})
      try {
        await rebuildAll()
      } catch (error) {
        json(res, 200, { ok: true, ...result, rebuildError: error.message })
        return true
      }
      json(res, 200, { ok: true, ...result })
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/manifest/undo") {
      const restored = manifestStore.undo()
      if (!restored) {
        json(res, 400, { error: "Nothing to undo" })
        return true
      }
      stream.broadcast("snapshots", {})
      try {
        await rebuildAll()
      } catch (error) {
        json(res, 200, { ok: true, manifest: restored, rebuildError: error.message })
        return true
      }
      json(res, 200, { ok: true, manifest: restored })
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/undo/clear") {
      const undoRoot = path.join(devDir, "undo")
      let cleared = 0
      try {
        if (fs.existsSync(undoRoot)) {
          cleared = fs.readdirSync(undoRoot).length
          fs.rmSync(undoRoot, { recursive: true, force: true })
        }
      } catch (error) {
        json(res, 500, { error: `Could not clear the undo history: ${error.message}` })
        return true
      }
      log(`undo history cleared (${cleared} snapshot(s))`)
      json(res, 200, { ok: true, cleared })
      return true
    }

    // ── Version bump (Ship page, `selldoes version`) ───────────────────────
    if (req.method === "POST" && pathname === "/__dev/version") {
      const body = await readBody(req)
      const current = manifestStore.read()
      const explicit = typeof body?.version === "string" && body.version.trim() ? body.version.trim() : null
      let next
      try {
        if (explicit) {
          if (!isValidVersion(explicit)) throw new Error(`"${explicit}" is not a valid x.y.z version`)
          next = explicit
        } else {
          next = bumpVersion(current.version, String(body?.mode ?? "patch"))
        }
      } catch (error) {
        json(res, 400, { error: error.message })
        return true
      }
      if (next === current.version) {
        json(res, 200, {
          ok: true,
          unchanged: true,
          previous: current.version,
          version: next,
          manifest: current,
          validation: manifestStore.validation(),
        })
        return true
      }
      const written = manifestStore.write({ ...current, version: next })
      log(`version bumped ${current.version} → ${next}`)
      stream.broadcast("snapshots", {})
      stream.broadcast("files", { paths: ["plugin.json"] })
      await touchWorkspace()
      let rebuildError = null
      try {
        await rebuildAll()
      } catch (error) {
        rebuildError = error.message
      }
      json(res, 200, {
        ok: true,
        previous: current.version,
        version: next,
        manifest: written.manifest,
        validation: written.validation,
        ...(rebuildError ? { rebuildError } : {}),
      })
      return true
    }

    // ── Publish (one click from the Ship page) ─────────────────────────────
    if (req.method === "POST" && pathname === "/__dev/publish") {
      const body = await readBody(req)
      const account = await import("../../../account.mjs")
      const auth = account.developerAuth({}, account.loadConfig())
      if (!auth.token) {
        json(res, 400, {
          ok: false,
          code: "not-connected",
          error: "Connect a developer account first — Settings → Developer account.",
        })
        return true
      }

      // Optional version bump: applied before the release zip is built.
      let bumped = null
      if (body?.bump && body.bump.enabled === true) {
        const current = manifestStore.read()
        try {
          const next = bumpVersion(current.version, String(body.bump.mode ?? "patch"))
          manifestStore.write({ ...current, version: next })
          bumped = { from: current.version, to: next }
          log(`version bumped ${current.version} → ${next} — publishing`)
          stream.broadcast("snapshots", {})
          stream.broadcast("files", { paths: ["plugin.json"] })
          await touchWorkspace()
        } catch (error) {
          json(res, 400, { ok: false, error: error.message })
          return true
        }
      }

      const lines = []
      const collect = (line) => {
        const text = String(line ?? "")
        if (!text.trim()) return
        lines.push(text)
        log(text)
      }
      try {
        const { publishPlugin } = await import("../../publish.mjs")
        const result = await publishPlugin({
          pluginDir,
          appUrl: auth.appUrl,
          token: auth.token,
          notes: typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined,
          // Pricing falls back to the manifest's `pricing` block when the
          // request omits it (publishPlugin resolves the defaults).
          price: body?.price !== undefined ? Number(body.price) || 0 : undefined,
          currency: typeof body?.currency === "string" ? body.currency : undefined,
          billingPeriod: typeof body?.billingPeriod === "string" ? body.billingPeriod : undefined,
          trialDays: body?.trialDays !== undefined ? Number(body.trialDays) || 0 : undefined,
          log: collect,
        })
        if (!result.ok) {
          json(res, 502, {
            ok: false,
            error: result.payload?.error ?? `Publish failed (HTTP ${result.status})`,
            violations: result.payload?.violations ?? [],
            errors: result.payload?.errors ?? [],
            log: lines,
            ...(bumped ? { bumped } : {}),
          })
          return true
        }
        const manifest = manifestStore.read()
        json(res, 200, {
          ok: true,
          version: result.payload?.release?.version ?? manifest.version,
          release: result.payload?.release ?? null,
          listing: result.payload?.listing ?? null,
          log: lines,
          ...(bumped ? { bumped } : {}),
        })
      } catch (error) {
        json(res, 500, { ok: false, error: error.message, log: lines, ...(bumped ? { bumped } : {}) })
      }
      return true
    }

    return false
  }
}
