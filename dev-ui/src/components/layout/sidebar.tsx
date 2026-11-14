import {
  BookOpen,
  ChevronDown,
  ChevronsUpDown,
  Compass,
  Database,
  FileCode2,
  FileText,
  History,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  Package,
  Paintbrush,
  Play,
  Puzzle,
  Radio,
  Rocket,
  Route as RouteIcon,
  ScrollText,
  Search,
  Settings2,
  Shield,
  ShoppingBag,
  Sliders,
  Sparkles,
  SquareTerminal,
  Store,
  Webhook,
} from "lucide-react"
import * as React from "react"
import { NavLink, useLocation } from "react-router-dom"
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher"
import { SkeletonWorkspaceSwitcher } from "@/components/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useApp } from "@/state/app"

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Plugin",
    items: [
      { to: "/", label: "Overview", icon: Compass },
      { to: "/permissions", label: "Permissions", icon: Shield },
      { to: "/details", label: "Details", icon: Sliders },
    ],
  },
  {
    label: "Develop",
    items: [
      { to: "/code", label: "Code", icon: FileCode2 },
      { to: "/packages", label: "Packages", icon: Package },
      { to: "/console", label: "Console", icon: ScrollText },
    ],
  },
  {
    label: "Design",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/storefront", label: "Storefront", icon: ShoppingBag },
      { to: "/settings-dialog", label: "Settings", icon: Paintbrush },
    ],
  },
  {
    label: "Backend",
    items: [
      { to: "/jobs", label: "Jobs", icon: Play },
      { to: "/job-logs", label: "Job logs", icon: History },
      { to: "/hooks", label: "Hooks", icon: Webhook },
      { to: "/api", label: "API routes", icon: RouteIcon },
    ],
  },
  {
    label: "Test",
    items: [
      { to: "/data", label: "Store data", icon: Database },
      { to: "/email", label: "Email outbox", icon: Mail },
      { to: "/realtime", label: "Realtime", icon: Radio },
    ],
  },
  {
    label: "Ship",
    items: [
      { to: "/listing", label: "Listing", icon: Store },
      { to: "/ship", label: "Validate & publish", icon: Rocket },
    ],
  },
  {
    label: "Manage",
    items: [{ to: "/settings", label: "Project settings", icon: Settings2 }],
  },
]

const NAV_GROUP_STORAGE_KEY = "selldoes-dev-sidebar-groups"

