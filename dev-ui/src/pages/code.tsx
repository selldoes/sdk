import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { type EditorSelection, languageFor } from "@/components/code/monaco-editor"
import { SkeletonEditor } from "@/components/skeletons"
import { dev } from "@/lib/api"
import { setEditorDirty } from "@/lib/dirty-guard"
import type { DevStatus, FileTree, GitStatus } from "@/lib/types"
import { type DevStreamEvent, useDevStream } from "@/lib/use-dev-stream"
import { ws } from "@/lib/ws-api"
import { useApp } from "@/state/app"
import { EditorPane } from "./code/editor-pane"
import { EditorTabs } from "./code/editor-tabs"
import { LeftPanel } from "./code/left-panel"
import { type FileTab, flattenTree, NO_PROBLEMS, PromptDialog, type PromptState, parseProblems } from "./code/shared"

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
  const conflictTab = activeTab?.conflict ? activeTab : null
  const activeProblems = activeTab && !activeTab.diff ? (problems[activeTab.path] ?? NO_PROBLEMS) : NO_PROBLEMS

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
        const [head, working] = await Promise.all([dev.gitShow(path), dev.readFile(path).catch(() => ({ content: "" }))])
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
        setTabs((previous) =>
          previous.map((item) => (item.path === path && !item.diff ? { ...item, dirty: false, conflict: false } : item)),
        )
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
    const base = activeTab?.path.includes("/") ? activeTab.path.slice(0, activeTab.path.lastIndexOf("/") + 1) : ""
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
          setTabs((previous) =>
            previous.map((tab) => (tab.path === path ? { ...tab, path: value, id: tab.diff ? `${value}::diff` : value } : tab)),
          )
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

  const toggleDir = React.useCallback((path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

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

  // ── Conflict resolution ───────────────────────────────────────────────────

  const takeDiskVersion = (tab: FileTab) => {
    void dev.readFile(tab.path).then((file) => {
      setTabs((previous) =>
        previous.map((item) => (item.id === tab.id ? { ...item, content: file.content, dirty: false, conflict: false } : item)),
      )
    })
  }

  const keepMine = (tab: FileTab) => {
    setTabs((previous) => previous.map((item) => (item.id === tab.id ? { ...item, conflict: false } : item)))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const treeItems = tree ? flattenTree(tree.entries, expanded) : []
  const changedFiles = git?.files ?? []
  const dirtyCount = tabs.filter((tab) => tab.dirty).length
  const activePath = activeTab && !activeTab.diff ? activeTab.path : null
  const entryFile = bootstrap?.manifest.entry?.replace(/^\.\//, "") ?? "index.js"

  // First load (and project switches) — show the editor frame instead of an
  // empty pane while `dev.files()` is in flight.
  if (tree === null) {
    return <SkeletonEditor className="h-[calc(100vh-168px)]" />
  }

  return (
    <div className="flex h-[calc(100vh-168px)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-card">
      <LeftPanel
        leftTab={leftTab}
        onLeftTab={setLeftTab}
        treeItems={treeItems}
        expanded={expanded}
        activePath={activePath}
        loadingFile={loadingFile}
        changedCount={changedFiles.length}
        git={git}
        onCreate={createEntry}
        onToggleDir={toggleDir}
        onOpenFile={openFile}
        onRename={renameEntry}
        onDelete={deleteEntry}
        changes={{
          git,
          commitMessage,
          commitBusy,
          onCommitMessage: setCommitMessage,
          onStage: stage,
          onUnstage: unstage,
          onStageAll: stageAll,
          onCommit: commit,
          onInit: initRepo,
          onOpenDiff: openDiff,
          onRefresh: () => void refreshGit(),
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <EditorTabs
          tabs={tabs}
          activeTab={activeTab}
          activeId={activeId}
          saving={saving}
          onSelect={setActiveId}
          onClose={closeTab}
          onSave={saveTab}
          onReveal={revealInEditor}
          onToggleTerminal={() => setTerminalOpen(true)}
        />

        <EditorPane
          activeTab={activeTab}
          activeProblems={activeProblems}
          theme={theme}
          revealLine={revealLine}
          dirtyCount={dirtyCount}
          status={status}
          conflictTab={conflictTab}
          entryFile={entryFile}
          onTakeDisk={takeDiskVersion}
          onKeepMine={keepMine}
          onChange={updateContent}
          onSave={saveTab}
          onSelection={handleSelection}
          onOpenFile={openFile}
          onReveal={revealInEditor}
          onConsole={() => navigate("/console")}
        />
      </div>

      <PromptDialog prompt={prompt} onClose={() => setPrompt(null)} />
    </div>
  )
}
