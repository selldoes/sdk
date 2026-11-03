import fs from "node:fs"
import path from "node:path"
import { json, readBody } from "../../../http.mjs"
import { openInEditor, openTerminal } from "../../../open-editor.mjs"
import { contentTypeFor } from "../../../util.mjs"
import { deleteAsset, resolveAsset, saveAsset } from "../assets.mjs"
import { applyCodePlan, planCodeScaffold } from "../code-scaffold.mjs"
import { applyNotesPlan, detectUiFlavor, planNotesUi } from "../ui-scaffold.mjs"

/**
 * Dashboard-UI, scaffold, asset, settings-preview and open-in-editor routes.
 *
 * `getUiDir` reads the current built-UI directory (it is set by the initial
 * build and changes on rebuild), and the settings handlers mutate the mock
 * context's config via `applySettings`.
 *
 * Returns a `handle(req, res, url)` that resolves `true` once it has answered a
 * matching request, `false` otherwise.
 */
export function createUiRoutes({ pluginDir, getUiDir, manifestStore, state, log, stream, rebuildAll, applySettings }) {
  return async function handle(req, res, url) {
    const pathname = url.pathname

    // ── Dashboard UI: entry status + one-click notes scaffold ─────────────
    if (req.method === "GET" && pathname === "/__dev/ui/entries") {
      const uiDir = getUiDir()
      const manifest = manifestStore.read()
      const resolvedUiEntry = manifest.ui?.entry ? String(manifest.ui.entry).replace(/^\.\//, "").replace(/\\/g, "/") : null
      const byEntry = new Map()
      const touch = (entry, page) => {
        if (!entry) return
        const record = byEntry.get(entry) ?? { entry, isDefault: entry === resolvedUiEntry, pages: [] }
        if (page) record.pages.push({ label: page.label ?? entry, path: page.path ?? "/" })
        byEntry.set(entry, record)
      }
      touch(resolvedUiEntry, null)
      for (const page of manifest.dashboardPages ?? []) {
        touch(page?.entry ? String(page.entry).replace(/^\.\//, "").replace(/\\/g, "/") : resolvedUiEntry, page)
      }
      const uiRoot = path.resolve(pluginDir, "ui")
      const builtRoot = uiDir ? path.resolve(uiDir) : null
      const isFile = (file) => Boolean(file && fs.existsSync(file) && fs.statSync(file).isFile())
      const entries = [...byEntry.values()].map((record) => {
        const underUi = record.entry.startsWith("ui/")
        const sourceFile = underUi ? path.resolve(pluginDir, record.entry) : null
        const builtFile = builtRoot && underUi ? path.resolve(builtRoot, record.entry.slice(3)) : null
        return {
          ...record,
          underUi,
          sourceExists: Boolean(sourceFile?.startsWith(uiRoot + path.sep) && isFile(sourceFile)),
          builtExists: Boolean(builtFile?.startsWith(builtRoot + path.sep) && isFile(builtFile)),
        }
      })
      json(res, 200, { hasUi: Boolean(resolvedUiEntry), flavor: detectUiFlavor(pluginDir), entries })
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/ui/scaffold") {
      const body = await readBody(req)
      try {
        const current = manifestStore.read()
        const plan = planNotesUi({
          pluginDir,
          manifest: current,
          entry: body?.entry || current.ui?.entry || "ui/index.html",
        })

        // Ensure manifest wiring: ui.entry + a dashboardPages entry for the page.
        const manifest = JSON.parse(JSON.stringify(current))
        let manifestChanged = false
        if (!manifest.ui?.entry) {
          manifest.ui = { ...(manifest.ui ?? {}), entry: "ui/index.html", title: manifest.ui?.title ?? manifest.name }
          manifestChanged = true
        }
        const pages = Array.isArray(manifest.dashboardPages) ? manifest.dashboardPages : []
        const resolved = (page) => String(page?.entry ?? manifest.ui?.entry ?? "").replace(/^\.\//, "")
        if (!pages.some((page) => resolved(page) === plan.entry)) {
          const requestedLabel = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : null
          const requestedPath = typeof body?.path === "string" && body.path.trim() ? body.path.trim() : null
          const requestedIcon = typeof body?.icon === "string" && body.icon.trim() ? body.icon.trim() : null
          if (pages.length === 0) {
            pages.push({
              label: requestedLabel ?? manifest.name,
              path: requestedPath?.startsWith("/") ? requestedPath : "/",
              ...(requestedIcon ? { icon: requestedIcon } : manifest.icon ? { icon: manifest.icon } : {}),
              entry: plan.entry,
            })
          } else if (plan.isRoot) {
            const target = pages.find((page) => !page?.entry) ?? pages[0]
            target.entry = plan.entry
          } else {
            const rel = plan.relHtml.replace(/\.html?$/i, "")
            const derived = rel
              .split(/[/\\-]+/)
              .filter(Boolean)
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(" ")
            pages.push({
              label: requestedLabel ?? derived,
              path: requestedPath?.startsWith("/") ? requestedPath : `/${rel}`,
              ...(requestedIcon ? { icon: requestedIcon } : {}),
              entry: plan.entry,
            })
          }
          manifestChanged = true
        }
        if (manifestChanged) manifest.dashboardPages = pages

        // One snapshot covers the whole scaffold — a single undo reverts it.
        manifestStore.snapshots.create({ reason: "scaffold dashboard ui", files: [...plan.files, "plugin.json"] })
        const written = applyNotesPlan(pluginDir, plan)
        if (manifestChanged) manifestStore.write(manifest)

        let rebuildError = null
        try {
          await rebuildAll()
        } catch (error) {
          rebuildError = error.message
        }
        log(`scaffolded dashboard UI (${plan.flavor})${written.length ? `: ${written.join(", ")}` : " — files already present"}`)
        if (written.length) {
          stream.broadcast("files", { paths: written })
          stream.broadcast("snapshots", {})
        }
        json(res, 200, {
          ok: true,
          entry: plan.entry,
          flavor: plan.flavor,
          written,
          manifest: manifestStore.read(),
          validation: manifestStore.validation(),
          ...(rebuildError ? { rebuildError } : {}),
        })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }

    // ── Code scaffolds: New job / New hook / New route ─────────────────────
    if (req.method === "POST" && pathname.startsWith("/__dev/scaffold/")) {
      const kind = pathname.slice("/__dev/scaffold/".length)
      if (!["job", "hook", "route"].includes(kind)) {
        json(res, 404, { error: `Unknown scaffold "${kind}" (expected job, hook or route)` })
        return true
      }
      const body = await readBody(req)
      try {
        const current = manifestStore.read()
        const plan = planCodeScaffold({
          pluginDir,
          manifest: current,
          kind,
          name: body?.type ?? body?.name ?? body?.path,
          description: body?.description,
          runtime: body?.runtime,
          methods: body?.methods,
          routeKind: body?.routeKind,
        })
        // One snapshot covers module + wiring + manifest — one undo reverts it.
        manifestStore.snapshots.create({
          reason: `scaffold ${kind}`,
          files: [...plan.files, ...(plan.wiring ? [plan.entry] : []), "plugin.json"],
        })
        const written = applyCodePlan(pluginDir, plan)
        manifestStore.write(plan.manifest)
        let rebuildError = null
        try {
          await rebuildAll()
        } catch (error) {
          rebuildError = error.message
        }
        log(`scaffolded ${kind}: ${plan.file}${written.includes(plan.entry) ? " (+ entry wiring)" : ""}`)
        stream.broadcast("files", { paths: written })
        stream.broadcast("snapshots", {})
        json(res, 200, {
          ok: true,
          kind,
          file: plan.file,
          written,
          manifest: manifestStore.read(),
          validation: manifestStore.validation(),
          ...(rebuildError ? { rebuildError } : {}),
        })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }

    // ── Assets (icon + screenshots) ────────────────────────────────────────
    if (req.method === "POST" && pathname === "/__dev/assets") {
      const body = await readBody(req)
      try {
        const saved = saveAsset({ pluginDir, folder: body?.folder, name: body?.name, data: body?.data })
        log(`asset saved (${saved.path})`)
        json(res, 200, saved)
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/assets/delete") {
      const body = await readBody(req)
      try {
        const result = deleteAsset({ pluginDir, relative: body?.path })
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }
    if (req.method === "GET" && pathname.startsWith("/__dev/assets/")) {
      const relative = decodeURIComponent(pathname.slice("/__dev/assets/".length))
      const file = resolveAsset(pluginDir, relative)
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        json(res, 404, { error: "Asset not found" })
        return true
      }
      res.writeHead(200, { "Content-Type": contentTypeFor(file), "Cache-Control": "no-store" })
      res.end(fs.readFileSync(file))
      return true
    }

    // ── Settings (configSchema form in the host-page preview) ──────────────
    if (req.method === "GET" && pathname === "/__dev/settings") {
      const manifest = manifestStore.read()
      json(res, 200, { configSchema: manifest.configSchema ?? [], settings: state.settings() })
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/settings") {
      const body = await readBody(req)
      applySettings(body?.settings ?? {})
      log("settings preview saved (merged into ctx.config)")
      json(res, 200, { ok: true, settings: state.settings() })
      return true
    }

    // ── Open in external editor / OS terminal ─────────────────────────────
    if (req.method === "POST" && pathname === "/__dev/open") {
      const body = await readBody(req)
      try {
        const result = body?.terminal
          ? await openTerminal({ dir: pluginDir })
          : await openInEditor({
              dir: pluginDir,
              file: body?.file,
              line: body?.line,
              column: body?.column,
              editor: body?.editor,
            })
        json(res, 200, result)
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }

    return false
  }
}
