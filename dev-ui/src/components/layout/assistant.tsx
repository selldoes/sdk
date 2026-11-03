import { History, Loader2, Settings, Sparkles, X } from "lucide-react"
import * as React from "react"
import { AssistantSettingsDialog } from "@/components/layout/assistant-settings"
import { Button } from "@/components/ui/button"
import { dev } from "@/lib/api"
import { urlPage } from "@/lib/project-url"
import type { SnapshotInfo } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useApp } from "@/state/app"
import { type ChatItem, isPersistable, nextId, seedCursor } from "./assistant/chat"
import { Composer } from "./assistant/composer"
import { HistoryPanel } from "./assistant/history-panel"
import { ChatMessages } from "./assistant/messages"
import { SetupCard, SystemIntro } from "./assistant/setup"
import type { AssistantConfig } from "./assistant/shared"

// ─── Panel ───────────────────────────────────────────────────────────────────

type PanelTab = "chat" | "history"

export function AssistantPanel() {
  const {
    assistantOpen,
    setAssistantOpen,
    assistantQuick,
    assistantContext,
    assistantTarget,
    setAssistantTarget,
    bootstrap,
    workspace,
    toast,
  } = useApp()
  const projectKey = workspace?.current?.project.id ?? bootstrap?.manifest.slug ?? "project"
  const [tab, setTab] = React.useState<PanelTab>("chat")
  const [items, setItems] = React.useState<ChatItem[]>([])
  const [config, setConfig] = React.useState<AssistantConfig | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [input, setInput] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [snapshots, setSnapshots] = React.useState<SnapshotInfo[]>([])
  const [snapshotsLoading, setSnapshotsLoading] = React.useState(false)
  const [historyLoaded, setHistoryLoaded] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const checkConfig = React.useCallback(async () => {
    setChecking(true)
    try {
      const data = await dev.assistant()
      setConfig(data)
      return data
    } catch {
      setConfig({ configured: false })
      return { configured: false }
    } finally {
      setChecking(false)
    }
  }, [])

  React.useEffect(() => {
    if (assistantOpen && config === null) void checkConfig()
  }, [assistantOpen, config, checkConfig])

  // Reset per project: fresh chat + snapshots.
  React.useEffect(() => {
    setHistoryLoaded(false)
    setItems([])
    setSnapshots([])
  }, [projectKey])

  // Load persisted chat once per project.
  React.useEffect(() => {
    if (!assistantOpen || historyLoaded) return
    let active = true
    dev
      .chatHistory()
      .then((data) => {
        if (!active) return
        const restored = (Array.isArray(data.items) ? data.items : []).filter(
          (item): item is ChatItem =>
            Boolean(item) &&
            typeof item === "object" &&
            ["user", "assistant", "system", "error"].includes((item as { kind?: string }).kind ?? ""),
        )
        if (restored.length) {
          seedCursor(restored.map((item) => item.id))
          setItems(restored)
        }
        setHistoryLoaded(true)
      })
      .catch(() => setHistoryLoaded(true))
    return () => {
      active = false
    }
  }, [assistantOpen, historyLoaded])

  // Persist (debounced).
  React.useEffect(() => {
    if (!historyLoaded) return
    const timer = setTimeout(() => {
      void dev.saveChatHistory(items.filter(isPersistable)).catch(() => {})
    }, 800)
    return () => clearTimeout(timer)
  }, [items, historyLoaded])

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [items, busy, tab])

  const loadSnapshots = React.useCallback(async () => {
    setSnapshotsLoading(true)
    try {
      const data = await dev.snapshots()
      setSnapshots([...data.snapshots].reverse())
    } catch {
      // server restarting
    } finally {
      setSnapshotsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (assistantOpen && tab === "history") void loadSnapshots()
  }, [assistantOpen, tab, loadSnapshots])

  const send = async (prompt?: string) => {
    const text = (prompt ?? input).trim()
    if (!text || busy) return
    if (!config) {
      const data = await checkConfig()
      if (!data.configured) return
    }
    setInput("")
    setItems((previous) => [...previous, { id: nextId(), kind: "user", content: text }])
    setBusy(true)
    try {
      const history = items
        .filter(
          (item): item is Extract<ChatItem, { kind: "user" | "assistant" }> => item.kind === "user" || item.kind === "assistant",
        )
        .slice(-12)
        .map((item) => ({ role: item.kind as "user" | "assistant", content: item.content }))
      const result = await dev.assistantChat([...history, { role: "user", content: text }], {
        page: urlPage(),
        context: assistantContext,
        file: assistantTarget?.file,
        language: assistantTarget?.language,
        selection: assistantTarget?.selection,
      })
      if (result.error) {
        setItems((previous) => [...previous, { id: nextId(), kind: "error", content: result.error! }])
        if (result.code === "not-configured") setConfig({ configured: false })
        return
      }
      if (result.text) setItems((previous) => [...previous, { id: nextId(), kind: "assistant", content: result.text! }])
      if (result.edits) setItems((previous) => [...previous, { id: nextId(), kind: "edits", edits: result.edits! }])
    } catch (error) {
      setItems((previous) => [
        ...previous,
        { id: nextId(), kind: "error", content: error instanceof Error ? error.message : String(error) },
      ])
    } finally {
      setBusy(false)
    }
  }

  const restoreSnapshot = async (snapshot: SnapshotInfo) => {
    if (!window.confirm(`Restore “${snapshot.reason ?? snapshot.name}”? Files are replaced with that point in time.`)) return
    try {
      await dev.restoreSnapshot(snapshot.name)
      toast("Snapshot restored", "success")
      setItems((previous) => [
        ...previous,
        { id: nextId(), kind: "system", content: `Restored snapshot “${snapshot.reason ?? snapshot.name}”.` },
      ])
      await loadSnapshots()
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }

  const quick = assistantQuick.length ? assistantQuick : ["Explain what this plugin does right now", "What should I build next?"]

  return (
    <>
      {assistantOpen ? (
        <div className="fixed inset-0 z-50 bg-black/30 xl:hidden" onClick={() => setAssistantOpen(false)} />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-[60] flex w-[400px] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200",
          assistantOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-tight">AI assistant</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {config?.configured
                ? `${config.provider ?? "provider"}${config.model ? ` · ${config.model}` : ""}`
                : "reads your plugin · proposes edits"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Assistant settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAssistantOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1.5">
          <button
            type="button"
            onClick={() => setTab("chat")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11.5px] font-bold",
              tab === "chat" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setTab("history")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-bold",
              tab === "history" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <History className="h-3 w-3" />
            History
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3.5">
          {tab === "history" ? (
            <HistoryPanel
              snapshots={snapshots}
              loading={snapshotsLoading}
              onRestore={(snapshot) => void restoreSnapshot(snapshot)}
              onRefresh={() => void loadSnapshots()}
            />
          ) : (
            <>
              {config === null ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking provider…
                </p>
              ) : !config.configured ? (
                <SetupCard checking={checking} onCheck={checkConfig} onOpenSettings={() => setSettingsOpen(true)} />
              ) : items.length === 0 ? (
                <SystemIntro />
              ) : null}

              <ChatMessages
                items={items}
                onSystem={(message) => setItems((previous) => [...previous, { id: nextId(), kind: "system", content: message }])}
              />

              {busy ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking — larger edits can take up to a minute…
                </p>
              ) : null}
            </>
          )}
        </div>

        {tab === "chat" ? (
          <Composer
            config={config}
            busy={busy}
            input={input}
            onInputChange={setInput}
            quick={quick}
            target={assistantTarget}
            onClearTarget={() => setAssistantTarget(null)}
            onSend={send}
          />
        ) : null}
      </aside>

      <AssistantSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={() => {
          setConfig(null)
          void checkConfig()
        }}
      />
    </>
  )
}
