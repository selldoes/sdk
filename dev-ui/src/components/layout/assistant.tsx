import * as React from "react"
import {
  AlertCircle,
  Check,
  ChevronRight,
  FileCode2,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Settings,
  Sparkles,
  Wand2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { AssistantSettingsDialog } from "@/components/layout/assistant-settings"
import { dev } from "@/lib/api"
import type { ApplyResult } from "@/lib/api"
import { urlPage } from "@/lib/project-url"
import type { AssistantEdits, AssistantFileEdit, SnapshotInfo, Validation } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useApp } from "@/state/app"

// ─── Minimal markdown ────────────────────────────────────────────────────────

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={index} className="rounded bg-background/70 px-1 py-0.5 text-[11px]">
              {part.slice(1, -1)}
            </code>
          )
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        return <React.Fragment key={index}>{part}</React.Fragment>
      })}
    </>
  )
}

function Markdownish({ text }: { text: string }) {
  const blocks = text.split(/```/)
  return (
    <div className="space-y-1.5 whitespace-pre-wrap break-words">
      {blocks.map((block, index) =>
        index % 2 === 1 ? (
          <pre key={index} className="overflow-auto rounded-md bg-background/80 p-2 text-[11px] leading-relaxed">
            <code>{block.replace(/^\w*\n/, "")}</code>
          </pre>
        ) : (
          <p key={index}>
            <InlineText text={block} />
          </p>
        ),
      )}
    </div>
  )
}

// ─── Line diff (LCS, capped for large files) ─────────────────────────────────

type DiffLine = { type: "add" | "del" | "same"; text: string }

function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n")
  const b = after.split("\n")
  if (a.length * b.length > 1_500_000) {
    return [
      ...a.map((text): DiffLine => ({ type: "del", text })),
      ...b.map((text): DiffLine => ({ type: "add", text })),
    ]
  }
  const cols = b.length + 1
  const table = new Uint32Array((a.length + 1) * cols)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j] ? table[(i + 1) * cols + (j + 1)] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      out.push({ type: "del", text: a[i] })
      i += 1
    } else {
      out.push({ type: "add", text: b[j] })
      j += 1
    }
  }
  while (i < a.length) out.push({ type: "del", text: a[i++] })
  while (j < b.length) out.push({ type: "add", text: b[j++] })
  return out
}

const COLLAPSE_CONTEXT = 3

function DiffView({ before, after }: { before: string; after: string }) {
  const lines = React.useMemo(() => diffLines(before, after), [before, after])
  // Collapse long runs of unchanged lines.
  const visible: (DiffLine | { type: "gap"; text: string })[] = []
  let sameRun: DiffLine[] = []
  const flush = () => {
    if (sameRun.length <= COLLAPSE_CONTEXT * 2 + 1) {
      visible.push(...sameRun)
    } else {
      visible.push(...sameRun.slice(0, COLLAPSE_CONTEXT))
      visible.push({ type: "gap", text: `… ${sameRun.length - COLLAPSE_CONTEXT * 2} unchanged lines …` })
      visible.push(...sameRun.slice(-COLLAPSE_CONTEXT))
    }
    sameRun = []
  }
  for (const line of lines) {
    if (line.type === "same") sameRun.push(line)
    else {
      flush()
      visible.push(line)
    }
  }
  flush()
  const changed = lines.some((line) => line.type !== "same")
  if (!changed) return <p className="px-3 py-2 text-[11px] text-muted-foreground">No changes — file already matches.</p>
  return (
    <pre className="max-h-72 overflow-auto border-t border-border bg-muted/40 text-[11px] leading-relaxed">
      {visible.map((line, index) =>
        line.type === "gap" ? (
          <span key={index} className="diff-line block py-0.5 text-center text-muted-foreground">
            {line.text}
          </span>
        ) : (
          <span
            key={index}
            className={cn("diff-line block", line.type === "add" && "diff-add", line.type === "del" && "diff-del")}
          >
            {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
            {line.text}
          </span>
        ),
      )}
    </pre>
  )
}

// ─── Chat item types ─────────────────────────────────────────────────────────

type ChatItem =
  | { id: number; kind: "user"; content: string }
  | { id: number; kind: "assistant"; content: string }
  | { id: number; kind: "system"; content: string }
  | { id: number; kind: "error"; content: string }
  | { id: number; kind: "edits"; edits: AssistantEdits; applied?: { validation: Validation; applied: string[] } }

let cursor = 0
const nextId = () => ++cursor

/** Only conversation text survives a reload — edit cards would be stale. */
function isPersistable(item: ChatItem): boolean {
  return item.kind === "user" || item.kind === "assistant" || item.kind === "system" || item.kind === "error"
}

/** Human summary of an apply result — shown in the chat as a system note. */
function applyFeedback(result: ApplyResult): string {
  const parts = [
    `Applied ${result.applied.length} file(s): ${result.applied.join(", ") || "—"}.`,
    `Validation: ${result.validation.errors.length} error(s), ${result.validation.warnings.length} warning(s).`,
  ]
  if (result.rebuildError) parts.push(`Rebuild failed: ${result.rebuildError}`)
  const test = result.test
  if (test) {
    if (test.skipped) parts.push(`Test job: ${test.skipped}.`)
    else if (test.error) parts.push(`Test job ${test.type ?? "?"} failed: ${test.error}`)
    else {
      parts.push(
        `Test job ${test.type}: ${test.ticks ?? 0} tick(s) · ${test.done ? "done" : "tick limit reached"}${test.result ? ` · ${JSON.stringify(test.result).slice(0, 160)}` : ""}`,
      )
    }
  }
  return parts.join("\n")
}

function EditCard({
  item,
  onApplied,
  onSystem,
}: {
  item: Extract<ChatItem, { kind: "edits" }>
  onApplied: (result: ApplyResult) => void
  onSystem: (message: string) => void
}) {
  const { toast, setAssistantOpen, bootstrap } = useApp()
  const [busy, setBusy] = React.useState(false)
  const [applied, setApplied] = React.useState(item.applied)
  const [runTest, setRunTest] = React.useState(true)
  const edits = item.edits

  const manifestJobs = ((bootstrap?.manifest as { jobs?: { type?: string }[] } | undefined)?.jobs ?? []) as { type?: string }[]
  const testCapable = manifestJobs.some((job) => /test|preview|probe/i.test(String(job?.type ?? "")))

  const apply = async () => {
    setBusy(true)
    try {
      const result = await dev.assistantApply(edits, { testJob: runTest && testCapable })
      setApplied({ validation: result.validation, applied: result.applied })
      toast(result.validation.errors.length ? "Applied — check the errors" : "Changes applied", result.validation.errors.length ? "error" : "success")
      onApplied(result)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    setBusy(true)
    try {
      const { snapshots } = await dev.snapshots()
      const latest = snapshots[snapshots.length - 1]
      if (!latest) {
        toast("Nothing to undo", "error")
        return
      }
      await dev.restoreSnapshot(latest.name)
      toast("Restored the previous version", "success")
      onSystem(`Undid “${latest.reason ?? latest.name}” — files restored.`)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/50 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-bold">
          <Wand2 className="h-3.5 w-3.5" />
          Proposed changes
        </p>
        {edits.summary ? <p className="mt-0.5 text-[11.5px] text-muted-foreground">{edits.summary}</p> : null}
      </div>
      {edits.files?.map((file: AssistantFileEdit) => (
        <details key={file.path} className="border-b border-border last:border-b-0">
          <summary className="flex list-none cursor-pointer items-center gap-2 px-3 py-2 text-[11.5px] [&::-webkit-details-marker]:hidden">
            <Badge variant="outline" className={file.exists === false ? "border-0 bg-emerald-100 text-emerald-700" : "border-0 bg-blue-100 text-blue-700"}>
              {file.exists === false ? "new" : "modified"}
            </Badge>
            <code className="truncate">{file.path}</code>
            <span className="ml-auto text-[10.5px] text-muted-foreground">view diff</span>
          </summary>
          <DiffView before={file.before ?? ""} after={file.content} />
        </details>
      ))}
      {edits.manifest ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11.5px] last:border-b-0">
          <Badge variant="outline" className="border-0 bg-amber-100 text-amber-700">
            manifest
          </Badge>
          <code>plugin.json</code>
          <span className="ml-auto text-[10.5px] text-muted-foreground">details update</span>
        </div>
      ) : null}
      {!applied && testCapable ? (
        <button
          type="button"
          onClick={() => setRunTest((previous) => !previous)}
          className={
            "flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-[11.5px] " +
            (runTest ? "bg-emerald-50 text-emerald-800" : "text-muted-foreground hover:bg-muted/50")
          }
        >
          <span
            className={
              "flex h-3.5 w-3.5 items-center justify-center rounded border " +
              (runTest ? "border-emerald-500 bg-emerald-500 text-white" : "border-border")
            }
          >
            {runTest ? <Check className="h-2.5 w-2.5" /> : null}
          </span>
          Closed loop — run the plugin's test job after applying
        </button>
      ) : null}
      <div className="flex justify-end gap-2 px-3 py-2.5">
        {applied ? (
          <>
            <span className="mr-auto self-center text-[11px] text-muted-foreground">
              {applied.validation.errors.length
                ? `${applied.validation.errors.length} validation error(s)`
                : `Applied: ${applied.applied.join(", ") || "no files"}`}
            </span>
            <Button size="sm" variant="outline" onClick={undo} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              Undo
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setAssistantOpen(false)}>
              Dismiss
            </Button>
            <Button size="sm" onClick={apply} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              Apply changes
            </Button>
          </>
        )}
      </div>
      {applied?.validation.errors.length ? (
        <div className="border-t border-border bg-red-50 px-3 py-2 text-[11px] text-red-800">
          {applied.validation.errors.map((error) => (
            <p key={error}>• {error}</p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ─── History (snapshots) ─────────────────────────────────────────────────────

function HistoryPanel({
  snapshots,
  loading,
  onRestore,
  onRefresh,
}: {
  snapshots: SnapshotInfo[]
  loading: boolean
  onRestore: (snapshot: SnapshotInfo) => void
  onRefresh: () => void
}) {
  return (
    <div className="space-y-2 pb-4">
      <div className="flex items-start gap-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Every save and AI apply is snapshotted. Restore any point — open editor tabs refresh themselves.
        </p>
        <Button variant="ghost" size="icon" className="ml-auto h-6 w-6 shrink-0" title="Refresh" onClick={onRefresh}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history…
        </p>
      ) : snapshots.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
          No snapshots yet — edit a file or ask the AI for a change.
        </p>
      ) : (
        snapshots.map((snapshot) => (
          <div key={snapshot.name} className="rounded-lg border border-border bg-card p-2.5">
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="truncate text-[12px] font-semibold">{snapshot.reason ?? snapshot.name}</p>
              <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => onRestore(snapshot)}>
                Restore
              </Button>
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              {snapshot.at ? new Date(snapshot.at).toLocaleString() : snapshot.name}
              {snapshot.files?.length ? ` · ${snapshot.files.map((file) => file.path).join(", ").slice(0, 80)}` : ""}
            </p>
          </div>
        ))
      )}
    </div>
  )
}

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
  const [config, setConfig] = React.useState<{ configured: boolean; provider?: string; model?: string } | null>(null)
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
          cursor = Math.max(cursor, ...restored.map((item) => item.id))
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
        .filter((item): item is Extract<ChatItem, { kind: "user" | "assistant" }> => item.kind === "user" || item.kind === "assistant")
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
      setItems((previous) => [...previous, { id: nextId(), kind: "system", content: `Restored snapshot “${snapshot.reason ?? snapshot.name}”.` }])
      await loadSnapshots()
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }

  const quick = assistantQuick.length ? assistantQuick : ["Explain what this plugin does right now", "What should I build next?"]

  return (
    <>
      {assistantOpen ? <div className="fixed inset-0 z-50 bg-black/30 xl:hidden" onClick={() => setAssistantOpen(false)} /> : null}
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
              {config?.configured ? `${config.provider ?? "provider"}${config.model ? ` · ${config.model}` : ""}` : "reads your plugin · proposes edits"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Assistant settings" onClick={() => setSettingsOpen(true)}>
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
            <HistoryPanel snapshots={snapshots} loading={snapshotsLoading} onRestore={(snapshot) => void restoreSnapshot(snapshot)} onRefresh={() => void loadSnapshots()} />
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

              {items.map((item) => {
                if (item.kind === "edits")
                  return (
                    <EditCard
                      key={item.id}
                      item={item}
                      onApplied={(result) => {
                        setItems((previous) => [...previous, { id: nextId(), kind: "system", content: applyFeedback(result) }])
                      }}
                      onSystem={(message) => setItems((previous) => [...previous, { id: nextId(), kind: "system", content: message }])}
                    />
                  )
                if (item.kind === "user") {
                  return (
                    <div key={item.id} className="ml-auto max-w-[92%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-[12.5px] text-primary-foreground">
                      {item.content}
                    </div>
                  )
                }
                if (item.kind === "assistant") {
                  return (
                    <div key={item.id} className="max-w-[95%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-[12.5px]">
                      <Markdownish text={item.content} />
                    </div>
                  )
                }
                if (item.kind === "error") {
                  return (
                    <div key={item.id} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {item.content}
                    </div>
                  )
                }
                return (
                  <p
                    key={item.id}
                    className="whitespace-pre-wrap rounded-lg border border-dashed border-border px-3 py-2 text-center text-[11px] text-muted-foreground"
                  >
                    {item.content}
                  </p>
                )
              })}

              {busy ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking — larger edits can take up to a minute…
                </p>
              ) : null}
            </>
          )}
        </div>

        {tab === "chat" ? (
          <div className="shrink-0 border-t border-border p-3">
            {assistantTarget ? (
              <div className="mb-2 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px]">
                <FileCode2 className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate">
                  {assistantTarget.file}
                  {assistantTarget.selection ? ` · lines ${assistantTarget.selection.startLine}–${assistantTarget.selection.endLine}` : ""}
                </span>
                {assistantTarget.selection ? (
                  <>
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void send("Explain the selected code briefly.")}>
                      Explain
                    </button>
                    <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void send("Improve the selected code and propose the edit.")}>
                      Improve
                    </button>
                  </>
                ) : null}
                <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setAssistantTarget(null)}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : null}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {quick.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-primary/40 hover:bg-muted hover:text-foreground disabled:opacity-50"
                  disabled={busy || !config?.configured}
                  onClick={() => void send(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                rows={1}
                className="min-h-[40px] text-[13px]"
                placeholder={config?.configured ? "Ask for a change…" : "Add an API key to enable the assistant"}
                value={input}
                disabled={!config?.configured || busy}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <Button
                size="icon"
                disabled={busy || !config?.configured || !input.trim()}
                onClick={() => void send()}
                title="Send"
              >
                <ChevronRight />
              </Button>
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line. Edits wait for your approval; applied changes refresh open editors — undo from History.
            </p>
            {bootstrap ? (
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                Context: <code className="text-[10px]">{bootstrap.manifest.slug}</code> · {urlPage()}
              </p>
            ) : null}
          </div>
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

function SystemIntro() {
  return (
    <p className="border-b border-dashed border-border pb-3 text-center text-[11px] text-muted-foreground">
      I can read your plugin, explain errors and propose file edits — you review before anything is written.
    </p>
  )
}

function SetupCard({ checking, onCheck, onOpenSettings }: { checking: boolean; onCheck: () => void; onOpenSettings: () => void }) {
  const { toast } = useApp()
  return (
    <div className="space-y-3 text-[12px]">
      <Calloutish>
        <strong>One-time setup.</strong> The assistant calls an AI provider directly from your machine. Configure it here — no restart
        needed.
      </Calloutish>
      <div className="flex gap-2">
        <Button size="sm" onClick={onOpenSettings}>
          <Settings />
          Open settings
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={checking}
          onClick={() => {
            onCheck()
            toast("Re-checking provider…")
          }}
        >
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Check again
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Environment variables work too: <code>OPENROUTER_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, <code>GEMINI_API_KEY</code>,{" "}
        <code>OPENAI_API_KEY</code>, <code>DEEPINFRA_API_KEY</code> — or <code>ollama</code> for local models, no key needed.
      </p>
    </div>
  )
}

function Calloutish({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900">
      <p className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{children}</span>
      </p>
    </div>
  )
}
