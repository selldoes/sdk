import * as React from "react"
import { dev } from "@/lib/api"
import { ws } from "@/lib/ws-api"
import type { WsBootstrap } from "@/lib/ws-api"
import type { Bootstrap, PluginManifest, Validation } from "@/lib/types"

// ─── Toasts ──────────────────────────────────────────────────────────────────

interface Toast {
  id: number
  message: string
  tone: "default" | "error" | "success"
}

// ─── App context ─────────────────────────────────────────────────────────────

interface AppContextValue {
  bootstrap: Bootstrap | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  applyManifest: (manifest: PluginManifest, validation?: Validation) => void
  assistantOpen: boolean
  setAssistantOpen: (open: boolean) => void
  assistantQuick: string[]
  assistantContext: string
  setAssistantPage: (page: { quick?: string[]; context?: string }) => void
  /** What the editor is focused on — travels with the next AI message. */
  assistantTarget: AssistantTarget | null
  setAssistantTarget: (target: AssistantTarget | null) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  theme: "light" | "dark"
  toggleTheme: () => void
  toasts: Toast[]
  toast: (message: string, tone?: Toast["tone"]) => void
  /** Web-workspace state (null in standalone `selldoes dev`). */
  workspace: WsBootstrap | null
  /** False until the first workspace bootstrap settles (success or not). */
  workspaceLoaded: boolean
  refreshWorkspace: () => Promise<void>
  /** True when the shell runs on a workspace server but nothing is selected. */
  noProject: boolean
  /**
   * Re-reads the URL's project segment and remounts the router — called after
   * the URL is rewritten in place (project switch keeps the current page).
   */
  routeBump: () => void
  workspaceDialogOpen: boolean
  setWorkspaceDialogOpen: (open: boolean) => void
  workspaceDialogPane: WorkspaceDialogPane
  openWorkspaceDialog: (pane?: WorkspaceDialogPane) => void
  /** Overlays owned by the shell. */
  terminalOpen: boolean
  setTerminalOpen: (open: boolean) => void
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
}

export interface AssistantTarget {
  file: string
  language: string
  selection: { startLine: number; endLine: number; text: string } | null
}

/** Which pane the workspace dialog opens on. */
export type WorkspaceDialogPane = "new" | "import" | "pull"

const AppContext = React.createContext<AppContextValue | null>(null)

export function useApp() {
  const context = React.useContext(AppContext)
  if (!context) throw new Error("useApp must be used inside AppProvider")
  return context
}

function initialTheme(): "light" | "dark" {
  const stored = localStorage.getItem("selldoes-dev-theme")
  if (stored === "light" || stored === "dark") return stored
  // Default light — the preview mirrors the (light) Selldoes dashboard. The
  // topbar toggle (or Ctrl+K) still switches and persists the choice.
  return "light"
}

export function AppProvider({
  children,
  onRouteBump,
}: {
  children: React.ReactNode
  /** Remounts the router after the URL's project segment is rewritten. */
  onRouteBump?: () => void
}) {
  const [bootstrap, setBootstrap] = React.useState<Bootstrap | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = React.useState(false)
  const [assistantQuick, setAssistantQuick] = React.useState<string[]>([])
  const [assistantContext, setAssistantContext] = React.useState("")
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [theme, setTheme] = React.useState<"light" | "dark">(() => initialTheme())
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const [workspace, setWorkspace] = React.useState<WsBootstrap | null>(null)
  const [workspaceLoaded, setWorkspaceLoaded] = React.useState(false)
  const [noProject, setNoProject] = React.useState(false)
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = React.useState(false)
  const [workspaceDialogPane, setWorkspaceDialogPane] = React.useState<WorkspaceDialogPane>("new")
  const [assistantTarget, setAssistantTarget] = React.useState<AssistantTarget | null>(null)
  const [terminalOpen, setTerminalOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("selldoes-dev-theme", theme)
  }, [theme])

  const refreshWorkspace = React.useCallback(async () => {
    try {
      const data = await ws.bootstrap()
      setWorkspace(data)
    } catch {
      setWorkspace(null) // standalone `selldoes dev` — no workspace server
    } finally {
      setWorkspaceLoaded(true)
    }
  }, [])

  const refresh = React.useCallback(async () => {
    try {
      const data = await dev.bootstrap()
      setBootstrap(data)
      setError(null)
      setNoProject(false)
    } catch (cause) {
      const code = (cause as { code?: string }).code
      if (code === "no-project") {
        // Workspace shell, nothing selected yet — not an error state.
        setBootstrap(null)
        setError(null)
        setNoProject(true)
      } else {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    void refreshWorkspace()
  }, [refreshWorkspace])

  // First run (or nothing selected) → open the New-workspace dialog once.
  // Auto-opening only once keeps it from popping back over the shell while
  // the user is doing something else (e.g. after adding a theme).
  const autoOpenedWorkspace = React.useRef(false)
  React.useEffect(() => {
    if (!workspace) return
    if (workspace.projects.length === 0 || noProject) {
      if (autoOpenedWorkspace.current) return
      autoOpenedWorkspace.current = true
      setWorkspaceDialogOpen(true)
    }
  }, [workspace, noProject])

  const applyManifest = React.useCallback((manifest: PluginManifest, validation?: Validation) => {
    setBootstrap((previous) => (previous ? { ...previous, manifest, validation: validation ?? previous.validation } : previous))
  }, [])

  const toast = React.useCallback((message: string, tone: Toast["tone"] = "default") => {
    const id = Date.now() + Math.random()
    setToasts((previous) => [...previous, { id, message, tone }])
    setTimeout(() => setToasts((previous) => previous.filter((entry) => entry.id !== id)), 3600)
  }, [])

  const setAssistantPage = React.useCallback((page: { quick?: string[]; context?: string }) => {
    setAssistantQuick(page.quick ?? [])
    setAssistantContext(page.context ?? "")
  }, [])

  const openWorkspaceDialog = React.useCallback((pane: WorkspaceDialogPane = "new") => {
    setWorkspaceDialogPane(pane)
    setWorkspaceDialogOpen(true)
  }, [])

  const value: AppContextValue = {
    bootstrap,
    loading,
    error,
    refresh,
    applyManifest,
    assistantOpen,
    setAssistantOpen,
    assistantQuick,
    assistantContext,
    setAssistantPage,
    assistantTarget,
    setAssistantTarget,
    sidebarOpen,
    setSidebarOpen,
    theme,
    toggleTheme: () => setTheme((previous) => (previous === "dark" ? "light" : "dark")),
    toasts,
    toast,
    workspace,
    workspaceLoaded,
    refreshWorkspace,
    noProject,
    routeBump: onRouteBump ?? (() => {}),
    workspaceDialogOpen,
    setWorkspaceDialogOpen,
    workspaceDialogPane,
    openWorkspaceDialog,
    terminalOpen,
    setTerminalOpen,
    paletteOpen,
    setPaletteOpen,
    searchOpen,
    setSearchOpen,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function Toaster() {
  const { toasts } = useApp()
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[120] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((entry) => (
        <div
          key={entry.id}
          className={
            "pointer-events-auto rounded-lg px-4 py-2 text-sm font-semibold shadow-lg animate-in fade-in slide-in-from-bottom-2 " +
            (entry.tone === "error"
              ? "bg-destructive text-destructive-foreground"
              : entry.tone === "success"
                ? "bg-emerald-600 text-white"
                : "bg-foreground text-background")
          }
        >
          {entry.message}
        </div>
      ))}
    </div>
  )
}