/** Stable DOM id for a group's item list. */
function groupId(label: string) {
  return `nav-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
}

/**
 * Every group starts open; only explicit "closed" choices are stored. Unknown
 * keys and corrupt values fall back to open so a stale state can't hide the
 * whole navigation.
 */
function readExpandedGroups(): Record<string, boolean> {
  const groups = Object.fromEntries(NAV_GROUPS.map((group) => [group.label, true])) as Record<string, boolean>
  try {
    const stored = localStorage.getItem(NAV_GROUP_STORAGE_KEY)
    if (!stored) return groups
    const parsed = JSON.parse(stored) as Record<string, unknown>
    for (const group of NAV_GROUPS) {
      if (parsed[group.label] === false) groups[group.label] = false
    }
  } catch {
    // stale/corrupt storage — fall back to all-open
  }
  return groups
}

const FOOTER_ICON_CLASS =
  "group relative flex h-9 flex-1 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"

/** Hover/focus label for the icon-only footer actions. */
function FooterHint({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
      {children}
    </span>
  )
}

export function Sidebar({ onOpenGlossary }: { onOpenGlossary: () => void }) {
  const {
    bootstrap,
    sidebarOpen,
    setSidebarOpen,
    sidebarDense,
    setAssistantOpen,
    workspace,
    workspaceLoaded,
    setTerminalOpen,
    setPaletteOpen,
  } = useApp()
  const location = useLocation()
  const [expandedGroups, setExpandedGroups] = React.useState(readExpandedGroups)
  const navRef = React.useRef<HTMLDivElement>(null)
  const manifest = bootstrap?.manifest
  const store = bootstrap?.store
  const workspaceMode = workspace !== null
  const activeGroupLabel = NAV_GROUPS.find((group) => group.items.some((item) => item.to === location.pathname))?.label ?? null
  const allExpanded = NAV_GROUPS.every((group) => expandedGroups[group.label])

  React.useEffect(() => {
    localStorage.setItem(NAV_GROUP_STORAGE_KEY, JSON.stringify(expandedGroups))
  }, [expandedGroups])

  // Keep the active page's group open (deep links, command palette, project
  // switch) and reveal the item inside the nav pane — never the page itself.
  React.useEffect(() => {
    if (!activeGroupLabel) return
    setExpandedGroups((previous) => (previous[activeGroupLabel] ? previous : { ...previous, [activeGroupLabel]: true }))

    let frame = 0
    let attempts = 0
    const revealActive = () => {
      const nav = navRef.current
      const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
      if (!nav || !active) {
        // The group may still be expanding — retry for a few frames.
        if (attempts++ < 6) frame = requestAnimationFrame(revealActive)
        return
      }
      const navRect = nav.getBoundingClientRect()
      const itemRect = active.getBoundingClientRect()
      if (itemRect.top < navRect.top) {
        nav.scrollTop -= navRect.top - itemRect.top + 10
      } else if (itemRect.bottom > navRect.bottom) {
        nav.scrollTop += itemRect.bottom - navRect.bottom + 10
      }
    }
    frame = requestAnimationFrame(revealActive)
    return () => cancelAnimationFrame(frame)
  }, [location.pathname, activeGroupLabel])

  const toggleGroup = (label: string) => {
    setExpandedGroups((previous) => ({ ...previous, [label]: !previous[label] }))
  }

  const toggleAllGroups = () => {
    const next = !allExpanded
    setExpandedGroups(Object.fromEntries(NAV_GROUPS.map((group) => [group.label, next])))
  }

  return (
    <>
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card transition-transform duration-200 lg:sticky lg:bottom-auto lg:top-0 lg:z-30 lg:h-screen lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-border px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShoppingBag className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-bold tracking-tight">Selldoes</span>
          {workspaceLoaded ? (
            <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              {workspaceMode ? (workspace?.sdk?.dev ? "SDK dev" : "workspace") : "plugin preview"}
            </span>
          ) : (
            <Skeleton className="h-4 w-16 rounded-full" />
          )}
        </div>

        <div ref={navRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {!workspaceLoaded ? (
            /* The workspace bootstrap hasn't answered yet — don't flash the
               standalone "mock store" block while we find out which mode we're in. */
            <SkeletonWorkspaceSwitcher />
          ) : workspaceMode ? (
            /* ── Workspace switcher (the store-switcher of the dev shell) ── */
            <WorkspaceSwitcher />
          ) : (
            /* ── Standalone `selldoes dev`: the mock store block, unchanged ── */
            <>
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Store className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">{store?.name ?? "Dev Store"}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    /{store?.slug ?? "dev-store"} · store #{store?.id ?? 1}
                  </span>
                </span>
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  mock
                </span>
              </div>
              <p className="mt-2 rounded-lg border border-dashed border-border bg-muted/50 px-2.5 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
                A fake store only your machine can see. Data lives in <code className="text-[10px]">.selldoes-dev/</code>.
              </p>
            </>
          )}

          <div className={cn("flex items-center justify-between px-2.5", sidebarDense ? "mt-3 pb-0.5" : "mt-4 pb-1")}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Navigation</p>
            <button
              type="button"
              onClick={toggleAllGroups}
              title={allExpanded ? "Collapse all groups" : "Expand all groups"}
              className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronsUpDown className="h-3 w-3" />
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          </div>

          {NAV_GROUPS.map((group) => {
            const expanded = expandedGroups[group.label] !== false
            const groupActive = group.items.some((item) => item.to === location.pathname)
            return (
              <div key={group.label} className={cn(sidebarDense ? "mt-2.5" : "mt-4")}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={expanded}
                  aria-controls={groupId(group.label)}
                  title={expanded ? `Collapse ${group.label}` : `Expand ${group.label}`}
                  className={cn(
                    "flex w-full items-center gap-1 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/60",
                    sidebarDense ? "pb-0.5 pt-0" : "pb-1 pt-0.5",
                  )}
                >
                  <span className="flex-1 text-left">{group.label}</span>
                  {groupActive && !expanded ? (
                    <span className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  ) : null}
                  <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform duration-150", !expanded && "-rotate-90")} />
                </button>
                {expanded ? (
                  <div id={groupId(group.label)}>
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/"}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                            sidebarDense ? "mt-px py-1.5" : "mt-0.5 py-2",
                            isActive
                              ? "bg-primary text-primary-foreground font-semibold"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )
                        }
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1">{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="border-t border-border px-2.5 py-2">
          <div className="flex items-center justify-between gap-0.5">
            <button type="button" aria-label="Terminal" onClick={() => setTerminalOpen(true)} className={FOOTER_ICON_CLASS}>
              <SquareTerminal className="h-4 w-4" />
              <FooterHint>Terminal · Ctrl + `</FooterHint>
            </button>
            <button type="button" aria-label="Command palette" onClick={() => setPaletteOpen(true)} className={FOOTER_ICON_CLASS}>
              <Search className="h-4 w-4" />
              <FooterHint>Command palette · Ctrl + K</FooterHint>
            </button>
            <button type="button" aria-label="What does this mean?" onClick={onOpenGlossary} className={FOOTER_ICON_CLASS}>
              <BookOpen className="h-4 w-4" />
              <FooterHint>What does this mean?</FooterHint>
            </button>
            <a
              href="https://selldoes.com/docs/plugins"
              target="_blank"
              rel="noreferrer"
              aria-label="Developer docs"
              className={FOOTER_ICON_CLASS}
            >
              <FileText className="h-4 w-4" />
              <FooterHint>Developer docs</FooterHint>
            </a>
            <button type="button" aria-label="AI assistant" onClick={() => setAssistantOpen(true)} className={FOOTER_ICON_CLASS}>
              <Sparkles className="h-4 w-4" />
              <FooterHint>AI assistant</FooterHint>
            </button>
          </div>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-[10.5px] text-muted-foreground">
            <Puzzle className="h-3 w-3" />
            <code className="text-[10px]">{manifest?.slug ?? "…"}</code> v{manifest?.version ?? "…"}
          </p>
        </div>
      </aside>
    </>
  )
}
