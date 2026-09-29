import * as React from "react"
import { useLocation } from "react-router-dom"
import { Check, Menu, Moon, Sparkles, Store, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { dev } from "@/lib/api"
import { PAGE_TITLES } from "@/lib/pages"
import type { DevStatus } from "@/lib/types"
import { useApp } from "@/state/app"

export function Topbar() {
  const location = useLocation()
  const { setSidebarOpen, theme, toggleTheme, setAssistantOpen } = useApp()
  const [status, setStatus] = React.useState<DevStatus | null>(null)
  const title = PAGE_TITLES[location.pathname] ?? "Preview"

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
  }, [])

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
        <Badge
          variant="outline"
          className={status?.lastError ? "border-0 bg-red-100 text-red-700" : "border-0 bg-emerald-100 text-emerald-700"}
          title={status?.lastError ?? (status ? `Built at ${new Date(status.builtAt).toLocaleTimeString()}` : "Building…")}
        >
          <Check className="mr-1 h-3 w-3" />
          {status?.lastError
            ? "build error"
            : status
              ? `built${status.rebuilds > 0 ? ` · ${status.rebuilds} rebuild${status.rebuilds === 1 ? "" : "s"}` : ""}`
              : "building…"}
        </Badge>
        <Button variant="outline" size="sm" asChild className="hidden sm:inline-flex">
          <a href="/preview/storefront" target="_blank" rel="noreferrer">
            <Store />
            View store
          </a>
        </Button>
        <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle light/dark">
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <Button size="sm" onClick={() => setAssistantOpen(true)}>
          <Sparkles />
          Ask AI
        </Button>
      </div>
    </header>
  )
}
