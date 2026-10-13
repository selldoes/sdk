import * as React from "react"
import { Link } from "react-router-dom"
import { Loader2, Pencil, Play, Plug, Plus, Send } from "lucide-react"
import { CreateRouteDialog } from "@/components/create-dialogs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, PageHead } from "@/components/shared"
import { dev } from "@/lib/api"
import { resolveRouteUrl, routeFileHint, routeParamNames } from "@/lib/route-scaffold"
import { healMissingDeclaration, parseMissingDeclaration } from "@/lib/self-heal"
import { timeAgo, cn } from "@/lib/utils"
import type { PluginManifest, Validation } from "@/lib/types"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

interface RouteRow {
  /** Stable key: kind + declared path. */
  key: string
  path: string
  methods: string[]
  kind: "dashboard" | "public"
  base: string
  full: string
  /** Conventional scaffold location — mirrors the CLI's routes/<safe-stem>.js. */
  file: string
}

interface Draft {
  method: string
  path: string
  query: string
  body: string
  params: Record<string, string>
  /** Set when run from a route row's method chip. */
  routeKey?: string
}

interface RunRecord extends Draft {
  at: number
  url: string
  status: number
  statusText: string
  ms: number
  routeKey?: string
}

/** Per-route query/body/path-params memory — `METHOD /declared/path`. */
const paramsKey = (method: string, path: string) => `selldoes-dev:route-params:${method} ${path}`
const historyKey = "selldoes-dev:route-history"
const HISTORY_MAX = 25

function loadParams(method: string, path: string): { query: string; body: string; params: Record<string, string> } | null {
  try {
    const raw = localStorage.getItem(paramsKey(method, path))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { query?: unknown; body?: unknown; params?: unknown }
    return {
      query: String(parsed.query ?? ""),
      body: String(parsed.body ?? "{}"),
      params: parsed.params && typeof parsed.params === "object" ? (parsed.params as Record<string, string>) : {},
    }
  } catch {
    return null
  }
}

function saveParams(method: string, path: string, params: { query: string; body: string; params: Record<string, string> }) {
  try {
    localStorage.setItem(paramsKey(method, path), JSON.stringify(params))
  } catch {
    /* private mode — params just won't persist */
  }
}

function loadHistory(): RunRecord[] {
  try {
    const raw = localStorage.getItem(historyKey)
    const parsed = raw ? (JSON.parse(raw) as RunRecord[]) : []
    return Array.isArray(parsed) ? parsed.filter((run) => run && typeof run === "object").slice(0, HISTORY_MAX) : []
  } catch {
    return []
  }
}

function saveHistory(history: RunRecord[]) {
  try {
    localStorage.setItem(historyKey, JSON.stringify(history.slice(0, HISTORY_MAX)))
  } catch {
    /* private mode */
  }
}

