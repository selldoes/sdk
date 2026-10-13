import * as React from "react"
import { Link } from "react-router-dom"
import { FileCode2, Loader2, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { dev } from "@/lib/api"
import { handlerPathFor, HOOK_CATALOG, hookModuleTemplate, normalizeHandlerPath } from "@/lib/hooks-catalog"
import { ROUTE_METHODS, routeFileHint, routeModuleTemplate } from "@/lib/route-scaffold"
import type { PluginManifest, Validation } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useApp } from "@/state/app"

/**
 * Code-scaffold dialogs (New job / New hook / New route), extracted from the
 * Dashboard page so each concept lives on its own page: Jobs hosts
 * CreateJobDialog, Hooks hosts CreateHookDialog, API routes hosts
 * CreateRouteDialog. Each host passes an onScaffolded handler that applies the
 * patched manifest, refreshes the shell and toasts.
 */

/** What a host page does after a scaffold succeeds (patched manifest, validation, success toast). */
export type ScaffoldedHandler = (manifest: PluginManifest, validation: Validation, message: string) => void

/** Two-column choice tile used by the dialogs' mode selectors. */
export function ChoiceTile({
  selected,
  onSelect,
  title,
  blurb,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  blurb: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-lg border px-3 py-2 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
      )}
    >
      <span className="block text-[12.5px] font-semibold">{title}</span>
      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{blurb}</span>
    </button>
  )
}

