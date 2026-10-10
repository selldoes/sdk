import * as React from "react"
import { Link } from "react-router-dom"
import { CalendarClock, Loader2, Play, Plus } from "lucide-react"
import { MonacoEditor } from "@/components/code/monaco-editor"
import { CreateJobDialog } from "@/components/create-dialogs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { JobTranscript, useJobRunner } from "@/components/job-runner"
import { Callout, EmptyState, PageHead } from "@/components/shared"
import { dev } from "@/lib/api"
import { healMissingDeclaration, parseMissingDeclaration } from "@/lib/self-heal"
import type { PluginJobDefinition, PluginManifest, PluginScheduleDefinition, Validation } from "@/lib/types"
import { useDevStream } from "@/lib/use-dev-stream"
import { useVisit } from "@/lib/use-visit"
import { ws } from "@/lib/ws-api"
import type { WsBootstrap } from "@/lib/ws-api"
import { useApp } from "@/state/app"

/**
 * Runs `attempt` (which resolves the server error, if any) and self-heals
 * missing plugin.json declarations:
 *
 *  1. refuse → save the missing permission/allowedTables → retry
 *  2. still refused → the declaration was already in plugin.json, so this
 *     preview process predates it → restart the workspace preview → retry
 *  3. still refused → explain what to do (standalone `selldoes dev` has no
 *     supervisor and must be restarted by hand)
 */
async function runWithDeclarationHeal(
  attempt: () => Promise<{ error?: string } | undefined>,
  deps: {
    manifest: PluginManifest
    applyManifest: (manifest: PluginManifest, validation: Validation) => void
    refresh: () => Promise<void>
    toast: (message: string, type: "success" | "error") => void
    workspace: WsBootstrap | null
    refreshWorkspace: () => Promise<void>
    onNote?: (note: string | null) => void
  },
) {
  const { onNote, toast } = deps
  const healed = new Set<string>()
  let restarted = false
  for (let step = 0; step < 4; step += 1) {
    const result = await attempt()
    const missing = result?.error ? parseMissingDeclaration(result.error) : null
    if (!missing) return
    const key = `${missing.kind}:${missing.value}`
    if (!healed.has(key)) {
      // A declaration we haven't written yet — save it and try again.
      healed.add(key)
      try {
        const { changed } = await healMissingDeclaration(missing, deps)
        const where = missing.kind === "table" ? "allowedTables" : "plugin.json"
        onNote?.(
          changed
            ? `Auto-declared "${missing.value}" in ${where}${missing.action ? ` (required for ${missing.action})` : ""} — the action re-ran automatically. It is ticked on the Permissions page now.`
            : `"${missing.value}" was already declared in ${where} — retrying. If it stays blocked, the running preview predates the declaration.`,
        )
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
        return
      }
      continue
    }
    if (!restarted && deps.workspace?.current) {
      // Already on disk, still refused: this process booted before it existed.
      try {
        restarted = true
        onNote?.(`The running preview was started before "${missing.value}" was declared — restarting it to apply the declaration…`)
        await ws.restart()
        await deps.refreshWorkspace()
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
        return
      }
      continue
    }
    toast(
      restarted
        ? `Still blocked on "${missing.value}" after restarting the preview — check the preview log for errors`
        : `Still blocked on "${missing.value}" — the running dev server started before the declaration was saved. Restart \`selldoes dev\` to apply it.`,
      "error",
    )
    return
  }
}

