import { GitBranch, Loader2, Plus, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { GitStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { statusBadge } from "./shared"

export interface ChangesPanelProps {
  git: GitStatus | null
  commitMessage: string
  commitBusy: boolean
  onCommitMessage: (value: string) => void
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  onStageAll: () => void
  onCommit: () => void
  onInit: () => void
  onOpenDiff: (path: string) => void
  onRefresh: () => void
}

export function ChangesPanel(props: ChangesPanelProps) {
  const { git } = props
  if (!git) return <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">Checking git…</p>
  if (!git.repo) {
    return (
      <div className="space-y-2 px-3 py-4 text-center">
        <GitBranch className="mx-auto h-5 w-5 text-muted-foreground" />
        <p className="text-[11px] text-muted-foreground">This project is not a git repository.</p>
        <Button size="sm" variant="outline" onClick={props.onInit}>
          Initialize repository
        </Button>
      </div>
    )
  }
  const files = git.files ?? []
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-2 pb-1">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          {files.length ? `${files.length} change${files.length === 1 ? "" : "s"}` : "clean"}
        </span>
        <span className="ml-auto flex gap-0.5">
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            title="Refresh"
            onClick={props.onRefresh}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          {files.length ? (
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Stage all"
              onClick={props.onStageAll}
            >
              <Plus className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => {
          const badge = statusBadge(file.status)
          const staged = file.status[0] !== " " && file.status[0] !== "?"
          return (
            <div
              key={file.path}
              className="group flex cursor-pointer items-center gap-1.5 px-2 py-[3px] text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => props.onOpenDiff(file.path)}
              title={file.path}
            >
              <span className={cn("w-3 shrink-0 text-center font-bold", badge.className)}>{badge.char}</span>
              <span className="truncate">{file.path}</span>
              <span className="ml-auto hidden shrink-0 gap-0.5 group-hover:flex">
                {staged ? (
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-card"
                    title="Unstage"
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onUnstage(file.path)
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-card"
                    title="Stage"
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onStage(file.path)
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
      {files.length ? (
        <div className="space-y-1.5 border-t border-border p-2">
          <Input
            value={props.commitMessage}
            placeholder="Commit message"
            className="h-7 text-[11.5px]"
            onChange={(event) => props.onCommitMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                props.onCommit()
              }
            }}
          />
          <Button
            size="sm"
            className="w-full"
            disabled={props.commitBusy || !props.commitMessage.trim()}
            onClick={props.onCommit}
          >
            {props.commitBusy ? <Loader2 className="animate-spin" /> : null}
            Commit changes
          </Button>
        </div>
      ) : null}
      {git.error ? <p className="border-t border-border px-2 py-1.5 text-[10.5px] text-red-600">{git.error}</p> : null}
      {git.ahead || git.behind ? (
        <p className="border-t border-border px-2 py-1.5 text-[10.5px] text-muted-foreground">
          {git.ahead ? `${git.ahead} ahead ` : ""}
          {git.behind ? `${git.behind} behind` : ""}
        </p>
      ) : null}
    </div>
  )
}
