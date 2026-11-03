import { AlertCircle, CheckCircle2, ExternalLink, FileCode2, Folder } from "lucide-react"
import { type EditorProblem, type EditorSelection, languageFor, MonacoDiff, MonacoEditor } from "@/components/code/monaco-editor"
import { Button } from "@/components/ui/button"
import type { DevStatus } from "@/lib/types"
import type { FileTab } from "./shared"

export interface EditorPaneProps {
  activeTab: FileTab | null
  activeProblems: EditorProblem[]
  theme: "light" | "dark"
  revealLine: number | null
  dirtyCount: number
  status: DevStatus | null
  conflictTab: FileTab | null
  entryFile: string
  onTakeDisk: (tab: FileTab) => void
  onKeepMine: (tab: FileTab) => void
  onChange: (path: string, value: string) => void
  onSave: (path: string) => void
  onSelection: (selection: EditorSelection | null) => void
  onOpenFile: (path: string) => void
  onReveal: (path?: string, line?: number) => void
  onConsole: () => void
}

export function EditorPane(props: EditorPaneProps) {
  const { activeTab, activeProblems, theme, revealLine, dirtyCount, status, conflictTab } = props
  return (
    <>
      {conflictTab ? (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-800">
          <AlertCircle className="h-3.5 w-3.5" />
          This file changed on disk while you had unsaved edits.
          <button type="button" className="ml-auto font-semibold underline" onClick={() => props.onTakeDisk(conflictTab)}>
            Take disk version
          </button>
          <button type="button" className="font-semibold underline" onClick={() => props.onKeepMine(conflictTab)}>
            Keep mine
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {activeTab ? (
          activeTab.diff ? (
            <MonacoDiff path={activeTab.path} original={activeTab.diff.original} modified={activeTab.content} theme={theme} />
          ) : (
            <MonacoEditor
              path={activeTab.path}
              value={activeTab.content}
              theme={theme}
              problems={activeProblems}
              revealLine={revealLine}
              onChange={(value) => props.onChange(activeTab.path, value)}
              onSave={() => props.onSave(activeTab.path)}
              onSelection={props.onSelection}
            />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <FileCode2 className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Open a file from the tree, or press{" "}
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px]">Ctrl/Cmd+P</kbd>
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => props.onOpenFile("plugin.json")}>
                Edit plugin.json
              </Button>
              <Button size="sm" variant="outline" onClick={() => props.onOpenFile(props.entryFile)}>
                Edit entry
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-[10.5px] text-muted-foreground">
        {activeTab ? <span>{activeTab.diff ? "diff" : languageFor(activeTab.path)}</span> : null}
        {dirtyCount ? <span className="text-primary">{dirtyCount} unsaved</span> : null}
        {status?.lastError ? (
          <button type="button" className="flex items-center gap-1 text-red-600" onClick={props.onConsole}>
            <AlertCircle className="h-3 w-3" />
            build error
          </button>
        ) : (
          <span className="flex items-center gap-1 text-emerald-600">
            <CheckCircle2 className="h-3 w-3" />
            built
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {activeTab && !activeTab.diff ? (
            <button
              type="button"
              className="flex items-center gap-1 hover:text-foreground"
              onClick={() => props.onReveal(activeTab.path, 1)}
            >
              <ExternalLink className="h-3 w-3" />
              open in editor
            </button>
          ) : null}
          <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => props.onReveal()}>
            <Folder className="h-3 w-3" />
            project folder
          </button>
        </span>
      </div>
    </>
  )
}
