import * as React from "react"
import { History, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHead } from "@/components/shared"
import { SkeletonCards } from "@/components/skeletons"
import { dev } from "@/lib/api"
import { timeAgo } from "@/lib/utils"
import type { JobRunDetail, JobRunRow } from "@/lib/types"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

/** Badge colours per job status (the same vocabulary as the platform). */
const STATUS_STYLES: Record<string, string> = {
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-zinc-200 bg-zinc-50 text-zinc-600",
  running: "border-sky-200 bg-sky-50 text-sky-700",
  paused: "border-amber-200 bg-amber-50 text-amber-800",
  pending: "border-zinc-200 bg-zinc-50 text-zinc-600",
}

const TERMINAL = ["completed", "failed", "cancelled"]

/** "1m 12s" between two timestamps. */
function duration(run: JobRunRow): string {
  if (!run.startedAt || !run.completedAt) return ""
  const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ""
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

/**
 * The job history — every background run of this plugin, newest first. The
 * Jobs page renders the declared jobs; this page renders what actually ran:
 * the status, the counters, how long it took and the transcript of every run.
 */
export function JobLogsPage() {
  const { bootstrap, toast, setAssistantPage } = useApp()
  useVisit("job-logs")
  const slug = bootstrap?.manifest.slug ?? ""
  const names = new Map((bootstrap?.manifest.jobs ?? []).map((job) => [job.type, job.name ?? job.type]))
  const [runs, setRuns] = React.useState<JobRunRow[] | null>(null)

  const load = React.useCallback(async () => {
    if (!slug) return
    try {
      const data = await dev.jobRuns(slug, 50)
      setRuns(data.jobs ?? [])
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }, [slug, toast])

  React.useEffect(() => {
    void load()
  }, [load])

  // Follow along while a job is running.
  React.useEffect(() => {
    const timer = setInterval(() => {
      if (runs?.some((run) => !TERMINAL.includes(run.status))) void load()
    }, 4000)
    return () => clearInterval(timer)
  }, [load, runs])

  React.useEffect(() => {
    setAssistantPage({
      context: "The developer is on the Job logs page — the history of every background job run.",
      quick: ["Which job failed?", "What did the last run log?", "How long did the last import take?"],
    })
  }, [setAssistantPage])

  return (
    <div className="space-y-4">
      <PageHead
        title="Job logs"
        description={
          <>
            Every background job run of this plugin — status, counters, duration and the transcript of each run. The{" "}
            <em>Jobs</em> page renders the declared jobs; this page shows what actually ran.
          </>
        }
        action={
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw />
            Refresh
          </Button>
        }
      />

      {runs && runs.length > 0 ? (
        <div className="space-y-3">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} name={names.get(run.type) ?? run.type} slug={slug} />
          ))}
        </div>
      ) : runs ? (
        <Card>
          <CardContent className="py-10 text-center">
            <History className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm font-semibold">No job has run yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Run a job from the <em>Jobs</em> page (or let a schedule fire) — every run is logged here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <SkeletonCards count={2} rows={3} />
      )}
    </div>
  )
}

function RunCard({ run, name, slug }: { run: JobRunRow; name: string; slug: string }) {
  const [detail, setDetail] = React.useState<JobRunDetail | null>(null)
  const [open, setOpen] = React.useState(false)

  const loadDetail = React.useCallback(async () => {
    try {
      setDetail(await dev.jobRun(slug, run.id))
    } catch {
      setDetail(null)
    }
  }, [slug, run.id])

  React.useEffect(() => {
    if (open && !detail) void loadDetail()
  }, [open, detail, loadDetail])

  const bits: string[] = []
  const total = Number(run.total) || 0
  const processed = Number(run.processed) || 0
  if (processed || total) bits.push(`${processed}${total ? `/${total}` : ""} processed`)
  if (run.failed) bits.push(`${run.failed} failed`)
  if (run.skipped) bits.push(`${run.skipped} skipped`)
  if (run.runtime) bits.push(run.runtime)
  const took = duration(run)
  if (took) bits.push(took)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{name}</CardTitle>
          <Badge variant="outline" className="font-mono">
            {run.type}
          </Badge>
          <Badge variant="outline" className={STATUS_STYLES[run.status] ?? ""}>
            {run.status}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {bits.join(" · ")}
            {bits.length > 0 ? " · " : ""}
            {timeAgo(run.completedAt ?? run.startedAt ?? run.createdAt)}
          </span>
        </div>
        {run.error ? <CardDescription className="text-destructive">{run.error}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide transcript" : "Show transcript"}
        </Button>
        {open ? <Transcript detail={detail} /> : null}
      </CardContent>
    </Card>
  )
}

function Transcript({ detail }: { detail: JobRunDetail | null }) {
  if (!detail) {
    return <p className="mt-3 text-xs text-muted-foreground">Loading the transcript…</p>
  }
  const items = detail.items ?? []
  const logs = detail.logs ?? []
  return (
    <div className="mt-3 space-y-3">
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-[11.5px]">
            <thead className="bg-muted/50 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Item</th>
                <th className="px-3 py-1.5 font-medium">Status</th>
                <th className="px-3 py-1.5 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.ref}-${index}`} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono">{item.ref ?? "item"}</td>
                  <td className="px-3 py-1.5">{item.status}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {item.error ?? (item.data ? JSON.stringify(item.data) : item.productId ? `#${item.productId}` : "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {logs.length > 0 ? (
        <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11.5px]">
          {logs.map((entry) => `[${entry.level ?? "info"}] ${entry.message ?? ""}`).join("\n")}
        </pre>
      ) : null}
      {detail.job?.result !== undefined && detail.job?.result !== null ? (
        <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11.5px]">
          {JSON.stringify(detail.job.result, null, 2)}
        </pre>
      ) : null}
      {items.length === 0 && logs.length === 0 ? (
        <p className="text-xs text-muted-foreground">This run has no transcript.</p>
      ) : null}
    </div>
  )
}
