import { json, readBody } from "../../../http.mjs"

/**
 * Code-editor backend routes: the file tree + CRUD, project search, SDK type
 * definitions, snapshot history/restore, and git (status/show/diff/log/stage/
 * unstage/commit/init).
 *
 * Returns a `handle(req, res, url)` that resolves `true` once it has answered a
 * `/__dev/files*`, `/__dev/search`, `/__dev/sdk-types`, `/__dev/snapshots*` or
 * `/__dev/git/*` request, `false` otherwise.
 */
export function createFileRoutes({ filesService, gitService, manifestStore, stream, rebuildAll }) {
  return async function handle(req, res, url) {
    const pathname = url.pathname

    // ── Code editor: files, search, SDK types, snapshots ──────────────────
    if (req.method === "GET" && pathname === "/__dev/files") {
      json(res, 200, filesService.tree())
      return true
    }
    if (req.method === "GET" && pathname === "/__dev/files/read") {
      try {
        json(res, 200, filesService.read(url.searchParams.get("path") ?? ""))
      } catch (error) {
        json(res, 404, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/files/write") {
      const body = await readBody(req)
      try {
        const result = await filesService.write(body?.path, body?.content)
        stream.broadcast("snapshots", {})
        json(res, 200, { ok: true, ...result, validation: manifestStore.validation() })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/files/create") {
      const body = await readBody(req)
      try {
        const result = filesService.create(body?.path, body?.type === "dir" ? "dir" : "file")
        stream.broadcast("snapshots", {})
        stream.broadcast("files", { paths: [result.path] })
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/files/rename") {
      const body = await readBody(req)
      try {
        const result = filesService.rename(body?.from, body?.to)
        stream.broadcast("snapshots", {})
        stream.broadcast("files", { paths: [result.from, result.to] })
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/files/delete") {
      const body = await readBody(req)
      try {
        const result = filesService.remove(body?.path)
        stream.broadcast("snapshots", {})
        stream.broadcast("files", { paths: [result.path] })
        json(res, 200, { ok: true, ...result })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }
    if (req.method === "GET" && pathname === "/__dev/search") {
      try {
        const result = filesService.search(url.searchParams.get("q") ?? "", {
          caseSensitive: url.searchParams.get("case") === "1",
          regex: url.searchParams.get("regex") === "1",
        })
        json(res, 200, result)
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }
    if (req.method === "GET" && pathname === "/__dev/sdk-types") {
      const types = filesService.sdkTypes()
      if (!types.path) {
        json(res, 404, { error: "SDK type definitions not found" })
        return true
      }
      json(res, 200, types)
      return true
    }
    if (req.method === "GET" && pathname === "/__dev/snapshots") {
      json(res, 200, { snapshots: filesService.snapshots() })
      return true
    }
    if (req.method === "POST" && pathname === "/__dev/snapshots/restore") {
      const body = await readBody(req)
      try {
        const meta = filesService.restoreSnapshot(body?.name)
        await rebuildAll().catch(() => {})
        stream.broadcast("snapshots", {})
        stream.broadcast("files", { paths: (meta?.files ?? []).map((file) => file.path) })
        json(res, 200, { ok: true, meta, validation: manifestStore.validation() })
      } catch (error) {
        json(res, 400, { error: error.message })
      }
      return true
    }

    // ── Git ────────────────────────────────────────────────────────────────
    if (pathname.startsWith("/__dev/git/")) {
      const action = pathname.slice("/__dev/git/".length)
      try {
        if (req.method === "GET" && action === "status") {
          json(res, 200, await gitService.status())
          return true
        }
        if (req.method === "GET" && action === "show") {
          json(res, 200, await gitService.show(url.searchParams.get("path"), url.searchParams.get("rev") ?? "HEAD"))
          return true
        }
        if (req.method === "GET" && action === "diff") {
          json(res, 200, await gitService.diff(url.searchParams.get("path"), url.searchParams.get("staged") === "1"))
          return true
        }
        if (req.method === "GET" && action === "log") {
          json(res, 200, await gitService.log())
          return true
        }
        if (req.method === "POST" && action === "stage") {
          const body = await readBody(req)
          json(res, 200, await gitService.stage(body?.paths))
          return true
        }
        if (req.method === "POST" && action === "unstage") {
          const body = await readBody(req)
          json(res, 200, await gitService.unstage(body?.paths))
          return true
        }
        if (req.method === "POST" && action === "commit") {
          const body = await readBody(req)
          json(res, 200, await gitService.commit(body?.message, body?.paths))
          return true
        }
        if (req.method === "POST" && action === "init") {
          json(res, 200, await gitService.init())
          return true
        }
        json(res, 404, { error: `Unknown git route: ${action}` })
        return true
      } catch (error) {
        json(res, 400, { error: error.message })
        return true
      }
    }

    return false
  }
}
