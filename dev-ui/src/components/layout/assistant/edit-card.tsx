import { Check, Loader2, RotateCcw, Wand2 } from "lucide-react"
import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ApplyResult } from "@/lib/api"
import { dev } from "@/lib/api"
import type { AssistantFileEdit } from "@/lib/types"
import { useApp } from "@/state/app"
import type { ChatItem } from "./chat"
import { DiffView } from "./diff"

export function EditCard({
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
      toast(
        result.validation.errors.length ? "Applied — check the errors" : "Changes applied",
        result.validation.errors.length ? "error" : "success",
      )
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
            <Badge
              variant="outline"
              className={
                file.exists === false ? "border-0 bg-emerald-100 text-emerald-700" : "border-0 bg-blue-100 text-blue-700"
              }
            >
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
