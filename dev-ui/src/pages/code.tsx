import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitCompare,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MonacoDiff, MonacoEditor, languageFor, type EditorProblem, type EditorSelection } from "@/components/code/monaco-editor"
import { dev } from "@/lib/api"
import { setEditorDirty } from "@/lib/dirty-guard"
import { ws } from "@/lib/ws-api"
import { cn } from "@/lib/utils"
import { useDevStream, type DevStreamEvent } from "@/lib/use-dev-stream"
import type { DevStatus, FileTree, FileTreeEntry, GitStatus } from "@/lib/types"
import { useApp } from "@/state/app"

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FileTab {
  id: string
  path: string
  content: string
  dirty: boolean
  conflict: boolean
  diff?: { original: string }
}

interface TreeItem {
  entry: FileTreeEntry
  depth: number
}

interface PromptState {
  title: string
  value: string
  submitLabel: string
  placeholder?: string
  onSubmit: (value: string) => void | Promise<void>
}

function sortEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
  return [...entries].sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "dir" ? -1 : 1))
}

function flattenTree(entries: FileTreeEntry[], expanded: Set<string>): TreeItem[] {
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

function fileIcon(name: string) {
  if (name === "plugin.json") return FileJson
  if (/\.(json|config\.js)$/.test(name)) return FileJson
  if (/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(name)) return FileCode2
  return FileText
}

/** Maps esbuild error lines (which may use absolute paths) onto tree paths. */
function parseProblems(errors: string[] | undefined, knownPaths: string[]): Record<string, EditorProblem[]> {
  const map: Record<string, EditorProblem[]> = {}
  for (const line of errors ?? []) {
    const regex = /([^\s"']+\.(?:js|mjs|cjs|ts|tsx|jsx|json|css|html)):(\d+):(\d+)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(line))) {
      const raw = match[1].replace(/\\/g, "/")
      const known = knownPaths
        .filter((path) => raw === path || raw.endsWith(`/${path}`))
        .sort((a, b) => b.length - a.length)[0]
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

function statusBadge(status: string) {
  if (status.includes("?")) return { char: "U", className: "text-emerald-600" }
  if (status.includes("A")) return { char: "A", className: "text-emerald-600" }
  if (status.includes("D")) return { char: "D", className: "text-red-600" }
  if (status.includes("R")) return { char: "R", className: "text-amber-600" }
  return { char: "M", className: "text-amber-600" }
}

const NO_PROBLEMS: EditorProblem[] = []

// ─── Small pieces ────────────────────────────────────────────────────────────

function PromptDialog({ prompt, onClose }: { prompt: PromptState | null; onClose: () => void }) {
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

// ─── Page ────────────────────────────────────────────────────────────────────

export function CodePage() {
  const { bootstrap, workspace, theme, toast, refresh, setAssistantTarget, setAssistantPage, setTerminalOpen } = useApp()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const projectKey = workspace?.current?.project.id ?? bootstrap?.manifest.slug ?? "project"

  const [tree, setTree] = React.useState<FileTree | null>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [tabs, setTabs] = React.useState<FileTab[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<DevStatus | null>(bootstrap?.status ?? null)
  const [git, setGit] = React.useState<GitStatus | null>(null)
  const [leftTab, setLeftTab] = React.useState<"files" | "changes">("files")
  const [commitMessage, setCommitMessage] = React.useState("")
  const [commitBusy, setCommitBusy] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [prompt, setPrompt] = React.useState<PromptState | null>(null)
  const [revealLine, setRevealLine] = React.useState<number | null>(null)
  const [loadingFile, setLoadingFile] = React.useState<string | null>(null)

  const tabsRef = React.useRef(tabs)
  tabsRef.current = tabs
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null
  const files = tree?.entries.filter((entry) => entry.type === "file") ?? []
  const filePaths = React.useMemo(() => files.map((entry) => entry.path), [files])
  const problems = React.useMemo(() => parseProblems(status?.errors, filePaths), [status?.errors, filePaths])
  const conflictTab = activeTab && activeTab.conflict ? activeTab : null
  const activeProblems = activeTab && !activeTab.diff ? problems[activeTab.path] ?? NO_PROBLEMS : NO_PROBLEMS

  // ── Data loading ──────────────────────────────────────────────────────────

  const refreshTree = React.useCallback(async () => {
    try {
      const data = await dev.files()
      setTree(data)
      setExpanded((previous) => {
        if (previous.size > 0) return previous
        return new Set(data.entries.filter((entry) => entry.type === "dir").map((entry) => entry.path))
      })
    } catch {
      // project switching / server restarting
    }
  }, [])

  const refreshGit = React.useCallback(async () => {
    try {
      setGit(await dev.gitStatus())
    } catch {
      setGit(null)
    }
  }, [])

  React.useEffect(() => {
    setTabs([])
    setActiveId(null)
    setTree(null)
    setStatus(bootstrap?.status ?? null)
    setGit(null)
    void refreshTree()
  }, [projectKey, refreshTree]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (leftTab === "changes") void refreshGit()
  }, [leftTab, refreshGit, projectKey])

  // ── Live stream: external changes, build status ───────────────────────────

  const onStream = React.useCallback(
    (event: DevStreamEvent) => {
      if (event.type === "build") {
        setStatus(event.status)
        return
      }
      if (event.type === "files") {
        void refreshTree()
        if (leftTab === "changes") void refreshGit()
        const touched = new Set(event.paths)
        void (async () => {
          for (const path of touched) {
            const tab = tabsRef.current.find((item) => item.path === path && !item.diff)
            if (!tab) continue
            if (tab.dirty) {
              setTabs((previous) => previous.map((item) => (item.id === tab.id ? { ...item, conflict: true } : item)))
              continue
            }
            try {
              const file = await dev.readFile(path)
              setTabs((previous) => previous.map((item) => (item.id === tab.id ? { ...item, content: file.content } : item)))
            } catch {
              // file removed — leave the tab, the user can close it
            }
          }
        })()
      }
    },
    [leftTab, refreshGit, refreshTree],
  )

  useDevStream(onStream, { key: projectKey })

  // ── Assistant context ─────────────────────────────────────────────────────

  React.useEffect(() => {
    setAssistantTarget(null)
    setAssistantPage({ context: activeTab ? `Code page — editing ${activeTab.path}` : "Code page" })
  }, [activeId, projectKey, setAssistantPage, setAssistantTarget]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => () => setAssistantTarget(null), [setAssistantTarget])

  const handleSelection = React.useCallback(
    (selection: EditorSelection | null) => {
      if (!activeTab || activeTab.diff) return
      setAssistantTarget(selection ? { file: activeTab.path, language: languageFor(activeTab.path), selection } : null)
    },
    [activeTab, setAssistantTarget],
  )

  // ── Tabs ──────────────────────────────────────────────────────────────────

  const openFile = React.useCallback(
    async (path: string, line?: number) => {
      const existing = tabsRef.current.find((tab) => tab.id === path)
      if (existing) {
        setActiveId(path)
        if (line) setRevealLine(line)
        return
      }
      setLoadingFile(path)
      try {
        const file = await dev.readFile(path)
        setTabs((previous) => [...previous, { id: path, path, content: file.content, dirty: false, conflict: false }])
        setActiveId(path)
        if (line) setRevealLine(line)
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      } finally {
        setLoadingFile(null)
      }
    },
    [toast],
  )

  const openDiff = React.useCallback(
    async (path: string) => {
      const id = `${path}::diff`
      if (tabsRef.current.some((tab) => tab.id === id)) {
        setActiveId(id)
        return
      }
      try {
        const [head, working] = await Promise.all([
          dev.gitShow(path),
          dev.readFile(path).catch(() => ({ content: "" })),
        ])
        setTabs((previous) => [
          ...previous,
          { id, path, content: working.content, dirty: false, conflict: false, diff: { original: head.content } },
        ])
        setActiveId(id)
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      }
    },
    [toast],
  )

  const closeTab = React.useCallback((tab: FileTab) => {
    if (tab.dirty && !window.confirm(`Discard unsaved changes in ${tab.path}?`)) return
    setTabs((previous) => previous.filter((item) => item.id !== tab.id))
    setActiveId((current) => {
      if (current !== tab.id) return current
      const remaining = tabsRef.current.filter((item) => item.id !== tab.id)
      return remaining.length ? remaining[remaining.length - 1].id : null
    })
  }, [])

  const updateContent = React.useCallback((path: string, content: string) => {
    setTabs((previous) => previous.map((tab) => (tab.path === path && !tab.diff ? { ...tab, content, dirty: true } : tab)))
  }, [])

  const saveTab = React.useCallback(
    async (path: string) => {
      const tab = tabsRef.current.find((item) => item.path === path && !item.diff)
      if (!tab) return
      setSaving(true)
      try {
        const result = await dev.writeFile(path, tab.content)
        setTabs((previous) => previous.map((item) => (item.path === path && !item.diff ? { ...item, dirty: false, conflict: false } : item)))
        if (result.rebuildError) {
          toast(`Saved with build error — ${result.rebuildError.split("\n")[0]}`, "error")
        } else {
          const errors = result.validation?.errors.length ?? 0
          toast(errors ? `Saved ${path} — ${errors} validation error(s)` : `Saved ${path}`, errors ? "error" : "success")
        }
        if (path === "plugin.json") void refresh()
        if (leftTab === "changes") void refreshGit()
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      } finally {
        setSaving(false)
      }
    },
    [toast, refresh, refreshGit, leftTab],
  )

  // ── URL params (?file=…&line=…) ───────────────────────────────────────────

  React.useEffect(() => {
    const file = searchParams.get("file")
    if (!file) return
    const line = Number(searchParams.get("line") ?? 0) || undefined
    void openFile(file, line)
    setSearchParams({}, { replace: true })
  }, [searchParams, openFile, setSearchParams])

  // ── Keyboard / unsaved-changes guards ─────────────────────────────────────

  React.useEffect(() => {
    setEditorDirty(tabs.some((tab) => tab.dirty))
    return () => setEditorDirty(false)
  }, [tabs])

  React.useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (!tabsRef.current.some((tab) => tab.dirty)) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", listener)
    return () => window.removeEventListener("beforeunload", listener)
  }, [])

  React.useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && !event.shiftKey) {
        event.preventDefault()
        if (activeTab && !activeTab.diff) void saveTab(activeTab.path)
      }
    }
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [activeTab, saveTab])

  // ── File actions ──────────────────────────────────────────────────────────

  const createEntry = (type: "file" | "dir") => {
    const base = activeTab && activeTab.path.includes("/") ? activeTab.path.slice(0, activeTab.path.lastIndexOf("/") + 1) : ""
    setPrompt({
      title: type === "dir" ? "New folder" : "New file",
      value: base,
      placeholder: type === "dir" ? "folder/name" : "folder/file.js",
      submitLabel: "Create",
      onSubmit: async (value) => {
        try {
          const result = await dev.createFile(value, type)
          toast(`Created ${result.path}`, "success")
          await refreshTree()
          if (type === "file") void openFile(result.path)
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), "error")
        }
      },
    })
  }

  const renameEntry = (path: string) => {
    setPrompt({
      title: `Rename ${path}`,
      value: path,
      submitLabel: "Rename",
      onSubmit: async (value) => {
        try {
          await dev.renameFile(path, value)
          setTabs((previous) => previous.map((tab) => (tab.path === path ? { ...tab, path: value, id: tab.diff ? `${value}::diff` : value } : tab)))
          if (activeId === path || activeId === `${path}::diff`) setActiveId(value)
          toast(`Renamed to ${value}`, "success")
          await refreshTree()
          if (leftTab === "changes") void refreshGit()
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error), "error")
        }
      },
    })
  }

  const deleteEntry = (path: string) => {
    if (!window.confirm(`Delete ${path}? This is undoable from the AI panel's History tab.`)) return
    void (async () => {
      try {
        await dev.deleteFile(path)
        setTabs((previous) => previous.filter((tab) => tab.path !== path))
        if (activeId === path || activeId === `${path}::diff`) setActiveId(null)
        toast(`Deleted ${path}`, "success")
        await refreshTree()
        if (leftTab === "changes") void refreshGit()
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error")
      }
    })()
  }

  const revealInEditor = (path?: string, line?: number) => {
    const input = { file: path, line: line ?? undefined }
    const request = workspace ? ws.openEditor(input) : dev.openEditor(input)
    request
      .then((result) => toast(`Opened in ${result.editor ?? "your editor"}`, "success"))
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "error"))
  }

  // ── Git actions ───────────────────────────────────────────────────────────

  const stage = (path: string) => {
    void dev
      .gitStage([path])
      .then(setGit)
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "error"))
  }
  const unstage = (path: string) => {
    void dev
      .gitUnstage([path])
      .then(setGit)
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "error"))
  }
  const stageAll = () => {
    const paths = (git?.files ?? []).map((file) => file.path)
    void dev
      .gitStage(paths)
      .then(setGit)
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "error"))
  }
  const commit = () => {
    const paths = (git?.files ?? []).map((file) => file.path)
    if (!commitMessage.trim()) return
    setCommitBusy(true)
    dev
      .gitCommit(commitMessage.trim(), paths)
      .then((result) => {
        setGit(result)
        setCommitMessage("")
        toast("Committed", "success")
      })
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "error"))
      .finally(() => setCommitBusy(false))
  }
  const initRepo = () => {
    void dev
      .gitInit()
      .then((result) => {
        setGit(result)
        toast("Git repository initialized", "success")
      })
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "error"))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const treeItems = tree ? flattenTree(tree.entries, expanded) : []
  const changedFiles = git?.files ?? []
  const dirtyCount = tabs.filter((tab) => tab.dirty).length

  return (
    <div className="flex h-[calc(100vh-168px)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-card">
      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <button
            type="button"
            onClick={() => setLeftTab("files")}
            className={cn(
              "rounded-md px-2 py-1 text-[11.5px] font-bold uppercase tracking-wide",
              leftTab === "files" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Files
          </button>
          <button
            type="button"
            onClick={() => setLeftTab("changes")}
            className={cn(
              "rounded-md px-2 py-1 text-[11.5px] font-bold uppercase tracking-wide",
              leftTab === "changes" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Changes
            {changedFiles.length ? <span className="ml-1 text-primary">{changedFiles.length}</span> : null}
          </button>
          <span className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-6 w-6" title="New file" onClick={() => createEntry("file")}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" title="New folder" onClick={() => createEntry("dir")}>
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
                const active = activeTab?.path === entry.path && !activeTab.diff
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
                        setExpanded((previous) => {
                          const next = new Set(previous)
                          if (next.has(entry.path)) next.delete(entry.path)
                          else next.add(entry.path)
                          return next
                        })
                      } else {
                        void openFile(entry.path)
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
                            renameEntry(entry.path)
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
                            deleteEntry(entry.path)
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
            <ChangesPanel
              git={git}
              commitMessage={commitMessage}
              commitBusy={commitBusy}
              onCommitMessage={setCommitMessage}
              onStage={stage}
              onUnstage={unstage}
              onStageAll={stageAll}
              onCommit={commit}
              onInit={initRepo}
              onOpenDiff={openDiff}
              onRefresh={() => void refreshGit()}
            />
          )}
        </div>

        <div className="border-t border-border px-3 py-2 text-[10.5px] text-muted-foreground">
          {git?.repo ? (
            <span className="flex items-center gap-1.5">
              <GitBranch className="h-3 w-3" />
              {git.branch}
              {git.ahead ? ` ↑${git.ahead}` : ""}
              {git.behind ? ` ↓${git.behind}` : ""}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <GitBranch className="h-3 w-3" />
              no repository
            </span>
          )}
        </div>
      </div>

      {/* ── Editor ─────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center border-b border-border">
          <div className="flex min-w-0 flex-1 items-end overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveId(tab.id)}
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
                    closeTab(tab)
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
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Save (Ctrl/Cmd+S)" onClick={() => void saveTab(activeTab.path)} disabled={saving || !activeTab.dirty}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Open this file in your editor"
                  onClick={() => revealInEditor(activeTab.path)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : null}
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Toggle terminal (Ctrl/Cmd+`)" onClick={() => setTerminalOpen(true)}>
              <SquareTerminal className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {conflictTab ? (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11.5px] text-amber-800">
            <AlertCircle className="h-3.5 w-3.5" />
            This file changed on disk while you had unsaved edits.
            <button
              type="button"
              className="ml-auto font-semibold underline"
              onClick={() => {
                void dev.readFile(conflictTab.path).then((file) => {
                  setTabs((previous) => previous.map((tab) => (tab.id === conflictTab.id ? { ...tab, content: file.content, dirty: false, conflict: false } : tab)))
                })
              }}
            >
              Take disk version
            </button>
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => setTabs((previous) => previous.map((tab) => (tab.id === conflictTab.id ? { ...tab, conflict: false } : tab)))}
            >
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
                onChange={(value) => updateContent(activeTab.path, value)}
                onSave={() => void saveTab(activeTab.path)}
                onSelection={handleSelection}
              />
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <FileCode2 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Open a file from the tree, or press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px]">Ctrl/Cmd+P</kbd>
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void openFile("plugin.json")}>
                  Edit plugin.json
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void openFile(bootstrap?.manifest.entry?.replace(/^\.\//, "") ?? "index.js")}
                >
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
            <button type="button" className="flex items-center gap-1 text-red-600" onClick={() => navigate("/console")}>
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
              <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => revealInEditor(activeTab.path, 1)}>
                <ExternalLink className="h-3 w-3" />
                open in editor
              </button>
            ) : null}
            <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => revealInEditor()}>
              <Folder className="h-3 w-3" />
              project folder
            </button>
          </span>
        </div>
      </div>

      <PromptDialog prompt={prompt} onClose={() => setPrompt(null)} />
    </div>
  )
}

// ─── Git changes panel ───────────────────────────────────────────────────────

interface ChangesPanelProps {
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

function ChangesPanel(props: ChangesPanelProps) {
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
          <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground" title="Refresh" onClick={props.onRefresh}>
            <RefreshCw className="h-3 w-3" />
          </button>
          {files.length ? (
            <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground" title="Stage all" onClick={props.onStageAll}>
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
          <Button size="sm" className="w-full" disabled={props.commitBusy || !props.commitMessage.trim()} onClick={props.onCommit}>
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
