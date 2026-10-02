import * as React from "react"
import { Check, LayoutDashboard, Loader2, Play, Puzzle, ShieldAlert, Sparkles, Square } from "lucide-react"
import { AppIcon } from "@/components/app-icon"
import { PermissionList } from "@/components/permission-list"
import { JobTranscript, useJobRunner } from "@/components/job-runner"
import { PageHead, Callout, EmptyState } from "@/components/shared"
import { SkeletonCard } from "@/components/skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { dev } from "@/lib/api"
import type { PluginConfigField, SettingsResponse } from "@/lib/types"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

export function DashboardPage() {
  const { bootstrap, setAssistantOpen, setAssistantPage } = useApp()
  useVisit("dashboard")
  const manifest = bootstrap!.manifest
  const store = bootstrap!.store
  const hasUi = Boolean(manifest.ui?.entry)

  React.useEffect(() => {
    setAssistantPage({
      context: hasUi
        ? "The developer is previewing their plugin's dashboard UI in the sandboxed iframe."
        : "The developer is previewing the host's standard settings + jobs page (plugin has no ui.entry).",
      quick: ["Scaffold a dashboard UI for this plugin", "Explain the settings + jobs page"],
    })
  }, [setAssistantPage, hasUi])

  if (hasUi) {
    const source = `/api/plugins/${manifest.slug}/ui/${manifest.ui!.entry}?storeId=${store.id}&storeSlug=${encodeURIComponent(store.slug)}`
    return (
      <div className="space-y-4">
        <PageHead
          title="Dashboard page"
          description={
            <>
              Rendered exactly like the host does — a sandboxed iframe calling{" "}
              <code>/api/plugin-api/{manifest.slug}/…</code> with the mock store.
            </>
          }
        />
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <LayoutDashboard className="h-4 w-4" />
                  Your UI
                </CardTitle>
                <CardDescription>
                  Source: <code>{manifest.ui!.entry}</code> · rebuilt on every file save.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => window.open(source, "_blank")}>
                Open raw
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <iframe
              key={source}
              src={source}
              title="Plugin dashboard UI"
              className="h-[720px] w-full rounded-xl border border-border bg-white"
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  // No ui.entry: replicate the host's standard page.
  return (
    <div className="space-y-4">
      <PageHead
        title="Dashboard page"
        description={
          <>
            This plugin has no <code>ui.entry</code>, so the host renders its standard page: identity, permissions, settings (from{" "}
            <code>configSchema</code>) and runnable jobs. This is a faithful replica.
          </>
        }
      />
      <Callout kind="info">
        Want your own UI instead? Add <code>ui.entry</code> to plugin.json and export a page — the host will render it in a sandboxed
        iframe.{" "}
        <button type="button" className="font-semibold underline" onClick={() => setAssistantOpen(true)}>
          Ask the AI assistant to scaffold one
        </button>
        .
      </Callout>

      <HostPageReplica />
    </div>
  )
}

function TrustBadge() {
  return (
    <Badge className="border-0 bg-orange-100 text-orange-700">
      <ShieldAlert className="mr-1 h-3 w-3" />
      Unverified
    </Badge>
  )
}

function HostPageReplica() {
  const { bootstrap, toast, setAssistantOpen } = useApp()
  const manifest = bootstrap!.manifest
  const [settings, setSettings] = React.useState<SettingsResponse | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<Record<string, unknown>>({})
  const [saving, setSaving] = React.useState(false)
  const { state, run } = useJobRunner()
  const jobs = manifest.jobs ?? []
  const permissions = (manifest.permissions ?? []) as string[]

  const loadSettings = React.useCallback(async () => {
    try {
      const data = await dev.settings()
      const values: Record<string, unknown> = {}
      for (const field of data.configSchema) {
        values[field.key] = data.settings[field.key] ?? field.default ?? (field.type === "boolean" ? false : "")
      }
      setForm(values)
      setSettings(data)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const fields: PluginConfigField[] = settings?.configSchema ?? []

  const save = async () => {
    setSaving(true)
    try {
      await dev.saveSettings(form)
      toast("Settings saved — plugin code sees them as ctx.config", "success")
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setSaving(false)
    }
  }

  if (loadError && settings === null) {
    return (
      <Callout kind="danger">
        <p className="font-semibold">Could not load the host page settings</p>
        <p className="mt-0.5 text-[12px]">{loadError}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void loadSettings()}>
          Retry
        </Button>
      </Callout>
    )
  }

  if (settings === null) {
    return (
      <div className="space-y-4" aria-busy="true">
        <SkeletonCard rows={4} />
        <SkeletonCard rows={2} />
        <SkeletonCard rows={5} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <AppIcon name={manifest.icon} imageUrl={manifest.iconUrl} />
            <div className="min-w-0 flex-1">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {manifest.name}
                <Badge variant="outline">v{manifest.version}</Badge>
                <TrustBadge />
                <Badge className="border-0 bg-emerald-100 text-emerald-700">enabled</Badge>
              </CardTitle>
              <CardDescription className="mt-1">{manifest.description}</CardDescription>
            </div>
          </div>
          <div className="max-w-3xl pt-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Permissions</p>
            <PermissionList permissions={permissions} allowedTables={manifest.allowedTables ?? []} compact />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutDashboard className="h-4 w-4" />
            Health
          </CardTitle>
          <CardDescription>Production shows real metrics here. The preview has no usage yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {[
              { label: "Jobs", value: 0, hint: "0 in 7d" },
              { label: "Completed", value: 0, hint: "0 failed" },
              { label: "Ticks (24h)", value: 0, hint: "0 running" },
              { label: "Events (24h)", value: 0, hint: "0 installs" },
              { label: "Errors (24h)", value: 0, hint: "none" },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border px-3 py-2">
                <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
                <p className="text-lg font-semibold">{item.value}</p>
                <p className="truncate text-[10.5px] text-muted-foreground">{item.hint}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {fields.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Settings</CardTitle>
            <CardDescription>
              Declared by <code>configSchema</code>. Saved values live in <code>.selldoes-dev/settings.json</code> and are merged into{" "}
              <code>ctx.config</code> so your code sees them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`field-${field.key}`}>
                  {field.label}
                  {field.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                {field.type === "boolean" ? (
                  <Switch
                    id={`field-${field.key}`}
                    checked={Boolean(form[field.key])}
                    onCheckedChange={(checked) => setForm((previous) => ({ ...previous, [field.key]: checked }))}
                  />
                ) : field.type === "select" ? (
                  <Select
                    value={String(form[field.key] ?? "")}
                    onValueChange={(value) => setForm((previous) => ({ ...previous, [field.key]: value }))}
                  >
                    <SelectTrigger id={`field-${field.key}`}>
                      <SelectValue placeholder={field.placeholder || "Select…"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options ?? []).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === "text" ? (
                  <Textarea
                    id={`field-${field.key}`}
                    value={String(form[field.key] ?? "")}
                    placeholder={field.placeholder}
                    onChange={(event) => setForm((previous) => ({ ...previous, [field.key]: event.target.value }))}
                  />
                ) : (
                  <Input
                    id={`field-${field.key}`}
                    type={field.type === "number" ? "number" : field.type === "secret" ? "password" : "text"}
                    value={String(form[field.key] ?? "")}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value,
                      }))
                    }
                  />
                )}
                {field.description ? <p className="text-[11px] text-muted-foreground">{field.description}</p> : null}
              </div>
            ))}
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Check />}
              Save settings
            </Button>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={Puzzle}
          title="No settings"
          message={
            <>
              Declare <code>configSchema</code> in plugin.json to add a settings form here. Users can then configure the plugin per store.
            </>
          }
          action={
            <Button size="sm" onClick={() => setAssistantOpen(true)}>
              <Sparkles />
              Ask AI to add settings
            </Button>
          }
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Jobs</CardTitle>
          <CardDescription>
            Production runs jobs in the background in small chunks. Here they run against the mock store immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {jobs.length > 0 ? (
              jobs.map((job) => (
                <Button key={job.type} size="sm" variant="outline" disabled={state.running} onClick={() => void run(job.type, {}, 10)}>
                  <Play />
                  {job.name ?? job.type}
                </Button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">This plugin declares no jobs.</p>
            )}
          </div>
          <JobTranscript state={state} />
        </CardContent>
      </Card>
    </div>
  )
}
