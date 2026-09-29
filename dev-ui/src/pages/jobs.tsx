import * as React from "react"
import { Play } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { JobTranscript, useJobRunner } from "@/components/job-runner"
import { EmptyState, PageHead } from "@/components/shared"
import type { PluginJobDefinition } from "@/lib/types"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

export function JobsPage() {
  const { bootstrap, setAssistantPage } = useApp()
  useVisit("jobs")
  const manifest = bootstrap!.manifest
  const jobs = manifest.jobs ?? []

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is on the Jobs page. Declared jobs: ${JSON.stringify(jobs.map((job) => job.type))}.`,
      quick: ["Explain what each job does", "Add a job that syncs data periodically"],
    })
  }, [setAssistantPage]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <PageHead
        title="Jobs"
        description={
          <>
            Jobs run against the locally built bundle and the mock store (persisted to <code>.selldoes-dev/db.json</code>). Chunked jobs
            advance one tick at a time, capped by <em>Max ticks</em>; raise it for bigger imports.
          </>
        }
      />

      {jobs.length === 0 ? (
        <EmptyState
          icon={Play}
          title="No jobs declared"
          message={
            <>
              Declare jobs in plugin.json and export <code>jobs: {"{ \"type\": { init, step, finalize } }"}</code> (or a legacy{" "}
              <code>async (input, ctx)</code> function) from your entry.
            </>
          }
        />
      ) : (
        jobs.map((job) => <JobCard key={job.type} job={job} />)
      )}
    </div>
  )
}

function JobCard({ job }: { job: PluginJobDefinition }) {
  const { bootstrap } = useApp()
  const sample = bootstrap!.activity.sampleJobs?.[job.type]
  const { state, run } = useJobRunner()
  const [input, setInput] = React.useState(JSON.stringify(sample?.input ?? {}, null, 2))
  const [maxTicks, setMaxTicks] = React.useState(String(sample?.maxTicks ?? 5))
  const [parseError, setParseError] = React.useState<string | null>(null)

  const runNow = () => {
    let parsed: unknown = {}
    try {
      parsed = input.trim() ? JSON.parse(input) : {}
      setParseError(null)
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error))
      return
    }
    void run(job.type, parsed, Number(maxTicks) || 5)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{job.name ?? job.type}</CardTitle>
          <Badge variant="outline">{job.type}</Badge>
        </div>
        {job.description ? <CardDescription>{job.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px]">
          <div>
            <Label htmlFor={`input-${job.type}`}>Input JSON</Label>
            <Textarea
              id={`input-${job.type}`}
              className="mt-1.5 font-mono text-xs"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            {parseError ? <p className="mt-1 text-[11px] text-destructive">{parseError}</p> : null}
          </div>
          <div>
            <Label htmlFor={`ticks-${job.type}`}>Max ticks</Label>
            <Input
              id={`ticks-${job.type}`}
              className="mt-1.5"
              type="number"
              min={1}
              max={500}
              value={maxTicks}
              onChange={(event) => setMaxTicks(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">One tick = one chunk of work.</p>
          </div>
        </div>
        <Button size="sm" onClick={runNow} disabled={state.running}>
          <Play />
          Run job
        </Button>
        <JobTranscript state={state} />
      </CardContent>
    </Card>
  )
}
