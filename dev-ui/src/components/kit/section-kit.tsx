import * as React from "react"
import { AlertTriangle, ExternalLink, Play, RefreshCw } from "lucide-react"
import { JobTranscript, useJobRunner } from "@/components/job-runner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { dev } from "@/lib/api"
import type { PluginConfigField, PluginDashboardSection, SettingsResponse } from "@/lib/types"
import { useApp } from "@/state/app"

/**
 * The no-code components kit — renders `dashboardPages[].sections` inside the
 * preview shell (no iframe). Same idea as the store's section registries:
 * declarative JSON in the manifest, one shared renderer. Unknown types render
 * a placeholder so forward-compatible manifests don't break the page.
 */

interface KitProps {
  slug: string
  store: { id: number; slug: string }
  sections: PluginDashboardSection[]
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
  return value.replace(/[&<>"']/g, (char) => map[char] ?? char)
}

/** Minimal markdown: paragraphs, **bold**, `code`, - lists. */
function miniMarkdown(body: string): string {
  const escaped = escapeHtml(body)
  return escaped
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n")
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`
      }
      return `<p>${lines.map(inline).join("<br/>")}</p>`
    })
    .join("")
}

function inline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-[12px]">$1</code>')
}

export function SectionKit({ slug, store, sections }: KitProps) {
  return (
    <div className="space-y-4">
      {sections.map((section, index) => (
        <SectionView key={str(section.id) || `${section.type}-${index}`} slug={slug} store={store} section={section} />
      ))}
    </div>
  )
}

function SectionView({ slug, store, section }: { slug: string; store: KitProps["store"]; section: PluginDashboardSection }) {
  const settings = (section.settings ?? {}) as Record<string, unknown>
  switch (section.type) {
    case "text":
      return <TextSection settings={settings} />
    case "stats":
      return <StatsSection settings={settings} />
    case "table":
      return <TableSection slug={slug} store={store} settings={settings} />
    case "job":
      return <JobSection settings={settings} />
    case "settings":
      return <SettingsSection />
    case "logs":
      return <LogsSection settings={settings} />
    case "links":
      return <LinksSection settings={settings} />
    default:
      return (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Unknown component type <code>{section.type}</code> — the host may render it; the preview doesn’t know it yet.
          </CardContent>
        </Card>
      )
  }
}

function TextSection({ settings }: { settings: Record<string, unknown> }) {
  const title = str(settings.title)
  const body = str(settings.body)
  if (!title && !body) return null
  return (
    <Card>
      {title ? <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader> : null}
      <CardContent>
        <div className="prose prose-sm max-w-none text-sm text-muted-foreground [&_li]:my-0.5 [&_p]:my-1.5" dangerouslySetInnerHTML={{ __html: miniMarkdown(body) }} />
      </CardContent>
    </Card>
  )
}

function StatsSection({ settings }: { settings: Record<string, unknown> }) {
  const items = (Array.isArray(settings.items) ? settings.items : []) as { label?: unknown; value?: unknown; hint?: unknown }[]
  if (items.length === 0) return null
  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-2.5 pt-6 sm:grid-cols-4">
        {items.map((item, index) => (
          <div key={index} className="rounded-lg border border-border px-3 py-2">
            <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{str(item.label, "stat")}</p>
            <p className="text-lg font-semibold">{str(item.value, "—")}</p>
            {item.hint ? <p className="truncate text-[10.5px] text-muted-foreground">{str(item.hint)}</p> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function TableSection({ slug, store, settings }: { slug: string; store: KitProps["store"]; settings: Record<string, unknown> }) {
  const route = str(settings.route)
  const [rows, setRows] = React.useState<Record<string, unknown>[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [nonce, setNonce] = React.useState(0)

  React.useEffect(() => {
    if (!route) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(
          `/api/plugin-api/${slug}${route.startsWith("/") ? route : `/${route}`}?storeId=${store.id}&storeSlug=${encodeURIComponent(store.slug)}`,
          { headers: { "Content-Type": "application/json" } },
        )
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string }
        if (cancelled) return
        if (!response.ok || body.error) throw new Error(body.error || `Request failed (${response.status})`)
        // Handlers may wrap rows: { rows: [...] } | { items: [...] } | [...] | { <key>: [...] }
        const candidate = Array.isArray(body) ? body : Array.isArray(body.rows) ? body.rows : Array.isArray(body.items) ? body.items : null
        const nested = !candidate && body && typeof body === "object" ? Object.values(body).find((value) => Array.isArray(value)) : null
        setRows(((candidate ?? nested) as Record<string, unknown>[] | null) ?? [])
        setError(null)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug, store.id, store.slug, route, nonce])

  const columns = rows && rows.length > 0 && Array.isArray(settings.columns)
    ? (settings.columns as unknown[]).map(String)
    : rows && rows.length > 0
      ? [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8)
      : []

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{str(settings.title, "Data")}</CardTitle>
            {route ? <CardDescription><code>{route}</code></CardDescription> : null}
          </div>
          <Button size="sm" variant="outline" onClick={() => setNonce((value) => value + 1)}>
            <RefreshCw />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!route ? (
          <p className="text-sm text-muted-foreground">This table needs a <code>route</code> in its settings.</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="px-2.5 py-1.5 text-left">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, Number(settings.maxRows) || 50).map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column} className="max-w-[280px] truncate px-2.5 py-1.5">
                        {row[column] === null || row[column] === undefined ? "—" : typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function JobSection({ settings }: { settings: Record<string, unknown> }) {
  const type = str(settings.job)
  const { state, run } = useJobRunner()
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{str(settings.title, type ? `Job: ${type}` : "Job")}</CardTitle>
        {settings.description ? <CardDescription>{str(settings.description)}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {!type ? (
          <p className="text-sm text-muted-foreground">This job runner needs a <code>job</code> type in its settings.</p>
        ) : (
          <>
            <Button size="sm" disabled={state.running} onClick={() => void run(type, settings.input ?? {}, Number(settings.maxTicks) || 20)}>
              <Play />
              {state.running ? "Running…" : `Run ${type}`}
            </Button>
            <JobTranscript state={state} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function LogsSection({ settings }: { settings: Record<string, unknown> }) {
  const [logs, setLogs] = React.useState<string[]>([])
  React.useEffect(() => {
    let cancelled = false
    void dev.logs().then((data) => {
      if (!cancelled) setLogs(data.logs ?? [])
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const count = Number(settings.lines) || 20
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{str(settings.title, "Dev logs")}</CardTitle>
        <CardDescription>Live dev-server output — the production host streams job logs instead.</CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11px]">
          {logs.slice(-count).join("\n") || "(no log lines yet)"}
        </pre>
      </CardContent>
    </Card>
  )
}

function LinksSection({ settings }: { settings: Record<string, unknown> }) {
  const items = (Array.isArray(settings.items) ? settings.items : []) as { label?: unknown; href?: unknown }[]
  if (items.length === 0) return null
  return (
    <Card>
      <CardContent className="flex flex-wrap gap-2 pt-6">
        {items.map((item, index) => (
          <Button key={index} asChild size="sm" variant="outline">
            <a href={str(item.href, "#")} target="_blank" rel="noreferrer">
              {str(item.label, "link")}
              <ExternalLink />
            </a>
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}

/** The plugin's configSchema form — same fields the host's settings page renders. */
function SettingsSection() {
  const { toast } = useApp()
  const [settings, setSettings] = React.useState<SettingsResponse | null>(null)
  const [form, setForm] = React.useState<Record<string, unknown>>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void dev
      .settings()
      .then((data) => {
        if (cancelled) return
        const values: Record<string, unknown> = {}
        for (const field of data.configSchema) {
          values[field.key] = data.settings[field.key] ?? field.default ?? (field.type === "boolean" ? false : "")
        }
        setForm(values)
        setSettings(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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

  if (settings === null) return null
  if (fields.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          No <code>configSchema</code> declared — add settings fields in plugin.json to render a form here.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Settings</CardTitle>
        <CardDescription>From <code>configSchema</code> — saved values merge into <code>ctx.config</code>.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`kit-${field.key}`}>
              {field.label}
              {field.required ? <span className="text-destructive"> *</span> : null}
            </Label>
            {field.type === "boolean" ? (
              <Switch
                id={`kit-${field.key}`}
                checked={Boolean(form[field.key])}
                onCheckedChange={(checked) => setForm((previous) => ({ ...previous, [field.key]: checked }))}
              />
            ) : field.type === "select" ? (
              <Select value={String(form[field.key] ?? "")} onValueChange={(value) => setForm((previous) => ({ ...previous, [field.key]: value }))}>
                <SelectTrigger id={`kit-${field.key}`}>
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
                id={`kit-${field.key}`}
                value={String(form[field.key] ?? "")}
                placeholder={field.placeholder}
                onChange={(event) => setForm((previous) => ({ ...previous, [field.key]: event.target.value }))}
              />
            ) : (
              <Input
                id={`kit-${field.key}`}
                type={field.type === "number" ? "number" : field.type === "secret" ? "password" : "text"}
                value={String(form[field.key] ?? "")}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value }))
                }
              />
            )}
            {field.description ? <p className="text-[11px] text-muted-foreground">{field.description}</p> : null}
          </div>
        ))}
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </CardContent>
    </Card>
  )
}
