import * as React from "react"
import { useSearchParams } from "react-router-dom"
import {
  Check,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  Play,
  Plus,
  Puzzle,
  ShieldAlert,
  Sparkles,
} from "lucide-react"
import { AppIcon, resolveIcon } from "@/components/app-icon"
import { ChoiceTile } from "@/components/create-dialogs"
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
import { useBusySet } from "@/lib/use-busy"
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

type PageMode = "components" | "html"

export function DashboardPage() {
  const { bootstrap, setAssistantPage, applyManifest, refresh, toast } = useApp()
  useVisit("dashboard")
  const manifest = bootstrap!.manifest
  const store = bootstrap!.store
  const [params, setParams] = useSearchParams()

  // ── UI entry status (which declared pages exist in source + dist) ─────────
  const [entries, setEntries] = React.useState<UiEntriesResponse | null>(null)
  const busy = useBusySet()
  const { run: runBusy } = busy
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
      // Each scaffold target gets its own busy key so concurrent scaffolds
      // each keep their own spinner instead of clearing each other.
      await runBusy(`scaffold:${entry ?? "*"}`, async () => {
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
        }
      })
    },
    [applyManifest, loadEntries, params, refresh, runBusy, setParams, toast],
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
    await runBusy("rebuild", async () => {
      try {
        await dev.rebuild()
        setFrameNonce((nonce) => nonce + 1)
        await loadEntries()
        toast("UI rebuilt", "success")
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      }
    })
  }, [loadEntries, runBusy, toast])

  // ── Components builder (dashboardPages[].sections) ────────────────────────
  const [builderOpen, setBuilderOpen] = React.useState(false)

  // ── Creation: New page (jobs/hooks/routes live on their own pages) ────────
  const [createOpen, setCreateOpen] = React.useState(false)

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
        ? `The developer is previewing dashboard page "${activePage?.label}" — ${activeSections.length > 0 ? "rendered from dashboardPages sections (no-code components)" : "a sandboxed iframe"}; they can add new dashboard pages from here, edit components or ask the AI to rearrange them (jobs, hooks and API routes have their own pages).`
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
            title="Dashboard"
            description={
              <>
                This plugin has no <code>ui.entry</code>, so the host renders its standard page: identity, permissions, settings (from{" "}
                <code>configSchema</code>) and runnable jobs. This is a faithful replica.
              </>
            }
          />
          <CreatePageBar onPick={() => setCreateOpen(true)} />
          <Callout kind="info">
            Want your own UI instead? Scaffold the default notes example — it wires <code>ui.entry</code>,{" "}
            <code>dashboardPages</code> and a working notes app you can build on.{" "}
            <Button size="sm" variant="outline" className="ml-1" disabled={busy.isBusy("scaffold:*")} onClick={() => void scaffold()}>
              {busy.isBusy("scaffold:*") ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Scaffold the notes dashboard UI
            </Button>
          </Callout>

          <HostPageReplica />
        </div>
        <CreatePageDialog open={createOpen} onOpenChange={setCreateOpen} onScaffolded={handleScaffolded} />
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
          title="Dashboard"
          description={
            <>
              Rendered exactly like the host does — a sandboxed iframe calling{" "}
              <code>/api/plugin-api/{manifest.slug}/…</code> with the mock store, or the no-code components kit when a page declares{" "}
              <code>sections</code>.
            </>
          }
        />
        <CreatePageBar onPick={() => setCreateOpen(true)} />

        {activePage!.entry && activeStatus && !activeStatus.sourceExists ? (
          <Callout kind="danger">
            <p className="font-semibold">
              Page entry <code>{activePage!.entry}</code> doesn’t exist in the plugin source
            </p>
            <p className="mt-0.5 text-[12px]">
              Create the file under <code>ui/</code>, fix <code>plugin.json</code>, or scaffold the default notes example for this page.
            </p>
            <Button size="sm" className="mt-2" disabled={busy.isBusy(`scaffold:${activePage!.entry!}`)} onClick={() => void scaffold(activePage!.entry!)}>
              {busy.isBusy(`scaffold:${activePage!.entry!}`) ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {busy.isBusy(`scaffold:${activePage!.entry!}`) ? "Creating…" : `Create ${activePage!.entry}`}
            </Button>
          </Callout>
        ) : activePage!.entry && activeStatus && activeStatus.sourceExists && !activeStatus.builtExists ? (
          <Callout kind="warn">
            <span>
              <code>{activePage!.entry}</code> exists in source but is not in the built UI output yet — it should appear after the next
              rebuild.
            </span>
            <Button size="sm" variant="outline" className="ml-2" disabled={busy.isBusy("rebuild")} onClick={() => void rebuild()}>
              {busy.isBusy("rebuild") ? <Loader2 className="animate-spin" /> : <Play />}
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
                    <Button size="sm" variant="outline" disabled={busy.isBusy("scaffold:*")} onClick={() => void scaffold()}>
                      {busy.isBusy("scaffold:*") ? <Loader2 className="animate-spin" /> : <Play />}
                      Scaffold the notes UI
                    </Button>
                  </div>
                </Callout>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CreatePageDialog open={createOpen} onOpenChange={setCreateOpen} onScaffolded={handleScaffolded} />

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

/** The creation bar — the Dashboard page owns page creation; jobs, hooks and API routes live on their own pages. */
function CreatePageBar({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={onPick}>
        <Plus />
        New page
      </Button>
      <span className="text-[11px] text-muted-foreground">
        scaffolds <code>ui/</code> pages (or no-code components) and wires <code>dashboardPages</code> in plugin.json
      </span>
    </div>
  )
}

/** Dialog for dashboard page creation — writes files, patches the manifest, rebuilds. */
function CreatePageDialog({
  open,
  onOpenChange,
  onScaffolded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScaffolded: (manifest: PluginManifest, validation: Validation, message: string, extra?: { pagePath?: string; openBuilder?: boolean }) => void
}) {
  const { bootstrap, toast } = useApp()
  const [label, setLabel] = React.useState("")
  const [path, setPath] = React.useState("")
  const [icon, setIcon] = React.useState("")
  const [pageMode, setPageMode] = React.useState<PageMode>("components")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setLabel("")
      setPath("")
      setIcon("")
      setPageMode("components")
    }
  }, [open])

  const ready = label.trim().length > 0

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
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
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New dashboard page</DialogTitle>
          <DialogDescription>
            {
              "A components page adds a dashboardPages entry (no iframe) and opens the visual builder; an HTML page scaffolds the notes example under ui/."
            }
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Page type</Label>
            <div className="grid grid-cols-2 gap-2">
              <ChoiceTile
                selected={pageMode === "components"}
                onSelect={() => setPageMode("components")}
                title="Components"
                blurb="No-code kit — build it in the visual builder"
              />
              <ChoiceTile
                selected={pageMode === "html"}
                onSelect={() => setPageMode("html")}
                title="HTML"
                blurb="Notes example under ui/ (iframe)"
              />
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
