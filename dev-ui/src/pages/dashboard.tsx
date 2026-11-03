import { ExternalLink, LayoutDashboard, Loader2, Play, Plus, Sparkles } from "lucide-react"
import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { resolveIcon } from "@/components/app-icon"
import { SectionBuilder } from "@/components/kit/section-builder"
import { SectionKit } from "@/components/kit/section-kit"
import { Callout, PageHead } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { dev } from "@/lib/api"
import type { PluginManifest, UiEntriesResponse, Validation } from "@/lib/types"
import { useBusySet } from "@/lib/use-busy"
import { useDevStream } from "@/lib/use-dev-stream"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"
import { CreatePageBar, CreatePageDialog } from "./dashboard/create-page"
import { HostPageReplica } from "./dashboard/host-page-replica"
import { PageRail } from "./dashboard/page-rail"
import type { ResolvedPage } from "./dashboard/types"

export function DashboardPage() {
  const { bootstrap, setAssistantPage, applyManifest, refresh, toast } = useApp()
  useVisit("dashboard")
  const navigate = useNavigate()
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
  const activeStatus = activePage ? (entries?.entries.find((entry) => entry.entry === activePage.entry) ?? null) : null

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
      if (data?.type !== "selldoes:ui-scaffold") return
      if (data.slug && data.slug !== manifest.slug) return
      void scaffold(typeof data.entry === "string" && data.entry ? data.entry : undefined)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [manifest.slug, scaffold])

  // ── Full-bleed preview: fill the remaining viewport height ────────────────
  // The plugin page scrolls internally, so letting the preview grow naturally
  // would stack a second scrollbar on top of the app's own page scroll. Measure
  // the wrapper's top offset and fill whatever is left of the viewport
  // (re-measured after every render — callouts appearing/disappearing above it
  // stay correct — and on scroll/resize, since scrolling the shell moves the
  // offset without a re-render).
  const frameRef = React.useRef<HTMLDivElement>(null)
  const [frameHeight, setFrameHeight] = React.useState(720)

  React.useEffect(() => {
    const update = () => {
      const top = frameRef.current?.getBoundingClientRect().top ?? 0
      setFrameHeight(Math.max(420, Math.round(window.innerHeight - top - 16)))
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, { passive: true })
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update)
    }
  })

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
        ? [
            "Add a new dashboard page with a job runner",
            "Convert this page to no-code components",
            "Scaffold an import job for my scraper",
          ]
        : ["Scaffold a dashboard UI for this plugin", "Explain the settings + jobs page"],
    })
  }, [setAssistantPage, hasUi, activePage?.label, activeSections.length])

  if (!hasUi) {
    const hasSettingsDialog = Boolean(manifest.settingsDialog?.entry || (manifest.settingsDialog?.sections ?? []).length)
    return (
      <>
        <div className="space-y-4">
          <PageHead
            title="Dashboard"
            description={
              <>
                This plugin has no <code>ui.entry</code>, so the host renders its standard page: identity, permissions, settings
                (from <code>configSchema</code>) and runnable jobs. This is a faithful replica.
              </>
            }
          />
          <CreatePageBar onPick={() => setCreateOpen(true)} />
          {hasSettingsDialog ? (
            <Callout kind="info">
              <p>
                This plugin has <strong>no dashboard UI</strong> — by design. Its designed <strong>settings dialog</strong> lives
                on the{" "}
                <button type="button" className="font-semibold underline" onClick={() => navigate("/settings-dialog")}>
                  Design → Settings
                </button>{" "}
                page and opens from the plugin manager&apos;s Settings button in the Selldoes dashboard.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate("/settings-dialog")}>
                  <Sparkles />
                  Open the settings dialog designer
                </Button>
              </div>
            </Callout>
          ) : (
            <Callout kind="info">
              Want your own UI instead? Scaffold the default notes example — it wires <code>ui.entry</code>,{" "}
              <code>dashboardPages</code> and a working notes app you can build on.{" "}
              <Button
                size="sm"
                variant="outline"
                className="ml-1"
                disabled={busy.isBusy("scaffold:*")}
                onClick={() => void scaffold()}
              >
                {busy.isBusy("scaffold:*") ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Scaffold the notes dashboard UI
              </Button>
            </Callout>
          )}

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

  // A page that renders real content (an iframe entry or no-code sections) goes
  // full-bleed: a slim toolbar owns the chrome and the plugin page fills the
  // rest of the viewport, scrolling internally — the way Shopify embeds an app.
  // The empty state keeps the card layout for its call-to-actions.
  const fullBleed = Boolean(source) || hasSections

  // The page rail — full-bleed hides it below lg (the toolbar's page picker
  // takes over) and lets it scroll internally instead of growing the page.
  const railCard = (
    <PageRail
      groups={groups}
      activePath={activePage?.path}
      fullBleed={fullBleed}
      onSelect={(path) => setParams(path === "/" ? {} : { page: path })}
    />
  )

  const ActiveIcon = resolveIcon(activePage!.icon)

  return (
    <>
      {fullBleed ? (
        /* -mb-24 cancels main's pb-24 (fixed toast/drawer clearance): the
           wrapper already stops short of the viewport bottom, so without it
           the page stays ~80px scrollable — a phantom second scrollbar. */
        <div className="-mb-24 flex flex-col">
          {/* ── Slim toolbar — the chrome; the plugin page owns the rest ── */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ActiveIcon className="h-4 w-4 shrink-0" />
            <span className="text-sm font-semibold">{activePage!.label}</span>
            {hasSections ? <Badge className="border-0 bg-violet-100 text-violet-700">components</Badge> : null}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{activePage!.entry ?? "kit"}</code>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {pages.length > 1 ? (
                <Select value={activePage!.path} onValueChange={(path) => setParams(path === "/" ? {} : { page: path })}>
                  <SelectTrigger className="h-8 w-[170px] text-xs lg:hidden">
                    <SelectValue placeholder="Page" />
                  </SelectTrigger>
                  <SelectContent>
                    {pages.map((page) => (
                      <SelectItem key={page.path} value={page.path}>
                        {page.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
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
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus />
                New page
              </Button>
            </div>
          </div>

          {activePage!.entry && activeStatus && !activeStatus.sourceExists ? (
            <Callout kind="danger">
              <p className="font-semibold">
                Page entry <code>{activePage!.entry}</code> doesn't exist in the plugin source
              </p>
              <p className="mt-0.5 text-[12px]">
                Create the file under <code>ui/</code>, fix <code>plugin.json</code>, or scaffold the default notes example for
                this page.
              </p>
              <Button
                size="sm"
                className="mt-2"
                disabled={busy.isBusy(`scaffold:${activePage!.entry!}`)}
                onClick={() => void scaffold(activePage!.entry!)}
              >
                {busy.isBusy(`scaffold:${activePage!.entry!}`) ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {busy.isBusy(`scaffold:${activePage!.entry!}`) ? "Creating…" : `Create ${activePage!.entry}`}
              </Button>
            </Callout>
          ) : activePage!.entry && activeStatus?.sourceExists && !activeStatus.builtExists ? (
            <Callout kind="warn">
              <span>
                <code>{activePage!.entry}</code> exists in source but is not in the built UI output yet — it should appear after
                the next rebuild.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-2"
                disabled={busy.isBusy("rebuild")}
                onClick={() => void rebuild()}
              >
                {busy.isBusy("rebuild") ? <Loader2 className="animate-spin" /> : <Play />}
                Rebuild
              </Button>
            </Callout>
          ) : null}

          {/* ── Fixed-height preview area: one scrollbar, inside the plugin ── */}
          <div ref={frameRef} style={{ height: frameHeight }} className="flex min-h-0 flex-col overflow-hidden">
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
              {railCard}
              {source ? (
                <iframe
                  key={source}
                  src={source}
                  title={`Plugin dashboard UI — ${activePage!.label}`}
                  className="h-full min-h-0 w-full rounded-xl border border-border bg-white"
                />
              ) : (
                <div className="min-h-0 overflow-y-auto pr-1">
                  <SectionKit slug={manifest.slug} store={store} sections={activeSections} />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <PageHead
            title="Dashboard"
            description={
              <>
                This page declares no components yet — add them in the builder, or scaffold the notes UI as an iframe under{" "}
                <code>ui/</code>.
              </>
            }
          />
          <CreatePageBar onPick={() => setCreateOpen(true)} />

          <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            {railCard}
            <Card className="overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <LayoutDashboard className="h-4 w-4" />
                  {activePage!.label}
                </CardTitle>
                <CardDescription>
                  From <code>dashboardPages</code> in plugin.json — no-code components or an iframe entry.
                </CardDescription>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </div>
        </div>
      )}

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
