import * as React from "react"
import { useNavigate } from "react-router-dom"
import {
  Braces,
  Database,
  FileCode2,
  FileJson,
  FileText,
  Hammer,
  LayoutDashboard,
  Mail,
  Moon,
  Play,
  Plug,
  Radio,
  RefreshCw,
  Rocket,
  Search,
  ShoppingBag,
  Sliders,
  Sparkles,
  SquareTerminal,
  Store,
  Sun,
  Webhook,
  type LucideIcon,
} from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { dev } from "@/lib/api"
import { ws } from "@/lib/ws-api"
import { cn } from "@/lib/utils"
import { useApp } from "@/state/app"

interface PaletteItem {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  run: () => void
}

const PAGES: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/code", label: "Code", icon: FileCode2 },
  { to: "/console", label: "Console", icon: Braces },
  { to: "/details", label: "Details & permissions", icon: Sliders },
  { to: "/listing", label: "In Selldoes", icon: Store },
  { to: "/dashboard", label: "Dashboard page", icon: LayoutDashboard },
  { to: "/storefront", label: "Storefront", icon: ShoppingBag },
  { to: "/api", label: "API console", icon: Plug },
  { to: "/jobs", label: "Jobs", icon: Play },
  { to: "/hooks", label: "Hooks", icon: Webhook },
  { to: "/data", label: "Store data", icon: Database },
  { to: "/email", label: "Email outbox", icon: Mail },
  { to: "/realtime", label: "Realtime", icon: Radio },
  { to: "/ship", label: "Validate & publish", icon: Rocket },
]

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, workspace, theme, toggleTheme, setTerminalOpen, setAssistantOpen, setSearchOpen, toast } = useApp()
  const navigate = useNavigate()
  const [query, setQuery] = React.useState("")
  const [files, setFiles] = React.useState<string[]>([])
  const [selected, setSelected] = React.useState(0)

  React.useEffect(() => {
    if (!paletteOpen) return
    setQuery("")
    setSelected(0)
    void dev
      .files()
      .then((tree) => setFiles(tree.entries.filter((entry) => entry.type === "file").map((entry) => entry.path)))
      .catch(() => setFiles([]))
  }, [paletteOpen])

  const workspaceMode = workspace !== null

  const items = React.useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      {
        id: "rebuild",
        label: "Rebuild the plugin",
        hint: "dev",
        icon: Hammer,
        run: () => {
          void dev.rebuild().then(() => toast("Rebuilt", "success")).catch((error) => toast(String(error.message ?? error), "error"))
        },
      },
      {
        id: "restart",
        label: "Restart the preview server",
        icon: RefreshCw,
        run: () => {
          if (workspaceMode) {
            void ws.restart().then(() => toast("Preview restarted", "success")).catch((error) => toast(String(error.message ?? error), "error"))
          } else {
            void dev.rebuild().then(() => toast("Rebuilt", "success")).catch((error) => toast(String(error.message ?? error), "error"))
          }
        },
      },
      {
        id: "open-editor",
        label: "Open project in your editor",
        icon: FileCode2,
        run: () => {
          const request = workspaceMode ? ws.openEditor() : dev.openEditor()
          void request.then((result) => toast(`Opened in ${result.editor ?? "your editor"}`, "success")).catch((error) => toast(String(error.message ?? error), "error"))
        },
      },
      { id: "terminal", label: "Toggle terminal", hint: "Ctrl+`", icon: SquareTerminal, run: () => setTerminalOpen(true) },
      { id: "search", label: "Search in project", hint: "Ctrl+Shift+F", icon: Search, run: () => setSearchOpen(true) },
      { id: "ask", label: "Ask the AI assistant", icon: Sparkles, run: () => setAssistantOpen(true) },
      { id: "theme", label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme", icon: theme === "dark" ? Sun : Moon, run: toggleTheme },
    ]
    const pageItems: PaletteItem[] = PAGES.map((page) => ({
      id: `page:${page.to}`,
      label: page.label,
      hint: page.to,
      icon: page.icon,
      run: () => navigate(page.to),
    }))
    const fileItems: PaletteItem[] = files.map((path) => ({
      id: `file:${path}`,
      label: path.split("/").pop() ?? path,
      hint: path,
      icon: /\.json$/.test(path) ? FileJson : /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(path) ? FileCode2 : FileText,
      run: () => navigate(`/code?file=${encodeURIComponent(path)}`),
    }))
    return [...pageItems, ...actions, ...fileItems]
  }, [files, navigate, setAssistantOpen, setSearchOpen, setTerminalOpen, theme, toast, toggleTheme, workspaceMode])

  const filtered = React.useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return items.filter((item) => !item.id.startsWith("file:")).slice(0, 12)
    return items
      .filter((item) => {
        const haystack = `${item.label} ${item.hint ?? ""}`.toLowerCase()
        return tokens.every((token) => haystack.includes(token))
      })
      .slice(0, 40)
  }, [items, query])

  React.useEffect(() => {
    setSelected(0)
  }, [query])

  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    setPaletteOpen(false)
    item.run()
  }

  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent className="top-[18%] max-w-xl translate-y-0 gap-0 p-0" dismissible hideCloseButton>
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jump to a page, file or action…"
          className="h-11 rounded-b-none border-0 border-b border-border text-sm focus-visible:ring-0"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setSelected((value) => Math.min(value + 1, filtered.length - 1))
            }
            if (event.key === "ArrowUp") {
              event.preventDefault()
              setSelected((value) => Math.max(value - 1, 0))
            }
            if (event.key === "Enter") {
              event.preventDefault()
              run(filtered[selected])
            }
          }}
        />
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches.</p>
          ) : (
            filtered.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setSelected(index)}
                onClick={() => run(item)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px]",
                  index === selected ? "bg-primary text-primary-foreground" : "text-foreground",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0 opacity-80" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint ? <span className={cn("text-[10.5px]", index === selected ? "opacity-80" : "text-muted-foreground")}>{item.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Project search (Ctrl/Cmd+Shift+F) ──────────────────────────────────────

