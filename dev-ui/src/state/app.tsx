import * as React from "react"
import { dev } from "@/lib/api"
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
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  theme: "light" | "dark"
  toggleTheme: () => void
  toasts: Toast[]
  toast: (message: string, tone?: Toast["tone"]) => void
}

const AppContext = React.createContext<AppContextValue | null>(null)

export function useApp() {
  const context = React.useContext(AppContext)
  if (!context) throw new Error("useApp must be used inside AppProvider")
  return context
}

function initialTheme(): "light" | "dark" {
  const stored = localStorage.getItem("selldoes-dev-theme")
  if (stored === "light" || stored === "dark") return stored
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [bootstrap, setBootstrap] = React.useState<Bootstrap | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = React.useState(false)
  const [assistantQuick, setAssistantQuick] = React.useState<string[]>([])
  const [assistantContext, setAssistantContext] = React.useState("")
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const [theme, setTheme] = React.useState<"light" | "dark">(() => initialTheme())
  const [toasts, setToasts] = React.useState<Toast[]>([])

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("selldoes-dev-theme", theme)
  }, [theme])

  const refresh = React.useCallback(async () => {
    try {
      const data = await dev.bootstrap()
      setBootstrap(data)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

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
    sidebarOpen,
    setSidebarOpen,
    theme,
    toggleTheme: () => setTheme((previous) => (previous === "dark" ? "light" : "dark")),
    toasts,
    toast,
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
