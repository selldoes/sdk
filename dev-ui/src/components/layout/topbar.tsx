import * as React from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Check, Menu, Moon, SquarePen, Sparkles, Store, Sun, UserRoundCog } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { dev } from "@/lib/api"
import { ws } from "@/lib/ws-api"
import { PAGE_TITLES } from "@/lib/pages"
import { useDevStream } from "@/lib/use-dev-stream"
import type { DevStatus } from "@/lib/types"
import { useApp } from "@/state/app"

export function Topbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { setSidebarOpen, theme, toggleTheme, setAssistantOpen, workspace, bootstrap, toast } = useApp()
  const [status, setStatus] = React.useState<DevStatus | null>(null)
  const title = PAGE_TITLES[location.pathname] ?? "Preview"
  const projectKey = workspace?.current?.project.id ?? bootstrap?.manifest.slug ?? null

  React.useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const data = await dev.status()
        if (active) setStatus(data)
      } catch {
        // server restarting
      }
    }
    void load()
    const timer = setInterval(load, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [projectKey])

  useDevStream(
    (event) => {
      if (event.type === "build") setStatus(event.status)
    },
    { key: projectKey },
  )

  const openInEditor = () => {
    const request = workspace ? ws.openEditor() : dev.openEditor()
    request
      .then((result) => toast(`Opened in ${result.editor ?? "your editor"}`, "success"))
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "error"))
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
        <Menu />
      </Button>
      <div className="min-w-0">
        <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">Local plugin preview</p>
        <h2 className="truncate text-[15.5px] font-bold tracking-tight">{title}</h2>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => navigate("/console")} title="Open the console">
          <Badge
            variant="outline"
            className={status?.lastError ? "border-0 bg-red-100 text-red-700" : "border-0 bg-emerald-100 text-emerald-700"}
          >
            <Check className="mr-1 h-3 w-3" />
            {status?.lastError
              ? "build error"
              : status
                ? `built${status.rebuilds > 0 ? ` · ${status.rebuilds} rebuild${status.rebuilds === 1 ? "" : "s"}` : ""}`
                : "building…"}
          </Badge>
        </button>
        <Button variant="outline" size="sm" className="hidden sm:inline-flex" title="Open the project in your editor" onClick={openInEditor}>
          <SquarePen />
          Open in editor
        </Button>
        <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex">
          <Link to="/storefront" target="_blank" rel="noreferrer">
            <Store />
            View store
          </Link>
        </Button>
        <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle light/dark">
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="User settings — accounts, assistant, preferences (every project)"
          className={location.pathname.endsWith("/user-settings") ? "bg-muted" : undefined}
          onClick={() => navigate("/user-settings")}
        >
          <UserRoundCog />
        </Button>
        <Button size="sm" onClick={() => setAssistantOpen(true)}>
          <Sparkles />
          Ask AI
        </Button>
      </div>
    </header>
  )
}
