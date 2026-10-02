import * as React from "react"
import {
  AlertTriangle,
  Check,
  CloudDownload,
  Database,
  ExternalLink,
  FolderOpen,
  History,
  KeyRound,
  Loader2,
  LogOut,
  Palette,
  Package,
  Puzzle,
  RefreshCw,
  Rocket,
  Sparkles,
  SquarePen,
  SquareTerminal,
  Store,
  Trash2,
} from "lucide-react"
import { Callout, CopyButton, PageHead } from "@/components/shared"
import { SkeletonCard, SkeletonList } from "@/components/skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { dev } from "@/lib/api"
import { ACCENTS, ACCENT_NAMES, accentFor, type AccentName } from "@/lib/project-colors"
import type { DevConfigResponse } from "@/lib/types"
import { useVisit } from "@/lib/use-visit"
import { cn, timeAgo } from "@/lib/utils"
import { ws, projectIconUrl } from "@/lib/ws-api"
import type { WsPackage, WsPackageDetail, WsProject, WsThemeStatus } from "@/lib/ws-api"
import { useApp } from "@/state/app"

const ASSISTANT_PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", placeholder: "anthropic/claude-sonnet-4" },
  { id: "openai", label: "OpenAI", placeholder: "gpt-4o-mini" },
  { id: "anthropic", label: "Anthropic", placeholder: "claude-sonnet-4-5" },
  { id: "gemini", label: "Gemini", placeholder: "gemini-2.5-flash" },
  { id: "deepinfra", label: "DeepInfra", placeholder: "deepseek-ai/DeepSeek-V4-Flash" },
  { id: "ollama", label: "Ollama (local, no key)", placeholder: "qwen3:8b" },
]

const SOURCE_LABELS: Record<string, string> = {
  folder: "imported folder",
  zip: "imported zip",
  create: "created here",
  account: "pulled from account",
}

/** Generic confirm dialog for reversible-but-serious actions. */
function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" variant={danger ? "destructive" : "default"} disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Delete-files dialog: typed-slug confirmation, path on screen, and a second
 * gate when the folder is a dirty git repo (the server answers 409 first).
 */
