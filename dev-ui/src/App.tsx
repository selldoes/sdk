import * as React from "react"
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { AlertCircle, Puzzle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import { GlossaryDialog } from "@/components/layout/glossary"
import { AssistantPanel } from "@/components/layout/assistant"
import { WorkspaceDialog } from "@/components/layout/workspace-dialog"
import { DashboardSkeleton } from "@/components/skeletons"
import { CommandPalette, SearchDialog } from "@/components/command-palette"
import { TerminalDrawer } from "@/components/terminal-drawer"
import { AppProvider, Toaster, useApp } from "@/state/app"
import { PAGE_TITLES } from "@/lib/pages"
import { urlPage, urlProjectId } from "@/lib/project-url"
import { OverviewPage } from "@/pages/overview"
import { CodePage } from "@/pages/code"
import { PackagesPage } from "@/pages/packages"
import { ConsolePage } from "@/pages/console"
import { DetailsPage } from "@/pages/details"
import { PermissionsPage } from "@/pages/permissions"
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
import { SettingsPage } from "@/pages/settings"
import { UserSettingsPage } from "@/pages/user-settings"
import { NotFoundPage } from "@/pages/not-found"

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

/** Workspace shell, nothing selected yet — the onboarding dialog takes over. */
function EmptyWorkspace() {
  const { openWorkspaceDialog } = useApp()
  const navigate = useNavigate()
  return (
    <div className="mx-auto mt-24 max-w-md rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <Puzzle className="mx-auto mb-3 h-9 w-9 text-primary" />
      <p className="text-sm font-semibold">No workspace selected</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Create a project, import a folder or pull one of your packages — the shell fills in around it.
      </p>
      <Button className="mt-4" size="sm" onClick={() => openWorkspaceDialog("new")}>
        Set up workspace
      </Button>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Machine-wide preferences live in{" "}
        <button type="button" className="text-primary hover:underline" onClick={() => navigate("/user-settings")}>
          User settings
        </button>
        .
      </p>
    </div>
  )
}

function Shell() {
  const [glossaryOpen, setGlossaryOpen] = React.useState(false)
  const { noProject, workspaceDialogOpen } = useApp()
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar onOpenGlossary={() => setGlossaryOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-6 pb-24">
          <DocumentTitle />
          <Routes>
            {/* User settings lives outside the project gate — it works with no
                project selected (first run, empty workspace). */}
            <Route path="/user-settings" element={<UserSettingsPage />} />
            <Route
              path="*"
              element={
                noProject ? (
                  /* First run: the locked onboarding dialog floats over a placeholder
                     dashboard so the shell reads as "coming up", not empty. */
                  workspaceDialogOpen ? <DashboardSkeleton /> : <EmptyWorkspace />
                ) : (
                  <Gate>
                    <Routes>
                      <Route path="/" element={<OverviewPage />} />
                      <Route path="/code" element={<CodePage />} />
                      <Route path="/packages" element={<PackagesPage />} />
                      <Route path="/console" element={<ConsolePage />} />
                      <Route path="/details" element={<DetailsPage />} />
                      <Route path="/permissions" element={<PermissionsPage />} />
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
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                  </Gate>
                )
              }
            />
          </Routes>
        </main>
      </div>
      <AssistantPanel />
      <TerminalDrawer />
      <CommandPalette />
      <SearchDialog />
      <WorkspaceDialog />
      <GlossaryDialog open={glossaryOpen} onOpenChange={setGlossaryOpen} />
      <Shortcuts />
      <ProjectUrlSync />
      <LandingMemory />
    </div>
  )
}

/** Global keybindings: Ctrl/Cmd+K palette, Ctrl/Cmd+Shift+F search, Ctrl/Cmd+` terminal. */
function Shortcuts() {
  const { setPaletteOpen, setSearchOpen, setTerminalOpen, terminalOpen } = useApp()
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === "k" || (key === "p" && !event.shiftKey)) {
        event.preventDefault()
        setPaletteOpen(true)
      } else if (key === "f" && event.shiftKey) {
        event.preventDefault()
        setSearchOpen(true)
      } else if (event.key === "`") {
        event.preventDefault()
        setTerminalOpen(!terminalOpen)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [setPaletteOpen, setSearchOpen, setTerminalOpen, terminalOpen])
  return null
}

/**
 * Keeps the URL's project segment aligned with the shell's current workspace.
 * The URL is the address bar of the workspace — like a Next.js store id,
 * `/{id}/settings` names the project. Switching projects (sidebar, settings,
 * new-workspace wizard) therefore rewrites only the id: /A/settings becomes
 * /B/settings and the user stays on the page they are on. Also repairs stale
 * ids after deleting or re-selecting projects.
 */
function ProjectUrlSync() {
  const { workspace, routeBump } = useApp()
  const currentId = workspace?.current?.project.id ?? null
  React.useEffect(() => {
    if (!workspace) return // standalone `selldoes dev` — the dev server owns the id
    if (urlProjectId() === currentId) return
    const suffix = `${urlPage() === "/" ? "" : urlPage()}${window.location.search}${window.location.hash}`
    const target = currentId ? `/${currentId}${suffix}` : suffix || "/"
    window.history.replaceState(null, "", target)
    routeBump()
  }, [workspace, currentId, routeBump])
  return null
}

/**
 * Remembers the last page per project. A project switch keeps the current
 * page (ProjectUrlSync swaps only the URL's id); the remembered page is used
 * when a project's bare `/{id}` URL is opened fresh.
 */
function LandingMemory() {
  const { workspace, bootstrap } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const projectKey = workspace?.current?.project.id ?? bootstrap?.manifest.slug ?? null
  const previousKey = React.useRef<string | null>(null)
  const validPaths = React.useMemo(() => new Set(Object.keys(PAGE_TITLES)), [])

  React.useEffect(() => {
    if (!projectKey) return
    localStorage.setItem(`selldoes-dev-last-page:${projectKey}`, location.pathname)
  }, [projectKey, location.pathname])

  React.useEffect(() => {
    if (!projectKey) return
    const firstArrival = previousKey.current === null || previousKey.current !== projectKey
    previousKey.current = projectKey
    if (!firstArrival) return
    // Only jump at a bare /{id} URL — a switch keeps the page (the id segment
    // was rewritten in place), and a deep link wins over the memory.
    if (location.pathname !== "/") return
    if (workspace && urlProjectId() !== projectKey) return
    const stored = localStorage.getItem(`selldoes-dev-last-page:${projectKey}`)
    if (stored && validPaths.has(stored)) navigate(stored, { replace: true })
  }, [projectKey, location.pathname, navigate, validPaths, workspace])

  return null
}

export default function App() {
  // The project id lives in the URL's first path segment and acts as the
  // router basename, so navigate("/settings") always stays project-relative.
  // Changing the segment (project switch) remounts the router — the URL is
  // rewritten in place first, so the user lands on the same page under the
  // new project.
  const [routeKey, setRouteKey] = React.useState(0)
  const projectId = React.useMemo(() => urlProjectId(), [routeKey])
  const routeBump = React.useCallback(() => setRouteKey((key) => key + 1), [])

  React.useEffect(() => {
    const onPopState = () => setRouteKey((key) => key + 1)
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  return (
    <AppProvider onRouteBump={routeBump}>
      <BrowserRouter key={`${projectId ?? ""}:${routeKey}`} basename={projectId ? `/${projectId}` : "/"}>
        <Shell />
      </BrowserRouter>
      <Toaster />
    </AppProvider>
  )
}
