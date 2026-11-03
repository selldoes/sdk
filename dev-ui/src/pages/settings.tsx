import * as React from "react"
import { PageHead } from "@/components/shared"
import { dev } from "@/lib/api"
import { type AccentName, accentFor } from "@/lib/project-colors"
import type { BumpMode, DevConfigResponse, StoreStatusResponse, StoreVerifyResponse } from "@/lib/types"
import { useBusySet } from "@/lib/use-busy"
import { useVisit } from "@/lib/use-visit"
import type { WsProject } from "@/lib/ws-api"
import { ws } from "@/lib/ws-api"
import { useApp } from "@/state/app"
import { AssistantModelCard } from "./settings/assistant-model-card"
import { DangerZoneCard } from "./settings/danger-zone-card"
import { DevServerCard } from "./settings/dev-server-card"
import { SettingsDialogs } from "./settings/dialogs"
import { ProjectCard } from "./settings/project-card"
import { ReleasesCard } from "./settings/releases-card"
import type { ConfirmAction } from "./settings/shared"
import { StoreCard } from "./settings/store-card"
import { StorePickerDialog } from "./settings/store-picker-dialog"

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
  const [confirmAction, setConfirmAction] = React.useState<ConfirmAction | null>(null)
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

  const openEditor = () =>
    quickAction("open-editor", async () => {
      const result = await ws.openEditor()
      toast(`Opened in ${result.editor ?? "your editor"}`, "success")
    })

  const openTerminal = () =>
    quickAction("open-terminal", async () => {
      await ws.openEditor({ terminal: true })
      toast("Terminal opened", "success")
    })

  const restartPreview = () =>
    quickAction("restart", async () => {
      await ws.restart()
      toast("Preview restarted", "success")
    })

  const removeFromWorkspace = (project: WsProject | null) => {
    if (!project) return
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
  }

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

  // ── Live store connection ─────────────────────────────────────────────────
  const [store, setStore] = React.useState<StoreStatusResponse | null>(null)
  const [storeError, setStoreError] = React.useState<string | null>(null)
  const [liveApiKey, setLiveApiKey] = React.useState("")
  // Store-picker dialog — filled by storeVerify (key → list of stores).
  const [storePicker, setStorePicker] = React.useState<StoreVerifyResponse | null>(null)
  const [storePickerUsingStoredKey, setStorePickerUsingStoredKey] = React.useState(false)
  const [storePickId, setStorePickId] = React.useState<number | null>(null)

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

  // Store status loads on its own (not via /__dev/config) so an outdated dev
  // server shows a clear hint instead of an endless skeleton.
  React.useEffect(() => {
    let active = true
    void dev
      .storeStatus()
      .then((data) => {
        if (!active) return
        setStore(data)
        setStoreError(null)
      })
      .catch((cause) => {
        if (!active) return
        setStore(null)
        setStoreError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      active = false
    }
  }, [])

  /**
   * Step 1 — verify the merchant API key (or reuse the stored one when
   * changing store) and open the picker dialog with the account's stores.
   */
  const openStorePicker = async (usingStoredKey: boolean) => {
    await run(
      "store-verify",
      async () => {
        const result = await dev.storeVerify(usingStoredKey ? { useStoredKey: true } : { apiKey: liveApiKey.trim() })
        setStorePicker(result)
        setStorePickerUsingStoredKey(usingStoredKey)
        setStorePickId(result.stores.length === 1 ? result.stores[0].id : (store?.storeId ?? result.stores[0]?.id ?? null))
      },
      configBusy,
    )
  }

  const closeStorePicker = () => {
    setStorePicker(null)
    setStorePickId(null)
  }

  /** Step 2 — connect the picked store. */
  const connectPickedStore = async () => {
    if (storePicker === null || storePickId === null) return
    await run(
      "store-connect",
      async () => {
        const result = await dev.storeConnect({
          ...(storePickerUsingStoredKey ? { useStoredKey: true } : { apiKey: liveApiKey.trim() }),
          storeId: storePickId,
        })
        setStore(result)
        setLiveApiKey("")
        closeStorePicker()
        toast(
          `Connected to ${result.storeName || result.storeSlug || result.storeId} — ctx.products now writes to the real store`,
          "success",
        )
      },
      configBusy,
    )
  }

  const disconnectLiveStore = async () => {
    await run(
      "store-disconnect",
      async () => {
        const result = await dev.storeDisconnect()
        setStore(result)
        toast("Live store disconnected — ctx.products back on the local mock", "success")
      },
      configBusy,
    )
  }

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
        toast(
          value ? "Project model override saved" : "Project model override cleared — using your User settings model",
          "success",
        )
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
      <ProjectCard
        workspaceMode={workspaceMode}
        current={current}
        manifest={manifest}
        activeAccent={activeAccent}
        busy={projectBusy}
        onSetColor={setColor}
        onOpenEditor={openEditor}
        onOpenTerminal={openTerminal}
        onRestartPreview={restartPreview}
        onRemove={() => removeFromWorkspace(current)}
        onDeleteFiles={() => setDeleteFilesFor(current)}
      />

      {/* ── Releases ────────────────────────────────────────────────────── */}
      <ReleasesCard
        busy={configBusy}
        config={config}
        configError={configError}
        releaseBump={releaseBump}
        onReleaseBumpChange={setReleaseBump}
        onSave={() => void saveRelease()}
      />

      {/* ── Assistant model override ────────────────────────────────────── */}
      <AssistantModelCard
        busy={configBusy}
        config={config}
        configError={configError}
        modelOverride={modelOverride}
        onModelOverrideChange={setModelOverride}
        onSaveOverride={(value) => void saveModelOverride(value)}
      />

      {/* ── Live store connection ──────────────────────────────────────── */}
      <StoreCard
        busy={configBusy}
        store={store}
        storeError={storeError}
        liveApiKey={liveApiKey}
        onLiveApiKeyChange={setLiveApiKey}
        onOpenStorePicker={(usingStoredKey) => void openStorePicker(usingStoredKey)}
        onDisconnect={() => void disconnectLiveStore()}
      />

      {/* ── Dev-server config ───────────────────────────────────────────── */}
      <DevServerCard
        busy={configBusy}
        config={config}
        configError={configError}
        storeId={storeId}
        onStoreIdChange={setStoreId}
        storeSlug={storeSlug}
        onStoreSlugChange={setStoreSlug}
        storeName={storeName}
        onStoreNameChange={setStoreName}
        port={port}
        onPortChange={setPort}
        host={host}
        onHostChange={setHost}
        emailDisabled={emailDisabled}
        onEmailDisabledChange={setEmailDisabled}
        mockReply={mockReply}
        onMockReplyChange={setMockReply}
        sampleJobs={sampleJobs}
        onSampleJobsChange={setSampleJobs}
        onSave={() => void saveServerConfig()}
      />

      {/* ── Danger zone (local preview data) ────────────────────────────── */}
      <DangerZoneCard onResetData={resetData} onClearUndo={clearUndo} />

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      <StorePickerDialog
        storePicker={storePicker}
        usingStoredKey={storePickerUsingStoredKey}
        storePickId={storePickId}
        busy={configBusy}
        onPick={setStorePickId}
        onClose={closeStorePicker}
        onConnect={() => void connectPickedStore()}
      />
      <SettingsDialogs
        deleteFilesFor={deleteFilesFor}
        onCloseDeleteFiles={() => setDeleteFilesFor(null)}
        onDeleteFilesDone={() => void refreshWorkspace()}
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
