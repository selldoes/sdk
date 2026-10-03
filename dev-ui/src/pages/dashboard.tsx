import * as React from "react"
import { useSearchParams } from "react-router-dom"
import {
  Check,
  ExternalLink,
  FileCode2,
  LayoutDashboard,
  Loader2,
  Play,
  Plus,
  Puzzle,
  Route as RouteIcon,
  ShieldAlert,
  Sparkles,
  Square,
  Webhook,
} from "lucide-react"
import { AppIcon, resolveIcon } from "@/components/app-icon"
import { SectionBuilder } from "@/components/kit/section-builder"
import { SectionKit } from "@/components/kit/section-kit"
import { PermissionList } from "@/components/permission-list"
import { JobTranscript, useJobRunner } from "@/components/job-runner"
import { PageHead, Callout, EmptyState } from "@/components/shared"
import { SkeletonCard } from "@/components/skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { dev } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { PluginConfigField, PluginDashboardSection, PluginManifest, SettingsResponse, UiEntriesResponse, Validation } from "@/lib/types"
import { useDevStream } from "@/lib/use-dev-stream"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

interface ResolvedPage {
  label: string
  path: string
  icon?: string
  group?: string
  entry: string | null
  sections?: PluginDashboardSection[]
}

type CreateKind = "page" | "job" | "hook" | "route"
type PageMode = "components" | "html"

