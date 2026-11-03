import { sendNotFound } from "../not-found-page.mjs"
import { getCurrentProjectId, listProjects } from "../workspace.mjs"

export function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  res.end(JSON.stringify(data))
}

export function html(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
  res.end(body)
}

/**
 * 404 for the workspace shell: a styled page for browsers (with links back
 * into the workspace), the usual JSON body for API clients.
 */
export function notFound(req, res, pathname) {
  const currentId = getCurrentProjectId()
  const project = currentId ? (listProjects().find((entry) => entry.id === currentId) ?? null) : null
  const homeUrl = project && !project.missing ? `/${project.id}` : "/"
  return sendNotFound(req, res, {
    pathname,
    homeUrl,
    homeLabel: project && !project.missing ? `Back to ${project.name}` : "Open workspace",
    hint:
      project && !project.missing
        ? "If you followed a link from the sidebar, the page may have been renamed — pick it from the sidebar or press Ctrl+K for the command palette."
        : "Create or import a project to fill the workspace, or open User settings for machine-wide preferences.",
    links:
      project && !project.missing
        ? [
            { to: `/${project.id}`, label: "Overview" },
            { to: `/${project.id}/code`, label: "Code" },
            { to: `/${project.id}/settings`, label: "Project settings" },
            { to: `/${project.id}/user-settings`, label: "User settings" },
          ]
        : [{ to: "/user-settings", label: "User settings" }],
  })
}