/** New job — QuickJS jobs/<type>.js (chunked) or Node server/<type>.js (full npm). */
export function CreateJobDialog({
  open,
  onOpenChange,
  onScaffolded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScaffolded: ScaffoldedHandler
}) {
  const { toast } = useApp()
  const [runtime, setRuntime] = React.useState<"quickjs" | "node">("quickjs")
  const [type, setType] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setRuntime("quickjs")
      setType("")
      setLabel("")
      setDescription("")
    }
  }, [open])

  const ready = type.trim().length > 0

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const result = await dev.scaffoldJob({
        type: type.trim(),
        ...(label.trim() ? { name: label.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(runtime === "node" ? { runtime: "node" as const } : {}),
      })
      onScaffolded(result.manifest, result.validation, `Job scaffolded: ${result.file}`)
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New job</DialogTitle>
          <DialogDescription>
            {
              "QuickJS jobs create jobs/<type>.js (chunked init/step/finalize); Node jobs create server/<type>.js and run once with full npm access."
            }
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Runtime</Label>
            <div className="grid grid-cols-2 gap-2">
              <ChoiceTile
                selected={runtime === "quickjs"}
                onSelect={() => setRuntime("quickjs")}
                title="QuickJS (chunked)"
                blurb={"jobs/<type>.js — ticks, checkpoints, sandboxed"}
              />
              <ChoiceTile
                selected={runtime === "node"}
                onSelect={() => setRuntime("node")}
                title="Node (full npm)"
                blurb={"server/<type>.js — runs once, any npm package"}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-job-type">Job type</Label>
            <Input
              id="create-job-type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              placeholder="import-products"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-job-name">Display name (optional)</Label>
            <Input id="create-job-name" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Import products" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-job-desc">Description (optional)</Label>
            <Input
              id="create-job-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Walks the catalog in chunks"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!ready || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** New hook — pick a known event (or type a custom name), scaffold hooks/<name>.js. */
export function CreateHookDialog({
  open,
  onOpenChange,
  onScaffolded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScaffolded: ScaffoldedHandler
}) {
  const { toast, bootstrap } = useApp()
  const [selected, setSelected] = React.useState<string | null>(null)
  const [custom, setCustom] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  /** Handler files that exist on disk, keyed by path — checked when the dialog opens. */
  const [existingFiles, setExistingFiles] = React.useState<Set<string>>(new Set())

  const declaredHooks = (bootstrap?.manifest.hooks ?? {}) as Record<string, { handler?: string }>
  const name = selected ?? custom.trim()
  const declaredHandler = name ? declaredHooks[name]?.handler : undefined
  const handlerPath = name ? normalizeHandlerPath(declaredHandler ?? handlerPathFor(name)) : null
  const handlerExists = Boolean(handlerPath && existingFiles.has(handlerPath))
  const alreadyDeclared = Boolean(name && declaredHooks[name])

  React.useEffect(() => {
    if (!open) return
    setSelected(null)
    setCustom("")
    setQuery("")
    let cancelled = false
    dev
      .files()
      .then((tree) => {
        if (!cancelled) setExistingFiles(new Set(tree.entries.filter((entry) => entry.type === "file").map((entry) => entry.path)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  const catalog = HOOK_CATALOG.filter(
    (entry) =>
      !query.trim() ||
      entry.name.toLowerCase().includes(query.toLowerCase()) ||
      entry.description.toLowerCase().includes(query.toLowerCase()),
  )

  const ready = name.length > 0 && !alreadyDeclared

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const result = await dev.scaffoldHook({ name })
      onScaffolded(result.manifest, result.validation, `Hook scaffolded: ${result.file}`)
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  /** Already declared but the file is gone — write the stub back at the declared path. */
  const createMissingFile = async () => {
    if (!handlerPath || busy) return
    setBusy(true)
    try {
      await dev.createFile(handlerPath, "file")
      await dev.writeFile(handlerPath, hookModuleTemplate(name))
      toast(`Created ${handlerPath}`, "success")
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New hook</DialogTitle>
          <DialogDescription>
            {"Pick an event the host fires — or type your own name. Creates hooks/<name>.js, declares it in plugin.json and wires it into the entry."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search events (products, orders, checkout…)"
            autoFocus
          />
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {catalog.map((entry) => {
              const isSelected = selected === entry.name
              const declared = Boolean(declaredHooks[entry.name])
              return (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => {
                    setSelected(isSelected ? null : entry.name)
                    setCustom("")
                  }}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                    isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[12px] font-semibold">{entry.name}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{entry.description}</span>
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {entry.group}
                  </Badge>
                  {declared ? (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      Declared
                    </Badge>
                  ) : null}
                </button>
              )
            })}
            {catalog.length === 0 ? (
              <p className="px-1 py-2 text-[11.5px] text-muted-foreground">
                No events match — type a custom name below.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-hook-name">…or a custom event name</Label>
            <Input
              id="create-hook-name"
              value={custom}
              onChange={(event) => {
                setCustom(event.target.value)
                setSelected(null)
              }}
              placeholder="order:delivered"
              disabled={Boolean(selected)}
            />
          </div>
          {name ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
              <span className="text-[11px] font-medium text-muted-foreground">Handler</span>
              <div className="flex min-w-0 items-center gap-2">
                <code className="truncate text-[11px]">{handlerPath}</code>
                {alreadyDeclared ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    Declared
                  </Badge>
                ) : handlerExists ? (
                  <Badge variant="outline" className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]">
                    Exists
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          {alreadyDeclared ? (
            handlerExists && handlerPath ? (
              <Button asChild size="sm">
                <Link to={`/code?file=${encodeURIComponent(handlerPath)}`}>
                  <Pencil />
                  Edit handler
                </Link>
              </Button>
            ) : (
              <Button size="sm" onClick={() => void createMissingFile()} disabled={!handlerPath || busy}>
                {busy ? <Loader2 className="animate-spin" /> : <FileCode2 />}
                Create file
              </Button>
            )
          ) : (
            <Button size="sm" onClick={() => void submit()} disabled={!ready || busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              Create
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** New API route — pick path + methods, scaffold routes/<path>.js and wire it into the entry. */
export function CreateRouteDialog({
  open,
  onOpenChange,
  onScaffolded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScaffolded: ScaffoldedHandler
}) {
  const { toast, bootstrap } = useApp()
  const [path, setPath] = React.useState("")
  const [methods, setMethods] = React.useState<string[]>(["GET"])
  const [busy, setBusy] = React.useState(false)
  const [existingFiles, setExistingFiles] = React.useState<Set<string>>(new Set())

  const declaredRoutes = (bootstrap?.manifest.apiRoutes ?? []) as { path: string; methods?: string[] }[]
  const slug = bootstrap?.manifest.slug ?? ""
  const routePath = path.trim() ? (path.trim().startsWith("/") ? path.trim() : `/${path.trim()}`) : ""
  const handlerPath = routePath ? routeFileHint(routePath) : null
  const declaredRoute = routePath ? declaredRoutes.find((route) => route.path === routePath) : undefined
  const handlerExists = Boolean(handlerPath && existingFiles.has(handlerPath))
  const ready = routePath.length > 0 && !declaredRoute

  React.useEffect(() => {
    if (!open) return
    setPath("")
    setMethods(["GET"])
    let cancelled = false
    dev
      .files()
      .then((tree) => {
        if (!cancelled) setExistingFiles(new Set(tree.entries.filter((entry) => entry.type === "file").map((entry) => entry.path)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  const toggleMethod = (method: string) => {
    setMethods((previous) =>
      previous.includes(method) ? previous.filter((entry) => entry !== method) : [...previous, method],
    )
  }

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const result = await dev.scaffoldRoute({ path: routePath, methods: methods.length > 0 ? methods : ["GET"] })
      onScaffolded(result.manifest, result.validation, `Route scaffolded: ${result.file}`)
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  /** Already declared but the file is gone — write the stub back at the declared path. */
  const createMissingFile = async () => {
    if (!handlerPath || busy) return
    setBusy(true)
    try {
      await dev.createFile(handlerPath, "file")
      await dev.writeFile(handlerPath, routeModuleTemplate(routePath, declaredRoute?.methods ?? methods))
      toast(`Created ${handlerPath}`, "success")
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New API route</DialogTitle>
          <DialogDescription>
            {"Creates routes/<path>.js, declares it in apiRoutes and wires it into the entry."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="create-route-path">Route path</Label>
            <Input
              id="create-route-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/stats"
              autoFocus
            />
            {routePath ? (
              <p className="truncate font-mono text-[10.5px] text-muted-foreground">
                {`/api/plugin-api/${slug}${routePath}`}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Methods</Label>
            <div className="flex flex-wrap gap-1.5">
              {ROUTE_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => toggleMethod(method)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors",
                    methods.includes(method)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>
          {routePath ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
              <span className="text-[11px] font-medium text-muted-foreground">Handler</span>
              <div className="flex min-w-0 items-center gap-2">
                <code className="truncate text-[11px]">{handlerPath}</code>
                {declaredRoute ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    Declared
                  </Badge>
                ) : handlerExists ? (
                  <Badge variant="outline" className="shrink-0 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                    Exists
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          {declaredRoute ? (
            handlerExists && handlerPath ? (
              <Button asChild size="sm">
                <Link to={`/code?file=${encodeURIComponent(handlerPath)}`}>
                  <Pencil />
                  Edit handler
                </Link>
              </Button>
            ) : (
              <Button size="sm" onClick={() => void createMissingFile()} disabled={!handlerPath || busy}>
                {busy ? <Loader2 className="animate-spin" /> : <FileCode2 />}
                Create file
              </Button>
            )
          ) : (
            <Button size="sm" onClick={() => void submit()} disabled={!ready || busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              Create
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