export function DashboardPage() {
  const { bootstrap, setAssistantPage, applyManifest, refresh, toast } = useApp()
  useVisit("dashboard")
  const manifest = bootstrap!.manifest
  const store = bootstrap!.store
  const [params, setParams] = useSearchParams()

  // ── UI entry status (which declared pages exist in source + dist) ─────────
  const [entries, setEntries] = React.useState<UiEntriesResponse | null>(null)
  const [scaffolding, setScaffolding] = React.useState(false)
  const [frameNonce, setFrameNonce] = React.useState(0)

  const loadEntries = React.useCallback(async () => {
    try {
      setEntries(await dev.uiEntries())
    } catch {
      setEntries(null)
    }
  }, [])

  React.useEffect(() => {
    void loadEntries()
  }, [loadEntries, manifest.slug])

  // UI file saves + rebuilds keep the status (and the iframe) fresh.
  useDevStream(
    (event) => {
      if (event.type === "files" && event.paths.some((path) => path.startsWith("ui/"))) void loadEntries()
      if (event.type === "build") setFrameNonce((nonce) => nonce + 1)
    },
    { key: manifest.slug },
  )

  // ── Pages: dashboardPages[] with per-page entries, else the bare ui.entry ──
  const pages: ResolvedPage[] = React.useMemo(() => {
    const normalize = (value?: string | null) => (value ? String(value).replace(/^\.\//, "").replace(/\\/g, "/") : null)
    const declared: ResolvedPage[] = []
    for (const page of manifest.dashboardPages ?? []) {
      const entry = normalize(page.entry) ?? normalize(manifest.ui?.entry)
      // A page that declares sections (even empty) needs no entry — the kit renders it natively.
      if (!entry && !Array.isArray(page.sections)) continue
      declared.push({ label: page.label, path: page.path, icon: page.icon, group: page.group, entry, sections: page.sections })
    }
    if (declared.length === 0 && normalize(manifest.ui?.entry)) {
      return [
        {
          label: manifest.ui?.title ?? manifest.name,
          path: "/",
          icon: manifest.icon,
          entry: normalize(manifest.ui?.entry)!,
        },
      ]
    }
    return declared
  }, [manifest])

  const hasUi = pages.length > 0
  const activePath = params.get("page") ?? pages[0]?.path ?? "/"
  const activePage = pages.find((page) => page.path === activePath) ?? pages[0] ?? null
  const activeStatus = activePage ? entries?.entries.find((entry) => entry.entry === activePage.entry) ?? null : null

  // ── Scaffold the default notes UI (button + in-iframe fallback postMessage) ─
  const scaffold = React.useCallback(
    async (entry?: string) => {
      setScaffolding(true)
      try {
        const result = await dev.scaffoldUi(entry ? { entry } : {})
        applyManifest(result.manifest, result.validation)
        if (result.written.length) toast(`Created ${result.written.join(", ")}`, "success")
        else toast("Notes UI already present — rebuilt", "success")
        if (result.rebuildError) toast(result.rebuildError, "error")
        await refresh()
        await loadEntries()
        setFrameNonce((nonce) => nonce + 1)
        const defaultEntry = String(result.manifest.ui?.entry ?? "").replace(/^\.\//, "")
        const landed = (result.manifest.dashboardPages ?? []).find(
          (page) => (page.entry ? String(page.entry).replace(/^\.\//, "") : defaultEntry) === result.entry,
        )
        if (landed?.path && landed.path !== params.get("page")) setParams({ page: landed.path }, { replace: true })
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      } finally {
        setScaffolding(false)
      }
    },
    [applyManifest, loadEntries, params, refresh, setParams, toast],
  )

  // The fallback page inside the iframe posts back to its parent (same-origin).
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; slug?: string; entry?: string }
      if (!data || data.type !== "selldoes:ui-scaffold") return
      if (data.slug && data.slug !== manifest.slug) return
      void scaffold(typeof data.entry === "string" && data.entry ? data.entry : undefined)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [manifest.slug, scaffold])

  const rebuild = React.useCallback(async () => {
    try {
      await dev.rebuild()
      setFrameNonce((nonce) => nonce + 1)
      await loadEntries()
      toast("UI rebuilt", "success")
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }, [loadEntries, toast])

  // ── Components builder (dashboardPages[].sections) ────────────────────────
  const [builderOpen, setBuilderOpen] = React.useState(false)

  // ── Creation: New page / New job / New hook / New route ───────────────────
  const [createKind, setCreateKind] = React.useState<CreateKind | null>(null)

  const handleScaffolded = React.useCallback(
    (next: PluginManifest, validation: Validation, message: string, extra?: { pagePath?: string; openBuilder?: boolean }) => {
      applyManifest(next, validation)
      toast(message, "success")
      void refresh()
      void loadEntries()
      setFrameNonce((nonce) => nonce + 1)
      if (extra?.pagePath) setParams({ page: extra.pagePath }, { replace: true })
      if (extra?.openBuilder) setBuilderOpen(true)
    },
    [applyManifest, loadEntries, refresh, setParams, toast],
  )

  const activeSections = activePage?.sections ?? []

  React.useEffect(() => {
    setAssistantPage({
      context: hasUi
        ? `The developer is previewing dashboard page "${activePage?.label}" — ${activeSections.length > 0 ? "rendered from dashboardPages sections (no-code components)" : "a sandboxed iframe"}; they can add pages/jobs/hooks/routes from the Dashboard page and edit components or ask the AI to rearrange them.`
        : "The developer is previewing the host's standard settings + jobs page (plugin has no ui.entry).",
      quick: hasUi
        ? ["Add a new dashboard page with a job runner", "Convert this page to no-code components", "Scaffold an import job for my scraper"]
        : ["Scaffold a dashboard UI for this plugin", "Explain the settings + jobs page"],
    })
  }, [setAssistantPage, hasUi, activePage?.label, activeSections.length])

  if (!hasUi) {
    return (
      <>
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
          <CreateBar onPick={setCreateKind} />
          <Callout kind="info">
            Want your own UI instead? Scaffold the default notes example — it wires <code>ui.entry</code>,{" "}
            <code>dashboardPages</code> and a working notes app you can build on.{" "}
            <Button size="sm" variant="outline" className="ml-1" disabled={scaffolding} onClick={() => void scaffold()}>
              {scaffolding ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Scaffold the notes dashboard UI
            </Button>
          </Callout>

          <HostPageReplica />
        </div>
        <CreateDialog kind={createKind} onOpenChange={(open) => { if (!open) setCreateKind(null) }} onScaffolded={handleScaffolded} />
      </>
    )
  }

  const hasSections = activeSections.length > 0
  const source = activePage!.entry
    ? `/api/plugins/${manifest.slug}/ui/${activePage!.entry}?storeId=${store.id}&storeSlug=${encodeURIComponent(store.slug)}&v=${frameNonce}`
    : null

  // Group rail items the way the host sidebar does.
  const groups: { group: string | null; pages: ResolvedPage[] }[] = []
  for (const page of pages) {
    const key = page.group ?? null
    const bucket = groups.find((entry) => entry.group === key)
    if (bucket) bucket.pages.push(page)
    else groups.push({ group: key, pages: [page] })
  }

  return (
    <>
      <div className="space-y-4">
        <PageHead
          title="Dashboard page"
          description={
            <>
              Rendered exactly like the host does — a sandboxed iframe calling{" "}
              <code>/api/plugin-api/{manifest.slug}/…</code> with the mock store, or the no-code components kit when a page declares{" "}
              <code>sections</code>.
            </>
          }
        />
        <CreateBar onPick={setCreateKind} />

        {activePage!.entry && activeStatus && !activeStatus.sourceExists ? (
          <Callout kind="danger">
            <p className="font-semibold">
              Page entry <code>{activePage!.entry}</code> doesn’t exist in the plugin source
            </p>
            <p className="mt-0.5 text-[12px]">
              Create the file under <code>ui/</code>, fix <code>plugin.json</code>, or scaffold the default notes example for this page.
            </p>
            <Button size="sm" className="mt-2" disabled={scaffolding} onClick={() => void scaffold(activePage!.entry!)}>
              {scaffolding ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {scaffolding ? "Creating…" : `Create ${activePage!.entry}`}
            </Button>
          </Callout>
        ) : activePage!.entry && activeStatus && activeStatus.sourceExists && !activeStatus.builtExists ? (
          <Callout kind="warn">
            <span>
              <code>{activePage!.entry}</code> exists in source but is not in the built UI output yet — it should appear after the next
              rebuild.
            </span>
            <Button size="sm" variant="outline" className="ml-2" disabled={scaffolding} onClick={() => void rebuild()}>
              <Play />
              Rebuild
            </Button>
          </Callout>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Sidebar pages</CardTitle>
              <CardDescription className="text-[11.5px]">From <code>dashboardPages</code> in plugin.json.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {groups.map((bucket) => (
                <div key={bucket.group ?? "__ungrouped__"} className="space-y-1">
                  {bucket.group ? (
                    <p className="px-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">{bucket.group}</p>
                  ) : null}
                  {bucket.pages.map((page) => {
                    const Icon = resolveIcon(page.icon)
                    const isActive = page.path === activePage?.path
                    return (
                      <button
                        key={page.path}
                        type="button"
                        onClick={() => setParams(page.path === "/" ? {} : { page: page.path })}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12.5px] transition-colors",
                          isActive ? "border-primary bg-primary/5 font-semibold" : "border-border hover:bg-muted",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{page.label}</span>
                        <code className="shrink-0 text-[9.5px] text-muted-foreground">
                          {page.entry ? page.entry.replace(/^ui\//, "") : "kit"}
                        </code>
                      </button>
                    )
                  })}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LayoutDashboard className="h-4 w-4" />
                    {activePage!.label}
                    {hasSections ? <Badge className="border-0 bg-violet-100 text-violet-700">components</Badge> : null}
                  </CardTitle>
                  <CardDescription>
                    {hasSections ? (
                      <>
                        Rendered from <code>dashboardPages[].sections</code> — no iframe. Edit JSON or ask the AI to rearrange.
                      </>
                    ) : (
                      <>
                        Source: <code>{activePage!.entry}</code> · rebuilt on every file save.
                      </>
                    )}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setBuilderOpen(true)}>
                    <Sparkles />
                    {hasSections ? "Edit components" : "Add components"}
                  </Button>
                  {source ? (
                    <Button size="sm" variant="outline" onClick={() => window.open(source, "_blank")}>
                      <ExternalLink />
                      Open raw
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {hasSections ? (
                <SectionKit slug={manifest.slug} store={store} sections={activeSections} />
              ) : source ? (
                <iframe
                  key={source}
                  src={source}
                  title={`Plugin dashboard UI — ${activePage!.label}`}
                  className="h-[720px] w-full rounded-xl border border-border bg-white"
                />
              ) : (
                <Callout kind="info">
                  <p>
                    This page has no components yet — open the builder to add the first one, or scaffold the notes UI as an iframe
                    fallback.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setBuilderOpen(true)}>
                      <Sparkles />
                      Add components
                    </Button>
                    <Button size="sm" variant="outline" disabled={scaffolding} onClick={() => void scaffold()}>
                      {scaffolding ? <Loader2 className="animate-spin" /> : <Play />}
                      Scaffold the notes UI
                    </Button>
                  </div>
                </Callout>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CreateDialog kind={createKind} onOpenChange={(open) => { if (!open) setCreateKind(null) }} onScaffolded={handleScaffolded} />

      <SectionBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        slug={manifest.slug}
        store={store}
        manifest={manifest}
        pageLabel={activePage!.label}
        pagePath={activePage!.path}
        hasEntry={Boolean(activePage!.entry)}
        sections={activeSections}
      />
    </>
  )
}

/** The creation bar — New page / New job / New hook / New route. */
function CreateBar({ onPick }: { onPick: (kind: CreateKind) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => onPick("page")}>
        <Plus />
        New page
      </Button>
      <Button size="sm" variant="outline" onClick={() => onPick("job")}>
        <FileCode2 />
        New job
      </Button>
      <Button size="sm" variant="outline" onClick={() => onPick("hook")}>
        <Webhook />
        New hook
      </Button>
      <Button size="sm" variant="outline" onClick={() => onPick("route")}>
        <RouteIcon />
        New route
      </Button>
      <span className="text-[11px] text-muted-foreground">
        codegen into <code>ui/</code>, <code>jobs/</code>, <code>hooks/</code>, <code>routes/</code> + plugin.json, wired automatically
      </span>
    </div>
  )
}

/** Dialog for the four creation kinds — writes files, patches the manifest, rebuilds. */
function CreateDialog({
  kind,
  onOpenChange,
  onScaffolded,
}: {
  kind: CreateKind | null
  onOpenChange: (open: boolean) => void
  onScaffolded: (manifest: PluginManifest, validation: Validation, message: string, extra?: { pagePath?: string; openBuilder?: boolean }) => void
}) {
  const { bootstrap, toast } = useApp()
  const [label, setLabel] = React.useState("")
  const [path, setPath] = React.useState("")
  const [icon, setIcon] = React.useState("")
  const [type, setType] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [pageMode, setPageMode] = React.useState<PageMode>("components")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (kind) {
      setLabel("")
      setPath("")
      setIcon("")
      setType("")
      setDescription("")
      setPageMode("components")
    }
  }, [kind])

  const titles: Record<CreateKind, { title: string; blurb: string }> = {
    page: {
      title: "New dashboard page",
      blurb:
        "A components page adds a dashboardPages entry (no iframe) and opens the visual builder; an HTML page scaffolds the notes example under ui/.",
    },
    job: { title: "New job", blurb: "Creates jobs/<type>.js (init/step/finalize skeleton), declares it in plugin.json and wires it into the entry." },
    hook: { title: "New hook", blurb: "Creates hooks/<name>.js, declares it in plugin.json and wires it into the entry." },
    route: { title: "New API route", blurb: "Creates routes/<path>.js, declares it in apiRoutes and wires it into the entry." },
  }

  const ready = kind === "page" ? label.trim().length > 0 : kind === "job" ? type.trim().length > 0 : kind === "hook" ? label.trim().length > 0 : (path.trim() || label.trim()).length > 0

  const submit = async () => {
    if (!kind || !ready) return
    setBusy(true)
    try {
      if (kind === "page") {
        const name = label.trim()
        const rawPath = path.trim() || `/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page"}`
        const pagePath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`
        if (pageMode === "html") {
          const entry = pagePath === "/" ? "ui/index.html" : `ui/${pagePath.replace(/^\//, "").replace(/\/$/, "")}.html`
          const result = await dev.scaffoldUi({ entry, label: name, path: pagePath, ...(icon.trim() ? { icon: icon.trim() } : {}) })
          onScaffolded(result.manifest, result.validation, result.written.length ? `Page created: ${result.written.join(", ")}` : "Page UI already present — rebuilt", { pagePath })
        } else {
          const current = bootstrap?.manifest
          if (!current) throw new Error("The plugin manifest is not loaded yet")
          const next = JSON.parse(JSON.stringify(current)) as PluginManifest
          const list = Array.isArray(next.dashboardPages) ? next.dashboardPages : []
          if (list.some((page) => page.path === pagePath)) throw new Error(`A dashboard page at "${pagePath}" already exists`)
          const page: NonNullable<PluginManifest["dashboardPages"]>[number] = { label: name, path: pagePath, sections: [] }
          if (icon.trim()) page.icon = icon.trim()
          list.push(page)
          next.dashboardPages = list
          const response = await dev.saveManifest(next)
          onScaffolded(response.manifest, response.validation, `Components page created: ${pagePath}`, { pagePath, openBuilder: true })
        }
      } else if (kind === "job") {
        const result = await dev.scaffoldJob({
          type: type.trim(),
          ...(label.trim() ? { name: label.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        })
        onScaffolded(result.manifest, result.validation, `Job scaffolded: ${result.file}`)
      } else if (kind === "hook") {
        const result = await dev.scaffoldHook({ name: label.trim() })
        onScaffolded(result.manifest, result.validation, `Hook scaffolded: ${result.file}`)
      } else if (kind === "route") {
        const result = await dev.scaffoldRoute({ path: (path.trim() || label.trim()).startsWith("/") ? (path.trim() || label.trim()) : `/${path.trim() || label.trim()}` })
        onScaffolded(result.manifest, result.validation, `Route scaffolded: ${result.file}`)
      }
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  if (!kind) return null
  const meta = titles[kind]

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription>{meta.blurb}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {kind === "page" ? (
            <>
              <div className="space-y-1.5">
                <Label>Page type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["components", "html"] as PageMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPageMode(mode)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left transition-colors",
                        pageMode === mode ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
                      )}
                    >
                      <span className="block text-[12.5px] font-semibold">{mode === "components" ? "Components" : "HTML"}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                        {mode === "components" ? "No-code kit — build it in the visual builder" : "Notes example under ui/ (iframe)"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-label">Label</Label>
                <Input id="create-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Reports" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-path">Path (optional)</Label>
                <Input id="create-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/reports" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-icon">Icon (optional lucide name)</Label>
                <Input id="create-icon" value={icon} onChange={(event) => setIcon(event.target.value)} placeholder="bar-chart-2" />
              </div>
            </>
          ) : null}
          {kind === "job" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="create-type">Job type</Label>
                <Input id="create-type" value={type} onChange={(event) => setType(event.target.value)} placeholder="import-products" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-label">Display name (optional)</Label>
                <Input id="create-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Import products" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-desc">Description (optional)</Label>
                <Input id="create-desc" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Walks the catalog in chunks" />
              </div>
            </>
          ) : null}
          {kind === "hook" ? (
            <div className="space-y-1.5">
              <Label htmlFor="create-label">Hook name (event)</Label>
              <Input id="create-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="order:delivered" autoFocus />
            </div>
          ) : null}
          {kind === "route" ? (
            <div className="space-y-1.5">
              <Label htmlFor="create-path">Route path</Label>
              <Input id="create-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/stats" autoFocus />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!ready || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
