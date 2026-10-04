import * as React from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle,
  Check,
  Database,
  History,
  Loader2,
  Palette,
  Puzzle,
  RefreshCw,
  Rocket,
  Sparkles,
  SquarePen,
  SquareTerminal,
  Trash2,
} from "lucide-react"
import { PageHead } from "@/components/shared"
import { SkeletonCard } from "@/components/skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog, DeleteFilesDialog } from "@/components/settings-dialogs"
import { dev } from "@/lib/api"
import { useBusySet } from "@/lib/use-busy"
import { ACCENTS, ACCENT_NAMES, accentFor, type AccentName } from "@/lib/project-colors"
import type { BumpMode, DevConfigResponse } from "@/lib/types"
import { useVisit } from "@/lib/use-visit"
import { cn } from "@/lib/utils"
import { ws } from "@/lib/ws-api"
import type { WsProject } from "@/lib/ws-api"
import { useApp } from "@/state/app"

/**
 * Project settings — everything scoped to the current plugin folder
 * (selldoes.config.json + the workspace entry). Machine-level preferences —
 * assistant credentials, accounts, registry, editor — live in User settings
 * (the icon in the header).
 */
export function SettingsPage() {
  const { bootstrap, workspace, refreshWorkspace, refresh, toast, setAssistantPage } = useApp()
  useVisit("settings")
  const workspaceMode = workspace !== null
  const current = workspace?.current?.project ?? null
  const manifest = bootstrap!.manifest

  React.useEffect(() => {
    setAssistantPage({
      context:
        "The developer is on the Project settings page: this plugin's dev-server config, release bump, assistant model override and danger-zone actions. User-level settings (assistant key, accounts, registry) live in User settings.",
      quick: ["How do I reset the mock store data?", "Where do I set my assistant API key?"],
    })
  }, [setAssistantPage])

  const run = async (key: string, action: () => Promise<void>, busySet: ReturnType<typeof useBusySet>) => {
    await busySet.run(key, async () => {
      try {
        await action()
      } catch (cause) {
        toast(cause instanceof Error ? cause.message : String(cause), "error")
      }
    })
  }

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [deleteFilesFor, setDeleteFilesFor] = React.useState<WsProject | null>(null)
  const [confirmAction, setConfirmAction] = React.useState<{
    title: string
    description: React.ReactNode
    confirmLabel: string
    danger?: boolean
    onConfirm: () => Promise<void>
  } | null>(null)
  const confirmBusy = useBusySet()

  const doConfirm = async () => {
    if (!confirmAction) return
    await run("confirm", confirmAction.onConfirm, confirmBusy)
    setConfirmAction(null)
  }

  // ── Project card state ────────────────────────────────────────────────────
  const projectBusy = useBusySet()

  const setColor = (name: AccentName) => {
    if (!current) return
    void run(
      `color:${name}`,
      async () => {
        await ws.setColor(current.id, name)
        await refreshWorkspace()
        toast("Accent color updated", "success")
      },
      projectBusy,
    )
  }

  const quickAction = (key: string, action: () => Promise<void>) => void run(key, action, projectBusy)

  // ── Dev-server + release config ───────────────────────────────────────────
  const [config, setConfig] = React.useState<DevConfigResponse | null>(null)
  const [configError, setConfigError] = React.useState<string | null>(null)
  const configBusy = useBusySet()
  const [storeId, setStoreId] = React.useState("")
  const [storeSlug, setStoreSlug] = React.useState("")
  const [storeName, setStoreName] = React.useState("")
  const [port, setPort] = React.useState("")
  const [host, setHost] = React.useState("")
  const [mockReply, setMockReply] = React.useState("")
  const [emailDisabled, setEmailDisabled] = React.useState(false)
  const [sampleJobs, setSampleJobs] = React.useState("")
  const [releaseBump, setReleaseBump] = React.useState<BumpMode>("patch")
  const [modelOverride, setModelOverride] = React.useState("")

  React.useEffect(() => {
    let active = true
    void dev
      .config()
      .then((data) => {
        if (!active) return
        setConfig(data)
        setConfigError(null)
        const server = data.server
        setStoreId(String(server.storeId))
        setStoreSlug(server.storeSlug)
        setStoreName(server.storeName)
        setPort(String(server.port))
        setHost(server.host)
        setMockReply(server.ai.mockReply ?? "")
        setEmailDisabled(server.email.disabled)
        setSampleJobs(server.sampleJobs ? JSON.stringify(server.sampleJobs, null, 2) : "")
        setReleaseBump(data.publish?.bump ?? "patch")
        setModelOverride(data.assistant.projectModel ?? "")
      })
      .catch((cause) => {
        if (!active) return
        setConfigError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      active = false
    }
  }, [])

  const saveServerConfig = async () => {
    let parsedSampleJobs: Record<string, unknown> | null = null
    if (sampleJobs.trim()) {
      try {
        parsedSampleJobs = JSON.parse(sampleJobs)
      } catch (cause) {
        toast(`sampleJobs is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`, "error")
        return
      }
    }
    await run(
      "server",
      async () => {
        const result = await dev.saveFileConfig({
          server: {
            storeId: Number(storeId),
            storeSlug,
            storeName,
            port: Number(port),
            host,
          },
          ai: { mockReply: mockReply || null },
          email: { disabled: emailDisabled },
          sampleJobs: parsedSampleJobs,
        })
        setConfig(result)
        if (result.restartRequired) {
          if (workspaceMode && current) {
            await ws.restart()
            toast("Dev-server settings saved — preview restarted", "success")
          } else {
            toast("Dev-server settings saved — restart `selldoes dev` to apply", "success")
          }
        } else {
          toast("Dev-server settings saved", "success")
        }
      },
      configBusy,
    )
  }

  const saveRelease = async () => {
    await run(
      "release",
      async () => {
        const result = await dev.saveFileConfig({ publish: { bump: releaseBump } })
        setConfig(result)
        toast("Release settings saved", "success")
      },
      configBusy,
    )
  }

  /** Pins (or clears) this project's assistant model — the key stays in User settings. */
  const saveModelOverride = async (value: string | null) => {
    await run(
      "model-override",
      async () => {
        const result = await dev.saveFileConfig({ assistant: { model: value }, scope: "project" })
        setConfig(result)
        setModelOverride(result.assistant.projectModel ?? "")
        toast(value ? "Project model override saved" : "Project model override cleared — using your User settings model", "success")
      },
      configBusy,
    )
  }

  // ── Global danger zone ────────────────────────────────────────────────────
  const resetData = () =>
    setConfirmAction({
      title: "Reset the mock store data?",
      description:
        "Deletes the mock database (.selldoes-dev/db.json) and reseeds the demo tables. Your plugin's real data is unaffected — this only touches the local preview.",
      confirmLabel: "Reset mock data",
      danger: true,
      onConfirm: async () => {
        await dev.resetData()
        toast("Mock store data reset", "success")
      },
    })

  const clearUndo = () =>
    setConfirmAction({
      title: "Clear the undo history?",
      description:
        "Deletes every snapshot under .selldoes-dev/undo/ — saves, manifest edits and AI applies can no longer be restored from History.",
      confirmLabel: "Clear undo history",
      danger: true,
      onConfirm: async () => {
        const result = await dev.undoClear()
        toast(`Cleared ${result.cleared} snapshot(s)`, "success")
      },
    })

  const activeAccent: AccentName = current ? accentFor(current) : "orange"

  return (
    <div className="space-y-5">
      <PageHead
        title="Project settings"
        description={
          workspaceMode
            ? "Everything about this plugin folder — dev server, releases and local data. Machine-wide preferences (assistant key, accounts, registry) live in User settings."
            : "Everything about this preview — dev server, releases and local data. Machine-wide preferences live in the user settings file."
        }
      />

      {/* ── Project ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Puzzle className="h-4 w-4" />
            Project
          </CardTitle>
          <CardDescription>The workspace entry for {workspaceMode ? "the current project" : "this preview"}.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", ACCENTS[activeAccent].tile)}>
              {current?.kind === "theme" ? <Palette className="h-5 w-5" /> : <Puzzle className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-bold">
                {current?.name ?? manifest.name}
                <Badge variant="outline" className="text-[9px] uppercase">
                  {current?.kind ?? "plugin"}
                </Badge>
                {current?.missing ? <span className="text-[10px] font-bold uppercase text-destructive">missing on disk</span> : null}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                /{current?.slug ?? manifest.slug} v{manifest.version}
                {current ? "" : " · standalone preview"}
              </p>
            </div>
          </div>

          {current ? (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Accent</span>
                {ACCENT_NAMES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    disabled={projectBusy.anyBusy}
                    onClick={() => setColor(name)}
                    className={cn(
                      "h-5 w-5 rounded-full ring-offset-2 ring-offset-background transition-all hover:scale-110",
                      ACCENTS[name].swatch,
                      current.color === name && `ring-2 ${ACCENTS[name].ring}`,
                    )}
                  />
                ))}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={projectBusy.anyBusy || current.missing}
                  onClick={() =>
                    quickAction("open-editor", async () => {
                      const result = await ws.openEditor()
                      toast(`Opened in ${result.editor ?? "your editor"}`, "success")
                    })
                  }
                >
                  {projectBusy.isBusy("open-editor") ? <Loader2 className="animate-spin" /> : <SquarePen />}
                  Open in editor
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={projectBusy.anyBusy || current.missing}
                  onClick={() =>
                    quickAction("open-terminal", async () => {
                      await ws.openEditor({ terminal: true })
                      toast("Terminal opened", "success")
                    })
                  }
                >
                  {projectBusy.isBusy("open-terminal") ? <Loader2 className="animate-spin" /> : <SquareTerminal />}
                  Terminal
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={projectBusy.anyBusy || current.missing}
                  onClick={() =>
                    quickAction("restart", async () => {
                      await ws.restart()
                      toast("Preview restarted", "success")
                    })
                  }
                >
                  {projectBusy.isBusy("restart") ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Restart preview
                </Button>
              </div>
            </div>
          ) : null}

          {workspaceMode && current ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Danger zone — local
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={current.missing}
                  onClick={() =>
                    setConfirmAction({
                      title: `Remove ${current.name} from the workspace?`,
                      description:
                        "The project is unregistered from the list — its folder stays on disk and can be re-imported anytime with `selldoes import`.",
                      confirmLabel: "Remove from workspace",
                      onConfirm: async () => {
                        await ws.remove(current.id)
                        await refreshWorkspace()
                        await refresh()
                        toast(`Removed ${current.name} from the workspace list`, "success")
                      },
                    })
                  }
                >
                  Remove from workspace
                </Button>
                <span className="text-[11px] text-muted-foreground">unregisters it — files stay on disk</span>
                <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
                <Button variant="outline" size="sm" className="text-destructive" disabled={current.missing} onClick={() => setDeleteFilesFor(current)}>
                  <Trash2 />
                  Delete files from disk
                </Button>
                <span className="text-[11px] text-muted-foreground">deletes the folder — typed-slug confirm</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Releases ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4" />
            Releases
          </CardTitle>
          <CardDescription>
            Default version bump the Ship page proposes when you publish. Saved per project in{" "}
            <code className="font-mono">selldoes.config.json</code> — overrides the User settings fallback.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {config === null && !configError ? (
            <SkeletonCard rows={2} className="border-0 bg-transparent p-0" />
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Default bump</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { value: "patch", label: "Patch", hint: "0.4.1 → 0.4.2" },
                      { value: "minor", label: "Minor", hint: "0.4.1 → 0.5.0" },
                      { value: "major", label: "Major", hint: "0.4.1 → 1.0.0" },
                    ] as const
                  ).map((entry) => (
                    <button
                      key={entry.value}
                      type="button"
                      disabled={configBusy.anyBusy}
                      onClick={() => setReleaseBump(entry.value)}
                      title={entry.hint}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                        releaseBump === entry.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10.5px] leading-snug text-muted-foreground">
                  The Ship page pre-checks “Bump version before publish” with this mode; you can still change it per release. The platform
                  rejects re-publishing a version that already exists.
                </p>
              </div>
              <Button size="sm" disabled={configBusy.anyBusy} onClick={() => void saveRelease()}>
                {configBusy.isBusy("release") ? <Loader2 className="animate-spin" /> : <Check />}
                Save
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Assistant model override ────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Assistant model override
          </CardTitle>
          <CardDescription>
            This project pins its own assistant model — the provider, API key and base URL stay in{" "}
            <Link to="/user-settings" className="text-primary hover:underline">
              User settings
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {config === null && !configError ? (
            <SkeletonCard rows={2} className="border-0 bg-transparent p-0" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>
                  Effective: <strong className="font-semibold text-foreground">{config?.assistant.provider ?? "openrouter"}</strong> ·{" "}
                  <code className="font-mono">{config?.assistant.model ?? "default"}</code>
                </span>
                {config?.assistant.apiKeySet ? <Badge variant="outline" className="text-[9px]">key saved (user)</Badge> : null}
                {config?.assistant.projectModel ? <Badge variant="outline" className="text-[9px] text-primary">project override</Badge> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={modelOverride}
                  onChange={(event) => setModelOverride(event.target.value)}
                  placeholder={config?.assistant.model ?? "model id — blank uses your User settings model"}
                  className="h-9 w-72 font-mono text-xs"
                  disabled={configBusy.anyBusy}
                />
                <Button size="sm" disabled={configBusy.anyBusy} onClick={() => void saveModelOverride(modelOverride.trim() || null)}>
                  {configBusy.isBusy("model-override") ? <Loader2 className="animate-spin" /> : <Check />}
                  Save override
                </Button>
                {config?.assistant.projectModel ? (
                  <Button size="sm" variant="outline" disabled={configBusy.anyBusy} onClick={() => void saveModelOverride(null)}>
                    Clear
                  </Button>
                ) : null}
              </div>
              <p className="text-[10.5px] leading-snug text-muted-foreground">
                Saved as <code className="font-mono">assistant.model</code> in this project's selldoes.config.json — safe to commit, no
                credentials involved.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Dev-server config ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Dev-server config
          </CardTitle>
          <CardDescription>
            Writes <code className="font-mono">selldoes.config.json</code> — the mock store identity, listen address and runtime mocks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {config === null && !configError ? (
            <SkeletonCard rows={5} className="border-0 bg-transparent p-0" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-store-id" className="text-xs">
                    Mock store id
                  </Label>
                  <Input id="cfg-store-id" value={storeId} onChange={(event) => setStoreId(event.target.value)} className="h-9 font-mono text-xs" inputMode="numeric" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-store-slug" className="text-xs">
                    Mock store slug
                  </Label>
                  <Input id="cfg-store-slug" value={storeSlug} onChange={(event) => setStoreSlug(event.target.value)} className="h-9 font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-store-name" className="text-xs">
                    Mock store name
                  </Label>
                  <Input id="cfg-store-name" value={storeName} onChange={(event) => setStoreName(event.target.value)} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-port" className="text-xs">
                    Port <span className="font-normal text-muted-foreground">(no --port)</span>
                  </Label>
                  <Input id="cfg-port" value={port} onChange={(event) => setPort(event.target.value)} className="h-9 font-mono text-xs" inputMode="numeric" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cfg-host" className="text-xs">
                    Host
                  </Label>
                  <Input id="cfg-host" value={host} onChange={(event) => setHost(event.target.value)} className="h-9 font-mono text-xs" />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Switch checked={emailDisabled} onCheckedChange={setEmailDisabled} id="cfg-email" />
                  <Label htmlFor="cfg-email" className="cursor-pointer text-xs">
                    Disable email sending
                  </Label>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-mock-reply" className="text-xs">
                  Mock AI reply <span className="font-normal text-muted-foreground">(ctx.ai mock text)</span>
                </Label>
                <Input id="cfg-mock-reply" value={mockReply} onChange={(event) => setMockReply(event.target.value)} placeholder="(mock AI reply — set ai.mockReply in selldoes.config.json)" className="h-9 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-sample-jobs" className="text-xs">
                  Sample jobs <span className="font-normal text-muted-foreground">(JSON — prefill for the Jobs page)</span>
                </Label>
                <Textarea
                  id="cfg-sample-jobs"
                  value={sampleJobs}
                  onChange={(event) => setSampleJobs(event.target.value)}
                  placeholder={'{ "import-products": { "input": { "url": "https://…" }, "maxTicks": 10 } }'}
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={configBusy.anyBusy} onClick={() => void saveServerConfig()}>
                  {configBusy.isBusy("server") ? <Loader2 className="animate-spin" /> : <Check />}
                  Save dev-server config
                </Button>
                <span className="text-[10.5px] text-muted-foreground">
                  Store identity, port and mocks apply on preview restart — the workspace restarts it for you.
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Danger zone (local preview data) ────────────────────────────── */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <Trash2 className="h-4 w-4" />
            Danger zone
          </CardTitle>
          <CardDescription>Local preview data for this project. None of this touches a published plugin.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">Reset mock store data</p>
              <p className="text-[11px] text-muted-foreground">
                Deletes <code className="font-mono">.selldoes-dev/db.json</code> and reseeds the demo tables — see the{" "}
                <Link to="/data" className="text-primary hover:underline">
                  Store data
                </Link>{" "}
                page.
              </p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 text-destructive" onClick={resetData}>
              Reset data
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <History className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">Clear undo history</p>
              <p className="text-[11px] text-muted-foreground">
                Deletes every snapshot under <code className="font-mono">.selldoes-dev/undo/</code> — History can no longer restore past saves.
              </p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 text-destructive" onClick={clearUndo}>
              Clear snapshots
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      <DeleteFilesDialog project={deleteFilesFor} onClose={() => setDeleteFilesFor(null)} onDone={() => void refreshWorkspace()} />
      <ConfirmDialog
        open={confirmAction !== null}
        busy={confirmBusy.anyBusy}
        title={confirmAction?.title ?? ""}
        description={confirmAction?.description ?? ""}
        confirmLabel={confirmAction?.confirmLabel ?? "Confirm"}
        danger={confirmAction?.danger}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
        onConfirm={() => void doConfirm()}
      />
    </div>
  )
}