export function JobsPage() {
  const { bootstrap, setAssistantPage, applyManifest, refresh, toast } = useApp()
  useVisit("jobs")
  const manifest = bootstrap!.manifest
  const jobs = manifest.jobs ?? []
  const schedules = bootstrap!.schedules ?? []

  // ── Creation: New job (scaffold into jobs/ or server/ + plugin.json) ─────
  const [createOpen, setCreateOpen] = React.useState(false)

  const handleScaffolded = React.useCallback(
    (next: PluginManifest, validation: Validation, message: string) => {
      applyManifest(next, validation)
      toast(message, "success")
      void refresh()
    },
    [applyManifest, refresh, toast],
  )

  // One stream for the page — job cards reload their source when jobs/ or
  // server/ files change (or after a rebuild).
  const [sourceBump, setSourceBump] = React.useState(0)
  useDevStream(
    (event) => {
      if (event.type === "files" && event.paths.some((path) => path.startsWith("jobs/") || path.startsWith("server/"))) {
        setSourceBump((nonce) => nonce + 1)
      }
      if (event.type === "build") setSourceBump((nonce) => nonce + 1)
    },
    { key: manifest.slug },
  )

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is on the Jobs page. Declared jobs: ${JSON.stringify(jobs.map((job) => job.type))}. Schedules: ${JSON.stringify(
        schedules.map((schedule) => ({ job: schedule.job, cron: schedule.cron })),
      )}.`,
      quick: ["Explain what each job does", "Add a job that syncs data periodically"],
    })
  }, [setAssistantPage]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <PageHead
        title="Jobs"
        description={
          <>
            Background workers rendered from their source — QuickJS jobs (<code>jobs/&lt;type&gt;.js</code>) tick through work in chunks;
            Node jobs (<code>server/&lt;type&gt;.js</code>) run once with full npm access. <em>Test</em> runs against the mock store
            (persisted to <code>.selldoes-dev/db.json</code>). Schedules show the next fire time and can be run now.
          </>
        }
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            New job
          </Button>
        }
      />

      {schedules.length > 0 ? (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4" /> Schedules
          </h2>
          {schedules.map((schedule) => (
            <ScheduleCard key={schedule.name ?? schedule.job} schedule={schedule} />
          ))}
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <EmptyState
          icon={Play}
          title="No jobs declared"
          message={
            <>
              Declare jobs in plugin.json and export <code>jobs: {"{ \"type\": { init, step, finalize } }"}</code> (or an{" "}
              <code>async (input, ctx)</code> function) from your entry — or scaffold one.
            </>
          }
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus />
              New job
            </Button>
          }
        />
      ) : (
        jobs.map((job) => <JobCard key={job.type} job={job} bump={sourceBump} />)
      )}

      <CreateJobDialog open={createOpen} onOpenChange={setCreateOpen} onScaffolded={handleScaffolded} />
    </div>
  )
}

function ScheduleCard({ schedule }: { schedule: PluginScheduleDefinition }) {
  const { state, run } = useJobRunner()
  const { bootstrap, applyManifest, refresh, toast, workspace, refreshWorkspace } = useApp()
  const next = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null

  /** Run now — self-heals missing plugin.json declarations like the Test button. */
  const runNow = () =>
    runWithDeclarationHeal(() => run(schedule.job, schedule.input ?? {}), {
      manifest: bootstrap!.manifest,
      applyManifest,
      refresh,
      toast,
      workspace,
      refreshWorkspace,
    })

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{schedule.name ?? schedule.job}</CardTitle>
          <Badge variant="outline" className="font-mono">
            {schedule.cron}
          </Badge>
          <Badge variant="outline">{schedule.timezone}</Badge>
          {schedule.enabled === false ? (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
              paused
            </Badge>
          ) : null}
        </div>
        <CardDescription>
          Enqueues <code>{schedule.job}</code>
          {next ? ` · next run ${next.toLocaleString()}` : ""}
          {schedule.error ? ` · ${schedule.error}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" variant="outline" onClick={() => void runNow()} disabled={state.running}>
          <Play />
          Run now
        </Button>
        <JobTranscript state={state} />
      </CardContent>
    </Card>
  )
}

/**
 * Best-effort extraction of a job's `{ … }` block from an entry file where the
 * job is defined inline (`{ "import-products": { init, step } }`). Brace
 * matching is string/comment aware; returns null when the key or its block
 * can't be found so callers can fall back to the whole file.
 *
 * Deliberately NOT exported: a non-component export next to `JobsPage` would
 * stop Vite React Fast Refresh from accepting this module.
 */
