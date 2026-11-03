import { FileCode2, FileJson, FileText } from "lucide-react"
import * as React from "react"
import type { EditorProblem } from "@/components/code/monaco-editor"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { FileTreeEntry } from "@/lib/types"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FileTab {
  id: string
  path: string
  content: string
  dirty: boolean
  conflict: boolean
  diff?: { original: string }
}

export interface TreeItem {
  entry: FileTreeEntry
  depth: number
}

export interface PromptState {
  title: string
  value: string
  submitLabel: string
  placeholder?: string
  onSubmit: (value: string) => void | Promise<void>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function sortEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
  return [...entries].sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "dir" ? -1 : 1))
}

export function flattenTree(entries: FileTreeEntry[], expanded: Set<string>): TreeItem[] {
  const children = new Map<string, FileTreeEntry[]>()
  const roots: FileTreeEntry[] = []
  for (const entry of entries) {
    const index = entry.path.lastIndexOf("/")
    if (index === -1) {
      roots.push(entry)
    } else {
      const parent = entry.path.slice(0, index)
      const list = children.get(parent) ?? []
      list.push(entry)
      children.set(parent, list)
    }
  }
  const out: TreeItem[] = []
  const visit = (items: FileTreeEntry[], depth: number) => {
    for (const entry of sortEntries(items)) {
      out.push({ entry, depth })
      if (entry.type === "dir" && expanded.has(entry.path)) {
        visit(children.get(entry.path) ?? [], depth + 1)
      }
    }
  }
  visit(roots, 0)
  return out
}

export function fileIcon(name: string) {
  if (name === "plugin.json") return FileJson
  if (/\.(json|config\.js)$/.test(name)) return FileJson
  if (/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(name)) return FileCode2
  return FileText
}

/** Maps esbuild error lines (which may use absolute paths) onto tree paths. */
export function parseProblems(errors: string[] | undefined, knownPaths: string[]): Record<string, EditorProblem[]> {
  const map: Record<string, EditorProblem[]> = {}
  for (const line of errors ?? []) {
    const regex = /([^\s"']+\.(?:js|mjs|cjs|ts|tsx|jsx|json|css|html)):(\d+):(\d+)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(line))) {
      const raw = match[1].replace(/\\/g, "/")
      const known = knownPaths.filter((path) => raw === path || raw.endsWith(`/${path}`)).sort((a, b) => b.length - a.length)[0]
      const file = known ?? raw.split("/").slice(-2).join("/")
      const problem: EditorProblem = {
        line: Number(match[2]),
        column: Number(match[3]),
        message: line.trim().slice(0, 300),
        severity: "error",
      }
      map[file] = [...(map[file] ?? []), problem]
    }
  }
  return map
}

export function statusBadge(status: string) {
  if (status.includes("?")) return { char: "U", className: "text-emerald-600" }
  if (status.includes("A")) return { char: "A", className: "text-emerald-600" }
  if (status.includes("D")) return { char: "D", className: "text-red-600" }
  if (status.includes("R")) return { char: "R", className: "text-amber-600" }
  return { char: "M", className: "text-amber-600" }
}

export const NO_PROBLEMS: EditorProblem[] = []

// ─── Prompt dialog ───────────────────────────────────────────────────────────

export function PromptDialog({ prompt, onClose }: { prompt: PromptState | null; onClose: () => void }) {
  const [value, setValue] = React.useState("")
  React.useEffect(() => {
    setValue(prompt?.value ?? "")
  }, [prompt])
  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      {prompt ? (
        <DialogContent className="max-w-sm" dismissible>
          <DialogHeader>
            <DialogTitle className="text-base">{prompt.title}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!value.trim()) return
              void prompt.onSubmit(value.trim())
              onClose()
            }}
          >
            <Input autoFocus value={value} placeholder={prompt.placeholder} onChange={(event) => setValue(event.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!value.trim()}>
                {prompt.submitLabel}
              </Button>
            </div>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
