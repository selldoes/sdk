import * as React from "react"
import { Link } from "react-router-dom"
import { AlertCircle, Check, ChevronRight, ListChecks, Play, Puzzle, Rocket, Shield, Sparkles } from "lucide-react"
import { PageHead, Callout, EmptyState, SectionTitle } from "@/components/shared"
import { JobTranscript, useJobRunner } from "@/components/job-runner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { buildChecklist } from "@/lib/checklist"
import { highestRisk } from "@/lib/permissions"
import { useVisit } from "@/lib/use-visit"
import { cn } from "@/lib/utils"
import { useApp } from "@/state/app"

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tracking-tight">{value}</p>
      {hint ? <p className="truncate text-[10.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function OverviewPage() {
  const { bootstrap, setAssistantPage, setAssistantOpen } = useApp()
  const { state, run } = useJobRunner()
  useVisit("overview")
  const manifest = bootstrap!.manifest
  const validation = bootstrap!.validation
  const activity = bootstrap!.activity
  const jobs = manifest.jobs ?? []
  const routes = [...(manifest.apiRoutes ?? []), ...(manifest.publicRoutes ?? [])]
  const checklist = buildChecklist(manifest, activity, validation)
  const doneCount = checklist.filter((item) => item.done).length

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is on the Overview page. Plugin surface: ${jobs.length} job(s), ${routes.length} API route(s), ui=${
        manifest.ui?.entry ?? "none"
      }.`,
      quick: jobs.length
        ? ["Explain what each job in this plugin does", "What should I build next?"]
        : ["What should I build next?", "Add a background job and explain it"],
    })
  }, [setAssistantPage, jobs.length, routes.length, manifest.ui?.entry])

  return (
    <div className="space-y-5">
      <PageHead
        title="Overview"
        description={
          <>
            <strong>{manifest.name}</strong> · {manifest.description} — local preview. Nothing here touches a real store.
          </>
        }
      />

      {validation.errors.length > 0 ? (
        <Callout kind="danger">
          <p className="font-semibold">Validation found problems</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <Button asChild size="sm" variant="outline" className="mt-2">
            <Link to="/ship">
              <Rocket />
              Open Validate &amp; publish
            </Link>
          </Button>
        </Callout>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="h-4 w-4" />
                  Your checklist
                </CardTitle>
                <CardDescription>Work top to bottom — the preview updates as you go.</CardDescription>
              </div>
              <span
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-semibold",
                  doneCount === checklist.length ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
                )}
              >
                {doneCount} of {checklist.length} done
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round((doneCount / checklist.length) * 100)}%` }}
              />
            </div>
            <div className="space-y-1.5">
              {checklist.map((item) => (
                <Link
                  key={item.key}
                  to={item.to}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-muted"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      item.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-border",
                    )}
                  >
                    {item.done ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[13px] font-semibold", item.done && "text-muted-foreground line-through")}>
                      {item.title}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{item.note}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {jobs.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Play className="h-4 w-4" />
                  Run it
                </CardTitle>
                <CardDescription>
                  Runs declared jobs against the mock store. Full controls live in{" "}
                  <Link to="/jobs" className="text-primary hover:underline">
                    Jobs
                  </Link>
                  .
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <div className="flex flex-wrap gap-2">
                  {jobs.map((job, index) => (
                    <Button
                      key={job.type}
                      size="sm"
                      variant={index === 0 ? "default" : "outline"}
                      disabled={state.running}
                      onClick={() =>
                        void run(job.type, activity.sampleJobs?.[job.type]?.input ?? {}, activity.sampleJobs?.[job.type]?.maxTicks ?? 5)
                      }
                    >
                      {job.name ?? job.type}
                    </Button>
                  ))}
                </div>
                <JobTranscript state={state} />
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={Play}
              title="No jobs yet"
              message="Jobs are background tasks — imports, syncs, anything slow. Declare one in plugin.json and export a handler."
              action={
                <>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/jobs">See how jobs work</Link>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setAssistantOpen(true)
                    }}
                  >
                    <Sparkles />
                    Ask AI to add one
                  </Button>
                </>
              }
            />
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Puzzle className="h-4 w-4" />
                What this plugin exposes
              </CardTitle>
              <CardDescription>
                Everything comes from <code>plugin.json</code>. Edit metadata on the{" "}
                <Link to="/details" className="text-primary hover:underline">
                  Details
                </Link>{" "}
                page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Dashboard routes" value={String((manifest.apiRoutes ?? []).length)} />
                <Stat label="Public routes" value={String((manifest.publicRoutes ?? []).length)} />
                <Stat label="Jobs" value={String(jobs.length)} />
                <Stat label="Hooks" value={String(Object.keys(manifest.hooks ?? {}).length)} />
                <Stat
                  label="Storefront pages"
                  value={String((manifest.storefrontPages ?? []).length) + (manifest.storefrontWidget?.entry ? " + widget" : "")}
                />
                <Stat label="Permissions" value={String((manifest.permissions ?? []).length)} hint={`highest ${highestRisk(manifest.permissions as string[])}`} />
              </div>
            </CardContent>
          </Card>

          {validation.warnings.length > 0 ? (
            <Callout kind="warn">
              <p className="font-semibold">{validation.warnings.length} warning(s)</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
        </div>
      </div>

      <SectionTitle>Where to go next</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { to: "/details", title: "Edit details", note: "Description, icon and screenshots.", icon: AlertCircle },
          { to: "/permissions", title: "Edit permissions", note: "Requested permissions and allowed tables.", icon: Shield },
          { to: "/listing", title: "See the listing", note: "Marketplace card, install dialog and dashboard page.", icon: Rocket },
          { to: "/ship", title: "Ship it", note: "Validate, build and publish for review.", icon: Check },
        ].map((entry) => (
          <Link key={entry.to} to={entry.to} className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted">
            <entry.icon className="mb-2 h-4 w-4 text-primary" />
            <p className="text-[13px] font-bold">{entry.title}</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{entry.note}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
