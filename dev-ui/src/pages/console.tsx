import * as React from "react"
import { useNavigate } from "react-router-dom"
import { AlertCircle, CheckCircle2, Eraser, Pause, Play, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { dev } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useDevStream } from "@/lib/use-dev-stream"
import type { DevStatus } from "@/lib/types"
import { useApp } from "@/state/app"

interface LogLine {
  id: number
  line: string
}

type Filter = "all" | "build" | "plugin" | "assistant" | "requests"

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "build", label: "Build" },
  { id: "plugin", label: "Plugin" },
  { id: "assistant", label: "Assistant" },
  { id: "requests", label: "Requests" },
]

function classify(line: string): Filter {
  if (line.includes("[esbuild]")) return "build"
  if (line.toLowerCase().includes("assistant") || line.includes("[assistant]")) return "assistant"
  if (/→ \d+ms|→ error|GET \/|POST \/|DELETE \/|PUT \//.test(line)) return "requests"
  return "plugin"
}

const PROBLEM_RE = /([^\s"']+\.(?:js|mjs|cjs|ts|tsx|jsx|json|css|html)):(\d+):(\d+)/

export function ConsolePage() {
  const { bootstrap, workspace } = useApp()
  const navigate = useNavigate()
  const projectKey = workspace?.current?.project.id ?? bootstrap?.manifest.slug ?? "project"
  const [lines, setLines] = React.useState<LogLine[]>([])
  const [paused, setPaused] = React.useState(false)
  const [filter, setFilter] = React.useState<Filter>("all")
  const [status, setStatus] = React.useState<DevStatus | null>(bootstrap?.status ?? null)
  const [loaded, setLoaded] = React.useState(false)
  const cursorRef = React.useRef(0)
  const pausedRef = React.useRef(paused)
  pausedRef.current = paused
  const scrollRef = React.useRef<HTMLDivElement | null>(null)

  const append = React.useCallback((line: string) => {
    cursorRef.current += 1
    const entry = { id: cursorRef.current, line }
    setLines((previous) => [...previous.slice(-800), entry])
  }, [])

  // Follow the newest line unless the user paused the stream.
  React.useEffect(() => {
    if (paused) return
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lines, paused])

  const load = React.useCallback(async () => {
    try {
      const data = await dev.logs()
      cursorRef.current = data.logs.length
      setLines(data.logs.map((line, index) => ({ id: index, line })))
    } catch {
      // server restarting
    }
    try {
      setStatus(await dev.status())
    } catch {
      // ignore
    }
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load, projectKey])

  useDevStream(
    (event) => {
      if (pausedRef.current) return
      if (event.type === "log") append(event.line)
      if (event.type === "build") setStatus(event.status)
    },
    { key: projectKey },
  )

  const visible = filter === "all" ? lines : lines.filter((entry) => classify(entry.line) === filter)

  const openMatch = (line: string) => {
    const match = PROBLEM_RE.exec(line)
    if (!match) return
    const file = match[1].replace(/\\/g, "/").split("/").slice(-2).join("/")
    navigate(`/code?file=${encodeURIComponent(file)}&line=${match[2]}`)
  }

  return (
    <div className="flex h-[calc(100vh-168px)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-bold">Console</span>
        {status?.lastError ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-red-600">
            <AlertCircle className="h-3.5 w-3.5" />
            build error
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            built {status ? `· ${status.rebuilds} rebuild${status.rebuilds === 1 ? "" : "s"}` : ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-semibold",
                filter === entry.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
          <Button variant="ghost" size="icon" className="h-7 w-7" title={paused ? "Resume" : "Pause"} onClick={() => setPaused((value) => !value)}>
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Clear" onClick={() => setLines([])}>
            <Eraser className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Reload" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {status?.lastError ? (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2">
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-red-800">{status.lastError}</pre>
        </div>
      ) : null}

      <div ref={scrollRef} className="flex-1 overflow-auto bg-background p-3 font-mono text-[11.5px] leading-relaxed">
        {!loaded && visible.length === 0 ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className="h-3.5" style={{ width: `${25 + ((index * 19) % 65)}%` }} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Nothing logged yet.</p>
        ) : (
          visible.map((entry) => {
            const match = PROBLEM_RE.test(entry.line)
            return (
              <div
                key={entry.id}
                className={cn("whitespace-pre-wrap break-all", match && "cursor-pointer hover:bg-muted/60")}
                onClick={() => (match ? openMatch(entry.line) : undefined)}
                title={match ? "Open in the code editor" : undefined}
              >
                <span className={cn(match && "underline decoration-dotted")}>{entry.line}</span>
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">
        <span>{visible.length} line(s)</span>
        {paused ? <span className="font-semibold text-amber-600">paused — new lines are dropped</span> : <span>live</span>}
        <span className="ml-auto">click a file:line error to jump to the editor</span>
      </div>
    </div>
  )
}
