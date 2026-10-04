import * as React from "react"
import {
  AlertTriangle,
  CloudDownload,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Loader2,
  LogOut,
  Package,
  Palette,
  Puzzle,
  RefreshCw,
  Rocket,
  Settings2,
  Sparkles,
  Store,
  Trash2,
} from "lucide-react"
import { Callout, PageHead } from "@/components/shared"
import { SkeletonCard, SkeletonList } from "@/components/skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog, DeleteFilesDialog, DeleteRemoteDialog } from "@/components/settings-dialogs"
import { dev } from "@/lib/api"
import { useBusySet } from "@/lib/use-busy"
import { ACCENTS, accentFor } from "@/lib/project-colors"
import type { BumpMode, DevConfigResponse, UserSettingsResponse } from "@/lib/types"
import { useVisit } from "@/lib/use-visit"
import { cn, timeAgo } from "@/lib/utils"
import { ws, projectIconUrl } from "@/lib/ws-api"
import type { WsPackage, WsPackageDetail, WsProject, WsThemeStatus } from "@/lib/ws-api"
import { useApp } from "@/state/app"

const ASSISTANT_PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", placeholder: "anthropic/claude-sonnet-4", env: "OPENROUTER_API_KEY" },
  { id: "openai", label: "OpenAI", placeholder: "gpt-4o-mini", env: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", placeholder: "claude-sonnet-4-5", env: "ANTHROPIC_API_KEY" },
  { id: "gemini", label: "Gemini", placeholder: "gemini-2.5-flash", env: "GEMINI_API_KEY" },
  { id: "deepinfra", label: "DeepInfra", placeholder: "deepseek-ai/DeepSeek-V4-Flash", env: "DEEPINFRA_API_KEY" },
  { id: "ollama", label: "Ollama (local, no key)", placeholder: "qwen3:8b", env: "OLLAMA_HOST" },
]

const SOURCE_LABELS: Record<string, string> = {
  folder: "imported folder",
  zip: "imported zip",
  create: "created here",
  account: "pulled from account",
}

const EDITOR_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "code", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "windsurf", label: "Windsurf" },
  { value: "code-insiders", label: "VS Code Insiders" },
  { value: "custom", label: "Custom command…" },
]

/**
 * User settings — machine-level, applies to every project.
 * Stored in ~/.selldoes/settings.json; project folders never hold credentials.
 */
