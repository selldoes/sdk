import * as React from "react"
import { configureMonaco } from "./monaco-setup"

type Monaco = typeof import("monaco-editor")
type CodeEditor = import("monaco-editor").editor.IStandaloneCodeEditor
type TextModel = import("monaco-editor").editor.ITextModel
type DiffEditor = import("monaco-editor").editor.IStandaloneDiffEditor

let monacoPromise: Promise<Monaco> | null = null

/** Lazily loads Monaco + applies the SDK-aware configuration exactly once. */
export function loadMonaco(): Promise<Monaco> {
  if (!monacoPromise) {
    monacoPromise = import("monaco-editor").then((monaco) => {
      configureMonaco(monaco)
      return monaco
    })
  }
  return monacoPromise
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: "javascript",
  cjs: "javascript",
  mjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  svg: "xml",
  txt: "plaintext",
}

export function languageFor(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath
  if (name === "plugin.json") return "json"
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  return LANGUAGE_BY_EXTENSION[extension] ?? "plaintext"
}

export interface EditorProblem {
  line: number
  column: number
  endLine?: number
  endColumn?: number
  message: string
  severity: "error" | "warning"
}

export interface EditorSelection {
  startLine: number
  endLine: number
  text: string
}

interface MonacoEditorProps {
  path: string
  value: string
  readOnly?: boolean
  theme: "light" | "dark"
  problems?: EditorProblem[]
  revealLine?: number | null
  onChange?: (value: string) => void
  onSave?: () => void
  onSelection?: (selection: EditorSelection | null) => void
}

/**
 * A thin Monaco wrapper: one editor per page, one model per open file (so
 * per-file undo stacks and cursor positions survive tab switches).
 */
export function MonacoEditor({ path, value, readOnly, theme, problems, revealLine, onChange, onSave, onSelection }: MonacoEditorProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const monacoRef = React.useRef<Monaco | null>(null)
  const editorRef = React.useRef<CodeEditor | null>(null)
  const modelsRef = React.useRef(new Map<string, TextModel>())
  // Monaco's model service is global — two editor instances (e.g. job cards
  // all previewing index.js) must not share model URIs or createModel throws.
  const instanceIdRef = React.useRef(`i${Math.random().toString(36).slice(2, 9)}`)
  const [ready, setReady] = React.useState(false)
  const callbacksRef = React.useRef({ onChange, onSave, onSelection })
  callbacksRef.current = { onChange, onSave, onSelection }
  const themeRef = React.useRef(theme)
  themeRef.current = theme

  React.useEffect(() => {
    let disposed = false
    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return
      monacoRef.current = monaco
      const editor = monaco.editor.create(containerRef.current, {
        theme: themeRef.current === "dark" ? "vs-dark" : "vs",
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12.5,
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        tabSize: 2,
        padding: { top: 10 },
        renderWhitespace: "selection",
        fixedOverflowWidgets: true,
      })
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacksRef.current.onSave?.())
      editor.onDidChangeModelContent(() => {
        const model = editor.getModel()
        if (model) callbacksRef.current.onChange?.(model.getValue())
      })
      editor.onDidChangeCursorSelection((event) => {
        const model = editor.getModel()
        if (!model) return
        const text = model.getValueInRange(event.selection)
        callbacksRef.current.onSelection?.(
          text ? { startLine: event.selection.startLineNumber, endLine: event.selection.endLineNumber, text } : null,
        )
      })
      editorRef.current = editor
      setReady(true)
    })
    return () => {
      disposed = true
      editorRef.current?.dispose()
      editorRef.current = null
      monacoRef.current = null
      for (const model of modelsRef.current.values()) model.dispose()
      modelsRef.current.clear()
      setReady(false)
    }
  }, [])

  React.useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!ready || !monaco || !editor) return
    let model = modelsRef.current.get(path)
    if (!model) {
      model = monaco.editor.createModel(
        value,
        languageFor(path),
        monaco.Uri.parse(`inmemory://selldoes/${instanceIdRef.current}/${encodeURI(path)}`),
      )
      modelsRef.current.set(path, model)
    }
    if (editor.getModel() !== model) editor.setModel(model)
    if (model.getValue() !== value) model.setValue(value)
  }, [ready, path, value])

  React.useEffect(() => {
    if (!ready || !monacoRef.current) return
    monacoRef.current.editor.setTheme(theme === "dark" ? "vs-dark" : "vs")
  }, [ready, theme])

  React.useEffect(() => {
    if (!ready || !editorRef.current) return
    editorRef.current.updateOptions({ readOnly: Boolean(readOnly) })
  }, [ready, readOnly])

  React.useEffect(() => {
    const monaco = monacoRef.current
    const model = modelsRef.current.get(path)
    if (!ready || !monaco || !model) return
    monaco.editor.setModelMarkers(
      model,
      "selldoes",
      (problems ?? []).map((problem) => ({
        startLineNumber: problem.line,
        startColumn: problem.column,
        endLineNumber: problem.endLine ?? problem.line,
        endColumn: problem.endColumn ?? problem.column + 1,
        message: problem.message,
        severity: problem.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      })),
    )
  }, [ready, path, problems])

  React.useEffect(() => {
    const editor = editorRef.current
    if (!ready || !editor || !revealLine) return
    editor.revealLineInCenter(revealLine)
    editor.setPosition({ lineNumber: revealLine, column: 1 })
    editor.focus()
  }, [ready, path, revealLine])

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />
}

