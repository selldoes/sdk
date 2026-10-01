import * as React from "react"
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import { GlossaryDialog } from "@/components/layout/glossary"
import { AssistantPanel } from "@/components/layout/assistant"
import { AppProvider, Toaster, useApp } from "@/state/app"
import { PAGE_TITLES } from "@/lib/pages"
import { OverviewPage } from "@/pages/overview"
import { DetailsPage } from "@/pages/details"
import { ListingPage } from "@/pages/listing"
import { DashboardPage } from "@/pages/dashboard"
import { StorefrontPage } from "@/pages/storefront"
import { ApiPage } from "@/pages/api-console"
import { JobsPage } from "@/pages/jobs"
import { HooksPage } from "@/pages/hooks"
import { DataPage } from "@/pages/data"
import { EmailPage } from "@/pages/email"
import { RealtimePage } from "@/pages/realtime"
import { ShipPage } from "@/pages/ship"
import { WorkspaceHome } from "@/pages/workspace"

function Gate({ children }: { children: React.ReactNode }) {
  const { bootstrap, loading, error, refresh } = useApp()

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-28 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  if (error || !bootstrap) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
        <p className="text-sm font-semibold">Could not reach the dev server</p>
        <p className="mt-1 text-xs text-muted-foreground">{error ?? "Unknown error"}</p>
        <Button className="mt-4" size="sm" variant="outline" onClick={() => void refresh()}>
          <RefreshCw />
          Retry
        </Button>
      </div>
    )
  }

  return <>{children}</>
}

/** Keeps the browser tab in sync with the current page + plugin. */
function DocumentTitle() {
  const location = useLocation()
  const { bootstrap } = useApp()
  React.useEffect(() => {
    const page = PAGE_TITLES[location.pathname]
    if (bootstrap) {
      document.title = `${page ?? "Preview"} · ${bootstrap.manifest.name} — Selldoes preview`
    } else {
      document.title = page ? `${page} — Selldoes preview` : "Selldoes plugin preview"
    }
  }, [location.pathname, bootstrap])
  return null
}

function Shell() {
  const [glossaryOpen, setGlossaryOpen] = React.useState(false)
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar onOpenGlossary={() => setGlossaryOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-6 pb-24">
          <DocumentTitle />
          <Gate>
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/details" element={<DetailsPage />} />
              <Route path="/listing" element={<ListingPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/storefront" element={<StorefrontPage />} />
              <Route path="/api" element={<ApiPage />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/hooks" element={<HooksPage />} />
              <Route path="/data" element={<DataPage />} />
              <Route path="/email" element={<EmailPage />} />
              <Route path="/realtime" element={<RealtimePage />} />
              <Route path="/ship" element={<ShipPage />} />
            </Routes>
          </Gate>
        </main>
      </div>
      <AssistantPanel />
      <GlossaryDialog open={glossaryOpen} onOpenChange={setGlossaryOpen} />
    </div>
  )
}

function PluginApp() {
  return (
    <AppProvider>
      <BrowserRouter basename="/preview">
        <Shell />
      </BrowserRouter>
      <Toaster />
    </AppProvider>
  )
}

/**
 * One bundle serves two surfaces: the plugin preview (a `selldoes dev`
 * server) and the workspace home (a `selldoes` workspace server). Probe
 * `/__ws/bootstrap` first — only the workspace server answers it.
 */
function ModeGate() {
  const [mode, setMode] = React.useState<"loading" | "workspace" | "plugin">("loading")

  React.useEffect(() => {
    let cancelled = false
    fetch("/__ws/bootstrap")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setMode(data?.mode === "workspace" ? "workspace" : "plugin")
      })
      .catch(() => {
        if (!cancelled) setMode("plugin")
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (mode === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    )
  }
  if (mode === "workspace") return <WorkspaceHome />
  return <PluginApp />
}

export default function App() {
  return <ModeGate />
}
