import path from "node:path"

/**
 * HTTP handlers for the workspace server's `/__ws/*` API. Kept separate from
 * workspace-server.mjs so the server file stays about processes and serving.
 *
 * All handlers receive a uniform bag: { req, res, pathname, readBody, json,
 * html, ctx }. Every failure answers with JSON — nothing here may exit the
 * process (shared library functions throw instead of `die()` for this reason).
 */

export async function route({ req, res, pathname, readBody, json, ctx }) {
  const method = req.method ?? "GET"
  const action = pathname.slice("/__ws/".length)

  try {
    // ── Bootstrap ──────────────────────────────────────────────────────────
    if (action === "bootstrap" && method === "GET") {
      return json(res, 200, await ctx.bootstrap())
    }

    // ── Projects ───────────────────────────────────────────────────────────
    if (action === "projects" && method === "GET") {
      const { listProjects } = await import("./workspace.mjs")
      return json(res, 200, { projects: listProjects() })
    }

    if (action === "remove" && method === "POST") {
      const body = await readBody(req)
      const { removeProject } = await import("./workspace.mjs")
      const ok = removeProject(String(body.projectId ?? ""))
      return json(res, ok ? 200 : 404, { ok })
    }

    if (action === "import" && method === "POST") {
      const body = await readBody(req)
      const target = String(body.path ?? "").trim()
      if (!target) return json(res, 400, { error: "Missing path" })
      const { importProject } = await import("./home.mjs")
      const project = importProject(path.resolve(target), { source: "folder" })
      return json(res, 200, { project })
    }

    if (action === "create" && method === "POST") {
      const body = await readBody(req)
      const name = String(body.name ?? "").trim()
      if (!name) return json(res, 400, { error: "Missing project name" })
      const kind = body.kind === "theme" ? "theme" : "plugin"
      const parentDir = path.resolve(String(body.parentDir ?? ctx.defaultDir))
      const { scaffoldProject } = await import("./create.mjs")
      const created = await scaffoldProject({
        kind,
        dir: path.join(parentDir, name),
        version: String(body.version ?? "0.1.0"),
        withUi: kind === "theme" ? false : body.withUi !== false,
        uiFlavor: body.uiFlavor === "react" ? "react" : "js",
        install: false,
      })
      return json(res, 200, { project: { slug: created.slug, name: created.name, kind: created.kind, path: created.targetDir }, needsInstall: kind === "plugin" && body.uiFlavor === "react" })
    }

    if (action === "create-ai" && method === "POST") {
      const body = await readBody(req)
      const name = String(body.name ?? "").trim()
      const prompt = String(body.prompt ?? "").trim()
      if (!name) return json(res, 400, { error: "Missing project name" })
      if (!prompt) return json(res, 400, { error: "Describe the plugin you want" })
      const parentDir = path.resolve(String(body.parentDir ?? ctx.defaultDir))
      const { scaffoldWithAi } = await import("./plugin/ai-scaffold.mjs")
      const config = body.assistant && typeof body.assistant === "object" ? { assistant: body.assistant } : {}
      const created = await scaffoldWithAi({
        prompt,
        dir: path.join(parentDir, name),
        config,
        log: () => {},
      })
      return json(res, 200, { project: { slug: created.slug, name: created.name, kind: "plugin", path: created.dir }, files: created.files })
    }

    // ── Developer account ──────────────────────────────────────────────────
    if (action === "packages" && method === "GET") {
      const account = await import("./account.mjs")
      const { appUrl, plugins } = await account.listPackages()
      return json(res, 200, { appUrl, plugins })
    }

    if (action === "pull" && method === "POST") {
      const body = await readBody(req)
      const slug = String(body.slug ?? "").trim()
      if (!slug) return json(res, 400, { error: "Missing slug" })
      const account = await import("./account.mjs")
      const project = await account.pullPackage(slug, body.dir ? { dir: String(body.dir) } : {})
      return json(res, 200, { project })
    }

    // ── Preview spawning / workspace selection ─────────────────────────────
    if (action === "select" && method === "POST") {
      const body = await readBody(req)
      const { listProjects } = await import("./workspace.mjs")
      const project = listProjects().find((entry) => entry.id === String(body.projectId ?? ""))
      if (!project) return json(res, 404, { error: "Project not found" })
      const preview = await ctx.selectProject(project)
      return json(res, 200, { current: { project, url: preview.url, port: preview.port, alive: true } })
    }

    if (action === "restart" && method === "POST") {
      const { listProjects } = await import("./workspace.mjs")
      const project = listProjects().find((entry) => entry.id === String(ctx.getCurrentId() ?? ""))
      if (!project) return json(res, 404, { error: "No workspace project selected" })
      const preview = await ctx.restartProject(project)
      return json(res, 200, { current: { project, url: preview.url, port: preview.port, alive: true } })
    }

    if (action === "previews" && method === "GET") {
      return json(res, 200, { previews: ctx.listPreviews() })
    }

    if (action === "open" && method === "POST") {
      const body = await readBody(req)
      const { listProjects } = await import("./workspace.mjs")
      const project = listProjects().find((entry) => entry.id === String(body.projectId ?? ""))
      if (!project) return json(res, 404, { error: "Project not found" })
      const preview = await ctx.startPreview(project)
      return json(res, 200, { preview: ctx.listPreviews().find((entry) => entry.id === preview.id) })
    }

    if (action === "close" && method === "POST") {
      const body = await readBody(req)
      const ok = ctx.stopPreview(String(body.id ?? ""))
      return json(res, ok ? 200 : 404, { ok })
    }

    return json(res, 404, { error: `Unknown workspace route: ${method} /__ws/${action}` })
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}
