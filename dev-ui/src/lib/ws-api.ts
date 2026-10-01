/** Client for the workspace server (`/__ws/*`) — the web front door. */

export interface WsProject {
  id: string
  kind: "plugin" | "theme"
  name: string
  slug: string
  path: string
  source?: string
  createdAt?: string
  lastOpenedAt?: string
  missing?: boolean
}

export interface WsPreview {
  id: string
  projectId: string
  slug: string
  name: string
  url: string
  port: number
  alive: boolean
  startedAt?: string
  log?: string[]
}

export interface WsBootstrap {
  mode: "workspace"
  sdk: { version: string; dev: boolean }
  projects: WsProject[]
  account: { connected: boolean; appUrl?: string; email?: string; name?: string; unreachable?: boolean }
  assistant: { configured: boolean; provider?: string; model?: string }
  defaultDir: string
  previews: WsPreview[]
}

export interface WsPackage {
  slug: string
  name: string
  latestVersion: string
  status: string
  updatedAt?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = (body as { error?: string }).error || `Request failed (${response.status})`
    throw new Error(message)
  }
  return body as T
}

function post<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  })
}

export const ws = {
  bootstrap: () => request<WsBootstrap>("/__ws/bootstrap"),
  importFolder: (folderPath: string) => post<{ project: WsProject }>("/__ws/import", { path: folderPath }),
  create: (input: { name: string; parentDir?: string; kind: "plugin" | "theme"; version?: string; withUi?: boolean; uiFlavor?: "js" | "react" }) =>
    post<{ project: WsProject; needsInstall?: boolean }>("/__ws/create", input),
  packages: () => request<{ appUrl: string; plugins: WsPackage[] }>("/__ws/packages"),
  pull: (slug: string, dir?: string) => post<{ project: WsProject }>("/__ws/pull", { slug, dir }),
  open: (projectId: string) => post<{ preview: WsPreview }>("/__ws/open", { projectId }),
  previews: () => request<{ previews: WsPreview[] }>("/__ws/previews"),
  close: (id: string) => post<{ ok: boolean }>("/__ws/close", { id }),
  remove: (projectId: string) => post<{ ok: boolean }>("/__ws/remove", { projectId }),
}