export function UserSettingsPage() {
  const { workspace, refreshWorkspace, refresh, toast, setAssistantPage } = useApp()
  const workspaceMode = workspace !== null
  useVisit("user-settings")

  React.useEffect(() => {
    setAssistantPage({
      context:
        "The developer is on the User settings page: assistant provider + API key, connected accounts (developer + theme lanes), workspace registry, editor preference and the default release bump. These apply to every project — project-specific settings live in Project settings.",
      quick: ["Where are my assistant API keys stored?", "How do I change my default editor?"],
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

  // ── Shared dialogs state ───────────────────────────────────────────────────
  const [deleteFilesFor, setDeleteFilesFor] = React.useState<WsProject | null>(null)
  const [deleteRemoteFor, setDeleteRemoteFor] = React.useState<WsPackage | null>(null)
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

  // ── User settings (assistant + preferences) ────────────────────────────────
  const [userSettings, setUserSettings] = React.useState<UserSettingsResponse | null>(null)
  const [settingsError, setSettingsError] = React.useState<string | null>(null)
  const [config, setConfig] = React.useState<DevConfigResponse | null>(null)
  const settingsBusy = useBusySet()
  const [provider, setProvider] = React.useState("openrouter")
  const [model, setModel] = React.useState("")
  const [apiKey, setApiKey] = React.useState("")
  const [baseUrl, setBaseUrl] = React.useState("")
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message: string } | null>(null)
  const [editorChoice, setEditorChoice] = React.useState("auto")
  const [editorCustom, setEditorCustom] = React.useState("")
  const [releaseBump, setReleaseBump] = React.useState<BumpMode | null>(null)

  React.useEffect(() => {
    let active = true
    const loadSettings = async () => {
      try {
        const data = workspaceMode ? await ws.userSettings() : await dev.userSettings()
        if (!active) return
        setUserSettings(data)
        setSettingsError(null)
        setProvider(data.assistant.provider ?? "openrouter")
        setModel(data.assistant.model ?? "")
        setBaseUrl(data.assistant.baseUrl ?? "")
        const editor = data.editor ?? ""
        if (editor && EDITOR_OPTIONS.some((option) => option.value === editor)) {
          setEditorChoice(editor)
          setEditorCustom("")
        } else if (editor) {
          setEditorChoice("custom")
          setEditorCustom(editor)
        } else {
          setEditorChoice("auto")
          setEditorCustom("")
        }
        setReleaseBump(data.publish.bump)
      } catch (cause) {
        if (!active) return
        setSettingsError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void loadSettings()
    // Env-key hints come from the dev server (may be unavailable standalone).
    void dev
      .config()
      .then((data) => {
        if (active) setConfig(data)
      })
      .catch(() => {})
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceMode])

  const saveAssistant = () =>
    void run(
      "assistant",
      async () => {
        const patch = {
          assistant: {
            provider,
            model: model.trim() || null,
            baseUrl: baseUrl.trim() || null,
            // Blank key = keep the saved one (the raw key is never shown back).
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          },
        }
        const data = workspaceMode ? await ws.saveUserSettings(patch) : await dev.saveUserSettings(patch)
        setUserSettings(data)
        setApiKey("")
        setTestResult(null)
        toast("Assistant settings saved — apply to every project", "success")
      },
      settingsBusy,
    )

  const clearApiKey = () =>
    void run(
      "assistant-clear-key",
      async () => {
        const data = workspaceMode
          ? await ws.saveUserSettings({ assistant: { apiKey: null } })
          : await dev.saveUserSettings({ assistant: { apiKey: null } })
        setUserSettings(data)
        setTestResult(null)
        toast("Assistant API key cleared", "success")
      },
      settingsBusy,
    )

  const testAssistant = () =>
    void run(
      "assistant-test",
      async () => {
        setTestResult(null)
        const result = workspaceMode ? await ws.testUserAssistant() : await dev.testAssistant()
        setTestResult({ ok: true, message: `Connected — ${result.provider ?? "provider"} · ${result.model ?? "model"}` })
      },
      settingsBusy,
    )

  const saveEditor = () =>
    void run(
      "editor",
      async () => {
        const editor = editorChoice === "custom" ? editorCustom.trim() || null : editorChoice === "auto" ? null : editorChoice
        const data = workspaceMode ? await ws.saveUserSettings({ editor }) : await dev.saveUserSettings({ editor })
        setUserSettings(data)
        toast(editor ? `Default editor saved — ${editor}` : "Default editor cleared (auto-detect)", "success")
      },
      settingsBusy,
    )

  const saveBump = (mode: BumpMode) =>
    void run(
      "bump",
      async () => {
        const data = workspaceMode ? await ws.saveUserSettings({ publish: { bump: mode } }) : await dev.saveUserSettings({ publish: { bump: mode } })
        setUserSettings(data)
        setReleaseBump(mode)
        toast(`Default release bump saved — ${mode}`, "success")
      },
      settingsBusy,
    )

  // ── Workspace registry (default dir + project list) ────────────────────────
  const [defaultDir, setDefaultDir] = React.useState(userSettings?.defaultDir ?? workspace?.defaultDir ?? "")
  const registryBusy = useBusySet()

  React.useEffect(() => {
    const value = userSettings?.defaultDir ?? workspace?.defaultDir
    if (value) setDefaultDir(value)
  }, [userSettings?.defaultDir, workspace?.defaultDir])

  const saveDefaultDir = () =>
    void run(
      "default-dir",
      async () => {
        const data = await ws.saveUserSettings({ defaultDir: defaultDir.trim() })
        setUserSettings(data)
        await refreshWorkspace()
        toast("Default project directory saved", "success")
      },
      registryBusy,
    )

  const chooseDefaultDir = () =>
    void run(
      "choose-dir",
      async () => {
        const result = await ws.chooseFolder(defaultDir.trim() || undefined)
        if (result.cancelled || !result.path) return
        setDefaultDir(result.path)
        const data = await ws.saveUserSettings({ defaultDir: result.path })
        setUserSettings(data)
        await refreshWorkspace()
        toast("Default project directory saved", "success")
      },
      registryBusy,
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

  // ── Remote: developer account + packages ──────────────────────────────────
  const [packages, setPackages] = React.useState<WsPackage[] | null>(null)
  const [packagesError, setPackagesError] = React.useState<string | null>(null)
  const packagesBusy = useBusySet()
  // `run` is a stable reference — depending on the whole busy object would
  // re-trigger effects (e.g. loadPackages) on every spinner change.
  const runPackages = packagesBusy.run
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
    await runPackages("load", async () => {
      setPackagesError(null)
      try {
        const result = await ws.packages()
        setPackages(result.plugins)
        setAppUrl((previous) => previous || result.appUrl)
      } catch (cause) {
        setPackagesError(cause instanceof Error ? cause.message : String(cause))
      }
    })
  }, [runPackages])

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
      packagesBusy,
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
      packagesBusy,
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
      packagesBusy,
    )

  /** The registry project that corresponds to an account package, if any. */
  const projectFor = (pkg: WsPackage): WsProject | null =>
    workspace?.projects.find((project) => project.kind === "plugin" && project.slug === pkg.slug && !project.missing) ?? null

  const hasUpdate = (pkg: WsPackage): boolean => {
    const project = projectFor(pkg)
    return Boolean(project?.version && pkg.latestVersion && project.version !== pkg.latestVersion)
  }

  /** Pulls the account copy over the local project (dirty git repos ask first). */
  const updateFromAccount = (pkg: WsPackage) => {
    const target = projectFor(pkg)
    void run(
      `update:${pkg.slug}`,
      async () => {
        const runPull = (force: boolean) =>
          ws.pull(pkg.slug, { update: true, ...(force ? { force: true } : {}), ...(target ? { dir: target.path } : {}) })
        let response
        try {
          response = await runPull(false)
        } catch (cause) {
          const error = cause as Error & { code?: string }
          if (error.code !== "dirty") throw error
          if (!window.confirm(`${error.message}\n\nUpdate anyway? Files from your account will overwrite local ones.`)) return
          response = await runPull(true)
        }
        await Promise.all([refreshWorkspace(), refresh()])
        toast(`Updated ${response.project.name}${response.summary?.version ? ` to v${response.summary.version}` : ""}`, "success")
      },
      packagesBusy,
    )
  }

  // ── Theme lane (merchant API key) ─────────────────────────────────────────
  const [theme, setTheme] = React.useState<WsThemeStatus | null>(null)
  const themeBusy = useBusySet()
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
      themeBusy,
    )

  const themeDisconnect = () =>
    void run(
      "theme-disconnect",
      async () => {
        await ws.themeDisconnect()
        setTheme({ connected: false, baseUrl: null, defaultStoreSlug: null, apiKeyMasked: null })
        toast("Theme lane disconnected", "success")
      },
      themeBusy,
    )

  const activeProvider = ASSISTANT_PROVIDERS.find((entry) => entry.id === provider)
  const envDetected = activeProvider ? Boolean(config?.env?.[activeProvider.env]) : false
  const current = workspace?.current?.project ?? null

  return (
    <div className="space-y-5">
      <PageHead
        title="User settings"
        description={
          "Machine-level preferences that apply to every project — assistant credentials, connected accounts, workspace registry and editor. Stored in ~/.selldoes/settings.json, never in a project folder."
        }
      />

      {/* ── Assistant (AI) ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Assistant (AI)
          </CardTitle>
          <CardDescription>
            Provider for the assistant panel, Describe-AI scaffolds and <code className="font-mono">selldoes ask</code>. Projects may pin a
            different model in Project settings — the key always stays here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settingsError ? (
            <Callout kind="warn">
              <p className="font-semibold">Could not load the user settings</p>
              <p className="mt-0.5 text-[12px]">{settingsError}</p>
            </Callout>
          ) : null}
          {userSettings === null && !settingsError ? (
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
                        disabled={settingsBusy.anyBusy}
                        onClick={() => setProvider(entry.id)}
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
                          provider === entry.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user-assistant-model" className="text-xs">
                    Model <span className="font-normal text-muted-foreground">(default for all projects)</span>
                  </Label>
                  <Input
                    id="user-assistant-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder={activeProvider?.placeholder ?? "model id"}
                    className="h-9 font-mono text-xs"
                    disabled={settingsBusy.anyBusy}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user-assistant-key" className="text-xs">
                    API key{" "}
                    {userSettings?.assistant.apiKeySet ? (
                      <span className="text-emerald-600">· saved ({userSettings.assistant.apiKeyMasked})</span>
                    ) : (
                      <span className="font-normal text-muted-foreground">· none saved</span>
                    )}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="user-assistant-key"
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={userSettings?.assistant.apiKeySet ? "saved — leave blank to keep" : "sk-…"}
                      className="h-9 min-w-0 flex-1 font-mono text-xs"
                      disabled={settingsBusy.anyBusy || provider === "ollama"}
                    />
                    {userSettings?.assistant.apiKeySet ? (
                      <Button size="sm" variant="outline" className="h-9 shrink-0 text-destructive" disabled={settingsBusy.anyBusy} onClick={clearApiKey}>
                        {settingsBusy.isBusy("assistant-clear-key") ? <Loader2 className="animate-spin" /> : null}
                        Clear
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user-assistant-base" className="text-xs">
                    Base URL <span className="font-normal text-muted-foreground">(optional — proxies, gateways)</span>
                  </Label>
                  <Input
                    id="user-assistant-base"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://…"
                    className="h-9 font-mono text-xs"
                    disabled={settingsBusy.anyBusy}
                  />
                </div>
              </div>
              {activeProvider ? (
                <p className="text-[11px] text-muted-foreground">
                  {envDetected
                    ? `${activeProvider.label} is detected via an environment variable — no key needed here.`
                    : `Set the provider's environment variable, or paste a key above. Keys are read locally and only sent to the provider you choose.`}
                </p>
              ) : null}
              {testResult ? (
                <Callout kind={testResult.ok ? "success" : "danger"}>
                  <p className="text-[12.5px]">{testResult.message}</p>
                </Callout>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={settingsBusy.anyBusy} onClick={saveAssistant}>
                  {settingsBusy.isBusy("assistant") ? <Loader2 className="animate-spin" /> : null}
                  Save
                </Button>
                <Button size="sm" variant="outline" disabled={settingsBusy.anyBusy} onClick={testAssistant}>
                  {settingsBusy.isBusy("assistant-test") ? <Loader2 className="animate-spin" /> : null}
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
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{userSettings?.file ?? "~/.selldoes/settings.json"}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Preferences: editor + release bump ─────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4" />
            Preferences
          </CardTitle>
          <CardDescription>Defaults for this machine — `selldoes open` and the Ship page fall back to these when a project has no override.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="user-editor" className="text-xs">
              Editor for <code className="font-mono">selldoes open</code>
            </Label>
            <div className="flex flex-wrap gap-2">
              <select
                id="user-editor"
                value={editorChoice}
                onChange={(event) => setEditorChoice(event.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {EDITOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {editorChoice === "custom" ? (
                <Input
                  value={editorCustom}
                  onChange={(event) => setEditorCustom(event.target.value)}
                  placeholder="command, e.g. idea or sublime"
                  className="h-9 w-56 font-mono text-xs"
                />
              ) : null}
              <Button size="sm" variant="outline" className="h-9" disabled={settingsBusy.anyBusy} onClick={saveEditor}>
                {settingsBusy.isBusy("editor") ? <Loader2 className="animate-spin" /> : null}
                Save editor
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The <code className="font-mono">SELDOES_EDITOR</code> environment variable still wins when set.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Default release bump <span className="font-normal text-muted-foreground">(Ship page fallback)</span>
            </Label>
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
                  disabled={settingsBusy.anyBusy}
                  onClick={() => saveBump(entry.value)}
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
              A project can override this in Project settings → Releases; when it doesn't, the Ship page pre-checks with this mode.
            </p>
          </div>
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
                <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[11px]" disabled={packagesBusy.anyBusy} onClick={disconnect}>
                  {packagesBusy.isBusy("disconnect") ? <Loader2 className="animate-spin" /> : <LogOut />}
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
                  <Button size="sm" className="h-9 shrink-0" disabled={packagesBusy.anyBusy || !token.trim()} onClick={connect}>
                    {packagesBusy.isBusy("connect") ? <Loader2 className="animate-spin" /> : <KeyRound />}
                    Connect
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Developer tokens start with <code className="font-mono">sk_dev_</code> — create one in the developer portal → API tokens. Saved to
                  <code className="font-mono"> ~/.selldoes.json</code>, same as `selldoes login`. Leave the URL empty for selldoes.com.
                </p>
              </div>
            ) : null}

            {connected && packagesBusy.isBusy("load") && packages === null ? (
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
                          {pkg.slug} · account v{pkg.latestVersion}
                          {projectFor(pkg)?.version ? ` · local v${projectFor(pkg)!.version}` : ""} · {pkg.status}
                          {pkg.updatedAt ? ` · updated ${timeAgo(pkg.updatedAt)}` : ""}
                        </p>
                      </button>
                      {projectFor(pkg) ? (
                        <>
                          {hasUpdate(pkg) ? (
                            <Badge className="h-7 shrink-0 border-0 bg-amber-100 px-2 text-[10px] text-amber-800">Update available</Badge>
                          ) : null}
                          <Button
                            size="sm"
                            variant={hasUpdate(pkg) ? "default" : "outline"}
                            className="h-7 shrink-0 px-2 text-xs"
                            disabled={packagesBusy.isBusy(`update:${pkg.slug}`)}
                            onClick={() => updateFromAccount(pkg)}
                          >
                            {packagesBusy.isBusy(`update:${pkg.slug}`) ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                            {hasUpdate(pkg) ? "Update" : "Re-pull"}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 px-2 text-xs"
                          disabled={packagesBusy.isBusy(`pull:${pkg.slug}`)}
                          onClick={() => pull(pkg)}
                        >
                          {packagesBusy.isBusy(`pull:${pkg.slug}`) ? <Loader2 className="animate-spin" /> : <CloudDownload />}
                          Pull
                        </Button>
                      )}
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
                  <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" disabled={themeBusy.anyBusy} onClick={themeDisconnect}>
                    {themeBusy.isBusy("theme-disconnect") ? <Loader2 className="animate-spin" /> : <LogOut />}
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
                  <Button size="sm" className="h-9 shrink-0" disabled={themeBusy.anyBusy || !themeKey.trim()} onClick={themeConnect}>
                    {themeBusy.isBusy("theme-connect") ? <Loader2 className="animate-spin" /> : <KeyRound />}
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
                <Button size="sm" className="h-9 shrink-0" disabled={registryBusy.anyBusy} onClick={chooseDefaultDir}>
                  {registryBusy.isBusy("choose-dir") ? <Loader2 className="animate-spin" /> : <FolderOpen />}
                  Choose folder
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0"
                  disabled={registryBusy.anyBusy || !defaultDir.trim()}
                  onClick={saveDefaultDir}
                >
                  {registryBusy.isBusy("default-dir") ? <Loader2 className="animate-spin" /> : null}
                  Save path
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                New projects land here unless you choose another folder while creating. Saved in{" "}
                <code className="font-mono">~/.selldoes/settings.json</code>.
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
                          disabled={registryBusy.anyBusy}
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
                              registryBusy,
                            )
                          }}
                        >
                          Open
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground" disabled={registryBusy.anyBusy} onClick={() => removeProject(project)}>
                        Remove
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px] text-destructive"
                        disabled={registryBusy.anyBusy || project.missing}
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
              <Button size="sm" variant="outline" className="shrink-0 text-destructive" disabled={registryBusy.anyBusy || (workspace?.projects.length ?? 0) === 0} onClick={clearRegistry}>
                Clear registry
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
