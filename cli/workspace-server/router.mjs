import http from "node:http"
import { isLoopbackRequest, readBody } from "../http.mjs"
import { getCurrentProjectId, listProjects, setCurrentProject } from "../workspace.mjs"
import { html, json, notFound } from "./respond.mjs"
import { serveSpa } from "./spa.mjs"

/**
 * Builds the workspace HTTP request handler: the `/__ws/*` API, the proxy to
 * the current project's preview child, and the SPA shell. `getDevMiddleware`
 * is read per request so SDK-dev mode can swap Vite in after listen.
 */
export function createRequestHandler({
  host,
  previewManager,
  bootstrap,
  resolveDefaultDir,
  resetAccountCache,
  getDevMiddleware,
}) {
  return async function handleRequest(req, res) {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
      const pathname = url.pathname

      // DNS-rebinding guard: reject anything not addressed to a loopback name.
      if (!isLoopbackRequest(req)) {
        return json(res, 403, { error: "The Selldoes workspace only accepts requests addressed to localhost" })
      }

      // ── Workspace API ──────────────────────────────────────────────────────
      if (pathname.startsWith("/__ws/")) {
        const { route } = await import("../workspace-api.mjs")
        return await route({
          req,
          res,
          pathname,
          readBody: (req) => readBody(req, { empty: {} }),
          json,
          html,
          ctx: {
            previews: previewManager.previews,
            findPreview: previewManager.findPreview,
            startPreview: previewManager.startPreview,
            stopPreview: previewManager.stopPreview,
            listPreviews: previewManager.listPreviews,
            bootstrap,
            // Read fresh per request so `/__ws/settings` applies immediately.
            get defaultDir() {
              return resolveDefaultDir()
            },
            host,
            selectProject: previewManager.selectProject,
            restartProject: previewManager.restartProject,
            currentPreviewRecord: previewManager.currentPreviewRecord,
            getCurrentId: getCurrentProjectId,
            resetAccountCache,
          },
        })
      }

      // ── Proxy to the current project's preview server ──────────────────────
      // The shell (:4590) hosts the sidebar and dialogs; per-project data
      // flows through the current preview child, so switching workspaces
      // never leaves the shell.
      const isProxyPath =
        pathname === "/__dev" ||
        pathname.startsWith("/__dev/") ||
        pathname === "/api/plugin-api" ||
        pathname.startsWith("/api/plugin-api/") ||
        pathname === "/api/plugin-public" ||
        pathname.startsWith("/api/plugin-public/") ||
        pathname === "/api/plugins" ||
        pathname.startsWith("/api/plugins/")
      if (isProxyPath) {
        let preview = previewManager.currentPreviewRecord()
        if (!preview) {
          // Lazy spawn: the current workspace boots its preview on first use.
          const currentId = getCurrentProjectId()
          const project = currentId ? (listProjects().find((entry) => entry.id === currentId) ?? null) : null
          if (project && !project.missing) {
            try {
              preview = await previewManager.spawnOnce(project)
            } catch (error) {
              return json(res, 502, { error: `Could not start the preview for ${project.slug}: ${error.message}` })
            }
          }
        }
        if (!preview) {
          return json(res, 404, { error: "No workspace project selected — pick one in the sidebar", code: "no-project" })
        }
        const target = http.request(
          {
            host: "127.0.0.1",
            port: preview.port,
            path: req.url,
            method: req.method,
            headers: { ...req.headers, host: `127.0.0.1:${preview.port}` },
          },
          (upstream) => {
            res.writeHead(upstream.statusCode ?? 502, upstream.headers)
            upstream.pipe(res)
          },
        )
        target.on("error", () => {
          if (!res.headersSent) json(res, 502, { error: `Preview for ${preview.slug} is not responding` })
          else res.end()
        })
        req.pipe(target)
        return
      }

      // ── SPA shell ──────────────────────────────────────────────────────────
      // URLs are /<projectId>/<page> — the project's internal id (YouTube-
      // style, 11 base64url chars). The segment is authoritative: opening
      // /{id}/… selects that project (deep links open the right workspace),
      // then the SPA is served. Assets (/assets/…) fall through to ui-dist.
      if (req.method === "GET") {
        const [requestedId] = pathname.split("/").filter(Boolean)
        if (requestedId && requestedId !== "assets") {
          const project = listProjects().find((entry) => entry.id === requestedId)
          if (project && !project.missing && getCurrentProjectId() !== project.id) {
            setCurrentProject(project.id)
          }
        }
        if (pathname === "/") {
          const currentId = getCurrentProjectId()
          const project = currentId ? (listProjects().find((entry) => entry.id === currentId) ?? null) : null
          if (project && !project.missing) {
            res.writeHead(302, { Location: `/${project.id}` })
            res.end()
            return
          }
        }
        const devMiddleware = getDevMiddleware()
        if (devMiddleware) {
          // Vite owns the SPA + assets in SDK-dev mode (base is "/").
          return devMiddleware(req, res, () => notFound(req, res, pathname))
        }
        return serveSpa(res, pathname)
      }

      notFound(req, res, pathname)
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
