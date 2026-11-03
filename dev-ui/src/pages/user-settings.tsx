import * as React from "react"
import { PageHead } from "@/components/shared"
import { dev } from "@/lib/api"
import type { BumpMode, DevConfigResponse, UserSettingsResponse } from "@/lib/types"
import { useBusySet } from "@/lib/use-busy"
import { useVisit } from "@/lib/use-visit"
import type { WsPackage, WsPackageDetail, WsProject, WsThemeStatus } from "@/lib/ws-api"
import { ws } from "@/lib/ws-api"
import { useApp } from "@/state/app"
import { AssistantCard } from "./user-settings/assistant-card"
import { SettingsDialogs } from "./user-settings/dialogs"
import { PreferencesCard } from "./user-settings/preferences-card"
import { RemoteAccountCard } from "./user-settings/remote-account-card"
import { type ConfirmAction, EDITOR_OPTIONS } from "./user-settings/shared"
import { ThemeLaneCard } from "./user-settings/theme-lane-card"
import { WorkspaceRegistryCard } from "./user-settings/workspace-registry-card"

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
  const [confirmAction, setConfirmAction] = React.useState<ConfirmAction | null>(null)
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
        const data = workspaceMode
          ? await ws.saveUserSettings({ publish: { bump: mode } })
          : await dev.saveUserSettings({ publish: { bump: mode } })
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

  const openProject = (project: WsProject) => {
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
  }

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
        let response: Awaited<ReturnType<typeof runPull>>
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
      <AssistantCard
        settingsError={settingsError}
        userSettings={userSettings}
        config={config}
        busy={settingsBusy}
        provider={provider}
        onProviderChange={setProvider}
        model={model}
        onModelChange={setModel}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        baseUrl={baseUrl}
        onBaseUrlChange={setBaseUrl}
        testResult={testResult}
        onSave={saveAssistant}
        onClearKey={clearApiKey}
        onTest={testAssistant}
      />

      {/* ── Preferences: editor + release bump ─────────────────────────── */}
      <PreferencesCard
        busy={settingsBusy}
        editorChoice={editorChoice}
        onEditorChoiceChange={setEditorChoice}
        editorCustom={editorCustom}
        onEditorCustomChange={setEditorCustom}
        releaseBump={releaseBump}
        onSaveEditor={saveEditor}
        onSaveBump={saveBump}
      />

      {/* ── Remote: developer account ───────────────────────────────────── */}
      {workspaceMode ? (
        <RemoteAccountCard
          connected={connected}
          account={account}
          busy={packagesBusy}
          token={token}
          onTokenChange={setToken}
          appUrl={appUrl}
          onAppUrlChange={setAppUrl}
          showToken={showToken}
          onShowTokenChange={setShowToken}
          onConnect={connect}
          onDisconnect={disconnect}
          packages={packages}
          packagesError={packagesError}
          onRetry={() => void loadPackages()}
          packageDetail={packageDetail}
          onToggleDetail={toggleDetail}
          projectFor={projectFor}
          hasUpdate={hasUpdate}
          onUpdate={updateFromAccount}
          onPull={pull}
          onDeleteCopy={setDeleteRemoteFor}
        />
      ) : null}

      {/* ── Theme lane ──────────────────────────────────────────────────── */}
      {workspaceMode ? (
        <ThemeLaneCard
          theme={theme}
          busy={themeBusy}
          themeKey={themeKey}
          onThemeKeyChange={setThemeKey}
          themeBase={themeBase}
          onThemeBaseChange={setThemeBase}
          themeStore={themeStore}
          onThemeStoreChange={setThemeStore}
          onConnect={themeConnect}
          onDisconnect={themeDisconnect}
        />
      ) : null}

      {/* ── Workspace registry ──────────────────────────────────────────── */}
      {workspaceMode ? (
        <WorkspaceRegistryCard
          workspace={workspace}
          current={current}
          defaultDir={defaultDir}
          onDefaultDirChange={setDefaultDir}
          busy={registryBusy}
          onChooseDir={chooseDefaultDir}
          onSaveDir={saveDefaultDir}
          onOpenProject={openProject}
          onRemoveProject={removeProject}
          onDeleteFiles={setDeleteFilesFor}
          onClearRegistry={clearRegistry}
        />
      ) : null}

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      <SettingsDialogs
        deleteFilesFor={deleteFilesFor}
        onCloseDeleteFiles={() => setDeleteFilesFor(null)}
        onDeleteFilesDone={() => void refreshWorkspace()}
        deleteRemoteFor={deleteRemoteFor}
        deleteRemoteAppUrl={account?.appUrl ?? appUrl ?? "https://selldoes.com"}
        onCloseDeleteRemote={() => setDeleteRemoteFor(null)}
        onDeleteRemoteDone={() => void loadPackages()}
        confirmAction={confirmAction}
        confirmBusy={confirmBusy}
        onConfirm={() => void doConfirm()}
        onConfirmOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
      />
    </div>
  )
}
