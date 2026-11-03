import { attachTerminalServer } from "../terminal.mjs"
import { getCurrentProjectId, listProjects } from "../workspace.mjs"

/** Attaches the workspace-owned terminal (cwd = the selected project). */
export function attachWorkspaceTerminal(server) {
  return attachTerminalServer({
    server,
    path: "/__ws/terminal",
    resolveCwd: (url) => {
      const requested = url.searchParams.get("projectId") || getCurrentProjectId()
      const project = listProjects().find((entry) => entry.id === requested)
      return project && !project.missing ? project.path : null
    },
    log: (line) => console.log(`  ${line}`),
  })
}
