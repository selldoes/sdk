import * as React from "react"
import { Loader2, Plug, Send } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, PageHead } from "@/components/shared"
import { useVisit } from "@/lib/use-visit"
import { cn } from "@/lib/utils"
import { useApp } from "@/state/app"

interface RouteRow {
  path: string
  methods: string[]
  kind: "dashboard" | "public"
  base: string
  full: string
}

export function ApiPage() {
  const { bootstrap, toast, setAssistantPage } = useApp()
  useVisit("api")
  const manifest = bootstrap!.manifest
  const routes: RouteRow[] = [
    ...(manifest.apiRoutes ?? []).map((route) => {
      const base = `/api/plugin-api/${manifest.slug}`
      return { path: route.path, methods: route.methods, kind: "dashboard" as const, base, full: base + route.path }
    }),
    ...(manifest.publicRoutes ?? []).map((route) => {
      const base = `/api/plugin-public/${manifest.slug}`
      return { path: route.path, methods: route.methods, kind: "public" as const, base, full: base + route.path }
    }),
  ]
  const first = routes[0]
  const [method, setMethod] = React.useState(first?.methods?.[0] ?? "GET")
  const [path, setPath] = React.useState(first?.full ?? "")
  const [query, setQuery] = React.useState("")
  const [body, setBody] = React.useState("")
  const [result, setResult] = React.useState("—")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is in the API console. Declared routes: ${JSON.stringify(routes.map((route) => `${route.methods.join("/")} ${route.full}`))}.`,
      quick: ["Explain my API routes", "Add a route that lists records"],
    })
  }, [setAssistantPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setBusy(true)
    setResult("…")
    try {
      const response = await fetch(path + (query.trim() ? `?${query.trim()}` : ""), {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : body || "{}",
      })
      const text = await response.text()
      let formatted = text
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        // keep raw text
      }
      setResult(`${response.status} ${response.statusText}\n\n${formatted}`)
      if (response.ok) toast(`${method} ${path} → ${response.status}`, "success")
      else toast(`${method} ${path} → ${response.status}`, "error")
    } catch (error) {
      setResult(String(error))
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHead
        title="API console"
        description="Pick a declared route, send it, and inspect the JSON your handler returns. Requests run with the same permission checks as production."
      />

      {routes.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No routes declared"
          message={
            <>
              Declare <code>apiRoutes</code> (dashboard) or <code>publicRoutes</code> (visitors) in plugin.json and export matching handlers
              from your entry.
            </>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Declared routes</CardTitle>
              <CardDescription>Click a method to load it into the console.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {routes.map((route) => (
                <div key={`${route.kind}-${route.path}`} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                        route.kind === "dashboard" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700",
                      )}
                    >
                      {route.kind}
                    </span>
                    <code className="truncate text-[10.5px] text-muted-foreground">{route.base + route.path}</code>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {route.methods.map((entry) => (
                      <Button
                        key={entry}
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => {
                          setMethod(entry)
                          setPath(route.full)
                        }}
                      >
                        {entry}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Try a request</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["GET", "POST", "PUT", "PATCH", "DELETE"].map((entry) => (
                      <SelectItem key={entry} value={entry}>
                        {entry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={path} onChange={(event) => setPath(event.target.value)} className="flex-1" />
                <Button onClick={send} disabled={busy || !path}>
                  {busy ? <Loader2 className="animate-spin" /> : <Send />}
                  Send
                </Button>
              </div>
              <div>
                <Label htmlFor="query">Query string</Label>
                <Input
                  id="query"
                  className="mt-1.5"
                  placeholder="storeSlug=dev-store&since=0"
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
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
