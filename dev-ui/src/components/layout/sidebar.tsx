import { NavLink } from "react-router-dom"
import {
  BookOpen,
  ChevronDown,
  Database,
  FileCode2,
  FileText,
  LayoutDashboard,
  Mail,
  Play,
  Plug,
  Puzzle,
  Radio,
  Rocket,
  ScrollText,
  Search,
  ShoppingBag,
  Sliders,
  Sparkles,
  SquareTerminal,
  Store,
  Webhook,
  type LucideIcon,
} from "lucide-react"
import { useApp } from "@/state/app"
import { cn } from "@/lib/utils"

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  hint?: string
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Getting started",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, hint: "checklist" },
      { to: "/details", label: "Details & permissions", icon: Sliders, hint: "plugin.json" },
      { to: "/listing", label: "In Selldoes", icon: Store, hint: "marketplace" },
    ],
  },
  {
    label: "Develop",
    items: [
      { to: "/code", label: "Code", icon: FileCode2, hint: "editor" },
      { to: "/console", label: "Console", icon: ScrollText, hint: "logs" },
    ],
  },
  {
    label: "Your plugin",
    items: [
      { to: "/dashboard", label: "Dashboard page", icon: LayoutDashboard },
      { to: "/storefront", label: "Storefront", icon: ShoppingBag },
      { to: "/jobs", label: "Jobs", icon: Play, hint: "background" },
    ],
  },
  {
    label: "Test",
    items: [
      { to: "/api", label: "API console", icon: Plug },
      { to: "/hooks", label: "Hooks", icon: Webhook },
      { to: "/data", label: "Store data", icon: Database, hint: "mock" },
      { to: "/email", label: "Email outbox", icon: Mail },
      { to: "/realtime", label: "Realtime", icon: Radio },
    ],
  },
  {
    label: "Ship",
    items: [{ to: "/ship", label: "Validate & publish", icon: Rocket }],
  },
]

export function Sidebar({ onOpenGlossary }: { onOpenGlossary: () => void }) {
  const { bootstrap, sidebarOpen, setSidebarOpen, setAssistantOpen, workspace, setWorkspaceDialogOpen, noProject, setTerminalOpen, setPaletteOpen } = useApp()
  const manifest = bootstrap?.manifest
  const store = bootstrap?.store
  const current = workspace?.current ?? null
  const workspaceMode = workspace !== null

  return (
    <>
      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card transition-transform duration-200 lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-border px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShoppingBag className="h-4 w-4" />
          </span>
          <span className="text-[15px] font-bold tracking-tight">Selldoes</span>
          <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {workspaceMode ? (workspace?.sdk.dev ? "SDK dev" : "workspace") : "plugin preview"}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {workspaceMode ? (
            /* ── Workspace switcher (the store-switcher of the dev shell) ── */
            <button
              type="button"
              onClick={() => setWorkspaceDialogOpen(true)}
              title={
                current
                  ? `${current.project.path}${workspace?.sdk.dev ? " · SDK-dev mode" : ""}`
                  : "Create, import or pull a project"
              }
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/50",
                noProject && "border-dashed",
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Puzzle className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold">{current ? current.project.name : "No workspace yet"}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {current ? `/${current.project.slug} · ${current.project.kind} · local` : "create or import one"}
                </span>
              </span>
              {workspace?.sdk.dev ? (
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  dev
                </span>
              ) : null}
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
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

          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mt-4">
              <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{group.label}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "mt-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.hint ? <span className="text-[10px] opacity-70">{item.hint}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </div>

        <div className="space-y-0.5 border-t border-border px-3 py-2.5">
          <button
            type="button"
            onClick={() => setTerminalOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <SquareTerminal className="h-4 w-4" />
            Terminal
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Search className="h-4 w-4" />
            Command palette
          </button>
          <button
            type="button"
            onClick={onOpenGlossary}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <BookOpen className="h-4 w-4" />
            What does this mean?
          </button>
          <a
            href="https://selldoes.com/docs/plugins"
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <FileText className="h-4 w-4" />
            Developer docs
          </a>
          <button
            type="button"
            onClick={() => setAssistantOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Sparkles className="h-4 w-4" />
            AI assistant
          </button>
          <p className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <Puzzle className="h-3 w-3" />
            <code className="text-[10.5px]">{manifest?.slug ?? "…"}</code> v{manifest?.version ?? "…"}
          </p>
        </div>
      </aside>
    </>
  )
}
