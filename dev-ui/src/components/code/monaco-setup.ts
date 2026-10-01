import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker"
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker"
import { PLUGIN_SCHEMA } from "@/lib/plugin-schema"

/**
 * Monaco worker wiring + SDK-aware settings. Kept as a side-effect module so
 * the Code page can lazy-load it (and Monaco itself) only when opened.
 */

type Monaco = typeof import("monaco-editor")

interface MonacoEnvironmentShape {
  getWorker: (workerId: string, label: string) => Worker
}

const globalScope = self as unknown as {
  MonacoEnvironment?: MonacoEnvironmentShape
  __selldoesMonacoReady?: boolean
}

if (!globalScope.MonacoEnvironment) {
  globalScope.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "typescript" || label === "javascript") return new tsWorker()
      if (label === "json") return new jsonWorker()
      if (label === "css" || label === "scss" || label === "less") return new cssWorker()
      if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker()
      return new editorWorker()
    },
  }
}

let sdkTypesPromise: Promise<string> | null = null

/** Fetches the SDK's shipped type definitions once (for IntelliSense). */
export function loadSdkTypes(): Promise<string> {
  if (!sdkTypesPromise) {
    sdkTypesPromise = fetch("/__dev/sdk-types")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => (typeof data?.content === "string" ? data.content : ""))
      .catch(() => "")
  }
  return sdkTypesPromise
}

/** Applies compiler options, the SDK types and the plugin.json schema once. */
export function configureMonaco(monaco: Monaco): void {
  if (globalScope.__selldoesMonacoReady) return
  globalScope.__selldoesMonacoReady = true

  const typescript = monaco.languages.typescript
  typescript.typescriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
    jsx: typescript.JsxEmit.ReactJSX,
    target: typescript.ScriptTarget.ES2020,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
    strict: false,
    noEmit: true,
  })
  typescript.javascriptDefaults.setCompilerOptions(typescript.typescriptDefaults.getCompilerOptions())
  typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })

  void loadSdkTypes().then((content) => {
    if (!content) return
    typescript.typescriptDefaults.addExtraLib(content, "file:///node_modules/selldoes/index.d.ts")
    typescript.javascriptDefaults.addExtraLib(content, "file:///node_modules/selldoes/index.d.ts")
  })

  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: [{ uri: "selldoes://plugin.schema.json", fileMatch: ["*plugin.json"], schema: PLUGIN_SCHEMA }],
  })
}