function DeleteFilesDialog({
  project,
  onDone,
  onClose,
}: {
  project: WsProject | null
  onDone: () => void
  onClose: () => void
}) {
  const { toast } = useApp()
  const [typed, setTyped] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)
  const [allowDirty, setAllowDirty] = React.useState(false)

  React.useEffect(() => {
    setTyped("")
    setError(null)
    setDirty(false)
    setAllowDirty(false)
  }, [project?.id])

  if (!project) return null
  const confirmed = typed.trim() === project.slug

  const run = async () => {
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await ws.deleteFiles({ projectId: project.id, confirmSlug: project.slug, allowDirty })
      toast(`Deleted ${result.slug} from disk`, "success")
      onDone()
      onClose()
    } catch (cause) {
      const code = (cause as { code?: string }).code
      if (code === "dirty") {
        setDirty(true)
        setError(cause instanceof Error ? cause.message : String(cause))
      } else {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(project)} onOpenChange={(open) => !busy && !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            Delete project files from disk
          </DialogTitle>
          <DialogDescription>
            This removes the folder and everything inside it, then unregisters it from the workspace. It cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs font-semibold">
              {project.name} <span className="text-muted-foreground">/{project.slug}</span>
            </p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{project.path}</p>
          </div>
          {dirty ? (
            <Callout kind="warn">
              <p className="font-semibold">Uncommitted git changes</p>
              <p className="mt-0.5 text-[12px]">{error}</p>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] font-medium">
                <Checkbox checked={allowDirty} onCheckedChange={(value) => setAllowDirty(value === true)} />
                Delete anyway — I accept losing the uncommitted changes
              </label>
            </Callout>
          ) : null}
          {error && !dirty ? <p className="text-[12px] text-destructive">{error}</p> : null}
          <div className="space-y-1.5">
            <Label htmlFor="delete-files-confirm" className="text-xs">
              Type <code className="font-mono font-bold">{project.slug}</code> to confirm
            </Label>
            <Input
              id="delete-files-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void run()
              }}
              placeholder={project.slug}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" disabled={!confirmed || busy || (dirty && !allowDirty)} onClick={() => void run()}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete files
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Remote delete dialog — mirrors the platform's semantics verbatim. */
function DeleteRemoteDialog({
  pkg,
  appUrl,
  onDone,
  onClose,
}: {
  pkg: WsPackage | null
  appUrl: string
  onDone: () => void
  onClose: () => void
}) {
  const { toast } = useApp()
  const [typed, setTyped] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setTyped("")
    setError(null)
  }, [pkg?.slug])

  if (!pkg) return null
  const confirmed = typed.trim() === pkg.slug

  const run = async () => {
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await ws.deleteRemote(pkg.slug)
      toast(`Deleted ${pkg.slug} workspace copy from ${appUrl}`, "success")
      onDone()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(pkg)} onOpenChange={(open) => !busy && !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            Delete workspace copy of {pkg.name}?
          </DialogTitle>
          <DialogDescription>
            Deletes the developer workspace package and its stored files on {appUrl}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Callout kind="warn">
            <p className="text-[12.5px]">
              <strong>Published marketplace artifacts stay.</strong> The marketplace listing and immutable releases are kept —
              admins manage those from the listings screen. Re-publishing the slug creates a fresh draft.
            </p>
          </Callout>
          <div className="space-y-1.5">
            <Label htmlFor="delete-remote-confirm" className="text-xs">
              Type <code className="font-mono font-bold">{pkg.slug}</code> to confirm
            </Label>
            <Input
              id="delete-remote-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void run()
              }}
              placeholder={pkg.slug}
              className="font-mono"
              autoFocus
            />
          </div>
          {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" disabled={!confirmed || busy} onClick={() => void run()}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete workspace copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsPage() {
  const { bootstrap, workspace, refreshWorkspace, refresh, toast, setAssistantPage } = useApp()
  useVisit("settings")
  const workspaceMode = workspace !== null
  const current = workspace?.current?.project ?? null
  const manifest = bootstrap!.manifest

  React.useEffect(() => {
    setAssistantPage({
      context: "The developer is on the Settings page: workspace registry, remote packages, dev-server config and danger-zone actions.",
      quick: ["What does deleting a remote workspace copy do?", "How do I reset the mock store data?"],
    })
  }, [setAssistantPage])

  const run = async (key: string, action: () => Promise<void>, setBusy: (value: string | null) => void) => {
    setBusy(key)
    try {
      await action()
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), "error")
    } finally {
      setBusy(null)
    }
  }

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [deleteFilesFor, setDeleteFilesFor] = React.useState<WsProject | null>(null)
  const [deleteRemoteFor, setDeleteRemoteFor] = React.useState<WsPackage | null>(null)
  const [confirmAction, setConfirmAction] = React.useState<{
    title: string
    description: React.ReactNode
    confirmLabel: string
    danger?: boolean
    onConfirm: () => Promise<void>
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = React.useState<string | null>(null)

  const doConfirm = async () => {
    if (!confirmAction) return
    await run("confirm", confirmAction.onConfirm, setConfirmBusy)
    setConfirmAction(null)
  }

  // ── Project card state ────────────────────────────────────────────────────
  const [projectBusy, setProjectBusy] = React.useState<string | null>(null)

  const setColor = (name: AccentName) => {
    if (!current) return
    void run(
      `color:${name}`,
      async () => {
        await ws.setColor(current.id, name)
        await refreshWorkspace()
        toast("Accent color updated", "success")
      },
      setProjectBusy,
    )
  }

  const quickAction = (key: string, action: () => Promise<void>) => void run(key, action, setProjectBusy)

  // ── Dev-server + assistant config ─────────────────────────────────────────
  const [config, setConfig] = React.useState<DevConfigResponse | null>(null)
  const [configError, setConfigError] = React.useState<string | null>(null)
  const [configBusy, setConfigBusy] = React.useState<string | null>(null)
  const [storeId, setStoreId] = React.useState("")
  const [storeSlug, setStoreSlug] = React.useState("")
  const [storeName, setStoreName] = React.useState("")
  const [port, setPort] = React.useState("")
  const [host, setHost] = React.useState("")
  const [mockReply, setMockReply] = React.useState("")
  const [emailDisabled, setEmailDisabled] = React.useState(false)
  const [sampleJobs, setSampleJobs] = React.useState("")
  const [provider, setProvider] = React.useState("openrouter")
  const [model, setModel] = React.useState("")
  const [apiKey, setApiKey] = React.useState("")
  const [baseUrl, setBaseUrl] = React.useState("")
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null)

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
        setProvider(data.assistant.provider ?? "openrouter")
        setModel(data.assistant.model ?? "")
        setBaseUrl(data.assistant.baseUrl ?? "")
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
      setConfigBusy,
    )
  }

  const saveAssistant = async () => {
    await run(
      "assistant",
      async () => {
        // Blank fields are omitted so they never overwrite saved values.
        const payload: Record<string, unknown> = { provider }
        if (model.trim()) payload.model = model.trim()
        if (apiKey.trim()) payload.apiKey = apiKey.trim()
        if (baseUrl.trim()) payload.baseUrl = baseUrl.trim()
        const result = await dev.saveConfig(payload)
        setConfig(result)
        setApiKey("")
        setTestResult(null)
        toast("Assistant settings saved — applied immediately", "success")
      },
      setConfigBusy,
    )
  }

  const testAssistant = async () => {
    await run(
      "assistant-test",
      async () => {
        // Persist current form values first so the test sees them.
        const payload: Record<string, unknown> = { provider }
        if (model.trim()) payload.model = model.trim()
        if (apiKey.trim()) payload.apiKey = apiKey.trim()
        if (baseUrl.trim()) payload.baseUrl = baseUrl.trim()
        const saved = await dev.saveConfig(payload)
        setConfig(saved)
        setApiKey("")
        const result = await dev.testAssistant()
        setTestResult({ ok: true, message: `Connected — ${result.provider ?? "provider"} · ${result.model ?? "model"}` })
      },
      setConfigBusy,
    )
  }

  // ── Remote: developer account + packages ──────────────────────────────────
  const [packages, setPackages] = React.useState<WsPackage[] | null>(null)
  const [packagesError, setPackagesError] = React.useState<string | null>(null)
  const [packagesBusy, setPackagesBusy] = React.useState<string | null>(null)
  const [packageDetail, setPackageDetail] = React.useState<{ slug: string; detail: WsPackageDetail } | null>(null)
  const [token, setToken] = React.useState("")
  const [appUrl, setAppUrl] = React.useState(workspace?.account?.appUrl ?? "")
  const [showToken, setShowToken] = React.useState(false)

  const account = workspace?.account ?? null
  const connected = Boolean(account?.connected)

  // Keep the connect form's URL in sync with the saved account config (the
  // state otherwise goes stale after connect/disconnect).
  React.useEffect(() => {
    if (!connected && account?.appUrl) setAppUrl(account.appUrl)
  }, [connected, account?.appUrl])

  const loadPackages = React.useCallback(async () => {
    setPackagesBusy("load")
    setPackagesError(null)
    try {
      const result = await ws.packages()
      setPackages(result.plugins)
      setAppUrl((previous) => previous || result.appUrl)
    } catch (cause) {
      setPackagesError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPackagesBusy(null)
    }
  }, [])

  React.useEffect(() => {
    if (workspaceMode && connected) void loadPackages()
  }, [workspaceMode, connected, loadPackages])

  const connect = () =>
    void run(
      "connect",
      async () => {
        await ws.connect(token.trim(), appUrl.trim() || undefined)
        setToken("")
        await refreshWorkspace()
        toast("Developer account connected", "success")
      },
      setPackagesBusy,
    )

  const disconnect = () =>
    void run(
      "disconnect",
      async () => {
        await ws.disconnect()
        setPackages(null)
        await refreshWorkspace()
        toast("Developer account disconnected", "success")
      },
      setPackagesBusy,
    )

  const toggleDetail = (slug: string) => {
    if (packageDetail?.slug === slug) {
      setPackageDetail(null)
      return
    }
    void ws
      .package(slug)
      .then((detail) => setPackageDetail({ slug, detail }))
      .catch((cause) => toast(cause instanceof Error ? cause.message : String(cause), "error"))
  }

  const pull = (pkg: WsPackage) =>
    void run(
      `pull:${pkg.slug}`,
      async () => {
        const { project } = await ws.pull(pkg.slug)
        await ws.select(project.id)
        await Promise.all([refreshWorkspace(), refresh()])
        toast(`Pulled ${pkg.name} — now developing it`, "success")
      },
      setPackagesBusy,
    )

  // ── Theme lane (merchant API key) ─────────────────────────────────────────
  const [theme, setTheme] = React.useState<WsThemeStatus | null>(null)
  const [themeBusy, setThemeBusy] = React.useState<string | null>(null)
  const [themeKey, setThemeKey] = React.useState("")
  const [themeBase, setThemeBase] = React.useState("")
  const [themeStore, setThemeStore] = React.useState("")

  React.useEffect(() => {
    if (!workspaceMode) return
    void ws
      .themeStatus()
      .then((status) => {
        setTheme(status)
        setThemeBase(status.baseUrl ?? "")
        setThemeStore(status.defaultStoreSlug ?? "")
      })
      .catch(() => setTheme(null))
  }, [workspaceMode])

  const themeConnect = () =>
    void run(
      "theme-connect",
      async () => {
        const status = await ws.themeConnect({
          apiKey: themeKey.trim(),
          baseUrl: themeBase.trim() || undefined,
          defaultStoreSlug: themeStore.trim() || undefined,
        })
        setTheme(status)
        setThemeKey("")
        toast("Theme lane connected", "success")
      },
      setThemeBusy,
    )

  const themeDisconnect = () =>
    void run(
      "theme-disconnect",
      async () => {
        await ws.themeDisconnect()
        setTheme({ connected: false, baseUrl: null, defaultStoreSlug: null, apiKeyMasked: null })
        toast("Theme lane disconnected", "success")
      },
      setThemeBusy,
    )

  // ── Workspace registry ────────────────────────────────────────────────────
  const [defaultDir, setDefaultDir] = React.useState(workspace?.defaultDir ?? "")
  const [registryBusy, setRegistryBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (workspace?.defaultDir) setDefaultDir(workspace.defaultDir)
  }, [workspace?.defaultDir])

  const saveDefaultDir = () =>
    void run(
      "default-dir",
      async () => {
        await ws.saveSettings({ defaultDir: defaultDir.trim() })
        await refreshWorkspace()
        toast("Default project directory saved", "success")
      },
      setRegistryBusy,
    )

  const chooseDefaultDir = () =>
    void run(
      "choose-dir",
      async () => {
        const result = await ws.chooseFolder(defaultDir.trim() || undefined)
        if (result.cancelled || !result.path) return
        setDefaultDir(result.path)
        await ws.saveSettings({ defaultDir: result.path })
        await refreshWorkspace()
        toast("Default project directory saved", "success")
      },
      setRegistryBusy,
    )

  const removeProject = (project: WsProject) =>
    setConfirmAction({
      title: `Remove ${project.name} from the workspace?`,
      description:
        "The project is unregistered from the list — its folder stays on disk and can be re-imported anytime with `selldoes import`.",
      confirmLabel: "Remove from workspace",
      onConfirm: async () => {
        await ws.remove(project.id)
        await refreshWorkspace()
        await refresh()
        toast(`Removed ${project.name} from the workspace list`, "success")
      },
    })

  const clearRegistry = () =>
    setConfirmAction({
      title: "Clear the whole workspace registry?",
      description:
        "Every project is unregistered from the list. Folders stay on disk — re-import them anytime. Running previews are stopped.",
      confirmLabel: "Clear registry",
      danger: true,
      onConfirm: async () => {
        const result = await ws.clearRegistry()
        await refreshWorkspace()
        await refresh()
        toast(`Cleared ${result.removed} project(s) from the registry`, "success")
      },
    })

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
        title="Settings"
        description={
          workspaceMode
            ? "Manage this project, your workspace registry, connected accounts and the dev server."
            : "Manage the dev server and assistant for this standalone preview. Workspace features need the dev shell (`selldoes`)."
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
                {current ? ` · ${SOURCE_LABELS[current.source ?? "folder"] ?? current.source ?? "folder"}` : " · standalone preview"}
              </p>
            </div>
            {current ? <CopyButton text={current.path} label="Copy path" className="shrink-0" /> : null}
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
                    disabled={projectBusy !== null}
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
                  disabled={projectBusy !== null || current.missing}
                  onClick={() =>
                    quickAction("open-editor", async () => {
                      const result = await ws.openEditor()
                      toast(`Opened in ${result.editor ?? "your editor"}`, "success")
                    })
                  }
                >
                  {projectBusy === "open-editor" ? <Loader2 className="animate-spin" /> : <SquarePen />}
                  Open in editor
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={projectBusy !== null || current.missing}
                  onClick={() =>
                    quickAction("open-terminal", async () => {
                      await ws.openEditor({ terminal: true })
                      toast("Terminal opened", "success")
                    })
                  }
                >
                  {projectBusy === "open-terminal" ? <Loader2 className="animate-spin" /> : <SquareTerminal />}
                  Terminal
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={projectBusy !== null || current.missing}
                  onClick={() =>
                    quickAction("restart", async () => {
                      await ws.restart()
                      toast("Preview restarted", "success")
                    })
                  }
                >
                  {projectBusy === "restart" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
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
                <Button variant="outline" size="sm" disabled={current.missing} onClick={() => removeProject(current)}>
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

      {/* ── Remote: developer account ───────────────────────────────────── */}
      {workspaceMode ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Rocket className="h-4 w-4" />
              Remote — developer account
            </CardTitle>
            <CardDescription>
              Packages your developer account owns on the platform — pull them back to keep developing, or delete a workspace copy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Store className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{connected ? (account?.name ?? "Your developer account") : "Not connected"}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {connected ? `${account?.email ?? ""}${account?.appUrl ? ` · ${account.appUrl}` : ""}` : "Paste a developer token to manage your packages"}
                </p>
              </div>
              {connected ? (
                <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[11px]" disabled={packagesBusy !== null} onClick={disconnect}>
                  {packagesBusy === "disconnect" ? <Loader2 className="animate-spin" /> : <LogOut />}
                  Disconnect
                </Button>
              ) : null}
            </div>

            {!connected ? (
              <div className="space-y-2 rounded-lg border border-border px-3 py-3">
                <p className="text-xs font-semibold">Connect your developer account</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      type={showToken ? "text" : "password"}
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && token.trim()) connect()
                      }}
                      placeholder="sk_dev_…"
                      className="h-9 pr-9 font-mono text-xs"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowToken((value) => !value)}
                      aria-label={showToken ? "Hide token" : "Show token"}
                    >
                      {showToken ? <span className="text-[10px]">hide</span> : <span className="text-[10px]">show</span>}
                    </button>
                  </div>
                  <Input
                    value={appUrl}
                    onChange={(event) => setAppUrl(event.target.value)}
                    placeholder="https://selldoes.com"
                    className="h-9 sm:w-56"
                  />
                  <Button size="sm" className="h-9 shrink-0" disabled={packagesBusy !== null || !token.trim()} onClick={connect}>
                    {packagesBusy === "connect" ? <Loader2 className="animate-spin" /> : <KeyRound />}
                    Connect
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Developer tokens start with <code className="font-mono">sk_dev_</code> — create one in the developer portal → API tokens. Saved to
                  <code className="font-mono"> ~/.selldoes.json</code>, same as `selldoes login`. Leave the URL empty for selldoes.com.
                </p>
              </div>
            ) : null}

            {connected && packagesBusy === "load" && packages === null ? (
              <SkeletonList rows={3} />
            ) : connected && packagesError ? (
              <Callout kind="danger">
                <p className="font-semibold">Could not load packages</p>
                <p className="mt-0.5 text-[12px]">{packagesError}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => void loadPackages()}>
                  <RefreshCw />
                  Retry
                </Button>
              </Callout>
            ) : connected && packages && packages.length > 0 ? (
              <div className="space-y-1.5">
                {packages.map((pkg) => (
                  <div key={pkg.slug} className="rounded-lg border border-border px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Package className="h-3.5 w-3.5" />
                      </span>
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggleDetail(pkg.slug)}>
                        <p className="truncate text-xs font-semibold hover:underline">{pkg.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {pkg.slug} · v{pkg.latestVersion} · {pkg.status}
                          {pkg.updatedAt ? ` · updated ${timeAgo(pkg.updatedAt)}` : ""}
                        </p>
                      </button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 px-2 text-xs"
                        disabled={packagesBusy === `pull:${pkg.slug}`}
                        onClick={() => pull(pkg)}
                      >
                        {packagesBusy === `pull:${pkg.slug}` ? <Loader2 className="animate-spin" /> : <CloudDownload />}
                        Pull
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 px-2 text-xs text-destructive"
                        onClick={() => setDeleteRemoteFor(pkg)}
                      >
                        <Trash2 />
                        Delete copy
                      </Button>
                    </div>
                    {packageDetail?.slug === pkg.slug ? (
                      <div className="mt-2 space-y-1 rounded-md bg-muted/40 px-2.5 py-2 text-[11px]">
                        {packageDetail.detail.releases?.length ? (
                          <p className="text-muted-foreground">
                            Releases:{" "}
                            {packageDetail.detail.releases
                              .slice(0, 6)
                              .map((release) => `v${release.version ?? "?"}`)
                              .join(", ")}
                          </p>
                        ) : (
                          <p className="text-muted-foreground">No releases recorded.</p>
                        )}
                        <p className="text-muted-foreground">
                          Marketplace listing:{" "}
                          {packageDetail.detail.listing?.status ? (
                            <Badge variant="outline" className="ml-1 text-[9px]">
                              {packageDetail.detail.listing.status}
                            </Badge>
                          ) : (
                            "none"
                          )}
                        </p>
                        <a
                          href={`${(account?.appUrl ?? "https://selldoes.com").replace(/\/$/, "")}/developers/dashboard/plugins`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Open in the developer portal
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : connected ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                No packages on your account yet — publish one with <code className="font-mono">selldoes publish</code>.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Theme lane ──────────────────────────────────────────────────── */}
      {workspaceMode ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4" />
              Theme lane — merchant API key
            </CardTitle>
            <CardDescription>
              The API key theme commands (`selldoes dev --store`, `apply`, `publish`) authenticate with — same store as `selldoes login --api-key`.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {theme?.connected ? (
              <>
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-semibold">{theme.apiKeyMasked}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {theme.baseUrl ?? "—"}
                      {theme.defaultStoreSlug ? ` · store /${theme.defaultStoreSlug}` : ""}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" disabled={themeBusy !== null} onClick={themeDisconnect}>
                    {themeBusy === "theme-disconnect" ? <Loader2 className="animate-spin" /> : <LogOut />}
                    Disconnect
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  The raw key is never shown after saving. To rotate it, disconnect and connect again with the new key.
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="password"
                    value={themeKey}
                    onChange={(event) => setThemeKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && themeKey.trim()) themeConnect()
                    }}
                    placeholder="sk_… (Dashboard → Settings → API Keys)"
                    className="h-9 font-mono text-xs"
                  />
                  <Input value={themeBase} onChange={(event) => setThemeBase(event.target.value)} placeholder="https://selldoes.com" className="h-9 sm:w-52" />
                  <Input
                    value={themeStore}
                    onChange={(event) => setThemeStore(event.target.value)}
                    placeholder="store slug"
                    className="h-9 sm:w-36"
                  />
                  <Button size="sm" className="h-9 shrink-0" disabled={themeBusy !== null || !themeKey.trim()} onClick={themeConnect}>
                    {themeBusy === "theme-connect" ? <Loader2 className="animate-spin" /> : <KeyRound />}
                    Connect
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Verified against <code className="font-mono">/api/templates/me</code> before saving — the key lands in{" "}
                  <code className="font-mono">~/.selldoes.json</code> next to your developer token.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Assistant ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Assistant (AI)
          </CardTitle>
          <CardDescription>Provider for the assistant panel, Describe-AI scaffolds and `selldoes ask`. Applies immediately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {configError ? (
            <Callout kind="warn">
              <p className="font-semibold">Could not load the dev-server config</p>
              <p className="mt-0.5 text-[12px]">{configError}</p>
            </Callout>
          ) : null}
          {config === null && !configError ? (
            <SkeletonCard rows={4} className="border-0 bg-transparent p-0" />
          ) : (
            <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <div className="flex flex-wrap gap-1.5">
                {ASSISTANT_PROVIDERS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={configBusy !== null}
                    onClick={() => setProvider(entry.id)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
                      provider === entry.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assistant-model" className="text-xs">
                Model
              </Label>
              <Input
                id="assistant-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={ASSISTANT_PROVIDERS.find((entry) => entry.id === provider)?.placeholder ?? "model id"}
                className="h-9 font-mono text-xs"
                disabled={configBusy !== null}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assistant-key" className="text-xs">
                API key {config?.assistant.apiKeySet ? <span className="text-emerald-600">· saved</span> : null}
              </Label>
              <Input
                id="assistant-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={config?.assistant.apiKey ? String(config.assistant.apiKey) : "sk-… (leave blank to keep)"}
                className="h-9 font-mono text-xs"
                disabled={configBusy !== null || provider === "ollama"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assistant-base" className="text-xs">
                Base URL <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="assistant-base"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://… (proxies, gateways)"
                className="h-9 font-mono text-xs"
                disabled={configBusy !== null}
              />
            </div>
          </div>
          {testResult ? (
            <Callout kind={testResult.ok ? "success" : "danger"}>
              <p className="text-[12.5px]">{testResult.message}</p>
            </Callout>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={configBusy !== null} onClick={() => void saveAssistant()}>
              {configBusy === "assistant" ? <Loader2 className="animate-spin" /> : <Check />}
              Save
            </Button>
            <Button size="sm" variant="outline" disabled={configBusy !== null} onClick={() => void testAssistant()}>
              {configBusy === "assistant-test" ? <Loader2 className="animate-spin" /> : null}
              Test connection
            </Button>
            {config?.env ? (
              <span className="text-[10.5px] text-muted-foreground">
                env keys:{" "}
                {Object.entries(config.env)
                  .filter(([, present]) => present)
                  .map(([key]) => key)
                  .join(", ") || "none set"}
              </span>
            ) : null}
          </div>
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
            <Button size="sm" disabled={configBusy !== null} onClick={() => void saveServerConfig()}>
              {configBusy === "server" ? <Loader2 className="animate-spin" /> : <Check />}
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

      {/* ── Workspace registry ──────────────────────────────────────────── */}
      {workspaceMode ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderOpen className="h-4 w-4" />
              Workspace registry
            </CardTitle>
            <CardDescription>
              The project list in <code className="font-mono">~/.selldoes/workspace.json</code> — per machine, not per folder.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="default-dir" className="text-xs">
                Default directory for new projects
              </Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="default-dir"
                  value={defaultDir}
                  onChange={(event) => setDefaultDir(event.target.value)}
                  placeholder="~/Documents/Selldoes"
                  className="h-9 min-w-[240px] flex-1 font-mono text-xs"
                />
                <Button size="sm" className="h-9 shrink-0" disabled={registryBusy !== null} onClick={chooseDefaultDir}>
                  {registryBusy === "choose-dir" ? <Loader2 className="animate-spin" /> : <FolderOpen />}
                  Choose folder
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0"
                  disabled={registryBusy !== null || !defaultDir.trim()}
                  onClick={saveDefaultDir}
                >
                  {registryBusy === "default-dir" ? <Loader2 className="animate-spin" /> : null}
                  Save path
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                New projects land here unless you choose another folder while creating. The registry itself stays in{" "}
                <code className="font-mono">~/.selldoes/workspace.json</code>.
              </p>
            </div>

            <div className="space-y-1.5">
              {workspace?.projects.map((project) => {
                const isCurrent = project.id === current?.id
                const iconSrc = projectIconUrl(project)
                return (
                  <div key={project.id} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md", !iconSrc && ACCENTS[accentFor(project)].tile)}>
                      {iconSrc ? (
                        <img src={iconSrc} alt="" className="h-full w-full object-cover" />
                      ) : project.kind === "theme" ? (
                        <Palette className="h-3.5 w-3.5" />
                      ) : (
                        <Puzzle className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-xs font-semibold">
                        {project.name}
                        {isCurrent ? (
                          <Badge variant="outline" className="shrink-0 text-[9px] text-primary">
                            current
                          </Badge>
                        ) : null}
                        {project.missing ? <span className="shrink-0 text-[9px] font-bold uppercase text-destructive">missing</span> : null}
                      </p>
                      <p className="truncate text-[10.5px] text-muted-foreground">
                        /{project.slug} · {project.kind} · {project.path}
                        {project.lastOpenedAt ? ` · ${timeAgo(project.lastOpenedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {!isCurrent && !project.missing ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          disabled={registryBusy !== null}
                          title={project.kind === "theme" ? "Themes preview against a real store" : undefined}
                          onClick={() => {
                            if (project.kind === "theme") {
                              toast(`Themes preview against a real store — run \`selldoes dev --store <slug>\` in ${project.path}`, "default")
                              return
                            }
                            void run(
                              `select:${project.id}`,
                              async () => {
                                await ws.select(project.id)
                                await Promise.all([refreshWorkspace(), refresh()])
                                toast(`Switched to ${project.name}`, "success")
                              },
                              setRegistryBusy,
                            )
                          }}
                        >
                          Open
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground" disabled={registryBusy !== null} onClick={() => removeProject(project)}>
                        Remove
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px] text-destructive"
                        disabled={registryBusy !== null || project.missing}
                        onClick={() => setDeleteFilesFor(project)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-destructive">Clear the whole registry</p>
                <p className="text-[11px] text-muted-foreground">Unregisters every project — folders stay on disk. Running previews stop.</p>
              </div>
              <Button size="sm" variant="outline" className="shrink-0 text-destructive" disabled={registryBusy !== null || (workspace?.projects.length ?? 0) === 0} onClick={clearRegistry}>
                Clear registry
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Danger zone (global) ────────────────────────────────────────── */}
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
                <a href="/preview/data" className="text-primary hover:underline">
                  Store data
                </a>{" "}
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
      <DeleteRemoteDialog
        pkg={deleteRemoteFor}
        appUrl={account?.appUrl ?? appUrl ?? "https://selldoes.com"}
        onClose={() => setDeleteRemoteFor(null)}
        onDone={() => void loadPackages()}
      />
      <ConfirmDialog
        open={confirmAction !== null}
        busy={confirmBusy !== null}
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
