import * as React from "react"
import { Link } from "react-router-dom"
import { Check, FileCode2, Loader2, Pencil, Plus, Save, Webhook } from "lucide-react"
import { CreateHookDialog } from "@/components/create-dialogs"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, PageHead } from "@/components/shared"
import { dev } from "@/lib/api"
import { findHookCatalog, handlerPathFor, hookModuleTemplate, normalizeHandlerPath } from "@/lib/hooks-catalog"
import { healMissingDeclaration, parseMissingDeclaration } from "@/lib/self-heal"
import type { PluginManifest, Validation } from "@/lib/types"
import { useVisit } from "@/lib/use-visit"
import { useApp } from "@/state/app"

interface HookDeclaration {
  handler?: string
  component?: string
  types?: string[]
}

export function HooksPage() {
  const { bootstrap, setAssistantPage, applyManifest, refresh, toast } = useApp()
  useVisit("hooks")
  const manifest = bootstrap!.manifest
  const hooks = Object.entries((manifest.hooks ?? {}) as Record<string, HookDeclaration>)

  /** Handler files on disk — missing files get a Create button instead of Edit. */
  const [filePaths, setFilePaths] = React.useState<Set<string> | null>(null)
  const reloadFiles = React.useCallback(async () => {
    try {
      const tree = await dev.files()
      setFilePaths(new Set(tree.entries.filter((entry) => entry.type === "file").map((entry) => entry.path)))
    } catch {
      setFilePaths(null)
    }
  }, [])
  React.useEffect(() => {
    void reloadFiles()
  }, [reloadFiles])

  /** Declared handlers can carry a legacy "./" prefix; the real file path doesn't. */
  const handlerFileFor = React.useCallback(
    (name: string, declaration: HookDeclaration) =>
      normalizeHandlerPath(declaration.handler ?? handlerPathFor(name)),
    [],
  )

  // One-time self-heal: rewrite "./handlers/x.js" declarations to "handlers/x.js"
  // so plugin.json matches the file tree (and every other page's path matching).
  const healedRef = React.useRef(false)
  React.useEffect(() => {
    if (!filePaths || healedRef.current) return
    const fixes = hooks.filter(
      ([name, declaration]) =>
        declaration.handler &&
        declaration.handler !== handlerFileFor(name, declaration) &&
        filePaths.has(handlerFileFor(name, declaration)),
    )
    if (fixes.length === 0) return
    healedRef.current = true
    const nextHooks = { ...(manifest.hooks ?? {}) } as Record<string, HookDeclaration>
    for (const [name, declaration] of fixes) {
      nextHooks[name] = { ...declaration, handler: handlerFileFor(name, declaration) }
    }
    void dev
      .saveManifest({ ...manifest, hooks: nextHooks })
      .then((saved) => {
        applyManifest(saved.manifest, saved.validation)
        toast(`Fixed handler path in plugin.json — ${handlerFileFor(fixes[0][0], fixes[0][1])}`, "success")
      })
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "error"))
  }, [filePaths, hooks, manifest, applyManifest, toast, handlerFileFor])

  // ── Creation: New hook (scaffold into hooks/ + plugin.json + entry) ──────
  const [createOpen, setCreateOpen] = React.useState(false)

  const handleScaffolded = React.useCallback(
    (next: PluginManifest, validation: Validation, message: string) => {
      applyManifest(next, validation)
      toast(message, "success")
      void refresh()
      void reloadFiles()
    },
    [applyManifest, refresh, toast, reloadFiles],
  )

  React.useEffect(() => {
    setAssistantPage({
      context: `The developer is on the Hooks page. Declared hooks: ${JSON.stringify(hooks.map(([name]) => name))}.`,
      quick: ["Explain hooks in plain language", "Add a hook that reacts to orders"],
    })
  }, [setAssistantPage]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <PageHead
        title="Hooks"
        description="Events your plugin subscribes to. Fire one here and inspect the return value — the same handler the host calls."
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            New hook
          </Button>
        }
      />

      {hooks.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="No hooks declared"
          message={
            <>
              Declare hooks in plugin.json and export them from your entry as <code>hooks["name"]</code> — or scaffold one.
            </>
          }
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus />
              New hook
            </Button>
          }
        />
      ) : (
        hooks.map(([name, declaration]) => (
          <HookCard
            key={name}
            name={name}
            declaration={declaration}
            handlerExists={filePaths?.has(handlerFileFor(name, declaration)) ?? null}
            onFilesChanged={reloadFiles}
          />
        ))
      )}

      <CreateHookDialog open={createOpen} onOpenChange={setCreateOpen} onScaffolded={handleScaffolded} />
    </div>
  )
}

