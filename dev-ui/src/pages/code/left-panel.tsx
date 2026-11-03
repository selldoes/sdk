import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, GitBranch, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { GitStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ChangesPanel, type ChangesPanelProps } from "./changes-panel"
import { fileIcon, type TreeItem } from "./shared"

export interface LeftPanelProps {
  leftTab: "files" | "changes"
  onLeftTab: (tab: "files" | "changes") => void
  treeItems: TreeItem[]
  expanded: Set<string>
  activePath: string | null
  loadingFile: string | null
  changedCount: number
  git: GitStatus | null
  onCreate: (type: "file" | "dir") => void
  onToggleDir: (path: string) => void
  onOpenFile: (path: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  changes: ChangesPanelProps
}

export function LeftPanel(props: LeftPanelProps) {
  const { leftTab, treeItems, expanded, activePath, loadingFile } = props
  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-border">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          onClick={() => props.onLeftTab("files")}
          className={cn(
            "rounded-md px-2 py-1 text-[11.5px] font-bold uppercase tracking-wide",
            leftTab === "files" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Files
        </button>
        <button
          type="button"
          onClick={() => props.onLeftTab("changes")}
          className={cn(
            "rounded-md px-2 py-1 text-[11.5px] font-bold uppercase tracking-wide",
            leftTab === "changes" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Changes
          {props.changedCount ? <span className="ml-1 text-primary">{props.changedCount}</span> : null}
        </button>
        <span className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" title="New file" onClick={() => props.onCreate("file")}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" title="New folder" onClick={() => props.onCreate("dir")}>
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {leftTab === "files" ? (
          treeItems.length === 0 ? (
            <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">Loading files…</p>
          ) : (
            treeItems.map(({ entry, depth }) => {
              const isDir = entry.type === "dir"
              const isOpen = expanded.has(entry.path)
              const active = activePath === entry.path
              const Icon = isDir ? (isOpen ? FolderOpen : Folder) : fileIcon(entry.path.split("/").pop() ?? entry.path)
              return (
                <div
                  key={entry.path}
                  className={cn(
                    "group flex cursor-pointer items-center gap-1.5 py-[3px] pr-1 text-[12px]",
                    active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  style={{ paddingLeft: 6 + depth * 12 }}
                  onClick={() => {
                    if (isDir) {
                      props.onToggleDir(entry.path)
                    } else {
                      props.onOpenFile(entry.path)
                    }
                  }}
                >
                  {isDir ? (
                    isOpen ? (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    )
                  ) : null}
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{entry.path.split("/").pop()}</span>
                  {loadingFile === entry.path ? <Loader2 className="ml-auto h-3 w-3 animate-spin" /> : null}
                  {!isDir ? (
                    <span className="ml-auto hidden items-center gap-0.5 group-hover:flex">
                      <button
                        type="button"
                        className="rounded p-0.5 hover:bg-card"
                        title="Rename"
                        onClick={(event) => {
                          event.stopPropagation()
                          props.onRename(entry.path)
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 hover:bg-card"
                        title="Delete"
                        onClick={(event) => {
                          event.stopPropagation()
                          props.onDelete(entry.path)
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ) : null}
                </div>
              )
            })
          )
        ) : (
          <ChangesPanel {...props.changes} />
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-[10.5px] text-muted-foreground">
        {props.git?.repo ? (
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-3 w-3" />
            {props.git.branch}
            {props.git.ahead ? ` ↑${props.git.ahead}` : ""}
            {props.git.behind ? ` ↓${props.git.behind}` : ""}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-3 w-3" />
            no repository
          </span>
        )}
      </div>
    </div>
  )
}
