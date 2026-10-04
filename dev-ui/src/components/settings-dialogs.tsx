import * as React from "react"
import { Loader2, Trash2 } from "lucide-react"
import { Callout } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ws } from "@/lib/ws-api"
import type { WsPackage, WsProject } from "@/lib/ws-api"
import { useApp } from "@/state/app"

/**
 * Settings dialogs shared by the Project settings and User settings pages:
 * generic confirms, the typed-slug delete-files dialog and the remote
 * workspace-copy delete dialog.
 */

/** Generic confirm dialog for reversible-but-serious actions. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" variant={danger ? "destructive" : "default"} disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Delete-files dialog: typed-slug confirmation, path on screen, and a second
 * gate when the folder is a dirty git repo (the server answers 409 first).
 */
export function DeleteFilesDialog({
  project,
  onDone,
  onClose,
}: {
  project: WsProject | null
  onDone: () => void
  onClose: () => void
}) {
  const { toast } = useApp()
  const [typed, setTyped] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)
  const [allowDirty, setAllowDirty] = React.useState(false)

  React.useEffect(() => {
    setTyped("")
    setError(null)
    setDirty(false)
    setAllowDirty(false)
  }, [project?.id])

  if (!project) return null
  const confirmed = typed.trim() === project.slug

  const run = async () => {
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await ws.deleteFiles({ projectId: project.id, confirmSlug: project.slug, allowDirty })
      toast(`Deleted ${result.slug} from disk`, "success")
      onDone()
      onClose()
    } catch (cause) {
      const code = (cause as { code?: string }).code
      if (code === "dirty") {
        setDirty(true)
        setError(cause instanceof Error ? cause.message : String(cause))
      } else {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(project)} onOpenChange={(open) => !busy && !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            Delete project files from disk
          </DialogTitle>
          <DialogDescription>
            This removes the folder and everything inside it, then unregisters it from the workspace. It cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <p className="text-xs font-semibold">
              {project.name} <span className="text-muted-foreground">/{project.slug}</span>
            </p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{project.path}</p>
          </div>
          {dirty ? (
            <Callout kind="warn">
              <p className="font-semibold">Uncommitted git changes</p>
              <p className="mt-0.5 text-[12px]">{error}</p>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] font-medium">
                <Checkbox checked={allowDirty} onCheckedChange={(value) => setAllowDirty(value === true)} />
                Delete anyway — I accept losing the uncommitted changes
              </label>
            </Callout>
          ) : null}
          {error && !dirty ? <p className="text-[12px] text-destructive">{error}</p> : null}
          <div className="space-y-1.5">
            <Label htmlFor="delete-files-confirm" className="text-xs">
              Type <code className="font-mono font-bold">{project.slug}</code> to confirm
            </Label>
            <Input
              id="delete-files-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void run()
              }}
              placeholder={project.slug}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" disabled={!confirmed || busy || (dirty && !allowDirty)} onClick={() => void run()}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete files
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Remote delete dialog — mirrors the platform's semantics verbatim. */
export function DeleteRemoteDialog({
  pkg,
  appUrl,
  onDone,
  onClose,
}: {
  pkg: WsPackage | null
  appUrl: string
  onDone: () => void
  onClose: () => void
}) {
  const { toast } = useApp()
  const [typed, setTyped] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setTyped("")
    setError(null)
  }, [pkg?.slug])

  if (!pkg) return null
  const confirmed = typed.trim() === pkg.slug

  const run = async () => {
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await ws.deleteRemote(pkg.slug)
      toast(`Deleted ${pkg.slug} workspace copy from ${appUrl}`, "success")
      onDone()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(pkg)} onOpenChange={(open) => !busy && !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            Delete workspace copy of {pkg.name}?
          </DialogTitle>
          <DialogDescription>
            Deletes the developer workspace package and its stored files on {appUrl}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Callout kind="warn">
            <p className="text-[12.5px]">
              <strong>Published marketplace artifacts stay.</strong> The marketplace listing and immutable releases are kept —
              admins manage those from the listings screen. Re-publishing the slug creates a fresh draft.
            </p>
          </Callout>
          <div className="space-y-1.5">
            <Label htmlFor="delete-remote-confirm" className="text-xs">
              Type <code className="font-mono font-bold">{pkg.slug}</code> to confirm
            </Label>
            <Input
              id="delete-remote-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void run()
              }}
              placeholder={pkg.slug}
              className="font-mono"
              autoFocus
            />
          </div>
          {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" disabled={!confirmed || busy} onClick={() => void run()}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete workspace copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Small helper: the danger-zone footer used by both settings pages. */
export function DangerRow({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: React.ReactNode
  action: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}