/** True when a fired URL (declared-path form or resolved) belongs to the route. */
function urlMatchesRoute(url: string, route: RouteRow): boolean {
  const pathname = url.split("?")[0]
  const pattern = route.base + route.path
  if (routeParamNames(route.path).length === 0) return pathname === pattern
  const regex = new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z0-9_]+/g, "[^/]+")}$`,
  )
  return regex.test(pathname)
}

const statusTone = (status: number) =>
  status >= 200 && status < 300 ? "bg-emerald-100 text-emerald-700" : status >= 400 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"

export function ApiPage() {
  const { bootstrap, toast, setAssistantPage, applyManifest, refresh } = useApp()
  useVisit("api")
  const manifest = bootstrap!.manifest
  const routes: RouteRow[] = [
    ...(manifest.apiRoutes ?? []).map((route) => {
      const base = `/api/plugin-api/${manifest.slug}`
      return {
        key: `dashboard:${route.path}`,
        path: route.path,
        methods: route.methods,
        kind: "dashboard" as const,
        base,
        full: base + route.path,
        file: routeFileHint(route.path),
      }
    }),
    ...(manifest.publicRoutes ?? []).map((route) => {
      const base = `/api/plugin-public/${manifest.slug}`
      return {
        key: `public:${route.path}`,
        path: route.path,
        methods: route.methods,
        kind: "public" as const,
        base,
        full: base + route.path,
        file: routeFileHint(route.path),
      }
    }),
  ]

  const first = routes[0]
  const firstMethod = first?.methods?.[0] ?? "GET"
  const firstSaved = loadParams(firstMethod, first?.full ?? "")

  const [method, setMethod] = React.useState(firstMethod)
  const [path, setPath] = React.useState(first?.full ?? "")
  const [query, setQuery] = React.useState(firstSaved?.query ?? "")
  const [body, setBody] = React.useState(firstSaved?.body ?? "{}")
  const [pathParams, setPathParams] = React.useState<Record<string, string>>(firstSaved?.params ?? {})
  const [selectedKey, setSelectedKey] = React.useState(first ? `${first.key}:${firstMethod}` : "")
  const [runningChip, setRunningChip] = React.useState<string | null>(null)
  const [result, setResult] = React.useState("—")
  const [busy, setBusy] = React.useState(false)
  const [history, setHistory] = React.useState<RunRecord[]>(loadHistory)

  /** Source files on disk — each route row gets an Edit link when a file matches. */
  const [filePaths, setFilePaths] = React.useState<Set<string> | null>(null)
  React.useEffect(() => {
    dev
      .files()
      .then((tree) => setFilePaths(new Set(tree.entries.filter((entry) => entry.type === "file").map((entry) => entry.path))))
      .catch(() => setFilePaths(null))
  }, [])
  const entryFile = String(manifest.entry ?? "index.js").replace(/^\.\//, "").replace(/\\/g, "/")

  // ── Creation: New route (scaffold into routes/ + plugin.json + entry) ────
  const [createOpen, setCreateOpen] = React.useState(false)

  const handleScaffolded = React.useCallback(
    (next: PluginManifest, validation: Validation, message: string) => {
      applyManifest(next, validation)
      toast(message, "success")
      void refresh()
    },
    [applyManifest, refresh, toast],
  )

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is on the API routes page. Declared routes: ${JSON.stringify(
        routes.map((route) => `${route.methods.join("/")} ${route.full}`),
      )}.`,
      quick: ["Explain my API routes", "Add a route that lists records"],
    })
  }, [setAssistantPage]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Latest run per declared route — the status pill on each row. */
  const lastByRoute = React.useMemo(() => {
    const map = new Map<string, RunRecord>()
    for (const run of history) {
      for (const route of routes) {
        if (map.has(route.key)) continue
        if (run.routeKey === route.key || urlMatchesRoute(run.url, route)) map.set(route.key, run)
      }
    }
    return map
  }, [history, routes]) // eslint-disable-line react-hooks/exhaustive-deps

  const pushHistory = (record: RunRecord) => {
    setHistory((previous) => {
      const next = [record, ...previous].slice(0, HISTORY_MAX)
      saveHistory(next)
      return next
    })
  }

  const send = async (draft?: Draft, healed = false) => {
    const m = draft?.method ?? method
    const rawPath = draft?.path ?? path
    const q = draft?.query ?? query
    const b = draft?.body ?? body
    const params = draft?.params ?? pathParams
    if (!rawPath) return
    const url = resolveRouteUrl(rawPath, params)
    saveParams(m, rawPath, { query: q, body: b, params })
    setBusy(true)
    setResult("…")
    const started = Date.now()
    try {
      const response = await fetch(url + (q.trim() ? `?${q.trim()}` : ""), {
        method: m,
        headers: { "Content-Type": "application/json" },
        body: m === "GET" ? undefined : b || "{}",
      })
      const text = await response.text()
      // Missing plugin.json declaration (permission / allowedTables) — declare it and retry once.
      if (!response.ok && !healed) {
        let errorText = text
        try {
          errorText = String((JSON.parse(text) as { error?: unknown }).error ?? text)
        } catch {
          // keep raw text
        }
        const missing = parseMissingDeclaration(errorText)
        if (missing) {
          await healMissingDeclaration(missing, { manifest, applyManifest, refresh, toast })
          // Retry once regardless — the saved manifest can lag the client.
          await send(draft, true)
          return
        }
      }
      const ms = Date.now() - started
      pushHistory({ at: Date.now(), method: m, path: rawPath, url, query: q, body: b, params, status: response.status, statusText: response.statusText, ms, routeKey: draft?.routeKey })
      let formatted = text
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        // keep raw text
      }
      setResult(`${response.status} ${response.statusText} · ${ms}ms\n${m} ${url}\n\n${formatted}`)
      if (response.ok) toast(`${m} ${url} → ${response.status}`, "success")
      else toast(`${m} ${url} → ${response.status}`, "error")
    } catch (error) {
      const ms = Date.now() - started
      pushHistory({ at: Date.now(), method: m, path: rawPath, url, query: q, body: b, params, status: 0, statusText: "Network error", ms, routeKey: draft?.routeKey })
      setResult(String(error))
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  /** Method chip = run now, with the params this route last used. */
  const runRoute = async (route: RouteRow, entry: string) => {
    const saved = loadParams(entry, route.full) ?? { query: "", body: "{}", params: {} }
    setSelectedKey(`${route.key}:${entry}`)
    setMethod(entry)
    setPath(route.full)
    setQuery(saved.query)
    setBody(saved.body)
    setPathParams(saved.params)
    setRunningChip(`${route.key}:${entry}`)
    try {
      await send({ method: entry, path: route.full, query: saved.query, body: saved.body, params: saved.params, routeKey: route.key })
    } finally {
      setRunningChip(null)
    }
  }

  /** History row = load that exact request back into the tester. */
  const loadRun = (run: RunRecord) => {
    setMethod(run.method)
    setPath(run.path)
    setQuery(run.query)
    setBody(run.body)
    setPathParams(run.params ?? {})
    const route = run.routeKey
      ? routes.find((entry) => entry.key === run.routeKey)
      : routes.find((entry) => entry.methods.includes(run.method) && urlMatchesRoute(run.url, entry))
    setSelectedKey(route ? `${route.key}:${run.method}` : "")
    setResult("—")
  }

  const pendingParamNames = routeParamNames(path)

  return (
    <div className="space-y-4">
      <PageHead
        title="API routes"
        description="Endpoints your plugin exposes — dashboard (apiRoutes) and public (publicRoutes). Click a method to run it; the tester below keeps your last request, params and runs."
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            New route
          </Button>
        }
      />

      {routes.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No routes declared"
          message={
            <>
              Declare <code>apiRoutes</code> (dashboard) or <code>publicRoutes</code> (visitors) in plugin.json and export matching handlers
              from your entry — or scaffold one.
            </>
          }
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus />
              New route
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Declared routes</CardTitle>
              <CardDescription>Click a method to run the request.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {routes.map((route) => {
                const editTargets = [route.file, entryFile].filter(Boolean)
                const editTarget = filePaths ? editTargets.find((candidate) => filePaths.has(candidate)) : undefined
                const routeSelected = selectedKey.startsWith(`${route.key}:`)
                const last = lastByRoute.get(route.key)
                return (
                  <div
                    key={route.key}
                    className={cn(
                      "space-y-2 rounded-lg border p-2.5 transition-colors",
                      routeSelected ? "border-primary/40 bg-primary/5" : "border-border",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          route.kind === "dashboard" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700",
                        )}
                      >
                        {route.kind}
                      </span>
                      <code className="min-w-0 flex-1 truncate text-[11px] font-semibold">{route.path}</code>
                      {last ? (
                        <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold", statusTone(last.status || 500))}>
                          {last.status || "ERR"} · {last.ms}ms
                        </span>
                      ) : null}
                      {editTarget ? (
                        <Link
                          to={`/code?file=${encodeURIComponent(editTarget)}`}
                          className="inline-flex shrink-0 items-center gap-1 text-[10.5px] font-medium text-primary hover:underline"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {route.methods.map((entry) => {
                        const chipKey = `${route.key}:${entry}`
                        const running = runningChip === chipKey
                        return (
                          <Button
                            key={entry}
                            size="sm"
                            variant={selectedKey === chipKey ? "default" : "outline"}
                            className="h-7 gap-1.5 px-2 font-mono text-[11px]"
                            disabled={busy}
                            title={`Run ${entry} ${route.path}`}
                            onClick={() => void runRoute(route, entry)}
                          >
                            {running ? <Loader2 className="animate-spin" /> : <Play className="h-3 w-3" />}
                            {entry}
                          </Button>
                        )
                      })}
                    </div>
                    {editTarget ? <code className="block truncate text-[9.5px] text-muted-foreground">{editTarget}</code> : null}
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Try a request</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <div className="flex items-center gap-1 rounded-md border border-border px-1.5">
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => {
                        setMethod(entry)
                        setSelectedKey("")
                      }}
                      className={cn(
                        "rounded px-1.5 py-1 font-mono text-[10.5px] font-semibold transition-colors",
                        method === entry ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {entry}
                    </button>
                  ))}
                </div>
                <Input
                  value={path}
                  onChange={(event) => {
                    setPath(event.target.value)
                    setSelectedKey("")
                  }}
                  className="flex-1 font-mono text-xs"
                />
                <Button onClick={() => void send()} disabled={busy || !path}>
                  {busy && !runningChip ? <Loader2 className="animate-spin" /> : <Send />}
                  Send
                </Button>
              </div>
              {pendingParamNames.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>Path parameters</Label>
                  <div className="flex flex-wrap items-center gap-3">
                    {pendingParamNames.map((name) => (
                      <div key={name} className="flex items-center gap-1.5">
                        <code className="text-[10.5px] text-muted-foreground">:{name}</code>
                        <Input
                          className="h-8 w-28 font-mono text-xs"
                          placeholder="1"
                          value={pathParams[name] ?? ""}
                          onChange={(event) => setPathParams((previous) => ({ ...previous, [name]: event.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div>
                <Label htmlFor="query">Query string</Label>
                <Input
                  id="query"
                  className="mt-1.5 font-mono text-xs"
                  placeholder="ids=1,2,3"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {method !== "GET" ? (
                <div>
                  <Label htmlFor="body">JSON body</Label>
                  <Textarea
                    id="body"
                    className="mt-1.5 font-mono text-xs"
                    placeholder='{ "example": true }'
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                  />
                </div>
              ) : null}
              <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11.5px]">{result}</pre>
              {history.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Recent runs</Label>
                    <button
                      type="button"
                      className="text-[10.5px] text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setHistory([])
                        saveHistory([])
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="space-y-1">
                    {history.slice(0, 8).map((run, index) => (
                      <button
                        key={`${run.at}-${index}`}
                        type="button"
                        onClick={() => loadRun(run)}
                        className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1 text-left text-[10.5px] transition-colors hover:bg-muted"
                      >
                        <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold", statusTone(run.status || 500))}>
                          {run.status || "ERR"}
                        </span>
                        <span className="shrink-0 font-mono font-semibold">{run.method}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{run.url}</span>
                        <span className="shrink-0 text-muted-foreground">{run.ms}ms</span>
                        <span className="shrink-0 text-muted-foreground">{timeAgo(new Date(run.at).toISOString())}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      <CreateRouteDialog open={createOpen} onOpenChange={setCreateOpen} onScaffolded={handleScaffolded} />
    </div>
  )
}
