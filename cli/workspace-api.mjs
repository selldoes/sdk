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
      const slug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : null
      const { scaffoldProject } = await import("./create.mjs")
      const workspaceLib = await import("./workspace.mjs")
      const previousCurrent = body.select === false ? workspaceLib.getCurrentProjectId() : null
      const created = await scaffoldProject({
        kind,
        dir: path.join(parentDir, slug || name),
        slug,
        name,
        version: String(body.version ?? "0.1.0"),
        withUi: kind === "theme" ? false : body.withUi !== false,
        uiFlavor: body.uiFlavor === "react" ? "react" : "js",
        install: false,
        description: typeof body.description === "string" ? body.description : undefined,
        author: typeof body.author === "string" ? body.author : undefined,
        category: typeof body.category === "string" ? body.category : undefined,
        icon: typeof body.icon === "string" ? body.icon : undefined,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
        permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : undefined,
        color: typeof body.color === "string" ? body.color : undefined,
      })
      if (body.select === false) {
        // Scaffolding makes the project current; restore (or clear) when the
        // caller can't preview it (themes need a connected store).
        if (previousCurrent) workspaceLib.setCurrentProject(previousCurrent)
        else workspaceLib.clearCurrentProject()
      }
      const project = workspaceLib.listProjects().find((entry) => entry.path === workspaceLib.normalizePath(created.targetDir)) ?? null
      return json(res, 200, { project, needsInstall: kind === "plugin" && body.uiFlavor === "react" })
    }

    if (action === "create-ai" && method === "POST") {
      const body = await readBody(req)
      const name = String(body.name ?? "").trim()
      const prompt = String(body.prompt ?? "").trim()
      if (!name) return json(res, 400, { error: "Missing project name" })
      if (!prompt) return json(res, 400, { error: "Describe the plugin you want" })
      const parentDir = path.resolve(String(body.parentDir ?? ctx.defaultDir))
      const { scaffoldWithAi } = await import("./plugin/ai-scaffold.mjs")
      const workspaceLib = await import("./workspace.mjs")
      const config = body.assistant && typeof body.assistant === "object" ? { assistant: body.assistant } : {}
      const slug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : null
      const previousCurrent = body.select === false ? workspaceLib.getCurrentProjectId() : null
      const created = await scaffoldWithAi({
        prompt,
        dir: path.join(parentDir, slug || name),
        config,
        log: () => {},
        overrides: {
          name,
          slug: slug ?? undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          version: typeof body.version === "string" ? body.version : undefined,
          author: typeof body.author === "string" ? body.author : undefined,
          category: typeof body.category === "string" ? body.category : undefined,
          icon: typeof body.icon === "string" ? body.icon : undefined,
          tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
        },
        color: typeof body.color === "string" ? body.color : undefined,
      })
      if (body.select === false) {
        if (previousCurrent) workspaceLib.setCurrentProject(previousCurrent)
        else workspaceLib.clearCurrentProject()
      }
      const project = workspaceLib.listProjects().find((entry) => entry.path === workspaceLib.normalizePath(created.dir)) ?? null
      return json(res, 200, { project, files: created.files })
    }

    // ── Developer account ──────────────────────────────────────────────────
    if (action === "connect" && method === "POST") {
      const body = await readBody(req)
      const account = await import("./account.mjs")
      const { appUrl, account: developer } = await account.connectDeveloper(String(body.token ?? ""))
      ctx.resetAccountCache?.()
      return json(res, 200, { connected: true, appUrl, email: developer.email, name: developer.name })
    }

    if (action === "disconnect" && method === "POST") {
      const account = await import("./account.mjs")
      account.disconnectDeveloper()
      ctx.resetAccountCache?.()
      return json(res, 200, { connected: false })
    }

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

    if (action === "open-editor" && method === "POST") {
      const body = await readBody(req)
      const { listProjects } = await import("./workspace.mjs")
      const projectId = String(body.projectId ?? ctx.getCurrentId() ?? "")
      const project = listProjects().find((entry) => entry.id === projectId)
      if (!project) return json(res, 404, { error: "No workspace project selected" })
      if (project.missing) return json(res, 404, { error: `${project.path} no longer exists` })
      const { openInEditor, openTerminal } = await import("./open-editor.mjs")
      try {
        const result = body.terminal
          ? await openTerminal({ dir: project.path })
          : await openInEditor({
              dir: project.path,
              file: body.file,
              line: body.line,
              column: body.column,
              editor: body.editor,
            })
        return json(res, 200, result)
      } catch (error) {
        return json(res, 400, { error: error.message })
      }
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
