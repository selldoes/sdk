import * as React from "react"
import { dev } from "@/lib/api"
import type { JobRun, JobTelemetry } from "@/lib/api"
import { Badge } from "@/components/ui/badge"

export interface JobRunState {
  running?: boolean
  error?: string
  run?: JobRun
  telemetry?: JobTelemetry
  type?: string
}

export function useJobRunner() {
  const [state, setState] = React.useState<JobRunState>({})

  /** Runs a job; resolves with the error (if any) so callers can self-heal. */
  const run = React.useCallback(async (type: string, input?: unknown, maxTicks?: number): Promise<{ error?: string } | undefined> => {
    setState({ running: true, type })
    try {
      const data = await dev.runJob({ type, input: input ?? {}, maxTicks: maxTicks ?? 5 })
      if (data.error) {
        setState({ error: data.error, type })
        return { error: data.error }
      }
      setState({ run: data.run, telemetry: data.telemetry, type })
      return {}
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setState({ error: message, type })
      return { error: message }
    }
  }, [])

  return { state, run, reset: () => setState({}) }
}

export function JobTranscript({ state }: { state: JobRunState }) {
  if (state.running) {
    return <p className="mt-3 text-xs text-muted-foreground">Running…</p>
  }
  if (state.error) {
    return (
      <pre className="mt-3 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11.5px]">{state.error}</pre>
    )
  }
  if (!state.run) return null

  const run = state.run
  const telemetry = state.telemetry ?? {}
  const progress = telemetry.progress ?? []
  const last = progress[progress.length - 1]
  const items = telemetry.items ?? []
  const logs = telemetry.logs ?? []

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={run.done ? "border-0 bg-emerald-100 text-emerald-700" : "border-0 bg-amber-100 text-amber-700"}>
          {run.done ? "completed" : "paused at tick limit"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {run.kind || "job"} · {run.ticks || 0} tick(s)
        </span>
      </div>

      {last ? (
        <>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${last.total ? Math.min(100, Math.round(((last.processed ?? 0) / last.total) * 100)) : 0}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {last.processed !== undefined ? `${last.processed}${last.total !== undefined ? `/${last.total}` : ""} processed` : ""}
            {last.failed ? ` · ${last.failed} failed` : ""}
            {last.skipped ? ` · ${last.skipped} skipped` : ""}
            {last.message ? ` · ${last.message}` : ""}
          </p>
        </>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-[11.5px]">
            <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5 text-left">Item</th>
                <th className="px-2.5 py-1.5 text-left">Status</th>
                <th className="px-2.5 py-1.5 text-left">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.slice(0, 20).map((item, index) => (
                <tr key={index}>
                  <td className="px-2.5 py-1.5">
                    <code className="text-[10.5px]">{item.ref}</code>
                  </td>
                  <td className="px-2.5 py-1.5">{item.status}</td>
                  <td className="px-2.5 py-1.5 text-muted-foreground">
                    {item.error || (item.data ? JSON.stringify(item.data) : item.productId ? `#${item.productId}` : "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 20 ? <p className="px-2.5 py-1.5 text-[10.5px] text-muted-foreground">… {items.length - 20} more</p> : null}
        </div>
      ) : null}

      {logs.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Show {logs.length} log line(s)</summary>
          <pre className="mt-1.5 max-h-52 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11px]">
            {logs.map((entry, index) => `[${entry.level || "info"}] ${entry.message}`).join("\n")}
          </pre>
        </details>
      ) : null}

      <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11px]">
        {JSON.stringify(run.done ? run.result : run, null, 2)}
      </pre>
    </div>
  )
}