export function SearchDialog() {
  const { searchOpen, setSearchOpen } = useApp()
  const navigate = useNavigate()
  const [query, setQuery] = React.useState("")
  const [caseSensitive, setCaseSensitive] = React.useState(false)
  const [regex, setRegex] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<{ hits: { path: string; line: number; column: number; preview: string }[]; files: number; truncated: boolean } | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!searchOpen) return
    setQuery("")
    setResult(null)
    setError(null)
  }, [searchOpen])

  const runSearch = React.useCallback(async () => {
    const needle = query.trim()
    if (!needle) return
    setBusy(true)
    setError(null)
    try {
      setResult(await dev.search(needle, { caseSensitive, regex }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [query, caseSensitive, regex])

  return (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="top-[12%] max-w-2xl translate-y-0 gap-0 p-0" dismissible hideCloseButton>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void runSearch()
              }
            }}
            placeholder="Search in project…"
            className="h-11 border-0 text-sm focus-visible:ring-0"
          />
          <button
            type="button"
            className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold", caseSensitive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            title="Match case"
            onClick={() => setCaseSensitive((value) => !value)}
          >
            Aa
          </button>
          <button
            type="button"
            className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold", regex ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            title="Regular expression"
            onClick={() => setRegex((value) => !value)}
          >
            .*
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1.5">
          {busy ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">Searching…</p> : null}
          {error ? <p className="px-3 py-6 text-center text-xs text-red-600">{error}</p> : null}
          {!busy && result && result.hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches in {result.files} file(s).</p>
          ) : null}
          {result?.hits.map((hit, index) => (
            <button
              key={`${hit.path}:${hit.line}:${hit.column}:${index}`}
              type="button"
              onClick={() => {
                setSearchOpen(false)
                navigate(`/code?file=${encodeURIComponent(hit.path)}&line=${hit.line}`)
              }}
              className="flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted"
            >
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {hit.path}:{hit.line}
              </span>
              <span className="truncate font-mono text-[11.5px]">{hit.preview}</span>
            </button>
          ))}
          {result?.truncated ? (
            <p className="px-3 py-2 text-center text-[10.5px] text-muted-foreground">Showing the first {result.hits.length} results.</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