function extractJobBlock(source: string, type: string): string | null {
  const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const patterns = [new RegExp(`["']${escaped}["']\\s*:\\s*`, "g"), new RegExp(`\\b${escaped}\\s*:\\s*`, "g")]
  let keyMatch: RegExpExecArray | null = null
  for (const pattern of patterns) {
    keyMatch = pattern.exec(source)
    if (keyMatch) break
  }
  if (!keyMatch) return null
  const start = source.indexOf("{", keyMatch.index)
  if (start === -1) return null

  let depth = 0
  let inString: string | null = null
  let inLineComment = false
  let inBlockComment = false
  for (let index = start; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]
    if (inLineComment) {
      if (char === "\n") inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false
        index++
      }
      continue
    }
    if (inString) {
      if (char === "\\") {
        index++
        continue
      }
      if (char === inString) inString = null
      continue
    }
    if (char === "/" && next === "/") {
      inLineComment = true
      index++
      continue
    }
    if (char === "/" && next === "*") {
      inBlockComment = true
      index++
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      inString = char
      continue
    }
    if (char === "{") depth++
    else if (char === "}") {
      depth--
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

function JobCard({ job, bump }: { job: PluginJobDefinition; bump: number }) {
  const { bootstrap, theme, applyManifest, refresh, toast, workspace, refreshWorkspace } = useApp()
  const sample = bootstrap!.activity.sampleJobs?.[job.type]
  const { state, run } = useJobRunner()
  const [input, setInput] = React.useState(JSON.stringify(sample?.input ?? {}, null, 2))
  const [maxTicks, setMaxTicks] = React.useState(String(sample?.maxTicks ?? 5))
  const [parseError, setParseError] = React.useState<string | null>(null)
  /** Persistent, visible record when the self-heal declared something — not a vanishing toast. */
  const [healNote, setHealNote] = React.useState<string | null>(null)
  const nodeJob = job.runtime === "node"

  // ── Source: jobs/<type>.js (QuickJS), server/<type>.js (Node), or inline
  // in the entry file (the common case — jobs exported straight from index.js).
  const conventional = nodeJob ? `server/${job.type}.js` : `jobs/${job.type}.js`
  const alternate = nodeJob ? `jobs/${job.type}.js` : `server/${job.type}.js`
  const entry = String(bootstrap!.manifest.entry ?? "index.js").replace(/^\.\//, "").replace(/\\/g, "/")
  const [source, setSource] = React.useState<{ path: string; label: string; content: string; inline: boolean } | null>(null)
  const [missing, setMissing] = React.useState(false)

  const loadSource = React.useCallback(async () => {
    for (const candidate of [conventional, alternate, entry]) {
      if (!candidate) continue
      try {
        const data = await dev.readFile(candidate)
        const inline = candidate === entry && candidate !== conventional && candidate !== alternate
        // Inline jobs share the entry file — show just this job's block when we can find it.
        const block = inline ? extractJobBlock(data.content, job.type) : null
        setSource({
          path: data.path,
          label: inline ? (block ? `${data.path} → jobs["${job.type}"]` : `${data.path} · job defined inline`) : data.path,
          content: block ?? data.content,
          inline,
        })
        setMissing(false)
        return
      } catch {
        // try the next candidate
      }
    }
    setSource(null)
    setMissing(true)
  }, [conventional, alternate, entry, job.type])

  React.useEffect(() => {
    void loadSource()
  }, [loadSource, bump])

  /**
   * Test = just run it. Missing plugin.json declarations (permission /
   * allowedTables) are saved and retried; if the preview process still refuses
   * a declaration that is already on disk, it is restarted and retried once.
   */
  const runHealed = React.useCallback(
    async (input: unknown, ticks: number) => {
      setHealNote(null)
      await runWithDeclarationHeal(() => run(job.type, input, ticks), {
        manifest: bootstrap!.manifest,
        applyManifest,
        refresh,
        toast,
        workspace,
        refreshWorkspace,
        onNote: setHealNote,
      })
    },
    [run, job.type, bootstrap, applyManifest, refresh, toast, workspace, refreshWorkspace],
  )

  /** Test runs the declared sample input — the happy path, no typing required. */
  const runTest = () => {
    void runHealed(sample?.input ?? {}, sample?.maxTicks ?? 5)
  }

  const runNow = () => {
    let parsed: unknown = {}
    try {
      parsed = input.trim() ? JSON.parse(input) : {}
      setParseError(null)
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error))
      return
    }
    void runHealed(parsed, Number(maxTicks) || 5)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{job.name ?? job.type}</CardTitle>
          <Badge variant="outline">{job.type}</Badge>
          {nodeJob ? (
            <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
              Node
            </Badge>
          ) : (
            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
              QuickJS
            </Badge>
          )}
        </div>
        {job.description ? <CardDescription>{job.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {source ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
              <code className="truncate text-[10.5px] text-muted-foreground">{source.label}</code>
              <Link
                to={`/code?file=${encodeURIComponent(source.path)}`}
                className="shrink-0 text-[11px] font-medium text-primary hover:underline"
              >
                Open in editor
              </Link>
            </div>
            <div className="h-64">
              <MonacoEditor path={source.path} value={source.content} readOnly theme={theme} />
            </div>
          </div>
        ) : missing ? (
          <Callout kind="warn">
            <p>
              Source not found — looked for <code>{conventional}</code>, <code>{alternate}</code> and <code>{entry}</code>. If the job is
              defined inline, make sure the entry exports it as <code>jobs["{job.type}"]</code>.
            </p>
          </Callout>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={runTest} disabled={state.running}>
            {state.running ? <Loader2 className="animate-spin" /> : <Play />}
            Test
          </Button>
          <span className="text-[11px] text-muted-foreground">
            runs against the mock store{sample ? ` · sample input · max ${sample.maxTicks ?? 5} ticks` : " · empty input · 5 ticks"}
          </span>
        </div>

        {healNote ? <Callout kind="success">{healNote}</Callout> : null}

        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            Advanced — input JSON & max ticks
          </summary>
          <div className="space-y-3 border-t border-border p-3">
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
              {nodeJob ? (
                <div>
                  <Label>Runtime</Label>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Runs once on the Node runtime
                    {job.timeoutMs ? ` · ${Math.round(job.timeoutMs / 1000)}s timeout` : ""}
                    {job.memoryMb ? ` · ${job.memoryMb} MB` : ""}.
                  </p>
                </div>
              ) : (
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
              )}
            </div>
            <Button size="sm" variant="outline" onClick={runNow} disabled={state.running}>
              <Play />
              Run job
            </Button>
          </div>
        </details>

        <JobTranscript state={state} />
      </CardContent>
    </Card>
  )
}
