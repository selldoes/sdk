import type * as React from "react"
import { LinksItemsEditor, StatsItemsEditor } from "@/components/kit/section-builder/items-editors"
import { JsonField } from "@/components/kit/section-builder/json-field"
import { RawSectionEditor } from "@/components/kit/section-builder/raw-section-editor"
import { settingsOf, str } from "@/components/kit/section-builder/shared"
import { Callout } from "@/components/shared"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { PluginDashboardSection, PluginManifest } from "@/lib/types"

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-[10.5px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function SectionSettings({
  section,
  manifest,
  onChange,
  onReplace,
}: {
  section: PluginDashboardSection
  manifest: PluginManifest
  onChange: (patch: Record<string, unknown>) => void
  onReplace: (section: PluginDashboardSection) => void
}) {
  const settings = settingsOf(section)
  switch (section.type) {
    case "text":
      return (
        <>
          <Field label="Title">
            <Input
              value={str(settings.title)}
              placeholder="Overview"
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </Field>
          <Field label="Body" hint={<>Markdown: **bold**, `code`, - lists.</>}>
            <Textarea rows={8} value={str(settings.body)} onChange={(event) => onChange({ body: event.target.value })} />
          </Field>
        </>
      )
    case "stats":
      return (
        <StatsItemsEditor items={Array.isArray(settings.items) ? settings.items : []} onChange={(items) => onChange({ items })} />
      )
    case "table": {
      const routes = manifest.apiRoutes ?? []
      const route = str(settings.route)
      const columns = Array.isArray(settings.columns) ? (settings.columns as unknown[]).map(String) : []
      return (
        <>
          <Field label="Title">
            <Input value={str(settings.title)} placeholder="Data" onChange={(event) => onChange({ title: event.target.value })} />
          </Field>
          <Field label="API route" hint="The handler returns an array, { rows: [...] } or { items: [...] }.">
            {routes.length > 0 ? (
              <Select value={route} onValueChange={(value) => onChange({ route: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a route…" />
                </SelectTrigger>
                <SelectContent>
                  {routes.map((entry) => (
                    <SelectItem key={entry.path} value={entry.path}>
                      {entry.path}
                    </SelectItem>
                  ))}
                  {route && !routes.some((entry) => entry.path === route) ? (
                    <SelectItem value={route}>{route} (custom)</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            ) : (
              <Input value={route} placeholder="/stats" onChange={(event) => onChange({ route: event.target.value })} />
            )}
          </Field>
          <Field label="Columns" hint="Comma-separated; empty infers them from the first rows.">
            <Input
              value={columns.join(", ")}
              placeholder="sku, price, stock"
              onChange={(event) =>
                onChange({
                  columns: event.target.value
                    .split(",")
                    .map((column) => column.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Max rows">
            <Input
              type="number"
              value={String(settings.maxRows ?? 50)}
              onChange={(event) => onChange({ maxRows: Number(event.target.value) || 50 })}
            />
          </Field>
        </>
      )
    }
    case "job": {
      const jobs = manifest.jobs ?? []
      const job = str(settings.job)
      return (
        <>
          <Field label="Title">
            <Input
              value={str(settings.title)}
              placeholder="Run a job"
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </Field>
          <Field label="Job">
            {jobs.length > 0 ? (
              <Select value={job} onValueChange={(value) => onChange({ job: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a job…" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((entry) => (
                    <SelectItem key={entry.type} value={entry.type}>
                      {entry.name ?? entry.type}
                    </SelectItem>
                  ))}
                  {job && !jobs.some((entry) => entry.type === job) ? <SelectItem value={job}>{job} (custom)</SelectItem> : null}
                </SelectContent>
              </Select>
            ) : (
              <Input value={job} placeholder="import-products" onChange={(event) => onChange({ job: event.target.value })} />
            )}
          </Field>
          <Field label="Description">
            <Input
              value={str(settings.description)}
              placeholder="Walks the catalog in chunks"
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </Field>
          <Field label="Input (JSON)" hint="Passed to the job's init/step as input.">
            <JsonField value={settings.input} onChange={(value) => onChange({ input: value })} placeholder='{ "limit": 10 }' />
          </Field>
          <Field label="Max ticks">
            <Input
              type="number"
              value={String(settings.maxTicks ?? 20)}
              onChange={(event) => onChange({ maxTicks: Number(event.target.value) || 20 })}
            />
          </Field>
        </>
      )
    }
    case "logs":
      return (
        <>
          <Field label="Title">
            <Input
              value={str(settings.title)}
              placeholder="Dev logs"
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </Field>
          <Field label="Lines">
            <Input
              type="number"
              value={String(settings.lines ?? 20)}
              onChange={(event) => onChange({ lines: Number(event.target.value) || 20 })}
            />
          </Field>
        </>
      )
    case "links":
      return (
        <LinksItemsEditor items={Array.isArray(settings.items) ? settings.items : []} onChange={(items) => onChange({ items })} />
      )
    case "settings":
      return (
        <Callout kind="info">
          Renders the plugin's <code>configSchema</code> form ({manifest.configSchema?.length ?? 0} field
          {manifest.configSchema?.length === 1 ? "" : "s"}) — values are saved per store. No options to configure here.
        </Callout>
      )
    case "field": {
      const configFields = manifest.configSchema ?? []
      const key = str(settings.key)
      return (
        <>
          <Field label="Config field" hint="One configSchema field, saved immediately — compose a form inside a Group.">
            {configFields.length > 0 ? (
              <Select value={key} onValueChange={(value) => onChange({ key: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a field…" />
                </SelectTrigger>
                <SelectContent>
                  {configFields.map((entry) => (
                    <SelectItem key={entry.key} value={entry.key}>
                      {entry.label || entry.key}
                    </SelectItem>
                  ))}
                  {key && !configFields.some((entry) => entry.key === key) ? (
                    <SelectItem value={key}>{key} (custom)</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            ) : (
              <Input value={key} placeholder="aiModel" onChange={(event) => onChange({ key: event.target.value })} />
            )}
          </Field>
          <Field label="Title">
            <Input
              value={str(settings.title)}
              placeholder="Optional card title"
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </Field>
          <Field label="Description">
            <Input
              value={str(settings.description)}
              placeholder="Optional helper text under the title"
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </Field>
        </>
      )
    }
    case "group":
      return (
        <>
          <Field label="Title">
            <Input
              value={str(settings.title)}
              placeholder="Review imports"
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </Field>
          <Field label="Description">
            <Input
              value={str(settings.description)}
              placeholder="Optional helper text under the title"
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </Field>
          <Field label="Collapsible" hint="The header toggles the whole group.">
            <Switch
              checked={settings.collapsible !== false}
              onCheckedChange={(checked) => onChange({ collapsible: checked, ...(checked ? {} : { defaultOpen: true }) })}
            />
          </Field>
          <Field label="Open by default" hint="The collapsed state is remembered per group title in localStorage.">
            <Switch checked={settings.defaultOpen !== false} onCheckedChange={(checked) => onChange({ defaultOpen: checked })} />
          </Field>
          <Field
            label="Nested sections (JSON)"
            hint="Same shape as the page's sections array — they render flat inside the group."
          >
            <JsonField
              value={settings.sections ?? []}
              onChange={(value) => onChange({ sections: value })}
              placeholder='[{ "type": "job", "settings": { "job": "import-products" } }]'
              rows={8}
            />
          </Field>
        </>
      )
    default:
      return <RawSectionEditor section={section} onReplace={onReplace} />
  }
}
