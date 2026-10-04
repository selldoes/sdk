import * as React from "react"
import { AlertCircle, AlertTriangle, Check, Loader2, Package, RefreshCw, Search, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Callout, EmptyState, PageHead } from "@/components/shared"
import { dev } from "@/lib/api"
import { useBusySet } from "@/lib/use-busy"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"
import type { NpmSearchResult, PackageInfo, PackageStatus, PackagesResponse } from "@/lib/types"

const STATUS: Record<PackageStatus, { label: string; className: string; icon: typeof Check }> = {
  ok: { label: "Works", className: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: Check },
  warn: { label: "Works with care", className: "border-amber-200 bg-amber-50 text-amber-800", icon: AlertTriangle },
  blocked: { label: "Not allowed", className: "border-red-200 bg-red-50 text-red-700", icon: AlertCircle },
  missing: { label: "Not declared", className: "border-dashed text-muted-foreground", icon: AlertCircle },
}

function StatusBadge({ status }: { status: PackageStatus }) {
  const config = STATUS[status]
  const Icon = config.icon
  return (
    <Badge variant="outline" className={config.className}>
      <Icon className="mr-1 h-3 w-3" />
      {config.label}
    </Badge>
  )
}

export function PackagesPage() {
  const { toast, setAssistantPage } = useApp()
  useVisit("packages")
  const [data, setData] = React.useState<PackagesResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  // Per-key busy set: each Add/Remove/Recheck keeps its own spinner while
  // other operations are still in flight.
  const busy = useBusySet()
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<NpmSearchResult[]>([])
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      setData(await dev.packages())
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setLoading(false)
    }
  }, [toast])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    setAssistantPage({
      context: "The developer is on the Packages page: they search npm and add/remove plugin dependencies, with sandbox compatibility ratings.",
      quick: ["Which npm packages can my plugin use?", "Add a package to parse HTML"],
    })
  }, [setAssistantPage])

  React.useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setSearchError(null)
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const response = await dev.searchNpm(term)
        setResults(response.results)
      } catch (error) {
        setSearchError(error instanceof Error ? error.message : String(error))
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const add = (name: string, range?: string) =>
    busy.run(name, async () => {
      try {
        const response = await dev.addPackage(name, range)
        setData(response)
        toast(`${name} added`, "success")
        if (response.rebuildError) toast(response.rebuildError, "error")
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      }
    })

  const remove = (name: string) =>
    busy.run(name, async () => {
      try {
        const response = await dev.removePackage(name)
        setData(response)
        toast(`${name} removed`, "success")
        if (response.rebuildError) toast(response.rebuildError, "error")
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      }
    })

  const recheck = () =>
    busy.run("*", async () => {
      try {
        setData(await dev.checkPackages())
        toast("Package checks refreshed", "success")
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      }
    })

  const rows: PackageInfo[] = React.useMemo(() => {
    const missing: PackageInfo[] = (data?.missing ?? []).map((name) => ({
      name,
      declared: false,
      installed: null,
      status: "missing",
      message: "Imported by your code but not declared in plugin.json — add it so the platform installs it.",
      bundled: true,
      sizeKb: null,
    }))
    return [...(data?.packages ?? []), ...missing]
  }, [data])

  const declaredNames = new Set(Object.keys(data?.dependencies ?? {}))
  const sandbox = data?.sandbox

  return (
    <div className="space-y-4">
      <PageHead
        title="Packages"
        description="npm packages your plugin uses. Adding one installs it, declares it in plugin.json and checks it against the sandbox your plugin runs in."
      />

      <Callout kind="info">
        Plugins run in a sandbox without filesystem or raw network access; jobs with <code>runtime: "node"</code> run in
        a full Node environment instead. The checker rates each package against the runtime your plugin uses, so{" "}
        <code>playwright</code> or <code>sharp</code> show as Node packages. QuickJS packages that need <code>fs</code>,{" "}
        <code>net</code>, native addons, or a runtime global the sandbox does not carry (<code>navigator</code>,{" "}
        <code>crypto</code>, <code>async_hooks</code>) are refused at build time with the reason — use <code>ctx.db</code>,{" "}
        <code>ctx.http</code> and <code>ctx.files</code>, or a browser-friendly alternative.
      </Callout>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Search npm</CardTitle>
          <CardDescription>Type at least two characters. Adding installs with {data?.manager ?? "npm"} and updates plugin.json.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="cheerio, date-fns, zod…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {searching ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
          </div>
          {searchError ? <p className="text-xs text-destructive">{searchError}</p> : null}
          {results.length > 0 ? (
            <div className="divide-y divide-border rounded-lg border border-border">
              {results.map((result) => {
                const added = declaredNames.has(result.name)
                return (
                  <div key={result.name} className="flex items-start gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <code className="text-sm font-semibold">{result.name}</code>
                        {result.version ? <span className="text-[11px] text-muted-foreground">v{result.version}</span> : null}
                        {result.publisher ? <span className="text-[11px] text-muted-foreground">by {result.publisher}</span> : null}
                      </div>
                      {result.description ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{result.description}</p> : null}
                    </div>
                    <Button size="sm" variant={added ? "outline" : "default"} disabled={added || busy.isBusy(result.name)} onClick={() => void add(result.name)}>
                      {busy.isBusy(result.name) ? <Loader2 className="animate-spin" /> : null}
                      {added ? "Added" : "Add"}
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Installed packages</CardTitle>
            <CardDescription>
              {sandbox ? `Bundle ${sandbox.sizeKb} KB` : "…"}
              {sandbox && !sandbox.ok ? ` · ${sandbox.errors.length} build problem(s)` : ""}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={busy.isBusy("*")} onClick={() => void recheck()}>
            {busy.isBusy("*") ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Recheck
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking installed packages…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No packages yet"
              message="Search npm above. Packages work in the sandbox when they are pure JavaScript; the badge tells you before you ship."
            />
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {rows.map((row) => (
                <div key={row.name} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-sm font-semibold">{row.name}</code>
                      {row.installed ? <span className="text-[11px] text-muted-foreground">v{row.installed}</span> : null}
                      {row.range ? <span className="text-[11px] text-muted-foreground">declared {row.range}</span> : null}
                      <StatusBadge status={row.status} />
                      {row.runtime === "node" ? (
                        <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                          Node
                        </Badge>
                      ) : null}
                      {row.sizeKb ? <span className="text-[11px] text-muted-foreground">{row.sizeKb} KB</span> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.message}</p>
                  </div>
                  {row.declared ? (
                    <Button size="sm" variant="outline" disabled={busy.isBusy(row.name)} onClick={() => void remove(row.name)}>
                      {busy.isBusy(row.name) ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      Remove
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy.isBusy(row.name)} onClick={() => void add(row.name, row.range)}>
                      {busy.isBusy(row.name) ? <Loader2 className="animate-spin" /> : <Package />}
                      Add
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {sandbox && sandbox.errors.length > 0 ? (
            <Callout kind="danger">
              <p className="font-semibold">This build has sandbox problems</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {sandbox.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
          {sandbox && sandbox.ok && sandbox.warnings.length > 0 ? (
            <Callout kind="warn">
              <ul className="list-disc space-y-0.5 pl-4">
                {sandbox.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