interface MonacoDiffProps {
  path: string
  original: string
  modified: string
  theme: "light" | "dark"
}

/** Read-only side-by-side diff (git changes, snapshot comparisons). */
export function MonacoDiff({ path, original, modified, theme }: MonacoDiffProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const monacoRef = React.useRef<Monaco | null>(null)
  const editorRef = React.useRef<DiffEditor | null>(null)
  const modelsRef = React.useRef<{ original: TextModel | null; modified: TextModel | null }>({ original: null, modified: null })
  // Per-instance URI namespace — the model service is global (see MonacoEditor).
  const instanceIdRef = React.useRef(`d${Math.random().toString(36).slice(2, 9)}`)
  const [ready, setReady] = React.useState(false)
  const themeRef = React.useRef(theme)
  themeRef.current = theme

  React.useEffect(() => {
    let disposed = false
    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return
      monacoRef.current = monaco
      const editor = monaco.editor.createDiffEditor(containerRef.current, {
        theme: themeRef.current === "dark" ? "vs-dark" : "vs",
        automaticLayout: true,
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 12.5,
        renderSideBySide: true,
        scrollBeyondLastLine: false,
        originalEditable: false,
      })
      editorRef.current = editor
      setReady(true)
    })
    return () => {
      disposed = true
      editorRef.current?.dispose()
      editorRef.current = null
      monacoRef.current = null
      modelsRef.current.original?.dispose()
      modelsRef.current.modified?.dispose()
      modelsRef.current = { original: null, modified: null }
      setReady(false)
    }
  }, [])

  React.useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!ready || !monaco || !editor) return
    const language = languageFor(path)
    if (!modelsRef.current.original) {
      modelsRef.current.original = monaco.editor.createModel(
        original,
        language,
        monaco.Uri.parse(`inmemory://selldoes/${instanceIdRef.current}/${encodeURI(path)}?original`),
      )
    }
    if (!modelsRef.current.modified) {
      modelsRef.current.modified = monaco.editor.createModel(
        modified,
        language,
        monaco.Uri.parse(`inmemory://selldoes/${instanceIdRef.current}/${encodeURI(path)}?modified`),
      )
    }
    if (modelsRef.current.original.getValue() !== original) modelsRef.current.original.setValue(original)
    if (modelsRef.current.modified.getValue() !== modified) modelsRef.current.modified.setValue(modified)
    editor.setModel({ original: modelsRef.current.original, modified: modelsRef.current.modified })
  }, [ready, path, original, modified])

  React.useEffect(() => {
    if (!ready || !monacoRef.current) return
    monacoRef.current.editor.setTheme(theme === "dark" ? "vs-dark" : "vs")
  }, [ready, theme])

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />
}
