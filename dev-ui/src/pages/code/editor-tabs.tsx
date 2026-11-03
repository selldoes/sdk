import { AlertCircle, ExternalLink, GitCompare, Loader2, Save, SquareTerminal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { FileTab } from "./shared"

export interface EditorTabsProps {
  tabs: FileTab[]
  activeTab: FileTab | null
  activeId: string | null
  saving: boolean
  onSelect: (id: string) => void
  onClose: (tab: FileTab) => void
  onSave: (path: string) => void
  onReveal: (path: string) => void
  onToggleTerminal: () => void
}

export function EditorTabs(props: EditorTabsProps) {
  const { tabs, activeTab, activeId, saving } = props
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-border">
      <div className="flex min-w-0 flex-1 items-end overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => props.onSelect(tab.id)}
            className={cn(
              "group flex h-9 max-w-[220px] shrink-0 items-center gap-1.5 border-r border-border px-2.5 text-[12px]",
              activeId === tab.id ? "bg-background text-foreground" : "bg-muted/40 text-muted-foreground hover:text-foreground",
            )}
            title={tab.path}
          >
            {tab.diff ? <GitCompare className="h-3.5 w-3.5 shrink-0" /> : null}
            <span className="truncate">{tab.path.split("/").pop()}</span>
            {tab.dirty ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> : null}
            {tab.conflict ? <AlertCircle className="h-3 w-3 shrink-0 text-amber-500" /> : null}
            <span
              role="button"
              tabIndex={-1}
              className="ml-0.5 rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                props.onClose(tab)
              }}
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 px-2">
        {activeTab && !activeTab.diff ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Save (Ctrl/Cmd+S)"
              onClick={() => props.onSave(activeTab.path)}
              disabled={saving || !activeTab.dirty}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Open this file in your editor"
              onClick={() => props.onReveal(activeTab.path)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Toggle terminal (Ctrl/Cmd+`)"
          onClick={props.onToggleTerminal}
        >
          <SquareTerminal className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