function HookCard({
  name,
  declaration,
  handlerExists,
  onFilesChanged,
}: {
  name: string
  declaration: HookDeclaration
  /** True = handler file on disk, false = missing, null = still checking. */
  handlerExists: boolean | null
  onFilesChanged: () => Promise<void> | void
}) {
  const { toast, bootstrap, applyManifest, refresh } = useApp()
  const storageKey = `selldoes-dev:hook-payload:${name}`
  const initialPayload = React.useMemo(() => {
    try {
      return localStorage.getItem(storageKey) ?? "{}"
    } catch {
      return "{}"
    }
  }, [storageKey])
  const [payload, setPayload] = React.useState(initialPayload)
  const [savedPayload, setSavedPayload] = React.useState(initialPayload)
  const payloadDirty = payload !== savedPayload
  const [result, setResult] = React.useState("—")
  const [busy, setBusy] = React.useState(false)
  const [creatingFile, setCreatingFile] = React.useState(false)
  const [parseError, setParseError] = React.useState<string | null>(null)

  const savePayload = React.useCallback(
    (value: string) => {
      try {
        localStorage.setItem(storageKey, value)
      } catch {
        /* private mode — payload just won't persist */
      }
      setSavedPayload(value)
    },
    [storageKey],
  )

  /** Fire = just run it; a missing plugin.json declaration is added and the fire retried once. */
  const fire = async (healed = false) => {
    let parsed: unknown = {}
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {}
      setParseError(null)
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error))
      return
    }
    savePayload(payload)
    setBusy(true)
    setResult("…")
    try {
      const data = await dev.runHook(name, parsed)
      if (typeof data.error === "string" && data.error && !healed) {
        const missing = parseMissingDeclaration(data.error)
        if (missing) {
          await healMissingDeclaration(missing, { manifest: bootstrap!.manifest, applyManifest, refresh, toast })
          // Retry once regardless — the saved manifest can lag the client.
          setBusy(false)
          await fire(true)
          return
        }
      }
      setResult(JSON.stringify(data.result ?? data, null, 2))
      if (typeof data.error === "string" && data.error) toast(data.error, "error")
      else toast(`Hook ${name} fired`, "success")
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  /** Declared in plugin.json but the file is gone — write the stub back. */
  const createHandlerFile = async () => {
    const file = normalizeHandlerPath(declaration.handler ?? handlerPathFor(name))
    setCreatingFile(true)
    try {
      await dev.createFile(file, "file")
      await dev.writeFile(file, hookModuleTemplate(name))
      toast(`Created ${file}`, "success")
      await onFilesChanged()
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setCreatingFile(false)
    }
  }

  const catalog = findHookCatalog(name)
  const description = catalog
    ? catalog.description
    : declaration.handler
      ? `handler: ${declaration.handler}`
      : declaration.component
        ? `component: ${declaration.component}`
        : declaration.types
          ? `types: ${(declaration.types ?? []).join(", ")}`
          : ""

  const handlerFile = normalizeHandlerPath(declaration.handler ?? handlerPathFor(name))

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{name}</CardTitle>
          {catalog ? <Badge variant="outline">{catalog.group}</Badge> : <Badge variant="secondary">Custom</Badge>}
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5">
          <code className="truncate text-[10.5px] text-muted-foreground">{handlerFile}</code>
          {handlerExists === false ? (
            <Button
              size="sm"
              variant="outline"
              className="h-6 shrink-0 px-2 text-[11px]"
              onClick={() => void createHandlerFile()}
              disabled={creatingFile}
            >
              {creatingFile ? <Loader2 className="animate-spin" /> : <FileCode2 />}
              Create
            </Button>
          ) : (
            <Link
              to={`/code?file=${encodeURIComponent(handlerFile)}`}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Link>
          )}
        </div>
        <Textarea className="font-mono text-xs" value={payload} onChange={(event) => setPayload(event.target.value)} />
        {parseError ? <p className="text-[11px] text-destructive">{parseError}</p> : null}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => savePayload(payload)} disabled={!payloadDirty}>
            {payloadDirty ? <Save /> : <Check />}
            {payloadDirty ? "Save" : "Saved"}
          </Button>
          <Button size="sm" onClick={() => void fire()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Webhook />}
            Fire hook
          </Button>
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-muted p-3 text-[11.5px]">{result}</pre>
      </CardContent>
    </Card>
  )
}
