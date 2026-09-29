import * as React from "react"
import { Database, Loader2, RefreshCw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHead } from "@/components/shared"
import { dev } from "@/lib/api"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

interface TableInfo {
  rows: number
  columns: string[]
  sample: unknown[]
}

export function DataPage() {
  const { toast, setAssistantPage } = useApp()
  useVisit("data")
  const [tables, setTables] = React.useState<Record<string, TableInfo> | null>(null)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const data = await dev.tables()
      setTables(data.tables)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }, [toast])

  React.useEffect(() => {
    setAssistantPage({
      context: "The developer is inspecting the mock store data written by the plugin.",
      quick: ["Explain the mock store", "What tables should my plugin create?"],
    })
  }, [setAssistantPage])

  React.useEffect(() => {
    void load()
  }, [load])

  const reset = async () => {
    if (!window.confirm("Reset the mock store? Every table the plugin created will be emptied.")) return
    setBusy(true)
    try {
      await dev.resetData()
      await load()
      toast("Mock data reset", "success")
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHead
        title="Store data"
        description={
          <>
            Everything the plugin writes locally lives here (<code>.selldoes-dev/db.json</code>). Rows are store-scoped, exactly like
            production.
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw />
          Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={() => void reset()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Reset mock data
        </Button>
      </div>

      {tables && Object.keys(tables).length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(tables).map(([name, table]) => (
            <Card key={name}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">{name}</CardTitle>
                  <Badge variant="outline">{table.rows} row(s)</Badge>
                </div>
                <CardDescription className="truncate">{table.columns.join(", ") || "no columns yet"}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11px]">
                  {JSON.stringify(table.sample, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : tables ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Database className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm font-semibold">No tables yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Run a job or hit an API route that calls <code>ctx.db.ensureTable()</code> — the table shows up here.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
