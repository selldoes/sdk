import * as React from "react"
import { Loader2, Plus } from "lucide-react"
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
import { dev } from "@/lib/api"
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

/** New hook — hooks/<name>.js, declared in plugin.json, wired into the entry. */
export function CreateHookDialog({
  open,
  onOpenChange,
  onScaffolded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScaffolded: ScaffoldedHandler
}) {
  const { toast } = useApp()
  const [label, setLabel] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setLabel("")
  }, [open])

  const ready = label.trim().length > 0

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const result = await dev.scaffoldHook({ name: label.trim() })
      onScaffolded(result.manifest, result.validation, `Hook scaffolded: ${result.file}`)
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
          <DialogTitle>New hook</DialogTitle>
          <DialogDescription>{"Creates hooks/<name>.js, declares it in plugin.json and wires it into the entry."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="create-hook-name">Hook name (event)</Label>
          <Input
            id="create-hook-name"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="order:delivered"
            autoFocus
          />
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

/** New API route — routes/<path>.js, declared in apiRoutes, wired into the entry. */
export function CreateRouteDialog({
  open,
  onOpenChange,
  onScaffolded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScaffolded: ScaffoldedHandler
}) {
  const { toast } = useApp()
  const [path, setPath] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setPath("")
  }, [open])

  const ready = path.trim().length > 0

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const raw = path.trim()
      const result = await dev.scaffoldRoute({ path: raw.startsWith("/") ? raw : `/${raw}` })
      onScaffolded(result.manifest, result.validation, `Route scaffolded: ${result.file}`)
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
          <DialogDescription>{"Creates routes/<path>.js, declares it in apiRoutes and wires it into the entry."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="create-route-path">Route path</Label>
          <Input id="create-route-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/stats" autoFocus />
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
